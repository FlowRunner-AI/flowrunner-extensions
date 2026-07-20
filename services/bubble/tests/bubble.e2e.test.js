'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Bubble Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('bubble')
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

  // A unique-ish suffix so repeated e2e runs don't collide.
  const suffix = Date.now()

  // The Bubble data type to run CRUD against (e.g. "user", "order", "test_thing").
  // Provide it in the bubble entry of e2e-config.json under testValues.dataType.
  const dataType = () => testValues.dataType

  // ── Data: List / Search Things ──

  describe('listThings', () => {
    it('returns a paginated response with a results array', async () => {
      if (!dataType()) {
        console.log('Skipping listThings: set testValues.dataType')
        return
      }

      const response = await service.listThings(dataType(), undefined, undefined, undefined, 5, 0)

      expect(response).toHaveProperty('response')
      expect(response.response).toHaveProperty('results')
      expect(Array.isArray(response.response.results)).toBe(true)
    })

    it('accepts constraints without error', async () => {
      if (!dataType()) {
        console.log('Skipping listThings (constraints): set testValues.dataType')
        return
      }

      const response = await service.listThings(
        dataType(),
        [{ key: 'Created Date', constraint_type: 'greater than', value: '1970-01-01T00:00:00.000Z' }],
        'Created Date',
        true,
        5,
        0
      )

      expect(response).toHaveProperty('response')
      expect(Array.isArray(response.response.results)).toBe(true)
    })
  })

  // ── Data: Create + Get + Modify + Replace + Delete lifecycle ──

  describe('createThing + getThing + modifyThing + replaceThing + deleteThing', () => {
    let thingId

    // The fields to create/replace the thing with (must match the data type's
    // schema and privacy rules). Provide via testValues.createFields /
    // testValues.replaceFields, or the tests below are skipped.
    const createFields = () => testValues.createFields
    const replaceFields = () => testValues.replaceFields || testValues.createFields

    const canRun = () => Boolean(dataType() && createFields())

    it('creates a thing', async () => {
      if (!canRun()) {
        console.log('Skipping create/get/modify/replace/delete: set testValues.dataType and testValues.createFields')
        return
      }

      const response = await service.createThing(dataType(), createFields())

      expect(response).toHaveProperty('id')
      thingId = response.id
    })

    it('retrieves the created thing', async () => {
      if (!canRun() || !thingId) {
        return
      }

      const response = await service.getThing(dataType(), thingId)

      expect(response).toHaveProperty('response')
      expect(response.response).toHaveProperty('_id', thingId)
    })

    it('modifies the thing', async () => {
      if (!canRun() || !thingId) {
        return
      }

      const response = await service.modifyThing(dataType(), thingId, createFields())

      expect(response).toBeDefined()
    })

    it('replaces the thing', async () => {
      if (!canRun() || !thingId) {
        return
      }

      const response = await service.replaceThing(dataType(), thingId, replaceFields())

      expect(response).toBeDefined()
    })

    it('deletes the thing', async () => {
      if (!canRun() || !thingId) {
        return
      }

      const response = await service.deleteThing(dataType(), thingId)

      expect(response).toBeDefined()
    })

    afterAll(async () => {
      // Best-effort cleanup in case a middle step failed before deletion.
      if (canRun() && thingId) {
        try {
          await service.deleteThing(dataType(), thingId)
        } catch (e) {
          // ignore cleanup errors (already deleted or not found)
        }
      }
    })
  })

  // ── Data: Bulk Create Things ──

  describe('bulkCreateThings', () => {
    it('bulk-creates things and returns parsed per-line results', async () => {
      if (!testValues.dataType || !testValues.createFields) {
        console.log('Skipping bulkCreateThings: set testValues.dataType and testValues.createFields')
        return
      }

      const response = await service.bulkCreateThings(testValues.dataType, [
        testValues.createFields,
        testValues.createFields,
      ])

      expect(response).toHaveProperty('results')
      expect(Array.isArray(response.results)).toBe(true)
      expect(response).toHaveProperty('raw')

      // Best-effort cleanup of any successfully-created things.
      for (const item of response.results) {
        if (item && item.status === 'success' && item.id) {
          try {
            await service.deleteThing(testValues.dataType, item.id)
          } catch (e) {
            // ignore cleanup errors
          }
        }
      }
    })
  })

  // ── Workflow: Trigger Workflow ──

  describe('triggerWorkflow', () => {
    it('triggers a backend workflow when one is configured', async () => {
      if (!testValues.workflowName) {
        console.log('Skipping triggerWorkflow: set testValues.workflowName')
        return
      }

      const response = await service.triggerWorkflow(
        testValues.workflowName,
        testValues.workflowParameters || {}
      )

      expect(response).toBeDefined()
    })
  })
})
