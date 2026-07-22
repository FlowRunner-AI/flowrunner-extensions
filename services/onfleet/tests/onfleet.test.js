'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-onfleet-api-key'
const BASE = 'https://onfleet.com/api/v2'
const AUTH_HEADER = `Basic ${ Buffer.from(`${ API_KEY }:`).toString('base64') }`

describe('Onfleet Service', () => {
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
      expect(sandbox.getConfigItems()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'apiKey', required: true, shared: false }),
        ])
      )
    })
  })

  // ── Tasks ──

  describe('createTask', () => {
    it('sends POST with inline destination and recipient', async () => {
      mock.onPost(`${BASE}/tasks`).reply({ id: 'task1', shortId: 'abc123', state: 0 })

      const address = { number: '543', street: 'Howard St', city: 'San Francisco' }
      const result = await service.createTask(
        undefined, address, [-122.39, 37.78], 'Gate code 1234',
        undefined, 'Jane Doe', '+14155550100', 'VIP',
        'Leave at front desk', '2024-01-01T00:00:00Z', '2024-01-02T00:00:00Z',
        3, false, undefined, undefined, false
      )

      expect(result).toEqual({ id: 'task1', shortId: 'abc123', state: 0 })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({ Authorization: AUTH_HEADER })
      expect(mock.history[0].body).toMatchObject({
        destination: {
          address: { number: '543', street: 'Howard St', city: 'San Francisco' },
          location: [-122.39, 37.78],
          notes: 'Gate code 1234',
        },
        recipients: [{ name: 'Jane Doe', phone: '+14155550100', notes: 'VIP' }],
        notes: 'Leave at front desk',
        quantity: 3,
      })
    })

    it('sends POST with existing destination ID', async () => {
      mock.onPost(`${BASE}/tasks`).reply({ id: 'task2', state: 0 })

      await service.createTask('dest123')

      expect(mock.history[0].body).toMatchObject({ destination: 'dest123' })
    })

    it('sends POST with existing recipient ID', async () => {
      mock.onPost(`${BASE}/tasks`).reply({ id: 'task3', state: 0 })

      await service.createTask('dest1', undefined, undefined, undefined, 'recip1')

      expect(mock.history[0].body).toMatchObject({
        destination: 'dest1',
        recipients: ['recip1'],
      })
    })

    it('assigns task to a worker container', async () => {
      mock.onPost(`${BASE}/tasks`).reply({ id: 'task4', state: 1 })

      await service.createTask(
        'dest1', undefined, undefined, undefined,
        undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined,
        'worker1', undefined, false
      )

      expect(mock.history[0].body).toMatchObject({
        container: { type: 'WORKER', worker: 'worker1' },
      })
    })

    it('assigns task to a team container when no worker', async () => {
      mock.onPost(`${BASE}/tasks`).reply({ id: 'task5', state: 0 })

      await service.createTask(
        'dest1', undefined, undefined, undefined,
        undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined,
        undefined, 'team1', false
      )

      expect(mock.history[0].body).toMatchObject({
        container: { type: 'TEAM', team: 'team1' },
      })
    })

    it('enables auto-assign with distance mode', async () => {
      mock.onPost(`${BASE}/tasks`).reply({ id: 'task6', state: 0 })

      await service.createTask(
        'dest1', undefined, undefined, undefined,
        undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, true
      )

      expect(mock.history[0].body).toMatchObject({
        autoAssign: { mode: 'distance' },
      })
    })

    it('converts ISO date strings to epoch milliseconds', async () => {
      mock.onPost(`${BASE}/tasks`).reply({ id: 'task7', state: 0 })

      await service.createTask(
        'dest1', undefined, undefined, undefined,
        undefined, undefined, undefined, undefined,
        undefined, '2024-06-15T12:00:00Z', '2024-06-16T12:00:00Z'
      )

      expect(mock.history[0].body.completeAfter).toBe(Date.parse('2024-06-15T12:00:00Z'))
      expect(mock.history[0].body.completeBefore).toBe(Date.parse('2024-06-16T12:00:00Z'))
    })

    it('passes through numeric epoch values', async () => {
      mock.onPost(`${BASE}/tasks`).reply({ id: 'task8', state: 0 })

      await service.createTask(
        'dest1', undefined, undefined, undefined,
        undefined, undefined, undefined, undefined,
        undefined, 1700000000000, 1700100000000
      )

      expect(mock.history[0].body.completeAfter).toBe(1700000000000)
      expect(mock.history[0].body.completeBefore).toBe(1700100000000)
    })

    it('throws on API error', async () => {
      mock.onPost(`${BASE}/tasks`).replyWithError({
        message: 'Bad Request',
        body: { message: { error: 1000, message: 'Invalid destination', cause: 'Missing address' } },
        status: 400,
      })

      await expect(service.createTask()).rejects.toThrow('Onfleet API error')
    })
  })

  describe('getTask', () => {
    it('sends GET with correct URL', async () => {
      mock.onGet(`${BASE}/tasks/task123`).reply({ id: 'task123', state: 1 })

      const result = await service.getTask('task123')

      expect(result).toEqual({ id: 'task123', state: 1 })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({ Authorization: AUTH_HEADER })
    })

    it('throws on API error', async () => {
      mock.onGet(`${BASE}/tasks/bad`).replyWithError({
        message: 'Not Found',
        body: { message: { error: 1100, message: 'Task not found' } },
        status: 404,
      })

      await expect(service.getTask('bad')).rejects.toThrow('Onfleet API error')
    })
  })

  describe('getTaskByShortId', () => {
    it('sends GET with short ID in URL', async () => {
      mock.onGet(`${BASE}/tasks/shortId/abc123`).reply({ id: 'task1', shortId: 'abc123' })

      const result = await service.getTaskByShortId('abc123')

      expect(result).toEqual({ id: 'task1', shortId: 'abc123' })
    })
  })

  describe('listTasks', () => {
    it('sends GET with time range and state', async () => {
      mock.onGet(`${BASE}/tasks/all`).reply({ tasks: [{ id: 't1' }], lastId: 'cursor1' })

      const result = await service.listTasks('2024-01-01T00:00:00Z', '2024-01-31T00:00:00Z', 'Completed', 'prevCursor')

      expect(result).toEqual({ tasks: [{ id: 't1' }], lastId: 'cursor1' })
      expect(mock.history[0].query).toMatchObject({
        from: Date.parse('2024-01-01T00:00:00Z'),
        to: Date.parse('2024-01-31T00:00:00Z'),
        state: 3,
        lastId: 'prevCursor',
      })
    })

    it('resolves all state labels correctly', async () => {
      const stateMap = { Unassigned: 0, Assigned: 1, Active: 2, Completed: 3 }

      for (const [label, expected] of Object.entries(stateMap)) {
        mock.onGet(`${BASE}/tasks/all`).reply({ tasks: [] })
        await service.listTasks(1700000000000, undefined, label)
        expect(mock.history[mock.history.length - 1].query.state).toBe(expected)
      }
    })

    it('omits state when not provided', async () => {
      mock.onGet(`${BASE}/tasks/all`).reply({ tasks: [] })

      await service.listTasks(1700000000000)

      expect(mock.history[0].query.state).toBeUndefined()
    })
  })

  describe('updateTask', () => {
    it('sends PUT with updated fields', async () => {
      mock.onPut(`${BASE}/tasks/task1`).reply({ id: 'task1', notes: 'Updated' })

      const result = await service.updateTask('task1', 'Updated', undefined, undefined, 5)

      expect(result).toEqual({ id: 'task1', notes: 'Updated' })
      expect(mock.history[0].body).toEqual({ notes: 'Updated', quantity: 5 })
    })

    it('omits undefined fields from body', async () => {
      mock.onPut(`${BASE}/tasks/task1`).reply({ id: 'task1' })

      await service.updateTask('task1')

      expect(mock.history[0].body).toEqual({})
    })
  })

  describe('completeTask', () => {
    it('sends POST with completion details', async () => {
      mock.onPost(`${BASE}/tasks/task1/complete`).reply({ id: 'task1', state: 3 })

      const result = await service.completeTask('task1', true, 'Delivered to front desk')

      expect(result).toEqual({ id: 'task1', state: 3 })
      expect(mock.history[0].body).toEqual({
        completionDetails: { success: true, notes: 'Delivered to front desk' },
      })
    })

    it('sends failure completion', async () => {
      mock.onPost(`${BASE}/tasks/task1/complete`).reply({ id: 'task1', state: 3 })

      await service.completeTask('task1', false)

      expect(mock.history[0].body).toEqual({
        completionDetails: { success: false },
      })
    })
  })

  describe('deleteTask', () => {
    it('sends DELETE and returns success', async () => {
      mock.onDelete(`${BASE}/tasks/task1`).reply({})

      const result = await service.deleteTask('task1')

      expect(result).toEqual({ success: true, id: 'task1' })
      expect(mock.history).toHaveLength(1)
    })
  })

  // ── Workers ──

  describe('listWorkers', () => {
    it('sends GET without filters', async () => {
      mock.onGet(`${BASE}/workers`).reply([{ id: 'w1', name: 'Driver 1' }])

      const result = await service.listWorkers()

      expect(result).toEqual([{ id: 'w1', name: 'Driver 1' }])
      expect(mock.history[0].query).toMatchObject({})
    })

    it('sends GET with teams filter and analytics', async () => {
      mock.onGet(`${BASE}/workers`).reply([])

      await service.listWorkers('team1,team2', true)

      expect(mock.history[0].query).toMatchObject({
        teams: 'team1,team2',
        analytics: 'true',
      })
    })

    it('omits analytics when false', async () => {
      mock.onGet(`${BASE}/workers`).reply([])

      await service.listWorkers(undefined, false)

      expect(mock.history[0].query.analytics).toBeUndefined()
    })
  })

  describe('getWorker', () => {
    it('sends GET with worker ID', async () => {
      mock.onGet(`${BASE}/workers/w1`).reply({ id: 'w1', name: 'Ari' })

      const result = await service.getWorker('w1')

      expect(result).toEqual({ id: 'w1', name: 'Ari' })
    })
  })

  describe('createWorker', () => {
    it('sends POST with required fields', async () => {
      mock.onPost(`${BASE}/workers`).reply({ id: 'w1', name: 'New Driver' })

      const result = await service.createWorker('New Driver', '+14155550120', ['team1'])

      expect(result).toEqual({ id: 'w1', name: 'New Driver' })
      expect(mock.history[0].body).toEqual({
        name: 'New Driver',
        phone: '+14155550120',
        teams: ['team1'],
      })
    })

    it('sends POST with vehicle details', async () => {
      mock.onPost(`${BASE}/workers`).reply({ id: 'w2' })

      await service.createWorker('Driver', '+14155550120', ['team1'], 'Car', 'Blue Prius', '7XER187')

      expect(mock.history[0].body).toMatchObject({
        vehicle: { type: 'CAR', description: 'Blue Prius', licensePlate: '7XER187' },
      })
    })

    it('resolves all vehicle type labels', async () => {
      const types = { Car: 'CAR', Motorcycle: 'MOTORCYCLE', Bicycle: 'BICYCLE', Truck: 'TRUCK' }

      for (const [label, expected] of Object.entries(types)) {
        mock.onPost(`${BASE}/workers`).reply({ id: 'w' })
        await service.createWorker('D', '+1', ['t1'], label)
        expect(mock.history[mock.history.length - 1].body.vehicle.type).toBe(expected)
      }
    })

    it('wraps single team string into array', async () => {
      mock.onPost(`${BASE}/workers`).reply({ id: 'w3' })

      await service.createWorker('D', '+1', 'singleTeamId')

      expect(mock.history[0].body.teams).toEqual(['singleTeamId'])
    })
  })

  describe('updateWorker', () => {
    it('sends PUT with updated fields', async () => {
      mock.onPut(`${BASE}/workers/w1`).reply({ id: 'w1', name: 'Updated' })

      const result = await service.updateWorker('w1', 'Updated', ['team2'], 'Bicycle')

      expect(result).toEqual({ id: 'w1', name: 'Updated' })
      expect(mock.history[0].body).toMatchObject({
        name: 'Updated',
        teams: ['team2'],
        vehicle: { type: 'BICYCLE' },
      })
    })

    it('omits undefined fields', async () => {
      mock.onPut(`${BASE}/workers/w1`).reply({ id: 'w1' })

      await service.updateWorker('w1')

      expect(mock.history[0].body).toEqual({})
    })
  })

  describe('deleteWorker', () => {
    it('sends DELETE and returns success', async () => {
      mock.onDelete(`${BASE}/workers/w1`).reply({})

      const result = await service.deleteWorker('w1')

      expect(result).toEqual({ success: true, id: 'w1' })
    })
  })

  describe('getWorkerSchedule', () => {
    it('sends GET with worker ID', async () => {
      mock.onGet(`${BASE}/workers/w1/schedule`).reply({ entries: [] })

      const result = await service.getWorkerSchedule('w1')

      expect(result).toEqual({ entries: [] })
    })
  })

  // ── Teams ──

  describe('listTeams', () => {
    it('sends GET and returns teams', async () => {
      mock.onGet(`${BASE}/teams`).reply([{ id: 't1', name: 'Team A' }])

      const result = await service.listTeams()

      expect(result).toEqual([{ id: 't1', name: 'Team A' }])
    })
  })

  describe('getTeam', () => {
    it('sends GET with team ID', async () => {
      mock.onGet(`${BASE}/teams/t1`).reply({ id: 't1', name: 'Team A' })

      const result = await service.getTeam('t1')

      expect(result).toEqual({ id: 't1', name: 'Team A' })
    })
  })

  describe('createTeam', () => {
    it('sends POST with name and workers', async () => {
      mock.onPost(`${BASE}/teams`).reply({ id: 't1', name: 'New Team' })

      const result = await service.createTeam('New Team', ['w1', 'w2'], 'hub1')

      expect(result).toEqual({ id: 't1', name: 'New Team' })
      expect(mock.history[0].body).toEqual({
        name: 'New Team',
        workers: ['w1', 'w2'],
        hub: 'hub1',
      })
    })

    it('sends empty workers array when no workers provided', async () => {
      mock.onPost(`${BASE}/teams`).reply({ id: 't2' })

      await service.createTeam('Team B')

      expect(mock.history[0].body).toMatchObject({ name: 'Team B', workers: [] })
    })

    it('wraps single worker string into array', async () => {
      mock.onPost(`${BASE}/teams`).reply({ id: 't3' })

      await service.createTeam('Team C', 'singleWorker')

      expect(mock.history[0].body.workers).toEqual(['singleWorker'])
    })
  })

  describe('getTeamTasks', () => {
    it('sends GET with team ID and time range', async () => {
      mock.onGet(`${BASE}/teams/t1/tasks`).reply({ tasks: [{ id: 'task1' }] })

      const result = await service.getTeamTasks('t1', '2024-01-01T00:00:00Z', '2024-01-31T00:00:00Z')

      expect(result).toEqual({ tasks: [{ id: 'task1' }] })
      expect(mock.history[0].query).toMatchObject({
        from: Date.parse('2024-01-01T00:00:00Z'),
        to: Date.parse('2024-01-31T00:00:00Z'),
      })
    })

    it('omits time range when not provided', async () => {
      mock.onGet(`${BASE}/teams/t1/tasks`).reply({ tasks: [] })

      await service.getTeamTasks('t1')

      expect(mock.history[0].query.from).toBeUndefined()
      expect(mock.history[0].query.to).toBeUndefined()
    })
  })

  describe('autoDispatchTeam', () => {
    it('sends POST with empty body', async () => {
      mock.onPost(`${BASE}/teams/t1/dispatch`).reply({ dispatch: 'disp-id' })

      const result = await service.autoDispatchTeam('t1')

      expect(result).toEqual({ dispatch: 'disp-id' })
      expect(mock.history[0].body).toEqual({})
    })
  })

  // ── Destinations ──

  describe('createDestination', () => {
    it('sends POST with address and coordinates', async () => {
      mock.onPost(`${BASE}/destinations`).reply({ id: 'd1' })

      const address = { number: '100', street: 'Main St', city: 'LA' }
      const result = await service.createDestination(address, [-118.24, 34.05], 'Ring bell')

      expect(result).toEqual({ id: 'd1' })
      expect(mock.history[0].body).toMatchObject({
        address: { number: '100', street: 'Main St', city: 'LA' },
        location: [-118.24, 34.05],
        notes: 'Ring bell',
      })
    })

    it('omits location when coordinates missing', async () => {
      mock.onPost(`${BASE}/destinations`).reply({ id: 'd2' })

      await service.createDestination({ street: 'Test' })

      expect(mock.history[0].body.location).toBeUndefined()
    })
  })

  describe('getDestination', () => {
    it('sends GET with destination ID', async () => {
      mock.onGet(`${BASE}/destinations/d1`).reply({ id: 'd1', address: { street: 'Main' } })

      const result = await service.getDestination('d1')

      expect(result).toEqual({ id: 'd1', address: { street: 'Main' } })
    })
  })

  // ── Recipients ──

  describe('createRecipient', () => {
    it('sends POST with required fields', async () => {
      mock.onPost(`${BASE}/recipients`).reply({ id: 'r1', name: 'Jane', phone: '+1555' })

      const result = await service.createRecipient('Jane', '+1555', 'Notes', false)

      expect(result).toEqual({ id: 'r1', name: 'Jane', phone: '+1555' })
      expect(mock.history[0].body).toEqual({ name: 'Jane', phone: '+1555', notes: 'Notes' })
    })

    it('includes skipSMSNotifications when true', async () => {
      mock.onPost(`${BASE}/recipients`).reply({ id: 'r2' })

      await service.createRecipient('Jane', '+1555', undefined, true)

      expect(mock.history[0].body).toMatchObject({ skipSMSNotifications: true })
    })
  })

  describe('getRecipientByName', () => {
    it('sends GET with encoded name', async () => {
      mock.onGet(`${BASE}/recipients/name/Jane%20Doe`).reply({ id: 'r1', name: 'Jane Doe' })

      const result = await service.getRecipientByName('Jane Doe')

      expect(result).toEqual({ id: 'r1', name: 'Jane Doe' })
    })
  })

  describe('getRecipientByPhone', () => {
    it('sends GET with encoded phone', async () => {
      mock.onGet(`${BASE}/recipients/phone/%2B14155550100`).reply({ id: 'r1', phone: '+14155550100' })

      const result = await service.getRecipientByPhone('+14155550100')

      expect(result).toEqual({ id: 'r1', phone: '+14155550100' })
    })
  })

  describe('updateRecipient', () => {
    it('sends PUT with updated fields', async () => {
      mock.onPut(`${BASE}/recipients/r1`).reply({ id: 'r1', name: 'Updated' })

      const result = await service.updateRecipient('r1', 'Updated', '+1555', 'New notes', true)

      expect(result).toEqual({ id: 'r1', name: 'Updated' })
      expect(mock.history[0].body).toEqual({
        name: 'Updated',
        phone: '+1555',
        notes: 'New notes',
        skipSMSNotifications: true,
      })
    })

    it('includes skipSMSNotifications false when explicitly set', async () => {
      mock.onPut(`${BASE}/recipients/r1`).reply({ id: 'r1' })

      await service.updateRecipient('r1', undefined, undefined, undefined, false)

      expect(mock.history[0].body).toMatchObject({ skipSMSNotifications: false })
    })

    it('omits skipSMSNotifications when not a boolean', async () => {
      mock.onPut(`${BASE}/recipients/r1`).reply({ id: 'r1' })

      await service.updateRecipient('r1', 'Name')

      expect(mock.history[0].body.skipSMSNotifications).toBeUndefined()
    })
  })

  // ── Hubs ──

  describe('listHubs', () => {
    it('sends GET and returns hubs', async () => {
      mock.onGet(`${BASE}/hubs`).reply([{ id: 'h1', name: 'Warehouse' }])

      const result = await service.listHubs()

      expect(result).toEqual([{ id: 'h1', name: 'Warehouse' }])
    })
  })

  // ── Organization ──

  describe('getOrganizationDetails', () => {
    it('sends GET and returns organization details', async () => {
      mock.onGet(`${BASE}/organization`).reply({ id: 'org1', name: 'Acme' })

      const result = await service.getOrganizationDetails()

      expect(result).toEqual({ id: 'org1', name: 'Acme' })
    })
  })

  // ── Dictionaries ──

  describe('getWorkersDictionary', () => {
    it('returns mapped items with label and value', async () => {
      mock.onGet(`${BASE}/workers`).reply([
        { id: 'w1', name: 'Alice', phone: '+1111' },
        { id: 'w2', name: 'Bob', phone: '+2222' },
      ])

      const result = await service.getWorkersDictionary({})

      expect(result).toEqual({
        items: [
          { label: 'Alice', value: 'w1', note: '+1111' },
          { label: 'Bob', value: 'w2', note: '+2222' },
        ],
        cursor: null,
      })
    })

    it('filters by case-insensitive search', async () => {
      mock.onGet(`${BASE}/workers`).reply([
        { id: 'w1', name: 'Alice' },
        { id: 'w2', name: 'Bob' },
      ])

      const result = await service.getWorkersDictionary({ search: 'ALI' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('w1')
    })

    it('handles null payload', async () => {
      mock.onGet(`${BASE}/workers`).reply([{ id: 'w1', name: 'A' }])

      const result = await service.getWorkersDictionary(null)

      expect(result.items).toHaveLength(1)
      expect(result.cursor).toBeNull()
    })

    it('handles non-array response', async () => {
      mock.onGet(`${BASE}/workers`).reply({ unexpected: true })

      const result = await service.getWorkersDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('uses id as label fallback when name is missing', async () => {
      mock.onGet(`${BASE}/workers`).reply([{ id: 'w1' }])

      const result = await service.getWorkersDictionary({})

      expect(result.items[0].label).toBe('w1')
    })
  })

  describe('getTeamsDictionary', () => {
    it('returns mapped items with worker count note', async () => {
      mock.onGet(`${BASE}/teams`).reply([
        { id: 't1', name: 'Team A', workers: ['w1', 'w2', 'w3'] },
      ])

      const result = await service.getTeamsDictionary({})

      expect(result).toEqual({
        items: [{ label: 'Team A', value: 't1', note: '3 workers' }],
        cursor: null,
      })
    })

    it('filters by case-insensitive search', async () => {
      mock.onGet(`${BASE}/teams`).reply([
        { id: 't1', name: 'Downtown' },
        { id: 't2', name: 'Uptown' },
      ])

      const result = await service.getTeamsDictionary({ search: 'down' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('t1')
    })

    it('handles null payload', async () => {
      mock.onGet(`${BASE}/teams`).reply([{ id: 't1', name: 'T' }])

      const result = await service.getTeamsDictionary(null)

      expect(result.items).toHaveLength(1)
      expect(result.cursor).toBeNull()
    })

    it('handles non-array response', async () => {
      mock.onGet(`${BASE}/teams`).reply({ unexpected: true })

      const result = await service.getTeamsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('formats Onfleet structured error messages', async () => {
      mock.onGet(`${BASE}/organization`).replyWithError({
        message: 'Server error',
        body: { message: { error: 2300, message: 'Auth failed', cause: 'Invalid key' } },
        status: 401,
      })

      await expect(service.getOrganizationDetails()).rejects.toThrow(
        'Onfleet API error: Auth failed - Invalid key (status 401)'
      )
    })

    it('uses string message from error body', async () => {
      mock.onGet(`${BASE}/organization`).replyWithError({
        message: 'fail',
        body: { message: 'Simple error string' },
      })

      await expect(service.getOrganizationDetails()).rejects.toThrow(
        'Onfleet API error: Simple error string'
      )
    })

    it('falls back to error.message when body is empty', async () => {
      mock.onGet(`${BASE}/organization`).replyWithError({
        message: 'Network timeout',
      })

      await expect(service.getOrganizationDetails()).rejects.toThrow(
        'Onfleet API error: Network timeout'
      )
    })
  })
})
