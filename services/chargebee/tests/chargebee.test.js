'use strict'

const { createSandbox } = require('../../../service-sandbox')

const SITE = 'acme-test'
const API_KEY = 'test_api_key_123'
const BASE = `https://${ SITE }.chargebee.com/api/v2`
const AUTH = `Basic ${ Buffer.from(`${ API_KEY }:`).toString('base64') }`

/**
 * The service sends POST/PUT bodies as an application/x-www-form-urlencoded
 * string (via #encodeForm). Decode it back to a plain object so assertions
 * read naturally. All values come back as strings — that's the wire format.
 */
function decodeForm(body) {
  const out = {}

  if (body === undefined || body === '') {
    return out
  }

  for (const pair of body.split('&')) {
    const [key, value] = pair.split('=')
    out[decodeURIComponent(key)] = decodeURIComponent(value || '')
  }

  return out
}

describe('Chargebee Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ site: SITE, apiKey: API_KEY })
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
          name: 'site',
          displayName: 'Site',
          required: true,
          shared: false,
          type: 'STRING',
        }),
        expect.objectContaining({
          name: 'apiKey',
          displayName: 'API Key',
          required: true,
          shared: false,
          type: 'STRING',
        }),
      ])
    })

    it('sends HTTP Basic auth header on requests', async () => {
      mock.onGet(`${ BASE }/customers`).reply({ list: [] })

      await service.listCustomers()

      expect(mock.history[0].headers).toMatchObject({ 'Authorization': AUTH })
    })

    it('builds the base URL from the configured site', async () => {
      mock.onGet(`${ BASE }/customers/cust_1`).reply({ customer: { id: 'cust_1' } })

      await service.getCustomer('cust_1')

      expect(mock.history[0].url.startsWith(`https://${ SITE }.chargebee.com/api/v2`)).toBe(true)
    })

    it('sets urlencoded Content-Type on write requests', async () => {
      mock.onPost(`${ BASE }/customers`).reply({ customer: { id: 'cust_1' } })

      await service.createCustomer('John')

      expect(mock.history[0].headers).toMatchObject({
        'Authorization': AUTH,
        'Content-Type': 'application/x-www-form-urlencoded',
      })
    })
  })

  // ── Customers ──

  describe('createCustomer', () => {
    it('sends only provided fields', async () => {
      mock.onPost(`${ BASE }/customers`).reply({ customer: { id: 'cust_1' } })

      const result = await service.createCustomer('John')

      expect(result).toEqual({ customer: { id: 'cust_1' } })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/customers`)
      expect(decodeForm(mock.history[0].body)).toEqual({ first_name: 'John' })
    })

    it('includes all params and flattens the billing address object', async () => {
      mock.onPost(`${ BASE }/customers`).reply({ customer: { id: 'cust_2' } })

      await service.createCustomer('John', 'Doe', 'john@example.com', 'Acme', '+15551234', {
        line1: '1 Main St',
        city: 'Metropolis',
        country: 'US',
      })

      expect(decodeForm(mock.history[0].body)).toEqual({
        first_name: 'John',
        last_name: 'Doe',
        email: 'john@example.com',
        company: 'Acme',
        phone: '+15551234',
        'billing_address[line1]': '1 Main St',
        'billing_address[city]': 'Metropolis',
        'billing_address[country]': 'US',
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/customers`).replyWithError({
        message: 'Bad Request',
        body: { message: 'email is invalid', api_error_code: 'invalid_request', error_code: 'invalid' },
      })

      await expect(service.createCustomer('John')).rejects.toThrow(
        'Chargebee API error: email is invalid | api_error_code: invalid_request | error_code: invalid'
      )
    })

    it('falls back to error.message when body has no message', async () => {
      mock.onPost(`${ BASE }/customers`).replyWithError({ message: 'Network down', body: {} })

      await expect(service.createCustomer('John')).rejects.toThrow('Chargebee API error: Network down')
    })
  })

  describe('listCustomers', () => {
    it('uses the default limit and omits empty filters', async () => {
      mock.onGet(`${ BASE }/customers`).reply({ list: [], next_offset: null })

      const result = await service.listCustomers()

      expect(result).toEqual({ list: [], next_offset: null })
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].query).toEqual({ limit: '20' })
    })

    it('passes email filter, custom limit and offset', async () => {
      mock.onGet(`${ BASE }/customers`).reply({ list: [] })

      await service.listCustomers('john@example.com', 50, 'offset_token')

      expect(mock.history[0].query).toEqual({
        'email[is]': 'john@example.com',
        limit: '50',
        offset: 'offset_token',
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/customers`).replyWithError({
        message: 'Unauthorized',
        body: { message: 'api key invalid', api_error_code: 'api_authentication_failed' },
      })

      await expect(service.listCustomers()).rejects.toThrow(
        'Chargebee API error: api key invalid | api_error_code: api_authentication_failed'
      )
    })
  })

  describe('getCustomer', () => {
    it('encodes the customer id in the path', async () => {
      mock.onGet(`${ BASE }/customers/cust%2F1`).reply({ customer: { id: 'cust/1' } })

      const result = await service.getCustomer('cust/1')

      expect(result).toEqual({ customer: { id: 'cust/1' } })
      expect(mock.history[0].url).toBe(`${ BASE }/customers/cust%2F1`)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/customers/missing`).replyWithError({
        message: 'Not Found',
        body: { error_code: 'resource_not_found' },
      })

      await expect(service.getCustomer('missing')).rejects.toThrow(
        'Chargebee API error: Not Found | error_code: resource_not_found'
      )
    })
  })

  describe('updateCustomer', () => {
    it('sends an empty body when no fields change', async () => {
      mock.onPost(`${ BASE }/customers/cust_1`).reply({ customer: { id: 'cust_1' } })

      await service.updateCustomer('cust_1')

      expect(mock.history[0].url).toBe(`${ BASE }/customers/cust_1`)
      expect(decodeForm(mock.history[0].body)).toEqual({})
    })

    it('sends the changed fields', async () => {
      mock.onPost(`${ BASE }/customers/cust_1`).reply({ customer: { id: 'cust_1' } })

      await service.updateCustomer('cust_1', 'Jane', 'Roe', 'jane@example.com', 'NewCo', '+15559999')

      expect(decodeForm(mock.history[0].body)).toEqual({
        first_name: 'Jane',
        last_name: 'Roe',
        email: 'jane@example.com',
        company: 'NewCo',
        phone: '+15559999',
      })
    })
  })

  describe('deleteCustomer', () => {
    it('posts to the delete endpoint', async () => {
      mock.onPost(`${ BASE }/customers/cust_1/delete`).reply({ customer: { id: 'cust_1', deleted: true } })

      const result = await service.deleteCustomer('cust_1')

      expect(result).toEqual({ customer: { id: 'cust_1', deleted: true } })
      expect(mock.history[0].url).toBe(`${ BASE }/customers/cust_1/delete`)
      expect(decodeForm(mock.history[0].body)).toEqual({})
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/customers/cust_1/delete`).replyWithError({
        message: 'Conflict',
        body: { message: 'customer has active subscriptions' },
      })

      await expect(service.deleteCustomer('cust_1')).rejects.toThrow(
        'Chargebee API error: customer has active subscriptions'
      )
    })
  })

  // ── Subscriptions ──

  describe('createSubscription', () => {
    it('transposes the subscription_items array of objects', async () => {
      mock
        .onPost(`${ BASE }/customers/cust_1/subscription_for_items`)
        .reply({ subscription: { id: 'sub_1' } })

      const result = await service.createSubscription('cust_1', [
        { item_price_id: 'basic-USD-monthly', quantity: 1 },
        { item_price_id: 'addon-USD-monthly', quantity: 2 },
      ])

      expect(result).toEqual({ subscription: { id: 'sub_1' } })
      expect(mock.history[0].url).toBe(`${ BASE }/customers/cust_1/subscription_for_items`)
      expect(decodeForm(mock.history[0].body)).toEqual({
        'subscription_items[item_price_id][0]': 'basic-USD-monthly',
        'subscription_items[quantity][0]': '1',
        'subscription_items[item_price_id][1]': 'addon-USD-monthly',
        'subscription_items[quantity][1]': '2',
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock
        .onPost(`${ BASE }/customers/cust_1/subscription_for_items`)
        .replyWithError({ message: 'Payment required', body: { error_code: 'payment_required' } })

      await expect(
        service.createSubscription('cust_1', [{ item_price_id: 'basic-USD-monthly' }])
      ).rejects.toThrow('Chargebee API error: Payment required | error_code: payment_required')
    })
  })

  describe('getSubscription', () => {
    it('fetches by id', async () => {
      mock.onGet(`${ BASE }/subscriptions/sub_1`).reply({ subscription: { id: 'sub_1' } })

      const result = await service.getSubscription('sub_1')

      expect(result).toEqual({ subscription: { id: 'sub_1' } })
      expect(mock.history[0].url).toBe(`${ BASE }/subscriptions/sub_1`)
    })
  })

  describe('listSubscriptions', () => {
    it('uses default limit and omits empty filters', async () => {
      mock.onGet(`${ BASE }/subscriptions`).reply({ list: [] })

      await service.listSubscriptions()

      expect(mock.history[0].query).toEqual({ limit: '20' })
    })

    it('maps the status choice label to the API value', async () => {
      mock.onGet(`${ BASE }/subscriptions`).reply({ list: [] })

      await service.listSubscriptions('cust_1', 'Non Renewing', 25, 'tok')

      expect(mock.history[0].query).toEqual({
        'customer_id[is]': 'cust_1',
        'status[is]': 'non_renewing',
        limit: '25',
        offset: 'tok',
      })
    })

    it('passes an unknown status through unchanged', async () => {
      mock.onGet(`${ BASE }/subscriptions`).reply({ list: [] })

      await service.listSubscriptions(undefined, 'custom_status')

      expect(mock.history[0].query).toMatchObject({ 'status[is]': 'custom_status' })
    })
  })

  describe('updateSubscription', () => {
    it('transposes the replacement items', async () => {
      mock
        .onPost(`${ BASE }/subscriptions/sub_1/update_for_items`)
        .reply({ subscription: { id: 'sub_1' } })

      await service.updateSubscription('sub_1', [{ item_price_id: 'pro-USD-monthly', quantity: 3 }])

      expect(mock.history[0].url).toBe(`${ BASE }/subscriptions/sub_1/update_for_items`)
      expect(decodeForm(mock.history[0].body)).toEqual({
        'subscription_items[item_price_id][0]': 'pro-USD-monthly',
        'subscription_items[quantity][0]': '3',
      })
    })
  })

  describe('cancelSubscription', () => {
    it('sends an empty body when endOfTerm is not true', async () => {
      mock.onPost(`${ BASE }/subscriptions/sub_1/cancel_for_items`).reply({ subscription: { id: 'sub_1' } })

      await service.cancelSubscription('sub_1')

      expect(mock.history[0].url).toBe(`${ BASE }/subscriptions/sub_1/cancel_for_items`)
      expect(decodeForm(mock.history[0].body)).toEqual({})
    })

    it('sends end_of_term=true when requested', async () => {
      mock.onPost(`${ BASE }/subscriptions/sub_1/cancel_for_items`).reply({ subscription: { id: 'sub_1' } })

      await service.cancelSubscription('sub_1', true)

      expect(decodeForm(mock.history[0].body)).toEqual({ end_of_term: 'true' })
    })

    it('omits end_of_term when endOfTerm is false', async () => {
      mock.onPost(`${ BASE }/subscriptions/sub_1/cancel_for_items`).reply({ subscription: { id: 'sub_1' } })

      await service.cancelSubscription('sub_1', false)

      expect(decodeForm(mock.history[0].body)).toEqual({})
    })
  })

  describe('pauseSubscription', () => {
    it('sends an empty body when no option is given', async () => {
      mock.onPost(`${ BASE }/subscriptions/sub_1/pause`).reply({ subscription: { id: 'sub_1' } })

      await service.pauseSubscription('sub_1')

      expect(mock.history[0].url).toBe(`${ BASE }/subscriptions/sub_1/pause`)
      expect(decodeForm(mock.history[0].body)).toEqual({})
    })

    it('maps the pause option label to the API value', async () => {
      mock.onPost(`${ BASE }/subscriptions/sub_1/pause`).reply({ subscription: { id: 'sub_1' } })

      await service.pauseSubscription('sub_1', 'End Of Term')

      expect(decodeForm(mock.history[0].body)).toEqual({ pause_option: 'end_of_term' })
    })
  })

  describe('resumeSubscription', () => {
    it('sends an empty body when no option is given', async () => {
      mock.onPost(`${ BASE }/subscriptions/sub_1/resume`).reply({ subscription: { id: 'sub_1' } })

      await service.resumeSubscription('sub_1')

      expect(decodeForm(mock.history[0].body)).toEqual({})
    })

    it('maps the resume option label to the API value', async () => {
      mock.onPost(`${ BASE }/subscriptions/sub_1/resume`).reply({ subscription: { id: 'sub_1' } })

      await service.resumeSubscription('sub_1', 'Specific Date')

      expect(decodeForm(mock.history[0].body)).toEqual({ resume_option: 'specific_date' })
    })
  })

  describe('reactivateSubscription', () => {
    it('posts to the reactivate endpoint with an empty body', async () => {
      mock.onPost(`${ BASE }/subscriptions/sub_1/reactivate`).reply({ subscription: { id: 'sub_1' } })

      const result = await service.reactivateSubscription('sub_1')

      expect(result).toEqual({ subscription: { id: 'sub_1' } })
      expect(mock.history[0].url).toBe(`${ BASE }/subscriptions/sub_1/reactivate`)
      expect(decodeForm(mock.history[0].body)).toEqual({})
    })
  })

  // ── Invoices ──

  describe('listInvoices', () => {
    it('uses default limit and omits empty filters', async () => {
      mock.onGet(`${ BASE }/invoices`).reply({ list: [] })

      await service.listInvoices()

      expect(mock.history[0].query).toEqual({ limit: '20' })
    })

    it('maps the status choice label to the API value', async () => {
      mock.onGet(`${ BASE }/invoices`).reply({ list: [] })

      await service.listInvoices('cust_1', 'Payment Due', 5, 'tok')

      expect(mock.history[0].query).toEqual({
        'customer_id[is]': 'cust_1',
        'status[is]': 'payment_due',
        limit: '5',
        offset: 'tok',
      })
    })
  })

  describe('getInvoice', () => {
    it('fetches by id', async () => {
      mock.onGet(`${ BASE }/invoices/5`).reply({ invoice: { id: '5' } })

      const result = await service.getInvoice('5')

      expect(result).toEqual({ invoice: { id: '5' } })
      expect(mock.history[0].url).toBe(`${ BASE }/invoices/5`)
    })
  })

  describe('createInvoiceForCustomer', () => {
    it('sends an empty body when nothing is provided', async () => {
      mock.onPost(`${ BASE }/customers/cust_1/create_invoice_for_items`).reply({ invoice: { id: '6' } })

      await service.createInvoiceForCustomer('cust_1')

      expect(mock.history[0].url).toBe(`${ BASE }/customers/cust_1/create_invoice_for_items`)
      expect(decodeForm(mock.history[0].body)).toEqual({})
    })

    it('transposes item prices and charges', async () => {
      mock.onPost(`${ BASE }/customers/cust_1/create_invoice_for_items`).reply({ invoice: { id: '6' } })

      await service.createInvoiceForCustomer(
        'cust_1',
        [{ item_price_id: 'basic-USD-monthly', quantity: 1 }],
        [{ amount: 500, description: 'Setup fee' }]
      )

      expect(decodeForm(mock.history[0].body)).toEqual({
        'item_prices[item_price_id][0]': 'basic-USD-monthly',
        'item_prices[quantity][0]': '1',
        'charges[amount][0]': '500',
        'charges[description][0]': 'Setup fee',
      })
    })
  })

  describe('voidInvoice', () => {
    it('sends an empty body when no comment is given', async () => {
      mock.onPost(`${ BASE }/invoices/5/void`).reply({ invoice: { id: '5', status: 'voided' } })

      await service.voidInvoice('5')

      expect(mock.history[0].url).toBe(`${ BASE }/invoices/5/void`)
      expect(decodeForm(mock.history[0].body)).toEqual({})
    })

    it('includes the comment when provided', async () => {
      mock.onPost(`${ BASE }/invoices/5/void`).reply({ invoice: { id: '5', status: 'voided' } })

      await service.voidInvoice('5', 'Issued in error')

      expect(decodeForm(mock.history[0].body)).toEqual({ comment: 'Issued in error' })
    })
  })

  describe('collectPayment', () => {
    it('sends an empty body when no payment source is given', async () => {
      mock.onPost(`${ BASE }/invoices/5/collect_payment`).reply({ invoice: { id: '5' } })

      await service.collectPayment('5')

      expect(mock.history[0].url).toBe(`${ BASE }/invoices/5/collect_payment`)
      expect(decodeForm(mock.history[0].body)).toEqual({})
    })

    it('includes the payment source id when provided', async () => {
      mock.onPost(`${ BASE }/invoices/5/collect_payment`).reply({ invoice: { id: '5' } })

      await service.collectPayment('5', 'pm_1')

      expect(decodeForm(mock.history[0].body)).toEqual({ payment_source_id: 'pm_1' })
    })
  })

  describe('getInvoicePdf', () => {
    it('posts to the pdf endpoint and returns the download object', async () => {
      mock.onPost(`${ BASE }/invoices/5/pdf`).reply({ download: { download_url: 'https://dl/abc' } })

      const result = await service.getInvoicePdf('5')

      expect(result).toEqual({ download: { download_url: 'https://dl/abc' } })
      expect(mock.history[0].url).toBe(`${ BASE }/invoices/5/pdf`)
      expect(decodeForm(mock.history[0].body)).toEqual({})
    })
  })

  // ── Items & Item Prices ──

  describe('listItems', () => {
    it('uses default limit and omits empty filters', async () => {
      mock.onGet(`${ BASE }/items`).reply({ list: [] })

      await service.listItems()

      expect(mock.history[0].query).toEqual({ limit: '20' })
    })

    it('maps the type choice label to the API value', async () => {
      mock.onGet(`${ BASE }/items`).reply({ list: [] })

      await service.listItems('Addon', 10, 'tok')

      expect(mock.history[0].query).toEqual({
        'type[is]': 'addon',
        limit: '10',
        offset: 'tok',
      })
    })
  })

  describe('getItem', () => {
    it('fetches by id', async () => {
      mock.onGet(`${ BASE }/items/basic`).reply({ item: { id: 'basic' } })

      const result = await service.getItem('basic')

      expect(result).toEqual({ item: { id: 'basic' } })
      expect(mock.history[0].url).toBe(`${ BASE }/items/basic`)
    })
  })

  describe('listItemPrices', () => {
    it('uses default limit and omits empty filters', async () => {
      mock.onGet(`${ BASE }/item_prices`).reply({ list: [] })

      await service.listItemPrices()

      expect(mock.history[0].query).toEqual({ limit: '20' })
    })

    it('passes item and currency filters', async () => {
      mock.onGet(`${ BASE }/item_prices`).reply({ list: [] })

      await service.listItemPrices('basic', 'USD', 10, 'tok')

      expect(mock.history[0].query).toEqual({
        'item_id[is]': 'basic',
        'currency_code[is]': 'USD',
        limit: '10',
        offset: 'tok',
      })
    })
  })

  describe('getItemPrice', () => {
    it('fetches by id', async () => {
      mock.onGet(`${ BASE }/item_prices/basic-USD-monthly`).reply({ item_price: { id: 'basic-USD-monthly' } })

      const result = await service.getItemPrice('basic-USD-monthly')

      expect(result).toEqual({ item_price: { id: 'basic-USD-monthly' } })
      expect(mock.history[0].url).toBe(`${ BASE }/item_prices/basic-USD-monthly`)
    })
  })

  // ── Payment Sources ──

  describe('listPaymentSources', () => {
    it('sends the customer filter and default limit', async () => {
      mock.onGet(`${ BASE }/payment_sources`).reply({ list: [] })

      await service.listPaymentSources('cust_1')

      expect(mock.history[0].query).toEqual({ 'customer_id[is]': 'cust_1', limit: '20' })
    })

    it('passes custom limit and offset', async () => {
      mock.onGet(`${ BASE }/payment_sources`).reply({ list: [] })

      await service.listPaymentSources('cust_1', 10, 'tok')

      expect(mock.history[0].query).toEqual({
        'customer_id[is]': 'cust_1',
        limit: '10',
        offset: 'tok',
      })
    })
  })

  describe('getPaymentSource', () => {
    it('fetches by id', async () => {
      mock.onGet(`${ BASE }/payment_sources/pm_1`).reply({ payment_source: { id: 'pm_1' } })

      const result = await service.getPaymentSource('pm_1')

      expect(result).toEqual({ payment_source: { id: 'pm_1' } })
      expect(mock.history[0].url).toBe(`${ BASE }/payment_sources/pm_1`)
    })
  })

  // ── Credit Notes ──

  describe('listCreditNotes', () => {
    it('uses default limit and omits empty filters', async () => {
      mock.onGet(`${ BASE }/credit_notes`).reply({ list: [] })

      await service.listCreditNotes()

      expect(mock.history[0].query).toEqual({ limit: '20' })
    })

    it('passes the customer filter, limit and offset', async () => {
      mock.onGet(`${ BASE }/credit_notes`).reply({ list: [] })

      await service.listCreditNotes('cust_1', 5, 'tok')

      expect(mock.history[0].query).toEqual({
        'customer_id[is]': 'cust_1',
        limit: '5',
        offset: 'tok',
      })
    })
  })

  describe('getCreditNote', () => {
    it('fetches by id', async () => {
      mock.onGet(`${ BASE }/credit_notes/cn_1`).reply({ credit_note: { id: 'cn_1' } })

      const result = await service.getCreditNote('cn_1')

      expect(result).toEqual({ credit_note: { id: 'cn_1' } })
      expect(mock.history[0].url).toBe(`${ BASE }/credit_notes/cn_1`)
    })
  })

  // ── Hosted Pages ──

  describe('createCheckout', () => {
    it('sends only the subscription items when no customer is given', async () => {
      mock
        .onPost(`${ BASE }/hosted_pages/checkout_new_for_items`)
        .reply({ hosted_page: { id: 'hp_1' } })

      const result = await service.createCheckout([{ item_price_id: 'basic-USD-monthly', quantity: 1 }])

      expect(result).toEqual({ hosted_page: { id: 'hp_1' } })
      expect(mock.history[0].url).toBe(`${ BASE }/hosted_pages/checkout_new_for_items`)
      expect(decodeForm(mock.history[0].body)).toEqual({
        'subscription_items[item_price_id][0]': 'basic-USD-monthly',
        'subscription_items[quantity][0]': '1',
      })
    })

    it('includes the customer id as a nested object when provided', async () => {
      mock
        .onPost(`${ BASE }/hosted_pages/checkout_new_for_items`)
        .reply({ hosted_page: { id: 'hp_2' } })

      await service.createCheckout([{ item_price_id: 'basic-USD-monthly' }], 'cust_1')

      expect(decodeForm(mock.history[0].body)).toEqual({
        'subscription_items[item_price_id][0]': 'basic-USD-monthly',
        'customer[id]': 'cust_1',
      })
    })
  })

  // ── Dictionaries ──

  describe('getCustomersDictionary', () => {
    const listResponse = {
      list: [
        {
          customer: {
            id: 'cust_1',
            first_name: 'John',
            last_name: 'Doe',
            email: 'john@example.com',
            company: 'Acme Inc',
          },
        },
        {
          customer: {
            id: 'cust_2',
            email: 'jane@example.com',
          },
        },
        {
          customer: {
            id: 'cust_3',
          },
        },
      ],
      next_offset: '["1517507212000","12345"]',
    }

    it('maps customers to dictionary items and forwards the cursor', async () => {
      mock.onGet(`${ BASE }/customers`).reply(listResponse)

      const result = await service.getCustomersDictionary({})

      expect(mock.history[0].query).toMatchObject({ limit: '20' })
      expect(result.items).toEqual([
        { label: 'John Doe (john@example.com)', value: 'cust_1', note: 'Acme Inc' },
        { label: 'jane@example.com', value: 'cust_2', note: 'jane@example.com' },
        { label: 'cust_3', value: 'cust_3', note: undefined },
      ])
      expect(result.cursor).toBe('["1517507212000","12345"]')
    })

    it('passes search as email prefix filter and cursor as offset', async () => {
      mock.onGet(`${ BASE }/customers`).reply({ list: [], next_offset: null })

      const result = await service.getCustomersDictionary({ search: 'jo', cursor: 'off_5' })

      expect(mock.history[0].query).toEqual({
        'email[starts_with]': 'jo',
        limit: '20',
        offset: 'off_5',
      })
      expect(result.cursor).toBeUndefined()
    })

    it('handles a null payload', async () => {
      mock.onGet(`${ BASE }/customers`).reply({ list: [] })

      const result = await service.getCustomersDictionary(null)

      expect(result.items).toEqual([])
      expect(result.cursor).toBeUndefined()
    })

    it('handles a response with no list', async () => {
      mock.onGet(`${ BASE }/customers`).reply({})

      const result = await service.getCustomersDictionary({})

      expect(result.items).toEqual([])
    })

    it('propagates API errors', async () => {
      mock.onGet(`${ BASE }/customers`).replyWithError({ message: 'Boom', body: {} })

      await expect(service.getCustomersDictionary({})).rejects.toThrow('Chargebee API error: Boom')
    })
  })

  describe('getItemPricesDictionary', () => {
    const listResponse = {
      list: [
        {
          item_price: {
            id: 'basic-USD-monthly',
            name: 'Basic USD Monthly',
            currency_code: 'USD',
            period_unit: 'month',
          },
        },
        {
          item_price: {
            id: 'noname-EUR',
            currency_code: 'EUR',
          },
        },
      ],
      next_offset: '["basic-USD-monthly"]',
    }

    it('maps item prices to dictionary items with active filter and forwards the cursor', async () => {
      mock.onGet(`${ BASE }/item_prices`).reply(listResponse)

      const result = await service.getItemPricesDictionary({})

      expect(mock.history[0].query).toMatchObject({ 'status[is]': 'active', limit: '20' })
      expect(result.items).toEqual([
        { label: 'Basic USD Monthly', value: 'basic-USD-monthly', note: 'USD - month' },
        { label: 'noname-EUR', value: 'noname-EUR', note: 'EUR' },
      ])
      expect(result.cursor).toBe('["basic-USD-monthly"]')
    })

    it('passes search as name prefix filter and cursor as offset', async () => {
      mock.onGet(`${ BASE }/item_prices`).reply({ list: [], next_offset: null })

      const result = await service.getItemPricesDictionary({ search: 'Bas', cursor: 'off_2' })

      expect(mock.history[0].query).toEqual({
        'name[starts_with]': 'Bas',
        'status[is]': 'active',
        limit: '20',
        offset: 'off_2',
      })
      expect(result.cursor).toBeUndefined()
    })

    it('handles a null payload', async () => {
      mock.onGet(`${ BASE }/item_prices`).reply({ list: [] })

      const result = await service.getItemPricesDictionary(null)

      expect(result.items).toEqual([])
    })

    it('propagates API errors', async () => {
      mock.onGet(`${ BASE }/item_prices`).replyWithError({ message: 'Boom', body: {} })

      await expect(service.getItemPricesDictionary({})).rejects.toThrow('Chargebee API error: Boom')
    })
  })
})
