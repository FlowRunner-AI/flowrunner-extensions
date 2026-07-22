'use strict'

const { createSandbox } = require('../../../service-sandbox')

const ENDPOINT = 'https://in03-xxxx.serverless.gcp-us-west1.cloud.zilliz.com'
const TOKEN = 'test-token'
const BASE = `${ ENDPOINT }/v2/vectordb`

describe('Milvus Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    // Pass a trailing slash to exercise the trailing-slash stripping in the constructor.
    sandbox = createSandbox({ clusterEndpoint: `${ ENDPOINT }/`, token: TOKEN })
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
    it('registers with the correct config items', () => {
      expect(sandbox.getConfigItems()).toEqual([
        expect.objectContaining({ name: 'clusterEndpoint', displayName: 'Cluster Endpoint', required: true, shared: false, type: 'STRING' }),
        expect.objectContaining({ name: 'token', displayName: 'Token', required: true, shared: false, type: 'STRING' }),
      ])
    })

    it('strips the trailing slash from clusterEndpoint', async () => {
      mock.onPost(`${ BASE }/collections/list`).reply({ code: 0, data: [], message: '' })

      await service.listCollections()

      expect(mock.history[0].url).toBe(`${ BASE }/collections/list`)
    })

    it('sends the Bearer token and JSON content type', async () => {
      mock.onPost(`${ BASE }/collections/list`).reply({ code: 0, data: [], message: '' })

      await service.listCollections()

      expect(mock.history[0].headers).toMatchObject({
        'Authorization': `Bearer ${ TOKEN }`,
        'Content-Type': 'application/json',
      })
    })
  })

  // ── API response handling ──

  describe('API response envelope', () => {
    it('unwraps data from successful response (code 0)', async () => {
      mock.onPost(`${ BASE }/collections/list`).reply({ code: 0, data: ['col1', 'col2'], message: '' })

      const result = await service.listCollections()

      expect(result).toEqual(['col1', 'col2'])
    })

    it('throws on non-zero response code', async () => {
      mock.onPost(`${ BASE }/collections/list`).reply({ code: 1100, data: null, message: 'database not found' })

      await expect(service.listCollections()).rejects.toThrow('database not found (code 1100)')
    })

    it('throws a wrapped error on transport failure', async () => {
      mock.onPost(`${ BASE }/collections/list`).replyWithError({
        message: 'Connection refused',
        body: { code: 500, message: 'Internal Server Error' },
      })

      await expect(service.listCollections()).rejects.toThrow('Milvus API error: Internal Server Error (code 500)')
    })

    it('uses error.message when body is missing', async () => {
      mock.onPost(`${ BASE }/collections/list`).replyWithError({ message: 'Network timeout' })

      await expect(service.listCollections()).rejects.toThrow('Milvus API error: Network timeout')
    })
  })

  // ── Collections ──

  describe('createCollection', () => {
    it('sends quick-setup body with dimension', async () => {
      mock.onPost(`${ BASE }/collections/create`).reply({ code: 0, data: {}, message: '' })

      const result = await service.createCollection('docs', 768, 'Cosine')

      expect(result).toEqual({})
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].body).toEqual({
        collectionName: 'docs',
        dimension: 768,
        metricType: 'COSINE',
      })
    })

    it('maps metric type choices correctly', async () => {
      mock.onPost(`${ BASE }/collections/create`).reply({ code: 0, data: {}, message: '' })

      await service.createCollection('docs', 768, 'L2')

      expect(mock.history[0].body.metricType).toBe('L2')
    })

    it('maps Inner Product metric type', async () => {
      mock.onPost(`${ BASE }/collections/create`).reply({ code: 0, data: {}, message: '' })

      await service.createCollection('docs', 768, 'Inner Product')

      expect(mock.history[0].body.metricType).toBe('IP')
    })

    it('sends custom schema instead of dimension', async () => {
      const schema = { fields: [{ fieldName: 'id', dataType: 'Int64', isPrimary: true }] }
      mock.onPost(`${ BASE }/collections/create`).reply({ code: 0, data: {}, message: '' })

      await service.createCollection('docs', undefined, 'Cosine', undefined, undefined, undefined, undefined, schema)

      expect(mock.history[0].body).toMatchObject({
        collectionName: 'docs',
        schema,
        metricType: 'COSINE',
      })
      expect(mock.history[0].body.dimension).toBeUndefined()
    })

    it('includes optional fields when provided', async () => {
      mock.onPost(`${ BASE }/collections/create`).reply({ code: 0, data: {}, message: '' })

      await service.createCollection('docs', 768, 'Cosine', 'VarChar', true, 'myId', 'myVector')

      expect(mock.history[0].body).toMatchObject({
        collectionName: 'docs',
        dimension: 768,
        metricType: 'COSINE',
        idType: 'VarChar',
        autoID: true,
        primaryFieldName: 'myId',
        vectorFieldName: 'myVector',
      })
    })

    it('sets autoID to false when autoId is false', async () => {
      mock.onPost(`${ BASE }/collections/create`).reply({ code: 0, data: {}, message: '' })

      await service.createCollection('docs', 768, undefined, undefined, false)

      expect(mock.history[0].body.autoID).toBe(false)
    })

    it('throws when neither dimension nor schema is provided', async () => {
      await expect(service.createCollection('docs')).rejects.toThrow(
        'createCollection: provide a "Dimension" (quick setup) or a custom "Schema".'
      )
      expect(mock.history).toHaveLength(0)
    })
  })

  describe('listCollections', () => {
    it('sends POST to /collections/list with empty body', async () => {
      mock.onPost(`${ BASE }/collections/list`).reply({ code: 0, data: ['a', 'b'], message: '' })

      const result = await service.listCollections()

      expect(result).toEqual(['a', 'b'])
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({})
    })
  })

  describe('describeCollection', () => {
    it('sends POST with collectionName', async () => {
      const data = { collectionName: 'docs', fields: [] }
      mock.onPost(`${ BASE }/collections/describe`).reply({ code: 0, data, message: '' })

      const result = await service.describeCollection('docs')

      expect(result).toEqual(data)
      expect(mock.history[0].body).toEqual({ collectionName: 'docs' })
    })
  })

  describe('dropCollection', () => {
    it('sends POST with collectionName', async () => {
      mock.onPost(`${ BASE }/collections/drop`).reply({ code: 0, data: {}, message: '' })

      const result = await service.dropCollection('docs')

      expect(result).toEqual({})
      expect(mock.history[0].body).toEqual({ collectionName: 'docs' })
    })

    it('throws on API error', async () => {
      mock.onPost(`${ BASE }/collections/drop`).replyWithError({ message: 'Not found' })

      await expect(service.dropCollection('docs')).rejects.toThrow('Milvus API error')
    })
  })

  describe('hasCollection', () => {
    it('sends POST with collectionName and returns data', async () => {
      mock.onPost(`${ BASE }/collections/has`).reply({ code: 0, data: { has: true }, message: '' })

      const result = await service.hasCollection('docs')

      expect(result).toEqual({ has: true })
      expect(mock.history[0].body).toEqual({ collectionName: 'docs' })
    })
  })

  describe('getCollectionStats', () => {
    it('sends POST with collectionName', async () => {
      mock.onPost(`${ BASE }/collections/get_stats`).reply({ code: 0, data: { rowCount: 42 }, message: '' })

      const result = await service.getCollectionStats('docs')

      expect(result).toEqual({ rowCount: 42 })
      expect(mock.history[0].body).toEqual({ collectionName: 'docs' })
    })
  })

  describe('loadCollection', () => {
    it('sends POST with collectionName', async () => {
      mock.onPost(`${ BASE }/collections/load`).reply({ code: 0, data: {}, message: '' })

      const result = await service.loadCollection('docs')

      expect(result).toEqual({})
      expect(mock.history[0].body).toEqual({ collectionName: 'docs' })
    })
  })

  describe('releaseCollection', () => {
    it('sends POST with collectionName', async () => {
      mock.onPost(`${ BASE }/collections/release`).reply({ code: 0, data: {}, message: '' })

      const result = await service.releaseCollection('docs')

      expect(result).toEqual({})
      expect(mock.history[0].body).toEqual({ collectionName: 'docs' })
    })
  })

  // ── Entities ──

  describe('insertEntities', () => {
    it('sends POST with collectionName and data', async () => {
      const entities = [{ id: 1, vector: [0.1, 0.2] }]
      mock.onPost(`${ BASE }/entities/insert`).reply({ code: 0, data: { insertCount: 1, insertIds: [1] }, message: '' })

      const result = await service.insertEntities('docs', entities)

      expect(result).toEqual({ insertCount: 1, insertIds: [1] })
      expect(mock.history[0].body).toEqual({ collectionName: 'docs', data: entities })
    })

    it('includes partitionName when provided', async () => {
      const entities = [{ id: 1, vector: [0.1] }]
      mock.onPost(`${ BASE }/entities/insert`).reply({ code: 0, data: { insertCount: 1 }, message: '' })

      await service.insertEntities('docs', entities, 'part1')

      expect(mock.history[0].body).toMatchObject({ partitionName: 'part1' })
    })

    it('throws when data is empty array', async () => {
      await expect(service.insertEntities('docs', [])).rejects.toThrow(
        'insertEntities: "Data" must be a non-empty array of entities.'
      )
      expect(mock.history).toHaveLength(0)
    })

    it('throws when data is not an array', async () => {
      await expect(service.insertEntities('docs', 'bad')).rejects.toThrow(
        'insertEntities: "Data" must be a non-empty array of entities.'
      )
    })
  })

  describe('upsertEntities', () => {
    it('sends POST with collectionName and data', async () => {
      const entities = [{ id: 1, vector: [0.1, 0.2] }]
      mock.onPost(`${ BASE }/entities/upsert`).reply({ code: 0, data: { upsertCount: 1, upsertIds: [1] }, message: '' })

      const result = await service.upsertEntities('docs', entities)

      expect(result).toEqual({ upsertCount: 1, upsertIds: [1] })
      expect(mock.history[0].body).toEqual({ collectionName: 'docs', data: entities })
    })

    it('includes partitionName when provided', async () => {
      const entities = [{ id: 1, vector: [0.1] }]
      mock.onPost(`${ BASE }/entities/upsert`).reply({ code: 0, data: { upsertCount: 1 }, message: '' })

      await service.upsertEntities('docs', entities, 'part1')

      expect(mock.history[0].body).toMatchObject({ partitionName: 'part1' })
    })

    it('throws when data is empty array', async () => {
      await expect(service.upsertEntities('docs', [])).rejects.toThrow(
        'upsertEntities: "Data" must be a non-empty array of entities.'
      )
    })
  })

  describe('deleteEntities', () => {
    it('builds a filter from IDs (numeric)', async () => {
      mock.onPost(`${ BASE }/entities/delete`).reply({ code: 0, data: {}, message: '' })

      await service.deleteEntities('docs', [1, 2, 3])

      expect(mock.history[0].body).toEqual({
        collectionName: 'docs',
        filter: 'id in [1,2,3]',
      })
    })

    it('builds a filter from IDs (string)', async () => {
      mock.onPost(`${ BASE }/entities/delete`).reply({ code: 0, data: {}, message: '' })

      await service.deleteEntities('docs', ['a', 'b'])

      expect(mock.history[0].body).toEqual({
        collectionName: 'docs',
        filter: 'id in ["a","b"]',
      })
    })

    it('uses filter expression when no IDs provided', async () => {
      mock.onPost(`${ BASE }/entities/delete`).reply({ code: 0, data: {}, message: '' })

      await service.deleteEntities('docs', undefined, 'color in ["red"]')

      expect(mock.history[0].body).toEqual({
        collectionName: 'docs',
        filter: 'color in ["red"]',
      })
    })

    it('includes partitionName when provided', async () => {
      mock.onPost(`${ BASE }/entities/delete`).reply({ code: 0, data: {}, message: '' })

      await service.deleteEntities('docs', [1], undefined, 'part1')

      expect(mock.history[0].body).toMatchObject({ partitionName: 'part1' })
    })

    it('throws when neither IDs nor filter is provided', async () => {
      await expect(service.deleteEntities('docs')).rejects.toThrow(
        'deleteEntities: provide either "IDs" or a "Filter" expression.'
      )
    })

    it('throws when IDs is empty array and filter is empty', async () => {
      await expect(service.deleteEntities('docs', [], '')).rejects.toThrow(
        'deleteEntities: provide either "IDs" or a "Filter" expression.'
      )
    })
  })

  describe('searchEntities', () => {
    it('sends POST with required fields and defaults', async () => {
      const vectors = [[0.1, 0.2, 0.3]]
      mock.onPost(`${ BASE }/entities/search`).reply({ code: 0, data: [{ id: 1, distance: 0.9 }], message: '' })

      const result = await service.searchEntities('docs', vectors)

      expect(result).toEqual([{ id: 1, distance: 0.9 }])
      expect(mock.history[0].body).toEqual({
        collectionName: 'docs',
        data: vectors,
        limit: 10,
      })
    })

    it('includes all optional fields when provided', async () => {
      const vectors = [[0.1, 0.2]]
      mock.onPost(`${ BASE }/entities/search`).reply({ code: 0, data: [], message: '' })

      await service.searchEntities('docs', vectors, 'embeddings', 5, 'year > 2020', ['title'], 10, { metricType: 'COSINE' })

      expect(mock.history[0].body).toEqual({
        collectionName: 'docs',
        data: vectors,
        annsField: 'embeddings',
        limit: 5,
        filter: 'year > 2020',
        outputFields: ['title'],
        offset: 10,
        searchParams: { metricType: 'COSINE' },
      })
    })

    it('omits optional fields when empty/undefined', async () => {
      const vectors = [[0.1]]
      mock.onPost(`${ BASE }/entities/search`).reply({ code: 0, data: [], message: '' })

      await service.searchEntities('docs', vectors, '', undefined, '  ', [], '', {})

      expect(mock.history[0].body).toEqual({
        collectionName: 'docs',
        data: vectors,
        limit: 10,
      })
    })

    it('throws when data is empty', async () => {
      await expect(service.searchEntities('docs', [])).rejects.toThrow(
        'searchEntities: "Query Vectors" must be a non-empty array of vectors.'
      )
    })
  })

  describe('queryEntities', () => {
    it('sends POST with required fields', async () => {
      mock.onPost(`${ BASE }/entities/query`).reply({ code: 0, data: [{ id: 1, color: 'red' }], message: '' })

      const result = await service.queryEntities('docs', 'color == "red"')

      expect(result).toEqual([{ id: 1, color: 'red' }])
      expect(mock.history[0].body).toEqual({
        collectionName: 'docs',
        filter: 'color == "red"',
      })
    })

    it('includes optional fields when provided', async () => {
      mock.onPost(`${ BASE }/entities/query`).reply({ code: 0, data: [], message: '' })

      await service.queryEntities('docs', 'price < 100', ['id', 'title'], 20, 5)

      expect(mock.history[0].body).toEqual({
        collectionName: 'docs',
        filter: 'price < 100',
        outputFields: ['id', 'title'],
        limit: 20,
        offset: 5,
      })
    })

    it('omits optional fields when empty/undefined', async () => {
      mock.onPost(`${ BASE }/entities/query`).reply({ code: 0, data: [], message: '' })

      await service.queryEntities('docs', 'id > 0', [], '', '')

      expect(mock.history[0].body).toEqual({
        collectionName: 'docs',
        filter: 'id > 0',
      })
    })

    it('throws when filter is empty', async () => {
      await expect(service.queryEntities('docs', '')).rejects.toThrow(
        'queryEntities: a "Filter" expression is required.'
      )
    })

    it('throws when filter is whitespace-only', async () => {
      await expect(service.queryEntities('docs', '   ')).rejects.toThrow(
        'queryEntities: a "Filter" expression is required.'
      )
    })
  })

  describe('getEntities', () => {
    it('sends POST with collectionName and id', async () => {
      mock.onPost(`${ BASE }/entities/get`).reply({ code: 0, data: [{ id: 1, title: 'A' }], message: '' })

      const result = await service.getEntities('docs', [1])

      expect(result).toEqual([{ id: 1, title: 'A' }])
      expect(mock.history[0].body).toEqual({ collectionName: 'docs', id: [1] })
    })

    it('includes outputFields when provided', async () => {
      mock.onPost(`${ BASE }/entities/get`).reply({ code: 0, data: [], message: '' })

      await service.getEntities('docs', [1, 2], ['id', 'title'])

      expect(mock.history[0].body).toEqual({
        collectionName: 'docs',
        id: [1, 2],
        outputFields: ['id', 'title'],
      })
    })

    it('omits outputFields when empty array', async () => {
      mock.onPost(`${ BASE }/entities/get`).reply({ code: 0, data: [], message: '' })

      await service.getEntities('docs', [1], [])

      expect(mock.history[0].body).toEqual({ collectionName: 'docs', id: [1] })
    })

    it('throws when id is empty', async () => {
      await expect(service.getEntities('docs', [])).rejects.toThrow(
        'getEntities: "IDs" must be a non-empty array.'
      )
    })
  })

  // ── Indexes ──

  describe('createIndex', () => {
    it('sends POST with collectionName and indexParams', async () => {
      const indexParams = [{ fieldName: 'vector', indexName: 'vec_idx', indexType: 'AUTOINDEX', metricType: 'COSINE' }]
      mock.onPost(`${ BASE }/indexes/create`).reply({ code: 0, data: {}, message: '' })

      const result = await service.createIndex('docs', indexParams)

      expect(result).toEqual({})
      expect(mock.history[0].body).toEqual({ collectionName: 'docs', indexParams })
    })

    it('throws when indexParams is empty', async () => {
      await expect(service.createIndex('docs', [])).rejects.toThrow(
        'createIndex: "Index Params" must be a non-empty array.'
      )
    })
  })

  describe('describeIndex', () => {
    it('sends POST with collectionName and indexName', async () => {
      const data = [{ fieldName: 'vector', indexName: 'vec_idx', indexType: 'AUTOINDEX' }]
      mock.onPost(`${ BASE }/indexes/describe`).reply({ code: 0, data, message: '' })

      const result = await service.describeIndex('docs', 'vec_idx')

      expect(result).toEqual(data)
      expect(mock.history[0].body).toEqual({ collectionName: 'docs', indexName: 'vec_idx' })
    })
  })

  describe('listIndexes', () => {
    it('sends POST with collectionName', async () => {
      mock.onPost(`${ BASE }/indexes/list`).reply({ code: 0, data: ['vec_idx'], message: '' })

      const result = await service.listIndexes('docs')

      expect(result).toEqual(['vec_idx'])
      expect(mock.history[0].body).toEqual({ collectionName: 'docs' })
    })
  })

  describe('dropIndex', () => {
    it('sends POST with collectionName and indexName', async () => {
      mock.onPost(`${ BASE }/indexes/drop`).reply({ code: 0, data: {}, message: '' })

      const result = await service.dropIndex('docs', 'vec_idx')

      expect(result).toEqual({})
      expect(mock.history[0].body).toEqual({ collectionName: 'docs', indexName: 'vec_idx' })
    })
  })

  // ── Partitions ──

  describe('listPartitions', () => {
    it('sends POST with collectionName', async () => {
      mock.onPost(`${ BASE }/partitions/list`).reply({ code: 0, data: ['_default', '2024'], message: '' })

      const result = await service.listPartitions('docs')

      expect(result).toEqual(['_default', '2024'])
      expect(mock.history[0].body).toEqual({ collectionName: 'docs' })
    })
  })

  describe('createPartition', () => {
    it('sends POST with collectionName and partitionName', async () => {
      mock.onPost(`${ BASE }/partitions/create`).reply({ code: 0, data: {}, message: '' })

      const result = await service.createPartition('docs', '2024')

      expect(result).toEqual({})
      expect(mock.history[0].body).toEqual({ collectionName: 'docs', partitionName: '2024' })
    })
  })

  describe('dropPartition', () => {
    it('sends POST with collectionName and partitionName', async () => {
      mock.onPost(`${ BASE }/partitions/drop`).reply({ code: 0, data: {}, message: '' })

      const result = await service.dropPartition('docs', '2024')

      expect(result).toEqual({})
      expect(mock.history[0].body).toEqual({ collectionName: 'docs', partitionName: '2024' })
    })
  })

  // ── Dictionary ──

  describe('getCollectionsDictionary', () => {
    it('returns sorted items with label and value', async () => {
      mock.onPost(`${ BASE }/collections/list`).reply({ code: 0, data: ['products', 'documents'], message: '' })

      const result = await service.getCollectionsDictionary({})

      expect(result).toEqual({
        items: [
          { label: 'documents', value: 'documents' },
          { label: 'products', value: 'products' },
        ],
        cursor: null,
      })
    })

    it('filters by case-insensitive search', async () => {
      mock.onPost(`${ BASE }/collections/list`).reply({ code: 0, data: ['products', 'documents', 'orders'], message: '' })

      const result = await service.getCollectionsDictionary({ search: 'DOC' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('documents')
    })

    it('handles null payload', async () => {
      mock.onPost(`${ BASE }/collections/list`).reply({ code: 0, data: ['a', 'b'], message: '' })

      const result = await service.getCollectionsDictionary(null)

      expect(result.items).toHaveLength(2)
      expect(result.cursor).toBeNull()
    })

    it('handles non-array data by returning empty items', async () => {
      mock.onPost(`${ BASE }/collections/list`).reply({ code: 0, data: null, message: '' })

      const result = await service.getCollectionsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('propagates API errors', async () => {
      mock.onPost(`${ BASE }/collections/list`).replyWithError({ message: 'Boom' })

      await expect(service.getCollectionsDictionary({})).rejects.toThrow('Milvus API error')
    })
  })
})
