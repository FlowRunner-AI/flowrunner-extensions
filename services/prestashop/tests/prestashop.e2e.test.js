'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

const SUFFIX = Date.now()

describe('PrestaShop Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('prestashop')
    require('../src/index.js')

    try {
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

  // ── Store reference ──

  describe('store reference', () => {
    it('lists the installed languages', async () => {
      const result = await service.listLanguages()

      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThan(0)
      expect(result[0]).toHaveProperty('id')
      expect(result[0]).toHaveProperty('iso_code')
    })

    it('lists the configured currencies', async () => {
      const result = await service.listCurrencies(5)

      expect(Array.isArray(result)).toBe(true)
    })

    it('lists manufacturers', async () => {
      const result = await service.listManufacturers(undefined, 5)

      expect(Array.isArray(result)).toBe(true)
    })

    it('returns a languages dictionary', async () => {
      const result = await service.getLanguagesDictionary({})

      expect(Array.isArray(result.items)).toBe(true)
      expect(result.items.length).toBeGreaterThan(0)
    })

    it('returns a manufacturers dictionary', async () => {
      const result = await service.getManufacturersDictionary({})

      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Categories ──

  describe('categories', () => {
    it('lists categories', async () => {
      const result = await service.listCategories(undefined, undefined, 5)

      expect(Array.isArray(result)).toBe(true)
    })

    it('returns a categories dictionary', async () => {
      const result = await service.getCategoriesDictionary({})

      expect(Array.isArray(result.items)).toBe(true)
    })

    it('retrieves a category when one exists', async () => {
      const list = await service.listCategories(undefined, undefined, 1)
      const category = list[0]

      if (!category) {
        console.log('Skipping getCategory: the store has no categories')

        return
      }

      const result = await service.getCategory(category.id)

      expect(result).toHaveProperty('id')
    })

    it('creates a category when enabled', async () => {
      if (!testValues.allowCategoryCreate) {
        console.log('Skipping createCategory: testValues.allowCategoryCreate not set (categories cannot be deleted by this service)')

        return
      }

      const parentCategoryId = testValues.parentCategoryId || '2'

      const result = await service.createCategory(`FlowRunner e2e ${ SUFFIX }`, parentCategoryId, false)

      expect(result).toHaveProperty('id')
    })
  })

  // ── Products ──

  describe('products', () => {
    let createdProductId

    it('lists products', async () => {
      const result = await service.listProducts(undefined, undefined, undefined, 5)

      expect(Array.isArray(result)).toBe(true)
    })

    it('lists products with filters and sorting', async () => {
      const result = await service.listProducts(undefined, undefined, 'Active', 5, 0, 'Name', 'Descending')

      expect(Array.isArray(result)).toBe(true)
    })

    it('retrieves a product when one exists', async () => {
      const list = await service.listProducts(undefined, undefined, undefined, 1)
      const product = list[0]

      if (!product) {
        console.log('Skipping getProduct: the store has no products')

        return
      }

      const result = await service.getProduct(product.id)

      expect(result).toHaveProperty('id')
    })

    it('creates a product', async () => {
      const result = await service.createProduct(
        `FlowRunner e2e ${ SUFFIX }`,
        '19.99',
        `FR-E2E-${ SUFFIX }`,
        false,
        '<p>Created by the FlowRunner e2e suite.</p>',
        'FlowRunner e2e',
        testValues.defaultCategoryId || '2'
      )

      expect(result).toHaveProperty('id')

      createdProductId = result.id
    })

    it('updates the created product', async () => {
      if (!createdProductId) {
        console.log('Skipping updateProduct: no product was created')

        return
      }

      const result = await service.updateProduct(
        createdProductId,
        `FlowRunner e2e ${ SUFFIX } (updated)`,
        '24.99'
      )

      expect(result).toHaveProperty('id')
    })

    it('reads and updates the product stock', async () => {
      if (!createdProductId) {
        console.log('Skipping stock operations: no product was created')

        return
      }

      const stockRecords = await service.listStockAvailables(createdProductId, 5)

      expect(Array.isArray(stockRecords)).toBe(true)

      const stock = stockRecords[0]

      if (!stock) {
        console.log('Skipping updateStockQuantity: the created product has no stock_available record')

        return
      }

      const fetched = await service.getStockAvailable(stock.id)

      expect(fetched).toHaveProperty('id')

      const updated = await service.updateStockQuantity(stock.id, 7, 'Deny Backorders')

      expect(updated).toBeDefined()
    })

    it('deletes the created product', async () => {
      if (!createdProductId) {
        console.log('Skipping deleteProduct: no product was created')

        return
      }

      const result = await service.deleteProduct(createdProductId)

      expect(result).toEqual({ success: true, id: createdProductId })
    })
  })

  // ── Stock ──

  describe('stock', () => {
    it('lists stock_available records', async () => {
      const result = await service.listStockAvailables(undefined, 5)

      expect(Array.isArray(result)).toBe(true)
    })
  })

  // ── Customers ──

  describe('customers', () => {
    let createdCustomerId

    it('lists customers', async () => {
      const result = await service.listCustomers(undefined, undefined, undefined, 5)

      expect(Array.isArray(result)).toBe(true)
    })

    it('creates a customer', async () => {
      const result = await service.createCustomer(
        'FlowRunner',
        `E2E ${ SUFFIX }`,
        `flowrunner-e2e-${ SUFFIX }@example.com`,
        `Passw0rd-${ SUFFIX }`,
        false
      )

      expect(result).toHaveProperty('id')

      createdCustomerId = result.id
    })

    it('retrieves the created customer', async () => {
      if (!createdCustomerId) {
        console.log('Skipping getCustomer: no customer was created')

        return
      }

      const result = await service.getCustomer(createdCustomerId)

      expect(result).toHaveProperty('email', `flowrunner-e2e-${ SUFFIX }@example.com`)
    })

    it('updates the created customer', async () => {
      if (!createdCustomerId) {
        console.log('Skipping updateCustomer: no customer was created')

        return
      }

      const result = await service.updateCustomer(
        createdCustomerId,
        'FlowRunner',
        `E2E ${ SUFFIX } updated`,
        undefined,
        'Inactive',
        'Unsubscribed',
        'Opted Out'
      )

      expect(result).toHaveProperty('id')
    })

    it('filters customers by email', async () => {
      const result = await service.listCustomers(`flowrunner-e2e-${ SUFFIX }`, undefined, undefined, 5)

      expect(Array.isArray(result)).toBe(true)
    })

    it('deletes the created customer', async () => {
      if (!createdCustomerId) {
        console.log('Skipping deleteCustomer: no customer was created')

        return
      }

      const result = await service.deleteCustomer(createdCustomerId)

      expect(result).toEqual({ success: true, id: createdCustomerId })
    })
  })

  // ── Orders ──

  describe('orders', () => {
    it('lists order states', async () => {
      const result = await service.listOrderStates()

      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThan(0)
    })

    it('returns an order states dictionary', async () => {
      const result = await service.getOrderStatesDictionary({})

      expect(Array.isArray(result.items)).toBe(true)
      expect(result.items.length).toBeGreaterThan(0)
    })

    it('lists orders', async () => {
      const result = await service.listOrders(undefined, undefined, undefined, undefined, 5)

      expect(Array.isArray(result)).toBe(true)
    })

    it('lists orders in a date range', async () => {
      const result = await service.listOrders(
        undefined,
        undefined,
        '2000-01-01',
        new Date().toISOString().slice(0, 10),
        5
      )

      expect(Array.isArray(result)).toBe(true)
    })

    it('retrieves an order when one exists', async () => {
      const list = await service.listOrders(undefined, undefined, undefined, undefined, 1)
      const order = list[0]

      if (!order) {
        console.log('Skipping getOrder: the store has no orders')

        return
      }

      const result = await service.getOrder(order.id)

      expect(result).toHaveProperty('id')
    })

    it('updates an order status when enabled', async () => {
      const { orderId, orderStateId } = testValues

      if (!orderId || !orderStateId) {
        console.log('Skipping updateOrderStatus: testValues.orderId or testValues.orderStateId not set')

        return
      }

      const result = await service.updateOrderStatus(orderId, orderStateId)

      expect(result).toBeDefined()
    })
  })

  // ── Addresses & carts ──

  describe('addresses and carts', () => {
    it('lists addresses', async () => {
      const result = await service.listAddresses(undefined, 5)

      expect(Array.isArray(result)).toBe(true)
    })

    it('retrieves an address when one exists', async () => {
      const list = await service.listAddresses(undefined, 1)
      const address = list[0]

      if (!address) {
        console.log('Skipping getAddress: the store has no addresses')

        return
      }

      const result = await service.getAddress(address.id)

      expect(result).toHaveProperty('id')
    })

    it('lists carts', async () => {
      const result = await service.listCarts(undefined, 5)

      expect(Array.isArray(result)).toBe(true)
    })

    it('retrieves a cart when one exists', async () => {
      const list = await service.listCarts(undefined, 1)
      const cart = list[0]

      if (!cart) {
        console.log('Skipping getCart: the store has no carts')

        return
      }

      const result = await service.getCart(cart.id)

      expect(result).toHaveProperty('id')
    })
  })

  // ── Advanced ──

  describe('callWebserviceResource', () => {
    it('reads an arbitrary resource as JSON', async () => {
      const result = await service.callWebserviceResource('languages', 'GET', { display: 'full', limit: '1' })

      expect(typeof result).toBe('object')
    })
  })

  // ── Errors ──

  describe('error handling', () => {
    it('throws a wrapped error for a missing product', async () => {
      await expect(service.getProduct(99999999)).rejects.toThrow('PrestaShop API error')
    })
  })
})
