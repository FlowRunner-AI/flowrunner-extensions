'use strict'

// ============================================================================
//  Oracle Database Service — E2E Tests
//
//  These tests require a real Oracle Database connection. Configure the
//  service-sandbox/e2e-config.json file with valid connection details before
//  running. The tests create and clean up their own test data.
// ============================================================================

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Oracle Database Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  const TEST_TABLE = 'FR_E2E_TEST'

  beforeAll(() => {
    sandbox = createE2ESandbox('oracle-database')
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

  // ── Schema operations ──

  describe('listTables', () => {
    it('returns tables with expected shape', async () => {
      const result = await service.listTables()

      expect(result).toHaveProperty('tables')
      expect(result).toHaveProperty('count')
      expect(Array.isArray(result.tables)).toBe(true)
      expect(typeof result.count).toBe('number')
    })
  })

  // ── Test table lifecycle ──

  describe('test table lifecycle (create, insert, select, update, delete, drop)', () => {
    it('creates the test table', async () => {
      // Drop it first in case a prior run left it behind
      try {
        await service.executeStatement(`DROP TABLE ${TEST_TABLE}`)
      } catch {
        // table may not exist — that is fine
      }

      const result = await service.executeStatement(
        `CREATE TABLE ${TEST_TABLE} (ID NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY, NAME VARCHAR2(100), STATUS VARCHAR2(50) DEFAULT 'active')`
      )

      // DDL returns 0 rowsAffected
      expect(result).toHaveProperty('rowsAffected')
    })

    it('describes the test table', async () => {
      const result = await service.describeTable(TEST_TABLE)

      expect(result).toHaveProperty('table', TEST_TABLE)
      expect(result).toHaveProperty('columns')
      expect(Array.isArray(result.columns)).toBe(true)
      expect(result.columns.length).toBeGreaterThanOrEqual(3)

      const idCol = result.columns.find(c => c.name === 'ID')

      expect(idCol).toBeDefined()
      expect(idCol).toHaveProperty('dataType')
      expect(idCol).toHaveProperty('nullable')
    })

    it('inserts a row', async () => {
      const result = await service.insertRow(TEST_TABLE, {
        NAME: 'Ada Lovelace',
        STATUS: 'active',
      })

      expect(result).toEqual({ rowsAffected: 1 })
    })

    it('inserts another row using executeStatement', async () => {
      const result = await service.executeStatement(
        `INSERT INTO ${TEST_TABLE} (NAME, STATUS) VALUES (:name, :status)`,
        { name: 'Grace Hopper', status: 'active' }
      )

      expect(result).toEqual({ rowsAffected: 1 })
    })

    it('selects rows from the test table', async () => {
      const result = await service.selectRows(TEST_TABLE)

      expect(result).toHaveProperty('rows')
      expect(result).toHaveProperty('rowCount')
      expect(result.rowCount).toBeGreaterThanOrEqual(2)
      expect(result.rows[0]).toHaveProperty('NAME')
    })

    it('selects rows with specific columns', async () => {
      const result = await service.selectRows(TEST_TABLE, ['NAME'])

      expect(result.rows.length).toBeGreaterThanOrEqual(2)
      expect(result.rows[0]).toHaveProperty('NAME')
    })

    it('selects rows with WHERE clause', async () => {
      const result = await service.selectRows(
        TEST_TABLE,
        null,
        'NAME = :name',
        { name: 'Ada Lovelace' }
      )

      expect(result.rowCount).toBe(1)
      expect(result.rows[0].NAME).toBe('Ada Lovelace')
    })

    it('selects rows with ORDER BY', async () => {
      const result = await service.selectRows(
        TEST_TABLE,
        null,
        null,
        null,
        'NAME',
        'Ascending'
      )

      expect(result.rowCount).toBeGreaterThanOrEqual(2)
      // Ada < Grace alphabetically
      expect(result.rows[0].NAME).toBe('Ada Lovelace')
    })

    it('selects rows with LIMIT', async () => {
      const result = await service.selectRows(
        TEST_TABLE,
        null,
        null,
        null,
        null,
        null,
        1
      )

      expect(result.rowCount).toBe(1)
    })

    it('queries the test table with executeQuery', async () => {
      const result = await service.executeQuery(
        `SELECT * FROM ${TEST_TABLE} WHERE STATUS = :status`,
        { status: 'active' }
      )

      expect(result).toHaveProperty('rows')
      expect(result).toHaveProperty('rowCount')
      expect(result).toHaveProperty('columns')
      expect(Array.isArray(result.columns)).toBe(true)
      expect(result.columns).toContain('NAME')
    })

    it('queries with maxRows', async () => {
      const result = await service.executeQuery(
        `SELECT * FROM ${TEST_TABLE}`,
        null,
        1
      )

      expect(result.rowCount).toBe(1)
    })

    it('updates rows', async () => {
      const result = await service.updateRows(
        TEST_TABLE,
        { STATUS: 'archived' },
        'NAME = :name',
        { name: 'Grace Hopper' }
      )

      expect(result).toHaveProperty('rowsAffected')
      expect(result.rowsAffected).toBe(1)

      // Verify the update
      const check = await service.selectRows(
        TEST_TABLE,
        ['STATUS'],
        'NAME = :name',
        { name: 'Grace Hopper' }
      )

      expect(check.rows[0].STATUS).toBe('archived')
    })

    it('deletes rows', async () => {
      const result = await service.deleteRows(
        TEST_TABLE,
        'NAME = :name',
        { name: 'Grace Hopper' }
      )

      expect(result).toHaveProperty('rowsAffected')
      expect(result.rowsAffected).toBe(1)
    })

    it('drops the test table', async () => {
      const result = await service.executeStatement(`DROP TABLE ${TEST_TABLE}`)

      expect(result).toHaveProperty('rowsAffected')
    })
  })

  // ── PL/SQL block ──

  describe('executePlsqlBlock', () => {
    it('executes a simple PL/SQL block with OUT bind', async () => {
      const result = await service.executePlsqlBlock(
        'BEGIN :result := :a + :b; END;',
        {
          a: 10,
          b: 20,
          result: { dir: 'out', type: 'number' },
        }
      )

      expect(result).toHaveProperty('outBinds')
      expect(result.outBinds.result).toBe(30)
    })

    it('executes a PL/SQL block with string OUT bind', async () => {
      const result = await service.executePlsqlBlock(
        "BEGIN :greeting := 'Hello, ' || :name || '!'; END;",
        {
          name: 'World',
          greeting: { dir: 'out', type: 'string' },
        }
      )

      expect(result.outBinds.greeting).toBe('Hello, World!')
    })
  })

  // ── Dictionaries ──

  describe('getTablesDictionary', () => {
    it('returns dictionary items with expected shape', async () => {
      const result = await service.getTablesDictionary({})

      expect(result).toHaveProperty('items')
      expect(result).toHaveProperty('cursor')
      expect(Array.isArray(result.items)).toBe(true)

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
        expect(result.items[0]).toHaveProperty('note', 'Table')
      }
    })

    it('handles null payload', async () => {
      const result = await service.getTablesDictionary(null)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getColumnsDictionary', () => {
    it('returns empty items when no table is specified', async () => {
      const result = await service.getColumnsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('returns columns for a known table', async () => {
      const { existingTable } = testValues

      if (!existingTable) {
        console.log('Skipping: testValues.existingTable not set')
        return
      }

      const result = await service.getColumnsDictionary({
        criteria: { table: existingTable },
      })

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
        expect(result.items[0]).toHaveProperty('note')
      }
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('throws on invalid SQL', async () => {
      await expect(
        service.executeQuery('SELECT * FROM THIS_TABLE_DOES_NOT_EXIST_FR_E2E')
      ).rejects.toThrow(/Oracle Database error:/)
    })

    it('throws when describing a non-existent table', async () => {
      await expect(
        service.describeTable('THIS_TABLE_DOES_NOT_EXIST_FR_E2E')
      ).rejects.toThrow(/was not found/)
    })
  })
})
