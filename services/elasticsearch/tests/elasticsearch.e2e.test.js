'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Elasticsearch Service (e2e)', () => {
  let sandbox
  let service

  const TEST_INDEX = `flowrunner-e2e-test-${ Date.now() }`

  beforeAll(() => {
    sandbox = createE2ESandbox('elasticsearch')
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
    // Clean up: delete the test index if it exists
    try {
      await service.deleteIndex(TEST_INDEX)
    } catch {
      // ignore if already deleted or never created
    }

    sandbox.cleanup()
  })

  // ── Cluster ──

  describe('info', () => {
    it('returns cluster info with version', async () => {
      const result = await service.info()

      expect(result).toHaveProperty('name')
      expect(result).toHaveProperty('cluster_name')
      expect(result).toHaveProperty('version')
      expect(result.version).toHaveProperty('number')
    })
  })

  describe('clusterHealth', () => {
    it('returns cluster health with status', async () => {
      const result = await service.clusterHealth()

      expect(result).toHaveProperty('cluster_name')
      expect(result).toHaveProperty('status')
      expect(['green', 'yellow', 'red']).toContain(result.status)
      expect(result).toHaveProperty('number_of_nodes')
    })
  })

  // ── Index lifecycle ──

  describe('index lifecycle', () => {
    it('creates an index', async () => {
      const result = await service.createIndex(TEST_INDEX, {
        number_of_shards: 1,
        number_of_replicas: 0,
      }, {
        properties: {
          name: { type: 'text' },
          price: { type: 'float' },
          category: { type: 'keyword' },
        },
      })

      expect(result).toHaveProperty('acknowledged', true)
    })

    it('confirms the index exists', async () => {
      const result = await service.indexExists(TEST_INDEX)

      expect(result).toEqual({ exists: true })
    })

    it('returns exists false for non-existent index', async () => {
      const result = await service.indexExists('this-index-does-not-exist-xyz')

      expect(result).toEqual({ exists: false })
    })

    it('retrieves index info', async () => {
      const result = await service.getIndex(TEST_INDEX)

      expect(result).toHaveProperty(TEST_INDEX)
      expect(result[TEST_INDEX]).toHaveProperty('mappings')
      expect(result[TEST_INDEX]).toHaveProperty('settings')
    })

    it('retrieves index mapping', async () => {
      const result = await service.getMapping(TEST_INDEX)

      expect(result).toHaveProperty(TEST_INDEX)
      expect(result[TEST_INDEX]).toHaveProperty('mappings')
      expect(result[TEST_INDEX].mappings.properties).toHaveProperty('name')
    })
  })

  // ── Document CRUD ──

  describe('document CRUD', () => {
    let autoId

    it('indexes a document with auto-generated ID', async () => {
      const result = await service.indexDocument(TEST_INDEX, {
        name: 'Widget',
        price: 9.99,
        category: 'tools',
      }, undefined, 'Refresh Now')

      expect(result).toHaveProperty('_id')
      expect(result).toHaveProperty('result', 'created')
      autoId = result._id
    })

    it('indexes a document with explicit ID', async () => {
      const result = await service.indexDocument(TEST_INDEX, {
        name: 'Gadget',
        price: 19.99,
        category: 'electronics',
      }, 'doc-2', 'Refresh Now')

      expect(result).toHaveProperty('_id', 'doc-2')
      expect(result).toHaveProperty('result', 'created')
    })

    it('gets a document by ID', async () => {
      const result = await service.getDocument(TEST_INDEX, 'doc-2')

      expect(result).toHaveProperty('found', true)
      expect(result._source).toMatchObject({
        name: 'Gadget',
        price: 19.99,
        category: 'electronics',
      })
    })

    it('updates a document with partial doc', async () => {
      const result = await service.updateDocument(
        TEST_INDEX, 'doc-2', { price: 24.99 }, undefined, undefined, 'Refresh Now'
      )

      expect(result).toHaveProperty('result', 'updated')

      const doc = await service.getDocument(TEST_INDEX, 'doc-2')

      expect(doc._source.price).toBe(24.99)
      expect(doc._source.name).toBe('Gadget')
    })

    it('deletes a document', async () => {
      const result = await service.deleteDocument(TEST_INDEX, autoId, 'Refresh Now')

      expect(result).toHaveProperty('result', 'deleted')
    })
  })

  // ── Search ──

  describe('search and count', () => {
    it('searches for documents', async () => {
      const result = await service.search(TEST_INDEX, {
        match: { name: 'Gadget' },
      })

      expect(result).toHaveProperty('hits')
      expect(result.hits).toHaveProperty('total')
      expect(result.hits.hits.length).toBeGreaterThanOrEqual(1)
    })

    it('searches with size and from', async () => {
      const result = await service.search(TEST_INDEX, undefined, 1, 0)

      expect(result.hits.hits.length).toBeLessThanOrEqual(1)
    })

    it('counts documents', async () => {
      const result = await service.count(TEST_INDEX)

      expect(result).toHaveProperty('count')
      expect(typeof result.count).toBe('number')
      expect(result.count).toBeGreaterThanOrEqual(1)
    })

    it('counts documents with query', async () => {
      const result = await service.count(TEST_INDEX, {
        match: { category: 'electronics' },
      })

      expect(result.count).toBeGreaterThanOrEqual(1)
    })
  })

  // ── Bulk ──

  describe('bulk operations', () => {
    it('performs bulk index and delete', async () => {
      const result = await service.bulk(TEST_INDEX, [
        { action: 'index', _id: 'bulk-1', source: { name: 'Bulk Item 1', price: 5, category: 'misc' } },
        { action: 'index', _id: 'bulk-2', source: { name: 'Bulk Item 2', price: 10, category: 'misc' } },
      ], 'Refresh Now')

      expect(result).toHaveProperty('errors', false)
      expect(result.items).toHaveLength(2)

      // Clean up bulk items
      await service.bulk(TEST_INDEX, [
        { action: 'delete', _id: 'bulk-1' },
        { action: 'delete', _id: 'bulk-2' },
      ], 'Refresh Now')
    })
  })

  // ── Update/Delete By Query ──

  describe('update by query', () => {
    it('updates documents matching a query', async () => {
      const result = await service.updateByQuery(
        TEST_INDEX,
        { match: { category: 'electronics' } },
        { source: 'ctx._source.price += 1', lang: 'painless' },
        undefined,
        'Refresh Now',
      )

      expect(result).toHaveProperty('updated')
      expect(result.updated).toBeGreaterThanOrEqual(1)
    })
  })

  // ── Refresh + List ──

  describe('refreshIndex', () => {
    it('refreshes the test index', async () => {
      const result = await service.refreshIndex(TEST_INDEX)

      expect(result).toHaveProperty('_shards')
      expect(result._shards).toHaveProperty('successful')
    })
  })

  describe('listIndices', () => {
    it('returns an array of indices including the test index', async () => {
      const result = await service.listIndices()

      expect(Array.isArray(result)).toBe(true)

      const testEntry = result.find(r => r.index === TEST_INDEX)

      expect(testEntry).toBeDefined()
    })
  })

  // ── Dictionary ──

  describe('getIndicesDictionary', () => {
    it('returns items array with test index', async () => {
      const result = await service.getIndicesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)

      const testItem = result.items.find(i => i.value === TEST_INDEX)

      expect(testItem).toBeDefined()
      expect(testItem).toHaveProperty('label', TEST_INDEX)
    })

    it('filters by search term', async () => {
      const result = await service.getIndicesDictionary({ search: 'flowrunner-e2e' })

      expect(result.items.length).toBeGreaterThanOrEqual(1)
      expect(result.items.every(i => i.value.includes('flowrunner-e2e'))).toBe(true)
    })
  })

  // ── Delete by query + cleanup ──

  describe('deleteByQuery', () => {
    it('deletes documents matching a query', async () => {
      // First index a doc to delete
      await service.indexDocument(TEST_INDEX, {
        name: 'To Delete',
        price: 0,
        category: 'delete-me',
      }, 'del-target', 'Refresh Now')

      const result = await service.deleteByQuery(
        TEST_INDEX,
        { match: { category: 'delete-me' } },
        undefined,
        'Refresh Now',
      )

      expect(result).toHaveProperty('deleted')
      expect(result.deleted).toBeGreaterThanOrEqual(1)
    })
  })
})
