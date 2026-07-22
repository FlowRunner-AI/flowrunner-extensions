'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-api-key'
const ACCOUNT_ID = 'account-123'
const SITE_ID = 'site-456'

const BASE = 'https://www.wixapis.com'

const EXPECTED_HEADERS = {
  'Authorization': API_KEY,
  'wix-account-id': ACCOUNT_ID,
  'wix-site-id': SITE_ID,
  'Content-Type': 'application/json',
}

describe('Wix Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ apiKey: API_KEY, accountId: ACCOUNT_ID, siteId: SITE_ID })
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
    it('registers the expected config items', () => {
      const configItems = sandbox.getConfigItems()

      expect(configItems.map(item => item.name)).toEqual(['apiKey', 'accountId', 'siteId'])

      expect(configItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'apiKey', required: true, shared: false, type: 'STRING' }),
          expect.objectContaining({ name: 'accountId', required: true, shared: false, type: 'STRING' }),
          expect.objectContaining({ name: 'siteId', required: true, shared: false, type: 'STRING' }),
        ])
      )
    })

    it('stores the configuration on the instance', () => {
      expect(service.apiKey).toBe(API_KEY)
      expect(service.accountId).toBe(ACCOUNT_ID)
      expect(service.siteId).toBe(SITE_ID)
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('surfaces the Wix body message', async () => {
      mock.onGet(`${ BASE }/site-properties/v4/properties`).replyWithError({
        message: 'Request failed',
        body: { message: 'Missing permission' },
      })

      await expect(service.getSiteProperties()).rejects.toThrow('Wix API error: Missing permission')
    })

    it('falls back to the application error description', async () => {
      mock.onGet(`${ BASE }/site-properties/v4/properties`).replyWithError({
        message: 'Request failed',
        body: { details: { applicationError: { description: 'Site not found' } } },
      })

      await expect(service.getSiteProperties()).rejects.toThrow('Wix API error: Site not found')
    })

    it('falls back to the transport error message', async () => {
      mock.onGet(`${ BASE }/site-properties/v4/properties`).replyWithError({ message: 'Network down' })

      await expect(service.getSiteProperties()).rejects.toThrow('Wix API error: Network down')
    })

    it('stringifies a non-string error message', async () => {
      mock.onGet(`${ BASE }/site-properties/v4/properties`).replyWithError({ message: { code: 42 } })

      await expect(service.getSiteProperties()).rejects.toThrow('Wix API error: {"code":42}')
    })
  })

  // ── Contacts ──

  describe('queryContacts', () => {
    it('sends an empty query when no arguments are given', async () => {
      mock.onPost(`${ BASE }/contacts/v4/contacts/query`).reply({ contacts: [] })

      const result = await service.queryContacts()

      expect(result).toEqual({ contacts: [] })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].headers).toMatchObject(EXPECTED_HEADERS)
      expect(mock.history[0].body).toEqual({ query: {} })
    })

    it('builds filter, sort and paging sections', async () => {
      mock.onPost(`${ BASE }/contacts/v4/contacts/query`).reply({ contacts: [] })

      await service.queryContacts(
        { 'info.name.last': { $eq: 'Lovelace' } },
        'createdDate',
        'Descending',
        10,
        20
      )

      expect(mock.history[0].body).toEqual({
        query: {
          filter: { 'info.name.last': { $eq: 'Lovelace' } },
          sort: [{ fieldName: 'createdDate', order: 'DESC' }],
          paging: { limit: 10, offset: 20 },
        },
      })
    })

    it('defaults the sort order to ascending', async () => {
      mock.onPost(`${ BASE }/contacts/v4/contacts/query`).reply({ contacts: [] })

      await service.queryContacts(undefined, 'createdDate')

      expect(mock.history[0].body.query.sort).toEqual([{ fieldName: 'createdDate', order: 'ASC' }])
    })
  })

  describe('getContact', () => {
    it('requests a contact by id', async () => {
      mock.onGet(`${ BASE }/contacts/v4/contacts/c-1`).reply({ contact: { id: 'c-1' } })

      const result = await service.getContact('c-1')

      expect(result).toEqual({ contact: { id: 'c-1' } })
      expect(mock.history[0].body).toBeUndefined()
    })
  })

  describe('createContact', () => {
    it('builds contact info from the convenience fields', async () => {
      mock.onPost(`${ BASE }/contacts/v4/contacts`).reply({ contact: { id: 'c-1' } })

      const result = await service.createContact(
        'Ada',
        'Lovelace',
        'ada@example.com',
        '+15551234567',
        ['custom.vip']
      )

      expect(result).toEqual({ contact: { id: 'c-1' } })

      expect(mock.history[0].body).toEqual({
        info: {
          name: { first: 'Ada', last: 'Lovelace' },
          emails: { items: [{ email: 'ada@example.com', primary: true }] },
          phones: { items: [{ phone: '+15551234567', primary: true }] },
          labelKeys: { items: ['custom.vip'] },
        },
      })
    })

    it('merges additional info and lets convenience fields win', async () => {
      mock.onPost(`${ BASE }/contacts/v4/contacts`).reply({ contact: { id: 'c-2' } })

      await service.createContact('Ada', undefined, undefined, undefined, [], {
        company: 'Acme',
        name: { first: 'Ignored', middle: 'M' },
      })

      expect(mock.history[0].body).toEqual({
        info: {
          company: 'Acme',
          name: { middle: 'M', first: 'Ada' },
        },
      })
    })

    it('sends an empty info object when nothing is provided', async () => {
      mock.onPost(`${ BASE }/contacts/v4/contacts`).reply({ contact: { id: 'c-3' } })

      await service.createContact()

      expect(mock.history[0].body).toEqual({ info: {} })
    })
  })

  describe('updateContact', () => {
    it('uses the supplied revision without a lookup', async () => {
      mock.onPatch(`${ BASE }/contacts/v4/contacts/c-1`).reply({ contact: { id: 'c-1', revision: 4 } })

      const result = await service.updateContact('c-1', { company: 'Acme' }, 3)

      expect(result).toEqual({ contact: { id: 'c-1', revision: 4 } })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('patch')
      expect(mock.history[0].body).toEqual({ revision: 3, info: { company: 'Acme' } })
    })

    it('fetches the current revision when it is omitted', async () => {
      mock.onGet(`${ BASE }/contacts/v4/contacts/c-1`).reply({ contact: { id: 'c-1', revision: 7 } })
      mock.onPatch(`${ BASE }/contacts/v4/contacts/c-1`).reply({ contact: { id: 'c-1', revision: 8 } })

      await service.updateContact('c-1', { company: 'Acme' })

      expect(mock.history).toHaveLength(2)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[1].body).toEqual({ revision: 7, info: { company: 'Acme' } })
    })

    it('tolerates a lookup response without a contact', async () => {
      mock.onGet(`${ BASE }/contacts/v4/contacts/c-1`).reply({})
      mock.onPatch(`${ BASE }/contacts/v4/contacts/c-1`).reply({ contact: { id: 'c-1' } })

      await service.updateContact('c-1', { company: 'Acme' }, null)

      expect(mock.history[1].body).toEqual({ revision: undefined, info: { company: 'Acme' } })
    })
  })

  describe('deleteContact', () => {
    it('deletes a contact and returns a confirmation', async () => {
      mock.onDelete(`${ BASE }/contacts/v4/contacts/c-1`).reply({})

      const result = await service.deleteContact('c-1')

      expect(result).toEqual({ deleted: true, contactId: 'c-1' })
      expect(mock.history[0].method).toBe('delete')
    })
  })

  describe('listContactLabels', () => {
    it('sends paging query params', async () => {
      mock.onGet(`${ BASE }/contacts/v4/labels`).reply({ labels: [] })

      const result = await service.listContactLabels(25, 50)

      expect(result).toEqual({ labels: [] })
      expect(mock.history[0].query).toEqual({ 'paging.limit': 25, 'paging.offset': 50 })
    })

    it('omits undefined paging params', async () => {
      mock.onGet(`${ BASE }/contacts/v4/labels`).reply({ labels: [] })

      await service.listContactLabels()

      expect(mock.history[0].query).toEqual({})
    })
  })

  describe('labelContact', () => {
    it('posts the label keys', async () => {
      mock.onPost(`${ BASE }/contacts/v4/contacts/c-1/labels`).reply({ contact: { id: 'c-1' } })

      const result = await service.labelContact('c-1', ['custom.vip'])

      expect(result).toEqual({ contact: { id: 'c-1' } })
      expect(mock.history[0].body).toEqual({ labelKeys: ['custom.vip'] })
    })
  })

  describe('unlabelContact', () => {
    it('sends a delete with the label keys in the body', async () => {
      mock.onDelete(`${ BASE }/contacts/v4/contacts/c-1/labels`).reply({ contact: { id: 'c-1' } })

      const result = await service.unlabelContact('c-1', ['custom.vip'])

      expect(result).toEqual({ contact: { id: 'c-1' } })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].body).toEqual({ labelKeys: ['custom.vip'] })
    })
  })

  // ── CMS Data ──

  describe('queryDataItems', () => {
    it('sends the collection id with an empty query', async () => {
      mock.onPost(`${ BASE }/wix-data/v2/items/query`).reply({ dataItems: [] })

      const result = await service.queryDataItems('MyCollection')

      expect(result).toEqual({ dataItems: [] })
      expect(mock.history[0].body).toEqual({ dataCollectionId: 'MyCollection', query: {} })
    })

    it('includes filter, sort, paging and total count', async () => {
      mock.onPost(`${ BASE }/wix-data/v2/items/query`).reply({ dataItems: [] })

      await service.queryDataItems(
        'MyCollection',
        { status: { $eq: 'active' } },
        'title',
        'Descending',
        5,
        10,
        true
      )

      expect(mock.history[0].body).toEqual({
        dataCollectionId: 'MyCollection',
        query: {
          filter: { status: { $eq: 'active' } },
          sort: [{ fieldName: 'title', order: 'DESC' }],
          paging: { limit: 5, offset: 10 },
        },
        returnTotalCount: true,
      })
    })
  })

  describe('getDataItem', () => {
    it('requests an item with the collection id as a query param', async () => {
      mock.onGet(`${ BASE }/wix-data/v2/items/item-1`).reply({ dataItem: { id: 'item-1' } })

      const result = await service.getDataItem('MyCollection', 'item-1')

      expect(result).toEqual({ dataItem: { id: 'item-1' } })
      expect(mock.history[0].query).toEqual({ dataCollectionId: 'MyCollection' })
    })
  })

  describe('insertDataItem', () => {
    it('wraps the data in a dataItem envelope', async () => {
      mock.onPost(`${ BASE }/wix-data/v2/items`).reply({ dataItem: { id: 'item-1' } })

      const result = await service.insertDataItem('MyCollection', { title: 'Launch Plan' })

      expect(result).toEqual({ dataItem: { id: 'item-1' } })

      expect(mock.history[0].body).toEqual({
        dataCollectionId: 'MyCollection',
        dataItem: { data: { title: 'Launch Plan' } },
      })
    })
  })

  describe('updateDataItem', () => {
    it('injects the item id into the data payload', async () => {
      mock.onPut(`${ BASE }/wix-data/v2/items/item-1`).reply({ dataItem: { id: 'item-1' } })

      const result = await service.updateDataItem('MyCollection', 'item-1', { title: 'v2' })

      expect(result).toEqual({ dataItem: { id: 'item-1' } })
      expect(mock.history[0].method).toBe('put')

      expect(mock.history[0].body).toEqual({
        dataCollectionId: 'MyCollection',
        dataItem: { data: { title: 'v2', _id: 'item-1' } },
      })
    })
  })

  describe('saveDataItem', () => {
    it('upserts an item', async () => {
      mock.onPost(`${ BASE }/wix-data/v2/items/save`).reply({ dataItem: { id: 'external-42' } })

      const result = await service.saveDataItem('MyCollection', { _id: 'external-42', title: 'X' })

      expect(result).toEqual({ dataItem: { id: 'external-42' } })

      expect(mock.history[0].body).toEqual({
        dataCollectionId: 'MyCollection',
        dataItem: { data: { _id: 'external-42', title: 'X' } },
      })
    })
  })

  describe('removeDataItem', () => {
    it('removes an item with the collection id as a query param', async () => {
      mock.onDelete(`${ BASE }/wix-data/v2/items/item-1`).reply({ dataItem: { id: 'item-1' } })

      const result = await service.removeDataItem('MyCollection', 'item-1')

      expect(result).toEqual({ dataItem: { id: 'item-1' } })
      expect(mock.history[0].query).toEqual({ dataCollectionId: 'MyCollection' })
    })
  })

  describe('listDataCollections', () => {
    it('sends paging query params', async () => {
      mock.onGet(`${ BASE }/wix-data/v2/collections`).reply({ collections: [] })

      const result = await service.listDataCollections(10, 0)

      expect(result).toEqual({ collections: [] })
      expect(mock.history[0].query).toEqual({ 'paging.limit': 10, 'paging.offset': 0 })
    })
  })

  // ── Store products ──

  describe('queryProducts', () => {
    it('sends an empty query body when no arguments are given', async () => {
      mock.onPost(`${ BASE }/stores-reader/v1/products/query`).reply({ products: [] })

      const result = await service.queryProducts()

      expect(result).toEqual({ products: [] })
      expect(mock.history[0].body).toEqual({ query: {} })
    })

    it('stringifies the filter and sort sections', async () => {
      mock.onPost(`${ BASE }/stores-reader/v1/products/query`).reply({ products: [] })

      await service.queryProducts({ name: { $contains: 'shirt' } }, 'price', 'Descending', 5, 10, true)

      expect(mock.history[0].body).toEqual({
        query: {
          filter: '{"name":{"$contains":"shirt"}}',
          sort: '[{"price":"desc"}]',
          paging: { limit: 5, offset: 10 },
        },
        includeVariants: true,
      })
    })

    it('accepts an already stringified filter and defaults the sort direction', async () => {
      mock.onPost(`${ BASE }/stores-reader/v1/products/query`).reply({ products: [] })

      await service.queryProducts('{"visible":true}', 'name')

      expect(mock.history[0].body.query.filter).toBe('{"visible":true}')
      expect(mock.history[0].body.query.sort).toBe('[{"name":"asc"}]')
    })
  })

  describe('getProduct', () => {
    it('requests a product by id', async () => {
      mock.onGet(`${ BASE }/stores-reader/v1/products/p-1`).reply({ product: { id: 'p-1' } })

      const result = await service.getProduct('p-1')

      expect(result).toEqual({ product: { id: 'p-1' } })
    })
  })

  describe('createProduct', () => {
    it('creates a physical product by default', async () => {
      mock.onPost(`${ BASE }/stores/v1/products`).reply({ product: { id: 'p-1' } })

      const result = await service.createProduct('Classic T-Shirt', undefined, 25)

      expect(result).toEqual({ product: { id: 'p-1' } })

      expect(mock.history[0].body).toEqual({
        product: {
          name: 'Classic T-Shirt',
          productType: 'physical',
          priceData: { price: 25 },
        },
      })
    })

    it('includes optional fields and merges additional fields', async () => {
      mock.onPost(`${ BASE }/stores/v1/products`).reply({ product: { id: 'p-2' } })

      await service.createProduct(
        'Ebook',
        'Digital',
        9.99,
        'A digital book',
        'EBOOK-1',
        false,
        { ribbon: 'New' }
      )

      expect(mock.history[0].body).toEqual({
        product: {
          ribbon: 'New',
          name: 'Ebook',
          productType: 'digital',
          priceData: { price: 9.99 },
          description: 'A digital book',
          sku: 'EBOOK-1',
          visible: false,
        },
      })
    })
  })

  describe('updateProduct', () => {
    it('patches the product fields', async () => {
      mock.onPatch(`${ BASE }/stores/v1/products/p-1`).reply({ product: { id: 'p-1' } })

      const result = await service.updateProduct('p-1', { name: 'Premium T-Shirt' })

      expect(result).toEqual({ product: { id: 'p-1' } })
      expect(mock.history[0].body).toEqual({ product: { name: 'Premium T-Shirt' } })
    })
  })

  describe('deleteProduct', () => {
    it('deletes a product and returns a confirmation', async () => {
      mock.onDelete(`${ BASE }/stores/v1/products/p-1`).reply({})

      const result = await service.deleteProduct('p-1')

      expect(result).toEqual({ deleted: true, productId: 'p-1' })
    })
  })

  // ── Orders ──

  describe('searchOrders', () => {
    it('sends an empty search when no arguments are given', async () => {
      mock.onPost(`${ BASE }/ecom/v1/orders/search`).reply({ orders: [] })

      const result = await service.searchOrders()

      expect(result).toEqual({ orders: [] })
      expect(mock.history[0].body).toEqual({ search: {} })
    })

    it('builds filter, sort and cursor paging', async () => {
      mock.onPost(`${ BASE }/ecom/v1/orders/search`).reply({ orders: [] })

      await service.searchOrders(
        { status: { $eq: 'APPROVED' } },
        'createdDate',
        'Descending',
        25,
        'cursor-abc'
      )

      expect(mock.history[0].body).toEqual({
        search: {
          filter: { status: { $eq: 'APPROVED' } },
          sort: [{ fieldName: 'createdDate', order: 'DESC' }],
          cursorPaging: { limit: 25, cursor: 'cursor-abc' },
        },
      })
    })
  })

  describe('getOrder', () => {
    it('requests an order by id', async () => {
      mock.onGet(`${ BASE }/ecom/v1/orders/o-1`).reply({ order: { id: 'o-1' } })

      const result = await service.getOrder('o-1')

      expect(result).toEqual({ order: { id: 'o-1' } })
    })
  })

  describe('createOrderFulfillment', () => {
    it('creates a fulfillment with only line items', async () => {
      mock.onPost(`${ BASE }/ecom/v1/fulfillments/orders/o-1/create-fulfillment`)
        .reply({ fulfillmentId: 'f-1' })

      const result = await service.createOrderFulfillment('o-1', [{ id: 'li-1', quantity: 2 }])

      expect(result).toEqual({ fulfillmentId: 'f-1' })

      expect(mock.history[0].body).toEqual({
        fulfillment: { lineItems: [{ id: 'li-1', quantity: 2 }] },
      })
    })

    it('includes tracking info and maps the status label', async () => {
      mock.onPost(`${ BASE }/ecom/v1/fulfillments/orders/o-1/create-fulfillment`)
        .reply({ fulfillmentId: 'f-2' })

      await service.createOrderFulfillment(
        'o-1',
        [{ id: 'li-1' }],
        '1Z999AA10123456784',
        'ups',
        undefined,
        'In Delivery'
      )

      expect(mock.history[0].body).toEqual({
        fulfillment: {
          lineItems: [{ id: 'li-1' }],
          trackingInfo: { trackingNumber: '1Z999AA10123456784', shippingProvider: 'ups' },
          status: 'In_Delivery',
        },
      })
    })

    it('passes an unmapped status through unchanged', async () => {
      mock.onPost(`${ BASE }/ecom/v1/fulfillments/orders/o-1/create-fulfillment`)
        .reply({ fulfillmentId: 'f-3' })

      await service.createOrderFulfillment('o-1', [{ id: 'li-1' }], undefined, undefined, undefined, 'Fulfilled')

      expect(mock.history[0].body.fulfillment.status).toBe('Fulfilled')
    })
  })

  // ── Blog ──

  describe('listBlogPosts', () => {
    it('sends no query params by default', async () => {
      mock.onGet(`${ BASE }/blog/v3/posts`).reply({ posts: [] })

      const result = await service.listBlogPosts()

      expect(result).toEqual({ posts: [] })
      expect(mock.history[0].query).toEqual({})
    })

    it('maps the featured flag, sort label and paging', async () => {
      mock.onGet(`${ BASE }/blog/v3/posts`).reply({ posts: [] })

      await service.listBlogPosts(true, 'Most Viewed', 10, 5)

      expect(mock.history[0].query).toEqual({
        featured: true,
        sort: 'VIEW_COUNT',
        'paging.limit': 10,
        'paging.offset': 5,
      })
    })

    it('omits the featured flag when it is false', async () => {
      mock.onGet(`${ BASE }/blog/v3/posts`).reply({ posts: [] })

      await service.listBlogPosts(false, 'Newest First')

      expect(mock.history[0].query).toEqual({ sort: 'PUBLISHED_DATE_DESC' })
    })
  })

  describe('getBlogPost', () => {
    it('requests a post by id', async () => {
      mock.onGet(`${ BASE }/blog/v3/posts/post-1`).reply({ post: { id: 'post-1' } })

      const result = await service.getBlogPost('post-1')

      expect(result).toEqual({ post: { id: 'post-1' } })
    })
  })

  describe('createDraftBlogPost', () => {
    it('creates a title-only draft', async () => {
      mock.onPost(`${ BASE }/blog/v3/draft-posts`).reply({ draftPost: { id: 'd-1' } })

      const result = await service.createDraftBlogPost('Launch Recap')

      expect(result).toEqual({ draftPost: { id: 'd-1' } })
      expect(mock.history[0].body).toEqual({ draftPost: { title: 'Launch Recap' } })
      expect(mock.history[0].query).toEqual({})
    })

    it('converts plain text into rich content paragraphs', async () => {
      mock.onPost(`${ BASE }/blog/v3/draft-posts`).reply({ draftPost: { id: 'd-2' } })

      await service.createDraftBlogPost('Launch Recap', 'First para\n\nSecond para')

      expect(mock.history[0].body.draftPost.richContent).toEqual({
        nodes: [
          {
            type: 'PARAGRAPH',
            id: 'p1',
            nodes: [{ type: 'TEXT', id: '', nodes: [], textData: { text: 'First para', decorations: [] } }],
            paragraphData: {},
          },
          {
            type: 'PARAGRAPH',
            id: 'p2',
            nodes: [{ type: 'TEXT', id: '', nodes: [], textData: { text: 'Second para', decorations: [] } }],
            paragraphData: {},
          },
        ],
      })
    })

    it('prefers explicit rich content over plain text', async () => {
      mock.onPost(`${ BASE }/blog/v3/draft-posts`).reply({ draftPost: { id: 'd-3' } })

      await service.createDraftBlogPost('Launch Recap', 'ignored', { nodes: [] })

      expect(mock.history[0].body.draftPost.richContent).toEqual({ nodes: [] })
    })

    it('includes the optional fields and the publish flag', async () => {
      mock.onPost(`${ BASE }/blog/v3/draft-posts`).reply({ draftPost: { id: 'd-4' } })

      await service.createDraftBlogPost(
        'Launch Recap',
        undefined,
        undefined,
        'member-1',
        'A short excerpt',
        ['cat-1'],
        ['launch'],
        true
      )

      expect(mock.history[0].body.draftPost).toEqual({
        title: 'Launch Recap',
        memberId: 'member-1',
        excerpt: 'A short excerpt',
        categoryIds: ['cat-1'],
        hashtags: ['launch'],
      })

      expect(mock.history[0].query).toEqual({ publish: true })
    })

    it('omits empty category and hashtag arrays', async () => {
      mock.onPost(`${ BASE }/blog/v3/draft-posts`).reply({ draftPost: { id: 'd-5' } })

      await service.createDraftBlogPost('Launch Recap', undefined, undefined, undefined, undefined, [], [], false)

      expect(mock.history[0].body.draftPost).toEqual({ title: 'Launch Recap' })
      expect(mock.history[0].query).toEqual({})
    })
  })

  describe('listBlogCategories', () => {
    it('sends paging query params', async () => {
      mock.onGet(`${ BASE }/blog/v3/categories`).reply({ categories: [] })

      const result = await service.listBlogCategories(10, 20)

      expect(result).toEqual({ categories: [] })
      expect(mock.history[0].query).toEqual({ 'paging.limit': 10, 'paging.offset': 20 })
    })
  })

  // ── Coupons ──

  describe('queryCoupons', () => {
    it('sends an empty query when no arguments are given', async () => {
      mock.onPost(`${ BASE }/stores/v2/coupons/query`).reply({ coupons: [] })

      const result = await service.queryCoupons()

      expect(result).toEqual({ coupons: [] })
      expect(mock.history[0].body).toEqual({ query: {} })
    })

    it('stringifies the filter and includes paging', async () => {
      mock.onPost(`${ BASE }/stores/v2/coupons/query`).reply({ coupons: [] })

      await service.queryCoupons({ 'specification.code': 'SUMMER20' }, 10, 5)

      expect(mock.history[0].body).toEqual({
        query: {
          filter: '{"specification.code":"SUMMER20"}',
          paging: { limit: 10, offset: 5 },
        },
      })
    })

    it('accepts an already stringified filter', async () => {
      mock.onPost(`${ BASE }/stores/v2/coupons/query`).reply({ coupons: [] })

      await service.queryCoupons('{"specification.active":true}')

      expect(mock.history[0].body.query.filter).toBe('{"specification.active":true}')
    })
  })

  describe('createCoupon', () => {
    it('creates a percent off coupon with sensible defaults', async () => {
      mock.onPost(`${ BASE }/stores/v2/coupons`).reply({ id: 'coupon-1' })

      const result = await service.createCoupon('Summer Sale', 'SUMMER20', 'Percent Off', 20)

      expect(result).toEqual({ id: 'coupon-1' })

      const { specification } = mock.history[0].body

      expect(specification).toMatchObject({
        name: 'Summer Sale',
        code: 'SUMMER20',
        active: true,
        percentOffRate: 20,
        scope: { namespace: 'stores' },
      })

      expect(typeof specification.startTime).toBe('string')
      expect(specification).not.toHaveProperty('expirationTime')
      expect(specification).not.toHaveProperty('usageLimit')
    })

    it('creates a fixed amount off coupon with explicit times, usage limit and scope', async () => {
      mock.onPost(`${ BASE }/stores/v2/coupons`).reply({ id: 'coupon-2' })

      await service.createCoupon(
        'Ten Off',
        'TEN',
        'Fixed Amount Off',
        10,
        '2026-06-01T00:00:00Z',
        '2026-08-31T23:59:59Z',
        100,
        { namespace: 'stores', group: { name: 'product', entityId: 'p-1' } }
      )

      expect(mock.history[0].body.specification).toEqual({
        name: 'Ten Off',
        code: 'TEN',
        active: true,
        startTime: '2026-06-01T00:00:00Z',
        expirationTime: '2026-08-31T23:59:59Z',
        usageLimit: 100,
        moneyOffAmount: 10,
        scope: { namespace: 'stores', group: { name: 'product', entityId: 'p-1' } },
      })
    })

    it('creates a free shipping coupon', async () => {
      mock.onPost(`${ BASE }/stores/v2/coupons`).reply({ id: 'coupon-3' })

      await service.createCoupon('Free Ship', 'SHIPFREE', 'Free Shipping')

      expect(mock.history[0].body.specification.freeShipping).toBe(true)
      expect(mock.history[0].body.specification).not.toHaveProperty('moneyOffAmount')
    })

    it('passes an unmapped discount type through as a raw field name', async () => {
      mock.onPost(`${ BASE }/stores/v2/coupons`).reply({ id: 'coupon-4' })

      await service.createCoupon('Raw', 'RAW', 'percentOffRate', 15)

      expect(mock.history[0].body.specification.percentOffRate).toBe(15)
    })
  })

  describe('getCoupon', () => {
    it('requests a coupon by id', async () => {
      mock.onGet(`${ BASE }/stores/v2/coupons/coupon-1`).reply({ id: 'coupon-1' })

      const result = await service.getCoupon('coupon-1')

      expect(result).toEqual({ id: 'coupon-1' })
    })
  })

  describe('deleteCoupon', () => {
    it('deletes a coupon and returns a confirmation', async () => {
      mock.onDelete(`${ BASE }/stores/v2/coupons/coupon-1`).reply({})

      const result = await service.deleteCoupon('coupon-1')

      expect(result).toEqual({ deleted: true, couponId: 'coupon-1' })
    })
  })

  // ── Members ──

  describe('listMembers', () => {
    it('maps the fieldset label and sends paging params', async () => {
      mock.onGet(`${ BASE }/members/v1/members`).reply({ members: [] })

      const result = await service.listMembers('Full', 10, 20)

      expect(result).toEqual({ members: [] })

      expect(mock.history[0].query).toEqual({
        fieldsets: 'FULL',
        'paging.limit': 10,
        'paging.offset': 20,
      })
    })

    it('sends no fieldset when it is omitted', async () => {
      mock.onGet(`${ BASE }/members/v1/members`).reply({ members: [] })

      await service.listMembers()

      expect(mock.history[0].query).toEqual({})
    })
  })

  describe('getMember', () => {
    it('requests a member with a mapped fieldset', async () => {
      mock.onGet(`${ BASE }/members/v1/members/m-1`).reply({ member: { id: 'm-1' } })

      const result = await service.getMember('m-1', 'Extended')

      expect(result).toEqual({ member: { id: 'm-1' } })
      expect(mock.history[0].query).toEqual({ fieldsets: 'EXTENDED' })
    })

    it('maps the public fieldset', async () => {
      mock.onGet(`${ BASE }/members/v1/members/m-1`).reply({ member: { id: 'm-1' } })

      await service.getMember('m-1', 'Public')

      expect(mock.history[0].query).toEqual({ fieldsets: 'PUBLIC' })
    })
  })

  // ── Site ──

  describe('getSiteProperties', () => {
    it('requests the site properties', async () => {
      mock.onGet(`${ BASE }/site-properties/v4/properties`).reply({ properties: { siteDisplayName: 'Acme' } })

      const result = await service.getSiteProperties()

      expect(result).toEqual({ properties: { siteDisplayName: 'Acme' } })
    })
  })

  // ── Dictionaries ──

  describe('getDataCollectionsDictionary', () => {
    it('maps collections to dictionary items', async () => {
      mock.onGet(`${ BASE }/wix-data/v2/collections`).reply({
        collections: [
          { id: 'MyCollection', displayName: 'My Collection', collectionType: 'NATIVE' },
          { id: 'Bare' },
        ],
      })

      const result = await service.getDataCollectionsDictionary({})

      expect(result).toEqual({
        items: [
          { label: 'My Collection', value: 'MyCollection', note: 'NATIVE' },
          { label: 'Bare', value: 'Bare', note: undefined },
        ],
        cursor: null,
      })

      expect(mock.history[0].query).toEqual({ 'paging.limit': 100, 'paging.offset': 0 })
    })

    it('handles a null payload', async () => {
      mock.onGet(`${ BASE }/wix-data/v2/collections`).reply({ collections: [{ id: 'A' }] })

      const result = await service.getDataCollectionsDictionary(null)

      expect(result.items).toHaveLength(1)
    })

    it('filters by search across display name and id', async () => {
      mock.onGet(`${ BASE }/wix-data/v2/collections`).reply({
        collections: [
          { id: 'Products', displayName: 'Catalog' },
          { id: 'Orders', displayName: 'Sales' },
        ],
      })

      const result = await service.getDataCollectionsDictionary({ search: 'order' })

      expect(result.items).toEqual([{ label: 'Sales', value: 'Orders', note: undefined }])
    })

    it('uses the cursor as an offset and returns the next cursor when a full page comes back', async () => {
      const collections = Array.from({ length: 100 }, (unused, index) => ({ id: `c-${ index }` }))

      mock.onGet(`${ BASE }/wix-data/v2/collections`).reply({ collections })

      const result = await service.getDataCollectionsDictionary({ cursor: '100' })

      expect(mock.history[0].query).toEqual({ 'paging.limit': 100, 'paging.offset': 100 })
      expect(result.cursor).toBe('200')
    })

    it('handles a response without collections', async () => {
      mock.onGet(`${ BASE }/wix-data/v2/collections`).reply({})

      const result = await service.getDataCollectionsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getProductsDictionary', () => {
    it('maps products with sku and price notes', async () => {
      mock.onPost(`${ BASE }/stores-reader/v1/products/query`).reply({
        products: [
          { id: 'p-1', name: 'Classic T-Shirt', sku: 'TSHIRT-001', priceData: { price: 25, currency: 'USD' } },
          { id: 'p-2', name: 'No Extras' },
        ],
      })

      const result = await service.getProductsDictionary({})

      expect(result).toEqual({
        items: [
          { label: 'Classic T-Shirt', value: 'p-1', note: 'TSHIRT-001 - 25 USD' },
          { label: 'No Extras', value: 'p-2', note: undefined },
        ],
        cursor: null,
      })

      expect(mock.history[0].body).toEqual({ query: { paging: { limit: 50, offset: 0 } } })
    })

    it('handles a null payload', async () => {
      mock.onPost(`${ BASE }/stores-reader/v1/products/query`).reply({ products: [] })

      const result = await service.getProductsDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('sends a name filter for the search term and honours the cursor', async () => {
      mock.onPost(`${ BASE }/stores-reader/v1/products/query`).reply({ products: [] })

      await service.getProductsDictionary({ search: 'shirt', cursor: '50' })

      expect(mock.history[0].body).toEqual({
        query: {
          paging: { limit: 50, offset: 50 },
          filter: '{"name":{"$contains":"shirt"}}',
        },
      })
    })

    it('returns the next cursor when a full page comes back', async () => {
      const products = Array.from({ length: 50 }, (unused, index) => ({ id: `p-${ index }`, name: `P${ index }` }))

      mock.onPost(`${ BASE }/stores-reader/v1/products/query`).reply({ products })

      const result = await service.getProductsDictionary({})

      expect(result.cursor).toBe('50')
    })

    it('handles a response without products', async () => {
      mock.onPost(`${ BASE }/stores-reader/v1/products/query`).reply({})

      const result = await service.getProductsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getContactLabelsDictionary', () => {
    it('maps labels to dictionary items', async () => {
      mock.onGet(`${ BASE }/contacts/v4/labels`).reply({
        labels: [
          { key: 'custom.vip', displayName: 'VIP', labelType: 'USER_DEFINED' },
          { key: 'contacts.customers' },
        ],
      })

      const result = await service.getContactLabelsDictionary({})

      expect(result).toEqual({
        items: [
          { label: 'VIP', value: 'custom.vip', note: 'USER_DEFINED' },
          { label: 'contacts.customers', value: 'contacts.customers', note: undefined },
        ],
        cursor: null,
      })
    })

    it('handles a null payload', async () => {
      mock.onGet(`${ BASE }/contacts/v4/labels`).reply({ labels: [{ key: 'a' }] })

      const result = await service.getContactLabelsDictionary(null)

      expect(result.items).toHaveLength(1)
    })

    it('filters by search across display name and key', async () => {
      mock.onGet(`${ BASE }/contacts/v4/labels`).reply({
        labels: [
          { key: 'custom.vip', displayName: 'VIP' },
          { key: 'contacts.customers', displayName: 'Customers' },
        ],
      })

      const result = await service.getContactLabelsDictionary({ search: 'vip' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('custom.vip')
    })

    it('uses the cursor as an offset and returns the next cursor when a full page comes back', async () => {
      const labels = Array.from({ length: 100 }, (unused, index) => ({ key: `k-${ index }` }))

      mock.onGet(`${ BASE }/contacts/v4/labels`).reply({ labels })

      const result = await service.getContactLabelsDictionary({ cursor: '100' })

      expect(mock.history[0].query).toEqual({ 'paging.limit': 100, 'paging.offset': 100 })
      expect(result.cursor).toBe('200')
    })

    it('handles a response without labels', async () => {
      mock.onGet(`${ BASE }/contacts/v4/labels`).reply({})

      const result = await service.getContactLabelsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })
  })
})
