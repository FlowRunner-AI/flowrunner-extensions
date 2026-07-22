'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_TOKEN = 'test-api-token'
const BASE = 'https://api.track.toggl.com/api/v9'
const AUTH_HEADER = `Basic ${ Buffer.from(`${ API_TOKEN }:api_token`).toString('base64') }`
const WID = '987654'

describe('Toggl Track Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ apiToken: API_TOKEN })
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
      expect(sandbox.getConfigItems()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'apiToken', required: true, shared: false }),
        ])
      )
    })
  })

  // ── Time Entries ──

  describe('createTimeEntry', () => {
    it('sends POST with correct body and defaults', async () => {
      mock.onGet(`${BASE}/me`).reply({ default_workspace_id: WID })
      mock.onPost(`${BASE}/workspaces/${WID}/time_entries`).reply({ id: 1, description: 'Test' })

      const result = await service.createTimeEntry(undefined, 'Test')

      expect(result).toEqual({ id: 1, description: 'Test' })
      // First call resolves workspace, second creates entry
      expect(mock.history).toHaveLength(2)
      expect(mock.history[1].headers).toMatchObject({ 'Authorization': AUTH_HEADER })
      expect(mock.history[1].body).toMatchObject({
        workspace_id: Number(WID),
        description: 'Test',
        duration: -1,
        created_with: 'FlowRunner',
      })
      expect(mock.history[1].body.start).toBeDefined()
    })

    it('uses provided workspaceId without resolving', async () => {
      mock.onPost(`${BASE}/workspaces/${WID}/time_entries`).reply({ id: 2 })

      await service.createTimeEntry(WID, 'Task', '2026-07-14T09:00:00Z', 3600, '2026-07-14T10:00:00Z', '111', 222, ['33', '44'], true)

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].body).toEqual({
        workspace_id: Number(WID),
        description: 'Task',
        start: '2026-07-14T09:00:00Z',
        duration: 3600,
        stop: '2026-07-14T10:00:00Z',
        project_id: 111,
        task_id: 222,
        tag_ids: [33, 44],
        billable: true,
        created_with: 'FlowRunner',
      })
    })

    it('omits optional fields when not provided', async () => {
      mock.onPost(`${BASE}/workspaces/${WID}/time_entries`).reply({ id: 3 })

      await service.createTimeEntry(WID, undefined)

      const body = mock.history[0].body
      expect(body).not.toHaveProperty('project_id')
      expect(body).not.toHaveProperty('task_id')
      expect(body).not.toHaveProperty('tag_ids')
      expect(body).not.toHaveProperty('stop')
    })

    it('throws on API error', async () => {
      mock.onPost(`${BASE}/workspaces/${WID}/time_entries`).replyWithError({
        message: 'Bad Request',
        body: 'Invalid duration',
      })

      await expect(service.createTimeEntry(WID, 'Fail')).rejects.toThrow('Toggl Track API error: Invalid duration')
    })
  })

  describe('startTimer', () => {
    it('sends POST with duration -1 and current start time', async () => {
      mock.onPost(`${BASE}/workspaces/${WID}/time_entries`).reply({ id: 10, duration: -1 })

      const result = await service.startTimer(WID, 'Working', '111', null, ['55'], false)

      expect(result).toEqual({ id: 10, duration: -1 })
      expect(mock.history[0].body).toMatchObject({
        workspace_id: Number(WID),
        description: 'Working',
        duration: -1,
        project_id: 111,
        billable: false,
      })
      expect(mock.history[0].body.start).toBeDefined()
    })

    it('omits optional fields', async () => {
      mock.onPost(`${BASE}/workspaces/${WID}/time_entries`).reply({ id: 11 })

      await service.startTimer(WID)

      const body = mock.history[0].body
      expect(body.duration).toBe(-1)
      expect(body).not.toHaveProperty('project_id')
      expect(body).not.toHaveProperty('task_id')
      expect(body).not.toHaveProperty('tag_ids')
    })
  })

  describe('stopTimer', () => {
    it('sends PATCH to stop endpoint', async () => {
      mock.onPatch(`${BASE}/workspaces/${WID}/time_entries/123/stop`).reply({ id: 123, duration: 4500 })

      const result = await service.stopTimer(WID, 123)

      expect(result).toEqual({ id: 123, duration: 4500 })
      expect(mock.history[0].method).toBe('patch')
    })
  })

  describe('getCurrentRunningEntry', () => {
    it('sends GET to current endpoint', async () => {
      mock.onGet(`${BASE}/me/time_entries/current`).reply({ id: 100, duration: -1 })

      const result = await service.getCurrentRunningEntry()

      expect(result).toEqual({ id: 100, duration: -1 })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({ 'Authorization': AUTH_HEADER })
    })

    it('returns null when nothing is running', async () => {
      mock.onGet(`${BASE}/me/time_entries/current`).reply(null)

      const result = await service.getCurrentRunningEntry()

      expect(result).toBeNull()
    })
  })

  describe('getTimeEntry', () => {
    it('sends GET with time entry ID', async () => {
      mock.onGet(`${BASE}/me/time_entries/456`).reply({ id: 456, description: 'Review' })

      const result = await service.getTimeEntry(456)

      expect(result).toEqual({ id: 456, description: 'Review' })
    })
  })

  describe('listTimeEntries', () => {
    it('sends GET with date range query params', async () => {
      mock.onGet(`${BASE}/me/time_entries`).reply([{ id: 1 }, { id: 2 }])

      const result = await service.listTimeEntries('2026-07-01', '2026-07-14')

      expect(result).toHaveLength(2)
      expect(mock.history[0].query).toMatchObject({
        start_date: '2026-07-01',
        end_date: '2026-07-14',
      })
    })

    it('sends GET without date params when omitted', async () => {
      mock.onGet(`${BASE}/me/time_entries`).reply([])

      await service.listTimeEntries()

      expect(mock.history[0].query).toEqual({})
    })
  })

  describe('updateTimeEntry', () => {
    it('sends PUT with all provided fields', async () => {
      mock.onPut(`${BASE}/workspaces/${WID}/time_entries/789`).reply({ id: 789, description: 'Updated' })

      await service.updateTimeEntry(WID, 789, 'Updated', '2026-07-14T09:00:00Z', '2026-07-14T10:00:00Z', 3600, '111', 222, ['33'], true)

      expect(mock.history[0].body).toEqual({
        workspace_id: Number(WID),
        description: 'Updated',
        start: '2026-07-14T09:00:00Z',
        stop: '2026-07-14T10:00:00Z',
        duration: 3600,
        project_id: 111,
        task_id: 222,
        tag_ids: [33],
        billable: true,
      })
    })

    it('omits undefined optional fields', async () => {
      mock.onPut(`${BASE}/workspaces/${WID}/time_entries/789`).reply({ id: 789 })

      await service.updateTimeEntry(WID, 789, 'Only desc')

      const body = mock.history[0].body
      expect(body).toMatchObject({ workspace_id: Number(WID), description: 'Only desc' })
      expect(body).not.toHaveProperty('duration')
      expect(body).not.toHaveProperty('project_id')
      expect(body).not.toHaveProperty('tag_ids')
    })
  })

  describe('deleteTimeEntry', () => {
    it('sends DELETE and returns success object', async () => {
      mock.onDelete(`${BASE}/workspaces/${WID}/time_entries/999`).reply({})

      const result = await service.deleteTimeEntry(WID, 999)

      expect(result).toEqual({ success: true, timeEntryId: 999 })
    })
  })

  // ── Projects ──

  describe('listProjects', () => {
    it('sends GET with no active filter for All', async () => {
      mock.onGet(`${BASE}/workspaces/${WID}/projects`).reply([{ id: 1, name: 'P1' }])

      await service.listProjects(WID, 'All')

      expect(mock.history[0].query).toEqual({})
    })

    it('sends active=true for Active Only', async () => {
      mock.onGet(`${BASE}/workspaces/${WID}/projects`).reply([])

      await service.listProjects(WID, 'Active Only')

      expect(mock.history[0].query).toMatchObject({ active: 'true' })
    })

    it('sends active=false for Archived Only', async () => {
      mock.onGet(`${BASE}/workspaces/${WID}/projects`).reply([])

      await service.listProjects(WID, 'Archived Only')

      expect(mock.history[0].query).toMatchObject({ active: 'false' })
    })
  })

  describe('getProject', () => {
    it('sends GET with project ID', async () => {
      mock.onGet(`${BASE}/workspaces/${WID}/projects/111`).reply({ id: 111, name: 'Proj' })

      const result = await service.getProject(WID, 111)

      expect(result).toEqual({ id: 111, name: 'Proj' })
    })
  })

  describe('createProject', () => {
    it('sends POST with all fields', async () => {
      mock.onPost(`${BASE}/workspaces/${WID}/projects`).reply({ id: 200, name: 'New' })

      await service.createProject(WID, 'New', '55', '#0b83d9', true, false, true)

      expect(mock.history[0].body).toEqual({
        name: 'New',
        client_id: 55,
        color: '#0b83d9',
        active: true,
        billable: false,
        is_private: true,
      })
    })

    it('omits optional fields when not provided', async () => {
      mock.onPost(`${BASE}/workspaces/${WID}/projects`).reply({ id: 201 })

      await service.createProject(WID, 'Min')

      const body = mock.history[0].body
      expect(body).toEqual({ name: 'Min' })
    })
  })

  describe('updateProject', () => {
    it('sends PUT with partial update', async () => {
      mock.onPut(`${BASE}/workspaces/${WID}/projects/200`).reply({ id: 200, name: 'Renamed' })

      await service.updateProject(WID, 200, 'Renamed')

      expect(mock.history[0].body).toEqual({ name: 'Renamed' })
    })
  })

  describe('deleteProject', () => {
    it('sends DELETE and returns success', async () => {
      mock.onDelete(`${BASE}/workspaces/${WID}/projects/200`).reply({})

      const result = await service.deleteProject(WID, 200)

      expect(result).toEqual({ success: true, projectId: 200 })
    })
  })

  // ── Clients ──

  describe('listClients', () => {
    it('sends GET to clients endpoint', async () => {
      mock.onGet(`${BASE}/workspaces/${WID}/clients`).reply([{ id: 1, name: 'Acme' }])

      const result = await service.listClients(WID)

      expect(result).toEqual([{ id: 1, name: 'Acme' }])
    })
  })

  describe('createClient', () => {
    it('sends POST with name and wid', async () => {
      mock.onPost(`${BASE}/workspaces/${WID}/clients`).reply({ id: 300, name: 'NewClient' })

      await service.createClient(WID, 'NewClient')

      expect(mock.history[0].body).toEqual({ name: 'NewClient', wid: Number(WID) })
    })
  })

  describe('updateClient', () => {
    it('sends PUT with new name', async () => {
      mock.onPut(`${BASE}/workspaces/${WID}/clients/300`).reply({ id: 300, name: 'Renamed' })

      await service.updateClient(WID, 300, 'Renamed')

      expect(mock.history[0].body).toEqual({ name: 'Renamed', wid: Number(WID) })
    })
  })

  describe('deleteClient', () => {
    it('sends DELETE and returns success', async () => {
      mock.onDelete(`${BASE}/workspaces/${WID}/clients/300`).reply({})

      const result = await service.deleteClient(WID, 300)

      expect(result).toEqual({ success: true, clientId: 300 })
    })
  })

  // ── Tags ──

  describe('listTags', () => {
    it('sends GET to tags endpoint', async () => {
      mock.onGet(`${BASE}/workspaces/${WID}/tags`).reply([{ id: 55, name: 'design' }])

      const result = await service.listTags(WID)

      expect(result).toEqual([{ id: 55, name: 'design' }])
    })
  })

  describe('createTag', () => {
    it('sends POST with name and workspace_id', async () => {
      mock.onPost(`${BASE}/workspaces/${WID}/tags`).reply({ id: 56, name: 'dev' })

      await service.createTag(WID, 'dev')

      expect(mock.history[0].body).toEqual({ name: 'dev', workspace_id: Number(WID) })
    })
  })

  describe('updateTag', () => {
    it('sends PUT with new name', async () => {
      mock.onPut(`${BASE}/workspaces/${WID}/tags/56`).reply({ id: 56, name: 'development' })

      await service.updateTag(WID, 56, 'development')

      expect(mock.history[0].body).toEqual({ name: 'development' })
    })
  })

  describe('deleteTag', () => {
    it('sends DELETE and returns success', async () => {
      mock.onDelete(`${BASE}/workspaces/${WID}/tags/56`).reply({})

      const result = await service.deleteTag(WID, 56)

      expect(result).toEqual({ success: true, tagId: 56 })
    })
  })

  // ── Tasks ──

  describe('listTasks', () => {
    it('sends GET to tasks endpoint', async () => {
      mock.onGet(`${BASE}/workspaces/${WID}/projects/111/tasks`).reply([{ id: 400, name: 'Wire' }])

      const result = await service.listTasks(WID, 111)

      expect(result).toEqual([{ id: 400, name: 'Wire' }])
    })
  })

  describe('createTask', () => {
    it('sends POST with all fields', async () => {
      mock.onPost(`${BASE}/workspaces/${WID}/projects/111/tasks`).reply({ id: 401, name: 'NewTask' })

      await service.createTask(WID, 111, 'NewTask', 3600, true)

      expect(mock.history[0].body).toEqual({ name: 'NewTask', estimated_seconds: 3600, active: true })
    })

    it('omits optional fields', async () => {
      mock.onPost(`${BASE}/workspaces/${WID}/projects/111/tasks`).reply({ id: 402 })

      await service.createTask(WID, 111, 'MinTask')

      expect(mock.history[0].body).toEqual({ name: 'MinTask' })
    })
  })

  describe('updateTask', () => {
    it('sends PUT with partial update', async () => {
      mock.onPut(`${BASE}/workspaces/${WID}/projects/111/tasks/401`).reply({ id: 401, name: 'Updated' })

      await service.updateTask(WID, 111, 401, 'Updated', 7200, false)

      expect(mock.history[0].body).toEqual({ name: 'Updated', estimated_seconds: 7200, active: false })
    })
  })

  describe('deleteTask', () => {
    it('sends DELETE and returns success', async () => {
      mock.onDelete(`${BASE}/workspaces/${WID}/projects/111/tasks/401`).reply({})

      const result = await service.deleteTask(WID, 111, 401)

      expect(result).toEqual({ success: true, taskId: 401 })
    })
  })

  // ── Workspace & User ──

  describe('getMe', () => {
    it('sends GET without related data by default', async () => {
      mock.onGet(`${BASE}/me`).reply({ id: 112233, email: 'user@test.com' })

      const result = await service.getMe()

      expect(result).toEqual({ id: 112233, email: 'user@test.com' })
      expect(mock.history[0].query).toEqual({})
    })

    it('includes with_related_data when true', async () => {
      mock.onGet(`${BASE}/me`).reply({ id: 112233, workspaces: [] })

      await service.getMe(true)

      expect(mock.history[0].query).toMatchObject({ with_related_data: true })
    })
  })

  describe('listWorkspaceUsers', () => {
    it('sends GET to users endpoint', async () => {
      mock.onGet(`${BASE}/workspaces/${WID}/users`).reply([{ id: 1, name: 'Jane' }])

      const result = await service.listWorkspaceUsers(WID)

      expect(result).toEqual([{ id: 1, name: 'Jane' }])
    })
  })

  describe('getWorkspace', () => {
    it('sends GET with workspace ID', async () => {
      mock.onGet(`${BASE}/workspaces/${WID}`).reply({ id: Number(WID), name: 'My WS' })

      const result = await service.getWorkspace(WID)

      expect(result).toEqual({ id: Number(WID), name: 'My WS' })
    })
  })

  // ── Dictionaries ──

  describe('getWorkspacesDictionary', () => {
    it('returns mapped items with label and value', async () => {
      mock.onGet(`${BASE}/workspaces`).reply([
        { id: 1, name: 'WS Alpha' },
        { id: 2, name: 'WS Beta' },
      ])

      const result = await service.getWorkspacesDictionary({})

      expect(result).toEqual({
        items: [
          { label: 'WS Alpha', value: '1', note: 'Workspace ID 1' },
          { label: 'WS Beta', value: '2', note: 'Workspace ID 2' },
        ],
        cursor: null,
      })
    })

    it('filters by case-insensitive search', async () => {
      mock.onGet(`${BASE}/workspaces`).reply([
        { id: 1, name: 'Alpha' },
        { id: 2, name: 'Beta' },
      ])

      const result = await service.getWorkspacesDictionary({ search: 'alp' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('1')
    })

    it('handles null payload', async () => {
      mock.onGet(`${BASE}/workspaces`).reply([{ id: 1, name: 'A' }])

      const result = await service.getWorkspacesDictionary(null)

      expect(result.items).toHaveLength(1)
      expect(result.cursor).toBeNull()
    })

    it('handles empty data', async () => {
      mock.onGet(`${BASE}/workspaces`).reply(null)

      const result = await service.getWorkspacesDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getProjectsDictionary', () => {
    it('returns mapped projects with active/archived note', async () => {
      mock.onGet(`${BASE}/workspaces/${WID}/projects`).reply([
        { id: 10, name: 'Active Proj', active: true },
        { id: 20, name: 'Old Proj', active: false },
      ])

      const result = await service.getProjectsDictionary({ criteria: { workspaceId: WID } })

      expect(result.items).toEqual([
        { label: 'Active Proj', value: '10', note: 'Active' },
        { label: 'Old Proj', value: '20', note: 'Archived' },
      ])
    })

    it('resolves workspace from /me when criteria has no workspaceId', async () => {
      mock.onGet(`${BASE}/me`).reply({ default_workspace_id: WID })
      mock.onGet(`${BASE}/workspaces/${WID}/projects`).reply([])

      const result = await service.getProjectsDictionary({})

      expect(result.items).toEqual([])
      expect(mock.history).toHaveLength(2)
    })
  })

  describe('getClientsDictionary', () => {
    it('returns mapped clients', async () => {
      mock.onGet(`${BASE}/workspaces/${WID}/clients`).reply([
        { id: 30, name: 'Acme Corp' },
      ])

      const result = await service.getClientsDictionary({ criteria: { workspaceId: WID } })

      expect(result.items).toEqual([
        { label: 'Acme Corp', value: '30', note: 'Client ID 30' },
      ])
    })
  })

  describe('getTagsDictionary', () => {
    it('returns mapped tags', async () => {
      mock.onGet(`${BASE}/workspaces/${WID}/tags`).reply([
        { id: 55, name: 'design' },
      ])

      const result = await service.getTagsDictionary({ criteria: { workspaceId: WID } })

      expect(result.items).toEqual([
        { label: 'design', value: '55', note: 'Tag ID 55' },
      ])
    })

    it('filters tags by search', async () => {
      mock.onGet(`${BASE}/workspaces/${WID}/tags`).reply([
        { id: 55, name: 'design' },
        { id: 56, name: 'development' },
      ])

      const result = await service.getTagsDictionary({ search: 'DEV', criteria: { workspaceId: WID } })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('56')
    })
  })

  // ── Error Handling ──

  describe('error handling', () => {
    it('uses string error body when available', async () => {
      mock.onGet(`${BASE}/me`).replyWithError({
        message: 'Unauthorized',
        body: '  Invalid API token  ',
      })

      await expect(service.getMe()).rejects.toThrow('Toggl Track API error: Invalid API token')
    })

    it('uses error.body.message when body is object', async () => {
      mock.onGet(`${BASE}/me`).replyWithError({
        message: 'Server Error',
        body: { message: 'Internal failure' },
      })

      await expect(service.getMe()).rejects.toThrow('Toggl Track API error: Internal failure')
    })

    it('falls back to error.message when body is missing', async () => {
      mock.onGet(`${BASE}/me`).replyWithError({
        message: 'Network timeout',
      })

      await expect(service.getMe()).rejects.toThrow('Toggl Track API error: Network timeout')
    })

    it('throws when workspace cannot be resolved', async () => {
      mock.onGet(`${BASE}/me`).reply({})

      await expect(service.listClients()).rejects.toThrow('no workspace provided and no default workspace found')
    })
  })
})
