'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Elasticsearch Service (e2e)', () => {
  let sandbox
  let service
  let testIndex

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

    // Allow overriding the scratch index name via testValues; otherwise generate a
    // unique, self-contained index so the suite never collides with real data.
    testIndex = sandbox.getTestValues().testIndex || `flowrunner-e2e-${ Date.now() }`
  })

  afterAll(async () => {
    // Best-effort cleanup: remove the scratch index if it still exists.
    if (service && testIndex) {
      try {
        await service.deleteIndex(testIndex)
      } catch (error) {
        // Ignore: index may already be gone.
      }
    }

    sandbox.cleanup()
  })

  // ── Cluster ──

  describe('info', () => {
    it('returns cluster info with a version', async () => {
      const result = await service.info()

      expect(result).toHaveProperty('version')
      expect(result.version).toHaveProperty('number')
    })
  })

  describe('clusterHealth', () => {
    it('returns cluster health with a status', async () => {
      const result = await service.clusterHealth()

      expect(result).toHaveProperty('status')
      expect(['green', 'yellow', 'red']).toContain(result.status)
    })
  })

  // ── Indices lifecycle ──

  describe('createIndex + getIndex + getMapping + listIndices + deleteIndex', () => {
    it('creates the scratch index', async () => {
      const result = await service.createIndex(
        testIndex,
        { number_of_shards: 1, number_of_replicas: 0 },
        { properties: { name: { type: 'text' }, price: { type: 'float' } } }
      )

      expect(result).toHaveProperty('acknowledged', true)
      expect(result).toHaveProperty('index', testIndex)
    })

    it('retrieves the index definition', async () => {
      const result = await service.getIndex(testIndex)

      expect(result).toHaveProperty(testIndex)
      expect(result[testIndex]).toHaveProperty('mappings')
      expect(result[testIndex]).toHaveProperty('settings')
    })

    it('retrieves the index mapping', async () => {
      const result = await service.getMapping(testIndex)

      expect(result).toHaveProperty(testIndex)
      expect(result[testIndex].mappings.properties).toHaveProperty('name')
    })

    it('lists indices and includes the scratch index', async () => {
      const result = await service.listIndices()

      expect(Array.isArray(result)).toBe(true)
      expect(result.some(row => row.index === testIndex)).toBe(true)
    })

    it('reports the scratch index exists via HEAD', async () => {
      const result = await service.indexExists(testIndex)

      expect(result).toEqual({ exists: true })
    })

    it('reports a missing index does not exist without throwing', async () => {
      const result = await service.indexExists(`${ testIndex }-does-not-exist`)

      expect(result).toEqual({ exists: false })
    })
  })

  // ── Documents ──

  describe('indexDocument + getDocument + updateDocument + search + count + deleteDocument', () => {
    const docId = 'e2e-doc-1'

    it('indexes a document at a known id (waiting for refresh)', async () => {
      const result = await service.indexDocument(
        testIndex,
        { name: 'Widget', price: 9.99 },
        docId,
        'Wait For Refresh'
      )

      expect(result).toHaveProperty('_id', docId)
      expect(['created', 'updated']).toContain(result.result)
    })

    it('retrieves the indexed document', async () => {
      const result = await service.getDocument(testIndex, docId)

      expect(result).toHaveProperty('found', true)
      expect(result._source).toMatchObject({ name: 'Widget' })
    })

    it('partially updates the document', async () => {
      const result = await service.updateDocument(
        testIndex,
        docId,
        { price: 12.5 },
        undefined,
        undefined,
        'Wait For Refresh'
      )

      expect(['updated', 'noop']).toContain(result.result)
    })

    it('searches the index and finds the document', async () => {
      const result = await service.search(testIndex, { match: { name: 'Widget' } })

      expect(result).toHaveProperty('hits')
      expect(result.hits).toHaveProperty('hits')
      expect(Array.isArray(result.hits.hits)).toBe(true)
      expect(result.hits.hits.length).toBeGreaterThan(0)
    })

    it('counts documents in the index', async () => {
      const result = await service.count(testIndex, { match_all: {} })

      expect(result).toHaveProperty('count')
      expect(result.count).toBeGreaterThan(0)
    })

    it('deletes the document', async () => {
      const result = await service.deleteDocument(testIndex, docId, 'Wait For Refresh')

      expect(result).toHaveProperty('result', 'deleted')
    })
  })

  // ── Bulk + query-by ──

  describe('bulk + updateByQuery + deleteByQuery', () => {
    it('bulk-indexes several documents', async () => {
      const result = await service.bulk(
        testIndex,
        [
          { action: 'index', _id: 'b1', source: { name: 'Alpha', active: true } },
          { action: 'index', _id: 'b2', source: { name: 'Beta', active: true } },
          { action: 'index', _id: 'b3', source: { name: 'Gamma', active: false } },
        ],
        'Refresh Now'
      )

      expect(result).toHaveProperty('errors', false)
      expect(Array.isArray(result.items)).toBe(true)
      expect(result.items).toHaveLength(3)
    })

    it('updates matching documents by query', async () => {
      const result = await service.updateByQuery(
        testIndex,
        { term: { active: true } },
        { source: "ctx._source.name = ctx._source.name + '!'", lang: 'painless' },
        undefined,
        'Refresh Now'
      )

      expect(result).toHaveProperty('updated')
      expect(result.updated).toBeGreaterThan(0)
    })

    it('deletes matching documents by query', async () => {
      const result = await service.deleteByQuery(
        testIndex,
        { match_all: {} },
        undefined,
        'Refresh Now'
      )

      expect(result).toHaveProperty('deleted')
      expect(result.deleted).toBeGreaterThan(0)
    })
  })

  // ── Index refresh ──

  describe('refreshIndex', () => {
    it('refreshes the scratch index', async () => {
      const result = await service.refreshIndex(testIndex)

      expect(result).toHaveProperty('_shards')
    })
  })

  // ── Dictionary ──

  describe('getIndicesDictionary', () => {
    it('returns a dictionary with an items array and a null cursor', async () => {
      const result = await service.getIndicesDictionary({})

      expect(result).toHaveProperty('items')
      expect(result).toHaveProperty('cursor', null)
      expect(Array.isArray(result.items)).toBe(true)
      expect(result.items.some(item => item.value === testIndex)).toBe(true)
    })

    it('filters indices by search term', async () => {
      const result = await service.getIndicesDictionary({ search: testIndex })

      expect(result.items.every(item => item.value.includes(testIndex))).toBe(true)
    })
  })

  // ── Cleanup verification ──

  describe('deleteIndex', () => {
    it('deletes the scratch index', async () => {
      const result = await service.deleteIndex(testIndex)

      expect(result).toHaveProperty('acknowledged', true)
    })
  })
})
