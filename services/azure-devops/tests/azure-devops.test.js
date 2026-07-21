'use strict'

const { createSandbox } = require('../../../service-sandbox')

const ORG = 'test-org'
const PAT = 'test-pat-token'
const BASE = `https://dev.azure.com/${ ORG }`
const AUTH_HEADER = `Basic ${ Buffer.from(`:${ PAT }`).toString('base64') }`

describe('Azure DevOps Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ organization: ORG, pat: PAT })
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
          name: 'organization',
          required: true,
          shared: false,
          type: 'STRING',
        }),
        expect.objectContaining({
          name: 'pat',
          required: true,
          shared: false,
          type: 'STRING',
        }),
      ])
    })
  })

  // ── Projects ──

  describe('listProjects', () => {
    it('sends correct request with defaults', async () => {
      mock.onGet(`${ BASE }/_apis/projects`).replyWith(call => {
        return { headers: {}, body: { count: 1, value: [{ id: 'p1', name: 'Proj1', state: 'wellFormed' }] } }
      })

      const result = await service.listProjects()

      expect(result).toEqual({
        items: [{ id: 'p1', name: 'Proj1', state: 'wellFormed' }],
        count: 1,
        continuationToken: null,
      })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({ Authorization: AUTH_HEADER })
      expect(mock.history[0].query).toMatchObject({ 'api-version': '7.1' })
    })

    it('passes state filter and top', async () => {
      mock.onGet(`${ BASE }/_apis/projects`).replyWith(() => {
        return { headers: {}, body: { count: 0, value: [] } }
      })

      await service.listProjects('Well Formed', 10)

      expect(mock.history[0].query).toMatchObject({
        stateFilter: 'wellFormed',
        $top: 10,
      })
    })

    it('passes continuation token', async () => {
      mock.onGet(`${ BASE }/_apis/projects`).replyWith(() => {
        return { headers: { 'x-ms-continuationtoken': 'next-page' }, body: { count: 0, value: [] } }
      })

      const result = await service.listProjects(undefined, undefined, 'token123')

      expect(mock.history[0].query).toMatchObject({ continuationToken: 'token123' })
      expect(result.continuationToken).toBe('next-page')
    })
  })

  describe('getProject', () => {
    it('sends correct request', async () => {
      mock.onGet(`${ BASE }/_apis/projects/MyProject`).reply({ id: 'p1', name: 'MyProject' })

      const result = await service.getProject('MyProject')

      expect(result).toEqual({ id: 'p1', name: 'MyProject' })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({ Authorization: AUTH_HEADER })
    })

    it('includes capabilities when requested', async () => {
      mock.onGet(`${ BASE }/_apis/projects/MyProject`).reply({ id: 'p1' })

      await service.getProject('MyProject', true)

      expect(mock.history[0].query).toMatchObject({ includeCapabilities: true })
    })

    it('omits capabilities param when false', async () => {
      mock.onGet(`${ BASE }/_apis/projects/MyProject`).reply({ id: 'p1' })

      await service.getProject('MyProject', false)

      expect(mock.history[0].query.includeCapabilities).toBeUndefined()
    })
  })

  // ── Teams ──

  describe('listTeams', () => {
    it('sends correct request', async () => {
      mock.onGet(`${ BASE }/_apis/projects/Proj1/teams`).reply({ count: 1, value: [{ id: 't1', name: 'Team A' }] })

      const result = await service.listTeams('Proj1')

      expect(result).toEqual({
        items: [{ id: 't1', name: 'Team A' }],
        count: 1,
      })
    })

    it('passes top and skip', async () => {
      mock.onGet(`${ BASE }/_apis/projects/Proj1/teams`).reply({ count: 0, value: [] })

      await service.listTeams('Proj1', 5, 10)

      expect(mock.history[0].query).toMatchObject({ $top: 5, $skip: 10 })
    })
  })

  // ── Work Items ──

  describe('getWorkItem', () => {
    it('sends correct request with expand=all', async () => {
      mock.onGet(`${ BASE }/Proj1/_apis/wit/workitems/42`).reply({ id: 42, rev: 1, fields: {} })

      const result = await service.getWorkItem('Proj1', 42)

      expect(result).toEqual({ id: 42, rev: 1, fields: {} })
      expect(mock.history[0].query).toMatchObject({ $expand: 'all' })
    })
  })

  describe('getWorkItemsBatch', () => {
    it('sends correct request with ids joined', async () => {
      mock.onGet(`${ BASE }/_apis/wit/workitems`).reply({ count: 2, value: [{ id: 1 }, { id: 2 }] })

      const result = await service.getWorkItemsBatch([1, 2])

      expect(result).toEqual({ items: [{ id: 1 }, { id: 2 }], count: 2 })
      expect(mock.history[0].query).toMatchObject({ ids: '1,2', $expand: 'all' })
    })

    it('resolves expand dropdown value', async () => {
      mock.onGet(`${ BASE }/_apis/wit/workitems`).reply({ count: 0, value: [] })

      await service.getWorkItemsBatch([1], 'Fields')

      expect(mock.history[0].query).toMatchObject({ $expand: 'fields' })
    })

    it('defaults expand to all when not provided', async () => {
      mock.onGet(`${ BASE }/_apis/wit/workitems`).reply({ count: 0, value: [] })

      await service.getWorkItemsBatch([1])

      expect(mock.history[0].query).toMatchObject({ $expand: 'all' })
    })
  })

  describe('createWorkItem', () => {
    it('sends correct POST with json-patch content type', async () => {
      mock.onPost(`${ BASE }/Proj1/_apis/wit/workitems/%24Task`).reply({ id: 100, rev: 1 })

      const result = await service.createWorkItem('Proj1', 'Task', 'My Task')

      expect(result).toEqual({ id: 100, rev: 1 })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({
        'Content-Type': 'application/json-patch+json',
      })
      expect(mock.history[0].body).toEqual([
        { op: 'add', path: '/fields/System.Title', value: 'My Task' },
      ])
    })

    it('includes all optional fields', async () => {
      mock.onPost(`${ BASE }/Proj1/_apis/wit/workitems/%24Bug`).reply({ id: 101, rev: 1 })

      await service.createWorkItem(
        'Proj1', 'Bug', 'Bug Title', '<p>Desc</p>', 'user@example.com',
        'Active', ['tag1', 'tag2'], 2, 'Proj1\\Area1', 'Proj1\\Sprint 1'
      )

      expect(mock.history[0].body).toEqual([
        { op: 'add', path: '/fields/System.Title', value: 'Bug Title' },
        { op: 'add', path: '/fields/System.Description', value: '<p>Desc</p>' },
        { op: 'add', path: '/fields/System.AssignedTo', value: 'user@example.com' },
        { op: 'add', path: '/fields/System.State', value: 'Active' },
        { op: 'add', path: '/fields/System.Tags', value: 'tag1; tag2' },
        { op: 'add', path: '/fields/Microsoft.VSTS.Common.Priority', value: 2 },
        { op: 'add', path: '/fields/System.AreaPath', value: 'Proj1\\Area1' },
        { op: 'add', path: '/fields/System.IterationPath', value: 'Proj1\\Sprint 1' },
      ])
    })

    it('appends raw operations', async () => {
      mock.onPost(`${ BASE }/Proj1/_apis/wit/workitems/%24Task`).reply({ id: 102, rev: 1 })

      await service.createWorkItem(
        'Proj1', 'Task', 'Title', undefined, undefined, undefined,
        undefined, undefined, undefined, undefined,
        [{ op: 'add', path: '/fields/Custom.Field', value: 'custom' }]
      )

      expect(mock.history[0].body).toEqual([
        { op: 'add', path: '/fields/System.Title', value: 'Title' },
        { op: 'add', path: '/fields/Custom.Field', value: 'custom', from: undefined },
      ])
    })

    it('encodes User Story type in URL', async () => {
      mock.onPost(`${ BASE }/Proj1/_apis/wit/workitems/%24User%20Story`).reply({ id: 103, rev: 1 })

      await service.createWorkItem('Proj1', 'User Story', 'A Story')

      expect(mock.history).toHaveLength(1)
    })
  })

  describe('updateWorkItem', () => {
    it('sends PATCH with replace operations', async () => {
      mock.onPatch(`${ BASE }/_apis/wit/workitems/42`).reply({ id: 42, rev: 2 })

      const result = await service.updateWorkItem(42, 'New Title')

      expect(result).toEqual({ id: 42, rev: 2 })
      expect(mock.history[0].headers).toMatchObject({
        'Content-Type': 'application/json-patch+json',
      })
      expect(mock.history[0].body).toEqual([
        { op: 'replace', path: '/fields/System.Title', value: 'New Title' },
      ])
    })

    it('throws when no fields are provided', async () => {
      await expect(service.updateWorkItem(42)).rejects.toThrow('no fields provided to update')
    })
  })

  describe('deleteWorkItem', () => {
    it('sends DELETE request', async () => {
      mock.onDelete(`${ BASE }/_apis/wit/workitems/42`).reply({ id: 42, code: 200 })

      const result = await service.deleteWorkItem(42)

      expect(result).toEqual({ id: 42, code: 200 })
      expect(mock.history[0].method).toBe('delete')
    })

    it('passes destroy=true when requested', async () => {
      mock.onDelete(`${ BASE }/_apis/wit/workitems/42`).reply({ id: 42, code: 200 })

      await service.deleteWorkItem(42, true)

      expect(mock.history[0].query).toMatchObject({ destroy: true })
    })

    it('omits destroy when false', async () => {
      mock.onDelete(`${ BASE }/_apis/wit/workitems/42`).reply({ id: 42, code: 200 })

      await service.deleteWorkItem(42, false)

      expect(mock.history[0].query.destroy).toBeUndefined()
    })
  })

  describe('addWorkItemComment', () => {
    it('sends POST with comment text and preview API version', async () => {
      mock.onPost(`${ BASE }/Proj1/_apis/wit/workItems/42/comments`).reply({ id: 50, text: 'Hello' })

      const result = await service.addWorkItemComment('Proj1', 42, 'Hello')

      expect(result).toEqual({ id: 50, text: 'Hello' })
      expect(mock.history[0].body).toEqual({ text: 'Hello' })
      expect(mock.history[0].query).toMatchObject({ 'api-version': '7.1-preview.4' })
    })
  })

  describe('listWorkItemComments', () => {
    it('sends GET with preview API version', async () => {
      mock.onGet(`${ BASE }/Proj1/_apis/wit/workItems/42/comments`).reply({ totalCount: 1, count: 1, comments: [] })

      const result = await service.listWorkItemComments('Proj1', 42)

      expect(result).toEqual({ totalCount: 1, count: 1, comments: [] })
      expect(mock.history[0].query).toMatchObject({ 'api-version': '7.1-preview.4' })
    })

    it('passes top param', async () => {
      mock.onGet(`${ BASE }/Proj1/_apis/wit/workItems/42/comments`).reply({ totalCount: 0, count: 0, comments: [] })

      await service.listWorkItemComments('Proj1', 42, 5)

      expect(mock.history[0].query).toMatchObject({ $top: 5 })
    })
  })

  // ── Queries (WIQL) ──

  describe('runWiqlQuery', () => {
    it('sends POST with WIQL query body', async () => {
      const wiql = "SELECT [System.Id] FROM WorkItems WHERE [System.State] = 'Active'"
      mock.onPost(`${ BASE }/Proj1/_apis/wit/wiql`).reply({
        queryType: 'flat',
        workItems: [{ id: 297 }],
      })

      const result = await service.runWiqlQuery('Proj1', wiql)

      expect(result).toEqual({ queryType: 'flat', workItems: [{ id: 297 }] })
      expect(mock.history[0].body).toEqual({ query: wiql })
    })

    it('passes top param', async () => {
      mock.onPost(`${ BASE }/Proj1/_apis/wit/wiql`).reply({ queryType: 'flat', workItems: [] })

      await service.runWiqlQuery('Proj1', 'SELECT [System.Id] FROM WorkItems', 10)

      expect(mock.history[0].query).toMatchObject({ $top: 10 })
    })
  })

  // ── Repositories ──

  describe('listRepositories', () => {
    it('sends correct request and wraps response', async () => {
      mock.onGet(`${ BASE }/Proj1/_apis/git/repositories`).reply({
        count: 1,
        value: [{ id: 'r1', name: 'Repo1' }],
      })

      const result = await service.listRepositories('Proj1')

      expect(result).toEqual({ items: [{ id: 'r1', name: 'Repo1' }], count: 1 })
    })
  })

  describe('getRepository', () => {
    it('sends correct request', async () => {
      mock.onGet(`${ BASE }/Proj1/_apis/git/repositories/r1`).reply({ id: 'r1', name: 'Repo1' })

      const result = await service.getRepository('Proj1', 'r1')

      expect(result).toEqual({ id: 'r1', name: 'Repo1' })
    })
  })

  describe('listBranches', () => {
    it('sends correct request with heads filter', async () => {
      mock.onGet(`${ BASE }/Proj1/_apis/git/repositories/r1/refs`).reply({
        count: 1,
        value: [{ name: 'refs/heads/main', objectId: 'abc123' }],
      })

      const result = await service.listBranches('Proj1', 'r1')

      expect(result).toEqual({
        items: [{ name: 'refs/heads/main', objectId: 'abc123' }],
        count: 1,
      })
      expect(mock.history[0].query).toMatchObject({ filter: 'heads/' })
    })
  })

  describe('listCommits', () => {
    it('sends correct request with defaults', async () => {
      mock.onGet(`${ BASE }/Proj1/_apis/git/repositories/r1/commits`).reply({
        count: 1,
        value: [{ commitId: 'abc', comment: 'Fix bug' }],
      })

      const result = await service.listCommits('Proj1', 'r1')

      expect(result).toEqual({
        items: [{ commitId: 'abc', comment: 'Fix bug' }],
        count: 1,
      })
    })

    it('passes branch and author filters', async () => {
      mock.onGet(`${ BASE }/Proj1/_apis/git/repositories/r1/commits`).reply({ count: 0, value: [] })

      await service.listCommits('Proj1', 'r1', 'main', 'Jamal', 10, 5)

      expect(mock.history[0].query).toMatchObject({
        'searchCriteria.itemVersion.version': 'main',
        'searchCriteria.itemVersion.versionType': 'branch',
        'searchCriteria.author': 'Jamal',
        'searchCriteria.$top': 10,
        'searchCriteria.$skip': 5,
      })
    })

    it('omits versionType when no branch is specified', async () => {
      mock.onGet(`${ BASE }/Proj1/_apis/git/repositories/r1/commits`).reply({ count: 0, value: [] })

      await service.listCommits('Proj1', 'r1')

      expect(mock.history[0].query['searchCriteria.itemVersion.versionType']).toBeUndefined()
    })
  })

  describe('getFileContent', () => {
    it('sends correct request and wraps response', async () => {
      mock.onGet(`${ BASE }/Proj1/_apis/git/repositories/r1/items`).reply('# README content')

      const result = await service.getFileContent('Proj1', 'r1', '/README.md')

      expect(result).toEqual({
        path: '/README.md',
        branch: null,
        content: '# README content',
      })
      expect(mock.history[0].query).toMatchObject({
        path: '/README.md',
        download: false,
        includeContent: true,
      })
    })

    it('passes branch version descriptor', async () => {
      mock.onGet(`${ BASE }/Proj1/_apis/git/repositories/r1/items`).reply('content')

      await service.getFileContent('Proj1', 'r1', '/src/index.js', 'develop')

      expect(mock.history[0].query).toMatchObject({
        'versionDescriptor.version': 'develop',
        'versionDescriptor.versionType': 'branch',
      })
    })
  })

  // ── Pull Requests ──

  describe('listPullRequests', () => {
    it('sends correct request with defaults', async () => {
      mock.onGet(`${ BASE }/Proj1/_apis/git/repositories/r1/pullrequests`).reply({
        count: 1,
        value: [{ pullRequestId: 22, title: 'Feature PR' }],
      })

      const result = await service.listPullRequests('Proj1', 'r1')

      expect(result).toEqual({
        items: [{ pullRequestId: 22, title: 'Feature PR' }],
        count: 1,
      })
    })

    it('resolves status dropdown and passes filters', async () => {
      mock.onGet(`${ BASE }/Proj1/_apis/git/repositories/r1/pullrequests`).reply({ count: 0, value: [] })

      await service.listPullRequests('Proj1', 'r1', 'Completed', 'refs/heads/main', 'user-guid', 10, 5)

      expect(mock.history[0].query).toMatchObject({
        'searchCriteria.status': 'completed',
        'searchCriteria.targetRefName': 'refs/heads/main',
        'searchCriteria.creatorId': 'user-guid',
        $top: 10,
        $skip: 5,
      })
    })
  })

  describe('getPullRequest', () => {
    it('sends correct request', async () => {
      mock.onGet(`${ BASE }/Proj1/_apis/git/repositories/r1/pullrequests/22`).reply({
        pullRequestId: 22,
        title: 'Feature PR',
      })

      const result = await service.getPullRequest('Proj1', 'r1', 22)

      expect(result).toEqual({ pullRequestId: 22, title: 'Feature PR' })
    })
  })

  describe('createPullRequest', () => {
    it('sends correct POST with required fields', async () => {
      mock.onPost(`${ BASE }/Proj1/_apis/git/repositories/r1/pullrequests`).reply({
        pullRequestId: 23,
        title: 'New PR',
      })

      const result = await service.createPullRequest(
        'Proj1', 'r1', 'refs/heads/feature', 'refs/heads/main', 'New PR'
      )

      expect(result).toEqual({ pullRequestId: 23, title: 'New PR' })
      expect(mock.history[0].body).toEqual({
        sourceRefName: 'refs/heads/feature',
        targetRefName: 'refs/heads/main',
        title: 'New PR',
      })
    })

    it('includes optional fields', async () => {
      mock.onPost(`${ BASE }/Proj1/_apis/git/repositories/r1/pullrequests`).reply({ pullRequestId: 24 })

      await service.createPullRequest(
        'Proj1', 'r1', 'refs/heads/feature', 'refs/heads/main',
        'Draft PR', 'Description text', true, ['reviewer-id-1']
      )

      expect(mock.history[0].body).toEqual({
        sourceRefName: 'refs/heads/feature',
        targetRefName: 'refs/heads/main',
        title: 'Draft PR',
        description: 'Description text',
        isDraft: true,
        reviewers: [{ id: 'reviewer-id-1' }],
      })
    })

    it('omits isDraft and reviewers when not provided', async () => {
      mock.onPost(`${ BASE }/Proj1/_apis/git/repositories/r1/pullrequests`).reply({ pullRequestId: 25 })

      await service.createPullRequest(
        'Proj1', 'r1', 'refs/heads/feature', 'refs/heads/main', 'Simple PR'
      )

      expect(mock.history[0].body.isDraft).toBeUndefined()
      expect(mock.history[0].body.reviewers).toBeUndefined()
    })
  })

  describe('updatePullRequest', () => {
    it('sends PATCH with status', async () => {
      mock.onPatch(`${ BASE }/Proj1/_apis/git/repositories/r1/pullrequests/22`).reply({
        pullRequestId: 22,
        status: 'abandoned',
      })

      const result = await service.updatePullRequest('Proj1', 'r1', 22, 'Abandoned')

      expect(result).toEqual({ pullRequestId: 22, status: 'abandoned' })
      expect(mock.history[0].body).toEqual({ status: 'abandoned' })
    })

    it('includes completion options', async () => {
      mock.onPatch(`${ BASE }/Proj1/_apis/git/repositories/r1/pullrequests/22`).reply({ pullRequestId: 22 })

      await service.updatePullRequest(
        'Proj1', 'r1', 22, 'Completed', undefined, undefined,
        { deleteSourceBranch: true, mergeStrategy: 'squash' }
      )

      expect(mock.history[0].body).toEqual({
        status: 'completed',
        completionOptions: { deleteSourceBranch: true, mergeStrategy: 'squash' },
      })
    })

    it('throws when no fields are provided', async () => {
      await expect(service.updatePullRequest('Proj1', 'r1', 22)).rejects.toThrow('no fields provided to update')
    })
  })

  describe('addPullRequestComment', () => {
    it('sends POST with comment thread body', async () => {
      mock.onPost(`${ BASE }/Proj1/_apis/git/repositories/r1/pullrequests/22/threads`).reply({
        id: 148,
        comments: [{ id: 1, content: 'Review note' }],
      })

      const result = await service.addPullRequestComment('Proj1', 'r1', 22, 'Review note')

      expect(result).toEqual({ id: 148, comments: [{ id: 1, content: 'Review note' }] })
      expect(mock.history[0].body).toEqual({
        comments: [{ parentCommentId: 0, content: 'Review note', commentType: 'text' }],
      })
    })

    it('resolves thread status', async () => {
      mock.onPost(`${ BASE }/Proj1/_apis/git/repositories/r1/pullrequests/22/threads`).reply({ id: 149 })

      await service.addPullRequestComment('Proj1', 'r1', 22, 'Fix this', 'Active')

      expect(mock.history[0].body).toMatchObject({ status: 'active' })
    })
  })

  // ── Pipelines & Builds ──

  describe('listPipelines', () => {
    it('sends correct request', async () => {
      mock.onGet(`${ BASE }/Proj1/_apis/pipelines`).replyWith(() => {
        return { headers: {}, body: { count: 1, value: [{ id: 1, name: 'CI' }] } }
      })

      const result = await service.listPipelines('Proj1')

      expect(result).toEqual({
        items: [{ id: 1, name: 'CI' }],
        count: 1,
        continuationToken: null,
      })
    })
  })

  describe('runPipeline', () => {
    it('sends POST with minimal body', async () => {
      mock.onPost(`${ BASE }/Proj1/_apis/pipelines/1/runs`).reply({ id: 137, state: 'inProgress' })

      const result = await service.runPipeline('Proj1', 1)

      expect(result).toEqual({ id: 137, state: 'inProgress' })
      expect(mock.history[0].body).toEqual({ resources: {} })
    })

    it('includes branch, template params and variables', async () => {
      mock.onPost(`${ BASE }/Proj1/_apis/pipelines/1/runs`).reply({ id: 138 })

      await service.runPipeline(
        'Proj1', 1, 'refs/heads/develop',
        { environment: 'staging' },
        { deploy: { value: 'true' } }
      )

      expect(mock.history[0].body).toEqual({
        resources: { repositories: { self: { refName: 'refs/heads/develop' } } },
        templateParameters: { environment: 'staging' },
        variables: { deploy: { value: 'true' } },
      })
    })
  })

  describe('getPipelineRun', () => {
    it('sends correct request', async () => {
      mock.onGet(`${ BASE }/Proj1/_apis/pipelines/1/runs/137`).reply({ id: 137, state: 'completed', result: 'succeeded' })

      const result = await service.getPipelineRun('Proj1', 1, 137)

      expect(result).toEqual({ id: 137, state: 'completed', result: 'succeeded' })
    })
  })

  describe('listBuilds', () => {
    it('sends correct request with defaults', async () => {
      mock.onGet(`${ BASE }/Proj1/_apis/build/builds`).replyWith(() => {
        return { headers: {}, body: { count: 1, value: [{ id: 501 }] } }
      })

      const result = await service.listBuilds('Proj1')

      expect(result).toEqual({ items: [{ id: 501 }], count: 1, continuationToken: null })
    })

    it('passes definition IDs and status/result filters', async () => {
      mock.onGet(`${ BASE }/Proj1/_apis/build/builds`).replyWith(() => {
        return { headers: {}, body: { count: 0, value: [] } }
      })

      await service.listBuilds('Proj1', [12, 13], 'Completed', 'Failed', 5)

      expect(mock.history[0].query).toMatchObject({
        definitions: '12,13',
        statusFilter: 'completed',
        resultFilter: 'failed',
        $top: 5,
      })
    })
  })

  describe('getBuild', () => {
    it('sends correct request', async () => {
      mock.onGet(`${ BASE }/Proj1/_apis/build/builds/501`).reply({ id: 501, status: 'completed' })

      const result = await service.getBuild('Proj1', 501)

      expect(result).toEqual({ id: 501, status: 'completed' })
    })
  })

  describe('queueBuild', () => {
    it('sends POST with definition id', async () => {
      mock.onPost(`${ BASE }/Proj1/_apis/build/builds`).reply({ id: 502, status: 'notStarted' })

      const result = await service.queueBuild('Proj1', 12)

      expect(result).toEqual({ id: 502, status: 'notStarted' })
      expect(mock.history[0].body).toEqual({ definition: { id: 12 } })
    })

    it('includes source branch when provided', async () => {
      mock.onPost(`${ BASE }/Proj1/_apis/build/builds`).reply({ id: 503 })

      await service.queueBuild('Proj1', 12, 'refs/heads/develop')

      expect(mock.history[0].body).toEqual({
        definition: { id: 12 },
        sourceBranch: 'refs/heads/develop',
      })
    })
  })

  // ── Boards / Iterations ──

  describe('listTeamIterations', () => {
    it('sends correct request', async () => {
      mock.onGet(`${ BASE }/Proj1/Team1/_apis/work/teamsettings/iterations`).reply({
        count: 1,
        value: [{ id: 'i1', name: 'Sprint 1' }],
      })

      const result = await service.listTeamIterations('Proj1', 'Team1')

      expect(result).toEqual({ items: [{ id: 'i1', name: 'Sprint 1' }], count: 1 })
    })

    it('passes current timeframe when currentOnly is true', async () => {
      mock.onGet(`${ BASE }/Proj1/Team1/_apis/work/teamsettings/iterations`).reply({ count: 0, value: [] })

      await service.listTeamIterations('Proj1', 'Team1', true)

      expect(mock.history[0].query).toMatchObject({ $timeframe: 'current' })
    })
  })

  // ── Dictionaries ──

  describe('projectsDictionary', () => {
    it('returns formatted items', async () => {
      mock.onGet(`${ BASE }/_apis/projects`).replyWith(() => {
        return { headers: {}, body: { count: 2, value: [{ name: 'Proj1', state: 'wellFormed' }, { name: 'Proj2', state: 'wellFormed' }] } }
      })

      const result = await service.projectsDictionary({})

      expect(result.items).toEqual([
        { label: 'Proj1', value: 'Proj1', note: 'wellFormed' },
        { label: 'Proj2', value: 'Proj2', note: 'wellFormed' },
      ])
    })

    it('filters by search term', async () => {
      mock.onGet(`${ BASE }/_apis/projects`).replyWith(() => {
        return { headers: {}, body: { count: 2, value: [{ name: 'Alpha', state: 'wellFormed' }, { name: 'Beta', state: 'wellFormed' }] } }
      })

      const result = await service.projectsDictionary({ search: 'alph' })

      expect(result.items).toEqual([
        { label: 'Alpha', value: 'Alpha', note: 'wellFormed' },
      ])
    })
  })

  describe('repositoriesDictionary', () => {
    it('returns empty when no project is provided', async () => {
      const result = await service.repositoriesDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
      expect(mock.history).toHaveLength(0)
    })

    it('returns formatted items with project', async () => {
      mock.onGet(`${ BASE }/Proj1/_apis/git/repositories`).reply({
        value: [{ id: 'r1', name: 'Repo1', defaultBranch: 'refs/heads/main' }],
      })

      const result = await service.repositoriesDictionary({ criteria: { project: 'Proj1' } })

      expect(result.items).toEqual([
        { label: 'Repo1', value: 'r1', note: 'refs/heads/main' },
      ])
    })
  })

  describe('pipelinesDictionary', () => {
    it('returns empty when no project is provided', async () => {
      const result = await service.pipelinesDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('returns formatted items with project', async () => {
      mock.onGet(`${ BASE }/Proj1/_apis/pipelines`).replyWith(() => {
        return { headers: {}, body: { count: 1, value: [{ id: 1, name: 'CI', folder: '\\' }] } }
      })

      const result = await service.pipelinesDictionary({ criteria: { project: 'Proj1' } })

      expect(result.items).toEqual([
        { label: 'CI', value: '1', note: '\\' },
      ])
    })
  })

  describe('teamsDictionary', () => {
    it('returns empty when no project is provided', async () => {
      const result = await service.teamsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('returns formatted items with project', async () => {
      mock.onGet(`${ BASE }/_apis/projects/Proj1/teams`).reply({
        value: [{ name: 'Team A', description: 'Default team' }],
      })

      const result = await service.teamsDictionary({ criteria: { project: 'Proj1' } })

      expect(result.items).toEqual([
        { label: 'Team A', value: 'Team A', note: 'Default team' },
      ])
    })
  })

  // ── Error Handling ──

  describe('error handling', () => {
    it('wraps API errors with status code', async () => {
      mock.onGet(`${ BASE }/_apis/projects/bad`).replyWithError({
        message: 'Not Found',
        status: 404,
        body: { message: 'Project not found' },
      })

      await expect(service.getProject('bad')).rejects.toThrow('Azure DevOps API error: Project not found (HTTP 404)')
    })

    it('wraps API errors without body message', async () => {
      mock.onGet(`${ BASE }/_apis/projects/bad2`).replyWithError({
        message: 'Internal Server Error',
        status: 500,
      })

      await expect(service.getProject('bad2')).rejects.toThrow('Azure DevOps API error: Internal Server Error (HTTP 500)')
    })
  })
})
