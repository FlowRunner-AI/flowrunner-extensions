'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Square Service (e2e)', () => {
  let sandbox
  let service
  let testValues
  let locationId

  beforeAll(async () => {
    sandbox = createE2ESandbox('square')
    require('../src/index.js')

    try {
      sandbox.validateConfigs()
    } catch (error) {
      console.log(error)
      process.exit(1)
    }

    service = sandbox.getService()
    testValues = sandbox.getTestValues()

    const locations = await service.listLocations()

    locationId = testValues.locationId || locations.locations?.[0]?.id
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Locations ──

  describe('locations', () => {
    it('lists locations', async () => {
      const result = await service.listLocations()

      expect(result).toHaveProperty('locations')
      expect(Array.isArray(result.locations)).toBe(true)
    })

    it('retrieves a single location', async () => {
      if (!locationId) {
        console.log('Skipping getLocation: no location is available')

        return
      }

      const result = await service.getLocation(locationId)

      expect(result).toHaveProperty('location')
      expect(result.location).toHaveProperty('id', locationId)
    })
  })

  // ── Payments & refunds ──

  describe('payments and refunds', () => {
    it('lists payments', async () => {
      const result = await service.listPayments(undefined, undefined, 'Descending', undefined, 5)

      expect(result).toBeDefined()
      expect(Array.isArray(result.payments || [])).toBe(true)
    })

    it('lists refunds', async () => {
      const result = await service.listRefunds(undefined, undefined, 'Descending', undefined, 5)

      expect(result).toBeDefined()
      expect(Array.isArray(result.refunds || [])).toBe(true)
    })

    it('retrieves a single payment', async () => {
      const list = await service.listPayments(undefined, undefined, 'Descending', undefined, 1)
      const first = list.payments?.[0]

      if (!first) {
        console.log('Skipping getPayment: the account has no payments')

        return
      }

      const result = await service.getPayment(first.id)

      expect(result.payment).toHaveProperty('id', first.id)
    })

    it('creates a sandbox card payment when explicitly enabled', async () => {
      const { createPaymentSourceId } = testValues

      if (!createPaymentSourceId || !locationId) {
        console.log('Skipping createPayment: testValues.createPaymentSourceId not set')

        return
      }

      const result = await service.createPayment(
        createPaymentSourceId, 100, 'USD', undefined, locationId
      )

      expect(result.payment).toHaveProperty('id')
    })
  })

  // ── Catalog ──

  describe('catalog', () => {
    let createdObjectId

    it('returns the catalog limits', async () => {
      const result = await service.getCatalogInfo()

      expect(result).toHaveProperty('limits')
    })

    it('lists catalog items', async () => {
      const result = await service.listCatalog(['Item'])

      expect(result).toBeDefined()
      expect(Array.isArray(result.objects || [])).toBe(true)
    })

    it('creates a catalog item', async () => {
      const result = await service.upsertCatalogItem(
        `FlowRunner E2E ${ Date.now() }`, 'Created by the FlowRunner e2e suite', 250, 'USD', 'Regular'
      )

      expect(result).toHaveProperty('catalog_object')
      createdObjectId = result.catalog_object.id
    })

    it('retrieves the created catalog object', async () => {
      if (!createdObjectId) {
        console.log('Skipping getCatalogObject: no catalog object was created')

        return
      }

      const result = await service.getCatalogObject(createdObjectId, true)

      expect(result.object).toHaveProperty('id', createdObjectId)
    })

    it('searches the catalog', async () => {
      const result = await service.searchCatalog('FlowRunner', ['Item'], 5)

      expect(result).toBeDefined()
    })

    it('deletes the created catalog object', async () => {
      if (!createdObjectId) {
        console.log('Skipping deleteCatalogObject: no catalog object was created')

        return
      }

      const result = await service.deleteCatalogObject(createdObjectId)

      expect(result).toHaveProperty('deleted_object_ids')
    })
  })

  // ── Customers & cards ──

  describe('customers', () => {
    let createdCustomerId
    let customerVersion

    it('lists customers', async () => {
      const result = await service.listCustomers(undefined, undefined, 5)

      expect(result).toBeDefined()
      expect(Array.isArray(result.customers || [])).toBe(true)
    })

    it('creates a customer', async () => {
      const result = await service.createCustomer(
        'FlowRunner', `E2E ${ Date.now() }`, 'FlowRunner QA',
        `flowrunner.e2e.${ Date.now() }@example.com`, undefined,
        { addressLine1: '1 Main St', locality: 'Springfield', country: 'US' },
        `e2e-${ Date.now() }`, 'Created by the FlowRunner e2e suite'
      )

      expect(result.customer).toHaveProperty('id')
      createdCustomerId = result.customer.id
      customerVersion = result.customer.version
    })

    it('retrieves the created customer', async () => {
      if (!createdCustomerId) {
        console.log('Skipping getCustomer: no customer was created')

        return
      }

      const result = await service.getCustomer(createdCustomerId)

      expect(result.customer).toHaveProperty('id', createdCustomerId)
    })

    it('updates the created customer', async () => {
      if (!createdCustomerId) {
        console.log('Skipping updateCustomer: no customer was created')

        return
      }

      const result = await service.updateCustomer(
        createdCustomerId, 'FlowRunner Updated', undefined, undefined, undefined,
        undefined, undefined, undefined, 'Updated by the e2e suite', customerVersion
      )

      expect(result.customer).toHaveProperty('id', createdCustomerId)
      customerVersion = result.customer.version
    })

    it('searches customers by email', async () => {
      const result = await service.searchCustomers('example.com', undefined, undefined, 'Fuzzy', 'Descending', 5)

      expect(result).toBeDefined()
    })

    it('lists the cards of the created customer', async () => {
      if (!createdCustomerId) {
        console.log('Skipping listCards: no customer was created')

        return
      }

      const result = await service.listCards(createdCustomerId, true)

      expect(result).toBeDefined()
    })

    it('deletes the created customer', async () => {
      if (!createdCustomerId) {
        console.log('Skipping deleteCustomer: no customer was created')

        return
      }

      const result = await service.deleteCustomer(createdCustomerId, customerVersion)

      expect(result).toBeDefined()
    })
  })

  // ── Orders ──

  describe('orders', () => {
    let createdOrderId
    let orderVersion

    it('creates an order with an ad-hoc line item', async () => {
      if (!locationId) {
        console.log('Skipping createOrder: no location is available')

        return
      }

      const result = await service.createOrder(
        locationId,
        [{ name: 'FlowRunner E2E item', basePrice: 500, quantity: 2, currency: 'USD' }],
        undefined,
        `e2e-${ Date.now() }`,
        [{ name: 'Test Tax', percentage: 5 }],
        [{ name: 'Test Discount', amount: 100, currency: 'USD' }]
      )

      expect(result.order).toHaveProperty('id')
      createdOrderId = result.order.id
      orderVersion = result.order.version
    })

    it('retrieves the created order', async () => {
      if (!createdOrderId) {
        console.log('Skipping getOrder: no order was created')

        return
      }

      const result = await service.getOrder(createdOrderId)

      expect(result.order).toHaveProperty('id', createdOrderId)
    })

    it('updates the created order reference id', async () => {
      if (!createdOrderId) {
        console.log('Skipping updateOrder: no order was created')

        return
      }

      const result = await service.updateOrder(
        createdOrderId, orderVersion, { reference_id: `e2e-updated-${ Date.now() }` }
      )

      expect(result.order).toHaveProperty('id', createdOrderId)
    })

    it('calculates an order without persisting it', async () => {
      if (!locationId) {
        console.log('Skipping calculateOrder: no location is available')

        return
      }

      const result = await service.calculateOrder({
        location_id: locationId,
        line_items: [{
          quantity: '1',
          name: 'Calculated item',
          base_price_money: { amount: 1000, currency: 'USD' },
        }],
      })

      expect(result.order).toHaveProperty('total_money')
    })

    it('searches orders by location and state', async () => {
      if (!locationId) {
        console.log('Skipping searchOrders: no location is available')

        return
      }

      const result = await service.searchOrders([locationId], ['Open'], undefined, undefined, undefined, undefined, 5)

      expect(result).toBeDefined()
    })
  })

  // ── Invoices ──

  describe('invoices', () => {
    it('lists invoices', async () => {
      if (!locationId) {
        console.log('Skipping listInvoices: no location is available')

        return
      }

      const result = await service.listInvoices(locationId, 5)

      expect(result).toBeDefined()
      expect(Array.isArray(result.invoices || [])).toBe(true)
    })

    it('searches invoices', async () => {
      if (!locationId) {
        console.log('Skipping searchInvoices: no location is available')

        return
      }

      const result = await service.searchInvoices([locationId], undefined, 'Descending', 5)

      expect(result).toBeDefined()
    })
  })

  // ── Inventory ──

  describe('inventory', () => {
    it('batch-retrieves inventory counts', async () => {
      const result = await service.batchRetrieveInventoryCounts(undefined, locationId ? [locationId] : undefined)

      expect(result).toBeDefined()
    })

    it('retrieves the inventory count of a catalog variation', async () => {
      const { inventoryCatalogObjectId } = testValues

      if (!inventoryCatalogObjectId) {
        console.log('Skipping getInventoryCount: testValues.inventoryCatalogObjectId not set')

        return
      }

      const result = await service.getInventoryCount(inventoryCatalogObjectId)

      expect(result).toBeDefined()
    })

    it('records a physical count when explicitly enabled', async () => {
      const { inventoryCatalogObjectId } = testValues

      if (!inventoryCatalogObjectId || !locationId) {
        console.log('Skipping recordPhysicalCount: testValues.inventoryCatalogObjectId not set')

        return
      }

      const result = await service.recordPhysicalCount(inventoryCatalogObjectId, locationId, 10, 'In Stock')

      expect(result).toBeDefined()
    })
  })

  // ── Subscriptions ──

  describe('subscriptions', () => {
    it('searches subscriptions', async () => {
      const result = await service.searchSubscriptions(undefined, locationId ? [locationId] : undefined, 5)

      expect(result).toBeDefined()
    })
  })

  // ── Payouts ──

  describe('payouts', () => {
    it('lists payouts', async () => {
      const result = await service.listPayouts(locationId, undefined, undefined, undefined, 'Descending', 5)

      expect(result).toBeDefined()
      expect(Array.isArray(result.payouts || [])).toBe(true)
    })

    it('retrieves a payout and its entries', async () => {
      const list = await service.listPayouts(locationId, undefined, undefined, undefined, 'Descending', 1)
      const first = list.payouts?.[0]

      if (!first) {
        console.log('Skipping getPayout: the account has no payouts')

        return
      }

      const payout = await service.getPayout(first.id)

      expect(payout.payout).toHaveProperty('id', first.id)

      const entries = await service.listPayoutEntries(first.id, 'Descending', 5)

      expect(entries).toBeDefined()
    })
  })

  // ── Team ──

  describe('team', () => {
    it('searches team members', async () => {
      const result = await service.searchTeamMembers(
        locationId ? [locationId] : undefined, 'Active', 5
      )

      expect(result).toBeDefined()
    })

    it('retrieves a team member', async () => {
      const list = await service.searchTeamMembers(undefined, 'Active', 1)
      const first = list.team_members?.[0]

      if (!first) {
        console.log('Skipping getTeamMember: the account has no active team members')

        return
      }

      const result = await service.getTeamMember(first.id)

      expect(result.team_member).toHaveProperty('id', first.id)
    })
  })

  // ── Dictionaries ──

  describe('dictionaries', () => {
    it('lists locations', async () => {
      const result = await service.getLocationsDictionary({})

      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor', null)
    })

    it('filters locations by search', async () => {
      const result = await service.getLocationsDictionary({ search: 'zzz-no-such-location' })

      expect(result.items).toEqual([])
    })

    it('lists customers', async () => {
      const result = await service.getCustomersDictionary({})

      expect(Array.isArray(result.items)).toBe(true)
    })

    it('searches customers by email', async () => {
      const result = await service.getCustomersDictionary({ search: 'example.com' })

      expect(Array.isArray(result.items)).toBe(true)
    })

    it('lists catalog items', async () => {
      const result = await service.getCatalogItemsDictionary({})

      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Errors ──

  describe('error handling', () => {
    it('throws a descriptive error for an unknown location', async () => {
      await expect(service.getLocation('NOT_A_REAL_LOCATION')).rejects.toThrow(/Square API error/)
    })

    it('throws a descriptive error for an unknown payment', async () => {
      await expect(service.getPayment('NOT_A_REAL_PAYMENT')).rejects.toThrow(/Square API error/)
    })
  })
})
