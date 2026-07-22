'use strict'

const crypto = require('crypto')

const { createSandbox } = require('../../../service-sandbox')

const API_ID = 'test-api-id'
const API_KEY = 'test-api-key'
const BASE = 'https://api.unleashedsoftware.com'

const sign = queryString =>
  crypto.createHmac('sha256', API_KEY).update(queryString, 'utf8').digest('base64')

describe('Unleashed Software Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ apiId: API_ID, apiKey: API_KEY })
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
    it('registers both config items as required and not shared', () => {
      const configItems = sandbox.getConfigItems()

      expect(configItems).toHaveLength(2)

      expect(configItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'apiId', required: true, shared: false, type: 'STRING' }),
          expect.objectContaining({ name: 'apiKey', required: true, shared: false, type: 'STRING' }),
        ])
      )
    })

    it('preserves config item order', () => {
      expect(sandbox.getConfigItems().map(item => item.name)).toEqual(['apiId', 'apiKey'])
    })
  })

  // ── Auth / signing ──

  describe('authentication headers', () => {
    it('signs an empty query string when there are no query params', async () => {
      mock.onGet(`${ BASE }/Warehouses`).reply({ Items: [], Pagination: {} })

      await service.getWarehouses()

      expect(mock.history[0].headers).toMatchObject({
        'api-auth-id': API_ID,
        'api-auth-signature': sign(''),
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      })
    })

    it('signs the exact query string that is appended to the URL', async () => {
      const queryString = 'pageSize=10&productCode=WIDGET-1'

      mock.onGet(`${ BASE }/Products/1?${ queryString }`).reply({ Items: [], Pagination: {} })

      await service.getProducts(1, 10, 'WIDGET-1')

      expect(mock.history[0].url).toBe(`${ BASE }/Products/1?${ queryString }`)
      expect(mock.history[0].headers['api-auth-signature']).toBe(sign(queryString))
    })

    it('url-encodes query values before signing', async () => {
      const queryString = 'productDescription=Blue%20Widget%20%26%20Co'

      mock.onGet(`${ BASE }/Products/1?${ queryString }`).reply({ Items: [], Pagination: {} })

      await service.getProducts(undefined, undefined, undefined, 'Blue Widget & Co')

      expect(mock.history[0].headers['api-auth-signature']).toBe(sign(queryString))
    })
  })

  // ── Products ──

  describe('getProducts', () => {
    it('defaults to page 1 with no query params', async () => {
      mock.onGet(`${ BASE }/Products/1`).reply({
        Pagination: { NumberOfItems: 1, PageNumber: 1 },
        Items: [{ Guid: 'g-1', ProductCode: 'WIDGET-1' }],
      })

      const result = await service.getProducts()

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/Products/1`)

      expect(result).toEqual({
        pagination: { NumberOfItems: 1, PageNumber: 1 },
        items: [{ Guid: 'g-1', ProductCode: 'WIDGET-1' }],
      })
    })

    it('puts the page number into the path', async () => {
      mock.onGet(`${ BASE }/Products/3`).reply({ Items: [] })

      await service.getProducts(3)

      expect(mock.history[0].url).toBe(`${ BASE }/Products/3`)
    })

    it('accepts a numeric string page', async () => {
      mock.onGet(`${ BASE }/Products/4`).reply({ Items: [] })

      await service.getProducts('4')

      expect(mock.history[0].url).toBe(`${ BASE }/Products/4`)
    })

    it.each([
      ['zero', 0],
      ['negative', -5],
      ['non-numeric', 'abc'],
      ['null', null],
    ])('falls back to page 1 for a %s page value', async (_label, page) => {
      mock.onGet(`${ BASE }/Products/1`).reply({ Items: [] })

      await service.getProducts(page)

      expect(mock.history[0].url).toBe(`${ BASE }/Products/1`)
    })

    it('omits empty-string filters from the query string', async () => {
      mock.onGet(`${ BASE }/Products/1`).reply({ Items: [] })

      await service.getProducts(1, '', '', '')

      expect(mock.history[0].url).toBe(`${ BASE }/Products/1`)
    })

    it('returns an empty items array when Items is missing', async () => {
      mock.onGet(`${ BASE }/Products/1`).reply({})

      const result = await service.getProducts()

      expect(result).toEqual({ pagination: undefined, items: [] })
    })

    it('handles an empty response body', async () => {
      mock.onGet(`${ BASE }/Products/1`).reply(undefined)

      const result = await service.getProducts()

      expect(result).toEqual({ pagination: undefined, items: [] })
    })

    it('throws a descriptive error on API failure', async () => {
      mock.onGet(`${ BASE }/Products/1`).replyWithError({
        message: 'Bad Request',
        status: 400,
        body: { description: 'Invalid page' },
      })

      await expect(service.getProducts()).rejects.toThrow(
        'Unleashed Software API error [400]: Invalid page'
      )
    })

    it('falls back to the capitalized Description error field', async () => {
      mock.onGet(`${ BASE }/Products/1`).replyWithError({
        message: 'Bad Request',
        status: 401,
        body: { Description: 'Signature mismatch' },
      })

      await expect(service.getProducts()).rejects.toThrow(
        'Unleashed Software API error [401]: Signature mismatch'
      )
    })

    it('falls back to a string error body', async () => {
      mock.onGet(`${ BASE }/Products/1`).replyWithError({
        message: 'Bad Request',
        statusCode: 500,
        body: 'Server exploded',
      })

      await expect(service.getProducts()).rejects.toThrow(
        'Unleashed Software API error [500]: Server exploded'
      )
    })

    it('falls back to error.message when no status or body is present', async () => {
      mock.onGet(`${ BASE }/Products/1`).replyWithError({ message: 'Network timeout' })

      await expect(service.getProducts()).rejects.toThrow(
        'Unleashed Software API error: Network timeout'
      )
    })
  })

  describe('getProduct', () => {
    it('requests the product by guid', async () => {
      mock.onGet(`${ BASE }/Products/g-1`).reply({ Guid: 'g-1', ProductCode: 'WIDGET-1' })

      const result = await service.getProduct('g-1')

      expect(mock.history[0].url).toBe(`${ BASE }/Products/g-1`)
      expect(result).toEqual({ Guid: 'g-1', ProductCode: 'WIDGET-1' })
    })

    it('encodes the guid in the path', async () => {
      mock.onGet(`${ BASE }/Products/a%2Fb`).reply({ Guid: 'a/b' })

      await service.getProduct('a/b')

      expect(mock.history[0].url).toBe(`${ BASE }/Products/a%2Fb`)
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/Products/missing`).replyWithError({
        message: 'Not Found',
        status: 404,
      })

      await expect(service.getProduct('missing')).rejects.toThrow('Unleashed Software API error [404]')
    })
  })

  // ── Stock ──

  describe('getStockOnHand', () => {
    it('requests stock for the default page', async () => {
      mock.onGet(`${ BASE }/StockOnHand/1`).reply({
        Pagination: { NumberOfItems: 1 },
        Items: [{ ProductCode: 'WIDGET-1', QtyOnHand: 42 }],
      })

      const result = await service.getStockOnHand()

      expect(mock.history[0].url).toBe(`${ BASE }/StockOnHand/1`)
      expect(result.items).toHaveLength(1)
      expect(result.pagination).toEqual({ NumberOfItems: 1 })
    })

    it('passes the product code filter as a signed query param', async () => {
      const queryString = 'productCode=WIDGET-1'

      mock.onGet(`${ BASE }/StockOnHand/2?${ queryString }`).reply({ Items: [] })

      await service.getStockOnHand(2, 'WIDGET-1')

      expect(mock.history[0].url).toBe(`${ BASE }/StockOnHand/2?${ queryString }`)
      expect(mock.history[0].headers['api-auth-signature']).toBe(sign(queryString))
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/StockOnHand/1`).replyWithError({ message: 'boom' })

      await expect(service.getStockOnHand()).rejects.toThrow('Unleashed Software API error: boom')
    })
  })

  describe('getStockOnHandByProduct', () => {
    it('requests stock for a single product guid', async () => {
      mock.onGet(`${ BASE }/StockOnHand/p-1`).reply({ ProductCode: 'WIDGET-1', AvailableQty: 40 })

      const result = await service.getStockOnHandByProduct('p-1')

      expect(result).toEqual({ ProductCode: 'WIDGET-1', AvailableQty: 40 })
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/StockOnHand/p-1`).replyWithError({ message: 'nope', status: 404 })

      await expect(service.getStockOnHandByProduct('p-1')).rejects.toThrow(
        'Unleashed Software API error [404]: nope'
      )
    })
  })

  // ── Customers ──

  describe('getCustomers', () => {
    it('returns unwrapped items and pagination', async () => {
      mock.onGet(`${ BASE }/Customers/1`).reply({
        Pagination: { NumberOfPages: 1 },
        Items: [{ Guid: 'c-1', CustomerCode: 'ACME' }],
      })

      const result = await service.getCustomers()

      expect(result).toEqual({
        pagination: { NumberOfPages: 1 },
        items: [{ Guid: 'c-1', CustomerCode: 'ACME' }],
      })
    })

    it('applies the customer code filter', async () => {
      const queryString = 'customerCode=ACME'

      mock.onGet(`${ BASE }/Customers/2?${ queryString }`).reply({ Items: [] })

      await service.getCustomers(2, 'ACME')

      expect(mock.history[0].url).toBe(`${ BASE }/Customers/2?${ queryString }`)
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/Customers/1`).replyWithError({ message: 'denied', status: 403 })

      await expect(service.getCustomers()).rejects.toThrow('Unleashed Software API error [403]: denied')
    })
  })

  describe('getCustomer', () => {
    it('requests the customer by guid', async () => {
      mock.onGet(`${ BASE }/Customers/c-1`).reply({ Guid: 'c-1', CustomerName: 'Acme Ltd' })

      const result = await service.getCustomer('c-1')

      expect(result.CustomerName).toBe('Acme Ltd')
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/Customers/c-1`).replyWithError({ message: 'gone', status: 410 })

      await expect(service.getCustomer('c-1')).rejects.toThrow('Unleashed Software API error [410]: gone')
    })
  })

  // ── Suppliers ──

  describe('getSuppliers', () => {
    it('requests suppliers without query params', async () => {
      mock.onGet(`${ BASE }/Suppliers/1`).reply({
        Pagination: {},
        Items: [{ Guid: 's-1', SupplierCode: 'SUP1' }],
      })

      const result = await service.getSuppliers()

      expect(mock.history[0].url).toBe(`${ BASE }/Suppliers/1`)
      expect(mock.history[0].headers['api-auth-signature']).toBe(sign(''))
      expect(result.items).toHaveLength(1)
    })

    it('honors the page argument', async () => {
      mock.onGet(`${ BASE }/Suppliers/7`).reply({ Items: [] })

      await service.getSuppliers(7)

      expect(mock.history[0].url).toBe(`${ BASE }/Suppliers/7`)
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/Suppliers/1`).replyWithError({ message: 'fail' })

      await expect(service.getSuppliers()).rejects.toThrow('Unleashed Software API error: fail')
    })
  })

  // ── Sales Orders ──

  describe('getSalesOrders', () => {
    it('requests the default page with no filters', async () => {
      mock.onGet(`${ BASE }/SalesOrders/1`).reply({ Pagination: {}, Items: [] })

      const result = await service.getSalesOrders()

      expect(mock.history[0].url).toBe(`${ BASE }/SalesOrders/1`)
      expect(result.items).toEqual([])
    })

    it('applies status and start date filters in order', async () => {
      const queryString = 'orderStatus=Placed&startDate=2026-01-01'

      mock.onGet(`${ BASE }/SalesOrders/2?${ queryString }`).reply({ Items: [] })

      await service.getSalesOrders(2, 'Placed', '2026-01-01')

      expect(mock.history[0].url).toBe(`${ BASE }/SalesOrders/2?${ queryString }`)
      expect(mock.history[0].headers['api-auth-signature']).toBe(sign(queryString))
    })

    it('applies only the start date when status is omitted', async () => {
      const queryString = 'startDate=2026-01-01'

      mock.onGet(`${ BASE }/SalesOrders/1?${ queryString }`).reply({ Items: [] })

      await service.getSalesOrders(1, undefined, '2026-01-01')

      expect(mock.history[0].url).toBe(`${ BASE }/SalesOrders/1?${ queryString }`)
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/SalesOrders/1`).replyWithError({ message: 'bad', status: 400 })

      await expect(service.getSalesOrders()).rejects.toThrow('Unleashed Software API error [400]: bad')
    })
  })

  describe('getSalesOrder', () => {
    it('requests the sales order by guid', async () => {
      mock.onGet(`${ BASE }/SalesOrders/so-1`).reply({ Guid: 'so-1', OrderNumber: 'SO-0001' })

      const result = await service.getSalesOrder('so-1')

      expect(result.OrderNumber).toBe('SO-0001')
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/SalesOrders/so-1`).replyWithError({ message: 'missing', status: 404 })

      await expect(service.getSalesOrder('so-1')).rejects.toThrow(
        'Unleashed Software API error [404]: missing'
      )
    })
  })

  describe('createSalesOrder', () => {
    it('posts a minimal order defaulting the status to Parked', async () => {
      mock.onPost(`${ BASE }/SalesOrders`).reply({ Guid: 'so-2', OrderNumber: 'SO-0002' })

      const result = await service.createSalesOrder('c-1', [
        { productGuid: 'p-1', orderQuantity: 2 },
      ])

      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/SalesOrders`)

      expect(mock.history[0].body).toEqual({
        OrderStatus: 'Parked',
        Customer: { Guid: 'c-1' },
        SalesOrderLines: [{ Product: { Guid: 'p-1' }, OrderQuantity: 2 }],
      })

      expect(result).toEqual({ Guid: 'so-2', OrderNumber: 'SO-0002' })
    })

    it('includes the unit price when supplied', async () => {
      mock.onPost(`${ BASE }/SalesOrders`).reply({ Guid: 'so-3' })

      await service.createSalesOrder('c-1', [
        { productGuid: 'p-1', orderQuantity: 1, unitPrice: 12.5 },
      ])

      expect(mock.history[0].body.SalesOrderLines[0]).toEqual({
        Product: { Guid: 'p-1' },
        OrderQuantity: 1,
        UnitPrice: 12.5,
      })
    })

    it('includes a zero unit price', async () => {
      mock.onPost(`${ BASE }/SalesOrders`).reply({ Guid: 'so-4' })

      await service.createSalesOrder('c-1', [
        { productGuid: 'p-1', orderQuantity: 1, unitPrice: 0 },
      ])

      expect(mock.history[0].body.SalesOrderLines[0].UnitPrice).toBe(0)
    })

    it('omits the unit price when it is null', async () => {
      mock.onPost(`${ BASE }/SalesOrders`).reply({ Guid: 'so-5' })

      await service.createSalesOrder('c-1', [
        { productGuid: 'p-1', orderQuantity: 1, unitPrice: null },
      ])

      expect(mock.history[0].body.SalesOrderLines[0]).not.toHaveProperty('UnitPrice')
    })

    it('sends optional status, warehouse and comments', async () => {
      mock.onPost(`${ BASE }/SalesOrders`).reply({ Guid: 'so-6' })

      await service.createSalesOrder(
        'c-1',
        [{ productGuid: 'p-1', orderQuantity: 3 }],
        'Placed',
        'w-1',
        'Rush order'
      )

      expect(mock.history[0].body).toEqual({
        OrderStatus: 'Placed',
        Customer: { Guid: 'c-1' },
        SalesOrderLines: [{ Product: { Guid: 'p-1' }, OrderQuantity: 3 }],
        Warehouse: { Guid: 'w-1' },
        Comments: 'Rush order',
      })
    })

    it('omits warehouse and comments when they are empty', async () => {
      mock.onPost(`${ BASE }/SalesOrders`).reply({ Guid: 'so-7' })

      await service.createSalesOrder('c-1', [{ productGuid: 'p-1', orderQuantity: 1 }], '', '', '')

      expect(mock.history[0].body).not.toHaveProperty('Warehouse')
      expect(mock.history[0].body).not.toHaveProperty('Comments')
      expect(mock.history[0].body.OrderStatus).toBe('Parked')
    })

    it('sends an empty lines array when lines are omitted', async () => {
      mock.onPost(`${ BASE }/SalesOrders`).reply({ Guid: 'so-8' })

      await service.createSalesOrder('c-1')

      expect(mock.history[0].body.SalesOrderLines).toEqual([])
    })

    it('signs the empty query string for the POST', async () => {
      mock.onPost(`${ BASE }/SalesOrders`).reply({ Guid: 'so-9' })

      await service.createSalesOrder('c-1', [])

      expect(mock.history[0].headers['api-auth-signature']).toBe(sign(''))
    })

    it('throws on API error', async () => {
      mock.onPost(`${ BASE }/SalesOrders`).replyWithError({
        message: 'Bad Request',
        status: 400,
        body: { description: 'Customer not found' },
      })

      await expect(service.createSalesOrder('nope', [])).rejects.toThrow(
        'Unleashed Software API error [400]: Customer not found'
      )
    })
  })

  // ── Purchase Orders ──

  describe('getPurchaseOrders', () => {
    it('requests the default page', async () => {
      mock.onGet(`${ BASE }/PurchaseOrders/1`).reply({
        Pagination: {},
        Items: [{ Guid: 'po-1', OrderNumber: 'PO-0001' }],
      })

      const result = await service.getPurchaseOrders()

      expect(mock.history[0].url).toBe(`${ BASE }/PurchaseOrders/1`)
      expect(result.items[0].OrderNumber).toBe('PO-0001')
    })

    it('honors the page argument', async () => {
      mock.onGet(`${ BASE }/PurchaseOrders/5`).reply({ Items: [] })

      await service.getPurchaseOrders(5)

      expect(mock.history[0].url).toBe(`${ BASE }/PurchaseOrders/5`)
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/PurchaseOrders/1`).replyWithError({ message: 'fail', status: 500 })

      await expect(service.getPurchaseOrders()).rejects.toThrow(
        'Unleashed Software API error [500]: fail'
      )
    })
  })

  // ── Warehouses ──

  describe('getWarehouses', () => {
    it('requests all warehouses', async () => {
      mock.onGet(`${ BASE }/Warehouses`).reply({
        Pagination: { NumberOfItems: 1 },
        Items: [{ Guid: 'w-1', WarehouseCode: 'MAIN', IsDefault: true }],
      })

      const result = await service.getWarehouses()

      expect(mock.history[0].url).toBe(`${ BASE }/Warehouses`)
      expect(result.items[0].WarehouseCode).toBe('MAIN')
    })

    it('returns an empty list when Items is absent', async () => {
      mock.onGet(`${ BASE }/Warehouses`).reply({})

      const result = await service.getWarehouses()

      expect(result.items).toEqual([])
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/Warehouses`).replyWithError({ message: 'unauthorized', status: 401 })

      await expect(service.getWarehouses()).rejects.toThrow(
        'Unleashed Software API error [401]: unauthorized'
      )
    })
  })
})
