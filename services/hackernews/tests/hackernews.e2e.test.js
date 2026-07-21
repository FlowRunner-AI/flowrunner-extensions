'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('HackerNews Service (e2e)', () => {
  let sandbox
  let service

  beforeAll(() => {
    sandbox = createE2ESandbox('hackernews')
    require('../src/index.js')

    try {
      sandbox.validateConfigs()
    } catch (error) {
      console.log(error)
      process.exit(1)
    }

    service = sandbox.getService()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Items & Users (Firebase) ──

  describe('getItem', () => {
    it('returns a known story with expected shape', async () => {
      const result = await service.getItem(8863)

      expect(result).toHaveProperty('id', 8863)
      expect(result).toHaveProperty('by')
      expect(result).toHaveProperty('type')
      expect(result).toHaveProperty('title')
    })

    it('throws for a non-existent item', async () => {
      await expect(service.getItem(0)).rejects.toThrow()
    })
  })

  describe('getUser', () => {
    it('returns a known user with expected shape', async () => {
      const result = await service.getUser('pg')

      expect(result).toHaveProperty('id', 'pg')
      expect(result).toHaveProperty('karma')
      expect(result).toHaveProperty('created')
    })

    it('throws for a non-existent user', async () => {
      await expect(service.getUser('__nonexistent_user_zzzzz__')).rejects.toThrow()
    })
  })

  describe('getMaxItemId', () => {
    it('returns a positive number', async () => {
      const result = await service.getMaxItemId()

      expect(typeof result).toBe('number')
      expect(result).toBeGreaterThan(0)
    })
  })

  // ── Story Lists (Firebase) ──

  describe('getTopStories', () => {
    it('returns an array of numeric ids', async () => {
      const result = await service.getTopStories()

      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThan(0)
      expect(typeof result[0]).toBe('number')
    })
  })

  describe('getNewStories', () => {
    it('returns an array of numeric ids', async () => {
      const result = await service.getNewStories()

      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThan(0)
    })
  })

  describe('getBestStories', () => {
    it('returns an array of numeric ids', async () => {
      const result = await service.getBestStories()

      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThan(0)
    })
  })

  describe('getAskStories', () => {
    it('returns an array of numeric ids', async () => {
      const result = await service.getAskStories()

      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThan(0)
    })
  })

  describe('getShowStories', () => {
    it('returns an array of numeric ids', async () => {
      const result = await service.getShowStories()

      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThan(0)
    })
  })

  describe('getJobStories', () => {
    it('returns an array of numeric ids', async () => {
      const result = await service.getJobStories()

      expect(Array.isArray(result)).toBe(true)
    })
  })

  describe('getUpdates', () => {
    it('returns items and profiles arrays', async () => {
      const result = await service.getUpdates()

      expect(result).toHaveProperty('items')
      expect(result).toHaveProperty('profiles')
      expect(Array.isArray(result.items)).toBe(true)
      expect(Array.isArray(result.profiles)).toBe(true)
    })
  })

  // ── Hydrated Stories ──

  describe('getTopStoriesHydrated', () => {
    it('returns hydrated stories with default limit', async () => {
      const result = await service.getTopStoriesHydrated()

      expect(result).toHaveProperty('count')
      expect(result).toHaveProperty('limit', 10)
      expect(result).toHaveProperty('stories')
      expect(Array.isArray(result.stories)).toBe(true)
      expect(result.stories.length).toBeLessThanOrEqual(10)

      if (result.stories.length > 0) {
        expect(result.stories[0]).toHaveProperty('id')
        expect(result.stories[0]).toHaveProperty('type')
      }
    })

    it('respects a custom limit', async () => {
      const result = await service.getTopStoriesHydrated(3)

      expect(result.limit).toBe(3)
      expect(result.stories.length).toBeLessThanOrEqual(3)
    })
  })

  // ── Search (Algolia) ──

  describe('search', () => {
    it('returns results with expected shape', async () => {
      const result = await service.search('javascript')

      expect(result).toHaveProperty('hits')
      expect(result).toHaveProperty('nbHits')
      expect(result).toHaveProperty('page')
      expect(result).toHaveProperty('hitsPerPage')
      expect(Array.isArray(result.hits)).toBe(true)
    })

    it('filters by tag', async () => {
      const result = await service.search('python', 'Story')

      expect(result).toHaveProperty('hits')
      expect(Array.isArray(result.hits)).toBe(true)
    })

    it('supports pagination', async () => {
      const result = await service.search('react', undefined, undefined, 1, 5)

      expect(result.page).toBe(1)
      expect(result.hitsPerPage).toBe(5)
    })
  })

  describe('searchByDate', () => {
    it('returns results ordered by date', async () => {
      const result = await service.searchByDate('startup')

      expect(result).toHaveProperty('hits')
      expect(result).toHaveProperty('nbHits')
      expect(Array.isArray(result.hits)).toBe(true)
    })
  })

  // ── Algolia Items & Users ──

  describe('getItemAlgolia', () => {
    it('returns a known item with nested children', async () => {
      const result = await service.getItemAlgolia(8863)

      expect(result).toHaveProperty('id', 8863)
      expect(result).toHaveProperty('author')
      expect(result).toHaveProperty('children')
      expect(Array.isArray(result.children)).toBe(true)
    })
  })

  describe('getUserAlgolia', () => {
    it('returns a known user with expected shape', async () => {
      const result = await service.getUserAlgolia('pg')

      expect(result).toHaveProperty('username', 'pg')
      expect(result).toHaveProperty('karma')
    })
  })
})
