'use strict'

const { createSandbox } = require('../../../service-sandbox')

const CLIENT_ID = 'test-client-id'
const CLIENT_SECRET = 'test-client-secret'
const BASE = 'https://api.ramp.com/developer/v1'

const TOKEN_RESPONSE = {
  access_token: 'test-access-token',
  expires_in: 3600,
}

describe('RampService', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      environment: 'production',
    })
    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()
  })

  afterEach(() => {
    mock.reset()
    // Clear token cache between tests
    service.tokenCache = null
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Registration ──

  describe('service registration', () => {
    it('registers with correct config items', () => {
      const configs = sandbox.getConfigItems()

      expect(configs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'clientId', required: true, shared: false }),
          expect.objectContaining({ name: 'clientSecret', required: true, shared: false }),
          expect.objectContaining({ name: 'environment', required: false, shared: false }),
        ])
      )
    })
  })

  // ── Authentication ──

  describe('authentication', () => {
    it('acquires access token with client credentials', async () => {
      mock.onPost(`${BASE}/token`).reply(TOKEN_RESPONSE)
      mock.onGet(`${BASE}/users`).reply({ data: [], page: {} })

      await service.listUsers()

      expect(mock.history[0].url).toBe(`${BASE}/token`)
      expect(mock.history[0].headers).toMatchObject({
        Authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`,
      })
    })

    it('throws on authentication failure', async () => {
      mock.onPost(`${BASE}/token`).replyWithError({ message: 'Invalid credentials' })

      await expect(service.listUsers()).rejects.toThrow('Ramp authentication failed')
    })

    it('caches token and reuses it', async () => {
      mock.onPost(`${BASE}/token`).reply(TOKEN_RESPONSE)
      mock.onGet(`${BASE}/users`).reply({ data: [], page: {} })

      await service.listUsers()
      await service.listUsers()

      // Token endpoint should only be called once
      const tokenCalls = mock.history.filter(c => c.url === `${BASE}/token`)
      expect(tokenCalls).toHaveLength(1)
    })
  })

  // ── Dictionaries ──

  describe('getUsersDictionary', () => {
    it('returns mapped items with label, value, and note', async () => {
      mock.onPost(`${BASE}/token`).reply(TOKEN_RESPONSE)
      mock.onGet(`${BASE}/users`).reply({
        data: [{ id: 'usr_1', first_name: 'Jane', last_name: 'Doe', email: 'jane@example.com' }],
        page: { next: null },
      })

      const result = await service.getUsersDictionary({})

      expect(result).toEqual({
        items: [{ label: 'Jane Doe', value: 'usr_1', note: 'jane@example.com' }],
        cursor: null,
      })
    })

    it('filters by case-insensitive search on name', async () => {
      mock.onPost(`${BASE}/token`).reply(TOKEN_RESPONSE)
      mock.onGet(`${BASE}/users`).reply({
        data: [
          { id: 'usr_1', first_name: 'Jane', last_name: 'Doe', email: 'jane@example.com' },
          { id: 'usr_2', first_name: 'Bob', last_name: 'Smith', email: 'bob@example.com' },
        ],
        page: {},
      })

      const result = await service.getUsersDictionary({ search: 'jane' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('usr_1')
    })

    it('filters by email search', async () => {
      mock.onPost(`${BASE}/token`).reply(TOKEN_RESPONSE)
      mock.onGet(`${BASE}/users`).reply({
        data: [
          { id: 'usr_1', first_name: 'Jane', last_name: 'Doe', email: 'jane@example.com' },
          { id: 'usr_2', first_name: 'Bob', last_name: 'Smith', email: 'bob@example.com' },
        ],
        page: {},
      })

      const result = await service.getUsersDictionary({ search: 'bob@' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('usr_2')
    })

    it('handles null payload', async () => {
      mock.onPost(`${BASE}/token`).reply(TOKEN_RESPONSE)
      mock.onGet(`${BASE}/users`).reply({
        data: [{ id: 'usr_1', first_name: 'Jane', last_name: 'Doe', email: 'jane@test.com' }],
        page: {},
      })

      const result = await service.getUsersDictionary(null)

      expect(result.items).toHaveLength(1)
      expect(result.cursor).toBeNull()
    })

    it('handles empty data', async () => {
      mock.onPost(`${BASE}/token`).reply(TOKEN_RESPONSE)
      mock.onGet(`${BASE}/users`).reply({ data: null, page: {} })

      const result = await service.getUsersDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('passes cursor as start query param', async () => {
      mock.onPost(`${BASE}/token`).reply(TOKEN_RESPONSE)
      mock.onGet(`${BASE}/users`).reply({ data: [], page: {} })

      await service.getUsersDictionary({ cursor: 'next-page-token' })

      const apiCall = mock.history.find(c => c.url === `${BASE}/users`)
      expect(apiCall.query).toMatchObject({ start: 'next-page-token', page_size: 25 })
    })

    it('returns next cursor from page', async () => {
      mock.onPost(`${BASE}/token`).reply(TOKEN_RESPONSE)
      mock.onGet(`${BASE}/users`).reply({
        data: [{ id: 'usr_1', first_name: 'A', last_name: 'B', email: 'a@b.com' }],
        page: { next: 'cursor-123' },
      })

      const result = await service.getUsersDictionary({})

      expect(result.cursor).toBe('cursor-123')
    })

    it('uses email as label when name is empty', async () => {
      mock.onPost(`${BASE}/token`).reply(TOKEN_RESPONSE)
      mock.onGet(`${BASE}/users`).reply({
        data: [{ id: 'usr_1', first_name: '', last_name: '', email: 'noname@test.com' }],
        page: {},
      })

      const result = await service.getUsersDictionary({})

      expect(result.items[0].label).toBe('noname@test.com')
    })
  })

  describe('getDepartmentsDictionary', () => {
    it('returns mapped departments', async () => {
      mock.onPost(`${BASE}/token`).reply(TOKEN_RESPONSE)
      mock.onGet(`${BASE}/departments`).reply({
        data: [{ id: 'dpt_1', name: 'Engineering' }],
        page: { next: null },
      })

      const result = await service.getDepartmentsDictionary({})

      expect(result).toEqual({
        items: [{ label: 'Engineering', value: 'dpt_1', note: 'ID: dpt_1' }],
        cursor: null,
      })
    })

    it('filters by search', async () => {
      mock.onPost(`${BASE}/token`).reply(TOKEN_RESPONSE)
      mock.onGet(`${BASE}/departments`).reply({
        data: [
          { id: 'dpt_1', name: 'Engineering' },
          { id: 'dpt_2', name: 'Marketing' },
        ],
        page: {},
      })

      const result = await service.getDepartmentsDictionary({ search: 'eng' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('dpt_1')
    })

    it('handles null payload', async () => {
      mock.onPost(`${BASE}/token`).reply(TOKEN_RESPONSE)
      mock.onGet(`${BASE}/departments`).reply({ data: [], page: {} })

      const result = await service.getDepartmentsDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getLocationsDictionary', () => {
    it('returns mapped locations', async () => {
      mock.onPost(`${BASE}/token`).reply(TOKEN_RESPONSE)
      mock.onGet(`${BASE}/locations`).reply({
        data: [{ id: 'loc_1', name: 'NYC HQ' }],
        page: { next: null },
      })

      const result = await service.getLocationsDictionary({})

      expect(result).toEqual({
        items: [{ label: 'NYC HQ', value: 'loc_1', note: 'ID: loc_1' }],
        cursor: null,
      })
    })

    it('filters by search', async () => {
      mock.onPost(`${BASE}/token`).reply(TOKEN_RESPONSE)
      mock.onGet(`${BASE}/locations`).reply({
        data: [
          { id: 'loc_1', name: 'NYC HQ' },
          { id: 'loc_2', name: 'SF Office' },
        ],
        page: {},
      })

      const result = await service.getLocationsDictionary({ search: 'SF' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('loc_2')
    })
  })

  describe('getVendorsDictionary', () => {
    it('returns mapped vendors', async () => {
      mock.onPost(`${BASE}/token`).reply(TOKEN_RESPONSE)
      mock.onGet(`${BASE}/vendors`).reply({
        data: [{ id: 'vnd_1', name: 'Acme Supplies' }],
        page: { next: null },
      })

      const result = await service.getVendorsDictionary({})

      expect(result).toEqual({
        items: [{ label: 'Acme Supplies', value: 'vnd_1', note: 'ID: vnd_1' }],
        cursor: null,
      })
    })

    it('passes search to API query', async () => {
      mock.onPost(`${BASE}/token`).reply(TOKEN_RESPONSE)
      mock.onGet(`${BASE}/vendors`).reply({ data: [], page: {} })

      await service.getVendorsDictionary({ search: 'acme' })

      const apiCall = mock.history.find(c => c.url === `${BASE}/vendors`)
      expect(apiCall.query).toMatchObject({ search: 'acme' })
    })

    it('uses business_name as label fallback', async () => {
      mock.onPost(`${BASE}/token`).reply(TOKEN_RESPONSE)
      mock.onGet(`${BASE}/vendors`).reply({
        data: [{ id: 'vnd_1', name: null, business_name: 'Fallback Inc' }],
        page: {},
      })

      const result = await service.getVendorsDictionary({})

      expect(result.items[0].label).toBe('Fallback Inc')
    })
  })

  describe('getCardsDictionary', () => {
    it('returns mapped cards', async () => {
      mock.onPost(`${BASE}/token`).reply(TOKEN_RESPONSE)
      mock.onGet(`${BASE}/cards`).reply({
        data: [{ id: 'crd_1', display_name: 'Marketing Card', last_four: '1234', state: 'ACTIVE' }],
        page: { next: null },
      })

      const result = await service.getCardsDictionary({})

      expect(result).toEqual({
        items: [{ label: 'Marketing Card', value: 'crd_1', note: '••1234 ACTIVE' }],
        cursor: null,
      })
    })

    it('filters by display_name search', async () => {
      mock.onPost(`${BASE}/token`).reply(TOKEN_RESPONSE)
      mock.onGet(`${BASE}/cards`).reply({
        data: [
          { id: 'crd_1', display_name: 'Marketing Card', last_four: '1234', state: 'ACTIVE' },
          { id: 'crd_2', display_name: 'Dev Card', last_four: '5678', state: 'ACTIVE' },
        ],
        page: {},
      })

      const result = await service.getCardsDictionary({ search: 'dev' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('crd_2')
    })

    it('uses fallback label when display_name is missing', async () => {
      mock.onPost(`${BASE}/token`).reply(TOKEN_RESPONSE)
      mock.onGet(`${BASE}/cards`).reply({
        data: [{ id: 'crd_1', display_name: '', last_four: '9999', state: 'FROZEN' }],
        page: {},
      })

      const result = await service.getCardsDictionary({})

      expect(result.items[0].label).toBe('Card 9999')
    })

    it('handles missing last_four and state', async () => {
      mock.onPost(`${BASE}/token`).reply(TOKEN_RESPONSE)
      mock.onGet(`${BASE}/cards`).reply({
        data: [{ id: 'crd_1', display_name: 'Test' }],
        page: {},
      })

      const result = await service.getCardsDictionary({})

      expect(result.items[0].note).toBe('••----')
    })
  })

  // ── Transactions ──

  describe('listTransactions', () => {
    it('sends correct request with defaults', async () => {
      mock.onPost(`${BASE}/token`).reply(TOKEN_RESPONSE)
      mock.onGet(`${BASE}/transactions`).reply({ data: [], page: {} })

      const result = await service.listTransactions()

      expect(result).toEqual({ data: [], page: {} })
      const apiCall = mock.history.find(c => c.url === `${BASE}/transactions`)
      expect(apiCall.headers).toMatchObject({ Authorization: 'Bearer test-access-token' })
      expect(apiCall.query).toMatchObject({ page_size: 25 })
    })

    it('passes all filter parameters', async () => {
      mock.onPost(`${BASE}/token`).reply(TOKEN_RESPONSE)
      mock.onGet(`${BASE}/transactions`).reply({ data: [], page: {} })

      await service.listTransactions('2026-01-01', '2026-12-31', 'crd_1', 'usr_1', 'dpt_1', 'CLEARED', 10, 'cursor-abc')

      const apiCall = mock.history.find(c => c.url === `${BASE}/transactions`)
      expect(apiCall.query).toMatchObject({
        from_date: '2026-01-01',
        to_date: '2026-12-31',
        card_id: 'crd_1',
        user_id: 'usr_1',
        department_id: 'dpt_1',
        state: 'CLEARED',
        page_size: 10,
        start: 'cursor-abc',
      })
    })

    it('omits state when ALL is passed', async () => {
      mock.onPost(`${BASE}/token`).reply(TOKEN_RESPONSE)
      mock.onGet(`${BASE}/transactions`).reply({ data: [], page: {} })

      await service.listTransactions(null, null, null, null, null, 'ALL')

      const apiCall = mock.history.find(c => c.url === `${BASE}/transactions`)
      expect(apiCall.query.state).toBeUndefined()
    })

    it('throws on API error', async () => {
      mock.onPost(`${BASE}/token`).reply(TOKEN_RESPONSE)
      mock.onGet(`${BASE}/transactions`).replyWithError({ message: 'Server error' })

      await expect(service.listTransactions()).rejects.toThrow('Ramp API error')
    })
  })

  describe('getTransaction', () => {
    it('sends correct request', async () => {
      mock.onPost(`${BASE}/token`).reply(TOKEN_RESPONSE)
      mock.onGet(`${BASE}/transactions/txn_001`).reply({ id: 'txn_001', amount: 42.5 })

      const result = await service.getTransaction('txn_001')

      expect(result).toEqual({ id: 'txn_001', amount: 42.5 })
    })

    it('throws when transactionId is missing', async () => {
      await expect(service.getTransaction()).rejects.toThrow('Transaction ID is required')
    })
  })

  // ── Cards ──

  describe('listCards', () => {
    it('sends correct request with defaults', async () => {
      mock.onPost(`${BASE}/token`).reply(TOKEN_RESPONSE)
      mock.onGet(`${BASE}/cards`).reply({ data: [], page: {} })

      await service.listCards()

      const apiCall = mock.history.find(c => c.url === `${BASE}/cards`)
      expect(apiCall.query).toMatchObject({ page_size: 25 })
    })

    it('passes filter parameters', async () => {
      mock.onPost(`${BASE}/token`).reply(TOKEN_RESPONSE)
      mock.onGet(`${BASE}/cards`).reply({ data: [], page: {} })

      await service.listCards('usr_1', 'dpt_1', 'ACTIVE', 10, 'cursor-x')

      const apiCall = mock.history.find(c => c.url === `${BASE}/cards`)
      expect(apiCall.query).toMatchObject({
        user_id: 'usr_1',
        department_id: 'dpt_1',
        state: 'ACTIVE',
        page_size: 10,
        start: 'cursor-x',
      })
    })

    it('omits state when ALL is passed', async () => {
      mock.onPost(`${BASE}/token`).reply(TOKEN_RESPONSE)
      mock.onGet(`${BASE}/cards`).reply({ data: [], page: {} })

      await service.listCards(null, null, 'ALL')

      const apiCall = mock.history.find(c => c.url === `${BASE}/cards`)
      expect(apiCall.query.state).toBeUndefined()
    })
  })

  describe('getCard', () => {
    it('returns card data', async () => {
      mock.onPost(`${BASE}/token`).reply(TOKEN_RESPONSE)
      mock.onGet(`${BASE}/cards/crd_1`).reply({ id: 'crd_1', display_name: 'Test Card' })

      const result = await service.getCard('crd_1')

      expect(result).toEqual({ id: 'crd_1', display_name: 'Test Card' })
    })

    it('throws when cardId is missing', async () => {
      await expect(service.getCard()).rejects.toThrow('Card ID is required')
    })
  })

  describe('issueCard', () => {
    it('sends POST with correct body', async () => {
      mock.onPost(`${BASE}/token`).reply(TOKEN_RESPONSE)
      mock.onPost(`${BASE}/cards/deferred`).reply({ id: 'task_001', status: 'STARTED' })

      const restrictions = { amount: 500000, interval: 'MONTHLY' }
      const result = await service.issueCard('usr_1', 'New Card', restrictions)

      expect(result).toEqual({ id: 'task_001', status: 'STARTED' })
      const apiCall = mock.history.find(c => c.url === `${BASE}/cards/deferred`)
      expect(apiCall.body).toEqual({
        user_id: 'usr_1',
        display_name: 'New Card',
        spending_restrictions: restrictions,
      })
    })

    it('includes fulfillment when provided', async () => {
      mock.onPost(`${BASE}/token`).reply(TOKEN_RESPONSE)
      mock.onPost(`${BASE}/cards/deferred`).reply({ id: 'task_002', status: 'STARTED' })

      const fulfillment = { shipping: { recipient_address: { city: 'NYC' } } }
      await service.issueCard('usr_1', 'Physical Card', { amount: 1000, interval: 'DAILY' }, fulfillment)

      const apiCall = mock.history.find(c => c.url === `${BASE}/cards/deferred`)
      expect(apiCall.body.fulfillment).toEqual(fulfillment)
    })

    it('omits fulfillment when not provided', async () => {
      mock.onPost(`${BASE}/token`).reply(TOKEN_RESPONSE)
      mock.onPost(`${BASE}/cards/deferred`).reply({ id: 'task_003', status: 'STARTED' })

      await service.issueCard('usr_1', 'Virtual Card', { amount: 1000, interval: 'TOTAL' })

      const apiCall = mock.history.find(c => c.url === `${BASE}/cards/deferred`)
      expect(apiCall.body.fulfillment).toBeUndefined()
    })

    it('throws when userId is missing', async () => {
      await expect(service.issueCard(null, 'Name', {})).rejects.toThrow('Cardholder user ID is required')
    })

    it('throws when displayName is missing', async () => {
      await expect(service.issueCard('usr_1', null, {})).rejects.toThrow('Card display name is required')
    })

    it('throws when spendingRestrictions is missing', async () => {
      await expect(service.issueCard('usr_1', 'Name')).rejects.toThrow('Spending restrictions are required')
    })
  })

  describe('freezeCard', () => {
    it('sends POST and returns success', async () => {
      mock.onPost(`${BASE}/token`).reply(TOKEN_RESPONSE)
      mock.onPost(`${BASE}/cards/crd_1/freeze`).reply({})

      const result = await service.freezeCard('crd_1')

      expect(result).toEqual({ success: true })
    })

    it('throws when cardId is missing', async () => {
      await expect(service.freezeCard()).rejects.toThrow('Card ID is required')
    })
  })

  describe('unfreezeCard', () => {
    it('sends POST and returns success', async () => {
      mock.onPost(`${BASE}/token`).reply(TOKEN_RESPONSE)
      mock.onPost(`${BASE}/cards/crd_1/unfreeze`).reply({})

      const result = await service.unfreezeCard('crd_1')

      expect(result).toEqual({ success: true })
    })

    it('throws when cardId is missing', async () => {
      await expect(service.unfreezeCard()).rejects.toThrow('Card ID is required')
    })
  })

  describe('terminateCard', () => {
    it('sends POST and returns success', async () => {
      mock.onPost(`${BASE}/token`).reply(TOKEN_RESPONSE)
      mock.onPost(`${BASE}/cards/crd_1/termination`).reply({})

      const result = await service.terminateCard('crd_1')

      expect(result).toEqual({ success: true })
    })

    it('throws when cardId is missing', async () => {
      await expect(service.terminateCard()).rejects.toThrow('Card ID is required')
    })
  })

  // ── Users ──

  describe('listUsers', () => {
    it('sends correct request with defaults', async () => {
      mock.onPost(`${BASE}/token`).reply(TOKEN_RESPONSE)
      mock.onGet(`${BASE}/users`).reply({ data: [], page: {} })

      await service.listUsers()

      const apiCall = mock.history.find(c => c.url === `${BASE}/users`)
      expect(apiCall.query).toMatchObject({ page_size: 25 })
    })

    it('passes all filter parameters', async () => {
      mock.onPost(`${BASE}/token`).reply(TOKEN_RESPONSE)
      mock.onGet(`${BASE}/users`).reply({ data: [], page: {} })

      await service.listUsers('dpt_1', 'loc_1', 'BUSINESS_ADMIN', 10, 'cursor-y')

      const apiCall = mock.history.find(c => c.url === `${BASE}/users`)
      expect(apiCall.query).toMatchObject({
        department_id: 'dpt_1',
        location_id: 'loc_1',
        role: 'BUSINESS_ADMIN',
        page_size: 10,
        start: 'cursor-y',
      })
    })

    it('omits role when ALL is passed', async () => {
      mock.onPost(`${BASE}/token`).reply(TOKEN_RESPONSE)
      mock.onGet(`${BASE}/users`).reply({ data: [], page: {} })

      await service.listUsers(null, null, 'ALL')

      const apiCall = mock.history.find(c => c.url === `${BASE}/users`)
      expect(apiCall.query.role).toBeUndefined()
    })
  })

  describe('getUser', () => {
    it('returns user data', async () => {
      mock.onPost(`${BASE}/token`).reply(TOKEN_RESPONSE)
      mock.onGet(`${BASE}/users/usr_1`).reply({ id: 'usr_1', first_name: 'Jane' })

      const result = await service.getUser('usr_1')

      expect(result).toEqual({ id: 'usr_1', first_name: 'Jane' })
    })

    it('throws when userId is missing', async () => {
      await expect(service.getUser()).rejects.toThrow('User ID is required')
    })
  })

  describe('inviteUser', () => {
    it('sends POST with correct body', async () => {
      mock.onPost(`${BASE}/token`).reply(TOKEN_RESPONSE)
      mock.onPost(`${BASE}/users/deferred`).reply({ id: 'task_001', status: 'STARTED' })

      const result = await service.inviteUser('Jane', 'Doe', 'jane@test.com', 'BUSINESS_USER', 'dpt_1', 'loc_1')

      expect(result).toEqual({ id: 'task_001', status: 'STARTED' })
      const apiCall = mock.history.find(c => c.url === `${BASE}/users/deferred`)
      expect(apiCall.body).toEqual({
        first_name: 'Jane',
        last_name: 'Doe',
        email: 'jane@test.com',
        role: 'BUSINESS_USER',
        department_id: 'dpt_1',
        location_id: 'loc_1',
      })
    })

    it('omits optional fields when not provided', async () => {
      mock.onPost(`${BASE}/token`).reply(TOKEN_RESPONSE)
      mock.onPost(`${BASE}/users/deferred`).reply({ id: 'task_002', status: 'STARTED' })

      await service.inviteUser('Jane', 'Doe', 'jane@test.com', 'BUSINESS_USER')

      const apiCall = mock.history.find(c => c.url === `${BASE}/users/deferred`)
      expect(apiCall.body).toEqual({
        first_name: 'Jane',
        last_name: 'Doe',
        email: 'jane@test.com',
        role: 'BUSINESS_USER',
      })
    })

    it('throws when firstName is missing', async () => {
      await expect(service.inviteUser(null, 'Doe', 'a@b.com', 'BUSINESS_USER')).rejects.toThrow('First name is required')
    })

    it('throws when lastName is missing', async () => {
      await expect(service.inviteUser('Jane', null, 'a@b.com', 'BUSINESS_USER')).rejects.toThrow('Last name is required')
    })

    it('throws when email is missing', async () => {
      await expect(service.inviteUser('Jane', 'Doe', null, 'BUSINESS_USER')).rejects.toThrow('Email is required')
    })

    it('throws when role is missing', async () => {
      await expect(service.inviteUser('Jane', 'Doe', 'a@b.com')).rejects.toThrow('Role is required')
    })
  })

  // ── Organization ──

  describe('listDepartments', () => {
    it('sends correct request', async () => {
      mock.onPost(`${BASE}/token`).reply(TOKEN_RESPONSE)
      mock.onGet(`${BASE}/departments`).reply({ data: [{ id: 'dpt_1', name: 'Eng' }], page: {} })

      const result = await service.listDepartments()

      expect(result.data).toHaveLength(1)
      const apiCall = mock.history.find(c => c.url === `${BASE}/departments`)
      expect(apiCall.query).toMatchObject({ page_size: 25 })
    })

    it('passes limit and cursor', async () => {
      mock.onPost(`${BASE}/token`).reply(TOKEN_RESPONSE)
      mock.onGet(`${BASE}/departments`).reply({ data: [], page: {} })

      await service.listDepartments(10, 'cursor-d')

      const apiCall = mock.history.find(c => c.url === `${BASE}/departments`)
      expect(apiCall.query).toMatchObject({ page_size: 10, start: 'cursor-d' })
    })
  })

  describe('listLocations', () => {
    it('sends correct request', async () => {
      mock.onPost(`${BASE}/token`).reply(TOKEN_RESPONSE)
      mock.onGet(`${BASE}/locations`).reply({ data: [], page: {} })

      await service.listLocations()

      const apiCall = mock.history.find(c => c.url === `${BASE}/locations`)
      expect(apiCall.query).toMatchObject({ page_size: 25 })
    })

    it('passes limit and cursor', async () => {
      mock.onPost(`${BASE}/token`).reply(TOKEN_RESPONSE)
      mock.onGet(`${BASE}/locations`).reply({ data: [], page: {} })

      await service.listLocations(5, 'cursor-l')

      const apiCall = mock.history.find(c => c.url === `${BASE}/locations`)
      expect(apiCall.query).toMatchObject({ page_size: 5, start: 'cursor-l' })
    })
  })

  // ── Vendors ──

  describe('listVendors', () => {
    it('sends correct request with defaults', async () => {
      mock.onPost(`${BASE}/token`).reply(TOKEN_RESPONSE)
      mock.onGet(`${BASE}/vendors`).reply({ data: [], page: {} })

      await service.listVendors()

      const apiCall = mock.history.find(c => c.url === `${BASE}/vendors`)
      expect(apiCall.query).toMatchObject({ page_size: 25 })
    })

    it('passes search, limit, and cursor', async () => {
      mock.onPost(`${BASE}/token`).reply(TOKEN_RESPONSE)
      mock.onGet(`${BASE}/vendors`).reply({ data: [], page: {} })

      await service.listVendors('acme', 10, 'cursor-v')

      const apiCall = mock.history.find(c => c.url === `${BASE}/vendors`)
      expect(apiCall.query).toMatchObject({ search: 'acme', page_size: 10, start: 'cursor-v' })
    })
  })

  describe('getVendor', () => {
    it('returns vendor data', async () => {
      mock.onPost(`${BASE}/token`).reply(TOKEN_RESPONSE)
      mock.onGet(`${BASE}/vendors/vnd_1`).reply({ id: 'vnd_1', name: 'Acme' })

      const result = await service.getVendor('vnd_1')

      expect(result).toEqual({ id: 'vnd_1', name: 'Acme' })
    })

    it('throws when vendorId is missing', async () => {
      await expect(service.getVendor()).rejects.toThrow('Vendor ID is required')
    })
  })

  describe('createVendor', () => {
    it('sends POST with correct body', async () => {
      mock.onPost(`${BASE}/token`).reply(TOKEN_RESPONSE)
      mock.onPost(`${BASE}/vendors`).reply({ id: 'vnd_new', name: 'New Vendor' })

      const result = await service.createVendor('New Vendor', 'ACH', '123456', '789012', 'John', 'john@v.com', 'Net 30')

      expect(result).toEqual({ id: 'vnd_new', name: 'New Vendor' })
      const apiCall = mock.history.find(c => c.url === `${BASE}/vendors` && c.method === 'post')
      expect(apiCall.body).toEqual({
        name: 'New Vendor',
        payment_method: 'ACH',
        account_number: '123456',
        routing_number: '789012',
        contact_name: 'John',
        contact_email: 'john@v.com',
        notes: 'Net 30',
      })
    })

    it('omits optional fields when not provided', async () => {
      mock.onPost(`${BASE}/token`).reply(TOKEN_RESPONSE)
      mock.onPost(`${BASE}/vendors`).reply({ id: 'vnd_new2', name: 'Minimal Vendor' })

      await service.createVendor('Minimal Vendor', 'CHECK')

      const apiCall = mock.history.find(c => c.url === `${BASE}/vendors` && c.method === 'post')
      expect(apiCall.body).toEqual({
        name: 'Minimal Vendor',
        payment_method: 'CHECK',
      })
    })

    it('throws when name is missing', async () => {
      await expect(service.createVendor(null, 'ACH')).rejects.toThrow('Vendor name is required')
    })

    it('throws when paymentMethod is missing', async () => {
      await expect(service.createVendor('Test')).rejects.toThrow('Payment method is required')
    })
  })

  // ── Bills ──

  describe('listBills', () => {
    it('sends correct request with defaults', async () => {
      mock.onPost(`${BASE}/token`).reply(TOKEN_RESPONSE)
      mock.onGet(`${BASE}/bills`).reply({ data: [], page: {} })

      await service.listBills()

      const apiCall = mock.history.find(c => c.url === `${BASE}/bills`)
      expect(apiCall.query).toMatchObject({ page_size: 25 })
    })

    it('passes all filter parameters', async () => {
      mock.onPost(`${BASE}/token`).reply(TOKEN_RESPONSE)
      mock.onGet(`${BASE}/bills`).reply({ data: [], page: {} })

      await service.listBills('vnd_1', 'OPEN', 10, 'cursor-b')

      const apiCall = mock.history.find(c => c.url === `${BASE}/bills`)
      expect(apiCall.query).toMatchObject({
        vendor_id: 'vnd_1',
        status: 'OPEN',
        page_size: 10,
        start: 'cursor-b',
      })
    })

    it('omits status when ALL is passed', async () => {
      mock.onPost(`${BASE}/token`).reply(TOKEN_RESPONSE)
      mock.onGet(`${BASE}/bills`).reply({ data: [], page: {} })

      await service.listBills(null, 'ALL')

      const apiCall = mock.history.find(c => c.url === `${BASE}/bills`)
      expect(apiCall.query.status).toBeUndefined()
    })
  })

  describe('getBill', () => {
    it('returns bill data', async () => {
      mock.onPost(`${BASE}/token`).reply(TOKEN_RESPONSE)
      mock.onGet(`${BASE}/bills/bil_1`).reply({ id: 'bil_1', amount: 12500 })

      const result = await service.getBill('bil_1')

      expect(result).toEqual({ id: 'bil_1', amount: 12500 })
    })

    it('throws when billId is missing', async () => {
      await expect(service.getBill()).rejects.toThrow('Bill ID is required')
    })
  })

  // ── Reimbursements ──

  describe('listReimbursements', () => {
    it('sends correct request with defaults', async () => {
      mock.onPost(`${BASE}/token`).reply(TOKEN_RESPONSE)
      mock.onGet(`${BASE}/reimbursements`).reply({ data: [], page: {} })

      await service.listReimbursements()

      const apiCall = mock.history.find(c => c.url === `${BASE}/reimbursements`)
      expect(apiCall.query).toMatchObject({ page_size: 25 })
    })

    it('passes all filter parameters', async () => {
      mock.onPost(`${BASE}/token`).reply(TOKEN_RESPONSE)
      mock.onGet(`${BASE}/reimbursements`).reply({ data: [], page: {} })

      await service.listReimbursements('usr_1', 'PENDING', '2026-01-01', '2026-12-31', 10, 'cursor-r')

      const apiCall = mock.history.find(c => c.url === `${BASE}/reimbursements`)
      expect(apiCall.query).toMatchObject({
        user_id: 'usr_1',
        status: 'PENDING',
        from_date: '2026-01-01',
        to_date: '2026-12-31',
        page_size: 10,
        start: 'cursor-r',
      })
    })

    it('omits status when ALL is passed', async () => {
      mock.onPost(`${BASE}/token`).reply(TOKEN_RESPONSE)
      mock.onGet(`${BASE}/reimbursements`).reply({ data: [], page: {} })

      await service.listReimbursements(null, 'ALL')

      const apiCall = mock.history.find(c => c.url === `${BASE}/reimbursements`)
      expect(apiCall.query.status).toBeUndefined()
    })
  })

  describe('getReimbursement', () => {
    it('returns reimbursement data', async () => {
      mock.onPost(`${BASE}/token`).reply(TOKEN_RESPONSE)
      mock.onGet(`${BASE}/reimbursements/rem_1`).reply({ id: 'rem_1', amount: 4500 })

      const result = await service.getReimbursement('rem_1')

      expect(result).toEqual({ id: 'rem_1', amount: 4500 })
    })

    it('throws when reimbursementId is missing', async () => {
      await expect(service.getReimbursement()).rejects.toThrow('Reimbursement ID is required')
    })
  })

  describe('approveReimbursement', () => {
    it('sends POST to approve endpoint', async () => {
      mock.onPost(`${BASE}/token`).reply(TOKEN_RESPONSE)
      mock.onPost(`${BASE}/reimbursements/rem_1/approve`).reply({ id: 'rem_1', status: 'APPROVED' })

      const result = await service.approveReimbursement('rem_1')

      expect(result).toEqual({ id: 'rem_1', status: 'APPROVED' })
    })

    it('throws when reimbursementId is missing', async () => {
      await expect(service.approveReimbursement()).rejects.toThrow('Reimbursement ID is required')
    })
  })

  // ── Triggers ──

  describe('handleTriggerPollingForEvent', () => {
    it('delegates to the correct event handler', async () => {
      mock.onPost(`${BASE}/token`).reply(TOKEN_RESPONSE)
      mock.onGet(`${BASE}/transactions`).reply({
        data: [{ id: 'txn_1' }],
        page: {},
      })

      const result = await service.handleTriggerPollingForEvent({
        eventName: 'onNewTransaction',
        triggerData: {},
        learningMode: true,
      })

      expect(result.events).toHaveLength(1)
      expect(result.events[0].id).toBe('txn_1')
    })
  })

  describe('onNewTransaction', () => {
    it('returns latest item in learning mode', async () => {
      mock.onPost(`${BASE}/token`).reply(TOKEN_RESPONSE)
      mock.onGet(`${BASE}/transactions`).reply({
        data: [{ id: 'txn_1' }, { id: 'txn_2' }],
        page: {},
      })

      const result = await service.handleTriggerPollingForEvent({
        eventName: 'onNewTransaction',
        triggerData: {},
        learningMode: true,
      })

      expect(result.events).toEqual([{ id: 'txn_1' }])
      expect(result.state).toBeNull()
    })

    it('seeds state on first poll (no prior state)', async () => {
      mock.onPost(`${BASE}/token`).reply(TOKEN_RESPONSE)
      mock.onGet(`${BASE}/transactions`).reply({
        data: [{ id: 'txn_1' }, { id: 'txn_2' }],
        page: {},
      })

      const result = await service.handleTriggerPollingForEvent({
        eventName: 'onNewTransaction',
        triggerData: {},
        learningMode: false,
        state: null,
      })

      expect(result.events).toEqual([])
      expect(result.state.ids).toEqual(['txn_1', 'txn_2'])
    })

    it('emits only new events on subsequent polls', async () => {
      mock.onPost(`${BASE}/token`).reply(TOKEN_RESPONSE)
      mock.onGet(`${BASE}/transactions`).reply({
        data: [{ id: 'txn_3' }, { id: 'txn_2' }, { id: 'txn_1' }],
        page: {},
      })

      const result = await service.handleTriggerPollingForEvent({
        eventName: 'onNewTransaction',
        triggerData: {},
        learningMode: false,
        state: { ids: ['txn_1', 'txn_2'] },
      })

      expect(result.events).toEqual([{ id: 'txn_3' }])
      expect(result.state.ids).toContain('txn_3')
      expect(result.state.ids).toContain('txn_1')
      expect(result.state.ids).toContain('txn_2')
    })

    it('passes cardId and userId filter to API', async () => {
      mock.onPost(`${BASE}/token`).reply(TOKEN_RESPONSE)
      mock.onGet(`${BASE}/transactions`).reply({ data: [], page: {} })

      await service.handleTriggerPollingForEvent({
        eventName: 'onNewTransaction',
        triggerData: { cardId: 'crd_1', userId: 'usr_1' },
        learningMode: true,
      })

      const apiCall = mock.history.find(c => c.url === `${BASE}/transactions`)
      expect(apiCall.query).toMatchObject({ card_id: 'crd_1', user_id: 'usr_1' })
    })

    it('returns empty events in learning mode when no data', async () => {
      mock.onPost(`${BASE}/token`).reply(TOKEN_RESPONSE)
      mock.onGet(`${BASE}/transactions`).reply({ data: [], page: {} })

      const result = await service.handleTriggerPollingForEvent({
        eventName: 'onNewTransaction',
        triggerData: {},
        learningMode: true,
      })

      expect(result.events).toEqual([])
    })
  })

  describe('onNewBill', () => {
    it('returns latest item in learning mode', async () => {
      mock.onPost(`${BASE}/token`).reply(TOKEN_RESPONSE)
      mock.onGet(`${BASE}/bills`).reply({
        data: [{ id: 'bil_1' }],
        page: {},
      })

      const result = await service.handleTriggerPollingForEvent({
        eventName: 'onNewBill',
        triggerData: {},
        learningMode: true,
      })

      expect(result.events).toEqual([{ id: 'bil_1' }])
    })

    it('passes vendorId filter to API', async () => {
      mock.onPost(`${BASE}/token`).reply(TOKEN_RESPONSE)
      mock.onGet(`${BASE}/bills`).reply({ data: [], page: {} })

      await service.handleTriggerPollingForEvent({
        eventName: 'onNewBill',
        triggerData: { vendorId: 'vnd_1' },
        learningMode: true,
      })

      const apiCall = mock.history.find(c => c.url === `${BASE}/bills`)
      expect(apiCall.query).toMatchObject({ vendor_id: 'vnd_1' })
    })
  })

  describe('onNewReimbursement', () => {
    it('returns latest item in learning mode', async () => {
      mock.onPost(`${BASE}/token`).reply(TOKEN_RESPONSE)
      mock.onGet(`${BASE}/reimbursements`).reply({
        data: [{ id: 'rem_1' }],
        page: {},
      })

      const result = await service.handleTriggerPollingForEvent({
        eventName: 'onNewReimbursement',
        triggerData: {},
        learningMode: true,
      })

      expect(result.events).toEqual([{ id: 'rem_1' }])
    })

    it('passes userId filter to API', async () => {
      mock.onPost(`${BASE}/token`).reply(TOKEN_RESPONSE)
      mock.onGet(`${BASE}/reimbursements`).reply({ data: [], page: {} })

      await service.handleTriggerPollingForEvent({
        eventName: 'onNewReimbursement',
        triggerData: { userId: 'usr_1' },
        learningMode: true,
      })

      const apiCall = mock.history.find(c => c.url === `${BASE}/reimbursements`)
      expect(apiCall.query).toMatchObject({ user_id: 'usr_1' })
    })
  })

  // ── Environment config ──

  describe('environment config', () => {
    it('uses production base URL by default', () => {
      expect(service.baseUrl).toBe('https://api.ramp.com')
    })
  })
})
