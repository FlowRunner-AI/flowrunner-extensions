'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Invoice Ninja Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('invoice-ninja')
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

  // Shared ids created during the run and cleaned up at the end.
  const created = {
    clientId: undefined,
    productId: undefined,
    invoiceId: undefined,
    quoteId: undefined,
  }

  afterAll(async () => {
    // Best-effort cleanup, ignoring errors from resources already removed.
    const tryDelete = async (fn) => {
      try {
        await fn()
      } catch (e) {
        // ignore cleanup errors
      }
    }

    if (created.invoiceId) {
      await tryDelete(() => service.deleteInvoice(created.invoiceId))
    }
    if (created.clientId) {
      await tryDelete(() => service.deleteClient(created.clientId))
    }
  })

  // ── Clients ──

  describe('listClients', () => {
    it('returns clients with expected shape', async () => {
      const response = await service.listClients(undefined, undefined, 5, 1)

      expect(response).toHaveProperty('data')
      expect(Array.isArray(response.data)).toBe(true)
    })
  })

  describe('createClient + getClient + updateClient', () => {
    it('creates a client', async () => {
      const response = await service.createClient(
        `E2E Client ${ suffix }`,
        [{ first_name: 'E2E', last_name: 'Tester', email: `e2e-${ suffix }@example.com` }]
      )

      expect(response).toHaveProperty('data')
      expect(response.data).toHaveProperty('id')
      created.clientId = response.data.id
    })

    it('retrieves the created client', async () => {
      const response = await service.getClient(created.clientId, 'contacts')

      expect(response).toHaveProperty('data')
      expect(response.data).toHaveProperty('id', created.clientId)
    })

    it('updates the created client', async () => {
      const response = await service.updateClient(created.clientId, `E2E Client Updated ${ suffix }`)

      expect(response).toHaveProperty('data')
      expect(response.data).toHaveProperty('id', created.clientId)
    })
  })

  describe('getClientsDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getClientsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })

    it('supports a search term', async () => {
      const result = await service.getClientsDictionary({ search: 'E2E' })

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Products ──

  describe('listProducts', () => {
    it('returns products with expected shape', async () => {
      const response = await service.listProducts(undefined, 5, 1)

      expect(response).toHaveProperty('data')
      expect(Array.isArray(response.data)).toBe(true)
    })
  })

  describe('createProduct + getProduct + updateProduct', () => {
    it('creates a product', async () => {
      const response = await service.createProduct(`E2E-Product-${ suffix }`, 'E2E product', 150, 1)

      expect(response).toHaveProperty('data')
      expect(response.data).toHaveProperty('id')
      created.productId = response.data.id
    })

    it('retrieves the created product', async () => {
      const response = await service.getProduct(created.productId)

      expect(response).toHaveProperty('data')
      expect(response.data).toHaveProperty('id', created.productId)
    })

    it('updates the created product', async () => {
      const response = await service.updateProduct(created.productId, undefined, undefined, 175)

      expect(response).toHaveProperty('data')
      expect(response.data).toHaveProperty('id', created.productId)
    })
  })

  // ── Invoices ──

  describe('listInvoices', () => {
    it('returns invoices with expected shape', async () => {
      const response = await service.listInvoices(undefined, undefined, undefined, 5, 1)

      expect(response).toHaveProperty('data')
      expect(Array.isArray(response.data)).toBe(true)
    })
  })

  describe('createInvoice + getInvoice + updateInvoice + invoiceAction', () => {
    it('creates an invoice for the created client', async () => {
      const response = await service.createInvoice(created.clientId, [
        { product_key: `E2E-Product-${ suffix }`, notes: 'E2E line', cost: 150, quantity: 1 },
      ])

      expect(response).toHaveProperty('data')
      expect(response.data).toHaveProperty('id')
      created.invoiceId = response.data.id
    })

    it('retrieves the created invoice', async () => {
      const response = await service.getInvoice(created.invoiceId, 'client')

      expect(response).toHaveProperty('data')
      expect(response.data).toHaveProperty('id', created.invoiceId)
    })

    it('updates the created invoice', async () => {
      const response = await service.updateInvoice(created.invoiceId, undefined, undefined, undefined, 'PO-E2E')

      expect(response).toHaveProperty('data')
      expect(response.data).toHaveProperty('id', created.invoiceId)
    })

    it('marks the invoice as sent via a bulk action', async () => {
      const response = await service.invoiceAction(created.invoiceId, 'Mark Sent')

      expect(response).toHaveProperty('data')
      expect(Array.isArray(response.data)).toBe(true)
    })
  })

  // ── Payments ──

  describe('listPayments', () => {
    it('returns payments with expected shape', async () => {
      const response = await service.listPayments(undefined, undefined, 5, 1)

      expect(response).toHaveProperty('data')
      expect(Array.isArray(response.data)).toBe(true)
    })
  })

  describe('createPayment + getPayment', () => {
    let paymentId

    it('records a payment applied to the created invoice', async () => {
      // Requires a sent invoice with an outstanding balance (handled above).
      const response = await service.createPayment(
        created.clientId,
        150,
        [{ invoice_id: created.invoiceId, amount: 150 }],
        new Date().toISOString().slice(0, 10)
      )

      expect(response).toHaveProperty('data')
      expect(response.data).toHaveProperty('id')
      paymentId = response.data.id
    })

    it('retrieves the created payment', async () => {
      const response = await service.getPayment(paymentId, 'invoices')

      expect(response).toHaveProperty('data')
      expect(response.data).toHaveProperty('id', paymentId)
    })
  })

  // ── Quotes ──

  describe('listQuotes', () => {
    it('returns quotes with expected shape', async () => {
      const response = await service.listQuotes(undefined, undefined, 5, 1)

      expect(response).toHaveProperty('data')
      expect(Array.isArray(response.data)).toBe(true)
    })
  })

  describe('createQuote + approveQuote', () => {
    let quoteId

    it('creates a quote for the created client', async () => {
      const response = await service.createQuote(created.clientId, [
        { product_key: `E2E-Product-${ suffix }`, notes: 'E2E quote line', cost: 200, quantity: 1 },
      ])

      expect(response).toHaveProperty('data')
      expect(response.data).toHaveProperty('id')
      quoteId = response.data.id
    })

    it('approves the created quote', async () => {
      const response = await service.approveQuote(quoteId)

      expect(response).toHaveProperty('data')
      expect(Array.isArray(response.data)).toBe(true)
    })
  })

  // ── Recurring Invoices ──

  describe('listRecurringInvoices', () => {
    it('returns recurring invoices with expected shape', async () => {
      const response = await service.listRecurringInvoices(undefined, undefined, 5, 1)

      expect(response).toHaveProperty('data')
      expect(Array.isArray(response.data)).toBe(true)
    })
  })
})
