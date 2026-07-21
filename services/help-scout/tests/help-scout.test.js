'use strict'

const { createSandbox } = require('../../../service-sandbox')

const APP_ID = 'test-app-id'
const APP_SECRET = 'test-app-secret'
const BASE = 'https://api.helpscout.net/v2'
const TOKEN_URL = 'https://api.helpscout.net/v2/oauth2/token'
const ACCESS_TOKEN = 'test-access-token-123'

describe('Help Scout Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ appId: APP_ID, appSecret: APP_SECRET })
    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()
  })

  afterEach(() => {
    mock.reset()
    // Invalidate the cached token so each test starts fresh
    service.accessToken = null
    service.accessTokenExpiresAt = 0
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  /**
   * Helper: set up the token endpoint mock so #getAccessToken succeeds.
   */
  function mockToken() {
    mock.onPost(TOKEN_URL).reply({ access_token: ACCESS_TOKEN, expires_in: 172800 })
  }

  /**
   * Helper: get the last request in mock history (the API call, not the token call).
   */
  function lastRequest() {
    return mock.history[mock.history.length - 1]
  }

  /**
   * Helper: get a request at a specific offset from the end (0 = last, 1 = second to last, etc.).
   */
  function requestFromEnd(offset) {
    return mock.history[mock.history.length - 1 - offset]
  }

  // ── Registration ──

  describe('service registration', () => {
    it('registers with correct config items', () => {
      expect(sandbox.getConfigItems()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'appId', required: true, shared: false }),
          expect.objectContaining({ name: 'appSecret', required: true, shared: false }),
        ])
      )
    })
  })

  // ── Token acquisition ──

  describe('token acquisition', () => {
    it('sends client_credentials token request with correct body', async () => {
      mockToken()
      mock.onGet(`${BASE}/users/me`).reply({ id: 1 })

      await service.getMe()

      const tokenReq = mock.history[0]
      expect(tokenReq.method).toBe('post')
      expect(tokenReq.url).toBe(TOKEN_URL)
      expect(tokenReq.headers).toMatchObject({ 'Content-Type': 'application/x-www-form-urlencoded' })
      expect(tokenReq.body).toContain('grant_type=client_credentials')
      expect(tokenReq.body).toContain(`client_id=${APP_ID}`)
      expect(tokenReq.body).toContain(`client_secret=${APP_SECRET}`)
    })

    it('throws on token failure', async () => {
      mock.onPost(TOKEN_URL).replyWithError({
        message: 'Unauthorized',
        body: { error_description: 'Invalid client_id' },
      })

      await expect(service.getMe()).rejects.toThrow('Invalid client_id')
    })
  })

  // ── Conversations ──

  describe('createConversation', () => {
    it('sends correct POST with required params and fetches created conversation', async () => {
      mockToken()
      mock.onPost(`${BASE}/conversations`).reply({
        status: 201,
        headers: { 'Resource-Id': '12345' },
        body: null,
      })
      mock.onGet(`${BASE}/conversations/12345`).reply({
        id: 12345,
        subject: 'Test',
        status: 'active',
      })

      const result = await service.createConversation(
        'Test', '85742', 'customer@example.com', 'Hello', 'Customer', 'Email', 'Active',
      )

      // The POST to /conversations is the second request (after token)
      const createReq = mock.history[1]
      expect(createReq.method).toBe('post')
      expect(createReq.url).toBe(`${BASE}/conversations`)
      expect(createReq.headers).toMatchObject({ Authorization: `Bearer ${ACCESS_TOKEN}` })
      expect(createReq.body).toMatchObject({
        subject: 'Test',
        mailboxId: 85742,
        type: 'email',
        status: 'active',
        customer: { email: 'customer@example.com' },
        threads: [{ type: 'customer', text: 'Hello', customer: { email: 'customer@example.com' } }],
      })

      expect(result).toEqual({ id: 12345, subject: 'Test', status: 'active' })
    })

    it('includes tags and assignTo when provided', async () => {
      mockToken()
      mock.onPost(`${BASE}/conversations`).reply({
        status: 201,
        headers: { 'Resource-Id': '999' },
        body: null,
      })
      mock.onGet(`${BASE}/conversations/999`).reply({ id: 999 })

      await service.createConversation(
        'Tagged', '100', 'a@b.com', 'Body', 'Reply', 'Chat', 'Pending',
        'First', 'Last', ['vip', 'urgent'], '256',
      )

      const createReq = mock.history[1]
      expect(createReq.body.tags).toEqual(['vip', 'urgent'])
      expect(createReq.body.assignTo).toBe(256)
      expect(createReq.body.type).toBe('chat')
      expect(createReq.body.status).toBe('pending')
      expect(createReq.body.customer).toMatchObject({ firstName: 'First', lastName: 'Last' })
    })

    it('uses note thread type without customer on thread', async () => {
      mockToken()
      mock.onPost(`${BASE}/conversations`).reply({
        status: 201,
        headers: { 'Resource-Id': '111' },
        body: null,
      })
      mock.onGet(`${BASE}/conversations/111`).reply({ id: 111 })

      await service.createConversation(
        'Note conv', '100', 'c@d.com', 'Internal', 'Note', 'Email', 'Active',
      )

      const thread = mock.history[1].body.threads[0]
      expect(thread.type).toBe('note')
      expect(thread.customer).toBeUndefined()
    })

    it('returns fallback when Resource-Id header is missing', async () => {
      mockToken()
      mock.onPost(`${BASE}/conversations`).reply({
        status: 201,
        headers: {},
        body: null,
      })

      const result = await service.createConversation(
        'No ID', '100', 'e@f.com', 'Body', 'Customer', 'Email', 'Active',
      )

      expect(result).toEqual({ id: null, created: true })
    })
  })

  describe('getConversation', () => {
    it('fetches conversation by ID without threads', async () => {
      mockToken()
      mock.onGet(`${BASE}/conversations/12345`).reply({ id: 12345, subject: 'Test' })

      const result = await service.getConversation(12345, false)

      expect(result).toEqual({ id: 12345, subject: 'Test' })
      expect(lastRequest().url).toBe(`${BASE}/conversations/12345`)
      expect(lastRequest().query).not.toHaveProperty('embed')
    })

    it('includes embed=threads when includeThreads is true', async () => {
      mockToken()
      mock.onGet(`${BASE}/conversations/12345`).reply({ id: 12345 })

      await service.getConversation(12345, true)

      expect(lastRequest().query).toMatchObject({ embed: 'threads' })
    })
  })

  describe('listConversations', () => {
    it('sends filters and unwraps page', async () => {
      mockToken()
      mock.onGet(`${BASE}/conversations`).reply({
        _embedded: { conversations: [{ id: 1 }, { id: 2 }] },
        page: { size: 25, totalElements: 2, totalPages: 1, number: 1 },
      })

      const result = await service.listConversations('85742', 'Active', 'vip', null, null, 2)

      expect(lastRequest().query).toMatchObject({
        mailbox: '85742',
        status: 'active',
        tag: 'vip',
        page: 2,
      })
      expect(result.items).toHaveLength(2)
      expect(result.page).toMatchObject({ totalElements: 2 })
    })

    it('returns empty items when no conversations exist', async () => {
      mockToken()
      mock.onGet(`${BASE}/conversations`).reply({})

      const result = await service.listConversations()

      expect(result.items).toEqual([])
      expect(result.page).toBeNull()
    })
  })

  describe('updateConversation', () => {
    it('patches subject, status, and assignTo', async () => {
      mockToken()
      mock.onPatch(`${BASE}/conversations/100`).reply({ status: 204, headers: {}, body: null })

      const result = await service.updateConversation(100, 'New Subject', 'Closed', '256')

      // token + 3 patch requests
      const patchRequests = mock.history.filter(r => r.method === 'patch')
      expect(patchRequests).toHaveLength(3)
      expect(patchRequests[0].body).toEqual({ op: 'replace', path: '/subject', value: 'New Subject' })
      expect(patchRequests[1].body).toEqual({ op: 'replace', path: '/status', value: 'closed' })
      expect(patchRequests[2].body).toEqual({ op: 'replace', path: '/assignTo', value: 256 })
      expect(result).toEqual({ conversationId: 100, updatedFields: ['subject', 'status', 'assignTo'] })
    })

    it('patches only provided fields', async () => {
      mockToken()
      mock.onPatch(`${BASE}/conversations/100`).reply({ status: 204, headers: {}, body: null })

      const result = await service.updateConversation(100, null, 'Pending')

      const patchRequests = mock.history.filter(r => r.method === 'patch')
      expect(patchRequests).toHaveLength(1)
      expect(result.updatedFields).toEqual(['status'])
    })

    it('throws when no fields provided', async () => {
      mockToken()

      await expect(service.updateConversation(100)).rejects.toThrow('Nothing to update')
    })
  })

  describe('deleteConversation', () => {
    it('sends DELETE and returns confirmation', async () => {
      mockToken()
      mock.onDelete(`${BASE}/conversations/100`).reply({ status: 204, headers: {}, body: null })

      const result = await service.deleteConversation(100)

      expect(lastRequest().method).toBe('delete')
      expect(result).toEqual({ conversationId: 100, deleted: true })
    })
  })

  describe('addReply', () => {
    it('sends reply with customer email', async () => {
      mockToken()
      mock.onPost(`${BASE}/conversations/100/reply`).reply({
        status: 201,
        headers: { 'Resource-Id': '555' },
        body: null,
      })

      const result = await service.addReply(100, 'Thanks!', null, 'c@d.com', 'Closed', false)

      const req = lastRequest()
      expect(req.body).toMatchObject({
        text: 'Thanks!',
        customer: { email: 'c@d.com' },
        status: 'closed',
      })
      expect(req.body.draft).toBeUndefined()
      expect(result).toEqual({ conversationId: 100, threadId: 555, created: true })
    })

    it('sends reply with customer ID and draft flag', async () => {
      mockToken()
      mock.onPost(`${BASE}/conversations/100/reply`).reply({
        status: 201,
        headers: { 'Resource-Id': '556' },
        body: null,
      })

      await service.addReply(100, 'Draft reply', 501, null, null, true)

      const req = lastRequest()
      expect(req.body.customer).toEqual({ id: 501 })
      expect(req.body.draft).toBe(true)
      expect(req.body.status).toBeUndefined()
    })

    it('throws when neither customerId nor customerEmail provided', async () => {
      mockToken()

      await expect(service.addReply(100, 'Text')).rejects.toThrow('Customer ID or Customer Email')
    })
  })

  describe('addNote', () => {
    it('sends note with optional status', async () => {
      mockToken()
      mock.onPost(`${BASE}/conversations/100/notes`).reply({
        status: 201,
        headers: { 'Resource-Id': '777' },
        body: null,
      })

      const result = await service.addNote(100, 'Internal note', 'Pending')

      expect(lastRequest().body).toEqual({ text: 'Internal note', status: 'pending' })
      expect(result).toEqual({ conversationId: 100, threadId: 777, created: true })
    })

    it('sends note without status', async () => {
      mockToken()
      mock.onPost(`${BASE}/conversations/100/notes`).reply({
        status: 201,
        headers: { 'Resource-Id': '778' },
        body: null,
      })

      await service.addNote(100, 'Just a note')

      expect(lastRequest().body).toEqual({ text: 'Just a note' })
    })
  })

  describe('listThreads', () => {
    it('fetches and unwraps threads', async () => {
      mockToken()
      mock.onGet(`${BASE}/conversations/100/threads`).reply({
        _embedded: { threads: [{ id: 1, type: 'customer' }] },
        page: { size: 25, totalElements: 1, totalPages: 1, number: 1 },
      })

      const result = await service.listThreads(100)

      expect(result.items).toEqual([{ id: 1, type: 'customer' }])
      expect(result.page).toMatchObject({ totalElements: 1 })
    })
  })

  describe('assignConversation', () => {
    it('assigns to a user', async () => {
      mockToken()
      mock.onPatch(`${BASE}/conversations/100`).reply({ status: 204, headers: {}, body: null })

      const result = await service.assignConversation(100, '256', false)

      expect(lastRequest().body).toEqual({ op: 'replace', path: '/assignTo', value: 256 })
      expect(result).toEqual({ conversationId: 100, assignedTo: 256 })
    })

    it('unassigns conversation', async () => {
      mockToken()
      mock.onPatch(`${BASE}/conversations/100`).reply({ status: 204, headers: {}, body: null })

      const result = await service.assignConversation(100, null, true)

      expect(lastRequest().body).toEqual({ op: 'remove', path: '/assignTo' })
      expect(result).toEqual({ conversationId: 100, assignedTo: null })
    })

    it('throws when no userId and not unassigning', async () => {
      mockToken()

      await expect(service.assignConversation(100, null, false)).rejects.toThrow('Provide a user')
    })
  })

  describe('addTags', () => {
    it('merges new tags with existing ones', async () => {
      mockToken()
      mock.onGet(`${BASE}/conversations/100`).reply({
        tags: [{ id: 1, tag: 'existing' }],
      })
      mock.onPut(`${BASE}/conversations/100/tags`).reply({ status: 204, headers: {}, body: null })

      const result = await service.addTags(100, ['new-tag', 'existing'])

      expect(lastRequest().body).toEqual({ tags: ['existing', 'new-tag'] })
      expect(result).toEqual({ conversationId: 100, tags: ['existing', 'new-tag'] })
    })

    it('throws when tags array is empty', async () => {
      mockToken()

      await expect(service.addTags(100, [])).rejects.toThrow('at least one tag')
    })
  })

  describe('removeTags', () => {
    it('removes specified tags (case-insensitive)', async () => {
      mockToken()
      mock.onGet(`${BASE}/conversations/100`).reply({
        tags: [{ id: 1, tag: 'vip' }, { id: 2, tag: 'urgent' }, { id: 3, tag: 'refund' }],
      })
      mock.onPut(`${BASE}/conversations/100/tags`).reply({ status: 204, headers: {}, body: null })

      const result = await service.removeTags(100, ['VIP', 'refund'])

      expect(lastRequest().body).toEqual({ tags: ['urgent'] })
      expect(result).toEqual({ conversationId: 100, tags: ['urgent'] })
    })

    it('throws when tags array is empty', async () => {
      mockToken()

      await expect(service.removeTags(100, [])).rejects.toThrow('at least one tag')
    })
  })

  // ── Customers ──

  describe('createCustomer', () => {
    it('creates customer with required fields and fetches result', async () => {
      mockToken()
      mock.onPost(`${BASE}/customers`).reply({
        status: 201,
        headers: { 'Resource-Id': '501' },
        body: null,
      })
      mock.onGet(`${BASE}/customers/501`).reply({ id: 501, firstName: 'Jane' })

      const result = await service.createCustomer('Jane', 'jane@example.com')

      const postReqs = mock.history.filter(r => r.method === 'post' && r.url.includes('/customers'))
      expect(postReqs[0].body).toMatchObject({
        firstName: 'Jane',
        emails: [{ type: 'work', value: 'jane@example.com' }],
      })
      expect(postReqs[0].body.phones).toBeUndefined()
      expect(result).toEqual({ id: 501, firstName: 'Jane' })
    })

    it('includes phone and organization when provided', async () => {
      mockToken()
      mock.onPost(`${BASE}/customers`).reply({
        status: 201,
        headers: { 'Resource-Id': '502' },
        body: null,
      })
      mock.onGet(`${BASE}/customers/502`).reply({ id: 502 })

      await service.createCustomer('Jane', 'jane@example.com', 'Doe', '555-1234', 'Acme Inc')

      const postReqs = mock.history.filter(r => r.method === 'post' && r.url.includes('/customers'))
      expect(postReqs[0].body.lastName).toBe('Doe')
      expect(postReqs[0].body.organization).toBe('Acme Inc')
      expect(postReqs[0].body.phones).toEqual([{ type: 'work', value: '555-1234' }])
    })
  })

  describe('getCustomer', () => {
    it('fetches customer by ID', async () => {
      mockToken()
      mock.onGet(`${BASE}/customers/501`).reply({ id: 501, firstName: 'Jane' })

      const result = await service.getCustomer(501)

      expect(result).toEqual({ id: 501, firstName: 'Jane' })
      expect(lastRequest().url).toBe(`${BASE}/customers/501`)
    })
  })

  describe('listCustomers', () => {
    it('passes filters and unwraps page', async () => {
      mockToken()
      mock.onGet(`${BASE}/customers`).reply({
        _embedded: { customers: [{ id: 501 }] },
        page: { size: 50, totalElements: 1, totalPages: 1, number: 1 },
      })

      const result = await service.listCustomers(null, 'Jane', 'Doe', null, 2)

      expect(lastRequest().query).toMatchObject({ firstName: 'Jane', lastName: 'Doe', page: 2 })
      expect(result.items).toEqual([{ id: 501 }])
    })

    it('converts email filter to query syntax', async () => {
      mockToken()
      mock.onGet(`${BASE}/customers`).reply({
        _embedded: { customers: [] },
        page: { size: 50, totalElements: 0, totalPages: 0, number: 1 },
      })

      await service.listCustomers('jane@example.com')

      expect(lastRequest().query).toMatchObject({ query: '(email:"jane@example.com")' })
    })
  })

  describe('updateCustomer', () => {
    it('fetches current data, applies changes, and sends PUT', async () => {
      mockToken()
      mock.onGet(`${BASE}/customers/501`).reply({
        firstName: 'Jane',
        lastName: 'Doe',
        jobTitle: 'CEO',
        organization: 'Acme',
        location: null,
        background: null,
        photoUrl: null,
        gender: null,
        age: null,
      })
      mock.onPut(`${BASE}/customers/501`).reply({ status: 204, headers: {}, body: null })

      const result = await service.updateCustomer(501, null, null, 'CTO', 'NewCo')

      const putReqs = mock.history.filter(r => r.method === 'put')
      expect(putReqs[0].body).toMatchObject({
        firstName: 'Jane',
        lastName: 'Doe',
        jobTitle: 'CTO',
        organization: 'NewCo',
      })
      expect(result).toEqual({ customerId: 501, updatedFields: ['jobTitle', 'organization'] })
    })

    it('throws when no fields provided', async () => {
      mockToken()
      mock.onGet(`${BASE}/customers/501`).reply({
        firstName: 'Jane', lastName: 'Doe',
      })

      await expect(service.updateCustomer(501)).rejects.toThrow('Nothing to update')
    })
  })

  // ── Mailboxes ──

  describe('listMailboxes', () => {
    it('fetches and unwraps mailboxes', async () => {
      mockToken()
      mock.onGet(`${BASE}/mailboxes`).reply({
        _embedded: { mailboxes: [{ id: 85742, name: 'Support' }] },
        page: { size: 50, totalElements: 1, totalPages: 1, number: 1 },
      })

      const result = await service.listMailboxes()

      expect(result.items).toEqual([{ id: 85742, name: 'Support' }])
    })
  })

  describe('listMailboxFolders', () => {
    it('fetches folders for a mailbox', async () => {
      mockToken()
      mock.onGet(`${BASE}/mailboxes/85742/folders`).reply({
        _embedded: { folders: [{ id: 1, name: 'Unassigned' }] },
        page: { size: 50, totalElements: 1, totalPages: 1, number: 1 },
      })

      const result = await service.listMailboxFolders('85742')

      expect(result.items).toEqual([{ id: 1, name: 'Unassigned' }])
      expect(lastRequest().url).toBe(`${BASE}/mailboxes/85742/folders`)
    })
  })

  // ── Users ──

  describe('listUsers', () => {
    it('passes filters and unwraps users', async () => {
      mockToken()
      mock.onGet(`${BASE}/users`).reply({
        _embedded: { users: [{ id: 256, firstName: 'Alex' }] },
        page: { size: 50, totalElements: 1, totalPages: 1, number: 1 },
      })

      const result = await service.listUsers('alex@example.com', '85742', 1)

      expect(lastRequest().query).toMatchObject({
        email: 'alex@example.com',
        mailbox: '85742',
        page: 1,
      })
      expect(result.items).toEqual([{ id: 256, firstName: 'Alex' }])
    })
  })

  describe('getMe', () => {
    it('fetches current user profile', async () => {
      mockToken()
      mock.onGet(`${BASE}/users/me`).reply({ id: 256, firstName: 'Alex', role: 'owner' })

      const result = await service.getMe()

      expect(result).toEqual({ id: 256, firstName: 'Alex', role: 'owner' })
      expect(lastRequest().url).toBe(`${BASE}/users/me`)
    })
  })

  // ── Tags ──

  describe('listTags', () => {
    it('fetches and unwraps tags with pagination', async () => {
      mockToken()
      mock.onGet(`${BASE}/tags`).reply({
        _embedded: { tags: [{ id: 9, name: 'vip' }] },
        page: { size: 100, totalElements: 1, totalPages: 1, number: 1 },
      })

      const result = await service.listTags(1)

      expect(lastRequest().query).toMatchObject({ page: 1 })
      expect(result.items).toEqual([{ id: 9, name: 'vip' }])
    })
  })

  // ── Dictionaries ──

  describe('getMailboxesDictionary', () => {
    it('returns formatted dictionary items', async () => {
      mockToken()
      mock.onGet(`${BASE}/mailboxes`).reply({
        _embedded: {
          mailboxes: [
            { id: 1, name: 'Support', email: 'support@example.com' },
            { id: 2, name: 'Sales', email: 'sales@example.com' },
          ],
        },
        page: { size: 50, totalElements: 2, totalPages: 1, number: 1 },
      })

      const result = await service.getMailboxesDictionary({})

      expect(result.items).toEqual([
        { label: 'Support', value: '1', note: 'support@example.com' },
        { label: 'Sales', value: '2', note: 'sales@example.com' },
      ])
      expect(result.cursor).toBeUndefined()
    })

    it('filters by search text', async () => {
      mockToken()
      mock.onGet(`${BASE}/mailboxes`).reply({
        _embedded: {
          mailboxes: [
            { id: 1, name: 'Support', email: 'support@example.com' },
            { id: 2, name: 'Sales', email: 'sales@example.com' },
          ],
        },
        page: { size: 50, totalElements: 2, totalPages: 1, number: 1 },
      })

      const result = await service.getMailboxesDictionary({ search: 'sales' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toBe('Sales')
    })

    it('returns cursor when more pages exist', async () => {
      mockToken()
      mock.onGet(`${BASE}/mailboxes`).reply({
        _embedded: { mailboxes: [{ id: 1, name: 'A', email: 'a@b.com' }] },
        page: { size: 50, totalElements: 100, totalPages: 2, number: 1 },
      })

      const result = await service.getMailboxesDictionary({})

      expect(result.cursor).toBe('2')
    })
  })

  describe('getUsersDictionary', () => {
    it('returns formatted dictionary items', async () => {
      mockToken()
      mock.onGet(`${BASE}/users`).reply({
        _embedded: {
          users: [
            { id: 256, firstName: 'Alex', lastName: 'Agent', email: 'alex@example.com' },
          ],
        },
        page: { size: 50, totalElements: 1, totalPages: 1, number: 1 },
      })

      const result = await service.getUsersDictionary({})

      expect(result.items).toEqual([
        { label: 'Alex Agent', value: '256', note: 'alex@example.com' },
      ])
      expect(result.cursor).toBeUndefined()
    })

    it('filters by search text on name', async () => {
      mockToken()
      mock.onGet(`${BASE}/users`).reply({
        _embedded: {
          users: [
            { id: 1, firstName: 'Alex', lastName: 'Agent', email: 'alex@example.com' },
            { id: 2, firstName: 'Bob', lastName: 'Builder', email: 'bob@example.com' },
          ],
        },
        page: { size: 50, totalElements: 2, totalPages: 1, number: 1 },
      })

      const result = await service.getUsersDictionary({ search: 'bob' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('2')
    })

    it('uses email as label when name is missing', async () => {
      mockToken()
      mock.onGet(`${BASE}/users`).reply({
        _embedded: {
          users: [{ id: 3, firstName: '', lastName: '', email: 'no-name@example.com' }],
        },
        page: { size: 50, totalElements: 1, totalPages: 1, number: 1 },
      })

      const result = await service.getUsersDictionary({})

      expect(result.items[0].label).toBe('no-name@example.com')
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('throws descriptive error on API failure with embedded errors', async () => {
      mockToken()
      mock.onGet(`${BASE}/conversations/999`).replyWithError({
        message: 'Not Found',
        body: {
          message: 'Resource not found',
          _embedded: {
            errors: [{ path: 'conversationId', message: 'does not exist' }],
          },
        },
      })

      await expect(service.getConversation(999)).rejects.toThrow('Resource not found')
    })
  })
})
