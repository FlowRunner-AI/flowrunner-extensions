'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('ShipStation Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('shipstation')
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

  // ── Carriers ──

  describe('carriers', () => {
    it('lists the connected carriers', async () => {
      const result = await service.listCarriers()

      expect(Array.isArray(result)).toBe(true)

      if (result.length) {
        expect(result[0]).toHaveProperty('code')
      }
    })

    it('lists services and packages for the first carrier', async () => {
      const carriers = await service.listCarriers()

      if (!carriers.length) {
        console.log('Skipping carrier services/packages: no carriers connected')

        return
      }

      const carrierCode = carriers[0].code

      const services = await service.listCarrierServices(carrierCode)

      expect(Array.isArray(services)).toBe(true)

      const packages = await service.listCarrierPackages(carrierCode)

      expect(Array.isArray(packages)).toBe(true)
    })
  })

  // ── Dictionaries ──

  describe('dictionaries', () => {
    it('returns carriers as dictionary items', async () => {
      const result = await service.getCarriersDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result.cursor).toBeNull()
    })

    it('returns an empty carrier services dictionary without a carrier', async () => {
      const result = await service.getCarrierServicesDictionary({ criteria: {} })

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('returns carrier services and packages for the first carrier', async () => {
      const carriers = await service.getCarriersDictionary({})

      if (!carriers.items.length) {
        console.log('Skipping carrier services/packages dictionaries: no carriers connected')

        return
      }

      const carrierCode = carriers.items[0].value

      const services = await service.getCarrierServicesDictionary({ criteria: { carrierCode } })

      expect(Array.isArray(services.items)).toBe(true)

      const packages = await service.getCarrierPackagesDictionary({ criteria: { carrierCode } })

      expect(Array.isArray(packages.items)).toBe(true)
    })

    it('returns stores, warehouses and tags as dictionary items', async () => {
      const stores = await service.getStoresDictionary({})

      expect(Array.isArray(stores.items)).toBe(true)

      const warehouses = await service.getWarehousesDictionary({})

      expect(Array.isArray(warehouses.items)).toBe(true)

      const tags = await service.getTagsDictionary({})

      expect(Array.isArray(tags.items)).toBe(true)
    })

    it('returns the static dictionaries', () => {
      expect(service.getOrderStatusesDictionary().items.length).toBeGreaterThan(0)
      expect(service.getWebhookEventsDictionary().items.length).toBeGreaterThan(0)
      expect(service.getConfirmationTypesDictionary().items.length).toBeGreaterThan(0)
    })

    it('returns the parameter schemas', () => {
      expect(service.createInsuranceOptionsSchema().length).toBeGreaterThan(0)
      expect(service.createInternationalOptionsSchema().length).toBeGreaterThan(0)
      expect(service.createAdvancedOptionsSchema().length).toBeGreaterThan(0)
    })
  })

  // ── Orders ──

  describe('orders', () => {
    it('lists orders', async () => {
      const result = await service.listOrders(undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, 'Create Date', 'Descending', 1, 5)

      expect(result).toHaveProperty('orders')
      expect(Array.isArray(result.orders)).toBe(true)
    })

    it('fetches a single order', async () => {
      const { orderId } = testValues

      if (!orderId) {
        console.log('Skipping getOrder: testValues.orderId not set')

        return
      }

      const result = await service.getOrder(orderId)

      expect(result).toHaveProperty('orderId')
    })

    it('lists the account tags', async () => {
      const result = await service.listTags()

      expect(Array.isArray(result)).toBe(true)
    })
  })

  // ── Shipments ──

  describe('shipments', () => {
    it('lists shipments', async () => {
      const result = await service.listShipments(undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined, undefined, undefined, false,
        'Create Date', 'Descending', 1, 5)

      expect(result).toHaveProperty('shipments')
      expect(Array.isArray(result.shipments)).toBe(true)
    })

    it('lists fulfillments', async () => {
      const result = await service.listFulfillments(undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, 'Create Date', 'Descending', 1, 5)

      expect(result).toHaveProperty('fulfillments')
    })

    it('quotes rates for a domestic shipment', async () => {
      const { rateCarrierCode, fromPostalCode, toPostalCode } = testValues

      if (!rateCarrierCode || !fromPostalCode || !toPostalCode) {
        console.log('Skipping getShipmentRates: testValues.rateCarrierCode/fromPostalCode/toPostalCode not set')

        return
      }

      const result = await service.getShipmentRates(
        rateCarrierCode,
        fromPostalCode,
        toPostalCode,
        'US',
        { value: 2, units: 'ounces' },
        undefined,
        'package',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        'none',
        false
      )

      expect(Array.isArray(result)).toBe(true)
    })
  })

  // ── Customers, products, warehouses, stores, webhooks ──

  describe('read-only resources', () => {
    it('lists customers', async () => {
      const result = await service.listCustomers(undefined, undefined, undefined, undefined, 'Name', 'Ascending', 1, 5)

      expect(result).toHaveProperty('customers')
    })

    it('fetches a single customer', async () => {
      const { customerId } = testValues

      if (!customerId) {
        console.log('Skipping getCustomer: testValues.customerId not set')

        return
      }

      const result = await service.getCustomer(customerId)

      expect(result).toHaveProperty('customerId')
    })

    it('lists products', async () => {
      const result = await service.listProducts(undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, false, 'SKU', 'Ascending', 1, 5)

      expect(result).toHaveProperty('products')
    })

    it('fetches a single product', async () => {
      const { productId } = testValues

      if (!productId) {
        console.log('Skipping getProduct: testValues.productId not set')

        return
      }

      const result = await service.getProduct(productId)

      expect(result).toHaveProperty('productId')
    })

    it('lists warehouses and fetches the first one', async () => {
      const warehouses = await service.listWarehouses()

      expect(Array.isArray(warehouses)).toBe(true)

      if (!warehouses.length) {
        console.log('Skipping getWarehouse: no warehouses configured')

        return
      }

      const result = await service.getWarehouse(warehouses[0].warehouseId)

      expect(result).toHaveProperty('warehouseId')
    })

    it('lists stores and fetches the first one', async () => {
      const stores = await service.listStores(true)

      expect(Array.isArray(stores)).toBe(true)

      if (!stores.length) {
        console.log('Skipping getStore: no stores configured')

        return
      }

      const result = await service.getStore(stores[0].storeId)

      expect(result).toHaveProperty('storeId')
    })

    it('lists webhooks', async () => {
      const result = await service.listWebhooks()

      expect(result).toHaveProperty('webhooks')
    })
  })

  // ── Polling triggers ──

  describe('polling triggers', () => {
    it('seeds the order watermark without emitting events', async () => {
      const result = await service.onNewOrder({ triggerData: {}, state: {} })

      expect(result.events).toEqual([])
      expect(typeof result.state.since).toBe('string')
    })

    it('seeds the shipment watermark without emitting events', async () => {
      const result = await service.onNewShipment({ triggerData: {}, state: {} })

      expect(result.events).toEqual([])
      expect(typeof result.state.since).toBe('string')
    })

    it('dispatches polling events by name', async () => {
      const result = await service.handleTriggerPollingForEvent({ eventName: 'onNewOrder', triggerData: {}, state: {} })

      expect(result).toHaveProperty('state')
    })
  })

  // ── Write operations (opt-in) ──
  //
  // These create and then remove real records in the connected ShipStation
  // account, so they only run when the developer opts in explicitly.

  describe('order lifecycle', () => {
    it('creates and deletes a manual order when explicitly enabled', async () => {
      if (!testValues.runWrites) {
        console.log('Skipping order lifecycle: testValues.runWrites not set to true')

        return
      }

      const orderNumber = `FR-E2E-${ Date.now() }`

      const created = await service.createOrUpdateOrder(
        orderNumber,
        new Date().toISOString().replace(/\.\d{3}Z$/, ''),
        'awaiting_shipment',
        undefined,
        {
          name: 'FlowRunner E2E',
          street1: '1 Main St',
          city: 'Austin',
          state: 'TX',
          postalCode: '78701',
          country: 'US',
        }
      )

      expect(created).toHaveProperty('orderId')

      const fetched = await service.getOrder(created.orderId)

      expect(fetched.orderNumber).toBe(orderNumber)

      await expect(service.deleteOrder(created.orderId)).resolves.toBeDefined()
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('throws a descriptive error for a missing order', async () => {
      await expect(service.getOrder(1)).rejects.toThrow(/ShipStation API request failed/)
    })
  })
})
