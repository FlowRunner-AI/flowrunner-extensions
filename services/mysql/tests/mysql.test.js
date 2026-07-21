'use strict'

// ============================================================================
//  MySQL Service — Unit Tests
//
//  The MySQL service uses the native `mysql2/promise` driver instead of
//  Flowrunner.Request, so we mock the entire `mysql2/promise` module with Jest.
// ============================================================================

const { createSandbox } = require('../../../service-sandbox')

// ---------------------------------------------------------------------------
//  Mock mysql2/promise driver — shared across all tests via jest.mock().
//  The `createConnection` mock is accessed via `mockCreateConnection` which
//  stays stable across jest.resetModules() calls.
// ---------------------------------------------------------------------------

const mockConnection = {
  query: jest.fn(),
  execute: jest.fn(),
  end: jest.fn().mockResolvedValue(undefined),
}

// A stable reference to the createConnection spy. We re-apply the mock
// after each resetModules, but always point it at this same function.
const mockCreateConnection = jest.fn().mockResolvedValue(mockConnection)

jest.mock('mysql2/promise', () => ({
  createConnection: mockCreateConnection,
}))

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------

function resetAllMocks() {
  mockConnection.query.mockReset()
  mockConnection.execute.mockReset()
  mockConnection.end.mockClear()
  mockCreateConnection.mockClear()
  mockCreateConnection.mockResolvedValue(mockConnection)
  mockConnection.end.mockResolvedValue(undefined)
}

function buildService(config) {
  const sandbox = createSandbox(config)

  jest.resetModules()

  jest.mock('mysql2/promise', () => ({
    createConnection: mockCreateConnection,
  }))

  require('../src/index.js')

  return {
    sandbox,
    service: sandbox.getService(),
  }
}

// ===========================================================================
//  Tests
// ===========================================================================

describe('MySQL Service', () => {
  let sandbox
  let service

  beforeEach(() => {
    resetAllMocks()
    ;({ sandbox, service } = buildService({
      host: 'db.example.com',
      port: '3306',
      database: 'testdb',
      user: 'root',
      password: 's3cret',
      ssl: false,
      connectionTimeoutSeconds: '10',
    }))
  })

  afterEach(() => {
    sandbox.cleanup()
  })

  // ── Registration ──

  describe('service registration', () => {
    it('registers with correct config items', () => {
      expect(sandbox.getConfigItems()).toEqual([
        expect.objectContaining({
          name: 'connectionString',
          displayName: 'Connection String',
          required: false,
          shared: false,
          type: 'STRING',
        }),
        expect.objectContaining({
          name: 'host',
          displayName: 'Host',
          required: false,
          shared: false,
          type: 'STRING',
        }),
        expect.objectContaining({
          name: 'port',
          displayName: 'Port',
          required: false,
          shared: false,
          defaultValue: '3306',
          type: 'STRING',
        }),
        expect.objectContaining({
          name: 'database',
          displayName: 'Database',
          required: false,
          shared: false,
          type: 'STRING',
        }),
        expect.objectContaining({
          name: 'user',
          displayName: 'User',
          required: false,
          shared: false,
          type: 'STRING',
        }),
        expect.objectContaining({
          name: 'password',
          displayName: 'Password',
          required: false,
          shared: false,
          type: 'STRING',
        }),
        expect.objectContaining({
          name: 'ssl',
          displayName: 'Use SSL/TLS',
          required: false,
          shared: false,
          defaultValue: false,
          type: 'BOOL',
        }),
        expect.objectContaining({
          name: 'connectionTimeoutSeconds',
          displayName: 'Connection Timeout (seconds)',
          required: false,
          shared: false,
          defaultValue: '10',
          type: 'STRING',
        }),
      ])
    })
  })

  // ── Connection configuration ──

  describe('connection configuration', () => {
    it('connects with individual fields when no connection string', async () => {
      mockConnection.query.mockResolvedValue([[{ n: 1 }], [{ name: 'n', type: 8 }]])

      await service.executeQuery('SELECT 1 AS n')

      expect(mockCreateConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          host: 'db.example.com',
          port: 3306,
          database: 'testdb',
          user: 'root',
          password: 's3cret',
          connectTimeout: 10000,
        })
      )
    })

    it('uses connection string when provided (takes precedence)', async () => {
      ;({ sandbox, service } = buildService({
        connectionString: 'mysql://user:pass@host:3306/mydb',
        host: 'other-host',
        database: 'otherdb',
        user: 'otheruser',
        password: 'otherpass',
      }))

      mockConnection.query.mockResolvedValue([[{ n: 1 }], [{ name: 'n', type: 8 }]])

      await service.executeQuery('SELECT 1 AS n')

      expect(mockCreateConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          uri: 'mysql://user:pass@host:3306/mydb',
        })
      )
      // Should NOT have individual fields when connection string is set
      const config = mockCreateConnection.mock.calls[0][0]

      expect(config).not.toHaveProperty('host')
      expect(config).not.toHaveProperty('database')
    })

    it('adds SSL config when ssl is enabled with connection string', async () => {
      ;({ sandbox, service } = buildService({
        connectionString: 'mysql://user:pass@host:3306/mydb',
        ssl: 'true',
      }))

      mockConnection.query.mockResolvedValue([[{ n: 1 }], [{ name: 'n', type: 8 }]])

      await service.executeQuery('SELECT 1 AS n')

      expect(mockCreateConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          ssl: { rejectUnauthorized: false },
        })
      )
    })

    it('adds SSL config when ssl is enabled with individual fields', async () => {
      ;({ sandbox, service } = buildService({
        host: 'db.example.com',
        database: 'testdb',
        user: 'root',
        password: 'pass',
        ssl: true,
      }))

      mockConnection.query.mockResolvedValue([[{ n: 1 }], [{ name: 'n', type: 8 }]])

      await service.executeQuery('SELECT 1 AS n')

      expect(mockCreateConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          ssl: { rejectUnauthorized: false },
        })
      )
    })

    it('does not include SSL when ssl is disabled', async () => {
      mockConnection.query.mockResolvedValue([[{ n: 1 }], [{ name: 'n', type: 8 }]])

      await service.executeQuery('SELECT 1 AS n')

      const config = mockCreateConnection.mock.calls[0][0]

      expect(config).not.toHaveProperty('ssl')
    })

    it('throws when host, database, and user are missing and no connection string', async () => {
      ;({ sandbox, service } = buildService({}))

      await expect(service.executeQuery('SELECT 1')).rejects.toThrow('incomplete connection configuration')
    })

    it('throws when host is missing', async () => {
      ;({ sandbox, service } = buildService({ database: 'testdb', user: 'root' }))

      await expect(service.executeQuery('SELECT 1')).rejects.toThrow('incomplete connection configuration')
    })

    it('throws when database is missing', async () => {
      ;({ sandbox, service } = buildService({ host: 'localhost', user: 'root' }))

      await expect(service.executeQuery('SELECT 1')).rejects.toThrow('incomplete connection configuration')
    })

    it('throws when user is missing', async () => {
      ;({ sandbox, service } = buildService({ host: 'localhost', database: 'testdb' }))

      await expect(service.executeQuery('SELECT 1')).rejects.toThrow('incomplete connection configuration')
    })

    it('uses default port 3306 when port is not specified', async () => {
      ;({ sandbox, service } = buildService({
        host: 'db.example.com',
        database: 'testdb',
        user: 'root',
        password: 'pass',
      }))

      mockConnection.query.mockResolvedValue([[{ n: 1 }], [{ name: 'n', type: 8 }]])

      await service.executeQuery('SELECT 1 AS n')

      expect(mockCreateConnection).toHaveBeenCalledWith(
        expect.objectContaining({ port: 3306 })
      )
    })

    it('uses default timeout of 10s when not configured', async () => {
      ;({ sandbox, service } = buildService({
        host: 'db.example.com',
        database: 'testdb',
        user: 'root',
        password: 'pass',
      }))

      mockConnection.query.mockResolvedValue([[{ n: 1 }], [{ name: 'n', type: 8 }]])

      await service.executeQuery('SELECT 1 AS n')

      expect(mockCreateConnection).toHaveBeenCalledWith(
        expect.objectContaining({ connectTimeout: 10000 })
      )
    })

    it('closes connection after successful operation', async () => {
      mockConnection.query.mockResolvedValue([[{ n: 1 }], [{ name: 'n', type: 8 }]])

      await service.executeQuery('SELECT 1 AS n')

      expect(mockConnection.end).toHaveBeenCalled()
    })

    it('closes connection even when operation fails', async () => {
      mockConnection.query.mockRejectedValue(new Error('query failed'))

      await expect(service.executeQuery('BAD SQL')).rejects.toThrow()

      expect(mockConnection.end).toHaveBeenCalled()
    })
  })

  // ── executeQuery ──

  describe('executeQuery', () => {
    it('executes a SELECT and returns rows, rowCount, fields', async () => {
      const rows = [{ id: 1, name: 'Ada' }]
      const fields = [{ name: 'id', type: 3 }, { name: 'name', type: 253 }]

      mockConnection.query.mockResolvedValue([rows, fields])

      const result = await service.executeQuery('SELECT * FROM users')

      expect(result).toEqual({
        rows: [{ id: 1, name: 'Ada' }],
        rowCount: 1,
        fields: [{ name: 'id', type: 3 }, { name: 'name', type: 253 }],
      })
    })

    it('passes parameters as array to query', async () => {
      mockConnection.query.mockResolvedValue([[{ id: 42 }], [{ name: 'id', type: 3 }]])

      await service.executeQuery('SELECT * FROM users WHERE id = ?', [42])

      expect(mockConnection.query).toHaveBeenCalledWith(
        'SELECT * FROM users WHERE id = ?',
        [42]
      )
    })

    it('uses empty array when params is not an array', async () => {
      mockConnection.query.mockResolvedValue([[{ n: 1 }], [{ name: 'n', type: 8 }]])

      await service.executeQuery('SELECT 1 AS n', 'not-an-array')

      expect(mockConnection.query).toHaveBeenCalledWith('SELECT 1 AS n', [])
    })

    it('uses empty array when params is undefined', async () => {
      mockConnection.query.mockResolvedValue([[{ n: 1 }], [{ name: 'n', type: 8 }]])

      await service.executeQuery('SELECT 1 AS n')

      expect(mockConnection.query).toHaveBeenCalledWith('SELECT 1 AS n', [])
    })

    it('returns affectedRows/insertId/changedRows for write statements', async () => {
      const resultInfo = { affectedRows: 1, insertId: 42, changedRows: 0 }

      mockConnection.query.mockResolvedValue([resultInfo, undefined])

      const result = await service.executeQuery('INSERT INTO users (name) VALUES (?)', ['Ada'])

      expect(result).toEqual({
        affectedRows: 1,
        insertId: 42,
        changedRows: 0,
      })
    })

    it('throws when SQL is empty', async () => {
      await expect(service.executeQuery('')).rejects.toThrow('SQL statement is required')
    })

    it('throws when SQL is not a string', async () => {
      await expect(service.executeQuery(123)).rejects.toThrow('SQL statement is required')
    })

    it('throws when SQL is only whitespace', async () => {
      await expect(service.executeQuery('   ')).rejects.toThrow('SQL statement is required')
    })

    it('returns empty fields array when fields is null/undefined', async () => {
      mockConnection.query.mockResolvedValue([[], null])

      const result = await service.executeQuery('SELECT * FROM empty_table')

      expect(result.fields).toEqual([])
    })

    it('wraps MySQL errors with code and errno', async () => {
      const error = new Error('Table does not exist')

      error.code = 'ER_NO_SUCH_TABLE'
      error.errno = 1146
      error.sqlState = '42S02'

      mockConnection.query.mockRejectedValue(error)

      await expect(service.executeQuery('SELECT * FROM missing')).rejects.toThrow(
        /MySQL error:.*code: ER_NO_SUCH_TABLE.*errno: 1146.*sqlState: 42S02/
      )
    })
  })

  // ── selectRows ──

  describe('selectRows', () => {
    it('selects all columns from a table', async () => {
      mockConnection.execute.mockResolvedValue([[{ id: 1, name: 'Ada' }]])

      const result = await service.selectRows('users')

      expect(mockConnection.execute).toHaveBeenCalled()
      const [sql] = mockConnection.execute.mock.calls[0]

      expect(sql).toContain('SELECT * FROM `users`')
      expect(result).toEqual({ rows: [{ id: 1, name: 'Ada' }], rowCount: 1 })
    })

    it('selects specific columns', async () => {
      mockConnection.execute.mockResolvedValue([[{ name: 'Ada' }]])

      await service.selectRows('users', ['name', 'email'])

      const [sql] = mockConnection.execute.mock.calls[0]

      expect(sql).toContain('SELECT `name`, `email` FROM `users`')
    })

    it('applies WHERE conditions', async () => {
      mockConnection.execute.mockResolvedValue([[]])

      await service.selectRows('users', null, { status: 'active', age: 30 })

      const [sql, params] = mockConnection.execute.mock.calls[0]

      expect(sql).toContain('WHERE `status` = ? AND `age` = ?')
      expect(params).toEqual(['active', 30])
    })

    it('handles null values in WHERE with IS NULL', async () => {
      mockConnection.execute.mockResolvedValue([[]])

      await service.selectRows('users', null, { deleted_at: null })

      const [sql, params] = mockConnection.execute.mock.calls[0]

      expect(sql).toContain('`deleted_at` IS NULL')
      expect(params).toEqual([])
    })

    it('handles array values in WHERE with IN clause', async () => {
      mockConnection.execute.mockResolvedValue([[]])

      await service.selectRows('users', null, { status: ['active', 'pending'] })

      const [sql, params] = mockConnection.execute.mock.calls[0]

      expect(sql).toContain('`status` IN (?, ?)')
      expect(params).toEqual(['active', 'pending'])
    })

    it('handles empty array in WHERE with 1 = 0', async () => {
      mockConnection.execute.mockResolvedValue([[]])

      await service.selectRows('users', null, { status: [] })

      const [sql] = mockConnection.execute.mock.calls[0]

      expect(sql).toContain('1 = 0')
    })

    it('applies ORDER BY', async () => {
      mockConnection.execute.mockResolvedValue([[]])

      await service.selectRows('users', null, null, 'name', 'Ascending')

      const [sql] = mockConnection.execute.mock.calls[0]

      expect(sql).toContain('ORDER BY `name` ASC')
    })

    it('applies ORDER BY DESC', async () => {
      mockConnection.execute.mockResolvedValue([[]])

      await service.selectRows('users', null, null, 'created_at', 'Descending')

      const [sql] = mockConnection.execute.mock.calls[0]

      expect(sql).toContain('ORDER BY `created_at` DESC')
    })

    it('applies LIMIT', async () => {
      mockConnection.execute.mockResolvedValue([[]])

      await service.selectRows('users', null, null, null, null, 10)

      const [sql] = mockConnection.execute.mock.calls[0]

      expect(sql).toContain('LIMIT 10')
    })

    it('applies OFFSET with auto LIMIT when no limit provided', async () => {
      mockConnection.execute.mockResolvedValue([[]])

      await service.selectRows('users', null, null, null, null, null, 20)

      const [sql] = mockConnection.execute.mock.calls[0]

      expect(sql).toContain('LIMIT 18446744073709551615')
      expect(sql).toContain('OFFSET 20')
    })

    it('applies both LIMIT and OFFSET', async () => {
      mockConnection.execute.mockResolvedValue([[]])

      await service.selectRows('users', null, null, null, null, 10, 20)

      const [sql] = mockConnection.execute.mock.calls[0]

      expect(sql).toContain('LIMIT 10')
      expect(sql).toContain('OFFSET 20')
    })

    it('handles database-qualified table names', async () => {
      mockConnection.execute.mockResolvedValue([[]])

      await service.selectRows('mydb.users')

      const [sql] = mockConnection.execute.mock.calls[0]

      expect(sql).toContain('`mydb`.`users`')
    })

    it('throws on empty table name', async () => {
      await expect(service.selectRows('')).rejects.toThrow('Table name is required')
    })

    it('throws on negative limit', async () => {
      await expect(service.selectRows('users', null, null, null, null, -1)).rejects.toThrow(
        'Limit must be a non-negative integer'
      )
    })

    it('throws on negative offset', async () => {
      await expect(service.selectRows('users', null, null, null, null, null, -5)).rejects.toThrow(
        'Offset must be a non-negative integer'
      )
    })
  })

  // ── insertRow ──

  describe('insertRow', () => {
    it('inserts a row and returns insertId and affectedRows', async () => {
      mockConnection.execute.mockResolvedValue([{ insertId: 42, affectedRows: 1 }])

      const result = await service.insertRow('users', { name: 'Ada', email: 'ada@example.com' })

      const [sql, params] = mockConnection.execute.mock.calls[0]

      expect(sql).toContain('INSERT INTO `users`')
      expect(sql).toContain('`name`, `email`')
      expect(sql).toContain('VALUES (?, ?)')
      expect(params).toEqual(['Ada', 'ada@example.com'])
      expect(result).toEqual({
        insertId: 42,
        affectedRows: 1,
        row: { name: 'Ada', email: 'ada@example.com' },
      })
    })

    it('throws when data is empty', async () => {
      await expect(service.insertRow('users', {})).rejects.toThrow('Data must be a non-empty object')
    })

    it('throws when data is not an object', async () => {
      await expect(service.insertRow('users', 'not-object')).rejects.toThrow('Data must be a non-empty object')
    })

    it('throws when data is an array', async () => {
      await expect(service.insertRow('users', [{ name: 'Ada' }])).rejects.toThrow('Data must be a non-empty object')
    })

    it('throws when data is null', async () => {
      await expect(service.insertRow('users', null)).rejects.toThrow('Data must be a non-empty object')
    })

    it('throws on empty table name', async () => {
      await expect(service.insertRow('', { name: 'Ada' })).rejects.toThrow('Table name is required')
    })
  })

  // ── insertRows ──

  describe('insertRows', () => {
    it('bulk-inserts rows in a single INSERT statement', async () => {
      mockConnection.execute.mockResolvedValue([{ affectedRows: 2, insertId: 10 }])

      const result = await service.insertRows('users', [
        { name: 'Ada', email: 'ada@example.com' },
        { name: 'Linus', email: 'linus@example.com' },
      ])

      const [sql, params] = mockConnection.execute.mock.calls[0]

      expect(sql).toContain('INSERT INTO `users`')
      expect(sql).toContain('`name`, `email`')
      expect(sql).toContain('VALUES (?, ?), (?, ?)')
      expect(params).toEqual(['Ada', 'ada@example.com', 'Linus', 'linus@example.com'])
      expect(result).toEqual({ insertedCount: 2, firstInsertId: 10 })
    })

    it('fills missing columns with null across heterogeneous rows', async () => {
      mockConnection.execute.mockResolvedValue([{ affectedRows: 2, insertId: 10 }])

      await service.insertRows('users', [
        { name: 'Ada' },
        { name: 'Linus', email: 'linus@example.com' },
      ])

      const [, params] = mockConnection.execute.mock.calls[0]

      // Ada has no email, so it should be null
      expect(params).toEqual(['Ada', null, 'Linus', 'linus@example.com'])
    })

    it('throws when rows is not an array', async () => {
      await expect(service.insertRows('users', 'not-array')).rejects.toThrow('Rows must be a non-empty array')
    })

    it('throws when rows is an empty array', async () => {
      await expect(service.insertRows('users', [])).rejects.toThrow('Rows must be a non-empty array')
    })

    it('throws when a row in the array is empty', async () => {
      await expect(service.insertRows('users', [{ name: 'Ada' }, {}])).rejects.toThrow(
        'Rows[1] must be a non-empty object'
      )
    })
  })

  // ── updateRows ──

  describe('updateRows', () => {
    it('updates rows and returns affectedRows and changedRows', async () => {
      mockConnection.execute.mockResolvedValue([{ affectedRows: 3, changedRows: 2 }])

      const result = await service.updateRows('users', { status: 'archived' }, { status: 'active' })

      const [sql, params] = mockConnection.execute.mock.calls[0]

      expect(sql).toContain('UPDATE `users` SET `status` = ?')
      expect(sql).toContain('WHERE `status` = ?')
      expect(params).toEqual(['archived', 'active'])
      expect(result).toEqual({ affectedRows: 3, changedRows: 2 })
    })

    it('throws when data is empty', async () => {
      await expect(service.updateRows('users', {}, { id: 1 })).rejects.toThrow('Data must be a non-empty object')
    })

    it('throws when where is empty', async () => {
      await expect(service.updateRows('users', { name: 'Ada' }, {})).rejects.toThrow('Where must be a non-empty object')
    })

    it('throws when where is not provided', async () => {
      await expect(service.updateRows('users', { name: 'Ada' })).rejects.toThrow('Where must be a non-empty object')
    })
  })

  // ── deleteRows ──

  describe('deleteRows', () => {
    it('deletes rows and returns affectedRows', async () => {
      mockConnection.execute.mockResolvedValue([{ affectedRows: 3 }])

      const result = await service.deleteRows('users', { status: 'archived' })

      const [sql, params] = mockConnection.execute.mock.calls[0]

      expect(sql).toContain('DELETE FROM `users`')
      expect(sql).toContain('WHERE `status` = ?')
      expect(params).toEqual(['archived'])
      expect(result).toEqual({ affectedRows: 3 })
    })

    it('throws when where is empty', async () => {
      await expect(service.deleteRows('users', {})).rejects.toThrow('Where must be a non-empty object')
    })

    it('throws when where is not provided', async () => {
      await expect(service.deleteRows('users')).rejects.toThrow('Where must be a non-empty object')
    })
  })

  // ── upsertRow ──

  describe('upsertRow', () => {
    it('inserts with ON DUPLICATE KEY UPDATE', async () => {
      mockConnection.execute.mockResolvedValue([{ insertId: 42, affectedRows: 1 }])

      const result = await service.upsertRow(
        'users',
        { email: 'ada@example.com', name: 'Ada' },
        ['email']
      )

      const [sql, params] = mockConnection.execute.mock.calls[0]

      expect(sql).toContain('INSERT INTO `users`')
      expect(sql).toContain('ON DUPLICATE KEY UPDATE')
      // email is in uniqueColumns, so only name should be in the UPDATE set
      expect(sql).toContain('`name` = VALUES(`name`)')
      expect(sql).not.toMatch(/`email` = VALUES\(`email`\)/)
      expect(params).toEqual(['ada@example.com', 'Ada'])
      expect(result).toEqual({ insertId: 42, affectedRows: 1 })
    })

    it('updates all columns when uniqueColumns is empty', async () => {
      mockConnection.execute.mockResolvedValue([{ insertId: 42, affectedRows: 2 }])

      await service.upsertRow('users', { email: 'ada@example.com', name: 'Ada' })

      const [sql] = mockConnection.execute.mock.calls[0]

      expect(sql).toContain('`email` = VALUES(`email`)')
      expect(sql).toContain('`name` = VALUES(`name`)')
    })

    it('uses self-assignment when all columns are in uniqueColumns', async () => {
      mockConnection.execute.mockResolvedValue([{ insertId: 0, affectedRows: 0 }])

      await service.upsertRow('users', { email: 'ada@example.com' }, ['email'])

      const [sql] = mockConnection.execute.mock.calls[0]

      // When nothing to update, service uses self-assignment: `email` = `email`
      expect(sql).toContain('`email` = `email`')
    })

    it('throws when data is empty', async () => {
      await expect(service.upsertRow('users', {})).rejects.toThrow('Data must be a non-empty object')
    })
  })

  // ── getTableSchema ──

  describe('getTableSchema', () => {
    it('returns column definitions for a table', async () => {
      mockConnection.execute.mockResolvedValue([[
        {
          name: 'id',
          type: 'int',
          dataType: 'int',
          nullable: 'NO',
          defaultValue: null,
          keyType: 'PRI',
          extra: 'auto_increment',
          maxLength: null,
          position: 1,
          tableSchema: 'testdb',
        },
        {
          name: 'email',
          type: 'varchar(255)',
          dataType: 'varchar',
          nullable: 'NO',
          defaultValue: null,
          keyType: 'UNI',
          extra: '',
          maxLength: 255,
          position: 2,
          tableSchema: 'testdb',
        },
      ]])

      const result = await service.getTableSchema('users')

      expect(result).toEqual({
        database: 'testdb',
        table: 'users',
        columns: [
          {
            name: 'id',
            type: 'int',
            dataType: 'int',
            nullable: false,
            default: null,
            key: 'PRI',
            extra: 'auto_increment',
            maxLength: null,
            position: 1,
          },
          {
            name: 'email',
            type: 'varchar(255)',
            dataType: 'varchar',
            nullable: false,
            default: null,
            key: 'UNI',
            extra: '',
            maxLength: 255,
            position: 2,
          },
        ],
      })
    })

    it('maps nullable YES to true', async () => {
      mockConnection.execute.mockResolvedValue([[
        {
          name: 'bio',
          type: 'text',
          dataType: 'text',
          nullable: 'YES',
          defaultValue: null,
          keyType: '',
          extra: '',
          maxLength: 65535,
          position: 3,
          tableSchema: 'testdb',
        },
      ]])

      const result = await service.getTableSchema('users')

      expect(result.columns[0].nullable).toBe(true)
    })

    it('handles database-qualified table names', async () => {
      mockConnection.execute.mockResolvedValue([[
        {
          name: 'id',
          type: 'int',
          dataType: 'int',
          nullable: 'NO',
          defaultValue: null,
          keyType: 'PRI',
          extra: 'auto_increment',
          maxLength: null,
          position: 1,
          tableSchema: 'mydb',
        },
      ]])

      const result = await service.getTableSchema('mydb.users')

      const [sql, params] = mockConnection.execute.mock.calls[0]

      expect(sql).toContain('table_schema = COALESCE(?, DATABASE())')
      expect(params).toEqual(['mydb', 'users'])
      expect(result.database).toBe('mydb')
      expect(result.table).toBe('users')
    })

    it('throws when table is not found', async () => {
      mockConnection.execute.mockResolvedValue([[]])

      await expect(service.getTableSchema('missing')).rejects.toThrow(
        'Table "missing" was not found or has no columns'
      )
    })

    it('throws on empty table name', async () => {
      await expect(service.getTableSchema('')).rejects.toThrow('Table name is required')
    })
  })

  // ── listTables ──

  describe('listTables', () => {
    it('returns tables with name and type', async () => {
      mockConnection.execute.mockResolvedValue([[
        { tableSchema: 'testdb', name: 'users', type: 'BASE TABLE' },
        { tableSchema: 'testdb', name: 'active_users', type: 'VIEW' },
      ]])

      const result = await service.listTables()

      expect(result).toEqual({
        database: 'testdb',
        tables: [
          { name: 'users', type: 'BASE TABLE' },
          { name: 'active_users', type: 'VIEW' },
        ],
        count: 2,
      })
    })

    it('returns null database when no tables exist', async () => {
      mockConnection.execute.mockResolvedValue([[]])

      const result = await service.listTables()

      expect(result).toEqual({
        database: null,
        tables: [],
        count: 0,
      })
    })
  })

  // ── getTablesDictionary ──

  describe('getTablesDictionary', () => {
    it('returns dictionary items with label, value, note', async () => {
      mockConnection.execute.mockResolvedValue([[
        { name: 'users', type: 'BASE TABLE' },
        { name: 'orders', type: 'BASE TABLE' },
      ]])

      const result = await service.getTablesDictionary({})

      expect(result.items).toEqual([
        { label: 'users', value: 'users', note: 'BASE TABLE' },
        { label: 'orders', value: 'orders', note: 'BASE TABLE' },
      ])
      expect(result.cursor).toBeNull()
    })

    it('applies search filter via LIKE', async () => {
      mockConnection.execute.mockResolvedValue([[
        { name: 'users', type: 'BASE TABLE' },
      ]])

      await service.getTablesDictionary({ search: 'user' })

      const [, params] = mockConnection.execute.mock.calls[0]

      expect(params).toEqual(['%user%'])
    })

    it('uses % wildcard when no search is provided', async () => {
      mockConnection.execute.mockResolvedValue([[]])

      await service.getTablesDictionary({})

      const [, params] = mockConnection.execute.mock.calls[0]

      expect(params).toEqual(['%'])
    })

    it('returns cursor for pagination when more results exist', async () => {
      // 201 items (DICTIONARY_PAGE_SIZE + 1)
      const items = Array.from({ length: 201 }, (_, i) => ({ name: `t_${ i }`, type: 'BASE TABLE' }))

      mockConnection.execute.mockResolvedValue([items])

      const result = await service.getTablesDictionary({})

      expect(result.items).toHaveLength(200)
      expect(result.cursor).toBe('200')
    })

    it('handles null payload', async () => {
      mockConnection.execute.mockResolvedValue([[]])

      const result = await service.getTablesDictionary(null)

      expect(result.items).toEqual([])
      expect(result.cursor).toBeNull()
    })

    it('parses cursor for offset', async () => {
      mockConnection.execute.mockResolvedValue([[]])

      await service.getTablesDictionary({ cursor: '200' })

      const [sql] = mockConnection.execute.mock.calls[0]

      expect(sql).toContain('OFFSET 200')
    })
  })

  // ── getColumnsDictionary ──

  describe('getColumnsDictionary', () => {
    it('returns column items with label, value, note', async () => {
      mockConnection.execute.mockResolvedValue([[
        { name: 'id', type: 'int' },
        { name: 'email', type: 'varchar(255)' },
      ]])

      const result = await service.getColumnsDictionary({ criteria: { table: 'users' } })

      expect(result.items).toEqual([
        { label: 'id', value: 'id', note: 'int' },
        { label: 'email', value: 'email', note: 'varchar(255)' },
      ])
      expect(result.cursor).toBeNull()
    })

    it('returns empty items when no table is specified', async () => {
      const result = await service.getColumnsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('returns empty items when criteria is null', async () => {
      const result = await service.getColumnsDictionary({ criteria: null })

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('returns empty items when payload is null', async () => {
      const result = await service.getColumnsDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('applies search filter via LIKE', async () => {
      mockConnection.execute.mockResolvedValue([[]])

      await service.getColumnsDictionary({ criteria: { table: 'users' }, search: 'email' })

      const [, params] = mockConnection.execute.mock.calls[0]

      // params: [schema, name, search pattern]
      expect(params[2]).toBe('%email%')
    })

    it('handles database-qualified table in criteria', async () => {
      mockConnection.execute.mockResolvedValue([[]])

      await service.getColumnsDictionary({ criteria: { table: 'mydb.users' } })

      const [, params] = mockConnection.execute.mock.calls[0]

      expect(params[0]).toBe('mydb')
      expect(params[1]).toBe('users')
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('includes ENETUNREACH IPv6 hint when address contains :', async () => {
      const error = new Error('connect ENETUNREACH')

      error.code = 'ENETUNREACH'
      error.address = '::1'

      mockConnection.query.mockRejectedValue(error)

      await expect(service.executeQuery('SELECT 1')).rejects.toThrow(/IPv6/)
    })

    it('includes SSL hint on ECONNRESET when SSL is off', async () => {
      const error = new Error('Connection reset')

      error.code = 'ECONNRESET'

      mockConnection.query.mockRejectedValue(error)

      await expect(service.executeQuery('SELECT 1')).rejects.toThrow(/TLS/)
    })

    it('does not include SSL hint when SSL is on', async () => {
      ;({ sandbox, service } = buildService({
        host: 'db.example.com',
        database: 'testdb',
        user: 'root',
        password: 'pass',
        ssl: true,
      }))

      const error = new Error('Connection reset')

      error.code = 'ECONNRESET'

      mockConnection.query.mockRejectedValue(error)

      try {
        await service.executeQuery('SELECT 1')
        // Should not reach here
        expect(true).toBe(false)
      } catch (thrown) {
        expect(thrown.message).toContain('MySQL error:')
        expect(thrown.message).not.toContain('TLS')
      }
    })

    it('includes errno in error message', async () => {
      const error = new Error('Access denied')

      error.code = 'ER_ACCESS_DENIED_ERROR'
      error.errno = 1045

      mockConnection.query.mockRejectedValue(error)

      await expect(service.executeQuery('SELECT 1')).rejects.toThrow(/errno: 1045/)
    })
  })

  // ── Identifier quoting ──

  describe('identifier quoting', () => {
    it('escapes backticks in column names', async () => {
      mockConnection.execute.mockResolvedValue([[]])

      await service.selectRows('users', ['col`name'])

      const [sql] = mockConnection.execute.mock.calls[0]

      expect(sql).toContain('`col``name`')
    })

    it('escapes backticks in table names', async () => {
      mockConnection.execute.mockResolvedValue([[]])

      await service.selectRows('my`table')

      const [sql] = mockConnection.execute.mock.calls[0]

      expect(sql).toContain('`my``table`')
    })
  })
})
