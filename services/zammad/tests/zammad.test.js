'use strict'

const { createSandbox } = require('../../../service-sandbox')

const SERVER_URL = 'https://support.example.com'
const API_TOKEN = 'test-api-token'
const BASE = `${ SERVER_URL }/api/v1`

describe('Zammad Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ serverUrl: `${ SERVER_URL }///`, apiToken: API_TOKEN })
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

  // ── Registration & config ──

  describe('service registration', () => {
    it('registers serverUrl and apiToken config items', () => {
      expect(sandbox.getConfigItems()).toEqual([
        expect.objectContaining({ name: 'serverUrl', required: true, shared: false, type: 'STRING' }),
        expect.objectContaining({ name: 'apiToken', required: true, shared: false, type: 'STRING' }),
      ])
    })

    it('strips trailing slashes from the server URL', () => {
      expect(service.serverUrl).toBe(SERVER_URL)
    })

    it('tolerates a missing server URL', () => {
      const saved = global.Flowrunner
      const local = createSandbox({ apiToken: 'x' })

      jest.isolateModules(() => {
        require('../src/index.js')
      })

      expect(local.getService().serverUrl).toBe('')

      global.Flowrunner = saved
    })
  })

  // ── Common request shape / errors ──

  describe('request envelope', () => {
    it('sends the token authorization header and JSON content type', async () => {
      mock.onGet(`${ BASE }/users/me`).reply({ id: 1 })

      await service.getCurrentUser()

      expect(mock.history[0].headers).toMatchObject({
        'Authorization': `Token token=${ API_TOKEN }`,
        'Content-Type': 'application/json',
      })
    })

    it('wraps errors using error_human', async () => {
      mock.onGet(`${ BASE }/users/me`).replyWithError({
        message: 'Unauthorized',
        body: { error_human: 'Authentication failed', error: 'invalid token' },
      })

      await expect(service.getCurrentUser()).rejects.toThrow('Zammad API error: Authentication failed')
    })

    it('falls back to the error field', async () => {
      mock.onGet(`${ BASE }/users/me`).replyWithError({
        message: 'Unauthorized',
        body: { error: 'invalid token' },
      })

      await expect(service.getCurrentUser()).rejects.toThrow('Zammad API error: invalid token')
    })

    it('falls back to the raw error message', async () => {
      mock.onGet(`${ BASE }/users/me`).replyWithError({ message: 'Network unreachable' })

      await expect(service.getCurrentUser()).rejects.toThrow('Zammad API error: Network unreachable')
    })

    it('falls back to Unknown error when nothing is available', async () => {
      mock.onGet(`${ BASE }/users/me`).replyWithError({ message: '' })

      await expect(service.getCurrentUser()).rejects.toThrow('Zammad API error: Unknown error')
    })
  })

  // ── Tickets ──

  describe('createTicket', () => {
    it('sends group/customer names and a default article', async () => {
      mock.onPost(`${ BASE }/tickets`).reply({ id: 123, number: '67001' })

      const result = await service.createTicket('Cannot log in', 'Users', 'jane@example.com', 'Help me')

      expect(result).toEqual({ id: 123, number: '67001' })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/tickets`)

      expect(mock.history[0].body).toEqual({
        title: 'Cannot log in',
        article: { subject: 'Cannot log in', body: 'Help me', type: 'note' },
        group: 'Users',
        customer: 'jane@example.com',
      })
    })

    it('converts numeric group and customer values to ids', async () => {
      mock.onPost(`${ BASE }/tickets`).reply({ id: 124 })

      await service.createTicket('Title', '1', '45', 'Body')

      expect(mock.history[0].body).toMatchObject({ group_id: 1, customer_id: 45 })
      expect(mock.history[0].body.group).toBeUndefined()
      expect(mock.history[0].body.customer).toBeUndefined()
    })

    it('sends the full article, state and priority when provided', async () => {
      mock.onPost(`${ BASE }/tickets`).reply({ id: 125 })

      await service.createTicket(
        'Title',
        'Users',
        'jane@example.com',
        'Body',
        'Custom subject',
        'email',
        true,
        'open',
        '3 high'
      )

      expect(mock.history[0].body).toEqual({
        title: 'Title',
        article: { subject: 'Custom subject', body: 'Body', type: 'email', internal: true },
        group: 'Users',
        customer: 'jane@example.com',
        state: 'open',
        priority: '3 high',
      })
    })

    it('includes internal=false when explicitly disabled', async () => {
      mock.onPost(`${ BASE }/tickets`).reply({ id: 126 })

      await service.createTicket('T', 'Users', 'a@b.c', 'Body', undefined, undefined, false)

      expect(mock.history[0].body.article.internal).toBe(false)
    })

    it('throws when the API rejects the ticket', async () => {
      mock.onPost(`${ BASE }/tickets`).replyWithError({
        message: 'Unprocessable Entity',
        body: { error_human: 'Group is required' },
      })

      await expect(service.createTicket('T', '', 'a@b.c', 'Body')).rejects.toThrow(
        'Zammad API error: Group is required'
      )
    })
  })

  describe('getTicket', () => {
    it('gets a ticket without expand', async () => {
      mock.onGet(`${ BASE }/tickets/123`).reply({ id: 123 })

      const result = await service.getTicket(123)

      expect(result).toEqual({ id: 123 })
      expect(mock.history[0].query).toEqual({})
    })

    it('sends expand=true when enabled', async () => {
      mock.onGet(`${ BASE }/tickets/123`).reply({ id: 123, state: 'open' })

      await service.getTicket(123, true)

      expect(mock.history[0].query).toEqual({ expand: true })
    })
  })

  describe('listTickets', () => {
    it('applies default pagination', async () => {
      mock.onGet(`${ BASE }/tickets`).reply([])

      const result = await service.listTickets()

      expect(result).toEqual([])
      expect(mock.history[0].query).toEqual({ page: 1, per_page: 50 })
    })

    it('applies custom pagination and expand', async () => {
      mock.onGet(`${ BASE }/tickets`).reply([{ id: 1 }])

      await service.listTickets(3, 10, true)

      expect(mock.history[0].query).toEqual({ page: 3, per_page: 10, expand: true })
    })
  })

  describe('updateTicket', () => {
    it('sends only the provided fields', async () => {
      mock.onPut(`${ BASE }/tickets/123`).reply({ id: 123 })

      await service.updateTicket(123, 'New title')

      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].body).toEqual({ title: 'New title' })
    })

    it('converts numeric group and owner values to ids', async () => {
      mock.onPut(`${ BASE }/tickets/123`).reply({ id: 123 })

      await service.updateTicket(123, undefined, '2', 'closed', '3 high', '7')

      expect(mock.history[0].body).toEqual({
        state: 'closed',
        priority: '3 high',
        group_id: 2,
        owner_id: 7,
      })
    })

    it('keeps non-numeric group and owner values as names', async () => {
      mock.onPut(`${ BASE }/tickets/123`).reply({ id: 123 })

      await service.updateTicket(123, undefined, 'Users', undefined, undefined, 'agent@example.com')

      expect(mock.history[0].body).toEqual({ group: 'Users', owner: 'agent@example.com' })
    })

    it('sends an empty body when nothing changes', async () => {
      mock.onPut(`${ BASE }/tickets/123`).reply({ id: 123 })

      await service.updateTicket(123)

      expect(mock.history[0].body).toEqual({})
    })
  })

  describe('deleteTicket', () => {
    it('deletes and returns a confirmation object', async () => {
      mock.onDelete(`${ BASE }/tickets/123`).reply('')

      const result = await service.deleteTicket(123)

      expect(result).toEqual({ deleted: true, ticketId: 123 })
      expect(mock.history[0].method).toBe('delete')
    })

    it('throws when deletion is not permitted', async () => {
      mock.onDelete(`${ BASE }/tickets/123`).replyWithError({
        message: 'Forbidden',
        body: { error: 'Not authorized' },
      })

      await expect(service.deleteTicket(123)).rejects.toThrow('Zammad API error: Not authorized')
    })
  })

  describe('searchTickets', () => {
    it('sends the query with default pagination', async () => {
      mock.onGet(`${ BASE }/tickets/search`).reply([])

      await service.searchTickets('state.name:open')

      expect(mock.history[0].query).toEqual({ query: 'state.name:open', page: 1, per_page: 50 })
    })

    it('sends custom pagination and expand', async () => {
      mock.onGet(`${ BASE }/tickets/search`).reply([{ id: 1 }])

      await service.searchTickets('login', 2, 5, true)

      expect(mock.history[0].query).toEqual({ query: 'login', page: 2, per_page: 5, expand: true })
    })
  })

  // ── Articles ──

  describe('createArticle', () => {
    it('posts an article with the default type', async () => {
      mock.onPost(`${ BASE }/ticket_articles`).reply({ id: 456 })

      const result = await service.createArticle(123, 'Message body')

      expect(result).toEqual({ id: 456 })
      expect(mock.history[0].body).toEqual({ ticket_id: 123, body: 'Message body', type: 'note' })
    })

    it('posts an email article with all fields', async () => {
      mock.onPost(`${ BASE }/ticket_articles`).reply({ id: 457 })

      await service.createArticle(123, 'Body', 'Subject', 'email', true, 'jane@example.com')

      expect(mock.history[0].body).toEqual({
        ticket_id: 123,
        body: 'Body',
        subject: 'Subject',
        type: 'email',
        internal: true,
        to: 'jane@example.com',
      })
    })

    it('includes internal=false when explicitly disabled', async () => {
      mock.onPost(`${ BASE }/ticket_articles`).reply({ id: 458 })

      await service.createArticle(123, 'Body', undefined, undefined, false)

      expect(mock.history[0].body.internal).toBe(false)
    })
  })

  describe('listArticlesByTicket', () => {
    it('gets articles by ticket id', async () => {
      mock.onGet(`${ BASE }/ticket_articles/by_ticket/123`).reply([{ id: 456 }])

      const result = await service.listArticlesByTicket(123)

      expect(result).toEqual([{ id: 456 }])
    })
  })

  describe('getArticle', () => {
    it('gets an article by id', async () => {
      mock.onGet(`${ BASE }/ticket_articles/456`).reply({ id: 456 })

      const result = await service.getArticle(456)

      expect(result).toEqual({ id: 456 })
    })

    it('throws when the article is missing', async () => {
      mock.onGet(`${ BASE }/ticket_articles/999`).replyWithError({
        message: 'Not Found',
        body: { error: 'Object not found' },
      })

      await expect(service.getArticle(999)).rejects.toThrow('Zammad API error: Object not found')
    })
  })

  // ── Users ──

  describe('createUser', () => {
    it('sends only the provided fields', async () => {
      mock.onPost(`${ BASE }/users`).reply({ id: 45 })

      await service.createUser('Jane', 'Doe', 'jane@example.com')

      expect(mock.history[0].body).toEqual({ firstname: 'Jane', lastname: 'Doe', email: 'jane@example.com' })
    })

    it('sends phone and roles when provided', async () => {
      mock.onPost(`${ BASE }/users`).reply({ id: 46 })

      await service.createUser('Jane', 'Doe', 'jane@example.com', '+15550100', ['Agent'])

      expect(mock.history[0].body).toEqual({
        firstname: 'Jane',
        lastname: 'Doe',
        email: 'jane@example.com',
        phone: '+15550100',
        roles: ['Agent'],
      })
    })
  })

  describe('getUser', () => {
    it('gets a user by id', async () => {
      mock.onGet(`${ BASE }/users/45`).reply({ id: 45 })

      expect(await service.getUser(45)).toEqual({ id: 45 })
    })
  })

  describe('listUsers', () => {
    it('applies default pagination', async () => {
      mock.onGet(`${ BASE }/users`).reply([])

      await service.listUsers()

      expect(mock.history[0].query).toEqual({ page: 1, per_page: 50 })
    })

    it('applies custom pagination', async () => {
      mock.onGet(`${ BASE }/users`).reply([])

      await service.listUsers(2, 25)

      expect(mock.history[0].query).toEqual({ page: 2, per_page: 25 })
    })
  })

  describe('updateUser', () => {
    it('sends only the changed fields', async () => {
      mock.onPut(`${ BASE }/users/45`).reply({ id: 45 })

      await service.updateUser(45, undefined, undefined, undefined, '+15550199')

      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].body).toEqual({ phone: '+15550199' })
    })

    it('replaces roles when provided', async () => {
      mock.onPut(`${ BASE }/users/45`).reply({ id: 45 })

      await service.updateUser(45, 'Jane', 'Roe', 'jane.roe@example.com', undefined, ['Agent', 'Admin'])

      expect(mock.history[0].body).toEqual({
        firstname: 'Jane',
        lastname: 'Roe',
        email: 'jane.roe@example.com',
        roles: ['Agent', 'Admin'],
      })
    })
  })

  describe('searchUsers', () => {
    it('sends the query with default pagination', async () => {
      mock.onGet(`${ BASE }/users/search`).reply([])

      await service.searchUsers('jane')

      expect(mock.history[0].query).toEqual({ query: 'jane', page: 1, per_page: 50 })
    })

    it('sends custom pagination', async () => {
      mock.onGet(`${ BASE }/users/search`).reply([])

      await service.searchUsers('jane', 3, 10)

      expect(mock.history[0].query).toEqual({ query: 'jane', page: 3, per_page: 10 })
    })
  })

  describe('getCurrentUser', () => {
    it('gets the token owner profile', async () => {
      mock.onGet(`${ BASE }/users/me`).reply({ id: 1, login: 'admin@example.com' })

      const result = await service.getCurrentUser()

      expect(result).toEqual({ id: 1, login: 'admin@example.com' })
      expect(mock.history[0].url).toBe(`${ BASE }/users/me`)
    })
  })

  // ── Organizations ──

  describe('createOrganization', () => {
    it('sends the name only when nothing else is provided', async () => {
      mock.onPost(`${ BASE }/organizations`).reply({ id: 9 })

      await service.createOrganization('Acme Inc')

      expect(mock.history[0].body).toEqual({ name: 'Acme Inc' })
    })

    it('sends domain, assignment flag and note', async () => {
      mock.onPost(`${ BASE }/organizations`).reply({ id: 9 })

      await service.createOrganization('Acme Inc', 'acme.com', true, 'Key customer')

      expect(mock.history[0].body).toEqual({
        name: 'Acme Inc',
        domain: 'acme.com',
        domain_assignment: true,
        note: 'Key customer',
      })
    })

    it('includes domain_assignment=false when explicitly disabled', async () => {
      mock.onPost(`${ BASE }/organizations`).reply({ id: 9 })

      await service.createOrganization('Acme Inc', 'acme.com', false)

      expect(mock.history[0].body.domain_assignment).toBe(false)
    })
  })

  describe('getOrganization', () => {
    it('gets an organization by id', async () => {
      mock.onGet(`${ BASE }/organizations/9`).reply({ id: 9 })

      expect(await service.getOrganization(9)).toEqual({ id: 9 })
    })
  })

  describe('listOrganizations', () => {
    it('applies default pagination', async () => {
      mock.onGet(`${ BASE }/organizations`).reply([])

      await service.listOrganizations()

      expect(mock.history[0].query).toEqual({ page: 1, per_page: 50 })
    })

    it('applies custom pagination', async () => {
      mock.onGet(`${ BASE }/organizations`).reply([])

      await service.listOrganizations(4, 20)

      expect(mock.history[0].query).toEqual({ page: 4, per_page: 20 })
    })
  })

  describe('updateOrganization', () => {
    it('sends only the changed fields', async () => {
      mock.onPut(`${ BASE }/organizations/9`).reply({ id: 9 })

      await service.updateOrganization(9, undefined, 'acme.io')

      expect(mock.history[0].body).toEqual({ domain: 'acme.io' })
    })

    it('sends all fields when provided', async () => {
      mock.onPut(`${ BASE }/organizations/9`).reply({ id: 9 })

      await service.updateOrganization(9, 'Acme', 'acme.io', true, 'Updated note')

      expect(mock.history[0].body).toEqual({
        name: 'Acme',
        domain: 'acme.io',
        domain_assignment: true,
        note: 'Updated note',
      })
    })
  })

  describe('searchOrganizations', () => {
    it('sends the query with default pagination', async () => {
      mock.onGet(`${ BASE }/organizations/search`).reply([])

      await service.searchOrganizations('Acme')

      expect(mock.history[0].query).toEqual({ query: 'Acme', page: 1, per_page: 50 })
    })

    it('sends custom pagination', async () => {
      mock.onGet(`${ BASE }/organizations/search`).reply([])

      await service.searchOrganizations('Acme', 2, 5)

      expect(mock.history[0].query).toEqual({ query: 'Acme', page: 2, per_page: 5 })
    })
  })

  // ── Groups ──

  describe('listGroups', () => {
    it('lists all groups', async () => {
      mock.onGet(`${ BASE }/groups`).reply([{ id: 1, name: 'Users' }])

      const result = await service.listGroups()

      expect(result).toEqual([{ id: 1, name: 'Users' }])
      expect(mock.history[0].query).toEqual({})
    })
  })

  // ── Tags ──

  describe('addTag', () => {
    it('adds a tag with the default object type', async () => {
      mock.onPost(`${ BASE }/tags/add`).reply('true')

      const result = await service.addTag(123, 'vip')

      expect(result).toEqual({ success: true, objectId: 123, object: 'Ticket', tag: 'vip' })
      expect(mock.history[0].body).toEqual({ object: 'Ticket', o_id: 123, item: 'vip' })
    })

    it('honours an explicit object type', async () => {
      mock.onPost(`${ BASE }/tags/add`).reply('true')

      const result = await service.addTag(123, 'vip', 'Ticket')

      expect(result.object).toBe('Ticket')
      expect(mock.history[0].body.object).toBe('Ticket')
    })

    it('throws when the tag cannot be added', async () => {
      mock.onPost(`${ BASE }/tags/add`).replyWithError({ message: 'Boom', body: { error_human: 'Tagging disabled' } })

      await expect(service.addTag(123, 'vip')).rejects.toThrow('Zammad API error: Tagging disabled')
    })
  })

  describe('removeTag', () => {
    it('removes a tag via DELETE', async () => {
      mock.onDelete(`${ BASE }/tags/remove`).reply('true')

      const result = await service.removeTag(123, 'vip')

      expect(result).toEqual({ success: true, objectId: 123, object: 'Ticket', tag: 'vip' })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].body).toEqual({ object: 'Ticket', o_id: 123, item: 'vip' })
    })
  })

  describe('listTagsForObject', () => {
    it('lists tags with the default object type', async () => {
      mock.onGet(`${ BASE }/tags`).reply({ tags: ['vip'] })

      const result = await service.listTagsForObject(123)

      expect(result).toEqual({ tags: ['vip'] })
      expect(mock.history[0].query).toEqual({ object: 'Ticket', o_id: 123 })
    })

    it('honours an explicit object type', async () => {
      mock.onGet(`${ BASE }/tags`).reply({ tags: [] })

      await service.listTagsForObject(123, 'Ticket')

      expect(mock.history[0].query).toEqual({ object: 'Ticket', o_id: 123 })
    })
  })

  // ── Dictionaries ──

  describe('getGroupsDictionary', () => {
    it('maps groups to dictionary items', async () => {
      mock.onGet(`${ BASE }/groups`).reply([
        { id: 1, name: 'Users', active: true },
        { id: 2, name: 'Sales', active: false },
      ])

      const result = await service.getGroupsDictionary({})

      expect(result).toEqual({
        items: [
          { label: 'Users', value: '1', note: 'Active' },
          { label: 'Sales', value: '2', note: 'Inactive' },
        ],
        cursor: null,
      })
    })

    it('filters case-insensitively by name', async () => {
      mock.onGet(`${ BASE }/groups`).reply([
        { id: 1, name: 'Users', active: true },
        { id: 2, name: 'Sales', active: true },
      ])

      const result = await service.getGroupsDictionary({ search: 'SAL' })

      expect(result.items).toEqual([{ label: 'Sales', value: '2', note: 'Active' }])
    })

    it('handles a null payload', async () => {
      mock.onGet(`${ BASE }/groups`).reply([{ id: 1, name: 'Users', active: true }])

      const result = await service.getGroupsDictionary(null)

      expect(result.items).toHaveLength(1)
      expect(result.cursor).toBeNull()
    })

    it('handles a null response', async () => {
      mock.onGet(`${ BASE }/groups`).reply(null)

      const result = await service.getGroupsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getUsersDictionary', () => {
    it('lists users when no search term is given', async () => {
      mock.onGet(`${ BASE }/users`).reply([
        { id: 45, firstname: 'Jane', lastname: 'Doe', email: 'jane@example.com' },
      ])

      const result = await service.getUsersDictionary({})

      expect(result).toEqual({
        items: [{ label: 'Jane Doe', value: '45', note: 'jane@example.com' }],
        cursor: null,
      })

      expect(mock.history[0].url).toBe(`${ BASE }/users`)
      expect(mock.history[0].query).toEqual({ page: 1, per_page: 50 })
    })

    it('uses the search endpoint when a term is given', async () => {
      mock.onGet(`${ BASE }/users/search`).reply([{ id: 45, login: 'jane', email: 'jane@example.com' }])

      const result = await service.getUsersDictionary({ search: 'jane' })

      expect(mock.history[0].url).toBe(`${ BASE }/users/search`)
      expect(mock.history[0].query).toEqual({ query: 'jane', page: 1, per_page: 50 })
      expect(result.items).toEqual([{ label: 'jane', value: '45', note: 'jane@example.com' }])
    })

    it('falls back to email then id for the label', async () => {
      mock.onGet(`${ BASE }/users`).reply([{ id: 46, email: 'x@y.z' }, { id: 47 }])

      const result = await service.getUsersDictionary({})

      expect(result.items).toEqual([
        { label: 'x@y.z', value: '46', note: 'x@y.z' },
        { label: '47', value: '47', note: undefined },
      ])
    })

    it('returns the next page cursor when a full page is returned', async () => {
      const users = Array.from({ length: 50 }, (_, i) => ({ id: i + 1, firstname: `U${ i }` }))

      mock.onGet(`${ BASE }/users`).reply(users)

      const result = await service.getUsersDictionary({ cursor: '2' })

      expect(mock.history[0].query).toMatchObject({ page: 2 })
      expect(result.cursor).toBe('3')
    })

    it('handles a null payload and a null response', async () => {
      mock.onGet(`${ BASE }/users`).reply(null)

      const result = await service.getUsersDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getStatesDictionary', () => {
    it('maps ticket states to dictionary items', async () => {
      mock.onGet(`${ BASE }/ticket_states`).reply([
        { id: 2, name: 'open', active: true },
        { id: 4, name: 'closed', active: false },
      ])

      const result = await service.getStatesDictionary({})

      expect(result).toEqual({
        items: [
          { label: 'open', value: 'open', note: 'Active' },
          { label: 'closed', value: 'closed', note: 'Inactive' },
        ],
        cursor: null,
      })
    })

    it('filters case-insensitively by name', async () => {
      mock.onGet(`${ BASE }/ticket_states`).reply([
        { id: 2, name: 'open', active: true },
        { id: 4, name: 'closed', active: true },
      ])

      const result = await service.getStatesDictionary({ search: 'CLOS' })

      expect(result.items).toEqual([{ label: 'closed', value: 'closed', note: 'Active' }])
    })

    it('handles a null payload and a null response', async () => {
      mock.onGet(`${ BASE }/ticket_states`).reply(null)

      const result = await service.getStatesDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('propagates API errors', async () => {
      mock.onGet(`${ BASE }/ticket_states`).replyWithError({ message: 'Boom', body: { error: 'nope' } })

      await expect(service.getStatesDictionary({})).rejects.toThrow('Zammad API error: nope')
    })
  })
})
