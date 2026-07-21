'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Google Books Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('google-books')
    require('../src/index.js')

    try {
      // apiKey is optional (public search works without one), so this only
      // fails if a future required config is added. Public endpoints below
      // work with an empty key.
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

  // ── Volumes ──

  describe('searchVolumes', () => {
    it('returns a volumes collection with expected shape', async () => {
      const response = await service.searchVolumes('the google story')

      expect(response).toHaveProperty('kind', 'books#volumes')
      expect(response).toHaveProperty('totalItems')
      expect(Array.isArray(response.items)).toBe(true)
      expect(response.items.length).toBeGreaterThan(0)
      expect(response.items[0]).toHaveProperty('id')
      expect(response.items[0]).toHaveProperty('volumeInfo')
    })

    it('honors max results and pagination', async () => {
      const response = await service.searchVolumes('javascript', 0, 5)

      expect(Array.isArray(response.items)).toBe(true)
      expect(response.items.length).toBeLessThanOrEqual(5)
    })

    it('applies choice params (order, print type, filter, projection) without error', async () => {
      const response = await service.searchVolumes(
        'gardening',
        0,
        3,
        'Newest',
        'Books',
        'Partial',
        'en',
        'Lite'
      )

      expect(response).toHaveProperty('kind', 'books#volumes')
      expect(Array.isArray(response.items)).toBe(true)
    })

    it('supports an isbn: qualifier search', async () => {
      const response = await service.searchVolumes('isbn:9780553804577')

      expect(response).toHaveProperty('kind', 'books#volumes')
      expect(Array.isArray(response.items)).toBe(true)
    })
  })

  describe('getVolume', () => {
    it('returns full metadata for a volume found via search', async () => {
      const search = await service.searchVolumes('the google story', 0, 1)
      const volumeId = search.items[0].id

      const response = await service.getVolume(volumeId)

      expect(response).toHaveProperty('kind', 'books#volume')
      expect(response).toHaveProperty('id', volumeId)
      expect(response).toHaveProperty('volumeInfo')
      expect(response.volumeInfo).toHaveProperty('title')
    })

    it('throws a wrapped error for an unknown volume id', async () => {
      await expect(service.getVolume('this-id-does-not-exist')).rejects.toThrow(
        /Google Books API error/
      )
    })
  })

  // ── Bookshelves ──
  //
  // These require a Google user ID that has PUBLIC bookshelves. Supply
  // testValues.userId (and optionally testValues.shelfId) to run them;
  // otherwise they are skipped so the suite still passes on a bare config.

  describe('listPublicBookshelves', () => {
    it('lists public bookshelves for the configured user', async () => {
      if (!testValues.userId) {
        console.log('Skipping listPublicBookshelves: set testValues.userId')
        return
      }

      const response = await service.listPublicBookshelves(testValues.userId)

      expect(response).toHaveProperty('kind', 'books#bookshelves')
      expect(Array.isArray(response.items)).toBe(true)
    })
  })

  describe('getPublicBookshelf', () => {
    it('retrieves a single public bookshelf for the configured user', async () => {
      if (!testValues.userId) {
        console.log('Skipping getPublicBookshelf: set testValues.userId')
        return
      }

      // Resolve a shelf id: prefer the developer-supplied one, else use the
      // first shelf returned by listPublicBookshelves.
      let shelfId = testValues.shelfId

      if (!shelfId) {
        const shelves = await service.listPublicBookshelves(testValues.userId)

        if (!shelves.items || shelves.items.length === 0) {
          console.log('Skipping getPublicBookshelf: configured user has no public shelves')
          return
        }

        shelfId = shelves.items[0].id
      }

      const response = await service.getPublicBookshelf(testValues.userId, shelfId)

      expect(response).toHaveProperty('kind', 'books#bookshelf')
      expect(response).toHaveProperty('id')
    })
  })

  describe('listBookshelfVolumes', () => {
    it('lists volumes in a public bookshelf for the configured user', async () => {
      if (!testValues.userId) {
        console.log('Skipping listBookshelfVolumes: set testValues.userId')
        return
      }

      let shelfId = testValues.shelfId

      if (!shelfId) {
        const shelves = await service.listPublicBookshelves(testValues.userId)

        if (!shelves.items || shelves.items.length === 0) {
          console.log('Skipping listBookshelfVolumes: configured user has no public shelves')
          return
        }

        shelfId = shelves.items[0].id
      }

      const response = await service.listBookshelfVolumes(testValues.userId, shelfId, 0, 5)

      expect(response).toHaveProperty('kind', 'books#volumes')
      expect(response).toHaveProperty('totalItems')
      // A public shelf may legitimately be empty; items is present only when > 0.
      if (response.totalItems > 0) {
        expect(Array.isArray(response.items)).toBe(true)
      }
    })
  })
})
