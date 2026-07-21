'use strict'

const { createSandbox } = require('../../../service-sandbox')

const CLIENT_ID = 'test-client-id'
const CLIENT_SECRET = 'test-client-secret'
const OAUTH_TOKEN = 'test-oauth-access-token'
const API_BASE = 'https://api.github.com'
const OAUTH_URL = 'https://github.com/login/oauth/authorize'
const TOKEN_URL = 'https://github.com/login/oauth/access_token'

const AUTH_HEADERS = {
  Authorization: `Bearer ${ OAUTH_TOKEN }`,
  'Accept': 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'FlowRunner-GitHub-Extension',
}

describe('GitHub Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET })
    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()

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
    it('returns authorization URL with correct params', async () => {
      const url = await service.getOAuth2ConnectionURL()

      expect(url).toContain(OAUTH_URL)
      expect(url).toContain(`client_id=${ CLIENT_ID }`)
      expect(url).toContain('scope=')
    })
  })

  describe('executeCallback', () => {
    it('exchanges code for token and fetches user info', async () => {
      mock.onPost(TOKEN_URL).reply({
        access_token: 'gh-token-123',
      })
      mock.onGet(`${ API_BASE }/user`).reply({
        login: 'octocat',
        name: 'Octocat',
        avatar_url: 'https://avatar.url/octocat.png',
      })

      const result = await service.executeCallback({
        code: 'auth-code-123',
        redirectURI: 'https://example.com/callback',
      })

      expect(result).toMatchObject({
        token: 'gh-token-123',
        refreshToken: null,
        expirationInSeconds: 0,
        connectionIdentityName: 'Octocat',
        connectionIdentityImageURL: 'https://avatar.url/octocat.png',
        overwrite: true,
      })

      // Verify token exchange request
      expect(mock.history[0].url).toBe(TOKEN_URL)
      expect(mock.history[0].body).toMatchObject({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code: 'auth-code-123',
        redirect_uri: 'https://example.com/callback',
      })
    })

    it('falls back to login when name is absent', async () => {
      mock.onPost(TOKEN_URL).reply({ access_token: 'tok' })
      mock.onGet(`${ API_BASE }/user`).reply({ login: 'octocat' })

      const result = await service.executeCallback({ code: 'c', redirectURI: 'r' })

      expect(result.connectionIdentityName).toBe('octocat')
    })

    it('throws on token exchange failure', async () => {
      mock.onPost(TOKEN_URL).replyWithError({ message: 'Bad Request' })

      await expect(service.executeCallback({ code: 'c', redirectURI: 'r' }))
        .rejects.toThrow('OAuth callback execution failed')
    })
  })

  describe('refreshToken', () => {
    it('returns existing token (GitHub tokens do not expire)', async () => {
      const result = await service.refreshToken()

      expect(result).toEqual({
        token: OAUTH_TOKEN,
        refreshToken: null,
        expirationInSeconds: 0,
      })
    })
  })

  // ── getCurrentUser ──

  describe('getCurrentUser', () => {
    it('sends GET to /user with auth headers', async () => {
      mock.onGet(`${ API_BASE }/user`).reply({ login: 'octocat', id: 1 })

      const result = await service.getCurrentUser()

      expect(result).toMatchObject({ login: 'octocat', id: 1 })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject(AUTH_HEADERS)
    })
  })

  // ── Dictionaries ──

  describe('getRepositoriesDictionary', () => {
    it('returns formatted items with pagination', async () => {
      mock.onGet(`${ API_BASE }/user/repos`).reply([
        { name: 'repo1', full_name: 'user/repo1', owner: { login: 'user' } },
        { name: 'repo2', full_name: 'user/repo2', owner: { login: 'user' } },
      ])

      const result = await service.getRepositoriesDictionary({})

      expect(result.items).toEqual([
        { label: 'user/repo1', value: 'user/repo1', note: 'Owner: user' },
        { label: 'user/repo2', value: 'user/repo2', note: 'Owner: user' },
      ])
      expect(result.cursor).toBeNull()
      expect(mock.history[0].query).toMatchObject({ per_page: 100, page: 1, sort: 'updated' })
    })

    it('filters by search term', async () => {
      mock.onGet(`${ API_BASE }/user/repos`).reply([
        { name: 'alpha', full_name: 'u/alpha', owner: { login: 'u' } },
        { name: 'beta', full_name: 'u/beta', owner: { login: 'u' } },
      ])

      const result = await service.getRepositoriesDictionary({ search: 'alpha' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toBe('u/alpha')
    })

    it('returns next cursor when 100 results', async () => {
      const repos = Array.from({ length: 100 }, (_, i) => ({
        name: `r${ i }`, full_name: `u/r${ i }`, owner: { login: 'u' },
      }))
      mock.onGet(`${ API_BASE }/user/repos`).reply(repos)

      const result = await service.getRepositoriesDictionary({ cursor: '2' })

      expect(result.cursor).toBe('3')
      expect(mock.history[0].query).toMatchObject({ page: 2 })
    })
  })

  describe('getBranchesDictionary', () => {
    it('returns branches with protected status', async () => {
      mock.onGet(`${ API_BASE }/repos/owner/repo/branches`).reply([
        { name: 'main', protected: true },
        { name: 'dev', protected: false },
      ])

      const result = await service.getBranchesDictionary({
        criteria: { repository: 'owner/repo' },
      })

      expect(result.items).toEqual([
        { label: 'main', value: 'main', note: 'Protected: true' },
        { label: 'dev', value: 'dev', note: 'Protected: false' },
      ])
    })

    it('filters branches by search', async () => {
      mock.onGet(`${ API_BASE }/repos/o/r/branches`).reply([
        { name: 'main', protected: true },
        { name: 'feature-x', protected: false },
      ])

      const result = await service.getBranchesDictionary({
        search: 'feat',
        criteria: { repository: 'o/r' },
      })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('feature-x')
    })
  })

  describe('getLabelsDictionary', () => {
    it('returns labels with color info', async () => {
      mock.onGet(`${ API_BASE }/repos/o/r/labels`).reply([
        { name: 'bug', color: 'd73a4a' },
      ])

      const result = await service.getLabelsDictionary({ criteria: { repository: 'o/r' } })

      expect(result.items).toEqual([
        { label: 'bug', value: 'bug', note: 'Color: #d73a4a' },
      ])
    })
  })

  describe('getMilestonesDictionary', () => {
    it('returns milestones with due dates', async () => {
      mock.onGet(`${ API_BASE }/repos/o/r/milestones`).reply([
        { title: 'v1.0', number: 1, due_on: '2024-12-31' },
        { title: 'v2.0', number: 2, due_on: null },
      ])

      const result = await service.getMilestonesDictionary({ criteria: { repository: 'o/r' } })

      expect(result.items).toEqual([
        { label: 'v1.0', value: '1', note: 'Due: 2024-12-31' },
        { label: 'v2.0', value: '2', note: 'Due: No due date' },
      ])
      expect(mock.history[0].query).toMatchObject({ state: 'all' })
    })
  })

  describe('getUsersDictionary', () => {
    it('returns empty items when no search provided', async () => {
      const result = await service.getUsersDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
      expect(mock.history).toHaveLength(0)
    })

    it('searches users when search term provided', async () => {
      mock.onGet(`${ API_BASE }/search/users`).reply({
        items: [{ login: 'octocat', id: 1 }],
      })

      const result = await service.getUsersDictionary({ search: 'octo' })

      expect(result.items).toEqual([
        { label: 'octocat', value: 'octocat', note: 'ID: 1' },
      ])
      expect(mock.history[0].query).toMatchObject({ q: 'octo', per_page: 50 })
    })
  })

  describe('getOrganizationsDictionary', () => {
    it('returns organizations', async () => {
      mock.onGet(`${ API_BASE }/user/orgs`).reply([
        { login: 'github', id: 1 },
      ])

      const result = await service.getOrganizationsDictionary({})

      expect(result.items).toEqual([
        { label: 'github', value: 'github', note: 'ID: 1' },
      ])
    })
  })

  describe('getOwnersDictionary', () => {
    it('returns owners sorted with current user first', async () => {
      mock.onGet(`${ API_BASE }/user/repos`).reply([
        { owner: { login: 'org1', id: 2, type: 'Organization' } },
        { owner: { login: 'me', id: 1, type: 'User' } },
      ])
      mock.onGet(`${ API_BASE }/user`).reply({ login: 'me' })

      const result = await service.getOwnersDictionary({})

      expect(result.items[0]).toMatchObject({ label: 'me (You)', value: 'me', note: 'User' })
      expect(result.items[1]).toMatchObject({ label: 'org1', value: 'org1', note: 'Organization' })
    })
  })

  describe('getTeamsDictionary', () => {
    it('returns teams from organization', async () => {
      mock.onGet(`${ API_BASE }/orgs/myorg/teams`).reply([
        { name: 'Dev Team', slug: 'dev-team', id: 5 },
      ])

      const result = await service.getTeamsDictionary({ criteria: { org: 'myorg' } })

      expect(result.items).toEqual([
        { label: 'Dev Team', value: 'dev-team', note: 'ID: 5' },
      ])
    })
  })

  describe('getGistsDictionary', () => {
    it('returns gists with descriptions', async () => {
      mock.onGet(`${ API_BASE }/gists`).reply([
        {
          id: 'abc123',
          description: 'My Gist',
          files: { 'test.js': {} },
          created_at: '2024-01-15T10:00:00Z',
        },
      ])

      const result = await service.getGistsDictionary({})

      expect(result.items[0]).toMatchObject({
        label: 'My Gist',
        value: 'abc123',
      })
    })

    it('uses filename when description is empty', async () => {
      mock.onGet(`${ API_BASE }/gists`).reply([
        { id: 'g1', description: '', files: { 'hello.rb': {} }, created_at: '2024-01-01T00:00:00Z' },
      ])

      const result = await service.getGistsDictionary({})

      expect(result.items[0].label).toBe('hello.rb')
    })
  })

  describe('getIssuesDictionary', () => {
    it('returns issues with state', async () => {
      mock.onGet(`${ API_BASE }/repos/o/r/issues`).reply([
        { number: 42, title: 'Bug fix', state: 'open' },
      ])

      const result = await service.getIssuesDictionary({ criteria: { repository: 'o/r' } })

      expect(result.items).toEqual([
        { label: '#42: Bug fix', value: '42', note: 'State: open' },
      ])
    })
  })

  describe('getPullRequestsDictionary', () => {
    it('returns pull requests', async () => {
      mock.onGet(`${ API_BASE }/repos/o/r/pulls`).reply([
        { number: 10, title: 'Add feature', state: 'open' },
      ])

      const result = await service.getPullRequestsDictionary({ criteria: { repository: 'o/r' } })

      expect(result.items).toEqual([
        { label: '#10: Add feature', value: '10', note: 'State: open' },
      ])
      expect(mock.history[0].query).toMatchObject({ state: 'all' })
    })
  })

  describe('getReleasesDictionary', () => {
    it('returns releases with tag info', async () => {
      mock.onGet(`${ API_BASE }/repos/o/r/releases`).reply([
        { id: 1, name: 'v1.0.0', tag_name: 'v1.0.0' },
      ])

      const result = await service.getReleasesDictionary({ criteria: { repository: 'o/r' } })

      expect(result.items).toEqual([
        { label: 'v1.0.0', value: '1', note: 'Tag: v1.0.0' },
      ])
    })
  })

  describe('getWebhooksDictionary', () => {
    it('returns webhooks', async () => {
      mock.onGet(`${ API_BASE }/repos/o/r/hooks`).reply([
        { id: 7, name: 'web', config: { url: 'https://hook.example.com' }, events: ['push'] },
      ])

      const result = await service.getWebhooksDictionary({ criteria: { repository: 'o/r' } })

      expect(result.items).toEqual([
        { label: 'https://hook.example.com', value: '7', note: 'Events: push' },
      ])
    })
  })

  describe('getRepositoryIdsDictionary', () => {
    it('returns repos with numeric ID as value', async () => {
      mock.onGet(`${ API_BASE }/user/repos`).reply([
        { id: 1296269, full_name: 'octocat/Hello-World' },
      ])

      const result = await service.getRepositoryIdsDictionary({})

      expect(result.items).toEqual([
        { label: 'octocat/Hello-World', value: '1296269', note: 'ID: 1296269' },
      ])
    })
  })

  describe('getWorkflowsDictionary', () => {
    it('returns workflows with file path', async () => {
      mock.onGet(`${ API_BASE }/repos/o/r/actions/workflows`).reply({
        workflows: [
          { id: 161335, name: 'CI', path: '.github/workflows/ci.yml' },
        ],
      })

      const result = await service.getWorkflowsDictionary({ criteria: { repository: 'o/r' } })

      expect(result.items).toEqual([
        { label: 'CI', value: '161335', note: 'File: .github/workflows/ci.yml' },
      ])
    })
  })

  // ── Action Methods ──

  describe('createIssue', () => {
    it('sends POST with required fields', async () => {
      mock.onPost(`${ API_BASE }/repos/owner/repo/issues`).reply({ id: 1, number: 42 })

      const result = await service.createIssue('owner/repo', 'Bug title')

      expect(result).toMatchObject({ id: 1, number: 42 })
      expect(mock.history[0].body).toEqual({ title: 'Bug title' })
    })

    it('sends POST with all optional fields', async () => {
      mock.onPost(`${ API_BASE }/repos/owner/repo/issues`).reply({ id: 1 })

      await service.createIssue('owner/repo', 'Title', 'Body text', 'user1,user2', '3', 'bug,urgent')

      expect(mock.history[0].body).toEqual({
        title: 'Title',
        body: 'Body text',
        assignees: ['user1', 'user2'],
        milestone: 3,
        labels: ['bug', 'urgent'],
      })
    })
  })

  describe('updateIssue', () => {
    it('sends PATCH with state mapping', async () => {
      mock.onPatch(`${ API_BASE }/repos/o/r/issues/42`).reply({ id: 1 })

      await service.updateIssue('o/r', '42', 'New Title', undefined, 'Closed')

      expect(mock.history[0].body).toEqual({
        title: 'New Title',
        state: 'closed',
      })
    })
  })

  describe('createIssueComment', () => {
    it('sends POST with comment body', async () => {
      mock.onPost(`${ API_BASE }/repos/o/r/issues/42/comments`).reply({ id: 1 })

      await service.createIssueComment('o/r', '42', 'Nice work!')

      expect(mock.history[0].body).toEqual({ body: 'Nice work!' })
    })
  })

  describe('createRepository', () => {
    it('sends POST with required fields', async () => {
      mock.onPost(`${ API_BASE }/user/repos`).reply({ id: 1, name: 'new-repo' })

      await service.createRepository('new-repo')

      expect(mock.history[0].body).toEqual({ name: 'new-repo' })
    })

    it('sends POST with all optional fields and visibility mapping', async () => {
      mock.onPost(`${ API_BASE }/user/repos`).reply({ id: 1 })

      await service.createRepository('r', 'desc', 'https://h.com', true, true, false, true, 'Private')

      expect(mock.history[0].body).toEqual({
        name: 'r',
        description: 'desc',
        homepage: 'https://h.com',
        private: true,
        has_issues: true,
        has_projects: false,
        has_wiki: true,
        visibility: 'private',
      })
    })
  })

  describe('createOrganizationRepository', () => {
    it('sends POST to org endpoint', async () => {
      mock.onPost(`${ API_BASE }/orgs/myorg/repos`).reply({ id: 1 })

      await service.createOrganizationRepository('myorg', 'new-repo')

      expect(mock.history[0].url).toBe(`${ API_BASE }/orgs/myorg/repos`)
      expect(mock.history[0].body).toEqual({ name: 'new-repo' })
    })
  })

  describe('deleteRepository', () => {
    it('sends DELETE to correct URL', async () => {
      mock.onDelete(`${ API_BASE }/repos/owner/repo`).reply({})

      await service.deleteRepository('owner/repo')

      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${ API_BASE }/repos/owner/repo`)
    })
  })

  describe('createPullRequest', () => {
    it('sends POST with correct body', async () => {
      mock.onPost(`${ API_BASE }/repos/o/r/pulls`).reply({ id: 1, number: 10 })

      await service.createPullRequest('o/r', 'New Feature', 'feature-branch', 'main', 'PR body', true)

      expect(mock.history[0].body).toEqual({
        title: 'New Feature',
        head: 'feature-branch',
        base: 'main',
        body: 'PR body',
        draft: true,
      })
    })
  })

  describe('mergePullRequest', () => {
    it('sends PUT with merge method mapping', async () => {
      mock.onPut(`${ API_BASE }/repos/o/r/pulls/10/merge`).reply({ merged: true })

      await service.mergePullRequest('o/r', '10', 'Merge title', 'Merge msg', 'Squash')

      expect(mock.history[0].body).toEqual({
        commit_title: 'Merge title',
        commit_message: 'Merge msg',
        merge_method: 'squash',
      })
    })
  })

  describe('createGist', () => {
    it('sends POST with files', async () => {
      const files = { 'hello.txt': { content: 'Hello World' } }
      mock.onPost(`${ API_BASE }/gists`).reply({ id: 'abc' })

      await service.createGist('A gist', true, files)

      expect(mock.history[0].body).toEqual({
        description: 'A gist',
        public: true,
        files,
      })
    })
  })

  describe('deleteGist', () => {
    it('sends DELETE to correct URL', async () => {
      mock.onDelete(`${ API_BASE }/gists/abc123`).reply({})

      await service.deleteGist('abc123')

      expect(mock.history[0].method).toBe('delete')
    })
  })

  describe('createRelease', () => {
    it('sends POST with required and optional fields', async () => {
      mock.onPost(`${ API_BASE }/repos/o/r/releases`).reply({ id: 1 })

      await service.createRelease('o/r', 'v1.0.0', 'main', 'Release 1.0', 'Notes', true, false, true)

      expect(mock.history[0].body).toEqual({
        tag_name: 'v1.0.0',
        target_commitish: 'main',
        name: 'Release 1.0',
        body: 'Notes',
        draft: true,
        prerelease: false,
        generate_release_notes: true,
      })
    })
  })

  describe('deleteRelease', () => {
    it('sends DELETE to correct URL', async () => {
      mock.onDelete(`${ API_BASE }/repos/o/r/releases/99`).reply({})

      await service.deleteRelease('o/r', '99')

      expect(mock.history[0].url).toBe(`${ API_BASE }/repos/o/r/releases/99`)
    })
  })

  describe('createBranch', () => {
    it('sends POST with ref and sha', async () => {
      mock.onPost(`${ API_BASE }/repos/o/r/git/refs`).reply({ ref: 'refs/heads/new-branch' })

      await service.createBranch('o/r', 'new-branch', 'abc123')

      expect(mock.history[0].body).toEqual({
        ref: 'refs/heads/new-branch',
        sha: 'abc123',
      })
    })
  })

  describe('deleteBranch', () => {
    it('sends DELETE to correct ref URL', async () => {
      mock.onDelete(`${ API_BASE }/repos/o/r/git/refs/heads/old-branch`).reply({})

      await service.deleteBranch('o/r', 'old-branch')

      expect(mock.history[0].url).toBe(`${ API_BASE }/repos/o/r/git/refs/heads/old-branch`)
    })
  })

  describe('createFile', () => {
    it('sends PUT with content and branch', async () => {
      mock.onPut(`${ API_BASE }/repos/o/r/contents/src/index.js`).reply({ content: {} })

      await service.createFile('o/r', 'src/index.js', 'Add file', 'Y29udGVudA==', 'main')

      expect(mock.history[0].body).toEqual({
        message: 'Add file',
        content: 'Y29udGVudA==',
        branch: 'main',
      })
    })
  })

  describe('updateFile', () => {
    it('sends PUT with sha for update', async () => {
      mock.onPut(`${ API_BASE }/repos/o/r/contents/README.md`).reply({ content: {} })

      await service.updateFile('o/r', 'README.md', 'Update readme', 'bmV3', 'sha123', 'main')

      expect(mock.history[0].body).toEqual({
        message: 'Update readme',
        content: 'bmV3',
        sha: 'sha123',
        branch: 'main',
      })
    })
  })

  describe('deleteFile', () => {
    it('sends DELETE with sha and message', async () => {
      mock.onDelete(`${ API_BASE }/repos/o/r/contents/old.txt`).reply({ commit: {} })

      await service.deleteFile('o/r', 'old.txt', 'Remove file', 'sha456', 'main')

      expect(mock.history[0].body).toEqual({
        message: 'Remove file',
        sha: 'sha456',
        branch: 'main',
      })
    })
  })

  describe('getRepositoryContents', () => {
    it('sends GET with path and ref', async () => {
      mock.onGet(`${ API_BASE }/repos/o/r/contents/src`).reply([{ name: 'index.js' }])

      const result = await service.getRepositoryContents('o/r', 'src', 'main')

      expect(result).toEqual([{ name: 'index.js' }])
      expect(mock.history[0].query).toMatchObject({ ref: 'main' })
    })

    it('sends GET with empty path for root', async () => {
      mock.onGet(`${ API_BASE }/repos/o/r/contents/`).reply([])

      await service.getRepositoryContents('o/r')

      expect(mock.history[0].url).toBe(`${ API_BASE }/repos/o/r/contents/`)
    })
  })

  describe('getFileContent', () => {
    it('decodes base64 content', async () => {
      mock.onGet(`${ API_BASE }/repos/o/r/contents/README.md`).reply({
        path: 'README.md',
        sha: 'abc',
        size: 13,
        content: Buffer.from('Hello World!\n').toString('base64'),
        html_url: 'https://github.com/o/r/blob/main/README.md',
        download_url: 'https://raw.githubusercontent.com/o/r/main/README.md',
      })

      const result = await service.getFileContent('o/r', 'README.md')

      expect(result).toEqual({
        path: 'README.md',
        sha: 'abc',
        size: 13,
        encoding: 'utf-8',
        content: 'Hello World!\n',
        html_url: 'https://github.com/o/r/blob/main/README.md',
        download_url: 'https://raw.githubusercontent.com/o/r/main/README.md',
      })
    })

    it('throws when path is a directory', async () => {
      mock.onGet(`${ API_BASE }/repos/o/r/contents/src`).reply([{ name: 'index.js' }])

      await expect(service.getFileContent('o/r', 'src'))
        .rejects.toThrow('Path is a directory or not a file: src')
    })
  })

  describe('listCommits', () => {
    it('sends GET with query params', async () => {
      mock.onGet(`${ API_BASE }/repos/o/r/commits`).reply([{ sha: 'abc' }])

      await service.listCommits('o/r', 'main', 'src/', 'octocat', undefined, undefined, 10, 2)

      expect(mock.history[0].query).toMatchObject({
        sha: 'main',
        path: 'src/',
        author: 'octocat',
        per_page: 10,
        page: 2,
      })
    })
  })

  describe('getCommit', () => {
    it('sends GET to correct URL', async () => {
      mock.onGet(`${ API_BASE }/repos/o/r/commits/abc123`).reply({ sha: 'abc123' })

      const result = await service.getCommit('o/r', 'abc123')

      expect(result).toMatchObject({ sha: 'abc123' })
    })
  })

  describe('addCollaborator', () => {
    it('sends PUT with permission mapping', async () => {
      mock.onPut(`${ API_BASE }/repos/o/r/collaborators/user1`).reply({})

      await service.addCollaborator('o/r', 'user1', 'Write')

      expect(mock.history[0].body).toEqual({ permission: 'push' })
    })
  })

  describe('removeCollaborator', () => {
    it('sends DELETE to correct URL', async () => {
      mock.onDelete(`${ API_BASE }/repos/o/r/collaborators/user1`).reply({})

      await service.removeCollaborator('o/r', 'user1')

      expect(mock.history[0].url).toBe(`${ API_BASE }/repos/o/r/collaborators/user1`)
    })
  })

  describe('addLabelToIssue', () => {
    it('sends POST with parsed labels array', async () => {
      mock.onPost(`${ API_BASE }/repos/o/r/issues/42/labels`).reply([])

      await service.addLabelToIssue('o/r', '42', 'bug, enhancement')

      expect(mock.history[0].body).toEqual(['bug', 'enhancement'])
    })
  })

  describe('removeLabelFromIssue', () => {
    it('sends DELETE to label URL', async () => {
      mock.onDelete(`${ API_BASE }/repos/o/r/issues/42/labels/bug`).reply([])

      await service.removeLabelFromIssue('o/r', '42', 'bug')

      expect(mock.history[0].url).toBe(`${ API_BASE }/repos/o/r/issues/42/labels/bug`)
    })
  })

  describe('assignIssue', () => {
    it('sends POST with parsed assignees', async () => {
      mock.onPost(`${ API_BASE }/repos/o/r/issues/5/assignees`).reply({})

      await service.assignIssue('o/r', '5', 'user1, user2')

      expect(mock.history[0].body).toEqual({ assignees: ['user1', 'user2'] })
    })
  })

  describe('unassignIssue', () => {
    it('sends DELETE with parsed assignees', async () => {
      mock.onDelete(`${ API_BASE }/repos/o/r/issues/5/assignees`).reply({})

      await service.unassignIssue('o/r', '5', 'user1')

      expect(mock.history[0].body).toEqual({ assignees: ['user1'] })
    })
  })

  describe('createRepositoryWebhook', () => {
    it('sends POST with webhook config', async () => {
      mock.onPost(`${ API_BASE }/repos/o/r/hooks`).reply({ id: 1 })

      await service.createRepositoryWebhook(
        'o/r', 'https://hook.example.com', 'JSON', 'mysecret', true, 'push,pull_request'
      )

      expect(mock.history[0].body).toEqual({
        name: 'web',
        active: true,
        events: ['push', 'pull_request'],
        config: {
          url: 'https://hook.example.com',
          content_type: 'json',
          secret: 'mysecret',
        },
      })
    })
  })

  describe('deleteRepositoryWebhook', () => {
    it('sends DELETE to hook URL', async () => {
      mock.onDelete(`${ API_BASE }/repos/o/r/hooks/7`).reply({})

      await service.deleteRepositoryWebhook('o/r', '7')

      expect(mock.history[0].url).toBe(`${ API_BASE }/repos/o/r/hooks/7`)
    })
  })

  describe('createTeam', () => {
    it('sends POST with privacy mapping', async () => {
      mock.onPost(`${ API_BASE }/orgs/myorg/teams`).reply({ id: 1 })

      await service.createTeam('myorg', 'devs', 'Dev team', 'Closed', '5')

      expect(mock.history[0].body).toEqual({
        name: 'devs',
        description: 'Dev team',
        privacy: 'closed',
        parent_team_id: 5,
      })
    })
  })

  describe('deleteTeam', () => {
    it('sends DELETE to team URL', async () => {
      mock.onDelete(`${ API_BASE }/orgs/myorg/teams/dev-team`).reply({})

      await service.deleteTeam('myorg', 'dev-team')

      expect(mock.history[0].url).toBe(`${ API_BASE }/orgs/myorg/teams/dev-team`)
    })
  })

  describe('addTeamMember', () => {
    it('sends PUT with role mapping', async () => {
      mock.onPut(`${ API_BASE }/orgs/myorg/teams/devs/memberships/user1`).reply({})

      await service.addTeamMember('myorg', 'devs', 'user1', 'Maintainer')

      expect(mock.history[0].body).toEqual({ role: 'maintainer' })
    })
  })

  describe('removeTeamMember', () => {
    it('sends DELETE to membership URL', async () => {
      mock.onDelete(`${ API_BASE }/orgs/myorg/teams/devs/memberships/user1`).reply({})

      await service.removeTeamMember('myorg', 'devs', 'user1')

      expect(mock.history[0].url).toBe(`${ API_BASE }/orgs/myorg/teams/devs/memberships/user1`)
    })
  })

  describe('addTeamRepository', () => {
    it('sends PUT with permission mapping', async () => {
      mock.onPut(`${ API_BASE }/orgs/myorg/teams/devs/repos/owner/repo`).reply({})

      await service.addTeamRepository('myorg', 'devs', 'owner', 'repo', 'Admin')

      expect(mock.history[0].body).toEqual({ permission: 'admin' })
    })
  })

  describe('removeTeamRepository', () => {
    it('sends DELETE to team repo URL', async () => {
      mock.onDelete(`${ API_BASE }/orgs/myorg/teams/devs/repos/owner/repo`).reply({})

      await service.removeTeamRepository('myorg', 'devs', 'owner', 'repo')

      expect(mock.history[0].url).toBe(`${ API_BASE }/orgs/myorg/teams/devs/repos/owner/repo`)
    })
  })

  describe('forkRepository', () => {
    it('sends POST with optional organization', async () => {
      mock.onPost(`${ API_BASE }/repos/o/r/forks`).reply({ id: 1 })

      await service.forkRepository('o/r', 'myorg')

      expect(mock.history[0].body).toEqual({ organization: 'myorg' })
    })

    it('sends POST without organization', async () => {
      mock.onPost(`${ API_BASE }/repos/o/r/forks`).reply({ id: 1 })

      await service.forkRepository('o/r')

      expect(mock.history[0].body).toEqual({})
    })
  })

  describe('starRepository', () => {
    it('sends PUT to starred URL', async () => {
      mock.onPut(`${ API_BASE }/user/starred/o/r`).reply({})

      await service.starRepository('o/r')

      expect(mock.history[0].method).toBe('put')
    })
  })

  describe('unstarRepository', () => {
    it('sends DELETE to starred URL', async () => {
      mock.onDelete(`${ API_BASE }/user/starred/o/r`).reply({})

      await service.unstarRepository('o/r')

      expect(mock.history[0].method).toBe('delete')
    })
  })

  describe('watchRepository', () => {
    it('sends PUT with Subscribed mapping', async () => {
      mock.onPut(`${ API_BASE }/repos/o/r/subscription`).reply({})

      await service.watchRepository('o/r', 'Subscribed')

      expect(mock.history[0].body).toEqual({ subscribed: true, ignored: false })
    })

    it('sends PUT with Ignored mapping', async () => {
      mock.onPut(`${ API_BASE }/repos/o/r/subscription`).reply({})

      await service.watchRepository('o/r', 'Ignored')

      expect(mock.history[0].body).toEqual({ subscribed: false, ignored: true })
    })
  })

  describe('unwatchRepository', () => {
    it('sends DELETE to subscription URL', async () => {
      mock.onDelete(`${ API_BASE }/repos/o/r/subscription`).reply({})

      await service.unwatchRepository('o/r')

      expect(mock.history[0].method).toBe('delete')
    })
  })

  describe('createRepositoryProject', () => {
    it('sends POST with name and body', async () => {
      mock.onPost(`${ API_BASE }/repos/o/r/projects`).reply({ id: 1 })

      await service.createRepositoryProject('o/r', 'Project 1', 'Description')

      expect(mock.history[0].body).toEqual({ name: 'Project 1', body: 'Description' })
    })
  })

  describe('createOrganizationProject', () => {
    it('sends POST to org projects endpoint', async () => {
      mock.onPost(`${ API_BASE }/orgs/myorg/projects`).reply({ id: 1 })

      await service.createOrganizationProject('myorg', 'Project', 'Body')

      expect(mock.history[0].url).toBe(`${ API_BASE }/orgs/myorg/projects`)
    })
  })

  describe('deleteProject', () => {
    it('sends DELETE to project URL', async () => {
      mock.onDelete(`${ API_BASE }/projects/123`).reply({})

      await service.deleteProject('123')

      expect(mock.history[0].url).toBe(`${ API_BASE }/projects/123`)
    })
  })

  describe('createLabel', () => {
    it('sends POST with color stripped of leading hash', async () => {
      mock.onPost(`${ API_BASE }/repos/o/r/labels`).reply({ id: 1 })

      await service.createLabel('o/r', 'bug', '#f29513', 'Bug issues')

      expect(mock.history[0].body).toEqual({
        name: 'bug',
        color: 'f29513',
        description: 'Bug issues',
      })
    })
  })

  describe('updateLabel', () => {
    it('sends PATCH to label URL', async () => {
      mock.onPatch(`${ API_BASE }/repos/o/r/labels/old-name`).reply({ id: 1 })

      await service.updateLabel('o/r', 'old-name', 'new-name', 'ff0000', 'Updated')

      expect(mock.history[0].body).toEqual({
        new_name: 'new-name',
        color: 'ff0000',
        description: 'Updated',
      })
    })
  })

  describe('deleteLabel', () => {
    it('sends DELETE to label URL', async () => {
      mock.onDelete(`${ API_BASE }/repos/o/r/labels/bug`).reply({})

      await service.deleteLabel('o/r', 'bug')

      expect(mock.history[0].url).toBe(`${ API_BASE }/repos/o/r/labels/bug`)
    })
  })

  describe('createMilestone', () => {
    it('sends POST with state mapping', async () => {
      mock.onPost(`${ API_BASE }/repos/o/r/milestones`).reply({ id: 1 })

      await service.createMilestone('o/r', 'v1.0', 'Open', 'First release', '2024-12-31T00:00:00Z')

      expect(mock.history[0].body).toEqual({
        title: 'v1.0',
        state: 'open',
        description: 'First release',
        due_on: '2024-12-31T00:00:00Z',
      })
    })
  })

  describe('updateMilestone', () => {
    it('sends PATCH to milestone URL', async () => {
      mock.onPatch(`${ API_BASE }/repos/o/r/milestones/1`).reply({ id: 1 })

      await service.updateMilestone('o/r', '1', 'v1.1', 'Closed')

      expect(mock.history[0].body).toEqual({
        title: 'v1.1',
        state: 'closed',
      })
    })
  })

  describe('deleteMilestone', () => {
    it('sends DELETE to milestone URL', async () => {
      mock.onDelete(`${ API_BASE }/repos/o/r/milestones/1`).reply({})

      await service.deleteMilestone('o/r', '1')

      expect(mock.history[0].url).toBe(`${ API_BASE }/repos/o/r/milestones/1`)
    })
  })

  describe('createDeployKey', () => {
    it('sends POST with key data', async () => {
      mock.onPost(`${ API_BASE }/repos/o/r/keys`).reply({ id: 1 })

      await service.createDeployKey('o/r', 'deploy', 'ssh-rsa AAAA...', true)

      expect(mock.history[0].body).toEqual({
        title: 'deploy',
        key: 'ssh-rsa AAAA...',
        read_only: true,
      })
    })
  })

  describe('deleteDeployKey', () => {
    it('sends DELETE to key URL', async () => {
      mock.onDelete(`${ API_BASE }/repos/o/r/keys/5`).reply({})

      await service.deleteDeployKey('o/r', '5')

      expect(mock.history[0].url).toBe(`${ API_BASE }/repos/o/r/keys/5`)
    })
  })

  describe('createRepositoryDispatchEvent', () => {
    it('sends POST with event type and payload', async () => {
      mock.onPost(`${ API_BASE }/repos/o/r/dispatches`).reply({})

      await service.createRepositoryDispatchEvent('o/r', 'deploy', { env: 'prod' })

      expect(mock.history[0].body).toEqual({
        event_type: 'deploy',
        client_payload: { env: 'prod' },
      })
    })
  })

  describe('createDiscussion', () => {
    it('looks up category then sends POST', async () => {
      mock.onGet(`${ API_BASE }/repos/o/r/discussions/categories`).reply([
        { id: 10, name: 'General' },
        { id: 20, name: 'Ideas' },
      ])
      mock.onPost(`${ API_BASE }/repos/o/r/discussions`).reply({ id: 1 })

      await service.createDiscussion('o/r', 'Discussion Title', 'Body text', 'General')

      expect(mock.history[1].body).toEqual({
        title: 'Discussion Title',
        body: 'Body text',
        category_id: 10,
      })
    })

    it('throws when category not found', async () => {
      mock.onGet(`${ API_BASE }/repos/o/r/discussions/categories`).reply([
        { id: 10, name: 'General' },
      ])

      await expect(service.createDiscussion('o/r', 'T', 'B', 'NonExistent'))
        .rejects.toThrow("Discussion category 'NonExistent' not found.")
    })
  })

  describe('createDiscussionComment', () => {
    it('sends POST to discussion comments URL', async () => {
      mock.onPost(`${ API_BASE }/repos/o/r/discussions/5/comments`).reply({ id: 1 })

      await service.createDiscussionComment('o/r', '5', 'Great discussion!')

      expect(mock.history[0].body).toEqual({ body: 'Great discussion!' })
    })
  })

  // ── Secrets ──

  describe('createRepositorySecret', () => {
    it('sends PUT to actions secrets URL', async () => {
      mock.onPut(`${ API_BASE }/repos/o/r/actions/secrets/MY_SECRET`).reply({})

      await service.createRepositorySecret('o/r', 'MY_SECRET', 'encrypted_val', 'key_id_1')

      expect(mock.history[0].body).toEqual({
        encrypted_value: 'encrypted_val',
        key_id: 'key_id_1',
      })
    })
  })

  describe('deleteRepositorySecret', () => {
    it('sends DELETE to secret URL', async () => {
      mock.onDelete(`${ API_BASE }/repos/o/r/actions/secrets/MY_SECRET`).reply({})

      await service.deleteRepositorySecret('o/r', 'MY_SECRET')

      expect(mock.history[0].url).toBe(`${ API_BASE }/repos/o/r/actions/secrets/MY_SECRET`)
    })
  })

  describe('createOrganizationSecret', () => {
    it('sends PUT with visibility mapping and selected repos', async () => {
      mock.onPut(`${ API_BASE }/orgs/myorg/actions/secrets/SEC`).reply({})

      await service.createOrganizationSecret('myorg', 'SEC', 'enc', 'kid', 'Selected Repositories', '1,2,3')

      expect(mock.history[0].body).toEqual({
        encrypted_value: 'enc',
        key_id: 'kid',
        visibility: 'selected',
        selected_repository_ids: [1, 2, 3],
      })
    })
  })

  describe('deleteOrganizationSecret', () => {
    it('sends DELETE to org secret URL', async () => {
      mock.onDelete(`${ API_BASE }/orgs/myorg/actions/secrets/SEC`).reply({})

      await service.deleteOrganizationSecret('myorg', 'SEC')

      expect(mock.history[0].url).toBe(`${ API_BASE }/orgs/myorg/actions/secrets/SEC`)
    })
  })

  describe('createEnvironmentSecret', () => {
    it('sends PUT to environment secret URL', async () => {
      mock.onPut(`${ API_BASE }/repositories/123/environments/prod/secrets/SEC`).reply({})

      await service.createEnvironmentSecret('123', 'prod', 'SEC', 'enc', 'kid')

      expect(mock.history[0].body).toEqual({
        encrypted_value: 'enc',
        key_id: 'kid',
      })
    })
  })

  describe('deleteEnvironmentSecret', () => {
    it('sends DELETE to environment secret URL', async () => {
      mock.onDelete(`${ API_BASE }/repositories/123/environments/prod/secrets/SEC`).reply({})

      await service.deleteEnvironmentSecret('123', 'prod', 'SEC')

      expect(mock.history[0].url).toBe(`${ API_BASE }/repositories/123/environments/prod/secrets/SEC`)
    })
  })

  // ── Variables ──

  describe('createRepositoryVariable', () => {
    it('sends POST with name and value', async () => {
      mock.onPost(`${ API_BASE }/repos/o/r/actions/variables`).reply({})

      await service.createRepositoryVariable('o/r', 'MY_VAR', 'my-value')

      expect(mock.history[0].body).toEqual({ name: 'MY_VAR', value: 'my-value' })
    })
  })

  describe('updateRepositoryVariable', () => {
    it('sends PATCH with new name and value', async () => {
      mock.onPatch(`${ API_BASE }/repos/o/r/actions/variables/OLD_VAR`).reply({})

      await service.updateRepositoryVariable('o/r', 'OLD_VAR', 'NEW_VAR', 'new-val')

      expect(mock.history[0].body).toEqual({ name: 'NEW_VAR', value: 'new-val' })
    })
  })

  describe('deleteRepositoryVariable', () => {
    it('sends DELETE to variable URL', async () => {
      mock.onDelete(`${ API_BASE }/repos/o/r/actions/variables/MY_VAR`).reply({})

      await service.deleteRepositoryVariable('o/r', 'MY_VAR')

      expect(mock.history[0].url).toBe(`${ API_BASE }/repos/o/r/actions/variables/MY_VAR`)
    })
  })

  describe('createOrganizationVariable', () => {
    it('sends POST with visibility mapping', async () => {
      mock.onPost(`${ API_BASE }/orgs/myorg/actions/variables`).reply({})

      await service.createOrganizationVariable('myorg', 'VAR', 'val', 'All Repositories')

      expect(mock.history[0].body).toMatchObject({
        name: 'VAR',
        value: 'val',
        visibility: 'all',
      })
    })
  })

  describe('updateOrganizationVariable', () => {
    it('sends PATCH to variable URL', async () => {
      mock.onPatch(`${ API_BASE }/orgs/myorg/actions/variables/VAR`).reply({})

      await service.updateOrganizationVariable('myorg', 'VAR', 'NEW_VAR', 'new-val')

      expect(mock.history[0].body).toMatchObject({ name: 'NEW_VAR', value: 'new-val' })
    })
  })

  describe('deleteOrganizationVariable', () => {
    it('sends DELETE to org variable URL', async () => {
      mock.onDelete(`${ API_BASE }/orgs/myorg/actions/variables/VAR`).reply({})

      await service.deleteOrganizationVariable('myorg', 'VAR')

      expect(mock.history[0].url).toBe(`${ API_BASE }/orgs/myorg/actions/variables/VAR`)
    })
  })

  describe('createEnvironmentVariable', () => {
    it('sends POST to environment variables URL', async () => {
      mock.onPost(`${ API_BASE }/repositories/123/environments/prod/variables`).reply({})

      await service.createEnvironmentVariable('123', 'prod', 'VAR', 'val')

      expect(mock.history[0].body).toEqual({ name: 'VAR', value: 'val' })
    })
  })

  describe('updateEnvironmentVariable', () => {
    it('sends PATCH to environment variable URL', async () => {
      mock.onPatch(`${ API_BASE }/repositories/123/environments/prod/variables/VAR`).reply({})

      await service.updateEnvironmentVariable('123', 'prod', 'VAR', 'NEW_VAR', 'new-val')

      expect(mock.history[0].body).toEqual({ name: 'NEW_VAR', value: 'new-val' })
    })
  })

  describe('deleteEnvironmentVariable', () => {
    it('sends DELETE to environment variable URL', async () => {
      mock.onDelete(`${ API_BASE }/repositories/123/environments/prod/variables/VAR`).reply({})

      await service.deleteEnvironmentVariable('123', 'prod', 'VAR')

      expect(mock.history[0].url).toBe(`${ API_BASE }/repositories/123/environments/prod/variables/VAR`)
    })
  })

  // ── Search / Find Methods ──

  describe('checkOrganizationMembership', () => {
    it('returns membership data on success', async () => {
      mock.onGet(`${ API_BASE }/orgs/myorg/memberships/user1`).reply({ state: 'active', role: 'member' })

      const result = await service.checkOrganizationMembership('myorg', 'user1')

      expect(result).toMatchObject({ state: 'active', role: 'member' })
    })

    it('returns null on 404', async () => {
      mock.onGet(`${ API_BASE }/orgs/myorg/memberships/user1`).replyWithError({
        message: 'Not Found',
        body: { message: 'Not Found' },
        status: 404,
      })

      const result = await service.checkOrganizationMembership('myorg', 'user1')

      expect(result).toBeNull()
    })
  })

  describe('findBranch', () => {
    it('returns branch data', async () => {
      mock.onGet(`${ API_BASE }/repos/o/r/branches/main`).reply({ name: 'main', protected: true })

      const result = await service.findBranch('o/r', 'main')

      expect(result).toMatchObject({ name: 'main' })
    })

    it('returns null on 404', async () => {
      mock.onGet(`${ API_BASE }/repos/o/r/branches/nonexistent`).replyWithError({
        message: 'Not Found', status: 404,
      })

      const result = await service.findBranch('o/r', 'nonexistent')

      expect(result).toBeNull()
    })
  })

  describe('findOrganization', () => {
    it('returns org data', async () => {
      mock.onGet(`${ API_BASE }/orgs/github`).reply({ login: 'github', id: 1 })

      const result = await service.findOrganization('github')

      expect(result).toMatchObject({ login: 'github' })
    })

    it('returns null on 404', async () => {
      mock.onGet(`${ API_BASE }/orgs/nonexistent`).replyWithError({ message: 'Not Found', status: 404 })

      const result = await service.findOrganization('nonexistent')

      expect(result).toBeNull()
    })
  })

  describe('findRepository', () => {
    it('returns repo data', async () => {
      mock.onGet(`${ API_BASE }/repos/o/r`).reply({ id: 1, full_name: 'o/r' })

      const result = await service.findRepository('o/r')

      expect(result).toMatchObject({ full_name: 'o/r' })
    })

    it('returns null on 404', async () => {
      mock.onGet(`${ API_BASE }/repos/o/nonexistent`).replyWithError({ message: 'Not Found', status: 404 })

      const result = await service.findRepository('o/nonexistent')

      expect(result).toBeNull()
    })
  })

  describe('findIssue', () => {
    it('returns issue data', async () => {
      mock.onGet(`${ API_BASE }/repos/o/r/issues/42`).reply({ number: 42, title: 'Bug' })

      const result = await service.findIssue('o/r', '42')

      expect(result).toMatchObject({ number: 42 })
    })

    it('returns null on 404', async () => {
      mock.onGet(`${ API_BASE }/repos/o/r/issues/999`).replyWithError({ message: 'Not Found', status: 404 })

      const result = await service.findIssue('o/r', '999')

      expect(result).toBeNull()
    })
  })

  describe('findPullRequest', () => {
    it('returns PR data', async () => {
      mock.onGet(`${ API_BASE }/repos/o/r/pulls/10`).reply({ number: 10 })

      const result = await service.findPullRequest('o/r', '10')

      expect(result).toMatchObject({ number: 10 })
    })

    it('returns null on 404', async () => {
      mock.onGet(`${ API_BASE }/repos/o/r/pulls/999`).replyWithError({ message: 'Not Found', status: 404 })

      const result = await service.findPullRequest('o/r', '999')

      expect(result).toBeNull()
    })
  })

  describe('findUser', () => {
    it('returns user data', async () => {
      mock.onGet(`${ API_BASE }/users/octocat`).reply({ login: 'octocat' })

      const result = await service.findUser('octocat')

      expect(result).toMatchObject({ login: 'octocat' })
    })

    it('returns null on 404', async () => {
      mock.onGet(`${ API_BASE }/users/nonexistent`).replyWithError({ message: 'Not Found', status: 404 })

      const result = await service.findUser('nonexistent')

      expect(result).toBeNull()
    })
  })

  describe('findOrCreateIssue', () => {
    it('returns existing issue when found', async () => {
      mock.onGet(`${ API_BASE }/search/issues`).reply({
        items: [{ number: 42, title: 'Bug' }],
      })

      const result = await service.findOrCreateIssue('o/r', 'Bug')

      expect(result).toMatchObject({ number: 42 })
      expect(mock.history).toHaveLength(1) // Only search, no create
    })

    it('creates new issue when not found', async () => {
      mock.onGet(`${ API_BASE }/search/issues`).reply({ items: [] })
      mock.onPost(`${ API_BASE }/repos/o/r/issues`).reply({ number: 99 })

      const result = await service.findOrCreateIssue('o/r', 'New Bug', 'Description')

      expect(result).toMatchObject({ number: 99 })
      expect(mock.history).toHaveLength(2)
      expect(mock.history[1].body).toEqual({ title: 'New Bug', body: 'Description' })
    })
  })

  describe('findOrCreatePullRequest', () => {
    it('returns existing PR when found', async () => {
      mock.onGet(`${ API_BASE }/search/issues`).reply({
        items: [{ number: 10 }],
      })
      mock.onGet(`${ API_BASE }/repos/o/r/pulls/10`).reply({ number: 10, title: 'Feature' })

      const result = await service.findOrCreatePullRequest('o/r', 'Feature', 'head', 'main')

      expect(result).toMatchObject({ number: 10 })
    })

    it('creates new PR when not found', async () => {
      mock.onGet(`${ API_BASE }/search/issues`).reply({ items: [] })
      mock.onPost(`${ API_BASE }/repos/o/r/pulls`).reply({ number: 20 })

      const result = await service.findOrCreatePullRequest('o/r', 'Feature', 'head', 'main', 'PR body')

      expect(result).toMatchObject({ number: 20 })
      expect(mock.history[1].body).toEqual({
        title: 'Feature',
        head: 'head',
        base: 'main',
        body: 'PR body',
      })
    })
  })

  describe('searchRepositories', () => {
    it('sends GET with sort and order mapping', async () => {
      mock.onGet(`${ API_BASE }/search/repositories`).reply({ total_count: 1, items: [] })

      await service.searchRepositories('tetris', 'Stars', 'Descending', 10, 1)

      expect(mock.history[0].query).toMatchObject({
        q: 'tetris',
        sort: 'stars',
        order: 'desc',
        per_page: 10,
        page: 1,
      })
    })
  })

  describe('searchIssues', () => {
    it('sends GET with sort and order mapping', async () => {
      mock.onGet(`${ API_BASE }/search/issues`).reply({ total_count: 1, items: [] })

      await service.searchIssues('bug is:open', 'Comments', 'Ascending', 20, 2)

      expect(mock.history[0].query).toMatchObject({
        q: 'bug is:open',
        sort: 'comments',
        order: 'asc',
        per_page: 20,
        page: 2,
      })
    })
  })

  // ── Actions (Workflows) ──

  describe('listWorkflows', () => {
    it('sends GET with pagination', async () => {
      mock.onGet(`${ API_BASE }/repos/o/r/actions/workflows`).reply({ total_count: 1, workflows: [] })

      await service.listWorkflows('o/r', 10, 2)

      expect(mock.history[0].query).toMatchObject({ per_page: 10, page: 2 })
    })
  })

  describe('listWorkflowRuns', () => {
    it('uses workflow-specific URL when workflowId provided', async () => {
      mock.onGet(`${ API_BASE }/repos/o/r/actions/workflows/161335/runs`).reply({ total_count: 0, workflow_runs: [] })

      await service.listWorkflowRuns('o/r', '161335')

      expect(mock.history[0].url).toBe(`${ API_BASE }/repos/o/r/actions/workflows/161335/runs`)
    })

    it('uses generic runs URL when no workflowId', async () => {
      mock.onGet(`${ API_BASE }/repos/o/r/actions/runs`).reply({ total_count: 0, workflow_runs: [] })

      await service.listWorkflowRuns('o/r')

      expect(mock.history[0].url).toBe(`${ API_BASE }/repos/o/r/actions/runs`)
    })

    it('maps status dropdown values', async () => {
      mock.onGet(`${ API_BASE }/repos/o/r/actions/runs`).reply({ total_count: 0, workflow_runs: [] })

      await service.listWorkflowRuns('o/r', undefined, 'main', undefined, 'In Progress')

      expect(mock.history[0].query).toMatchObject({ branch: 'main', status: 'in_progress' })
    })
  })

  describe('getWorkflowRun', () => {
    it('sends GET to run URL', async () => {
      mock.onGet(`${ API_BASE }/repos/o/r/actions/runs/30433642`).reply({ id: 30433642 })

      const result = await service.getWorkflowRun('o/r', '30433642')

      expect(result).toMatchObject({ id: 30433642 })
    })
  })

  describe('listWorkflowRunJobs', () => {
    it('sends GET with filter mapping', async () => {
      mock.onGet(`${ API_BASE }/repos/o/r/actions/runs/123/jobs`).reply({ total_count: 0, jobs: [] })

      await service.listWorkflowRunJobs('o/r', '123', 'All', 50, 1)

      expect(mock.history[0].query).toMatchObject({ filter: 'all', per_page: 50, page: 1 })
    })
  })

  describe('triggerWorkflowDispatch', () => {
    it('sends POST and returns success', async () => {
      mock.onPost(`${ API_BASE }/repos/o/r/actions/workflows/161335/dispatches`).reply({})

      const result = await service.triggerWorkflowDispatch('o/r', '161335', 'main', { env: 'prod' })

      expect(result).toEqual({ success: true })
      expect(mock.history[0].body).toEqual({ ref: 'main', inputs: { env: 'prod' } })
    })
  })

  // ── Polling Triggers ──

  describe('onIssueOpened', () => {
    it('returns shaped event when opened event found', async () => {
      mock.onGet(`${ API_BASE }/repos/o/r/issues/events`).reply([
        { event: 'labeled', issue: { number: 1 }, actor: { login: 'x' } },
        { event: 'opened', issue: { number: 2, title: 'New' }, actor: { login: 'octocat' } },
      ])

      const result = await service.onIssueOpened({
        params: { repository: 'o/r' },
      })

      expect(result).toEqual({
        action: 'opened',
        issue: { number: 2, title: 'New' },
        sender: { login: 'octocat' },
      })
    })

    it('returns null when no opened event', async () => {
      mock.onGet(`${ API_BASE }/repos/o/r/issues/events`).reply([
        { event: 'labeled', issue: { number: 1 }, actor: { login: 'x' } },
      ])

      const result = await service.onIssueOpened({ params: { repository: 'o/r' } })

      expect(result).toBeNull()
    })
  })

  describe('onPullRequestOpened', () => {
    it('returns shaped event for newly created PR', async () => {
      const now = '2024-01-01T12:00:00Z'
      mock.onGet(`${ API_BASE }/repos/o/r/pulls`).reply([
        {
          number: 5,
          created_at: now,
          updated_at: now,
          user: { login: 'dev' },
          base: { repo: { full_name: 'o/r' } },
        },
      ])

      const result = await service.onPullRequestOpened({ params: { repository: 'o/r' } })

      expect(result).toMatchObject({ action: 'opened', number: 5 })
    })

    it('returns null when PR has been updated', async () => {
      mock.onGet(`${ API_BASE }/repos/o/r/pulls`).reply([
        { number: 5, created_at: '2024-01-01T12:00:00Z', updated_at: '2024-01-02T12:00:00Z' },
      ])

      const result = await service.onPullRequestOpened({ params: { repository: 'o/r' } })

      expect(result).toBeNull()
    })
  })

  describe('onPush', () => {
    it('returns push payload when PushEvent found', async () => {
      mock.onGet(`${ API_BASE }/repos/o/r/events`).reply([
        { type: 'PushEvent', payload: { ref: 'refs/heads/main', commits: [] } },
      ])

      const result = await service.onPush({ params: { repository: 'o/r' } })

      expect(result).toMatchObject({ ref: 'refs/heads/main' })
    })

    it('returns null when branch filter does not match', async () => {
      mock.onGet(`${ API_BASE }/repos/o/r/events`).reply([
        { type: 'PushEvent', payload: { ref: 'refs/heads/dev', commits: [] } },
      ])

      const result = await service.onPush({ params: { repository: 'o/r', branch: 'main' } })

      expect(result).toBeNull()
    })
  })

  describe('onStar', () => {
    it('returns star event when stargazer found', async () => {
      mock.onGet(`${ API_BASE }/repos/o/r/stargazers`).reply([
        { starred_at: '2024-01-01T00:00:00Z', user: { login: 'fan' } },
      ])

      const result = await service.onStar({ params: { repository: 'o/r' } })

      expect(result).toMatchObject({
        action: 'created',
        starred_at: '2024-01-01T00:00:00Z',
        sender: { login: 'fan' },
      })
    })
  })

  describe('onReleasePublished', () => {
    it('returns release when published and not draft', async () => {
      mock.onGet(`${ API_BASE }/repos/o/r/releases`).reply([
        { published_at: '2024-01-01', draft: false, author: { login: 'dev' } },
      ])

      const result = await service.onReleasePublished({ params: { repository: 'o/r' } })

      expect(result).toMatchObject({ action: 'published' })
    })

    it('returns null for draft release', async () => {
      mock.onGet(`${ API_BASE }/repos/o/r/releases`).reply([
        { published_at: null, draft: true },
      ])

      const result = await service.onReleasePublished({ params: { repository: 'o/r' } })

      expect(result).toBeNull()
    })
  })

  describe('onNewCommit', () => {
    it('returns latest commit', async () => {
      mock.onGet(`${ API_BASE }/repos/o/r/commits`).reply([{ sha: 'abc123' }])

      const result = await service.onNewCommit({ params: { repository: 'o/r', branch: 'dev' } })

      expect(result).toMatchObject({ sha: 'abc123' })
      expect(mock.history[0].query).toMatchObject({ sha: 'dev', per_page: 1 })
    })

    it('defaults to main branch', async () => {
      mock.onGet(`${ API_BASE }/repos/o/r/commits`).reply([{ sha: 'def456' }])

      await service.onNewCommit({ params: { repository: 'o/r' } })

      expect(mock.history[0].query).toMatchObject({ sha: 'main' })
    })
  })

  describe('onNewGist', () => {
    it('returns latest gist', async () => {
      mock.onGet(`${ API_BASE }/gists`).reply([{ id: 'g1' }])

      const result = await service.onNewGist({})

      expect(result).toMatchObject({ id: 'g1' })
    })

    it('returns null when no gists', async () => {
      mock.onGet(`${ API_BASE }/gists`).reply([])

      const result = await service.onNewGist({})

      expect(result).toBeNull()
    })
  })

  describe('onNewMention', () => {
    it('returns first mention notification', async () => {
      mock.onGet(`${ API_BASE }/notifications`).reply([
        { id: '1', reason: 'subscribed' },
        { id: '2', reason: 'mention', subject: { title: 'Hello' } },
      ])

      const result = await service.onNewMention({})

      expect(result).toMatchObject({ id: '2', reason: 'mention' })
    })

    it('returns null when no mentions', async () => {
      mock.onGet(`${ API_BASE }/notifications`).reply([
        { id: '1', reason: 'subscribed' },
      ])

      const result = await service.onNewMention({})

      expect(result).toBeNull()
    })
  })

  describe('onNewNotification', () => {
    it('returns latest notification', async () => {
      mock.onGet(`${ API_BASE }/notifications`).reply([{ id: '1' }])

      const result = await service.onNewNotification({})

      expect(result).toMatchObject({ id: '1' })
    })
  })

  describe('onNewGlobalEvent', () => {
    it('fetches user then returns latest event', async () => {
      mock.onGet(`${ API_BASE }/user`).reply({ login: 'octocat' })
      mock.onGet(`${ API_BASE }/users/octocat/events`).reply([{ id: '123', type: 'PushEvent' }])

      const result = await service.onNewGlobalEvent({})

      expect(result).toMatchObject({ id: '123', type: 'PushEvent' })
    })
  })

  describe('onNewReviewRequest', () => {
    it('returns PR where current user is a requested reviewer', async () => {
      mock.onGet(`${ API_BASE }/user`).reply({ login: 'me' })
      mock.onGet(`${ API_BASE }/repos/o/r/pulls`).reply([
        { number: 1, requested_reviewers: [{ login: 'someone' }] },
        { number: 2, requested_reviewers: [{ login: 'me' }] },
      ])

      const result = await service.onNewReviewRequest({ params: { repository: 'o/r' } })

      expect(result).toMatchObject({ number: 2 })
    })

    it('returns null when no review requests for user', async () => {
      mock.onGet(`${ API_BASE }/user`).reply({ login: 'me' })
      mock.onGet(`${ API_BASE }/repos/o/r/pulls`).reply([
        { number: 1, requested_reviewers: [{ login: 'someone' }] },
      ])

      const result = await service.onNewReviewRequest({ params: { repository: 'o/r' } })

      expect(result).toBeNull()
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('wraps API errors with details', async () => {
      mock.onGet(`${ API_BASE }/user`).replyWithError({
        message: 'Validation Failed',
        body: {
          message: 'Validation Failed',
          errors: [{ resource: 'Issue', code: 'invalid', field: 'title' }],
        },
        status: 422,
      })

      await expect(service.getCurrentUser()).rejects.toThrow('GitHub API error: Validation Failed: Issue invalid (field: title)')
    })

    it('throws on generic API error', async () => {
      mock.onGet(`${ API_BASE }/user`).replyWithError({
        message: 'Unauthorized',
        status: 401,
      })

      await expect(service.getCurrentUser()).rejects.toThrow('GitHub API error')
    })
  })

  // ── handleTriggerPollingForEvent ──

  describe('handleTriggerPollingForEvent', () => {
    it('dispatches to the correct trigger method', async () => {
      mock.onGet(`${ API_BASE }/gists`).reply([{ id: 'g1' }])

      const result = await service.handleTriggerPollingForEvent({
        eventName: 'onNewGist',
      })

      expect(result).toMatchObject({ id: 'g1' })
    })
  })
})
