'use strict'

const { createSandbox } = require('../../../service-sandbox')

const ACCESS_TOKEN = 'test-access-token-123'
const BASE = 'https://driftapi.com'

describe('Drift Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ accessToken: ACCESS_TOKEN })
    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()
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
      expect(sandbox.getConfigItems()).toEqual([
        expect.objectContaining({
          name: 'accessToken',
          displayName: 'Access Token',
          required: true,
          shared: false,
          type: 'STRING',
        }),
      ])
    })

    it('sends the Bearer Authorization header on GET requests (no Content-Type)', async () => {
      mock.onGet(`${ BASE }/users/list`).reply({ data: [] })

      await service.listUsers()

      expect(mock.history[0].headers).toMatchObject({
        Authorization: `Bearer ${ ACCESS_TOKEN }`,
        Accept: 'application/json',
      })
      expect(mock.history[0].headers).not.toHaveProperty('Content-Type')
    })

    it('sends the Bearer Authorization header plus Content-Type on requests with a body', async () => {
      mock.onPost(`${ BASE }/contacts`).reply({ data: { id: 1 } })

      await service.createContact('jane@example.com')

      expect(mock.history[0].headers).toMatchObject({
        Authorization: `Bearer ${ ACCESS_TOKEN }`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      })
    })
  })

  // ── Contacts ──

  describe('createContact', () => {
    it('sends POST with only the email attribute when required params only', async () => {
      mock.onPost(`${ BASE }/contacts`).reply({ data: { id: 9001 } })

      const result = await service.createContact('jane@example.com')

      expect(result).toEqual({ data: { id: 9001 } })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/contacts`)
      expect(mock.history[0].body).toEqual({
        attributes: { email: 'jane@example.com' },
      })
    })

    it('merges standard fields and additional attributes', async () => {
      mock.onPost(`${ BASE }/contacts`).reply({ data: { id: 9002 } })

      await service.createContact(
        'jane@example.com',
        'Jane Doe',
        '+15551234567',
        'ext-1',
        { company: 'Acme', title: 'CTO' }
      )

      expect(mock.history[0].body).toEqual({
        attributes: {
          email: 'jane@example.com',
          name: 'Jane Doe',
          phone: '+15551234567',
          externalId: 'ext-1',
          company: 'Acme',
          title: 'CTO',
        },
      })
    })

    it('omits empty-string and nullish optional fields', async () => {
      mock.onPost(`${ BASE }/contacts`).reply({ data: { id: 9003 } })

      await service.createContact('jane@example.com', '', null, undefined)

      expect(mock.history[0].body).toEqual({
        attributes: { email: 'jane@example.com' },
      })
    })

    it('throws a friendly error with hint on a 400 API failure', async () => {
      mock.onPost(`${ BASE }/contacts`).replyWithError({
        status: 400,
        body: { error: { message: 'Email is required' } },
      })

      await expect(service.createContact('bad')).rejects.toThrow(
        'Drift API error: Invalid request — check the required fields and their values. (Email is required)'
      )
    })
  })

  describe('getContact', () => {
    it('sends GET to the contact endpoint with url-encoded id', async () => {
      mock.onGet(`${ BASE }/contacts/9001`).reply({ data: { id: 9001 } })

      const result = await service.getContact('9001')

      expect(result).toEqual({ data: { id: 9001 } })
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/contacts/9001`)
      expect(mock.history[0].body).toBeUndefined()
    })

    it('throws a friendly not-found error on a 404', async () => {
      mock.onGet(`${ BASE }/contacts/999`).replyWithError({
        status: 404,
        body: { error: { message: 'Contact not found' } },
      })

      await expect(service.getContact('999')).rejects.toThrow(
        'Drift API error: Not found'
      )
    })
  })

  describe('getContactByEmail', () => {
    it('sends GET with the email query param', async () => {
      mock.onGet(`${ BASE }/contacts`).reply({ data: [{ id: 9001 }] })

      const result = await service.getContactByEmail('jane@example.com')

      expect(result).toEqual({ data: [{ id: 9001 }] })
      expect(mock.history[0].url).toBe(`${ BASE }/contacts`)
      expect(mock.history[0].query).toEqual({ email: 'jane@example.com' })
    })
  })

  describe('listContacts', () => {
    it('sends GET with no query params when email is omitted', async () => {
      mock.onGet(`${ BASE }/contacts`).reply({ data: [] })

      await service.listContacts()

      expect(mock.history[0].url).toBe(`${ BASE }/contacts`)
      expect(mock.history[0].query).toEqual({})
    })

    it('includes the email filter when provided', async () => {
      mock.onGet(`${ BASE }/contacts`).reply({ data: [{ id: 9001 }] })

      await service.listContacts('jane@example.com')

      expect(mock.history[0].query).toEqual({ email: 'jane@example.com' })
    })
  })

  describe('updateContact', () => {
    it('sends PATCH with merged attributes', async () => {
      mock.onPatch(`${ BASE }/contacts/9001`).reply({ data: { id: 9001 } })

      const result = await service.updateContact(
        '9001',
        'new@example.com',
        'Jane A. Doe',
        '+15559999999',
        { city: 'Paris' }
      )

      expect(result).toEqual({ data: { id: 9001 } })
      expect(mock.history[0].method).toBe('patch')
      expect(mock.history[0].url).toBe(`${ BASE }/contacts/9001`)
      expect(mock.history[0].body).toEqual({
        attributes: {
          email: 'new@example.com',
          name: 'Jane A. Doe',
          phone: '+15559999999',
          city: 'Paris',
        },
      })
    })

    it('sends an empty attributes object when only the id is supplied', async () => {
      mock.onPatch(`${ BASE }/contacts/9001`).reply({ data: { id: 9001 } })

      await service.updateContact('9001')

      expect(mock.history[0].body).toEqual({ attributes: {} })
    })

    it('throws a friendly error on API failure', async () => {
      mock.onPatch(`${ BASE }/contacts/9001`).replyWithError({
        status: 403,
        body: { error: { message: 'Forbidden' } },
      })

      await expect(service.updateContact('9001', 'x@y.com')).rejects.toThrow(
        'Drift API error: Permission denied'
      )
    })
  })

  describe('deleteContact', () => {
    it('sends DELETE and returns a deleted marker', async () => {
      mock.onDelete(`${ BASE }/contacts/9001`).reply(undefined)

      const result = await service.deleteContact('9001')

      expect(result).toEqual({ deleted: true, id: '9001' })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${ BASE }/contacts/9001`)
      expect(mock.history[0].body).toBeUndefined()
    })

    it('coerces a numeric id to a string in the result', async () => {
      mock.onDelete(`${ BASE }/contacts/9001`).reply(undefined)

      const result = await service.deleteContact(9001)

      expect(result).toEqual({ deleted: true, id: '9001' })
    })

    it('throws a friendly error on API failure', async () => {
      mock.onDelete(`${ BASE }/contacts/9001`).replyWithError({
        status: 404,
        body: { error: { message: 'Not found' } },
      })

      await expect(service.deleteContact('9001')).rejects.toThrow('Drift API error: Not found')
    })
  })

  // ── Conversations ──

  describe('listConversations', () => {
    it('applies the default limit and no status when none provided', async () => {
      mock.onGet(`${ BASE }/conversations`).reply({ data: { conversations: [] } })

      const result = await service.listConversations()

      expect(result).toEqual({ data: { conversations: [] } })
      expect(mock.history[0].url).toBe(`${ BASE }/conversations`)
      expect(mock.history[0].query).toEqual({ limit: 50 })
    })

    it('maps the friendly status label to the API statusId and passes a custom limit', async () => {
      mock.onGet(`${ BASE }/conversations`).reply({ data: { conversations: [] } })

      await service.listConversations('Closed', 10)

      expect(mock.history[0].query).toEqual({ statusId: 'closed', limit: 10 })
    })

    it('passes an unmapped status value through unchanged', async () => {
      mock.onGet(`${ BASE }/conversations`).reply({ data: { conversations: [] } })

      await service.listConversations('archived', 5)

      expect(mock.history[0].query).toEqual({ statusId: 'archived', limit: 5 })
    })

    it('throws a friendly rate-limit error on a 429', async () => {
      mock.onGet(`${ BASE }/conversations`).replyWithError({
        status: 429,
        body: { error: { message: 'Too many requests' } },
      })

      await expect(service.listConversations()).rejects.toThrow('Drift API error: Drift rate limit hit')
    })
  })

  describe('getConversation', () => {
    it('sends GET to the conversation endpoint', async () => {
      mock.onGet(`${ BASE }/conversations/501`).reply({ data: { id: 501, status: 'open' } })

      const result = await service.getConversation('501')

      expect(result).toEqual({ data: { id: 501, status: 'open' } })
      expect(mock.history[0].url).toBe(`${ BASE }/conversations/501`)
    })
  })

  describe('getConversationMessages', () => {
    it('sends GET with no cursor query by default', async () => {
      mock.onGet(`${ BASE }/conversations/501/messages`).reply({ data: { messages: [] } })

      const result = await service.getConversationMessages('501')

      expect(result).toEqual({ data: { messages: [] } })
      expect(mock.history[0].url).toBe(`${ BASE }/conversations/501/messages`)
      expect(mock.history[0].query).toEqual({})
    })

    it('includes the cursor query param when provided', async () => {
      mock.onGet(`${ BASE }/conversations/501/messages`).reply({ data: { messages: [] } })

      await service.getConversationMessages('501', 'cursor-abc')

      expect(mock.history[0].query).toEqual({ cursor: 'cursor-abc' })
    })
  })

  describe('sendMessage', () => {
    it('defaults the type to chat when none provided', async () => {
      mock.onPost(`${ BASE }/conversations/501/messages`).reply({ data: { id: 7002 } })

      const result = await service.sendMessage('501', 'Thanks for reaching out!')

      expect(result).toEqual({ data: { id: 7002 } })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/conversations/501/messages`)
      expect(mock.history[0].body).toEqual({
        type: 'chat',
        body: 'Thanks for reaching out!',
      })
    })

    it('maps a friendly message type label to the API value', async () => {
      mock.onPost(`${ BASE }/conversations/501/messages`).reply({ data: { id: 7003 } })

      await service.sendMessage('501', 'Internal note', 'Private Note')

      expect(mock.history[0].body).toEqual({
        type: 'private_note',
        body: 'Internal note',
      })
    })

    it('passes an unmapped message type through unchanged', async () => {
      mock.onPost(`${ BASE }/conversations/501/messages`).reply({ data: { id: 7004 } })

      await service.sendMessage('501', 'Hi', 'chat')

      expect(mock.history[0].body).toEqual({ type: 'chat', body: 'Hi' })
    })

    it('throws a friendly error on API failure', async () => {
      mock.onPost(`${ BASE }/conversations/501/messages`).replyWithError({
        status: 404,
        body: { error: { message: 'Conversation not found' } },
      })

      await expect(service.sendMessage('501', 'Hi')).rejects.toThrow('Drift API error: Not found')
    })
  })

  describe('updateConversationStatus', () => {
    it('sends POST mapping the friendly status to the API value', async () => {
      mock.onPost(`${ BASE }/conversations/501/status`).reply({ data: { id: 501, status: 'closed' } })

      const result = await service.updateConversationStatus('501', 'Closed')

      expect(result).toEqual({ data: { id: 501, status: 'closed' } })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/conversations/501/status`)
      expect(mock.history[0].body).toEqual({ status: 'closed' })
    })

    it('passes an unmapped status through unchanged', async () => {
      mock.onPost(`${ BASE }/conversations/501/status`).reply({ data: { id: 501 } })

      await service.updateConversationStatus('501', 'snoozed')

      expect(mock.history[0].body).toEqual({ status: 'snoozed' })
    })
  })

  describe('createConversation', () => {
    it('sends POST with the email and first chat message', async () => {
      mock.onPost(`${ BASE }/conversations/new`).reply({ data: { conversationId: 502 } })

      const result = await service.createConversation('jane@example.com', 'Hello there')

      expect(result).toEqual({ data: { conversationId: 502 } })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/conversations/new`)
      expect(mock.history[0].body).toEqual({
        email: 'jane@example.com',
        message: { body: 'Hello there', type: 'chat' },
      })
    })

    it('throws a friendly error on API failure', async () => {
      mock.onPost(`${ BASE }/conversations/new`).replyWithError({
        status: 400,
        body: { error: { message: 'Invalid email' } },
      })

      await expect(service.createConversation('bad', 'Hi')).rejects.toThrow(
        'Drift API error: Invalid request'
      )
    })
  })

  // ── Users (agents) ──

  describe('listUsers', () => {
    it('sends GET to the users list endpoint', async () => {
      mock.onGet(`${ BASE }/users/list`).reply({ data: [{ id: 3001, name: 'Alex Agent' }] })

      const result = await service.listUsers()

      expect(result).toEqual({ data: [{ id: 3001, name: 'Alex Agent' }] })
      expect(mock.history[0].url).toBe(`${ BASE }/users/list`)
      expect(mock.history[0].method).toBe('get')
    })
  })

  describe('getUser', () => {
    it('sends GET to the user endpoint', async () => {
      mock.onGet(`${ BASE }/users/3001`).reply({ data: { id: 3001, name: 'Alex Agent' } })

      const result = await service.getUser('3001')

      expect(result).toEqual({ data: { id: 3001, name: 'Alex Agent' } })
      expect(mock.history[0].url).toBe(`${ BASE }/users/3001`)
    })

    it('throws a friendly error on API failure', async () => {
      mock.onGet(`${ BASE }/users/3001`).replyWithError({
        status: 404,
        body: { error: { message: 'User not found' } },
      })

      await expect(service.getUser('3001')).rejects.toThrow('Drift API error: Not found')
    })
  })

  // ── Accounts ──

  describe('listAccounts', () => {
    it('sends GET with no query params by default', async () => {
      mock.onGet(`${ BASE }/accounts`).reply({ data: [] })

      const result = await service.listAccounts()

      expect(result).toEqual({ data: [] })
      expect(mock.history[0].url).toBe(`${ BASE }/accounts`)
      expect(mock.history[0].query).toEqual({})
    })

    it('passes the cursor through as the "next" query param', async () => {
      mock.onGet(`${ BASE }/accounts`).reply({ data: [] })

      await service.listAccounts('cursor-xyz')

      expect(mock.history[0].query).toEqual({ next: 'cursor-xyz' })
    })
  })

  describe('getAccount', () => {
    it('sends GET to the account endpoint', async () => {
      mock.onGet(`${ BASE }/accounts/acct_123`).reply({ data: { name: 'Acme Corp' } })

      const result = await service.getAccount('acct_123')

      expect(result).toEqual({ data: { name: 'Acme Corp' } })
      expect(mock.history[0].url).toBe(`${ BASE }/accounts/acct_123`)
    })
  })

  describe('createOrUpdateAccount', () => {
    it('sends POST with just the name when required params only', async () => {
      mock.onPost(`${ BASE }/accounts/create`).reply({ data: { name: 'Acme Corp' } })

      const result = await service.createOrUpdateAccount('Acme Corp')

      expect(result).toEqual({ data: { name: 'Acme Corp' } })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/accounts/create`)
      expect(mock.history[0].body).toEqual({ name: 'Acme Corp' })
    })

    it('includes optional fields and converts custom properties to a name/value array', async () => {
      mock.onPost(`${ BASE }/accounts/create`).reply({ data: { accountId: 'acct_123' } })

      await service.createOrUpdateAccount(
        'Acme Corp',
        'acct_123',
        'acme.com',
        '3001',
        { industry: 'Tech', size: '500' }
      )

      expect(mock.history[0].body).toEqual({
        name: 'Acme Corp',
        accountId: 'acct_123',
        domain: 'acme.com',
        ownerId: '3001',
        customProperties: [
          { name: 'industry', value: 'Tech' },
          { name: 'size', value: '500' },
        ],
      })
    })

    it('omits custom properties when given an empty object', async () => {
      mock.onPost(`${ BASE }/accounts/create`).reply({ data: { name: 'Acme Corp' } })

      await service.createOrUpdateAccount('Acme Corp', undefined, undefined, undefined, {})

      expect(mock.history[0].body).toEqual({ name: 'Acme Corp' })
    })

    it('throws a friendly conflict error on a 409', async () => {
      mock.onPost(`${ BASE }/accounts/create`).replyWithError({
        status: 409,
        body: { error: { message: 'Account already exists' } },
      })

      await expect(service.createOrUpdateAccount('Acme Corp')).rejects.toThrow(
        'Drift API error: Conflict'
      )
    })
  })

  // ── Dictionaries ──

  describe('getUsersDictionary', () => {
    const usersResponse = {
      data: [
        { id: 3001, name: 'Alex Agent', email: 'alex@example.com' },
        { id: 3002, name: 'Blair Bot', email: 'blair@example.com' },
        { id: 3003, email: 'noname@example.com' },
        { id: 3004 },
      ],
    }

    it('maps all users to dictionary items when no search is provided', async () => {
      mock.onGet(`${ BASE }/users/list`).reply(usersResponse)

      const result = await service.getUsersDictionary({})

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].url).toBe(`${ BASE }/users/list`)
      expect(result.items).toEqual([
        { label: 'Alex Agent', value: '3001', note: 'alex@example.com' },
        { label: 'Blair Bot', value: '3002', note: 'blair@example.com' },
        { label: 'noname@example.com', value: '3003', note: 'noname@example.com' },
        { label: '3004', value: '3004', note: undefined },
      ])
    })

    it('filters by search over name and email', async () => {
      mock.onGet(`${ BASE }/users/list`).reply(usersResponse)

      const result = await service.getUsersDictionary({ search: 'blair' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('3002')
    })

    it('matches the search term against the email as well as the name', async () => {
      mock.onGet(`${ BASE }/users/list`).reply(usersResponse)

      const result = await service.getUsersDictionary({ search: 'alex@example.com' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('3001')
    })

    it('handles a null payload', async () => {
      mock.onGet(`${ BASE }/users/list`).reply(usersResponse)

      const result = await service.getUsersDictionary(null)

      expect(result.items).toHaveLength(4)
    })

    it('returns an empty items array when the response has no data array', async () => {
      mock.onGet(`${ BASE }/users/list`).reply({})

      const result = await service.getUsersDictionary({})

      expect(result).toEqual({ items: [] })
    })
  })
})
