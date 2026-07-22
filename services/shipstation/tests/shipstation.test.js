'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-api-key'
const API_SECRET = 'test-api-secret'
const BASE = 'https://ssapi.shipstation.com'

const AUTH_HEADER = `Basic ${ Buffer.from(`${ API_KEY }:${ API_SECRET }`).toString('base64') }`

describe('ShipStation Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ apiKey: API_KEY, apiSecret: API_SECRET })
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

      expect(configItems.map(item => item.name)).toEqual(['apiKey', 'apiSecret'])

      expect(configItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'apiKey', required: true, shared: false, type: 'STRING' }),
          expect.objectContaining({ name: 'apiSecret', required: true, shared: false, type: 'STRING' }),
        ])
      )
    })

    it('builds the basic auth header from the key and secret', () => {
      expect(service.apiKey).toBe(API_KEY)
      expect(service.apiSecret).toBe(API_SECRET)
      expect(service.auth).toBe(Buffer.from(`${ API_KEY }:${ API_SECRET }`).toString('base64'))
    })
  })

  // ── Shared request behaviour ──

  describe('request behaviour', () => {
    it('sends the auth and content-type headers on every request', async () => {
      mock.onGet(`${ BASE }/carriers`).reply([])

      await service.listCarriers()

      expect(mock.history[0].headers).toMatchObject({
        Authorization: AUTH_HEADER,
        'Content-Type': 'application/json',
      })
    })

    it('strips empty, null and undefined query values', async () => {
      mock.onGet(`${ BASE }/orders`).reply({ orders: [] })

      await service.listOrders(undefined, null, '', undefined, 'ORD-1')

      expect(mock.history[0].query).toEqual({ orderNumber: 'ORD-1' })
    })

    it('does not send a body on read requests', async () => {
      mock.onGet(`${ BASE }/warehouses`).reply([])

      await service.listWarehouses()

      expect(mock.history[0].body).toBeUndefined()
    })

    it('throws with the ExceptionMessage from the API', async () => {
      mock.onGet(`${ BASE }/carriers`).replyWithError({
        message: 'Request failed',
        status: 500,
        body: { ExceptionMessage: 'Boom exploded' },
      })

      await expect(service.listCarriers()).rejects.toThrow('ShipStation API request failed: Boom exploded')
    })

    it('falls back to Message, message, a string body and finally error.message', async () => {
      mock.onGet(`${ BASE }/carriers`).replyWithError({ message: 'x', body: { Message: 'Authorization has been denied.' } })
      await expect(service.listCarriers()).rejects.toThrow('ShipStation API request failed: Authorization has been denied.')

      mock.reset()
      mock.onGet(`${ BASE }/carriers`).replyWithError({ message: 'x', body: { message: 'lowercase message' } })
      await expect(service.listCarriers()).rejects.toThrow('ShipStation API request failed: lowercase message')

      mock.reset()
      mock.onGet(`${ BASE }/carriers`).replyWithError({ message: 'x', body: 'plain text failure' })
      await expect(service.listCarriers()).rejects.toThrow('ShipStation API request failed: plain text failure')

      mock.reset()
      mock.onGet(`${ BASE }/carriers`).replyWithError({ message: 'Network timeout' })
      await expect(service.listCarriers()).rejects.toThrow('ShipStation API request failed: Network timeout')
    })
  })

  // ── Dictionaries ──

  describe('getCarriersDictionary', () => {
    it('maps carriers to dictionary items', async () => {
      mock.onGet(`${ BASE }/carriers`).reply([
        { name: 'Stamps.com', nickname: 'My USPS', code: 'stamps_com' },
        { name: 'UPS', nickname: null, code: 'ups' },
      ])

      const result = await service.getCarriersDictionary({})

      expect(result).toEqual({
        items: [
          { label: 'My USPS', value: 'stamps_com', note: 'Code: stamps_com' },
          { label: 'UPS', value: 'ups', note: 'Code: ups' },
        ],
        cursor: null,
      })
    })

    it('filters by case-insensitive search over label and value', async () => {
      mock.onGet(`${ BASE }/carriers`).reply([
        { name: 'Stamps.com', code: 'stamps_com' },
        { name: 'UPS', code: 'ups' },
      ])

      const result = await service.getCarriersDictionary({ search: 'UPS' })

      expect(result.items).toEqual([{ label: 'UPS', value: 'ups', note: 'Code: ups' }])
    })

    it('handles a null payload and an empty response', async () => {
      mock.onGet(`${ BASE }/carriers`).reply(null)

      const result = await service.getCarriersDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getCarrierServicesDictionary', () => {
    it('returns an empty list without hitting the API when no carrier is selected', async () => {
      const result = await service.getCarrierServicesDictionary({ criteria: {} })

      expect(result).toEqual({ items: [], cursor: null })
      expect(mock.history).toHaveLength(0)
    })

    it('lists the services for the selected carrier', async () => {
      mock.onGet(`${ BASE }/carriers/listservices`).reply([
        { name: 'USPS Priority Mail', code: 'usps_priority_mail', domestic: true },
        { name: 'USPS Priority Mail International', code: 'usps_priority_mail_international', domestic: false },
      ])

      const result = await service.getCarrierServicesDictionary({ criteria: { carrierCode: 'stamps_com' } })

      expect(mock.history[0].query).toEqual({ carrierCode: 'stamps_com' })

      expect(result.items).toEqual([
        { label: 'USPS Priority Mail', value: 'usps_priority_mail', note: 'Domestic' },
        { label: 'USPS Priority Mail International', value: 'usps_priority_mail_international', note: 'International' },
      ])
    })

    it('filters services by search', async () => {
      mock.onGet(`${ BASE }/carriers/listservices`).reply([
        { name: 'USPS Priority Mail', code: 'usps_priority_mail', domestic: true },
        { name: 'USPS First Class', code: 'usps_first_class', domestic: true },
      ])

      const result = await service.getCarrierServicesDictionary({
        search: 'first',
        criteria: { carrierCode: 'stamps_com' },
      })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('usps_first_class')
    })

    it('handles a missing payload', async () => {
      const result = await service.getCarrierServicesDictionary()

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getCarrierPackagesDictionary', () => {
    it('returns an empty list when no carrier is selected', async () => {
      const result = await service.getCarrierPackagesDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
      expect(mock.history).toHaveLength(0)
    })

    it('lists and filters packages for the selected carrier', async () => {
      mock.onGet(`${ BASE }/carriers/listpackages`).reply([
        { name: 'Package', code: 'package' },
        { name: 'Flat Rate Envelope', code: 'flat_rate_envelope' },
      ])

      const all = await service.getCarrierPackagesDictionary({ criteria: { carrierCode: 'ups' } })

      expect(mock.history[0].query).toEqual({ carrierCode: 'ups' })

      expect(all.items).toEqual([
        { label: 'Package', value: 'package', note: 'Code: package' },
        { label: 'Flat Rate Envelope', value: 'flat_rate_envelope', note: 'Code: flat_rate_envelope' },
      ])

      const filtered = await service.getCarrierPackagesDictionary({
        search: 'envelope',
        criteria: { carrierCode: 'ups' },
      })

      expect(filtered.items).toHaveLength(1)
    })

    it('handles an empty package response', async () => {
      mock.onGet(`${ BASE }/carriers/listpackages`).reply(null)

      const result = await service.getCarrierPackagesDictionary({ criteria: { carrierCode: 'ups' } })

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getStoresDictionary', () => {
    it('lists stores including inactive ones', async () => {
      mock.onGet(`${ BASE }/stores`).reply([
        { storeId: 1, storeName: 'Manual Orders', marketplaceName: 'Manual' },
        { storeId: 2, storeName: 'Shopify Shop' },
      ])

      const result = await service.getStoresDictionary({})

      expect(mock.history[0].query).toEqual({ showInactive: true })

      expect(result).toEqual({
        items: [
          { label: 'Manual Orders', value: 1, note: 'Marketplace: Manual' },
          { label: 'Shopify Shop', value: 2, note: 'ID: 2' },
        ],
        cursor: null,
      })
    })

    it('filters stores by label only', async () => {
      mock.onGet(`${ BASE }/stores`).reply([
        { storeId: 1, storeName: 'Manual Orders' },
        { storeId: 2, storeName: 'Shopify Shop' },
      ])

      const result = await service.getStoresDictionary({ search: 'shopify' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe(2)
    })

    it('handles an empty response and a missing payload', async () => {
      mock.onGet(`${ BASE }/stores`).reply(null)

      const result = await service.getStoresDictionary()

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getWarehousesDictionary', () => {
    it('maps warehouses and flags the default one', async () => {
      mock.onGet(`${ BASE }/warehouses`).reply([
        { warehouseId: 10, warehouseName: 'Main', isDefault: true },
        { warehouseId: 11, warehouseName: 'Overflow', isDefault: false },
      ])

      const result = await service.getWarehousesDictionary({})

      expect(result).toEqual({
        items: [
          { label: 'Main', value: 10, note: 'Default' },
          { label: 'Overflow', value: 11, note: 'ID: 11' },
        ],
        cursor: null,
      })
    })

    it('filters warehouses by search', async () => {
      mock.onGet(`${ BASE }/warehouses`).reply([
        { warehouseId: 10, warehouseName: 'Main' },
        { warehouseId: 11, warehouseName: 'Overflow' },
      ])

      const result = await service.getWarehousesDictionary({ search: 'over' })

      expect(result.items).toHaveLength(1)
    })

    it('handles an empty response', async () => {
      mock.onGet(`${ BASE }/warehouses`).reply(null)

      expect(await service.getWarehousesDictionary()).toEqual({ items: [], cursor: null })
    })
  })

  describe('getTagsDictionary', () => {
    it('maps tags and their colors', async () => {
      mock.onGet(`${ BASE }/accounts/listtags`).reply([
        { tagId: 1, name: 'Rush', color: '#ff0000' },
        { tagId: 2, name: 'Fragile' },
      ])

      const result = await service.getTagsDictionary({})

      expect(result).toEqual({
        items: [
          { label: 'Rush', value: 1, note: 'Color: #ff0000' },
          { label: 'Fragile', value: 2, note: 'ID: 2' },
        ],
        cursor: null,
      })
    })

    it('filters tags by search', async () => {
      mock.onGet(`${ BASE }/accounts/listtags`).reply([
        { tagId: 1, name: 'Rush' },
        { tagId: 2, name: 'Fragile' },
      ])

      const result = await service.getTagsDictionary({ search: 'FRAG' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe(2)
    })

    it('handles an empty response', async () => {
      mock.onGet(`${ BASE }/accounts/listtags`).reply(null)

      expect(await service.getTagsDictionary()).toEqual({ items: [], cursor: null })
    })
  })

  describe('static dictionaries', () => {
    it('returns the order statuses', () => {
      const result = service.getOrderStatusesDictionary()

      expect(result.items.map(item => item.value)).toEqual([
        'awaiting_payment',
        'awaiting_shipment',
        'pending_fulfillment',
        'shipped',
        'on_hold',
        'cancelled',
        'rejected_fulfillment',
      ])

      expect(result.items.every(item => item.label && item.note)).toBe(true)
    })

    it('returns the webhook events', () => {
      const result = service.getWebhookEventsDictionary()

      expect(result.items.map(item => item.value)).toEqual([
        'ORDER_NOTIFY',
        'ITEM_ORDER_NOTIFY',
        'SHIP_NOTIFY',
        'ITEM_SHIP_NOTIFY',
        'FULFILLMENT_SHIPPED',
        'FULFILLMENT_REJECTED',
      ])
    })

    it('returns the confirmation types', () => {
      const result = service.getConfirmationTypesDictionary()

      expect(result.items.map(item => item.value)).toEqual([
        'none',
        'delivery',
        'signature',
        'adult_signature',
        'direct_signature',
      ])
    })
  })

  // ── Schema loaders ──

  describe('schema loaders', () => {
    it('describes the insurance options schema', () => {
      const schema = service.createInsuranceOptionsSchema()

      expect(schema.map(field => field.name)).toEqual(['provider', 'insureShipment', 'insuredValue'])
      expect(schema[0].uiComponent.options.values).toContain('Shipsurance')
    })

    it('describes the international options schema', () => {
      const schema = service.createInternationalOptionsSchema()

      expect(schema.map(field => field.name)).toEqual(['contents', 'customsItems', 'nonDelivery'])
      expect(schema[1].type).toBe('Array')
    })

    it('describes the advanced options schema with dictionary bindings', () => {
      const schema = service.createAdvancedOptionsSchema()
      const byName = Object.fromEntries(schema.map(field => [field.name, field]))

      expect(byName.warehouseId.dictionary).toBe('getWarehousesDictionary')
      expect(byName.storeId.dictionary).toBe('getStoresDictionary')
      expect(byName.billToParty.uiComponent.options.values).toContain('Third Party')
      expect(schema.every(field => field.required === false)).toBe(true)
    })
  })

  // ── Orders ──

  describe('listOrders', () => {
    it('maps the sort labels and forwards all filters', async () => {
      mock.onGet(`${ BASE }/orders`).reply({ orders: [], total: 0, page: 1, pages: 0 })

      await service.listOrders(
        'awaiting_shipment',
        99,
        'Jane',
        'widget',
        'ORD-1',
        '2025-01-01',
        '2025-01-31',
        '2025-02-01',
        '2025-02-28',
        'Modify Date',
        'Descending',
        2,
        50
      )

      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/orders`)

      expect(mock.history[0].query).toEqual({
        orderStatus: 'awaiting_shipment',
        storeId: 99,
        customerName: 'Jane',
        itemKeyword: 'widget',
        orderNumber: 'ORD-1',
        createDateStart: '2025-01-01',
        createDateEnd: '2025-01-31',
        modifyDateStart: '2025-02-01',
        modifyDateEnd: '2025-02-28',
        sortBy: 'ModifyDate',
        sortDir: 'DESC',
        page: 2,
        pageSize: 50,
      })
    })

    it('passes already-normalized sort values through unchanged', async () => {
      mock.onGet(`${ BASE }/orders`).reply({ orders: [] })

      await service.listOrders(undefined, undefined, undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, 'OrderDate', 'ASC')

      expect(mock.history[0].query).toEqual({ sortBy: 'OrderDate', sortDir: 'ASC' })
    })

    it('returns the API payload', async () => {
      mock.onGet(`${ BASE }/orders`).reply({ orders: [{ orderId: 1 }], total: 1, page: 1, pages: 1 })

      const result = await service.listOrders()

      expect(result).toEqual({ orders: [{ orderId: 1 }], total: 1, page: 1, pages: 1 })
    })
  })

  describe('getOrder', () => {
    it('requests a single order by id', async () => {
      mock.onGet(`${ BASE }/orders/12345`).reply({ orderId: 12345 })

      const result = await service.getOrder(12345)

      expect(result).toEqual({ orderId: 12345 })
      expect(mock.history[0].url).toBe(`${ BASE }/orders/12345`)
    })

    it('throws when the order is missing', async () => {
      mock.onGet(`${ BASE }/orders/999`).replyWithError({ message: 'x', status: 404, body: { Message: 'Not Found' } })

      await expect(service.getOrder(999)).rejects.toThrow('ShipStation API request failed: Not Found')
    })
  })

  describe('createOrUpdateOrder', () => {
    it('posts a cleaned order payload', async () => {
      mock.onPost(`${ BASE }/orders/createorder`).reply({ orderId: 1, orderNumber: 'ORD-1' })

      const shipTo = { name: 'Jane', street1: '1 Main St', city: 'Austin', state: 'TX', postalCode: '78701', country: 'US' }

      const result = await service.createOrUpdateOrder(
        'ORD-1',
        '2025-01-01T00:00:00',
        'awaiting_shipment',
        null,
        shipTo,
        '',
        undefined,
        'jane@example.com',
        [{ sku: 'A', quantity: 1 }],
        10,
        1,
        2,
        'thanks',
        'internal',
        true,
        'Happy birthday'
      )

      expect(result).toEqual({ orderId: 1, orderNumber: 'ORD-1' })
      expect(mock.history[0].method).toBe('post')

      expect(mock.history[0].body).toEqual({
        orderNumber: 'ORD-1',
        orderDate: '2025-01-01T00:00:00',
        orderStatus: 'awaiting_shipment',
        shipTo,
        customerEmail: 'jane@example.com',
        items: [{ sku: 'A', quantity: 1 }],
        amountPaid: 10,
        taxAmount: 1,
        shippingAmount: 2,
        customerNotes: 'thanks',
        internalNotes: 'internal',
        gift: true,
        giftMessage: 'Happy birthday',
      })
    })

    it('omits every optional field that was not supplied', async () => {
      mock.onPost(`${ BASE }/orders/createorder`).reply({ orderId: 2 })

      await service.createOrUpdateOrder('ORD-2', '2025-01-02T00:00:00', 'awaiting_shipment', undefined, { name: 'Jo' })

      expect(mock.history[0].body).toEqual({
        orderNumber: 'ORD-2',
        orderDate: '2025-01-02T00:00:00',
        orderStatus: 'awaiting_shipment',
        shipTo: { name: 'Jo' },
      })
    })
  })

  describe('deleteOrder', () => {
    it('sends a DELETE for the order', async () => {
      mock.onDelete(`${ BASE }/orders/12345`).reply({ success: true })

      const result = await service.deleteOrder(12345)

      expect(result).toEqual({ success: true })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].body).toBeUndefined()
    })
  })

  describe('markOrderAsShipped', () => {
    it('posts the shipping details', async () => {
      mock.onPost(`${ BASE }/orders/markasshipped`).reply({ orderId: 1, orderStatus: 'shipped' })

      const result = await service.markOrderAsShipped(1, 'stamps_com', '2025-01-05', '9400111', true, false)

      expect(result).toEqual({ orderId: 1, orderStatus: 'shipped' })

      expect(mock.history[0].body).toEqual({
        orderId: 1,
        carrierCode: 'stamps_com',
        shipDate: '2025-01-05',
        trackingNumber: '9400111',
        notifyCustomer: true,
        notifySalesChannel: false,
      })
    })

    it('drops the optional notification flags when omitted', async () => {
      mock.onPost(`${ BASE }/orders/markasshipped`).reply({ orderId: 1 })

      await service.markOrderAsShipped(1, 'stamps_com')

      expect(mock.history[0].body).toEqual({ orderId: 1, carrierCode: 'stamps_com' })
    })
  })

  describe('order hold and tags', () => {
    it('holds an order until a date', async () => {
      mock.onPost(`${ BASE }/orders/holduntil`).reply({ success: true })

      await service.holdOrderUntil(1, '2025-03-01')

      expect(mock.history[0].url).toBe(`${ BASE }/orders/holduntil`)
      expect(mock.history[0].body).toEqual({ orderId: 1, holdUntilDate: '2025-03-01' })
    })

    it('restores an order from hold', async () => {
      mock.onPost(`${ BASE }/orders/restorefromhold`).reply({ success: true })

      await service.restoreOrderFromHold(1)

      expect(mock.history[0].body).toEqual({ orderId: 1 })
    })

    it('adds a tag to an order', async () => {
      mock.onPost(`${ BASE }/orders/addtag`).reply({ success: true })

      await service.addTagToOrder(1, 7)

      expect(mock.history[0].body).toEqual({ orderId: 1, tagId: 7 })
    })

    it('removes a tag from an order', async () => {
      mock.onPost(`${ BASE }/orders/removetag`).reply({ success: true })

      await service.removeTagFromOrder(1, 7)

      expect(mock.history[0].body).toEqual({ orderId: 1, tagId: 7 })
    })

    it('lists the account tags', async () => {
      mock.onGet(`${ BASE }/accounts/listtags`).reply([{ tagId: 1, name: 'Rush' }])

      const result = await service.listTags()

      expect(result).toEqual([{ tagId: 1, name: 'Rush' }])
    })
  })

  // ── Shipments & labels ──

  describe('listShipments', () => {
    it('maps sort labels and forwards the filters', async () => {
      mock.onGet(`${ BASE }/shipments`).reply({ shipments: [], total: 0 })

      await service.listShipments(
        'Jane',
        'US',
        'ORD-1',
        1,
        'stamps_com',
        'usps_priority_mail',
        '9400111',
        99,
        '2025-01-01',
        '2025-01-31',
        '2025-02-01',
        '2025-02-28',
        true,
        'Ship Date',
        'Ascending',
        1,
        100
      )

      expect(mock.history[0].query).toEqual({
        recipientName: 'Jane',
        recipientCountryCode: 'US',
        orderNumber: 'ORD-1',
        orderId: 1,
        carrierCode: 'stamps_com',
        serviceCode: 'usps_priority_mail',
        trackingNumber: '9400111',
        storeId: 99,
        createDateStart: '2025-01-01',
        createDateEnd: '2025-01-31',
        shipDateStart: '2025-02-01',
        shipDateEnd: '2025-02-28',
        includeShipmentItems: true,
        sortBy: 'ShipDate',
        sortDir: 'ASC',
        page: 1,
        pageSize: 100,
      })
    })

    it('sends no query at all when nothing is supplied', async () => {
      mock.onGet(`${ BASE }/shipments`).reply({ shipments: [] })

      await service.listShipments()

      expect(mock.history[0].query).toEqual({})
    })
  })

  describe('getShipmentRates', () => {
    it('posts the cleaned rate request', async () => {
      mock.onPost(`${ BASE }/shipments/getrates`).reply([{ serviceName: 'USPS Priority Mail', shipmentCost: 7.5 }])

      const result = await service.getShipmentRates(
        'stamps_com',
        '78701',
        '90210',
        'US',
        2,
        undefined,
        'package',
        'Austin',
        'TX',
        'Beverly Hills',
        'CA',
        { units: 'inches', length: 10, width: 5, height: 4 },
        'delivery',
        true
      )

      expect(result).toEqual([{ serviceName: 'USPS Priority Mail', shipmentCost: 7.5 }])

      expect(mock.history[0].body).toEqual({
        carrierCode: 'stamps_com',
        fromPostalCode: '78701',
        toPostalCode: '90210',
        toCountry: 'US',
        weight: 2,
        packageCode: 'package',
        fromCity: 'Austin',
        fromState: 'TX',
        toCity: 'Beverly Hills',
        toState: 'CA',
        dimensions: { units: 'inches', length: 10, width: 5, height: 4 },
        confirmation: 'delivery',
        residential: true,
      })
    })
  })

  describe('createShipmentLabel', () => {
    it('resolves the nested choice labels and posts the label request', async () => {
      mock.onPost(`${ BASE }/shipments/createlabel`).reply({ shipmentId: 1, labelData: 'JVBER' })

      const result = await service.createShipmentLabel(
        'stamps_com',
        'usps_priority_mail',
        'package',
        '2025-01-05',
        { value: 2, units: 'pounds' },
        { name: 'Shipper' },
        { name: 'Jane' },
        { units: 'inches', length: 10, width: 5, height: 4 },
        'delivery',
        { provider: 'Third-Party Provider', insureShipment: true, insuredValue: 100 },
        { contents: 'Returned Goods', nonDelivery: 'Return to Sender' },
        { billToParty: 'Third Party', billToAccount: '123' },
        true
      )

      expect(result).toEqual({ shipmentId: 1, labelData: 'JVBER' })

      expect(mock.history[0].body).toMatchObject({
        carrierCode: 'stamps_com',
        serviceCode: 'usps_priority_mail',
        packageCode: 'package',
        insuranceOptions: { provider: 'provider', insureShipment: true, insuredValue: 100 },
        internationalOptions: { contents: 'returned_goods', nonDelivery: 'return_to_sender' },
        advancedOptions: { billToParty: 'third_party', billToAccount: '123' },
        testLabel: true,
      })
    })

    it('omits the optional option objects when they are not supplied', async () => {
      mock.onPost(`${ BASE }/shipments/createlabel`).reply({ shipmentId: 2 })

      await service.createShipmentLabel(
        'stamps_com',
        'usps_priority_mail',
        'package',
        '2025-01-05',
        { value: 1, units: 'pounds' },
        { name: 'Shipper' },
        { name: 'Jane' }
      )

      expect(mock.history[0].body).toEqual({
        carrierCode: 'stamps_com',
        serviceCode: 'usps_priority_mail',
        packageCode: 'package',
        shipDate: '2025-01-05',
        weight: { value: 1, units: 'pounds' },
        shipFrom: { name: 'Shipper' },
        shipTo: { name: 'Jane' },
      })
    })

    it('leaves already-normalized nested values untouched', async () => {
      mock.onPost(`${ BASE }/shipments/createlabel`).reply({ shipmentId: 3 })

      await service.createShipmentLabel(
        'stamps_com', 'usps_priority_mail', 'package', '2025-01-05',
        { value: 1, units: 'pounds' }, { name: 'A' }, { name: 'B' }, undefined, undefined,
        { provider: 'shipsurance' },
        { contents: 'gift' },
        { billToParty: 'my_account' }
      )

      expect(mock.history[0].body.insuranceOptions.provider).toBe('shipsurance')
      expect(mock.history[0].body.internationalOptions.contents).toBe('gift')
      expect(mock.history[0].body.advancedOptions.billToParty).toBe('my_account')
    })
  })

  describe('voidShipmentLabel', () => {
    it('posts the shipment id', async () => {
      mock.onPost(`${ BASE }/shipments/voidlabel`).reply({ approved: true, message: 'Label voided' })

      const result = await service.voidShipmentLabel(555)

      expect(result).toEqual({ approved: true, message: 'Label voided' })
      expect(mock.history[0].body).toEqual({ shipmentId: 555 })
    })
  })

  describe('createLabelForOrder', () => {
    it('resolves the nested choice labels and posts the request', async () => {
      mock.onPost(`${ BASE }/orders/createlabelfororder`).reply({ shipmentId: 9, labelData: 'JVBER' })

      const result = await service.createLabelForOrder(
        12345,
        'stamps_com',
        'usps_priority_mail',
        'signature',
        '2025-01-05',
        'package',
        { value: 2, units: 'pounds' },
        { units: 'inches', length: 10, width: 5, height: 4 },
        { provider: 'ParcelGuard' },
        { contents: 'Merchandise', nonDelivery: 'Treat as Abandoned' },
        { billToParty: 'Recipient' },
        false
      )

      expect(result).toEqual({ shipmentId: 9, labelData: 'JVBER' })

      expect(mock.history[0].body).toMatchObject({
        orderId: 12345,
        carrierCode: 'stamps_com',
        serviceCode: 'usps_priority_mail',
        confirmation: 'signature',
        insuranceOptions: { provider: 'parcelguard' },
        internationalOptions: { contents: 'merchandise', nonDelivery: 'treat_as_abandoned' },
        advancedOptions: { billToParty: 'recipient' },
      })

      // `false` is preserved by clean(); only undefined/null/'' are stripped
      expect(mock.history[0].body.testLabel).toBe(false)
    })

    it('posts only the required fields when nothing optional is given', async () => {
      mock.onPost(`${ BASE }/orders/createlabelfororder`).reply({ shipmentId: 10 })

      await service.createLabelForOrder(12345, 'stamps_com', 'usps_priority_mail')

      expect(mock.history[0].body).toEqual({
        orderId: 12345,
        carrierCode: 'stamps_com',
        serviceCode: 'usps_priority_mail',
      })
    })
  })

  describe('listFulfillments', () => {
    it('maps the sort labels and forwards the filters', async () => {
      mock.onGet(`${ BASE }/fulfillments`).reply({ fulfillments: [], total: 0 })

      await service.listFulfillments(
        1, 2, 'ORD-1', '9400111', 'Jane',
        '2025-01-01', '2025-01-31', '2025-02-01', '2025-02-28',
        'Create Date', 'Descending', 1, 50
      )

      expect(mock.history[0].query).toEqual({
        fulfillmentId: 1,
        orderId: 2,
        orderNumber: 'ORD-1',
        trackingNumber: '9400111',
        recipientName: 'Jane',
        createDateStart: '2025-01-01',
        createDateEnd: '2025-01-31',
        shipDateStart: '2025-02-01',
        shipDateEnd: '2025-02-28',
        sortBy: 'CreateDate',
        sortDir: 'DESC',
        page: 1,
        pageSize: 50,
      })
    })
  })

  // ── Customers ──

  describe('customers', () => {
    it('lists customers with mapped sort values', async () => {
      mock.onGet(`${ BASE }/customers`).reply({ customers: [], total: 0 })

      await service.listCustomers('TX', 'US', 5, 7, 'Name', 'Ascending', 1, 25)

      expect(mock.history[0].query).toEqual({
        stateCode: 'TX',
        countryCode: 'US',
        marketplaceId: 5,
        tagId: 7,
        sortBy: 'Name',
        sortDir: 'ASC',
        page: 1,
        pageSize: 25,
      })
    })

    it('fetches a single customer', async () => {
      mock.onGet(`${ BASE }/customers/77`).reply({ customerId: 77, name: 'Jane' })

      const result = await service.getCustomer(77)

      expect(result).toEqual({ customerId: 77, name: 'Jane' })
    })
  })

  // ── Products ──

  describe('products', () => {
    it('lists products with mapped sort values', async () => {
      mock.onGet(`${ BASE }/products`).reply({ products: [], total: 0 })

      await service.listProducts('SKU-1', 'Widget', 1, 2, 3, '012345', '2025-01-01', '2025-01-31', true, 'SKU', 'Descending', 1, 25)

      expect(mock.history[0].query).toEqual({
        sku: 'SKU-1',
        name: 'Widget',
        productCategoryId: 1,
        productTypeId: 2,
        tagId: 3,
        upc: '012345',
        startDate: '2025-01-01',
        endDate: '2025-01-31',
        showInactive: true,
        sortBy: 'SKU',
        sortDir: 'DESC',
        page: 1,
        pageSize: 25,
      })
    })

    it('fetches a single product', async () => {
      mock.onGet(`${ BASE }/products/42`).reply({ productId: 42, sku: 'SKU-1' })

      expect(await service.getProduct(42)).toEqual({ productId: 42, sku: 'SKU-1' })
    })

    it('merges the supplied fields over the existing product before the PUT', async () => {
      mock.onGet(`${ BASE }/products/42`).reply({ productId: 42, sku: 'SKU-1', name: 'Old', price: 5, active: true })
      mock.onPut(`${ BASE }/products/42`).reply({ productId: 42, name: 'New' })

      const result = await service.updateProduct(42, undefined, 'New', 9)

      expect(result).toEqual({ productId: 42, name: 'New' })
      expect(mock.history).toHaveLength(2)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[1].method).toBe('put')

      expect(mock.history[1].body).toEqual({
        productId: 42,
        sku: 'SKU-1',
        name: 'New',
        price: 9,
        active: true,
      })
    })

    it('leaves the product untouched when no updates are supplied', async () => {
      mock.onGet(`${ BASE }/products/42`).reply({ productId: 42, sku: 'SKU-1', name: 'Old' })
      mock.onPut(`${ BASE }/products/42`).reply({ productId: 42 })

      await service.updateProduct(42)

      expect(mock.history[1].body).toEqual({ productId: 42, sku: 'SKU-1', name: 'Old' })
    })
  })

  // ── Warehouses ──

  describe('warehouses', () => {
    it('lists warehouses', async () => {
      mock.onGet(`${ BASE }/warehouses`).reply([{ warehouseId: 1 }])

      expect(await service.listWarehouses()).toEqual([{ warehouseId: 1 }])
    })

    it('fetches a single warehouse', async () => {
      mock.onGet(`${ BASE }/warehouses/1`).reply({ warehouseId: 1, warehouseName: 'Main' })

      expect(await service.getWarehouse(1)).toEqual({ warehouseId: 1, warehouseName: 'Main' })
    })

    it('creates a warehouse with a cleaned payload', async () => {
      mock.onPost(`${ BASE }/warehouses/createwarehouse`).reply({ warehouseId: 2 })

      const originAddress = { name: 'Main', street1: '1 Main St', city: 'Austin', state: 'TX', postalCode: '78701', country: 'US' }

      await service.createWarehouse('Second', originAddress, null, true)

      expect(mock.history[0].body).toEqual({
        warehouseName: 'Second',
        originAddress,
        isDefault: true,
      })
    })

    it('deletes a warehouse', async () => {
      mock.onDelete(`${ BASE }/warehouses/2`).reply({ success: true })

      await service.deleteWarehouse(2)

      expect(mock.history[0].method).toBe('delete')
    })
  })

  // ── Stores ──

  describe('stores', () => {
    it('lists stores with optional filters', async () => {
      mock.onGet(`${ BASE }/stores`).reply([{ storeId: 1 }])

      await service.listStores(true, 5)

      expect(mock.history[0].query).toEqual({ showInactive: true, marketplaceId: 5 })
    })

    it('fetches a single store', async () => {
      mock.onGet(`${ BASE }/stores/1`).reply({ storeId: 1 })

      expect(await service.getStore(1)).toEqual({ storeId: 1 })
    })

    it('refreshes a store', async () => {
      mock.onPost(`${ BASE }/stores/refreshstore`).reply({ success: true })

      await service.refreshStore(1, '2025-01-01')

      expect(mock.history[0].body).toEqual({ storeId: 1, refreshDate: '2025-01-01' })
    })

    it('drops the refresh date when it is omitted', async () => {
      mock.onPost(`${ BASE }/stores/refreshstore`).reply({ success: true })

      await service.refreshStore(1)

      expect(mock.history[0].body).toEqual({ storeId: 1 })
    })
  })

  // ── Carriers ──

  describe('carriers', () => {
    it('lists carriers', async () => {
      mock.onGet(`${ BASE }/carriers`).reply([{ code: 'ups' }])

      expect(await service.listCarriers()).toEqual([{ code: 'ups' }])
    })

    it('lists carrier services', async () => {
      mock.onGet(`${ BASE }/carriers/listservices`).reply([{ code: 'ups_ground' }])

      await service.listCarrierServices('ups')

      expect(mock.history[0].query).toEqual({ carrierCode: 'ups' })
    })

    it('lists carrier packages', async () => {
      mock.onGet(`${ BASE }/carriers/listpackages`).reply([{ code: 'package' }])

      await service.listCarrierPackages('ups')

      expect(mock.history[0].query).toEqual({ carrierCode: 'ups' })
    })
  })

  // ── Webhooks ──

  describe('webhooks', () => {
    it('lists webhooks', async () => {
      mock.onGet(`${ BASE }/webhooks`).reply({ webhooks: [] })

      expect(await service.listWebhooks()).toEqual({ webhooks: [] })
    })

    it('subscribes a webhook with a cleaned payload', async () => {
      mock.onPost(`${ BASE }/webhooks/subscribe`).reply({ id: 123 })

      await service.subscribeWebhook('https://example.com/hook', 'ORDER_NOTIFY', undefined, 'My hook')

      expect(mock.history[0].body).toEqual({
        target_url: 'https://example.com/hook',
        event: 'ORDER_NOTIFY',
        friendly_name: 'My hook',
      })
    })

    it('unsubscribes a webhook', async () => {
      mock.onDelete(`${ BASE }/webhooks/123`).reply({ success: true })

      await service.unsubscribeWebhook(123)

      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${ BASE }/webhooks/123`)
    })
  })

  // ── Polling triggers ──

  describe('onNewOrder', () => {
    it('seeds the watermark from the newest order and emits nothing', async () => {
      mock.onGet(`${ BASE }/orders`).reply({ orders: [{ orderId: 1, createDate: '2025-08-20T07:30:00.6270000' }] })

      const result = await service.onNewOrder({ triggerData: { storeId: 9, orderStatus: 'awaiting_shipment' }, state: {} })

      expect(mock.history[0].query).toEqual({
        storeId: 9,
        orderStatus: 'awaiting_shipment',
        sortBy: 'CreateDate',
        sortDir: 'DESC',
        page: 1,
        pageSize: 1,
      })

      expect(result).toEqual({ events: [], state: { since: '2025-08-20T07:30:00.6270000', seenIds: [] } })
    })

    it('falls back to a look-back window when the account has no orders', async () => {
      mock.onGet(`${ BASE }/orders`).reply({ orders: [] })

      const result = await service.onNewOrder({ state: {} })

      expect(result.events).toEqual([])
      expect(result.state.since).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/)
      expect(Date.parse(`${ result.state.since }Z`)).toBeLessThanOrEqual(Date.now() - 23 * 60 * 60 * 1000)
    })

    it('windows by createDate with overlap, drains pages and advances the watermark', async () => {
      mock.onGet(`${ BASE }/orders`).replyWith(call => {
        if (call.query.page === 1) {
          return { orders: [{ orderId: 1, createDate: '2025-08-20T07:31:00.0000000' }], pages: 2 }
        }

        return { orders: [{ orderId: 2, createDate: '2025-08-20T07:45:00.0000000' }], pages: 2 }
      })

      const result = await service.onNewOrder({
        triggerData: {},
        state: { since: '2025-08-20T07:30:00.6270000', seenIds: [] },
      })

      expect(mock.history).toHaveLength(2)

      expect(mock.history[0].query).toMatchObject({
        createDateStart: '2025-08-20T07:15:00',
        sortBy: 'CreateDate',
        sortDir: 'ASC',
        page: 1,
        pageSize: 250,
      })

      expect(mock.history[1].query.page).toBe(2)

      expect(result.events.map(order => order.orderId)).toEqual([1, 2])
      expect(result.state.since).toBe('2025-08-20T07:45:00.0000000')
      expect(result.state.seenIds).toEqual([1, 2])
    })

    it('suppresses orders already seen in the overlap window', async () => {
      mock.onGet(`${ BASE }/orders`).reply({
        orders: [
          { orderId: 1, createDate: '2025-08-20T07:31:00.0000000' },
          { orderId: 2, createDate: '2025-08-20T07:32:00.0000000' },
        ],
        pages: 1,
      })

      const result = await service.onNewOrder({
        state: { since: '2025-08-20T07:30:00.0000000', seenIds: [1] },
      })

      expect(result.events.map(order => order.orderId)).toEqual([2])
      expect(result.state.seenIds).toEqual([1, 2, 1])
    })

    it('keeps the watermark when a page returns nothing', async () => {
      mock.onGet(`${ BASE }/orders`).reply({ orders: [], pages: 1 })

      const result = await service.onNewOrder({ state: { since: '2025-08-20T07:30:00.0000000' } })

      expect(result).toEqual({ events: [], state: { since: '2025-08-20T07:30:00.0000000', seenIds: [] } })
    })
  })

  describe('onNewShipment', () => {
    it('seeds the watermark from the newest shipment', async () => {
      mock.onGet(`${ BASE }/shipments`).reply({ shipments: [{ shipmentId: 1, createDate: '2025-08-20T07:30:00.0000000' }] })

      const result = await service.onNewShipment({ triggerData: { carrierCode: 'ups', storeId: 9 }, state: {} })

      expect(mock.history[0].query).toEqual({
        carrierCode: 'ups',
        storeId: 9,
        sortBy: 'CreateDate',
        sortDir: 'DESC',
        page: 1,
        pageSize: 1,
      })

      expect(result).toEqual({ events: [], state: { since: '2025-08-20T07:30:00.0000000', seenIds: [] } })
    })

    it('falls back to a look-back window when the account has no shipments', async () => {
      mock.onGet(`${ BASE }/shipments`).reply({ shipments: [] })

      const result = await service.onNewShipment({ state: {} })

      expect(result.events).toEqual([])
      expect(result.state.since).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/)
    })

    it('drains pages, de-dups and advances the watermark', async () => {
      mock.onGet(`${ BASE }/shipments`).replyWith(call => {
        if (call.query.page === 1) {
          return { shipments: [{ shipmentId: 1, createDate: '2025-08-20T07:31:00.0000000' }], pages: 2 }
        }

        return { shipments: [{ shipmentId: 2, createDate: '2025-08-20T07:50:00.0000000' }], pages: 2 }
      })

      const result = await service.onNewShipment({
        state: { since: '2025-08-20T07:30:00.0000000', seenIds: [1] },
      })

      expect(mock.history[0].query.createDateStart).toBe('2025-08-20T07:15:00')
      expect(result.events.map(shipment => shipment.shipmentId)).toEqual([2])
      expect(result.state.since).toBe('2025-08-20T07:50:00.0000000')
      expect(result.state.seenIds).toEqual([1, 2, 1])
    })
  })

  describe('handleTriggerPollingForEvent', () => {
    it('dispatches to the named event handler', async () => {
      mock.onGet(`${ BASE }/orders`).reply({ orders: [{ orderId: 1, createDate: '2025-08-20T07:30:00.0000000' }] })

      const result = await service.handleTriggerPollingForEvent({ eventName: 'onNewOrder', state: {} })

      expect(result).toEqual({ events: [], state: { since: '2025-08-20T07:30:00.0000000', seenIds: [] } })
    })

    it('dispatches to the shipment handler', async () => {
      mock.onGet(`${ BASE }/shipments`).reply({ shipments: [{ shipmentId: 1, createDate: '2025-08-20T07:30:00.0000000' }] })

      const result = await service.handleTriggerPollingForEvent({ eventName: 'onNewShipment', state: {} })

      expect(result.state.since).toBe('2025-08-20T07:30:00.0000000')
    })

    // KNOWN SERVICE BUG: an unknown eventName produces a raw TypeError
    // ("this[invocation.eventName] is not a function") instead of a descriptive
    // error. Shippo's equivalent handler validates the event name first.
    it('throws a raw TypeError for an unknown event name', async () => {
      await expect(service.handleTriggerPollingForEvent({ eventName: 'nope' })).rejects.toThrow(TypeError)
    })
  })
})
