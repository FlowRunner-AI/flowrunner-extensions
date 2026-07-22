'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-qdrant-api-key'
const BASE = 'https://qdrant.example.com:6333'

describe('Qdrant Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ url: `${BASE}/`, apiKey: API_KEY })
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
          expect.objectContaining({ name: 'url', required: true, shared: false }),
          expect.objectContaining({ name: 'apiKey', required: false, shared: false }),
        ])
      )
    })

    it('strips trailing slashes from the URL', () => {
      // The constructor was called with 'https://qdrant.example.com:6333/'
      // and should have stripped the trailing slash. We verify by checking
      // that requests go to the correct URL without double slashes.
      mock.onGet(`${BASE}/collections`).reply({ result: { collections: [] } })

      return service.listCollections().then(() => {
        expect(mock.history[0].url).toBe(`${BASE}/collections`)
      })
    })
  })

  // ── Collections ──

  describe('createCollection', () => {
    it('sends PUT with vector size and distance metric', async () => {
      mock.onPut(`${BASE}/collections/test-col`).reply({ result: true })

      const result = await service.createCollection('test-col', 1536, 'Cosine', undefined, undefined)

      expect(result).toBe(true)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].headers).toMatchObject({
        'Content-Type': 'application/json',
        'api-key': API_KEY,
      })
      expect(mock.history[0].body).toEqual({
        vectors: { size: 1536, distance: 'Cosine' },
      })
    })

    it('resolves friendly distance names to API values', async () => {
      mock.onPut(`${BASE}/collections/test-col`).reply({ result: true })

      await service.createCollection('test-col', 768, 'Dot Product', undefined, undefined)

      expect(mock.history[0].body.vectors.distance).toBe('Dot')
    })

    it('sets on_disk_payload when provided', async () => {
      mock.onPut(`${BASE}/collections/test-col`).reply({ result: true })

      await service.createCollection('test-col', 512, 'Euclidean', true, undefined)

      expect(mock.history[0].body).toMatchObject({
        vectors: { size: 512, distance: 'Euclid' },
        on_disk_payload: true,
      })
    })

    it('merges advanced configuration', async () => {
      mock.onPut(`${BASE}/collections/test-col`).reply({ result: true })

      const advancedConfig = {
        vectors: { text: { size: 768, distance: 'Cosine' } },
        hnsw_config: { m: 16 },
      }

      await service.createCollection('test-col', 512, 'Cosine', undefined, advancedConfig)

      // Advanced config overrides vectors
      expect(mock.history[0].body.vectors).toEqual({ text: { size: 768, distance: 'Cosine' } })
      expect(mock.history[0].body.hnsw_config).toEqual({ m: 16 })
    })

    it('throws when no vectors defined', async () => {
      await expect(
        service.createCollection('test-col', undefined, undefined, undefined, undefined)
      ).rejects.toThrow('provide "Vector Size" or define vectors in "Advanced Configuration"')
    })

    it('allows creating with only sparse_vectors in advanced config', async () => {
      mock.onPut(`${BASE}/collections/test-col`).reply({ result: true })

      await service.createCollection('test-col', undefined, undefined, undefined, {
        sparse_vectors: { text: {} },
      })

      expect(mock.history[0].body).toEqual({ sparse_vectors: { text: {} } })
    })

    it('encodes collection name in URL', async () => {
      mock.onPut(`${BASE}/collections/my%20collection`).reply({ result: true })

      await service.createCollection('my collection', 128, 'Cosine', undefined, undefined)

      expect(mock.history[0].url).toBe(`${BASE}/collections/my%20collection`)
    })
  })

  describe('listCollections', () => {
    it('sends GET to /collections', async () => {
      mock.onGet(`${BASE}/collections`).reply({ result: { collections: [{ name: 'docs' }] } })

      const result = await service.listCollections()

      expect(result).toEqual({ collections: [{ name: 'docs' }] })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
    })
  })

  describe('getCollection', () => {
    it('sends GET with collection name', async () => {
      mock.onGet(`${BASE}/collections/docs`).reply({
        result: { status: 'green', points_count: 100 },
      })

      const result = await service.getCollection('docs')

      expect(result).toEqual({ status: 'green', points_count: 100 })
    })
  })

  describe('deleteCollection', () => {
    it('sends DELETE with collection name', async () => {
      mock.onDelete(`${BASE}/collections/docs`).reply({ result: true })

      const result = await service.deleteCollection('docs')

      expect(result).toBe(true)
      expect(mock.history[0].method).toBe('delete')
    })
  })

  describe('collectionExists', () => {
    it('sends GET to /collections/{name}/exists', async () => {
      mock.onGet(`${BASE}/collections/docs/exists`).reply({ result: { exists: true } })

      const result = await service.collectionExists('docs')

      expect(result).toEqual({ exists: true })
    })
  })

  // ── Points ──

  describe('upsertPoints', () => {
    it('sends PUT with normalized point IDs and wait=true', async () => {
      mock.onPut(`${BASE}/collections/docs/points`).reply({
        result: { operation_id: 42, status: 'completed' },
      })

      const points = [
        { id: '1', vector: [0.1, 0.2], payload: { city: 'Berlin' } },
        { id: 'abc-uuid', vector: [0.3, 0.4], payload: { city: 'Munich' } },
      ]

      const result = await service.upsertPoints('docs', points)

      expect(result).toEqual({ operation_id: 42, status: 'completed' })
      expect(mock.history[0].query).toMatchObject({ wait: 'true' })
      expect(mock.history[0].body.points[0].id).toBe(1) // numeric string -> number
      expect(mock.history[0].body.points[1].id).toBe('abc-uuid') // UUID stays string
    })

    it('handles null points array', async () => {
      mock.onPut(`${BASE}/collections/docs/points`).reply({
        result: { operation_id: 1, status: 'completed' },
      })

      await service.upsertPoints('docs', null)

      expect(mock.history[0].body).toEqual({ points: [] })
    })
  })

  describe('getPoints', () => {
    it('sends POST with IDs and default payload/vector flags', async () => {
      mock.onPost(`${BASE}/collections/docs/points`).reply({
        result: [{ id: 1, payload: { city: 'Berlin' } }],
      })

      const result = await service.getPoints('docs', ['1', 'abc-uuid'], undefined, undefined)

      expect(result).toEqual([{ id: 1, payload: { city: 'Berlin' } }])
      expect(mock.history[0].body).toEqual({
        ids: [1, 'abc-uuid'],
        with_payload: true,
        with_vector: false,
      })
    })

    it('includes vectors when withVector is true', async () => {
      mock.onPost(`${BASE}/collections/docs/points`).reply({ result: [] })

      await service.getPoints('docs', ['1'], true, true)

      expect(mock.history[0].body.with_payload).toBe(true)
      expect(mock.history[0].body.with_vector).toBe(true)
    })

    it('disables payload when withPayload is false', async () => {
      mock.onPost(`${BASE}/collections/docs/points`).reply({ result: [] })

      await service.getPoints('docs', ['1'], false, false)

      expect(mock.history[0].body.with_payload).toBe(false)
      expect(mock.history[0].body.with_vector).toBe(false)
    })
  })

  describe('deletePoints', () => {
    it('sends POST with point IDs selector', async () => {
      mock.onPost(`${BASE}/collections/docs/points/delete`).reply({
        result: { operation_id: 43, status: 'completed' },
      })

      const result = await service.deletePoints('docs', ['1', '2'], undefined)

      expect(result).toEqual({ operation_id: 43, status: 'completed' })
      expect(mock.history[0].query).toMatchObject({ wait: 'true' })
      expect(mock.history[0].body).toEqual({ points: [1, 2] })
    })

    it('sends POST with filter selector', async () => {
      mock.onPost(`${BASE}/collections/docs/points/delete`).reply({
        result: { operation_id: 44, status: 'completed' },
      })

      const filter = { must: [{ key: 'city', match: { value: 'Berlin' } }] }

      await service.deletePoints('docs', [], filter)

      expect(mock.history[0].body).toEqual({ filter })
    })

    it('throws when neither IDs nor filter provided', async () => {
      await expect(service.deletePoints('docs', [], {})).rejects.toThrow(
        'either "Point IDs" or "Filter" must be provided'
      )
    })
  })

  describe('queryPoints', () => {
    it('sends POST with query vector', async () => {
      mock.onPost(`${BASE}/collections/docs/points/query`).reply({
        result: { points: [{ id: 1, score: 0.98 }] },
      })

      const result = await service.queryPoints(
        'docs', [0.1, 0.2, 0.3], undefined, undefined, 5, 0.5, 'text', true, true, 10
      )

      expect(result).toEqual({ points: [{ id: 1, score: 0.98 }] })
      expect(mock.history[0].body).toEqual({
        query: [0.1, 0.2, 0.3],
        with_payload: true,
        with_vector: true,
        limit: 5,
        offset: 10,
        score_threshold: 0.5,
        using: 'text',
      })
    })

    it('sends POST with query point ID', async () => {
      mock.onPost(`${BASE}/collections/docs/points/query`).reply({
        result: { points: [] },
      })

      await service.queryPoints(
        'docs', undefined, '42', undefined, undefined, undefined, undefined, undefined, undefined, undefined
      )

      expect(mock.history[0].body.query).toBe(42) // numeric string normalized
    })

    it('sends POST with UUID query point ID', async () => {
      mock.onPost(`${BASE}/collections/docs/points/query`).reply({
        result: { points: [] },
      })

      await service.queryPoints(
        'docs', undefined, 'abc-uuid', undefined, undefined, undefined, undefined, undefined, undefined, undefined
      )

      expect(mock.history[0].body.query).toBe('abc-uuid')
    })

    it('includes filter when provided', async () => {
      mock.onPost(`${BASE}/collections/docs/points/query`).reply({
        result: { points: [] },
      })

      const filter = { must: [{ key: 'city', match: { value: 'Berlin' } }] }

      await service.queryPoints(
        'docs', [0.1], undefined, filter, undefined, undefined, undefined, undefined, undefined, undefined
      )

      expect(mock.history[0].body.filter).toEqual(filter)
    })

    it('omits optional fields when not provided', async () => {
      mock.onPost(`${BASE}/collections/docs/points/query`).reply({
        result: { points: [] },
      })

      await service.queryPoints(
        'docs', [0.1], undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined
      )

      const body = mock.history[0].body

      expect(body).toEqual({
        query: [0.1],
        with_payload: true,
        with_vector: false,
      })
      expect(body).not.toHaveProperty('filter')
      expect(body).not.toHaveProperty('limit')
      expect(body).not.toHaveProperty('offset')
      expect(body).not.toHaveProperty('score_threshold')
      expect(body).not.toHaveProperty('using')
    })

    it('throws when neither vector nor point ID provided', async () => {
      await expect(
        service.queryPoints('docs', undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined)
      ).rejects.toThrow('either "Query Vector" or "Query Point ID" must be provided')
    })

    it('throws when empty vector and empty point ID provided', async () => {
      await expect(
        service.queryPoints('docs', [], '', undefined, undefined, undefined, undefined, undefined, undefined, undefined)
      ).rejects.toThrow('either "Query Vector" or "Query Point ID" must be provided')
    })
  })

  describe('batchQueryPoints', () => {
    it('sends POST with searches array', async () => {
      mock.onPost(`${BASE}/collections/docs/points/query/batch`).reply({
        result: [{ points: [{ id: 1, score: 0.9 }] }],
      })

      const searches = [{ query: [0.1, 0.2], limit: 3, with_payload: true }]

      const result = await service.batchQueryPoints('docs', searches)

      expect(result).toEqual([{ points: [{ id: 1, score: 0.9 }] }])
      expect(mock.history[0].body).toEqual({ searches })
    })

    it('handles null searches', async () => {
      mock.onPost(`${BASE}/collections/docs/points/query/batch`).reply({ result: [] })

      await service.batchQueryPoints('docs', null)

      expect(mock.history[0].body).toEqual({ searches: [] })
    })
  })

  describe('scrollPoints', () => {
    it('sends POST with defaults', async () => {
      mock.onPost(`${BASE}/collections/docs/points/scroll`).reply({
        result: { points: [{ id: 1 }], next_page_offset: 2 },
      })

      const result = await service.scrollPoints('docs', undefined, undefined, undefined, undefined, undefined)

      expect(result).toEqual({ points: [{ id: 1 }], next_page_offset: 2 })
      expect(mock.history[0].body).toEqual({
        with_payload: true,
        with_vector: false,
      })
    })

    it('includes filter, limit, and offset', async () => {
      mock.onPost(`${BASE}/collections/docs/points/scroll`).reply({
        result: { points: [], next_page_offset: null },
      })

      const filter = { must: [{ key: 'color', match: { value: 'red' } }] }

      await service.scrollPoints('docs', filter, 20, '5', true, true)

      expect(mock.history[0].body).toEqual({
        with_payload: true,
        with_vector: true,
        filter,
        limit: 20,
        offset: 5, // numeric string normalized
      })
    })

    it('does not include offset when empty string', async () => {
      mock.onPost(`${BASE}/collections/docs/points/scroll`).reply({
        result: { points: [], next_page_offset: null },
      })

      await service.scrollPoints('docs', undefined, undefined, '', undefined, undefined)

      expect(mock.history[0].body).not.toHaveProperty('offset')
    })
  })

  describe('countPoints', () => {
    it('sends POST with exact=true by default', async () => {
      mock.onPost(`${BASE}/collections/docs/points/count`).reply({
        result: { count: 500 },
      })

      const result = await service.countPoints('docs', undefined, undefined)

      expect(result).toEqual({ count: 500 })
      expect(mock.history[0].body).toEqual({ exact: true })
    })

    it('sends exact=false when disabled', async () => {
      mock.onPost(`${BASE}/collections/docs/points/count`).reply({
        result: { count: 500 },
      })

      await service.countPoints('docs', undefined, false)

      expect(mock.history[0].body).toEqual({ exact: false })
    })

    it('includes filter when provided', async () => {
      mock.onPost(`${BASE}/collections/docs/points/count`).reply({
        result: { count: 10 },
      })

      const filter = { must: [{ key: 'city', match: { value: 'Berlin' } }] }

      await service.countPoints('docs', filter, true)

      expect(mock.history[0].body).toEqual({ exact: true, filter })
    })
  })

  // ── Payload ──

  describe('setPayload', () => {
    it('sends POST with payload and point IDs', async () => {
      mock.onPost(`${BASE}/collections/docs/points/payload`).reply({
        result: { operation_id: 44, status: 'completed' },
      })

      const result = await service.setPayload('docs', { status: 'processed' }, ['1'], undefined)

      expect(result).toEqual({ operation_id: 44, status: 'completed' })
      expect(mock.history[0].query).toMatchObject({ wait: 'true' })
      expect(mock.history[0].body).toEqual({
        payload: { status: 'processed' },
        points: [1],
      })
    })

    it('sends POST with payload and filter', async () => {
      mock.onPost(`${BASE}/collections/docs/points/payload`).reply({
        result: { operation_id: 45, status: 'completed' },
      })

      const filter = { must: [{ key: 'city', match: { value: 'Berlin' } }] }

      await service.setPayload('docs', { score: 0.9 }, [], filter)

      expect(mock.history[0].body).toEqual({
        payload: { score: 0.9 },
        filter,
      })
    })

    it('throws when neither IDs nor filter', async () => {
      await expect(service.setPayload('docs', { x: 1 }, [], {})).rejects.toThrow(
        'either "Point IDs" or "Filter" must be provided'
      )
    })
  })

  describe('overwritePayload', () => {
    it('sends PUT with payload and point IDs', async () => {
      mock.onPut(`${BASE}/collections/docs/points/payload`).reply({
        result: { operation_id: 45, status: 'completed' },
      })

      const result = await service.overwritePayload('docs', { status: 'archived' }, ['1'], undefined)

      expect(result).toEqual({ operation_id: 45, status: 'completed' })
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].body).toEqual({
        payload: { status: 'archived' },
        points: [1],
      })
    })
  })

  describe('deletePayloadKeys', () => {
    it('sends POST with keys and point IDs', async () => {
      mock.onPost(`${BASE}/collections/docs/points/payload/delete`).reply({
        result: { operation_id: 46, status: 'completed' },
      })

      const result = await service.deletePayloadKeys('docs', ['color', 'price'], ['1'], undefined)

      expect(result).toEqual({ operation_id: 46, status: 'completed' })
      expect(mock.history[0].query).toMatchObject({ wait: 'true' })
      expect(mock.history[0].body).toEqual({
        keys: ['color', 'price'],
        points: [1],
      })
    })

    it('defaults to empty keys array when null', async () => {
      mock.onPost(`${BASE}/collections/docs/points/payload/delete`).reply({
        result: { operation_id: 46, status: 'completed' },
      })

      await service.deletePayloadKeys('docs', null, ['1'], undefined)

      expect(mock.history[0].body.keys).toEqual([])
    })
  })

  describe('clearPayload', () => {
    it('sends POST with point IDs selector', async () => {
      mock.onPost(`${BASE}/collections/docs/points/payload/clear`).reply({
        result: { operation_id: 47, status: 'completed' },
      })

      const result = await service.clearPayload('docs', ['1', '2'], undefined)

      expect(result).toEqual({ operation_id: 47, status: 'completed' })
      expect(mock.history[0].query).toMatchObject({ wait: 'true' })
      expect(mock.history[0].body).toEqual({ points: [1, 2] })
    })

    it('sends POST with filter selector', async () => {
      mock.onPost(`${BASE}/collections/docs/points/payload/clear`).reply({
        result: { operation_id: 48, status: 'completed' },
      })

      const filter = { must: [{ key: 'status', match: { value: 'old' } }] }

      await service.clearPayload('docs', [], filter)

      expect(mock.history[0].body).toEqual({ filter })
    })
  })

  // ── Dictionary ──

  describe('getCollectionsDictionary', () => {
    it('returns mapped items with label and value', async () => {
      mock.onGet(`${BASE}/collections`).reply({
        result: { collections: [{ name: 'docs' }, { name: 'products' }] },
      })

      const result = await service.getCollectionsDictionary({})

      expect(result).toEqual({
        items: [
          { label: 'docs', value: 'docs' },
          { label: 'products', value: 'products' },
        ],
        cursor: null,
      })
    })

    it('filters by case-insensitive search', async () => {
      mock.onGet(`${BASE}/collections`).reply({
        result: { collections: [{ name: 'Documents' }, { name: 'Products' }] },
      })

      const result = await service.getCollectionsDictionary({ search: 'doc' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('Documents')
    })

    it('handles null payload', async () => {
      mock.onGet(`${BASE}/collections`).reply({
        result: { collections: [{ name: 'docs' }] },
      })

      const result = await service.getCollectionsDictionary(null)

      expect(result.items).toHaveLength(1)
      expect(result.cursor).toBeNull()
    })

    it('handles empty or null collections', async () => {
      mock.onGet(`${BASE}/collections`).reply({
        result: { collections: null },
      })

      const result = await service.getCollectionsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('throws with status.error from Qdrant API error body', async () => {
      mock.onGet(`${BASE}/collections`).replyWithError({
        message: 'Bad Request',
        body: { status: { error: 'Collection not found' } },
      })

      await expect(service.listCollections()).rejects.toThrow('Qdrant API error: Collection not found')
    })

    it('falls back to body.message', async () => {
      mock.onGet(`${BASE}/collections`).replyWithError({
        message: 'Server Error',
        body: { message: 'Internal error occurred' },
      })

      await expect(service.listCollections()).rejects.toThrow('Qdrant API error: Internal error occurred')
    })

    it('falls back to error.message', async () => {
      mock.onGet(`${BASE}/collections`).replyWithError({
        message: 'Network timeout',
      })

      await expect(service.listCollections()).rejects.toThrow('Qdrant API error: Network timeout')
    })
  })

  // ── Auth ──

  describe('auth handling', () => {
    it('sends api-key header when apiKey is configured', async () => {
      mock.onGet(`${BASE}/collections`).reply({ result: { collections: [] } })

      await service.listCollections()

      expect(mock.history[0].headers).toMatchObject({ 'api-key': API_KEY })
    })
  })

  // ── Response unwrapping ──

  describe('response unwrapping', () => {
    it('unwraps result from Qdrant response envelope', async () => {
      mock.onGet(`${BASE}/collections`).reply({
        status: 'ok',
        time: 0.001,
        result: { collections: [{ name: 'test' }] },
      })

      const result = await service.listCollections()

      expect(result).toEqual({ collections: [{ name: 'test' }] })
    })

    it('returns full response when result is undefined', async () => {
      mock.onGet(`${BASE}/collections`).reply({ status: 'ok', time: 0.001 })

      const result = await service.listCollections()

      expect(result).toEqual({ status: 'ok', time: 0.001 })
    })
  })
})
