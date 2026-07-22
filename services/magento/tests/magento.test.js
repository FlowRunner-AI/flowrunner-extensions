'use strict'

const { createSandbox } = require('../../../service-sandbox')

const BASE_URL = 'https://store.example.com'
const ACCESS_TOKEN = 'test-access-token'
const API_BASE = `${ BASE_URL }/rest/V1`

describe('Magento 2 Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ baseUrl: BASE_URL, accessToken: ACCESS_TOKEN })
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
          name: 'baseUrl',
          displayName: 'Store Base URL',
          required: true,
          shared: false,
          type: 'STRING',
        }),
        expect.objectContaining({
          name: 'accessToken',
          displayName: 'Access Token',
          required: true,
          shared: false,
          type: 'STRING',
        }),
      ])
    })

    it('has exactly two config items and none are shared', () => {
      const items = sandbox.getConfigItems()

      expect(items).toHaveLength(2)
      expect(items.every(item => item.shared === false)).toBe(true)
    })

    it('sends Bearer auth and JSON headers on requests', async () => {
      mock.onGet(`${ API_BASE }/products`).reply({ items: [], total_count: 0 })

      await service.listProducts()

      expect(mock.history[0].headers).toMatchObject({
        'Authorization': `Bearer ${ ACCESS_TOKEN }`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      })
    })
  })

  // ── Products ──

  describe('listProducts', () => {
    it('sends correct request with defaults', async () => {
      mock.onGet(`${ API_BASE }/products`).reply({ items: [], total_count: 0 })

      const result = await service.listProducts()

      expect(result).toEqual({ items: [], total_count: 0 })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({
        'searchCriteria[pageSize]': 20,
        'searchCriteria[currentPage]': 1,
      })
    })

    it('passes custom pagination', async () => {
      mock.onGet(`${ API_BASE }/products`).reply({ items: [], total_count: 0 })

      await service.listProducts(undefined, 10, 3)

      expect(mock.history[0].query).toMatchObject({
        'searchCriteria[pageSize]': 10,
        'searchCriteria[currentPage]': 3,
      })
    })

    it('builds filter query parameters', async () => {
      mock.onGet(`${ API_BASE }/products`).reply({ items: [], total_count: 0 })

      await service.listProducts([{ field: 'status', value: 1, conditionType: 'eq' }])

      expect(mock.history[0].query).toMatchObject({
        'searchCriteria[filter_groups][0][filters][0][field]': 'status',
        'searchCriteria[filter_groups][0][filters][0][value]': 1,
        'searchCriteria[filter_groups][0][filters][0][condition_type]': 'eq',
      })
    })

    it('builds sort order query parameters', async () => {
      mock.onGet(`${ API_BASE }/products`).reply({ items: [], total_count: 0 })

      await service.listProducts(undefined, undefined, undefined, [{ field: 'created_at', direction: 'DESC' }])

      expect(mock.history[0].query).toMatchObject({
        'searchCriteria[sortOrders][0][field]': 'created_at',
        'searchCriteria[sortOrders][0][direction]': 'DESC',
      })
    })

    it('handles multiple filters and sort orders', async () => {
      mock.onGet(`${ API_BASE }/products`).reply({ items: [], total_count: 0 })

      await service.listProducts(
        [
          { field: 'status', value: 1, conditionType: 'eq' },
          { field: 'name', value: '%bag%', conditionType: 'like' },
        ],
        5,
        1,
        [
          { field: 'price', direction: 'ASC' },
          { field: 'name', direction: 'DESC' },
        ]
      )

      const q = mock.history[0].query

      expect(q['searchCriteria[filter_groups][0][filters][0][field]']).toBe('status')
      expect(q['searchCriteria[filter_groups][1][filters][0][field]']).toBe('name')
      expect(q['searchCriteria[filter_groups][1][filters][0][value]']).toBe('%bag%')
      expect(q['searchCriteria[sortOrders][0][field]']).toBe('price')
      expect(q['searchCriteria[sortOrders][1][field]']).toBe('name')
      expect(q['searchCriteria[sortOrders][1][direction]']).toBe('DESC')
    })

    it('throws on API error', async () => {
      mock.onGet(`${ API_BASE }/products`).replyWithError({ message: 'Unauthorized' })

      await expect(service.listProducts()).rejects.toThrow('Magento 2 API error')
    })
  })

  describe('getProduct', () => {
    it('sends GET to correct URL with encoded SKU', async () => {
      mock.onGet(`${ API_BASE }/products/24-MB01`).reply({ id: 1, sku: '24-MB01', name: 'Bag' })

      const result = await service.getProduct('24-MB01')

      expect(result).toEqual({ id: 1, sku: '24-MB01', name: 'Bag' })
      expect(mock.history).toHaveLength(1)
    })

    it('encodes SKUs with special characters', async () => {
      mock.onGet(`${ API_BASE }/products/SKU%2F123`).reply({ id: 2, sku: 'SKU/123' })

      await service.getProduct('SKU/123')

      expect(mock.history[0].url).toBe(`${ API_BASE }/products/SKU%2F123`)
    })

    it('throws on API error', async () => {
      mock.onGet(`${ API_BASE }/products/MISSING`).replyWithError({
        message: 'The product that was requested doesn\'t exist.',
        body: { message: 'The product that was requested doesn\'t exist.' },
      })

      await expect(service.getProduct('MISSING')).rejects.toThrow('Magento 2 API error')
    })
  })

  describe('createProduct', () => {
    it('sends POST with required fields and defaults', async () => {
      mock.onPost(`${ API_BASE }/products`).reply({ id: 10, sku: 'NEW-01', name: 'Test' })

      const result = await service.createProduct('NEW-01', 'Test')

      expect(result).toEqual({ id: 10, sku: 'NEW-01', name: 'Test' })
      expect(mock.history[0].body).toEqual({
        product: {
          sku: 'NEW-01',
          name: 'Test',
          attribute_set_id: 4,
          type_id: 'simple',
          status: 1,
          visibility: 4,
        },
      })
    })

    it('includes optional fields when provided', async () => {
      mock.onPost(`${ API_BASE }/products`).reply({ id: 11 })

      await service.createProduct('NEW-02', 'Full', 29.99, 15, 'Virtual', 'Disabled', 'Catalog', 2.5)

      const body = mock.history[0].body

      expect(body.product).toMatchObject({
        sku: 'NEW-02',
        name: 'Full',
        price: 29.99,
        attribute_set_id: 15,
        type_id: 'virtual',
        status: 2,
        visibility: 2,
        weight: 2.5,
      })
    })

    it('includes custom attributes when provided', async () => {
      mock.onPost(`${ API_BASE }/products`).reply({ id: 12 })

      const attrs = [{ attribute_code: 'description', value: 'Great' }]

      await service.createProduct('NEW-03', 'WithAttrs', undefined, undefined, undefined, undefined, undefined, undefined, attrs)

      expect(mock.history[0].body.product.custom_attributes).toEqual(attrs)
    })

    it('omits custom_attributes when not provided', async () => {
      mock.onPost(`${ API_BASE }/products`).reply({ id: 13 })

      await service.createProduct('NEW-04', 'NoAttrs')

      expect(mock.history[0].body.product).not.toHaveProperty('custom_attributes')
    })

    it('resolves dropdown labels to API values', async () => {
      mock.onPost(`${ API_BASE }/products`).reply({ id: 14 })

      await service.createProduct('NEW-05', 'Test', undefined, undefined, 'Configurable', 'Enabled', 'Search')

      expect(mock.history[0].body.product).toMatchObject({
        type_id: 'configurable',
        status: 1,
        visibility: 3,
      })
    })
  })

  describe('updateProduct', () => {
    it('sends PUT to correct URL with body', async () => {
      mock.onPut(`${ API_BASE }/products/UPD-01`).reply({ id: 10, sku: 'UPD-01', name: 'Updated' })

      const result = await service.updateProduct('UPD-01', 'Updated', 39.99)

      expect(result).toEqual({ id: 10, sku: 'UPD-01', name: 'Updated' })
      expect(mock.history[0].body.product).toMatchObject({
        sku: 'UPD-01',
        name: 'Updated',
        price: 39.99,
      })
    })

    it('omits undefined optional fields via clean()', async () => {
      mock.onPut(`${ API_BASE }/products/UPD-02`).reply({ id: 11 })

      await service.updateProduct('UPD-02', 'Only Name')

      const product = mock.history[0].body.product

      expect(product.name).toBe('Only Name')
      expect(product).not.toHaveProperty('price')
      expect(product).not.toHaveProperty('weight')
    })

    it('includes custom attributes when provided', async () => {
      mock.onPut(`${ API_BASE }/products/UPD-03`).reply({ id: 12 })

      const attrs = [{ attribute_code: 'url_key', value: 'new-key' }]

      await service.updateProduct('UPD-03', undefined, undefined, undefined, undefined, undefined, attrs)

      expect(mock.history[0].body.product.custom_attributes).toEqual(attrs)
    })
  })

  describe('deleteProduct', () => {
    it('sends DELETE and wraps result', async () => {
      mock.onDelete(`${ API_BASE }/products/DEL-01`).reply(true)

      const result = await service.deleteProduct('DEL-01')

      expect(result).toEqual({ result: true })
      expect(mock.history).toHaveLength(1)
    })
  })

  describe('updateStock', () => {
    it('sends PUT with stock item body', async () => {
      mock.onPut(`${ API_BASE }/products/SKU-01/stockItems/1`).reply(1)

      const result = await service.updateStock('SKU-01', 1, 100)

      expect(result).toEqual({ result: 1 })
      expect(mock.history[0].body).toEqual({
        stockItem: { qty: 100, is_in_stock: true },
      })
    })

    it('respects explicit isInStock false', async () => {
      mock.onPut(`${ API_BASE }/products/SKU-02/stockItems/2`).reply(2)

      await service.updateStock('SKU-02', 2, 0, false)

      expect(mock.history[0].body.stockItem.is_in_stock).toBe(false)
    })
  })

  describe('getStockItem', () => {
    it('sends GET to stockItems path', async () => {
      mock.onGet(`${ API_BASE }/stockItems/SKU-01`).reply({ item_id: 1, qty: 50 })

      const result = await service.getStockItem('SKU-01')

      expect(result).toEqual({ item_id: 1, qty: 50 })
    })
  })

  // ── Orders ──

  describe('listOrders', () => {
    it('sends correct request with defaults', async () => {
      mock.onGet(`${ API_BASE }/orders`).reply({ items: [], total_count: 0 })

      const result = await service.listOrders()

      expect(result).toEqual({ items: [], total_count: 0 })
      expect(mock.history[0].query).toMatchObject({
        'searchCriteria[pageSize]': 20,
        'searchCriteria[currentPage]': 1,
      })
    })

    it('passes filters', async () => {
      mock.onGet(`${ API_BASE }/orders`).reply({ items: [], total_count: 0 })

      await service.listOrders([{ field: 'status', value: 'pending', conditionType: 'eq' }])

      expect(mock.history[0].query).toMatchObject({
        'searchCriteria[filter_groups][0][filters][0][field]': 'status',
        'searchCriteria[filter_groups][0][filters][0][value]': 'pending',
      })
    })
  })

  describe('getOrder', () => {
    it('sends GET to correct URL', async () => {
      mock.onGet(`${ API_BASE }/orders/42`).reply({ entity_id: 42, status: 'processing' })

      const result = await service.getOrder(42)

      expect(result).toEqual({ entity_id: 42, status: 'processing' })
    })
  })

  describe('createInvoiceForOrder', () => {
    it('sends POST with defaults and wraps result', async () => {
      mock.onPost(`${ API_BASE }/order/42/invoice`).reply(5)

      const result = await service.createInvoiceForOrder(42)

      expect(result).toEqual({ invoiceId: 5 })
      expect(mock.history[0].body).toEqual({ capture: false, notify: false })
    })

    it('passes capture and notify flags', async () => {
      mock.onPost(`${ API_BASE }/order/42/invoice`).reply(6)

      await service.createInvoiceForOrder(42, true, true)

      expect(mock.history[0].body).toMatchObject({ capture: true, notify: true })
    })

    it('includes items when provided', async () => {
      mock.onPost(`${ API_BASE }/order/42/invoice`).reply(7)

      const items = [{ order_item_id: 1, qty: 2 }]

      await service.createInvoiceForOrder(42, false, false, items)

      expect(mock.history[0].body.items).toEqual(items)
    })
  })

  describe('createShipment', () => {
    it('sends POST with defaults and wraps result', async () => {
      mock.onPost(`${ API_BASE }/order/42/ship`).reply(3)

      const result = await service.createShipment(42)

      expect(result).toEqual({ shipmentId: 3 })
      expect(mock.history[0].body).toEqual({ notify: false })
    })

    it('includes items and tracks when provided', async () => {
      mock.onPost(`${ API_BASE }/order/42/ship`).reply(4)

      const items = [{ order_item_id: 1, qty: 1 }]
      const tracks = [{ track_number: '1Z999', title: 'UPS', carrier_code: 'ups' }]

      await service.createShipment(42, items, tracks, true)

      expect(mock.history[0].body).toEqual({
        notify: true,
        items,
        tracks,
      })
    })
  })

  describe('addOrderComment', () => {
    it('sends POST with comment body and wraps result', async () => {
      mock.onPost(`${ API_BASE }/orders/42/comments`).reply(true)

      const result = await service.addOrderComment(42, 'Test comment')

      expect(result).toEqual({ result: true })
      expect(mock.history[0].body).toEqual({
        statusHistory: {
          comment: 'Test comment',
          is_customer_notified: 0,
        },
      })
    })

    it('includes status and notification flag', async () => {
      mock.onPost(`${ API_BASE }/orders/42/comments`).reply(true)

      await service.addOrderComment(42, 'Done', 'complete', true)

      expect(mock.history[0].body.statusHistory).toMatchObject({
        comment: 'Done',
        status: 'complete',
        is_customer_notified: 1,
      })
    })
  })

  describe('cancelOrder', () => {
    it('sends POST and wraps result', async () => {
      mock.onPost(`${ API_BASE }/orders/42/cancel`).reply(true)

      const result = await service.cancelOrder(42)

      expect(result).toEqual({ result: true })
    })
  })

  describe('holdOrder', () => {
    it('sends POST and wraps result', async () => {
      mock.onPost(`${ API_BASE }/orders/42/hold`).reply(true)

      const result = await service.holdOrder(42)

      expect(result).toEqual({ result: true })
    })
  })

  describe('unholdOrder', () => {
    it('sends POST and wraps result', async () => {
      mock.onPost(`${ API_BASE }/orders/42/unhold`).reply(true)

      const result = await service.unholdOrder(42)

      expect(result).toEqual({ result: true })
    })
  })

  // ── Customers ──

  describe('listCustomers', () => {
    it('sends GET to customers/search with defaults', async () => {
      mock.onGet(`${ API_BASE }/customers/search`).reply({ items: [], total_count: 0 })

      const result = await service.listCustomers()

      expect(result).toEqual({ items: [], total_count: 0 })
      expect(mock.history[0].query).toMatchObject({
        'searchCriteria[pageSize]': 20,
        'searchCriteria[currentPage]': 1,
      })
    })
  })

  describe('getCustomer', () => {
    it('sends GET to correct URL', async () => {
      mock.onGet(`${ API_BASE }/customers/5`).reply({ id: 5, email: 'jane@example.com' })

      const result = await service.getCustomer(5)

      expect(result).toEqual({ id: 5, email: 'jane@example.com' })
    })
  })

  describe('createCustomer', () => {
    it('sends POST with required fields', async () => {
      mock.onPost(`${ API_BASE }/customers`).reply({ id: 10, email: 'new@example.com' })

      const result = await service.createCustomer('new@example.com', 'Jane', 'Doe')

      expect(result).toEqual({ id: 10, email: 'new@example.com' })
      expect(mock.history[0].body).toEqual({
        customer: {
          email: 'new@example.com',
          firstname: 'Jane',
          lastname: 'Doe',
        },
      })
    })

    it('includes password when provided', async () => {
      mock.onPost(`${ API_BASE }/customers`).reply({ id: 11 })

      await service.createCustomer('new@example.com', 'Jane', 'Doe', 'Secret123!')

      expect(mock.history[0].body.password).toBe('Secret123!')
    })

    it('omits password when not provided', async () => {
      mock.onPost(`${ API_BASE }/customers`).reply({ id: 12 })

      await service.createCustomer('new@example.com', 'Jane', 'Doe')

      expect(mock.history[0].body).not.toHaveProperty('password')
    })

    it('includes optional websiteId and groupId', async () => {
      mock.onPost(`${ API_BASE }/customers`).reply({ id: 13 })

      await service.createCustomer('new@example.com', 'Jane', 'Doe', undefined, 2, 3)

      expect(mock.history[0].body.customer).toMatchObject({
        website_id: 2,
        group_id: 3,
      })
    })
  })

  describe('updateCustomer', () => {
    it('sends PUT with customer data including id', async () => {
      mock.onPut(`${ API_BASE }/customers/5`).reply({ id: 5, email: 'updated@example.com' })

      const result = await service.updateCustomer(5, 'updated@example.com', 'Jane', 'Smith')

      expect(result).toEqual({ id: 5, email: 'updated@example.com' })
      expect(mock.history[0].body).toEqual({
        customer: {
          id: 5,
          email: 'updated@example.com',
          firstname: 'Jane',
          lastname: 'Smith',
        },
      })
    })

    it('includes groupId when provided', async () => {
      mock.onPut(`${ API_BASE }/customers/5`).reply({ id: 5 })

      await service.updateCustomer(5, undefined, undefined, undefined, 2)

      expect(mock.history[0].body.customer).toMatchObject({
        id: 5,
        group_id: 2,
      })
    })
  })

  describe('deleteCustomer', () => {
    it('sends DELETE and wraps result', async () => {
      mock.onDelete(`${ API_BASE }/customers/5`).reply(true)

      const result = await service.deleteCustomer(5)

      expect(result).toEqual({ result: true })
    })
  })

  // ── Categories ──

  describe('listCategories', () => {
    it('sends GET to categories path', async () => {
      const tree = { id: 2, name: 'Default Category', children_data: [] }

      mock.onGet(`${ API_BASE }/categories`).reply(tree)

      const result = await service.listCategories()

      expect(result).toEqual(tree)
    })

    it('passes rootCategoryId and depth as query params', async () => {
      mock.onGet(`${ API_BASE }/categories`).reply({ id: 3, name: 'Gear', children_data: [] })

      await service.listCategories(3, 2)

      expect(mock.history[0].query).toMatchObject({
        rootCategoryId: 3,
        depth: 2,
      })
    })

    it('omits undefined params from query', async () => {
      mock.onGet(`${ API_BASE }/categories`).reply({ id: 2, name: 'Root', children_data: [] })

      await service.listCategories()

      const q = mock.history[0].query

      expect(q).not.toHaveProperty('rootCategoryId')
      expect(q).not.toHaveProperty('depth')
    })
  })

  describe('getCategory', () => {
    it('sends GET to correct URL', async () => {
      mock.onGet(`${ API_BASE }/categories/3`).reply({ id: 3, name: 'Gear' })

      const result = await service.getCategory(3)

      expect(result).toEqual({ id: 3, name: 'Gear' })
    })
  })

  describe('createCategory', () => {
    it('sends POST with defaults', async () => {
      mock.onPost(`${ API_BASE }/categories`).reply({ id: 10, name: 'New Cat' })

      const result = await service.createCategory('New Cat')

      expect(result).toEqual({ id: 10, name: 'New Cat' })
      expect(mock.history[0].body).toEqual({
        category: {
          name: 'New Cat',
          parent_id: 2,
          is_active: true,
        },
      })
    })

    it('passes custom parentId and isActive', async () => {
      mock.onPost(`${ API_BASE }/categories`).reply({ id: 11 })

      await service.createCategory('Inactive Cat', 5, false)

      expect(mock.history[0].body.category).toMatchObject({
        name: 'Inactive Cat',
        parent_id: 5,
        is_active: false,
      })
    })
  })

  describe('getProductsInCategory', () => {
    it('sends GET and wraps result', async () => {
      const products = [{ sku: '24-MB01', position: 1, category_id: '3' }]

      mock.onGet(`${ API_BASE }/categories/3/products`).reply(products)

      const result = await service.getProductsInCategory(3)

      expect(result).toEqual({ products })
    })
  })

  // ── Sales Documents ──

  describe('listInvoices', () => {
    it('sends GET with defaults', async () => {
      mock.onGet(`${ API_BASE }/invoices`).reply({ items: [], total_count: 0 })

      const result = await service.listInvoices()

      expect(result).toEqual({ items: [], total_count: 0 })
      expect(mock.history[0].query).toMatchObject({
        'searchCriteria[pageSize]': 20,
        'searchCriteria[currentPage]': 1,
      })
    })

    it('passes filters', async () => {
      mock.onGet(`${ API_BASE }/invoices`).reply({ items: [], total_count: 0 })

      await service.listInvoices([{ field: 'order_id', value: 1, conditionType: 'eq' }])

      expect(mock.history[0].query).toMatchObject({
        'searchCriteria[filter_groups][0][filters][0][field]': 'order_id',
      })
    })
  })

  describe('getInvoice', () => {
    it('sends GET to correct URL', async () => {
      mock.onGet(`${ API_BASE }/invoices/7`).reply({ entity_id: 7, order_id: 42 })

      const result = await service.getInvoice(7)

      expect(result).toEqual({ entity_id: 7, order_id: 42 })
    })
  })

  describe('listShipments', () => {
    it('sends GET with defaults', async () => {
      mock.onGet(`${ API_BASE }/shipments`).reply({ items: [], total_count: 0 })

      const result = await service.listShipments()

      expect(result).toEqual({ items: [], total_count: 0 })
      expect(mock.history[0].query).toMatchObject({
        'searchCriteria[pageSize]': 20,
        'searchCriteria[currentPage]': 1,
      })
    })
  })

  describe('listCreditMemos', () => {
    it('sends GET with defaults', async () => {
      mock.onGet(`${ API_BASE }/creditmemos`).reply({ items: [], total_count: 0 })

      const result = await service.listCreditMemos()

      expect(result).toEqual({ items: [], total_count: 0 })
      expect(mock.history[0].query).toMatchObject({
        'searchCriteria[pageSize]': 20,
        'searchCriteria[currentPage]': 1,
      })
    })
  })

  // ── Dictionary ──

  describe('getCategoriesDictionary', () => {
    const tree = {
      id: 2,
      name: 'Default Category',
      level: 1,
      children_data: [
        {
          id: 3,
          name: 'Gear',
          level: 2,
          children_data: [
            { id: 4, name: 'Bags', level: 3, children_data: [] },
          ],
        },
        { id: 5, name: 'Training', level: 2, children_data: [] },
      ],
    }

    it('returns flattened category tree', async () => {
      mock.onGet(`${ API_BASE }/categories`).reply(tree)

      const result = await service.getCategoriesDictionary({})

      expect(result.cursor).toBeNull()
      expect(result.items).toEqual([
        { label: 'Default Category', value: '2', note: 'Level 1' },
        { label: '  Gear', value: '3', note: 'Level 2' },
        { label: '    Bags', value: '4', note: 'Level 3' },
        { label: '  Training', value: '5', note: 'Level 2' },
      ])
    })

    it('filters by search term', async () => {
      mock.onGet(`${ API_BASE }/categories`).reply(tree)

      const result = await service.getCategoriesDictionary({ search: 'gear' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('3')
    })

    it('returns all items when search is empty', async () => {
      mock.onGet(`${ API_BASE }/categories`).reply(tree)

      const result = await service.getCategoriesDictionary({ search: '' })

      expect(result.items).toHaveLength(4)
    })

    it('handles null payload', async () => {
      mock.onGet(`${ API_BASE }/categories`).reply(tree)

      const result = await service.getCategoriesDictionary(null)

      expect(result.items).toHaveLength(4)
    })
  })

  // ── Error Handling ──

  describe('error handling', () => {
    it('interpolates parameterized error messages with array', async () => {
      mock.onGet(`${ API_BASE }/products/BAD`).replyWithError({
        message: 'Not Found',
        body: {
          message: 'The product with SKU "%1" doesn\'t exist.',
          parameters: ['BAD'],
        },
      })

      await expect(service.getProduct('BAD')).rejects.toThrow(
        'Magento 2 API error: The product with SKU "BAD" doesn\'t exist.'
      )
    })

    it('interpolates parameterized error messages with object', async () => {
      mock.onGet(`${ API_BASE }/products/BAD2`).replyWithError({
        message: 'Not Found',
        body: {
          message: 'The product with SKU "%sku" doesn\'t exist.',
          parameters: { sku: 'BAD2' },
        },
      })

      await expect(service.getProduct('BAD2')).rejects.toThrow(
        'Magento 2 API error: The product with SKU "BAD2" doesn\'t exist.'
      )
    })

    it('falls back to error.message when body.message is absent', async () => {
      mock.onGet(`${ API_BASE }/orders/999`).replyWithError({
        message: 'Internal Server Error',
      })

      await expect(service.getOrder(999)).rejects.toThrow('Magento 2 API error: Internal Server Error')
    })

    it('falls back to default error message when body has no message', async () => {
      mock.onGet(`${ API_BASE }/orders/999`).replyWithError({
        message: 'Request failed',
        body: {},
      })

      await expect(service.getOrder(999)).rejects.toThrow('Magento 2 API error: Request failed')
    })
  })
})
