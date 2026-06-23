// BigCommerce API Service — products, customers, orders, carts, inventory and
// price lists over the BigCommerce V2/V3 REST APIs, with OAuth2 (single-click app;
// permanent X-Auth-Token) and webhook-based triggers.

const crypto = require('crypto')

// ============================================================================
//  CONSTANTS
// ============================================================================
const OAUTH_AUTHORIZE_URL = 'https://login.bigcommerce.com/oauth2/authorize'
const OAUTH_TOKEN_URL = 'https://login.bigcommerce.com/oauth2/token'
const API_HOST = 'https://api.bigcommerce.com'

// store_hash arrives as the OAuth callback `context` (e.g. "stores/<hash>"). Every API call
// needs it, so it is embedded into the access token as a composite token — the platform
// passes `token` back on every invocation.
const TOKEN_CONTEXT_DELIMITER = '::ctx::'

// docs: https://developer.bigcommerce.com/docs/start/authentication/api-accounts
const DEFAULT_SCOPE_LIST = [
  'store_v2_orders',
  'store_v2_customers',
  'store_v2_products',
  'store_v2_information',
  'store_inventory',
  'store_marketing',
]
const DEFAULT_SCOPE_STRING = DEFAULT_SCOPE_LIST.join(' ')

// Shared secret header name used to authenticate inbound webhook deliveries (BigCommerce does
// not sign payloads — there is no X-BC-Signature; the secret header is the only callback auth).
const WEBHOOK_SECRET_HEADER = 'X-Flowrunner-Secret'

// REALTIME trigger event -> { scope, trigger method name }. The four handleTrigger* handlers
// create/delete /v3/hooks and authenticate callbacks via WEBHOOK_SECRET_HEADER.
const TRIGGER_EVENTS = {
  onOrderCreated: 'store/order/created',
  onOrderStatusUpdated: 'store/order/statusUpdated',
  onProductCreated: 'store/product/created',
  onProductUpdated: 'store/product/updated',
  onInventoryUpdated: 'store/product/inventory/updated',
  onCustomerCreated: 'store/customer/created',
}

// DROPDOWN friendly-label -> API-value maps. The UI shows the labels; #resolveChoice maps the
// selected label back to the value BigCommerce expects before it goes into a request body.
const PRODUCT_TYPE_MAP = { 'Physical Product': 'physical', 'Digital Product': 'digital' }

const INVENTORY_TRACKING_MAP = {
  'Not Tracked': 'none',
  'Track by Product': 'product',
  'Track by Variant': 'variant',
}

const MODIFIER_TYPE_MAP = {
  Dropdown: 'dropdown',
  'Radio Buttons': 'radio_buttons',
  Rectangles: 'rectangles',
  'Product List': 'product_list',
  'Product List With Images': 'product_list_with_images',
  Checkbox: 'checkbox',
  'Text Field': 'text',
  'Multi-line Text': 'multi_line_text',
  'Numbers Only Text': 'numbers_only_text',
  Date: 'date',
  'File Upload': 'file',
  Swatch: 'swatch',
}

const SHIPPING_PROVIDER_MAP = {
  'Custom / Other': '',
  UPS: 'ups',
  USPS: 'usps',
  FedEx: 'fedex',
  DHL: 'dhl',
  'Australia Post': 'auspost',
  'Canada Post': 'canadapost',
  'Royal Mail': 'royalmail',
}

// ============================================================================
//  LOGGER
// ============================================================================
const logger = {
  info: (...args) => console.log('[BigCommerce] info:', ...args),
  debug: (...args) => console.log('[BigCommerce] debug:', ...args),
  error: (...args) => console.log('[BigCommerce] error:', ...args),
  warn: (...args) => console.log('[BigCommerce] warn:', ...args),
}

// ============================================================================
//  DICTIONARY PAYLOAD TYPEDEFS
// ============================================================================
/**
 * @typedef {Object} getProductsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional keyword to filter products by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Page number for the next page of results."}
 */

/**
 * @typedef {Object} getVariantsDictionary__payloadCriteria
 * @paramDef {"type":"Number","label":"Product","name":"productId","required":true,"description":"The product whose variants to list."}
 */
/**
 * @typedef {Object} getVariantsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter variants by SKU."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Page number for the next page of results."}
 * @paramDef {"type":"getVariantsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Identifies the parent product."}
 */

/**
 * @typedef {Object} getCategoriesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter categories by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Page number for the next page of results."}
 */

/**
 * @typedef {Object} getBrandsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter brands by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Page number for the next page of results."}
 */

/**
 * @typedef {Object} getProductImagesDictionary__payloadCriteria
 * @paramDef {"type":"Number","label":"Product","name":"productId","required":true,"description":"The product whose images to list."}
 */
/**
 * @typedef {Object} getProductImagesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter images."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Page number for the next page of results."}
 * @paramDef {"type":"getProductImagesDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Identifies the parent product."}
 */

/**
 * @typedef {Object} getProductCustomFieldsDictionary__payloadCriteria
 * @paramDef {"type":"Number","label":"Product","name":"productId","required":true,"description":"The product whose custom fields to list."}
 */
/**
 * @typedef {Object} getProductCustomFieldsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter custom fields."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Page number for the next page of results."}
 * @paramDef {"type":"getProductCustomFieldsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Identifies the parent product."}
 */

/**
 * @typedef {Object} getProductModifiersDictionary__payloadCriteria
 * @paramDef {"type":"Number","label":"Product","name":"productId","required":true,"description":"The product whose modifiers to list."}
 */
/**
 * @typedef {Object} getProductModifiersDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter modifiers."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Page number for the next page of results."}
 * @paramDef {"type":"getProductModifiersDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Identifies the parent product."}
 */

/**
 * @typedef {Object} getCustomersDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter customers by email."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Page number for the next page of results."}
 */

/**
 * @typedef {Object} getCustomerAddressesDictionary__payloadCriteria
 * @paramDef {"type":"Number","label":"Customer","name":"customerId","required":true,"description":"The customer whose addresses to list."}
 */
/**
 * @typedef {Object} getCustomerAddressesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter addresses."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Page number for the next page of results."}
 * @paramDef {"type":"getCustomerAddressesDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Identifies the parent customer."}
 */

/**
 * @typedef {Object} getCustomerGroupsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter customer groups."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Page number for the next page of results."}
 */

/**
 * @typedef {Object} getOrdersDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter orders."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Page number for the next page of results."}
 */

/**
 * @typedef {Object} getOrderStatusesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter statuses."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Page number for the next page of results."}
 */

/**
 * @typedef {Object} getOrderAddressesDictionary__payloadCriteria
 * @paramDef {"type":"Number","label":"Order","name":"orderId","required":true,"description":"The order whose shipping addresses to list."}
 */
/**
 * @typedef {Object} getOrderAddressesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter addresses."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Page number for the next page of results."}
 * @paramDef {"type":"getOrderAddressesDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Identifies the parent order."}
 */

/**
 * @typedef {Object} getOrderShipmentsDictionary__payloadCriteria
 * @paramDef {"type":"Number","label":"Order","name":"orderId","required":true,"description":"The order whose shipments to list."}
 */
/**
 * @typedef {Object} getOrderShipmentsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter shipments."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Page number for the next page of results."}
 * @paramDef {"type":"getOrderShipmentsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Identifies the parent order."}
 */

/**
 * @typedef {Object} getPriceListsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter price lists."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Page number for the next page of results."}
 */

/**
 * @typedef {Object} getLocationsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter inventory locations."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Page number for the next page of results."}
 */

/**
 * @typedef {Object} getOrderProductsDictionary__payloadCriteria
 * @paramDef {"type":"Number","label":"Order","name":"orderId","required":true,"description":"The order whose line items to list."}
 */
/**
 * @typedef {Object} getOrderProductsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter line items."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Page number for the next page of results."}
 * @paramDef {"type":"getOrderProductsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Identifies the parent order."}
 */

/**
 * @integrationName BigCommerce
 * @integrationIcon /icon.svg
 * @requireOAuth
 * @integrationTriggersScope SINGLE_APP
 */
class BigCommerce {
  constructor(config) {
    this.config = config || {}
    this.clientId = this.config.clientId
    this.clientSecret = this.config.clientSecret
    this.scopes = DEFAULT_SCOPE_STRING
  }

  // ==========================================================================
  //  CORE — every external (authenticated) call goes through #apiRequest
  // ==========================================================================
  async #apiRequest({ url, method, body, query, logTag }) {
    method = method || 'get'

    try {
      logger.debug(`${ logTag } ${ method.toUpperCase() } ${ url }`)

      const request = Flowrunner.Request[method](url)
        .set(this.#headers())
        .query(query || {})

      if (body !== undefined && body !== null) {
        return await request.send(body)
      }

      return await request
    } catch (error) {
      this.#handleError(error, logTag)
    }
  }

  #headers() {
    return {
      'X-Auth-Token': this.#getAuthToken(),
      Accept: 'application/json',
      'Content-Type': 'application/json',
    }
  }

  #handleError(error, logTag) {
    const status = error?.status || error?.body?.status
    const apiMessage =
      error?.body?.title ||
      error?.body?.error?.message ||
      error?.body?.message ||
      (Array.isArray(error?.body) && error.body[0]?.message) ||
      error?.message ||
      'Request failed'

    const hints = {
      401: 'Authentication failed — reconnect the BigCommerce account.',
      403: 'Permission denied — the connected app may be missing an OAuth scope.',
      404: 'Not found — the ID may be wrong; use the matching "Get …" action to pick a valid one.',
      422: 'Validation failed — check required fields and value formats.',
      429: 'Rate limit hit — retry in a moment.',
    }
    const hint = hints[status]

    logger.error(`${ logTag } failed: ${ apiMessage }`)

    throw new Error(hint ? `${ hint } (${ apiMessage })` : apiMessage)
  }

  // Composite token = "<access-token>::ctx::stores/<store-hash>" (see OAuth docs).
  #getCompositeToken() {
    const compositeToken = this.request.headers['oauth-access-token']

    if (!compositeToken) {
      throw new Error('Access token is not available. Please reconnect your BigCommerce account.')
    }

    return compositeToken
  }

  #getAuthToken() {
    return this.#getCompositeToken().split(TOKEN_CONTEXT_DELIMITER)[0]
  }

  // Returns the store context path, e.g. "stores/<store-hash>".
  #getContext() {
    const context = this.#getCompositeToken().split(TOKEN_CONTEXT_DELIMITER)[1]

    if (!context) {
      throw new Error('Store context is not available. Please reconnect your BigCommerce account.')
    }

    return context
  }

  #v3(path) {
    return `${ API_HOST }/${ this.#getContext() }/v3${ path }`
  }

  #v2(path) {
    return `${ API_HOST }/${ this.#getContext() }/v2${ path }`
  }

  // Drops undefined/null/'' values so optional fields and either-or order lines serialize cleanly.
  #compact(obj) {
    const out = {}

    for (const [key, value] of Object.entries(obj)) {
      if (value !== undefined && value !== null && value !== '') {
        out[key] = value
      }
    }

    return out
  }

  // Maps a friendly DROPDOWN label to the API value via the given mapping; passes through
  // unknown/empty values unchanged so free-form input still works.
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // ==========================================================================
  //  OAUTH2 SYSTEM METHODS  (single-click app flow; permanent token; no refresh)
  // ==========================================================================
  #getAccessToken() {
    return this.#getAuthToken()
  }

  /**
   * @registerAs SYSTEM
   * @route GET /getOAuth2ConnectionURL
   */
  async getOAuth2ConnectionURL() {
    // redirect_uri is injected by the Flowrunner OAuth runtime — must NOT be added here.
    // docs: https://developer.bigcommerce.com/docs/integrations/apps/guide/auth
    const params = new URLSearchParams({
      client_id: this.clientId,
      response_type: 'code',
      scope: this.scopes,
    })

    return `${ OAUTH_AUTHORIZE_URL }?${ params.toString() }`
  }

  /**
   * @registerAs SYSTEM
   * @route POST /executeCallback
   * @param {Object} callbackObject
   */
  async executeCallback(callbackObject) {
    // docs: https://developer.bigcommerce.com/docs/integrations/apps/guide/auth
    // Single-click flow returns a PERMANENT access_token (no refresh_token) plus the store
    // context ("stores/<store-hash>"). The context is embedded into `token` so every later
    // request can build the store-scoped base URL.
    const response = await Flowrunner.Request.post(OAUTH_TOKEN_URL)
      .set({ 'Content-Type': 'application/json', Accept: 'application/json' })
      .send({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code: callbackObject.code,
        scope: callbackObject.scope || this.scopes,
        grant_type: 'authorization_code',
        redirect_uri: callbackObject.redirectURI,
        context: callbackObject.context,
      })

    const context = response.context

    return {
      token: `${ response.access_token }${ TOKEN_CONTEXT_DELIMITER }${ context }`,
      connectionIdentityName: response.user?.email || context,
      overwrite: true,
      userData: { context, accountUuid: response.account_uuid, email: response.user?.email },
    }
  }

  /**
   * @registerAs SYSTEM
   * @route PUT /refreshToken
   * @param {String} refreshToken
   */
  async refreshToken(refreshToken) {
    // BigCommerce single-click tokens are PERMANENT — no refresh_token is issued. Return the
    // existing composite token unchanged. docs:
    // https://developer.bigcommerce.com/docs/integrations/apps/guide/auth
    const compositeToken = this.request.headers['oauth-access-token'] || refreshToken

    return { token: compositeToken }
  }

  // ==========================================================================
  //  ACTIONS — Catalog: Products
  // ==========================================================================
  /**
   * @operationName Create Product
   * @category Products
   * @description Creates a new product in the store catalog. Use this to add an item shoppers can buy; assign it to categories and a brand, and decide how its stock is tracked.
   * @route POST /create-product
   * @paramDef {"type":"String","label":"Product Name","name":"name","required":true,"description":"The product's display name."}
   * @paramDef {"type":"String","label":"Price","name":"price","required":true,"description":"Default price of the product (e.g. \"10.00\")."}
   * @paramDef {"type":"String","label":"Product Type","name":"type","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Physical Product","Digital Product"]}},"description":"Whether the product ships physically or is delivered digitally."}
   * @paramDef {"type":"Number","label":"Weight","name":"weight","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Product weight in the store's default unit. Required for physical products."}
   * @paramDef {"type":"String","label":"SKU","name":"sku","description":"Optional stock-keeping unit. Leave blank to assign none."}
   * @paramDef {"type":"Array.<Number>","label":"Categories","name":"categories","dictionary":"getCategoriesDictionary","description":"Category IDs to assign this product to. Use Get Categories to pick them."}
   * @paramDef {"type":"String","label":"Brand","name":"brandId","dictionary":"getBrandsDictionary","description":"The brand to associate with this product. Use Get Brands to pick one."}
   * @paramDef {"type":"String","label":"Inventory Tracking","name":"inventoryTracking","uiComponent":{"type":"DROPDOWN","options":{"values":["Not Tracked","Track by Product","Track by Variant"]}},"description":"How stock is tracked. Set to Track by Product to manage a single stock count via Set Inventory Level. Defaults to Not Tracked."}
   * @paramDef {"type":"Number","label":"Inventory Level","name":"inventoryLevel","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Current stock count. ONLY takes effect when Inventory Tracking is Track by Product; otherwise it is silently ignored. For reliable stock changes use Set Inventory Level."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Rich product description (HTML allowed)."}
   * @paramDef {"type":"Boolean","label":"Visible On Storefront","name":"isVisible","uiComponent":{"type":"TOGGLE"},"description":"Whether the product is shown on the storefront. Defaults to true."}
   * @returns {Object}
   * @sampleResult {"data":{"id":111,"name":"BigCommerce Coffee Mug","sku":"","price":"10.00","type":"physical","weight":4,"categories":[23,21],"is_visible":true},"meta":{}}
   */
  async createProduct(name, price, type, weight, sku, categories, brandId, inventoryTracking, inventoryLevel, description, isVisible) {
    // docs: https://developer.bigcommerce.com/docs/rest-catalog/products
    const body = this.#compact({
      name,
      price,
      type: this.#resolveChoice(type, PRODUCT_TYPE_MAP),
      weight,
      sku,
      categories: Array.isArray(categories) && categories.length ? categories : undefined,
      brand_id: brandId,
      inventory_tracking: this.#resolveChoice(inventoryTracking, INVENTORY_TRACKING_MAP),
      inventory_level: inventoryLevel,
      description,
      is_visible: isVisible,
    })

    return await this.#apiRequest({ url: this.#v3('/catalog/products'), method: 'post', body, logTag: 'createProduct' })
  }

  /**
   * @operationName Get Product
   * @category Products
   * @description Retrieves a single product by its ID, including price, type and current inventory. Use after picking a product to inspect its full detail.
   * @route POST /get-product
   * @paramDef {"type":"String","label":"Product","name":"productId","required":true,"dictionary":"getProductsDictionary","description":"The product to retrieve. Use Get Products to pick one."}
   * @returns {Object}
   * @sampleResult {"data":{"id":111,"name":"BigCommerce Coffee Mug","price":"10.00","type":"physical","inventory_level":50},"meta":{}}
   */
  async getProduct(productId) {
    return await this.#apiRequest({ url: this.#v3(`/catalog/products/${ productId }`), logTag: 'getProduct' })
  }

  /**
   * @operationName List Products
   * @category Products
   * @description Returns a page of products, optionally filtered by a search keyword. Use to browse the catalog or find a product before acting on it.
   * @route POST /list-products
   * @paramDef {"type":"String","label":"Search Keyword","name":"keyword","description":"Free-text search across product name/description. Leave blank for all products."}
   * @paramDef {"type":"Number","label":"Results Per Page","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":50,"description":"How many products to return per page (max 250). Defaults to 50."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":1,"description":"Page number of results to return. Defaults to 1."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":111,"name":"BigCommerce Coffee Mug","price":"10.00","type":"physical"}],"meta":{"pagination":{"total":1,"count":1,"per_page":50,"current_page":1,"total_pages":1}}}
   */
  async listProducts(keyword, limit, page) {
    const query = this.#compact({ keyword, limit: limit || 50, page: page || 1 })

    return await this.#apiRequest({ url: this.#v3('/catalog/products'), query, logTag: 'listProducts' })
  }

  /**
   * @operationName Update Product
   * @category Products
   * @description Updates an existing product's fields such as name, price or visibility. Note: setting Inventory Level here only takes effect when the product's tracking is "Track by Product"; otherwise it is silently ignored — use Set Inventory Level for reliable stock changes.
   * @route POST /update-product
   * @paramDef {"type":"String","label":"Product","name":"productId","required":true,"dictionary":"getProductsDictionary","description":"The product to update. Use Get Products to pick one."}
   * @paramDef {"type":"String","label":"Product Name","name":"name","description":"New display name. Leave blank to keep the current name."}
   * @paramDef {"type":"String","label":"Price","name":"price","description":"New default price (e.g. \"12.00\"). Leave blank to keep current."}
   * @paramDef {"type":"Boolean","label":"Visible On Storefront","name":"isVisible","uiComponent":{"type":"TOGGLE"},"description":"Show or hide the product on the storefront."}
   * @paramDef {"type":"Number","label":"Inventory Level","name":"inventoryLevel","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"New stock count. Takes effect ONLY if the product's tracking is Track by Product; otherwise use Set Inventory Level."}
   * @returns {Object}
   * @sampleResult {"data":{"id":111,"name":"Updated Mug","price":"12.00","is_visible":true},"meta":{}}
   */
  async updateProduct(productId, name, price, isVisible, inventoryLevel) {
    // docs: https://developer.bigcommerce.com/api-reference/store-management/catalog/products/updateproduct
    const body = this.#compact({ name, price, is_visible: isVisible, inventory_level: inventoryLevel })

    return await this.#apiRequest({ url: this.#v3(`/catalog/products/${ productId }`), method: 'put', body, logTag: 'updateProduct' })
  }

  /**
   * @operationName Delete Product
   * @category Products
   * @description Permanently deletes a product from the catalog. Use with care — this cannot be undone.
   * @route POST /delete-product
   * @paramDef {"type":"String","label":"Product","name":"productId","required":true,"dictionary":"getProductsDictionary","description":"The product to permanently delete. Use Get Products to pick one."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"productId":111}
   */
  async deleteProduct(productId) {
    // docs: https://developer.bigcommerce.com/docs/rest-catalog/products
    await this.#apiRequest({ url: this.#v3(`/catalog/products/${ productId }`), method: 'delete', logTag: 'deleteProduct' })

    return { deleted: true, productId }
  }

  // ==========================================================================
  //  ACTIONS — Catalog: Product Variants
  // ==========================================================================
  /**
   * @operationName Create Product Variant
   * @category Product Variants
   * @description Creates a single variant of a product (e.g. a specific size/color). Variants are created one at a time and are distinguished by their option values.
   * @route POST /create-product-variant
   * @paramDef {"type":"String","label":"Product","name":"productId","required":true,"dictionary":"getProductsDictionary","description":"The product this variant belongs to. Use Get Products to pick one."}
   * @paramDef {"type":"String","label":"SKU","name":"sku","required":true,"description":"Unique stock-keeping unit for this variant."}
   * @paramDef {"type":"Array.<Object>","label":"Option Values","name":"optionValues","required":true,"schemaLoader":"createVariantOptionValuesSchema","description":"The variant's option selections, each with an option_id and a value id. Required to distinguish a variant."}
   * @paramDef {"type":"Number","label":"Price Override","name":"price","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional price that overrides the product's default price for this variant."}
   * @paramDef {"type":"Number","label":"Inventory Level","name":"inventoryLevel","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Stock count for this variant (used when the product tracks inventory by variant)."}
   * @returns {Object}
   * @sampleResult {"data":{"id":74,"product_id":111,"sku":"MUG-RED","price":11.0,"option_values":[{"id":65,"option_id":12}]},"meta":{}}
   */
  async createProductVariant(productId, sku, optionValues, price, inventoryLevel) {
    // docs: https://developer.bigcommerce.com/docs/rest-catalog/product-variants
    const body = this.#compact({
      sku,
      option_values: optionValues,
      price,
      inventory_level: inventoryLevel,
    })

    return await this.#apiRequest({ url: this.#v3(`/catalog/products/${ productId }/variants`), method: 'post', body, logTag: 'createProductVariant' })
  }

  /**
   * @operationName Get Product Variant
   * @category Product Variants
   * @description Retrieves a single variant of a product by its ID. Use to inspect a variant's SKU, price and inventory.
   * @route POST /get-product-variant
   * @paramDef {"type":"String","label":"Product","name":"productId","required":true,"dictionary":"getProductsDictionary","description":"The product the variant belongs to. Use Get Products to pick one."}
   * @paramDef {"type":"String","label":"Variant","name":"variantId","required":true,"dictionary":"getVariantsDictionary","dependsOn":["productId"],"description":"The variant to retrieve. Use Get Variants to pick one."}
   * @returns {Object}
   * @sampleResult {"data":{"id":74,"product_id":111,"sku":"MUG-RED","price":11.0},"meta":{}}
   */
  async getProductVariant(productId, variantId) {
    return await this.#apiRequest({ url: this.#v3(`/catalog/products/${ productId }/variants/${ variantId }`), logTag: 'getProductVariant' })
  }

  /**
   * @operationName List Product Variants
   * @category Product Variants
   * @description Lists all variants of a product. Use to see the available sizes/colors before updating or pricing them.
   * @route POST /list-product-variants
   * @paramDef {"type":"String","label":"Product","name":"productId","required":true,"dictionary":"getProductsDictionary","description":"The product whose variants to list. Use Get Products to pick one."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":74,"product_id":111,"sku":"MUG-RED","price":11.0}],"meta":{"pagination":{"total":1}}}
   */
  async listProductVariants(productId) {
    return await this.#apiRequest({ url: this.#v3(`/catalog/products/${ productId }/variants`), logTag: 'listProductVariants' })
  }

  /**
   * @operationName Update Product Variant
   * @category Product Variants
   * @description Updates a variant's price override or inventory level. Use to adjust a specific size/color of a product.
   * @route POST /update-product-variant
   * @paramDef {"type":"String","label":"Product","name":"productId","required":true,"dictionary":"getProductsDictionary","description":"The product the variant belongs to. Use Get Products to pick one."}
   * @paramDef {"type":"String","label":"Variant","name":"variantId","required":true,"dictionary":"getVariantsDictionary","dependsOn":["productId"],"description":"The variant to update. Use Get Variants to pick one."}
   * @paramDef {"type":"Number","label":"Price Override","name":"price","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"New price override for this variant. Leave blank to keep current."}
   * @paramDef {"type":"Number","label":"Inventory Level","name":"inventoryLevel","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"New stock count for this variant."}
   * @returns {Object}
   * @sampleResult {"data":{"id":74,"product_id":111,"sku":"MUG-RED","price":12.0},"meta":{}}
   */
  async updateProductVariant(productId, variantId, price, inventoryLevel) {
    // docs: https://developer.bigcommerce.com/docs/rest-catalog/product-variants
    const body = this.#compact({ price, inventory_level: inventoryLevel })

    return await this.#apiRequest({ url: this.#v3(`/catalog/products/${ productId }/variants/${ variantId }`), method: 'put', body, logTag: 'updateProductVariant' })
  }

  /**
   * @operationName Delete Product Variant
   * @category Product Variants
   * @description Deletes a single variant from a product. Use with care — this cannot be undone.
   * @route POST /delete-product-variant
   * @paramDef {"type":"String","label":"Product","name":"productId","required":true,"dictionary":"getProductsDictionary","description":"The product the variant belongs to. Use Get Products to pick one."}
   * @paramDef {"type":"String","label":"Variant","name":"variantId","required":true,"dictionary":"getVariantsDictionary","dependsOn":["productId"],"description":"The variant to delete. Use Get Variants to pick one."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"variantId":74}
   */
  async deleteProductVariant(productId, variantId) {
    // docs: https://developer.bigcommerce.com/docs/rest-catalog/product-variants
    await this.#apiRequest({ url: this.#v3(`/catalog/products/${ productId }/variants/${ variantId }`), method: 'delete', logTag: 'deleteProductVariant' })

    return { deleted: true, variantId }
  }

  // ==========================================================================
  //  ACTIONS — Catalog: Product Images
  // ==========================================================================
  /**
   * @operationName Create Product Image
   * @category Product Images
   * @description Adds an image to a product from a publicly accessible URL (GIF/JPEG/PNG, max 8MB). Use to set a product photo or its main thumbnail.
   * @route POST /create-product-image
   * @paramDef {"type":"String","label":"Product","name":"productId","required":true,"dictionary":"getProductsDictionary","description":"The product to attach the image to. Use Get Products to pick one."}
   * @paramDef {"type":"String","label":"Image URL","name":"imageUrl","required":true,"description":"Publicly accessible URL of a GIF/JPEG/PNG image (max 8MB)."}
   * @paramDef {"type":"Boolean","label":"Use As Thumbnail","name":"isThumbnail","uiComponent":{"type":"TOGGLE"},"description":"Make this the product's main thumbnail image."}
   * @paramDef {"type":"String","label":"Alt Text / Description","name":"description","description":"Optional descriptive text / alt text for the image."}
   * @returns {Object}
   * @sampleResult {"data":{"id":9,"product_id":111,"image_url":"https://cdn.example.com/mug.png","is_thumbnail":true},"meta":{}}
   */
  async createProductImage(productId, imageUrl, isThumbnail, description) {
    // docs: https://developer.bigcommerce.com/docs/rest-catalog/products/images
    const body = this.#compact({ image_url: imageUrl, is_thumbnail: isThumbnail, description })

    return await this.#apiRequest({ url: this.#v3(`/catalog/products/${ productId }/images`), method: 'post', body, logTag: 'createProductImage' })
  }

  /**
   * @operationName List Product Images
   * @category Product Images
   * @description Lists all images attached to a product. Use to find an image's ID before deleting it.
   * @route POST /list-product-images
   * @paramDef {"type":"String","label":"Product","name":"productId","required":true,"dictionary":"getProductsDictionary","description":"The product whose images to list. Use Get Products to pick one."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":9,"product_id":111,"image_url":"https://cdn.example.com/mug.png","is_thumbnail":true}],"meta":{"pagination":{"total":1}}}
   */
  async listProductImages(productId) {
    return await this.#apiRequest({ url: this.#v3(`/catalog/products/${ productId }/images`), logTag: 'listProductImages' })
  }

  /**
   * @operationName Delete Product Image
   * @category Product Images
   * @description Deletes an image from a product. Use List Product Images to find the image ID.
   * @route POST /delete-product-image
   * @paramDef {"type":"String","label":"Product","name":"productId","required":true,"dictionary":"getProductsDictionary","description":"The product the image belongs to. Use Get Products to pick one."}
   * @paramDef {"type":"String","label":"Image","name":"imageId","required":true,"dictionary":"getProductImagesDictionary","dependsOn":["productId"],"description":"The image to delete. Use List Product Images to find its ID."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"imageId":9}
   */
  async deleteProductImage(productId, imageId) {
    // docs: https://developer.bigcommerce.com/docs/rest-catalog/products/images
    await this.#apiRequest({ url: this.#v3(`/catalog/products/${ productId }/images/${ imageId }`), method: 'delete', logTag: 'deleteProductImage' })

    return { deleted: true, imageId }
  }

  // ==========================================================================
  //  ACTIONS — Catalog: Product Custom Fields
  // ==========================================================================
  /**
   * @operationName Create Product Custom Field
   * @category Product Custom Fields
   * @description Adds a custom name/value field to a product (e.g. Material = Ceramic). Use for extra product attributes shown on the storefront.
   * @route POST /create-product-custom-field
   * @paramDef {"type":"String","label":"Product","name":"productId","required":true,"dictionary":"getProductsDictionary","description":"The product to add the custom field to. Use Get Products to pick one."}
   * @paramDef {"type":"String","label":"Field Name","name":"name","required":true,"description":"The custom field's name (e.g. \"Material\")."}
   * @paramDef {"type":"String","label":"Field Value","name":"value","required":true,"description":"The custom field's value (e.g. \"Ceramic\")."}
   * @returns {Object}
   * @sampleResult {"data":{"id":3,"name":"Material","value":"Ceramic"},"meta":{}}
   */
  async createProductCustomField(productId, name, value) {
    // docs: https://developer.bigcommerce.com/docs/rest-catalog/products/custom-fields
    const body = { name, value }

    return await this.#apiRequest({ url: this.#v3(`/catalog/products/${ productId }/custom-fields`), method: 'post', body, logTag: 'createProductCustomField' })
  }

  /**
   * @operationName List Product Custom Fields
   * @category Product Custom Fields
   * @description Lists a product's custom fields. Use to find a custom field's ID before updating or deleting it.
   * @route POST /list-product-custom-fields
   * @paramDef {"type":"String","label":"Product","name":"productId","required":true,"dictionary":"getProductsDictionary","description":"The product whose custom fields to list. Use Get Products to pick one."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":3,"name":"Material","value":"Ceramic"}],"meta":{"pagination":{"total":1}}}
   */
  async listProductCustomFields(productId) {
    return await this.#apiRequest({ url: this.#v3(`/catalog/products/${ productId }/custom-fields`), logTag: 'listProductCustomFields' })
  }

  /**
   * @operationName Update Product Custom Field
   * @category Product Custom Fields
   * @description Updates a product's custom field name or value. Use List Product Custom Fields to find the field ID.
   * @route POST /update-product-custom-field
   * @paramDef {"type":"String","label":"Product","name":"productId","required":true,"dictionary":"getProductsDictionary","description":"The product the custom field belongs to. Use Get Products to pick one."}
   * @paramDef {"type":"String","label":"Custom Field","name":"customFieldId","required":true,"dictionary":"getProductCustomFieldsDictionary","dependsOn":["productId"],"description":"The custom field to update. Use List Product Custom Fields to find its ID."}
   * @paramDef {"type":"String","label":"Field Name","name":"name","description":"New field name. Leave blank to keep current."}
   * @paramDef {"type":"String","label":"Field Value","name":"value","description":"New field value. Leave blank to keep current."}
   * @returns {Object}
   * @sampleResult {"data":{"id":3,"name":"Material","value":"Porcelain"},"meta":{}}
   */
  async updateProductCustomField(productId, customFieldId, name, value) {
    // docs: https://developer.bigcommerce.com/docs/rest-catalog/products/custom-fields
    const body = this.#compact({ name, value })

    return await this.#apiRequest({ url: this.#v3(`/catalog/products/${ productId }/custom-fields/${ customFieldId }`), method: 'put', body, logTag: 'updateProductCustomField' })
  }

  /**
   * @operationName Delete Product Custom Field
   * @category Product Custom Fields
   * @description Deletes a custom field from a product. Use List Product Custom Fields to find the field ID.
   * @route POST /delete-product-custom-field
   * @paramDef {"type":"String","label":"Product","name":"productId","required":true,"dictionary":"getProductsDictionary","description":"The product the custom field belongs to. Use Get Products to pick one."}
   * @paramDef {"type":"String","label":"Custom Field","name":"customFieldId","required":true,"dictionary":"getProductCustomFieldsDictionary","dependsOn":["productId"],"description":"The custom field to delete. Use List Product Custom Fields to find its ID."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"customFieldId":3}
   */
  async deleteProductCustomField(productId, customFieldId) {
    // docs: https://developer.bigcommerce.com/docs/rest-catalog/products/custom-fields
    await this.#apiRequest({ url: this.#v3(`/catalog/products/${ productId }/custom-fields/${ customFieldId }`), method: 'delete', logTag: 'deleteProductCustomField' })

    return { deleted: true, customFieldId }
  }

  // ==========================================================================
  //  ACTIONS — Catalog: Product Modifiers
  // ==========================================================================
  /**
   * @operationName Create Product Modifier
   * @category Product Modifiers
   * @description Adds a modifier (an extra purchase option such as engraving or gift wrap) to a product. Choose the input type shoppers use and whether it is required.
   * @route POST /create-product-modifier
   * @paramDef {"type":"String","label":"Product","name":"productId","required":true,"dictionary":"getProductsDictionary","description":"The product to add the modifier to. Use Get Products to pick one."}
   * @paramDef {"type":"String","label":"Modifier Type","name":"type","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Dropdown","Radio Buttons","Rectangles","Product List","Product List With Images","Checkbox","Text Field","Multi-line Text","Numbers Only Text","Date","File Upload","Swatch"]}},"description":"The kind of input shoppers use for this option (e.g. text, dropdown, file upload)."}
   * @paramDef {"type":"Boolean","label":"Required At Checkout","name":"required","required":true,"uiComponent":{"type":"TOGGLE"},"description":"Whether shoppers must fill in this modifier before purchasing."}
   * @paramDef {"type":"String","label":"Display Name","name":"displayName","description":"Label shown to shoppers (e.g. \"Engraving\")."}
   * @returns {Object}
   * @sampleResult {"data":{"id":21,"product_id":111,"type":"text","required":false,"display_name":"Engraving"},"meta":{}}
   */
  async createProductModifier(productId, type, required, displayName) {
    // docs: https://developer.bigcommerce.com/docs/rest-catalog/product-modifiers#create-a-product-modifier
    const body = this.#compact({ type: this.#resolveChoice(type, MODIFIER_TYPE_MAP), required, display_name: displayName })

    return await this.#apiRequest({ url: this.#v3(`/catalog/products/${ productId }/modifiers`), method: 'post', body, logTag: 'createProductModifier' })
  }

  /**
   * @operationName List Product Modifiers
   * @category Product Modifiers
   * @description Lists a product's modifiers. Use to find a modifier's ID before updating or deleting it.
   * @route POST /list-product-modifiers
   * @paramDef {"type":"String","label":"Product","name":"productId","required":true,"dictionary":"getProductsDictionary","description":"The product whose modifiers to list. Use Get Products to pick one."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":21,"product_id":111,"type":"text","display_name":"Engraving"}],"meta":{"pagination":{"total":1}}}
   */
  async listProductModifiers(productId) {
    return await this.#apiRequest({ url: this.#v3(`/catalog/products/${ productId }/modifiers`), logTag: 'listProductModifiers' })
  }

  /**
   * @operationName Update Product Modifier
   * @category Product Modifiers
   * @description Updates a product modifier's display name or required flag. Use List Product Modifiers to find the modifier ID.
   * @route POST /update-product-modifier
   * @paramDef {"type":"String","label":"Product","name":"productId","required":true,"dictionary":"getProductsDictionary","description":"The product the modifier belongs to. Use Get Products to pick one."}
   * @paramDef {"type":"String","label":"Modifier","name":"modifierId","required":true,"dictionary":"getProductModifiersDictionary","dependsOn":["productId"],"description":"The modifier to update. Use List Product Modifiers to find its ID."}
   * @paramDef {"type":"String","label":"Display Name","name":"displayName","description":"New label shown to shoppers. Leave blank to keep current."}
   * @paramDef {"type":"Boolean","label":"Required At Checkout","name":"required","uiComponent":{"type":"TOGGLE"},"description":"Whether shoppers must fill in this modifier."}
   * @returns {Object}
   * @sampleResult {"data":{"id":21,"product_id":111,"type":"text","required":true,"display_name":"Engraving"},"meta":{}}
   */
  async updateProductModifier(productId, modifierId, displayName, required) {
    // docs: https://developer.bigcommerce.com/docs/rest-catalog/product-modifiers
    const body = this.#compact({ display_name: displayName, required })

    return await this.#apiRequest({ url: this.#v3(`/catalog/products/${ productId }/modifiers/${ modifierId }`), method: 'put', body, logTag: 'updateProductModifier' })
  }

  /**
   * @operationName Delete Product Modifier
   * @category Product Modifiers
   * @description Deletes a modifier from a product. Use List Product Modifiers to find the modifier ID.
   * @route POST /delete-product-modifier
   * @paramDef {"type":"String","label":"Product","name":"productId","required":true,"dictionary":"getProductsDictionary","description":"The product the modifier belongs to. Use Get Products to pick one."}
   * @paramDef {"type":"String","label":"Modifier","name":"modifierId","required":true,"dictionary":"getProductModifiersDictionary","dependsOn":["productId"],"description":"The modifier to delete. Use List Product Modifiers to find its ID."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"modifierId":21}
   */
  async deleteProductModifier(productId, modifierId) {
    // docs: https://developer.bigcommerce.com/docs/rest-catalog/product-modifiers
    await this.#apiRequest({ url: this.#v3(`/catalog/products/${ productId }/modifiers/${ modifierId }`), method: 'delete', logTag: 'deleteProductModifier' })

    return { deleted: true, modifierId }
  }

  // ==========================================================================
  //  ACTIONS — Catalog: Categories
  // ==========================================================================
  /**
   * @operationName Create Category
   * @category Categories
   * @description Creates a storefront category. Use parent 0 for a top-level category or pick a parent to nest it. Categories organize products in navigation.
   * @route POST /create-category
   * @paramDef {"type":"String","label":"Category Name","name":"name","required":true,"description":"Display name of the category; must be unique among its siblings."}
   * @paramDef {"type":"String","label":"Parent Category","name":"parentId","required":true,"dictionary":"getCategoriesDictionary","defaultValue":0,"description":"Parent category ID. Use 0 for a top-level category, or pick a parent."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional storefront description (HTML allowed)."}
   * @paramDef {"type":"Boolean","label":"Visible On Storefront","name":"isVisible","uiComponent":{"type":"TOGGLE"},"description":"Whether the category shows in storefront navigation. Defaults to true."}
   * @returns {Object}
   * @sampleResult {"data":{"id":36,"parent_id":18,"name":"Shoes","is_visible":true},"meta":{}}
   */
  async createCategory(name, parentId, description, isVisible) {
    // docs: https://developer.bigcommerce.com/docs/rest-catalog/categories
    const body = this.#compact({
      name,
      parent_id: parentId === undefined || parentId === null ? 0 : parentId,
      description,
      is_visible: isVisible,
    })

    return await this.#apiRequest({ url: this.#v3('/catalog/categories'), method: 'post', body, logTag: 'createCategory' })
  }

  /**
   * @operationName Get Category
   * @category Categories
   * @description Retrieves a single category by its ID. Use to inspect a category's details.
   * @route POST /get-category
   * @paramDef {"type":"String","label":"Category","name":"categoryId","required":true,"dictionary":"getCategoriesDictionary","description":"The category to retrieve. Use Get Categories to pick one."}
   * @returns {Object}
   * @sampleResult {"data":{"id":36,"parent_id":18,"name":"Shoes","is_visible":true},"meta":{}}
   */
  async getCategory(categoryId) {
    return await this.#apiRequest({ url: this.#v3(`/catalog/categories/${ categoryId }`), logTag: 'getCategory' })
  }

  /**
   * @operationName List Categories
   * @category Categories
   * @description Returns a page of categories. Use to browse the category tree or find a category before acting on it.
   * @route POST /list-categories
   * @paramDef {"type":"Number","label":"Results Per Page","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":50,"description":"How many categories to return per page (max 250). Defaults to 50."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":1,"description":"Page number of results. Defaults to 1."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":36,"parent_id":18,"name":"Shoes"}],"meta":{"pagination":{"total":1}}}
   */
  async listCategories(limit, page) {
    const query = this.#compact({ limit: limit || 50, page: page || 1 })

    return await this.#apiRequest({ url: this.#v3('/catalog/categories'), query, logTag: 'listCategories' })
  }

  /**
   * @operationName Update Category
   * @category Categories
   * @description Updates a category's name or visibility. Use Get Categories to pick the category.
   * @route POST /update-category
   * @paramDef {"type":"String","label":"Category","name":"categoryId","required":true,"dictionary":"getCategoriesDictionary","description":"The category to update. Use Get Categories to pick one."}
   * @paramDef {"type":"String","label":"Category Name","name":"name","description":"New display name. Leave blank to keep current."}
   * @paramDef {"type":"Boolean","label":"Visible On Storefront","name":"isVisible","uiComponent":{"type":"TOGGLE"},"description":"Show or hide the category."}
   * @returns {Object}
   * @sampleResult {"data":{"id":36,"parent_id":18,"name":"Footwear","is_visible":true},"meta":{}}
   */
  async updateCategory(categoryId, name, isVisible) {
    // docs: https://developer.bigcommerce.com/docs/rest-catalog/categories
    const body = this.#compact({ name, is_visible: isVisible })

    return await this.#apiRequest({ url: this.#v3(`/catalog/categories/${ categoryId }`), method: 'put', body, logTag: 'updateCategory' })
  }

  /**
   * @operationName Delete Category
   * @category Categories
   * @description Deletes a category from the catalog. Use with care — products in it lose this category assignment.
   * @route POST /delete-category
   * @paramDef {"type":"String","label":"Category","name":"categoryId","required":true,"dictionary":"getCategoriesDictionary","description":"The category to delete. Use Get Categories to pick one."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"categoryId":36}
   */
  async deleteCategory(categoryId) {
    // docs: https://developer.bigcommerce.com/docs/rest-catalog/categories
    await this.#apiRequest({ url: this.#v3(`/catalog/categories/${ categoryId }`), method: 'delete', logTag: 'deleteCategory' })

    return { deleted: true, categoryId }
  }

  // ==========================================================================
  //  ACTIONS — Catalog: Brands
  // ==========================================================================
  /**
   * @operationName Create Brand
   * @category Brands
   * @description Creates a brand that products can be associated with. Brand names must be unique.
   * @route POST /create-brand
   * @paramDef {"type":"String","label":"Brand Name","name":"name","required":true,"description":"Name of the brand; must be unique."}
   * @paramDef {"type":"String","label":"Page Title","name":"pageTitle","description":"Optional SEO page title for the brand page."}
   * @paramDef {"type":"String","label":"Logo Image URL","name":"imageUrl","description":"Optional publicly accessible URL of the brand logo image."}
   * @paramDef {"type":"Array.<String>","label":"Meta Keywords","name":"metaKeywords","description":"Optional SEO keywords for the brand page (comma-separated)."}
   * @returns {Object}
   * @sampleResult {"data":{"id":40,"name":"BigCommerce","page_title":"BigCommerce"},"meta":{}}
   */
  async createBrand(name, pageTitle, imageUrl, metaKeywords) {
    // docs: https://developer.bigcommerce.com/api-reference/store-management/catalog/brands/createbrand
    const keywords = Array.isArray(metaKeywords)
      ? metaKeywords
      : metaKeywords
        ? String(metaKeywords).split(',').map(s => s.trim()).filter(Boolean)
        : undefined

    const body = this.#compact({
      name,
      page_title: pageTitle,
      image_url: imageUrl,
      meta_keywords: keywords && keywords.length ? keywords : undefined,
    })

    return await this.#apiRequest({ url: this.#v3('/catalog/brands'), method: 'post', body, logTag: 'createBrand' })
  }

  /**
   * @operationName Get Brand
   * @category Brands
   * @description Retrieves a single brand by its ID. Use to inspect a brand's details.
   * @route POST /get-brand
   * @paramDef {"type":"String","label":"Brand","name":"brandId","required":true,"dictionary":"getBrandsDictionary","description":"The brand to retrieve. Use Get Brands to pick one."}
   * @returns {Object}
   * @sampleResult {"data":{"id":40,"name":"BigCommerce","page_title":"BigCommerce"},"meta":{}}
   */
  async getBrand(brandId) {
    return await this.#apiRequest({ url: this.#v3(`/catalog/brands/${ brandId }`), logTag: 'getBrand' })
  }

  /**
   * @operationName List Brands
   * @category Brands
   * @description Returns a page of brands. Use to browse brands or find one before acting on it.
   * @route POST /list-brands
   * @paramDef {"type":"Number","label":"Results Per Page","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":50,"description":"How many brands per page (max 250). Defaults to 50."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":1,"description":"Page number of results. Defaults to 1."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":40,"name":"BigCommerce"}],"meta":{"pagination":{"total":1}}}
   */
  async listBrands(limit, page) {
    const query = this.#compact({ limit: limit || 50, page: page || 1 })

    return await this.#apiRequest({ url: this.#v3('/catalog/brands'), query, logTag: 'listBrands' })
  }

  /**
   * @operationName Update Brand
   * @category Brands
   * @description Updates a brand's name or logo. Use Get Brands to pick the brand.
   * @route POST /update-brand
   * @paramDef {"type":"String","label":"Brand","name":"brandId","required":true,"dictionary":"getBrandsDictionary","description":"The brand to update. Use Get Brands to pick one."}
   * @paramDef {"type":"String","label":"Brand Name","name":"name","description":"New brand name. Leave blank to keep current."}
   * @paramDef {"type":"String","label":"Logo Image URL","name":"imageUrl","description":"New brand logo image URL."}
   * @returns {Object}
   * @sampleResult {"data":{"id":40,"name":"BigCommerce Inc","page_title":"BigCommerce"},"meta":{}}
   */
  async updateBrand(brandId, name, imageUrl) {
    // docs: https://developer.bigcommerce.com/api-reference/store-management/catalog/brands/createbrand
    const body = this.#compact({ name, image_url: imageUrl })

    return await this.#apiRequest({ url: this.#v3(`/catalog/brands/${ brandId }`), method: 'put', body, logTag: 'updateBrand' })
  }

  /**
   * @operationName Delete Brand
   * @category Brands
   * @description Deletes a brand. Use with care — products lose this brand association.
   * @route POST /delete-brand
   * @paramDef {"type":"String","label":"Brand","name":"brandId","required":true,"dictionary":"getBrandsDictionary","description":"The brand to delete. Use Get Brands to pick one."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"brandId":40}
   */
  async deleteBrand(brandId) {
    // docs: https://developer.bigcommerce.com/api-reference/store-management/catalog/brands/createbrand
    await this.#apiRequest({ url: this.#v3(`/catalog/brands/${ brandId }`), method: 'delete', logTag: 'deleteBrand' })

    return { deleted: true, brandId }
  }

  // ==========================================================================
  //  ACTIONS — Inventory (V3 adjustments)
  // ==========================================================================
  /**
   * @operationName Set Inventory Level
   * @category Inventory
   * @description Set a variant's stock count to an exact number at a location. This is the RELIABLE way to set stock — it avoids the product-level inventory_tracking pitfall.
   * @route POST /set-inventory-level
   * @paramDef {"type":"String","label":"Variant","name":"variantId","required":true,"dictionary":"getVariantsDictionary","description":"The variant whose stock to set. Use Get Variants to pick one."}
   * @paramDef {"type":"Number","label":"New Quantity","name":"quantity","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The exact stock count to set (overrides the current count)."}
   * @paramDef {"type":"String","label":"Location","name":"locationId","dictionary":"getLocationsDictionary","defaultValue":1,"description":"Inventory location ID. Defaults to 1 (the store's default location)."}
   * @paramDef {"type":"String","label":"Reason","name":"reason","defaultValue":"Set via FlowRunner","description":"Optional note describing why stock was set (audit trail)."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"adj_1"},"meta":{}}
   */
  async adjustInventoryAbsolute(variantId, quantity, locationId, reason) {
    // docs: https://developer.bigcommerce.com/docs/rest-management/inventory/adjustments
    const body = {
      reason: reason || 'Set via FlowRunner',
      items: [{ location_id: locationId || 1, variant_id: variantId, quantity }],
    }

    return await this.#apiRequest({ url: this.#v3('/inventory/adjustments/absolute'), method: 'put', body, logTag: 'adjustInventoryAbsolute' })
  }

  /**
   * @operationName Adjust Inventory Level
   * @category Inventory
   * @description Add to or subtract from a variant's current stock count at a location (use a negative quantity to subtract). Use when you want a delta rather than an exact value.
   * @route POST /adjust-inventory-level
   * @paramDef {"type":"String","label":"Variant","name":"variantId","required":true,"dictionary":"getVariantsDictionary","description":"The variant whose stock to adjust. Use Get Variants to pick one."}
   * @paramDef {"type":"Number","label":"Quantity Change","name":"quantity","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Amount to add (positive) or subtract (negative) from current stock."}
   * @paramDef {"type":"String","label":"Location","name":"locationId","dictionary":"getLocationsDictionary","defaultValue":1,"description":"Inventory location ID. Defaults to 1 (the store's default location)."}
   * @paramDef {"type":"String","label":"Reason","name":"reason","defaultValue":"Adjusted via FlowRunner","description":"Optional note describing the adjustment (audit trail)."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"adj_2"},"meta":{}}
   */
  async adjustInventoryRelative(variantId, quantity, locationId, reason) {
    // docs: https://developer.bigcommerce.com/docs/rest-management/inventory/adjustments
    const body = {
      reason: reason || 'Adjusted via FlowRunner',
      items: [{ location_id: locationId || 1, variant_id: variantId, quantity }],
    }

    return await this.#apiRequest({ url: this.#v3('/inventory/adjustments/relative'), method: 'put', body, logTag: 'adjustInventoryRelative' })
  }

  // ==========================================================================
  //  ACTIONS — Customers (V3, ARRAY body)
  // ==========================================================================
  /**
   * @operationName Create Customer
   * @category Customers
   * @description Creates a customer account in the store. Email must be unique. Optionally assign the customer to a customer group.
   * @route POST /create-customer
   * @paramDef {"type":"String","label":"First Name","name":"firstName","required":true,"description":"Customer's first name."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","required":true,"description":"Customer's last name."}
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"description":"Customer's email address; must be unique in the store."}
   * @paramDef {"type":"String","label":"Company","name":"company","description":"Optional company name."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"Optional phone number."}
   * @paramDef {"type":"String","label":"Customer Group","name":"customerGroupId","dictionary":"getCustomerGroupsDictionary","description":"Optional customer group to assign. Use Get Customer Groups to pick one."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":12,"first_name":"John","last_name":"Doe","email":"john.doe@example.com"}],"meta":{}}
   */
  async createCustomer(firstName, lastName, email, company, phone, customerGroupId) {
    // docs: https://developer.bigcommerce.com/docs/rest-management/customers  (V3 POST body is an ARRAY)
    const customer = this.#compact({
      first_name: firstName,
      last_name: lastName,
      email,
      company,
      phone,
      customer_group_id: customerGroupId,
    })

    return await this.#apiRequest({ url: this.#v3('/customers'), method: 'post', body: [customer], logTag: 'createCustomer' })
  }

  /**
   * @operationName Get Customer
   * @category Customers
   * @description Retrieves a single customer by ID. Use to inspect a customer's profile.
   * @route POST /get-customer
   * @paramDef {"type":"String","label":"Customer","name":"customerId","required":true,"dictionary":"getCustomersDictionary","description":"The customer to retrieve. Use Get Customers to pick one."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":12,"first_name":"John","last_name":"Doe","email":"john.doe@example.com"}],"meta":{}}
   */
  async getCustomer(customerId) {
    return await this.#apiRequest({ url: this.#v3('/customers'), query: { 'id:in': customerId }, logTag: 'getCustomer' })
  }

  /**
   * @operationName List Customers
   * @category Customers
   * @description Returns a page of customers, optionally filtered by email. Use to browse or find a customer before acting on them.
   * @route POST /list-customers
   * @paramDef {"type":"String","label":"Email Contains","name":"emailFilter","description":"Filter customers whose email contains this text. Leave blank for all."}
   * @paramDef {"type":"Number","label":"Results Per Page","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":50,"description":"How many customers per page (max 250). Defaults to 50."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":1,"description":"Page number of results. Defaults to 1."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":12,"first_name":"John","last_name":"Doe","email":"john.doe@example.com"}],"meta":{"pagination":{"total":1}}}
   */
  async listCustomers(emailFilter, limit, page) {
    // API: https://developer.bigcommerce.com/docs/start/about/common-query-params
    // `:in` matches a value against a list exactly (e.g. `email:in=janedoe@example.com`), while
    // `:like` is a substring/wildcard ("contains") match. The "Email Contains" filter therefore
    // uses `email:like`, not `email:in`.
    const query = this.#compact({ 'email:like': emailFilter, limit: limit || 50, page: page || 1 })

    return await this.#apiRequest({ url: this.#v3('/customers'), query, logTag: 'listCustomers' })
  }

  /**
   * @operationName Update Customer
   * @category Customers
   * @description Updates a customer's name, email or group. Use Get Customers to pick the customer.
   * @route POST /update-customer
   * @paramDef {"type":"String","label":"Customer","name":"customerId","required":true,"dictionary":"getCustomersDictionary","description":"The customer to update. Use Get Customers to pick one."}
   * @paramDef {"type":"String","label":"First Name","name":"firstName","description":"New first name. Leave blank to keep current."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","description":"New last name. Leave blank to keep current."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"New email address. Leave blank to keep current."}
   * @paramDef {"type":"String","label":"Customer Group","name":"customerGroupId","dictionary":"getCustomerGroupsDictionary","description":"Reassign to a customer group. Use Get Customer Groups to pick one."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":12,"first_name":"Jonathan","last_name":"Doe","email":"john.doe@example.com"}],"meta":{}}
   */
  async updateCustomer(customerId, firstName, lastName, email, customerGroupId) {
    // docs: https://developer.bigcommerce.com/docs/rest-management/customers  (V3 PUT body is an ARRAY; each item has id)
    const customer = this.#compact({
      id: customerId,
      first_name: firstName,
      last_name: lastName,
      email,
      customer_group_id: customerGroupId,
    })

    return await this.#apiRequest({ url: this.#v3('/customers'), method: 'put', body: [customer], logTag: 'updateCustomer' })
  }

  /**
   * @operationName Delete Customer
   * @category Customers
   * @description Deletes a customer account. Use with care — this cannot be undone.
   * @route POST /delete-customer
   * @paramDef {"type":"String","label":"Customer","name":"customerId","required":true,"dictionary":"getCustomersDictionary","description":"The customer to delete. Use Get Customers to pick one."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"customerId":12}
   */
  async deleteCustomer(customerId) {
    // docs: https://developer.bigcommerce.com/docs/rest-management/customers
    await this.#apiRequest({ url: this.#v3('/customers'), method: 'delete', query: { 'id:in': customerId }, logTag: 'deleteCustomer' })

    return { deleted: true, customerId }
  }

  // ==========================================================================
  //  ACTIONS — Customer Addresses (V3, ARRAY body)
  // ==========================================================================
  /**
   * @operationName Create Customer Address
   * @category Customer Addresses
   * @description Adds an address to a customer. Use Get Customers to pick the customer; provide the full postal address.
   * @route POST /create-customer-address
   * @paramDef {"type":"String","label":"Customer","name":"customerId","required":true,"dictionary":"getCustomersDictionary","description":"The customer this address belongs to. Use Get Customers to pick one."}
   * @paramDef {"type":"String","label":"First Name","name":"firstName","required":true,"description":"Recipient first name."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","required":true,"description":"Recipient last name."}
   * @paramDef {"type":"String","label":"Street Address","name":"address1","required":true,"description":"Street address line 1."}
   * @paramDef {"type":"String","label":"City","name":"city","required":true,"description":"City."}
   * @paramDef {"type":"String","label":"State / Province","name":"stateOrProvince","required":true,"description":"State or province."}
   * @paramDef {"type":"String","label":"Postal Code","name":"postalCode","required":true,"description":"ZIP / postal code."}
   * @paramDef {"type":"String","label":"Country Code","name":"countryCode","required":true,"description":"Two-letter ISO country code (e.g. US, GB)."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":7,"customer_id":12,"address1":"123 Main St","city":"Austin","country_code":"US"}],"meta":{}}
   */
  async createCustomerAddress(customerId, firstName, lastName, address1, city, stateOrProvince, postalCode, countryCode) {
    // docs: https://developer.bigcommerce.com/api-reference/store-management/customers-v3/customer-addresses/customersaddressespost
    const address = this.#compact({
      customer_id: customerId,
      first_name: firstName,
      last_name: lastName,
      address1,
      city,
      state_or_province: stateOrProvince,
      postal_code: postalCode,
      country_code: countryCode,
    })

    return await this.#apiRequest({ url: this.#v3('/customers/addresses'), method: 'post', body: [address], logTag: 'createCustomerAddress' })
  }

  /**
   * @operationName List Customer Addresses
   * @category Customer Addresses
   * @description Lists a customer's saved addresses. Use to find an address ID before updating or deleting it.
   * @route POST /list-customer-addresses
   * @paramDef {"type":"String","label":"Customer","name":"customerId","required":true,"dictionary":"getCustomersDictionary","description":"The customer whose addresses to list. Use Get Customers to pick one."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":7,"customer_id":12,"address1":"123 Main St","city":"Austin","country_code":"US"}],"meta":{"pagination":{"total":1}}}
   */
  async listCustomerAddresses(customerId) {
    return await this.#apiRequest({ url: this.#v3('/customers/addresses'), query: { 'customer_id:in': customerId }, logTag: 'listCustomerAddresses' })
  }

  /**
   * @operationName Update Customer Address
   * @category Customer Addresses
   * @description Updates a customer address. Use List Customer Addresses to find the address ID; the customer ID is also required.
   * @route POST /update-customer-address
   * @paramDef {"type":"String","label":"Address","name":"addressId","required":true,"dictionary":"getCustomerAddressesDictionary","dependsOn":["customerId"],"description":"The address to update. Use List Customer Addresses to find its ID."}
   * @paramDef {"type":"String","label":"Customer","name":"customerId","required":true,"dictionary":"getCustomersDictionary","description":"The customer the address belongs to (required by the API on update). Use Get Customers."}
   * @paramDef {"type":"String","label":"Street Address","name":"address1","description":"New street address line 1. Leave blank to keep current."}
   * @paramDef {"type":"String","label":"City","name":"city","description":"New city. Leave blank to keep current."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":7,"customer_id":12,"address1":"456 Oak Ave","city":"Dallas","country_code":"US"}],"meta":{}}
   */
  async updateCustomerAddress(addressId, customerId, address1, city) {
    // docs: https://developer.bigcommerce.com/api-reference/store-management/customers-v3/customer-addresses/customersaddressespost
    const address = this.#compact({ id: addressId, customer_id: customerId, address1, city })

    return await this.#apiRequest({ url: this.#v3('/customers/addresses'), method: 'put', body: [address], logTag: 'updateCustomerAddress' })
  }

  /**
   * @operationName Delete Customer Address
   * @category Customer Addresses
   * @description Deletes a customer address. Use List Customer Addresses to find the address ID.
   * @route POST /delete-customer-address
   * @paramDef {"type":"String","label":"Address","name":"addressId","required":true,"dictionary":"getCustomerAddressesDictionary","description":"The address to delete. Use List Customer Addresses to find its ID."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"addressId":7}
   */
  async deleteCustomerAddress(addressId) {
    // docs: https://developer.bigcommerce.com/api-reference/store-management/customers-v3/customer-addresses/customersaddressespost
    await this.#apiRequest({ url: this.#v3('/customers/addresses'), method: 'delete', query: { 'id:in': addressId }, logTag: 'deleteCustomerAddress' })

    return { deleted: true, addressId }
  }

  // ==========================================================================
  //  ACTIONS — Customer Groups (V2, bare response)
  // ==========================================================================
  /**
   * @operationName Create Customer Group
   * @category Customer Groups
   * @description Creates a customer group (e.g. Wholesale) used for pricing and access rules. Customer groups live on the V2 API.
   * @route POST /create-customer-group
   * @paramDef {"type":"String","label":"Group Name","name":"name","required":true,"description":"Name of the customer group (e.g. \"Wholesale\")."}
   * @paramDef {"type":"Boolean","label":"Default Group","name":"isDefault","uiComponent":{"type":"TOGGLE"},"description":"Make this the default group new customers are assigned to."}
   * @returns {Object}
   * @sampleResult {"id":3,"name":"Wholesale","is_default":false}
   */
  async createCustomerGroup(name, isDefault) {
    // docs: https://developer.bigcommerce.com/api-reference/customer-subscribers/customers-api/customer-groups/createacustomergroup
    const body = this.#compact({ name, is_default: isDefault })

    return await this.#apiRequest({ url: this.#v2('/customer_groups'), method: 'post', body, logTag: 'createCustomerGroup' })
  }

  /**
   * @operationName Get Customer Group
   * @category Customer Groups
   * @description Retrieves a single customer group by ID. Use to inspect a group's details.
   * @route POST /get-customer-group
   * @paramDef {"type":"String","label":"Customer Group","name":"groupId","required":true,"dictionary":"getCustomerGroupsDictionary","description":"The customer group to retrieve. Use Get Customer Groups to pick one."}
   * @returns {Object}
   * @sampleResult {"id":3,"name":"Wholesale","is_default":false}
   */
  async getCustomerGroup(groupId) {
    return await this.#apiRequest({ url: this.#v2(`/customer_groups/${ groupId }`), logTag: 'getCustomerGroup' })
  }

  /**
   * @operationName List Customer Groups
   * @category Customer Groups
   * @description Returns a page of customer groups. Use to browse groups or find one before acting on it.
   * @route POST /list-customer-groups
   * @paramDef {"type":"Number","label":"Results Per Page","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":50,"description":"How many groups per page. Defaults to 50."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":1,"description":"Page number of results. Defaults to 1."}
   * @returns {Object}
   * @sampleResult [{"id":3,"name":"Wholesale","is_default":false}]
   */
  async listCustomerGroups(limit, page) {
    const query = this.#compact({ limit: limit || 50, page: page || 1 })

    return await this.#apiRequest({ url: this.#v2('/customer_groups'), query, logTag: 'listCustomerGroups' })
  }

  /**
   * @operationName Update Customer Group
   * @category Customer Groups
   * @description Updates a customer group's name or default flag. Use Get Customer Groups to pick the group.
   * @route POST /update-customer-group
   * @paramDef {"type":"String","label":"Customer Group","name":"groupId","required":true,"dictionary":"getCustomerGroupsDictionary","description":"The group to update. Use Get Customer Groups to pick one."}
   * @paramDef {"type":"String","label":"Group Name","name":"name","description":"New group name. Leave blank to keep current."}
   * @paramDef {"type":"Boolean","label":"Default Group","name":"isDefault","uiComponent":{"type":"TOGGLE"},"description":"Make this the default group."}
   * @returns {Object}
   * @sampleResult {"id":3,"name":"Wholesale Plus","is_default":false}
   */
  async updateCustomerGroup(groupId, name, isDefault) {
    // docs: https://developer.bigcommerce.com/api-reference/customer-subscribers/customers-api/customer-groups/createacustomergroup
    const body = this.#compact({ name, is_default: isDefault })

    return await this.#apiRequest({ url: this.#v2(`/customer_groups/${ groupId }`), method: 'put', body, logTag: 'updateCustomerGroup' })
  }

  /**
   * @operationName Delete Customer Group
   * @category Customer Groups
   * @description Deletes a customer group. Use with care — members revert to no group.
   * @route POST /delete-customer-group
   * @paramDef {"type":"String","label":"Customer Group","name":"groupId","required":true,"dictionary":"getCustomerGroupsDictionary","description":"The group to delete. Use Get Customer Groups to pick one."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"groupId":3}
   */
  async deleteCustomerGroup(groupId) {
    // docs: https://developer.bigcommerce.com/api-reference/customer-subscribers/customers-api/customer-groups/createacustomergroup
    await this.#apiRequest({ url: this.#v2(`/customer_groups/${ groupId }`), method: 'delete', logTag: 'deleteCustomerGroup' })

    return { deleted: true, groupId }
  }

  // ==========================================================================
  //  ACTIONS — Orders (V2, bare response)
  // ==========================================================================
  /**
   * @operationName Create Order
   * @category Orders
   * @description Create an order directly (e.g. phone/manual orders). Provide a billing address and at least one product line — either a catalog product (product_id) or a custom line (name + prices).
   * @route POST /create-order
   * @paramDef {"type":"Object","label":"Billing Address","name":"billingAddress","required":true,"schemaLoader":"createOrderBillingAddressSchema","description":"The buyer's billing address."}
   * @paramDef {"type":"Array.<Object>","label":"Products","name":"products","required":true,"schemaLoader":"createOrderProductsSchema","description":"One or more order line items. Each line is either a catalog product (product_id + quantity) or a custom line (name + quantity + price_inc_tax + price_ex_tax)."}
   * @paramDef {"type":"String","label":"Customer","name":"customerId","dictionary":"getCustomersDictionary","description":"Optional existing customer to attach to the order. Use Get Customers to pick one."}
   * @paramDef {"type":"String","label":"Order Status","name":"statusId","dictionary":"getOrderStatusesDictionary","description":"Initial order status. Defaults to status 1 (Pending). Use Get Order Statuses to pick one."}
   * @paramDef {"type":"String","label":"Customer Message","name":"customerMessage","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional message/note from the customer."}
   * @returns {Object}
   * @sampleResult {"id":100,"status_id":1,"status":"Pending","customer_id":12,"total_inc_tax":"50.00"}
   */
  async createOrder(billingAddress, products, customerId, statusId, customerMessage) {
    // docs: https://developer.bigcommerce.com/docs/rest-management/orders
    const lines = (products || []).map(line => this.#compact({
      product_id: line.product_id,
      quantity: line.quantity,
      name: line.name,
      price_inc_tax: line.price_inc_tax,
      price_ex_tax: line.price_ex_tax,
    }))

    const body = this.#compact({
      billing_address: billingAddress,
      products: lines,
      customer_id: customerId,
      status_id: statusId,
      customer_message: customerMessage,
    })

    return await this.#apiRequest({ url: this.#v2('/orders'), method: 'post', body, logTag: 'createOrder' })
  }

  /**
   * @operationName Get Order
   * @category Orders
   * @description Retrieves a single order by ID, including status and totals. Use to inspect an order.
   * @route POST /get-order
   * @paramDef {"type":"String","label":"Order","name":"orderId","required":true,"dictionary":"getOrdersDictionary","description":"The order to retrieve. Use Get Orders to pick one."}
   * @returns {Object}
   * @sampleResult {"id":100,"status_id":1,"status":"Pending","customer_id":12,"total_inc_tax":"50.00"}
   */
  async getOrder(orderId) {
    return await this.#apiRequest({ url: this.#v2(`/orders/${ orderId }`), logTag: 'getOrder' })
  }

  /**
   * @operationName List Orders
   * @category Orders
   * @description Returns a page of orders, optionally filtered by status or customer. Use to find orders to fulfill or refund.
   * @route POST /list-orders
   * @paramDef {"type":"String","label":"Filter By Status","name":"statusId","dictionary":"getOrderStatusesDictionary","description":"Only return orders in this status. Leave blank for all. Use Get Order Statuses to pick one."}
   * @paramDef {"type":"String","label":"Filter By Customer","name":"customerId","dictionary":"getCustomersDictionary","description":"Only return orders for this customer. Use Get Customers to pick one."}
   * @paramDef {"type":"Number","label":"Results Per Page","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":50,"description":"How many orders per page (max 250). Defaults to 50."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":1,"description":"Page number of results. Defaults to 1."}
   * @returns {Object}
   * @sampleResult [{"id":100,"status_id":1,"status":"Pending","customer_id":12,"total_inc_tax":"50.00"}]
   */
  async listOrders(statusId, customerId, limit, page) {
    const query = this.#compact({ status_id: statusId, customer_id: customerId, limit: limit || 50, page: page || 1 })

    return await this.#apiRequest({ url: this.#v2('/orders'), query, logTag: 'listOrders' })
  }

  /**
   * @operationName Update Order
   * @category Orders
   * @description Update an existing order's fields (e.g. customer message, staff notes). To change only the order's status, use Update Order Status.
   * @route POST /update-order
   * @paramDef {"type":"String","label":"Order","name":"orderId","required":true,"dictionary":"getOrdersDictionary","description":"The order to update. Use Get Orders to pick one."}
   * @paramDef {"type":"String","label":"Customer Message","name":"customerMessage","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New customer message/note. Leave blank to keep current."}
   * @paramDef {"type":"String","label":"Staff Notes","name":"staffNotes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Internal staff notes on the order."}
   * @returns {Object}
   * @sampleResult {"id":100,"status_id":1,"status":"Pending","staff_notes":"Called customer"}
   */
  async updateOrder(orderId, customerMessage, staffNotes) {
    // docs: https://developer.bigcommerce.com/docs/rest-management/orders
    const body = this.#compact({ customer_message: customerMessage, staff_notes: staffNotes })

    return await this.#apiRequest({ url: this.#v2(`/orders/${ orderId }`), method: 'put', body, logTag: 'updateOrder' })
  }

  /**
   * @operationName Update Order Status
   * @category Orders
   * @description Transition an order to a different status (e.g. Awaiting Fulfillment, Shipped, Completed). Use Get Order Statuses to pick the new status.
   * @route POST /update-order-status
   * @paramDef {"type":"String","label":"Order","name":"orderId","required":true,"dictionary":"getOrdersDictionary","description":"The order whose status to change. Use Get Orders to pick one."}
   * @paramDef {"type":"String","label":"New Status","name":"statusId","required":true,"dictionary":"getOrderStatusesDictionary","description":"The status to move the order to. Use Get Order Statuses to pick one."}
   * @returns {Object}
   * @sampleResult {"id":100,"status_id":11,"status":"Awaiting Fulfillment"}
   */
  async updateOrderStatus(orderId, statusId) {
    // docs: https://developer.bigcommerce.com/docs/rest-management/orders
    const body = { status_id: statusId }

    return await this.#apiRequest({ url: this.#v2(`/orders/${ orderId }`), method: 'put', body, logTag: 'updateOrderStatus' })
  }

  // ==========================================================================
  //  ACTIONS — Order sub-resources (read)
  // ==========================================================================
  /**
   * @operationName List Order Products
   * @category Orders
   * @description Lists the line items (products) of an order. Use to find order_product_id values for creating shipments or refunds.
   * @route POST /list-order-products
   * @paramDef {"type":"String","label":"Order","name":"orderId","required":true,"dictionary":"getOrdersDictionary","description":"The order whose line items to list. Use Get Orders to pick one."}
   * @returns {Object}
   * @sampleResult [{"id":5,"order_id":100,"product_id":111,"name":"BigCommerce Coffee Mug","quantity":1,"price_inc_tax":"50.0000"}]
   */
  async listOrderProducts(orderId) {
    return await this.#apiRequest({ url: this.#v2(`/orders/${ orderId }/products`), logTag: 'listOrderProducts' })
  }

  /**
   * @operationName List Order Coupons
   * @category Orders
   * @description Lists the coupons applied to an order. Use to see discounts on an order.
   * @route POST /list-order-coupons
   * @paramDef {"type":"String","label":"Order","name":"orderId","required":true,"dictionary":"getOrdersDictionary","description":"The order whose applied coupons to list. Use Get Orders to pick one."}
   * @returns {Object}
   * @sampleResult [{"id":2,"coupon_id":9,"order_id":100,"code":"SAVE10","amount":"5.0000","type":1}]
   */
  async listOrderCoupons(orderId) {
    return await this.#apiRequest({ url: this.#v2(`/orders/${ orderId }/coupons`), logTag: 'listOrderCoupons' })
  }

  /**
   * @operationName List Order Statuses
   * @category Orders
   * @description List all order statuses configured for the store (id + name). Use this to find the status_id for Update Order Status.
   * @route POST /list-order-statuses
   * @returns {Object}
   * @sampleResult [{"id":1,"name":"Pending","system_label":"Pending","custom_label":"Pending"},{"id":11,"name":"Awaiting Fulfillment"}]
   */
  async listOrderStatuses() {
    return await this.#apiRequest({ url: this.#v2('/order_statuses'), logTag: 'listOrderStatuses' })
  }

  // ==========================================================================
  //  ACTIONS — Order Shipments (V2)
  // ==========================================================================
  /**
   * @operationName Create Order Shipment
   * @category Order Shipments
   * @description Creates a shipment for an order, marking items as shipped with optional tracking. The order must already have products and a shipping address.
   * @route POST /create-order-shipment
   * @paramDef {"type":"String","label":"Order","name":"orderId","required":true,"dictionary":"getOrdersDictionary","description":"The order to create a shipment for. Use Get Orders to pick one."}
   * @paramDef {"type":"String","label":"Shipping Address","name":"orderAddressId","required":true,"dictionary":"getOrderAddressesDictionary","dependsOn":["orderId"],"description":"The order's shipping address ID to ship to."}
   * @paramDef {"type":"Array.<Object>","label":"Shipped Items","name":"items","required":true,"schemaLoader":"createShipmentItemsSchema","dependsOn":["orderId"],"description":"The order products being shipped, each with an order_product_id and quantity."}
   * @paramDef {"type":"String","label":"Tracking Number","name":"trackingNumber","description":"Carrier tracking number for the shipment."}
   * @paramDef {"type":"String","label":"Shipping Provider","name":"shippingProvider","uiComponent":{"type":"DROPDOWN","options":{"values":["Custom / Other","UPS","USPS","FedEx","DHL","Australia Post","Canada Post","Royal Mail"]}},"description":"Carrier handling the shipment."}
   * @paramDef {"type":"String","label":"Comments","name":"comments","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional note about the shipment."}
   * @returns {Object}
   * @sampleResult {"id":1,"order_id":100,"tracking_number":"1Z999","shipping_provider":"ups","items":[{"order_product_id":5,"quantity":1}]}
   */
  async createOrderShipment(orderId, orderAddressId, items, trackingNumber, shippingProvider, comments) {
    // docs: https://developer.bigcommerce.com/docs/rest-management/orders/order-shipments
    const body = this.#compact({
      order_address_id: orderAddressId,
      items,
      tracking_number: trackingNumber,
      shipping_provider: this.#resolveChoice(shippingProvider, SHIPPING_PROVIDER_MAP),
      comments,
    })

    return await this.#apiRequest({ url: this.#v2(`/orders/${ orderId }/shipments`), method: 'post', body, logTag: 'createOrderShipment' })
  }

  /**
   * @operationName Get Order Shipment
   * @category Order Shipments
   * @description Retrieves a single shipment of an order by ID. Use to inspect tracking and shipped items.
   * @route POST /get-order-shipment
   * @paramDef {"type":"String","label":"Order","name":"orderId","required":true,"dictionary":"getOrdersDictionary","description":"The order the shipment belongs to. Use Get Orders to pick one."}
   * @paramDef {"type":"String","label":"Shipment","name":"shipmentId","required":true,"dictionary":"getOrderShipmentsDictionary","dependsOn":["orderId"],"description":"The shipment to retrieve. Use List Order Shipments to find its ID."}
   * @returns {Object}
   * @sampleResult {"id":1,"order_id":100,"tracking_number":"1Z999","shipping_provider":"ups"}
   */
  async getOrderShipment(orderId, shipmentId) {
    return await this.#apiRequest({ url: this.#v2(`/orders/${ orderId }/shipments/${ shipmentId }`), logTag: 'getOrderShipment' })
  }

  /**
   * @operationName List Order Shipments
   * @category Order Shipments
   * @description Lists all shipments of an order. Use to find a shipment ID before updating or deleting it.
   * @route POST /list-order-shipments
   * @paramDef {"type":"String","label":"Order","name":"orderId","required":true,"dictionary":"getOrdersDictionary","description":"The order whose shipments to list. Use Get Orders to pick one."}
   * @returns {Object}
   * @sampleResult [{"id":1,"order_id":100,"tracking_number":"1Z999","shipping_provider":"ups"}]
   */
  async listOrderShipments(orderId) {
    return await this.#apiRequest({ url: this.#v2(`/orders/${ orderId }/shipments`), logTag: 'listOrderShipments' })
  }

  /**
   * @operationName Update Order Shipment
   * @category Order Shipments
   * @description Updates a shipment's tracking number or carrier. Use List Order Shipments to find the shipment ID.
   * @route POST /update-order-shipment
   * @paramDef {"type":"String","label":"Order","name":"orderId","required":true,"dictionary":"getOrdersDictionary","description":"The order the shipment belongs to. Use Get Orders to pick one."}
   * @paramDef {"type":"String","label":"Shipment","name":"shipmentId","required":true,"dictionary":"getOrderShipmentsDictionary","dependsOn":["orderId"],"description":"The shipment to update. Use List Order Shipments to find its ID."}
   * @paramDef {"type":"String","label":"Tracking Number","name":"trackingNumber","description":"New tracking number. Leave blank to keep current."}
   * @paramDef {"type":"String","label":"Shipping Provider","name":"shippingProvider","uiComponent":{"type":"DROPDOWN","options":{"values":["Custom / Other","UPS","USPS","FedEx","DHL"]}},"description":"New shipping carrier."}
   * @returns {Object}
   * @sampleResult {"id":1,"order_id":100,"tracking_number":"1Z888","shipping_provider":"fedex"}
   */
  async updateOrderShipment(orderId, shipmentId, trackingNumber, shippingProvider) {
    // docs: https://developer.bigcommerce.com/docs/rest-management/orders/order-shipments
    const body = this.#compact({ tracking_number: trackingNumber, shipping_provider: this.#resolveChoice(shippingProvider, SHIPPING_PROVIDER_MAP) })

    return await this.#apiRequest({ url: this.#v2(`/orders/${ orderId }/shipments/${ shipmentId }`), method: 'put', body, logTag: 'updateOrderShipment' })
  }

  /**
   * @operationName Delete Order Shipment
   * @category Order Shipments
   * @description Deletes a shipment from an order. Use List Order Shipments to find the shipment ID.
   * @route POST /delete-order-shipment
   * @paramDef {"type":"String","label":"Order","name":"orderId","required":true,"dictionary":"getOrdersDictionary","description":"The order the shipment belongs to. Use Get Orders to pick one."}
   * @paramDef {"type":"String","label":"Shipment","name":"shipmentId","required":true,"dictionary":"getOrderShipmentsDictionary","dependsOn":["orderId"],"description":"The shipment to delete. Use List Order Shipments to find its ID."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"shipmentId":1}
   */
  async deleteOrderShipment(orderId, shipmentId) {
    // docs: https://developer.bigcommerce.com/docs/rest-management/orders/order-shipments
    await this.#apiRequest({ url: this.#v2(`/orders/${ orderId }/shipments/${ shipmentId }`), method: 'delete', logTag: 'deleteOrderShipment' })

    return { deleted: true, shipmentId }
  }

  // ==========================================================================
  //  ACTIONS — Order Refunds (V3 payment_actions)
  // ==========================================================================
  /**
   * @operationName Create Refund Quote
   * @category Order Refunds
   * @description Calculate a refund quote for an order before issuing it — returns the refundable items and the payment providers that can be refunded. Run this first, then Create Refund.
   * @route POST /create-refund-quote
   * @paramDef {"type":"String","label":"Order","name":"orderId","required":true,"dictionary":"getOrdersDictionary","description":"The order to quote a refund for. Use Get Orders to pick one."}
   * @paramDef {"type":"Array.<Object>","label":"Items To Refund","name":"items","required":true,"schemaLoader":"refundItemsSchema","description":"The items to refund, each with item_type, item_id, quantity and reason."}
   * @returns {Object}
   * @sampleResult {"data":{"order_id":100,"total_refund_amount":50.0,"refund_methods":[{"provider_id":"storecredit","amount":50.0}]},"meta":{}}
   */
  async refundQuote(orderId, items) {
    // docs: https://developer.bigcommerce.com/docs/store-operations/orders/refunds
    const body = { items }

    return await this.#apiRequest({ url: this.#v3(`/orders/${ orderId }/payment_actions/refund_quotes`), method: 'post', body, logTag: 'refundQuote' })
  }

  /**
   * @operationName Create Refund
   * @category Order Refunds
   * @description Issue a refund against an order with a settled payment. Use Create Refund Quote first to get valid payment providers and amounts.
   * @route POST /create-refund
   * @paramDef {"type":"String","label":"Order","name":"orderId","required":true,"dictionary":"getOrdersDictionary","description":"The order to refund. Use Get Orders to pick one."}
   * @paramDef {"type":"Array.<Object>","label":"Items To Refund","name":"items","required":true,"schemaLoader":"refundItemsSchema","description":"The items to refund, each with item_type, item_id, quantity and reason."}
   * @paramDef {"type":"Array.<Object>","label":"Payments","name":"payments","required":true,"schemaLoader":"refundPaymentsSchema","description":"How to issue the refund, each with a provider_id and amount. Get providers from Create Refund Quote."}
   * @returns {Object}
   * @sampleResult {"data":{"id":1,"order_id":100,"total_amount":50.0,"reason":"Damaged"},"meta":{}}
   */
  async createRefund(orderId, items, payments) {
    // docs: https://developer.bigcommerce.com/docs/store-operations/orders/refunds
    const body = { items, payments }

    return await this.#apiRequest({ url: this.#v3(`/orders/${ orderId }/payment_actions/refunds`), method: 'post', body, logTag: 'createRefund' })
  }

  /**
   * @operationName List Refunds
   * @category Order Refunds
   * @description Lists the refunds issued against an order. Use to audit an order's refund history.
   * @route POST /list-refunds
   * @paramDef {"type":"String","label":"Order","name":"orderId","required":true,"dictionary":"getOrdersDictionary","description":"The order whose refunds to list. Use Get Orders to pick one."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":1,"order_id":100,"total_amount":50.0}],"meta":{"pagination":{"total":1}}}
   */
  async listRefunds(orderId) {
    return await this.#apiRequest({ url: this.#v3(`/orders/${ orderId }/payment_actions/refunds`), logTag: 'listRefunds' })
  }

  // ==========================================================================
  //  ACTIONS — Carts (V3)
  // ==========================================================================
  /**
   * @operationName Create Cart
   * @category Carts
   * @description Creates a new cart with one or more line items. Use to start an order programmatically (e.g. a saved cart for a customer). Carts have no list endpoint — keep the returned cart ID.
   * @route POST /create-cart
   * @paramDef {"type":"Array.<Object>","label":"Line Items","name":"lineItems","required":true,"schemaLoader":"cartLineItemsSchema","description":"Products to add to the new cart, each with a product_id, quantity and optional variant_id."}
   * @paramDef {"type":"String","label":"Customer","name":"customerId","dictionary":"getCustomersDictionary","description":"Optional customer to associate with the cart. Use Get Customers to pick one."}
   * @paramDef {"type":"Number","label":"Channel ID","name":"channelId","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":1,"description":"Sales channel ID for the cart. Defaults to 1 (the default storefront)."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"abc-123","customer_id":1,"channel_id":1,"line_items":{"physical_items":[{"product_id":80,"quantity":1}]}},"meta":{}}
   */
  async createCart(lineItems, customerId, channelId) {
    // docs: https://developer.bigcommerce.com/docs/rest-management/carts/carts-single
    const body = this.#compact({
      line_items: lineItems,
      customer_id: customerId,
      channel_id: channelId || 1,
    })

    return await this.#apiRequest({ url: this.#v3('/carts'), method: 'post', body, logTag: 'createCart' })
  }

  /**
   * @operationName Get Cart
   * @category Carts
   * @description Retrieves a cart by its ID (returned by Create Cart). Use to inspect a cart's line items and totals.
   * @route POST /get-cart
   * @paramDef {"type":"String","label":"Cart ID","name":"cart","required":true,"description":"The cart to retrieve (returned by Create Cart)."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"abc-123","customer_id":1,"line_items":{"physical_items":[{"product_id":80,"quantity":1}]}},"meta":{}}
   */
  async getCart(cartId) {
    return await this.#apiRequest({ url: this.#v3(`/carts/${ cartId }`), logTag: 'getCart' })
  }

  /**
   * @operationName Add Cart Line Items
   * @category Carts
   * @description Adds one or more products to an existing cart. Use Create Cart first to get the cart ID.
   * @route POST /add-cart-line-items
   * @paramDef {"type":"String","label":"Cart ID","name":"cart","required":true,"description":"The cart to add items to (returned by Create Cart)."}
   * @paramDef {"type":"Array.<Object>","label":"Line Items","name":"lineItems","required":true,"schemaLoader":"cartLineItemsSchema","description":"Products to add, each with a product_id, quantity and optional variant_id."}
   * @returns {Object}
   * @sampleResult {"data":{"id":"abc-123","line_items":{"physical_items":[{"product_id":80,"quantity":1},{"product_id":81,"quantity":2}]}},"meta":{}}
   */
  async addCartLineItems(cartId, lineItems) {
    // docs: https://developer.bigcommerce.com/docs/rest-management/carts/items
    const body = { line_items: lineItems }

    return await this.#apiRequest({ url: this.#v3(`/carts/${ cartId }/items`), method: 'post', body, logTag: 'addCartLineItems' })
  }

  /**
   * @operationName Delete Cart
   * @category Carts
   * @description Deletes a cart by its ID. Use to discard an abandoned or completed cart.
   * @route POST /delete-cart
   * @paramDef {"type":"String","label":"Cart ID","name":"cart","required":true,"description":"The cart to delete (returned by Create Cart)."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"cartId":"abc-123"}
   */
  async deleteCart(cartId) {
    // docs: https://developer.bigcommerce.com/docs/rest-management/carts/carts-single
    await this.#apiRequest({ url: this.#v3(`/carts/${ cartId }`), method: 'delete', logTag: 'deleteCart' })

    return { deleted: true, cartId }
  }

  // ==========================================================================
  //  ACTIONS — Price Lists (V3)
  // ==========================================================================
  /**
   * @operationName Create Price List
   * @category Price Lists
   * @description Creates a price list — a named set of per-variant price overrides (e.g. wholesale pricing). Note: price lists are a Pro/Enterprise-plan feature on some BigCommerce plans.
   * @route POST /create-price-list
   * @paramDef {"type":"String","label":"Price List Name","name":"name","required":true,"description":"Unique name for the price list (e.g. \"Wholesale Q3\")."}
   * @paramDef {"type":"Boolean","label":"Active","name":"active","uiComponent":{"type":"TOGGLE"},"defaultValue":true,"description":"Whether this price list and its prices are active. Defaults to true."}
   * @returns {Object}
   * @sampleResult {"data":{"id":4,"name":"Wholesale Q3","active":true},"meta":{}}
   */
  async createPriceList(name, active) {
    // docs: https://developer.bigcommerce.com/api-reference/store-management/price-lists/price-lists/createpricelist
    const body = this.#compact({ name, active: active === undefined ? undefined : Boolean(active) })

    return await this.#apiRequest({ url: this.#v3('/pricelists'), method: 'post', body, logTag: 'createPriceList' })
  }

  /**
   * @operationName Get Price List
   * @category Price Lists
   * @description Retrieves a single price list by ID. Use to inspect a price list's details.
   * @route POST /get-price-list
   * @paramDef {"type":"String","label":"Price List","name":"priceListId","required":true,"dictionary":"getPriceListsDictionary","description":"The price list to retrieve. Use Get Price Lists to pick one."}
   * @returns {Object}
   * @sampleResult {"data":{"id":4,"name":"Wholesale Q3","active":true},"meta":{}}
   */
  async getPriceList(priceListId) {
    return await this.#apiRequest({ url: this.#v3(`/pricelists/${ priceListId }`), logTag: 'getPriceList' })
  }

  /**
   * @operationName List Price Lists
   * @category Price Lists
   * @description Returns a page of price lists. Use to browse price lists or find one before acting on it.
   * @route POST /list-price-lists
   * @paramDef {"type":"Number","label":"Results Per Page","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":50,"description":"How many price lists per page. Defaults to 50."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":1,"description":"Page number of results. Defaults to 1."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":4,"name":"Wholesale Q3","active":true}],"meta":{"pagination":{"total":1}}}
   */
  async listPriceLists(limit, page) {
    const query = this.#compact({ limit: limit || 50, page: page || 1 })

    return await this.#apiRequest({ url: this.#v3('/pricelists'), query, logTag: 'listPriceLists' })
  }

  /**
   * @operationName Update Price List
   * @category Price Lists
   * @description Updates a price list's name or active status. Use Get Price Lists to pick the list.
   * @route POST /update-price-list
   * @paramDef {"type":"String","label":"Price List","name":"priceListId","required":true,"dictionary":"getPriceListsDictionary","description":"The price list to update. Use Get Price Lists to pick one."}
   * @paramDef {"type":"String","label":"Price List Name","name":"name","description":"New name. Leave blank to keep current."}
   * @paramDef {"type":"Boolean","label":"Active","name":"active","uiComponent":{"type":"TOGGLE"},"description":"Activate or deactivate the price list."}
   * @returns {Object}
   * @sampleResult {"data":{"id":4,"name":"Wholesale Q4","active":true},"meta":{}}
   */
  async updatePriceList(priceListId, name, active) {
    // docs: https://developer.bigcommerce.com/docs/rest-management/price-lists
    const body = this.#compact({ name, active: active === undefined ? undefined : Boolean(active) })

    return await this.#apiRequest({ url: this.#v3(`/pricelists/${ priceListId }`), method: 'put', body, logTag: 'updatePriceList' })
  }

  /**
   * @operationName Delete Price List
   * @category Price Lists
   * @description Deletes a price list and all its price records. Use with care.
   * @route POST /delete-price-list
   * @paramDef {"type":"String","label":"Price List","name":"priceListId","required":true,"dictionary":"getPriceListsDictionary","description":"The price list to delete. Use Get Price Lists to pick one."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"priceListId":4}
   */
  async deletePriceList(priceListId) {
    // docs: https://developer.bigcommerce.com/docs/rest-management/price-lists
    await this.#apiRequest({ url: this.#v3(`/pricelists/${ priceListId }`), method: 'delete', logTag: 'deletePriceList' })

    return { deleted: true, priceListId }
  }

  // ==========================================================================
  //  ACTIONS — Price List Records (V3 PUT upsert per variant+currency)
  // ==========================================================================
  /**
   * @operationName Set Price Record
   * @category Price Lists
   * @description Set the price override for a variant in a price list and currency (creates or updates). Use to apply wholesale or regional pricing to a specific variant.
   * @route POST /set-price-record
   * @paramDef {"type":"String","label":"Price List","name":"priceListId","required":true,"dictionary":"getPriceListsDictionary","description":"The price list to set the record in. Use Get Price Lists to pick one."}
   * @paramDef {"type":"String","label":"Variant","name":"variantId","required":true,"dictionary":"getVariantsDictionary","description":"The variant the price override applies to. Use Get Variants to pick one."}
   * @paramDef {"type":"String","label":"Currency Code","name":"currency","required":true,"defaultValue":"usd","description":"Three-letter ISO 4217 currency code in lowercase (e.g. usd, eur)."}
   * @paramDef {"type":"Number","label":"Price","name":"price","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The override price for this variant in this currency."}
   * @paramDef {"type":"Number","label":"Sale Price","name":"salePrice","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional sale price for this variant."}
   * @returns {Object}
   * @sampleResult {"data":{"product_id":111,"variant_id":3121,"price":10.0,"currency":"usd","sale_price":8.0},"meta":{}}
   */
  async upsertPriceRecord(priceListId, variantId, currency, price, salePrice) {
    // docs: https://developer.bigcommerce.com/docs/rest-management/price-lists/price-lists-records
    const body = this.#compact({ price, currency, sale_price: salePrice })

    return await this.#apiRequest({ url: this.#v3(`/pricelists/${ priceListId }/records/${ variantId }/${ currency }`), method: 'put', body, logTag: 'upsertPriceRecord' })
  }

  /**
   * @operationName List Price Records
   * @category Price Lists
   * @description Lists the price records (variant price overrides) in a price list. Use to audit a price list's overrides.
   * @route POST /list-price-records
   * @paramDef {"type":"String","label":"Price List","name":"priceListId","required":true,"dictionary":"getPriceListsDictionary","description":"The price list whose records to list. Use Get Price Lists to pick one."}
   * @returns {Object}
   * @sampleResult {"data":[{"product_id":111,"variant_id":3121,"price":10.0,"currency":"usd"}],"meta":{"pagination":{"total":1}}}
   */
  async listPriceRecords(priceListId) {
    return await this.#apiRequest({ url: this.#v3(`/pricelists/${ priceListId }/records`), logTag: 'listPriceRecords' })
  }

  /**
   * @operationName Delete Price Record
   * @category Price Lists
   * @description Removes a variant's price override in a given currency from a price list. Use to revert a variant to its default price.
   * @route POST /delete-price-record
   * @paramDef {"type":"String","label":"Price List","name":"priceListId","required":true,"dictionary":"getPriceListsDictionary","description":"The price list the record belongs to. Use Get Price Lists to pick one."}
   * @paramDef {"type":"String","label":"Variant","name":"variantId","required":true,"dictionary":"getVariantsDictionary","description":"The variant whose price record to remove. Use Get Variants to pick one."}
   * @paramDef {"type":"String","label":"Currency Code","name":"currency","required":true,"defaultValue":"usd","description":"The currency code of the record to remove (e.g. usd)."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"variantId":3121,"currency":"usd"}
   */
  async deletePriceRecord(priceListId, variantId, currency) {
    // docs: https://developer.bigcommerce.com/docs/rest-management/price-lists/price-lists-records
    await this.#apiRequest({ url: this.#v3(`/pricelists/${ priceListId }/records/${ variantId }/${ currency }`), method: 'delete', logTag: 'deletePriceRecord' })

    return { deleted: true, variantId, currency }
  }

  // ==========================================================================
  //  DICTIONARIES — back every resource-pick (*Id) param with one of these
  // ==========================================================================
  /**
   * @registerAs DICTIONARY
   * @operationName Get Products Dictionary
   * @description Provides a searchable list of products for dropdown selection in other actions.
   * @route POST /get-products-dictionary
   * @paramDef {"type":"getProductsDictionary__payload","label":"Payload","name":"payload","description":"Search keyword and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"BigCommerce Coffee Mug","value":111,"note":"SKU: MUG-1"}],"cursor":null}
   */
  async getProductsDictionary(payload) {
    const { search, cursor } = payload || {}
    const query = this.#compact({ keyword: search, limit: 50, page: cursor || 1 })
    const result = await this.#apiRequest({ url: this.#v3('/catalog/products'), query, logTag: 'getProductsDictionary' })

    return {
      items: (result?.data || []).map(item => ({ label: item.name, value: item.id, note: `SKU: ${ item.sku || '—' }` })),
      cursor: this.#nextPage(result),
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Variants Dictionary
   * @description Provides a searchable list of a product's variants for dropdown selection.
   * @route POST /get-variants-dictionary
   * @paramDef {"type":"getVariantsDictionary__payload","label":"Payload","name":"payload","description":"Search text, pagination cursor, and the parent product in criteria."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"MUG-RED","value":74,"note":"Variant 74"}],"cursor":null}
   */
  async getVariantsDictionary(payload) {
    const { search, criteria } = payload || {}
    const productId = criteria?.productId
    const result = await this.#apiRequest({ url: this.#v3(`/catalog/products/${ productId }/variants`), query: { limit: 250 }, logTag: 'getVariantsDictionary' })
    const items = (result?.data || [])
      .filter(v => !search || String(v.sku || '').toLowerCase().includes(String(search).toLowerCase()))
      .map(v => ({ label: v.sku || `Variant ${ v.id }`, value: v.id, note: `Variant ${ v.id }` }))

    return { items, cursor: null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Categories Dictionary
   * @description Provides a searchable list of categories for dropdown selection in other actions.
   * @route POST /get-categories-dictionary
   * @paramDef {"type":"getCategoriesDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Shoes","value":36,"note":"Parent: 18"}],"cursor":null}
   */
  async getCategoriesDictionary(payload) {
    const { search, cursor } = payload || {}
    const query = this.#compact({ 'name:like': search, limit: 50, page: cursor || 1 })
    const result = await this.#apiRequest({ url: this.#v3('/catalog/categories'), query, logTag: 'getCategoriesDictionary' })

    return {
      items: (result?.data || []).map(c => ({ label: c.name, value: c.id, note: `Parent: ${ c.parent_id }` })),
      cursor: this.#nextPage(result),
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Brands Dictionary
   * @description Provides a searchable list of brands for dropdown selection in other actions.
   * @route POST /get-brands-dictionary
   * @paramDef {"type":"getBrandsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"BigCommerce","value":40}],"cursor":null}
   */
  async getBrandsDictionary(payload) {
    const { search, cursor } = payload || {}
    const query = this.#compact({ 'name:like': search, limit: 50, page: cursor || 1 })
    const result = await this.#apiRequest({ url: this.#v3('/catalog/brands'), query, logTag: 'getBrandsDictionary' })

    return {
      items: (result?.data || []).map(b => ({ label: b.name, value: b.id })),
      cursor: this.#nextPage(result),
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Product Images Dictionary
   * @description Provides a list of a product's images for dropdown selection.
   * @route POST /get-product-images-dictionary
   * @paramDef {"type":"getProductImagesDictionary__payload","label":"Payload","name":"payload","description":"Search text, pagination cursor, and the parent product in criteria."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Image 9","value":9,"note":"https://cdn.example.com/mug.png"}],"cursor":null}
   */
  async getProductImagesDictionary(payload) {
    const { criteria } = payload || {}
    const productId = criteria?.productId
    const result = await this.#apiRequest({ url: this.#v3(`/catalog/products/${ productId }/images`), query: { limit: 250 }, logTag: 'getProductImagesDictionary' })

    return {
      items: (result?.data || []).map(i => ({ label: `Image ${ i.id }`, value: i.id, note: i.image_url })),
      cursor: null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Product Custom Fields Dictionary
   * @description Provides a list of a product's custom fields for dropdown selection.
   * @route POST /get-product-custom-fields-dictionary
   * @paramDef {"type":"getProductCustomFieldsDictionary__payload","label":"Payload","name":"payload","description":"Search text, pagination cursor, and the parent product in criteria."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Material","value":3,"note":"Ceramic"}],"cursor":null}
   */
  async getProductCustomFieldsDictionary(payload) {
    const { criteria } = payload || {}
    const productId = criteria?.productId
    const result = await this.#apiRequest({ url: this.#v3(`/catalog/products/${ productId }/custom-fields`), query: { limit: 250 }, logTag: 'getProductCustomFieldsDictionary' })

    return {
      items: (result?.data || []).map(f => ({ label: f.name, value: f.id, note: f.value })),
      cursor: null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Product Modifiers Dictionary
   * @description Provides a list of a product's modifiers for dropdown selection.
   * @route POST /get-product-modifiers-dictionary
   * @paramDef {"type":"getProductModifiersDictionary__payload","label":"Payload","name":"payload","description":"Search text, pagination cursor, and the parent product in criteria."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Engraving","value":21,"note":"text"}],"cursor":null}
   */
  async getProductModifiersDictionary(payload) {
    const { criteria } = payload || {}
    const productId = criteria?.productId
    const result = await this.#apiRequest({ url: this.#v3(`/catalog/products/${ productId }/modifiers`), query: { limit: 250 }, logTag: 'getProductModifiersDictionary' })

    return {
      items: (result?.data || []).map(m => ({ label: m.display_name || `Modifier ${ m.id }`, value: m.id, note: m.type })),
      cursor: null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Customers Dictionary
   * @description Provides a searchable list of customers for dropdown selection in other actions.
   * @route POST /get-customers-dictionary
   * @paramDef {"type":"getCustomersDictionary__payload","label":"Payload","name":"payload","description":"Search text (email) and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"John Doe","value":12,"note":"john.doe@example.com"}],"cursor":null}
   */
  async getCustomersDictionary(payload) {
    const { search, cursor } = payload || {}
    // API: https://developer.bigcommerce.com/docs/start/about/common-query-params
    // `:like` is the substring/wildcard ("contains") operator; `:in` matches a value against a
    // list exactly. A typed search term should match partially, so use `email:like`.
    const query = this.#compact({ 'email:like': search, limit: 50, page: cursor || 1 })
    const result = await this.#apiRequest({ url: this.#v3('/customers'), query, logTag: 'getCustomersDictionary' })

    return {
      items: (result?.data || []).map(c => ({ label: `${ c.first_name } ${ c.last_name }`.trim(), value: c.id, note: c.email })),
      cursor: this.#nextPage(result),
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Customer Addresses Dictionary
   * @description Provides a list of a customer's addresses for dropdown selection.
   * @route POST /get-customer-addresses-dictionary
   * @paramDef {"type":"getCustomerAddressesDictionary__payload","label":"Payload","name":"payload","description":"Search text, pagination cursor, and the parent customer in criteria."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"123 Main St, Austin","value":7}],"cursor":null}
   */
  async getCustomerAddressesDictionary(payload) {
    const { criteria } = payload || {}
    const customerId = criteria?.customerId
    const result = await this.#apiRequest({ url: this.#v3('/customers/addresses'), query: { 'customer_id:in': customerId, limit: 250 }, logTag: 'getCustomerAddressesDictionary' })

    return {
      items: (result?.data || []).map(a => ({ label: `${ a.address1 }, ${ a.city }`, value: a.id })),
      cursor: null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Customer Groups Dictionary
   * @description Provides a list of customer groups for dropdown selection in other actions.
   * @route POST /get-customer-groups-dictionary
   * @paramDef {"type":"getCustomerGroupsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Wholesale","value":3}],"cursor":null}
   */
  async getCustomerGroupsDictionary(payload) {
    const { search } = payload || {}
    const result = await this.#apiRequest({ url: this.#v2('/customer_groups'), query: { limit: 250 }, logTag: 'getCustomerGroupsDictionary' })
    const items = (Array.isArray(result) ? result : [])
      .filter(g => !search || String(g.name || '').toLowerCase().includes(String(search).toLowerCase()))
      .map(g => ({ label: g.name, value: g.id }))

    return { items, cursor: null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Orders Dictionary
   * @description Provides a searchable list of orders for dropdown selection in other actions.
   * @route POST /get-orders-dictionary
   * @paramDef {"type":"getOrdersDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Order #100 (Pending)","value":100,"note":"50.00"}],"cursor":null}
   */
  async getOrdersDictionary(payload) {
    const { cursor } = payload || {}
    const page = cursor || 1
    const result = await this.#apiRequest({ url: this.#v2('/orders'), query: { limit: 50, page }, logTag: 'getOrdersDictionary' })
    const orders = Array.isArray(result) ? result : []

    return {
      items: orders.map(o => ({ label: `Order #${ o.id } (${ o.status })`, value: o.id, note: o.total_inc_tax })),
      cursor: orders.length === 50 ? page + 1 : null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Order Statuses Dictionary
   * @description Provides a list of order statuses for dropdown selection in other actions.
   * @route POST /get-order-statuses-dictionary
   * @paramDef {"type":"getOrderStatusesDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Pending","value":1}],"cursor":null}
   */
  async getOrderStatusesDictionary(payload) {
    const { search } = payload || {}
    const result = await this.#apiRequest({ url: this.#v2('/order_statuses'), logTag: 'getOrderStatusesDictionary' })
    const items = (Array.isArray(result) ? result : [])
      .filter(s => !search || String(s.name || '').toLowerCase().includes(String(search).toLowerCase()))
      .map(s => ({ label: s.name, value: s.id }))

    return { items, cursor: null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Order Addresses Dictionary
   * @description Provides a list of an order's shipping addresses for dropdown selection.
   * @route POST /get-order-addresses-dictionary
   * @paramDef {"type":"getOrderAddressesDictionary__payload","label":"Payload","name":"payload","description":"Search text, pagination cursor, and the parent order in criteria."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"123 Main Street, Austin","value":1}],"cursor":null}
   */
  async getOrderAddressesDictionary(payload) {
    const { criteria } = payload || {}
    const orderId = criteria?.orderId
    const result = await this.#apiRequest({ url: this.#v2(`/orders/${ orderId }/shipping_addresses`), logTag: 'getOrderAddressesDictionary' })

    return {
      items: (Array.isArray(result) ? result : []).map(a => ({ label: `${ a.street_1 }, ${ a.city }`, value: a.id })),
      cursor: null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Order Shipments Dictionary
   * @description Provides a list of an order's shipments for dropdown selection.
   * @route POST /get-order-shipments-dictionary
   * @paramDef {"type":"getOrderShipmentsDictionary__payload","label":"Payload","name":"payload","description":"Search text, pagination cursor, and the parent order in criteria."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Shipment 1 (1Z999)","value":1}],"cursor":null}
   */
  async getOrderShipmentsDictionary(payload) {
    const { criteria } = payload || {}
    const orderId = criteria?.orderId
    const result = await this.#apiRequest({ url: this.#v2(`/orders/${ orderId }/shipments`), logTag: 'getOrderShipmentsDictionary' })

    return {
      items: (Array.isArray(result) ? result : []).map(s => ({ label: `Shipment ${ s.id } (${ s.tracking_number || 'no tracking' })`, value: s.id })),
      cursor: null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Order Products Dictionary
   * @description Provides a list of an order's line items for dropdown selection (e.g. when refunding specific items).
   * @route POST /get-order-products-dictionary
   * @paramDef {"type":"getOrderProductsDictionary__payload","label":"Payload","name":"payload","description":"Search text, pagination cursor, and the parent order in criteria."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"BigCommerce Coffee Mug (x1)","value":5}],"cursor":null}
   */
  async getOrderProductsDictionary(payload) {
    const { criteria } = payload || {}
    const orderId = criteria?.orderId
    const result = await this.#apiRequest({ url: this.#v2(`/orders/${ orderId }/products`), logTag: 'getOrderProductsDictionary' })

    return {
      items: (Array.isArray(result) ? result : []).map(p => ({ label: `${ p.name } (x${ p.quantity })`, value: p.id })),
      cursor: null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Price Lists Dictionary
   * @description Provides a searchable list of price lists for dropdown selection in other actions.
   * @route POST /get-price-lists-dictionary
   * @paramDef {"type":"getPriceListsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Wholesale Q3","value":4,"note":"Active"}],"cursor":null}
   */
  async getPriceListsDictionary(payload) {
    const { search, cursor } = payload || {}
    const page = cursor || 1
    const result = await this.#apiRequest({ url: this.#v3('/pricelists'), query: { limit: 50, page }, logTag: 'getPriceListsDictionary' })
    const items = (result?.data || [])
      .filter(p => !search || String(p.name || '').toLowerCase().includes(String(search).toLowerCase()))
      .map(p => ({ label: p.name, value: p.id, note: p.active ? 'Active' : 'Inactive' }))

    return { items, cursor: this.#nextPage(result) }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Locations Dictionary
   * @description Provides a list of inventory locations for dropdown selection. Defaults to the store's default location (ID 1).
   * @route POST /get-locations-dictionary
   * @paramDef {"type":"getLocationsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Default Warehouse","value":1,"note":"BC-DEFAULT"}],"cursor":null}
   */
  async getLocationsDictionary(payload) {
    // docs: https://developer.bigcommerce.com/docs/store-operations/catalog/inventory-locations
    const { search } = payload || {}
    const result = await this.#apiRequest({ url: this.#v3('/inventory/locations'), query: { limit: 250 }, logTag: 'getLocationsDictionary' })
    const items = (result?.data || [])
      .filter(l => !search || String(l.label || '').toLowerCase().includes(String(search).toLowerCase()))
      .map(l => ({ label: l.label, value: l.id, note: l.code }))

    return { items, cursor: null }
  }

  // V3 list responses carry meta.pagination; return next page number or null.
  #nextPage(result) {
    const pagination = result?.meta?.pagination

    if (!pagination) {
      return null
    }

    return pagination.current_page < pagination.total_pages ? pagination.current_page + 1 : null
  }

  // ==========================================================================
  //  SCHEMA LOADERS — sub-forms for Object / Array.<Object> params
  // ==========================================================================
  /**
   * @registerAs PARAM_SCHEMA_DEFINITION
   * @route POST /create-order-billing-address-schema
   * @paramDef {"type":"Object","label":"Criteria","name":"criteria"}
   * @returns {Object}
   */
  async createOrderBillingAddressSchema() {
    return [
      { type: 'String', label: 'First Name', name: 'first_name', required: true, description: 'Billing first name.' },
      { type: 'String', label: 'Last Name', name: 'last_name', required: true, description: 'Billing last name.' },
      { type: 'String', label: 'Street Address', name: 'street_1', required: true, description: 'Billing street address.' },
      { type: 'String', label: 'City', name: 'city', required: true, description: 'Billing city.' },
      { type: 'String', label: 'State / Province', name: 'state', required: true, description: 'Billing state or province.' },
      { type: 'String', label: 'Postal Code', name: 'zip', required: true, description: 'Billing ZIP / postal code.' },
      { type: 'String', label: 'Country Code', name: 'country_iso2', required: true, description: 'Two-letter ISO country code (e.g. US).' },
      { type: 'String', label: 'Email', name: 'email', required: true, description: 'Billing contact email.' },
    ]
  }

  /**
   * @registerAs PARAM_SCHEMA_DEFINITION
   * @route POST /create-order-products-schema
   * @paramDef {"type":"Object","label":"Criteria","name":"criteria"}
   * @returns {Object}
   */
  async createOrderProductsSchema() {
    // A line is EITHER a catalog line (product_id + quantity) OR a custom line (name + prices).
    // Empty fields are dropped by createOrder so each line serializes correctly.
    return [
      { type: 'Number', label: 'Product', name: 'product_id', required: false, description: 'Catalog product ID (for a catalog line). Use Get Products to pick one.', dictionary: 'getProductsDictionary' },
      { type: 'Number', label: 'Quantity', name: 'quantity', required: true, description: 'How many of this product.', uiComponent: { type: 'NUMERIC_STEPPER' } },
      { type: 'String', label: 'Custom Name', name: 'name', required: false, description: 'Name for a custom (non-catalog) line item.' },
      { type: 'Number', label: 'Price (Inc Tax)', name: 'price_inc_tax', required: false, description: 'Tax-inclusive price for a custom line item.', uiComponent: { type: 'NUMERIC_STEPPER' } },
      { type: 'Number', label: 'Price (Ex Tax)', name: 'price_ex_tax', required: false, description: 'Tax-exclusive price for a custom line item.', uiComponent: { type: 'NUMERIC_STEPPER' } },
    ]
  }

  /**
   * @registerAs PARAM_SCHEMA_DEFINITION
   * @route POST /create-shipment-items-schema
   * @paramDef {"type":"Object","label":"Criteria","name":"criteria"}
   * @returns {Object}
   */
  async createShipmentItemsSchema({ criteria } = {}) {
    const orderId = criteria?.orderId

    return [
      // Forward the parent orderId so the Order Products picker is scoped to this order
      // (the getOrderProductsDictionary dictionary reads it from criteria.orderId).
      { type: 'Number', label: 'Order Product', name: 'order_product_id', required: true, description: 'The order line item being shipped. Use List Order Products to find its ID.', dictionary: 'getOrderProductsDictionary', criteria: { orderId } },
      { type: 'Number', label: 'Quantity', name: 'quantity', required: true, description: 'How many of this item to ship.', uiComponent: { type: 'NUMERIC_STEPPER' } },
    ]
  }

  /**
   * @registerAs PARAM_SCHEMA_DEFINITION
   * @route POST /refund-items-schema
   * @paramDef {"type":"Object","label":"Criteria","name":"criteria"}
   * @returns {Object}
   */
  async refundItemsSchema() {
    return [
      {
        type: 'String', label: 'Item Type', name: 'item_type', required: true, description: 'What kind of charge to refund.',
        uiComponent: {
          type: 'DROPDOWN', options: {
            values: [
              { value: 'PRODUCT', label: 'Product' },
              { value: 'SHIPPING', label: 'Shipping' },
              { value: 'HANDLING', label: 'Handling' },
              { value: 'TAX', label: 'Tax' },
              { value: 'FEE', label: 'Fee' },
            ], 
          }, 
        },
      },
      { type: 'Number', label: 'Item ID', name: 'item_id', required: true, description: 'The ID of the item being refunded (e.g. order_product_id for a product).', uiComponent: { type: 'NUMERIC_STEPPER' } },
      { type: 'Number', label: 'Quantity', name: 'quantity', required: true, description: 'How many units to refund.', uiComponent: { type: 'NUMERIC_STEPPER' } },
      { type: 'String', label: 'Reason', name: 'reason', required: false, description: 'Optional reason for the refund.' },
    ]
  }

  /**
   * @registerAs PARAM_SCHEMA_DEFINITION
   * @route POST /refund-payments-schema
   * @paramDef {"type":"Object","label":"Criteria","name":"criteria"}
   * @returns {Object}
   */
  async refundPaymentsSchema() {
    return [
      { type: 'String', label: 'Payment Provider', name: 'provider_id', required: true, description: 'The payment provider to refund through (e.g. storecredit). Get this from Create Refund Quote.' },
      { type: 'Number', label: 'Amount', name: 'amount', required: true, description: 'The amount to refund via this provider.', uiComponent: { type: 'NUMERIC_STEPPER' } },
    ]
  }

  /**
   * @registerAs PARAM_SCHEMA_DEFINITION
   * @route POST /cart-line-items-schema
   * @paramDef {"type":"Object","label":"Criteria","name":"criteria"}
   * @returns {Object}
   */
  async cartLineItemsSchema() {
    return [
      { type: 'Number', label: 'Product', name: 'product_id', required: true, description: 'The product to add. Use Get Products to pick one.', dictionary: 'getProductsDictionary' },
      { type: 'Number', label: 'Quantity', name: 'quantity', required: true, description: 'How many to add.', uiComponent: { type: 'NUMERIC_STEPPER' } },
      { type: 'Number', label: 'Variant', name: 'variant_id', required: false, description: 'Optional specific variant of the product. Use Get Variants to pick one.', dictionary: 'getVariantsDictionary', dependsOn: ['product_id'] },
    ]
  }

  /**
   * @registerAs PARAM_SCHEMA_DEFINITION
   * @route POST /create-variant-option-values-schema
   * @paramDef {"type":"Object","label":"Criteria","name":"criteria"}
   * @returns {Object}
   */
  async createVariantOptionValuesSchema() {
    return [
      { type: 'Number', label: 'Option ID', name: 'option_id', required: true, description: 'The product option (e.g. Color) this value belongs to.', uiComponent: { type: 'NUMERIC_STEPPER' } },
      { type: 'Number', label: 'Value ID', name: 'id', required: true, description: 'The selected option value (e.g. Red).', uiComponent: { type: 'NUMERIC_STEPPER' } },
    ]
  }

  // ==========================================================================
  //  TRIGGERS (REALTIME — BigCommerce /v3/hooks; shared-secret header auth)
  // ==========================================================================
  /**
   * @registerAs REALTIME_TRIGGER
   * @operationName On Order Created
   * @category Triggers
   * @description Fires when a new order is placed in the store. The full order is fetched and returned so your flow can act on it immediately.
   * @route POST /on-order-created
   * @returns {Object}
   * @sampleResult {"eventType":"store/order/created","orderId":100,"order":{"id":100,"status":"Pending","total_inc_tax":"50.00"}}
   */
  async onOrderCreated() {
    // Trigger marker — events are shaped by handleTriggerResolveEvents.
  }

  /**
   * @registerAs REALTIME_TRIGGER
   * @operationName On Order Status Updated
   * @category Triggers
   * @description Fires when an order's status changes (e.g. moves to Awaiting Fulfillment or Shipped). Use to drive fulfillment or notification flows.
   * @route POST /on-order-status-updated
   * @returns {Object}
   * @sampleResult {"eventType":"store/order/statusUpdated","orderId":100,"order":{"id":100,"status_id":11,"status":"Awaiting Fulfillment"}}
   */
  async onOrderStatusUpdated() {
    // Trigger marker — events are shaped by handleTriggerResolveEvents.
  }

  /**
   * @registerAs REALTIME_TRIGGER
   * @operationName On Product Created
   * @category Triggers
   * @description Fires when a new product is added to the catalog. The full product is fetched and returned.
   * @route POST /on-product-created
   * @returns {Object}
   * @sampleResult {"eventType":"store/product/created","productId":111,"product":{"id":111,"name":"BigCommerce Coffee Mug"}}
   */
  async onProductCreated() {
    // Trigger marker — events are shaped by handleTriggerResolveEvents.
  }

  /**
   * @registerAs REALTIME_TRIGGER
   * @operationName On Product Updated
   * @category Triggers
   * @description Fires when a product is updated. The full product is fetched and returned so your flow can react to changes.
   * @route POST /on-product-updated
   * @returns {Object}
   * @sampleResult {"eventType":"store/product/updated","productId":111,"product":{"id":111,"name":"Updated Mug"}}
   */
  async onProductUpdated() {
    // Trigger marker — events are shaped by handleTriggerResolveEvents.
  }

  /**
   * @registerAs REALTIME_TRIGGER
   * @operationName On Inventory Updated
   * @category Triggers
   * @description Fires when a product's inventory level changes. Use to react to low stock or restocks.
   * @route POST /on-inventory-updated
   * @returns {Object}
   * @sampleResult {"eventType":"store/product/inventory/updated","productId":111,"product":{"id":111,"inventory_level":42}}
   */
  async onInventoryUpdated() {
    // Trigger marker — events are shaped by handleTriggerResolveEvents.
  }

  /**
   * @registerAs REALTIME_TRIGGER
   * @operationName On Customer Created
   * @category Triggers
   * @description Fires when a new customer account is created. The full customer record is fetched and returned.
   * @route POST /on-customer-created
   * @returns {Object}
   * @sampleResult {"eventType":"store/customer/created","customerId":12,"customer":{"id":12,"email":"john.doe@example.com"}}
   */
  async onCustomerCreated() {
    // Trigger marker — events are shaped by handleTriggerResolveEvents.
  }

  // ── SYSTEM trigger handlers (SINGLE_APP) ─────────────────────────────────
  /**
   * @registerAs SYSTEM
   * @route POST /handleTriggerUpsertWebhook
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerUpsertWebhook(invocation) {
    logger.debug('handleTriggerUpsertWebhook invoked')

    // BigCommerce does not sign webhook payloads — authenticate callbacks with a generated
    // shared secret sent back on every delivery via the WEBHOOK_SECRET_HEADER header.
    const secret = crypto.randomBytes(32).toString('hex')
    const destination = invocation.callbackUrl
    const webhooks = []

    for (const event of invocation.events || []) {
      const scope = TRIGGER_EVENTS[event.name]

      if (!scope) {
        continue
      }

      const created = await this.#apiRequest({
        url: this.#v3('/hooks'),
        method: 'post',
        body: {
          scope,
          destination,
          is_active: true,
          headers: { [WEBHOOK_SECRET_HEADER]: secret },
        },
        logTag: 'createWebhook',
      })

      webhooks.push({ triggerId: event.id, hookId: created?.data?.id, scope })
    }

    return { webhookData: { webhooks, secret }, connectionId: invocation.connectionId }
  }

  /**
   * @registerAs SYSTEM
   * @route POST /handleTriggerResolveEvents
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerResolveEvents(invocation) {
    logger.debug('handleTriggerResolveEvents invoked')

    if (!invocation || !invocation.body) {
      return { connectionId: invocation?.connectionId, events: [] }
    }

    if (!this.#verifyWebhookSecret(invocation)) {
      logger.warn('handleTriggerResolveEvents: webhook secret verification failed — rejecting delivery')

      return { connectionId: invocation.connectionId, events: [] }
    }

    const scope = invocation.body.scope
    const resourceId = invocation.body.data?.id
    const eventName = Object.keys(TRIGGER_EVENTS).find(name => TRIGGER_EVENTS[name] === scope)

    if (!eventName || resourceId === undefined) {
      return { connectionId: invocation.connectionId, events: [] }
    }

    let data

    try {
      data = await this.#fetchTriggerDetail(eventName, scope, resourceId)
    } catch (error) {
      logger.warn(`handleTriggerResolveEvents: detail fetch failed for ${ scope }: ${ error?.message }`)
      data = { eventType: scope, resourceId }
    }

    return { connectionId: invocation.connectionId, events: [{ name: eventName, data }] }
  }

  /**
   * @registerAs SYSTEM
   * @route POST /handleTriggerSelectMatched
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerSelectMatched(invocation) {
    logger.debug('handleTriggerSelectMatched invoked')

    // SINGLE_APP: each registered trigger of the matching event applies.
    return { ids: (invocation.triggers || []).map(trigger => trigger.id) }
  }

  /**
   * @registerAs SYSTEM
   * @route POST /handleTriggerDeleteWebhook
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerDeleteWebhook(invocation) {
    logger.debug('handleTriggerDeleteWebhook invoked')

    const webhooks = invocation.webhookData?.webhooks || []

    for (const webhook of webhooks) {
      if (!webhook.hookId) {
        continue
      }

      try {
        await this.#apiRequest({ url: this.#v3(`/hooks/${ webhook.hookId }`), method: 'delete', logTag: 'deleteWebhook' })
      } catch (error) {
        logger.warn(`handleTriggerDeleteWebhook: failed to delete hook ${ webhook.hookId }: ${ error?.message }`)
      }
    }

    return { webhookData: {} }
  }

  // Fetches the full resource for a delivered webhook (payload carries only {type,id}).
  async #fetchTriggerDetail(eventName, scope, resourceId) {
    if (eventName === 'onOrderCreated' || eventName === 'onOrderStatusUpdated') {
      const order = await this.#apiRequest({ url: this.#v2(`/orders/${ resourceId }`), logTag: 'resolveOrder' })

      return { eventType: scope, orderId: resourceId, order }
    }

    if (eventName === 'onCustomerCreated') {
      const result = await this.#apiRequest({ url: this.#v3('/customers'), query: { 'id:in': resourceId }, logTag: 'resolveCustomer' })

      return { eventType: scope, customerId: resourceId, customer: result?.data?.[0] || null }
    }

    // Product created/updated/inventory updated all resolve via Get Product.
    const result = await this.#apiRequest({ url: this.#v3(`/catalog/products/${ resourceId }`), logTag: 'resolveProduct' })

    return { eventType: scope, productId: resourceId, product: result?.data || null }
  }

  // Verifies the inbound shared secret header against the secret stored at upsert time.
  // BigCommerce does not sign payloads, so this header is the only callback-auth mechanism.
  #verifyWebhookSecret(invocation) {
    const expectedSecret = invocation.webhookData?.secret

    if (!expectedSecret) {
      logger.warn('No stored webhook secret available — rejecting delivery.')

      return false
    }

    const headers = invocation.headers || {}
    const providedSecret =
      headers[WEBHOOK_SECRET_HEADER] ||
      headers[WEBHOOK_SECRET_HEADER.toLowerCase()]

    if (!providedSecret) {
      return false
    }

    const expectedBuffer = Buffer.from(String(expectedSecret))
    const providedBuffer = Buffer.from(String(providedSecret))

    return expectedBuffer.length === providedBuffer.length &&
      crypto.timingSafeEqual(expectedBuffer, providedBuffer)
  }
}

Flowrunner.ServerCode.addService(BigCommerce, [
  {
    name: 'clientId',
    displayName: 'Client ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: "Your BigCommerce app's Client ID from the Developer Portal.",
  },
  {
    name: 'clientSecret',
    displayName: 'Client Secret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: "Your BigCommerce app's Client Secret from the Developer Portal.",
  },
])
