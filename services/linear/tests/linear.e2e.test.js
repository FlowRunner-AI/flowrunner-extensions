'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Linear Service (e2e)', () => {
  let sandbox
  let service
  let teamId

  beforeAll(() => {
    sandbox = createE2ESandbox('linear')
    require('../src/index.js')

    try {
      sandbox.validateConfigs()
    } catch (error) {
      console.log(error)
      process.exit(1)
    }

    service = sandbox.getService()
    teamId = sandbox.getTestValues().teamId

    if (!teamId) {
      console.log('Missing testValues.teamId in e2e-config.json for linear')
      process.exit(1)
    }
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Users ──

  describe('getViewer', () => {
    it('returns the authenticated user with expected shape', async () => {
      const result = await service.getViewer()

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('name')
      expect(result).toHaveProperty('email')
      expect(result).toHaveProperty('organization')
      expect(result.organization).toHaveProperty('id')
      expect(result.organization).toHaveProperty('name')
    })
  })

  describe('listUsers', () => {
    it('returns users with pagination info', async () => {
      const result = await service.listUsers(5)

      expect(result).toHaveProperty('nodes')
      expect(Array.isArray(result.nodes)).toBe(true)
      expect(result).toHaveProperty('pageInfo')
      expect(result.pageInfo).toHaveProperty('hasNextPage')

      if (result.nodes.length > 0) {
        expect(result.nodes[0]).toHaveProperty('id')
        expect(result.nodes[0]).toHaveProperty('name')
      }
    })
  })

  // ── Teams ──

  describe('listTeams', () => {
    it('returns teams with pagination info', async () => {
      const result = await service.listTeams(5)

      expect(result).toHaveProperty('nodes')
      expect(Array.isArray(result.nodes)).toBe(true)
      expect(result).toHaveProperty('pageInfo')

      if (result.nodes.length > 0) {
        expect(result.nodes[0]).toHaveProperty('id')
        expect(result.nodes[0]).toHaveProperty('name')
        expect(result.nodes[0]).toHaveProperty('key')
      }
    })
  })

  describe('getTeam', () => {
    it('returns a single team by ID', async () => {
      const result = await service.getTeam(teamId)

      expect(result).toHaveProperty('id', teamId)
      expect(result).toHaveProperty('name')
      expect(result).toHaveProperty('key')
    })
  })

  // ── Workflow States ──

  describe('listWorkflowStates', () => {
    it('returns workflow states for the test team', async () => {
      const result = await service.listWorkflowStates(teamId, 10)

      expect(result).toHaveProperty('nodes')
      expect(Array.isArray(result.nodes)).toBe(true)
      expect(result.nodes.length).toBeGreaterThan(0)

      expect(result.nodes[0]).toHaveProperty('id')
      expect(result.nodes[0]).toHaveProperty('name')
      expect(result.nodes[0]).toHaveProperty('type')
    })
  })

  // ── Labels ──

  describe('listLabels', () => {
    it('returns labels with pagination info', async () => {
      const result = await service.listLabels(10)

      expect(result).toHaveProperty('nodes')
      expect(Array.isArray(result.nodes)).toBe(true)
      expect(result).toHaveProperty('pageInfo')
    })
  })

  // ── Projects ──

  describe('listProjects', () => {
    it('returns projects with pagination info', async () => {
      const result = await service.listProjects(5)

      expect(result).toHaveProperty('nodes')
      expect(Array.isArray(result.nodes)).toBe(true)
      expect(result).toHaveProperty('pageInfo')
    })
  })

  // ── Issue lifecycle (create, get, update, search, comment, delete) ──

  describe('issue lifecycle', () => {
    let createdIssueId

    it('creates an issue', async () => {
      const result = await service.createIssue(
        teamId,
        'E2E Test Issue - Linear Service',
        'This issue was created by an automated e2e test. It will be deleted shortly.'
      )

      expect(result).toHaveProperty('success', true)
      expect(result).toHaveProperty('issue')
      expect(result.issue).toHaveProperty('id')
      expect(result.issue).toHaveProperty('identifier')
      expect(result.issue).toHaveProperty('title', 'E2E Test Issue - Linear Service')
      expect(result.issue).toHaveProperty('url')

      createdIssueId = result.issue.id
    })

    it('retrieves the created issue', async () => {
      const result = await service.getIssue(createdIssueId)

      expect(result).toHaveProperty('id', createdIssueId)
      expect(result).toHaveProperty('title', 'E2E Test Issue - Linear Service')
      expect(result).toHaveProperty('description')
      expect(result).toHaveProperty('state')
      expect(result.state).toHaveProperty('id')
      expect(result.state).toHaveProperty('name')
    })

    it('updates the created issue title', async () => {
      const result = await service.updateIssue(createdIssueId, 'E2E Test Issue - Updated')

      expect(result).toHaveProperty('success', true)
      expect(result.issue).toHaveProperty('title', 'E2E Test Issue - Updated')
    })

    it('adds a comment to the issue', async () => {
      const result = await service.createComment(createdIssueId, 'E2E test comment body.')

      expect(result).toHaveProperty('success', true)
      expect(result).toHaveProperty('comment')
      expect(result.comment).toHaveProperty('id')
      expect(result.comment).toHaveProperty('body', 'E2E test comment body.')
    })

    it('finds the issue via search', async () => {
      const result = await service.searchIssues('E2E Test Issue - Updated', 5)

      expect(result).toHaveProperty('nodes')
      expect(Array.isArray(result.nodes)).toBe(true)
      expect(result).toHaveProperty('pageInfo')
    })

    it('lists issues filtered by team', async () => {
      const result = await service.listIssues(teamId, undefined, undefined, 5)

      expect(result).toHaveProperty('nodes')
      expect(Array.isArray(result.nodes)).toBe(true)
      expect(result).toHaveProperty('pageInfo')
    })

    it('archives (deletes) the created issue', async () => {
      const result = await service.deleteIssue(createdIssueId)

      expect(result).toHaveProperty('success', true)
      expect(result).toHaveProperty('issueId', createdIssueId)
    })
  })

  // ── Dictionaries ──

  describe('getTeamsDictionary', () => {
    it('returns formatted dictionary items', async () => {
      const result = await service.getTeamsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result.items.length).toBeGreaterThan(0)
      expect(result.items[0]).toHaveProperty('label')
      expect(result.items[0]).toHaveProperty('value')
      expect(result.items[0]).toHaveProperty('note', 'team')
    })
  })

  describe('getUsersDictionary', () => {
    it('returns formatted dictionary items', async () => {
      const result = await service.getUsersDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result.items.length).toBeGreaterThan(0)
      expect(result.items[0]).toHaveProperty('label')
      expect(result.items[0]).toHaveProperty('value')
    })
  })

  describe('getLabelsDictionary', () => {
    it('returns formatted dictionary items', async () => {
      const result = await service.getLabelsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getStatesDictionary', () => {
    it('returns formatted dictionary items for the test team', async () => {
      const result = await service.getStatesDictionary({
        criteria: { teamId },
      })

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result.items.length).toBeGreaterThan(0)
      expect(result.items[0]).toHaveProperty('label')
      expect(result.items[0]).toHaveProperty('value')
      expect(result.items[0]).toHaveProperty('note')
    })
  })

  describe('getProjectsDictionary', () => {
    it('returns formatted dictionary items', async () => {
      const result = await service.getProjectsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })
})
