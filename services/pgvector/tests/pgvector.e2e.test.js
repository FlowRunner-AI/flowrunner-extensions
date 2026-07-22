'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

// PGVector talks to PostgreSQL through the `pg` driver, so this suite needs both the
// driver installed (npm install inside services/pgvector) and a reachable database with
// the pgvector extension available. When either is missing every test skips gracefully.
const TABLE = `flowrunner_e2e_vectors_${ Date.now() }`
const DIMENSION = 3

describe('PGVector Service (e2e)', () => {
  let sandbox
  let service
  let testValues
  let unavailableReason = null

  beforeAll(() => {
    sandbox = createE2ESandbox('pgvector')

    try {
      require('../src/index.js')
    } catch (error) {
      unavailableReason = `the pg driver could not be loaded (${ error.message })`

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

    if (!service.connectionString && !(service.host && service.database && service.user)) {
      unavailableReason =
        'no database connection is configured (set configs.connectionString or ' +
        'configs.host/database/user/password in service-sandbox/e2e-config.json)'
    }
  })

  afterAll(async () => {
    if (!unavailableReason && service) {
      try {
        await service.executeQuery(`DROP TABLE IF EXISTS "public"."${ TABLE }"`)
      } catch (error) {
        console.log(`Cleanup failed: ${ error.message }`)
      }
    }

    if (sandbox) {
      sandbox.cleanup()
    }
  })

  function skipped(name) {
    if (unavailableReason) {
      console.log(`Skipping ${ name }: ${ unavailableReason }`)

      return true
    }

    return false
  }

  // ── Connection & extension ──

  describe('enableExtension', () => {
    it('enables the pgvector extension', async () => {
      if (skipped('enableExtension')) {
        return
      }

      const result = await service.enableExtension()

      expect(result).toEqual({ enabled: true, extension: 'vector' })
    })
  })

  describe('executeQuery', () => {
    it('runs a parameterized statement', async () => {
      if (skipped('executeQuery')) {
        return
      }

      const result = await service.executeQuery('SELECT $1::int AS answer', [42])

      expect(result.rows).toEqual([{ answer: 42 }])
      expect(result.rowCount).toBe(1)
      expect(result.fields[0]).toHaveProperty('name', 'answer')
    })

    it('rejects an empty statement', async () => {
      if (skipped('executeQuery validation')) {
        return
      }

      await expect(service.executeQuery('  ')).rejects.toThrow('SQL statement is required.')
    })
  })

  // ── Table lifecycle ──

  describe('vector table lifecycle', () => {
    it('creates a vector table', async () => {
      if (skipped('createVectorTable')) {
        return
      }

      const result = await service.createVectorTable(TABLE, 'id', 'Text', 'embedding', DIMENSION, [
        { name: 'content', type: 'text' },
        { name: 'source', type: 'text' },
      ])

      expect(result).toMatchObject({ created: true, table: `public.${ TABLE }`, dimension: DIMENSION })
    })

    it('creates an index on the vector column', async () => {
      if (skipped('createIndex')) {
        return
      }

      const result = await service.createIndex(TABLE, 'embedding', 'HNSW', 'Cosine')

      expect(result).toMatchObject({ created: true, indexType: 'hnsw', opClass: 'vector_cosine_ops' })
    })

    it('describes the table schema', async () => {
      if (skipped('getTableSchema')) {
        return
      }

      const result = await service.getTableSchema(TABLE)

      expect(result).toMatchObject({ schema: 'public', table: TABLE })
      expect(result.columns.some(column => column.isVector)).toBe(true)
    })

    it('lists tables including the new one', async () => {
      if (skipped('listTables')) {
        return
      }

      const result = await service.listTables()

      expect(result.tables.some(table => table.name === TABLE)).toBe(true)
    })

    it('inserts embeddings', async () => {
      if (skipped('insertEmbeddings')) {
        return
      }

      const result = await service.insertEmbeddings(TABLE, 'embedding', [
        { id: 'doc-1', content: 'Hello', source: 'e2e', embedding: [0.1, 0.2, 0.3] },
        { id: 'doc-2', content: 'World', source: 'e2e', embedding: [0.9, 0.8, 0.7] },
      ])

      expect(result.insertedCount).toBe(2)
      expect(result.rows).toHaveLength(2)
    })

    it('upserts an existing embedding', async () => {
      if (skipped('upsertEmbeddings')) {
        return
      }

      const result = await service.upsertEmbeddings(
        TABLE,
        'embedding',
        [{ id: 'doc-1', content: 'Hello again', source: 'e2e', embedding: [0.15, 0.25, 0.35] }],
        'id'
      )

      expect(result.affectedCount).toBe(1)
      expect(result.rows[0]).toHaveProperty('content', 'Hello again')
    })

    it('finds the nearest neighbours', async () => {
      if (skipped('similaritySearch')) {
        return
      }

      const result = await service.similaritySearch(
        TABLE,
        'embedding',
        [0.1, 0.2, 0.3],
        'Cosine',
        5,
        ['id', 'content'],
        { source: 'e2e' }
      )

      expect(result).toMatchObject({ metric: 'Cosine', operator: '<=>' })
      expect(result.rows.length).toBeGreaterThan(0)
      expect(result.rows[0]).toHaveProperty('distance')
    })

    it('supports the L2 metric', async () => {
      if (skipped('similaritySearch L2')) {
        return
      }

      const result = await service.similaritySearch(TABLE, 'embedding', [0.1, 0.2, 0.3], 'L2', 1)

      expect(result).toMatchObject({ metric: 'L2', operator: '<->' })
    })

    it('deletes embeddings by id', async () => {
      if (skipped('deleteEmbeddings by id')) {
        return
      }

      const result = await service.deleteEmbeddings(TABLE, ['doc-1'], 'id')

      expect(result.deletedCount).toBe(1)
    })

    it('deletes embeddings by where conditions', async () => {
      if (skipped('deleteEmbeddings by where')) {
        return
      }

      const result = await service.deleteEmbeddings(TABLE, null, 'id', { source: 'e2e' })

      expect(result.deletedCount).toBeGreaterThanOrEqual(1)
    })
  })

  // ── Dictionaries ──

  describe('getTablesDictionary', () => {
    it('returns table items', async () => {
      if (skipped('getTablesDictionary')) {
        return
      }

      const result = await service.getTablesDictionary({})

      expect(Array.isArray(result.items)).toBe(true)
    })

    it('filters by search text', async () => {
      if (skipped('getTablesDictionary search')) {
        return
      }

      const result = await service.getTablesDictionary({ search: 'zzz_no_such_table_zzz' })

      expect(result.items).toEqual([])
    })
  })

  describe('getColumnsDictionary', () => {
    it('returns an empty list without criteria', async () => {
      if (skipped('getColumnsDictionary')) {
        return
      }

      await expect(service.getColumnsDictionary({})).resolves.toEqual({ items: [], cursor: null })
    })

    it('returns the columns of a table', async () => {
      if (skipped('getColumnsDictionary with criteria')) {
        return
      }

      const table = (testValues && testValues.table) || TABLE
      const result = await service.getColumnsDictionary({ criteria: { table } })

      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Errors ──

  describe('error handling', () => {
    it('wraps driver errors for an unknown table', async () => {
      if (skipped('error handling')) {
        return
      }

      await expect(service.executeQuery('SELECT * FROM zzz_no_such_table_zzz')).rejects.toThrow(
        /PGVector error/
      )
    })
  })
})
