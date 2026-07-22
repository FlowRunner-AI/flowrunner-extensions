'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'pdl_test_api_key'
const BASE = 'https://sandbox-api.paddle.com'
const LIVE_BASE = 'https://api.paddle.com'

const AUTH_HEADERS = {
  'Authorization': `Bearer ${ API_KEY }`,
  'Content-Type': 'application/json',
}

describe('Paddle Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ apiKey: API_KEY, environment: 'Sandbox' })
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

  // ── Registration & construction ──

  describe('service registration', () => {
    it('registers the required config items in order', () => {
      const configItems = sandbox.getConfigItems()

      expect(configItems.map(item => item.name)).toEqual(['apiKey', 'environment'])

      expect(configItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'apiKey', required: true, shared: false, type: 'STRING' }),
          expect.objectContaining({
            name: 'environment',
            required: true,
            shared: false,
            type: 'CHOICE',
            defaultValue: 'Sandbox',
            options: ['Sandbox', 'Live'],
          }),
        ])
      )
    })

    it('defaults to the sandbox base URL', () => {
      expect(service.baseUrl).toBe(BASE)
      expect(service.apiKey).toBe(API_KEY)
    })
  })

  // ── Products ──

  describe('createProduct', () => {
    it('sends the mapped tax category and only the supplied fields', async () => {
      mock.onPost(`${ BASE }/products`).reply({ data: { id: 'pro_1' } })

      const result = await service.createProduct('AI Access', 'Digital Goods')

      expect(result).toEqual({ data: { id: 'pro_1' } })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].headers).toMatchObject(AUTH_HEADERS)
      expect(mock.history[0].body).toEqual({ name: 'AI Access', tax_category: 'digital-goods' })
    })

    it('includes optional description, image URL and custom data', async () => {
      mock.onPost(`${ BASE }/products`).reply({ data: { id: 'pro_2' } })

      await service.createProduct('AI Access', 'SaaS', 'Desc', 'https://img/x.png', { a: 1 })

      expect(mock.history[0].body).toEqual({
        name: 'AI Access',
        tax_category: 'saas',
        description: 'Desc',
        image_url: 'https://img/x.png',
        custom_data: { a: 1 },
      })
    })

    it('passes an unknown tax category through unchanged', async () => {
      mock.onPost(`${ BASE }/products`).reply({ data: {} })

      await service.createProduct('X', 'standard')

      expect(mock.history[0].body.tax_category).toBe('standard')
    })

    it('throws a formatted error when the API responds with a Paddle error body', async () => {
      mock.onPost(`${ BASE }/products`).replyWithError({
        message: 'Bad Request',
        body: { error: { detail: 'name is required', code: 'invalid_field', type: 'request_error' } },
      })

      await expect(service.createProduct('X', 'Standard'))
        .rejects.toThrow('Paddle API error: name is required (code: invalid_field) [request_error]')
    })

    it('falls back to the error message when no Paddle error body is present', async () => {
      mock.onPost(`${ BASE }/products`).replyWithError({ message: 'socket hang up' })

      await expect(service.createProduct('X', 'Standard')).rejects.toThrow('Paddle API error: socket hang up')
    })
  })

  describe('listProducts', () => {
    it('sends no query parameters when nothing is supplied', async () => {
      mock.onGet(`${ BASE }/products`).reply({ data: [] })

      const result = await service.listProducts()

      expect(result).toEqual({ data: [] })
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].query).toEqual({})
      expect(mock.history[0].body).toBeUndefined()
    })

    it('maps the status label and forwards pagination', async () => {
      mock.onGet(`${ BASE }/products`).reply({ data: [] })

      await service.listProducts('Archived', 25, 'pro_02')

      expect(mock.history[0].query).toEqual({ status: 'archived', per_page: 25, after: 'pro_02' })
    })
  })

  describe('getProduct', () => {
    it('requests the product by id', async () => {
      mock.onGet(`${ BASE }/products/pro_1`).reply({ data: { id: 'pro_1' } })

      const result = await service.getProduct('pro_1')

      expect(result.data.id).toBe('pro_1')
      expect(mock.history[0].url).toBe(`${ BASE }/products/pro_1`)
    })
  })

  describe('updateProduct', () => {
    it('sends only the changed fields with mapped choices', async () => {
      mock.onPatch(`${ BASE }/products/pro_1`).reply({ data: { id: 'pro_1' } })

      await service.updateProduct('pro_1', 'New name', undefined, undefined, undefined, undefined, 'Archived')

      expect(mock.history[0].method).toBe('patch')
      expect(mock.history[0].body).toEqual({ name: 'New name', status: 'archived' })
    })

    it('drops empty-string values', async () => {
      mock.onPatch(`${ BASE }/products/pro_1`).reply({ data: {} })

      await service.updateProduct('pro_1', '', '', '', '', undefined, '')

      expect(mock.history[0].body).toEqual({})
    })
  })

  // ── Prices ──

  describe('createPrice', () => {
    it('sends the minimal body for a one-time price', async () => {
      mock.onPost(`${ BASE }/prices`).reply({ data: { id: 'pri_1' } })

      await service.createPrice('pro_1', 'Monthly', { amount: '1000', currency_code: 'USD' })

      expect(mock.history[0].body).toEqual({
        product_id: 'pro_1',
        description: 'Monthly',
        unit_price: { amount: '1000', currency_code: 'USD' },
      })
    })

    it('includes billing cycle, trial period and quantity bounds', async () => {
      mock.onPost(`${ BASE }/prices`).reply({ data: {} })

      await service.createPrice(
        'pro_1',
        'Monthly',
        { amount: '1000', currency_code: 'USD' },
        { interval: 'month', frequency: 1 },
        { interval: 'day', frequency: 7 },
        1,
        10,
        'Pro Monthly'
      )

      expect(mock.history[0].body).toEqual({
        product_id: 'pro_1',
        description: 'Monthly',
        name: 'Pro Monthly',
        unit_price: { amount: '1000', currency_code: 'USD' },
        billing_cycle: { interval: 'month', frequency: 1 },
        trial_period: { interval: 'day', frequency: 7 },
        quantity: { minimum: 1, maximum: 10 },
      })
    })

    it('sends only the supplied quantity bound', async () => {
      mock.onPost(`${ BASE }/prices`).reply({ data: {} })

      await service.createPrice('pro_1', 'Monthly', { amount: '1', currency_code: 'USD' }, undefined, undefined, undefined, 5)

      expect(mock.history[0].body.quantity).toEqual({ maximum: 5 })
    })
  })

  describe('listPrices', () => {
    it('filters by product and status', async () => {
      mock.onGet(`${ BASE }/prices`).reply({ data: [] })

      await service.listPrices('pro_1', 'Active', 10, 'pri_02')

      expect(mock.history[0].query).toEqual({
        product_id: 'pro_1',
        status: 'active',
        per_page: 10,
        after: 'pri_02',
      })
    })
  })

  describe('getPrice', () => {
    it('requests the price by id', async () => {
      mock.onGet(`${ BASE }/prices/pri_1`).reply({ data: { id: 'pri_1' } })

      await service.getPrice('pri_1')

      expect(mock.history[0].url).toBe(`${ BASE }/prices/pri_1`)
    })
  })

  describe('updatePrice', () => {
    it('sends the changed fields and quantity bounds', async () => {
      mock.onPatch(`${ BASE }/prices/pri_1`).reply({ data: {} })

      await service.updatePrice('pri_1', 'Monthly Pro', undefined, undefined, undefined, undefined, 2, 20, 'Archived')

      expect(mock.history[0].body).toEqual({
        description: 'Monthly Pro',
        quantity: { minimum: 2, maximum: 20 },
        status: 'archived',
      })
    })

    it('omits the quantity object entirely when no bounds are supplied', async () => {
      mock.onPatch(`${ BASE }/prices/pri_1`).reply({ data: {} })

      await service.updatePrice('pri_1', 'Monthly Pro')

      expect(mock.history[0].body).toEqual({ description: 'Monthly Pro' })
    })
  })

  // ── Customers ──

  describe('createCustomer', () => {
    it('sends the email only when nothing else is supplied', async () => {
      mock.onPost(`${ BASE }/customers`).reply({ data: { id: 'ctm_1' } })

      await service.createCustomer('jane@example.com')

      expect(mock.history[0].body).toEqual({ email: 'jane@example.com' })
    })

    it('sends the name and custom data when supplied', async () => {
      mock.onPost(`${ BASE }/customers`).reply({ data: {} })

      await service.createCustomer('jane@example.com', 'Jane Doe', { plan: 'pro' })

      expect(mock.history[0].body).toEqual({
        email: 'jane@example.com',
        name: 'Jane Doe',
        custom_data: { plan: 'pro' },
      })
    })
  })

  describe('listCustomers', () => {
    it('forwards search, status and pagination', async () => {
      mock.onGet(`${ BASE }/customers`).reply({ data: [] })

      await service.listCustomers('jane', 'Active', 5, 'ctm_02')

      expect(mock.history[0].query).toEqual({
        search: 'jane',
        status: 'active',
        per_page: 5,
        after: 'ctm_02',
      })
    })
  })

  describe('getCustomer', () => {
    it('requests the customer by id', async () => {
      mock.onGet(`${ BASE }/customers/ctm_1`).reply({ data: { id: 'ctm_1' } })

      await service.getCustomer('ctm_1')

      expect(mock.history[0].url).toBe(`${ BASE }/customers/ctm_1`)
    })
  })

  describe('updateCustomer', () => {
    it('sends only the changed fields', async () => {
      mock.onPatch(`${ BASE }/customers/ctm_1`).reply({ data: {} })

      await service.updateCustomer('ctm_1', undefined, 'Jane Smith', undefined, 'Archived')

      expect(mock.history[0].body).toEqual({ name: 'Jane Smith', status: 'archived' })
    })
  })

  describe('getCustomerCreditBalances', () => {
    it('requests balances without a currency filter', async () => {
      mock.onGet(`${ BASE }/customers/ctm_1/credit-balances`).reply({ data: [] })

      await service.getCustomerCreditBalances('ctm_1')

      expect(mock.history[0].query).toEqual({})
    })

    it('filters by currency code', async () => {
      mock.onGet(`${ BASE }/customers/ctm_1/credit-balances`).reply({ data: [] })

      await service.getCustomerCreditBalances('ctm_1', 'USD')

      expect(mock.history[0].query).toEqual({ currency_code: 'USD' })
    })
  })

  // ── Subscriptions ──

  describe('listSubscriptions', () => {
    it('maps the multi-word status label', async () => {
      mock.onGet(`${ BASE }/subscriptions`).reply({ data: [] })

      await service.listSubscriptions('Past Due', 'ctm_1', 50, 'sub_02')

      expect(mock.history[0].query).toEqual({
        status: 'past_due',
        customer_id: 'ctm_1',
        per_page: 50,
        after: 'sub_02',
      })
    })
  })

  describe('getSubscription', () => {
    it('requests the subscription by id', async () => {
      mock.onGet(`${ BASE }/subscriptions/sub_1`).reply({ data: { id: 'sub_1' } })

      await service.getSubscription('sub_1')

      expect(mock.history[0].url).toBe(`${ BASE }/subscriptions/sub_1`)
    })
  })

  describe('updateSubscription', () => {
    it('sends items and the mapped proration mode', async () => {
      mock.onPatch(`${ BASE }/subscriptions/sub_1`).reply({ data: {} })

      await service.updateSubscription('sub_1', [{ price_id: 'pri_1', quantity: 2 }], 'Do Not Bill')

      expect(mock.history[0].body).toEqual({
        items: [{ price_id: 'pri_1', quantity: 2 }],
        proration_billing_mode: 'do_not_bill',
      })
    })

    it('sends an empty body when nothing is supplied', async () => {
      mock.onPatch(`${ BASE }/subscriptions/sub_1`).reply({ data: {} })

      await service.updateSubscription('sub_1')

      expect(mock.history[0].body).toEqual({})
    })
  })

  describe('pauseSubscription', () => {
    it('maps the effective-from label', async () => {
      mock.onPost(`${ BASE }/subscriptions/sub_1/pause`).reply({ data: {} })

      await service.pauseSubscription('sub_1', 'Immediately')

      expect(mock.history[0].body).toEqual({ effective_from: 'immediately' })
    })

    it('sends an empty body when no effective-from is supplied', async () => {
      mock.onPost(`${ BASE }/subscriptions/sub_1/pause`).reply({ data: {} })

      await service.pauseSubscription('sub_1')

      expect(mock.history[0].body).toEqual({})
    })
  })

  describe('resumeSubscription', () => {
    it('maps the effective-from label', async () => {
      mock.onPost(`${ BASE }/subscriptions/sub_1/resume`).reply({ data: {} })

      await service.resumeSubscription('sub_1', 'Next Billing Period')

      expect(mock.history[0].body).toEqual({ effective_from: 'next_billing_period' })
    })
  })

  describe('cancelSubscription', () => {
    it('maps the effective-from label', async () => {
      mock.onPost(`${ BASE }/subscriptions/sub_1/cancel`).reply({ data: {} })

      await service.cancelSubscription('sub_1', 'Next Billing Period')

      expect(mock.history[0].body).toEqual({ effective_from: 'next_billing_period' })
    })
  })

  // ── Transactions ──

  describe('listTransactions', () => {
    it('maps the status label and filters by customer', async () => {
      mock.onGet(`${ BASE }/transactions`).reply({ data: [] })

      await service.listTransactions('Past Due', 'ctm_1')

      expect(mock.history[0].query).toEqual({ status: 'past_due', customer_id: 'ctm_1' })
    })
  })

  describe('getTransaction', () => {
    it('requests the transaction by id', async () => {
      mock.onGet(`${ BASE }/transactions/txn_1`).reply({ data: { id: 'txn_1' } })

      await service.getTransaction('txn_1')

      expect(mock.history[0].url).toBe(`${ BASE }/transactions/txn_1`)
    })
  })

  describe('createTransaction', () => {
    it('sends the items only', async () => {
      mock.onPost(`${ BASE }/transactions`).reply({ data: {} })

      await service.createTransaction([{ price_id: 'pri_1', quantity: 1 }])

      expect(mock.history[0].body).toEqual({ items: [{ price_id: 'pri_1', quantity: 1 }] })
    })

    it('maps the collection mode and attaches the customer', async () => {
      mock.onPost(`${ BASE }/transactions`).reply({ data: {} })

      await service.createTransaction([{ price_id: 'pri_1', quantity: 1 }], 'ctm_1', 'Manual')

      expect(mock.history[0].body).toEqual({
        items: [{ price_id: 'pri_1', quantity: 1 }],
        customer_id: 'ctm_1',
        collection_mode: 'manual',
      })
    })
  })

  describe('getTransactionInvoicePdf', () => {
    it('requests the invoice endpoint', async () => {
      mock.onGet(`${ BASE }/transactions/txn_1/invoice`).reply({ data: { url: 'https://x/inv.pdf' } })

      const result = await service.getTransactionInvoicePdf('txn_1')

      expect(result.data.url).toBe('https://x/inv.pdf')
    })
  })

  // ── Discounts ──

  describe('listDiscounts', () => {
    it('maps the status label and filters by code', async () => {
      mock.onGet(`${ BASE }/discounts`).reply({ data: [] })

      await service.listDiscounts('Expired', 'WELCOME10', 20, 'dsc_02')

      expect(mock.history[0].query).toEqual({
        status: 'expired',
        code: 'WELCOME10',
        per_page: 20,
        after: 'dsc_02',
      })
    })
  })

  describe('createDiscount', () => {
    it('maps the percentage type', async () => {
      mock.onPost(`${ BASE }/discounts`).reply({ data: {} })

      await service.createDiscount('Welcome', '10', 'Percentage')

      expect(mock.history[0].body).toEqual({ description: 'Welcome', amount: '10', type: 'percentage' })
    })

    it('maps flat-per-seat and sends every optional field', async () => {
      mock.onPost(`${ BASE }/discounts`).reply({ data: {} })

      await service.createDiscount('Seats', '500', 'Flat Per Seat', 'USD', 'SEATS', true, 3, 100, '2026-12-31T00:00:00Z')

      expect(mock.history[0].body).toEqual({
        description: 'Seats',
        amount: '500',
        type: 'flat_per_seat',
        currency_code: 'USD',
        code: 'SEATS',
        recur: true,
        maximum_recurring_intervals: 3,
        usage_limit: 100,
        expires_at: '2026-12-31T00:00:00Z',
      })
    })

    it('drops recur when it is false', async () => {
      mock.onPost(`${ BASE }/discounts`).reply({ data: {} })

      await service.createDiscount('Welcome', '10', 'Flat', 'USD', undefined, false)

      expect(mock.history[0].body).toEqual({
        description: 'Welcome',
        amount: '10',
        type: 'flat',
        currency_code: 'USD',
        recur: false,
      })
    })
  })

  describe('getDiscount', () => {
    it('requests the discount by id', async () => {
      mock.onGet(`${ BASE }/discounts/dsc_1`).reply({ data: { id: 'dsc_1' } })

      await service.getDiscount('dsc_1')

      expect(mock.history[0].url).toBe(`${ BASE }/discounts/dsc_1`)
    })
  })

  describe('updateDiscount', () => {
    it('sends only the changed fields', async () => {
      mock.onPatch(`${ BASE }/discounts/dsc_1`).reply({ data: {} })

      await service.updateDiscount('dsc_1', undefined, '15', 'WELCOME15', undefined, undefined, 'Active')

      expect(mock.history[0].body).toEqual({ amount: '15', code: 'WELCOME15', status: 'active' })
    })
  })

  // ── Adjustments ──

  describe('createAdjustment', () => {
    it('maps the action and adjustment type', async () => {
      mock.onPost(`${ BASE }/adjustments`).reply({ data: {} })

      await service.createAdjustment('Refund', 'txn_1', 'Customer request', 'Full')

      expect(mock.history[0].body).toEqual({
        action: 'refund',
        transaction_id: 'txn_1',
        reason: 'Customer request',
        type: 'full',
      })
    })

    it('sends partial items', async () => {
      mock.onPost(`${ BASE }/adjustments`).reply({ data: {} })

      await service.createAdjustment('Credit', 'txn_1', 'Goodwill', 'Partial', [
        { item_id: 'txnitm_1', type: 'partial', amount: '100' },
      ])

      expect(mock.history[0].body).toEqual({
        action: 'credit',
        transaction_id: 'txn_1',
        reason: 'Goodwill',
        type: 'partial',
        items: [{ item_id: 'txnitm_1', type: 'partial', amount: '100' }],
      })
    })
  })

  describe('listAdjustments', () => {
    it('maps action and status labels and forwards all filters', async () => {
      mock.onGet(`${ BASE }/adjustments`).reply({ data: [] })

      await service.listAdjustments('Refund', 'Pending Approval', 'txn_1', 'ctm_1', 30, 'adj_02')

      expect(mock.history[0].query).toEqual({
        action: 'refund',
        status: 'pending_approval',
        transaction_id: 'txn_1',
        customer_id: 'ctm_1',
        per_page: 30,
        after: 'adj_02',
      })
    })
  })

  // ── Dictionaries ──

  describe('getProductsDictionary', () => {
    it('returns mapped items and requests only active products', async () => {
      mock.onGet(`${ BASE }/products`).reply({
        data: [{ id: 'pro_1', name: 'AI Access', status: 'active' }],
        meta: { pagination: { has_more: false } },
      })

      const result = await service.getProductsDictionary({})

      expect(result).toEqual({
        items: [{ label: 'AI Access', value: 'pro_1', note: 'active' }],
        cursor: undefined,
      })

      expect(mock.history[0].query).toEqual({ status: 'active', per_page: 200 })
    })

    it('handles a null payload', async () => {
      mock.onGet(`${ BASE }/products`).reply({ data: [{ id: 'pro_1', name: 'A' }] })

      const result = await service.getProductsDictionary(null)

      expect(result.items).toHaveLength(1)
      expect(result.cursor).toBeUndefined()
    })

    it('filters items client-side by a case-insensitive search term', async () => {
      mock.onGet(`${ BASE }/products`).reply({
        data: [
          { id: 'pro_1', name: 'Alpha' },
          { id: 'pro_2', name: 'Beta' },
        ],
      })

      const result = await service.getProductsDictionary({ search: 'ALP' })

      expect(result.items).toEqual([{ label: 'Alpha', value: 'pro_1', note: undefined }])
    })

    it('extracts the after cursor from the pagination next URL', async () => {
      mock.onGet(`${ BASE }/products`).reply({
        data: [],
        meta: { pagination: { next: `${ BASE }/products?after=pro_9`, has_more: true } },
      })

      const result = await service.getProductsDictionary({ cursor: 'pro_5' })

      expect(result.cursor).toBe('pro_9')
      expect(mock.history[0].query).toEqual({ status: 'active', per_page: 200, after: 'pro_5' })
    })

    it('returns no cursor when the next URL is unparseable', async () => {
      mock.onGet(`${ BASE }/products`).reply({
        data: [],
        meta: { pagination: { next: 'not-a-url', has_more: true } },
      })

      const result = await service.getProductsDictionary({})

      expect(result.cursor).toBeUndefined()
    })

    it('handles a missing data array', async () => {
      mock.onGet(`${ BASE }/products`).reply({})

      const result = await service.getProductsDictionary({})

      expect(result).toEqual({ items: [], cursor: undefined })
    })
  })

  describe('getPricesDictionary', () => {
    it('scopes prices to a product from the criteria and labels by name', async () => {
      mock.onGet(`${ BASE }/prices`).reply({
        data: [
          { id: 'pri_1', name: 'Pro Monthly', description: 'Monthly', unit_price: { amount: '1000', currency_code: 'USD' } },
        ],
      })

      const result = await service.getPricesDictionary({ criteria: { productId: 'pro_1' } })

      expect(result.items).toEqual([{ label: 'Pro Monthly', value: 'pri_1', note: '1000 USD' }])
      expect(mock.history[0].query).toEqual({ status: 'active', per_page: 200, product_id: 'pro_1' })
    })

    it('falls back to the description as label and status as note', async () => {
      mock.onGet(`${ BASE }/prices`).reply({
        data: [{ id: 'pri_2', description: 'Yearly', status: 'active' }],
      })

      const result = await service.getPricesDictionary({})

      expect(result.items).toEqual([{ label: 'Yearly', value: 'pri_2', note: 'active' }])
    })

    it('filters by search term', async () => {
      mock.onGet(`${ BASE }/prices`).reply({
        data: [
          { id: 'pri_1', description: 'Monthly' },
          { id: 'pri_2', description: 'Yearly' },
        ],
      })

      const result = await service.getPricesDictionary({ search: 'year' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('pri_2')
    })

    it('handles a null payload and empty data', async () => {
      mock.onGet(`${ BASE }/prices`).reply({})

      const result = await service.getPricesDictionary(null)

      expect(result).toEqual({ items: [], cursor: undefined })
    })
  })

  describe('getCustomersDictionary', () => {
    it('sends the search server-side and labels by name with the email as note', async () => {
      mock.onGet(`${ BASE }/customers`).reply({
        data: [{ id: 'ctm_1', name: 'Jane Doe', email: 'jane@example.com' }],
      })

      const result = await service.getCustomersDictionary({ search: 'jane' })

      expect(result.items).toEqual([{ label: 'Jane Doe', value: 'ctm_1', note: 'jane@example.com' }])
      expect(mock.history[0].query).toEqual({ status: 'active', per_page: 200, search: 'jane' })
    })

    it('falls back to the email as label when the name is missing', async () => {
      mock.onGet(`${ BASE }/customers`).reply({
        data: [{ id: 'ctm_2', email: 'nobody@example.com' }],
      })

      const result = await service.getCustomersDictionary(null)

      expect(result.items[0].label).toBe('nobody@example.com')
    })

    it('propagates API errors', async () => {
      mock.onGet(`${ BASE }/customers`).replyWithError({
        message: 'Unauthorized',
        body: { error: { detail: 'invalid api key' } },
      })

      await expect(service.getCustomersDictionary({})).rejects.toThrow('Paddle API error: invalid api key')
    })
  })
})

// The environment config item switches the API host, so it needs its own registration.
describe('Paddle Service (Live environment)', () => {
  let liveSandbox
  let liveService

  beforeAll(() => {
    jest.resetModules()
    liveSandbox = createSandbox({ apiKey: API_KEY, environment: 'Live' })
    require('../src/index.js')
    liveService = liveSandbox.getService()
  })

  afterAll(() => {
    liveSandbox.cleanup()
  })

  it('uses the live base URL', async () => {
    const mock = liveSandbox.getRequestMock()

    mock.onGet(`${ LIVE_BASE }/products`).reply({ data: [] })

    await liveService.listProducts()

    expect(liveService.baseUrl).toBe(LIVE_BASE)
    expect(mock.history[0].url).toBe(`${ LIVE_BASE }/products`)
  })
})
