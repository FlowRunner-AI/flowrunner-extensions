'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Toggl Track Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('toggl')
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

  // ── Workspace & User ──

  describe('getMe', () => {
    it('returns the authenticated user profile', async () => {
      const result = await service.getMe()

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('email')
      expect(result).toHaveProperty('default_workspace_id')
    })

    it('includes related data when requested', async () => {
      const result = await service.getMe(true)

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('workspaces')
    })
  })

  describe('getWorkspace', () => {
    it('returns workspace details', async () => {
      const { workspaceId } = testValues

      if (!workspaceId) {
        console.log('Skipping getWorkspace: testValues.workspaceId not set')
        return
      }

      const result = await service.getWorkspace(workspaceId)

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('name')
    })
  })

  describe('listWorkspaceUsers', () => {
    it('returns workspace members', async () => {
      const { workspaceId } = testValues

      if (!workspaceId) {
        console.log('Skipping listWorkspaceUsers: testValues.workspaceId not set')
        return
      }

      const result = await service.listWorkspaceUsers(workspaceId)

      expect(Array.isArray(result)).toBe(true)
    })
  })

  // ── Dictionaries ──

  describe('getWorkspacesDictionary', () => {
    it('returns workspaces as dictionary items', async () => {
      const result = await service.getWorkspacesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result.cursor).toBeNull()

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
      }
    })
  })

  // ── Time Entries lifecycle ──

  describe('time entries lifecycle', () => {
    let createdEntryId

    it('lists time entries', async () => {
      const result = await service.listTimeEntries()

      expect(Array.isArray(result)).toBe(true)
    })

    it('creates a time entry', async () => {
      const { workspaceId } = testValues

      if (!workspaceId) {
        console.log('Skipping createTimeEntry: testValues.workspaceId not set')
        return
      }

      const start = new Date(Date.now() - 3600 * 1000).toISOString()
      const result = await service.createTimeEntry(workspaceId, 'E2E Test Entry', start, 3600)

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('description', 'E2E Test Entry')
      createdEntryId = result.id
    })

    it('retrieves the created time entry', async () => {
      if (!createdEntryId) {
        console.log('Skipping getTimeEntry: no entry was created')
        return
      }

      const result = await service.getTimeEntry(createdEntryId)

      expect(result).toHaveProperty('id', createdEntryId)
      expect(result).toHaveProperty('description', 'E2E Test Entry')
    })

    it('updates the created time entry', async () => {
      const { workspaceId } = testValues

      if (!createdEntryId || !workspaceId) {
        console.log('Skipping updateTimeEntry: no entry was created or workspaceId not set')
        return
      }

      const result = await service.updateTimeEntry(workspaceId, createdEntryId, 'E2E Updated Entry')

      expect(result).toHaveProperty('id', createdEntryId)
      expect(result).toHaveProperty('description', 'E2E Updated Entry')
    })

    it('deletes the created time entry', async () => {
      const { workspaceId } = testValues

      if (!createdEntryId || !workspaceId) {
        console.log('Skipping deleteTimeEntry: no entry was created or workspaceId not set')
        return
      }

      const result = await service.deleteTimeEntry(workspaceId, createdEntryId)

      expect(result).toEqual({ success: true, timeEntryId: createdEntryId })
    })
  })

  // ── Start / Stop Timer ──

  describe('start and stop timer', () => {
    let runningEntryId

    it('starts a timer', async () => {
      const { workspaceId } = testValues

      if (!workspaceId) {
        console.log('Skipping startTimer: testValues.workspaceId not set')
        return
      }

      const result = await service.startTimer(workspaceId, 'E2E Timer Test')

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('duration', -1)
      runningEntryId = result.id
    })

    it('gets the current running entry', async () => {
      if (!runningEntryId) {
        console.log('Skipping getCurrentRunningEntry: no timer started')
        return
      }

      const result = await service.getCurrentRunningEntry()

      expect(result).toHaveProperty('id', runningEntryId)
    })

    it('stops the timer', async () => {
      const { workspaceId } = testValues

      if (!runningEntryId || !workspaceId) {
        console.log('Skipping stopTimer: no timer started or workspaceId not set')
        return
      }

      const result = await service.stopTimer(workspaceId, runningEntryId)

      expect(result).toHaveProperty('id', runningEntryId)
      expect(result.duration).toBeGreaterThanOrEqual(0)
    })

    afterAll(async () => {
      // Clean up the timer entry
      const { workspaceId } = testValues || {}

      if (runningEntryId && workspaceId) {
        try {
          await service.deleteTimeEntry(workspaceId, runningEntryId)
        } catch (e) {
          // ignore cleanup errors
        }
      }
    })
  })

  // ── Clients lifecycle ──

  describe('clients lifecycle', () => {
    let createdClientId

    it('lists clients', async () => {
      const { workspaceId } = testValues

      if (!workspaceId) {
        console.log('Skipping listClients: testValues.workspaceId not set')
        return
      }

      const result = await service.listClients(workspaceId)

      expect(Array.isArray(result)).toBe(true)
    })

    it('creates a client', async () => {
      const { workspaceId } = testValues

      if (!workspaceId) {
        console.log('Skipping createClient: testValues.workspaceId not set')
        return
      }

      const result = await service.createClient(workspaceId, 'E2E Test Client')

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('name', 'E2E Test Client')
      createdClientId = result.id
    })

    it('updates the client', async () => {
      const { workspaceId } = testValues

      if (!createdClientId || !workspaceId) {
        console.log('Skipping updateClient: no client created or workspaceId not set')
        return
      }

      const result = await service.updateClient(workspaceId, createdClientId, 'E2E Renamed Client')

      expect(result).toHaveProperty('name', 'E2E Renamed Client')
    })

    it('deletes the client', async () => {
      const { workspaceId } = testValues

      if (!createdClientId || !workspaceId) {
        console.log('Skipping deleteClient: no client created or workspaceId not set')
        return
      }

      const result = await service.deleteClient(workspaceId, createdClientId)

      expect(result).toEqual({ success: true, clientId: createdClientId })
    })
  })

  // ── Tags lifecycle ──

  describe('tags lifecycle', () => {
    let createdTagId

    it('lists tags', async () => {
      const { workspaceId } = testValues

      if (!workspaceId) {
        console.log('Skipping listTags: testValues.workspaceId not set')
        return
      }

      const result = await service.listTags(workspaceId)

      expect(Array.isArray(result)).toBe(true)
    })

    it('creates a tag', async () => {
      const { workspaceId } = testValues

      if (!workspaceId) {
        console.log('Skipping createTag: testValues.workspaceId not set')
        return
      }

      const result = await service.createTag(workspaceId, 'e2e-test-tag')

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('name', 'e2e-test-tag')
      createdTagId = result.id
    })

    it('updates the tag', async () => {
      const { workspaceId } = testValues

      if (!createdTagId || !workspaceId) {
        console.log('Skipping updateTag: no tag created or workspaceId not set')
        return
      }

      const result = await service.updateTag(workspaceId, createdTagId, 'e2e-renamed-tag')

      expect(result).toHaveProperty('name', 'e2e-renamed-tag')
    })

    it('deletes the tag', async () => {
      const { workspaceId } = testValues

      if (!createdTagId || !workspaceId) {
        console.log('Skipping deleteTag: no tag created or workspaceId not set')
        return
      }

      const result = await service.deleteTag(workspaceId, createdTagId)

      expect(result).toEqual({ success: true, tagId: createdTagId })
    })
  })

  // ── Projects lifecycle ──

  describe('projects lifecycle', () => {
    let createdProjectId

    it('lists projects', async () => {
      const { workspaceId } = testValues

      if (!workspaceId) {
        console.log('Skipping listProjects: testValues.workspaceId not set')
        return
      }

      const result = await service.listProjects(workspaceId)

      expect(Array.isArray(result)).toBe(true)
    })

    it('creates a project', async () => {
      const { workspaceId } = testValues

      if (!workspaceId) {
        console.log('Skipping createProject: testValues.workspaceId not set')
        return
      }

      const result = await service.createProject(workspaceId, 'E2E Test Project')

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('name', 'E2E Test Project')
      createdProjectId = result.id
    })

    it('gets the project', async () => {
      const { workspaceId } = testValues

      if (!createdProjectId || !workspaceId) {
        console.log('Skipping getProject: no project created or workspaceId not set')
        return
      }

      const result = await service.getProject(workspaceId, createdProjectId)

      expect(result).toHaveProperty('id', createdProjectId)
      expect(result).toHaveProperty('name', 'E2E Test Project')
    })

    it('updates the project', async () => {
      const { workspaceId } = testValues

      if (!createdProjectId || !workspaceId) {
        console.log('Skipping updateProject: no project created or workspaceId not set')
        return
      }

      const result = await service.updateProject(workspaceId, createdProjectId, 'E2E Renamed Project')

      expect(result).toHaveProperty('name', 'E2E Renamed Project')
    })

    it('deletes the project', async () => {
      const { workspaceId } = testValues

      if (!createdProjectId || !workspaceId) {
        console.log('Skipping deleteProject: no project created or workspaceId not set')
        return
      }

      const result = await service.deleteProject(workspaceId, createdProjectId)

      expect(result).toEqual({ success: true, projectId: createdProjectId })
    })
  })

  // ── Projects Dictionary ──

  describe('getProjectsDictionary', () => {
    it('returns projects as dictionary items', async () => {
      const { workspaceId } = testValues

      if (!workspaceId) {
        console.log('Skipping getProjectsDictionary: testValues.workspaceId not set')
        return
      }

      const result = await service.getProjectsDictionary({ criteria: { workspaceId } })

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result.cursor).toBeNull()
    })
  })

  // ── Clients Dictionary ──

  describe('getClientsDictionary', () => {
    it('returns clients as dictionary items', async () => {
      const { workspaceId } = testValues

      if (!workspaceId) {
        console.log('Skipping getClientsDictionary: testValues.workspaceId not set')
        return
      }

      const result = await service.getClientsDictionary({ criteria: { workspaceId } })

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result.cursor).toBeNull()
    })
  })

  // ── Tags Dictionary ──

  describe('getTagsDictionary', () => {
    it('returns tags as dictionary items', async () => {
      const { workspaceId } = testValues

      if (!workspaceId) {
        console.log('Skipping getTagsDictionary: testValues.workspaceId not set')
        return
      }

      const result = await service.getTagsDictionary({ criteria: { workspaceId } })

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result.cursor).toBeNull()
    })
  })
})
