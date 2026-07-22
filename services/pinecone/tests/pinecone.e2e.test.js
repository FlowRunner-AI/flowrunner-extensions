'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Pinecone Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('pinecone')
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

  // ── Indexes ──

  describe('listIndexes', () => {
    it('returns the project indexes', async () => {
      const result = await service.listIndexes()

      expect(result).toHaveProperty('indexes')
      expect(Array.isArray(result.indexes)).toBe(true)
    })
  })

  describe('describeIndex', () => {
    it('describes the configured index', async () => {
      const { indexName } = testValues

      if (!indexName) {
        console.log('Skipping describeIndex: testValues.indexName not set')

        return
      }

      const result = await service.describeIndex(indexName)

      expect(result).toHaveProperty('name', indexName)
      expect(result).toHaveProperty('host')
      expect(result).toHaveProperty('status')
    })

    it('rejects an unknown index', async () => {
      await expect(service.describeIndex('no-such-index-e2e-check')).rejects.toThrow(/Pinecone API error/)
    })
  })

  describe('configureIndex validation', () => {
    it('throws when no changes are provided', async () => {
      await expect(service.configureIndex('any-index')).rejects.toThrow(
        'Configure Index requires at least one of Deletion Protection or Tags.'
      )
    })
  })

  // ── Vectors ──

  describe('vector lifecycle', () => {
    const vectorId = `e2e-vector-${ Date.now() }`

    it('describes the index stats', async () => {
      const { indexName } = testValues

      if (!indexName) {
        console.log('Skipping describeIndexStats: testValues.indexName not set')

        return
      }

      const result = await service.describeIndexStats(indexName)

      expect(result).toHaveProperty('namespaces')
    })

    it('upserts, fetches, queries, updates and deletes a vector', async () => {
      const { indexName, dimension, namespace } = testValues

      if (!indexName || !dimension) {
        console.log('Skipping vector lifecycle: testValues.indexName or testValues.dimension not set')

        return
      }

      const values = Array.from({ length: Number(dimension) }, () => 0.1)

      const upserted = await service.upsertVectors(
        indexName,
        [{ id: vectorId, values, metadata: { source: 'e2e' } }],
        namespace
      )

      expect(upserted).toHaveProperty('upsertedCount')

      const fetched = await service.fetchVectors(indexName, [vectorId], namespace)

      expect(fetched).toHaveProperty('vectors')

      const queried = await service.queryVectors(
        indexName, values, null, 3, null, true, false, namespace
      )

      expect(queried).toHaveProperty('matches')
      expect(Array.isArray(queried.matches)).toBe(true)

      const updated = await service.updateVector(
        indexName, vectorId, null, { source: 'e2e-updated' }, namespace
      )

      expect(updated).toEqual({ success: true, id: vectorId })

      const listed = await service.listVectorIds(indexName, 'e2e-vector-', 10, null, namespace)

      expect(listed).toBeDefined()

      const deleted = await service.deleteVectors(indexName, [vectorId], false, null, namespace)

      expect(deleted).toEqual({ success: true })
    })

    it('rejects invalid vector arguments without calling the API', async () => {
      await expect(service.upsertVectors('idx', [])).rejects.toThrow('Vectors must be a non-empty array.')
      await expect(service.fetchVectors('idx', [])).rejects.toThrow('Vector IDs must be a non-empty array.')

      await expect(service.queryVectors('idx')).rejects.toThrow(
        'Provide either Query Vector values or a Vector ID.'
      )

      await expect(service.queryVectors('idx', [0.1], 'x')).rejects.toThrow(
        'Provide either Query Vector values or a Vector ID, not both.'
      )

      await expect(service.updateVector('idx', 'x')).rejects.toThrow(
        'Provide New Values and/or Set Metadata to update the vector.'
      )

      await expect(service.deleteVectors('idx')).rejects.toThrow(
        'Provide Vector IDs, a Metadata Filter, or enable Delete All.'
      )
    })
  })

  // ── Records (integrated embedding) ──

  describe('records', () => {
    it('upserts and searches records on an integrated index', async () => {
      const { integratedIndexName } = testValues

      if (!integratedIndexName) {
        console.log('Skipping records: testValues.integratedIndexName not set')

        return
      }

      const recordId = `e2e-record-${ Date.now() }`

      const upserted = await service.upsertRecords(
        integratedIndexName,
        [{ _id: recordId, chunk_text: 'FlowRunner e2e integration test record.' }]
      )

      expect(upserted).toMatchObject({ success: true, upsertedCount: 1 })

      const searched = await service.searchRecords(
        integratedIndexName, 'integration test record', 3
      )

      expect(searched).toHaveProperty('result')
    })

    it('rejects invalid record arguments', async () => {
      await expect(service.upsertRecords('idx', [])).rejects.toThrow('Records must be a non-empty array.')
      await expect(service.searchRecords('idx', '')).rejects.toThrow('Query Text is required.')
    })
  })

  // ── Namespaces ──

  describe('listNamespaces', () => {
    it('lists namespaces for the configured index', async () => {
      const { indexName } = testValues

      if (!indexName) {
        console.log('Skipping listNamespaces: testValues.indexName not set')

        return
      }

      const result = await service.listNamespaces(indexName, 10)

      expect(result).toHaveProperty('namespaces')
    })

    it('requires a namespace name for deletion', async () => {
      await expect(service.deleteNamespace('idx')).rejects.toThrow('Namespace is required.')
    })
  })

  // ── Inference ──

  describe('inference', () => {
    it('creates embeddings', async () => {
      const result = await service.createEmbeddings(
        'multilingual-e5-large', ['hello world', 'goodbye world'], 'Passage'
      )

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
      expect(result.data).toHaveLength(2)
    })

    it('reranks documents', async () => {
      const result = await service.rerankDocuments(
        'bge-reranker-v2-m3',
        'What is the capital of France?',
        ['Paris is the capital of France.', 'Bananas are yellow.'],
        2
      )

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
    })

    it('rejects empty inference input', async () => {
      await expect(service.createEmbeddings('m', [])).rejects.toThrow(
        'Inputs must be a non-empty array of texts.'
      )

      await expect(service.rerankDocuments('m', 'q', [])).rejects.toThrow(
        'Documents must be a non-empty array.'
      )
    })
  })

  // ── Dictionaries ──

  describe('dictionaries', () => {
    it('returns the indexes dictionary', async () => {
      const result = await service.getIndexesDictionary({})

      expect(result).toHaveProperty('items')
      expect(result).toHaveProperty('cursor', null)

      result.items.forEach(item => {
        expect(item).toHaveProperty('label')
        expect(item).toHaveProperty('value')
      })
    })

    it('returns an empty namespaces dictionary without criteria', async () => {
      await expect(service.getNamespacesDictionary({})).resolves.toEqual({ items: [], cursor: null })
    })

    it('returns the namespaces dictionary for the configured index', async () => {
      const { indexName } = testValues

      if (!indexName) {
        console.log('Skipping getNamespacesDictionary: testValues.indexName not set')

        return
      }

      const result = await service.getNamespacesDictionary({ criteria: { indexName } })

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })
})
