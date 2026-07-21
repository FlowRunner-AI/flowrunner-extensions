'use strict'

const { createSandbox } = require('../../../service-sandbox')

const CLIENT_ID = 'test-client-id'
const CLIENT_SECRET = 'test-client-secret'
const OAUTH_TOKEN = 'test-oauth-access-token'
const OAUTH_BASE = 'https://app.asana.com/-'
const API_BASE = 'https://app.asana.com/api/1.0'

describe('Asana Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET })
    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()

    // Simulate the OAuth access token injected by the Flowrunner runtime
    service.request = { headers: { 'oauth-access-token': OAUTH_TOKEN } }
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
          name: 'clientId',
          required: true,
          shared: true,
          type: 'STRING',
        }),
        expect.objectContaining({
          name: 'clientSecret',
          required: true,
          shared: true,
          type: 'STRING',
        }),
      ])
    })
  })

  // ── OAuth Methods ──

  describe('getOAuth2ConnectionURL', () => {
    it('returns the correct authorization URL', async () => {
      const url = await service.getOAuth2ConnectionURL()

      expect(url).toContain(`${OAUTH_BASE}/oauth_authorize`)
      expect(url).toContain(`client_id=${CLIENT_ID}`)
      expect(url).toContain('response_type=code')
      expect(url).toContain('scope=')
    })
  })

  describe('refreshToken', () => {
    it('sends correct request and returns token data', async () => {
      mock.onPost(`${OAUTH_BASE}/oauth_token`).reply({
        access_token: 'new-access-token',
        expires_in: 3600,
      })

      const result = await service.refreshToken('old-refresh-token')

      expect(result).toEqual({ token: 'new-access-token', expirationInSeconds: 3600 })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({
        'Content-Type': 'application/x-www-form-urlencoded',
      })
      expect(mock.history[0].query).toMatchObject({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        refresh_token: 'old-refresh-token',
        grant_type: 'refresh_token',
      })
    })

    it('throws on API error', async () => {
      mock.onPost(`${OAUTH_BASE}/oauth_token`).replyWithError({ message: 'Invalid token' })

      await expect(service.refreshToken('bad-token')).rejects.toThrow()
    })
  })

  describe('executeCallback', () => {
    it('sends correct request and returns connection data', async () => {
      mock.onPost(`${OAUTH_BASE}/oauth_token`).reply({
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        expires_in: 3600,
        data: { name: 'John Doe', email: 'john@example.com' },
      })

      mock.onGet(`${API_BASE}/users/me`).reply({
        data: {
          photo: { image_128x128: 'https://example.com/photo.png' },
        },
      })

      const result = await service.executeCallback({
        redirectURI: 'https://app.flowrunner.com/callback',
        code: 'auth-code-123',
      })

      expect(result).toEqual({
        token: 'new-access-token',
        refreshToken: 'new-refresh-token',
        expirationInSeconds: 3600,
        overwrite: true,
        connectionIdentityName: 'John Doe (john@example.com)',
        connectionIdentityImageURL: 'https://example.com/photo.png',
      })

      expect(mock.history).toHaveLength(2)
      expect(mock.history[0].query).toMatchObject({
        grant_type: 'authorization_code',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: 'https://app.flowrunner.com/callback',
        code: 'auth-code-123',
      })
    })

    it('handles user profile fetch failure gracefully', async () => {
      mock.onPost(`${OAUTH_BASE}/oauth_token`).reply({
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        expires_in: 3600,
        data: { name: 'John Doe', email: 'john@example.com' },
      })

      mock.onGet(`${API_BASE}/users/me`).replyWithError({ message: 'Unauthorized' })

      const result = await service.executeCallback({
        redirectURI: 'https://app.flowrunner.com/callback',
        code: 'auth-code-123',
      })

      expect(result.token).toBe('new-access-token')
      expect(result.connectionIdentityImageURL).toBeUndefined()
    })
  })

  // ── Dictionaries ──

  describe('getWorkspacesDictionary', () => {
    it('returns workspaces formatted as dictionary items', async () => {
      mock.onGet(`${API_BASE}/workspaces`).reply({
        data: [
          { gid: '111', name: 'Workspace A' },
          { gid: '222', name: 'Workspace B' },
        ],
        next_page: null,
      })

      const result = await service.getWorkspacesDictionary({})

      expect(result.items).toEqual([
        { label: 'Workspace A', note: 'ID: 111', value: '111' },
        { label: 'Workspace B', note: 'ID: 222', value: '222' },
      ])
      expect(result.cursor).toBeUndefined()
      expect(mock.history[0].query).toMatchObject({ limit: 100 })
      expect(mock.history[0].headers).toMatchObject({
        Authorization: `Bearer ${OAUTH_TOKEN}`,
      })
    })

    it('passes cursor for pagination', async () => {
      mock.onGet(`${API_BASE}/workspaces`).reply({
        data: [{ gid: '333', name: 'Workspace C' }],
        next_page: { offset: 'next-cursor' },
      })

      const result = await service.getWorkspacesDictionary({ cursor: 'page-2' })

      expect(result.cursor).toBe('next-cursor')
      expect(mock.history[0].query).toMatchObject({ offset: 'page-2' })
    })

    it('filters by search string', async () => {
      mock.onGet(`${API_BASE}/workspaces`).reply({
        data: [
          { gid: '111', name: 'Marketing' },
          { gid: '222', name: 'Engineering' },
        ],
        next_page: null,
      })

      const result = await service.getWorkspacesDictionary({ search: 'market' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toBe('Marketing')
    })
  })

  describe('getProjectsDictionary', () => {
    it('returns projects for a workspace', async () => {
      mock.onGet(`${API_BASE}/projects`).reply({
        data: [{ gid: 'p1', name: 'Project Alpha' }],
        next_page: null,
      })

      const result = await service.getProjectsDictionary({
        criteria: { workspaceId: 'w1' },
      })

      expect(result.items).toEqual([
        { label: 'Project Alpha', note: 'ID: p1', value: 'p1' },
      ])
      expect(mock.history[0].query).toMatchObject({ workspace: 'w1', limit: 100 })
    })

    it('filters by search string', async () => {
      mock.onGet(`${API_BASE}/projects`).reply({
        data: [
          { gid: 'p1', name: 'Website Redesign' },
          { gid: 'p2', name: 'Mobile App' },
        ],
        next_page: null,
      })

      const result = await service.getProjectsDictionary({
        search: 'mobile',
        criteria: { workspaceId: 'w1' },
      })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toBe('Mobile App')
    })
  })

  describe('getSectionsDictionary', () => {
    it('returns sections for a project', async () => {
      mock.onGet(`${API_BASE}/projects/p1/sections`).reply({
        data: [{ gid: 's1', name: 'To Do' }],
        next_page: null,
      })

      const result = await service.getSectionsDictionary({
        criteria: { projectId: 'p1' },
      })

      expect(result.items).toEqual([
        { label: 'To Do', note: 'ID: s1', value: 's1' },
      ])
    })
  })

  describe('getTeamsDictionary', () => {
    it('returns teams for a workspace', async () => {
      mock.onGet(`${API_BASE}/workspaces/w1/teams`).reply({
        data: [{ gid: 't1', name: 'Engineering' }],
        next_page: null,
      })

      const result = await service.getTeamsDictionary({
        criteria: { workspaceId: 'w1' },
      })

      expect(result.items).toEqual([
        { label: 'Engineering', note: 'ID: t1', value: 't1' },
      ])
    })
  })

  describe('getUsersDictionary', () => {
    it('returns users with email in note', async () => {
      mock.onGet(`${API_BASE}/users`).reply({
        data: [{ gid: 'u1', name: 'John', email: 'john@example.com' }],
        next_page: null,
      })

      const result = await service.getUsersDictionary({
        criteria: { workspaceId: 'w1' },
      })

      expect(result.items).toEqual([
        { label: 'John', note: 'Email: john@example.com', value: 'u1' },
      ])
      expect(mock.history[0].query).toMatchObject({
        workspace: 'w1',
        opt_fields: 'email,name,gid',
      })
    })

    it('uses [empty] label when name is missing', async () => {
      mock.onGet(`${API_BASE}/users`).reply({
        data: [{ gid: 'u2', name: '', email: 'noname@example.com' }],
        next_page: null,
      })

      const result = await service.getUsersDictionary({
        criteria: { workspaceId: 'w1' },
      })

      expect(result.items[0].label).toBe('[empty]')
    })

    it('filters by email search', async () => {
      mock.onGet(`${API_BASE}/users`).reply({
        data: [
          { gid: 'u1', name: 'John', email: 'john@example.com' },
          { gid: 'u2', name: 'Jane', email: 'jane@other.com' },
        ],
        next_page: null,
      })

      const result = await service.getUsersDictionary({
        search: 'other.com',
        criteria: { workspaceId: 'w1' },
      })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toBe('Jane')
    })
  })

  describe('getTasksDictionary', () => {
    it('returns tasks for a project', async () => {
      mock.onGet(`${API_BASE}/tasks`).reply({
        data: [{ gid: 'task1', name: 'Design Homepage' }],
        next_page: null,
      })

      const result = await service.getTasksDictionary({
        criteria: { projectId: 'p1' },
      })

      expect(result.items).toEqual([
        { label: 'Design Homepage', note: 'ID: task1', value: 'task1' },
      ])
      expect(mock.history[0].query).toMatchObject({
        project: 'p1',
        opt_fields: 'name,gid',
      })
    })
  })

  describe('getProjectTemplatesDictionary', () => {
    it('returns project templates for a workspace', async () => {
      mock.onGet(`${API_BASE}/project_templates`).reply({
        data: [{ gid: 'pt1', name: 'Sprint Template' }],
        next_page: null,
      })

      const result = await service.getProjectTemplatesDictionary({
        criteria: { workspaceId: 'w1' },
      })

      expect(result.items).toEqual([
        { label: 'Sprint Template', note: 'ID: pt1', value: 'pt1' },
      ])
      expect(mock.history[0].query).toMatchObject({
        workspace: 'w1',
        opt_fields: 'name,gid',
      })
    })
  })

  describe('getTaskTemplatesDictionary', () => {
    it('returns task templates for a project', async () => {
      mock.onGet(`${API_BASE}/task_templates`).reply({
        data: [{ gid: 'tt1', name: 'Bug Report' }],
        next_page: null,
      })

      const result = await service.getTaskTemplatesDictionary({
        criteria: { projectId: 'p1' },
      })

      expect(result.items).toEqual([
        { label: 'Bug Report', note: 'ID: tt1', value: 'tt1' },
      ])
      expect(mock.history[0].query).toMatchObject({
        project: 'p1',
        opt_fields: 'name,gid',
      })
    })
  })

  describe('getTagsDictionary', () => {
    it('returns tags for a workspace', async () => {
      mock.onGet(`${API_BASE}/tags`).reply({
        data: [{ gid: 'tag1', name: 'Priority' }],
        next_page: null,
      })

      const result = await service.getTagsDictionary({
        criteria: { workspaceId: 'w1' },
      })

      expect(result.items).toEqual([
        { label: 'Priority', note: 'ID: tag1', value: 'tag1' },
      ])
      expect(mock.history[0].query).toMatchObject({ workspace: 'w1' })
    })
  })

  // ── Task Actions ──

  describe('createTask', () => {
    it('sends POST with required fields', async () => {
      mock.onPost(`${API_BASE}/tasks`).reply({
        data: { gid: 'new-task-1' },
      })

      const result = await service.createTask(
        'w1', 'p1', undefined, undefined, 'My Task', 'Task description',
        undefined, undefined, undefined, undefined, undefined
      )

      expect(result).toEqual({ taskId: 'new-task-1' })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].body).toMatchObject({
        data: {
          name: 'My Task',
          workspace: 'w1',
          projects: ['p1'],
          html_notes: '<body>Task description</body>',
        },
      })
    })

    it('sends POST with all optional fields', async () => {
      const dueAt = '2026-08-01T12:00:00Z'
      const startAt = '2026-07-25T09:00:00Z'

      mock.onPost(`${API_BASE}/tasks`).reply({
        data: { gid: 'new-task-2' },
      })

      await service.createTask(
        'w1', 'p1', dueAt, startAt, 'Full Task', 'Full description',
        true, true, 'user1', 'follower1', 'tag1'
      )

      const body = mock.history[0].body
      expect(body.data).toMatchObject({
        name: 'Full Task',
        workspace: 'w1',
        projects: ['p1'],
        completed: true,
        liked: true,
        assignee: 'user1',
        followers: ['follower1'],
        tags: ['tag1'],
      })
      expect(body.data.due_at).toBe(new Date(dueAt).toISOString())
      expect(body.data.start_at).toBe(new Date(startAt).toISOString())
      expect(body.data.html_notes).toBe('<body>Full description</body>')
    })

    it('omits undefined optional fields from body', async () => {
      mock.onPost(`${API_BASE}/tasks`).reply({
        data: { gid: 'new-task-3' },
      })

      await service.createTask(
        'w1', 'p1', undefined, undefined, 'Simple', 'Desc',
        undefined, undefined, undefined, undefined, undefined
      )

      const data = mock.history[0].body.data
      expect(data).not.toHaveProperty('due_at')
      expect(data).not.toHaveProperty('start_at')
      expect(data).not.toHaveProperty('completed')
      expect(data).not.toHaveProperty('liked')
      expect(data).not.toHaveProperty('assignee')
      expect(data).not.toHaveProperty('followers')
      expect(data).not.toHaveProperty('tags')
    })

    it('throws on API error', async () => {
      mock.onPost(`${API_BASE}/tasks`).replyWithError({
        message: 'Bad Request',
        body: { errors: [{ message: 'Invalid task data' }] },
      })

      await expect(
        service.createTask('w1', 'p1', undefined, undefined, 'T', 'D')
      ).rejects.toThrow('Invalid task data')
    })
  })

  describe('updateTask', () => {
    const taskData = {
      gid: 'task-1',
      name: 'Updated Task',
      notes: 'Updated notes',
      created_at: '2026-07-01T10:00:00Z',
      modified_at: '2026-07-20T10:00:00Z',
      completed: false,
      due_on: '2026-08-01',
      start_on: '2026-07-25',
      permalink_url: 'https://app.asana.com/0/p1/task-1',
      assignee: { gid: 'u1', name: 'John' },
      workspace: { gid: 'w1', name: 'My Workspace' },
    }

    it('sends PUT with correct body and returns normalized task', async () => {
      mock.onPut(`${API_BASE}/tasks/task-1`).reply({ data: taskData })

      const result = await service.updateTask(
        'w1', 'p1', 'task-1', undefined, undefined,
        'Updated Task', 'Updated notes', false, undefined, undefined, undefined, undefined
      )

      expect(result).toMatchObject({
        taskId: 'task-1',
        name: 'Updated Task',
        completed: false,
        workspace: 'My Workspace',
        workspaceId: 'w1',
      })
      expect(mock.history[0].method).toBe('put')
    })

    it('includes optional fields when provided', async () => {
      mock.onPut(`${API_BASE}/tasks/task-1`).reply({ data: taskData })

      await service.updateTask(
        'w1', 'p1', 'task-1', '2026-08-01T12:00:00Z', '2026-07-25T09:00:00Z',
        'Updated', 'Desc', true, true, 'u2', 'f1', 'tag1'
      )

      const body = mock.history[0].body
      expect(body.data).toMatchObject({
        completed: true,
        liked: true,
        assignee: 'u2',
        followers: ['f1'],
        tags: ['tag1'],
      })
      expect(body.data.due_at).toBeDefined()
      expect(body.data.start_at).toBeDefined()
    })
  })

  describe('getTask', () => {
    it('sends GET and returns normalized task', async () => {
      mock.onGet(`${API_BASE}/tasks/task-1`).reply({
        data: {
          gid: 'task-1',
          name: 'My Task',
          notes: 'Some notes',
          created_at: '2026-07-01T10:00:00Z',
          modified_at: '2026-07-20T10:00:00Z',
          completed: false,
          due_on: null,
          start_on: null,
          permalink_url: 'https://app.asana.com/0/p1/task-1',
          assignee: null,
          workspace: { gid: 'w1', name: 'My Workspace' },
        },
      })

      const result = await service.getTask('w1', 'p1', 'task-1')

      expect(result).toMatchObject({
        taskId: 'task-1',
        name: 'My Task',
        notes: 'Some notes',
        completed: false,
        workspace: 'My Workspace',
        workspaceId: 'w1',
        taskUrl: 'https://app.asana.com/0/p1/task-1',
      })
      expect(mock.history[0].method).toBe('get')
    })
  })

  describe('findTaskInProject', () => {
    it('returns exact match task', async () => {
      mock.onGet(`${API_BASE}/projects/p1/tasks`).reply({
        data: [
          { gid: 'task-1', name: 'Other Task' },
          { gid: 'task-2', name: 'Target Task' },
        ],
        next_page: null,
      })

      mock.onGet(`${API_BASE}/tasks/task-2`).reply({
        data: {
          gid: 'task-2',
          name: 'Target Task',
          notes: '',
          created_at: '2026-07-01T10:00:00Z',
          modified_at: '2026-07-20T10:00:00Z',
          completed: false,
          due_on: null,
          start_on: null,
          permalink_url: 'https://app.asana.com/0/p1/task-2',
          assignee: null,
          workspace: { gid: 'w1', name: 'WS' },
        },
      })

      const result = await service.findTaskInProject('w1', 'p1', 'Target Task')

      expect(result).toMatchObject({ taskId: 'task-2', name: 'Target Task' })
    })

    it('returns similar match when no exact match', async () => {
      mock.onGet(`${API_BASE}/projects/p1/tasks`).reply({
        data: [
          { gid: 'task-1', name: 'Design Homepage Banner' },
        ],
        next_page: null,
      })

      mock.onGet(`${API_BASE}/tasks/task-1`).reply({
        data: {
          gid: 'task-1',
          name: 'Design Homepage Banner',
          notes: '',
          created_at: '2026-07-01T10:00:00Z',
          modified_at: '2026-07-20T10:00:00Z',
          completed: false,
          due_on: null,
          start_on: null,
          permalink_url: 'https://app.asana.com/0/p1/task-1',
          assignee: null,
          workspace: { gid: 'w1', name: 'WS' },
        },
      })

      const result = await service.findTaskInProject('w1', 'p1', 'homepage')

      expect(result).toMatchObject({ taskId: 'task-1' })
    })

    it('returns null when no match found', async () => {
      mock.onGet(`${API_BASE}/projects/p1/tasks`).reply({
        data: [{ gid: 'task-1', name: 'Unrelated' }],
        next_page: null,
      })

      const result = await service.findTaskInProject('w1', 'p1', 'Nonexistent')

      expect(result).toBeNull()
    })

    it('paginates through all tasks', async () => {
      mock.onGet(`${API_BASE}/projects/p1/tasks`).replyWith((call) => {
        if (!call.query.offset) {
          return {
            data: [{ gid: 'task-1', name: 'First' }],
            next_page: { offset: 'page2' },
          }
        }

        return {
          data: [{ gid: 'task-2', name: 'Target' }],
          next_page: null,
        }
      })

      mock.onGet(`${API_BASE}/tasks/task-2`).reply({
        data: {
          gid: 'task-2',
          name: 'Target',
          notes: '',
          created_at: '2026-07-01T10:00:00Z',
          modified_at: '2026-07-20T10:00:00Z',
          completed: false,
          due_on: null,
          start_on: null,
          permalink_url: 'https://app.asana.com/0/p1/task-2',
          assignee: null,
          workspace: { gid: 'w1', name: 'WS' },
        },
      })

      const result = await service.findTaskInProject('w1', 'p1', 'Target')

      expect(result).toMatchObject({ taskId: 'task-2' })
      // 2 calls for pagination + 1 for getTask
      expect(mock.history).toHaveLength(3)
    })
  })

  describe('addTaskToSection', () => {
    it('sends POST with correct body', async () => {
      mock.onPost(`${API_BASE}/sections/s1/addTask`).reply({})

      await service.addTaskToSection('w1', 'p1', 's1', 'task-1')

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].body).toEqual({ data: { task: 'task-1' } })
    })
  })

  describe('attachFile', () => {
    it('sends POST with file attachment data', async () => {
      mock.onPost(`${API_BASE}/attachments`).reply({
        data: { gid: 'att-1', name: 'report.pdf' },
      })

      const result = await service.attachFile(
        'w1', 'p1', 'task-1', 'https://example.com/files/report.pdf'
      )

      expect(result).toEqual({ attachmentId: 'att-1', attachmentName: 'report.pdf' })
      expect(mock.history[0].body).toEqual({
        data: {
          resource_subtype: 'external',
          parent: 'task-1',
          url: 'https://example.com/files/report.pdf',
          name: 'report.pdf',
        },
      })
    })
  })

  describe('createComment', () => {
    it('sends POST with comment text', async () => {
      mock.onPost(`${API_BASE}/tasks/task-1/stories`).reply({
        data: { gid: 'comment-1' },
      })

      const result = await service.createComment('w1', 'p1', 'task-1', 'Great work!')

      expect(result).toEqual({ commentId: 'comment-1' })
      expect(mock.history[0].body).toEqual({ data: { text: 'Great work!' } })
    })
  })

  describe('duplicateTask', () => {
    it('sends POST with default include fields', async () => {
      mock.onPost(`${API_BASE}/tasks/task-1/duplicate`).reply({
        data: { new_task: { gid: 'dup-task-1' } },
      })

      const result = await service.duplicateTask('w1', 'p1', 'task-1', 'Copy of Task')

      expect(result).toEqual({ taskId: 'dup-task-1' })
      expect(mock.history[0].body.data).toMatchObject({
        name: 'Copy of Task',
        include: 'assignee,attachments,dates,dependencies,followers,notes,parent,projects,subtasks,tags',
      })
    })

    it('uses custom include fields when provided', async () => {
      mock.onPost(`${API_BASE}/tasks/task-1/duplicate`).reply({
        data: { new_task: { gid: 'dup-task-2' } },
      })

      await service.duplicateTask('w1', 'p1', 'task-1', 'Copy', 'assignee,notes')

      expect(mock.history[0].body.data.include).toBe('assignee,notes')
    })
  })

  describe('createSubtask', () => {
    it('sends POST with required fields', async () => {
      mock.onPost(`${API_BASE}/tasks/parent-1/subtasks`).reply({
        data: { gid: 'sub-1' },
      })

      const result = await service.createSubtask(
        'w1', 'p1', 'parent-1', undefined, undefined,
        'Subtask Title', 'Subtask desc',
        undefined, undefined, undefined, undefined, undefined
      )

      expect(result).toEqual({ subtaskId: 'sub-1' })
      expect(mock.history[0].body).toMatchObject({
        data: {
          name: 'Subtask Title',
          workspace: 'w1',
          projects: ['p1'],
          html_notes: '<body>Subtask desc</body>',
        },
      })
    })

    it('sends POST with all optional fields', async () => {
      mock.onPost(`${API_BASE}/tasks/parent-1/subtasks`).reply({
        data: { gid: 'sub-2' },
      })

      await service.createSubtask(
        'w1', 'p1', 'parent-1', '2026-08-01T12:00:00Z', '2026-07-25T09:00:00Z',
        'Full Subtask', 'Full desc', true, true, 'u1', 'f1', 'tag1'
      )

      const body = mock.history[0].body
      expect(body.data).toMatchObject({
        name: 'Full Subtask',
        completed: true,
        liked: true,
        assignee: 'u1',
        followers: ['f1'],
        tags: ['tag1'],
      })
      expect(body.data.due_at).toBeDefined()
      expect(body.data.start_at).toBeDefined()
    })
  })

  // ── Templates ──

  describe('getTaskTemplates', () => {
    it('returns mapped task templates', async () => {
      mock.onGet(`${API_BASE}/task_templates`).reply({
        data: [
          { gid: 'tt1', name: 'Bug Report', resource_type: 'task_template' },
          { gid: 'tt2', name: 'Feature Request', resource_type: 'task_template' },
        ],
      })

      const result = await service.getTaskTemplates('w1', 'p1')

      expect(result).toEqual([
        { templateId: 'tt1', name: 'Bug Report' },
        { templateId: 'tt2', name: 'Feature Request' },
      ])
      expect(mock.history[0].query).toMatchObject({ project: 'p1' })
    })
  })

  describe('createTaskFromTemplate', () => {
    it('sends POST and returns task ID', async () => {
      mock.onPost(`${API_BASE}/task_templates/tt1/instantiateTask`).reply({
        data: { gid: 'new-from-template' },
      })

      const result = await service.createTaskFromTemplate('w1', 'p1', 'tt1', 'New Bug')

      expect(result).toEqual({ taskId: 'new-from-template' })
      expect(mock.history[0].body).toEqual({ data: { name: 'New Bug' } })
    })
  })

  // ── Project Management ──

  describe('createProject', () => {
    it('sends POST with correct body', async () => {
      mock.onPost(`${API_BASE}/projects`).reply({
        data: { gid: 'proj-1' },
      })

      const result = await service.createProject('w1', 't1', 'New Project', 'Project notes')

      expect(result).toEqual({ projectId: 'proj-1' })
      expect(mock.history[0].body).toEqual({
        data: { name: 'New Project', notes: 'Project notes', workspace: 'w1', team: 't1' },
      })
    })
  })

  describe('getProject', () => {
    it('returns normalized project data', async () => {
      mock.onGet(`${API_BASE}/projects/proj-1`).reply({
        data: {
          gid: 'proj-1',
          name: 'Test Project',
          notes: 'Notes',
          created_at: '2026-07-01T10:00:00Z',
          modified_at: '2026-07-20T10:00:00Z',
          completed_at: null,
          archived: false,
          permalink_url: 'https://app.asana.com/0/proj-1/proj-1',
          workspace: { gid: 'w1', name: 'WS' },
          team: { gid: 't1', name: 'Team' },
          owner: { gid: 'u1', name: 'Owner' },
          members: [{ gid: 'u1' }, { gid: 'u2' }],
          followers: [{ gid: 'u1' }],
        },
      })

      const result = await service.getProject('w1', 'proj-1')

      expect(result).toMatchObject({
        projectId: 'proj-1',
        name: 'Test Project',
        notes: 'Notes',
        archived: false,
        workspaceName: 'WS',
        workspaceId: 'w1',
        teamName: 'Team',
        teamId: 't1',
        ownerName: 'Owner',
        ownerId: 'u1',
        members: ['u1', 'u2'],
        followers: ['u1'],
      })
    })
  })

  describe('findProject', () => {
    it('returns exact match project', async () => {
      mock.onGet(`${API_BASE}/workspaces/w1/projects`).reply({
        data: [
          { gid: 'proj-1', name: 'Other' },
          { gid: 'proj-2', name: 'Target Project' },
        ],
        next_page: null,
      })

      mock.onGet(`${API_BASE}/projects/proj-2`).reply({
        data: {
          gid: 'proj-2',
          name: 'Target Project',
          notes: '',
          created_at: '2026-07-01T10:00:00Z',
          modified_at: '2026-07-20T10:00:00Z',
          completed_at: null,
          archived: false,
          permalink_url: 'https://app.asana.com/0/proj-2/proj-2',
          workspace: { gid: 'w1', name: 'WS' },
          team: { gid: 't1', name: 'Team' },
          owner: { gid: 'u1', name: 'Owner' },
          members: [],
          followers: [],
        },
      })

      const result = await service.findProject('w1', 'Target Project')

      expect(result).toMatchObject({ projectId: 'proj-2', name: 'Target Project' })
    })

    it('returns null when no match found', async () => {
      mock.onGet(`${API_BASE}/workspaces/w1/projects`).reply({
        data: [{ gid: 'proj-1', name: 'Unrelated' }],
        next_page: null,
      })

      const result = await service.findProject('w1', 'Nonexistent')

      expect(result).toBeNull()
    })
  })

  describe('createProjectFromTemplate', () => {
    it('sends POST with correct body', async () => {
      mock.onPost(`${API_BASE}/project_templates/pt1/instantiateProject`).reply({
        data: { gid: 'proj-from-tpl' },
      })

      const result = await service.createProjectFromTemplate(
        'w1', 't1', 'pt1', 'From Template', 'private'
      )

      expect(result).toEqual({ projectId: 'proj-from-tpl' })
      expect(mock.history[0].body).toEqual({
        data: { name: 'From Template', team: 't1', privacy_setting: 'private' },
      })
    })

    it('omits privacy_setting when not provided', async () => {
      mock.onPost(`${API_BASE}/project_templates/pt1/instantiateProject`).reply({
        data: { gid: 'proj-from-tpl' },
      })

      await service.createProjectFromTemplate('w1', 't1', 'pt1', 'From Template')

      const body = mock.history[0].body
      expect(body.data.privacy_setting).toBeUndefined()
    })
  })

  // ── Sections ──

  describe('createSection', () => {
    it('sends POST and returns section ID', async () => {
      mock.onPost(`${API_BASE}/projects/p1/sections`).reply({
        data: { gid: 'sec-1' },
      })

      const result = await service.createSection('w1', 'p1', 'In Progress')

      expect(result).toEqual({ sectionId: 'sec-1' })
      expect(mock.history[0].body).toEqual({ data: { name: 'In Progress' } })
    })
  })

  describe('findSection', () => {
    it('returns exact match section', async () => {
      mock.onGet(`${API_BASE}/projects/p1/sections`).reply({
        data: [
          { gid: 's1', name: 'To Do' },
          { gid: 's2', name: 'Done' },
        ],
        next_page: null,
      })

      mock.onGet(`${API_BASE}/sections/s2`).reply({
        data: {
          gid: 's2',
          name: 'Done',
          created_at: '2026-07-01T10:00:00Z',
          project: { gid: 'p1', name: 'Project' },
        },
      })

      const result = await service.findSection('w1', 'p1', 'Done')

      expect(result).toMatchObject({ sectionId: 's2', name: 'Done' })
    })

    it('returns null when no match found', async () => {
      mock.onGet(`${API_BASE}/projects/p1/sections`).reply({
        data: [{ gid: 's1', name: 'To Do' }],
        next_page: null,
      })

      const result = await service.findSection('w1', 'p1', 'Nonexistent')

      expect(result).toBeNull()
    })
  })

  describe('getSectionById', () => {
    it('returns normalized section data', async () => {
      mock.onGet(`${API_BASE}/sections/s1`).reply({
        data: {
          gid: 's1',
          name: 'In Progress',
          created_at: '2026-07-01T10:00:00Z',
          project: { gid: 'p1', name: 'My Project' },
        },
      })

      const result = await service.getSectionById('w1', 'p1', 's1')

      expect(result).toEqual({
        sectionId: 's1',
        name: 'In Progress',
        createdAt: '2026-07-01T10:00:00Z',
        projectId: 'p1',
        projectName: 'My Project',
      })
    })
  })

  // ── Users ──

  describe('findUser', () => {
    it('returns user matching by email', async () => {
      mock.onGet(`${API_BASE}/users`).replyWith((call) => {
        if (call.query.opt_fields === 'email,gid') {
          return {
            data: [
              { gid: 'u1', email: 'john@example.com' },
              { gid: 'u2', email: 'jane@other.com' },
            ],
            next_page: null,
          }
        }

        return {
          data: [
            { gid: 'u1', email: 'john@example.com' },
            { gid: 'u2', email: 'jane@other.com' },
          ],
          next_page: null,
        }
      })

      mock.onGet(`${API_BASE}/users/u1`).reply({
        data: { gid: 'u1', name: 'John Doe', email: 'john@example.com' },
      })

      const result = await service.findUser('w1', 'john@example.com')

      expect(result).toEqual({ email: 'john@example.com', userId: 'u1', name: 'John Doe' })
    })

    it('returns user matching by gid', async () => {
      mock.onGet(`${API_BASE}/users`).reply({
        data: [
          { gid: 'u1', email: 'john@example.com' },
        ],
        next_page: null,
      })

      mock.onGet(`${API_BASE}/users/u1`).reply({
        data: { gid: 'u1', name: 'John Doe', email: 'john@example.com' },
      })

      const result = await service.findUser('w1', 'u1')

      expect(result).toEqual({ email: 'john@example.com', userId: 'u1', name: 'John Doe' })
    })

    it('returns similar match when no exact match', async () => {
      mock.onGet(`${API_BASE}/users`).reply({
        data: [
          { gid: 'u1', email: 'john.doe@example.com' },
        ],
        next_page: null,
      })

      mock.onGet(`${API_BASE}/users/u1`).reply({
        data: { gid: 'u1', name: 'John Doe', email: 'john.doe@example.com' },
      })

      const result = await service.findUser('w1', 'john.doe')

      expect(result).toEqual({ email: 'john.doe@example.com', userId: 'u1', name: 'John Doe' })
    })

    it('returns null when no match found', async () => {
      mock.onGet(`${API_BASE}/users`).reply({
        data: [{ gid: 'u1', email: 'other@example.com' }],
        next_page: null,
      })

      const result = await service.findUser('w1', 'nonexistent@nowhere.com')

      expect(result).toBeNull()
    })
  })
})
