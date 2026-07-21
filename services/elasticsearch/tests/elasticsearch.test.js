'use strict'

const { createSandbox } = require('../../../service-sandbox')

const SERVER_URL = 'https://my-es-cluster.example.com:9200'
const API_KEY = 'test-api-key-abc123'

describe('Elasticsearch Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ serverUrl: SERVER_URL, apiKey: API_KEY })
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

      expect(configs).toEqual([
        expect.objectContaining({ name: 'serverUrl', required: true, shared: false, type: 'STRING' }),
        expect.objectContaining({ name: 'apiKey', required: false, shared: false, type: 'STRING' }),
        expect.objectContaining({ name: 'username', required: false, shared: false, type: 'STRING' }),
        expect.objectContaining({ name: 'password', required: false, shared: false, type: 'STRING' }),
      ])
    })
  })

  // ── Auth headers ──

  describe('authentication', () => {
    it('sends ApiKey authorization header when apiKey is configured', async () => {
      mock.onGet(`${ SERVER_URL }/`).reply({ name: 'node-1' })

      await service.info()

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({
        'Authorization': `ApiKey ${ API_KEY }`,
        'Content-Type': 'application/json',
      })
    })
  })

  // ── Documents ──

  describe('indexDocument', () => {
    it('sends POST without id (auto-generate)', async () => {
      mock.onPost(`${ SERVER_URL }/products/_doc`).reply({
        _index: 'products', _id: 'auto-1', result: 'created',
      })

      const result = await service.indexDocument('products', { name: 'Widget' })

      expect(result).toMatchObject({ _index: 'products', result: 'created' })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({ name: 'Widget' })
    })

    it('sends PUT with id when provided', async () => {
      mock.onPut(`${ SERVER_URL }/products/_doc/123`).reply({
        _index: 'products', _id: '123', result: 'created',
      })

      await service.indexDocument('products', { name: 'Widget' }, '123')

      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].url).toBe(`${ SERVER_URL }/products/_doc/123`)
    })

    it('sends refresh query parameter when provided', async () => {
      mock.onPost(`${ SERVER_URL }/products/_doc`).reply({ result: 'created' })

      await service.indexDocument('products', { name: 'W' }, undefined, 'Refresh Now')

      expect(mock.history[0].query).toMatchObject({ refresh: 'true' })
    })

    it('maps Wait For Refresh correctly', async () => {
      mock.onPut(`${ SERVER_URL }/products/_doc/1`).reply({ result: 'created' })

      await service.indexDocument('products', { name: 'W' }, '1', 'Wait For Refresh')

      expect(mock.history[0].query).toMatchObject({ refresh: 'wait_for' })
    })

    it('maps No Refresh correctly', async () => {
      mock.onPost(`${ SERVER_URL }/products/_doc`).reply({ result: 'created' })

      await service.indexDocument('products', { name: 'W' }, undefined, 'No Refresh')

      expect(mock.history[0].query).toMatchObject({ refresh: 'false' })
    })

    it('throws on API error', async () => {
      mock.onPost(`${ SERVER_URL }/products/_doc`).replyWithError({
        message: 'Bad Request',
        body: { status: 400, error: { reason: 'mapper_parsing_exception', type: 'mapper_parsing_exception' } },
      })

      await expect(service.indexDocument('products', {})).rejects.toThrow('Elasticsearch API error')
    })
  })

  describe('getDocument', () => {
    it('sends GET request with correct URL', async () => {
      mock.onGet(`${ SERVER_URL }/products/_doc/1`).reply({
        _index: 'products', _id: '1', found: true, _source: { name: 'Widget' },
      })

      const result = await service.getDocument('products', '1')

      expect(result).toMatchObject({ found: true, _source: { name: 'Widget' } })
      expect(mock.history[0].method).toBe('get')
    })

    it('throws when document not found', async () => {
      mock.onGet(`${ SERVER_URL }/products/_doc/999`).replyWithError({
        message: 'Not Found',
        body: { status: 404, error: { reason: 'not found', type: 'resource_not_found_exception' } },
      })

      await expect(service.getDocument('products', '999')).rejects.toThrow('Elasticsearch API error')
    })
  })

  describe('updateDocument', () => {
    it('sends POST with partial doc', async () => {
      mock.onPost(`${ SERVER_URL }/products/_update/1`).reply({
        _id: '1', result: 'updated',
      })

      await service.updateDocument('products', '1', { price: 19.99 })

      expect(mock.history[0].body).toMatchObject({ doc: { price: 19.99 } })
    })

    it('sends POST with script', async () => {
      mock.onPost(`${ SERVER_URL }/products/_update/1`).reply({ result: 'updated' })

      const script = { source: 'ctx._source.count += params.n', params: { n: 1 } }

      await service.updateDocument('products', '1', undefined, script)

      expect(mock.history[0].body).toMatchObject({ script })
    })

    it('sends POST with upsert', async () => {
      mock.onPost(`${ SERVER_URL }/products/_update/1`).reply({ result: 'updated' })

      await service.updateDocument('products', '1', { price: 10 }, undefined, { name: 'New', price: 10 })

      expect(mock.history[0].body).toMatchObject({
        doc: { price: 10 },
        upsert: { name: 'New', price: 10 },
      })
    })

    it('sends refresh query parameter', async () => {
      mock.onPost(`${ SERVER_URL }/products/_update/1`).reply({ result: 'updated' })

      await service.updateDocument('products', '1', { price: 5 }, undefined, undefined, 'Refresh Now')

      expect(mock.history[0].query).toMatchObject({ refresh: 'true' })
    })
  })

  describe('deleteDocument', () => {
    it('sends DELETE request with correct URL', async () => {
      mock.onDelete(`${ SERVER_URL }/products/_doc/1`).reply({
        _id: '1', result: 'deleted',
      })

      const result = await service.deleteDocument('products', '1')

      expect(result).toMatchObject({ result: 'deleted' })
      expect(mock.history[0].method).toBe('delete')
    })

    it('sends refresh query parameter', async () => {
      mock.onDelete(`${ SERVER_URL }/products/_doc/1`).reply({ result: 'deleted' })

      await service.deleteDocument('products', '1', 'Wait For Refresh')

      expect(mock.history[0].query).toMatchObject({ refresh: 'wait_for' })
    })
  })

  describe('bulk', () => {
    it('sends NDJSON with index and create operations', async () => {
      mock.onPost(`${ SERVER_URL }/_bulk`).reply({ took: 30, errors: false, items: [] })

      const operations = [
        { action: 'index', _index: 'products', _id: '1', source: { name: 'Widget' } },
        { action: 'create', _index: 'products', _id: '2', source: { name: 'Gadget' } },
      ]

      await service.bulk(undefined, operations)

      expect(mock.history[0].url).toBe(`${ SERVER_URL }/_bulk`)
      expect(mock.history[0].headers).toMatchObject({
        'Content-Type': 'application/x-ndjson',
      })

      const expectedNdjson =
        '{"index":{"_index":"products","_id":"1"}}\n' +
        '{"name":"Widget"}\n' +
        '{"create":{"_index":"products","_id":"2"}}\n' +
        '{"name":"Gadget"}\n'

      expect(mock.history[0].body).toBe(expectedNdjson)
    })

    it('sends NDJSON with delete operation (no source line)', async () => {
      mock.onPost(`${ SERVER_URL }/_bulk`).reply({ took: 5, errors: false, items: [] })

      const operations = [
        { action: 'delete', _index: 'products', _id: '3' },
      ]

      await service.bulk(undefined, operations)

      const expectedNdjson = '{"delete":{"_index":"products","_id":"3"}}\n'

      expect(mock.history[0].body).toBe(expectedNdjson)
    })

    it('sends NDJSON with update operation using doc', async () => {
      mock.onPost(`${ SERVER_URL }/_bulk`).reply({ took: 5, errors: false, items: [] })

      const operations = [
        { action: 'update', _index: 'products', _id: '1', doc: { price: 20 } },
      ]

      await service.bulk(undefined, operations)

      const expectedNdjson =
        '{"update":{"_index":"products","_id":"1"}}\n' +
        '{"doc":{"price":20}}\n'

      expect(mock.history[0].body).toBe(expectedNdjson)
    })

    it('uses default index in URL when provided', async () => {
      mock.onPost(`${ SERVER_URL }/products/_bulk`).reply({ took: 5, errors: false, items: [] })

      await service.bulk('products', [
        { action: 'index', _id: '1', source: { name: 'W' } },
      ])

      expect(mock.history[0].url).toBe(`${ SERVER_URL }/products/_bulk`)
    })

    it('sends refresh query parameter', async () => {
      mock.onPost(`${ SERVER_URL }/_bulk`).reply({ took: 5, errors: false, items: [] })

      await service.bulk(undefined, [
        { action: 'index', _index: 'x', source: {} },
      ], 'Refresh Now')

      expect(mock.history[0].query).toMatchObject({ refresh: 'true' })
    })

    it('throws for empty operations array', async () => {
      await expect(service.bulk(undefined, [])).rejects.toThrow('Operations must be a non-empty array')
    })

    it('throws for invalid action', async () => {
      await expect(service.bulk(undefined, [
        { action: 'upsert', _index: 'x', source: {} },
      ])).rejects.toThrow('Invalid bulk action "upsert"')
    })

    it('throws for non-array operations', async () => {
      await expect(service.bulk(undefined, 'notAnArray')).rejects.toThrow('Operations must be a non-empty array')
    })
  })

  // ── Search ──

  describe('search', () => {
    it('sends POST with query body', async () => {
      mock.onPost(`${ SERVER_URL }/products/_search`).reply({
        hits: { total: { value: 1 }, hits: [{ _id: '1', _source: { name: 'Widget' } }] },
      })

      const query = { match: { name: 'Widget' } }
      const result = await service.search('products', query)

      expect(result.hits.total.value).toBe(1)
      expect(mock.history[0].body).toMatchObject({ query })
    })

    it('sends size and from for pagination', async () => {
      mock.onPost(`${ SERVER_URL }/products/_search`).reply({ hits: { hits: [] } })

      await service.search('products', undefined, 20, 40)

      expect(mock.history[0].body).toMatchObject({ size: 20, from: 40 })
    })

    it('sends sort, aggs, and source filter', async () => {
      mock.onPost(`${ SERVER_URL }/products/_search`).reply({ hits: { hits: [] } })

      const sort = [{ price: 'desc' }]
      const aggs = { avg_price: { avg: { field: 'price' } } }
      const source = { includes: ['name'] }

      await service.search('products', undefined, undefined, undefined, sort, aggs, source)

      expect(mock.history[0].body).toMatchObject({
        sort,
        aggs,
        _source: source,
      })
    })

    it('sends body without optional fields when not provided', async () => {
      mock.onPost(`${ SERVER_URL }/products/_search`).reply({ hits: { hits: [] } })

      await service.search('products')

      // clean() strips undefined values but returns {} which is sent as body
      const body = mock.history[0].body

      expect(body).toBeDefined()
      expect(body).not.toHaveProperty('query')
      expect(body).not.toHaveProperty('size')
      expect(body).not.toHaveProperty('from')
      expect(body).not.toHaveProperty('sort')
      expect(body).not.toHaveProperty('aggs')
      expect(body).not.toHaveProperty('_source')
    })
  })

  describe('count', () => {
    it('sends POST with query', async () => {
      mock.onPost(`${ SERVER_URL }/products/_count`).reply({ count: 42 })

      const result = await service.count('products', { match_all: {} })

      expect(result).toEqual({ count: 42 })
      expect(mock.history[0].body).toMatchObject({ query: { match_all: {} } })
    })

    it('sends body without query when not provided', async () => {
      mock.onPost(`${ SERVER_URL }/products/_count`).reply({ count: 100 })

      const result = await service.count('products')

      expect(result).toEqual({ count: 100 })
      expect(mock.history[0].body).not.toHaveProperty('query')
    })
  })

  // ── Query By ──

  describe('deleteByQuery', () => {
    it('sends POST with query body', async () => {
      mock.onPost(`${ SERVER_URL }/products/_delete_by_query`).reply({
        deleted: 3, total: 3,
      })

      const query = { match: { status: 'archived' } }
      const result = await service.deleteByQuery('products', query)

      expect(result).toMatchObject({ deleted: 3 })
      expect(mock.history[0].body).toMatchObject({ query })
    })

    it('includes max_docs when provided', async () => {
      mock.onPost(`${ SERVER_URL }/products/_delete_by_query`).reply({ deleted: 5 })

      await service.deleteByQuery('products', { match_all: {} }, 5)

      expect(mock.history[0].body).toMatchObject({ query: { match_all: {} }, max_docs: 5 })
    })

    it('sends refresh query parameter', async () => {
      mock.onPost(`${ SERVER_URL }/products/_delete_by_query`).reply({ deleted: 1 })

      await service.deleteByQuery('products', { match_all: {} }, undefined, 'Refresh Now')

      expect(mock.history[0].query).toMatchObject({ refresh: 'true' })
    })
  })

  describe('updateByQuery', () => {
    it('sends POST with query and script', async () => {
      mock.onPost(`${ SERVER_URL }/products/_update_by_query`).reply({
        updated: 5, total: 5,
      })

      const query = { match_all: {} }
      const script = { source: 'ctx._source.count++', lang: 'painless' }

      await service.updateByQuery('products', query, script)

      expect(mock.history[0].body).toMatchObject({ query, script })
    })

    it('includes max_docs when provided', async () => {
      mock.onPost(`${ SERVER_URL }/products/_update_by_query`).reply({ updated: 10 })

      await service.updateByQuery('products', { match_all: {} }, undefined, 10)

      expect(mock.history[0].body).toMatchObject({ query: { match_all: {} }, max_docs: 10 })
    })

    it('sends refresh query parameter', async () => {
      mock.onPost(`${ SERVER_URL }/products/_update_by_query`).reply({ updated: 1 })

      await service.updateByQuery('products', { match_all: {} }, undefined, undefined, 'Refresh Now')

      expect(mock.history[0].query).toMatchObject({ refresh: 'true' })
    })
  })

  // ── Indices ──

  describe('createIndex', () => {
    it('sends PUT with index name', async () => {
      mock.onPut(`${ SERVER_URL }/products`).reply({
        acknowledged: true, index: 'products',
      })

      const result = await service.createIndex('products')

      expect(result).toMatchObject({ acknowledged: true })
      expect(mock.history[0].method).toBe('put')
    })

    it('sends settings and mappings when provided', async () => {
      mock.onPut(`${ SERVER_URL }/products`).reply({ acknowledged: true })

      const settings = { number_of_shards: 1 }
      const mappings = { properties: { name: { type: 'text' } } }

      await service.createIndex('products', settings, mappings)

      expect(mock.history[0].body).toEqual({ settings, mappings })
    })

    it('sends no body when no settings or mappings', async () => {
      mock.onPut(`${ SERVER_URL }/my-index`).reply({ acknowledged: true })

      await service.createIndex('my-index')

      expect(mock.history[0].body).toBeUndefined()
    })
  })

  describe('deleteIndex', () => {
    it('sends DELETE request', async () => {
      mock.onDelete(`${ SERVER_URL }/products`).reply({ acknowledged: true })

      const result = await service.deleteIndex('products')

      expect(result).toEqual({ acknowledged: true })
      expect(mock.history[0].method).toBe('delete')
    })
  })

  describe('indexExists', () => {
    it('returns exists true when HEAD succeeds', async () => {
      mock.onHead(`${ SERVER_URL }/products`).reply('')

      const result = await service.indexExists('products')

      expect(result).toEqual({ exists: true })
    })

    it('returns exists false when HEAD returns 404', async () => {
      mock.onHead(`${ SERVER_URL }/nonexistent`).replyWithError({
        message: 'Elasticsearch API error [404]: not found',
        status: 404,
      })

      const result = await service.indexExists('nonexistent')

      expect(result).toEqual({ exists: false })
    })

    it('throws on non-404 errors', async () => {
      mock.onHead(`${ SERVER_URL }/products`).replyWithError({
        message: 'Unauthorized',
        status: 401,
        body: { status: 401, error: { reason: 'security_exception' } },
      })

      await expect(service.indexExists('products')).rejects.toThrow()
    })
  })

  describe('getMapping', () => {
    it('sends GET request to _mapping endpoint', async () => {
      const mappingResp = { products: { mappings: { properties: { name: { type: 'text' } } } } }

      mock.onGet(`${ SERVER_URL }/products/_mapping`).reply(mappingResp)

      const result = await service.getMapping('products')

      expect(result).toEqual(mappingResp)
      expect(mock.history[0].method).toBe('get')
    })
  })

  describe('getIndex', () => {
    it('sends GET request for full index info', async () => {
      const indexInfo = {
        products: { aliases: {}, mappings: {}, settings: {} },
      }

      mock.onGet(`${ SERVER_URL }/products`).reply(indexInfo)

      const result = await service.getIndex('products')

      expect(result).toEqual(indexInfo)
    })
  })

  describe('refreshIndex', () => {
    it('sends POST to _refresh endpoint', async () => {
      mock.onPost(`${ SERVER_URL }/products/_refresh`).reply({
        _shards: { total: 2, successful: 1, failed: 0 },
      })

      const result = await service.refreshIndex('products')

      expect(result).toMatchObject({ _shards: { successful: 1 } })
      expect(mock.history[0].method).toBe('post')
    })
  })

  describe('listIndices', () => {
    it('sends GET to _cat/indices with format=json', async () => {
      const indices = [
        { index: 'products', health: 'green', status: 'open', 'docs.count': '42' },
      ]

      mock.onGet(`${ SERVER_URL }/_cat/indices`).reply(indices)

      const result = await service.listIndices()

      expect(result).toEqual(indices)
      expect(mock.history[0].query).toMatchObject({ format: 'json' })
    })
  })

  // ── Cluster ──

  describe('clusterHealth', () => {
    it('sends GET to _cluster/health', async () => {
      const health = { cluster_name: 'test', status: 'green', number_of_nodes: 1 }

      mock.onGet(`${ SERVER_URL }/_cluster/health`).reply(health)

      const result = await service.clusterHealth()

      expect(result).toEqual(health)
    })
  })

  describe('info', () => {
    it('sends GET to root endpoint', async () => {
      const infoResp = { name: 'node-1', cluster_name: 'test', version: { number: '8.13.0' } }

      mock.onGet(`${ SERVER_URL }/`).reply(infoResp)

      const result = await service.info()

      expect(result).toEqual(infoResp)
      expect(mock.history[0].url).toBe(`${ SERVER_URL }/`)
    })
  })

  // ── Dictionaries ──

  describe('getIndicesDictionary', () => {
    const catUrl = `${ SERVER_URL }/_cat/indices`

    it('returns formatted index list', async () => {
      mock.onGet(catUrl).reply([
        { index: 'products', status: 'open', health: 'green', 'docs.count': '42' },
        { index: 'orders', status: 'open', health: 'yellow', 'docs.count': '10' },
      ])

      const result = await service.getIndicesDictionary({})

      expect(result.items).toHaveLength(2)
      expect(result.cursor).toBeNull()
      expect(result.items[0]).toEqual({
        label: 'orders',
        value: 'orders',
        note: 'open - yellow - 10 docs',
      })
      expect(result.items[1]).toEqual({
        label: 'products',
        value: 'products',
        note: 'open - green - 42 docs',
      })
    })

    it('filters indices by search term', async () => {
      mock.onGet(catUrl).reply([
        { index: 'products', status: 'open', health: 'green', 'docs.count': '42' },
        { index: 'orders', status: 'open', health: 'yellow', 'docs.count': '10' },
      ])

      const result = await service.getIndicesDictionary({ search: 'prod' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('products')
    })

    it('sorts system indices after user indices', async () => {
      mock.onGet(catUrl).reply([
        { index: '.internal', status: 'open', health: 'green' },
        { index: 'alpha', status: 'open', health: 'green' },
        { index: '.system', status: 'open', health: 'green' },
        { index: 'beta', status: 'open', health: 'green' },
      ])

      const result = await service.getIndicesDictionary({})
      const names = result.items.map(i => i.value)

      expect(names).toEqual(['alpha', 'beta', '.internal', '.system'])
    })

    it('handles empty response', async () => {
      mock.onGet(catUrl).reply([])

      const result = await service.getIndicesDictionary({})

      expect(result.items).toEqual([])
      expect(result.cursor).toBeNull()
    })

    it('handles null payload', async () => {
      mock.onGet(catUrl).reply([
        { index: 'test', status: 'open', health: 'green' },
      ])

      const result = await service.getIndicesDictionary(null)

      expect(result.items).toHaveLength(1)
    })

    it('sends correct query parameters', async () => {
      mock.onGet(catUrl).reply([])

      await service.getIndicesDictionary({})

      expect(mock.history[0].query).toMatchObject({
        format: 'json',
        h: 'index,status,health,docs.count',
        s: 'index:asc',
      })
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('extracts ES error reason from response body', async () => {
      mock.onGet(`${ SERVER_URL }/bad/_doc/1`).replyWithError({
        message: 'Not Found',
        body: { status: 404, error: { reason: 'no such index [bad]', type: 'index_not_found_exception' } },
      })

      await expect(service.getDocument('bad', '1')).rejects.toThrow('no such index [bad]')
    })

    it('extracts message from error body when no ES error object', async () => {
      mock.onGet(`${ SERVER_URL }/`).replyWithError({
        message: 'Connection refused',
        body: { message: 'Connection refused' },
      })

      await expect(service.info()).rejects.toThrow('Connection refused')
    })

    it('includes status code in error message', async () => {
      mock.onGet(`${ SERVER_URL }/bad/_doc/1`).replyWithError({
        message: 'Forbidden',
        body: { status: 403, error: { reason: 'action not allowed' } },
      })

      await expect(service.getDocument('bad', '1')).rejects.toThrow('[403]')
    })
  })

  // ── URL encoding ──

  describe('URL encoding', () => {
    it('encodes special characters in index name', async () => {
      mock.onGet(`${ SERVER_URL }/my%20index/_doc/1`).reply({ found: true, _source: {} })

      await service.getDocument('my index', '1')

      expect(mock.history[0].url).toBe(`${ SERVER_URL }/my%20index/_doc/1`)
    })

    it('encodes special characters in document id', async () => {
      mock.onGet(`${ SERVER_URL }/products/_doc/id%2F1`).reply({ found: true, _source: {} })

      await service.getDocument('products', 'id/1')

      expect(mock.history[0].url).toBe(`${ SERVER_URL }/products/_doc/id%2F1`)
    })
  })
})
