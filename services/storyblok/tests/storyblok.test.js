'use strict'

const { createSandbox } = require('../../../service-sandbox')

/**
 * Load the service into a freshly-created sandbox. The service module calls
 * Flowrunner.ServerCode.addService() at require time, and Jest caches modules
 * in its own registry, so jest.resetModules() is needed to re-run registration
 * against a new sandbox.
 */
function loadServiceInto(config) {
  const sandbox = createSandbox(config)

  jest.resetModules()
  require('../src/index.js')

  return sandbox
}

const DELIVERY_TOKEN = 'delivery-token'
const MGMT_TOKEN = 'management-token'
const SPACE_ID = '100001'

const DELIVERY_BASE = 'https://api.storyblok.com/v2/cdn'
const MGMT_BASE = `https://mapi.storyblok.com/v1/spaces/${ SPACE_ID }`

describe('Storyblok Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = loadServiceInto({
      contentDeliveryToken: DELIVERY_TOKEN,
      managementToken: MGMT_TOKEN,
      spaceId: SPACE_ID,
    })

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
    it('registers the expected config items in order', () => {
      const configItems = sandbox.getConfigItems()

      expect(configItems.map(item => item.name)).toEqual([
        'contentDeliveryToken',
        'managementToken',
        'spaceId',
        'region',
      ])
    })

    it('marks every config item as non-shared and optional', () => {
      for (const item of sandbox.getConfigItems()) {
        expect(item.shared).toBe(false)
        expect(item.required).toBe(false)
        expect(typeof item.hint).toBe('string')
      }
    })

    it('declares region as a CHOICE with the supported regions', () => {
      const region = sandbox.getConfigItems().find(item => item.name === 'region')

      expect(region).toMatchObject({
        type: 'CHOICE',
        defaultValue: 'EU',
        options: ['EU', 'US', 'AP', 'CA', 'CN'],
      })
    })
  })

  // ── Content Delivery API ──

  describe('getStories', () => {
    it('defaults to the published version and sends the delivery token', async () => {
      mock.onGet(`${ DELIVERY_BASE }/stories`).reply({ stories: [], cv: 1 })

      const result = await service.getStories()

      expect(result).toEqual({ stories: [], cv: 1 })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].headers).toMatchObject({ 'Content-Type': 'application/json' })

      expect(mock.history[0].query).toEqual({
        token: DELIVERY_TOKEN,
        version: 'published',
      })
    })

    it('maps the Draft label to the draft version', async () => {
      mock.onGet(`${ DELIVERY_BASE }/stories`).reply({ stories: [] })

      await service.getStories('Draft')

      expect(mock.history[0].query.version).toBe('draft')
    })

    it('passes an unknown version value through unchanged', async () => {
      mock.onGet(`${ DELIVERY_BASE }/stories`).reply({ stories: [] })

      await service.getStories('custom')

      expect(mock.history[0].query.version).toBe('custom')
    })

    it('sends pagination, prefix and sort parameters', async () => {
      mock.onGet(`${ DELIVERY_BASE }/stories`).reply({ stories: [] })

      await service.getStories('Published', 'blog/', 50, 2, 'created_at:desc')

      expect(mock.history[0].query).toEqual({
        token: DELIVERY_TOKEN,
        version: 'published',
        starts_with: 'blog/',
        per_page: 50,
        page: 2,
        sort_by: 'created_at:desc',
      })
    })

    it('flattens a filter query into bracket syntax', async () => {
      mock.onGet(`${ DELIVERY_BASE }/stories`).reply({ stories: [] })

      await service.getStories(undefined, undefined, undefined, undefined, undefined, {
        component: { in: 'page' },
        category: { in: 'news', not_in: 'archive' },
      })

      expect(mock.history[0].query).toMatchObject({
        'filter_query[component][in]': 'page',
        'filter_query[category][in]': 'news',
        'filter_query[category][not_in]': 'archive',
      })
    })

    it('ignores non-object filter fields', async () => {
      mock.onGet(`${ DELIVERY_BASE }/stories`).reply({ stories: [] })

      await service.getStories(undefined, undefined, undefined, undefined, undefined, {
        component: 'page',
      })

      expect(Object.keys(mock.history[0].query)).toEqual(['token', 'version'])
    })

    it('ignores a non-object filter query argument', async () => {
      mock.onGet(`${ DELIVERY_BASE }/stories`).reply({ stories: [] })

      await service.getStories(undefined, undefined, undefined, undefined, undefined, 'nope')

      expect(Object.keys(mock.history[0].query)).toEqual(['token', 'version'])
    })

    it('throws a descriptive error when the API fails', async () => {
      mock.onGet(`${ DELIVERY_BASE }/stories`).replyWithError({
        status: 401,
        body: { error: 'Unauthorized' },
      })

      await expect(service.getStories()).rejects.toThrow('Storyblok API error (401): Unauthorized')
    })
  })

  describe('getStory', () => {
    it('encodes the slug and requests the published version by default', async () => {
      mock.onGet(`${ DELIVERY_BASE }/stories/blog%2Fmy-post`).reply({ story: { id: 1 } })

      const result = await service.getStory('blog/my-post')

      expect(result).toEqual({ story: { id: 1 } })
      expect(mock.history[0].url).toBe(`${ DELIVERY_BASE }/stories/blog%2Fmy-post`)
      expect(mock.history[0].query).toEqual({ token: DELIVERY_TOKEN, version: 'published' })
    })

    it('requests the draft version when asked', async () => {
      mock.onGet(`${ DELIVERY_BASE }/stories/home`).reply({ story: { id: 2 } })

      await service.getStory('home', 'Draft')

      expect(mock.history[0].query.version).toBe('draft')
    })
  })

  describe('getDatasourceEntries', () => {
    it('sends only the provided parameters', async () => {
      mock.onGet(`${ DELIVERY_BASE }/datasource_entries`).reply({ datasource_entries: [] })

      const result = await service.getDatasourceEntries('colors', 'de', 100, 3)

      expect(result).toEqual({ datasource_entries: [] })

      expect(mock.history[0].query).toEqual({
        token: DELIVERY_TOKEN,
        datasource: 'colors',
        dimension: 'de',
        per_page: 100,
        page: 3,
      })
    })

    it('omits empty optional parameters', async () => {
      mock.onGet(`${ DELIVERY_BASE }/datasource_entries`).reply({ datasource_entries: [] })

      await service.getDatasourceEntries()

      expect(mock.history[0].query).toEqual({ token: DELIVERY_TOKEN })
    })
  })

  describe('getLinks', () => {
    it('sends version and prefix', async () => {
      mock.onGet(`${ DELIVERY_BASE }/links`).reply({ links: {} })

      const result = await service.getLinks('Draft', 'blog/')

      expect(result).toEqual({ links: {} })

      expect(mock.history[0].query).toEqual({
        token: DELIVERY_TOKEN,
        version: 'draft',
        starts_with: 'blog/',
      })
    })
  })

  describe('getTags', () => {
    it('sends the slug prefix when provided', async () => {
      mock.onGet(`${ DELIVERY_BASE }/tags`).reply({ tags: [] })

      await service.getTags('blog/')

      expect(mock.history[0].query).toEqual({ token: DELIVERY_TOKEN, starts_with: 'blog/' })
    })

    it('sends only the token when no prefix is given', async () => {
      mock.onGet(`${ DELIVERY_BASE }/tags`).reply({ tags: [] })

      await service.getTags()

      expect(mock.history[0].query).toEqual({ token: DELIVERY_TOKEN })
    })
  })

  // ── Content Management API ──

  describe('createStory', () => {
    it('posts a cleaned story envelope with the management token', async () => {
      mock.onPost(`${ MGMT_BASE }/stories`).reply({ story: { id: 5 } })

      const result = await service.createStory('Post', 'post', { component: 'page' })

      expect(result).toEqual({ story: { id: 5 } })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].headers).toMatchObject({ 'Authorization': MGMT_TOKEN })

      expect(mock.history[0].body).toEqual({
        story: { name: 'Post', slug: 'post', content: { component: 'page' } },
      })

      expect(mock.history[0].query).toEqual({})
    })

    it('includes the parent id and the publish flag', async () => {
      mock.onPost(`${ MGMT_BASE }/stories`).reply({ story: { id: 6 } })

      await service.createStory('Post', 'post', { component: 'page' }, 42, true)

      expect(mock.history[0].body.story).toMatchObject({ parent_id: 42 })
      expect(mock.history[0].query).toEqual({ publish: 1 })
    })
  })

  describe('updateStory', () => {
    it('sends only the supplied fields', async () => {
      mock.onPut(`${ MGMT_BASE }/stories/12`).reply({ story: { id: 12 } })

      await service.updateStory(12, 'New name')

      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].body).toEqual({ story: { name: 'New name' } })
      expect(mock.history[0].query).toEqual({})
    })

    it('publishes when the publish flag is set', async () => {
      mock.onPut(`${ MGMT_BASE }/stories/12`).reply({ story: { id: 12 } })

      await service.updateStory(12, undefined, 'new-slug', { component: 'page' }, true)

      expect(mock.history[0].body).toEqual({
        story: { slug: 'new-slug', content: { component: 'page' } },
      })

      expect(mock.history[0].query).toEqual({ publish: 1 })
    })
  })

  describe('deleteStory', () => {
    it('sends a DELETE for the given story id', async () => {
      mock.onDelete(`${ MGMT_BASE }/stories/12`).reply({ story: { id: 12 } })

      const result = await service.deleteStory(12)

      expect(result).toEqual({ story: { id: 12 } })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].headers).toMatchObject({ 'Authorization': MGMT_TOKEN })
      expect(mock.history[0].body).toBeUndefined()
    })
  })

  describe('publishStory', () => {
    it('calls the publish endpoint without a language', async () => {
      mock.onGet(`${ MGMT_BASE }/stories/12/publish`).reply({ story: { published: true } })

      const result = await service.publishStory(12)

      expect(result).toEqual({ story: { published: true } })
      expect(mock.history[0].query).toEqual({})
    })

    it('passes the language when publishing a translation', async () => {
      mock.onGet(`${ MGMT_BASE }/stories/12/publish`).reply({ story: { published: true } })

      await service.publishStory(12, 'de')

      expect(mock.history[0].query).toEqual({ lang: 'de' })
    })
  })

  describe('listStories', () => {
    it('sends pagination and search parameters', async () => {
      mock.onGet(`${ MGMT_BASE }/stories`).reply({ stories: [] })

      await service.listStories('blog/', 'hello', 10, 2)

      expect(mock.history[0].query).toEqual({
        starts_with: 'blog/',
        search: 'hello',
        per_page: 10,
        page: 2,
      })

      expect(mock.history[0].headers).toMatchObject({ 'Authorization': MGMT_TOKEN })
    })

    it('sends no query parameters when none are provided', async () => {
      mock.onGet(`${ MGMT_BASE }/stories`).reply({ stories: [] })

      await service.listStories()

      expect(mock.history[0].query).toEqual({})
    })
  })

  describe('getSpace', () => {
    it('requests the space root URL', async () => {
      mock.onGet(MGMT_BASE).reply({ space: { id: 100001 } })

      const result = await service.getSpace()

      expect(result).toEqual({ space: { id: 100001 } })
      expect(mock.history[0].url).toBe(MGMT_BASE)
    })
  })

  describe('listAssets', () => {
    it('maps the folder id to in_folder', async () => {
      mock.onGet(`${ MGMT_BASE }/assets`).reply({ assets: [] })

      await service.listAssets(7, 'logo', 25, 1)

      expect(mock.history[0].query).toEqual({
        in_folder: 7,
        search: 'logo',
        per_page: 25,
        page: 1,
      })
    })

    it('omits empty optional parameters', async () => {
      mock.onGet(`${ MGMT_BASE }/assets`).reply({ assets: [] })

      await service.listAssets()

      expect(mock.history[0].query).toEqual({})
    })
  })

  // ── Error normalization ──

  describe('error normalization', () => {
    it('uses body.message when body.error is absent', async () => {
      mock.onGet(`${ DELIVERY_BASE }/tags`).replyWithError({
        statusCode: 500,
        body: { message: 'Server exploded' },
      })

      await expect(service.getTags()).rejects.toThrow('Storyblok API error (500): Server exploded')
    })

    it('stringifies an unrecognized object body', async () => {
      mock.onGet(`${ DELIVERY_BASE }/tags`).replyWithError({
        status: 422,
        body: { slug: ['has already been taken'] },
      })

      await expect(service.getTags()).rejects.toThrow(
        'Storyblok API error (422): {"slug":["has already been taken"]}'
      )
    })

    it('uses a string body verbatim', async () => {
      mock.onGet(`${ DELIVERY_BASE }/tags`).replyWithError({
        status: 404,
        body: 'Not Found',
      })

      await expect(service.getTags()).rejects.toThrow('Storyblok API error (404): Not Found')
    })

    it('falls back to the error message and omits the status when unavailable', async () => {
      mock.onGet(`${ DELIVERY_BASE }/tags`).replyWithError({ message: 'socket hang up' })

      await expect(service.getTags()).rejects.toThrow('Storyblok API error: socket hang up')
    })
  })
})

// ── Configuration guards & regions ──

describe('Storyblok Service configuration guards', () => {
  afterEach(() => {
    delete global.Flowrunner
  })

  it('throws when a delivery operation is used without a delivery token', async () => {
    const sandbox = loadServiceInto({ managementToken: MGMT_TOKEN, spaceId: SPACE_ID })
    const service = sandbox.getService()

    await expect(service.getTags()).rejects.toThrow(
      'Storyblok API error: Content Delivery token is required for read operations. Set it in the service configuration.'
    )

    expect(sandbox.getRequestMock().history).toHaveLength(0)

    sandbox.cleanup()
  })

  it('throws when a management operation is used without a space id', async () => {
    const sandbox = loadServiceInto({ managementToken: MGMT_TOKEN })
    const service = sandbox.getService()

    await expect(service.getSpace()).rejects.toThrow(
      'Storyblok API error: Space ID is required for Management API operations. Set it in the service configuration.'
    )

    sandbox.cleanup()
  })

  it('throws when a management operation is used without a management token', async () => {
    const sandbox = loadServiceInto({ spaceId: SPACE_ID })
    const service = sandbox.getService()

    await expect(service.deleteStory(1)).rejects.toThrow(
      'Storyblok API error: Management token is required for write operations. Set it in the service configuration.'
    )

    expect(sandbox.getRequestMock().history).toHaveLength(0)

    sandbox.cleanup()
  })

  it.each([
    ['US', 'https://api-us.storyblok.com', 'https://api-us.storyblok.com'],
    ['AP', 'https://api-ap.storyblok.com', 'https://api-ap.storyblok.com'],
    ['CA', 'https://api-ca.storyblok.com', 'https://api-ca.storyblok.com'],
    ['CN', 'https://app.storyblokchina.cn', 'https://app.storyblokchina.cn'],
  ])('routes %s traffic to the regional hosts', async (region, deliveryHost, mgmtHost) => {
    const sandbox = loadServiceInto({
      contentDeliveryToken: DELIVERY_TOKEN,
      managementToken: MGMT_TOKEN,
      spaceId: SPACE_ID,
      region,
    })
    const service = sandbox.getService()
    const mock = sandbox.getRequestMock()

    mock.onGet(`${ deliveryHost }/v2/cdn/tags`).reply({ tags: [] })
    mock.onGet(`${ mgmtHost }/v1/spaces/${ SPACE_ID }`).reply({ space: {} })

    await service.getTags()
    await service.getSpace()

    expect(mock.history[0].url).toBe(`${ deliveryHost }/v2/cdn/tags`)
    expect(mock.history[1].url).toBe(`${ mgmtHost }/v1/spaces/${ SPACE_ID }`)

    sandbox.cleanup()
  })

  it('falls back to the EU hosts for an unknown region', async () => {
    const sandbox = loadServiceInto({
      contentDeliveryToken: DELIVERY_TOKEN,
      managementToken: MGMT_TOKEN,
      spaceId: SPACE_ID,
      region: 'MARS',
    })
    const service = sandbox.getService()
    const mock = sandbox.getRequestMock()

    mock.onGet(`${ DELIVERY_BASE }/tags`).reply({ tags: [] })
    mock.onGet(MGMT_BASE).reply({ space: {} })

    await service.getTags()
    await service.getSpace()

    expect(mock.history[0].url).toBe(`${ DELIVERY_BASE }/tags`)
    expect(mock.history[1].url).toBe(MGMT_BASE)

    sandbox.cleanup()
  })
})
