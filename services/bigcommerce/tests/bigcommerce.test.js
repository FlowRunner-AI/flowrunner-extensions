'use strict'

const { createSandbox } = require('../../../service-sandbox')

const CLIENT_ID = 'test-client-id'
const CLIENT_SECRET = 'test-client-secret'
const ACCESS_TOKEN = 'test-access-token'
const STORE_HASH = 'stores/abc123'
const COMPOSITE_TOKEN = `${ ACCESS_TOKEN }::ctx::${ STORE_HASH }`

const API_HOST = 'https://api.bigcommerce.com'
const V3 = `${ API_HOST }/${ STORE_HASH }/v3`
const V2 = `${ API_HOST }/${ STORE_HASH }/v2`
const OAUTH_TOKEN_URL = 'https://login.bigcommerce.com/oauth2/token'

const EXPECTED_HEADERS = {
  'X-Auth-Token': ACCESS_TOKEN,
  Accept: 'application/json',
  'Content-Type': 'application/json',
}

describe('BigCommerce Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET })
    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()

    // Simulate OAuth access token header with composite token
    service.request = { headers: { 'oauth-access-token': COMPOSITE_TOKEN } }
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
    it('returns authorization URL with correct params', async () => {
      const url = await service.getOAuth2ConnectionURL()

      expect(url).toContain('https://login.bigcommerce.com/oauth2/authorize')
      expect(url).toContain(`client_id=${ CLIENT_ID }`)
      expect(url).toContain('response_type=code')
      expect(url).toContain('scope=')
    })
  })

  describe('executeCallback', () => {
    it('exchanges code for token and returns composite token', async () => {
      mock.onPost(OAUTH_TOKEN_URL).reply({
        access_token: 'real-token',
        context: 'stores/xyz789',
        account_uuid: 'uuid-123',
        user: { email: 'test@example.com' },
      })

      const result = await service.executeCallback({
        code: 'auth-code',
        scope: 'store_v2_orders',
        redirectURI: 'https://example.com/callback',
        context: 'stores/xyz789',
      })

      expect(result.token).toBe('real-token::ctx::stores/xyz789')
      expect(result.connectionIdentityName).toBe('test@example.com')
      expect(result.overwrite).toBe(true)
      expect(result.userData).toMatchObject({
        context: 'stores/xyz789',
        accountUuid: 'uuid-123',
        email: 'test@example.com',
      })

      expect(mock.history[0].body).toMatchObject({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code: 'auth-code',
        grant_type: 'authorization_code',
        redirect_uri: 'https://example.com/callback',
        context: 'stores/xyz789',
      })
    })
  })

  describe('refreshToken', () => {
    it('returns the existing composite token unchanged', async () => {
      const result = await service.refreshToken('old-refresh')

      expect(result).toEqual({ token: COMPOSITE_TOKEN })
    })
  })

  // ── Products ──

  describe('createProduct', () => {
    it('sends POST with correct body and maps dropdown values', async () => {
      const response = { data: { id: 111, name: 'Mug' }, meta: {} }
      mock.onPost(`${ V3 }/catalog/products`).reply(response)

      const result = await service.createProduct(
        'Mug', '10.00', 'Physical Product', 4, 'SKU-1',
        [23, 21], '40', 'Track by Product', 100, 'A great mug', true,
      )

      expect(result).toEqual(response)
      expect(mock.history[0].headers).toMatchObject(EXPECTED_HEADERS)
      expect(mock.history[0].body).toMatchObject({
        name: 'Mug',
        price: '10.00',
        type: 'physical',
        weight: 4,
        sku: 'SKU-1',
        categories: [23, 21],
        brand_id: '40',
        inventory_tracking: 'product',
        inventory_level: 100,
        description: 'A great mug',
        is_visible: true,
      })
    })

    it('omits optional fields when not provided', async () => {
      mock.onPost(`${ V3 }/catalog/products`).reply({ data: { id: 112 }, meta: {} })

      await service.createProduct('Mug', '10.00', 'Digital Product', 0)

      const body = mock.history[0].body
      expect(body.name).toBe('Mug')
      expect(body.type).toBe('digital')
      expect(body).not.toHaveProperty('sku')
      expect(body).not.toHaveProperty('categories')
      expect(body).not.toHaveProperty('description')
    })
  })

  describe('getProduct', () => {
    it('sends GET with correct URL', async () => {
      mock.onGet(`${ V3 }/catalog/products/111`).reply({ data: { id: 111 }, meta: {} })

      const result = await service.getProduct(111)

      expect(result).toEqual({ data: { id: 111 }, meta: {} })
      expect(mock.history[0].headers).toMatchObject(EXPECTED_HEADERS)
    })
  })

  describe('listProducts', () => {
    it('sends correct query with defaults', async () => {
      mock.onGet(`${ V3 }/catalog/products`).reply({ data: [], meta: {} })

      await service.listProducts()

      expect(mock.history[0].query).toMatchObject({ limit: 50, page: 1 })
    })

    it('passes keyword and custom pagination', async () => {
      mock.onGet(`${ V3 }/catalog/products`).reply({ data: [], meta: {} })

      await service.listProducts('mug', 10, 2)

      expect(mock.history[0].query).toMatchObject({ keyword: 'mug', limit: 10, page: 2 })
    })
  })

  describe('updateProduct', () => {
    it('sends PUT with correct body', async () => {
      mock.onPut(`${ V3 }/catalog/products/111`).reply({ data: { id: 111 }, meta: {} })

      await service.updateProduct(111, 'Updated Mug', '12.00', true, 50)

      expect(mock.history[0].body).toMatchObject({
        name: 'Updated Mug',
        price: '12.00',
        is_visible: true,
        inventory_level: 50,
      })
    })

    it('omits optional fields when not provided', async () => {
      mock.onPut(`${ V3 }/catalog/products/111`).reply({ data: { id: 111 }, meta: {} })

      await service.updateProduct(111)

      expect(mock.history[0].body).toEqual({})
    })
  })

  describe('deleteProduct', () => {
    it('sends DELETE and returns confirmation', async () => {
      mock.onDelete(`${ V3 }/catalog/products/111`).reply(undefined)

      const result = await service.deleteProduct(111)

      expect(result).toEqual({ deleted: true, productId: 111 })
    })
  })

  // ── Product Variants ──

  describe('createProductVariant', () => {
    it('sends POST with correct body', async () => {
      mock.onPost(`${ V3 }/catalog/products/111/variants`).reply({ data: { id: 74 }, meta: {} })

      const optionValues = [{ id: 65, option_id: 12 }]
      await service.createProductVariant(111, 'MUG-RED', optionValues, 11.0, 50)

      expect(mock.history[0].body).toMatchObject({
        sku: 'MUG-RED',
        option_values: optionValues,
        price: 11.0,
        inventory_level: 50,
      })
    })
  })

  describe('getProductVariant', () => {
    it('sends GET with correct URL', async () => {
      mock.onGet(`${ V3 }/catalog/products/111/variants/74`).reply({ data: { id: 74 }, meta: {} })

      const result = await service.getProductVariant(111, 74)

      expect(result).toEqual({ data: { id: 74 }, meta: {} })
    })
  })

  describe('listProductVariants', () => {
    it('sends GET to correct URL', async () => {
      mock.onGet(`${ V3 }/catalog/products/111/variants`).reply({ data: [], meta: {} })

      await service.listProductVariants(111)

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].url).toBe(`${ V3 }/catalog/products/111/variants`)
    })
  })

  describe('updateProductVariant', () => {
    it('sends PUT with correct body', async () => {
      mock.onPut(`${ V3 }/catalog/products/111/variants/74`).reply({ data: { id: 74 }, meta: {} })

      await service.updateProductVariant(111, 74, 12.0, 30)

      expect(mock.history[0].body).toMatchObject({ price: 12.0, inventory_level: 30 })
    })
  })

  describe('deleteProductVariant', () => {
    it('sends DELETE and returns confirmation', async () => {
      mock.onDelete(`${ V3 }/catalog/products/111/variants/74`).reply(undefined)

      const result = await service.deleteProductVariant(111, 74)

      expect(result).toEqual({ deleted: true, variantId: 74 })
    })
  })

  // ── Product Images ──

  describe('createProductImage', () => {
    it('sends POST with correct body', async () => {
      mock.onPost(`${ V3 }/catalog/products/111/images`).reply({ data: { id: 9 }, meta: {} })

      await service.createProductImage(111, 'https://cdn.example.com/mug.png', true, 'A mug')

      expect(mock.history[0].body).toMatchObject({
        image_url: 'https://cdn.example.com/mug.png',
        is_thumbnail: true,
        description: 'A mug',
      })
    })
  })

  describe('listProductImages', () => {
    it('sends GET to correct URL', async () => {
      mock.onGet(`${ V3 }/catalog/products/111/images`).reply({ data: [], meta: {} })

      await service.listProductImages(111)

      expect(mock.history[0].url).toBe(`${ V3 }/catalog/products/111/images`)
    })
  })

  describe('deleteProductImage', () => {
    it('sends DELETE and returns confirmation', async () => {
      mock.onDelete(`${ V3 }/catalog/products/111/images/9`).reply(undefined)

      const result = await service.deleteProductImage(111, 9)

      expect(result).toEqual({ deleted: true, imageId: 9 })
    })
  })

  // ── Product Custom Fields ──

  describe('createProductCustomField', () => {
    it('sends POST with correct body', async () => {
      mock.onPost(`${ V3 }/catalog/products/111/custom-fields`).reply({ data: { id: 3 }, meta: {} })

      await service.createProductCustomField(111, 'Material', 'Ceramic')

      expect(mock.history[0].body).toEqual({ name: 'Material', value: 'Ceramic' })
    })
  })

  describe('listProductCustomFields', () => {
    it('sends GET to correct URL', async () => {
      mock.onGet(`${ V3 }/catalog/products/111/custom-fields`).reply({ data: [], meta: {} })

      await service.listProductCustomFields(111)

      expect(mock.history[0].url).toBe(`${ V3 }/catalog/products/111/custom-fields`)
    })
  })

  describe('updateProductCustomField', () => {
    it('sends PUT with correct body', async () => {
      mock.onPut(`${ V3 }/catalog/products/111/custom-fields/3`).reply({ data: { id: 3 }, meta: {} })

      await service.updateProductCustomField(111, 3, 'Material', 'Porcelain')

      expect(mock.history[0].body).toEqual({ name: 'Material', value: 'Porcelain' })
    })

    it('omits optional fields', async () => {
      mock.onPut(`${ V3 }/catalog/products/111/custom-fields/3`).reply({ data: { id: 3 }, meta: {} })

      await service.updateProductCustomField(111, 3)

      expect(mock.history[0].body).toEqual({})
    })
  })

  describe('deleteProductCustomField', () => {
    it('sends DELETE and returns confirmation', async () => {
      mock.onDelete(`${ V3 }/catalog/products/111/custom-fields/3`).reply(undefined)

      const result = await service.deleteProductCustomField(111, 3)

      expect(result).toEqual({ deleted: true, customFieldId: 3 })
    })
  })

  // ── Product Modifiers ──

  describe('createProductModifier', () => {
    it('sends POST with mapped type', async () => {
      mock.onPost(`${ V3 }/catalog/products/111/modifiers`).reply({ data: { id: 21 }, meta: {} })

      await service.createProductModifier(111, 'Text Field', true, 'Engraving')

      expect(mock.history[0].body).toMatchObject({
        type: 'text',
        required: true,
        display_name: 'Engraving',
      })
    })
  })

  describe('listProductModifiers', () => {
    it('sends GET to correct URL', async () => {
      mock.onGet(`${ V3 }/catalog/products/111/modifiers`).reply({ data: [], meta: {} })

      await service.listProductModifiers(111)

      expect(mock.history[0].url).toBe(`${ V3 }/catalog/products/111/modifiers`)
    })
  })

  describe('updateProductModifier', () => {
    it('sends PUT with correct body', async () => {
      mock.onPut(`${ V3 }/catalog/products/111/modifiers/21`).reply({ data: { id: 21 }, meta: {} })

      await service.updateProductModifier(111, 21, 'Gift Wrap', true)

      expect(mock.history[0].body).toMatchObject({ display_name: 'Gift Wrap', required: true })
    })
  })

  describe('deleteProductModifier', () => {
    it('sends DELETE and returns confirmation', async () => {
      mock.onDelete(`${ V3 }/catalog/products/111/modifiers/21`).reply(undefined)

      const result = await service.deleteProductModifier(111, 21)

      expect(result).toEqual({ deleted: true, modifierId: 21 })
    })
  })

  // ── Categories ──

  describe('createCategory', () => {
    it('sends POST with correct body', async () => {
      mock.onPost(`${ V3 }/catalog/categories`).reply({ data: { id: 36 }, meta: {} })

      await service.createCategory('Shoes', 18, 'Footwear desc', true)

      expect(mock.history[0].body).toMatchObject({
        name: 'Shoes',
        parent_id: 18,
        description: 'Footwear desc',
        is_visible: true,
      })
    })

    it('defaults parent_id to 0 when not provided', async () => {
      mock.onPost(`${ V3 }/catalog/categories`).reply({ data: { id: 37 }, meta: {} })

      await service.createCategory('Top Level')

      expect(mock.history[0].body).toMatchObject({ name: 'Top Level', parent_id: 0 })
    })
  })

  describe('getCategory', () => {
    it('sends GET with correct URL', async () => {
      mock.onGet(`${ V3 }/catalog/categories/36`).reply({ data: { id: 36 }, meta: {} })

      const result = await service.getCategory(36)

      expect(result).toEqual({ data: { id: 36 }, meta: {} })
    })
  })

  describe('listCategories', () => {
    it('sends correct query with defaults', async () => {
      mock.onGet(`${ V3 }/catalog/categories`).reply({ data: [], meta: {} })

      await service.listCategories()

      expect(mock.history[0].query).toMatchObject({ limit: 50, page: 1 })
    })
  })

  describe('updateCategory', () => {
    it('sends PUT with correct body', async () => {
      mock.onPut(`${ V3 }/catalog/categories/36`).reply({ data: { id: 36 }, meta: {} })

      await service.updateCategory(36, 'Footwear', true)

      expect(mock.history[0].body).toMatchObject({ name: 'Footwear', is_visible: true })
    })
  })

  describe('deleteCategory', () => {
    it('sends DELETE and returns confirmation', async () => {
      mock.onDelete(`${ V3 }/catalog/categories/36`).reply(undefined)

      const result = await service.deleteCategory(36)

      expect(result).toEqual({ deleted: true, categoryId: 36 })
    })
  })

  // ── Brands ──

  describe('createBrand', () => {
    it('sends POST with correct body including meta keywords', async () => {
      mock.onPost(`${ V3 }/catalog/brands`).reply({ data: { id: 40 }, meta: {} })

      await service.createBrand('BigCommerce', 'BC Page', 'https://logo.png', 'coffee,mugs')

      expect(mock.history[0].body).toMatchObject({
        name: 'BigCommerce',
        page_title: 'BC Page',
        image_url: 'https://logo.png',
        meta_keywords: ['coffee', 'mugs'],
      })
    })

    it('handles array meta keywords', async () => {
      mock.onPost(`${ V3 }/catalog/brands`).reply({ data: { id: 41 }, meta: {} })

      await service.createBrand('Brand', null, null, ['kw1', 'kw2'])

      expect(mock.history[0].body).toMatchObject({
        name: 'Brand',
        meta_keywords: ['kw1', 'kw2'],
      })
    })

    it('omits optional fields', async () => {
      mock.onPost(`${ V3 }/catalog/brands`).reply({ data: { id: 42 }, meta: {} })

      await service.createBrand('Minimal')

      expect(mock.history[0].body).toEqual({ name: 'Minimal' })
    })
  })

  describe('getBrand', () => {
    it('sends GET with correct URL', async () => {
      mock.onGet(`${ V3 }/catalog/brands/40`).reply({ data: { id: 40 }, meta: {} })

      await service.getBrand(40)

      expect(mock.history[0].url).toBe(`${ V3 }/catalog/brands/40`)
    })
  })

  describe('listBrands', () => {
    it('sends correct query with defaults', async () => {
      mock.onGet(`${ V3 }/catalog/brands`).reply({ data: [], meta: {} })

      await service.listBrands()

      expect(mock.history[0].query).toMatchObject({ limit: 50, page: 1 })
    })
  })

  describe('updateBrand', () => {
    it('sends PUT with correct body', async () => {
      mock.onPut(`${ V3 }/catalog/brands/40`).reply({ data: { id: 40 }, meta: {} })

      await service.updateBrand(40, 'BigCommerce Inc', 'https://new-logo.png')

      expect(mock.history[0].body).toMatchObject({
        name: 'BigCommerce Inc',
        image_url: 'https://new-logo.png',
      })
    })
  })

  describe('deleteBrand', () => {
    it('sends DELETE and returns confirmation', async () => {
      mock.onDelete(`${ V3 }/catalog/brands/40`).reply(undefined)

      const result = await service.deleteBrand(40)

      expect(result).toEqual({ deleted: true, brandId: 40 })
    })
  })

  // ── Inventory ──

  describe('adjustInventoryAbsolute', () => {
    it('sends PUT with correct body and defaults', async () => {
      mock.onPut(`${ V3 }/inventory/adjustments/absolute`).reply({ data: { id: 'adj_1' }, meta: {} })

      await service.adjustInventoryAbsolute(74, 100)

      expect(mock.history[0].body).toEqual({
        reason: 'Set via FlowRunner',
        items: [{ location_id: 1, variant_id: 74, quantity: 100 }],
      })
    })

    it('uses custom location and reason', async () => {
      mock.onPut(`${ V3 }/inventory/adjustments/absolute`).reply({ data: { id: 'adj_1' }, meta: {} })

      await service.adjustInventoryAbsolute(74, 50, 5, 'Manual recount')

      expect(mock.history[0].body).toEqual({
        reason: 'Manual recount',
        items: [{ location_id: 5, variant_id: 74, quantity: 50 }],
      })
    })
  })

  describe('adjustInventoryRelative', () => {
    it('sends PUT with correct body and defaults', async () => {
      mock.onPut(`${ V3 }/inventory/adjustments/relative`).reply({ data: { id: 'adj_2' }, meta: {} })

      await service.adjustInventoryRelative(74, -5)

      expect(mock.history[0].body).toEqual({
        reason: 'Adjusted via FlowRunner',
        items: [{ location_id: 1, variant_id: 74, quantity: -5 }],
      })
    })
  })

  // ── Customers ──

  describe('createCustomer', () => {
    it('sends POST with array body', async () => {
      mock.onPost(`${ V3 }/customers`).reply({ data: [{ id: 12 }], meta: {} })

      await service.createCustomer('John', 'Doe', 'john@example.com', 'Acme', '555-1234', '3')

      expect(mock.history[0].body).toEqual([{
        first_name: 'John',
        last_name: 'Doe',
        email: 'john@example.com',
        company: 'Acme',
        phone: '555-1234',
        customer_group_id: '3',
      }])
    })

    it('omits optional fields', async () => {
      mock.onPost(`${ V3 }/customers`).reply({ data: [{ id: 13 }], meta: {} })

      await service.createCustomer('Jane', 'Doe', 'jane@example.com')

      expect(mock.history[0].body).toEqual([{
        first_name: 'Jane',
        last_name: 'Doe',
        email: 'jane@example.com',
      }])
    })
  })

  describe('getCustomer', () => {
    it('sends GET with id:in query', async () => {
      mock.onGet(`${ V3 }/customers`).reply({ data: [{ id: 12 }], meta: {} })

      await service.getCustomer(12)

      expect(mock.history[0].query).toMatchObject({ 'id:in': 12 })
    })
  })

  describe('listCustomers', () => {
    it('sends correct query with defaults', async () => {
      mock.onGet(`${ V3 }/customers`).reply({ data: [], meta: {} })

      await service.listCustomers()

      expect(mock.history[0].query).toMatchObject({ limit: 50, page: 1 })
    })

    it('passes email filter with email:like', async () => {
      mock.onGet(`${ V3 }/customers`).reply({ data: [], meta: {} })

      await service.listCustomers('john')

      expect(mock.history[0].query).toMatchObject({ 'email:like': 'john' })
    })
  })

  describe('updateCustomer', () => {
    it('sends PUT with array body including id', async () => {
      mock.onPut(`${ V3 }/customers`).reply({ data: [{ id: 12 }], meta: {} })

      await service.updateCustomer(12, 'Jonathan', 'Doe', 'jon@example.com', '3')

      expect(mock.history[0].body).toEqual([{
        id: 12,
        first_name: 'Jonathan',
        last_name: 'Doe',
        email: 'jon@example.com',
        customer_group_id: '3',
      }])
    })
  })

  describe('deleteCustomer', () => {
    it('sends DELETE with id:in query and returns confirmation', async () => {
      mock.onDelete(`${ V3 }/customers`).reply(undefined)

      const result = await service.deleteCustomer(12)

      expect(result).toEqual({ deleted: true, customerId: 12 })
      expect(mock.history[0].query).toMatchObject({ 'id:in': 12 })
    })
  })

  // ── Customer Addresses ──

  describe('createCustomerAddress', () => {
    it('sends POST with array body', async () => {
      mock.onPost(`${ V3 }/customers/addresses`).reply({ data: [{ id: 7 }], meta: {} })

      await service.createCustomerAddress(12, 'John', 'Doe', '123 Main St', 'Austin', 'TX', '78701', 'US')

      expect(mock.history[0].body).toEqual([{
        customer_id: 12,
        first_name: 'John',
        last_name: 'Doe',
        address1: '123 Main St',
        city: 'Austin',
        state_or_province: 'TX',
        postal_code: '78701',
        country_code: 'US',
      }])
    })
  })

  describe('listCustomerAddresses', () => {
    it('sends GET with customer_id:in query', async () => {
      mock.onGet(`${ V3 }/customers/addresses`).reply({ data: [], meta: {} })

      await service.listCustomerAddresses(12)

      expect(mock.history[0].query).toMatchObject({ 'customer_id:in': 12 })
    })
  })

  describe('updateCustomerAddress', () => {
    it('sends PUT with array body', async () => {
      mock.onPut(`${ V3 }/customers/addresses`).reply({ data: [{ id: 7 }], meta: {} })

      await service.updateCustomerAddress(7, 12, '456 Oak Ave', 'Dallas')

      expect(mock.history[0].body).toEqual([{
        id: 7,
        customer_id: 12,
        address1: '456 Oak Ave',
        city: 'Dallas',
      }])
    })
  })

  describe('deleteCustomerAddress', () => {
    it('sends DELETE with id:in query', async () => {
      mock.onDelete(`${ V3 }/customers/addresses`).reply(undefined)

      const result = await service.deleteCustomerAddress(7)

      expect(result).toEqual({ deleted: true, addressId: 7 })
      expect(mock.history[0].query).toMatchObject({ 'id:in': 7 })
    })
  })

  // ── Customer Groups (V2) ──

  describe('createCustomerGroup', () => {
    it('sends POST with correct body', async () => {
      mock.onPost(`${ V2 }/customer_groups`).reply({ id: 3, name: 'Wholesale' })

      const result = await service.createCustomerGroup('Wholesale', false)

      expect(result).toEqual({ id: 3, name: 'Wholesale' })
      expect(mock.history[0].body).toMatchObject({ name: 'Wholesale', is_default: false })
    })
  })

  describe('getCustomerGroup', () => {
    it('sends GET with correct URL', async () => {
      mock.onGet(`${ V2 }/customer_groups/3`).reply({ id: 3, name: 'Wholesale' })

      await service.getCustomerGroup(3)

      expect(mock.history[0].url).toBe(`${ V2 }/customer_groups/3`)
    })
  })

  describe('listCustomerGroups', () => {
    it('sends correct query with defaults', async () => {
      mock.onGet(`${ V2 }/customer_groups`).reply([{ id: 3 }])

      await service.listCustomerGroups()

      expect(mock.history[0].query).toMatchObject({ limit: 50, page: 1 })
    })
  })

  describe('updateCustomerGroup', () => {
    it('sends PUT with correct body', async () => {
      mock.onPut(`${ V2 }/customer_groups/3`).reply({ id: 3, name: 'Updated' })

      await service.updateCustomerGroup(3, 'Updated', true)

      expect(mock.history[0].body).toMatchObject({ name: 'Updated', is_default: true })
    })
  })

  describe('deleteCustomerGroup', () => {
    it('sends DELETE and returns confirmation', async () => {
      mock.onDelete(`${ V2 }/customer_groups/3`).reply(undefined)

      const result = await service.deleteCustomerGroup(3)

      expect(result).toEqual({ deleted: true, groupId: 3 })
    })
  })

  // ── Orders (V2) ──

  describe('createOrder', () => {
    it('sends POST with correct body', async () => {
      const billingAddress = { first_name: 'John', last_name: 'Doe', street_1: '123 Main St', city: 'Austin', state: 'TX', zip: '78701', country_iso2: 'US', email: 'john@example.com' }
      const products = [{ product_id: 111, quantity: 2 }]

      mock.onPost(`${ V2 }/orders`).reply({ id: 100, status: 'Pending' })

      await service.createOrder(billingAddress, products, 12, 1, 'Rush order')

      expect(mock.history[0].body).toMatchObject({
        billing_address: billingAddress,
        products: [{ product_id: 111, quantity: 2 }],
        customer_id: 12,
        status_id: 1,
        customer_message: 'Rush order',
      })
    })

    it('handles custom line items', async () => {
      const billingAddress = { first_name: 'Jane' }
      const products = [{ name: 'Custom Item', quantity: 1, price_inc_tax: 25.00, price_ex_tax: 22.00 }]

      mock.onPost(`${ V2 }/orders`).reply({ id: 101 })

      await service.createOrder(billingAddress, products)

      const lines = mock.history[0].body.products
      expect(lines[0]).toMatchObject({ name: 'Custom Item', quantity: 1, price_inc_tax: 25.00, price_ex_tax: 22.00 })
    })
  })

  describe('getOrder', () => {
    it('sends GET with correct URL', async () => {
      mock.onGet(`${ V2 }/orders/100`).reply({ id: 100 })

      const result = await service.getOrder(100)

      expect(result).toEqual({ id: 100 })
    })
  })

  describe('listOrders', () => {
    it('sends correct query with defaults', async () => {
      mock.onGet(`${ V2 }/orders`).reply([{ id: 100 }])

      await service.listOrders()

      expect(mock.history[0].query).toMatchObject({ limit: 50, page: 1 })
    })

    it('passes filters', async () => {
      mock.onGet(`${ V2 }/orders`).reply([])

      await service.listOrders(1, 12, 10, 2)

      expect(mock.history[0].query).toMatchObject({ status_id: 1, customer_id: 12, limit: 10, page: 2 })
    })
  })

  describe('updateOrder', () => {
    it('sends PUT with correct body', async () => {
      mock.onPut(`${ V2 }/orders/100`).reply({ id: 100 })

      await service.updateOrder(100, 'Please rush', 'Called customer')

      expect(mock.history[0].body).toMatchObject({
        customer_message: 'Please rush',
        staff_notes: 'Called customer',
      })
    })
  })

  describe('updateOrderStatus', () => {
    it('sends PUT with status_id', async () => {
      mock.onPut(`${ V2 }/orders/100`).reply({ id: 100, status_id: 11 })

      await service.updateOrderStatus(100, 11)

      expect(mock.history[0].body).toEqual({ status_id: 11 })
    })
  })

  // ── Order Sub-resources ──

  describe('listOrderProducts', () => {
    it('sends GET with correct URL', async () => {
      mock.onGet(`${ V2 }/orders/100/products`).reply([{ id: 5 }])

      await service.listOrderProducts(100)

      expect(mock.history[0].url).toBe(`${ V2 }/orders/100/products`)
    })
  })

  describe('listOrderCoupons', () => {
    it('sends GET with correct URL', async () => {
      mock.onGet(`${ V2 }/orders/100/coupons`).reply([])

      await service.listOrderCoupons(100)

      expect(mock.history[0].url).toBe(`${ V2 }/orders/100/coupons`)
    })
  })

  describe('listOrderStatuses', () => {
    it('sends GET with correct URL', async () => {
      mock.onGet(`${ V2 }/order_statuses`).reply([{ id: 1, name: 'Pending' }])

      await service.listOrderStatuses()

      expect(mock.history[0].url).toBe(`${ V2 }/order_statuses`)
    })
  })

  // ── Order Shipments (V2) ──

  describe('createOrderShipment', () => {
    it('sends POST with correct body and maps shipping provider', async () => {
      const items = [{ order_product_id: 5, quantity: 1 }]
      mock.onPost(`${ V2 }/orders/100/shipments`).reply({ id: 1 })

      await service.createOrderShipment(100, 1, items, '1Z999', 'UPS', 'Handle with care')

      expect(mock.history[0].body).toMatchObject({
        order_address_id: 1,
        items,
        tracking_number: '1Z999',
        shipping_provider: 'ups',
        comments: 'Handle with care',
      })
    })
  })

  describe('getOrderShipment', () => {
    it('sends GET with correct URL', async () => {
      mock.onGet(`${ V2 }/orders/100/shipments/1`).reply({ id: 1 })

      await service.getOrderShipment(100, 1)

      expect(mock.history[0].url).toBe(`${ V2 }/orders/100/shipments/1`)
    })
  })

  describe('listOrderShipments', () => {
    it('sends GET with correct URL', async () => {
      mock.onGet(`${ V2 }/orders/100/shipments`).reply([])

      await service.listOrderShipments(100)

      expect(mock.history[0].url).toBe(`${ V2 }/orders/100/shipments`)
    })
  })

  describe('updateOrderShipment', () => {
    it('sends PUT with correct body and maps provider', async () => {
      mock.onPut(`${ V2 }/orders/100/shipments/1`).reply({ id: 1 })

      await service.updateOrderShipment(100, 1, '1Z888', 'FedEx')

      expect(mock.history[0].body).toMatchObject({
        tracking_number: '1Z888',
        shipping_provider: 'fedex',
      })
    })
  })

  describe('deleteOrderShipment', () => {
    it('sends DELETE and returns confirmation', async () => {
      mock.onDelete(`${ V2 }/orders/100/shipments/1`).reply(undefined)

      const result = await service.deleteOrderShipment(100, 1)

      expect(result).toEqual({ deleted: true, shipmentId: 1 })
    })
  })

  // ── Order Refunds (V3) ──

  describe('refundQuote', () => {
    it('sends POST with correct body', async () => {
      const items = [{ item_type: 'PRODUCT', item_id: 5, quantity: 1 }]
      mock.onPost(`${ V3 }/orders/100/payment_actions/refund_quotes`).reply({ data: { order_id: 100 }, meta: {} })

      await service.refundQuote(100, items)

      expect(mock.history[0].body).toEqual({ items })
    })
  })

  describe('createRefund', () => {
    it('sends POST with correct body', async () => {
      const items = [{ item_type: 'PRODUCT', item_id: 5, quantity: 1 }]
      const payments = [{ provider_id: 'storecredit', amount: 50 }]
      mock.onPost(`${ V3 }/orders/100/payment_actions/refunds`).reply({ data: { id: 1 }, meta: {} })

      await service.createRefund(100, items, payments)

      expect(mock.history[0].body).toEqual({ items, payments })
    })
  })

  describe('listRefunds', () => {
    it('sends GET with correct URL', async () => {
      mock.onGet(`${ V3 }/orders/100/payment_actions/refunds`).reply({ data: [], meta: {} })

      await service.listRefunds(100)

      expect(mock.history[0].url).toBe(`${ V3 }/orders/100/payment_actions/refunds`)
    })
  })

  // ── Carts (V3) ──

  describe('createCart', () => {
    it('sends POST with correct body', async () => {
      const lineItems = [{ product_id: 80, quantity: 1 }]
      mock.onPost(`${ V3 }/carts`).reply({ data: { id: 'abc-123' }, meta: {} })

      await service.createCart(lineItems, 1, 1)

      expect(mock.history[0].body).toMatchObject({
        line_items: lineItems,
        customer_id: 1,
        channel_id: 1,
      })
    })

    it('defaults channel_id to 1', async () => {
      mock.onPost(`${ V3 }/carts`).reply({ data: { id: 'abc-456' }, meta: {} })

      await service.createCart([{ product_id: 80, quantity: 1 }])

      expect(mock.history[0].body).toMatchObject({ channel_id: 1 })
    })
  })

  describe('getCart', () => {
    it('sends GET with correct URL', async () => {
      mock.onGet(`${ V3 }/carts/abc-123`).reply({ data: { id: 'abc-123' }, meta: {} })

      await service.getCart('abc-123')

      expect(mock.history[0].url).toBe(`${ V3 }/carts/abc-123`)
    })
  })

  describe('addCartLineItems', () => {
    it('sends POST with correct body', async () => {
      const lineItems = [{ product_id: 81, quantity: 2 }]
      mock.onPost(`${ V3 }/carts/abc-123/items`).reply({ data: { id: 'abc-123' }, meta: {} })

      await service.addCartLineItems('abc-123', lineItems)

      expect(mock.history[0].body).toEqual({ line_items: lineItems })
    })
  })

  describe('deleteCart', () => {
    it('sends DELETE and returns confirmation', async () => {
      mock.onDelete(`${ V3 }/carts/abc-123`).reply(undefined)

      const result = await service.deleteCart('abc-123')

      expect(result).toEqual({ deleted: true, cartId: 'abc-123' })
    })
  })

  // ── Price Lists (V3) ──

  describe('createPriceList', () => {
    it('sends POST with correct body', async () => {
      mock.onPost(`${ V3 }/pricelists`).reply({ data: { id: 4 }, meta: {} })

      await service.createPriceList('Wholesale Q3', true)

      expect(mock.history[0].body).toMatchObject({ name: 'Wholesale Q3', active: true })
    })
  })

  describe('getPriceList', () => {
    it('sends GET with correct URL', async () => {
      mock.onGet(`${ V3 }/pricelists/4`).reply({ data: { id: 4 }, meta: {} })

      await service.getPriceList(4)

      expect(mock.history[0].url).toBe(`${ V3 }/pricelists/4`)
    })
  })

  describe('listPriceLists', () => {
    it('sends correct query with defaults', async () => {
      mock.onGet(`${ V3 }/pricelists`).reply({ data: [], meta: {} })

      await service.listPriceLists()

      expect(mock.history[0].query).toMatchObject({ limit: 50, page: 1 })
    })
  })

  describe('updatePriceList', () => {
    it('sends PUT with correct body', async () => {
      mock.onPut(`${ V3 }/pricelists/4`).reply({ data: { id: 4 }, meta: {} })

      await service.updatePriceList(4, 'Wholesale Q4', false)

      expect(mock.history[0].body).toMatchObject({ name: 'Wholesale Q4', active: false })
    })
  })

  describe('deletePriceList', () => {
    it('sends DELETE and returns confirmation', async () => {
      mock.onDelete(`${ V3 }/pricelists/4`).reply(undefined)

      const result = await service.deletePriceList(4)

      expect(result).toEqual({ deleted: true, priceListId: 4 })
    })
  })

  // ── Price Records ──

  describe('upsertPriceRecord', () => {
    it('sends PUT with correct URL and body', async () => {
      mock.onPut(`${ V3 }/pricelists/4/records/3121/usd`).reply({ data: { variant_id: 3121 }, meta: {} })

      await service.upsertPriceRecord(4, 3121, 'usd', 10.0, 8.0)

      expect(mock.history[0].body).toMatchObject({ price: 10.0, currency: 'usd', sale_price: 8.0 })
    })
  })

  describe('listPriceRecords', () => {
    it('sends GET with correct URL', async () => {
      mock.onGet(`${ V3 }/pricelists/4/records`).reply({ data: [], meta: {} })

      await service.listPriceRecords(4)

      expect(mock.history[0].url).toBe(`${ V3 }/pricelists/4/records`)
    })
  })

  describe('deletePriceRecord', () => {
    it('sends DELETE and returns confirmation', async () => {
      mock.onDelete(`${ V3 }/pricelists/4/records/3121/usd`).reply(undefined)

      const result = await service.deletePriceRecord(4, 3121, 'usd')

      expect(result).toEqual({ deleted: true, variantId: 3121, currency: 'usd' })
    })
  })

  // ── Dictionaries ──

  describe('getProductsDictionary', () => {
    it('returns formatted items with pagination', async () => {
      mock.onGet(`${ V3 }/catalog/products`).reply({
        data: [{ id: 111, name: 'Mug', sku: 'MUG-1' }],
        meta: { pagination: { current_page: 1, total_pages: 2 } },
      })

      const result = await service.getProductsDictionary({ search: 'mug', cursor: null })

      expect(result.items).toEqual([{ label: 'Mug', value: 111, note: 'SKU: MUG-1' }])
      expect(result.cursor).toBe(2)
    })

    it('handles empty results', async () => {
      mock.onGet(`${ V3 }/catalog/products`).reply({ data: [], meta: { pagination: { current_page: 1, total_pages: 1 } } })

      const result = await service.getProductsDictionary()

      expect(result.items).toEqual([])
      expect(result.cursor).toBeNull()
    })
  })

  describe('getVariantsDictionary', () => {
    it('returns variants filtered by search', async () => {
      mock.onGet(`${ V3 }/catalog/products/111/variants`).reply({
        data: [
          { id: 74, sku: 'MUG-RED' },
          { id: 75, sku: 'MUG-BLUE' },
        ],
        meta: {},
      })

      const result = await service.getVariantsDictionary({ search: 'RED', criteria: { productId: 111 } })

      expect(result.items).toEqual([{ label: 'MUG-RED', value: 74, note: 'Variant 74' }])
      expect(result.cursor).toBeNull()
    })
  })

  describe('getCategoriesDictionary', () => {
    it('returns formatted items', async () => {
      mock.onGet(`${ V3 }/catalog/categories`).reply({
        data: [{ id: 36, name: 'Shoes', parent_id: 18 }],
        meta: { pagination: { current_page: 1, total_pages: 1 } },
      })

      const result = await service.getCategoriesDictionary({ search: 'shoes' })

      expect(result.items).toEqual([{ label: 'Shoes', value: 36, note: 'Parent: 18' }])
      expect(mock.history[0].query).toMatchObject({ 'name:like': 'shoes' })
    })
  })

  describe('getBrandsDictionary', () => {
    it('returns formatted items', async () => {
      mock.onGet(`${ V3 }/catalog/brands`).reply({
        data: [{ id: 40, name: 'BigCommerce' }],
        meta: { pagination: { current_page: 1, total_pages: 1 } },
      })

      const result = await service.getBrandsDictionary()

      expect(result.items).toEqual([{ label: 'BigCommerce', value: 40 }])
    })
  })

  describe('getProductImagesDictionary', () => {
    it('returns formatted items', async () => {
      mock.onGet(`${ V3 }/catalog/products/111/images`).reply({
        data: [{ id: 9, image_url: 'https://cdn.example.com/mug.png' }],
        meta: {},
      })

      const result = await service.getProductImagesDictionary({ criteria: { productId: 111 } })

      expect(result.items).toEqual([{ label: 'Image 9', value: 9, note: 'https://cdn.example.com/mug.png' }])
    })
  })

  describe('getProductCustomFieldsDictionary', () => {
    it('returns formatted items', async () => {
      mock.onGet(`${ V3 }/catalog/products/111/custom-fields`).reply({
        data: [{ id: 3, name: 'Material', value: 'Ceramic' }],
        meta: {},
      })

      const result = await service.getProductCustomFieldsDictionary({ criteria: { productId: 111 } })

      expect(result.items).toEqual([{ label: 'Material', value: 3, note: 'Ceramic' }])
    })
  })

  describe('getProductModifiersDictionary', () => {
    it('returns formatted items', async () => {
      mock.onGet(`${ V3 }/catalog/products/111/modifiers`).reply({
        data: [{ id: 21, display_name: 'Engraving', type: 'text' }],
        meta: {},
      })

      const result = await service.getProductModifiersDictionary({ criteria: { productId: 111 } })

      expect(result.items).toEqual([{ label: 'Engraving', value: 21, note: 'text' }])
    })
  })

  describe('getCustomersDictionary', () => {
    it('returns formatted items', async () => {
      mock.onGet(`${ V3 }/customers`).reply({
        data: [{ id: 12, first_name: 'John', last_name: 'Doe', email: 'john@example.com' }],
        meta: { pagination: { current_page: 1, total_pages: 1 } },
      })

      const result = await service.getCustomersDictionary({ search: 'john' })

      expect(result.items).toEqual([{ label: 'John Doe', value: 12, note: 'john@example.com' }])
      expect(mock.history[0].query).toMatchObject({ 'email:like': 'john' })
    })
  })

  describe('getCustomerAddressesDictionary', () => {
    it('returns formatted items', async () => {
      mock.onGet(`${ V3 }/customers/addresses`).reply({
        data: [{ id: 7, address1: '123 Main St', city: 'Austin' }],
        meta: {},
      })

      const result = await service.getCustomerAddressesDictionary({ criteria: { customerId: 12 } })

      expect(result.items).toEqual([{ label: '123 Main St, Austin', value: 7 }])
    })
  })

  describe('getCustomerGroupsDictionary', () => {
    it('returns formatted items filtered by search', async () => {
      mock.onGet(`${ V2 }/customer_groups`).reply([
        { id: 3, name: 'Wholesale' },
        { id: 4, name: 'VIP' },
      ])

      const result = await service.getCustomerGroupsDictionary({ search: 'whole' })

      expect(result.items).toEqual([{ label: 'Wholesale', value: 3 }])
    })
  })

  describe('getOrdersDictionary', () => {
    it('returns formatted items with pagination', async () => {
      mock.onGet(`${ V2 }/orders`).reply([
        { id: 100, status: 'Pending', total_inc_tax: '50.00' },
      ])

      const result = await service.getOrdersDictionary()

      expect(result.items).toEqual([{ label: 'Order #100 (Pending)', value: 100, note: '50.00' }])
      expect(result.cursor).toBeNull()
    })

    it('returns next page cursor when page is full', async () => {
      const orders = Array.from({ length: 50 }, (_, i) => ({ id: i + 1, status: 'Pending', total_inc_tax: '10.00' }))
      mock.onGet(`${ V2 }/orders`).reply(orders)

      const result = await service.getOrdersDictionary()

      expect(result.cursor).toBe(2)
    })
  })

  describe('getOrderStatusesDictionary', () => {
    it('returns formatted items filtered by search', async () => {
      mock.onGet(`${ V2 }/order_statuses`).reply([
        { id: 1, name: 'Pending' },
        { id: 11, name: 'Awaiting Fulfillment' },
      ])

      const result = await service.getOrderStatusesDictionary({ search: 'pend' })

      expect(result.items).toEqual([{ label: 'Pending', value: 1 }])
    })
  })

  describe('getOrderAddressesDictionary', () => {
    it('returns formatted items', async () => {
      mock.onGet(`${ V2 }/orders/100/shipping_addresses`).reply([
        { id: 1, street_1: '123 Main Street', city: 'Austin' },
      ])

      const result = await service.getOrderAddressesDictionary({ criteria: { orderId: 100 } })

      expect(result.items).toEqual([{ label: '123 Main Street, Austin', value: 1 }])
    })
  })

  describe('getOrderShipmentsDictionary', () => {
    it('returns formatted items', async () => {
      mock.onGet(`${ V2 }/orders/100/shipments`).reply([
        { id: 1, tracking_number: '1Z999' },
      ])

      const result = await service.getOrderShipmentsDictionary({ criteria: { orderId: 100 } })

      expect(result.items).toEqual([{ label: 'Shipment 1 (1Z999)', value: 1 }])
    })
  })

  describe('getOrderProductsDictionary', () => {
    it('returns formatted items', async () => {
      mock.onGet(`${ V2 }/orders/100/products`).reply([
        { id: 5, name: 'Mug', quantity: 1 },
      ])

      const result = await service.getOrderProductsDictionary({ criteria: { orderId: 100 } })

      expect(result.items).toEqual([{ label: 'Mug (x1)', value: 5 }])
    })
  })

  describe('getPriceListsDictionary', () => {
    it('returns formatted items with search filtering', async () => {
      mock.onGet(`${ V3 }/pricelists`).reply({
        data: [
          { id: 4, name: 'Wholesale Q3', active: true },
          { id: 5, name: 'Retail', active: false },
        ],
        meta: { pagination: { current_page: 1, total_pages: 1 } },
      })

      const result = await service.getPriceListsDictionary({ search: 'whole' })

      expect(result.items).toEqual([{ label: 'Wholesale Q3', value: 4, note: 'Active' }])
    })
  })

  describe('getLocationsDictionary', () => {
    it('returns formatted items with search filtering', async () => {
      mock.onGet(`${ V3 }/inventory/locations`).reply({
        data: [
          { id: 1, label: 'Default Warehouse', code: 'BC-DEFAULT' },
          { id: 2, label: 'East Coast', code: 'EC-1' },
        ],
        meta: {},
      })

      const result = await service.getLocationsDictionary({ search: 'default' })

      expect(result.items).toEqual([{ label: 'Default Warehouse', value: 1, note: 'BC-DEFAULT' }])
    })
  })

  // ── Schema Loaders ──

  describe('schema loaders', () => {
    it('createOrderBillingAddressSchema returns correct schema', async () => {
      const schema = await service.createOrderBillingAddressSchema()

      expect(schema).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'first_name', required: true }),
        expect.objectContaining({ name: 'email', required: true }),
      ]))
    })

    it('createOrderProductsSchema returns correct schema', async () => {
      const schema = await service.createOrderProductsSchema()

      expect(schema).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'product_id' }),
        expect.objectContaining({ name: 'quantity', required: true }),
      ]))
    })

    it('createShipmentItemsSchema returns correct schema', async () => {
      const schema = await service.createShipmentItemsSchema({ criteria: { orderId: 100 } })

      expect(schema).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'order_product_id', required: true, criteria: { orderId: 100 } }),
        expect.objectContaining({ name: 'quantity', required: true }),
      ]))
    })

    it('refundItemsSchema returns correct schema', async () => {
      const schema = await service.refundItemsSchema()

      expect(schema).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'item_type', required: true }),
        expect.objectContaining({ name: 'item_id', required: true }),
        expect.objectContaining({ name: 'quantity', required: true }),
      ]))
    })

    it('refundPaymentsSchema returns correct schema', async () => {
      const schema = await service.refundPaymentsSchema()

      expect(schema).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'provider_id', required: true }),
        expect.objectContaining({ name: 'amount', required: true }),
      ]))
    })

    it('cartLineItemsSchema returns correct schema', async () => {
      const schema = await service.cartLineItemsSchema()

      expect(schema).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'product_id', required: true }),
        expect.objectContaining({ name: 'quantity', required: true }),
      ]))
    })

    it('createVariantOptionValuesSchema returns correct schema', async () => {
      const schema = await service.createVariantOptionValuesSchema()

      expect(schema).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'option_id', required: true }),
        expect.objectContaining({ name: 'id', required: true }),
      ]))
    })
  })

  // ── Trigger System Methods ──

  describe('handleTriggerUpsertWebhook', () => {
    it('creates webhooks for all events', async () => {
      mock.onPost(`${ V3 }/hooks`).reply({ data: { id: 501 } })

      const invocation = {
        callbackUrl: 'https://flowrunner.io/callback',
        connectionId: 'conn-1',
        events: [
          { id: 'trigger-1', name: 'onOrderCreated' },
          { id: 'trigger-2', name: 'onProductCreated' },
        ],
      }

      const result = await service.handleTriggerUpsertWebhook(invocation)

      expect(mock.history).toHaveLength(2)
      expect(mock.history[0].body).toMatchObject({
        scope: 'store/order/created',
        destination: 'https://flowrunner.io/callback',
        is_active: true,
      })
      expect(mock.history[0].body.headers).toHaveProperty('X-Flowrunner-Secret')
      expect(result.webhookData.webhooks).toHaveLength(2)
      expect(result.webhookData.secret).toBeDefined()
      expect(result.connectionId).toBe('conn-1')
    })

    it('skips unknown events', async () => {
      mock.onPost(`${ V3 }/hooks`).reply({ data: { id: 502 } })

      const result = await service.handleTriggerUpsertWebhook({
        callbackUrl: 'https://flowrunner.io/callback',
        connectionId: 'conn-1',
        events: [{ id: 'trigger-1', name: 'unknownEvent' }],
      })

      expect(mock.history).toHaveLength(0)
      expect(result.webhookData.webhooks).toHaveLength(0)
    })
  })

  describe('handleTriggerResolveEvents', () => {
    it('resolves order event and fetches detail', async () => {
      mock.onGet(`${ V2 }/orders/100`).reply({ id: 100, status: 'Pending' })

      const secret = 'test-secret-123'
      const result = await service.handleTriggerResolveEvents({
        connectionId: 'conn-1',
        webhookData: { secret },
        headers: { 'X-Flowrunner-Secret': secret },
        body: {
          scope: 'store/order/created',
          data: { id: 100 },
        },
      })

      expect(result.events).toHaveLength(1)
      expect(result.events[0].name).toBe('onOrderCreated')
      expect(result.events[0].data).toMatchObject({
        eventType: 'store/order/created',
        orderId: 100,
        order: { id: 100, status: 'Pending' },
      })
    })

    it('resolves customer event', async () => {
      mock.onGet(`${ V3 }/customers`).reply({ data: [{ id: 12, email: 'john@example.com' }] })

      const secret = 'test-secret-456'
      const result = await service.handleTriggerResolveEvents({
        connectionId: 'conn-1',
        webhookData: { secret },
        headers: { 'X-Flowrunner-Secret': secret },
        body: {
          scope: 'store/customer/created',
          data: { id: 12 },
        },
      })

      expect(result.events[0].name).toBe('onCustomerCreated')
      expect(result.events[0].data).toMatchObject({
        eventType: 'store/customer/created',
        customerId: 12,
      })
    })

    it('resolves product event', async () => {
      mock.onGet(`${ V3 }/catalog/products/111`).reply({ data: { id: 111, name: 'Mug' } })

      const secret = 'prod-secret'
      const result = await service.handleTriggerResolveEvents({
        connectionId: 'conn-1',
        webhookData: { secret },
        headers: { 'X-Flowrunner-Secret': secret },
        body: {
          scope: 'store/product/created',
          data: { id: 111 },
        },
      })

      expect(result.events[0].name).toBe('onProductCreated')
      expect(result.events[0].data).toMatchObject({
        eventType: 'store/product/created',
        productId: 111,
        product: { id: 111, name: 'Mug' },
      })
    })

    it('rejects delivery when secret does not match', async () => {
      const result = await service.handleTriggerResolveEvents({
        connectionId: 'conn-1',
        webhookData: { secret: 'correct-secret' },
        headers: { 'X-Flowrunner-Secret': 'wrong-secret' },
        body: { scope: 'store/order/created', data: { id: 100 } },
      })

      expect(result.events).toHaveLength(0)
    })

    it('rejects delivery when no body', async () => {
      const result = await service.handleTriggerResolveEvents({
        connectionId: 'conn-1',
      })

      expect(result.events).toHaveLength(0)
    })

    it('returns empty events for unknown scope', async () => {
      const secret = 'some-secret'
      const result = await service.handleTriggerResolveEvents({
        connectionId: 'conn-1',
        webhookData: { secret },
        headers: { 'X-Flowrunner-Secret': secret },
        body: { scope: 'store/unknown/event', data: { id: 1 } },
      })

      expect(result.events).toHaveLength(0)
    })

    it('handles detail fetch failure gracefully', async () => {
      mock.onGet(`${ V2 }/orders/999`).replyWithError({ message: 'Not found' })

      const secret = 'fail-secret'
      const result = await service.handleTriggerResolveEvents({
        connectionId: 'conn-1',
        webhookData: { secret },
        headers: { 'X-Flowrunner-Secret': secret },
        body: { scope: 'store/order/created', data: { id: 999 } },
      })

      expect(result.events).toHaveLength(1)
      expect(result.events[0].data).toMatchObject({ eventType: 'store/order/created', resourceId: 999 })
    })
  })

  describe('handleTriggerSelectMatched', () => {
    it('returns all trigger ids', async () => {
      const result = await service.handleTriggerSelectMatched({
        triggers: [{ id: 'a' }, { id: 'b' }],
      })

      expect(result).toEqual({ ids: ['a', 'b'] })
    })
  })

  describe('handleTriggerDeleteWebhook', () => {
    it('deletes all webhooks', async () => {
      mock.onDelete(`${ V3 }/hooks/501`).reply(undefined)
      mock.onDelete(`${ V3 }/hooks/502`).reply(undefined)

      const result = await service.handleTriggerDeleteWebhook({
        webhookData: {
          webhooks: [
            { hookId: 501, scope: 'store/order/created' },
            { hookId: 502, scope: 'store/product/created' },
          ],
        },
      })

      expect(mock.history).toHaveLength(2)
      expect(result).toEqual({ webhookData: {} })
    })

    it('skips webhooks without hookId', async () => {
      const result = await service.handleTriggerDeleteWebhook({
        webhookData: {
          webhooks: [{ hookId: null, scope: 'store/order/created' }],
        },
      })

      expect(mock.history).toHaveLength(0)
      expect(result).toEqual({ webhookData: {} })
    })

    it('handles delete failures gracefully', async () => {
      mock.onDelete(`${ V3 }/hooks/999`).replyWithError({ message: 'Not found' })

      const result = await service.handleTriggerDeleteWebhook({
        webhookData: {
          webhooks: [{ hookId: 999, scope: 'store/order/created' }],
        },
      })

      expect(result).toEqual({ webhookData: {} })
    })
  })

  // ── Error Handling ──

  describe('error handling', () => {
    it('throws on API error with hint for 401', async () => {
      mock.onGet(`${ V3 }/catalog/products/999`).replyWithError({
        message: 'Unauthorized',
        body: { status: 401, title: 'Unauthorized' },
      })

      await expect(service.getProduct(999)).rejects.toThrow('Authentication failed')
    })

    it('throws on API error with hint for 404', async () => {
      mock.onGet(`${ V3 }/catalog/products/999`).replyWithError({
        message: 'Not Found',
        body: { status: 404, title: 'Not Found' },
      })

      await expect(service.getProduct(999)).rejects.toThrow('Not found')
    })

    it('throws on API error with hint for 429', async () => {
      mock.onGet(`${ V3 }/catalog/products/999`).replyWithError({
        message: 'Rate limited',
        body: { status: 429, title: 'Rate limited' },
      })

      await expect(service.getProduct(999)).rejects.toThrow('Rate limit')
    })

    it('throws generic message for unknown errors', async () => {
      mock.onGet(`${ V3 }/catalog/products/999`).replyWithError({
        message: 'Server Error',
      })

      await expect(service.getProduct(999)).rejects.toThrow('Server Error')
    })

    it('throws when no access token', async () => {
      const originalRequest = service.request
      service.request = { headers: {} }

      await expect(service.getProduct(1)).rejects.toThrow('Access token is not available')

      service.request = originalRequest
    })
  })
})
