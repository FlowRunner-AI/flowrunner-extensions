'use strict'

const { createSandbox } = require('../../../service-sandbox')

const ACCOUNT_ENDPOINT = 'https://testaccount.documents.azure.com:443'
const MASTER_KEY = 'dGVzdC1tYXN0ZXIta2V5LWJhc2U2NA==' // base64 dummy
const BASE = ACCOUNT_ENDPOINT

describe('Azure Cosmos DB Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ accountEndpoint: ACCOUNT_ENDPOINT, masterKey: MASTER_KEY })
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

  // ── Helper: build a mock response with body + headers (service uses unwrapBody(false)) ──

  function apiResponse(body, headers = {}) {
    return { body, headers }
  }

  // ── Registration ──

  describe('service registration', () => {
    it('registers with correct config items', () => {
      expect(sandbox.getConfigItems()).toEqual([
        expect.objectContaining({
          name: 'accountEndpoint',
          required: true,
          shared: false,
          type: 'STRING',
        }),
        expect.objectContaining({
          name: 'masterKey',
          required: true,
          shared: false,
          type: 'STRING',
        }),
      ])
    })
  })

  // ── Common auth headers ──

  describe('request signing', () => {
    it('sends Authorization, x-ms-date, and x-ms-version headers', async () => {
      mock.onGet(`${BASE}/dbs`).reply(apiResponse({ _rid: '', Databases: [], _count: 0 }))

      await service.listDatabases()

      expect(mock.history).toHaveLength(1)
      const headers = mock.history[0].headers

      expect(headers).toHaveProperty('Authorization')
      expect(headers.Authorization).toMatch(/type%3Dmaster%26ver%3D1\.0%26sig%3D/)
      expect(headers).toHaveProperty('x-ms-date')
      expect(headers['x-ms-version']).toBe('2018-12-31')
      expect(headers['Content-Type']).toBe('application/json')
      expect(headers.Accept).toBe('application/json')
    })
  })

  // ── Databases ──

  describe('listDatabases', () => {
    it('sends GET to /dbs and returns body', async () => {
      const responseBody = { _rid: '', Databases: [{ id: 'mydb' }], _count: 1 }

      mock.onGet(`${BASE}/dbs`).reply(apiResponse(responseBody))

      const result = await service.listDatabases()

      expect(result).toEqual(responseBody)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${BASE}/dbs`)
    })

    it('throws on API error', async () => {
      mock.onGet(`${BASE}/dbs`).replyWithError({
        message: 'Unauthorized',
        status: 401,
        body: { code: 'Unauthorized', message: 'Invalid key' },
      })

      await expect(service.listDatabases()).rejects.toThrow('Azure Cosmos DB API error')
    })
  })

  describe('getDatabase', () => {
    it('sends GET to /dbs/{database}', async () => {
      const responseBody = { id: 'mydb', _rid: '1KtjAA==' }

      mock.onGet(`${BASE}/dbs/mydb`).reply(apiResponse(responseBody))

      const result = await service.getDatabase('mydb')

      expect(result).toEqual(responseBody)
      expect(mock.history[0].url).toBe(`${BASE}/dbs/mydb`)
    })

    it('throws when database is not provided', async () => {
      await expect(service.getDatabase()).rejects.toThrow('database is required.')
    })
  })

  describe('createDatabase', () => {
    it('sends POST to /dbs with { id }', async () => {
      const responseBody = { id: 'newdb', _rid: '2KtjBB==' }

      mock.onPost(`${BASE}/dbs`).reply(apiResponse(responseBody))

      const result = await service.createDatabase('newdb')

      expect(result).toEqual(responseBody)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({ id: 'newdb' })
    })

    it('throws when databaseId is not provided', async () => {
      await expect(service.createDatabase()).rejects.toThrow('databaseId is required.')
    })
  })

  describe('deleteDatabase', () => {
    it('sends DELETE to /dbs/{database} and returns confirmation', async () => {
      mock.onDelete(`${BASE}/dbs/mydb`).reply(apiResponse(undefined))

      const result = await service.deleteDatabase('mydb')

      expect(result).toEqual({ deleted: true, database: 'mydb' })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${BASE}/dbs/mydb`)
    })

    it('throws when database is not provided', async () => {
      await expect(service.deleteDatabase()).rejects.toThrow('database is required.')
    })
  })

  // ── Containers ──

  describe('listContainers', () => {
    it('sends GET to /dbs/{db}/colls', async () => {
      const responseBody = { _rid: '1KtjAA==', DocumentCollections: [{ id: 'mycoll' }], _count: 1 }

      mock.onGet(`${BASE}/dbs/mydb/colls`).reply(apiResponse(responseBody))

      const result = await service.listContainers('mydb')

      expect(result).toEqual(responseBody)
      expect(mock.history[0].url).toBe(`${BASE}/dbs/mydb/colls`)
    })

    it('throws when database is not provided', async () => {
      await expect(service.listContainers()).rejects.toThrow('database is required.')
    })
  })

  describe('getContainer', () => {
    it('sends GET to /dbs/{db}/colls/{container}', async () => {
      const responseBody = { id: 'mycoll', partitionKey: { paths: ['/pk'] } }

      mock.onGet(`${BASE}/dbs/mydb/colls/mycoll`).reply(apiResponse(responseBody))

      const result = await service.getContainer('mydb', 'mycoll')

      expect(result).toEqual(responseBody)
      expect(mock.history[0].url).toBe(`${BASE}/dbs/mydb/colls/mycoll`)
    })

    it('throws when database is not provided', async () => {
      await expect(service.getContainer(undefined, 'mycoll')).rejects.toThrow('database is required.')
    })

    it('throws when container is not provided', async () => {
      await expect(service.getContainer('mydb')).rejects.toThrow('container is required.')
    })
  })

  describe('createContainer', () => {
    it('sends POST to /dbs/{db}/colls with partition key', async () => {
      const responseBody = { id: 'newcoll', partitionKey: { paths: ['/pk'], kind: 'Hash', version: 2 } }

      mock.onPost(`${BASE}/dbs/mydb/colls`).reply(apiResponse(responseBody))

      const result = await service.createContainer('mydb', 'newcoll', '/pk')

      expect(result).toEqual(responseBody)
      expect(mock.history[0].body).toEqual({
        id: 'newcoll',
        partitionKey: { paths: ['/pk'], kind: 'Hash', version: 2 },
      })
    })

    it('prepends slash to partition key path if missing', async () => {
      mock.onPost(`${BASE}/dbs/mydb/colls`).reply(apiResponse({ id: 'coll2' }))

      await service.createContainer('mydb', 'coll2', 'category')

      expect(mock.history[0].body.partitionKey.paths).toEqual(['/category'])
    })

    it('throws when required params are missing', async () => {
      await expect(service.createContainer()).rejects.toThrow('database is required.')
      await expect(service.createContainer('mydb')).rejects.toThrow('containerId is required.')
      await expect(service.createContainer('mydb', 'coll')).rejects.toThrow('partitionKeyPath is required.')
    })
  })

  describe('deleteContainer', () => {
    it('sends DELETE to /dbs/{db}/colls/{container}', async () => {
      mock.onDelete(`${BASE}/dbs/mydb/colls/mycoll`).reply(apiResponse(undefined))

      const result = await service.deleteContainer('mydb', 'mycoll')

      expect(result).toEqual({ deleted: true, database: 'mydb', container: 'mycoll' })
      expect(mock.history[0].method).toBe('delete')
    })

    it('throws when required params are missing', async () => {
      await expect(service.deleteContainer()).rejects.toThrow('database is required.')
      await expect(service.deleteContainer('mydb')).rejects.toThrow('container is required.')
    })
  })

  // ── Documents ──

  describe('queryDocuments', () => {
    const docsUrl = `${BASE}/dbs/mydb/colls/mycoll/docs`

    it('sends POST with query body and correct content type', async () => {
      mock.onPost(docsUrl).reply(apiResponse(
        { Documents: [{ id: '1', status: 'active' }], _count: 1 },
        {}
      ))

      const result = await service.queryDocuments('mydb', 'mycoll', 'SELECT * FROM c')

      expect(result).toEqual({
        documents: [{ id: '1', status: 'active' }],
        count: 1,
        continuationToken: null,
      })

      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].headers['Content-Type']).toBe('application/query+json')
      expect(mock.history[0].headers['x-ms-documentdb-isquery']).toBe('true')
      expect(mock.history[0].headers['x-ms-documentdb-query-enablecrosspartition']).toBe('true')
      expect(mock.history[0].body).toEqual({
        query: 'SELECT * FROM c',
        parameters: [],
      })
    })

    it('passes query parameters when provided', async () => {
      mock.onPost(docsUrl).reply(apiResponse({ Documents: [], _count: 0 }, {}))

      const params = [{ name: '@status', value: 'active' }]

      await service.queryDocuments('mydb', 'mycoll', 'SELECT * FROM c WHERE c.status = @status', params)

      expect(mock.history[0].body.parameters).toEqual(params)
    })

    it('passes maxItemCount and continuationToken headers when provided', async () => {
      mock.onPost(docsUrl).reply(apiResponse({ Documents: [], _count: 0 }, {}))

      await service.queryDocuments('mydb', 'mycoll', 'SELECT * FROM c', [], 10, 'token123')

      expect(mock.history[0].headers['x-ms-max-item-count']).toBe('10')
      expect(mock.history[0].headers['x-ms-continuation']).toBe('token123')
    })

    it('returns continuation token from response headers', async () => {
      mock.onPost(docsUrl).reply(apiResponse(
        { Documents: [{ id: '1' }], _count: 1 },
        { 'x-ms-continuation': 'nextpage123' }
      ))

      const result = await service.queryDocuments('mydb', 'mycoll', 'SELECT * FROM c')

      expect(result.continuationToken).toBe('nextpage123')
    })

    it('throws when required params are missing', async () => {
      await expect(service.queryDocuments()).rejects.toThrow('database is required.')
      await expect(service.queryDocuments('mydb')).rejects.toThrow('container is required.')
      await expect(service.queryDocuments('mydb', 'mycoll')).rejects.toThrow('query is required.')
    })
  })

  describe('listDocuments', () => {
    const docsUrl = `${BASE}/dbs/mydb/colls/mycoll/docs`

    it('sends GET and returns documents with count', async () => {
      mock.onGet(docsUrl).reply(apiResponse(
        { Documents: [{ id: '1', pk: 'a' }], _count: 1 },
        {}
      ))

      const result = await service.listDocuments('mydb', 'mycoll')

      expect(result).toEqual({
        documents: [{ id: '1', pk: 'a' }],
        count: 1,
        continuationToken: null,
      })
      expect(mock.history[0].method).toBe('get')
    })

    it('passes maxItemCount and continuationToken headers when provided', async () => {
      mock.onGet(docsUrl).reply(apiResponse({ Documents: [], _count: 0 }, {}))

      await service.listDocuments('mydb', 'mycoll', 25, 'cursor-abc')

      expect(mock.history[0].headers['x-ms-max-item-count']).toBe('25')
      expect(mock.history[0].headers['x-ms-continuation']).toBe('cursor-abc')
    })

    it('omits paging headers when not provided', async () => {
      mock.onGet(docsUrl).reply(apiResponse({ Documents: [], _count: 0 }, {}))

      await service.listDocuments('mydb', 'mycoll')

      expect(mock.history[0].headers).not.toHaveProperty('x-ms-max-item-count')
      expect(mock.history[0].headers).not.toHaveProperty('x-ms-continuation')
    })

    it('throws when required params are missing', async () => {
      await expect(service.listDocuments()).rejects.toThrow('database is required.')
      await expect(service.listDocuments('mydb')).rejects.toThrow('container is required.')
    })
  })

  describe('getDocument', () => {
    it('sends GET to /dbs/{db}/colls/{coll}/docs/{docId} with partition key header', async () => {
      const responseBody = { id: 'doc1', pk: 'a', name: 'Item' }

      mock.onGet(`${BASE}/dbs/mydb/colls/mycoll/docs/doc1`).reply(apiResponse(responseBody))

      const result = await service.getDocument('mydb', 'mycoll', 'doc1', 'a')

      expect(result).toEqual(responseBody)
      expect(mock.history[0].headers['x-ms-documentdb-partitionkey']).toBe('["a"]')
    })

    it('handles already-serialized partition key array', async () => {
      mock.onGet(`${BASE}/dbs/mydb/colls/mycoll/docs/doc1`).reply(apiResponse({ id: 'doc1' }))

      await service.getDocument('mydb', 'mycoll', 'doc1', '["customValue"]')

      expect(mock.history[0].headers['x-ms-documentdb-partitionkey']).toBe('["customValue"]')
    })

    it('throws when required params are missing', async () => {
      await expect(service.getDocument()).rejects.toThrow('database is required.')
      await expect(service.getDocument('mydb')).rejects.toThrow('container is required.')
      await expect(service.getDocument('mydb', 'mycoll')).rejects.toThrow('documentId is required.')
    })
  })

  describe('createDocument', () => {
    const docsUrl = `${BASE}/dbs/mydb/colls/mycoll/docs`

    it('sends POST with document body and partition key header', async () => {
      const doc = { id: 'doc1', pk: 'a', name: 'Test' }
      const responseBody = { ...doc, _rid: 'abc==' }

      mock.onPost(docsUrl).reply(apiResponse(responseBody))

      const result = await service.createDocument('mydb', 'mycoll', doc, 'a')

      expect(result).toEqual(responseBody)
      expect(mock.history[0].body).toEqual(doc)
      expect(mock.history[0].headers['x-ms-documentdb-partitionkey']).toBe('["a"]')
    })

    it('throws when document is not an object', async () => {
      await expect(service.createDocument('mydb', 'mycoll', 'not-object', 'a'))
        .rejects.toThrow('document (plain JSON object) is required.')
    })

    it('throws when required params are missing', async () => {
      await expect(service.createDocument()).rejects.toThrow('database is required.')
      await expect(service.createDocument('mydb')).rejects.toThrow('container is required.')
      await expect(service.createDocument('mydb', 'mycoll')).rejects.toThrow('document (plain JSON object) is required.')
    })
  })

  describe('upsertDocument', () => {
    const docsUrl = `${BASE}/dbs/mydb/colls/mycoll/docs`

    it('sends POST with upsert header', async () => {
      const doc = { id: 'doc1', pk: 'a', name: 'Upserted' }

      mock.onPost(docsUrl).reply(apiResponse({ ...doc, _rid: 'xyz==' }))

      const result = await service.upsertDocument('mydb', 'mycoll', doc, 'a')

      expect(result).toHaveProperty('id', 'doc1')
      expect(mock.history[0].headers['x-ms-documentdb-is-upsert']).toBe('true')
      expect(mock.history[0].headers['x-ms-documentdb-partitionkey']).toBe('["a"]')
      expect(mock.history[0].body).toEqual(doc)
    })

    it('throws when document is not an object', async () => {
      await expect(service.upsertDocument('mydb', 'mycoll', null, 'a'))
        .rejects.toThrow('document (plain JSON object) is required.')
    })
  })

  describe('replaceDocument', () => {
    it('sends PUT to /dbs/{db}/colls/{coll}/docs/{docId}', async () => {
      const doc = { id: 'doc1', pk: 'a', name: 'Replaced' }

      mock.onPut(`${BASE}/dbs/mydb/colls/mycoll/docs/doc1`).reply(apiResponse({ ...doc, _ts: 999 }))

      const result = await service.replaceDocument('mydb', 'mycoll', 'doc1', doc, 'a')

      expect(result).toHaveProperty('name', 'Replaced')
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].body).toEqual(doc)
      expect(mock.history[0].headers['x-ms-documentdb-partitionkey']).toBe('["a"]')
    })

    it('throws when required params are missing', async () => {
      await expect(service.replaceDocument()).rejects.toThrow('database is required.')
      await expect(service.replaceDocument('mydb')).rejects.toThrow('container is required.')
      await expect(service.replaceDocument('mydb', 'mycoll')).rejects.toThrow('documentId is required.')
      await expect(service.replaceDocument('mydb', 'mycoll', 'doc1'))
        .rejects.toThrow('document (plain JSON object) is required.')
    })
  })

  describe('deleteDocument', () => {
    it('sends DELETE with partition key header and returns confirmation', async () => {
      mock.onDelete(`${BASE}/dbs/mydb/colls/mycoll/docs/doc1`).reply(apiResponse(undefined))

      const result = await service.deleteDocument('mydb', 'mycoll', 'doc1', 'a')

      expect(result).toEqual({ deleted: true, documentId: 'doc1' })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].headers['x-ms-documentdb-partitionkey']).toBe('["a"]')
    })

    it('throws when required params are missing', async () => {
      await expect(service.deleteDocument()).rejects.toThrow('database is required.')
      await expect(service.deleteDocument('mydb')).rejects.toThrow('container is required.')
      await expect(service.deleteDocument('mydb', 'mycoll')).rejects.toThrow('documentId is required.')
    })
  })

  // ── Dictionaries ──

  describe('getDatabasesDictionary', () => {
    it('returns formatted items from listDatabases', async () => {
      mock.onGet(`${BASE}/dbs`).reply(apiResponse({
        Databases: [{ id: 'db1' }, { id: 'db2' }], _count: 2,
      }))

      const result = await service.getDatabasesDictionary({})

      expect(result.items).toEqual([
        { label: 'db1', value: 'db1', note: 'Database' },
        { label: 'db2', value: 'db2', note: 'Database' },
      ])
    })

    it('filters by search term (case-insensitive)', async () => {
      mock.onGet(`${BASE}/dbs`).reply(apiResponse({
        Databases: [{ id: 'Production' }, { id: 'Staging' }, { id: 'prod-test' }], _count: 3,
      }))

      const result = await service.getDatabasesDictionary({ search: 'prod' })

      expect(result.items).toEqual([
        { label: 'Production', value: 'Production', note: 'Database' },
        { label: 'prod-test', value: 'prod-test', note: 'Database' },
      ])
    })

    it('returns empty items when no databases exist', async () => {
      mock.onGet(`${BASE}/dbs`).reply(apiResponse({ Databases: [], _count: 0 }))

      const result = await service.getDatabasesDictionary({})

      expect(result.items).toEqual([])
    })
  })

  describe('getContainersDictionary', () => {
    it('returns formatted items from listContainers', async () => {
      mock.onGet(`${BASE}/dbs/mydb/colls`).reply(apiResponse({
        DocumentCollections: [{ id: 'coll1' }, { id: 'coll2' }], _count: 2,
      }))

      const result = await service.getContainersDictionary({ criteria: { database: 'mydb' } })

      expect(result.items).toEqual([
        { label: 'coll1', value: 'coll1', note: 'Container' },
        { label: 'coll2', value: 'coll2', note: 'Container' },
      ])
    })

    it('returns empty items when database is not in criteria', async () => {
      const result = await service.getContainersDictionary({})

      expect(result.items).toEqual([])
      expect(mock.history).toHaveLength(0)
    })

    it('filters by search term', async () => {
      mock.onGet(`${BASE}/dbs/mydb/colls`).reply(apiResponse({
        DocumentCollections: [{ id: 'users' }, { id: 'orders' }, { id: 'user-settings' }], _count: 3,
      }))

      const result = await service.getContainersDictionary({ search: 'user', criteria: { database: 'mydb' } })

      expect(result.items).toEqual([
        { label: 'users', value: 'users', note: 'Container' },
        { label: 'user-settings', value: 'user-settings', note: 'Container' },
      ])
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('includes status code and Cosmos error code in message', async () => {
      mock.onGet(`${BASE}/dbs`).replyWithError({
        message: 'Not Found',
        status: 404,
        body: { code: 'NotFound', message: 'Resource not found' },
      })

      await expect(service.listDatabases()).rejects.toThrow(/404/)
      // Reset to re-test
      mock.reset()

      mock.onGet(`${BASE}/dbs`).replyWithError({
        message: 'Not Found',
        status: 404,
        body: { code: 'NotFound', message: 'Resource not found' },
      })

      await expect(service.listDatabases()).rejects.toThrow(/NotFound/)
    })

    it('includes retry-after info for 429 responses', async () => {
      mock.onGet(`${BASE}/dbs`).replyWithError({
        message: 'Too Many Requests',
        status: 429,
        body: { code: 'TooManyRequests', message: 'Rate limit exceeded' },
        headers: { 'x-ms-retry-after-ms': '1000' },
      })

      await expect(service.listDatabases()).rejects.toThrow(/retry after 1000ms/)
    })

    it('throws when accountEndpoint is not configured', async () => {
      // Temporarily clear the endpoint on the existing service instance
      const original = service.accountEndpoint

      service.accountEndpoint = ''

      await expect(service.listDatabases()).rejects.toThrow('Account Endpoint is not configured')
      service.accountEndpoint = original
    })

    it('throws when masterKey is not configured', async () => {
      // Temporarily clear the master key on the existing service instance
      const original = service.masterKey

      service.masterKey = ''

      await expect(service.listDatabases()).rejects.toThrow('Master Key is not configured')
      service.masterKey = original
    })
  })
})
