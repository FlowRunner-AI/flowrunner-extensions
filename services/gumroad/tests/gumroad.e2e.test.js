'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Gumroad Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('gumroad')
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

  // A unique-ish suffix so repeated e2e runs don't collide.
  const suffix = Date.now()

  // Some tests need a real product id. The developer supplies it via
  // testValues.productId (recommended). If absent, we fall back to the first
  // product returned by listProducts (set in beforeAll below).
  let productId

  // ── User ──

  describe('getCurrentUser', () => {
    it('returns the authenticated user with expected shape', async () => {
      const response = await service.getCurrentUser()

      expect(response).toHaveProperty('success', true)
      expect(response).toHaveProperty('user')
      expect(response.user).toHaveProperty('user_id')
    })
  })

  // ── Products ──

  describe('listProducts', () => {
    it('returns products with expected shape', async () => {
      const response = await service.listProducts()

      expect(response).toHaveProperty('success', true)
      expect(response).toHaveProperty('products')
      expect(Array.isArray(response.products)).toBe(true)

      // Resolve a product id for later tests if the developer didn't provide one.
      productId = testValues.productId || (response.products[0] && response.products[0].id)
    })
  })

  describe('getProductsDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getProductsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor', null)
    })

    it('filters by a search term without error', async () => {
      const result = await service.getProductsDictionary({ search: 'zzz-no-such-product' })

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getProduct', () => {
    it('returns a single product when a product id is available', async () => {
      if (!productId) {
        console.log('Skipping getProduct: no product available (set testValues.productId)')
        return
      }

      const response = await service.getProduct(productId)

      expect(response).toHaveProperty('success', true)
      expect(response).toHaveProperty('product')
      expect(response.product).toHaveProperty('id', productId)
    })
  })

  // ── Sales ──

  describe('listSales', () => {
    it('returns sales with expected shape', async () => {
      const response = await service.listSales()

      expect(response).toHaveProperty('success', true)
      expect(response).toHaveProperty('sales')
      expect(Array.isArray(response.sales)).toBe(true)
    })

    it('accepts date and product filters without error', async () => {
      const response = await service.listSales('2020-01-01', undefined, productId)

      expect(response).toHaveProperty('success', true)
      expect(Array.isArray(response.sales)).toBe(true)
    })
  })

  describe('getSale', () => {
    it('returns a single sale when a sale id is available', async () => {
      const list = await service.listSales()
      const sale = list.sales && list.sales[0]

      if (!sale) {
        console.log('Skipping getSale: no sales on this account')
        return
      }

      const response = await service.getSale(sale.id)

      expect(response).toHaveProperty('success', true)
      expect(response).toHaveProperty('sale')
      expect(response.sale).toHaveProperty('id', sale.id)
    })
  })

  // ── Subscribers ──

  describe('listSubscribers', () => {
    it('returns subscribers with expected shape when a product id is available', async () => {
      if (!productId) {
        console.log('Skipping listSubscribers: no product available (set testValues.productId)')
        return
      }

      const response = await service.listSubscribers(productId)

      expect(response).toHaveProperty('success', true)
      expect(response).toHaveProperty('subscribers')
      expect(Array.isArray(response.subscribers)).toBe(true)
    })
  })

  // ── Licenses ──

  describe('verifyLicense', () => {
    // Verifying a real license needs testValues.productId + testValues.licenseKey.
    const canVerify = () => Boolean(testValues.productId && testValues.licenseKey)

    it('verifies a license when product id and license key are configured', async () => {
      if (!canVerify()) {
        console.log('Skipping verifyLicense: set testValues.productId and testValues.licenseKey')
        return
      }

      // Pass false to avoid incrementing the real uses count on every run.
      const response = await service.verifyLicense(
        testValues.productId,
        testValues.licenseKey,
        false
      )

      expect(response).toHaveProperty('success', true)
      expect(response).toHaveProperty('purchase')
    })
  })

  // ── Offer Codes ──

  describe('listOfferCodes', () => {
    it('returns offer codes with expected shape when a product id is available', async () => {
      if (!productId) {
        console.log('Skipping listOfferCodes: no product available (set testValues.productId)')
        return
      }

      const response = await service.listOfferCodes(productId)

      expect(response).toHaveProperty('success', true)
      expect(response).toHaveProperty('offer_codes')
      expect(Array.isArray(response.offer_codes)).toBe(true)
    })
  })

  describe('createOfferCode + getOfferCode + updateOfferCode + deleteOfferCode', () => {
    let offerCodeId

    it('creates an offer code', async () => {
      if (!productId) {
        console.log('Skipping offer code lifecycle: no product available (set testValues.productId)')
        return
      }

      const response = await service.createOfferCode(
        productId,
        `E2E${ suffix }`.slice(0, 20),
        100,
        'Fixed Amount',
        5
      )

      expect(response).toHaveProperty('success', true)
      expect(response).toHaveProperty('offer_code')
      offerCodeId = response.offer_code.id
    })

    it('retrieves the created offer code', async () => {
      if (!offerCodeId) {
        return
      }

      const response = await service.getOfferCode(productId, offerCodeId)

      expect(response).toHaveProperty('success', true)
      expect(response.offer_code).toHaveProperty('id', offerCodeId)
    })

    it('updates the offer code max purchase count', async () => {
      if (!offerCodeId) {
        return
      }

      const response = await service.updateOfferCode(productId, offerCodeId, 10)

      expect(response).toHaveProperty('success', true)
    })

    it('deletes the offer code', async () => {
      if (!offerCodeId) {
        return
      }

      const response = await service.deleteOfferCode(productId, offerCodeId)

      expect(response).toHaveProperty('success', true)
    })

    afterAll(async () => {
      if (offerCodeId && productId) {
        try {
          await service.deleteOfferCode(productId, offerCodeId)
        } catch (e) {
          // ignore cleanup errors (already deleted)
        }
      }
    })
  })

  // ── Variants ──

  describe('listVariantCategories', () => {
    it('returns variant categories with expected shape when a product id is available', async () => {
      if (!productId) {
        console.log('Skipping listVariantCategories: no product available (set testValues.productId)')
        return
      }

      const response = await service.listVariantCategories(productId)

      expect(response).toHaveProperty('success', true)
      expect(response).toHaveProperty('variant_categories')
      expect(Array.isArray(response.variant_categories)).toBe(true)
    })
  })

  // ── Resource Subscriptions ──

  describe('listResourceSubscriptions', () => {
    it('returns resource subscriptions with expected shape', async () => {
      const response = await service.listResourceSubscriptions('Sale')

      expect(response).toHaveProperty('success', true)
      expect(response).toHaveProperty('resource_subscriptions')
      expect(Array.isArray(response.resource_subscriptions)).toBe(true)
    })
  })

  describe('createResourceSubscription + deleteResourceSubscription', () => {
    let resourceSubscriptionId

    it('creates a resource subscription', async () => {
      const response = await service.createResourceSubscription(
        'Sale',
        `https://example.com/gumroad/e2e/${ suffix }`
      )

      expect(response).toHaveProperty('success', true)
      expect(response).toHaveProperty('resource_subscription')
      resourceSubscriptionId = response.resource_subscription.id
    })

    it('deletes the resource subscription', async () => {
      if (!resourceSubscriptionId) {
        return
      }

      const response = await service.deleteResourceSubscription(resourceSubscriptionId)

      expect(response).toHaveProperty('success', true)
    })

    afterAll(async () => {
      if (resourceSubscriptionId) {
        try {
          await service.deleteResourceSubscription(resourceSubscriptionId)
        } catch (e) {
          // ignore cleanup errors (already deleted)
        }
      }
    })
  })
})
