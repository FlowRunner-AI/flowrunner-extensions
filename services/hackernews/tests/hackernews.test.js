'use strict'

const { createSandbox } = require('../../../service-sandbox')

const FIREBASE_BASE = 'https://hacker-news.firebaseio.com/v0'
const ALGOLIA_BASE = 'https://hn.algolia.com/api/v1'

describe('HackerNews Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({})
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
    it('registers with no config items', () => {
      expect(sandbox.getConfigItems()).toEqual([])
    })
  })

  // ── Items & Users (Firebase) ──

  describe('getItem', () => {
    it('sends correct request and returns item', async () => {
      const item = { id: 8863, by: 'dhouston', type: 'story', title: 'My YC app: Dropbox', score: 111 }

      mock.onGet(`${FIREBASE_BASE}/item/8863.json`).reply(item)

      const result = await service.getItem(8863)

      expect(result).toEqual(item)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({ Accept: 'application/json' })
    })

    it('throws not-found error when Firebase returns null', async () => {
      mock.onGet(`${FIREBASE_BASE}/item/999999999.json`).reply(null)

      await expect(service.getItem(999999999)).rejects.toThrow('Item 999999999 not found')
    })

    it('throws on API error', async () => {
      mock.onGet(`${FIREBASE_BASE}/item/1.json`).replyWithError({
        message: 'Internal Server Error',
        body: { error: 'Server error' },
      })

      await expect(service.getItem(1)).rejects.toThrow('Hacker News API error')
    })
  })

  describe('getUser', () => {
    it('sends correct request and returns user', async () => {
      const user = { id: 'pg', karma: 157315, created: 1160418092, about: 'Bug fixer.' }

      mock.onGet(`${FIREBASE_BASE}/user/pg.json`).reply(user)

      const result = await service.getUser('pg')

      expect(result).toEqual(user)
      expect(mock.history).toHaveLength(1)
    })

    it('encodes username in URL', async () => {
      const user = { id: 'test user', karma: 100 }

      mock.onGet(`${FIREBASE_BASE}/user/test%20user.json`).reply(user)

      const result = await service.getUser('test user')

      expect(result).toEqual(user)
    })

    it('throws not-found error when user does not exist', async () => {
      mock.onGet(`${FIREBASE_BASE}/user/nonexistent.json`).reply(null)

      await expect(service.getUser('nonexistent')).rejects.toThrow('User nonexistent not found')
    })
  })

  describe('getMaxItemId', () => {
    it('returns the max item id', async () => {
      mock.onGet(`${FIREBASE_BASE}/maxitem.json`).reply(41393920)

      const result = await service.getMaxItemId()

      expect(result).toBe(41393920)
    })

    it('throws when response is null', async () => {
      mock.onGet(`${FIREBASE_BASE}/maxitem.json`).reply(null)

      await expect(service.getMaxItemId()).rejects.toThrow('Max item id not found')
    })
  })

  // ── Story Lists (Firebase) ──

  describe('getTopStories', () => {
    it('returns array of story ids', async () => {
      const ids = [41393911, 41393199, 41387761]

      mock.onGet(`${FIREBASE_BASE}/topstories.json`).reply(ids)

      const result = await service.getTopStories()

      expect(result).toEqual(ids)
    })

    it('returns empty array when response is not an array', async () => {
      mock.onGet(`${FIREBASE_BASE}/topstories.json`).reply(null)

      const result = await service.getTopStories()

      expect(result).toEqual([])
    })
  })

  describe('getNewStories', () => {
    it('returns array of story ids', async () => {
      const ids = [100, 99, 98]

      mock.onGet(`${FIREBASE_BASE}/newstories.json`).reply(ids)

      const result = await service.getNewStories()

      expect(result).toEqual(ids)
    })
  })

  describe('getBestStories', () => {
    it('returns array of story ids', async () => {
      const ids = [200, 199]

      mock.onGet(`${FIREBASE_BASE}/beststories.json`).reply(ids)

      const result = await service.getBestStories()

      expect(result).toEqual(ids)
    })
  })

  describe('getAskStories', () => {
    it('returns array of story ids', async () => {
      const ids = [300, 299]

      mock.onGet(`${FIREBASE_BASE}/askstories.json`).reply(ids)

      const result = await service.getAskStories()

      expect(result).toEqual(ids)
    })
  })

  describe('getShowStories', () => {
    it('returns array of story ids', async () => {
      const ids = [400, 399]

      mock.onGet(`${FIREBASE_BASE}/showstories.json`).reply(ids)

      const result = await service.getShowStories()

      expect(result).toEqual(ids)
    })
  })

  describe('getJobStories', () => {
    it('returns array of story ids', async () => {
      const ids = [500, 499]

      mock.onGet(`${FIREBASE_BASE}/jobstories.json`).reply(ids)

      const result = await service.getJobStories()

      expect(result).toEqual(ids)
    })
  })

  describe('getUpdates', () => {
    it('returns items and profiles arrays', async () => {
      const updates = { items: [41393911, 41393199], profiles: ['thefox', 'mdda'] }

      mock.onGet(`${FIREBASE_BASE}/updates.json`).reply(updates)

      const result = await service.getUpdates()

      expect(result).toEqual(updates)
    })

    it('throws when response is null', async () => {
      mock.onGet(`${FIREBASE_BASE}/updates.json`).reply(null)

      await expect(service.getUpdates()).rejects.toThrow('Updates not found')
    })
  })

  // ── Hydrated Stories ──

  describe('getTopStoriesHydrated', () => {
    it('fetches top stories and hydrates with default limit of 10', async () => {
      const ids = Array.from({ length: 20 }, (_, i) => 1000 + i)

      mock.onGet(`${FIREBASE_BASE}/topstories.json`).reply(ids)

      for (let i = 0; i < 10; i++) {
        mock.onGet(`${FIREBASE_BASE}/item/${ids[i]}.json`).reply({ id: ids[i], type: 'story', title: `Story ${i}` })
      }

      const result = await service.getTopStoriesHydrated()

      expect(result.count).toBe(20)
      expect(result.limit).toBe(10)
      expect(result.stories).toHaveLength(10)
      expect(result.stories[0]).toMatchObject({ id: 1000, type: 'story' })
    })

    it('respects custom limit', async () => {
      const ids = [1, 2, 3, 4, 5]

      mock.onGet(`${FIREBASE_BASE}/topstories.json`).reply(ids)

      for (const id of ids.slice(0, 3)) {
        mock.onGet(`${FIREBASE_BASE}/item/${id}.json`).reply({ id, type: 'story' })
      }

      const result = await service.getTopStoriesHydrated(3)

      expect(result.count).toBe(5)
      expect(result.limit).toBe(3)
      expect(result.stories).toHaveLength(3)
    })

    it('caps limit at 50', async () => {
      const ids = Array.from({ length: 100 }, (_, i) => 2000 + i)

      mock.onGet(`${FIREBASE_BASE}/topstories.json`).reply(ids)

      for (let i = 0; i < 50; i++) {
        mock.onGet(`${FIREBASE_BASE}/item/${ids[i]}.json`).reply({ id: ids[i], type: 'story' })
      }

      const result = await service.getTopStoriesHydrated(200)

      expect(result.limit).toBe(50)
      expect(result.stories).toHaveLength(50)
    })

    it('uses default limit for invalid values', async () => {
      const ids = Array.from({ length: 15 }, (_, i) => 3000 + i)

      mock.onGet(`${FIREBASE_BASE}/topstories.json`).reply(ids)

      for (let i = 0; i < 10; i++) {
        mock.onGet(`${FIREBASE_BASE}/item/${ids[i]}.json`).reply({ id: ids[i], type: 'story' })
      }

      const result = await service.getTopStoriesHydrated(-5)

      expect(result.limit).toBe(10)
    })

    it('filters out null items from hydrated results', async () => {
      const ids = [1, 2, 3]

      mock.onGet(`${FIREBASE_BASE}/topstories.json`).reply(ids)
      mock.onGet(`${FIREBASE_BASE}/item/1.json`).reply({ id: 1, type: 'story' })
      mock.onGet(`${FIREBASE_BASE}/item/2.json`).reply(null)
      mock.onGet(`${FIREBASE_BASE}/item/3.json`).reply({ id: 3, type: 'story' })

      const result = await service.getTopStoriesHydrated(3)

      expect(result.stories).toHaveLength(2)
      expect(result.stories[0].id).toBe(1)
      expect(result.stories[1].id).toBe(3)
    })
  })

  // ── Search (Algolia) ──

  describe('search', () => {
    const searchResult = {
      hits: [{ objectID: '8863', title: 'Dropbox', author: 'dhouston', points: 111 }],
      nbHits: 1,
      page: 0,
      nbPages: 1,
      hitsPerPage: 20,
      query: 'dropbox',
    }

    it('sends correct request with query only', async () => {
      mock.onGet(`${ALGOLIA_BASE}/search`).reply(searchResult)

      const result = await service.search('dropbox')

      expect(result).toEqual(searchResult)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({ query: 'dropbox' })
    })

    it('resolves friendly tag labels to Algolia tokens', async () => {
      mock.onGet(`${ALGOLIA_BASE}/search`).reply(searchResult)

      await service.search('test', 'Story')

      expect(mock.history[0].query).toMatchObject({ tags: 'story' })
    })

    it('resolves Ask HN tag', async () => {
      mock.onGet(`${ALGOLIA_BASE}/search`).reply(searchResult)

      await service.search('test', 'Ask HN')

      expect(mock.history[0].query).toMatchObject({ tags: 'ask_hn' })
    })

    it('resolves Show HN tag', async () => {
      mock.onGet(`${ALGOLIA_BASE}/search`).reply(searchResult)

      await service.search('test', 'Show HN')

      expect(mock.history[0].query).toMatchObject({ tags: 'show_hn' })
    })

    it('passes through raw Algolia tags', async () => {
      mock.onGet(`${ALGOLIA_BASE}/search`).reply(searchResult)

      await service.search('test', 'author_pg')

      expect(mock.history[0].query).toMatchObject({ tags: 'author_pg' })
    })

    it('handles comma-separated mixed tags', async () => {
      mock.onGet(`${ALGOLIA_BASE}/search`).reply(searchResult)

      await service.search('test', 'Story,author_pg')

      expect(mock.history[0].query).toMatchObject({ tags: 'story,author_pg' })
    })

    it('passes numeric filters', async () => {
      mock.onGet(`${ALGOLIA_BASE}/search`).reply(searchResult)

      await service.search('test', undefined, 'points>100', 0, 10)

      expect(mock.history[0].query).toMatchObject({
        query: 'test',
        numericFilters: 'points>100',
        page: 0,
        hitsPerPage: 10,
      })
    })

    it('sends request with all parameters', async () => {
      mock.onGet(`${ALGOLIA_BASE}/search`).reply(searchResult)

      await service.search('dropbox', 'Comment', 'points>5', 2, 50)

      expect(mock.history[0].query).toMatchObject({
        query: 'dropbox',
        tags: 'comment',
        numericFilters: 'points>5',
        page: 2,
        hitsPerPage: 50,
      })
    })

    it('throws on API error', async () => {
      mock.onGet(`${ALGOLIA_BASE}/search`).replyWithError({
        message: 'Bad Request',
      })

      await expect(service.search('test')).rejects.toThrow('Hacker News API error')
    })
  })

  describe('searchByDate', () => {
    const searchResult = {
      hits: [{ objectID: '1234', title: 'Recent Post' }],
      nbHits: 1,
      page: 0,
      nbPages: 1,
      hitsPerPage: 20,
      query: 'recent',
    }

    it('sends request to search_by_date endpoint', async () => {
      mock.onGet(`${ALGOLIA_BASE}/search_by_date`).reply(searchResult)

      const result = await service.searchByDate('recent')

      expect(result).toEqual(searchResult)
      expect(mock.history[0].url).toBe(`${ALGOLIA_BASE}/search_by_date`)
      expect(mock.history[0].query).toMatchObject({ query: 'recent' })
    })

    it('resolves tags the same as search', async () => {
      mock.onGet(`${ALGOLIA_BASE}/search_by_date`).reply(searchResult)

      await service.searchByDate('test', 'Front Page')

      expect(mock.history[0].query).toMatchObject({ tags: 'front_page' })
    })

    it('passes all parameters', async () => {
      mock.onGet(`${ALGOLIA_BASE}/search_by_date`).reply(searchResult)

      await service.searchByDate('thing', 'Poll', 'created_at_i>1700000000', 1, 30)

      expect(mock.history[0].query).toMatchObject({
        query: 'thing',
        tags: 'poll',
        numericFilters: 'created_at_i>1700000000',
        page: 1,
        hitsPerPage: 30,
      })
    })
  })

  // ── Algolia Items & Users ──

  describe('getItemAlgolia', () => {
    it('sends correct request to Algolia items endpoint', async () => {
      const item = { id: 8863, title: 'Dropbox', author: 'dhouston', children: [] }

      mock.onGet(`${ALGOLIA_BASE}/items/8863`).reply(item)

      const result = await service.getItemAlgolia(8863)

      expect(result).toEqual(item)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].url).toBe(`${ALGOLIA_BASE}/items/8863`)
    })

    it('throws on API error', async () => {
      mock.onGet(`${ALGOLIA_BASE}/items/999`).replyWithError({
        message: 'Not Found',
      })

      await expect(service.getItemAlgolia(999)).rejects.toThrow('Hacker News API error')
    })
  })

  describe('getUserAlgolia', () => {
    it('sends correct request to Algolia users endpoint', async () => {
      const user = { username: 'pg', karma: 157315, about: 'Bug fixer.' }

      mock.onGet(`${ALGOLIA_BASE}/users/pg`).reply(user)

      const result = await service.getUserAlgolia('pg')

      expect(result).toEqual(user)
      expect(mock.history[0].url).toBe(`${ALGOLIA_BASE}/users/pg`)
    })

    it('encodes username in URL', async () => {
      const user = { username: 'test user', karma: 100 }

      mock.onGet(`${ALGOLIA_BASE}/users/test%20user`).reply(user)

      const result = await service.getUserAlgolia('test user')

      expect(result).toEqual(user)
    })
  })
})
