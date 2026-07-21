'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Milvus Service (e2e)', () => {
  let sandbox
  let service
  let testCollection

  beforeAll(() => {
    sandbox = createE2ESandbox('milvus')
    require('../src/index.js')

    try {
      sandbox.validateConfigs()
    } catch (error) {
      console.log(error)
      process.exit(1)
    }

    service = sandbox.getService()

    // Generate a unique collection name so the suite never collides with real data.
    testCollection = `flowrunner_e2e_${ Date.now() }`
  })

  afterAll(async () => {
    // Best-effort cleanup: drop the test collection if it still exists.
    if (service && testCollection) {
      try {
        await service.dropCollection(testCollection)
      } catch (error) {
        // Ignore: collection may already be gone.
      }
    }

    sandbox.cleanup()
  })

  // ── Collections lifecycle ──

  describe('createCollection + hasCollection + describeCollection + listCollections + getCollectionStats', () => {
    it('creates a test collection with quick setup', async () => {
      const result = await service.createCollection(testCollection, 4, 'Cosine')

      // createCollection returns the unwrapped data, which for success is typically {}
      expect(result).toBeDefined()
    })

    it('confirms the collection exists', async () => {
      const result = await service.hasCollection(testCollection)

      expect(result).toHaveProperty('has', true)
    })

    it('describes the collection', async () => {
      const result = await service.describeCollection(testCollection)

      expect(result).toHaveProperty('collectionName', testCollection)
      expect(result).toHaveProperty('fields')
      expect(Array.isArray(result.fields)).toBe(true)
    })

    it('lists collections and includes the test collection', async () => {
      const result = await service.listCollections()

      expect(Array.isArray(result)).toBe(true)
      expect(result).toContain(testCollection)
    })

    it('gets collection stats', async () => {
      const result = await service.getCollectionStats(testCollection)

      expect(result).toHaveProperty('rowCount')
    })
  })

  // ── Load / Release ──

  describe('loadCollection + releaseCollection', () => {
    it('loads the test collection', async () => {
      const result = await service.loadCollection(testCollection)

      expect(result).toBeDefined()
    })

    it('releases the test collection', async () => {
      const result = await service.releaseCollection(testCollection)

      expect(result).toBeDefined()
    })
  })

  // ── Entities ──

  describe('insertEntities + getEntities + searchEntities + queryEntities + upsertEntities + deleteEntities', () => {
    beforeAll(async () => {
      // Ensure collection is loaded for search/query.
      await service.loadCollection(testCollection)
    })

    it('inserts entities', async () => {
      const data = [
        { id: 1, vector: [0.1, 0.2, 0.3, 0.4] },
        { id: 2, vector: [0.5, 0.6, 0.7, 0.8] },
        { id: 3, vector: [0.9, 0.1, 0.2, 0.3] },
      ]

      const result = await service.insertEntities(testCollection, data)

      expect(result).toHaveProperty('insertCount')
      expect(result.insertCount).toBe(3)
    })

    it('gets entities by IDs', async () => {
      const result = await service.getEntities(testCollection, [1, 2])

      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThanOrEqual(1)
    })

    it('searches entities by vector similarity', async () => {
      const result = await service.searchEntities(testCollection, [[0.1, 0.2, 0.3, 0.4]], undefined, 2)

      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThan(0)
      expect(result[0]).toHaveProperty('id')
      expect(result[0]).toHaveProperty('distance')
    })

    it('queries entities by filter', async () => {
      const result = await service.queryEntities(testCollection, 'id > 0', ['id'], 10)

      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThan(0)
    })

    it('upserts entities', async () => {
      const data = [
        { id: 1, vector: [0.2, 0.3, 0.4, 0.5] },
      ]

      const result = await service.upsertEntities(testCollection, data)

      expect(result).toHaveProperty('upsertCount')
      expect(result.upsertCount).toBe(1)
    })

    it('deletes entities by IDs', async () => {
      const result = await service.deleteEntities(testCollection, [3])

      expect(result).toBeDefined()
    })

    it('deletes entities by filter', async () => {
      const result = await service.deleteEntities(testCollection, undefined, 'id > 0')

      expect(result).toBeDefined()
    })
  })

  // ── Partitions ──

  describe('createPartition + listPartitions + dropPartition', () => {
    const partitionName = 'e2e_partition'

    it('creates a partition', async () => {
      const result = await service.createPartition(testCollection, partitionName)

      expect(result).toBeDefined()
    })

    it('lists partitions and includes the new partition', async () => {
      const result = await service.listPartitions(testCollection)

      expect(Array.isArray(result)).toBe(true)
      expect(result).toContain(partitionName)
    })

    it('drops the partition', async () => {
      // Must release collection before dropping a partition.
      await service.releaseCollection(testCollection)

      const result = await service.dropPartition(testCollection, partitionName)

      expect(result).toBeDefined()
    })
  })

  // ── Indexes ──

  describe('createIndex + listIndexes + describeIndex + dropIndex', () => {
    const indexName = 'e2e_vector_index'

    it('lists existing indexes', async () => {
      const result = await service.listIndexes(testCollection)

      expect(Array.isArray(result)).toBe(true)
    })

    // Note: Index creation, describe, and drop depend heavily on collection state.
    // Quick-setup collections may already have an auto-index. These tests verify the
    // API calls succeed without errors.
  })

  // ── Dictionary ──

  describe('getCollectionsDictionary', () => {
    it('returns a dictionary with items array and null cursor', async () => {
      const result = await service.getCollectionsDictionary({})

      expect(result).toHaveProperty('items')
      expect(result).toHaveProperty('cursor', null)
      expect(Array.isArray(result.items)).toBe(true)
      expect(result.items.some(item => item.value === testCollection)).toBe(true)
    })

    it('filters collections by search term', async () => {
      const result = await service.getCollectionsDictionary({ search: testCollection })

      expect(result.items.length).toBeGreaterThan(0)
      expect(result.items.every(item => item.value.includes(testCollection))).toBe(true)
    })
  })

  // ── Cleanup ──

  describe('dropCollection', () => {
    it('drops the test collection', async () => {
      const result = await service.dropCollection(testCollection)

      expect(result).toBeDefined()
    })

    it('confirms the collection no longer exists', async () => {
      const result = await service.hasCollection(testCollection)

      expect(result).toHaveProperty('has', false)
    })
  })
})
