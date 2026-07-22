'use strict'

const { createSandbox } = require('../../../service-sandbox')

const KEY_ID = 'rzp_test_abc123'
const KEY_SECRET = 'test_secret_xyz'
const BASE = 'https://api.razorpay.com/v1'
const AUTH_HEADER = `Basic ${ Buffer.from(`${ KEY_ID }:${ KEY_SECRET }`).toString('base64') }`

describe('Razorpay Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ keyId: KEY_ID, keySecret: KEY_SECRET })
    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()
  })

  afterEach(() => {
    mock.reset()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Registration ──

  describe('service registration', () => {
    it('registers with correct config items', () => {
      const configs = sandbox.getConfigItems()

      expect(configs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'keyId', required: true, shared: false }),
          expect.objectContaining({ name: 'keySecret', required: true, shared: false }),
        ])
      )
    })
  })

  // ── Orders ──

  describe('createOrder', () => {
    it('sends POST with required fields and default currency', async () => {
      mock.onPost(`${BASE}/orders`).reply({ id: 'order_123', entity: 'order', amount: 50000, currency: 'INR', status: 'created' })

      const result = await service.createOrder(50000)

      expect(result).toHaveProperty('id', 'order_123')
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({ 'Authorization': AUTH_HEADER })
      expect(mock.history[0].body).toMatchObject({ amount: 50000, currency: 'INR' })
    })

    it('sends all optional fields', async () => {
      mock.onPost(`${BASE}/orders`).reply({ id: 'order_456' })

      await service.createOrder(10000, 'USD', 'rcpt_001', true, 5000, { key: 'val' })

      expect(mock.history[0].body).toMatchObject({
        amount: 10000,
        currency: 'USD',
        receipt: 'rcpt_001',
        partial_payment: true,
        first_payment_min_amount: 5000,
        notes: { key: 'val' },
      })
    })

    it('throws on API error', async () => {
      mock.onPost(`${BASE}/orders`).replyWithError({
        message: 'Bad Request',
        body: { error: { description: 'Amount is required' } },
      })

      await expect(service.createOrder()).rejects.toThrow('Razorpay API error: Amount is required')
    })
  })

  describe('listOrders', () => {
    it('sends GET with query params', async () => {
      mock.onGet(`${BASE}/orders`).reply({ entity: 'collection', count: 0, items: [] })

      await service.listOrders(1000, 2000, 10, 0, true, 'rcpt_001')

      expect(mock.history[0].query).toMatchObject({
        from: 1000,
        to: 2000,
        count: 10,
        skip: 0,
        authorized: 1,
        receipt: 'rcpt_001',
      })
    })

    it('converts authorized=false to 0', async () => {
      mock.onGet(`${BASE}/orders`).reply({ entity: 'collection', count: 0, items: [] })

      await service.listOrders(undefined, undefined, undefined, undefined, false)

      expect(mock.history[0].query).toMatchObject({ authorized: 0 })
    })
  })

  describe('getOrder', () => {
    it('sends GET to correct URL', async () => {
      mock.onGet(`${BASE}/orders/order_123`).reply({ id: 'order_123', entity: 'order' })

      const result = await service.getOrder('order_123')

      expect(result).toHaveProperty('id', 'order_123')
      expect(mock.history[0].url).toBe(`${BASE}/orders/order_123`)
    })
  })

  describe('updateOrder', () => {
    it('sends PATCH with notes', async () => {
      mock.onPatch(`${BASE}/orders/order_123`).reply({ id: 'order_123', notes: { key: 'val' } })

      await service.updateOrder('order_123', { key: 'val' })

      expect(mock.history[0].body).toEqual({ notes: { key: 'val' } })
    })
  })

  describe('listOrderPayments', () => {
    it('sends GET to correct URL', async () => {
      mock.onGet(`${BASE}/orders/order_123/payments`).reply({ entity: 'collection', count: 0, items: [] })

      await service.listOrderPayments('order_123')

      expect(mock.history[0].url).toBe(`${BASE}/orders/order_123/payments`)
    })
  })

  // ── Payments ──

  describe('listPayments', () => {
    it('sends GET with query params', async () => {
      mock.onGet(`${BASE}/payments`).reply({ entity: 'collection', count: 0, items: [] })

      await service.listPayments(1000, 2000, 10, 5)

      expect(mock.history[0].query).toMatchObject({ from: 1000, to: 2000, count: 10, skip: 5 })
    })
  })

  describe('getPayment', () => {
    it('sends GET without expand', async () => {
      mock.onGet(`${BASE}/payments/pay_123`).reply({ id: 'pay_123', entity: 'payment' })

      await service.getPayment('pay_123')

      expect(mock.history[0].url).toBe(`${BASE}/payments/pay_123`)
      expect(mock.history[0].query).toEqual({})
    })

    it('sends expand[] query param with resolved values', async () => {
      mock.onGet(`${BASE}/payments/pay_123`).reply({ id: 'pay_123' })

      await service.getPayment('pay_123', ['Card', 'EMI'])

      expect(mock.history[0].query).toEqual({ 'expand[]': ['card', 'emi'] })
    })

    it('handles empty expand array', async () => {
      mock.onGet(`${BASE}/payments/pay_123`).reply({ id: 'pay_123' })

      await service.getPayment('pay_123', [])

      expect(mock.history[0].query).toEqual({})
    })
  })

  describe('capturePayment', () => {
    it('sends POST with amount and default currency', async () => {
      mock.onPost(`${BASE}/payments/pay_123/capture`).reply({ id: 'pay_123', status: 'captured' })

      await service.capturePayment('pay_123', 50000)

      expect(mock.history[0].body).toEqual({ amount: 50000, currency: 'INR' })
    })

    it('sends POST with custom currency', async () => {
      mock.onPost(`${BASE}/payments/pay_123/capture`).reply({ id: 'pay_123' })

      await service.capturePayment('pay_123', 50000, 'USD')

      expect(mock.history[0].body).toEqual({ amount: 50000, currency: 'USD' })
    })
  })

  describe('updatePayment', () => {
    it('sends PATCH with notes', async () => {
      mock.onPatch(`${BASE}/payments/pay_123`).reply({ id: 'pay_123' })

      await service.updatePayment('pay_123', { ticket: '1234' })

      expect(mock.history[0].body).toEqual({ notes: { ticket: '1234' } })
    })
  })

  describe('getCardOfPayment', () => {
    it('sends GET to correct URL', async () => {
      mock.onGet(`${BASE}/payments/pay_123/card`).reply({ id: 'card_abc', last4: '4366' })

      const result = await service.getCardOfPayment('pay_123')

      expect(result).toHaveProperty('last4', '4366')
    })
  })

  describe('listDowntimes', () => {
    it('sends GET to downtimes endpoint', async () => {
      mock.onGet(`${BASE}/payments/downtimes`).reply({ entity: 'collection', count: 0, items: [] })

      await service.listDowntimes()

      expect(mock.history[0].url).toBe(`${BASE}/payments/downtimes`)
    })
  })

  describe('getDowntime', () => {
    it('sends GET with downtime ID', async () => {
      mock.onGet(`${BASE}/payments/downtimes/down_123`).reply({ id: 'down_123' })

      const result = await service.getDowntime('down_123')

      expect(result).toHaveProperty('id', 'down_123')
    })
  })

  // ── Refunds ──

  describe('createRefund', () => {
    it('sends POST with required paymentId only', async () => {
      mock.onPost(`${BASE}/payments/pay_123/refund`).reply({ id: 'rfnd_abc', entity: 'refund' })

      await service.createRefund('pay_123')

      expect(mock.history[0].url).toBe(`${BASE}/payments/pay_123/refund`)
    })

    it('sends all optional fields with resolved speed', async () => {
      mock.onPost(`${BASE}/payments/pay_123/refund`).reply({ id: 'rfnd_abc' })

      await service.createRefund('pay_123', 5000, 'Optimum', { reason: 'cancelled' }, 'rfnd_rcpt_001')

      expect(mock.history[0].body).toMatchObject({
        amount: 5000,
        speed: 'optimum',
        notes: { reason: 'cancelled' },
        receipt: 'rfnd_rcpt_001',
      })
    })

    it('resolves Normal speed', async () => {
      mock.onPost(`${BASE}/payments/pay_123/refund`).reply({ id: 'rfnd_abc' })

      await service.createRefund('pay_123', undefined, 'Normal')

      expect(mock.history[0].body).toMatchObject({ speed: 'normal' })
    })
  })

  describe('listPaymentRefunds', () => {
    it('sends GET with query params', async () => {
      mock.onGet(`${BASE}/payments/pay_123/refunds`).reply({ entity: 'collection', count: 0, items: [] })

      await service.listPaymentRefunds('pay_123', 1000, 2000, 10, 5)

      expect(mock.history[0].query).toMatchObject({ from: 1000, to: 2000, count: 10, skip: 5 })
    })
  })

  describe('getPaymentRefund', () => {
    it('sends GET with both IDs in URL', async () => {
      mock.onGet(`${BASE}/payments/pay_123/refunds/rfnd_456`).reply({ id: 'rfnd_456' })

      await service.getPaymentRefund('pay_123', 'rfnd_456')

      expect(mock.history[0].url).toBe(`${BASE}/payments/pay_123/refunds/rfnd_456`)
    })
  })

  describe('listRefunds', () => {
    it('sends GET with query params', async () => {
      mock.onGet(`${BASE}/refunds`).reply({ entity: 'collection', count: 0, items: [] })

      await service.listRefunds(1000, 2000, 10, 5)

      expect(mock.history[0].query).toMatchObject({ from: 1000, to: 2000, count: 10, skip: 5 })
    })
  })

  describe('getRefund', () => {
    it('sends GET to correct URL', async () => {
      mock.onGet(`${BASE}/refunds/rfnd_123`).reply({ id: 'rfnd_123' })

      const result = await service.getRefund('rfnd_123')

      expect(result).toHaveProperty('id', 'rfnd_123')
    })
  })

  describe('updateRefund', () => {
    it('sends PATCH with notes', async () => {
      mock.onPatch(`${BASE}/refunds/rfnd_123`).reply({ id: 'rfnd_123' })

      await service.updateRefund('rfnd_123', { reason: 'dup' })

      expect(mock.history[0].body).toEqual({ notes: { reason: 'dup' } })
    })
  })

  // ── Payment Links ──

  describe('createPaymentLink', () => {
    it('sends POST with required amount and default currency', async () => {
      mock.onPost(`${BASE}/payment_links`).reply({ id: 'plink_123', short_url: 'https://rzp.io/i/abc' })

      await service.createPaymentLink(10000)

      expect(mock.history[0].body).toMatchObject({ amount: 10000, currency: 'INR' })
    })

    it('sends customer, notify, and callback fields', async () => {
      mock.onPost(`${BASE}/payment_links`).reply({ id: 'plink_123' })

      await service.createPaymentLink(
        10000, 'USD', true, 5000, 'Test payment',
        'John', 'john@test.com', '+919000090000', true, true,
        true, 1700000000, 'ref_001', 'https://example.com/cb', 'GET', { key: 'val' }
      )

      expect(mock.history[0].body).toMatchObject({
        amount: 10000,
        currency: 'USD',
        accept_partial: true,
        first_min_partial_amount: 5000,
        description: 'Test payment',
        customer: { name: 'John', email: 'john@test.com', contact: '+919000090000' },
        notify: { sms: true, email: true },
        reminder_enable: true,
        expire_by: 1700000000,
        reference_id: 'ref_001',
        callback_url: 'https://example.com/cb',
        callback_method: 'get',
        notes: { key: 'val' },
      })
    })

    it('omits customer and notify when empty', async () => {
      mock.onPost(`${BASE}/payment_links`).reply({ id: 'plink_123' })

      await service.createPaymentLink(10000)

      const body = mock.history[0].body

      expect(body).not.toHaveProperty('customer')
      expect(body).not.toHaveProperty('notify')
      expect(body).not.toHaveProperty('callback_method')
    })
  })

  describe('listPaymentLinks', () => {
    it('sends GET with query params', async () => {
      mock.onGet(`${BASE}/payment_links`).reply({ payment_links: [] })

      await service.listPaymentLinks('pay_123', 'ref_001')

      expect(mock.history[0].query).toMatchObject({ payment_id: 'pay_123', reference_id: 'ref_001' })
    })
  })

  describe('getPaymentLink', () => {
    it('sends GET to correct URL', async () => {
      mock.onGet(`${BASE}/payment_links/plink_123`).reply({ id: 'plink_123' })

      await service.getPaymentLink('plink_123')

      expect(mock.history[0].url).toBe(`${BASE}/payment_links/plink_123`)
    })
  })

  describe('updatePaymentLink', () => {
    it('sends PATCH with all optional fields', async () => {
      mock.onPatch(`${BASE}/payment_links/plink_123`).reply({ id: 'plink_123' })

      await service.updatePaymentLink('plink_123', 'ref_002', 1700000000, { k: 'v' }, false)

      expect(mock.history[0].body).toMatchObject({
        reference_id: 'ref_002',
        expire_by: 1700000000,
        notes: { k: 'v' },
        reminder_enable: false,
      })
    })
  })

  describe('cancelPaymentLink', () => {
    it('sends POST with empty body', async () => {
      mock.onPost(`${BASE}/payment_links/plink_123/cancel`).reply({ id: 'plink_123', status: 'cancelled' })

      await service.cancelPaymentLink('plink_123')

      expect(mock.history[0].body).toEqual({})
    })
  })

  describe('sendPaymentLinkNotification', () => {
    it('resolves SMS medium in URL', async () => {
      mock.onPost(`${BASE}/payment_links/plink_123/notify_by/sms`).reply({ success: true })

      await service.sendPaymentLinkNotification('plink_123', 'SMS')

      expect(mock.history[0].url).toBe(`${BASE}/payment_links/plink_123/notify_by/sms`)
    })

    it('resolves Email medium in URL', async () => {
      mock.onPost(`${BASE}/payment_links/plink_123/notify_by/email`).reply({ success: true })

      await service.sendPaymentLinkNotification('plink_123', 'Email')

      expect(mock.history[0].url).toBe(`${BASE}/payment_links/plink_123/notify_by/email`)
    })
  })

  // ── Invoices ──

  describe('createInvoice', () => {
    it('sends POST with customerId and line items', async () => {
      mock.onPost(`${BASE}/invoices`).reply({ id: 'inv_123' })

      const lineItems = [{ name: 'Book', amount: 20000, currency: 'INR', quantity: 1 }]

      await service.createInvoice('cust_123', undefined, lineItems)

      expect(mock.history[0].body).toMatchObject({
        type: 'invoice',
        customer_id: 'cust_123',
        line_items: lineItems,
      })
      expect(mock.history[0].body).not.toHaveProperty('customer')
    })

    it('sends inline customer when no customerId', async () => {
      mock.onPost(`${BASE}/invoices`).reply({ id: 'inv_123' })

      const customer = { name: 'Test', email: 'test@example.com' }
      const lineItems = [{ name: 'Book', amount: 20000 }]

      await service.createInvoice(undefined, customer, lineItems)

      expect(mock.history[0].body).toMatchObject({ customer, line_items: lineItems })
      expect(mock.history[0].body).not.toHaveProperty('customer_id')
    })

    it('converts smsNotify and emailNotify to 1/0', async () => {
      mock.onPost(`${BASE}/invoices`).reply({ id: 'inv_123' })

      await service.createInvoice(undefined, undefined, [{ name: 'X', amount: 100 }], undefined, true, false)

      expect(mock.history[0].body).toMatchObject({ sms_notify: 1, email_notify: 0 })
    })
  })

  describe('listInvoices', () => {
    it('resolves type choice and sends query params', async () => {
      mock.onGet(`${BASE}/invoices`).reply({ entity: 'collection', count: 0, items: [] })

      await service.listInvoices('Invoice', 'pay_123', 'rcpt_001', 'cust_123', 10, 0)

      expect(mock.history[0].query).toMatchObject({
        type: 'invoice',
        payment_id: 'pay_123',
        receipt: 'rcpt_001',
        customer_id: 'cust_123',
        count: 10,
        skip: 0,
      })
    })

    it('resolves Link type', async () => {
      mock.onGet(`${BASE}/invoices`).reply({ entity: 'collection', count: 0, items: [] })

      await service.listInvoices('Link')

      expect(mock.history[0].query).toMatchObject({ type: 'link' })
    })
  })

  describe('getInvoice', () => {
    it('sends GET to correct URL', async () => {
      mock.onGet(`${BASE}/invoices/inv_123`).reply({ id: 'inv_123' })

      await service.getInvoice('inv_123')

      expect(mock.history[0].url).toBe(`${BASE}/invoices/inv_123`)
    })
  })

  describe('updateInvoice', () => {
    it('sends PATCH with all fields', async () => {
      mock.onPatch(`${BASE}/invoices/inv_123`).reply({ id: 'inv_123' })

      await service.updateInvoice(
        'inv_123',
        [{ name: 'Y', amount: 500 }],
        'Updated desc',
        'rcpt_002',
        1700000000,
        true,
        false,
        true,
        { note: 'x' }
      )

      expect(mock.history[0].body).toMatchObject({
        line_items: [{ name: 'Y', amount: 500 }],
        description: 'Updated desc',
        receipt: 'rcpt_002',
        expire_by: 1700000000,
        sms_notify: 1,
        email_notify: 0,
        partial_payment: true,
        notes: { note: 'x' },
      })
    })
  })

  describe('issueInvoice', () => {
    it('sends POST with empty body', async () => {
      mock.onPost(`${BASE}/invoices/inv_123/issue`).reply({ id: 'inv_123', status: 'issued' })

      await service.issueInvoice('inv_123')

      expect(mock.history[0].body).toEqual({})
    })
  })

  describe('cancelInvoice', () => {
    it('sends POST to cancel endpoint', async () => {
      mock.onPost(`${BASE}/invoices/inv_123/cancel`).reply({ id: 'inv_123', status: 'cancelled' })

      await service.cancelInvoice('inv_123')

      expect(mock.history[0].url).toBe(`${BASE}/invoices/inv_123/cancel`)
    })
  })

  describe('deleteInvoice', () => {
    it('sends DELETE to correct URL', async () => {
      mock.onDelete(`${BASE}/invoices/inv_123`).reply([])

      await service.deleteInvoice('inv_123')

      expect(mock.history[0].method).toBe('delete')
    })
  })

  describe('sendInvoiceNotification', () => {
    it('resolves SMS medium', async () => {
      mock.onPost(`${BASE}/invoices/inv_123/notify_by/sms`).reply({ success: true })

      await service.sendInvoiceNotification('inv_123', 'SMS')

      expect(mock.history[0].url).toBe(`${BASE}/invoices/inv_123/notify_by/sms`)
    })

    it('resolves Email medium', async () => {
      mock.onPost(`${BASE}/invoices/inv_123/notify_by/email`).reply({ success: true })

      await service.sendInvoiceNotification('inv_123', 'Email')

      expect(mock.history[0].url).toBe(`${BASE}/invoices/inv_123/notify_by/email`)
    })
  })

  // ── Items ──

  describe('createItem', () => {
    it('sends POST with required fields and default currency', async () => {
      mock.onPost(`${BASE}/items`).reply({ id: 'item_123', name: 'Book', amount: 20000, currency: 'INR' })

      await service.createItem('Book', undefined, 20000)

      expect(mock.history[0].body).toMatchObject({ name: 'Book', amount: 20000, currency: 'INR' })
      expect(mock.history[0].body).not.toHaveProperty('description')
    })

    it('sends all fields with custom currency', async () => {
      mock.onPost(`${BASE}/items`).reply({ id: 'item_123' })

      await service.createItem('Book', 'A story', 20000, 'USD')

      expect(mock.history[0].body).toMatchObject({
        name: 'Book',
        description: 'A story',
        amount: 20000,
        currency: 'USD',
      })
    })
  })

  describe('listItems', () => {
    it('sends GET with query params and converts active to flag', async () => {
      mock.onGet(`${BASE}/items`).reply({ entity: 'collection', count: 0, items: [] })

      await service.listItems(1000, 2000, 10, 0, true)

      expect(mock.history[0].query).toMatchObject({ from: 1000, to: 2000, count: 10, skip: 0, active: 1 })
    })
  })

  describe('getItem', () => {
    it('sends GET to correct URL', async () => {
      mock.onGet(`${BASE}/items/item_123`).reply({ id: 'item_123' })

      await service.getItem('item_123')

      expect(mock.history[0].url).toBe(`${BASE}/items/item_123`)
    })
  })

  describe('updateItem', () => {
    it('sends PATCH with provided fields', async () => {
      mock.onPatch(`${BASE}/items/item_123`).reply({ id: 'item_123' })

      await service.updateItem('item_123', 'New Name', undefined, 30000, undefined, false)

      expect(mock.history[0].body).toMatchObject({ name: 'New Name', amount: 30000, active: false })
    })
  })

  describe('deleteItem', () => {
    it('sends DELETE to correct URL', async () => {
      mock.onDelete(`${BASE}/items/item_123`).reply([])

      await service.deleteItem('item_123')

      expect(mock.history[0].method).toBe('delete')
    })
  })

  // ── Customers ──

  describe('createCustomer', () => {
    it('sends POST with name and resolved failExisting', async () => {
      mock.onPost(`${BASE}/customers`).reply({ id: 'cust_123', name: 'Test' })

      await service.createCustomer('Test', '+919000090000', 'test@test.com', 'Fetch Existing Customer')

      expect(mock.history[0].body).toMatchObject({
        name: 'Test',
        contact: '+919000090000',
        email: 'test@test.com',
        fail_existing: '0',
      })
    })

    it('resolves Fail With Error', async () => {
      mock.onPost(`${BASE}/customers`).reply({ id: 'cust_123' })

      await service.createCustomer('Test', undefined, undefined, 'Fail With Error')

      expect(mock.history[0].body).toMatchObject({ fail_existing: '1' })
    })
  })

  describe('listCustomers', () => {
    it('sends GET with count and skip', async () => {
      mock.onGet(`${BASE}/customers`).reply({ entity: 'collection', count: 0, items: [] })

      await service.listCustomers(10, 20)

      expect(mock.history[0].query).toMatchObject({ count: 10, skip: 20 })
    })
  })

  describe('getCustomer', () => {
    it('sends GET to correct URL', async () => {
      mock.onGet(`${BASE}/customers/cust_123`).reply({ id: 'cust_123' })

      await service.getCustomer('cust_123')

      expect(mock.history[0].url).toBe(`${BASE}/customers/cust_123`)
    })
  })

  describe('updateCustomer', () => {
    it('sends PUT with provided fields', async () => {
      mock.onPut(`${BASE}/customers/cust_123`).reply({ id: 'cust_123' })

      await service.updateCustomer('cust_123', 'New Name', 'new@test.com', '+919111111111')

      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].body).toMatchObject({ name: 'New Name', email: 'new@test.com', contact: '+919111111111' })
    })
  })

  // ── Plans ──

  describe('createPlan', () => {
    it('sends POST with resolved period and item', async () => {
      mock.onPost(`${BASE}/plans`).reply({ id: 'plan_123' })

      await service.createPlan('Monthly', 1, 'Pro Plan', 69900, undefined, 'Monthly subscription')

      expect(mock.history[0].body).toMatchObject({
        period: 'monthly',
        interval: 1,
        item: { name: 'Pro Plan', amount: 69900, currency: 'INR', description: 'Monthly subscription' },
      })
    })

    it('resolves all period values', async () => {
      const periods = [['Daily', 'daily'], ['Weekly', 'weekly'], ['Monthly', 'monthly'], ['Yearly', 'yearly']]

      for (const [input, expected] of periods) {
        mock.reset()
        mock.onPost(`${BASE}/plans`).reply({ id: 'plan_123' })

        await service.createPlan(input, 1, 'Test', 100)

        expect(mock.history[0].body.period).toBe(expected)
      }
    })
  })

  describe('listPlans', () => {
    it('sends GET with query params', async () => {
      mock.onGet(`${BASE}/plans`).reply({ entity: 'collection', count: 0, items: [] })

      await service.listPlans(1000, 2000, 10, 5)

      expect(mock.history[0].query).toMatchObject({ from: 1000, to: 2000, count: 10, skip: 5 })
    })
  })

  describe('getPlan', () => {
    it('sends GET to correct URL', async () => {
      mock.onGet(`${BASE}/plans/plan_123`).reply({ id: 'plan_123' })

      await service.getPlan('plan_123')

      expect(mock.history[0].url).toBe(`${BASE}/plans/plan_123`)
    })
  })

  // ── Subscriptions ──

  describe('createSubscription', () => {
    it('sends POST with required fields', async () => {
      mock.onPost(`${BASE}/subscriptions`).reply({ id: 'sub_123' })

      await service.createSubscription('plan_123', 12)

      expect(mock.history[0].body).toMatchObject({ plan_id: 'plan_123', total_count: 12 })
    })

    it('sends all optional fields', async () => {
      mock.onPost(`${BASE}/subscriptions`).reply({ id: 'sub_123' })

      await service.createSubscription('plan_123', 12, 2, 1700000000, 1700500000, true, [{ item: { name: 'Setup', amount: 500 } }], 'offer_123', { k: 'v' })

      expect(mock.history[0].body).toMatchObject({
        plan_id: 'plan_123',
        total_count: 12,
        quantity: 2,
        start_at: 1700000000,
        expire_by: 1700500000,
        customer_notify: 1,
        addons: [{ item: { name: 'Setup', amount: 500 } }],
        offer_id: 'offer_123',
        notes: { k: 'v' },
      })
    })
  })

  describe('listSubscriptions', () => {
    it('sends GET with query params', async () => {
      mock.onGet(`${BASE}/subscriptions`).reply({ entity: 'collection', count: 0, items: [] })

      await service.listSubscriptions('plan_123', 10, 5)

      expect(mock.history[0].query).toMatchObject({ plan_id: 'plan_123', count: 10, skip: 5 })
    })
  })

  describe('getSubscription', () => {
    it('sends GET to correct URL', async () => {
      mock.onGet(`${BASE}/subscriptions/sub_123`).reply({ id: 'sub_123' })

      await service.getSubscription('sub_123')

      expect(mock.history[0].url).toBe(`${BASE}/subscriptions/sub_123`)
    })
  })

  describe('updateSubscription', () => {
    it('sends PATCH with resolved scheduleChangeAt', async () => {
      mock.onPatch(`${BASE}/subscriptions/sub_123`).reply({ id: 'sub_123' })

      await service.updateSubscription('sub_123', 'plan_456', 3, 6, 'Cycle End', true)

      expect(mock.history[0].body).toMatchObject({
        plan_id: 'plan_456',
        quantity: 3,
        remaining_count: 6,
        schedule_change_at: 'cycle_end',
        customer_notify: 1,
      })
    })

    it('resolves Now scheduleChangeAt', async () => {
      mock.onPatch(`${BASE}/subscriptions/sub_123`).reply({ id: 'sub_123' })

      await service.updateSubscription('sub_123', undefined, undefined, undefined, 'Now')

      expect(mock.history[0].body).toMatchObject({ schedule_change_at: 'now' })
    })
  })

  describe('cancelSubscription', () => {
    it('sends POST with cancel_at_cycle_end flag', async () => {
      mock.onPost(`${BASE}/subscriptions/sub_123/cancel`).reply({ id: 'sub_123', status: 'cancelled' })

      await service.cancelSubscription('sub_123', true)

      expect(mock.history[0].body).toMatchObject({ cancel_at_cycle_end: 1 })
    })
  })

  describe('pauseSubscription', () => {
    it('sends POST with pause_at now', async () => {
      mock.onPost(`${BASE}/subscriptions/sub_123/pause`).reply({ id: 'sub_123', status: 'paused' })

      await service.pauseSubscription('sub_123')

      expect(mock.history[0].body).toEqual({ pause_at: 'now' })
    })
  })

  describe('resumeSubscription', () => {
    it('sends POST with resume_at now', async () => {
      mock.onPost(`${BASE}/subscriptions/sub_123/resume`).reply({ id: 'sub_123', status: 'active' })

      await service.resumeSubscription('sub_123')

      expect(mock.history[0].body).toEqual({ resume_at: 'now' })
    })
  })

  describe('createSubscriptionAddon', () => {
    it('sends POST with item and quantity', async () => {
      mock.onPost(`${BASE}/subscriptions/sub_123/addons`).reply({ id: 'ao_123' })

      await service.createSubscriptionAddon('sub_123', 'Setup fee', 30000, 'USD', 2)

      expect(mock.history[0].body).toMatchObject({
        item: { name: 'Setup fee', amount: 30000, currency: 'USD' },
        quantity: 2,
      })
    })

    it('defaults item currency to INR', async () => {
      mock.onPost(`${BASE}/subscriptions/sub_123/addons`).reply({ id: 'ao_123' })

      await service.createSubscriptionAddon('sub_123', 'Fee', 1000)

      expect(mock.history[0].body.item).toMatchObject({ currency: 'INR' })
    })
  })

  describe('getAddon', () => {
    it('sends GET to correct URL', async () => {
      mock.onGet(`${BASE}/addons/ao_123`).reply({ id: 'ao_123' })

      await service.getAddon('ao_123')

      expect(mock.history[0].url).toBe(`${BASE}/addons/ao_123`)
    })
  })

  describe('deleteAddon', () => {
    it('sends DELETE to correct URL', async () => {
      mock.onDelete(`${BASE}/addons/ao_123`).reply([])

      await service.deleteAddon('ao_123')

      expect(mock.history[0].method).toBe('delete')
    })
  })

  // ── QR Codes ──

  describe('createQrCode', () => {
    it('sends POST with resolved usage and type', async () => {
      mock.onPost(`${BASE}/payments/qr_codes`).reply({ id: 'qr_123' })

      await service.createQrCode('Store QR', 'Single Use', true, 30000, 'For store')

      expect(mock.history[0].body).toMatchObject({
        type: 'upi_qr',
        name: 'Store QR',
        usage: 'single_use',
        fixed_amount: true,
        payment_amount: 30000,
        description: 'For store',
      })
    })

    it('resolves Multiple Use', async () => {
      mock.onPost(`${BASE}/payments/qr_codes`).reply({ id: 'qr_123' })

      await service.createQrCode('QR', 'Multiple Use')

      expect(mock.history[0].body).toMatchObject({ usage: 'multiple_use' })
    })
  })

  describe('listQrCodes', () => {
    it('sends GET with query params', async () => {
      mock.onGet(`${BASE}/payments/qr_codes`).reply({ entity: 'collection', count: 0, items: [] })

      await service.listQrCodes(1000, 2000, 10, 5)

      expect(mock.history[0].query).toMatchObject({ from: 1000, to: 2000, count: 10, skip: 5 })
    })
  })

  describe('getQrCode', () => {
    it('sends GET to correct URL', async () => {
      mock.onGet(`${BASE}/payments/qr_codes/qr_123`).reply({ id: 'qr_123' })

      await service.getQrCode('qr_123')

      expect(mock.history[0].url).toBe(`${BASE}/payments/qr_codes/qr_123`)
    })
  })

  describe('closeQrCode', () => {
    it('sends POST with empty body', async () => {
      mock.onPost(`${BASE}/payments/qr_codes/qr_123/close`).reply({ id: 'qr_123', status: 'closed' })

      await service.closeQrCode('qr_123')

      expect(mock.history[0].body).toEqual({})
    })
  })

  describe('listQrCodePayments', () => {
    it('sends GET with query params', async () => {
      mock.onGet(`${BASE}/payments/qr_codes/qr_123/payments`).reply({ entity: 'collection', count: 0, items: [] })

      await service.listQrCodePayments('qr_123', 1000, 2000, 10, 5)

      expect(mock.history[0].query).toMatchObject({ from: 1000, to: 2000, count: 10, skip: 5 })
    })
  })

  // ── Settlements ──

  describe('listSettlements', () => {
    it('sends GET with query params', async () => {
      mock.onGet(`${BASE}/settlements`).reply({ entity: 'collection', count: 0, items: [] })

      await service.listSettlements(1000, 2000, 10, 5)

      expect(mock.history[0].query).toMatchObject({ from: 1000, to: 2000, count: 10, skip: 5 })
    })
  })

  describe('getSettlement', () => {
    it('sends GET to correct URL', async () => {
      mock.onGet(`${BASE}/settlements/setl_123`).reply({ id: 'setl_123' })

      await service.getSettlement('setl_123')

      expect(mock.history[0].url).toBe(`${BASE}/settlements/setl_123`)
    })
  })

  describe('getCombinedSettlementRecon', () => {
    it('sends GET with year, month, day', async () => {
      mock.onGet(`${BASE}/settlements/recon/combined`).reply({ entity: 'report', count: 0, items: [] })

      await service.getCombinedSettlementRecon(2024, 6, 15, 10, 0)

      expect(mock.history[0].query).toMatchObject({ year: 2024, month: 6, day: 15, count: 10, skip: 0 })
    })
  })

  describe('createOnDemandSettlement', () => {
    it('sends POST with required and optional fields', async () => {
      mock.onPost(`${BASE}/settlements/ondemand`).reply({ id: 'setlod_123' })

      await service.createOnDemandSettlement(200000, true, 'Urgent', { k: 'v' })

      expect(mock.history[0].body).toMatchObject({
        amount: 200000,
        settle_full_balance: true,
        description: 'Urgent',
        notes: { k: 'v' },
      })
    })
  })

  describe('listOnDemandSettlements', () => {
    it('sends GET with query params', async () => {
      mock.onGet(`${BASE}/settlements/ondemand`).reply({ entity: 'collection', count: 0, items: [] })

      await service.listOnDemandSettlements(1000, 2000, 10, 5)

      expect(mock.history[0].query).toMatchObject({ from: 1000, to: 2000, count: 10, skip: 5 })
    })
  })

  describe('getOnDemandSettlement', () => {
    it('sends GET to correct URL', async () => {
      mock.onGet(`${BASE}/settlements/ondemand/setlod_123`).reply({ id: 'setlod_123' })

      await service.getOnDemandSettlement('setlod_123')

      expect(mock.history[0].url).toBe(`${BASE}/settlements/ondemand/setlod_123`)
    })
  })

  // ── Virtual Accounts ──

  describe('createVirtualAccount', () => {
    it('defaults to bank_account receiver type', async () => {
      mock.onPost(`${BASE}/virtual_accounts`).reply({ id: 'va_123' })

      await service.createVirtualAccount([], 'Test VA')

      expect(mock.history[0].body).toMatchObject({
        receivers: { types: ['bank_account'] },
        description: 'Test VA',
      })
    })

    it('resolves receiver types', async () => {
      mock.onPost(`${BASE}/virtual_accounts`).reply({ id: 'va_123' })

      await service.createVirtualAccount(['Bank Account', 'VPA'])

      expect(mock.history[0].body).toMatchObject({
        receivers: { types: ['bank_account', 'vpa'] },
      })
    })
  })

  describe('listVirtualAccounts', () => {
    it('sends GET with query params', async () => {
      mock.onGet(`${BASE}/virtual_accounts`).reply({ entity: 'collection', count: 0, items: [] })

      await service.listVirtualAccounts(1000, 2000, 10, 5)

      expect(mock.history[0].query).toMatchObject({ from: 1000, to: 2000, count: 10, skip: 5 })
    })
  })

  describe('getVirtualAccount', () => {
    it('sends GET to correct URL', async () => {
      mock.onGet(`${BASE}/virtual_accounts/va_123`).reply({ id: 'va_123' })

      await service.getVirtualAccount('va_123')

      expect(mock.history[0].url).toBe(`${BASE}/virtual_accounts/va_123`)
    })
  })

  describe('closeVirtualAccount', () => {
    it('sends POST with empty body', async () => {
      mock.onPost(`${BASE}/virtual_accounts/va_123/close`).reply({ id: 'va_123', status: 'closed' })

      await service.closeVirtualAccount('va_123')

      expect(mock.history[0].body).toEqual({})
    })
  })

  describe('listVirtualAccountPayments', () => {
    it('sends GET with query params', async () => {
      mock.onGet(`${BASE}/virtual_accounts/va_123/payments`).reply({ entity: 'collection', count: 0, items: [] })

      await service.listVirtualAccountPayments('va_123', 1000, 2000, 10, 5)

      expect(mock.history[0].query).toMatchObject({ from: 1000, to: 2000, count: 10, skip: 5 })
    })
  })

  // ── Dictionary Methods ──

  describe('getCustomersDictionary', () => {
    it('returns mapped items with label and value', async () => {
      mock.onGet(`${BASE}/customers`).reply({
        items: [
          { id: 'cust_1', name: 'John', email: 'john@test.com', contact: '+91900' },
          { id: 'cust_2', name: 'Jane', email: 'jane@test.com' },
        ],
      })

      const result = await service.getCustomersDictionary({})

      expect(result.items).toHaveLength(2)
      expect(result.items[0]).toEqual({ label: 'John', value: 'cust_1', note: 'john@test.com | +91900' })
      expect(result.items[1]).toEqual({ label: 'Jane', value: 'cust_2', note: 'jane@test.com' })
      expect(result.cursor).toBeNull()
    })

    it('filters by case-insensitive search', async () => {
      mock.onGet(`${BASE}/customers`).reply({
        items: [
          { id: 'cust_1', name: 'John', email: 'john@test.com' },
          { id: 'cust_2', name: 'Jane', email: 'jane@test.com' },
        ],
      })

      const result = await service.getCustomersDictionary({ search: 'JOHN' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('cust_1')
    })

    it('handles null payload', async () => {
      mock.onGet(`${BASE}/customers`).reply({ items: [{ id: 'cust_1', name: 'A' }] })

      const result = await service.getCustomersDictionary(null)

      expect(result.items).toHaveLength(1)
      expect(result.cursor).toBeNull()
    })

    it('returns cursor when page is full', async () => {
      const items = Array.from({ length: 100 }, (_, i) => ({ id: `cust_${i}`, name: `C${i}` }))

      mock.onGet(`${BASE}/customers`).reply({ items })

      const result = await service.getCustomersDictionary({})

      expect(result.cursor).toBe('100')
    })

    it('uses cursor as skip', async () => {
      mock.onGet(`${BASE}/customers`).reply({ items: [] })

      await service.getCustomersDictionary({ cursor: '200' })

      expect(mock.history[0].query).toMatchObject({ count: 100, skip: 200 })
    })

    it('handles empty items', async () => {
      mock.onGet(`${BASE}/customers`).reply({ items: null })

      const result = await service.getCustomersDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getPlansDictionary', () => {
    it('returns mapped items with label, value, note', async () => {
      mock.onGet(`${BASE}/plans`).reply({
        items: [{ id: 'plan_1', period: 'monthly', interval: 1, item: { name: 'Pro', amount: 69900, currency: 'INR' } }],
      })

      const result = await service.getPlansDictionary({})

      expect(result.items[0]).toEqual({
        label: 'Pro',
        value: 'plan_1',
        note: 'monthly x1 - 69900 INR',
      })
    })

    it('filters by search on item name', async () => {
      mock.onGet(`${BASE}/plans`).reply({
        items: [
          { id: 'plan_1', item: { name: 'Pro Plan' } },
          { id: 'plan_2', item: { name: 'Basic Plan' } },
        ],
      })

      const result = await service.getPlansDictionary({ search: 'basic' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('plan_2')
    })
  })

  describe('getItemsDictionary', () => {
    it('returns mapped items with inactive note', async () => {
      mock.onGet(`${BASE}/items`).reply({
        items: [{ id: 'item_1', name: 'Book', amount: 20000, currency: 'INR', active: false }],
      })

      const result = await service.getItemsDictionary({})

      expect(result.items[0]).toEqual({
        label: 'Book',
        value: 'item_1',
        note: '20000 INR (inactive)',
      })
    })

    it('filters by name and description', async () => {
      mock.onGet(`${BASE}/items`).reply({
        items: [
          { id: 'item_1', name: 'Book', description: 'Indian novel', amount: 100, currency: 'INR', active: true },
          { id: 'item_2', name: 'Pen', description: 'Blue pen', amount: 50, currency: 'INR', active: true },
        ],
      })

      const result = await service.getItemsDictionary({ search: 'novel' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('item_1')
    })
  })

  // ── Error Handling ──

  describe('error handling', () => {
    it('extracts error.description from API response', async () => {
      mock.onGet(`${BASE}/orders/bad`).replyWithError({
        message: 'Bad Request',
        body: { error: { description: 'The id provided does not exist' } },
      })

      await expect(service.getOrder('bad')).rejects.toThrow('Razorpay API error: The id provided does not exist')
    })

    it('falls back to error.body.message', async () => {
      mock.onGet(`${BASE}/orders/bad`).replyWithError({
        message: 'Server Error',
        body: { message: 'Internal server error' },
      })

      await expect(service.getOrder('bad')).rejects.toThrow('Razorpay API error: Internal server error')
    })

    it('falls back to error.message', async () => {
      mock.onGet(`${BASE}/orders/bad`).replyWithError({ message: 'Network timeout' })

      await expect(service.getOrder('bad')).rejects.toThrow('Razorpay API error: Network timeout')
    })
  })
})
