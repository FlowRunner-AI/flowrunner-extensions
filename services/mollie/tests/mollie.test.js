'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test_api_key_mollie'
const BASE = 'https://api.mollie.com/v2'
const AUTH = `Bearer ${ API_KEY }`

describe('Mollie Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ apiKey: API_KEY })
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
      expect(sandbox.getConfigItems()).toEqual([
        expect.objectContaining({
          name: 'apiKey',
          displayName: 'API Key',
          required: true,
          shared: false,
          type: 'STRING',
        }),
      ])
    })

    it('sends Bearer auth header on requests', async () => {
      mock.onGet(`${ BASE }/payments/tr_123`).reply({ id: 'tr_123' })

      await service.getPayment('tr_123')

      expect(mock.history[0].headers).toMatchObject({ Authorization: AUTH })
    })

    it('sends JSON Content-Type on requests', async () => {
      mock.onGet(`${ BASE }/payments/tr_123`).reply({ id: 'tr_123' })

      await service.getPayment('tr_123')

      expect(mock.history[0].headers).toMatchObject({ 'Content-Type': 'application/json' })
    })
  })

  // ── Payments ──

  describe('createPayment', () => {
    it('sends POST with required fields and formatted amount', async () => {
      mock.onPost(`${ BASE }/payments`).reply({
        resource: 'payment',
        id: 'tr_7UhSN1zuXS',
        status: 'open',
        _links: { checkout: { href: 'https://checkout.mollie.com/123' } },
      })

      const result = await service.createPayment('10.00', 'EUR', 'Order #1', 'https://example.org/return')

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].body).toMatchObject({
        amount: { currency: 'EUR', value: '10.00' },
        description: 'Order #1',
        redirectUrl: 'https://example.org/return',
      })
      expect(result.checkoutUrl).toBe('https://checkout.mollie.com/123')
    })

    it('resolves dropdown choices for method, locale, and sequenceType', async () => {
      mock.onPost(`${ BASE }/payments`).reply({
        resource: 'payment',
        id: 'tr_abc',
        _links: {},
      })

      await service.createPayment(
        '25', 'USD', 'Test', 'https://r.com', undefined, undefined,
        'iDEAL', 'Dutch (Netherlands)', undefined, 'First', 'cst_123'
      )

      expect(mock.history[0].body).toMatchObject({
        amount: { currency: 'USD', value: '25.00' },
        method: 'ideal',
        locale: 'nl_NL',
        sequenceType: 'first',
        customerId: 'cst_123',
      })
    })

    it('formats JPY amount with zero decimals', async () => {
      mock.onPost(`${ BASE }/payments`).reply({
        resource: 'payment',
        id: 'tr_jpy',
        _links: {},
      })

      await service.createPayment('1000', 'JPY', 'JPY payment', 'https://r.com')

      expect(mock.history[0].body.amount).toEqual({ currency: 'JPY', value: '1000' })
    })

    it('returns null checkoutUrl when _links.checkout is absent', async () => {
      mock.onPost(`${ BASE }/payments`).reply({
        resource: 'payment',
        id: 'tr_recurring',
        _links: {},
      })

      const result = await service.createPayment('10', 'EUR', 'Recurring', undefined, undefined, undefined, undefined, undefined, undefined, 'Recurring', 'cst_1')

      expect(result.checkoutUrl).toBeNull()
    })

    it('omits optional fields when not provided', async () => {
      mock.onPost(`${ BASE }/payments`).reply({
        resource: 'payment',
        id: 'tr_min',
        _links: {},
      })

      await service.createPayment('5', 'EUR', 'Minimal')

      const body = mock.history[0].body

      expect(body).not.toHaveProperty('cancelUrl')
      expect(body).not.toHaveProperty('webhookUrl')
      expect(body).not.toHaveProperty('method')
      expect(body).not.toHaveProperty('locale')
      expect(body).not.toHaveProperty('metadata')
      expect(body).not.toHaveProperty('mandateId')
    })

    it('throws on API error', async () => {
      mock.onPost(`${ BASE }/payments`).replyWithError({
        message: 'Unprocessable Entity',
        body: { detail: 'The amount is invalid', field: 'amount' },
      })

      await expect(service.createPayment('abc', 'EUR', 'Bad')).rejects.toThrow()
    })
  })

  describe('listPayments', () => {
    it('sends GET with pagination query params', async () => {
      mock.onGet(`${ BASE }/payments`).reply({
        _embedded: { payments: [{ id: 'tr_1' }] },
        count: 1,
        _links: { next: { href: 'https://api.mollie.com/v2/payments?from=tr_2' } },
      })

      const result = await service.listPayments('tr_0', 10)

      expect(mock.history[0].query).toMatchObject({ from: 'tr_0', limit: 10 })
      expect(result.items).toHaveLength(1)
      expect(result.nextCursor).toBe('tr_2')
    })

    it('returns empty items when no payments exist', async () => {
      mock.onGet(`${ BASE }/payments`).reply({
        _embedded: { payments: [] },
        count: 0,
        _links: {},
      })

      const result = await service.listPayments()

      expect(result.items).toEqual([])
      expect(result.count).toBe(0)
      expect(result.nextCursor).toBeNull()
    })
  })

  describe('getPayment', () => {
    it('sends GET with payment ID', async () => {
      mock.onGet(`${ BASE }/payments/tr_123`).reply({ id: 'tr_123', status: 'paid' })

      const result = await service.getPayment('tr_123')

      expect(result).toMatchObject({ id: 'tr_123', status: 'paid' })
    })

    it('resolves embed dropdown choice', async () => {
      mock.onGet(`${ BASE }/payments/tr_123`).reply({ id: 'tr_123' })

      await service.getPayment('tr_123', 'Refunds and Chargebacks')

      expect(mock.history[0].query).toMatchObject({ embed: 'refunds,chargebacks' })
    })
  })

  describe('updatePayment', () => {
    it('sends PATCH with updated fields', async () => {
      mock.onPatch(`${ BASE }/payments/tr_123`).reply({ id: 'tr_123', description: 'Updated' })

      const result = await service.updatePayment('tr_123', 'Updated', 'https://new.url')

      expect(mock.history[0].body).toMatchObject({
        description: 'Updated',
        redirectUrl: 'https://new.url',
      })
      expect(result.description).toBe('Updated')
    })
  })

  describe('cancelPayment', () => {
    it('sends DELETE with payment ID', async () => {
      mock.onDelete(`${ BASE }/payments/tr_123`).reply({ id: 'tr_123', status: 'canceled' })

      const result = await service.cancelPayment('tr_123')

      expect(mock.history[0].method).toBe('delete')
      expect(result.status).toBe('canceled')
    })
  })

  // ── Refunds ──

  describe('createRefund', () => {
    it('sends POST with specified amount', async () => {
      mock.onPost(`${ BASE }/payments/tr_123/refunds`).reply({
        resource: 'refund',
        id: 're_1',
        amount: { currency: 'EUR', value: '5.00' },
      })

      const result = await service.createRefund('tr_123', '5.00', 'EUR', 'Partial refund')

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].body).toMatchObject({
        amount: { currency: 'EUR', value: '5.00' },
        description: 'Partial refund',
      })
      expect(result.id).toBe('re_1')
    })

    it('fetches payment to get amountRemaining when no amount provided', async () => {
      mock.onGet(`${ BASE }/payments/tr_123`).reply({
        id: 'tr_123',
        amount: { currency: 'EUR', value: '20.00' },
        amountRemaining: { currency: 'EUR', value: '15.00' },
      })
      mock.onPost(`${ BASE }/payments/tr_123/refunds`).reply({
        resource: 'refund',
        id: 're_2',
      })

      await service.createRefund('tr_123')

      expect(mock.history).toHaveLength(2)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[1].body).toMatchObject({
        amount: { currency: 'EUR', value: '15.00' },
      })
    })

    it('falls back to payment.amount when amountRemaining is absent', async () => {
      mock.onGet(`${ BASE }/payments/tr_123`).reply({
        id: 'tr_123',
        amount: { currency: 'EUR', value: '20.00' },
      })
      mock.onPost(`${ BASE }/payments/tr_123/refunds`).reply({
        resource: 'refund',
        id: 're_3',
      })

      await service.createRefund('tr_123')

      expect(mock.history[1].body).toMatchObject({
        amount: { currency: 'EUR', value: '20.00' },
      })
    })
  })

  describe('listPaymentRefunds', () => {
    it('sends GET with payment ID and pagination', async () => {
      mock.onGet(`${ BASE }/payments/tr_123/refunds`).reply({
        _embedded: { refunds: [{ id: 're_1' }] },
        count: 1,
        _links: {},
      })

      const result = await service.listPaymentRefunds('tr_123', undefined, 5)

      expect(mock.history[0].url).toBe(`${ BASE }/payments/tr_123/refunds`)
      expect(result.items).toHaveLength(1)
    })
  })

  describe('getRefund', () => {
    it('sends GET with payment and refund IDs', async () => {
      mock.onGet(`${ BASE }/payments/tr_123/refunds/re_456`).reply({
        id: 're_456',
        status: 'refunded',
      })

      const result = await service.getRefund('tr_123', 're_456')

      expect(result.id).toBe('re_456')
    })
  })

  describe('cancelRefund', () => {
    it('sends DELETE and returns confirmation object', async () => {
      mock.onDelete(`${ BASE }/payments/tr_123/refunds/re_456`).reply({})

      const result = await service.cancelRefund('tr_123', 're_456')

      expect(result).toEqual({ canceled: true, paymentId: 'tr_123', refundId: 're_456' })
    })
  })

  describe('listAllRefunds', () => {
    it('sends GET to /refunds with pagination', async () => {
      mock.onGet(`${ BASE }/refunds`).reply({
        _embedded: { refunds: [] },
        count: 0,
        _links: {},
      })

      const result = await service.listAllRefunds(undefined, 50)

      expect(mock.history[0].url).toBe(`${ BASE }/refunds`)
      expect(result.items).toEqual([])
    })
  })

  // ── Chargebacks ──

  describe('listPaymentChargebacks', () => {
    it('sends GET with payment ID', async () => {
      mock.onGet(`${ BASE }/payments/tr_123/chargebacks`).reply({
        _embedded: { chargebacks: [{ id: 'chb_1' }] },
        count: 1,
        _links: {},
      })

      const result = await service.listPaymentChargebacks('tr_123')

      expect(result.items).toHaveLength(1)
    })
  })

  describe('getChargeback', () => {
    it('sends GET with payment and chargeback IDs', async () => {
      mock.onGet(`${ BASE }/payments/tr_123/chargebacks/chb_456`).reply({
        id: 'chb_456',
      })

      const result = await service.getChargeback('tr_123', 'chb_456')

      expect(result.id).toBe('chb_456')
    })
  })

  describe('listAllChargebacks', () => {
    it('sends GET to /chargebacks', async () => {
      mock.onGet(`${ BASE }/chargebacks`).reply({
        _embedded: { chargebacks: [] },
        count: 0,
        _links: {},
      })

      const result = await service.listAllChargebacks()

      expect(result.items).toEqual([])
    })
  })

  // ── Captures ──

  describe('createCapture', () => {
    it('sends POST with amount', async () => {
      mock.onPost(`${ BASE }/payments/tr_123/captures`).reply({
        resource: 'capture',
        id: 'cpt_1',
      })

      await service.createCapture('tr_123', '35.95', 'EUR', 'Full capture')

      expect(mock.history[0].body).toMatchObject({
        amount: { currency: 'EUR', value: '35.95' },
        description: 'Full capture',
      })
    })

    it('omits amount when not provided (full capture)', async () => {
      mock.onPost(`${ BASE }/payments/tr_123/captures`).reply({
        resource: 'capture',
        id: 'cpt_2',
      })

      await service.createCapture('tr_123')

      expect(mock.history[0].body).not.toHaveProperty('amount')
    })
  })

  describe('listCaptures', () => {
    it('sends GET to captures endpoint', async () => {
      mock.onGet(`${ BASE }/payments/tr_123/captures`).reply({
        _embedded: { captures: [{ id: 'cpt_1' }] },
        count: 1,
        _links: {},
      })

      const result = await service.listCaptures('tr_123')

      expect(result.items).toHaveLength(1)
    })
  })

  describe('getCapture', () => {
    it('sends GET with payment and capture IDs', async () => {
      mock.onGet(`${ BASE }/payments/tr_123/captures/cpt_456`).reply({
        id: 'cpt_456',
      })

      const result = await service.getCapture('tr_123', 'cpt_456')

      expect(result.id).toBe('cpt_456')
    })
  })

  // ── Payment Links ──

  describe('createPaymentLink', () => {
    it('sends POST with description and amount', async () => {
      mock.onPost(`${ BASE }/payment-links`).reply({
        resource: 'payment-link',
        id: 'pl_123',
        _links: { paymentLink: { href: 'https://paymentlink.mollie.com/payment/123/' } },
      })

      const result = await service.createPaymentLink('Tires', '24.95', 'EUR')

      expect(mock.history[0].body).toMatchObject({
        description: 'Tires',
        amount: { currency: 'EUR', value: '24.95' },
      })
      expect(result.paymentLinkUrl).toBe('https://paymentlink.mollie.com/payment/123/')
    })

    it('sends POST without amount for open-amount link', async () => {
      mock.onPost(`${ BASE }/payment-links`).reply({
        resource: 'payment-link',
        id: 'pl_open',
        _links: {},
      })

      await service.createPaymentLink('Donation')

      expect(mock.history[0].body).not.toHaveProperty('amount')
    })

    it('includes minimumAmount when provided', async () => {
      mock.onPost(`${ BASE }/payment-links`).reply({
        resource: 'payment-link',
        id: 'pl_min',
        _links: {},
      })

      await service.createPaymentLink('Donation', undefined, 'EUR', '5.00')

      expect(mock.history[0].body).toMatchObject({
        minimumAmount: { currency: 'EUR', value: '5.00' },
      })
    })
  })

  describe('listPaymentLinks', () => {
    it('sends GET with pagination', async () => {
      mock.onGet(`${ BASE }/payment-links`).reply({
        _embedded: { payment_links: [{ id: 'pl_1' }] },
        count: 1,
        _links: {},
      })

      const result = await service.listPaymentLinks()

      expect(result.items).toHaveLength(1)
    })
  })

  describe('getPaymentLink', () => {
    it('sends GET and returns paymentLinkUrl', async () => {
      mock.onGet(`${ BASE }/payment-links/pl_123`).reply({
        id: 'pl_123',
        _links: { paymentLink: { href: 'https://paymentlink.mollie.com/payment/123/' } },
      })

      const result = await service.getPaymentLink('pl_123')

      expect(result.paymentLinkUrl).toBe('https://paymentlink.mollie.com/payment/123/')
    })
  })

  describe('updatePaymentLink', () => {
    it('sends PATCH with updated fields', async () => {
      mock.onPatch(`${ BASE }/payment-links/pl_123`).reply({
        id: 'pl_123',
        archived: true,
      })

      const result = await service.updatePaymentLink('pl_123', 'Updated', true)

      expect(mock.history[0].body).toMatchObject({ description: 'Updated', archived: true })
      expect(result.archived).toBe(true)
    })
  })

  describe('deletePaymentLink', () => {
    it('sends DELETE and returns confirmation', async () => {
      mock.onDelete(`${ BASE }/payment-links/pl_123`).reply({})

      const result = await service.deletePaymentLink('pl_123')

      expect(result).toEqual({ deleted: true, paymentLinkId: 'pl_123' })
    })
  })

  describe('listPaymentLinkPayments', () => {
    it('sends GET to payment link payments endpoint', async () => {
      mock.onGet(`${ BASE }/payment-links/pl_123/payments`).reply({
        _embedded: { payments: [{ id: 'tr_1' }] },
        count: 1,
        _links: {},
      })

      const result = await service.listPaymentLinkPayments('pl_123')

      expect(result.items).toHaveLength(1)
    })
  })

  // ── Customers ──

  describe('createCustomer', () => {
    it('sends POST with customer data', async () => {
      mock.onPost(`${ BASE }/customers`).reply({
        resource: 'customer',
        id: 'cst_1',
        name: 'Jane Doe',
      })

      await service.createCustomer('Jane Doe', 'jane@example.org', 'English (US)', { crmId: '123' })

      expect(mock.history[0].body).toMatchObject({
        name: 'Jane Doe',
        email: 'jane@example.org',
        locale: 'en_US',
        metadata: { crmId: '123' },
      })
    })

    it('omits optional fields', async () => {
      mock.onPost(`${ BASE }/customers`).reply({ id: 'cst_2' })

      await service.createCustomer('Bob')

      const body = mock.history[0].body

      expect(body).toMatchObject({ name: 'Bob' })
      expect(body).not.toHaveProperty('email')
      expect(body).not.toHaveProperty('locale')
    })
  })

  describe('listCustomers', () => {
    it('sends GET with pagination', async () => {
      mock.onGet(`${ BASE }/customers`).reply({
        _embedded: { customers: [{ id: 'cst_1' }] },
        count: 1,
        _links: {},
      })

      const result = await service.listCustomers(undefined, 25)

      expect(result.items).toHaveLength(1)
    })
  })

  describe('getCustomer', () => {
    it('sends GET with customer ID', async () => {
      mock.onGet(`${ BASE }/customers/cst_123`).reply({ id: 'cst_123', name: 'Jane' })

      const result = await service.getCustomer('cst_123')

      expect(result.name).toBe('Jane')
    })
  })

  describe('updateCustomer', () => {
    it('sends PATCH with updated fields', async () => {
      mock.onPatch(`${ BASE }/customers/cst_123`).reply({ id: 'cst_123', name: 'Jane Smith' })

      await service.updateCustomer('cst_123', 'Jane Smith', 'jane.smith@example.org')

      expect(mock.history[0].body).toMatchObject({
        name: 'Jane Smith',
        email: 'jane.smith@example.org',
      })
    })
  })

  describe('deleteCustomer', () => {
    it('sends DELETE and returns confirmation', async () => {
      mock.onDelete(`${ BASE }/customers/cst_123`).reply({})

      const result = await service.deleteCustomer('cst_123')

      expect(result).toEqual({ deleted: true, customerId: 'cst_123' })
    })
  })

  describe('listCustomerPayments', () => {
    it('sends GET to customer payments endpoint', async () => {
      mock.onGet(`${ BASE }/customers/cst_123/payments`).reply({
        _embedded: { payments: [] },
        count: 0,
        _links: {},
      })

      const result = await service.listCustomerPayments('cst_123')

      expect(result.items).toEqual([])
    })
  })

  describe('createCustomerPayment', () => {
    it('sends POST with customer payment data, defaults sequenceType to recurring', async () => {
      mock.onPost(`${ BASE }/customers/cst_123/payments`).reply({
        resource: 'payment',
        id: 'tr_cust',
        _links: {},
      })

      await service.createCustomerPayment('cst_123', '25', 'EUR', 'Monthly charge')

      expect(mock.history[0].body).toMatchObject({
        amount: { currency: 'EUR', value: '25.00' },
        description: 'Monthly charge',
        sequenceType: 'recurring',
      })
    })

    it('resolves sequenceType dropdown choice', async () => {
      mock.onPost(`${ BASE }/customers/cst_123/payments`).reply({
        resource: 'payment',
        id: 'tr_first',
        _links: { checkout: { href: 'https://checkout.url' } },
      })

      const result = await service.createCustomerPayment('cst_123', '10', 'EUR', 'First payment', 'First', undefined, 'https://redirect.url')

      expect(mock.history[0].body.sequenceType).toBe('first')
      expect(result.checkoutUrl).toBe('https://checkout.url')
    })
  })

  // ── Mandates ──

  describe('createMandate', () => {
    it('sends POST with SEPA mandate data', async () => {
      mock.onPost(`${ BASE }/customers/cst_123/mandates`).reply({
        resource: 'mandate',
        id: 'mdt_1',
        method: 'directdebit',
      })

      await service.createMandate(
        'cst_123', 'SEPA Direct Debit', 'Jane Doe',
        'NL55INGB0000000000', 'INGBNL2A'
      )

      expect(mock.history[0].body).toMatchObject({
        method: 'directdebit',
        consumerName: 'Jane Doe',
        consumerAccount: 'NL55INGB0000000000',
        consumerBic: 'INGBNL2A',
      })
    })

    it('sends POST with PayPal mandate data', async () => {
      mock.onPost(`${ BASE }/customers/cst_123/mandates`).reply({
        resource: 'mandate',
        id: 'mdt_2',
        method: 'paypal',
      })

      await service.createMandate(
        'cst_123', 'PayPal', 'Jane Doe',
        undefined, undefined, 'jane@paypal.com', 'B-123'
      )

      expect(mock.history[0].body).toMatchObject({
        method: 'paypal',
        consumerName: 'Jane Doe',
        consumerEmail: 'jane@paypal.com',
        paypalBillingAgreementId: 'B-123',
      })
    })
  })

  describe('listMandates', () => {
    it('sends GET to mandates endpoint', async () => {
      mock.onGet(`${ BASE }/customers/cst_123/mandates`).reply({
        _embedded: { mandates: [{ id: 'mdt_1' }] },
        count: 1,
        _links: {},
      })

      const result = await service.listMandates('cst_123')

      expect(result.items).toHaveLength(1)
    })
  })

  describe('getMandate', () => {
    it('sends GET with customer and mandate IDs', async () => {
      mock.onGet(`${ BASE }/customers/cst_123/mandates/mdt_456`).reply({
        id: 'mdt_456',
        status: 'valid',
      })

      const result = await service.getMandate('cst_123', 'mdt_456')

      expect(result.status).toBe('valid')
    })
  })

  describe('revokeMandate', () => {
    it('sends DELETE and returns confirmation', async () => {
      mock.onDelete(`${ BASE }/customers/cst_123/mandates/mdt_456`).reply({})

      const result = await service.revokeMandate('cst_123', 'mdt_456')

      expect(result).toEqual({ revoked: true, customerId: 'cst_123', mandateId: 'mdt_456' })
    })
  })

  // ── Subscriptions ──

  describe('createSubscription', () => {
    it('sends POST with subscription data', async () => {
      mock.onPost(`${ BASE }/customers/cst_123/subscriptions`).reply({
        resource: 'subscription',
        id: 'sub_1',
        status: 'active',
      })

      await service.createSubscription(
        'cst_123', '25', 'EUR', '1 month', 'Monthly plan',
        12, '2026-08-01', 'Credit Card'
      )

      expect(mock.history[0].body).toMatchObject({
        amount: { currency: 'EUR', value: '25.00' },
        interval: '1 month',
        description: 'Monthly plan',
        times: 12,
        startDate: '2026-08-01',
        method: 'creditcard',
      })
    })
  })

  describe('listCustomerSubscriptions', () => {
    it('sends GET to customer subscriptions', async () => {
      mock.onGet(`${ BASE }/customers/cst_123/subscriptions`).reply({
        _embedded: { subscriptions: [] },
        count: 0,
        _links: {},
      })

      const result = await service.listCustomerSubscriptions('cst_123')

      expect(result.items).toEqual([])
    })
  })

  describe('listAllSubscriptions', () => {
    it('sends GET to /subscriptions', async () => {
      mock.onGet(`${ BASE }/subscriptions`).reply({
        _embedded: { subscriptions: [{ id: 'sub_1' }] },
        count: 1,
        _links: {},
      })

      const result = await service.listAllSubscriptions()

      expect(result.items).toHaveLength(1)
    })
  })

  describe('getSubscription', () => {
    it('sends GET with customer and subscription IDs', async () => {
      mock.onGet(`${ BASE }/customers/cst_123/subscriptions/sub_456`).reply({
        id: 'sub_456',
        status: 'active',
      })

      const result = await service.getSubscription('cst_123', 'sub_456')

      expect(result.status).toBe('active')
    })
  })

  describe('updateSubscription', () => {
    it('sends PATCH with updated fields', async () => {
      mock.onPatch(`${ BASE }/customers/cst_123/subscriptions/sub_456`).reply({
        id: 'sub_456',
        amount: { currency: 'EUR', value: '30.00' },
      })

      await service.updateSubscription('cst_123', 'sub_456', '30', 'EUR', '1 month', 'Upgraded')

      expect(mock.history[0].body).toMatchObject({
        amount: { currency: 'EUR', value: '30.00' },
        interval: '1 month',
        description: 'Upgraded',
      })
    })
  })

  describe('cancelSubscription', () => {
    it('sends DELETE to subscription endpoint', async () => {
      mock.onDelete(`${ BASE }/customers/cst_123/subscriptions/sub_456`).reply({
        id: 'sub_456',
        status: 'canceled',
      })

      const result = await service.cancelSubscription('cst_123', 'sub_456')

      expect(result.status).toBe('canceled')
    })
  })

  describe('listSubscriptionPayments', () => {
    it('sends GET to subscription payments endpoint', async () => {
      mock.onGet(`${ BASE }/customers/cst_123/subscriptions/sub_456/payments`).reply({
        _embedded: { payments: [{ id: 'tr_1' }] },
        count: 1,
        _links: {},
      })

      const result = await service.listSubscriptionPayments('cst_123', 'sub_456')

      expect(result.items).toHaveLength(1)
    })
  })

  // ── Payment Methods ──

  describe('listEnabledMethods', () => {
    it('sends GET to /methods with query params', async () => {
      mock.onGet(`${ BASE }/methods`).reply({
        _embedded: { methods: [{ id: 'ideal', description: 'iDEAL' }] },
        count: 1,
        _links: {},
      })

      await service.listEnabledMethods('100', 'EUR', 'Dutch (Netherlands)', 'Recurring', 'Payments', true, 'NL')

      expect(mock.history[0].query).toMatchObject({
        'amount[value]': '100.00',
        'amount[currency]': 'EUR',
        locale: 'nl_NL',
        sequenceType: 'recurring',
        resource: 'payments',
        includeWallets: 'applepay',
        billingCountry: 'NL',
      })
    })

    it('omits amount fields when no amount provided', async () => {
      mock.onGet(`${ BASE }/methods`).reply({
        _embedded: { methods: [] },
        count: 0,
        _links: {},
      })

      await service.listEnabledMethods()

      const query = mock.history[0].query

      expect(query).not.toHaveProperty('amount[value]')
      expect(query).not.toHaveProperty('amount[currency]')
    })
  })

  describe('listAllMethods', () => {
    it('sends GET to /methods/all', async () => {
      mock.onGet(`${ BASE }/methods/all`).reply({
        _embedded: { methods: [{ id: 'ideal' }, { id: 'creditcard' }] },
        count: 2,
        _links: {},
      })

      const result = await service.listAllMethods()

      expect(result.items).toHaveLength(2)
    })

    it('includes pricing when requested', async () => {
      mock.onGet(`${ BASE }/methods/all`).reply({
        _embedded: { methods: [] },
        count: 0,
        _links: {},
      })

      await service.listAllMethods(undefined, true)

      expect(mock.history[0].query).toMatchObject({ include: 'pricing' })
    })
  })

  describe('getMethod', () => {
    it('sends GET with method ID', async () => {
      mock.onGet(`${ BASE }/methods/ideal`).reply({ id: 'ideal', description: 'iDEAL' })

      const result = await service.getMethod('ideal')

      expect(result.id).toBe('ideal')
    })

    it('includes issuers when requested', async () => {
      mock.onGet(`${ BASE }/methods/ideal`).reply({ id: 'ideal' })

      await service.getMethod('ideal', true)

      expect(mock.history[0].query).toMatchObject({ include: 'issuers' })
    })
  })

  // ── Balances ──

  describe('listBalances', () => {
    it('sends GET to /balances', async () => {
      mock.onGet(`${ BASE }/balances`).reply({
        _embedded: { balances: [{ id: 'bal_1' }] },
        count: 1,
        _links: {},
      })

      const result = await service.listBalances()

      expect(result.items).toHaveLength(1)
    })
  })

  describe('getBalance', () => {
    it('sends GET with balance ID', async () => {
      mock.onGet(`${ BASE }/balances/primary`).reply({ id: 'bal_1', currency: 'EUR' })

      const result = await service.getBalance('primary')

      expect(result.currency).toBe('EUR')
    })
  })

  describe('getBalanceReport', () => {
    it('sends GET with date range and grouping', async () => {
      mock.onGet(`${ BASE }/balances/bal_1/report`).reply({
        resource: 'balance-report',
        grouping: 'status-balances',
      })

      await service.getBalanceReport('bal_1', '2026-07-01', '2026-07-15', 'Transaction Categories')

      expect(mock.history[0].query).toMatchObject({
        from: '2026-07-01',
        until: '2026-07-15',
        grouping: 'transaction-categories',
      })
    })
  })

  describe('listBalanceTransactions', () => {
    it('sends GET to balance transactions endpoint', async () => {
      mock.onGet(`${ BASE }/balances/bal_1/transactions`).reply({
        _embedded: { balance_transactions: [{ id: 'baltr_1' }] },
        count: 1,
        _links: {},
      })

      const result = await service.listBalanceTransactions('bal_1')

      expect(result.items).toHaveLength(1)
    })
  })

  // ── Settlements ──

  describe('listSettlements', () => {
    it('sends GET to /settlements', async () => {
      mock.onGet(`${ BASE }/settlements`).reply({
        _embedded: { settlements: [{ id: 'stl_1' }] },
        count: 1,
        _links: {},
      })

      const result = await service.listSettlements()

      expect(result.items).toHaveLength(1)
    })
  })

  describe('getSettlement', () => {
    it('sends GET with settlement ID', async () => {
      mock.onGet(`${ BASE }/settlements/stl_123`).reply({ id: 'stl_123', status: 'paidout' })

      const result = await service.getSettlement('stl_123')

      expect(result.status).toBe('paidout')
    })
  })

  describe('listSettlementPayments', () => {
    it('sends GET to settlement payments endpoint', async () => {
      mock.onGet(`${ BASE }/settlements/stl_123/payments`).reply({
        _embedded: { payments: [] },
        count: 0,
        _links: {},
      })

      const result = await service.listSettlementPayments('stl_123')

      expect(result.items).toEqual([])
    })
  })

  // ── Invoices ──

  describe('listInvoices', () => {
    it('sends GET to /invoices', async () => {
      mock.onGet(`${ BASE }/invoices`).reply({
        _embedded: { invoices: [{ id: 'inv_1' }] },
        count: 1,
        _links: {},
      })

      const result = await service.listInvoices()

      expect(result.items).toHaveLength(1)
    })
  })

  describe('getInvoice', () => {
    it('sends GET with invoice ID', async () => {
      mock.onGet(`${ BASE }/invoices/inv_123`).reply({ id: 'inv_123', status: 'open' })

      const result = await service.getInvoice('inv_123')

      expect(result.status).toBe('open')
    })
  })

  // ── Profiles ──

  describe('listProfiles', () => {
    it('sends GET to /profiles', async () => {
      mock.onGet(`${ BASE }/profiles`).reply({
        _embedded: { profiles: [{ id: 'pfl_1' }] },
        count: 1,
        _links: {},
      })

      const result = await service.listProfiles()

      expect(result.items).toHaveLength(1)
    })
  })

  describe('getProfile', () => {
    it('sends GET with profile ID', async () => {
      mock.onGet(`${ BASE }/profiles/me`).reply({ id: 'pfl_1', name: 'My Site' })

      const result = await service.getProfile('me')

      expect(result.name).toBe('My Site')
    })
  })

  // ── Terminals ──

  describe('listTerminals', () => {
    it('sends GET to /terminals', async () => {
      mock.onGet(`${ BASE }/terminals`).reply({
        _embedded: { terminals: [{ id: 'term_1' }] },
        count: 1,
        _links: {},
      })

      const result = await service.listTerminals()

      expect(result.items).toHaveLength(1)
    })
  })

  describe('getTerminal', () => {
    it('sends GET with terminal ID', async () => {
      mock.onGet(`${ BASE }/terminals/term_123`).reply({ id: 'term_123', status: 'active' })

      const result = await service.getTerminal('term_123')

      expect(result.status).toBe('active')
    })
  })

  // ── Dictionaries ──

  describe('getCustomersDictionary', () => {
    it('returns formatted items from customer list', async () => {
      mock.onGet(`${ BASE }/customers`).reply({
        _embedded: {
          customers: [
            { id: 'cst_1', name: 'Jane Doe', email: 'jane@example.org' },
            { id: 'cst_2', name: 'Bob Smith', email: 'bob@example.org' },
          ],
        },
        count: 2,
        _links: {},
      })

      const result = await service.getCustomersDictionary({})

      expect(result.items).toEqual([
        { label: 'Jane Doe', value: 'cst_1', note: 'jane@example.org' },
        { label: 'Bob Smith', value: 'cst_2', note: 'bob@example.org' },
      ])
    })

    it('filters by search text (case insensitive)', async () => {
      mock.onGet(`${ BASE }/customers`).reply({
        _embedded: {
          customers: [
            { id: 'cst_1', name: 'Jane Doe', email: 'jane@example.org' },
            { id: 'cst_2', name: 'Bob Smith', email: 'bob@example.org' },
          ],
        },
        count: 2,
        _links: {},
      })

      const result = await service.getCustomersDictionary({ search: 'jane' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('cst_1')
    })

    it('uses cursor for pagination', async () => {
      mock.onGet(`${ BASE }/customers`).reply({
        _embedded: { customers: [{ id: 'cst_3', name: 'Alice' }] },
        count: 1,
        _links: { next: { href: 'https://api.mollie.com/v2/customers?from=cst_4' } },
      })

      const result = await service.getCustomersDictionary({ cursor: 'cst_3' })

      expect(mock.history[0].query).toMatchObject({ from: 'cst_3', limit: 250 })
      expect(result.cursor).toBe('cst_4')
    })

    it('falls back to email or id for label', async () => {
      mock.onGet(`${ BASE }/customers`).reply({
        _embedded: {
          customers: [
            { id: 'cst_noname', email: 'noname@example.org' },
            { id: 'cst_nothing' },
          ],
        },
        count: 2,
        _links: {},
      })

      const result = await service.getCustomersDictionary({})

      expect(result.items[0].label).toBe('noname@example.org')
      expect(result.items[1].label).toBe('cst_nothing')
    })
  })

  describe('getPaymentMethodsDictionary', () => {
    it('returns formatted items from all methods', async () => {
      mock.onGet(`${ BASE }/methods/all`).reply({
        _embedded: {
          methods: [
            { id: 'ideal', description: 'iDEAL', status: 'activated' },
            { id: 'creditcard', description: 'Card', status: 'activated' },
          ],
        },
        count: 2,
        _links: {},
      })

      const result = await service.getPaymentMethodsDictionary({})

      expect(result.items).toEqual([
        { label: 'iDEAL', value: 'ideal', note: 'activated' },
        { label: 'Card', value: 'creditcard', note: 'activated' },
      ])
      expect(result.cursor).toBeNull()
    })

    it('filters by search text', async () => {
      mock.onGet(`${ BASE }/methods/all`).reply({
        _embedded: {
          methods: [
            { id: 'ideal', description: 'iDEAL', status: 'activated' },
            { id: 'creditcard', description: 'Card', status: 'activated' },
          ],
        },
        count: 2,
        _links: {},
      })

      const result = await service.getPaymentMethodsDictionary({ search: 'ideal' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('ideal')
    })
  })

  describe('getProfilesDictionary', () => {
    it('returns formatted items from profiles', async () => {
      mock.onGet(`${ BASE }/profiles`).reply({
        _embedded: {
          profiles: [
            { id: 'pfl_1', name: 'My Site', website: 'https://example.org' },
          ],
        },
        count: 1,
        _links: {},
      })

      const result = await service.getProfilesDictionary({})

      expect(result.items).toEqual([
        { label: 'My Site', value: 'pfl_1', note: 'https://example.org' },
      ])
    })

    it('filters by search text on name and website', async () => {
      mock.onGet(`${ BASE }/profiles`).reply({
        _embedded: {
          profiles: [
            { id: 'pfl_1', name: 'My Site', website: 'https://example.org' },
            { id: 'pfl_2', name: 'Other', website: 'https://other.com' },
          ],
        },
        count: 2,
        _links: {},
      })

      const result = await service.getProfilesDictionary({ search: 'example' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('pfl_1')
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('wraps API error detail into thrown error message', async () => {
      mock.onGet(`${ BASE }/payments/tr_bad`).replyWithError({
        message: 'Not Found',
        body: { detail: 'The payment id is invalid', field: 'paymentId' },
      })

      await expect(service.getPayment('tr_bad')).rejects.toThrow(
        'Mollie API error: The payment id is invalid (field: paymentId)'
      )
    })

    it('uses title when detail is absent', async () => {
      mock.onGet(`${ BASE }/payments/tr_bad`).replyWithError({
        message: 'Unauthorized',
        body: { title: 'Unauthorized Request' },
      })

      await expect(service.getPayment('tr_bad')).rejects.toThrow(
        'Mollie API error: Unauthorized Request'
      )
    })

    it('falls back to error.message when body has no detail or title', async () => {
      mock.onGet(`${ BASE }/payments/tr_bad`).replyWithError({
        message: 'Network Error',
      })

      await expect(service.getPayment('tr_bad')).rejects.toThrow(
        'Mollie API error: Network Error'
      )
    })

    it('throws on invalid amount value', async () => {
      await expect(
        service.createPayment('not-a-number', 'EUR', 'Bad amount', 'https://r.com')
      ).rejects.toThrow('invalid amount value')
    })
  })
})
