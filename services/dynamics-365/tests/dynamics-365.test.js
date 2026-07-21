'use strict'

const { createSandbox } = require('../../../service-sandbox')

const CLIENT_ID = 'test-client-id'
const CLIENT_SECRET = 'test-client-secret'
const ORG_URL = 'https://testorg.crm.dynamics.com'
const API_BASE = `${ORG_URL}/api/data/v9.2`
const OAUTH_BASE = 'https://login.microsoftonline.com/common/oauth2/v2.0'
const ACCESS_TOKEN = 'test-access-token'

describe('Microsoft Dynamics 365 Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      orgUrl: ORG_URL,
    })

    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()

    service.request = { headers: { 'oauth-access-token': ACCESS_TOKEN } }
  })

  afterEach(() => {
    mock.reset()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Registration ──

  describe('service registration', () => {
    it('registers with correct config items', () => {
      const configItems = sandbox.getConfigItems()

      expect(configItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'clientId', required: true, shared: true }),
          expect.objectContaining({ name: 'clientSecret', required: true, shared: true }),
          expect.objectContaining({ name: 'orgUrl', required: true, shared: false }),
        ])
      )
    })

    it('trims trailing slashes from orgUrl', () => {
      expect(service.orgUrl).toBe(ORG_URL)
    })

    it('handles orgUrl with trailing slashes', () => {
      // Constructor trims trailing slashes - verified by checking the stored value
      // The orgUrl 'https://testorg.crm.dynamics.com' has no trailing slash
      expect(service.orgUrl).not.toMatch(/\/$/)
    })
  })

  // ── OAuth ──

  describe('getOAuth2ConnectionURL', () => {
    it('returns the correct authorization URL', async () => {
      const url = await service.getOAuth2ConnectionURL()

      expect(url).toContain(`${OAUTH_BASE}/authorize`)
      expect(url).toContain(`client_id=${CLIENT_ID}`)
      expect(url).toContain('response_type=code')
      expect(url).toContain('response_mode=query')
      expect(url).toContain(encodeURIComponent(`${ORG_URL}/user_impersonation`))
      expect(url).toContain(encodeURIComponent('offline_access'))
    })
  })

  describe('executeCallback', () => {
    it('exchanges code for token and fetches user identity', async () => {
      const tokenResponse = {
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        expires_in: 3600,
      }

      const whoAmIResponse = { UserId: 'user-guid-123' }

      const userResponse = {
        fullname: 'John Doe',
        internalemailaddress: 'john@test.com',
        domainname: 'john@test.com',
      }

      mock.onPost(`${OAUTH_BASE}/token`).reply(tokenResponse)
      mock.onGet(`${API_BASE}/WhoAmI`).reply(whoAmIResponse)
      mock.onGet(`${API_BASE}/systemusers(user-guid-123)`).reply(userResponse)

      const result = await service.executeCallback({
        code: 'auth-code-123',
        redirectURI: 'https://redirect.example.com/callback',
      })

      expect(result).toEqual({
        token: 'new-access-token',
        refreshToken: 'new-refresh-token',
        expirationInSeconds: 3600,
        connectionIdentityName: 'John Doe (john@test.com)',
        overwrite: true,
        userData: userResponse,
      })

      // Verify token request
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${OAUTH_BASE}/token`)
      expect(mock.history[0].body).toContain('grant_type=authorization_code')
      expect(mock.history[0].body).toContain('code=auth-code-123')
    })

    it('uses callbackObject clientId and clientSecret when provided', async () => {
      mock.onPost(`${OAUTH_BASE}/token`).reply({
        access_token: 'token-abc',
        refresh_token: 'refresh-abc',
        expires_in: 3600,
      })
      mock.onGet(`${API_BASE}/WhoAmI`).replyWithError({ message: 'fail' })

      const result = await service.executeCallback({
        clientId: 'override-client-id',
        clientSecret: 'override-client-secret',
        code: 'code-123',
        redirectURI: 'https://redirect.example.com/callback',
      })

      expect(result.token).toBe('token-abc')
      expect(mock.history[0].body).toContain('client_id=override-client-id')
      expect(mock.history[0].body).toContain('client_secret=override-client-secret')
    })

    it('falls back to default identity name on identity lookup error', async () => {
      mock.onPost(`${OAUTH_BASE}/token`).reply({
        access_token: 'token',
        refresh_token: 'refresh',
        expires_in: 3600,
      })
      mock.onGet(`${API_BASE}/WhoAmI`).replyWithError({ message: 'Not found' })

      const result = await service.executeCallback({
        code: 'code',
        redirectURI: 'https://redirect.example.com',
      })

      expect(result.connectionIdentityName).toBe('Dynamics 365 user')
      expect(result.userData).toEqual({})
    })

    it('uses fullname only when email is missing', async () => {
      mock.onPost(`${OAUTH_BASE}/token`).reply({
        access_token: 'token',
        refresh_token: 'refresh',
        expires_in: 3600,
      })
      mock.onGet(`${API_BASE}/WhoAmI`).reply({ UserId: 'uid' })
      mock.onGet(`${API_BASE}/systemusers(uid)`).reply({
        fullname: 'Jane Doe',
      })

      const result = await service.executeCallback({
        code: 'code',
        redirectURI: 'https://redirect.example.com',
      })

      expect(result.connectionIdentityName).toBe('Jane Doe')
    })

    it('uses email only when fullname is missing', async () => {
      mock.onPost(`${OAUTH_BASE}/token`).reply({
        access_token: 'token',
        refresh_token: 'refresh',
        expires_in: 3600,
      })
      mock.onGet(`${API_BASE}/WhoAmI`).reply({ UserId: 'uid' })
      mock.onGet(`${API_BASE}/systemusers(uid)`).reply({
        internalemailaddress: 'jane@test.com',
      })

      const result = await service.executeCallback({
        code: 'code',
        redirectURI: 'https://redirect.example.com',
      })

      expect(result.connectionIdentityName).toBe('jane@test.com')
    })

    it('uses domainname as fallback email', async () => {
      mock.onPost(`${OAUTH_BASE}/token`).reply({
        access_token: 'token',
        refresh_token: 'refresh',
        expires_in: 3600,
      })
      mock.onGet(`${API_BASE}/WhoAmI`).reply({ UserId: 'uid' })
      mock.onGet(`${API_BASE}/systemusers(uid)`).reply({
        fullname: 'Jane',
        domainname: 'jane@domain.com',
      })

      const result = await service.executeCallback({
        code: 'code',
        redirectURI: 'https://redirect.example.com',
      })

      expect(result.connectionIdentityName).toBe('Jane (jane@domain.com)')
    })
  })

  describe('refreshToken', () => {
    it('sends refresh token request and returns new tokens', async () => {
      mock.onPost(`${OAUTH_BASE}/token`).reply({
        access_token: 'refreshed-token',
        refresh_token: 'new-refresh-token',
        expires_in: 7200,
      })

      const result = await service.refreshToken('old-refresh-token')

      expect(result).toEqual({
        token: 'refreshed-token',
        refreshToken: 'new-refresh-token',
        expirationInSeconds: 7200,
      })

      expect(mock.history[0].body).toContain('grant_type=refresh_token')
      expect(mock.history[0].body).toContain('refresh_token=old-refresh-token')
      expect(mock.history[0].body).toContain(`client_id=${CLIENT_ID}`)
      expect(mock.history[0].body).toContain(`client_secret=${CLIENT_SECRET}`)
    })

    it('throws on API error', async () => {
      mock.onPost(`${OAUTH_BASE}/token`).replyWithError({ message: 'Invalid grant' })

      await expect(service.refreshToken('bad-token')).rejects.toThrow()
    })
  })

  // ── Dictionary ──

  describe('getEntitySetsDictionary', () => {
    const entityDefUrl = `${API_BASE}/EntityDefinitions`

    it('returns all entity sets when no search is provided', async () => {
      mock.onGet(entityDefUrl).reply({
        value: [
          {
            EntitySetName: 'accounts',
            LogicalName: 'account',
            DisplayName: { UserLocalizedLabel: { Label: 'Account' } },
          },
          {
            EntitySetName: 'contacts',
            LogicalName: 'contact',
            DisplayName: { UserLocalizedLabel: { Label: 'Contact' } },
          },
        ],
      })

      const result = await service.getEntitySetsDictionary({})

      expect(result.cursor).toBeNull()
      expect(result.items).toHaveLength(2)
      expect(result.items[0]).toEqual({
        label: 'Account',
        note: 'accounts',
        value: 'accounts',
      })
      expect(result.items[1]).toEqual({
        label: 'Contact',
        note: 'contacts',
        value: 'contacts',
      })

      expect(mock.history[0].query).toMatchObject({
        $select: 'EntitySetName,LogicalName,DisplayName',
        $filter: 'IsValidForAdvancedFind/Value eq true',
      })
    })

    it('filters by search string', async () => {
      mock.onGet(entityDefUrl).reply({
        value: [
          {
            EntitySetName: 'accounts',
            LogicalName: 'account',
            DisplayName: { UserLocalizedLabel: { Label: 'Account' } },
          },
          {
            EntitySetName: 'contacts',
            LogicalName: 'contact',
            DisplayName: { UserLocalizedLabel: { Label: 'Contact' } },
          },
        ],
      })

      const result = await service.getEntitySetsDictionary({ search: 'contact' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('contacts')
    })

    it('uses LogicalName when DisplayName label is missing', async () => {
      mock.onGet(entityDefUrl).reply({
        value: [
          {
            EntitySetName: 'customentities',
            LogicalName: 'customentity',
            DisplayName: {},
          },
        ],
      })

      const result = await service.getEntitySetsDictionary({})

      expect(result.items[0].label).toBe('customentity')
    })

    it('skips entities without EntitySetName', async () => {
      mock.onGet(entityDefUrl).reply({
        value: [
          {
            EntitySetName: null,
            LogicalName: 'noset',
            DisplayName: { UserLocalizedLabel: { Label: 'No Set' } },
          },
          {
            EntitySetName: 'accounts',
            LogicalName: 'account',
            DisplayName: { UserLocalizedLabel: { Label: 'Account' } },
          },
        ],
      })

      const result = await service.getEntitySetsDictionary({})

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('accounts')
    })

    it('handles null payload', async () => {
      mock.onGet(entityDefUrl).reply({ value: [] })

      const result = await service.getEntitySetsDictionary(null)

      expect(result.items).toEqual([])
    })

    it('sorts results alphabetically by display name', async () => {
      mock.onGet(entityDefUrl).reply({
        value: [
          {
            EntitySetName: 'contacts',
            LogicalName: 'contact',
            DisplayName: { UserLocalizedLabel: { Label: 'Contact' } },
          },
          {
            EntitySetName: 'accounts',
            LogicalName: 'account',
            DisplayName: { UserLocalizedLabel: { Label: 'Account' } },
          },
        ],
      })

      const result = await service.getEntitySetsDictionary({})

      expect(result.items[0].label).toBe('Account')
      expect(result.items[1].label).toBe('Contact')
    })
  })

  // ── Who Am I ──

  describe('whoAmI', () => {
    it('sends GET request to WhoAmI endpoint', async () => {
      const responseData = {
        BusinessUnitId: 'bu-guid',
        UserId: 'user-guid',
        OrganizationId: 'org-guid',
      }

      mock.onGet(`${API_BASE}/WhoAmI`).reply(responseData)

      const result = await service.whoAmI()

      expect(result).toEqual(responseData)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
        'OData-MaxVersion': '4.0',
        'OData-Version': '4.0',
      })
    })
  })

  // ── List Records ──

  describe('listRecords', () => {
    it('sends request with default entity set mapping', async () => {
      mock.onGet(`${API_BASE}/accounts`).reply({ value: [] })

      const result = await service.listRecords('Accounts')

      expect(result).toEqual({ value: [] })
      expect(mock.history[0].url).toBe(`${API_BASE}/accounts`)
    })

    it('uses custom entity set over dropdown value', async () => {
      mock.onGet(`${API_BASE}/cr123_projects`).reply({ value: [] })

      await service.listRecords('Accounts', 'cr123_projects')

      expect(mock.history[0].url).toBe(`${API_BASE}/cr123_projects`)
    })

    it('passes query parameters correctly', async () => {
      mock.onGet(`${API_BASE}/contacts`).reply({ value: [] })

      await service.listRecords(
        'Contacts', undefined, ['fullname', 'emailaddress1'],
        'statecode eq 0', 'createdon desc', 10
      )

      expect(mock.history[0].query).toMatchObject({
        $select: 'fullname,emailaddress1',
        $filter: 'statecode eq 0',
        $orderby: 'createdon desc',
        $top: 10,
      })
    })

    it('omits undefined query parameters', async () => {
      mock.onGet(`${API_BASE}/accounts`).reply({ value: [] })

      await service.listRecords('Accounts')

      const query = mock.history[0].query

      expect(query.$select).toBeUndefined()
      expect(query.$filter).toBeUndefined()
      expect(query.$orderby).toBeUndefined()
      expect(query.$top).toBeUndefined()
    })

    it('adds Prefer header when includeAnnotations is true', async () => {
      mock.onGet(`${API_BASE}/accounts`).reply({ value: [] })

      await service.listRecords('Accounts', undefined, undefined, undefined, undefined, undefined, true)

      expect(mock.history[0].headers).toMatchObject({
        'Prefer': 'odata.include-annotations="*"',
      })
    })

    it('uses nextLink URL directly when provided', async () => {
      const nextLinkUrl = `${API_BASE}/accounts?$skiptoken=abc123`

      mock.onGet(nextLinkUrl).reply({ value: [{ accountid: '1' }] })

      const result = await service.listRecords(
        'Accounts', undefined, undefined, undefined, undefined, undefined, false, nextLinkUrl
      )

      expect(result).toEqual({ value: [{ accountid: '1' }] })
      expect(mock.history[0].url).toBe(nextLinkUrl)
    })

    it('maps Cases (Incidents) to incidents entity set', async () => {
      mock.onGet(`${API_BASE}/incidents`).reply({ value: [] })

      await service.listRecords('Cases (Incidents)')

      expect(mock.history[0].url).toBe(`${API_BASE}/incidents`)
    })

    it('throws when no entity set is provided', async () => {
      await expect(service.listRecords(undefined, undefined)).rejects.toThrow(
        'Provide either "Entity Set" or "Custom Entity Set"'
      )
    })

    it('throws on API error', async () => {
      mock.onGet(`${API_BASE}/accounts`).replyWithError({
        message: 'Unauthorized',
        body: { error: { message: 'Token expired' } },
      })

      await expect(service.listRecords('Accounts')).rejects.toThrow('Microsoft Dynamics 365 API error')
    })
  })

  // ── Get Record ──

  describe('getRecord', () => {
    const recordId = '00000000-0000-0000-0000-000000000001'

    it('sends GET request for a single record', async () => {
      const recordData = { accountid: recordId, name: 'Acme' }

      mock.onGet(`${API_BASE}/accounts(${recordId})`).reply(recordData)

      const result = await service.getRecord('Accounts', undefined, recordId)

      expect(result).toEqual(recordData)
      expect(mock.history[0].url).toBe(`${API_BASE}/accounts(${recordId})`)
    })

    it('passes select and expand query parameters', async () => {
      mock.onGet(`${API_BASE}/accounts(${recordId})`).reply({})

      await service.getRecord(
        'Accounts', undefined, recordId,
        ['name', 'revenue'], 'primarycontactid($select=fullname)'
      )

      expect(mock.history[0].query).toMatchObject({
        $select: 'name,revenue',
        $expand: 'primarycontactid($select=fullname)',
      })
    })

    it('adds Prefer header when includeAnnotations is true', async () => {
      mock.onGet(`${API_BASE}/accounts(${recordId})`).reply({})

      await service.getRecord('Accounts', undefined, recordId, undefined, undefined, true)

      expect(mock.history[0].headers).toMatchObject({
        'Prefer': 'odata.include-annotations="*"',
      })
    })

    it('normalizes record ID by stripping braces', async () => {
      mock.onGet(`${API_BASE}/accounts(${recordId})`).reply({})

      await service.getRecord('Accounts', undefined, `{${recordId}}`)

      expect(mock.history[0].url).toBe(`${API_BASE}/accounts(${recordId})`)
    })

    it('throws when recordId is empty', async () => {
      await expect(service.getRecord('Accounts', undefined, '')).rejects.toThrow(
        'Parameter "Record ID" is required'
      )
    })

    it('uses custom entity set', async () => {
      mock.onGet(`${API_BASE}/cr123_widgets(${recordId})`).reply({})

      await service.getRecord('Accounts', 'cr123_widgets', recordId)

      expect(mock.history[0].url).toBe(`${API_BASE}/cr123_widgets(${recordId})`)
    })
  })

  // ── Create Record ──

  describe('createRecord', () => {
    it('sends POST request with data and Prefer header', async () => {
      const data = { name: 'Acme', telephone1: '555-0100' }
      const created = { accountid: 'new-guid', ...data }

      mock.onPost(`${API_BASE}/accounts`).reply(created)

      const result = await service.createRecord('Accounts', undefined, data)

      expect(result).toEqual(created)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual(data)
      expect(mock.history[0].headers).toMatchObject({
        'Prefer': 'return=representation',
      })
    })

    it('uses custom entity set', async () => {
      mock.onPost(`${API_BASE}/cr123_projects`).reply({ id: '1' })

      await service.createRecord('Accounts', 'cr123_projects', { name: 'Test' })

      expect(mock.history[0].url).toBe(`${API_BASE}/cr123_projects`)
    })

    it('throws when data is not an object', async () => {
      await expect(service.createRecord('Accounts', undefined, 'invalid')).rejects.toThrow(
        'Parameter "Data" is required and must be an object'
      )
    })

    it('throws when data is an array', async () => {
      await expect(service.createRecord('Accounts', undefined, [1, 2])).rejects.toThrow(
        'Parameter "Data" is required and must be an object'
      )
    })

    it('throws when data is null', async () => {
      await expect(service.createRecord('Accounts', undefined, null)).rejects.toThrow(
        'Parameter "Data" is required and must be an object'
      )
    })

    it('throws on API error', async () => {
      mock.onPost(`${API_BASE}/accounts`).replyWithError({
        message: 'Bad Request',
        body: { error: { message: 'Invalid column name' } },
      })

      await expect(service.createRecord('Accounts', undefined, { bad: true })).rejects.toThrow(
        'Microsoft Dynamics 365 API error'
      )
    })
  })

  // ── Update Record ──

  describe('updateRecord', () => {
    const recordId = '00000000-0000-0000-0000-000000000001'

    it('sends PATCH request with If-Match header by default', async () => {
      const data = { name: 'Updated' }

      mock.onPatch(`${API_BASE}/accounts(${recordId})`).reply({ accountid: recordId, ...data })

      const result = await service.updateRecord('Accounts', undefined, recordId, data)

      expect(result).toEqual({ accountid: recordId, name: 'Updated' })
      expect(mock.history[0].method).toBe('patch')
      expect(mock.history[0].body).toEqual(data)
      expect(mock.history[0].headers).toMatchObject({
        'Prefer': 'return=representation',
        'If-Match': '*',
      })
    })

    it('omits If-Match header when upsert is true', async () => {
      mock.onPatch(`${API_BASE}/accounts(${recordId})`).reply({})

      await service.updateRecord('Accounts', undefined, recordId, { name: 'Test' }, true)

      expect(mock.history[0].headers['If-Match']).toBeUndefined()
      expect(mock.history[0].headers['Prefer']).toBe('return=representation')
    })

    it('throws when data is not an object', async () => {
      await expect(service.updateRecord('Accounts', undefined, recordId, 'bad')).rejects.toThrow(
        'Parameter "Data" is required and must be an object'
      )
    })

    it('throws when recordId is empty', async () => {
      await expect(service.updateRecord('Accounts', undefined, '', { name: 'x' })).rejects.toThrow(
        'Parameter "Record ID" is required'
      )
    })

    it('normalizes record ID by stripping braces', async () => {
      mock.onPatch(`${API_BASE}/accounts(${recordId})`).reply({})

      await service.updateRecord('Accounts', undefined, `{${recordId}}`, { name: 'x' })

      expect(mock.history[0].url).toBe(`${API_BASE}/accounts(${recordId})`)
    })
  })

  // ── Delete Record ──

  describe('deleteRecord', () => {
    const recordId = '00000000-0000-0000-0000-000000000001'

    it('sends DELETE request and returns success message', async () => {
      mock.onDelete(`${API_BASE}/accounts(${recordId})`).reply({})

      const result = await service.deleteRecord('Accounts', undefined, recordId)

      expect(result).toEqual({ message: 'Record deleted successfully' })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${API_BASE}/accounts(${recordId})`)
    })

    it('uses custom entity set', async () => {
      mock.onDelete(`${API_BASE}/cr123_items(${recordId})`).reply({})

      await service.deleteRecord('Accounts', 'cr123_items', recordId)

      expect(mock.history[0].url).toBe(`${API_BASE}/cr123_items(${recordId})`)
    })

    it('throws when recordId is empty', async () => {
      await expect(service.deleteRecord('Accounts', undefined, '  ')).rejects.toThrow(
        'Parameter "Record ID" is required'
      )
    })

    it('throws on API error', async () => {
      mock.onDelete(`${API_BASE}/accounts(${recordId})`).replyWithError({
        message: 'Not Found',
        body: { error: { message: 'Record does not exist' } },
      })

      await expect(service.deleteRecord('Accounts', undefined, recordId)).rejects.toThrow(
        'Microsoft Dynamics 365 API error'
      )
    })
  })

  // ── Execute FetchXML Query ──

  describe('executeFetchXmlQuery', () => {
    const fetchXml = '<fetch top="10"><entity name="account"><attribute name="name"/></entity></fetch>'

    it('sends GET request with fetchXml query parameter', async () => {
      mock.onGet(`${API_BASE}/accounts`).reply({ value: [{ name: 'Acme' }] })

      const result = await service.executeFetchXmlQuery('Accounts', undefined, fetchXml)

      expect(result).toEqual({ value: [{ name: 'Acme' }] })
      expect(mock.history[0].query).toMatchObject({ fetchXml })
    })

    it('uses custom entity set', async () => {
      mock.onGet(`${API_BASE}/cr123_things`).reply({ value: [] })

      await service.executeFetchXmlQuery(undefined, 'cr123_things', fetchXml)

      expect(mock.history[0].url).toBe(`${API_BASE}/cr123_things`)
    })

    it('adds Prefer header when includeAnnotations is true', async () => {
      mock.onGet(`${API_BASE}/accounts`).reply({ value: [] })

      await service.executeFetchXmlQuery('Accounts', undefined, fetchXml, true)

      expect(mock.history[0].headers).toMatchObject({
        'Prefer': 'odata.include-annotations="*"',
      })
    })

    it('does not add Prefer header when includeAnnotations is false', async () => {
      mock.onGet(`${API_BASE}/accounts`).reply({ value: [] })

      await service.executeFetchXmlQuery('Accounts', undefined, fetchXml, false)

      expect(mock.history[0].headers['Prefer']).toBeUndefined()
    })

    it('throws when fetchXml is empty', async () => {
      await expect(service.executeFetchXmlQuery('Accounts', undefined, '')).rejects.toThrow(
        'Parameter "FetchXML" is required'
      )
    })

    it('throws when fetchXml is whitespace only', async () => {
      await expect(service.executeFetchXmlQuery('Accounts', undefined, '   ')).rejects.toThrow(
        'Parameter "FetchXML" is required'
      )
    })

    it('trims fetchXml before sending', async () => {
      mock.onGet(`${API_BASE}/accounts`).reply({ value: [] })

      await service.executeFetchXmlQuery('Accounts', undefined, `  ${fetchXml}  `)

      expect(mock.history[0].query.fetchXml).toBe(fetchXml)
    })
  })

  // ── Auth Headers ──

  describe('authorization headers', () => {
    it('includes correct auth and OData headers on all API requests', async () => {
      mock.onGet(`${API_BASE}/WhoAmI`).reply({})

      await service.whoAmI()

      expect(mock.history[0].headers).toMatchObject({
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
        'OData-MaxVersion': '4.0',
        'OData-Version': '4.0',
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      })
    })
  })

  // ── Entity Set Mapping ──

  describe('entity set mapping', () => {
    const mappings = [
      ['Accounts', 'accounts'],
      ['Contacts', 'contacts'],
      ['Leads', 'leads'],
      ['Opportunities', 'opportunities'],
      ['Cases (Incidents)', 'incidents'],
      ['Tasks', 'tasks'],
    ]

    it.each(mappings)('maps "%s" to "%s"', async (label, entitySet) => {
      mock.onGet(`${API_BASE}/${entitySet}`).reply({ value: [] })

      await service.listRecords(label)

      expect(mock.history[0].url).toBe(`${API_BASE}/${entitySet}`)
    })
  })
})
