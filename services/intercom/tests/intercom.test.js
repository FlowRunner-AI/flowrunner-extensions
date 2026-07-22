'use strict'

const { createSandbox } = require('../../../service-sandbox')

const CLIENT_ID = 'test-client-id'
const CLIENT_SECRET = 'test-client-secret'
const TOKEN = 'test-access-token'

const API = 'https://api.intercom.io'
const AUTHORIZE_URL = 'https://app.intercom.com/oauth'
const TOKEN_URL = `${ API }/auth/eagle/token`
const ME_URL = `${ API }/me`
const VERSION = '2.14'

// Fixed "now" (seconds) used by the polling-trigger tests.
const NOW = 1700000000
const LAG = 60

describe('Intercom Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET })
    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()
  })

  beforeEach(() => {
    // The Flowrunner OAuth runtime injects the live token on `this.request`.
    service.request = { headers: { 'oauth-access-token': TOKEN } }
  })

  afterEach(() => {
    mock.reset()
    jest.restoreAllMocks()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Helpers ──

  /** The most recent recorded request. */
  function last() {
    return mock.history[mock.history.length - 1]
  }

  /** Registers a catch-all success reply so a call under test resolves. */
  function replyAny(response = { ok: true }) {
    mock.onAny().reply(response)
  }

  // ==========================================================================
  //  REGISTRATION
  // ==========================================================================

  describe('service registration', () => {
    it('registers the OAuth config items', () => {
      expect(sandbox.getConfigItems()).toEqual([
        expect.objectContaining({ name: 'clientId', displayName: 'Client ID', type: 'STRING', required: true, shared: true }),
        expect.objectContaining({ name: 'clientSecret', displayName: 'Client Secret', type: 'STRING', required: true, shared: true }),
      ])
    })

    it('registers no `order` property on any config item', () => {
      for (const item of sandbox.getConfigItems()) {
        expect(item).not.toHaveProperty('order')
      }
    })

    // Regression guard (a marketo bug): a config key read via this.config.X but never
    // registered in addService() is unsettable in production.
    it('registers every config key the service reads', () => {
      const registered = sandbox.getConfigItems().map(item => item.name)
      const source = require('fs').readFileSync(require.resolve('../src/index.js'), 'utf8')
      const read = [...new Set([...source.matchAll(/this\.config\.([A-Za-z0-9_]+)/g)].map(m => m[1]))]

      // Guard against a vacuous pass if the scan ever stops matching.
      expect(read).toEqual(expect.arrayContaining(['clientId', 'clientSecret']))
      expect(read.sort()).toEqual([...read].sort().filter(key => registered.includes(key)))
    })

    it('exposes the configured client credentials on the instance', () => {
      expect(service.clientId).toBe(CLIENT_ID)
      expect(service.clientSecret).toBe(CLIENT_SECRET)
    })
  })

  // ==========================================================================
  //  CORE REQUEST / HEADERS / ERROR SHAPING
  // ==========================================================================

  describe('request headers', () => {
    it('sends Bearer token, Accept and Intercom-Version on every call', async () => {
      mock.onGet(`${ API }/tags`).reply({ data: [] })

      await service.listTags()

      expect(last().headers).toEqual({
        Authorization: `Bearer ${ TOKEN }`,
        Accept: 'application/json',
        'Intercom-Version': VERSION,
      })
    })

    it('adds Content-Type only when a JSON body is sent', async () => {
      mock.onPost(`${ API }/tags`).reply({ id: '1' })

      await service.createOrUpdateTag('Independent')

      expect(last().headers['Content-Type']).toBe('application/json')
    })

    it('omits Content-Type on bodyless requests', async () => {
      mock.onGet(`${ API }/admins`).reply({ admins: [] })

      await service.listAdmins()

      expect(last().headers['Content-Type']).toBeUndefined()
    })

    it('sends "Bearer undefined" when the runtime provides no oauth-access-token header', async () => {
      service.request = { headers: {} }
      mock.onGet(`${ API }/tags`).reply({ data: [] })

      await service.listTags()

      expect(last().headers.Authorization).toBe('Bearer undefined')
    })

    it('fails before issuing a call when `this.request` is absent entirely', async () => {
      delete service.request
      replyAny()

      // The TypeError from reading `.headers` off an absent request is caught by #apiRequest
      // and re-thrown through #handleError, so no HTTP call is ever made.
      await expect(service.listTags()).rejects.toThrow("Cannot read properties of undefined (reading 'headers')")
      expect(mock.history).toHaveLength(0)
    })
  })

  describe('error shaping', () => {
    it('prefixes a friendly hint for a mapped status and includes the API message', async () => {
      mock.onGet(`${ API }/contacts/c1`).replyWithError({
        message: 'Not Found',
        status: 404,
        body: { errors: [{ code: 'not_found', message: 'Contact Not Found' }] },
      })

      await expect(service.getContact('c1')).rejects.toThrow(
        'Not found — the ID may be wrong; use the matching "Get …"/dictionary action to pick a valid one. (Contact Not Found)'
      )
    })

    it.each([
      [400, 'Invalid request — check the required fields and their values.'],
      [401, 'Authentication failed — reconnect the Intercom account.'],
      [403, 'Permission denied — the connected app is missing the scope for this action.'],
      [422, 'Invalid request — check the required fields and their values.'],
      [429, 'Intercom rate limit hit — retry in a moment.'],
    ])('maps status %s to its hint', async (status, hint) => {
      mock.onGet(`${ API }/tags`).replyWithError({ message: 'boom', status, body: { message: 'nope' } })

      await expect(service.listTags()).rejects.toThrow(`${ hint } (nope)`)
    })

    it('reads the status off error.body.status when error.status is absent', async () => {
      mock.onGet(`${ API }/tags`).replyWithError({ message: 'boom', body: { status: 401, message: 'expired' } })

      await expect(service.listTags()).rejects.toThrow('Authentication failed — reconnect the Intercom account. (expired)')
    })

    it('falls back to body.error.message', async () => {
      mock.onGet(`${ API }/tags`).replyWithError({ message: 'boom', body: { error: { message: 'inner detail' } } })

      await expect(service.listTags()).rejects.toThrow('inner detail')
    })

    it('falls back to error.message when the body carries nothing usable', async () => {
      mock.onGet(`${ API }/tags`).replyWithError({ message: 'Network timeout' })

      await expect(service.listTags()).rejects.toThrow('Network timeout')
    })

    it('falls back to "Request failed" when there is no message at all', async () => {
      mock.onGet(`${ API }/tags`).replyWithError(Object.assign(new Error(), { message: '' }))

      await expect(service.listTags()).rejects.toThrow('Request failed')
    })

    it('does not prefix a hint for an unmapped status', async () => {
      mock.onGet(`${ API }/tags`).replyWithError({ message: 'Server error', status: 500 })

      await expect(service.listTags()).rejects.toThrow(/^Server error$/)
    })

    it('ignores an empty errors array and falls through to body.message', async () => {
      mock.onGet(`${ API }/tags`).replyWithError({ message: 'boom', body: { errors: [], message: 'outer' } })

      await expect(service.listTags()).rejects.toThrow('outer')
    })
  })

  // ==========================================================================
  //  OAUTH2 SYSTEM METHODS
  // ==========================================================================

  describe('getOAuth2ConnectionURL', () => {
    it('builds the authorize URL with the client id and the runtime state', async () => {
      service.request = { headers: { 'oauth-state': 'state-123' } }

      const url = await service.getOAuth2ConnectionURL()

      expect(url).toBe(`${ AUTHORIZE_URL }?client_id=${ CLIENT_ID }&state=state-123&response_type=code`)
    })

    it('defaults the state to "intercom" when the runtime supplies none', async () => {
      service.request = { headers: {} }

      await expect(service.getOAuth2ConnectionURL()).resolves.toContain('state=intercom')
    })

    it('defaults the state when `this.request` is absent', async () => {
      delete service.request

      await expect(service.getOAuth2ConnectionURL()).resolves.toContain('state=intercom')
    })

    it('does not add redirect_uri or scope (injected/configured elsewhere)', async () => {
      const url = await service.getOAuth2ConnectionURL()

      expect(url).not.toContain('redirect_uri')
      expect(url).not.toContain('scope')
    })

    it('issues no HTTP call', async () => {
      await service.getOAuth2ConnectionURL()

      expect(mock.history).toHaveLength(0)
    })
  })

  describe('executeCallback', () => {
    it('exchanges the code and looks up the connection identity', async () => {
      mock.onPost(TOKEN_URL).reply({ access_token: 'live-token' })
      mock.onGet(ME_URL).reply({ name: 'Ciaran Lee', email: 'admin@email.com' })

      const result = await service.executeCallback({ code: 'auth-code' })

      expect(result).toEqual({ token: 'live-token', connectionIdentityName: 'Ciaran Lee', overwrite: true })

      expect(mock.history[0]).toMatchObject({
        method: 'post',
        url: TOKEN_URL,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: { code: 'auth-code', client_id: CLIENT_ID, client_secret: CLIENT_SECRET },
      })

      expect(mock.history[1]).toMatchObject({
        method: 'get',
        url: ME_URL,
        headers: { Authorization: 'Bearer live-token', Accept: 'application/json', 'Intercom-Version': VERSION },
      })
    })

    it('accepts a `token` field when the response has no access_token', async () => {
      mock.onPost(TOKEN_URL).reply({ token: 'alt-token' })
      mock.onGet(ME_URL).reply({ name: 'Ada' })

      const result = await service.executeCallback({ code: 'c' })

      expect(result.token).toBe('alt-token')
    })

    it('falls back to the identity email when no name is present', async () => {
      mock.onPost(TOKEN_URL).reply({ access_token: 't' })
      mock.onGet(ME_URL).reply({ email: 'admin@email.com' })

      await expect(service.executeCallback({ code: 'c' })).resolves.toMatchObject({ connectionIdentityName: 'admin@email.com' })
    })

    it('falls back to the workspace app name when neither name nor email is present', async () => {
      mock.onPost(TOKEN_URL).reply({ access_token: 't' })
      mock.onGet(ME_URL).reply({ app: { name: 'Acme Workspace' } })

      await expect(service.executeCallback({ code: 'c' })).resolves.toMatchObject({ connectionIdentityName: 'Acme Workspace' })
    })

    it('returns a null identity when the /me payload is empty', async () => {
      mock.onPost(TOKEN_URL).reply({ access_token: 't' })
      mock.onGet(ME_URL).reply({})

      await expect(service.executeCallback({ code: 'c' })).resolves.toMatchObject({ connectionIdentityName: null })
    })

    it('still returns the token when the identity lookup fails', async () => {
      mock.onPost(TOKEN_URL).reply({ access_token: 'live-token' })
      mock.onGet(ME_URL).replyWithError({ message: 'Unauthorized', status: 401 })

      const result = await service.executeCallback({ code: 'c' })

      expect(result).toEqual({ token: 'live-token', connectionIdentityName: null, overwrite: true })
    })

    it('propagates a token-exchange failure', async () => {
      mock.onPost(TOKEN_URL).replyWithError({ message: 'invalid_grant', status: 400 })

      await expect(service.executeCallback({ code: 'bad' })).rejects.toThrow('invalid_grant')
      expect(mock.history).toHaveLength(1)
    })
  })

  describe('refreshToken', () => {
    // Intercom issues NO refresh token and exposes NO refresh endpoint — this is a
    // documented no-op passthrough, so there is no "rotated refresh token" branch to cover.
    it('passes the token straight back and calls nothing', async () => {
      await expect(service.refreshToken('long-lived-token')).resolves.toEqual({ token: 'long-lived-token' })
      expect(mock.history).toHaveLength(0)
    })

    it('passes an absent token through unchanged', async () => {
      await expect(service.refreshToken(undefined)).resolves.toEqual({ token: undefined })
    })
  })

  // ==========================================================================
  //  ACTIONS — CONTACTS
  // ==========================================================================

  describe('createContact', () => {
    it('sends only the fields provided, mapping the Role label', async () => {
      mock.onPost(`${ API }/contacts`).reply({ id: 'c1' })

      await service.createContact('joe@intercom.io', 'Joe', 'User', '+353871234567', 'ext-1', 'https://img', 42, false, { plan: 'pro' })

      expect(last()).toMatchObject({ method: 'post', url: `${ API }/contacts` })

      expect(last().body).toEqual({
        email: 'joe@intercom.io',
        name: 'Joe',
        role: 'user',
        phone: '+353871234567',
        external_id: 'ext-1',
        avatar: 'https://img',
        owner_id: 42,
        unsubscribed_from_emails: false,
        custom_attributes: { plan: 'pro' },
      })
    })

    it('omits every unset optional field', async () => {
      mock.onPost(`${ API }/contacts`).reply({ id: 'c1' })

      await service.createContact('joe@intercom.io')

      expect(last().body).toEqual({ email: 'joe@intercom.io' })
    })

    it('accepts an external id alone', async () => {
      mock.onPost(`${ API }/contacts`).reply({ id: 'c1' })

      await service.createContact(null, null, null, null, 'ext-1')

      expect(last().body).toEqual({ external_id: 'ext-1' })
    })

    it('accepts a role alone and passes an unmapped role through', async () => {
      mock.onPost(`${ API }/contacts`).reply({ id: 'c1' })

      await service.createContact(null, null, 'lead')

      expect(last().body).toEqual({ role: 'lead' })
    })

    it('maps the Lead label', async () => {
      mock.onPost(`${ API }/contacts`).reply({ id: 'c1' })

      await service.createContact('a@b.c', null, 'Lead')

      expect(last().body.role).toBe('lead')
    })
  })

  describe('getContactByExternalId', () => {
    it('url-encodes the external reference', async () => {
      mock.onGet(`${ API }/contacts/find_by_external_id/a%2Fb%20c`).reply({ id: 'c1' })

      await expect(service.getContactByExternalId('a/b c')).resolves.toEqual({ id: 'c1' })
      expect(last().url).toBe(`${ API }/contacts/find_by_external_id/a%2Fb%20c`)
    })
  })

  describe('updateContact', () => {
    it('PUTs only the changed fields', async () => {
      mock.onPut(`${ API }/contacts/c1`).reply({ id: 'c1' })

      await service.updateContact('c1', 'new@b.c', 'New Name', 'User', 'ext-9', '+1', 7, true, { a: 1 })

      expect(last()).toMatchObject({ method: 'put', url: `${ API }/contacts/c1` })

      expect(last().body).toEqual({
        email: 'new@b.c',
        name: 'New Name',
        role: 'user',
        external_id: 'ext-9',
        phone: '+1',
        owner_id: 7,
        unsubscribed_from_emails: true,
        custom_attributes: { a: 1 },
      })
    })

    it('sends an empty body when nothing but the id is supplied', async () => {
      mock.onPut(`${ API }/contacts/c1`).reply({ id: 'c1' })

      await service.updateContact('c1')

      expect(last().body).toEqual({})
    })
  })

  describe('contact lifecycle routes', () => {
    it.each([
      ['getContact', ['c1'], 'get', `${ API }/contacts/c1`],
      ['deleteContact', ['c1'], 'delete', `${ API }/contacts/c1`],
      ['archiveContact', ['c1'], 'post', `${ API }/contacts/c1/archive`],
      ['unarchiveContact', ['c1'], 'post', `${ API }/contacts/c1/unarchive`],
      ['listCompanyContacts', ['co1'], 'get', `${ API }/companies/co1/contacts`],
      ['listNotes', ['c1'], 'get', `${ API }/contacts/c1/notes`],
    ])('%s issues %s %s', async (method, args, httpMethod, url) => {
      replyAny({ ok: true })

      await expect(service[method](...args)).resolves.toEqual({ ok: true })
      expect(last()).toMatchObject({ method: httpMethod, url })
    })

    it('archive/unarchive send no body', async () => {
      replyAny()

      await service.archiveContact('c1')

      expect(last().body).toBeUndefined()
    })
  })

  describe('listContacts', () => {
    it('defaults the page size to 50 and omits an empty cursor', async () => {
      mock.onGet(`${ API }/contacts`).reply({ data: [] })

      await service.listContacts()

      expect(last().query).toEqual({ per_page: 50 })
    })

    it('passes an explicit page size and starting_after cursor', async () => {
      mock.onGet(`${ API }/contacts`).reply({ data: [] })

      await service.listContacts(150, 'cursor-abc')

      expect(last().query).toEqual({ per_page: 150, starting_after: 'cursor-abc' })
    })

    it('falls back to the default when the page size is 0', async () => {
      mock.onGet(`${ API }/contacts`).reply({ data: [] })

      await service.listContacts(0)

      expect(last().query).toEqual({ per_page: 50 })
    })
  })

  describe('search query construction', () => {
    it.each([
      ['Equals', '='],
      ['Not equals', '!='],
      ['Less than', '<'],
      ['Greater than', '>'],
      ['Contains', '~'],
      ['Does not contain', '!~'],
      ['Starts with', '^'],
      ['Ends with', '$'],
    ])('maps the %s label to the %s operator with a scalar value', async (label, apiOperator) => {
      mock.onPost(`${ API }/contacts/search`).reply({ data: [] })

      await service.searchContacts('email', label, 'joe@intercom.io')

      expect(last().body).toEqual({
        query: { field: 'email', operator: apiOperator, value: 'joe@intercom.io' },
        pagination: { per_page: 50 },
      })
    })

    it.each([
      ['In list', 'IN'],
      ['Not in list', 'NIN'],
    ])('splits a comma-separated value into an array for %s', async (label, apiOperator) => {
      mock.onPost(`${ API }/contacts/search`).reply({ data: [] })

      await service.searchContacts('role', label, ' user , lead ,, ')

      expect(last().body.query).toEqual({ field: 'role', operator: apiOperator, value: ['user', 'lead'] })
    })

    it('produces an empty list for a list operator with no value', async () => {
      mock.onPost(`${ API }/contacts/search`).reply({ data: [] })

      await service.searchContacts('role', 'In list', null)

      expect(last().body.query.value).toEqual([])
    })

    it('passes an unmapped operator straight through', async () => {
      mock.onPost(`${ API }/contacts/search`).reply({ data: [] })

      await service.searchContacts('email', '=', 'a@b.c')

      expect(last().body.query.operator).toBe('=')
    })

    it('honours an explicit page size', async () => {
      mock.onPost(`${ API }/contacts/search`).reply({ data: [] })

      await service.searchContacts('email', 'Equals', 'a@b.c', 25)

      expect(last().body.pagination).toEqual({ per_page: 25 })
    })

    it('searchConversations posts to the conversations search endpoint', async () => {
      mock.onPost(`${ API }/conversations/search`).reply({ conversations: [] })

      await service.searchConversations('state', 'Equals', 'open')

      expect(last()).toMatchObject({ method: 'post', url: `${ API }/conversations/search` })
      expect(last().body.query).toEqual({ field: 'state', operator: '=', value: 'open' })
    })

    it('searchTickets posts to the tickets search endpoint', async () => {
      mock.onPost(`${ API }/tickets/search`).reply({ tickets: [] })

      await service.searchTickets('open', 'Equals', 'true', 10)

      expect(last()).toMatchObject({ method: 'post', url: `${ API }/tickets/search` })
      expect(last().body).toEqual({ query: { field: 'open', operator: '=', value: 'true' }, pagination: { per_page: 10 } })
    })
  })

  describe('mergeContact', () => {
    it('posts the from/into pair', async () => {
      mock.onPost(`${ API }/contacts/merge`).reply({ id: 'u1' })

      await service.mergeContact('lead-1', 'user-1')

      expect(last()).toMatchObject({ method: 'post', url: `${ API }/contacts/merge`, body: { from: 'lead-1', into: 'user-1' } })
    })
  })

  // ==========================================================================
  //  ACTIONS — COMPANIES
  // ==========================================================================

  describe('createOrUpdateCompany', () => {
    it('sends the full upsert body', async () => {
      mock.onPost(`${ API }/companies`).reply({ id: 'co1' })

      await service.createOrUpdateCompany('remote-1', 'Acme', 'Enterprise', 50, 'https://acme.io', 'SaaS', 1000, { tier: 'a' })

      expect(last().body).toEqual({
        company_id: 'remote-1',
        name: 'Acme',
        plan: 'Enterprise',
        size: 50,
        website: 'https://acme.io',
        industry: 'SaaS',
        monthly_spend: 1000,
        custom_attributes: { tier: 'a' },
      })
    })

    // No guard: the API itself rejects a fully-empty upsert.
    it('sends an empty body when called with no arguments', async () => {
      mock.onPost(`${ API }/companies`).reply({})

      await service.createOrUpdateCompany()

      expect(last().body).toEqual({})
    })
  })

  describe('findCompany', () => {
    it('queries by external company id', async () => {
      mock.onGet(`${ API }/companies`).reply({ id: 'co1' })

      await service.findCompany('remote-1')

      expect(last().query).toEqual({ company_id: 'remote-1' })
    })

    it('queries by name', async () => {
      mock.onGet(`${ API }/companies`).reply({ id: 'co1' })

      await service.findCompany(null, 'Acme')

      expect(last().query).toEqual({ name: 'Acme' })
    })

    it('sends both when both are given', async () => {
      mock.onGet(`${ API }/companies`).reply({ id: 'co1' })

      await service.findCompany('remote-1', 'Acme')

      expect(last().query).toEqual({ company_id: 'remote-1', name: 'Acme' })
    })
  })

  describe('updateCompany', () => {
    it('PUTs the changed fields', async () => {
      mock.onPut(`${ API }/companies/co1`).reply({ id: 'co1' })

      await service.updateCompany('co1', 'Acme 2', 'Pro', 10, 'https://a', 'Retail', 5, { k: 'v' })

      expect(last().body).toEqual({
        name: 'Acme 2',
        plan: 'Pro',
        size: 10,
        website: 'https://a',
        industry: 'Retail',
        monthly_spend: 5,
        custom_attributes: { k: 'v' },
      })
    })
  })

  describe('listCompanies', () => {
    it('POSTs to /companies/list with the default page size', async () => {
      mock.onPost(`${ API }/companies/list`).reply({ data: [] })

      await service.listCompanies()

      expect(last()).toMatchObject({ method: 'post', url: `${ API }/companies/list`, body: { per_page: 50 } })
    })

    it('passes a page number through', async () => {
      mock.onPost(`${ API }/companies/list`).reply({ data: [] })

      await service.listCompanies(20, 3)

      expect(last().body).toEqual({ per_page: 20, page: 3 })
    })
  })

  describe('company membership', () => {
    it('attaches a contact to a company', async () => {
      mock.onPost(`${ API }/contacts/c1/companies`).reply({ id: 'co1' })

      await service.attachContactToCompany('c1', 'co1')

      expect(last()).toMatchObject({ method: 'post', url: `${ API }/contacts/c1/companies`, body: { id: 'co1' } })
    })

    it('detaches a contact from a company', async () => {
      mock.onDelete(`${ API }/contacts/c1/companies/co1`).reply({ id: 'co1' })

      await service.detachContactFromCompany('c1', 'co1')

      expect(last()).toMatchObject({ method: 'delete', url: `${ API }/contacts/c1/companies/co1` })
    })

    it('deletes a company', async () => {
      mock.onDelete(`${ API }/companies/co1`).reply({ deleted: true })

      await expect(service.deleteCompany('co1')).resolves.toEqual({ deleted: true })
      expect(last().method).toBe('delete')
    })

    it('gets a company', async () => {
      mock.onGet(`${ API }/companies/co1`).reply({ id: 'co1' })

      await expect(service.getCompany('co1')).resolves.toEqual({ id: 'co1' })
    })
  })

  // ==========================================================================
  //  ACTIONS — CONVERSATIONS
  // ==========================================================================

  describe('createConversation', () => {
    it('defaults the from-contact type to user', async () => {
      mock.onPost(`${ API }/conversations`).reply({ id: '123' })

      await service.createConversation('c1', null, 'Hello there')

      expect(last().body).toEqual({ from: { type: 'user', id: 'c1' }, body: 'Hello there' })
    })

    it.each([
      ['User', 'user'],
      ['Lead', 'lead'],
      ['Contact', 'contact'],
    ])('maps the %s contact-type label', async (label, apiValue) => {
      mock.onPost(`${ API }/conversations`).reply({ id: '123' })

      await service.createConversation('c1', label, 'Hi', 'Subject line')

      expect(last().body).toEqual({ from: { type: apiValue, id: 'c1' }, body: 'Hi', subject: 'Subject line' })
    })
  })

  describe('listConversations', () => {
    it('defaults the page size and omits the cursor', async () => {
      mock.onGet(`${ API }/conversations`).reply({ conversations: [] })

      await service.listConversations()

      expect(last().query).toEqual({ per_page: 50 })
    })

    it('passes the cursor through', async () => {
      mock.onGet(`${ API }/conversations`).reply({ conversations: [] })

      await service.listConversations(10, 'cur')

      expect(last().query).toEqual({ per_page: 10, starting_after: 'cur' })
    })
  })

  describe('replyToConversation', () => {
    it('builds an admin public reply', async () => {
      mock.onPost(`${ API }/conversations/123/reply`).reply({ id: '123' })

      await service.replyToConversation('123', 'Admin — Public Reply', 'Thanks!', 'a1')

      expect(last()).toMatchObject({ method: 'post', url: `${ API }/conversations/123/reply` })
      expect(last().body).toEqual({ message_type: 'comment', type: 'admin', admin_id: 'a1', body: 'Thanks!' })
    })

    it('builds an admin internal note', async () => {
      mock.onPost(`${ API }/conversations/123/reply`).reply({ id: '123' })

      await service.replyToConversation('123', 'Admin — Internal Note', 'FYI', 'a1')

      expect(last().body.message_type).toBe('note')
    })

    it('builds a reply on behalf of the user', async () => {
      mock.onPost(`${ API }/conversations/123/reply`).reply({ id: '123' })

      await service.replyToConversation('123', 'On Behalf of User', 'Hi', null, 'c1')

      expect(last().body).toEqual({ message_type: 'comment', type: 'user', intercom_user_id: 'c1', body: 'Hi' })
    })

    it('attaches up to 10 attachment urls', async () => {
      mock.onPost(`${ API }/conversations/123/reply`).reply({ id: '123' })

      const urls = Array.from({ length: 10 }, (_, i) => `https://img/${ i }.png`)

      await service.replyToConversation('123', 'Admin — Public Reply', 'Look', 'a1', null, urls)

      expect(last().body.attachment_urls).toEqual(urls)
    })

    it('omits attachment_urls for an empty array', async () => {
      mock.onPost(`${ API }/conversations/123/reply`).reply({ id: '123' })

      await service.replyToConversation('123', 'Admin — Public Reply', 'Hi', 'a1', null, [])

      expect(last().body).not.toHaveProperty('attachment_urls')
    })

    it('rejects more than 10 attachment urls without calling the API', async () => {
      replyAny()

      const urls = Array.from({ length: 11 }, (_, i) => `https://img/${ i }.png`)

      await expect(service.replyToConversation('123', 'Admin — Public Reply', 'x', 'a1', null, urls))
        .rejects.toThrow('At most 10 attachment URLs are allowed.')

      expect(mock.history).toHaveLength(0)
    })

    it('requires an admin for an admin reply', async () => {
      replyAny()

      await expect(service.replyToConversation('123', 'Admin — Public Reply', 'x'))
        .rejects.toThrow('An Admin is required for an admin reply — use Get Admins Dictionary to pick one.')

      expect(mock.history).toHaveLength(0)
    })

    it('requires a contact when replying on behalf of the user', async () => {
      replyAny()

      await expect(service.replyToConversation('123', 'On Behalf of User', 'x'))
        .rejects.toThrow('A User Contact is required to reply on behalf of the user — use Get Contacts Dictionary to pick one.')

      expect(mock.history).toHaveLength(0)
    })

    it('replyToTicket reuses the same reply body builder', async () => {
      mock.onPost(`${ API }/tickets/631/reply`).reply({ id: '99' })

      await service.replyToTicket('631', 'On Behalf of User', 'Hi', null, 'c1', ['https://img/a.png'])

      expect(last()).toMatchObject({ method: 'post', url: `${ API }/tickets/631/reply` })

      expect(last().body).toEqual({
        message_type: 'comment',
        type: 'user',
        intercom_user_id: 'c1',
        body: 'Hi',
        attachment_urls: ['https://img/a.png'],
      })
    })
  })

  describe('conversation parts', () => {
    it('assigns to an admin', async () => {
      mock.onPost(`${ API }/conversations/123/parts`).reply({ id: '123' })

      await service.assignConversation('123', 'a1', 'Admin', 'a2', 'routing')

      expect(last().body).toEqual({
        message_type: 'assignment',
        type: 'admin',
        admin_id: 'a1',
        assignee_id: 'a2',
        body: 'routing',
      })
    })

    it('assigns to a team and omits an absent note', async () => {
      mock.onPost(`${ API }/conversations/123/parts`).reply({ id: '123' })

      await service.assignConversation('123', 'a1', 'Team', 't1')

      expect(last().body).toEqual({ message_type: 'assignment', type: 'team', admin_id: 'a1', assignee_id: 't1' })
    })

    it('accepts assignee 0 (unassign) as a number and as a string', async () => {
      mock.onPost(`${ API }/conversations/123/parts`).reply({ id: '123' })

      await service.assignConversation('123', 'a1', 'Admin', 0)
      expect(last().body.assignee_id).toBe(0)

      await service.assignConversation('123', 'a1', 'Admin', '0')
      expect(last().body.assignee_id).toBe('0')
    })

    it('snoozes a conversation', async () => {
      mock.onPost(`${ API }/conversations/123/parts`).reply({ id: '123' })

      await service.snoozeConversation('123', 'a1', 1673609604)

      expect(last().body).toEqual({ message_type: 'snoozed', admin_id: 'a1', snoozed_until: 1673609604 })
    })

    it('opens a conversation', async () => {
      mock.onPost(`${ API }/conversations/123/parts`).reply({ id: '123' })

      await service.openConversation('123', 'a1')

      expect(last().body).toEqual({ message_type: 'open', admin_id: 'a1' })
    })

    it('closes a conversation with a closing message', async () => {
      mock.onPost(`${ API }/conversations/123/parts`).reply({ id: '123' })

      await service.closeConversation('123', 'a1', 'Resolved')

      expect(last().body).toEqual({ message_type: 'close', type: 'admin', admin_id: 'a1', body: 'Resolved' })
    })

    it('closes a conversation without a message', async () => {
      mock.onPost(`${ API }/conversations/123/parts`).reply({ id: '123' })

      await service.closeConversation('123', 'a1')

      expect(last().body).toEqual({ message_type: 'close', type: 'admin', admin_id: 'a1' })
    })
  })

  describe('attachContactToConversation', () => {
    it('posts the customer envelope', async () => {
      mock.onPost(`${ API }/conversations/123/customers`).reply({ id: '123' })

      await service.attachContactToConversation('123', 'a1', 'c1')

      expect(last().body).toEqual({ admin_id: 'a1', customer: { intercom_user_id: 'c1' } })
    })
  })

  describe('convertConversationToTicket', () => {
    it('posts the ticket type', async () => {
      mock.onPost(`${ API }/conversations/123/convert`).reply({ id: '631' })

      await service.convertConversationToTicket('123', 'tt1')

      expect(last().body).toEqual({ ticket_type_id: 'tt1' })
    })
  })

  // ==========================================================================
  //  ACTIONS — MESSAGING
  // ==========================================================================

  describe('createMessage', () => {
    it('sends an in-app message', async () => {
      mock.onPost(`${ API }/messages`).reply({ id: '403918' })

      await service.createMessage('In-App', 12345, 'User', 'c1', 'Hello there')

      expect(last().body).toEqual({
        message_type: 'in_app',
        from: { type: 'admin', id: 12345 },
        to: { type: 'user', id: 'c1' },
        body: 'Hello there',
      })
    })

    it('sends an email message with subject and template', async () => {
      mock.onPost(`${ API }/messages`).reply({ id: '403918' })

      await service.createMessage('Email', 1, 'Lead', 'c1', '<p>Hi</p>', 'Welcome', 'Personal')

      expect(last().body).toEqual({
        message_type: 'email',
        from: { type: 'admin', id: 1 },
        to: { type: 'lead', id: 'c1' },
        body: '<p>Hi</p>',
        subject: 'Welcome',
        template: 'personal',
      })
    })

    it('maps the Plain email template', async () => {
      mock.onPost(`${ API }/messages`).reply({ id: '1' })

      await service.createMessage('Email', 1, 'User', 'c1', 'x', 'Subj', 'Plain')

      expect(last().body.template).toBe('plain')
    })

    it.each([
      ['no subject', [undefined, 'Plain']],
      ['no template', ['Subj', undefined]],
      ['neither', [undefined, undefined]],
    ])('rejects an email message with %s and issues no HTTP call', async (_label, [subject, template]) => {
      replyAny()

      await expect(service.createMessage('Email', 1, 'User', 'c1', 'body', subject, template))
        .rejects.toThrow('Email messages require a subject and a template.')

      expect(mock.history).toHaveLength(0)
    })
  })

  // ==========================================================================
  //  ACTIONS — TICKETS
  // ==========================================================================

  describe('createTicket', () => {
    it('omits the assignment block when neither assignee is given', async () => {
      mock.onPost(`${ API }/tickets`).reply({ id: '631' })

      await service.createTicket('tt1', 'c1')

      expect(last().body).toEqual({ ticket_type_id: 'tt1', contacts: [{ id: 'c1' }] })
    })

    it('includes an admin assignment', async () => {
      mock.onPost(`${ API }/tickets`).reply({ id: '631' })

      await service.createTicket('tt1', 'c1', 'co1', 'a1', null, { _default_title_: 'Bug' })

      expect(last().body).toEqual({
        ticket_type_id: 'tt1',
        contacts: [{ id: 'c1' }],
        company_id: 'co1',
        ticket_attributes: { _default_title_: 'Bug' },
        assignment: { admin_assignee_id: 'a1' },
      })
    })

    it('includes a team assignment', async () => {
      mock.onPost(`${ API }/tickets`).reply({ id: '631' })

      await service.createTicket('tt1', 'c1', null, null, 't1')

      expect(last().body.assignment).toEqual({ team_assignee_id: 't1' })
    })

    it('includes both assignees when both are given', async () => {
      mock.onPost(`${ API }/tickets`).reply({ id: '631' })

      await service.createTicket('tt1', 'c1', null, 'a1', 't1')

      expect(last().body.assignment).toEqual({ admin_assignee_id: 'a1', team_assignee_id: 't1' })
    })
  })

  describe('updateTicket', () => {
    it('PUTs every supplied field', async () => {
      mock.onPut(`${ API }/tickets/631`).reply({ id: '631' })

      await service.updateTicket('631', 'st1', false, true, 'a1', 'co1', { k: 'v' })

      expect(last()).toMatchObject({ method: 'put', url: `${ API }/tickets/631` })

      expect(last().body).toEqual({
        ticket_state_id: 'st1',
        open: false,
        is_shared: true,
        assignee_id: 'a1',
        company_id: 'co1',
        ticket_attributes: { k: 'v' },
      })
    })

    it('sends an empty body when only the ticket is supplied', async () => {
      mock.onPut(`${ API }/tickets/631`).reply({ id: '631' })

      await service.updateTicket('631')

      expect(last().body).toEqual({})
    })
  })

  describe('ticket reads and deletes', () => {
    it('gets a ticket', async () => {
      mock.onGet(`${ API }/tickets/631`).reply({ id: '631' })

      await expect(service.getTicket('631')).resolves.toEqual({ id: '631' })
    })

    it('deletes a ticket', async () => {
      mock.onDelete(`${ API }/tickets/631`).reply({ deleted: true })

      await expect(service.deleteTicket('631')).resolves.toEqual({ deleted: true })
    })
  })

  // ==========================================================================
  //  ACTIONS — ADMINS & TEAMS
  // ==========================================================================

  describe('admins and teams', () => {
    it('lists admins', async () => {
      mock.onGet(`${ API }/admins`).reply({ admins: [] })

      await expect(service.listAdmins()).resolves.toEqual({ admins: [] })
      expect(last().query).toEqual({})
    })

    it('gets an admin', async () => {
      mock.onGet(`${ API }/admins/a1`).reply({ id: 'a1' })

      await expect(service.getAdmin('a1')).resolves.toEqual({ id: 'a1' })
    })

    it('lists teams', async () => {
      mock.onGet(`${ API }/teams`).reply({ teams: [] })

      await expect(service.listTeams()).resolves.toEqual({ teams: [] })
    })

    it('gets a team', async () => {
      mock.onGet(`${ API }/teams/t1`).reply({ id: 't1' })

      await expect(service.getTeam('t1')).resolves.toEqual({ id: 't1' })
    })
  })

  describe('setAdminAway', () => {
    it('defaults the reassign flag to false', async () => {
      mock.onPut(`${ API }/admins/a1/away`).reply({ id: 'a1' })

      await service.setAdminAway('a1', true)

      expect(last()).toMatchObject({ method: 'put', url: `${ API }/admins/a1/away` })
      expect(last().body).toEqual({ away_mode_enabled: true, away_mode_reassign: false })
    })

    it('coerces both flags to booleans', async () => {
      mock.onPut(`${ API }/admins/a1/away`).reply({ id: 'a1' })

      await service.setAdminAway('a1', 'yes', 1)

      expect(last().body).toEqual({ away_mode_enabled: true, away_mode_reassign: true })
    })

    it('accepts false as an explicit away state', async () => {
      mock.onPut(`${ API }/admins/a1/away`).reply({ id: 'a1' })

      await service.setAdminAway('a1', false, false)

      expect(last().body).toEqual({ away_mode_enabled: false, away_mode_reassign: false })
    })
  })

  // ==========================================================================
  //  ACTIONS — TAGS
  // ==========================================================================

  describe('tags', () => {
    it('creates a tag by name', async () => {
      mock.onPost(`${ API }/tags`).reply({ id: '1' })

      await service.createOrUpdateTag('Independent')

      expect(last().body).toEqual({ name: 'Independent' })
    })

    it('renames a tag when an id is supplied', async () => {
      mock.onPost(`${ API }/tags`).reply({ id: '1' })

      await service.createOrUpdateTag('Renamed', '656452352')

      expect(last().body).toEqual({ name: 'Renamed', id: '656452352' })
    })

    it('gets and deletes a tag', async () => {
      mock.onGet(`${ API }/tags/1`).reply({ id: '1' })
      mock.onDelete(`${ API }/tags/1`).reply({ deleted: true })

      await expect(service.getTag('1')).resolves.toEqual({ id: '1' })
      await expect(service.deleteTag('1')).resolves.toEqual({ deleted: true })
    })

    it('tags and untags a contact', async () => {
      mock.onPost(`${ API }/contacts/c1/tags`).reply({ id: '81' })
      mock.onDelete(`${ API }/contacts/c1/tags/81`).reply({ id: '81' })

      await service.tagContact('c1', '81')
      expect(last()).toMatchObject({ method: 'post', body: { id: '81' } })

      await service.untagContact('c1', '81')
      expect(last()).toMatchObject({ method: 'delete', url: `${ API }/contacts/c1/tags/81` })
    })

    it('tags a company by name', async () => {
      mock.onPost(`${ API }/tags`).reply({ id: '1' })

      await service.tagCompany('VIP', 'co1')

      expect(last().body).toEqual({ name: 'VIP', companies: [{ id: 'co1' }] })
    })

    it('untags a company with the untag flag', async () => {
      mock.onPost(`${ API }/tags`).reply({ id: '1' })

      await service.untagCompany('VIP', 'co1')

      expect(last().body).toEqual({ name: 'VIP', companies: [{ id: 'co1', untag: true }] })
    })

    it('tags a conversation on behalf of an admin', async () => {
      mock.onPost(`${ API }/conversations/123/tags`).reply({ id: '86' })

      await service.tagConversation('123', '86', 'a1')

      expect(last().body).toEqual({ id: '86', admin_id: 'a1' })
    })

    it('untags a conversation with a DELETE carrying the acting admin', async () => {
      mock.onDelete(`${ API }/conversations/123/tags/86`).reply({ id: '86' })

      await service.untagConversation('123', '86', 'a1')

      expect(last()).toMatchObject({ method: 'delete', url: `${ API }/conversations/123/tags/86`, body: { admin_id: 'a1' } })
      expect(last().headers['Content-Type']).toBe('application/json')
    })
  })

  // ==========================================================================
  //  ACTIONS — SEGMENTS, NOTES, EVENTS
  // ==========================================================================

  describe('segments', () => {
    it('omits include_count when unset', async () => {
      mock.onGet(`${ API }/segments`).reply({ segments: [] })

      await service.listSegments()

      expect(last().query).toEqual({})
    })

    it.each([
      [true, true],
      [false, false],
      [1, true],
    ])('coerces include_count %p to %p', async (input, expected) => {
      mock.onGet(`${ API }/segments`).reply({ segments: [] })

      await service.listSegments(input)

      expect(last().query).toEqual({ include_count: expected })
    })

    it('gets a segment', async () => {
      mock.onGet(`${ API }/segments/s1`).reply({ id: 's1' })

      await expect(service.getSegment('s1')).resolves.toEqual({ id: 's1' })
    })
  })

  describe('notes', () => {
    it('creates a note with an author', async () => {
      mock.onPost(`${ API }/contacts/c1/notes`).reply({ id: '31' })

      await service.createNote('c1', 'Hello', 'a1')

      expect(last().body).toEqual({ body: 'Hello', admin_id: 'a1' })
    })

    it('creates a note without an author', async () => {
      mock.onPost(`${ API }/contacts/c1/notes`).reply({ id: '31' })

      await service.createNote('c1', 'Hello')

      expect(last().body).toEqual({ body: 'Hello' })
    })

    it('gets a note by id, ignoring the contact picker argument', async () => {
      mock.onGet(`${ API }/notes/31`).reply({ id: '31' })

      await expect(service.getNote('c1', '31')).resolves.toEqual({ id: '31' })
      expect(last().url).toBe(`${ API }/notes/31`)
    })

    it('gets a note even with no contact supplied', async () => {
      mock.onGet(`${ API }/notes/31`).reply({ id: '31' })

      await expect(service.getNote(null, '31')).resolves.toEqual({ id: '31' })
    })
  })

  describe('submitEvent', () => {
    it.each([
      ['Your User ID', 'user_id'],
      ['Intercom Contact ID', 'id'],
      ['Email', 'email'],
    ])('maps the %s identifier label to %s', async (label, key) => {
      mock.onPost(`${ API }/events`).reply(undefined)

      await service.submitEvent('invited-friend', label, 'value-1', 1670000000)

      expect(last().body).toEqual({ event_name: 'invited-friend', created_at: 1670000000, [key]: 'value-1' })
    })

    it('defaults created_at to now and includes metadata', async () => {
      jest.spyOn(Date, 'now').mockReturnValue(NOW * 1000)
      mock.onPost(`${ API }/events`).reply(undefined)

      await service.submitEvent('invited-friend', 'Email', 'a@b.c', null, { invite_code: 'X' })

      expect(last().body).toEqual({
        event_name: 'invited-friend',
        created_at: NOW,
        email: 'a@b.c',
        metadata: { invite_code: 'X' },
      })
    })

    it('reports a stable accepted shape despite the empty 202 body', async () => {
      mock.onPost(`${ API }/events`).reply(undefined)

      await expect(service.submitEvent('e', 'Email', 'a@b.c')).resolves.toEqual({ status: 'accepted' })
    })
  })

  describe('listEvents', () => {
    it.each([
      ['Your User ID', 'user_id'],
      ['Intercom Contact ID', 'intercom_user_id'],
      ['Email', 'email'],
    ])('maps the %s identifier label to %s', async (label, key) => {
      mock.onGet(`${ API }/events`).reply({ events: [] })

      await service.listEvents(label, 'value-1')

      expect(last().query).toEqual({ type: 'user', [key]: 'value-1' })
    })
  })

  // ==========================================================================
  //  ACTIONS — DATA ATTRIBUTES
  // ==========================================================================

  describe('listDataAttributes', () => {
    it('sends no query when nothing is set', async () => {
      mock.onGet(`${ API }/data_attributes`).reply({ data: [] })

      await service.listDataAttributes()

      expect(last().query).toEqual({})
    })

    it.each([
      ['Contact', 'contact'],
      ['Company', 'company'],
      ['Conversation', 'conversation'],
    ])('maps the %s model label', async (label, apiValue) => {
      mock.onGet(`${ API }/data_attributes`).reply({ data: [] })

      await service.listDataAttributes(label, true)

      expect(last().query).toEqual({ model: apiValue, include_archived: true })
    })

    it('coerces include_archived false', async () => {
      mock.onGet(`${ API }/data_attributes`).reply({ data: [] })

      await service.listDataAttributes(null, false)

      expect(last().query).toEqual({ include_archived: false })
    })
  })

  describe('createDataAttribute', () => {
    it.each([
      ['Text', 'string'],
      ['Integer', 'integer'],
      ['Decimal', 'float'],
      ['True/False', 'boolean'],
      ['Date', 'date'],
      ['Date & Time', 'datetime'],
    ])('maps the %s data-type label to %s and omits options', async (label, apiValue) => {
      mock.onPost(`${ API }/data_attributes`).reply({ id: '123' })

      await service.createDataAttribute('My Attr', 'Contact', label)

      expect(last().body).toEqual({ name: 'My Attr', model: 'contact', data_type: apiValue })
    })

    it('wraps option values for a List attribute', async () => {
      mock.onPost(`${ API }/data_attributes`).reply({ id: '123' })

      await service.createDataAttribute('Size', 'Company', 'List (Options)', 'Bucket', true, ['1-10', '11-50'])

      expect(last().body).toEqual({
        name: 'Size',
        model: 'company',
        data_type: 'options',
        description: 'Bucket',
        messenger_writable: true,
        options: [{ value: '1-10' }, { value: '11-50' }],
      })
    })

    it('ignores options for a non-list data type', async () => {
      mock.onPost(`${ API }/data_attributes`).reply({ id: '123' })

      await service.createDataAttribute('Name', 'Contact', 'Text', null, null, ['a', 'b'])

      expect(last().body).not.toHaveProperty('options')
    })

    it('ignores a non-array options value for a List attribute', async () => {
      mock.onPost(`${ API }/data_attributes`).reply({ id: '123' })

      await service.createDataAttribute('Size', 'Contact', 'List (Options)', null, null, 'a,b')

      expect(last().body).not.toHaveProperty('options')
    })
  })

  describe('updateDataAttribute', () => {
    it('sends only the supplied fields, wrapping options', async () => {
      mock.onPut(`${ API }/data_attributes/123`).reply({ id: '123' })

      await service.updateDataAttribute('123', true, 'New desc', false, ['x'])

      expect(last()).toMatchObject({ method: 'put', url: `${ API }/data_attributes/123` })

      expect(last().body).toEqual({
        archived: true,
        description: 'New desc',
        messenger_writable: false,
        options: [{ value: 'x' }],
      })
    })

    it('sends an empty body when only the id is supplied', async () => {
      mock.onPut(`${ API }/data_attributes/123`).reply({ id: '123' })

      await service.updateDataAttribute('123')

      expect(last().body).toEqual({})
    })

    it('coerces truthy archived/messenger flags to booleans', async () => {
      mock.onPut(`${ API }/data_attributes/123`).reply({ id: '123' })

      await service.updateDataAttribute('123', 1, null, 'yes')

      expect(last().body).toEqual({ archived: true, messenger_writable: true })
    })
  })

  // ==========================================================================
  //  ACTIONS — HELP CENTER
  // ==========================================================================

  describe('createArticle', () => {
    it('sends only title and author when nothing else is given', async () => {
      mock.onPost(`${ API }/articles`).reply({ id: '6871119' })

      await service.createArticle('Thanks', 1295)

      expect(last().body).toEqual({ title: 'Thanks', author_id: 1295 })
    })

    it.each([
      ['Draft', 'draft'],
      ['Published', 'published'],
    ])('maps the %s state label', async (label, apiValue) => {
      mock.onPost(`${ API }/articles`).reply({ id: '1' })

      await service.createArticle('T', 1, '<p>x</p>', 'desc', label, 18, 'Collection')

      expect(last().body).toEqual({
        title: 'T',
        author_id: 1,
        body: '<p>x</p>',
        description: 'desc',
        state: apiValue,
        parent_id: 18,
        parent_type: 'collection',
      })
    })

    it('maps the Section parent-type label', async () => {
      mock.onPost(`${ API }/articles`).reply({ id: '1' })

      await service.createArticle('T', 1, null, null, null, 18, 'Section')

      expect(last().body.parent_type).toBe('section')
    })
  })

  describe('article reads and writes', () => {
    it('gets an article', async () => {
      mock.onGet(`${ API }/articles/1`).reply({ id: '1' })

      await expect(service.getArticle('1')).resolves.toEqual({ id: '1' })
    })

    it('updates an article', async () => {
      mock.onPut(`${ API }/articles/1`).reply({ id: '1' })

      await service.updateArticle('1', 'New', '<p>b</p>', 'd', 'Published', 42)

      expect(last().body).toEqual({ title: 'New', body: '<p>b</p>', description: 'd', state: 'published', author_id: 42 })
    })

    it('updates an article with no changed fields', async () => {
      mock.onPut(`${ API }/articles/1`).reply({ id: '1' })

      await service.updateArticle('1')

      expect(last().body).toEqual({})
    })

    it('deletes an article', async () => {
      mock.onDelete(`${ API }/articles/1`).reply({ deleted: true })

      await expect(service.deleteArticle('1')).resolves.toEqual({ deleted: true })
    })

    it('lists articles with cursor pagination', async () => {
      mock.onGet(`${ API }/articles`).reply({ data: [] })

      await service.listArticles(25, 'cur')

      expect(last().query).toEqual({ per_page: 25, starting_after: 'cur' })
    })

    it('lists articles with defaults', async () => {
      mock.onGet(`${ API }/articles`).reply({ data: [] })

      await service.listArticles()

      expect(last().query).toEqual({ per_page: 50 })
    })

    it('searches articles by phrase only', async () => {
      mock.onGet(`${ API }/articles/search`).reply({ data: {} })

      await service.searchArticles('pricing')

      expect(last().query).toEqual({ phrase: 'pricing' })
    })

    it('searches articles limited to a state', async () => {
      mock.onGet(`${ API }/articles/search`).reply({ data: {} })

      await service.searchArticles('pricing', 'Published')

      expect(last().query).toEqual({ phrase: 'pricing', state: 'published' })
    })
  })

  describe('collections', () => {
    it('creates a top-level collection', async () => {
      mock.onPost(`${ API }/help_center/collections`).reply({ id: '1' })

      await service.createCollection('Getting started')

      expect(last().body).toEqual({ name: 'Getting started' })
    })

    it('creates a nested collection', async () => {
      mock.onPost(`${ API }/help_center/collections`).reply({ id: '1' })

      await service.createCollection('Sub', 'desc', 'parent-1')

      expect(last().body).toEqual({ name: 'Sub', description: 'desc', parent_id: 'parent-1' })
    })

    it('gets a collection', async () => {
      mock.onGet(`${ API }/help_center/collections/1`).reply({ id: '1' })

      await expect(service.getCollection('1')).resolves.toEqual({ id: '1' })
    })

    it('updates a collection', async () => {
      mock.onPut(`${ API }/help_center/collections/1`).reply({ id: '1' })

      await service.updateCollection('1', 'New', 'desc', 'p1')

      expect(last().body).toEqual({ name: 'New', description: 'desc', parent_id: 'p1' })
    })

    it('updates a collection with no changed fields', async () => {
      mock.onPut(`${ API }/help_center/collections/1`).reply({ id: '1' })

      await service.updateCollection('1')

      expect(last().body).toEqual({})
    })

    it('deletes a collection', async () => {
      mock.onDelete(`${ API }/help_center/collections/1`).reply({ deleted: true })

      await expect(service.deleteCollection('1')).resolves.toEqual({ deleted: true })
    })

    it('lists collections with defaults and with a cursor', async () => {
      mock.onGet(`${ API }/help_center/collections`).reply({ data: [] })

      await service.listCollections()
      expect(last().query).toEqual({ per_page: 50 })

      await service.listCollections(10, 'cur')
      expect(last().query).toEqual({ per_page: 10, starting_after: 'cur' })
    })
  })

  // ==========================================================================
  //  ACTIONS — SUBSCRIPTIONS & VISITORS
  // ==========================================================================

  describe('subscriptions', () => {
    it('lists subscription types', async () => {
      mock.onGet(`${ API }/subscription_types`).reply({ data: [] })

      await expect(service.listSubscriptionTypes()).resolves.toEqual({ data: [] })
    })

    it.each([
      ['Opt In', 'opt_in'],
      ['Opt Out', 'opt_out'],
    ])('maps the %s consent label', async (label, apiValue) => {
      mock.onPost(`${ API }/contacts/c1/subscriptions`).reply({ id: '37846' })

      await service.attachSubscription('c1', '37846', label)

      expect(last().body).toEqual({ id: '37846', consent_type: apiValue })
    })

    it('detaches a subscription', async () => {
      mock.onDelete(`${ API }/contacts/c1/subscriptions/37846`).reply({ id: '37846' })

      await service.detachSubscription('c1', '37846')

      expect(last()).toMatchObject({ method: 'delete', url: `${ API }/contacts/c1/subscriptions/37846` })
    })
  })

  describe('visitors', () => {
    it('gets a visitor by user_id query param', async () => {
      mock.onGet(`${ API }/visitors`).reply({ id: 'v1' })

      await service.getVisitor('anon-1')

      expect(last()).toMatchObject({ method: 'get', url: `${ API }/visitors`, query: { user_id: 'anon-1' } })
    })

    it('updates a visitor', async () => {
      mock.onPut(`${ API }/visitors`).reply({ id: 'v1' })

      await service.updateVisitor('anon-1', 'Christian Bale', { a: 1 })

      expect(last().body).toEqual({ user_id: 'anon-1', name: 'Christian Bale', custom_attributes: { a: 1 } })
    })

    it('updates a visitor with only the user_id', async () => {
      mock.onPut(`${ API }/visitors`).reply({ id: 'v1' })

      await service.updateVisitor('anon-1')

      expect(last().body).toEqual({ user_id: 'anon-1' })
    })

    it.each([
      ['Lead', 'lead'],
      ['User', 'user'],
    ])('converts a visitor to a %s', async (label, apiValue) => {
      mock.onPost(`${ API }/visitors/convert`).reply({ id: 'c1' })

      await service.convertVisitor('anon-1', label, 'target-1')

      expect(last().body).toEqual({
        type: apiValue,
        user: { user_id: 'target-1' },
        visitor: { user_id: 'anon-1' },
      })
    })
  })

  // ==========================================================================
  //  DICTIONARIES
  // ==========================================================================

  describe('getContactsDictionary', () => {
    it('lists contacts when no search term is given', async () => {
      mock.onGet(`${ API }/contacts`).reply({
        data: [{ id: 'c1', name: 'Joe Bloggs', email: 'joe@intercom.io' }],
        pages: { next: { starting_after: 'next-cur' } },
      })

      const result = await service.getContactsDictionary({})

      expect(last()).toMatchObject({ method: 'get', url: `${ API }/contacts`, query: { per_page: 50 } })

      expect(result).toEqual({
        items: [{ label: 'Joe Bloggs', value: 'c1', note: 'joe@intercom.io' }],
        cursor: 'next-cur',
      })
    })

    it('passes the cursor as starting_after when listing', async () => {
      mock.onGet(`${ API }/contacts`).reply({ data: [] })

      await service.getContactsDictionary({ cursor: 'cur-1' })

      expect(last().query).toEqual({ per_page: 50, starting_after: 'cur-1' })
    })

    it('searches name OR email when a search term is given', async () => {
      mock.onPost(`${ API }/contacts/search`).reply({ data: [{ id: 'c1', name: 'Joe' }] })

      const result = await service.getContactsDictionary({ search: 'joe', cursor: 'cur-1' })

      expect(last()).toMatchObject({ method: 'post', url: `${ API }/contacts/search` })

      expect(last().body).toEqual({
        query: {
          operator: 'OR',
          value: [
            { field: 'name', operator: '~', value: 'joe' },
            { field: 'email', operator: '~', value: 'joe' },
          ],
        },
        pagination: { per_page: 50, starting_after: 'cur-1' },
      })

      expect(result.items).toEqual([{ label: 'Joe', value: 'c1', note: '' }])
    })

    it('falls back through name → email → id for the label and role for the note', async () => {
      mock.onGet(`${ API }/contacts`).reply({
        data: [
          { id: 'c1', email: 'only@email.io' },
          { id: 'c2', role: 'lead' },
        ],
      })

      const result = await service.getContactsDictionary(null)

      expect(result.items).toEqual([
        { label: 'only@email.io', value: 'c1', note: 'only@email.io' },
        { label: 'c2', value: 'c2', note: 'lead' },
      ])

      expect(result.cursor).toBeNull()
    })

    it('returns an empty list when the payload has no data', async () => {
      mock.onGet(`${ API }/contacts`).reply({})

      await expect(service.getContactsDictionary({})).resolves.toEqual({ items: [], cursor: null })
    })

    it('returns an empty list when the response itself is empty', async () => {
      mock.onGet(`${ API }/contacts`).reply(undefined)

      await expect(service.getContactsDictionary({})).resolves.toEqual({ items: [], cursor: null })
    })
  })

  describe('getCompaniesDictionary', () => {
    it('maps companies and derives a numeric next-page cursor from an object', async () => {
      mock.onPost(`${ API }/companies/list`).reply({
        data: [{ id: 'co1', name: 'Acme', company_id: 'remote-1' }],
        pages: { next: { page: 2 } },
      })

      const result = await service.getCompaniesDictionary({})

      expect(last().body).toEqual({ per_page: 50 })
      expect(result).toEqual({ items: [{ label: 'Acme', value: 'co1', note: 'remote-1' }], cursor: '2' })
    })

    it('derives the cursor from a scalar next value', async () => {
      mock.onPost(`${ API }/companies/list`).reply({ data: [], pages: { next: 3 } })

      await expect(service.getCompaniesDictionary({})).resolves.toEqual({ items: [], cursor: '3' })
    })

    it('returns a null cursor when pages.next is absent', async () => {
      mock.onPost(`${ API }/companies/list`).reply({ data: [], pages: {} })

      await expect(service.getCompaniesDictionary({})).resolves.toEqual({ items: [], cursor: null })
    })

    // KNOWN SERVICE BUG (services/intercom/src/index.js — getCompaniesDictionary):
    //   const nextCursor = typeof nextPage === 'object' ? (nextPage.page || null) : (nextPage || null)
    // `typeof null === 'object'`, so an explicit `pages.next: null` — which is exactly what
    // Intercom returns on the LAST page of a list response — dereferences null and throws
    // "Cannot read properties of null (reading 'page')". The picker therefore fails whenever
    // the workspace's companies fit in (or reach) a single page. The fix is a null guard, e.g.
    //   nextPage && typeof nextPage === 'object' ? ... : (nextPage || null)
    // This test pins the CURRENT (buggy) behaviour and must be inverted once the service is fixed.
    it('throws on an explicit pages.next of null (known service bug)', async () => {
      mock.onPost(`${ API }/companies/list`).reply({ data: [], pages: { next: null } })

      await expect(service.getCompaniesDictionary({})).rejects.toThrow(
        "Cannot read properties of null (reading 'page')"
      )
    })

    it('converts the cursor to a page number on the request', async () => {
      mock.onPost(`${ API }/companies/list`).reply({ data: [] })

      await service.getCompaniesDictionary({ cursor: '4' })

      expect(last().body).toEqual({ per_page: 50, page: 4 })
    })

    it('filters locally by a case-insensitive name search', async () => {
      mock.onPost(`${ API }/companies/list`).reply({
        data: [{ id: 'co1', name: 'Acme' }, { id: 'co2', name: 'Globex' }],
      })

      const result = await service.getCompaniesDictionary({ search: 'ACM' })

      expect(result.items).toEqual([{ label: 'Acme', value: 'co1', note: '' }])
    })

    it('falls back to company_id then id for the label', async () => {
      mock.onPost(`${ API }/companies/list`).reply({
        data: [{ id: 'co1', company_id: 'remote-1' }, { id: 'co2' }],
      })

      const result = await service.getCompaniesDictionary(null)

      expect(result.items).toEqual([
        { label: 'remote-1', value: 'co1', note: 'remote-1' },
        { label: 'co2', value: 'co2', note: '' },
      ])
    })

    it('handles an empty response', async () => {
      mock.onPost(`${ API }/companies/list`).reply(undefined)

      await expect(service.getCompaniesDictionary({})).resolves.toEqual({ items: [], cursor: null })
    })
  })

  describe('getConversationsDictionary', () => {
    it('maps conversations to #id labels with the state as the note', async () => {
      mock.onGet(`${ API }/conversations`).reply({
        conversations: [{ id: 123, state: 'open', title: 'Refund' }],
        pages: { next: { starting_after: 'cur-2' } },
      })

      const result = await service.getConversationsDictionary({ cursor: 'cur-1' })

      expect(last().query).toEqual({ per_page: 50, starting_after: 'cur-1' })

      expect(result).toEqual({
        items: [{ label: '#123 — Refund', value: '123', note: 'open' }],
        cursor: 'cur-2',
      })
    })

    it('omits the title suffix when there is no title', async () => {
      mock.onGet(`${ API }/conversations`).reply({ conversations: [{ id: 9 }] })

      const result = await service.getConversationsDictionary({})

      expect(result.items).toEqual([{ label: '#9', value: '9', note: '' }])
    })

    it('filters by id substring', async () => {
      mock.onGet(`${ API }/conversations`).reply({ conversations: [{ id: 123 }, { id: 456 }] })

      const result = await service.getConversationsDictionary({ search: '45' })

      expect(result.items).toEqual([{ label: '#456', value: '456', note: '' }])
    })

    it('filters by title', async () => {
      mock.onGet(`${ API }/conversations`).reply({ conversations: [{ id: 1, title: 'Refund' }, { id: 2, title: 'Billing' }] })

      const result = await service.getConversationsDictionary({ search: 'refund' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('1')
    })

    it('filters by the source subject when there is no title', async () => {
      mock.onGet(`${ API }/conversations`).reply({
        conversations: [{ id: 1, source: { subject: 'Invoice question' } }, { id: 2 }],
      })

      const result = await service.getConversationsDictionary({ search: 'invoice' })

      expect(result.items).toEqual([{ label: '#1', value: '1', note: '' }])
    })

    it('handles an empty response', async () => {
      mock.onGet(`${ API }/conversations`).reply({})

      await expect(service.getConversationsDictionary(null)).resolves.toEqual({ items: [], cursor: null })
    })
  })

  describe('getAdminsDictionary', () => {
    it('maps admins with the email as the note', async () => {
      mock.onGet(`${ API }/admins`).reply({ admins: [{ id: 991267460, name: 'Ciaran Lee', email: 'admin@email.com' }] })

      await expect(service.getAdminsDictionary({})).resolves.toEqual({
        items: [{ label: 'Ciaran Lee', value: '991267460', note: 'admin@email.com' }],
        cursor: null,
      })
    })

    it('filters case-insensitively across name and email', async () => {
      mock.onGet(`${ API }/admins`).reply({
        admins: [{ id: 1, name: 'Ada', email: 'ada@x.io' }, { id: 2, name: 'Bob', email: 'bob@y.io' }],
      })

      const result = await service.getAdminsDictionary({ search: 'Y.IO' })

      expect(result.items).toEqual([{ label: 'Bob', value: '2', note: 'bob@y.io' }])
    })

    it('falls back to email then id for the label', async () => {
      mock.onGet(`${ API }/admins`).reply({ admins: [{ id: 1, email: 'a@x.io' }, { id: 2 }] })

      const result = await service.getAdminsDictionary(null)

      expect(result.items).toEqual([
        { label: 'a@x.io', value: '1', note: 'a@x.io' },
        { label: '2', value: '2', note: '' },
      ])
    })

    it('handles an empty response', async () => {
      mock.onGet(`${ API }/admins`).reply(undefined)

      await expect(service.getAdminsDictionary({})).resolves.toEqual({ items: [], cursor: null })
    })
  })

  describe('getTeamsDictionary', () => {
    it('maps teams and filters locally', async () => {
      mock.onGet(`${ API }/teams`).reply({ teams: [{ id: 814865, name: 'Support' }, { id: 2, name: 'Sales' }] })

      await expect(service.getTeamsDictionary({ search: 'sup' })).resolves.toEqual({
        items: [{ label: 'Support', value: '814865', note: '' }],
        cursor: null,
      })
    })

    it('falls back to the id for an unnamed team', async () => {
      mock.onGet(`${ API }/teams`).reply({ teams: [{ id: 7 }] })

      const result = await service.getTeamsDictionary(null)

      expect(result.items).toEqual([{ label: '7', value: '7', note: '' }])
    })

    it('handles an empty response', async () => {
      mock.onGet(`${ API }/teams`).reply({})

      await expect(service.getTeamsDictionary({})).resolves.toEqual({ items: [], cursor: null })
    })
  })

  describe('getAssigneesDictionary', () => {
    it('combines admins and teams with disambiguating notes', async () => {
      mock.onGet(`${ API }/admins`).reply({ admins: [{ id: 1, name: 'Ada', email: 'ada@x.io' }, { id: 2, name: 'NoMail' }] })
      mock.onGet(`${ API }/teams`).reply({ teams: [{ id: 9, name: 'Support' }] })

      const result = await service.getAssigneesDictionary({})

      expect(result).toEqual({
        items: [
          { label: 'Ada', value: '1', note: 'Admin · ada@x.io' },
          { label: 'NoMail', value: '2', note: 'Admin' },
          { label: 'Support', value: '9', note: 'Team' },
        ],
        cursor: null,
      })
    })

    it('applies the search term to both lists', async () => {
      mock.onGet(`${ API }/admins`).reply({ admins: [{ id: 1, name: 'Ada' }, { id: 2, name: 'Bob' }] })
      mock.onGet(`${ API }/teams`).reply({ teams: [{ id: 9, name: 'Adamant' }, { id: 10, name: 'Sales' }] })

      const result = await service.getAssigneesDictionary({ search: 'ad' })

      expect(result.items.map(item => item.value)).toEqual(['1', '9'])
    })

    it('falls back to ids and handles empty responses', async () => {
      mock.onGet(`${ API }/admins`).reply({})
      mock.onGet(`${ API }/teams`).reply({ teams: [{ id: 9 }] })

      await expect(service.getAssigneesDictionary(null)).resolves.toEqual({
        items: [{ label: '9', value: '9', note: 'Team' }],
        cursor: null,
      })
    })
  })

  describe('getTagsDictionary', () => {
    it('maps and filters tags', async () => {
      mock.onGet(`${ API }/tags`).reply({ data: [{ id: 1, name: 'Independent' }, { id: 2, name: 'VIP' }] })

      await expect(service.getTagsDictionary({ search: 'vip' })).resolves.toEqual({
        items: [{ label: 'VIP', value: '2', note: '' }],
        cursor: null,
      })
    })

    it('falls back to the id for an unnamed tag and handles an empty response', async () => {
      mock.onGet(`${ API }/tags`).reply({ data: [{ id: 5 }] })

      await expect(service.getTagsDictionary(null)).resolves.toEqual({
        items: [{ label: '5', value: '5', note: '' }],
        cursor: null,
      })
    })

    it('handles a missing data array', async () => {
      mock.onGet(`${ API }/tags`).reply(undefined)

      await expect(service.getTagsDictionary({})).resolves.toEqual({ items: [], cursor: null })
    })
  })

  describe('getTicketTypesDictionary', () => {
    it('maps ticket types with the category as the note', async () => {
      mock.onGet(`${ API }/ticket_types`).reply({ data: [{ id: 1234, name: 'Bug Report', category: 'Customer' }] })

      await expect(service.getTicketTypesDictionary({})).resolves.toEqual({
        items: [{ label: 'Bug Report', value: '1234', note: 'Customer' }],
        cursor: null,
      })
    })

    it('filters locally and falls back to the id', async () => {
      mock.onGet(`${ API }/ticket_types`).reply({ data: [{ id: 1, name: 'Bug' }, { id: 2 }] })

      await expect(service.getTicketTypesDictionary({ search: 'bug' })).resolves.toEqual({
        items: [{ label: 'Bug', value: '1', note: '' }],
        cursor: null,
      })

      await expect(service.getTicketTypesDictionary(null)).resolves.toMatchObject({
        items: [
          { label: 'Bug', value: '1' },
          { label: '2', value: '2' },
        ],
      })
    })

    it('handles an empty response', async () => {
      mock.onGet(`${ API }/ticket_types`).reply({})

      await expect(service.getTicketTypesDictionary({})).resolves.toEqual({ items: [], cursor: null })
    })
  })

  describe('getTicketStatesDictionary', () => {
    it('prefers detail, then internal_label, then external_label, then id', async () => {
      mock.onGet(`${ API }/ticket_states`).reply({
        data: [
          { id: 1, detail: 'In progress', category: 'Submitted' },
          { id: 2, internal_label: 'Waiting' },
          { id: 3, external_label: 'Resolved' },
          { id: 4 },
        ],
      })

      const result = await service.getTicketStatesDictionary({})

      expect(result.items).toEqual([
        { label: 'In progress', value: '1', note: 'Submitted' },
        { label: 'Waiting', value: '2', note: '' },
        { label: 'Resolved', value: '3', note: '' },
        { label: '4', value: '4', note: '' },
      ])
    })

    it('filters on the resolved label and skips states with no label at all', async () => {
      mock.onGet(`${ API }/ticket_states`).reply({ data: [{ id: 1, detail: 'In progress' }, { id: 2 }] })

      const result = await service.getTicketStatesDictionary({ search: 'progress' })

      expect(result.items).toEqual([{ label: 'In progress', value: '1', note: '' }])
    })

    it('handles an empty response', async () => {
      mock.onGet(`${ API }/ticket_states`).reply(undefined)

      await expect(service.getTicketStatesDictionary(null)).resolves.toEqual({ items: [], cursor: null })
    })
  })

  describe('getTicketsDictionary', () => {
    it('searches all tickets by created_at > 0 and maps them', async () => {
      mock.onPost(`${ API }/tickets/search`).reply({
        tickets: [{ id: '631', ticket_id: '38', ticket_attributes: { _default_title_: 'Broken' }, ticket_state: { category: 'Submitted' } }],
        pages: { next: { starting_after: 'cur-2' } },
      })

      const result = await service.getTicketsDictionary({ cursor: 'cur-1' })

      expect(last().body).toEqual({
        query: { field: 'created_at', operator: '>', value: '0' },
        pagination: { per_page: 50, starting_after: 'cur-1' },
      })

      expect(result).toEqual({
        items: [{ label: '#38 — Broken', value: '631', note: 'Submitted' }],
        cursor: 'cur-2',
      })
    })

    it('falls back to the internal id and the state id', async () => {
      mock.onPost(`${ API }/tickets/search`).reply({ tickets: [{ id: '631', ticket_state: { id: '8537' } }] })

      const result = await service.getTicketsDictionary({})

      expect(result.items).toEqual([{ label: '#631', value: '631', note: '8537' }])
    })

    it('emits an empty note when there is no ticket state', async () => {
      mock.onPost(`${ API }/tickets/search`).reply({ tickets: [{ id: '631', ticket_id: '38' }] })

      const result = await service.getTicketsDictionary(null)

      expect(result.items).toEqual([{ label: '#38', value: '631', note: '' }])
    })

    it('filters by ticket number and by title', async () => {
      mock.onPost(`${ API }/tickets/search`).reply({
        tickets: [
          { id: '1', ticket_id: '38', ticket_attributes: { _default_title_: 'Broken' } },
          { id: '2', ticket_id: '99', ticket_attributes: { _default_title_: 'Slow' } },
        ],
      })

      await expect(service.getTicketsDictionary({ search: '99' })).resolves.toMatchObject({
        items: [{ value: '2' }],
      })

      await expect(service.getTicketsDictionary({ search: 'broken' })).resolves.toMatchObject({
        items: [{ value: '1' }],
      })
    })

    it('handles an empty response', async () => {
      mock.onPost(`${ API }/tickets/search`).reply({})

      await expect(service.getTicketsDictionary({})).resolves.toEqual({ items: [], cursor: null })
    })
  })

  describe('getSubscriptionTypesDictionary', () => {
    it('prefers the default translation name', async () => {
      mock.onGet(`${ API }/subscription_types`).reply({
        data: [{ id: 37846, default_translation: { name: 'Product Updates' }, consent_type: 'opt_out' }],
      })

      await expect(service.getSubscriptionTypesDictionary({})).resolves.toEqual({
        items: [{ label: 'Product Updates', value: '37846', note: 'opt_out' }],
        cursor: null,
      })
    })

    it('falls back to "state (id)" then the bare id', async () => {
      mock.onGet(`${ API }/subscription_types`).reply({ data: [{ id: 1, state: 'live' }, { id: 2 }] })

      const result = await service.getSubscriptionTypesDictionary(null)

      expect(result.items).toEqual([
        { label: 'live (1)', value: '1', note: '' },
        { label: '2', value: '2', note: '' },
      ])
    })

    it('filters on the derived label', async () => {
      mock.onGet(`${ API }/subscription_types`).reply({
        data: [{ id: 1, default_translation: { name: 'Product Updates' } }, { id: 2, default_translation: { name: 'Newsletter' } }],
      })

      const result = await service.getSubscriptionTypesDictionary({ search: 'news' })

      expect(result.items).toEqual([{ label: 'Newsletter', value: '2', note: '' }])
    })

    it('falls back when default_translation has no name', async () => {
      mock.onGet(`${ API }/subscription_types`).reply({ data: [{ id: 1, state: 'live', default_translation: {} }] })

      const result = await service.getSubscriptionTypesDictionary({})

      expect(result.items[0].label).toBe('live (1)')
    })

    it('handles an empty response', async () => {
      mock.onGet(`${ API }/subscription_types`).reply(undefined)

      await expect(service.getSubscriptionTypesDictionary({})).resolves.toEqual({ items: [], cursor: null })
    })
  })

  describe('getCollectionsDictionary', () => {
    it('maps collections with cursor pagination', async () => {
      mock.onGet(`${ API }/help_center/collections`).reply({
        data: [{ id: 6871119, name: 'collection 51' }],
        pages: { next: { starting_after: 'cur-2' } },
      })

      const result = await service.getCollectionsDictionary({ cursor: 'cur-1' })

      expect(last().query).toEqual({ per_page: 50, starting_after: 'cur-1' })
      expect(result).toEqual({ items: [{ label: 'collection 51', value: '6871119', note: '' }], cursor: 'cur-2' })
    })

    it('filters locally, falls back to the id, and handles an empty response', async () => {
      mock.onGet(`${ API }/help_center/collections`).reply({ data: [{ id: 1, name: 'Billing' }, { id: 2 }] })

      await expect(service.getCollectionsDictionary({ search: 'bill' })).resolves.toEqual({
        items: [{ label: 'Billing', value: '1', note: '' }],
        cursor: null,
      })

      await expect(service.getCollectionsDictionary(null)).resolves.toMatchObject({
        items: [{ label: 'Billing', value: '1' }, { label: '2', value: '2' }],
      })
    })

    it('handles a missing data array', async () => {
      mock.onGet(`${ API }/help_center/collections`).reply({})

      await expect(service.getCollectionsDictionary({})).resolves.toEqual({ items: [], cursor: null })
    })
  })

  describe('getSegmentsDictionary', () => {
    it('maps segments with the person type as the note', async () => {
      mock.onGet(`${ API }/segments`).reply({ segments: [{ id: 's1', name: 'Active', person_type: 'user' }] })

      await expect(service.getSegmentsDictionary({})).resolves.toEqual({
        items: [{ label: 'Active', value: 's1', note: 'user' }],
        cursor: null,
      })
    })

    it('filters locally, falls back to the id, and handles an empty response', async () => {
      mock.onGet(`${ API }/segments`).reply({ segments: [{ id: 1, name: 'Active' }, { id: 2 }] })

      await expect(service.getSegmentsDictionary({ search: 'act' })).resolves.toEqual({
        items: [{ label: 'Active', value: '1', note: '' }],
        cursor: null,
      })

      await expect(service.getSegmentsDictionary(null)).resolves.toMatchObject({
        items: [{ label: 'Active', value: '1' }, { label: '2', value: '2' }],
      })
    })

    it('handles a missing segments array', async () => {
      mock.onGet(`${ API }/segments`).reply(undefined)

      await expect(service.getSegmentsDictionary({})).resolves.toEqual({ items: [], cursor: null })
    })
  })

  describe('getArticlesDictionary', () => {
    it('maps articles with the state as the note and a cursor', async () => {
      mock.onGet(`${ API }/articles`).reply({
        data: [{ id: 6871119, title: 'Thanks', state: 'published' }],
        pages: { next: { starting_after: 'cur-2' } },
      })

      const result = await service.getArticlesDictionary({ cursor: 'cur-1' })

      expect(last().query).toEqual({ per_page: 50, starting_after: 'cur-1' })
      expect(result).toEqual({ items: [{ label: 'Thanks', value: '6871119', note: 'published' }], cursor: 'cur-2' })
    })

    it('filters by title, falls back to the id, and handles an empty response', async () => {
      mock.onGet(`${ API }/articles`).reply({ data: [{ id: 1, title: 'Pricing' }, { id: 2 }] })

      await expect(service.getArticlesDictionary({ search: 'pric' })).resolves.toEqual({
        items: [{ label: 'Pricing', value: '1', note: '' }],
        cursor: null,
      })

      await expect(service.getArticlesDictionary(null)).resolves.toMatchObject({
        items: [{ label: 'Pricing', value: '1' }, { label: '2', value: '2' }],
      })
    })

    it('handles a missing data array', async () => {
      mock.onGet(`${ API }/articles`).reply({})

      await expect(service.getArticlesDictionary({})).resolves.toEqual({ items: [], cursor: null })
    })
  })

  describe('getDataAttributesDictionary', () => {
    it('prefers full_name and notes the model', async () => {
      mock.onGet(`${ API }/data_attributes`).reply({
        data: [{ id: 188, name: 'paid_subscriber', full_name: 'custom_attributes.paid_subscriber', model: 'contact' }],
      })

      await expect(service.getDataAttributesDictionary({})).resolves.toEqual({
        items: [{ label: 'custom_attributes.paid_subscriber', value: '188', note: 'contact' }],
        cursor: null,
      })
    })

    it('drops attributes without an id', async () => {
      mock.onGet(`${ API }/data_attributes`).reply({
        data: [{ name: 'no-id' }, { id: null, name: 'null-id' }, { id: 1, name: 'ok' }],
      })

      const result = await service.getDataAttributesDictionary(null)

      expect(result.items).toEqual([{ label: 'ok', value: '1', note: '' }])
    })

    it('filters across full_name and name and falls back to the id', async () => {
      mock.onGet(`${ API }/data_attributes`).reply({
        data: [{ id: 1, name: 'plan' }, { id: 2, full_name: 'custom_attributes.tier' }, { id: 3 }],
      })

      await expect(service.getDataAttributesDictionary({ search: 'tier' })).resolves.toMatchObject({
        items: [{ label: 'custom_attributes.tier', value: '2' }],
      })

      await expect(service.getDataAttributesDictionary({})).resolves.toMatchObject({
        items: [{ label: 'plan' }, { label: 'custom_attributes.tier' }, { label: '3' }],
      })
    })

    it('handles an empty response', async () => {
      mock.onGet(`${ API }/data_attributes`).reply(undefined)

      await expect(service.getDataAttributesDictionary({})).resolves.toEqual({ items: [], cursor: null })
    })
  })

  describe('getNotesDictionary', () => {
    it('returns an empty list and issues no call when no contact criteria is given', async () => {
      replyAny()

      await expect(service.getNotesDictionary({})).resolves.toEqual({ items: [], cursor: null })
      await expect(service.getNotesDictionary(null)).resolves.toEqual({ items: [], cursor: null })
      await expect(service.getNotesDictionary({ criteria: {} })).resolves.toEqual({ items: [], cursor: null })
      expect(mock.history).toHaveLength(0)
    })

    it('lists the contact notes with HTML stripped from labels', async () => {
      mock.onGet(`${ API }/contacts/c1/notes`).reply({
        data: [{ id: 31, body: '<p>Hello <b>there</b></p>', author: { id: 991267583 } }],
        pages: { next: { starting_after: 'cur-2' } },
      })

      const result = await service.getNotesDictionary({ criteria: { contactId: 'c1' } })

      expect(last().url).toBe(`${ API }/contacts/c1/notes`)

      expect(result).toEqual({
        items: [{ label: 'Hello there', value: '31', note: '991267583' }],
        cursor: 'cur-2',
      })
    })

    it('truncates long labels to 60 characters and falls back for an empty body', async () => {
      const longBody = `<p>${ 'x'.repeat(100) }</p>`

      mock.onGet(`${ API }/contacts/c1/notes`).reply({ data: [{ id: 31, body: longBody }, { id: 32, body: '<p></p>' }] })

      const result = await service.getNotesDictionary({ criteria: { contactId: 'c1' } })

      expect(result.items[0].label).toHaveLength(60)
      expect(result.items[0].note).toBe('')
      expect(result.items[1].label).toBe('Note 32')
    })

    it('filters notes by their stripped body text', async () => {
      mock.onGet(`${ API }/contacts/c1/notes`).reply({
        data: [{ id: 1, body: '<p>Refund issued</p>' }, { id: 2, body: '<p>Called back</p>' }],
      })

      const result = await service.getNotesDictionary({ search: 'refund', criteria: { contactId: 'c1' } })

      expect(result.items).toEqual([{ label: 'Refund issued', value: '1', note: '' }])
    })

    it('handles an empty response', async () => {
      mock.onGet(`${ API }/contacts/c1/notes`).reply({})

      await expect(service.getNotesDictionary({ criteria: { contactId: 'c1' } })).resolves.toEqual({ items: [], cursor: null })
    })
  })

  describe('dictionary search against records missing the searched field', () => {
    it('does not match an admin with neither name nor email', async () => {
      mock.onGet(`${ API }/admins`).reply({ admins: [{ id: 1 }] })

      await expect(service.getAdminsDictionary({ search: 'x' })).resolves.toEqual({ items: [], cursor: null })
    })

    it('does not match a team, tag, company, collection, segment or article without a name/title', async () => {
      mock.onGet(`${ API }/teams`).reply({ teams: [{ id: 1 }] })
      mock.onGet(`${ API }/tags`).reply({ data: [{ id: 1 }] })
      mock.onPost(`${ API }/companies/list`).reply({ data: [{ id: 1 }] })
      mock.onGet(`${ API }/help_center/collections`).reply({ data: [{ id: 1 }] })
      mock.onGet(`${ API }/segments`).reply({ segments: [{ id: 1 }] })
      mock.onGet(`${ API }/articles`).reply({ data: [{ id: 1 }] })
      mock.onGet(`${ API }/ticket_types`).reply({ data: [{ id: 1 }] })
      mock.onGet(`${ API }/data_attributes`).reply({ data: [{ id: 1 }] })

      const empty = { items: [], cursor: null }

      await expect(service.getTeamsDictionary({ search: 'x' })).resolves.toEqual(empty)
      await expect(service.getTagsDictionary({ search: 'x' })).resolves.toEqual(empty)
      await expect(service.getCompaniesDictionary({ search: 'x' })).resolves.toEqual(empty)
      await expect(service.getCollectionsDictionary({ search: 'x' })).resolves.toEqual(empty)
      await expect(service.getSegmentsDictionary({ search: 'x' })).resolves.toEqual(empty)
      await expect(service.getArticlesDictionary({ search: 'x' })).resolves.toEqual(empty)
      await expect(service.getTicketTypesDictionary({ search: 'x' })).resolves.toEqual(empty)
      await expect(service.getDataAttributesDictionary({ search: 'x' })).resolves.toEqual(empty)
    })

    it('does not match an assignee admin or team missing every searchable field', async () => {
      mock.onGet(`${ API }/admins`).reply({ admins: [{ id: 1 }] })
      mock.onGet(`${ API }/teams`).reply({ teams: [{ id: 2 }] })

      await expect(service.getAssigneesDictionary({ search: 'x' })).resolves.toEqual({ items: [], cursor: null })
    })

    it('does not match a ticket with no ticket number and no title', async () => {
      mock.onPost(`${ API }/tickets/search`).reply({ tickets: [{ id: '631' }] })

      await expect(service.getTicketsDictionary({ search: 'x' })).resolves.toEqual({ items: [], cursor: null })
    })

    it('does not match a note with no body at all', async () => {
      mock.onGet(`${ API }/contacts/c1/notes`).reply({ data: [{ id: 31 }] })

      await expect(service.getNotesDictionary({ search: 'x', criteria: { contactId: 'c1' } }))
        .resolves.toEqual({ items: [], cursor: null })
    })
  })

  // ==========================================================================
  //  POLLING TRIGGERS
  // ==========================================================================

  describe('created_at polling triggers', () => {
    const SINCE = NOW - 3600

    beforeEach(() => {
      jest.spyOn(Date, 'now').mockReturnValue(NOW * 1000)
    })

    it.each([
      ['onNewConversation', `${ API }/conversations/search`, 'conversations'],
      ['onNewContact', `${ API }/contacts/search`, 'data'],
      ['onNewTicket', `${ API }/tickets/search`, 'tickets'],
    ])('%s seeds state on the first poll without calling the API', async method => {
      replyAny()

      await expect(service[method]({ state: {} })).resolves.toEqual({
        events: [],
        state: { lastCreatedAt: NOW, seen: [] },
      })

      expect(mock.history).toHaveLength(0)
    })

    it('seeds state when the invocation itself is missing', async () => {
      await expect(service.onNewContact(undefined)).resolves.toEqual({ events: [], state: { lastCreatedAt: NOW, seen: [] } })
    })

    it.each([
      ['onNewConversation', `${ API }/conversations/search`, 'conversations'],
      ['onNewContact', `${ API }/contacts/search`, 'data'],
      ['onNewTicket', `${ API }/tickets/search`, 'tickets'],
    ])('%s searches %s oldest-first and emits fresh records', async (method, url, collectionKey) => {
      mock.onPost(url).reply({ [collectionKey]: [{ id: 'r1', created_at: SINCE + 10 }] })

      const result = await service[method]({ state: { lastCreatedAt: SINCE, seen: [] } })

      expect(last()).toMatchObject({ method: 'post', url })

      expect(last().body).toEqual({
        query: { field: 'created_at', operator: '>', value: String(SINCE - 1) },
        sort: { field: 'created_at', order: 'ascending' },
        pagination: { per_page: 50 },
      })

      expect(result.events).toEqual([{ id: 'r1', created_at: SINCE + 10 }])
      expect(result.state.lastCreatedAt).toBe(SINCE + 10)
      expect(result.state.seen).toEqual(['r1'])
    })

    it('does not re-emit ids already in `seen`', async () => {
      mock.onPost(`${ API }/contacts/search`).reply({
        data: [{ id: 'old', created_at: SINCE }, { id: 'new', created_at: SINCE + 5 }],
      })

      const result = await service.onNewContact({ state: { lastCreatedAt: SINCE, seen: ['old'] } })

      expect(result.events.map(e => e.id)).toEqual(['new'])
    })

    it('drops records created before the watermark', async () => {
      mock.onPost(`${ API }/contacts/search`).reply({ data: [{ id: 'stale', created_at: SINCE - 5 }] })

      const result = await service.onNewContact({ state: { lastCreatedAt: SINCE, seen: [] } })

      expect(result.events).toEqual([])
      // Watermark never moves backwards.
      expect(result.state.lastCreatedAt).toBe(SINCE)
    })

    it('holds the watermark back by the lag window for very recent records', async () => {
      mock.onPost(`${ API }/contacts/search`).reply({ data: [{ id: 'fresh', created_at: NOW }] })

      const result = await service.onNewContact({ state: { lastCreatedAt: SINCE, seen: [] } })

      expect(result.events.map(e => e.id)).toEqual(['fresh'])
      expect(result.state.lastCreatedAt).toBe(NOW - LAG)
      // The record sits inside the lag window, so it is remembered for the overlap re-query.
      expect(result.state.seen).toEqual(['fresh'])
    })

    it('keeps `seen` bounded to the lag window', async () => {
      mock.onPost(`${ API }/contacts/search`).reply({
        data: [
          { id: 'aged', created_at: SINCE + 1 },
          { id: 'recent', created_at: NOW - 5 },
        ],
      })

      const result = await service.onNewContact({ state: { lastCreatedAt: SINCE, seen: [] } })

      expect(result.state.lastCreatedAt).toBe(NOW - LAG)
      expect(result.state.seen).toEqual(['recent'])
    })

    it('tolerates a record with a non-numeric created_at when computing the max', async () => {
      mock.onPost(`${ API }/contacts/search`).reply({ data: [{ id: 'weird', created_at: null }] })

      const result = await service.onNewContact({ state: { lastCreatedAt: SINCE, seen: [] } })

      expect(result.events).toEqual([])
      expect(result.state.lastCreatedAt).toBe(SINCE)
    })

    it('tolerates a missing `seen` list in stored state', async () => {
      mock.onPost(`${ API }/contacts/search`).reply({ data: [{ id: 'r1', created_at: SINCE + 1 }] })

      await expect(service.onNewContact({ state: { lastCreatedAt: SINCE } })).resolves.toMatchObject({
        events: [{ id: 'r1', created_at: SINCE + 1 }],
      })
    })

    it('pages through every result page', async () => {
      let call = 0

      mock.onPost(`${ API }/contacts/search`).replyWith(() => {
        call += 1

        if (call === 1) {
          return { data: [{ id: 'p1', created_at: SINCE + 1 }], pages: { next: { starting_after: 'cur-2' } } }
        }

        return { data: [{ id: 'p2', created_at: SINCE + 2 }] }
      })

      const result = await service.onNewContact({ state: { lastCreatedAt: SINCE, seen: [] } })

      expect(mock.history).toHaveLength(2)
      expect(mock.history[1].body.pagination).toEqual({ per_page: 50, starting_after: 'cur-2' })
      expect(result.events.map(e => e.id)).toEqual(['p1', 'p2'])
    })

    it('stops after the 20-page cap', async () => {
      mock.onPost(`${ API }/contacts/search`).reply({ data: [], pages: { next: { starting_after: 'always' } } })

      await service.onNewContact({ state: { lastCreatedAt: SINCE, seen: [] } })

      expect(mock.history).toHaveLength(20)
    })

    it('tolerates an empty search response', async () => {
      mock.onPost(`${ API }/contacts/search`).reply(undefined)

      await expect(service.onNewContact({ state: { lastCreatedAt: SINCE, seen: [] } })).resolves.toEqual({
        events: [],
        state: { lastCreatedAt: SINCE, seen: [] },
      })
    })
  })

  describe('statistics-field polling triggers', () => {
    const SINCE = NOW - 3600

    beforeEach(() => {
      jest.spyOn(Date, 'now').mockReturnValue(NOW * 1000)
    })

    it.each([
      ['onConversationClosed'],
      ['onConversationReplied'],
    ])('%s seeds state on the first poll without calling the API', async method => {
      replyAny()

      await expect(service[method]({ state: {} })).resolves.toEqual({ events: [], state: { lastValue: NOW, seen: [] } })
      expect(mock.history).toHaveLength(0)
    })

    it('seeds state when the invocation is missing', async () => {
      await expect(service.onConversationReplied(undefined)).resolves.toEqual({ events: [], state: { lastValue: NOW, seen: [] } })
    })

    it('onConversationClosed ANDs the closed-state filter into the query', async () => {
      mock.onPost(`${ API }/conversations/search`).reply({
        conversations: [{ id: '123', statistics: { last_close_at: SINCE + 10 } }],
      })

      const result = await service.onConversationClosed({ state: { lastValue: SINCE, seen: [] } })

      expect(last().body).toEqual({
        query: {
          operator: 'AND',
          value: [
            { field: 'statistics.last_close_at', operator: '>', value: String(SINCE - 1) },
            { field: 'state', operator: '=', value: 'closed' },
          ],
        },
        sort: { field: 'statistics.last_close_at', order: 'ascending' },
        pagination: { per_page: 50 },
      })

      expect(result.events).toHaveLength(1)
      expect(result.state).toEqual({ lastValue: SINCE + 10, seen: ['123'] })
    })

    it('onConversationReplied uses a bare date filter', async () => {
      mock.onPost(`${ API }/conversations/search`).reply({
        conversations: [{ id: '9', statistics: { last_admin_reply_at: SINCE + 3 } }],
      })

      const result = await service.onConversationReplied({ state: { lastValue: SINCE, seen: [] } })

      expect(last().body.query).toEqual({ field: 'statistics.last_admin_reply_at', operator: '>', value: String(SINCE - 1) })
      expect(result.events.map(e => e.id)).toEqual(['9'])
    })

    it('treats a missing statistics object as value 0 and emits nothing', async () => {
      mock.onPost(`${ API }/conversations/search`).reply({ conversations: [{ id: '1' }, { id: '2', statistics: null }] })

      const result = await service.onConversationReplied({ state: { lastValue: SINCE, seen: [] } })

      expect(result.events).toEqual([])
      expect(result.state.lastValue).toBe(SINCE)
    })

    it('does not re-emit ids already in `seen`', async () => {
      mock.onPost(`${ API }/conversations/search`).reply({
        conversations: [
          { id: 'old', statistics: { last_admin_reply_at: SINCE } },
          { id: 'new', statistics: { last_admin_reply_at: SINCE + 1 } },
        ],
      })

      const result = await service.onConversationReplied({ state: { lastValue: SINCE, seen: ['old'] } })

      expect(result.events.map(e => e.id)).toEqual(['new'])
    })

    it('holds the watermark back by the lag window', async () => {
      mock.onPost(`${ API }/conversations/search`).reply({
        conversations: [{ id: 'fresh', statistics: { last_admin_reply_at: NOW } }],
      })

      const result = await service.onConversationReplied({ state: { lastValue: SINCE, seen: [] } })

      expect(result.state).toEqual({ lastValue: NOW - LAG, seen: ['fresh'] })
    })

    it('pages through every result page and respects the 20-page cap', async () => {
      let call = 0

      mock.onPost(`${ API }/conversations/search`).replyWith(() => {
        call += 1

        if (call === 1) {
          return {
            conversations: [{ id: 'p1', statistics: { last_admin_reply_at: SINCE + 1 } }],
            pages: { next: { starting_after: 'cur-2' } },
          }
        }

        return { conversations: [{ id: 'p2', statistics: { last_admin_reply_at: SINCE + 2 } }] }
      })

      const result = await service.onConversationReplied({ state: { lastValue: SINCE, seen: [] } })

      expect(mock.history).toHaveLength(2)
      expect(mock.history[1].body.pagination).toEqual({ per_page: 50, starting_after: 'cur-2' })
      expect(result.events.map(e => e.id)).toEqual(['p1', 'p2'])
    })

    it('stops after the 20-page cap', async () => {
      mock.onPost(`${ API }/conversations/search`).reply({ conversations: [], pages: { next: { starting_after: 'always' } } })

      await service.onConversationReplied({ state: { lastValue: SINCE, seen: [] } })

      expect(mock.history).toHaveLength(20)
    })

    it('tolerates an empty search response and a missing `seen` list', async () => {
      mock.onPost(`${ API }/conversations/search`).reply(undefined)

      await expect(service.onConversationClosed({ state: { lastValue: SINCE } })).resolves.toEqual({
        events: [],
        state: { lastValue: SINCE, seen: [] },
      })
    })
  })

  describe('handleTriggerPollingForEvent', () => {
    beforeEach(() => {
      jest.spyOn(Date, 'now').mockReturnValue(NOW * 1000)
    })

    it.each([
      ['onNewConversation', 'lastCreatedAt'],
      ['onNewContact', 'lastCreatedAt'],
      ['onNewTicket', 'lastCreatedAt'],
      ['onConversationClosed', 'lastValue'],
      ['onConversationReplied', 'lastValue'],
    ])('dispatches to %s', async (eventName, stateKey) => {
      const result = await service.handleTriggerPollingForEvent({ eventName, state: {} })

      expect(result).toEqual({ events: [], state: { [stateKey]: NOW, seen: [] } })
    })

    it('passes the invocation through so stored state is honoured', async () => {
      mock.onPost(`${ API }/contacts/search`).reply({ data: [{ id: 'r1', created_at: NOW - 100 }] })

      const result = await service.handleTriggerPollingForEvent({
        eventName: 'onNewContact',
        state: { lastCreatedAt: NOW - 3600, seen: [] },
      })

      expect(result.events.map(e => e.id)).toEqual(['r1'])
    })
  })

  // ==========================================================================
  //  SWEEPS
  // ==========================================================================

  describe('guard sweep — every guard throws and issues no HTTP call', () => {
    it.each([
      ['createContact', [], 'At least one of Email, External ID, or Role is required to create a contact.'],
      ['getContact', [''], 'A contact is required'],
      ['getContactByExternalId', [''], 'An external ID is required.'],
      ['updateContact', [''], 'A contact is required'],
      ['deleteContact', [''], 'A contact is required'],
      ['archiveContact', [''], 'A contact is required'],
      ['unarchiveContact', [''], 'A contact is required'],
      ['searchContacts', ['', 'Equals', 'v'], 'A field and operator are required to search contacts.'],
      ['searchContacts', ['email', '', 'v'], 'A field and operator are required to search contacts.'],
      ['mergeContact', ['', 'u1'], 'Both the lead to merge from and the user to merge into are required.'],
      ['mergeContact', ['l1', ''], 'Both the lead to merge from and the user to merge into are required.'],
      ['getCompany', [''], 'A company is required'],
      ['findCompany', ['', ''], 'Provide a Company ID or a name to find a company.'],
      ['updateCompany', [''], 'A company is required'],
      ['deleteCompany', [''], 'A company is required'],
      ['attachContactToCompany', ['', 'co1'], 'Both a contact and a company are required.'],
      ['attachContactToCompany', ['c1', ''], 'Both a contact and a company are required.'],
      ['detachContactFromCompany', ['', 'co1'], 'Both a contact and a company are required.'],
      ['detachContactFromCompany', ['c1', ''], 'Both a contact and a company are required.'],
      ['listCompanyContacts', [''], 'A company is required'],
      ['createConversation', ['', 'User', 'hi'], 'A from-contact and a message body are required.'],
      ['createConversation', ['c1', 'User', ''], 'A from-contact and a message body are required.'],
      ['getConversation', [''], 'A conversation is required'],
      ['searchConversations', ['', 'Equals'], 'A field and operator are required to search conversations.'],
      ['searchConversations', ['state', ''], 'A field and operator are required to search conversations.'],
      ['replyToConversation', ['', 'Admin — Public Reply', 'b'], 'A conversation, a Reply As choice, and a body are required.'],
      ['replyToConversation', ['1', '', 'b'], 'A conversation, a Reply As choice, and a body are required.'],
      ['replyToConversation', ['1', 'Admin — Public Reply', ''], 'A conversation, a Reply As choice, and a body are required.'],
      ['assignConversation', ['', 'a1', 'Admin', 'a2'], 'A conversation, acting admin, assign-to type, and assignee are required.'],
      ['assignConversation', ['1', '', 'Admin', 'a2'], 'A conversation, acting admin, assign-to type, and assignee are required.'],
      ['assignConversation', ['1', 'a1', '', 'a2'], 'A conversation, acting admin, assign-to type, and assignee are required.'],
      ['assignConversation', ['1', 'a1', 'Admin', undefined], 'A conversation, acting admin, assign-to type, and assignee are required.'],
      ['assignConversation', ['1', 'a1', 'Admin', null], 'A conversation, acting admin, assign-to type, and assignee are required.'],
      ['assignConversation', ['1', 'a1', 'Admin', ''], 'A conversation, acting admin, assign-to type, and assignee are required.'],
      ['snoozeConversation', ['', 'a1', 1], 'A conversation, acting admin, and reopen time are required.'],
      ['snoozeConversation', ['1', '', 1], 'A conversation, acting admin, and reopen time are required.'],
      ['snoozeConversation', ['1', 'a1', 0], 'A conversation, acting admin, and reopen time are required.'],
      ['openConversation', ['', 'a1'], 'A conversation and acting admin are required.'],
      ['openConversation', ['1', ''], 'A conversation and acting admin are required.'],
      ['closeConversation', ['', 'a1'], 'A conversation and acting admin are required.'],
      ['closeConversation', ['1', ''], 'A conversation and acting admin are required.'],
      ['attachContactToConversation', ['', 'a1', 'c1'], 'A conversation, acting admin, and contact are required.'],
      ['attachContactToConversation', ['1', '', 'c1'], 'A conversation, acting admin, and contact are required.'],
      ['attachContactToConversation', ['1', 'a1', ''], 'A conversation, acting admin, and contact are required.'],
      ['convertConversationToTicket', ['', 'tt1'], 'A conversation and a ticket type are required.'],
      ['convertConversationToTicket', ['1', ''], 'A conversation and a ticket type are required.'],
      ['createMessage', ['', 1, 'User', 'c1', 'b'], 'Message type, from admin, recipient type, recipient, and body are required.'],
      ['createMessage', ['In-App', 0, 'User', 'c1', 'b'], 'Message type, from admin, recipient type, recipient, and body are required.'],
      ['createMessage', ['In-App', 1, '', 'c1', 'b'], 'Message type, from admin, recipient type, recipient, and body are required.'],
      ['createMessage', ['In-App', 1, 'User', '', 'b'], 'Message type, from admin, recipient type, recipient, and body are required.'],
      ['createMessage', ['In-App', 1, 'User', 'c1', ''], 'Message type, from admin, recipient type, recipient, and body are required.'],
      ['createTicket', ['', 'c1'], 'A ticket type and a contact are required.'],
      ['createTicket', ['tt1', ''], 'A ticket type and a contact are required.'],
      ['getTicket', [''], 'A ticket is required'],
      ['updateTicket', [''], 'A ticket is required'],
      ['deleteTicket', [''], 'A ticket is required'],
      ['searchTickets', ['', 'Equals'], 'A field and operator are required to search tickets.'],
      ['searchTickets', ['open', ''], 'A field and operator are required to search tickets.'],
      ['replyToTicket', ['', 'Admin — Public Reply', 'b'], 'A ticket, a Reply As choice, and a body are required.'],
      ['replyToTicket', ['1', '', 'b'], 'A ticket, a Reply As choice, and a body are required.'],
      ['replyToTicket', ['1', 'Admin — Public Reply', ''], 'A ticket, a Reply As choice, and a body are required.'],
      ['getAdmin', [''], 'An admin is required'],
      ['setAdminAway', ['', true], 'An admin and an away state are required.'],
      ['setAdminAway', ['a1', undefined], 'An admin and an away state are required.'],
      ['setAdminAway', ['a1', null], 'An admin and an away state are required.'],
      ['getTeam', [''], 'A team is required'],
      ['createOrUpdateTag', [''], 'A tag name is required.'],
      ['getTag', [''], 'A tag is required'],
      ['deleteTag', [''], 'A tag is required'],
      ['tagContact', ['', 't1'], 'Both a contact and a tag are required.'],
      ['tagContact', ['c1', ''], 'Both a contact and a tag are required.'],
      ['untagContact', ['', 't1'], 'Both a contact and a tag are required.'],
      ['untagContact', ['c1', ''], 'Both a contact and a tag are required.'],
      ['tagCompany', ['', 'co1'], 'Both a tag name and a company are required.'],
      ['tagCompany', ['VIP', ''], 'Both a tag name and a company are required.'],
      ['untagCompany', ['', 'co1'], 'Both a tag name and a company are required.'],
      ['untagCompany', ['VIP', ''], 'Both a tag name and a company are required.'],
      ['tagConversation', ['', 't1', 'a1'], 'A conversation, a tag, and an acting admin are required.'],
      ['tagConversation', ['1', '', 'a1'], 'A conversation, a tag, and an acting admin are required.'],
      ['tagConversation', ['1', 't1', ''], 'A conversation, a tag, and an acting admin are required.'],
      ['untagConversation', ['', 't1', 'a1'], 'A conversation, a tag, and an acting admin are required.'],
      ['untagConversation', ['1', '', 'a1'], 'A conversation, a tag, and an acting admin are required.'],
      ['untagConversation', ['1', 't1', ''], 'A conversation, a tag, and an acting admin are required.'],
      ['getSegment', [''], 'A segment is required'],
      ['createNote', ['', 'body'], 'A contact and a note body are required.'],
      ['createNote', ['c1', ''], 'A contact and a note body are required.'],
      ['listNotes', [''], 'A contact is required'],
      ['getNote', ['c1', ''], 'A note is required'],
      ['submitEvent', ['', 'Email', 'a@b.c'], 'An event name, an Identify By choice, and an identifier are required.'],
      ['submitEvent', ['e', '', 'a@b.c'], 'An event name, an Identify By choice, and an identifier are required.'],
      ['submitEvent', ['e', 'Email', ''], 'An event name, an Identify By choice, and an identifier are required.'],
      ['listEvents', ['', 'a@b.c'], 'An Identify By choice and an identifier are required.'],
      ['listEvents', ['Email', ''], 'An Identify By choice and an identifier are required.'],
      ['createDataAttribute', ['', 'Contact', 'Text'], 'A name, model, and data type are required.'],
      ['createDataAttribute', ['n', '', 'Text'], 'A name, model, and data type are required.'],
      ['createDataAttribute', ['n', 'Contact', ''], 'A name, model, and data type are required.'],
      ['updateDataAttribute', [''], 'A data attribute is required'],
      ['createArticle', ['', 1], 'A title and an author admin id are required.'],
      ['createArticle', ['T', 0], 'A title and an author admin id are required.'],
      ['getArticle', [''], 'An article is required'],
      ['updateArticle', [''], 'An article is required'],
      ['deleteArticle', [''], 'An article is required'],
      ['searchArticles', [''], 'A search phrase is required.'],
      ['createCollection', [''], 'A collection name is required.'],
      ['getCollection', [''], 'A collection is required'],
      ['updateCollection', [''], 'A collection is required'],
      ['deleteCollection', [''], 'A collection is required'],
      ['attachSubscription', ['', 's1', 'Opt In'], 'A contact, a subscription type, and a consent are required.'],
      ['attachSubscription', ['c1', '', 'Opt In'], 'A contact, a subscription type, and a consent are required.'],
      ['attachSubscription', ['c1', 's1', ''], 'A contact, a subscription type, and a consent are required.'],
      ['detachSubscription', ['', 's1'], 'Both a contact and a subscription type are required.'],
      ['detachSubscription', ['c1', ''], 'Both a contact and a subscription type are required.'],
      ['getVisitor', [''], 'A visitor user_id is required.'],
      ['updateVisitor', [''], 'A visitor user_id is required.'],
      ['convertVisitor', ['', 'Lead', 't1'], 'A visitor user_id, a Convert To choice, and a target contact user_id are required.'],
      ['convertVisitor', ['v1', '', 't1'], 'A visitor user_id, a Convert To choice, and a target contact user_id are required.'],
      ['convertVisitor', ['v1', 'Lead', ''], 'A visitor user_id, a Convert To choice, and a target contact user_id are required.'],
    ])('%s(%p) throws without calling the API', async (method, args, message) => {
      replyAny()

      await expect(service[method](...args)).rejects.toThrow(message)
      expect(mock.history).toHaveLength(0)
    })
  })

  describe('error sweep — every operation propagates a wrapped API error', () => {
    const OPERATIONS = [
      ['createContact', ['a@b.c']],
      ['getContact', ['c1']],
      ['getContactByExternalId', ['ext-1']],
      ['updateContact', ['c1', 'a@b.c']],
      ['deleteContact', ['c1']],
      ['archiveContact', ['c1']],
      ['unarchiveContact', ['c1']],
      ['listContacts', []],
      ['searchContacts', ['email', 'Equals', 'a@b.c']],
      ['mergeContact', ['l1', 'u1']],
      ['createOrUpdateCompany', ['remote-1', 'Acme']],
      ['getCompany', ['co1']],
      ['findCompany', ['remote-1']],
      ['updateCompany', ['co1', 'Acme']],
      ['deleteCompany', ['co1']],
      ['listCompanies', []],
      ['attachContactToCompany', ['c1', 'co1']],
      ['detachContactFromCompany', ['c1', 'co1']],
      ['listCompanyContacts', ['co1']],
      ['createConversation', ['c1', 'User', 'hi']],
      ['getConversation', ['1']],
      ['listConversations', []],
      ['searchConversations', ['state', 'Equals', 'open']],
      ['replyToConversation', ['1', 'Admin — Public Reply', 'b', 'a1']],
      ['assignConversation', ['1', 'a1', 'Admin', 'a2']],
      ['snoozeConversation', ['1', 'a1', 123]],
      ['openConversation', ['1', 'a1']],
      ['closeConversation', ['1', 'a1']],
      ['attachContactToConversation', ['1', 'a1', 'c1']],
      ['convertConversationToTicket', ['1', 'tt1']],
      ['createMessage', ['In-App', 1, 'User', 'c1', 'b']],
      ['createTicket', ['tt1', 'c1']],
      ['getTicket', ['631']],
      ['updateTicket', ['631', 'st1']],
      ['deleteTicket', ['631']],
      ['searchTickets', ['open', 'Equals', 'true']],
      ['replyToTicket', ['631', 'Admin — Public Reply', 'b', 'a1']],
      ['listAdmins', []],
      ['getAdmin', ['a1']],
      ['setAdminAway', ['a1', true]],
      ['listTeams', []],
      ['getTeam', ['t1']],
      ['createOrUpdateTag', ['VIP']],
      ['listTags', []],
      ['getTag', ['1']],
      ['deleteTag', ['1']],
      ['tagContact', ['c1', '1']],
      ['untagContact', ['c1', '1']],
      ['tagCompany', ['VIP', 'co1']],
      ['untagCompany', ['VIP', 'co1']],
      ['tagConversation', ['1', 't1', 'a1']],
      ['untagConversation', ['1', 't1', 'a1']],
      ['listSegments', []],
      ['getSegment', ['s1']],
      ['createNote', ['c1', 'body']],
      ['listNotes', ['c1']],
      ['getNote', ['c1', '31']],
      ['submitEvent', ['e', 'Email', 'a@b.c']],
      ['listEvents', ['Email', 'a@b.c']],
      ['listDataAttributes', []],
      ['createDataAttribute', ['n', 'Contact', 'Text']],
      ['updateDataAttribute', ['1', true]],
      ['createArticle', ['T', 1]],
      ['getArticle', ['1']],
      ['updateArticle', ['1', 'T']],
      ['deleteArticle', ['1']],
      ['listArticles', []],
      ['searchArticles', ['pricing']],
      ['createCollection', ['C']],
      ['getCollection', ['1']],
      ['updateCollection', ['1', 'C']],
      ['deleteCollection', ['1']],
      ['listCollections', []],
      ['listSubscriptionTypes', []],
      ['attachSubscription', ['c1', 's1', 'Opt In']],
      ['detachSubscription', ['c1', 's1']],
      ['getVisitor', ['v1']],
      ['updateVisitor', ['v1', 'Name']],
      ['convertVisitor', ['v1', 'Lead', 't1']],
      ['getContactsDictionary', [{}]],
      ['getContactsDictionary', [{ search: 'joe' }]],
      ['getCompaniesDictionary', [{}]],
      ['getConversationsDictionary', [{}]],
      ['getAdminsDictionary', [{}]],
      ['getTeamsDictionary', [{}]],
      ['getAssigneesDictionary', [{}]],
      ['getTagsDictionary', [{}]],
      ['getTicketTypesDictionary', [{}]],
      ['getTicketStatesDictionary', [{}]],
      ['getTicketsDictionary', [{}]],
      ['getSubscriptionTypesDictionary', [{}]],
      ['getCollectionsDictionary', [{}]],
      ['getSegmentsDictionary', [{}]],
      ['getArticlesDictionary', [{}]],
      ['getDataAttributesDictionary', [{}]],
      ['getNotesDictionary', [{ criteria: { contactId: 'c1' } }]],
      ['onNewConversation', [{ state: { lastCreatedAt: 1 } }]],
      ['onNewContact', [{ state: { lastCreatedAt: 1 } }]],
      ['onNewTicket', [{ state: { lastCreatedAt: 1 } }]],
      ['onConversationClosed', [{ state: { lastValue: 1 } }]],
      ['onConversationReplied', [{ state: { lastValue: 1 } }]],
    ]

    it.each(OPERATIONS)('%s propagates the API error message', async (method, args) => {
      mock.onAny().replyWithError({
        message: 'Bad Request',
        status: 422,
        body: { type: 'error.list', errors: [{ code: 'parameter_invalid', message: 'Something went wrong' }] },
      })

      await expect(service[method](...args)).rejects.toThrow(
        'Invalid request — check the required fields and their values. (Something went wrong)'
      )

      expect(mock.history.length).toBeGreaterThanOrEqual(1)
    })
  })
})
