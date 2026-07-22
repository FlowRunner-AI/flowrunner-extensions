'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-pinecone-key'
const CONTROL = 'https://api.pinecone.io'
const INDEX = 'docs-index'
const HOST = 'https://docs-index-abc123.svc.pinecone.io'

describe('Pinecone Service', () => {
  let sandbox
  let service
  let mock

  beforeEach(() => {
    jest.resetModules()

    sandbox = createSandbox({ apiKey: API_KEY })
    require('../src/index.js')

    service = sandbox.getService()
    mock = sandbox.getRequestMock()
  })

  afterEach(() => {
    sandbox.cleanup()
  })

  /** Registers the control-plane lookup used to resolve the data-plane host. */
  function mockHostLookup(indexName = INDEX, host = 'docs-index-abc123.svc.pinecone.io') {
    mock.onGet(`${ CONTROL }/indexes/${ encodeURIComponent(indexName) }`).reply({ name: indexName, host })
  }

  // ── Registration ──

  describe('service registration', () => {
    it('registers the apiKey config item', () => {
      expect(sandbox.getConfigItems()).toEqual([
        expect.objectContaining({
          name: 'apiKey',
          displayName: 'API Key',
          type: 'STRING',
          required: true,
          shared: false,
        }),
      ])
    })
  })

  // ── Auth / request plumbing ──

  describe('request plumbing', () => {
    it('sends the API key, version and content-type headers', async () => {
      mock.onGet(`${ CONTROL }/indexes`).reply({ indexes: [] })

      await service.listIndexes()

      expect(mock.history[0].headers).toMatchObject({
        'Api-Key': API_KEY,
        'X-Pinecone-API-Version': '2025-10',
        'Content-Type': 'application/json',
      })
    })

    it('wraps API errors using the nested error message', async () => {
      mock.onGet(`${ CONTROL }/indexes`).replyWithError({
        message: 'Request failed',
        body: { error: { message: 'Invalid API key' } },
      })

      await expect(service.listIndexes()).rejects.toThrow('Pinecone API error: Invalid API key')
    })

    it('falls back to body.message when there is no nested error', async () => {
      mock.onGet(`${ CONTROL }/indexes`).replyWithError({
        message: 'Request failed',
        body: { message: 'Quota exceeded' },
      })

      await expect(service.listIndexes()).rejects.toThrow('Pinecone API error: Quota exceeded')
    })

    it('falls back to error.message when there is no body', async () => {
      mock.onGet(`${ CONTROL }/indexes`).replyWithError({ message: 'Network timeout' })

      await expect(service.listIndexes()).rejects.toThrow('Pinecone API error: Network timeout')
    })
  })

  // ── Indexes ──

  describe('createIndex', () => {
    it('maps the choice labels and sends the serverless spec', async () => {
      mock.onPost(`${ CONTROL }/indexes`).reply({ name: INDEX })

      const result = await service.createIndex(INDEX, '1536', 'Cosine', 'AWS', 'us-east-1')

      expect(result).toEqual({ name: INDEX })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ CONTROL }/indexes`)

      expect(mock.history[0].body).toEqual({
        name: INDEX,
        dimension: 1536,
        metric: 'cosine',
        spec: { serverless: { cloud: 'aws', region: 'us-east-1' } },
      })
    })

    it('defaults the metric to cosine and passes through unmapped values', async () => {
      mock.onPost(`${ CONTROL }/indexes`).reply({ name: INDEX })

      await service.createIndex(INDEX, 1024, undefined, 'GCP', 'us-central1')

      expect(mock.history[0].body.metric).toBe('cosine')
      expect(mock.history[0].body.spec.serverless.cloud).toBe('gcp')

      mock.reset()
      mock.onPost(`${ CONTROL }/indexes`).reply({ name: INDEX })

      await service.createIndex(INDEX, 1024, 'dotproduct', 'custom-cloud', 'r1')

      expect(mock.history[0].body.metric).toBe('dotproduct')
      expect(mock.history[0].body.spec.serverless.cloud).toBe('custom-cloud')
    })

    it('includes deletion protection and tags when provided', async () => {
      mock.onPost(`${ CONTROL }/indexes`).reply({ name: INDEX })

      await service.createIndex(INDEX, 8, 'Euclidean', 'Azure', 'eastus2', true, { env: 'prod' })

      expect(mock.history[0].body).toMatchObject({
        metric: 'euclidean',
        deletion_protection: 'enabled',
        tags: { env: 'prod' },
        spec: { serverless: { cloud: 'azure', region: 'eastus2' } },
      })
    })

    it('sends disabled deletion protection for false and omits empty tags', async () => {
      mock.onPost(`${ CONTROL }/indexes`).reply({ name: INDEX })

      await service.createIndex(INDEX, 8, 'Cosine', 'AWS', 'us-east-1', false, {})

      expect(mock.history[0].body.deletion_protection).toBe('disabled')
      expect(mock.history[0].body).not.toHaveProperty('tags')
    })
  })

  describe('createIndexForModel', () => {
    it('builds the embed field map with defaults', async () => {
      mock.onPost(`${ CONTROL }/indexes/create-for-model`).reply({ name: 'integrated' })

      await service.createIndexForModel('integrated', 'AWS', 'us-east-1')

      expect(mock.history[0].body).toEqual({
        name: 'integrated',
        cloud: 'aws',
        region: 'us-east-1',
        embed: {
          model: 'multilingual-e5-large',
          field_map: { text: 'text' },
        },
      })
    })

    it('merges extra embed config and the resolved metric', async () => {
      mock.onPost(`${ CONTROL }/indexes/create-for-model`).reply({ name: 'integrated' })

      await service.createIndexForModel(
        'integrated',
        'GCP',
        'us-central1',
        'llama-text-embed-v2',
        'chunk_text',
        'Dot Product',
        { write_parameters: { input_type: 'passage' } }
      )

      expect(mock.history[0].body.embed).toEqual({
        model: 'llama-text-embed-v2',
        field_map: { text: 'chunk_text' },
        write_parameters: { input_type: 'passage' },
        metric: 'dotproduct',
      })
    })
  })

  describe('listIndexes', () => {
    it('returns the index list', async () => {
      mock.onGet(`${ CONTROL }/indexes`).reply({ indexes: [{ name: INDEX }] })

      await expect(service.listIndexes()).resolves.toEqual({ indexes: [{ name: INDEX }] })
      expect(mock.history[0].method).toBe('get')
    })
  })

  describe('describeIndex', () => {
    it('url-encodes the index name', async () => {
      mock.onGet(`${ CONTROL }/indexes/my%20index`).reply({ name: 'my index' })

      await expect(service.describeIndex('my index')).resolves.toEqual({ name: 'my index' })
    })
  })

  describe('configureIndex', () => {
    it('sends a PATCH with the resolved deletion protection', async () => {
      mock.onPatch(`${ CONTROL }/indexes/${ INDEX }`).reply({ name: INDEX })

      await service.configureIndex(INDEX, 'Enabled')

      expect(mock.history[0].method).toBe('patch')
      expect(mock.history[0].body).toEqual({ deletion_protection: 'enabled' })
    })

    it('sends tags only', async () => {
      mock.onPatch(`${ CONTROL }/indexes/${ INDEX }`).reply({ name: INDEX })

      await service.configureIndex(INDEX, undefined, { team: 'search' })

      expect(mock.history[0].body).toEqual({ tags: { team: 'search' } })
    })

    it('throws when nothing to change is provided', async () => {
      await expect(service.configureIndex(INDEX)).rejects.toThrow(
        'Configure Index requires at least one of Deletion Protection or Tags.'
      )

      expect(mock.history).toHaveLength(0)
    })
  })

  describe('deleteIndex', () => {
    it('deletes the index and returns a success payload', async () => {
      mock.onDelete(`${ CONTROL }/indexes/${ INDEX }`).reply('')

      await expect(service.deleteIndex(INDEX)).resolves.toEqual({ success: true, indexName: INDEX })
      expect(mock.history[0].method).toBe('delete')
    })

    it('evicts the cached data-plane host', async () => {
      mockHostLookup()
      mock.onPost(`${ HOST }/vectors/upsert`).reply({ upsertedCount: 1 })
      mock.onDelete(`${ CONTROL }/indexes/${ INDEX }`).reply('')

      await service.upsertVectors(INDEX, [{ id: 'a', values: [1] }])
      await service.deleteIndex(INDEX)
      await service.upsertVectors(INDEX, [{ id: 'a', values: [1] }])

      const lookups = mock.history.filter(call => call.url === `${ CONTROL }/indexes/${ INDEX }` && call.method === 'get')

      expect(lookups).toHaveLength(2)
    })
  })

  // ── Host resolution ──

  describe('data-plane host resolution', () => {
    it('caches the host between calls', async () => {
      mockHostLookup()
      mock.onPost(`${ HOST }/describe_index_stats`).reply({ totalVectorCount: 0 })

      await service.describeIndexStats(INDEX)
      await service.describeIndexStats(INDEX)

      expect(mock.history.filter(call => call.method === 'get')).toHaveLength(1)
      expect(mock.history).toHaveLength(3)
    })

    it('throws when the index name is missing', async () => {
      await expect(service.describeIndexStats('')).rejects.toThrow('Index Name is required.')
    })

    it('throws when the index has no host', async () => {
      mock.onGet(`${ CONTROL }/indexes/${ INDEX }`).reply({ name: INDEX })

      await expect(service.describeIndexStats(INDEX)).rejects.toThrow(
        `Unable to resolve the data-plane host for index "${ INDEX }".`
      )
    })
  })

  // ── Vectors ──

  describe('upsertVectors', () => {
    it('sends the vectors to the data plane', async () => {
      mockHostLookup()
      mock.onPost(`${ HOST }/vectors/upsert`).reply({ upsertedCount: 2 })

      const vectors = [{ id: 'a', values: [0.1] }, { id: 'b', values: [0.2] }]
      const result = await service.upsertVectors(INDEX, vectors, 'ns1')

      expect(result).toEqual({ upsertedCount: 2 })
      expect(mock.history[1].body).toEqual({ vectors, namespace: 'ns1' })
    })

    it('omits the namespace when not provided', async () => {
      mockHostLookup()
      mock.onPost(`${ HOST }/vectors/upsert`).reply({ upsertedCount: 1 })

      await service.upsertVectors(INDEX, [{ id: 'a', values: [0.1] }])

      expect(mock.history[1].body).not.toHaveProperty('namespace')
    })

    it('throws on an empty vector array', async () => {
      await expect(service.upsertVectors(INDEX, [])).rejects.toThrow('Vectors must be a non-empty array.')
      await expect(service.upsertVectors(INDEX, null)).rejects.toThrow('Vectors must be a non-empty array.')
    })
  })

  describe('queryVectors', () => {
    it('queries by vector with defaults', async () => {
      mockHostLookup()
      mock.onPost(`${ HOST }/query`).reply({ matches: [] })

      await service.queryVectors(INDEX, ['0.1', '0.2'])

      expect(mock.history[1].body).toEqual({
        topK: 10,
        includeMetadata: true,
        includeValues: false,
        vector: [0.1, 0.2],
      })
    })

    it('queries by id with filter, namespace and overrides', async () => {
      mockHostLookup()
      mock.onPost(`${ HOST }/query`).reply({ matches: [] })

      await service.queryVectors(INDEX, null, 'vec-1', '5', { genre: 'docs' }, false, true, 'ns1')

      expect(mock.history[1].body).toEqual({
        topK: 5,
        includeMetadata: false,
        includeValues: true,
        id: 'vec-1',
        filter: { genre: 'docs' },
        namespace: 'ns1',
      })
    })

    it('throws when neither vector nor id is given', async () => {
      await expect(service.queryVectors(INDEX)).rejects.toThrow(
        'Provide either Query Vector values or a Vector ID.'
      )
    })

    it('throws when both vector and id are given', async () => {
      await expect(service.queryVectors(INDEX, [0.1], 'vec-1')).rejects.toThrow(
        'Provide either Query Vector values or a Vector ID, not both.'
      )
    })
  })

  describe('fetchVectors', () => {
    it('sends the ids as query parameters', async () => {
      mockHostLookup()
      mock.onGet(`${ HOST }/vectors/fetch`).reply({ vectors: {} })

      await service.fetchVectors(INDEX, ['a', 'b'], 'ns1')

      expect(mock.history[1].method).toBe('get')
      expect(mock.history[1].query).toEqual({ ids: ['a', 'b'], namespace: 'ns1' })
    })

    it('throws on an empty id array', async () => {
      await expect(service.fetchVectors(INDEX, [])).rejects.toThrow('Vector IDs must be a non-empty array.')
    })
  })

  describe('updateVector', () => {
    it('updates values and metadata', async () => {
      mockHostLookup()
      mock.onPost(`${ HOST }/vectors/update`).reply({})

      const result = await service.updateVector(INDEX, 'vec-1', ['1', '2'], { genre: 'docs' }, 'ns1')

      expect(result).toEqual({ success: true, id: 'vec-1' })

      expect(mock.history[1].body).toEqual({
        id: 'vec-1',
        values: [1, 2],
        setMetadata: { genre: 'docs' },
        namespace: 'ns1',
      })
    })

    it('updates metadata only', async () => {
      mockHostLookup()
      mock.onPost(`${ HOST }/vectors/update`).reply({})

      await service.updateVector(INDEX, 'vec-1', [], { genre: 'docs' })

      expect(mock.history[1].body).toEqual({ id: 'vec-1', setMetadata: { genre: 'docs' } })
    })

    it('throws when nothing is provided to update', async () => {
      await expect(service.updateVector(INDEX, 'vec-1')).rejects.toThrow(
        'Provide New Values and/or Set Metadata to update the vector.'
      )
    })
  })

  describe('deleteVectors', () => {
    it('deletes by ids', async () => {
      mockHostLookup()
      mock.onPost(`${ HOST }/vectors/delete`).reply({})

      const result = await service.deleteVectors(INDEX, ['a', 'b'], false, null, 'ns1')

      expect(result).toEqual({ success: true })
      expect(mock.history[1].body).toEqual({ ids: ['a', 'b'], namespace: 'ns1' })
    })

    it('deletes all', async () => {
      mockHostLookup()
      mock.onPost(`${ HOST }/vectors/delete`).reply({})

      await service.deleteVectors(INDEX, [], true)

      expect(mock.history[1].body).toEqual({ deleteAll: true })
    })

    it('deletes by filter', async () => {
      mockHostLookup()
      mock.onPost(`${ HOST }/vectors/delete`).reply({})

      await service.deleteVectors(INDEX, null, false, { genre: 'docs' })

      expect(mock.history[1].body).toEqual({ filter: { genre: 'docs' } })
    })

    it('throws when no deletion criteria are given', async () => {
      await expect(service.deleteVectors(INDEX)).rejects.toThrow(
        'Provide Vector IDs, a Metadata Filter, or enable Delete All.'
      )
    })
  })

  describe('listVectorIds', () => {
    it('sends all optional query parameters', async () => {
      mockHostLookup()
      mock.onGet(`${ HOST }/vectors/list`).reply({ vectors: [] })

      await service.listVectorIds(INDEX, 'doc#', '50', 'token-1', 'ns1')

      expect(mock.history[1].query).toEqual({
        prefix: 'doc#',
        limit: 50,
        paginationToken: 'token-1',
        namespace: 'ns1',
      })
    })

    it('sends an empty query when nothing is provided', async () => {
      mockHostLookup()
      mock.onGet(`${ HOST }/vectors/list`).reply({ vectors: [] })

      await service.listVectorIds(INDEX)

      expect(mock.history[1].query).toEqual({})
    })
  })

  describe('describeIndexStats', () => {
    it('posts an empty body without a filter', async () => {
      mockHostLookup()
      mock.onPost(`${ HOST }/describe_index_stats`).reply({ totalVectorCount: 5 })

      await expect(service.describeIndexStats(INDEX)).resolves.toEqual({ totalVectorCount: 5 })
      expect(mock.history[1].body).toEqual({})
    })

    it('posts the filter when provided', async () => {
      mockHostLookup()
      mock.onPost(`${ HOST }/describe_index_stats`).reply({ totalVectorCount: 5 })

      await service.describeIndexStats(INDEX, { genre: 'docs' })

      expect(mock.history[1].body).toEqual({ filter: { genre: 'docs' } })
    })
  })

  // ── Records ──

  describe('upsertRecords', () => {
    it('sends NDJSON to the default namespace', async () => {
      mockHostLookup()
      mock.onPost(`${ HOST }/records/namespaces/__default__/upsert`).reply('')

      const records = [{ _id: '1', chunk_text: 'a' }, { _id: '2', chunk_text: 'b' }]
      const result = await service.upsertRecords(INDEX, records)

      expect(result).toEqual({ success: true, upsertedCount: 2, namespace: '__default__' })
      expect(mock.history[1].body).toBe(records.map(r => JSON.stringify(r)).join('\n'))
      expect(mock.history[1].headers['Content-Type']).toBe('application/x-ndjson')
    })

    it('url-encodes a custom namespace', async () => {
      mockHostLookup()
      mock.onPost(`${ HOST }/records/namespaces/my%20ns/upsert`).reply('')

      const result = await service.upsertRecords(INDEX, [{ _id: '1' }], 'my ns')

      expect(result.namespace).toBe('my ns')
    })

    it('throws on an empty record array', async () => {
      await expect(service.upsertRecords(INDEX, [])).rejects.toThrow('Records must be a non-empty array.')
    })
  })

  describe('searchRecords', () => {
    it('builds a minimal search body', async () => {
      mockHostLookup()
      mock.onPost(`${ HOST }/records/namespaces/__default__/search`).reply({ result: { hits: [] } })

      await service.searchRecords(INDEX, 'hello')

      expect(mock.history[1].body).toEqual({
        query: { top_k: 10, inputs: { text: 'hello' } },
      })
    })

    it('includes filter, fields and rerank options', async () => {
      mockHostLookup()
      mock.onPost(`${ HOST }/records/namespaces/ns1/search`).reply({ result: { hits: [] } })

      await service.searchRecords(
        INDEX,
        'hello',
        '5',
        { genre: 'docs' },
        ['chunk_text'],
        'bge-reranker-v2-m3',
        '3',
        ['chunk_text'],
        'ns1'
      )

      expect(mock.history[1].body).toEqual({
        query: { top_k: 5, inputs: { text: 'hello' }, filter: { genre: 'docs' } },
        fields: ['chunk_text'],
        rerank: { model: 'bge-reranker-v2-m3', top_n: 3, rank_fields: ['chunk_text'] },
      })
    })

    it('defaults rerank top_n to top_k', async () => {
      mockHostLookup()
      mock.onPost(`${ HOST }/records/namespaces/__default__/search`).reply({ result: { hits: [] } })

      await service.searchRecords(INDEX, 'hello', 7, null, null, 'bge-reranker-v2-m3')

      expect(mock.history[1].body.rerank).toEqual({ model: 'bge-reranker-v2-m3', top_n: 7 })
    })

    it('throws when the query text is missing', async () => {
      await expect(service.searchRecords(INDEX, '')).rejects.toThrow('Query Text is required.')
    })
  })

  // ── Namespaces ──

  describe('listNamespaces', () => {
    it('sends limit and pagination token', async () => {
      mockHostLookup()
      mock.onGet(`${ HOST }/namespaces`).reply({ namespaces: [] })

      await service.listNamespaces(INDEX, '25', 'token-1')

      expect(mock.history[1].query).toEqual({ limit: 25, paginationToken: 'token-1' })
    })

    it('sends an empty query by default', async () => {
      mockHostLookup()
      mock.onGet(`${ HOST }/namespaces`).reply({ namespaces: [] })

      await service.listNamespaces(INDEX)

      expect(mock.history[1].query).toEqual({})
    })
  })

  describe('deleteNamespace', () => {
    it('deletes the namespace', async () => {
      mockHostLookup()
      mock.onDelete(`${ HOST }/namespaces/ns1`).reply('')

      await expect(service.deleteNamespace(INDEX, 'ns1')).resolves.toEqual({ success: true, namespace: 'ns1' })
    })

    it('throws when the namespace is missing', async () => {
      await expect(service.deleteNamespace(INDEX)).rejects.toThrow('Namespace is required.')
    })
  })

  // ── Inference ──

  describe('createEmbeddings', () => {
    it('wraps inputs and applies default parameters', async () => {
      mock.onPost(`${ CONTROL }/embed`).reply({ data: [] })

      await service.createEmbeddings(null, ['hello', 42])

      expect(mock.history[0].body).toEqual({
        model: 'multilingual-e5-large',
        inputs: [{ text: 'hello' }, { text: '42' }],
        parameters: { input_type: 'passage', truncate: 'END' },
      })
    })

    it('resolves the input type and truncate labels', async () => {
      mock.onPost(`${ CONTROL }/embed`).reply({ data: [] })

      await service.createEmbeddings('llama-text-embed-v2', ['hi'], 'Query', 'None')

      expect(mock.history[0].body).toMatchObject({
        model: 'llama-text-embed-v2',
        parameters: { input_type: 'query', truncate: 'NONE' },
      })
    })

    it('throws on empty inputs', async () => {
      await expect(service.createEmbeddings('m', [])).rejects.toThrow(
        'Inputs must be a non-empty array of texts.'
      )
    })
  })

  describe('rerankDocuments', () => {
    it('normalizes string documents and applies defaults', async () => {
      mock.onPost(`${ CONTROL }/rerank`).reply({ data: [] })

      await service.rerankDocuments(null, 'question', ['a', { text: 'b' }])

      expect(mock.history[0].body).toEqual({
        model: 'bge-reranker-v2-m3',
        query: 'question',
        documents: [{ text: 'a' }, { text: 'b' }],
        return_documents: true,
      })
    })

    it('includes top_n, rank fields and return_documents=false', async () => {
      mock.onPost(`${ CONTROL }/rerank`).reply({ data: [] })

      await service.rerankDocuments('custom-model', 'q', ['a'], '2', ['text'], false)

      expect(mock.history[0].body).toMatchObject({
        model: 'custom-model',
        top_n: 2,
        rank_fields: ['text'],
        return_documents: false,
      })
    })

    it('throws on empty documents', async () => {
      await expect(service.rerankDocuments('m', 'q', [])).rejects.toThrow(
        'Documents must be a non-empty array.'
      )
    })
  })

  // ── Dictionaries ──

  describe('getIndexesDictionary', () => {
    it('maps and sorts the indexes', async () => {
      mock.onGet(`${ CONTROL }/indexes`).reply({
        indexes: [
          { name: 'zeta', dimension: 1024, metric: 'cosine', status: { state: 'Ready' } },
          { name: 'alpha', dimension: 1536, metric: 'euclidean', status: { state: 'Ready' } },
        ],
      })

      const result = await service.getIndexesDictionary({})

      expect(result).toEqual({
        cursor: null,
        items: [
          { label: 'alpha', value: 'alpha', note: '1536d · euclidean · Ready' },
          { label: 'zeta', value: 'zeta', note: '1024d · cosine · Ready' },
        ],
      })
    })

    it('filters case-insensitively by search', async () => {
      mock.onGet(`${ CONTROL }/indexes`).reply({
        indexes: [{ name: 'alpha' }, { name: 'beta' }],
      })

      const result = await service.getIndexesDictionary({ search: 'ALP' })

      expect(result.items).toEqual([{ label: 'alpha', value: 'alpha', note: '' }])
    })

    it('handles a null payload and a missing index list', async () => {
      mock.onGet(`${ CONTROL }/indexes`).reply({})

      await expect(service.getIndexesDictionary(null)).resolves.toEqual({ items: [], cursor: null })
    })
  })

  describe('getNamespacesDictionary', () => {
    it('returns an empty result without an index criteria', async () => {
      await expect(service.getNamespacesDictionary({})).resolves.toEqual({ items: [], cursor: null })
      expect(mock.history).toHaveLength(0)
    })

    it('maps namespaces and the next cursor', async () => {
      mockHostLookup()

      mock.onGet(`${ HOST }/namespaces`).reply({
        namespaces: [{ name: 'ns1', record_count: 12 }, { name: 'ns2' }],
        pagination: { next: 'token-2' },
      })

      const result = await service.getNamespacesDictionary({ criteria: { indexName: INDEX } })

      expect(mock.history[1].query).toEqual({ limit: 100 })

      expect(result).toEqual({
        cursor: 'token-2',
        items: [
          { label: 'ns1', value: 'ns1', note: '12 records' },
          { label: 'ns2', value: 'ns2', note: undefined },
        ],
      })
    })

    it('passes the cursor as a pagination token and filters by search', async () => {
      mockHostLookup()
      mock.onGet(`${ HOST }/namespaces`).reply({ namespaces: [{ name: 'alpha' }, { name: 'beta' }] })

      const result = await service.getNamespacesDictionary({
        search: 'BET',
        cursor: 'token-1',
        criteria: { indexName: INDEX },
      })

      expect(mock.history[1].query).toEqual({ limit: 100, paginationToken: 'token-1' })
      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('beta')
      expect(result.cursor).toBeNull()
    })

    it('handles a missing namespaces list', async () => {
      mockHostLookup()
      mock.onGet(`${ HOST }/namespaces`).reply({})

      await expect(
        service.getNamespacesDictionary({ criteria: { indexName: INDEX } })
      ).resolves.toEqual({ items: [], cursor: null })
    })
  })
})
