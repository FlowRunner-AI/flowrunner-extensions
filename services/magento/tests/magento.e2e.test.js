'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Magento 2 Service (e2e)', () => {
  let sandbox
  let service

  beforeAll(() => {
    sandbox = createE2ESandbox('magento')
    require('../src/index.js')

    try {
      sandbox.validateConfigs()
    } catch (error) {
      console.log(error)
      process.exit(1)
    }

    service = sandbox.getService()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  const uniqueSuffix = Date.now()

  // ── Products ──

  describe('listProducts', () => {
    it('returns items with expected shape', async () => {
      const result = await service.listProducts(undefined, 5, 1)

      expect(result).toHaveProperty('items')
      expect(result).toHaveProperty('total_count')
      expect(Array.isArray(result.items)).toBe(true)
    })

    it('applies filter and pagination', async () => {
      const result = await service.listProducts(
        [{ field: 'type_id', value: 'simple', conditionType: 'eq' }],
        2,
        1
      )

      expect(result).toHaveProperty('items')
      expect(result).toHaveProperty('total_count')
    })
  })

  describe('product CRUD lifecycle', () => {
    const testSku = `E2E-TEST-${ uniqueSuffix }`
    const testName = `E2E Test Product ${ uniqueSuffix }`

    it('creates a product', async () => {
      const result = await service.createProduct(testSku, testName, 9.99)

      expect(result).toHaveProperty('sku', testSku)
      expect(result).toHaveProperty('name', testName)
      expect(result).toHaveProperty('id')
    })

    it('gets the created product by SKU', async () => {
      const result = await service.getProduct(testSku)

      expect(result).toHaveProperty('sku', testSku)
      expect(result).toHaveProperty('name', testName)
      expect(result).toHaveProperty('price')
    })

    it('gets stock item for the product', async () => {
      const result = await service.getStockItem(testSku)

      expect(result).toHaveProperty('item_id')
      expect(result).toHaveProperty('qty')
      expect(result).toHaveProperty('is_in_stock')
    })

    it('updates stock for the product', async () => {
      const stock = await service.getStockItem(testSku)
      const result = await service.updateStock(testSku, stock.item_id, 50, true)

      expect(result).toHaveProperty('result')
    })

    it('updates the product', async () => {
      const result = await service.updateProduct(testSku, `${ testName } Updated`, 19.99)

      expect(result).toHaveProperty('sku', testSku)
      expect(result).toHaveProperty('name', `${ testName } Updated`)
    })

    it('deletes the product', async () => {
      const result = await service.deleteProduct(testSku)

      expect(result).toEqual({ result: true })
    })
  })

  // ── Categories ──

  describe('listCategories', () => {
    it('returns category tree with expected shape', async () => {
      const result = await service.listCategories()

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('name')
      expect(result).toHaveProperty('children_data')
      expect(Array.isArray(result.children_data)).toBe(true)
    })
  })

  describe('category CRUD lifecycle', () => {
    let createdCategoryId

    it('creates a category', async () => {
      const result = await service.createCategory(`E2E Category ${ uniqueSuffix }`)

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('name')
      createdCategoryId = result.id
    })

    it('gets the created category', async () => {
      const result = await service.getCategory(createdCategoryId)

      expect(result).toHaveProperty('id', createdCategoryId)
      expect(result).toHaveProperty('name')
      expect(result).toHaveProperty('parent_id')
    })

    it('gets products in the category (empty for new category)', async () => {
      const result = await service.getProductsInCategory(createdCategoryId)

      expect(result).toHaveProperty('products')
      expect(Array.isArray(result.products)).toBe(true)
    })
  })

  // ── Customers ──

  describe('listCustomers', () => {
    it('returns customer list with expected shape', async () => {
      const result = await service.listCustomers(undefined, 5, 1)

      expect(result).toHaveProperty('items')
      expect(result).toHaveProperty('total_count')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('customer CRUD lifecycle', () => {
    let createdCustomerId
    const testEmail = `e2e-test-${ uniqueSuffix }@example.com`

    it('creates a customer', async () => {
      const result = await service.createCustomer(testEmail, 'E2E', 'Test', 'E2eTest123!')

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('email', testEmail)
      createdCustomerId = result.id
    })

    it('gets the created customer', async () => {
      const result = await service.getCustomer(createdCustomerId)

      expect(result).toHaveProperty('id', createdCustomerId)
      expect(result).toHaveProperty('email', testEmail)
      expect(result).toHaveProperty('firstname', 'E2E')
    })

    it('updates the customer', async () => {
      const result = await service.updateCustomer(createdCustomerId, testEmail, 'E2E Updated')

      expect(result).toHaveProperty('id', createdCustomerId)
      expect(result).toHaveProperty('firstname', 'E2E Updated')
    })

    it('deletes the customer', async () => {
      const result = await service.deleteCustomer(createdCustomerId)

      expect(result).toEqual({ result: true })
    })
  })

  // ── Orders ──

  describe('listOrders', () => {
    it('returns order list with expected shape', async () => {
      const result = await service.listOrders(undefined, 5, 1)

      expect(result).toHaveProperty('items')
      expect(result).toHaveProperty('total_count')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Sales Documents ──

  describe('listInvoices', () => {
    it('returns invoice list with expected shape', async () => {
      const result = await service.listInvoices(undefined, 5, 1)

      expect(result).toHaveProperty('items')
      expect(result).toHaveProperty('total_count')
    })
  })

  describe('listShipments', () => {
    it('returns shipment list with expected shape', async () => {
      const result = await service.listShipments(undefined, 5, 1)

      expect(result).toHaveProperty('items')
      expect(result).toHaveProperty('total_count')
    })
  })

  describe('listCreditMemos', () => {
    it('returns credit memo list with expected shape', async () => {
      const result = await service.listCreditMemos(undefined, 5, 1)

      expect(result).toHaveProperty('items')
      expect(result).toHaveProperty('total_count')
    })
  })

  // ── Dictionary ──

  describe('getCategoriesDictionary', () => {
    it('returns flattened category items', async () => {
      const result = await service.getCategoriesDictionary({})

      expect(result).toHaveProperty('items')
      expect(result).toHaveProperty('cursor', null)
      expect(Array.isArray(result.items)).toBe(true)

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
        expect(result.items[0]).toHaveProperty('note')
      }
    })

    it('filters by search term', async () => {
      const allResult = await service.getCategoriesDictionary({})
      const searchResult = await service.getCategoriesDictionary({ search: 'zzzznonexistent' })

      expect(searchResult.items.length).toBeLessThanOrEqual(allResult.items.length)
    })
  })
})
