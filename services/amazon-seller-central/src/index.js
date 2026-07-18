'use strict'

const zlib = require('zlib')

const LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token'

const PREVIEW_SIZE_BYTES = 50 * 1024

// SP-API regions. The Seller Central domain hosts the OAuth consent page; the API base
// serves all SP-API calls for sellers whose marketplaces belong to that region.
const REGIONS = {
  'North America': {
    sellerCentralUrl: 'https://sellercentral.amazon.com',
    apiBaseUrl: 'https://sellingpartnerapi-na.amazon.com',
    defaultMarketplaceId: 'ATVPDKIKX0DER',
  },
  'Europe': {
    sellerCentralUrl: 'https://sellercentral-europe.amazon.com',
    apiBaseUrl: 'https://sellingpartnerapi-eu.amazon.com',
    defaultMarketplaceId: 'A1F83G8C2ARO7P',
  },
  'Far East': {
    sellerCentralUrl: 'https://sellercentral.amazon.co.jp',
    apiBaseUrl: 'https://sellingpartnerapi-fe.amazon.com',
    defaultMarketplaceId: 'A1VC38T7YXB528',
  },
}

const DEFAULT_REGION = 'North America'

// Common Amazon marketplace ids. India is served by the Europe SP-API endpoint.
const MARKETPLACES = [
  { id: 'ATVPDKIKX0DER', country: 'United States', region: 'North America' },
  { id: 'A2EUQ1WTGCTBG2', country: 'Canada', region: 'North America' },
  { id: 'A1AM78C64UM0Y8', country: 'Mexico', region: 'North America' },
  { id: 'A2Q3Y263D00KWC', country: 'Brazil', region: 'North America' },
  { id: 'A1F83G8C2ARO7P', country: 'United Kingdom', region: 'Europe' },
  { id: 'A1PA6795UKMFR9', country: 'Germany', region: 'Europe' },
  { id: 'A13V1IB3VIYZZH', country: 'France', region: 'Europe' },
  { id: 'APJ6JRA9NG5V4', country: 'Italy', region: 'Europe' },
  { id: 'A1RKKUPIHCS9HS', country: 'Spain', region: 'Europe' },
  { id: 'A1805IZSGTT6HS', country: 'Netherlands', region: 'Europe' },
  { id: 'A2NODRKZP88ZB9', country: 'Sweden', region: 'Europe' },
  { id: 'A1C3SOZRARQ6R3', country: 'Poland', region: 'Europe' },
  { id: 'A21TJRUUN4KGV', country: 'India', region: 'Europe' },
  { id: 'A1VC38T7YXB528', country: 'Japan', region: 'Far East' },
  { id: 'A39IBJ37TRP1C6', country: 'Australia', region: 'Far East' },
  { id: 'A19VAU5U5O7RUS', country: 'Singapore', region: 'Far East' },
]

const ORDER_STATUS_OPTIONS = {
  'Pending': 'Pending',
  'Unshipped': 'Unshipped',
  'Partially Shipped': 'PartiallyShipped',
  'Shipped': 'Shipped',
  'Canceled': 'Canceled',
  'Unfulfillable': 'Unfulfillable',
  'Invoice Unconfirmed': 'InvoiceUnconfirmed',
  'Pending Availability': 'PendingAvailability',
}

const FULFILLMENT_CHANNEL_OPTIONS = {
  'Amazon (AFN)': 'AFN',
  'Merchant (MFN)': 'MFN',
}

const CATALOG_INCLUDED_DATA_OPTIONS = {
  'Summaries': 'summaries',
  'Attributes': 'attributes',
  'Classifications': 'classifications',
  'Dimensions': 'dimensions',
  'Identifiers': 'identifiers',
  'Images': 'images',
  'Product Types': 'productTypes',
  'Sales Ranks': 'salesRanks',
  'Relationships': 'relationships',
}

const LISTINGS_INCLUDED_DATA_OPTIONS = {
  'Summaries': 'summaries',
  'Attributes': 'attributes',
  'Issues': 'issues',
  'Offers': 'offers',
  'Fulfillment Availability': 'fulfillmentAvailability',
}

const LISTING_REQUIREMENTS_OPTIONS = {
  'Full Listing': 'LISTING',
  'Product Only': 'LISTING_PRODUCT_ONLY',
  'Offer Only': 'LISTING_OFFER_ONLY',
}

const PROCESSING_STATUS_OPTIONS = {
  'Cancelled': 'CANCELLED',
  'Done': 'DONE',
  'Fatal': 'FATAL',
  'In Progress': 'IN_PROGRESS',
  'In Queue': 'IN_QUEUE',
}

const FEED_TYPE_OPTIONS = {
  'Inventory Loader (Flat File)': 'POST_FLAT_FILE_INVLOADER_DATA',
  'JSON Listings Feed': 'JSON_LISTINGS_FEED',
}

// Common report types surfaced in the report types dictionary. Any other documented
// SP-API report type can be entered manually.
const COMMON_REPORT_TYPES = [
  { label: 'Open Listings (Flat File)', value: 'GET_FLAT_FILE_OPEN_LISTINGS_DATA', note: 'SKU, ASIN, price, quantity' },
  { label: 'All Listings Report', value: 'GET_MERCHANT_LISTINGS_ALL_DATA', note: 'Every listing, active and inactive' },
  { label: 'Inactive Listings Report', value: 'GET_MERCHANT_LISTINGS_INACTIVE_DATA', note: 'Inactive listings only' },
  { label: 'All Orders by Order Date (Flat File)', value: 'GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL', note: 'Orders within the date range' },
  { label: 'Sales and Traffic Business Report', value: 'GET_SALES_AND_TRAFFIC_REPORT', note: 'JSON; requires Brand Analytics role' },
  { label: 'FBA Inventory Planning Data', value: 'GET_FBA_INVENTORY_PLANNING_DATA', note: 'FBA inventory age and health' },
  { label: 'FBA Managed Inventory', value: 'GET_AFN_INVENTORY_DATA', note: 'Current FBA inventory levels' },
  { label: 'FBA Customer Returns', value: 'GET_FBA_FULFILLMENT_CUSTOMER_RETURNS_DATA', note: 'FBA returns within the date range' },
]

const logger = {
  info: (...args) => console.log('[Amazon Seller Central] info:', ...args),
  debug: (...args) => console.log('[Amazon Seller Central] debug:', ...args),
  error: (...args) => console.log('[Amazon Seller Central] error:', ...args),
  warn: (...args) => console.log('[Amazon Seller Central] warn:', ...args),
}

/**
 * @requireOAuth
 * @usesFileStorage
 * @integrationName Amazon Seller Central
 * @integrationIcon /icon.png
 **/
class AmazonSellerCentralService {
  constructor(config) {
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
    this.applicationId = config.applicationId
    this.region = REGIONS[config.region] ? config.region : DEFAULT_REGION
    this.draftApp = config.draftApp === true || config.draftApp === 'true'
  }

  #regionConfig() {
    return REGIONS[this.region]
  }

  #apiUrl(path) {
    return `${ this.#regionConfig().apiBaseUrl }${ path }`
  }

  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    if (query) {
      query = cleanupObject(query)
    }

    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=[${ JSON.stringify(query) }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'x-amz-access-token': this.request.headers['oauth-access-token'],
          'Content-Type': 'application/json',
        })
        .query(query || {})

      const response = body !== undefined ? await request.send(body) : await request

      // Several SP-API write endpoints (e.g. confirmShipment) return 204 No Content.
      return isEmptyResponse(response) ? { status: 'success' } : response
    } catch (error) {
      const message = this.#extractError(error)

      logger.error(`${ logTag } - failed: ${ message }`)

      throw new Error(`Amazon SP-API error: ${ message }`)
    }
  }

  // SP-API errors are shaped as { errors: [{ code, message, details }] }.
  // The LWA auth server returns { error, error_description }.
  #extractError(error) {
    const body = error.body

    if (body) {
      if (Array.isArray(body.errors) && body.errors.length) {
        return body.errors
          .map(err => {
            const code = err.code ? `[${ err.code }] ` : ''
            const details = err.details ? ` (${ err.details })` : ''

            return `${ code }${ err.message || 'Request failed' }${ details }`
          })
          .join('; ')
      }

      if (body.error_description) {
        return body.error_description
      }

      if (typeof body.error === 'string') {
        return body.error
      }

      if (body.message) {
        return body.message
      }
    }

    return error.message
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  #resolveChoices(values, mapping) {
    const list = (Array.isArray(values) ? values : (values ? [values] : [])).filter(Boolean)

    return list.map(value => this.#resolveChoice(value, mapping))
  }

  // Normalizes a marketplace ids input (array or comma-separated string) and falls back
  // to the connected region's primary marketplace when nothing is provided.
  #resolveMarketplaceIds(marketplaceIds) {
    const list = (Array.isArray(marketplaceIds) ? marketplaceIds : (marketplaceIds ? String(marketplaceIds).split(',') : []))
      .map(id => String(id).trim())
      .filter(Boolean)

    return list.length ? list : [this.#regionConfig().defaultMarketplaceId]
  }

  #toList(value) {
    return (Array.isArray(value) ? value : (value ? String(value).split(',') : []))
      .map(item => String(item).trim())
      .filter(Boolean)
  }

  // ============================================= OAUTH ================================================

  /**
   * @registerAs SYSTEM
   * @route GET /getOAuth2ConnectionURL
   * @returns {String}
   */
  async getOAuth2ConnectionURL() {
    if (!this.applicationId) {
      throw new Error('The "Application ID" config item is required to build the Amazon consent URL')
    }

    const params = new URLSearchParams()

    params.append('application_id', this.applicationId)
    params.append('state', `flowrunner_${ Date.now() }`)

    // Draft (unpublished) SP-API applications require version=beta on the consent URL.
    if (this.draftApp) {
      params.append('version', 'beta')
    }

    const connectionURL = `${ this.#regionConfig().sellerCentralUrl }/apps/authorize/consent?${ params.toString() }`

    logger.debug(`composed connectionURL: ${ connectionURL }`)

    return connectionURL
  }

  /**
   * @typedef {Object} executeCallback_ResultObject
   *
   * @property {String} token
   * @property {String} [refreshToken]
   * @property {Number} [expirationInSeconds]
   * @property {Object} [userData]
   * @property {Boolean} [overwrite]
   * @property {String} connectionIdentityName
   * @property {String} [connectionIdentityImageURL]
   */

  /**
   * @registerAs SYSTEM
   * @route POST /executeCallback
   * @param {Object} callbackObject
   * @returns {executeCallback_ResultObject}
   */
  async executeCallback(callbackObject) {
    // Amazon's website authorization workflow returns the LWA authorization code as
    // "spapi_oauth_code" (not "code") and includes the seller's "selling_partner_id".
    const code = callbackObject.spapi_oauth_code || callbackObject.code
    const sellingPartnerId = callbackObject.selling_partner_id || null

    if (!code) {
      throw new Error('The Amazon callback did not include an "spapi_oauth_code" authorization code')
    }

    const params = new URLSearchParams()

    params.append('grant_type', 'authorization_code')
    params.append('code', code)
    params.append('redirect_uri', callbackObject.redirectURI)
    params.append('client_id', this.clientId)
    params.append('client_secret', this.clientSecret)

    const tokenResponse = await Flowrunner.Request.post(LWA_TOKEN_URL)
      .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
      .send(params.toString())

    let connectionIdentityName = 'Amazon Seller'

    try {
      const participations = await Flowrunner.Request
        .get(this.#apiUrl('/sellers/v1/marketplaceParticipations'))
        .set({ 'x-amz-access-token': tokenResponse.access_token })

      const first = Array.isArray(participations?.payload) ? participations.payload[0] : null

      if (first) {
        const country = first.marketplace?.countryCode || first.marketplace?.name

        connectionIdentityName = first.storeName
          ? `${ first.storeName }${ country ? ` (${ country })` : '' }`
          : (country ? `Amazon Seller (${ country })` : connectionIdentityName)
      }
    } catch (error) {
      logger.error(`[executeCallback] marketplaceParticipations error: ${ error.message }`)

      if (sellingPartnerId) {
        connectionIdentityName = `Amazon Seller (${ sellingPartnerId })`
      }
    }

    return {
      token: tokenResponse.access_token,
      expirationInSeconds: tokenResponse.expires_in,
      refreshToken: tokenResponse.refresh_token,
      connectionIdentityName,
      connectionIdentityImageURL: null,
      overwrite: true,
      userData: { sellingPartnerId },
    }
  }

  /**
   * @typedef {Object} refreshToken_ResultObject
   *
   * @property {String} token
   * @property {Number} [expirationInSeconds]
   * @property {String} [refreshToken]
   */

  /**
   * @registerAs SYSTEM
   * @route PUT /refreshToken
   * @param {String} refreshToken
   * @returns {refreshToken_ResultObject}
   */
  async refreshToken(refreshToken) {
    try {
      const params = new URLSearchParams()

      params.append('grant_type', 'refresh_token')
      params.append('refresh_token', refreshToken)
      params.append('client_id', this.clientId)
      params.append('client_secret', this.clientSecret)

      const { access_token, expires_in, refresh_token } = await Flowrunner.Request.post(LWA_TOKEN_URL)
        .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        .send(params.toString())

      return {
        token: access_token,
        expirationInSeconds: expires_in,
        // LWA refresh tokens are long-lived and are not rotated on refresh.
        refreshToken: refresh_token || refreshToken,
      }
    } catch (error) {
      logger.error(`refreshToken error: ${ error.message }`)

      if (error.body?.error === 'invalid_grant') {
        throw new Error('Refresh token expired or invalid, please re-authenticate.')
      }

      throw error
    }
  }

  // ========================================== DICTIONARIES ===========================================

  /**
   * @typedef {Object} DictionaryItem
   * @property {String} label
   * @property {any} value
   * @property {String} note
   */

  /**
   * @typedef {Object} DictionaryResponse
   * @property {Array<DictionaryItem>} items
   * @property {String} cursor
   */

  /**
   * @typedef {Object} getMarketplacesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter marketplaces by country name or marketplace id."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Not used; the full marketplace list is returned in one page."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Marketplaces Dictionary
   * @description Lists the common Amazon marketplace ids (United States, Canada, Mexico, Brazil, UK, Germany, France, Italy, Spain, Netherlands, Sweden, Poland, India, Japan, Australia, Singapore) for selection in marketplace parameters. The connected region's marketplaces are listed first. Returns the country name with the marketplace id as the label and the marketplace id as the value.
   * @route POST /get-marketplaces-dictionary
   * @paramDef {"type":"getMarketplacesDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"United States (ATVPDKIKX0DER)","value":"ATVPDKIKX0DER","note":"North America"}]}
   */
  async getMarketplacesDictionary(payload) {
    const { search } = payload || {}
    const needle = search ? search.toLowerCase() : null

    const ordered = [...MARKETPLACES].sort((a, b) => {
      const aOwn = a.region === this.region ? 0 : 1
      const bOwn = b.region === this.region ? 0 : 1

      return aOwn - bOwn
    })

    const filtered = needle
      ? ordered.filter(mp => mp.country.toLowerCase().includes(needle) || mp.id.toLowerCase().includes(needle))
      : ordered

    return {
      items: filtered.map(mp => ({
        label: `${ mp.country } (${ mp.id })`,
        value: mp.id,
        note: mp.region,
      })),
    }
  }

  /**
   * @typedef {Object} getReportTypesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter report types by name or enum value."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Not used; the full report type list is returned in one page."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Report Types Dictionary
   * @description Lists the most commonly used SP-API report types (open listings, all listings, all orders, sales and traffic, FBA inventory planning, FBA managed inventory, FBA customer returns) for selection in report parameters. Amazon supports many more report types; any documented reportType enum value can also be entered manually.
   * @route POST /get-report-types-dictionary
   * @paramDef {"type":"getReportTypesDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"All Listings Report","value":"GET_MERCHANT_LISTINGS_ALL_DATA","note":"Every listing, active and inactive"}]}
   */
  async getReportTypesDictionary(payload) {
    const { search } = payload || {}
    const needle = search ? search.toLowerCase() : null

    const filtered = needle
      ? COMMON_REPORT_TYPES.filter(rt => rt.label.toLowerCase().includes(needle) || rt.value.toLowerCase().includes(needle))
      : COMMON_REPORT_TYPES

    return {
      items: filtered.map(rt => ({ label: rt.label, value: rt.value, note: rt.note })),
    }
  }

  // ============================================= SELLERS =============================================

  /**
   * @description Retrieves the marketplaces the connected seller participates in, including each marketplace's id, name, country code, default currency, default language, and domain, plus the seller's participation and store name where available. Useful as a connection check and for discovering the seller's marketplace ids. Rate limit: about 0.016 requests per second (roughly 1 per minute, burst 15), so avoid calling it in tight loops.
   *
   * @route GET /get-marketplace-participations
   * @operationName Get Marketplace Participations
   * @category Sellers
   *
   * @returns {Object}
   * @sampleResult {"payload":[{"marketplace":{"id":"ATVPDKIKX0DER","name":"Amazon.com","countryCode":"US","defaultCurrencyCode":"USD","defaultLanguageCode":"en_US","domainName":"www.amazon.com"},"storeName":"Example Store","participation":{"isParticipating":true,"hasSuspendedListings":false}}]}
   */
  async getMarketplaceParticipations() {
    return this.#apiRequest({
      logTag: 'getMarketplaceParticipations',
      url: this.#apiUrl('/sellers/v1/marketplaceParticipations'),
    })
  }

  // ============================================== ORDERS =============================================

  /**
   * @description Retrieves orders created or updated in the given time range, with optional filtering by order status and fulfillment channel. Provide either Created After or Last Updated After (not both); when neither is set and no Next Token is used, orders created in the last 30 days are returned. Results are paginated via NextToken in the response. Amazon's Orders API rate limit is strict: about 0.0167 requests per second (1 per minute sustained, burst 20), so space out polling. Returns the SP-API payload with an Orders array; buyer PII fields (name, address, email) require a Restricted Data Token and are not returned by this operation.
   *
   * @route GET /list-orders
   * @operationName List Orders
   * @category Orders
   *
   * @paramDef {"type":"Array<String>","label":"Marketplace IDs","name":"marketplaceIds","dictionary":"getMarketplacesDictionary","description":"Amazon marketplace ids to retrieve orders for. Defaults to the connected region's primary marketplace (e.g. ATVPDKIKX0DER for North America) when omitted."}
   * @paramDef {"type":"String","label":"Created After","name":"createdAfter","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Only return orders created at or after this date-time (ISO 8601, e.g. '2026-01-01T00:00:00Z'). Cannot be combined with Last Updated After. Defaults to 30 days ago when no other time filter or Next Token is provided."}
   * @paramDef {"type":"String","label":"Created Before","name":"createdBefore","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Only return orders created before this date-time (ISO 8601). Must be at least 2 minutes in the past."}
   * @paramDef {"type":"String","label":"Last Updated After","name":"lastUpdatedAfter","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Only return orders updated at or after this date-time (ISO 8601). Cannot be combined with Created After."}
   * @paramDef {"type":"Array<String>","label":"Order Statuses","name":"orderStatuses","uiComponent":{"type":"DROPDOWN","options":{"values":["Pending","Unshipped","Partially Shipped","Shipped","Canceled","Unfulfillable","Invoice Unconfirmed","Pending Availability"]}},"description":"Optional order statuses to filter by. When omitted, orders in all statuses are returned."}
   * @paramDef {"type":"Array<String>","label":"Fulfillment Channels","name":"fulfillmentChannels","uiComponent":{"type":"DROPDOWN","options":{"values":["Amazon (AFN)","Merchant (MFN)"]}},"description":"Optional fulfillment channels to filter by: orders fulfilled by Amazon (AFN/FBA) or by the merchant (MFN/FBM)."}
   * @paramDef {"type":"Number","label":"Max Results Per Page","name":"maxResultsPerPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of orders to return per page. Range: 1-100. Default: 100."}
   * @paramDef {"type":"String","label":"Next Token","name":"nextToken","description":"Pagination token from a previous response's payload.NextToken. When provided, all other filters are ignored by Amazon."}
   *
   * @returns {Object}
   * @sampleResult {"payload":{"Orders":[{"AmazonOrderId":"902-3159896-1390916","PurchaseDate":"2026-01-05T18:32:10Z","LastUpdateDate":"2026-01-06T10:14:02Z","OrderStatus":"Unshipped","FulfillmentChannel":"MFN","SalesChannel":"Amazon.com","OrderTotal":{"CurrencyCode":"USD","Amount":"49.99"},"NumberOfItemsShipped":0,"NumberOfItemsUnshipped":1,"MarketplaceId":"ATVPDKIKX0DER"}],"NextToken":"MRgZW55IGZhbmN5IHRva2Vu","CreatedBefore":"2026-01-06T00:00:00Z"}}
   */
  async listOrders(marketplaceIds, createdAfter, createdBefore, lastUpdatedAfter, orderStatuses, fulfillmentChannels, maxResultsPerPage, nextToken) {
    if (createdAfter && lastUpdatedAfter) {
      throw new Error('"Created After" and "Last Updated After" cannot be used together')
    }

    // Amazon requires CreatedAfter or LastUpdatedAfter unless a NextToken is supplied.
    if (!nextToken && !createdAfter && !lastUpdatedAfter) {
      createdAfter = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    }

    const statuses = this.#resolveChoices(orderStatuses, ORDER_STATUS_OPTIONS)
    const channels = this.#resolveChoices(fulfillmentChannels, FULFILLMENT_CHANNEL_OPTIONS)

    return this.#apiRequest({
      logTag: 'listOrders',
      url: this.#apiUrl('/orders/v0/orders'),
      query: {
        MarketplaceIds: this.#resolveMarketplaceIds(marketplaceIds).join(','),
        CreatedAfter: createdAfter,
        CreatedBefore: createdBefore,
        LastUpdatedAfter: lastUpdatedAfter,
        OrderStatuses: statuses.length ? statuses.join(',') : undefined,
        FulfillmentChannels: channels.length ? channels.join(',') : undefined,
        MaxResultsPerPage: maxResultsPerPage,
        NextToken: nextToken,
      },
    })
  }

  /**
   * @description Retrieves a single order by its Amazon order id, including status, purchase and update dates, order total, fulfillment channel, shipping service level, and item counts. Buyer PII (name, address, email) requires a Restricted Data Token and is not returned. Rate limit: about 0.0167 requests per second (burst 20).
   *
   * @route GET /get-order
   * @operationName Get Order
   * @category Orders
   *
   * @paramDef {"type":"String","label":"Order ID","name":"orderId","required":true,"description":"The Amazon order id in 3-7-7 format (e.g. '902-3159896-1390916')."}
   *
   * @returns {Object}
   * @sampleResult {"payload":{"AmazonOrderId":"902-3159896-1390916","PurchaseDate":"2026-01-05T18:32:10Z","LastUpdateDate":"2026-01-06T10:14:02Z","OrderStatus":"Unshipped","FulfillmentChannel":"MFN","OrderTotal":{"CurrencyCode":"USD","Amount":"49.99"},"NumberOfItemsShipped":0,"NumberOfItemsUnshipped":1,"MarketplaceId":"ATVPDKIKX0DER","ShipServiceLevel":"Std US D2D Dom"}}
   */
  async getOrder(orderId) {
    if (!orderId) {
      throw new Error('"Order ID" is required')
    }

    return this.#apiRequest({
      logTag: 'getOrder',
      url: this.#apiUrl(`/orders/v0/orders/${ encodeURIComponent(orderId) }`),
    })
  }

  /**
   * @description Retrieves the line items of an order, including each item's order item id, seller SKU, ASIN, title, quantities ordered and shipped, item price, and tax. Results are paginated via NextToken for orders with many items. Buyer customization data requires a Restricted Data Token and is not returned. Rate limit: about 0.5 requests per second (burst 30).
   *
   * @route GET /list-order-items
   * @operationName List Order Items
   * @category Orders
   *
   * @paramDef {"type":"String","label":"Order ID","name":"orderId","required":true,"description":"The Amazon order id in 3-7-7 format (e.g. '902-3159896-1390916')."}
   * @paramDef {"type":"String","label":"Next Token","name":"nextToken","description":"Pagination token from a previous response's payload.NextToken."}
   *
   * @returns {Object}
   * @sampleResult {"payload":{"AmazonOrderId":"902-3159896-1390916","OrderItems":[{"OrderItemId":"68828574383266","SellerSKU":"WIDGET-001","ASIN":"B08XYZ1234","Title":"Example Widget, Blue","QuantityOrdered":1,"QuantityShipped":0,"ItemPrice":{"CurrencyCode":"USD","Amount":"49.99"}}]}}
   */
  async listOrderItems(orderId, nextToken) {
    if (!orderId) {
      throw new Error('"Order ID" is required')
    }

    return this.#apiRequest({
      logTag: 'listOrderItems',
      url: this.#apiUrl(`/orders/v0/orders/${ encodeURIComponent(orderId) }/orderItems`),
      query: { NextToken: nextToken },
    })
  }

  /**
   * @typedef {Object} ConfirmShipmentOrderItem
   * @paramDef {"type":"String","label":"Order Item ID","name":"orderItemId","required":true,"description":"The order item id, as returned by List Order Items."}
   * @paramDef {"type":"Number","label":"Quantity","name":"quantity","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The quantity of this item included in the package."}
   */

  /**
   * @description Confirms shipment of a merchant-fulfilled (MFN) order by submitting package tracking details, updating the order to Shipped in Amazon. Provide the carrier code, tracking number, ship date, and the order items with quantities included in the package. Amazon returns no content on success; this operation returns a success status. The package reference id is a seller-defined identifier that must be unique per order (e.g. '1'). Rate limit: about 2 requests per second (burst 10).
   *
   * @route POST /confirm-shipment
   * @operationName Confirm Shipment
   * @category Orders
   *
   * @paramDef {"type":"String","label":"Order ID","name":"orderId","required":true,"description":"The Amazon order id in 3-7-7 format (e.g. '902-3159896-1390916')."}
   * @paramDef {"type":"String","label":"Package Reference ID","name":"packageReferenceId","required":true,"defaultValue":"1","description":"A seller-defined package identifier, unique within the order. Use '1' for the first (or only) package."}
   * @paramDef {"type":"String","label":"Carrier Code","name":"carrierCode","required":true,"description":"The carrier identifier accepted by Amazon (e.g. 'UPS', 'USPS', 'FEDEX', 'DHL'). For carriers not in Amazon's list, use 'Other' and set Carrier Name."}
   * @paramDef {"type":"String","label":"Tracking Number","name":"trackingNumber","required":true,"description":"The package tracking number issued by the carrier."}
   * @paramDef {"type":"String","label":"Ship Date","name":"shipDate","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"The shipping date-time in ISO 8601 format (e.g. '2026-01-06T08:00:00Z')."}
   * @paramDef {"type":"Array<ConfirmShipmentOrderItem>","label":"Order Items","name":"orderItems","required":true,"description":"The order items and quantities included in this package. Get order item ids from List Order Items."}
   * @paramDef {"type":"String","label":"Marketplace ID","name":"marketplaceId","dictionary":"getMarketplacesDictionary","description":"The marketplace id of the order. Defaults to the connected region's primary marketplace when omitted."}
   * @paramDef {"type":"String","label":"Carrier Name","name":"carrierName","description":"The carrier name, required when Carrier Code is 'Other'."}
   * @paramDef {"type":"String","label":"Shipping Method","name":"shippingMethod","description":"Optional shipping method or service level (e.g. 'Ground')."}
   *
   * @returns {Object}
   * @sampleResult {"status":"success"}
   */
  async confirmShipment(orderId, packageReferenceId, carrierCode, trackingNumber, shipDate, orderItems, marketplaceId, carrierName, shippingMethod) {
    if (!orderId) {
      throw new Error('"Order ID" is required')
    }

    const items = (Array.isArray(orderItems) ? orderItems : (orderItems ? [orderItems] : [])).filter(Boolean)

    if (!items.length) {
      throw new Error('At least one order item is required')
    }

    const packageDetail = cleanupObject({
      packageReferenceId: packageReferenceId || '1',
      carrierCode,
      carrierName,
      shippingMethod,
      trackingNumber,
      shipDate,
      orderItems: items.map(item => cleanupObject({
        orderItemId: item.orderItemId,
        quantity: item.quantity,
        transparencyCodes: item.transparencyCodes,
      })),
    })

    return this.#apiRequest({
      logTag: 'confirmShipment',
      method: 'post',
      url: this.#apiUrl(`/orders/v0/orders/${ encodeURIComponent(orderId) }/shipmentConfirmation`),
      body: {
        marketplaceId: this.#resolveMarketplaceIds(marketplaceId)[0],
        packageDetail,
      },
    })
  }

  // ============================================= CATALOG =============================================

  /**
   * @description Searches the Amazon catalog (2022-04-01) by keywords or by product identifiers (ASIN, EAN, GTIN, ISBN, JAN, MINSAN, SKU, UPC). Provide either Keywords or Identifiers, not both; searching by SKU also requires the Seller ID. Select which data sets to include per item (summaries, attributes, images, sales ranks, etc.). Results are paginated via pagination.nextToken. Rate limit: about 2 requests per second (burst 2), and identifier searches accept up to 20 identifiers per request.
   *
   * @route GET /search-catalog-items
   * @operationName Search Catalog Items
   * @category Catalog
   *
   * @paramDef {"type":"Array<String>","label":"Keywords","name":"keywords","description":"Keywords to search the catalog with (e.g. ['wireless','earbuds']). Mutually exclusive with Identifiers."}
   * @paramDef {"type":"Array<String>","label":"Identifiers","name":"identifiers","description":"Up to 20 product identifiers to look up (e.g. ASINs or UPCs). Mutually exclusive with Keywords; requires Identifiers Type."}
   * @paramDef {"type":"String","label":"Identifiers Type","name":"identifiersType","uiComponent":{"type":"DROPDOWN","options":{"values":["ASIN","EAN","GTIN","ISBN","JAN","MINSAN","SKU","UPC"]}},"description":"The type of the provided identifiers. Required when Identifiers is set. 'SKU' also requires the Seller ID parameter."}
   * @paramDef {"type":"Array<String>","label":"Marketplace IDs","name":"marketplaceIds","dictionary":"getMarketplacesDictionary","description":"Marketplace ids to search in. Defaults to the connected region's primary marketplace when omitted."}
   * @paramDef {"type":"Array<String>","label":"Included Data","name":"includedData","uiComponent":{"type":"DROPDOWN","options":{"values":["Summaries","Attributes","Classifications","Dimensions","Identifiers","Images","Product Types","Sales Ranks","Relationships"]}},"description":"The data sets to include for each item. Defaults to Summaries when omitted."}
   * @paramDef {"type":"String","label":"Seller ID","name":"sellerId","description":"Your merchant token (Seller ID). Required only when Identifiers Type is 'SKU'. Found in Seller Central under Settings > Account Info > Merchant Token."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of results per page. Range: 1-20. Default: 10."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Pagination token from a previous response's pagination.nextToken."}
   *
   * @returns {Object}
   * @sampleResult {"numberOfResults":8721,"pagination":{"nextToken":"9HkIVcuuPmX_bm51o3-igBjc..."},"items":[{"asin":"B08XYZ1234","summaries":[{"marketplaceId":"ATVPDKIKX0DER","itemName":"Example Widget, Blue","brand":"ExampleBrand","manufacturer":"Example Corp"}]}]}
   */
  async searchCatalogItems(keywords, identifiers, identifiersType, marketplaceIds, includedData, sellerId, pageSize, pageToken) {
    const keywordList = this.#toList(keywords)
    const identifierList = this.#toList(identifiers)

    if (!keywordList.length && !identifierList.length) {
      throw new Error('Either "Keywords" or "Identifiers" is required')
    }

    if (keywordList.length && identifierList.length) {
      throw new Error('"Keywords" and "Identifiers" cannot be used together')
    }

    if (identifierList.length && !identifiersType) {
      throw new Error('"Identifiers Type" is required when searching by identifiers')
    }

    if (identifiersType === 'SKU' && !sellerId) {
      throw new Error('"Seller ID" is required when Identifiers Type is "SKU"')
    }

    const included = this.#resolveChoices(includedData, CATALOG_INCLUDED_DATA_OPTIONS)

    return this.#apiRequest({
      logTag: 'searchCatalogItems',
      url: this.#apiUrl('/catalog/2022-04-01/items'),
      query: {
        marketplaceIds: this.#resolveMarketplaceIds(marketplaceIds).join(','),
        keywords: keywordList.length ? keywordList.join(',') : undefined,
        identifiers: identifierList.length ? identifierList.join(',') : undefined,
        identifiersType: identifierList.length ? identifiersType : undefined,
        includedData: included.length ? included.join(',') : undefined,
        sellerId: sellerId || undefined,
        pageSize,
        pageToken,
      },
    })
  }

  /**
   * @description Retrieves details of a single Amazon catalog item by ASIN (Catalog Items API 2022-04-01). Select which data sets to include: summaries (title, brand, manufacturer), attributes, classifications, dimensions, identifiers, images, product types, sales ranks, and relationships (e.g. variations). Rate limit: about 2 requests per second (burst 2).
   *
   * @route GET /get-catalog-item
   * @operationName Get Catalog Item
   * @category Catalog
   *
   * @paramDef {"type":"String","label":"ASIN","name":"asin","required":true,"description":"The Amazon Standard Identification Number of the item (e.g. 'B08XYZ1234')."}
   * @paramDef {"type":"Array<String>","label":"Marketplace IDs","name":"marketplaceIds","dictionary":"getMarketplacesDictionary","description":"Marketplace ids to retrieve the item for. Defaults to the connected region's primary marketplace when omitted."}
   * @paramDef {"type":"Array<String>","label":"Included Data","name":"includedData","uiComponent":{"type":"DROPDOWN","options":{"values":["Summaries","Attributes","Classifications","Dimensions","Identifiers","Images","Product Types","Sales Ranks","Relationships"]}},"description":"The data sets to include. Defaults to Summaries when omitted."}
   *
   * @returns {Object}
   * @sampleResult {"asin":"B08XYZ1234","summaries":[{"marketplaceId":"ATVPDKIKX0DER","itemName":"Example Widget, Blue","brand":"ExampleBrand","manufacturer":"Example Corp","modelNumber":"EW-100"}],"images":[{"marketplaceId":"ATVPDKIKX0DER","images":[{"variant":"MAIN","link":"https://m.media-amazon.com/images/I/example.jpg","height":1000,"width":1000}]}]}
   */
  async getCatalogItem(asin, marketplaceIds, includedData) {
    if (!asin) {
      throw new Error('"ASIN" is required')
    }

    const included = this.#resolveChoices(includedData, CATALOG_INCLUDED_DATA_OPTIONS)

    return this.#apiRequest({
      logTag: 'getCatalogItem',
      url: this.#apiUrl(`/catalog/2022-04-01/items/${ encodeURIComponent(asin) }`),
      query: {
        marketplaceIds: this.#resolveMarketplaceIds(marketplaceIds).join(','),
        includedData: included.length ? included.join(',') : undefined,
      },
    })
  }

  // ============================================= LISTINGS ============================================

  /**
   * @description Retrieves a listing (Listings Items API 2021-08-01) by seller id and SKU, including summaries (status, condition, item name), full attributes, listing issues, offers (price), and fulfillment availability. Useful for inspecting a listing's current state before updating it. Rate limit: about 5 requests per second (burst 10).
   *
   * @route GET /get-listings-item
   * @operationName Get Listing Item
   * @category Listings
   *
   * @paramDef {"type":"String","label":"Seller ID","name":"sellerId","required":true,"description":"Your merchant token (Seller ID), found in Seller Central under Settings > Account Info > Merchant Token. It is the same value as the selling partner id captured when the connection was authorized."}
   * @paramDef {"type":"String","label":"SKU","name":"sku","required":true,"description":"The seller SKU of the listing."}
   * @paramDef {"type":"Array<String>","label":"Marketplace IDs","name":"marketplaceIds","dictionary":"getMarketplacesDictionary","description":"Marketplace ids to retrieve the listing for. Defaults to the connected region's primary marketplace when omitted."}
   * @paramDef {"type":"Array<String>","label":"Included Data","name":"includedData","uiComponent":{"type":"DROPDOWN","options":{"values":["Summaries","Attributes","Issues","Offers","Fulfillment Availability"]}},"description":"The data sets to include. Defaults to Summaries when omitted."}
   *
   * @returns {Object}
   * @sampleResult {"sku":"WIDGET-001","summaries":[{"marketplaceId":"ATVPDKIKX0DER","asin":"B08XYZ1234","productType":"HOME_ORGANIZER","status":["BUYABLE"],"itemName":"Example Widget, Blue","createdDate":"2025-11-02T12:00:00Z"}],"offers":[{"marketplaceId":"ATVPDKIKX0DER","offerType":"B2C","price":{"currencyCode":"USD","amount":"49.99"}}]}
   */
  async getListingsItem(sellerId, sku, marketplaceIds, includedData) {
    this.#validateListingKeys(sellerId, sku)

    const included = this.#resolveChoices(includedData, LISTINGS_INCLUDED_DATA_OPTIONS)

    return this.#apiRequest({
      logTag: 'getListingsItem',
      url: this.#listingsItemUrl(sellerId, sku),
      query: {
        marketplaceIds: this.#resolveMarketplaceIds(marketplaceIds).join(','),
        includedData: included.length ? included.join(',') : undefined,
      },
    })
  }

  /**
   * @description Creates a new listing or fully replaces an existing one (Listings Items API 2021-08-01). Requires the Amazon product type and the complete attributes object conforming to that product type's JSON schema — Amazon's listing attribute schemas are complex and product-type specific, so build the attributes payload against the Product Type Definitions for your product type (retrievable in Seller Central or via the SP-API productTypeDefinitions resource). Amazon processes the submission asynchronously: an ACCEPTED response means it passed validation, not that it is live. Rate limit: about 5 requests per second (burst 10).
   *
   * @route PUT /put-listings-item
   * @operationName Put Listing Item
   * @category Listings
   *
   * @paramDef {"type":"String","label":"Seller ID","name":"sellerId","required":true,"description":"Your merchant token (Seller ID), found in Seller Central under Settings > Account Info > Merchant Token."}
   * @paramDef {"type":"String","label":"SKU","name":"sku","required":true,"description":"The seller SKU to create or replace."}
   * @paramDef {"type":"String","label":"Product Type","name":"productType","required":true,"description":"The Amazon product type of the listing (e.g. 'LUGGAGE', 'HOME_ORGANIZER'). Must match a product type definition in the target marketplace."}
   * @paramDef {"type":"Object","label":"Attributes","name":"attributes","required":true,"description":"The complete listing attributes object, keyed by attribute name per the product type's JSON schema. Example: {\"item_name\":[{\"value\":\"Example Widget\",\"marketplace_id\":\"ATVPDKIKX0DER\"}],\"condition_type\":[{\"value\":\"new_new\"}]}. This raw object is sent to Amazon as-is."}
   * @paramDef {"type":"Array<String>","label":"Marketplace IDs","name":"marketplaceIds","dictionary":"getMarketplacesDictionary","description":"Marketplace ids to submit the listing to. Defaults to the connected region's primary marketplace when omitted."}
   * @paramDef {"type":"String","label":"Requirements","name":"requirements","uiComponent":{"type":"DROPDOWN","options":{"values":["Full Listing","Product Only","Offer Only"]}},"description":"The listing requirements to validate against: a full listing (product data and offer), product data only, or offer only (for existing catalog items). Defaults to a full listing when omitted."}
   *
   * @returns {Object}
   * @sampleResult {"sku":"WIDGET-001","status":"ACCEPTED","submissionId":"f1dc2914-75dd-11ea-bc55-0242ac130003","issues":[]}
   */
  async putListingsItem(sellerId, sku, productType, attributes, marketplaceIds, requirements) {
    this.#validateListingKeys(sellerId, sku)

    if (!productType) {
      throw new Error('"Product Type" is required')
    }

    if (!attributes || typeof attributes !== 'object') {
      throw new Error('"Attributes" is required and must be an object')
    }

    const body = cleanupObject({
      productType,
      requirements: this.#resolveChoice(requirements, LISTING_REQUIREMENTS_OPTIONS),
      attributes,
    })

    return this.#apiRequest({
      logTag: 'putListingsItem',
      method: 'put',
      url: this.#listingsItemUrl(sellerId, sku),
      query: { marketplaceIds: this.#resolveMarketplaceIds(marketplaceIds).join(',') },
      body,
    })
  }

  /**
   * @description Partially updates an existing listing (Listings Items API 2021-08-01) using JSON Patch operations, e.g. to change price or quantity without resubmitting the whole listing. Each patch has an op ('add', 'replace', or 'delete'), a path pointing at an attribute (e.g. '/attributes/purchasable_offer'), and for add/replace a value array of attribute objects. Amazon processes the submission asynchronously: an ACCEPTED response means it passed validation. Rate limit: about 5 requests per second (burst 10).
   *
   * @route PATCH /patch-listings-item
   * @operationName Patch Listing Item
   * @category Listings
   *
   * @paramDef {"type":"String","label":"Seller ID","name":"sellerId","required":true,"description":"Your merchant token (Seller ID), found in Seller Central under Settings > Account Info > Merchant Token."}
   * @paramDef {"type":"String","label":"SKU","name":"sku","required":true,"description":"The seller SKU of the listing to update."}
   * @paramDef {"type":"String","label":"Product Type","name":"productType","required":true,"description":"The Amazon product type of the listing (e.g. 'LUGGAGE', 'HOME_ORGANIZER')."}
   * @paramDef {"type":"Array<Object>","label":"Patches","name":"patches","required":true,"description":"JSON Patch operations to apply. Each object has 'op' ('add', 'replace', or 'delete'), 'path' (e.g. '/attributes/fulfillment_availability'), and for add/replace a 'value' array. Example: [{\"op\":\"replace\",\"path\":\"/attributes/fulfillment_availability\",\"value\":[{\"fulfillment_channel_code\":\"DEFAULT\",\"quantity\":25}]}]."}
   * @paramDef {"type":"Array<String>","label":"Marketplace IDs","name":"marketplaceIds","dictionary":"getMarketplacesDictionary","description":"Marketplace ids to apply the update in. Defaults to the connected region's primary marketplace when omitted."}
   *
   * @returns {Object}
   * @sampleResult {"sku":"WIDGET-001","status":"ACCEPTED","submissionId":"f1dc2914-75dd-11ea-bc55-0242ac130003","issues":[]}
   */
  async patchListingsItem(sellerId, sku, productType, patches, marketplaceIds) {
    this.#validateListingKeys(sellerId, sku)

    if (!productType) {
      throw new Error('"Product Type" is required')
    }

    const patchList = (Array.isArray(patches) ? patches : (patches ? [patches] : [])).filter(Boolean)

    if (!patchList.length) {
      throw new Error('At least one patch operation is required')
    }

    return this.#apiRequest({
      logTag: 'patchListingsItem',
      method: 'patch',
      url: this.#listingsItemUrl(sellerId, sku),
      query: { marketplaceIds: this.#resolveMarketplaceIds(marketplaceIds).join(',') },
      body: {
        productType,
        patches: patchList.map(patch => ({
          ...patch,
          op: typeof patch.op === 'string' ? patch.op.toLowerCase() : patch.op,
        })),
      },
    })
  }

  /**
   * @description Deletes a listing (Listings Items API 2021-08-01) by seller id and SKU in the selected marketplaces, removing the offer from Amazon. Amazon processes the deletion asynchronously: an ACCEPTED response means the request passed validation. Rate limit: about 5 requests per second (burst 10).
   *
   * @route DELETE /delete-listings-item
   * @operationName Delete Listing Item
   * @category Listings
   *
   * @paramDef {"type":"String","label":"Seller ID","name":"sellerId","required":true,"description":"Your merchant token (Seller ID), found in Seller Central under Settings > Account Info > Merchant Token."}
   * @paramDef {"type":"String","label":"SKU","name":"sku","required":true,"description":"The seller SKU of the listing to delete."}
   * @paramDef {"type":"Array<String>","label":"Marketplace IDs","name":"marketplaceIds","dictionary":"getMarketplacesDictionary","description":"Marketplace ids to delete the listing from. Defaults to the connected region's primary marketplace when omitted."}
   *
   * @returns {Object}
   * @sampleResult {"sku":"WIDGET-001","status":"ACCEPTED","submissionId":"f1dc2914-75dd-11ea-bc55-0242ac130003","issues":[]}
   */
  async deleteListingsItem(sellerId, sku, marketplaceIds) {
    this.#validateListingKeys(sellerId, sku)

    return this.#apiRequest({
      logTag: 'deleteListingsItem',
      method: 'delete',
      url: this.#listingsItemUrl(sellerId, sku),
      query: { marketplaceIds: this.#resolveMarketplaceIds(marketplaceIds).join(',') },
    })
  }

  #listingsItemUrl(sellerId, sku) {
    return this.#apiUrl(`/listings/2021-08-01/items/${ encodeURIComponent(sellerId) }/${ encodeURIComponent(sku) }`)
  }

  #validateListingKeys(sellerId, sku) {
    if (!sellerId) {
      throw new Error('"Seller ID" is required')
    }

    if (!sku) {
      throw new Error('"SKU" is required')
    }
  }

  // ============================================ INVENTORY ============================================

  /**
   * @description Retrieves FBA (Fulfillment by Amazon) inventory summaries per SKU, including fulfillable, inbound, reserved, unfulfillable, and researching quantities when Details is enabled. Optionally restrict to specific seller SKUs. Results are paginated via pagination.nextToken. Rate limit: about 2 requests per second (burst 2). Only inventory in Amazon fulfillment centers is returned; merchant-fulfilled stock is managed through listings.
   *
   * @route GET /get-inventory-summaries
   * @operationName Get Inventory Summaries
   * @category Inventory
   *
   * @paramDef {"type":"String","label":"Marketplace ID","name":"marketplaceId","dictionary":"getMarketplacesDictionary","description":"The marketplace to retrieve FBA inventory for (used as both the granularity id and the marketplace filter). Defaults to the connected region's primary marketplace when omitted."}
   * @paramDef {"type":"Boolean","label":"Include Details","name":"details","uiComponent":{"type":"TOGGLE"},"description":"When enabled, returns detailed quantity breakdowns (inbound, reserved, unfulfillable, researching) per SKU. Default: false."}
   * @paramDef {"type":"Array<String>","label":"Seller SKUs","name":"sellerSkus","description":"Optional list of up to 50 seller SKUs to restrict the results to."}
   * @paramDef {"type":"String","label":"Start Date Time","name":"startDateTime","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Optional ISO 8601 date-time; only inventory updated at or after this time is returned."}
   * @paramDef {"type":"String","label":"Next Token","name":"nextToken","description":"Pagination token from a previous response's pagination.nextToken."}
   *
   * @returns {Object}
   * @sampleResult {"pagination":{"nextToken":"seed"},"payload":{"granularity":{"granularityType":"Marketplace","granularityId":"ATVPDKIKX0DER"},"inventorySummaries":[{"asin":"B08XYZ1234","fnSku":"X001ABC123","sellerSku":"WIDGET-001","condition":"NewItem","totalQuantity":42,"lastUpdatedTime":"2026-01-06T10:14:02Z"}]}}
   */
  async getInventorySummaries(marketplaceId, details, sellerSkus, startDateTime, nextToken) {
    const resolvedMarketplaceId = this.#resolveMarketplaceIds(marketplaceId)[0]
    const skus = this.#toList(sellerSkus)

    return this.#apiRequest({
      logTag: 'getInventorySummaries',
      url: this.#apiUrl('/fba/inventory/v1/summaries'),
      query: {
        granularityType: 'Marketplace',
        granularityId: resolvedMarketplaceId,
        marketplaceIds: resolvedMarketplaceId,
        details: details === true ? 'true' : undefined,
        sellerSkus: skus.length ? skus.join(',') : undefined,
        startDateTime,
        nextToken,
      },
    })
  }

  // ============================================= REPORTS =============================================

  /**
   * @description Requests generation of a report (Reports API 2021-06-30), such as open listings, all orders, sales and traffic, or FBA inventory planning. Pick a common report type from the dictionary or enter any documented SP-API reportType enum manually. Report generation is asynchronous: use the returned reportId with Get Report to poll the processing status, then fetch the output via Get Report Document or Download Report Document. Rate limit: about 0.0167 requests per second (1 per minute, burst 15).
   *
   * @route POST /create-report
   * @operationName Create Report
   * @category Reports
   *
   * @paramDef {"type":"String","label":"Report Type","name":"reportType","required":true,"dictionary":"getReportTypesDictionary","description":"The report type to generate. Pick a common type or enter any documented SP-API reportType value (e.g. 'GET_MERCHANT_LISTINGS_ALL_DATA')."}
   * @paramDef {"type":"Array<String>","label":"Marketplace IDs","name":"marketplaceIds","dictionary":"getMarketplacesDictionary","description":"Marketplace ids to include in the report. Defaults to the connected region's primary marketplace when omitted."}
   * @paramDef {"type":"String","label":"Data Start Time","name":"dataStartTime","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Optional ISO 8601 date-time marking the start of the data range, for report types that support it."}
   * @paramDef {"type":"String","label":"Data End Time","name":"dataEndTime","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Optional ISO 8601 date-time marking the end of the data range, for report types that support it."}
   * @paramDef {"type":"Object","label":"Report Options","name":"reportOptions","description":"Optional report-type-specific options as a flat object of string values, e.g. {\"reportPeriod\":\"WEEK\"} for the Sales and Traffic report."}
   *
   * @returns {Object}
   * @sampleResult {"reportId":"ID323"}
   */
  async createReport(reportType, marketplaceIds, dataStartTime, dataEndTime, reportOptions) {
    if (!reportType) {
      throw new Error('"Report Type" is required')
    }

    return this.#apiRequest({
      logTag: 'createReport',
      method: 'post',
      url: this.#apiUrl('/reports/2021-06-30/reports'),
      body: cleanupObject({
        reportType,
        marketplaceIds: this.#resolveMarketplaceIds(marketplaceIds),
        dataStartTime,
        dataEndTime,
        reportOptions,
      }),
    })
  }

  /**
   * @description Retrieves the status of a report request by report id, including its processingStatus (IN_QUEUE, IN_PROGRESS, DONE, CANCELLED, FATAL) and, once DONE, the reportDocumentId needed to fetch the output. Poll this after Create Report; report generation typically takes from seconds to several minutes depending on the report type and data volume. Rate limit: about 2 requests per second (burst 15).
   *
   * @route GET /get-report
   * @operationName Get Report
   * @category Reports
   *
   * @paramDef {"type":"String","label":"Report ID","name":"reportId","required":true,"description":"The report id returned by Create Report or List Reports."}
   *
   * @returns {Object}
   * @sampleResult {"reportId":"ID323","reportType":"GET_MERCHANT_LISTINGS_ALL_DATA","processingStatus":"DONE","createdTime":"2026-01-06T10:00:00Z","processingStartTime":"2026-01-06T10:00:05Z","processingEndTime":"2026-01-06T10:01:10Z","marketplaceIds":["ATVPDKIKX0DER"],"reportDocumentId":"amzn1.spdoc.1.4.na.ex4mple-d0c"}
   */
  async getReport(reportId) {
    if (!reportId) {
      throw new Error('"Report ID" is required')
    }

    return this.#apiRequest({
      logTag: 'getReport',
      url: this.#apiUrl(`/reports/2021-06-30/reports/${ encodeURIComponent(reportId) }`),
    })
  }

  /**
   * @description Lists previously requested reports, filtered by report types, processing statuses, and creation time. Either Report Types or a Next Token is required by Amazon; when a Next Token is provided all other filters are ignored. Results are paginated via nextToken. Rate limit: about 0.0222 requests per second (burst 10).
   *
   * @route GET /list-reports
   * @operationName List Reports
   * @category Reports
   *
   * @paramDef {"type":"Array<String>","label":"Report Types","name":"reportTypes","dictionary":"getReportTypesDictionary","description":"Report types to filter by (up to 10). Required unless a Next Token is provided. Pick from the dictionary or enter any documented reportType value."}
   * @paramDef {"type":"Array<String>","label":"Processing Statuses","name":"processingStatuses","uiComponent":{"type":"DROPDOWN","options":{"values":["Cancelled","Done","Fatal","In Progress","In Queue"]}},"description":"Optional processing statuses to filter by."}
   * @paramDef {"type":"String","label":"Created Since","name":"createdSince","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Only return reports created at or after this ISO 8601 date-time. Default: 90 days ago."}
   * @paramDef {"type":"String","label":"Created Until","name":"createdUntil","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Only return reports created at or before this ISO 8601 date-time."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of reports per page. Range: 1-100. Default: 10."}
   * @paramDef {"type":"String","label":"Next Token","name":"nextToken","description":"Pagination token from a previous response's nextToken. When provided, all other filters must be omitted and are ignored."}
   *
   * @returns {Object}
   * @sampleResult {"reports":[{"reportId":"ID323","reportType":"GET_MERCHANT_LISTINGS_ALL_DATA","processingStatus":"DONE","createdTime":"2026-01-06T10:00:00Z","reportDocumentId":"amzn1.spdoc.1.4.na.ex4mple-d0c"}],"nextToken":"VGhpcyB0b2tlbiBpcyBvcGFxdWU"}
   */
  async listReports(reportTypes, processingStatuses, createdSince, createdUntil, pageSize, nextToken) {
    // Amazon requires reportTypes unless a nextToken is used, and rejects other params with nextToken.
    if (nextToken) {
      return this.#apiRequest({
        logTag: 'listReports',
        url: this.#apiUrl('/reports/2021-06-30/reports'),
        query: { nextToken },
      })
    }

    const types = this.#toList(reportTypes)

    if (!types.length) {
      throw new Error('"Report Types" is required when no Next Token is provided')
    }

    const statuses = this.#resolveChoices(processingStatuses, PROCESSING_STATUS_OPTIONS)

    return this.#apiRequest({
      logTag: 'listReports',
      url: this.#apiUrl('/reports/2021-06-30/reports'),
      query: {
        reportTypes: types.join(','),
        processingStatuses: statuses.length ? statuses.join(',') : undefined,
        createdSince,
        createdUntil,
        pageSize,
      },
    })
  }

  /**
   * @description Retrieves the download descriptor for a completed report document, containing a pre-signed URL (valid for 5 minutes) and the compression algorithm when the content is compressed. Use Download Report Document instead to fetch, decompress, and store the content in one step. Rate limit: about 0.0167 requests per second (burst 15).
   *
   * @route GET /get-report-document
   * @operationName Get Report Document
   * @category Reports
   *
   * @paramDef {"type":"String","label":"Report Document ID","name":"reportDocumentId","required":true,"description":"The report document id from a DONE report (Get Report's reportDocumentId)."}
   *
   * @returns {Object}
   * @sampleResult {"reportDocumentId":"amzn1.spdoc.1.4.na.ex4mple-d0c","url":"https://d34o8swod1owfl.cloudfront.net/Report_ex4mple.txt","compressionAlgorithm":"GZIP"}
   */
  async getReportDocument(reportDocumentId) {
    if (!reportDocumentId) {
      throw new Error('"Report Document ID" is required')
    }

    return this.#apiRequest({
      logTag: 'getReportDocument',
      url: this.#apiUrl(`/reports/2021-06-30/documents/${ encodeURIComponent(reportDocumentId) }`),
    })
  }

  /**
   * @description Downloads a completed report's content in one step: resolves the report document's pre-signed URL, fetches the binary content, decompresses it when Amazon returns it GZIP-compressed, stores the result as a file in FlowRunner file storage, and returns the file URL together with a text preview of the first 50 KB. Flat-file reports are tab-separated text; some report types (e.g. Sales and Traffic) are JSON. Rate limit: about 0.0167 requests per second on the underlying document endpoint.
   *
   * @route POST /download-report-document
   * @operationName Download Report Document
   * @category Reports
   *
   * @paramDef {"type":"String","label":"Report Document ID","name":"reportDocumentId","required":true,"description":"The report document id from a DONE report (Get Report's reportDocumentId)."}
   * @paramDef {"type":"FilesUploadOptions","label":"File Settings","name":"fileOptions","required":false,"include":["scope","filename"],"description":"Optional storage settings: the file scope (FLOW, WORKSPACE, or EXECUTION) and a custom filename."}
   *
   * @returns {Object}
   * @sampleResult {"url":"https://files.flowrunner.com/flow/amazon_report_1767700000000.txt","filename":"amazon_report_1767700000000.txt","sizeInBytes":18244,"compressionAlgorithm":"GZIP","contentPreview":"sku\tasin\tprice\tquantity\nWIDGET-001\tB08XYZ1234\t49.99\t42","previewTruncated":false}
   */
  async downloadReportDocument(reportDocumentId, fileOptions) {
    if (!reportDocumentId) {
      throw new Error('"Report Document ID" is required')
    }

    const document = await this.#apiRequest({
      logTag: 'downloadReportDocument',
      url: this.#apiUrl(`/reports/2021-06-30/documents/${ encodeURIComponent(reportDocumentId) }`),
    })

    if (!document.url) {
      throw new Error('The report document did not include a download URL')
    }

    // The URL is pre-signed; no SP-API auth headers must be attached.
    const bytes = await Flowrunner.Request.get(document.url).setEncoding(null)
    let buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)

    if (document.compressionAlgorithm === 'GZIP') {
      buffer = zlib.gunzipSync(buffer)
    }

    const defaultFilename = `amazon_report_${ Date.now() }.txt`

    const { url } = await this.flowrunner.Files.uploadFile(buffer, {
      filename: defaultFilename,
      generateUrl: true,
      overwrite: true,
      ...(fileOptions || { scope: 'FLOW' }),
    })

    return {
      url,
      filename: fileOptions?.filename || defaultFilename,
      sizeInBytes: buffer.length,
      compressionAlgorithm: document.compressionAlgorithm || 'NONE',
      contentPreview: buffer.slice(0, PREVIEW_SIZE_BYTES).toString('utf8'),
      previewTruncated: buffer.length > PREVIEW_SIZE_BYTES,
    }
  }

  // ============================================= FINANCES ============================================

  /**
   * @description Retrieves financial events (shipment settlements, refunds, fees, adjustments, service fees, etc.) posted within the given time range. The Posted Before date must be at least two minutes before the request time. Results are paginated via payload.NextToken. Rate limit: about 0.5 requests per second (burst 30). Returns the SP-API payload with a FinancialEvents object grouping events by kind (ShipmentEventList, RefundEventList, ServiceFeeEventList, and more).
   *
   * @route GET /list-financial-events
   * @operationName List Financial Events
   * @category Finances
   *
   * @paramDef {"type":"String","label":"Posted After","name":"postedAfter","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Only return events posted at or after this ISO 8601 date-time. Default: 90 days before Posted Before."}
   * @paramDef {"type":"String","label":"Posted Before","name":"postedBefore","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Only return events posted before this ISO 8601 date-time. Must be at least 2 minutes in the past. Default: 2 minutes ago."}
   * @paramDef {"type":"Number","label":"Max Results Per Page","name":"maxResultsPerPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of events per page. Range: 1-100. Default: 100."}
   * @paramDef {"type":"String","label":"Next Token","name":"nextToken","description":"Pagination token from a previous response's payload.NextToken."}
   *
   * @returns {Object}
   * @sampleResult {"payload":{"NextToken":"MRgZW55IGZhbmN5IHRva2Vu","FinancialEvents":{"ShipmentEventList":[{"AmazonOrderId":"902-3159896-1390916","PostedDate":"2026-01-06T12:00:00Z","ShipmentItemList":[{"SellerSKU":"WIDGET-001","QuantityShipped":1,"ItemChargeList":[{"ChargeType":"Principal","ChargeAmount":{"CurrencyCode":"USD","CurrencyAmount":49.99}}]}]}]}}}
   */
  async listFinancialEvents(postedAfter, postedBefore, maxResultsPerPage, nextToken) {
    return this.#apiRequest({
      logTag: 'listFinancialEvents',
      url: this.#apiUrl('/finances/v0/financialEvents'),
      query: {
        PostedAfter: postedAfter,
        PostedBefore: postedBefore,
        MaxResultsPerPage: maxResultsPerPage,
        NextToken: nextToken,
      },
    })
  }

  /**
   * @description Retrieves financial event groups (settlement periods), each with its processing status (Open or Closed), fund transfer status, total amount, and start/end dates. Useful for reconciling Amazon settlements with bank transfers. Results are paginated via payload.NextToken. Rate limit: about 0.5 requests per second (burst 10).
   *
   * @route GET /list-financial-event-groups
   * @operationName List Financial Event Groups
   * @category Finances
   *
   * @paramDef {"type":"String","label":"Started After","name":"startedAfter","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Only return event groups that started at or after this ISO 8601 date-time. Default: 90 days before Started Before."}
   * @paramDef {"type":"String","label":"Started Before","name":"startedBefore","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Only return event groups that started before this ISO 8601 date-time. Must be at least 2 minutes in the past. Default: 2 minutes ago."}
   * @paramDef {"type":"Number","label":"Max Results Per Page","name":"maxResultsPerPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of event groups per page. Range: 1-100. Default: 100."}
   * @paramDef {"type":"String","label":"Next Token","name":"nextToken","description":"Pagination token from a previous response's payload.NextToken."}
   *
   * @returns {Object}
   * @sampleResult {"payload":{"FinancialEventGroupList":[{"FinancialEventGroupId":"22YgYW55IGNhcm5hbCBwbGVhEXAMPLE","ProcessingStatus":"Closed","FundTransferStatus":"Succeeded","OriginalTotal":{"CurrencyCode":"USD","CurrencyAmount":1842.75},"FinancialEventGroupStart":"2025-12-15T00:00:00Z","FinancialEventGroupEnd":"2025-12-29T00:00:00Z"}]}}
   */
  async listFinancialEventGroups(startedAfter, startedBefore, maxResultsPerPage, nextToken) {
    return this.#apiRequest({
      logTag: 'listFinancialEventGroups',
      url: this.#apiUrl('/finances/v0/financialEventGroups'),
      query: {
        FinancialEventGroupStartedAfter: startedAfter,
        FinancialEventGroupStartedBefore: startedBefore,
        MaxResultsPerPage: maxResultsPerPage,
        NextToken: nextToken,
      },
    })
  }

  // ============================================== FEEDS ==============================================

  /**
   * @description Creates a feed document placeholder (Feeds API 2021-06-30), returning a feedDocumentId and a pre-signed upload URL (valid for 5 minutes). This is step 1 of submitting a feed: create the document, upload the feed content to the URL with Upload Feed Content, then submit it with Create Feed. Rate limit: about 0.5 requests per second (burst 15).
   *
   * @route POST /create-feed-document
   * @operationName Create Feed Document
   * @category Feeds
   *
   * @paramDef {"type":"String","label":"Content Type","name":"contentType","required":true,"defaultValue":"text/tab-separated-values; charset=UTF-8","description":"The content type of the feed data to be uploaded. Use 'text/tab-separated-values; charset=UTF-8' for flat-file feeds and 'application/json' for the JSON_LISTINGS_FEED."}
   *
   * @returns {Object}
   * @sampleResult {"feedDocumentId":"amzn1.tortuga.3.ex4mple-f33d-d0c","url":"https://tortuga-prod-na.s3.amazonaws.com/ex4mple?X-Amz-Algorithm=AWS4-HMAC-SHA256"}
   */
  async createFeedDocument(contentType) {
    if (!contentType) {
      throw new Error('"Content Type" is required')
    }

    return this.#apiRequest({
      logTag: 'createFeedDocument',
      method: 'post',
      url: this.#apiUrl('/feeds/2021-06-30/documents'),
      body: { contentType },
    })
  }

  /**
   * @description Uploads feed content to the pre-signed URL returned by Create Feed Document (step 2 of submitting a feed). The content is sent as the raw request body with the same content type declared when the feed document was created — the two must match or Amazon rejects the upload. The URL expires 5 minutes after creation, so upload promptly. Returns a success status.
   *
   * @route PUT /upload-feed-content
   * @operationName Upload Feed Content
   * @category Feeds
   *
   * @paramDef {"type":"String","label":"Upload URL","name":"uploadUrl","required":true,"description":"The pre-signed upload URL returned by Create Feed Document. Valid for 5 minutes."}
   * @paramDef {"type":"String","label":"Content","name":"content","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The feed content to upload, e.g. tab-separated flat-file rows or a JSON_LISTINGS_FEED JSON document."}
   * @paramDef {"type":"String","label":"Content Type","name":"contentType","required":true,"defaultValue":"text/tab-separated-values; charset=UTF-8","description":"The content type; must exactly match the one used in Create Feed Document."}
   *
   * @returns {Object}
   * @sampleResult {"status":"success"}
   */
  async uploadFeedContent(uploadUrl, content, contentType) {
    if (!uploadUrl) {
      throw new Error('"Upload URL" is required')
    }

    if (content === undefined || content === null || content === '') {
      throw new Error('"Content" is required')
    }

    try {
      // Pre-signed S3 URL; no SP-API auth headers must be attached.
      await Flowrunner.Request.put(uploadUrl)
        .set({ 'Content-Type': contentType || 'text/tab-separated-values; charset=UTF-8' })
        .send(content)

      return { status: 'success' }
    } catch (error) {
      logger.error(`uploadFeedContent - failed: ${ error.message }`)

      throw new Error(`Feed content upload failed: ${ error.message }`)
    }
  }

  /**
   * @description Submits a feed for processing (step 3 of submitting a feed), referencing the uploaded feed document. Pick a common feed type or enter any documented SP-API feedType value via the override parameter. Feed processing is asynchronous: use the returned feedId with Get Feed to poll the processing status. Rate limit: about 0.0083 requests per second (roughly 1 every 2 minutes, burst 15), so batch changes into as few feeds as possible.
   *
   * @route POST /create-feed
   * @operationName Create Feed
   * @category Feeds
   *
   * @paramDef {"type":"String","label":"Feed Type","name":"feedType","uiComponent":{"type":"DROPDOWN","options":{"values":["Inventory Loader (Flat File)","JSON Listings Feed"]}},"description":"A common feed type. 'Inventory Loader (Flat File)' submits POST_FLAT_FILE_INVLOADER_DATA; 'JSON Listings Feed' submits JSON_LISTINGS_FEED. Ignored when Feed Type Override is set."}
   * @paramDef {"type":"String","label":"Feed Type Override","name":"feedTypeOverride","description":"Any documented SP-API feedType enum value (e.g. 'POST_PRODUCT_PRICING_DATA'). Takes precedence over Feed Type."}
   * @paramDef {"type":"String","label":"Input Feed Document ID","name":"inputFeedDocumentId","required":true,"description":"The feedDocumentId returned by Create Feed Document, after the content has been uploaded."}
   * @paramDef {"type":"Array<String>","label":"Marketplace IDs","name":"marketplaceIds","dictionary":"getMarketplacesDictionary","description":"Marketplace ids the feed applies to. Defaults to the connected region's primary marketplace when omitted."}
   * @paramDef {"type":"Object","label":"Feed Options","name":"feedOptions","description":"Optional feed-type-specific options as a flat object of string values."}
   *
   * @returns {Object}
   * @sampleResult {"feedId":"3485934"}
   */
  async createFeed(feedType, feedTypeOverride, inputFeedDocumentId, marketplaceIds, feedOptions) {
    const resolvedFeedType = feedTypeOverride || this.#resolveChoice(feedType, FEED_TYPE_OPTIONS)

    if (!resolvedFeedType) {
      throw new Error('Either "Feed Type" or "Feed Type Override" is required')
    }

    if (!inputFeedDocumentId) {
      throw new Error('"Input Feed Document ID" is required')
    }

    return this.#apiRequest({
      logTag: 'createFeed',
      method: 'post',
      url: this.#apiUrl('/feeds/2021-06-30/feeds'),
      body: cleanupObject({
        feedType: resolvedFeedType,
        marketplaceIds: this.#resolveMarketplaceIds(marketplaceIds),
        inputFeedDocumentId,
        feedOptions,
      }),
    })
  }

  /**
   * @description Retrieves the status of a submitted feed by feed id, including its processingStatus (IN_QUEUE, IN_PROGRESS, DONE, CANCELLED, FATAL) and, once DONE, the resultFeedDocumentId containing Amazon's processing report with per-record errors and warnings. Rate limit: about 2 requests per second (burst 15).
   *
   * @route GET /get-feed
   * @operationName Get Feed
   * @category Feeds
   *
   * @paramDef {"type":"String","label":"Feed ID","name":"feedId","required":true,"description":"The feed id returned by Create Feed."}
   *
   * @returns {Object}
   * @sampleResult {"feedId":"3485934","feedType":"POST_FLAT_FILE_INVLOADER_DATA","processingStatus":"DONE","createdTime":"2026-01-06T10:00:00Z","processingStartTime":"2026-01-06T10:01:00Z","processingEndTime":"2026-01-06T10:04:30Z","marketplaceIds":["ATVPDKIKX0DER"],"resultFeedDocumentId":"amzn1.tortuga.3.ex4mple-r3sult-d0c"}
   */
  async getFeed(feedId) {
    if (!feedId) {
      throw new Error('"Feed ID" is required')
    }

    return this.#apiRequest({
      logTag: 'getFeed',
      url: this.#apiUrl(`/feeds/2021-06-30/feeds/${ encodeURIComponent(feedId) }`),
    })
  }
}

Flowrunner.ServerCode.addService(AmazonSellerCentralService, [
  {
    displayName: 'Client Id',
    defaultValue: '',
    name: 'clientId',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'The LWA (Login with Amazon) Client Identifier of your SP-API app, shown under "LWA credentials" in the Seller Central Developer Console (starts with amzn1.application-oa2-client.).',
  },
  {
    displayName: 'Client Secret',
    defaultValue: '',
    name: 'clientSecret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'The LWA (Login with Amazon) Client Secret of your SP-API app from the Seller Central Developer Console. Rotated secrets must be updated here.',
  },
  {
    displayName: 'Application ID',
    defaultValue: '',
    name: 'applicationId',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'The SP-API application id from the Seller Central Developer Console (format amzn1.sp.solution....). Used in the authorization consent URL.',
  },
  {
    displayName: 'Region',
    defaultValue: 'North America',
    name: 'region',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.CHOICE,
    options: ['North America', 'Europe', 'Far East'],
    required: true,
    shared: false,
    hint: 'The SP-API region of the seller account: North America (sellingpartnerapi-na), Europe incl. India (sellingpartnerapi-eu), or Far East (sellingpartnerapi-fe). Determines the Seller Central consent page and the API endpoint.',
  },
  {
    displayName: 'Draft App',
    defaultValue: false,
    name: 'draftApp',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.BOOL,
    required: false,
    shared: false,
    hint: 'Enable while your SP-API app is still in draft (not published): adds version=beta to the consent URL so draft apps can be authorized.',
  },
])

function cleanupObject(data) {
  const result = {}

  Object.keys(data).forEach(key => {
    if (data[key] !== undefined && data[key] !== null && data[key] !== '') {
      result[key] = data[key]
    }
  })

  return result
}

function isEmptyResponse(response) {
  if (response === undefined || response === null || response === '') {
    return true
  }

  return typeof response === 'object' && !Buffer.isBuffer(response) && Object.keys(response).length === 0
}
