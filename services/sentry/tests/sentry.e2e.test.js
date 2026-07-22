'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

const SUFFIX = Date.now()

describe('Sentry Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('sentry')
    require('../src/index.js')

    try {
      sandbox.validateConfigs()
    } catch (error) {
      console.log(error)
      process.exit(1)
    }

    service = sandbox.getService()
    testValues = sandbox.getTestValues()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Projects ──

  describe('listProjects', () => {
    it('returns the organization projects', async () => {
      const result = await service.listProjects()

      expect(Array.isArray(result)).toBe(true)

      result.forEach(project => {
        expect(project).toHaveProperty('slug')
      })
    })
  })

  describe('getProjectsDictionary', () => {
    it('returns dictionary items keyed by project slug', async () => {
      const result = await service.getProjectsDictionary({})

      expect(Array.isArray(result.items)).toBe(true)
      expect(result.cursor).toBeNull()

      result.items.forEach(item => {
        expect(item).toHaveProperty('label')
        expect(item).toHaveProperty('value')
      })
    })
  })

  describe('getProject', () => {
    it('retrieves a single project', async () => {
      const { projectSlug } = testValues

      if (!projectSlug) {
        console.log('Skipping getProject: testValues.projectSlug not set')

        return
      }

      const result = await service.getProject(projectSlug)

      expect(result).toHaveProperty('slug', projectSlug)
      expect(result).toHaveProperty('id')
    })
  })

  describe('updateProject', () => {
    it('renames a project back to its own name (no-op update)', async () => {
      const { projectSlug } = testValues

      if (!projectSlug) {
        console.log('Skipping updateProject: testValues.projectSlug not set')

        return
      }

      const current = await service.getProject(projectSlug)
      const result = await service.updateProject(projectSlug, current.name)

      expect(result).toHaveProperty('slug', projectSlug)
    })
  })

  describe('createProject', () => {
    it('creates a project under the test team when explicitly enabled', async () => {
      const { teamSlug, createProject } = testValues

      if (!teamSlug || !createProject) {
        console.log('Skipping createProject: testValues.teamSlug or testValues.createProject not set')

        return
      }

      const result = await service.createProject(teamSlug, `flowrunner-e2e-${ SUFFIX }`, 'node')

      expect(result).toHaveProperty('slug')
      expect(result).toHaveProperty('name', `flowrunner-e2e-${ SUFFIX }`)
    })
  })

  // ── Teams ──

  describe('listTeams', () => {
    it('returns the organization teams', async () => {
      const result = await service.listTeams()

      expect(Array.isArray(result)).toBe(true)
    })
  })

  describe('getTeamsDictionary', () => {
    it('returns dictionary items keyed by team slug', async () => {
      const result = await service.getTeamsDictionary({})

      expect(Array.isArray(result.items)).toBe(true)
      expect(result.cursor).toBeNull()
    })
  })

  // ── Issues & events ──

  describe('issues', () => {
    it('lists issues for the test project', async () => {
      const { projectSlug } = testValues

      if (!projectSlug) {
        console.log('Skipping listIssues: testValues.projectSlug not set')

        return
      }

      const result = await service.listIssues(projectSlug, 'is:unresolved', '14d', 'Date')

      expect(Array.isArray(result)).toBe(true)
    })

    it('retrieves an issue and its events', async () => {
      const { issueId } = testValues

      if (!issueId) {
        console.log('Skipping getIssue/listIssueEvents/getLatestEvent: testValues.issueId not set')

        return
      }

      const issue = await service.getIssue(issueId)

      expect(issue).toHaveProperty('id')

      const events = await service.listIssueEvents(issueId)

      expect(Array.isArray(events)).toBe(true)

      const latest = await service.getLatestEvent(issueId)

      expect(latest).toHaveProperty('eventID')
    })

    it('updates an issue status when explicitly enabled', async () => {
      const { issueId, mutateIssue } = testValues

      if (!issueId || !mutateIssue) {
        console.log('Skipping updateIssue: testValues.issueId or testValues.mutateIssue not set')

        return
      }

      const result = await service.updateIssue(issueId, 'Unresolved')

      expect(result).toBeDefined()
    })
  })

  describe('events', () => {
    it('lists project events', async () => {
      const { projectSlug } = testValues

      if (!projectSlug) {
        console.log('Skipping listProjectEvents: testValues.projectSlug not set')

        return
      }

      const result = await service.listProjectEvents(projectSlug)

      expect(Array.isArray(result)).toBe(true)

      if (result.length) {
        const event = await service.getEvent(projectSlug, result[0].eventID)

        expect(event).toHaveProperty('eventID', result[0].eventID)
      }
    })
  })

  // ── Releases ──

  describe('release lifecycle', () => {
    const version = `flowrunner-e2e-${ SUFFIX }`

    it('lists releases', async () => {
      const result = await service.listReleases()

      expect(Array.isArray(result)).toBe(true)
    })

    it('creates a release', async () => {
      const { projectSlug } = testValues

      if (!projectSlug) {
        console.log('Skipping createRelease: testValues.projectSlug not set')

        return
      }

      const result = await service.createRelease(version, [projectSlug], 'a1b2c3d', 'https://example.com/build')

      expect(result).toHaveProperty('version', version)
    })

    it('retrieves the release', async () => {
      const { projectSlug } = testValues

      if (!projectSlug) {
        console.log('Skipping getRelease: testValues.projectSlug not set')

        return
      }

      const result = await service.getRelease(version)

      expect(result).toHaveProperty('version', version)
    })

    it('records a deploy for the release', async () => {
      const { projectSlug } = testValues

      if (!projectSlug) {
        console.log('Skipping createDeploy: testValues.projectSlug not set')

        return
      }

      const result = await service.createDeploy(version, 'e2e', 'FlowRunner e2e deploy')

      expect(result).toHaveProperty('environment', 'e2e')
    })

    it('deletes the release', async () => {
      const { projectSlug } = testValues

      if (!projectSlug) {
        console.log('Skipping deleteRelease: testValues.projectSlug not set')

        return
      }

      const result = await service.deleteRelease(version)

      expect(result).toEqual({ success: true })
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('rejects an unknown project slug', async () => {
      await expect(service.getProject(`missing-project-${ SUFFIX }`)).rejects.toThrow(/Sentry API error/)
    })
  })
})
