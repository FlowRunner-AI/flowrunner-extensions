'use strict'

const path = require('path')
const { createSandbox } = require('../../../service-sandbox')

const RESOURCE_URL = 'https://acme.halopsa.com'
const CLIENT_ID = 'test-client-id'
const CLIENT_SECRET = 'test-client-secret'
const API_BASE = `${RESOURCE_URL}/api`
const TOKEN_URL = `${RESOURCE_URL}/auth/token`

const TOKEN_RESPONSE = { access_token: 'test-access-token', expires_in: 3600 }

const SERVICE_MODULE = path.resolve(__dirname, '../src/index.js')

function freshRequire() {
  delete require.cache[SERVICE_MODULE]
  require(SERVICE_MODULE)
}

describe('HaloPSA Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({
      resourceUrl: RESOURCE_URL,
      authUrl: '',
      tenant: '',
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
    })

    freshRequire()
    service = sandbox.getService()
    mock = sandbox.getRequestMock()
  })

  afterEach(() => {
    mock.reset()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // Helper: set up the token endpoint mock (needed for calls when token is not yet cached)
  function mockToken() {
    mock.onPost(TOKEN_URL).reply(TOKEN_RESPONSE)
  }

  // Helper: get the last call from mock history (the actual API call, skipping any token call)
  function lastApiCall() {
    return mock.history[mock.history.length - 1]
  }

  // ── Registration ──

  describe('service registration', () => {
    it('registers with correct config items', () => {
      const configs = sandbox.getConfigItems()

      expect(configs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'resourceUrl', required: true, shared: false }),
          expect.objectContaining({ name: 'authUrl', required: false, shared: false }),
          expect.objectContaining({ name: 'tenant', required: false, shared: false }),
          expect.objectContaining({ name: 'clientId', required: true, shared: false }),
          expect.objectContaining({ name: 'clientSecret', required: true, shared: false }),
        ])
      )
    })
  })

  // ── Token acquisition ──

  describe('token acquisition', () => {
    it('obtains a token via client_credentials grant before API calls', async () => {
      mockToken()
      mock.onGet(`${API_BASE}/Agent`).reply([])

      await service.getAgents()

      // First call is the token POST
      const tokenCall = mock.history[0]

      expect(tokenCall.method).toBe('post')
      expect(tokenCall.url).toBe(TOKEN_URL)
      expect(tokenCall.headers).toMatchObject({
        'Content-Type': 'application/x-www-form-urlencoded',
      })
      expect(tokenCall.body).toContain('grant_type=client_credentials')
      expect(tokenCall.body).toContain(`client_id=${CLIENT_ID}`)
      expect(tokenCall.body).toContain(`client_secret=${CLIENT_SECRET}`)
      expect(tokenCall.body).toContain('scope=all')
    })

    it('uses cached token for subsequent calls', async () => {
      // Token was cached from the previous test
      mock.onGet(`${API_BASE}/Agent`).reply([])

      await service.getAgents()

      // Only the API call should be in history (no token request)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
    })
  })

  // ── Tickets ──

  describe('getTickets', () => {
    it('sends correct request with defaults (no filters)', async () => {
      mockToken()
      mock.onGet(`${API_BASE}/Tickets`).reply({ tickets: [{ id: 1 }], record_count: 1 })

      const result = await service.getTickets()

      const apiCall = lastApiCall()

      expect(apiCall.method).toBe('get')
      expect(apiCall.url).toBe(`${API_BASE}/Tickets`)
      expect(apiCall.headers).toMatchObject({
        Authorization: 'Bearer test-access-token',
        'Content-Type': 'application/json',
      })
      expect(result).toEqual({ items: [{ id: 1 }], count: 1 })
    })

    it('passes search and clientId filters', async () => {
      mockToken()
      mock.onGet(`${API_BASE}/Tickets`).reply({ tickets: [], record_count: 0 })

      await service.getTickets('email', 12)

      expect(lastApiCall().query).toMatchObject({ search: 'email', client_id: 12 })
    })

    it('passes openOnly flag', async () => {
      mockToken()
      mock.onGet(`${API_BASE}/Tickets`).reply({ tickets: [], record_count: 0 })

      await service.getTickets(undefined, undefined, true)

      expect(lastApiCall().query).toMatchObject({ open_only: true })
    })

    it('passes pagination parameters with pageinate flag', async () => {
      mockToken()
      mock.onGet(`${API_BASE}/Tickets`).reply({ tickets: [], record_count: 0 })

      await service.getTickets(undefined, undefined, false, 2, 25)

      expect(lastApiCall().query).toMatchObject({ pageinate: true, page_no: 2, page_size: 25 })
    })

    it('does not pass pagination when only pageNo is provided', async () => {
      mockToken()
      mock.onGet(`${API_BASE}/Tickets`).reply({ tickets: [], record_count: 0 })

      await service.getTickets(undefined, undefined, false, 2)

      const q = lastApiCall().query

      expect(q.pageinate).toBeUndefined()
      expect(q.page_no).toBeUndefined()
    })
  })

  describe('getTicket', () => {
    it('sends GET to /Tickets/{id}', async () => {
      mockToken()
      const ticketData = { id: 42, summary: 'Test ticket' }

      mock.onGet(`${API_BASE}/Tickets/42`).reply(ticketData)

      const result = await service.getTicket(42)

      expect(lastApiCall().url).toBe(`${API_BASE}/Tickets/42`)
      expect(result).toEqual(ticketData)
    })
  })

  describe('createTicket', () => {
    it('sends POST with required fields as JSON array', async () => {
      mockToken()
      mock.onPost(`${API_BASE}/Tickets`).reply({ id: 100, summary: 'New ticket' })

      await service.createTicket('New ticket', 'Full details', 12)

      expect(lastApiCall().method).toBe('post')
      expect(lastApiCall().body).toEqual([{
        summary: 'New ticket',
        details: 'Full details',
        client_id: 12,
      }])
    })

    it('includes optional fields when provided', async () => {
      mockToken()
      mock.onPost(`${API_BASE}/Tickets`).reply({ id: 101 })

      await service.createTicket('Ticket', 'Details', 12, 3, 45, 88, 5, 2, 1)

      const body = lastApiCall().body[0]

      expect(body).toMatchObject({
        summary: 'Ticket',
        details: 'Details',
        client_id: 12,
        tickettype_id: 3,
        site_id: 45,
        user_id: 88,
        agent_id: 5,
        priority_id: 2,
        status_id: 1,
      })
    })

    it('omits optional fields when not provided', async () => {
      mockToken()
      mock.onPost(`${API_BASE}/Tickets`).reply({ id: 102 })

      await service.createTicket('Ticket', 'Details', 12)

      const body = lastApiCall().body[0]

      expect(body).not.toHaveProperty('tickettype_id')
      expect(body).not.toHaveProperty('site_id')
      expect(body).not.toHaveProperty('user_id')
      expect(body).not.toHaveProperty('agent_id')
      expect(body).not.toHaveProperty('priority_id')
      expect(body).not.toHaveProperty('status_id')
    })
  })

  describe('updateTicket', () => {
    it('sends POST with ticket id and updated fields', async () => {
      mockToken()
      mock.onPost(`${API_BASE}/Tickets`).reply({ id: 42, summary: 'Updated' })

      await service.updateTicket(42, 'Updated', undefined, 9)

      const body = lastApiCall().body[0]

      expect(body).toEqual({ id: 42, summary: 'Updated', status_id: 9 })
    })

    it('throws when no fields besides id are provided', async () => {
      await expect(service.updateTicket(42)).rejects.toThrow('Nothing to update')
    })

    it('ignores empty string for summary and details', async () => {
      mockToken()
      mock.onPost(`${API_BASE}/Tickets`).reply({ id: 42 })

      // updateTicket(ticketId, summary, details, statusId, priorityId, agentId)
      await service.updateTicket(42, '', '', undefined, 5)

      const body = lastApiCall().body[0]

      expect(body).toEqual({ id: 42, priority_id: 5 })
    })
  })

  describe('deleteTicket', () => {
    it('sends DELETE to /Tickets/{id} and returns confirmation', async () => {
      mockToken()
      mock.onDelete(`${API_BASE}/Tickets/42`).reply({})

      const result = await service.deleteTicket(42)

      expect(lastApiCall().method).toBe('delete')
      expect(lastApiCall().url).toBe(`${API_BASE}/Tickets/42`)
      expect(result).toEqual({ ticketId: 42, deleted: true })
    })
  })

  // ── Actions ──

  describe('getActions', () => {
    it('sends GET with ticket_id query', async () => {
      mockToken()
      mock.onGet(`${API_BASE}/Actions`).reply({
        actions: [{ id: 9001, ticket_id: 42 }],
        record_count: 1,
      })

      const result = await service.getActions(42)

      expect(lastApiCall().query).toMatchObject({ ticket_id: 42 })
      expect(result).toEqual({ items: [{ id: 9001, ticket_id: 42 }], count: 1 })
    })
  })

  describe('createAction', () => {
    it('sends POST with required fields and default outcome', async () => {
      mockToken()
      mock.onPost(`${API_BASE}/Actions`).reply({ id: 9002, ticket_id: 42 })

      await service.createAction(42, 'Investigating the issue.')

      const body = lastApiCall().body[0]

      expect(body).toEqual({
        ticket_id: 42,
        note: 'Investigating the issue.',
        outcome: 'Note',
      })
    })

    it('includes custom outcome', async () => {
      mockToken()
      mock.onPost(`${API_BASE}/Actions`).reply({ id: 9003 })

      await service.createAction(42, 'Called user', 'Phone Call')

      expect(lastApiCall().body[0].outcome).toBe('Phone Call')
    })

    it('sets hiddenfromuser when private note is enabled', async () => {
      mockToken()
      mock.onPost(`${API_BASE}/Actions`).reply({ id: 9004 })

      await service.createAction(42, 'Internal note', 'Note', true)

      expect(lastApiCall().body[0].hiddenfromuser).toBe(true)
    })

    it('does not set hiddenfromuser when false', async () => {
      mockToken()
      mock.onPost(`${API_BASE}/Actions`).reply({ id: 9005 })

      await service.createAction(42, 'Public note', 'Note', false)

      expect(lastApiCall().body[0]).not.toHaveProperty('hiddenfromuser')
    })
  })

  // ── Clients ──

  describe('getClients', () => {
    it('sends GET with no filters by default', async () => {
      mockToken()
      mock.onGet(`${API_BASE}/Client`).reply({ clients: [{ id: 12, name: 'Acme' }], record_count: 1 })

      const result = await service.getClients()

      expect(lastApiCall().url).toBe(`${API_BASE}/Client`)
      expect(result).toEqual({ items: [{ id: 12, name: 'Acme' }], count: 1 })
    })

    it('passes search and pagination params', async () => {
      mockToken()
      mock.onGet(`${API_BASE}/Client`).reply({ clients: [], record_count: 0 })

      await service.getClients('acme', 1, 25)

      expect(lastApiCall().query).toMatchObject({
        search: 'acme',
        pageinate: true,
        page_no: 1,
        page_size: 25,
      })
    })
  })

  describe('getClient', () => {
    it('sends GET to /Client/{id}', async () => {
      mockToken()
      mock.onGet(`${API_BASE}/Client/12`).reply({ id: 12, name: 'Acme Inc' })

      const result = await service.getClient(12)

      expect(result).toEqual({ id: 12, name: 'Acme Inc' })
    })
  })

  describe('createClient', () => {
    it('sends POST with required name', async () => {
      mockToken()
      mock.onPost(`${API_BASE}/Client`).reply({ id: 13, name: 'Globex' })

      await service.createClient('Globex')

      expect(lastApiCall().body).toEqual([{ name: 'Globex' }])
    })

    it('includes optional fields when provided', async () => {
      mockToken()
      mock.onPost(`${API_BASE}/Client`).reply({ id: 14 })

      await service.createClient('Globex', 'https://globex.com', 'info@globex.com', 3)

      expect(lastApiCall().body[0]).toMatchObject({
        name: 'Globex',
        website: 'https://globex.com',
        email: 'info@globex.com',
        toplevel_id: 3,
      })
    })

    it('omits empty string optional fields', async () => {
      mockToken()
      mock.onPost(`${API_BASE}/Client`).reply({ id: 15 })

      await service.createClient('Globex', '', '')

      const body = lastApiCall().body[0]

      expect(body).not.toHaveProperty('website')
      expect(body).not.toHaveProperty('email')
    })
  })

  describe('updateClient', () => {
    it('sends POST with id and updated fields', async () => {
      mockToken()
      mock.onPost(`${API_BASE}/Client`).reply({ id: 12 })

      await service.updateClient(12, 'Acme International')

      expect(lastApiCall().body[0]).toEqual({ id: 12, name: 'Acme International' })
    })

    it('throws when no fields besides id are provided', async () => {
      await expect(service.updateClient(12)).rejects.toThrow('Nothing to update')
    })
  })

  // ── Sites ──

  describe('getSites', () => {
    it('sends GET with optional clientId and search', async () => {
      mockToken()
      mock.onGet(`${API_BASE}/Site`).reply({ sites: [{ id: 45 }], record_count: 1 })

      const result = await service.getSites(12, 'office')

      expect(lastApiCall().query).toMatchObject({ client_id: 12, search: 'office' })
      expect(result).toEqual({ items: [{ id: 45 }], count: 1 })
    })

    it('omits empty filters', async () => {
      mockToken()
      mock.onGet(`${API_BASE}/Site`).reply({ sites: [], record_count: 0 })

      await service.getSites()

      expect(lastApiCall().query.client_id).toBeUndefined()
      expect(lastApiCall().query.search).toBeUndefined()
    })
  })

  // ── Users ──

  describe('getUsers', () => {
    it('sends GET with search and clientId', async () => {
      mockToken()
      mock.onGet(`${API_BASE}/Users`).reply({ users: [{ id: 88 }], record_count: 1 })

      const result = await service.getUsers('jane', 12)

      expect(lastApiCall().query).toMatchObject({ search: 'jane', client_id: 12 })
      expect(result).toEqual({ items: [{ id: 88 }], count: 1 })
    })
  })

  describe('getUser', () => {
    it('sends GET to /Users/{id}', async () => {
      mockToken()
      mock.onGet(`${API_BASE}/Users/88`).reply({ id: 88, name: 'Jane Doe' })

      const result = await service.getUser(88)

      expect(result).toEqual({ id: 88, name: 'Jane Doe' })
    })
  })

  describe('createUser', () => {
    it('sends POST with required fields', async () => {
      mockToken()
      mock.onPost(`${API_BASE}/Users`).reply({ id: 89 })

      await service.createUser('John Smith', 'john@acme.com', 45)

      expect(lastApiCall().body).toEqual([{
        name: 'John Smith',
        emailaddress: 'john@acme.com',
        site_id: 45,
      }])
    })

    it('includes phone number when provided', async () => {
      mockToken()
      mock.onPost(`${API_BASE}/Users`).reply({ id: 90 })

      await service.createUser('John Smith', 'john@acme.com', 45, '+1 555 0100')

      expect(lastApiCall().body[0].phonenumber).toBe('+1 555 0100')
    })

    it('omits phone number when empty string', async () => {
      mockToken()
      mock.onPost(`${API_BASE}/Users`).reply({ id: 91 })

      await service.createUser('John Smith', 'john@acme.com', 45, '')

      expect(lastApiCall().body[0]).not.toHaveProperty('phonenumber')
    })
  })

  // ── Assets ──

  describe('getAssets', () => {
    it('sends GET with clientId and search', async () => {
      mockToken()
      mock.onGet(`${API_BASE}/Asset`).reply({ assets: [{ id: 301 }], record_count: 1 })

      const result = await service.getAssets(12, 'laptop')

      expect(lastApiCall().query).toMatchObject({ client_id: 12, search: 'laptop' })
      expect(result).toEqual({ items: [{ id: 301 }], count: 1 })
    })
  })

  describe('getAsset', () => {
    it('sends GET to /Asset/{id}', async () => {
      mockToken()
      mock.onGet(`${API_BASE}/Asset/301`).reply({ id: 301, key_field: 'Laptop' })

      const result = await service.getAsset(301)

      expect(result).toEqual({ id: 301, key_field: 'Laptop' })
    })
  })

  describe('createAsset', () => {
    it('sends POST with required fields', async () => {
      mockToken()
      mock.onPost(`${API_BASE}/Asset`).reply({ id: 302 })

      await service.createAsset(2, 12)

      expect(lastApiCall().body).toEqual([{
        assettype_id: 2,
        client_id: 12,
      }])
    })

    it('includes optional fields when provided', async () => {
      mockToken()
      mock.onPost(`${API_BASE}/Asset`).reply({ id: 303 })

      await service.createAsset(2, 12, 'SRV-010', 45)

      expect(lastApiCall().body[0]).toMatchObject({
        inventory_number: 'SRV-010',
        site_id: 45,
      })
    })

    it('omits inventory_number when empty string', async () => {
      mockToken()
      mock.onPost(`${API_BASE}/Asset`).reply({ id: 304 })

      await service.createAsset(2, 12, '')

      expect(lastApiCall().body[0]).not.toHaveProperty('inventory_number')
    })
  })

  // ── Agents ──

  describe('getAgents', () => {
    it('handles bare array response', async () => {
      mockToken()
      mock.onGet(`${API_BASE}/Agent`).reply([
        { id: 5, name: 'Alex Agent', isdisabled: false },
      ])

      const result = await service.getAgents()

      expect(lastApiCall().query).toMatchObject({ includeenabled: true })
      expect(result).toEqual({
        items: [{ id: 5, name: 'Alex Agent', isdisabled: false }],
        count: 1,
      })
    })

    it('handles object response with agents key', async () => {
      mockToken()
      mock.onGet(`${API_BASE}/Agent`).reply({
        agents: [{ id: 5, name: 'Alex' }],
        record_count: 1,
      })

      const result = await service.getAgents()

      expect(result).toEqual({ items: [{ id: 5, name: 'Alex' }], count: 1 })
    })

    it('passes includedisabled when includeInactive is true', async () => {
      mockToken()
      mock.onGet(`${API_BASE}/Agent`).reply([])

      await service.getAgents(true)

      expect(lastApiCall().query).toMatchObject({
        includeenabled: true,
        includedisabled: true,
      })
    })

    it('does not pass includedisabled when includeInactive is false', async () => {
      mockToken()
      mock.onGet(`${API_BASE}/Agent`).reply([])

      await service.getAgents(false)

      expect(lastApiCall().query.includedisabled).toBeUndefined()
    })
  })

  // ── Invoices ──

  describe('getInvoices', () => {
    it('sends GET with optional clientId', async () => {
      mockToken()
      mock.onGet(`${API_BASE}/Invoice`).reply({
        invoices: [{ id: 700, total: 1250 }],
        record_count: 1,
      })

      const result = await service.getInvoices(12)

      expect(lastApiCall().query).toMatchObject({ client_id: 12 })
      expect(result).toEqual({ items: [{ id: 700, total: 1250 }], count: 1 })
    })

    it('omits clientId when not provided', async () => {
      mockToken()
      mock.onGet(`${API_BASE}/Invoice`).reply({ invoices: [], record_count: 0 })

      await service.getInvoices()

      expect(lastApiCall().query.client_id).toBeUndefined()
    })
  })

  // ── Dictionaries ──

  describe('getClientsDictionary', () => {
    it('returns formatted dictionary items with pagination cursor', async () => {
      mockToken()
      mock.onGet(`${API_BASE}/Client`).reply({
        clients: [
          { id: 12, name: 'Acme Inc', toplevel_name: 'Acme Group' },
          { id: 13, name: 'Globex Corp' },
        ],
        record_count: 75,
      })

      const result = await service.getClientsDictionary({ search: 'a' })

      expect(lastApiCall().query).toMatchObject({
        search: 'a',
        pageinate: true,
        page_no: 1,
        page_size: 50,
      })

      expect(result.items).toEqual([
        { label: 'Acme Inc', value: '12', note: 'Acme Group' },
        { label: 'Globex Corp', value: '13', note: undefined },
      ])
      expect(result.cursor).toBe('2')
    })

    it('returns no cursor when all items fit on one page', async () => {
      mockToken()
      mock.onGet(`${API_BASE}/Client`).reply({
        clients: [{ id: 12, name: 'Acme' }],
        record_count: 1,
      })

      const result = await service.getClientsDictionary()

      expect(result.cursor).toBeUndefined()
    })

    it('uses cursor for page number', async () => {
      mockToken()
      mock.onGet(`${API_BASE}/Client`).reply({ clients: [], record_count: 75 })

      await service.getClientsDictionary({ cursor: '3' })

      expect(lastApiCall().query).toMatchObject({ page_no: 3 })
    })
  })

  describe('getAgentsDictionary', () => {
    it('returns formatted dictionary items from bare array', async () => {
      mockToken()
      mock.onGet(`${API_BASE}/Agent`).reply([
        { id: 5, name: 'Alex Agent', email: 'alex@msp.com' },
        { id: 6, name: 'Bob Tech', email: 'bob@msp.com' },
      ])

      const result = await service.getAgentsDictionary()

      expect(result.items).toEqual([
        { label: 'Alex Agent', value: '5', note: 'alex@msp.com' },
        { label: 'Bob Tech', value: '6', note: 'bob@msp.com' },
      ])
    })

    it('filters agents by search text (name)', async () => {
      mockToken()
      mock.onGet(`${API_BASE}/Agent`).reply([
        { id: 5, name: 'Alex Agent', email: 'alex@msp.com' },
        { id: 6, name: 'Bob Tech', email: 'bob@msp.com' },
      ])

      const result = await service.getAgentsDictionary({ search: 'alex' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toBe('Alex Agent')
    })

    it('filters agents by search text (email)', async () => {
      mockToken()
      mock.onGet(`${API_BASE}/Agent`).reply([
        { id: 5, name: 'Alex Agent', email: 'alex@msp.com' },
        { id: 6, name: 'Bob Tech', email: 'bob@msp.com' },
      ])

      const result = await service.getAgentsDictionary({ search: 'bob@' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toBe('Bob Tech')
    })

    it('handles object response with agents key', async () => {
      mockToken()
      mock.onGet(`${API_BASE}/Agent`).reply({
        agents: [{ id: 5, name: 'Alex', email: 'alex@msp.com' }],
      })

      const result = await service.getAgentsDictionary()

      expect(result.items).toHaveLength(1)
    })
  })

  // ── Error handling ──

  describe('API error handling', () => {
    it('wraps API errors with status and message', async () => {
      mockToken()
      mock.onGet(`${API_BASE}/Tickets/999`).replyWithError({
        message: 'Not Found',
        body: { message: 'Ticket not found' },
        status: 404,
      })

      await expect(service.getTicket(999)).rejects.toThrow('HaloPSA API error (404): Ticket not found')
    })

    it('falls back to error.message when body has no message field', async () => {
      mockToken()
      mock.onGet(`${API_BASE}/Tickets/999`).replyWithError({
        message: 'Server Error',
        status: 500,
      })

      await expect(service.getTicket(999)).rejects.toThrow('HaloPSA API error (500): Server Error')
    })

    it('handles string body in error', async () => {
      mockToken()
      mock.onGet(`${API_BASE}/Tickets/999`).replyWithError({
        message: 'fail',
        body: 'Something went wrong on the server',
        status: 500,
      })

      await expect(service.getTicket(999)).rejects.toThrow('Something went wrong on the server')
    })
  })

  // ── Token error handling (uses expired token trick to force re-fetch) ──

  describe('token error handling', () => {
    it('throws when token endpoint fails', async () => {
      // Force token expiration so next call re-fetches
      service.accessTokenExpiresAt = 0

      mock.onPost(TOKEN_URL).replyWithError({
        message: 'invalid_client',
        body: { error: 'invalid_client', error_description: 'Bad credentials' },
      })

      await expect(service.getAgents()).rejects.toThrow('Failed to obtain a HaloPSA access token')
    })

    it('throws when token endpoint returns no access_token', async () => {
      service.accessTokenExpiresAt = 0

      mock.onPost(TOKEN_URL).reply({ token_type: 'bearer' })

      await expect(service.getAgents()).rejects.toThrow('did not return an access token')
    })

    it('recovers after token error with valid token', async () => {
      // Restore valid token state
      service.accessTokenExpiresAt = 0
      mockToken()
      mock.onGet(`${API_BASE}/Agent`).reply([])

      const result = await service.getAgents()

      expect(result).toEqual({ items: [], count: 0 })
    })
  })

  // ── Token URL construction ──

  describe('token URL construction', () => {
    it('uses resourceUrl/auth/token when no authUrl', () => {
      expect(service.tokenUrl).toBe(`${RESOURCE_URL}/auth/token`)
    })

    it('sets apiBaseUrl to resourceUrl/api', () => {
      expect(service.apiBaseUrl).toBe(`${RESOURCE_URL}/api`)
    })
  })
})
