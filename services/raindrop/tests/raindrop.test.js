'use strict'

const { createSandbox } = require('../../../service-sandbox')

const ACCESS_TOKEN = 'test-access-token'
const BASE = 'https://api.raindrop.io/rest/v1'

const AUTH_HEADERS = {
  'Authorization': `Bearer ${ ACCESS_TOKEN }`,
  'Content-Type': 'application/json',
}

describe('Raindrop.io Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ accessToken: ACCESS_TOKEN })
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
      expect(sandbox.getConfigItems()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'accessToken',
            required: true,
            shared: false,
          }),
        ])
      )
    })
  })

  // ── Collections ──

  describe('getCollections', () => {
    it('sends GET to /collections with auth headers', async () => {
      const response = { result: true, items: [{ _id: 1, title: 'Test' }] }
      mock.onGet(`${BASE}/collections`).reply(response)

      const result = await service.getCollections()

      expect(result).toEqual(response)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].headers).toMatchObject(AUTH_HEADERS)
    })

    it('throws on API error response', async () => {
      mock.onGet(`${BASE}/collections`).reply({ result: false, errorMessage: 'Unauthorized' })

      await expect(service.getCollections()).rejects.toThrow('Raindrop.io API error: Unauthorized')
    })

    it('throws on HTTP error', async () => {
      mock.onGet(`${BASE}/collections`).replyWithError({
        message: 'Forbidden',
        status: 403,
      })

      await expect(service.getCollections()).rejects.toThrow()
    })
  })

  describe('getChildCollections', () => {
    it('sends GET to /collections/childrens', async () => {
      const response = { result: true, items: [] }
      mock.onGet(`${BASE}/collections/childrens`).reply(response)

      const result = await service.getChildCollections()

      expect(result).toEqual(response)
      expect(mock.history[0].url).toBe(`${BASE}/collections/childrens`)
    })
  })

  describe('getCollection', () => {
    it('sends GET to /collection/:id', async () => {
      const response = { result: true, item: { _id: 42, title: 'Reading' } }
      mock.onGet(`${BASE}/collection/42`).reply(response)

      const result = await service.getCollection(42)

      expect(result).toEqual(response)
      expect(mock.history[0].url).toBe(`${BASE}/collection/42`)
    })
  })

  describe('createCollection', () => {
    it('sends POST with title and defaults', async () => {
      const response = { result: true, item: { _id: 100, title: 'Recipes' } }
      mock.onPost(`${BASE}/collection`).reply(response)

      const result = await service.createCollection('Recipes')

      expect(result).toEqual(response)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toMatchObject({ title: 'Recipes' })
      expect(mock.history[0].body.pleaseParse).toBeUndefined()
    })

    it('sends view mapped from display name', async () => {
      mock.onPost(`${BASE}/collection`).reply({ result: true, item: {} })

      await service.createCollection('Test', 'Grid', false)

      expect(mock.history[0].body).toMatchObject({
        title: 'Test',
        view: 'grid',
        public: false,
      })
    })

    it('includes parent.$id when parentId is provided', async () => {
      mock.onPost(`${BASE}/collection`).reply({ result: true, item: {} })

      await service.createCollection('Child', undefined, undefined, 55)

      expect(mock.history[0].body).toMatchObject({
        title: 'Child',
        parent: { $id: 55 },
      })
    })

    it('omits parent when parentId is undefined', async () => {
      mock.onPost(`${BASE}/collection`).reply({ result: true, item: {} })

      await service.createCollection('Root')

      expect(mock.history[0].body.parent).toBeUndefined()
    })

    it('omits empty-string fields via clean()', async () => {
      mock.onPost(`${BASE}/collection`).reply({ result: true, item: {} })

      await service.createCollection('Test', '', undefined, '')

      expect(mock.history[0].body).toEqual({ title: 'Test' })
    })
  })

  describe('updateCollection', () => {
    it('sends PUT to /collection/:id with body', async () => {
      mock.onPut(`${BASE}/collection/42`).reply({ result: true, item: {} })

      await service.updateCollection(42, 'New Title', 'Masonry', true)

      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].url).toBe(`${BASE}/collection/42`)
      expect(mock.history[0].body).toMatchObject({
        title: 'New Title',
        view: 'masonry',
        public: true,
      })
    })

    it('includes parent.$id when parentId is provided', async () => {
      mock.onPut(`${BASE}/collection/42`).reply({ result: true, item: {} })

      await service.updateCollection(42, undefined, undefined, undefined, 10)

      expect(mock.history[0].body).toMatchObject({ parent: { $id: 10 } })
    })
  })

  describe('deleteCollection', () => {
    it('sends DELETE to /collection/:id', async () => {
      mock.onDelete(`${BASE}/collection/42`).reply({ result: true })

      const result = await service.deleteCollection(42)

      expect(result).toEqual({ result: true })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${BASE}/collection/42`)
    })
  })

  describe('emptyTrash', () => {
    it('sends DELETE to /collection/-99', async () => {
      mock.onDelete(`${BASE}/collection/-99`).reply({ result: true })

      const result = await service.emptyTrash()

      expect(result).toEqual({ result: true })
      expect(mock.history[0].url).toBe(`${BASE}/collection/-99`)
    })
  })

  // ── Raindrops ──

  describe('getRaindrops', () => {
    it('sends GET to /raindrops/:collectionId with query params', async () => {
      const response = { result: true, items: [], count: 0 }
      mock.onGet(`${BASE}/raindrops/0`).reply(response)

      const result = await service.getRaindrops(0, 'test', 'Newest first', 0, 25)

      expect(result).toEqual(response)
      expect(mock.history[0].query).toMatchObject({
        search: 'test',
        sort: '-created',
        page: 0,
        perpage: 25,
      })
    })

    it('maps sort display names to API values', async () => {
      mock.onGet(`${BASE}/raindrops/0`).reply({ result: true, items: [], count: 0 })

      await service.getRaindrops(0, undefined, 'Title A-Z')

      expect(mock.history[0].query).toMatchObject({ sort: 'title' })
    })

    it('passes through unknown sort values as-is', async () => {
      mock.onGet(`${BASE}/raindrops/0`).reply({ result: true, items: [], count: 0 })

      await service.getRaindrops(0, undefined, '-created')

      expect(mock.history[0].query).toMatchObject({ sort: '-created' })
    })

    it('cleans undefined query params', async () => {
      mock.onGet(`${BASE}/raindrops/-1`).reply({ result: true, items: [], count: 0 })

      await service.getRaindrops(-1)

      const query = mock.history[0].query
      expect(query.search).toBeUndefined()
      expect(query.page).toBeUndefined()
      expect(query.perpage).toBeUndefined()
    })
  })

  describe('getRaindrop', () => {
    it('sends GET to /raindrop/:id', async () => {
      const response = { result: true, item: { _id: 999, title: 'Example' } }
      mock.onGet(`${BASE}/raindrop/999`).reply(response)

      const result = await service.getRaindrop(999)

      expect(result).toEqual(response)
      expect(mock.history[0].url).toBe(`${BASE}/raindrop/999`)
    })
  })

  describe('createRaindrop', () => {
    it('sends POST with link and pleaseParse by default', async () => {
      mock.onPost(`${BASE}/raindrop`).reply({ result: true, item: { _id: 1 } })

      await service.createRaindrop('https://example.com')

      expect(mock.history[0].body).toMatchObject({
        link: 'https://example.com',
        pleaseParse: {},
      })
    })

    it('sends all optional fields', async () => {
      mock.onPost(`${BASE}/raindrop`).reply({ result: true, item: { _id: 2 } })

      await service.createRaindrop(
        'https://example.com', 'Title', 'Excerpt', 'tag1, tag2', 42, true
      )

      expect(mock.history[0].body).toMatchObject({
        link: 'https://example.com',
        title: 'Title',
        excerpt: 'Excerpt',
        tags: ['tag1', 'tag2'],
        collection: { $id: 42 },
        pleaseParse: {},
      })
    })

    it('omits pleaseParse when explicitly false', async () => {
      mock.onPost(`${BASE}/raindrop`).reply({ result: true, item: { _id: 3 } })

      await service.createRaindrop('https://example.com', undefined, undefined, undefined, undefined, false)

      expect(mock.history[0].body.pleaseParse).toBeUndefined()
    })

    it('handles tags as an array', async () => {
      mock.onPost(`${BASE}/raindrop`).reply({ result: true, item: { _id: 4 } })

      await service.createRaindrop('https://example.com', undefined, undefined, ['a', 'b'])

      expect(mock.history[0].body.tags).toEqual(['a', 'b'])
    })

    it('omits tags when empty string', async () => {
      mock.onPost(`${BASE}/raindrop`).reply({ result: true, item: { _id: 5 } })

      await service.createRaindrop('https://example.com', undefined, undefined, '')

      expect(mock.history[0].body.tags).toBeUndefined()
    })

    it('omits collection when collectionId is not provided', async () => {
      mock.onPost(`${BASE}/raindrop`).reply({ result: true, item: { _id: 6 } })

      await service.createRaindrop('https://example.com')

      expect(mock.history[0].body.collection).toBeUndefined()
    })
  })

  describe('updateRaindrop', () => {
    it('sends PUT to /raindrop/:id with body', async () => {
      mock.onPut(`${BASE}/raindrop/999`).reply({ result: true, item: {} })

      await service.updateRaindrop(999, 'https://new.com', 'New Title', 'New Excerpt', 'tag1', 55, true)

      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].url).toBe(`${BASE}/raindrop/999`)
      expect(mock.history[0].body).toMatchObject({
        link: 'https://new.com',
        title: 'New Title',
        excerpt: 'New Excerpt',
        tags: ['tag1'],
        collection: { $id: 55 },
        important: true,
      })
    })

    it('omits all optional fields when not provided', async () => {
      mock.onPut(`${BASE}/raindrop/999`).reply({ result: true, item: {} })

      await service.updateRaindrop(999)

      const body = mock.history[0].body
      expect(body.link).toBeUndefined()
      expect(body.title).toBeUndefined()
      expect(body.tags).toBeUndefined()
      expect(body.collection).toBeUndefined()
      expect(body.important).toBeUndefined()
    })
  })

  describe('deleteRaindrop', () => {
    it('sends DELETE to /raindrop/:id', async () => {
      mock.onDelete(`${BASE}/raindrop/999`).reply({ result: true })

      const result = await service.deleteRaindrop(999)

      expect(result).toEqual({ result: true })
      expect(mock.history[0].method).toBe('delete')
    })
  })

  describe('createManyRaindrops', () => {
    it('sends POST to /raindrops with items array', async () => {
      const items = [
        { link: 'https://a.com' },
        { link: 'https://b.com', title: 'B' },
      ]
      mock.onPost(`${BASE}/raindrops`).reply({ result: true, items: [] })

      await service.createManyRaindrops(items)

      expect(mock.history[0].body).toEqual({ items })
    })

    it('sends empty items array when null', async () => {
      mock.onPost(`${BASE}/raindrops`).reply({ result: true, items: [] })

      await service.createManyRaindrops(null)

      expect(mock.history[0].body).toEqual({ items: [] })
    })
  })

  describe('updateManyRaindrops', () => {
    it('sends PUT to /raindrops/:collectionId with body', async () => {
      mock.onPut(`${BASE}/raindrops/0`).reply({ result: true, modified: 5 })

      await service.updateManyRaindrops(0, [1, 2, 3], 'tag1,tag2', true, 10)

      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].url).toBe(`${BASE}/raindrops/0`)
      expect(mock.history[0].body).toMatchObject({
        ids: [1, 2, 3],
        tags: ['tag1', 'tag2'],
        important: true,
        collection: { $id: 10 },
      })
    })

    it('omits ids when array is empty', async () => {
      mock.onPut(`${BASE}/raindrops/0`).reply({ result: true, modified: 0 })

      await service.updateManyRaindrops(0, [])

      expect(mock.history[0].body.ids).toBeUndefined()
    })

    it('omits collection when moveToCollectionId is not provided', async () => {
      mock.onPut(`${BASE}/raindrops/0`).reply({ result: true, modified: 0 })

      await service.updateManyRaindrops(0)

      expect(mock.history[0].body.collection).toBeUndefined()
    })
  })

  // ── Tags ──

  describe('getTags', () => {
    it('sends GET to /tags when no collectionId', async () => {
      mock.onGet(`${BASE}/tags`).reply({ result: true, items: [] })

      await service.getTags()

      expect(mock.history[0].url).toBe(`${BASE}/tags`)
    })

    it('sends GET to /tags/:collectionId when provided', async () => {
      mock.onGet(`${BASE}/tags/42`).reply({ result: true, items: [] })

      await service.getTags(42)

      expect(mock.history[0].url).toBe(`${BASE}/tags/42`)
    })

    it('uses /tags when collectionId is empty string', async () => {
      mock.onGet(`${BASE}/tags`).reply({ result: true, items: [] })

      await service.getTags('')

      expect(mock.history[0].url).toBe(`${BASE}/tags`)
    })
  })

  describe('renameTag', () => {
    it('sends PUT to /tags with rename body', async () => {
      mock.onPut(`${BASE}/tags`).reply({ result: true })

      await service.renameTag('old', 'new')

      expect(mock.history[0].body).toEqual({
        tags: ['old'],
        replace: 'new',
      })
    })

    it('sends PUT to /tags/:collectionId when scoped', async () => {
      mock.onPut(`${BASE}/tags/42`).reply({ result: true })

      await service.renameTag('old', 'new', 42)

      expect(mock.history[0].url).toBe(`${BASE}/tags/42`)
      expect(mock.history[0].body).toEqual({
        tags: ['old'],
        replace: 'new',
      })
    })
  })

  describe('removeTags', () => {
    it('sends DELETE to /tags with tags array', async () => {
      mock.onDelete(`${BASE}/tags`).reply({ result: true })

      await service.removeTags('tag1, tag2')

      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].body).toEqual({ tags: ['tag1', 'tag2'] })
    })

    it('sends DELETE to /tags/:collectionId when scoped', async () => {
      mock.onDelete(`${BASE}/tags/42`).reply({ result: true })

      await service.removeTags(['a', 'b'], 42)

      expect(mock.history[0].url).toBe(`${BASE}/tags/42`)
      expect(mock.history[0].body).toEqual({ tags: ['a', 'b'] })
    })

    it('sends empty tags array when tags resolve to nothing', async () => {
      mock.onDelete(`${BASE}/tags`).reply({ result: true })

      await service.removeTags('')

      expect(mock.history[0].body).toEqual({ tags: [] })
    })
  })

  // ── Highlights ──

  describe('getAllHighlights', () => {
    it('sends GET to /highlights with pagination query', async () => {
      mock.onGet(`${BASE}/highlights`).reply({ result: true, items: [] })

      await service.getAllHighlights(2, 10)

      expect(mock.history[0].url).toBe(`${BASE}/highlights`)
      expect(mock.history[0].query).toMatchObject({ page: 2, perpage: 10 })
    })

    it('omits undefined pagination params', async () => {
      mock.onGet(`${BASE}/highlights`).reply({ result: true, items: [] })

      await service.getAllHighlights()

      const query = mock.history[0].query
      expect(query.page).toBeUndefined()
      expect(query.perpage).toBeUndefined()
    })
  })

  describe('getHighlightsOfRaindrop', () => {
    it('sends GET to /highlights/:raindropId', async () => {
      const response = { result: true, item: { _id: 999, highlights: [] } }
      mock.onGet(`${BASE}/highlights/999`).reply(response)

      const result = await service.getHighlightsOfRaindrop(999)

      expect(result).toEqual(response)
      expect(mock.history[0].url).toBe(`${BASE}/highlights/999`)
    })
  })

  // ── User ──

  describe('getUser', () => {
    it('sends GET to /user', async () => {
      const response = { result: true, user: { _id: 1, fullName: 'Test' } }
      mock.onGet(`${BASE}/user`).reply(response)

      const result = await service.getUser()

      expect(result).toEqual(response)
      expect(mock.history[0].url).toBe(`${BASE}/user`)
    })
  })

  // ── Dictionary ──

  describe('getCollectionsDictionary', () => {
    it('returns mapped items with label, value, and note', async () => {
      mock.onGet(`${BASE}/collections`).reply({
        result: true,
        items: [{ _id: 1, title: 'Alpha', count: 10 }],
      })
      mock.onGet(`${BASE}/collections/childrens`).reply({
        result: true,
        items: [{ _id: 2, title: 'Beta', count: 5 }],
      })

      const result = await service.getCollectionsDictionary({})

      expect(result).toEqual({
        items: [
          { label: 'Alpha', value: '1', note: '10 bookmarks' },
          { label: 'Beta', value: '2', note: '5 bookmarks' },
        ],
        cursor: null,
      })
    })

    it('filters by case-insensitive search', async () => {
      mock.onGet(`${BASE}/collections`).reply({
        result: true,
        items: [
          { _id: 1, title: 'Alpha', count: 10 },
          { _id: 2, title: 'Beta', count: 5 },
        ],
      })
      mock.onGet(`${BASE}/collections/childrens`).reply({ result: true, items: [] })

      const result = await service.getCollectionsDictionary({ search: 'ALP' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('1')
    })

    it('handles null payload', async () => {
      mock.onGet(`${BASE}/collections`).reply({
        result: true,
        items: [{ _id: 1, title: 'A', count: 0 }],
      })
      mock.onGet(`${BASE}/collections/childrens`).reply({ result: true, items: [] })

      const result = await service.getCollectionsDictionary(null)

      expect(result.items).toHaveLength(1)
      expect(result.cursor).toBeNull()
    })

    it('handles empty/null items from API', async () => {
      mock.onGet(`${BASE}/collections`).reply({ result: true, items: null })
      mock.onGet(`${BASE}/collections/childrens`).reply({ result: true, items: null })

      const result = await service.getCollectionsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('uses fallback label when title is missing', async () => {
      mock.onGet(`${BASE}/collections`).reply({
        result: true,
        items: [{ _id: 99, count: 0 }],
      })
      mock.onGet(`${BASE}/collections/childrens`).reply({ result: true, items: [] })

      const result = await service.getCollectionsDictionary({})

      expect(result.items[0].label).toBe('Collection 99')
    })

    it('limits results to 50 items', async () => {
      const manyItems = Array.from({ length: 60 }, (_, i) => ({
        _id: i, title: `Item ${i}`, count: 0,
      }))
      mock.onGet(`${BASE}/collections`).reply({ result: true, items: manyItems })
      mock.onGet(`${BASE}/collections/childrens`).reply({ result: true, items: [] })

      const result = await service.getCollectionsDictionary({})

      expect(result.items).toHaveLength(50)
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('throws with error.body.errorMessage on HTTP error', async () => {
      mock.onGet(`${BASE}/user`).replyWithError({
        message: 'Bad Request',
        status: 400,
        body: { errorMessage: 'Invalid token' },
      })

      await expect(service.getUser()).rejects.toThrow('Raindrop.io API error: Invalid token (status 400)')
    })

    it('throws with result:false and error field', async () => {
      mock.onGet(`${BASE}/user`).reply({ result: false, error: 'Something went wrong' })

      await expect(service.getUser()).rejects.toThrow('Raindrop.io API error: Something went wrong')
    })

    it('throws generic message when result:false has no error details', async () => {
      mock.onGet(`${BASE}/user`).reply({ result: false })

      await expect(service.getUser()).rejects.toThrow('Raindrop.io API error: Request was not successful')
    })

    it('uses error.message when body is missing', async () => {
      mock.onGet(`${BASE}/user`).replyWithError({ message: 'Network timeout' })

      await expect(service.getUser()).rejects.toThrow('Raindrop.io API error: Network timeout')
    })
  })
})
