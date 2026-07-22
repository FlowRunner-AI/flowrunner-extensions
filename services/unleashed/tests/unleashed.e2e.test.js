'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Unleashed Software Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('unleashed')
    require('../src/index.js')

    try {
      sandbox.validateConfigs()
    } catch (error) {
      console.log(error)
      process.exit(1)
    }

    service = sandbox.getService()
    testValues = sandbox.getTestValues()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Products ──

  describe('getProducts', () => {
    it('returns a paginated product list', async () => {
      const result = await service.getProducts(1, 5)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)

      if (result.pagination) {
        expect(result.pagination).toHaveProperty('PageNumber')
      }
    })

    it('accepts a product code filter', async () => {
      const productCode = testValues.productCode

      if (!productCode) {
        console.log('Skipping getProducts filter: testValues.productCode not set')

        return
      }

      const result = await service.getProducts(1, 5, productCode)

      expect(Array.isArray(result.items)).toBe(true)
      result.items.forEach(item => expect(item.ProductCode).toBe(productCode))
    })
  })

  describe('getProduct', () => {
    it('returns a single product by guid', async () => {
      const guid = testValues.productGuid

      if (!guid) {
        console.log('Skipping getProduct: testValues.productGuid not set')

        return
      }

      const result = await service.getProduct(guid)

      expect(result).toHaveProperty('Guid')
      expect(result).toHaveProperty('ProductCode')
    })

    it('throws for an unknown guid', async () => {
      await expect(
        service.getProduct('00000000-0000-0000-0000-000000000000')
      ).rejects.toThrow(/Unleashed Software API error/)
    })
  })

  // ── Stock ──

  describe('getStockOnHand', () => {
    it('returns stock records', async () => {
      const result = await service.getStockOnHand(1)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getStockOnHandByProduct', () => {
    it('returns stock for a single product', async () => {
      const guid = testValues.productGuid

      if (!guid) {
        console.log('Skipping getStockOnHandByProduct: testValues.productGuid not set')

        return
      }

      const result = await service.getStockOnHandByProduct(guid)

      expect(result).toBeDefined()
    })
  })

  // ── Customers ──

  describe('getCustomers', () => {
    it('returns a paginated customer list', async () => {
      const result = await service.getCustomers(1)

      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getCustomer', () => {
    it('returns a single customer by guid', async () => {
      const guid = testValues.customerGuid

      if (!guid) {
        console.log('Skipping getCustomer: testValues.customerGuid not set')

        return
      }

      const result = await service.getCustomer(guid)

      expect(result).toHaveProperty('Guid')
      expect(result).toHaveProperty('CustomerCode')
    })
  })

  // ── Suppliers ──

  describe('getSuppliers', () => {
    it('returns a paginated supplier list', async () => {
      const result = await service.getSuppliers(1)

      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Sales Orders ──

  describe('getSalesOrders', () => {
    it('returns a paginated sales order list', async () => {
      const result = await service.getSalesOrders(1)

      expect(Array.isArray(result.items)).toBe(true)
    })

    it('accepts an order status filter', async () => {
      const result = await service.getSalesOrders(1, 'Placed')

      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getSalesOrder', () => {
    it('returns a single sales order by guid', async () => {
      const guid = testValues.salesOrderGuid

      if (!guid) {
        console.log('Skipping getSalesOrder: testValues.salesOrderGuid not set')

        return
      }

      const result = await service.getSalesOrder(guid)

      expect(result).toHaveProperty('Guid')
      expect(result).toHaveProperty('OrderNumber')
    })
  })

  describe('createSalesOrder', () => {
    it('creates a parked sales order', async () => {
      const { customerGuid, productGuid } = testValues

      if (!customerGuid || !productGuid) {
        console.log('Skipping createSalesOrder: testValues.customerGuid or productGuid not set')

        return
      }

      const result = await service.createSalesOrder(
        customerGuid,
        [{ productGuid, orderQuantity: 1 }],
        'Parked',
        undefined,
        'FlowRunner e2e test order'
      )

      expect(result).toHaveProperty('Guid')
      expect(result).toHaveProperty('OrderNumber')
    })
  })

  // ── Purchase Orders ──

  describe('getPurchaseOrders', () => {
    it('returns a paginated purchase order list', async () => {
      const result = await service.getPurchaseOrders(1)

      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Warehouses ──

  describe('getWarehouses', () => {
    it('returns the warehouse list', async () => {
      const result = await service.getWarehouses()

      expect(Array.isArray(result.items)).toBe(true)

      if (result.items.length) {
        expect(result.items[0]).toHaveProperty('WarehouseCode')
      }
    })
  })
})
