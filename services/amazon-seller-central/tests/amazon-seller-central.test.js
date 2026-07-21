'use strict'

const { createSandbox } = require('../../../service-sandbox')

const CLIENT_ID = 'amzn1.application-oa2-client.test123'
const CLIENT_SECRET = 'test-client-secret'
const APPLICATION_ID = 'amzn1.sp.solution.test-app-id'
const OAUTH_TOKEN = 'Atza|test-access-token'
const LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token'
const BASE_NA = 'https://sellingpartnerapi-na.amazon.com'
const DEFAULT_MARKETPLACE_NA = 'ATVPDKIKX0DER'

describe('Amazon Seller Central Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      applicationId: APPLICATION_ID,
      region: 'North America',
      draftApp: false,
    })

    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()

    // Simulate the FlowRunner runtime injecting the OAuth access token header
    service.request = { headers: { 'oauth-access-token': OAUTH_TOKEN } }
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
      const configs = sandbox.getConfigItems()

      expect(configs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'clientId', required: true, shared: true }),
          expect.objectContaining({ name: 'clientSecret', required: true, shared: true }),
          expect.objectContaining({ name: 'applicationId', required: true, shared: false }),
          expect.objectContaining({ name: 'region', required: true, shared: false, type: 'CHOICE' }),
          expect.objectContaining({ name: 'draftApp', required: false, shared: false, type: 'BOOL' }),
        ])
      )
    })
  })

  // ── OAuth ──

  describe('getOAuth2ConnectionURL', () => {
    it('returns consent URL for North America region', async () => {
      const url = await service.getOAuth2ConnectionURL()

      expect(url).toContain('https://sellercentral.amazon.com/apps/authorize/consent')
      expect(url).toContain(`application_id=${APPLICATION_ID}`)
      expect(url).toContain('state=flowrunner_')
      expect(url).not.toContain('version=beta')
    })
  })

  describe('executeCallback', () => {
    it('exchanges authorization code for token and fetches identity', async () => {
      mock.onPost(LWA_TOKEN_URL).reply({
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        expires_in: 3600,
      })

      mock.onGet(`${BASE_NA}/sellers/v1/marketplaceParticipations`).reply({
        payload: [{
          marketplace: { id: 'ATVPDKIKX0DER', countryCode: 'US', name: 'Amazon.com' },
          storeName: 'Test Store',
          participation: { isParticipating: true },
        }],
      })

      const result = await service.executeCallback({
        spapi_oauth_code: 'auth-code-123',
        selling_partner_id: 'SELLER123',
        redirectURI: 'https://flowrunner.com/callback',
      })

      expect(result).toMatchObject({
        token: 'new-access-token',
        refreshToken: 'new-refresh-token',
        expirationInSeconds: 3600,
        overwrite: true,
        connectionIdentityImageURL: null,
      })
      expect(result.connectionIdentityName).toBe('Test Store (US)')
      expect(result.userData).toEqual({ sellingPartnerId: 'SELLER123' })

      // Verify token request
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(LWA_TOKEN_URL)
      expect(mock.history[0].body).toContain('grant_type=authorization_code')
      expect(mock.history[0].body).toContain('code=auth-code-123')
      expect(mock.history[0].body).toContain(`client_id=${encodeURIComponent(CLIENT_ID)}`)
      expect(mock.history[0].body).toContain(`client_secret=${encodeURIComponent(CLIENT_SECRET)}`)
    })

    it('falls back to selling_partner_id when participations call fails', async () => {
      mock.onPost(LWA_TOKEN_URL).reply({
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        expires_in: 3600,
      })

      mock.onGet(`${BASE_NA}/sellers/v1/marketplaceParticipations`).replyWithError({
        message: 'Forbidden',
      })

      const result = await service.executeCallback({
        spapi_oauth_code: 'auth-code-123',
        selling_partner_id: 'SELLER123',
        redirectURI: 'https://flowrunner.com/callback',
      })

      expect(result.connectionIdentityName).toBe('Amazon Seller (SELLER123)')
    })

    it('throws when no authorization code is provided', async () => {
      await expect(service.executeCallback({})).rejects.toThrow('spapi_oauth_code')
    })

    it('accepts legacy code parameter', async () => {
      mock.onPost(LWA_TOKEN_URL).reply({
        access_token: 'tok',
        refresh_token: 'ref',
        expires_in: 3600,
      })

      mock.onGet(`${BASE_NA}/sellers/v1/marketplaceParticipations`).reply({ payload: [] })

      const result = await service.executeCallback({
        code: 'legacy-code',
        redirectURI: 'https://flowrunner.com/callback',
      })

      expect(result.token).toBe('tok')
      expect(mock.history[0].body).toContain('code=legacy-code')
    })

    it('uses default identity name when participations returns empty payload', async () => {
      mock.onPost(LWA_TOKEN_URL).reply({
        access_token: 'tok',
        refresh_token: 'ref',
        expires_in: 3600,
      })

      mock.onGet(`${BASE_NA}/sellers/v1/marketplaceParticipations`).reply({ payload: [] })

      const result = await service.executeCallback({
        spapi_oauth_code: 'auth-code',
        redirectURI: 'https://flowrunner.com/callback',
      })

      expect(result.connectionIdentityName).toBe('Amazon Seller')
    })

    it('builds identity from country when storeName is absent', async () => {
      mock.onPost(LWA_TOKEN_URL).reply({
        access_token: 'tok',
        refresh_token: 'ref',
        expires_in: 3600,
      })

      mock.onGet(`${BASE_NA}/sellers/v1/marketplaceParticipations`).reply({
        payload: [{
          marketplace: { id: 'ATVPDKIKX0DER', countryCode: 'US' },
          participation: { isParticipating: true },
        }],
      })

      const result = await service.executeCallback({
        spapi_oauth_code: 'auth-code',
        redirectURI: 'https://flowrunner.com/callback',
      })

      expect(result.connectionIdentityName).toBe('Amazon Seller (US)')
    })
  })

  describe('refreshToken', () => {
    it('refreshes the access token', async () => {
      mock.onPost(LWA_TOKEN_URL).reply({
        access_token: 'refreshed-token',
        expires_in: 3600,
        refresh_token: 'new-refresh',
      })

      const result = await service.refreshToken('old-refresh-token')

      expect(result).toEqual({
        token: 'refreshed-token',
        expirationInSeconds: 3600,
        refreshToken: 'new-refresh',
      })

      expect(mock.history[0].body).toContain('grant_type=refresh_token')
      expect(mock.history[0].body).toContain('refresh_token=old-refresh-token')
    })

    it('keeps original refresh token when LWA does not rotate it', async () => {
      mock.onPost(LWA_TOKEN_URL).reply({
        access_token: 'refreshed-token',
        expires_in: 3600,
      })

      const result = await service.refreshToken('original-refresh')

      expect(result.refreshToken).toBe('original-refresh')
    })

    it('throws descriptive error on invalid_grant', async () => {
      mock.onPost(LWA_TOKEN_URL).replyWithError({
        message: 'Bad Request',
        body: { error: 'invalid_grant', error_description: 'Token expired' },
      })

      await expect(service.refreshToken('expired-token')).rejects.toThrow('re-authenticate')
    })
  })

  // ── Dictionaries ──

  describe('getMarketplacesDictionary', () => {
    it('returns all marketplaces with connected region first', async () => {
      const result = await service.getMarketplacesDictionary({})

      expect(result.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ value: 'ATVPDKIKX0DER', note: 'North America' }),
        ])
      )

      // North America marketplaces should come first
      const firstFour = result.items.slice(0, 4).map(i => i.note)
      expect(firstFour.every(r => r === 'North America')).toBe(true)
    })

    it('filters by search term', async () => {
      const result = await service.getMarketplacesDictionary({ search: 'japan' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('A1VC38T7YXB528')
    })

    it('filters by marketplace id', async () => {
      const result = await service.getMarketplacesDictionary({ search: 'ATVPDKIKX0DER' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toMatchObject({
        label: 'United States (ATVPDKIKX0DER)',
        value: 'ATVPDKIKX0DER',
      })
    })

    it('returns all when search is empty', async () => {
      const result = await service.getMarketplacesDictionary({})

      expect(result.items.length).toBe(16)
    })

    it('handles null payload', async () => {
      const result = await service.getMarketplacesDictionary(null)

      expect(result.items.length).toBe(16)
    })
  })

  describe('getReportTypesDictionary', () => {
    it('returns all common report types', async () => {
      const result = await service.getReportTypesDictionary({})

      expect(result.items.length).toBe(8)
      expect(result.items[0]).toHaveProperty('label')
      expect(result.items[0]).toHaveProperty('value')
      expect(result.items[0]).toHaveProperty('note')
    })

    it('filters by search term', async () => {
      const result = await service.getReportTypesDictionary({ search: 'FBA' })

      expect(result.items.length).toBeGreaterThanOrEqual(2)
      result.items.forEach(item => {
        const combined = (item.label + item.value).toLowerCase()
        expect(combined).toContain('fba')
      })
    })

    it('returns empty when nothing matches', async () => {
      const result = await service.getReportTypesDictionary({ search: 'nonexistent_xyz' })

      expect(result.items).toHaveLength(0)
    })
  })

  // ── Sellers ──

  describe('getMarketplaceParticipations', () => {
    it('sends GET to the correct URL with auth headers', async () => {
      const payload = { payload: [{ marketplace: { id: DEFAULT_MARKETPLACE_NA } }] }
      mock.onGet(`${BASE_NA}/sellers/v1/marketplaceParticipations`).reply(payload)

      const result = await service.getMarketplaceParticipations()

      expect(result).toEqual(payload)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({
        'x-amz-access-token': OAUTH_TOKEN,
        'Content-Type': 'application/json',
      })
    })

    it('throws on API error', async () => {
      mock.onGet(`${BASE_NA}/sellers/v1/marketplaceParticipations`).replyWithError({
        message: 'Forbidden',
        body: { errors: [{ code: 'Unauthorized', message: 'Access denied' }] },
      })

      await expect(service.getMarketplaceParticipations()).rejects.toThrow('Amazon SP-API error')
    })
  })

  // ── Orders ──

  describe('listOrders', () => {
    const ordersUrl = `${BASE_NA}/orders/v0/orders`

    it('sends correct request with defaults (30 day lookback)', async () => {
      const response = { payload: { Orders: [{ AmazonOrderId: '123' }], NextToken: null } }
      mock.onGet(ordersUrl).reply(response)

      const result = await service.listOrders()

      expect(result).toEqual(response)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].query.MarketplaceIds).toBe(DEFAULT_MARKETPLACE_NA)
      expect(mock.history[0].query.CreatedAfter).toBeDefined()
    })

    it('passes custom parameters', async () => {
      mock.onGet(ordersUrl).reply({ payload: { Orders: [{ id: 1 }] } })

      await service.listOrders(
        ['ATVPDKIKX0DER'],
        '2026-01-01T00:00:00Z',
        '2026-01-31T00:00:00Z',
        undefined,
        ['Unshipped', 'Shipped'],
        ['Amazon (AFN)'],
        50
      )

      expect(mock.history[0].query).toMatchObject({
        MarketplaceIds: 'ATVPDKIKX0DER',
        CreatedAfter: '2026-01-01T00:00:00Z',
        CreatedBefore: '2026-01-31T00:00:00Z',
        OrderStatuses: 'Unshipped,Shipped',
        FulfillmentChannels: 'AFN',
        MaxResultsPerPage: 50,
      })
    })

    it('resolves human-readable status labels to API values', async () => {
      mock.onGet(ordersUrl).reply({ payload: { Orders: [{ id: 1 }] } })

      await service.listOrders(undefined, '2026-01-01T00:00:00Z', undefined, undefined, ['Partially Shipped'])

      expect(mock.history[0].query.OrderStatuses).toBe('PartiallyShipped')
    })

    it('resolves fulfillment channel labels to API values', async () => {
      mock.onGet(ordersUrl).reply({ payload: { Orders: [{ id: 1 }] } })

      await service.listOrders(undefined, '2026-01-01T00:00:00Z', undefined, undefined, undefined, ['Merchant (MFN)'])

      expect(mock.history[0].query.FulfillmentChannels).toBe('MFN')
    })

    it('passes nextToken and skips default date filter', async () => {
      mock.onGet(ordersUrl).reply({ payload: { Orders: [{ id: 1 }] } })

      await service.listOrders(undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'page2token')

      expect(mock.history[0].query.NextToken).toBe('page2token')
    })

    it('uses lastUpdatedAfter instead of createdAfter', async () => {
      mock.onGet(ordersUrl).reply({ payload: { Orders: [{ id: 1 }] } })

      await service.listOrders(undefined, undefined, undefined, '2026-06-01T00:00:00Z')

      expect(mock.history[0].query.LastUpdatedAfter).toBe('2026-06-01T00:00:00Z')
    })

    it('throws when both createdAfter and lastUpdatedAfter are set', async () => {
      await expect(
        service.listOrders(undefined, '2026-01-01T00:00:00Z', undefined, '2026-01-01T00:00:00Z')
      ).rejects.toThrow('cannot be used together')
    })
  })

  describe('getOrder', () => {
    it('sends GET to the correct URL', async () => {
      const orderId = '902-3159896-1390916'
      const response = { payload: { AmazonOrderId: orderId, OrderStatus: 'Shipped' } }
      mock.onGet(`${BASE_NA}/orders/v0/orders/${orderId}`).reply(response)

      const result = await service.getOrder(orderId)

      expect(result).toEqual(response)
      expect(mock.history[0].url).toBe(`${BASE_NA}/orders/v0/orders/${orderId}`)
    })

    it('throws when orderId is missing', async () => {
      await expect(service.getOrder()).rejects.toThrow('"Order ID" is required')
    })
  })

  describe('listOrderItems', () => {
    it('sends GET to the correct URL with order id', async () => {
      const orderId = '902-3159896-1390916'
      const response = { payload: { OrderItems: [{ OrderItemId: '123' }] } }
      mock.onGet(`${BASE_NA}/orders/v0/orders/${orderId}/orderItems`).reply(response)

      const result = await service.listOrderItems(orderId)

      expect(result).toEqual(response)
    })

    it('passes nextToken', async () => {
      const orderId = '902-3159896-1390916'
      mock.onGet(`${BASE_NA}/orders/v0/orders/${orderId}/orderItems`).reply({ payload: { OrderItems: [{ id: 1 }] } })

      await service.listOrderItems(orderId, 'next-page')

      expect(mock.history[0].query).toMatchObject({ NextToken: 'next-page' })
    })

    it('throws when orderId is missing', async () => {
      await expect(service.listOrderItems()).rejects.toThrow('"Order ID" is required')
    })
  })

  describe('confirmShipment', () => {
    it('sends POST with correct body', async () => {
      const orderId = '902-3159896-1390916'
      mock.onPost(`${BASE_NA}/orders/v0/orders/${orderId}/shipmentConfirmation`).reply('')

      const result = await service.confirmShipment(
        orderId,
        '1',
        'UPS',
        '1Z999AA10123456784',
        '2026-01-06T08:00:00Z',
        [{ orderItemId: 'item-1', quantity: 2 }],
        undefined,
        undefined,
        'Ground'
      )

      expect(result).toEqual({ status: 'success' })
      expect(mock.history[0].body).toMatchObject({
        marketplaceId: DEFAULT_MARKETPLACE_NA,
        packageDetail: expect.objectContaining({
          packageReferenceId: '1',
          carrierCode: 'UPS',
          trackingNumber: '1Z999AA10123456784',
          shipDate: '2026-01-06T08:00:00Z',
          shippingMethod: 'Ground',
          orderItems: [{ orderItemId: 'item-1', quantity: 2 }],
        }),
      })
    })

    it('includes carrierName when provided', async () => {
      const orderId = '902-3159896-1390916'
      mock.onPost(`${BASE_NA}/orders/v0/orders/${orderId}/shipmentConfirmation`).reply('')

      await service.confirmShipment(
        orderId, '1', 'Other', '123', '2026-01-06T08:00:00Z',
        [{ orderItemId: 'item-1', quantity: 1 }],
        undefined, 'My Custom Carrier'
      )

      expect(mock.history[0].body.packageDetail.carrierName).toBe('My Custom Carrier')
    })

    it('throws when orderId is missing', async () => {
      await expect(service.confirmShipment()).rejects.toThrow('"Order ID" is required')
    })

    it('throws when no order items provided', async () => {
      await expect(
        service.confirmShipment('902-3159896-1390916', '1', 'UPS', '1Z999', '2026-01-06T08:00:00Z', [])
      ).rejects.toThrow('At least one order item is required')
    })
  })

  // ── Catalog ──

  describe('searchCatalogItems', () => {
    const catalogUrl = `${BASE_NA}/catalog/2022-04-01/items`

    it('searches by keywords with defaults', async () => {
      const response = { numberOfResults: 1, items: [{ asin: 'B08XYZ1234' }] }
      mock.onGet(catalogUrl).reply(response)

      const result = await service.searchCatalogItems(['wireless', 'earbuds'])

      expect(result).toEqual(response)
      expect(mock.history[0].query).toMatchObject({
        marketplaceIds: DEFAULT_MARKETPLACE_NA,
        keywords: 'wireless,earbuds',
      })
    })

    it('searches by identifiers', async () => {
      mock.onGet(catalogUrl).reply({ numberOfResults: 2, items: [{ asin: 'B08' }] })

      await service.searchCatalogItems(undefined, ['B08XYZ1234', 'B09ABC5678'], 'ASIN')

      expect(mock.history[0].query).toMatchObject({
        identifiers: 'B08XYZ1234,B09ABC5678',
        identifiersType: 'ASIN',
      })
    })

    it('resolves included data labels to API values', async () => {
      mock.onGet(catalogUrl).reply({ numberOfResults: 0, items: [] })

      await service.searchCatalogItems(['test'], undefined, undefined, undefined, ['Summaries', 'Images', 'Sales Ranks'])

      expect(mock.history[0].query.includedData).toBe('summaries,images,salesRanks')
    })

    it('passes sellerId and pageSize for SKU lookup', async () => {
      mock.onGet(catalogUrl).reply({ numberOfResults: 1, items: [{ asin: 'B123' }] })

      await service.searchCatalogItems(undefined, ['MY-SKU'], 'SKU', undefined, undefined, 'SELLER123', 5)

      expect(mock.history[0].query).toMatchObject({
        sellerId: 'SELLER123',
        pageSize: 5,
      })
    })

    it('passes pageToken for pagination', async () => {
      mock.onGet(catalogUrl).reply({ numberOfResults: 0, items: [] })

      await service.searchCatalogItems(['test'], undefined, undefined, undefined, undefined, undefined, undefined, 'page2tok')

      expect(mock.history[0].query.pageToken).toBe('page2tok')
    })

    it('throws when neither keywords nor identifiers provided', async () => {
      await expect(service.searchCatalogItems()).rejects.toThrow('Either "Keywords" or "Identifiers"')
    })

    it('throws when both keywords and identifiers provided', async () => {
      await expect(
        service.searchCatalogItems(['test'], ['B08XYZ1234'], 'ASIN')
      ).rejects.toThrow('cannot be used together')
    })

    it('throws when identifiers provided without identifiersType', async () => {
      await expect(
        service.searchCatalogItems(undefined, ['B08XYZ1234'])
      ).rejects.toThrow('"Identifiers Type" is required')
    })

    it('throws when SKU identifiers without sellerId', async () => {
      await expect(
        service.searchCatalogItems(undefined, ['MY-SKU'], 'SKU')
      ).rejects.toThrow('"Seller ID" is required')
    })
  })

  describe('getCatalogItem', () => {
    it('sends GET to the correct URL', async () => {
      const asin = 'B08XYZ1234'
      const response = { asin, summaries: [{ itemName: 'Widget' }] }
      mock.onGet(`${BASE_NA}/catalog/2022-04-01/items/${asin}`).reply(response)

      const result = await service.getCatalogItem(asin)

      expect(result).toEqual(response)
      expect(mock.history[0].query.marketplaceIds).toBe(DEFAULT_MARKETPLACE_NA)
    })

    it('resolves included data and marketplace ids', async () => {
      mock.onGet(`${BASE_NA}/catalog/2022-04-01/items/B08XYZ1234`).reply({ asin: 'B08XYZ1234' })

      await service.getCatalogItem('B08XYZ1234', ['A2EUQ1WTGCTBG2'], ['Attributes', 'Dimensions'])

      expect(mock.history[0].query).toMatchObject({
        marketplaceIds: 'A2EUQ1WTGCTBG2',
        includedData: 'attributes,dimensions',
      })
    })

    it('throws when ASIN is missing', async () => {
      await expect(service.getCatalogItem()).rejects.toThrow('"ASIN" is required')
    })
  })

  // ── Listings ──

  describe('getListingsItem', () => {
    it('sends GET to the correct URL', async () => {
      const url = `${BASE_NA}/listings/2021-08-01/items/SELLER123/WIDGET-001`
      mock.onGet(url).reply({ sku: 'WIDGET-001', summaries: [{ status: ['BUYABLE'] }] })

      const result = await service.getListingsItem('SELLER123', 'WIDGET-001')

      expect(result).toMatchObject({ sku: 'WIDGET-001' })
      expect(mock.history[0].query.marketplaceIds).toBe(DEFAULT_MARKETPLACE_NA)
    })

    it('resolves included data labels', async () => {
      const url = `${BASE_NA}/listings/2021-08-01/items/SELLER123/WIDGET-001`
      mock.onGet(url).reply({ sku: 'WIDGET-001' })

      await service.getListingsItem('SELLER123', 'WIDGET-001', undefined, ['Offers', 'Fulfillment Availability'])

      expect(mock.history[0].query.includedData).toBe('offers,fulfillmentAvailability')
    })

    it('throws when sellerId is missing', async () => {
      await expect(service.getListingsItem(undefined, 'SKU')).rejects.toThrow('"Seller ID" is required')
    })

    it('throws when sku is missing', async () => {
      await expect(service.getListingsItem('SELLER123')).rejects.toThrow('"SKU" is required')
    })
  })

  describe('putListingsItem', () => {
    it('sends PUT with correct body', async () => {
      const url = `${BASE_NA}/listings/2021-08-01/items/SELLER123/WIDGET-001`
      const response = { sku: 'WIDGET-001', status: 'ACCEPTED' }
      mock.onPut(url).reply(response)

      const attrs = { item_name: [{ value: 'Widget', marketplace_id: DEFAULT_MARKETPLACE_NA }] }
      const result = await service.putListingsItem('SELLER123', 'WIDGET-001', 'HOME_ORGANIZER', attrs)

      expect(result).toEqual(response)
      expect(mock.history[0].body).toMatchObject({
        productType: 'HOME_ORGANIZER',
        attributes: attrs,
      })
    })

    it('resolves requirements label to API value', async () => {
      const url = `${BASE_NA}/listings/2021-08-01/items/SELLER123/SKU1`
      mock.onPut(url).reply({ status: 'ACCEPTED' })

      await service.putListingsItem('SELLER123', 'SKU1', 'LUGGAGE', { a: 1 }, undefined, 'Offer Only')

      expect(mock.history[0].body.requirements).toBe('LISTING_OFFER_ONLY')
    })

    it('resolves Full Listing requirements label', async () => {
      const url = `${BASE_NA}/listings/2021-08-01/items/SELLER123/SKU1`
      mock.onPut(url).reply({ status: 'ACCEPTED' })

      await service.putListingsItem('SELLER123', 'SKU1', 'LUGGAGE', { a: 1 }, undefined, 'Full Listing')

      expect(mock.history[0].body.requirements).toBe('LISTING')
    })

    it('throws when productType is missing', async () => {
      await expect(
        service.putListingsItem('SELLER123', 'SKU1', undefined, { a: 1 })
      ).rejects.toThrow('"Product Type" is required')
    })

    it('throws when attributes is missing', async () => {
      await expect(
        service.putListingsItem('SELLER123', 'SKU1', 'TYPE')
      ).rejects.toThrow('"Attributes" is required')
    })

    it('throws when attributes is not an object', async () => {
      await expect(
        service.putListingsItem('SELLER123', 'SKU1', 'TYPE', 'not-an-object')
      ).rejects.toThrow('"Attributes" is required')
    })
  })

  describe('patchListingsItem', () => {
    it('sends PATCH with correct body and lowercases op', async () => {
      const url = `${BASE_NA}/listings/2021-08-01/items/SELLER123/WIDGET-001`
      mock.onPatch(url).reply({ status: 'ACCEPTED' })

      const patches = [{ op: 'REPLACE', path: '/attributes/fulfillment_availability', value: [{ quantity: 25 }] }]
      await service.patchListingsItem('SELLER123', 'WIDGET-001', 'HOME_ORGANIZER', patches)

      expect(mock.history[0].body).toMatchObject({
        productType: 'HOME_ORGANIZER',
        patches: [{ op: 'replace', path: '/attributes/fulfillment_availability', value: [{ quantity: 25 }] }],
      })
    })

    it('throws when productType is missing', async () => {
      await expect(
        service.patchListingsItem('SELLER123', 'SKU1', undefined, [{ op: 'add' }])
      ).rejects.toThrow('"Product Type" is required')
    })

    it('throws when patches is empty', async () => {
      await expect(
        service.patchListingsItem('SELLER123', 'SKU1', 'TYPE', [])
      ).rejects.toThrow('At least one patch operation is required')
    })

    it('throws when sellerId is missing', async () => {
      await expect(
        service.patchListingsItem(undefined, 'SKU1', 'TYPE', [{ op: 'add' }])
      ).rejects.toThrow('"Seller ID" is required')
    })
  })

  describe('deleteListingsItem', () => {
    it('sends DELETE to the correct URL', async () => {
      const url = `${BASE_NA}/listings/2021-08-01/items/SELLER123/WIDGET-001`
      mock.onDelete(url).reply({ status: 'ACCEPTED' })

      const result = await service.deleteListingsItem('SELLER123', 'WIDGET-001')

      expect(result).toEqual({ status: 'ACCEPTED' })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].query.marketplaceIds).toBe(DEFAULT_MARKETPLACE_NA)
    })

    it('throws when sellerId is missing', async () => {
      await expect(service.deleteListingsItem()).rejects.toThrow('"Seller ID" is required')
    })

    it('throws when sku is missing', async () => {
      await expect(service.deleteListingsItem('SELLER123')).rejects.toThrow('"SKU" is required')
    })
  })

  // ── Inventory ──

  describe('getInventorySummaries', () => {
    const inventoryUrl = `${BASE_NA}/fba/inventory/v1/summaries`

    it('sends GET with correct default query', async () => {
      const response = { payload: { inventorySummaries: [{ sellerSku: 'SKU1' }] } }
      mock.onGet(inventoryUrl).reply(response)

      const result = await service.getInventorySummaries()

      expect(result).toEqual(response)
      expect(mock.history[0].query).toMatchObject({
        granularityType: 'Marketplace',
        granularityId: DEFAULT_MARKETPLACE_NA,
        marketplaceIds: DEFAULT_MARKETPLACE_NA,
      })
    })

    it('passes details flag as string true', async () => {
      mock.onGet(inventoryUrl).reply({ payload: { inventorySummaries: [{ sellerSku: 'SKU1' }] } })

      await service.getInventorySummaries(undefined, true, ['SKU1', 'SKU2'])

      expect(mock.history[0].query).toMatchObject({
        details: 'true',
        sellerSkus: 'SKU1,SKU2',
      })
    })

    it('omits details when false', async () => {
      mock.onGet(inventoryUrl).reply({ payload: { inventorySummaries: [{ sellerSku: 'SKU1' }] } })

      await service.getInventorySummaries(undefined, false)

      expect(mock.history[0].query.details).toBeUndefined()
    })

    it('passes startDateTime and nextToken', async () => {
      mock.onGet(inventoryUrl).reply({ payload: { inventorySummaries: [{ sellerSku: 'SKU1' }] } })

      await service.getInventorySummaries(undefined, false, undefined, '2026-01-01T00:00:00Z', 'tok123')

      expect(mock.history[0].query).toMatchObject({
        startDateTime: '2026-01-01T00:00:00Z',
        nextToken: 'tok123',
      })
    })
  })

  // ── Reports ──

  describe('createReport', () => {
    const reportsUrl = `${BASE_NA}/reports/2021-06-30/reports`

    it('sends POST with correct body', async () => {
      mock.onPost(reportsUrl).reply({ reportId: 'ID323' })

      const result = await service.createReport('GET_MERCHANT_LISTINGS_ALL_DATA')

      expect(result).toEqual({ reportId: 'ID323' })
      expect(mock.history[0].body).toMatchObject({
        reportType: 'GET_MERCHANT_LISTINGS_ALL_DATA',
        marketplaceIds: [DEFAULT_MARKETPLACE_NA],
      })
    })

    it('passes optional date range and options', async () => {
      mock.onPost(reportsUrl).reply({ reportId: 'ID324' })

      await service.createReport(
        'GET_SALES_AND_TRAFFIC_REPORT',
        ['ATVPDKIKX0DER'],
        '2026-01-01T00:00:00Z',
        '2026-01-31T00:00:00Z',
        { reportPeriod: 'WEEK' }
      )

      expect(mock.history[0].body).toMatchObject({
        reportType: 'GET_SALES_AND_TRAFFIC_REPORT',
        dataStartTime: '2026-01-01T00:00:00Z',
        dataEndTime: '2026-01-31T00:00:00Z',
        reportOptions: { reportPeriod: 'WEEK' },
      })
    })

    it('throws when reportType is missing', async () => {
      await expect(service.createReport()).rejects.toThrow('"Report Type" is required')
    })
  })

  describe('getReport', () => {
    it('sends GET to the correct URL', async () => {
      const response = { reportId: 'ID323', processingStatus: 'DONE' }
      mock.onGet(`${BASE_NA}/reports/2021-06-30/reports/ID323`).reply(response)

      const result = await service.getReport('ID323')

      expect(result).toEqual(response)
    })

    it('throws when reportId is missing', async () => {
      await expect(service.getReport()).rejects.toThrow('"Report ID" is required')
    })
  })

  describe('listReports', () => {
    const reportsUrl = `${BASE_NA}/reports/2021-06-30/reports`

    it('sends GET with report types', async () => {
      mock.onGet(reportsUrl).reply({ reports: [{ reportId: 'R1' }] })

      const result = await service.listReports(['GET_MERCHANT_LISTINGS_ALL_DATA'])

      expect(result).toMatchObject({ reports: [{ reportId: 'R1' }] })
      expect(mock.history[0].query).toMatchObject({
        reportTypes: 'GET_MERCHANT_LISTINGS_ALL_DATA',
      })
    })

    it('resolves processing status labels to API values', async () => {
      mock.onGet(reportsUrl).reply({ reports: [{ reportId: 'R1' }] })

      await service.listReports(['GET_MERCHANT_LISTINGS_ALL_DATA'], ['Done', 'In Progress'])

      expect(mock.history[0].query.processingStatuses).toBe('DONE,IN_PROGRESS')
    })

    it('passes date filters and pageSize', async () => {
      mock.onGet(reportsUrl).reply({ reports: [{ reportId: 'R1' }] })

      await service.listReports(
        ['GET_MERCHANT_LISTINGS_ALL_DATA'],
        undefined,
        '2026-01-01T00:00:00Z',
        '2026-06-01T00:00:00Z',
        25
      )

      expect(mock.history[0].query).toMatchObject({
        createdSince: '2026-01-01T00:00:00Z',
        createdUntil: '2026-06-01T00:00:00Z',
        pageSize: 25,
      })
    })

    it('uses only nextToken when provided, ignoring other filters', async () => {
      mock.onGet(reportsUrl).reply({ reports: [{ reportId: 'R1' }] })

      await service.listReports(undefined, undefined, undefined, undefined, undefined, 'next-tok')

      expect(mock.history[0].query).toEqual({ nextToken: 'next-tok' })
    })

    it('throws when reportTypes is missing and no nextToken', async () => {
      await expect(service.listReports()).rejects.toThrow('"Report Types" is required')
    })
  })

  describe('getReportDocument', () => {
    it('sends GET to the correct URL', async () => {
      const docId = 'amzn1.spdoc.1.4.na.ex4mple'
      const response = { reportDocumentId: docId, url: 'https://example.com/report.txt' }
      mock.onGet(`${BASE_NA}/reports/2021-06-30/documents/${docId}`).reply(response)

      const result = await service.getReportDocument(docId)

      expect(result).toEqual(response)
    })

    it('throws when reportDocumentId is missing', async () => {
      await expect(service.getReportDocument()).rejects.toThrow('"Report Document ID" is required')
    })
  })

  describe('downloadReportDocument', () => {
    it('downloads, decompresses GZIP content, and stores to file storage', async () => {
      const zlib = require('zlib')
      const docId = 'amzn1.spdoc.1.4.na.gzip'
      const rawContent = 'sku\tasin\tprice\nWIDGET-001\tB08XYZ1234\t49.99'
      const gzipped = zlib.gzipSync(Buffer.from(rawContent))

      mock.onGet(`${BASE_NA}/reports/2021-06-30/documents/${docId}`).reply({
        reportDocumentId: docId,
        url: 'https://d34o8swod1owfl.cloudfront.net/report.txt',
        compressionAlgorithm: 'GZIP',
      })

      mock.onGet('https://d34o8swod1owfl.cloudfront.net/report.txt').reply(gzipped)

      const uploadedUrl = 'https://files.flowrunner.com/flow/report.txt'
      service.flowrunner = {
        Files: {
          uploadFile: jest.fn().mockResolvedValue({ url: uploadedUrl }),
        },
      }

      const result = await service.downloadReportDocument(docId)

      expect(result).toMatchObject({
        url: uploadedUrl,
        compressionAlgorithm: 'GZIP',
        contentPreview: rawContent,
        previewTruncated: false,
      })
      expect(result.sizeInBytes).toBe(Buffer.from(rawContent).length)

      expect(service.flowrunner.Files.uploadFile).toHaveBeenCalledWith(
        expect.any(Buffer),
        expect.objectContaining({
          generateUrl: true,
          overwrite: true,
          scope: 'FLOW',
        })
      )
    })

    it('handles uncompressed content', async () => {
      const docId = 'amzn1.spdoc.uncompressed'
      const rawContent = 'sku\tasin\nSKU1\tB123'

      mock.onGet(`${BASE_NA}/reports/2021-06-30/documents/${docId}`).reply({
        reportDocumentId: docId,
        url: 'https://example.com/report.txt',
      })

      mock.onGet('https://example.com/report.txt').reply(Buffer.from(rawContent))

      service.flowrunner = {
        Files: {
          uploadFile: jest.fn().mockResolvedValue({ url: 'https://files.flowrunner.com/report.txt' }),
        },
      }

      const result = await service.downloadReportDocument(docId)

      expect(result.compressionAlgorithm).toBe('NONE')
      expect(result.contentPreview).toBe(rawContent)
    })

    it('respects custom fileOptions', async () => {
      const docId = 'amzn1.spdoc.custom'
      mock.onGet(`${BASE_NA}/reports/2021-06-30/documents/${docId}`).reply({
        reportDocumentId: docId,
        url: 'https://example.com/report.txt',
      })

      mock.onGet('https://example.com/report.txt').reply(Buffer.from('data'))

      service.flowrunner = {
        Files: {
          uploadFile: jest.fn().mockResolvedValue({ url: 'https://files.flowrunner.com/custom.txt' }),
        },
      }

      const result = await service.downloadReportDocument(docId, { scope: 'WORKSPACE', filename: 'custom.txt' })

      expect(service.flowrunner.Files.uploadFile).toHaveBeenCalledWith(
        expect.any(Buffer),
        expect.objectContaining({ scope: 'WORKSPACE', filename: 'custom.txt' })
      )
      expect(result.filename).toBe('custom.txt')
    })

    it('throws when document has no download URL', async () => {
      const docId = 'amzn1.spdoc.no-url'
      mock.onGet(`${BASE_NA}/reports/2021-06-30/documents/${docId}`).reply({
        reportDocumentId: docId,
      })

      service.flowrunner = { Files: { uploadFile: jest.fn() } }

      await expect(service.downloadReportDocument(docId)).rejects.toThrow('download URL')
    })

    it('throws when reportDocumentId is missing', async () => {
      await expect(service.downloadReportDocument()).rejects.toThrow('"Report Document ID" is required')
    })
  })

  // ── Finances ──

  describe('listFinancialEvents', () => {
    const url = `${BASE_NA}/finances/v0/financialEvents`

    it('sends GET with correct query parameters', async () => {
      const response = { payload: { FinancialEvents: { ShipmentEventList: [] } } }
      mock.onGet(url).reply(response)

      const result = await service.listFinancialEvents(
        '2026-01-01T00:00:00Z',
        '2026-01-31T00:00:00Z',
        50,
        'page2'
      )

      expect(result).toEqual(response)
      expect(mock.history[0].query).toMatchObject({
        PostedAfter: '2026-01-01T00:00:00Z',
        PostedBefore: '2026-01-31T00:00:00Z',
        MaxResultsPerPage: 50,
        NextToken: 'page2',
      })
    })

    it('sends request with no parameters', async () => {
      mock.onGet(url).reply({ payload: { FinancialEvents: { ShipmentEventList: [] } } })

      await service.listFinancialEvents()

      expect(mock.history).toHaveLength(1)
    })
  })

  describe('listFinancialEventGroups', () => {
    const url = `${BASE_NA}/finances/v0/financialEventGroups`

    it('sends GET with correct query parameters', async () => {
      const response = { payload: { FinancialEventGroupList: [{ id: 'G1' }] } }
      mock.onGet(url).reply(response)

      const result = await service.listFinancialEventGroups('2026-01-01T00:00:00Z', '2026-01-31T00:00:00Z', 25, 'tok')

      expect(result).toEqual(response)
      expect(mock.history[0].query).toMatchObject({
        FinancialEventGroupStartedAfter: '2026-01-01T00:00:00Z',
        FinancialEventGroupStartedBefore: '2026-01-31T00:00:00Z',
        MaxResultsPerPage: 25,
        NextToken: 'tok',
      })
    })
  })

  // ── Feeds ──

  describe('createFeedDocument', () => {
    it('sends POST with contentType', async () => {
      const url = `${BASE_NA}/feeds/2021-06-30/documents`
      mock.onPost(url).reply({ feedDocumentId: 'doc123', url: 'https://s3.amazonaws.com/upload' })

      const result = await service.createFeedDocument('application/json')

      expect(result).toMatchObject({ feedDocumentId: 'doc123' })
      expect(mock.history[0].body).toEqual({ contentType: 'application/json' })
    })

    it('throws when contentType is missing', async () => {
      await expect(service.createFeedDocument()).rejects.toThrow('"Content Type" is required')
    })
  })

  describe('uploadFeedContent', () => {
    it('uploads content to pre-signed URL', async () => {
      const uploadUrl = 'https://s3.amazonaws.com/upload'
      mock.onPut(uploadUrl).reply('ok')

      const result = await service.uploadFeedContent(uploadUrl, 'sku\tprice\nSKU1\t49.99', 'text/tab-separated-values; charset=UTF-8')

      expect(result).toEqual({ status: 'success' })
      expect(mock.history[0].headers).toMatchObject({
        'Content-Type': 'text/tab-separated-values; charset=UTF-8',
      })
      expect(mock.history[0].body).toBe('sku\tprice\nSKU1\t49.99')
    })

    it('uses default content type when not specified', async () => {
      const uploadUrl = 'https://s3.amazonaws.com/upload2'
      mock.onPut(uploadUrl).reply('ok')

      await service.uploadFeedContent(uploadUrl, 'data')

      expect(mock.history[0].headers['Content-Type']).toBe('text/tab-separated-values; charset=UTF-8')
    })

    it('throws when uploadUrl is missing', async () => {
      await expect(service.uploadFeedContent()).rejects.toThrow('"Upload URL" is required')
    })

    it('throws when content is empty string', async () => {
      await expect(service.uploadFeedContent('https://s3.amazonaws.com/upload', '')).rejects.toThrow('"Content" is required')
    })

    it('throws when content is null', async () => {
      await expect(service.uploadFeedContent('https://s3.amazonaws.com/upload', null)).rejects.toThrow('"Content" is required')
    })

    it('throws on upload failure', async () => {
      mock.onPut('https://s3.amazonaws.com/fail').replyWithError({ message: 'S3 error' })

      await expect(
        service.uploadFeedContent('https://s3.amazonaws.com/fail', 'data', 'text/plain')
      ).rejects.toThrow('Feed content upload failed')
    })
  })

  describe('createFeed', () => {
    const feedsUrl = `${BASE_NA}/feeds/2021-06-30/feeds`

    it('sends POST with resolved feed type from dropdown label', async () => {
      mock.onPost(feedsUrl).reply({ feedId: '3485934' })

      const result = await service.createFeed('JSON Listings Feed', undefined, 'doc123')

      expect(result).toEqual({ feedId: '3485934' })
      expect(mock.history[0].body).toMatchObject({
        feedType: 'JSON_LISTINGS_FEED',
        inputFeedDocumentId: 'doc123',
        marketplaceIds: [DEFAULT_MARKETPLACE_NA],
      })
    })

    it('resolves Inventory Loader feed type', async () => {
      mock.onPost(feedsUrl).reply({ feedId: '123' })

      await service.createFeed('Inventory Loader (Flat File)', undefined, 'doc456')

      expect(mock.history[0].body.feedType).toBe('POST_FLAT_FILE_INVLOADER_DATA')
    })

    it('uses feedTypeOverride when provided', async () => {
      mock.onPost(feedsUrl).reply({ feedId: '123' })

      await service.createFeed('JSON Listings Feed', 'POST_PRODUCT_PRICING_DATA', 'doc123')

      expect(mock.history[0].body.feedType).toBe('POST_PRODUCT_PRICING_DATA')
    })

    it('passes feedOptions when provided', async () => {
      mock.onPost(feedsUrl).reply({ feedId: '123' })

      await service.createFeed(undefined, 'CUSTOM_FEED', 'doc123', undefined, { key: 'val' })

      expect(mock.history[0].body.feedOptions).toEqual({ key: 'val' })
    })

    it('throws when neither feedType nor feedTypeOverride is provided', async () => {
      await expect(service.createFeed(undefined, undefined, 'doc123')).rejects.toThrow('Feed Type')
    })

    it('throws when inputFeedDocumentId is missing', async () => {
      await expect(service.createFeed('JSON Listings Feed')).rejects.toThrow('"Input Feed Document ID" is required')
    })
  })

  describe('getFeed', () => {
    it('sends GET to the correct URL', async () => {
      const response = { feedId: '3485934', processingStatus: 'DONE' }
      mock.onGet(`${BASE_NA}/feeds/2021-06-30/feeds/3485934`).reply(response)

      const result = await service.getFeed('3485934')

      expect(result).toEqual(response)
    })

    it('throws when feedId is missing', async () => {
      await expect(service.getFeed()).rejects.toThrow('"Feed ID" is required')
    })
  })

  // ── Error Handling ──

  describe('error extraction', () => {
    it('extracts SP-API error array with code and details', async () => {
      mock.onGet(`${BASE_NA}/orders/v0/orders/BAD`).replyWithError({
        message: 'Bad Request',
        body: {
          errors: [
            { code: 'InvalidInput', message: 'Order ID is invalid', details: 'bad format' },
          ],
        },
      })

      await expect(service.getOrder('BAD')).rejects.toThrow('[InvalidInput] Order ID is invalid (bad format)')
    })

    it('extracts multiple SP-API errors joined by semicolon', async () => {
      mock.onGet(`${BASE_NA}/orders/v0/orders/BAD2`).replyWithError({
        message: 'Bad Request',
        body: {
          errors: [
            { code: 'E1', message: 'First error' },
            { code: 'E2', message: 'Second error' },
          ],
        },
      })

      await expect(service.getOrder('BAD2')).rejects.toThrow('[E1] First error; [E2] Second error')
    })

    it('extracts error.body.message fallback', async () => {
      mock.onGet(`${BASE_NA}/sellers/v1/marketplaceParticipations`).replyWithError({
        message: 'outer message',
        body: { message: 'inner message' },
      })

      await expect(service.getMarketplaceParticipations()).rejects.toThrow('inner message')
    })

    it('falls back to error.message when no body', async () => {
      mock.onGet(`${BASE_NA}/sellers/v1/marketplaceParticipations`).replyWithError({
        message: 'Network error',
      })

      await expect(service.getMarketplaceParticipations()).rejects.toThrow('Network error')
    })

    it('returns { status: success } for empty object response (204 equivalent)', async () => {
      const orderId = '902-3159896-1390916'
      mock.onPost(`${BASE_NA}/orders/v0/orders/${orderId}/shipmentConfirmation`).reply({})

      const result = await service.confirmShipment(
        orderId, '1', 'UPS', '1Z999', '2026-01-06T08:00:00Z',
        [{ orderItemId: 'item-1', quantity: 1 }]
      )

      expect(result).toEqual({ status: 'success' })
    })

    it('returns { status: success } for empty string response', async () => {
      const orderId = '902-3159896-1390916'
      mock.onPost(`${BASE_NA}/orders/v0/orders/${orderId}/shipmentConfirmation`).reply('')

      const result = await service.confirmShipment(
        orderId, '1', 'UPS', '1Z999', '2026-01-06T08:00:00Z',
        [{ orderItemId: 'item-1', quantity: 1 }]
      )

      expect(result).toEqual({ status: 'success' })
    })

    it('returns { status: success } for null response', async () => {
      const orderId = '902-3159896-1390916'
      mock.onPost(`${BASE_NA}/orders/v0/orders/${orderId}/shipmentConfirmation`).reply(null)

      const result = await service.confirmShipment(
        orderId, '1', 'UPS', '1Z999', '2026-01-06T08:00:00Z',
        [{ orderItemId: 'item-1', quantity: 1 }]
      )

      expect(result).toEqual({ status: 'success' })
    })
  })
})

