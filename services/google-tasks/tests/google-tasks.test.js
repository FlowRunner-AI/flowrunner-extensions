'use strict'

const { createSandbox } = require('../../../service-sandbox')

const CLIENT_ID = 'test-client-id'
const CLIENT_SECRET = 'test-client-secret'
const ACCESS_TOKEN = 'test-access-token'
const REFRESH_TOKEN = 'test-refresh-token'

const API_BASE = 'https://tasks.googleapis.com/tasks/v1'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const OAUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const USER_INFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo'

const TASK_LIST_ID = 'MTIzNDU2Nzg5MDEyMzQ1Njc4OTA'
const TASK_ID = 'YWJjZGVmZ2hpamtsbW5vcA'

describe('Google Tasks Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET })
    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()

    // Simulate OAuth access token header
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
        ])
      )
    })
  })

  // ── OAuth ──

  describe('getOAuth2ConnectionURL', () => {
    it('returns a correctly constructed OAuth URL', async () => {
      const url = await service.getOAuth2ConnectionURL()

      expect(url).toContain(OAUTH_URL)
      expect(url).toContain(`client_id=${ encodeURIComponent(CLIENT_ID) }`)
      expect(url).toContain('response_type=code')
      expect(url).toContain('access_type=offline')
      expect(url).toContain('prompt=consent')
      expect(url).toContain(encodeURIComponent('https://www.googleapis.com/auth/tasks'))
    })
  })

  describe('executeCallback', () => {
    it('exchanges code for tokens and fetches user info', async () => {
      const tokenResponse = {
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        expires_in: 3600,
      }

      const userInfo = {
        name: 'Test User',
        email: 'test@example.com',
        picture: 'https://example.com/photo.jpg',
      }

      mock.onPost(TOKEN_URL).reply(tokenResponse)
      mock.onGet(USER_INFO_URL).reply(userInfo)

      const result = await service.executeCallback({
        code: 'auth-code',
        redirectURI: 'https://example.com/callback',
      })

      expect(result).toEqual({
        token: 'new-access-token',
        refreshToken: 'new-refresh-token',
        expirationInSeconds: 3600,
        connectionIdentityName: 'Test User (test@example.com)',
        connectionIdentityImageURL: 'https://example.com/photo.jpg',
        overwrite: true,
        userData: userInfo,
      })

      // Verify token exchange request
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(TOKEN_URL)
    })

    it('uses email as identity name when name is missing', async () => {
      mock.onPost(TOKEN_URL).reply({ access_token: 'at', expires_in: 3600 })
      mock.onGet(USER_INFO_URL).reply({ email: 'user@example.com' })

      const result = await service.executeCallback({ code: 'c', redirectURI: 'https://r' })

      expect(result.connectionIdentityName).toBe('user@example.com')
    })

    it('uses default identity name when user info fetch fails', async () => {
      mock.onPost(TOKEN_URL).reply({ access_token: 'at', expires_in: 3600 })
      mock.onGet(USER_INFO_URL).replyWithError({ message: 'Forbidden' })

      const result = await service.executeCallback({ code: 'c', redirectURI: 'https://r' })

      expect(result.connectionIdentityName).toBe('Google Tasks Account')
      expect(result.connectionIdentityImageURL).toBeNull()
    })
  })

  describe('refreshToken', () => {
    it('refreshes token successfully', async () => {
      mock.onPost(TOKEN_URL).reply({ access_token: 'refreshed-token', expires_in: 3600 })

      const result = await service.refreshToken(REFRESH_TOKEN)

      expect(result).toEqual({
        token: 'refreshed-token',
        expirationInSeconds: 3600,
      })

      expect(mock.history[0].query).toMatchObject({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: 'refresh_token',
        refresh_token: REFRESH_TOKEN,
      })
    })

    it('throws specific error on invalid_grant', async () => {
      mock.onPost(TOKEN_URL).replyWithError({
        message: 'Bad Request',
        body: { error: 'invalid_grant' },
      })

      await expect(service.refreshToken(REFRESH_TOKEN)).rejects.toThrow(
        'Refresh token expired or invalid, please re-authenticate.'
      )
    })

    it('rethrows other errors', async () => {
      mock.onPost(TOKEN_URL).replyWithError({ message: 'Server Error' })

      await expect(service.refreshToken(REFRESH_TOKEN)).rejects.toThrow()
    })
  })

  // ── Dictionaries ──

  describe('getTaskListsDictionary', () => {
    const LISTS_URL = `${API_BASE}/users/@me/lists`

    it('returns formatted dictionary items', async () => {
      mock.onGet(LISTS_URL).reply({
        items: [
          { id: 'list1', title: 'My Tasks', updated: '2026-07-10T10:00:00Z' },
          { id: 'list2', title: 'Work', updated: '2026-07-11T10:00:00Z' },
        ],
        nextPageToken: 'token123',
      })

      const result = await service.getTaskListsDictionary({})

      expect(result.cursor).toBe('token123')
      expect(result.items).toEqual([
        { label: 'My Tasks', value: 'list1', note: 'Updated 2026-07-10' },
        { label: 'Work', value: 'list2', note: 'Updated 2026-07-11' },
      ])
    })

    it('filters by search string', async () => {
      mock.onGet(LISTS_URL).reply({
        items: [
          { id: 'list1', title: 'My Tasks', updated: '2026-07-10T10:00:00Z' },
          { id: 'list2', title: 'Work', updated: '2026-07-11T10:00:00Z' },
        ],
      })

      const result = await service.getTaskListsDictionary({ search: 'work' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toBe('Work')
    })

    it('passes cursor as pageToken query param', async () => {
      mock.onGet(LISTS_URL).reply({ items: [] })

      await service.getTaskListsDictionary({ cursor: 'page2' })

      expect(mock.history[0].query).toMatchObject({ pageToken: 'page2' })
    })

    it('handles empty items', async () => {
      mock.onGet(LISTS_URL).reply({})

      const result = await service.getTaskListsDictionary({})

      expect(result.items).toEqual([])
      expect(result.cursor).toBeUndefined()
    })

    it('handles undefined payload', async () => {
      mock.onGet(LISTS_URL).reply({ items: [] })

      const result = await service.getTaskListsDictionary()

      expect(result.items).toEqual([])
    })
  })

  // ── Task Lists ──

  describe('createTaskList', () => {
    const LISTS_URL = `${API_BASE}/users/@me/lists`

    it('sends POST with title', async () => {
      const response = { kind: 'tasks#taskList', id: TASK_LIST_ID, title: 'Groceries' }
      mock.onPost(LISTS_URL).reply(response)

      const result = await service.createTaskList('Groceries')

      expect(result).toEqual(response)
      expect(mock.history[0].body).toEqual({ title: 'Groceries' })
      expect(mock.history[0].headers).toMatchObject({ Authorization: `Bearer ${ACCESS_TOKEN}` })
    })

    it('throws when title is missing', async () => {
      await expect(service.createTaskList()).rejects.toThrow('"Title" is required')
    })

    it('throws when title is empty string', async () => {
      await expect(service.createTaskList('')).rejects.toThrow('"Title" is required')
    })
  })

  describe('listTaskLists', () => {
    const LISTS_URL = `${API_BASE}/users/@me/lists`

    it('sends GET with default parameters', async () => {
      const response = { kind: 'tasks#taskLists', items: [] }
      mock.onGet(LISTS_URL).reply(response)

      const result = await service.listTaskLists()

      expect(result).toEqual(response)
      expect(mock.history[0].method).toBe('get')
    })

    it('passes maxResults and pageToken', async () => {
      mock.onGet(LISTS_URL).reply({ kind: 'tasks#taskLists', items: [] })

      await service.listTaskLists(10, 'nextPage')

      expect(mock.history[0].query).toMatchObject({ maxResults: 10, pageToken: 'nextPage' })
    })
  })

  describe('updateTaskList', () => {
    const url = `${API_BASE}/users/@me/lists/${TASK_LIST_ID}`

    it('sends PATCH with new title', async () => {
      const response = { kind: 'tasks#taskList', id: TASK_LIST_ID, title: 'New Title' }
      mock.onPatch(url).reply(response)

      const result = await service.updateTaskList(TASK_LIST_ID, 'New Title')

      expect(result).toEqual(response)
      expect(mock.history[0].body).toEqual({ title: 'New Title' })
    })

    it('throws when task list is missing', async () => {
      await expect(service.updateTaskList(null, 'Title')).rejects.toThrow('"Task List" is required')
    })

    it('throws when title is missing', async () => {
      await expect(service.updateTaskList(TASK_LIST_ID, '')).rejects.toThrow('"Title" is required')
    })
  })

  describe('deleteTaskList', () => {
    const url = `${API_BASE}/users/@me/lists/${TASK_LIST_ID}`

    it('sends DELETE and returns success object', async () => {
      mock.onDelete(url).reply('')

      const result = await service.deleteTaskList(TASK_LIST_ID)

      expect(result).toEqual({
        success: true,
        message: 'Task list deleted successfully',
        taskListId: TASK_LIST_ID,
      })
    })

    it('throws when task list is missing', async () => {
      await expect(service.deleteTaskList()).rejects.toThrow('"Task List" is required')
    })
  })

  // ── Tasks ──

  describe('createTask', () => {
    const url = `${API_BASE}/lists/${TASK_LIST_ID}/tasks`

    it('sends POST with required fields only', async () => {
      const response = { kind: 'tasks#task', id: TASK_ID, title: 'Buy milk' }
      mock.onPost(url).reply(response)

      const result = await service.createTask(TASK_LIST_ID, 'Buy milk')

      expect(result).toEqual(response)
      expect(mock.history[0].body).toEqual({ title: 'Buy milk' })
    })

    it('includes optional fields when provided', async () => {
      mock.onPost(url).reply({ kind: 'tasks#task', id: TASK_ID })

      await service.createTask(TASK_LIST_ID, 'Task', 'Some notes', '2026-07-20', 'parentId', 'prevId')

      expect(mock.history[0].body).toEqual({
        title: 'Task',
        notes: 'Some notes',
        due: '2026-07-20T00:00:00.000Z',
      })

      expect(mock.history[0].query).toMatchObject({
        parent: 'parentId',
        previous: 'prevId',
      })
    })

    it('normalizes epoch timestamp for due date', async () => {
      mock.onPost(url).reply({ kind: 'tasks#task', id: TASK_ID })

      const epochMs = new Date('2026-07-20T00:00:00Z').getTime()
      await service.createTask(TASK_LIST_ID, 'Task', undefined, epochMs)

      expect(mock.history[0].body.due).toBe('2026-07-20T00:00:00.000Z')
    })

    it('throws on invalid due date', async () => {
      await expect(
        service.createTask(TASK_LIST_ID, 'Task', undefined, 'not-a-date')
      ).rejects.toThrow('"Due Date" must be a valid date')
    })

    it('throws when task list is missing', async () => {
      await expect(service.createTask('', 'Title')).rejects.toThrow('"Task List" is required')
    })

    it('throws when title is missing', async () => {
      await expect(service.createTask(TASK_LIST_ID)).rejects.toThrow('"Title" is required')
    })
  })

  describe('getTask', () => {
    const url = `${API_BASE}/lists/${TASK_LIST_ID}/tasks/${TASK_ID}`

    it('sends GET with correct URL', async () => {
      const response = { kind: 'tasks#task', id: TASK_ID, title: 'Buy milk' }
      mock.onGet(url).reply(response)

      const result = await service.getTask(TASK_LIST_ID, TASK_ID)

      expect(result).toEqual(response)
      expect(mock.history[0].headers).toMatchObject({ Authorization: `Bearer ${ACCESS_TOKEN}` })
    })

    it('throws when task list is missing', async () => {
      await expect(service.getTask(null, TASK_ID)).rejects.toThrow('"Task List" is required')
    })

    it('throws when task ID is missing', async () => {
      await expect(service.getTask(TASK_LIST_ID, '')).rejects.toThrow('"Task ID" is required')
    })
  })

  describe('listTasks', () => {
    const url = `${API_BASE}/lists/${TASK_LIST_ID}/tasks`

    it('sends GET with required param only', async () => {
      const response = { kind: 'tasks#tasks', items: [] }
      mock.onGet(url).reply(response)

      const result = await service.listTasks(TASK_LIST_ID)

      expect(result).toEqual(response)
      expect(mock.history[0].method).toBe('get')
    })

    it('passes all optional query parameters', async () => {
      mock.onGet(url).reply({ kind: 'tasks#tasks', items: [] })

      await service.listTasks(
        TASK_LIST_ID,
        true,              // showCompleted
        false,             // showHidden
        '2026-07-01',      // dueMin
        '2026-07-31',      // dueMax
        '2026-07-01T00:00:00Z', // completedMin
        '2026-07-31T23:59:59Z', // completedMax
        50,                // maxResults
        'pageToken123'     // pageToken
      )

      expect(mock.history[0].query).toMatchObject({
        showCompleted: true,
        showHidden: false,
        dueMin: '2026-07-01T00:00:00.000Z',
        dueMax: '2026-07-31T00:00:00.000Z',
        completedMin: '2026-07-01T00:00:00.000Z',
        completedMax: '2026-07-31T23:59:59.000Z',
        maxResults: 50,
        pageToken: 'pageToken123',
      })
    })

    it('throws when task list is missing', async () => {
      await expect(service.listTasks()).rejects.toThrow('"Task List" is required')
    })
  })

  describe('updateTask', () => {
    const url = `${API_BASE}/lists/${TASK_LIST_ID}/tasks/${TASK_ID}`

    it('sends PATCH with title only', async () => {
      const response = { kind: 'tasks#task', id: TASK_ID, title: 'Updated Title' }
      mock.onPatch(url).reply(response)

      const result = await service.updateTask(TASK_LIST_ID, TASK_ID, 'Updated Title')

      expect(result).toEqual(response)
      expect(mock.history[0].body).toEqual({ title: 'Updated Title' })
    })

    it('sends PATCH with all fields', async () => {
      mock.onPatch(url).reply({ kind: 'tasks#task', id: TASK_ID })

      await service.updateTask(TASK_LIST_ID, TASK_ID, 'Title', 'Notes', '2026-08-01', 'Completed')

      expect(mock.history[0].body).toEqual({
        title: 'Title',
        notes: 'Notes',
        due: '2026-08-01T00:00:00.000Z',
        status: 'completed',
      })
    })

    it('resolves "Needs Action" status and clears completed field', async () => {
      mock.onPatch(url).reply({ kind: 'tasks#task', id: TASK_ID })

      await service.updateTask(TASK_LIST_ID, TASK_ID, 'Title', undefined, undefined, 'Needs Action')

      expect(mock.history[0].body).toEqual({
        title: 'Title',
        status: 'needsAction',
        completed: null,
      })
    })

    it('throws when no update fields are provided', async () => {
      await expect(
        service.updateTask(TASK_LIST_ID, TASK_ID)
      ).rejects.toThrow('At least one of "Title", "Notes", "Due Date" or "Status" must be provided')
    })

    it('throws when task list is missing', async () => {
      await expect(service.updateTask('', TASK_ID, 'T')).rejects.toThrow('"Task List" is required')
    })

    it('throws when task ID is missing', async () => {
      await expect(service.updateTask(TASK_LIST_ID, null, 'T')).rejects.toThrow('"Task ID" is required')
    })
  })

  describe('completeTask', () => {
    const url = `${API_BASE}/lists/${TASK_LIST_ID}/tasks/${TASK_ID}`

    it('sends PATCH with status completed', async () => {
      const response = { kind: 'tasks#task', id: TASK_ID, status: 'completed' }
      mock.onPatch(url).reply(response)

      const result = await service.completeTask(TASK_LIST_ID, TASK_ID)

      expect(result).toEqual(response)
      expect(mock.history[0].body).toEqual({ status: 'completed' })
    })

    it('throws when task list is missing', async () => {
      await expect(service.completeTask(null, TASK_ID)).rejects.toThrow('"Task List" is required')
    })

    it('throws when task ID is missing', async () => {
      await expect(service.completeTask(TASK_LIST_ID)).rejects.toThrow('"Task ID" is required')
    })
  })

  describe('reopenTask', () => {
    const url = `${API_BASE}/lists/${TASK_LIST_ID}/tasks/${TASK_ID}`

    it('sends PATCH with needsAction status and null completed', async () => {
      const response = { kind: 'tasks#task', id: TASK_ID, status: 'needsAction' }
      mock.onPatch(url).reply(response)

      const result = await service.reopenTask(TASK_LIST_ID, TASK_ID)

      expect(result).toEqual(response)
      expect(mock.history[0].body).toEqual({ status: 'needsAction', completed: null })
    })

    it('throws when task list is missing', async () => {
      await expect(service.reopenTask('', TASK_ID)).rejects.toThrow('"Task List" is required')
    })
  })

  describe('deleteTask', () => {
    const url = `${API_BASE}/lists/${TASK_LIST_ID}/tasks/${TASK_ID}`

    it('sends DELETE and returns success object', async () => {
      mock.onDelete(url).reply('')

      const result = await service.deleteTask(TASK_LIST_ID, TASK_ID)

      expect(result).toEqual({
        success: true,
        message: 'Task deleted successfully',
        taskId: TASK_ID,
        taskListId: TASK_LIST_ID,
      })
    })

    it('throws when task list is missing', async () => {
      await expect(service.deleteTask(null, TASK_ID)).rejects.toThrow('"Task List" is required')
    })

    it('throws when task ID is missing', async () => {
      await expect(service.deleteTask(TASK_LIST_ID)).rejects.toThrow('"Task ID" is required')
    })
  })

  describe('moveTask', () => {
    const url = `${API_BASE}/lists/${TASK_LIST_ID}/tasks/${TASK_ID}/move`

    it('sends POST with no optional params', async () => {
      const response = { kind: 'tasks#task', id: TASK_ID }
      mock.onPost(url).reply(response)

      const result = await service.moveTask(TASK_LIST_ID, TASK_ID)

      expect(result).toEqual(response)
      expect(mock.history[0].method).toBe('post')
    })

    it('passes parent, previous, and destinationTasklist as query params', async () => {
      mock.onPost(url).reply({ kind: 'tasks#task', id: TASK_ID })

      await service.moveTask(TASK_LIST_ID, TASK_ID, 'parentId', 'prevId', 'destListId')

      expect(mock.history[0].query).toMatchObject({
        parent: 'parentId',
        previous: 'prevId',
        destinationTasklist: 'destListId',
      })
    })

    it('throws when task list is missing', async () => {
      await expect(service.moveTask('', TASK_ID)).rejects.toThrow('"Task List" is required')
    })

    it('throws when task ID is missing', async () => {
      await expect(service.moveTask(TASK_LIST_ID, null)).rejects.toThrow('"Task ID" is required')
    })
  })

  describe('clearCompletedTasks', () => {
    const url = `${API_BASE}/lists/${TASK_LIST_ID}/clear`

    it('sends POST and returns success object', async () => {
      mock.onPost(url).reply('')

      const result = await service.clearCompletedTasks(TASK_LIST_ID)

      expect(result).toEqual({
        success: true,
        message: 'Completed tasks cleared successfully',
        taskListId: TASK_LIST_ID,
      })
    })

    it('throws when task list is missing', async () => {
      await expect(service.clearCompletedTasks()).rejects.toThrow('"Task List" is required')
    })
  })

  // ── Error Handling ──

  describe('API error handling', () => {
    it('wraps API errors with descriptive message', async () => {
      mock.onGet(`${API_BASE}/users/@me/lists`).replyWithError({
        message: 'Not Found',
        body: { error: { message: 'Task list not found' } },
      })

      await expect(service.listTaskLists()).rejects.toThrow('Google Tasks API error: Task list not found')
    })

    it('falls back to error.message when body is missing', async () => {
      mock.onGet(`${API_BASE}/users/@me/lists`).replyWithError({
        message: 'Network Error',
      })

      await expect(service.listTaskLists()).rejects.toThrow('Google Tasks API error: Network Error')
    })
  })
})
