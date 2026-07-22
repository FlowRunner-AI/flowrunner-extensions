'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-api-key'
const STORE_ID = '10'
const BASE = 'https://api.printful.com'

const AUTH_HEADERS = {
  'Authorization': `Bearer ${ API_KEY }`,
  'Content-Type': 'application/json',
}

const RECIPIENT = {
  name: 'John Smith',
  address1: '19749 Dearborn St',
  city: 'Chicago',
  country_code: 'US',
  state_code: 'IL',
  zip: '60618',
}

const ITEMS = [{ quantity: 1, sync_variant_id: 987654321 }]

describe('Printful Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ apiKey: API_KEY, storeId: STORE_ID })
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
    it('registers the API key and store id config items', () => {
      const configItems = sandbox.getConfigItems()

      expect(configItems.map(item => item.name)).toEqual(['apiKey', 'storeId'])

      expect(configItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'apiKey', displayName: 'API Key', type: 'STRING', required: true, shared: false }),
          expect.objectContaining({ name: 'storeId', displayName: 'Store ID', type: 'STRING', required: false, shared: false }),
        ])
      )
    })

    it('stores the credentials on the instance', () => {
      expect(service.apiKey).toBe(API_KEY)
      expect(service.storeId).toBe(STORE_ID)
    })
  })

  // ── Request helper behaviour ──

  describe('request headers', () => {
    it('sends the bearer token and store header', async () => {
      mock.onGet(`${ BASE }/store`).reply({ result: { id: 10 } })

      await service.getStoreInfo()

      expect(mock.history[0].headers).toMatchObject({ ...AUTH_HEADERS, 'X-PF-Store-Id': STORE_ID })
    })
  })

  // ── Stores ──

  describe('listStores', () => {
    it('returns items with the paging total', async () => {
      mock.onGet(`${ BASE }/stores`).reply({ result: [{ id: 10, name: 'My Store' }], paging: { total: 3 } })

      const result = await service.listStores(0, 20)

      expect(result).toEqual({ items: [{ id: 10, name: 'My Store' }], total: 3 })
      expect(mock.history[0].query).toEqual({ offset: 0, limit: 20 })
    })

    it('falls back to the item count when paging is missing and omits empty query params', async () => {
      mock.onGet(`${ BASE }/stores`).reply({ result: [{ id: 10 }] })

      const result = await service.listStores()

      expect(result).toEqual({ items: [{ id: 10 }], total: 1 })
      expect(mock.history[0].query).toEqual({})
    })

    it('returns an empty list when the result is missing', async () => {
      mock.onGet(`${ BASE }/stores`).reply({})

      await expect(service.listStores()).resolves.toEqual({ items: [], total: 0 })
    })
  })

  describe('getStoreInfo', () => {
    it('unwraps the result object', async () => {
      mock.onGet(`${ BASE }/store`).reply({ result: { id: 10, name: 'My Store' } })

      await expect(service.getStoreInfo()).resolves.toEqual({ id: 10, name: 'My Store' })
    })

    it('throws a descriptive error using error.body.error.message', async () => {
      mock.onGet(`${ BASE }/store`).replyWithError({
        message: 'Unauthorized',
        status: 401,
        body: { error: { message: 'Invalid API key' } },
      })

      await expect(service.getStoreInfo()).rejects.toThrow('Printful API error: Invalid API key')
    })

    it('falls back to a string result body', async () => {
      mock.onGet(`${ BASE }/store`).replyWithError({
        message: 'Bad Request',
        body: { result: 'Store not found' },
      })

      await expect(service.getStoreInfo()).rejects.toThrow('Printful API error: Store not found')
    })

    it('falls back to the transport message', async () => {
      mock.onGet(`${ BASE }/store`).replyWithError({ message: 'socket hang up' })

      await expect(service.getStoreInfo()).rejects.toThrow('Printful API error: socket hang up')
    })
  })

  // ── Catalog ──

  describe('listCatalogProducts', () => {
    it('sends the category filter and pagination', async () => {
      mock.onGet(`${ BASE }/products`).reply({ result: [{ id: 71 }], paging: { total: 1 } })

      const result = await service.listCatalogProducts(24, 0, 50)

      expect(result).toEqual({ items: [{ id: 71 }], total: 1 })
      expect(mock.history[0].query).toEqual({ category_id: 24, offset: 0, limit: 50 })
    })

    it('omits the filters when not provided', async () => {
      mock.onGet(`${ BASE }/products`).reply({ result: [] })

      await service.listCatalogProducts()

      expect(mock.history[0].query).toEqual({})
    })
  })

  describe('getCatalogProduct', () => {
    it('requests the encoded product resource', async () => {
      mock.onGet(`${ BASE }/products/71`).reply({ result: { product: { id: 71 }, variants: [] } })

      const result = await service.getCatalogProduct(71)

      expect(result).toEqual({ product: { id: 71 }, variants: [] })
      expect(mock.history[0].url).toBe(`${ BASE }/products/71`)
    })
  })

  describe('getCatalogVariant', () => {
    it('requests the variant resource', async () => {
      mock.onGet(`${ BASE }/products/variant/4012`).reply({ result: { variant: { id: 4012 } } })

      const result = await service.getCatalogVariant(4012)

      expect(result).toEqual({ variant: { id: 4012 } })
    })
  })

  describe('listCategories', () => {
    it('unwraps result.categories', async () => {
      mock.onGet(`${ BASE }/categories`).reply({ result: { categories: [{ id: 24 }, { id: 25 }] } })

      await expect(service.listCategories()).resolves.toEqual({ items: [{ id: 24 }, { id: 25 }], total: 2 })
    })

    it('returns an empty list when categories are missing', async () => {
      mock.onGet(`${ BASE }/categories`).reply({ result: {} })

      await expect(service.listCategories()).resolves.toEqual({ items: [], total: 0 })
    })
  })

  // ── Sync products ──

  describe('listSyncProducts', () => {
    it('sends the search term and pagination', async () => {
      mock.onGet(`${ BASE }/store/products`).reply({ result: [{ id: 1 }], paging: { total: 7 } })

      const result = await service.listSyncProducts('tee', 10, 20)

      expect(result).toEqual({ items: [{ id: 1 }], total: 7 })
      expect(mock.history[0].query).toEqual({ search: 'tee', offset: 10, limit: 20 })
    })
  })

  describe('getSyncProduct', () => {
    it('unwraps the result and encodes an external id reference', async () => {
      mock.onGet(`${ BASE }/store/products/%40ext-1`).reply({ result: { sync_product: { id: 1 } } })

      const result = await service.getSyncProduct('@ext-1')

      expect(result).toEqual({ sync_product: { id: 1 } })
      expect(mock.history[0].url).toBe(`${ BASE }/store/products/%40ext-1`)
    })
  })

  describe('createSyncProduct', () => {
    it('sends the sync product and variants', async () => {
      mock.onPost(`${ BASE }/store/products`).reply({ result: { id: 123 } })

      const variants = [{ variant_id: 4012, retail_price: '24.00', files: [{ url: 'https://x/y.png' }] }]
      const result = await service.createSyncProduct('Summer Tee', variants, 'https://x/thumb.png', 'ext-1')

      expect(result).toEqual({ id: 123 })
      expect(mock.history[0].method).toBe('post')

      expect(mock.history[0].body).toEqual({
        sync_product: { name: 'Summer Tee', thumbnail: 'https://x/thumb.png', external_id: 'ext-1' },
        sync_variants: variants,
      })
    })

    it('omits the optional thumbnail and external id', async () => {
      mock.onPost(`${ BASE }/store/products`).reply({ result: { id: 124 } })

      await service.createSyncProduct('Tee', [])

      expect(mock.history[0].body).toEqual({ sync_product: { name: 'Tee' }, sync_variants: [] })
    })
  })

  describe('updateSyncProduct', () => {
    it('sends only the product fields when no variants are provided', async () => {
      mock.onPut(`${ BASE }/store/products/123`).reply({ result: { id: 123 } })

      const result = await service.updateSyncProduct(123, 'New Name')

      expect(result).toEqual({ id: 123 })
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].body).toEqual({ sync_product: { name: 'New Name' } })
    })

    it('includes the replacement variants when provided', async () => {
      mock.onPut(`${ BASE }/store/products/123`).reply({ result: { id: 123 } })

      const variants = [{ variant_id: 4012, files: [] }]

      await service.updateSyncProduct(123, 'N', 'https://x/t.png', variants, 'ext-9')

      expect(mock.history[0].body).toEqual({
        sync_product: { name: 'N', thumbnail: 'https://x/t.png', external_id: 'ext-9' },
        sync_variants: variants,
      })
    })

    it('ignores an empty variants array', async () => {
      mock.onPut(`${ BASE }/store/products/123`).reply({ result: {} })

      await service.updateSyncProduct(123, 'N', undefined, [])

      expect(mock.history[0].body).toEqual({ sync_product: { name: 'N' } })
    })
  })

  describe('deleteSyncProduct', () => {
    it('deletes the product and returns a success flag', async () => {
      mock.onDelete(`${ BASE }/store/products/123`).reply({ result: {} })

      await expect(service.deleteSyncProduct(123)).resolves.toEqual({ success: true })
      expect(mock.history[0].method).toBe('delete')
    })
  })

  describe('getSyncVariant', () => {
    it('unwraps the sync variant result', async () => {
      mock.onGet(`${ BASE }/store/variants/987`).reply({ result: { id: 987 } })

      await expect(service.getSyncVariant(987)).resolves.toEqual({ id: 987 })
    })
  })

  describe('updateSyncVariant', () => {
    it('sends only the provided scalar fields', async () => {
      mock.onPut(`${ BASE }/store/variants/987`).reply({ result: { id: 987 } })

      const result = await service.updateSyncVariant(987, '26.00')

      expect(result).toEqual({ id: 987 })
      expect(mock.history[0].body).toEqual({ retail_price: '26.00' })
    })

    it('includes files, catalog variant, sku and external id', async () => {
      mock.onPut(`${ BASE }/store/variants/987`).reply({ result: {} })

      const files = [{ url: 'https://x/y.png', type: 'default' }]

      await service.updateSyncVariant(987, '26.00', files, 4012, 'TEE-M', 'ext-2')

      expect(mock.history[0].body).toEqual({
        retail_price: '26.00',
        variant_id: 4012,
        sku: 'TEE-M',
        external_id: 'ext-2',
        files,
      })
    })

    it('ignores an empty files array', async () => {
      mock.onPut(`${ BASE }/store/variants/987`).reply({ result: {} })

      await service.updateSyncVariant(987, undefined, [], undefined, 'SKU')

      expect(mock.history[0].body).toEqual({ sku: 'SKU' })
    })
  })

  describe('deleteSyncVariant', () => {
    it('deletes the variant and returns a success flag', async () => {
      mock.onDelete(`${ BASE }/store/variants/987`).reply({ result: {} })

      await expect(service.deleteSyncVariant(987)).resolves.toEqual({ success: true })
    })
  })

  // ── Orders ──

  describe('listOrders', () => {
    it('maps the status label to its API value', async () => {
      mock.onGet(`${ BASE }/orders`).reply({ result: [{ id: 13 }], paging: { total: 1 } })

      const result = await service.listOrders('In Process', 0, 10)

      expect(result).toEqual({ items: [{ id: 13 }], total: 1 })
      expect(mock.history[0].query).toEqual({ status: 'inprocess', offset: 0, limit: 10 })
    })

    it('omits the status when it is empty', async () => {
      mock.onGet(`${ BASE }/orders`).reply({ result: [] })

      await service.listOrders('')

      expect(mock.history[0].query).toEqual({})
    })

    it('passes an unmapped status through unchanged', async () => {
      mock.onGet(`${ BASE }/orders`).reply({ result: [] })

      await service.listOrders('archived')

      expect(mock.history[0].query).toEqual({ status: 'archived' })
    })
  })

  describe('getOrder', () => {
    it('unwraps the order result', async () => {
      mock.onGet(`${ BASE }/orders/13`).reply({ result: { id: 13, status: 'draft' } })

      await expect(service.getOrder(13)).resolves.toEqual({ id: 13, status: 'draft' })
    })
  })

  describe('createOrder', () => {
    it('creates a draft order without the confirm flag', async () => {
      mock.onPost(`${ BASE }/orders`).reply({ result: { id: 13, status: 'draft' } })

      const result = await service.createOrder(RECIPIENT, ITEMS)

      expect(result).toEqual({ id: 13, status: 'draft' })
      expect(mock.history[0].query).toEqual({})
      expect(mock.history[0].body).toEqual({ recipient: RECIPIENT, items: ITEMS })
    })

    it('sends confirm=true and the optional fields', async () => {
      mock.onPost(`${ BASE }/orders`).reply({ result: { id: 14 } })

      await service.createOrder(RECIPIENT, ITEMS, true, 'ext-order-1', 'STANDARD', { currency: 'USD', shipping: '3.99' })

      expect(mock.history[0].query).toEqual({ confirm: 'true' })

      expect(mock.history[0].body).toEqual({
        recipient: RECIPIENT,
        items: ITEMS,
        external_id: 'ext-order-1',
        shipping: 'STANDARD',
        retail_costs: { currency: 'USD', shipping: '3.99' },
      })
    })

    it('drops retail costs that clean down to an empty object', async () => {
      mock.onPost(`${ BASE }/orders`).reply({ result: { id: 15 } })

      await service.createOrder(RECIPIENT, ITEMS, false, undefined, undefined, { currency: '', tax: null })

      expect(mock.history[0].body).toEqual({ recipient: RECIPIENT, items: ITEMS })
    })
  })

  describe('updateOrder', () => {
    it('sends only the provided fields', async () => {
      mock.onPut(`${ BASE }/orders/13`).reply({ result: { id: 13 } })

      const result = await service.updateOrder(13, RECIPIENT)

      expect(result).toEqual({ id: 13 })
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].query).toEqual({})
      expect(mock.history[0].body).toEqual({ recipient: RECIPIENT })
    })

    it('ignores an empty items array and sends confirm=true', async () => {
      mock.onPut(`${ BASE }/orders/13`).reply({ result: { id: 13 } })

      await service.updateOrder(13, undefined, [], true, 'ext-2', 'STANDARD')

      expect(mock.history[0].query).toEqual({ confirm: 'true' })
      expect(mock.history[0].body).toEqual({ external_id: 'ext-2', shipping: 'STANDARD' })
    })

    it('sends the replacement items and retail costs', async () => {
      mock.onPut(`${ BASE }/orders/13`).reply({ result: { id: 13 } })

      await service.updateOrder(13, undefined, ITEMS, undefined, undefined, undefined, { currency: 'USD' })

      expect(mock.history[0].body).toEqual({ items: ITEMS, retail_costs: { currency: 'USD' } })
    })
  })

  describe('confirmOrder', () => {
    it('posts an empty body to the confirm endpoint', async () => {
      mock.onPost(`${ BASE }/orders/13/confirm`).reply({ result: { id: 13, status: 'pending' } })

      const result = await service.confirmOrder(13)

      expect(result).toEqual({ id: 13, status: 'pending' })
      expect(mock.history[0].body).toEqual({})
    })
  })

  describe('cancelOrder', () => {
    it('deletes the order and returns the canceled order', async () => {
      mock.onDelete(`${ BASE }/orders/13`).reply({ result: { id: 13, status: 'canceled' } })

      await expect(service.cancelOrder(13)).resolves.toEqual({ id: 13, status: 'canceled' })
    })

    it('throws when the order cannot be canceled', async () => {
      mock.onDelete(`${ BASE }/orders/13`).replyWithError({
        message: 'Conflict',
        body: { error: { message: 'Order is already being fulfilled' } },
      })

      await expect(service.cancelOrder(13)).rejects.toThrow('Printful API error: Order is already being fulfilled')
    })
  })

  describe('estimateOrderCosts', () => {
    it('posts the recipient and items', async () => {
      mock.onPost(`${ BASE }/orders/estimate-costs`).reply({ result: { costs: { total: 13.85 } } })

      const result = await service.estimateOrderCosts(RECIPIENT, ITEMS)

      expect(result).toEqual({ costs: { total: 13.85 } })
      expect(mock.history[0].body).toEqual({ recipient: RECIPIENT, items: ITEMS })
    })
  })

  // ── Shipping & tax ──

  describe('getShippingRates', () => {
    it('posts the recipient, items and currency', async () => {
      mock.onPost(`${ BASE }/shipping/rates`).reply({ result: [{ id: 'STANDARD', rate: '3.99' }] })

      const result = await service.getShippingRates(RECIPIENT, ITEMS, 'USD')

      expect(result).toEqual([{ id: 'STANDARD', rate: '3.99' }])
      expect(mock.history[0].body).toEqual({ recipient: RECIPIENT, items: ITEMS, currency: 'USD' })
    })

    it('omits the currency when not provided', async () => {
      mock.onPost(`${ BASE }/shipping/rates`).reply({ result: [] })

      await service.getShippingRates(RECIPIENT, ITEMS)

      expect(mock.history[0].body).toEqual({ recipient: RECIPIENT, items: ITEMS })
    })
  })

  describe('getTaxRate', () => {
    it('posts the cleaned recipient address', async () => {
      mock.onPost(`${ BASE }/tax/rates`).reply({ result: { required: true, rate: 0.0975 } })

      const result = await service.getTaxRate('US', 'CA', 'San Francisco', '94103')

      expect(result).toEqual({ required: true, rate: 0.0975 })

      expect(mock.history[0].body).toEqual({
        recipient: { country_code: 'US', state_code: 'CA', city: 'San Francisco', zip: '94103' },
      })
    })

    it('omits an empty zip', async () => {
      mock.onPost(`${ BASE }/tax/rates`).reply({ result: {} })

      await service.getTaxRate('US', 'CA', 'San Francisco')

      expect(mock.history[0].body).toEqual({
        recipient: { country_code: 'US', state_code: 'CA', city: 'San Francisco' },
      })
    })
  })

  // ── Files ──

  describe('listFiles', () => {
    it('sends the pagination params', async () => {
      mock.onGet(`${ BASE }/files`).reply({ result: [{ id: 555 }], paging: { total: 1 } })

      const result = await service.listFiles(0, 20)

      expect(result).toEqual({ items: [{ id: 555 }], total: 1 })
      expect(mock.history[0].query).toEqual({ offset: 0, limit: 20 })
    })
  })

  describe('addFile', () => {
    it('posts the file url with optional type and filename', async () => {
      mock.onPost(`${ BASE }/files`).reply({ result: { id: 555, status: 'waiting' } })

      const result = await service.addFile('https://x/y.png', 'default', 'y.png')

      expect(result).toEqual({ id: 555, status: 'waiting' })
      expect(mock.history[0].body).toEqual({ url: 'https://x/y.png', type: 'default', filename: 'y.png' })
    })

    it('omits the optional fields', async () => {
      mock.onPost(`${ BASE }/files`).reply({ result: { id: 556 } })

      await service.addFile('https://x/y.png')

      expect(mock.history[0].body).toEqual({ url: 'https://x/y.png' })
    })
  })

  describe('getFile', () => {
    it('unwraps the file result', async () => {
      mock.onGet(`${ BASE }/files/555`).reply({ result: { id: 555, status: 'ok' } })

      await expect(service.getFile(555)).resolves.toEqual({ id: 555, status: 'ok' })
    })
  })

  // ── Countries ──

  describe('listCountries', () => {
    it('returns the countries with a total', async () => {
      mock.onGet(`${ BASE }/countries`).reply({ result: [{ code: 'US' }, { code: 'CA' }] })

      await expect(service.listCountries()).resolves.toEqual({
        items: [{ code: 'US' }, { code: 'CA' }],
        total: 2,
      })
    })

    it('returns an empty list when the result is missing', async () => {
      mock.onGet(`${ BASE }/countries`).reply({})

      await expect(service.listCountries()).resolves.toEqual({ items: [], total: 0 })
    })
  })

  // ── Webhooks ──

  describe('getWebhookConfig', () => {
    it('unwraps the webhook configuration', async () => {
      mock.onGet(`${ BASE }/webhooks`).reply({ result: { url: 'https://x/hook', types: ['package_shipped'] } })

      await expect(service.getWebhookConfig()).resolves.toEqual({
        url: 'https://x/hook',
        types: ['package_shipped'],
      })
    })
  })

  describe('setWebhookConfig', () => {
    it('maps event type labels to API values', async () => {
      mock.onPost(`${ BASE }/webhooks`).reply({ result: { url: 'https://x/hook', types: ['package_shipped', 'order_failed'] } })

      const result = await service.setWebhookConfig('https://x/hook', ['Package Shipped', 'Order Failed'])

      expect(result.types).toEqual(['package_shipped', 'order_failed'])

      expect(mock.history[0].body).toEqual({
        url: 'https://x/hook',
        types: ['package_shipped', 'order_failed'],
      })
    })

    it('passes raw API event types through and defaults to an empty list', async () => {
      mock.onPost(`${ BASE }/webhooks`).reply({ result: {} })

      await service.setWebhookConfig('https://x/hook', ['stock_updated'])

      expect(mock.history[0].body).toEqual({ url: 'https://x/hook', types: ['stock_updated'] })

      mock.reset()
      mock.onPost(`${ BASE }/webhooks`).reply({ result: {} })

      await service.setWebhookConfig('https://x/hook')

      expect(mock.history[0].body).toEqual({ url: 'https://x/hook', types: [] })
    })
  })

  describe('disableWebhooks', () => {
    it('deletes the webhook configuration', async () => {
      mock.onDelete(`${ BASE }/webhooks`).reply({ result: { url: null, types: [] } })

      await expect(service.disableWebhooks()).resolves.toEqual({ url: null, types: [] })
      expect(mock.history[0].method).toBe('delete')
    })
  })

  // ── Dictionaries ──

  describe('getStoresDictionary', () => {
    it('maps stores to dictionary items', async () => {
      mock.onGet(`${ BASE }/stores`).reply({
        result: [{ id: 10, name: 'My Store', type: 'native', currency: 'USD' }],
        paging: { total: 1 },
      })

      const result = await service.getStoresDictionary({})

      expect(result).toEqual({
        items: [{ label: 'My Store', value: '10', note: 'native - USD' }],
        cursor: null,
      })

      expect(mock.history[0].query).toEqual({ offset: 0, limit: 100 })
    })

    it('handles a null payload', async () => {
      mock.onGet(`${ BASE }/stores`).reply({ result: [{ id: 10, name: 'S' }] })

      const result = await service.getStoresDictionary(null)

      expect(result.items).toHaveLength(1)
      expect(result.cursor).toBeNull()
    })

    it('filters by case-insensitive search', async () => {
      mock.onGet(`${ BASE }/stores`).reply({
        result: [{ id: 10, name: 'Alpha' }, { id: 11, name: 'Beta' }],
      })

      const result = await service.getStoresDictionary({ search: 'BET' })

      expect(result.items.map(item => item.value)).toEqual(['11'])
    })

    it('returns the next cursor when more results exist', async () => {
      mock.onGet(`${ BASE }/stores`).reply({ result: [{ id: 10, name: 'A' }], paging: { total: 12 } })

      const result = await service.getStoresDictionary({ cursor: '4' })

      expect(mock.history[0].query).toEqual({ offset: 4, limit: 100 })
      expect(result.cursor).toBe('5')
    })

    it('treats a non-numeric cursor as offset zero', async () => {
      mock.onGet(`${ BASE }/stores`).reply({ result: [] })

      const result = await service.getStoresDictionary({ cursor: 'nope' })

      expect(mock.history[0].query).toEqual({ offset: 0, limit: 100 })
      expect(result).toEqual({ items: [], cursor: null })
    })

    it('falls back to a generated label and omits an empty note', async () => {
      mock.onGet(`${ BASE }/stores`).reply({ result: [{ id: 12 }] })

      const result = await service.getStoresDictionary({})

      expect(result.items[0]).toEqual({ label: 'Store 12', value: '12', note: undefined })
    })
  })

  describe('getSyncProductsDictionary', () => {
    it('maps products with a variants note and passes the search to the API', async () => {
      mock.onGet(`${ BASE }/store/products`).reply({
        result: [{ id: 1, name: 'Summer Tee', variants: 4, synced: 4 }],
        paging: { total: 1 },
      })

      const result = await service.getSyncProductsDictionary({ search: 'tee' })

      expect(result).toEqual({
        items: [{ label: 'Summer Tee', value: '1', note: '4 variants, 4 synced' }],
        cursor: null,
      })

      expect(mock.history[0].query).toEqual({ search: 'tee', offset: 0, limit: 100 })
    })

    it('handles a null payload and missing counts', async () => {
      mock.onGet(`${ BASE }/store/products`).reply({ result: [{ id: 2 }] })

      const result = await service.getSyncProductsDictionary(null)

      expect(result.items[0]).toEqual({ label: 'Product 2', value: '2', note: '0 variants, 0 synced' })
    })

    it('returns the next cursor when more products remain', async () => {
      mock.onGet(`${ BASE }/store/products`).reply({ result: [{ id: 1 }], paging: { total: 10 } })

      const result = await service.getSyncProductsDictionary({ cursor: '2' })

      expect(result.cursor).toBe('3')
    })

    it('returns an empty list when the result is missing', async () => {
      mock.onGet(`${ BASE }/store/products`).reply({})

      await expect(service.getSyncProductsDictionary({})).resolves.toEqual({ items: [], cursor: null })
    })
  })

  describe('getCatalogProductsDictionary', () => {
    it('maps catalog products to dictionary items', async () => {
      mock.onGet(`${ BASE }/products`).reply({
        result: [{ id: 71, brand: 'Bella + Canvas', model: '3001', type_name: 'T-Shirt', variant_count: 289 }],
      })

      const result = await service.getCatalogProductsDictionary({})

      expect(result).toEqual({
        items: [{ label: 'Bella + Canvas 3001', value: '71', note: 'T-Shirt - 289 variants' }],
        cursor: null,
      })
    })

    it('filters by brand, model or type name', async () => {
      mock.onGet(`${ BASE }/products`).reply({
        result: [
          { id: 71, brand: 'Bella + Canvas', model: '3001', type_name: 'T-Shirt' },
          { id: 19, brand: 'Generic', model: 'Mug', type_name: 'Mug' },
        ],
      })

      const result = await service.getCatalogProductsDictionary({ search: 'MUG' })

      expect(result.items.map(item => item.value)).toEqual(['19'])
    })

    it('falls back to a generated label and omits an empty note', async () => {
      mock.onGet(`${ BASE }/products`).reply({ result: [{ id: 99 }] })

      const result = await service.getCatalogProductsDictionary(null)

      expect(result.items[0]).toEqual({ label: 'Product 99', value: '99', note: undefined })
    })

    it('caps the result at the dictionary page size', async () => {
      const many = Array.from({ length: 150 }, (_, index) => ({ id: index + 1, brand: 'B', model: `M${ index }` }))

      mock.onGet(`${ BASE }/products`).reply({ result: many })

      const result = await service.getCatalogProductsDictionary({})

      expect(result.items).toHaveLength(100)
    })

    it('returns an empty list when the result is missing', async () => {
      mock.onGet(`${ BASE }/products`).reply({})

      await expect(service.getCatalogProductsDictionary({})).resolves.toEqual({ items: [], cursor: null })
    })
  })

  describe('getCountriesDictionary', () => {
    it('maps countries with a states note', async () => {
      mock.onGet(`${ BASE }/countries`).reply({
        result: [{ code: 'US', name: 'United States', states: [{ code: 'CA' }, { code: 'IL' }] }],
      })

      const result = await service.getCountriesDictionary({})

      expect(result).toEqual({
        items: [{ label: 'United States (US)', value: 'US', note: '2 states' }],
        cursor: null,
      })
    })

    it('filters by name substring and by exact code', async () => {
      mock.onGet(`${ BASE }/countries`).reply({
        result: [
          { code: 'US', name: 'United States' },
          { code: 'CA', name: 'Canada' },
        ],
      })

      const byName = await service.getCountriesDictionary({ search: 'canad' })

      expect(byName.items.map(item => item.value)).toEqual(['CA'])

      mock.reset()

      mock.onGet(`${ BASE }/countries`).reply({
        result: [
          { code: 'US', name: 'United States' },
          { code: 'CA', name: 'Canada' },
        ],
      })

      const byCode = await service.getCountriesDictionary({ search: 'us' })

      expect(byCode.items.map(item => item.value)).toEqual(['US'])
    })

    it('omits the note when the country has no states and handles a null payload', async () => {
      mock.onGet(`${ BASE }/countries`).reply({ result: [{ code: 'LV', name: 'Latvia' }] })

      const result = await service.getCountriesDictionary(null)

      expect(result.items[0]).toEqual({ label: 'Latvia (LV)', value: 'LV', note: undefined })
    })

    it('returns an empty list when the result is missing', async () => {
      mock.onGet(`${ BASE }/countries`).reply({})

      await expect(service.getCountriesDictionary({})).resolves.toEqual({ items: [], cursor: null })
    })
  })
})

// Runs last: it swaps the Flowrunner global for a store-id-less sandbox.
describe('Printful Service without a store id', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ apiKey: API_KEY })

    jest.isolateModules(() => {
      require('../src/index.js')
    })

    service = sandbox.getService()
    mock = sandbox.getRequestMock()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  it('omits the X-PF-Store-Id header', async () => {
    mock.onGet(`${ BASE }/store`).reply({ result: { id: 11 } })

    await service.getStoreInfo()

    expect(mock.history[0].headers).toMatchObject(AUTH_HEADERS)
    expect(mock.history[0].headers['X-PF-Store-Id']).toBeUndefined()
  })
})
