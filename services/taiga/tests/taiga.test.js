'use strict'

const { createSandbox } = require('../../../service-sandbox')

const USERNAME = 'test-user'
const PASSWORD = 'test-pass'
const URL = 'https://api.taiga.io'
const BASE = `${URL}/api/v1`
const AUTH_URL = `${BASE}/auth`
const AUTH_TOKEN = 'test-auth-token-abc123'

describe('Taiga Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ url: URL, username: USERNAME, password: PASSWORD })
    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()
  })

  afterEach(() => {
    mock.reset()
    // Clear the cached auth token between tests
    service.authToken = undefined
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // Helper to set up auth mock (needed before every API call)
  function mockAuth() {
    mock.onPost(AUTH_URL).reply({ auth_token: AUTH_TOKEN })
  }

  // ── Registration ──

  describe('service registration', () => {
    it('registers with correct config items', () => {
      const items = sandbox.getConfigItems()

      expect(items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'url', required: false, shared: false }),
          expect.objectContaining({ name: 'username', required: true, shared: false }),
          expect.objectContaining({ name: 'password', required: true, shared: false }),
        ])
      )
    })
  })

  // ── Authentication ──

  describe('authentication', () => {
    it('obtains auth token on first API call', async () => {
      mockAuth()
      mock.onGet(`${BASE}/users/me`).reply({ id: 5, username: 'jane' })

      await service.getMe()

      // First call is POST to auth, second is GET to users/me
      expect(mock.history).toHaveLength(2)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(AUTH_URL)
      expect(mock.history[0].body).toEqual({
        type: 'normal',
        username: USERNAME,
        password: PASSWORD,
      })
    })

    it('sends Bearer token in Authorization header', async () => {
      mockAuth()
      mock.onGet(`${BASE}/users/me`).reply({ id: 5 })

      await service.getMe()

      expect(mock.history[1].headers).toMatchObject({
        Authorization: `Bearer ${AUTH_TOKEN}`,
      })
    })

    it('throws when auth endpoint fails', async () => {
      mock.onPost(AUTH_URL).replyWithError({
        message: 'Login failed',
        body: { _error_message: 'Invalid credentials' },
      })

      await expect(service.getMe()).rejects.toThrow('Failed to obtain a Taiga auth token')
    })

    it('throws when auth endpoint returns no token', async () => {
      mock.onPost(AUTH_URL).reply({ user_id: 5 })

      await expect(service.getMe()).rejects.toThrow('did not return an auth_token')
    })

    it('retries on 401 by refreshing token', async () => {
      mockAuth()
      // First API call returns 401, then the retry succeeds
      let callCount = 0

      mock.onGet(`${BASE}/users/me`).replyWith(() => {
        callCount++

        if (callCount === 1) {
          throw { status: 401, body: { _error_message: 'Unauthorized' }, message: 'Unauthorized' }
        }

        return { id: 5, username: 'jane' }
      })

      const result = await service.getMe()

      expect(result).toEqual({ id: 5, username: 'jane' })
    })

    it('throws after retry fails on 401', async () => {
      mockAuth()
      mock.onGet(`${BASE}/users/me`).replyWith(() => {
        throw { status: 401, body: { _error_message: 'Unauthorized' }, message: 'Unauthorized' }
      })

      await expect(service.getMe()).rejects.toThrow('Taiga API error (401)')
    })
  })

  // ── Projects ──

  describe('listProjects', () => {
    it('sends GET request with no filters', async () => {
      mockAuth()
      mock.onGet(`${BASE}/projects`).reply([{ id: 1, name: 'Project A' }])

      const result = await service.listProjects()

      expect(result).toEqual([{ id: 1, name: 'Project A' }])
      expect(mock.history[1].method).toBe('get')
      expect(mock.history[1].url).toBe(`${BASE}/projects`)
    })

    it('passes member and slug filters', async () => {
      mockAuth()
      mock.onGet(`${BASE}/projects`).reply([])

      await service.listProjects(5, 'my-project')

      expect(mock.history[1].query).toMatchObject({ member: 5, slug: 'my-project' })
    })

    it('omits undefined filters from query', async () => {
      mockAuth()
      mock.onGet(`${BASE}/projects`).reply([])

      await service.listProjects(undefined, undefined)

      const query = mock.history[1].query
      expect(query).not.toHaveProperty('member')
      expect(query).not.toHaveProperty('slug')
    })
  })

  describe('getProject', () => {
    it('sends GET request with project ID in URL', async () => {
      mockAuth()
      mock.onGet(`${BASE}/projects/42`).reply({ id: 42, name: 'Test Project' })

      const result = await service.getProject(42)

      expect(result).toEqual({ id: 42, name: 'Test Project' })
      expect(mock.history[1].url).toBe(`${BASE}/projects/42`)
    })

    it('throws on API error', async () => {
      mockAuth()
      mock.onGet(`${BASE}/projects/999`).replyWithError({
        message: 'Not Found',
        body: { _error_message: 'Project not found' },
      })

      await expect(service.getProject(999)).rejects.toThrow('Taiga API error')
    })
  })

  describe('getProjectBySlug', () => {
    it('sends GET with slug query parameter', async () => {
      mockAuth()
      mock.onGet(`${BASE}/projects/by_slug`).reply({ id: 1, slug: 'my-project' })

      const result = await service.getProjectBySlug('my-project')

      expect(result).toEqual({ id: 1, slug: 'my-project' })
      expect(mock.history[1].query).toMatchObject({ slug: 'my-project' })
    })
  })

  // ── User Stories ──

  describe('listUserStories', () => {
    it('sends GET with optional filters', async () => {
      mockAuth()
      mock.onGet(`${BASE}/userstories`).reply([{ id: 11, subject: 'Story A' }])

      const result = await service.listUserStories(1, 2, 3)

      expect(result).toEqual([{ id: 11, subject: 'Story A' }])
      expect(mock.history[1].query).toMatchObject({ project: 1, status: 2, milestone: 3 })
    })

    it('omits undefined filters', async () => {
      mockAuth()
      mock.onGet(`${BASE}/userstories`).reply([])

      await service.listUserStories()

      const query = mock.history[1].query
      expect(query).not.toHaveProperty('project')
      expect(query).not.toHaveProperty('status')
      expect(query).not.toHaveProperty('milestone')
    })
  })

  describe('getUserStory', () => {
    it('sends GET with user story ID in URL', async () => {
      mockAuth()
      mock.onGet(`${BASE}/userstories/11`).reply({ id: 11, subject: 'Login flow', version: 2 })

      const result = await service.getUserStory(11)

      expect(result).toEqual({ id: 11, subject: 'Login flow', version: 2 })
    })
  })

  describe('createUserStory', () => {
    it('sends POST with required fields', async () => {
      mockAuth()
      mock.onPost(`${BASE}/userstories`).reply({ id: 12, subject: 'New Story', version: 1 })

      const result = await service.createUserStory(1, 'New Story')

      expect(result).toEqual({ id: 12, subject: 'New Story', version: 1 })
      expect(mock.history[1].method).toBe('post')
      expect(mock.history[1].body).toMatchObject({ project: 1, subject: 'New Story' })
    })

    it('sends POST with all fields', async () => {
      mockAuth()
      mock.onPost(`${BASE}/userstories`).reply({ id: 13, version: 1 })

      await service.createUserStory(1, 'Full Story', 'Description here', 2, 3, ['tag1', 'tag2'])

      expect(mock.history[1].body).toEqual({
        project: 1,
        subject: 'Full Story',
        description: 'Description here',
        status: 2,
        milestone: 3,
        tags: ['tag1', 'tag2'],
      })
    })
  })

  describe('updateUserStory', () => {
    it('sends PATCH with version and updated fields', async () => {
      mockAuth()
      mock.onPatch(`${BASE}/userstories/11`).reply({ id: 11, version: 3 })

      const result = await service.updateUserStory(11, 2, 'Updated Subject', 'New desc', 3, 5, ['t1'])

      expect(result).toEqual({ id: 11, version: 3 })
      expect(mock.history[1].method).toBe('patch')
      expect(mock.history[1].url).toBe(`${BASE}/userstories/11`)
      expect(mock.history[1].body).toEqual({
        version: 2,
        subject: 'Updated Subject',
        description: 'New desc',
        status: 3,
        milestone: 5,
        tags: ['t1'],
      })
    })

    it('sends PATCH with only version and subject', async () => {
      mockAuth()
      mock.onPatch(`${BASE}/userstories/11`).reply({ id: 11, version: 3 })

      await service.updateUserStory(11, 2, 'Just Subject')

      expect(mock.history[1].body).toMatchObject({
        version: 2,
        subject: 'Just Subject',
      })
    })
  })

  describe('deleteUserStory', () => {
    it('sends DELETE and returns confirmation', async () => {
      mockAuth()
      mock.onDelete(`${BASE}/userstories/11`).reply(null)

      const result = await service.deleteUserStory(11)

      expect(result).toEqual({ deleted: true, id: 11 })
      expect(mock.history[1].method).toBe('delete')
      expect(mock.history[1].url).toBe(`${BASE}/userstories/11`)
    })
  })

  // ── Tasks ──

  describe('listTasks', () => {
    it('sends GET with project and user story filters', async () => {
      mockAuth()
      mock.onGet(`${BASE}/tasks`).reply([{ id: 21, subject: 'Task A' }])

      const result = await service.listTasks(1, 11)

      expect(result).toEqual([{ id: 21, subject: 'Task A' }])
      expect(mock.history[1].query).toMatchObject({ project: 1, user_story: 11 })
    })

    it('omits undefined filters', async () => {
      mockAuth()
      mock.onGet(`${BASE}/tasks`).reply([])

      await service.listTasks()

      const query = mock.history[1].query
      expect(query).not.toHaveProperty('project')
      expect(query).not.toHaveProperty('user_story')
    })
  })

  describe('getTask', () => {
    it('sends GET with task ID in URL', async () => {
      mockAuth()
      mock.onGet(`${BASE}/tasks/21`).reply({ id: 21, subject: 'Write tests', version: 1 })

      const result = await service.getTask(21)

      expect(result).toEqual({ id: 21, subject: 'Write tests', version: 1 })
    })
  })

  describe('createTask', () => {
    it('sends POST with required fields', async () => {
      mockAuth()
      mock.onPost(`${BASE}/tasks`).reply({ id: 22, subject: 'New Task', version: 1 })

      const result = await service.createTask(1, 'New Task')

      expect(result).toEqual({ id: 22, subject: 'New Task', version: 1 })
      expect(mock.history[1].body).toMatchObject({ project: 1, subject: 'New Task' })
    })

    it('sends POST with all fields including user_story mapping', async () => {
      mockAuth()
      mock.onPost(`${BASE}/tasks`).reply({ id: 23, version: 1 })

      await service.createTask(1, 'Full Task', 'Task desc', 11, 2)

      expect(mock.history[1].body).toEqual({
        project: 1,
        subject: 'Full Task',
        description: 'Task desc',
        user_story: 11,
        status: 2,
      })
    })
  })

  describe('updateTask', () => {
    it('sends PATCH with version and updated fields', async () => {
      mockAuth()
      mock.onPatch(`${BASE}/tasks/21`).reply({ id: 21, version: 2 })

      const result = await service.updateTask(21, 1, 'Updated Task', 'New desc', 3, 15)

      expect(result).toEqual({ id: 21, version: 2 })
      expect(mock.history[1].body).toEqual({
        version: 1,
        subject: 'Updated Task',
        description: 'New desc',
        status: 3,
        user_story: 15,
      })
    })
  })

  describe('deleteTask', () => {
    it('sends DELETE and returns confirmation', async () => {
      mockAuth()
      mock.onDelete(`${BASE}/tasks/21`).reply(null)

      const result = await service.deleteTask(21)

      expect(result).toEqual({ deleted: true, id: 21 })
      expect(mock.history[1].method).toBe('delete')
    })
  })

  // ── Issues ──

  describe('listIssues', () => {
    it('sends GET with project filter', async () => {
      mockAuth()
      mock.onGet(`${BASE}/issues`).reply([{ id: 31, subject: 'Bug A' }])

      const result = await service.listIssues(1)

      expect(result).toEqual([{ id: 31, subject: 'Bug A' }])
      expect(mock.history[1].query).toMatchObject({ project: 1 })
    })

    it('omits project filter when not provided', async () => {
      mockAuth()
      mock.onGet(`${BASE}/issues`).reply([])

      await service.listIssues()

      expect(mock.history[1].query).not.toHaveProperty('project')
    })
  })

  describe('getIssue', () => {
    it('sends GET with issue ID in URL', async () => {
      mockAuth()
      mock.onGet(`${BASE}/issues/31`).reply({ id: 31, subject: 'Login broken', version: 1 })

      const result = await service.getIssue(31)

      expect(result).toEqual({ id: 31, subject: 'Login broken', version: 1 })
    })
  })

  describe('createIssue', () => {
    it('sends POST with required fields only', async () => {
      mockAuth()
      mock.onPost(`${BASE}/issues`).reply({ id: 32, subject: 'New Bug', version: 1 })

      const result = await service.createIssue(1, 'New Bug')

      expect(result).toEqual({ id: 32, subject: 'New Bug', version: 1 })
      expect(mock.history[1].body).toMatchObject({ project: 1, subject: 'New Bug' })
    })

    it('sends POST with all fields', async () => {
      mockAuth()
      mock.onPost(`${BASE}/issues`).reply({ id: 33, version: 1 })

      await service.createIssue(1, 'Full Issue', 'Issue desc', 3, 2, 1, 4)

      expect(mock.history[1].body).toEqual({
        project: 1,
        subject: 'Full Issue',
        description: 'Issue desc',
        priority: 3,
        severity: 2,
        type: 1,
        status: 4,
      })
    })
  })

  describe('updateIssue', () => {
    it('sends PATCH with version and updated fields', async () => {
      mockAuth()
      mock.onPatch(`${BASE}/issues/31`).reply({ id: 31, version: 2 })

      const result = await service.updateIssue(31, 1, 'Updated Issue', 'New desc', 2, 3, 1, 5)

      expect(result).toEqual({ id: 31, version: 2 })
      expect(mock.history[1].body).toEqual({
        version: 1,
        subject: 'Updated Issue',
        description: 'New desc',
        priority: 2,
        severity: 3,
        type: 1,
        status: 5,
      })
    })
  })

  // ── Epics ──

  describe('listEpics', () => {
    it('sends GET with project filter', async () => {
      mockAuth()
      mock.onGet(`${BASE}/epics`).reply([{ id: 41, subject: 'Epic A' }])

      const result = await service.listEpics(1)

      expect(result).toEqual([{ id: 41, subject: 'Epic A' }])
      expect(mock.history[1].query).toMatchObject({ project: 1 })
    })
  })

  describe('createEpic', () => {
    it('sends POST with required fields', async () => {
      mockAuth()
      mock.onPost(`${BASE}/epics`).reply({ id: 42, subject: 'New Epic', version: 1 })

      const result = await service.createEpic(1, 'New Epic')

      expect(result).toEqual({ id: 42, subject: 'New Epic', version: 1 })
      expect(mock.history[1].body).toMatchObject({ project: 1, subject: 'New Epic' })
    })

    it('sends POST with description', async () => {
      mockAuth()
      mock.onPost(`${BASE}/epics`).reply({ id: 43, version: 1 })

      await service.createEpic(1, 'Epic with Desc', 'Full description')

      expect(mock.history[1].body).toEqual({
        project: 1,
        subject: 'Epic with Desc',
        description: 'Full description',
      })
    })
  })

  // ── Milestones ──

  describe('listMilestones', () => {
    it('sends GET with project filter', async () => {
      mockAuth()
      mock.onGet(`${BASE}/milestones`).reply([{ id: 3, name: 'Sprint 1' }])

      const result = await service.listMilestones(1)

      expect(result).toEqual([{ id: 3, name: 'Sprint 1' }])
      expect(mock.history[1].query).toMatchObject({ project: 1 })
    })
  })

  describe('createMilestone', () => {
    it('sends POST with all required fields and date mapping', async () => {
      mockAuth()
      mock.onPost(`${BASE}/milestones`).reply({ id: 4, name: 'Sprint 5' })

      const result = await service.createMilestone(1, 'Sprint 5', '2026-07-01', '2026-07-14')

      expect(result).toEqual({ id: 4, name: 'Sprint 5' })
      expect(mock.history[1].body).toEqual({
        project: 1,
        name: 'Sprint 5',
        estimated_start: '2026-07-01',
        estimated_finish: '2026-07-14',
      })
    })
  })

  // ── Members ──

  describe('getMe', () => {
    it('returns authenticated user profile', async () => {
      mockAuth()
      mock.onGet(`${BASE}/users/me`).reply({ id: 5, username: 'jane', full_name: 'Jane Doe' })

      const result = await service.getMe()

      expect(result).toEqual({ id: 5, username: 'jane', full_name: 'Jane Doe' })
      expect(mock.history[1].url).toBe(`${BASE}/users/me`)
    })
  })

  describe('listMemberships', () => {
    it('sends GET with project filter', async () => {
      mockAuth()
      mock.onGet(`${BASE}/memberships`).reply([{ id: 7, user: 5, role_name: 'Product Owner' }])

      const result = await service.listMemberships(1)

      expect(result).toEqual([{ id: 7, user: 5, role_name: 'Product Owner' }])
      expect(mock.history[1].query).toMatchObject({ project: 1 })
    })
  })

  // ── Dictionary ──

  describe('getProjectsDictionary', () => {
    it('returns mapped items with label, value and note', async () => {
      mockAuth()
      mock.onGet(`${BASE}/projects`).reply([
        { id: 1, name: 'Alpha', slug: 'alpha' },
        { id: 2, name: 'Beta', slug: 'beta' },
      ])

      const result = await service.getProjectsDictionary({})

      expect(result).toEqual({
        items: [
          { label: 'Alpha', value: 1, note: 'alpha' },
          { label: 'Beta', value: 2, note: 'beta' },
        ],
      })
    })

    it('filters by case-insensitive search', async () => {
      mockAuth()
      mock.onGet(`${BASE}/projects`).reply([
        { id: 1, name: 'Alpha', slug: 'alpha' },
        { id: 2, name: 'Beta', slug: 'beta' },
      ])

      const result = await service.getProjectsDictionary({ search: 'ALP' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe(1)
    })

    it('handles null payload', async () => {
      mockAuth()
      mock.onGet(`${BASE}/projects`).reply([{ id: 1, name: 'A', slug: 'a' }])

      const result = await service.getProjectsDictionary(null)

      expect(result.items).toHaveLength(1)
    })

    it('handles non-array response', async () => {
      mockAuth()
      mock.onGet(`${BASE}/projects`).reply(null)

      const result = await service.getProjectsDictionary({})

      expect(result).toEqual({ items: [] })
    })

    it('returns all items when search is empty string', async () => {
      mockAuth()
      mock.onGet(`${BASE}/projects`).reply([
        { id: 1, name: 'Alpha', slug: 'alpha' },
        { id: 2, name: 'Beta', slug: 'beta' },
      ])

      const result = await service.getProjectsDictionary({ search: '' })

      expect(result.items).toHaveLength(2)
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('extracts _error_message from error body', async () => {
      mockAuth()
      mock.onGet(`${BASE}/projects/999`).replyWithError({
        message: 'Not Found',
        body: { _error_message: 'Project not found' },
      })

      await expect(service.getProject(999)).rejects.toThrow('Project not found')
    })

    it('extracts field-level validation errors', async () => {
      mockAuth()
      mock.onPost(`${BASE}/userstories`).replyWithError({
        message: 'Bad Request',
        body: { subject: ['This field is required'], _error_type: 'validation' },
      })

      await expect(service.createUserStory(1)).rejects.toThrow('subject: This field is required')
    })

    it('uses string body as error message', async () => {
      mockAuth()
      mock.onGet(`${BASE}/issues/999`).replyWithError({
        message: 'Server error',
        body: 'Internal server error occurred',
      })

      await expect(service.getIssue(999)).rejects.toThrow('Internal server error occurred')
    })

    it('falls back to error.message when body is missing', async () => {
      mockAuth()
      mock.onGet(`${BASE}/issues/999`).replyWithError({
        message: 'Network timeout',
      })

      await expect(service.getIssue(999)).rejects.toThrow('Network timeout')
    })

    it('includes status code in error message', async () => {
      mockAuth()
      mock.onGet(`${BASE}/issues/999`).replyWithError({
        message: 'Forbidden',
        body: { _error_message: 'Access denied' },
        status: 403,
      })

      await expect(service.getIssue(999)).rejects.toThrow('Taiga API error (403): Access denied')
    })
  })

  // ── URL handling ──

  describe('URL configuration', () => {
    it('uses the configured URL for API base', () => {
      expect(service.apiBaseUrl).toBe(`${URL}/api/v1`)
      expect(service.authUrl).toBe(`${URL}/api/v1/auth`)
    })

    it('stores username and password from config', () => {
      expect(service.username).toBe(USERNAME)
      expect(service.password).toBe(PASSWORD)
    })
  })
})
