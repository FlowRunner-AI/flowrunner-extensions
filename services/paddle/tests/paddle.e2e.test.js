'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

const SUFFIX = Date.now()

describe('Paddle Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('paddle')
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

  // ── Products & prices lifecycle ──

  describe('products and prices', () => {
    let productId
    let priceId

    it('creates a product', async () => {
      const result = await service.createProduct(
        `E2E Product ${ SUFFIX }`,
        'Standard',
        'Created by the FlowRunner e2e suite'
      )

      expect(result).toHaveProperty('data.id')
      expect(result.data).toHaveProperty('tax_category', 'standard')

      productId = result.data.id
    })

    it('lists products', async () => {
      const result = await service.listProducts('Active', 10)

      expect(Array.isArray(result.data)).toBe(true)
      expect(result).toHaveProperty('meta')
    })

    it('gets the created product', async () => {
      const result = await service.getProduct(productId)

      expect(result.data).toHaveProperty('id', productId)
      expect(result.data.name).toContain(`${ SUFFIX }`)
    })

    it('updates the created product', async () => {
      const result = await service.updateProduct(productId, `E2E Product ${ SUFFIX } (updated)`)

      expect(result.data.name).toContain('(updated)')
    })

    it('creates a price for the product', async () => {
      const result = await service.createPrice(
        productId,
        `E2E Price ${ SUFFIX }`,
        { amount: '1000', currency_code: 'USD' },
        { interval: 'month', frequency: 1 }
      )

      expect(result).toHaveProperty('data.id')
      expect(result.data).toHaveProperty('product_id', productId)

      priceId = result.data.id
    })

    it('lists prices for the product', async () => {
      const result = await service.listPrices(productId, 'Active', 10)

      expect(Array.isArray(result.data)).toBe(true)
      expect(result.data.some(price => price.id === priceId)).toBe(true)
    })

    it('gets the created price', async () => {
      const result = await service.getPrice(priceId)

      expect(result.data).toHaveProperty('id', priceId)
    })

    it('updates the created price', async () => {
      const result = await service.updatePrice(priceId, `E2E Price ${ SUFFIX } (updated)`)

      expect(result.data.description).toContain('(updated)')
    })

    it('archives the price and the product', async () => {
      const archivedPrice = await service.updatePrice(
        priceId, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'Archived'
      )

      expect(archivedPrice.data).toHaveProperty('status', 'archived')

      const archivedProduct = await service.updateProduct(
        productId, undefined, undefined, undefined, undefined, undefined, 'Archived'
      )

      expect(archivedProduct.data).toHaveProperty('status', 'archived')
    })
  })

  // ── Customers ──

  describe('customers', () => {
    let customerId

    it('creates a customer', async () => {
      const result = await service.createCustomer(`e2e+${ SUFFIX }@flowrunner.test`, 'E2E Tester')

      expect(result).toHaveProperty('data.id')

      customerId = result.data.id
    })

    it('lists customers', async () => {
      const result = await service.listCustomers(undefined, 'Active', 10)

      expect(Array.isArray(result.data)).toBe(true)
    })

    it('gets the created customer', async () => {
      const result = await service.getCustomer(customerId)

      expect(result.data).toHaveProperty('id', customerId)
    })

    it('updates the created customer', async () => {
      const result = await service.updateCustomer(customerId, undefined, 'E2E Tester Updated')

      expect(result.data).toHaveProperty('name', 'E2E Tester Updated')
    })

    it('gets the credit balances of the created customer', async () => {
      const result = await service.getCustomerCreditBalances(customerId)

      expect(Array.isArray(result.data)).toBe(true)
    })

    it('archives the created customer', async () => {
      const result = await service.updateCustomer(customerId, undefined, undefined, undefined, 'Archived')

      expect(result.data).toHaveProperty('status', 'archived')
    })
  })

  // ── Discounts ──

  describe('discounts', () => {
    let discountId

    it('creates a discount', async () => {
      const result = await service.createDiscount(
        `E2E Discount ${ SUFFIX }`,
        '10',
        'Percentage',
        undefined,
        `E2E${ SUFFIX }`
      )

      expect(result).toHaveProperty('data.id')
      expect(result.data).toHaveProperty('type', 'percentage')

      discountId = result.data.id
    })

    it('lists discounts', async () => {
      const result = await service.listDiscounts('Active', undefined, 10)

      expect(Array.isArray(result.data)).toBe(true)
    })

    it('gets the created discount', async () => {
      const result = await service.getDiscount(discountId)

      expect(result.data).toHaveProperty('id', discountId)
    })

    it('updates and archives the created discount', async () => {
      const updated = await service.updateDiscount(discountId, undefined, '15')

      expect(updated.data).toHaveProperty('amount', '15')

      const archived = await service.updateDiscount(
        discountId, undefined, undefined, undefined, undefined, undefined, 'Archived'
      )

      expect(archived.data).toHaveProperty('status', 'archived')
    })
  })

  // ── Read-only collections ──

  describe('read-only collections', () => {
    it('lists subscriptions', async () => {
      const result = await service.listSubscriptions(undefined, undefined, 5)

      expect(Array.isArray(result.data)).toBe(true)
    })

    it('lists transactions', async () => {
      const result = await service.listTransactions(undefined, undefined, 5)

      expect(Array.isArray(result.data)).toBe(true)
    })

    it('lists adjustments', async () => {
      const result = await service.listAdjustments(undefined, undefined, undefined, undefined, 5)

      expect(Array.isArray(result.data)).toBe(true)
    })
  })

  // ── Optional, testValues-driven lookups ──

  describe('testValues-driven lookups', () => {
    it('gets a subscription', async () => {
      const { subscriptionId } = testValues

      if (!subscriptionId) {
        console.log('Skipping getSubscription: testValues.subscriptionId not set')

        return
      }

      const result = await service.getSubscription(subscriptionId)

      expect(result.data).toHaveProperty('id', subscriptionId)
    })

    it('gets a transaction and its invoice PDF link', async () => {
      const { transactionId } = testValues

      if (!transactionId) {
        console.log('Skipping getTransaction: testValues.transactionId not set')

        return
      }

      const transaction = await service.getTransaction(transactionId)

      expect(transaction.data).toHaveProperty('id', transactionId)

      const invoice = await service.getTransactionInvoicePdf(transactionId)

      expect(invoice).toHaveProperty('data.url')
    })

    it('creates a transaction from a price', async () => {
      const { priceId } = testValues

      if (!priceId) {
        console.log('Skipping createTransaction: testValues.priceId not set')

        return
      }

      const result = await service.createTransaction([{ price_id: priceId, quantity: 1 }])

      expect(result).toHaveProperty('data.id')
    })
  })

  // ── Dictionaries ──

  describe('dictionaries', () => {
    it('returns products for selection', async () => {
      const result = await service.getProductsDictionary({})

      expect(Array.isArray(result.items)).toBe(true)

      result.items.forEach(item => {
        expect(item).toHaveProperty('label')
        expect(item).toHaveProperty('value')
      })
    })

    it('returns prices for selection', async () => {
      const result = await service.getPricesDictionary({})

      expect(Array.isArray(result.items)).toBe(true)
    })

    it('returns customers for selection', async () => {
      const result = await service.getCustomersDictionary({})

      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('throws a formatted error for a missing product', async () => {
      await expect(service.getProduct('pro_00000000000000000000000000'))
        .rejects.toThrow(/Paddle API error/)
    })
  })
})
