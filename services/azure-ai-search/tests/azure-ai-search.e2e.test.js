'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Azure AI Search Service (e2e)', () => {
  let sandbox
  let service

  beforeAll(() => {
    sandbox = createE2ESandbox('azure-ai-search')
    require('../src/index.js')

    try {
      sandbox.validateConfigs()
    } catch (error) {
      console.log(error)
      process.exit(1)
    }

    service = sandbox.getService()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Indexes ──

  describe('listIndexes', () => {
    it('returns indexes with expected shape', async () => {
      const result = await service.listIndexes()

      expect(result).toHaveProperty('value')
      expect(Array.isArray(result.value)).toBe(true)
    })

    it('returns only names when select is "name"', async () => {
      const result = await service.listIndexes('name')

      expect(result).toHaveProperty('value')
      expect(Array.isArray(result.value)).toBe(true)

      if (result.value.length > 0) {
        expect(result.value[0]).toHaveProperty('name')
      }
    })
  })

  describe('createIndex + getIndex + getIndexStatistics + deleteIndex', () => {
    const testIndexName = 'e2e-test-index-' + Date.now()
    const fields = [
      { name: 'id', type: 'Edm.String', key: true, searchable: false, filterable: true, sortable: false, facetable: false, retrievable: true },
      { name: 'title', type: 'Edm.String', searchable: true, filterable: false, sortable: false, facetable: false, retrievable: true },
      { name: 'category', type: 'Edm.String', searchable: true, filterable: true, sortable: false, facetable: true, retrievable: true },
    ]

    it('creates a new index', async () => {
      const result = await service.createIndex(testIndexName, fields)

      expect(result).toHaveProperty('name', testIndexName)
      expect(result).toHaveProperty('fields')
      expect(Array.isArray(result.fields)).toBe(true)
    })

    it('retrieves the created index', async () => {
      const result = await service.getIndex(testIndexName)

      expect(result).toHaveProperty('name', testIndexName)
      expect(result).toHaveProperty('fields')
    })

    it('gets index statistics', async () => {
      const result = await service.getIndexStatistics(testIndexName)

      expect(result).toHaveProperty('documentCount')
      expect(result).toHaveProperty('storageSize')
    })

    it('deletes the test index', async () => {
      const result = await service.deleteIndex(testIndexName)

      expect(result).toEqual({ deleted: true, name: testIndexName })
    })
  })

  // ── Documents ──

  describe('document operations', () => {
    const testIndexName = 'e2e-test-docs-' + Date.now()
    const fields = [
      { name: 'id', type: 'Edm.String', key: true, searchable: false, filterable: true, sortable: false, facetable: false, retrievable: true },
      { name: 'title', type: 'Edm.String', searchable: true, filterable: false, sortable: false, facetable: false, retrievable: true },
      { name: 'category', type: 'Edm.String', searchable: true, filterable: true, sortable: false, facetable: true, retrievable: true },
    ]

    beforeAll(async () => {
      // Create a temporary index for document operations
      await service.createIndex(testIndexName, fields)

      // Upload test documents
      await service.indexDocuments(testIndexName, [
        { '@search.action': 'upload', id: '1', title: 'Luxury Hotel', category: 'Luxury' },
        { '@search.action': 'upload', id: '2', title: 'Budget Motel', category: 'Budget' },
        { '@search.action': 'upload', id: '3', title: 'Seaside Resort', category: 'Luxury' },
      ])

      // Wait for indexing to complete
      await new Promise(resolve => setTimeout(resolve, 3000))
    })

    afterAll(async () => {
      // Clean up the test index
      try {
        await service.deleteIndex(testIndexName)
      } catch {
        // Ignore cleanup errors
      }
    })

    it('searches documents with text query', async () => {
      const result = await service.searchDocuments(testIndexName, 'luxury')

      expect(result).toHaveProperty('value')
      expect(Array.isArray(result.value)).toBe(true)
    })

    it('searches with filter', async () => {
      const result = await service.searchDocuments(
        testIndexName, '*', "category eq 'Luxury'", 10
      )

      expect(result).toHaveProperty('value')
      expect(Array.isArray(result.value)).toBe(true)
    })

    it('searches with select', async () => {
      const result = await service.searchDocuments(
        testIndexName, '*', undefined, 10, undefined, 'id,title'
      )

      expect(result).toHaveProperty('value')

      if (result.value.length > 0) {
        expect(result.value[0]).toHaveProperty('id')
        expect(result.value[0]).toHaveProperty('title')
      }
    })

    it('gets a document by key', async () => {
      const result = await service.getDocument(testIndexName, '1')

      expect(result).toHaveProperty('id', '1')
      expect(result).toHaveProperty('title')
    })

    it('gets a document with select', async () => {
      const result = await service.getDocument(testIndexName, '1', 'id,title')

      expect(result).toHaveProperty('id', '1')
      expect(result).toHaveProperty('title')
    })

    it('counts documents in the index', async () => {
      const result = await service.countDocuments(testIndexName)

      expect(result).toHaveProperty('count')
      expect(typeof result.count).toBe('number')
      expect(result.count).toBeGreaterThanOrEqual(0)
    })

    it('indexes a merge operation', async () => {
      const result = await service.indexDocuments(testIndexName, [
        { '@search.action': 'merge', id: '1', title: 'Updated Luxury Hotel' },
      ])

      expect(result).toHaveProperty('value')
      expect(result.value[0]).toHaveProperty('status', true)
    })
  })

  // ── Indexers ──

  describe('listIndexers', () => {
    it('returns indexers list with expected shape', async () => {
      const result = await service.listIndexers()

      expect(result).toHaveProperty('value')
      expect(Array.isArray(result.value)).toBe(true)
    })
  })

  // ── Dictionaries ──

  describe('getIndexesDictionary', () => {
    it('returns dictionary with expected shape', async () => {
      const result = await service.getIndexesDictionary({})

      expect(result).toHaveProperty('items')
      expect(result).toHaveProperty('cursor', null)
      expect(Array.isArray(result.items)).toBe(true)

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
        expect(result.items[0]).toHaveProperty('note', 'Index')
      }
    })

    it('filters by search term', async () => {
      const allResult = await service.getIndexesDictionary({})
      const filteredResult = await service.getIndexesDictionary({ search: 'zzz-nonexistent-zzz' })

      expect(filteredResult.items.length).toBeLessThanOrEqual(allResult.items.length)
    })
  })
})
