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

const SPACE_ID = 'space123'
const ENV_ID = 'staging'
const MGMT_TOKEN = 'CFPAT-management-token'
const DELIVERY_TOKEN = 'delivery-token'
const DEFAULT_LOCALE = 'en-US'

const CMA = 'https://api.contentful.com'
const CDA = 'https://cdn.contentful.com'
const ENV_PATH = `/spaces/${ SPACE_ID }/environments/${ ENV_ID }`
const CMA_BASE = `${ CMA }${ ENV_PATH }`
const CDA_BASE = `${ CDA }${ ENV_PATH }`

const MGMT_CONTENT_TYPE = 'application/vnd.contentful.management.v1+json'

describe('Contentful Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = loadServiceInto({
      spaceId: SPACE_ID,
      environmentId: ENV_ID,
      managementToken: MGMT_TOKEN,
      deliveryToken: DELIVERY_TOKEN,
      defaultLocale: DEFAULT_LOCALE,
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
    it('registers with correct config items', () => {
      expect(sandbox.getConfigItems()).toEqual([
        expect.objectContaining({ name: 'spaceId', required: true, shared: false, type: 'STRING' }),
        expect.objectContaining({ name: 'environmentId', required: false, shared: false, type: 'STRING', defaultValue: 'master' }),
        expect.objectContaining({ name: 'managementToken', required: true, shared: false, type: 'STRING' }),
        expect.objectContaining({ name: 'deliveryToken', required: false, shared: false, type: 'STRING' }),
        expect.objectContaining({ name: 'defaultLocale', required: false, shared: false, type: 'STRING', defaultValue: 'en-US' }),
      ])
    })

    it('never sets shared:true on any config item', () => {
      for (const item of sandbox.getConfigItems()) {
        expect(item.shared).toBe(false)
      }
    })
  })

  // ── Auth / host routing ──

  describe('auth headers and host routing', () => {
    it('uses the management token + CMA host for management reads', async () => {
      mock.onGet(`${ CMA_BASE }/entries/e1`).reply({ sys: { id: 'e1' } })

      await service.getEntry('e1')

      expect(mock.history[0].url).toBe(`${ CMA_BASE }/entries/e1`)
      expect(mock.history[0].headers).toMatchObject({
        'Authorization': `Bearer ${ MGMT_TOKEN }`,
        'Content-Type': MGMT_CONTENT_TYPE,
      })
    })

    it('uses the delivery token + CDA host for delivery reads', async () => {
      mock.onGet(`${ CDA_BASE }/entries`).reply({ items: [] })

      await service.getPublishedEntries()

      expect(mock.history[0].url).toBe(`${ CDA_BASE }/entries`)
      expect(mock.history[0].headers).toMatchObject({
        'Authorization': `Bearer ${ DELIVERY_TOKEN }`,
      })
    })

    it('threads space and environment into the path', async () => {
      mock.onGet(`${ CMA_BASE }/locales`).reply({ items: [] })

      await service.listLocales()

      expect(mock.history[0].url).toContain(`/spaces/${ SPACE_ID }/environments/${ ENV_ID }/`)
    })
  })

  // ── Entries (CMA) ──

  describe('createEntry', () => {
    it('sends POST to /entries with content-type header and localized fields', async () => {
      mock.onPost(`${ CMA_BASE }/entries`).reply({ sys: { id: 'e1', version: 1 } })

      const result = await service.createEntry('blogPost', { title: 'Hello', slug: 'hello' })

      expect(result).toEqual({ sys: { id: 'e1', version: 1 } })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ CMA_BASE }/entries`)
      expect(mock.history[0].headers).toMatchObject({ 'X-Contentful-Content-Type': 'blogPost' })
      expect(mock.history[0].body).toEqual({
        fields: {
          title: { 'en-US': 'Hello' },
          slug: { 'en-US': 'hello' },
        },
      })
    })

    it('uses a custom locale when provided', async () => {
      mock.onPost(`${ CMA_BASE }/entries`).reply({ sys: { id: 'e2' } })

      await service.createEntry('blogPost', { title: 'Bonjour' }, 'fr-FR')

      expect(mock.history[0].body).toEqual({ fields: { title: { 'fr-FR': 'Bonjour' } } })
    })

    it('passes through values that are already locale-keyed', async () => {
      mock.onPost(`${ CMA_BASE }/entries`).reply({ sys: { id: 'e3' } })

      await service.createEntry('blogPost', { title: { 'en-US': 'Hi', 'de-DE': 'Hallo' } })

      expect(mock.history[0].body).toEqual({
        fields: { title: { 'en-US': 'Hi', 'de-DE': 'Hallo' } },
      })
    })

    it('throws a Contentful API error on failure', async () => {
      mock.onPost(`${ CMA_BASE }/entries`).replyWithError({
        message: 'Request failed',
        body: { message: 'Validation error', sys: { id: 'ValidationFailed' }, details: { errors: [] } },
      })

      await expect(service.createEntry('blogPost', { title: 'x' })).rejects.toThrow(
        'Contentful API error: Validation error [ValidationFailed]'
      )
    })
  })

  describe('getEntry', () => {
    it('sends GET to /entries/{id}', async () => {
      mock.onGet(`${ CMA_BASE }/entries/e1`).reply({ sys: { id: 'e1', version: 3 } })

      const result = await service.getEntry('e1')

      expect(result).toEqual({ sys: { id: 'e1', version: 3 } })
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ CMA_BASE }/entries/e1`)
    })

    it('throws on API error', async () => {
      mock.onGet(`${ CMA_BASE }/entries/missing`).replyWithError({
        message: 'Not found',
        body: { message: 'The resource could not be found.', sys: { id: 'NotFound' } },
      })

      await expect(service.getEntry('missing')).rejects.toThrow('Contentful API error: The resource could not be found. [NotFound]')
    })
  })

  describe('listEntries', () => {
    it('sends GET to /entries with no query by default', async () => {
      mock.onGet(`${ CMA_BASE }/entries`).reply({ items: [], total: 0 })

      const result = await service.listEntries()

      expect(result).toEqual({ items: [], total: 0 })
      expect(mock.history[0].query).toEqual({})
    })

    it('forwards query parameters', async () => {
      mock.onGet(`${ CMA_BASE }/entries`).reply({ items: [{ sys: { id: 'e1' } }], total: 1 })

      await service.listEntries({ content_type: 'blogPost', limit: 25, order: '-sys.createdAt' })

      expect(mock.history[0].query).toMatchObject({
        content_type: 'blogPost',
        limit: 25,
        order: '-sys.createdAt',
      })
    })
  })

  describe('updateEntry', () => {
    it('uses the supplied version without a pre-fetch', async () => {
      mock.onPut(`${ CMA_BASE }/entries/e1`).reply({ sys: { id: 'e1', version: 4 } })

      const result = await service.updateEntry('e1', { title: 'Updated' }, 3)

      expect(result).toEqual({ sys: { id: 'e1', version: 4 } })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].headers).toMatchObject({ 'X-Contentful-Version': '3' })
      expect(mock.history[0].body).toEqual({ fields: { title: { 'en-US': 'Updated' } } })
    })

    it('fetches the current version first when version is omitted', async () => {
      mock.onGet(`${ CMA_BASE }/entries/e1`).reply({ sys: { id: 'e1', version: 7 } })
      mock.onPut(`${ CMA_BASE }/entries/e1`).reply({ sys: { id: 'e1', version: 8 } })

      await service.updateEntry('e1', { title: 'Auto' })

      expect(mock.history).toHaveLength(2)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[1].method).toBe('put')
      expect(mock.history[1].headers).toMatchObject({ 'X-Contentful-Version': '7' })
    })

    it('applies a custom locale', async () => {
      mock.onPut(`${ CMA_BASE }/entries/e1`).reply({ sys: { id: 'e1' } })

      await service.updateEntry('e1', { title: 'Hallo' }, 2, 'de-DE')

      expect(mock.history[0].body).toEqual({ fields: { title: { 'de-DE': 'Hallo' } } })
    })
  })

  describe('deleteEntry', () => {
    it('unpublishes then deletes and returns a success object', async () => {
      mock.onDelete(`${ CMA_BASE }/entries/e1/published`).reply({})
      mock.onDelete(`${ CMA_BASE }/entries/e1`).reply({})

      const result = await service.deleteEntry('e1')

      expect(result).toEqual({ success: true, entryId: 'e1' })
      expect(mock.history).toHaveLength(2)
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${ CMA_BASE }/entries/e1/published`)
      expect(mock.history[1].url).toBe(`${ CMA_BASE }/entries/e1`)
    })

    it('still deletes when the entry was not published', async () => {
      mock.onDelete(`${ CMA_BASE }/entries/e1/published`).replyWithError({
        message: 'Not published',
        body: { message: 'Not published', sys: { id: 'BadRequest' } },
      })
      mock.onDelete(`${ CMA_BASE }/entries/e1`).reply({})

      const result = await service.deleteEntry('e1')

      expect(result).toEqual({ success: true, entryId: 'e1' })
      expect(mock.history).toHaveLength(2)
    })

    it('propagates an error from the final delete', async () => {
      mock.onDelete(`${ CMA_BASE }/entries/e1/published`).reply({})
      mock.onDelete(`${ CMA_BASE }/entries/e1`).replyWithError({
        message: 'Forbidden',
        body: { message: 'Forbidden', sys: { id: 'AccessDenied' } },
      })

      await expect(service.deleteEntry('e1')).rejects.toThrow('Contentful API error: Forbidden [AccessDenied]')
    })
  })

  describe('publishEntry', () => {
    it('publishes using the supplied version', async () => {
      mock.onPut(`${ CMA_BASE }/entries/e1/published`).reply({ sys: { id: 'e1', version: 5 } })

      const result = await service.publishEntry('e1', 4)

      expect(result).toEqual({ sys: { id: 'e1', version: 5 } })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].url).toBe(`${ CMA_BASE }/entries/e1/published`)
      expect(mock.history[0].headers).toMatchObject({ 'X-Contentful-Version': '4' })
    })

    it('fetches the version when omitted', async () => {
      mock.onGet(`${ CMA_BASE }/entries/e1`).reply({ sys: { id: 'e1', version: 9 } })
      mock.onPut(`${ CMA_BASE }/entries/e1/published`).reply({ sys: { id: 'e1', version: 10 } })

      await service.publishEntry('e1')

      expect(mock.history).toHaveLength(2)
      expect(mock.history[1].headers).toMatchObject({ 'X-Contentful-Version': '9' })
    })
  })

  describe('unpublishEntry', () => {
    it('sends DELETE to /entries/{id}/published', async () => {
      mock.onDelete(`${ CMA_BASE }/entries/e1/published`).reply({ sys: { id: 'e1', version: 6 } })

      const result = await service.unpublishEntry('e1')

      expect(result).toEqual({ sys: { id: 'e1', version: 6 } })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('delete')
    })
  })

  describe('archiveEntry', () => {
    it('archives with the supplied version', async () => {
      mock.onPut(`${ CMA_BASE }/entries/e1/archived`).reply({ sys: { id: 'e1', version: 7 } })

      await service.archiveEntry('e1', 6)

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].url).toBe(`${ CMA_BASE }/entries/e1/archived`)
      expect(mock.history[0].headers).toMatchObject({ 'X-Contentful-Version': '6' })
    })

    it('fetches the version when omitted', async () => {
      mock.onGet(`${ CMA_BASE }/entries/e1`).reply({ sys: { id: 'e1', version: 3 } })
      mock.onPut(`${ CMA_BASE }/entries/e1/archived`).reply({ sys: { id: 'e1', version: 4 } })

      await service.archiveEntry('e1')

      expect(mock.history).toHaveLength(2)
      expect(mock.history[1].headers).toMatchObject({ 'X-Contentful-Version': '3' })
    })
  })

  describe('unarchiveEntry', () => {
    it('sends DELETE to /entries/{id}/archived', async () => {
      mock.onDelete(`${ CMA_BASE }/entries/e1/archived`).reply({ sys: { id: 'e1', version: 8 } })

      const result = await service.unarchiveEntry('e1')

      expect(result).toEqual({ sys: { id: 'e1', version: 8 } })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${ CMA_BASE }/entries/e1/archived`)
    })
  })

  // ── Published content (CDA) ──

  describe('getPublishedEntries', () => {
    it('hits the CDA host with the delivery token', async () => {
      mock.onGet(`${ CDA_BASE }/entries`).reply({ items: [{ sys: { id: 'e1' } }], total: 1 })

      const result = await service.getPublishedEntries({ content_type: 'blogPost', limit: 10 })

      expect(result.total).toBe(1)
      expect(mock.history[0].url).toBe(`${ CDA_BASE }/entries`)
      expect(mock.history[0].headers).toMatchObject({ 'Authorization': `Bearer ${ DELIVERY_TOKEN }` })
      expect(mock.history[0].query).toMatchObject({ content_type: 'blogPost', limit: 10 })
    })

    it('defaults to an empty query', async () => {
      mock.onGet(`${ CDA_BASE }/entries`).reply({ items: [] })

      await service.getPublishedEntries()

      expect(mock.history[0].query).toEqual({})
    })
  })

  describe('getPublishedEntry', () => {
    it('hits the CDA host and omits an absent locale', async () => {
      mock.onGet(`${ CDA_BASE }/entries/e1`).reply({ sys: { id: 'e1' }, fields: { title: 'Hello' } })

      const result = await service.getPublishedEntry('e1')

      expect(result.fields.title).toBe('Hello')
      expect(mock.history[0].url).toBe(`${ CDA_BASE }/entries/e1`)
      expect(mock.history[0].query).toEqual({})
    })

    it('forwards a supplied locale', async () => {
      mock.onGet(`${ CDA_BASE }/entries/e1`).reply({ sys: { id: 'e1' } })

      await service.getPublishedEntry('e1', '*')

      expect(mock.history[0].query).toMatchObject({ locale: '*' })
    })
  })

  // ── Assets (CMA) ──

  describe('createAsset', () => {
    it('sends POST to /assets with localized fields', async () => {
      mock.onPost(`${ CMA_BASE }/assets`).reply({ sys: { id: 'a1', version: 1 } })

      const result = await service.createAsset({
        title: 'Pic',
        file: { contentType: 'image/png', fileName: 'p.png', upload: 'https://x/p.png' },
      })

      expect(result).toEqual({ sys: { id: 'a1', version: 1 } })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ CMA_BASE }/assets`)
      expect(mock.history[0].body).toEqual({
        fields: {
          title: { 'en-US': 'Pic' },
          file: { 'en-US': { contentType: 'image/png', fileName: 'p.png', upload: 'https://x/p.png' } },
        },
      })
    })
  })

  describe('getAsset', () => {
    it('sends GET to /assets/{id}', async () => {
      mock.onGet(`${ CMA_BASE }/assets/a1`).reply({ sys: { id: 'a1', version: 3 } })

      const result = await service.getAsset('a1')

      expect(result).toEqual({ sys: { id: 'a1', version: 3 } })
      expect(mock.history[0].url).toBe(`${ CMA_BASE }/assets/a1`)
    })
  })

  describe('listAssets', () => {
    it('sends GET to /assets and forwards query', async () => {
      mock.onGet(`${ CMA_BASE }/assets`).reply({ items: [], total: 0 })

      await service.listAssets({ limit: 25, order: '-sys.updatedAt' })

      expect(mock.history[0].url).toBe(`${ CMA_BASE }/assets`)
      expect(mock.history[0].query).toMatchObject({ limit: 25, order: '-sys.updatedAt' })
    })
  })

  describe('processAsset', () => {
    it('processes with the supplied version and default locale', async () => {
      mock.onPut(`${ CMA_BASE }/assets/a1/files/en-US/process`).reply({})

      const result = await service.processAsset('a1', 2)

      expect(result).toEqual({ success: true, assetId: 'a1', locale: 'en-US' })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].url).toBe(`${ CMA_BASE }/assets/a1/files/en-US/process`)
      expect(mock.history[0].headers).toMatchObject({ 'X-Contentful-Version': '2' })
    })

    it('uses a custom locale in the URL and reports it', async () => {
      mock.onPut(`${ CMA_BASE }/assets/a1/files/de-DE/process`).reply({})

      const result = await service.processAsset('a1', 2, 'de-DE')

      expect(result).toEqual({ success: true, assetId: 'a1', locale: 'de-DE' })
      expect(mock.history[0].url).toBe(`${ CMA_BASE }/assets/a1/files/de-DE/process`)
    })

    it('fetches the version when omitted', async () => {
      mock.onGet(`${ CMA_BASE }/assets/a1`).reply({ sys: { id: 'a1', version: 5 } })
      mock.onPut(`${ CMA_BASE }/assets/a1/files/en-US/process`).reply({})

      await service.processAsset('a1')

      expect(mock.history).toHaveLength(2)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[1].headers).toMatchObject({ 'X-Contentful-Version': '5' })
    })
  })

  describe('publishAsset', () => {
    it('publishes with the supplied version', async () => {
      mock.onPut(`${ CMA_BASE }/assets/a1/published`).reply({ sys: { id: 'a1', version: 5 } })

      await service.publishAsset('a1', 4)

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].url).toBe(`${ CMA_BASE }/assets/a1/published`)
      expect(mock.history[0].headers).toMatchObject({ 'X-Contentful-Version': '4' })
    })

    it('fetches the version when omitted', async () => {
      mock.onGet(`${ CMA_BASE }/assets/a1`).reply({ sys: { id: 'a1', version: 8 } })
      mock.onPut(`${ CMA_BASE }/assets/a1/published`).reply({ sys: { id: 'a1', version: 9 } })

      await service.publishAsset('a1')

      expect(mock.history).toHaveLength(2)
      expect(mock.history[1].headers).toMatchObject({ 'X-Contentful-Version': '8' })
    })
  })

  describe('deleteAsset', () => {
    it('unpublishes then deletes and returns a success object', async () => {
      mock.onDelete(`${ CMA_BASE }/assets/a1/published`).reply({})
      mock.onDelete(`${ CMA_BASE }/assets/a1`).reply({})

      const result = await service.deleteAsset('a1')

      expect(result).toEqual({ success: true, assetId: 'a1' })
      expect(mock.history).toHaveLength(2)
      expect(mock.history[0].url).toBe(`${ CMA_BASE }/assets/a1/published`)
      expect(mock.history[1].url).toBe(`${ CMA_BASE }/assets/a1`)
    })

    it('still deletes when the asset was not published', async () => {
      mock.onDelete(`${ CMA_BASE }/assets/a1/published`).replyWithError({
        message: 'Not published',
        body: { message: 'Not published', sys: { id: 'BadRequest' } },
      })
      mock.onDelete(`${ CMA_BASE }/assets/a1`).reply({})

      const result = await service.deleteAsset('a1')

      expect(result).toEqual({ success: true, assetId: 'a1' })
      expect(mock.history).toHaveLength(2)
    })
  })

  // ── Content Types (CMA) ──

  describe('listContentTypes', () => {
    it('sends GET to /content_types and forwards query', async () => {
      mock.onGet(`${ CMA_BASE }/content_types`).reply({ items: [], total: 0 })

      await service.listContentTypes({ limit: 50, order: 'name' })

      expect(mock.history[0].url).toBe(`${ CMA_BASE }/content_types`)
      expect(mock.history[0].query).toMatchObject({ limit: 50, order: 'name' })
    })
  })

  describe('getContentType', () => {
    it('sends GET to /content_types/{id}', async () => {
      mock.onGet(`${ CMA_BASE }/content_types/blogPost`).reply({ sys: { id: 'blogPost', version: 2 } })

      const result = await service.getContentType('blogPost')

      expect(result).toEqual({ sys: { id: 'blogPost', version: 2 } })
      expect(mock.history[0].url).toBe(`${ CMA_BASE }/content_types/blogPost`)
    })
  })

  describe('createContentType', () => {
    it('sends PUT with body and no version header when creating', async () => {
      mock.onPut(`${ CMA_BASE }/content_types/blogPost`).reply({ sys: { id: 'blogPost', version: 1 } })

      const fields = [{ id: 'title', name: 'Title', type: 'Symbol' }]
      await service.createContentType('blogPost', 'Blog Post', fields, 'title')

      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].url).toBe(`${ CMA_BASE }/content_types/blogPost`)
      expect(mock.history[0].headers).not.toHaveProperty('X-Contentful-Version')
      expect(mock.history[0].body).toEqual({ name: 'Blog Post', fields, displayField: 'title' })
    })

    it('omits an undefined displayField from the body', async () => {
      mock.onPut(`${ CMA_BASE }/content_types/blogPost`).reply({ sys: { id: 'blogPost', version: 1 } })

      const fields = [{ id: 'title', name: 'Title', type: 'Symbol' }]
      await service.createContentType('blogPost', 'Blog Post', fields)

      expect(mock.history[0].body).toEqual({ name: 'Blog Post', fields })
    })

    it('sends the version header when updating', async () => {
      mock.onPut(`${ CMA_BASE }/content_types/blogPost`).reply({ sys: { id: 'blogPost', version: 3 } })

      const fields = [{ id: 'title', name: 'Title', type: 'Symbol' }]
      await service.createContentType('blogPost', 'Blog Post', fields, 'title', 2)

      expect(mock.history[0].headers).toMatchObject({ 'X-Contentful-Version': '2' })
    })
  })

  describe('activateContentType', () => {
    it('activates with the supplied version', async () => {
      mock.onPut(`${ CMA_BASE }/content_types/blogPost/published`).reply({ sys: { id: 'blogPost', version: 2 } })

      await service.activateContentType('blogPost', 1)

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].url).toBe(`${ CMA_BASE }/content_types/blogPost/published`)
      expect(mock.history[0].headers).toMatchObject({ 'X-Contentful-Version': '1' })
    })

    it('fetches the version when omitted', async () => {
      mock.onGet(`${ CMA_BASE }/content_types/blogPost`).reply({ sys: { id: 'blogPost', version: 4 } })
      mock.onPut(`${ CMA_BASE }/content_types/blogPost/published`).reply({ sys: { id: 'blogPost', version: 5 } })

      await service.activateContentType('blogPost')

      expect(mock.history).toHaveLength(2)
      expect(mock.history[1].headers).toMatchObject({ 'X-Contentful-Version': '4' })
    })
  })

  // ── Locales (CMA) ──

  describe('listLocales', () => {
    it('sends GET to /locales', async () => {
      mock.onGet(`${ CMA_BASE }/locales`).reply({ items: [{ code: 'en-US', default: true }] })

      const result = await service.listLocales()

      expect(result.items[0].code).toBe('en-US')
      expect(mock.history[0].url).toBe(`${ CMA_BASE }/locales`)
      expect(mock.history[0].method).toBe('get')
    })
  })

  // ── Dictionaries ──

  describe('getContentTypesDictionary', () => {
    const ctResponse = {
      total: 2,
      items: [
        { sys: { id: 'blogPost' }, name: 'Blog Post' },
        { sys: { id: 'author' }, name: 'Author' },
      ],
    }

    it('maps content types to dictionary items', async () => {
      mock.onGet(`${ CMA_BASE }/content_types`).reply(ctResponse)

      const result = await service.getContentTypesDictionary({})

      expect(mock.history[0].query).toMatchObject({ limit: 100, skip: 0, order: 'name' })
      expect(result.items).toEqual([
        { label: 'Blog Post', value: 'blogPost', note: 'blogPost' },
        { label: 'Author', value: 'author', note: 'author' },
      ])
      expect(result.cursor).toBeNull()
    })

    it('filters by search term over name and id', async () => {
      mock.onGet(`${ CMA_BASE }/content_types`).reply(ctResponse)

      const result = await service.getContentTypesDictionary({ search: 'author' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('author')
    })

    it('handles a null payload', async () => {
      mock.onGet(`${ CMA_BASE }/content_types`).reply({ total: 0, items: [] })

      const result = await service.getContentTypesDictionary(null)

      expect(result.items).toEqual([])
      expect(result.cursor).toBeNull()
    })

    it('returns a cursor when more pages remain', async () => {
      mock.onGet(`${ CMA_BASE }/content_types`).reply({ total: 250, items: [{ sys: { id: 'x' }, name: 'X' }] })

      const result = await service.getContentTypesDictionary({})

      expect(result.cursor).toBe('100')
    })

    it('parses the cursor into a skip offset', async () => {
      mock.onGet(`${ CMA_BASE }/content_types`).reply({ total: 0, items: [] })

      await service.getContentTypesDictionary({ cursor: '100' })

      expect(mock.history[0].query).toMatchObject({ skip: 100 })
    })
  })

  describe('getEntriesDictionary', () => {
    it('lists entries without a content type and labels by entry id', async () => {
      mock.onGet(`${ CMA_BASE }/entries`).reply({
        total: 1,
        items: [{ sys: { id: 'e1', contentType: { sys: { id: 'blogPost' } } }, fields: {} }],
      })

      const result = await service.getEntriesDictionary({})

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({ limit: 100, skip: 0, order: '-sys.updatedAt' })
      expect(result.items).toEqual([{ label: 'e1', value: 'e1', note: 'blogPost' }])
      expect(result.cursor).toBeNull()
    })

    it('resolves the display field via a content type lookup for labels', async () => {
      mock.onGet(`${ CMA_BASE }/content_types/blogPost`).reply({ sys: { id: 'blogPost' }, displayField: 'title' })
      mock.onGet(`${ CMA_BASE }/entries`).reply({
        total: 1,
        items: [{ sys: { id: 'e1', contentType: { sys: { id: 'blogPost' } } }, fields: { title: { 'en-US': 'Hello' } } }],
      })

      const result = await service.getEntriesDictionary({ criteria: { contentType: 'blogPost' } })

      expect(mock.history).toHaveLength(2)
      expect(mock.history[0].url).toBe(`${ CMA_BASE }/content_types/blogPost`)
      expect(mock.history[1].query).toMatchObject({ content_type: 'blogPost' })
      expect(result.items).toEqual([{ label: 'Hello', value: 'e1', note: 'blogPost' }])
    })

    it('passes the search term as a full-text query', async () => {
      mock.onGet(`${ CMA_BASE }/entries`).reply({ total: 0, items: [] })

      await service.getEntriesDictionary({ search: 'hello' })

      expect(mock.history[0].query).toMatchObject({ query: 'hello' })
    })

    it('continues gracefully when the content type lookup fails', async () => {
      mock.onGet(`${ CMA_BASE }/content_types/blogPost`).replyWithError({
        message: 'boom',
        body: { message: 'boom', sys: { id: 'ServerError' } },
      })
      mock.onGet(`${ CMA_BASE }/entries`).reply({
        total: 1,
        items: [{ sys: { id: 'e1', contentType: { sys: { id: 'blogPost' } } }, fields: {} }],
      })

      const result = await service.getEntriesDictionary({ criteria: { contentType: 'blogPost' } })

      expect(result.items).toEqual([{ label: 'e1', value: 'e1', note: 'blogPost' }])
    })

    it('returns a cursor when more pages remain', async () => {
      mock.onGet(`${ CMA_BASE }/entries`).reply({
        total: 250,
        items: [{ sys: { id: 'e1', contentType: { sys: { id: 'blogPost' } } }, fields: {} }],
      })

      const result = await service.getEntriesDictionary({})

      expect(result.cursor).toBe('100')
    })

    it('handles a null payload', async () => {
      mock.onGet(`${ CMA_BASE }/entries`).reply({ total: 0, items: [] })

      const result = await service.getEntriesDictionary(null)

      expect(result.items).toEqual([])
      expect(result.cursor).toBeNull()
    })
  })

  // ── Missing-token guards ──
  //
  // Only one sandbox (one global Flowrunner) can exist at a time, so each of
  // these blocks tears down the primary sandbox, runs against its own
  // alternate-config sandbox, then restores the primary in afterAll.

  describe('missing token handling', () => {
    let altSandbox
    let altService
    let altMock

    beforeAll(() => {
      sandbox.cleanup()
      altSandbox = loadServiceInto({
        spaceId: SPACE_ID,
        environmentId: ENV_ID,
        managementToken: MGMT_TOKEN,
        // no deliveryToken
      })
      altService = altSandbox.getService()
      altMock = altSandbox.getRequestMock()
    })

    afterAll(() => {
      altSandbox.cleanup()
      sandbox = loadServiceInto({
        spaceId: SPACE_ID,
        environmentId: ENV_ID,
        managementToken: MGMT_TOKEN,
        deliveryToken: DELIVERY_TOKEN,
        defaultLocale: DEFAULT_LOCALE,
      })
      service = sandbox.getService()
      mock = sandbox.getRequestMock()
    })

    it('throws when a delivery operation runs without a delivery token', async () => {
      await expect(altService.getPublishedEntries()).rejects.toThrow(
        'Contentful API error: Delivery Token is required for this operation but is not configured.'
      )
      expect(altMock.history).toHaveLength(0)
    })
  })

  describe('missing management token', () => {
    let altSandbox
    let altService
    let altMock

    beforeAll(() => {
      sandbox.cleanup()
      altSandbox = loadServiceInto({
        spaceId: SPACE_ID,
        environmentId: ENV_ID,
        // no managementToken
        deliveryToken: DELIVERY_TOKEN,
      })
      altService = altSandbox.getService()
      altMock = altSandbox.getRequestMock()
    })

    afterAll(() => {
      altSandbox.cleanup()
      sandbox = loadServiceInto({
        spaceId: SPACE_ID,
        environmentId: ENV_ID,
        managementToken: MGMT_TOKEN,
        deliveryToken: DELIVERY_TOKEN,
        defaultLocale: DEFAULT_LOCALE,
      })
      service = sandbox.getService()
      mock = sandbox.getRequestMock()
    })

    it('throws when a management operation runs without a management token', async () => {
      await expect(altService.getEntry('e1')).rejects.toThrow(
        'Contentful API error: Management Token is required for this operation but is not configured.'
      )
      expect(altMock.history).toHaveLength(0)
    })
  })

  // ── Default environment fallback ──

  describe('default environment', () => {
    let altSandbox
    let altService
    let altMock

    beforeAll(() => {
      sandbox.cleanup()
      altSandbox = loadServiceInto({
        spaceId: SPACE_ID,
        // no environmentId -> defaults to 'master'
        managementToken: MGMT_TOKEN,
      })
      altService = altSandbox.getService()
      altMock = altSandbox.getRequestMock()
    })

    afterAll(() => {
      altSandbox.cleanup()
      sandbox = loadServiceInto({
        spaceId: SPACE_ID,
        environmentId: ENV_ID,
        managementToken: MGMT_TOKEN,
        deliveryToken: DELIVERY_TOKEN,
        defaultLocale: DEFAULT_LOCALE,
      })
      service = sandbox.getService()
      mock = sandbox.getRequestMock()
    })

    it('falls back to the master environment in the path', async () => {
      const masterUrl = `${ CMA }/spaces/${ SPACE_ID }/environments/master/entries/e1`
      altMock.onGet(masterUrl).reply({ sys: { id: 'e1' } })

      await altService.getEntry('e1')

      expect(altMock.history[0].url).toBe(masterUrl)
    })
  })
})
