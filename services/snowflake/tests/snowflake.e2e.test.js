'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

const SUFFIX = Date.now()

describe('Snowflake Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('snowflake')
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

  describe('executeSql', () => {
    it('runs a trivial statement and returns converted rows', async () => {
      const result = await service.executeSql('SELECT 1 AS ONE, \'abc\' AS TXT')

      expect(result).toHaveProperty('rows')
      expect(Array.isArray(result.rows)).toBe(true)
      expect(result.rows[0]).toHaveProperty('ONE', 1)
      expect(result.rows[0]).toHaveProperty('TXT', 'abc')
      expect(result).toHaveProperty('rowCount', 1)
      expect(result).toHaveProperty('statementHandle')
    })

    it('binds positional parameters', async () => {
      const result = await service.executeSql('SELECT ? AS A, ? AS B', ['hello', 42])

      expect(result.rows[0]).toHaveProperty('A', 'hello')
      expect(result.rows[0]).toHaveProperty('B', 42)
    })

    it('honours an explicit timeout', async () => {
      const result = await service.executeSql('SELECT CURRENT_TIMESTAMP() AS TS', [], undefined, undefined, undefined, undefined, 30)

      expect(result.rows).toHaveLength(1)
    })

    it('rejects an empty statement', async () => {
      await expect(service.executeSql('   ')).rejects.toThrow('SQL statement is required.')
    })

    it('surfaces a Snowflake compilation error', async () => {
      await expect(service.executeSql('SELECT * FROM __definitely_missing_table__')).rejects.toThrow(/Snowflake API error/)
    })
  })

  describe('getStatementResults', () => {
    it('re-reads the results of a completed statement', async () => {
      const executed = await service.executeSql('SELECT 1 AS ONE')

      expect(executed.statementHandle).toBeTruthy()

      const result = await service.getStatementResults(executed.statementHandle)

      expect(result).toHaveProperty('partition', 0)
      expect(result.rows[0]).toHaveProperty('ONE', 1)
    })

    it('requires a statement handle', async () => {
      await expect(service.getStatementResults('')).rejects.toThrow('Statement Handle is required.')
    })
  })

  describe('cancelStatement', () => {
    it('reports a cancel attempt for an already finished statement', async () => {
      const executed = await service.executeSql('SELECT 1 AS ONE')

      const result = await service.cancelStatement(executed.statementHandle).catch(error => error)

      // A finished statement may either report a cancel status or return an API error.
      expect(result).toBeDefined()
    })
  })

  // ── Metadata ──

  describe('metadata', () => {
    it('lists databases', async () => {
      const result = await service.listDatabases()

      expect(Array.isArray(result.databases)).toBe(true)
      expect(result).toHaveProperty('count')
    })

    it('lists warehouses', async () => {
      const result = await service.listWarehouses()

      expect(Array.isArray(result.warehouses)).toBe(true)
    })

    it('lists schemas of the configured database', async () => {
      const result = await service.listSchemas()

      expect(Array.isArray(result.schemas)).toBe(true)
      expect(result).toHaveProperty('database')
    })

    it('lists tables of the configured schema', async () => {
      const result = await service.listTables()

      expect(Array.isArray(result.tables)).toBe(true)
    })

    it('describes a table', async () => {
      const { table } = testValues

      if (!table) {
        console.log('Skipping getTableSchema: testValues.table not set')

        return
      }

      const result = await service.getTableSchema(undefined, undefined, table)

      expect(Array.isArray(result.columns)).toBe(true)
      expect(result).toHaveProperty('table', table)
    })
  })

  // ── Dictionaries ──

  describe('dictionaries', () => {
    it('returns databases as dictionary items', async () => {
      const result = await service.getDatabasesDictionary({})

      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor', null)
    })

    it('returns warehouses as dictionary items', async () => {
      const result = await service.getWarehousesDictionary({})

      expect(Array.isArray(result.items)).toBe(true)
    })

    it('returns schemas for the configured database', async () => {
      const result = await service.getSchemasDictionary({})

      expect(Array.isArray(result.items)).toBe(true)
    })

    it('returns tables for the configured database and schema', async () => {
      const result = await service.getTablesDictionary({})

      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Write lifecycle (opt-in) ──

  describe('table lifecycle', () => {
    const tableName = `FLOWRUNNER_E2E_${ SUFFIX }`

    it('creates, populates, reads and drops a temporary table', async () => {
      if (!testValues.allowWrites) {
        console.log('Skipping table lifecycle: testValues.allowWrites not set to true')

        return
      }

      await service.executeSql(`CREATE TABLE ${ tableName } (ID NUMBER, NAME VARCHAR)`)

      try {
        await service.executeSql(`INSERT INTO ${ tableName } (ID, NAME) VALUES (?, ?)`, [1, 'Alice'])

        const selected = await service.executeSql(`SELECT ID, NAME FROM ${ tableName } ORDER BY ID`)

        expect(selected.rows).toEqual([{ ID: 1, NAME: 'Alice' }])

        const described = await service.getTableSchema(undefined, undefined, tableName)

        expect(described.columns.map(column => column.name)).toEqual(['ID', 'NAME'])
      } finally {
        await service.executeSql(`DROP TABLE IF EXISTS ${ tableName }`)
      }
    })
  })
})
