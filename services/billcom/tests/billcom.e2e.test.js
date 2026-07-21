'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('BILL.com Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('billcom')
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

  // ── Vendors ──

  describe('createVendor + getVendor + updateVendor', () => {
    let vendorId

    it('creates a vendor', async () => {
      const response = await service.createVendor(`E2E Vendor ${ suffix }`, undefined, `vendor-${ suffix }@example.com`)

      expect(response).toHaveProperty('id')
      vendorId = response.id
    })

    it('retrieves the created vendor', async () => {
      const response = await service.getVendor(vendorId)

      expect(response).toHaveProperty('id', vendorId)
    })

    it('updates the vendor', async () => {
      const response = await service.updateVendor(vendorId, `E2E Vendor Updated ${ suffix }`)

      expect(response).toHaveProperty('id', vendorId)
    })
  })

  describe('listVendors', () => {
    it('returns vendors with expected shape', async () => {
      const response = await service.listVendors(5)

      expect(response).toHaveProperty('results')
      expect(Array.isArray(response.results)).toBe(true)
    })
  })

  describe('getVendorsDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getVendorsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Bills ──

  describe('createBill + getBill + updateBill', () => {
    // A bill needs an existing vendor. The developer can supply one via
    // testValues.vendorId; otherwise we create a throwaway vendor first.
    let vendorId
    let billId

    it('ensures a vendor exists', async () => {
      if (testValues.vendorId) {
        vendorId = testValues.vendorId
        return
      }

      const vendor = await service.createVendor(`E2E Bill Vendor ${ suffix }`)
      vendorId = vendor.id
      expect(vendorId).toBeDefined()
    })

    it('creates a bill', async () => {
      const response = await service.createBill(
        vendorId,
        `INV-${ suffix }`,
        '2026-01-15',
        '2026-02-15',
        [{ amount: 149, description: 'E2E line item' }]
      )

      expect(response).toHaveProperty('id')
      billId = response.id
    })

    it('retrieves the created bill', async () => {
      const response = await service.getBill(billId)

      expect(response).toHaveProperty('id', billId)
    })

    it('updates the bill', async () => {
      const response = await service.updateBill(billId, '2026-03-01')

      expect(response).toHaveProperty('id', billId)
    })
  })

  describe('listBills', () => {
    it('returns bills with expected shape', async () => {
      const response = await service.listBills(5)

      expect(response).toHaveProperty('results')
      expect(Array.isArray(response.results)).toBe(true)
    })
  })

  describe('getBillsDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getBillsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Customers ──

  describe('createCustomer + getCustomer + updateCustomer', () => {
    let customerId

    it('creates a customer', async () => {
      const response = await service.createCustomer(
        `E2E Customer ${ suffix }`,
        undefined,
        `customer-${ suffix }@example.com`
      )

      expect(response).toHaveProperty('id')
      customerId = response.id
    })

    it('retrieves the created customer', async () => {
      const response = await service.getCustomer(customerId)

      expect(response).toHaveProperty('id', customerId)
    })

    it('updates the customer', async () => {
      const response = await service.updateCustomer(customerId, `E2E Customer Updated ${ suffix }`)

      expect(response).toHaveProperty('id', customerId)
    })
  })

  describe('listCustomers', () => {
    it('returns customers with expected shape', async () => {
      const response = await service.listCustomers(5)

      expect(response).toHaveProperty('results')
      expect(Array.isArray(response.results)).toBe(true)
    })
  })

  describe('getCustomersDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getCustomersDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Invoices ──

  describe('createInvoice + getInvoice + updateInvoice', () => {
    // An invoice needs an existing customer. Supply one via testValues.customerId,
    // or a throwaway customer is created first.
    let customerId
    let invoiceId

    it('ensures a customer exists', async () => {
      if (testValues.customerId) {
        customerId = testValues.customerId
        return
      }

      const customer = await service.createCustomer(`E2E Invoice Customer ${ suffix }`)
      customerId = customer.id
      expect(customerId).toBeDefined()
    })

    it('creates an invoice', async () => {
      const response = await service.createInvoice(
        customerId,
        `INVC-${ suffix }`,
        '2026-01-15',
        '2026-02-15',
        [{ quantity: 2, description: 'E2E consulting', price: 149.99 }]
      )

      expect(response).toHaveProperty('id')
      invoiceId = response.id
    })

    it('retrieves the created invoice', async () => {
      const response = await service.getInvoice(invoiceId)

      expect(response).toHaveProperty('id', invoiceId)
    })

    it('updates the invoice', async () => {
      const response = await service.updateInvoice(invoiceId, '2026-03-01')

      expect(response).toHaveProperty('id', invoiceId)
    })
  })

  describe('listInvoices', () => {
    it('returns invoices with expected shape', async () => {
      const response = await service.listInvoices(5)

      expect(response).toHaveProperty('results')
      expect(Array.isArray(response.results)).toBe(true)
    })
  })

  describe('getInvoicesDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getInvoicesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Payments (read-only listings) ──

  describe('listBillPayments', () => {
    it('returns bill payments with expected shape', async () => {
      const response = await service.listBillPayments(5)

      expect(response).toHaveProperty('results')
      expect(Array.isArray(response.results)).toBe(true)
    })
  })

  describe('listReceivablePayments', () => {
    it('returns receivable payments with expected shape', async () => {
      const response = await service.listReceivablePayments(5)

      expect(response).toHaveProperty('results')
      expect(Array.isArray(response.results)).toBe(true)
    })
  })

  describe('getFundingAccountsDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getFundingAccountsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Money-moving actions (guarded) ──
  //
  // These actually record or disburse money, so they only run when the
  // developer explicitly supplies the required testValues. Never enable these
  // against a production BILL.com org.

  describe('createBillPayment', () => {
    const canRun = () => Boolean(testValues.paymentVendorId && testValues.paymentBillId)

    it('records a bill payment when a vendor + bill are configured', async () => {
      if (!canRun()) {
        console.log(
          'Skipping createBillPayment: set testValues.paymentVendorId and testValues.paymentBillId'
        )
        return
      }

      const response = await service.createBillPayment(
        testValues.paymentVendorId,
        [{ billId: testValues.paymentBillId, amount: 1 }]
      )

      expect(response).toHaveProperty('id')
    })
  })

  describe('payBill', () => {
    const canRun = () =>
      Boolean(testValues.paymentVendorId && testValues.paymentBillId && testValues.fundingAccountId)

    it('disburses a bill payment when vendor, bill and funding account are configured', async () => {
      if (!canRun()) {
        console.log(
          'Skipping payBill: set testValues.paymentVendorId, testValues.paymentBillId and testValues.fundingAccountId'
        )
        return
      }

      const response = await service.payBill(
        testValues.paymentVendorId,
        testValues.paymentBillId,
        1,
        testValues.fundingAccountId
      )

      expect(response).toHaveProperty('id')
    })
  })

  describe('chargeCustomer', () => {
    const canRun = () =>
      Boolean(testValues.chargeCustomerId && testValues.chargeBankAccountId && testValues.chargeInvoiceId)

    it('charges a customer when customer, bank account and invoice are configured', async () => {
      if (!canRun()) {
        console.log(
          'Skipping chargeCustomer: set testValues.chargeCustomerId, testValues.chargeBankAccountId and testValues.chargeInvoiceId'
        )
        return
      }

      const response = await service.chargeCustomer(
        testValues.chargeCustomerId,
        testValues.chargeBankAccountId,
        [{ invoiceId: testValues.chargeInvoiceId, amount: 1 }]
      )

      expect(response).toHaveProperty('id')
    })
  })

  describe('sendInvoice', () => {
    // Emails a real invoice to the customer, so it only runs with a supplied id.
    it('sends an invoice when testValues.sendInvoiceId is configured', async () => {
      if (!testValues.sendInvoiceId) {
        console.log('Skipping sendInvoice: set testValues.sendInvoiceId')
        return
      }

      const response = await service.sendInvoice(testValues.sendInvoiceId)

      expect(response).toHaveProperty('id')
    })
  })
})
