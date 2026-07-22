'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-api-key'
const PRODUCTS_API = 'https://api.squarespace.com/v2/commerce'
const COMMERCE_API = 'https://api.squarespace.com/1.0/commerce'

const EXPECTED_HEADERS = {
  Authorization: `Bearer ${ API_KEY }`,
  'User-Agent': 'FlowRunner-Squarespace-Extension',
}

describe('Squarespace Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ apiKey: API_KEY })
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
    it('registers the required config items', () => {
      const configItems = sandbox.getConfigItems()

      expect(configItems.map(item => item.name)).toEqual(['apiKey'])

      expect(configItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'apiKey', required: true, shared: false, type: 'STRING' }),
        ])
      )
    })

    it('stores the api key from the config', () => {
      expect(service.apiKey).toBe(API_KEY)
    })
  })

  // ── Products ──

  describe('listProducts', () => {
    const url = `${ PRODUCTS_API }/products`

    it('sends a GET with auth headers and no filters by default', async () => {
      mock.onGet(url).reply({ products: [{ id: 'p1' }] })

      const result = await service.listProducts()

      expect(result).toEqual({ products: [{ id: 'p1' }] })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(url)
      expect(mock.history[0].headers).toMatchObject(EXPECTED_HEADERS)
      expect(mock.history[0].query).toEqual({})
    })

    it('maps a friendly product type label to the api value', async () => {
      mock.onGet(url).reply({ products: [] })

      await service.listProducts('Gift Card', 'cur-1')

      expect(mock.history[0].query).toEqual({ type: 'GIFT_CARD', cursor: 'cur-1' })
    })

    it('omits the type filter for "All Types"', async () => {
      mock.onGet(url).reply({ products: [] })

      await service.listProducts('All Types')

      expect(mock.history[0].query).toEqual({})
    })

    it('passes an unmapped type value through unchanged', async () => {
      mock.onGet(url).reply({ products: [] })

      await service.listProducts('DIGITAL')

      expect(mock.history[0].query).toEqual({ type: 'DIGITAL' })
    })

    it('handles a response without a products array', async () => {
      mock.onGet(url).reply({})

      const result = await service.listProducts()

      expect(result).toEqual({})
    })
  })

  describe('getProduct', () => {
    it('returns the single product from the array wrapper', async () => {
      mock.onGet(`${ PRODUCTS_API }/products/p1`).reply({ products: [{ id: 'p1', name: 'Mug' }] })

      const result = await service.getProduct('p1')

      expect(result).toEqual({ id: 'p1', name: 'Mug' })
    })

    it('throws when the product id is missing', async () => {
      await expect(service.getProduct()).rejects.toThrow('Product ID is required.')
      expect(mock.history).toHaveLength(0)
    })

    it('throws when the product is not found', async () => {
      mock.onGet(`${ PRODUCTS_API }/products/p1`).reply({ products: [] })

      await expect(service.getProduct('p1')).rejects.toThrow('Product "p1" was not found')
    })
  })

  describe('createProduct', () => {
    const url = `${ PRODUCTS_API }/products`

    it('builds a full product body with all optional fields', async () => {
      mock.onPost(url).reply({ id: 'p1' })

      const result = await service.createProduct('sp1', 'Mug', 29.9, 'A mug', 'EUR', 'SKU-1', 7, false)

      expect(result).toEqual({ id: 'p1' })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(url)

      expect(mock.history[0].body).toEqual({
        type: 'PHYSICAL',
        storePageId: 'sp1',
        name: 'Mug',
        isVisible: false,
        description: 'A mug',
        variants: [{
          pricing: { basePrice: { currency: 'EUR', value: '29.90' } },
          sku: 'SKU-1',
          stock: { quantity: 7, unlimited: false },
        }],
      })
    })

    it('defaults currency to USD, visibility to true, and omits optional fields', async () => {
      mock.onPost(url).reply({ id: 'p2' })

      await service.createProduct('sp1', 'Mug', 5)

      expect(mock.history[0].body).toEqual({
        type: 'PHYSICAL',
        storePageId: 'sp1',
        name: 'Mug',
        isVisible: true,
        variants: [{ pricing: { basePrice: { currency: 'USD', value: '5.00' } } }],
      })
    })

    it('accepts a zero initial stock', async () => {
      mock.onPost(url).reply({ id: 'p3' })

      await service.createProduct('sp1', 'Mug', 5, undefined, undefined, undefined, 0)

      expect(mock.history[0].body.variants[0].stock).toEqual({ quantity: 0, unlimited: false })
    })

    it('throws when the store page is missing', async () => {
      await expect(service.createProduct(undefined, 'Mug', 5)).rejects.toThrow('Store Page is required')
    })

    it('throws when the name is missing', async () => {
      await expect(service.createProduct('sp1', '', 5)).rejects.toThrow('Product name is required.')
    })

    it('throws when the price is missing or not numeric', async () => {
      await expect(service.createProduct('sp1', 'Mug')).rejects.toThrow('Price is required')
      await expect(service.createProduct('sp1', 'Mug', 'abc')).rejects.toThrow('Price is required')
      expect(mock.history).toHaveLength(0)
    })
  })

  describe('updateProduct', () => {
    const url = `${ PRODUCTS_API }/products/p1`

    it('sends only the provided fields', async () => {
      mock.onPost(url).reply({ id: 'p1' })

      await service.updateProduct('p1', 'New name', undefined, false, 'new-slug')

      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({ name: 'New name', isVisible: false, urlSlug: 'new-slug' })
    })

    it('allows clearing a description with an empty string', async () => {
      mock.onPost(url).reply({ id: 'p1' })

      await service.updateProduct('p1', undefined, '')

      expect(mock.history[0].body).toEqual({ description: '' })
    })

    it('throws when the product id is missing', async () => {
      await expect(service.updateProduct()).rejects.toThrow('Product ID is required.')
    })

    it('throws when no fields are provided', async () => {
      await expect(service.updateProduct('p1')).rejects.toThrow('Provide at least one field to update')
      expect(mock.history).toHaveLength(0)
    })
  })

  describe('deleteProduct', () => {
    it('sends a DELETE and returns a success summary', async () => {
      mock.onDelete(`${ PRODUCTS_API }/products/p1`).reply(undefined)

      const result = await service.deleteProduct('p1')

      expect(result).toEqual({
        success: true,
        message: 'Product deleted successfully',
        productId: 'p1',
      })

      expect(mock.history[0].method).toBe('delete')
    })

    it('throws when the product id is missing', async () => {
      await expect(service.deleteProduct()).rejects.toThrow('Product ID is required.')
    })
  })

  // ── Orders ──

  describe('listOrders', () => {
    const url = `${ COMMERCE_API }/orders`

    it('lists orders without filters', async () => {
      mock.onGet(url).reply({ result: [{ id: 'o1' }] })

      const result = await service.listOrders()

      expect(result).toEqual({ result: [{ id: 'o1' }] })
      expect(mock.history[0].query).toEqual({})
    })

    it('maps the fulfillment status label and passes the date range', async () => {
      mock.onGet(url).reply({ result: [] })

      await service.listOrders('Pending', '2024-01-01T00:00:00Z', '2024-02-01T00:00:00Z')

      expect(mock.history[0].query).toEqual({
        fulfillmentStatus: 'PENDING',
        modifiedAfter: '2024-01-01T00:00:00Z',
        modifiedBefore: '2024-02-01T00:00:00Z',
      })
    })

    it('omits the status filter for "Any Status" and passes a cursor', async () => {
      mock.onGet(url).reply({ result: [] })

      await service.listOrders('Any Status', undefined, undefined, 'cur-1')

      expect(mock.history[0].query).toEqual({ cursor: 'cur-1' })
    })

    it('rejects combining a cursor with a date range', async () => {
      await expect(service.listOrders(undefined, '2024-01-01', '2024-02-01', 'cur-1')).rejects.toThrow(
        'A pagination cursor cannot be combined with a modified-date range'
      )
    })

    it('rejects a half-specified date range', async () => {
      await expect(service.listOrders(undefined, '2024-01-01')).rejects.toThrow(
        'Modified After and Modified Before must be provided together.'
      )

      await expect(service.listOrders(undefined, undefined, '2024-02-01')).rejects.toThrow(
        'Modified After and Modified Before must be provided together.'
      )

      expect(mock.history).toHaveLength(0)
    })

    it('handles a response without a result array', async () => {
      mock.onGet(url).reply({})

      await expect(service.listOrders()).resolves.toEqual({})
    })
  })

  describe('getOrder', () => {
    it('fetches a single order', async () => {
      mock.onGet(`${ COMMERCE_API }/orders/o1`).reply({ id: 'o1' })

      await expect(service.getOrder('o1')).resolves.toEqual({ id: 'o1' })
    })

    it('throws when the order id is missing', async () => {
      await expect(service.getOrder()).rejects.toThrow('Order ID is required.')
    })
  })

  describe('fulfillOrder', () => {
    const url = `${ COMMERCE_API }/orders/o1/fulfillments`

    it('builds a shipment with all provided details', async () => {
      mock.onPost(url).reply({})

      const result = await service.fulfillOrder(
        'o1', '2024-03-01T00:00:00Z', 'UPS', 'Ground', 'TRACK1', 'https://track', true
      )

      expect(result).toEqual({
        success: true,
        message: 'Order fulfilled successfully',
        orderId: 'o1',
      })

      expect(mock.history[0].body).toEqual({
        shouldSendNotification: true,
        shipments: [{
          shipDate: '2024-03-01T00:00:00Z',
          carrierName: 'UPS',
          service: 'Ground',
          trackingNumber: 'TRACK1',
          trackingUrl: 'https://track',
        }],
      })
    })

    it('defaults notification to true and sends an empty shipment when nothing is provided', async () => {
      mock.onPost(url).reply({})

      await service.fulfillOrder('o1')

      expect(mock.history[0].body).toEqual({ shouldSendNotification: true, shipments: [{}] })
    })

    it('honours an explicit false notification flag', async () => {
      mock.onPost(url).reply({})

      await service.fulfillOrder('o1', undefined, 'UPS', undefined, undefined, undefined, false)

      expect(mock.history[0].body.shouldSendNotification).toBe(false)
    })

    it('throws when the order id is missing', async () => {
      await expect(service.fulfillOrder()).rejects.toThrow('Order ID is required.')
    })
  })

  // ── Inventory ──

  describe('listInventory', () => {
    const url = `${ COMMERCE_API }/inventory`

    it('lists inventory without a cursor', async () => {
      mock.onGet(url).reply({ inventory: [{ variantId: 'v1' }] })

      const result = await service.listInventory()

      expect(result).toEqual({ inventory: [{ variantId: 'v1' }] })
      expect(mock.history[0].query).toEqual({})
    })

    it('passes a cursor', async () => {
      mock.onGet(url).reply({ inventory: [] })

      await service.listInventory('cur-1')

      expect(mock.history[0].query).toEqual({ cursor: 'cur-1' })
    })

    it('handles a response without an inventory array', async () => {
      mock.onGet(url).reply({})

      await expect(service.listInventory()).resolves.toEqual({})
    })
  })

  describe('getInventory', () => {
    it('returns the single inventory item from the array wrapper', async () => {
      mock.onGet(`${ COMMERCE_API }/inventory/v1`).reply({ inventory: [{ variantId: 'v1', quantity: 3 }] })

      const result = await service.getInventory('p1', 'v1')

      expect(result).toEqual({ variantId: 'v1', quantity: 3 })
    })

    it('throws when the variant id is missing', async () => {
      await expect(service.getInventory('p1')).rejects.toThrow('Variant is required')
      expect(mock.history).toHaveLength(0)
    })

    it('throws when the variant has no inventory record', async () => {
      mock.onGet(`${ COMMERCE_API }/inventory/v1`).reply({ inventory: [] })

      await expect(service.getInventory('p1', 'v1')).rejects.toThrow(
        'Inventory for variant "v1" was not found'
      )
    })
  })

  describe('adjustStock', () => {
    const url = `${ COMMERCE_API }/inventory/adjustments`

    it('maps a positive delta to an increment operation with an idempotency key', async () => {
      mock.onPost(url).reply({})

      const result = await service.adjustStock('p1', 'v1', 5)

      expect(result).toEqual({
        success: true,
        message: 'Stock adjusted successfully',
        variantId: 'v1',
        quantityDelta: 5,
      })

      expect(mock.history[0].body).toEqual({ incrementOperations: [{ variantId: 'v1', quantity: 5 }] })
      expect(mock.history[0].headers['Idempotency-Key']).toEqual(expect.any(String))
    })

    it('maps a negative delta to a decrement operation with an absolute quantity', async () => {
      mock.onPost(url).reply({})

      const result = await service.adjustStock('p1', 'v1', -3)

      expect(mock.history[0].body).toEqual({ decrementOperations: [{ variantId: 'v1', quantity: 3 }] })
      expect(result.quantityDelta).toBe(-3)
    })

    it('accepts a numeric string delta', async () => {
      mock.onPost(url).reply({})

      await service.adjustStock('p1', 'v1', '2')

      expect(mock.history[0].body).toEqual({ incrementOperations: [{ variantId: 'v1', quantity: 2 }] })
    })

    it('throws when the variant id is missing', async () => {
      await expect(service.adjustStock('p1')).rejects.toThrow('Variant is required')
    })

    it('throws for a missing, zero or non-numeric delta', async () => {
      await expect(service.adjustStock('p1', 'v1')).rejects.toThrow('Quantity Adjustment is required')
      await expect(service.adjustStock('p1', 'v1', 0)).rejects.toThrow('Quantity Adjustment is required')
      await expect(service.adjustStock('p1', 'v1', 'abc')).rejects.toThrow('Quantity Adjustment is required')
      expect(mock.history).toHaveLength(0)
    })
  })

  // ── Dictionaries ──

  describe('getStorePagesDictionary', () => {
    const url = `${ COMMERCE_API }/store_pages`

    it('maps store pages to dictionary items', async () => {
      mock.onGet(url).reply({
        storePages: [{ id: 'sp1', title: 'Shop' }, { id: 'sp2', title: 'Outlet' }],
      })

      const result = await service.getStorePagesDictionary({})

      expect(result).toEqual({
        items: [
          { label: 'Shop', value: 'sp1', note: 'ID: sp1' },
          { label: 'Outlet', value: 'sp2', note: 'ID: sp2' },
        ],
        cursor: null,
      })

      expect(mock.history[0].query).toEqual({})
    })

    it('filters case-insensitively by search and forwards the cursor', async () => {
      mock.onGet(url).reply({
        storePages: [{ id: 'sp1', title: 'Shop' }, { id: 'sp2', title: 'Outlet' }],
        pagination: { nextPageCursor: 'next-1' },
      })

      const result = await service.getStorePagesDictionary({ search: 'OUT', cursor: 'cur-1' })

      expect(result.items).toEqual([{ label: 'Outlet', value: 'sp2', note: 'ID: sp2' }])
      expect(result.cursor).toBe('next-1')
      expect(mock.history[0].query).toEqual({ cursor: 'cur-1' })
    })

    it('handles a null payload and an empty response', async () => {
      mock.onGet(url).reply({})

      const result = await service.getStorePagesDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getProductsDictionary', () => {
    const url = `${ PRODUCTS_API }/products`

    it('maps products with a formatted price note', async () => {
      mock.onGet(url).reply({
        products: [
          { id: 'p1', name: 'Mug', variants: [{ pricing: { basePrice: { value: '12.5' } } }] },
          { id: 'p2', name: 'Hat' },
        ],
      })

      const result = await service.getProductsDictionary({})

      expect(result).toEqual({
        items: [
          { label: 'Mug', value: 'p1', note: '$12.50' },
          { label: 'Hat', value: 'p2', note: 'No price' },
        ],
        cursor: null,
      })
    })

    it('filters by search and forwards the cursor', async () => {
      mock.onGet(url).reply({
        products: [{ id: 'p1', name: 'Mug' }, { id: 'p2', name: 'Hat' }],
        pagination: { nextPageCursor: 'next-1' },
      })

      const result = await service.getProductsDictionary({ search: 'hat', cursor: 'cur-1' })

      expect(result.items).toEqual([{ label: 'Hat', value: 'p2', note: 'No price' }])
      expect(result.cursor).toBe('next-1')
      expect(mock.history[0].query).toEqual({ cursor: 'cur-1' })
    })

    it('handles a null payload and an empty response', async () => {
      mock.onGet(url).reply({})

      await expect(service.getProductsDictionary(null)).resolves.toEqual({ items: [], cursor: null })
    })
  })

  describe('getVariantsDictionary', () => {
    it('returns an empty result when no product is selected', async () => {
      const result = await service.getVariantsDictionary({ criteria: {} })

      expect(result).toEqual({ items: [], cursor: null })
      expect(mock.history).toHaveLength(0)
    })

    it('returns an empty result for a null payload', async () => {
      await expect(service.getVariantsDictionary(null)).resolves.toEqual({ items: [], cursor: null })
    })

    it('describes variants using their attributes and sku', async () => {
      mock.onGet(`${ PRODUCTS_API }/products/p1`).reply({
        products: [{
          id: 'p1',
          variants: [
            { id: 'v1', sku: 'SKU-1', attributes: { Size: 'S', Color: 'Red' } },
            { id: 'v2' },
          ],
        }],
      })

      const result = await service.getVariantsDictionary({ criteria: { productId: 'p1' } })

      expect(result).toEqual({
        items: [
          { label: 'S / Red (SKU-1)', value: 'v1', note: 'SKU: SKU-1' },
          { label: 'v2', value: 'v2', note: 'ID: v2' },
        ],
        cursor: null,
      })
    })

    it('filters variants by search', async () => {
      mock.onGet(`${ PRODUCTS_API }/products/p1`).reply({
        products: [{
          variants: [
            { id: 'v1', sku: 'SKU-1', attributes: { Size: 'Small' } },
            { id: 'v2', sku: 'SKU-2', attributes: { Size: 'Large' } },
          ],
        }],
      })

      const result = await service.getVariantsDictionary({
        search: 'large',
        criteria: { productId: 'p1' },
      })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('v2')
    })

    it('handles a product without variants', async () => {
      mock.onGet(`${ PRODUCTS_API }/products/p1`).reply({ products: [] })

      await expect(service.getVariantsDictionary({ criteria: { productId: 'p1' } }))
        .resolves.toEqual({ items: [], cursor: null })
    })
  })

  describe('getOrdersDictionary', () => {
    const url = `${ COMMERCE_API }/orders`

    it('maps orders with a status and total note', async () => {
      mock.onGet(url).reply({
        result: [
          { id: 'o1', orderNumber: 1001, fulfillmentStatus: 'PENDING', grandTotal: { value: '20' } },
          { id: 'o2', orderNumber: 1002, fulfillmentStatus: 'FULFILLED' },
        ],
      })

      const result = await service.getOrdersDictionary({})

      expect(result).toEqual({
        items: [
          { label: 'Order #1001', value: 'o1', note: 'PENDING - $20.00' },
          { label: 'Order #1002', value: 'o2', note: 'FULFILLED' },
        ],
        cursor: null,
      })
    })

    it('filters by order number', async () => {
      mock.onGet(url).reply({
        result: [
          { id: 'o1', orderNumber: 1001, fulfillmentStatus: 'PENDING' },
          { id: 'o2', orderNumber: 2002, fulfillmentStatus: 'PENDING' },
        ],
      })

      const result = await service.getOrdersDictionary({ search: '2002' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('o2')
    })

    it('filters by customer email and forwards the cursor', async () => {
      mock.onGet(url).reply({
        result: [
          { id: 'o1', orderNumber: 1, fulfillmentStatus: 'PENDING', customerEmail: 'a@example.com' },
          { id: 'o2', orderNumber: 2, fulfillmentStatus: 'PENDING', customerEmail: 'b@example.com' },
        ],
        pagination: { nextPageCursor: 'next-1' },
      })

      const result = await service.getOrdersDictionary({ search: 'B@EXAMPLE', cursor: 'cur-1' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('o2')
      expect(result.cursor).toBe('next-1')
      expect(mock.history[0].query).toEqual({ cursor: 'cur-1' })
    })

    it('handles a null payload and an empty response', async () => {
      mock.onGet(url).reply({})

      await expect(service.getOrdersDictionary(null)).resolves.toEqual({ items: [], cursor: null })
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('prefixes a known status with its hint', async () => {
      mock.onGet(`${ COMMERCE_API }/orders/o1`).replyWithError({
        message: 'Unauthorized',
        status: 401,
        body: { message: 'Invalid key' },
      })

      await expect(service.getOrder('o1')).rejects.toThrow(
        'Authentication failed - check the Squarespace API key and reconnect the account. (Invalid key)'
      )
    })

    it('uses body.error when body.message is absent', async () => {
      mock.onGet(`${ COMMERCE_API }/orders/o1`).replyWithError({
        message: 'Not Found',
        status: 404,
        body: { error: 'No such order' },
      })

      await expect(service.getOrder('o1')).rejects.toThrow(/Not found - the ID may be wrong.*No such order/)
    })

    it('falls back to a generic message for an unmapped status', async () => {
      mock.onGet(`${ COMMERCE_API }/orders/o1`).replyWithError({ message: 'Teapot', status: 418 })

      await expect(service.getOrder('o1')).rejects.toThrow('Squarespace API error: Teapot')
    })

    it('falls back to a generic message when there is no status at all', async () => {
      mock.onGet(`${ COMMERCE_API }/orders/o1`).replyWithError({ message: 'Network timeout' })

      await expect(service.getOrder('o1')).rejects.toThrow('Squarespace API error: Network timeout')
    })
  })

  // ── Polling triggers ──

  describe('handleTriggerPollingForEvent', () => {
    it('dispatches to the named event handler', async () => {
      mock.onGet(`${ COMMERCE_API }/orders`).reply({ result: [] })

      const result = await service.handleTriggerPollingForEvent({
        eventName: 'onNewOrder',
        triggerData: {},
        state: {},
      })

      expect(result.events).toEqual([])
      expect(result.state).toHaveProperty('createdFloor')
    })
  })

  describe('onNewOrder', () => {
    const url = `${ COMMERCE_API }/orders`

    it('seeds the created floor on the first cycle without emitting events', async () => {
      // The seed floor is max(newest createdOn, now - 24h), so the fixtures must be recent.
      const older = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString()
      const newest = new Date(Date.now() - 60 * 60 * 1000).toISOString()

      mock.onGet(url).reply({
        result: [
          { id: 'o1', createdOn: older },
          { id: 'o2', createdOn: newest },
          { id: 'o3', createdOn: newest },
        ],
      })

      const result = await service.onNewOrder({ triggerData: {}, state: {} })

      expect(result.events).toEqual([])
      expect(result.state.createdFloor).toBe(newest)
      expect(result.state.seenIds.sort()).toEqual(['o2', 'o3'])
      expect(mock.history[0].query).toHaveProperty('modifiedAfter')
      expect(mock.history[0].query).toHaveProperty('modifiedBefore')
      expect(mock.history[0].query).not.toHaveProperty('fulfillmentStatus')
    })

    it('maps the fulfillment status label into the seed query', async () => {
      mock.onGet(url).reply({ result: [] })

      await service.onNewOrder({ triggerData: { fulfillmentStatus: 'Pending' }, state: {} })

      expect(mock.history[0].query.fulfillmentStatus).toBe('PENDING')
    })

    it('omits the status filter for "Any Status"', async () => {
      mock.onGet(url).reply({ result: [] })

      await service.onNewOrder({ triggerData: { fulfillmentStatus: 'Any Status' }, state: {} })

      expect(mock.history[0].query).not.toHaveProperty('fulfillmentStatus')
    })

    it('handles a missing invocation state and trigger data', async () => {
      mock.onGet(url).reply({ result: [] })

      const result = await service.onNewOrder({})

      expect(result.events).toEqual([])
      expect(result.state.seenIds).toEqual([])
    })

    it('emits only orders created after the floor', async () => {
      mock.onGet(url).reply({
        result: [
          { id: 'o1', createdOn: '2024-01-01T00:00:00.000Z' },
          { id: 'o3', createdOn: '2024-01-03T00:00:00.000Z' },
          { id: 'o2', createdOn: '2024-01-02T00:00:00.000Z' },
        ],
      })

      const result = await service.onNewOrder({
        triggerData: {},
        state: {
          since: '2024-01-02T00:00:00.000Z',
          createdFloor: '2024-01-01T00:00:00.000Z',
          seenIds: ['o1'],
        },
      })

      expect(result.events.map(order => order.id)).toEqual(['o2', 'o3'])
      expect(result.state.createdFloor).toBe('2024-01-03T00:00:00.000Z')
      expect(result.state.seenIds).toEqual(['o3'])
    })

    it('emits an order sitting exactly on the floor when its id is unseen', async () => {
      mock.onGet(url).reply({
        result: [
          { id: 'o1', createdOn: '2024-01-01T00:00:00.000Z' },
          { id: 'o2', createdOn: '2024-01-01T00:00:00.000Z' },
        ],
      })

      const result = await service.onNewOrder({
        triggerData: {},
        state: {
          since: '2024-01-02T00:00:00.000Z',
          createdFloor: '2024-01-01T00:00:00.000Z',
          seenIds: ['o1'],
        },
      })

      expect(result.events.map(order => order.id)).toEqual(['o2'])
      expect(result.state.seenIds.sort()).toEqual(['o1', 'o2'])
    })

    it('pages through the order list using the pagination cursor', async () => {
      const page1CreatedOn = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
      const page2CreatedOn = new Date(Date.now() - 60 * 60 * 1000).toISOString()

      mock.onGet(url).replyWith(call => {
        if (call.query.cursor === 'page-2') {
          return { result: [{ id: 'o2', createdOn: page2CreatedOn }] }
        }

        return {
          result: [{ id: 'o1', createdOn: page1CreatedOn }],
          pagination: { hasNextPage: true, nextPageCursor: 'page-2' },
        }
      })

      const result = await service.onNewOrder({ triggerData: {}, state: {} })

      expect(mock.history).toHaveLength(2)
      expect(mock.history[1].query).toEqual({ cursor: 'page-2' })
      expect(result.state.createdFloor).toBe(page2CreatedOn)
    })
  })

  describe('onOrderFulfilled', () => {
    const url = `${ COMMERCE_API }/orders`

    it('seeds already-fulfilled orders on the first cycle', async () => {
      mock.onGet(url).reply({
        result: [{ id: 'o1', modifiedOn: '2024-01-01T00:00:00.000Z' }],
      })

      const result = await service.onOrderFulfilled({ state: {} })

      expect(result.events).toEqual([])
      expect(result.state.seen).toEqual({ o1: '2024-01-01T00:00:00.000Z' })
      expect(mock.history[0].query.fulfillmentStatus).toBe('FULFILLED')
    })

    it('seeds when the state has a since but no seen map', async () => {
      mock.onGet(url).reply({ result: [] })

      const result = await service.onOrderFulfilled({ state: { since: '2024-01-01T00:00:00.000Z' } })

      expect(result.events).toEqual([])
      expect(result.state.seen).toEqual({})
    })

    it('emits only orders that were not previously seen', async () => {
      const recent = new Date(Date.now() - 60 * 1000).toISOString()

      mock.onGet(url).reply({
        result: [
          { id: 'o1', modifiedOn: recent },
          { id: 'o2', modifiedOn: recent },
        ],
      })

      const result = await service.onOrderFulfilled({
        state: { since: recent, seen: { o1: recent } },
      })

      expect(result.events.map(order => order.id)).toEqual(['o2'])
      expect(Object.keys(result.state.seen).sort()).toEqual(['o1', 'o2'])
    })

    it('drops seen entries older than the retention horizon', async () => {
      const recent = new Date(Date.now() - 60 * 1000).toISOString()

      mock.onGet(url).reply({ result: [] })

      const result = await service.onOrderFulfilled({
        state: {
          since: recent,
          seen: { old: '2000-01-01T00:00:00.000Z', fresh: recent },
        },
      })

      expect(result.state.seen).toEqual({ fresh: recent })
      expect(result.events).toEqual([])
    })

    it('handles a missing invocation state', async () => {
      mock.onGet(url).reply({ result: [] })

      const result = await service.onOrderFulfilled({})

      expect(result.events).toEqual([])
      expect(result.state).toHaveProperty('since')
    })
  })
})
