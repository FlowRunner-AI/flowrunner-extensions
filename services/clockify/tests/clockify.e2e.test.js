'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Clockify Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('clockify')
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

  // A unique-ish suffix so repeated e2e runs don't collide on names.
  const suffix = Date.now()

  // The workspace all operations run against. Supplied by the developer, but we
  // fall back to the account's default workspace when it isn't set.
  let workspaceId

  beforeAll(async () => {
    workspaceId = testValues.workspaceId
    if (!workspaceId) {
      const user = await service.getCurrentUser()
      workspaceId = user.defaultWorkspace || user.activeWorkspace
    }
  })

  // ── Users ──

  describe('getCurrentUser', () => {
    it('returns the authenticated user with a workspace', async () => {
      const user = await service.getCurrentUser()

      expect(user).toHaveProperty('id')
      expect(user).toHaveProperty('email')
      expect(user).toHaveProperty('defaultWorkspace')
    })
  })

  describe('listWorkspaceUsers', () => {
    it('returns workspace members as an array', async () => {
      const result = await service.listWorkspaceUsers(workspaceId, undefined, undefined, 1, 10)

      expect(Array.isArray(result)).toBe(true)
    })
  })

  // ── Dictionaries ──

  describe('getWorkspacesDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getWorkspacesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getProjectsDictionary', () => {
    it('returns dictionary items array for the workspace', async () => {
      const result = await service.getProjectsDictionary({ criteria: { workspaceId } })

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getClientsDictionary', () => {
    it('returns dictionary items array for the workspace', async () => {
      const result = await service.getClientsDictionary({ criteria: { workspaceId } })

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getTagsDictionary', () => {
    it('returns dictionary items array for the workspace', async () => {
      const result = await service.getTagsDictionary({ criteria: { workspaceId } })

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Clients ──

  describe('createClient + updateClient + deleteClient', () => {
    let clientId

    it('creates a client', async () => {
      const result = await service.createClient(workspaceId, `E2E Client ${ suffix }`, 'Created by e2e test')

      expect(result).toHaveProperty('id')
      clientId = result.id
    })

    it('lists clients including the created one', async () => {
      const result = await service.listClients(workspaceId, undefined, 1, 50)

      expect(Array.isArray(result)).toBe(true)
    })

    it('updates the client', async () => {
      const result = await service.updateClient(workspaceId, clientId, `E2E Client Updated ${ suffix }`)

      expect(result).toHaveProperty('id', clientId)
    })

    it('archives then deletes the client', async () => {
      // Clockify requires a client to be archived before deletion.
      await service.updateClient(workspaceId, clientId, `E2E Client Updated ${ suffix }`, undefined, true)

      const result = await service.deleteClient(workspaceId, clientId)

      expect(result).toEqual({ success: true, id: clientId })
    })
  })

  // ── Tags ──

  describe('createTag + listTags', () => {
    it('creates a tag and finds it in the list', async () => {
      const created = await service.createTag(workspaceId, `E2E Tag ${ suffix }`)

      expect(created).toHaveProperty('id')

      const list = await service.listTags(workspaceId, undefined, 1, 50)

      expect(Array.isArray(list)).toBe(true)
    })
  })

  // ── Projects + Tasks ──

  describe('createProject + tasks + deleteProject', () => {
    let projectId
    let taskId

    it('creates a project', async () => {
      const result = await service.createProject(
        workspaceId,
        `E2E Project ${ suffix }`,
        undefined,
        'Blue',
        true,
        false,
        'Created by e2e test'
      )

      expect(result).toHaveProperty('id')
      projectId = result.id
    })

    it('retrieves the created project', async () => {
      const result = await service.getProject(workspaceId, projectId)

      expect(result).toHaveProperty('id', projectId)
    })

    it('lists projects', async () => {
      const result = await service.listProjects(workspaceId, undefined, undefined, 1, 50)

      expect(Array.isArray(result)).toBe(true)
    })

    it('updates the project', async () => {
      const result = await service.updateProject(
        workspaceId,
        projectId,
        `E2E Project Updated ${ suffix }`,
        undefined,
        'Orange'
      )

      expect(result).toHaveProperty('id', projectId)
    })

    it('creates a task in the project', async () => {
      const result = await service.createTask(workspaceId, projectId, `E2E Task ${ suffix }`, undefined, 'PT2H')

      expect(result).toHaveProperty('id')
      taskId = result.id
    })

    it('lists tasks in the project', async () => {
      const result = await service.listTasks(workspaceId, projectId, 1, 50)

      expect(Array.isArray(result)).toBe(true)
    })

    it('updates the task to Done', async () => {
      const result = await service.updateTask(
        workspaceId,
        projectId,
        taskId,
        `E2E Task Updated ${ suffix }`,
        undefined,
        undefined,
        'Done'
      )

      expect(result).toHaveProperty('id', taskId)
    })

    it('deletes the task', async () => {
      const result = await service.deleteTask(workspaceId, projectId, taskId)

      expect(result).toEqual({ success: true, id: taskId })
    })

    it('archives then deletes the project', async () => {
      // A project must be archived before Clockify allows deletion.
      await service.updateProject(
        workspaceId,
        projectId,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        true
      )

      const result = await service.deleteProject(workspaceId, projectId)

      expect(result).toEqual({ success: true, id: projectId })
    })
  })

  // ── Time Entries ──

  describe('addTimeEntry + getTimeEntry + updateTimeEntry + listTimeEntries + deleteTimeEntry', () => {
    let timeEntryId

    it('adds a completed time entry', async () => {
      const start = new Date(Date.now() - 3600 * 1000).toISOString()
      const end = new Date().toISOString()

      const result = await service.addTimeEntry(workspaceId, start, end, `E2E entry ${ suffix }`)

      expect(result).toHaveProperty('id')
      timeEntryId = result.id
    })

    it('retrieves the created time entry', async () => {
      const result = await service.getTimeEntry(workspaceId, timeEntryId)

      expect(result).toHaveProperty('id', timeEntryId)
      expect(result).toHaveProperty('timeInterval')
    })

    it('lists time entries as an array', async () => {
      const result = await service.listTimeEntries(workspaceId, undefined, undefined, undefined, false, 1, 50)

      expect(Array.isArray(result)).toBe(true)
    })

    it('updates the time entry description', async () => {
      const start = new Date(Date.now() - 3600 * 1000).toISOString()
      const end = new Date().toISOString()

      const result = await service.updateTimeEntry(
        workspaceId,
        timeEntryId,
        start,
        end,
        `E2E entry updated ${ suffix }`
      )

      expect(result).toHaveProperty('id', timeEntryId)
    })

    it('deletes the time entry', async () => {
      const result = await service.deleteTimeEntry(workspaceId, timeEntryId)

      expect(result).toEqual({ success: true, id: timeEntryId })
    })
  })

  describe('startTimer + stopTimer', () => {
    it('starts a running timer and stops it', async () => {
      const started = await service.startTimer(workspaceId, `E2E timer ${ suffix }`)

      expect(started).toHaveProperty('id')

      const stopped = await service.stopTimer(workspaceId)

      expect(stopped).toHaveProperty('id')
      expect(stopped).toHaveProperty('timeInterval')

      // Clean up the entry created by the timer.
      try {
        await service.deleteTimeEntry(workspaceId, stopped.id)
      } catch (e) {
        // ignore cleanup errors
      }
    })
  })

  // ── Reports ──

  describe('generateSummaryReport', () => {
    it('returns a summary report grouped by project', async () => {
      const now = new Date()
      const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
      const end = now.toISOString()

      const result = await service.generateSummaryReport(workspaceId, start, end, ['Project'])

      expect(result).toHaveProperty('totals')
    })
  })
})
