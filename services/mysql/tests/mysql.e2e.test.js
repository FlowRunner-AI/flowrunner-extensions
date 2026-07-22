'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('MySQL Service (e2e)', () => {
  let sandbox
  let service

  // A throwaway table so the e2e run never touches real data.
  const tableName = `e2e_mysql_${ Date.now() }`

  beforeAll(() => {
    sandbox = createE2ESandbox('mysql')
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

  // ── Read-only smoke test ──

  describe('executeQuery (read-only)', () => {
    it('runs a trivial SELECT and returns the { rows, rowCount, fields } shape', async () => {
      const result = await service.executeQuery('SELECT 1 AS n')

      expect(result).toHaveProperty('rows')
      expect(result).toHaveProperty('rowCount')
      expect(result).toHaveProperty('fields')
      expect(Array.isArray(result.rows)).toBe(true)
      expect(Array.isArray(result.fields)).toBe(true)
      expect(result.rowCount).toBeGreaterThan(0)
    })

    it('binds positional parameters', async () => {
      const result = await service.executeQuery('SELECT ? AS n', [42])

      expect(result).toHaveProperty('rows')
      expect(Array.isArray(result.rows)).toBe(true)
    })
  })

  // ── Schema operations ──

  describe('listTables', () => {
    it('returns tables with expected shape', async () => {
      const result = await service.listTables()

      expect(result).toHaveProperty('tables')
      expect(result).toHaveProperty('count')
      expect(Array.isArray(result.tables)).toBe(true)
    })
  })

  // ── Dictionaries ──

  describe('getTablesDictionary', () => {
    it('returns dictionary items with expected shape', async () => {
      const result = await service.getTablesDictionary({})

      expect(result).toHaveProperty('items')
      expect(result).toHaveProperty('cursor')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Full lifecycle: DDL, insert, select, update, upsert, delete, drop ──

  describe('table lifecycle (create -> insert -> select -> update -> upsert -> delete -> drop)', () => {
    it('creates a throwaway table', async () => {
      const result = await service.executeQuery(
        `CREATE TABLE \`${ tableName }\` (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(100), email VARCHAR(255) UNIQUE, status VARCHAR(20) DEFAULT 'active')`
      )

      expect(result).toHaveProperty('affectedRows')
    })

    it('inserts a single row', async () => {
      const result = await service.insertRow(tableName, {
        name: 'Ada',
        email: 'ada@example.com',
      })

      expect(result).toHaveProperty('insertId')
      expect(result).toHaveProperty('affectedRows', 1)
      expect(result).toHaveProperty('row')
    })

    it('bulk-inserts multiple rows', async () => {
      const result = await service.insertRows(tableName, [
        { name: 'Linus', email: 'linus@example.com' },
        { name: 'Grace', email: 'grace@example.com' },
      ])

      expect(result).toHaveProperty('insertedCount', 2)
      expect(result).toHaveProperty('firstInsertId')
    })

    it('selects rows back', async () => {
      const result = await service.selectRows(tableName)

      expect(result).toHaveProperty('rows')
      expect(result).toHaveProperty('rowCount')
      expect(result.rowCount).toBeGreaterThanOrEqual(3)
    })

    it('selects with WHERE conditions', async () => {
      const result = await service.selectRows(tableName, null, { name: 'Ada' })

      expect(result.rowCount).toBe(1)
      expect(result.rows[0]).toHaveProperty('name', 'Ada')
    })

    it('selects specific columns with ORDER BY and LIMIT', async () => {
      const result = await service.selectRows(tableName, ['name'], null, 'name', 'Ascending', 2)

      expect(result.rowCount).toBe(2)
      expect(result.rows[0]).toHaveProperty('name')
      expect(result.rows[0]).not.toHaveProperty('email')
    })

    it('gets table schema', async () => {
      const result = await service.getTableSchema(tableName)

      expect(result).toHaveProperty('table', tableName)
      expect(result).toHaveProperty('columns')
      expect(Array.isArray(result.columns)).toBe(true)
      expect(result.columns.length).toBeGreaterThanOrEqual(3)

      const idCol = result.columns.find(c => c.name === 'id')

      expect(idCol).toBeDefined()
      expect(idCol.key).toBe('PRI')
    })

    it('gets columns dictionary for the table', async () => {
      const result = await service.getColumnsDictionary({ criteria: { table: tableName } })

      expect(result).toHaveProperty('items')
      expect(result.items.length).toBeGreaterThanOrEqual(3)
      expect(result.items[0]).toHaveProperty('label')
      expect(result.items[0]).toHaveProperty('value')
      expect(result.items[0]).toHaveProperty('note')
    })

    it('updates rows', async () => {
      const result = await service.updateRows(
        tableName,
        { status: 'archived' },
        { name: 'Ada' }
      )

      expect(result).toHaveProperty('affectedRows', 1)
      expect(result).toHaveProperty('changedRows', 1)
    })

    it('upserts a row (insert case)', async () => {
      const result = await service.upsertRow(
        tableName,
        { name: 'Alan', email: 'alan@example.com' },
        ['email']
      )

      expect(result).toHaveProperty('affectedRows', 1)
      expect(result).toHaveProperty('insertId')
    })

    it('upserts a row (update case)', async () => {
      const result = await service.upsertRow(
        tableName,
        { name: 'Alan Turing', email: 'alan@example.com' },
        ['email']
      )

      // affectedRows = 2 means existing row was updated
      expect(result).toHaveProperty('affectedRows', 2)
    })

    it('deletes rows', async () => {
      const result = await service.deleteRows(tableName, { status: 'archived' })

      expect(result).toHaveProperty('affectedRows')
      expect(result.affectedRows).toBeGreaterThanOrEqual(1)
    })

    afterAll(async () => {
      try {
        await service.executeQuery(`DROP TABLE IF EXISTS \`${ tableName }\``)
      } catch (e) {
        // ignore cleanup errors
      }
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('throws a wrapped MySQL error on invalid SQL', async () => {
      await expect(service.executeQuery('SELCT bad syntax')).rejects.toThrow(/MySQL error:/)
    })
  })
})
