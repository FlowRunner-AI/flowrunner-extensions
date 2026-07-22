'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Stackby Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('stackby')
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

  // ── Rows ──

  describe('listRows', () => {
    it('lists rows of the configured table', async () => {
      const { stackId, tableName } = testValues

      if (!stackId || !tableName) {
        console.log('Skipping listRows: testValues.stackId or testValues.tableName not set')

        return
      }

      const result = await service.listRows(stackId, tableName, undefined, 5)

      expect(Array.isArray(result)).toBe(true)

      if (result.length) {
        expect(result[0]).toHaveProperty('id')
        expect(result[0]).toHaveProperty('field')
      }
    })

    it('supports paging with an offset', async () => {
      const { stackId, tableName } = testValues

      if (!stackId || !tableName) {
        console.log('Skipping listRows offset: testValues.stackId or testValues.tableName not set')

        return
      }

      const result = await service.listRows(stackId, tableName, undefined, 1, 0)

      expect(Array.isArray(result)).toBe(true)
    })
  })

  describe('create, get, update and delete rows', () => {
    let createdRowId

    it('creates a row', async () => {
      const { stackId, tableName, columnName } = testValues

      if (!stackId || !tableName || !columnName) {
        console.log('Skipping createRows: testValues.stackId, tableName or columnName not set')

        return
      }

      const result = await service.createRows(stackId, tableName, [
        { [columnName]: `FlowRunner e2e ${ Date.now() }` },
      ])

      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThan(0)
      expect(result[0]).toHaveProperty('id')

      createdRowId = result[0].id
    })

    it('reads the created row back', async () => {
      const { stackId, tableName } = testValues

      if (!createdRowId) {
        console.log('Skipping getRow: no row was created')

        return
      }

      const result = await service.getRow(stackId, tableName, createdRowId)

      expect(result).toHaveProperty('id', createdRowId)
      expect(result).toHaveProperty('field')
    })

    it('updates the created row', async () => {
      const { stackId, tableName, columnName } = testValues

      if (!createdRowId) {
        console.log('Skipping updateRows: no row was created')

        return
      }

      const result = await service.updateRows(stackId, tableName, [
        { id: createdRowId, field: { [columnName]: `FlowRunner e2e updated ${ Date.now() }` } },
      ])

      expect(Array.isArray(result)).toBe(true)
    })

    it('deletes the created row', async () => {
      const { stackId, tableName } = testValues

      if (!createdRowId) {
        console.log('Skipping deleteRows: no row was created')

        return
      }

      const result = await service.deleteRows(stackId, tableName, [createdRowId])

      expect(result).toBeDefined()
    })
  })

  // ── Validation ──

  describe('parameter validation', () => {
    it('rejects an empty create payload without calling the api', async () => {
      await expect(service.createRows('stack', 'table', [])).rejects.toThrow(
        'At least one row is required to create.'
      )
    })

    it('rejects an empty update payload without calling the api', async () => {
      await expect(service.updateRows('stack', 'table', [])).rejects.toThrow(
        'At least one row is required to update.'
      )
    })

    it('rejects an empty delete payload without calling the api', async () => {
      await expect(service.deleteRows('stack', 'table', [])).rejects.toThrow(
        'At least one row ID is required to delete.'
      )
    })
  })

  // ── Errors ──

  describe('error handling', () => {
    it('throws a descriptive error for an unknown stack', async () => {
      await expect(service.listRows('stInvalidStackId', 'Nope')).rejects.toThrow(/Stackby API error/)
    })
  })
})
