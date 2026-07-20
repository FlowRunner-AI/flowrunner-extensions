'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-chroma-token'
const BASE_URL = 'https://api.trychroma.com'
const TENANT = 'test_tenant'
const DATABASE = 'test_database'

// Path Chroma builds for all collection endpoints within the tenant/database.
const COLLECTIONS = `${ BASE_URL }/api/v2/tenants/${ TENANT }/databases/${ DATABASE }/collections`

// A value that matches the service's UUID regex, so the name->id lookup is skipped.
const COLLECTION_UUID = '1f8e1b2c-4a3d-4e5f-9a0b-1c2d3e4f5a6b'

describe('Chroma Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({
      baseUrl: BASE_URL,
      apiKey: API_KEY,
      tenant: TENANT,
      database: DATABASE,
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
      expect(sandbox.getConfigItems()).toEqual([
        expect.objectContaining({ name: 'baseUrl', required: true, shared: false, type: 'STRING' }),
        expect.objectContaining({ name: 'apiKey', required: false, shared: false, type: 'STRING' }),
        expect.objectContaining({
          name: 'tenant',
          required: false,
          shared: false,
          type: 'STRING',
          defaultValue: 'default_tenant',
        }),
        expect.objectContaining({
          name: 'database',
          required: false,
          shared: false,
          type: 'STRING',
          defaultValue: 'default_database',
        }),
      ])
    })

    it('sends the x-chroma-token header and content type on requests', async () => {
      mock.onGet(COLLECTIONS).reply([])

      await service.listCollections()

      expect(mock.history[0].headers).toMatchObject({
        'x-chroma-token': API_KEY,
        'Content-Type': 'application/json',
      })
    })
  })

  // ── Constructor / config defaults ──

  describe('constructor defaults', () => {
    // Instantiate the exported class directly (no second sandbox) so the shared
    // global.Flowrunner from beforeAll is left untouched for the rest of the suite.
    // Required inside the tests (after beforeAll set the global) via the module cache.
    it('strips trailing slashes from baseUrl and applies tenant/database defaults', async () => {
      const Chroma = require('../src/index.js')
      const localService = new Chroma({ baseUrl: 'http://localhost:8000///' })

      const localCollections =
        'http://localhost:8000/api/v2/tenants/default_tenant/databases/default_database/collections'

      mock.onGet(localCollections).reply([])

      await localService.listCollections()

      expect(mock.history[0].url).toBe(localCollections)
      // No apiKey configured → no auth header sent.
      expect(mock.history[0].headers['x-chroma-token']).toBeUndefined()
    })

    it('uses provided tenant and database in the collections path', async () => {
      const Chroma = require('../src/index.js')
      const localService = new Chroma({ baseUrl: BASE_URL, tenant: 'acme', database: 'prod' })
      const url = `${ BASE_URL }/api/v2/tenants/acme/databases/prod/collections`

      mock.onGet(url).reply([])

      await localService.listCollections()

      expect(mock.history[0].url).toBe(url)
    })
  })

  // ── Collections ──

  describe('createCollection', () => {
    it('sends POST with required params only', async () => {
      mock.onPost(COLLECTIONS).reply({ id: COLLECTION_UUID, name: 'products' })

      const result = await service.createCollection('products')

      expect(result).toEqual({ id: COLLECTION_UUID, name: 'products' })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(COLLECTIONS)
      expect(mock.history[0].body).toEqual({ name: 'products' })
    })

    it('includes metadata, configuration and get_or_create when provided', async () => {
      mock.onPost(COLLECTIONS).reply({ id: COLLECTION_UUID, name: 'products' })

      await service.createCollection(
        'products',
        { description: 'product docs' },
        { hnsw: { space: 'cosine' } },
        true
      )

      expect(mock.history[0].body).toEqual({
        name: 'products',
        metadata: { description: 'product docs' },
        configuration: { hnsw: { space: 'cosine' } },
        get_or_create: true,
      })
    })

    it('omits empty metadata and configuration objects', async () => {
      mock.onPost(COLLECTIONS).reply({ id: COLLECTION_UUID, name: 'products' })

      await service.createCollection('products', {}, {})

      expect(mock.history[0].body).toEqual({ name: 'products' })
    })

    it('sends get_or_create false when explicitly false', async () => {
      mock.onPost(COLLECTIONS).reply({ id: COLLECTION_UUID, name: 'products' })

      await service.createCollection('products', undefined, undefined, false)

      expect(mock.history[0].body).toEqual({ name: 'products', get_or_create: false })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(COLLECTIONS).replyWithError({
        message: 'Bad Request',
        body: { error: 'InvalidArgumentError', message: 'name already exists' },
      })

      await expect(service.createCollection('products')).rejects.toThrow(
        'Chroma API error: InvalidArgumentError: name already exists'
      )
    })
  })

  describe('listCollections', () => {
    it('sends GET with no pagination query by default', async () => {
      mock.onGet(COLLECTIONS).reply([{ id: COLLECTION_UUID, name: 'products' }])

      const result = await service.listCollections()

      expect(result).toEqual([{ id: COLLECTION_UUID, name: 'products' }])
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].query).toEqual({})
    })

    it('passes limit and offset when provided', async () => {
      mock.onGet(COLLECTIONS).reply([])

      await service.listCollections(10, 20)

      expect(mock.history[0].query).toMatchObject({ limit: 10, offset: 20 })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(COLLECTIONS).replyWithError({ message: 'Server Error' })

      await expect(service.listCollections()).rejects.toThrow('Chroma API error: Server Error')
    })
  })

  describe('getCollection', () => {
    it('fetches a collection by name with url encoding', async () => {
      mock.onGet(`${ COLLECTIONS }/my%20products`).reply({ id: COLLECTION_UUID, name: 'my products' })

      const result = await service.getCollection('my products')

      expect(result).toEqual({ id: COLLECTION_UUID, name: 'my products' })
      expect(mock.history[0].url).toBe(`${ COLLECTIONS }/my%20products`)
      expect(mock.history[0].method).toBe('get')
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ COLLECTIONS }/missing`).replyWithError({
        message: 'Not Found',
        body: { error: 'NotFoundError', message: 'collection missing' },
      })

      await expect(service.getCollection('missing')).rejects.toThrow(
        'Chroma API error: NotFoundError: collection missing'
      )
    })
  })

  describe('deleteCollection', () => {
    it('sends DELETE and returns the API response when present', async () => {
      mock.onDelete(`${ COLLECTIONS }/products`).reply({ deleted: true })

      const result = await service.deleteCollection('products')

      expect(result).toEqual({ deleted: true })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${ COLLECTIONS }/products`)
    })

    it('returns {success:true} when the API returns an empty body', async () => {
      mock.onDelete(`${ COLLECTIONS }/products`).reply(undefined)

      const result = await service.deleteCollection('products')

      expect(result).toEqual({ success: true })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onDelete(`${ COLLECTIONS }/products`).replyWithError({ message: 'Boom' })

      await expect(service.deleteCollection('products')).rejects.toThrow('Chroma API error: Boom')
    })
  })

  describe('countCollections', () => {
    it('wraps a numeric response as {count}', async () => {
      mock.onGet(`${ COLLECTIONS }_count`).reply(7)

      const result = await service.countCollections()

      expect(result).toEqual({ count: 7 })
      expect(mock.history[0].url).toBe(`${ COLLECTIONS }_count`)
      expect(mock.history[0].method).toBe('get')
    })

    it('passes through a non-numeric response unchanged', async () => {
      mock.onGet(`${ COLLECTIONS }_count`).reply({ count: 3 })

      const result = await service.countCollections()

      expect(result).toEqual({ count: 3 })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ COLLECTIONS }_count`).replyWithError({ message: 'Boom' })

      await expect(service.countCollections()).rejects.toThrow('Chroma API error: Boom')
    })
  })

  // ── Records (data operations) — collection resolved to a UUID ──

  describe('addRecords', () => {
    it('resolves a collection name to an id before writing', async () => {
      mock.onGet(`${ COLLECTIONS }/products`).reply({ id: COLLECTION_UUID, name: 'products' })
      mock.onPost(`${ COLLECTIONS }/${ COLLECTION_UUID }/add`).reply({ ok: true })

      const result = await service.addRecords('products', ['doc1'], [[0.1, 0.2]])

      expect(result).toEqual({ ok: true })
      // First the resolve GET, then the add POST.
      expect(mock.history).toHaveLength(2)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ COLLECTIONS }/products`)
      expect(mock.history[1].method).toBe('post')
      expect(mock.history[1].url).toBe(`${ COLLECTIONS }/${ COLLECTION_UUID }/add`)
      expect(mock.history[1].body).toEqual({ ids: ['doc1'], embeddings: [[0.1, 0.2]] })
    })

    it('skips the resolve lookup when a UUID is passed directly', async () => {
      mock.onPost(`${ COLLECTIONS }/${ COLLECTION_UUID }/add`).reply({ ok: true })

      await service.addRecords(COLLECTION_UUID, ['doc1'], [[0.1, 0.2]])

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].url).toBe(`${ COLLECTIONS }/${ COLLECTION_UUID }/add`)
    })

    it('includes metadatas and documents, omitting empty arrays', async () => {
      mock.onPost(`${ COLLECTIONS }/${ COLLECTION_UUID }/add`).reply({ ok: true })

      await service.addRecords(
        COLLECTION_UUID,
        ['doc1', 'doc2'],
        [],
        [{ source: 'web' }, { source: 'pdf' }],
        ['first', 'second']
      )

      expect(mock.history[0].body).toEqual({
        ids: ['doc1', 'doc2'],
        metadatas: [{ source: 'web' }, { source: 'pdf' }],
        documents: ['first', 'second'],
      })
    })

    it('sends an empty ids array when ids are omitted', async () => {
      mock.onPost(`${ COLLECTIONS }/${ COLLECTION_UUID }/add`).reply({ ok: true })

      await service.addRecords(COLLECTION_UUID)

      expect(mock.history[0].body).toEqual({ ids: [] })
    })

    it('returns {success:true} when the API returns an empty body', async () => {
      mock.onPost(`${ COLLECTIONS }/${ COLLECTION_UUID }/add`).reply(undefined)

      const result = await service.addRecords(COLLECTION_UUID, ['doc1'], [[0.1]])

      expect(result).toEqual({ success: true })
    })

    it('throws when no collection is provided', async () => {
      await expect(service.addRecords('', ['doc1'])).rejects.toThrow(
        'addRecords: a collection name or id is required'
      )
    })

    it('throws when the collection name cannot be resolved to an id', async () => {
      mock.onGet(`${ COLLECTIONS }/ghost`).reply({ name: 'ghost' })

      await expect(service.addRecords('ghost', ['doc1'])).rejects.toThrow(
        'addRecords: could not resolve id for collection "ghost"'
      )
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ COLLECTIONS }/${ COLLECTION_UUID }/add`).replyWithError({ message: 'Boom' })

      await expect(service.addRecords(COLLECTION_UUID, ['doc1'])).rejects.toThrow('Chroma API error: Boom')
    })
  })

  describe('upsertRecords', () => {
    it('posts to the upsert endpoint with the record body', async () => {
      mock.onPost(`${ COLLECTIONS }/${ COLLECTION_UUID }/upsert`).reply({ ok: true })

      await service.upsertRecords(COLLECTION_UUID, ['doc1'], [[0.1, 0.2]], [{ source: 'web' }], ['text'])

      expect(mock.history[0].url).toBe(`${ COLLECTIONS }/${ COLLECTION_UUID }/upsert`)
      expect(mock.history[0].body).toEqual({
        ids: ['doc1'],
        embeddings: [[0.1, 0.2]],
        metadatas: [{ source: 'web' }],
        documents: ['text'],
      })
    })

    it('returns {success:true} when the API returns an empty body', async () => {
      mock.onPost(`${ COLLECTIONS }/${ COLLECTION_UUID }/upsert`).reply(undefined)

      const result = await service.upsertRecords(COLLECTION_UUID, ['doc1'])

      expect(result).toEqual({ success: true })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ COLLECTIONS }/${ COLLECTION_UUID }/upsert`).replyWithError({ message: 'Boom' })

      await expect(service.upsertRecords(COLLECTION_UUID, ['doc1'])).rejects.toThrow('Chroma API error: Boom')
    })
  })

  describe('updateRecords', () => {
    it('posts to the update endpoint with the record body', async () => {
      mock.onPost(`${ COLLECTIONS }/${ COLLECTION_UUID }/update`).reply({ ok: true })

      await service.updateRecords(COLLECTION_UUID, ['doc1'], undefined, [{ source: 'pdf' }])

      expect(mock.history[0].url).toBe(`${ COLLECTIONS }/${ COLLECTION_UUID }/update`)
      expect(mock.history[0].body).toEqual({
        ids: ['doc1'],
        metadatas: [{ source: 'pdf' }],
      })
    })

    it('returns {success:true} when the API returns an empty body', async () => {
      mock.onPost(`${ COLLECTIONS }/${ COLLECTION_UUID }/update`).reply(undefined)

      const result = await service.updateRecords(COLLECTION_UUID, ['doc1'])

      expect(result).toEqual({ success: true })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ COLLECTIONS }/${ COLLECTION_UUID }/update`).replyWithError({ message: 'Boom' })

      await expect(service.updateRecords(COLLECTION_UUID, ['doc1'])).rejects.toThrow('Chroma API error: Boom')
    })
  })

  describe('queryRecords', () => {
    it('sends required query_embeddings only', async () => {
      mock.onPost(`${ COLLECTIONS }/${ COLLECTION_UUID }/query`).reply({ ids: [['doc1']] })

      const result = await service.queryRecords(COLLECTION_UUID, [[0.1, 0.2, 0.3]])

      expect(result).toEqual({ ids: [['doc1']] })
      expect(mock.history[0].url).toBe(`${ COLLECTIONS }/${ COLLECTION_UUID }/query`)
      expect(mock.history[0].body).toEqual({ query_embeddings: [[0.1, 0.2, 0.3]] })
    })

    it('includes all optional params when provided', async () => {
      mock.onPost(`${ COLLECTIONS }/${ COLLECTION_UUID }/query`).reply({ ids: [[]] })

      await service.queryRecords(
        COLLECTION_UUID,
        [[0.1, 0.2, 0.3]],
        5,
        { source: 'web' },
        { $contains: 'invoice' },
        ['documents', 'distances']
      )

      expect(mock.history[0].body).toEqual({
        query_embeddings: [[0.1, 0.2, 0.3]],
        n_results: 5,
        where: { source: 'web' },
        where_document: { $contains: 'invoice' },
        include: ['documents', 'distances'],
      })
    })

    it('omits empty where, where_document and include', async () => {
      mock.onPost(`${ COLLECTIONS }/${ COLLECTION_UUID }/query`).reply({ ids: [[]] })

      await service.queryRecords(COLLECTION_UUID, [[0.1]], undefined, {}, {}, [])

      expect(mock.history[0].body).toEqual({ query_embeddings: [[0.1]] })
    })

    it('defaults query_embeddings to an empty array when omitted', async () => {
      mock.onPost(`${ COLLECTIONS }/${ COLLECTION_UUID }/query`).reply({ ids: [] })

      await service.queryRecords(COLLECTION_UUID)

      expect(mock.history[0].body).toEqual({ query_embeddings: [] })
    })

    it('resolves a collection name to an id before querying', async () => {
      mock.onGet(`${ COLLECTIONS }/products`).reply({ id: COLLECTION_UUID })
      mock.onPost(`${ COLLECTIONS }/${ COLLECTION_UUID }/query`).reply({ ids: [[]] })

      await service.queryRecords('products', [[0.1]])

      expect(mock.history).toHaveLength(2)
      expect(mock.history[0].url).toBe(`${ COLLECTIONS }/products`)
      expect(mock.history[1].url).toBe(`${ COLLECTIONS }/${ COLLECTION_UUID }/query`)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ COLLECTIONS }/${ COLLECTION_UUID }/query`).replyWithError({ message: 'Boom' })

      await expect(service.queryRecords(COLLECTION_UUID, [[0.1]])).rejects.toThrow('Chroma API error: Boom')
    })
  })

  describe('getRecords', () => {
    it('sends an empty body when no selectors are provided', async () => {
      mock.onPost(`${ COLLECTIONS }/${ COLLECTION_UUID }/get`).reply({ ids: [] })

      const result = await service.getRecords(COLLECTION_UUID)

      expect(result).toEqual({ ids: [] })
      expect(mock.history[0].url).toBe(`${ COLLECTIONS }/${ COLLECTION_UUID }/get`)
      expect(mock.history[0].body).toEqual({})
    })

    it('includes ids, filters, pagination and include', async () => {
      mock.onPost(`${ COLLECTIONS }/${ COLLECTION_UUID }/get`).reply({ ids: ['doc1'] })

      await service.getRecords(
        COLLECTION_UUID,
        ['doc1', 'doc2'],
        { source: 'web' },
        { $contains: 'invoice' },
        10,
        5,
        ['documents', 'metadatas']
      )

      expect(mock.history[0].body).toEqual({
        ids: ['doc1', 'doc2'],
        where: { source: 'web' },
        where_document: { $contains: 'invoice' },
        limit: 10,
        offset: 5,
        include: ['documents', 'metadatas'],
      })
    })

    it('omits empty arrays, objects and include', async () => {
      mock.onPost(`${ COLLECTIONS }/${ COLLECTION_UUID }/get`).reply({ ids: [] })

      await service.getRecords(COLLECTION_UUID, [], {}, {}, undefined, undefined, [])

      expect(mock.history[0].body).toEqual({})
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ COLLECTIONS }/${ COLLECTION_UUID }/get`).replyWithError({ message: 'Boom' })

      await expect(service.getRecords(COLLECTION_UUID)).rejects.toThrow('Chroma API error: Boom')
    })
  })

  describe('countRecords', () => {
    it('wraps a numeric response as {count}', async () => {
      mock.onGet(`${ COLLECTIONS }/${ COLLECTION_UUID }/count`).reply(128)

      const result = await service.countRecords(COLLECTION_UUID)

      expect(result).toEqual({ count: 128 })
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ COLLECTIONS }/${ COLLECTION_UUID }/count`)
    })

    it('passes through a non-numeric response unchanged', async () => {
      mock.onGet(`${ COLLECTIONS }/${ COLLECTION_UUID }/count`).reply({ count: 5 })

      const result = await service.countRecords(COLLECTION_UUID)

      expect(result).toEqual({ count: 5 })
    })

    it('resolves a collection name to an id before counting', async () => {
      mock.onGet(`${ COLLECTIONS }/products`).reply({ id: COLLECTION_UUID })
      mock.onGet(`${ COLLECTIONS }/${ COLLECTION_UUID }/count`).reply(3)

      const result = await service.countRecords('products')

      expect(result).toEqual({ count: 3 })
      expect(mock.history).toHaveLength(2)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ COLLECTIONS }/${ COLLECTION_UUID }/count`).replyWithError({ message: 'Boom' })

      await expect(service.countRecords(COLLECTION_UUID)).rejects.toThrow('Chroma API error: Boom')
    })
  })

  describe('deleteRecords', () => {
    it('deletes by ids', async () => {
      mock.onPost(`${ COLLECTIONS }/${ COLLECTION_UUID }/delete`).reply({ ok: true })

      const result = await service.deleteRecords(COLLECTION_UUID, ['doc1', 'doc2'])

      expect(result).toEqual({ ok: true })
      expect(mock.history[0].url).toBe(`${ COLLECTIONS }/${ COLLECTION_UUID }/delete`)
      expect(mock.history[0].body).toEqual({ ids: ['doc1', 'doc2'] })
    })

    it('deletes by metadata and document filters', async () => {
      mock.onPost(`${ COLLECTIONS }/${ COLLECTION_UUID }/delete`).reply({ ok: true })

      await service.deleteRecords(COLLECTION_UUID, undefined, { source: 'web' }, { $contains: 'draft' })

      expect(mock.history[0].body).toEqual({
        where: { source: 'web' },
        where_document: { $contains: 'draft' },
      })
    })

    it('returns {success:true} when the API returns an empty body', async () => {
      mock.onPost(`${ COLLECTIONS }/${ COLLECTION_UUID }/delete`).reply(undefined)

      const result = await service.deleteRecords(COLLECTION_UUID, ['doc1'])

      expect(result).toEqual({ success: true })
    })

    it('throws when no selector is provided (no request sent)', async () => {
      await expect(service.deleteRecords(COLLECTION_UUID)).rejects.toThrow(
        'deleteRecords: provide "IDs", "Metadata Filter" or "Document Filter"'
      )
      expect(mock.history).toHaveLength(0)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ COLLECTIONS }/${ COLLECTION_UUID }/delete`).replyWithError({ message: 'Boom' })

      await expect(service.deleteRecords(COLLECTION_UUID, ['doc1'])).rejects.toThrow('Chroma API error: Boom')
    })
  })

  // ── Error message shaping ──

  describe('error message shaping', () => {
    it('uses body.message when body.error is absent', async () => {
      mock.onGet(COLLECTIONS).replyWithError({
        message: 'HTTP 500',
        body: { message: 'internal failure' },
      })

      await expect(service.listCollections()).rejects.toThrow('Chroma API error: internal failure')
    })

    it('falls back to error.message when there is no body', async () => {
      mock.onGet(COLLECTIONS).replyWithError({ message: 'Network down' })

      await expect(service.listCollections()).rejects.toThrow('Chroma API error: Network down')
    })
  })

  // ── Dictionary ──

  describe('getCollectionsDictionary', () => {
    const collections = [
      { id: 'id-products', name: 'products' },
      { id: 'id-docs', name: 'documentation' },
    ]

    it('maps an array response to items with name label and id value', async () => {
      mock.onGet(COLLECTIONS).reply(collections)

      const result = await service.getCollectionsDictionary({})

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].url).toBe(COLLECTIONS)
      expect(result).toEqual({
        items: [
          { label: 'products', value: 'id-products', note: 'id-products' },
          { label: 'documentation', value: 'id-docs', note: 'id-docs' },
        ],
        cursor: null,
      })
    })

    it('reads collections from a {collections:[...]} response', async () => {
      mock.onGet(COLLECTIONS).reply({ collections })

      const result = await service.getCollectionsDictionary({})

      expect(result.items).toHaveLength(2)
      expect(result.items[0].value).toBe('id-products')
    })

    it('filters by search term (case-insensitive)', async () => {
      mock.onGet(COLLECTIONS).reply(collections)

      const result = await service.getCollectionsDictionary({ search: 'DOC' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('id-docs')
    })

    it('handles a null payload', async () => {
      mock.onGet(COLLECTIONS).reply(collections)

      const result = await service.getCollectionsDictionary(null)

      expect(result.items).toHaveLength(2)
      expect(result.cursor).toBeNull()
    })

    it('returns empty items for a non-array/non-collections response', async () => {
      mock.onGet(COLLECTIONS).reply({ unexpected: true })

      const result = await service.getCollectionsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })
  })
})
