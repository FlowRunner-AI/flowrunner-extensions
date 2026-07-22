'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('TheHive Service (e2e)', () => {
  let sandbox
  let service

  beforeAll(() => {
    sandbox = createE2ESandbox('thehive')
    require('../src/index.js')

    try {
      sandbox.validateConfigs()
    } catch (error) {
      console.log(error)
      process.exit(1)
    }

    service = sandbox.getService()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Cases lifecycle ──

  describe('cases lifecycle', () => {
    let caseId

    it('creates a case', async () => {
      const result = await service.createCase(
        'E2E Test Case',
        'Created by e2e test suite',
        'Low',
        'GREEN',
        'GREEN',
        ['e2e-test'],
        undefined,
        false
      )

      expect(result).toHaveProperty('_id')
      expect(result).toHaveProperty('title', 'E2E Test Case')
      caseId = result._id
    })

    it('retrieves the created case', async () => {
      const result = await service.getCase(caseId)

      expect(result).toHaveProperty('_id', caseId)
      expect(result).toHaveProperty('title', 'E2E Test Case')
      expect(result).toHaveProperty('_type', 'Case')
    })

    it('updates the case', async () => {
      const result = await service.updateCase(caseId, 'E2E Updated Case')

      expect(result).toBeDefined()
    })

    it('lists cases', async () => {
      const result = await service.listCases(undefined, 0, 5)

      expect(Array.isArray(result)).toBe(true)
    })

    it('lists cases with keyword filter', async () => {
      const result = await service.listCases('E2E', 0, 10)

      expect(Array.isArray(result)).toBe(true)
    })

    // ── Tasks within the case ──

    describe('tasks lifecycle', () => {
      let taskId

      it('creates a task in the case', async () => {
        const result = await service.createTask(caseId, 'E2E Test Task', 'testing', 'Waiting', 'A test task')

        expect(result).toHaveProperty('_id')
        expect(result).toHaveProperty('title', 'E2E Test Task')
        taskId = result._id
      })

      it('retrieves the created task', async () => {
        const result = await service.getTask(taskId)

        expect(result).toHaveProperty('_id', taskId)
        expect(result).toHaveProperty('title', 'E2E Test Task')
      })

      it('updates the task', async () => {
        const result = await service.updateTask(taskId, undefined, undefined, 'InProgress')

        expect(result).toBeDefined()
      })

      it('lists tasks for the case', async () => {
        const result = await service.listCaseTasks(caseId, 0, 50)

        expect(Array.isArray(result)).toBe(true)
        expect(result.length).toBeGreaterThanOrEqual(1)
      })
    })

    // ── Observables within the case ──

    describe('observables lifecycle', () => {
      let observableId

      it('creates an observable in the case', async () => {
        const result = await service.createObservable(
          caseId,
          'ip',
          '192.0.2.1',
          'E2E test observable',
          ['e2e-test'],
          true,
          false,
          'GREEN'
        )

        expect(Array.isArray(result)).toBe(true)
        expect(result.length).toBeGreaterThanOrEqual(1)
        expect(result[0]).toHaveProperty('_id')
        observableId = result[0]._id
      })

      it('retrieves the created observable', async () => {
        const result = await service.getObservable(observableId)

        expect(result).toHaveProperty('_id', observableId)
        expect(result).toHaveProperty('dataType', 'ip')
        expect(result).toHaveProperty('data', '192.0.2.1')
      })

      it('lists observables for the case', async () => {
        const result = await service.listCaseObservables(caseId, 0, 50)

        expect(Array.isArray(result)).toBe(true)
        expect(result.length).toBeGreaterThanOrEqual(1)
      })
    })

    // Delete the case after all sub-tests are done
    it('deletes the created case', async () => {
      const result = await service.deleteCase(caseId)

      expect(result).toBeDefined()
    })
  })

  // ── Alerts lifecycle ──

  describe('alerts lifecycle', () => {
    let alertId

    it('creates an alert', async () => {
      const sourceRef = `E2E-${Date.now()}`

      const result = await service.createAlert(
        'e2e-test',
        'E2E Suite',
        sourceRef,
        'E2E Test Alert',
        'Created by e2e test suite',
        'Low',
        'GREEN',
        ['e2e-test']
      )

      expect(result).toHaveProperty('_id')
      expect(result).toHaveProperty('title', 'E2E Test Alert')
      alertId = result._id
    })

    it('retrieves the created alert', async () => {
      const result = await service.getAlert(alertId)

      expect(result).toHaveProperty('_id', alertId)
      expect(result).toHaveProperty('title', 'E2E Test Alert')
      expect(result).toHaveProperty('_type', 'Alert')
    })

    it('updates the alert', async () => {
      const result = await service.updateAlert(alertId, 'E2E Updated Alert')

      expect(result).toBeDefined()
    })

    it('lists alerts', async () => {
      const result = await service.listAlerts(undefined, 0, 5)

      expect(Array.isArray(result)).toBe(true)
    })

    it('lists alerts with keyword filter', async () => {
      const result = await service.listAlerts('E2E', 0, 10)

      expect(Array.isArray(result)).toBe(true)
    })

    it('promotes the alert to a case and deletes the case', async () => {
      const caseResult = await service.promoteAlertToCase(alertId)

      expect(caseResult).toHaveProperty('_id')
      expect(caseResult).toHaveProperty('_type', 'Case')

      // Clean up: delete the promoted case
      await service.deleteCase(caseResult._id)
    })
  })

  // ── Query ──

  describe('runQuery', () => {
    it('runs a raw query to list cases', async () => {
      const result = await service.runQuery([
        { _name: 'listCase' },
        { _name: 'page', from: 0, to: 5 },
      ])

      expect(Array.isArray(result)).toBe(true)
    })

    it('runs a raw query to list alerts', async () => {
      const result = await service.runQuery([
        { _name: 'listAlert' },
        { _name: 'page', from: 0, to: 5 },
      ])

      expect(Array.isArray(result)).toBe(true)
    })
  })
})
