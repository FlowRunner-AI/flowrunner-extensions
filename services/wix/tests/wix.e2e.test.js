'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

const SUFFIX = Date.now()

describe('Wix Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('wix')
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

  // ── Site ──

  describe('getSiteProperties', () => {
    it('returns the connected site properties', async () => {
      const result = await service.getSiteProperties()

      expect(result).toHaveProperty('properties')
    })
  })

  // ── Contacts ──

  describe('contacts lifecycle', () => {
    let contactId

    it('creates a contact', async () => {
      const result = await service.createContact(
        'FlowRunner',
        `E2E ${ SUFFIX }`,
        `flowrunner.e2e.${ SUFFIX }@example.com`
      )

      expect(result).toHaveProperty('contact')
      expect(result.contact).toHaveProperty('id')

      contactId = result.contact.id
    })

    it('retrieves the created contact', async () => {
      if (!contactId) {
        console.log('Skipping getContact: no contact was created')

        return
      }

      const result = await service.getContact(contactId)

      expect(result.contact).toHaveProperty('id', contactId)
      expect(result.contact).toHaveProperty('revision')
    })

    it('queries contacts by email', async () => {
      const result = await service.queryContacts(
        { 'info.emails.email': { $eq: `flowrunner.e2e.${ SUFFIX }@example.com` } },
        'createdDate',
        'Descending',
        5,
        0
      )

      expect(result).toHaveProperty('contacts')
      expect(Array.isArray(result.contacts)).toBe(true)
    })

    it('updates the contact using an auto-resolved revision', async () => {
      if (!contactId) {
        console.log('Skipping updateContact: no contact was created')

        return
      }

      const result = await service.updateContact(contactId, { company: 'FlowRunner QA' })

      expect(result.contact).toHaveProperty('id', contactId)
    })

    it('lists contact labels', async () => {
      const result = await service.listContactLabels(10, 0)

      expect(result).toHaveProperty('labels')
      expect(Array.isArray(result.labels)).toBe(true)
    })

    it('returns the contact labels dictionary', async () => {
      const result = await service.getContactLabelsDictionary({})

      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor')
    })

    it('filters the contact labels dictionary by an unmatched search term', async () => {
      const result = await service.getContactLabelsDictionary({ search: 'zzz-no-such-label' })

      expect(result.items).toEqual([])
    })

    it('labels and unlabels the contact', async () => {
      const { contactLabelKey } = testValues

      if (!contactId || !contactLabelKey) {
        console.log('Skipping labelContact/unlabelContact: no contact or testValues.contactLabelKey not set')

        return
      }

      const labelled = await service.labelContact(contactId, [contactLabelKey])

      expect(labelled).toHaveProperty('contact')

      const unlabelled = await service.unlabelContact(contactId, [contactLabelKey])

      expect(unlabelled).toHaveProperty('contact')
    })

    it('deletes the contact', async () => {
      if (!contactId) {
        console.log('Skipping deleteContact: no contact was created')

        return
      }

      const result = await service.deleteContact(contactId)

      expect(result).toEqual({ deleted: true, contactId })
    })
  })

  // ── CMS Data ──

  describe('cms data', () => {
    let itemId

    it('lists data collections', async () => {
      const result = await service.listDataCollections(10, 0)

      expect(result).toHaveProperty('collections')
      expect(Array.isArray(result.collections)).toBe(true)
    })

    it('returns the data collections dictionary', async () => {
      const result = await service.getDataCollectionsDictionary({})

      expect(Array.isArray(result.items)).toBe(true)
    })

    it('inserts an item into the test collection', async () => {
      const { dataCollectionId } = testValues

      if (!dataCollectionId) {
        console.log('Skipping insertDataItem: testValues.dataCollectionId not set')

        return
      }

      const result = await service.insertDataItem(dataCollectionId, {
        title: `FlowRunner e2e ${ SUFFIX }`,
      })

      expect(result).toHaveProperty('dataItem')
      itemId = result.dataItem.id || result.dataItem.data?._id
    })

    it('queries items in the test collection', async () => {
      const { dataCollectionId } = testValues

      if (!dataCollectionId) {
        console.log('Skipping queryDataItems: testValues.dataCollectionId not set')

        return
      }

      const result = await service.queryDataItems(
        dataCollectionId,
        undefined,
        '_createdDate',
        'Descending',
        5,
        0,
        true
      )

      expect(result).toHaveProperty('dataItems')
      expect(Array.isArray(result.dataItems)).toBe(true)
    })

    it('retrieves the inserted item', async () => {
      const { dataCollectionId } = testValues

      if (!dataCollectionId || !itemId) {
        console.log('Skipping getDataItem: no item was inserted')

        return
      }

      const result = await service.getDataItem(dataCollectionId, itemId)

      expect(result).toHaveProperty('dataItem')
    })

    it('updates the inserted item', async () => {
      const { dataCollectionId } = testValues

      if (!dataCollectionId || !itemId) {
        console.log('Skipping updateDataItem: no item was inserted')

        return
      }

      const result = await service.updateDataItem(dataCollectionId, itemId, {
        title: `FlowRunner e2e ${ SUFFIX } (updated)`,
      })

      expect(result).toHaveProperty('dataItem')
    })

    it('saves (upserts) the item', async () => {
      const { dataCollectionId } = testValues

      if (!dataCollectionId || !itemId) {
        console.log('Skipping saveDataItem: no item was inserted')

        return
      }

      const result = await service.saveDataItem(dataCollectionId, {
        _id: itemId,
        title: `FlowRunner e2e ${ SUFFIX } (saved)`,
      })

      expect(result).toHaveProperty('dataItem')
    })

    it('removes the inserted item', async () => {
      const { dataCollectionId } = testValues

      if (!dataCollectionId || !itemId) {
        console.log('Skipping removeDataItem: no item was inserted')

        return
      }

      const result = await service.removeDataItem(dataCollectionId, itemId)

      expect(result).toHaveProperty('dataItem')
    })
  })

  // ── Store products ──

  describe('store products', () => {
    let productId

    it('queries products', async () => {
      const result = await service.queryProducts(undefined, 'name', 'Ascending', 5, 0, false)

      expect(result).toHaveProperty('products')
      expect(Array.isArray(result.products)).toBe(true)
    })

    it('returns the products dictionary', async () => {
      const result = await service.getProductsDictionary({})

      expect(Array.isArray(result.items)).toBe(true)
    })

    it('creates a product', async () => {
      const result = await service.createProduct(
        `FlowRunner E2E Product ${ SUFFIX }`,
        'Physical',
        19.99,
        'Created by the FlowRunner e2e test suite',
        `FR-E2E-${ SUFFIX }`,
        false
      )

      expect(result).toHaveProperty('product')
      expect(result.product).toHaveProperty('id')

      productId = result.product.id
    })

    it('retrieves the created product', async () => {
      if (!productId) {
        console.log('Skipping getProduct: no product was created')

        return
      }

      const result = await service.getProduct(productId)

      expect(result.product).toHaveProperty('id', productId)
    })

    it('updates the created product', async () => {
      if (!productId) {
        console.log('Skipping updateProduct: no product was created')

        return
      }

      const result = await service.updateProduct(productId, {
        name: `FlowRunner E2E Product ${ SUFFIX } (updated)`,
      })

      expect(result).toHaveProperty('product')
    })

    it('deletes the created product', async () => {
      if (!productId) {
        console.log('Skipping deleteProduct: no product was created')

        return
      }

      const result = await service.deleteProduct(productId)

      expect(result).toEqual({ deleted: true, productId })
    })
  })

  // ── Orders ──

  describe('orders', () => {
    it('searches orders', async () => {
      const result = await service.searchOrders(undefined, 'createdDate', 'Descending', 5)

      expect(result).toHaveProperty('orders')
      expect(Array.isArray(result.orders)).toBe(true)
    })

    it('retrieves a known order', async () => {
      const { orderId } = testValues

      if (!orderId) {
        console.log('Skipping getOrder: testValues.orderId not set')

        return
      }

      const result = await service.getOrder(orderId)

      expect(result).toHaveProperty('order')
      expect(result.order).toHaveProperty('id', orderId)
    })

    it('creates a fulfillment for a known order line item', async () => {
      const { fulfillableOrderId, fulfillableLineItemId } = testValues

      if (!fulfillableOrderId || !fulfillableLineItemId) {
        console.log('Skipping createOrderFulfillment: testValues.fulfillableOrderId or testValues.fulfillableLineItemId not set')

        return
      }

      const result = await service.createOrderFulfillment(
        fulfillableOrderId,
        [{ id: fulfillableLineItemId, quantity: 1 }],
        '1Z999AA10123456784',
        'ups',
        undefined,
        'Fulfilled'
      )

      expect(result).toHaveProperty('fulfillmentId')
    })
  })

  // ── Blog ──

  describe('blog', () => {
    it('lists blog posts', async () => {
      const result = await service.listBlogPosts(false, 'Newest First', 5, 0)

      expect(result).toHaveProperty('posts')
      expect(Array.isArray(result.posts)).toBe(true)
    })

    it('lists blog categories', async () => {
      const result = await service.listBlogCategories(5, 0)

      expect(result).toHaveProperty('categories')
      expect(Array.isArray(result.categories)).toBe(true)
    })

    it('retrieves a known blog post', async () => {
      const { blogPostId } = testValues

      if (!blogPostId) {
        console.log('Skipping getBlogPost: testValues.blogPostId not set')

        return
      }

      const result = await service.getBlogPost(blogPostId)

      expect(result).toHaveProperty('post')
      expect(result.post).toHaveProperty('id', blogPostId)
    })

    it('creates a draft blog post', async () => {
      const { memberId } = testValues

      if (!memberId) {
        console.log('Skipping createDraftBlogPost: testValues.memberId not set')

        return
      }

      const result = await service.createDraftBlogPost(
        `FlowRunner E2E Post ${ SUFFIX }`,
        'First paragraph.\n\nSecond paragraph.',
        undefined,
        memberId,
        'Created by the FlowRunner e2e test suite'
      )

      expect(result).toHaveProperty('draftPost')
      expect(result.draftPost).toHaveProperty('id')
    })
  })

  // ── Coupons ──

  describe('coupons lifecycle', () => {
    let couponId

    it('creates a percent off coupon', async () => {
      const result = await service.createCoupon(
        `FlowRunner E2E ${ SUFFIX }`,
        `FRE2E${ SUFFIX }`.slice(0, 20),
        'Percent Off',
        10
      )

      expect(result).toHaveProperty('id')

      couponId = result.id
    })

    it('queries coupons', async () => {
      const result = await service.queryCoupons(undefined, 5, 0)

      expect(result).toHaveProperty('coupons')
      expect(Array.isArray(result.coupons)).toBe(true)
    })

    it('retrieves the created coupon', async () => {
      if (!couponId) {
        console.log('Skipping getCoupon: no coupon was created')

        return
      }

      const result = await service.getCoupon(couponId)

      expect(result).toHaveProperty('id', couponId)
    })

    it('deletes the created coupon', async () => {
      if (!couponId) {
        console.log('Skipping deleteCoupon: no coupon was created')

        return
      }

      const result = await service.deleteCoupon(couponId)

      expect(result).toEqual({ deleted: true, couponId })
    })
  })

  // ── Members ──

  describe('members', () => {
    it('lists site members', async () => {
      const result = await service.listMembers('Full', 5, 0)

      expect(result).toHaveProperty('members')
      expect(Array.isArray(result.members)).toBe(true)
    })

    it('retrieves a known member', async () => {
      const { memberId } = testValues

      if (!memberId) {
        console.log('Skipping getMember: testValues.memberId not set')

        return
      }

      const result = await service.getMember(memberId, 'Extended')

      expect(result).toHaveProperty('member')
      expect(result.member).toHaveProperty('id', memberId)
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('throws a Wix API error for an unknown contact id', async () => {
      await expect(service.getContact('00000000-0000-0000-0000-000000000000'))
        .rejects.toThrow(/Wix API error/)
    })
  })
})
