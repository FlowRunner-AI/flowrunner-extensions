'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

const SUFFIX = Date.now()

describe('WooCommerce Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('woocommerce')
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

  // ── Connection ──

  describe('listProducts', () => {
    it('reaches the store REST API and returns an array', async () => {
      const result = await service.listProducts(undefined, undefined, undefined, 5, 1)

      expect(Array.isArray(result)).toBe(true)
    })
  })

  // ── Product lifecycle ──

  describe('product lifecycle', () => {
    let categoryId
    let productId
    let variationId

    it('creates a product category', async () => {
      const result = await service.createProductCategory(`FR Test Cat ${ SUFFIX }`, undefined, 'Created by e2e tests')

      expect(result).toHaveProperty('id')
      categoryId = result.id
    })

    it('gets the created category', async () => {
      const result = await service.getProductCategory(categoryId)

      expect(result).toHaveProperty('id', categoryId)
    })

    it('lists categories', async () => {
      const result = await service.listProductCategories(`FR Test Cat ${ SUFFIX }`, 10, 1)

      expect(Array.isArray(result)).toBe(true)
    })

    it('updates the category', async () => {
      const result = await service.updateProductCategory(categoryId, `FR Test Cat ${ SUFFIX } (renamed)`)

      expect(result).toHaveProperty('id', categoryId)
    })

    it('creates a variable product in the category', async () => {
      const result = await service.createProduct(
        `FR Test Product ${ SUFFIX }`,
        'Variable (has variations)',
        'Draft',
        '21.99',
        undefined,
        10,
        'Created by e2e tests',
        `FR-${ SUFFIX }`,
        [categoryId]
      )

      expect(result).toHaveProperty('id')
      productId = result.id
    })

    it('gets the created product', async () => {
      const result = await service.getProduct(productId)

      expect(result).toHaveProperty('id', productId)
      expect(result).toHaveProperty('type', 'variable')
    })

    it('updates the product', async () => {
      const result = await service.updateProduct(productId, `FR Test Product ${ SUFFIX } (updated)`, '25.99')

      expect(result).toHaveProperty('id', productId)
    })

    it('creates a variation', async () => {
      const result = await service.createProductVariation(productId, '24.99', undefined, 5, `FR-${ SUFFIX }-V1`)

      expect(result).toHaveProperty('id')
      variationId = result.id
    })

    it('gets the variation', async () => {
      const result = await service.getProductVariation(productId, variationId)

      expect(result).toHaveProperty('id', variationId)
    })

    it('lists variations', async () => {
      const result = await service.listProductVariations(productId, 10, 1)

      expect(Array.isArray(result)).toBe(true)
    })

    it('updates the variation', async () => {
      const result = await service.updateProductVariation(productId, variationId, '23.99', undefined, 3)

      expect(result).toHaveProperty('id', variationId)
    })

    it('lists the product through the dictionary', async () => {
      const result = await service.getProductsDictionary({ search: `FR Test Product ${ SUFFIX }` })

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })

    it('lists the variation through the dictionary', async () => {
      const result = await service.getProductVariationsDictionary({ criteria: { productId } })

      expect(Array.isArray(result.items)).toBe(true)
    })

    it('deletes the variation', async () => {
      await expect(service.deleteProductVariation(productId, variationId)).resolves.toBeDefined()
    })

    it('deletes the product', async () => {
      await expect(service.deleteProduct(productId, true)).resolves.toBeDefined()
    })

    it('deletes the category', async () => {
      await expect(service.deleteProductCategory(categoryId)).resolves.toBeDefined()
    })
  })

  // ── Attribute lifecycle ──

  describe('attribute lifecycle', () => {
    let attributeId
    let termId

    it('creates a global attribute', async () => {
      const result = await service.createProductAttribute(`FR Attr ${ SUFFIX }`, `fr-attr-${ SUFFIX }`, 'select', 'Name', false)

      expect(result).toHaveProperty('id')
      attributeId = result.id
    })

    it('gets the attribute', async () => {
      const result = await service.getProductAttribute(attributeId)

      expect(result).toHaveProperty('id', attributeId)
    })

    it('lists attributes', async () => {
      const result = await service.listProductAttributes(undefined, 20, 1)

      expect(Array.isArray(result)).toBe(true)
    })

    it('updates the attribute', async () => {
      const result = await service.updateProductAttribute(attributeId, `FR Attr ${ SUFFIX } upd`)

      expect(result).toHaveProperty('id', attributeId)
    })

    it('creates a term', async () => {
      const result = await service.createAttributeTerm(attributeId, `FR Term ${ SUFFIX }`, undefined, 'e2e term', 1)

      expect(result).toHaveProperty('id')
      termId = result.id
    })

    it('gets the term', async () => {
      const result = await service.getAttributeTerm(attributeId, termId)

      expect(result).toHaveProperty('id', termId)
    })

    it('lists terms', async () => {
      const result = await service.listAttributeTerms(attributeId, undefined, 20, 1)

      expect(Array.isArray(result)).toBe(true)
    })

    it('updates the term', async () => {
      const result = await service.updateAttributeTerm(attributeId, termId, `FR Term ${ SUFFIX } upd`)

      expect(result).toHaveProperty('id', termId)
    })

    it('lists attributes and terms through dictionaries', async () => {
      const attrs = await service.getProductAttributesDictionary({})
      const terms = await service.getAttributeTermsDictionary({ criteria: { attributeId } })

      expect(Array.isArray(attrs.items)).toBe(true)
      expect(Array.isArray(terms.items)).toBe(true)
    })

    it('deletes the term', async () => {
      await expect(service.deleteAttributeTerm(attributeId, termId)).resolves.toBeDefined()
    })

    it('deletes the attribute', async () => {
      await expect(service.deleteProductAttribute(attributeId)).resolves.toBeDefined()
    })
  })

  // ── Customer lifecycle ──

  describe('customer lifecycle', () => {
    let customerId

    it('creates a customer', async () => {
      const result = await service.createCustomer(
        `fr-e2e-${ SUFFIX }@example.com`,
        'FlowRunner',
        'Tester',
        `fr_e2e_${ SUFFIX }`
      )

      expect(result).toHaveProperty('id')
      customerId = result.id
    })

    it('gets the customer', async () => {
      const result = await service.getCustomer(customerId)

      expect(result).toHaveProperty('id', customerId)
    })

    it('lists customers by email', async () => {
      const result = await service.listCustomers(undefined, `fr-e2e-${ SUFFIX }@example.com`, 10, 1)

      expect(Array.isArray(result)).toBe(true)
    })

    it('updates the customer', async () => {
      const result = await service.updateCustomer(customerId, 'Flow', 'Runner')

      expect(result).toHaveProperty('id', customerId)
    })

    it('lists customers through the dictionary', async () => {
      const result = await service.getCustomersDictionary({ search: 'fr_e2e' })

      expect(Array.isArray(result.items)).toBe(true)
    })

    it('deletes the customer', async () => {
      await expect(service.deleteCustomer(customerId)).resolves.toBeDefined()
    })
  })

  // ── Coupon lifecycle ──

  describe('coupon lifecycle', () => {
    let couponId

    it('creates a coupon', async () => {
      const result = await service.createCoupon(`FR${ SUFFIX }`, 'Percentage off', '5', 'Created by e2e tests')

      expect(result).toHaveProperty('id')
      couponId = result.id
    })

    it('gets the coupon', async () => {
      const result = await service.getCoupon(couponId)

      expect(result).toHaveProperty('id', couponId)
    })

    it('lists coupons', async () => {
      const result = await service.listCoupons(undefined, 10, 1)

      expect(Array.isArray(result)).toBe(true)
    })

    it('updates the coupon', async () => {
      const result = await service.updateCoupon(couponId, '7', 'Updated by e2e tests')

      expect(result).toHaveProperty('id', couponId)
    })

    it('lists coupons through the dictionary', async () => {
      const result = await service.getCouponsDictionary({})

      expect(Array.isArray(result.items)).toBe(true)
    })

    it('deletes the coupon', async () => {
      await expect(service.deleteCoupon(couponId, true)).resolves.toBeDefined()
    })
  })

  // ── Order lifecycle ──

  describe('order lifecycle', () => {
    let orderId
    let noteId

    it('creates an order', async () => {
      const result = await service.createOrder(
        'Pending payment',
        undefined,
        'bacs',
        false,
        { first_name: 'FlowRunner', last_name: 'Tester', email: `fr-order-${ SUFFIX }@example.com`, country: 'US' }
      )

      expect(result).toHaveProperty('id')
      orderId = result.id
    })

    it('gets the order', async () => {
      const result = await service.getOrder(orderId)

      expect(result).toHaveProperty('id', orderId)
    })

    it('lists orders', async () => {
      const result = await service.listOrders(undefined, undefined, undefined, 5, 1)

      expect(Array.isArray(result)).toBe(true)
    })

    it('updates the order status', async () => {
      const result = await service.updateOrder(orderId, 'On hold')

      expect(result).toHaveProperty('id', orderId)
    })

    it('creates an order note', async () => {
      const result = await service.createOrderNote(orderId, 'Created by e2e tests', false)

      expect(result).toHaveProperty('id')
      noteId = result.id
    })

    it('gets the order note', async () => {
      const result = await service.getOrderNote(orderId, noteId)

      expect(result).toHaveProperty('id', noteId)
    })

    it('lists the order notes', async () => {
      const result = await service.listOrderNotes(orderId)

      expect(Array.isArray(result)).toBe(true)
    })

    it('lists orders and notes through dictionaries', async () => {
      const orders = await service.getOrdersDictionary({})
      const notes = await service.getOrderNotesDictionary({ criteria: { orderId } })
      const refunds = await service.getOrderRefundsDictionary({ criteria: { orderId } })

      expect(Array.isArray(orders.items)).toBe(true)
      expect(Array.isArray(notes.items)).toBe(true)
      expect(Array.isArray(refunds.items)).toBe(true)
    })

    it('lists the order refunds', async () => {
      const result = await service.listOrderRefunds(orderId)

      expect(Array.isArray(result)).toBe(true)
    })

    it('deletes the order note', async () => {
      await expect(service.deleteOrderNote(orderId, noteId)).resolves.toBeDefined()
    })

    it('deletes the order', async () => {
      await expect(service.deleteOrder(orderId, true)).resolves.toBeDefined()
    })
  })

  // ── Param schema ──

  describe('addressSchema', () => {
    it('returns the address sub-form definition', async () => {
      const result = await service.addressSchema()

      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThan(0)
    })
  })

  // ── Triggers ──

  describe('webhook lifecycle', () => {
    it('creates, then deletes, the order.created webhook', async () => {
      if (!testValues.runWebhookTests) {
        console.log('Skipping webhook lifecycle: testValues.runWebhookTests not set')

        return
      }

      const upserted = await service.handleTriggerUpsertWebhook({
        events: [{ name: 'onOrderCreated' }],
        callbackUrl: 'https://example.com/flowrunner-callback',
        webhookData: {},
      })

      expect(upserted.webhookData.webhooks).toHaveLength(1)
      expect(upserted.webhookData.webhooks[0]).toHaveProperty('id')

      const deleted = await service.handleTriggerDeleteWebhook(upserted)

      expect(deleted).toEqual({ webhookData: { webhooks: [] } })
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('surfaces a hint for a missing resource', async () => {
      await expect(service.getProduct(99999999)).rejects.toThrow(/Not found/)
    })
  })
})
