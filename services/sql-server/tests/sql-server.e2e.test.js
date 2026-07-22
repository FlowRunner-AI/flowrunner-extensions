'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

/**
 * These e2e tests need a reachable Microsoft SQL Server database AND the `mssql`
 * driver installed (run `npm install` inside services/sql-server). When either is
 * missing, every test skips gracefully instead of failing.
 *
 * Fill in service-sandbox/e2e-config.json:
 *   "sql-server": {
 *     "configs": {
 *       "connectionString": "Server=db.example.com,1433;Database=mydb;User Id=u;Password=p;Encrypt=true"
 *     },
 *     "testValues": { "table": "dbo.flowrunner_e2e" }
 *   }
 *
 * Alternatively set host / port / database / user / password / encrypt instead of
 * the connection string. The table named by testValues.table is created and dropped
 * by this suite.
 */
describe('Microsoft SQL Server Service (e2e)', () => {
  let sandbox
  let service
  let testValues
  let available = false
  let skipReason = ''

  const TABLE = () => (testValues && testValues.table) || 'dbo.flowrunner_e2e'

  beforeAll(async () => {
    sandbox = createE2ESandbox('sql-server')

    try {
      require('../src/index.js')
    } catch (error) {
      skipReason = `the "mssql" driver is not installed (${ error.message })`

      return
    }

    try {
      sandbox.validateConfigs()
    } catch (error) {
      console.log(error)
      process.exit(1)
    }

    service = sandbox.getService()
    testValues = sandbox.getTestValues()

    if (!service.connectionString && !service.host) {
      skipReason = 'no connectionString or host is configured in e2e-config.json'

      return
    }

    try {
      await service.executeQuery('SELECT 1 AS ok')

      available = true
    } catch (error) {
      skipReason = `the database is not reachable (${ error.message })`
    }
  })

  afterAll(async () => {
    if (available) {
      try {
        await service.executeQuery(`DROP TABLE IF EXISTS ${ TABLE() }`)
      } catch (error) {
        console.log(`Cleanup failed: ${ error.message }`)
      }
    }

    if (sandbox) {
      sandbox.cleanup()
    }
  })

  function skipped(name) {
    console.log(`Skipping ${ name }: ${ skipReason }`)

    return true
  }

  // ── Validation (no database required) ──

  describe('argument validation', () => {
    it('rejects invalid arguments before touching the database', async () => {
      if (!service) {
        return skipped('argument validation')
      }

      await expect(service.executeQuery('  ')).rejects.toThrow('SQL statement is required.')

      await expect(service.selectRows('')).rejects.toThrow(
        'Table name is required and must be a non-empty string.'
      )

      await expect(service.insertRow('t', {})).rejects.toThrow('Data must be a non-empty object.')

      await expect(service.insertRows('t', [])).rejects.toThrow(
        'Rows must be a non-empty array of objects.'
      )

      await expect(service.updateRows('t', {}, { id: 1 })).rejects.toThrow(
        'Data must be a non-empty object.'
      )

      await expect(service.updateRows('t', { a: 1 }, {})).rejects.toThrow(
        'Where must be a non-empty object.'
      )

      await expect(service.deleteRows('t', {})).rejects.toThrow('Where must be a non-empty object.')

      await expect(service.upsertRow('t', { a: 1 }, [])).rejects.toThrow(
        'Key Columns must be a non-empty array of column names.'
      )

      await expect(service.getColumnsDictionary({})).resolves.toEqual({ items: [], cursor: null })
    })
  })

  // ── SQL ──

  describe('executeQuery', () => {
    it('runs a parameterized statement', async () => {
      if (!available) {
        return skipped('executeQuery')
      }

      const result = await service.executeQuery('SELECT @p1 AS answer', [42])

      expect(result.recordset).toEqual([{ answer: 42 }])
      expect(Array.isArray(result.rowsAffected)).toBe(true)
    })

    it('surfaces SQL errors', async () => {
      if (!available) {
        return skipped('executeQuery error')
      }

      await expect(service.executeQuery('SELECT * FROM no_such_table_e2e')).rejects.toThrow(
        /Microsoft SQL Server error/
      )
    })
  })

  // ── Row lifecycle ──

  describe('row lifecycle', () => {
    it('creates the fixture table', async () => {
      if (!available) {
        return skipped('row lifecycle setup')
      }

      await service.executeQuery(`DROP TABLE IF EXISTS ${ TABLE() }`)

      await service.executeQuery(
        `CREATE TABLE ${ TABLE() } (
           id int IDENTITY(1,1) PRIMARY KEY,
           email nvarchar(255) NOT NULL UNIQUE,
           name nvarchar(255) NULL,
           age int NULL
         )`
      )

      const tables = await service.listTables()

      expect(Array.isArray(tables.tables)).toBe(true)
      expect(tables.count).toBeGreaterThan(0)
    })

    it('inserts, selects, updates, upserts and deletes rows', async () => {
      if (!available) {
        return skipped('row lifecycle')
      }

      const table = TABLE()

      const inserted = await service.insertRow(table, {
        email: 'a@example.com',
        name: 'Ada',
        age: 36,
      })

      expect(inserted.row).toMatchObject({ email: 'a@example.com', name: 'Ada' })

      const batch = await service.insertRows(table, [
        { email: 'b@example.com', name: 'Bob' },
        { email: 'c@example.com', name: 'Cy', age: 30 },
      ])

      expect(batch.insertedCount).toBe(2)

      const selected = await service.selectRows(
        table,
        ['email', 'name'],
        { name: ['Ada', 'Bob'] },
        'email',
        'Ascending',
        10,
        0
      )

      expect(selected.rowCount).toBe(2)
      expect(selected.rows[0]).toEqual({ email: 'a@example.com', name: 'Ada' })

      const nulls = await service.selectRows(table, null, { age: null })

      expect(nulls.rowCount).toBe(1)

      const topOnly = await service.selectRows(table, ['email'], null, 'email', 'Descending', 1)

      expect(topOnly.rowCount).toBe(1)

      const updated = await service.updateRows(table, { age: 40 }, { email: 'b@example.com' })

      expect(updated.updatedCount).toBe(1)
      expect(updated.rows[0].age).toBe(40)

      const upserted = await service.upsertRow(
        table,
        { email: 'a@example.com', name: 'Ada Lovelace', age: 37 },
        ['email']
      )

      expect(upserted.row).toMatchObject({ email: 'a@example.com', name: 'Ada Lovelace' })

      const insertedByUpsert = await service.upsertRow(
        table,
        { email: 'd@example.com', name: 'Dee' },
        ['email']
      )

      expect(insertedByUpsert.row).toMatchObject({ email: 'd@example.com' })

      const deleted = await service.deleteRows(table, { email: ['b@example.com', 'c@example.com'] })

      expect(deleted.deletedCount).toBe(2)
    })
  })

  // ── Schema ──

  describe('schema', () => {
    it('describes the fixture table', async () => {
      if (!available) {
        return skipped('getTableSchema')
      }

      const result = await service.getTableSchema(TABLE())

      expect(result).toHaveProperty('columns')

      expect(result.columns.map(column => column.name)).toEqual(
        expect.arrayContaining(['id', 'email', 'name', 'age'])
      )
    })

    it('fails for an unknown table', async () => {
      if (!available) {
        return skipped('getTableSchema error')
      }

      await expect(service.getTableSchema('dbo.no_such_table_e2e')).rejects.toThrow(
        /was not found or has no columns/
      )
    })
  })

  // ── Dictionaries ──

  describe('dictionaries', () => {
    it('lists tables for the dropdown', async () => {
      if (!available) {
        return skipped('getTablesDictionary')
      }

      const result = await service.getTablesDictionary({})

      expect(Array.isArray(result.items)).toBe(true)

      if (result.items.length) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
        expect(result.items[0]).toHaveProperty('note')
      }
    })

    it('lists the columns of the fixture table', async () => {
      if (!available) {
        return skipped('getColumnsDictionary')
      }

      const result = await service.getColumnsDictionary({ criteria: { table: TABLE() } })

      expect(result.cursor).toBeNull()

      expect(result.items.map(item => item.value)).toEqual(
        expect.arrayContaining(['id', 'email', 'name', 'age'])
      )
    })

    it('filters columns by search text', async () => {
      if (!available) {
        return skipped('getColumnsDictionary search')
      }

      const result = await service.getColumnsDictionary({
        search: 'ema',
        criteria: { table: TABLE() },
      })

      expect(result.items.map(item => item.value)).toEqual(['email'])
    })
  })
})
