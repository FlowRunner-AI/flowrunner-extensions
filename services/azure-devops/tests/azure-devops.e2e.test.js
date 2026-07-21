'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Azure DevOps Service (e2e)', () => {
  let sandbox
  let service
  let projectName

  beforeAll(() => {
    sandbox = createE2ESandbox('azure-devops')
    require('../src/index.js')

    try {
      sandbox.validateConfigs()
    } catch (error) {
      console.log(error)
      process.exit(1)
    }

    service = sandbox.getService()
    projectName = sandbox.getTestValues().projectName

    if (!projectName) {
      console.log('Missing testValues.projectName in e2e-config.json for azure-devops')
      process.exit(1)
    }
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Projects ──

  describe('listProjects', () => {
    it('returns projects with expected shape', async () => {
      const result = await service.listProjects()

      expect(result).toHaveProperty('items')
      expect(result).toHaveProperty('count')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result.items.length).toBeGreaterThan(0)
      expect(result.items[0]).toHaveProperty('id')
      expect(result.items[0]).toHaveProperty('name')
    })

    it('supports top parameter', async () => {
      const result = await service.listProjects(undefined, 1)

      expect(result.items.length).toBeLessThanOrEqual(1)
    })
  })

  describe('getProject', () => {
    it('returns the test project', async () => {
      const result = await service.getProject(projectName)

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('name', projectName)
      expect(result).toHaveProperty('state')
    })

    it('includes capabilities when requested', async () => {
      const result = await service.getProject(projectName, true)

      expect(result).toHaveProperty('capabilities')
    })
  })

  // ── Teams ──

  describe('listTeams', () => {
    it('returns teams for the test project', async () => {
      const result = await service.listTeams(projectName)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result.items.length).toBeGreaterThan(0)
      expect(result.items[0]).toHaveProperty('id')
      expect(result.items[0]).toHaveProperty('name')
    })
  })

  // ── Work Items (create, get, update, comment, delete) ──

  describe('work item lifecycle', () => {
    let createdWorkItemId

    it('creates a work item', async () => {
      const result = await service.createWorkItem(
        projectName, 'Task', 'E2E Test Task - auto-created', 'Created by e2e test'
      )

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('rev', 1)
      expect(result).toHaveProperty('fields')
      createdWorkItemId = result.id
    })

    it('gets the created work item', async () => {
      const result = await service.getWorkItem(projectName, createdWorkItemId)

      expect(result).toHaveProperty('id', createdWorkItemId)
      expect(result.fields).toHaveProperty('System.Title', 'E2E Test Task - auto-created')
    })

    it('gets work items in batch', async () => {
      const result = await service.getWorkItemsBatch([createdWorkItemId])

      expect(result).toHaveProperty('items')
      expect(result.items.length).toBe(1)
      expect(result.items[0]).toHaveProperty('id', createdWorkItemId)
    })

    it('updates the work item', async () => {
      const result = await service.updateWorkItem(createdWorkItemId, 'E2E Test Task - updated')

      expect(result).toHaveProperty('id', createdWorkItemId)
      expect(result).toHaveProperty('rev', 2)
    })

    it('adds a comment to the work item', async () => {
      const result = await service.addWorkItemComment(
        projectName, createdWorkItemId, 'E2E test comment'
      )

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('text')
    })

    it('lists comments on the work item', async () => {
      const result = await service.listWorkItemComments(projectName, createdWorkItemId)

      expect(result).toHaveProperty('totalCount')
      expect(result.totalCount).toBeGreaterThanOrEqual(1)
    })

    it('deletes the work item', async () => {
      const result = await service.deleteWorkItem(createdWorkItemId)

      expect(result).toHaveProperty('id', createdWorkItemId)
    })
  })

  // ── WIQL ──

  describe('runWiqlQuery', () => {
    it('executes a WIQL query and returns results', async () => {
      const result = await service.runWiqlQuery(
        projectName,
        "SELECT [System.Id] FROM WorkItems WHERE [System.WorkItemType] = 'Task' ORDER BY [System.ChangedDate] DESC",
        5
      )

      expect(result).toHaveProperty('queryType')
      expect(result).toHaveProperty('workItems')
      expect(Array.isArray(result.workItems)).toBe(true)
    })
  })

  // ── Repositories ──

  describe('listRepositories', () => {
    it('returns repositories for the test project', async () => {
      const result = await service.listRepositories(projectName)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result.items.length).toBeGreaterThan(0)
      expect(result.items[0]).toHaveProperty('id')
      expect(result.items[0]).toHaveProperty('name')
    })
  })

  describe('getRepository', () => {
    it('returns a repository by name', async () => {
      const repos = await service.listRepositories(projectName)
      const repoId = repos.items[0].id

      const result = await service.getRepository(projectName, repoId)

      expect(result).toHaveProperty('id', repoId)
      expect(result).toHaveProperty('name')
      expect(result).toHaveProperty('defaultBranch')
    })
  })

  describe('listBranches', () => {
    it('returns branches for a repository', async () => {
      const repos = await service.listRepositories(projectName)
      const repoId = repos.items[0].id

      const result = await service.listBranches(projectName, repoId)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('listCommits', () => {
    it('returns commits for a repository', async () => {
      const repos = await service.listRepositories(projectName)
      const repoId = repos.items[0].id

      const result = await service.listCommits(projectName, repoId, undefined, undefined, 5)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Pipelines ──

  describe('listPipelines', () => {
    it('returns pipelines for the test project', async () => {
      const result = await service.listPipelines(projectName)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('continuationToken')
    })
  })

  // ── Builds ──

  describe('listBuilds', () => {
    it('returns builds for the test project', async () => {
      const result = await service.listBuilds(projectName)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('continuationToken')
    })
  })

  // ── Iterations ──

  describe('listTeamIterations', () => {
    it('returns iterations for the default team', async () => {
      const teams = await service.listTeams(projectName)
      const teamName = teams.items[0].name

      const result = await service.listTeamIterations(projectName, teamName)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Dictionaries ──

  describe('projectsDictionary', () => {
    it('returns formatted project options', async () => {
      const result = await service.projectsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result.items.length).toBeGreaterThan(0)
      expect(result.items[0]).toHaveProperty('label')
      expect(result.items[0]).toHaveProperty('value')
    })
  })

  describe('repositoriesDictionary', () => {
    it('returns formatted repository options', async () => {
      const result = await service.repositoriesDictionary({
        criteria: { project: projectName },
      })

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result.items[0]).toHaveProperty('label')
      expect(result.items[0]).toHaveProperty('value')
    })

    it('returns empty when no project is given', async () => {
      const result = await service.repositoriesDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('teamsDictionary', () => {
    it('returns formatted team options', async () => {
      const result = await service.teamsDictionary({
        criteria: { project: projectName },
      })

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result.items[0]).toHaveProperty('label')
      expect(result.items[0]).toHaveProperty('value')
    })
  })
})
