'use strict'

const { createSandbox } = require('../../../service-sandbox')

const ACCESS_TOKEN = 'test-access-token'
const BASE = 'https://connect.squareup.com'
const SANDBOX_BASE = 'https://connect.squareupsandbox.com'

const EXPECTED_HEADERS = {
  'Authorization': `Bearer ${ ACCESS_TOKEN }`,
  'Square-Version': '2026-05-20',
  'Content-Type': 'application/json',
}

describe('Square Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ accessToken: ACCESS_TOKEN, environment: 'Production' })
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
    it('registers the required config items', () => {
      const configItems = sandbox.getConfigItems()

      expect(configItems.map(item => item.name)).toEqual(['accessToken', 'environment'])

      expect(configItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'accessToken', required: true, shared: false, type: 'STRING' }),
          expect.objectContaining({
            name: 'environment',
            required: true,
            shared: false,
            type: 'CHOICE',
            defaultValue: 'Production',
            options: ['Production', 'Sandbox'],
          }),
        ])
      )
    })

    it('resolves the production base url', () => {
      expect(service.baseUrl).toBe(BASE)
      expect(service.accessToken).toBe(ACCESS_TOKEN)
    })
  })

  // ── Locations ──

  describe('listLocations', () => {
    it('sends a GET with the auth headers', async () => {
      mock.onGet(`${ BASE }/v2/locations`).reply({ locations: [{ id: 'L1' }] })

      const result = await service.listLocations()

      expect(result).toEqual({ locations: [{ id: 'L1' }] })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].headers).toEqual(EXPECTED_HEADERS)
      expect(mock.history[0].query).toEqual({})
      expect(mock.history[0].body).toBeUndefined()
    })
  })

  describe('getLocation', () => {
    it('url-encodes the location id', async () => {
      mock.onGet(`${ BASE }/v2/locations/L%2F1`).reply({ location: { id: 'L/1' } })

      const result = await service.getLocation('L/1')

      expect(result).toEqual({ location: { id: 'L/1' } })
    })
  })

  // ── Payments ──

  describe('listPayments', () => {
    const url = `${ BASE }/v2/payments`

    it('omits empty query params', async () => {
      mock.onGet(url).reply({ payments: [] })

      await service.listPayments()

      expect(mock.history[0].query).toEqual({})
    })

    it('maps the sort order label and passes the remaining filters', async () => {
      mock.onGet(url).reply({ payments: [] })

      await service.listPayments('2024-01-01', '2024-02-01', 'Descending', 'L1', 10, 'cur-1')

      expect(mock.history[0].query).toEqual({
        begin_time: '2024-01-01',
        end_time: '2024-02-01',
        sort_order: 'DESC',
        location_id: 'L1',
        limit: 10,
        cursor: 'cur-1',
      })
    })

    it('passes an unmapped sort order through unchanged', async () => {
      mock.onGet(url).reply({ payments: [] })

      await service.listPayments(undefined, undefined, 'ASC')

      expect(mock.history[0].query).toEqual({ sort_order: 'ASC' })
    })
  })

  describe('getPayment', () => {
    it('fetches a payment by id', async () => {
      mock.onGet(`${ BASE }/v2/payments/pay1`).reply({ payment: { id: 'pay1' } })

      await expect(service.getPayment('pay1')).resolves.toEqual({ payment: { id: 'pay1' } })
    })
  })

  describe('createPayment', () => {
    const url = `${ BASE }/v2/payments`

    it('builds a card payment body with a generated idempotency key', async () => {
      mock.onPost(url).reply({ payment: { id: 'pay1' } })

      const result = await service.createPayment('cnon:card-nonce', 1000)

      expect(result).toEqual({ payment: { id: 'pay1' } })
      expect(mock.history[0].method).toBe('post')

      expect(mock.history[0].body).toEqual({
        idempotency_key: expect.any(String),
        source_id: 'cnon:card-nonce',
        amount_money: { amount: 1000, currency: 'USD' },
        autocomplete: true,
      })
    })

    it('passes through all optional fields and an explicit idempotency key', async () => {
      mock.onPost(url).reply({})

      await service.createPayment(
        'cnon:x', 2500, 'EUR', 'CUST1', 'L1', 'ORD1', 'REF1', 'A note',
        false, undefined, undefined, undefined, 'my-key'
      )

      expect(mock.history[0].body).toEqual({
        idempotency_key: 'my-key',
        source_id: 'cnon:x',
        amount_money: { amount: 2500, currency: 'EUR' },
        customer_id: 'CUST1',
        location_id: 'L1',
        order_id: 'ORD1',
        reference_id: 'REF1',
        note: 'A note',
        autocomplete: false,
      })
    })

    it('adds cash details for a CASH source, defaulting the buyer amount', async () => {
      mock.onPost(url).reply({})

      await service.createPayment('CASH', 500)

      expect(mock.history[0].body.cash_details).toEqual({
        buyer_supplied_money: { amount: 500, currency: 'USD' },
      })
    })

    it('uses the supplied buyer amount for a CASH source', async () => {
      mock.onPost(url).reply({})

      await service.createPayment('CASH', 500, 'CAD', undefined, undefined, undefined, undefined, undefined, undefined, 700)

      expect(mock.history[0].body.cash_details).toEqual({
        buyer_supplied_money: { amount: 700, currency: 'CAD' },
      })
    })

    it('maps the external payment type label', async () => {
      mock.onPost(url).reply({})

      await service.createPayment(
        'EXTERNAL', 900, undefined, undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, 'Bank Transfer', 'Wire'
      )

      expect(mock.history[0].body.external_details).toEqual({ type: 'BANK_TRANSFER', source: 'Wire' })
    })

    it('defaults the external type and source when not provided', async () => {
      mock.onPost(url).reply({})

      await service.createPayment('EXTERNAL', 900)

      expect(mock.history[0].body.external_details).toEqual({ type: 'OTHER', source: 'External payment' })
    })
  })

  describe('updatePayment', () => {
    const url = `${ BASE }/v2/payments/pay1`

    it('sends the amount, tip and version token', async () => {
      mock.onPut(url).reply({})

      await service.updatePayment('pay1', 1200, 200, 'EUR', 'vtok')

      expect(mock.history[0].method).toBe('put')

      expect(mock.history[0].body).toEqual({
        idempotency_key: expect.any(String),
        payment: {
          version_token: 'vtok',
          amount_money: { amount: 1200, currency: 'EUR' },
          tip_money: { amount: 200, currency: 'EUR' },
        },
      })
    })

    it('omits money fields that were not provided', async () => {
      mock.onPut(url).reply({})

      await service.updatePayment('pay1', undefined, undefined, undefined, undefined, 'key-1')

      expect(mock.history[0].body).toEqual({ idempotency_key: 'key-1', payment: {} })
    })
  })

  describe('completePayment', () => {
    it('posts the version token when provided', async () => {
      mock.onPost(`${ BASE }/v2/payments/pay1/complete`).reply({})

      await service.completePayment('pay1', 'vtok')

      expect(mock.history[0].body).toEqual({ version_token: 'vtok' })
    })

    it('posts an empty body without a version token', async () => {
      mock.onPost(`${ BASE }/v2/payments/pay1/complete`).reply({})

      await service.completePayment('pay1')

      expect(mock.history[0].body).toEqual({})
    })
  })

  describe('cancelPayment', () => {
    it('posts an empty body', async () => {
      mock.onPost(`${ BASE }/v2/payments/pay1/cancel`).reply({})

      await service.cancelPayment('pay1')

      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({})
    })
  })

  // ── Refunds ──

  describe('refundPayment', () => {
    it('builds the refund body with a default currency', async () => {
      mock.onPost(`${ BASE }/v2/refunds`).reply({ refund: { id: 'rf1' } })

      await service.refundPayment('pay1', 300, undefined, 'Damaged')

      expect(mock.history[0].body).toEqual({
        idempotency_key: expect.any(String),
        payment_id: 'pay1',
        amount_money: { amount: 300, currency: 'USD' },
        reason: 'Damaged',
      })
    })

    it('uses the supplied currency and idempotency key', async () => {
      mock.onPost(`${ BASE }/v2/refunds`).reply({})

      await service.refundPayment('pay1', 300, 'GBP', undefined, 'key-1')

      expect(mock.history[0].body).toEqual({
        idempotency_key: 'key-1',
        payment_id: 'pay1',
        amount_money: { amount: 300, currency: 'GBP' },
      })
    })
  })

  describe('listRefunds', () => {
    it('maps the sort order and passes the filters', async () => {
      mock.onGet(`${ BASE }/v2/refunds`).reply({ refunds: [] })

      await service.listRefunds('2024-01-01', '2024-02-01', 'Ascending', 'L1', 5, 'cur-1')

      expect(mock.history[0].query).toEqual({
        begin_time: '2024-01-01',
        end_time: '2024-02-01',
        sort_order: 'ASC',
        location_id: 'L1',
        limit: 5,
        cursor: 'cur-1',
      })
    })
  })

  describe('getRefund', () => {
    it('fetches a refund by id', async () => {
      mock.onGet(`${ BASE }/v2/refunds/rf1`).reply({ refund: { id: 'rf1' } })

      await expect(service.getRefund('rf1')).resolves.toEqual({ refund: { id: 'rf1' } })
    })
  })

  // ── Orders ──

  describe('createOrder', () => {
    const url = `${ BASE }/v2/orders`

    it('builds ad-hoc line items with a default quantity and currency', async () => {
      mock.onPost(url).reply({ order: { id: 'ord1' } })

      await service.createOrder('L1', [{ name: 'Coffee', basePrice: 250 }])

      expect(mock.history[0].body).toEqual({
        idempotency_key: expect.any(String),
        order: {
          location_id: 'L1',
          line_items: [{
            quantity: '1',
            name: 'Coffee',
            base_price_money: { amount: 250, currency: 'USD' },
          }],
        },
      })
    })

    it('uses a catalog object id when provided and stringifies the quantity', async () => {
      mock.onPost(url).reply({})

      await service.createOrder('L1', [{ catalogObjectId: 'CAT1', quantity: 3, note: 'Extra hot' }])

      expect(mock.history[0].body.order.line_items).toEqual([{
        quantity: '3',
        note: 'Extra hot',
        catalog_object_id: 'CAT1',
      }])
    })

    it('builds additive taxes with generated uids and a default scope', async () => {
      mock.onPost(url).reply({})

      await service.createOrder('L1', [], undefined, undefined, [
        { name: 'VAT', percentage: 20 },
        { name: 'Local', percentage: '5', scope: 'Line Item' },
      ])

      expect(mock.history[0].body.order.taxes).toEqual([
        { uid: 'tax-0', name: 'VAT', type: 'ADDITIVE', percentage: '20', scope: 'ORDER' },
        { uid: 'tax-1', name: 'Local', type: 'ADDITIVE', percentage: '5', scope: 'LINE_ITEM' },
      ])
    })

    it('builds percentage and fixed-amount discounts', async () => {
      mock.onPost(url).reply({})

      await service.createOrder('L1', [], 'CUST1', 'REF1', undefined, [
        { name: 'Ten Percent', percentage: 10 },
        { name: 'Five Off', amount: 500, currency: 'EUR' },
      ])

      expect(mock.history[0].body.order.customer_id).toBe('CUST1')
      expect(mock.history[0].body.order.reference_id).toBe('REF1')

      expect(mock.history[0].body.order.discounts).toEqual([
        { uid: 'discount-0', name: 'Ten Percent', scope: 'ORDER', type: 'FIXED_PERCENTAGE', percentage: '10' },
        {
          uid: 'discount-1',
          name: 'Five Off',
          scope: 'ORDER',
          type: 'FIXED_AMOUNT',
          amount_money: { amount: 500, currency: 'EUR' },
        },
      ])
    })

    it('omits taxes and discounts when the arrays are empty', async () => {
      mock.onPost(url).reply({})

      await service.createOrder('L1', undefined, undefined, undefined, [], [])

      expect(mock.history[0].body.order).not.toHaveProperty('taxes')
      expect(mock.history[0].body.order).not.toHaveProperty('discounts')
      expect(mock.history[0].body.order.line_items).toEqual([])
    })
  })

  describe('getOrder', () => {
    it('fetches an order by id', async () => {
      mock.onGet(`${ BASE }/v2/orders/ord1`).reply({ order: { id: 'ord1' } })

      await expect(service.getOrder('ord1')).resolves.toEqual({ order: { id: 'ord1' } })
    })
  })

  describe('updateOrder', () => {
    const url = `${ BASE }/v2/orders/ord1`

    it('merges the version into the order and passes fields to clear', async () => {
      mock.onPut(url).reply({})

      await service.updateOrder('ord1', 4, { reference_id: 'REF2' }, ['note'], 'key-1')

      expect(mock.history[0].method).toBe('put')

      expect(mock.history[0].body).toEqual({
        idempotency_key: 'key-1',
        order: { reference_id: 'REF2', version: 4 },
        fields_to_clear: ['note'],
      })
    })

    it('omits an empty fields-to-clear array and defaults the order object', async () => {
      mock.onPut(url).reply({})

      await service.updateOrder('ord1', 1, undefined, [])

      expect(mock.history[0].body.order).toEqual({ version: 1 })
      expect(mock.history[0].body).not.toHaveProperty('fields_to_clear')
    })
  })

  describe('searchOrders', () => {
    const url = `${ BASE }/v2/orders/search`

    it('sends only the location ids when no filters are given', async () => {
      mock.onPost(url).reply({ orders: [] })

      await service.searchOrders(['L1'])

      expect(mock.history[0].body).toEqual({ location_ids: ['L1'] })
    })

    it('maps state labels into a state filter', async () => {
      mock.onPost(url).reply({ orders: [] })

      await service.searchOrders(['L1'], ['Open', 'Completed'])

      expect(mock.history[0].body.query).toEqual({ filter: { state_filter: { states: ['OPEN', 'COMPLETED'] } } })
    })

    it('builds a date-time filter with a sort and maps the field label', async () => {
      mock.onPost(url).reply({ orders: [] })

      await service.searchOrders(['L1'], undefined, 'Updated At', '2024-01-01', '2024-02-01', 'Ascending', 20, 'cur-1')

      expect(mock.history[0].body).toEqual({
        location_ids: ['L1'],
        query: {
          filter: { date_time_filter: { updated_at: { start_at: '2024-01-01', end_at: '2024-02-01' } } },
          sort: { sort_field: 'UPDATED_AT', sort_order: 'ASC' },
        },
        limit: 20,
        cursor: 'cur-1',
      })
    })

    it('defaults the date field to created_at and the sort order to DESC', async () => {
      mock.onPost(url).reply({ orders: [] })

      await service.searchOrders(['L1'], undefined, undefined, '2024-01-01')

      expect(mock.history[0].body.query).toEqual({
        filter: { date_time_filter: { created_at: { start_at: '2024-01-01' } } },
        sort: { sort_field: 'CREATED_AT', sort_order: 'DESC' },
      })
    })

    it('ignores a date field when no time range is supplied', async () => {
      mock.onPost(url).reply({ orders: [] })

      await service.searchOrders(['L1'], undefined, 'Closed At')

      expect(mock.history[0].body).toEqual({ location_ids: ['L1'] })
    })
  })

  describe('payOrder', () => {
    it('sends the order version and payment ids', async () => {
      mock.onPost(`${ BASE }/v2/orders/ord1/pay`).reply({})

      await service.payOrder('ord1', 2, ['pay1'], 'key-1')

      expect(mock.history[0].body).toEqual({
        idempotency_key: 'key-1',
        order_version: 2,
        payment_ids: ['pay1'],
      })
    })

    it('omits an empty payment id array', async () => {
      mock.onPost(`${ BASE }/v2/orders/ord1/pay`).reply({})

      await service.payOrder('ord1', undefined, [])

      expect(mock.history[0].body).toEqual({ idempotency_key: expect.any(String) })
    })
  })

  describe('calculateOrder', () => {
    it('posts the order for calculation', async () => {
      mock.onPost(`${ BASE }/v2/orders/calculate`).reply({ order: {} })

      await service.calculateOrder({ location_id: 'L1' })

      expect(mock.history[0].body).toEqual({ order: { location_id: 'L1' } })
    })
  })

  describe('cloneOrder', () => {
    it('posts the source order id and version', async () => {
      mock.onPost(`${ BASE }/v2/orders/clone`).reply({ order: {} })

      await service.cloneOrder('ord1', 3)

      expect(mock.history[0].body).toEqual({
        idempotency_key: expect.any(String),
        order_id: 'ord1',
        version: 3,
      })
    })
  })

  // ── Catalog ──

  describe('listCatalog', () => {
    const url = `${ BASE }/v2/catalog/list`

    it('joins mapped catalog type labels into a comma-separated list', async () => {
      mock.onGet(url).reply({ objects: [] })

      await service.listCatalog(['Item', 'Item Variation'], 'cur-1')

      expect(mock.history[0].query).toEqual({ types: 'ITEM,ITEM_VARIATION', cursor: 'cur-1' })
    })

    it('omits the types filter when no types are provided', async () => {
      mock.onGet(url).reply({ objects: [] })

      await service.listCatalog([])

      expect(mock.history[0].query).toEqual({})
    })

    it('omits the types filter when types is not an array', async () => {
      mock.onGet(url).reply({ objects: [] })

      await service.listCatalog()

      expect(mock.history[0].query).toEqual({})
    })
  })

  describe('getCatalogObject', () => {
    it('requests related objects only when explicitly enabled', async () => {
      mock.onGet(`${ BASE }/v2/catalog/object/CAT1`).reply({ object: {} })

      await service.getCatalogObject('CAT1', true)

      expect(mock.history[0].query).toEqual({ include_related_objects: 'true' })
    })

    it('omits the related-objects flag by default', async () => {
      mock.onGet(`${ BASE }/v2/catalog/object/CAT1`).reply({ object: {} })

      await service.getCatalogObject('CAT1')

      expect(mock.history[0].query).toEqual({})
    })
  })

  describe('upsertCatalogItem', () => {
    const url = `${ BASE }/v2/catalog/object`

    it('builds an item with a single fixed-price variation', async () => {
      mock.onPost(url).reply({ catalog_object: {} })

      await service.upsertCatalogItem('Coffee', 'Hot drink', 300, 'EUR', 'Large', 'CATEG1')

      expect(mock.history[0].body).toEqual({
        idempotency_key: expect.any(String),
        object: {
          type: 'ITEM',
          id: '#new',
          item_data: {
            name: 'Coffee',
            description: 'Hot drink',
            category_id: 'CATEG1',
            variations: [{
              type: 'ITEM_VARIATION',
              id: '#new-variation',
              item_variation_data: {
                name: 'Large',
                pricing_type: 'FIXED_PRICING',
                price_money: { amount: 300, currency: 'EUR' },
              },
            }],
          },
        },
      })
    })

    it('defaults the variation name and currency', async () => {
      mock.onPost(url).reply({})

      await service.upsertCatalogItem('Coffee', undefined, 300)

      const variation = mock.history[0].body.object.item_data.variations[0].item_variation_data

      expect(variation.name).toBe('Regular')
      expect(variation.price_money).toEqual({ amount: 300, currency: 'USD' })
      expect(mock.history[0].body.object.item_data).not.toHaveProperty('description')
    })

    it('uses a raw object verbatim when provided', async () => {
      mock.onPost(url).reply({})

      await service.upsertCatalogItem(
        'ignored', undefined, undefined, undefined, undefined, undefined,
        { type: 'CATEGORY', id: '#cat' }, 'key-1'
      )

      expect(mock.history[0].body).toEqual({
        idempotency_key: 'key-1',
        object: { type: 'CATEGORY', id: '#cat' },
      })
    })
  })

  describe('deleteCatalogObject', () => {
    it('sends a DELETE for the object', async () => {
      mock.onDelete(`${ BASE }/v2/catalog/object/CAT1`).reply({ deleted_object_ids: ['CAT1'] })

      const result = await service.deleteCatalogObject('CAT1')

      expect(result).toEqual({ deleted_object_ids: ['CAT1'] })
      expect(mock.history[0].method).toBe('delete')
    })
  })

  describe('searchCatalog', () => {
    const url = `${ BASE }/v2/catalog/search`

    it('splits the text filter into at most three keywords', async () => {
      mock.onPost(url).reply({ objects: [] })

      await service.searchCatalog('hot iced cold brew', ['Item'], 10, 'cur-1')

      expect(mock.history[0].body).toEqual({
        object_types: ['ITEM'],
        limit: 10,
        cursor: 'cur-1',
        query: { text_query: { keywords: ['hot', 'iced', 'cold'] } },
      })
    })

    it('omits the text query when no filter is given', async () => {
      mock.onPost(url).reply({ objects: [] })

      await service.searchCatalog()

      expect(mock.history[0].body).toEqual({})
    })
  })

  describe('getCatalogInfo', () => {
    it('fetches the catalog limits', async () => {
      mock.onGet(`${ BASE }/v2/catalog/info`).reply({ limits: {} })

      await expect(service.getCatalogInfo()).resolves.toEqual({ limits: {} })
    })
  })

  // ── Customers ──

  describe('listCustomers', () => {
    it('maps the sort field and order labels', async () => {
      mock.onGet(`${ BASE }/v2/customers`).reply({ customers: [] })

      await service.listCustomers('Created At', 'Descending', 25, 'cur-1')

      expect(mock.history[0].query).toEqual({
        sort_field: 'CREATED_AT',
        sort_order: 'DESC',
        limit: 25,
        cursor: 'cur-1',
      })
    })

    it('omits unset sort options', async () => {
      mock.onGet(`${ BASE }/v2/customers`).reply({ customers: [] })

      await service.listCustomers()

      expect(mock.history[0].query).toEqual({})
    })
  })

  describe('getCustomer', () => {
    it('fetches a customer by id', async () => {
      mock.onGet(`${ BASE }/v2/customers/CUST1`).reply({ customer: { id: 'CUST1' } })

      await expect(service.getCustomer('CUST1')).resolves.toEqual({ customer: { id: 'CUST1' } })
    })
  })

  describe('createCustomer', () => {
    const url = `${ BASE }/v2/customers`

    it('maps the camelCase address into Square snake_case fields', async () => {
      mock.onPost(url).reply({ customer: { id: 'CUST1' } })

      await service.createCustomer('Ada', 'Lovelace', 'Analytical', 'ada@example.com', '+15551234567', {
        addressLine1: '1 Main St',
        addressLine2: 'Apt 2',
        locality: 'Springfield',
        administrativeDistrictLevel1: 'IL',
        postalCode: '62701',
        country: 'US',
      }, 'REF1', 'VIP')

      expect(mock.history[0].body).toEqual({
        idempotency_key: expect.any(String),
        given_name: 'Ada',
        family_name: 'Lovelace',
        company_name: 'Analytical',
        email_address: 'ada@example.com',
        phone_number: '+15551234567',
        address: {
          address_line_1: '1 Main St',
          address_line_2: 'Apt 2',
          locality: 'Springfield',
          administrative_district_level_1: 'IL',
          postal_code: '62701',
          country: 'US',
        },
        reference_id: 'REF1',
        note: 'VIP',
      })
    })

    it('omits the address when it is not provided', async () => {
      mock.onPost(url).reply({})

      await service.createCustomer('Ada')

      expect(mock.history[0].body).toEqual({
        idempotency_key: expect.any(String),
        given_name: 'Ada',
      })
    })

    it('omits an address object with no usable fields', async () => {
      mock.onPost(url).reply({})

      await service.createCustomer('Ada', undefined, undefined, undefined, undefined, { unknown: 'x' })

      expect(mock.history[0].body).not.toHaveProperty('address')
    })
  })

  describe('updateCustomer', () => {
    it('sends only the provided fields and the version', async () => {
      mock.onPut(`${ BASE }/v2/customers/CUST1`).reply({ customer: {} })

      await service.updateCustomer('CUST1', 'Ada', undefined, undefined, 'new@example.com',
        undefined, { locality: 'Springfield' }, undefined, undefined, 7)

      expect(mock.history[0].method).toBe('put')

      expect(mock.history[0].body).toEqual({
        given_name: 'Ada',
        email_address: 'new@example.com',
        address: { locality: 'Springfield' },
        version: 7,
      })
    })
  })

  describe('deleteCustomer', () => {
    it('passes the version as a query param', async () => {
      mock.onDelete(`${ BASE }/v2/customers/CUST1`).reply({})

      await service.deleteCustomer('CUST1', 3)

      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].query).toEqual({ version: 3 })
    })

    it('omits the version when not provided', async () => {
      mock.onDelete(`${ BASE }/v2/customers/CUST1`).reply({})

      await service.deleteCustomer('CUST1')

      expect(mock.history[0].query).toEqual({})
    })
  })

  describe('searchCustomers', () => {
    const url = `${ BASE }/v2/customers/search`

    it('defaults to a fuzzy match across all supplied filters', async () => {
      mock.onPost(url).reply({ customers: [] })

      await service.searchCustomers('ada@example.com', '+1555', 'REF1')

      expect(mock.history[0].body.query.filter).toEqual({
        email_address: { fuzzy: 'ada@example.com' },
        phone_number: { fuzzy: '+1555' },
        reference_id: { fuzzy: 'REF1' },
      })
    })

    it('uses an exact match and adds a created-at sort', async () => {
      mock.onPost(url).reply({ customers: [] })

      await service.searchCustomers('ada@example.com', undefined, undefined, 'Exact', 'Ascending', 10, 'cur-1')

      expect(mock.history[0].body).toEqual({
        query: {
          filter: { email_address: { exact: 'ada@example.com' } },
          sort: { field: 'CREATED_AT', order: 'ASC' },
        },
        limit: 10,
        cursor: 'cur-1',
      })
    })

    it('omits the query entirely when nothing was supplied', async () => {
      mock.onPost(url).reply({ customers: [] })

      await service.searchCustomers()

      expect(mock.history[0].body).toEqual({})
    })
  })

  // ── Cards ──

  describe('createCard', () => {
    it('nests the card details under a card object', async () => {
      mock.onPost(`${ BASE }/v2/cards`).reply({ card: { id: 'card1' } })

      await service.createCard('cnon:x', 'CUST1', 'Ada Lovelace', 'REF1', 'key-1')

      expect(mock.history[0].body).toEqual({
        idempotency_key: 'key-1',
        source_id: 'cnon:x',
        card: { customer_id: 'CUST1', cardholder_name: 'Ada Lovelace', reference_id: 'REF1' },
      })
    })
  })

  describe('listCards', () => {
    it('includes disabled cards only when explicitly enabled', async () => {
      mock.onGet(`${ BASE }/v2/cards`).reply({ cards: [] })

      await service.listCards('CUST1', true, 'cur-1')

      expect(mock.history[0].query).toEqual({
        customer_id: 'CUST1',
        include_disabled: 'true',
        cursor: 'cur-1',
      })
    })

    it('omits the disabled flag by default', async () => {
      mock.onGet(`${ BASE }/v2/cards`).reply({ cards: [] })

      await service.listCards()

      expect(mock.history[0].query).toEqual({})
    })
  })

  describe('getCard', () => {
    it('fetches a card by id', async () => {
      mock.onGet(`${ BASE }/v2/cards/card1`).reply({ card: { id: 'card1' } })

      await expect(service.getCard('card1')).resolves.toEqual({ card: { id: 'card1' } })
    })
  })

  describe('disableCard', () => {
    it('posts an empty body to the disable endpoint', async () => {
      mock.onPost(`${ BASE }/v2/cards/card1/disable`).reply({ card: {} })

      await service.disableCard('card1')

      expect(mock.history[0].body).toEqual({})
    })
  })

  // ── Invoices ──

  describe('createInvoice', () => {
    const url = `${ BASE }/v2/invoices`

    it('builds a full invoice with mapped request and delivery labels', async () => {
      mock.onPost(url).reply({ invoice: { id: 'inv1' } })

      await service.createInvoice(
        'L1', 'ORD1', 'CUST1', '2024-05-01', 'Deposit', 'Share Manually',
        'Invoice title', 'Description', 'INV-1', '2024-04-01T00:00:00Z',
        { card: true, squareGiftCard: false, bankAccount: true }, 'key-1'
      )

      expect(mock.history[0].body).toEqual({
        idempotency_key: 'key-1',
        invoice: {
          location_id: 'L1',
          order_id: 'ORD1',
          primary_recipient: { customer_id: 'CUST1' },
          payment_requests: [{ request_type: 'DEPOSIT', due_date: '2024-05-01' }],
          delivery_method: 'SHARE_MANUALLY',
          title: 'Invoice title',
          description: 'Description',
          invoice_number: 'INV-1',
          scheduled_at: '2024-04-01T00:00:00Z',
          accepted_payment_methods: { card: true, square_gift_card: false, bank_account: true },
        },
      })
    })

    it('defaults the request type to BALANCE and the delivery method to EMAIL', async () => {
      mock.onPost(url).reply({})

      await service.createInvoice('L1', 'ORD1', 'CUST1')

      expect(mock.history[0].body.invoice).toEqual({
        location_id: 'L1',
        order_id: 'ORD1',
        primary_recipient: { customer_id: 'CUST1' },
        payment_requests: [{ request_type: 'BALANCE' }],
        delivery_method: 'EMAIL',
      })

      expect(mock.history[0].body.invoice).not.toHaveProperty('accepted_payment_methods')
    })
  })

  describe('listInvoices', () => {
    it('passes the location filter and paging params', async () => {
      mock.onGet(`${ BASE }/v2/invoices`).reply({ invoices: [] })

      await service.listInvoices('L1', 10, 'cur-1')

      expect(mock.history[0].query).toEqual({ location_id: 'L1', limit: 10, cursor: 'cur-1' })
    })
  })

  describe('getInvoice', () => {
    it('fetches an invoice by id', async () => {
      mock.onGet(`${ BASE }/v2/invoices/inv1`).reply({ invoice: { id: 'inv1' } })

      await expect(service.getInvoice('inv1')).resolves.toEqual({ invoice: { id: 'inv1' } })
    })
  })

  describe('updateInvoice', () => {
    it('merges the version into the invoice and passes fields to clear', async () => {
      mock.onPut(`${ BASE }/v2/invoices/inv1`).reply({})

      await service.updateInvoice('inv1', 2, { title: 'New title' }, ['description'], 'key-1')

      expect(mock.history[0].body).toEqual({
        idempotency_key: 'key-1',
        invoice: { title: 'New title', version: 2 },
        fields_to_clear: ['description'],
      })
    })

    it('omits an empty fields-to-clear array', async () => {
      mock.onPut(`${ BASE }/v2/invoices/inv1`).reply({})

      await service.updateInvoice('inv1', 2, undefined, [])

      expect(mock.history[0].body).not.toHaveProperty('fields_to_clear')
      expect(mock.history[0].body.invoice).toEqual({ version: 2 })
    })
  })

  describe('publishInvoice', () => {
    it('posts the version and an idempotency key', async () => {
      mock.onPost(`${ BASE }/v2/invoices/inv1/publish`).reply({})

      await service.publishInvoice('inv1', 2)

      expect(mock.history[0].body).toEqual({ version: 2, idempotency_key: expect.any(String) })
    })
  })

  describe('cancelInvoice', () => {
    it('posts only the version', async () => {
      mock.onPost(`${ BASE }/v2/invoices/inv1/cancel`).reply({})

      await service.cancelInvoice('inv1', 2)

      expect(mock.history[0].body).toEqual({ version: 2 })
    })
  })

  describe('deleteInvoice', () => {
    it('passes the version as a query param', async () => {
      mock.onDelete(`${ BASE }/v2/invoices/inv1`).reply({})

      await service.deleteInvoice('inv1', 2)

      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].query).toEqual({ version: 2 })
    })
  })

  describe('searchInvoices', () => {
    const url = `${ BASE }/v2/invoices/search`

    it('builds the location and customer filters with a default sort order', async () => {
      mock.onPost(url).reply({ invoices: [] })

      await service.searchInvoices(['L1'], ['CUST1'], undefined, 5, 'cur-1')

      expect(mock.history[0].body).toEqual({
        query: {
          filter: { location_ids: ['L1'], customer_ids: ['CUST1'] },
          sort: { field: 'INVOICE_SORT_DATE', order: 'DESC' },
        },
        limit: 5,
        cursor: 'cur-1',
      })
    })

    it('omits an empty customer id array and maps the sort order', async () => {
      mock.onPost(url).reply({ invoices: [] })

      await service.searchInvoices(['L1'], [], 'Ascending')

      expect(mock.history[0].body.query).toEqual({
        filter: { location_ids: ['L1'] },
        sort: { field: 'INVOICE_SORT_DATE', order: 'ASC' },
      })
    })
  })

  // ── Inventory ──

  describe('getInventoryCount', () => {
    it('joins the location ids into a comma-separated list', async () => {
      mock.onGet(`${ BASE }/v2/inventory/CAT1`).reply({ counts: [] })

      await service.getInventoryCount('CAT1', ['L1', 'L2'], 'cur-1')

      expect(mock.history[0].query).toEqual({ location_ids: 'L1,L2', cursor: 'cur-1' })
    })

    it('omits an empty location id array', async () => {
      mock.onGet(`${ BASE }/v2/inventory/CAT1`).reply({ counts: [] })

      await service.getInventoryCount('CAT1', [])

      expect(mock.history[0].query).toEqual({})
    })
  })

  describe('batchRetrieveInventoryCounts', () => {
    const url = `${ BASE }/v2/inventory/counts/batch-retrieve`

    it('posts the catalog and location filters', async () => {
      mock.onPost(url).reply({ counts: [] })

      await service.batchRetrieveInventoryCounts(['CAT1'], ['L1'], '2024-01-01', 'cur-1')

      expect(mock.history[0].body).toEqual({
        catalog_object_ids: ['CAT1'],
        location_ids: ['L1'],
        updated_after: '2024-01-01',
        cursor: 'cur-1',
      })
    })

    it('omits empty arrays', async () => {
      mock.onPost(url).reply({ counts: [] })

      await service.batchRetrieveInventoryCounts([], [])

      expect(mock.history[0].body).toEqual({})
    })
  })

  describe('adjustInventory', () => {
    const url = `${ BASE }/v2/inventory/changes/batch-create`

    it('builds an adjustment change with mapped states', async () => {
      mock.onPost(url).reply({ counts: [] })

      await service.adjustInventory('CAT1', 'L1', 5, 'None', 'In Stock', '2024-01-01T00:00:00Z', 'key-1')

      expect(mock.history[0].body).toEqual({
        idempotency_key: 'key-1',
        changes: [{
          type: 'ADJUSTMENT',
          adjustment: {
            catalog_object_id: 'CAT1',
            location_id: 'L1',
            from_state: 'NONE',
            to_state: 'IN_STOCK',
            quantity: '5',
            occurred_at: '2024-01-01T00:00:00Z',
          },
        }],
      })
    })

    it('defaults the occurred-at timestamp to now', async () => {
      mock.onPost(url).reply({})

      await service.adjustInventory('CAT1', 'L1', 2, 'In Stock', 'Sold')

      const { adjustment } = mock.history[0].body.changes[0]

      expect(adjustment.occurred_at).toEqual(expect.any(String))
      expect(Number.isNaN(Date.parse(adjustment.occurred_at))).toBe(false)
      expect(adjustment.from_state).toBe('IN_STOCK')
      expect(adjustment.to_state).toBe('SOLD')
    })
  })

  describe('recordPhysicalCount', () => {
    const url = `${ BASE }/v2/inventory/changes/batch-create`

    it('builds a physical-count change with the mapped state', async () => {
      mock.onPost(url).reply({})

      await service.recordPhysicalCount('CAT1', 'L1', 12, 'Waste', '2024-01-01T00:00:00Z', 'key-1')

      expect(mock.history[0].body).toEqual({
        idempotency_key: 'key-1',
        changes: [{
          type: 'PHYSICAL_COUNT',
          physical_count: {
            catalog_object_id: 'CAT1',
            location_id: 'L1',
            state: 'WASTE',
            quantity: '12',
            occurred_at: '2024-01-01T00:00:00Z',
          },
        }],
      })
    })

    it('defaults the state to IN_STOCK and generates a timestamp', async () => {
      mock.onPost(url).reply({})

      await service.recordPhysicalCount('CAT1', 'L1', 4)

      const { physical_count: physicalCount } = mock.history[0].body.changes[0]

      expect(physicalCount.state).toBe('IN_STOCK')
      expect(Number.isNaN(Date.parse(physicalCount.occurred_at))).toBe(false)
    })
  })

  // ── Subscriptions ──

  describe('createSubscription', () => {
    it('posts the subscription fields', async () => {
      mock.onPost(`${ BASE }/v2/subscriptions`).reply({ subscription: { id: 'sub1' } })

      await service.createSubscription('L1', 'PLANVAR1', 'CUST1', '2024-05-01', 'card1', 'UTC', 'key-1')

      expect(mock.history[0].body).toEqual({
        idempotency_key: 'key-1',
        location_id: 'L1',
        plan_variation_id: 'PLANVAR1',
        customer_id: 'CUST1',
        start_date: '2024-05-01',
        card_id: 'card1',
        timezone: 'UTC',
      })
    })

    it('omits the optional fields', async () => {
      mock.onPost(`${ BASE }/v2/subscriptions`).reply({})

      await service.createSubscription('L1', 'PLANVAR1', 'CUST1')

      expect(mock.history[0].body).toEqual({
        idempotency_key: expect.any(String),
        location_id: 'L1',
        plan_variation_id: 'PLANVAR1',
        customer_id: 'CUST1',
      })
    })
  })

  describe('searchSubscriptions', () => {
    const url = `${ BASE }/v2/subscriptions/search`

    it('builds a filter from the customer and location ids', async () => {
      mock.onPost(url).reply({ subscriptions: [] })

      await service.searchSubscriptions(['CUST1'], ['L1'], 10, 'cur-1')

      expect(mock.history[0].body).toEqual({
        query: { filter: { customer_ids: ['CUST1'], location_ids: ['L1'] } },
        limit: 10,
        cursor: 'cur-1',
      })
    })

    it('omits the query when no filters are supplied', async () => {
      mock.onPost(url).reply({ subscriptions: [] })

      await service.searchSubscriptions()

      expect(mock.history[0].body).toEqual({})
    })
  })

  describe('getSubscription', () => {
    it('fetches a subscription by id', async () => {
      mock.onGet(`${ BASE }/v2/subscriptions/sub1`).reply({ subscription: { id: 'sub1' } })

      await expect(service.getSubscription('sub1')).resolves.toEqual({ subscription: { id: 'sub1' } })
    })
  })

  describe('updateSubscription', () => {
    const url = `${ BASE }/v2/subscriptions/sub1`

    it('merges the version into the subscription payload', async () => {
      mock.onPut(url).reply({})

      await service.updateSubscription('sub1', { card_id: 'card1' }, 4)

      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].body).toEqual({ subscription: { card_id: 'card1', version: 4 } })
    })

    it('sends an empty subscription object when nothing is provided', async () => {
      mock.onPut(url).reply({})

      await service.updateSubscription('sub1')

      expect(mock.history[0].body).toEqual({ subscription: {} })
    })
  })

  describe('cancelSubscription', () => {
    it('posts an empty body', async () => {
      mock.onPost(`${ BASE }/v2/subscriptions/sub1/cancel`).reply({})

      await service.cancelSubscription('sub1')

      expect(mock.history[0].body).toEqual({})
    })
  })

  describe('pauseSubscription', () => {
    it('posts the pause options', async () => {
      mock.onPost(`${ BASE }/v2/subscriptions/sub1/pause`).reply({})

      await service.pauseSubscription('sub1', '2024-06-01', 2, 'Vacation')

      expect(mock.history[0].body).toEqual({
        pause_effective_date: '2024-06-01',
        pause_cycle_duration: 2,
        pause_reason: 'Vacation',
      })
    })

    it('posts an empty body when nothing is supplied', async () => {
      mock.onPost(`${ BASE }/v2/subscriptions/sub1/pause`).reply({})

      await service.pauseSubscription('sub1')

      expect(mock.history[0].body).toEqual({})
    })
  })

  describe('resumeSubscription', () => {
    it('maps the resume timing label', async () => {
      mock.onPost(`${ BASE }/v2/subscriptions/sub1/resume`).reply({})

      await service.resumeSubscription('sub1', '2024-07-01', 'End Of Billing Cycle')

      expect(mock.history[0].body).toEqual({
        resume_effective_date: '2024-07-01',
        resume_change_timing: 'END_OF_BILLING_CYCLE',
      })
    })

    it('omits the timing when not supplied', async () => {
      mock.onPost(`${ BASE }/v2/subscriptions/sub1/resume`).reply({})

      await service.resumeSubscription('sub1')

      expect(mock.history[0].body).toEqual({})
    })
  })

  // ── Payouts ──

  describe('listPayouts', () => {
    it('maps the status and sort order labels', async () => {
      mock.onGet(`${ BASE }/v2/payouts`).reply({ payouts: [] })

      await service.listPayouts('L1', 'Paid', '2024-01-01', '2024-02-01', 'Descending', 10, 'cur-1')

      expect(mock.history[0].query).toEqual({
        location_id: 'L1',
        status: 'PAID',
        begin_time: '2024-01-01',
        end_time: '2024-02-01',
        sort_order: 'DESC',
        limit: 10,
        cursor: 'cur-1',
      })
    })

    it('omits all unset filters', async () => {
      mock.onGet(`${ BASE }/v2/payouts`).reply({ payouts: [] })

      await service.listPayouts()

      expect(mock.history[0].query).toEqual({})
    })
  })

  describe('getPayout', () => {
    it('fetches a payout by id', async () => {
      mock.onGet(`${ BASE }/v2/payouts/po1`).reply({ payout: { id: 'po1' } })

      await expect(service.getPayout('po1')).resolves.toEqual({ payout: { id: 'po1' } })
    })
  })

  describe('listPayoutEntries', () => {
    it('requests the entries of a payout', async () => {
      mock.onGet(`${ BASE }/v2/payouts/po1/payout-entries`).reply({ payout_entries: [] })

      await service.listPayoutEntries('po1', 'Ascending', 5, 'cur-1')

      expect(mock.history[0].query).toEqual({ sort_order: 'ASC', limit: 5, cursor: 'cur-1' })
    })
  })

  // ── Team ──

  describe('searchTeamMembers', () => {
    const url = `${ BASE }/v2/team-members/search`

    it('builds a filter from the locations and status', async () => {
      mock.onPost(url).reply({ team_members: [] })

      await service.searchTeamMembers(['L1'], 'Active', 10, 'cur-1')

      expect(mock.history[0].body).toEqual({
        query: { filter: { location_ids: ['L1'], status: 'ACTIVE' } },
        limit: 10,
        cursor: 'cur-1',
      })
    })

    it('omits the query when no filters are supplied', async () => {
      mock.onPost(url).reply({ team_members: [] })

      await service.searchTeamMembers([])

      expect(mock.history[0].body).toEqual({})
    })
  })

  describe('getTeamMember', () => {
    it('fetches a team member by id', async () => {
      mock.onGet(`${ BASE }/v2/team-members/TM1`).reply({ team_member: { id: 'TM1' } })

      await expect(service.getTeamMember('TM1')).resolves.toEqual({ team_member: { id: 'TM1' } })
    })
  })

  // ── Dictionaries ──

  describe('getLocationsDictionary', () => {
    const url = `${ BASE }/v2/locations`

    it('maps locations with an address and status note', async () => {
      mock.onGet(url).reply({
        locations: [
          {
            id: 'L1',
            name: 'Main',
            status: 'ACTIVE',
            address: { locality: 'Springfield', administrative_district_level_1: 'IL' },
          },
          { id: 'L2' },
        ],
      })

      const result = await service.getLocationsDictionary({})

      expect(result).toEqual({
        items: [
          { label: 'Main', value: 'L1', note: 'Springfield, IL - ACTIVE' },
          { label: 'L2', value: 'L2', note: undefined },
        ],
        cursor: null,
      })
    })

    it('filters case-insensitively by name', async () => {
      mock.onGet(url).reply({
        locations: [{ id: 'L1', name: 'Main' }, { id: 'L2', name: 'Warehouse' }],
      })

      const result = await service.getLocationsDictionary({ search: 'ware' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('L2')
    })

    it('handles a null payload and an empty response', async () => {
      mock.onGet(url).reply({})

      await expect(service.getLocationsDictionary(null)).resolves.toEqual({ items: [], cursor: null })
    })
  })

  describe('getCustomersDictionary', () => {
    it('lists customers and filters them locally for a non-email search', async () => {
      mock.onGet(`${ BASE }/v2/customers`).reply({
        customers: [
          { id: 'C1', given_name: 'Ada', family_name: 'Lovelace', email_address: 'ada@example.com' },
          { id: 'C2', company_name: 'Globex' },
        ],
        cursor: 'next-1',
      })

      const result = await service.getCustomersDictionary({ search: 'globex', cursor: 'cur-1' })

      expect(result).toEqual({
        items: [{ label: 'Globex', value: 'C2', note: undefined }],
        cursor: 'next-1',
      })

      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].query).toEqual({ limit: 50, cursor: 'cur-1' })
    })

    it('maps names, company and email fallbacks and phone notes', async () => {
      mock.onGet(`${ BASE }/v2/customers`).reply({
        customers: [
          { id: 'C1', given_name: 'Ada', family_name: 'Lovelace', email_address: 'ada@example.com' },
          { id: 'C2', phone_number: '+1555' },
          { id: 'C3' },
        ],
      })

      const result = await service.getCustomersDictionary({})

      expect(result).toEqual({
        items: [
          { label: 'Ada Lovelace', value: 'C1', note: 'ada@example.com' },
          { label: 'C2', value: 'C2', note: '+1555' },
          { label: 'C3', value: 'C3', note: undefined },
        ],
        cursor: null,
      })
    })

    it('uses the search endpoint for an email-like search', async () => {
      mock.onPost(`${ BASE }/v2/customers/search`).reply({
        customers: [{ id: 'C1', email_address: 'ada@example.com' }],
        cursor: 'next-1',
      })

      const result = await service.getCustomersDictionary({ search: 'ada@example.com', cursor: 'cur-1' })

      expect(mock.history[0].method).toBe('post')

      expect(mock.history[0].body).toEqual({
        query: { filter: { email_address: { fuzzy: 'ada@example.com' } } },
        limit: 50,
        cursor: 'cur-1',
      })

      expect(result.items).toEqual([{ label: 'ada@example.com', value: 'C1', note: 'ada@example.com' }])
      expect(result.cursor).toBe('next-1')
    })

    it('handles a null payload and an empty response', async () => {
      mock.onGet(`${ BASE }/v2/customers`).reply({})

      await expect(service.getCustomersDictionary(null)).resolves.toEqual({ items: [], cursor: null })
    })
  })

  describe('getCatalogItemsDictionary', () => {
    const url = `${ BASE }/v2/catalog/search`

    it('searches items and maps the price into a note', async () => {
      mock.onPost(url).reply({
        objects: [
          {
            id: 'CAT1',
            item_data: {
              name: 'Coffee',
              variations: [{ item_variation_data: { price_money: { amount: 300, currency: 'USD' } } }],
            },
          },
          { id: 'CAT2' },
        ],
        cursor: 'next-1',
      })

      const result = await service.getCatalogItemsDictionary({ search: 'hot coffee', cursor: 'cur-1' })

      expect(mock.history[0].body).toEqual({
        object_types: ['ITEM'],
        limit: 50,
        cursor: 'cur-1',
        query: { text_query: { keywords: ['hot', 'coffee'] } },
      })

      expect(result).toEqual({
        items: [
          { label: 'Coffee', value: 'CAT1', note: '300 USD' },
          { label: 'CAT2', value: 'CAT2', note: undefined },
        ],
        cursor: 'next-1',
      })
    })

    it('omits the text query and handles a null payload', async () => {
      mock.onPost(url).reply({})

      const result = await service.getCatalogItemsDictionary(null)

      expect(mock.history[0].body).toEqual({ object_types: ['ITEM'], limit: 50 })
      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('joins Square error details into the thrown message', async () => {
      mock.onGet(`${ BASE }/v2/locations`).replyWithError({
        message: 'Unauthorized',
        status: 401,
        body: { errors: [{ detail: 'Bad token' }, { detail: 'Try again' }] },
      })

      await expect(service.listLocations()).rejects.toThrow('Square API error: Bad token; Try again')
    })

    it('falls back to the error code or category when there is no detail', async () => {
      mock.onGet(`${ BASE }/v2/locations`).replyWithError({
        message: 'Bad Request',
        body: { errors: [{ code: 'INVALID_REQUEST' }, { category: 'API_ERROR' }] },
      })

      await expect(service.listLocations()).rejects.toThrow('Square API error: INVALID_REQUEST; API_ERROR')
    })

    it('falls back to body.message when no errors array is present', async () => {
      mock.onGet(`${ BASE }/v2/locations`).replyWithError({
        message: 'Bad Request',
        body: { message: 'Something went wrong' },
      })

      await expect(service.listLocations()).rejects.toThrow('Square API error: Something went wrong')
    })

    it('falls back to the transport error message', async () => {
      mock.onGet(`${ BASE }/v2/locations`).replyWithError({ message: 'Network timeout' })

      await expect(service.listLocations()).rejects.toThrow('Square API error: Network timeout')
    })

    it('surfaces errors from POST endpoints too', async () => {
      mock.onPost(`${ BASE }/v2/payments`).replyWithError({
        message: 'Bad Request',
        body: { errors: [{ detail: 'Card declined' }] },
      })

      await expect(service.createPayment('cnon:x', 100)).rejects.toThrow('Square API error: Card declined')
    })
  })
})

describe('Square Service (sandbox environment)', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    jest.resetModules()
    sandbox = createSandbox({ accessToken: ACCESS_TOKEN, environment: 'Sandbox' })
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

  it('targets the sandbox base url', async () => {
    mock.onGet(`${ SANDBOX_BASE }/v2/locations`).reply({ locations: [] })

    await service.listLocations()

    expect(service.baseUrl).toBe(SANDBOX_BASE)
    expect(mock.history[0].url).toBe(`${ SANDBOX_BASE }/v2/locations`)
  })
})

describe('Square Service (unknown environment)', () => {
  let sandbox
  let service

  beforeAll(() => {
    jest.resetModules()
    sandbox = createSandbox({ accessToken: ACCESS_TOKEN, environment: 'Nonsense' })
    require('../src/index.js')
    service = sandbox.getService()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  it('falls back to the production base url', () => {
    expect(service.baseUrl).toBe(BASE)
  })
})
