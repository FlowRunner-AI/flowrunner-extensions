'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

/**
 * Required e2e-config.json entry:
 *
 * "seatable": {
 *   "configs": {
 *     "serverUrl": "https://cloud.seatable.io",
 *     "apiToken": "<Base API Token>"
 *   },
 *   "testValues": {
 *     "tableName": "Tasks",          // a table in the connected base (required for row tests)
 *     "textColumnName": "Name"        // a text column of that table (required for row tests)
 *   }
 * }
 */
describe('SeaTable Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('seatable')
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

  // ── Metadata ──

  describe('getBaseMetadata', () => {
    it('returns the base schema', async () => {
      const result = await service.getBaseMetadata()

      expect(result).toHaveProperty('tables')
      expect(Array.isArray(result.tables)).toBe(true)
    })
  })

  describe('getTablesDictionary', () => {
    it('returns dictionary items for the base tables', async () => {
      const result = await service.getTablesDictionary({})

      expect(Array.isArray(result.items)).toBe(true)

      if (result.items.length) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
      }
    })

    it('filters tables by search', async () => {
      const all = await service.getTablesDictionary({})

      if (!all.items.length) {
        console.log('Skipping search assertion: the base has no tables')

        return
      }

      const term = String(all.items[0].label).slice(0, 3)
      const filtered = await service.getTablesDictionary({ search: term })

      expect(filtered.items.length).toBeGreaterThan(0)
    })
  })

  describe('getColumnsDictionary', () => {
    it('returns columns for a table', async () => {
      const tableName = testValues.tableName

      if (!tableName) {
        console.log('Skipping getColumnsDictionary: testValues.tableName not set')

        return
      }

      const result = await service.getColumnsDictionary({ criteria: { tableName } })

      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Rows ──

  describe('rows lifecycle', () => {
    let createdRowId

    const skip = () => !testValues.tableName || !testValues.textColumnName

    it('appends a row', async () => {
      if (skip()) {
        console.log('Skipping appendRow: testValues.tableName or testValues.textColumnName not set')

        return
      }

      const result = await service.appendRow(testValues.tableName, {
        [testValues.textColumnName]: 'FlowRunner e2e row',
      })

      expect(result).toBeDefined()
      createdRowId = result?._id || result?.row?._id

      expect(createdRowId).toBeTruthy()
    })

    it('lists rows', async () => {
      if (skip()) {
        console.log('Skipping listRows: testValues.tableName not set')

        return
      }

      const result = await service.listRows(testValues.tableName, undefined, 0, 5, true)

      expect(result).toHaveProperty('rows')
      expect(Array.isArray(result.rows)).toBe(true)
    })

    it('gets the created row', async () => {
      if (skip() || !createdRowId) {
        console.log('Skipping getRow: no row was created')

        return
      }

      const result = await service.getRow(testValues.tableName, createdRowId)

      expect(result).toHaveProperty('_id', createdRowId)
    })

    it('updates the created row', async () => {
      if (skip() || !createdRowId) {
        console.log('Skipping updateRow: no row was created')

        return
      }

      const result = await service.updateRow(testValues.tableName, createdRowId, {
        [testValues.textColumnName]: 'FlowRunner e2e row (updated)',
      })

      expect(result).toBeDefined()
    })

    it('appends and deletes a batch of rows', async () => {
      if (skip()) {
        console.log('Skipping batch rows: testValues.tableName not set')

        return
      }

      const appended = await service.appendRows(testValues.tableName, [
        { [testValues.textColumnName]: 'FlowRunner e2e batch 1' },
        { [testValues.textColumnName]: 'FlowRunner e2e batch 2' },
      ])

      expect(appended).toBeDefined()

      const listed = await service.listRows(testValues.tableName, undefined, 0, 1000, true)
      const batchIds = (listed.rows || [])
        .filter(row => String(row[testValues.textColumnName] || '').startsWith('FlowRunner e2e batch'))
        .map(row => row._id)

      if (batchIds.length) {
        await expect(service.deleteRows(testValues.tableName, batchIds)).resolves.toBeDefined()
      }
    })

    it('deletes the created row', async () => {
      if (skip() || !createdRowId) {
        console.log('Skipping deleteRow: no row was created')

        return
      }

      await expect(
        service.deleteRow(testValues.tableName, createdRowId)
      ).resolves.toBeDefined()
    })
  })

  // ── SQL ──

  describe('queryWithSql', () => {
    it('runs a SELECT against the base', async () => {
      if (!testValues.tableName) {
        console.log('Skipping queryWithSql: testValues.tableName not set')

        return
      }

      const result = await service.queryWithSql(
        `SELECT * FROM \`${ testValues.tableName }\` LIMIT 1`
      )

      expect(result).toHaveProperty('results')
    })
  })

  // ── Errors ──

  describe('error handling', () => {
    it('throws a wrapped error for an unknown table', async () => {
      await expect(service.listRows('__flowrunner_missing_table__')).rejects.toThrow(
        /SeaTable API error/
      )
    })
  })
})
