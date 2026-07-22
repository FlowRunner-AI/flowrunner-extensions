'use strict'

// The service talks to Postgres through the `pg` driver rather than Flowrunner.Request,
// so the driver is mocked virtually (pg is a service-level dependency that is not
// installed in the test environment) and every query is recorded for assertions.
const mockState = {
  clients: [],
  calls: [],
  queryImpl: null,
  connectError: null,
  endError: null,
}

jest.mock('pg', () => {
  class Client {
    constructor(config) {
      this.config = config
      this.connected = false
      this.ended = false
      mockState.clients.push(this)
    }

    async connect() {
      if (mockState.connectError) {
        throw mockState.connectError
      }

      this.connected = true
    }

    async query(sql, params) {
      mockState.calls.push({ sql, params })

      if (mockState.queryImpl) {
        return mockState.queryImpl(sql, params)
      }

      return { rows: [], rowCount: 0, fields: [] }
    }

    async end() {
      this.ended = true

      if (mockState.endError) {
        throw mockState.endError
      }
    }
  }

  return { Client }
}, { virtual: true })

const DEFAULT_CONFIG = {
  host: 'db.example.com',
  database: 'mydb',
  user: 'me',
  password: 'secret',
}

function resetMockState() {
  mockState.clients = []
  mockState.calls = []
  mockState.queryImpl = null
  mockState.connectError = null
  mockState.endError = null
}

// Each service instance is created at registration time from the sandbox config, so a
// fresh module registry is needed whenever a different connection configuration is tested.
function buildService(config) {
  jest.resetModules()

  const sandboxFactory = require('../../../service-sandbox')
  const sandbox = sandboxFactory.createSandbox(config)

  require('../src/index.js')

  return { sandbox, service: sandbox.getService() }
}

function lastCall() {
  return mockState.calls[mockState.calls.length - 1]
}

function normalize(sql) {
  return String(sql).replace(/\s+/g, ' ').trim()
}

describe('PGVector Service', () => {
  let sandbox
  let service

  beforeAll(() => {
    const built = buildService(DEFAULT_CONFIG)

    sandbox = built.sandbox
    service = built.service
  })

  beforeEach(() => {
    resetMockState()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Registration ──

  describe('service registration', () => {
    it('registers all connection config items', () => {
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

      expect(items.every(item => item.shared === false)).toBe(true)
      expect(items.every(item => item.required === false)).toBe(true)
      expect(items.find(item => item.name === 'ssl').type).toBe('BOOL')
    })

    it('applies defaults for port and connection timeout', () => {
      expect(service.port).toBe(5432)
      expect(service.connectionTimeoutMillis).toBe(10000)
      expect(service.ssl).toBe(false)
      expect(service.connectionString).toBe('')
    })
  })

  // ── Connection handling ──

  describe('connection configuration', () => {
    it('builds a client from the individual fields', async () => {
      await service.enableExtension()

      expect(mockState.clients).toHaveLength(1)

      expect(mockState.clients[0].config).toEqual({
        host: 'db.example.com',
        port: 5432,
        database: 'mydb',
        user: 'me',
        password: 'secret',
        ssl: false,
        connectionTimeoutMillis: 10000,
        statement_timeout: 120000,
        query_timeout: 120000,
        application_name: 'flowrunner-pgvector',
      })
    })

    it('always closes the client', async () => {
      await service.enableExtension()

      expect(mockState.clients[0].ended).toBe(true)
    })

    it('swallows errors raised while closing the client', async () => {
      mockState.endError = new Error('already closed')

      await expect(service.enableExtension()).resolves.toEqual({ enabled: true, extension: 'vector' })
    })

    it('parses the port, timeout and ssl toggle from string config values', async () => {
      const built = buildService({ ...DEFAULT_CONFIG, port: '6543', connectionTimeoutSeconds: '30', ssl: 'true' })

      resetMockState()

      await built.service.enableExtension()

      expect(mockState.clients[0].config).toMatchObject({
        port: 6543,
        connectionTimeoutMillis: 30000,
        ssl: { rejectUnauthorized: false },
      })

      built.sandbox.cleanup()
    })

    it('falls back to defaults for invalid port and timeout values', async () => {
      const built = buildService({ ...DEFAULT_CONFIG, port: 'abc', connectionTimeoutSeconds: '-5' })

      resetMockState()

      await built.service.enableExtension()

      expect(mockState.clients[0].config).toMatchObject({ port: 5432, connectionTimeoutMillis: 10000 })

      built.sandbox.cleanup()
    })

    it('prefers a connection string and omits ssl when the toggle is off', async () => {
      const built = buildService({
        connectionString: '  postgresql://user:pw@host.example.com:5432/db  ',
        host: 'ignored',
        database: 'ignored',
        user: 'ignored',
      })

      resetMockState()

      await built.service.enableExtension()

      expect(mockState.clients[0].config).toEqual({
        connectionString: 'postgresql://user:pw@host.example.com:5432/db',
        connectionTimeoutMillis: 10000,
        statement_timeout: 120000,
        query_timeout: 120000,
        application_name: 'flowrunner-pgvector',
      })

      built.sandbox.cleanup()
    })

    it('adds ssl on top of a connection string when the toggle is on', async () => {
      const built = buildService({
        connectionString: 'postgresql://user:pw@host.example.com:5432/db',
        ssl: true,
      })

      resetMockState()

      await built.service.enableExtension()

      expect(mockState.clients[0].config).toMatchObject({ ssl: { rejectUnauthorized: false } })

      built.sandbox.cleanup()
    })

    it('throws when neither a connection string nor the required fields are set', async () => {
      const built = buildService({ host: 'db.example.com' })

      resetMockState()

      await expect(built.service.enableExtension()).rejects.toThrow(
        /incomplete connection configuration/
      )

      expect(mockState.calls).toHaveLength(0)

      built.sandbox.cleanup()
    })
  })

  describe('error handling', () => {
    it('enriches the message with code, detail and hint', async () => {
      mockState.connectError = Object.assign(new Error('connection refused'), {
        code: 'ECONNREFUSED',
        detail: 'no listener',
        hint: 'check the port',
      })

      await expect(service.enableExtension()).rejects.toThrow(
        'PGVector error: connection refused | code: ECONNREFUSED | detail: no listener | hint: check the port'
      )
    })

    it('adds an IPv6 hint for ENETUNREACH against an IPv6 address', async () => {
      mockState.connectError = Object.assign(new Error('connect ENETUNREACH'), {
        code: 'ENETUNREACH',
        address: '2600:1f18::1',
      })

      await expect(service.enableExtension()).rejects.toThrow(/IPv6-only address/)
    })

    it('does not add the IPv6 hint for an IPv4 address', async () => {
      mockState.connectError = Object.assign(new Error('connect ENETUNREACH'), {
        code: 'ENETUNREACH',
        address: '10.0.0.1',
      })

      await expect(service.enableExtension()).rejects.toThrow(
        'PGVector error: connect ENETUNREACH | code: ENETUNREACH'
      )
    })

    it('wraps query failures', async () => {
      mockState.queryImpl = () => {
        throw Object.assign(new Error('relation "missing" does not exist'), { code: '42P01' })
      }

      await expect(service.listTables()).rejects.toThrow(
        'PGVector error: relation "missing" does not exist | code: 42P01'
      )
    })
  })

  // ── Extension & schema management ──

  describe('enableExtension', () => {
    it('creates the vector extension', async () => {
      const result = await service.enableExtension()

      expect(result).toEqual({ enabled: true, extension: 'vector' })
      expect(lastCall().sql).toBe('CREATE EXTENSION IF NOT EXISTS vector')
    })
  })

  describe('createVectorTable', () => {
    it('creates a table with default id and embedding columns', async () => {
      const result = await service.createVectorTable('documents', undefined, undefined, undefined, 1536)

      expect(normalize(lastCall().sql)).toBe(
        'CREATE TABLE IF NOT EXISTS "public"."documents" ( "id" serial PRIMARY KEY, "embedding" vector(1536) )'
      )

      expect(result).toEqual({
        created: true,
        table: 'public.documents',
        embeddingColumn: 'embedding',
        dimension: 1536,
        idColumn: 'id',
      })
    })

    it('supports schema-qualified tables, custom names and metadata columns', async () => {
      const result = await service.createVectorTable(
        'app.docs',
        'doc_id',
        'UUID',
        'vec',
        '3',
        [{ name: 'content', type: 'text' }, { name: 'meta', type: 'jsonb' }]
      )

      expect(normalize(lastCall().sql)).toBe(
        'CREATE TABLE IF NOT EXISTS "app"."docs" ( "doc_id" uuid PRIMARY KEY, "vec" vector(3), ' +
        '"content" text, "meta" jsonb )'
      )

      expect(result).toMatchObject({ table: 'app.docs', embeddingColumn: 'vec', idColumn: 'doc_id', dimension: 3 })
    })

    it('maps the Text id type and passes an unmapped type through', async () => {
      await service.createVectorTable('a', 'id', 'Text', 'e', 2)
      expect(normalize(lastCall().sql)).toContain('"id" text PRIMARY KEY')

      await service.createVectorTable('b', 'id', 'bigint PRIMARY KEY', 'e', 2)
      expect(normalize(lastCall().sql)).toContain('"id" bigint PRIMARY KEY')
    })

    it('rejects an invalid dimension', async () => {
      await expect(service.createVectorTable('documents', 'id', 'Serial', 'embedding', 0)).rejects.toThrow(
        'Dimension is required and must be a positive integer.'
      )

      await expect(service.createVectorTable('documents', 'id', 'Serial', 'embedding', 'abc')).rejects.toThrow(
        'Dimension is required and must be a positive integer.'
      )

      expect(mockState.calls).toHaveLength(0)
    })

    it('rejects malformed metadata column entries', async () => {
      await expect(
        service.createVectorTable('documents', 'id', 'Serial', 'embedding', 3, [{ name: 'content' }])
      ).rejects.toThrow('Metadata Columns[0] must be an object with "name" and "type".')
    })

    it('rejects unsafe metadata column types', async () => {
      await expect(
        service.createVectorTable('documents', 'id', 'Serial', 'embedding', 3, [
          { name: 'content', type: 'text; DROP TABLE users' },
        ])
      ).rejects.toThrow(/has an invalid type/)
    })

    it('rejects a missing table name', async () => {
      await expect(service.createVectorTable('', 'id', 'Serial', 'embedding', 3)).rejects.toThrow(
        'Table name is required and must be a non-empty string.'
      )
    })

    it('escapes embedded double quotes in identifiers', async () => {
      await service.createVectorTable('we"ird', 'id', 'Serial', 'embedding', 3)

      expect(normalize(lastCall().sql)).toContain('"public"."we""ird"')
    })
  })

  describe('createIndex', () => {
    it('creates an HNSW cosine index with a generated name by default', async () => {
      const result = await service.createIndex('public.documents', 'embedding')

      expect(normalize(lastCall().sql)).toBe(
        'CREATE INDEX IF NOT EXISTS "documents_embedding_hnsw_idx" ON "public"."documents" ' +
        'USING hnsw ("embedding" vector_cosine_ops)'
      )

      expect(result).toEqual({
        created: true,
        indexName: 'documents_embedding_hnsw_idx',
        indexType: 'hnsw',
        opClass: 'vector_cosine_ops',
      })
    })

    it('applies HNSW tuning options', async () => {
      await service.createIndex('documents', 'embedding', 'HNSW', 'L2', 100, 16, 64)

      expect(normalize(lastCall().sql)).toBe(
        'CREATE INDEX IF NOT EXISTS "documents_embedding_hnsw_idx" ON "public"."documents" ' +
        'USING hnsw ("embedding" vector_l2_ops) WITH (m = 16, ef_construction = 64)'
      )
    })

    it('applies the IVFFlat lists option and ignores HNSW tuning', async () => {
      await service.createIndex('documents', 'embedding', 'IVFFlat', 'Inner Product', 200, 16, 64, ' my_idx ')

      expect(normalize(lastCall().sql)).toBe(
        'CREATE INDEX IF NOT EXISTS "my_idx" ON "public"."documents" ' +
        'USING ivfflat ("embedding" vector_ip_ops) WITH (lists = 200)'
      )
    })

    it('omits the WITH clause for invalid tuning values', async () => {
      await service.createIndex('documents', 'embedding', 'IVFFlat', 'Cosine', 0)

      expect(normalize(lastCall().sql)).not.toContain('WITH')
    })

    it('falls back to the cosine op class for an unknown metric', async () => {
      const result = await service.createIndex('documents', 'embedding', 'HNSW', 'Manhattan')

      expect(result.opClass).toBe('vector_cosine_ops')
    })

    it('sanitizes generated index names', async () => {
      const result = await service.createIndex('public.my docs', 'my embedding')

      expect(result.indexName).toBe('my_docs_my_embedding_hnsw_idx')
    })

    it('requires an embedding column', async () => {
      await expect(service.createIndex('documents', '   ')).rejects.toThrow('Embedding Column is required.')
      await expect(service.createIndex('documents')).rejects.toThrow('Embedding Column is required.')
    })
  })

  // ── Embeddings ──

  describe('insertEmbeddings', () => {
    it('inserts rows converting embeddings to vector literals', async () => {
      mockState.queryImpl = () => ({ rows: [{ id: 1 }], rowCount: 1 })

      const result = await service.insertEmbeddings('documents', undefined, [
        { content: 'Hello', embedding: [0.1, 0.2, 0.3] },
      ])

      expect(normalize(lastCall().sql)).toBe(
        'INSERT INTO "public"."documents" ("content", "embedding") VALUES ($1, $2) RETURNING *'
      )

      expect(lastCall().params).toEqual(['Hello', '[0.1,0.2,0.3]'])
      expect(result).toEqual({ rows: [{ id: 1 }], insertedCount: 1 })
    })

    it('uses the union of keys across rows and binds NULL for missing values', async () => {
      mockState.queryImpl = () => ({ rows: [], rowCount: 2 })

      await service.insertEmbeddings('documents', 'vec', [
        { id: 'a', vec: [1, 2] },
        { source: 'import', vec: [3, 4] },
      ])

      expect(normalize(lastCall().sql)).toBe(
        'INSERT INTO "public"."documents" ("id", "vec", "source") VALUES ($1, $2, $3), ($4, $5, $6) RETURNING *'
      )

      expect(lastCall().params).toEqual(['a', '[1,2]', null, null, '[3,4]', 'import'])
    })

    it('coerces numeric strings inside embeddings', async () => {
      mockState.queryImpl = () => ({ rows: [], rowCount: 1 })

      await service.insertEmbeddings('documents', 'embedding', [{ embedding: ['0.5', 1] }])

      expect(lastCall().params).toEqual(['[0.5,1]'])
    })

    it('returns an empty rows array when the driver returns none', async () => {
      mockState.queryImpl = () => ({ rowCount: 1 })

      const result = await service.insertEmbeddings('documents', 'embedding', [{ embedding: [1] }])

      expect(result).toEqual({ rows: [], insertedCount: 1 })
    })

    it('rejects an empty rows array', async () => {
      await expect(service.insertEmbeddings('documents', 'embedding', [])).rejects.toThrow(
        'Rows must be a non-empty array of objects.'
      )

      await expect(service.insertEmbeddings('documents', 'embedding', null)).rejects.toThrow(
        'Rows must be a non-empty array of objects.'
      )
    })

    it('rejects rows that are not non-empty objects', async () => {
      await expect(service.insertEmbeddings('documents', 'embedding', [{}])).rejects.toThrow(
        'Rows[0] must be a non-empty object.'
      )

      await expect(service.insertEmbeddings('documents', 'embedding', [[1, 2]])).rejects.toThrow(
        'Rows[0] must be a non-empty object.'
      )
    })

    it('rejects invalid embedding values', async () => {
      await expect(
        service.insertEmbeddings('documents', 'embedding', [{ embedding: [] }])
      ).rejects.toThrow('Embedding must be a non-empty array of numbers.')

      await expect(
        service.insertEmbeddings('documents', 'embedding', [{ embedding: [1, 'abc'] }])
      ).rejects.toThrow('Embedding element at index 1 is not a finite number: "abc".')
    })
  })

  describe('upsertEmbeddings', () => {
    it('builds an ON CONFLICT DO UPDATE statement', async () => {
      mockState.queryImpl = () => ({ rows: [{ id: 'doc-1' }], rowCount: 1 })

      const result = await service.upsertEmbeddings('documents', 'embedding', [
        { id: 'doc-1', content: 'Hello', embedding: [0.1] },
      ])

      expect(normalize(lastCall().sql)).toBe(
        'INSERT INTO "public"."documents" ("id", "content", "embedding") VALUES ($1, $2, $3) ' +
        'ON CONFLICT ("id") DO UPDATE SET "content" = EXCLUDED."content", "embedding" = EXCLUDED."embedding" ' +
        'RETURNING *'
      )

      expect(lastCall().params).toEqual(['doc-1', 'Hello', '[0.1]'])
      expect(result).toEqual({ rows: [{ id: 'doc-1' }], affectedCount: 1 })
    })

    it('uses DO NOTHING when only the conflict column is supplied', async () => {
      mockState.queryImpl = () => ({ rows: [], rowCount: 0 })

      await service.upsertEmbeddings('documents', 'embedding', [{ ref: 'x' }], 'ref')

      expect(normalize(lastCall().sql)).toContain('ON CONFLICT ("ref") DO NOTHING')
    })

    it('defaults the conflict column to id', async () => {
      mockState.queryImpl = () => ({ rows: [], rowCount: 1 })

      await service.upsertEmbeddings('documents', undefined, [{ id: 1, embedding: [1] }], '  ')

      expect(normalize(lastCall().sql)).toContain('ON CONFLICT ("id")')
    })

    it('rejects an empty rows array and invalid rows', async () => {
      await expect(service.upsertEmbeddings('documents', 'embedding', [])).rejects.toThrow(
        'Rows must be a non-empty array of objects.'
      )

      await expect(service.upsertEmbeddings('documents', 'embedding', [{}])).rejects.toThrow(
        'Rows[0] must be a non-empty object.'
      )
    })
  })

  describe('deleteEmbeddings', () => {
    it('deletes by ids using the default id column', async () => {
      mockState.queryImpl = () => ({ rowCount: 2 })

      const result = await service.deleteEmbeddings('documents', [1, 2])

      expect(normalize(lastCall().sql)).toBe('DELETE FROM "public"."documents" WHERE "id" = ANY($1)')
      expect(lastCall().params).toEqual([[1, 2]])
      expect(result).toEqual({ deletedCount: 2 })
    })

    it('deletes by ids using a custom id column', async () => {
      mockState.queryImpl = () => ({ rowCount: 1 })

      await service.deleteEmbeddings('app.docs', ['doc-1'], 'doc_id')

      expect(normalize(lastCall().sql)).toBe('DELETE FROM "app"."docs" WHERE "doc_id" = ANY($1)')
    })

    it('deletes by where conditions including NULL and array values', async () => {
      mockState.queryImpl = () => ({ rowCount: 3 })

      await service.deleteEmbeddings('documents', null, 'id', {
        source: 'import',
        archived: null,
        tag: ['a', 'b'],
      })

      expect(normalize(lastCall().sql)).toBe(
        'DELETE FROM "public"."documents" WHERE "source" = $1 AND "archived" IS NULL AND "tag" = ANY($2)'
      )

      expect(lastCall().params).toEqual(['import', ['a', 'b']])
    })

    it('requires exactly one selector', async () => {
      await expect(service.deleteEmbeddings('documents', [1], 'id', { a: 1 })).rejects.toThrow(
        'Provide exactly one of IDs or Where to select the rows to delete.'
      )

      await expect(service.deleteEmbeddings('documents', [], 'id', {})).rejects.toThrow(
        'Provide exactly one of IDs or Where to select the rows to delete.'
      )

      expect(mockState.calls).toHaveLength(0)
    })

    // Regression guard: `hasWhere` must be coerced to a real boolean, otherwise it is
    // `undefined` when Where is omitted, `false === undefined` is false, the guard does not
    // fire, and an unqualified full-table DELETE wipes every row.
    it('refuses a full-table delete when both selectors are omitted', async () => {
      mockState.queryImpl = () => ({ rowCount: 0 })

      await expect(service.deleteEmbeddings('documents')).rejects.toThrow(
        'Provide exactly one of IDs or Where to select the rows to delete.'
      )

      expect(mockState.calls).toHaveLength(0)
    })

    it('refuses a full-table delete for every empty-selector shape', async () => {
      mockState.queryImpl = () => ({ rowCount: 0 })

      for (const args of [
        ['documents', undefined, undefined, undefined],
        ['documents', null, 'id', null],
        ['documents', [], 'id', undefined],
        ['documents', undefined, 'id', {}],
      ]) {
        await expect(service.deleteEmbeddings(...args)).rejects.toThrow(
          'Provide exactly one of IDs or Where to select the rows to delete.'
        )
      }

      expect(mockState.calls).toHaveLength(0)
    })
  })

  // ── Similarity search ──

  describe('similaritySearch', () => {
    it('builds a cosine search with defaults', async () => {
      mockState.queryImpl = () => ({ rows: [{ id: 1, distance: 0.01 }], rowCount: 1 })

      const result = await service.similaritySearch('documents', undefined, [0.1, 0.2])

      expect(normalize(lastCall().sql)).toBe(
        'SELECT *, "embedding" <=> $1 AS distance FROM "public"."documents" ORDER BY distance ASC LIMIT $2'
      )

      expect(lastCall().params).toEqual(['[0.1,0.2]', 10])

      expect(result).toEqual({
        rows: [{ id: 1, distance: 0.01 }],
        rowCount: 1,
        metric: 'Cosine',
        operator: '<=>',
      })
    })

    it('supports the L2 and Inner Product metrics', async () => {
      mockState.queryImpl = () => ({ rows: [], rowCount: 0 })

      const l2 = await service.similaritySearch('documents', 'embedding', [1], 'L2')

      expect(l2.operator).toBe('<->')
      expect(l2.metric).toBe('L2')

      const ip = await service.similaritySearch('documents', 'embedding', [1], 'Inner Product')

      expect(ip.operator).toBe('<#>')
      expect(ip.metric).toBe('Inner Product')
    })

    it('falls back to cosine for an unknown metric', async () => {
      mockState.queryImpl = () => ({ rows: [], rowCount: 0 })

      const result = await service.similaritySearch('documents', 'embedding', [1], 'Manhattan')

      expect(result).toMatchObject({ metric: 'Cosine', operator: '<=>' })
    })

    it('restricts the selected columns and applies both filter forms', async () => {
      mockState.queryImpl = () => ({ rows: [], rowCount: 0 })

      await service.similaritySearch(
        'app.docs',
        'vec',
        [0.1],
        'Cosine',
        5,
        ['id', 'content'],
        { source: 'docs' },
        "created_at > now() - interval '7 days'"
      )

      expect(normalize(lastCall().sql)).toBe(
        'SELECT "id", "content", "vec" <=> $1 AS distance FROM "app"."docs" ' +
        'WHERE "source" = $2 AND (created_at > now() - interval \'7 days\') ' +
        'ORDER BY distance ASC LIMIT $3'
      )

      expect(lastCall().params).toEqual(['[0.1]', 'docs', 5])
    })

    it('supports a raw where clause on its own', async () => {
      mockState.queryImpl = () => ({ rows: [], rowCount: 0 })

      await service.similaritySearch('documents', 'embedding', [1], 'Cosine', 3, [], null, '  id > 5  ')

      expect(normalize(lastCall().sql)).toBe(
        'SELECT *, "embedding" <=> $1 AS distance FROM "public"."documents" WHERE (id > 5) ' +
        'ORDER BY distance ASC LIMIT $2'
      )
    })

    it('falls back to a limit of 10 for invalid values', async () => {
      mockState.queryImpl = () => ({ rows: [], rowCount: 0 })

      await service.similaritySearch('documents', 'embedding', [1], 'Cosine', -3)

      expect(lastCall().params).toEqual(['[1]', 10])
    })

    it('rejects an invalid query embedding', async () => {
      await expect(service.similaritySearch('documents', 'embedding', [])).rejects.toThrow(
        'Embedding must be a non-empty array of numbers.'
      )

      expect(mockState.calls).toHaveLength(0)
    })
  })

  // ── SQL escape hatch ──

  describe('executeQuery', () => {
    it('runs the statement with bound parameters and maps field metadata', async () => {
      mockState.queryImpl = () => ({
        rows: [{ id: 1 }],
        rowCount: 1,
        fields: [{ name: 'id', dataTypeID: 23, extra: 'ignored' }],
      })

      const result = await service.executeQuery('SELECT * FROM documents WHERE id = $1', [1])

      expect(lastCall()).toEqual({ sql: 'SELECT * FROM documents WHERE id = $1', params: [1] })

      expect(result).toEqual({
        rows: [{ id: 1 }],
        rowCount: 1,
        fields: [{ name: 'id', dataTypeID: 23 }],
      })
    })

    it('defaults the parameters to an empty array', async () => {
      const result = await service.executeQuery('SELECT 1')

      expect(lastCall().params).toEqual([])
      expect(result).toEqual({ rows: [], rowCount: 0, fields: [] })
    })

    it('tolerates a driver result without rows and fields', async () => {
      mockState.queryImpl = () => ({ rowCount: 0 })

      const result = await service.executeQuery('SELECT 1', 'not-an-array')

      expect(result).toEqual({ rows: [], rowCount: 0, fields: [] })
    })

    it('requires a SQL statement', async () => {
      await expect(service.executeQuery('   ')).rejects.toThrow('SQL statement is required.')
      await expect(service.executeQuery(null)).rejects.toThrow('SQL statement is required.')

      expect(mockState.calls).toHaveLength(0)
    })
  })

  // ── Schema discovery ──

  describe('getTableSchema', () => {
    it('returns mapped column definitions and flags vector columns', async () => {
      mockState.queryImpl = () => ({
        rows: [
          {
            column_name: 'id',
            data_type: 'integer',
            udt_name: 'int4',
            is_nullable: 'NO',
            column_default: "nextval('documents_id_seq'::regclass)",
            character_maximum_length: null,
            ordinal_position: 1,
          },
          {
            column_name: 'embedding',
            data_type: 'USER-DEFINED',
            udt_name: 'vector',
            is_nullable: 'YES',
            column_default: null,
            character_maximum_length: null,
            ordinal_position: 2,
          },
        ],
      })

      const result = await service.getTableSchema('app.docs')

      expect(lastCall().params).toEqual(['app', 'docs'])
      expect(normalize(lastCall().sql)).toContain('FROM information_schema.columns')

      expect(result).toEqual({
        schema: 'app',
        table: 'docs',
        columns: [
          {
            name: 'id',
            type: 'integer',
            udtName: 'int4',
            nullable: false,
            default: "nextval('documents_id_seq'::regclass)",
            maxLength: null,
            position: 1,
            isVector: false,
          },
          {
            name: 'embedding',
            type: 'USER-DEFINED',
            udtName: 'vector',
            nullable: true,
            default: null,
            maxLength: null,
            position: 2,
            isVector: true,
          },
        ],
      })
    })

    it('defaults to the public schema', async () => {
      mockState.queryImpl = () => ({ rows: [{ column_name: 'id', udt_name: 'int4', is_nullable: 'NO' }] })

      const result = await service.getTableSchema('documents')

      expect(lastCall().params).toEqual(['public', 'documents'])
      expect(result.schema).toBe('public')
    })

    it('throws when the table has no columns', async () => {
      await expect(service.getTableSchema('documents')).rejects.toThrow(
        'PGVector error: Table "public.documents" was not found or has no columns.'
      )
    })
  })

  describe('listTables', () => {
    it('maps tables and reports the vector column flag', async () => {
      mockState.queryImpl = () => ({
        rows: [
          {
            table_schema: 'public',
            table_name: 'documents',
            table_type: 'BASE TABLE',
            has_vector_column: true,
          },
        ],
        rowCount: 1,
      })

      const result = await service.listTables()

      expect(normalize(lastCall().sql)).toContain('FROM information_schema.tables t')

      expect(result).toEqual({
        tables: [{ schema: 'public', name: 'documents', type: 'BASE TABLE', hasVectorColumn: true }],
        count: 1,
      })
    })
  })

  // ── Dictionaries ──

  describe('getTablesDictionary', () => {
    it('lists tables with no search and no cursor', async () => {
      mockState.queryImpl = () => ({
        rows: [{ table_schema: 'public', table_name: 'documents', table_type: 'BASE TABLE' }],
      })

      const result = await service.getTablesDictionary({})

      expect(lastCall().params).toEqual([null, 201, 0])

      expect(result).toEqual({
        items: [{ label: 'documents', value: 'public.documents', note: 'public · BASE TABLE' }],
        cursor: null,
      })
    })

    it('handles a null payload', async () => {
      mockState.queryImpl = () => ({ rows: [] })

      const result = await service.getTablesDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
      expect(lastCall().params).toEqual([null, 201, 0])
    })

    it('wraps the search term in ILIKE wildcards and applies the cursor offset', async () => {
      mockState.queryImpl = () => ({ rows: [] })

      await service.getTablesDictionary({ search: 'doc', cursor: '200' })

      expect(lastCall().params).toEqual(['%doc%', 201, 200])
    })

    it('returns a next cursor when there are more rows than the page size', async () => {
      mockState.queryImpl = () => ({
        rows: Array.from({ length: 201 }, (unused, index) => ({
          table_schema: 'public',
          table_name: `t${ index }`,
          table_type: 'BASE TABLE',
        })),
      })

      const result = await service.getTablesDictionary({ cursor: '0' })

      expect(result.items).toHaveLength(200)
      expect(result.cursor).toBe('200')
    })
  })

  describe('getColumnsDictionary', () => {
    it('returns an empty list without a selected table', async () => {
      await expect(service.getColumnsDictionary({})).resolves.toEqual({ items: [], cursor: null })
      await expect(service.getColumnsDictionary(null)).resolves.toEqual({ items: [], cursor: null })

      await expect(service.getColumnsDictionary({ criteria: {} })).resolves.toEqual({
        items: [],
        cursor: null,
      })

      expect(mockState.calls).toHaveLength(0)
    })

    it('lists the columns of the selected table with type notes', async () => {
      mockState.queryImpl = () => ({
        rows: [
          { column_name: 'id', data_type: 'integer', udt_name: 'int4' },
          { column_name: 'embedding', data_type: 'USER-DEFINED', udt_name: 'vector' },
        ],
      })

      const result = await service.getColumnsDictionary({ criteria: { table: 'app.docs' } })

      expect(lastCall().params).toEqual(['app', 'docs', null])

      expect(result).toEqual({
        items: [
          { label: 'id', value: 'id', note: 'integer' },
          { label: 'embedding', value: 'embedding', note: 'vector' },
        ],
        cursor: null,
      })
    })

    it('applies the search term', async () => {
      mockState.queryImpl = () => ({ rows: [] })

      await service.getColumnsDictionary({ search: 'emb', criteria: { table: 'documents' } })

      expect(lastCall().params).toEqual(['public', 'documents', '%emb%'])
    })
  })
})
