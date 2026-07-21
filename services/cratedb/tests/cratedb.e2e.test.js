'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('CrateDB Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('cratedb')
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

  // A dedicated throwaway table so the e2e run never touches real data.
  // The developer may override the name via testValues.tableName.
  const tableName = (testValues && testValues.tableName) || `e2e_cratedb_${ Date.now() }`

  // ── Read-only smoke test ──

  describe('executeSQL (read-only)', () => {
    it('runs a trivial SELECT and returns the { cols, rows } shape', async () => {
      const result = await service.executeSQL('SELECT 1 AS n')

      expect(result).toHaveProperty('cols')
      expect(result).toHaveProperty('rows')
      expect(Array.isArray(result.cols)).toBe(true)
      expect(Array.isArray(result.rows)).toBe(true)
    })

    it('binds positional parameters', async () => {
      const result = await service.executeSQL('SELECT ? AS n', [42])

      expect(result).toHaveProperty('rows')
      expect(Array.isArray(result.rows)).toBe(true)
    })

    it('returns col_types when Include Column Types is enabled', async () => {
      const result = await service.executeSQL('SELECT 1 AS n', undefined, true)

      expect(result).toHaveProperty('col_types')
      expect(Array.isArray(result.col_types)).toBe(true)
    })
  })

  // ── Full lifecycle: DDL, bulk insert, select, cleanup ──

  describe('table lifecycle (create → bulk insert → select → drop)', () => {
    it('creates a throwaway table', async () => {
      const result = await service.executeSQL(
        `CREATE TABLE IF NOT EXISTS "${ tableName }" (id INTEGER PRIMARY KEY, name STRING)`
      )

      expect(result).toHaveProperty('rowcount')
    })

    it('bulk inserts rows', async () => {
      const result = await service.executeBulkSQL(
        `INSERT INTO "${ tableName }" (id, name) VALUES (?, ?)`,
        [
          [1337, 'Earth'],
          [1338, 'Sun'],
        ]
      )

      expect(result).toHaveProperty('results')
      expect(Array.isArray(result.results)).toBe(true)
      expect(result.results).toHaveLength(2)
    })

    it('selects the inserted rows back', async () => {
      // REFRESH so freshly-inserted rows are visible to the following SELECT.
      await service.executeSQL(`REFRESH TABLE "${ tableName }"`)

      const result = await service.executeSQL(`SELECT id, name FROM "${ tableName }" ORDER BY id`)

      expect(result).toHaveProperty('rows')
      expect(Array.isArray(result.rows)).toBe(true)
    })

    afterAll(async () => {
      try {
        await service.executeSQL(`DROP TABLE IF EXISTS "${ tableName }"`)
      } catch (e) {
        // ignore cleanup errors
      }
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('throws a wrapped CrateDB error on invalid SQL', async () => {
      await expect(service.executeSQL('SELCT bad syntax')).rejects.toThrow(/CrateDB error:/)
    })
  })
})
