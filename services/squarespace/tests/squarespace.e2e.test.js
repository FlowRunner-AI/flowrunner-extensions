'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Squarespace Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('squarespace')
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

  // ── Products ──

  describe('listProducts', () => {
    it('lists products', async () => {
      const result = await service.listProducts()

      expect(result).toHaveProperty('products')
      expect(Array.isArray(result.products)).toBe(true)
    })

    it('filters by product type', async () => {
      const result = await service.listProducts('Physical')

      expect(Array.isArray(result.products)).toBe(true)
    })
  })

  describe('create, get, update and delete a product', () => {
    let createdProductId

    it('creates a product on the configured store page', async () => {
      const { storePageId } = testValues

      if (!storePageId) {
        console.log('Skipping createProduct: testValues.storePageId not set')

        return
      }

      const result = await service.createProduct(
        storePageId,
        `FlowRunner E2E ${ Date.now() }`,
        9.99,
        'Created by the FlowRunner e2e suite',
        'USD',
        `E2E-${ Date.now() }`,
        3,
        false
      )

      expect(result).toHaveProperty('id')

      createdProductId = result.id
    })

    it('reads the created product back', async () => {
      if (!createdProductId) {
        console.log('Skipping getProduct: no product was created')

        return
      }

      const result = await service.getProduct(createdProductId)

      expect(result).toHaveProperty('id', createdProductId)
      expect(result).toHaveProperty('variants')
    })

    it('updates the created product', async () => {
      if (!createdProductId) {
        console.log('Skipping updateProduct: no product was created')

        return
      }

      const result = await service.updateProduct(createdProductId, `FlowRunner E2E updated ${ Date.now() }`)

      expect(result).toHaveProperty('id', createdProductId)
    })

    it('deletes the created product', async () => {
      if (!createdProductId) {
        console.log('Skipping deleteProduct: no product was created')

        return
      }

      const result = await service.deleteProduct(createdProductId)

      expect(result).toEqual({
        success: true,
        message: 'Product deleted successfully',
        productId: createdProductId,
      })
    })
  })

  // ── Orders ──

  describe('orders', () => {
    it('lists orders', async () => {
      const result = await service.listOrders()

      expect(result).toHaveProperty('result')
      expect(Array.isArray(result.result)).toBe(true)
    })

    it('lists orders filtered by fulfillment status', async () => {
      const result = await service.listOrders('Pending')

      expect(Array.isArray(result.result)).toBe(true)
    })

    it('retrieves a single order', async () => {
      const { orderId } = testValues

      if (!orderId) {
        console.log('Skipping getOrder: testValues.orderId not set')

        return
      }

      const result = await service.getOrder(orderId)

      expect(result).toHaveProperty('id', orderId)
    })
  })

  // ── Inventory ──

  describe('inventory', () => {
    it('lists inventory', async () => {
      const result = await service.listInventory()

      expect(result).toHaveProperty('inventory')
      expect(Array.isArray(result.inventory)).toBe(true)
    })

    it('retrieves inventory for a single variant', async () => {
      const result = await service.listInventory()
      const first = result.inventory?.[0]

      if (!first) {
        console.log('Skipping getInventory: the store has no inventory items')

        return
      }

      const item = await service.getInventory(undefined, first.variantId)

      expect(item).toHaveProperty('variantId', first.variantId)
    })
  })

  // ── Dictionaries ──

  describe('dictionaries', () => {
    it('lists store pages', async () => {
      const result = await service.getStorePagesDictionary({})

      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor')
    })

    it('lists products', async () => {
      const result = await service.getProductsDictionary({})

      expect(Array.isArray(result.items)).toBe(true)
    })

    it('lists orders', async () => {
      const result = await service.getOrdersDictionary({})

      expect(Array.isArray(result.items)).toBe(true)
    })

    it('returns no variants without a product criteria', async () => {
      const result = await service.getVariantsDictionary({ criteria: {} })

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('lists the variants of the first product', async () => {
      const products = await service.getProductsDictionary({})
      const first = products.items[0]

      if (!first) {
        console.log('Skipping getVariantsDictionary: the store has no products')

        return
      }

      const result = await service.getVariantsDictionary({ criteria: { productId: first.value } })

      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Polling triggers ──

  describe('polling triggers', () => {
    it('seeds the new-order trigger without emitting events', async () => {
      const result = await service.handleTriggerPollingForEvent({
        eventName: 'onNewOrder',
        triggerData: {},
        state: {},
      })

      expect(result.events).toEqual([])
      expect(result.state).toHaveProperty('createdFloor')
      expect(Array.isArray(result.state.seenIds)).toBe(true)
    })

    it('runs a second new-order cycle against the seeded state', async () => {
      const seed = await service.onNewOrder({ triggerData: {}, state: {} })
      const result = await service.onNewOrder({ triggerData: {}, state: seed.state })

      expect(Array.isArray(result.events)).toBe(true)
      expect(result.state).toHaveProperty('createdFloor')
    })

    it('seeds the order-fulfilled trigger without emitting events', async () => {
      const result = await service.onOrderFulfilled({ state: {} })

      expect(result.events).toEqual([])
      expect(result.state).toHaveProperty('seen')
    })

    it('runs a second order-fulfilled cycle against the seeded state', async () => {
      const seed = await service.onOrderFulfilled({ state: {} })
      const result = await service.onOrderFulfilled({ state: seed.state })

      expect(Array.isArray(result.events)).toBe(true)
    })
  })

  // ── Validation ──

  describe('parameter validation', () => {
    it('rejects a missing product id', async () => {
      await expect(service.getProduct()).rejects.toThrow('Product ID is required.')
    })

    it('rejects an update with no fields', async () => {
      await expect(service.updateProduct('any-id')).rejects.toThrow('Provide at least one field to update')
    })

    it('rejects a cursor combined with a modified-date range', async () => {
      await expect(service.listOrders(undefined, '2024-01-01', '2024-02-01', 'cur')).rejects.toThrow(
        'A pagination cursor cannot be combined with a modified-date range'
      )
    })

    it('rejects a stock adjustment without a variant', async () => {
      await expect(service.adjustStock('p1')).rejects.toThrow('Variant is required')
    })
  })

  // ── Errors ──

  describe('error handling', () => {
    it('throws a descriptive error for an unknown order', async () => {
      await expect(service.getOrder('00000000-0000-0000-0000-000000000000')).rejects.toThrow(/Not found|error/)
    })
  })
})
