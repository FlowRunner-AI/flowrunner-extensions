'use strict'

const { createSandbox } = require('../../../service-sandbox')

const CLIENT_ID = 'test-client-id'
const CLIENT_SECRET = 'test-client-secret'
const ACCESS_TOKEN = 'test-access-token'
const ACCOUNT_ID = '1234567'
const COMPOSITE_TOKEN = `${ ACCESS_TOKEN }::bc3::${ ACCOUNT_ID }`
const API_BASE = `https://3.basecampapi.com/${ ACCOUNT_ID }`

const LAUNCHPAD_AUTHORIZE_URL = 'https://launchpad.37signals.com/authorization/new'
const LAUNCHPAD_TOKEN_URL = 'https://launchpad.37signals.com/authorization/token'
const LAUNCHPAD_AUTH_INFO_URL = 'https://launchpad.37signals.com/authorization.json'

const USER_AGENT = 'FlowRunner Integration (support@flowrunner.com)'

// Reusable mock project with dock entries
const MOCK_PROJECT = {
  id: 2085958499,
  status: 'active',
  name: 'Marketing Campaign',
  description: 'Q3 launch',
  dock: [
    { id: 100, name: 'todoset', title: 'To-dos', enabled: true },
    { id: 101, name: 'message_board', title: 'Message Board', enabled: true },
    { id: 102, name: 'vault', title: 'Docs & Files', enabled: true },
    { id: 103, name: 'chat', title: 'Campfire', enabled: true },
    { id: 104, name: 'schedule', title: 'Schedule', enabled: true },
  ],
}

// Standard headers expected on API calls (no body)
const expectedHeaders = {
  'Authorization': `Bearer ${ ACCESS_TOKEN }`,
  'User-Agent': USER_AGENT,
  'Accept': 'application/json',
}

// Standard headers expected on API calls with body
const expectedHeadersWithBody = {
  ...expectedHeaders,
  'Content-Type': 'application/json',
}

// Helper: wrap a body in the unwrapBody(false) response envelope
function apiReply(body, headers = {}) {
  return { body, headers }
}

function paginatedReply(items, opts = {}) {
  const headers = {}

  if (opts.nextPageUrl) {
    headers.link = `<${ opts.nextPageUrl }>; rel="next"`
  }

  if (opts.totalCount !== undefined) {
    headers['x-total-count'] = String(opts.totalCount)
  }

  return { body: items, headers }
}

describe('Basecamp Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET })
    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()

    // Simulate the OAuth access token header on every call
    service.request = { headers: { 'oauth-access-token': COMPOSITE_TOKEN } }
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
      const configs = sandbox.getConfigItems()

      expect(configs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'clientId', required: true, shared: true }),
          expect.objectContaining({ name: 'clientSecret', required: true, shared: true }),
        ])
      )
    })
  })

  // ── OAuth2 System Methods ──

  describe('getOAuth2ConnectionURL', () => {
    it('returns the Launchpad authorization URL with client_id and type', async () => {
      const url = await service.getOAuth2ConnectionURL()

      expect(url).toContain(LAUNCHPAD_AUTHORIZE_URL)
      expect(url).toContain(`client_id=${ CLIENT_ID }`)
      expect(url).toContain('type=web_server')
    })
  })

  describe('executeCallback', () => {
    it('exchanges the code for a composite token and fetches authorization info', async () => {
      const tokenResponse = {
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        expires_in: 1209600,
      }

      const authInfo = {
        identity: { first_name: 'Victor', last_name: 'Cooper', email_address: 'victor@example.com' },
        accounts: [
          { id: 9999999, product: 'bc3', name: 'Honcho Design' },
        ],
      }

      mock.onPost(LAUNCHPAD_TOKEN_URL).reply(tokenResponse)
      mock.onGet(LAUNCHPAD_AUTH_INFO_URL).reply(authInfo)

      const result = await service.executeCallback({
        code: 'auth-code',
        redirectURI: 'https://flowrunner.com/callback',
      })

      expect(result.token).toBe(`new-access-token::bc3::9999999`)
      expect(result.refreshToken).toBe('new-refresh-token')
      expect(result.expirationInSeconds).toBe(1209600)
      expect(result.connectionIdentityName).toBe('Victor Cooper (Honcho Design)')
      expect(result.overwrite).toBe(true)
      expect(result.userData).toEqual({
        accountId: 9999999,
        accountName: 'Honcho Design',
        email: 'victor@example.com',
      })

      // Verify token exchange request
      const tokenCall = mock.history.find(c => c.url === LAUNCHPAD_TOKEN_URL)

      expect(tokenCall.query).toMatchObject({
        type: 'web_server',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code: 'auth-code',
        redirect_uri: 'https://flowrunner.com/callback',
      })
    })

    it('throws when no bc3 account is found', async () => {
      mock.onPost(LAUNCHPAD_TOKEN_URL).reply({ access_token: 'tok', refresh_token: 'ref', expires_in: 100 })
      mock.onGet(LAUNCHPAD_AUTH_INFO_URL).reply({ identity: {}, accounts: [{ id: 1, product: 'bcx' }] })

      await expect(service.executeCallback({ code: 'c', redirectURI: 'u' }))
        .rejects.toThrow('no Basecamp account')
    })
  })

  describe('refreshToken', () => {
    it('sends refresh request and returns a new composite token preserving accountId', async () => {
      mock.onPost(LAUNCHPAD_TOKEN_URL).reply({
        access_token: 'refreshed-token',
        refresh_token: 'refreshed-refresh',
        expires_in: 1209600,
      })

      const result = await service.refreshToken('old-refresh-token')

      expect(result.token).toBe(`refreshed-token::bc3::${ ACCOUNT_ID }`)
      expect(result.refreshToken).toBe('refreshed-refresh')
      expect(result.expirationInSeconds).toBe(1209600)

      expect(mock.history[0].query).toMatchObject({
        type: 'refresh',
        refresh_token: 'old-refresh-token',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
      })
    })

    it('keeps old refresh token when response does not include one', async () => {
      mock.onPost(LAUNCHPAD_TOKEN_URL).reply({
        access_token: 'refreshed-token',
        expires_in: 100,
      })

      const result = await service.refreshToken('keep-this')

      expect(result.refreshToken).toBe('keep-this')
    })
  })

  // ── Projects ──

  describe('listProjects', () => {
    it('sends GET to projects.json with defaults', async () => {
      mock.onGet(`${ API_BASE }/projects.json`).reply(paginatedReply([MOCK_PROJECT], { totalCount: 1 }))

      const result = await service.listProjects()

      expect(result.items).toHaveLength(1)
      expect(result.totalCount).toBe(1)
      expect(mock.history[0].headers).toMatchObject(expectedHeaders)
    })

    it('maps Active status to omitting the status param', async () => {
      mock.onGet(`${ API_BASE }/projects.json`).reply(paginatedReply([]))

      await service.listProjects('Active')

      expect(mock.history[0].query.status).toBeUndefined()
    })

    it('maps Archived status to archived query param', async () => {
      mock.onGet(`${ API_BASE }/projects.json`).reply(paginatedReply([]))

      await service.listProjects('Archived')

      expect(mock.history[0].query).toMatchObject({ status: 'archived' })
    })

    it('passes page parameter', async () => {
      mock.onGet(`${ API_BASE }/projects.json`).reply(paginatedReply([]))

      await service.listProjects(undefined, 3)

      expect(mock.history[0].query).toMatchObject({ page: 3 })
    })

    it('parses Link header for nextPage', async () => {
      mock.onGet(`${ API_BASE }/projects.json`).reply(
        paginatedReply([MOCK_PROJECT], {
          nextPageUrl: `${ API_BASE }/projects.json?page=2`,
          totalCount: 30,
        })
      )

      const result = await service.listProjects()

      expect(result.nextPage).toBe(2)
      expect(result.nextPageUrl).toBe(`${ API_BASE }/projects.json?page=2`)
    })
  })

  describe('getProject', () => {
    it('sends GET to the project URL', async () => {
      mock.onGet(`${ API_BASE }/projects/123.json`).reply(apiReply(MOCK_PROJECT))

      const result = await service.getProject('123')

      expect(result).toEqual(MOCK_PROJECT)
    })

    it('throws when projectId is missing', async () => {
      await expect(service.getProject()).rejects.toThrow('Project is required')
    })
  })

  describe('createProject', () => {
    it('sends POST with name and description', async () => {
      mock.onPost(`${ API_BASE }/projects.json`).reply(apiReply({ id: 999, name: 'New' }))

      const result = await service.createProject('New', 'A description')

      expect(result).toEqual({ id: 999, name: 'New' })
      expect(mock.history[0].body).toEqual({ name: 'New', description: 'A description' })
      expect(mock.history[0].headers).toMatchObject(expectedHeadersWithBody)
    })

    it('omits description when not provided', async () => {
      mock.onPost(`${ API_BASE }/projects.json`).reply(apiReply({ id: 999, name: 'New' }))

      await service.createProject('New')

      expect(mock.history[0].body).toEqual({ name: 'New' })
    })

    it('throws when name is missing', async () => {
      await expect(service.createProject()).rejects.toThrow('Name is required')
    })
  })

  describe('updateProject', () => {
    it('fetches the existing project then sends PUT with merged fields', async () => {
      // First call: fetch existing
      mock.onGet(`${ API_BASE }/projects/123.json`).reply(apiReply({ name: 'Old', description: 'Old desc' }))
      // Second call: update
      mock.onPut(`${ API_BASE }/projects/123.json`).reply(apiReply({ id: 123, name: 'New', description: 'Old desc' }))

      const result = await service.updateProject('123', 'New')

      expect(result).toEqual({ id: 123, name: 'New', description: 'Old desc' })
      // The PUT body should keep the old description
      const putCall = mock.history.find(c => c.method === 'put')

      expect(putCall.body).toEqual({ name: 'New', description: 'Old desc' })
    })

    it('throws when projectId is missing', async () => {
      await expect(service.updateProject()).rejects.toThrow('Project is required')
    })
  })

  describe('trashProject', () => {
    it('sends DELETE and returns trashed confirmation', async () => {
      mock.onDelete(`${ API_BASE }/projects/123.json`).reply(apiReply(null))

      const result = await service.trashProject('123')

      expect(result).toEqual({ trashed: true, projectId: '123' })
    })

    it('throws when projectId is missing', async () => {
      await expect(service.trashProject()).rejects.toThrow('Project is required')
    })
  })

  // ── To-do Lists ──

  describe('getTodoset', () => {
    it('resolves the todoset from the project dock and fetches it', async () => {
      mock.onGet(`${ API_BASE }/projects/123.json`).reply(apiReply(MOCK_PROJECT))
      mock.onGet(`${ API_BASE }/buckets/123/todosets/100.json`).reply(apiReply({ id: 100, type: 'Todoset' }))

      const result = await service.getTodoset('123')

      expect(result).toEqual({ id: 100, type: 'Todoset' })
    })

    it('throws when projectId is missing', async () => {
      await expect(service.getTodoset()).rejects.toThrow('Project is required')
    })
  })

  describe('listTodoLists', () => {
    it('resolves todoset and lists to-do lists with pagination', async () => {
      mock.onGet(`${ API_BASE }/projects/123.json`).reply(apiReply(MOCK_PROJECT))
      mock.onGet(`${ API_BASE }/buckets/123/todosets/100/todolists.json`).reply(
        paginatedReply([{ id: 200, name: 'Checklist' }], { totalCount: 1 })
      )

      const result = await service.listTodoLists('123')

      expect(result.items).toHaveLength(1)
      expect(result.items[0].name).toBe('Checklist')
    })

    it('passes status and page params', async () => {
      mock.onGet(`${ API_BASE }/projects/123.json`).reply(apiReply(MOCK_PROJECT))
      mock.onGet(`${ API_BASE }/buckets/123/todosets/100/todolists.json`).reply(paginatedReply([]))

      await service.listTodoLists('123', 'Trashed', 2)

      const listCall = mock.history.find(c => c.url.includes('todolists.json'))

      expect(listCall.query).toMatchObject({ status: 'trashed', page: 2 })
    })

    it('throws when projectId is missing', async () => {
      await expect(service.listTodoLists()).rejects.toThrow('Project is required')
    })
  })

  describe('getTodoList', () => {
    it('fetches a single to-do list by id', async () => {
      mock.onGet(`${ API_BASE }/buckets/123/todolists/200.json`).reply(apiReply({ id: 200, name: 'List' }))

      const result = await service.getTodoList('123', '200')

      expect(result).toEqual({ id: 200, name: 'List' })
    })

    it('throws when todolistId is missing', async () => {
      await expect(service.getTodoList('123')).rejects.toThrow('To-do List is required')
    })
  })

  describe('createTodoList', () => {
    it('resolves todoset and sends POST with name and description', async () => {
      mock.onGet(`${ API_BASE }/projects/123.json`).reply(apiReply(MOCK_PROJECT))
      mock.onPost(`${ API_BASE }/buckets/123/todosets/100/todolists.json`).reply(apiReply({ id: 201, name: 'QA' }))

      const result = await service.createTodoList('123', 'QA', '<p>Checks</p>')

      expect(result).toEqual({ id: 201, name: 'QA' })

      const postCall = mock.history.find(c => c.method === 'post')

      expect(postCall.body).toEqual({ name: 'QA', description: '<p>Checks</p>' })
    })

    it('omits description when not provided', async () => {
      mock.onGet(`${ API_BASE }/projects/123.json`).reply(apiReply(MOCK_PROJECT))
      mock.onPost(`${ API_BASE }/buckets/123/todosets/100/todolists.json`).reply(apiReply({ id: 201 }))

      await service.createTodoList('123', 'QA')

      const postCall = mock.history.find(c => c.method === 'post')

      expect(postCall.body).toEqual({ name: 'QA' })
    })

    it('throws when name is missing', async () => {
      await expect(service.createTodoList('123')).rejects.toThrow('Name is required')
    })
  })

  describe('updateTodoList', () => {
    it('fetches existing list then sends PUT with merged fields', async () => {
      mock.onGet(`${ API_BASE }/buckets/123/todolists/200.json`).reply(apiReply({ name: 'Old', description: 'Old desc' }))
      mock.onPut(`${ API_BASE }/buckets/123/todolists/200.json`).reply(apiReply({ id: 200, name: 'New' }))

      const result = await service.updateTodoList('123', '200', 'New')

      expect(result).toEqual({ id: 200, name: 'New' })

      const putCall = mock.history.find(c => c.method === 'put')

      expect(putCall.body).toEqual({ name: 'New', description: 'Old desc' })
    })

    it('throws when todolistId is missing', async () => {
      await expect(service.updateTodoList('123')).rejects.toThrow('To-do List is required')
    })
  })

  // ── To-dos ──

  describe('listTodos', () => {
    it('sends GET with projectId and todolistId', async () => {
      mock.onGet(`${ API_BASE }/buckets/123/todolists/200/todos.json`).reply(paginatedReply([{ id: 300 }], { totalCount: 1 }))

      const result = await service.listTodos('123', '200')

      expect(result.items).toHaveLength(1)
    })

    it('passes status, completed, and page params', async () => {
      mock.onGet(`${ API_BASE }/buckets/123/todolists/200/todos.json`).reply(paginatedReply([]))

      await service.listTodos('123', '200', 'Archived', true, 3)

      expect(mock.history[0].query).toMatchObject({ status: 'archived', completed: true, page: 3 })
    })

    it('throws when projectId is missing', async () => {
      await expect(service.listTodos()).rejects.toThrow('Project is required')
    })

    it('throws when todolistId is missing', async () => {
      await expect(service.listTodos('123')).rejects.toThrow('To-do List is required')
    })
  })

  describe('getTodo', () => {
    it('fetches a single to-do by id', async () => {
      mock.onGet(`${ API_BASE }/buckets/123/todos/300.json`).reply(apiReply({ id: 300, content: 'Task' }))

      const result = await service.getTodo('123', '300')

      expect(result).toEqual({ id: 300, content: 'Task' })
    })

    it('throws when todoId is missing', async () => {
      await expect(service.getTodo('123')).rejects.toThrow('To-do ID is required')
    })
  })

  describe('createTodo', () => {
    it('sends POST with required fields only', async () => {
      mock.onPost(`${ API_BASE }/buckets/123/todolists/200/todos.json`).reply(apiReply({ id: 301, content: 'Do it' }))

      const result = await service.createTodo('123', '200', 'Do it')

      expect(result).toEqual({ id: 301, content: 'Do it' })
      expect(mock.history[0].body).toEqual({ content: 'Do it' })
    })

    it('sends POST with all optional fields', async () => {
      mock.onPost(`${ API_BASE }/buckets/123/todolists/200/todos.json`).reply(apiReply({ id: 302 }))

      await service.createTodo('123', '200', 'Task', '<p>Desc</p>', [1, 2], [3], true, '2026-08-01', '2026-07-28')

      expect(mock.history[0].body).toEqual({
        content: 'Task',
        description: '<p>Desc</p>',
        assignee_ids: [1, 2],
        completion_subscriber_ids: [3],
        notify: true,
        due_on: '2026-08-01',
        starts_on: '2026-07-28',
      })
    })

    it('parses assigneeIds from a JSON string', async () => {
      mock.onPost(`${ API_BASE }/buckets/123/todolists/200/todos.json`).reply(apiReply({ id: 303 }))

      await service.createTodo('123', '200', 'Task', undefined, '[10, 20]')

      expect(mock.history[0].body.assignee_ids).toEqual([10, 20])
    })

    it('throws on invalid assigneeIds', async () => {
      await expect(service.createTodo('123', '200', 'Task', undefined, 'not-json'))
        .rejects.toThrow('Assignee IDs must be an array')
    })

    it('throws when content is missing', async () => {
      await expect(service.createTodo('123', '200')).rejects.toThrow('Content is required')
    })
  })

  describe('updateTodo', () => {
    it('fetches existing to-do and sends PUT with merged fields', async () => {
      mock.onGet(`${ API_BASE }/buckets/123/todos/300.json`).reply(apiReply({
        content: 'Old task',
        description: 'Old desc',
        assignees: [{ id: 1 }],
        completion_subscribers: [{ id: 2 }],
        due_on: '2026-08-01',
        starts_on: null,
      }))
      mock.onPut(`${ API_BASE }/buckets/123/todos/300.json`).reply(apiReply({ id: 300, content: 'New task' }))

      const result = await service.updateTodo('123', '300', 'New task')

      expect(result).toEqual({ id: 300, content: 'New task' })

      const putCall = mock.history.find(c => c.method === 'put')

      expect(putCall.body).toEqual({
        content: 'New task',
        description: 'Old desc',
        assignee_ids: [1],
        completion_subscriber_ids: [2],
        due_on: '2026-08-01',
        starts_on: null,
      })
    })

    it('includes notify when provided', async () => {
      mock.onGet(`${ API_BASE }/buckets/123/todos/300.json`).reply(apiReply({
        content: 'Task',
        description: '',
        assignees: [],
        completion_subscribers: [],
        due_on: null,
        starts_on: null,
      }))
      mock.onPut(`${ API_BASE }/buckets/123/todos/300.json`).reply(apiReply({ id: 300 }))

      await service.updateTodo('123', '300', undefined, undefined, undefined, undefined, true)

      const putCall = mock.history.find(c => c.method === 'put')

      expect(putCall.body.notify).toBe(true)
    })

    it('throws when todoId is missing', async () => {
      await expect(service.updateTodo('123')).rejects.toThrow('To-do ID is required')
    })
  })

  describe('completeTodo', () => {
    it('sends POST to completion endpoint and returns confirmation', async () => {
      mock.onPost(`${ API_BASE }/buckets/123/todos/300/completion.json`).reply(apiReply(null))

      const result = await service.completeTodo('123', '300')

      expect(result).toEqual({ completed: true, todoId: '300' })
    })

    it('throws when todoId is missing', async () => {
      await expect(service.completeTodo('123')).rejects.toThrow('To-do ID is required')
    })
  })

  describe('uncompleteTodo', () => {
    it('sends DELETE to completion endpoint and returns confirmation', async () => {
      mock.onDelete(`${ API_BASE }/buckets/123/todos/300/completion.json`).reply(apiReply(null))

      const result = await service.uncompleteTodo('123', '300')

      expect(result).toEqual({ completed: false, todoId: '300' })
    })

    it('throws when todoId is missing', async () => {
      await expect(service.uncompleteTodo('123')).rejects.toThrow('To-do ID is required')
    })
  })

  // ── Recordings ──

  describe('trashRecording', () => {
    it('sends PUT to the trashed status endpoint', async () => {
      mock.onPut(`${ API_BASE }/buckets/123/recordings/500/status/trashed.json`).reply(apiReply(null))

      const result = await service.trashRecording('123', '500')

      expect(result).toEqual({ trashed: true, recordingId: '500' })
    })

    it('throws when recordingId is missing', async () => {
      await expect(service.trashRecording('123')).rejects.toThrow('Recording ID is required')
    })
  })

  // ── Messages ──

  describe('listMessages', () => {
    it('resolves message_board from dock and lists messages', async () => {
      mock.onGet(`${ API_BASE }/projects/123.json`).reply(apiReply(MOCK_PROJECT))
      mock.onGet(`${ API_BASE }/buckets/123/message_boards/101/messages.json`).reply(
        paginatedReply([{ id: 400, subject: 'Hello' }], { totalCount: 1 })
      )

      const result = await service.listMessages('123')

      expect(result.items).toHaveLength(1)
    })

    it('passes page parameter', async () => {
      mock.onGet(`${ API_BASE }/projects/123.json`).reply(apiReply(MOCK_PROJECT))
      mock.onGet(`${ API_BASE }/buckets/123/message_boards/101/messages.json`).reply(paginatedReply([]))

      await service.listMessages('123', 2)

      const msgCall = mock.history.find(c => c.url.includes('messages.json'))

      expect(msgCall.query).toMatchObject({ page: 2 })
    })

    it('throws when projectId is missing', async () => {
      await expect(service.listMessages()).rejects.toThrow('Project is required')
    })
  })

  describe('getMessage', () => {
    it('fetches a single message by id', async () => {
      mock.onGet(`${ API_BASE }/buckets/123/messages/400.json`).reply(apiReply({ id: 400, subject: 'Hello' }))

      const result = await service.getMessage('123', '400')

      expect(result).toEqual({ id: 400, subject: 'Hello' })
    })

    it('throws when messageId is missing', async () => {
      await expect(service.getMessage('123')).rejects.toThrow('Message ID is required')
    })
  })

  describe('createMessage', () => {
    it('resolves message_board and sends POST with subject and content', async () => {
      mock.onGet(`${ API_BASE }/projects/123.json`).reply(apiReply(MOCK_PROJECT))
      mock.onPost(`${ API_BASE }/buckets/123/message_boards/101/messages.json`).reply(
        apiReply({ id: 401, subject: 'Update' })
      )

      const result = await service.createMessage('123', 'Update', '<div>Content</div>')

      expect(result).toEqual({ id: 401, subject: 'Update' })

      const postCall = mock.history.find(c => c.method === 'post')

      expect(postCall.body).toEqual({ subject: 'Update', status: 'active', content: '<div>Content</div>' })
    })

    it('omits content when not provided', async () => {
      mock.onGet(`${ API_BASE }/projects/123.json`).reply(apiReply(MOCK_PROJECT))
      mock.onPost(`${ API_BASE }/buckets/123/message_boards/101/messages.json`).reply(apiReply({ id: 401 }))

      await service.createMessage('123', 'Update')

      const postCall = mock.history.find(c => c.method === 'post')

      expect(postCall.body).toEqual({ subject: 'Update', status: 'active' })
    })

    it('throws when subject is missing', async () => {
      await expect(service.createMessage('123')).rejects.toThrow('Subject is required')
    })
  })

  describe('updateMessage', () => {
    it('fetches existing message then sends PUT with merged fields', async () => {
      mock.onGet(`${ API_BASE }/buckets/123/messages/400.json`).reply(
        apiReply({ subject: 'Old Subject', content: '<div>Old</div>' })
      )
      mock.onPut(`${ API_BASE }/buckets/123/messages/400.json`).reply(apiReply({ id: 400, subject: 'New Subject' }))

      const result = await service.updateMessage('123', '400', 'New Subject')

      const putCall = mock.history.find(c => c.method === 'put')

      expect(putCall.body).toEqual({ subject: 'New Subject', content: '<div>Old</div>' })
      expect(result).toEqual({ id: 400, subject: 'New Subject' })
    })

    it('throws when messageId is missing', async () => {
      await expect(service.updateMessage('123')).rejects.toThrow('Message ID is required')
    })
  })

  // ── Comments ──

  describe('listComments', () => {
    it('lists comments on a recording', async () => {
      mock.onGet(`${ API_BASE }/buckets/123/recordings/500/comments.json`).reply(
        paginatedReply([{ id: 600, content: 'Nice' }], { totalCount: 1 })
      )

      const result = await service.listComments('123', '500')

      expect(result.items).toHaveLength(1)
    })

    it('passes page parameter', async () => {
      mock.onGet(`${ API_BASE }/buckets/123/recordings/500/comments.json`).reply(paginatedReply([]))

      await service.listComments('123', '500', 2)

      expect(mock.history[0].query).toMatchObject({ page: 2 })
    })

    it('throws when recordingId is missing', async () => {
      await expect(service.listComments('123')).rejects.toThrow('Recording ID is required')
    })
  })

  describe('getComment', () => {
    it('fetches a single comment by id', async () => {
      mock.onGet(`${ API_BASE }/buckets/123/comments/600.json`).reply(apiReply({ id: 600, content: 'Nice' }))

      const result = await service.getComment('123', '600')

      expect(result).toEqual({ id: 600, content: 'Nice' })
    })

    it('throws when commentId is missing', async () => {
      await expect(service.getComment('123')).rejects.toThrow('Comment ID is required')
    })
  })

  describe('createComment', () => {
    it('sends POST with content to the recording comments endpoint', async () => {
      mock.onPost(`${ API_BASE }/buckets/123/recordings/500/comments.json`).reply(
        apiReply({ id: 601, content: '<div>Done</div>' })
      )

      const result = await service.createComment('123', '500', '<div>Done</div>')

      expect(result).toEqual({ id: 601, content: '<div>Done</div>' })
      expect(mock.history[0].body).toEqual({ content: '<div>Done</div>' })
    })

    it('throws when content is missing', async () => {
      await expect(service.createComment('123', '500')).rejects.toThrow('Content is required')
    })
  })

  // ── Campfire ──

  describe('listCampfires', () => {
    it('lists all campfires', async () => {
      mock.onGet(`${ API_BASE }/chats.json`).reply(paginatedReply([{ id: 103, type: 'Chat::Transcript' }], { totalCount: 1 }))

      const result = await service.listCampfires()

      expect(result.items).toHaveLength(1)
    })

    it('passes page parameter', async () => {
      mock.onGet(`${ API_BASE }/chats.json`).reply(paginatedReply([]))

      await service.listCampfires(2)

      expect(mock.history[0].query).toMatchObject({ page: 2 })
    })
  })

  describe('getCampfireLines', () => {
    it('uses provided chatId', async () => {
      mock.onGet(`${ API_BASE }/buckets/123/chats/999/lines.json`).reply(
        paginatedReply([{ id: 700, content: 'Hello' }], { totalCount: 1 })
      )

      const result = await service.getCampfireLines('123', '999')

      expect(result.items).toHaveLength(1)
    })

    it('resolves chat from dock when chatId is not provided', async () => {
      mock.onGet(`${ API_BASE }/projects/123.json`).reply(apiReply(MOCK_PROJECT))
      mock.onGet(`${ API_BASE }/buckets/123/chats/103/lines.json`).reply(paginatedReply([]))

      await service.getCampfireLines('123')

      const linesCall = mock.history.find(c => c.url.includes('lines.json'))

      expect(linesCall.url).toContain('/chats/103/')
    })

    it('throws when projectId is missing', async () => {
      await expect(service.getCampfireLines()).rejects.toThrow('Project is required')
    })
  })

  describe('createCampfireLine', () => {
    it('sends POST with content to the campfire lines endpoint', async () => {
      mock.onPost(`${ API_BASE }/buckets/123/chats/999/lines.json`).reply(
        apiReply({ id: 701, content: 'Hi team' })
      )

      const result = await service.createCampfireLine('123', '999', 'Hi team')

      expect(result).toEqual({ id: 701, content: 'Hi team' })
      expect(mock.history[0].body).toEqual({ content: 'Hi team' })
    })

    it('resolves chat from dock when chatId is not provided', async () => {
      mock.onGet(`${ API_BASE }/projects/123.json`).reply(apiReply(MOCK_PROJECT))
      mock.onPost(`${ API_BASE }/buckets/123/chats/103/lines.json`).reply(apiReply({ id: 702 }))

      await service.createCampfireLine('123', undefined, 'Msg')

      const postCall = mock.history.find(c => c.method === 'post')

      expect(postCall.url).toContain('/chats/103/')
    })

    it('throws when content is missing', async () => {
      await expect(service.createCampfireLine('123', '999')).rejects.toThrow('Content is required')
    })
  })

  // ── People ──

  describe('listAllPeople', () => {
    it('lists people across the account', async () => {
      mock.onGet(`${ API_BASE }/people.json`).reply(
        paginatedReply([{ id: 1, name: 'Victor' }], { totalCount: 1 })
      )

      const result = await service.listAllPeople()

      expect(result.items).toHaveLength(1)
    })

    it('passes page parameter', async () => {
      mock.onGet(`${ API_BASE }/people.json`).reply(paginatedReply([]))

      await service.listAllPeople(3)

      expect(mock.history[0].query).toMatchObject({ page: 3 })
    })
  })

  describe('listProjectPeople', () => {
    it('lists people for a specific project', async () => {
      mock.onGet(`${ API_BASE }/projects/123/people.json`).reply(
        paginatedReply([{ id: 1, name: 'Victor' }], { totalCount: 1 })
      )

      const result = await service.listProjectPeople('123')

      expect(result.items).toHaveLength(1)
    })

    it('throws when projectId is missing', async () => {
      await expect(service.listProjectPeople()).rejects.toThrow('Project is required')
    })
  })

  describe('getPerson', () => {
    it('fetches a single person by id', async () => {
      mock.onGet(`${ API_BASE }/people/1.json`).reply(apiReply({ id: 1, name: 'Victor' }))

      const result = await service.getPerson('1')

      expect(result).toEqual({ id: 1, name: 'Victor' })
    })

    it('throws when personId is missing', async () => {
      await expect(service.getPerson()).rejects.toThrow('Person is required')
    })
  })

  describe('getMyProfile', () => {
    it('fetches the connected user profile', async () => {
      mock.onGet(`${ API_BASE }/my/profile.json`).reply(apiReply({ id: 1, name: 'Victor' }))

      const result = await service.getMyProfile()

      expect(result).toEqual({ id: 1, name: 'Victor' })
    })
  })

  // ── Schedule ──

  describe('listScheduleEntries', () => {
    it('resolves schedule from dock and lists entries', async () => {
      mock.onGet(`${ API_BASE }/projects/123.json`).reply(apiReply(MOCK_PROJECT))
      mock.onGet(`${ API_BASE }/buckets/123/schedules/104/entries.json`).reply(
        paginatedReply([{ id: 800, summary: 'Sync' }], { totalCount: 1 })
      )

      const result = await service.listScheduleEntries('123')

      expect(result.items).toHaveLength(1)
    })

    it('throws when projectId is missing', async () => {
      await expect(service.listScheduleEntries()).rejects.toThrow('Project is required')
    })
  })

  describe('createScheduleEntry', () => {
    it('resolves schedule and sends POST with required fields', async () => {
      mock.onGet(`${ API_BASE }/projects/123.json`).reply(apiReply(MOCK_PROJECT))
      mock.onPost(`${ API_BASE }/buckets/123/schedules/104/entries.json`).reply(
        apiReply({ id: 801, summary: 'Meeting' })
      )

      const result = await service.createScheduleEntry('123', 'Meeting', '2026-08-01T15:00:00Z', '2026-08-01T16:00:00Z')

      expect(result).toEqual({ id: 801, summary: 'Meeting' })

      const postCall = mock.history.find(c => c.method === 'post')

      expect(postCall.body).toEqual({
        summary: 'Meeting',
        starts_at: '2026-08-01T15:00:00Z',
        ends_at: '2026-08-01T16:00:00Z',
      })
    })

    it('sends all optional fields', async () => {
      mock.onGet(`${ API_BASE }/projects/123.json`).reply(apiReply(MOCK_PROJECT))
      mock.onPost(`${ API_BASE }/buckets/123/schedules/104/entries.json`).reply(apiReply({ id: 802 }))

      await service.createScheduleEntry(
        '123', 'All-day', '2026-08-01', '2026-08-01',
        '<p>Notes</p>', [1, 2], true, true
      )

      const postCall = mock.history.find(c => c.method === 'post')

      expect(postCall.body).toEqual({
        summary: 'All-day',
        starts_at: '2026-08-01',
        ends_at: '2026-08-01',
        description: '<p>Notes</p>',
        participant_ids: [1, 2],
        all_day: true,
        notify: true,
      })
    })

    it('throws when summary is missing', async () => {
      await expect(service.createScheduleEntry('123')).rejects.toThrow('Summary is required')
    })

    it('throws when startsAt is missing', async () => {
      await expect(service.createScheduleEntry('123', 'Event')).rejects.toThrow('Starts At is required')
    })

    it('throws when endsAt is missing', async () => {
      await expect(service.createScheduleEntry('123', 'Event', '2026-08-01')).rejects.toThrow('Ends At is required')
    })
  })

  // ── Documents ──

  describe('listDocuments', () => {
    it('resolves vault from dock and lists documents', async () => {
      mock.onGet(`${ API_BASE }/projects/123.json`).reply(apiReply(MOCK_PROJECT))
      mock.onGet(`${ API_BASE }/buckets/123/vaults/102/documents.json`).reply(
        paginatedReply([{ id: 900, title: 'Doc' }], { totalCount: 1 })
      )

      const result = await service.listDocuments('123')

      expect(result.items).toHaveLength(1)
    })

    it('throws when projectId is missing', async () => {
      await expect(service.listDocuments()).rejects.toThrow('Project is required')
    })
  })

  describe('getDocument', () => {
    it('fetches a single document by id', async () => {
      mock.onGet(`${ API_BASE }/buckets/123/documents/900.json`).reply(apiReply({ id: 900, title: 'Doc' }))

      const result = await service.getDocument('123', '900')

      expect(result).toEqual({ id: 900, title: 'Doc' })
    })

    it('throws when documentId is missing', async () => {
      await expect(service.getDocument('123')).rejects.toThrow('Document ID is required')
    })
  })

  describe('createDocument', () => {
    it('resolves vault and sends POST with title and content', async () => {
      mock.onGet(`${ API_BASE }/projects/123.json`).reply(apiReply(MOCK_PROJECT))
      mock.onPost(`${ API_BASE }/buckets/123/vaults/102/documents.json`).reply(
        apiReply({ id: 901, title: 'Retro' })
      )

      const result = await service.createDocument('123', 'Retro', '<div>Notes</div>')

      expect(result).toEqual({ id: 901, title: 'Retro' })

      const postCall = mock.history.find(c => c.method === 'post')

      expect(postCall.body).toEqual({ title: 'Retro', status: 'active', content: '<div>Notes</div>' })
    })

    it('omits content when not provided', async () => {
      mock.onGet(`${ API_BASE }/projects/123.json`).reply(apiReply(MOCK_PROJECT))
      mock.onPost(`${ API_BASE }/buckets/123/vaults/102/documents.json`).reply(apiReply({ id: 901 }))

      await service.createDocument('123', 'Retro')

      const postCall = mock.history.find(c => c.method === 'post')

      expect(postCall.body).toEqual({ title: 'Retro', status: 'active' })
    })

    it('throws when title is missing', async () => {
      await expect(service.createDocument('123')).rejects.toThrow('Title is required')
    })
  })

  describe('updateDocument', () => {
    it('fetches existing document then sends PUT with merged fields', async () => {
      mock.onGet(`${ API_BASE }/buckets/123/documents/900.json`).reply(
        apiReply({ title: 'Old Title', content: '<div>Old</div>' })
      )
      mock.onPut(`${ API_BASE }/buckets/123/documents/900.json`).reply(apiReply({ id: 900, title: 'New Title' }))

      const result = await service.updateDocument('123', '900', 'New Title')

      const putCall = mock.history.find(c => c.method === 'put')

      expect(putCall.body).toEqual({ title: 'New Title', content: '<div>Old</div>' })
      expect(result).toEqual({ id: 900, title: 'New Title' })
    })

    it('throws when documentId is missing', async () => {
      await expect(service.updateDocument('123')).rejects.toThrow('Document ID is required')
    })
  })

  // ── Dictionaries ──

  describe('getProjectsDictionary', () => {
    it('returns formatted dictionary items from projects', async () => {
      mock.onGet(`${ API_BASE }/projects.json`).reply(
        paginatedReply([
          { id: 1, name: 'Project A', description: 'Desc A' },
          { id: 2, name: 'Project B', description: '' },
        ])
      )

      const result = await service.getProjectsDictionary({})

      expect(result.items).toEqual([
        { label: 'Project A', value: '1', note: 'Desc A' },
        { label: 'Project B', value: '2', note: undefined },
      ])
      expect(result.cursor).toBeNull()
    })

    it('filters by search term', async () => {
      mock.onGet(`${ API_BASE }/projects.json`).reply(
        paginatedReply([
          { id: 1, name: 'Marketing', description: '' },
          { id: 2, name: 'Engineering', description: '' },
        ])
      )

      const result = await service.getProjectsDictionary({ search: 'market' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toBe('Marketing')
    })

    it('passes cursor as page number', async () => {
      mock.onGet(`${ API_BASE }/projects.json`).reply(paginatedReply([]))

      await service.getProjectsDictionary({ cursor: '3' })

      expect(mock.history[0].query).toMatchObject({ page: 3 })
    })

    it('returns next cursor from pagination', async () => {
      mock.onGet(`${ API_BASE }/projects.json`).reply(
        paginatedReply([], { nextPageUrl: `${ API_BASE }/projects.json?page=4` })
      )

      const result = await service.getProjectsDictionary({})

      expect(result.cursor).toBe('4')
    })
  })

  describe('getTodoListsDictionary', () => {
    it('returns empty items when no projectId criteria', async () => {
      const result = await service.getTodoListsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('returns formatted to-do list items', async () => {
      mock.onGet(`${ API_BASE }/projects/123.json`).reply(apiReply(MOCK_PROJECT))
      mock.onGet(`${ API_BASE }/buckets/123/todosets/100/todolists.json`).reply(
        paginatedReply([{ id: 200, name: 'Checklist', completed_ratio: '2/8' }])
      )

      const result = await service.getTodoListsDictionary({ criteria: { projectId: '123' } })

      expect(result.items).toEqual([
        { label: 'Checklist', value: '200', note: '2/8 completed' },
      ])
    })

    it('filters by search term', async () => {
      mock.onGet(`${ API_BASE }/projects/123.json`).reply(apiReply(MOCK_PROJECT))
      mock.onGet(`${ API_BASE }/buckets/123/todosets/100/todolists.json`).reply(
        paginatedReply([
          { id: 200, name: 'Launch', completed_ratio: '' },
          { id: 201, name: 'QA', completed_ratio: '' },
        ])
      )

      const result = await service.getTodoListsDictionary({ search: 'launch', criteria: { projectId: '123' } })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toBe('Launch')
    })
  })

  describe('getPeopleDictionary', () => {
    it('lists all people when no project criteria', async () => {
      mock.onGet(`${ API_BASE }/people.json`).reply(
        paginatedReply([{ id: 1, name: 'Victor', email_address: 'victor@example.com' }])
      )

      const result = await service.getPeopleDictionary({})

      expect(result.items).toEqual([
        { label: 'Victor', value: '1', note: 'victor@example.com' },
      ])
    })

    it('lists project people when project criteria is provided', async () => {
      mock.onGet(`${ API_BASE }/projects/123/people.json`).reply(
        paginatedReply([{ id: 2, name: 'Annie', email_address: 'annie@example.com' }])
      )

      const result = await service.getPeopleDictionary({ criteria: { projectId: '123' } })

      expect(result.items).toEqual([
        { label: 'Annie', value: '2', note: 'annie@example.com' },
      ])
    })

    it('filters by name or email', async () => {
      mock.onGet(`${ API_BASE }/people.json`).reply(
        paginatedReply([
          { id: 1, name: 'Victor Cooper', email_address: 'victor@example.com' },
          { id: 2, name: 'Annie Bryan', email_address: 'annie@example.com' },
        ])
      )

      const result = await service.getPeopleDictionary({ search: 'annie' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toBe('Annie Bryan')
    })

    it('matches search by email address', async () => {
      mock.onGet(`${ API_BASE }/people.json`).reply(
        paginatedReply([
          { id: 1, name: 'Victor Cooper', email_address: 'victor@example.com' },
        ])
      )

      const result = await service.getPeopleDictionary({ search: 'victor@' })

      expect(result.items).toHaveLength(1)
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('throws with a hint for known status codes', async () => {
      mock.onGet(`${ API_BASE }/projects/999.json`).replyWithError({
        message: 'Not Found',
        body: { error: 'Project not found' },
        status: 404,
      })

      await expect(service.getProject('999')).rejects.toThrow('Not found')
    })

    it('throws the API message for unknown status codes', async () => {
      mock.onGet(`${ API_BASE }/projects/999.json`).replyWithError({
        message: 'Something went wrong',
        body: { error: 'Server error' },
        status: 500,
      })

      await expect(service.getProject('999')).rejects.toThrow('Server error')
    })

    it('throws when access token is not set', async () => {
      const originalRequest = service.request
      service.request = { headers: {} }

      await expect(service.getMyProfile()).rejects.toThrow('Access token is not available')

      service.request = originalRequest
    })

    it('throws when composite token has no account id', async () => {
      const originalRequest = service.request
      service.request = { headers: { 'oauth-access-token': 'token-without-account' } }

      await expect(service.getMyProfile()).rejects.toThrow('account id is unavailable')

      service.request = originalRequest
    })
  })

  // ── Dock tool resolution errors ──

  describe('dock tool resolution', () => {
    it('throws when the dock tool is not found', async () => {
      mock.onGet(`${ API_BASE }/projects/123.json`).reply(apiReply({ id: 123, dock: [] }))

      await expect(service.getTodoset('123')).rejects.toThrow('does not have a "todoset" tool')
    })

    it('throws when the dock tool is disabled', async () => {
      mock.onGet(`${ API_BASE }/projects/123.json`).reply(apiReply({
        id: 123,
        dock: [{ id: 100, name: 'todoset', title: 'To-dos', enabled: false }],
      }))

      await expect(service.getTodoset('123')).rejects.toThrow('"To-dos" tool is disabled')
    })
  })
})
