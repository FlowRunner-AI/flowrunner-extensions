'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-api-key'
const BASE = 'https://api.clockify.me/api/v1'
const REPORTS_BASE = 'https://reports.api.clockify.me/v1'

const WS = 'ws-1'
const USER_ID = 'user-abc'

describe('Clockify Service', () => {
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

  // Convenience: the /user lookup that user-scoped time-entry routes make first.
  function stubUser() {
    mock.onGet(`${ BASE }/user`).reply({ id: USER_ID })
  }

  // ── Registration ──

  describe('service registration', () => {
    it('registers with a single required, non-shared apiKey config item', () => {
      expect(sandbox.getConfigItems()).toEqual([
        expect.objectContaining({
          name: 'apiKey',
          displayName: 'API Key',
          required: true,
          shared: false,
          type: 'STRING',
        }),
      ])
    })

    it('sends the X-Api-Key and Content-Type headers on requests', async () => {
      mock.onGet(`${ BASE }/user`).reply({ id: USER_ID })

      await service.getCurrentUser()

      expect(mock.history[0].headers).toMatchObject({
        'X-Api-Key': API_KEY,
        'Content-Type': 'application/json',
      })
    })
  })

  // ── Time Entries ──

  describe('addTimeEntry', () => {
    it('resolves the user id then posts required params only', async () => {
      stubUser()
      mock
        .onPost(`${ BASE }/workspaces/${ WS }/user/${ USER_ID }/time-entries`)
        .reply({ id: 'te-1' })

      const result = await service.addTimeEntry(WS, '2024-01-15T08:00:00Z')

      expect(result).toEqual({ id: 'te-1' })
      // First call is the /user lookup, second is the create.
      expect(mock.history).toHaveLength(2)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/user`)
      expect(mock.history[1].method).toBe('post')
      expect(mock.history[1].url).toBe(`${ BASE }/workspaces/${ WS }/user/${ USER_ID }/time-entries`)
      expect(mock.history[1].body).toEqual({ start: '2024-01-15T08:00:00Z' })
    })

    it('includes all optional params when provided', async () => {
      stubUser()
      mock
        .onPost(`${ BASE }/workspaces/${ WS }/user/${ USER_ID }/time-entries`)
        .reply({ id: 'te-2' })

      await service.addTimeEntry(
        WS,
        '2024-01-15T08:00:00Z',
        '2024-01-15T09:30:00Z',
        'Design review',
        'proj-1',
        'task-1',
        ['tag-1', 'tag-2'],
        true
      )

      expect(mock.history[1].body).toEqual({
        start: '2024-01-15T08:00:00Z',
        end: '2024-01-15T09:30:00Z',
        description: 'Design review',
        projectId: 'proj-1',
        taskId: 'task-1',
        tagIds: ['tag-1', 'tag-2'],
        billable: true,
      })
    })

    it('omits empty tagIds array', async () => {
      stubUser()
      mock
        .onPost(`${ BASE }/workspaces/${ WS }/user/${ USER_ID }/time-entries`)
        .reply({ id: 'te-3' })

      await service.addTimeEntry(WS, '2024-01-15T08:00:00Z', undefined, undefined, undefined, undefined, [])

      expect(mock.history[1].body).toEqual({ start: '2024-01-15T08:00:00Z' })
    })

    it('throws a wrapped error on API failure', async () => {
      stubUser()
      mock
        .onPost(`${ BASE }/workspaces/${ WS }/user/${ USER_ID }/time-entries`)
        .replyWithError({ message: 'Bad Request' })

      await expect(service.addTimeEntry(WS, '2024-01-15T08:00:00Z')).rejects.toThrow(
        'Clockify API error: Bad Request'
      )
    })

    it('surfaces the API body message and code in the error', async () => {
      stubUser()
      mock
        .onPost(`${ BASE }/workspaces/${ WS }/user/${ USER_ID }/time-entries`)
        .replyWithError({ message: 'ignored', body: { message: 'Invalid start', code: 4001 } })

      await expect(service.addTimeEntry(WS, 'bad')).rejects.toThrow(
        'Clockify API error: Invalid start (code 4001)'
      )
    })
  })

  describe('startTimer', () => {
    it('posts a start time with no end and required params only', async () => {
      stubUser()
      mock
        .onPost(`${ BASE }/workspaces/${ WS }/user/${ USER_ID }/time-entries`)
        .reply({ id: 'timer-1' })

      const result = await service.startTimer(WS)

      expect(result).toEqual({ id: 'timer-1' })
      const body = mock.history[1].body
      expect(body).toHaveProperty('start')
      expect(typeof body.start).toBe('string')
      expect(body).not.toHaveProperty('end')
      expect(body).not.toHaveProperty('description')
    })

    it('includes optional params when provided', async () => {
      stubUser()
      mock
        .onPost(`${ BASE }/workspaces/${ WS }/user/${ USER_ID }/time-entries`)
        .reply({ id: 'timer-2' })

      await service.startTimer(WS, 'Writing docs', 'proj-1', 'task-1', ['tag-1'], false)

      const body = mock.history[1].body
      expect(body).toMatchObject({
        description: 'Writing docs',
        projectId: 'proj-1',
        taskId: 'task-1',
        tagIds: ['tag-1'],
        billable: false,
      })
      expect(body).toHaveProperty('start')
    })
  })

  describe('stopTimer', () => {
    it('patches the running entry with an end time', async () => {
      stubUser()
      mock
        .onPatch(`${ BASE }/workspaces/${ WS }/user/${ USER_ID }/time-entries`)
        .reply({ id: 'timer-1', timeInterval: { end: '2024-01-15T11:15:00Z' } })

      const result = await service.stopTimer(WS)

      expect(result).toHaveProperty('id', 'timer-1')
      expect(mock.history[1].method).toBe('patch')
      expect(mock.history[1].url).toBe(`${ BASE }/workspaces/${ WS }/user/${ USER_ID }/time-entries`)
      expect(mock.history[1].body).toHaveProperty('end')
      expect(typeof mock.history[1].body.end).toBe('string')
    })

    it('throws a wrapped error when no timer is running', async () => {
      stubUser()
      mock
        .onPatch(`${ BASE }/workspaces/${ WS }/user/${ USER_ID }/time-entries`)
        .replyWithError({ message: 'No running timer' })

      await expect(service.stopTimer(WS)).rejects.toThrow('Clockify API error: No running timer')
    })
  })

  describe('getTimeEntry', () => {
    it('fetches a single entry from the workspace-scoped route (no user lookup)', async () => {
      mock
        .onGet(`${ BASE }/workspaces/${ WS }/time-entries/te-1`)
        .reply({ id: 'te-1', description: 'Design review' })

      const result = await service.getTimeEntry(WS, 'te-1')

      expect(result).toEqual({ id: 'te-1', description: 'Design review' })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/workspaces/${ WS }/time-entries/te-1`)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/workspaces/${ WS }/time-entries/te-1`).replyWithError({ message: 'Not found' })

      await expect(service.getTimeEntry(WS, 'te-1')).rejects.toThrow('Clockify API error: Not found')
    })
  })

  describe('listTimeEntries', () => {
    it('lists via the user-scoped route with default pagination', async () => {
      stubUser()
      mock.onGet(`${ BASE }/workspaces/${ WS }/user/${ USER_ID }/time-entries`).reply([])

      const result = await service.listTimeEntries(WS)

      expect(result).toEqual([])
      expect(mock.history[1].url).toBe(`${ BASE }/workspaces/${ WS }/user/${ USER_ID }/time-entries`)
      expect(mock.history[1].query).toEqual({ page: 1, 'page-size': 50 })
    })

    it('passes range, project filter, hydrated and pagination', async () => {
      stubUser()
      mock.onGet(`${ BASE }/workspaces/${ WS }/user/${ USER_ID }/time-entries`).reply([])

      await service.listTimeEntries(WS, '2024-01-01T00:00:00Z', '2024-01-31T23:59:59Z', 'proj-1', true, 2, 25)

      expect(mock.history[1].query).toEqual({
        start: '2024-01-01T00:00:00Z',
        end: '2024-01-31T23:59:59Z',
        project: 'proj-1',
        hydrated: true,
        page: 2,
        'page-size': 25,
      })
    })
  })

  describe('updateTimeEntry', () => {
    it('puts to the workspace-scoped route with required params only', async () => {
      mock
        .onPut(`${ BASE }/workspaces/${ WS }/time-entries/te-1`)
        .reply({ id: 'te-1' })

      const result = await service.updateTimeEntry(WS, 'te-1', '2024-01-15T08:00:00Z')

      expect(result).toEqual({ id: 'te-1' })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].url).toBe(`${ BASE }/workspaces/${ WS }/time-entries/te-1`)
      expect(mock.history[0].body).toEqual({ start: '2024-01-15T08:00:00Z' })
    })

    it('includes all optional params when provided', async () => {
      mock.onPut(`${ BASE }/workspaces/${ WS }/time-entries/te-1`).reply({ id: 'te-1' })

      await service.updateTimeEntry(
        WS,
        'te-1',
        '2024-01-15T08:00:00Z',
        '2024-01-15T10:00:00Z',
        'Updated',
        'proj-1',
        'task-1',
        ['tag-1'],
        false
      )

      expect(mock.history[0].body).toEqual({
        start: '2024-01-15T08:00:00Z',
        end: '2024-01-15T10:00:00Z',
        description: 'Updated',
        projectId: 'proj-1',
        taskId: 'task-1',
        tagIds: ['tag-1'],
        billable: false,
      })
    })
  })

  describe('deleteTimeEntry', () => {
    it('deletes and returns a success shape', async () => {
      mock.onDelete(`${ BASE }/workspaces/${ WS }/time-entries/te-1`).reply(undefined)

      const result = await service.deleteTimeEntry(WS, 'te-1')

      expect(result).toEqual({ success: true, id: 'te-1' })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${ BASE }/workspaces/${ WS }/time-entries/te-1`)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onDelete(`${ BASE }/workspaces/${ WS }/time-entries/te-1`).replyWithError({ message: 'Boom' })

      await expect(service.deleteTimeEntry(WS, 'te-1')).rejects.toThrow('Clockify API error: Boom')
    })
  })

  // ── Projects ──

  describe('listProjects', () => {
    it('lists with default pagination', async () => {
      mock.onGet(`${ BASE }/workspaces/${ WS }/projects`).reply([])

      const result = await service.listProjects(WS)

      expect(result).toEqual([])
      expect(mock.history[0].url).toBe(`${ BASE }/workspaces/${ WS }/projects`)
      expect(mock.history[0].query).toEqual({ page: 1, 'page-size': 50 })
    })

    it('passes name filter, archived flag and pagination', async () => {
      mock.onGet(`${ BASE }/workspaces/${ WS }/projects`).reply([])

      await service.listProjects(WS, 'Web', true, 3, 10)

      expect(mock.history[0].query).toEqual({
        name: 'Web',
        archived: true,
        page: 3,
        'page-size': 10,
      })
    })
  })

  describe('getProject', () => {
    it('fetches a single project by id', async () => {
      mock.onGet(`${ BASE }/workspaces/${ WS }/projects/proj-1`).reply({ id: 'proj-1' })

      const result = await service.getProject(WS, 'proj-1')

      expect(result).toEqual({ id: 'proj-1' })
      expect(mock.history[0].url).toBe(`${ BASE }/workspaces/${ WS }/projects/proj-1`)
    })
  })

  describe('createProject', () => {
    it('posts required params only', async () => {
      mock.onPost(`${ BASE }/workspaces/${ WS }/projects`).reply({ id: 'proj-1' })

      const result = await service.createProject(WS, 'Website Redesign')

      expect(result).toEqual({ id: 'proj-1' })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({ name: 'Website Redesign' })
    })

    it('maps a color label to its hex code and includes optional params', async () => {
      mock.onPost(`${ BASE }/workspaces/${ WS }/projects`).reply({ id: 'proj-2' })

      await service.createProject(WS, 'Mobile App', 'client-1', 'Green', true, true, 'Q1 initiative')

      expect(mock.history[0].body).toEqual({
        name: 'Mobile App',
        clientId: 'client-1',
        color: '#4CAF50',
        billable: true,
        isPublic: true,
        note: 'Q1 initiative',
      })
    })

    it('passes an unknown color through unchanged', async () => {
      mock.onPost(`${ BASE }/workspaces/${ WS }/projects`).reply({ id: 'proj-3' })

      await service.createProject(WS, 'Custom', undefined, '#123456')

      expect(mock.history[0].body).toEqual({ name: 'Custom', color: '#123456' })
    })
  })

  describe('updateProject', () => {
    it('puts an empty body when only ids are provided', async () => {
      mock.onPut(`${ BASE }/workspaces/${ WS }/projects/proj-1`).reply({ id: 'proj-1' })

      await service.updateProject(WS, 'proj-1')

      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].body).toEqual({})
    })

    it('includes all optional params and resolves the color', async () => {
      mock.onPut(`${ BASE }/workspaces/${ WS }/projects/proj-1`).reply({ id: 'proj-1' })

      await service.updateProject(WS, 'proj-1', 'Website v2', 'client-1', 'Orange', true, false, false, 'note')

      expect(mock.history[0].body).toEqual({
        name: 'Website v2',
        clientId: 'client-1',
        color: '#FF9800',
        billable: true,
        isPublic: false,
        archived: false,
        note: 'note',
      })
    })
  })

  describe('deleteProject', () => {
    it('deletes and returns a success shape', async () => {
      mock.onDelete(`${ BASE }/workspaces/${ WS }/projects/proj-1`).reply(undefined)

      const result = await service.deleteProject(WS, 'proj-1')

      expect(result).toEqual({ success: true, id: 'proj-1' })
      expect(mock.history[0].method).toBe('delete')
    })
  })

  // ── Tasks ──

  describe('listTasks', () => {
    it('lists tasks for a project with default pagination', async () => {
      mock.onGet(`${ BASE }/workspaces/${ WS }/projects/proj-1/tasks`).reply([])

      await service.listTasks(WS, 'proj-1')

      expect(mock.history[0].url).toBe(`${ BASE }/workspaces/${ WS }/projects/proj-1/tasks`)
      expect(mock.history[0].query).toEqual({ page: 1, 'page-size': 50 })
    })

    it('passes custom pagination', async () => {
      mock.onGet(`${ BASE }/workspaces/${ WS }/projects/proj-1/tasks`).reply([])

      await service.listTasks(WS, 'proj-1', 2, 100)

      expect(mock.history[0].query).toEqual({ page: 2, 'page-size': 100 })
    })
  })

  describe('createTask', () => {
    it('posts required params only', async () => {
      mock.onPost(`${ BASE }/workspaces/${ WS }/projects/proj-1/tasks`).reply({ id: 'task-1' })

      const result = await service.createTask(WS, 'proj-1', 'Homepage layout')

      expect(result).toEqual({ id: 'task-1' })
      expect(mock.history[0].body).toEqual({ name: 'Homepage layout' })
    })

    it('includes assignees and estimate, omits empty assignees', async () => {
      mock.onPost(`${ BASE }/workspaces/${ WS }/projects/proj-1/tasks`).reply({ id: 'task-2' })

      await service.createTask(WS, 'proj-1', 'API integration', ['user-1'], 'PT4H')

      expect(mock.history[0].body).toEqual({
        name: 'API integration',
        assigneeIds: ['user-1'],
        estimate: 'PT4H',
      })
    })

    it('omits an empty assignee array', async () => {
      mock.onPost(`${ BASE }/workspaces/${ WS }/projects/proj-1/tasks`).reply({ id: 'task-3' })

      await service.createTask(WS, 'proj-1', 'Solo task', [])

      expect(mock.history[0].body).toEqual({ name: 'Solo task' })
    })
  })

  describe('updateTask', () => {
    it('puts required params only', async () => {
      mock.onPut(`${ BASE }/workspaces/${ WS }/projects/proj-1/tasks/task-1`).reply({ id: 'task-1' })

      await service.updateTask(WS, 'proj-1', 'task-1', 'Homepage layout')

      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].body).toEqual({ name: 'Homepage layout' })
    })

    it('resolves the status label and includes optional params', async () => {
      mock.onPut(`${ BASE }/workspaces/${ WS }/projects/proj-1/tasks/task-1`).reply({ id: 'task-1' })

      await service.updateTask(WS, 'proj-1', 'task-1', 'Homepage layout', ['user-1'], 'PT4H', 'Done')

      expect(mock.history[0].body).toEqual({
        name: 'Homepage layout',
        assigneeIds: ['user-1'],
        estimate: 'PT4H',
        status: 'DONE',
      })
    })
  })

  describe('deleteTask', () => {
    it('deletes and returns a success shape', async () => {
      mock.onDelete(`${ BASE }/workspaces/${ WS }/projects/proj-1/tasks/task-1`).reply(undefined)

      const result = await service.deleteTask(WS, 'proj-1', 'task-1')

      expect(result).toEqual({ success: true, id: 'task-1' })
      expect(mock.history[0].method).toBe('delete')
    })
  })

  // ── Clients ──

  describe('listClients', () => {
    it('lists with default pagination', async () => {
      mock.onGet(`${ BASE }/workspaces/${ WS }/clients`).reply([])

      await service.listClients(WS)

      expect(mock.history[0].query).toEqual({ page: 1, 'page-size': 50 })
    })

    it('passes name filter and pagination', async () => {
      mock.onGet(`${ BASE }/workspaces/${ WS }/clients`).reply([])

      await service.listClients(WS, 'Acme', 2, 10)

      expect(mock.history[0].query).toEqual({ name: 'Acme', page: 2, 'page-size': 10 })
    })
  })

  describe('createClient', () => {
    it('posts required params only', async () => {
      mock.onPost(`${ BASE }/workspaces/${ WS }/clients`).reply({ id: 'client-1' })

      await service.createClient(WS, 'Acme Corp')

      expect(mock.history[0].body).toEqual({ name: 'Acme Corp' })
    })

    it('includes a note when provided', async () => {
      mock.onPost(`${ BASE }/workspaces/${ WS }/clients`).reply({ id: 'client-2' })

      await service.createClient(WS, 'Globex', 'New lead')

      expect(mock.history[0].body).toEqual({ name: 'Globex', note: 'New lead' })
    })
  })

  describe('updateClient', () => {
    it('puts name only', async () => {
      mock.onPut(`${ BASE }/workspaces/${ WS }/clients/client-1`).reply({ id: 'client-1' })

      await service.updateClient(WS, 'client-1', 'Acme Corporation')

      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].body).toEqual({ name: 'Acme Corporation' })
    })

    it('includes note and archived when provided', async () => {
      mock.onPut(`${ BASE }/workspaces/${ WS }/clients/client-1`).reply({ id: 'client-1' })

      await service.updateClient(WS, 'client-1', 'Acme', 'Retainer', true)

      expect(mock.history[0].body).toEqual({ name: 'Acme', note: 'Retainer', archived: true })
    })
  })

  describe('deleteClient', () => {
    it('deletes and returns a success shape', async () => {
      mock.onDelete(`${ BASE }/workspaces/${ WS }/clients/client-1`).reply(undefined)

      const result = await service.deleteClient(WS, 'client-1')

      expect(result).toEqual({ success: true, id: 'client-1' })
      expect(mock.history[0].method).toBe('delete')
    })
  })

  // ── Tags ──

  describe('listTags', () => {
    it('lists with default pagination', async () => {
      mock.onGet(`${ BASE }/workspaces/${ WS }/tags`).reply([])

      await service.listTags(WS)

      expect(mock.history[0].query).toEqual({ page: 1, 'page-size': 50 })
    })

    it('passes name filter and pagination', async () => {
      mock.onGet(`${ BASE }/workspaces/${ WS }/tags`).reply([])

      await service.listTags(WS, 'Billable', 2, 20)

      expect(mock.history[0].query).toEqual({ name: 'Billable', page: 2, 'page-size': 20 })
    })
  })

  describe('createTag', () => {
    it('posts the tag name', async () => {
      mock.onPost(`${ BASE }/workspaces/${ WS }/tags`).reply({ id: 'tag-1' })

      const result = await service.createTag(WS, 'Urgent')

      expect(result).toEqual({ id: 'tag-1' })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({ name: 'Urgent' })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/workspaces/${ WS }/tags`).replyWithError({ message: 'Boom' })

      await expect(service.createTag(WS, 'Urgent')).rejects.toThrow('Clockify API error: Boom')
    })
  })

  // ── Users ──

  describe('getCurrentUser', () => {
    it('fetches the authenticated user from the /user route', async () => {
      mock.onGet(`${ BASE }/user`).reply({ id: USER_ID, email: 'jane@example.com' })

      const result = await service.getCurrentUser()

      expect(result).toEqual({ id: USER_ID, email: 'jane@example.com' })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].url).toBe(`${ BASE }/user`)
    })
  })

  describe('listWorkspaceUsers', () => {
    it('lists members with default pagination', async () => {
      mock.onGet(`${ BASE }/workspaces/${ WS }/users`).reply([])

      await service.listWorkspaceUsers(WS)

      expect(mock.history[0].query).toEqual({ page: 1, 'page-size': 50 })
    })

    it('passes name, email and pagination filters', async () => {
      mock.onGet(`${ BASE }/workspaces/${ WS }/users`).reply([])

      await service.listWorkspaceUsers(WS, 'Jane', 'jane@example.com', 2, 15)

      expect(mock.history[0].query).toEqual({
        name: 'Jane',
        email: 'jane@example.com',
        page: 2,
        'page-size': 15,
      })
    })
  })

  // ── Reports (separate reports host) ──

  describe('generateSummaryReport', () => {
    it('posts to the reports host with a default Project grouping', async () => {
      mock
        .onPost(`${ REPORTS_BASE }/workspaces/${ WS }/reports/summary`)
        .reply({ totals: [], groupOne: [] })

      const result = await service.generateSummaryReport(WS, '2024-01-01T00:00:00Z', '2024-01-31T23:59:59Z')

      expect(result).toEqual({ totals: [], groupOne: [] })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ REPORTS_BASE }/workspaces/${ WS }/reports/summary`)
      expect(mock.history[0].body).toEqual({
        dateRangeStart: '2024-01-01T00:00:00Z',
        dateRangeEnd: '2024-01-31T23:59:59Z',
        summaryFilter: { groups: ['PROJECT'] },
      })
    })

    it('resolves group labels to Clockify enum values in order', async () => {
      mock.onPost(`${ REPORTS_BASE }/workspaces/${ WS }/reports/summary`).reply({ totals: [] })

      await service.generateSummaryReport(
        WS,
        '2024-01-01T00:00:00Z',
        '2024-01-31T23:59:59Z',
        ['Project', 'Task', 'User']
      )

      expect(mock.history[0].body.summaryFilter).toEqual({ groups: ['PROJECT', 'TASK', 'USER'] })
    })

    it('does not hit the working API host', async () => {
      mock.onPost(`${ REPORTS_BASE }/workspaces/${ WS }/reports/summary`).reply({ totals: [] })

      await service.generateSummaryReport(WS, '2024-01-01T00:00:00Z', '2024-01-31T23:59:59Z')

      expect(mock.history[0].url.startsWith(REPORTS_BASE)).toBe(true)
      expect(mock.history[0].url.startsWith(BASE)).toBe(false)
    })
  })

  // ── Dictionaries ──

  describe('getWorkspacesDictionary', () => {
    const workspaces = [
      { id: 'ws-1', name: 'Acme Workspace' },
      { id: 'ws-2', name: 'Globex Workspace' },
    ]

    it('maps workspaces to items and hits the /workspaces route', async () => {
      mock.onGet(`${ BASE }/workspaces`).reply(workspaces)

      const result = await service.getWorkspacesDictionary({})

      expect(mock.history[0].url).toBe(`${ BASE }/workspaces`)
      expect(result).toEqual({
        items: [
          { label: 'Acme Workspace', value: 'ws-1', note: 'Workspace' },
          { label: 'Globex Workspace', value: 'ws-2', note: 'Workspace' },
        ],
        cursor: null,
      })
    })

    it('filters by search term (case-insensitive)', async () => {
      mock.onGet(`${ BASE }/workspaces`).reply(workspaces)

      const result = await service.getWorkspacesDictionary({ search: 'globex' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('ws-2')
    })

    it('handles a null payload', async () => {
      mock.onGet(`${ BASE }/workspaces`).reply(workspaces)

      const result = await service.getWorkspacesDictionary(null)

      expect(result.items).toHaveLength(2)
    })
  })

  describe('getProjectsDictionary', () => {
    it('returns empty items without a workspace id and makes no request', async () => {
      const result = await service.getProjectsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
      expect(mock.history).toHaveLength(0)
    })

    it('maps projects to items with clientName as note and next-page cursor', async () => {
      const projects = Array.from({ length: 50 }, (_, i) => ({
        id: `proj-${ i }`,
        name: `Project ${ i }`,
        clientName: i === 0 ? 'Acme' : undefined,
      }))
      mock.onGet(`${ BASE }/workspaces/${ WS }/projects`).reply(projects)

      const result = await service.getProjectsDictionary({ criteria: { workspaceId: WS } })

      expect(mock.history[0].query).toEqual({ page: 1, 'page-size': 50 })
      expect(result.items[0]).toEqual({ label: 'Project 0', value: 'proj-0', note: 'Acme' })
      expect(result.items[1].note).toBeUndefined()
      // A full page of 50 signals there may be more.
      expect(result.cursor).toBe('2')
    })

    it('passes the search term as name and returns a null cursor on a short page', async () => {
      mock.onGet(`${ BASE }/workspaces/${ WS }/projects`).reply([{ id: 'proj-1', name: 'Web' }])

      const result = await service.getProjectsDictionary({
        search: 'Web',
        criteria: { workspaceId: WS },
      })

      expect(mock.history[0].query).toMatchObject({ name: 'Web', page: 1, 'page-size': 50 })
      expect(result.cursor).toBeNull()
    })

    it('uses the cursor as the page number', async () => {
      mock.onGet(`${ BASE }/workspaces/${ WS }/projects`).reply([])

      await service.getProjectsDictionary({ cursor: '3', criteria: { workspaceId: WS } })

      expect(mock.history[0].query).toMatchObject({ page: 3 })
    })
  })

  describe('getClientsDictionary', () => {
    it('returns empty items without a workspace id and makes no request', async () => {
      const result = await service.getClientsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
      expect(mock.history).toHaveLength(0)
    })

    it('maps clients to items with a Client note', async () => {
      mock
        .onGet(`${ BASE }/workspaces/${ WS }/clients`)
        .reply([{ id: 'client-1', name: 'Acme Corp' }])

      const result = await service.getClientsDictionary({ criteria: { workspaceId: WS } })

      expect(result.items).toEqual([{ label: 'Acme Corp', value: 'client-1', note: 'Client' }])
      expect(result.cursor).toBeNull()
    })

    it('passes the search term and uses the cursor as page', async () => {
      mock.onGet(`${ BASE }/workspaces/${ WS }/clients`).reply([])

      await service.getClientsDictionary({ search: 'Acme', cursor: '2', criteria: { workspaceId: WS } })

      expect(mock.history[0].query).toMatchObject({ name: 'Acme', page: 2, 'page-size': 50 })
    })
  })

  describe('getTagsDictionary', () => {
    it('returns empty items without a workspace id and makes no request', async () => {
      const result = await service.getTagsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
      expect(mock.history).toHaveLength(0)
    })

    it('maps tags to items with a Tag note', async () => {
      mock.onGet(`${ BASE }/workspaces/${ WS }/tags`).reply([{ id: 'tag-1', name: 'Billable' }])

      const result = await service.getTagsDictionary({ criteria: { workspaceId: WS } })

      expect(result.items).toEqual([{ label: 'Billable', value: 'tag-1', note: 'Tag' }])
      expect(result.cursor).toBeNull()
    })

    it('returns a next-page cursor on a full page', async () => {
      const tags = Array.from({ length: 50 }, (_, i) => ({ id: `tag-${ i }`, name: `Tag ${ i }` }))
      mock.onGet(`${ BASE }/workspaces/${ WS }/tags`).reply(tags)

      const result = await service.getTagsDictionary({ criteria: { workspaceId: WS } })

      expect(result.cursor).toBe('2')
    })

    it('handles a null payload as a missing workspace', async () => {
      const result = await service.getTagsDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
      expect(mock.history).toHaveLength(0)
    })
  })
})
