'use strict'

// ============================================================================
//  MongoDB Service — E2E Tests
//
//  Requires a real MongoDB connection. Fill in e2e-config.json with:
//  {
//    "mongodb": {
//      "configs": {
//        "connectionString": "mongodb+srv://user:pass@cluster0.xxxxx.mongodb.net",
//        "database": "flowrunner_e2e_test"
//      },
//      "testValues": {}
//    }
//  }
//
//  Note: the mongodb service uses the native driver (not Flowrunner.Request),
//  so we only use createE2ESandbox for config loading and service registration.
// ============================================================================

const { createE2ESandbox } = require('../../../service-sandbox')

describe('MongoDB Service (e2e)', () => {
  let sandbox
  let service

  // A throwaway collection name so the e2e run never touches real data.
  const testCollection = `e2e_mongodb_${ Date.now() }`

  beforeAll(() => {
    sandbox = createE2ESandbox('mongodb')
    require('../src/index.js')

    try {
      sandbox.validateConfigs()
    } catch (error) {
      console.log(error)
      process.exit(1)
    }

    service = sandbox.getService()
  })

  afterAll(async () => {
    // Clean up the test collection.
    try {
      await service.dropCollection(testCollection)
    } catch (e) {
      // ignore cleanup errors
    }

    sandbox.cleanup()
  })

  // ── Collections ──

  describe('listCollections', () => {
    it('returns a list with the expected shape', async () => {
      const result = await service.listCollections()

      expect(result).toHaveProperty('collections')
      expect(result).toHaveProperty('count')
      expect(Array.isArray(result.collections)).toBe(true)
    })
  })

  describe('createCollection + dropCollection', () => {
    const tempCollection = `e2e_temp_${ Date.now() }`

    it('creates a new collection', async () => {
      const result = await service.createCollection(tempCollection)

      expect(result).toEqual({ collection: tempCollection, created: true })
    })

    it('drops the created collection', async () => {
      const result = await service.dropCollection(tempCollection)

      expect(result).toEqual({ collection: tempCollection, dropped: true })
    })

    it('returns dropped=false for a non-existent collection', async () => {
      const result = await service.dropCollection(`nonexistent_${ Date.now() }`)

      expect(result.dropped).toBe(false)
    })
  })

  // ── Document lifecycle: insert, find, update, replace, delete ──

  describe('document lifecycle', () => {
    let insertedId

    it('inserts a single document', async () => {
      const result = await service.insertDocument(testCollection, {
        name: 'Ada Lovelace',
        role: 'engineer',
        score: 100,
      })

      expect(result).toHaveProperty('insertedId')
      expect(result.acknowledged).toBe(true)
      insertedId = result.insertedId
    })

    it('finds the inserted document by _id', async () => {
      const result = await service.findOneDocument(testCollection, { _id: insertedId })

      expect(result.found).toBe(true)
      expect(result.document).toHaveProperty('name', 'Ada Lovelace')
    })

    it('finds documents with filter and projection', async () => {
      const result = await service.findDocuments(
        testCollection,
        { role: 'engineer' },
        { name: 1 },
        { name: 1 },
        10,
        0
      )

      expect(result).toHaveProperty('documents')
      expect(result).toHaveProperty('count')
      expect(result.count).toBeGreaterThanOrEqual(1)
    })

    it('updates the document with $set', async () => {
      const result = await service.updateDocument(
        testCollection,
        { _id: insertedId },
        { role: 'senior engineer' }
      )

      expect(result.matchedCount).toBe(1)
      expect(result.modifiedCount).toBe(1)
    })

    it('verifies the update', async () => {
      const result = await service.findOneDocument(testCollection, { _id: insertedId })

      expect(result.document.role).toBe('senior engineer')
    })

    it('replaces the document', async () => {
      const result = await service.replaceDocument(
        testCollection,
        { _id: insertedId },
        { name: 'Ada Lovelace', role: 'architect', score: 200 }
      )

      expect(result.matchedCount).toBe(1)
      expect(result.modifiedCount).toBe(1)
    })

    it('deletes the document', async () => {
      const result = await service.deleteDocument(testCollection, { _id: insertedId })

      expect(result.deletedCount).toBe(1)
    })

    it('confirms the document is gone', async () => {
      const result = await service.findOneDocument(testCollection, { _id: insertedId })

      expect(result.found).toBe(false)
    })
  })

  // ── Bulk operations ──

  describe('bulk operations', () => {
    it('bulk-inserts documents', async () => {
      const result = await service.insertDocuments(testCollection, [
        { name: 'Bulk A', status: 'active', city: 'London' },
        { name: 'Bulk B', status: 'active', city: 'Paris' },
        { name: 'Bulk C', status: 'inactive', city: 'Tokyo' },
      ])

      expect(result.insertedCount).toBe(3)
    })

    it('updates multiple documents', async () => {
      const result = await service.updateDocuments(
        testCollection,
        { status: 'active' },
        { $set: { status: 'archived' } }
      )

      expect(result.matchedCount).toBeGreaterThanOrEqual(2)
      expect(result.modifiedCount).toBeGreaterThanOrEqual(2)
    })

    it('deletes multiple documents', async () => {
      const result = await service.deleteDocuments(testCollection, { status: { $exists: true } })

      expect(result.deletedCount).toBeGreaterThanOrEqual(1)
    })
  })

  // ── Aggregation & analysis ──

  describe('aggregation', () => {
    beforeAll(async () => {
      // Seed some data for aggregation tests.
      await service.insertDocuments(testCollection, [
        { name: 'A', country: 'US', score: 10 },
        { name: 'B', country: 'US', score: 20 },
        { name: 'C', country: 'UK', score: 30 },
      ])
    })

    it('counts documents with filter', async () => {
      const result = await service.countDocuments(testCollection, { country: 'US' })

      expect(result.count).toBe(2)
    })

    it('counts all documents without filter', async () => {
      const result = await service.countDocuments(testCollection)

      expect(result.count).toBeGreaterThanOrEqual(3)
    })

    it('returns distinct values', async () => {
      const result = await service.distinctValues(testCollection, 'country')

      expect(result.values).toEqual(expect.arrayContaining(['US', 'UK']))
      expect(result.count).toBeGreaterThanOrEqual(2)
    })

    it('runs an aggregation pipeline', async () => {
      const result = await service.aggregate(testCollection, [
        { $group: { _id: '$country', totalScore: { $sum: '$score' } } },
        { $sort: { _id: 1 } },
      ])

      expect(result).toHaveProperty('results')
      expect(result).toHaveProperty('count')
      expect(result.count).toBeGreaterThanOrEqual(2)
    })
  })

  // ── Indexes ──

  describe('indexes', () => {
    it('creates an index', async () => {
      const result = await service.createIndex(testCollection, { name: 1 })

      expect(result).toHaveProperty('indexName')
      expect(result.collection).toBe(testCollection)
    })

    it('lists indexes (at least _id and the created one)', async () => {
      const result = await service.listIndexes(testCollection)

      expect(result.count).toBeGreaterThanOrEqual(2)
      expect(result.indexes.map(i => i.name)).toEqual(expect.arrayContaining(['_id_']))
    })
  })

  // ── Dictionary ──

  describe('getCollectionsDictionary', () => {
    it('returns dictionary items with label/value/note', async () => {
      const result = await service.getCollectionsDictionary({})

      expect(result).toHaveProperty('items')
      expect(result).toHaveProperty('cursor')
      expect(Array.isArray(result.items)).toBe(true)

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
        expect(result.items[0]).toHaveProperty('note')
      }
    })

    it('filters collections by search text', async () => {
      const result = await service.getCollectionsDictionary({ search: testCollection.slice(0, 10) })

      expect(result.items.length).toBeGreaterThanOrEqual(1)
      expect(result.items.some(i => i.value === testCollection)).toBe(true)
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('throws on invalid filter for findOneDocument', async () => {
      await expect(service.findOneDocument(testCollection, {})).rejects.toThrow('must be a non-empty object')
    })

    it('throws on empty document for insertDocument', async () => {
      await expect(service.insertDocument(testCollection, {})).rejects.toThrow('must be a non-empty object')
    })
  })
})
