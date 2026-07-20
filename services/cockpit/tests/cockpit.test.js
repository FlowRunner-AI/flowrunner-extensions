'use strict'

const { createSandbox } = require('../../../service-sandbox')

const URL = 'https://cms.example.com'
const API_KEY = 'test-api-key'
const BASE = `${ URL }/api`

describe('Cockpit Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ url: URL, apiKey: API_KEY })
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
      expect(sandbox.getConfigItems()).toEqual([
        expect.objectContaining({
          name: 'url',
          displayName: 'Cockpit URL',
          required: true,
          shared: false,
          type: 'STRING',
        }),
        expect.objectContaining({
          name: 'apiKey',
          displayName: 'API Key',
          required: true,
          shared: false,
          type: 'STRING',
        }),
      ])
    })

    it('sends the api-key header and JSON content-type on requests', async () => {
      mock.onGet(`${ BASE }/content/items/posts`).reply([])

      await service.getContentItems('posts')

      expect(mock.history[0].headers).toMatchObject({
        'api-key': API_KEY,
        'Content-Type': 'application/json',
      })
    })

    it('appends /api to the configured url to form the request base', async () => {
      mock.onGet(`${ BASE }/content/items/posts`).reply([])

      await service.getContentItems('posts')

      expect(mock.history[0].url.startsWith(`${ URL }/api/`)).toBe(true)
    })
  })

  // Trailing-slash stripping is verified against a freshly-built service
  // instance (constructed directly) to avoid disturbing the shared sandbox.
  describe('url normalization', () => {
    it('strips trailing slashes from the configured url when building the base', () => {
      const ServiceClass = service.constructor
      const svc = new ServiceClass({ url: 'https://cms.example.com///', apiKey: API_KEY })

      expect(svc.baseUrl).toBe('https://cms.example.com/api')
    })

    it('handles an empty url without throwing', () => {
      const ServiceClass = service.constructor
      const svc = new ServiceClass({ apiKey: API_KEY })

      expect(svc.baseUrl).toBe('/api')
    })
  })

  // ── Content Items ──

  describe('getContentItems', () => {
    it('sends GET to the model items path with required params only', async () => {
      const items = [{ _id: 'a1', title: 'Hello' }]
      mock.onGet(`${ BASE }/content/items/posts`).reply(items)

      const result = await service.getContentItems('posts')

      expect(result).toEqual(items)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/content/items/posts`)
      // clean() removes all undefined values, leaving an empty query.
      expect(mock.history[0].query).toEqual({})
    })

    it('serializes object filter/sort/fields to JSON strings and passes numbers/locale', async () => {
      mock.onGet(`${ BASE }/content/items/posts`).reply([])

      await service.getContentItems(
        'posts',
        { published: true },
        { _created: -1 },
        { title: 1, content: 1 },
        10,
        20,
        1,
        'en'
      )

      expect(mock.history[0].query).toEqual({
        filter: JSON.stringify({ published: true }),
        sort: JSON.stringify({ _created: -1 }),
        fields: JSON.stringify({ title: 1, content: 1 }),
        limit: 10,
        skip: 20,
        populate: 1,
        locale: 'en',
      })
    })

    it('passes already-stringified JSON params through unchanged', async () => {
      mock.onGet(`${ BASE }/content/items/posts`).reply([])

      await service.getContentItems('posts', '{"published":true}')

      expect(mock.history[0].query).toEqual({ filter: '{"published":true}' })
    })

    it('url-encodes the model name', async () => {
      mock.onGet(`${ BASE }/content/items/my%20posts`).reply([])

      await service.getContentItems('my posts')

      expect(mock.history[0].url).toBe(`${ BASE }/content/items/my%20posts`)
    })

    it('throws a wrapped error with status and body.error on API failure', async () => {
      mock.onGet(`${ BASE }/content/items/posts`).replyWithError({
        message: 'Request failed',
        status: 404,
        body: { error: 'Model not found' },
      })

      await expect(service.getContentItems('posts')).rejects.toThrow(
        'Cockpit API error (404): Model not found'
      )
    })

    it('falls back to body.message when body.error is absent', async () => {
      mock.onGet(`${ BASE }/content/items/posts`).replyWithError({
        message: 'Request failed',
        statusCode: 400,
        body: { message: 'Bad filter' },
      })

      await expect(service.getContentItems('posts')).rejects.toThrow(
        'Cockpit API error (400): Bad filter'
      )
    })

    it('stringifies body object when neither error nor message present', async () => {
      mock.onGet(`${ BASE }/content/items/posts`).replyWithError({
        message: 'Request failed',
        status: 422,
        body: { detail: 'oops' },
      })

      await expect(service.getContentItems('posts')).rejects.toThrow(
        `Cockpit API error (422): ${ JSON.stringify({ detail: 'oops' }) }`
      )
    })

    it('uses a string body directly as the message', async () => {
      mock.onGet(`${ BASE }/content/items/posts`).replyWithError({
        message: 'Request failed',
        status: 500,
        body: 'Internal Server Error',
      })

      await expect(service.getContentItems('posts')).rejects.toThrow(
        'Cockpit API error (500): Internal Server Error'
      )
    })

    it('falls back to error.message with no status when body is empty', async () => {
      mock.onGet(`${ BASE }/content/items/posts`).replyWithError({
        message: 'Network down',
      })

      await expect(service.getContentItems('posts')).rejects.toThrow(
        'Cockpit API error: Network down'
      )
    })
  })

  describe('getContentItem', () => {
    it('fetches by id when an id is provided (filter ignored)', async () => {
      const item = { _id: 'abc', title: 'Hello' }
      mock.onGet(`${ BASE }/content/item/posts/abc`).reply(item)

      const result = await service.getContentItem('posts', 'abc', { slug: 'hello' })

      expect(result).toEqual(item)
      expect(mock.history[0].url).toBe(`${ BASE }/content/item/posts/abc`)
      // filter must NOT be sent when id is given.
      expect(mock.history[0].query).toEqual({})
    })

    it('fetches by filter when no id is provided', async () => {
      mock.onGet(`${ BASE }/content/item/posts`).reply({ _id: 'x' })

      await service.getContentItem('posts', undefined, { slug: 'hello-world' }, { title: 1 }, 2, 'en')

      expect(mock.history[0].url).toBe(`${ BASE }/content/item/posts`)
      expect(mock.history[0].query).toEqual({
        filter: JSON.stringify({ slug: 'hello-world' }),
        fields: JSON.stringify({ title: 1 }),
        populate: 2,
        locale: 'en',
      })
    })

    it('sends fields/populate/locale alongside the id path', async () => {
      mock.onGet(`${ BASE }/content/item/posts/abc`).reply({ _id: 'abc' })

      await service.getContentItem('posts', 'abc', undefined, { title: 1 }, 1, 'de')

      expect(mock.history[0].query).toEqual({
        fields: JSON.stringify({ title: 1 }),
        populate: 1,
        locale: 'de',
      })
    })

    it('url-encodes model and id', async () => {
      mock.onGet(`${ BASE }/content/item/my%20posts/a%2Fb`).reply({})

      await service.getContentItem('my posts', 'a/b')

      expect(mock.history[0].url).toBe(`${ BASE }/content/item/my%20posts/a%2Fb`)
    })
  })

  describe('getSingleton', () => {
    it('fetches a singleton by name via the content item path', async () => {
      const singleton = { _id: 's1', siteTitle: 'My Site' }
      mock.onGet(`${ BASE }/content/item/settings`).reply(singleton)

      const result = await service.getSingleton('settings')

      expect(result).toEqual(singleton)
      expect(mock.history[0].url).toBe(`${ BASE }/content/item/settings`)
      expect(mock.history[0].query).toEqual({})
    })

    it('passes locale when provided', async () => {
      mock.onGet(`${ BASE }/content/item/settings`).reply({})

      await service.getSingleton('settings', 'en')

      expect(mock.history[0].query).toEqual({ locale: 'en' })
    })
  })

  describe('saveContentItem', () => {
    it('creates a new item (no _id) with the data wrapped in a data envelope', async () => {
      const saved = { _id: 'new1', title: 'Hello' }
      mock.onPost(`${ BASE }/content/item/posts`).reply(saved)

      const result = await service.saveContentItem('posts', { title: 'Hello', content: 'Lorem' })

      expect(result).toEqual(saved)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/content/item/posts`)
      expect(mock.history[0].body).toEqual({ data: { title: 'Hello', content: 'Lorem' } })
    })

    it('sets _id inside data when updating an existing item', async () => {
      mock.onPost(`${ BASE }/content/item/posts`).reply({ _id: 'e1' })

      await service.saveContentItem('posts', { title: 'Updated' }, 'e1')

      expect(mock.history[0].body).toEqual({ data: { title: 'Updated', _id: 'e1' } })
    })

    it('handles missing data by sending an empty data object', async () => {
      mock.onPost(`${ BASE }/content/item/posts`).reply({ _id: 'e2' })

      await service.saveContentItem('posts', undefined)

      expect(mock.history[0].body).toEqual({ data: {} })
    })
  })

  describe('updateContentItem', () => {
    it('posts data with _id merged in', async () => {
      const updated = { _id: 'e1', title: 'Updated title' }
      mock.onPost(`${ BASE }/content/item/posts`).reply(updated)

      const result = await service.updateContentItem('posts', 'e1', { title: 'Updated title' })

      expect(result).toEqual(updated)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({ data: { title: 'Updated title', _id: 'e1' } })
    })

    it('handles missing data by sending only the _id', async () => {
      mock.onPost(`${ BASE }/content/item/posts`).reply({ _id: 'e1' })

      await service.updateContentItem('posts', 'e1', undefined)

      expect(mock.history[0].body).toEqual({ data: { _id: 'e1' } })
    })
  })

  describe('deleteContentItem', () => {
    it('sends DELETE to the item path with encoded model and id', async () => {
      mock.onDelete(`${ BASE }/content/item/posts/e1`).reply({ success: true })

      const result = await service.deleteContentItem('posts', 'e1')

      expect(result).toEqual({ success: true })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${ BASE }/content/item/posts/e1`)
    })

    it('url-encodes model and id', async () => {
      mock.onDelete(`${ BASE }/content/item/my%20posts/a%2Fb`).reply({ success: true })

      await service.deleteContentItem('my posts', 'a/b')

      expect(mock.history[0].url).toBe(`${ BASE }/content/item/my%20posts/a%2Fb`)
    })
  })

  describe('getContentTree', () => {
    it('sends GET to the tree path with required params only', async () => {
      const tree = [{ _id: 'r1', title: 'Root', children: [] }]
      mock.onGet(`${ BASE }/content/tree/navigation`).reply(tree)

      const result = await service.getContentTree('navigation')

      expect(result).toEqual(tree)
      expect(mock.history[0].url).toBe(`${ BASE }/content/tree/navigation`)
      expect(mock.history[0].query).toEqual({})
    })

    it('serializes fields and passes populate/locale', async () => {
      mock.onGet(`${ BASE }/content/tree/navigation`).reply([])

      await service.getContentTree('navigation', { title: 1 }, 1, 'en')

      expect(mock.history[0].query).toEqual({
        fields: JSON.stringify({ title: 1 }),
        populate: 1,
        locale: 'en',
      })
    })
  })

  describe('countContentItems', () => {
    it('fetches items projecting only _id and returns model + count', async () => {
      mock.onGet(`${ BASE }/content/items/posts`).reply([{ _id: 'a' }, { _id: 'b' }, { _id: 'c' }])

      const result = await service.countContentItems('posts')

      expect(result).toEqual({ model: 'posts', count: 3 })
      expect(mock.history[0].url).toBe(`${ BASE }/content/items/posts`)
      expect(mock.history[0].query).toEqual({ fields: JSON.stringify({ _id: 1 }) })
    })

    it('passes a serialized filter and counts the matching items', async () => {
      mock.onGet(`${ BASE }/content/items/posts`).reply([{ _id: 'a' }])

      const result = await service.countContentItems('posts', { published: true })

      expect(result).toEqual({ model: 'posts', count: 1 })
      expect(mock.history[0].query).toEqual({
        filter: JSON.stringify({ published: true }),
        fields: JSON.stringify({ _id: 1 }),
      })
    })

    it('returns count 0 when the response is not an array', async () => {
      mock.onGet(`${ BASE }/content/items/posts`).reply(null)

      const result = await service.countContentItems('posts')

      expect(result).toEqual({ model: 'posts', count: 0 })
    })
  })

  // ── Assets ──

  describe('listAssets', () => {
    it('sends GET to /assets with no query when called without params', async () => {
      const response = { assets: [], total: 0 }
      mock.onGet(`${ BASE }/assets`).reply(response)

      const result = await service.listAssets()

      expect(result).toEqual(response)
      expect(mock.history[0].url).toBe(`${ BASE }/assets`)
      expect(mock.history[0].query).toEqual({})
    })

    it('serializes filter/sort and passes limit/skip', async () => {
      mock.onGet(`${ BASE }/assets`).reply({ assets: [], total: 0 })

      await service.listAssets({ mime: { $regex: 'image' } }, { _created: -1 }, 5, 10)

      expect(mock.history[0].query).toEqual({
        filter: JSON.stringify({ mime: { $regex: 'image' } }),
        sort: JSON.stringify({ _created: -1 }),
        limit: 5,
        skip: 10,
      })
    })
  })

  describe('getAsset', () => {
    it('sends GET to the asset path with the encoded id', async () => {
      const asset = { _id: 'as1', path: '/2024/photo.jpg', mime: 'image/jpeg' }
      mock.onGet(`${ BASE }/assets/as1`).reply(asset)

      const result = await service.getAsset('as1')

      expect(result).toEqual(asset)
      expect(mock.history[0].url).toBe(`${ BASE }/assets/as1`)
    })

    it('url-encodes the asset id', async () => {
      mock.onGet(`${ BASE }/assets/a%2Fb`).reply({})

      await service.getAsset('a/b')

      expect(mock.history[0].url).toBe(`${ BASE }/assets/a%2Fb`)
    })
  })
})
