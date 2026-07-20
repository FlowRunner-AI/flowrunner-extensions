'use strict'

const { createSandbox } = require('../../../service-sandbox')

const CONFIG = {
  devKey: 'test-dev-key',
  username: 'user@example.com',
  password: 'test-password',
  organizationId: 'org-123',
  environment: 'Production',
}

const BASE = 'https://gateway.prod.bill.com/connect/v3'
const WEBHOOK_BASE = 'https://gateway.prod.bill.com/connect-events'
const SESSION_ID = 'sess-abc-123'

describe('BILL.com Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox(CONFIG)
    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()
  })

  afterEach(() => {
    mock.reset()
    // Reset the cached session on the service so each test starts fresh and
    // re-triggers the login flow. sessionId is a public instance field.
    service.sessionId = null
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // Registers the login handler so #ensureSession succeeds. Returns nothing;
  // callers register the endpoint handler they actually want to test.
  function stubLogin(sessionId = SESSION_ID) {
    mock.onPost(`${ BASE }/login`).reply({ sessionId })
  }

  // ── Registration ──

  describe('service registration', () => {
    it('registers all five config items with the expected names and types', () => {
      const items = sandbox.getConfigItems()

      expect(items.map(i => i.name)).toEqual([
        'devKey',
        'username',
        'password',
        'organizationId',
        'environment',
      ])

      expect(items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'devKey', required: true, type: 'STRING', shared: false }),
          expect.objectContaining({ name: 'username', required: true, type: 'STRING', shared: false }),
          expect.objectContaining({ name: 'password', required: true, type: 'STRING', shared: false }),
          expect.objectContaining({ name: 'organizationId', required: true, type: 'STRING', shared: false }),
          expect.objectContaining({
            name: 'environment',
            required: true,
            type: 'CHOICE',
            defaultValue: 'Production',
            options: ['Production', 'Sandbox'],
            shared: false,
          }),
        ])
      )
    })

    it('resolves production base URLs by default', () => {
      expect(service.apiBaseUrl).toBe(BASE)
      expect(service.webhookBaseUrl).toBe(WEBHOOK_BASE)
    })
  })

  // ── Session / Authentication ──

  describe('session authentication', () => {
    it('logs in on the first request and threads sessionId + devKey into subsequent calls', async () => {
      stubLogin()
      mock.onGet(`${ BASE }/vendors/v1`).reply({ id: 'v1' })

      await service.getVendor('v1')

      // First call is the login, second is the actual request.
      expect(mock.history).toHaveLength(2)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/login`)
      expect(mock.history[0].body).toEqual({
        username: CONFIG.username,
        password: CONFIG.password,
        organizationId: CONFIG.organizationId,
        devKey: CONFIG.devKey,
      })

      expect(mock.history[1].headers).toMatchObject({
        sessionId: SESSION_ID,
        devKey: CONFIG.devKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      })
    })

    it('reuses the cached session for a second request (only one login)', async () => {
      stubLogin()
      mock.onGet(`${ BASE }/vendors/v1`).reply({ id: 'v1' })
      mock.onGet(`${ BASE }/vendors/v2`).reply({ id: 'v2' })

      await service.getVendor('v1')
      await service.getVendor('v2')

      const logins = mock.history.filter(h => h.url === `${ BASE }/login`)
      expect(logins).toHaveLength(1)
    })

    it('throws a friendly error when login returns no sessionId', async () => {
      mock.onPost(`${ BASE }/login`).reply({})

      await expect(service.getVendor('v1')).rejects.toThrow(
        'BILL.com authentication failed: Login failed: no sessionId returned in the response.'
      )
    })

    it('re-authenticates when a session-expired error code is returned', async () => {
      stubLogin()

      let attempt = 0
      mock.onGet(`${ BASE }/vendors/v1`).replyWith(() => {
        attempt += 1
        if (attempt === 1) {
          throw Object.assign(new Error('expired'), { body: [{ code: 'BDC_1109', message: 'Session expired' }] })
        }
        return { id: 'v1', recovered: true }
      })

      const result = await service.getVendor('v1')

      expect(result).toEqual({ id: 'v1', recovered: true })
      // Two logins: the initial one and the re-auth after the expired session.
      const logins = mock.history.filter(h => h.url === `${ BASE }/login`)
      expect(logins).toHaveLength(2)
    })

    it('re-authenticates on a raw 401 status', async () => {
      stubLogin()

      let attempt = 0
      mock.onGet(`${ BASE }/vendors/v1`).replyWith(() => {
        attempt += 1
        if (attempt === 1) {
          throw Object.assign(new Error('unauthorized'), { status: 401 })
        }
        return { id: 'v1' }
      })

      const result = await service.getVendor('v1')

      expect(result).toEqual({ id: 'v1' })
      expect(mock.history.filter(h => h.url === `${ BASE }/login`)).toHaveLength(2)
    })

    it('wraps non-session API errors from the v3 error array', async () => {
      stubLogin()
      mock.onGet(`${ BASE }/vendors/v1`).replyWithError({
        message: 'bad request',
        body: [{ code: 'BDC_1234', message: 'Vendor not found' }],
      })

      await expect(service.getVendor('v1')).rejects.toThrow('BILL.com API Error: Vendor not found')
    })

    it('routes Sandbox environment to staging base URLs', () => {
      // The service constructor derives base URLs purely from config.environment.
      // Reuse the already-required class (via the live instance's constructor)
      // rather than re-requiring the cached module or disturbing globals.
      const sbService = new service.constructor({ ...CONFIG, environment: 'Sandbox' })

      expect(sbService.apiBaseUrl).toBe('https://gateway.stage.bill.com/connect/v3')
      expect(sbService.webhookBaseUrl).toBe('https://gateway.stage.bill.com/connect-events')
    })
  })

  // ── Vendors ──

  describe('createVendor', () => {
    it('requires a name', async () => {
      await expect(service.createVendor()).rejects.toThrow('"Vendor Name" is required.')
      expect(mock.history).toHaveLength(0)
    })

    it('sends a POST with only the name when nothing else is provided', async () => {
      stubLogin()
      mock.onPost(`${ BASE }/vendors`).reply({ id: 'v1', name: 'Acme' })

      const result = await service.createVendor('Acme')

      expect(result).toEqual({ id: 'v1', name: 'Acme' })
      const call = mock.history[mock.history.length - 1]
      expect(call.method).toBe('post')
      expect(call.url).toBe(`${ BASE }/vendors`)
      expect(call.body).toEqual({ name: 'Acme' })
    })

    it('includes a cleaned-up address and all optional fields', async () => {
      stubLogin()
      mock.onPost(`${ BASE }/vendors`).reply({ id: 'v2' })

      await service.createVendor(
        'Acme',
        'Acme Inc',
        'a@x.com',
        '5551234',
        '1 Main St',
        'Denver',
        'CO',
        '80200',
        'US'
      )

      expect(mock.history[mock.history.length - 1].body).toEqual({
        name: 'Acme',
        companyName: 'Acme Inc',
        email: 'a@x.com',
        phone: '5551234',
        address: {
          line1: '1 Main St',
          city: 'Denver',
          stateOrProvince: 'CO',
          zipOrPostalCode: '80200',
          country: 'US',
        },
      })
    })
  })

  describe('getVendor', () => {
    it('requires a vendor id', async () => {
      await expect(service.getVendor()).rejects.toThrow('"Vendor" is required.')
    })

    it('GETs the vendor by id', async () => {
      stubLogin()
      mock.onGet(`${ BASE }/vendors/v1`).reply({ id: 'v1', name: 'Acme' })

      const result = await service.getVendor('v1')

      expect(result).toEqual({ id: 'v1', name: 'Acme' })
      expect(mock.history[mock.history.length - 1].method).toBe('get')
    })
  })

  describe('updateVendor', () => {
    it('requires a vendor id', async () => {
      await expect(service.updateVendor()).rejects.toThrow('"Vendor" is required.')
    })

    it('sends a PATCH with only the changed fields', async () => {
      stubLogin()
      mock.onPatch(`${ BASE }/vendors/v1`).reply({ id: 'v1' })

      await service.updateVendor('v1', 'New Name', undefined, 'new@x.com')

      const call = mock.history[mock.history.length - 1]
      expect(call.method).toBe('patch')
      expect(call.url).toBe(`${ BASE }/vendors/v1`)
      expect(call.body).toEqual({ name: 'New Name', email: 'new@x.com' })
    })
  })

  describe('listVendors', () => {
    it('uses the default page size and no filters', async () => {
      stubLogin()
      mock.onGet(`${ BASE }/vendors`).reply({ results: [], nextPage: null })

      await service.listVendors()

      const call = mock.history[mock.history.length - 1]
      expect(call.query).toEqual({ max: 50 })
    })

    it('applies the name prefix filter and custom page size', async () => {
      stubLogin()
      mock.onGet(`${ BASE }/vendors`).reply({ results: [] })

      await service.listVendors(10, 'Ac')

      expect(mock.history[mock.history.length - 1].query).toEqual({
        max: 10,
        filters: 'name:sw:Ac',
      })
    })
  })

  // ── Bills ──

  describe('createBill', () => {
    it('validates required vendor, invoice number and due date', async () => {
      await expect(service.createBill()).rejects.toThrow('"Vendor" is required.')
      await expect(service.createBill('v1')).rejects.toThrow('"Invoice Number" is required.')
      await expect(service.createBill('v1', 'INV-1', '2026-01-01')).rejects.toThrow('"Due Date" is required.')
    })

    it('sends a POST with the bill body including line items', async () => {
      stubLogin()
      mock.onPost(`${ BASE }/bills`).reply({ id: 'b1' })

      const lineItems = [{ amount: 149, description: 'Supplies' }]
      await service.createBill('v1', 'INV-1', '2026-01-15', '2026-02-15', lineItems)

      expect(mock.history[mock.history.length - 1].body).toEqual({
        vendorId: 'v1',
        invoiceNumber: 'INV-1',
        invoiceDate: '2026-01-15',
        dueDate: '2026-02-15',
        billLineItems: lineItems,
      })
    })
  })

  describe('getBill', () => {
    it('requires a bill id', async () => {
      await expect(service.getBill()).rejects.toThrow('"Bill" is required.')
    })

    it('GETs the bill by id', async () => {
      stubLogin()
      mock.onGet(`${ BASE }/bills/b1`).reply({ id: 'b1' })

      const result = await service.getBill('b1')

      expect(result).toEqual({ id: 'b1' })
    })
  })

  describe('updateBill', () => {
    it('requires a bill id', async () => {
      await expect(service.updateBill()).rejects.toThrow('"Bill" is required.')
    })

    it('PATCHes only the provided fields', async () => {
      stubLogin()
      mock.onPatch(`${ BASE }/bills/b1`).reply({ id: 'b1' })

      await service.updateBill('b1', '2026-03-01')

      const call = mock.history[mock.history.length - 1]
      expect(call.method).toBe('patch')
      expect(call.body).toEqual({ dueDate: '2026-03-01' })
    })
  })

  describe('listBills', () => {
    it('uses defaults with no filters', async () => {
      stubLogin()
      mock.onGet(`${ BASE }/bills`).reply({ results: [] })

      await service.listBills()

      expect(mock.history[mock.history.length - 1].query).toEqual({ max: 50 })
    })

    it('builds vendor, status and date filters', async () => {
      stubLogin()
      mock.onGet(`${ BASE }/bills`).reply({ results: [] })

      await service.listBills(25, 'v1', 'UNPAID', '2026-01-01', '2026-01-31')

      expect(mock.history[mock.history.length - 1].query).toEqual({
        max: 25,
        filters: 'vendorId:eq:v1,paymentStatus:eq:UNPAID,dueDate:gte:2026-01-01,dueDate:lte:2026-01-31',
      })
    })
  })

  // ── Customers ──

  describe('createCustomer', () => {
    it('requires a name', async () => {
      await expect(service.createCustomer()).rejects.toThrow('"Customer Name" is required.')
    })

    it('sends only the name when nothing else is provided', async () => {
      stubLogin()
      mock.onPost(`${ BASE }/customers`).reply({ id: 'c1' })

      await service.createCustomer('Acme Corp')

      expect(mock.history[mock.history.length - 1].body).toEqual({ name: 'Acme Corp' })
    })

    it('includes account type and address', async () => {
      stubLogin()
      mock.onPost(`${ BASE }/customers`).reply({ id: 'c2' })

      await service.createCustomer(
        'Acme Corp',
        'Acme Inc',
        'billing@acme.com',
        '5559876',
        'BUSINESS',
        '1 Main',
        'Denver',
        'CO',
        '80200',
        'US'
      )

      expect(mock.history[mock.history.length - 1].body).toEqual({
        name: 'Acme Corp',
        companyName: 'Acme Inc',
        email: 'billing@acme.com',
        phone: '5559876',
        accountType: 'BUSINESS',
        address: {
          line1: '1 Main',
          city: 'Denver',
          stateOrProvince: 'CO',
          zipOrPostalCode: '80200',
          country: 'US',
        },
      })
    })
  })

  describe('getCustomer', () => {
    it('requires a customer id', async () => {
      await expect(service.getCustomer()).rejects.toThrow('"Customer" is required.')
    })

    it('GETs the customer by id', async () => {
      stubLogin()
      mock.onGet(`${ BASE }/customers/c1`).reply({ id: 'c1' })

      const result = await service.getCustomer('c1')
      expect(result).toEqual({ id: 'c1' })
    })
  })

  describe('updateCustomer', () => {
    it('requires a customer id', async () => {
      await expect(service.updateCustomer()).rejects.toThrow('"Customer" is required.')
    })

    it('PATCHes only the changed fields', async () => {
      stubLogin()
      mock.onPatch(`${ BASE }/customers/c1`).reply({ id: 'c1' })

      await service.updateCustomer('c1', undefined, undefined, 'new@acme.com')

      expect(mock.history[mock.history.length - 1].body).toEqual({ email: 'new@acme.com' })
    })
  })

  describe('listCustomers', () => {
    it('uses defaults with no filters', async () => {
      stubLogin()
      mock.onGet(`${ BASE }/customers`).reply({ results: [] })

      await service.listCustomers()

      expect(mock.history[mock.history.length - 1].query).toEqual({ max: 50 })
    })

    it('builds name, account type and payment status filters', async () => {
      stubLogin()
      mock.onGet(`${ BASE }/customers`).reply({ results: [] })

      await service.listCustomers(5, 'Ac', 'BUSINESS', 'PAID')

      expect(mock.history[mock.history.length - 1].query).toEqual({
        max: 5,
        filters: 'name:sw:Ac,accountType:eq:BUSINESS,paymentStatus:eq:PAID',
      })
    })
  })

  // ── Invoices ──

  describe('createInvoice', () => {
    it('validates required customer, invoice number and due date', async () => {
      await expect(service.createInvoice()).rejects.toThrow('"Customer" is required.')
      await expect(service.createInvoice('c1')).rejects.toThrow('"Invoice Number" is required.')
      await expect(service.createInvoice('c1', 'INV-1', '2026-01-01')).rejects.toThrow('"Due Date" is required.')
    })

    it('sends a POST with invoice line items', async () => {
      stubLogin()
      mock.onPost(`${ BASE }/invoices`).reply({ id: 'i1' })

      const lineItems = [{ quantity: 2, description: 'Consulting', price: 149.99 }]
      await service.createInvoice('c1', 'INV-001', '2026-01-15', '2026-02-15', lineItems)

      expect(mock.history[mock.history.length - 1].body).toEqual({
        customerId: 'c1',
        invoiceNumber: 'INV-001',
        invoiceDate: '2026-01-15',
        dueDate: '2026-02-15',
        invoiceLineItems: lineItems,
      })
    })
  })

  describe('getInvoice', () => {
    it('requires an invoice id', async () => {
      await expect(service.getInvoice()).rejects.toThrow('"Invoice" is required.')
    })

    it('GETs the invoice by id', async () => {
      stubLogin()
      mock.onGet(`${ BASE }/invoices/i1`).reply({ id: 'i1' })

      expect(await service.getInvoice('i1')).toEqual({ id: 'i1' })
    })
  })

  describe('updateInvoice', () => {
    it('requires an invoice id', async () => {
      await expect(service.updateInvoice()).rejects.toThrow('"Invoice" is required.')
    })

    it('PATCHes only the changed fields', async () => {
      stubLogin()
      mock.onPatch(`${ BASE }/invoices/i1`).reply({ id: 'i1' })

      await service.updateInvoice('i1', '2026-03-01', 'INV-002')

      expect(mock.history[mock.history.length - 1].body).toEqual({
        dueDate: '2026-03-01',
        invoiceNumber: 'INV-002',
      })
    })
  })

  describe('listInvoices', () => {
    it('uses defaults with no filters', async () => {
      stubLogin()
      mock.onGet(`${ BASE }/invoices`).reply({ results: [] })

      await service.listInvoices()

      expect(mock.history[mock.history.length - 1].query).toEqual({ max: 50 })
    })

    it('builds customer, status and created-date filters', async () => {
      stubLogin()
      mock.onGet(`${ BASE }/invoices`).reply({ results: [] })

      await service.listInvoices(15, 'c1', 'OPEN', '2026-01-01', '2026-01-31')

      expect(mock.history[mock.history.length - 1].query).toEqual({
        max: 15,
        filters: 'customerId:eq:c1,status:eq:OPEN,createdTime:gte:2026-01-01,createdTime:lte:2026-01-31',
      })
    })
  })

  describe('sendInvoice', () => {
    it('requires an invoice id', async () => {
      await expect(service.sendInvoice()).rejects.toThrow('"Invoice" is required.')
    })

    it('POSTs to the invoice email endpoint', async () => {
      stubLogin()
      mock.onPost(`${ BASE }/invoices/i1/email`).reply({ id: 'i1', status: 'SENT' })

      const result = await service.sendInvoice('i1')

      expect(result).toEqual({ id: 'i1', status: 'SENT' })
      const call = mock.history[mock.history.length - 1]
      expect(call.method).toBe('post')
      expect(call.url).toBe(`${ BASE }/invoices/i1/email`)
      // No body is sent for this action.
      expect(call.body).toBeUndefined()
    })
  })

  // ── Bill Payments ──

  describe('createBillPayment', () => {
    it('requires a vendor', async () => {
      await expect(service.createBillPayment()).rejects.toThrow('"Vendor" is required.')
    })

    it('requires a non-empty payments array', async () => {
      await expect(service.createBillPayment('v1')).rejects.toThrow(
        '"Payments" is required and must contain at least one payment allocation.'
      )
      await expect(service.createBillPayment('v1', [])).rejects.toThrow(
        '"Payments" is required and must contain at least one payment allocation.'
      )
    })

    it('POSTs the payment allocations to record-payment', async () => {
      stubLogin()
      mock.onPost(`${ BASE }/bills/record-payment`).reply({ id: 'bp1' })

      const payments = [{ billId: 'b1', amount: 100 }]
      // toPrintCheck:false is a meaningful boolean and is preserved by cleanupObject.
      await service.createBillPayment('v1', payments, '2026-01-20', false)

      expect(mock.history[mock.history.length - 1].body).toEqual({
        vendorId: 'v1',
        payments,
        processDate: '2026-01-20',
        toPrintCheck: false,
      })
    })

    it('omits processDate/toPrintCheck when not provided', async () => {
      stubLogin()
      mock.onPost(`${ BASE }/bills/record-payment`).reply({ id: 'bp2' })

      await service.createBillPayment('v1', [{ billId: 'b1', amount: 50 }])

      expect(mock.history[mock.history.length - 1].body).toEqual({
        vendorId: 'v1',
        payments: [{ billId: 'b1', amount: 50 }],
      })
    })

    it('includes toPrintCheck when true', async () => {
      stubLogin()
      mock.onPost(`${ BASE }/bills/record-payment`).reply({ id: 'bp3' })

      await service.createBillPayment('v1', [{ billId: 'b1', amount: 50 }], undefined, true)

      expect(mock.history[mock.history.length - 1].body).toMatchObject({ toPrintCheck: true })
    })
  })

  describe('payBill', () => {
    it('validates all required fields', async () => {
      await expect(service.payBill()).rejects.toThrow('"Vendor" is required.')
      await expect(service.payBill('v1')).rejects.toThrow('"Bill" is required.')
      await expect(service.payBill('v1', 'b1')).rejects.toThrow('"Amount" is required.')
      await expect(service.payBill('v1', 'b1', 100)).rejects.toThrow('"Funding Account" is required.')
    })

    it('sends a POST with defaulted funding account type and processing options', async () => {
      stubLogin()
      mock.onPost(`${ BASE }/payments`).reply({ id: 'stp1' })

      await service.payBill('v1', 'b1', 228.99, 'bac1')

      expect(mock.history[mock.history.length - 1].body).toEqual({
        vendorId: 'v1',
        billId: 'b1',
        amount: 228.99,
        fundingAccount: { type: 'BANK_ACCOUNT', id: 'bac1' },
        processingOptions: {
          requestPayFaster: false,
          requestCheckDeliveryType: 'STANDARD',
        },
      })
    })

    it('honours all optional funding + processing params and formats the process date', async () => {
      stubLogin()
      mock.onPost(`${ BASE }/payments`).reply({ id: 'stp2' })

      await service.payBill(
        'v1',
        'b1',
        100,
        'card1',
        'CARD_ACCOUNT',
        '2026-12-31',
        'Invoice payment',
        true,
        'UPS_2DAY'
      )

      expect(mock.history[mock.history.length - 1].body).toEqual({
        vendorId: 'v1',
        billId: 'b1',
        amount: 100,
        description: 'Invoice payment',
        processDate: '2026-12-31',
        fundingAccount: { type: 'CARD_ACCOUNT', id: 'card1' },
        processingOptions: {
          requestPayFaster: true,
          requestCheckDeliveryType: 'UPS_2DAY',
        },
      })
    })

    it('accepts a zero amount', async () => {
      stubLogin()
      mock.onPost(`${ BASE }/payments`).reply({ id: 'stp3' })

      await service.payBill('v1', 'b1', 0, 'bac1')

      expect(mock.history[mock.history.length - 1].body).toMatchObject({ amount: 0 })
    })
  })

  describe('getBillPayment', () => {
    it('requires a payment id', async () => {
      await expect(service.getBillPayment()).rejects.toThrow('"Payment ID" is required.')
    })

    it('GETs the payment by id', async () => {
      stubLogin()
      mock.onGet(`${ BASE }/payments/bp1`).reply({ id: 'bp1' })

      expect(await service.getBillPayment('bp1')).toEqual({ id: 'bp1' })
    })
  })

  describe('listBillPayments', () => {
    it('uses defaults with no filters', async () => {
      stubLogin()
      mock.onGet(`${ BASE }/payments`).reply({ results: [] })

      await service.listBillPayments()

      expect(mock.history[mock.history.length - 1].query).toEqual({ max: 50 })
    })

    it('builds vendor, status and process-date filters', async () => {
      stubLogin()
      mock.onGet(`${ BASE }/payments`).reply({ results: [] })

      await service.listBillPayments(20, 'v1', 'SCHEDULED', '2026-01-01', '2026-01-31')

      expect(mock.history[mock.history.length - 1].query).toEqual({
        max: 20,
        filters: 'vendorId:eq:v1,status:eq:SCHEDULED,processDate:gte:2026-01-01,processDate:lte:2026-01-31',
      })
    })
  })

  // ── Receivable Payments ──

  describe('chargeCustomer', () => {
    it('validates customer, bank account and invoice payments', async () => {
      await expect(service.chargeCustomer()).rejects.toThrow('"Customer" is required.')
      await expect(service.chargeCustomer('c1')).rejects.toThrow('"Bank Account ID" is required.')
      await expect(service.chargeCustomer('c1', 'bank1')).rejects.toThrow(
        '"Invoice Payments" is required and must contain at least one payment allocation.'
      )
      await expect(service.chargeCustomer('c1', 'bank1', [])).rejects.toThrow(
        '"Invoice Payments" is required and must contain at least one payment allocation.'
      )
    })

    it('POSTs the invoice payment allocations', async () => {
      stubLogin()
      mock.onPost(`${ BASE }/receivable-payments`).reply({ id: 'rp1' })

      const invoicePayments = [{ invoiceId: 'i1', amount: 299.98 }]
      await service.chargeCustomer('c1', 'bank1', invoicePayments, 'Thanks')

      expect(mock.history[mock.history.length - 1].body).toEqual({
        customerId: 'c1',
        bankAccountId: 'bank1',
        invoicePayments,
        description: 'Thanks',
      })
    })

    it('omits the description when not provided', async () => {
      stubLogin()
      mock.onPost(`${ BASE }/receivable-payments`).reply({ id: 'rp2' })

      await service.chargeCustomer('c1', 'bank1', [{ invoiceId: 'i1', amount: 10 }])

      expect(mock.history[mock.history.length - 1].body).not.toHaveProperty('description')
    })
  })

  describe('getReceivablePayment', () => {
    it('requires a payment id', async () => {
      await expect(service.getReceivablePayment()).rejects.toThrow('"Payment ID" is required.')
    })

    it('GETs the receivable payment by id', async () => {
      stubLogin()
      mock.onGet(`${ BASE }/receivable-payments/rp1`).reply({ id: 'rp1' })

      expect(await service.getReceivablePayment('rp1')).toEqual({ id: 'rp1' })
    })
  })

  describe('listReceivablePayments', () => {
    it('uses defaults with no filters', async () => {
      stubLogin()
      mock.onGet(`${ BASE }/receivable-payments`).reply({ results: [] })

      await service.listReceivablePayments()

      expect(mock.history[mock.history.length - 1].query).toEqual({ max: 50 })
    })

    it('builds customer, status and payment-date filters', async () => {
      stubLogin()
      mock.onGet(`${ BASE }/receivable-payments`).reply({ results: [] })

      await service.listReceivablePayments(30, 'c1', 'PAID', '2026-01-01', '2026-01-31')

      expect(mock.history[mock.history.length - 1].query).toEqual({
        max: 30,
        filters: 'customerId:eq:c1,status:eq:PAID,paymentDate:gte:2026-01-01,paymentDate:lte:2026-01-31',
      })
    })
  })

  // ── Dictionary Methods ──

  describe('getVendorsDictionary', () => {
    it('maps vendors to dictionary items and forwards the pagination cursor', async () => {
      stubLogin()
      mock.onGet(`${ BASE }/vendors`).reply({
        results: [
          { id: 'v1', name: 'Acme', email: 'a@x.com' },
          { id: 'v2', name: 'Beta' },
        ],
        nextPage: 'page-2',
      })

      const result = await service.getVendorsDictionary({})

      expect(mock.history[mock.history.length - 1].query).toEqual({ max: 50 })
      expect(result).toEqual({
        cursor: 'page-2',
        items: [
          { label: 'Acme', value: 'v1', note: 'a@x.com' },
          { label: 'Beta', value: 'v2', note: 'ID: v2' },
        ],
      })
    })

    it('passes the cursor as the page query param', async () => {
      stubLogin()
      mock.onGet(`${ BASE }/vendors`).reply({ results: [] })

      await service.getVendorsDictionary({ cursor: 'page-2' })

      expect(mock.history[mock.history.length - 1].query).toEqual({ max: 50, page: 'page-2' })
    })

    it('filters vendors by search term', async () => {
      stubLogin()
      mock.onGet(`${ BASE }/vendors`).reply({
        results: [
          { id: 'v1', name: 'Acme' },
          { id: 'v2', name: 'Beta' },
        ],
      })

      const result = await service.getVendorsDictionary({ search: 'bet' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('v2')
      expect(result.cursor).toBeNull()
    })

    it('handles a null payload and missing results', async () => {
      stubLogin()
      mock.onGet(`${ BASE }/vendors`).reply({})

      const result = await service.getVendorsDictionary(null)

      expect(result).toEqual({ cursor: null, items: [] })
    })
  })

  describe('getCustomersDictionary', () => {
    it('maps customers to dictionary items', async () => {
      stubLogin()
      mock.onGet(`${ BASE }/customers`).reply({
        results: [{ id: 'c1', name: 'Acme Corp', email: 'billing@acme.com' }],
      })

      const result = await service.getCustomersDictionary({})

      expect(result.items).toEqual([
        { label: 'Acme Corp', value: 'c1', note: 'billing@acme.com' },
      ])
    })

    it('filters customers by search term', async () => {
      stubLogin()
      mock.onGet(`${ BASE }/customers`).reply({
        results: [
          { id: 'c1', name: 'Acme' },
          { id: 'c2', name: 'Zulu' },
        ],
      })

      const result = await service.getCustomersDictionary({ search: 'zul' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('c2')
    })
  })

  describe('getBillsDictionary', () => {
    it('maps bills to dictionary items with amount + status note', async () => {
      stubLogin()
      mock.onGet(`${ BASE }/bills`).reply({
        results: [
          { id: 'b1', invoiceNumber: 'INV-1', amount: 149, paymentStatus: 'UNPAID' },
          { id: 'b2', amount: 0 },
        ],
      })

      const result = await service.getBillsDictionary({})

      expect(result.items).toEqual([
        { label: 'Bill #INV-1', value: 'b1', note: '$149 - UNPAID' },
        { label: 'Bill b2', value: 'b2', note: '$0 - Unknown' },
      ])
    })

    it('filters bills by invoice number search', async () => {
      stubLogin()
      mock.onGet(`${ BASE }/bills`).reply({
        results: [
          { id: 'b1', invoiceNumber: 'INV-1', amount: 1 },
          { id: 'b2', invoiceNumber: 'ABC-2', amount: 2 },
        ],
      })

      const result = await service.getBillsDictionary({ search: 'abc' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('b2')
    })
  })

  describe('getInvoicesDictionary', () => {
    it('maps invoices to dictionary items with amount + status note', async () => {
      stubLogin()
      mock.onGet(`${ BASE }/invoices`).reply({
        results: [
          { id: 'i1', invoiceNumber: 'INV-001', totalAmount: 299.98, status: 'OPEN' },
          { id: 'i2', dueAmount: 50 },
        ],
      })

      const result = await service.getInvoicesDictionary({})

      expect(result.items).toEqual([
        { label: 'Invoice #INV-001', value: 'i1', note: '$299.98 - OPEN' },
        { label: 'Invoice i2', value: 'i2', note: '$50 - Unknown' },
      ])
    })

    it('filters invoices by invoice number search', async () => {
      stubLogin()
      mock.onGet(`${ BASE }/invoices`).reply({
        results: [
          { id: 'i1', invoiceNumber: 'INV-001' },
          { id: 'i2', invoiceNumber: 'OTH-002' },
        ],
      })

      const result = await service.getInvoicesDictionary({ search: 'oth' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('i2')
    })
  })

  describe('getFundingAccountsDictionary', () => {
    it('maps bank accounts to dictionary items and hits the banks endpoint', async () => {
      stubLogin()
      mock.onGet(`${ BASE }/funding-accounts/banks`).reply({
        results: [
          { id: 'bac1', bankName: 'Wells Fargo', accountNumber: '*2333', type: 'CHECKING', status: 'VERIFIED' },
          { id: 'bac2', nameOnAccount: 'Jane Doe' },
        ],
      })

      const result = await service.getFundingAccountsDictionary({})

      expect(mock.history[mock.history.length - 1].url).toBe(`${ BASE }/funding-accounts/banks`)
      expect(result.items).toEqual([
        { label: 'Wells Fargo *2333', value: 'bac1', note: 'CHECKING - VERIFIED' },
        { label: 'Jane Doe', value: 'bac2', note: 'ID: bac2' },
      ])
    })

    it('filters accounts by bank name, account holder or account number', async () => {
      stubLogin()
      mock.onGet(`${ BASE }/funding-accounts/banks`).reply({
        results: [
          { id: 'bac1', bankName: 'Wells Fargo', accountNumber: '2333' },
          { id: 'bac2', bankName: 'Chase', accountNumber: '9999' },
        ],
      })

      const byBank = await service.getFundingAccountsDictionary({ search: 'chase' })
      expect(byBank.items).toHaveLength(1)
      expect(byBank.items[0].value).toBe('bac2')
    })
  })

  // ── Trigger Events (event shaping + filtering) ──

  describe('onBillCreated', () => {
    it('shapes the event from the webhook body (SHAPE_EVENT)', async () => {
      const invocation = {
        body: {
          metadata: { eventType: 'bill.created' },
          bill: { id: 'b1', vendorId: 'v1', amount: 149 },
        },
      }

      const result = await service.onBillCreated('SHAPE_EVENT', invocation)

      expect(result).toEqual([
        {
          name: 'onBillCreated',
          data: { eventType: 'bill.created', id: 'b1', vendorId: 'v1', amount: 149 },
        },
      ])
    })

    it('returns all trigger ids (FILTER_TRIGGER)', async () => {
      const invocation = {
        triggers: [{ id: 't1' }, { id: 't2' }, { id: 't3' }],
      }

      const result = await service.onBillCreated('FILTER_TRIGGER', invocation)

      expect(result).toEqual({ ids: ['t1', 't2', 't3'] })
    })
  })

  describe('onBillUpdated', () => {
    it('shapes the event and filters trigger ids', async () => {
      const shaped = await service.onBillUpdated('SHAPE_EVENT', {
        body: { metadata: { eventType: 'bill.updated' }, bill: { id: 'b1' } },
      })
      expect(shaped[0]).toMatchObject({ name: 'onBillUpdated', data: { eventType: 'bill.updated', id: 'b1' } })

      const filtered = await service.onBillUpdated('FILTER_TRIGGER', { triggers: [{ id: 't1' }] })
      expect(filtered).toEqual({ ids: ['t1'] })
    })
  })

  describe('onInvoiceCreated', () => {
    it('shapes the event from the invoice payload', async () => {
      const shaped = await service.onInvoiceCreated('SHAPE_EVENT', {
        body: { metadata: { eventType: 'invoice.created' }, invoice: { id: 'i1', totalAmount: 299.98 } },
      })
      expect(shaped).toEqual([
        {
          name: 'onInvoiceCreated',
          data: { eventType: 'invoice.created', id: 'i1', totalAmount: 299.98 },
        },
      ])
    })

    it('returns trigger ids on filter', async () => {
      expect(await service.onInvoiceCreated('FILTER_TRIGGER', { triggers: [{ id: 'x' }] })).toEqual({ ids: ['x'] })
    })
  })

  describe('onInvoiceUpdated', () => {
    it('shapes the event from the invoice payload', async () => {
      const shaped = await service.onInvoiceUpdated('SHAPE_EVENT', {
        body: { metadata: { eventType: 'invoice.updated' }, invoice: { id: 'i1' } },
      })
      expect(shaped[0]).toMatchObject({ name: 'onInvoiceUpdated', data: { eventType: 'invoice.updated', id: 'i1' } })
    })

    it('returns trigger ids on filter', async () => {
      expect(await service.onInvoiceUpdated('FILTER_TRIGGER', { triggers: [{ id: 'y' }] })).toEqual({ ids: ['y'] })
    })
  })

  describe('onVendorCreated', () => {
    it('shapes the event from the vendor payload', async () => {
      const shaped = await service.onVendorCreated('SHAPE_EVENT', {
        body: { metadata: { eventType: 'vendor.created' }, vendor: { id: 'v1', name: 'Acme' } },
      })
      expect(shaped).toEqual([
        {
          name: 'onVendorCreated',
          data: { eventType: 'vendor.created', id: 'v1', name: 'Acme' },
        },
      ])
    })

    it('returns trigger ids on filter', async () => {
      expect(await service.onVendorCreated('FILTER_TRIGGER', { triggers: [{ id: 'z' }] })).toEqual({ ids: ['z'] })
    })
  })

  describe('onPaymentUpdated', () => {
    it('shapes the event from the payment payload', async () => {
      const shaped = await service.onPaymentUpdated('SHAPE_EVENT', {
        body: { metadata: { eventType: 'payment.updated' }, payment: { id: 'stp1', status: 'PAID' } },
      })
      expect(shaped[0]).toMatchObject({
        name: 'onPaymentUpdated',
        data: { eventType: 'payment.updated', id: 'stp1', status: 'PAID' },
      })
    })

    it('returns trigger ids on filter', async () => {
      expect(await service.onPaymentUpdated('FILTER_TRIGGER', { triggers: [{ id: 'p1' }] })).toEqual({ ids: ['p1'] })
    })
  })

  describe('onPaymentFailed', () => {
    it('shapes the event from the payment payload', async () => {
      const shaped = await service.onPaymentFailed('SHAPE_EVENT', {
        body: { metadata: { eventType: 'payment.failed' }, payment: { id: 'stp1', status: 'FAILED' } },
      })
      expect(shaped[0]).toMatchObject({
        name: 'onPaymentFailed',
        data: { eventType: 'payment.failed', id: 'stp1', status: 'FAILED' },
      })
    })

    it('returns trigger ids on filter', async () => {
      expect(await service.onPaymentFailed('FILTER_TRIGGER', { triggers: [{ id: 'p2' }] })).toEqual({ ids: ['p2'] })
    })
  })

  // ── Trigger System (webhook lifecycle) ──

  describe('handleTriggerUpsertWebhook', () => {
    it('creates a new subscription and returns its id + security key', async () => {
      stubLogin()
      mock.onPost(`${ WEBHOOK_BASE }/v3/subscriptions`).reply({ id: 'sub-1', securityKey: 'sk-1' })

      const result = await service.handleTriggerUpsertWebhook({
        callbackUrl: 'https://cb.example.com/hook',
        events: [{ name: 'onBillCreated' }, { name: 'onInvoiceCreated' }],
      })

      const call = mock.history[mock.history.length - 1]
      expect(call.method).toBe('post')
      expect(call.url).toBe(`${ WEBHOOK_BASE }/v3/subscriptions`)
      expect(call.headers).toHaveProperty('X-Idempotent-Key')
      expect(call.body).toEqual({
        name: 'FlowRunner BILL.com trigger',
        notificationUrl: 'https://cb.example.com/hook',
        status: { enabled: true },
        events: [
          { type: 'bill.created', version: '1' },
          { type: 'invoice.created', version: '1' },
        ],
      })
      expect(result).toEqual({ webhookData: { subscriptionId: 'sub-1', securityKey: 'sk-1' } })
    })

    it('falls back to subscriptionId when the create response has no id', async () => {
      stubLogin()
      mock.onPost(`${ WEBHOOK_BASE }/v3/subscriptions`).reply({ subscriptionId: 'sub-2', securityKey: 'sk-2' })

      const result = await service.handleTriggerUpsertWebhook({
        callbackUrl: 'https://cb.example.com/hook',
        events: [{ name: 'onVendorCreated' }],
      })

      expect(result.webhookData.subscriptionId).toBe('sub-2')
    })

    it('deduplicates event types across multiple trigger events', async () => {
      stubLogin()
      mock.onPost(`${ WEBHOOK_BASE }/v3/subscriptions`).reply({ id: 'sub-3' })

      await service.handleTriggerUpsertWebhook({
        callbackUrl: 'https://cb.example.com/hook',
        events: [{ name: 'onBillCreated' }, { name: 'onBillCreated' }],
      })

      expect(mock.history[mock.history.length - 1].body.events).toEqual([
        { type: 'bill.created', version: '1' },
      ])
    })

    it('updates an existing subscription with PUT and preserves the security key', async () => {
      stubLogin()
      mock.onPut(`${ WEBHOOK_BASE }/v3/subscriptions/sub-9`).reply({ id: 'sub-9' })

      const result = await service.handleTriggerUpsertWebhook({
        callbackUrl: 'https://cb.example.com/hook',
        events: [{ name: 'onPaymentUpdated' }],
        webhookData: { subscriptionId: 'sub-9', securityKey: 'existing-key' },
      })

      const call = mock.history[mock.history.length - 1]
      expect(call.method).toBe('put')
      expect(call.url).toBe(`${ WEBHOOK_BASE }/v3/subscriptions/sub-9`)
      expect(call.body).toMatchObject({
        notificationUrl: 'https://cb.example.com/hook',
        events: [{ type: 'payment.updated', version: '1' }],
      })
      expect(result).toEqual({
        webhookData: { subscriptionId: 'sub-9', securityKey: 'existing-key' },
      })
    })

    it('returns existing webhookData without a call when no valid event types are present', async () => {
      const result = await service.handleTriggerUpsertWebhook({
        callbackUrl: 'https://cb.example.com/hook',
        events: [{ name: 'onUnknownEvent' }],
        webhookData: { subscriptionId: 'sub-keep' },
      })

      expect(mock.history).toHaveLength(0)
      expect(result).toEqual({ webhookData: { subscriptionId: 'sub-keep' } })
    })
  })

  describe('handleTriggerResolveEvents', () => {
    it('maps a known event type to its trigger method and shapes the event', async () => {
      const invocation = {
        body: {
          metadata: { eventType: 'invoice.updated' },
          invoice: { id: 'i1', status: 'OPEN' },
        },
      }

      const result = await service.handleTriggerResolveEvents(invocation)

      expect(result.events).toEqual([
        {
          name: 'onInvoiceUpdated',
          data: { eventType: 'invoice.updated', id: 'i1', status: 'OPEN' },
        },
      ])
    })

    it('returns no events for an unknown event type', async () => {
      const result = await service.handleTriggerResolveEvents({
        body: { metadata: { eventType: 'something.weird' } },
      })

      expect(result).toEqual({ events: [] })
    })

    it('returns no events when the body has no metadata', async () => {
      const result = await service.handleTriggerResolveEvents({ body: {} })

      expect(result).toEqual({ events: [] })
    })
  })

  describe('handleTriggerSelectMatched', () => {
    it('delegates to the named event method in FILTER_TRIGGER mode', async () => {
      const result = await service.handleTriggerSelectMatched({
        eventName: 'onBillCreated',
        triggers: [{ id: 't1' }, { id: 't2' }],
      })

      expect(result).toEqual({ ids: ['t1', 't2'] })
    })
  })

  describe('handleTriggerDeleteWebhook', () => {
    it('DELETEs the subscription when one exists', async () => {
      stubLogin()
      mock.onDelete(`${ WEBHOOK_BASE }/v3/subscriptions/sub-1`).reply({})

      const result = await service.handleTriggerDeleteWebhook({
        webhookData: { subscriptionId: 'sub-1' },
      })

      const call = mock.history[mock.history.length - 1]
      expect(call.method).toBe('delete')
      expect(call.url).toBe(`${ WEBHOOK_BASE }/v3/subscriptions/sub-1`)
      expect(result).toEqual({ webhookData: {} })
    })

    it('is a no-op (no request) when there is no subscription id', async () => {
      const result = await service.handleTriggerDeleteWebhook({ webhookData: {} })

      expect(mock.history).toHaveLength(0)
      expect(result).toEqual({ webhookData: {} })
    })

    it('swallows delete errors and still returns empty webhookData', async () => {
      stubLogin()
      mock.onDelete(`${ WEBHOOK_BASE }/v3/subscriptions/sub-err`).replyWithError({
        message: 'Not found',
        body: [{ code: 'BDC_404', message: 'gone' }],
      })

      const result = await service.handleTriggerDeleteWebhook({
        webhookData: { subscriptionId: 'sub-err' },
      })

      expect(result).toEqual({ webhookData: {} })
    })
  })
})
