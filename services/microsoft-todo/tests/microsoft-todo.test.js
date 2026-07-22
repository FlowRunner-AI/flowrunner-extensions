'use strict'

const { createSandbox } = require('../../../service-sandbox')

const CLIENT_ID = 'test-client-id'
const CLIENT_SECRET = 'test-client-secret'
const ACCESS_TOKEN = 'test-access-token'

const OAUTH_BASE = 'https://login.microsoftonline.com/common/oauth2/v2.0'
const API_BASE = 'https://graph.microsoft.com/v1.0'
const TODO_BASE = `${API_BASE}/me/todo`

const LIST_ID = 'list-123'
const TASK_ID = 'task-456'
const ITEM_ID = 'item-789'

describe('Microsoft To Do Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
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
        ])
      )
    })

    it('stores credentials and default scopes', () => {
      expect(service.clientId).toBe(CLIENT_ID)
      expect(service.clientSecret).toBe(CLIENT_SECRET)
      expect(service.scopes).toBe('offline_access User.Read Tasks.ReadWrite')
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
      expect(url).toContain('scope=offline_access+User.Read+Tasks.ReadWrite')
    })
  })

  describe('executeCallback', () => {
    it('exchanges the code for tokens and fetches the user profile', async () => {
      const userData = {
        displayName: 'John Doe',
        mail: 'john@test.com',
        userPrincipalName: 'john@test.onmicrosoft.com',
      }

      mock.onPost(`${OAUTH_BASE}/token`).reply({
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        expires_in: 3600,
      })
      mock.onGet(`${API_BASE}/me`).reply(userData)

      const result = await service.executeCallback({
        code: 'auth-code-123',
        redirectURI: 'https://redirect.example.com/callback',
      })

      expect(result).toEqual({
        token: 'new-access-token',
        refreshToken: 'new-refresh-token',
        expirationInSeconds: 3600,
        connectionIdentityName: 'john@test.com (John Doe)',
        overwrite: true,
        userData,
      })

      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${OAUTH_BASE}/token`)
      expect(mock.history[0].headers).toMatchObject({
        'Content-Type': 'application/x-www-form-urlencoded',
      })
      expect(mock.history[0].body).toContain('grant_type=authorization_code')
      expect(mock.history[0].body).toContain('code=auth-code-123')
      expect(mock.history[0].body).toContain(`client_id=${CLIENT_ID}`)
      expect(mock.history[0].body).toContain(`client_secret=${CLIENT_SECRET}`)
      expect(mock.history[0].body).toContain(
        `redirect_uri=${encodeURIComponent('https://redirect.example.com/callback')}`
      )

      expect(mock.history[1].url).toBe(`${API_BASE}/me`)
      expect(mock.history[1].headers).toMatchObject({
        Authorization: 'Bearer new-access-token',
      })
    })

    it('falls back to userPrincipalName when mail is missing', async () => {
      mock.onPost(`${OAUTH_BASE}/token`).reply({
        access_token: 'token',
        refresh_token: 'refresh',
        expires_in: 3600,
      })
      mock.onGet(`${API_BASE}/me`).reply({ userPrincipalName: 'jane@test.com' })

      const result = await service.executeCallback({ code: 'c', redirectURI: 'https://r' })

      expect(result.connectionIdentityName).toBe('jane@test.com')
    })

    it('uses displayName only when no email is present', async () => {
      mock.onPost(`${OAUTH_BASE}/token`).reply({
        access_token: 'token',
        refresh_token: 'refresh',
        expires_in: 3600,
      })
      mock.onGet(`${API_BASE}/me`).reply({ displayName: 'Jane Doe' })

      const result = await service.executeCallback({ code: 'c', redirectURI: 'https://r' })

      expect(result.connectionIdentityName).toBe('Jane Doe')
    })

    it('falls back to a default identity name when the profile lookup fails', async () => {
      mock.onPost(`${OAUTH_BASE}/token`).reply({
        access_token: 'token',
        refresh_token: 'refresh',
        expires_in: 3600,
      })
      mock.onGet(`${API_BASE}/me`).replyWithError({ message: 'Forbidden' })

      const result = await service.executeCallback({ code: 'c', redirectURI: 'https://r' })

      expect(result.connectionIdentityName).toBe('Microsoft To Do Connection')
      expect(result.userData).toEqual({})
    })

    it('propagates token exchange errors', async () => {
      mock.onPost(`${OAUTH_BASE}/token`).replyWithError({ message: 'invalid_grant' })

      await expect(
        service.executeCallback({ code: 'bad', redirectURI: 'https://r' })
      ).rejects.toThrow('invalid_grant')
    })
  })

  describe('refreshToken', () => {
    it('sends the refresh request and returns new tokens', async () => {
      mock.onPost(`${OAUTH_BASE}/token`).reply({
        access_token: 'refreshed-token',
        refresh_token: 'refreshed-refresh-token',
        expires_in: 7200,
      })

      const result = await service.refreshToken('old-refresh-token')

      expect(result).toEqual({
        token: 'refreshed-token',
        refreshToken: 'refreshed-refresh-token',
        expirationInSeconds: 7200,
      })

      expect(mock.history[0].body).toContain('grant_type=refresh_token')
      expect(mock.history[0].body).toContain('refresh_token=old-refresh-token')
      expect(mock.history[0].body).toContain(`client_id=${CLIENT_ID}`)
      expect(mock.history[0].body).toContain(`client_secret=${CLIENT_SECRET}`)
    })

    it('throws when the refresh fails', async () => {
      mock.onPost(`${OAUTH_BASE}/token`).replyWithError({ message: 'invalid_grant' })

      await expect(service.refreshToken('bad-token')).rejects.toThrow('invalid_grant')
    })
  })

  // ── Dictionaries ──

  describe('getTaskListsDictionary', () => {
    it('returns mapped task lists with default paging', async () => {
      mock.onGet(`${TODO_BASE}/lists`).reply({
        value: [
          { id: 'l1', displayName: 'Tasks', wellknownListName: 'defaultList' },
          { id: 'l2', displayName: 'Groceries', wellknownListName: 'none' },
        ],
      })

      const result = await service.getTaskListsDictionary({})

      expect(result).toEqual({
        cursor: null,
        items: [
          { label: 'Tasks', note: 'Default list', value: 'l1' },
          { label: 'Groceries', note: 'ID: l2', value: 'l2' },
        ],
      })

      expect(mock.history[0].query).toEqual({ $top: 20 })
      expect(mock.history[0].headers).toMatchObject({
        Authorization: `Bearer ${ACCESS_TOKEN}`,
      })
    })

    it('handles a null payload', async () => {
      mock.onGet(`${TODO_BASE}/lists`).reply({ value: [{ id: 'l1', displayName: 'Tasks' }] })

      const result = await service.getTaskListsDictionary(null)

      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toEqual({ label: 'Tasks', note: 'ID: l1', value: 'l1' })
    })

    it('filters case-insensitively by search', async () => {
      mock.onGet(`${TODO_BASE}/lists`).reply({
        value: [
          { id: 'l1', displayName: 'Tasks' },
          { id: 'l2', displayName: 'Groceries' },
        ],
      })

      const result = await service.getTaskListsDictionary({ search: 'GROC' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('l2')
    })

    it('uses the cursor as the request URL and returns the next link', async () => {
      const cursor = `${TODO_BASE}/lists?$skiptoken=abc`

      mock.onGet(cursor).reply({
        value: [],
        '@odata.nextLink': `${TODO_BASE}/lists?$skiptoken=def`,
      })

      const result = await service.getTaskListsDictionary({ cursor })

      expect(result.cursor).toBe(`${TODO_BASE}/lists?$skiptoken=def`)
      expect(mock.history[0].url).toBe(cursor)
      expect(mock.history[0].query).toEqual({})
    })

    it('handles a missing value array', async () => {
      mock.onGet(`${TODO_BASE}/lists`).reply({})

      const result = await service.getTaskListsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${TODO_BASE}/lists`).replyWithError({
        message: 'Unauthorized',
        body: { error: { message: 'Access token expired' } },
      })

      await expect(service.getTaskListsDictionary({})).rejects.toThrow(
        'Microsoft To Do API error: Access token expired'
      )
    })
  })

  describe('getTasksDictionary', () => {
    it('returns an empty result when no task list is selected', async () => {
      const result = await service.getTasksDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
      expect(mock.history).toHaveLength(0)
    })

    it('returns an empty result for a null payload', async () => {
      const result = await service.getTasksDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
      expect(mock.history).toHaveLength(0)
    })

    it('returns mapped tasks for the given task list', async () => {
      mock.onGet(`${TODO_BASE}/lists/${LIST_ID}/tasks`).reply({
        value: [
          { id: 't1', title: 'Alpha', status: 'notStarted' },
          { id: 't2', title: 'Beta', status: 'completed' },
        ],
      })

      const result = await service.getTasksDictionary({ criteria: { taskListId: LIST_ID } })

      expect(result).toEqual({
        cursor: null,
        items: [
          { label: 'Alpha', note: 'Status: notStarted', value: 't1' },
          { label: 'Beta', note: 'Status: completed', value: 't2' },
        ],
      })

      expect(mock.history[0].query).toEqual({ $top: 20 })
    })

    it('filters tasks by search', async () => {
      mock.onGet(`${TODO_BASE}/lists/${LIST_ID}/tasks`).reply({
        value: [
          { id: 't1', title: 'Alpha', status: 'notStarted' },
          { id: 't2', title: 'Beta', status: 'notStarted' },
        ],
      })

      const result = await service.getTasksDictionary({
        search: 'bet',
        criteria: { taskListId: LIST_ID },
      })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('t2')
    })

    it('uses the cursor URL and returns the next link', async () => {
      const cursor = `${TODO_BASE}/lists/${LIST_ID}/tasks?$skip=20`

      mock.onGet(cursor).reply({
        value: [],
        '@odata.nextLink': `${TODO_BASE}/lists/${LIST_ID}/tasks?$skip=40`,
      })

      const result = await service.getTasksDictionary({
        cursor,
        criteria: { taskListId: LIST_ID },
      })

      expect(result.cursor).toBe(`${TODO_BASE}/lists/${LIST_ID}/tasks?$skip=40`)
      expect(mock.history[0].url).toBe(cursor)
    })

    it('handles a missing value array', async () => {
      mock.onGet(`${TODO_BASE}/lists/${LIST_ID}/tasks`).reply({})

      const result = await service.getTasksDictionary({ criteria: { taskListId: LIST_ID } })

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${TODO_BASE}/lists/${LIST_ID}/tasks`).replyWithError({ message: 'Network down' })

      await expect(
        service.getTasksDictionary({ criteria: { taskListId: LIST_ID } })
      ).rejects.toThrow('Microsoft To Do API error: Network down')
    })
  })

  // ── Task lists ──

  describe('createTaskList', () => {
    it('sends a POST with the display name', async () => {
      mock.onPost(`${TODO_BASE}/lists`).reply({ id: 'l1', displayName: 'Groceries' })

      const result = await service.createTaskList('Groceries')

      expect(result).toEqual({ id: 'l1', displayName: 'Groceries' })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${TODO_BASE}/lists`)
      expect(mock.history[0].body).toEqual({ displayName: 'Groceries' })
    })

    it('throws when the display name is missing', async () => {
      await expect(service.createTaskList()).rejects.toThrow('Parameter "List Name" is required')
      expect(mock.history).toHaveLength(0)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${TODO_BASE}/lists`).replyWithError({
        message: 'Bad Request',
        body: { error: { message: 'A list with this name already exists' } },
      })

      await expect(service.createTaskList('Groceries')).rejects.toThrow(
        'Microsoft To Do API error: A list with this name already exists'
      )
    })
  })

  describe('listTaskLists', () => {
    it('sends a GET with $top when provided', async () => {
      mock.onGet(`${TODO_BASE}/lists`).reply({ value: [] })

      await service.listTaskLists(5)

      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${TODO_BASE}/lists`)
      expect(mock.history[0].query).toEqual({ $top: 5 })
    })

    it('omits $top when not provided', async () => {
      mock.onGet(`${TODO_BASE}/lists`).reply({ value: [] })

      await service.listTaskLists()

      expect(mock.history[0].query).toEqual({})
    })

    it('uses nextLink and ignores other parameters', async () => {
      const nextLink = `${TODO_BASE}/lists?$skiptoken=abc`

      mock.onGet(nextLink).reply({ value: [{ id: 'l1' }] })

      const result = await service.listTaskLists(5, nextLink)

      expect(result).toEqual({ value: [{ id: 'l1' }] })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].url).toBe(nextLink)
      expect(mock.history[0].query).toEqual({})
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${TODO_BASE}/lists`).replyWithError({ message: 'Service unavailable' })

      await expect(service.listTaskLists()).rejects.toThrow(
        'Microsoft To Do API error: Service unavailable'
      )
    })
  })

  describe('updateTaskList', () => {
    it('sends a PATCH with the new display name', async () => {
      mock.onPatch(`${TODO_BASE}/lists/${LIST_ID}`).reply({ id: LIST_ID, displayName: 'Renamed' })

      const result = await service.updateTaskList(LIST_ID, 'Renamed')

      expect(result).toEqual({ id: LIST_ID, displayName: 'Renamed' })
      expect(mock.history[0].method).toBe('patch')
      expect(mock.history[0].body).toEqual({ displayName: 'Renamed' })
    })

    it('throws when the task list id is missing', async () => {
      await expect(service.updateTaskList(undefined, 'Renamed')).rejects.toThrow(
        'Parameter "Task List" is required'
      )
    })

    it('throws when the new name is missing', async () => {
      await expect(service.updateTaskList(LIST_ID)).rejects.toThrow(
        'Parameter "New List Name" is required'
      )
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPatch(`${TODO_BASE}/lists/${LIST_ID}`).replyWithError({
        body: { error: { message: 'Cannot rename a well-known list' } },
      })

      await expect(service.updateTaskList(LIST_ID, 'Renamed')).rejects.toThrow(
        'Microsoft To Do API error: Cannot rename a well-known list'
      )
    })
  })

  describe('deleteTaskList', () => {
    it('sends a DELETE and returns a confirmation message', async () => {
      mock.onDelete(`${TODO_BASE}/lists/${LIST_ID}`).reply('')

      const result = await service.deleteTaskList(LIST_ID)

      expect(result).toEqual({ message: 'Task list deleted successfully' })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${TODO_BASE}/lists/${LIST_ID}`)
    })

    it('throws when the task list id is missing', async () => {
      await expect(service.deleteTaskList()).rejects.toThrow('Parameter "Task List" is required')
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onDelete(`${TODO_BASE}/lists/${LIST_ID}`).replyWithError({ message: 'Not Found' })

      await expect(service.deleteTaskList(LIST_ID)).rejects.toThrow(
        'Microsoft To Do API error: Not Found'
      )
    })
  })

  // ── Tasks ──

  describe('createTask', () => {
    it('sends a POST with only the title when no optional fields are given', async () => {
      mock.onPost(`${TODO_BASE}/lists/${LIST_ID}/tasks`).reply({ id: 't1', title: 'Report' })

      const result = await service.createTask(LIST_ID, 'Report')

      expect(result).toEqual({ id: 't1', title: 'Report' })
      expect(mock.history[0].body).toEqual({ title: 'Report' })
    })

    it('builds the full body with all optional fields', async () => {
      mock.onPost(`${TODO_BASE}/lists/${LIST_ID}/tasks`).reply({ id: 't1' })

      const recurrence = {
        pattern: { type: 'daily', interval: 1 },
        range: { type: 'noEnd', startDate: '2026-07-14' },
      }

      await service.createTask(
        LIST_ID,
        'Report',
        'Include revenue',
        '2026-07-20',
        '2026-07-19T09:00:00',
        'Pacific Standard Time',
        'High',
        ['Work'],
        recurrence
      )

      expect(mock.history[0].body).toEqual({
        title: 'Report',
        body: { content: 'Include revenue', contentType: 'text' },
        dueDateTime: { dateTime: '2026-07-20T00:00:00', timeZone: 'Pacific Standard Time' },
        reminderDateTime: { dateTime: '2026-07-19T09:00:00', timeZone: 'Pacific Standard Time' },
        isReminderOn: true,
        importance: 'high',
        categories: ['Work'],
        recurrence,
      })
    })

    it('defaults the time zone to UTC and strips trailing offsets', async () => {
      mock.onPost(`${TODO_BASE}/lists/${LIST_ID}/tasks`).reply({ id: 't1' })

      await service.createTask(LIST_ID, 'Report', undefined, '2026-07-20T10:00:00Z')

      expect(mock.history[0].body.dueDateTime).toEqual({
        dateTime: '2026-07-20T10:00:00',
        timeZone: 'UTC',
      })
      expect(mock.history[0].body.isReminderOn).toBeUndefined()
    })

    it('passes through an unmapped importance value', async () => {
      mock.onPost(`${TODO_BASE}/lists/${LIST_ID}/tasks`).reply({ id: 't1' })

      await service.createTask(LIST_ID, 'Report', undefined, undefined, undefined, undefined, 'low')

      expect(mock.history[0].body.importance).toBe('low')
    })

    it('omits empty categories', async () => {
      mock.onPost(`${TODO_BASE}/lists/${LIST_ID}/tasks`).reply({ id: 't1' })

      await service.createTask(LIST_ID, 'Report', undefined, undefined, undefined, undefined, undefined, [])

      expect(mock.history[0].body).toEqual({ title: 'Report' })
    })

    it('throws when the task list id is missing', async () => {
      await expect(service.createTask(undefined, 'Report')).rejects.toThrow(
        'Parameter "Task List" is required'
      )
    })

    it('throws when the title is missing', async () => {
      await expect(service.createTask(LIST_ID)).rejects.toThrow('Parameter "Title" is required')
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${TODO_BASE}/lists/${LIST_ID}/tasks`).replyWithError({
        body: { error: { message: 'Invalid recurrence' } },
      })

      await expect(service.createTask(LIST_ID, 'Report')).rejects.toThrow(
        'Microsoft To Do API error: Invalid recurrence'
      )
    })
  })

  describe('getTask', () => {
    it('sends a GET for the task', async () => {
      mock.onGet(`${TODO_BASE}/lists/${LIST_ID}/tasks/${TASK_ID}`).reply({ id: TASK_ID })

      const result = await service.getTask(LIST_ID, TASK_ID)

      expect(result).toEqual({ id: TASK_ID })
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].query).toEqual({})
    })

    it('throws when the task list id is missing', async () => {
      await expect(service.getTask(undefined, TASK_ID)).rejects.toThrow(
        'Parameter "Task List" is required'
      )
    })

    it('throws when the task id is missing', async () => {
      await expect(service.getTask(LIST_ID)).rejects.toThrow('Parameter "Task" is required')
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${TODO_BASE}/lists/${LIST_ID}/tasks/${TASK_ID}`).replyWithError({
        message: 'Not Found',
      })

      await expect(service.getTask(LIST_ID, TASK_ID)).rejects.toThrow(
        'Microsoft To Do API error: Not Found'
      )
    })
  })

  describe('listTasks', () => {
    it('sends a GET with no filter for All status', async () => {
      mock.onGet(`${TODO_BASE}/lists/${LIST_ID}/tasks`).reply({ value: [] })

      await service.listTasks(LIST_ID, 'All')

      expect(mock.history[0].query).toEqual({})
    })

    it('applies the completed filter', async () => {
      mock.onGet(`${TODO_BASE}/lists/${LIST_ID}/tasks`).reply({ value: [] })

      await service.listTasks(LIST_ID, 'Completed', 10, 5)

      expect(mock.history[0].query).toEqual({
        $filter: "status eq 'completed'",
        $top: 10,
        $skip: 5,
      })
    })

    it('applies the not completed filter', async () => {
      mock.onGet(`${TODO_BASE}/lists/${LIST_ID}/tasks`).reply({ value: [] })

      await service.listTasks(LIST_ID, 'Not Completed')

      expect(mock.history[0].query).toEqual({ $filter: "status ne 'completed'" })
    })

    it('passes through a raw OData filter value', async () => {
      mock.onGet(`${TODO_BASE}/lists/${LIST_ID}/tasks`).reply({ value: [] })

      await service.listTasks(LIST_ID, "status eq 'inProgress'")

      expect(mock.history[0].query).toEqual({ $filter: "status eq 'inProgress'" })
    })

    it('omits the filter when status is not provided', async () => {
      mock.onGet(`${TODO_BASE}/lists/${LIST_ID}/tasks`).reply({ value: [] })

      await service.listTasks(LIST_ID)

      expect(mock.history[0].query).toEqual({})
    })

    it('uses nextLink and ignores other parameters', async () => {
      const nextLink = `${TODO_BASE}/lists/${LIST_ID}/tasks?$skip=10`

      mock.onGet(nextLink).reply({ value: [{ id: 't1' }] })

      const result = await service.listTasks(undefined, 'Completed', 10, 5, nextLink)

      expect(result).toEqual({ value: [{ id: 't1' }] })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].url).toBe(nextLink)
      expect(mock.history[0].query).toEqual({})
    })

    it('throws when the task list id is missing and no nextLink is given', async () => {
      await expect(service.listTasks()).rejects.toThrow('Parameter "Task List" is required')
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${TODO_BASE}/lists/${LIST_ID}/tasks`).replyWithError({ message: 'Throttled' })

      await expect(service.listTasks(LIST_ID)).rejects.toThrow(
        'Microsoft To Do API error: Throttled'
      )
    })
  })

  describe('updateTask', () => {
    it('sends a PATCH with only the provided fields', async () => {
      mock.onPatch(`${TODO_BASE}/lists/${LIST_ID}/tasks/${TASK_ID}`).reply({ id: TASK_ID })

      await service.updateTask(LIST_ID, TASK_ID, 'New title')

      expect(mock.history[0].method).toBe('patch')
      expect(mock.history[0].body).toEqual({ title: 'New title' })
    })

    it('builds the full body with all optional fields', async () => {
      mock.onPatch(`${TODO_BASE}/lists/${LIST_ID}/tasks/${TASK_ID}`).reply({ id: TASK_ID })

      const recurrence = {
        pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday'] },
        range: { type: 'noEnd', startDate: '2026-07-14' },
      }

      await service.updateTask(
        LIST_ID,
        TASK_ID,
        'New title',
        'New body',
        '2026-07-22',
        '2026-07-21T08:30:00',
        'UTC',
        'Low',
        ['Personal'],
        recurrence
      )

      expect(mock.history[0].body).toEqual({
        title: 'New title',
        body: { content: 'New body', contentType: 'text' },
        dueDateTime: { dateTime: '2026-07-22T00:00:00', timeZone: 'UTC' },
        reminderDateTime: { dateTime: '2026-07-21T08:30:00', timeZone: 'UTC' },
        isReminderOn: true,
        importance: 'low',
        categories: ['Personal'],
        recurrence,
      })
    })

    it('throws when no fields to update are provided', async () => {
      await expect(service.updateTask(LIST_ID, TASK_ID)).rejects.toThrow(
        'At least one field to update must be provided'
      )
      expect(mock.history).toHaveLength(0)
    })

    it('throws when the task list id is missing', async () => {
      await expect(service.updateTask(undefined, TASK_ID, 'x')).rejects.toThrow(
        'Parameter "Task List" is required'
      )
    })

    it('throws when the task id is missing', async () => {
      await expect(service.updateTask(LIST_ID, undefined, 'x')).rejects.toThrow(
        'Parameter "Task" is required'
      )
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPatch(`${TODO_BASE}/lists/${LIST_ID}/tasks/${TASK_ID}`).replyWithError({
        message: 'Bad Request',
      })

      await expect(service.updateTask(LIST_ID, TASK_ID, 'x')).rejects.toThrow(
        'Microsoft To Do API error: Bad Request'
      )
    })
  })

  describe('completeTask', () => {
    it('sends a PATCH with a completed status', async () => {
      mock.onPatch(`${TODO_BASE}/lists/${LIST_ID}/tasks/${TASK_ID}`).reply({
        id: TASK_ID,
        status: 'completed',
      })

      const result = await service.completeTask(LIST_ID, TASK_ID)

      expect(result).toEqual({ id: TASK_ID, status: 'completed' })
      expect(mock.history[0].body).toEqual({ status: 'completed' })
    })

    it('throws when the task list id is missing', async () => {
      await expect(service.completeTask(undefined, TASK_ID)).rejects.toThrow(
        'Parameter "Task List" is required'
      )
    })

    it('throws when the task id is missing', async () => {
      await expect(service.completeTask(LIST_ID)).rejects.toThrow('Parameter "Task" is required')
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPatch(`${TODO_BASE}/lists/${LIST_ID}/tasks/${TASK_ID}`).replyWithError({
        message: 'Conflict',
      })

      await expect(service.completeTask(LIST_ID, TASK_ID)).rejects.toThrow(
        'Microsoft To Do API error: Conflict'
      )
    })
  })

  describe('reopenTask', () => {
    it('sends a PATCH with a notStarted status', async () => {
      mock.onPatch(`${TODO_BASE}/lists/${LIST_ID}/tasks/${TASK_ID}`).reply({
        id: TASK_ID,
        status: 'notStarted',
      })

      const result = await service.reopenTask(LIST_ID, TASK_ID)

      expect(result).toEqual({ id: TASK_ID, status: 'notStarted' })
      expect(mock.history[0].body).toEqual({ status: 'notStarted' })
    })

    it('throws when the task list id is missing', async () => {
      await expect(service.reopenTask(undefined, TASK_ID)).rejects.toThrow(
        'Parameter "Task List" is required'
      )
    })

    it('throws when the task id is missing', async () => {
      await expect(service.reopenTask(LIST_ID)).rejects.toThrow('Parameter "Task" is required')
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPatch(`${TODO_BASE}/lists/${LIST_ID}/tasks/${TASK_ID}`).replyWithError({
        message: 'Gone',
      })

      await expect(service.reopenTask(LIST_ID, TASK_ID)).rejects.toThrow(
        'Microsoft To Do API error: Gone'
      )
    })
  })

  describe('deleteTask', () => {
    it('sends a DELETE and returns a confirmation message', async () => {
      mock.onDelete(`${TODO_BASE}/lists/${LIST_ID}/tasks/${TASK_ID}`).reply('')

      const result = await service.deleteTask(LIST_ID, TASK_ID)

      expect(result).toEqual({ message: 'Task deleted successfully' })
      expect(mock.history[0].method).toBe('delete')
    })

    it('throws when the task list id is missing', async () => {
      await expect(service.deleteTask(undefined, TASK_ID)).rejects.toThrow(
        'Parameter "Task List" is required'
      )
    })

    it('throws when the task id is missing', async () => {
      await expect(service.deleteTask(LIST_ID)).rejects.toThrow('Parameter "Task" is required')
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onDelete(`${TODO_BASE}/lists/${LIST_ID}/tasks/${TASK_ID}`).replyWithError({
        message: 'Not Found',
      })

      await expect(service.deleteTask(LIST_ID, TASK_ID)).rejects.toThrow(
        'Microsoft To Do API error: Not Found'
      )
    })
  })

  // ── Checklist items ──

  describe('addChecklistItem', () => {
    it('sends a POST with the display name', async () => {
      mock.onPost(`${TODO_BASE}/lists/${LIST_ID}/tasks/${TASK_ID}/checklistItems`).reply({
        id: ITEM_ID,
        displayName: 'Step 1',
      })

      const result = await service.addChecklistItem(LIST_ID, TASK_ID, 'Step 1')

      expect(result).toEqual({ id: ITEM_ID, displayName: 'Step 1' })
      expect(mock.history[0].body).toEqual({ displayName: 'Step 1' })
    })

    it('throws when the task list id is missing', async () => {
      await expect(service.addChecklistItem(undefined, TASK_ID, 'Step 1')).rejects.toThrow(
        'Parameter "Task List" is required'
      )
    })

    it('throws when the task id is missing', async () => {
      await expect(service.addChecklistItem(LIST_ID, undefined, 'Step 1')).rejects.toThrow(
        'Parameter "Task" is required'
      )
    })

    it('throws when the item name is missing', async () => {
      await expect(service.addChecklistItem(LIST_ID, TASK_ID)).rejects.toThrow(
        'Parameter "Item Name" is required'
      )
    })

    it('throws a wrapped error on API failure', async () => {
      mock
        .onPost(`${TODO_BASE}/lists/${LIST_ID}/tasks/${TASK_ID}/checklistItems`)
        .replyWithError({ message: 'Bad Request' })

      await expect(service.addChecklistItem(LIST_ID, TASK_ID, 'Step 1')).rejects.toThrow(
        'Microsoft To Do API error: Bad Request'
      )
    })
  })

  describe('listChecklistItems', () => {
    it('sends a GET for the checklist items', async () => {
      mock.onGet(`${TODO_BASE}/lists/${LIST_ID}/tasks/${TASK_ID}/checklistItems`).reply({
        value: [{ id: ITEM_ID, displayName: 'Step 1', isChecked: false }],
      })

      const result = await service.listChecklistItems(LIST_ID, TASK_ID)

      expect(result.value).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
    })

    it('throws when the task list id is missing', async () => {
      await expect(service.listChecklistItems(undefined, TASK_ID)).rejects.toThrow(
        'Parameter "Task List" is required'
      )
    })

    it('throws when the task id is missing', async () => {
      await expect(service.listChecklistItems(LIST_ID)).rejects.toThrow(
        'Parameter "Task" is required'
      )
    })

    it('throws a wrapped error on API failure', async () => {
      mock
        .onGet(`${TODO_BASE}/lists/${LIST_ID}/tasks/${TASK_ID}/checklistItems`)
        .replyWithError({ message: 'Forbidden' })

      await expect(service.listChecklistItems(LIST_ID, TASK_ID)).rejects.toThrow(
        'Microsoft To Do API error: Forbidden'
      )
    })
  })

  describe('checkOrUncheckChecklistItem', () => {
    const url = `${TODO_BASE}/lists/${LIST_ID}/tasks/${TASK_ID}/checklistItems/${ITEM_ID}`

    it('checks the item by default', async () => {
      mock.onPatch(url).reply({ id: ITEM_ID, isChecked: true })

      const result = await service.checkOrUncheckChecklistItem(LIST_ID, TASK_ID, ITEM_ID)

      expect(result).toEqual({ id: ITEM_ID, isChecked: true })
      expect(mock.history[0].body).toEqual({ isChecked: true })
    })

    it('unchecks the item when isChecked is false', async () => {
      mock.onPatch(url).reply({ id: ITEM_ID, isChecked: false })

      await service.checkOrUncheckChecklistItem(LIST_ID, TASK_ID, ITEM_ID, false)

      expect(mock.history[0].body).toEqual({ isChecked: false })
    })

    it('throws when the task list id is missing', async () => {
      await expect(
        service.checkOrUncheckChecklistItem(undefined, TASK_ID, ITEM_ID)
      ).rejects.toThrow('Parameter "Task List" is required')
    })

    it('throws when the task id is missing', async () => {
      await expect(
        service.checkOrUncheckChecklistItem(LIST_ID, undefined, ITEM_ID)
      ).rejects.toThrow('Parameter "Task" is required')
    })

    it('throws when the checklist item id is missing', async () => {
      await expect(service.checkOrUncheckChecklistItem(LIST_ID, TASK_ID)).rejects.toThrow(
        'Parameter "Checklist Item ID" is required'
      )
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPatch(url).replyWithError({ message: 'Not Found' })

      await expect(
        service.checkOrUncheckChecklistItem(LIST_ID, TASK_ID, ITEM_ID)
      ).rejects.toThrow('Microsoft To Do API error: Not Found')
    })
  })

  describe('deleteChecklistItem', () => {
    const url = `${TODO_BASE}/lists/${LIST_ID}/tasks/${TASK_ID}/checklistItems/${ITEM_ID}`

    it('sends a DELETE and returns a confirmation message', async () => {
      mock.onDelete(url).reply('')

      const result = await service.deleteChecklistItem(LIST_ID, TASK_ID, ITEM_ID)

      expect(result).toEqual({ message: 'Checklist item deleted successfully' })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(url)
    })

    it('throws when the task list id is missing', async () => {
      await expect(service.deleteChecklistItem(undefined, TASK_ID, ITEM_ID)).rejects.toThrow(
        'Parameter "Task List" is required'
      )
    })

    it('throws when the task id is missing', async () => {
      await expect(service.deleteChecklistItem(LIST_ID, undefined, ITEM_ID)).rejects.toThrow(
        'Parameter "Task" is required'
      )
    })

    it('throws when the checklist item id is missing', async () => {
      await expect(service.deleteChecklistItem(LIST_ID, TASK_ID)).rejects.toThrow(
        'Parameter "Checklist Item ID" is required'
      )
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onDelete(url).replyWithError({ message: 'Not Found' })

      await expect(service.deleteChecklistItem(LIST_ID, TASK_ID, ITEM_ID)).rejects.toThrow(
        'Microsoft To Do API error: Not Found'
      )
    })
  })
})
