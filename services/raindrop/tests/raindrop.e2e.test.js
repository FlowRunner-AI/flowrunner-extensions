'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Raindrop.io Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('raindrop')
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

  // ── User ──

  describe('getUser', () => {
    it('returns user profile with expected shape', async () => {
      const result = await service.getUser()

      expect(result).toHaveProperty('result', true)
      expect(result).toHaveProperty('user')
      expect(result.user).toHaveProperty('_id')
      expect(result.user).toHaveProperty('fullName')
    })
  })

  // ── Collections CRUD ──

  describe('collections lifecycle', () => {
    let createdCollectionId

    it('creates a collection', async () => {
      const result = await service.createCollection('E2E Test Collection', 'List', false)

      expect(result).toHaveProperty('result', true)
      expect(result).toHaveProperty('item')
      expect(result.item).toHaveProperty('_id')
      expect(result.item.title).toBe('E2E Test Collection')

      createdCollectionId = result.item._id
    })

    it('gets the created collection', async () => {
      const result = await service.getCollection(createdCollectionId)

      expect(result).toHaveProperty('result', true)
      expect(result.item._id).toBe(createdCollectionId)
      expect(result.item.title).toBe('E2E Test Collection')
    })

    it('updates the collection', async () => {
      const result = await service.updateCollection(createdCollectionId, 'E2E Updated Collection')

      expect(result).toHaveProperty('result', true)
      expect(result.item.title).toBe('E2E Updated Collection')
    })

    it('appears in getCollections', async () => {
      const result = await service.getCollections()

      expect(result).toHaveProperty('result', true)
      expect(Array.isArray(result.items)).toBe(true)

      const found = result.items.find(c => c._id === createdCollectionId)
      expect(found).toBeDefined()
    })

    it('deletes the collection', async () => {
      const result = await service.deleteCollection(createdCollectionId)

      expect(result).toHaveProperty('result', true)
    })
  })

  // ── Child Collections ──

  describe('getChildCollections', () => {
    it('returns child collections array', async () => {
      const result = await service.getChildCollections()

      expect(result).toHaveProperty('result', true)
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Raindrops CRUD ──

  describe('raindrops lifecycle', () => {
    let createdRaindropId

    it('creates a raindrop', async () => {
      const result = await service.createRaindrop(
        'https://example.com',
        'E2E Test Bookmark',
        'Test excerpt',
        ['e2e-test'],
        -1,
        true
      )

      expect(result).toHaveProperty('result', true)
      expect(result.item).toHaveProperty('_id')
      expect(result.item.link).toBe('https://example.com')

      createdRaindropId = result.item._id
    })

    it('gets the created raindrop', async () => {
      const result = await service.getRaindrop(createdRaindropId)

      expect(result).toHaveProperty('result', true)
      expect(result.item._id).toBe(createdRaindropId)
    })

    it('lists raindrops in Unsorted', async () => {
      const result = await service.getRaindrops(-1, undefined, 'Newest first', 0, 5)

      expect(result).toHaveProperty('result', true)
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('count')
    })

    it('updates the raindrop', async () => {
      const result = await service.updateRaindrop(
        createdRaindropId,
        undefined,
        'E2E Updated Bookmark',
        undefined,
        ['e2e-test', 'updated'],
        undefined,
        true
      )

      expect(result).toHaveProperty('result', true)
      expect(result.item.title).toBe('E2E Updated Bookmark')
    })

    it('deletes the raindrop', async () => {
      const result = await service.deleteRaindrop(createdRaindropId)

      expect(result).toHaveProperty('result', true)
    })
  })

  // ── Create Many Raindrops ──

  describe('createManyRaindrops', () => {
    let createdIds = []

    it('creates multiple raindrops at once', async () => {
      const items = [
        { link: 'https://example.com/e2e-bulk-1', title: 'E2E Bulk 1' },
        { link: 'https://example.com/e2e-bulk-2', title: 'E2E Bulk 2' },
      ]

      const result = await service.createManyRaindrops(items)

      expect(result).toHaveProperty('result', true)
      expect(Array.isArray(result.items)).toBe(true)
      expect(result.items.length).toBeGreaterThanOrEqual(2)

      createdIds = result.items.map(item => item._id)
    })

    afterAll(async () => {
      for (const id of createdIds) {
        try {
          await service.deleteRaindrop(id)
        } catch (e) {
          // cleanup best-effort
        }
      }
    })
  })

  // ── Tags ──

  describe('getTags', () => {
    it('returns tags array', async () => {
      const result = await service.getTags(0)

      expect(result).toHaveProperty('result', true)
      expect(Array.isArray(result.items)).toBe(true)
    })

    it('returns tags without collection scope', async () => {
      const result = await service.getTags()

      expect(result).toHaveProperty('result', true)
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Highlights ──

  describe('getAllHighlights', () => {
    it('returns highlights array', async () => {
      const result = await service.getAllHighlights(0, 5)

      expect(result).toHaveProperty('result', true)
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getHighlightsOfRaindrop', () => {
    it('returns highlights for a specific raindrop', async () => {
      const { raindropId } = testValues

      if (!raindropId) {
        console.log('Skipping getHighlightsOfRaindrop: testValues.raindropId not set')
        return
      }

      const result = await service.getHighlightsOfRaindrop(raindropId)

      expect(result).toHaveProperty('result', true)
    })
  })

  // ── Dictionary ──

  describe('getCollectionsDictionary', () => {
    it('returns dictionary items with label and value', async () => {
      const result = await service.getCollectionsDictionary({})

      expect(result).toHaveProperty('items')
      expect(result).toHaveProperty('cursor', null)
      expect(Array.isArray(result.items)).toBe(true)

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
        expect(result.items[0]).toHaveProperty('note')
      }
    })

    it('filters by search term', async () => {
      const all = await service.getCollectionsDictionary({})
      if (all.items.length === 0) {
        console.log('Skipping dictionary search test: no collections found')
        return
      }

      const searchTerm = all.items[0].label.substring(0, 3)
      const filtered = await service.getCollectionsDictionary({ search: searchTerm })

      expect(filtered).toHaveProperty('items')
      expect(Array.isArray(filtered.items)).toBe(true)
    })

    it('handles null payload', async () => {
      const result = await service.getCollectionsDictionary(null)

      expect(result).toHaveProperty('items')
      expect(result).toHaveProperty('cursor', null)
    })
  })

  // ── Empty Trash ──

  describe('emptyTrash', () => {
    it('empties the trash', async () => {
      const result = await service.emptyTrash()

      expect(result).toHaveProperty('result', true)
    })
  })
})
