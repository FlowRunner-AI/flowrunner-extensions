'use strict'

const crypto = require('crypto')

const { createSandbox } = require('../../../service-sandbox')

const CLIENT_ID = 'test-client-id'
const CLIENT_SECRET = 'test-client-secret'
const ACCESS_TOKEN = 'test-access-token'
const BASE = 'https://api.clickup.com/api/v2'

describe('ClickUp Service', () => {
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
      expect(sandbox.getConfigItems()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'clientId', required: true, shared: true }),
          expect.objectContaining({ name: 'clientSecret', required: true, shared: true }),
        ])
      )
    })
  })

  // ── OAuth System Methods ──

  describe('getOAuth2ConnectionURL', () => {
    it('returns the correct authorization URL', async () => {
      const url = await service.getOAuth2ConnectionURL()

      expect(url).toContain('https://app.clickup.com/api')
      expect(url).toContain(`client_id=${ CLIENT_ID }`)
      expect(url).toContain('response_type=code')
    })
  })

  describe('executeCallback', () => {
    it('exchanges code for token and fetches user info', async () => {
      mock.onPost(`${ BASE }/oauth/token`).reply({ access_token: 'new-token' })
      mock.onGet(`${ BASE }/user`).reply({
        user: { id: 123, email: 'jane@example.com', username: 'Jane', profilePicture: 'https://img.png' },
      })

      const result = await service.executeCallback({ code: 'auth-code' })

      expect(result.token).toBe('new-token')
      expect(result.connectionIdentityName).toBe('jane@example.com')
      expect(result.connectionIdentityImageURL).toBe('https://img.png')
      expect(result.overwrite).toBe(true)
      expect(result.expirationInSeconds).toBeGreaterThan(0)

      // Verify token exchange request
      expect(mock.history[0].url).toBe(`${ BASE }/oauth/token`)
      expect(mock.history[0].body).toEqual({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code: 'auth-code',
      })
    })

    it('returns empty object on token exchange error', async () => {
      mock.onPost(`${ BASE }/oauth/token`).replyWithError({ message: 'Bad request' })

      const result = await service.executeCallback({ code: 'bad-code' })

      expect(result).toEqual({})
    })

    it('falls back to username when email is missing', async () => {
      mock.onPost(`${ BASE }/oauth/token`).reply({ access_token: 'tok' })
      mock.onGet(`${ BASE }/user`).reply({ user: { id: 1, username: 'Bob' } })

      const result = await service.executeCallback({ code: 'code' })

      expect(result.connectionIdentityName).toBe('Bob')
    })

    it('falls back to default name when user info fetch fails', async () => {
      mock.onPost(`${ BASE }/oauth/token`).reply({ access_token: 'tok' })
      mock.onGet(`${ BASE }/user`).replyWithError({ message: 'Unauthorized' })

      const result = await service.executeCallback({ code: 'code' })

      expect(result.connectionIdentityName).toBe('ClickUp Account')
    })
  })

  describe('refreshToken', () => {
    it('returns the existing token unchanged', async () => {
      const result = await service.refreshToken('old-refresh')

      expect(result.token).toBe(ACCESS_TOKEN)
      expect(result.expirationInSeconds).toBeGreaterThan(0)
    })
  })

  // ── Dictionaries ──

  describe('getWorkspacesDictionary', () => {
    it('returns workspace items', async () => {
      mock.onGet(`${ BASE }/team`).reply({
        teams: [
          { id: '111', name: 'WS One' },
          { id: '222', name: 'WS Two' },
        ],
      })

      const result = await service.getWorkspacesDictionary({})

      expect(result.items).toHaveLength(2)
      expect(result.items[0]).toEqual({ label: 'WS One', value: '111', note: 'ID: 111' })
    })

    it('filters by search string', async () => {
      mock.onGet(`${ BASE }/team`).reply({
        teams: [
          { id: '111', name: 'Alpha' },
          { id: '222', name: 'Beta' },
        ],
      })

      const result = await service.getWorkspacesDictionary({ search: 'alpha' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toBe('Alpha')
    })

    it('handles empty teams', async () => {
      mock.onGet(`${ BASE }/team`).reply({ teams: null })

      const result = await service.getWorkspacesDictionary({})

      expect(result.items).toEqual([])
    })
  })

  describe('getSpacesDictionary', () => {
    it('returns space items scoped by workspace', async () => {
      mock.onGet(`${ BASE }/team/ws1/space`).reply({
        spaces: [{ id: 's1', name: 'Dev' }],
      })

      const result = await service.getSpacesDictionary({ criteria: { workspaceId: 'ws1' } })

      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toEqual({ label: 'Dev', value: 's1', note: 'ID: s1' })
      expect(mock.history[0].query).toMatchObject({ archived: false })
    })
  })

  describe('getFoldersDictionary', () => {
    it('returns folder items scoped by space', async () => {
      mock.onGet(`${ BASE }/space/sp1/folder`).reply({
        folders: [{ id: 'f1', name: 'Folder A' }],
      })

      const result = await service.getFoldersDictionary({ criteria: { spaceId: 'sp1' } })

      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toEqual({ label: 'Folder A', value: 'f1', note: 'ID: f1' })
    })
  })

  describe('getListsDictionary', () => {
    it('returns lists from a folder when folderId is provided', async () => {
      mock.onGet(`${ BASE }/folder/f1/list`).reply({
        lists: [{ id: 'l1', name: 'Backlog' }],
      })

      const result = await service.getListsDictionary({ criteria: { spaceId: 'sp1', folderId: 'f1' } })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toBe('Backlog')
    })

    it('merges folderless and nested lists when no folderId', async () => {
      mock.onGet(`${ BASE }/space/sp1/list`).reply({
        lists: [{ id: 'l1', name: 'Folderless List' }],
      })
      mock.onGet(`${ BASE }/space/sp1/folder`).reply({
        folders: [
          { name: 'MyFolder', lists: [{ id: 'l2', name: 'Nested List' }] },
        ],
      })

      const result = await service.getListsDictionary({ criteria: { spaceId: 'sp1' } })

      expect(result.items).toHaveLength(2)
      expect(result.items[0].label).toBe('Folderless List')
      expect(result.items[1].label).toBe('Nested List (MyFolder)')
    })
  })

  describe('getChecklistsDictionary', () => {
    it('returns checklist items from a task', async () => {
      mock.onGet(`${ BASE }/task/t1`).reply({
        checklists: [{ id: 'cl1', name: 'DoD' }],
      })

      const result = await service.getChecklistsDictionary({ criteria: { taskId: 't1' } })

      expect(result.items).toEqual([{ label: 'DoD', value: 'cl1', note: 'ID: cl1' }])
    })
  })

  describe('getMembersDictionary', () => {
    it('returns members from matching workspace', async () => {
      mock.onGet(`${ BASE }/team`).reply({
        teams: [{
          id: 'ws1',
          members: [
            { user: { id: 1, username: 'Jane', email: 'jane@test.com' } },
            { user: { id: 2, username: 'Bob' } },
          ],
        }],
      })

      const result = await service.getMembersDictionary({ criteria: { workspaceId: 'ws1' } })

      expect(result.items).toHaveLength(2)
      expect(result.items[0].label).toBe('Jane (jane@test.com)')
      expect(result.items[1].label).toBe('Bob')
    })
  })

  describe('getTasksDictionary', () => {
    it('returns tasks with pagination cursor', async () => {
      mock.onGet(`${ BASE }/list/l1/task`).reply({
        tasks: [{ id: 't1', name: 'Task 1' }],
        last_page: false,
      })

      const result = await service.getTasksDictionary({ criteria: { listId: 'l1' } })

      expect(result.items).toEqual([{ label: 'Task 1', value: 't1', note: 'ID: t1' }])
      expect(result.cursor).toBe('1')
    })

    it('returns null cursor on last page', async () => {
      mock.onGet(`${ BASE }/list/l1/task`).reply({ tasks: [], last_page: true })

      const result = await service.getTasksDictionary({ criteria: { listId: 'l1' } })

      expect(result.cursor).toBeNull()
    })
  })

  describe('getStatusesDictionary', () => {
    it('returns statuses from a list', async () => {
      mock.onGet(`${ BASE }/list/l1`).reply({
        statuses: [{ status: 'to do', orderindex: 0 }],
      })

      const result = await service.getStatusesDictionary({ criteria: { listId: 'l1' } })

      expect(result.items).toEqual([{ label: 'to do', value: 'to do', note: 'Order: 0' }])
    })
  })

  describe('getCustomFieldsDictionary', () => {
    it('returns custom fields from a list', async () => {
      mock.onGet(`${ BASE }/list/l1/field`).reply({
        fields: [{ id: 'uuid-1', name: 'Priority Notes', type: 'text' }],
      })

      const result = await service.getCustomFieldsDictionary({ criteria: { listId: 'l1' } })

      expect(result.items).toEqual([{ label: 'Priority Notes', value: 'uuid-1', note: 'Type: text' }])
    })
  })

  describe('getSpaceTagsDictionary', () => {
    it('returns tags from a space', async () => {
      mock.onGet(`${ BASE }/space/sp1/tag`).reply({
        tags: [{ name: 'urgent' }, { name: 'bug' }],
      })

      const result = await service.getSpaceTagsDictionary({ criteria: { spaceId: 'sp1' } })

      expect(result.items).toHaveLength(2)
      expect(result.items[0]).toEqual({ label: 'urgent', value: 'urgent', note: 'Tag' })
    })
  })

  // ── Workspaces ──

  describe('getWorkspaces', () => {
    it('sends GET to /team with auth header', async () => {
      mock.onGet(`${ BASE }/team`).reply({ teams: [] })

      const result = await service.getWorkspaces()

      expect(result).toEqual({ teams: [] })
      expect(mock.history[0].headers).toMatchObject({ Authorization: ACCESS_TOKEN })
    })
  })

  // ── Spaces ──

  describe('getSpaces', () => {
    it('sends GET with archived query param', async () => {
      mock.onGet(`${ BASE }/team/ws1/space`).reply({ spaces: [] })

      await service.getSpaces('ws1', true)

      expect(mock.history[0].query).toMatchObject({ archived: true })
    })

    it('defaults archived to false', async () => {
      mock.onGet(`${ BASE }/team/ws1/space`).reply({ spaces: [] })

      await service.getSpaces('ws1')

      expect(mock.history[0].query).toMatchObject({ archived: false })
    })
  })

  describe('getSpace', () => {
    it('sends GET to /space/{id}', async () => {
      mock.onGet(`${ BASE }/space/sp1`).reply({ id: 'sp1', name: 'Dev' })

      const result = await service.getSpace('ws1', 'sp1')

      expect(result).toEqual({ id: 'sp1', name: 'Dev' })
    })
  })

  // ── Folders ──

  describe('getFolders', () => {
    it('sends GET to /space/{id}/folder', async () => {
      mock.onGet(`${ BASE }/space/sp1/folder`).reply({ folders: [] })

      await service.getFolders('ws1', 'sp1', false)

      expect(mock.history[0].url).toBe(`${ BASE }/space/sp1/folder`)
      expect(mock.history[0].query).toMatchObject({ archived: false })
    })
  })

  describe('createFolder', () => {
    it('sends POST with folder name', async () => {
      mock.onPost(`${ BASE }/space/sp1/folder`).reply({ id: 'f1', name: 'New Folder' })

      const result = await service.createFolder('ws1', 'sp1', 'New Folder')

      expect(result).toEqual({ id: 'f1', name: 'New Folder' })
      expect(mock.history[0].body).toEqual({ name: 'New Folder' })
    })
  })

  describe('deleteFolder', () => {
    it('sends DELETE to /folder/{id}', async () => {
      mock.onDelete(`${ BASE }/folder/f1`).reply({})

      await service.deleteFolder('ws1', 'sp1', 'f1')

      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${ BASE }/folder/f1`)
    })
  })

  describe('updateFolder', () => {
    it('sends PUT with new name', async () => {
      mock.onPut(`${ BASE }/folder/f1`).reply({ id: 'f1', name: 'Renamed' })

      const result = await service.updateFolder('ws1', 'sp1', 'f1', 'Renamed')

      expect(result.name).toBe('Renamed')
      expect(mock.history[0].body).toEqual({ name: 'Renamed' })
    })
  })

  // ── Lists ──

  describe('getLists', () => {
    it('fetches lists from folder when folderId provided', async () => {
      mock.onGet(`${ BASE }/folder/f1/list`).reply({ lists: [] })

      await service.getLists('ws1', 'sp1', 'f1', false)

      expect(mock.history[0].url).toBe(`${ BASE }/folder/f1/list`)
    })

    it('fetches folderless lists when no folderId', async () => {
      mock.onGet(`${ BASE }/space/sp1/list`).reply({ lists: [] })

      await service.getLists('ws1', 'sp1', undefined, false)

      expect(mock.history[0].url).toBe(`${ BASE }/space/sp1/list`)
    })
  })

  describe('createList', () => {
    it('creates list in folder when folderId provided', async () => {
      mock.onPost(`${ BASE }/folder/f1/list`).reply({ id: 'l1', name: 'My List' })

      await service.createList('ws1', 'sp1', 'f1', 'My List', 'desc')

      expect(mock.history[0].url).toBe(`${ BASE }/folder/f1/list`)
      expect(mock.history[0].body).toEqual({ name: 'My List', content: 'desc' })
    })

    it('creates folderless list when no folderId', async () => {
      mock.onPost(`${ BASE }/space/sp1/list`).reply({ id: 'l1', name: 'My List' })

      await service.createList('ws1', 'sp1', undefined, 'My List')

      expect(mock.history[0].url).toBe(`${ BASE }/space/sp1/list`)
      expect(mock.history[0].body).toEqual({ name: 'My List' })
    })

    it('omits content when not provided', async () => {
      mock.onPost(`${ BASE }/space/sp1/list`).reply({ id: 'l1' })

      await service.createList('ws1', 'sp1', undefined, 'No Content')

      expect(mock.history[0].body).toEqual({ name: 'No Content' })
    })
  })

  describe('getList', () => {
    it('sends GET to /list/{id}', async () => {
      mock.onGet(`${ BASE }/list/l1`).reply({ id: 'l1', name: 'Backlog' })

      const result = await service.getList('ws1', 'sp1', 'l1')

      expect(result).toEqual({ id: 'l1', name: 'Backlog' })
    })
  })

  describe('deleteList', () => {
    it('sends DELETE to /list/{id}', async () => {
      mock.onDelete(`${ BASE }/list/l1`).reply({})

      await service.deleteList('ws1', 'sp1', 'l1')

      expect(mock.history[0].method).toBe('delete')
    })
  })

  describe('updateList', () => {
    it('sends PUT with name and content', async () => {
      mock.onPut(`${ BASE }/list/l1`).reply({ id: 'l1', name: 'Updated' })

      await service.updateList('ws1', 'sp1', 'l1', 'Updated', 'New desc')

      expect(mock.history[0].body).toEqual({ name: 'Updated', content: 'New desc' })
    })

    it('omits content when empty string', async () => {
      mock.onPut(`${ BASE }/list/l1`).reply({ id: 'l1' })

      await service.updateList('ws1', 'sp1', 'l1', 'Name Only', '')

      expect(mock.history[0].body).toEqual({ name: 'Name Only' })
    })
  })

  // ── Tasks ──

  describe('getTasks', () => {
    it('sends GET with default query params', async () => {
      mock.onGet(`${ BASE }/list/l1/task`).reply({ tasks: [], last_page: true })

      await service.getTasks('ws1', 'sp1', 'l1')

      expect(mock.history[0].query).toMatchObject({
        page: 0,
        archived: false,
        include_closed: false,
      })
    })

    it('resolves order_by from friendly label', async () => {
      mock.onGet(`${ BASE }/list/l1/task`).reply({ tasks: [] })

      await service.getTasks('ws1', 'sp1', 'l1', 0, false, false, 'Date Created')

      expect(mock.history[0].query).toMatchObject({ order_by: 'created' })
    })

    it('includes subtasks query param when provided', async () => {
      mock.onGet(`${ BASE }/list/l1/task`).reply({ tasks: [] })

      await service.getTasks('ws1', 'sp1', 'l1', 0, false, false, undefined, true)

      expect(mock.history[0].query).toMatchObject({ subtasks: true })
    })
  })

  describe('getTask', () => {
    it('sends GET with subtask and markdown query params', async () => {
      mock.onGet(`${ BASE }/task/t1`).reply({ id: 't1', name: 'Task' })

      await service.getTask('ws1', 'sp1', 'l1', 't1', true, true)

      expect(mock.history[0].query).toMatchObject({
        include_subtasks: true,
        include_markdown_description: true,
      })
    })

    it('defaults boolean params to false', async () => {
      mock.onGet(`${ BASE }/task/t1`).reply({ id: 't1' })

      await service.getTask('ws1', 'sp1', 'l1', 't1')

      expect(mock.history[0].query).toMatchObject({
        include_subtasks: false,
        include_markdown_description: false,
      })
    })
  })

  describe('createTask', () => {
    it('sends POST with required name only', async () => {
      mock.onPost(`${ BASE }/list/l1/task`).reply({ id: 't1', name: 'Test' })

      await service.createTask('ws1', 'sp1', 'l1', 'Test')

      expect(mock.history[0].body).toEqual({ name: 'Test' })
    })

    it('sends POST with all optional fields', async () => {
      mock.onPost(`${ BASE }/list/l1/task`).reply({ id: 't1' })

      await service.createTask('ws1', 'sp1', 'l1', 'Full Task', 'Desc', 'in progress', 'High', 1700000000000, ['1', '2'], ['bug'], 'parent-id', true)

      expect(mock.history[0].body).toEqual({
        name: 'Full Task',
        description: 'Desc',
        status: 'in progress',
        priority: 2,
        due_date: 1700000000000,
        assignees: [1, 2],
        tags: ['bug'],
        parent: 'parent-id',
        notify_all: true,
      })
    })

    it('resolves priority from friendly label', async () => {
      mock.onPost(`${ BASE }/list/l1/task`).reply({ id: 't1' })

      await service.createTask('ws1', 'sp1', 'l1', 'Task', undefined, undefined, 'Urgent')

      expect(mock.history[0].body.priority).toBe(1)
    })
  })

  describe('updateTask', () => {
    it('sends PUT with only provided fields', async () => {
      mock.onPut(`${ BASE }/task/t1`).reply({ id: 't1' })

      await service.updateTask('ws1', 'sp1', 'l1', 't1', 'New Name')

      expect(mock.history[0].body).toEqual({ name: 'New Name' })
    })

    it('handles assignee add/remove', async () => {
      mock.onPut(`${ BASE }/task/t1`).reply({ id: 't1' })

      await service.updateTask('ws1', 'sp1', 'l1', 't1', undefined, undefined, undefined, undefined, undefined, undefined, ['10'], ['20'])

      expect(mock.history[0].body).toEqual({
        assignees: { add: [10], rem: [20] },
      })
    })

    it('includes time estimate and archived flag', async () => {
      mock.onPut(`${ BASE }/task/t1`).reply({ id: 't1' })

      await service.updateTask('ws1', 'sp1', 'l1', 't1', undefined, undefined, undefined, undefined, undefined, true, undefined, undefined, 3600000)

      expect(mock.history[0].body).toMatchObject({
        archived: true,
        time_estimate: 3600000,
      })
    })
  })

  describe('deleteTask', () => {
    it('sends DELETE to /task/{id}', async () => {
      mock.onDelete(`${ BASE }/task/t1`).reply({})

      await service.deleteTask('ws1', 'sp1', 'l1', 't1')

      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${ BASE }/task/t1`)
    })
  })

  // ── Comments ──

  describe('getTaskComments', () => {
    it('sends GET to /task/{id}/comment', async () => {
      mock.onGet(`${ BASE }/task/t1/comment`).reply({ comments: [] })

      const result = await service.getTaskComments('ws1', 'sp1', 'l1', 't1')

      expect(result).toEqual({ comments: [] })
    })
  })

  describe('createTaskComment', () => {
    it('sends POST with comment text and notify_all', async () => {
      mock.onPost(`${ BASE }/task/t1/comment`).reply({ id: 'c1' })

      await service.createTaskComment('ws1', 'sp1', 'l1', 't1', 'Hello', undefined, true)

      expect(mock.history[0].body).toEqual({
        comment_text: 'Hello',
        notify_all: true,
      })
    })

    it('includes assignee when provided', async () => {
      mock.onPost(`${ BASE }/task/t1/comment`).reply({ id: 'c1' })

      await service.createTaskComment('ws1', 'sp1', 'l1', 't1', 'Hi', '42')

      expect(mock.history[0].body).toMatchObject({ assignee: 42 })
    })
  })

  // ── Checklists ──

  describe('createChecklist', () => {
    it('sends POST to /task/{id}/checklist', async () => {
      mock.onPost(`${ BASE }/task/t1/checklist`).reply({ checklist: { id: 'cl1' } })

      await service.createChecklist('ws1', 'sp1', 'l1', 't1', 'DoD')

      expect(mock.history[0].body).toEqual({ name: 'DoD' })
    })
  })

  describe('createChecklistItem', () => {
    it('sends POST with name to checklist_item endpoint', async () => {
      mock.onPost(`${ BASE }/checklist/cl1/checklist_item`).reply({ checklist: {} })

      await service.createChecklistItem('ws1', 'sp1', 'l1', 't1', 'cl1', 'Write tests')

      expect(mock.history[0].body).toEqual({ name: 'Write tests' })
    })

    it('includes assignee when provided', async () => {
      mock.onPost(`${ BASE }/checklist/cl1/checklist_item`).reply({ checklist: {} })

      await service.createChecklistItem('ws1', 'sp1', 'l1', 't1', 'cl1', 'Item', '99')

      expect(mock.history[0].body).toEqual({ name: 'Item', assignee: 99 })
    })
  })

  // ── Time Tracking ──

  describe('getTimeEntries', () => {
    it('sends GET with no query when no optional params', async () => {
      mock.onGet(`${ BASE }/team/ws1/time_entries`).reply({ data: [] })

      await service.getTimeEntries('ws1')

      expect(mock.history[0].query).toEqual({})
    })

    it('includes start_date, end_date, and assignee in query', async () => {
      mock.onGet(`${ BASE }/team/ws1/time_entries`).reply({ data: [] })

      await service.getTimeEntries('ws1', 1000, 2000, '42')

      expect(mock.history[0].query).toMatchObject({
        start_date: 1000,
        end_date: 2000,
        assignee: 42,
      })
    })
  })

  describe('createTimeEntry', () => {
    it('sends POST with required fields', async () => {
      mock.onPost(`${ BASE }/team/ws1/time_entries`).reply({ data: { id: 'te1' } })

      await service.createTimeEntry('ws1', 'sp1', 'l1', 't1', 1000, 5000)

      expect(mock.history[0].body).toEqual({
        tid: 't1',
        start: 1000,
        duration: 5000,
        billable: false,
      })
    })

    it('includes description and billable flag', async () => {
      mock.onPost(`${ BASE }/team/ws1/time_entries`).reply({ data: { id: 'te1' } })

      await service.createTimeEntry('ws1', 'sp1', 'l1', 't1', 1000, 5000, 'Work done', true)

      expect(mock.history[0].body).toMatchObject({
        description: 'Work done',
        billable: true,
      })
    })
  })

  // ── Custom Fields ──

  describe('getListCustomFields', () => {
    it('returns fields wrapped in object', async () => {
      mock.onGet(`${ BASE }/list/l1/field`).reply({
        fields: [{ id: 'f1', name: 'Text', type: 'text' }],
      })

      const result = await service.getListCustomFields('ws1', 'sp1', 'l1')

      expect(result).toEqual({ fields: [{ id: 'f1', name: 'Text', type: 'text' }] })
    })

    it('handles bare array response', async () => {
      mock.onGet(`${ BASE }/list/l1/field`).reply([{ id: 'f1', name: 'Text', type: 'text' }])

      const result = await service.getListCustomFields('ws1', 'sp1', 'l1')

      expect(result).toEqual({ fields: [{ id: 'f1', name: 'Text', type: 'text' }] })
    })
  })

  describe('setTaskCustomFieldValue', () => {
    it('sends POST with value for text field', async () => {
      mock.onGet(`${ BASE }/list/l1/field`).reply({
        fields: [{ id: 'cf1', name: 'Notes', type: 'text' }],
      })
      mock.onPost(`${ BASE }/task/t1/field/cf1`).reply({})

      await service.setTaskCustomFieldValue('ws1', 'sp1', 'l1', 't1', 'cf1', { value: 'hello' })

      const postCall = mock.history.find(h => h.method === 'post' && h.url.includes('/field/'))

      expect(postCall.body).toEqual({ value: 'hello' })
    })

    it('resolves dropdown option name to id', async () => {
      mock.onGet(`${ BASE }/list/l1/field`).reply({
        fields: [{
          id: 'cf1',
          name: 'Status',
          type: 'drop_down',
          type_config: { options: [{ id: 'opt-1', name: 'Active' }, { id: 'opt-2', name: 'Inactive' }] },
        }],
      })
      mock.onPost(`${ BASE }/task/t1/field/cf1`).reply({})

      await service.setTaskCustomFieldValue('ws1', 'sp1', 'l1', 't1', 'cf1', { value: 'Active' })

      const postCall = mock.history.find(h => h.method === 'post' && h.url.includes('/field/'))

      expect(postCall.body).toEqual({ value: 'opt-1' })
    })

    it('sends add/rem for users field type', async () => {
      mock.onGet(`${ BASE }/list/l1/field`).reply({
        fields: [{ id: 'cf1', name: 'Reviewers', type: 'users' }],
      })
      mock.onPost(`${ BASE }/task/t1/field/cf1`).reply({})

      await service.setTaskCustomFieldValue('ws1', 'sp1', 'l1', 't1', 'cf1', { add: [1], rem: [2] })

      const postCall = mock.history.find(h => h.method === 'post' && h.url.includes('/field/'))

      expect(postCall.body).toEqual({ value: { add: [1], rem: [2] } })
    })
  })

  describe('removeTaskCustomFieldValue', () => {
    it('sends DELETE to /task/{id}/field/{fieldId}', async () => {
      mock.onDelete(`${ BASE }/task/t1/field/cf1`).reply({})

      await service.removeTaskCustomFieldValue('ws1', 'sp1', 'l1', 't1', 'cf1')

      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${ BASE }/task/t1/field/cf1`)
    })
  })

  // ── Custom Field Value Schema ──

  describe('createCustomFieldValueSchema', () => {
    it('returns null when listId or fieldId is missing', async () => {
      const result = await service.createCustomFieldValueSchema({ criteria: {} })

      expect(result).toBeNull()
    })

    it('returns string schema for text field', async () => {
      mock.onGet(`${ BASE }/list/l1/field`).reply({
        fields: [{ id: 'cf1', type: 'text' }],
      })

      const result = await service.createCustomFieldValueSchema({ criteria: { listId: 'l1', fieldId: 'cf1' } })

      expect(result).toEqual([
        expect.objectContaining({ type: 'String', name: 'value', required: true }),
      ])
    })

    it('returns numeric schema for number field', async () => {
      mock.onGet(`${ BASE }/list/l1/field`).reply({
        fields: [{ id: 'cf1', type: 'number' }],
      })

      const result = await service.createCustomFieldValueSchema({ criteria: { listId: 'l1', fieldId: 'cf1' } })

      expect(result).toEqual([
        expect.objectContaining({ type: 'Number', name: 'value' }),
      ])
    })

    it('returns toggle schema for checkbox field', async () => {
      mock.onGet(`${ BASE }/list/l1/field`).reply({
        fields: [{ id: 'cf1', type: 'checkbox' }],
      })

      const result = await service.createCustomFieldValueSchema({ criteria: { listId: 'l1', fieldId: 'cf1' } })

      expect(result).toEqual([
        expect.objectContaining({ type: 'Boolean', name: 'value' }),
      ])
    })

    it('returns dropdown schema with options for drop_down field', async () => {
      mock.onGet(`${ BASE }/list/l1/field`).reply({
        fields: [{
          id: 'cf1',
          type: 'drop_down',
          type_config: { options: [{ name: 'A' }, { name: 'B' }] },
        }],
      })

      const result = await service.createCustomFieldValueSchema({ criteria: { listId: 'l1', fieldId: 'cf1' } })

      expect(result[0].uiComponent.options.values).toEqual(['A', 'B'])
    })

    it('returns add/rem schema for users field', async () => {
      mock.onGet(`${ BASE }/list/l1/field`).reply({
        fields: [{ id: 'cf1', type: 'users' }],
      })

      const result = await service.createCustomFieldValueSchema({ criteria: { listId: 'l1', fieldId: 'cf1' } })

      expect(result).toHaveLength(2)
      expect(result[0].name).toBe('add')
      expect(result[1].name).toBe('rem')
    })

    it('returns null for unsupported field type', async () => {
      mock.onGet(`${ BASE }/list/l1/field`).reply({
        fields: [{ id: 'cf1', type: 'manual_progress' }],
      })

      const result = await service.createCustomFieldValueSchema({ criteria: { listId: 'l1', fieldId: 'cf1' } })

      expect(result).toBeNull()
    })

    it('returns null when field is not found', async () => {
      mock.onGet(`${ BASE }/list/l1/field`).reply({ fields: [] })

      const result = await service.createCustomFieldValueSchema({ criteria: { listId: 'l1', fieldId: 'nonexistent' } })

      expect(result).toBeNull()
    })

    it('returns null on API error', async () => {
      mock.onGet(`${ BASE }/list/l1/field`).replyWithError({ message: 'fail' })

      const result = await service.createCustomFieldValueSchema({ criteria: { listId: 'l1', fieldId: 'cf1' } })

      expect(result).toBeNull()
    })
  })

  // ── Tags ──

  describe('getSpaceTags', () => {
    it('sends GET to /space/{id}/tag', async () => {
      mock.onGet(`${ BASE }/space/sp1/tag`).reply({ tags: [{ name: 'bug' }] })

      const result = await service.getSpaceTags('ws1', 'sp1')

      expect(result).toEqual({ tags: [{ name: 'bug' }] })
    })
  })

  describe('addTaskTag', () => {
    it('sends POST with encoded tag name', async () => {
      mock.onPost(`${ BASE }/task/t1/tag/my%20tag`).reply({})

      await service.addTaskTag('ws1', 'sp1', 'l1', 't1', 'my tag')

      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/task/t1/tag/my%20tag`)
    })
  })

  describe('removeTaskTag', () => {
    it('sends DELETE with encoded tag name', async () => {
      mock.onDelete(`${ BASE }/task/t1/tag/urgent`).reply({})

      await service.removeTaskTag('ws1', 'sp1', 'l1', 't1', 'urgent')

      expect(mock.history[0].method).toBe('delete')
    })
  })

  // ── Attachments ──

  describe('createTaskAttachment', () => {
    it('downloads file and uploads via multipart form', async () => {
      const fileBuffer = Buffer.from('file-data')

      mock.onGet('https://storage.example.com/file.pdf').reply(fileBuffer)
      mock.onPost(`${ BASE }/task/t1/attachment`).reply({ url: 'https://clickup.com/att/1' })

      const result = await service.createTaskAttachment('ws1', 'sp1', 'l1', 't1', 'https://storage.example.com/file.pdf', 'file.pdf')

      expect(result).toEqual({ url: 'https://clickup.com/att/1' })
      // First call: file download
      expect(mock.history[0].encoding).toBeNull()
      // Second call: upload with formData
      expect(mock.history[1].formData).toBeDefined()
    })

    it('throws on download error', async () => {
      mock.onGet('https://storage.example.com/file.pdf').replyWithError({ message: 'Not found', status: 404 })

      await expect(
        service.createTaskAttachment('ws1', 'sp1', 'l1', 't1', 'https://storage.example.com/file.pdf', 'file.pdf')
      ).rejects.toThrow()
    })
  })

  // ── Realtime Trigger System Methods ──

  describe('handleTriggerUpsertWebhook', () => {
    it('creates webhooks for new lists', async () => {
      mock.onPost(`${ BASE }/team/ws1/webhook`).reply({ id: 'wh1', secret: 'sec1' })

      const result = await service.handleTriggerUpsertWebhook({
        webhookData: {},
        callbackUrl: 'https://callback.url',
        events: [{ triggerData: { listId: 'l1', workspaceId: 'ws1' } }],
      })

      expect(result.webhookData).toEqual({ l1: { webhookId: 'wh1', secret: 'sec1' } })
      expect(mock.history[0].body).toMatchObject({
        endpoint: 'https://callback.url',
        events: ['taskCreated', 'taskUpdated', 'taskDeleted'],
        list_id: 'l1',
      })
    })

    it('reuses existing webhook data for already-subscribed lists', async () => {
      const result = await service.handleTriggerUpsertWebhook({
        webhookData: { l1: { webhookId: 'wh1', secret: 'sec1' } },
        callbackUrl: 'https://callback.url',
        events: [{ triggerData: { listId: 'l1', workspaceId: 'ws1' } }],
      })

      expect(result.webhookData.l1).toEqual({ webhookId: 'wh1', secret: 'sec1' })
      expect(mock.history).toHaveLength(0)
    })

    it('deletes webhooks for removed lists', async () => {
      mock.onDelete(`${ BASE }/webhook/wh1`).reply({})

      const result = await service.handleTriggerUpsertWebhook({
        webhookData: { l1: { webhookId: 'wh1', secret: 'sec1' } },
        callbackUrl: 'https://callback.url',
        events: [],
      })

      expect(result.webhookData).toEqual({})
      expect(mock.history[0].method).toBe('delete')
    })
  })

  describe('handleTriggerResolveEvents', () => {
    const webhookSecret = 'test-secret'

    function makeInvocation(event, taskId, webhookId, body) {
      const bodyObj = body || { event, task_id: taskId, webhook_id: webhookId }
      const rawBody = JSON.stringify(bodyObj)
      const signature = crypto.createHmac('sha256', webhookSecret).update(rawBody, 'utf8').digest('hex')

      return {
        headers: { 'x-signature': signature },
        body: bodyObj,
        rawBody,
        webhookData: { l1: { webhookId, secret: webhookSecret } },
      }
    }

    it('resolves taskCreated event and fetches task', async () => {
      mock.onGet(`${ BASE }/task/t1`).reply({ id: 't1', name: 'New Task' })

      const invocation = makeInvocation('taskCreated', 't1', 'wh1')
      const result = await service.handleTriggerResolveEvents(invocation)

      expect(result.events).toHaveLength(1)
      expect(result.events[0].name).toBe('onTaskCreated')
      expect(result.events[0].data).toEqual({ id: 't1', name: 'New Task' })
    })

    it('resolves taskUpdated event with history items', async () => {
      mock.onGet(`${ BASE }/task/t1`).reply({ id: 't1', name: 'Updated Task' })

      const invocation = makeInvocation('taskUpdated', 't1', 'wh1', {
        event: 'taskUpdated',
        task_id: 't1',
        webhook_id: 'wh1',
        history_items: [{ id: 'h1', field: 'status' }],
      })

      const result = await service.handleTriggerResolveEvents(invocation)

      expect(result.events[0].name).toBe('onTaskUpdated')
      expect(result.events[0].data.historyItems).toEqual([{ id: 'h1', field: 'status' }])
    })

    it('resolves taskDeleted event without fetching task', async () => {
      const invocation = makeInvocation('taskDeleted', 't1', 'wh1')
      const result = await service.handleTriggerResolveEvents(invocation)

      expect(result.events).toHaveLength(1)
      expect(result.events[0].name).toBe('onTaskDeleted')
      expect(result.events[0].data.taskId).toBe('t1')
      expect(result.events[0].data.deletedAt).toBeDefined()
      expect(mock.history).toHaveLength(0) // No GET call
    })

    it('rejects on missing signature', async () => {
      const result = await service.handleTriggerResolveEvents({
        headers: {},
        body: { event: 'taskCreated', task_id: 't1', webhook_id: 'wh1' },
        rawBody: '{}',
        webhookData: { l1: { webhookId: 'wh1', secret: webhookSecret } },
      })

      expect(result.events).toEqual([])
    })

    it('rejects on signature mismatch', async () => {
      const result = await service.handleTriggerResolveEvents({
        headers: { 'x-signature': 'bad-sig' },
        body: { event: 'taskCreated', task_id: 't1', webhook_id: 'wh1' },
        rawBody: JSON.stringify({ event: 'taskCreated', task_id: 't1', webhook_id: 'wh1' }),
        webhookData: { l1: { webhookId: 'wh1', secret: webhookSecret } },
      })

      expect(result.events).toEqual([])
    })

    it('returns empty events on task fetch failure', async () => {
      mock.onGet(`${ BASE }/task/t1`).replyWithError({ message: 'not found' })

      const invocation = makeInvocation('taskCreated', 't1', 'wh1')
      const result = await service.handleTriggerResolveEvents(invocation)

      expect(result.events).toEqual([])
    })
  })

  describe('handleTriggerSelectMatched', () => {
    it('returns matching trigger ids for the webhook list', async () => {
      const result = await service.handleTriggerSelectMatched({
        body: { webhook_id: 'wh1' },
        webhookData: { l1: { webhookId: 'wh1' } },
        triggers: [
          { id: 'trig1', data: { listId: 'l1' } },
          { id: 'trig2', data: { listId: 'l2' } },
        ],
      })

      expect(result.ids).toEqual(['trig1'])
    })

    it('returns empty ids when webhook not found', async () => {
      const result = await service.handleTriggerSelectMatched({
        body: { webhook_id: 'unknown' },
        webhookData: {},
        triggers: [{ id: 'trig1', data: { listId: 'l1' } }],
      })

      expect(result.ids).toEqual([])
    })
  })

  describe('handleTriggerDeleteWebhook', () => {
    it('deletes all webhooks', async () => {
      mock.onDelete(`${ BASE }/webhook/wh1`).reply({})
      mock.onDelete(`${ BASE }/webhook/wh2`).reply({})

      const result = await service.handleTriggerDeleteWebhook({
        webhookData: {
          l1: { webhookId: 'wh1' },
          l2: { webhookId: 'wh2' },
        },
      })

      expect(result).toEqual({})
      expect(mock.history).toHaveLength(2)
    })

    it('continues on delete failure', async () => {
      mock.onDelete(`${ BASE }/webhook/wh1`).replyWithError({ message: 'fail' })

      const result = await service.handleTriggerDeleteWebhook({
        webhookData: { l1: { webhookId: 'wh1' } },
      })

      expect(result).toEqual({})
    })
  })

  // ── Polling Triggers ──

  describe('onNewTask', () => {
    it('returns sample event in learning mode', async () => {
      mock.onGet(`${ BASE }/list/l1/task`).reply({
        tasks: [{ id: 't1', name: 'Task 1', date_created: '1700000000000' }],
      })

      const result = await service.onNewTask({
        triggerData: { listId: 'l1' },
        learningMode: true,
        state: {},
      })

      expect(result.events).toHaveLength(1)
      expect(result.state).toBeNull()
    })

    it('seeds watermark on first cycle and emits nothing', async () => {
      mock.onGet(`${ BASE }/list/l1/task`).reply({
        tasks: [{ id: 't1', name: 'Task 1', date_created: '1700000000000' }],
      })

      const result = await service.onNewTask({
        triggerData: { listId: 'l1' },
        state: {},
      })

      expect(result.events).toEqual([])
      expect(result.state.since).toBe(1700000000000)
      expect(result.state.seenIds).toContain('t1')
    })

    it('returns new tasks and updates state on subsequent cycle', async () => {
      mock.onGet(`${ BASE }/list/l1/task`).reply({
        tasks: [
          { id: 't2', name: 'New Task', date_created: '1700001000000' },
        ],
        last_page: true,
      })

      const result = await service.onNewTask({
        triggerData: { listId: 'l1' },
        state: { since: 1700000000000, seenIds: ['t1'] },
      })

      expect(result.events).toHaveLength(1)
      expect(result.events[0].id).toBe('t2')
      expect(result.state.seenIds).toContain('t2')
    })

    it('filters already-seen tasks', async () => {
      mock.onGet(`${ BASE }/list/l1/task`).reply({
        tasks: [{ id: 't1', name: 'Already Seen', date_created: '1700000000000' }],
        last_page: true,
      })

      const result = await service.onNewTask({
        triggerData: { listId: 'l1' },
        state: { since: 1700000000000, seenIds: ['t1'] },
      })

      expect(result.events).toEqual([])
    })
  })

  describe('onUpdatedTask', () => {
    it('seeds watermark on first cycle using date_updated', async () => {
      mock.onGet(`${ BASE }/list/l1/task`).reply({
        tasks: [{ id: 't1', name: 'Task 1', date_updated: '1700002000000' }],
      })

      const result = await service.onUpdatedTask({
        triggerData: { listId: 'l1' },
        state: {},
      })

      expect(result.events).toEqual([])
      expect(result.state.since).toBe(1700002000000)
      expect(result.state.seenKeys).toContain('t1:1700002000000')
    })

    it('detects updated tasks by id:date_updated key', async () => {
      mock.onGet(`${ BASE }/list/l1/task`).reply({
        tasks: [{ id: 't1', name: 'Updated', date_updated: '1700003000000' }],
        last_page: true,
      })

      const result = await service.onUpdatedTask({
        triggerData: { listId: 'l1' },
        state: { since: 1700002000000, seenKeys: ['t1:1700002000000'] },
      })

      expect(result.events).toHaveLength(1)
      expect(result.events[0].id).toBe('t1')
    })
  })

  describe('handleTriggerPollingForEvent', () => {
    it('dispatches to the correct trigger method', async () => {
      mock.onGet(`${ BASE }/list/l1/task`).reply({
        tasks: [{ id: 't1', date_created: '1700000000000' }],
      })

      const result = await service.handleTriggerPollingForEvent({
        eventName: 'onNewTask',
        triggerData: { listId: 'l1' },
        learningMode: true,
        state: {},
      })

      expect(result.events).toBeDefined()
    })
  })

  // ── Error Handling ──

  describe('error handling', () => {
    it('throws ResponseError with hint for 401', async () => {
      mock.onGet(`${ BASE }/team`).replyWithError({
        message: 'Unauthorized',
        status: 401,
        body: { err: 'Token expired' },
      })

      await expect(service.getWorkspaces()).rejects.toThrow('[ClickUpError]')
    })

    it('throws ResponseError with hint for 429 rate limit', async () => {
      mock.onGet(`${ BASE }/team`).replyWithError({
        message: 'Rate limited',
        status: 429,
      })

      await expect(service.getWorkspaces()).rejects.toThrow('rate limit')
    })

    it('throws ResponseError with server hint for 500', async () => {
      mock.onGet(`${ BASE }/team`).replyWithError({
        message: 'Internal',
        status: 500,
      })

      await expect(service.getWorkspaces()).rejects.toThrow('temporarily unavailable')
    })
  })
})
