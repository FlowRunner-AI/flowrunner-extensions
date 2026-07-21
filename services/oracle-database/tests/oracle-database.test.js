'use strict'

// ============================================================================
//  Oracle Database Service — Unit Tests
//
//  The Oracle Database service uses the native `oracledb` driver instead of
//  Flowrunner.Request, so we mock the entire `oracledb` module with Jest.
// ============================================================================

const { createSandbox } = require('../../../service-sandbox')

// ---------------------------------------------------------------------------
//  Mock oracledb driver — shared across all tests via jest.mock().
// ---------------------------------------------------------------------------

const mockConnection = {
  execute: jest.fn(),
  close: jest.fn().mockResolvedValue(undefined),
}

const mockGetConnection = jest.fn().mockResolvedValue(mockConnection)

// oracledb constants used by the service — prefixed with "mock" so Jest allows
// referencing them inside jest.mock() factories.
const mockOracleConstants = {
  OUT_FORMAT_OBJECT: 4001,
  BIND_IN: 3001,
  BIND_OUT: 3002,
  BIND_INOUT: 3003,
  STRING: 2001,
  NUMBER: 2002,
  DATE: 2003,
  outFormat: 4001,
}

jest.mock('oracledb', () => ({
  ...mockOracleConstants,
  getConnection: mockGetConnection,
}))

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------

function resetAllMocks() {
  mockConnection.execute.mockReset()
  mockConnection.close.mockClear()
  mockGetConnection.mockClear()
  mockGetConnection.mockResolvedValue(mockConnection)
  mockConnection.close.mockResolvedValue(undefined)
}

function buildService(config) {
  const sandbox = createSandbox(config)

  jest.resetModules()

  jest.mock('oracledb', () => ({
    ...mockOracleConstants,
    getConnection: mockGetConnection,
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

describe('Oracle Database Service', () => {
  let sandbox
  let service

  beforeEach(() => {
    resetAllMocks()
    ;({ sandbox, service } = buildService({
      host: 'dbhost.example.com',
      port: '1521',
      serviceName: 'ORCLPDB1',
      user: 'testuser',
      password: 's3cret',
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
          name: 'connectString',
          displayName: 'Connect String',
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
          defaultValue: '1521',
          type: 'STRING',
        }),
        expect.objectContaining({
          name: 'serviceName',
          displayName: 'Service Name',
          required: false,
          shared: false,
          type: 'STRING',
        }),
        expect.objectContaining({
          name: 'user',
          displayName: 'User',
          required: true,
          shared: false,
          type: 'STRING',
        }),
        expect.objectContaining({
          name: 'password',
          displayName: 'Password',
          required: true,
          shared: false,
          type: 'STRING',
        }),
      ])
    })
  })

  // ── Connection configuration ──

  describe('connection configuration', () => {
    it('connects with host:port/serviceName when no connect string', async () => {
      mockConnection.execute.mockResolvedValue({
        rows: [{ ID: 1 }],
        metaData: [{ name: 'ID' }],
      })

      await service.executeQuery('SELECT 1 AS ID FROM DUAL')

      expect(mockGetConnection).toHaveBeenCalledWith({
        user: 'testuser',
        password: 's3cret',
        connectString: 'dbhost.example.com:1521/ORCLPDB1',
      })
    })

    it('uses connect string when provided (takes precedence)', async () => {
      ;({ sandbox, service } = buildService({
        connectString: 'dbhost:1521/ORCLPDB1',
        host: 'other-host',
        serviceName: 'OTHER',
        user: 'testuser',
        password: 's3cret',
      }))

      mockConnection.execute.mockResolvedValue({
        rows: [{ N: 1 }],
        metaData: [{ name: 'N' }],
      })

      await service.executeQuery('SELECT 1 AS N FROM DUAL')

      expect(mockGetConnection).toHaveBeenCalledWith({
        user: 'testuser',
        password: 's3cret',
        connectString: 'dbhost:1521/ORCLPDB1',
      })
    })

    it('uses default port 1521 when port is not specified', async () => {
      ;({ sandbox, service } = buildService({
        host: 'dbhost.example.com',
        serviceName: 'ORCLPDB1',
        user: 'testuser',
        password: 's3cret',
      }))

      mockConnection.execute.mockResolvedValue({
        rows: [{ N: 1 }],
        metaData: [{ name: 'N' }],
      })

      await service.executeQuery('SELECT 1 AS N FROM DUAL')

      expect(mockGetConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          connectString: 'dbhost.example.com:1521/ORCLPDB1',
        })
      )
    })

    it('throws when user and password are missing', async () => {
      ;({ sandbox, service } = buildService({
        host: 'dbhost.example.com',
        serviceName: 'ORCLPDB1',
      }))

      await expect(service.executeQuery('SELECT 1 FROM DUAL')).rejects.toThrow(
        'User and Password are required'
      )
    })

    it('throws when connection config is incomplete (no host, no connect string)', async () => {
      ;({ sandbox, service } = buildService({
        user: 'testuser',
        password: 's3cret',
      }))

      await expect(service.executeQuery('SELECT 1 FROM DUAL')).rejects.toThrow(
        'incomplete connection configuration'
      )
    })

    it('throws when host is set but serviceName is missing', async () => {
      ;({ sandbox, service } = buildService({
        host: 'dbhost.example.com',
        user: 'testuser',
        password: 's3cret',
      }))

      await expect(service.executeQuery('SELECT 1 FROM DUAL')).rejects.toThrow(
        'incomplete connection configuration'
      )
    })

    it('closes connection after successful operation', async () => {
      mockConnection.execute.mockResolvedValue({
        rows: [{ N: 1 }],
        metaData: [{ name: 'N' }],
      })

      await service.executeQuery('SELECT 1 AS N FROM DUAL')

      expect(mockConnection.close).toHaveBeenCalled()
    })

    it('closes connection even when operation fails', async () => {
      mockConnection.execute.mockRejectedValue(new Error('query failed'))

      await expect(service.executeQuery('SELECT 1 FROM DUAL')).rejects.toThrow()

      expect(mockConnection.close).toHaveBeenCalled()
    })
  })

  // ── executeQuery ──

  describe('executeQuery', () => {
    it('executes a SELECT and returns rows, rowCount, columns', async () => {
      mockConnection.execute.mockResolvedValue({
        rows: [{ ID: 1, NAME: 'Ada' }],
        metaData: [{ name: 'ID' }, { name: 'NAME' }],
      })

      const result = await service.executeQuery('SELECT * FROM EMPLOYEES')

      expect(result).toEqual({
        rows: [{ ID: 1, NAME: 'Ada' }],
        rowCount: 1,
        columns: ['ID', 'NAME'],
      })
    })

    it('passes named binds to execute', async () => {
      mockConnection.execute.mockResolvedValue({
        rows: [{ ID: 42 }],
        metaData: [{ name: 'ID' }],
      })

      await service.executeQuery('SELECT * FROM EMPLOYEES WHERE ID = :id', { id: 42 })

      expect(mockConnection.execute).toHaveBeenCalledWith(
        'SELECT * FROM EMPLOYEES WHERE ID = :id',
        { id: 42 },
        expect.objectContaining({ outFormat: mockOracleConstants.OUT_FORMAT_OBJECT })
      )
    })

    it('passes array binds to execute', async () => {
      mockConnection.execute.mockResolvedValue({
        rows: [{ ID: 42 }],
        metaData: [{ name: 'ID' }],
      })

      await service.executeQuery('SELECT * FROM EMPLOYEES WHERE ID = :1', [42])

      expect(mockConnection.execute).toHaveBeenCalledWith(
        'SELECT * FROM EMPLOYEES WHERE ID = :1',
        [42],
        expect.any(Object)
      )
    })

    it('uses empty array when binds is undefined', async () => {
      mockConnection.execute.mockResolvedValue({
        rows: [],
        metaData: [{ name: 'N' }],
      })

      await service.executeQuery('SELECT 1 AS N FROM DUAL')

      expect(mockConnection.execute).toHaveBeenCalledWith(
        'SELECT 1 AS N FROM DUAL',
        [],
        expect.any(Object)
      )
    })

    it('uses empty array when binds is not an object or array', async () => {
      mockConnection.execute.mockResolvedValue({
        rows: [],
        metaData: [],
      })

      await service.executeQuery('SELECT 1 FROM DUAL', 'not-valid')

      expect(mockConnection.execute).toHaveBeenCalledWith(
        'SELECT 1 FROM DUAL',
        [],
        expect.any(Object)
      )
    })

    it('passes maxRows option when provided', async () => {
      mockConnection.execute.mockResolvedValue({
        rows: [{ ID: 1 }],
        metaData: [{ name: 'ID' }],
      })

      await service.executeQuery('SELECT * FROM EMPLOYEES', null, 10)

      expect(mockConnection.execute).toHaveBeenCalledWith(
        'SELECT * FROM EMPLOYEES',
        [],
        expect.objectContaining({ maxRows: 10 })
      )
    })

    it('does not pass maxRows when not provided', async () => {
      mockConnection.execute.mockResolvedValue({
        rows: [],
        metaData: [],
      })

      await service.executeQuery('SELECT * FROM EMPLOYEES')

      const options = mockConnection.execute.mock.calls[0][2]

      expect(options).not.toHaveProperty('maxRows')
    })

    it('returns empty arrays when rows/metaData are null', async () => {
      mockConnection.execute.mockResolvedValue({
        rows: null,
        metaData: null,
      })

      const result = await service.executeQuery('SELECT * FROM EMPTY_TABLE')

      expect(result).toEqual({ rows: [], rowCount: 0, columns: [] })
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

    it('throws on negative maxRows', async () => {
      await expect(service.executeQuery('SELECT 1 FROM DUAL', null, -1)).rejects.toThrow(
        'Max Rows must be a non-negative integer'
      )
    })
  })

  // ── executeStatement ──

  describe('executeStatement', () => {
    it('executes a write statement and returns rowsAffected', async () => {
      mockConnection.execute.mockResolvedValue({ rowsAffected: 1 })

      const result = await service.executeStatement(
        'INSERT INTO EMPLOYEES (NAME) VALUES (:name)',
        { name: 'Ada' }
      )

      expect(result).toEqual({ rowsAffected: 1 })
    })

    it('uses autoCommit option', async () => {
      mockConnection.execute.mockResolvedValue({ rowsAffected: 0 })

      await service.executeStatement('DELETE FROM EMPLOYEES WHERE 1=0')

      expect(mockConnection.execute).toHaveBeenCalledWith(
        'DELETE FROM EMPLOYEES WHERE 1=0',
        [],
        expect.objectContaining({ autoCommit: true })
      )
    })

    it('returns 0 when rowsAffected is null/undefined', async () => {
      mockConnection.execute.mockResolvedValue({})

      const result = await service.executeStatement('DELETE FROM EMPLOYEES WHERE 1=0')

      expect(result).toEqual({ rowsAffected: 0 })
    })

    it('throws when SQL is empty', async () => {
      await expect(service.executeStatement('')).rejects.toThrow('SQL statement is required')
    })

    it('throws when SQL is not a string', async () => {
      await expect(service.executeStatement(null)).rejects.toThrow('SQL statement is required')
    })
  })

  // ── executePlsqlBlock ──

  describe('executePlsqlBlock', () => {
    it('executes a PL/SQL block and returns outBinds and rowsAffected', async () => {
      mockConnection.execute.mockResolvedValue({
        outBinds: { result: 5 },
        rowsAffected: 0,
      })

      const result = await service.executePlsqlBlock(
        'BEGIN :result := :a + :b; END;',
        {
          a: 2,
          b: 3,
          result: { dir: 'out', type: 'number' },
        }
      )

      expect(result).toEqual({ outBinds: { result: 5 }, rowsAffected: 0 })
    })

    it('resolves bind directions to oracledb constants', async () => {
      mockConnection.execute.mockResolvedValue({ outBinds: {}, rowsAffected: 0 })

      await service.executePlsqlBlock(
        'BEGIN :out_val := :in_val; END;',
        {
          in_val: 42,
          out_val: { dir: 'out', type: 'string' },
        }
      )

      const binds = mockConnection.execute.mock.calls[0][1]

      expect(binds.in_val).toBe(42)
      expect(binds.out_val).toEqual(
        expect.objectContaining({
          dir: mockOracleConstants.BIND_OUT,
          type: mockOracleConstants.STRING,
        })
      )
    })

    it('resolves inout direction', async () => {
      mockConnection.execute.mockResolvedValue({ outBinds: {}, rowsAffected: 0 })

      await service.executePlsqlBlock(
        'BEGIN :val := :val + 1; END;',
        { val: { dir: 'inout', type: 'number' } }
      )

      const binds = mockConnection.execute.mock.calls[0][1]

      expect(binds.val.dir).toBe(mockOracleConstants.BIND_INOUT)
      expect(binds.val.type).toBe(mockOracleConstants.NUMBER)
    })

    it('resolves date type', async () => {
      mockConnection.execute.mockResolvedValue({ outBinds: {}, rowsAffected: 0 })

      await service.executePlsqlBlock(
        'BEGIN :d := SYSDATE; END;',
        { d: { dir: 'out', type: 'date' } }
      )

      const binds = mockConnection.execute.mock.calls[0][1]

      expect(binds.d.type).toBe(mockOracleConstants.DATE)
    })

    it('defaults to BIND_IN for unknown direction', async () => {
      mockConnection.execute.mockResolvedValue({ outBinds: {}, rowsAffected: 0 })

      await service.executePlsqlBlock(
        'BEGIN NULL; END;',
        { val: { dir: 'unknown', type: 'string' } }
      )

      const binds = mockConnection.execute.mock.calls[0][1]

      expect(binds.val.dir).toBe(mockOracleConstants.BIND_IN)
    })

    it('uses autoCommit option', async () => {
      mockConnection.execute.mockResolvedValue({ outBinds: {}, rowsAffected: 0 })

      await service.executePlsqlBlock('BEGIN NULL; END;')

      expect(mockConnection.execute).toHaveBeenCalledWith(
        'BEGIN NULL; END;',
        [],
        expect.objectContaining({ autoCommit: true })
      )
    })

    it('returns empty outBinds when result has none', async () => {
      mockConnection.execute.mockResolvedValue({})

      const result = await service.executePlsqlBlock('BEGIN NULL; END;')

      expect(result).toEqual({ outBinds: {}, rowsAffected: 0 })
    })

    it('throws when block is empty', async () => {
      await expect(service.executePlsqlBlock('')).rejects.toThrow('PL/SQL Block is required')
    })

    it('throws when block is not a string', async () => {
      await expect(service.executePlsqlBlock(null)).rejects.toThrow('PL/SQL Block is required')
    })

    it('handles array binds (falls back to normalizeBinds)', async () => {
      mockConnection.execute.mockResolvedValue({ outBinds: {}, rowsAffected: 0 })

      await service.executePlsqlBlock('BEGIN NULL; END;', [1, 2, 3])

      expect(mockConnection.execute).toHaveBeenCalledWith(
        'BEGIN NULL; END;',
        [1, 2, 3],
        expect.any(Object)
      )
    })
  })

  // ── selectRows ──

  describe('selectRows', () => {
    it('selects all columns from a table', async () => {
      mockConnection.execute.mockResolvedValue({
        rows: [{ ID: 1, NAME: 'Ada' }],
      })

      const result = await service.selectRows('EMPLOYEES')

      const [sql] = mockConnection.execute.mock.calls[0]

      expect(sql).toContain('SELECT * FROM "EMPLOYEES"')
      expect(result).toEqual({ rows: [{ ID: 1, NAME: 'Ada' }], rowCount: 1 })
    })

    it('selects specific columns', async () => {
      mockConnection.execute.mockResolvedValue({
        rows: [{ NAME: 'Ada' }],
      })

      await service.selectRows('EMPLOYEES', ['NAME', 'EMAIL'])

      const [sql] = mockConnection.execute.mock.calls[0]

      expect(sql).toContain('"NAME", "EMAIL"')
    })

    it('applies WHERE clause', async () => {
      mockConnection.execute.mockResolvedValue({ rows: [] })

      await service.selectRows('EMPLOYEES', null, 'STATUS = :status', { status: 'active' })

      const [sql, binds] = mockConnection.execute.mock.calls[0]

      expect(sql).toContain('WHERE STATUS = :status')
      expect(binds).toEqual({ status: 'active' })
    })

    it('applies ORDER BY ascending', async () => {
      mockConnection.execute.mockResolvedValue({ rows: [] })

      await service.selectRows('EMPLOYEES', null, null, null, 'NAME', 'Ascending')

      const [sql] = mockConnection.execute.mock.calls[0]

      expect(sql).toContain('ORDER BY "NAME" ASC')
    })

    it('applies ORDER BY descending', async () => {
      mockConnection.execute.mockResolvedValue({ rows: [] })

      await service.selectRows('EMPLOYEES', null, null, null, 'NAME', 'Descending')

      const [sql] = mockConnection.execute.mock.calls[0]

      expect(sql).toContain('ORDER BY "NAME" DESC')
    })

    it('defaults to ASC when sortDirection is not recognized', async () => {
      mockConnection.execute.mockResolvedValue({ rows: [] })

      await service.selectRows('EMPLOYEES', null, null, null, 'NAME', 'Unknown')

      const [sql] = mockConnection.execute.mock.calls[0]

      expect(sql).toContain('ORDER BY "NAME" Unknown')
    })

    it('applies FETCH FIRST n ROWS ONLY for limit', async () => {
      mockConnection.execute.mockResolvedValue({ rows: [] })

      await service.selectRows('EMPLOYEES', null, null, null, null, null, 10)

      const [sql] = mockConnection.execute.mock.calls[0]

      expect(sql).toContain('FETCH FIRST 10 ROWS ONLY')
    })

    it('does not include FETCH FIRST when limit is not provided', async () => {
      mockConnection.execute.mockResolvedValue({ rows: [] })

      await service.selectRows('EMPLOYEES')

      const [sql] = mockConnection.execute.mock.calls[0]

      expect(sql).not.toContain('FETCH FIRST')
    })

    it('returns empty rows when result.rows is null', async () => {
      mockConnection.execute.mockResolvedValue({ rows: null })

      const result = await service.selectRows('EMPLOYEES')

      expect(result).toEqual({ rows: [], rowCount: 0 })
    })

    it('ignores WHERE clause when it is empty/whitespace', async () => {
      mockConnection.execute.mockResolvedValue({ rows: [] })

      await service.selectRows('EMPLOYEES', null, '   ')

      const [sql] = mockConnection.execute.mock.calls[0]

      expect(sql).not.toContain('WHERE')
    })

    it('throws on negative limit', async () => {
      await expect(
        service.selectRows('EMPLOYEES', null, null, null, null, null, -1)
      ).rejects.toThrow('Limit must be a non-negative integer')
    })
  })

  // ── insertRow ──

  describe('insertRow', () => {
    it('inserts a row and returns rowsAffected', async () => {
      mockConnection.execute.mockResolvedValue({ rowsAffected: 1 })

      const result = await service.insertRow('EMPLOYEES', { NAME: 'Ada', EMAIL: 'ada@example.com' })

      const [sql, binds] = mockConnection.execute.mock.calls[0]

      expect(sql).toContain('INSERT INTO "EMPLOYEES"')
      expect(sql).toContain('"NAME"')
      expect(sql).toContain('"EMAIL"')
      expect(sql).toContain(':b0')
      expect(sql).toContain(':b1')
      expect(binds).toEqual({ b0: 'Ada', b1: 'ada@example.com' })
      expect(result).toEqual({ rowsAffected: 1 })
    })

    it('uses autoCommit option', async () => {
      mockConnection.execute.mockResolvedValue({ rowsAffected: 1 })

      await service.insertRow('EMPLOYEES', { NAME: 'Ada' })

      expect(mockConnection.execute).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({ autoCommit: true })
      )
    })

    it('throws when data is empty', async () => {
      await expect(service.insertRow('EMPLOYEES', {})).rejects.toThrow(
        'Data must be a non-empty object'
      )
    })

    it('throws when data is not an object', async () => {
      await expect(service.insertRow('EMPLOYEES', 'not-object')).rejects.toThrow(
        'Data must be a non-empty object'
      )
    })

    it('throws when data is an array', async () => {
      await expect(service.insertRow('EMPLOYEES', [{ NAME: 'Ada' }])).rejects.toThrow(
        'Data must be a non-empty object'
      )
    })

    it('throws when data is null', async () => {
      await expect(service.insertRow('EMPLOYEES', null)).rejects.toThrow(
        'Data must be a non-empty object'
      )
    })
  })

  // ── updateRows ──

  describe('updateRows', () => {
    it('updates rows and returns rowsAffected', async () => {
      mockConnection.execute.mockResolvedValue({ rowsAffected: 3 })

      const result = await service.updateRows(
        'EMPLOYEES',
        { STATUS: 'archived' },
        'STATUS = :status',
        { status: 'active' }
      )

      const [sql, binds] = mockConnection.execute.mock.calls[0]

      expect(sql).toContain('UPDATE "EMPLOYEES" SET "STATUS" = :s0 WHERE STATUS = :status')
      expect(binds).toEqual({ status: 'active', s0: 'archived' })
      expect(result).toEqual({ rowsAffected: 3 })
    })

    it('uses autoCommit option', async () => {
      mockConnection.execute.mockResolvedValue({ rowsAffected: 0 })

      await service.updateRows('EMPLOYEES', { NAME: 'Ada' }, 'ID = :id', { id: 1 })

      expect(mockConnection.execute).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({ autoCommit: true })
      )
    })

    it('throws when data is empty', async () => {
      await expect(
        service.updateRows('EMPLOYEES', {}, 'ID = :id', { id: 1 })
      ).rejects.toThrow('Data must be a non-empty object')
    })

    it('throws when whereClause is empty', async () => {
      await expect(
        service.updateRows('EMPLOYEES', { NAME: 'Ada' }, '')
      ).rejects.toThrow('Where Clause is required')
    })

    it('throws when whereClause is not a string', async () => {
      await expect(
        service.updateRows('EMPLOYEES', { NAME: 'Ada' }, null)
      ).rejects.toThrow('Where Clause is required')
    })

    it('throws when whereClause is only whitespace', async () => {
      await expect(
        service.updateRows('EMPLOYEES', { NAME: 'Ada' }, '   ')
      ).rejects.toThrow('Where Clause is required')
    })

    it('throws when whereBinds is an array with elements', async () => {
      await expect(
        service.updateRows('EMPLOYEES', { NAME: 'Ada' }, 'ID = :1', [1])
      ).rejects.toThrow('requires named binds')
    })

    it('accepts empty array whereBinds (no WHERE bind values)', async () => {
      mockConnection.execute.mockResolvedValue({ rowsAffected: 1 })

      // Empty array normalizes to [] which has length 0, so it passes
      await service.updateRows('EMPLOYEES', { NAME: 'Ada' }, 'ID = 1', [])

      expect(mockConnection.execute).toHaveBeenCalled()
    })
  })

  // ── deleteRows ──

  describe('deleteRows', () => {
    it('deletes rows and returns rowsAffected', async () => {
      mockConnection.execute.mockResolvedValue({ rowsAffected: 3 })

      const result = await service.deleteRows('EMPLOYEES', 'STATUS = :status', { status: 'archived' })

      const [sql, binds] = mockConnection.execute.mock.calls[0]

      expect(sql).toContain('DELETE FROM "EMPLOYEES" WHERE STATUS = :status')
      expect(binds).toEqual({ status: 'archived' })
      expect(result).toEqual({ rowsAffected: 3 })
    })

    it('uses autoCommit option', async () => {
      mockConnection.execute.mockResolvedValue({ rowsAffected: 0 })

      await service.deleteRows('EMPLOYEES', 'ID = :id', { id: 1 })

      expect(mockConnection.execute).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({ autoCommit: true })
      )
    })

    it('accepts array binds for positional placeholders', async () => {
      mockConnection.execute.mockResolvedValue({ rowsAffected: 1 })

      await service.deleteRows('EMPLOYEES', 'ID = :1', [42])

      expect(mockConnection.execute).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM "EMPLOYEES" WHERE ID = :1'),
        [42],
        expect.any(Object)
      )
    })

    it('throws when whereClause is empty', async () => {
      await expect(service.deleteRows('EMPLOYEES', '')).rejects.toThrow(
        'Where Clause is required'
      )
    })

    it('throws when whereClause is not a string', async () => {
      await expect(service.deleteRows('EMPLOYEES', null)).rejects.toThrow(
        'Where Clause is required'
      )
    })

    it('throws when whereClause is only whitespace', async () => {
      await expect(service.deleteRows('EMPLOYEES', '   ')).rejects.toThrow(
        'Where Clause is required'
      )
    })
  })

  // ── describeTable ──

  describe('describeTable', () => {
    it('returns column definitions for a table', async () => {
      mockConnection.execute.mockResolvedValue({
        rows: [
          { COLUMN_NAME: 'ID', DATA_TYPE: 'NUMBER', NULLABLE: 'N', DATA_LENGTH: 22 },
          { COLUMN_NAME: 'NAME', DATA_TYPE: 'VARCHAR2', NULLABLE: 'Y', DATA_LENGTH: 100 },
        ],
      })

      const result = await service.describeTable('EMPLOYEES')

      expect(result).toEqual({
        table: 'EMPLOYEES',
        columns: [
          { name: 'ID', dataType: 'NUMBER', nullable: false, length: 22 },
          { name: 'NAME', dataType: 'VARCHAR2', nullable: true, length: 100 },
        ],
      })
    })

    it('queries USER_TAB_COLUMNS with uppercased table name', async () => {
      mockConnection.execute.mockResolvedValue({
        rows: [{ COLUMN_NAME: 'ID', DATA_TYPE: 'NUMBER', NULLABLE: 'N', DATA_LENGTH: 22 }],
      })

      await service.describeTable('employees')

      const [sql, binds] = mockConnection.execute.mock.calls[0]

      expect(sql).toContain('user_tab_columns')
      expect(sql).toContain('UPPER(:tableName)')
      expect(binds).toEqual({ tableName: 'employees' })
    })

    it('throws when table is not found', async () => {
      mockConnection.execute.mockResolvedValue({ rows: [] })

      await expect(service.describeTable('MISSING')).rejects.toThrow(
        'Table "MISSING" was not found'
      )
    })

    it('throws on empty table name', async () => {
      await expect(service.describeTable('')).rejects.toThrow(
        'Table name is required'
      )
    })

    it('throws when table is not a string', async () => {
      await expect(service.describeTable(null)).rejects.toThrow(
        'Table name is required'
      )
    })

    it('trims whitespace from table name', async () => {
      mockConnection.execute.mockResolvedValue({
        rows: [{ COLUMN_NAME: 'ID', DATA_TYPE: 'NUMBER', NULLABLE: 'N', DATA_LENGTH: 22 }],
      })

      const result = await service.describeTable('  employees  ')

      expect(result.table).toBe('EMPLOYEES')
      expect(mockConnection.execute.mock.calls[0][1]).toEqual({ tableName: 'employees' })
    })
  })

  // ── listTables ──

  describe('listTables', () => {
    it('returns tables and count', async () => {
      mockConnection.execute.mockResolvedValue({
        rows: [{ TABLE_NAME: 'DEPARTMENTS' }, { TABLE_NAME: 'EMPLOYEES' }],
      })

      const result = await service.listTables()

      expect(result).toEqual({
        tables: ['DEPARTMENTS', 'EMPLOYEES'],
        count: 2,
      })
    })

    it('returns empty array when no tables exist', async () => {
      mockConnection.execute.mockResolvedValue({ rows: [] })

      const result = await service.listTables()

      expect(result).toEqual({ tables: [], count: 0 })
    })

    it('handles null rows', async () => {
      mockConnection.execute.mockResolvedValue({ rows: null })

      const result = await service.listTables()

      expect(result).toEqual({ tables: [], count: 0 })
    })
  })

  // ── getTablesDictionary ──

  describe('getTablesDictionary', () => {
    it('returns dictionary items with label, value, note', async () => {
      mockConnection.execute.mockResolvedValue({
        rows: [{ TABLE_NAME: 'EMPLOYEES' }, { TABLE_NAME: 'DEPARTMENTS' }],
      })

      const result = await service.getTablesDictionary({})

      expect(result.items).toEqual([
        { label: 'EMPLOYEES', value: 'EMPLOYEES', note: 'Table' },
        { label: 'DEPARTMENTS', value: 'DEPARTMENTS', note: 'Table' },
      ])
      expect(result.cursor).toBeNull()
    })

    it('passes search pattern for filtering', async () => {
      mockConnection.execute.mockResolvedValue({
        rows: [{ TABLE_NAME: 'EMPLOYEES' }],
      })

      await service.getTablesDictionary({ search: 'emp' })

      const binds = mockConnection.execute.mock.calls[0][1]

      expect(binds.searchText).toBe('emp')
      expect(binds.searchPattern).toBe('%EMP%')
    })

    it('uses null searchText when no search is provided', async () => {
      mockConnection.execute.mockResolvedValue({ rows: [] })

      await service.getTablesDictionary({})

      const binds = mockConnection.execute.mock.calls[0][1]

      expect(binds.searchText).toBeNull()
      expect(binds.searchPattern).toBe('%')
    })

    it('returns cursor for pagination when more results exist', async () => {
      // 201 items (DICTIONARY_PAGE_SIZE + 1)
      const items = Array.from({ length: 201 }, (_, i) => ({ TABLE_NAME: `T_${i}` }))

      mockConnection.execute.mockResolvedValue({ rows: items })

      const result = await service.getTablesDictionary({})

      expect(result.items).toHaveLength(200)
      expect(result.cursor).toBe('200')
    })

    it('returns null cursor when results do not exceed page size', async () => {
      const items = Array.from({ length: 50 }, (_, i) => ({ TABLE_NAME: `T_${i}` }))

      mockConnection.execute.mockResolvedValue({ rows: items })

      const result = await service.getTablesDictionary({})

      expect(result.items).toHaveLength(50)
      expect(result.cursor).toBeNull()
    })

    it('handles null payload', async () => {
      mockConnection.execute.mockResolvedValue({ rows: [] })

      const result = await service.getTablesDictionary(null)

      expect(result.items).toEqual([])
      expect(result.cursor).toBeNull()
    })

    it('parses cursor for offset', async () => {
      mockConnection.execute.mockResolvedValue({ rows: [] })

      await service.getTablesDictionary({ cursor: '200' })

      const binds = mockConnection.execute.mock.calls[0][1]

      expect(binds.rowOffset).toBe(200)
    })

    it('uses 0 offset when cursor is not a number', async () => {
      mockConnection.execute.mockResolvedValue({ rows: [] })

      await service.getTablesDictionary({ cursor: 'invalid' })

      const binds = mockConnection.execute.mock.calls[0][1]

      expect(binds.rowOffset).toBe(0)
    })
  })

  // ── getColumnsDictionary ──

  describe('getColumnsDictionary', () => {
    it('returns column items with label, value, note', async () => {
      mockConnection.execute.mockResolvedValue({
        rows: [
          { COLUMN_NAME: 'ID', DATA_TYPE: 'NUMBER' },
          { COLUMN_NAME: 'EMAIL', DATA_TYPE: 'VARCHAR2' },
        ],
      })

      const result = await service.getColumnsDictionary({ criteria: { table: 'EMPLOYEES' } })

      expect(result.items).toEqual([
        { label: 'ID', value: 'ID', note: 'NUMBER' },
        { label: 'EMAIL', value: 'EMAIL', note: 'VARCHAR2' },
      ])
      expect(result.cursor).toBeNull()
    })

    it('returns empty items when no table is specified', async () => {
      const result = await service.getColumnsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
      expect(mockGetConnection).not.toHaveBeenCalled()
    })

    it('returns empty items when criteria is null', async () => {
      const result = await service.getColumnsDictionary({ criteria: null })

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('returns empty items when payload is null', async () => {
      const result = await service.getColumnsDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('passes search pattern for filtering', async () => {
      mockConnection.execute.mockResolvedValue({ rows: [] })

      await service.getColumnsDictionary({ criteria: { table: 'EMPLOYEES' }, search: 'email' })

      const binds = mockConnection.execute.mock.calls[0][1]

      expect(binds.searchText).toBe('email')
      expect(binds.searchPattern).toBe('%EMAIL%')
    })

    it('passes table name via binds', async () => {
      mockConnection.execute.mockResolvedValue({ rows: [] })

      await service.getColumnsDictionary({ criteria: { table: 'EMPLOYEES' } })

      const binds = mockConnection.execute.mock.calls[0][1]

      expect(binds.tableName).toBe('EMPLOYEES')
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('includes ORA code in error message for errorNum', async () => {
      const error = new Error('invalid username/password')

      error.errorNum = 1017

      mockConnection.execute.mockRejectedValue(error)

      await expect(service.executeQuery('SELECT 1 FROM DUAL')).rejects.toThrow(/ORA-01017/)
    })

    it('includes authentication hint for ORA-01017', async () => {
      const error = new Error('invalid username/password')

      error.errorNum = 1017

      mockConnection.execute.mockRejectedValue(error)

      await expect(service.executeQuery('SELECT 1 FROM DUAL')).rejects.toThrow(
        /invalid username or password/
      )
    })

    it('includes listener hint for ORA-12154', async () => {
      const error = new Error('TNS:could not resolve the connect identifier')

      error.errorNum = 12154

      mockConnection.execute.mockRejectedValue(error)

      await expect(service.executeQuery('SELECT 1 FROM DUAL')).rejects.toThrow(
        /listener could not resolve/
      )
    })

    it('includes listener hint for ORA-12514', async () => {
      const error = new Error('TNS:listener does not currently know of service')

      error.errorNum = 12514

      mockConnection.execute.mockRejectedValue(error)

      await expect(service.executeQuery('SELECT 1 FROM DUAL')).rejects.toThrow(
        /listener could not resolve/
      )
    })

    it('includes listener hint for ORA-12541', async () => {
      const error = new Error('TNS:no listener')

      error.errorNum = 12541

      mockConnection.execute.mockRejectedValue(error)

      await expect(service.executeQuery('SELECT 1 FROM DUAL')).rejects.toThrow(
        /listener could not resolve/
      )
    })

    it('includes IPv6 hint for ENETUNREACH with IPv6 address', async () => {
      const error = new Error('connect ENETUNREACH')

      error.code = 'ENETUNREACH'
      error.address = '2001:db8::1'

      mockConnection.execute.mockRejectedValue(error)

      await expect(service.executeQuery('SELECT 1 FROM DUAL')).rejects.toThrow(/IPv6/)
    })

    it('does not include IPv6 hint for ENETUNREACH with IPv4 address', async () => {
      const error = new Error('connect ENETUNREACH')

      error.code = 'ENETUNREACH'
      error.address = '192.168.1.1'

      mockConnection.execute.mockRejectedValue(error)

      try {
        await service.executeQuery('SELECT 1 FROM DUAL')
        expect(true).toBe(false)
      } catch (thrown) {
        expect(thrown.message).toContain('Oracle Database error:')
        expect(thrown.message).not.toContain('IPv6')
      }
    })

    it('includes error.code in message', async () => {
      const error = new Error('some error')

      error.code = 'NJS-500'

      mockConnection.execute.mockRejectedValue(error)

      await expect(service.executeQuery('SELECT 1 FROM DUAL')).rejects.toThrow(/NJS-500/)
    })

    it('prefixes error message with Oracle Database error:', async () => {
      const error = new Error('something went wrong')

      mockConnection.execute.mockRejectedValue(error)

      await expect(service.executeQuery('SELECT 1 FROM DUAL')).rejects.toThrow(
        /^Oracle Database error:/
      )
    })
  })

  // ── Identifier quoting ──

  describe('identifier quoting', () => {
    it('escapes double quotes in identifiers', async () => {
      mockConnection.execute.mockResolvedValue({ rows: [] })

      await service.selectRows('my"table')

      const [sql] = mockConnection.execute.mock.calls[0]

      expect(sql).toContain('"my""table"')
    })

    it('throws on empty identifier', async () => {
      await expect(service.insertRow('EMPLOYEES', { '': 'value' })).rejects.toThrow(
        'Invalid identifier'
      )
    })

    it('throws on whitespace-only identifier', async () => {
      await expect(service.insertRow('EMPLOYEES', { '   ': 'value' })).rejects.toThrow(
        'Invalid identifier'
      )
    })
  })
})
