'use strict'

const { createSandbox } = require('../../../service-sandbox')

const ACCESS_TOKEN = 'test-access-token'
const BASE = 'https://gitlab.com/api/v4'

// Encoded 'group/project' path used across path-encoding assertions.
const PATH_PROJECT = 'my-group/my-project'
const PATH_PROJECT_ENC = 'my-group%2Fmy-project'

describe('GitLab Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ accessToken: ACCESS_TOKEN })
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
      expect(sandbox.getConfigItems()).toEqual([
        expect.objectContaining({
          name: 'baseUrl',
          displayName: 'Base URL',
          required: false,
          shared: false,
          type: 'STRING',
          defaultValue: 'https://gitlab.com',
        }),
        expect.objectContaining({
          name: 'accessToken',
          displayName: 'Access Token',
          required: true,
          shared: false,
          type: 'STRING',
        }),
      ])
    })

    it('sends the PRIVATE-TOKEN header (not Bearer) on requests', async () => {
      mock.onGet(`${ BASE }/projects`).reply([])

      await service.listProjects()

      expect(mock.history[0].headers).toMatchObject({
        'PRIVATE-TOKEN': ACCESS_TOKEN,
        'Content-Type': 'application/json',
      })
      // Confirm no Bearer/Authorization header is used.
      expect(mock.history[0].headers).not.toHaveProperty('Authorization')
    })

    it('targets the default gitlab.com/api/v4 base URL', async () => {
      mock.onGet(`${ BASE }/projects`).reply([])

      await service.listProjects()

      expect(mock.history[0].url).toBe(`${ BASE }/projects`)
    })
  })

  // ── Base URL handling (self-hosted) ──

  describe('configurable base URL', () => {
    // Spinning up a second sandbox swaps the global Flowrunner. Capture the
    // primary one so we can restore it and not break the rest of the suite.
    let primaryGlobal

    beforeAll(() => {
      primaryGlobal = global.Flowrunner
    })

    afterAll(() => {
      global.Flowrunner = primaryGlobal
    })

    it('uses a self-hosted base URL and strips a trailing slash', async () => {
      const selfHosted = createSandbox({
        accessToken: 'sh-token',
        baseUrl: 'https://gitlab.example.com/',
      })
      // The module is cached, so re-requiring won't re-register on the new
      // runtime. Instantiate the service class directly against the new global.
      const GitLab = require('../src/index.js')
      const shService = new GitLab({
        accessToken: 'sh-token',
        baseUrl: 'https://gitlab.example.com/',
      })
      const shMock = selfHosted.getRequestMock()

      const shBase = 'https://gitlab.example.com/api/v4'
      shMock.onGet(`${ shBase }/projects`).reply([])

      await shService.listProjects()

      expect(shMock.history[0].url).toBe(`${ shBase }/projects`)
      expect(shMock.history[0].headers).toMatchObject({ 'PRIVATE-TOKEN': 'sh-token' })
      expect(shMock.history[0].url).not.toContain('gitlab.com')

      selfHosted.cleanup()
    })
  })

  // ── Project path encoding ──

  describe('project reference encoding', () => {
    it('passes a numeric project id through unchanged', async () => {
      mock.onGet(`${ BASE }/projects/12345`).reply({ id: 12345 })

      await service.getProject(12345)

      expect(mock.history[0].url).toBe(`${ BASE }/projects/12345`)
    })

    it('passes a numeric-string project id through unchanged', async () => {
      mock.onGet(`${ BASE }/projects/12345`).reply({ id: 12345 })

      await service.getProject('12345')

      expect(mock.history[0].url).toBe(`${ BASE }/projects/12345`)
    })

    it('url-encodes a group/project path (slash becomes %2F)', async () => {
      mock.onGet(`${ BASE }/projects/${ PATH_PROJECT_ENC }`).reply({ id: 12345 })

      await service.getProject(PATH_PROJECT)

      expect(mock.history[0].url).toBe(`${ BASE }/projects/${ PATH_PROJECT_ENC }`)
      expect(mock.history[0].url).toContain('%2F')
      expect(mock.history[0].url).not.toContain('my-group/my-project')
    })
  })

  // ── Dictionaries ──

  describe('getProjectsDictionary', () => {
    it('maps projects to items and hits the projects endpoint with membership', async () => {
      mock.onGet(`${ BASE }/projects`).reply([
        { id: 1, name: 'Alpha', name_with_namespace: 'Group / Alpha', path_with_namespace: 'group/alpha' },
        { id: 2, name: 'Beta', name_with_namespace: 'Group / Beta', path_with_namespace: 'group/beta' },
      ])

      const result = await service.getProjectsDictionary({})

      expect(mock.history[0].url).toBe(`${ BASE }/projects`)
      expect(mock.history[0].query).toMatchObject({
        membership: true,
        per_page: 100,
        page: 1,
        order_by: 'last_activity_at',
      })
      expect(result.items).toEqual([
        { label: 'Group / Alpha', value: '1', note: 'Path: group/alpha' },
        { label: 'Group / Beta', value: '2', note: 'Path: group/beta' },
      ])
      expect(result.cursor).toBeNull()
    })

    it('passes the search term and cursor page through', async () => {
      mock.onGet(`${ BASE }/projects`).reply([])

      await service.getProjectsDictionary({ search: 'alpha', cursor: '3' })

      expect(mock.history[0].query).toMatchObject({ search: 'alpha', page: 3 })
    })

    it('falls back to path_with_namespace for the label when name_with_namespace is absent', async () => {
      mock.onGet(`${ BASE }/projects`).reply([
        { id: 5, name: 'Gamma', path_with_namespace: 'group/gamma' },
      ])

      const result = await service.getProjectsDictionary({})

      expect(result.items[0].label).toBe('group/gamma')
    })

    it('returns a next-page cursor when a full page (100) is returned', async () => {
      const full = Array.from({ length: 100 }, (_, i) => ({
        id: i + 1,
        name: `P${ i }`,
        path_with_namespace: `group/p${ i }`,
      }))
      mock.onGet(`${ BASE }/projects`).reply(full)

      const result = await service.getProjectsDictionary({ cursor: '2' })

      expect(result.cursor).toBe('3')
    })

    it('handles a null payload', async () => {
      mock.onGet(`${ BASE }/projects`).reply([])

      const result = await service.getProjectsDictionary(null)

      expect(result.items).toEqual([])
      expect(result.cursor).toBeNull()
    })
  })

  describe('getBranchesDictionary', () => {
    it('maps branches to items and encodes the criteria project path', async () => {
      mock.onGet(`${ BASE }/projects/${ PATH_PROJECT_ENC }/repository/branches`).reply([
        { name: 'main', default: true },
        { name: 'develop', default: false },
      ])

      const result = await service.getBranchesDictionary({ criteria: { project: PATH_PROJECT } })

      expect(mock.history[0].url).toBe(`${ BASE }/projects/${ PATH_PROJECT_ENC }/repository/branches`)
      expect(mock.history[0].query).toMatchObject({ per_page: 100, page: 1 })
      expect(result.items).toEqual([
        { label: 'main', value: 'main', note: 'Default: true' },
        { label: 'develop', value: 'develop', note: 'Default: false' },
      ])
      expect(result.cursor).toBeNull()
    })

    it('passes search and cursor page through', async () => {
      mock.onGet(`${ BASE }/projects/12345/repository/branches`).reply([])

      await service.getBranchesDictionary({
        search: 'feat',
        cursor: '4',
        criteria: { project: '12345' },
      })

      expect(mock.history[0].query).toMatchObject({ search: 'feat', page: 4 })
    })

    it('returns a next-page cursor when a full page (100) is returned', async () => {
      const full = Array.from({ length: 100 }, (_, i) => ({ name: `b${ i }`, default: false }))
      mock.onGet(`${ BASE }/projects/12345/repository/branches`).reply(full)

      const result = await service.getBranchesDictionary({ criteria: { project: '12345' } })

      expect(result.cursor).toBe('2')
    })
  })

  // ── Projects ──

  describe('listProjects', () => {
    it('sends default query (membership + order) with no optional params', async () => {
      mock.onGet(`${ BASE }/projects`).reply([])

      await service.listProjects()

      expect(mock.history[0].query).toEqual({
        membership: true,
        order_by: 'last_activity_at',
      })
    })

    it('includes search and pagination when provided', async () => {
      mock.onGet(`${ BASE }/projects`).reply([{ id: 1 }])

      await service.listProjects('acme', 2, 50)

      expect(mock.history[0].query).toEqual({
        membership: true,
        order_by: 'last_activity_at',
        search: 'acme',
        page: 2,
        per_page: 50,
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/projects`).replyWithError({ message: 'Unauthorized', status: 401 })

      await expect(service.listProjects()).rejects.toThrow('GitLab API error: Unauthorized')
    })
  })

  describe('getProject', () => {
    it('fetches a project by encoded path', async () => {
      mock.onGet(`${ BASE }/projects/${ PATH_PROJECT_ENC }`).reply({ id: 12345, name: 'My Project' })

      const result = await service.getProject(PATH_PROJECT)

      expect(result).toEqual({ id: 12345, name: 'My Project' })
    })

    it('surfaces the string message from an object-shaped error body', async () => {
      mock.onGet(`${ BASE }/projects/999`).replyWithError({
        status: 404,
        body: { message: '404 Project Not Found' },
      })

      await expect(service.getProject('999')).rejects.toThrow('GitLab API error: 404 Project Not Found')
    })

    it('stringifies an object-valued message in the error', async () => {
      mock.onGet(`${ BASE }/projects/999`).replyWithError({
        status: 400,
        body: { message: { base: ['is invalid'] } },
      })

      await expect(service.getProject('999')).rejects.toThrow('{"base":["is invalid"]}')
    })

    it('falls back to body.error when no message is present', async () => {
      mock.onGet(`${ BASE }/projects/999`).replyWithError({
        status: 403,
        body: { error: 'insufficient_scope' },
      })

      await expect(service.getProject('999')).rejects.toThrow('GitLab API error: insufficient_scope')
    })
  })

  // ── Issues ──

  describe('createIssue', () => {
    it('sends POST with required params only', async () => {
      mock.onPost(`${ BASE }/projects/12345/issues`).reply({ id: 76, iid: 6 })

      const result = await service.createIssue('12345', 'Found a bug')

      expect(result).toEqual({ id: 76, iid: 6 })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({ title: 'Found a bug' })
    })

    it('includes all optional params and parses assignee IDs', async () => {
      mock.onPost(`${ BASE }/projects/${ PATH_PROJECT_ENC }/issues`).reply({ id: 77 })

      await service.createIssue(
        PATH_PROJECT,
        'Bug',
        'A description',
        'bug,urgent',
        '10, 20, bad',
        99,
        '2025-06-01'
      )

      expect(mock.history[0].body).toEqual({
        title: 'Bug',
        description: 'A description',
        labels: 'bug,urgent',
        assignee_ids: [10, 20],
        milestone_id: 99,
        due_date: '2025-06-01',
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/projects/12345/issues`).replyWithError({ message: 'Boom', status: 500 })

      await expect(service.createIssue('12345', 'Bug')).rejects.toThrow('GitLab API error: Boom')
    })
  })

  describe('getIssue', () => {
    it('fetches an issue by project and iid', async () => {
      mock.onGet(`${ BASE }/projects/12345/issues/6`).reply({ id: 76, iid: 6 })

      const result = await service.getIssue('12345', 6)

      expect(result).toEqual({ id: 76, iid: 6 })
      expect(mock.history[0].url).toBe(`${ BASE }/projects/12345/issues/6`)
    })
  })

  describe('listIssues', () => {
    it('sends empty query with required param only', async () => {
      mock.onGet(`${ BASE }/projects/12345/issues`).reply([])

      await service.listIssues('12345')

      expect(mock.history[0].query).toEqual({})
    })

    it('maps the State choice and includes all filters', async () => {
      mock.onGet(`${ BASE }/projects/12345/issues`).reply([])

      await service.listIssues('12345', 'Opened', 'bug', 'octocat', 'crash', 2, 25)

      expect(mock.history[0].query).toEqual({
        state: 'opened',
        labels: 'bug',
        assignee_username: 'octocat',
        search: 'crash',
        page: 2,
        per_page: 25,
      })
    })

    it('passes an unknown state through unchanged', async () => {
      mock.onGet(`${ BASE }/projects/12345/issues`).reply([])

      await service.listIssues('12345', 'weird')

      expect(mock.history[0].query).toEqual({ state: 'weird' })
    })
  })

  describe('updateIssue', () => {
    it('sends PUT with the mapped state event and parsed assignees', async () => {
      mock.onPut(`${ BASE }/projects/12345/issues/6`).reply({ id: 76, state: 'closed' })

      const result = await service.updateIssue(
        '12345',
        6,
        'New title',
        'New body',
        'Close',
        'bug',
        '1,2',
        3,
        '2025-07-01'
      )

      expect(result).toEqual({ id: 76, state: 'closed' })
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].body).toEqual({
        title: 'New title',
        description: 'New body',
        state_event: 'close',
        labels: 'bug',
        assignee_ids: [1, 2],
        milestone_id: 3,
        due_date: '2025-07-01',
      })
    })

    it('sends an empty body when no fields change', async () => {
      mock.onPut(`${ BASE }/projects/12345/issues/6`).reply({ id: 76 })

      await service.updateIssue('12345', 6)

      expect(mock.history[0].body).toEqual({})
    })
  })

  describe('createIssueNote', () => {
    it('POSTs the note body', async () => {
      mock.onPost(`${ BASE }/projects/12345/issues/6/notes`).reply({ id: 302, body: 'A comment.' })

      const result = await service.createIssueNote('12345', 6, 'A comment.')

      expect(result).toEqual({ id: 302, body: 'A comment.' })
      expect(mock.history[0].url).toBe(`${ BASE }/projects/12345/issues/6/notes`)
      expect(mock.history[0].body).toEqual({ body: 'A comment.' })
    })
  })

  // ── Merge Requests ──

  describe('createMergeRequest', () => {
    it('sends POST with required params only', async () => {
      mock.onPost(`${ BASE }/projects/12345/merge_requests`).reply({ id: 101, iid: 12 })

      const result = await service.createMergeRequest('12345', 'feature', 'main', 'Add feature')

      expect(result).toEqual({ id: 101, iid: 12 })
      expect(mock.history[0].body).toEqual({
        source_branch: 'feature',
        target_branch: 'main',
        title: 'Add feature',
      })
    })

    it('includes description and remove_source_branch when provided', async () => {
      mock.onPost(`${ BASE }/projects/12345/merge_requests`).reply({ id: 102 })

      await service.createMergeRequest('12345', 'feature', 'main', 'Add feature', 'Desc', true)

      expect(mock.history[0].body).toEqual({
        source_branch: 'feature',
        target_branch: 'main',
        title: 'Add feature',
        description: 'Desc',
        remove_source_branch: true,
      })
    })

    it('coerces remove_source_branch false and keeps it in the body', async () => {
      mock.onPost(`${ BASE }/projects/12345/merge_requests`).reply({ id: 103 })

      await service.createMergeRequest('12345', 'feature', 'main', 'Add feature', undefined, false)

      expect(mock.history[0].body).toEqual({
        source_branch: 'feature',
        target_branch: 'main',
        title: 'Add feature',
        remove_source_branch: false,
      })
    })
  })

  describe('getMergeRequest', () => {
    it('fetches an MR by project and iid', async () => {
      mock.onGet(`${ BASE }/projects/12345/merge_requests/12`).reply({ id: 101, iid: 12 })

      const result = await service.getMergeRequest('12345', 12)

      expect(result).toEqual({ id: 101, iid: 12 })
    })
  })

  describe('listMergeRequests', () => {
    it('sends empty query with required param only', async () => {
      mock.onGet(`${ BASE }/projects/12345/merge_requests`).reply([])

      await service.listMergeRequests('12345')

      expect(mock.history[0].query).toEqual({})
    })

    it('maps the Merged state and includes search/pagination', async () => {
      mock.onGet(`${ BASE }/projects/12345/merge_requests`).reply([])

      await service.listMergeRequests('12345', 'Merged', 'feat', 3, 10)

      expect(mock.history[0].query).toEqual({
        state: 'merged',
        search: 'feat',
        page: 3,
        per_page: 10,
      })
    })
  })

  describe('updateMergeRequest', () => {
    it('sends PUT with mapped state event and target branch', async () => {
      mock.onPut(`${ BASE }/projects/12345/merge_requests/12`).reply({ id: 101, state: 'closed' })

      await service.updateMergeRequest('12345', 12, 'Title', 'Body', 'develop', 'Close')

      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].body).toEqual({
        title: 'Title',
        description: 'Body',
        target_branch: 'develop',
        state_event: 'close',
      })
    })

    it('sends an empty body when nothing is provided', async () => {
      mock.onPut(`${ BASE }/projects/12345/merge_requests/12`).reply({ id: 101 })

      await service.updateMergeRequest('12345', 12)

      expect(mock.history[0].body).toEqual({})
    })
  })

  describe('mergeMergeRequest', () => {
    it('sends PUT to the merge endpoint with required params only', async () => {
      mock.onPut(`${ BASE }/projects/12345/merge_requests/12/merge`).reply({ id: 101, state: 'merged' })

      const result = await service.mergeMergeRequest('12345', 12)

      expect(result).toEqual({ id: 101, state: 'merged' })
      expect(mock.history[0].url).toBe(`${ BASE }/projects/12345/merge_requests/12/merge`)
      expect(mock.history[0].body).toEqual({})
    })

    it('includes merge commit message and squash when provided', async () => {
      mock.onPut(`${ BASE }/projects/12345/merge_requests/12/merge`).reply({ id: 101 })

      await service.mergeMergeRequest('12345', 12, 'Merged!', true)

      expect(mock.history[0].body).toEqual({
        merge_commit_message: 'Merged!',
        squash: true,
      })
    })
  })

  describe('addMergeRequestNote', () => {
    it('POSTs the note body', async () => {
      mock.onPost(`${ BASE }/projects/12345/merge_requests/12/notes`).reply({ id: 305, body: 'LGTM' })

      const result = await service.addMergeRequestNote('12345', 12, 'LGTM')

      expect(result).toEqual({ id: 305, body: 'LGTM' })
      expect(mock.history[0].body).toEqual({ body: 'LGTM' })
    })
  })

  // ── Repository ──

  describe('listBranches', () => {
    it('sends empty query with required param only', async () => {
      mock.onGet(`${ BASE }/projects/12345/repository/branches`).reply([])

      await service.listBranches('12345')

      expect(mock.history[0].query).toEqual({})
    })

    it('includes search and pagination when provided', async () => {
      mock.onGet(`${ BASE }/projects/12345/repository/branches`).reply([])

      await service.listBranches('12345', 'main', 1, 20)

      expect(mock.history[0].query).toEqual({ search: 'main', page: 1, per_page: 20 })
    })
  })

  describe('createBranch', () => {
    it('POSTs branch/ref as query params (not body)', async () => {
      mock.onPost(`${ BASE }/projects/12345/repository/branches`).reply({ name: 'new-feature' })

      const result = await service.createBranch('12345', 'new-feature', 'main')

      expect(result).toEqual({ name: 'new-feature' })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].query).toEqual({ branch: 'new-feature', ref: 'main' })
      expect(mock.history[0].body).toBeUndefined()
    })
  })

  describe('deleteBranch', () => {
    it('sends DELETE with the encoded branch name and returns success', async () => {
      mock.onDelete(`${ BASE }/projects/12345/repository/branches/feature%2Ffoo`).reply(undefined)

      const result = await service.deleteBranch('12345', 'feature/foo')

      expect(result).toEqual({ success: true, branch: 'feature/foo' })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${ BASE }/projects/12345/repository/branches/feature%2Ffoo`)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onDelete(`${ BASE }/projects/12345/repository/branches/main`).replyWithError({
        message: 'protected branch',
        status: 400,
      })

      await expect(service.deleteBranch('12345', 'main')).rejects.toThrow('GitLab API error: protected branch')
    })
  })

  describe('getFile', () => {
    it('decodes base64 content and marks it raw', async () => {
      const content = Buffer.from("console.log('hi')", 'utf8').toString('base64')
      mock.onGet(`${ BASE }/projects/12345/repository/files/src%2Findex.js`).reply({
        file_name: 'index.js',
        file_path: 'src/index.js',
        encoding: 'base64',
        content,
      })

      const result = await service.getFile('12345', 'src/index.js', 'main')

      expect(mock.history[0].url).toBe(`${ BASE }/projects/12345/repository/files/src%2Findex.js`)
      expect(mock.history[0].query).toEqual({ ref: 'main' })
      expect(result.content).toBe("console.log('hi')")
      expect(result.raw).toBe(true)
      expect(result.file_path).toBe('src/index.js')
    })

    it('passes through non-base64 content unchanged', async () => {
      mock.onGet(`${ BASE }/projects/12345/repository/files/README.md`).reply({
        file_path: 'README.md',
        encoding: 'text',
        content: 'plain text',
      })

      const result = await service.getFile('12345', 'README.md', 'main')

      expect(result.content).toBe('plain text')
      expect(result.raw).toBe(true)
    })
  })

  describe('saveFile', () => {
    const fileUrl = `${ BASE }/projects/12345/repository/files/src%2Fapp.js`

    it('creates via POST when the file does not exist (404 on existence check)', async () => {
      // Existence check GET returns 404, then the save POSTs.
      mock.onGet(fileUrl).replyWithError({ status: 404, body: { message: '404 Not Found' } })
      mock.onPost(fileUrl).reply({ file_path: 'src/app.js', branch: 'main' })

      const result = await service.saveFile('12345', 'src/app.js', 'main', 'contents', 'add app')

      expect(result).toEqual({ file_path: 'src/app.js', branch: 'main' })
      // Two requests: existence check (get) then create (post).
      expect(mock.history.map(h => h.method)).toEqual(['get', 'post'])
      expect(mock.history[0].query).toEqual({ ref: 'main' })
      expect(mock.history[1].method).toBe('post')
      expect(mock.history[1].body).toEqual({
        branch: 'main',
        content: 'contents',
        commit_message: 'add app',
      })
    })

    it('updates via PUT when the file already exists', async () => {
      mock.onGet(fileUrl).reply({ file_path: 'src/app.js', content: 'existing' })
      mock.onPut(fileUrl).reply({ file_path: 'src/app.js', branch: 'main' })

      const result = await service.saveFile('12345', 'src/app.js', 'main', 'new contents', 'update app')

      expect(result).toEqual({ file_path: 'src/app.js', branch: 'main' })
      expect(mock.history.map(h => h.method)).toEqual(['get', 'put'])
      expect(mock.history[1].body).toEqual({
        branch: 'main',
        content: 'new contents',
        commit_message: 'update app',
      })
    })

    it('re-throws a non-404 error from the existence check', async () => {
      mock.onGet(fileUrl).replyWithError({ status: 500, body: { message: 'server error' } })

      await expect(service.saveFile('12345', 'src/app.js', 'main', 'x', 'msg')).rejects.toThrow(
        'GitLab API error: server error'
      )
      // Only the existence check ran; no create/update was attempted.
      expect(mock.history).toHaveLength(1)
    })
  })

  describe('listCommits', () => {
    it('sends empty query with required param only', async () => {
      mock.onGet(`${ BASE }/projects/12345/repository/commits`).reply([])

      await service.listCommits('12345')

      expect(mock.history[0].query).toEqual({})
    })

    it('maps ref to ref_name and includes pagination', async () => {
      mock.onGet(`${ BASE }/projects/12345/repository/commits`).reply([])

      await service.listCommits('12345', 'main', 2, 30)

      expect(mock.history[0].query).toEqual({ ref_name: 'main', page: 2, per_page: 30 })
    })
  })

  describe('createCommit', () => {
    it('POSTs the branch, message and actions array', async () => {
      mock.onPost(`${ BASE }/projects/12345/repository/commits`).reply({ id: 'abc123' })

      const actions = [{ action: 'create', file_path: 'a.txt', content: 'hi' }]
      const result = await service.createCommit('12345', 'main', 'Add files', actions)

      expect(result).toEqual({ id: 'abc123' })
      expect(mock.history[0].body).toEqual({
        branch: 'main',
        commit_message: 'Add files',
        actions,
      })
    })

    it('defaults actions to an empty array when not an array', async () => {
      mock.onPost(`${ BASE }/projects/12345/repository/commits`).reply({ id: 'abc124' })

      await service.createCommit('12345', 'main', 'Empty', undefined)

      expect(mock.history[0].body.actions).toEqual([])
    })
  })

  // ── Pipelines ──

  describe('listPipelines', () => {
    it('sends empty query with required param only', async () => {
      mock.onGet(`${ BASE }/projects/12345/pipelines`).reply([])

      await service.listPipelines('12345')

      expect(mock.history[0].query).toEqual({})
    })

    it('maps the Status choice and includes ref/pagination', async () => {
      mock.onGet(`${ BASE }/projects/12345/pipelines`).reply([])

      await service.listPipelines('12345', 'main', 'Success', 1, 10)

      expect(mock.history[0].query).toEqual({
        ref: 'main',
        status: 'success',
        page: 1,
        per_page: 10,
      })
    })
  })

  describe('getPipeline', () => {
    it('fetches a pipeline by numeric id', async () => {
      mock.onGet(`${ BASE }/projects/12345/pipelines/501`).reply({ id: 501, status: 'success' })

      const result = await service.getPipeline('12345', 501)

      expect(result).toEqual({ id: 501, status: 'success' })
    })
  })

  describe('triggerPipeline', () => {
    it('POSTs the ref to the pipeline endpoint', async () => {
      mock.onPost(`${ BASE }/projects/12345/pipeline`).reply({ id: 502, status: 'created' })

      const result = await service.triggerPipeline('12345', 'main')

      expect(result).toEqual({ id: 502, status: 'created' })
      expect(mock.history[0].url).toBe(`${ BASE }/projects/12345/pipeline`)
      expect(mock.history[0].body).toEqual({ ref: 'main' })
    })
  })

  describe('retryPipeline', () => {
    it('POSTs to the retry endpoint', async () => {
      mock.onPost(`${ BASE }/projects/12345/pipelines/501/retry`).reply({ id: 501, status: 'running' })

      const result = await service.retryPipeline('12345', 501)

      expect(result).toEqual({ id: 501, status: 'running' })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/projects/12345/pipelines/501/retry`)
    })
  })

  describe('cancelPipeline', () => {
    it('POSTs to the cancel endpoint', async () => {
      mock.onPost(`${ BASE }/projects/12345/pipelines/501/cancel`).reply({ id: 501, status: 'canceled' })

      const result = await service.cancelPipeline('12345', 501)

      expect(result).toEqual({ id: 501, status: 'canceled' })
      expect(mock.history[0].url).toBe(`${ BASE }/projects/12345/pipelines/501/cancel`)
    })
  })

  // ── Releases ──

  describe('listReleases', () => {
    it('sends empty query with required param only', async () => {
      mock.onGet(`${ BASE }/projects/12345/releases`).reply([])

      await service.listReleases('12345')

      expect(mock.history[0].query).toEqual({})
    })

    it('includes pagination when provided', async () => {
      mock.onGet(`${ BASE }/projects/12345/releases`).reply([])

      await service.listReleases('12345', 2, 5)

      expect(mock.history[0].query).toEqual({ page: 2, per_page: 5 })
    })
  })

  describe('createRelease', () => {
    it('POSTs with required params only', async () => {
      mock.onPost(`${ BASE }/projects/12345/releases`).reply({ tag_name: 'v1.0.0' })

      const result = await service.createRelease('12345', 'v1.0.0')

      expect(result).toEqual({ tag_name: 'v1.0.0' })
      expect(mock.history[0].body).toEqual({ tag_name: 'v1.0.0' })
    })

    it('includes name, description and ref when provided', async () => {
      mock.onPost(`${ BASE }/projects/12345/releases`).reply({ tag_name: 'v2.0.0' })

      await service.createRelease('12345', 'v2.0.0', 'Version 2', 'Notes', 'main')

      expect(mock.history[0].body).toEqual({
        tag_name: 'v2.0.0',
        name: 'Version 2',
        description: 'Notes',
        ref: 'main',
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/projects/12345/releases`).replyWithError({ message: 'Tag exists', status: 409 })

      await expect(service.createRelease('12345', 'v1.0.0')).rejects.toThrow('GitLab API error: Tag exists')
    })
  })
})
