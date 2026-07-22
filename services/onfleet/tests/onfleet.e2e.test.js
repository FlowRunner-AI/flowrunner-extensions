'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Onfleet Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('onfleet')
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

  // ── Organization ──

  describe('getOrganizationDetails', () => {
    it('returns organization info confirming valid API key', async () => {
      const result = await service.getOrganizationDetails()

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('name')
    })
  })

  // ── Hubs ──

  describe('listHubs', () => {
    it('returns an array of hubs', async () => {
      const result = await service.listHubs()

      expect(Array.isArray(result)).toBe(true)
    })
  })

  // ── Teams ──

  describe('listTeams', () => {
    it('returns an array of teams', async () => {
      const result = await service.listTeams()

      expect(Array.isArray(result)).toBe(true)
    })
  })

  describe('getTeam', () => {
    it('retrieves a team by ID', async () => {
      const { teamId } = testValues

      if (!teamId) {
        console.log('Skipping getTeam: testValues.teamId not set')
        return
      }

      const result = await service.getTeam(teamId)

      expect(result).toHaveProperty('id', teamId)
      expect(result).toHaveProperty('name')
    })
  })

  describe('getTeamTasks', () => {
    it('retrieves tasks for a team', async () => {
      const { teamId } = testValues

      if (!teamId) {
        console.log('Skipping getTeamTasks: testValues.teamId not set')
        return
      }

      const result = await service.getTeamTasks(teamId)

      expect(result).toHaveProperty('tasks')
      expect(Array.isArray(result.tasks)).toBe(true)
    })
  })

  // ── Workers ──

  describe('listWorkers', () => {
    it('returns an array of workers', async () => {
      const result = await service.listWorkers()

      expect(Array.isArray(result)).toBe(true)
    })
  })

  describe('getWorker', () => {
    it('retrieves a worker by ID', async () => {
      const { workerId } = testValues

      if (!workerId) {
        console.log('Skipping getWorker: testValues.workerId not set')
        return
      }

      const result = await service.getWorker(workerId)

      expect(result).toHaveProperty('id', workerId)
      expect(result).toHaveProperty('name')
    })
  })

  describe('getWorkerSchedule', () => {
    it('retrieves schedule for a worker', async () => {
      const { workerId } = testValues

      if (!workerId) {
        console.log('Skipping getWorkerSchedule: testValues.workerId not set')
        return
      }

      const result = await service.getWorkerSchedule(workerId)

      expect(result).toHaveProperty('entries')
    })
  })

  // ── Destinations ──

  describe('createDestination + getDestination', () => {
    let createdDestinationId

    it('creates a destination with address', async () => {
      const address = {
        unparsed: '543 Howard Street, San Francisco, CA 94105',
      }

      const result = await service.createDestination(address, undefined, 'E2E test destination')

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('address')
      createdDestinationId = result.id
    })

    it('retrieves the created destination', async () => {
      if (!createdDestinationId) {
        console.log('Skipping getDestination: no destination was created')
        return
      }

      const result = await service.getDestination(createdDestinationId)

      expect(result).toHaveProperty('id', createdDestinationId)
      expect(result).toHaveProperty('address')
    })
  })

  // ── Recipients ──

  describe('createRecipient + getRecipientByName + updateRecipient', () => {
    let createdRecipientId
    const recipientName = `E2E Test ${Date.now()}`
    const recipientPhone = `+1${Math.floor(2000000000 + Math.random() * 7999999999)}`

    it('creates a recipient', async () => {
      const result = await service.createRecipient(recipientName, recipientPhone, 'E2E test', true)

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('name')
      expect(result).toHaveProperty('phone')
      createdRecipientId = result.id
    })

    it('looks up the recipient by phone', async () => {
      if (!createdRecipientId) {
        console.log('Skipping getRecipientByPhone: no recipient was created')
        return
      }

      const result = await service.getRecipientByPhone(recipientPhone)

      expect(result).toHaveProperty('id', createdRecipientId)
    })

    it('updates the recipient notes', async () => {
      if (!createdRecipientId) {
        console.log('Skipping updateRecipient: no recipient was created')
        return
      }

      const result = await service.updateRecipient(createdRecipientId, undefined, undefined, 'Updated notes')

      expect(result).toHaveProperty('id', createdRecipientId)
    })
  })

  // ── Tasks ──

  describe('createTask + getTask + updateTask + deleteTask', () => {
    let createdTaskId
    let createdShortId

    it('creates a task with inline destination', async () => {
      const address = {
        unparsed: '543 Howard Street, San Francisco, CA 94105',
      }

      const result = await service.createTask(
        undefined, address, undefined, undefined,
        undefined, undefined, undefined, undefined,
        'E2E test task'
      )

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('shortId')
      createdTaskId = result.id
      createdShortId = result.shortId
    })

    it('retrieves the task by ID', async () => {
      if (!createdTaskId) {
        console.log('Skipping getTask: no task was created')
        return
      }

      const result = await service.getTask(createdTaskId)

      expect(result).toHaveProperty('id', createdTaskId)
      expect(result).toHaveProperty('state')
    })

    it('retrieves the task by short ID', async () => {
      if (!createdShortId) {
        console.log('Skipping getTaskByShortId: no task was created')
        return
      }

      const result = await service.getTaskByShortId(createdShortId)

      expect(result).toHaveProperty('shortId', createdShortId)
    })

    it('updates the task notes', async () => {
      if (!createdTaskId) {
        console.log('Skipping updateTask: no task was created')
        return
      }

      const result = await service.updateTask(createdTaskId, 'Updated E2E notes')

      expect(result).toHaveProperty('id', createdTaskId)
    })

    it('deletes the task', async () => {
      if (!createdTaskId) {
        console.log('Skipping deleteTask: no task was created')
        return
      }

      const result = await service.deleteTask(createdTaskId)

      expect(result).toEqual({ success: true, id: createdTaskId })
    })
  })

  describe('listTasks', () => {
    it('lists tasks within a time range', async () => {
      const now = Date.now()
      const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000

      const result = await service.listTasks(oneWeekAgo, now)

      expect(result).toHaveProperty('tasks')
      expect(Array.isArray(result.tasks)).toBe(true)
    })
  })

  // ── Dictionaries ──

  describe('getWorkersDictionary', () => {
    it('returns dictionary items with label and value', async () => {
      const result = await service.getWorkersDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor', null)

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
      }
    })
  })

  describe('getTeamsDictionary', () => {
    it('returns dictionary items with label and value', async () => {
      const result = await service.getTeamsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor', null)

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
      }
    })
  })
})
