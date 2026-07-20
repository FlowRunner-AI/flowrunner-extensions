'use strict'

const { createSandbox } = require('../../../service-sandbox')

const SERVER_URL = 'https://es.example.com:9200'
const API_KEY = 'test-api-key'
const BASE = SERVER_URL

describe('Elasticsearch Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    // Pass a trailing slash to also exercise the trailing-slash stripping in the constructor.
    sandbox = createSandbox({ serverUrl: `${ SERVER_URL }/`, apiKey: API_KEY })
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
    it('registers with the correct config items in order', () => {
      expect(sandbox.getConfigItems()).toEqual([
        expect.objectContaining({ name: 'serverUrl', displayName: 'Server URL', required: true, shared: false, type: 'STRING' }),
        expect.objectContaining({ name: 'apiKey', displayName: 'API Key', required: false, shared: false, type: 'STRING' }),
        expect.objectContaining({ name: 'username', displayName: 'Username', required: false, shared: false, type: 'STRING' }),
        expect.objectContaining({ name: 'password', displayName: 'Password', required: false, shared: false, type: 'STRING' }),
      ])
    })

    it('strips the trailing slash from serverUrl', async () => {
      mock.onGet(`${ BASE }/`).reply({ version: { number: '8.13.0' } })

      await service.info()

      // No double slash before the root path.
      expect(mock.history[0].url).toBe(`${ BASE }/`)
    })

    it('sends the ApiKey Authorization header and JSON content type', async () => {
      mock.onGet(`${ BASE }/`).reply({ version: { number: '8.13.0' } })

      await service.info()

      expect(mock.history[0].headers).toMatchObject({
        'Authorization': `ApiKey ${ API_KEY }`,
        'Content-Type': 'application/json',
      })
    })
  })

  // ── Auth (Basic + none) ──
  //
  // The service module is required once (require() is cached), so we cannot spin
  // up extra sandboxes to test alternative credentials — a second require() would
  // not re-run addService(). Instead we instantiate the same service class with
  // different configs against the SAME request mock via service.constructor.

  describe('authentication headers', () => {
    it('uses HTTP Basic auth when only username/password are set', async () => {
      const basicService = new service.constructor({
        serverUrl: SERVER_URL,
        username: 'elastic',
        password: 'secret',
      })

      mock.onGet(`${ BASE }/`).reply({ ok: true })

      await basicService.info()

      const expected = `Basic ${ Buffer.from('elastic:secret').toString('base64') }`

      expect(mock.history[0].headers.Authorization).toBe(expected)
    })

    it('sends no Authorization header when no credentials are configured', async () => {
      const anonService = new service.constructor({ serverUrl: SERVER_URL })

      mock.onGet(`${ BASE }/`).reply({ ok: true })

      await anonService.info()

      expect(mock.history[0].headers.Authorization).toBeUndefined()
    })
  })

  // ── Documents ──

  describe('indexDocument', () => {
    it('POSTs to /{index}/_doc when no id is provided (default refresh)', async () => {
      mock.onPost(`${ BASE }/products/_doc`).reply({ _id: 'auto', result: 'created' })

      const result = await service.indexDocument('products', { name: 'Widget', price: 9.99 })

      expect(result).toEqual({ _id: 'auto', result: 'created' })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/products/_doc`)
      expect(mock.history[0].body).toEqual({ name: 'Widget', price: 9.99 })
      // undefined refresh is stripped from the query.
      expect(mock.history[0].query).toEqual({})
    })

    it('PUTs to /{index}/_doc/{id} when an id is provided and maps the refresh option', async () => {
      mock.onPut(`${ BASE }/products/_doc/1`).reply({ _id: '1', result: 'updated' })

      await service.indexDocument('products', { name: 'Widget' }, '1', 'Refresh Now')

      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].url).toBe(`${ BASE }/products/_doc/1`)
      expect(mock.history[0].body).toEqual({ name: 'Widget' })
      expect(mock.history[0].query).toEqual({ refresh: 'true' })
    })

    it('maps "Wait For Refresh" to wait_for', async () => {
      mock.onPut(`${ BASE }/products/_doc/1`).reply({ result: 'updated' })

      await service.indexDocument('products', { a: 1 }, '1', 'Wait For Refresh')

      expect(mock.history[0].query).toEqual({ refresh: 'wait_for' })
    })

    it('maps "No Refresh" to false and keeps it in the query', async () => {
      mock.onPut(`${ BASE }/products/_doc/1`).reply({ result: 'updated' })

      await service.indexDocument('products', { a: 1 }, '1', 'No Refresh')

      expect(mock.history[0].query).toEqual({ refresh: 'false' })
    })

    it('URL-encodes the index and id', async () => {
      mock.onPut(`${ BASE }/my%20index/_doc/a%2Fb`).reply({ result: 'created' })

      await service.indexDocument('my index', { a: 1 }, 'a/b')

      expect(mock.history[0].url).toBe(`${ BASE }/my%20index/_doc/a%2Fb`)
    })

    it('throws a wrapped error with status on API failure', async () => {
      mock.onPost(`${ BASE }/products/_doc`).replyWithError({
        message: 'Bad Request',
        body: { status: 400, error: { type: 'mapper_parsing_exception', reason: 'failed to parse' } },
      })

      await expect(service.indexDocument('products', { a: 1 })).rejects.toThrow(
        'Elasticsearch API error [400]: failed to parse'
      )
    })
  })

  describe('getDocument', () => {
    it('GETs /{index}/_doc/{id}', async () => {
      mock.onGet(`${ BASE }/products/_doc/1`).reply({ found: true, _source: { name: 'Widget' } })

      const result = await service.getDocument('products', '1')

      expect(result).toEqual({ found: true, _source: { name: 'Widget' } })
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/products/_doc/1`)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/products/_doc/999`).replyWithError({
        message: 'Not Found',
        body: { status: 404, error: { type: 'index_not_found_exception', reason: 'no such index' } },
      })

      await expect(service.getDocument('products', '999')).rejects.toThrow(
        'Elasticsearch API error [404]: no such index'
      )
    })
  })

  describe('updateDocument', () => {
    it('POSTs to /{index}/_update/{id} with a partial doc', async () => {
      mock.onPost(`${ BASE }/products/_update/1`).reply({ result: 'updated' })

      await service.updateDocument('products', '1', { price: 12.5 })

      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/products/_update/1`)
      expect(mock.history[0].body).toEqual({ doc: { price: 12.5 } })
      expect(mock.history[0].query).toEqual({})
    })

    it('includes script, upsert, and refresh when provided', async () => {
      mock.onPost(`${ BASE }/products/_update/1`).reply({ result: 'updated' })

      await service.updateDocument(
        'products',
        '1',
        undefined,
        { source: 'ctx._source.count += params.n', params: { n: 1 } },
        { count: 0 },
        'Refresh Now'
      )

      expect(mock.history[0].body).toEqual({
        script: { source: 'ctx._source.count += params.n', params: { n: 1 } },
        upsert: { count: 0 },
      })
      expect(mock.history[0].query).toEqual({ refresh: 'true' })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/products/_update/1`).replyWithError({ message: 'Boom' })

      await expect(service.updateDocument('products', '1', { a: 1 })).rejects.toThrow(
        'Elasticsearch API error: Boom'
      )
    })
  })

  describe('deleteDocument', () => {
    it('DELETEs /{index}/_doc/{id}', async () => {
      mock.onDelete(`${ BASE }/products/_doc/1`).reply({ result: 'deleted' })

      const result = await service.deleteDocument('products', '1')

      expect(result).toEqual({ result: 'deleted' })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${ BASE }/products/_doc/1`)
      expect(mock.history[0].query).toEqual({})
    })

    it('passes the mapped refresh option', async () => {
      mock.onDelete(`${ BASE }/products/_doc/1`).reply({ result: 'deleted' })

      await service.deleteDocument('products', '1', 'Refresh Now')

      expect(mock.history[0].query).toEqual({ refresh: 'true' })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onDelete(`${ BASE }/products/_doc/1`).replyWithError({ message: 'Boom' })

      await expect(service.deleteDocument('products', '1')).rejects.toThrow('Elasticsearch API error: Boom')
    })
  })

  describe('bulk', () => {
    it('builds NDJSON, sends x-ndjson content type, and hits /_bulk without a default index', async () => {
      mock.onPost(`${ BASE }/_bulk`).reply({ errors: false, items: [] })

      const result = await service.bulk(undefined, [
        { action: 'index', _index: 'products', _id: '1', source: { name: 'A' } },
        { action: 'create', _index: 'products', _id: '2', source: { name: 'B' } },
        { action: 'update', _index: 'products', _id: '3', doc: { name: 'C' } },
        { action: 'delete', _index: 'products', _id: '4' },
      ])

      expect(result).toEqual({ errors: false, items: [] })
      expect(mock.history[0].url).toBe(`${ BASE }/_bulk`)
      expect(mock.history[0].headers['Content-Type']).toBe('application/x-ndjson')

      const expectedNdjson =
        '{"index":{"_index":"products","_id":"1"}}\n' +
        '{"name":"A"}\n' +
        '{"create":{"_index":"products","_id":"2"}}\n' +
        '{"name":"B"}\n' +
        '{"update":{"_index":"products","_id":"3"}}\n' +
        '{"doc":{"name":"C"}}\n' +
        '{"delete":{"_index":"products","_id":"4"}}\n'

      expect(mock.history[0].body).toBe(expectedNdjson)
    })

    it('hits /{index}/_bulk when a default index is provided and maps refresh', async () => {
      mock.onPost(`${ BASE }/products/_bulk`).reply({ errors: false })

      await service.bulk('products', [{ action: 'delete', _id: '9' }], 'Refresh Now')

      expect(mock.history[0].url).toBe(`${ BASE }/products/_bulk`)
      expect(mock.history[0].query).toEqual({ refresh: 'true' })
      expect(mock.history[0].body).toBe('{"delete":{"_id":"9"}}\n')
    })

    it('defaults the source to an empty object for index/create ops without a source', async () => {
      mock.onPost(`${ BASE }/_bulk`).reply({ errors: false })

      await service.bulk(undefined, [{ action: 'index', _index: 'products', _id: '1' }])

      expect(mock.history[0].body).toBe('{"index":{"_index":"products","_id":"1"}}\n{}\n')
    })

    it('throws when operations is not a non-empty array', async () => {
      await expect(service.bulk('products', [])).rejects.toThrow(
        'Elasticsearch API error: Operations must be a non-empty array.'
      )
      await expect(service.bulk('products', null)).rejects.toThrow(
        'Elasticsearch API error: Operations must be a non-empty array.'
      )
      expect(mock.history).toHaveLength(0)
    })

    it('throws on an invalid bulk action', async () => {
      await expect(
        service.bulk('products', [{ action: 'upsert', _id: '1', source: {} }])
      ).rejects.toThrow('Elasticsearch API error: Invalid bulk action "upsert". Use index, create, update, or delete.')
      expect(mock.history).toHaveLength(0)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/_bulk`).replyWithError({ message: 'Boom' })

      await expect(
        service.bulk(undefined, [{ action: 'delete', _index: 'products', _id: '1' }])
      ).rejects.toThrow('Elasticsearch API error: Boom')
    })
  })

  // ── Search ──

  describe('search', () => {
    it('POSTs to /{index}/_search with a full body', async () => {
      mock.onPost(`${ BASE }/products/_search`).reply({ hits: { total: { value: 1 } } })

      const result = await service.search(
        'products',
        { match: { name: 'widget' } },
        20,
        10,
        [{ price: 'desc' }],
        { avg_price: { avg: { field: 'price' } } },
        ['name', 'price']
      )

      expect(result).toEqual({ hits: { total: { value: 1 } } })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/products/_search`)
      expect(mock.history[0].body).toEqual({
        query: { match: { name: 'widget' } },
        size: 20,
        from: 10,
        sort: [{ price: 'desc' }],
        aggs: { avg_price: { avg: { field: 'price' } } },
        _source: ['name', 'price'],
      })
    })

    it('sends an empty body when no arguments are provided', async () => {
      mock.onPost(`${ BASE }/products/_search`).reply({ hits: { hits: [] } })

      await service.search('products')

      expect(mock.history[0].body).toEqual({})
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/products/_search`).replyWithError({ message: 'Boom' })

      await expect(service.search('products')).rejects.toThrow('Elasticsearch API error: Boom')
    })
  })

  describe('count', () => {
    it('POSTs to /{index}/_count with a query', async () => {
      mock.onPost(`${ BASE }/products/_count`).reply({ count: 42 })

      const result = await service.count('products', { match_all: {} })

      expect(result).toEqual({ count: 42 })
      expect(mock.history[0].url).toBe(`${ BASE }/products/_count`)
      expect(mock.history[0].body).toEqual({ query: { match_all: {} } })
    })

    it('sends an empty body when no query is provided', async () => {
      mock.onPost(`${ BASE }/products/_count`).reply({ count: 100 })

      await service.count('products')

      expect(mock.history[0].body).toEqual({})
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/products/_count`).replyWithError({ message: 'Boom' })

      await expect(service.count('products')).rejects.toThrow('Elasticsearch API error: Boom')
    })
  })

  // ── Query By ──

  describe('deleteByQuery', () => {
    it('POSTs to /{index}/_delete_by_query with a query', async () => {
      mock.onPost(`${ BASE }/products/_delete_by_query`).reply({ deleted: 3 })

      const result = await service.deleteByQuery('products', { match: { status: 'archived' } })

      expect(result).toEqual({ deleted: 3 })
      expect(mock.history[0].url).toBe(`${ BASE }/products/_delete_by_query`)
      expect(mock.history[0].body).toEqual({ query: { match: { status: 'archived' } } })
      expect(mock.history[0].query).toEqual({})
    })

    it('includes max_docs and the mapped refresh option', async () => {
      mock.onPost(`${ BASE }/products/_delete_by_query`).reply({ deleted: 1 })

      await service.deleteByQuery('products', { match_all: {} }, 1, 'Refresh Now')

      expect(mock.history[0].body).toEqual({ query: { match_all: {} }, max_docs: 1 })
      expect(mock.history[0].query).toEqual({ refresh: 'true' })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/products/_delete_by_query`).replyWithError({ message: 'Boom' })

      await expect(service.deleteByQuery('products', { match_all: {} })).rejects.toThrow(
        'Elasticsearch API error: Boom'
      )
    })
  })

  describe('updateByQuery', () => {
    it('POSTs to /{index}/_update_by_query with query and script', async () => {
      mock.onPost(`${ BASE }/products/_update_by_query`).reply({ updated: 5 })

      const result = await service.updateByQuery(
        'products',
        { term: { active: true } },
        { source: 'ctx._source.count++', lang: 'painless' },
        10,
        'Refresh Now'
      )

      expect(result).toEqual({ updated: 5 })
      expect(mock.history[0].url).toBe(`${ BASE }/products/_update_by_query`)
      expect(mock.history[0].body).toEqual({
        query: { term: { active: true } },
        script: { source: 'ctx._source.count++', lang: 'painless' },
        max_docs: 10,
      })
      expect(mock.history[0].query).toEqual({ refresh: 'true' })
    })

    it('sends an empty body when no query or script is provided', async () => {
      mock.onPost(`${ BASE }/products/_update_by_query`).reply({ updated: 0 })

      await service.updateByQuery('products')

      expect(mock.history[0].body).toEqual({})
      expect(mock.history[0].query).toEqual({})
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/products/_update_by_query`).replyWithError({ message: 'Boom' })

      await expect(service.updateByQuery('products')).rejects.toThrow('Elasticsearch API error: Boom')
    })
  })

  // ── Indices ──

  describe('createIndex', () => {
    it('PUTs /{index} with no body when settings/mappings are omitted', async () => {
      mock.onPut(`${ BASE }/products`).reply({ acknowledged: true, index: 'products' })

      const result = await service.createIndex('products')

      expect(result).toEqual({ acknowledged: true, index: 'products' })
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].url).toBe(`${ BASE }/products`)
      expect(mock.history[0].body).toBeUndefined()
    })

    it('includes settings and mappings when provided', async () => {
      mock.onPut(`${ BASE }/products`).reply({ acknowledged: true })

      await service.createIndex(
        'products',
        { number_of_shards: 1, number_of_replicas: 1 },
        { properties: { name: { type: 'text' } } }
      )

      expect(mock.history[0].body).toEqual({
        settings: { number_of_shards: 1, number_of_replicas: 1 },
        mappings: { properties: { name: { type: 'text' } } },
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPut(`${ BASE }/products`).replyWithError({
        message: 'Bad Request',
        body: { status: 400, error: { type: 'resource_already_exists_exception', reason: 'already exists' } },
      })

      await expect(service.createIndex('products')).rejects.toThrow(
        'Elasticsearch API error [400]: already exists'
      )
    })
  })

  describe('deleteIndex', () => {
    it('DELETEs /{index}', async () => {
      mock.onDelete(`${ BASE }/products`).reply({ acknowledged: true })

      const result = await service.deleteIndex('products')

      expect(result).toEqual({ acknowledged: true })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${ BASE }/products`)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onDelete(`${ BASE }/products`).replyWithError({ message: 'Boom' })

      await expect(service.deleteIndex('products')).rejects.toThrow('Elasticsearch API error: Boom')
    })
  })

  describe('indexExists', () => {
    // NOTE: indexExists issues a HEAD request. The service sandbox (both the mock
    // and the real request layer) only implements get/post/put/patch/delete, so
    // HEAD is unsupported here. In the sandbox the call therefore rejects; against
    // a real Flowrunner runtime (which supports HEAD) it resolves to {exists:...}.
    it('rejects in the sandbox because HEAD is not implemented by the request layer', async () => {
      await expect(service.indexExists('products')).rejects.toThrow()
      // No HTTP call is recorded because the request builder throws before .then().
      expect(mock.history).toHaveLength(0)
    })
  })

  describe('getMapping', () => {
    it('GETs /{index}/_mapping', async () => {
      mock.onGet(`${ BASE }/products/_mapping`).reply({ products: { mappings: {} } })

      const result = await service.getMapping('products')

      expect(result).toEqual({ products: { mappings: {} } })
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/products/_mapping`)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/products/_mapping`).replyWithError({ message: 'Boom' })

      await expect(service.getMapping('products')).rejects.toThrow('Elasticsearch API error: Boom')
    })
  })

  describe('getIndex', () => {
    it('GETs /{index}', async () => {
      mock.onGet(`${ BASE }/products`).reply({ products: { aliases: {}, mappings: {}, settings: {} } })

      const result = await service.getIndex('products')

      expect(result).toEqual({ products: { aliases: {}, mappings: {}, settings: {} } })
      expect(mock.history[0].url).toBe(`${ BASE }/products`)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/products`).replyWithError({ message: 'Boom' })

      await expect(service.getIndex('products')).rejects.toThrow('Elasticsearch API error: Boom')
    })
  })

  describe('refreshIndex', () => {
    it('POSTs /{index}/_refresh', async () => {
      mock.onPost(`${ BASE }/products/_refresh`).reply({ _shards: { total: 2, successful: 1, failed: 0 } })

      const result = await service.refreshIndex('products')

      expect(result).toEqual({ _shards: { total: 2, successful: 1, failed: 0 } })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/products/_refresh`)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/products/_refresh`).replyWithError({ message: 'Boom' })

      await expect(service.refreshIndex('products')).rejects.toThrow('Elasticsearch API error: Boom')
    })
  })

  describe('listIndices', () => {
    it('GETs /_cat/indices with the json format query', async () => {
      mock.onGet(`${ BASE }/_cat/indices`).reply([{ index: 'products', health: 'green' }])

      const result = await service.listIndices()

      expect(result).toEqual([{ index: 'products', health: 'green' }])
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/_cat/indices`)
      expect(mock.history[0].query).toEqual({ format: 'json' })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/_cat/indices`).replyWithError({ message: 'Boom' })

      await expect(service.listIndices()).rejects.toThrow('Elasticsearch API error: Boom')
    })
  })

  // ── Cluster ──

  describe('clusterHealth', () => {
    it('GETs /_cluster/health', async () => {
      mock.onGet(`${ BASE }/_cluster/health`).reply({ status: 'green' })

      const result = await service.clusterHealth()

      expect(result).toEqual({ status: 'green' })
      expect(mock.history[0].url).toBe(`${ BASE }/_cluster/health`)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/_cluster/health`).replyWithError({ message: 'Boom' })

      await expect(service.clusterHealth()).rejects.toThrow('Elasticsearch API error: Boom')
    })
  })

  describe('info', () => {
    it('GETs the root endpoint', async () => {
      mock.onGet(`${ BASE }/`).reply({ version: { number: '8.13.0' }, tagline: 'You Know, for Search' })

      const result = await service.info()

      expect(result).toEqual({ version: { number: '8.13.0' }, tagline: 'You Know, for Search' })
      expect(mock.history[0].url).toBe(`${ BASE }/`)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/`).replyWithError({ message: 'Boom' })

      await expect(service.info()).rejects.toThrow('Elasticsearch API error: Boom')
    })
  })

  // ── Dictionary ──

  describe('getIndicesDictionary', () => {
    const rows = [
      { index: 'products', status: 'open', health: 'green', 'docs.count': '42' },
      { index: '.kibana', status: 'open', health: 'green', 'docs.count': '1' },
      { index: 'orders', status: 'open', health: 'yellow', 'docs.count': '3' },
    ]

    it('requests _cat/indices with the expected query params', async () => {
      mock.onGet(`${ BASE }/_cat/indices`).reply(rows)

      await service.getIndicesDictionary({})

      expect(mock.history[0].query).toEqual({
        format: 'json',
        h: 'index,status,health,docs.count',
        s: 'index:asc',
      })
    })

    it('maps rows to items, sorts user indices before system indices, and returns a null cursor', async () => {
      mock.onGet(`${ BASE }/_cat/indices`).reply(rows)

      const result = await service.getIndicesDictionary({})

      expect(result.cursor).toBeNull()
      expect(result.items).toEqual([
        { label: 'orders', value: 'orders', note: 'open - yellow - 3 docs' },
        { label: 'products', value: 'products', note: 'open - green - 42 docs' },
        { label: '.kibana', value: '.kibana', note: 'open - green - 1 docs' },
      ])
    })

    it('filters by a case-insensitive search substring', async () => {
      mock.onGet(`${ BASE }/_cat/indices`).reply(rows)

      const result = await service.getIndicesDictionary({ search: 'ORDER' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('orders')
    })

    it('handles a null payload', async () => {
      mock.onGet(`${ BASE }/_cat/indices`).reply(rows)

      const result = await service.getIndicesDictionary(null)

      expect(result.items).toHaveLength(3)
    })

    it('handles a non-array response by returning no items', async () => {
      mock.onGet(`${ BASE }/_cat/indices`).reply({ error: 'not an array' })

      const result = await service.getIndicesDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('omits the note when there is no status/health/docs info', async () => {
      mock.onGet(`${ BASE }/_cat/indices`).reply([{ index: 'bare' }])

      const result = await service.getIndicesDictionary({})

      expect(result.items).toEqual([{ label: 'bare', value: 'bare', note: undefined }])
    })

    it('propagates a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/_cat/indices`).replyWithError({ message: 'Boom' })

      await expect(service.getIndicesDictionary({})).rejects.toThrow('Elasticsearch API error: Boom')
    })
  })
})
