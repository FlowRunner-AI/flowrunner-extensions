'use strict'

const { createSandbox } = require('../../../service-sandbox')

const EMAIL = 'tester@example.com'
const API_TOKEN = 'test-api-token'
const WORKSPACE = 'my-workspace'
const BASE = `https://api.bitbucket.org/2.0/repositories/${ WORKSPACE }`

// Basic auth header the service is expected to send: base64 of "email:apiToken".
const EXPECTED_AUTH = `Basic ${ Buffer.from(`${ EMAIL }:${ API_TOKEN }`).toString('base64') }`

describe('Bitbucket Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ email: EMAIL, apiToken: API_TOKEN, workspace: WORKSPACE })
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
          name: 'email',
          displayName: 'Account Email',
          required: true,
          shared: false,
          type: 'STRING',
        }),
        expect.objectContaining({
          name: 'apiToken',
          displayName: 'API Token',
          required: true,
          shared: false,
          type: 'STRING',
        }),
        expect.objectContaining({
          name: 'workspace',
          displayName: 'Workspace ID',
          required: true,
          shared: false,
          type: 'STRING',
        }),
      ])
    })

    it('sends the Basic auth header derived from email:apiToken', async () => {
      mock.onGet(`${ BASE }/my-repo`).reply({ slug: 'my-repo' })

      await service.getRepository('my-repo')

      expect(mock.history[0].headers).toMatchObject({
        Authorization: EXPECTED_AUTH,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      })
    })
  })

  // ── Dictionaries ──

  describe('getRepositoriesDictionary', () => {
    it('lists repositories and maps them to items with default pagination', async () => {
      mock.onGet(`${ BASE }`).reply({
        values: [
          { name: 'Repo One', slug: 'repo-one', is_private: true },
          { name: 'Repo Two', slug: 'repo-two', is_private: false },
        ],
        next: null,
      })

      const result = await service.getRepositoriesDictionary({})

      expect(mock.history[0].url).toBe(`${ BASE }`)
      expect(mock.history[0].query).toMatchObject({ pagelen: 100, page: 1, sort: '-updated_on' })
      expect(result.items).toEqual([
        { label: 'Repo One', value: 'repo-one', note: 'Private: true' },
        { label: 'Repo Two', value: 'repo-two', note: 'Private: false' },
      ])
      expect(result.cursor).toBeNull()
    })

    it('applies a BBQL search filter and returns the next cursor', async () => {
      mock.onGet(`${ BASE }`).reply({
        values: [{ name: 'API', slug: 'api', is_private: true }],
        next: 'https://api.bitbucket.org/2.0/repositories/my-workspace?page=2',
      })

      const result = await service.getRepositoriesDictionary({ search: 'api', cursor: '1' })

      expect(mock.history[0].query.q).toBe('name ~ "api"')
      expect(result.cursor).toBe('2')
    })

    it('parses cursor into the page query param', async () => {
      mock.onGet(`${ BASE }`).reply({ values: [], next: null })

      await service.getRepositoriesDictionary({ cursor: '3' })

      expect(mock.history[0].query).toMatchObject({ page: 3 })
    })

    it('handles a null payload and empty values', async () => {
      mock.onGet(`${ BASE }`).reply({})

      const result = await service.getRepositoriesDictionary(null)

      expect(result.items).toEqual([])
      expect(result.cursor).toBeNull()
    })
  })

  describe('getBranchesDictionary', () => {
    it('lists branches for the criteria repo and maps them to items', async () => {
      mock.onGet(`${ BASE }/repo-one/refs/branches`).reply({
        values: [
          { name: 'main', target: { hash: 'a1b2c3d4e5f6' } },
          { name: 'develop', target: { hash: 'deadbeef1234' } },
        ],
        next: null,
      })

      const result = await service.getBranchesDictionary({ criteria: { repo_slug: 'repo-one' } })

      expect(mock.history[0].url).toBe(`${ BASE }/repo-one/refs/branches`)
      expect(mock.history[0].query).toMatchObject({ pagelen: 100, page: 1 })
      expect(result.items).toEqual([
        { label: 'main', value: 'main', note: 'Target: a1b2c3d' },
        { label: 'develop', value: 'develop', note: 'Target: deadbee' },
      ])
      expect(result.cursor).toBeNull()
    })

    it('applies a search filter and returns the next cursor', async () => {
      mock.onGet(`${ BASE }/repo-one/refs/branches`).reply({
        values: [{ name: 'feature/x', target: { hash: 'abc1234' } }],
        next: 'https://api.bitbucket.org/2.0/repositories/my-workspace/repo-one/refs/branches?page=2',
      })

      const result = await service.getBranchesDictionary({
        search: 'feature',
        cursor: '1',
        criteria: { repo_slug: 'repo-one' },
      })

      expect(mock.history[0].query.q).toBe('name ~ "feature"')
      expect(result.cursor).toBe('2')
    })

    it('handles branches without a target hash', async () => {
      mock.onGet(`${ BASE }/repo-one/refs/branches`).reply({
        values: [{ name: 'empty' }],
        next: null,
      })

      const result = await service.getBranchesDictionary({ criteria: { repo_slug: 'repo-one' } })

      expect(result.items).toEqual([{ label: 'empty', value: 'empty', note: 'Target: ' }])
    })
  })

  // ── Repositories ──

  describe('listRepositories', () => {
    it('paginates with default pagelen and no filters', async () => {
      mock.onGet(`${ BASE }`).reply({
        values: [{ slug: 'repo-one' }],
        next: null,
      })

      const result = await service.listRepositories()

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].query).toEqual({ pagelen: 100 })
      expect(result).toEqual([{ slug: 'repo-one' }])
    })

    it('resolves role and sort choices and passes a raw query', async () => {
      mock.onGet(`${ BASE }`).reply({ values: [], next: null })

      await service.listRepositories('Admin', 'name ~ "api"', 'Name (A-Z)')

      expect(mock.history[0].query).toEqual({
        role: 'admin',
        q: 'name ~ "api"',
        sort: 'name',
        pagelen: 100,
      })
    })

    it('aggregates values across multiple pages', async () => {
      const page2 = `${ BASE }?page=2`
      mock.onGet(`${ BASE }`).reply({ values: [{ slug: 'a' }], next: page2 })
      mock.onGet(page2).reply({ values: [{ slug: 'b' }], next: null })

      const result = await service.listRepositories()

      expect(result).toEqual([{ slug: 'a' }, { slug: 'b' }])
      expect(mock.history).toHaveLength(2)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }`).replyWithError({
        status: 401,
        body: { error: { message: 'Unauthorized' } },
      })

      await expect(service.listRepositories()).rejects.toThrow('Bitbucket API error: Unauthorized')
    })
  })

  describe('getRepository', () => {
    it('fetches a single repository', async () => {
      mock.onGet(`${ BASE }/repo-one`).reply({ slug: 'repo-one', name: 'Repo One' })

      const result = await service.getRepository('repo-one')

      expect(result).toEqual({ slug: 'repo-one', name: 'Repo One' })
      expect(mock.history[0].method).toBe('get')
    })

    it('throws a wrapped error with detail appended', async () => {
      mock.onGet(`${ BASE }/repo-one`).replyWithError({
        status: 404,
        body: { error: { message: 'Not found', detail: 'No such repository' } },
      })

      await expect(service.getRepository('repo-one')).rejects.toThrow(
        'Bitbucket API error: Not found: No such repository'
      )
    })
  })

  // ── Issues ──

  describe('createIssue', () => {
    it('sends with required params only', async () => {
      mock.onPost(`${ BASE }/repo-one/issues`).reply({ id: 1, title: 'Bug' })

      const result = await service.createIssue('repo-one', 'Bug')

      expect(result).toEqual({ id: 1, title: 'Bug' })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({ title: 'Bug' })
    })

    it('includes all optional params and resolves choices', async () => {
      mock.onPost(`${ BASE }/repo-one/issues`).reply({ id: 2 })

      await service.createIssue('repo-one', 'Bug', 'Details', 'Enhancement', 'Critical', 'acc-123')

      expect(mock.history[0].body).toEqual({
        title: 'Bug',
        content: { raw: 'Details' },
        kind: 'enhancement',
        priority: 'critical',
        assignee: { account_id: 'acc-123' },
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/repo-one/issues`).replyWithError({
        body: { error: { message: 'Issue tracker disabled' } },
      })

      await expect(service.createIssue('repo-one', 'Bug')).rejects.toThrow(
        'Bitbucket API error: Issue tracker disabled'
      )
    })
  })

  describe('getIssue', () => {
    it('fetches an issue by id', async () => {
      mock.onGet(`${ BASE }/repo-one/issues/5`).reply({ id: 5 })

      const result = await service.getIssue('repo-one', 5)

      expect(result).toEqual({ id: 5 })
      expect(mock.history[0].url).toBe(`${ BASE }/repo-one/issues/5`)
    })
  })

  describe('listIssues', () => {
    it('paginates with default pagelen and no query', async () => {
      mock.onGet(`${ BASE }/repo-one/issues`).reply({ values: [{ id: 1 }], next: null })

      const result = await service.listIssues('repo-one')

      expect(mock.history[0].query).toEqual({ pagelen: 50 })
      expect(result).toEqual([{ id: 1 }])
    })

    it('includes a BBQL query when provided', async () => {
      mock.onGet(`${ BASE }/repo-one/issues`).reply({ values: [], next: null })

      await service.listIssues('repo-one', 'state = "new"')

      expect(mock.history[0].query).toEqual({ q: 'state = "new"', pagelen: 50 })
    })
  })

  describe('updateIssue', () => {
    it('sends put with only the fields provided', async () => {
      mock.onPut(`${ BASE }/repo-one/issues/5`).reply({ id: 5 })

      const result = await service.updateIssue('repo-one', 5, 'New title')

      expect(result).toEqual({ id: 5 })
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].body).toEqual({ title: 'New title' })
    })

    it('resolves state, kind, and priority choices', async () => {
      mock.onPut(`${ BASE }/repo-one/issues/5`).reply({ id: 5 })

      await service.updateIssue('repo-one', 5, 'Title', 'Body', 'Resolved', 'Task', 'Blocker', 'acc-9')

      expect(mock.history[0].body).toEqual({
        title: 'Title',
        content: { raw: 'Body' },
        state: 'resolved',
        kind: 'task',
        priority: 'blocker',
        assignee: { account_id: 'acc-9' },
      })
    })

    it('resolves the special "Won\'t Fix" state', async () => {
      mock.onPut(`${ BASE }/repo-one/issues/5`).reply({ id: 5 })

      await service.updateIssue('repo-one', 5, undefined, undefined, "Won't Fix")

      expect(mock.history[0].body).toEqual({ state: 'wontfix' })
    })
  })

  describe('addIssueComment', () => {
    it('posts a comment with a raw body', async () => {
      mock.onPost(`${ BASE }/repo-one/issues/5/comments`).reply({ id: 10 })

      const result = await service.addIssueComment('repo-one', 5, 'Thanks')

      expect(result).toEqual({ id: 10 })
      expect(mock.history[0].body).toEqual({ content: { raw: 'Thanks' } })
    })
  })

  // ── Pull Requests ──

  describe('createPullRequest', () => {
    it('sends with required params only', async () => {
      mock.onPost(`${ BASE }/repo-one/pullrequests`).reply({ id: 1 })

      const result = await service.createPullRequest('repo-one', 'PR title', 'feature')

      expect(result).toEqual({ id: 1 })
      expect(mock.history[0].body).toEqual({
        title: 'PR title',
        source: { branch: { name: 'feature' } },
      })
    })

    it('includes all optional params and splits reviewers', async () => {
      mock.onPost(`${ BASE }/repo-one/pullrequests`).reply({ id: 2 })

      await service.createPullRequest(
        'repo-one',
        'PR title',
        'feature',
        'main',
        'Description',
        true,
        'acc-1, acc-2'
      )

      expect(mock.history[0].body).toEqual({
        title: 'PR title',
        source: { branch: { name: 'feature' } },
        destination: { branch: { name: 'main' } },
        description: 'Description',
        close_source_branch: true,
        reviewers: [{ account_id: 'acc-1' }, { account_id: 'acc-2' }],
      })
    })

    it('coerces close_source_branch=false into the body', async () => {
      mock.onPost(`${ BASE }/repo-one/pullrequests`).reply({ id: 3 })

      await service.createPullRequest('repo-one', 'PR', 'feature', undefined, undefined, false)

      expect(mock.history[0].body).toEqual({
        title: 'PR',
        source: { branch: { name: 'feature' } },
        close_source_branch: false,
      })
    })
  })

  describe('getPullRequest', () => {
    it('fetches a pull request by id', async () => {
      mock.onGet(`${ BASE }/repo-one/pullrequests/7`).reply({ id: 7 })

      const result = await service.getPullRequest('repo-one', 7)

      expect(result).toEqual({ id: 7 })
    })
  })

  describe('listPullRequests', () => {
    it('paginates with default pagelen and no state', async () => {
      mock.onGet(`${ BASE }/repo-one/pullrequests`).reply({ values: [{ id: 1 }], next: null })

      const result = await service.listPullRequests('repo-one')

      expect(mock.history[0].query).toEqual({ pagelen: 50 })
      expect(result).toEqual([{ id: 1 }])
    })

    it('resolves the state choice', async () => {
      mock.onGet(`${ BASE }/repo-one/pullrequests`).reply({ values: [], next: null })

      await service.listPullRequests('repo-one', 'Merged')

      expect(mock.history[0].query).toEqual({ state: 'MERGED', pagelen: 50 })
    })
  })

  describe('updatePullRequest', () => {
    it('sends put with only the provided fields', async () => {
      mock.onPut(`${ BASE }/repo-one/pullrequests/7`).reply({ id: 7 })

      const result = await service.updatePullRequest('repo-one', 7, 'New PR title')

      expect(result).toEqual({ id: 7 })
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].body).toEqual({ title: 'New PR title' })
    })

    it('includes description, destination, and close flag', async () => {
      mock.onPut(`${ BASE }/repo-one/pullrequests/7`).reply({ id: 7 })

      await service.updatePullRequest('repo-one', 7, 'Title', 'Desc', 'develop', false)

      expect(mock.history[0].body).toEqual({
        title: 'Title',
        description: 'Desc',
        destination: { branch: { name: 'develop' } },
        close_source_branch: false,
      })
    })
  })

  describe('approvePullRequest', () => {
    it('posts to the approve endpoint', async () => {
      mock.onPost(`${ BASE }/repo-one/pullrequests/7/approve`).reply({ approved: true })

      const result = await service.approvePullRequest('repo-one', 7)

      expect(result).toEqual({ approved: true })
      expect(mock.history[0].method).toBe('post')
    })
  })

  describe('unapprovePullRequest', () => {
    it('deletes the approval and returns success', async () => {
      mock.onDelete(`${ BASE }/repo-one/pullrequests/7/approve`).reply(undefined)

      const result = await service.unapprovePullRequest('repo-one', 7)

      expect(result).toEqual({ success: true })
      expect(mock.history[0].method).toBe('delete')
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onDelete(`${ BASE }/repo-one/pullrequests/7/approve`).replyWithError({
        body: { error: { message: 'Not approved' } },
      })

      await expect(service.unapprovePullRequest('repo-one', 7)).rejects.toThrow(
        'Bitbucket API error: Not approved'
      )
    })
  })

  describe('mergePullRequest', () => {
    it('sends an empty body when no options are provided', async () => {
      mock.onPost(`${ BASE }/repo-one/pullrequests/7/merge`).reply({ id: 7, state: 'MERGED' })

      const result = await service.mergePullRequest('repo-one', 7)

      expect(result).toEqual({ id: 7, state: 'MERGED' })
      expect(mock.history[0].body).toEqual({})
    })

    it('resolves the merge strategy and includes message and close flag', async () => {
      mock.onPost(`${ BASE }/repo-one/pullrequests/7/merge`).reply({ id: 7 })

      await service.mergePullRequest('repo-one', 7, 'Squash', 'Merging now', true)

      expect(mock.history[0].body).toEqual({
        merge_strategy: 'squash',
        message: 'Merging now',
        close_source_branch: true,
      })
    })
  })

  describe('declinePullRequest', () => {
    it('posts to the decline endpoint', async () => {
      mock.onPost(`${ BASE }/repo-one/pullrequests/7/decline`).reply({ id: 7, state: 'DECLINED' })

      const result = await service.declinePullRequest('repo-one', 7)

      expect(result).toEqual({ id: 7, state: 'DECLINED' })
      expect(mock.history[0].method).toBe('post')
    })
  })

  describe('addPullRequestComment', () => {
    it('posts a comment with a raw body', async () => {
      mock.onPost(`${ BASE }/repo-one/pullrequests/7/comments`).reply({ id: 11 })

      const result = await service.addPullRequestComment('repo-one', 7, 'Looks good')

      expect(result).toEqual({ id: 11 })
      expect(mock.history[0].body).toEqual({ content: { raw: 'Looks good' } })
    })
  })

  // ── Source ──

  describe('getFile', () => {
    it('fetches raw file content and wraps it', async () => {
      mock
        .onGet(`${ BASE }/repo-one/src/main/src/index.js`)
        .reply("console.log('hi')")

      const result = await service.getFile('repo-one', 'main', 'src/index.js')

      expect(result).toEqual({
        path: 'src/index.js',
        commit: 'main',
        content: "console.log('hi')",
      })
    })

    it('strips leading slashes from the path', async () => {
      mock.onGet(`${ BASE }/repo-one/src/main/docs/readme.md`).reply('content')

      const result = await service.getFile('repo-one', 'main', '/docs/readme.md')

      expect(result.path).toBe('docs/readme.md')
    })

    it('coerces non-string responses to a string', async () => {
      mock.onGet(`${ BASE }/repo-one/src/main/count.txt`).reply(42)

      const result = await service.getFile('repo-one', 'main', 'count.txt')

      expect(result.content).toBe('42')
    })

    it('returns empty content when the response is null', async () => {
      mock.onGet(`${ BASE }/repo-one/src/main/empty.txt`).reply(null)

      const result = await service.getFile('repo-one', 'main', 'empty.txt')

      expect(result.content).toBe('')
    })
  })

  describe('listDirectory', () => {
    it('lists the root when no path is provided', async () => {
      mock.onGet(`${ BASE }/repo-one/src/main/`).reply({
        values: [{ type: 'commit_file', path: 'index.js' }],
        next: null,
      })

      const result = await service.listDirectory('repo-one', 'main')

      expect(mock.history[0].url).toBe(`${ BASE }/repo-one/src/main/`)
      expect(mock.history[0].query).toEqual({ pagelen: 100 })
      expect(result).toEqual([{ type: 'commit_file', path: 'index.js' }])
    })

    it('normalizes a directory path with a trailing slash', async () => {
      mock.onGet(`${ BASE }/repo-one/src/main/src/lib/`).reply({ values: [], next: null })

      await service.listDirectory('repo-one', 'main', '/src/lib/')

      expect(mock.history[0].url).toBe(`${ BASE }/repo-one/src/main/src/lib/`)
    })
  })

  describe('createOrUpdateFile', () => {
    it('posts multipart form data and returns success', async () => {
      mock.onPost(`${ BASE }/repo-one/src`).reply(undefined)

      const result = await service.createOrUpdateFile(
        'repo-one',
        '/docs/README.md',
        '# Hello',
        'Update README',
        'main'
      )

      expect(result).toEqual({
        success: true,
        path: 'docs/README.md',
        branch: 'main',
        message: 'Update README',
      })

      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].formData).toBeDefined()

      const fields = mock.history[0].formData._fields
      expect(fields).toEqual([
        { name: 'message', value: 'Update README', filename: undefined },
        { name: 'branch', value: 'main', filename: undefined },
        { name: 'docs/README.md', value: '# Hello', filename: undefined },
      ])
    })

    it('sends the Basic auth header on the multipart request', async () => {
      mock.onPost(`${ BASE }/repo-one/src`).reply(undefined)

      await service.createOrUpdateFile('repo-one', 'a.txt', 'x', 'msg', 'main')

      expect(mock.history[0].headers).toMatchObject({ Authorization: EXPECTED_AUTH })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/repo-one/src`).replyWithError({
        body: { error: { message: 'Commit failed' } },
      })

      await expect(
        service.createOrUpdateFile('repo-one', 'a.txt', 'x', 'msg', 'main')
      ).rejects.toThrow('Bitbucket API error: Commit failed')
    })
  })

  describe('listCommits', () => {
    it('lists commits without a revision', async () => {
      mock.onGet(`${ BASE }/repo-one/commits`).reply({ values: [{ hash: 'a1b2c3d' }], next: null })

      const result = await service.listCommits('repo-one')

      expect(mock.history[0].url).toBe(`${ BASE }/repo-one/commits`)
      expect(mock.history[0].query).toEqual({ pagelen: 50 })
      expect(result).toEqual([{ hash: 'a1b2c3d' }])
    })

    it('appends the encoded revision to the URL', async () => {
      mock.onGet(`${ BASE }/repo-one/commits/main`).reply({ values: [], next: null })

      await service.listCommits('repo-one', 'main')

      expect(mock.history[0].url).toBe(`${ BASE }/repo-one/commits/main`)
    })
  })

  // ── Branches ──

  describe('listBranches', () => {
    it('paginates branches', async () => {
      mock.onGet(`${ BASE }/repo-one/refs/branches`).reply({
        values: [{ name: 'main' }],
        next: null,
      })

      const result = await service.listBranches('repo-one')

      expect(mock.history[0].query).toEqual({ pagelen: 100 })
      expect(result).toEqual([{ name: 'main' }])
    })
  })

  describe('createBranch', () => {
    it('posts a branch pointing at a target hash', async () => {
      mock.onPost(`${ BASE }/repo-one/refs/branches`).reply({ name: 'feature/new' })

      const result = await service.createBranch('repo-one', 'feature/new', 'a1b2c3d')

      expect(result).toEqual({ name: 'feature/new' })
      expect(mock.history[0].body).toEqual({ name: 'feature/new', target: { hash: 'a1b2c3d' } })
    })
  })

  describe('deleteBranch', () => {
    it('deletes a branch and returns success', async () => {
      mock.onDelete(`${ BASE }/repo-one/refs/branches/feature%2Fold`).reply(undefined)

      const result = await service.deleteBranch('repo-one', 'feature/old')

      expect(result).toEqual({ success: true, name: 'feature/old' })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${ BASE }/repo-one/refs/branches/feature%2Fold`)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onDelete(`${ BASE }/repo-one/refs/branches/main`).replyWithError({
        body: { error: { message: 'Cannot delete main branch' } },
      })

      await expect(service.deleteBranch('repo-one', 'main')).rejects.toThrow(
        'Bitbucket API error: Cannot delete main branch'
      )
    })
  })

  // ── Pipelines ──

  describe('listPipelines', () => {
    it('paginates pipelines with the default sort', async () => {
      mock.onGet(`${ BASE }/repo-one/pipelines`).reply({
        values: [{ build_number: 1 }],
        next: null,
      })

      const result = await service.listPipelines('repo-one')

      expect(mock.history[0].query).toEqual({ pagelen: 30, sort: '-created_on' })
      expect(result).toEqual([{ build_number: 1 }])
    })
  })

  describe('triggerPipeline', () => {
    it('posts a pipeline_ref_target for the branch', async () => {
      mock.onPost(`${ BASE }/repo-one/pipelines`).reply({ build_number: 43 })

      const result = await service.triggerPipeline('repo-one', 'main')

      expect(result).toEqual({ build_number: 43 })
      expect(mock.history[0].body).toEqual({
        target: {
          ref_type: 'branch',
          type: 'pipeline_ref_target',
          ref_name: 'main',
        },
      })
    })
  })

  describe('getPipeline', () => {
    it('fetches a pipeline by encoded uuid', async () => {
      mock.onGet(`${ BASE }/repo-one/pipelines/%7Babc%7D`).reply({ uuid: '{abc}' })

      const result = await service.getPipeline('repo-one', '{abc}')

      expect(result).toEqual({ uuid: '{abc}' })
      expect(mock.history[0].url).toBe(`${ BASE }/repo-one/pipelines/%7Babc%7D`)
    })
  })

  describe('stopPipeline', () => {
    it('posts to the stopPipeline endpoint and returns success', async () => {
      mock.onPost(`${ BASE }/repo-one/pipelines/%7Babc%7D/stopPipeline`).reply(undefined)

      const result = await service.stopPipeline('repo-one', '{abc}')

      expect(result).toEqual({ success: true, pipeline_uuid: '{abc}' })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/repo-one/pipelines/%7Babc%7D/stopPipeline`)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/repo-one/pipelines/%7Babc%7D/stopPipeline`).replyWithError({
        body: { error: { message: 'Pipeline already completed' } },
      })

      await expect(service.stopPipeline('repo-one', '{abc}')).rejects.toThrow(
        'Bitbucket API error: Pipeline already completed'
      )
    })
  })

  // ── Error handling fallbacks ──

  describe('error handling', () => {
    it('falls back to error.message when no structured body is present', async () => {
      mock.onGet(`${ BASE }/repo-one`).replyWithError({ message: 'Network Error' })

      await expect(service.getRepository('repo-one')).rejects.toThrow('Bitbucket API error: Network Error')
    })

    it('wraps status-only errors and preserves the status on the thrown error', async () => {
      mock.onGet(`${ BASE }/repo-one`).replyWithError({ status: 500 })

      await expect(service.getRepository('repo-one')).rejects.toMatchObject({
        message: expect.stringContaining('Bitbucket API error:'),
        status: 500,
      })
    })
  })
})
