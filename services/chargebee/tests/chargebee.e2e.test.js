'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Chargebee Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('chargebee')
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

  // A unique-ish suffix so repeated e2e runs don't collide.
  const suffix = Date.now()

  // ── Customers (full CRUD lifecycle, self-contained) ──

  describe('createCustomer + getCustomer + updateCustomer + deleteCustomer', () => {
    let customerId

    it('creates a customer', async () => {
      const response = await service.createCustomer(
        'E2E',
        'Tester',
        `e2e-customer-${ suffix }@example.com`,
        'E2E Co',
        undefined,
        { line1: '1 Test St', city: 'Testville', country: 'US' }
      )

      expect(response).toHaveProperty('customer')
      expect(response.customer).toHaveProperty('id')
      customerId = response.customer.id
    })

    it('retrieves the created customer', async () => {
      const response = await service.getCustomer(customerId)

      expect(response).toHaveProperty('customer')
      expect(response.customer).toHaveProperty('id', customerId)
    })

    it('updates the customer', async () => {
      const response = await service.updateCustomer(customerId, 'E2E-Updated')

      expect(response).toHaveProperty('customer')
      expect(response.customer).toHaveProperty('first_name', 'E2E-Updated')
    })

    it('deletes the customer', async () => {
      const response = await service.deleteCustomer(customerId)

      expect(response).toHaveProperty('customer')
      expect(response.customer).toHaveProperty('deleted', true)
    })
  })

  describe('listCustomers', () => {
    it('returns a customer list with expected shape', async () => {
      const response = await service.listCustomers(undefined, 5)

      expect(response).toHaveProperty('list')
      expect(Array.isArray(response.list)).toBe(true)
    })
  })

  describe('getCustomersDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getCustomersDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Product Catalog (read-only) ──

  describe('listItems', () => {
    it('returns items with expected shape', async () => {
      const response = await service.listItems(undefined, 5)

      expect(response).toHaveProperty('list')
      expect(Array.isArray(response.list)).toBe(true)
    })
  })

  describe('getItem', () => {
    // Requires an existing item; supply testValues.itemId to exercise it.
    it('retrieves an item when itemId is configured', async () => {
      if (!testValues.itemId) {
        console.log('Skipping getItem: set testValues.itemId to a real Chargebee item ID')
        return
      }

      const response = await service.getItem(testValues.itemId)

      expect(response).toHaveProperty('item')
      expect(response.item).toHaveProperty('id', testValues.itemId)
    })
  })

  describe('listItemPrices', () => {
    it('returns item prices with expected shape', async () => {
      const response = await service.listItemPrices(undefined, undefined, 5)

      expect(response).toHaveProperty('list')
      expect(Array.isArray(response.list)).toBe(true)
    })
  })

  describe('getItemPrice', () => {
    // Requires an existing item price; supply testValues.itemPriceId.
    it('retrieves an item price when itemPriceId is configured', async () => {
      if (!testValues.itemPriceId) {
        console.log('Skipping getItemPrice: set testValues.itemPriceId to a real item price ID')
        return
      }

      const response = await service.getItemPrice(testValues.itemPriceId)

      expect(response).toHaveProperty('item_price')
      expect(response.item_price).toHaveProperty('id', testValues.itemPriceId)
    })
  })

  describe('getItemPricesDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getItemPricesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Subscriptions ──

  describe('listSubscriptions', () => {
    it('returns subscriptions with expected shape', async () => {
      const response = await service.listSubscriptions(undefined, undefined, 5)

      expect(response).toHaveProperty('list')
      expect(Array.isArray(response.list)).toBe(true)
    })
  })

  describe('createSubscription + getSubscription + cancelSubscription', () => {
    // Creating a subscription needs a real item price and a customer. This
    // block only runs when the developer supplies testValues.itemPriceId.
    let customerId
    let subscriptionId

    const canRun = () => Boolean(testValues.itemPriceId)

    it('creates a subscription for a fresh customer', async () => {
      if (!canRun()) {
        console.log('Skipping subscription lifecycle: set testValues.itemPriceId to a real item price ID')
        return
      }

      const customer = await service.createCustomer(
        'E2E-Sub',
        'Tester',
        `e2e-sub-${ suffix }@example.com`
      )
      customerId = customer.customer.id

      const response = await service.createSubscription(customerId, [
        { item_price_id: testValues.itemPriceId, quantity: 1 },
      ])

      expect(response).toHaveProperty('subscription')
      expect(response.subscription).toHaveProperty('id')
      subscriptionId = response.subscription.id
    })

    it('retrieves the created subscription', async () => {
      if (!canRun()) {
        return
      }

      const response = await service.getSubscription(subscriptionId)

      expect(response).toHaveProperty('subscription')
      expect(response.subscription).toHaveProperty('id', subscriptionId)
    })

    it('cancels the subscription', async () => {
      if (!canRun()) {
        return
      }

      const response = await service.cancelSubscription(subscriptionId)

      expect(response).toHaveProperty('subscription')
      expect(response.subscription).toHaveProperty('status', 'cancelled')
    })

    afterAll(async () => {
      // Best-effort cleanup: a cancelled subscription's customer can be deleted.
      if (customerId) {
        try {
          await service.deleteCustomer(customerId)
        } catch (e) {
          // ignore cleanup errors
        }
      }
    })
  })

  describe('getSubscription (configured)', () => {
    // Alternative single-shot check against an existing subscription.
    it('retrieves a subscription when subscriptionId is configured', async () => {
      if (!testValues.subscriptionId) {
        console.log('Skipping getSubscription: set testValues.subscriptionId to a real subscription ID')
        return
      }

      const response = await service.getSubscription(testValues.subscriptionId)

      expect(response).toHaveProperty('subscription')
      expect(response.subscription).toHaveProperty('id', testValues.subscriptionId)
    })
  })

  // ── Invoices ──

  describe('listInvoices', () => {
    it('returns invoices with expected shape', async () => {
      const response = await service.listInvoices(undefined, undefined, 5)

      expect(response).toHaveProperty('list')
      expect(Array.isArray(response.list)).toBe(true)
    })
  })

  describe('getInvoice + getInvoicePdf', () => {
    // Requires an existing invoice; supply testValues.invoiceId.
    const canRun = () => Boolean(testValues.invoiceId)

    it('retrieves an invoice when invoiceId is configured', async () => {
      if (!canRun()) {
        console.log('Skipping getInvoice: set testValues.invoiceId to a real invoice ID')
        return
      }

      const response = await service.getInvoice(testValues.invoiceId)

      expect(response).toHaveProperty('invoice')
      expect(response.invoice).toHaveProperty('id', String(testValues.invoiceId))
    })

    it('generates a PDF download URL when invoiceId is configured', async () => {
      if (!canRun()) {
        return
      }

      const response = await service.getInvoicePdf(testValues.invoiceId)

      expect(response).toHaveProperty('download')
      expect(response.download).toHaveProperty('download_url')
    })
  })

  // ── Payment Sources ──

  describe('listPaymentSources', () => {
    // Requires a customer ID; supply testValues.customerId (or reuse a listed one).
    it('returns payment sources when customerId is configured', async () => {
      if (!testValues.customerId) {
        console.log('Skipping listPaymentSources: set testValues.customerId to a real customer ID')
        return
      }

      const response = await service.listPaymentSources(testValues.customerId, 5)

      expect(response).toHaveProperty('list')
      expect(Array.isArray(response.list)).toBe(true)
    })
  })

  describe('getPaymentSource', () => {
    it('retrieves a payment source when paymentSourceId is configured', async () => {
      if (!testValues.paymentSourceId) {
        console.log('Skipping getPaymentSource: set testValues.paymentSourceId to a real payment source ID')
        return
      }

      const response = await service.getPaymentSource(testValues.paymentSourceId)

      expect(response).toHaveProperty('payment_source')
      expect(response.payment_source).toHaveProperty('id', testValues.paymentSourceId)
    })
  })

  // ── Credit Notes ──

  describe('listCreditNotes', () => {
    it('returns credit notes with expected shape', async () => {
      const response = await service.listCreditNotes(undefined, 5)

      expect(response).toHaveProperty('list')
      expect(Array.isArray(response.list)).toBe(true)
    })
  })

  describe('getCreditNote', () => {
    it('retrieves a credit note when creditNoteId is configured', async () => {
      if (!testValues.creditNoteId) {
        console.log('Skipping getCreditNote: set testValues.creditNoteId to a real credit note ID')
        return
      }

      const response = await service.getCreditNote(testValues.creditNoteId)

      expect(response).toHaveProperty('credit_note')
      expect(response.credit_note).toHaveProperty('id', testValues.creditNoteId)
    })
  })

  // ── Hosted Pages ──

  describe('createCheckout', () => {
    // Creating a checkout page needs a real item price.
    it('creates a hosted checkout page when itemPriceId is configured', async () => {
      if (!testValues.itemPriceId) {
        console.log('Skipping createCheckout: set testValues.itemPriceId to a real item price ID')
        return
      }

      const response = await service.createCheckout([
        { item_price_id: testValues.itemPriceId, quantity: 1 },
      ])

      expect(response).toHaveProperty('hosted_page')
      expect(response.hosted_page).toHaveProperty('url')
    })
  })
})
