'use strict'

const { createSandbox } = require('../../../service-sandbox')

// The service talks to SQL Server through the `mssql` driver rather than
// Flowrunner.Request, so the driver is mocked virtually (the package is not
// installed in this workspace).
let mockPools = []
let mockQueryImpl = () => ({ recordset: [], rowsAffected: [] })
let mockConnectError = null
let mockCloseError = null
let mockParseConnectionString = () => ({
  server: 'db.example.com',
  port: 1433,
  database: 'mydb',
  user: 'myuser',
  password: 'mypassword',
  options: { encrypt: true },
})

jest.mock(
  'mssql',
  () => {
    class ConnectionPool {
      static parseConnectionString(connectionString) {
        return mockParseConnectionString(connectionString)
      }

      constructor(config) {
        this.config = config
        this.queries = []
        this.connected = false
        this.closed = false

        mockPools.push(this)
      }

      async connect() {
        if (mockConnectError) {
          throw mockConnectError
        }

        this.connected = true
      }

      request() {
        const pool = this
        const params = []

        const request = {
          input(name, value) {
            params.push({ name, value })

            return request
          },

          async query(sqlText) {
            pool.queries.push({ sql: sqlText, params })

            return mockQueryImpl(sqlText, params)
          },
        }

        return request
      }

      async close() {
        if (mockCloseError) {
          throw mockCloseError
        }

        this.closed = true
      }
    }

    return { ConnectionPool }
  },
  { virtual: true }
)

const BASE_CONFIG = {
  host: 'db.example.com',
  database: 'app',
  user: 'admin',
  password: 'secret',
}

/** Collapses whitespace so multi-line SQL can be compared reliably. */
function sql(text) {
  return text.replace(/\s+/g, ' ').trim()
}

function lastPool() {
  return mockPools[mockPools.length - 1]
}

function lastQuery() {
  return lastPool().queries[0]
}

/** Ordered list of bound parameter values, as passed to request.input(). */
function boundValues() {
  return lastQuery().params.map(param => param.value)
}

/** Ordered list of bound parameter names, as passed to request.input(). */
function boundNames() {
  return lastQuery().params.map(param => param.name)
}

describe('Microsoft SQL Server Service', () => {
  let sandbox
  let service

  /** Builds a fresh service instance with the given service configuration. */
  function build(config = BASE_CONFIG) {
    if (sandbox) {
      sandbox.cleanup()
    }

    jest.resetModules()

    sandbox = createSandbox(config)
    require('../src/index.js')

    service = sandbox.getService()

    return service
  }

  beforeEach(() => {
    mockPools = []
    mockConnectError = null
    mockCloseError = null
    mockQueryImpl = () => ({ recordset: [], rowsAffected: [] })

    mockParseConnectionString = () => ({
      server: 'db.example.com',
      port: 1433,
      database: 'mydb',
      user: 'myuser',
      password: 'mypassword',
      options: { encrypt: true },
    })

    build()
  })

  afterEach(() => {
    sandbox.cleanup()
    sandbox = null
  })

  // ── Registration ──

  describe('service registration', () => {
    it('registers every connection config item as optional and non-shared', () => {
      const items = sandbox.getConfigItems()

      expect(items.map(item => item.name)).toEqual([
        'connectionString',
        'host',
        'port',
        'database',
        'user',
        'password',
        'encrypt',
        'trustServerCertificate',
        'connectionTimeoutSeconds',
      ])

      items.forEach(item => {
        expect(item.required).toBe(false)
        expect(item.shared).toBe(false)
        expect(typeof item.hint).toBe('string')
      })

      expect(items.find(item => item.name === 'encrypt').type).toBe('BOOL')
      expect(items.find(item => item.name === 'encrypt').defaultValue).toBe(true)
      expect(items.find(item => item.name === 'trustServerCertificate').defaultValue).toBe(false)
      expect(items.find(item => item.name === 'port').defaultValue).toBe('1433')
      expect(items.find(item => item.name === 'connectionTimeoutSeconds').defaultValue).toBe('15')
    })
  })

  // ── Connection configuration ──

  describe('connection configuration', () => {
    it('builds a pool config from the individual fields with defaults', async () => {
      await service.listTables()

      expect(mockPools).toHaveLength(1)

      expect(mockPools[0].config).toEqual({
        server: 'db.example.com',
        port: 1433,
        database: 'app',
        user: 'admin',
        password: 'secret',
        options: { encrypt: false, trustServerCertificate: false },
        connectionTimeout: 15000,
        requestTimeout: 120000,
        pool: { max: 1, min: 0 },
      })

      expect(mockPools[0].connected).toBe(true)
      expect(mockPools[0].closed).toBe(true)
    })

    it('honours the port, the TLS toggles and the connection timeout', async () => {
      build({
        ...BASE_CONFIG,
        port: '14330',
        encrypt: 'true',
        trustServerCertificate: true,
        connectionTimeoutSeconds: '45',
      })

      await service.listTables()

      expect(mockPools[0].config).toMatchObject({
        port: 14330,
        options: { encrypt: true, trustServerCertificate: true },
        connectionTimeout: 45000,
      })
    })

    it('falls back to the defaults for unparsable port and timeout values', async () => {
      build({ ...BASE_CONFIG, port: 'abc', connectionTimeoutSeconds: '0' })

      await service.listTables()

      expect(mockPools[0].config).toMatchObject({ port: 1433, connectionTimeout: 15000 })
    })

    it('prefers the trimmed connection string over the individual fields', async () => {
      const seen = []

      mockParseConnectionString = connectionString => {
        seen.push(connectionString)

        return { server: 'from-string', database: 'sdb', connectionTimeout: 5000 }
      }

      build({ ...BASE_CONFIG, connectionString: '  Server=from-string;Database=sdb  ' })

      await service.listTables()

      expect(seen).toEqual(['Server=from-string;Database=sdb'])

      // The string's own connection timeout wins over the configured default.
      expect(mockPools[0].config).toEqual({
        server: 'from-string',
        database: 'sdb',
        connectionTimeout: 5000,
        requestTimeout: 120000,
        pool: { max: 1, min: 0 },
      })
    })

    it('applies the configured timeout when the connection string omits one', async () => {
      mockParseConnectionString = () => ({ server: 'from-string' })

      build({ connectionString: 'Server=from-string', connectionTimeoutSeconds: '20' })

      await service.listTables()

      expect(mockPools[0].config).toMatchObject({ connectionTimeout: 20000 })
    })

    it('throws a helpful error when the connection string cannot be parsed', async () => {
      mockParseConnectionString = () => {
        throw new Error('unexpected token')
      }

      build({ connectionString: 'nonsense' })

      await expect(service.listTables()).rejects.toThrow(/the Connection String could not be parsed/)
      expect(mockPools).toHaveLength(0)
    })

    it('throws when the connection string specifies no server', async () => {
      mockParseConnectionString = () => ({ database: 'mydb' })

      build({ connectionString: 'Database=mydb' })

      await expect(service.listTables()).rejects.toThrow(
        /the Connection String does not specify a server/
      )

      expect(mockPools).toHaveLength(0)
    })

    it('throws when neither a connection string nor the required fields are set', async () => {
      build({})

      await expect(service.listTables()).rejects.toThrow(/incomplete connection configuration/)
      expect(mockPools).toHaveLength(0)
    })

    it('closes the pool even when the query fails', async () => {
      mockQueryImpl = () => {
        throw new Error('boom')
      }

      await expect(service.listTables()).rejects.toThrow('Microsoft SQL Server error: boom')
      expect(mockPools[0].closed).toBe(true)
    })

    it('does not mask the original error when closing the pool fails', async () => {
      mockCloseError = new Error('close failed')

      const result = await service.listTables()

      expect(result).toEqual({ tables: [], count: 0 })
    })

    it('wraps connection failures', async () => {
      mockConnectError = Object.assign(new Error('Login failed'), { code: 'ELOGIN', number: 18456 })

      await expect(service.listTables()).rejects.toThrow(
        'Microsoft SQL Server error: Login failed | code: ELOGIN | number: 18456'
      )
    })

    it('adds an IPv6 hint for a nested ENETUNREACH socket error', async () => {
      const socketError = Object.assign(new Error('connect ENETUNREACH'), {
        code: 'ENETUNREACH',
        address: '2600:1f18::1',
      })

      mockConnectError = Object.assign(new Error('Failed to connect'), {
        originalError: Object.assign(new Error('wrapper'), { originalError: socketError }),
      })

      await expect(service.listTables()).rejects.toThrow(/IPv6-only address/)
    })

    it('adds an IPv6 hint when the message itself mentions ENETUNREACH', async () => {
      mockConnectError = new Error('connect ENETUNREACH 2600:1f18::1:1433')

      await expect(service.listTables()).rejects.toThrow(/IPv6-only address/)
    })

    it('includes the line number when the driver reports one', async () => {
      mockQueryImpl = () => {
        throw Object.assign(new Error('Incorrect syntax'), { number: 102, lineNumber: 3 })
      }

      await expect(service.executeQuery('SELECT')).rejects.toThrow(
        'Microsoft SQL Server error: Incorrect syntax | number: 102 | line: 3'
      )
    })
  })

  // ── SQL ──

  describe('executeQuery', () => {
    it('runs the statement with positional parameters bound as @p1..@pn', async () => {
      mockQueryImpl = () => ({ recordset: [{ id: 1, name: 'Ada' }], rowsAffected: [1] })

      const result = await service.executeQuery('SELECT * FROM Users WHERE email = @p1 AND age > @p2', [
        'ada@example.com',
        30,
      ])

      expect(result).toEqual({ recordset: [{ id: 1, name: 'Ada' }], rowsAffected: [1] })
      expect(lastQuery().sql).toBe('SELECT * FROM Users WHERE email = @p1 AND age > @p2')
      expect(boundNames()).toEqual(['p1', 'p2'])
      expect(boundValues()).toEqual(['ada@example.com', 30])
    })

    it('defaults missing results to empty collections', async () => {
      mockQueryImpl = () => ({})

      const result = await service.executeQuery('SELECT 1')

      expect(result).toEqual({ recordset: [], rowsAffected: [] })
      expect(boundValues()).toEqual([])
    })

    it('ignores a non-array parameters value', async () => {
      await service.executeQuery('SELECT 1', 'not-an-array')

      expect(boundValues()).toEqual([])
    })

    it('rejects an empty statement without opening a connection', async () => {
      await expect(service.executeQuery('   ')).rejects.toThrow('SQL statement is required.')
      await expect(service.executeQuery(null)).rejects.toThrow('SQL statement is required.')

      expect(mockPools).toHaveLength(0)
    })
  })

  // ── Rows ──

  describe('selectRows', () => {
    it('selects every column from a dbo-qualified table by default', async () => {
      mockQueryImpl = () => ({ recordset: [{ id: 1 }] })

      const result = await service.selectRows('Users')

      expect(result).toEqual({ rows: [{ id: 1 }], rowCount: 1 })
      expect(lastQuery().sql).toBe('SELECT * FROM [dbo].[Users]')
      expect(boundValues()).toEqual([])
    })

    it('honours an explicit schema and a column list', async () => {
      await service.selectRows('sales.Orders', ['id', 'total'])

      expect(lastQuery().sql).toBe('SELECT [id], [total] FROM [sales].[Orders]')
    })

    it('escapes closing brackets in identifiers', async () => {
      await service.selectRows('we[i]rd.Ta]ble', ['co]l'])

      expect(lastQuery().sql).toBe('SELECT [co]]l] FROM [we[i]]rd].[Ta]]ble]')
    })

    it('builds equality, IS NULL and IN conditions', async () => {
      await service.selectRows('Users', null, {
        status: 'active',
        deleted_at: null,
        role: ['admin', 'editor'],
      })

      expect(lastQuery().sql).toBe(
        'SELECT * FROM [dbo].[Users] WHERE [status] = @p1 AND [deleted_at] IS NULL AND [role] IN (@p2, @p3)'
      )

      expect(boundValues()).toEqual(['active', 'admin', 'editor'])
    })

    it('renders an empty array condition as a never-matching clause', async () => {
      await service.selectRows('Users', null, { role: [] })

      expect(lastQuery().sql).toBe('SELECT * FROM [dbo].[Users] WHERE 1 = 0')
      expect(boundValues()).toEqual([])
    })

    it('applies ordering with the mapped sort direction', async () => {
      await service.selectRows('Users', null, null, 'name', 'Descending')

      expect(lastQuery().sql).toBe('SELECT * FROM [dbo].[Users] ORDER BY [name] DESC')
    })

    it('defaults the sort direction to ascending', async () => {
      await service.selectRows('Users', null, null, 'name')

      expect(lastQuery().sql).toBe('SELECT * FROM [dbo].[Users] ORDER BY [name] ASC')
    })

    it('passes an unmapped sort direction through', async () => {
      await service.selectRows('Users', null, null, 'name', 'DESC')

      expect(lastQuery().sql).toBe('SELECT * FROM [dbo].[Users] ORDER BY [name] DESC')
    })

    it('uses TOP when only a limit is given', async () => {
      await service.selectRows('Users', null, { status: 'active' }, null, null, 10)

      expect(lastQuery().sql).toBe(
        'SELECT TOP (@p2) * FROM [dbo].[Users] WHERE [status] = @p1'
      )

      expect(boundValues()).toEqual(['active', 10])
    })

    it('uses OFFSET/FETCH and a fallback ordering when an offset is given', async () => {
      await service.selectRows('Users', null, null, null, null, 10, 20)

      expect(lastQuery().sql).toBe(
        'SELECT * FROM [dbo].[Users] ORDER BY (SELECT NULL) OFFSET @p1 ROWS FETCH NEXT @p2 ROWS ONLY'
      )

      expect(boundValues()).toEqual([20, 10])
    })

    it('uses OFFSET without FETCH when no limit is given', async () => {
      await service.selectRows('Users', null, null, 'id', 'Ascending', null, 5)

      expect(lastQuery().sql).toBe(
        'SELECT * FROM [dbo].[Users] ORDER BY [id] ASC OFFSET @p1 ROWS'
      )

      expect(boundValues()).toEqual([5])
    })

    it('treats empty-string limit and offset as absent', async () => {
      await service.selectRows('Users', null, null, null, null, '', '')

      expect(lastQuery().sql).toBe('SELECT * FROM [dbo].[Users]')
    })

    it('rejects an empty table name and an invalid column name', async () => {
      await expect(service.selectRows('')).rejects.toThrow(
        'Table name is required and must be a non-empty string.'
      )

      await expect(service.selectRows(null)).rejects.toThrow(
        'Table name is required and must be a non-empty string.'
      )

      await expect(service.selectRows('Users', ['  '])).rejects.toThrow(/Invalid identifier/)

      expect(mockPools).toHaveLength(0)
    })
  })

  describe('insertRow', () => {
    it('inserts the column/value pairs and returns the OUTPUT row', async () => {
      mockQueryImpl = () => ({ recordset: [{ id: 1, name: 'Ada' }], rowsAffected: [1] })

      const result = await service.insertRow('dbo.Users', { name: 'Ada', email: 'ada@example.com' })

      expect(result).toEqual({ row: { id: 1, name: 'Ada' } })

      expect(lastQuery().sql).toBe(
        'INSERT INTO [dbo].[Users] ([name], [email]) OUTPUT INSERTED.* VALUES (@p1, @p2)'
      )

      expect(boundValues()).toEqual(['Ada', 'ada@example.com'])
    })

    it('returns null when nothing is output', async () => {
      mockQueryImpl = () => ({ recordset: [] })

      const result = await service.insertRow('Users', { name: 'Ada' })

      expect(result).toEqual({ row: null })
    })

    it('rejects empty or non-object data', async () => {
      await expect(service.insertRow('Users', {})).rejects.toThrow('Data must be a non-empty object.')
      await expect(service.insertRow('Users', null)).rejects.toThrow('Data must be a non-empty object.')

      await expect(service.insertRow('Users', [{ a: 1 }])).rejects.toThrow(
        'Data must be a non-empty object.'
      )

      expect(mockPools).toHaveLength(0)
    })
  })

  describe('insertRows', () => {
    it('inserts the union of columns and pads missing keys with NULL', async () => {
      mockQueryImpl = () => ({
        recordset: [{ id: 1, name: 'Ada', age: null }, { id: 2, name: 'Linus', age: 30 }],
        rowsAffected: [2],
      })

      const result = await service.insertRows('Users', [{ name: 'Ada' }, { name: 'Linus', age: 30 }])

      expect(result.insertedCount).toBe(2)
      expect(result.rows).toHaveLength(2)

      expect(lastQuery().sql).toBe(
        'INSERT INTO [dbo].[Users] ([name], [age]) OUTPUT INSERTED.* VALUES (@p1, @p2), (@p3, @p4)'
      )

      expect(boundValues()).toEqual(['Ada', null, 'Linus', 30])
    })

    it('falls back to the returned row count when rowsAffected is absent', async () => {
      mockQueryImpl = () => ({ recordset: [{ id: 1 }] })

      const result = await service.insertRows('Users', [{ name: 'Ada' }])

      expect(result.insertedCount).toBe(1)
    })

    it('rejects a non-array or empty rows argument', async () => {
      await expect(service.insertRows('Users', [])).rejects.toThrow(
        'Rows must be a non-empty array of objects.'
      )

      await expect(service.insertRows('Users', null)).rejects.toThrow(
        'Rows must be a non-empty array of objects.'
      )

      expect(mockPools).toHaveLength(0)
    })

    it('reports which row object is invalid', async () => {
      await expect(service.insertRows('Users', [{ name: 'Ada' }, {}])).rejects.toThrow(
        'Rows[1] must be a non-empty object.'
      )
    })
  })

  describe('updateRows', () => {
    it('updates the matching rows and returns the OUTPUT rows', async () => {
      mockQueryImpl = () => ({ recordset: [{ id: 1, status: 'archived' }], rowsAffected: [1] })

      const result = await service.updateRows('Users', { status: 'archived' }, { status: 'active' })

      expect(result).toEqual({ rows: [{ id: 1, status: 'archived' }], updatedCount: 1 })

      expect(lastQuery().sql).toBe(
        'UPDATE [dbo].[Users] SET [status] = @p1 OUTPUT INSERTED.* WHERE [status] = @p2'
      )

      expect(boundValues()).toEqual(['archived', 'active'])
    })

    it('falls back to the returned row count when rowsAffected is absent', async () => {
      mockQueryImpl = () => ({ recordset: [{ id: 1 }, { id: 2 }] })

      const result = await service.updateRows('Users', { a: 1 }, { b: 2 })

      expect(result.updatedCount).toBe(2)
    })

    it('requires a non-empty Where object to prevent a full-table update', async () => {
      await expect(service.updateRows('Users', { a: 1 }, {})).rejects.toThrow(
        'Where must be a non-empty object.'
      )

      await expect(service.updateRows('Users', { a: 1 }, null)).rejects.toThrow(
        'Where must be a non-empty object.'
      )

      await expect(service.updateRows('Users', {}, { b: 2 })).rejects.toThrow(
        'Data must be a non-empty object.'
      )

      expect(mockPools).toHaveLength(0)
    })
  })

  describe('deleteRows', () => {
    it('deletes the matching rows and returns the count', async () => {
      mockQueryImpl = () => ({ rowsAffected: [3] })

      const result = await service.deleteRows('Users', { status: 'archived' })

      expect(result).toEqual({ deletedCount: 3 })
      expect(lastQuery().sql).toBe('DELETE FROM [dbo].[Users] WHERE [status] = @p1')
      expect(boundValues()).toEqual(['archived'])
    })

    it('reports zero when the driver returns no counts', async () => {
      mockQueryImpl = () => ({})

      const result = await service.deleteRows('Users', { id: 1 })

      expect(result).toEqual({ deletedCount: 0 })
    })

    it('never issues an unconditional DELETE', async () => {
      await expect(service.deleteRows('Users', {})).rejects.toThrow(
        'Where must be a non-empty object.'
      )

      await expect(service.deleteRows('Users', null)).rejects.toThrow(
        'Where must be a non-empty object.'
      )

      await expect(service.deleteRows('Users', undefined)).rejects.toThrow(
        'Where must be a non-empty object.'
      )

      await expect(service.deleteRows('Users', [])).rejects.toThrow(
        'Where must be a non-empty object.'
      )

      await expect(service.deleteRows('Users', 'all')).rejects.toThrow(
        'Where must be a non-empty object.'
      )

      expect(mockPools).toHaveLength(0)
    })

    it('still binds a WHERE clause for an empty-array condition', async () => {
      mockQueryImpl = () => ({ rowsAffected: [0] })

      await service.deleteRows('Users', { id: [] })

      expect(lastQuery().sql).toBe('DELETE FROM [dbo].[Users] WHERE 1 = 0')
    })
  })

  describe('upsertRow', () => {
    it('builds a MERGE statement keyed on the key columns', async () => {
      mockQueryImpl = () => ({ recordset: [{ id: 1, email: 'ada@example.com', name: 'Ada' }] })

      const result = await service.upsertRow(
        'Users',
        { email: 'ada@example.com', name: 'Ada' },
        ['email']
      )

      expect(result).toEqual({ row: { id: 1, email: 'ada@example.com', name: 'Ada' } })

      expect(sql(lastQuery().sql)).toBe(
        sql(`MERGE [dbo].[Users] AS [target]
             USING (SELECT @p1 AS [email], @p2 AS [name]) AS [source]
             ON ([target].[email] = [source].[email])
             WHEN MATCHED THEN UPDATE SET [target].[name] = [source].[name]
             WHEN NOT MATCHED THEN INSERT ([email], [name]) VALUES ([source].[email], [source].[name])
             OUTPUT INSERTED.*;`)
      )

      expect(boundValues()).toEqual(['ada@example.com', 'Ada'])
    })

    it('falls back to a no-op assignment when only key columns are supplied', async () => {
      mockQueryImpl = () => ({ recordset: [] })

      const result = await service.upsertRow('Users', { email: 'ada@example.com' }, ['email'])

      expect(result).toEqual({ row: null })

      expect(lastQuery().sql).toContain(
        'WHEN MATCHED THEN UPDATE SET [target].[email] = [source].[email]'
      )
    })

    it('supports composite key columns', async () => {
      await service.upsertRow('Users', { a: 1, b: 2, c: 3 }, ['a', 'b'])

      expect(lastQuery().sql).toContain(
        'ON ([target].[a] = [source].[a] AND [target].[b] = [source].[b])'
      )

      expect(lastQuery().sql).toContain('UPDATE SET [target].[c] = [source].[c]')
    })

    it('rejects missing key columns and data', async () => {
      await expect(service.upsertRow('Users', { a: 1 }, [])).rejects.toThrow(
        'Key Columns must be a non-empty array of column names.'
      )

      await expect(service.upsertRow('Users', { a: 1 }, null)).rejects.toThrow(
        'Key Columns must be a non-empty array of column names.'
      )

      await expect(service.upsertRow('Users', {}, ['a'])).rejects.toThrow(
        'Data must be a non-empty object.'
      )

      expect(mockPools).toHaveLength(0)
    })

    it('rejects key columns that are absent from the data', async () => {
      await expect(service.upsertRow('Users', { name: 'Ada' }, ['email', 'tenant'])).rejects.toThrow(
        'Data must include values for all key columns. Missing: email, tenant.'
      )
    })
  })

  // ── Schema ──

  describe('getTableSchema', () => {
    it('maps INFORMATION_SCHEMA.COLUMNS rows onto a column list', async () => {
      mockQueryImpl = () => ({
        recordset: [
          {
            COLUMN_NAME: 'id',
            DATA_TYPE: 'int',
            IS_NULLABLE: 'NO',
            COLUMN_DEFAULT: null,
            CHARACTER_MAXIMUM_LENGTH: null,
            ORDINAL_POSITION: 1,
          },
          {
            COLUMN_NAME: 'email',
            DATA_TYPE: 'nvarchar',
            IS_NULLABLE: 'YES',
            COLUMN_DEFAULT: "('')",
            CHARACTER_MAXIMUM_LENGTH: 255,
            ORDINAL_POSITION: 2,
          },
        ],
      })

      const result = await service.getTableSchema('sales.Orders')

      expect(result).toEqual({
        schema: 'sales',
        table: 'Orders',
        columns: [
          { name: 'id', type: 'int', nullable: false, default: null, maxLength: null, position: 1 },
          { name: 'email', type: 'nvarchar', nullable: true, default: "('')", maxLength: 255, position: 2 },
        ],
      })

      expect(boundValues()).toEqual(['sales', 'Orders'])
      expect(sql(lastQuery().sql)).toContain('FROM INFORMATION_SCHEMA.COLUMNS')
    })

    it('defaults an unqualified table to the dbo schema', async () => {
      mockQueryImpl = () => ({ recordset: [{ COLUMN_NAME: 'id', ORDINAL_POSITION: 1 }] })

      const result = await service.getTableSchema('Users')

      expect(result.schema).toBe('dbo')
      expect(boundValues()).toEqual(['dbo', 'Users'])
    })

    it('throws when the table has no columns', async () => {
      mockQueryImpl = () => ({ recordset: [] })

      await expect(service.getTableSchema('dbo.Missing')).rejects.toThrow(
        'Microsoft SQL Server error: Table "dbo.Missing" was not found or has no columns.'
      )
    })

    it('rejects an empty table name', async () => {
      await expect(service.getTableSchema('')).rejects.toThrow(
        'Table name is required and must be a non-empty string.'
      )
    })
  })

  describe('listTables', () => {
    it('returns base tables with their schema and a count', async () => {
      mockQueryImpl = () => ({
        recordset: [
          { TABLE_SCHEMA: 'dbo', TABLE_NAME: 'Users' },
          { TABLE_SCHEMA: 'sales', TABLE_NAME: 'Orders' },
        ],
      })

      const result = await service.listTables()

      expect(result).toEqual({
        tables: [
          { schema: 'dbo', name: 'Users' },
          { schema: 'sales', name: 'Orders' },
        ],
        count: 2,
      })

      expect(sql(lastQuery().sql)).toBe(
        "SELECT TABLE_SCHEMA, TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_SCHEMA, TABLE_NAME"
      )

      expect(boundValues()).toEqual([])
    })

    it('returns an empty list when the driver returns no recordset', async () => {
      mockQueryImpl = () => ({})

      await expect(service.listTables()).resolves.toEqual({ tables: [], count: 0 })
    })
  })

  // ── Dictionaries ──

  describe('getTablesDictionary', () => {
    it('returns schema-qualified values with a type note', async () => {
      mockQueryImpl = () => ({
        recordset: [{ TABLE_SCHEMA: 'dbo', TABLE_NAME: 'Users', TABLE_TYPE: 'BASE TABLE' }],
      })

      const result = await service.getTablesDictionary({})

      expect(result).toEqual({
        items: [{ label: 'Users', value: 'dbo.Users', note: 'dbo · BASE TABLE' }],
        cursor: null,
      })

      expect(boundValues()).toEqual([null, 0, 201])
    })

    it('handles a null payload', async () => {
      mockQueryImpl = () => ({ recordset: [] })

      await expect(service.getTablesDictionary(null)).resolves.toEqual({ items: [], cursor: null })
      expect(boundValues()).toEqual([null, 0, 201])
    })

    it('binds the search text as a LIKE pattern and honours the cursor', async () => {
      mockQueryImpl = () => ({ recordset: [] })

      await service.getTablesDictionary({ search: 'user', cursor: '200' })

      expect(boundValues()).toEqual(['%user%', 200, 201])
    })

    it('treats an unparsable cursor as offset 0', async () => {
      mockQueryImpl = () => ({ recordset: [] })

      await service.getTablesDictionary({ cursor: 'nope' })

      expect(boundValues()).toEqual([null, 0, 201])
    })

    it('trims the extra probe row and returns the next cursor', async () => {
      mockQueryImpl = () => ({
        recordset: Array.from({ length: 201 }, (_, index) => ({
          TABLE_SCHEMA: 'dbo',
          TABLE_NAME: `T${ index }`,
          TABLE_TYPE: 'BASE TABLE',
        })),
      })

      const result = await service.getTablesDictionary({ cursor: '200' })

      expect(result.items).toHaveLength(200)
      expect(result.cursor).toBe('400')
    })
  })

  describe('getColumnsDictionary', () => {
    it('returns an empty list without querying when no table criteria is given', async () => {
      await expect(service.getColumnsDictionary({})).resolves.toEqual({ items: [], cursor: null })
      await expect(service.getColumnsDictionary(null)).resolves.toEqual({ items: [], cursor: null })

      await expect(service.getColumnsDictionary({ criteria: {} })).resolves.toEqual({
        items: [],
        cursor: null,
      })

      expect(mockPools).toHaveLength(0)
    })

    it('lists the columns of the selected table with the data type as note', async () => {
      mockQueryImpl = () => ({
        recordset: [
          { COLUMN_NAME: 'email', DATA_TYPE: 'nvarchar' },
          { COLUMN_NAME: 'age', DATA_TYPE: 'int' },
        ],
      })

      const result = await service.getColumnsDictionary({ criteria: { table: 'sales.Orders' } })

      expect(result).toEqual({
        items: [
          { label: 'email', value: 'email', note: 'nvarchar' },
          { label: 'age', value: 'age', note: 'int' },
        ],
        cursor: null,
      })

      expect(boundValues()).toEqual(['sales', 'Orders', null])
    })

    it('binds the search text as a LIKE pattern', async () => {
      mockQueryImpl = () => ({ recordset: [] })

      await service.getColumnsDictionary({ search: 'ema', criteria: { table: 'Users' } })

      expect(boundValues()).toEqual(['dbo', 'Users', '%ema%'])
    })

    it('rejects an invalid table in the criteria', async () => {
      await expect(service.getColumnsDictionary({ criteria: { table: '   ' } })).rejects.toThrow(
        'Table name is required and must be a non-empty string.'
      )
    })
  })
})
