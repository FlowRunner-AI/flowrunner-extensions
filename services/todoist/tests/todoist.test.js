'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_TOKEN = 'test-api-token'
const BASE = 'https://api.todoist.com/api/v1'

describe('Todoist Service', () => {
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
          expect.objectContaining({
            name: 'apiToken',
            required: true,
            shared: false,
          }),
        ])
      )
    })
  })

  // ── Tasks ──

  describe('createTask', () => {
    it('sends POST with required content only', async () => {
      mock.onPost(`${BASE}/tasks`).reply({ id: '123', content: 'Buy milk', is_completed: false })

      const result = await service.createTask('Buy milk')

      expect(result).toEqual({ id: '123', content: 'Buy milk', is_completed: false })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].headers).toMatchObject({ 'Authorization': `Bearer ${API_TOKEN}` })
      expect(mock.history[0].body).toEqual({ content: 'Buy milk' })
    })

    it('sends all optional fields when provided', async () => {
      mock.onPost(`${BASE}/tasks`).reply({ id: '124', content: 'Task' })

      await service.createTask(
        'Task', 'A description', 'proj-1', 'sec-1', 'parent-1',
        ['urgent', 'work'], 'P1 Urgent', 'tomorrow at 5pm', '2026-08-01', 'user-1'
      )

      expect(mock.history[0].body).toEqual({
        content: 'Task',
        description: 'A description',
        project_id: 'proj-1',
        section_id: 'sec-1',
        parent_id: 'parent-1',
        labels: ['urgent', 'work'],
        priority: 4,
        due_string: 'tomorrow at 5pm',
        due_date: '2026-08-01',
        assignee_id: 'user-1',
      })
    })

    it('resolves priority label to API value', async () => {
      mock.onPost(`${BASE}/tasks`).reply({ id: '125' })

      await service.createTask('Test', undefined, undefined, undefined, undefined, undefined, 'P3 Medium')

      expect(mock.history[0].body).toMatchObject({ priority: 2 })
    })

    it('omits labels when empty array is provided', async () => {
      mock.onPost(`${BASE}/tasks`).reply({ id: '126' })

      await service.createTask('Test', undefined, undefined, undefined, undefined, [])

      expect(mock.history[0].body).toEqual({ content: 'Test' })
    })

    it('throws on API error', async () => {
      mock.onPost(`${BASE}/tasks`).replyWithError({
        message: 'Bad Request',
        body: { error: 'Invalid content' },
      })

      await expect(service.createTask('Test')).rejects.toThrow('Todoist API error: Invalid content')
    })
  })

  describe('getTask', () => {
    it('sends GET to correct URL', async () => {
      mock.onGet(`${BASE}/tasks/123`).reply({ id: '123', content: 'Buy milk' })

      const result = await service.getTask('123')

      expect(result).toEqual({ id: '123', content: 'Buy milk' })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].headers).toMatchObject({ 'Authorization': `Bearer ${API_TOKEN}` })
    })

    it('throws on API error', async () => {
      mock.onGet(`${BASE}/tasks/999`).replyWithError({ message: 'Not Found' })

      await expect(service.getTask('999')).rejects.toThrow('Todoist API error: Not Found')
    })
  })

  describe('listTasks', () => {
    it('sends GET with default limit', async () => {
      mock.onGet(`${BASE}/tasks`).reply({ results: [], next_cursor: null })

      const result = await service.listTasks()

      expect(result).toEqual({ results: [], next_cursor: null })
      expect(mock.history[0].query).toMatchObject({ limit: 50 })
    })

    it('passes all filter parameters', async () => {
      mock.onGet(`${BASE}/tasks`).reply({ results: [{ id: '1' }], next_cursor: 'abc' })

      await service.listTasks('proj-1', 'sec-1', 'urgent', 'today | overdue', 10, 'cursor-xyz')

      expect(mock.history[0].query).toMatchObject({
        project_id: 'proj-1',
        section_id: 'sec-1',
        label: 'urgent',
        filter: 'today | overdue',
        limit: 10,
        cursor: 'cursor-xyz',
      })
    })
  })

  describe('updateTask', () => {
    it('sends POST with provided fields only', async () => {
      mock.onPost(`${BASE}/tasks/123`).reply({ id: '123', content: 'Updated' })

      await service.updateTask('123', 'Updated')

      expect(mock.history[0].url).toBe(`${BASE}/tasks/123`)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({ content: 'Updated' })
    })

    it('resolves priority label', async () => {
      mock.onPost(`${BASE}/tasks/123`).reply({ id: '123' })

      await service.updateTask('123', undefined, undefined, undefined, 'P2 High')

      expect(mock.history[0].body).toEqual({ priority: 3 })
    })

    it('sends all fields when provided', async () => {
      mock.onPost(`${BASE}/tasks/123`).reply({ id: '123' })

      await service.updateTask('123', 'New content', 'New desc', ['label1'], 'P4 Normal', 'next Friday', '2026-09-01', 'user-2')

      expect(mock.history[0].body).toEqual({
        content: 'New content',
        description: 'New desc',
        labels: ['label1'],
        priority: 1,
        due_string: 'next Friday',
        due_date: '2026-09-01',
        assignee_id: 'user-2',
      })
    })
  })

  describe('closeTask', () => {
    it('sends POST to close endpoint', async () => {
      mock.onPost(`${BASE}/tasks/123/close`).reply(null)

      const result = await service.closeTask('123')

      expect(result).toEqual({ success: true })
      expect(mock.history[0].url).toBe(`${BASE}/tasks/123/close`)
      expect(mock.history[0].method).toBe('post')
    })
  })

  describe('reopenTask', () => {
    it('sends POST to reopen endpoint', async () => {
      mock.onPost(`${BASE}/tasks/123/reopen`).reply('')

      const result = await service.reopenTask('123')

      expect(result).toEqual({ success: true })
      expect(mock.history[0].url).toBe(`${BASE}/tasks/123/reopen`)
    })
  })

  describe('deleteTask', () => {
    it('sends DELETE request', async () => {
      mock.onDelete(`${BASE}/tasks/123`).reply(undefined)

      const result = await service.deleteTask('123')

      expect(result).toEqual({ success: true })
      expect(mock.history[0].method).toBe('delete')
    })
  })

  describe('moveTask', () => {
    it('sends POST with destination fields', async () => {
      mock.onPost(`${BASE}/tasks/123/move`).reply({ id: '123', project_id: 'proj-2' })

      const result = await service.moveTask('123', 'proj-2', 'sec-2', 'parent-2')

      expect(result).toEqual({ id: '123', project_id: 'proj-2' })
      expect(mock.history[0].body).toEqual({
        project_id: 'proj-2',
        section_id: 'sec-2',
        parent_id: 'parent-2',
      })
    })

    it('omits empty destination fields', async () => {
      mock.onPost(`${BASE}/tasks/123/move`).reply({ id: '123' })

      await service.moveTask('123', 'proj-2')

      expect(mock.history[0].body).toEqual({ project_id: 'proj-2' })
    })
  })

  // ── Projects ──

  describe('createProject', () => {
    it('sends POST with name only', async () => {
      mock.onPost(`${BASE}/projects`).reply({ id: 'proj-1', name: 'Shopping' })

      const result = await service.createProject('Shopping')

      expect(result).toEqual({ id: 'proj-1', name: 'Shopping' })
      expect(mock.history[0].body).toEqual({ name: 'Shopping' })
    })

    it('resolves color and view_style labels', async () => {
      mock.onPost(`${BASE}/projects`).reply({ id: 'proj-2' })

      await service.createProject('Work', 'Berry Red', 'parent-1', true, 'Board')

      expect(mock.history[0].body).toEqual({
        name: 'Work',
        color: 'berry_red',
        parent_id: 'parent-1',
        is_favorite: true,
        view_style: 'board',
      })
    })
  })

  describe('listProjects', () => {
    it('sends GET with default limit', async () => {
      mock.onGet(`${BASE}/projects`).reply({ results: [], next_cursor: null })

      await service.listProjects()

      expect(mock.history[0].query).toMatchObject({ limit: 50 })
    })

    it('passes custom limit and cursor', async () => {
      mock.onGet(`${BASE}/projects`).reply({ results: [], next_cursor: null })

      await service.listProjects(10, 'cur-1')

      expect(mock.history[0].query).toMatchObject({ limit: 10, cursor: 'cur-1' })
    })
  })

  describe('getProject', () => {
    it('sends GET to correct URL', async () => {
      mock.onGet(`${BASE}/projects/proj-1`).reply({ id: 'proj-1', name: 'Inbox' })

      const result = await service.getProject('proj-1')

      expect(result).toEqual({ id: 'proj-1', name: 'Inbox' })
    })
  })

  describe('updateProject', () => {
    it('sends POST with updated fields', async () => {
      mock.onPost(`${BASE}/projects/proj-1`).reply({ id: 'proj-1', name: 'Groceries' })

      await service.updateProject('proj-1', 'Groceries', 'Lime Green', true, 'Calendar')

      expect(mock.history[0].body).toEqual({
        name: 'Groceries',
        color: 'lime_green',
        is_favorite: true,
        view_style: 'calendar',
      })
    })

    it('omits empty fields', async () => {
      mock.onPost(`${BASE}/projects/proj-1`).reply({ id: 'proj-1' })

      await service.updateProject('proj-1', 'New Name')

      expect(mock.history[0].body).toEqual({ name: 'New Name' })
    })
  })

  describe('deleteProject', () => {
    it('sends DELETE request', async () => {
      mock.onDelete(`${BASE}/projects/proj-1`).reply(null)

      const result = await service.deleteProject('proj-1')

      expect(result).toEqual({ success: true })
      expect(mock.history[0].method).toBe('delete')
    })
  })

  describe('getCollaborators', () => {
    it('sends GET with default limit', async () => {
      mock.onGet(`${BASE}/projects/proj-1/collaborators`).reply({ results: [], next_cursor: null })

      await service.getCollaborators('proj-1')

      expect(mock.history[0].query).toMatchObject({ limit: 50 })
    })

    it('passes custom limit and cursor', async () => {
      mock.onGet(`${BASE}/projects/proj-1/collaborators`).reply({ results: [], next_cursor: null })

      await service.getCollaborators('proj-1', 10, 'cur-x')

      expect(mock.history[0].query).toMatchObject({ limit: 10, cursor: 'cur-x' })
    })
  })

  // ── Sections ──

  describe('createSection', () => {
    it('sends POST with name and project_id', async () => {
      mock.onPost(`${BASE}/sections`).reply({ id: 'sec-1', name: 'Groceries', project_id: 'proj-1' })

      const result = await service.createSection('Groceries', 'proj-1')

      expect(result).toMatchObject({ id: 'sec-1', name: 'Groceries' })
      expect(mock.history[0].body).toEqual({ name: 'Groceries', project_id: 'proj-1' })
    })

    it('includes order when provided', async () => {
      mock.onPost(`${BASE}/sections`).reply({ id: 'sec-2' })

      await service.createSection('Done', 'proj-1', 3)

      expect(mock.history[0].body).toEqual({ name: 'Done', project_id: 'proj-1', order: 3 })
    })
  })

  describe('listSections', () => {
    it('sends GET with default limit', async () => {
      mock.onGet(`${BASE}/sections`).reply({ results: [], next_cursor: null })

      await service.listSections()

      expect(mock.history[0].query).toMatchObject({ limit: 50 })
    })

    it('passes project_id, limit, and cursor', async () => {
      mock.onGet(`${BASE}/sections`).reply({ results: [], next_cursor: null })

      await service.listSections('proj-1', 20, 'cur-2')

      expect(mock.history[0].query).toMatchObject({
        project_id: 'proj-1',
        limit: 20,
        cursor: 'cur-2',
      })
    })
  })

  describe('deleteSection', () => {
    it('sends DELETE request', async () => {
      mock.onDelete(`${BASE}/sections/sec-1`).reply(null)

      const result = await service.deleteSection('sec-1')

      expect(result).toEqual({ success: true })
      expect(mock.history[0].method).toBe('delete')
    })
  })

  // ── Labels ──

  describe('createLabel', () => {
    it('sends POST with name only', async () => {
      mock.onPost(`${BASE}/labels`).reply({ id: 'lbl-1', name: 'waiting' })

      const result = await service.createLabel('waiting')

      expect(result).toEqual({ id: 'lbl-1', name: 'waiting' })
      expect(mock.history[0].body).toEqual({ name: 'waiting' })
    })

    it('resolves color and includes all fields', async () => {
      mock.onPost(`${BASE}/labels`).reply({ id: 'lbl-2' })

      await service.createLabel('urgent', 'Red', 1, true)

      expect(mock.history[0].body).toEqual({
        name: 'urgent',
        color: 'red',
        order: 1,
        is_favorite: true,
      })
    })
  })

  describe('listLabels', () => {
    it('sends GET with default limit', async () => {
      mock.onGet(`${BASE}/labels`).reply({ results: [], next_cursor: null })

      await service.listLabels()

      expect(mock.history[0].query).toMatchObject({ limit: 50 })
    })

    it('passes custom limit and cursor', async () => {
      mock.onGet(`${BASE}/labels`).reply({ results: [], next_cursor: null })

      await service.listLabels(25, 'cur-lbl')

      expect(mock.history[0].query).toMatchObject({ limit: 25, cursor: 'cur-lbl' })
    })
  })

  describe('updateLabel', () => {
    it('sends POST with updated fields', async () => {
      mock.onPost(`${BASE}/labels/lbl-1`).reply({ id: 'lbl-1', name: 'blocked' })

      await service.updateLabel('lbl-1', 'blocked', 'Grape', 2, true)

      expect(mock.history[0].body).toEqual({
        name: 'blocked',
        color: 'grape',
        order: 2,
        is_favorite: true,
      })
    })

    it('omits empty fields', async () => {
      mock.onPost(`${BASE}/labels/lbl-1`).reply({ id: 'lbl-1' })

      await service.updateLabel('lbl-1', 'renamed')

      expect(mock.history[0].body).toEqual({ name: 'renamed' })
    })
  })

  describe('deleteLabel', () => {
    it('sends DELETE request', async () => {
      mock.onDelete(`${BASE}/labels/lbl-1`).reply(null)

      const result = await service.deleteLabel('lbl-1')

      expect(result).toEqual({ success: true })
      expect(mock.history[0].method).toBe('delete')
    })
  })

  // ── Comments ──

  describe('createComment', () => {
    it('sends POST with task comment', async () => {
      mock.onPost(`${BASE}/comments`).reply({ id: 'com-1', task_id: '123', content: 'Note' })

      const result = await service.createComment('Note', '123')

      expect(result).toMatchObject({ id: 'com-1', content: 'Note' })
      expect(mock.history[0].body).toEqual({ content: 'Note', task_id: '123' })
    })

    it('sends POST with project comment', async () => {
      mock.onPost(`${BASE}/comments`).reply({ id: 'com-2' })

      await service.createComment('Project note', undefined, 'proj-1')

      expect(mock.history[0].body).toEqual({ content: 'Project note', project_id: 'proj-1' })
    })
  })

  describe('listComments', () => {
    it('sends GET with task_id and default limit', async () => {
      mock.onGet(`${BASE}/comments`).reply({ results: [], next_cursor: null })

      await service.listComments('task-1')

      expect(mock.history[0].query).toMatchObject({ task_id: 'task-1', limit: 50 })
    })

    it('sends GET with project_id, limit, and cursor', async () => {
      mock.onGet(`${BASE}/comments`).reply({ results: [], next_cursor: null })

      await service.listComments(undefined, 'proj-1', 10, 'cur-c')

      expect(mock.history[0].query).toMatchObject({
        project_id: 'proj-1',
        limit: 10,
        cursor: 'cur-c',
      })
    })
  })

  describe('getComment', () => {
    it('sends GET to correct URL', async () => {
      mock.onGet(`${BASE}/comments/com-1`).reply({ id: 'com-1', content: 'Note' })

      const result = await service.getComment('com-1')

      expect(result).toEqual({ id: 'com-1', content: 'Note' })
    })
  })

  describe('updateComment', () => {
    it('sends POST with new content', async () => {
      mock.onPost(`${BASE}/comments/com-1`).reply({ id: 'com-1', content: 'Updated note' })

      await service.updateComment('com-1', 'Updated note')

      expect(mock.history[0].body).toEqual({ content: 'Updated note' })
    })
  })

  describe('deleteComment', () => {
    it('sends DELETE request', async () => {
      mock.onDelete(`${BASE}/comments/com-1`).reply(null)

      const result = await service.deleteComment('com-1')

      expect(result).toEqual({ success: true })
      expect(mock.history[0].method).toBe('delete')
    })
  })

  // ── Dictionaries ──

  describe('getProjectsDictionary', () => {
    it('returns mapped items with label and value', async () => {
      mock.onGet(`${BASE}/projects`).reply({
        results: [
          { id: 'p1', name: 'Inbox', is_inbox_project: true },
          { id: 'p2', name: 'Work', is_inbox_project: false },
        ],
        next_cursor: null,
      })

      const result = await service.getProjectsDictionary({})

      expect(result).toEqual({
        items: [
          { label: 'Inbox', value: 'p1', note: 'Inbox' },
          { label: 'Work', value: 'p2', note: undefined },
        ],
        cursor: null,
      })
    })

    it('filters by case-insensitive search', async () => {
      mock.onGet(`${BASE}/projects`).reply({
        results: [
          { id: 'p1', name: 'Inbox' },
          { id: 'p2', name: 'Work' },
        ],
        next_cursor: null,
      })

      const result = await service.getProjectsDictionary({ search: 'WOR' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('p2')
    })

    it('handles null payload', async () => {
      mock.onGet(`${BASE}/projects`).reply({ results: [{ id: 'p1', name: 'A' }], next_cursor: null })

      const result = await service.getProjectsDictionary(null)

      expect(result.items).toHaveLength(1)
      expect(result.cursor).toBeNull()
    })

    it('handles empty results', async () => {
      mock.onGet(`${BASE}/projects`).reply({ results: [], next_cursor: null })

      const result = await service.getProjectsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('passes cursor for pagination', async () => {
      mock.onGet(`${BASE}/projects`).reply({ results: [], next_cursor: 'next-1' })

      const result = await service.getProjectsDictionary({ cursor: 'cur-1' })

      expect(mock.history[0].query).toMatchObject({ cursor: 'cur-1' })
      expect(result.cursor).toBe('next-1')
    })
  })

  describe('getSectionsDictionary', () => {
    it('returns empty items when no project criteria', async () => {
      const result = await service.getSectionsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
      expect(mock.history).toHaveLength(0)
    })

    it('returns empty items when payload is null', async () => {
      const result = await service.getSectionsDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('returns mapped sections for a project', async () => {
      mock.onGet(`${BASE}/sections`).reply({
        results: [
          { id: 's1', name: 'To Do' },
          { id: 's2', name: 'Done' },
        ],
        next_cursor: null,
      })

      const result = await service.getSectionsDictionary({
        criteria: { project_id: 'proj-1' },
      })

      expect(result).toEqual({
        items: [
          { label: 'To Do', value: 's1', note: undefined },
          { label: 'Done', value: 's2', note: undefined },
        ],
        cursor: null,
      })
      expect(mock.history[0].query).toMatchObject({ project_id: 'proj-1' })
    })

    it('filters by search', async () => {
      mock.onGet(`${BASE}/sections`).reply({
        results: [
          { id: 's1', name: 'To Do' },
          { id: 's2', name: 'Done' },
        ],
        next_cursor: null,
      })

      const result = await service.getSectionsDictionary({
        search: 'done',
        criteria: { project_id: 'proj-1' },
      })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('s2')
    })
  })

  describe('getLabelsDictionary', () => {
    it('returns mapped labels with name as both label and value', async () => {
      mock.onGet(`${BASE}/labels`).reply({
        results: [
          { id: 'l1', name: 'waiting' },
          { id: 'l2', name: 'urgent' },
        ],
        next_cursor: null,
      })

      const result = await service.getLabelsDictionary({})

      expect(result).toEqual({
        items: [
          { label: 'waiting', value: 'waiting', note: undefined },
          { label: 'urgent', value: 'urgent', note: undefined },
        ],
        cursor: null,
      })
    })

    it('filters by search', async () => {
      mock.onGet(`${BASE}/labels`).reply({
        results: [
          { id: 'l1', name: 'waiting' },
          { id: 'l2', name: 'urgent' },
        ],
        next_cursor: null,
      })

      const result = await service.getLabelsDictionary({ search: 'URG' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('urgent')
    })

    it('handles null payload', async () => {
      mock.onGet(`${BASE}/labels`).reply({ results: [{ id: 'l1', name: 'a' }], next_cursor: null })

      const result = await service.getLabelsDictionary(null)

      expect(result.items).toHaveLength(1)
    })

    it('handles missing results in response', async () => {
      mock.onGet(`${BASE}/labels`).reply({ next_cursor: null })

      const result = await service.getLabelsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('extracts error from body.error', async () => {
      mock.onGet(`${BASE}/tasks/999`).replyWithError({
        message: 'Bad Request',
        body: { error: 'Task not found' },
      })

      await expect(service.getTask('999')).rejects.toThrow('Todoist API error: Task not found')
    })

    it('extracts error from body.error_tag', async () => {
      mock.onGet(`${BASE}/tasks/999`).replyWithError({
        message: 'Bad Request',
        body: { error_tag: 'INVALID_REQUEST' },
      })

      await expect(service.getTask('999')).rejects.toThrow('Todoist API error: INVALID_REQUEST')
    })

    it('extracts error from body.message', async () => {
      mock.onGet(`${BASE}/tasks/999`).replyWithError({
        message: 'Server Error',
        body: { message: 'Internal error' },
      })

      await expect(service.getTask('999')).rejects.toThrow('Todoist API error: Internal error')
    })

    it('uses string body as error message', async () => {
      mock.onGet(`${BASE}/tasks/999`).replyWithError({
        message: 'Server Error',
        body: 'Forbidden',
      })

      await expect(service.getTask('999')).rejects.toThrow('Todoist API error: Forbidden')
    })

    it('falls back to error.message when body is absent', async () => {
      mock.onGet(`${BASE}/tasks/999`).replyWithError({ message: 'Network timeout' })

      await expect(service.getTask('999')).rejects.toThrow('Todoist API error: Network timeout')
    })

    it('falls back to error.message when body is empty object', async () => {
      mock.onGet(`${BASE}/tasks/999`).replyWithError({ message: 'Request failed', body: {} })

      await expect(service.getTask('999')).rejects.toThrow('Todoist API error: Request failed')
    })

    it('synthesizes success for empty response (204 No Content)', async () => {
      mock.onPost(`${BASE}/tasks/123/close`).reply('')

      const result = await service.closeTask('123')

      expect(result).toEqual({ success: true })
    })
  })
})
