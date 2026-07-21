'use strict'

const { createSandbox } = require('../../../service-sandbox')

const CLIENT_ID = 'test-client-id'
const CLIENT_SECRET = 'test-client-secret'
const OAUTH_TOKEN = '12345678.test-token-value'
const API_BASE = 'https://api.etsy.com/v3/application'
const TOKEN_URL = 'https://api.etsy.com/v3/public/oauth/token'
const AUTHORIZE_URL = 'https://www.etsy.com/oauth/connect'

const SHOP_ID = 99887766
const LISTING_ID = '1234567890'

describe('Etsy Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET })
    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()

    service.request = { headers: { 'oauth-access-token': OAUTH_TOKEN } }
  })

  afterEach(() => {
    mock.reset()
    // Clear cached values between tests
    service.cachedShopId = undefined
    service.cachedTaxonomy = undefined
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Registration ──

  describe('service registration', () => {
    it('registers with correct config items', () => {
      expect(sandbox.getConfigItems()).toEqual([
        expect.objectContaining({
          name: 'clientId',
          required: true,
          shared: true,
          type: 'STRING',
        }),
        expect.objectContaining({
          name: 'clientSecret',
          required: true,
          shared: true,
          type: 'STRING',
        }),
      ])
    })
  })

  // ── OAuth Methods ──

  describe('getOAuth2ConnectionURL', () => {
    it('returns a valid authorization URL with PKCE params', async () => {
      const url = await service.getOAuth2ConnectionURL()

      expect(url).toContain(AUTHORIZE_URL)
      expect(url).toContain(`client_id=${CLIENT_ID}`)
      expect(url).toContain('response_type=code')
      expect(url).toContain('code_challenge_method=S256')
      expect(url).toContain('code_challenge=')
      expect(url).toContain('state=flowrunner_')
      expect(url).toContain('scope=')
    })
  })

  describe('executeCallback', () => {
    it('exchanges code for token and fetches shop identity', async () => {
      const callbackObject = {
        code: 'auth-code-123',
        redirectURI: 'https://app.flowrunner.com/callback',
      }

      mock.onPost(TOKEN_URL).reply({
        access_token: '55555.new-access-token',
        expires_in: 3600,
        refresh_token: 'new-refresh-token',
      })

      mock.onGet(`${API_BASE}/users/me`).reply({
        user_id: 55555,
        shop_id: 77777,
      })

      mock.onGet(`${API_BASE}/shops/77777`).reply({
        shop_name: 'TestShop',
        icon_url_fullxfull: 'https://example.com/icon.jpg',
      })

      const result = await service.executeCallback(callbackObject)

      expect(result).toMatchObject({
        token: '55555.new-access-token',
        expirationInSeconds: 3600,
        refreshToken: 'new-refresh-token',
        connectionIdentityName: 'TestShop',
        connectionIdentityImageURL: 'https://example.com/icon.jpg',
        overwrite: true,
      })
      expect(result.userData).toMatchObject({
        user_id: 55555,
        shop_id: 77777,
        shop_name: 'TestShop',
      })

      // Verify token exchange request
      const tokenCall = mock.history[0]

      expect(tokenCall.method).toBe('post')
      expect(tokenCall.url).toBe(TOKEN_URL)
      expect(tokenCall.headers).toMatchObject({
        'Content-Type': 'application/x-www-form-urlencoded',
        'x-api-key': CLIENT_ID,
      })
    })

    it('falls back to user identity when no shop exists', async () => {
      const callbackObject = {
        code: 'auth-code-456',
        redirectURI: 'https://app.flowrunner.com/callback',
      }

      mock.onPost(TOKEN_URL).reply({
        access_token: '55555.new-access-token',
        expires_in: 3600,
        refresh_token: 'new-refresh-token',
      })

      mock.onGet(`${API_BASE}/users/me`).reply({
        user_id: 55555,
        shop_id: null,
      })

      mock.onGet(`${API_BASE}/users/55555`).reply({
        first_name: 'John',
        last_name: 'Doe',
        primary_email: 'john@example.com',
        image_url_75x75: 'https://example.com/avatar.jpg',
      })

      const result = await service.executeCallback(callbackObject)

      expect(result.connectionIdentityName).toBe('John Doe')
      expect(result.connectionIdentityImageURL).toBe('https://example.com/avatar.jpg')
      expect(result.userData).toMatchObject({
        user_id: 55555,
        primary_email: 'john@example.com',
      })
    })

    it('throws on token exchange failure', async () => {
      mock.onPost(TOKEN_URL).replyWithError({
        message: 'invalid_grant',
        body: { error: 'invalid_grant', error_description: 'Code has expired' },
      })

      await expect(service.executeCallback({ code: 'bad', redirectURI: 'x' }))
        .rejects.toThrow('Etsy OAuth error: Code has expired')
    })
  })

  describe('refreshToken', () => {
    it('sends correct request and returns token data', async () => {
      mock.onPost(TOKEN_URL).reply({
        access_token: 'new-access-token',
        expires_in: 3600,
        refresh_token: 'new-refresh-token',
      })

      const result = await service.refreshToken('old-refresh-token')

      expect(result).toEqual({
        token: 'new-access-token',
        expirationInSeconds: 3600,
        refreshToken: 'new-refresh-token',
      })

      expect(mock.history[0].headers).toMatchObject({
        'Content-Type': 'application/x-www-form-urlencoded',
        'x-api-key': CLIENT_ID,
      })
    })

    it('keeps the old refresh token when Etsy does not return a new one', async () => {
      mock.onPost(TOKEN_URL).reply({
        access_token: 'new-access-token',
        expires_in: 3600,
      })

      const result = await service.refreshToken('old-refresh-token')

      expect(result.refreshToken).toBe('old-refresh-token')
    })

    it('throws specific message on invalid_grant', async () => {
      mock.onPost(TOKEN_URL).replyWithError({
        message: 'Unauthorized',
        body: { error: 'invalid_grant' },
      })

      await expect(service.refreshToken('expired-token'))
        .rejects.toThrow('Refresh token expired or invalid, please re-authenticate.')
    })

    it('throws generic message on other errors', async () => {
      mock.onPost(TOKEN_URL).replyWithError({
        message: 'Server error',
        body: { error: 'server_error', error_description: 'Internal failure' },
      })

      await expect(service.refreshToken('some-token'))
        .rejects.toThrow('Etsy OAuth error: Internal failure')
    })
  })

  // ── Users & Shops ──

  describe('getCurrentUser', () => {
    it('sends GET to /users/me with auth headers', async () => {
      mock.onGet(`${API_BASE}/users/me`).reply({ user_id: 12345678, shop_id: SHOP_ID })

      const result = await service.getCurrentUser()

      expect(result).toEqual({ user_id: 12345678, shop_id: SHOP_ID })
      expect(mock.history[0].headers).toMatchObject({
        'Authorization': `Bearer ${OAUTH_TOKEN}`,
        'x-api-key': CLIENT_ID,
      })
    })
  })

  describe('getShop', () => {
    it('retrieves a shop by explicit id', async () => {
      mock.onGet(`${API_BASE}/shops/${SHOP_ID}`).reply({ shop_id: SHOP_ID, shop_name: 'TestShop' })

      const result = await service.getShop(SHOP_ID)

      expect(result).toMatchObject({ shop_id: SHOP_ID, shop_name: 'TestShop' })
    })

    it('falls back to connected user shop when no id is provided', async () => {
      mock.onGet(`${API_BASE}/users/me`).reply({ user_id: 12345678, shop_id: SHOP_ID })
      mock.onGet(`${API_BASE}/shops/${SHOP_ID}`).reply({ shop_id: SHOP_ID, shop_name: 'MyShop' })

      const result = await service.getShop()

      expect(result).toMatchObject({ shop_id: SHOP_ID })
      expect(mock.history).toHaveLength(2)
    })

    it('throws when connected user has no shop and no id is provided', async () => {
      mock.onGet(`${API_BASE}/users/me`).reply({ user_id: 12345678 })

      await expect(service.getShop())
        .rejects.toThrow('does not have a shop')
    })
  })

  describe('updateShop', () => {
    it('sends PUT with form-encoded fields', async () => {
      mock.onGet(`${API_BASE}/users/me`).reply({ user_id: 1, shop_id: SHOP_ID })
      mock.onPut(`${API_BASE}/shops/${SHOP_ID}`).reply({ shop_id: SHOP_ID, title: 'New Title' })

      await service.updateShop('New Title', 'Welcome!', undefined, undefined)

      const putCall = mock.history.find(c => c.method === 'put')

      expect(putCall.headers['Content-Type']).toBe('application/x-www-form-urlencoded')
      expect(putCall.body).toContain('title=New+Title')
      expect(putCall.body).toContain('announcement=Welcome')
    })

    it('throws when no fields are provided', async () => {
      await expect(service.updateShop(undefined, undefined, undefined, undefined))
        .rejects.toThrow('Provide at least one')
    })

    it('accepts explicit shop id', async () => {
      mock.onPut(`${API_BASE}/shops/555`).reply({ shop_id: 555 })

      await service.updateShop('Title', undefined, undefined, undefined, 555)

      // Should not call /users/me
      expect(mock.history.find(c => c.url.includes('/users/me'))).toBeUndefined()
    })
  })

  // ── Listings ──

  describe('listShopListings', () => {
    it('sends correct query params with defaults', async () => {
      mock.onGet(`${API_BASE}/users/me`).reply({ user_id: 1, shop_id: SHOP_ID })
      mock.onGet(`${API_BASE}/shops/${SHOP_ID}/listings`).reply({ count: 0, results: [] })

      await service.listShopListings('Active', 25, 0, 'Created', 'Descending')

      const getCall = mock.history.find(c => c.url.includes('/listings'))

      expect(getCall.query).toMatchObject({
        state: 'active',
        limit: 25,
        offset: 0,
        sort_on: 'created',
        sort_order: 'desc',
      })
    })

    it('maps choice labels to API values', async () => {
      mock.onGet(`${API_BASE}/users/me`).reply({ user_id: 1, shop_id: SHOP_ID })
      mock.onGet(`${API_BASE}/shops/${SHOP_ID}/listings`).reply({ count: 0, results: [] })

      await service.listShopListings('Sold Out', 10, 5, 'Price', 'Ascending')

      const getCall = mock.history.find(c => c.url.includes('/listings'))

      expect(getCall.query).toMatchObject({
        state: 'sold_out',
        sort_on: 'price',
        sort_order: 'asc',
      })
    })
  })

  describe('getListing', () => {
    it('retrieves a listing by id', async () => {
      mock.onGet(`${API_BASE}/listings/${LISTING_ID}`).reply({
        listing_id: Number(LISTING_ID),
        title: 'Test Listing',
      })

      const result = await service.getListing(LISTING_ID)

      expect(result).toMatchObject({ listing_id: Number(LISTING_ID) })
    })

    it('passes includes as comma-separated query param', async () => {
      mock.onGet(`${API_BASE}/listings/${LISTING_ID}`).reply({ listing_id: Number(LISTING_ID) })

      await service.getListing(LISTING_ID, ['Images', 'Shop'])

      expect(mock.history[0].query).toMatchObject({ includes: 'Images,Shop' })
    })

    it('omits includes when not provided', async () => {
      mock.onGet(`${API_BASE}/listings/${LISTING_ID}`).reply({ listing_id: Number(LISTING_ID) })

      await service.getListing(LISTING_ID)

      expect(mock.history[0].query.includes).toBeUndefined()
    })

    it('throws when listing id is missing', async () => {
      await expect(service.getListing()).rejects.toThrow('"Listing" is required')
    })
  })

  describe('getListingsByIds', () => {
    it('sends listing ids as comma-separated query param', async () => {
      mock.onGet(`${API_BASE}/listings/batch`).reply({ count: 2, results: [] })

      await service.getListingsByIds(['111', '222'], ['Images'])

      expect(mock.history[0].query).toMatchObject({
        listing_ids: '111,222',
        includes: 'Images',
      })
    })

    it('throws when listing ids are empty', async () => {
      await expect(service.getListingsByIds([])).rejects.toThrow('"Listing IDs" is required')
    })

    it('throws when listing ids are not an array', async () => {
      await expect(service.getListingsByIds('123')).rejects.toThrow('"Listing IDs" is required')
    })
  })

  describe('createDraftListing', () => {
    it('sends POST with form-encoded body and required fields', async () => {
      mock.onGet(`${API_BASE}/users/me`).reply({ user_id: 1, shop_id: SHOP_ID })
      mock.onPost(`${API_BASE}/shops/${SHOP_ID}/listings`).reply({
        listing_id: 999,
        state: 'draft',
      })

      await service.createDraftListing(
        'Test Board', 'A fine board', 45.00, 10, '1633',
        'I Did', 'Made To Order', 'Physical',
        '12345', 67890, ['kitchen', 'wood'], ['oak'], ['Rustic'], false
      )

      const postCall = mock.history.find(c => c.method === 'post')

      expect(postCall.headers['Content-Type']).toBe('application/x-www-form-urlencoded')
      expect(postCall.body).toContain('title=Test+Board')
      expect(postCall.body).toContain('description=A+fine+board')
      expect(postCall.body).toContain('price=45')
      expect(postCall.body).toContain('quantity=10')
      expect(postCall.body).toContain('taxonomy_id=1633')
      expect(postCall.body).toContain('who_made=i_did')
      expect(postCall.body).toContain('when_made=made_to_order')
      expect(postCall.body).toContain('type=physical')
    })

    it('throws when required fields are missing', async () => {
      await expect(service.createDraftListing('Title', undefined, 10, 5, '1633'))
        .rejects.toThrow('"Title", "Description", "Price", "Quantity", and "Category" are required')
    })

    it('throws when more than 13 tags are provided', async () => {
      const tags = Array(14).fill('tag')

      await expect(service.createDraftListing('T', 'D', 10, 5, '1', 'I Did', 'Made To Order', 'Physical', null, null, tags))
        .rejects.toThrow('at most 13 tags')
    })

    it('throws when more than 2 styles are provided', async () => {
      await expect(
        service.createDraftListing('T', 'D', 10, 5, '1', 'I Did', 'Made To Order', 'Physical', null, null, [], [], ['a', 'b', 'c'])
      ).rejects.toThrow('at most 2 styles')
    })
  })

  describe('updateListing', () => {
    it('sends PATCH with form-encoded fields', async () => {
      mock.onGet(`${API_BASE}/users/me`).reply({ user_id: 1, shop_id: SHOP_ID })
      mock.onPatch(`${API_BASE}/shops/${SHOP_ID}/listings/${LISTING_ID}`).reply({
        listing_id: Number(LISTING_ID),
      })

      await service.updateListing(LISTING_ID, 'Updated Title')

      const patchCall = mock.history.find(c => c.method === 'patch')

      expect(patchCall.headers['Content-Type']).toBe('application/x-www-form-urlencoded')
      expect(patchCall.body).toContain('title=Updated+Title')
    })

    it('resolves tri-state choice values correctly', async () => {
      mock.onGet(`${API_BASE}/users/me`).reply({ user_id: 1, shop_id: SHOP_ID })
      mock.onPatch(`${API_BASE}/shops/${SHOP_ID}/listings/${LISTING_ID}`).reply({})

      await service.updateListing(
        LISTING_ID, undefined, undefined, undefined, undefined,
        'Active', undefined, undefined, undefined, undefined,
        'Yes', 'No'
      )

      const patchCall = mock.history.find(c => c.method === 'patch')

      expect(patchCall.body).toContain('state=active')
      expect(patchCall.body).toContain('is_personalizable=true')
      expect(patchCall.body).toContain('should_auto_renew=false')
    })

    it('throws when listing id is missing', async () => {
      await expect(service.updateListing()).rejects.toThrow('"Listing" is required')
    })

    it('throws when no update fields are provided', async () => {
      await expect(service.updateListing(LISTING_ID))
        .rejects.toThrow('Provide at least one field to update')
    })
  })

  describe('deleteListing', () => {
    it('sends DELETE and returns success on empty response', async () => {
      mock.onDelete(`${API_BASE}/listings/${LISTING_ID}`).reply({})

      const result = await service.deleteListing(LISTING_ID)

      expect(result).toEqual({ status: 'success' })
    })

    it('throws when listing id is missing', async () => {
      await expect(service.deleteListing()).rejects.toThrow('"Listing" is required')
    })
  })

  describe('getListingInventory', () => {
    it('sends GET to correct inventory URL', async () => {
      mock.onGet(`${API_BASE}/listings/${LISTING_ID}/inventory`).reply({
        products: [],
        price_on_property: [],
        quantity_on_property: [],
        sku_on_property: [],
      })

      const result = await service.getListingInventory(LISTING_ID)

      expect(result).toHaveProperty('products')
    })

    it('throws when listing id is missing', async () => {
      await expect(service.getListingInventory()).rejects.toThrow('"Listing" is required')
    })
  })

  describe('updateListingInventory', () => {
    const inventoryResponse = {
      products: [{
        product_id: 111,
        sku: 'SKU-A',
        is_deleted: false,
        offerings: [{
          offering_id: 222,
          price: { amount: 4500, divisor: 100, currency_code: 'USD' },
          quantity: 10,
          is_enabled: true,
          is_deleted: false,
        }],
        property_values: [],
      }],
      price_on_property: [513],
      quantity_on_property: [],
      sku_on_property: [],
    }

    it('updates price and quantity on all products', async () => {
      mock.onGet(`${API_BASE}/listings/${LISTING_ID}/inventory`).reply(inventoryResponse)
      mock.onPut(`${API_BASE}/listings/${LISTING_ID}/inventory`).reply({ products: [] })

      await service.updateListingInventory(LISTING_ID, 59.99, 25)

      const putCall = mock.history.find(c => c.method === 'put')
      const body = putCall.body

      expect(body.products[0].offerings[0].price).toBe(59.99)
      expect(body.products[0].offerings[0].quantity).toBe(25)
      expect(body.price_on_property).toEqual([513])
    })

    it('filters by SKU when provided', async () => {
      const multiProductInventory = {
        ...inventoryResponse,
        products: [
          ...inventoryResponse.products,
          {
            product_id: 333,
            sku: 'SKU-B',
            is_deleted: false,
            offerings: [{
              offering_id: 444,
              price: { amount: 3000, divisor: 100, currency_code: 'USD' },
              quantity: 5,
              is_enabled: true,
              is_deleted: false,
            }],
            property_values: [],
          },
        ],
      }

      mock.onGet(`${API_BASE}/listings/${LISTING_ID}/inventory`).reply(multiProductInventory)
      mock.onPut(`${API_BASE}/listings/${LISTING_ID}/inventory`).reply({ products: [] })

      await service.updateListingInventory(LISTING_ID, 99.00, null, 'SKU-A')

      const putCall = mock.history.find(c => c.method === 'put')

      expect(putCall.body.products[0].offerings[0].price).toBe(99.00)
      expect(putCall.body.products[1].offerings[0].price).toBe(30) // unchanged (converted from amount/divisor)
    })

    it('throws when SKU filter matches nothing', async () => {
      mock.onGet(`${API_BASE}/listings/${LISTING_ID}/inventory`).reply(inventoryResponse)

      await expect(service.updateListingInventory(LISTING_ID, 10, null, 'NONEXISTENT'))
        .rejects.toThrow('No product with SKU "NONEXISTENT"')
    })

    it('uses raw products when provided', async () => {
      mock.onGet(`${API_BASE}/listings/${LISTING_ID}/inventory`).reply(inventoryResponse)
      mock.onPut(`${API_BASE}/listings/${LISTING_ID}/inventory`).reply({ products: [] })

      const rawProducts = [{
        sku: 'CUSTOM',
        offerings: [{ price: 20, quantity: 3, is_enabled: true }],
        property_values: [],
      }]

      await service.updateListingInventory(LISTING_ID, null, null, null, rawProducts)

      const putCall = mock.history.find(c => c.method === 'put')

      expect(putCall.body.products[0].sku).toBe('CUSTOM')
    })

    it('throws when no price, quantity, or products are provided', async () => {
      mock.onGet(`${API_BASE}/listings/${LISTING_ID}/inventory`).reply(inventoryResponse)

      await expect(service.updateListingInventory(LISTING_ID))
        .rejects.toThrow('Provide "New Price", "New Quantity", or "Products"')
    })

    it('throws when listing id is missing', async () => {
      await expect(service.updateListingInventory()).rejects.toThrow('"Listing" is required')
    })
  })

  // ── Listing Images ──

  describe('listListingImages', () => {
    it('sends GET to correct URL', async () => {
      mock.onGet(`${API_BASE}/users/me`).reply({ user_id: 1, shop_id: SHOP_ID })
      mock.onGet(`${API_BASE}/shops/${SHOP_ID}/listings/${LISTING_ID}/images`).reply({
        count: 1,
        results: [{ listing_image_id: 555 }],
      })

      const result = await service.listListingImages(LISTING_ID)

      expect(result.count).toBe(1)
    })

    it('throws when listing id is missing', async () => {
      await expect(service.listListingImages()).rejects.toThrow('"Listing" is required')
    })
  })

  describe('uploadListingImage', () => {
    it('uploads image with multipart form data', async () => {
      const fileUrl = 'https://storage.example.com/image.jpg'

      mock.onGet(`${API_BASE}/users/me`).reply({ user_id: 1, shop_id: SHOP_ID })
      mock.onGet(fileUrl).reply(Buffer.from('fake-image-bytes'))
      mock.onPost(`${API_BASE}/shops/${SHOP_ID}/listings/${LISTING_ID}/images`).reply({
        listing_image_id: 999,
        rank: 1,
      })

      const result = await service.uploadListingImage(fileUrl, LISTING_ID, 1, false, 'Alt text')

      expect(result).toMatchObject({ listing_image_id: 999 })

      const postCall = mock.history.find(c => c.method === 'post')

      expect(postCall.formData).toBeDefined()
      expect(postCall.headers).toMatchObject({
        'Authorization': `Bearer ${OAUTH_TOKEN}`,
        'x-api-key': CLIENT_ID,
      })
    })

    it('throws when file URL is missing', async () => {
      await expect(service.uploadListingImage(null, LISTING_ID))
        .rejects.toThrow('"Image File" is required')
    })

    it('throws when listing id is missing', async () => {
      await expect(service.uploadListingImage('https://example.com/img.jpg'))
        .rejects.toThrow('"Listing" is required')
    })
  })

  describe('deleteListingImage', () => {
    it('sends DELETE to correct URL', async () => {
      mock.onGet(`${API_BASE}/users/me`).reply({ user_id: 1, shop_id: SHOP_ID })
      mock.onDelete(`${API_BASE}/shops/${SHOP_ID}/listings/${LISTING_ID}/images/555`).reply({})

      const result = await service.deleteListingImage(LISTING_ID, 555)

      expect(result).toEqual({ status: 'success' })
    })

    it('throws when listing id is missing', async () => {
      await expect(service.deleteListingImage(null, 555))
        .rejects.toThrow('"Listing" is required')
    })

    it('throws when image id is missing', async () => {
      await expect(service.deleteListingImage(LISTING_ID))
        .rejects.toThrow('"Listing Image ID" is required')
    })
  })

  // ── Receipts ──

  describe('listShopReceipts', () => {
    it('sends correct query params with filters', async () => {
      mock.onGet(`${API_BASE}/users/me`).reply({ user_id: 1, shop_id: SHOP_ID })
      mock.onGet(`${API_BASE}/shops/${SHOP_ID}/receipts`).reply({ count: 0, results: [] })

      await service.listShopReceipts(
        '2024-01-01T00:00:00Z', '2024-12-31T23:59:59Z',
        'Yes', 'No', 'Any',
        50, 10, 'Updated', 'Ascending'
      )

      const getCall = mock.history.find(c => c.url.includes('/receipts'))

      expect(getCall.query).toMatchObject({
        min_created: Math.floor(Date.parse('2024-01-01T00:00:00Z') / 1000),
        max_created: Math.floor(Date.parse('2024-12-31T23:59:59Z') / 1000),
        was_paid: true,
        was_shipped: false,
        limit: 50,
        offset: 10,
        sort_on: 'updated',
        sort_order: 'asc',
      })
    })

    it('omits tristate filters set to Any', async () => {
      mock.onGet(`${API_BASE}/users/me`).reply({ user_id: 1, shop_id: SHOP_ID })
      mock.onGet(`${API_BASE}/shops/${SHOP_ID}/receipts`).reply({ count: 0, results: [] })

      await service.listShopReceipts(undefined, undefined, 'Any', 'Any', 'Any')

      const getCall = mock.history.find(c => c.url.includes('/receipts'))

      // undefined values are cleaned up by cleanupObject
      expect(getCall.query.was_paid).toBeUndefined()
      expect(getCall.query.was_shipped).toBeUndefined()
      expect(getCall.query.was_delivered).toBeUndefined()
    })
  })

  describe('getReceipt', () => {
    it('retrieves a receipt by id', async () => {
      mock.onGet(`${API_BASE}/users/me`).reply({ user_id: 1, shop_id: SHOP_ID })
      mock.onGet(`${API_BASE}/shops/${SHOP_ID}/receipts/321`).reply({
        receipt_id: 321,
        status: 'Paid',
      })

      const result = await service.getReceipt(321)

      expect(result).toMatchObject({ receipt_id: 321 })
    })

    it('throws when receipt id is missing', async () => {
      await expect(service.getReceipt()).rejects.toThrow('"Receipt ID" is required')
    })
  })

  describe('updateReceipt', () => {
    it('sends PUT with form-encoded flags', async () => {
      mock.onGet(`${API_BASE}/users/me`).reply({ user_id: 1, shop_id: SHOP_ID })
      mock.onPut(`${API_BASE}/shops/${SHOP_ID}/receipts/321`).reply({ receipt_id: 321 })

      await service.updateReceipt(321, 'Yes', 'Leave Unchanged')

      const putCall = mock.history.find(c => c.method === 'put')

      expect(putCall.body).toContain('was_shipped=true')
      expect(putCall.body).not.toContain('was_paid')
    })

    it('throws when receipt id is missing', async () => {
      await expect(service.updateReceipt()).rejects.toThrow('"Receipt ID" is required')
    })

    it('throws when no flags are provided', async () => {
      await expect(service.updateReceipt(321, 'Leave Unchanged', 'Leave Unchanged'))
        .rejects.toThrow('Provide at least one')
    })
  })

  describe('createReceiptShipment', () => {
    it('sends POST with JSON body', async () => {
      mock.onGet(`${API_BASE}/users/me`).reply({ user_id: 1, shop_id: SHOP_ID })
      mock.onPost(`${API_BASE}/shops/${SHOP_ID}/receipts/321/tracking`).reply({
        receipt_id: 321,
        was_shipped: true,
      })

      await service.createReceiptShipment(321, '9400111', 'USPS', true, 'Your order shipped!')

      const postCall = mock.history.find(c => c.method === 'post')

      expect(postCall.body).toEqual({
        tracking_code: '9400111',
        carrier_name: 'USPS',
        send_bcc: true,
        note_to_buyer: 'Your order shipped!',
      })
    })

    it('sends without optional fields', async () => {
      mock.onGet(`${API_BASE}/users/me`).reply({ user_id: 1, shop_id: SHOP_ID })
      mock.onPost(`${API_BASE}/shops/${SHOP_ID}/receipts/321/tracking`).reply({})

      await service.createReceiptShipment(321)

      const postCall = mock.history.find(c => c.method === 'post')

      expect(postCall.body).toEqual({})
    })

    it('throws when receipt id is missing', async () => {
      await expect(service.createReceiptShipment()).rejects.toThrow('"Receipt ID" is required')
    })
  })

  describe('listReceiptTransactions', () => {
    it('sends GET to correct URL', async () => {
      mock.onGet(`${API_BASE}/users/me`).reply({ user_id: 1, shop_id: SHOP_ID })
      mock.onGet(`${API_BASE}/shops/${SHOP_ID}/receipts/321/transactions`).reply({
        count: 1,
        results: [],
      })

      const result = await service.listReceiptTransactions(321)

      expect(result.count).toBe(1)
    })

    it('throws when receipt id is missing', async () => {
      await expect(service.listReceiptTransactions()).rejects.toThrow('"Receipt ID" is required')
    })
  })

  // ── Reviews ──

  describe('listShopReviews', () => {
    it('sends correct query params with date filters', async () => {
      mock.onGet(`${API_BASE}/users/me`).reply({ user_id: 1, shop_id: SHOP_ID })
      mock.onGet(`${API_BASE}/shops/${SHOP_ID}/reviews`).reply({ count: 0, results: [] })

      await service.listShopReviews(10, 5, '2024-06-01T00:00:00Z', '2024-06-30T23:59:59Z')

      const getCall = mock.history.find(c => c.url.includes('/reviews'))

      expect(getCall.query).toMatchObject({
        limit: 10,
        offset: 5,
        min_created: Math.floor(Date.parse('2024-06-01T00:00:00Z') / 1000),
        max_created: Math.floor(Date.parse('2024-06-30T23:59:59Z') / 1000),
      })
    })
  })

  // ── Shop Sections ──

  describe('listShopSections', () => {
    it('sends GET to correct URL', async () => {
      mock.onGet(`${API_BASE}/users/me`).reply({ user_id: 1, shop_id: SHOP_ID })
      mock.onGet(`${API_BASE}/shops/${SHOP_ID}/sections`).reply({
        count: 2,
        results: [{ shop_section_id: 1 }, { shop_section_id: 2 }],
      })

      const result = await service.listShopSections()

      expect(result.count).toBe(2)
    })
  })

  describe('createShopSection', () => {
    it('sends POST with form-encoded title', async () => {
      mock.onGet(`${API_BASE}/users/me`).reply({ user_id: 1, shop_id: SHOP_ID })
      mock.onPost(`${API_BASE}/shops/${SHOP_ID}/sections`).reply({
        shop_section_id: 99,
        title: 'New Section',
      })

      const result = await service.createShopSection('New Section')

      const postCall = mock.history.find(c => c.method === 'post')

      expect(postCall.body).toContain('title=New+Section')
      expect(result).toMatchObject({ shop_section_id: 99 })
    })

    it('throws when title is missing', async () => {
      await expect(service.createShopSection()).rejects.toThrow('"Title" is required')
    })
  })

  // ── Shipping ──

  describe('listShippingProfiles', () => {
    it('sends GET to correct URL', async () => {
      mock.onGet(`${API_BASE}/users/me`).reply({ user_id: 1, shop_id: SHOP_ID })
      mock.onGet(`${API_BASE}/shops/${SHOP_ID}/shipping-profiles`).reply({
        count: 1,
        results: [{ shipping_profile_id: 111 }],
      })

      const result = await service.listShippingProfiles()

      expect(result.count).toBe(1)
    })
  })

  // ── Taxonomy ──

  describe('listTaxonomyNodes', () => {
    it('returns flattened taxonomy nodes', async () => {
      mock.onGet(`${API_BASE}/seller-taxonomy/nodes`).reply({
        results: [
          {
            id: 1,
            name: 'Home',
            level: 1,
            children: [
              { id: 2, name: 'Kitchen', level: 2, children: [] },
            ],
          },
        ],
      })

      const result = await service.listTaxonomyNodes()

      expect(result.count).toBe(2)
      expect(result.nodes[0]).toEqual({ id: 1, name: 'Home', level: 1, path: 'Home' })
      expect(result.nodes[1]).toEqual({ id: 2, name: 'Kitchen', level: 2, path: 'Home > Kitchen' })
    })
  })

  describe('getTaxonomyProperties', () => {
    it('sends GET to correct URL', async () => {
      mock.onGet(`${API_BASE}/seller-taxonomy/nodes/1633/properties`).reply({
        count: 1,
        results: [{ property_id: 513, name: 'size' }],
      })

      const result = await service.getTaxonomyProperties('1633')

      expect(result.results[0].property_id).toBe(513)
    })

    it('throws when taxonomy id is missing', async () => {
      await expect(service.getTaxonomyProperties()).rejects.toThrow('"Category" is required')
    })
  })

  // ── Payments ──

  describe('listPaymentLedgerEntries', () => {
    it('sends correct query params', async () => {
      mock.onGet(`${API_BASE}/users/me`).reply({ user_id: 1, shop_id: SHOP_ID })
      mock.onGet(`${API_BASE}/shops/${SHOP_ID}/payment-account/ledger-entries`).reply({
        count: 0,
        results: [],
      })

      await service.listPaymentLedgerEntries('2024-01-01T00:00:00Z', '2024-12-31T23:59:59Z', 50, 0)

      const getCall = mock.history.find(c => c.url.includes('/ledger-entries'))

      expect(getCall.query).toMatchObject({
        min_created: Math.floor(Date.parse('2024-01-01T00:00:00Z') / 1000),
        max_created: Math.floor(Date.parse('2024-12-31T23:59:59Z') / 1000),
        limit: 50,
        offset: 0,
      })
    })

    it('throws when date range is missing', async () => {
      await expect(service.listPaymentLedgerEntries())
        .rejects.toThrow('"Created After" and "Created Before" are required')
    })
  })

  // ── Dictionary Methods ──

  describe('getShippingProfilesDictionary', () => {
    it('returns formatted shipping profiles', async () => {
      mock.onGet(`${API_BASE}/users/me`).reply({ user_id: 1, shop_id: SHOP_ID })
      mock.onGet(`${API_BASE}/shops/${SHOP_ID}/shipping-profiles`).reply({
        results: [
          {
            shipping_profile_id: 111,
            title: 'Standard US',
            min_processing_days: 1,
            max_processing_days: 3,
          },
        ],
      })

      const result = await service.getShippingProfilesDictionary({})

      expect(result.items).toEqual([{
        label: 'Standard US',
        value: '111',
        note: 'Processing 1-3 days',
      }])
    })

    it('filters by search text', async () => {
      mock.onGet(`${API_BASE}/users/me`).reply({ user_id: 1, shop_id: SHOP_ID })
      mock.onGet(`${API_BASE}/shops/${SHOP_ID}/shipping-profiles`).reply({
        results: [
          { shipping_profile_id: 1, title: 'Standard US' },
          { shipping_profile_id: 2, title: 'Express International' },
        ],
      })

      const result = await service.getShippingProfilesDictionary({ search: 'express' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toBe('Express International')
    })
  })

  describe('getShopSectionsDictionary', () => {
    it('returns formatted shop sections', async () => {
      mock.onGet(`${API_BASE}/users/me`).reply({ user_id: 1, shop_id: SHOP_ID })
      mock.onGet(`${API_BASE}/shops/${SHOP_ID}/sections`).reply({
        results: [
          { shop_section_id: 34567, title: 'Cutting Boards', active_listing_count: 12 },
        ],
      })

      const result = await service.getShopSectionsDictionary({})

      expect(result.items).toEqual([{
        label: 'Cutting Boards',
        value: '34567',
        note: '12 active listings',
      }])
    })
  })

  describe('getListingsDictionary', () => {
    it('returns formatted listings with price', async () => {
      mock.onGet(`${API_BASE}/users/me`).reply({ user_id: 1, shop_id: SHOP_ID })
      mock.onGet(`${API_BASE}/shops/${SHOP_ID}/listings`).reply({
        results: [{
          listing_id: 123,
          title: 'Oak Board',
          state: 'active',
          price: { amount: 4500, divisor: 100, currency_code: 'USD' },
        }],
      })

      const result = await service.getListingsDictionary({})

      expect(result.items[0]).toEqual({
        label: 'Oak Board',
        value: '123',
        note: 'active · 45.00 USD',
      })
    })

    it('paginates with cursor', async () => {
      mock.onGet(`${API_BASE}/users/me`).reply({ user_id: 1, shop_id: SHOP_ID })

      const listings = Array.from({ length: 100 }, (_, i) => ({
        listing_id: i,
        title: `Listing ${i}`,
        state: 'active',
      }))

      mock.onGet(`${API_BASE}/shops/${SHOP_ID}/listings`).reply({ results: listings })

      const result = await service.getListingsDictionary({})

      expect(result.cursor).toBe('100')
    })

    it('returns no cursor on last page', async () => {
      mock.onGet(`${API_BASE}/users/me`).reply({ user_id: 1, shop_id: SHOP_ID })
      mock.onGet(`${API_BASE}/shops/${SHOP_ID}/listings`).reply({
        results: [{ listing_id: 1, title: 'Only One', state: 'active' }],
      })

      const result = await service.getListingsDictionary({})

      expect(result.cursor).toBeUndefined()
    })
  })

  describe('getTaxonomyNodesDictionary', () => {
    it('returns paginated taxonomy nodes with search filtering', async () => {
      mock.onGet(`${API_BASE}/seller-taxonomy/nodes`).reply({
        results: [
          {
            id: 1, name: 'Home', level: 1,
            children: [
              {
                id: 2, name: 'Kitchen', level: 2,
                children: [
                  { id: 3, name: 'Cutting Boards', level: 3, children: [] },
                ],
              },
            ],
          },
        ],
      })

      const result = await service.getTaxonomyNodesDictionary({ search: 'cutting' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toEqual({
        label: 'Cutting Boards',
        value: '3',
        note: 'Home > Kitchen > Cutting Boards',
      })
    })
  })

  // ── Error Handling ──

  describe('error handling', () => {
    it('extracts error_description from OAuth errors', async () => {
      mock.onGet(`${API_BASE}/users/me`).replyWithError({
        message: 'Forbidden',
        body: { error: 'insufficient_scope', error_description: 'Missing required scope' },
      })

      await expect(service.getCurrentUser())
        .rejects.toThrow('Etsy API error: Missing required scope')
    })

    it('extracts error string from API errors', async () => {
      mock.onGet(`${API_BASE}/users/me`).replyWithError({
        message: 'Not Found',
        body: { error: 'Resource not found' },
      })

      await expect(service.getCurrentUser())
        .rejects.toThrow('Etsy API error: Resource not found')
    })

    it('falls back to error.message when body has no standard fields', async () => {
      mock.onGet(`${API_BASE}/users/me`).replyWithError({
        message: 'Network timeout',
      })

      await expect(service.getCurrentUser())
        .rejects.toThrow('Etsy API error: Network timeout')
    })
  })
})
