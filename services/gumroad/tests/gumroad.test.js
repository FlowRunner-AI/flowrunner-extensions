'use strict'

const { createSandbox } = require('../../../service-sandbox')

const ACCESS_TOKEN = 'test-access-token-123'
const BASE = 'https://api.gumroad.com/v2'

describe('Gumroad Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ accessToken: ACCESS_TOKEN })
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
          name: 'accessToken',
          displayName: 'Access Token',
          required: true,
          shared: false,
          type: 'STRING',
        }),
      ])
    })

    it('sends the Authorization Bearer header on requests', async () => {
      mock.onGet(`${ BASE }/user`).reply({ success: true, user: { user_id: 'u1' } })

      await service.getCurrentUser()

      expect(mock.history[0].headers).toMatchObject({
        'Authorization': `Bearer ${ ACCESS_TOKEN }`,
        'Content-Type': 'application/json',
      })
    })

    it('does not send the token as a query or body param', async () => {
      mock.onGet(`${ BASE }/user`).reply({ success: true, user: {} })

      await service.getCurrentUser()

      expect(mock.history[0].query).toEqual({})
      expect(mock.history[0].body).toBeUndefined()
    })
  })

  // ── success:false handling (shared behavior via getCurrentUser) ──

  describe('Gumroad success:false handling', () => {
    it('throws with the API message when success is false', async () => {
      mock.onGet(`${ BASE }/user`).reply({ success: false, message: 'Invalid access token' })

      await expect(service.getCurrentUser()).rejects.toThrow('Gumroad API error: Invalid access token')
    })

    it('throws a generic message when success is false without a message', async () => {
      mock.onGet(`${ BASE }/user`).reply({ success: false })

      await expect(service.getCurrentUser()).rejects.toThrow(
        'Gumroad API error: Request was not successful'
      )
    })

    it('wraps HTTP errors with status and body message', async () => {
      mock.onGet(`${ BASE }/user`).replyWithError({
        message: 'Unauthorized',
        status: 401,
        body: { success: false, message: 'The access token is invalid.' },
      })

      await expect(service.getCurrentUser()).rejects.toThrow(
        'Gumroad API error (401): The access token is invalid.'
      )
    })

    it('wraps HTTP errors without a status', async () => {
      mock.onGet(`${ BASE }/user`).replyWithError({ message: 'Network down' })

      await expect(service.getCurrentUser()).rejects.toThrow('Gumroad API error: Network down')
    })
  })

  // ── User ──

  describe('getCurrentUser', () => {
    it('sends a GET to /user and returns the response', async () => {
      const response = { success: true, user: { user_id: 'u1', email: 'a@b.com' } }
      mock.onGet(`${ BASE }/user`).reply(response)

      const result = await service.getCurrentUser()

      expect(result).toEqual(response)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/user`)
    })
  })

  // ── Products ──

  describe('listProducts', () => {
    it('sends a GET to /products', async () => {
      const response = { success: true, products: [{ id: 'p1', name: 'Pencil' }] }
      mock.onGet(`${ BASE }/products`).reply(response)

      const result = await service.listProducts()

      expect(result).toEqual(response)
      expect(mock.history[0].url).toBe(`${ BASE }/products`)
      expect(mock.history[0].method).toBe('get')
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/products`).replyWithError({ message: 'Boom' })

      await expect(service.listProducts()).rejects.toThrow('Gumroad API error: Boom')
    })
  })

  describe('getProduct', () => {
    it('fetches a product by id with url encoding', async () => {
      mock.onGet(`${ BASE }/products/A-yG7uSPnfyChzBDR9zaXQ%3D%3D`).reply({
        success: true,
        product: { id: 'A-yG7uSPnfyChzBDR9zaXQ==' },
      })

      const result = await service.getProduct('A-yG7uSPnfyChzBDR9zaXQ==')

      expect(result).toEqual({ success: true, product: { id: 'A-yG7uSPnfyChzBDR9zaXQ==' } })
      expect(mock.history[0].url).toBe(`${ BASE }/products/A-yG7uSPnfyChzBDR9zaXQ%3D%3D`)
      expect(mock.history[0].method).toBe('get')
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/products/p1`).replyWithError({ message: 'Not found', status: 404 })

      await expect(service.getProduct('p1')).rejects.toThrow('Gumroad API error (404): Not found')
    })
  })

  describe('deleteProduct', () => {
    it('sends a DELETE to /products/{id}', async () => {
      mock.onDelete(`${ BASE }/products/p1`).reply({ success: true, message: 'deleted' })

      const result = await service.deleteProduct('p1')

      expect(result).toEqual({ success: true, message: 'deleted' })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${ BASE }/products/p1`)
    })

    it('throws on API error', async () => {
      mock.onDelete(`${ BASE }/products/p1`).replyWithError({ message: 'Boom' })

      await expect(service.deleteProduct('p1')).rejects.toThrow('Gumroad API error: Boom')
    })
  })

  describe('setProductPublishState', () => {
    it('maps Enable to the enable route (PUT)', async () => {
      mock.onPut(`${ BASE }/products/p1/enable`).reply({ success: true, product: { published: true } })

      const result = await service.setProductPublishState('p1', 'Enable')

      expect(result).toEqual({ success: true, product: { published: true } })
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].url).toBe(`${ BASE }/products/p1/enable`)
    })

    it('maps Disable to the disable route (PUT)', async () => {
      mock.onPut(`${ BASE }/products/p1/disable`).reply({ success: true, product: { published: false } })

      await service.setProductPublishState('p1', 'Disable')

      expect(mock.history[0].url).toBe(`${ BASE }/products/p1/disable`)
    })

    it('does not send a body', async () => {
      mock.onPut(`${ BASE }/products/p1/enable`).reply({ success: true })

      await service.setProductPublishState('p1', 'Enable')

      expect(mock.history[0].body).toBeUndefined()
    })

    it('throws on API error', async () => {
      mock.onPut(`${ BASE }/products/p1/enable`).replyWithError({ message: 'Boom' })

      await expect(service.setProductPublishState('p1', 'Enable')).rejects.toThrow('Gumroad API error: Boom')
    })
  })

  // ── Sales ──

  describe('listSales', () => {
    it('sends a GET to /sales with no query when no filters provided', async () => {
      mock.onGet(`${ BASE }/sales`).reply({ success: true, sales: [] })

      const result = await service.listSales()

      expect(result).toEqual({ success: true, sales: [] })
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].query).toEqual({})
    })

    it('includes all filters mapped to snake_case query params', async () => {
      mock.onGet(`${ BASE }/sales`).reply({ success: true, sales: [] })

      await service.listSales('2023-01-01', '2023-02-01', 'p1', 'buyer@example.com', 'key-123')

      expect(mock.history[0].query).toEqual({
        after: '2023-01-01',
        before: '2023-02-01',
        product_id: 'p1',
        email: 'buyer@example.com',
        page_key: 'key-123',
      })
    })

    it('omits empty filters from the query', async () => {
      mock.onGet(`${ BASE }/sales`).reply({ success: true, sales: [] })

      await service.listSales(undefined, undefined, 'p1')

      expect(mock.history[0].query).toEqual({ product_id: 'p1' })
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/sales`).replyWithError({ message: 'Boom' })

      await expect(service.listSales()).rejects.toThrow('Gumroad API error: Boom')
    })
  })

  describe('getSale', () => {
    it('fetches a sale by id', async () => {
      mock.onGet(`${ BASE }/sales/s1`).reply({ success: true, sale: { id: 's1' } })

      const result = await service.getSale('s1')

      expect(result).toEqual({ success: true, sale: { id: 's1' } })
      expect(mock.history[0].url).toBe(`${ BASE }/sales/s1`)
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/sales/s1`).replyWithError({ message: 'Boom' })

      await expect(service.getSale('s1')).rejects.toThrow('Gumroad API error: Boom')
    })
  })

  // ── Subscribers ──

  describe('listSubscribers', () => {
    it('sends a GET to /products/{id}/subscribers with no email query', async () => {
      mock.onGet(`${ BASE }/products/p1/subscribers`).reply({ success: true, subscribers: [] })

      const result = await service.listSubscribers('p1')

      expect(result).toEqual({ success: true, subscribers: [] })
      expect(mock.history[0].url).toBe(`${ BASE }/products/p1/subscribers`)
      expect(mock.history[0].query).toEqual({})
    })

    it('includes email in the query when provided', async () => {
      mock.onGet(`${ BASE }/products/p1/subscribers`).reply({ success: true, subscribers: [] })

      await service.listSubscribers('p1', 'sub@example.com')

      expect(mock.history[0].query).toEqual({ email: 'sub@example.com' })
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/products/p1/subscribers`).replyWithError({ message: 'Boom' })

      await expect(service.listSubscribers('p1')).rejects.toThrow('Gumroad API error: Boom')
    })
  })

  describe('getSubscriber', () => {
    it('fetches a subscriber by id', async () => {
      mock.onGet(`${ BASE }/subscribers/sub1`).reply({ success: true, subscriber: { id: 'sub1' } })

      const result = await service.getSubscriber('sub1')

      expect(result).toEqual({ success: true, subscriber: { id: 'sub1' } })
      expect(mock.history[0].url).toBe(`${ BASE }/subscribers/sub1`)
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/subscribers/sub1`).replyWithError({ message: 'Boom' })

      await expect(service.getSubscriber('sub1')).rejects.toThrow('Gumroad API error: Boom')
    })
  })

  // ── Licenses ──

  describe('verifyLicense', () => {
    it('posts to /licenses/verify with increment defaulting to true', async () => {
      mock.onPost(`${ BASE }/licenses/verify`).reply({ success: true, uses: 1 })

      const result = await service.verifyLicense('p1', 'LICENSE-KEY')

      expect(result).toEqual({ success: true, uses: 1 })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/licenses/verify`)
      expect(mock.history[0].body).toEqual({
        product_id: 'p1',
        license_key: 'LICENSE-KEY',
        increment_uses_count: true,
      })
    })

    it('respects an explicit increment_uses_count of false', async () => {
      mock.onPost(`${ BASE }/licenses/verify`).reply({ success: true, uses: 1 })

      await service.verifyLicense('p1', 'LICENSE-KEY', false)

      expect(mock.history[0].body).toEqual({
        product_id: 'p1',
        license_key: 'LICENSE-KEY',
        increment_uses_count: false,
      })
    })

    it('passes increment_uses_count true when explicitly true', async () => {
      mock.onPost(`${ BASE }/licenses/verify`).reply({ success: true, uses: 2 })

      await service.verifyLicense('p1', 'LICENSE-KEY', true)

      expect(mock.history[0].body).toMatchObject({ increment_uses_count: true })
    })

    it('throws on API error', async () => {
      mock.onPost(`${ BASE }/licenses/verify`).replyWithError({ message: 'Invalid license', status: 404 })

      await expect(service.verifyLicense('p1', 'bad')).rejects.toThrow(
        'Gumroad API error (404): Invalid license'
      )
    })

    it('throws when the API reports success:false', async () => {
      mock.onPost(`${ BASE }/licenses/verify`).reply({ success: false, message: 'That license does not exist for the provided product.' })

      await expect(service.verifyLicense('p1', 'bad')).rejects.toThrow(
        'Gumroad API error: That license does not exist for the provided product.'
      )
    })
  })

  describe('setLicenseState', () => {
    it('maps Enable to PUT /licenses/enable with the body', async () => {
      mock.onPut(`${ BASE }/licenses/enable`).reply({ success: true })

      const result = await service.setLicenseState('p1', 'LICENSE-KEY', 'Enable')

      expect(result).toEqual({ success: true })
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].url).toBe(`${ BASE }/licenses/enable`)
      expect(mock.history[0].body).toEqual({ product_id: 'p1', license_key: 'LICENSE-KEY' })
    })

    it('maps Disable to PUT /licenses/disable', async () => {
      mock.onPut(`${ BASE }/licenses/disable`).reply({ success: true })

      await service.setLicenseState('p1', 'LICENSE-KEY', 'Disable')

      expect(mock.history[0].url).toBe(`${ BASE }/licenses/disable`)
    })

    it('throws on API error', async () => {
      mock.onPut(`${ BASE }/licenses/enable`).replyWithError({ message: 'Boom' })

      await expect(service.setLicenseState('p1', 'k', 'Enable')).rejects.toThrow('Gumroad API error: Boom')
    })
  })

  // ── Offer Codes ──

  describe('listOfferCodes', () => {
    it('sends a GET to /products/{id}/offer_codes', async () => {
      mock.onGet(`${ BASE }/products/p1/offer_codes`).reply({ success: true, offer_codes: [] })

      const result = await service.listOfferCodes('p1')

      expect(result).toEqual({ success: true, offer_codes: [] })
      expect(mock.history[0].url).toBe(`${ BASE }/products/p1/offer_codes`)
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/products/p1/offer_codes`).replyWithError({ message: 'Boom' })

      await expect(service.listOfferCodes('p1')).rejects.toThrow('Gumroad API error: Boom')
    })
  })

  describe('getOfferCode', () => {
    it('sends a GET to /products/{id}/offer_codes/{offerId}', async () => {
      mock.onGet(`${ BASE }/products/p1/offer_codes/oc1`).reply({ success: true, offer_code: { id: 'oc1' } })

      const result = await service.getOfferCode('p1', 'oc1')

      expect(result).toEqual({ success: true, offer_code: { id: 'oc1' } })
      expect(mock.history[0].url).toBe(`${ BASE }/products/p1/offer_codes/oc1`)
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/products/p1/offer_codes/oc1`).replyWithError({ message: 'Boom' })

      await expect(service.getOfferCode('p1', 'oc1')).rejects.toThrow('Gumroad API error: Boom')
    })
  })

  describe('createOfferCode', () => {
    it('posts with defaults (offer_type cents) when only required params provided', async () => {
      mock.onPost(`${ BASE }/products/p1/offer_codes`).reply({ success: true, offer_code: { id: 'oc1' } })

      const result = await service.createOfferCode('p1', 'LAUNCH20', 200)

      expect(result).toEqual({ success: true, offer_code: { id: 'oc1' } })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/products/p1/offer_codes`)
      expect(mock.history[0].body).toEqual({
        name: 'LAUNCH20',
        amount_off: 200,
        offer_type: 'cents',
      })
    })

    it('maps Fixed Amount to cents', async () => {
      mock.onPost(`${ BASE }/products/p1/offer_codes`).reply({ success: true, offer_code: {} })

      await service.createOfferCode('p1', 'CODE', 500, 'Fixed Amount')

      expect(mock.history[0].body).toMatchObject({ offer_type: 'cents' })
    })

    it('maps Percentage to percent and includes max purchase count', async () => {
      mock.onPost(`${ BASE }/products/p1/offer_codes`).reply({ success: true, offer_code: {} })

      await service.createOfferCode('p1', 'HALF', 50, 'Percentage', 10)

      expect(mock.history[0].body).toEqual({
        name: 'HALF',
        amount_off: 50,
        offer_type: 'percent',
        max_purchase_count: 10,
      })
    })

    it('throws on API error', async () => {
      mock.onPost(`${ BASE }/products/p1/offer_codes`).replyWithError({ message: 'Boom' })

      await expect(service.createOfferCode('p1', 'CODE', 100)).rejects.toThrow('Gumroad API error: Boom')
    })
  })

  describe('updateOfferCode', () => {
    it('sends a PUT with the new max purchase count', async () => {
      mock.onPut(`${ BASE }/products/p1/offer_codes/oc1`).reply({ success: true, offer_code: {} })

      const result = await service.updateOfferCode('p1', 'oc1', 50)

      expect(result).toEqual({ success: true, offer_code: {} })
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].url).toBe(`${ BASE }/products/p1/offer_codes/oc1`)
      expect(mock.history[0].body).toEqual({ max_purchase_count: 50 })
    })

    it('throws on API error', async () => {
      mock.onPut(`${ BASE }/products/p1/offer_codes/oc1`).replyWithError({ message: 'Boom' })

      await expect(service.updateOfferCode('p1', 'oc1', 5)).rejects.toThrow('Gumroad API error: Boom')
    })
  })

  describe('deleteOfferCode', () => {
    it('sends a DELETE to the offer code endpoint', async () => {
      mock.onDelete(`${ BASE }/products/p1/offer_codes/oc1`).reply({ success: true, message: 'deleted' })

      const result = await service.deleteOfferCode('p1', 'oc1')

      expect(result).toEqual({ success: true, message: 'deleted' })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${ BASE }/products/p1/offer_codes/oc1`)
    })

    it('throws on API error', async () => {
      mock.onDelete(`${ BASE }/products/p1/offer_codes/oc1`).replyWithError({ message: 'Boom' })

      await expect(service.deleteOfferCode('p1', 'oc1')).rejects.toThrow('Gumroad API error: Boom')
    })
  })

  // ── Variants ──

  describe('listVariantCategories', () => {
    it('sends a GET to /products/{id}/variant_categories', async () => {
      mock.onGet(`${ BASE }/products/p1/variant_categories`).reply({
        success: true,
        variant_categories: [{ id: 'vc1', title: 'Color' }],
      })

      const result = await service.listVariantCategories('p1')

      expect(result).toEqual({ success: true, variant_categories: [{ id: 'vc1', title: 'Color' }] })
      expect(mock.history[0].url).toBe(`${ BASE }/products/p1/variant_categories`)
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/products/p1/variant_categories`).replyWithError({ message: 'Boom' })

      await expect(service.listVariantCategories('p1')).rejects.toThrow('Gumroad API error: Boom')
    })
  })

  // ── Resource Subscriptions ──

  describe('listResourceSubscriptions', () => {
    it('sends a GET with the mapped resource_name query', async () => {
      mock.onGet(`${ BASE }/resource_subscriptions`).reply({ success: true, resource_subscriptions: [] })

      const result = await service.listResourceSubscriptions('Sale')

      expect(result).toEqual({ success: true, resource_subscriptions: [] })
      expect(mock.history[0].url).toBe(`${ BASE }/resource_subscriptions`)
      expect(mock.history[0].query).toEqual({ resource_name: 'sale' })
    })

    it('maps multi-word resource types to snake_case', async () => {
      mock.onGet(`${ BASE }/resource_subscriptions`).reply({ success: true, resource_subscriptions: [] })

      await service.listResourceSubscriptions('Subscription Updated')

      expect(mock.history[0].query).toEqual({ resource_name: 'subscription_updated' })
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/resource_subscriptions`).replyWithError({ message: 'Boom' })

      await expect(service.listResourceSubscriptions('Sale')).rejects.toThrow('Gumroad API error: Boom')
    })
  })

  describe('createResourceSubscription', () => {
    it('sends a PUT with mapped resource_name and post_url', async () => {
      mock.onPut(`${ BASE }/resource_subscriptions`).reply({
        success: true,
        resource_subscription: { id: 'rs1' },
      })

      const result = await service.createResourceSubscription('Refund', 'https://example.com/hook')

      expect(result).toEqual({ success: true, resource_subscription: { id: 'rs1' } })
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].url).toBe(`${ BASE }/resource_subscriptions`)
      expect(mock.history[0].body).toEqual({
        resource_name: 'refund',
        post_url: 'https://example.com/hook',
      })
    })

    it('maps Dispute Won correctly', async () => {
      mock.onPut(`${ BASE }/resource_subscriptions`).reply({ success: true, resource_subscription: {} })

      await service.createResourceSubscription('Dispute Won', 'https://example.com/hook')

      expect(mock.history[0].body).toMatchObject({ resource_name: 'dispute_won' })
    })

    it('throws on API error', async () => {
      mock.onPut(`${ BASE }/resource_subscriptions`).replyWithError({ message: 'Boom' })

      await expect(
        service.createResourceSubscription('Sale', 'https://example.com/hook')
      ).rejects.toThrow('Gumroad API error: Boom')
    })
  })

  describe('deleteResourceSubscription', () => {
    it('sends a DELETE to /resource_subscriptions/{id}', async () => {
      mock.onDelete(`${ BASE }/resource_subscriptions/rs1`).reply({ success: true, message: 'deleted' })

      const result = await service.deleteResourceSubscription('rs1')

      expect(result).toEqual({ success: true, message: 'deleted' })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${ BASE }/resource_subscriptions/rs1`)
    })

    it('throws on API error', async () => {
      mock.onDelete(`${ BASE }/resource_subscriptions/rs1`).replyWithError({ message: 'Boom' })

      await expect(service.deleteResourceSubscription('rs1')).rejects.toThrow('Gumroad API error: Boom')
    })
  })

  // ── Dictionary ──

  describe('getProductsDictionary', () => {
    const productsResponse = {
      success: true,
      products: [
        { id: 'p1', name: 'Pencil', formatted_price: '$1', published: true },
        { id: 'p2', name: 'Notebook', formatted_price: '$5', published: false },
        { id: 'p3', name: 'Marker Pack', published: true },
      ],
    }

    it('maps all products to items when no search is provided', async () => {
      mock.onGet(`${ BASE }/products`).reply(productsResponse)

      const result = await service.getProductsDictionary({})

      expect(mock.history[0].url).toBe(`${ BASE }/products`)
      expect(result.cursor).toBeNull()
      expect(result.items).toEqual([
        { label: 'Pencil', value: 'p1', note: '$1 - published' },
        { label: 'Notebook', value: 'p2', note: '$5 - unpublished' },
        { label: 'Marker Pack', value: 'p3', note: 'published' },
      ])
    })

    it('filters products by case-insensitive name substring', async () => {
      mock.onGet(`${ BASE }/products`).reply(productsResponse)

      const result = await service.getProductsDictionary({ search: 'mark' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('p3')
    })

    it('handles a null payload as no search', async () => {
      mock.onGet(`${ BASE }/products`).reply(productsResponse)

      const result = await service.getProductsDictionary(null)

      expect(result.items).toHaveLength(3)
    })

    it('handles a response with no products array', async () => {
      mock.onGet(`${ BASE }/products`).reply({ success: true })

      const result = await service.getProductsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('falls back to the product id as label when name is missing', async () => {
      mock.onGet(`${ BASE }/products`).reply({
        success: true,
        products: [{ id: 'p9', published: true }],
      })

      const result = await service.getProductsDictionary({})

      expect(result.items[0]).toEqual({ label: 'p9', value: 'p9', note: 'published' })
    })

    it('propagates API errors (does not swallow them)', async () => {
      mock.onGet(`${ BASE }/products`).replyWithError({ message: 'Boom' })

      await expect(service.getProductsDictionary({})).rejects.toThrow('Gumroad API error: Boom')
    })
  })
})
