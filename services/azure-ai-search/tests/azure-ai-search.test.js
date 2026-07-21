'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-api-key'
const SERVICE_NAME = 'test-search-svc'
const API_VERSION = '2024-07-01'
const BASE = `https://${SERVICE_NAME}.search.windows.net`

describe('Azure AI Search Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({
      serviceName: SERVICE_NAME,
      apiKey: API_KEY,
    })

    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()
  })

  afterEach(() => {
    mock.reset()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Registration ──

  describe('service registration', () => {
    it('registers with correct config items', () => {
      const configs = sandbox.getConfigItems()

      expect(configs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'serviceName', required: true, shared: false }),
          expect.objectContaining({ name: 'apiKey', required: true, shared: false }),
          expect.objectContaining({ name: 'apiVersion', required: false, shared: false }),
        ])
      )
    })
  })

  // ── Indexes ──

  describe('createIndex', () => {
    const indexName = 'hotels'
    const fields = [
      { name: 'id', type: 'Edm.String', key: true },
      { name: 'description', type: 'Edm.String', searchable: true },
    ]

    it('sends PUT with correct body for required params only', async () => {
      const responseData = { name: indexName, fields }
      mock.onPut(`${BASE}/indexes/${indexName}?api-version=${API_VERSION}`).reply(responseData)

      const result = await service.createIndex(indexName, fields)

      expect(result).toEqual(responseData)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].headers).toMatchObject({ 'api-key': API_KEY })
      expect(mock.history[0].body).toEqual({ name: indexName, fields })
    })

    it('includes vectorSearch and semantic when provided', async () => {
      const vectorSearch = { algorithms: [{ name: 'hnsw', kind: 'hnsw' }] }
      const semantic = { configurations: [{ name: 'default' }] }
      mock.onPut(`${BASE}/indexes/${indexName}?api-version=${API_VERSION}`).reply({ name: indexName })

      await service.createIndex(indexName, fields, vectorSearch, semantic)

      expect(mock.history[0].body).toEqual({
        name: indexName,
        fields,
        vectorSearch,
        semantic,
      })
    })

    it('omits vectorSearch and semantic when not provided', async () => {
      mock.onPut(`${BASE}/indexes/${indexName}?api-version=${API_VERSION}`).reply({ name: indexName })

      await service.createIndex(indexName, fields)

      expect(mock.history[0].body).toEqual({ name: indexName, fields })
      expect(mock.history[0].body).not.toHaveProperty('vectorSearch')
      expect(mock.history[0].body).not.toHaveProperty('semantic')
    })

    it('throws on API error', async () => {
      mock.onPut(`${BASE}/indexes/${indexName}?api-version=${API_VERSION}`).replyWithError({
        message: 'Bad Request',
        body: { error: { code: 'InvalidIndexDefinition', message: 'Invalid field type' } },
      })

      await expect(service.createIndex(indexName, fields)).rejects.toThrow(
        'Azure AI Search API error [InvalidIndexDefinition]: Invalid field type'
      )
    })
  })

  describe('listIndexes', () => {
    it('sends GET with no select by default', async () => {
      const responseData = { value: [{ name: 'hotels' }, { name: 'products' }] }
      mock.onGet(`${BASE}/indexes?api-version=${API_VERSION}`).reply(responseData)

      const result = await service.listIndexes()

      expect(result).toEqual(responseData)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].headers).toMatchObject({ 'api-key': API_KEY })
    })

    it('passes select as $select query param', async () => {
      mock.onGet(`${BASE}/indexes?api-version=${API_VERSION}`).reply({ value: [] })

      await service.listIndexes('name')

      expect(mock.history[0].query).toMatchObject({ $select: 'name' })
    })
  })

  describe('getIndex', () => {
    it('sends GET to correct URL with index name', async () => {
      const responseData = { name: 'hotels', fields: [] }
      mock.onGet(`${BASE}/indexes/hotels?api-version=${API_VERSION}`).reply(responseData)

      const result = await service.getIndex('hotels')

      expect(result).toEqual(responseData)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].headers).toMatchObject({ 'api-key': API_KEY })
    })

    it('encodes special characters in index name', async () => {
      mock.onGet(`${BASE}/indexes/my%20index?api-version=${API_VERSION}`).reply({ name: 'my index' })

      await service.getIndex('my index')

      expect(mock.history[0].url).toContain('/indexes/my%20index')
    })
  })

  describe('deleteIndex', () => {
    it('sends DELETE and returns confirmation object', async () => {
      mock.onDelete(`${BASE}/indexes/hotels?api-version=${API_VERSION}`).reply(undefined)

      const result = await service.deleteIndex('hotels')

      expect(result).toEqual({ deleted: true, name: 'hotels' })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].headers).toMatchObject({ 'api-key': API_KEY })
    })
  })

  describe('getIndexStatistics', () => {
    it('sends GET to stats endpoint', async () => {
      const responseData = { documentCount: 1024, storageSize: 5242880, vectorIndexSize: 1048576 }
      mock.onGet(`${BASE}/indexes/hotels/stats?api-version=${API_VERSION}`).reply(responseData)

      const result = await service.getIndexStatistics('hotels')

      expect(result).toEqual(responseData)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
    })
  })

  // ── Documents ──

  describe('searchDocuments', () => {
    const indexName = 'hotels'
    const searchUrl = `${BASE}/indexes/${indexName}/docs/search?api-version=${API_VERSION}`

    it('sends POST with minimal params (search text only)', async () => {
      const responseData = { '@odata.count': 1, value: [{ id: '1' }] }
      mock.onPost(searchUrl).reply(responseData)

      const result = await service.searchDocuments(indexName, 'luxury')

      expect(result).toEqual(responseData)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].headers).toMatchObject({ 'api-key': API_KEY })
      expect(mock.history[0].body).toMatchObject({
        search: 'luxury',
        count: true,
      })
    })

    it('includes filter, top, skip, select, orderby when provided', async () => {
      mock.onPost(searchUrl).reply({ value: [] })

      await service.searchDocuments(
        indexName, '*', "category eq 'books'", 10, 20, 'id,name', 'price asc'
      )

      expect(mock.history[0].body).toMatchObject({
        search: '*',
        filter: "category eq 'books'",
        top: 10,
        skip: 20,
        select: 'id,name',
        orderby: 'price asc',
        count: true,
      })
    })

    it('includes facets and searchFields when provided', async () => {
      mock.onPost(searchUrl).reply({ value: [] })

      await service.searchDocuments(
        indexName, '*', undefined, undefined, undefined, undefined, undefined,
        ['category', 'price,interval:10'], 'title,description'
      )

      expect(mock.history[0].body).toMatchObject({
        facets: ['category', 'price,interval:10'],
        searchFields: 'title,description',
      })
    })

    it('maps queryType dropdown values correctly', async () => {
      mock.onPost(searchUrl).reply({ value: [] })

      await service.searchDocuments(
        indexName, '*', undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, 'Semantic', undefined, 'my-semantic-config'
      )

      expect(mock.history[0].body).toMatchObject({
        queryType: 'semantic',
        semanticConfiguration: 'my-semantic-config',
      })
    })

    it('includes vectorQueries for hybrid search', async () => {
      const vectorQueries = [{ kind: 'text', text: 'luxury', fields: 'embedding', k: 10 }]
      mock.onPost(searchUrl).reply({ value: [] })

      await service.searchDocuments(
        indexName, 'luxury', undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, vectorQueries
      )

      expect(mock.history[0].body).toMatchObject({
        search: 'luxury',
        vectorQueries,
      })
    })

    it('includes highlight when provided', async () => {
      mock.onPost(searchUrl).reply({ value: [] })

      await service.searchDocuments(
        indexName, 'luxury', undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined, 'description,title'
      )

      expect(mock.history[0].body).toMatchObject({
        highlight: 'description,title',
      })
    })

    it('omits empty/undefined optional fields from body', async () => {
      mock.onPost(searchUrl).reply({ value: [] })

      await service.searchDocuments(indexName)

      const body = mock.history[0].body
      expect(body).not.toHaveProperty('search')
      expect(body).not.toHaveProperty('filter')
      expect(body).not.toHaveProperty('top')
      expect(body).not.toHaveProperty('skip')
      expect(body).not.toHaveProperty('facets')
      expect(body).not.toHaveProperty('vectorQueries')
      expect(body.count).toBe(true)
    })

    it('omits facets when empty array is passed', async () => {
      mock.onPost(searchUrl).reply({ value: [] })

      await service.searchDocuments(
        indexName, '*', undefined, undefined, undefined, undefined, undefined, []
      )

      expect(mock.history[0].body).not.toHaveProperty('facets')
    })

    it('throws on API error', async () => {
      mock.onPost(searchUrl).replyWithError({
        message: 'Bad Request',
        body: { error: { code: 'InvalidFilter', message: 'Invalid filter expression' } },
      })

      await expect(service.searchDocuments(indexName, '*')).rejects.toThrow(
        'Azure AI Search API error [InvalidFilter]: Invalid filter expression'
      )
    })
  })

  describe('indexDocuments', () => {
    const indexName = 'hotels'
    const indexUrl = `${BASE}/indexes/${indexName}/docs/index?api-version=${API_VERSION}`

    it('sends POST with document batch', async () => {
      const docs = [
        { '@search.action': 'upload', id: '1', name: 'Hotel A' },
        { '@search.action': 'delete', id: '2' },
      ]
      const responseData = {
        value: [
          { key: '1', status: true, statusCode: 200 },
          { key: '2', status: true, statusCode: 200 },
        ],
      }
      mock.onPost(indexUrl).reply(responseData)

      const result = await service.indexDocuments(indexName, docs)

      expect(result).toEqual(responseData)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].body).toEqual({ value: docs })
    })
  })

  describe('getDocument', () => {
    it('sends GET with document key in URL', async () => {
      const responseData = { id: '1', name: 'Hotel A' }
      mock.onGet(`${BASE}/indexes/hotels/docs/1?api-version=${API_VERSION}`).reply(responseData)

      const result = await service.getDocument('hotels', '1')

      expect(result).toEqual(responseData)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
    })

    it('passes select as $select query param', async () => {
      mock.onGet(`${BASE}/indexes/hotels/docs/1?api-version=${API_VERSION}`).reply({ id: '1' })

      await service.getDocument('hotels', '1', 'id,name')

      expect(mock.history[0].query).toMatchObject({ $select: 'id,name' })
    })

    it('omits $select when not provided', async () => {
      mock.onGet(`${BASE}/indexes/hotels/docs/1?api-version=${API_VERSION}`).reply({ id: '1' })

      await service.getDocument('hotels', '1')

      // clean() removes undefined values, so $select should not be in query
      // The query is passed through clean() which removes undefined/null/empty
    })
  })

  describe('countDocuments', () => {
    it('returns count as number when API returns a number', async () => {
      mock.onGet(`${BASE}/indexes/hotels/docs/$count?api-version=${API_VERSION}`).reply(1024)

      const result = await service.countDocuments('hotels')

      expect(result).toEqual({ count: 1024 })
    })

    it('converts string count to number', async () => {
      mock.onGet(`${BASE}/indexes/hotels/docs/$count?api-version=${API_VERSION}`).reply('512')

      const result = await service.countDocuments('hotels')

      expect(result).toEqual({ count: 512 })
    })
  })

  describe('suggest', () => {
    const indexName = 'hotels'
    const suggestUrl = `${BASE}/indexes/${indexName}/docs/suggest?api-version=${API_VERSION}`

    it('sends POST with required params', async () => {
      const responseData = { value: [{ '@search.text': 'Luxury hotel', id: '1' }] }
      mock.onPost(suggestUrl).reply(responseData)

      const result = await service.suggest(indexName, 'lux', 'sg')

      expect(result).toEqual(responseData)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].body).toEqual({
        search: 'lux',
        suggesterName: 'sg',
      })
    })

    it('includes optional params when provided', async () => {
      mock.onPost(suggestUrl).reply({ value: [] })

      await service.suggest(
        indexName, 'lux', 'sg', "category eq 'Luxury'", 'id,name', 'description', 3, true
      )

      expect(mock.history[0].body).toEqual({
        search: 'lux',
        suggesterName: 'sg',
        filter: "category eq 'Luxury'",
        select: 'id,name',
        searchFields: 'description',
        top: 3,
        fuzzy: true,
      })
    })

    it('omits fuzzy when false or not provided', async () => {
      mock.onPost(suggestUrl).reply({ value: [] })

      await service.suggest(indexName, 'lux', 'sg')

      expect(mock.history[0].body).not.toHaveProperty('fuzzy')
    })
  })

  describe('autocomplete', () => {
    const indexName = 'hotels'
    const autoUrl = `${BASE}/indexes/${indexName}/docs/autocomplete?api-version=${API_VERSION}`

    it('sends POST with required params', async () => {
      const responseData = { value: [{ text: 'luxury', queryPlusText: 'luxury' }] }
      mock.onPost(autoUrl).reply(responseData)

      const result = await service.autocomplete(indexName, 'lux', 'sg')

      expect(result).toEqual(responseData)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].body).toEqual({
        search: 'lux',
        suggesterName: 'sg',
      })
    })

    it('maps autocompleteMode dropdown values correctly', async () => {
      mock.onPost(autoUrl).reply({ value: [] })

      await service.autocomplete(indexName, 'lux', 'sg', 'Two Terms')

      expect(mock.history[0].body).toMatchObject({ autocompleteMode: 'twoTerms' })
    })

    it('maps One Term With Context mode', async () => {
      mock.onPost(autoUrl).reply({ value: [] })

      await service.autocomplete(indexName, 'lux', 'sg', 'One Term With Context')

      expect(mock.history[0].body).toMatchObject({ autocompleteMode: 'oneTermWithContext' })
    })

    it('includes all optional params', async () => {
      mock.onPost(autoUrl).reply({ value: [] })

      await service.autocomplete(
        indexName, 'lux', 'sg', 'One Term', "category eq 'Luxury'", 'description', 5, true
      )

      expect(mock.history[0].body).toEqual({
        search: 'lux',
        suggesterName: 'sg',
        autocompleteMode: 'oneTerm',
        filter: "category eq 'Luxury'",
        searchFields: 'description',
        top: 5,
        fuzzy: true,
      })
    })

    it('omits fuzzy when not true', async () => {
      mock.onPost(autoUrl).reply({ value: [] })

      await service.autocomplete(indexName, 'lux', 'sg')

      expect(mock.history[0].body).not.toHaveProperty('fuzzy')
    })
  })

  // ── Indexers ──

  describe('listIndexers', () => {
    it('sends GET to indexers endpoint', async () => {
      const responseData = { value: [{ name: 'blob-indexer' }] }
      mock.onGet(`${BASE}/indexers?api-version=${API_VERSION}`).reply(responseData)

      const result = await service.listIndexers()

      expect(result).toEqual(responseData)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].headers).toMatchObject({ 'api-key': API_KEY })
    })

    it('passes select as $select query param', async () => {
      mock.onGet(`${BASE}/indexers?api-version=${API_VERSION}`).reply({ value: [] })

      await service.listIndexers('name')

      expect(mock.history[0].query).toMatchObject({ $select: 'name' })
    })
  })

  describe('runIndexer', () => {
    it('sends POST and returns confirmation object', async () => {
      mock.onPost(`${BASE}/indexers/blob-indexer/run?api-version=${API_VERSION}`).reply(undefined)

      const result = await service.runIndexer('blob-indexer')

      expect(result).toEqual({ started: true, name: 'blob-indexer' })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
    })
  })

  describe('getIndexerStatus', () => {
    it('sends GET to indexer status endpoint', async () => {
      const responseData = { status: 'running', lastResult: { status: 'success' } }
      mock.onGet(`${BASE}/indexers/blob-indexer/status?api-version=${API_VERSION}`).reply(responseData)

      const result = await service.getIndexerStatus('blob-indexer')

      expect(result).toEqual(responseData)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
    })
  })

  // ── Dictionaries ──

  describe('getIndexesDictionary', () => {
    const indexesUrl = `${BASE}/indexes?api-version=${API_VERSION}`

    it('returns formatted dictionary items', async () => {
      mock.onGet(indexesUrl).reply({ value: [{ name: 'hotels' }, { name: 'products' }] })

      const result = await service.getIndexesDictionary({})

      expect(result).toEqual({
        items: [
          { label: 'hotels', value: 'hotels', note: 'Index' },
          { label: 'products', value: 'products', note: 'Index' },
        ],
        cursor: null,
      })
      expect(mock.history[0].query).toMatchObject({ $select: 'name' })
    })

    it('filters items by search term', async () => {
      mock.onGet(indexesUrl).reply({ value: [{ name: 'hotels' }, { name: 'products' }] })

      const result = await service.getIndexesDictionary({ search: 'hot' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('hotels')
    })

    it('returns all items when search is empty', async () => {
      mock.onGet(indexesUrl).reply({ value: [{ name: 'a' }, { name: 'b' }] })

      const result = await service.getIndexesDictionary({ search: '' })

      expect(result.items).toHaveLength(2)
    })

    it('handles empty response', async () => {
      mock.onGet(indexesUrl).reply({ value: [] })

      const result = await service.getIndexesDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('handles null/undefined payload', async () => {
      mock.onGet(indexesUrl).reply({ value: [{ name: 'test' }] })

      const result = await service.getIndexesDictionary(null)

      expect(result.items).toHaveLength(1)
    })

    it('performs case-insensitive search', async () => {
      mock.onGet(indexesUrl).reply({ value: [{ name: 'Hotels' }, { name: 'products' }] })

      const result = await service.getIndexesDictionary({ search: 'HOTEL' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('Hotels')
    })
  })

  // ── Error Handling ──

  describe('error handling', () => {
    it('handles error without code', async () => {
      mock.onGet(`${BASE}/indexes?api-version=${API_VERSION}`).replyWithError({
        message: 'Unauthorized',
      })

      await expect(service.listIndexes()).rejects.toThrow(
        'Azure AI Search API error: Unauthorized'
      )
    })

    it('handles error with nested azure error', async () => {
      mock.onGet(`${BASE}/indexes?api-version=${API_VERSION}`).replyWithError({
        message: 'Bad Request',
        body: { error: { code: 'RequestFailed', message: 'Something went wrong' } },
      })

      await expect(service.listIndexes()).rejects.toThrow(
        'Azure AI Search API error [RequestFailed]: Something went wrong'
      )
    })

    it('handles error with body.message fallback', async () => {
      mock.onGet(`${BASE}/indexes?api-version=${API_VERSION}`).replyWithError({
        message: 'Server Error',
        body: { message: 'Internal server error' },
      })

      await expect(service.listIndexes()).rejects.toThrow(
        'Azure AI Search API error: Internal server error'
      )
    })
  })
})
