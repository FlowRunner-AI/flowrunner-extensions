'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Razorpay Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('razorpay')
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

  // ── Orders ──

  describe('orders lifecycle', () => {
    let orderId

    it('creates an order', async () => {
      const result = await service.createOrder(50000, 'INR', 'e2e_test_rcpt')

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('entity', 'order')
      expect(result).toHaveProperty('amount', 50000)
      expect(result).toHaveProperty('status', 'created')
      orderId = result.id
    })

    it('gets the created order', async () => {
      if (!orderId) {
        console.log('Skipping: orderId not available')
        return
      }

      const result = await service.getOrder(orderId)

      expect(result).toHaveProperty('id', orderId)
      expect(result).toHaveProperty('entity', 'order')
    })

    it('updates the order notes', async () => {
      if (!orderId) {
        console.log('Skipping: orderId not available')
        return
      }

      const result = await service.updateOrder(orderId, { e2e_test: 'true' })

      expect(result).toHaveProperty('id', orderId)
      expect(result.notes).toMatchObject({ e2e_test: 'true' })
    })

    it('lists order payments', async () => {
      if (!orderId) {
        console.log('Skipping: orderId not available')
        return
      }

      const result = await service.listOrderPayments(orderId)

      expect(result).toHaveProperty('entity', 'collection')
      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('listOrders', () => {
    it('returns a collection of orders', async () => {
      const result = await service.listOrders(undefined, undefined, 5)

      expect(result).toHaveProperty('entity', 'collection')
      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Payments ──

  describe('listPayments', () => {
    it('returns a collection of payments', async () => {
      const result = await service.listPayments(undefined, undefined, 5)

      expect(result).toHaveProperty('entity', 'collection')
      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getPayment', () => {
    it('gets a payment by ID', async () => {
      const { paymentId } = testValues

      if (!paymentId) {
        console.log('Skipping: testValues.paymentId not set')
        return
      }

      const result = await service.getPayment(paymentId)

      expect(result).toHaveProperty('id', paymentId)
      expect(result).toHaveProperty('entity', 'payment')
    })
  })

  describe('listDowntimes', () => {
    it('returns downtimes collection', async () => {
      const result = await service.listDowntimes()

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Refunds ──

  describe('listRefunds', () => {
    it('returns a collection of refunds', async () => {
      const result = await service.listRefunds(undefined, undefined, 5)

      expect(result).toHaveProperty('entity', 'collection')
      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Payment Links ──

  describe('payment links lifecycle', () => {
    let paymentLinkId

    it('creates a payment link', async () => {
      const result = await service.createPaymentLink(
        10000, 'INR', false, undefined,
        'E2E Test Payment Link'
      )

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('short_url')
      expect(result).toHaveProperty('status', 'created')
      paymentLinkId = result.id
    })

    it('gets the created payment link', async () => {
      if (!paymentLinkId) {
        console.log('Skipping: paymentLinkId not available')
        return
      }

      const result = await service.getPaymentLink(paymentLinkId)

      expect(result).toHaveProperty('id', paymentLinkId)
    })

    it('updates the payment link', async () => {
      if (!paymentLinkId) {
        console.log('Skipping: paymentLinkId not available')
        return
      }

      const result = await service.updatePaymentLink(paymentLinkId, undefined, undefined, { e2e: 'true' })

      expect(result).toHaveProperty('id', paymentLinkId)
    })

    it('cancels the payment link', async () => {
      if (!paymentLinkId) {
        console.log('Skipping: paymentLinkId not available')
        return
      }

      const result = await service.cancelPaymentLink(paymentLinkId)

      expect(result).toHaveProperty('status', 'cancelled')
    })
  })

  describe('listPaymentLinks', () => {
    it('returns payment links', async () => {
      const result = await service.listPaymentLinks()

      expect(result).toHaveProperty('payment_links')
      expect(Array.isArray(result.payment_links)).toBe(true)
    })
  })

  // ── Items ──

  describe('items lifecycle', () => {
    let itemId

    it('creates an item', async () => {
      const result = await service.createItem('E2E Test Item', 'Test description', 10000)

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('name', 'E2E Test Item')
      expect(result).toHaveProperty('amount', 10000)
      itemId = result.id
    })

    it('gets the created item', async () => {
      if (!itemId) {
        console.log('Skipping: itemId not available')
        return
      }

      const result = await service.getItem(itemId)

      expect(result).toHaveProperty('id', itemId)
      expect(result).toHaveProperty('name', 'E2E Test Item')
    })

    it('updates the item', async () => {
      if (!itemId) {
        console.log('Skipping: itemId not available')
        return
      }

      const result = await service.updateItem(itemId, 'E2E Test Item Updated', undefined, 20000)

      expect(result).toHaveProperty('id', itemId)
      expect(result).toHaveProperty('name', 'E2E Test Item Updated')
    })

    it('deletes the item', async () => {
      if (!itemId) {
        console.log('Skipping: itemId not available')
        return
      }

      const result = await service.deleteItem(itemId)

      expect(result).toBeDefined()
    })
  })

  describe('listItems', () => {
    it('returns a collection of items', async () => {
      const result = await service.listItems(undefined, undefined, 5)

      expect(result).toHaveProperty('entity', 'collection')
      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Customers ──

  describe('customers lifecycle', () => {
    let customerId

    it('creates a customer', async () => {
      const uniqueEmail = `e2e-test-${Date.now()}@example.com`
      const result = await service.createCustomer('E2E Test Customer', undefined, uniqueEmail, 'Fail With Error')

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('name', 'E2E Test Customer')
      customerId = result.id
    })

    it('gets the created customer', async () => {
      if (!customerId) {
        console.log('Skipping: customerId not available')
        return
      }

      const result = await service.getCustomer(customerId)

      expect(result).toHaveProperty('id', customerId)
      expect(result).toHaveProperty('entity', 'customer')
    })

    it('updates the customer', async () => {
      if (!customerId) {
        console.log('Skipping: customerId not available')
        return
      }

      const result = await service.updateCustomer(customerId, 'E2E Updated Customer')

      expect(result).toHaveProperty('id', customerId)
      expect(result).toHaveProperty('name', 'E2E Updated Customer')
    })
  })

  describe('listCustomers', () => {
    it('returns a collection of customers', async () => {
      const result = await service.listCustomers(5)

      expect(result).toHaveProperty('entity', 'collection')
      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Plans ──

  describe('plans lifecycle', () => {
    let planId

    it('creates a plan', async () => {
      const result = await service.createPlan('Monthly', 1, `E2E Plan ${Date.now()}`, 10000)

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('entity', 'plan')
      expect(result).toHaveProperty('period', 'monthly')
      planId = result.id
    })

    it('gets the created plan', async () => {
      if (!planId) {
        console.log('Skipping: planId not available')
        return
      }

      const result = await service.getPlan(planId)

      expect(result).toHaveProperty('id', planId)
      expect(result).toHaveProperty('entity', 'plan')
    })
  })

  describe('listPlans', () => {
    it('returns a collection of plans', async () => {
      const result = await service.listPlans(undefined, undefined, 5)

      expect(result).toHaveProperty('entity', 'collection')
      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Subscriptions ──

  describe('listSubscriptions', () => {
    it('returns a collection of subscriptions', async () => {
      const result = await service.listSubscriptions(undefined, 5)

      expect(result).toHaveProperty('entity', 'collection')
      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── QR Codes ──

  describe('listQrCodes', () => {
    it('returns a collection of QR codes', async () => {
      const result = await service.listQrCodes(undefined, undefined, 5)

      expect(result).toHaveProperty('entity', 'collection')
      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Settlements ──

  describe('listSettlements', () => {
    it('returns a collection of settlements', async () => {
      const result = await service.listSettlements(undefined, undefined, 5)

      expect(result).toHaveProperty('entity', 'collection')
      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getCombinedSettlementRecon', () => {
    it('returns settlement reconciliation report', async () => {
      const now = new Date()
      const result = await service.getCombinedSettlementRecon(now.getFullYear(), now.getMonth() + 1, undefined, 5)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('listOnDemandSettlements', () => {
    it('returns a collection of on-demand settlements', async () => {
      const result = await service.listOnDemandSettlements(undefined, undefined, 5)

      expect(result).toHaveProperty('entity', 'collection')
      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Virtual Accounts ──

  describe('listVirtualAccounts', () => {
    it('returns a collection of virtual accounts', async () => {
      const result = await service.listVirtualAccounts(undefined, undefined, 5)

      expect(result).toHaveProperty('entity', 'collection')
      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Dictionary Methods ──

  describe('getCustomersDictionary', () => {
    it('returns items with label and value', async () => {
      const result = await service.getCustomersDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
      }
    })
  })

  describe('getPlansDictionary', () => {
    it('returns items with label and value', async () => {
      const result = await service.getPlansDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
      }
    })
  })

  describe('getItemsDictionary', () => {
    it('returns items with label and value', async () => {
      const result = await service.getItemsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
      }
    })
  })
})
