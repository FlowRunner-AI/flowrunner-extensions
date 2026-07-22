'use strict'

const { createSandbox } = require('../../../service-sandbox')

// The service talks to PostgreSQL through the `pg` driver rather than Flowrunner.Request,
// so the driver is mocked virtually (the package is not installed in this workspace).
let mockClients = []
let mockQueryImpl = () => ({ rows: [], rowCount: 0, fields: [] })
let mockConnectError = null
let mockEndError = null

jest.mock(
  'pg',
  () => {
    class Client {
      constructor(config) {
        this.config = config
        this.queries = []
        this.connected = false
        this.ended = false

        mockClients.push(this)
      }

      async connect() {
        if (mockConnectError) {
          throw mockConnectError
        }

        this.connected = true
      }

      async query(sql, params) {
        this.queries.push({ sql, params })

        return mockQueryImpl(sql, params)
      }

      async end() {
        if (mockEndError) {
          throw mockEndError
        }

        this.ended = true
      }
    }

    return { Client }
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

function lastQuery() {
  return mockClients[mockClients.length - 1].queries[0]
}

describe('PostgreSQL Service', () => {
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
    mockClients = []
    mockConnectError = null
    mockEndError = null
    mockQueryImpl = () => ({ rows: [], rowCount: 0, fields: [] })

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
        'ssl',
        'connectionTimeoutSeconds',
      ])

      items.forEach(item => {
        expect(item.required).toBe(false)
        expect(item.shared).toBe(false)
      })

      expect(items.find(item => item.name === 'ssl').type).toBe('BOOL')
      expect(items.find(item => item.name === 'port').defaultValue).toBe('5432')
    })
  })

  // ── Connection configuration ──

  describe('client configuration', () => {
    it('builds a config from the individual fields with defaults', async () => {
      await service.listTables()

      expect(mockClients).toHaveLength(1)

      expect(mockClients[0].config).toEqual({
        host: 'db.example.com',
        port: 5432,
        database: 'app',
        user: 'admin',
        password: 'secret',
        ssl: false,
        connectionTimeoutMillis: 10000,
        statement_timeout: 120000,
        query_timeout: 120000,
        application_name: 'flowrunner-postgresql',
      })
    })

    it('honours the port, ssl toggle and connection timeout', async () => {
      build({ ...BASE_CONFIG, port: '6543', ssl: 'true', connectionTimeoutSeconds: '30' })

      await service.listTables()

      expect(mockClients[0].config).toMatchObject({
        port: 6543,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 30000,
      })
    })

    it('falls back to the default timeout for invalid values', async () => {
      build({ ...BASE_CONFIG, port: 'abc', connectionTimeoutSeconds: '0' })

      await service.listTables()

      expect(mockClients[0].config).toMatchObject({ port: 5432, connectionTimeoutMillis: 10000 })
    })

    it('prefers the connection string and omits ssl when the toggle is off', async () => {
      build({ ...BASE_CONFIG, connectionString: '  postgresql://u:p@db.host:5432/app  ' })

      await service.listTables()

      expect(mockClients[0].config).toEqual({
        connectionString: 'postgresql://u:p@db.host:5432/app',
        connectionTimeoutMillis: 10000,
        statement_timeout: 120000,
        query_timeout: 120000,
        application_name: 'flowrunner-postgresql',
      })
    })

    it('adds permissive ssl on top of the connection string when enabled', async () => {
      build({ connectionString: 'postgresql://u:p@db.host:5432/app', ssl: true })

      await service.listTables()

      expect(mockClients[0].config.ssl).toEqual({ rejectUnauthorized: false })
    })

    it('throws a helpful error when the configuration is incomplete', async () => {
      build({})

      // The config is built as the pg.Client constructor argument, so no client is created.
      await expect(service.listTables()).rejects.toThrow(/incomplete connection configuration/)
      expect(mockClients).toHaveLength(0)
    })

    it('always closes the client, even on failure', async () => {
      mockQueryImpl = () => {
        throw new Error('boom')
      }

      await expect(service.listTables()).rejects.toThrow('PostgreSQL error: boom')
      expect(mockClients[0].ended).toBe(true)
    })

    it('swallows errors raised while closing the client', async () => {
      mockEndError = new Error('close failed')

      await expect(service.listTables()).resolves.toBeDefined()
    })

    it('surfaces connection errors', async () => {
      mockConnectError = Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' })

      await expect(service.listTables()).rejects.toThrow(
        'PostgreSQL error: connection refused | code: ECONNREFUSED'
      )
    })
  })

  // ── Error decoration ──

  describe('error decoration', () => {
    it('appends code, detail and hint', async () => {
      mockQueryImpl = () => {
        throw Object.assign(new Error('duplicate key'), {
          code: '23505',
          detail: 'Key (id)=(1) already exists.',
          hint: 'Use upsert.',
        })
      }

      await expect(service.listTables()).rejects.toThrow(
        'PostgreSQL error: duplicate key | code: 23505 | detail: Key (id)=(1) already exists. | hint: Use upsert.'
      )
    })

    it('adds the IPv6 hint for ENETUNREACH against an IPv6 address', async () => {
      mockConnectError = Object.assign(new Error('connect ENETUNREACH'), {
        code: 'ENETUNREACH',
        address: '2600:1f16::1',
      })

      await expect(service.listTables()).rejects.toThrow(/IPv6-only address/)
    })

    it('does not add the IPv6 hint for an IPv4 address', async () => {
      mockConnectError = Object.assign(new Error('connect ENETUNREACH'), {
        code: 'ENETUNREACH',
        address: '10.0.0.1',
      })

      await expect(service.listTables()).rejects.not.toThrow(/IPv6-only address/)
    })
  })

  // ── SQL ──

  describe('executeQuery', () => {
    it('runs the statement and normalizes the result', async () => {
      mockQueryImpl = () => ({
        rows: [{ id: 1 }],
        rowCount: 1,
        fields: [{ name: 'id', dataTypeID: 23, extra: 'ignored' }],
      })

      const result = await service.executeQuery('SELECT * FROM users WHERE id = $1', [1])

      expect(result).toEqual({
        rows: [{ id: 1 }],
        rowCount: 1,
        fields: [{ name: 'id', dataTypeID: 23 }],
      })

      expect(lastQuery()).toEqual({ sql: 'SELECT * FROM users WHERE id = $1', params: [1] })
    })

    it('defaults missing params to an empty array and tolerates missing result fields', async () => {
      mockQueryImpl = () => ({ rowCount: 0 })

      const result = await service.executeQuery('SELECT 1')

      expect(result).toEqual({ rows: [], rowCount: 0, fields: [] })
      expect(lastQuery().params).toEqual([])
    })

    it('rejects a missing or blank statement', async () => {
      await expect(service.executeQuery('  ')).rejects.toThrow('SQL statement is required.')
      await expect(service.executeQuery(null)).rejects.toThrow('SQL statement is required.')
      expect(mockClients).toHaveLength(0)
    })
  })

  // ── Rows ──

  describe('selectRows', () => {
    it('selects every column from a public table by default', async () => {
      mockQueryImpl = () => ({ rows: [{ id: 1 }], rowCount: 1 })

      const result = await service.selectRows('users')

      expect(result).toEqual({ rows: [{ id: 1 }], rowCount: 1 })
      expect(lastQuery()).toEqual({ sql: 'SELECT * FROM "public"."users"', params: [] })
    })

    it('quotes a schema-qualified table and the selected columns', async () => {
      await service.selectRows('analytics.page_views', ['id', 'url'])

      expect(lastQuery().sql).toBe('SELECT "id", "url" FROM "analytics"."page_views"')
    })

    it('escapes embedded double quotes in identifiers', async () => {
      await service.selectRows('we"ird')

      expect(lastQuery().sql).toBe('SELECT * FROM "public"."we""ird"')
    })

    it('builds a parameterized WHERE clause with IS NULL and ANY', async () => {
      await service.selectRows('users', null, { status: 'active', deleted_at: null, role: ['a', 'b'] })

      expect(lastQuery()).toEqual({
        sql: 'SELECT * FROM "public"."users" WHERE "status" = $1 AND "deleted_at" IS NULL AND "role" = ANY($2)',
        params: ['active', ['a', 'b']],
      })
    })

    it('applies ordering, limit and offset', async () => {
      await service.selectRows('users', null, null, 'created_at', 'Descending', 10, 20)

      expect(lastQuery()).toEqual({
        sql: 'SELECT * FROM "public"."users" ORDER BY "created_at" DESC LIMIT $1 OFFSET $2',
        params: [10, 20],
      })
    })

    it('defaults the sort direction to ascending', async () => {
      await service.selectRows('users', null, null, 'name')

      expect(lastQuery().sql).toBe('SELECT * FROM "public"."users" ORDER BY "name" ASC')
    })

    it('ignores empty-string limit and offset', async () => {
      await service.selectRows('users', [], {}, null, null, '', '')

      expect(lastQuery()).toEqual({ sql: 'SELECT * FROM "public"."users"', params: [] })
    })

    it('rejects an invalid table name', async () => {
      await expect(service.selectRows('')).rejects.toThrow(
        'Table name is required and must be a non-empty string.'
      )

      await expect(service.selectRows(null)).rejects.toThrow(
        'Table name is required and must be a non-empty string.'
      )
    })

    it('rejects an invalid column identifier', async () => {
      await expect(service.selectRows('users', [''])).rejects.toThrow(/Invalid identifier/)
    })
  })

  describe('insertRow', () => {
    it('inserts and returns the created row', async () => {
      mockQueryImpl = () => ({ rows: [{ id: 1, name: 'Ada' }], rowCount: 1 })

      const result = await service.insertRow('users', { name: 'Ada', age: 36 })

      expect(result).toEqual({ row: { id: 1, name: 'Ada' } })

      expect(lastQuery()).toEqual({
        sql: 'INSERT INTO "public"."users" ("name", "age") VALUES ($1, $2) RETURNING *',
        params: ['Ada', 36],
      })
    })

    it('returns null when nothing is returned', async () => {
      mockQueryImpl = () => ({ rows: [], rowCount: 0 })

      await expect(service.insertRow('users', { name: 'Ada' })).resolves.toEqual({ row: null })
    })

    it('rejects invalid data', async () => {
      await expect(service.insertRow('users', {})).rejects.toThrow('Data must be a non-empty object.')
      await expect(service.insertRow('users', [{ a: 1 }])).rejects.toThrow('Data must be a non-empty object.')
      await expect(service.insertRow('users', null)).rejects.toThrow('Data must be a non-empty object.')
    })
  })

  describe('insertRows', () => {
    it('inserts a batch using the union of all keys', async () => {
      mockQueryImpl = () => ({ rows: [{ id: 1 }, { id: 2 }], rowCount: 2 })

      const result = await service.insertRows('users', [{ name: 'Ada' }, { name: 'Bob', age: 30 }])

      expect(result).toEqual({ rows: [{ id: 1 }, { id: 2 }], insertedCount: 2 })

      expect(lastQuery()).toEqual({
        sql: 'INSERT INTO "public"."users" ("name", "age") VALUES ($1, $2), ($3, $4) RETURNING *',
        params: ['Ada', null, 'Bob', 30],
      })
    })

    it('rejects an empty batch', async () => {
      await expect(service.insertRows('users', [])).rejects.toThrow(
        'Rows must be a non-empty array of objects.'
      )

      await expect(service.insertRows('users', null)).rejects.toThrow(
        'Rows must be a non-empty array of objects.'
      )
    })

    it('reports the index of an invalid row', async () => {
      await expect(service.insertRows('users', [{ a: 1 }, {}])).rejects.toThrow(
        'Rows[1] must be a non-empty object.'
      )
    })
  })

  describe('updateRows', () => {
    it('updates the matching rows', async () => {
      mockQueryImpl = () => ({ rows: [{ id: 1, status: 'archived' }], rowCount: 1 })

      const result = await service.updateRows('users', { status: 'archived' }, { id: 1 })

      expect(result).toEqual({ rows: [{ id: 1, status: 'archived' }], updatedCount: 1 })

      expect(lastQuery()).toEqual({
        sql: 'UPDATE "public"."users" SET "status" = $1 WHERE "id" = $2 RETURNING *',
        params: ['archived', 1],
      })
    })

    it('rejects missing data or conditions', async () => {
      await expect(service.updateRows('users', {}, { id: 1 })).rejects.toThrow(
        'Data must be a non-empty object.'
      )

      await expect(service.updateRows('users', { a: 1 }, {})).rejects.toThrow(
        'Where must be a non-empty object.'
      )
    })
  })

  describe('deleteRows', () => {
    it('deletes the matching rows', async () => {
      mockQueryImpl = () => ({ rows: [], rowCount: 3 })

      const result = await service.deleteRows('users', { status: 'spam' })

      expect(result).toEqual({ deletedCount: 3 })

      expect(lastQuery()).toEqual({
        sql: 'DELETE FROM "public"."users" WHERE "status" = $1',
        params: ['spam'],
      })
    })

    it('refuses to delete without conditions', async () => {
      await expect(service.deleteRows('users', {})).rejects.toThrow('Where must be a non-empty object.')
      expect(mockClients).toHaveLength(0)
    })
  })

  describe('upsertRow', () => {
    it('updates the non-conflict columns on conflict', async () => {
      mockQueryImpl = () => ({ rows: [{ email: 'a@b.c' }], rowCount: 1 })

      const result = await service.upsertRow(
        'users',
        { email: 'a@b.c', name: 'Ada', age: 36 },
        ['email']
      )

      expect(result).toEqual({ row: { email: 'a@b.c' } })

      expect(lastQuery()).toEqual({
        sql:
          'INSERT INTO "public"."users" ("email", "name", "age") VALUES ($1, $2, $3) ' +
          'ON CONFLICT ("email") DO UPDATE SET "name" = EXCLUDED."name", "age" = EXCLUDED."age" RETURNING *',
        params: ['a@b.c', 'Ada', 36],
      })
    })

    it('does nothing when every column is a conflict column', async () => {
      await service.upsertRow('users', { email: 'a@b.c' }, ['email'])

      expect(lastQuery().sql).toBe(
        'INSERT INTO "public"."users" ("email") VALUES ($1) ON CONFLICT ("email") DO NOTHING RETURNING *'
      )
    })

    it('rejects missing data or conflict columns', async () => {
      await expect(service.upsertRow('users', {}, ['email'])).rejects.toThrow(
        'Data must be a non-empty object.'
      )

      await expect(service.upsertRow('users', { a: 1 }, [])).rejects.toThrow(
        'Conflict Columns must be a non-empty array of column names.'
      )

      await expect(service.upsertRow('users', { a: 1 }, null)).rejects.toThrow(
        'Conflict Columns must be a non-empty array of column names.'
      )
    })
  })

  // ── Schema ──

  describe('getTableSchema', () => {
    it('maps the information_schema columns', async () => {
      mockQueryImpl = () => ({
        rows: [
          {
            column_name: 'id',
            data_type: 'integer',
            udt_name: 'int4',
            is_nullable: 'NO',
            column_default: "nextval('users_id_seq')",
            character_maximum_length: null,
            ordinal_position: 1,
          },
          {
            column_name: 'email',
            data_type: 'character varying',
            udt_name: 'varchar',
            is_nullable: 'YES',
            column_default: null,
            character_maximum_length: 255,
            ordinal_position: 2,
          },
        ],
        rowCount: 2,
      })

      const result = await service.getTableSchema('analytics.users')

      expect(result).toEqual({
        schema: 'analytics',
        table: 'users',
        columns: [
          {
            name: 'id',
            type: 'integer',
            udtName: 'int4',
            nullable: false,
            default: "nextval('users_id_seq')",
            maxLength: null,
            position: 1,
          },
          {
            name: 'email',
            type: 'character varying',
            udtName: 'varchar',
            nullable: true,
            default: null,
            maxLength: 255,
            position: 2,
          },
        ],
      })

      const query = lastQuery()

      expect(query.params).toEqual(['analytics', 'users'])
      expect(sql(query.sql)).toContain('FROM information_schema.columns')
    })

    it('defaults to the public schema', async () => {
      mockQueryImpl = () => ({
        rows: [{ column_name: 'id', is_nullable: 'NO', ordinal_position: 1 }],
        rowCount: 1,
      })

      const result = await service.getTableSchema('users')

      expect(result.schema).toBe('public')
      expect(lastQuery().params).toEqual(['public', 'users'])
    })

    it('throws a wrapped error when the table has no columns', async () => {
      mockQueryImpl = () => ({ rows: [], rowCount: 0 })

      await expect(service.getTableSchema('users')).rejects.toThrow(
        'PostgreSQL error: Table "public.users" was not found or has no columns.'
      )
    })

    it('rejects an invalid table name', async () => {
      await expect(service.getTableSchema('')).rejects.toThrow(
        'Table name is required and must be a non-empty string.'
      )
    })
  })

  describe('listTables', () => {
    it('maps the user tables', async () => {
      mockQueryImpl = () => ({
        rows: [
          { table_schema: 'public', table_name: 'users', table_type: 'BASE TABLE' },
          { table_schema: 'public', table_name: 'active_users', table_type: 'VIEW' },
        ],
        rowCount: 2,
      })

      const result = await service.listTables()

      expect(result).toEqual({
        tables: [
          { schema: 'public', name: 'users', type: 'BASE TABLE' },
          { schema: 'public', name: 'active_users', type: 'VIEW' },
        ],
        count: 2,
      })

      expect(sql(lastQuery().sql)).toContain("WHERE table_schema NOT IN ('pg_catalog', 'information_schema')")
    })
  })

  // ── Dictionaries ──

  describe('getTablesDictionary', () => {
    it('maps the tables and reports no further pages', async () => {
      mockQueryImpl = () => ({
        rows: [{ table_schema: 'public', table_name: 'users', table_type: 'BASE TABLE' }],
        rowCount: 1,
      })

      const result = await service.getTablesDictionary({})

      expect(result).toEqual({
        items: [{ label: 'users', value: 'public.users', note: 'public · BASE TABLE' }],
        cursor: null,
      })

      expect(lastQuery().params).toEqual([null, 201, 0])
    })

    it('passes the search term as an ILIKE pattern', async () => {
      await service.getTablesDictionary({ search: 'user' })

      expect(lastQuery().params).toEqual(['%user%', 201, 0])
    })

    it('paginates using the cursor and trims the look-ahead row', async () => {
      const rows = Array.from({ length: 201 }, (_, index) => ({
        table_schema: 'public',
        table_name: `t${ index }`,
        table_type: 'BASE TABLE',
      }))

      mockQueryImpl = () => ({ rows, rowCount: rows.length })

      const result = await service.getTablesDictionary({ cursor: '200' })

      expect(lastQuery().params).toEqual([null, 201, 200])
      expect(result.items).toHaveLength(200)
      expect(result.cursor).toBe('400')
    })

    it('handles a null payload and a non-numeric cursor', async () => {
      await expect(service.getTablesDictionary(null)).resolves.toEqual({ items: [], cursor: null })
      expect(lastQuery().params).toEqual([null, 201, 0])

      await service.getTablesDictionary({ cursor: 'abc' })

      expect(lastQuery().params).toEqual([null, 201, 0])
    })
  })

  describe('getColumnsDictionary', () => {
    it('returns an empty result without a table criteria', async () => {
      await expect(service.getColumnsDictionary({})).resolves.toEqual({ items: [], cursor: null })
      await expect(service.getColumnsDictionary(null)).resolves.toEqual({ items: [], cursor: null })
      expect(mockClients).toHaveLength(0)
    })

    it('maps the columns of the selected table', async () => {
      mockQueryImpl = () => ({
        rows: [
          { column_name: 'id', data_type: 'integer' },
          { column_name: 'email', data_type: 'text' },
        ],
        rowCount: 2,
      })

      const result = await service.getColumnsDictionary({ criteria: { table: 'analytics.users' } })

      expect(result).toEqual({
        items: [
          { label: 'id', value: 'id', note: 'integer' },
          { label: 'email', value: 'email', note: 'text' },
        ],
        cursor: null,
      })

      expect(lastQuery().params).toEqual(['analytics', 'users', null])
    })

    it('passes the search term as an ILIKE pattern', async () => {
      await service.getColumnsDictionary({ search: 'mail', criteria: { table: 'users' } })

      expect(lastQuery().params).toEqual(['public', 'users', '%mail%'])
    })

    it('rejects an invalid table criteria', async () => {
      await expect(service.getColumnsDictionary({ criteria: { table: 42 } })).rejects.toThrow(
        'Table name is required and must be a non-empty string.'
      )
    })
  })
})
