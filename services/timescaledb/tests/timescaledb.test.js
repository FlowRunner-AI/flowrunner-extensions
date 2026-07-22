'use strict'

// Mock pg before anything else
const mockQuery = jest.fn()
const mockConnect = jest.fn()
const mockEnd = jest.fn()

jest.mock('pg', () => ({
  Client: jest.fn(() => ({
    connect: mockConnect,
    end: mockEnd,
    query: mockQuery,
  })),
}))

const { createSandbox } = require('../../../service-sandbox')

describe('TimescaleDB Service', () => {
  let sandbox
  let service

  beforeAll(() => {
    sandbox = createSandbox({
      host: 'localhost',
      port: '5432',
      database: 'tsdb',
      user: 'tsdbadmin',
      password: 'secret',
      ssl: false,
      connectionTimeoutSeconds: '10',
    })

    require('../src/index.js')
    service = sandbox.getService()
  })

  afterEach(() => {
    mockQuery.mockReset()
    mockConnect.mockReset()
    mockEnd.mockReset()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Registration ──

  describe('service registration', () => {
    it('registers with correct config items', () => {
      const configItems = sandbox.getConfigItems()

      expect(configItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'connectionString', required: false, shared: false }),
          expect.objectContaining({ name: 'host', required: false, shared: false }),
          expect.objectContaining({ name: 'port', required: false, shared: false }),
          expect.objectContaining({ name: 'database', required: false, shared: false }),
          expect.objectContaining({ name: 'user', required: false, shared: false }),
          expect.objectContaining({ name: 'password', required: false, shared: false }),
          expect.objectContaining({ name: 'ssl', required: false, shared: false }),
          expect.objectContaining({ name: 'connectionTimeoutSeconds', required: false, shared: false }),
        ])
      )
    })
  })

  // ── SQL ──

  describe('executeQuery', () => {
    it('executes a SQL statement and returns rows, rowCount, fields', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 1, name: 'Ada' }],
        rowCount: 1,
        fields: [
          { name: 'id', dataTypeID: 23 },
          { name: 'name', dataTypeID: 1043 },
        ],
      })

      const result = await service.executeQuery('SELECT * FROM users WHERE id = $1', [1])

      expect(mockConnect).toHaveBeenCalledTimes(1)
      expect(mockQuery).toHaveBeenCalledWith('SELECT * FROM users WHERE id = $1', [1])
      expect(result).toEqual({
        rows: [{ id: 1, name: 'Ada' }],
        rowCount: 1,
        fields: [
          { name: 'id', dataTypeID: 23 },
          { name: 'name', dataTypeID: 1043 },
        ],
      })
      expect(mockEnd).toHaveBeenCalledTimes(1)
    })

    it('uses empty array when params is not an array', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0, fields: [] })

      await service.executeQuery('SELECT 1')

      expect(mockQuery).toHaveBeenCalledWith('SELECT 1', [])
    })

    it('throws when sql is empty', async () => {
      await expect(service.executeQuery('')).rejects.toThrow('SQL statement is required.')
    })

    it('throws when sql is not a string', async () => {
      await expect(service.executeQuery(null)).rejects.toThrow('SQL statement is required.')
    })

    it('handles null rows and fields gracefully', async () => {
      mockQuery.mockResolvedValueOnce({ rows: null, rowCount: 0, fields: null })

      const result = await service.executeQuery('SELECT 1')

      expect(result.rows).toEqual([])
      expect(result.fields).toEqual([])
    })

    it('throws on database error with code and detail', async () => {
      const dbError = new Error('relation "foo" does not exist')
      dbError.code = '42P01'
      dbError.detail = 'table not found'

      mockConnect.mockResolvedValueOnce()
      mockQuery.mockRejectedValueOnce(dbError)

      await expect(service.executeQuery('SELECT * FROM foo')).rejects.toThrow('TimescaleDB error')
    })
  })

  // ── Rows ──

  describe('selectRows', () => {
    it('selects all columns with no filters', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 1, name: 'Test' }],
        rowCount: 1,
      })

      const result = await service.selectRows('public.metrics')

      expect(mockQuery).toHaveBeenCalledTimes(1)
      const [sql, params] = mockQuery.mock.calls[0]

      expect(sql).toContain('SELECT *')
      expect(sql).toContain('"public"."metrics"')
      expect(params).toEqual([])
      expect(result).toEqual({ rows: [{ id: 1, name: 'Test' }], rowCount: 1 })
    })

    it('selects specific columns', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 })

      await service.selectRows('metrics', ['time', 'temperature'])

      const [sql] = mockQuery.mock.calls[0]

      expect(sql).toContain('"time", "temperature"')
    })

    it('applies where conditions with equality', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 })

      await service.selectRows('metrics', null, { device_id: 'sensor-1' })

      const [sql, params] = mockQuery.mock.calls[0]

      expect(sql).toContain('WHERE')
      expect(sql).toContain('"device_id" = $1')
      expect(params).toEqual(['sensor-1'])
    })

    it('applies where conditions with null (IS NULL)', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 })

      await service.selectRows('metrics', null, { deleted_at: null })

      const [sql] = mockQuery.mock.calls[0]

      expect(sql).toContain('"deleted_at" IS NULL')
    })

    it('applies where conditions with array (ANY)', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 })

      await service.selectRows('metrics', null, { status: ['active', 'pending'] })

      const [sql, params] = mockQuery.mock.calls[0]

      expect(sql).toContain('"status" = ANY($1)')
      expect(params).toEqual([['active', 'pending']])
    })

    it('applies order by ascending', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 })

      await service.selectRows('metrics', null, null, 'time', 'Ascending')

      const [sql] = mockQuery.mock.calls[0]

      expect(sql).toContain('ORDER BY "time" ASC')
    })

    it('applies order by descending', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 })

      await service.selectRows('metrics', null, null, 'time', 'Descending')

      const [sql] = mockQuery.mock.calls[0]

      expect(sql).toContain('ORDER BY "time" DESC')
    })

    it('applies limit and offset', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 })

      await service.selectRows('metrics', null, null, null, null, 10, 20)

      const [sql, params] = mockQuery.mock.calls[0]

      expect(sql).toContain('LIMIT $1')
      expect(sql).toContain('OFFSET $2')
      expect(params).toEqual([10, 20])
    })

    it('defaults to public schema when not qualified', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 })

      await service.selectRows('metrics')

      const [sql] = mockQuery.mock.calls[0]

      expect(sql).toContain('"public"."metrics"')
    })
  })

  describe('insertRow', () => {
    it('inserts a row and returns it via RETURNING *', async () => {
      const insertedRow = { time: '2026-01-01', device_id: 'sensor-1', temperature: 21.4 }

      mockQuery.mockResolvedValueOnce({ rows: [insertedRow], rowCount: 1 })

      const result = await service.insertRow('metrics', {
        time: '2026-01-01',
        device_id: 'sensor-1',
        temperature: 21.4,
      })

      const [sql, params] = mockQuery.mock.calls[0]

      expect(sql).toContain('INSERT INTO')
      expect(sql).toContain('RETURNING *')
      expect(params).toEqual(['2026-01-01', 'sensor-1', 21.4])
      expect(result).toEqual({ row: insertedRow })
    })

    it('throws when data is empty', async () => {
      await expect(service.insertRow('metrics', {})).rejects.toThrow('Data must be a non-empty object.')
    })

    it('throws when data is not an object', async () => {
      await expect(service.insertRow('metrics', 'invalid')).rejects.toThrow('Data must be a non-empty object.')
    })

    it('throws when data is null', async () => {
      await expect(service.insertRow('metrics', null)).rejects.toThrow('Data must be a non-empty object.')
    })

    it('returns null row when no row is returned', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 })

      const result = await service.insertRow('metrics', { time: '2026-01-01' })

      expect(result).toEqual({ row: null })
    })
  })

  describe('insertRows', () => {
    it('bulk inserts rows and returns them', async () => {
      const rows = [
        { time: '2026-01-01', temperature: 21.4 },
        { time: '2026-01-02', temperature: 21.6 },
      ]

      mockQuery.mockResolvedValueOnce({ rows, rowCount: 2 })

      const result = await service.insertRows('metrics', rows)

      const [sql, params] = mockQuery.mock.calls[0]

      expect(sql).toContain('INSERT INTO')
      expect(sql).toContain('RETURNING *')
      expect(params).toEqual(['2026-01-01', 21.4, '2026-01-02', 21.6])
      expect(result).toEqual({ rows, insertedCount: 2 })
    })

    it('throws when rows is empty array', async () => {
      await expect(service.insertRows('metrics', [])).rejects.toThrow('Rows must be a non-empty array')
    })

    it('throws when rows is not an array', async () => {
      await expect(service.insertRows('metrics', 'invalid')).rejects.toThrow('Rows must be a non-empty array')
    })

    it('handles rows with different column sets (union of keys)', async () => {
      const rows = [
        { time: '2026-01-01', temperature: 21.4 },
        { time: '2026-01-02', humidity: 50 },
      ]

      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 2 })

      await service.insertRows('metrics', rows)

      const [sql, params] = mockQuery.mock.calls[0]

      // Should have 3 columns (time, temperature, humidity)
      expect(sql).toContain('"time"')
      expect(sql).toContain('"temperature"')
      expect(sql).toContain('"humidity"')
      // Missing keys should be null
      expect(params).toContain(null)
    })

    it('throws when a row in the array is empty', async () => {
      await expect(service.insertRows('metrics', [{}])).rejects.toThrow('Rows[0] must be a non-empty object.')
    })
  })

  describe('updateRows', () => {
    it('updates rows matching where conditions', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ device_id: 'sensor-1', status: 'archived' }],
        rowCount: 1,
      })

      const result = await service.updateRows('metrics', { status: 'archived' }, { device_id: 'sensor-1' })

      const [sql, params] = mockQuery.mock.calls[0]

      expect(sql).toContain('UPDATE')
      expect(sql).toContain('SET "status" = $1')
      expect(sql).toContain('WHERE')
      expect(sql).toContain('RETURNING *')
      expect(params[0]).toBe('archived')
      expect(result).toEqual({
        rows: [{ device_id: 'sensor-1', status: 'archived' }],
        updatedCount: 1,
      })
    })

    it('throws when data is empty', async () => {
      await expect(service.updateRows('metrics', {}, { id: 1 })).rejects.toThrow('Data must be a non-empty object.')
    })

    it('throws when where is empty', async () => {
      await expect(service.updateRows('metrics', { status: 'x' }, {})).rejects.toThrow(
        'Where must be a non-empty object.'
      )
    })
  })

  describe('deleteRows', () => {
    it('deletes rows matching where conditions', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 3 })

      const result = await service.deleteRows('metrics', { status: 'archived' })

      const [sql, params] = mockQuery.mock.calls[0]

      expect(sql).toContain('DELETE FROM')
      expect(sql).toContain('WHERE')
      expect(params).toEqual(['archived'])
      expect(result).toEqual({ deletedCount: 3 })
    })

    it('throws when where is empty', async () => {
      await expect(service.deleteRows('metrics', {})).rejects.toThrow('Where must be a non-empty object.')
    })
  })

  describe('upsertRow', () => {
    it('upserts a row with DO UPDATE when non-conflict columns exist', async () => {
      const row = { time: '2026-01-01', device_id: 'sensor-1', temperature: 21.4 }

      mockQuery.mockResolvedValueOnce({ rows: [row], rowCount: 1 })

      const result = await service.upsertRow('metrics', row, ['time', 'device_id'])

      const [sql] = mockQuery.mock.calls[0]

      expect(sql).toContain('INSERT INTO')
      expect(sql).toContain('ON CONFLICT')
      expect(sql).toContain('DO UPDATE SET')
      expect(sql).toContain('EXCLUDED')
      expect(sql).toContain('RETURNING *')
      expect(result).toEqual({ row })
    })

    it('uses DO NOTHING when all columns are conflict columns', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 })

      await service.upsertRow('metrics', { time: '2026-01-01' }, ['time'])

      const [sql] = mockQuery.mock.calls[0]

      expect(sql).toContain('DO NOTHING')
      expect(sql).not.toContain('DO UPDATE')
    })

    it('throws when data is empty', async () => {
      await expect(service.upsertRow('metrics', {}, ['time'])).rejects.toThrow('Data must be a non-empty object.')
    })

    it('throws when conflictColumns is empty', async () => {
      await expect(service.upsertRow('metrics', { time: '2026-01-01' }, [])).rejects.toThrow(
        'Conflict Columns must be a non-empty array'
      )
    })

    it('throws when conflictColumns is not an array', async () => {
      await expect(service.upsertRow('metrics', { time: '2026-01-01' }, 'time')).rejects.toThrow(
        'Conflict Columns must be a non-empty array'
      )
    })
  })

  // ── Schema ──

  describe('getTableSchema', () => {
    it('returns column definitions for a table', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            column_name: 'time',
            data_type: 'timestamp with time zone',
            udt_name: 'timestamptz',
            is_nullable: 'NO',
            column_default: null,
            character_maximum_length: null,
            ordinal_position: 1,
          },
          {
            column_name: 'device_id',
            data_type: 'text',
            udt_name: 'text',
            is_nullable: 'YES',
            column_default: null,
            character_maximum_length: null,
            ordinal_position: 2,
          },
        ],
      })

      const result = await service.getTableSchema('public.metrics')

      const [sql, params] = mockQuery.mock.calls[0]

      expect(sql).toContain('information_schema.columns')
      expect(params).toEqual(['public', 'metrics'])
      expect(result).toEqual({
        schema: 'public',
        table: 'metrics',
        columns: [
          {
            name: 'time',
            type: 'timestamp with time zone',
            udtName: 'timestamptz',
            nullable: false,
            default: null,
            maxLength: null,
            position: 1,
          },
          {
            name: 'device_id',
            type: 'text',
            udtName: 'text',
            nullable: true,
            default: null,
            maxLength: null,
            position: 2,
          },
        ],
      })
    })

    it('defaults to public schema when not qualified', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ column_name: 'id', data_type: 'integer', udt_name: 'int4', is_nullable: 'NO', column_default: null, character_maximum_length: null, ordinal_position: 1 }] })

      await service.getTableSchema('users')

      const [, params] = mockQuery.mock.calls[0]

      expect(params).toEqual(['public', 'users'])
    })

    it('throws when table is not found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] })

      await expect(service.getTableSchema('nonexistent')).rejects.toThrow(
        'Table "public.nonexistent" was not found or has no columns.'
      )
    })

    it('throws when table name is empty', async () => {
      await expect(service.getTableSchema('')).rejects.toThrow('Table name is required')
    })
  })

  describe('listTables', () => {
    it('returns all user-schema tables and views', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { table_schema: 'public', table_name: 'metrics', table_type: 'BASE TABLE' },
          { table_schema: 'public', table_name: 'recent_view', table_type: 'VIEW' },
        ],
        rowCount: 2,
      })

      const result = await service.listTables()

      const [sql] = mockQuery.mock.calls[0]

      expect(sql).toContain('information_schema.tables')
      expect(sql).toContain("NOT IN ('pg_catalog', 'information_schema')")
      expect(result).toEqual({
        tables: [
          { schema: 'public', name: 'metrics', type: 'BASE TABLE' },
          { schema: 'public', name: 'recent_view', type: 'VIEW' },
        ],
        count: 2,
      })
    })
  })

  // ── Hypertables ──

  describe('createHypertable', () => {
    it('creates a hypertable with defaults', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ hypertable_id: 1, schema_name: 'public', table_name: 'metrics', created: true }],
      })

      const result = await service.createHypertable('metrics', 'time')

      const [sql, params] = mockQuery.mock.calls[0]

      expect(sql).toContain('create_hypertable')
      expect(sql).toContain('by_range($2)')
      expect(params[1]).toBe('time')
      expect(result.hypertable).toBeDefined()
    })

    it('creates a hypertable with chunk time interval', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{}] })

      await service.createHypertable('metrics', 'time', '7 days')

      const [sql] = mockQuery.mock.calls[0]

      expect(sql).toContain("chunk_time_interval => INTERVAL '7 days'")
    })

    it('creates a hypertable with migrate data', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{}] })

      await service.createHypertable('metrics', 'time', null, true)

      const [sql] = mockQuery.mock.calls[0]

      expect(sql).toContain('migrate_data => TRUE')
    })

    it('throws when timeColumn is empty', async () => {
      await expect(service.createHypertable('metrics', '')).rejects.toThrow('Time Column is required.')
    })

    it('throws when timeColumn is not a string', async () => {
      await expect(service.createHypertable('metrics', null)).rejects.toThrow('Time Column is required.')
    })
  })

  describe('listHypertables', () => {
    it('returns all hypertables', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            hypertable_schema: 'public',
            hypertable_name: 'metrics',
            owner: 'tsdbadmin',
            num_dimensions: 1,
            num_chunks: 12,
            compression_enabled: true,
            tablespaces: null,
          },
        ],
        rowCount: 1,
      })

      const result = await service.listHypertables()

      expect(result).toEqual({
        hypertables: [
          {
            schema: 'public',
            name: 'metrics',
            owner: 'tsdbadmin',
            numDimensions: 1,
            numChunks: 12,
            compressionEnabled: true,
            tablespaces: null,
          },
        ],
        count: 1,
      })
    })
  })

  describe('getHypertableChunks', () => {
    it('returns chunks for a hypertable', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            chunk_schema: '_timescaledb_internal',
            chunk_name: '_hyper_1_1_chunk',
            range_start: '2026-01-01T00:00:00.000Z',
            range_end: '2026-01-08T00:00:00.000Z',
            is_compressed: false,
          },
        ],
        rowCount: 1,
      })

      const result = await service.getHypertableChunks('public.metrics')

      const [sql, params] = mockQuery.mock.calls[0]

      expect(sql).toContain('timescaledb_information.chunks')
      expect(params).toEqual(['public', 'metrics'])
      expect(result).toEqual({
        chunks: [
          {
            chunkSchema: '_timescaledb_internal',
            chunkName: '_hyper_1_1_chunk',
            rangeStart: '2026-01-01T00:00:00.000Z',
            rangeEnd: '2026-01-08T00:00:00.000Z',
            isCompressed: false,
          },
        ],
        count: 1,
      })
    })
  })

  // ── Time-Series Analytics ──

  describe('timeBucketQuery', () => {
    it('builds a time bucket query with required params', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ bucket: '2026-01-01T00:00:00.000Z', avg_temp: 21.4 }],
        rowCount: 1,
      })

      const result = await service.timeBucketQuery(
        'metrics',
        'time',
        '1 hour',
        'avg(temperature) AS avg_temp'
      )

      const [sql] = mockQuery.mock.calls[0]

      expect(sql).toContain("time_bucket(INTERVAL '1 hour'")
      expect(sql).toContain('avg(temperature) AS avg_temp')
      expect(sql).toContain('GROUP BY bucket')
      expect(sql).toContain('ORDER BY bucket')
      expect(result.rows).toHaveLength(1)
    })

    it('includes WHERE clause when provided', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 })

      await service.timeBucketQuery(
        'metrics',
        'time',
        '1 hour',
        'avg(temperature) AS avg_temp',
        "device_id = 'sensor-1'"
      )

      const [sql] = mockQuery.mock.calls[0]

      expect(sql).toContain("WHERE device_id = 'sensor-1'")
    })

    it('includes LIMIT when provided', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 })

      await service.timeBucketQuery('metrics', 'time', '1 hour', 'count(*)', null, 10)

      const [sql, params] = mockQuery.mock.calls[0]

      expect(sql).toContain('LIMIT $1')
      expect(params).toEqual([10])
    })

    it('throws when timeColumn is empty', async () => {
      await expect(service.timeBucketQuery('metrics', '', '1 hour', 'count(*)')).rejects.toThrow(
        'Time Column is required.'
      )
    })

    it('throws when aggregations is empty', async () => {
      await expect(service.timeBucketQuery('metrics', 'time', '1 hour', '')).rejects.toThrow(
        'Aggregations is required'
      )
    })

    it('throws when interval is invalid', async () => {
      await expect(service.timeBucketQuery('metrics', 'time', "1'; DROP TABLE--", 'count(*)')).rejects.toThrow(
        'is not a valid interval'
      )
    })
  })

  // ── Compression & Retention ──

  describe('enableCompression', () => {
    it('enables compression without options', async () => {
      mockQuery.mockResolvedValueOnce({}) // ALTER TABLE

      const result = await service.enableCompression('metrics')

      const [sql] = mockQuery.mock.calls[0]

      expect(sql).toContain('ALTER TABLE')
      expect(sql).toContain('timescaledb.compress')
      expect(result).toEqual({ compressionEnabled: true, policyScheduled: false, olderThan: null })
    })

    it('enables compression with segmentBy and orderBy', async () => {
      mockQuery.mockResolvedValueOnce({})

      await service.enableCompression('metrics', 'device_id', 'time')

      const [sql] = mockQuery.mock.calls[0]

      expect(sql).toContain("timescaledb.compress_segmentby = 'device_id'")
      expect(sql).toContain("timescaledb.compress_orderby = 'time DESC'")
    })

    it('enables compression with auto-policy', async () => {
      mockQuery.mockResolvedValueOnce({}) // ALTER TABLE
      mockQuery.mockResolvedValueOnce({}) // add_compression_policy

      const result = await service.enableCompression('metrics', null, null, '7 days')

      expect(mockQuery).toHaveBeenCalledTimes(2)
      const [policySql] = mockQuery.mock.calls[1]

      expect(policySql).toContain('add_compression_policy')
      expect(policySql).toContain("INTERVAL '7 days'")
      expect(result).toEqual({ compressionEnabled: true, policyScheduled: true, olderThan: '7 days' })
    })
  })

  describe('createContinuousAggregate', () => {
    it('creates a continuous aggregate materialized view', async () => {
      mockQuery.mockResolvedValueOnce({})

      const selectBody =
        "SELECT time_bucket('1 hour', time) AS bucket, device_id, avg(temperature) AS avg_temp FROM metrics GROUP BY bucket, device_id"

      const result = await service.createContinuousAggregate('metrics_hourly', selectBody)

      const [sql] = mockQuery.mock.calls[0]

      expect(sql).toContain('CREATE MATERIALIZED VIEW')
      expect(sql).toContain('timescaledb.continuous')
      expect(sql).toContain('WITH NO DATA')
      expect(sql).toContain('time_bucket')
      expect(result).toEqual({ view: 'metrics_hourly', created: true })
    })

    it('strips trailing semicolons from selectBody', async () => {
      mockQuery.mockResolvedValueOnce({})

      await service.createContinuousAggregate('view1', 'SELECT 1 ;')

      const [sql] = mockQuery.mock.calls[0]

      expect(sql).not.toContain(';')
    })

    it('throws when view name is empty', async () => {
      await expect(service.createContinuousAggregate('', 'SELECT 1')).rejects.toThrow('View Name is required.')
    })

    it('throws when selectBody is empty', async () => {
      await expect(service.createContinuousAggregate('v1', '')).rejects.toThrow('Select Body is required')
    })
  })

  describe('showChunks', () => {
    it('shows all chunks of a hypertable', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ chunk: '_timescaledb_internal._hyper_1_1_chunk' }],
        rowCount: 1,
      })

      const result = await service.showChunks('metrics')

      const [sql] = mockQuery.mock.calls[0]

      expect(sql).toContain('show_chunks')
      expect(result).toEqual({
        chunks: ['_timescaledb_internal._hyper_1_1_chunk'],
        count: 1,
      })
    })

    it('filters chunks older than a given interval', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 })

      await service.showChunks('metrics', '30 days')

      const [sql] = mockQuery.mock.calls[0]

      expect(sql).toContain("older_than => INTERVAL '30 days'")
    })
  })

  describe('dropChunks', () => {
    it('drops chunks older than the given interval', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ chunk: '_timescaledb_internal._hyper_1_1_chunk' }],
        rowCount: 1,
      })

      const result = await service.dropChunks('metrics', '90 days')

      const [sql] = mockQuery.mock.calls[0]

      expect(sql).toContain('drop_chunks')
      expect(sql).toContain("older_than => INTERVAL '90 days'")
      expect(result).toEqual({
        droppedChunks: ['_timescaledb_internal._hyper_1_1_chunk'],
        count: 1,
      })
    })

    it('throws when olderThan is empty', async () => {
      await expect(service.dropChunks('metrics', '')).rejects.toThrow('is required')
    })
  })

  // ── Dictionaries ──

  describe('getTablesDictionary', () => {
    it('returns mapped items with label, value, note', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { table_schema: 'public', table_name: 'metrics', table_type: 'BASE TABLE' },
        ],
      })

      const result = await service.getTablesDictionary({})

      expect(result).toEqual({
        items: [
          { label: 'metrics', value: 'public.metrics', note: 'public · BASE TABLE' },
        ],
        cursor: null,
      })
    })

    it('passes search filter as ILIKE parameter', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] })

      await service.getTablesDictionary({ search: 'met' })

      const [, params] = mockQuery.mock.calls[0]

      expect(params[0]).toBe('%met%')
    })

    it('handles null payload', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] })

      const result = await service.getTablesDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('returns cursor when more results exist', async () => {
      const rows = Array.from({ length: 201 }, (_, i) => ({
        table_schema: 'public',
        table_name: `table_${i}`,
        table_type: 'BASE TABLE',
      }))

      mockQuery.mockResolvedValueOnce({ rows })

      const result = await service.getTablesDictionary({})

      expect(result.items).toHaveLength(200)
      expect(result.cursor).toBe('200')
    })

    it('uses cursor for offset', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] })

      await service.getTablesDictionary({ cursor: '200' })

      const [, params] = mockQuery.mock.calls[0]

      expect(params[2]).toBe(200) // offset
    })
  })

  describe('getHypertablesDictionary', () => {
    it('returns mapped hypertable items', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { hypertable_schema: 'public', hypertable_name: 'metrics', num_chunks: 12 },
        ],
      })

      const result = await service.getHypertablesDictionary({})

      expect(result).toEqual({
        items: [
          { label: 'metrics', value: 'public.metrics', note: 'public · 12 chunks' },
        ],
        cursor: null,
      })
    })

    it('handles null payload', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] })

      const result = await service.getHypertablesDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getColumnsDictionary', () => {
    it('returns column items with data type as note', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { column_name: 'time', data_type: 'timestamp with time zone' },
          { column_name: 'device_id', data_type: 'text' },
        ],
      })

      const result = await service.getColumnsDictionary({ criteria: { table: 'metrics' } })

      expect(result).toEqual({
        items: [
          { label: 'time', value: 'time', note: 'timestamp with time zone' },
          { label: 'device_id', value: 'device_id', note: 'text' },
        ],
        cursor: null,
      })
    })

    it('returns empty items when no table is specified', async () => {
      const result = await service.getColumnsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('returns empty items when payload is null', async () => {
      const result = await service.getColumnsDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('passes search filter for columns', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] })

      await service.getColumnsDictionary({ criteria: { table: 'metrics' }, search: 'temp' })

      const [, params] = mockQuery.mock.calls[0]

      expect(params[2]).toBe('%temp%')
    })
  })

  // ── Connection Error Handling ──

  describe('error handling', () => {
    it('includes error code and detail in thrown error', async () => {
      const dbError = new Error('duplicate key value')
      dbError.code = '23505'
      dbError.detail = 'Key (id)=(1) already exists.'

      mockConnect.mockResolvedValueOnce()
      mockQuery.mockRejectedValueOnce(dbError)

      await expect(service.executeQuery('INSERT INTO t VALUES (1)')).rejects.toThrow(
        /duplicate key value.*code: 23505.*detail: Key/
      )
    })

    it('includes hint in thrown error', async () => {
      const dbError = new Error('relation does not exist')
      dbError.hint = 'Try checking the schema.'

      mockConnect.mockResolvedValueOnce()
      mockQuery.mockRejectedValueOnce(dbError)

      await expect(service.executeQuery('SELECT * FROM foo')).rejects.toThrow(/hint: Try checking/)
    })

    it('adds IPv6 hint for ENETUNREACH errors with IPv6 address', async () => {
      const dbError = new Error('connect ENETUNREACH')
      dbError.code = 'ENETUNREACH'
      dbError.address = '::1'

      mockConnect.mockRejectedValueOnce(dbError)

      await expect(service.executeQuery('SELECT 1')).rejects.toThrow(/IPv6/)
    })

    it('always calls client.end() even on error', async () => {
      mockConnect.mockResolvedValueOnce()
      mockQuery.mockRejectedValueOnce(new Error('query failed'))

      await expect(service.executeQuery('SELECT 1')).rejects.toThrow()

      expect(mockEnd).toHaveBeenCalledTimes(1)
    })
  })

  // ── Input Validation ──

  describe('input validation', () => {
    it('throws on invalid identifier (empty string)', async () => {
      await expect(service.selectRows('metrics', [''])).rejects.toThrow('Invalid identifier')
    })

    it('escapes double quotes in identifiers', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 })

      await service.selectRows('metrics', ['col"name'])

      const [sql] = mockQuery.mock.calls[0]

      expect(sql).toContain('"col""name"')
    })

    it('throws on invalid interval with single quote injection', async () => {
      await expect(service.timeBucketQuery('metrics', 'time', "1'; DROP TABLE--", 'count(*)')).rejects.toThrow(
        'is not a valid interval'
      )
    })
  })
})
