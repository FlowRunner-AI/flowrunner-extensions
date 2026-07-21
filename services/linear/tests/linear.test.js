'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'lin_api_test_key_123'
const ENDPOINT = 'https://api.linear.app/graphql'

describe('Linear Service', () => {
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

  // ── Registration ──

  describe('service registration', () => {
    it('registers with correct config items', () => {
      expect(sandbox.getConfigItems()).toEqual([
        expect.objectContaining({
          name: 'apiKey',
          required: true,
          shared: false,
          type: 'STRING',
        }),
      ])
    })
  })

  // ── Helper: assert common GraphQL request shape ──

  function expectGraphQLRequest(index = 0) {
    expect(mock.history).toHaveLength(index + 1)
    expect(mock.history[index].url).toBe(ENDPOINT)
    expect(mock.history[index].headers).toMatchObject({
      Authorization: API_KEY,
      'Content-Type': 'application/json',
    })

    return mock.history[index]
  }

  // ── Issues ──

  describe('createIssue', () => {
    it('sends mutation with required params only', async () => {
      mock.onPost(ENDPOINT).reply({
        data: {
          issueCreate: {
            success: true,
            issue: { id: 'issue-1', identifier: 'ENG-1', title: 'Test Issue' },
          },
        },
      })

      const result = await service.createIssue('team-1', 'Test Issue')

      expect(result).toEqual({
        success: true,
        issue: { id: 'issue-1', identifier: 'ENG-1', title: 'Test Issue' },
      })

      const req = expectGraphQLRequest()

      expect(req.body.variables.input).toEqual({ teamId: 'team-1', title: 'Test Issue' })
      expect(req.body.query).toContain('issueCreate')
    })

    it('includes all optional params when provided', async () => {
      mock.onPost(ENDPOINT).reply({
        data: {
          issueCreate: {
            success: true,
            issue: { id: 'issue-2', identifier: 'ENG-2', title: 'Full Issue' },
          },
        },
      })

      await service.createIssue(
        'team-1', 'Full Issue', 'Description here', 'user-1',
        'High', 'state-1', ['label-1', 'label-2'], 'project-1', '2025-12-31'
      )

      const req = expectGraphQLRequest()
      const input = req.body.variables.input

      expect(input.teamId).toBe('team-1')
      expect(input.title).toBe('Full Issue')
      expect(input.description).toBe('Description here')
      expect(input.assigneeId).toBe('user-1')
      expect(input.priority).toBe(2) // 'High' maps to 2
      expect(input.stateId).toBe('state-1')
      expect(input.labelIds).toEqual(['label-1', 'label-2'])
      expect(input.projectId).toBe('project-1')
      expect(input.dueDate).toBe('2025-12-31')
    })

    it('resolves priority label "Urgent" to numeric value 1', async () => {
      mock.onPost(ENDPOINT).reply({
        data: { issueCreate: { success: true, issue: { id: 'issue-3' } } },
      })

      await service.createIssue('team-1', 'Urgent Issue', undefined, undefined, 'Urgent')

      const input = mock.history[0].body.variables.input

      expect(input.priority).toBe(1)
    })

    it('resolves priority label "No priority" to numeric value 0', async () => {
      mock.onPost(ENDPOINT).reply({
        data: { issueCreate: { success: true, issue: { id: 'issue-4' } } },
      })

      await service.createIssue('team-1', 'No Prio', undefined, undefined, 'No priority')

      const input = mock.history[0].body.variables.input

      expect(input.priority).toBe(0)
    })

    it('accepts comma-separated label IDs', async () => {
      mock.onPost(ENDPOINT).reply({
        data: { issueCreate: { success: true, issue: { id: 'issue-5' } } },
      })

      await service.createIssue('team-1', 'Labels', undefined, undefined, undefined, undefined, 'l1, l2, l3')

      const input = mock.history[0].body.variables.input

      expect(input.labelIds).toEqual(['l1', 'l2', 'l3'])
    })

    it('omits optional fields when undefined', async () => {
      mock.onPost(ENDPOINT).reply({
        data: { issueCreate: { success: true, issue: { id: 'issue-6' } } },
      })

      await service.createIssue('team-1', 'Minimal')

      const input = mock.history[0].body.variables.input

      expect(input).toEqual({ teamId: 'team-1', title: 'Minimal' })
      expect(input).not.toHaveProperty('description')
      expect(input).not.toHaveProperty('assigneeId')
      expect(input).not.toHaveProperty('priority')
      expect(input).not.toHaveProperty('labelIds')
    })

    it('throws on GraphQL errors in response', async () => {
      mock.onPost(ENDPOINT).reply({
        data: null,
        errors: [{ message: 'Team not found' }],
      })

      await expect(service.createIssue('bad-team', 'Test')).rejects.toThrow('Linear API error')
    })

    it('throws on transport error', async () => {
      mock.onPost(ENDPOINT).replyWithError({
        message: 'Unauthorized',
        body: { message: 'Invalid API key' },
      })

      await expect(service.createIssue('team-1', 'Test')).rejects.toThrow('Linear API error')
    })
  })

  describe('getIssue', () => {
    it('sends query with issue ID', async () => {
      mock.onPost(ENDPOINT).reply({
        data: {
          issue: { id: 'issue-1', identifier: 'ENG-42', title: 'Fix bug' },
        },
      })

      const result = await service.getIssue('issue-1')

      expect(result).toEqual({ id: 'issue-1', identifier: 'ENG-42', title: 'Fix bug' })

      const req = expectGraphQLRequest()

      expect(req.body.variables).toEqual({ id: 'issue-1' })
      expect(req.body.query).toContain('issue(id: $id)')
    })
  })

  describe('listIssues', () => {
    it('sends query with default pagination', async () => {
      mock.onPost(ENDPOINT).reply({
        data: {
          issues: {
            nodes: [{ id: 'issue-1', identifier: 'ENG-1' }],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      })

      const result = await service.listIssues()

      expect(result.nodes).toHaveLength(1)

      const req = expectGraphQLRequest()

      expect(req.body.variables.first).toBe(50)
      expect(req.body.variables.after).toBeUndefined()
      expect(req.body.variables.filter).toBeUndefined()
    })

    it('applies team, assignee, and state filters', async () => {
      mock.onPost(ENDPOINT).reply({
        data: {
          issues: { nodes: [], pageInfo: { hasNextPage: false } },
        },
      })

      await service.listIssues('team-1', 'user-1', 'state-1')

      const vars = mock.history[0].body.variables

      expect(vars.filter).toEqual({
        team: { id: { eq: 'team-1' } },
        assignee: { id: { eq: 'user-1' } },
        state: { id: { eq: 'state-1' } },
      })
    })

    it('passes custom limit and cursor', async () => {
      mock.onPost(ENDPOINT).reply({
        data: {
          issues: { nodes: [], pageInfo: { hasNextPage: false } },
        },
      })

      await service.listIssues(undefined, undefined, undefined, 10, 'cursor-abc')

      const vars = mock.history[0].body.variables

      expect(vars.first).toBe(10)
      expect(vars.after).toBe('cursor-abc')
    })
  })

  describe('updateIssue', () => {
    it('sends mutation with only changed fields', async () => {
      mock.onPost(ENDPOINT).reply({
        data: {
          issueUpdate: {
            success: true,
            issue: { id: 'issue-1', title: 'Updated Title' },
          },
        },
      })

      const result = await service.updateIssue('issue-1', 'Updated Title')

      expect(result.success).toBe(true)

      const req = expectGraphQLRequest()

      expect(req.body.variables.id).toBe('issue-1')
      expect(req.body.variables.input).toEqual({ title: 'Updated Title' })
      expect(req.body.query).toContain('issueUpdate')
    })

    it('resolves priority and labels', async () => {
      mock.onPost(ENDPOINT).reply({
        data: { issueUpdate: { success: true, issue: { id: 'issue-1' } } },
      })

      await service.updateIssue('issue-1', undefined, undefined, undefined, 'Low', undefined, undefined, 'l1,l2')

      const input = mock.history[0].body.variables.input

      expect(input.priority).toBe(4) // 'Low' maps to 4
      expect(input.labelIds).toEqual(['l1', 'l2'])
      expect(input).not.toHaveProperty('title')
    })
  })

  describe('deleteIssue', () => {
    it('sends archive mutation', async () => {
      mock.onPost(ENDPOINT).reply({
        data: { issueArchive: { success: true } },
      })

      const result = await service.deleteIssue('issue-1')

      expect(result).toEqual({ success: true, issueId: 'issue-1' })

      const req = expectGraphQLRequest()

      expect(req.body.variables).toEqual({ id: 'issue-1' })
      expect(req.body.query).toContain('issueArchive')
    })

    it('returns success false when archive fails', async () => {
      mock.onPost(ENDPOINT).reply({
        data: { issueArchive: { success: false } },
      })

      const result = await service.deleteIssue('issue-bad')

      expect(result.success).toBe(false)
    })
  })

  describe('createComment', () => {
    it('sends mutation with issueId and body', async () => {
      mock.onPost(ENDPOINT).reply({
        data: {
          commentCreate: {
            success: true,
            comment: { id: 'comment-1', body: 'Nice work!' },
          },
        },
      })

      const result = await service.createComment('issue-1', 'Nice work!')

      expect(result.success).toBe(true)
      expect(result.comment.body).toBe('Nice work!')

      const req = expectGraphQLRequest()

      expect(req.body.variables.input).toEqual({ issueId: 'issue-1', body: 'Nice work!' })
      expect(req.body.query).toContain('commentCreate')
    })
  })

  // ── Search ──

  describe('searchIssues', () => {
    it('sends search query with defaults', async () => {
      mock.onPost(ENDPOINT).reply({
        data: {
          issueSearch: {
            nodes: [{ id: 'issue-1', title: 'Login bug' }],
            pageInfo: { hasNextPage: false },
          },
        },
      })

      const result = await service.searchIssues('login')

      expect(result.nodes).toHaveLength(1)

      const req = expectGraphQLRequest()

      expect(req.body.variables).toMatchObject({ query: 'login', first: 25 })
      expect(req.body.variables.after).toBeUndefined()
    })

    it('passes custom limit and cursor', async () => {
      mock.onPost(ENDPOINT).reply({
        data: {
          issueSearch: { nodes: [], pageInfo: { hasNextPage: false } },
        },
      })

      await service.searchIssues('test', 10, 'cursor-xyz')

      const vars = mock.history[0].body.variables

      expect(vars.first).toBe(10)
      expect(vars.after).toBe('cursor-xyz')
    })
  })

  // ── Teams ──

  describe('listTeams', () => {
    it('sends query with default pagination', async () => {
      mock.onPost(ENDPOINT).reply({
        data: {
          teams: {
            nodes: [{ id: 't1', name: 'Engineering', key: 'ENG' }],
            pageInfo: { hasNextPage: false },
          },
        },
      })

      const result = await service.listTeams()

      expect(result.nodes).toHaveLength(1)

      const vars = mock.history[0].body.variables

      expect(vars.first).toBe(50)
      expect(vars.after).toBeUndefined()
    })
  })

  describe('getTeam', () => {
    it('sends query with team ID', async () => {
      mock.onPost(ENDPOINT).reply({
        data: {
          team: { id: 't1', name: 'Engineering', key: 'ENG' },
        },
      })

      const result = await service.getTeam('t1')

      expect(result).toEqual({ id: 't1', name: 'Engineering', key: 'ENG' })
      expect(mock.history[0].body.variables).toEqual({ id: 't1' })
    })
  })

  // ── Projects ──

  describe('listProjects', () => {
    it('sends query with default pagination', async () => {
      mock.onPost(ENDPOINT).reply({
        data: {
          projects: {
            nodes: [{ id: 'p1', name: 'Q1 Launch' }],
            pageInfo: { hasNextPage: false },
          },
        },
      })

      const result = await service.listProjects()

      expect(result.nodes).toHaveLength(1)
      expect(mock.history[0].body.variables.first).toBe(50)
    })
  })

  describe('createProject', () => {
    it('sends mutation with required params', async () => {
      mock.onPost(ENDPOINT).reply({
        data: {
          projectCreate: {
            success: true,
            project: { id: 'p1', name: 'New Project' },
          },
        },
      })

      const result = await service.createProject('New Project', ['team-1'])

      expect(result.success).toBe(true)

      const input = mock.history[0].body.variables.input

      expect(input).toEqual({ name: 'New Project', teamIds: ['team-1'] })
    })

    it('resolves state dropdown label to lowercase', async () => {
      mock.onPost(ENDPOINT).reply({
        data: {
          projectCreate: { success: true, project: { id: 'p2' } },
        },
      })

      await service.createProject('Proj', ['team-1'], 'Some desc', 'Started')

      const input = mock.history[0].body.variables.input

      expect(input.state).toBe('started')
      expect(input.description).toBe('Some desc')
    })

    it('accepts comma-separated team IDs', async () => {
      mock.onPost(ENDPOINT).reply({
        data: {
          projectCreate: { success: true, project: { id: 'p3' } },
        },
      })

      await service.createProject('Proj', 'team-1, team-2')

      const input = mock.history[0].body.variables.input

      expect(input.teamIds).toEqual(['team-1', 'team-2'])
    })

    it('throws when no team IDs provided', async () => {
      await expect(service.createProject('Proj', '')).rejects.toThrow(
        'Create Project requires at least one team.'
      )

      expect(mock.history).toHaveLength(0)
    })
  })

  describe('updateProject', () => {
    it('sends mutation with only changed fields', async () => {
      mock.onPost(ENDPOINT).reply({
        data: {
          projectUpdate: {
            success: true,
            project: { id: 'p1', name: 'Updated' },
          },
        },
      })

      await service.updateProject('p1', 'Updated', undefined, 'Completed')

      const req = expectGraphQLRequest()

      expect(req.body.variables.id).toBe('p1')
      expect(req.body.variables.input).toEqual({ name: 'Updated', state: 'completed' })
    })
  })

  // ── Users ──

  describe('listUsers', () => {
    it('sends query with default pagination', async () => {
      mock.onPost(ENDPOINT).reply({
        data: {
          users: {
            nodes: [{ id: 'u1', name: 'Jane Doe', email: 'jane@acme.com' }],
            pageInfo: { hasNextPage: false },
          },
        },
      })

      const result = await service.listUsers()

      expect(result.nodes).toHaveLength(1)
      expect(mock.history[0].body.variables.first).toBe(50)
    })
  })

  describe('getViewer', () => {
    it('returns authenticated user', async () => {
      mock.onPost(ENDPOINT).reply({
        data: {
          viewer: {
            id: 'u1',
            name: 'Jane Doe',
            email: 'jane@acme.com',
            organization: { id: 'org1', name: 'Acme' },
          },
        },
      })

      const result = await service.getViewer()

      expect(result.id).toBe('u1')
      expect(result.organization.name).toBe('Acme')

      const req = expectGraphQLRequest()

      expect(req.body.variables).toEqual({})
    })
  })

  // ── Workflow States ──

  describe('listWorkflowStates', () => {
    it('sends query without team filter by default', async () => {
      mock.onPost(ENDPOINT).reply({
        data: {
          workflowStates: {
            nodes: [{ id: 's1', name: 'Todo', type: 'unstarted' }],
            pageInfo: { hasNextPage: false },
          },
        },
      })

      const result = await service.listWorkflowStates()

      expect(result.nodes).toHaveLength(1)

      const vars = mock.history[0].body.variables

      expect(vars.filter).toBeUndefined()
      expect(vars.first).toBe(100)
    })

    it('applies team filter when teamId is provided', async () => {
      mock.onPost(ENDPOINT).reply({
        data: {
          workflowStates: { nodes: [], pageInfo: { hasNextPage: false } },
        },
      })

      await service.listWorkflowStates('team-1')

      const vars = mock.history[0].body.variables

      expect(vars.filter).toEqual({ team: { id: { eq: 'team-1' } } })
    })
  })

  // ── Labels ──

  describe('listLabels', () => {
    it('sends query with default pagination', async () => {
      mock.onPost(ENDPOINT).reply({
        data: {
          issueLabels: {
            nodes: [{ id: 'l1', name: 'Bug', color: '#eb5757' }],
            pageInfo: { hasNextPage: false },
          },
        },
      })

      const result = await service.listLabels()

      expect(result.nodes).toHaveLength(1)
      expect(mock.history[0].body.variables.first).toBe(100)
    })
  })

  // ── Dictionaries ──

  describe('getTeamsDictionary', () => {
    it('returns formatted items without search', async () => {
      mock.onPost(ENDPOINT).reply({
        data: {
          teams: {
            nodes: [{ id: 't1', name: 'Engineering', key: 'ENG' }],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      })

      const result = await service.getTeamsDictionary({})

      expect(result.items).toEqual([
        { label: 'Engineering (ENG)', value: 't1', note: 'team' },
      ])
      expect(result.cursor).toBeUndefined()
    })

    it('applies search filter', async () => {
      mock.onPost(ENDPOINT).reply({
        data: {
          teams: {
            nodes: [],
            pageInfo: { hasNextPage: false },
          },
        },
      })

      await service.getTeamsDictionary({ search: 'eng' })

      const vars = mock.history[0].body.variables

      expect(vars.filter).toEqual({ name: { containsIgnoreCase: 'eng' } })
    })

    it('returns cursor when hasNextPage is true', async () => {
      mock.onPost(ENDPOINT).reply({
        data: {
          teams: {
            nodes: [{ id: 't1', name: 'Team', key: 'T' }],
            pageInfo: { hasNextPage: true, endCursor: 'cursor-abc' },
          },
        },
      })

      const result = await service.getTeamsDictionary({})

      expect(result.cursor).toBe('cursor-abc')
    })
  })

  describe('getProjectsDictionary', () => {
    it('returns formatted items', async () => {
      mock.onPost(ENDPOINT).reply({
        data: {
          projects: {
            nodes: [{ id: 'p1', name: 'Q1 Launch', state: 'started' }],
            pageInfo: { hasNextPage: false },
          },
        },
      })

      const result = await service.getProjectsDictionary({})

      expect(result.items).toEqual([
        { label: 'Q1 Launch', value: 'p1', note: 'started' },
      ])
    })
  })

  describe('getUsersDictionary', () => {
    it('returns formatted items', async () => {
      mock.onPost(ENDPOINT).reply({
        data: {
          users: {
            nodes: [{ id: 'u1', name: 'Jane Doe', email: 'jane@acme.com' }],
            pageInfo: { hasNextPage: false },
          },
        },
      })

      const result = await service.getUsersDictionary({})

      expect(result.items).toEqual([
        { label: 'Jane Doe', value: 'u1', note: 'jane@acme.com' },
      ])
    })
  })

  describe('getLabelsDictionary', () => {
    it('returns formatted items', async () => {
      mock.onPost(ENDPOINT).reply({
        data: {
          issueLabels: {
            nodes: [{ id: 'l1', name: 'Bug' }],
            pageInfo: { hasNextPage: false },
          },
        },
      })

      const result = await service.getLabelsDictionary({})

      expect(result.items).toEqual([
        { label: 'Bug', value: 'l1', note: 'label' },
      ])
    })
  })

  describe('getStatesDictionary', () => {
    it('returns formatted items with team criteria', async () => {
      mock.onPost(ENDPOINT).reply({
        data: {
          workflowStates: {
            nodes: [{ id: 's1', name: 'Todo', type: 'unstarted' }],
            pageInfo: { hasNextPage: false },
          },
        },
      })

      const result = await service.getStatesDictionary({
        criteria: { teamId: 'team-1' },
      })

      expect(result.items).toEqual([
        { label: 'Todo', value: 's1', note: 'unstarted' },
      ])

      const vars = mock.history[0].body.variables

      expect(vars.filter).toEqual({
        and: [{ team: { id: { eq: 'team-1' } } }],
      })
    })

    it('combines team and search filters', async () => {
      mock.onPost(ENDPOINT).reply({
        data: {
          workflowStates: {
            nodes: [],
            pageInfo: { hasNextPage: false },
          },
        },
      })

      await service.getStatesDictionary({
        search: 'todo',
        criteria: { teamId: 'team-1' },
      })

      const vars = mock.history[0].body.variables

      expect(vars.filter).toEqual({
        and: [
          { team: { id: { eq: 'team-1' } } },
          { name: { containsIgnoreCase: 'todo' } },
        ],
      })
    })

    it('sends no filter when neither team nor search is provided', async () => {
      mock.onPost(ENDPOINT).reply({
        data: {
          workflowStates: {
            nodes: [],
            pageInfo: { hasNextPage: false },
          },
        },
      })

      await service.getStatesDictionary({})

      const vars = mock.history[0].body.variables

      expect(vars.filter).toBeUndefined()
    })
  })

  // ── Triggers ──

  describe('onLinearEvent', () => {
    it('shapes event correctly (SHAPE_EVENT)', () => {
      const body = {
        action: 'create',
        type: 'Issue',
        webhookId: 'wh-1',
        data: {
          id: 'issue-1',
          teamId: 'team-1',
          title: 'New issue',
        },
        actor: { id: 'actor-1', name: 'Jane' },
        url: 'https://linear.app/acme/issue/ENG-42',
        createdAt: '2024-01-15T09:30:00.000Z',
      }

      const result = service.onLinearEvent('SHAPE_EVENT', body)

      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('onLinearEvent')
      expect(result[0].data).toMatchObject({
        eventId: 'wh-1-issue-1',
        action: 'create',
        type: 'Issue',
        resource: 'Issue',
        teamId: 'team-1',
        data: body.data,
        actor: body.actor,
        url: body.url,
        createdAt: body.createdAt,
      })
    })

    it('filters triggers correctly (FILTER_TRIGGER)', () => {
      const payload = {
        eventData: { type: 'Issue', teamId: 'team-1', action: 'create' },
        triggers: [
          { id: 'trig-1', data: { resource: 'Issues', teamId: 'team-1' } },
          { id: 'trig-2', data: { resource: 'Comments', teamId: 'team-1' } },
          { id: 'trig-3', data: { resource: 'Issues' } },
        ],
      }

      const result = service.onLinearEvent('FILTER_TRIGGER', payload)

      expect(result.ids).toEqual(['trig-1', 'trig-3'])
    })

    it('excludes triggers with mismatched teamId', () => {
      const payload = {
        eventData: { type: 'Issue', teamId: 'team-2', action: 'update' },
        triggers: [
          { id: 'trig-1', data: { resource: 'Issues', teamId: 'team-1' } },
          { id: 'trig-2', data: { resource: 'Issues', teamId: 'team-2' } },
        ],
      }

      const result = service.onLinearEvent('FILTER_TRIGGER', payload)

      expect(result.ids).toEqual(['trig-2'])
    })
  })

  // ── System trigger handlers ──

  describe('handleTriggerUpsertWebhook', () => {
    it('creates webhooks for each event and returns webhook data', async () => {
      mock.onPost(ENDPOINT).reply({
        data: {
          webhookCreate: {
            success: true,
            webhook: { id: 'wh-1', enabled: true, secret: 'sec-1' },
          },
        },
      })

      const invocation = {
        callbackUrl: 'https://example.com/callback',
        connectionId: 'conn-1',
        events: [
          { id: 'trig-1', triggerData: { resource: 'Issues', teamId: 'team-1' } },
        ],
      }

      const result = await service.handleTriggerUpsertWebhook(invocation)

      expect(result.connectionId).toBe('conn-1')
      expect(result.webhookData.webhooks).toHaveLength(1)
      expect(result.webhookData.webhooks[0]).toMatchObject({
        triggerId: 'trig-1',
        webhookId: 'wh-1',
        secret: 'sec-1',
        resourceType: 'Issue',
        teamId: 'team-1',
      })

      const input = mock.history[0].body.variables.input

      expect(input.resourceTypes).toEqual(['Issue'])
      expect(input.teamId).toBe('team-1')
      expect(input.url).toContain('connectionId=conn-1')
    })

    it('uses allPublicTeams when no teamId is specified', async () => {
      mock.onPost(ENDPOINT).reply({
        data: {
          webhookCreate: {
            success: true,
            webhook: { id: 'wh-2', enabled: true, secret: 'sec-2' },
          },
        },
      })

      const invocation = {
        callbackUrl: 'https://example.com/callback',
        connectionId: 'conn-2',
        events: [
          { id: 'trig-1', triggerData: { resource: 'Comments' } },
        ],
      }

      await service.handleTriggerUpsertWebhook(invocation)

      const input = mock.history[0].body.variables.input

      expect(input.allPublicTeams).toBe(true)
      expect(input).not.toHaveProperty('teamId')
    })
  })

  describe('handleTriggerResolveEvents', () => {
    it('returns handshake response when no body is provided', async () => {
      const result = await service.handleTriggerResolveEvents({})

      expect(result.handshake).toBe(true)
    })

    it('returns shaped events when signature verification passes (no secret)', async () => {
      const invocation = {
        body: {
          action: 'create',
          type: 'Issue',
          data: { id: 'issue-1' },
        },
        webhookData: { webhooks: [] },
        queryParams: { connectionId: 'conn-1' },
        headers: {},
      }

      const result = await service.handleTriggerResolveEvents(invocation)

      expect(result.connectionId).toBe('conn-1')
      expect(result.events).toHaveLength(1)
      expect(result.events[0].data.type).toBe('Issue')
    })

    it('rejects events when signature is invalid', async () => {
      const body = { action: 'create', type: 'Issue', data: { id: 'issue-1' } }
      const invocation = {
        body,
        rawBody: JSON.stringify(body),
        webhookData: { webhooks: [{ secret: 'my-secret' }] },
        queryParams: { connectionId: 'conn-1' },
        headers: { 'linear-signature': 'invalid-signature' },
      }

      const result = await service.handleTriggerResolveEvents(invocation)

      expect(result.events).toEqual([])
    })
  })

  describe('handleTriggerSelectMatched', () => {
    it('delegates to onLinearEvent with FILTER_TRIGGER call type', async () => {
      const invocation = {
        eventName: 'onLinearEvent',
        eventData: { type: 'Issue', teamId: 'team-1' },
        triggers: [
          { id: 'trig-1', data: { resource: 'Issues', teamId: 'team-1' } },
        ],
      }

      const result = await service.handleTriggerSelectMatched(invocation)

      expect(result.ids).toEqual(['trig-1'])
    })
  })

  describe('handleTriggerDeleteWebhook', () => {
    it('deletes stored webhooks', async () => {
      mock.onPost(ENDPOINT).reply({
        data: { webhookDelete: { success: true } },
      })

      const invocation = {
        webhookData: {
          webhooks: [
            { webhookId: 'wh-1', triggerId: 'trig-1' },
          ],
        },
      }

      const result = await service.handleTriggerDeleteWebhook(invocation)

      expect(result).toEqual({ webhookData: {} })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].body.variables).toEqual({ id: 'wh-1' })
    })

    it('skips webhooks without webhookId', async () => {
      const invocation = {
        webhookData: {
          webhooks: [{ triggerId: 'trig-1' }],
        },
      }

      const result = await service.handleTriggerDeleteWebhook(invocation)

      expect(result).toEqual({ webhookData: {} })
      expect(mock.history).toHaveLength(0)
    })

    it('handles missing webhookData gracefully', async () => {
      const result = await service.handleTriggerDeleteWebhook({})

      expect(result).toEqual({ webhookData: {} })
    })
  })
})
