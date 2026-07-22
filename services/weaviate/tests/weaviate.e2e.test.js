'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

// Unique per run so parallel/repeated runs never collide with a leftover collection.
const COLLECTION = `E2eTest${ Date.now() }`

describe('Weaviate Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('weaviate')
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

  // ── Utilities ──

  describe('getMeta', () => {
    it('returns instance metadata', async () => {
      const result = await service.getMeta()

      expect(result).toHaveProperty('version')
      expect(result).toHaveProperty('modules')
    })
  })

  describe('checkLiveness', () => {
    it('reports the instance as ready', async () => {
      await expect(service.checkLiveness()).resolves.toBe(true)
    })
  })

  // ── Collections ──

  describe('listCollections', () => {
    it('returns the schema with a classes array', async () => {
      const result = await service.listCollections()

      expect(result).toHaveProperty('classes')
      expect(Array.isArray(result.classes)).toBe(true)
    })
  })

  describe('getCollectionsDictionary', () => {
    it('returns dictionary items with a label and value', async () => {
      const result = await service.getCollectionsDictionary({})

      expect(Array.isArray(result.items)).toBe(true)
      expect(result.cursor).toBeNull()

      for (const item of result.items) {
        expect(item).toHaveProperty('label')
        expect(item).toHaveProperty('value')
      }
    })

    it('filters collections by a search term', async () => {
      const all = await service.getCollectionsDictionary({})

      if (!all.items.length) {
        console.log('Skipping dictionary search: the instance has no collections')

        return
      }

      const needle = all.items[0].label.slice(0, 3)
      const filtered = await service.getCollectionsDictionary({ search: needle })

      expect(filtered.items.length).toBeGreaterThan(0)
    })
  })

  // ── Full lifecycle on a temporary collection ──

  describe('collection / object / search lifecycle', () => {
    let createdObjectId

    afterAll(async () => {
      try {
        await service.deleteCollection(COLLECTION)
      } catch (error) {
        console.log(`Cleanup: could not delete collection ${ COLLECTION }: ${ error.message }`)
      }
    })

    it('creates a vectorizer-free collection', async () => {
      const result = await service.createCollection(
        COLLECTION,
        'FlowRunner e2e test collection',
        'none',
        [
          { name: 'title', dataType: ['text'] },
          { name: 'status', dataType: ['text'] },
        ],
        { vectorIndexConfig: { distance: 'cosine' } }
      )

      expect(result).toHaveProperty('class', COLLECTION)
    })

    it('reads the collection schema back', async () => {
      const result = await service.getCollection(COLLECTION)

      expect(result).toHaveProperty('class', COLLECTION)
      expect(Array.isArray(result.properties)).toBe(true)
    })

    it('creates an object with an explicit vector', async () => {
      const result = await service.createObject(
        COLLECTION,
        { title: 'Hello world', status: 'published' },
        undefined,
        [0.1, 0.2, 0.3]
      )

      expect(result).toHaveProperty('id')

      createdObjectId = result.id
    })

    it('retrieves the object including its vector', async () => {
      const result = await service.getObject(COLLECTION, createdObjectId, true)

      expect(result).toHaveProperty('id', createdObjectId)
      expect(result.properties).toHaveProperty('title', 'Hello world')
    })

    it('merges new properties into the object', async () => {
      const result = await service.updateObject(COLLECTION, createdObjectId, { status: 'archived' })

      expect(result).toEqual({ success: true, id: createdObjectId })

      const updated = await service.getObject(COLLECTION, createdObjectId)

      expect(updated.properties).toHaveProperty('status', 'archived')
      expect(updated.properties).toHaveProperty('title', 'Hello world')
    })

    it('replaces the object entirely', async () => {
      const result = await service.replaceObject(
        COLLECTION,
        createdObjectId,
        { title: 'Replaced title', status: 'archived' },
        [0.4, 0.5, 0.6]
      )

      expect(result).toHaveProperty('id', createdObjectId)
    })

    it('lists objects in the collection', async () => {
      const result = await service.listObjects(COLLECTION, 5)

      expect(result).toHaveProperty('objects')
      expect(Array.isArray(result.objects)).toBe(true)
    })

    it('batch creates objects', async () => {
      const result = await service.batchCreateObjects(COLLECTION, [
        { title: 'Batch one', status: 'draft' },
        { properties: { title: 'Batch two', status: 'draft' }, vector: [0.7, 0.8, 0.9] },
      ])

      expect(Array.isArray(result)).toBe(true)
      expect(result).toHaveLength(2)
    })

    it('counts the objects in the collection', async () => {
      const result = await service.aggregateCount(COLLECTION)

      expect(typeof result.count).toBe('number')
      expect(result.count).toBeGreaterThan(0)
    })

    it('counts the objects matching a where filter', async () => {
      const result = await service.aggregateCount(COLLECTION, {
        path: ['status'],
        operator: 'Equal',
        valueText: 'draft',
      })

      expect(typeof result.count).toBe('number')
    })

    it('runs a vector search', async () => {
      const result = await service.searchVector(COLLECTION, [0.1, 0.2, 0.3], 5)

      expect(Array.isArray(result)).toBe(true)

      if (result.length) {
        expect(result[0]).toHaveProperty('_additional')
        expect(result[0]._additional).toHaveProperty('id')
      }
    })

    it('runs a keyword (BM25) search', async () => {
      const result = await service.searchKeyword(COLLECTION, 'batch', ['title'], 5, undefined, ['title'])

      expect(Array.isArray(result)).toBe(true)
    })

    it('runs a hybrid search with an explicit vector', async () => {
      const result = await service.searchHybrid(
        COLLECTION,
        'batch',
        0.5,
        [0.1, 0.2, 0.3],
        5,
        undefined,
        ['title']
      )

      expect(Array.isArray(result)).toBe(true)
    })

    it('runs a raw GraphQL query', async () => {
      const result = await service.graphqlQuery(`{ Get { ${ COLLECTION }(limit: 1) { title _additional { id } } } }`)

      expect(result).toHaveProperty('Get')
    })

    it('previews a batch delete with a dry run and then deletes', async () => {
      const where = { path: ['status'], operator: 'Equal', valueText: 'draft' }

      const preview = await service.batchDeleteObjects(COLLECTION, where, true)

      expect(preview).toHaveProperty('results')

      const deleted = await service.batchDeleteObjects(COLLECTION, where, false)

      expect(deleted).toHaveProperty('results')
    })

    it('deletes the remaining object', async () => {
      const result = await service.deleteObject(COLLECTION, createdObjectId)

      expect(result).toEqual({ success: true, id: createdObjectId })
    })

    it('deletes the collection', async () => {
      const result = await service.deleteCollection(COLLECTION)

      expect(result).toEqual({ success: true, className: COLLECTION })
    })
  })

  // ── Optional: semantic text search against a vectorized collection ──

  describe('searchText', () => {
    it('runs a semantic search against a vectorized collection', async () => {
      const { vectorizedCollection, textQuery } = testValues

      if (!vectorizedCollection || !textQuery) {
        console.log(
          'Skipping searchText: testValues.vectorizedCollection or testValues.textQuery not set'
        )

        return
      }

      const result = await service.searchText(vectorizedCollection, textQuery, [], 3)

      expect(Array.isArray(result)).toBe(true)
    })
  })
})
