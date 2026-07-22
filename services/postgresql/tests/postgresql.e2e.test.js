'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

/**
 * These e2e tests need a reachable PostgreSQL database AND the `pg` driver installed
 * (run `npm install` inside services/postgresql). When either is missing, every test
 * skips gracefully instead of failing.
 *
 * Fill in service-sandbox/e2e-config.json:
 *   "postgresql": {
 *     "configs": { "connectionString": "postgresql://user:pass@host:5432/db", "ssl": true },
 *     "testValues": { "table": "public.flowrunner_e2e" }
 *   }
 *
 * The table named by testValues.table is created and dropped by this suite.
 */
describe('PostgreSQL Service (e2e)', () => {
  let sandbox
  let service
  let testValues
  let available = false
  let skipReason = ''

  const TABLE = () => (testValues && testValues.table) || 'public.flowrunner_e2e'

  beforeAll(async () => {
    sandbox = createE2ESandbox('postgresql')

    try {
      require('../src/index.js')
    } catch (error) {
      skipReason = `the "pg" driver is not installed (${ error.message })`

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

    const configs = service.config || {}

    if (!configs.connectionString && !configs.host) {
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

      await expect(service.deleteRows('t', {})).rejects.toThrow('Where must be a non-empty object.')

      await expect(service.upsertRow('t', { a: 1 }, [])).rejects.toThrow(
        'Conflict Columns must be a non-empty array of column names.'
      )

      await expect(service.getColumnsDictionary({})).resolves.toEqual({ items: [], cursor: null })
    })
  })

  // ── SQL ──

  describe('executeQuery', () => {
    it('runs a trivial statement', async () => {
      if (!available) {
        return skipped('executeQuery')
      }

      const result = await service.executeQuery('SELECT $1::int AS answer', [42])

      expect(result.rows).toEqual([{ answer: 42 }])
      expect(result.rowCount).toBe(1)
      expect(result.fields[0]).toHaveProperty('name', 'answer')
    })

    it('surfaces SQL errors', async () => {
      if (!available) {
        return skipped('executeQuery error')
      }

      await expect(service.executeQuery('SELECT * FROM no_such_table_e2e'))
        .rejects.toThrow(/PostgreSQL error/)
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
        `CREATE TABLE ${ TABLE() } (id serial PRIMARY KEY, email text UNIQUE, name text, age int)`
      )

      const tables = await service.listTables()

      expect(Array.isArray(tables.tables)).toBe(true)
    })

    it('inserts, selects, updates, upserts and deletes rows', async () => {
      if (!available) {
        return skipped('row lifecycle')
      }

      const table = TABLE()

      const inserted = await service.insertRow(table, { email: 'a@example.com', name: 'Ada', age: 36 })

      expect(inserted.row).toMatchObject({ email: 'a@example.com', name: 'Ada' })

      const batch = await service.insertRows(table, [
        { email: 'b@example.com', name: 'Bob' },
        { email: 'c@example.com', name: 'Cy', age: 30 },
      ])

      expect(batch.insertedCount).toBe(2)

      const selected = await service.selectRows(
        table, ['email', 'name'], { name: ['Ada', 'Bob'] }, 'email', 'Ascending', 10, 0
      )

      expect(selected.rowCount).toBe(2)
      expect(selected.rows[0]).toEqual({ email: 'a@example.com', name: 'Ada' })

      const nulls = await service.selectRows(table, null, { age: null })

      expect(nulls.rowCount).toBe(1)

      const updated = await service.updateRows(table, { age: 40 }, { email: 'b@example.com' })

      expect(updated.updatedCount).toBe(1)
      expect(updated.rows[0].age).toBe(40)

      const upserted = await service.upsertRow(
        table, { email: 'a@example.com', name: 'Ada Lovelace', age: 37 }, ['email']
      )

      expect(upserted.row).toMatchObject({ email: 'a@example.com', name: 'Ada Lovelace' })

      const deleted = await service.deleteRows(table, { email: 'c@example.com' })

      expect(deleted.deletedCount).toBe(1)
    })
  })

  // ── Schema ──

  describe('schema', () => {
    it('describes the fixture table', async () => {
      if (!available) {
        return skipped('getTableSchema')
      }

      const result = await service.getTableSchema(TABLE())

      expect(result).toHaveProperty('table')
      expect(Array.isArray(result.columns)).toBe(true)

      expect(result.columns.map(column => column.name)).toEqual(
        expect.arrayContaining(['id', 'email', 'name', 'age'])
      )
    })

    it('rejects an unknown table', async () => {
      if (!available) {
        return skipped('getTableSchema error')
      }

      await expect(service.getTableSchema('public.no_such_table_e2e'))
        .rejects.toThrow(/was not found or has no columns/)
    })
  })

  // ── Dictionaries ──

  describe('dictionaries', () => {
    it('returns the tables dictionary', async () => {
      if (!available) {
        return skipped('getTablesDictionary')
      }

      const result = await service.getTablesDictionary({})

      expect(Array.isArray(result.items)).toBe(true)

      result.items.forEach(item => {
        expect(item).toHaveProperty('label')
        expect(item.value).toContain('.')
      })
    })

    it('filters the tables dictionary by search', async () => {
      if (!available) {
        return skipped('getTablesDictionary search')
      }

      const result = await service.getTablesDictionary({ search: 'zzz_no_such_table' })

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('returns the columns dictionary for the fixture table', async () => {
      if (!available) {
        return skipped('getColumnsDictionary')
      }

      const result = await service.getColumnsDictionary({ criteria: { table: TABLE() } })

      expect(result.cursor).toBeNull()

      expect(result.items.map(item => item.value)).toEqual(
        expect.arrayContaining(['id', 'email', 'name', 'age'])
      )
    })
  })
})
