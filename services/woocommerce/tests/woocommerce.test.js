'use strict'

const crypto = require('crypto')

const { createSandbox } = require('../../../service-sandbox')

const STORE_URL = 'https://shop.example.com'
const CONSUMER_KEY = 'ck_test'
const CONSUMER_SECRET = 'cs_test'
const BASE = `${ STORE_URL }/wp-json/wc/v3`
const BASIC = `Basic ${ Buffer.from(`${ CONSUMER_KEY }:${ CONSUMER_SECRET }`).toString('base64') }`

describe('WooCommerce Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({
      storeUrl: `${ STORE_URL }/`,
      consumerKey: CONSUMER_KEY,
      consumerSecret: CONSUMER_SECRET,
    })

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

  const lastCall = () => mock.history[mock.history.length - 1]

  // ── Registration & configuration ──

  describe('service registration', () => {
    it('registers the store URL and credential config items', () => {
      expect(sandbox.getConfigItems()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'storeUrl', required: true, shared: false }),
          expect.objectContaining({ name: 'consumerKey', required: true, shared: false }),
          expect.objectContaining({ name: 'consumerSecret', required: true, shared: false }),
          expect.objectContaining({ name: 'authMethod', type: 'CHOICE', shared: false }),
        ])
      )
    })

    it('strips trailing slashes from the store URL and builds the API base', () => {
      expect(service.storeUrl).toBe(STORE_URL)
      expect(service.apiBase).toBe(BASE)
    })

    it('defaults the auth method to header', () => {
      expect(service.authMethod).toBe('header')
    })
  })

  describe('authentication', () => {
    it('sends HTTP Basic credentials in the Authorization header', async () => {
      mock.onGet(`${ BASE }/products/1`).reply({ id: 1 })

      await service.getProduct(1)

      expect(lastCall().headers).toMatchObject({
        'Authorization': BASIC,
        'Content-Type': 'application/json',
      })
    })

    it('sends credentials as query params in query auth mode', async () => {
      jest.resetModules()

      const querySandbox = createSandbox({
        storeUrl: STORE_URL,
        consumerKey: CONSUMER_KEY,
        consumerSecret: CONSUMER_SECRET,
        authMethod: 'query',
      })

      require('../src/index.js')

      const queryService = querySandbox.getService()
      const queryMock = querySandbox.getRequestMock()

      queryMock.onGet(`${ BASE }/products/1`).reply({ id: 1 })

      await queryService.getProduct(1)

      expect(queryMock.history[0].query).toMatchObject({
        consumer_key: CONSUMER_KEY,
        consumer_secret: CONSUMER_SECRET,
      })

      expect(queryMock.history[0].headers.Authorization).toBeUndefined()

      querySandbox.cleanup()

      // Restore the shared sandbox for the remaining tests.
      jest.resetModules()
      global.Flowrunner = undefined

      sandbox = createSandbox({
        storeUrl: `${ STORE_URL }/`,
        consumerKey: CONSUMER_KEY,
        consumerSecret: CONSUMER_SECRET,
      })

      require('../src/index.js')
      service = sandbox.getService()
      mock = sandbox.getRequestMock()
    })

    it('throws a configuration error when the store URL is blank', async () => {
      jest.resetModules()

      const blankSandbox = createSandbox({ consumerKey: CONSUMER_KEY, consumerSecret: CONSUMER_SECRET })

      require('../src/index.js')

      const blankService = blankSandbox.getService()

      await expect(blankService.listProducts()).rejects.toThrow('Store URL is not configured')

      blankSandbox.cleanup()

      jest.resetModules()

      sandbox = createSandbox({
        storeUrl: `${ STORE_URL }/`,
        consumerKey: CONSUMER_KEY,
        consumerSecret: CONSUMER_SECRET,
      })

      require('../src/index.js')
      service = sandbox.getService()
      mock = sandbox.getRequestMock()
    })
  })

  // ── Products ──

  describe('createProduct', () => {
    it('sends only the provided fields', async () => {
      mock.onPost(`${ BASE }/products`).reply({ id: 799 })

      const result = await service.createProduct('Hoodie')

      expect(result).toEqual({ id: 799 })
      expect(lastCall().method).toBe('post')
      expect(lastCall().body).toEqual({ name: 'Hoodie' })
    })

    it('resolves dropdown labels, stock fields, categories, and additional fields', async () => {
      mock.onPost(`${ BASE }/products`).reply({ id: 800 })

      await service.createProduct(
        'Hoodie',
        'Variable (has variations)',
        'Draft',
        '21.99',
        '19.99',
        100,
        'Cozy',
        'PH-001',
        ['9', 12],
        { weight: '1.2' }
      )

      expect(lastCall().body).toEqual({
        name: 'Hoodie',
        type: 'variable',
        status: 'draft',
        regular_price: '21.99',
        sale_price: '19.99',
        manage_stock: true,
        stock_quantity: 100,
        description: 'Cozy',
        sku: 'PH-001',
        categories: [{ id: 9 }, { id: 12 }],
        weight: '1.2',
      })
    })

    it('accepts a comma-separated category list', async () => {
      mock.onPost(`${ BASE }/products`).reply({ id: 801 })

      await service.createProduct('Hoodie', undefined, undefined, undefined, undefined, undefined, undefined, undefined, '9, 12')

      expect(lastCall().body.categories).toEqual([{ id: 9 }, { id: 12 }])
    })

    it('passes unmapped dropdown values through unchanged', async () => {
      mock.onPost(`${ BASE }/products`).reply({ id: 802 })

      await service.createProduct('Hoodie', 'simple', 'publish')

      expect(lastCall().body).toMatchObject({ type: 'simple', status: 'publish' })
    })
  })

  describe('getProduct', () => {
    it('requests a single product', async () => {
      mock.onGet(`${ BASE }/products/799`).reply({ id: 799, name: 'Hoodie' })

      const result = await service.getProduct(799)

      expect(result).toEqual({ id: 799, name: 'Hoodie' })
      expect(lastCall().url).toBe(`${ BASE }/products/799`)
      expect(lastCall().body).toBeUndefined()
    })
  })

  describe('listProducts', () => {
    it('applies default paging', async () => {
      mock.onGet(`${ BASE }/products`).reply([])

      await service.listProducts()

      expect(lastCall().query).toEqual({ per_page: 20, page: 1 })
    })

    it('applies search, category, status, and paging', async () => {
      mock.onGet(`${ BASE }/products`).reply([{ id: 799 }])

      await service.listProducts('hoodie', '9', 'Published', 5, 2)

      expect(lastCall().query).toEqual({
        search: 'hoodie',
        category: '9',
        status: 'publish',
        per_page: 5,
        page: 2,
      })
    })
  })

  describe('updateProduct', () => {
    it('sends a PUT with only the changed fields', async () => {
      mock.onPut(`${ BASE }/products/799`).reply({ id: 799 })

      await service.updateProduct(799, 'New Name', undefined, undefined, 5, 'Published', { tax_class: 'reduced' })

      expect(lastCall().method).toBe('put')

      expect(lastCall().body).toEqual({
        name: 'New Name',
        manage_stock: true,
        stock_quantity: 5,
        status: 'publish',
        tax_class: 'reduced',
      })
    })
  })

  describe('deleteProduct', () => {
    it('trashes by default', async () => {
      mock.onDelete(`${ BASE }/products/799`).reply({ id: 799 })

      await service.deleteProduct(799)

      expect(lastCall().method).toBe('delete')
      expect(lastCall().query).toEqual({ force: false })
    })

    it('permanently deletes when force is set', async () => {
      mock.onDelete(`${ BASE }/products/799`).reply({ id: 799 })

      await service.deleteProduct(799, true)

      expect(lastCall().query).toEqual({ force: true })
    })
  })

  // ── Product variations ──

  describe('product variations', () => {
    it('creates a variation', async () => {
      mock.onPost(`${ BASE }/products/799/variations`).reply({ id: 733 })

      await service.createProductVariation(799, '24.99', '22.99', 50, 'PH-BLUE', [{ name: 'Color', option: 'Blue' }], { weight: '1' })

      expect(lastCall().body).toEqual({
        regular_price: '24.99',
        sale_price: '22.99',
        manage_stock: true,
        stock_quantity: 50,
        sku: 'PH-BLUE',
        attributes: [{ name: 'Color', option: 'Blue' }],
        weight: '1',
      })
    })

    it('gets a variation', async () => {
      mock.onGet(`${ BASE }/products/799/variations/733`).reply({ id: 733 })

      await service.getProductVariation(799, 733)

      expect(lastCall().url).toBe(`${ BASE }/products/799/variations/733`)
    })

    it('lists variations with default paging', async () => {
      mock.onGet(`${ BASE }/products/799/variations`).reply([])

      await service.listProductVariations(799)

      expect(lastCall().query).toEqual({ per_page: 20, page: 1 })
    })

    it('updates a variation', async () => {
      mock.onPut(`${ BASE }/products/799/variations/733`).reply({ id: 733 })

      await service.updateProductVariation(799, 733, '22.99', '20.99', 40)

      expect(lastCall().body).toEqual({
        regular_price: '22.99',
        sale_price: '20.99',
        manage_stock: true,
        stock_quantity: 40,
      })
    })

    it('force-deletes a variation', async () => {
      mock.onDelete(`${ BASE }/products/799/variations/733`).reply({ id: 733 })

      await service.deleteProductVariation(799, 733)

      expect(lastCall().query).toEqual({ force: true })
    })
  })

  // ── Product categories ──

  describe('product categories', () => {
    it('creates a category and coerces the parent to a number', async () => {
      mock.onPost(`${ BASE }/products/categories`).reply({ id: 9 })

      await service.createProductCategory('Clothing', '4', 'Apparel')

      expect(lastCall().body).toEqual({ name: 'Clothing', parent: 4, description: 'Apparel' })
    })

    it('omits the parent when not provided', async () => {
      mock.onPost(`${ BASE }/products/categories`).reply({ id: 10 })

      await service.createProductCategory('Clothing')

      expect(lastCall().body).toEqual({ name: 'Clothing' })
    })

    it('gets a category', async () => {
      mock.onGet(`${ BASE }/products/categories/9`).reply({ id: 9 })

      await service.getProductCategory(9)

      expect(lastCall().url).toBe(`${ BASE }/products/categories/9`)
    })

    it('lists categories', async () => {
      mock.onGet(`${ BASE }/products/categories`).reply([])

      await service.listProductCategories('cloth', 50, 3)

      expect(lastCall().query).toEqual({ search: 'cloth', per_page: 50, page: 3 })
    })

    it('updates a category', async () => {
      mock.onPut(`${ BASE }/products/categories/9`).reply({ id: 9 })

      await service.updateProductCategory(9, 'Apparel')

      expect(lastCall().body).toEqual({ name: 'Apparel' })
    })

    it('force-deletes a category', async () => {
      mock.onDelete(`${ BASE }/products/categories/9`).reply({ id: 9 })

      await service.deleteProductCategory(9)

      expect(lastCall().query).toEqual({ force: true })
    })
  })

  // ── Product attributes ──

  describe('product attributes', () => {
    it('creates an attribute and maps the order-by label', async () => {
      mock.onPost(`${ BASE }/products/attributes`).reply({ id: 1 })

      await service.createProductAttribute('Color', 'color', 'select', 'Name (Numeric)', true)

      expect(lastCall().body).toEqual({
        name: 'Color',
        slug: 'color',
        type: 'select',
        order_by: 'name_num',
        has_archives: true,
      })
    })

    it('gets an attribute', async () => {
      mock.onGet(`${ BASE }/products/attributes/1`).reply({ id: 1 })

      await service.getProductAttribute(1)

      expect(lastCall().url).toBe(`${ BASE }/products/attributes/1`)
    })

    it('lists attributes', async () => {
      mock.onGet(`${ BASE }/products/attributes`).reply([])

      await service.listProductAttributes()

      expect(lastCall().query).toEqual({ per_page: 20, page: 1 })
    })

    it('updates an attribute', async () => {
      mock.onPut(`${ BASE }/products/attributes/1`).reply({ id: 1 })

      await service.updateProductAttribute(1, 'Colour', undefined, 'Menu Order', false)

      expect(lastCall().body).toEqual({ name: 'Colour', order_by: 'menu_order', has_archives: false })
    })

    it('force-deletes an attribute', async () => {
      mock.onDelete(`${ BASE }/products/attributes/1`).reply({ id: 1 })

      await service.deleteProductAttribute(1)

      expect(lastCall().query).toEqual({ force: true })
    })
  })

  // ── Attribute terms ──

  describe('attribute terms', () => {
    it('creates a term and coerces the menu order', async () => {
      mock.onPost(`${ BASE }/products/attributes/1/terms`).reply({ id: 23 })

      await service.createAttributeTerm(1, 'Blue', 'blue', 'Blue variant', '2')

      expect(lastCall().body).toEqual({
        name: 'Blue',
        slug: 'blue',
        description: 'Blue variant',
        menu_order: 2,
      })
    })

    it('gets a term', async () => {
      mock.onGet(`${ BASE }/products/attributes/1/terms/23`).reply({ id: 23 })

      await service.getAttributeTerm(1, 23)

      expect(lastCall().url).toBe(`${ BASE }/products/attributes/1/terms/23`)
    })

    it('lists terms', async () => {
      mock.onGet(`${ BASE }/products/attributes/1/terms`).reply([])

      await service.listAttributeTerms(1, 'blue')

      expect(lastCall().query).toEqual({ search: 'blue', per_page: 20, page: 1 })
    })

    it('updates a term', async () => {
      mock.onPut(`${ BASE }/products/attributes/1/terms/23`).reply({ id: 23 })

      await service.updateAttributeTerm(1, 23, 'Navy')

      expect(lastCall().body).toEqual({ name: 'Navy' })
    })

    it('force-deletes a term', async () => {
      mock.onDelete(`${ BASE }/products/attributes/1/terms/23`).reply({ id: 23 })

      await service.deleteAttributeTerm(1, 23)

      expect(lastCall().query).toEqual({ force: true })
    })
  })

  // ── Orders ──

  describe('createOrder', () => {
    it('maps status, customer, and line items', async () => {
      mock.onPost(`${ BASE }/orders`).reply({ id: 727 })

      await service.createOrder(
        'Processing',
        '12',
        'bacs',
        true,
        { first_name: 'Ada' },
        { city: 'London' },
        [{ productId: '799', quantity: '2' }, { productId: 800, variationId: 733 }],
        { currency: 'USD' }
      )

      expect(lastCall().body).toEqual({
        status: 'processing',
        customer_id: 12,
        payment_method: 'bacs',
        set_paid: true,
        billing: { first_name: 'Ada' },
        shipping: { city: 'London' },
        line_items: [
          { product_id: 799, quantity: 2 },
          { product_id: 800, quantity: 1, variation_id: 733 },
        ],
        currency: 'USD',
      })
    })

    it('omits line items when the array is empty', async () => {
      mock.onPost(`${ BASE }/orders`).reply({ id: 728 })

      await service.createOrder(undefined, undefined, undefined, undefined, undefined, undefined, [])

      expect(lastCall().body).toEqual({})
    })
  })

  describe('orders', () => {
    it('gets an order', async () => {
      mock.onGet(`${ BASE }/orders/727`).reply({ id: 727 })

      await service.getOrder(727)

      expect(lastCall().url).toBe(`${ BASE }/orders/727`)
    })

    it('lists orders with filters', async () => {
      mock.onGet(`${ BASE }/orders`).reply([])

      await service.listOrders('ada', 'Completed', '12', 10, 2)

      expect(lastCall().query).toEqual({
        search: 'ada',
        status: 'completed',
        customer: 12,
        per_page: 10,
        page: 2,
      })
    })

    it('updates an order status', async () => {
      mock.onPut(`${ BASE }/orders/727`).reply({ id: 727 })

      await service.updateOrder(727, 'Refunded', { customer_note: 'sorry' })

      expect(lastCall().body).toEqual({ status: 'refunded', customer_note: 'sorry' })
    })

    it('deletes an order', async () => {
      mock.onDelete(`${ BASE }/orders/727`).reply({ id: 727 })

      await service.deleteOrder(727, true)

      expect(lastCall().query).toEqual({ force: true })
    })
  })

  // ── Order notes & refunds ──

  describe('order notes', () => {
    it('creates a note and coerces the customer-note flag', async () => {
      mock.onPost(`${ BASE }/orders/727/notes`).reply({ id: 281 })

      await service.createOrderNote(727, 'Shipped today')

      expect(lastCall().body).toEqual({ note: 'Shipped today', customer_note: false })
    })

    it('gets a note', async () => {
      mock.onGet(`${ BASE }/orders/727/notes/281`).reply({ id: 281 })

      await service.getOrderNote(727, 281)

      expect(lastCall().url).toBe(`${ BASE }/orders/727/notes/281`)
    })

    it('lists notes without query params', async () => {
      mock.onGet(`${ BASE }/orders/727/notes`).reply([])

      await service.listOrderNotes(727)

      expect(lastCall().query).toEqual({})
    })

    it('force-deletes a note', async () => {
      mock.onDelete(`${ BASE }/orders/727/notes/281`).reply({ id: 281 })

      await service.deleteOrderNote(727, 281)

      expect(lastCall().query).toEqual({ force: true })
    })
  })

  describe('order refunds', () => {
    it('creates a refund', async () => {
      mock.onPost(`${ BASE }/orders/727/refunds`).reply({ id: 726 })

      await service.createOrderRefund(727, '10.00', 'Damaged', true, { line_items: [] })

      expect(lastCall().body).toEqual({
        amount: '10.00',
        reason: 'Damaged',
        api_refund: true,
        line_items: [],
      })
    })

    it('gets a refund', async () => {
      mock.onGet(`${ BASE }/orders/727/refunds/726`).reply({ id: 726 })

      await service.getOrderRefund(727, 726)

      expect(lastCall().url).toBe(`${ BASE }/orders/727/refunds/726`)
    })

    it('lists refunds', async () => {
      mock.onGet(`${ BASE }/orders/727/refunds`).reply([])

      await service.listOrderRefunds(727)

      expect(lastCall().method).toBe('get')
    })

    it('force-deletes a refund', async () => {
      mock.onDelete(`${ BASE }/orders/727/refunds/726`).reply({ id: 726 })

      await service.deleteOrderRefund(727, 726)

      expect(lastCall().query).toEqual({ force: true })
    })
  })

  // ── Customers ──

  describe('customers', () => {
    it('creates a customer', async () => {
      mock.onPost(`${ BASE }/customers`).reply({ id: 25 })

      await service.createCustomer('ada@example.com', 'Ada', 'Lovelace', 'ada', 'secret', { city: 'London' }, { shipping: {} })

      expect(lastCall().body).toEqual({
        email: 'ada@example.com',
        first_name: 'Ada',
        last_name: 'Lovelace',
        username: 'ada',
        password: 'secret',
        billing: { city: 'London' },
        shipping: {},
      })
    })

    it('gets a customer', async () => {
      mock.onGet(`${ BASE }/customers/25`).reply({ id: 25 })

      await service.getCustomer(25)

      expect(lastCall().url).toBe(`${ BASE }/customers/25`)
    })

    it('lists customers by email', async () => {
      mock.onGet(`${ BASE }/customers`).reply([])

      await service.listCustomers(undefined, 'ada@example.com')

      expect(lastCall().query).toEqual({ email: 'ada@example.com', per_page: 20, page: 1 })
    })

    it('updates a customer', async () => {
      mock.onPut(`${ BASE }/customers/25`).reply({ id: 25 })

      await service.updateCustomer(25, 'Ada', undefined, { role: 'customer' })

      expect(lastCall().body).toEqual({ first_name: 'Ada', role: 'customer' })
    })

    it('deletes a customer and reassigns their content', async () => {
      mock.onDelete(`${ BASE }/customers/25`).reply({ id: 25 })

      await service.deleteCustomer(25, '1')

      expect(lastCall().query).toEqual({ force: true, reassign: 1 })
    })

    it('deletes a customer without reassignment', async () => {
      mock.onDelete(`${ BASE }/customers/25`).reply({ id: 25 })

      await service.deleteCustomer(25)

      expect(lastCall().query).toEqual({ force: true })
    })
  })

  // ── Coupons ──

  describe('coupons', () => {
    it('creates a coupon and maps the discount type label', async () => {
      mock.onPost(`${ BASE }/coupons`).reply({ id: 719 })

      await service.createCoupon('SAVE10', 'Percentage off', '10', 'Ten percent', { individual_use: true })

      expect(lastCall().body).toEqual({
        code: 'SAVE10',
        discount_type: 'percent',
        amount: '10',
        description: 'Ten percent',
        individual_use: true,
      })
    })

    it('gets a coupon', async () => {
      mock.onGet(`${ BASE }/coupons/719`).reply({ id: 719 })

      await service.getCoupon(719)

      expect(lastCall().url).toBe(`${ BASE }/coupons/719`)
    })

    it('lists coupons', async () => {
      mock.onGet(`${ BASE }/coupons`).reply([])

      await service.listCoupons('save')

      expect(lastCall().query).toEqual({ search: 'save', per_page: 20, page: 1 })
    })

    it('updates a coupon', async () => {
      mock.onPut(`${ BASE }/coupons/719`).reply({ id: 719 })

      await service.updateCoupon(719, '15')

      expect(lastCall().body).toEqual({ amount: '15' })
    })

    it('deletes a coupon', async () => {
      mock.onDelete(`${ BASE }/coupons/719`).reply({ id: 719 })

      await service.deleteCoupon(719)

      expect(lastCall().query).toEqual({ force: false })
    })
  })

  // ── Batch ──

  describe('batch operations', () => {
    it('batches products and converts delete ids to numbers', async () => {
      mock.onPost(`${ BASE }/products/batch`).reply({ create: [], update: [], delete: [] })

      await service.batchProducts([{ name: 'A' }], [{ id: 2 }], ['3', 4, 'nope'])

      expect(lastCall().body).toEqual({
        create: [{ name: 'A' }],
        update: [{ id: 2 }],
        delete: [3, 4],
      })
    })

    it('omits the delete list when it is empty', async () => {
      mock.onPost(`${ BASE }/orders/batch`).reply({})

      await service.batchOrders([{ status: 'pending' }], undefined, [])

      expect(lastCall().body).toEqual({ create: [{ status: 'pending' }] })
    })

    it('batches customers', async () => {
      mock.onPost(`${ BASE }/customers/batch`).reply({})

      await service.batchCustomers(undefined, [{ id: 25, first_name: 'Ada' }])

      expect(lastCall().url).toBe(`${ BASE }/customers/batch`)
      expect(lastCall().body).toEqual({ update: [{ id: 25, first_name: 'Ada' }] })
    })
  })

  // ── Dictionaries ──

  describe('getProductsDictionary', () => {
    it('maps products to label/value/note', async () => {
      mock.onGet(`${ BASE }/products`).reply([{ id: 799, name: 'Hoodie', sku: 'PH-001' }])

      const result = await service.getProductsDictionary({})

      expect(result).toEqual({
        items: [{ label: 'Hoodie', value: '799', note: 'SKU: PH-001 · ID: 799' }],
        cursor: null,
      })

      expect(lastCall().query).toEqual({ per_page: 20, page: 1 })
    })

    it('handles a null payload and a missing SKU', async () => {
      mock.onGet(`${ BASE }/products`).reply([{ id: 800, name: 'Cap' }])

      const result = await service.getProductsDictionary(null)

      expect(result.items[0].note).toBe('SKU: — · ID: 800')
    })

    it('advances the cursor on a full page and honours the incoming cursor', async () => {
      mock.onGet(`${ BASE }/products`).reply(Array.from({ length: 20 }, (_, i) => ({ id: i, name: `P${ i }` })))

      const result = await service.getProductsDictionary({ search: 'p', cursor: '2' })

      expect(result.cursor).toBe('3')
      expect(lastCall().query).toEqual({ search: 'p', per_page: 20, page: 2 })
    })

    it('falls back to page 1 for an invalid cursor', async () => {
      mock.onGet(`${ BASE }/products`).reply([])

      await service.getProductsDictionary({ cursor: 'abc' })

      expect(lastCall().query).toMatchObject({ page: 1 })
    })

    it('returns an empty list when the response is not an array', async () => {
      mock.onGet(`${ BASE }/products`).reply(null)

      const result = await service.getProductsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getProductCategoriesDictionary', () => {
    it('maps categories with their product count', async () => {
      mock.onGet(`${ BASE }/products/categories`).reply([{ id: 9, name: 'Clothing', count: 4 }])

      const result = await service.getProductCategoriesDictionary({})

      expect(result.items).toEqual([{ label: 'Clothing', value: '9', note: '4 products · ID: 9' }])
    })

    it('defaults a missing count to zero', async () => {
      mock.onGet(`${ BASE }/products/categories`).reply([{ id: 10, name: 'Hats' }])

      const result = await service.getProductCategoriesDictionary({})

      expect(result.items[0].note).toBe('0 products · ID: 10')
    })
  })

  describe('getProductAttributesDictionary', () => {
    it('maps attributes and defaults the type note', async () => {
      mock.onGet(`${ BASE }/products/attributes`).reply([
        { id: 1, name: 'Color', type: 'select' },
        { id: 2, name: 'Size' },
      ])

      const result = await service.getProductAttributesDictionary({})

      expect(result.items).toEqual([
        { label: 'Color', value: '1', note: 'Type: select · ID: 1' },
        { label: 'Size', value: '2', note: 'Type: select · ID: 2' },
      ])
    })
  })

  describe('getAttributeTermsDictionary', () => {
    it('returns nothing when the parent attribute is not selected', async () => {
      const result = await service.getAttributeTermsDictionary({ criteria: {} })

      expect(result).toEqual({ items: [], cursor: null })
      expect(mock.history).toHaveLength(0)
    })

    it('lists the terms of the selected attribute', async () => {
      mock.onGet(`${ BASE }/products/attributes/1/terms`).reply([{ id: 23, name: 'Blue', count: 2 }])

      const result = await service.getAttributeTermsDictionary({ criteria: { attributeId: '1' } })

      expect(result.items).toEqual([{ label: 'Blue', value: '23', note: '2 products · ID: 23' }])
    })
  })

  describe('getProductVariationsDictionary', () => {
    it('returns nothing when the parent product is not selected', async () => {
      const result = await service.getProductVariationsDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('labels variations by their attribute options', async () => {
      mock.onGet(`${ BASE }/products/799/variations`).reply([
        { id: 733, sku: 'PH-BLUE', attributes: [{ option: 'Blue' }, { option: 'L' }] },
        { id: 734 },
      ])

      const result = await service.getProductVariationsDictionary({ criteria: { productId: '799' } })

      expect(result.items).toEqual([
        { label: 'Blue / L', value: '733', note: 'SKU: PH-BLUE · ID: 733' },
        { label: 'Variation #734', value: '734', note: 'SKU: — · ID: 734' },
      ])
    })
  })

  describe('getOrdersDictionary', () => {
    it('labels orders by billing name', async () => {
      mock.onGet(`${ BASE }/orders`).reply([
        { id: 727, status: 'processing', total: '29.99', billing: { first_name: 'Ada', last_name: 'Lovelace' } },
      ])

      const result = await service.getOrdersDictionary({})

      expect(result.items).toEqual([
        { label: 'Order #727 — Ada Lovelace', value: '727', note: 'processing · 29.99' },
      ])
    })

    it('falls back to the billing email and then to Guest', async () => {
      mock.onGet(`${ BASE }/orders`).reply([
        { id: 728, status: 'pending', total: '0.00', billing: { email: 'ada@example.com' } },
        { id: 729, status: 'pending', total: '0.00' },
      ])

      const result = await service.getOrdersDictionary({})

      expect(result.items[0].label).toBe('Order #728 — ada@example.com')
      expect(result.items[1].label).toBe('Order #729 — Guest')
    })
  })

  describe('getOrderNotesDictionary', () => {
    it('returns nothing when the order is not selected', async () => {
      const result = await service.getOrderNotesDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('filters notes locally and never advertises a cursor', async () => {
      mock.onGet(`${ BASE }/orders/727/notes`).reply([
        { id: 281, note: 'Shipped today', customer_note: true },
        { id: 282, note: 'Internal remark', customer_note: false },
      ])

      const result = await service.getOrderNotesDictionary({ search: 'SHIPPED', criteria: { orderId: 727 } })

      expect(result).toEqual({
        items: [{ label: 'Shipped today', value: '281', note: 'customer note · ID: 281' }],
        cursor: null,
      })
    })

    it('truncates long note labels', async () => {
      const longNote = 'x'.repeat(80)

      mock.onGet(`${ BASE }/orders/727/notes`).reply([{ id: 283, note: longNote, customer_note: false }])

      const result = await service.getOrderNotesDictionary({ criteria: { orderId: 727 } })

      expect(result.items[0].label).toHaveLength(60)
      expect(result.items[0].label.endsWith('…')).toBe(true)
      expect(result.items[0].note).toBe('private note · ID: 283')
    })
  })

  describe('getOrderRefundsDictionary', () => {
    it('returns nothing when the order is not selected', async () => {
      const result = await service.getOrderRefundsDictionary({ criteria: {} })

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('labels refunds and falls back when there is no reason', async () => {
      mock.onGet(`${ BASE }/orders/727/refunds`).reply([
        { id: 726, amount: '10.00', reason: 'Damaged' },
        { id: 727, amount: '5.00' },
      ])

      const result = await service.getOrderRefundsDictionary({ criteria: { orderId: 727 } })

      expect(result.items).toEqual([
        { label: 'Refund 10.00 — Damaged', value: '726', note: 'ID: 726' },
        { label: 'Refund 5.00 — No reason', value: '727', note: 'ID: 727' },
      ])
    })
  })

  describe('getCustomersDictionary', () => {
    it('prefers the full name, then username, then email, then the id', async () => {
      mock.onGet(`${ BASE }/customers`).reply([
        { id: 25, first_name: 'Ada', last_name: 'Lovelace', email: 'ada@example.com' },
        { id: 26, username: 'grace' },
        { id: 27, email: 'alan@example.com' },
        { id: 28 },
      ])

      const result = await service.getCustomersDictionary({})

      expect(result.items.map(i => i.label)).toEqual([
        'Ada Lovelace',
        'grace',
        'alan@example.com',
        'Customer #28',
      ])

      expect(result.items[3].note).toBe('— · ID: 28')
    })
  })

  describe('getCouponsDictionary', () => {
    it('maps coupons by code', async () => {
      mock.onGet(`${ BASE }/coupons`).reply([{ id: 719, code: 'SAVE10', discount_type: 'percent', amount: '10' }])

      const result = await service.getCouponsDictionary({})

      expect(result.items).toEqual([{ label: 'SAVE10', value: '719', note: 'percent 10 · ID: 719' }])
    })
  })

  // ── Param schema ──

  describe('addressSchema', () => {
    it('returns the address sub-form definition', async () => {
      const schema = await service.addressSchema()

      expect(Array.isArray(schema)).toBe(true)
      expect(schema).toHaveLength(11)

      expect(schema.map(f => f.name)).toEqual(
        expect.arrayContaining(['first_name', 'address_1', 'city', 'postcode', 'country', 'email', 'phone'])
      )

      schema.forEach(field => expect(field).toMatchObject({ type: 'String', required: false }))
    })
  })

  // ── Triggers ──

  describe('trigger markers', () => {
    it('resolve without performing any request', async () => {
      await expect(service.onOrderCreated()).resolves.toBeUndefined()
      await expect(service.onOrderUpdated()).resolves.toBeUndefined()
      await expect(service.onProductCreated()).resolves.toBeUndefined()
      await expect(service.onProductUpdated()).resolves.toBeUndefined()
      await expect(service.onCustomerCreated()).resolves.toBeUndefined()
      await expect(service.onCustomerUpdated()).resolves.toBeUndefined()
      expect(mock.history).toHaveLength(0)
    })
  })

  describe('handleTriggerUpsertWebhook', () => {
    it('creates one webhook per subscribed topic', async () => {
      mock.onPost(`${ BASE }/webhooks`).replyWith(call => ({ id: call.body.topic === 'order.created' ? 11 : 12 }))

      const result = await service.handleTriggerUpsertWebhook({
        events: [{ name: 'onOrderCreated' }, { name: 'onOrderUpdated' }],
        callbackUrl: 'https://flowrunner.example/callback',
        webhookData: {},
      })

      expect(mock.history).toHaveLength(2)

      expect(mock.history[0].body).toMatchObject({
        topic: 'order.created',
        delivery_url: 'https://flowrunner.example/callback',
        status: 'active',
        name: 'FlowRunner order.created',
      })

      expect(typeof mock.history[0].body.secret).toBe('string')
      expect(result.eventScopeId).toBe(STORE_URL)
      expect(result.webhookData.webhooks.map(w => w.topic).sort()).toEqual(['order.created', 'order.updated'])
    })

    it('deletes webhooks whose topic is no longer subscribed', async () => {
      mock.onDelete(`${ BASE }/webhooks/11`).reply({ id: 11 })

      const result = await service.handleTriggerUpsertWebhook({
        events: [],
        callbackUrl: 'https://flowrunner.example/callback',
        webhookData: { webhooks: [{ id: 11, topic: 'order.created', secret: 's' }] },
      })

      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].query).toEqual({ force: true })
      expect(result.webhookData.webhooks).toEqual([])
    })

    it('keeps an existing webhook and ignores unknown event names', async () => {
      const result = await service.handleTriggerUpsertWebhook({
        events: [{ name: 'onOrderCreated' }, { name: 'onSomethingElse' }],
        callbackUrl: 'https://flowrunner.example/callback',
        webhookData: { webhooks: [{ id: 11, topic: 'order.created', secret: 's' }] },
      })

      expect(mock.history).toHaveLength(0)
      expect(result.webhookData.webhooks).toEqual([{ id: 11, topic: 'order.created', secret: 's' }])
    })
  })

  describe('handleTriggerResolveEvents', () => {
    it('maps a topic header to the matching trigger event', async () => {
      const result = await service.handleTriggerResolveEvents({
        headers: { 'X-WC-Webhook-Topic': 'order.created' },
        body: { id: 727 },
      })

      expect(result).toEqual({ events: [{ name: 'onOrderCreated', data: { id: 727 } }] })
    })

    it('ignores the webhook handshake ping', async () => {
      const result = await service.handleTriggerResolveEvents({
        headers: { 'x-wc-webhook-topic': 'order.created' },
        body: { webhook_id: 11 },
      })

      expect(result).toEqual({ events: [] })
    })

    it('ignores a delivery with no topic header', async () => {
      const result = await service.handleTriggerResolveEvents({ headers: {}, body: { id: 1 } })

      expect(result).toEqual({ events: [] })
    })

    it('ignores an unmapped topic', async () => {
      const result = await service.handleTriggerResolveEvents({
        httpHeaders: { 'x-wc-webhook-topic': 'coupon.deleted' },
        body: { id: 1 },
      })

      expect(result).toEqual({ events: [] })
    })

    it('accepts a delivery with a valid HMAC signature', async () => {
      const rawBody = JSON.stringify({ id: 727 })
      const secret = 'topsecret'
      const signature = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64')

      const result = await service.handleTriggerResolveEvents({
        headers: { 'x-wc-webhook-topic': 'order.created', 'x-wc-webhook-signature': signature },
        body: { id: 727 },
        rawBody,
        webhookData: { webhooks: [{ id: 11, topic: 'order.created', secret }] },
      })

      expect(result.events[0].name).toBe('onOrderCreated')
    })

    it('rejects a delivery with a mismatched HMAC signature', async () => {
      const rawBody = JSON.stringify({ id: 727 })
      const badSignature = crypto.createHmac('sha256', 'other').update(rawBody, 'utf8').digest('base64')

      await expect(service.handleTriggerResolveEvents({
        headers: { 'x-wc-webhook-topic': 'order.created', 'x-wc-webhook-signature': badSignature },
        body: { id: 727 },
        rawBody,
        webhookData: { webhooks: [{ id: 11, topic: 'order.created', secret: 'topsecret' }] },
      })).rejects.toThrow('Webhook signature verification failed')
    })

    it('rejects a signature of a different length', async () => {
      await expect(service.handleTriggerResolveEvents({
        headers: { 'x-wc-webhook-topic': 'order.created', 'x-wc-webhook-signature': 'short' },
        body: { id: 727 },
        bodyString: JSON.stringify({ id: 727 }),
        webhookData: { webhooks: [{ id: 11, topic: 'order.created', secret: 'topsecret' }] },
      })).rejects.toThrow('Webhook signature verification failed')
    })

    it('skips verification when the secret is unavailable', async () => {
      const result = await service.handleTriggerResolveEvents({
        headers: { 'x-wc-webhook-topic': 'order.created', 'x-wc-webhook-signature': 'anything' },
        body: '{"id":727}',
        webhookData: { webhooks: [] },
      })

      expect(result.events[0].name).toBe('onOrderCreated')
    })
  })

  describe('handleTriggerSelectMatched', () => {
    it('matches every subscribed trigger', async () => {
      const result = await service.handleTriggerSelectMatched({ triggers: [{ id: 'a' }, { id: 'b' }] })

      expect(result).toEqual({ ids: ['a', 'b'] })
    })

    it('returns an empty list when there are no triggers', async () => {
      const result = await service.handleTriggerSelectMatched({})

      expect(result).toEqual({ ids: [] })
    })
  })

  describe('handleTriggerDeleteWebhook', () => {
    it('deletes every stored webhook', async () => {
      mock.onDelete(`${ BASE }/webhooks/11`).reply({ id: 11 })
      mock.onDelete(`${ BASE }/webhooks/12`).reply({ id: 12 })

      const result = await service.handleTriggerDeleteWebhook({
        webhookData: { webhooks: [{ id: 11, topic: 'order.created' }, { id: 12, topic: 'order.updated' }] },
      })

      expect(mock.history).toHaveLength(2)
      expect(result).toEqual({ webhookData: { webhooks: [] } })
    })

    it('swallows deletion failures', async () => {
      mock.onDelete(`${ BASE }/webhooks/11`).replyWithError({ message: 'Gone', status: 404 })

      const result = await service.handleTriggerDeleteWebhook({
        webhookData: { webhooks: [{ id: 11, topic: 'order.created' }] },
      })

      expect(result).toEqual({ webhookData: { webhooks: [] } })
    })

    it('handles missing webhook data', async () => {
      const result = await service.handleTriggerDeleteWebhook({})

      expect(result).toEqual({ webhookData: { webhooks: [] } })
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('prefixes a known status with a plain-English hint', async () => {
      mock.onGet(`${ BASE }/products/999`).replyWithError({
        message: 'Not Found',
        status: 404,
        body: { message: 'Invalid ID.' },
      })

      await expect(service.getProduct(999)).rejects.toThrow(
        'Not found — the ID may be wrong; use the matching dictionary/"List" action to pick a valid one. (Invalid ID.)'
      )
    })

    it('reads the status from the WordPress error body when absent on the error', async () => {
      mock.onGet(`${ BASE }/products`).replyWithError({
        message: 'Unauthorized',
        body: { message: 'Consumer key is missing.', data: { status: 401 } },
      })

      await expect(service.listProducts()).rejects.toThrow(
        'Authentication failed — verify the Consumer Key/Secret and that the key has the required permissions. (Consumer key is missing.)'
      )
    })

    it('falls back to the raw message for an unknown status', async () => {
      mock.onPost(`${ BASE }/products`).replyWithError({ message: 'socket hang up' })

      await expect(service.createProduct('Hoodie')).rejects.toThrow('socket hang up')
    })
  })
})
