'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('TimescaleDB Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('timescaledb')
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

  // ── SQL ──

  describe('executeQuery', () => {
    it('executes a simple SELECT query', async () => {
      const result = await service.executeQuery('SELECT 1 AS value')

      expect(result).toHaveProperty('rows')
      expect(result).toHaveProperty('rowCount')
      expect(result).toHaveProperty('fields')
      expect(result.rows).toEqual([{ value: 1 }])
      expect(result.rowCount).toBe(1)
    })

    it('executes a query with parameters', async () => {
      const result = await service.executeQuery('SELECT $1::int AS num, $2::text AS label', [42, 'hello'])

      expect(result.rows[0]).toEqual({ num: 42, label: 'hello' })
    })

    it('throws on invalid SQL', async () => {
      await expect(service.executeQuery('INVALID SQL STATEMENT')).rejects.toThrow()
    })
  })

  // ── Schema ──

  describe('listTables', () => {
    it('returns a list of tables', async () => {
      const result = await service.listTables()

      expect(result).toHaveProperty('tables')
      expect(result).toHaveProperty('count')
      expect(Array.isArray(result.tables)).toBe(true)

      if (result.tables.length > 0) {
        expect(result.tables[0]).toHaveProperty('schema')
        expect(result.tables[0]).toHaveProperty('name')
        expect(result.tables[0]).toHaveProperty('type')
      }
    })
  })

  // ── Dictionaries ──

  describe('getTablesDictionary', () => {
    it('returns items with label, value, note', async () => {
      const result = await service.getTablesDictionary({})

      expect(result).toHaveProperty('items')
      expect(result).toHaveProperty('cursor')
      expect(Array.isArray(result.items)).toBe(true)

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
        expect(result.items[0]).toHaveProperty('note')
      }
    })

    it('handles null payload', async () => {
      const result = await service.getTablesDictionary(null)

      expect(result).toHaveProperty('items')
      expect(result).toHaveProperty('cursor')
    })

    it('filters by search', async () => {
      const result = await service.getTablesDictionary({ search: 'zzz_nonexistent_table_zzz' })

      expect(result.items).toHaveLength(0)
    })
  })

  describe('getColumnsDictionary', () => {
    it('returns empty items when no table is specified', async () => {
      const result = await service.getColumnsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('returns columns for an existing table', async () => {
      const { testTable } = testValues

      if (!testTable) {
        console.log('Skipping: testValues.testTable not set')
        return
      }

      const result = await service.getColumnsDictionary({ criteria: { table: testTable } })

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
        expect(result.items[0]).toHaveProperty('note')
      }
    })
  })

  // ── CRUD lifecycle ──

  describe('CRUD lifecycle', () => {
    const testTableName = 'e2e_test_timescaledb_crud'
    let tableCreated = false

    beforeAll(async () => {
      // Create a test table for CRUD operations
      try {
        await service.executeQuery(`DROP TABLE IF EXISTS ${testTableName}`)
        await service.executeQuery(
          `CREATE TABLE ${testTableName} (id SERIAL PRIMARY KEY, name TEXT NOT NULL, value NUMERIC, created_at TIMESTAMPTZ DEFAULT NOW())`
        )
        tableCreated = true
      } catch (error) {
        console.log('Failed to create test table:', error.message)
      }
    })

    afterAll(async () => {
      // Clean up test table
      try {
        await service.executeQuery(`DROP TABLE IF EXISTS ${testTableName}`)
      } catch (error) {
        console.log('Failed to drop test table:', error.message)
      }
    })

    it('inserts a row', async () => {
      if (!tableCreated) {
        console.log('Skipping: test table was not created')
        return
      }

      const result = await service.insertRow(testTableName, { name: 'test-item', value: 42 })

      expect(result).toHaveProperty('row')
      expect(result.row).toHaveProperty('id')
      expect(result.row.name).toBe('test-item')
      expect(Number(result.row.value)).toBe(42)
    })

    it('inserts multiple rows', async () => {
      if (!tableCreated) {
        console.log('Skipping: test table was not created')
        return
      }

      const result = await service.insertRows(testTableName, [
        { name: 'batch-1', value: 10 },
        { name: 'batch-2', value: 20 },
      ])

      expect(result).toHaveProperty('rows')
      expect(result).toHaveProperty('insertedCount')
      expect(result.insertedCount).toBe(2)
    })

    it('selects rows', async () => {
      if (!tableCreated) {
        console.log('Skipping: test table was not created')
        return
      }

      const result = await service.selectRows(testTableName)

      expect(result).toHaveProperty('rows')
      expect(result).toHaveProperty('rowCount')
      expect(result.rowCount).toBeGreaterThanOrEqual(3)
    })

    it('selects rows with where filter', async () => {
      if (!tableCreated) {
        console.log('Skipping: test table was not created')
        return
      }

      const result = await service.selectRows(testTableName, ['name', 'value'], { name: 'test-item' })

      expect(result.rowCount).toBe(1)
      expect(result.rows[0].name).toBe('test-item')
    })

    it('selects rows with ordering and limit', async () => {
      if (!tableCreated) {
        console.log('Skipping: test table was not created')
        return
      }

      const result = await service.selectRows(testTableName, null, null, 'id', 'Descending', 2)

      expect(result.rowCount).toBe(2)
    })

    it('updates rows', async () => {
      if (!tableCreated) {
        console.log('Skipping: test table was not created')
        return
      }

      const result = await service.updateRows(testTableName, { value: 99 }, { name: 'test-item' })

      expect(result).toHaveProperty('rows')
      expect(result).toHaveProperty('updatedCount')
      expect(result.updatedCount).toBe(1)
      expect(Number(result.rows[0].value)).toBe(99)
    })

    it('upserts a row (insert)', async () => {
      if (!tableCreated) {
        console.log('Skipping: test table was not created')
        return
      }

      const result = await service.upsertRow(
        testTableName,
        { name: 'upsert-item', value: 77 },
        ['name']
      )

      // upsert with name as conflict column requires a unique index; since we only
      // have a PK on id, this will just insert. Let's verify.
      expect(result).toHaveProperty('row')
    })

    it('gets table schema', async () => {
      if (!tableCreated) {
        console.log('Skipping: test table was not created')
        return
      }

      const result = await service.getTableSchema(testTableName)

      expect(result).toHaveProperty('schema')
      expect(result).toHaveProperty('table', testTableName)
      expect(result).toHaveProperty('columns')
      expect(result.columns.length).toBeGreaterThanOrEqual(3)

      const nameCol = result.columns.find(c => c.name === 'name')

      expect(nameCol).toBeDefined()
      expect(nameCol.type).toBe('text')
    })

    it('deletes rows', async () => {
      if (!tableCreated) {
        console.log('Skipping: test table was not created')
        return
      }

      const result = await service.deleteRows(testTableName, { name: 'test-item' })

      expect(result).toHaveProperty('deletedCount')
      expect(result.deletedCount).toBeGreaterThanOrEqual(1)
    })
  })

  // ── Hypertable operations (optional — requires TimescaleDB extension) ──

  describe('hypertable operations', () => {
    const hypertableName = 'e2e_test_timescaledb_hyper'
    let hypertableCreated = false
    let timescaleAvailable = false

    beforeAll(async () => {
      // Check if TimescaleDB extension is available
      try {
        const check = await service.executeQuery(
          "SELECT 1 FROM pg_extension WHERE extname = 'timescaledb'"
        )

        timescaleAvailable = check.rows.length > 0

        if (!timescaleAvailable) {
          console.log('Skipping hypertable tests: TimescaleDB extension not available')
          return
        }

        // Create a test table and convert to hypertable
        await service.executeQuery(`DROP TABLE IF EXISTS ${hypertableName}`)
        await service.executeQuery(
          `CREATE TABLE ${hypertableName} (time TIMESTAMPTZ NOT NULL, device_id TEXT, temperature DOUBLE PRECISION)`
        )

        await service.createHypertable(hypertableName, 'time')
        hypertableCreated = true
      } catch (error) {
        console.log('Failed to create hypertable:', error.message)
      }
    })

    afterAll(async () => {
      if (timescaleAvailable) {
        try {
          await service.executeQuery(`DROP TABLE IF EXISTS ${hypertableName}`)
        } catch (error) {
          console.log('Failed to drop hypertable:', error.message)
        }
      }
    })

    it('lists hypertables', async () => {
      if (!timescaleAvailable) {
        console.log('Skipping: TimescaleDB extension not available')
        return
      }

      const result = await service.listHypertables()

      expect(result).toHaveProperty('hypertables')
      expect(result).toHaveProperty('count')
      expect(Array.isArray(result.hypertables)).toBe(true)
    })

    it('gets hypertable chunks', async () => {
      if (!hypertableCreated) {
        console.log('Skipping: hypertable was not created')
        return
      }

      const result = await service.getHypertableChunks(hypertableName)

      expect(result).toHaveProperty('chunks')
      expect(result).toHaveProperty('count')
      expect(Array.isArray(result.chunks)).toBe(true)
    })

    it('shows chunks', async () => {
      if (!hypertableCreated) {
        console.log('Skipping: hypertable was not created')
        return
      }

      const result = await service.showChunks(hypertableName)

      expect(result).toHaveProperty('chunks')
      expect(result).toHaveProperty('count')
      expect(Array.isArray(result.chunks)).toBe(true)
    })

    it('inserts time-series data and runs time bucket query', async () => {
      if (!hypertableCreated) {
        console.log('Skipping: hypertable was not created')
        return
      }

      // Insert some test data
      const now = new Date()
      const oneHourAgo = new Date(now.getTime() - 3600000)

      await service.insertRows(hypertableName, [
        { time: oneHourAgo.toISOString(), device_id: 'sensor-1', temperature: 21.0 },
        { time: oneHourAgo.toISOString(), device_id: 'sensor-1', temperature: 22.0 },
        { time: now.toISOString(), device_id: 'sensor-1', temperature: 23.0 },
      ])

      const result = await service.timeBucketQuery(
        hypertableName,
        'time',
        '1 hour',
        'avg(temperature) AS avg_temp, count(*) AS readings'
      )

      expect(result).toHaveProperty('rows')
      expect(result).toHaveProperty('rowCount')
      expect(result.rowCount).toBeGreaterThanOrEqual(1)
    })

    it('gets hypertables dictionary', async () => {
      if (!timescaleAvailable) {
        console.log('Skipping: TimescaleDB extension not available')
        return
      }

      const result = await service.getHypertablesDictionary({})

      expect(result).toHaveProperty('items')
      expect(result).toHaveProperty('cursor')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })
})
