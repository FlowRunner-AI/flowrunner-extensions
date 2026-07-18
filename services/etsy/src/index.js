'use strict'

const crypto = require('crypto')

const AUTHORIZE_URL = 'https://www.etsy.com/oauth/connect'
const TOKEN_URL = 'https://api.etsy.com/v3/public/oauth/token'
const API_BASE_URL = 'https://api.etsy.com/v3/application'

// Scopes requested at connection time. Etsy scopes are space-separated.
const SCOPES = [
  'listings_r',
  'listings_w',
  'listings_d',
  'transactions_r',
  'transactions_w',
  'shops_r',
  'shops_w',
  'email_r',
].join(' ')

const LISTING_STATE_OPTIONS = {
  'Active': 'active',
  'Inactive': 'inactive',
  'Draft': 'draft',
  'Expired': 'expired',
  'Sold Out': 'sold_out',
}

const UPDATE_LISTING_STATE_OPTIONS = {
  'Active': 'active',
  'Inactive': 'inactive',
}

const LISTING_SORT_ON_OPTIONS = {
  'Created': 'created',
  'Price': 'price',
  'Updated': 'updated',
  'Score': 'score',
}

const RECEIPT_SORT_ON_OPTIONS = {
  'Created': 'created',
  'Updated': 'updated',
  'Receipt ID': 'receipt_id',
}

const SORT_ORDER_OPTIONS = {
  'Descending': 'desc',
  'Ascending': 'asc',
}

const WHO_MADE_OPTIONS = {
  'I Did': 'i_did',
  'Someone Else': 'someone_else',
  'Collective': 'collective',
}

// Exact enum from Etsy's OpenAPI spec (the year ranges shift as the "vintage" cutoff moves).
const WHEN_MADE_OPTIONS = {
  'Made To Order': 'made_to_order',
  '2020-2026': '2020_2026',
  '2010-2019': '2010_2019',
  '2007-2009': '2007_2009',
  'Before 2007': 'before_2007',
  '2000-2006': '2000_2006',
  '1990s': '1990s',
  '1980s': '1980s',
  '1970s': '1970s',
  '1960s': '1960s',
  '1950s': '1950s',
  '1940s': '1940s',
  '1930s': '1930s',
  '1920s': '1920s',
  '1910s': '1910s',
  '1900s': '1900s',
  '1800s': '1800s',
  '1700s': '1700s',
  'Before 1700': 'before_1700',
}

const LISTING_TYPE_OPTIONS = {
  'Physical': 'physical',
  'Digital Download': 'download',
  'Physical and Digital': 'both',
}

// Tri-state boolean filters: "Any" omits the filter entirely.
const TRISTATE_FILTER_OPTIONS = {
  'Any': undefined,
  'Yes': true,
  'No': false,
}

// Tri-state boolean updates: "Leave Unchanged" omits the field from the request.
const TRISTATE_UPDATE_OPTIONS = {
  'Leave Unchanged': undefined,
  'Yes': true,
  'No': false,
}

const TAXONOMY_DICTIONARY_PAGE_SIZE = 100

const logger = {
  info: (...args) => console.log('[Etsy] info:', ...args),
  debug: (...args) => console.log('[Etsy] debug:', ...args),
  error: (...args) => console.log('[Etsy] error:', ...args),
  warn: (...args) => console.log('[Etsy] warn:', ...args),
}

function cleanupObject(obj) {
  return Object.entries(obj || {}).reduce((acc, [key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      acc[key] = value
    }

    return acc
  }, {})
}

function isEmptyResponse(response) {
  if (response === undefined || response === null || response === '') {
    return true
  }

  return typeof response === 'object' && !Array.isArray(response) && Object.keys(response).length === 0
}

/**
 * @requireOAuth
 * @usesFileStorage
 * @integrationName Etsy
 * @integrationIcon /icon.svg
 **/
class EtsyService {
  constructor(config) {
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
  }

  #accessToken() {
    return this.request.headers['oauth-access-token']
  }

  // Every Etsy Open API v3 call requires BOTH the OAuth bearer token AND the app keystring.
  // Etsy access tokens are formatted "{user_id}.{token}", so the connected user's numeric id
  // is always derivable from the token prefix.
  #authHeaders() {
    return {
      'Authorization': `Bearer ${ this.#accessToken() }`,
      'x-api-key': this.clientId,
    }
  }

  // Single gateway for all Etsy API calls. Pass `body` for JSON payloads (e.g. inventory,
  // tracking) or `form` for application/x-www-form-urlencoded payloads (most shop/listing
  // writes, per Etsy's OpenAPI spec). Array values in `form` are comma-joined, matching
  // Etsy's documented serialization for tags/materials/styles.
  async #apiRequest({ url, method = 'get', body, form, query, logTag }) {
    if (query) {
      query = cleanupObject(query)
    }

    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=[${ JSON.stringify(query) }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          ...this.#authHeaders(),
          'Content-Type': form !== undefined ? 'application/x-www-form-urlencoded' : 'application/json',
        })
        .query(query || {})

      let payload = body

      if (form !== undefined) {
        const params = new URLSearchParams()

        for (const [key, value] of Object.entries(cleanupObject(form))) {
          params.append(key, Array.isArray(value) ? value.join(',') : String(value))
        }

        payload = params.toString()
      }

      const response = payload !== undefined ? await request.send(payload) : await request

      // Etsy delete endpoints return 204 No Content; normalize to a consistent success object.
      return isEmptyResponse(response) ? { status: 'success' } : response
    } catch (error) {
      const message = this.#extractError(error)

      logger.error(`${ logTag } - failed: ${ message }`)

      throw new Error(`Etsy API error: ${ message }`)
    }
  }

  // Etsy v3 errors are shaped { error: "message" }; the OAuth token endpoint uses
  // { error, error_description }.
  #extractError(error) {
    const body = error.body

    if (body) {
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

  #toBuffer(bytes) {
    return Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
  }

  // Accepts an ISO 8601 date string, a Unix timestamp in seconds, or one in milliseconds,
  // and returns Unix epoch seconds as Etsy expects.
  #toEpochSeconds(value, label) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    if (typeof value === 'number' || /^\d+(\.\d+)?$/.test(String(value).trim())) {
      const num = Number(value)

      return num > 100000000000 ? Math.floor(num / 1000) : Math.floor(num)
    }

    const parsed = Date.parse(value)

    if (Number.isNaN(parsed)) {
      throw new Error(`"${ label }" is not a recognizable date: "${ value }". Use ISO 8601 or a Unix timestamp.`)
    }

    return Math.floor(parsed / 1000)
  }

  // Resolves the shop to operate on: an explicitly provided shop id wins, otherwise the
  // connected user's own shop is looked up once via /users/me and cached for the invocation.
  async #getShopId(shopId) {
    if (shopId) {
      return shopId
    }

    if (!this.cachedShopId) {
      const me = await this.#apiRequest({
        logTag: '#getShopId',
        url: `${ API_BASE_URL }/users/me`,
      })

      if (!me.shop_id) {
        throw new Error('The connected Etsy account does not have a shop. Provide an explicit "Shop ID" or connect a seller account.')
      }

      this.cachedShopId = me.shop_id
    }

    return this.cachedShopId
  }

  // ============================================= OAUTH ================================================

  // Etsy mandates PKCE (S256) on every authorization request. This runtime shares no state
  // between the connection-URL generation and the OAuth callback, so the code verifier is
  // derived DETERMINISTICALLY from the app credentials: both methods can compute the exact
  // same value independently. The result is a 43-character base64url string — a valid PKCE
  // verifier.
  #codeVerifier() {
    return crypto.createHash('sha256').update(`${ this.clientSecret }::${ this.clientId }`).digest('base64url')
  }

  #codeChallenge() {
    return crypto.createHash('sha256').update(this.#codeVerifier()).digest('base64url')
  }

  /**
   * @registerAs SYSTEM
   * @route GET /getOAuth2ConnectionURL
   * @returns {String}
   */
  async getOAuth2ConnectionURL() {
    const params = new URLSearchParams()

    params.append('response_type', 'code')
    params.append('client_id', this.clientId)
    params.append('state', `flowrunner_${ Date.now() }`)
    params.append('code_challenge', this.#codeChallenge())
    params.append('code_challenge_method', 'S256')

    // Scopes are appended manually so spaces are encoded as %20, matching Etsy's documented URLs.
    const connectionURL = `${ AUTHORIZE_URL }?${ params.toString() }&scope=${ encodeURIComponent(SCOPES) }`

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
    const params = new URLSearchParams()

    params.append('grant_type', 'authorization_code')
    params.append('client_id', this.clientId)
    params.append('redirect_uri', callbackObject.redirectURI)
    params.append('code', callbackObject.code)
    params.append('code_verifier', this.#codeVerifier())

    let tokenResponse

    try {
      tokenResponse = await Flowrunner.Request.post(TOKEN_URL)
        .set({ 'Content-Type': 'application/x-www-form-urlencoded', 'x-api-key': this.clientId })
        .send(params.toString())
    } catch (error) {
      const message = this.#extractError(error)

      logger.error(`executeCallback - token exchange failed: ${ message }`)

      throw new Error(`Etsy OAuth error: ${ message }`)
    }

    // Etsy access tokens are "{user_id}.{token}".
    const token = tokenResponse.access_token
    const userId = String(token).split('.')[0]

    let userData = { user_id: userId }
    let connectionIdentityName = `Etsy user ${ userId }`
    let connectionIdentityImageURL = null

    try {
      const headers = { 'Authorization': `Bearer ${ token }`, 'x-api-key': this.clientId }

      const me = await Flowrunner.Request.get(`${ API_BASE_URL }/users/me`).set(headers)

      userData = { user_id: me.user_id, shop_id: me.shop_id }

      if (me.shop_id) {
        const shop = await Flowrunner.Request.get(`${ API_BASE_URL }/shops/${ me.shop_id }`).set(headers)

        userData.shop_name = shop.shop_name
        connectionIdentityName = shop.shop_name || connectionIdentityName
        connectionIdentityImageURL = shop.icon_url_fullxfull || null
      } else {
        const user = await Flowrunner.Request.get(`${ API_BASE_URL }/users/${ me.user_id || userId }`).set(headers)

        userData.primary_email = user.primary_email

        connectionIdentityName = [user.first_name, user.last_name].filter(Boolean).join(' ') ||
          user.primary_email ||
          connectionIdentityName

        connectionIdentityImageURL = user.image_url_75x75 || null
      }
    } catch (error) {
      logger.error(`executeCallback - identity lookup error: ${ error.message }`)
    }

    return {
      token,
      expirationInSeconds: tokenResponse.expires_in,
      refreshToken: tokenResponse.refresh_token,
      connectionIdentityName,
      connectionIdentityImageURL,
      overwrite: true,
      userData,
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
      params.append('client_id', this.clientId)
      params.append('refresh_token', refreshToken)

      const { access_token, expires_in, refresh_token } = await Flowrunner.Request.post(TOKEN_URL)
        .set({ 'Content-Type': 'application/x-www-form-urlencoded', 'x-api-key': this.clientId })
        .send(params.toString())

      return {
        token: access_token,
        expirationInSeconds: expires_in,
        refreshToken: refresh_token || refreshToken,
      }
    } catch (error) {
      const message = this.#extractError(error)

      logger.error(`refreshToken error: ${ message }`)

      if (error.body?.error === 'invalid_grant') {
        throw new Error('Refresh token expired or invalid, please re-authenticate.')
      }

      throw new Error(`Etsy OAuth error: ${ message }`)
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
   * @typedef {Object} getShippingProfilesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter shipping profiles by title. Filtering is applied locally."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Shipping profiles are returned in a single page, so this is unused."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Shipping Profiles Dictionary
   * @description Lists the connected shop's shipping profiles for selection in dependent parameters. Returns the profile title as the label and the shipping profile id as the value.
   * @route POST /get-shipping-profiles-dictionary
   * @paramDef {"type":"getShippingProfilesDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Standard US Shipping","value":"123456789","note":"Processing 1-3 days"}]}
   */
  async getShippingProfilesDictionary(payload) {
    const { search } = payload || {}

    const shopId = await this.#getShopId()

    const response = await this.#apiRequest({
      logTag: 'getShippingProfilesDictionary',
      url: `${ API_BASE_URL }/shops/${ shopId }/shipping-profiles`,
    })

    const profiles = Array.isArray(response.results) ? response.results : []

    const filtered = search
      ? profiles.filter(profile => profile.title && profile.title.toLowerCase().includes(search.toLowerCase()))
      : profiles

    return {
      items: filtered.map(profile => ({
        label: profile.title || `Profile ${ profile.shipping_profile_id }`,
        value: String(profile.shipping_profile_id),
        note: profile.min_processing_days != null && profile.max_processing_days != null
          ? `Processing ${ profile.min_processing_days }-${ profile.max_processing_days } days`
          : 'Shipping profile',
      })),
    }
  }

  /**
   * @typedef {Object} getShopSectionsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter sections by title. Filtering is applied locally."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Shop sections are returned in a single page, so this is unused."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Shop Sections Dictionary
   * @description Lists the connected shop's sections for selection in dependent parameters. Returns the section title as the label and the shop section id as the value.
   * @route POST /get-shop-sections-dictionary
   * @paramDef {"type":"getShopSectionsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Cutting Boards","value":"34567","note":"12 active listings"}]}
   */
  async getShopSectionsDictionary(payload) {
    const { search } = payload || {}

    const shopId = await this.#getShopId()

    const response = await this.#apiRequest({
      logTag: 'getShopSectionsDictionary',
      url: `${ API_BASE_URL }/shops/${ shopId }/sections`,
    })

    const sections = Array.isArray(response.results) ? response.results : []

    const filtered = search
      ? sections.filter(section => section.title && section.title.toLowerCase().includes(search.toLowerCase()))
      : sections

    return {
      items: filtered.map(section => ({
        label: section.title || `Section ${ section.shop_section_id }`,
        value: String(section.shop_section_id),
        note: section.active_listing_count != null ? `${ section.active_listing_count } active listings` : 'Shop section',
      })),
    }
  }

  /**
   * @typedef {Object} getListingsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter listings by title. Filtering is applied locally to the current page."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (numeric offset) from a previous response, used to retrieve the next page of listings."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Listings Dictionary
   * @description Lists the connected shop's active listings (most recently created first) for selection in dependent parameters. Returns the listing title as the label and the listing id as the value. Draft, inactive, expired, and sold-out listings are not included — enter their ids manually.
   * @route POST /get-listings-dictionary
   * @paramDef {"type":"getListingsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Personalized Oak Cutting Board","value":"1234567890","note":"active · 45.00 USD"}],"cursor":"100"}
   */
  async getListingsDictionary(payload) {
    const { search, cursor } = payload || {}

    const shopId = await this.#getShopId()
    const offset = Number(cursor) || 0
    const limit = 100

    const response = await this.#apiRequest({
      logTag: 'getListingsDictionary',
      url: `${ API_BASE_URL }/shops/${ shopId }/listings`,
      query: { state: 'active', limit, offset, sort_on: 'created', sort_order: 'desc' },
    })

    const listings = Array.isArray(response.results) ? response.results : []

    const filtered = search
      ? listings.filter(listing => listing.title && listing.title.toLowerCase().includes(search.toLowerCase()))
      : listings

    return {
      cursor: listings.length === limit ? String(offset + limit) : undefined,
      items: filtered.map(listing => {
        const price = listing.price && listing.price.divisor
          ? `${ (listing.price.amount / listing.price.divisor).toFixed(2) } ${ listing.price.currency_code }`
          : null

        return {
          label: listing.title || `Listing ${ listing.listing_id }`,
          value: String(listing.listing_id),
          note: [listing.state, price].filter(Boolean).join(' · '),
        }
      }),
    }
  }

  /**
   * @typedef {Object} getTaxonomyNodesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Text to filter taxonomy categories by their full path (e.g. 'cutting board'). The taxonomy has thousands of nodes, so searching is strongly recommended."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (numeric offset) from a previous response, used to retrieve the next page of matching categories."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Taxonomy Nodes Dictionary
   * @description Lists Etsy's seller taxonomy categories for selection in dependent parameters (e.g. the category of a new listing). The full category tree is flattened and searched locally by the category path; results are returned 100 at a time. Returns the category name as the label and the taxonomy id as the value, with the full path as the note.
   * @route POST /get-taxonomy-nodes-dictionary
   * @paramDef {"type":"getTaxonomyNodesDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Cutting Boards","value":"1633","note":"Home & Living > Kitchen & Dining > Cutting Boards"}],"cursor":"100"}
   */
  async getTaxonomyNodesDictionary(payload) {
    const { search, cursor } = payload || {}

    const nodes = await this.#getFlattenedTaxonomy()

    const filtered = search
      ? nodes.filter(node => node.path.toLowerCase().includes(search.toLowerCase()))
      : nodes

    const offset = Number(cursor) || 0
    const page = filtered.slice(offset, offset + TAXONOMY_DICTIONARY_PAGE_SIZE)

    return {
      cursor: offset + TAXONOMY_DICTIONARY_PAGE_SIZE < filtered.length
        ? String(offset + TAXONOMY_DICTIONARY_PAGE_SIZE)
        : undefined,
      items: page.map(node => ({
        label: node.name,
        value: String(node.id),
        note: node.path,
      })),
    }
  }

  // =========================================== TAXONOMY CORE =========================================

  #flattenTaxonomy(nodes, parentPath, out) {
    for (const node of nodes || []) {
      const path = parentPath ? `${ parentPath } > ${ node.name }` : node.name

      out.push({ id: node.id, name: node.name, level: node.level, path })

      this.#flattenTaxonomy(node.children, path, out)
    }

    return out
  }

  async #getFlattenedTaxonomy() {
    if (!this.cachedTaxonomy) {
      const response = await this.#apiRequest({
        logTag: '#getFlattenedTaxonomy',
        url: `${ API_BASE_URL }/seller-taxonomy/nodes`,
      })

      this.cachedTaxonomy = this.#flattenTaxonomy(response.results, '', [])
    }

    return this.cachedTaxonomy
  }

  // ========================================== USERS & SHOPS ==========================================

  /**
   * @description Retrieves the identity of the connected Etsy account: the numeric user id and, for seller accounts, the shop id. Use this to discover the shop id that shop-scoped actions default to. Note that Etsy access tokens are formatted "{user_id}.{token}", so the user id here always matches the token prefix.
   *
   * @route GET /get-current-user
   * @operationName Get Current User
   * @category Users & Shops
   *
   * @returns {Object}
   * @sampleResult {"user_id":23456789,"shop_id":12345678}
   */
  async getCurrentUser() {
    return this.#apiRequest({
      logTag: 'getCurrentUser',
      url: `${ API_BASE_URL }/users/me`,
    })
  }

  /**
   * @description Retrieves an Etsy shop's full profile: name, title, announcement, sale messages, currency, location, listing counts, review statistics, vacation status, and URLs. When no shop id is provided, the connected account's own shop is used.
   *
   * @route GET /get-shop
   * @operationName Get Shop
   * @category Users & Shops
   *
   * @paramDef {"type":"Number","label":"Shop ID","name":"shopId","description":"The Etsy shop to retrieve. Leave empty to use the shop of the connected account."}
   *
   * @returns {Object}
   * @sampleResult {"shop_id":12345678,"shop_name":"CraftyWoodworks","user_id":23456789,"title":"Handmade wooden decor","announcement":"Welcome to our shop!","currency_code":"USD","is_vacation":false,"url":"https://www.etsy.com/shop/CraftyWoodworks","num_favorers":812,"listing_active_count":42,"review_count":310,"review_average":4.9,"create_date":1577836800}
   */
  async getShop(shopId) {
    const resolvedShopId = await this.#getShopId(shopId)

    return this.#apiRequest({
      logTag: 'getShop',
      url: `${ API_BASE_URL }/shops/${ resolvedShopId }`,
    })
  }

  /**
   * @description Updates an Etsy shop's public profile fields: the shop title (the tagline under the shop name), the announcement shown at the top of the shop page, the message sent to buyers after a purchase, and the message sent to buyers of digital items. Only the provided fields are changed; at least one is required. Requires the shops_w scope.
   *
   * @route PUT /update-shop
   * @operationName Update Shop
   * @category Users & Shops
   *
   * @paramDef {"type":"String","label":"Title","name":"title","description":"A brief heading for the shop's main page (the tagline shown under the shop name)."}
   * @paramDef {"type":"String","label":"Announcement","name":"announcement","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"An announcement message displayed at the top of the shop's page."}
   * @paramDef {"type":"String","label":"Sale Message","name":"saleMessage","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The message sent to buyers when they complete a purchase from the shop."}
   * @paramDef {"type":"String","label":"Digital Sale Message","name":"digitalSaleMessage","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The message sent to buyers when they purchase a digital item from the shop."}
   * @paramDef {"type":"Number","label":"Shop ID","name":"shopId","description":"The Etsy shop to update. Leave empty to use the shop of the connected account."}
   *
   * @returns {Object}
   * @sampleResult {"shop_id":12345678,"shop_name":"CraftyWoodworks","title":"Handmade wooden decor","announcement":"Summer sale is on!","sale_message":"Thank you for your order!","digital_sale_message":"Your download is ready.","currency_code":"USD","url":"https://www.etsy.com/shop/CraftyWoodworks"}
   */
  async updateShop(title, announcement, saleMessage, digitalSaleMessage, shopId) {
    const form = cleanupObject({
      title,
      announcement,
      sale_message: saleMessage,
      digital_sale_message: digitalSaleMessage,
    })

    if (!Object.keys(form).length) {
      throw new Error('Provide at least one of "Title", "Announcement", "Sale Message", or "Digital Sale Message".')
    }

    const resolvedShopId = await this.#getShopId(shopId)

    return this.#apiRequest({
      logTag: 'updateShop',
      method: 'put',
      url: `${ API_BASE_URL }/shops/${ resolvedShopId }`,
      form,
    })
  }

  // ============================================= LISTINGS ============================================

  /**
   * @description Lists an Etsy shop's listings filtered by state (Active, Inactive, Draft, Expired, or Sold Out), with pagination and sorting by creation date, price, update date, or score. Returns up to 100 listings per page with full listing details including title, price, quantity, tags, and timestamps. Reading non-public states (Draft, Inactive, Expired, Sold Out) requires the listings_r scope.
   *
   * @route GET /list-shop-listings
   * @operationName List Shop Listings
   * @category Listings
   *
   * @paramDef {"type":"String","label":"State","name":"state","defaultValue":"Active","uiComponent":{"type":"DROPDOWN","options":{"values":["Active","Inactive","Draft","Expired","Sold Out"]}},"description":"The listing state to filter by. Default: 'Active'."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","defaultValue":25,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of listings to return per page (1-100). Default: 25."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","defaultValue":0,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of listings to skip, for pagination. Default: 0."}
   * @paramDef {"type":"String","label":"Sort By","name":"sortOn","defaultValue":"Created","uiComponent":{"type":"DROPDOWN","options":{"values":["Created","Price","Updated","Score"]}},"description":"The field to sort results by. Default: 'Created'."}
   * @paramDef {"type":"String","label":"Sort Order","name":"sortOrder","defaultValue":"Descending","uiComponent":{"type":"DROPDOWN","options":{"values":["Descending","Ascending"]}},"description":"The sort direction. Default: 'Descending' (newest/highest first)."}
   * @paramDef {"type":"Number","label":"Shop ID","name":"shopId","description":"The Etsy shop whose listings to list. Leave empty to use the shop of the connected account."}
   *
   * @returns {Object}
   * @sampleResult {"count":42,"results":[{"listing_id":1234567890,"user_id":23456789,"shop_id":12345678,"title":"Personalized Oak Cutting Board","state":"active","quantity":10,"url":"https://www.etsy.com/listing/1234567890","price":{"amount":4500,"divisor":100,"currency_code":"USD"},"taxonomy_id":1633,"tags":["kitchen","personalized"],"who_made":"i_did","when_made":"made_to_order","num_favorers":57,"views":1531,"created_timestamp":1717430400}]}
   */
  async listShopListings(state, limit, offset, sortOn, sortOrder, shopId) {
    const resolvedShopId = await this.#getShopId(shopId)

    return this.#apiRequest({
      logTag: 'listShopListings',
      url: `${ API_BASE_URL }/shops/${ resolvedShopId }/listings`,
      query: {
        state: this.#resolveChoice(state, LISTING_STATE_OPTIONS),
        limit,
        offset,
        sort_on: this.#resolveChoice(sortOn, LISTING_SORT_ON_OPTIONS),
        sort_order: this.#resolveChoice(sortOrder, SORT_ORDER_OPTIONS),
      },
    })
  }

  /**
   * @description Retrieves a single Etsy listing by its id, with optional associated data attached: Images, Shop, User, Translations, Videos, Personalization, and BuyerPrice. Returns the full listing record including title, description, state, price, quantity, tags, materials, taxonomy, and timestamps.
   *
   * @route GET /get-listing
   * @operationName Get Listing
   * @category Listings
   *
   * @paramDef {"type":"String","label":"Listing","name":"listingId","required":true,"dictionary":"getListingsDictionary","description":"The listing to retrieve. Select an active listing from the connected shop or enter any listing id directly."}
   * @paramDef {"type":"Array<String>","label":"Includes","name":"includes","uiComponent":{"type":"DROPDOWN","options":{"values":["Images","Shop","User","Translations","Videos","Personalization","BuyerPrice"]}},"description":"Optional associated data to attach to the listing. When omitted, only the listing record itself is returned."}
   *
   * @returns {Object}
   * @sampleResult {"listing_id":1234567890,"user_id":23456789,"shop_id":12345678,"title":"Personalized Oak Cutting Board","description":"Solid oak cutting board with custom engraving.","state":"active","quantity":10,"url":"https://www.etsy.com/listing/1234567890","price":{"amount":4500,"divisor":100,"currency_code":"USD"},"taxonomy_id":1633,"tags":["kitchen","personalized"],"materials":["oak"],"who_made":"i_did","when_made":"made_to_order","is_personalizable":true,"num_favorers":57,"views":1531,"created_timestamp":1717430400,"images":[{"listing_image_id":5678901234,"url_fullxfull":"https://i.etsystatic.com/isla/abc123/full.jpg","rank":1}]}
   */
  async getListing(listingId, includes) {
    if (!listingId) {
      throw new Error('"Listing" is required')
    }

    const includesList = (Array.isArray(includes) ? includes : []).filter(Boolean)

    return this.#apiRequest({
      logTag: 'getListing',
      url: `${ API_BASE_URL }/listings/${ encodeURIComponent(listingId) }`,
      query: { includes: includesList.length ? includesList.join(',') : undefined },
    })
  }

  /**
   * @description Retrieves multiple Etsy listings in a single call by their ids (up to 100 per request), with optional associated data attached to each. Listings the caller cannot access are silently omitted from the results.
   *
   * @route GET /get-listings-by-ids
   * @operationName Get Listings by IDs
   * @category Listings
   *
   * @paramDef {"type":"Array<String>","label":"Listing IDs","name":"listingIds","required":true,"description":"The numeric ids of the listings to retrieve (maximum 100)."}
   * @paramDef {"type":"Array<String>","label":"Includes","name":"includes","uiComponent":{"type":"DROPDOWN","options":{"values":["Images","Shop","User","Translations","Videos","Personalization","BuyerPrice"]}},"description":"Optional associated data to attach to each listing. When omitted, only the listing records themselves are returned."}
   *
   * @returns {Object}
   * @sampleResult {"count":2,"results":[{"listing_id":1234567890,"title":"Personalized Oak Cutting Board","state":"active","price":{"amount":4500,"divisor":100,"currency_code":"USD"}},{"listing_id":1234567891,"title":"Walnut Serving Tray","state":"active","price":{"amount":6200,"divisor":100,"currency_code":"USD"}}]}
   */
  async getListingsByIds(listingIds, includes) {
    if (!Array.isArray(listingIds) || !listingIds.length) {
      throw new Error('"Listing IDs" is required')
    }

    const includesList = (Array.isArray(includes) ? includes : []).filter(Boolean)

    return this.#apiRequest({
      logTag: 'getListingsByIds',
      url: `${ API_BASE_URL }/listings/batch`,
      query: {
        listing_ids: listingIds.join(','),
        includes: includesList.length ? includesList.join(',') : undefined,
      },
    })
  }

  /**
   * @description Creates a new listing in an Etsy shop in the Draft state (it is not published until activated, and Etsy charges its listing fee upon activation). Requires a title, description, price, quantity, and a taxonomy category; physical listings additionally need a shipping profile. Supports up to 13 tags, up to 2 style strings, materials, personalization, and digital-download listings. The price must be at least 0.20 in the shop currency. Requires the listings_w scope.
   *
   * @route POST /create-draft-listing
   * @operationName Create Draft Listing
   * @category Listings
   *
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"The listing title shown to buyers (maximum 140 characters)."}
   * @paramDef {"type":"String","label":"Description","name":"description","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The full listing description shown on the listing page."}
   * @paramDef {"type":"Number","label":"Price","name":"price","required":true,"description":"The price per unit as a decimal number in the shop's currency (e.g. 45.00). Minimum 0.20."}
   * @paramDef {"type":"Number","label":"Quantity","name":"quantity","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The number of units available for sale."}
   * @paramDef {"type":"String","label":"Category","name":"taxonomyId","required":true,"dictionary":"getTaxonomyNodesDictionary","description":"The Etsy seller taxonomy category for the listing. Search the taxonomy dictionary (e.g. 'cutting board') or enter a taxonomy id directly."}
   * @paramDef {"type":"String","label":"Who Made It","name":"whoMade","defaultValue":"I Did","uiComponent":{"type":"DROPDOWN","options":{"values":["I Did","Someone Else","Collective"]}},"description":"Who made the item. Default: 'I Did'."}
   * @paramDef {"type":"String","label":"When Made","name":"whenMade","defaultValue":"Made To Order","uiComponent":{"type":"DROPDOWN","options":{"values":["Made To Order","2020-2026","2010-2019","2007-2009","Before 2007","2000-2006","1990s","1980s","1970s","1960s","1950s","1940s","1930s","1920s","1910s","1900s","1800s","1700s","Before 1700"]}},"description":"When the item was made. Etsy requires vintage items to be at least 20 years old. Default: 'Made To Order'."}
   * @paramDef {"type":"String","label":"Type","name":"type","defaultValue":"Physical","uiComponent":{"type":"DROPDOWN","options":{"values":["Physical","Digital Download","Physical and Digital"]}},"description":"Whether the listing is a physical item, a digital download, or both. Default: 'Physical'."}
   * @paramDef {"type":"String","label":"Shipping Profile","name":"shippingProfileId","dictionary":"getShippingProfilesDictionary","description":"The shipping profile for the listing. Required for physical listings in shops onboarded to shipping profiles; not used for digital downloads."}
   * @paramDef {"type":"Number","label":"Return Policy ID","name":"returnPolicyId","description":"The id of the shop return policy to apply. Required for physical listings in shops onboarded to return policies."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","description":"Search tags for the listing (maximum 13). Tags may contain only letters, numbers, spaces, hyphens, and apostrophes."}
   * @paramDef {"type":"Array<String>","label":"Materials","name":"materials","description":"Materials the item is made of (maximum 13), e.g. ['oak','mineral oil']."}
   * @paramDef {"type":"Array<String>","label":"Styles","name":"styles","description":"Free-form style strings for the listing (maximum 2, each up to 45 characters), e.g. ['Rustic']."}
   * @paramDef {"type":"Boolean","label":"Is Personalizable","name":"isPersonalizable","uiComponent":{"type":"CHECKBOX"},"description":"Whether buyers can personalize the item. Default: false."}
   * @paramDef {"type":"Number","label":"Shop ID","name":"shopId","description":"The Etsy shop to create the listing in. Leave empty to use the shop of the connected account."}
   *
   * @returns {Object}
   * @sampleResult {"listing_id":1234567890,"user_id":23456789,"shop_id":12345678,"title":"Personalized Oak Cutting Board","description":"Solid oak cutting board with custom engraving.","state":"draft","quantity":10,"price":{"amount":4500,"divisor":100,"currency_code":"USD"},"taxonomy_id":1633,"tags":["kitchen","personalized"],"who_made":"i_did","when_made":"made_to_order","listing_type":"physical","url":"https://www.etsy.com/listing/1234567890","created_timestamp":1721000000}
   */
  async createDraftListing(
    title, description, price, quantity, taxonomyId, whoMade, whenMade, type,
    shippingProfileId, returnPolicyId, tags, materials, styles, isPersonalizable, shopId
  ) {
    if (!title || !description || price == null || quantity == null || !taxonomyId) {
      throw new Error('"Title", "Description", "Price", "Quantity", and "Category" are required')
    }

    if (Array.isArray(tags) && tags.length > 13) {
      throw new Error('A listing can have at most 13 tags')
    }

    if (Array.isArray(styles) && styles.length > 2) {
      throw new Error('A listing can have at most 2 styles')
    }

    const resolvedShopId = await this.#getShopId(shopId)

    return this.#apiRequest({
      logTag: 'createDraftListing',
      method: 'post',
      url: `${ API_BASE_URL }/shops/${ resolvedShopId }/listings`,
      form: {
        title,
        description,
        price,
        quantity,
        taxonomy_id: taxonomyId,
        who_made: this.#resolveChoice(whoMade, WHO_MADE_OPTIONS) || 'i_did',
        when_made: this.#resolveChoice(whenMade, WHEN_MADE_OPTIONS) || 'made_to_order',
        type: this.#resolveChoice(type, LISTING_TYPE_OPTIONS),
        shipping_profile_id: shippingProfileId,
        return_policy_id: returnPolicyId,
        tags,
        materials,
        styles,
        is_personalizable: isPersonalizable,
      },
    })
  }

  /**
   * @description Updates an existing Etsy listing's attributes: title, description, tags, materials, category, shipping profile, return policy, shop section, state (activate or deactivate), personalization, and auto-renew. Only the provided fields are changed; at least one is required. Note that price and quantity are managed through Update Listing Inventory, not here. Activating a draft listing incurs Etsy's listing fee. Requires the listings_w scope.
   *
   * @route PATCH /update-listing
   * @operationName Update Listing
   * @category Listings
   *
   * @paramDef {"type":"String","label":"Listing","name":"listingId","required":true,"dictionary":"getListingsDictionary","description":"The listing to update. Select an active listing from the connected shop or enter any listing id directly."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"New listing title (maximum 140 characters)."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New full listing description."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","description":"New search tags for the listing (maximum 13). Replaces the entire existing tag list."}
   * @paramDef {"type":"Array<String>","label":"Materials","name":"materials","description":"New materials list for the listing (maximum 13). Replaces the entire existing materials list."}
   * @paramDef {"type":"String","label":"State","name":"state","uiComponent":{"type":"DROPDOWN","options":{"values":["Active","Inactive"]}},"description":"Set to 'Active' to publish/reactivate the listing or 'Inactive' to deactivate it. Leave empty to keep the current state. Activating a draft incurs Etsy's listing fee."}
   * @paramDef {"type":"String","label":"Shipping Profile","name":"shippingProfileId","dictionary":"getShippingProfilesDictionary","description":"New shipping profile for the listing."}
   * @paramDef {"type":"Number","label":"Return Policy ID","name":"returnPolicyId","description":"New return policy id for the listing."}
   * @paramDef {"type":"String","label":"Shop Section","name":"shopSectionId","dictionary":"getShopSectionsDictionary","description":"The shop section to place the listing in."}
   * @paramDef {"type":"String","label":"Category","name":"taxonomyId","dictionary":"getTaxonomyNodesDictionary","description":"New Etsy seller taxonomy category for the listing."}
   * @paramDef {"type":"String","label":"Is Personalizable","name":"isPersonalizable","defaultValue":"Leave Unchanged","uiComponent":{"type":"DROPDOWN","options":{"values":["Leave Unchanged","Yes","No"]}},"description":"Whether buyers can personalize the item. Default: 'Leave Unchanged'."}
   * @paramDef {"type":"String","label":"Should Auto Renew","name":"shouldAutoRenew","defaultValue":"Leave Unchanged","uiComponent":{"type":"DROPDOWN","options":{"values":["Leave Unchanged","Yes","No"]}},"description":"Whether the listing renews automatically when it expires or sells out. Default: 'Leave Unchanged'."}
   * @paramDef {"type":"Number","label":"Shop ID","name":"shopId","description":"The Etsy shop that owns the listing. Leave empty to use the shop of the connected account."}
   *
   * @returns {Object}
   * @sampleResult {"listing_id":1234567890,"shop_id":12345678,"title":"Personalized Oak Cutting Board - Engraved","state":"active","quantity":10,"price":{"amount":4500,"divisor":100,"currency_code":"USD"},"tags":["kitchen","personalized","engraved"],"taxonomy_id":1633,"shop_section_id":34567,"should_auto_renew":true,"updated_timestamp":1721100000}
   */
  async updateListing(
    listingId, title, description, tags, materials, state, shippingProfileId,
    returnPolicyId, shopSectionId, taxonomyId, isPersonalizable, shouldAutoRenew, shopId
  ) {
    if (!listingId) {
      throw new Error('"Listing" is required')
    }

    const form = cleanupObject({
      title,
      description,
      tags,
      materials,
      state: this.#resolveChoice(state, UPDATE_LISTING_STATE_OPTIONS),
      shipping_profile_id: shippingProfileId,
      return_policy_id: returnPolicyId,
      shop_section_id: shopSectionId,
      taxonomy_id: taxonomyId,
      is_personalizable: this.#resolveChoice(isPersonalizable, TRISTATE_UPDATE_OPTIONS),
      should_auto_renew: this.#resolveChoice(shouldAutoRenew, TRISTATE_UPDATE_OPTIONS),
    })

    if (!Object.keys(form).length) {
      throw new Error('Provide at least one field to update')
    }

    const resolvedShopId = await this.#getShopId(shopId)

    return this.#apiRequest({
      logTag: 'updateListing',
      method: 'patch',
      url: `${ API_BASE_URL }/shops/${ resolvedShopId }/listings/${ encodeURIComponent(listingId) }`,
      form,
    })
  }

  /**
   * @description Permanently deletes an Etsy listing. Etsy only allows deletion when the listing is in one of these states: sold out, draft, expired, inactive, or active with no pending or completed orders. Returns a success status. Requires the listings_d scope.
   *
   * @route DELETE /delete-listing
   * @operationName Delete Listing
   * @category Listings
   *
   * @paramDef {"type":"String","label":"Listing","name":"listingId","required":true,"dictionary":"getListingsDictionary","description":"The listing to delete. Select an active listing from the connected shop or enter any listing id directly."}
   *
   * @returns {Object}
   * @sampleResult {"status":"success"}
   */
  async deleteListing(listingId) {
    if (!listingId) {
      throw new Error('"Listing" is required')
    }

    return this.#apiRequest({
      logTag: 'deleteListing',
      method: 'delete',
      url: `${ API_BASE_URL }/listings/${ encodeURIComponent(listingId) }`,
    })
  }

  /**
   * @description Retrieves the full inventory record of an Etsy listing: its products (variations), each with a SKU, variation property values, and offerings carrying the price, quantity, and enabled flag, plus the property arrays that control which attribute prices, quantities, and SKUs vary on. Use this to inspect the structure before calling Update Listing Inventory.
   *
   * @route GET /get-listing-inventory
   * @operationName Get Listing Inventory
   * @category Listings
   *
   * @paramDef {"type":"String","label":"Listing","name":"listingId","required":true,"dictionary":"getListingsDictionary","description":"The listing whose inventory to retrieve. Select an active listing from the connected shop or enter any listing id directly."}
   *
   * @returns {Object}
   * @sampleResult {"products":[{"product_id":987654321,"sku":"OAK-01","is_deleted":false,"offerings":[{"offering_id":1122334455,"quantity":10,"is_enabled":true,"is_deleted":false,"price":{"amount":4500,"divisor":100,"currency_code":"USD"}}],"property_values":[{"property_id":513,"property_name":"Size","values":["Medium"],"value_ids":[5561256091]}]}],"price_on_property":[513],"quantity_on_property":[],"sku_on_property":[513]}
   */
  async getListingInventory(listingId) {
    if (!listingId) {
      throw new Error('"Listing" is required')
    }

    return this.#apiRequest({
      logTag: 'getListingInventory',
      url: `${ API_BASE_URL }/listings/${ encodeURIComponent(listingId) }/inventory`,
    })
  }

  /**
   * @typedef {Object} ListingPropertyValue
   * @paramDef {"type":"Number","label":"Property ID","name":"property_id","required":true,"description":"The id of the variation property (e.g. 513 for Size)."}
   * @paramDef {"type":"Array<Number>","label":"Value IDs","name":"value_ids","description":"The ids of the selected property values, when using standard Etsy values."}
   * @paramDef {"type":"Number","label":"Scale ID","name":"scale_id","description":"The id of the measurement scale for the property, when applicable (e.g. inches vs. centimeters)."}
   * @paramDef {"type":"String","label":"Property Name","name":"property_name","description":"The display name of the property (e.g. 'Size')."}
   * @paramDef {"type":"Array<String>","label":"Values","name":"values","required":true,"description":"The value strings for the property (e.g. ['Medium'])."}
   */

  /**
   * @typedef {Object} InventoryOffering
   * @paramDef {"type":"Number","label":"Price","name":"price","required":true,"description":"The offering price as a decimal number in the shop's currency (e.g. 45.00). Minimum 0.20."}
   * @paramDef {"type":"Number","label":"Quantity","name":"quantity","required":true,"description":"The number of units in stock for this offering."}
   * @paramDef {"type":"Boolean","label":"Is Enabled","name":"is_enabled","uiComponent":{"type":"CHECKBOX"},"description":"Whether the offering can be purchased. Default: true."}
   */

  /**
   * @typedef {Object} InventoryProduct
   * @paramDef {"type":"String","label":"SKU","name":"sku","description":"The product SKU. If any product in the listing has a SKU, every product must have one."}
   * @paramDef {"type":"Array<ListingPropertyValue>","label":"Property Values","name":"property_values","description":"The variation property values identifying this product (e.g. Size: Medium). Omit for listings without variations."}
   * @paramDef {"type":"Array<InventoryOffering>","label":"Offerings","name":"offerings","required":true,"description":"The offerings (price, quantity, enabled flag) for this product."}
   */

  /**
   * @description Updates an Etsy listing's inventory (prices, quantities, SKUs, and variations). CAREFUL: Etsy's inventory endpoint is a FULL REPLACE — the products array overwrites the listing's entire inventory. This action makes that safe by default: it fetches the current inventory, applies your New Price and/or New Quantity to every offering (optionally only to products matching the SKU filter), strips the read-only fields Etsy rejects (product_id, offering_id, is_deleted, scale_name) and converts price objects to decimals, then writes the result back. Alternatively, supply the Products parameter to replace the whole inventory structure explicitly (it is sanitized the same way). Requires the listings_w scope.
   *
   * @route PUT /update-listing-inventory
   * @operationName Update Listing Inventory
   * @category Listings
   *
   * @paramDef {"type":"String","label":"Listing","name":"listingId","required":true,"dictionary":"getListingsDictionary","description":"The listing whose inventory to update. Select an active listing from the connected shop or enter any listing id directly."}
   * @paramDef {"type":"Number","label":"New Price","name":"newPrice","description":"New price as a decimal number in the shop's currency (e.g. 49.99), applied to every offering of the targeted products. Minimum 0.20."}
   * @paramDef {"type":"Number","label":"New Quantity","name":"newQuantity","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"New stock quantity, applied to every offering of the targeted products."}
   * @paramDef {"type":"String","label":"SKU Filter","name":"sku","description":"When set, New Price / New Quantity are applied only to products with this exact SKU. When omitted, all products are updated."}
   * @paramDef {"type":"Array<InventoryProduct>","label":"Products","name":"rawProducts","description":"Advanced: the complete replacement inventory. When provided, New Price, New Quantity, and SKU Filter are ignored and this array becomes the listing's entire inventory (read-only fields are stripped automatically)."}
   * @paramDef {"type":"Array<Number>","label":"Price On Property","name":"priceOnProperty","description":"Advanced: variation property ids on which price varies. Defaults to the listing's current setting."}
   * @paramDef {"type":"Array<Number>","label":"Quantity On Property","name":"quantityOnProperty","description":"Advanced: variation property ids on which quantity varies. Defaults to the listing's current setting."}
   * @paramDef {"type":"Array<Number>","label":"SKU On Property","name":"skuOnProperty","description":"Advanced: variation property ids on which SKU varies. Defaults to the listing's current setting."}
   *
   * @returns {Object}
   * @sampleResult {"products":[{"product_id":987654321,"sku":"OAK-01","is_deleted":false,"offerings":[{"offering_id":1122334455,"quantity":25,"is_enabled":true,"is_deleted":false,"price":{"amount":4999,"divisor":100,"currency_code":"USD"}}],"property_values":[{"property_id":513,"property_name":"Size","values":["Medium"],"value_ids":[5561256091]}]}],"price_on_property":[513],"quantity_on_property":[],"sku_on_property":[513]}
   */
  async updateListingInventory(listingId, newPrice, newQuantity, sku, rawProducts, priceOnProperty, quantityOnProperty, skuOnProperty) {
    if (!listingId) {
      throw new Error('"Listing" is required')
    }

    const current = await this.getListingInventory(listingId)

    let products

    if (Array.isArray(rawProducts) && rawProducts.length) {
      products = this.#sanitizeInventoryProducts(rawProducts)
    } else {
      if (newPrice == null && newQuantity == null) {
        throw new Error('Provide "New Price", "New Quantity", or "Products" — otherwise there is nothing to update.')
      }

      products = this.#sanitizeInventoryProducts(current.products)

      const matching = products.filter(product => !sku || product.sku === sku)

      if (!matching.length) {
        const available = products.map(product => product.sku).filter(Boolean).join(', ') || '(none)'

        throw new Error(`No product with SKU "${ sku }" found in the listing inventory. Available SKUs: ${ available }`)
      }

      for (const product of matching) {
        for (const offering of product.offerings) {
          if (newPrice != null) {
            offering.price = newPrice
          }

          if (newQuantity != null) {
            offering.quantity = newQuantity
          }
        }
      }
    }

    const body = {
      products,
      price_on_property: Array.isArray(priceOnProperty) ? priceOnProperty : (current.price_on_property || []),
      quantity_on_property: Array.isArray(quantityOnProperty) ? quantityOnProperty : (current.quantity_on_property || []),
      sku_on_property: Array.isArray(skuOnProperty) ? skuOnProperty : (current.sku_on_property || []),
    }

    // Preserve processing-profile configuration when the listing uses it.
    if (Array.isArray(current.readiness_state_on_property) && current.readiness_state_on_property.length) {
      body.readiness_state_on_property = current.readiness_state_on_property
    }

    return this.#apiRequest({
      logTag: 'updateListingInventory',
      method: 'put',
      url: `${ API_BASE_URL }/listings/${ encodeURIComponent(listingId) }/inventory`,
      body,
    })
  }

  // Converts inventory products from the GET shape into the shape Etsy's PUT accepts:
  // strips read-only fields (product_id, offering_id, is_deleted, scale_name), drops deleted
  // entries, and converts { amount, divisor } price objects into decimal numbers.
  #sanitizeInventoryProducts(products) {
    return (products || [])
      .filter(product => product && product.is_deleted !== true)
      .map(product => {
        const sanitized = {
          offerings: (product.offerings || [])
            .filter(offering => offering && offering.is_deleted !== true)
            .map(offering => {
              const out = {
                price: this.#toPriceFloat(offering.price),
                quantity: offering.quantity,
                is_enabled: offering.is_enabled !== false,
              }

              if (offering.readiness_state_id != null) {
                out.readiness_state_id = offering.readiness_state_id
              }

              return out
            }),
        }

        if (product.sku) {
          sanitized.sku = product.sku
        }

        const propertyValues = (product.property_values || []).map(propertyValue => {
          const out = { property_id: propertyValue.property_id }

          if (Array.isArray(propertyValue.value_ids) && propertyValue.value_ids.length) {
            out.value_ids = propertyValue.value_ids
          }

          if (propertyValue.scale_id != null) {
            out.scale_id = propertyValue.scale_id
          }

          if (propertyValue.property_name) {
            out.property_name = propertyValue.property_name
          }

          if (Array.isArray(propertyValue.values) && propertyValue.values.length) {
            out.values = propertyValue.values
          }

          return out
        })

        if (propertyValues.length) {
          sanitized.property_values = propertyValues
        }

        return sanitized
      })
  }

  #toPriceFloat(price) {
    if (price && typeof price === 'object') {
      return price.divisor ? price.amount / price.divisor : Number(price.amount)
    }

    return Number(price)
  }

  // ========================================== LISTING IMAGES =========================================

  /**
   * @description Lists all images of an Etsy listing in rank order, including image URLs in multiple resolutions, alt text, and dominant color information.
   *
   * @route GET /list-listing-images
   * @operationName List Listing Images
   * @category Listing Images
   *
   * @paramDef {"type":"String","label":"Listing","name":"listingId","required":true,"dictionary":"getListingsDictionary","description":"The listing whose images to list. Select an active listing from the connected shop or enter any listing id directly."}
   * @paramDef {"type":"Number","label":"Shop ID","name":"shopId","description":"The Etsy shop that owns the listing. Leave empty to use the shop of the connected account."}
   *
   * @returns {Object}
   * @sampleResult {"count":2,"results":[{"listing_id":1234567890,"listing_image_id":5678901234,"rank":1,"alt_text":"Oak cutting board with engraving","hex_code":"AB8C42","url_75x75":"https://i.etsystatic.com/isla/abc123/75x75.jpg","url_570xN":"https://i.etsystatic.com/isla/abc123/570xN.jpg","url_fullxfull":"https://i.etsystatic.com/isla/abc123/full.jpg","full_height":2000,"full_width":3000}]}
   */
  async listListingImages(listingId, shopId) {
    if (!listingId) {
      throw new Error('"Listing" is required')
    }

    const resolvedShopId = await this.#getShopId(shopId)

    return this.#apiRequest({
      logTag: 'listListingImages',
      url: `${ API_BASE_URL }/shops/${ resolvedShopId }/listings/${ encodeURIComponent(listingId) }/images`,
    })
  }

  /**
   * @description Uploads an image from FlowRunner file storage to an Etsy listing. The image is sent as multipart form data with an optional display rank (1 is the primary image), alt text for accessibility, and an overwrite flag to replace the image currently at that rank. Etsy accepts JPG, PNG, and GIF images up to 20MB. Requires the listings_w scope.
   *
   * @route POST /upload-listing-image
   * @operationName Upload Listing Image
   * @category Listing Images
   *
   * @paramDef {"type":"String","label":"Image File","name":"fileUrl","required":true,"uiComponent":{"type":"FILE_SELECTOR"},"description":"The FlowRunner file to upload as a listing image (its URL). The file's bytes are sent to Etsy as-is."}
   * @paramDef {"type":"String","label":"Listing","name":"listingId","required":true,"dictionary":"getListingsDictionary","description":"The listing to attach the image to. Select an active listing from the connected shop or enter any listing id directly."}
   * @paramDef {"type":"Number","label":"Rank","name":"rank","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The display position of the image (1 is the primary image). Default: 1."}
   * @paramDef {"type":"Boolean","label":"Overwrite","name":"overwrite","uiComponent":{"type":"CHECKBOX"},"description":"When enabled, replaces the image currently at the given rank instead of shifting it down. Default: false."}
   * @paramDef {"type":"String","label":"Alt Text","name":"altText","description":"Accessibility alt text for the image (maximum 500 characters)."}
   * @paramDef {"type":"Number","label":"Shop ID","name":"shopId","description":"The Etsy shop that owns the listing. Leave empty to use the shop of the connected account."}
   *
   * @returns {Object}
   * @sampleResult {"listing_id":1234567890,"listing_image_id":5678901234,"rank":1,"alt_text":"Oak cutting board with engraving","hex_code":"AB8C42","url_75x75":"https://i.etsystatic.com/isla/abc123/75x75.jpg","url_fullxfull":"https://i.etsystatic.com/isla/abc123/full.jpg","full_height":2000,"full_width":3000}
   */
  async uploadListingImage(fileUrl, listingId, rank, overwrite, altText, shopId) {
    if (!fileUrl) {
      throw new Error('"Image File" is required')
    }

    if (!listingId) {
      throw new Error('"Listing" is required')
    }

    const resolvedShopId = await this.#getShopId(shopId)

    const filename = decodeURIComponent(String(fileUrl).split('/').pop().split('?')[0]) || 'image.jpg'
    const buffer = this.#toBuffer(await Flowrunner.Request.get(fileUrl).setEncoding(null))

    logger.debug(`uploadListingImage - uploading ${ buffer.length } bytes as "${ filename }" to listing ${ listingId }`)

    // Do NOT set Content-Type manually — the form supplies the multipart boundary.
    const formData = new Flowrunner.Request.FormData()

    formData.append('image', buffer, { filename })

    if (rank != null) {
      formData.append('rank', String(rank))
    }

    if (overwrite != null) {
      formData.append('overwrite', String(overwrite))
    }

    if (altText) {
      formData.append('alt_text', altText)
    }

    try {
      return await Flowrunner.Request
        .post(`${ API_BASE_URL }/shops/${ resolvedShopId }/listings/${ encodeURIComponent(listingId) }/images`)
        .set(this.#authHeaders())
        .form(formData)
    } catch (error) {
      const message = this.#extractError(error)

      logger.error(`uploadListingImage - failed: ${ message }`)

      throw new Error(`Etsy API error: ${ message }`)
    }
  }

  /**
   * @description Removes an image from an Etsy listing. The image is deassociated from the listing, not destroyed: re-uploading the same image within 30 days restores it (Etsy retains deleted listing images for that period). Returns a success status. Requires the listings_w scope.
   *
   * @route DELETE /delete-listing-image
   * @operationName Delete Listing Image
   * @category Listing Images
   *
   * @paramDef {"type":"String","label":"Listing","name":"listingId","required":true,"dictionary":"getListingsDictionary","description":"The listing that owns the image. Select an active listing from the connected shop or enter any listing id directly."}
   * @paramDef {"type":"Number","label":"Listing Image ID","name":"listingImageId","required":true,"description":"The id of the image to remove, as returned by List Listing Images."}
   * @paramDef {"type":"Number","label":"Shop ID","name":"shopId","description":"The Etsy shop that owns the listing. Leave empty to use the shop of the connected account."}
   *
   * @returns {Object}
   * @sampleResult {"status":"success"}
   */
  async deleteListingImage(listingId, listingImageId, shopId) {
    if (!listingId) {
      throw new Error('"Listing" is required')
    }

    if (!listingImageId) {
      throw new Error('"Listing Image ID" is required')
    }

    const resolvedShopId = await this.#getShopId(shopId)

    return this.#apiRequest({
      logTag: 'deleteListingImage',
      method: 'delete',
      url: `${ API_BASE_URL }/shops/${ resolvedShopId }/listings/${ encodeURIComponent(listingId) }/images/${ encodeURIComponent(listingImageId) }`,
    })
  }

  // ============================================= RECEIPTS ============================================

  /**
   * @description Lists an Etsy shop's receipts (orders), each containing the buyer, shipping address, payment status, totals, and line-item transactions. Supports filtering by creation date range and by paid/shipped/delivered status, plus pagination and sorting. Requires the transactions_r scope.
   *
   * @route GET /list-shop-receipts
   * @operationName List Shop Receipts
   * @category Receipts
   *
   * @paramDef {"type":"String","label":"Created After","name":"minCreated","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Only return receipts created at or after this time (ISO 8601 date/time or Unix timestamp)."}
   * @paramDef {"type":"String","label":"Created Before","name":"maxCreated","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Only return receipts created at or before this time (ISO 8601 date/time or Unix timestamp)."}
   * @paramDef {"type":"String","label":"Was Paid","name":"wasPaid","defaultValue":"Any","uiComponent":{"type":"DROPDOWN","options":{"values":["Any","Yes","No"]}},"description":"Filter by payment status. Default: 'Any' (no filter)."}
   * @paramDef {"type":"String","label":"Was Shipped","name":"wasShipped","defaultValue":"Any","uiComponent":{"type":"DROPDOWN","options":{"values":["Any","Yes","No"]}},"description":"Filter by shipment status. Default: 'Any' (no filter)."}
   * @paramDef {"type":"String","label":"Was Delivered","name":"wasDelivered","defaultValue":"Any","uiComponent":{"type":"DROPDOWN","options":{"values":["Any","Yes","No"]}},"description":"Filter by delivery status. Default: 'Any' (no filter)."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","defaultValue":25,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of receipts to return per page (1-100). Default: 25."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","defaultValue":0,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of receipts to skip, for pagination. Default: 0."}
   * @paramDef {"type":"String","label":"Sort By","name":"sortOn","defaultValue":"Created","uiComponent":{"type":"DROPDOWN","options":{"values":["Created","Updated","Receipt ID"]}},"description":"The field to sort results by. Default: 'Created'."}
   * @paramDef {"type":"String","label":"Sort Order","name":"sortOrder","defaultValue":"Descending","uiComponent":{"type":"DROPDOWN","options":{"values":["Descending","Ascending"]}},"description":"The sort direction. Default: 'Descending' (newest first)."}
   * @paramDef {"type":"Number","label":"Shop ID","name":"shopId","description":"The Etsy shop whose receipts to list. Leave empty to use the shop of the connected account."}
   *
   * @returns {Object}
   * @sampleResult {"count":128,"results":[{"receipt_id":3210987654,"seller_user_id":23456789,"buyer_user_id":34567890,"name":"Jane Doe","first_line":"123 Main St","city":"Portland","state":"OR","zip":"97201","country_iso":"US","status":"Paid","was_paid":true,"was_shipped":false,"message_from_buyer":"Please gift wrap","grandtotal":{"amount":5200,"divisor":100,"currency_code":"USD"},"created_timestamp":1721000000,"transactions":[{"transaction_id":4321098765,"listing_id":1234567890,"title":"Personalized Oak Cutting Board","quantity":1,"sku":"OAK-01"}]}]}
   */
  async listShopReceipts(minCreated, maxCreated, wasPaid, wasShipped, wasDelivered, limit, offset, sortOn, sortOrder, shopId) {
    const resolvedShopId = await this.#getShopId(shopId)

    return this.#apiRequest({
      logTag: 'listShopReceipts',
      url: `${ API_BASE_URL }/shops/${ resolvedShopId }/receipts`,
      query: {
        min_created: this.#toEpochSeconds(minCreated, 'Created After'),
        max_created: this.#toEpochSeconds(maxCreated, 'Created Before'),
        was_paid: this.#resolveChoice(wasPaid, TRISTATE_FILTER_OPTIONS),
        was_shipped: this.#resolveChoice(wasShipped, TRISTATE_FILTER_OPTIONS),
        was_delivered: this.#resolveChoice(wasDelivered, TRISTATE_FILTER_OPTIONS),
        limit,
        offset,
        sort_on: this.#resolveChoice(sortOn, RECEIPT_SORT_ON_OPTIONS),
        sort_order: this.#resolveChoice(sortOrder, SORT_ORDER_OPTIONS),
      },
    })
  }

  /**
   * @description Retrieves a single Etsy receipt (order) by its id, including the buyer, shipping address, payment and shipment status, totals, shipments with tracking, and all line-item transactions. Requires the transactions_r scope.
   *
   * @route GET /get-receipt
   * @operationName Get Receipt
   * @category Receipts
   *
   * @paramDef {"type":"Number","label":"Receipt ID","name":"receiptId","required":true,"description":"The numeric id of the receipt (order) to retrieve."}
   * @paramDef {"type":"Number","label":"Shop ID","name":"shopId","description":"The Etsy shop that owns the receipt. Leave empty to use the shop of the connected account."}
   *
   * @returns {Object}
   * @sampleResult {"receipt_id":3210987654,"seller_user_id":23456789,"buyer_user_id":34567890,"name":"Jane Doe","first_line":"123 Main St","city":"Portland","state":"OR","zip":"97201","country_iso":"US","status":"Paid","payment_method":"cc","was_paid":true,"was_shipped":true,"grandtotal":{"amount":5200,"divisor":100,"currency_code":"USD"},"created_timestamp":1721000000,"shipments":[{"receipt_shipping_id":998877,"carrier_name":"USPS","tracking_code":"9400100000000000000000"}],"transactions":[{"transaction_id":4321098765,"listing_id":1234567890,"title":"Personalized Oak Cutting Board","quantity":1,"price":{"amount":4500,"divisor":100,"currency_code":"USD"}}]}
   */
  async getReceipt(receiptId, shopId) {
    if (!receiptId) {
      throw new Error('"Receipt ID" is required')
    }

    const resolvedShopId = await this.#getShopId(shopId)

    return this.#apiRequest({
      logTag: 'getReceipt',
      url: `${ API_BASE_URL }/shops/${ resolvedShopId }/receipts/${ encodeURIComponent(receiptId) }`,
    })
  }

  /**
   * @description Updates an Etsy receipt's (order's) fulfillment flags: mark it as shipped and/or as paid. Only the provided flags are changed; at least one is required. To record a tracking number and notify the buyer, use Create Receipt Shipment instead. Requires the transactions_w scope.
   *
   * @route PUT /update-receipt
   * @operationName Update Receipt
   * @category Receipts
   *
   * @paramDef {"type":"Number","label":"Receipt ID","name":"receiptId","required":true,"description":"The numeric id of the receipt (order) to update."}
   * @paramDef {"type":"String","label":"Was Shipped","name":"wasShipped","defaultValue":"Leave Unchanged","uiComponent":{"type":"DROPDOWN","options":{"values":["Leave Unchanged","Yes","No"]}},"description":"Set the receipt's shipped flag. Default: 'Leave Unchanged'."}
   * @paramDef {"type":"String","label":"Was Paid","name":"wasPaid","defaultValue":"Leave Unchanged","uiComponent":{"type":"DROPDOWN","options":{"values":["Leave Unchanged","Yes","No"]}},"description":"Set the receipt's paid flag. Default: 'Leave Unchanged'."}
   * @paramDef {"type":"Number","label":"Shop ID","name":"shopId","description":"The Etsy shop that owns the receipt. Leave empty to use the shop of the connected account."}
   *
   * @returns {Object}
   * @sampleResult {"receipt_id":3210987654,"status":"Completed","was_paid":true,"was_shipped":true,"grandtotal":{"amount":5200,"divisor":100,"currency_code":"USD"},"updated_timestamp":1721100000}
   */
  async updateReceipt(receiptId, wasShipped, wasPaid, shopId) {
    if (!receiptId) {
      throw new Error('"Receipt ID" is required')
    }

    const form = cleanupObject({
      was_shipped: this.#resolveChoice(wasShipped, TRISTATE_UPDATE_OPTIONS),
      was_paid: this.#resolveChoice(wasPaid, TRISTATE_UPDATE_OPTIONS),
    })

    if (!Object.keys(form).length) {
      throw new Error('Provide at least one of "Was Shipped" or "Was Paid".')
    }

    const resolvedShopId = await this.#getShopId(shopId)

    return this.#apiRequest({
      logTag: 'updateReceipt',
      method: 'put',
      url: `${ API_BASE_URL }/shops/${ resolvedShopId }/receipts/${ encodeURIComponent(receiptId) }`,
      form,
    })
  }

  /**
   * @description Records a shipment on an Etsy receipt (order): submits the tracking code and carrier name, marks the order as shipped, and triggers Etsy's shipping notification to the buyer (optionally BCC-ing the seller and including a personal note). Etsy rejects duplicate tracking codes for the same receipt. Requires the transactions_w scope.
   *
   * @route POST /create-receipt-shipment
   * @operationName Create Receipt Shipment
   * @category Receipts
   *
   * @paramDef {"type":"Number","label":"Receipt ID","name":"receiptId","required":true,"description":"The numeric id of the receipt (order) to record the shipment on."}
   * @paramDef {"type":"String","label":"Tracking Code","name":"trackingCode","description":"The carrier's tracking code for the shipment. When omitted, the order is marked shipped without tracking."}
   * @paramDef {"type":"String","label":"Carrier Name","name":"carrierName","description":"The shipping carrier's name (e.g. 'USPS', 'FedEx', 'DHL'). Required when a tracking code is provided."}
   * @paramDef {"type":"Boolean","label":"Send BCC","name":"sendBcc","uiComponent":{"type":"CHECKBOX"},"description":"When enabled, the seller receives a BCC copy of the buyer's shipping notification email. Default: false."}
   * @paramDef {"type":"String","label":"Note To Buyer","name":"noteToBuyer","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"An optional personal message included in the buyer's shipping notification."}
   * @paramDef {"type":"Number","label":"Shop ID","name":"shopId","description":"The Etsy shop that owns the receipt. Leave empty to use the shop of the connected account."}
   *
   * @returns {Object}
   * @sampleResult {"receipt_id":3210987654,"status":"Completed","was_shipped":true,"shipments":[{"receipt_shipping_id":998877,"carrier_name":"USPS","tracking_code":"9400100000000000000000","shipment_notification_timestamp":1721100000}],"grandtotal":{"amount":5200,"divisor":100,"currency_code":"USD"}}
   */
  async createReceiptShipment(receiptId, trackingCode, carrierName, sendBcc, noteToBuyer, shopId) {
    if (!receiptId) {
      throw new Error('"Receipt ID" is required')
    }

    const resolvedShopId = await this.#getShopId(shopId)

    return this.#apiRequest({
      logTag: 'createReceiptShipment',
      method: 'post',
      url: `${ API_BASE_URL }/shops/${ resolvedShopId }/receipts/${ encodeURIComponent(receiptId) }/tracking`,
      body: cleanupObject({
        tracking_code: trackingCode,
        carrier_name: carrierName,
        send_bcc: sendBcc,
        note_to_buyer: noteToBuyer,
      }),
    })
  }

  /**
   * @description Lists the line-item transactions of a single Etsy receipt (order): each purchased listing with its quantity, SKU, price, shipping cost, personalization variations, and fulfillment timestamps. Requires the transactions_r scope.
   *
   * @route GET /list-receipt-transactions
   * @operationName List Receipt Transactions
   * @category Receipts
   *
   * @paramDef {"type":"Number","label":"Receipt ID","name":"receiptId","required":true,"description":"The numeric id of the receipt (order) whose transactions to list."}
   * @paramDef {"type":"Number","label":"Shop ID","name":"shopId","description":"The Etsy shop that owns the receipt. Leave empty to use the shop of the connected account."}
   *
   * @returns {Object}
   * @sampleResult {"count":1,"results":[{"transaction_id":4321098765,"title":"Personalized Oak Cutting Board","seller_user_id":23456789,"buyer_user_id":34567890,"listing_id":1234567890,"receipt_id":3210987654,"quantity":1,"sku":"OAK-01","price":{"amount":4500,"divisor":100,"currency_code":"USD"},"shipping_cost":{"amount":700,"divisor":100,"currency_code":"USD"},"variations":[{"formatted_name":"Engraving","formatted_value":"The Doe Family"}],"paid_timestamp":1721000000}]}
   */
  async listReceiptTransactions(receiptId, shopId) {
    if (!receiptId) {
      throw new Error('"Receipt ID" is required')
    }

    const resolvedShopId = await this.#getShopId(shopId)

    return this.#apiRequest({
      logTag: 'listReceiptTransactions',
      url: `${ API_BASE_URL }/shops/${ resolvedShopId }/receipts/${ encodeURIComponent(receiptId) }/transactions`,
    })
  }

  // ============================================== REVIEWS ============================================

  /**
   * @description Lists the reviews left by buyers for an Etsy shop, each with the star rating, review text, reviewed listing and transaction, and creation time. Supports pagination and filtering by creation date range.
   *
   * @route GET /list-shop-reviews
   * @operationName List Shop Reviews
   * @category Reviews
   *
   * @paramDef {"type":"Number","label":"Limit","name":"limit","defaultValue":25,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of reviews to return per page (1-100). Default: 25."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","defaultValue":0,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of reviews to skip, for pagination. Default: 0."}
   * @paramDef {"type":"String","label":"Created After","name":"minCreated","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Only return reviews created at or after this time (ISO 8601 date/time or Unix timestamp)."}
   * @paramDef {"type":"String","label":"Created Before","name":"maxCreated","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Only return reviews created at or before this time (ISO 8601 date/time or Unix timestamp)."}
   * @paramDef {"type":"Number","label":"Shop ID","name":"shopId","description":"The Etsy shop whose reviews to list. Leave empty to use the shop of the connected account."}
   *
   * @returns {Object}
   * @sampleResult {"count":310,"results":[{"shop_id":12345678,"listing_id":1234567890,"transaction_id":4321098765,"buyer_user_id":34567890,"rating":5,"review":"Beautiful craftsmanship, arrived quickly!","language":"en","created_timestamp":1721000000,"updated_timestamp":1721000000}]}
   */
  async listShopReviews(limit, offset, minCreated, maxCreated, shopId) {
    const resolvedShopId = await this.#getShopId(shopId)

    return this.#apiRequest({
      logTag: 'listShopReviews',
      url: `${ API_BASE_URL }/shops/${ resolvedShopId }/reviews`,
      query: {
        limit,
        offset,
        min_created: this.#toEpochSeconds(minCreated, 'Created After'),
        max_created: this.#toEpochSeconds(maxCreated, 'Created Before'),
      },
    })
  }

  // =========================================== SHOP SECTIONS =========================================

  /**
   * @description Lists an Etsy shop's sections (the custom categories sellers use to organize their listings), each with its title, rank, and active listing count.
   *
   * @route GET /list-shop-sections
   * @operationName List Shop Sections
   * @category Shop Sections
   *
   * @paramDef {"type":"Number","label":"Shop ID","name":"shopId","description":"The Etsy shop whose sections to list. Leave empty to use the shop of the connected account."}
   *
   * @returns {Object}
   * @sampleResult {"count":3,"results":[{"shop_section_id":34567,"title":"Cutting Boards","rank":1,"user_id":23456789,"active_listing_count":12},{"shop_section_id":34568,"title":"Serving Trays","rank":2,"user_id":23456789,"active_listing_count":8}]}
   */
  async listShopSections(shopId) {
    const resolvedShopId = await this.#getShopId(shopId)

    return this.#apiRequest({
      logTag: 'listShopSections',
      url: `${ API_BASE_URL }/shops/${ resolvedShopId }/sections`,
    })
  }

  /**
   * @description Creates a new section in an Etsy shop for organizing listings. Returns the new section with its id, which can then be assigned to listings via Update Listing. Requires the shops_w scope.
   *
   * @route POST /create-shop-section
   * @operationName Create Shop Section
   * @category Shop Sections
   *
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"The title of the new shop section (maximum 24 characters)."}
   * @paramDef {"type":"Number","label":"Shop ID","name":"shopId","description":"The Etsy shop to create the section in. Leave empty to use the shop of the connected account."}
   *
   * @returns {Object}
   * @sampleResult {"shop_section_id":34569,"title":"Coasters","rank":3,"user_id":23456789,"active_listing_count":0}
   */
  async createShopSection(title, shopId) {
    if (!title) {
      throw new Error('"Title" is required')
    }

    const resolvedShopId = await this.#getShopId(shopId)

    return this.#apiRequest({
      logTag: 'createShopSection',
      method: 'post',
      url: `${ API_BASE_URL }/shops/${ resolvedShopId }/sections`,
      form: { title },
    })
  }

  // ============================================= SHIPPING ============================================

  /**
   * @description Lists an Etsy shop's shipping profiles, each with its title, processing times, origin, and per-destination shipping costs and upgrades. Shipping profile ids are needed when creating physical listings.
   *
   * @route GET /list-shipping-profiles
   * @operationName List Shipping Profiles
   * @category Shipping
   *
   * @paramDef {"type":"Number","label":"Shop ID","name":"shopId","description":"The Etsy shop whose shipping profiles to list. Leave empty to use the shop of the connected account."}
   *
   * @returns {Object}
   * @sampleResult {"count":2,"results":[{"shipping_profile_id":123456789,"title":"Standard US Shipping","user_id":23456789,"min_processing_days":1,"max_processing_days":3,"processing_days_display_label":"1-3 business days","origin_country_iso":"US","origin_postal_code":"97201","shipping_profile_destinations":[{"shipping_profile_destination_id":555666,"destination_country_iso":"US","primary_cost":{"amount":700,"divisor":100,"currency_code":"USD"},"secondary_cost":{"amount":200,"divisor":100,"currency_code":"USD"}}],"shipping_profile_upgrades":[]}]}
   */
  async listShippingProfiles(shopId) {
    const resolvedShopId = await this.#getShopId(shopId)

    return this.#apiRequest({
      logTag: 'listShippingProfiles',
      url: `${ API_BASE_URL }/shops/${ resolvedShopId }/shipping-profiles`,
    })
  }

  // ============================================= TAXONOMY ============================================

  /**
   * @description Retrieves Etsy's complete seller taxonomy (the category tree used to categorize listings) and returns it flattened into a simple list of categories, each with its id, name, level, and full human-readable path (e.g. 'Home & Living > Kitchen & Dining > Cutting Boards'). The taxonomy contains several thousand categories; use the path to find the right taxonomy id for creating listings.
   *
   * @route GET /list-taxonomy-nodes
   * @operationName List Seller Taxonomy Nodes
   * @category Taxonomy
   *
   * @returns {Object}
   * @sampleResult {"count":3,"nodes":[{"id":1,"name":"Accessories","level":1,"path":"Accessories"},{"id":891,"name":"Home & Living","level":1,"path":"Home & Living"},{"id":1633,"name":"Cutting Boards","level":3,"path":"Home & Living > Kitchen & Dining > Cutting Boards"}]}
   */
  async listTaxonomyNodes() {
    const nodes = await this.#getFlattenedTaxonomy()

    return { count: nodes.length, nodes }
  }

  /**
   * @description Retrieves the product properties supported by a specific Etsy taxonomy category (e.g. Size, Color, Material), including each property's possible values and measurement scales. Use these property and value ids when building listing variations for Update Listing Inventory.
   *
   * @route GET /get-taxonomy-properties
   * @operationName Get Taxonomy Properties
   * @category Taxonomy
   *
   * @paramDef {"type":"String","label":"Category","name":"taxonomyId","required":true,"dictionary":"getTaxonomyNodesDictionary","description":"The taxonomy category whose properties to retrieve. Search the taxonomy dictionary or enter a taxonomy id directly."}
   *
   * @returns {Object}
   * @sampleResult {"count":2,"results":[{"property_id":513,"name":"size","display_name":"Size","is_required":false,"supports_attributes":true,"supports_variations":true,"is_multivalued":false,"possible_values":[{"value_id":5561256091,"name":"Medium","scale_id":null,"equal_to":[]}],"scales":[]}]}
   */
  async getTaxonomyProperties(taxonomyId) {
    if (!taxonomyId) {
      throw new Error('"Category" is required')
    }

    return this.#apiRequest({
      logTag: 'getTaxonomyProperties',
      url: `${ API_BASE_URL }/seller-taxonomy/nodes/${ encodeURIComponent(taxonomyId) }/properties`,
    })
  }

  // ============================================= PAYMENTS ============================================

  /**
   * @description Lists the entries in an Etsy shop's payment account ledger (sales, fees, refunds, deposits, and other balance changes) within a required date range. Each entry includes the amount in cents, currency, running balance, type, and a description. Both date bounds are required by Etsy. Requires the transactions_r scope.
   *
   * @route GET /list-payment-ledger-entries
   * @operationName List Payment Ledger Entries
   * @category Payments
   *
   * @paramDef {"type":"String","label":"Created After","name":"minCreated","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Start of the date range (ISO 8601 date/time or Unix timestamp). Required."}
   * @paramDef {"type":"String","label":"Created Before","name":"maxCreated","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"End of the date range (ISO 8601 date/time or Unix timestamp). Required."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","defaultValue":25,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of ledger entries to return per page (1-100). Default: 25."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","defaultValue":0,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of ledger entries to skip, for pagination. Default: 0."}
   * @paramDef {"type":"Number","label":"Shop ID","name":"shopId","description":"The Etsy shop whose ledger to read. Leave empty to use the shop of the connected account."}
   *
   * @returns {Object}
   * @sampleResult {"count":57,"results":[{"entry_id":123456789,"ledger_id":987654321,"sequence_number":42,"amount":4500,"currency":"USD","description":"Sale of Personalized Oak Cutting Board","balance":56900,"create_date":1721000000,"ledger_type":"payment","reference_type":"payment","reference_id":"3210987654"}]}
   */
  async listPaymentLedgerEntries(minCreated, maxCreated, limit, offset, shopId) {
    const minCreatedEpoch = this.#toEpochSeconds(minCreated, 'Created After')
    const maxCreatedEpoch = this.#toEpochSeconds(maxCreated, 'Created Before')

    if (minCreatedEpoch === undefined || maxCreatedEpoch === undefined) {
      throw new Error('"Created After" and "Created Before" are required')
    }

    const resolvedShopId = await this.#getShopId(shopId)

    return this.#apiRequest({
      logTag: 'listPaymentLedgerEntries',
      url: `${ API_BASE_URL }/shops/${ resolvedShopId }/payment-account/ledger-entries`,
      query: {
        min_created: minCreatedEpoch,
        max_created: maxCreatedEpoch,
        limit,
        offset,
      },
    })
  }
}

Flowrunner.ServerCode.addService(EtsyService, [
  {
    name: 'clientId',
    displayName: 'Client ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'The keystring of your Etsy app, from etsy.com/developers/your-apps. New apps start with provisional access: production API access requires Etsy\'s personal-app approval, and apps serving multiple users additionally require Etsy\'s Commercial Access review.',
  },
  {
    name: 'clientSecret',
    displayName: 'Client Secret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'The shared secret of your Etsy app, shown alongside the keystring. It is used to derive the PKCE code verifier for the OAuth flow.',
  },
])
