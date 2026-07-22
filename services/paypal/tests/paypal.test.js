'use strict'

const { createSandbox } = require('../../../service-sandbox')

const CLIENT_ID = 'test-client-id'
const CLIENT_SECRET = 'test-client-secret'

const SANDBOX_BASE = 'https://api-m.sandbox.paypal.com'
const LIVE_BASE = 'https://api-m.paypal.com'

const TOKEN_URL = `${ SANDBOX_BASE }/v1/oauth2/token`
const ACCESS_TOKEN = 'A21AA-test-access-token'
const BASIC_AUTH = Buffer.from(`${ CLIENT_ID }:${ CLIENT_SECRET }`).toString('base64')

/**
 * Builds a brand new sandbox + service instance (module registry reset so the entry
 * file registers the service again). Needed for tests around token acquisition and
 * environment selection, which depend on constructor / per-instance token cache state.
 */
function createFreshService(config) {
  const freshSandbox = createSandbox(config)

  jest.resetModules()
  require('../src/index.js')

  return {
    sandbox: freshSandbox,
    service: freshSandbox.getService(),
    mock: freshSandbox.getRequestMock(),
  }
}

describe('PayPal Service', () => {
  let sandbox
  let service
  let mock
  let runtime

  const lastCall = () => mock.history[mock.history.length - 1]

  beforeAll(async () => {
    sandbox = createSandbox({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, environment: 'Sandbox' })
    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()
    runtime = global.Flowrunner

    // Warm the access-token cache once so per-test histories contain only API calls.
    mock.onPost(TOKEN_URL).reply({ access_token: ACCESS_TOKEN, expires_in: 32400 })
    mock.onAny().reply({})
    await service.getOrder('warm-up')
    mock.reset()
  })

  afterEach(() => {
    mock.reset()
    // Tests that build a fresh instance swap the global runtime; restore the main one.
    global.Flowrunner = runtime
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Registration & auth ──

  describe('service registration', () => {
    it('registers the required config items', () => {
      const configItems = sandbox.getConfigItems()

      expect(configItems.map(item => item.name)).toEqual(['clientId', 'clientSecret', 'environment'])

      expect(configItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'clientId', required: true, shared: false, type: 'STRING' }),
          expect.objectContaining({ name: 'clientSecret', required: true, shared: false, type: 'STRING' }),
          expect.objectContaining({
            name: 'environment',
            required: true,
            shared: false,
            type: 'CHOICE',
            options: ['Sandbox', 'Live'],
            defaultValue: 'Sandbox',
          }),
        ])
      )
    })

    it('defaults to the sandbox base url', () => {
      expect(service.baseUrl).toBe(SANDBOX_BASE)
    })

    it('uses the live base url when the environment is Live', async () => {
      const live = createFreshService({
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
        environment: 'Live',
      })

      expect(live.service.baseUrl).toBe(LIVE_BASE)

      live.mock.onPost(`${ LIVE_BASE }/v1/oauth2/token`).reply({ access_token: ACCESS_TOKEN })
      live.mock.onGet(`${ LIVE_BASE }/v2/checkout/orders/ORDER-1`).reply({ id: 'ORDER-1' })

      await live.service.getOrder('ORDER-1')

      expect(live.mock.history[1].url).toBe(`${ LIVE_BASE }/v2/checkout/orders/ORDER-1`)
    })
  })

  describe('access token handling', () => {
    it('requests a client_credentials token with basic auth and reuses it', async () => {
      const fresh = createFreshService({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET })

      fresh.mock.onPost(TOKEN_URL).reply({ access_token: ACCESS_TOKEN, expires_in: 32400 })
      fresh.mock.onGet(`${ SANDBOX_BASE }/v2/checkout/orders/ORDER-1`).reply({ id: 'ORDER-1' })

      await fresh.service.getOrder('ORDER-1')
      await fresh.service.getOrder('ORDER-1')

      const tokenCalls = fresh.mock.history.filter(call => call.url === TOKEN_URL)

      expect(tokenCalls).toHaveLength(1)
      expect(tokenCalls[0].method).toBe('post')

      expect(tokenCalls[0].headers).toEqual({
        'Authorization': `Basic ${ BASIC_AUTH }`,
        'Content-Type': 'application/x-www-form-urlencoded',
      })

      expect(tokenCalls[0].body).toBe('grant_type=client_credentials')

      const apiCall = fresh.mock.history[fresh.mock.history.length - 1]

      expect(apiCall.headers).toMatchObject({
        'Authorization': `Bearer ${ ACCESS_TOKEN }`,
        'Content-Type': 'application/json',
      })
    })

    it('throws a descriptive error when the token request fails', async () => {
      const fresh = createFreshService({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET })

      fresh.mock.onPost(TOKEN_URL).replyWithError({
        message: 'Unauthorized',
        status: 401,
        body: { error_description: 'Client Authentication failed' },
      })

      await expect(fresh.service.getOrder('ORDER-1')).rejects.toThrow(
        /Failed to obtain a PayPal access token: Client Authentication failed/
      )
    })

    it('throws when the token endpoint returns no access token', async () => {
      const fresh = createFreshService({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET })

      fresh.mock.onPost(TOKEN_URL).reply({ scope: 'openid' })

      await expect(fresh.service.getOrder('ORDER-1')).rejects.toThrow(
        'PayPal token endpoint did not return an access token'
      )
    })
  })

  // ── Orders ──

  describe('createOrder', () => {
    const url = `${ SANDBOX_BASE }/v2/checkout/orders`

    it('builds a simple single purchase unit and resolves the intent', async () => {
      mock.onPost(url).reply({ id: 'ORDER-1', status: 'CREATED' })

      const result = await service.createOrder('Capture', '99.99', 'USD', 'Test order')

      expect(result).toEqual({ id: 'ORDER-1', status: 'CREATED' })
      expect(lastCall().method).toBe('post')
      expect(lastCall().url).toBe(url)

      expect(lastCall().body).toEqual({
        intent: 'CAPTURE',
        purchase_units: [{ amount: { currency_code: 'USD', value: '99.99' }, description: 'Test order' }],
      })
    })

    it('resolves the Authorize intent and defaults the currency to USD', async () => {
      mock.onPost(url).reply({ id: 'ORDER-2' })

      await service.createOrder('Authorize', '10')

      expect(lastCall().body).toEqual({
        intent: 'AUTHORIZE',
        purchase_units: [{ amount: { currency_code: 'USD', value: '10' } }],
      })
    })

    it('defaults the intent to CAPTURE when omitted', async () => {
      mock.onPost(url).reply({ id: 'ORDER-3' })

      await service.createOrder(undefined, '5', 'EUR')

      expect(lastCall().body.intent).toBe('CAPTURE')
    })

    it('passes an unmapped intent value through verbatim', async () => {
      mock.onPost(url).reply({ id: 'ORDER-4' })

      await service.createOrder('AUTHORIZE', '5')

      expect(lastCall().body.intent).toBe('AUTHORIZE')
    })

    it('prefers a raw purchase units array over the simple form', async () => {
      mock.onPost(url).reply({ id: 'ORDER-5' })

      const units = [{ amount: { currency_code: 'GBP', value: '1.00' }, items: [] }]

      await service.createOrder('Capture', '99.99', 'USD', 'ignored', units)

      expect(lastCall().body.purchase_units).toEqual(units)
    })

    it('generates an idempotency header when none is supplied', async () => {
      mock.onPost(url).reply({ id: 'ORDER-6' })

      await service.createOrder('Capture', '1')

      expect(lastCall().headers['PayPal-Request-Id']).toMatch(/^fr-\d+-\d+$/)
    })

    it('uses and trims the supplied idempotency key', async () => {
      mock.onPost(url).reply({ id: 'ORDER-7' })

      await service.createOrder('Capture', '1', 'USD', undefined, undefined, '  my-key  ')

      expect(lastCall().headers['PayPal-Request-Id']).toBe('my-key')
    })

    it('surfaces PayPal error details and the debug id', async () => {
      mock.onPost(url).replyWithError({
        message: 'Bad Request',
        status: 400,
        body: {
          message: 'Request is not well-formed.',
          debug_id: 'abc123',
          details: [{ description: 'The value of a field is invalid.' }, { issue: 'MISSING_REQUIRED_PARAMETER' }],
        },
      })

      await expect(service.createOrder('Capture', '1')).rejects.toThrow(
        'PayPal API error: Request is not well-formed. - The value of a field is invalid.; MISSING_REQUIRED_PARAMETER (debug_id: abc123)'
      )
    })

    it('falls back to the transport error message when the body is empty', async () => {
      mock.onPost(url).replyWithError({ message: 'socket hang up' })

      await expect(service.createOrder('Capture', '1')).rejects.toThrow('PayPal API error: socket hang up')
    })
  })

  describe('getOrder', () => {
    it('fetches an order and url-encodes the id', async () => {
      mock.onGet(`${ SANDBOX_BASE }/v2/checkout/orders/ORDER%2F1`).reply({ id: 'ORDER/1', status: 'APPROVED' })

      const result = await service.getOrder('ORDER/1')

      expect(result).toEqual({ id: 'ORDER/1', status: 'APPROVED' })
      expect(lastCall().method).toBe('get')
      expect(lastCall().body).toBeUndefined()
    })
  })

  describe('captureOrder', () => {
    it('posts an empty body with an idempotency header', async () => {
      mock.onPost(`${ SANDBOX_BASE }/v2/checkout/orders/ORDER-1/capture`).reply({ status: 'COMPLETED' })

      const result = await service.captureOrder('ORDER-1', 'cap-key')

      expect(result).toEqual({ status: 'COMPLETED' })
      expect(lastCall().body).toEqual({})
      expect(lastCall().headers['PayPal-Request-Id']).toBe('cap-key')
    })
  })

  describe('authorizeOrder', () => {
    it('posts an empty body to the authorize endpoint', async () => {
      mock.onPost(`${ SANDBOX_BASE }/v2/checkout/orders/ORDER-1/authorize`).reply({ status: 'COMPLETED' })

      await service.authorizeOrder('ORDER-1')

      expect(lastCall().url).toBe(`${ SANDBOX_BASE }/v2/checkout/orders/ORDER-1/authorize`)
      expect(lastCall().body).toEqual({})
    })
  })

  // ── Payments ──

  describe('getCapturedPayment', () => {
    it('fetches the capture by id', async () => {
      mock.onGet(`${ SANDBOX_BASE }/v2/payments/captures/CAP-1`).reply({ id: 'CAP-1', status: 'COMPLETED' })

      await expect(service.getCapturedPayment('CAP-1')).resolves.toEqual({ id: 'CAP-1', status: 'COMPLETED' })
    })
  })

  describe('refundCapturedPayment', () => {
    const url = `${ SANDBOX_BASE }/v2/payments/captures/CAP-1/refund`

    it('sends an empty body for a full refund', async () => {
      mock.onPost(url).reply({ id: 'REF-1', status: 'COMPLETED' })

      await service.refundCapturedPayment('CAP-1')

      expect(lastCall().body).toEqual({})
    })

    it('sends amount, note and invoice id for a partial refund', async () => {
      mock.onPost(url).reply({ id: 'REF-2' })

      await service.refundCapturedPayment('CAP-1', '25.00', 'EUR', 'Damaged item', 'INV-9', 'ref-key')

      expect(lastCall().body).toEqual({
        amount: { currency_code: 'EUR', value: '25.00' },
        note_to_payer: 'Damaged item',
        invoice_id: 'INV-9',
      })

      expect(lastCall().headers['PayPal-Request-Id']).toBe('ref-key')
    })
  })

  describe('getAuthorizedPayment', () => {
    it('fetches the authorization by id', async () => {
      mock.onGet(`${ SANDBOX_BASE }/v2/payments/authorizations/AUTH-1`).reply({ id: 'AUTH-1', status: 'CREATED' })

      await expect(service.getAuthorizedPayment('AUTH-1')).resolves.toEqual({ id: 'AUTH-1', status: 'CREATED' })
    })
  })

  describe('captureAuthorizedPayment', () => {
    const url = `${ SANDBOX_BASE }/v2/payments/authorizations/AUTH-1/capture`

    it('captures the full amount when no amount is provided', async () => {
      mock.onPost(url).reply({ id: 'CAP-2' })

      await service.captureAuthorizedPayment('AUTH-1')

      expect(lastCall().body).toEqual({})
    })

    it('sends a partial amount, final capture flag and note', async () => {
      mock.onPost(url).reply({ id: 'CAP-3' })

      await service.captureAuthorizedPayment('AUTH-1', '50.00', 'USD', true, 'Partial capture')

      expect(lastCall().body).toEqual({
        amount: { currency_code: 'USD', value: '50.00' },
        final_capture: true,
        note_to_payer: 'Partial capture',
      })
    })

    it('sends final_capture false when explicitly disabled', async () => {
      mock.onPost(url).reply({ id: 'CAP-4' })

      await service.captureAuthorizedPayment('AUTH-1', undefined, undefined, false)

      expect(lastCall().body).toEqual({ final_capture: false })
    })
  })

  describe('voidAuthorizedPayment', () => {
    it('posts an empty body to the void endpoint', async () => {
      mock.onPost(`${ SANDBOX_BASE }/v2/payments/authorizations/AUTH-1/void`).reply({ id: 'AUTH-1', status: 'VOIDED' })

      await service.voidAuthorizedPayment('AUTH-1')

      expect(lastCall().body).toEqual({})
      expect(lastCall().headers['PayPal-Request-Id']).toBeUndefined()
    })
  })

  // ── Invoicing ──

  describe('createDraftInvoice', () => {
    const url = `${ SANDBOX_BASE }/v2/invoicing/invoices`

    it('passes the invoice object through verbatim', async () => {
      mock.onPost(url).reply({ id: 'INV-1', status: 'DRAFT' })

      const invoice = { detail: { currency_code: 'USD' }, items: [{ name: 'Item' }] }

      await service.createDraftInvoice(invoice, 'inv-key')

      expect(lastCall().body).toEqual(invoice)
      expect(lastCall().headers['PayPal-Request-Id']).toBe('inv-key')
    })

    it('sends an empty object when no invoice is provided', async () => {
      mock.onPost(url).reply({ id: 'INV-2' })

      await service.createDraftInvoice()

      expect(lastCall().body).toEqual({})
    })
  })

  describe('sendInvoice', () => {
    const url = `${ SANDBOX_BASE }/v2/invoicing/invoices/INV-1/send`

    it('sends an empty body when no options are supplied', async () => {
      mock.onPost(url).reply({ href: 'https://paypal.com/invoice' })

      await service.sendInvoice('INV-1')

      expect(lastCall().body).toEqual({})
    })

    it('includes subject, note and the recipient flags', async () => {
      mock.onPost(url).reply({ href: 'https://paypal.com/invoice' })

      await service.sendInvoice('INV-1', 'Your invoice', 'Thanks!', true, false)

      expect(lastCall().body).toEqual({
        subject: 'Your invoice',
        note: 'Thanks!',
        send_to_recipient: true,
        send_to_invoicer: false,
      })
    })
  })

  describe('getInvoice', () => {
    it('fetches the invoice by id', async () => {
      mock.onGet(`${ SANDBOX_BASE }/v2/invoicing/invoices/INV-1`).reply({ id: 'INV-1', status: 'SENT' })

      await expect(service.getInvoice('INV-1')).resolves.toEqual({ id: 'INV-1', status: 'SENT' })
    })
  })

  describe('listInvoices', () => {
    const url = `${ SANDBOX_BASE }/v2/invoicing/invoices`

    it('applies default pagination', async () => {
      mock.onGet(url).reply({ items: [] })

      await service.listInvoices()

      expect(lastCall().query).toEqual({ page: 1, page_size: 20 })
    })

    it('applies custom pagination and the total flag', async () => {
      mock.onGet(url).reply({ items: [], total_items: 0 })

      await service.listInvoices(3, 50, true)

      expect(lastCall().query).toEqual({ page: 3, page_size: 50, total_required: true })
    })
  })

  describe('cancelInvoice', () => {
    const url = `${ SANDBOX_BASE }/v2/invoicing/invoices/INV-1/cancel`

    it('returns a success flag and sends the notification options', async () => {
      mock.onPost(url).reply('')

      const result = await service.cancelInvoice('INV-1', 'Cancelled', 'Sorry', false, true)

      expect(result).toEqual({ success: true })

      expect(lastCall().body).toEqual({
        subject: 'Cancelled',
        note: 'Sorry',
        send_to_recipient: false,
        send_to_invoicer: true,
      })
    })

    it('sends an empty body when no options are supplied', async () => {
      mock.onPost(url).reply('')

      await expect(service.cancelInvoice('INV-1')).resolves.toEqual({ success: true })
      expect(lastCall().body).toEqual({})
    })
  })

  describe('generateInvoiceNumber', () => {
    it('posts to the generate-next-invoice-number endpoint', async () => {
      mock.onPost(`${ SANDBOX_BASE }/v2/invoicing/generate-next-invoice-number`).reply({ invoice_number: '0001' })

      await expect(service.generateInvoiceNumber()).resolves.toEqual({ invoice_number: '0001' })
      expect(lastCall().body).toEqual({})
    })
  })

  describe('deleteInvoice', () => {
    it('deletes the invoice and returns a success flag', async () => {
      mock.onDelete(`${ SANDBOX_BASE }/v2/invoicing/invoices/INV-1`).reply('')

      await expect(service.deleteInvoice('INV-1')).resolves.toEqual({ success: true })
      expect(lastCall().method).toBe('delete')
      expect(lastCall().body).toBeUndefined()
    })

    it('propagates a delete failure', async () => {
      mock.onDelete(`${ SANDBOX_BASE }/v2/invoicing/invoices/INV-1`).replyWithError({
        message: 'Not Found',
        status: 404,
        body: { message: 'The requested resource ID was not found.' },
      })

      await expect(service.deleteInvoice('INV-1')).rejects.toThrow(
        'PayPal API error: The requested resource ID was not found.'
      )
    })
  })

  describe('recordPayment', () => {
    const url = `${ SANDBOX_BASE }/v2/invoicing/invoices/INV-1/payments`

    it('maps the payment method and uses the supplied date', async () => {
      mock.onPost(url).reply({ payment_id: 'PAY-1' })

      await service.recordPayment('INV-1', 'Bank Transfer', '74.21', 'USD', '2026-01-15', 'Received')

      expect(lastCall().body).toEqual({
        method: 'BANK_TRANSFER',
        payment_date: '2026-01-15',
        amount: { currency_code: 'USD', value: '74.21' },
        note: 'Received',
      })
    })

    it('defaults the payment date to today and omits an empty note', async () => {
      mock.onPost(url).reply({ payment_id: 'PAY-2' })

      await service.recordPayment('INV-1', 'Cash', '10')

      expect(lastCall().body).toEqual({
        method: 'CASH',
        payment_date: new Date().toISOString().slice(0, 10),
        amount: { currency_code: 'USD', value: '10' },
      })
    })

    it('passes an already-normalized method value through', async () => {
      mock.onPost(url).reply({ payment_id: 'PAY-3' })

      await service.recordPayment('INV-1', 'WIRE_TRANSFER', '10')

      expect(lastCall().body.method).toBe('WIRE_TRANSFER')
    })
  })

  // ── Subscriptions ──

  describe('createSubscription', () => {
    const url = `${ SANDBOX_BASE }/v1/billing/subscriptions`

    it('sends only the plan id when no subscriber details are provided', async () => {
      mock.onPost(url).reply({ id: 'I-1', status: 'APPROVAL_PENDING' })

      await service.createSubscription('P-1')

      expect(lastCall().body).toEqual({ plan_id: 'P-1' })
    })

    it('builds the subscriber object from email and name parts', async () => {
      mock.onPost(url).reply({ id: 'I-2' })

      await service.createSubscription('P-1', 'buyer@example.com', 'Ada', 'Lovelace', 3, '2026-08-01T00:00:00Z')

      expect(lastCall().body).toEqual({
        plan_id: 'P-1',
        subscriber: {
          email_address: 'buyer@example.com',
          name: { given_name: 'Ada', surname: 'Lovelace' },
        },
        quantity: '3',
        start_time: '2026-08-01T00:00:00Z',
      })
    })

    it('includes only the surname when the given name is missing', async () => {
      mock.onPost(url).reply({ id: 'I-3' })

      await service.createSubscription('P-1', undefined, undefined, 'Lovelace')

      expect(lastCall().body).toEqual({ plan_id: 'P-1', subscriber: { name: { surname: 'Lovelace' } } })
    })

    it('omits the quantity when it is an empty string', async () => {
      mock.onPost(url).reply({ id: 'I-4' })

      await service.createSubscription('P-1', undefined, undefined, undefined, '')

      expect(lastCall().body).toEqual({ plan_id: 'P-1' })
    })
  })

  describe('getSubscription', () => {
    it('fetches the subscription by id', async () => {
      mock.onGet(`${ SANDBOX_BASE }/v1/billing/subscriptions/I-1`).reply({ id: 'I-1', status: 'ACTIVE' })

      await expect(service.getSubscription('I-1')).resolves.toEqual({ id: 'I-1', status: 'ACTIVE' })
    })
  })

  describe('activateSubscription', () => {
    const url = `${ SANDBOX_BASE }/v1/billing/subscriptions/I-1/activate`

    it('sends the reason when provided', async () => {
      mock.onPost(url).reply('')

      await expect(service.activateSubscription('I-1', 'Back in stock')).resolves.toEqual({ success: true })
      expect(lastCall().body).toEqual({ reason: 'Back in stock' })
    })

    it('sends an empty body when no reason is provided', async () => {
      mock.onPost(url).reply('')

      await service.activateSubscription('I-1')

      expect(lastCall().body).toEqual({})
    })
  })

  describe('suspendSubscription', () => {
    const url = `${ SANDBOX_BASE }/v1/billing/subscriptions/I-1/suspend`

    it('sends the supplied reason', async () => {
      mock.onPost(url).reply('')

      await expect(service.suspendSubscription('I-1', 'Item out of stock')).resolves.toEqual({ success: true })
      expect(lastCall().body).toEqual({ reason: 'Item out of stock' })
    })

    it('falls back to a default reason', async () => {
      mock.onPost(url).reply('')

      await service.suspendSubscription('I-1')

      expect(lastCall().body).toEqual({ reason: 'Suspended via FlowRunner' })
    })
  })

  describe('cancelSubscription', () => {
    const url = `${ SANDBOX_BASE }/v1/billing/subscriptions/I-1/cancel`

    it('sends the supplied reason', async () => {
      mock.onPost(url).reply('')

      await expect(service.cancelSubscription('I-1', 'Not satisfied')).resolves.toEqual({ success: true })
      expect(lastCall().body).toEqual({ reason: 'Not satisfied' })
    })

    it('falls back to a default reason', async () => {
      mock.onPost(url).reply('')

      await service.cancelSubscription('I-1')

      expect(lastCall().body).toEqual({ reason: 'Cancelled via FlowRunner' })
    })
  })

  describe('listPlans', () => {
    const url = `${ SANDBOX_BASE }/v1/billing/plans`

    it('applies default pagination', async () => {
      mock.onGet(url).reply({ plans: [] })

      await service.listPlans()

      expect(lastCall().query).toEqual({ page: 1, page_size: 20 })
    })

    it('filters by product id and includes totals', async () => {
      mock.onGet(url).reply({ plans: [] })

      await service.listPlans('PROD-1', 2, 5, false)

      expect(lastCall().query).toEqual({ page: 2, page_size: 5, product_id: 'PROD-1', total_required: false })
    })
  })

  describe('getPlan', () => {
    it('fetches the plan by id', async () => {
      mock.onGet(`${ SANDBOX_BASE }/v1/billing/plans/P-1`).reply({ id: 'P-1', status: 'ACTIVE' })

      await expect(service.getPlan('P-1')).resolves.toEqual({ id: 'P-1', status: 'ACTIVE' })
    })
  })

  // ── Payouts ──

  describe('createBatchPayout', () => {
    const url = `${ SANDBOX_BASE }/v1/payments/payouts`

    it('builds the batch header and maps the payout items', async () => {
      mock.onPost(url).reply({ batch_header: { payout_batch_id: 'BATCH-1' } })

      await service.createBatchPayout(
        'batch-001',
        'You have a payout!',
        'Email',
        [
          { receiver: 'a@example.com', amount: '10.00', currency: 'USD', note: 'Thanks' },
          { receiver: 'b@example.com', amount: '5.00', currency: 'EUR' },
        ],
        'payout-key'
      )

      expect(lastCall().body).toEqual({
        sender_batch_header: { sender_batch_id: 'batch-001', email_subject: 'You have a payout!' },
        items: [
          {
            recipient_type: 'EMAIL',
            amount: { currency_code: 'USD', value: '10.00' },
            receiver: 'a@example.com',
            note: 'Thanks',
          },
          {
            recipient_type: 'EMAIL',
            amount: { currency_code: 'EUR', value: '5.00' },
            receiver: 'b@example.com',
          },
        ],
      })

      expect(lastCall().headers['PayPal-Request-Id']).toBe('payout-key')
    })

    it('resolves the PayPal ID recipient type and omits the email subject', async () => {
      mock.onPost(url).reply({ batch_header: {} })

      await service.createBatchPayout('batch-002', undefined, 'PayPal ID', [
        { receiver: 'PP-1', amount: '1', currency: 'USD' },
      ])

      expect(lastCall().body.sender_batch_header).toEqual({ sender_batch_id: 'batch-002' })
      expect(lastCall().body.items[0].recipient_type).toBe('PAYPAL_ID')
    })

    it('defaults the recipient type to EMAIL and tolerates a missing items array', async () => {
      mock.onPost(url).reply({ batch_header: {} })

      await service.createBatchPayout('batch-003')

      expect(lastCall().body).toEqual({
        sender_batch_header: { sender_batch_id: 'batch-003' },
        items: [],
      })
    })

    it('resolves the Phone recipient type', async () => {
      mock.onPost(url).reply({ batch_header: {} })

      await service.createBatchPayout('batch-004', undefined, 'Phone', [
        { receiver: '+15550001111', amount: '2', currency: 'USD' },
      ])

      expect(lastCall().body.items[0].recipient_type).toBe('PHONE')
    })
  })

  describe('getPayoutBatch', () => {
    it('fetches the payout batch by id', async () => {
      mock.onGet(`${ SANDBOX_BASE }/v1/payments/payouts/BATCH-1`).reply({
        batch_header: { payout_batch_id: 'BATCH-1', batch_status: 'SUCCESS' },
      })

      const result = await service.getPayoutBatch('BATCH-1')

      expect(result.batch_header.batch_status).toBe('SUCCESS')
    })
  })
})
