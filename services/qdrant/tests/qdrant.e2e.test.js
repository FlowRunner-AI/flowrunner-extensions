'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Qdrant Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  const TEST_COLLECTION = `e2e-test-${Date.now()}`

  beforeAll(() => {
    sandbox = createE2ESandbox('qdrant')
    require('../src/index.js')

    try {
      sandbox.validateConfigs()
    } catch (error) {
      console.log(error)
      process.exit(1)
    }

    service = sandbox.getService()
    testValues = sandbox.getTestValues()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Collections lifecycle ──

  describe('collections lifecycle', () => {
    it('creates a collection', async () => {
      const result = await service.createCollection(TEST_COLLECTION, 4, 'Cosine', false, undefined)

      expect(result).toBe(true)
    })

    it('checks collection exists', async () => {
      const result = await service.collectionExists(TEST_COLLECTION)

      expect(result).toEqual({ exists: true })
    })

    it('lists collections and includes the test collection', async () => {
      const result = await service.listCollections()

      expect(result).toHaveProperty('collections')
      expect(Array.isArray(result.collections)).toBe(true)

      const names = result.collections.map(c => c.name)

      expect(names).toContain(TEST_COLLECTION)
    })

    it('gets collection details', async () => {
      const result = await service.getCollection(TEST_COLLECTION)

      expect(result).toHaveProperty('status')
      expect(result).toHaveProperty('config')
    })
  })

  // ── Points lifecycle ──

  describe('points lifecycle', () => {
    it('upserts points', async () => {
      const points = [
        { id: 1, vector: [0.1, 0.2, 0.3, 0.4], payload: { city: 'Berlin', color: 'blue' } },
        { id: 2, vector: [0.5, 0.6, 0.7, 0.8], payload: { city: 'Munich', color: 'red' } },
        { id: 3, vector: [0.9, 0.1, 0.2, 0.3], payload: { city: 'Berlin', color: 'green' } },
      ]

      const result = await service.upsertPoints(TEST_COLLECTION, points)

      expect(result).toHaveProperty('status', 'completed')
    })

    it('gets points by IDs', async () => {
      const result = await service.getPoints(TEST_COLLECTION, ['1', '2'], true, false)

      expect(Array.isArray(result)).toBe(true)
      expect(result).toHaveLength(2)
      expect(result[0]).toHaveProperty('id')
      expect(result[0]).toHaveProperty('payload')
    })

    it('gets points with vectors', async () => {
      const result = await service.getPoints(TEST_COLLECTION, ['1'], true, true)

      expect(result[0]).toHaveProperty('vector')
      expect(Array.isArray(result[0].vector)).toBe(true)
    })

    it('counts all points', async () => {
      const result = await service.countPoints(TEST_COLLECTION, undefined, true)

      expect(result).toHaveProperty('count', 3)
    })

    it('counts points with filter', async () => {
      const filter = { must: [{ key: 'city', match: { value: 'Berlin' } }] }

      const result = await service.countPoints(TEST_COLLECTION, filter, true)

      expect(result).toHaveProperty('count', 2)
    })

    it('queries points by vector', async () => {
      const result = await service.queryPoints(
        TEST_COLLECTION, [0.1, 0.2, 0.3, 0.4], undefined, undefined,
        2, undefined, undefined, true, false, undefined
      )

      expect(result).toHaveProperty('points')
      expect(Array.isArray(result.points)).toBe(true)
      expect(result.points.length).toBeLessThanOrEqual(2)

      if (result.points.length > 0) {
        expect(result.points[0]).toHaveProperty('id')
        expect(result.points[0]).toHaveProperty('score')
      }
    })

    it('queries points by point ID', async () => {
      const result = await service.queryPoints(
        TEST_COLLECTION, undefined, '1', undefined,
        2, undefined, undefined, true, false, undefined
      )

      expect(result).toHaveProperty('points')
      expect(Array.isArray(result.points)).toBe(true)
    })

    it('queries points with filter', async () => {
      const filter = { must: [{ key: 'city', match: { value: 'Berlin' } }] }

      const result = await service.queryPoints(
        TEST_COLLECTION, [0.1, 0.2, 0.3, 0.4], undefined, filter,
        10, undefined, undefined, true, false, undefined
      )

      expect(result).toHaveProperty('points')

      for (const point of result.points) {
        expect(point.payload.city).toBe('Berlin')
      }
    })

    it('batch queries points', async () => {
      const searches = [
        { query: [0.1, 0.2, 0.3, 0.4], limit: 1, with_payload: true },
        { query: [0.5, 0.6, 0.7, 0.8], limit: 1, with_payload: true },
      ]

      const result = await service.batchQueryPoints(TEST_COLLECTION, searches)

      expect(Array.isArray(result)).toBe(true)
      expect(result).toHaveLength(2)
    })

    it('scrolls points', async () => {
      const result = await service.scrollPoints(TEST_COLLECTION, undefined, 2, undefined, true, false)

      expect(result).toHaveProperty('points')
      expect(Array.isArray(result.points)).toBe(true)
      expect(result.points.length).toBeLessThanOrEqual(2)
      expect(result).toHaveProperty('next_page_offset')
    })

    it('scrolls points with filter', async () => {
      const filter = { must: [{ key: 'city', match: { value: 'Munich' } }] }

      const result = await service.scrollPoints(TEST_COLLECTION, filter, 10, undefined, true, false)

      expect(result.points).toHaveLength(1)
      expect(result.points[0].payload.city).toBe('Munich')
    })
  })

  // ── Payload operations ──

  describe('payload operations', () => {
    it('sets payload on points by IDs', async () => {
      const result = await service.setPayload(
        TEST_COLLECTION, { status: 'processed' }, ['1'], undefined
      )

      expect(result).toHaveProperty('status', 'completed')

      // Verify
      const points = await service.getPoints(TEST_COLLECTION, ['1'], true, false)

      expect(points[0].payload.status).toBe('processed')
      expect(points[0].payload.city).toBe('Berlin') // original payload preserved
    })

    it('overwrites payload on points', async () => {
      const result = await service.overwritePayload(
        TEST_COLLECTION, { newField: 'only' }, ['2'], undefined
      )

      expect(result).toHaveProperty('status', 'completed')

      const points = await service.getPoints(TEST_COLLECTION, ['2'], true, false)

      expect(points[0].payload).toEqual({ newField: 'only' })
    })

    it('deletes specific payload keys', async () => {
      // First restore point 2 payload
      await service.setPayload(TEST_COLLECTION, { city: 'Munich', color: 'red', temp: 'remove-me' }, ['2'], undefined)

      const result = await service.deletePayloadKeys(TEST_COLLECTION, ['temp'], ['2'], undefined)

      expect(result).toHaveProperty('status', 'completed')

      const points = await service.getPoints(TEST_COLLECTION, ['2'], true, false)

      expect(points[0].payload).not.toHaveProperty('temp')
      expect(points[0].payload).toHaveProperty('city')
    })

    it('clears entire payload', async () => {
      const result = await service.clearPayload(TEST_COLLECTION, ['3'], undefined)

      expect(result).toHaveProperty('status', 'completed')

      const points = await service.getPoints(TEST_COLLECTION, ['3'], true, false)

      expect(points[0].payload).toEqual({})
    })
  })

  // ── Delete points ──

  describe('delete points', () => {
    it('deletes points by IDs', async () => {
      const result = await service.deletePoints(TEST_COLLECTION, ['3'], undefined)

      expect(result).toHaveProperty('status', 'completed')

      const count = await service.countPoints(TEST_COLLECTION, undefined, true)

      expect(count.count).toBe(2)
    })

    it('deletes points by filter', async () => {
      const filter = { must: [{ key: 'city', match: { value: 'Munich' } }] }

      const result = await service.deletePoints(TEST_COLLECTION, [], filter)

      expect(result).toHaveProperty('status', 'completed')

      const count = await service.countPoints(TEST_COLLECTION, undefined, true)

      expect(count.count).toBe(1)
    })
  })

  // ── Dictionary ──

  describe('getCollectionsDictionary', () => {
    it('returns dictionary items', async () => {
      const result = await service.getCollectionsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor', null)

      const names = result.items.map(i => i.value)

      expect(names).toContain(TEST_COLLECTION)
    })

    it('filters by search term', async () => {
      const result = await service.getCollectionsDictionary({ search: 'e2e-test' })

      expect(result.items.length).toBeGreaterThanOrEqual(1)
      expect(result.items.every(i => i.label.includes('e2e-test'))).toBe(true)
    })
  })

  // ── Cleanup ──

  describe('cleanup', () => {
    it('deletes the test collection', async () => {
      const result = await service.deleteCollection(TEST_COLLECTION)

      expect(result).toBe(true)
    })

    it('confirms collection no longer exists', async () => {
      const result = await service.collectionExists(TEST_COLLECTION)

      expect(result).toEqual({ exists: false })
    })
  })
})
