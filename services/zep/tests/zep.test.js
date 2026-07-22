'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-api-key'
const BASE = 'https://api.getzep.com/api/v2'

const AUTH_HEADERS = {
  'Authorization': `Api-Key ${ API_KEY }`,
  'Content-Type': 'application/json',
}

describe('Zep Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ apiKey: API_KEY })
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
    it('registers a single required apiKey config item', () => {
      const configItems = sandbox.getConfigItems()

      expect(configItems).toHaveLength(1)

      expect(configItems[0]).toMatchObject({
        name: 'apiKey',
        displayName: 'API Key',
        type: 'STRING',
        required: true,
        shared: false,
      })
    })

    it('exposes all documented operations', () => {
      const methods = [
        'addUser', 'getUser', 'listUsers', 'updateUser', 'deleteUser', 'getUserNode',
        'createThread', 'getThread', 'listUserThreads', 'deleteThread',
        'addMessages', 'getThreadContext', 'getMessages',
        'addGraphData', 'searchGraph', 'getUserGraphEpisodes',
        'createGraph', 'getGraph', 'getUsersDictionary',
      ]

      for (const method of methods) {
        expect(typeof service[method]).toBe('function')
      }
    })
  })

  // ── Users ──

  describe('addUser', () => {
    it('sends POST with all fields and auth headers', async () => {
      mock.onPost(`${ BASE }/users`).reply({ user_id: 'user-123' })

      const result = await service.addUser('user-123', 'jane@example.com', 'Jane', 'Doe', { plan: 'pro' })

      expect(result).toEqual({ user_id: 'user-123' })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/users`)
      expect(mock.history[0].headers).toMatchObject(AUTH_HEADERS)

      expect(mock.history[0].body).toEqual({
        user_id: 'user-123',
        email: 'jane@example.com',
        first_name: 'Jane',
        last_name: 'Doe',
        metadata: { plan: 'pro' },
      })
    })

    it('omits optional fields that are undefined or empty', async () => {
      mock.onPost(`${ BASE }/users`).reply({ user_id: 'user-123' })

      await service.addUser('user-123', '', undefined, null)

      expect(mock.history[0].body).toEqual({ user_id: 'user-123' })
    })
  })

  describe('getUser', () => {
    it('sends GET to the encoded user URL', async () => {
      mock.onGet(`${ BASE }/users/user-123`).reply({ user_id: 'user-123' })

      const result = await service.getUser('user-123')

      expect(result).toEqual({ user_id: 'user-123' })
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].body).toBeUndefined()
    })

    it('url-encodes the user id', async () => {
      mock.onGet(`${ BASE }/users/user%2F1%201`).reply({ user_id: 'user/1 1' })

      await service.getUser('user/1 1')

      expect(mock.history[0].url).toBe(`${ BASE }/users/user%2F1%201`)
    })
  })

  describe('listUsers', () => {
    it('applies default pagination', async () => {
      mock.onGet(`${ BASE }/users-ordered`).reply({ users: [], total_count: 0 })

      const result = await service.listUsers()

      expect(result).toEqual({ users: [], total_count: 0 })
      expect(mock.history[0].query).toEqual({ pageNumber: 1, pageSize: 25 })
    })

    it('passes custom pagination', async () => {
      mock.onGet(`${ BASE }/users-ordered`).reply({ users: [] })

      await service.listUsers(3, 50)

      expect(mock.history[0].query).toEqual({ pageNumber: 3, pageSize: 50 })
    })
  })

  describe('updateUser', () => {
    it('sends PATCH with only the provided fields', async () => {
      mock.onPatch(`${ BASE }/users/user-123`).reply({ user_id: 'user-123' })

      await service.updateUser('user-123', 'jane.new@example.com')

      expect(mock.history[0].method).toBe('patch')
      expect(mock.history[0].url).toBe(`${ BASE }/users/user-123`)
      expect(mock.history[0].body).toEqual({ email: 'jane.new@example.com' })
    })

    it('sends all fields when provided', async () => {
      mock.onPatch(`${ BASE }/users/user-123`).reply({ user_id: 'user-123' })

      await service.updateUser('user-123', 'j@example.com', 'Jane', 'Smith', { plan: 'enterprise' })

      expect(mock.history[0].body).toEqual({
        email: 'j@example.com',
        first_name: 'Jane',
        last_name: 'Smith',
        metadata: { plan: 'enterprise' },
      })
    })
  })

  describe('deleteUser', () => {
    it('sends DELETE to the user URL', async () => {
      mock.onDelete(`${ BASE }/users/user-123`).reply({ message: 'user deleted' })

      const result = await service.deleteUser('user-123')

      expect(result).toEqual({ message: 'user deleted' })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].body).toBeUndefined()
    })
  })

  describe('getUserNode', () => {
    it('sends GET to the user node URL', async () => {
      mock.onGet(`${ BASE }/users/user-123/node`).reply({ node: { uuid: 'n1' } })

      const result = await service.getUserNode('user-123')

      expect(result).toEqual({ node: { uuid: 'n1' } })
    })
  })

  // ── Threads ──

  describe('createThread', () => {
    it('sends POST with thread and user ids', async () => {
      mock.onPost(`${ BASE }/threads`).reply({ thread_id: 'thread-abc' })

      await service.createThread('thread-abc', 'user-123', { source: 'web' })

      expect(mock.history[0].body).toEqual({
        thread_id: 'thread-abc',
        user_id: 'user-123',
        metadata: { source: 'web' },
      })
    })

    it('omits metadata when not provided', async () => {
      mock.onPost(`${ BASE }/threads`).reply({ thread_id: 'thread-abc' })

      await service.createThread('thread-abc', 'user-123')

      expect(mock.history[0].body).toEqual({ thread_id: 'thread-abc', user_id: 'user-123' })
    })
  })

  describe('getThread', () => {
    it('sends GET to the encoded thread URL', async () => {
      mock.onGet(`${ BASE }/threads/thread%20abc`).reply({ thread_id: 'thread abc' })

      await service.getThread('thread abc')

      expect(mock.history[0].url).toBe(`${ BASE }/threads/thread%20abc`)
    })
  })

  describe('listUserThreads', () => {
    it('sends GET to the user threads URL', async () => {
      mock.onGet(`${ BASE }/users/user-123/threads`).reply({ threads: [] })

      const result = await service.listUserThreads('user-123')

      expect(result).toEqual({ threads: [] })
    })
  })

  describe('deleteThread', () => {
    it('sends DELETE to the thread URL', async () => {
      mock.onDelete(`${ BASE }/threads/thread-abc`).reply({ message: 'thread deleted' })

      const result = await service.deleteThread('thread-abc')

      expect(result).toEqual({ message: 'thread deleted' })
      expect(mock.history[0].method).toBe('delete')
    })
  })

  // ── Memory ──

  describe('addMessages', () => {
    it('normalizes friendly role labels and posts to the thread', async () => {
      mock.onPost(`${ BASE }/threads/thread-abc/messages`).reply({ message_uuids: ['m1'] })

      const result = await service.addMessages('thread-abc', [
        { role: 'User', content: 'Hi', name: 'Jane' },
        { role: 'Assistant', content: 'Hello' },
        { role: 'System', content: 'Be brief' },
      ])

      expect(result).toEqual({ message_uuids: ['m1'] })

      expect(mock.history[0].body).toEqual({
        messages: [
          { role: 'user', content: 'Hi', name: 'Jane' },
          { role: 'assistant', content: 'Hello' },
          { role: 'system', content: 'Be brief' },
        ],
      })
    })

    it('passes unmapped roles through unchanged', async () => {
      mock.onPost(`${ BASE }/threads/thread-abc/messages`).reply({})

      await service.addMessages('thread-abc', [{ role: 'user', content: 'Hi' }])

      expect(mock.history[0].body.messages[0].role).toBe('user')
    })

    it('includes return_context only when explicitly true', async () => {
      mock.onPost(`${ BASE }/threads/thread-abc/messages`).reply({})

      await service.addMessages('thread-abc', [{ role: 'User', content: 'Hi' }], true)
      expect(mock.history[0].body.return_context).toBe(true)

      await service.addMessages('thread-abc', [{ role: 'User', content: 'Hi' }], false)
      expect(mock.history[1].body.return_context).toBeUndefined()
    })

    it('handles a missing messages list', async () => {
      mock.onPost(`${ BASE }/threads/thread-abc/messages`).reply({})

      await service.addMessages('thread-abc', undefined)

      expect(mock.history[0].body).toEqual({ messages: [] })
    })
  })

  describe('getThreadContext', () => {
    it('maps the friendly mode label', async () => {
      mock.onGet(`${ BASE }/threads/thread-abc/context`).reply({ context: 'FACTS' })

      const result = await service.getThreadContext('thread-abc', 'Summary')

      expect(result).toEqual({ context: 'FACTS' })
      expect(mock.history[0].query).toEqual({ mode: 'summary' })
    })

    it('maps Basic mode', async () => {
      mock.onGet(`${ BASE }/threads/thread-abc/context`).reply({ context: '' })

      await service.getThreadContext('thread-abc', 'Basic')

      expect(mock.history[0].query).toEqual({ mode: 'basic' })
    })

    it('omits the mode when not provided', async () => {
      mock.onGet(`${ BASE }/threads/thread-abc/context`).reply({ context: '' })

      await service.getThreadContext('thread-abc')

      expect(mock.history[0].query).toEqual({})
    })
  })

  describe('getMessages', () => {
    it('sends limit and cursor when provided', async () => {
      mock.onGet(`${ BASE }/threads/thread-abc/messages`).reply({ messages: [] })

      await service.getMessages('thread-abc', 10, 5)

      expect(mock.history[0].query).toEqual({ limit: 10, cursor: 5 })
    })

    it('omits pagination when not provided', async () => {
      mock.onGet(`${ BASE }/threads/thread-abc/messages`).reply({ messages: [] })

      const result = await service.getMessages('thread-abc')

      expect(result).toEqual({ messages: [] })
      expect(mock.history[0].query).toEqual({})
    })
  })

  // ── Graph ──

  describe('addGraphData', () => {
    it('maps the type label and targets a user graph', async () => {
      mock.onPost(`${ BASE }/graph`).reply({ uuid: 'e1' })

      await service.addGraphData('Jane likes tea.', 'Text', 'user-123')

      expect(mock.history[0].body).toEqual({
        data: 'Jane likes tea.',
        type: 'text',
        user_id: 'user-123',
      })
    })

    it('maps every type label', async () => {
      mock.onPost(`${ BASE }/graph`).reply({})

      const cases = [['JSON', 'json'], ['Message', 'message'], ['Fact Triple', 'fact_triple']]

      for (const [label] of cases) {
        await service.addGraphData('data', label, undefined, 'policies')
      }

      cases.forEach(([, expected], index) => {
        expect(mock.history[index].body).toEqual({ data: 'data', type: expected, graph_id: 'policies' })
      })
    })
  })

  describe('searchGraph', () => {
    it('applies default limit and maps scope and reranker', async () => {
      mock.onPost(`${ BASE }/graph/search`).reply({ edges: [] })

      const result = await service.searchGraph('berlin', 'user-123', undefined, 'Edges', undefined, 'RRF')

      expect(result).toEqual({ edges: [] })

      expect(mock.history[0].body).toEqual({
        query: 'berlin',
        user_id: 'user-123',
        scope: 'edges',
        limit: 10,
        reranker: 'rrf',
      })
    })

    it('maps every scope and reranker label', async () => {
      mock.onPost(`${ BASE }/graph/search`).reply({})

      await service.searchGraph('q', undefined, 'policies', 'Thread Summaries', 25, 'Cross Encoder')

      expect(mock.history[0].body).toEqual({
        query: 'q',
        graph_id: 'policies',
        scope: 'thread_summaries',
        limit: 25,
        reranker: 'cross_encoder',
      })
    })

    it('omits scope and reranker when not provided', async () => {
      mock.onPost(`${ BASE }/graph/search`).reply({})

      await service.searchGraph('q', 'user-123')

      expect(mock.history[0].body).toEqual({ query: 'q', user_id: 'user-123', limit: 10 })
    })
  })

  describe('getUserGraphEpisodes', () => {
    it('sends the lastn query param', async () => {
      mock.onGet(`${ BASE }/graph/episodes/user/user-123`).reply({ episodes: [] })

      const result = await service.getUserGraphEpisodes('user-123', 5)

      expect(result).toEqual({ episodes: [] })
      expect(mock.history[0].query).toEqual({ lastn: 5 })
    })

    it('omits lastn when not provided', async () => {
      mock.onGet(`${ BASE }/graph/episodes/user/user-123`).reply({ episodes: [] })

      await service.getUserGraphEpisodes('user-123')

      expect(mock.history[0].query).toEqual({})
    })
  })

  // ── Graphs ──

  describe('createGraph', () => {
    it('sends POST with graph fields', async () => {
      mock.onPost(`${ BASE }/graph/create`).reply({ graph_id: 'policies' })

      await service.createGraph('policies', 'Company Policies', 'HR + IT')

      expect(mock.history[0].body).toEqual({
        graph_id: 'policies',
        name: 'Company Policies',
        description: 'HR + IT',
      })
    })

    it('omits optional fields', async () => {
      mock.onPost(`${ BASE }/graph/create`).reply({ graph_id: 'policies' })

      await service.createGraph('policies')

      expect(mock.history[0].body).toEqual({ graph_id: 'policies' })
    })
  })

  describe('getGraph', () => {
    it('sends GET to the encoded graph URL', async () => {
      mock.onGet(`${ BASE }/graph/policies`).reply({ graph_id: 'policies' })

      const result = await service.getGraph('policies')

      expect(result).toEqual({ graph_id: 'policies' })
    })
  })

  // ── Dictionary ──

  describe('getUsersDictionary', () => {
    it('maps users to label/value/note', async () => {
      mock.onGet(`${ BASE }/users-ordered`).reply({
        users: [
          { user_id: 'user-123', first_name: 'Jane', last_name: 'Doe', email: 'jane@example.com' },
          { user_id: 'user-456' },
        ],
      })

      const result = await service.getUsersDictionary({})

      expect(result).toEqual({
        items: [
          { label: 'Jane Doe (user-123)', value: 'user-123', note: 'jane@example.com' },
          { label: 'user-456', value: 'user-456', note: undefined },
        ],
        cursor: undefined,
      })

      expect(mock.history[0].query).toEqual({ pageNumber: 1, pageSize: 25 })
    })

    it('handles a null payload', async () => {
      mock.onGet(`${ BASE }/users-ordered`).reply({ users: [{ user_id: 'user-123' }] })

      const result = await service.getUsersDictionary(null)

      expect(result.items).toHaveLength(1)
      expect(mock.history[0].query).toEqual({ pageNumber: 1, pageSize: 25 })
    })

    it('filters by case-insensitive search across id, email and names', async () => {
      mock.onGet(`${ BASE }/users-ordered`).reply({
        users: [
          { user_id: 'user-123', first_name: 'Jane', email: 'jane@example.com' },
          { user_id: 'user-456', first_name: 'Bob', email: 'bob@example.com' },
        ],
      })

      const result = await service.getUsersDictionary({ search: 'JANE' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('user-123')
    })

    it('returns an empty list when nothing matches', async () => {
      mock.onGet(`${ BASE }/users-ordered`).reply({ users: [{ user_id: 'user-123' }] })

      const result = await service.getUsersDictionary({ search: 'nomatch' })

      expect(result.items).toEqual([])
    })

    it('handles a missing users array', async () => {
      mock.onGet(`${ BASE }/users-ordered`).reply({})

      const result = await service.getUsersDictionary({})

      expect(result).toEqual({ items: [], cursor: undefined })
    })

    it('uses the cursor as the page number and advances it when a full page comes back', async () => {
      const users = Array.from({ length: 25 }, (_, index) => ({ user_id: `user-${ index }` }))

      mock.onGet(`${ BASE }/users-ordered`).reply({ users })

      const result = await service.getUsersDictionary({ cursor: '2' })

      expect(mock.history[0].query).toEqual({ pageNumber: 2, pageSize: 25 })
      expect(result.cursor).toBe('3')
    })

    it('falls back to page 1 for an unparsable cursor', async () => {
      mock.onGet(`${ BASE }/users-ordered`).reply({ users: [] })

      await service.getUsersDictionary({ cursor: 'abc' })

      expect(mock.history[0].query).toEqual({ pageNumber: 1, pageSize: 25 })
    })
  })

  // ── Errors ──

  describe('error handling', () => {
    it('surfaces the API message and status', async () => {
      mock.onGet(`${ BASE }/users/user-123`).replyWithError({
        message: 'Not Found',
        status: 404,
        body: { message: 'user not found' },
      })

      await expect(service.getUser('user-123')).rejects.toThrow('Zep API error (404): user not found')
    })

    it('falls back to body.error', async () => {
      mock.onPost(`${ BASE }/users`).replyWithError({
        message: 'Bad Request',
        statusCode: 400,
        body: { error: 'user already exists' },
      })

      await expect(service.addUser('user-123')).rejects.toThrow('Zep API error (400): user already exists')
    })

    it('falls back to the transport error message without a status', async () => {
      mock.onPost(`${ BASE }/graph/search`).replyWithError({ message: 'Network timeout' })

      await expect(service.searchGraph('q', 'user-123')).rejects.toThrow('Zep API error: Network timeout')
    })
  })
})
