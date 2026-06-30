'use strict'

// Zoho Inventory v1 REST API: https://www.zoho.com/inventory/api/v1/
//
// Multi-DC: Zoho serves users from one of eight regional data centers. The OAuth callback
// returns `accounts-server`, `location`, and `api_domain` identifying the user's DC. Those
// values are persisted as connection userData so subsequent calls and token refreshes hit
// the correct region — only the originating DC will accept a given refresh token.
//
// No webhook REST API: Zoho Inventory exposes outgoing webhooks ONLY via the in-app
// Settings → Automation → Workflow Rules UI; there is no `/settings/webhooks` endpoint to
// programmatically register them. Realtime triggers are therefore not auto-installed —
// this extension ships polling triggers only. Operators wanting low-latency events must
// hand-configure a Workflow Rule webhook in the Zoho UI pointing at the FlowRunner trigger
// callback URL.
//
// Endpoint shape: every endpoint lives under `/inventory/v1` and requires `organization_id`
// as a query parameter.

const DATA_CENTERS = {
  US: { accountsServer: 'https://accounts.zoho.com', apiDomain: 'https://www.zohoapis.com' },
  EU: { accountsServer: 'https://accounts.zoho.eu', apiDomain: 'https://www.zohoapis.eu' },
  IN: { accountsServer: 'https://accounts.zoho.in', apiDomain: 'https://www.zohoapis.in' },
  AU: { accountsServer: 'https://accounts.zoho.com.au', apiDomain: 'https://www.zohoapis.com.au' },
  JP: { accountsServer: 'https://accounts.zoho.jp', apiDomain: 'https://www.zohoapis.jp' },
  CA: { accountsServer: 'https://accounts.zoho.ca', apiDomain: 'https://www.zohoapis.ca' },
  CN: { accountsServer: 'https://accounts.zoho.com.cn', apiDomain: 'https://www.zohoapis.com.cn' },
  SA: { accountsServer: 'https://accounts.zoho.sa', apiDomain: 'https://www.zohoapis.sa' },
}

const DEFAULT_DATA_CENTER = 'US'

// Scope rules verified against Zoho's OAuth grant page:
//   - Inventory rejects `.ALL` rollup scopes — every resource must enumerate
//     CREATE/READ/UPDATE/DELETE individually or consent fails with "Scope does not exist".
//   - Vendor credits live under the historical scope name `debitnotes`, NOT `vendorcredits`,
//     even though the REST endpoint is `/vendorcredits`.
//   - `vendorpayments` works as an enumerated scope despite being absent from the doc page.
const SCOPE_GROUPS = [
  'contacts',
  'items',
  'compositeitems',
  'inventoryadjustments',
  'transferorders',
  'salesorders',
  'packages',
  'shipmentorders',
  'invoices',
  'customerpayments',
  'salesreturns',
  'creditnotes',
  'purchaseorders',
  'purchasereceives',
  'bills',
  'vendorpayments',
  'debitnotes',
  'settings',
]

const SCOPE_ACTIONS = ['CREATE', 'READ', 'UPDATE', 'DELETE']

const DEFAULT_SCOPE_LIST = SCOPE_GROUPS.flatMap(group =>
  SCOPE_ACTIONS.map(action => `ZohoInventory.${ group }.${ action }`)
)

const DEFAULT_SCOPE_STRING = DEFAULT_SCOPE_LIST.join(' ')

const DEFAULT_PAGE_SIZE = 50
const DICTIONARY_PAGE_SIZE = 100
const POLLING_MAX_PAGES = 50
const LIST_MAX_PER_PAGE = 200

// DROPDOWN value mappings. Each dropdown shows friendly plain-string labels; these maps translate
// the selected label to the Zoho API value in code (via #resolveChoice).
const CONTACT_TYPE_MAP = { Customer: 'customer', Vendor: 'vendor' }
const CONTACT_FILTER_BY_MAP = { Active: 'Status.Active', Inactive: 'Status.Inactive' }
const ITEM_STATUS_MAP = { Active: 'active', Inactive: 'inactive' }
const ITEM_TYPE_MAP = { Inventory: 'inventory', Sales: 'sales', Purchases: 'purchases', 'Sales and Purchases': 'sales_and_purchases' }
const PRODUCT_TYPE_MAP = { Goods: 'goods', Service: 'service' }
const ITEM_FILTER_BY_MAP = { 'All Items': 'Status.All', Active: 'Status.Active', Inactive: 'Status.Inactive', 'Low Stock': 'Status.Lowstock', 'Inventory Items': 'ItemType.Inventory', 'Sales Items': 'ItemType.Sales', 'Purchase Items': 'ItemType.Purchases' }
const SALES_ORDER_STATUS_MAP = { Draft: 'draft', Open: 'open', Invoiced: 'invoiced', 'Partially Invoiced': 'partially_invoiced', Void: 'void', Overdue: 'overdue', 'On Hold': 'onhold', Confirmed: 'confirmed', Closed: 'closed' }
const PURCHASE_ORDER_STATUS_MAP = { Draft: 'draft', Open: 'open', Billed: 'billed', 'Partially Billed': 'partially_billed', Cancelled: 'cancelled', Closed: 'closed' }
const INVOICE_STATUS_MAP = { Draft: 'draft', Sent: 'sent', Overdue: 'overdue', Paid: 'paid', Void: 'void', Unpaid: 'unpaid', 'Partially Paid': 'partially_paid', Viewed: 'viewed' }
const BILL_STATUS_MAP = { Open: 'open', Paid: 'paid', Void: 'void', Draft: 'draft', Overdue: 'overdue', Unpaid: 'unpaid', 'Partially Paid': 'partially_paid' }
const CREDIT_STATUS_MAP = { Draft: 'draft', Open: 'open', Closed: 'closed', Void: 'void' }
const SHIPMENT_STATUS_MAP = { 'Not Shipped': 'NotShipped', Shipped: 'Shipped', Delivered: 'Delivered' }
const PAYMENT_MODE_MAP = { Cash: 'cash', Check: 'check', 'Credit Card': 'creditcard', 'Bank Transfer': 'banktransfer', 'Bank Remittance': 'bankremittance', 'Auto Transaction': 'autotransaction', Others: 'others' }
const ADJUSTMENT_TYPE_MAP = { Quantity: 'quantity', Value: 'value' }
const LOCATION_TYPE_MAP = { General: 'general', 'Line Item Only': 'line_item_only' }

const logger = {
  info: (...args) => console.log('[Zoho Inventory Service] info:', ...args),
  debug: (...args) => console.log('[Zoho Inventory Service] debug:', ...args),
  error: (...args) => console.error('[Zoho Inventory Service] error:', ...args),
  warn: (...args) => console.warn('[Zoho Inventory Service] warn:', ...args),
}

/**
 * @requireOAuth
 * @integrationName Zoho Inventory
 * @integrationIcon /icon.png
 **/
class ZohoInventoryService {
  constructor(config) {
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
    this.scopes = DEFAULT_SCOPE_STRING

    const dcKey = (config.dataCenter || DEFAULT_DATA_CENTER).toUpperCase()
    const dc = DATA_CENTERS[dcKey] || DATA_CENTERS[DEFAULT_DATA_CENTER]

    this.defaultAccountsServer = dc.accountsServer
    this.defaultApiDomain = dc.apiDomain
    this.defaultOrganizationId = config.defaultOrganizationId || null

    this.lowStockThresholdMultiplier = Number(config.lowStockThresholdMultiplier) > 0
      ? Number(config.lowStockThresholdMultiplier)
      : 1
  }

  // Header / DC helpers

  /**
   * Returns the OAuth header in Zoho's required format. Zoho uses `Zoho-oauthtoken <token>`,
   * NOT `Bearer`.
   */
  #getAccessTokenHeader(accessToken) {
    const token = accessToken || this.request.headers['oauth-access-token']

    return {
      Authorization: `Zoho-oauthtoken ${ token }`,
    }
  }

  #getApiDomain() {
    const headerDomain = this.request?.headers?.['oauth-user-data-apidomain']

    if (headerDomain) {
      return headerDomain
    }

    return this.defaultApiDomain
  }

  #getAccountsServer() {
    const headerAccounts = this.request?.headers?.['oauth-user-data-accountsserver']

    if (headerAccounts) {
      return headerAccounts
    }

    return this.defaultAccountsServer
  }

  #resolveOrganizationId(organizationId) {
    const orgId = organizationId || this.defaultOrganizationId

    if (!orgId) {
      throw new Error(
        'organization_id is required. Provide one via the action parameter or set ' +
        '"Default Organization ID" in service configuration.'
      )
    }

    return orgId
  }

  // Translates a dropdown's friendly label into the Zoho API value. Returns undefined for empty
  // input and passes through any value not present in the mapping.
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  #base() {
    return `${ this.#getApiDomain() }/inventory/v1`
  }

  /**
   * Standard API request helper. Always appends `organization_id` to the query (or URL on DELETE,
   * since some HTTP backends drop query strings on DELETE chains). Wraps Zoho error codes into
   * friendly prefixes so trigger callers can branch on rate limits, auth, etc.
   */
  async #apiRequest({ url, method, body, query, organizationId, logTag }) {
    method = (method || 'get').toLowerCase()

    let finalUrl = url
    let finalQuery

    if (method === 'delete' && organizationId) {
      // Some HTTP backends drop query strings on DELETE chains, so append organization_id
      // directly to the URL. Don't also add it to the query object — Zoho rejects duplicate
      // organization_id params.
      const sep = url.includes('?') ? '&' : '?'

      finalUrl = `${ url }${ sep }organization_id=${ encodeURIComponent(organizationId) }`
      finalQuery = cleanupObject({ ...(query || {}) }) || {}
    } else {
      finalQuery = cleanupObject({
        ...(query || {}),
        organization_id: organizationId,
      }) || {}
    }

    try {
      logger.debug(`${ logTag } - api request: [${ method }::${ finalUrl }] q=[${ JSON.stringify(finalQuery) }]`)

      const request = Flowrunner.Request[method](finalUrl)
        .set(this.#getAccessTokenHeader())
        .set({ 'Content-Type': 'application/json;charset=UTF-8' })
        .query(finalQuery)

      if (body) {
        // Some request runtimes don't auto-serialize Object bodies when Content-Type is
        // application/json. Pre-stringify to be safe across runtimes.
        const payload = typeof body === 'string' ? body : JSON.stringify(body)

        return await request.send(payload)
      }

      return await request
    } catch (error) {
      const zohoMessage = error?.body?.message || error?.message
      const zohoCode = error?.body?.code
      const httpStatus = error?.status || error?.statusCode

      logger.error(`${ logTag } - error http=${ httpStatus } code=${ zohoCode } message=${ zohoMessage }`)

      let prefix = '[Zoho Inventory]'

      if (zohoCode === 44 || (httpStatus === 429 && zohoCode !== 45 && zohoCode !== 1070)) {
        prefix = '[Zoho Inventory][rate-limited:per-minute]'
      } else if (zohoCode === 45) {
        prefix = '[Zoho Inventory][rate-limited:per-day]'
      } else if (zohoCode === 1070) {
        prefix = '[Zoho Inventory][rate-limited:concurrent]'
      } else if (zohoCode === 5 || httpStatus === 401) {
        prefix = '[Zoho Inventory][auth-expired]'
      } else if (zohoCode === 4404) {
        prefix = '[Zoho Inventory][bad-organization-id]'
      } else if (zohoCode === 1002) {
        prefix = '[Zoho Inventory][not-found]'
      } else if (zohoCode === 57) {
        prefix = '[Zoho Inventory][unauthorized]'
      }

      throw new Error(`${ prefix }[${ logTag }] ${ zohoMessage || 'Unknown error' }`)
    }
  }

  // OAUTH2 SYSTEM METHODS

  /**
   * @registerAs SYSTEM
   * @route GET /getOAuth2ConnectionURL
   * @returns {String}
   */
  async getOAuth2ConnectionURL() {
    const params = new URLSearchParams()

    params.append('client_id', this.clientId)
    params.append('response_type', 'code')
    params.append('scope', this.scopes)
    params.append('access_type', 'offline')
    // `prompt=consent` ensures Zoho returns a refresh_token on every consent flow.
    params.append('prompt', 'consent')

    return `${ this.defaultAccountsServer }/oauth/v2/auth?${ params.toString() }`
  }

  /**
   * @typedef {Object} executeCallback_ResultObject
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
    const accountsServer = callbackObject['accounts-server'] ||
      callbackObject.accountsServer ||
      this.defaultAccountsServer

    const location = callbackObject.location || null

    const params = new URLSearchParams()

    params.append('grant_type', 'authorization_code')
    params.append('client_id', this.clientId)
    params.append('client_secret', this.clientSecret)
    params.append('code', callbackObject.code)
    params.append('redirect_uri', callbackObject.redirectURI)

    let tokenResponse = {}

    try {
      tokenResponse = await Flowrunner.Request.post(`${ accountsServer }/oauth/v2/token`)
        .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        .send(params.toString())

      logger.debug('[executeCallback] token exchange successful')
    } catch (error) {
      const zohoMsg = error?.body?.error || error?.message || 'Unknown error'

      logger.error(`[executeCallback] token exchange error: ${ zohoMsg }`)

      throw new Error(`[Zoho Inventory] OAuth token exchange failed: ${ zohoMsg }`)
    }

    if (tokenResponse.error) {
      logger.error(`[executeCallback] Zoho returned error: ${ tokenResponse.error }`)

      throw new Error(`[Zoho Inventory] OAuth token exchange returned error: ${ tokenResponse.error }`)
    }

    if (!tokenResponse.access_token) {
      throw new Error('[Zoho Inventory] OAuth token exchange returned no access_token')
    }

    const apiDomain = tokenResponse.api_domain || this.defaultApiDomain

    let identityName = 'Zoho Inventory Account'
    let primaryOrganization = null

    try {
      const orgsResponse = await Flowrunner.Request
        .get(`${ apiDomain }/inventory/v1/organizations`)
        .set({ Authorization: `Zoho-oauthtoken ${ tokenResponse.access_token }` })

      const organizations = orgsResponse?.organizations || []

      primaryOrganization = organizations.find(o => o.is_default_org) || organizations[0] || null

      if (primaryOrganization) {
        identityName = primaryOrganization.name || identityName
      }
    } catch (error) {
      logger.warn(`[executeCallback] failed to fetch organizations: ${ error.message }`)
    }

    return {
      token: tokenResponse.access_token,
      expirationInSeconds: tokenResponse.expires_in,
      refreshToken: tokenResponse.refresh_token,
      connectionIdentityName: identityName,
      connectionIdentityImageURL: null,
      overwrite: true,
      userData: {
        apiDomain,
        accountsServer,
        location,
        primaryOrganizationId: primaryOrganization?.organization_id || null,
        primaryOrganizationName: primaryOrganization?.name || null,
      },
    }
  }

  /**
   * @typedef {Object} refreshToken_ResultObject
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
    // Zoho refresh tokens are DC-bound. The FlowRunner OAuth runtime usually injects the
    // connection's `userData.accountsServer` as the `oauth-user-data-accountsserver` header on
    // refresh calls, so #getAccountsServer() picks the correct DC. If the framework does not
    // inject the header (older runtimes), fall back to the configured DC then probe the rest.
    const primary = this.#getAccountsServer()
    const order = [primary, this.defaultAccountsServer, ...Object.values(DATA_CENTERS).map(dc => dc.accountsServer)]
    const tried = new Set()

    let lastError

    for (const accountsServer of order) {
      if (tried.has(accountsServer)) {
        continue
      }

      tried.add(accountsServer)

      const params = new URLSearchParams()

      params.append('grant_type', 'refresh_token')
      params.append('client_id', this.clientId)
      params.append('client_secret', this.clientSecret)
      params.append('refresh_token', refreshToken)

      try {
        const response = await Flowrunner.Request.post(`${ accountsServer }/oauth/v2/token`)
          .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
          .send(params.toString())

        if (!response?.access_token) {
          lastError = new Error(`refreshToken: no access_token from ${ accountsServer } (${ response?.error || 'unknown' })`)

          continue
        }

        return {
          token: response.access_token,
          expirationInSeconds: response.expires_in,
          // Zoho refresh tokens are not rotated by default; preserve the original.
          refreshToken: response.refresh_token || refreshToken,
        }
      } catch (error) {
        lastError = error

        logger.warn(`refreshToken at ${ accountsServer } failed: ${ error.message }`)
      }
    }

    logger.error(`refreshToken: exhausted all DCs, last error: ${ lastError?.message }`)

    throw lastError || new Error('[Zoho Inventory] refreshToken failed across all data centers')
  }

  // TEST CONNECTION

  /**
   * @operationName Test Connection
   * @category Diagnostics
   * @description Verifies the OAuth connection is healthy by listing the organizations the connected account can access. Use to sanity-check setup before wiring downstream actions.
   *
   * @route POST /test-connection
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 60
   *
   * @returns {Object}
   * @sampleResult {"ok":true,"organizationCount":1,"organizations":[{"id":"650427230","name":"Acme Inc","currency":"USD"}]}
   */
  async testConnection() {
    const response = await this.#apiRequest({
      logTag: 'testConnection',
      url: `${ this.#base() }/organizations`,
    })

    const organizations = (response?.organizations || []).map(org => ({
      id: org.organization_id,
      name: org.name,
      currency: org.currency_code,
      isDefault: !!org.is_default_org,
    }))

    return {
      ok: true,
      organizationCount: organizations.length,
      organizations,
    }
  }

  // DICTIONARIES

  /**
   * @typedef {Object} DictionaryItem
   * @property {String} label
   * @property {any} value
   * @property {String} note
   */

  /**
   * @typedef {Object} DictionaryResponse
   * @property {Array<DictionaryItem>} items
   * @property {String} [cursor]
   */

  // Organizations

  /**
   * @typedef {Object} listOrganizations__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter organizations by name, currency, or ID. Filtered locally."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (organizations API returns the full list, so cursor is unused)."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName List Organizations
   * @description Returns the Zoho Inventory organizations the connected account can access. Every Inventory API call needs an organization_id, so this dictionary powers the Organization picker on every action.
   *
   * @route POST /list-organizations-dictionary
   *
   * @paramDef {"type":"listOrganizations__payload","label":"Payload","name":"payload","description":"Optional search string and pagination cursor."}
   *
   * @sampleResult {"cursor":null,"items":[{"label":"Acme Inc","note":"USD","value":"650427230"}]}
   * @returns {DictionaryResponse}
   */
  async listOrganizations(payload) {
    const { search } = payload || {}

    const response = await Flowrunner.Request
      .get(`${ this.#base() }/organizations`)
      .set(this.#getAccessTokenHeader())

    let organizations = response?.organizations || []

    if (search) {
      organizations = searchFilter(organizations, ['name', 'organization_id', 'currency_code'], search)
    }

    return {
      cursor: null,
      items: organizations.map(org => ({
        label: org.name || `Organization ${ org.organization_id }`,
        note: org.currency_code || '',
        value: org.organization_id,
      })),
    }
  }

  // Contacts

  /**
   * @typedef {Object} listContacts__payloadCriteria
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Contact Type","name":"contactType","uiComponent":{"type":"DROPDOWN","options":{"values":["Customer","Vendor"]}},"description":"Optional filter to limit to customers or vendors."}
   */

  /**
   * @typedef {Object} listContacts__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional name search; sent to Zoho via contact_name_contains."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (next page number)."}
   * @paramDef {"type":"listContacts__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Organization + optional contact-type filter."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName List Contacts (Dictionary)
   * @description Returns Zoho Inventory contacts (customers and vendors) for parameter dropdowns. Supports server-side name search and optional contact-type filter.
   *
   * @route POST /list-contacts-dictionary
   *
   * @paramDef {"type":"listContacts__payload","label":"Payload","name":"payload","description":"Organization + optional name search + cursor."}
   *
   * @sampleResult {"cursor":"2","items":[{"label":"Acme Corp","note":"customer","value":"460000000026049"}]}
   * @returns {DictionaryResponse}
   */
  async listContacts(payload) {
    const { search, cursor, criteria } = payload || {}
    const organizationId = criteria?.organizationId
    const contactType = criteria?.contactType

    const page = cursor ? parseInt(cursor, 10) : 1

    const response = await this.#apiRequest({
      logTag: 'listContacts',
      url: `${ this.#base() }/contacts`,
      organizationId,
      query: {
        page,
        per_page: DICTIONARY_PAGE_SIZE,
        contact_name_contains: search || undefined,
        contact_type: this.#resolveChoice(contactType, CONTACT_TYPE_MAP),
      },
    })

    const contacts = response?.contacts || []
    const hasMore = response?.page_context?.has_more_page === true

    return {
      cursor: hasMore ? String(page + 1) : null,
      items: contacts.map(contact => ({
        label: contact.contact_name || contact.company_name || '[Unnamed Contact]',
        note: contact.contact_type || `ID: ${ contact.contact_id }`,
        value: contact.contact_id,
      })),
    }
  }

  // Items

  /**
   * @typedef {Object} listItems__payloadCriteria
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   */

  /**
   * @typedef {Object} listItems__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional item name search; sent via name_contains."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (next page number)."}
   * @paramDef {"type":"listItems__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Organization."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName List Items (Dictionary)
   * @description Returns Zoho Inventory items for line-item pickers. The note field shows the SKU and rate so the right item is easy to identify.
   *
   * @route POST /list-items-dictionary
   *
   * @paramDef {"type":"listItems__payload","label":"Payload","name":"payload","description":"Organization + optional name search + cursor."}
   *
   * @sampleResult {"cursor":null,"items":[{"label":"Laptop 15\"","note":"SKU: SK-001 · Rate: 999","value":"460000000027111"}]}
   * @returns {DictionaryResponse}
   */
  async listItems(payload) {
    const { search, cursor, criteria } = payload || {}
    const organizationId = criteria?.organizationId

    const page = cursor ? parseInt(cursor, 10) : 1

    const response = await this.#apiRequest({
      logTag: 'listItems',
      url: `${ this.#base() }/items`,
      organizationId,
      query: {
        page,
        per_page: DICTIONARY_PAGE_SIZE,
        name_contains: search || undefined,
      },
    })

    const items = response?.items || []
    const hasMore = response?.page_context?.has_more_page === true

    return {
      cursor: hasMore ? String(page + 1) : null,
      items: items.map(item => ({
        label: item.name || '[Unnamed Item]',
        note: [item.sku ? `SKU: ${ item.sku }` : null, item.rate !== undefined ? `Rate: ${ item.rate }` : null].filter(Boolean).join(' · ') || `ID: ${ item.item_id }`,
        value: item.item_id,
      })),
    }
  }

  // Composite Items

  /**
   * @typedef {Object} listCompositeItems__payloadCriteria
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   */

  /**
   * @typedef {Object} listCompositeItems__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional name search; sent via name_contains."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor."}
   * @paramDef {"type":"listCompositeItems__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Organization."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName List Composite Items (Dictionary)
   * @description Returns composite items (kits/bundles) for assembly and unbuild pickers.
   *
   * @route POST /list-composite-items-dictionary
   *
   * @paramDef {"type":"listCompositeItems__payload","label":"Payload","name":"payload","description":"Organization + optional name search + cursor."}
   *
   * @sampleResult {"cursor":null,"items":[{"label":"Starter Kit","note":"Rate: 199","value":"460000000027222"}]}
   * @returns {DictionaryResponse}
   */
  async listCompositeItems(payload) {
    const { search, cursor, criteria } = payload || {}
    const organizationId = criteria?.organizationId

    const page = cursor ? parseInt(cursor, 10) : 1

    const response = await this.#apiRequest({
      logTag: 'listCompositeItems',
      url: `${ this.#base() }/compositeitems`,
      organizationId,
      query: {
        page,
        per_page: DICTIONARY_PAGE_SIZE,
        name_contains: search || undefined,
      },
    })

    const items = response?.composite_items || []
    const hasMore = response?.page_context?.has_more_page === true

    return {
      cursor: hasMore ? String(page + 1) : null,
      items: items.map(item => ({
        label: item.name || '[Unnamed Composite]',
        note: item.rate !== undefined ? `Rate: ${ item.rate }` : `ID: ${ item.composite_item_id }`,
        value: item.composite_item_id,
      })),
    }
  }

  // Item Groups

  /**
   * @typedef {Object} listItemGroups__payloadCriteria
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   */

  /**
   * @typedef {Object} listItemGroups__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional name search; sent via name_contains."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor."}
   * @paramDef {"type":"listItemGroups__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Organization."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName List Item Groups (Dictionary)
   * @description Returns item groups for picking parent groups when creating variants.
   *
   * @route POST /list-item-groups-dictionary
   *
   * @paramDef {"type":"listItemGroups__payload","label":"Payload","name":"payload","description":"Organization + optional name search + cursor."}
   *
   * @sampleResult {"cursor":null,"items":[{"label":"T-Shirts","note":"Brand: Acme","value":"460000000027333"}]}
   * @returns {DictionaryResponse}
   */
  async listItemGroups(payload) {
    const { search, cursor, criteria } = payload || {}
    const organizationId = criteria?.organizationId

    const page = cursor ? parseInt(cursor, 10) : 1

    const response = await this.#apiRequest({
      logTag: 'listItemGroups',
      url: `${ this.#base() }/itemgroups`,
      organizationId,
      query: {
        page,
        per_page: DICTIONARY_PAGE_SIZE,
        name_contains: search || undefined,
      },
    })

    const groups = response?.itemgroups || []
    const hasMore = response?.page_context?.has_more_page === true

    return {
      cursor: hasMore ? String(page + 1) : null,
      items: groups.map(group => ({
        label: group.group_name || group.name || '[Unnamed Group]',
        note: group.brand ? `Brand: ${ group.brand }` : `ID: ${ group.group_id }`,
        value: group.group_id,
      })),
    }
  }

  // Locations / Warehouses

  /**
   * @typedef {Object} listLocations__payloadCriteria
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   */

  /**
   * @typedef {Object} listLocations__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional location name search (filtered locally)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor."}
   * @paramDef {"type":"listLocations__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Organization."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName List Locations
   * @description Returns the warehouses/locations configured for the organization. Required when multi-location is enabled.
   *
   * @route POST /list-locations-dictionary
   *
   * @paramDef {"type":"listLocations__payload","label":"Payload","name":"payload","description":"Organization + optional name search."}
   *
   * @sampleResult {"cursor":null,"items":[{"label":"Main Warehouse","note":"primary","value":"460000000038080"}]}
   * @returns {DictionaryResponse}
   */
  async listLocations(payload) {
    const { search, criteria } = payload || {}
    const organizationId = criteria?.organizationId

    const response = await this.#apiRequest({
      logTag: 'listLocations',
      url: `${ this.#base() }/locations`,
      organizationId,
      query: { per_page: LIST_MAX_PER_PAGE },
    })

    let locations = response?.locations || []

    if (search) {
      locations = searchFilter(locations, ['location_name', 'location_id'], search)
    }

    return {
      cursor: null,
      items: locations.map(loc => ({
        label: loc.location_name || `Location ${ loc.location_id }`,
        note: loc.is_primary ? 'primary' : (loc.status || ''),
        value: loc.location_id,
      })),
    }
  }

  // Currencies

  /**
   * @typedef {Object} listCurrencies__payloadCriteria
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   */

  /**
   * @typedef {Object} listCurrencies__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional code/name search (filtered locally)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Unused; full list returned."}
   * @paramDef {"type":"listCurrencies__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Organization."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName List Currencies
   * @description Returns the currencies enabled for the organization, useful for multi-currency operations.
   *
   * @route POST /list-currencies-dictionary
   *
   * @paramDef {"type":"listCurrencies__payload","label":"Payload","name":"payload","description":"Organization + optional search."}
   *
   * @sampleResult {"cursor":null,"items":[{"label":"USD - U.S. Dollar","note":"Symbol: $","value":"460000000000097"}]}
   * @returns {DictionaryResponse}
   */
  async listCurrencies(payload) {
    const { search, criteria } = payload || {}
    const organizationId = criteria?.organizationId

    const response = await this.#apiRequest({
      logTag: 'listCurrencies',
      url: `${ this.#base() }/settings/currencies`,
      organizationId,
    })

    let currencies = response?.currencies || []

    if (search) {
      currencies = searchFilter(currencies, ['currency_code', 'currency_name'], search)
    }

    return {
      cursor: null,
      items: currencies.map(currency => ({
        label: `${ currency.currency_code } - ${ currency.currency_name || '' }`.trim(),
        note: currency.currency_symbol ? `Symbol: ${ currency.currency_symbol }` : '',
        value: currency.currency_id,
      })),
    }
  }

  // Taxes

  /**
   * @typedef {Object} listTaxes__payloadCriteria
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   */

  /**
   * @typedef {Object} listTaxes__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional tax-name search (local)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Unused."}
   * @paramDef {"type":"listTaxes__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Organization."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName List Taxes
   * @description Returns tax rates configured in the organization, used for line-item tax selection.
   *
   * @route POST /list-taxes-dictionary
   *
   * @paramDef {"type":"listTaxes__payload","label":"Payload","name":"payload","description":"Organization + optional search."}
   *
   * @sampleResult {"cursor":null,"items":[{"label":"GST 10%","note":"10%","value":"460000000037004"}]}
   * @returns {DictionaryResponse}
   */
  async listTaxes(payload) {
    const { search, criteria } = payload || {}
    const organizationId = criteria?.organizationId

    const response = await this.#apiRequest({
      logTag: 'listTaxes',
      url: `${ this.#base() }/settings/taxes`,
      organizationId,
    })

    let taxes = response?.taxes || []

    if (search) {
      taxes = searchFilter(taxes, ['tax_name'], search)
    }

    return {
      cursor: null,
      items: taxes.map(tax => ({
        label: tax.tax_name || `Tax ${ tax.tax_id }`,
        note: tax.tax_percentage !== undefined ? `${ tax.tax_percentage }%` : '',
        value: tax.tax_id,
      })),
    }
  }

  // Sales Orders / Purchase Orders / Invoices / Bills (pickers)

  /**
   * @typedef {Object} listSalesOrdersDict__payloadCriteria
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Draft","Open","Invoiced","Partially Invoiced","Void","Overdue","On Hold","Confirmed","Closed"]}},"description":"Optional status filter."}
   */

  /**
   * @typedef {Object} listSalesOrdersDict__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional SO number search; sent via salesorder_number_contains."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor."}
   * @paramDef {"type":"listSalesOrdersDict__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Organization + optional status."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName List Sales Orders (Dictionary)
   * @description Returns sales orders for picking an existing SO when creating packages, returns, or invoices.
   *
   * @route POST /list-sales-orders-dictionary
   *
   * @paramDef {"type":"listSalesOrdersDict__payload","label":"Payload","name":"payload","description":"Organization + status filter + search + cursor."}
   *
   * @sampleResult {"cursor":"2","items":[{"label":"SO-00003 - Acme Corp","note":"Status: confirmed","value":"460000000034037"}]}
   * @returns {DictionaryResponse}
   */
  async listSalesOrdersDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const organizationId = criteria?.organizationId
    const status = criteria?.status

    const page = cursor ? parseInt(cursor, 10) : 1

    const response = await this.#apiRequest({
      logTag: 'listSalesOrdersDictionary',
      url: `${ this.#base() }/salesorders`,
      organizationId,
      query: {
        page,
        per_page: DICTIONARY_PAGE_SIZE,
        salesorder_number_contains: search || undefined,
        status: this.#resolveChoice(status, SALES_ORDER_STATUS_MAP),
      },
    })

    const orders = response?.salesorders || []
    const hasMore = response?.page_context?.has_more_page === true

    return {
      cursor: hasMore ? String(page + 1) : null,
      items: orders.map(o => ({
        label: `${ o.salesorder_number || o.salesorder_id } - ${ o.customer_name || '' }`.trim(),
        note: `Status: ${ o.status || 'unknown' }`,
        value: o.salesorder_id,
      })),
    }
  }

  /**
   * @typedef {Object} listPurchaseOrdersDict__payloadCriteria
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Draft","Open","Billed","Partially Billed","Cancelled","Closed"]}},"description":"Optional status filter."}
   */

  /**
   * @typedef {Object} listPurchaseOrdersDict__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional PO number search; sent via purchaseorder_number_contains."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor."}
   * @paramDef {"type":"listPurchaseOrdersDict__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Organization + optional status."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName List Purchase Orders (Dictionary)
   * @description Returns purchase orders for picking an existing PO when creating receives or bills.
   *
   * @route POST /list-purchase-orders-dictionary
   *
   * @paramDef {"type":"listPurchaseOrdersDict__payload","label":"Payload","name":"payload","description":"Organization + status filter + search + cursor."}
   *
   * @sampleResult {"cursor":null,"items":[{"label":"PO-007 - Office Depot","note":"Status: open","value":"460000000038099"}]}
   * @returns {DictionaryResponse}
   */
  async listPurchaseOrdersDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const organizationId = criteria?.organizationId
    const status = criteria?.status

    const page = cursor ? parseInt(cursor, 10) : 1

    const response = await this.#apiRequest({
      logTag: 'listPurchaseOrdersDictionary',
      url: `${ this.#base() }/purchaseorders`,
      organizationId,
      query: {
        page,
        per_page: DICTIONARY_PAGE_SIZE,
        purchaseorder_number_contains: search || undefined,
        status: this.#resolveChoice(status, PURCHASE_ORDER_STATUS_MAP),
      },
    })

    const orders = response?.purchaseorders || []
    const hasMore = response?.page_context?.has_more_page === true

    return {
      cursor: hasMore ? String(page + 1) : null,
      items: orders.map(o => ({
        label: `${ o.purchaseorder_number || o.purchaseorder_id } - ${ o.vendor_name || '' }`.trim(),
        note: `Status: ${ o.status || 'unknown' }`,
        value: o.purchaseorder_id,
      })),
    }
  }

  /**
   * @typedef {Object} listInvoicesDict__payloadCriteria
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Draft","Sent","Overdue","Paid","Void","Unpaid","Partially Paid","Viewed"]}},"description":"Optional status filter."}
   */

  /**
   * @typedef {Object} listInvoicesDict__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional invoice number search."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor."}
   * @paramDef {"type":"listInvoicesDict__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Organization + optional status."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName List Invoices (Dictionary)
   * @description Returns invoices for picking when recording payments, voiding, or referencing.
   *
   * @route POST /list-invoices-dictionary
   *
   * @paramDef {"type":"listInvoicesDict__payload","label":"Payload","name":"payload","description":"Organization + status filter + search + cursor."}
   *
   * @sampleResult {"cursor":"2","items":[{"label":"INV-000123 - Acme Corp","note":"Status: sent","value":"460000000034037"}]}
   * @returns {DictionaryResponse}
   */
  async listInvoicesDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const organizationId = criteria?.organizationId
    const status = criteria?.status

    const page = cursor ? parseInt(cursor, 10) : 1

    const response = await this.#apiRequest({
      logTag: 'listInvoicesDictionary',
      url: `${ this.#base() }/invoices`,
      organizationId,
      query: {
        page,
        per_page: DICTIONARY_PAGE_SIZE,
        invoice_number_contains: search || undefined,
        status: this.#resolveChoice(status, INVOICE_STATUS_MAP),
      },
    })

    const invoices = response?.invoices || []
    const hasMore = response?.page_context?.has_more_page === true

    return {
      cursor: hasMore ? String(page + 1) : null,
      items: invoices.map(inv => ({
        label: `${ inv.invoice_number || inv.invoice_id } - ${ inv.customer_name || '' }`.trim(),
        note: `Status: ${ inv.status || 'unknown' }`,
        value: inv.invoice_id,
      })),
    }
  }

  /**
   * @typedef {Object} listBillsDict__payloadCriteria
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Open","Paid","Void","Draft","Overdue","Unpaid","Partially Paid"]}},"description":"Optional status filter."}
   */

  /**
   * @typedef {Object} listBillsDict__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional bill number search."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor."}
   * @paramDef {"type":"listBillsDict__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Organization + optional status."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName List Bills (Dictionary)
   * @description Returns vendor bills for picking when recording vendor payments, voiding, or referencing.
   *
   * @route POST /list-bills-dictionary
   *
   * @paramDef {"type":"listBillsDict__payload","label":"Payload","name":"payload","description":"Organization + status filter + search + cursor."}
   *
   * @sampleResult {"cursor":null,"items":[{"label":"BILL-007 - Office Depot","note":"Status: open","value":"460000000038099"}]}
   * @returns {DictionaryResponse}
   */
  async listBillsDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const organizationId = criteria?.organizationId
    const status = criteria?.status

    const page = cursor ? parseInt(cursor, 10) : 1

    const response = await this.#apiRequest({
      logTag: 'listBillsDictionary',
      url: `${ this.#base() }/bills`,
      organizationId,
      query: {
        page,
        per_page: DICTIONARY_PAGE_SIZE,
        bill_number_contains: search || undefined,
        status: this.#resolveChoice(status, BILL_STATUS_MAP),
      },
    })

    const bills = response?.bills || []
    const hasMore = response?.page_context?.has_more_page === true

    return {
      cursor: hasMore ? String(page + 1) : null,
      items: bills.map(bill => ({
        label: `${ bill.bill_number || bill.bill_id } - ${ bill.vendor_name || '' }`.trim(),
        note: `Status: ${ bill.status || 'unknown' }`,
        value: bill.bill_id,
      })),
    }
  }

  /**
   * @typedef {Object} listPackagesDict__payloadCriteria
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   */

  /**
   * @typedef {Object} listPackagesDict__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional package number search."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor."}
   * @paramDef {"type":"listPackagesDict__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Organization."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName List Packages (Dictionary)
   * @description Returns packages for picking when creating shipment orders.
   *
   * @route POST /list-packages-dictionary
   *
   * @paramDef {"type":"listPackagesDict__payload","label":"Payload","name":"payload","description":"Organization + optional search + cursor."}
   *
   * @sampleResult {"cursor":null,"items":[{"label":"PA-00001","note":"Status: NotShipped","value":"460000000040001"}]}
   * @returns {DictionaryResponse}
   */
  async listPackagesDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const organizationId = criteria?.organizationId

    const page = cursor ? parseInt(cursor, 10) : 1

    const response = await this.#apiRequest({
      logTag: 'listPackagesDictionary',
      url: `${ this.#base() }/packages`,
      organizationId,
      query: {
        page,
        per_page: DICTIONARY_PAGE_SIZE,
        package_number_contains: search || undefined,
      },
    })

    const packages = response?.packages || []
    const hasMore = response?.page_context?.has_more_page === true

    return {
      cursor: hasMore ? String(page + 1) : null,
      items: packages.map(p => ({
        label: p.package_number || `Package ${ p.package_id }`,
        note: `Status: ${ p.status || 'unknown' }`,
        value: p.package_id,
      })),
    }
  }

  // Generic picker dictionary: organization (criteria) + page cursor + local search. Sends only
  // safe query params (page, per_page, organization_id) so it works across every transaction list.
  async #simpleDictionary(payload, { logTag, urlPath, listKey, idField, numberField, nameField, searchFields, extraQuery }) {
    const { search, cursor, criteria } = payload || {}
    const organizationId = criteria?.organizationId
    const page = cursor ? parseInt(cursor, 10) : 1

    const response = await this.#apiRequest({
      logTag,
      url: `${ this.#base() }/${ urlPath }`,
      organizationId,
      query: cleanupObject({ page, per_page: DICTIONARY_PAGE_SIZE, ...(extraQuery || {}) }),
    })

    let records = response?.[listKey] || []

    if (search) {
      records = searchFilter(records, searchFields, search)
    }

    const hasMore = response?.page_context?.has_more_page === true

    return {
      cursor: hasMore ? String(page + 1) : null,
      items: records.map(r => ({
        label: [r[numberField], nameField ? r[nameField] : null].filter(Boolean).join(' - ') || `${ r[idField] }`,
        note: r.status ? `Status: ${ r.status }` : (r.date ? `Date: ${ r.date }` : ''),
        value: r[idField],
      })),
    }
  }

  // Sales Returns (picker)

  /**
   * @typedef {Object} listSalesReturnsDict__payloadCriteria
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   */

  /**
   * @typedef {Object} listSalesReturnsDict__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional return-number / customer filter (matches within the loaded page)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (next page number)."}
   * @paramDef {"type":"listSalesReturnsDict__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Organization."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName List Sales Returns (Dictionary)
   * @description Returns sales returns for picking an existing return when receiving returned goods, updating, or referencing one.
   *
   * @route POST /list-sales-returns-dictionary
   *
   * @paramDef {"type":"listSalesReturnsDict__payload","label":"Payload","name":"payload","description":"Organization + optional search + cursor."}
   *
   * @sampleResult {"cursor":null,"items":[{"label":"SR-00001 - Acme Corp","note":"Status: open","value":"460000000060001"}]}
   * @returns {DictionaryResponse}
   */
  async listSalesReturnsDictionary(payload) {
    return this.#simpleDictionary(payload, {
      logTag: 'listSalesReturnsDictionary',
      urlPath: 'salesreturns',
      listKey: 'salesreturns',
      idField: 'salesreturn_id',
      numberField: 'salesreturn_number',
      nameField: 'customer_name',
      searchFields: ['salesreturn_number', 'customer_name'],
    })
  }

  // Credit Notes (picker)

  /**
   * @typedef {Object} listCreditNotesDict__payloadCriteria
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   */

  /**
   * @typedef {Object} listCreditNotesDict__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional credit-note-number / customer filter (matches within the loaded page)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (next page number)."}
   * @paramDef {"type":"listCreditNotesDict__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Organization."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName List Credit Notes (Dictionary)
   * @description Returns credit notes for picking an existing credit note when applying it to invoices, updating, or referencing one.
   *
   * @route POST /list-credit-notes-dictionary
   *
   * @paramDef {"type":"listCreditNotesDict__payload","label":"Payload","name":"payload","description":"Organization + optional search + cursor."}
   *
   * @sampleResult {"cursor":null,"items":[{"label":"CN-001 - Acme Corp","note":"Status: open","value":"460000000070033"}]}
   * @returns {DictionaryResponse}
   */
  async listCreditNotesDictionary(payload) {
    return this.#simpleDictionary(payload, {
      logTag: 'listCreditNotesDictionary',
      urlPath: 'creditnotes',
      listKey: 'creditnotes',
      idField: 'creditnote_id',
      numberField: 'creditnote_number',
      nameField: 'customer_name',
      searchFields: ['creditnote_number', 'customer_name'],
    })
  }

  // Customer Payments (picker)

  /**
   * @typedef {Object} listCustomerPaymentsDict__payloadCriteria
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   */

  /**
   * @typedef {Object} listCustomerPaymentsDict__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional payment-number / customer filter (matches within the loaded page)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (next page number)."}
   * @paramDef {"type":"listCustomerPaymentsDict__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Organization."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName List Customer Payments (Dictionary)
   * @description Returns recorded customer payments for picking an existing payment to update or delete.
   *
   * @route POST /list-customer-payments-dictionary
   *
   * @paramDef {"type":"listCustomerPaymentsDict__payload","label":"Payload","name":"payload","description":"Organization + optional search + cursor."}
   *
   * @sampleResult {"cursor":null,"items":[{"label":"2 - Acme Corp","note":"Date: 2026-05-08","value":"460000000048011"}]}
   * @returns {DictionaryResponse}
   */
  async listCustomerPaymentsDictionary(payload) {
    return this.#simpleDictionary(payload, {
      logTag: 'listCustomerPaymentsDictionary',
      urlPath: 'customerpayments',
      listKey: 'customerpayments',
      idField: 'payment_id',
      numberField: 'payment_number',
      nameField: 'customer_name',
      searchFields: ['payment_number', 'customer_name', 'reference_number'],
    })
  }

  // Vendor Payments (picker)

  /**
   * @typedef {Object} listVendorPaymentsDict__payloadCriteria
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   */

  /**
   * @typedef {Object} listVendorPaymentsDict__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional payment-number / vendor filter (matches within the loaded page)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (next page number)."}
   * @paramDef {"type":"listVendorPaymentsDict__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Organization."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName List Vendor Payments (Dictionary)
   * @description Returns recorded vendor payments for picking an existing payment to delete or reference.
   *
   * @route POST /list-vendor-payments-dictionary
   *
   * @paramDef {"type":"listVendorPaymentsDict__payload","label":"Payload","name":"payload","description":"Organization + optional search + cursor."}
   *
   * @sampleResult {"cursor":null,"items":[{"label":"5 - Office Depot","note":"Date: 2026-05-08","value":"460000000049011"}]}
   * @returns {DictionaryResponse}
   */
  async listVendorPaymentsDictionary(payload) {
    return this.#simpleDictionary(payload, {
      logTag: 'listVendorPaymentsDictionary',
      urlPath: 'vendorpayments',
      listKey: 'vendorpayments',
      idField: 'payment_id',
      numberField: 'payment_number',
      nameField: 'vendor_name',
      searchFields: ['payment_number', 'vendor_name', 'reference_number'],
    })
  }

  // Vendor Credits (picker)

  /**
   * @typedef {Object} listVendorCreditsDict__payloadCriteria
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   */

  /**
   * @typedef {Object} listVendorCreditsDict__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional credit-number / vendor filter (matches within the loaded page)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (next page number)."}
   * @paramDef {"type":"listVendorCreditsDict__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Organization."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName List Vendor Credits (Dictionary)
   * @description Returns vendor credits for picking an existing credit when applying it to bills, deleting, or referencing one.
   *
   * @route POST /list-vendor-credits-dictionary
   *
   * @paramDef {"type":"listVendorCreditsDict__payload","label":"Payload","name":"payload","description":"Organization + optional search + cursor."}
   *
   * @sampleResult {"cursor":null,"items":[{"label":"VC-001 - Office Depot","note":"Status: open","value":"460000000071001"}]}
   * @returns {DictionaryResponse}
   */
  async listVendorCreditsDictionary(payload) {
    return this.#simpleDictionary(payload, {
      logTag: 'listVendorCreditsDictionary',
      urlPath: 'vendorcredits',
      listKey: 'vendorcredits',
      idField: 'vendor_credit_id',
      numberField: 'vendor_credit_number',
      nameField: 'vendor_name',
      searchFields: ['vendor_credit_number', 'vendor_name'],
    })
  }

  // Transfer Orders (picker)

  /**
   * @typedef {Object} listTransferOrdersDict__payloadCriteria
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   */

  /**
   * @typedef {Object} listTransferOrdersDict__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional transfer-order-number filter (matches within the loaded page)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (next page number)."}
   * @paramDef {"type":"listTransferOrdersDict__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Organization."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName List Transfer Orders (Dictionary)
   * @description Returns transfer orders for picking an existing transfer when marking it received, deleting, or referencing one.
   *
   * @route POST /list-transfer-orders-dictionary
   *
   * @paramDef {"type":"listTransferOrdersDict__payload","label":"Payload","name":"payload","description":"Organization + optional search + cursor."}
   *
   * @sampleResult {"cursor":null,"items":[{"label":"TO-00001","note":"Date: 2026-05-10","value":"460000000080001"}]}
   * @returns {DictionaryResponse}
   */
  async listTransferOrdersDictionary(payload) {
    return this.#simpleDictionary(payload, {
      logTag: 'listTransferOrdersDictionary',
      urlPath: 'transferorders',
      listKey: 'transfer_orders',
      idField: 'transfer_order_id',
      numberField: 'transfer_order_number',
      nameField: null,
      searchFields: ['transfer_order_number'],
    })
  }

  // Inventory Adjustments (picker)

  /**
   * @typedef {Object} listInventoryAdjustmentsDict__payloadCriteria
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   */

  /**
   * @typedef {Object} listInventoryAdjustmentsDict__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional reason / reference filter (matches within the loaded page)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (next page number)."}
   * @paramDef {"type":"listInventoryAdjustmentsDict__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Organization."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName List Inventory Adjustments (Dictionary)
   * @description Returns inventory adjustments for picking an existing adjustment to view or delete.
   *
   * @route POST /list-inventory-adjustments-dictionary
   *
   * @paramDef {"type":"listInventoryAdjustmentsDict__payload","label":"Payload","name":"payload","description":"Organization + optional search + cursor."}
   *
   * @sampleResult {"cursor":null,"items":[{"label":"REF-01 - Cycle count","note":"Date: 2026-05-08","value":"460000000050001"}]}
   * @returns {DictionaryResponse}
   */
  async listInventoryAdjustmentsDictionary(payload) {
    return this.#simpleDictionary(payload, {
      logTag: 'listInventoryAdjustmentsDictionary',
      urlPath: 'inventoryadjustments',
      listKey: 'inventory_adjustments',
      idField: 'inventory_adjustment_id',
      numberField: 'reference_number',
      nameField: 'reason',
      searchFields: ['reference_number', 'reason'],
    })
  }
  // CONTACTS - ACTIONS

  /**
   * @typedef {Object} ZohoAddress
   * @property {String} [attention] - Recipient name
   * @property {String} [address] - Street line 1
   * @property {String} [street2] - Street line 2
   * @property {String} [city] - City
   * @property {String} [state] - State / province
   * @property {String} [zip] - Postal code
   * @property {String} [country] - Country
   * @property {String} [phone] - Phone number
   */

  /**
   * @operationName Create Contact
   * @category Contacts
   * @description Creates a new customer or vendor contact. Supports primary contact details, billing address, shipping address, and contact persons.
   *
   * @route POST /create-contact
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Contact Name","name":"contactName","required":true,"description":"Display name (person or business)."}
   * @paramDef {"type":"String","label":"Company Name","name":"companyName","description":"Optional company name."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Primary email address."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"Primary phone number."}
   * @paramDef {"type":"String","label":"Contact Type","name":"contactType","uiComponent":{"type":"DROPDOWN","options":{"values":["Customer","Vendor"]}},"description":"customer or vendor (default customer)."}
   * @paramDef {"type":"String","label":"Currency","name":"currencyId","dictionary":"listCurrencies","dependsOn":["organizationId"],"description":"Optional currency for the contact."}
   * @paramDef {"type":"ZohoAddress","label":"Billing Address","name":"billingAddress","description":"Optional billing address object."}
   * @paramDef {"type":"ZohoAddress","label":"Shipping Address","name":"shippingAddress","description":"Optional shipping address object."}
   * @paramDef {"type":"Object","label":"Extra Fields","name":"extraFields","freeform":true,"description":"Optional additional fields merged into the body (gst_treatment, tax_id, payment_terms, etc.)."}
   *
   * @returns {Object}
   * @sampleResult {"contact_id":"460000000026049","contact_name":"Acme Corp","contact_type":"customer","status":"active"}
   */
  async createContact(organizationId, contactName, companyName, email, phone, contactType, currencyId, billingAddress, shippingAddress, extraFields) {
    if (!contactName) {
      throw new Error('"Contact Name" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const body = cleanupObject({
      contact_name: contactName,
      company_name: companyName,
      contact_type: this.#resolveChoice(contactType, CONTACT_TYPE_MAP) || 'customer',
      currency_id: currencyId,
      contact_persons: email || phone ? [cleanupObject({ email, phone, is_primary_contact: true })] : undefined,
      billing_address: cleanupObject(billingAddress),
      shipping_address: cleanupObject(shippingAddress),
      ...(extraFields && typeof extraFields === 'object' ? extraFields : {}),
    })

    const response = await this.#apiRequest({
      logTag: 'createContact',
      method: 'post',
      url: `${ this.#base() }/contacts`,
      organizationId: orgId,
      body,
    })

    return response?.contact
  }

  /**
   * @operationName Get Contact
   * @category Contacts
   * @description Retrieves full details of a contact, including contact persons, addresses, and outstanding balances.
   *
   * @route POST /get-contact
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 60
   *
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Contact","name":"contactId","required":true,"dictionary":"listContacts","dependsOn":["organizationId"],"description":"Contact to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"contact_id":"460000000026049","contact_name":"Acme Corp","contact_type":"customer","status":"active","outstanding_receivable_amount":1250}
   */
  async getContact(organizationId, contactId) {
    if (!contactId) {
      throw new Error('"Contact" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const response = await this.#apiRequest({
      logTag: 'getContact',
      url: `${ this.#base() }/contacts/${ contactId }`,
      organizationId: orgId,
    })

    return response?.contact
  }

  /**
   * @operationName Update Contact
   * @category Contacts
   * @description Updates an existing contact by merging supplied fields into the saved record. Use to change a subset of fields (e.g. adjust price, swap email) without re-sending the full payload.
   *
   * @route POST /update-contact
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Contact","name":"contactId","required":true,"dictionary":"listContacts","dependsOn":["organizationId"],"description":"Contact to update."}
   * @paramDef {"type":"Object","label":"Fields","name":"fields","required":true,"freeform":true,"description":"Object of contact fields to update (contact_name, company_name, billing_address, etc.)."}
   *
   * @returns {Object}
   * @sampleResult {"contact_id":"460000000026049","contact_name":"Acme Corp Updated","status":"active"}
   */
  async updateContact(organizationId, contactId, fields) {
    if (!contactId) {
      throw new Error('"Contact" is required')
    }

    if (!fields || typeof fields !== 'object' || Object.keys(fields).length === 0) {
      throw new Error('"Fields" must be a non-empty object of contact fields to update')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const response = await this.#apiRequest({
      logTag: 'updateContact',
      method: 'put',
      url: `${ this.#base() }/contacts/${ contactId }`,
      organizationId: orgId,
      body: cleanupObject(fields),
    })

    return response?.contact
  }

  /**
   * @operationName Delete Contact
   * @category Contacts
   * @description Permanently deletes a contact. Use when removing a test record; for production records prefer mark-inactive so historical references stay valid. Contacts with linked transactions cannot be deleted.
   *
   * @route POST /delete-contact
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 60
   *
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Contact","name":"contactId","required":true,"dictionary":"listContacts","dependsOn":["organizationId"],"description":"Contact to delete."}
   *
   * @returns {Object}
   * @sampleResult {"code":0,"message":"The contact has been deleted."}
   */
  async deleteContact(organizationId, contactId) {
    if (!contactId) {
      throw new Error('"Contact" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    return this.#apiRequest({
      logTag: 'deleteContact',
      method: 'delete',
      url: `${ this.#base() }/contacts/${ contactId }`,
      organizationId: orgId,
    })
  }

  /**
   * @operationName Mark Contact Active
   * @category Contacts
   * @description Re-activates a contact previously marked inactive so it returns to pickers and reports. Use when restoring a customer or vendor relationship.
   * @route POST /mark-contact-active
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Contact","name":"contactId","required":true,"dictionary":"listContacts","dependsOn":["organizationId"],"description":"Contact to mark active."}
   * @returns {Object}
   * @sampleResult {"code":0,"message":"The contact has been marked as active."}
   */
  async markContactActive(organizationId, contactId) {
    if (!contactId) {
      throw new Error('"Contact" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    return this.#apiRequest({
      logTag: 'markContactActive',
      method: 'post',
      url: `${ this.#base() }/contacts/${ contactId }/active`,
      organizationId: orgId,
    })
  }

  /**
   * @operationName Mark Contact Inactive
   * @category Contacts
   * @description Marks a contact inactive so it stops appearing in pickers but historical transactions stay intact. Preferred over delete for retiring a customer or vendor.
   * @route POST /mark-contact-inactive
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Contact","name":"contactId","required":true,"dictionary":"listContacts","dependsOn":["organizationId"],"description":"Contact to mark inactive."}
   * @returns {Object}
   * @sampleResult {"code":0,"message":"The contact has been marked as inactive."}
   */
  async markContactInactive(organizationId, contactId) {
    if (!contactId) {
      throw new Error('"Contact" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    return this.#apiRequest({
      logTag: 'markContactInactive',
      method: 'post',
      url: `${ this.#base() }/contacts/${ contactId }/inactive`,
      organizationId: orgId,
    })
  }

  /**
   * @operationName List Contacts
   * @category Contacts
   * @description Lists contacts in the organization with optional filtering by type, status, and name.
   *
   * @route POST /list-contacts
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 60
   *
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Contact Type","name":"contactType","uiComponent":{"type":"DROPDOWN","options":{"values":["Customer","Vendor"]}},"description":"Optional filter to limit by type."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Active","Inactive"]}},"description":"Optional status filter."}
   * @paramDef {"type":"String","label":"Name Contains","name":"nameContains","description":"Optional partial name match (server-side)."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number (default 1)."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page size 1-200 (default 50)."}
   * @paramDef {"type":"Boolean","label":"Fetch All","name":"fetchAll","uiComponent":{"type":"TOGGLE"},"description":"If true, auto-paginate up to 50 pages and return a flat array."}
   *
   * @returns {Object}
   * @sampleResult {"contacts":[{"contact_id":"460000000026049","contact_name":"Acme Corp"}],"page_context":{"page":1,"per_page":50,"has_more_page":false}}
   */
  async listContactsAction(organizationId, contactType, status, nameContains, page, perPage, fetchAll) {
    const orgId = this.#resolveOrganizationId(organizationId)

    return this.#listEntities({
      logTag: 'listContactsAction',
      url: `${ this.#base() }/contacts`,
      orgId,
      listKey: 'contacts',
      page,
      perPage,
      fetchAll,
      extraQuery: {
        contact_type: this.#resolveChoice(contactType, CONTACT_TYPE_MAP),
        // Zoho's contacts list filters status via filter_by (Status.Active / Status.Inactive),
        // not a plain `status` param.
        filter_by: this.#resolveChoice(status, CONTACT_FILTER_BY_MAP),
        contact_name_contains: nameContains || undefined,
      },
    })
  }

  // Generic list helper used by all `list*` actions.
  async #listEntities({ logTag, url, orgId, listKey, page, perPage, fetchAll, extraQuery }) {
    const baseQuery = cleanupObject({
      per_page: Math.max(1, Math.min(LIST_MAX_PER_PAGE, Number(perPage) || DEFAULT_PAGE_SIZE)),
      ...(extraQuery || {}),
    })

    if (!fetchAll) {
      const response = await this.#apiRequest({
        logTag,
        url,
        organizationId: orgId,
        query: { page: Number(page) || 1, ...baseQuery },
      })

      return response
    }

    const aggregated = []
    let p = 1
    let lastPageContext = null

    while (p <= POLLING_MAX_PAGES) {
      const response = await this.#apiRequest({
        logTag: `${ logTag }.page${ p }`,
        url,
        organizationId: orgId,
        query: { page: p, ...baseQuery },
      })

      const records = response?.[listKey] || []
      aggregated.push(...records)
      lastPageContext = response?.page_context || lastPageContext

      if (response?.page_context?.has_more_page !== true) {
        break
      }

      p++
    }

    // If we stopped because of the page cap (not because Zoho ran out of pages), the result is
    // truncated — surface that instead of falsely reporting has_more_page:false ("complete").
    const truncated = lastPageContext?.has_more_page === true

    return { [listKey]: aggregated, page_context: { ...(lastPageContext || {}), has_more_page: truncated, total_pages: p }, truncated }
  }

  // ITEMS - ACTIONS

  /**
   * @typedef {Object} ZohoItemLocation
   * @property {String} location_id
   * @property {Number} [initial_stock] - Initial stock when creating an item with multi-location enabled
   * @property {Number} [initial_stock_rate]
   */

  /**
   * @operationName Create Item
   * @category Items
   * @description Creates a new inventory, service, or sales item. Inventory items track stock levels; service items don't.
   *
   * @route POST /create-item
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Item display name."}
   * @paramDef {"type":"String","label":"SKU","name":"sku","description":"Unique SKU code."}
   * @paramDef {"type":"String","label":"Item Type","name":"itemType","uiComponent":{"type":"DROPDOWN","options":{"values":["Inventory","Sales","Purchases","Sales and Purchases"]}},"description":"Item type. Defaults to inventory. For a service (non-stock) item set Product Type to \"Service\" rather than choosing it here."}
   * @paramDef {"type":"String","label":"Product Type","name":"productType","uiComponent":{"type":"DROPDOWN","options":{"values":["Goods","Service"]}},"description":"goods or service. Defaults to goods."}
   * @paramDef {"type":"String","label":"Unit","name":"unit","description":"Unit of measure (free text, e.g. qty, kg, hr)."}
   * @paramDef {"type":"Number","label":"Sales Rate","name":"rate","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Sales price per unit."}
   * @paramDef {"type":"Number","label":"Purchase Rate","name":"purchaseRate","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Purchase cost per unit."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Item description shown on transactions."}
   * @paramDef {"type":"Boolean","label":"Taxable","name":"isTaxable","uiComponent":{"type":"TOGGLE"},"description":"Whether the item is taxable."}
   * @paramDef {"type":"String","label":"Tax","name":"taxId","dictionary":"listTaxes","dependsOn":["organizationId"],"description":"Optional default tax."}
   * @paramDef {"type":"Number","label":"Reorder Level","name":"reorderLevel","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Stock level threshold at which the item is flagged for reorder."}
   * @paramDef {"type":"Number","label":"Initial Stock","name":"initialStock","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Opening stock quantity (single-location)."}
   * @paramDef {"type":"Number","label":"Initial Stock Rate","name":"initialStockRate","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Per-unit value of opening stock."}
   * @paramDef {"type":"Array<ZohoItemLocation>","label":"Per-Location Stock","name":"locations","description":"Array of {location_id, initial_stock, initial_stock_rate} for multi-location orgs."}
   * @paramDef {"type":"Object","label":"Extra Fields","name":"extraFields","freeform":true,"description":"Additional fields merged into the body (vendor_id, brand, manufacturer, hsn_or_sac, custom_fields, etc.)."}
   *
   * @returns {Object}
   * @sampleResult {"item_id":"460000000027111","name":"Laptop 15\"","sku":"SK-001","rate":999,"item_type":"inventory","status":"active"}
   */
  async createItem(organizationId, name, sku, itemType, productType, unit, rate, purchaseRate, description, isTaxable, taxId, reorderLevel, initialStock, initialStockRate, locations, extraFields) {
    if (!name) {
      throw new Error('"Name" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const body = cleanupObject({
      name,
      sku,
      item_type: this.#resolveChoice(itemType, ITEM_TYPE_MAP) || 'inventory',
      product_type: this.#resolveChoice(productType, PRODUCT_TYPE_MAP) || 'goods',
      unit,
      rate: rate !== undefined && rate !== null && rate !== '' ? Number(rate) : undefined,
      purchase_rate: purchaseRate !== undefined && purchaseRate !== null && purchaseRate !== '' ? Number(purchaseRate) : undefined,
      description,
      is_taxable: typeof isTaxable === 'boolean' ? isTaxable : undefined,
      tax_id: taxId,
      reorder_level: reorderLevel !== undefined && reorderLevel !== null && reorderLevel !== '' ? Number(reorderLevel) : undefined,
      initial_stock: initialStock !== undefined && initialStock !== null && initialStock !== '' ? Number(initialStock) : undefined,
      initial_stock_rate: initialStockRate !== undefined && initialStockRate !== null && initialStockRate !== '' ? Number(initialStockRate) : undefined,
      locations: Array.isArray(locations) && locations.length > 0 ? locations.map(l => cleanupObject(l)) : undefined,
      ...(extraFields && typeof extraFields === 'object' ? extraFields : {}),
    })

    const response = await this.#apiRequest({
      logTag: 'createItem',
      method: 'post',
      url: `${ this.#base() }/items`,
      organizationId: orgId,
      body,
    })

    return response?.item
  }

  /**
   * @operationName Get Item
   * @category Items
   * @description Retrieves an item with full detail: stock-on-hand and available-stock per location, pricing tiers, and custom fields. Use after listing or a trigger event to inspect a single item.
   * @route POST /get-item
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Item","name":"itemId","required":true,"dictionary":"listItems","dependsOn":["organizationId"],"description":"Item to retrieve."}
   * @returns {Object}
   * @sampleResult {"item_id":"460000000027111","name":"Laptop 15\"","stock_on_hand":12,"available_stock":10,"reorder_level":5}
   */
  async getItem(organizationId, itemId) {
    if (!itemId) {
      throw new Error('"Item" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const response = await this.#apiRequest({
      logTag: 'getItem',
      url: `${ this.#base() }/items/${ itemId }`,
      organizationId: orgId,
    })

    return response?.item
  }

  /**
   * @operationName Update Item
   * @category Items
   * @description Updates an existing item by merging supplied fields into the record. Use to change a subset (price, reorder level, description) without re-sending every field.
   * @route POST /update-item
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Item","name":"itemId","required":true,"dictionary":"listItems","dependsOn":["organizationId"],"description":"Item to update."}
   * @paramDef {"type":"Object","label":"Fields","name":"fields","required":true,"freeform":true,"description":"Object of item fields to update. Example: {\"name\":\"New Name\",\"rate\":120,\"reorder_level\":10}."}
   * @returns {Object}
   * @sampleResult {"item_id":"460000000027111","name":"Laptop 15\" updated","rate":1099}
   */
  async updateItem(organizationId, itemId, fields) {
    if (!itemId) {
      throw new Error('"Item" is required')
    }

    if (!fields || typeof fields !== 'object' || Object.keys(fields).length === 0) {
      throw new Error('"Fields" must be a non-empty object')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const response = await this.#apiRequest({
      logTag: 'updateItem',
      method: 'put',
      url: `${ this.#base() }/items/${ itemId }`,
      organizationId: orgId,
      body: cleanupObject(fields),
    })

    return response?.item
  }

  /**
   * @operationName Delete Item
   * @category Items
   * @description Permanently deletes an item. Use for cleanup; for production items prefer mark-inactive so historical line items remain valid. Items tied to transactions cannot be deleted.
   * @route POST /delete-item
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Item","name":"itemId","required":true,"dictionary":"listItems","dependsOn":["organizationId"],"description":"Item to delete."}
   * @returns {Object}
   * @sampleResult {"code":0,"message":"The item has been deleted."}
   */
  async deleteItem(organizationId, itemId) {
    if (!itemId) {
      throw new Error('"Item" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    return this.#apiRequest({
      logTag: 'deleteItem',
      method: 'delete',
      url: `${ this.#base() }/items/${ itemId }`,
      organizationId: orgId,
    })
  }

  /**
   * @operationName Mark Item Active
   * @category Items
   * @description Re-activates an item previously marked inactive so it returns to pickers and can be added to new transactions. Use when bringing a discontinued SKU back into rotation.
   * @route POST /mark-item-active
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Item","name":"itemId","required":true,"dictionary":"listItems","dependsOn":["organizationId"],"description":"Item to mark active."}
   * @returns {Object}
   * @sampleResult {"code":0,"message":"The item has been marked as active."}
   */
  async markItemActive(organizationId, itemId) {
    if (!itemId) {
      throw new Error('"Item" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    return this.#apiRequest({
      logTag: 'markItemActive',
      method: 'post',
      url: `${ this.#base() }/items/${ itemId }/active`,
      organizationId: orgId,
    })
  }

  /**
   * @operationName Mark Item Inactive
   * @category Items
   * @description Marks an item inactive so it stops appearing in pickers and cannot be added to new transactions. Existing transactions remain intact. Preferred over delete for retiring an SKU.
   * @route POST /mark-item-inactive
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Item","name":"itemId","required":true,"dictionary":"listItems","dependsOn":["organizationId"],"description":"Item to mark inactive."}
   * @returns {Object}
   * @sampleResult {"code":0,"message":"The item has been marked as inactive."}
   */
  async markItemInactive(organizationId, itemId) {
    if (!itemId) {
      throw new Error('"Item" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    return this.#apiRequest({
      logTag: 'markItemInactive',
      method: 'post',
      url: `${ this.#base() }/items/${ itemId }/inactive`,
      organizationId: orgId,
    })
  }

  /**
   * @operationName List Items
   * @category Items
   * @description Lists items in the organization, with optional filters for SKU, name, status, and stock level.
   * @route POST /list-items
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Name Contains","name":"nameContains","description":"Optional partial name match (server-side)."}
   * @paramDef {"type":"String","label":"SKU Contains","name":"skuContains","description":"Optional partial SKU match."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Active","Inactive"]}},"description":"Optional status filter."}
   * @paramDef {"type":"String","label":"Filter By","name":"filterBy","uiComponent":{"type":"DROPDOWN","options":{"values":["All Items","Active","Inactive","Low Stock","Inventory Items","Sales Items","Purchase Items"]}},"description":"Predefined Zoho filter (e.g. Low Stock or Active)."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number (default 1)."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page size 1-200 (default 50)."}
   * @paramDef {"type":"Boolean","label":"Fetch All","name":"fetchAll","uiComponent":{"type":"TOGGLE"},"description":"If true, auto-paginate up to 50 pages."}
   * @returns {Object}
   * @sampleResult {"items":[{"item_id":"460000000027111","name":"Laptop","stock_on_hand":12}],"page_context":{"has_more_page":false}}
   */
  async listItemsAction(organizationId, nameContains, skuContains, status, filterBy, page, perPage, fetchAll) {
    const orgId = this.#resolveOrganizationId(organizationId)

    return this.#listEntities({
      logTag: 'listItemsAction',
      url: `${ this.#base() }/items`,
      orgId,
      listKey: 'items',
      page,
      perPage,
      fetchAll,
      extraQuery: {
        name_contains: nameContains || undefined,
        sku_contains: skuContains || undefined,
        status: this.#resolveChoice(status, ITEM_STATUS_MAP),
        filter_by: this.#resolveChoice(filterBy, ITEM_FILTER_BY_MAP),
      },
    })
  }

  // ITEM GROUPS + COMPOSITE ITEMS

  /**
   * @typedef {Object} ZohoGroupItem
   * @property {String} name - Variant name (required)
   * @property {String} sku - Variant SKU (required)
   * @property {Number} rate - Sales rate (required)
   * @property {Number} purchase_rate - Purchase rate (required)
   * @property {String} [attribute_option_name1] - Value for the 1st attribute (e.g. "Red")
   * @property {String} [attribute_option_name2] - Value for the 2nd attribute (e.g. "Small")
   * @property {String} [attribute_option_name3] - Value for the 3rd attribute
   */

  /**
   * @operationName Create Item Group
   * @category Item Groups
   * @description Creates a parent item group (variant container) with one or more variant items underneath.
   *
   * @route POST /create-item-group
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Name","name":"groupName","required":true,"description":"Group display name."}
   * @paramDef {"type":"String","label":"Unit","name":"unit","required":true,"description":"Unit of measure for variants (required by Zoho, e.g. qty, pcs)."}
   * @paramDef {"type":"String","label":"Brand","name":"brand","description":"Optional brand."}
   * @paramDef {"type":"String","label":"Manufacturer","name":"manufacturer","description":"Optional manufacturer."}
   * @paramDef {"type":"Array<String>","label":"Attribute Names","name":"attributeNames","description":"Array of variant attribute names (e.g. [\"Color\",\"Size\"])."}
   * @paramDef {"type":"Array<ZohoGroupItem>","label":"Items","name":"items","required":true,"description":"Array of variant items; each requires name, rate, purchase_rate and sku, and binds to attributes via attribute_option_name1/2/3 matching the Attribute Names above."}
   * @paramDef {"type":"Object","label":"Extra Fields","name":"extraFields","freeform":true,"description":"Advanced: a JSON object of additional documented Zoho fields not exposed as parameters above (including custom_fields) merged into the request body. Leave empty for the common case."}
   *
   * @returns {Object}
   * @sampleResult {"group_id":"460000000027333","group_name":"T-Shirt","items":[{"item_id":"4600000000273340","name":"T-Shirt - Red - S"}]}
   */
  async createItemGroup(organizationId, groupName, unit, brand, manufacturer, attributeNames, items, extraFields) {
    if (!groupName) {
      throw new Error('"Name" is required')
    }

    if (!unit) {
      throw new Error('"Unit" is required (Zoho requires a unit of measure on the item group)')
    }

    if (!Array.isArray(items) || items.length === 0) {
      throw new Error('"Items" must be a non-empty array of variants')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const body = cleanupObject({
      group_name: groupName,
      unit,
      brand,
      manufacturer,
      attribute_name1: attributeNames?.[0],
      attribute_name2: attributeNames?.[1],
      attribute_name3: attributeNames?.[2],
      items: items.map(i => cleanupObject(i)),
      ...(extraFields && typeof extraFields === 'object' ? extraFields : {}),
    })

    const response = await this.#apiRequest({
      logTag: 'createItemGroup',
      method: 'post',
      url: `${ this.#base() }/itemgroups`,
      organizationId: orgId,
      body,
    })

    return response?.item_group || response
  }

  /**
   * @operationName Get Item Group
   * @category Item Groups
   * @description Retrieves an item group with every variant item underneath. Use to enumerate variants of a parent SKU.
   * @route POST /get-item-group
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Item Group","name":"groupId","required":true,"dictionary":"listItemGroups","dependsOn":["organizationId"],"description":"Item group to retrieve."}
   * @returns {Object}
   * @sampleResult {"group_id":"460000000027333","group_name":"T-Shirt","items":[{"item_id":"4600000000273340","name":"Red S"}]}
   */
  async getItemGroup(organizationId, groupId) {
    if (!groupId) {
      throw new Error('"Item Group" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const response = await this.#apiRequest({
      logTag: 'getItemGroup',
      url: `${ this.#base() }/itemgroups/${ groupId }`,
      organizationId: orgId,
    })

    return response?.item_group || response
  }

  /**
   * @operationName Update Item Group
   * @category Item Groups
   * @description Updates an item group by merging supplied fields. Use when correcting or amending without re-sending the whole record.
   * @route POST /update-item-group
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Item Group","name":"groupId","required":true,"dictionary":"listItemGroups","dependsOn":["organizationId"],"description":"Item group to update."}
   * @paramDef {"type":"Object","label":"Fields","name":"fields","required":true,"freeform":true,"description":"Object of group fields to update."}
   * @returns {Object}
   * @sampleResult {"group_id":"460000000027333","group_name":"T-Shirt v2"}
   */
  async updateItemGroup(organizationId, groupId, fields) {
    if (!groupId) {
      throw new Error('"Item Group" is required')
    }

    if (!fields || typeof fields !== 'object' || Object.keys(fields).length === 0) {
      throw new Error('"Fields" must be a non-empty object')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const response = await this.#apiRequest({
      logTag: 'updateItemGroup',
      method: 'put',
      url: `${ this.#base() }/itemgroups/${ groupId }`,
      organizationId: orgId,
      body: cleanupObject(fields),
    })

    return response?.item_group || response
  }

  /**
   * @operationName Delete Item Group
   * @category Item Groups
   * @description Permanently deletes an item group AND all its variant items in one shot. Use carefully — to retire a single variant, delete that item instead.
   * @route POST /delete-item-group
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Item Group","name":"groupId","required":true,"dictionary":"listItemGroups","dependsOn":["organizationId"],"description":"Item group to delete."}
   * @returns {Object}
   * @sampleResult {"code":0,"message":"The item group has been deleted."}
   */
  async deleteItemGroup(organizationId, groupId) {
    if (!groupId) {
      throw new Error('"Item Group" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    return this.#apiRequest({
      logTag: 'deleteItemGroup',
      method: 'delete',
      url: `${ this.#base() }/itemgroups/${ groupId }`,
      organizationId: orgId,
    })
  }

  /**
   * @operationName List Item Groups
   * @category Item Groups
   * @description Lists item groups. Use to enumerate parent SKUs and their variants for batch processing or finding a group ID.
   * @route POST /list-item-groups
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Name Contains","name":"nameContains","description":"Optional partial name match."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number (default 1)."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page size 1-200 (default 50)."}
   * @paramDef {"type":"Boolean","label":"Fetch All","name":"fetchAll","uiComponent":{"type":"TOGGLE"},"description":"Auto-paginate."}
   * @returns {Object}
   * @sampleResult {"itemgroups":[{"group_id":"460000000027333","group_name":"T-Shirt"}],"page_context":{"has_more_page":false}}
   */
  async listItemGroupsAction(organizationId, nameContains, page, perPage, fetchAll) {
    const orgId = this.#resolveOrganizationId(organizationId)

    return this.#listEntities({
      logTag: 'listItemGroupsAction',
      url: `${ this.#base() }/itemgroups`,
      orgId,
      listKey: 'itemgroups',
      page,
      perPage,
      fetchAll,
      extraQuery: { name_contains: nameContains || undefined },
    })
  }

  // Composite Items

  /**
   * @typedef {Object} ZohoCompositeLineItem
   * @property {String} item_id
   * @property {Number} quantity
   */

  /**
   * @operationName Create Composite Item
   * @category Composite Items
   * @description Creates a composite item (kit/bundle) made up of one or more existing items at fixed quantities.
   *
   * @route POST /create-composite-item
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Composite item display name."}
   * @paramDef {"type":"String","label":"SKU","name":"sku","description":"Composite SKU code."}
   * @paramDef {"type":"String","label":"Unit","name":"unit","description":"Unit of measure."}
   * @paramDef {"type":"Number","label":"Sales Rate","name":"rate","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Sales price per kit."}
   * @paramDef {"type":"Boolean","label":"Returnable","name":"isReturnable","uiComponent":{"type":"TOGGLE"},"description":"Whether the kit is returnable."}
   * @paramDef {"type":"Array<ZohoCompositeLineItem>","label":"Mapped Items","name":"mappedItems","required":true,"description":"Array of {item_id, quantity} components."}
   * @paramDef {"type":"Object","label":"Extra Fields","name":"extraFields","freeform":true,"description":"Advanced: a JSON object of additional documented Zoho fields not exposed as parameters above (including custom_fields) merged into the request body. Leave empty for the common case."}
   *
   * @returns {Object}
   * @sampleResult {"composite_item_id":"460000000027222","name":"Starter Kit","mapped_items":[{"item_id":"460000000027111","quantity":2}]}
   */
  async createCompositeItem(organizationId, name, sku, unit, rate, isReturnable, mappedItems, extraFields) {
    if (!name) {
      throw new Error('"Name" is required')
    }

    if (!Array.isArray(mappedItems) || mappedItems.length === 0) {
      throw new Error('"Mapped Items" must be a non-empty array')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const body = cleanupObject({
      name,
      sku,
      unit,
      rate: rate !== undefined && rate !== null && rate !== '' ? Number(rate) : undefined,
      is_returnable: typeof isReturnable === 'boolean' ? isReturnable : undefined,
      mapped_items: mappedItems.map(i => cleanupObject({ item_id: i.item_id, quantity: Number(i.quantity) })),
      ...(extraFields && typeof extraFields === 'object' ? extraFields : {}),
    })

    const response = await this.#apiRequest({
      logTag: 'createCompositeItem',
      method: 'post',
      url: `${ this.#base() }/compositeitems`,
      organizationId: orgId,
      body,
    })

    return response?.composite_item
  }

  /**
   * @operationName Get Composite Item
   * @category Composite Items
   * @description Retrieves a composite item (kit) with the component breakdown — every member item and its assembly quantity. Use to inspect kit composition before assembly.
   * @route POST /get-composite-item
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Composite Item","name":"compositeItemId","required":true,"dictionary":"listCompositeItems","dependsOn":["organizationId"],"description":"Composite item to retrieve."}
   * @returns {Object}
   * @sampleResult {"composite_item_id":"460000000027222","name":"Starter Kit","mapped_items":[{"item_id":"460000000027111","quantity":2}]}
   */
  async getCompositeItem(organizationId, compositeItemId) {
    if (!compositeItemId) {
      throw new Error('"Composite Item" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const response = await this.#apiRequest({
      logTag: 'getCompositeItem',
      url: `${ this.#base() }/compositeitems/${ compositeItemId }`,
      organizationId: orgId,
    })

    return response?.composite_item
  }

  /**
   * @operationName Update Composite Item
   * @category Composite Items
   * @description Updates a composite item by merging supplied fields. Use when correcting or amending without re-sending the whole record.
   * @route POST /update-composite-item
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Composite Item","name":"compositeItemId","required":true,"dictionary":"listCompositeItems","dependsOn":["organizationId"],"description":"Composite item to update."}
   * @paramDef {"type":"Object","label":"Fields","name":"fields","required":true,"freeform":true,"description":"Partial update: a JSON object of the documented fields to change on this record. Only the keys you include are modified."}
   * @returns {Object}
   * @sampleResult {"composite_item_id":"460000000027222","name":"Starter Kit v2"}
   */
  async updateCompositeItem(organizationId, compositeItemId, fields) {
    if (!compositeItemId) {
      throw new Error('"Composite Item" is required')
    }

    if (!fields || typeof fields !== 'object' || Object.keys(fields).length === 0) {
      throw new Error('"Fields" must be a non-empty object')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const response = await this.#apiRequest({
      logTag: 'updateCompositeItem',
      method: 'put',
      url: `${ this.#base() }/compositeitems/${ compositeItemId }`,
      organizationId: orgId,
      body: cleanupObject(fields),
    })

    return response?.composite_item
  }

  /**
   * @operationName Delete Composite Item
   * @category Composite Items
   * @description Permanently deletes a composite item (kit definition). Component items are unaffected. Use to retire a kit no longer offered for sale.
   * @route POST /delete-composite-item
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Composite Item","name":"compositeItemId","required":true,"dictionary":"listCompositeItems","dependsOn":["organizationId"],"description":"Composite item to delete."}
   * @returns {Object}
   * @sampleResult {"code":0,"message":"The composite item has been deleted."}
   */
  async deleteCompositeItem(organizationId, compositeItemId) {
    if (!compositeItemId) {
      throw new Error('"Composite Item" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    return this.#apiRequest({
      logTag: 'deleteCompositeItem',
      method: 'delete',
      url: `${ this.#base() }/compositeitems/${ compositeItemId }`,
      organizationId: orgId,
    })
  }

  /**
   * @operationName Create Bundle
   * @category Composite Items
   * @description Records an assembly event: consumes the components of a composite item and produces stock of the kit.
   * @route POST /create-bundle
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Composite Item","name":"compositeItemId","required":true,"dictionary":"listCompositeItems","dependsOn":["organizationId"],"description":"Composite item being assembled."}
   * @paramDef {"type":"Number","label":"Quantity","name":"quantity","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Bundle quantity to assemble."}
   * @paramDef {"type":"String","label":"Date","name":"date","uiComponent":{"type":"DATE_PICKER"},"description":"Assembly date in YYYY-MM-DD (defaults to today)."}
   * @paramDef {"type":"String","label":"Reference Number","name":"referenceNumber","description":"Optional reference number."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional notes."}
   * @paramDef {"type":"String","label":"Location","name":"locationId","dictionary":"listLocations","dependsOn":["organizationId"],"description":"Optional location to assemble at."}
   * @returns {Object}
   * @sampleResult {"bundle_id":"460000000041001","composite_item_id":"460000000027222","quantity_to_bundle":3,"date":"2026-05-10"}
   */
  async createBundle(organizationId, compositeItemId, quantity, date, referenceNumber, notes, locationId) {
    if (!compositeItemId) {
      throw new Error('"Composite Item" is required')
    }

    if (quantity === undefined || quantity === null || quantity === '' || isNaN(Number(quantity))) {
      throw new Error('"Quantity" is required and must be a number')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const body = cleanupObject({
      composite_item_id: compositeItemId,
      quantity_to_bundle: Number(quantity),
      date: date || todayDate(),
      reference_number: referenceNumber,
      description: notes,
      location_id: locationId,
    })

    const response = await this.#apiRequest({
      logTag: 'createBundle',
      method: 'post',
      url: `${ this.#base() }/bundles`,
      organizationId: orgId,
      body,
    })

    return response?.bundle || response
  }

  /**
   * @operationName Delete Bundle
   * @category Composite Items
   * @description Reverses an assembly event by deleting the bundle record.
   * @route POST /delete-bundle
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Bundle ID","name":"bundleId","required":true,"freeform":true,"description":"Bundle (assembly) record to delete — use the Bundle ID returned by Create Bundle."}
   * @returns {Object}
   * @sampleResult {"code":0,"message":"The bundle has been deleted."}
   */
  async deleteBundle(organizationId, bundleId) {
    if (!bundleId) {
      throw new Error('"Bundle ID" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    return this.#apiRequest({
      logTag: 'deleteBundle',
      method: 'delete',
      url: `${ this.#base() }/bundles/${ bundleId }`,
      organizationId: orgId,
    })
  }
  // INVENTORY ADJUSTMENTS

  /**
   * @typedef {Object} ZohoAdjustmentLineItem
   * @property {String} item_id
   * @property {Number} [quantity_adjusted] - For adjustment_type=quantity (positive or negative)
   * @property {Number} [value_adjusted] - For adjustment_type=value
   * @property {String} [location_id]
   */

  /**
   * @operationName Create Inventory Adjustment
   * @category Inventory Adjustments
   * @description Records a stock adjustment (e.g. cycle count, write-off, damage) against one or more items. Use type=quantity for stock changes and type=value for cost-only revaluation.
   *
   * @route POST /create-inventory-adjustment
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Date","name":"date","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"Adjustment date in YYYY-MM-DD."}
   * @paramDef {"type":"String","label":"Reason","name":"reason","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Free-text adjustment reason (e.g. \"Damage\", \"Cycle count\")."}
   * @paramDef {"type":"String","label":"Adjustment Type","name":"adjustmentType","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Quantity","Value"]}},"description":"quantity = stock change; value = cost-only revaluation."}
   * @paramDef {"type":"String","label":"Account","name":"accountId","freeform":true,"description":"Optional GL account ID used to offset a value-type adjustment (find it in Zoho under Accountant → Chart of Accounts). Note: Zoho also accepts the offset account per line item as adjustment_account_id."}
   * @paramDef {"type":"String","label":"Reference Number","name":"referenceNumber","description":"Optional reference number."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional adjustment description."}
   * @paramDef {"type":"String","label":"Location","name":"locationId","dictionary":"listLocations","dependsOn":["organizationId"],"description":"Optional default location for line items."}
   * @paramDef {"type":"Array<ZohoAdjustmentLineItem>","label":"Line Items","name":"lineItems","required":true,"description":"Array of {item_id, quantity_adjusted | value_adjusted, location_id}."}
   * @paramDef {"type":"Object","label":"Extra Fields","name":"extraFields","freeform":true,"description":"Advanced: a JSON object of additional documented Zoho fields not exposed as parameters above (including custom_fields) merged into the request body. Leave empty for the common case."}
   *
   * @returns {Object}
   * @sampleResult {"inventory_adjustment_id":"460000000050001","reason":"Cycle count","adjustment_type":"quantity","status":"adjusted"}
   */
  async createInventoryAdjustment(organizationId, date, reason, adjustmentType, accountId, referenceNumber, description, locationId, lineItems, extraFields) {
    if (!date) {
      throw new Error('"Date" is required')
    }

    if (!reason) {
      throw new Error('"Reason" is required')
    }

    if (!adjustmentType) {
      throw new Error('"Adjustment Type" is required')
    }

    if (!Array.isArray(lineItems) || lineItems.length === 0) {
      throw new Error('"Line Items" must be a non-empty array')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const body = cleanupObject({
      date,
      reason,
      adjustment_type: this.#resolveChoice(adjustmentType, ADJUSTMENT_TYPE_MAP),
      account_id: accountId,
      reference_number: referenceNumber,
      description,
      location_id: locationId,
      line_items: lineItems.map(li => cleanupObject(li)),
      ...(extraFields && typeof extraFields === 'object' ? extraFields : {}),
    })

    const response = await this.#apiRequest({
      logTag: 'createInventoryAdjustment',
      method: 'post',
      url: `${ this.#base() }/inventoryadjustments`,
      organizationId: orgId,
      body,
    })

    return response?.inventory_adjustment
  }

  /**
   * @operationName Get Inventory Adjustment
   * @category Inventory Adjustments
   * @description Retrieves an inventory adjustment record by ID. Use after listing/picker selection or a trigger event to read full details.
   * @route POST /get-inventory-adjustment
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Adjustment ID","name":"adjustmentId","required":true,"dictionary":"listInventoryAdjustmentsDictionary","dependsOn":["organizationId"],"description":"Inventory adjustment to retrieve."}
   * @returns {Object}
   * @sampleResult {"inventory_adjustment_id":"460000000050001","reason":"Cycle count"}
   */
  async getInventoryAdjustment(organizationId, adjustmentId) {
    if (!adjustmentId) {
      throw new Error('"Adjustment ID" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const response = await this.#apiRequest({
      logTag: 'getInventoryAdjustment',
      url: `${ this.#base() }/inventoryadjustments/${ adjustmentId }`,
      organizationId: orgId,
    })

    return response?.inventory_adjustment
  }

  /**
   * @operationName Delete Inventory Adjustment
   * @category Inventory Adjustments
   * @description Permanently deletes an inventory adjustment record and reverses its stock impact. Use to undo a miscounted adjustment.
   * @route POST /delete-inventory-adjustment
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Adjustment ID","name":"adjustmentId","required":true,"dictionary":"listInventoryAdjustmentsDictionary","dependsOn":["organizationId"],"description":"Inventory adjustment to delete."}
   * @returns {Object}
   * @sampleResult {"code":0,"message":"The adjustment has been deleted."}
   */
  async deleteInventoryAdjustment(organizationId, adjustmentId) {
    if (!adjustmentId) {
      throw new Error('"Adjustment ID" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    return this.#apiRequest({
      logTag: 'deleteInventoryAdjustment',
      method: 'delete',
      url: `${ this.#base() }/inventoryadjustments/${ adjustmentId }`,
      organizationId: orgId,
    })
  }

  /**
   * @operationName List Inventory Adjustments
   * @category Inventory Adjustments
   * @description Lists inventory adjustments in the organization with optional filters.
   * @route POST /list-inventory-adjustments
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Date Start","name":"dateStart","uiComponent":{"type":"DATE_PICKER"},"description":"Optional inclusive start date (YYYY-MM-DD)."}
   * @paramDef {"type":"String","label":"Date End","name":"dateEnd","uiComponent":{"type":"DATE_PICKER"},"description":"Optional inclusive end date (YYYY-MM-DD)."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number (default 1)."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page size 1-200 (default 50)."}
   * @paramDef {"type":"Boolean","label":"Fetch All","name":"fetchAll","uiComponent":{"type":"TOGGLE"},"description":"Auto-paginate."}
   * @returns {Object}
   * @sampleResult {"inventory_adjustments":[{"inventory_adjustment_id":"460000000050001","reason":"Cycle count"}],"page_context":{"has_more_page":false}}
   */
  async listInventoryAdjustments(organizationId, dateStart, dateEnd, page, perPage, fetchAll) {
    const orgId = this.#resolveOrganizationId(organizationId)

    return this.#listEntities({
      logTag: 'listInventoryAdjustments',
      url: `${ this.#base() }/inventoryadjustments`,
      orgId,
      listKey: 'inventory_adjustments',
      page,
      perPage,
      fetchAll,
      extraQuery: {
        date_start: dateStart || undefined,
        date_end: dateEnd || undefined,
      },
    })
  }

  // SALES ORDERS

  /**
   * @typedef {Object} ZohoLineItem
   * @property {String} [item_id] - Item ID. Optional only when name is supplied for a free-text line.
   * @property {String} [name]
   * @property {Number} [rate]
   * @property {Number} quantity
   * @property {String} [unit]
   * @property {String} [tax_id]
   * @property {String} [location_id]
   * @property {String} [description]
   */

  /**
   * @operationName Create Sales Order
   * @category Sales Orders
   * @description Creates a sales order against an existing customer with one or more line items. Optionally specify a location, salesperson, discount, and shipping charge.
   *
   * @route POST /create-sales-order
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Customer","name":"customerId","required":true,"dictionary":"listContacts","dependsOn":["organizationId"],"description":"Customer being sold to."}
   * @paramDef {"type":"Array<ZohoLineItem>","label":"Line Items","name":"lineItems","required":true,"description":"Array of line items {item_id, quantity, rate?, location_id?, tax_id?}."}
   * @paramDef {"type":"String","label":"Sales Order Number","name":"salesOrderNumber","description":"Optional override; auto-numbered when omitted."}
   * @paramDef {"type":"String","label":"Reference Number","name":"referenceNumber","description":"Optional external reference."}
   * @paramDef {"type":"String","label":"Date","name":"date","uiComponent":{"type":"DATE_PICKER"},"description":"Sales order date YYYY-MM-DD (defaults to today)."}
   * @paramDef {"type":"String","label":"Shipment Date","name":"shipmentDate","uiComponent":{"type":"DATE_PICKER"},"description":"Expected shipment date YYYY-MM-DD."}
   * @paramDef {"type":"String","label":"Location","name":"locationId","dictionary":"listLocations","dependsOn":["organizationId"],"description":"Optional default location for the SO and line items."}
   * @paramDef {"type":"Number","label":"Shipping Charge","name":"shippingCharge","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional shipping fee."}
   * @paramDef {"type":"String","label":"Delivery Method","name":"deliveryMethod","description":"Optional carrier/method label."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional notes shown on the SO."}
   * @paramDef {"type":"String","label":"Terms","name":"terms","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional terms text."}
   * @paramDef {"type":"Object","label":"Extra Fields","name":"extraFields","freeform":true,"description":"Additional fields merged into the body (discount, salesperson_id, custom_fields, etc.)."}
   *
   * @returns {Object}
   * @sampleResult {"salesorder_id":"460000000034037","salesorder_number":"SO-00003","status":"draft","total":1250}
   */
  async createSalesOrder(organizationId, customerId, lineItems, salesOrderNumber, referenceNumber, date, shipmentDate, locationId, shippingCharge, deliveryMethod, notes, terms, extraFields) {
    if (!customerId) {
      throw new Error('"Customer" is required')
    }

    if (!Array.isArray(lineItems) || lineItems.length === 0) {
      throw new Error('"Line Items" must be a non-empty array')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const body = cleanupObject({
      customer_id: customerId,
      salesorder_number: salesOrderNumber,
      reference_number: referenceNumber,
      date: date || todayDate(),
      shipment_date: shipmentDate,
      location_id: locationId,
      line_items: lineItems.map(li => cleanupObject(li)),
      shipping_charge: shippingCharge !== undefined && shippingCharge !== null && shippingCharge !== '' ? Number(shippingCharge) : undefined,
      delivery_method: deliveryMethod,
      notes,
      terms,
      ...(extraFields && typeof extraFields === 'object' ? extraFields : {}),
    })

    const response = await this.#apiRequest({
      logTag: 'createSalesOrder',
      method: 'post',
      url: `${ this.#base() }/salesorders`,
      organizationId: orgId,
      body,
    })

    return response?.salesorder
  }

  /**
   * @operationName Get Sales Order
   * @category Sales Orders
   * @description Retrieves a sales order with its line items, status history, and totals. Use after listing or a polling-trigger event to read full detail.
   * @route POST /get-sales-order
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Sales Order","name":"salesOrderId","required":true,"dictionary":"listSalesOrdersDictionary","dependsOn":["organizationId"],"description":"Sales order to retrieve."}
   * @returns {Object}
   * @sampleResult {"salesorder_id":"460000000034037","salesorder_number":"SO-00003","status":"draft"}
   */
  async getSalesOrder(organizationId, salesOrderId) {
    if (!salesOrderId) {
      throw new Error('"Sales Order" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const response = await this.#apiRequest({
      logTag: 'getSalesOrder',
      url: `${ this.#base() }/salesorders/${ salesOrderId }`,
      organizationId: orgId,
    })

    return response?.salesorder
  }

  /**
   * @operationName Update Sales Order
   * @category Sales Orders
   * @description Updates an existing sales order by merging supplied fields. Use when partial-updating without re-sending the whole record. Cannot edit confirmed/voided orders without reopening.
   * @route POST /update-sales-order
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Sales Order","name":"salesOrderId","required":true,"dictionary":"listSalesOrdersDictionary","dependsOn":["organizationId"],"description":"Sales order to update."}
   * @paramDef {"type":"Object","label":"Fields","name":"fields","required":true,"freeform":true,"description":"Object of SO fields to update (line_items, customer_id, etc.)."}
   * @returns {Object}
   * @sampleResult {"salesorder_id":"460000000034037","salesorder_number":"SO-00003","status":"draft"}
   */
  async updateSalesOrder(organizationId, salesOrderId, fields) {
    if (!salesOrderId) {
      throw new Error('"Sales Order" is required')
    }

    if (!fields || typeof fields !== 'object' || Object.keys(fields).length === 0) {
      throw new Error('"Fields" must be a non-empty object')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const response = await this.#apiRequest({
      logTag: 'updateSalesOrder',
      method: 'put',
      url: `${ this.#base() }/salesorders/${ salesOrderId }`,
      organizationId: orgId,
      body: cleanupObject(fields),
    })

    return response?.salesorder
  }

  /**
   * @operationName Delete Sales Order
   * @category Sales Orders
   * @description Permanently deletes a sales order. Use to clean up drafts; confirmed orders should be voided first via Mark Sales Order Void so stock impact unwinds correctly.
   * @route POST /delete-sales-order
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Sales Order","name":"salesOrderId","required":true,"dictionary":"listSalesOrdersDictionary","dependsOn":["organizationId"],"description":"Sales order to delete."}
   * @returns {Object}
   * @sampleResult {"code":0,"message":"The sales order has been deleted."}
   */
  async deleteSalesOrder(organizationId, salesOrderId) {
    if (!salesOrderId) {
      throw new Error('"Sales Order" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    return this.#apiRequest({
      logTag: 'deleteSalesOrder',
      method: 'delete',
      url: `${ this.#base() }/salesorders/${ salesOrderId }`,
      organizationId: orgId,
    })
  }

  /**
   * @operationName Mark Sales Order Confirmed
   * @category Sales Orders
   * @description Confirms a draft sales order so it can be packaged and shipped. Use once line items, customer, and price are final — confirmation locks the order and reserves stock.
   * @route POST /mark-sales-order-confirmed
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Sales Order","name":"salesOrderId","required":true,"dictionary":"listSalesOrdersDictionary","dependsOn":["organizationId"],"description":"Sales order to confirm."}
   * @returns {Object}
   * @sampleResult {"code":0,"message":"The sales order has been marked as confirmed."}
   */
  async markSalesOrderConfirmed(organizationId, salesOrderId) {
    if (!salesOrderId) {
      throw new Error('"Sales Order" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    return this.#apiRequest({
      logTag: 'markSalesOrderConfirmed',
      method: 'post',
      url: `${ this.#base() }/salesorders/${ salesOrderId }/status/confirmed`,
      organizationId: orgId,
    })
  }

  /**
   * @operationName Mark Sales Order Void
   * @category Sales Orders
   * @description Voids a sales order so it no longer affects stock or reports. Use to cancel an order after confirmation without losing its audit trail.
   * @route POST /mark-sales-order-void
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Sales Order","name":"salesOrderId","required":true,"dictionary":"listSalesOrdersDictionary","dependsOn":["organizationId"],"description":"Sales order to void."}
   * @returns {Object}
   * @sampleResult {"code":0,"message":"The sales order has been marked as void."}
   */
  async markSalesOrderVoid(organizationId, salesOrderId) {
    if (!salesOrderId) {
      throw new Error('"Sales Order" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    return this.#apiRequest({
      logTag: 'markSalesOrderVoid',
      method: 'post',
      url: `${ this.#base() }/salesorders/${ salesOrderId }/status/void`,
      organizationId: orgId,
    })
  }

  /**
   * @operationName List Sales Orders
   * @category Sales Orders
   * @description Lists sales orders in the organization with optional filters by status, customer, and date range.
   * @route POST /list-sales-orders
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Draft","Open","Invoiced","Partially Invoiced","Void","Overdue","On Hold","Confirmed","Closed"]}},"description":"Optional status filter."}
   * @paramDef {"type":"String","label":"Customer","name":"customerId","dictionary":"listContacts","dependsOn":["organizationId"],"description":"Optional customer filter."}
   * @paramDef {"type":"String","label":"Date Start","name":"dateStart","uiComponent":{"type":"DATE_PICKER"},"description":"Optional start date YYYY-MM-DD."}
   * @paramDef {"type":"String","label":"Date End","name":"dateEnd","uiComponent":{"type":"DATE_PICKER"},"description":"Optional end date YYYY-MM-DD."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number (default 1)."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page size 1-200 (default 50)."}
   * @paramDef {"type":"Boolean","label":"Fetch All","name":"fetchAll","uiComponent":{"type":"TOGGLE"},"description":"Auto-paginate."}
   * @returns {Object}
   * @sampleResult {"salesorders":[{"salesorder_id":"460000000034037","salesorder_number":"SO-00003"}],"page_context":{"has_more_page":false}}
   */
  async listSalesOrders(organizationId, status, customerId, dateStart, dateEnd, page, perPage, fetchAll) {
    const orgId = this.#resolveOrganizationId(organizationId)

    status = this.#resolveChoice(status, SALES_ORDER_STATUS_MAP)

    return this.#listEntities({
      logTag: 'listSalesOrders',
      url: `${ this.#base() }/salesorders`,
      orgId,
      listKey: 'salesorders',
      page,
      perPage,
      fetchAll,
      extraQuery: {
        status: status || undefined,
        customer_id: customerId || undefined,
        date_start: dateStart || undefined,
        date_end: dateEnd || undefined,
      },
    })
  }

  // PACKAGES + SHIPMENT ORDERS

  /**
   * @typedef {Object} ZohoPackageLineItem
   * @property {String} so_line_item_id - Sales order line item ID
   * @property {Number} quantity - Quantity packed (≤ ordered)
   */

  /**
   * @operationName Create Package
   * @category Packages
   * @description Creates a package from a sales order. Packages must reference an existing sales order — the API requires salesorder_id.
   *
   * @route POST /create-package
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Sales Order","name":"salesOrderId","required":true,"dictionary":"listSalesOrdersDictionary","dependsOn":["organizationId"],"description":"Sales order that this package fulfills."}
   * @paramDef {"type":"Array<ZohoPackageLineItem>","label":"Line Items","name":"lineItems","required":true,"description":"Array of {so_line_item_id, quantity} entries describing what's in the package."}
   * @paramDef {"type":"String","label":"Package Number","name":"packageNumber","description":"Optional override; auto-numbered when omitted."}
   * @paramDef {"type":"String","label":"Date","name":"date","uiComponent":{"type":"DATE_PICKER"},"description":"Package date YYYY-MM-DD (defaults to today)."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional notes."}
   * @paramDef {"type":"Object","label":"Extra Fields","name":"extraFields","freeform":true,"description":"Advanced: a JSON object of additional documented Zoho fields not exposed as parameters above (including custom_fields) merged into the request body. Leave empty for the common case."}
   *
   * @returns {Object}
   * @sampleResult {"package_id":"460000000040001","package_number":"PA-00001","status":"NotShipped"}
   */
  async createPackage(organizationId, salesOrderId, lineItems, packageNumber, date, notes, extraFields) {
    if (!salesOrderId) {
      throw new Error('"Sales Order" is required (packages must reference a sales order)')
    }

    if (!Array.isArray(lineItems) || lineItems.length === 0) {
      throw new Error('"Line Items" must be a non-empty array')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const body = cleanupObject({
      package_number: packageNumber,
      date: date || todayDate(),
      notes,
      line_items: lineItems.map(li => cleanupObject({
        so_line_item_id: li.so_line_item_id,
        quantity: Number(li.quantity),
      })),
      ...(extraFields && typeof extraFields === 'object' ? extraFields : {}),
    })

    const response = await this.#apiRequest({
      logTag: 'createPackage',
      method: 'post',
      url: `${ this.#base() }/packages`,
      organizationId: orgId,
      query: { salesorder_id: salesOrderId },
      body,
    })

    return response?.package
  }

  /**
   * @operationName Get Package
   * @category Packages
   * @description Retrieves a package record by ID. Use after listing/picker selection or a trigger event to read full details.
   * @route POST /get-package
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Package","name":"packageId","required":true,"dictionary":"listPackagesDictionary","dependsOn":["organizationId"],"description":"Package to retrieve."}
   * @returns {Object}
   * @sampleResult {"package_id":"460000000040001","package_number":"PA-00001","status":"Shipped"}
   */
  async getPackage(organizationId, packageId) {
    if (!packageId) {
      throw new Error('"Package" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const response = await this.#apiRequest({
      logTag: 'getPackage',
      url: `${ this.#base() }/packages/${ packageId }`,
      organizationId: orgId,
    })

    return response?.package
  }

  /**
   * @operationName Update Package
   * @category Packages
   * @description Updates a package record (e.g. tracking, line items, notes).
   * @route POST /update-package
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Package","name":"packageId","required":true,"dictionary":"listPackagesDictionary","dependsOn":["organizationId"],"description":"Package to update."}
   * @paramDef {"type":"String","label":"Sales Order","name":"salesOrderId","dictionary":"listSalesOrdersDictionary","dependsOn":["organizationId"],"description":"Optional sales order ID this package belongs to (sent as a query hint when provided)."}
   * @paramDef {"type":"Object","label":"Fields","name":"fields","required":true,"freeform":true,"description":"Object of package fields to update."}
   * @returns {Object}
   * @sampleResult {"package_id":"460000000040001","package_number":"PA-00001"}
   */
  async updatePackage(organizationId, packageId, salesOrderId, fields) {
    if (!packageId) {
      throw new Error('"Package" is required')
    }

    if (!fields || typeof fields !== 'object' || Object.keys(fields).length === 0) {
      throw new Error('"Fields" must be a non-empty object')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const response = await this.#apiRequest({
      logTag: 'updatePackage',
      method: 'put',
      url: `${ this.#base() }/packages/${ packageId }`,
      organizationId: orgId,
      query: salesOrderId ? { salesorder_id: salesOrderId } : undefined,
      body: cleanupObject(fields),
    })

    return response?.package
  }

  /**
   * @operationName Delete Package
   * @category Packages
   * @description Permanently deletes a package. Use to undo a packing mistake before the package is shipped; line items return to the sales order pool.
   * @route POST /delete-package
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Package","name":"packageId","required":true,"dictionary":"listPackagesDictionary","dependsOn":["organizationId"],"description":"Package to delete."}
   * @returns {Object}
   * @sampleResult {"code":0,"message":"The package has been deleted."}
   */
  async deletePackage(organizationId, packageId) {
    if (!packageId) {
      throw new Error('"Package" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    return this.#apiRequest({
      logTag: 'deletePackage',
      method: 'delete',
      url: `${ this.#base() }/packages/${ packageId }`,
      organizationId: orgId,
    })
  }

  /**
   * @operationName List Packages
   * @category Packages
   * @description Lists packages with optional status filter.
   * @route POST /list-packages
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Not Shipped","Shipped","Delivered"]}},"description":"Optional shipment status."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number (default 1)."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page size 1-200 (default 50)."}
   * @paramDef {"type":"Boolean","label":"Fetch All","name":"fetchAll","uiComponent":{"type":"TOGGLE"},"description":"Auto-paginate."}
   * @returns {Object}
   * @sampleResult {"packages":[{"package_id":"460000000040001","status":"NotShipped"}]}
   */
  async listPackages(organizationId, status, page, perPage, fetchAll) {
    const orgId = this.#resolveOrganizationId(organizationId)

    status = this.#resolveChoice(status, SHIPMENT_STATUS_MAP)

    return this.#listEntities({
      logTag: 'listPackages',
      url: `${ this.#base() }/packages`,
      orgId,
      listKey: 'packages',
      page,
      perPage,
      fetchAll,
      extraQuery: { filter_by: status || undefined },
    })
  }

  /**
   * @operationName Create Shipment Order
   * @category Shipment Orders
   * @description Creates a shipment order from one or more packages of a sales order. Shipments are separate from packages — packages get bagged into a shipment that the carrier collects.
   *
   * @route POST /create-shipment-order
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Sales Order","name":"salesOrderId","required":true,"dictionary":"listSalesOrdersDictionary","dependsOn":["organizationId"],"description":"Sales order being shipped."}
   * @paramDef {"type":"Array<String>","label":"Package IDs","name":"packageIds","required":true,"description":"Array of package IDs included in this shipment."}
   * @paramDef {"type":"String","label":"Shipment Number","name":"shipmentNumber","description":"Optional shipment number."}
   * @paramDef {"type":"String","label":"Date","name":"date","uiComponent":{"type":"DATE_PICKER"},"description":"Shipment date YYYY-MM-DD (defaults to today)."}
   * @paramDef {"type":"String","label":"Delivery Method","name":"deliveryMethod","description":"Carrier / delivery method (e.g. FedEx, UPS). Zoho records this as the shipment's delivery_method."}
   * @paramDef {"type":"String","label":"Tracking Number","name":"trackingNumber","description":"Optional tracking number."}
   * @paramDef {"type":"Number","label":"Shipping Charge","name":"shippingCharge","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional shipping charge."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional notes."}
   * @paramDef {"type":"Object","label":"Extra Fields","name":"extraFields","freeform":true,"description":"Advanced: a JSON object of additional documented Zoho fields not exposed as parameters above (including custom_fields) merged into the request body. Leave empty for the common case."}
   *
   * @returns {Object}
   * @sampleResult {"shipmentorder_id":"460000000041001","shipment_number":"SH-00001","status":"shipped"}
   */
  async createShipmentOrder(organizationId, salesOrderId, packageIds, shipmentNumber, date, deliveryMethod, trackingNumber, shippingCharge, notes, extraFields) {
    if (!salesOrderId) {
      throw new Error('"Sales Order" is required')
    }

    if (!Array.isArray(packageIds) || packageIds.length === 0) {
      throw new Error('"Package IDs" must be a non-empty array')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const body = cleanupObject({
      shipment_number: shipmentNumber,
      date: date || todayDate(),
      delivery_method: deliveryMethod,
      tracking_number: trackingNumber,
      shipping_charge: shippingCharge !== undefined && shippingCharge !== null && shippingCharge !== '' ? Number(shippingCharge) : undefined,
      notes,
      ...(extraFields && typeof extraFields === 'object' ? extraFields : {}),
    })

    const response = await this.#apiRequest({
      logTag: 'createShipmentOrder',
      method: 'post',
      url: `${ this.#base() }/shipmentorders`,
      organizationId: orgId,
      query: { salesorder_id: salesOrderId, package_ids: packageIds.join(',') },
      body,
    })

    return response?.shipmentorder
  }

  /**
   * @operationName Get Shipment Order
   * @category Shipment Orders
   * @description Retrieves a shipment order with linked packages, tracking number, carrier, and delivery status. Use to follow shipment progress.
   * @route POST /get-shipment-order
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Shipment Order ID","name":"shipmentOrderId","required":true,"freeform":true,"description":"Shipment order ID (returned by Create Shipment Order). Shipment order toretrieve."}
   * @returns {Object}
   * @sampleResult {"shipmentorder_id":"460000000041001","shipment_number":"SH-00001","status":"shipped"}
   */
  async getShipmentOrder(organizationId, shipmentOrderId) {
    if (!shipmentOrderId) {
      throw new Error('"Shipment Order ID" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const response = await this.#apiRequest({
      logTag: 'getShipmentOrder',
      url: `${ this.#base() }/shipmentorders/${ shipmentOrderId }`,
      organizationId: orgId,
    })

    return response?.shipmentorder
  }

  /**
   * @operationName Mark Shipment Delivered
   * @category Shipment Orders
   * @description Marks a shipment order as delivered, completing the order lifecycle. Use when carrier confirmation arrives out-of-band and Zoho should reflect final state.
   * @route POST /mark-shipment-delivered
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Shipment Order ID","name":"shipmentOrderId","required":true,"freeform":true,"description":"Shipment order ID (returned by Create Shipment Order). Shipment order tomark delivered."}
   * @returns {Object}
   * @sampleResult {"code":0,"message":"The shipment has been marked as delivered."}
   */
  async markShipmentDelivered(organizationId, shipmentOrderId) {
    if (!shipmentOrderId) {
      throw new Error('"Shipment Order ID" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    return this.#apiRequest({
      logTag: 'markShipmentDelivered',
      method: 'post',
      url: `${ this.#base() }/shipmentorders/${ shipmentOrderId }/status/delivered`,
      organizationId: orgId,
    })
  }

  /**
   * @operationName Delete Shipment Order
   * @category Shipment Orders
   * @description Permanently deletes a shipment order. Underlying packages remain intact and can be re-shipped. Use to fix carrier/tracking-number mistakes before delivery.
   * @route POST /delete-shipment-order
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Shipment Order ID","name":"shipmentOrderId","required":true,"freeform":true,"description":"Shipment order ID (returned by Create Shipment Order). Shipment order todelete."}
   * @returns {Object}
   * @sampleResult {"code":0,"message":"The shipment has been deleted."}
   */
  async deleteShipmentOrder(organizationId, shipmentOrderId) {
    if (!shipmentOrderId) {
      throw new Error('"Shipment Order ID" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    return this.#apiRequest({
      logTag: 'deleteShipmentOrder',
      method: 'delete',
      url: `${ this.#base() }/shipmentorders/${ shipmentOrderId }`,
      organizationId: orgId,
    })
  }
  // SALES RETURNS + RECEIVES

  /**
   * @operationName Create Sales Return
   * @category Sales Returns
   * @description Creates a sales return record. Optionally link it to the originating sales order; Zoho treats salesorder_id as optional.
   *
   * @route POST /create-sales-return
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Sales Order","name":"salesOrderId","dictionary":"listSalesOrdersDictionary","dependsOn":["organizationId"],"description":"Optional sales order this return is against (links the return to the SO when provided)."}
   * @paramDef {"type":"Array<ZohoLineItem>","label":"Line Items","name":"lineItems","required":true,"description":"Array of {item_id, quantity, rate?} return entries."}
   * @paramDef {"type":"String","label":"Date","name":"date","uiComponent":{"type":"DATE_PICKER"},"description":"Return date YYYY-MM-DD (defaults to today)."}
   * @paramDef {"type":"String","label":"Reason","name":"reason","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional return reason."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional notes."}
   * @paramDef {"type":"Object","label":"Extra Fields","name":"extraFields","freeform":true,"description":"Advanced: a JSON object of additional documented Zoho fields not exposed as parameters above (including custom_fields) merged into the request body. Leave empty for the common case."}
   *
   * @returns {Object}
   * @sampleResult {"salesreturn_id":"460000000060001","salesreturn_number":"SR-00001","status":"open"}
   */
  async createSalesReturn(organizationId, salesOrderId, lineItems, date, reason, notes, extraFields) {
    if (!Array.isArray(lineItems) || lineItems.length === 0) {
      throw new Error('"Line Items" must be a non-empty array')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const body = cleanupObject({
      date: date || todayDate(),
      reason,
      notes,
      line_items: lineItems.map(li => cleanupObject(li)),
      ...(extraFields && typeof extraFields === 'object' ? extraFields : {}),
    })

    const response = await this.#apiRequest({
      logTag: 'createSalesReturn',
      method: 'post',
      url: `${ this.#base() }/salesreturns`,
      organizationId: orgId,
      query: salesOrderId ? { salesorder_id: salesOrderId } : undefined,
      body,
    })

    return response?.salesreturn
  }

  /**
   * @operationName Get Sales Return
   * @category Sales Returns
   * @description Retrieves a sales return record by ID. Use after listing/picker selection or a trigger event to read full details.
   * @route POST /get-sales-return
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Sales Return ID","name":"salesReturnId","required":true,"dictionary":"listSalesReturnsDictionary","dependsOn":["organizationId"],"description":"Sales return to retrieve."}
   * @returns {Object}
   * @sampleResult {"salesreturn_id":"460000000060001","status":"open"}
   */
  async getSalesReturn(organizationId, salesReturnId) {
    if (!salesReturnId) {
      throw new Error('"Sales Return ID" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const response = await this.#apiRequest({
      logTag: 'getSalesReturn',
      url: `${ this.#base() }/salesreturns/${ salesReturnId }`,
      organizationId: orgId,
    })

    return response?.salesreturn
  }

  /**
   * @operationName Update Sales Return
   * @category Sales Returns
   * @description Updates a sales return by merging supplied fields. Use when correcting or amending without re-sending the whole record.
   * @route POST /update-sales-return
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Sales Return ID","name":"salesReturnId","required":true,"dictionary":"listSalesReturnsDictionary","dependsOn":["organizationId"],"description":"Sales return to update."}
   * @paramDef {"type":"Object","label":"Fields","name":"fields","required":true,"freeform":true,"description":"Partial update: a JSON object of the documented fields to change on this record. Only the keys you include are modified."}
   * @returns {Object}
   * @sampleResult {"salesreturn_id":"460000000060001","status":"open"}
   */
  async updateSalesReturn(organizationId, salesReturnId, fields) {
    if (!salesReturnId) {
      throw new Error('"Sales Return ID" is required')
    }

    if (!fields || typeof fields !== 'object' || Object.keys(fields).length === 0) {
      throw new Error('"Fields" must be a non-empty object')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const response = await this.#apiRequest({
      logTag: 'updateSalesReturn',
      method: 'put',
      url: `${ this.#base() }/salesreturns/${ salesReturnId }`,
      organizationId: orgId,
      body: cleanupObject(fields),
    })

    return response?.salesreturn
  }

  /**
   * @operationName Delete Sales Return
   * @category Sales Returns
   * @description Permanently deletes a sales return record. Use only before the return is processed; for received returns, unwind via inventory adjustment instead.
   * @route POST /delete-sales-return
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Sales Return ID","name":"salesReturnId","required":true,"dictionary":"listSalesReturnsDictionary","dependsOn":["organizationId"],"description":"Sales return to delete."}
   * @returns {Object}
   * @sampleResult {"code":0,"message":"The sales return has been deleted."}
   */
  async deleteSalesReturn(organizationId, salesReturnId) {
    if (!salesReturnId) {
      throw new Error('"Sales Return ID" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    return this.#apiRequest({
      logTag: 'deleteSalesReturn',
      method: 'delete',
      url: `${ this.#base() }/salesreturns/${ salesReturnId }`,
      organizationId: orgId,
    })
  }

  /**
   * @operationName List Sales Returns
   * @category Sales Returns
   * @description Lists sales returns with optional date range.
   * @route POST /list-sales-returns
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Date Start","name":"dateStart","uiComponent":{"type":"DATE_PICKER"},"description":"Optional start date YYYY-MM-DD."}
   * @paramDef {"type":"String","label":"Date End","name":"dateEnd","uiComponent":{"type":"DATE_PICKER"},"description":"Optional end date YYYY-MM-DD."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number (default 1)."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page size 1-200."}
   * @paramDef {"type":"Boolean","label":"Fetch All","name":"fetchAll","uiComponent":{"type":"TOGGLE"},"description":"Auto-paginate."}
   * @returns {Object}
   * @sampleResult {"salesreturns":[{"salesreturn_id":"460000000060001"}]}
   */
  async listSalesReturns(organizationId, dateStart, dateEnd, page, perPage, fetchAll) {
    const orgId = this.#resolveOrganizationId(organizationId)

    return this.#listEntities({
      logTag: 'listSalesReturns',
      url: `${ this.#base() }/salesreturns`,
      orgId,
      listKey: 'salesreturns',
      page,
      perPage,
      fetchAll,
      extraQuery: {
        date_start: dateStart || undefined,
        date_end: dateEnd || undefined,
      },
    })
  }

  /**
   * @typedef {Object} ZohoReceiveLineItem
   * @property {String} line_item_id - Source line ID: the sales-return line for Receive Sales Return, or the purchase-order line for Receive Purchase Order
   * @property {Number} quantity - Quantity received against that line
   */

  /**
   * @operationName Receive Sales Return
   * @category Sales Returns
   * @description Records the physical receipt of returned goods against a sales return.
   * @route POST /receive-sales-return
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Sales Return ID","name":"salesReturnId","required":true,"dictionary":"listSalesReturnsDictionary","dependsOn":["organizationId"],"description":"Sales return being received against."}
   * @paramDef {"type":"String","label":"Receive Date","name":"date","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"Receipt date YYYY-MM-DD."}
   * @paramDef {"type":"Array<ZohoReceiveLineItem>","label":"Items","name":"items","required":true,"description":"Array of received lines: {line_item_id, quantity} — line_item_id is the sales-return line's ID and quantity is the amount received."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional notes."}
   * @returns {Object}
   * @sampleResult {"salesreturnreceive_id":"460000000060501","date":"2026-05-10"}
   */
  async receiveSalesReturn(organizationId, salesReturnId, date, items, notes) {
    if (!salesReturnId) {
      throw new Error('"Sales Return ID" is required')
    }

    if (!date) {
      throw new Error('"Receive Date" is required')
    }

    if (!Array.isArray(items) || items.length === 0) {
      throw new Error('"Items" must be a non-empty array')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const body = cleanupObject({
      date,
      notes,
      line_items: items.map(li => cleanupObject(li)),
    })

    const response = await this.#apiRequest({
      logTag: 'receiveSalesReturn',
      method: 'post',
      url: `${ this.#base() }/salesreturnreceives`,
      organizationId: orgId,
      query: { salesreturn_id: salesReturnId },
      body,
    })

    return response?.salesreturnreceive || response
  }

  // INVOICES

  /**
   * @operationName Create Invoice
   * @category Invoices
   * @description Creates an invoice for a customer. Optionally associates the invoice with a sales order via `salesorder_id` in extraFields.
   *
   * @route POST /create-invoice
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Customer","name":"customerId","required":true,"dictionary":"listContacts","dependsOn":["organizationId"],"description":"Customer being invoiced."}
   * @paramDef {"type":"Array<ZohoLineItem>","label":"Line Items","name":"lineItems","required":true,"description":"Array of invoice line items."}
   * @paramDef {"type":"String","label":"Invoice Number","name":"invoiceNumber","description":"Optional override; auto-numbered when omitted."}
   * @paramDef {"type":"String","label":"Date","name":"date","uiComponent":{"type":"DATE_PICKER"},"description":"Invoice date YYYY-MM-DD (defaults to today)."}
   * @paramDef {"type":"String","label":"Due Date","name":"dueDate","uiComponent":{"type":"DATE_PICKER"},"description":"Due date YYYY-MM-DD."}
   * @paramDef {"type":"String","label":"Reference Number","name":"referenceNumber","description":"Optional reference."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional notes."}
   * @paramDef {"type":"String","label":"Terms","name":"terms","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional terms text."}
   * @paramDef {"type":"Object","label":"Extra Fields","name":"extraFields","freeform":true,"description":"Additional fields merged into the body (salesorder_id, payment_terms, custom_fields, etc.)."}
   *
   * @returns {Object}
   * @sampleResult {"invoice_id":"460000000034037","invoice_number":"INV-000123","status":"draft","total":1250}
   */
  async createInvoice(organizationId, customerId, lineItems, invoiceNumber, date, dueDate, referenceNumber, notes, terms, extraFields) {
    if (!customerId) {
      throw new Error('"Customer" is required')
    }

    if (!Array.isArray(lineItems) || lineItems.length === 0) {
      throw new Error('"Line Items" must be a non-empty array')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const body = cleanupObject({
      customer_id: customerId,
      invoice_number: invoiceNumber,
      date: date || todayDate(),
      due_date: dueDate,
      reference_number: referenceNumber,
      notes,
      terms,
      line_items: lineItems.map(li => cleanupObject(li)),
      ...(extraFields && typeof extraFields === 'object' ? extraFields : {}),
    })

    const response = await this.#apiRequest({
      logTag: 'createInvoice',
      method: 'post',
      url: `${ this.#base() }/invoices`,
      organizationId: orgId,
      body,
    })

    return response?.invoice
  }

  /**
   * @operationName Get Invoice
   * @category Invoices
   * @description Retrieves an invoice with all fields, applied payments, and credit-note offsets. Use to inspect AR detail after listing or a payment trigger.
   * @route POST /get-invoice
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Invoice","name":"invoiceId","required":true,"dictionary":"listInvoicesDictionary","dependsOn":["organizationId"],"description":"Invoice to retrieve."}
   * @returns {Object}
   * @sampleResult {"invoice_id":"460000000034037","invoice_number":"INV-000123","balance":250}
   */
  async getInvoice(organizationId, invoiceId) {
    if (!invoiceId) {
      throw new Error('"Invoice" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const response = await this.#apiRequest({
      logTag: 'getInvoice',
      url: `${ this.#base() }/invoices/${ invoiceId }`,
      organizationId: orgId,
    })

    return response?.invoice
  }

  /**
   * @operationName Update Invoice
   * @category Invoices
   * @description Updates an invoice by merging supplied fields. Use when correcting or amending without re-sending the whole record. Some fields are immutable once the invoice is sent.
   * @route POST /update-invoice
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Invoice","name":"invoiceId","required":true,"dictionary":"listInvoicesDictionary","dependsOn":["organizationId"],"description":"Invoice to update."}
   * @paramDef {"type":"Object","label":"Fields","name":"fields","required":true,"freeform":true,"description":"Partial update: a JSON object of the documented fields to change on this record. Only the keys you include are modified."}
   * @returns {Object}
   * @sampleResult {"invoice_id":"460000000034037","status":"draft"}
   */
  async updateInvoice(organizationId, invoiceId, fields) {
    if (!invoiceId) {
      throw new Error('"Invoice" is required')
    }

    if (!fields || typeof fields !== 'object' || Object.keys(fields).length === 0) {
      throw new Error('"Fields" must be a non-empty object')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const response = await this.#apiRequest({
      logTag: 'updateInvoice',
      method: 'put',
      url: `${ this.#base() }/invoices/${ invoiceId }`,
      organizationId: orgId,
      body: cleanupObject(fields),
    })

    return response?.invoice
  }

  /**
   * @operationName Delete Invoice
   * @category Invoices
   * @description Permanently deletes an invoice. Use only for accidental drafts; for sent invoices use void instead so the audit trail is preserved.
   * @route POST /delete-invoice
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Invoice","name":"invoiceId","required":true,"dictionary":"listInvoicesDictionary","dependsOn":["organizationId"],"description":"Invoice to delete."}
   * @returns {Object}
   * @sampleResult {"code":0,"message":"The invoice has been deleted."}
   */
  async deleteInvoice(organizationId, invoiceId) {
    if (!invoiceId) {
      throw new Error('"Invoice" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    return this.#apiRequest({
      logTag: 'deleteInvoice',
      method: 'delete',
      url: `${ this.#base() }/invoices/${ invoiceId }`,
      organizationId: orgId,
    })
  }

  /**
   * @operationName Mark Invoice Sent
   * @category Invoices
   * @description Marks a draft invoice as sent without emailing it. Use when the invoice was delivered out-of-band (printed or exported) and you only need to advance status.
   * @route POST /mark-invoice-sent
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Invoice","name":"invoiceId","required":true,"dictionary":"listInvoicesDictionary","dependsOn":["organizationId"],"description":"Invoice to mark sent."}
   * @returns {Object}
   * @sampleResult {"code":0,"message":"The invoice has been marked as sent."}
   */
  async markInvoiceSent(organizationId, invoiceId) {
    if (!invoiceId) {
      throw new Error('"Invoice" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    return this.#apiRequest({
      logTag: 'markInvoiceSent',
      method: 'post',
      url: `${ this.#base() }/invoices/${ invoiceId }/status/sent`,
      organizationId: orgId,
    })
  }

  /**
   * @operationName Mark Invoice Void
   * @category Invoices
   * @description Voids an invoice so it no longer counts toward AR. Audit-safe alternative to deletion — use whenever an issued invoice was a mistake or will not be paid.
   * @route POST /mark-invoice-void
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Invoice","name":"invoiceId","required":true,"dictionary":"listInvoicesDictionary","dependsOn":["organizationId"],"description":"Invoice to void."}
   * @returns {Object}
   * @sampleResult {"code":0,"message":"The invoice has been marked as void."}
   */
  async markInvoiceVoid(organizationId, invoiceId) {
    if (!invoiceId) {
      throw new Error('"Invoice" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    return this.#apiRequest({
      logTag: 'markInvoiceVoid',
      method: 'post',
      url: `${ this.#base() }/invoices/${ invoiceId }/status/void`,
      organizationId: orgId,
    })
  }

  /**
   * @operationName Mark Invoice Draft
   * @category Invoices
   * @description Reverts an invoice back to draft status. Use to correct line items or details on an already-sent invoice before re-sending.
   * @route POST /mark-invoice-draft
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Invoice","name":"invoiceId","required":true,"dictionary":"listInvoicesDictionary","dependsOn":["organizationId"],"description":"Invoice to convert back to draft."}
   * @returns {Object}
   * @sampleResult {"code":0,"message":"The invoice has been marked as draft."}
   */
  async markInvoiceDraft(organizationId, invoiceId) {
    if (!invoiceId) {
      throw new Error('"Invoice" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    return this.#apiRequest({
      logTag: 'markInvoiceDraft',
      method: 'post',
      url: `${ this.#base() }/invoices/${ invoiceId }/status/draft`,
      organizationId: orgId,
    })
  }

  /**
   * @operationName Email Invoice
   * @category Invoices
   * @description Emails the invoice to one or more recipients with optional subject and body.
   * @route POST /email-invoice
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Invoice","name":"invoiceId","required":true,"dictionary":"listInvoicesDictionary","dependsOn":["organizationId"],"description":"Invoice to email."}
   * @paramDef {"type":"Array<String>","label":"To","name":"toAddresses","required":true,"description":"Array of recipient email addresses."}
   * @paramDef {"type":"Array<String>","label":"Cc","name":"ccAddresses","description":"Optional Cc addresses."}
   * @paramDef {"type":"String","label":"Subject","name":"subject","description":"Optional email subject."}
   * @paramDef {"type":"String","label":"Body","name":"body","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional email body."}
   * @paramDef {"type":"Boolean","label":"Send Customer Statement","name":"sendCustomerStatement","uiComponent":{"type":"TOGGLE"},"description":"Include the customer statement attachment."}
   * @returns {Object}
   * @sampleResult {"code":0,"message":"Your invoice has been emailed."}
   */
  async emailInvoice(organizationId, invoiceId, toAddresses, ccAddresses, subject, body, sendCustomerStatement) {
    if (!invoiceId) {
      throw new Error('"Invoice" is required')
    }

    if (!Array.isArray(toAddresses) || toAddresses.length === 0) {
      throw new Error('"To" must be a non-empty array of email addresses')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const payload = cleanupObject({
      to_mail_ids: toAddresses,
      cc_mail_ids: Array.isArray(ccAddresses) && ccAddresses.length > 0 ? ccAddresses : undefined,
      subject,
      body,
      send_customer_statement: typeof sendCustomerStatement === 'boolean' ? sendCustomerStatement : undefined,
    })

    return this.#apiRequest({
      logTag: 'emailInvoice',
      method: 'post',
      url: `${ this.#base() }/invoices/${ invoiceId }/email`,
      organizationId: orgId,
      body: payload,
    })
  }

  /**
   * @operationName Write Off Invoice
   * @category Invoices
   * @description Writes off an invoice's outstanding balance as bad debt.
   * @route POST /write-off-invoice
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Invoice","name":"invoiceId","required":true,"dictionary":"listInvoicesDictionary","dependsOn":["organizationId"],"description":"Invoice to write off."}
   * @returns {Object}
   * @sampleResult {"code":0,"message":"The invoice has been written off."}
   */
  async writeOffInvoice(organizationId, invoiceId) {
    if (!invoiceId) {
      throw new Error('"Invoice" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    return this.#apiRequest({
      logTag: 'writeOffInvoice',
      method: 'post',
      url: `${ this.#base() }/invoices/${ invoiceId }/writeoff`,
      organizationId: orgId,
    })
  }

  /**
   * @operationName List Invoices
   * @category Invoices
   * @description Lists invoices with status, customer, and date filters.
   * @route POST /list-invoices
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Draft","Sent","Overdue","Paid","Void","Unpaid","Partially Paid","Viewed"]}},"description":"Optional status filter."}
   * @paramDef {"type":"String","label":"Customer","name":"customerId","dictionary":"listContacts","dependsOn":["organizationId"],"description":"Optional customer filter."}
   * @paramDef {"type":"String","label":"Date Start","name":"dateStart","uiComponent":{"type":"DATE_PICKER"},"description":"Optional start date."}
   * @paramDef {"type":"String","label":"Date End","name":"dateEnd","uiComponent":{"type":"DATE_PICKER"},"description":"Optional end date."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page size 1-200."}
   * @paramDef {"type":"Boolean","label":"Fetch All","name":"fetchAll","uiComponent":{"type":"TOGGLE"},"description":"Auto-paginate."}
   * @returns {Object}
   * @sampleResult {"invoices":[{"invoice_id":"460000000034037"}]}
   */
  async listInvoices(organizationId, status, customerId, dateStart, dateEnd, page, perPage, fetchAll) {
    const orgId = this.#resolveOrganizationId(organizationId)

    status = this.#resolveChoice(status, INVOICE_STATUS_MAP)

    return this.#listEntities({
      logTag: 'listInvoices',
      url: `${ this.#base() }/invoices`,
      orgId,
      listKey: 'invoices',
      page,
      perPage,
      fetchAll,
      extraQuery: {
        status: status || undefined,
        customer_id: customerId || undefined,
        date_start: dateStart || undefined,
        date_end: dateEnd || undefined,
      },
    })
  }

  // CUSTOMER PAYMENTS + CREDIT NOTES

  /**
   * @typedef {Object} ZohoInvoiceApply
   * @property {String} invoice_id
   * @property {Number} amount_applied
   */

  /**
   * @operationName Record Customer Payment
   * @category Customer Payments
   * @description Records a customer payment and optionally applies it to one or more invoices.
   *
   * @route POST /create-customer-payment
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Customer","name":"customerId","required":true,"dictionary":"listContacts","dependsOn":["organizationId"],"description":"Paying customer."}
   * @paramDef {"type":"Number","label":"Amount","name":"amount","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Total payment amount."}
   * @paramDef {"type":"String","label":"Payment Mode","name":"paymentMode","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Cash","Check","Credit Card","Bank Transfer","Bank Remittance","Auto Transaction","Others"]}},"description":"Method of payment."}
   * @paramDef {"type":"String","label":"Date","name":"date","uiComponent":{"type":"DATE_PICKER"},"description":"Payment date YYYY-MM-DD (defaults to today)."}
   * @paramDef {"type":"String","label":"Reference Number","name":"referenceNumber","description":"Check/transaction reference."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional notes."}
   * @paramDef {"type":"Array<ZohoInvoiceApply>","label":"Apply To Invoices","name":"applyToInvoices","description":"Optional array of {invoice_id, amount_applied} entries."}
   * @paramDef {"type":"Object","label":"Extra Fields","name":"extraFields","freeform":true,"description":"Advanced: a JSON object of additional documented Zoho fields not exposed as parameters above (including custom_fields) merged into the request body. Leave empty for the common case."}
   *
   * @returns {Object}
   * @sampleResult {"payment_id":"460000000048011","customer_id":"460000000026049","amount":1250,"payment_mode":"banktransfer"}
   */
  async createCustomerPayment(organizationId, customerId, amount, paymentMode, date, referenceNumber, description, applyToInvoices, extraFields) {
    if (!customerId) {
      throw new Error('"Customer" is required')
    }

    if (amount === undefined || amount === null || amount === '' || isNaN(Number(amount))) {
      throw new Error('"Amount" is required and must be a number')
    }

    if (!paymentMode) {
      throw new Error('"Payment Mode" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const body = cleanupObject({
      customer_id: customerId,
      amount: Number(amount),
      payment_mode: this.#resolveChoice(paymentMode, PAYMENT_MODE_MAP),
      date: date || todayDate(),
      reference_number: referenceNumber,
      description,
      invoices: Array.isArray(applyToInvoices) && applyToInvoices.length > 0
        ? applyToInvoices.map(i => ({ invoice_id: i.invoice_id, amount_applied: Number(i.amount_applied) }))
        : undefined,
      ...(extraFields && typeof extraFields === 'object' ? extraFields : {}),
    })

    const response = await this.#apiRequest({
      logTag: 'createCustomerPayment',
      method: 'post',
      url: `${ this.#base() }/customerpayments`,
      organizationId: orgId,
      body,
    })

    return response?.payment
  }

  /**
   * @operationName Get Customer Payment
   * @category Customer Payments
   * @description Retrieves a customer payment record by ID. Use after listing/picker selection or a trigger event to read full details.
   * @route POST /get-customer-payment
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Payment ID","name":"paymentId","required":true,"dictionary":"listCustomerPaymentsDictionary","dependsOn":["organizationId"],"description":"Customer payment to retrieve."}
   * @returns {Object}
   * @sampleResult {"payment_id":"460000000048011","amount":1250}
   */
  async getCustomerPayment(organizationId, paymentId) {
    if (!paymentId) {
      throw new Error('"Payment ID" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const response = await this.#apiRequest({
      logTag: 'getCustomerPayment',
      url: `${ this.#base() }/customerpayments/${ paymentId }`,
      organizationId: orgId,
    })

    return response?.payment
  }

  /**
   * @operationName Update Customer Payment
   * @category Customer Payments
   * @description Updates a customer payment.
   * @route POST /update-customer-payment
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Payment ID","name":"paymentId","required":true,"dictionary":"listCustomerPaymentsDictionary","dependsOn":["organizationId"],"description":"Customer payment to update."}
   * @paramDef {"type":"Object","label":"Fields","name":"fields","required":true,"freeform":true,"description":"Partial update: a JSON object of the documented fields to change on this record. Only the keys you include are modified."}
   * @returns {Object}
   * @sampleResult {"payment_id":"460000000048011","amount":1250}
   */
  async updateCustomerPayment(organizationId, paymentId, fields) {
    if (!paymentId) {
      throw new Error('"Payment ID" is required')
    }

    if (!fields || typeof fields !== 'object' || Object.keys(fields).length === 0) {
      throw new Error('"Fields" must be a non-empty object')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const response = await this.#apiRequest({
      logTag: 'updateCustomerPayment',
      method: 'put',
      url: `${ this.#base() }/customerpayments/${ paymentId }`,
      organizationId: orgId,
      body: cleanupObject(fields),
    })

    return response?.payment
  }

  /**
   * @operationName Delete Customer Payment
   * @category Customer Payments
   * @description Permanently deletes a customer payment and releases any applied amounts back to the invoices. Use to correct mistakenly-recorded payments.
   * @route POST /delete-customer-payment
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Payment ID","name":"paymentId","required":true,"dictionary":"listCustomerPaymentsDictionary","dependsOn":["organizationId"],"description":"Customer payment to delete."}
   * @returns {Object}
   * @sampleResult {"code":0,"message":"The payment has been deleted."}
   */
  async deleteCustomerPayment(organizationId, paymentId) {
    if (!paymentId) {
      throw new Error('"Payment ID" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    return this.#apiRequest({
      logTag: 'deleteCustomerPayment',
      method: 'delete',
      url: `${ this.#base() }/customerpayments/${ paymentId }`,
      organizationId: orgId,
    })
  }

  /**
   * @operationName List Customer Payments
   * @category Customer Payments
   * @description Lists customer payments with optional customer and date filters.
   * @route POST /list-customer-payments
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Customer","name":"customerId","dictionary":"listContacts","dependsOn":["organizationId"],"description":"Optional customer filter."}
   * @paramDef {"type":"String","label":"Date Start","name":"dateStart","uiComponent":{"type":"DATE_PICKER"},"description":"Optional start date."}
   * @paramDef {"type":"String","label":"Date End","name":"dateEnd","uiComponent":{"type":"DATE_PICKER"},"description":"Optional end date."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page size 1-200."}
   * @paramDef {"type":"Boolean","label":"Fetch All","name":"fetchAll","uiComponent":{"type":"TOGGLE"},"description":"Auto-paginate."}
   * @returns {Object}
   * @sampleResult {"customerpayments":[{"payment_id":"460000000048011","amount":1250}]}
   */
  async listCustomerPayments(organizationId, customerId, dateStart, dateEnd, page, perPage, fetchAll) {
    const orgId = this.#resolveOrganizationId(organizationId)

    return this.#listEntities({
      logTag: 'listCustomerPayments',
      url: `${ this.#base() }/customerpayments`,
      orgId,
      listKey: 'customerpayments',
      page,
      perPage,
      fetchAll,
      extraQuery: {
        customer_id: customerId || undefined,
        date_start: dateStart || undefined,
        date_end: dateEnd || undefined,
      },
    })
  }

  /**
   * @operationName Create Credit Note
   * @category Credit Notes
   * @description Creates a credit note for a customer (used for returns or goodwill).
   * @route POST /create-credit-note
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Customer","name":"customerId","required":true,"dictionary":"listContacts","dependsOn":["organizationId"],"description":"Customer being credited."}
   * @paramDef {"type":"Array<ZohoLineItem>","label":"Line Items","name":"lineItems","required":true,"description":"Array of credit note line items."}
   * @paramDef {"type":"String","label":"Date","name":"date","uiComponent":{"type":"DATE_PICKER"},"description":"Credit note date YYYY-MM-DD (defaults to today)."}
   * @paramDef {"type":"String","label":"Reference Number","name":"referenceNumber","description":"Optional reference."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional notes."}
   * @paramDef {"type":"Object","label":"Extra Fields","name":"extraFields","freeform":true,"description":"Advanced: a JSON object of additional documented Zoho fields not exposed as parameters above (including custom_fields) merged into the request body. Leave empty for the common case."}
   * @returns {Object}
   * @sampleResult {"creditnote_id":"460000000070033","creditnote_number":"CN-001","status":"open","total":300}
   */
  async createCreditNote(organizationId, customerId, lineItems, date, referenceNumber, notes, extraFields) {
    if (!customerId) {
      throw new Error('"Customer" is required')
    }

    if (!Array.isArray(lineItems) || lineItems.length === 0) {
      throw new Error('"Line Items" must be a non-empty array')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const body = cleanupObject({
      customer_id: customerId,
      date: date || todayDate(),
      reference_number: referenceNumber,
      notes,
      line_items: lineItems.map(li => cleanupObject(li)),
      ...(extraFields && typeof extraFields === 'object' ? extraFields : {}),
    })

    const response = await this.#apiRequest({
      logTag: 'createCreditNote',
      method: 'post',
      url: `${ this.#base() }/creditnotes`,
      organizationId: orgId,
      body,
    })

    return response?.creditnote
  }

  /**
   * @operationName Get Credit Note
   * @category Credit Notes
   * @description Retrieves a credit note with line items, application history, and refunds. Use to inspect credit-note state.
   * @route POST /get-credit-note
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Credit Note ID","name":"creditNoteId","required":true,"dictionary":"listCreditNotesDictionary","dependsOn":["organizationId"],"description":"Credit note to retrieve."}
   * @returns {Object}
   * @sampleResult {"creditnote_id":"460000000070033","status":"open"}
   */
  async getCreditNote(organizationId, creditNoteId) {
    if (!creditNoteId) {
      throw new Error('"Credit Note ID" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const response = await this.#apiRequest({
      logTag: 'getCreditNote',
      url: `${ this.#base() }/creditnotes/${ creditNoteId }`,
      organizationId: orgId,
    })

    return response?.creditnote
  }

  /**
   * @operationName Update Credit Note
   * @category Credit Notes
   * @description Updates a credit note by merging supplied fields. Use when correcting or amending without re-sending the whole record.
   * @route POST /update-credit-note
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Credit Note ID","name":"creditNoteId","required":true,"dictionary":"listCreditNotesDictionary","dependsOn":["organizationId"],"description":"Credit note to update."}
   * @paramDef {"type":"Object","label":"Fields","name":"fields","required":true,"freeform":true,"description":"Partial update: a JSON object of the documented fields to change on this record. Only the keys you include are modified."}
   * @returns {Object}
   * @sampleResult {"creditnote_id":"460000000070033","status":"open"}
   */
  async updateCreditNote(organizationId, creditNoteId, fields) {
    if (!creditNoteId) {
      throw new Error('"Credit Note ID" is required')
    }

    if (!fields || typeof fields !== 'object' || Object.keys(fields).length === 0) {
      throw new Error('"Fields" must be a non-empty object')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const response = await this.#apiRequest({
      logTag: 'updateCreditNote',
      method: 'put',
      url: `${ this.#base() }/creditnotes/${ creditNoteId }`,
      organizationId: orgId,
      body: cleanupObject(fields),
    })

    return response?.creditnote
  }

  /**
   * @operationName Delete Credit Note
   * @category Credit Notes
   * @description Permanently deletes a credit note. Cannot be undone; for applied credits, unapply or void so the audit trail survives. Cannot be undone; for applied credits, unapply or void instead so the audit trail survives.
   * @route POST /delete-credit-note
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Credit Note ID","name":"creditNoteId","required":true,"dictionary":"listCreditNotesDictionary","dependsOn":["organizationId"],"description":"Credit note to delete."}
   * @returns {Object}
   * @sampleResult {"code":0,"message":"The credit note has been deleted."}
   */
  async deleteCreditNote(organizationId, creditNoteId) {
    if (!creditNoteId) {
      throw new Error('"Credit Note ID" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    return this.#apiRequest({
      logTag: 'deleteCreditNote',
      method: 'delete',
      url: `${ this.#base() }/creditnotes/${ creditNoteId }`,
      organizationId: orgId,
    })
  }

  /**
   * @operationName Apply Credit Note To Invoices
   * @category Credit Notes
   * @description Applies all or part of a credit note to one or more invoices.
   * @route POST /apply-credit-note
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Credit Note ID","name":"creditNoteId","required":true,"dictionary":"listCreditNotesDictionary","dependsOn":["organizationId"],"description":"Credit note to apply."}
   * @paramDef {"type":"Array<ZohoInvoiceApply>","label":"Invoices","name":"invoices","required":true,"description":"Array of {invoice_id, amount_applied} entries."}
   * @returns {Object}
   * @sampleResult {"code":0,"message":"Credits have been applied to the invoice(s)."}
   */
  async applyCreditNoteToInvoices(organizationId, creditNoteId, invoices) {
    if (!creditNoteId) {
      throw new Error('"Credit Note ID" is required')
    }

    if (!Array.isArray(invoices) || invoices.length === 0) {
      throw new Error('"Invoices" must be a non-empty array')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    return this.#apiRequest({
      logTag: 'applyCreditNoteToInvoices',
      method: 'post',
      url: `${ this.#base() }/creditnotes/${ creditNoteId }/invoices`,
      organizationId: orgId,
      body: { invoices: invoices.map(i => ({ invoice_id: i.invoice_id, amount_applied: Number(i.amount_applied) })) },
    })
  }

  /**
   * @operationName List Credit Notes
   * @category Credit Notes
   * @description Lists credit notes.
   * @route POST /list-credit-notes
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Customer","name":"customerId","dictionary":"listContacts","dependsOn":["organizationId"],"description":"Optional customer filter."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Draft","Open","Closed","Void"]}},"description":"Optional status filter."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page size 1-200."}
   * @paramDef {"type":"Boolean","label":"Fetch All","name":"fetchAll","uiComponent":{"type":"TOGGLE"},"description":"Auto-paginate."}
   * @returns {Object}
   * @sampleResult {"creditnotes":[{"creditnote_id":"460000000070033"}]}
   */
  async listCreditNotes(organizationId, customerId, status, page, perPage, fetchAll) {
    const orgId = this.#resolveOrganizationId(organizationId)

    status = this.#resolveChoice(status, CREDIT_STATUS_MAP)

    return this.#listEntities({
      logTag: 'listCreditNotes',
      url: `${ this.#base() }/creditnotes`,
      orgId,
      listKey: 'creditnotes',
      page,
      perPage,
      fetchAll,
      extraQuery: {
        customer_id: customerId || undefined,
        status: status || undefined,
      },
    })
  }
  // PURCHASE ORDERS + PURCHASE RECEIVES

  /**
   * @operationName Create Purchase Order
   * @category Purchase Orders
   * @description Creates a purchase order against a vendor with one or more line items.
   *
   * @route POST /create-purchase-order
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Vendor","name":"vendorId","required":true,"dictionary":"listContacts","dependsOn":["organizationId"],"description":"Vendor being ordered from."}
   * @paramDef {"type":"Array<ZohoLineItem>","label":"Line Items","name":"lineItems","required":true,"description":"Array of PO line items {item_id, quantity, rate?}. The unit cost (rate) is sent to Zoho as purchase_rate."}
   * @paramDef {"type":"String","label":"PO Number","name":"purchaseOrderNumber","description":"Optional override; auto-numbered when omitted."}
   * @paramDef {"type":"String","label":"Reference Number","name":"referenceNumber","description":"Optional reference."}
   * @paramDef {"type":"String","label":"Date","name":"date","uiComponent":{"type":"DATE_PICKER"},"description":"PO date YYYY-MM-DD (defaults to today)."}
   * @paramDef {"type":"String","label":"Expected Delivery Date","name":"deliveryDate","uiComponent":{"type":"DATE_PICKER"},"description":"Expected delivery YYYY-MM-DD."}
   * @paramDef {"type":"String","label":"Location","name":"locationId","dictionary":"listLocations","dependsOn":["organizationId"],"description":"Optional location to receive into."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional notes."}
   * @paramDef {"type":"String","label":"Terms","name":"terms","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional terms."}
   * @paramDef {"type":"Object","label":"Extra Fields","name":"extraFields","freeform":true,"description":"Advanced: a JSON object of additional documented Zoho fields not exposed as parameters above (including custom_fields) merged into the request body. Leave empty for the common case."}
   *
   * @returns {Object}
   * @sampleResult {"purchaseorder_id":"460000000038099","purchaseorder_number":"PO-007","status":"draft","total":480}
   */
  async createPurchaseOrder(organizationId, vendorId, lineItems, purchaseOrderNumber, referenceNumber, date, deliveryDate, locationId, notes, terms, extraFields) {
    if (!vendorId) {
      throw new Error('"Vendor" is required')
    }

    if (!Array.isArray(lineItems) || lineItems.length === 0) {
      throw new Error('"Line Items" must be a non-empty array')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const body = cleanupObject({
      vendor_id: vendorId,
      purchaseorder_number: purchaseOrderNumber,
      reference_number: referenceNumber,
      date: date || todayDate(),
      delivery_date: deliveryDate,
      location_id: locationId,
      notes,
      terms,
      // Zoho purchase-order line items use `purchase_rate` for the unit cost, not `rate`.
      // Accept either from the caller and emit purchase_rate so the price isn't silently dropped.
      line_items: lineItems.map(li => cleanupObject({
        ...li,
        purchase_rate: li.purchase_rate ?? li.rate,
      })),
      ...(extraFields && typeof extraFields === 'object' ? extraFields : {}),
    })

    const response = await this.#apiRequest({
      logTag: 'createPurchaseOrder',
      method: 'post',
      url: `${ this.#base() }/purchaseorders`,
      organizationId: orgId,
      body,
    })

    return response?.purchaseorder
  }

  /**
   * @operationName Get Purchase Order
   * @category Purchase Orders
   * @description Retrieves a purchase order with line items, vendor info, and status. Use after listing or a trigger event for full detail.
   * @route POST /get-purchase-order
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Purchase Order","name":"purchaseOrderId","required":true,"dictionary":"listPurchaseOrdersDictionary","dependsOn":["organizationId"],"description":"Purchase order to retrieve."}
   * @returns {Object}
   * @sampleResult {"purchaseorder_id":"460000000038099","status":"open"}
   */
  async getPurchaseOrder(organizationId, purchaseOrderId) {
    if (!purchaseOrderId) {
      throw new Error('"Purchase Order" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const response = await this.#apiRequest({
      logTag: 'getPurchaseOrder',
      url: `${ this.#base() }/purchaseorders/${ purchaseOrderId }`,
      organizationId: orgId,
    })

    return response?.purchaseorder
  }

  /**
   * @operationName Update Purchase Order
   * @category Purchase Orders
   * @description Updates a purchase order by merging supplied fields. Use when correcting or amending without re-sending the whole record.
   * @route POST /update-purchase-order
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Purchase Order","name":"purchaseOrderId","required":true,"dictionary":"listPurchaseOrdersDictionary","dependsOn":["organizationId"],"description":"Purchase order to update."}
   * @paramDef {"type":"Object","label":"Fields","name":"fields","required":true,"freeform":true,"description":"Partial update: a JSON object of the documented fields to change on this record. Only the keys you include are modified."}
   * @returns {Object}
   * @sampleResult {"purchaseorder_id":"460000000038099","status":"open"}
   */
  async updatePurchaseOrder(organizationId, purchaseOrderId, fields) {
    if (!purchaseOrderId) {
      throw new Error('"Purchase Order" is required')
    }

    if (!fields || typeof fields !== 'object' || Object.keys(fields).length === 0) {
      throw new Error('"Fields" must be a non-empty object')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const response = await this.#apiRequest({
      logTag: 'updatePurchaseOrder',
      method: 'put',
      url: `${ this.#base() }/purchaseorders/${ purchaseOrderId }`,
      organizationId: orgId,
      body: cleanupObject(fields),
    })

    return response?.purchaseorder
  }

  /**
   * @operationName Delete Purchase Order
   * @category Purchase Orders
   * @description Permanently deletes a purchase order. Use for draft PO cleanup; for issued POs cancel via Mark PO Cancelled first.
   * @route POST /delete-purchase-order
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Purchase Order","name":"purchaseOrderId","required":true,"dictionary":"listPurchaseOrdersDictionary","dependsOn":["organizationId"],"description":"Purchase order to delete."}
   * @returns {Object}
   * @sampleResult {"code":0,"message":"The purchase order has been deleted."}
   */
  async deletePurchaseOrder(organizationId, purchaseOrderId) {
    if (!purchaseOrderId) {
      throw new Error('"Purchase Order" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    return this.#apiRequest({
      logTag: 'deletePurchaseOrder',
      method: 'delete',
      url: `${ this.#base() }/purchaseorders/${ purchaseOrderId }`,
      organizationId: orgId,
    })
  }

  /**
   * @operationName Mark PO Issued
   * @category Purchase Orders
   * @description Issues a draft PO so it can receive goods against it. Use once the PO has been approved internally and the vendor delivery is expected.
   * @route POST /mark-po-issued
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Purchase Order","name":"purchaseOrderId","required":true,"dictionary":"listPurchaseOrdersDictionary","dependsOn":["organizationId"],"description":"PO to issue."}
   * @returns {Object}
   * @sampleResult {"code":0,"message":"The purchase order has been issued."}
   */
  async markPurchaseOrderIssued(organizationId, purchaseOrderId) {
    if (!purchaseOrderId) {
      throw new Error('"Purchase Order" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    return this.#apiRequest({
      logTag: 'markPurchaseOrderIssued',
      method: 'post',
      url: `${ this.#base() }/purchaseorders/${ purchaseOrderId }/status/issued`,
      organizationId: orgId,
    })
  }

  /**
   * @operationName Mark PO Cancelled
   * @category Purchase Orders
   * @description Cancels an issued PO so it no longer expects deliveries. Use when a vendor order falls through or the order is no longer needed.
   * @route POST /mark-po-cancelled
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Purchase Order","name":"purchaseOrderId","required":true,"dictionary":"listPurchaseOrdersDictionary","dependsOn":["organizationId"],"description":"PO to cancel."}
   * @returns {Object}
   * @sampleResult {"code":0,"message":"The purchase order has been cancelled."}
   */
  async markPurchaseOrderCancelled(organizationId, purchaseOrderId) {
    if (!purchaseOrderId) {
      throw new Error('"Purchase Order" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    return this.#apiRequest({
      logTag: 'markPurchaseOrderCancelled',
      method: 'post',
      url: `${ this.#base() }/purchaseorders/${ purchaseOrderId }/status/cancelled`,
      organizationId: orgId,
    })
  }

  /**
   * @operationName List Purchase Orders
   * @category Purchase Orders
   * @description Lists purchase orders with optional filters.
   * @route POST /list-purchase-orders
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Draft","Open","Billed","Partially Billed","Cancelled","Closed"]}},"description":"Optional status filter."}
   * @paramDef {"type":"String","label":"Vendor","name":"vendorId","dictionary":"listContacts","dependsOn":["organizationId"],"description":"Optional vendor filter."}
   * @paramDef {"type":"String","label":"Date Start","name":"dateStart","uiComponent":{"type":"DATE_PICKER"},"description":"Optional start date."}
   * @paramDef {"type":"String","label":"Date End","name":"dateEnd","uiComponent":{"type":"DATE_PICKER"},"description":"Optional end date."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page size 1-200."}
   * @paramDef {"type":"Boolean","label":"Fetch All","name":"fetchAll","uiComponent":{"type":"TOGGLE"},"description":"Auto-paginate."}
   * @returns {Object}
   * @sampleResult {"purchaseorders":[{"purchaseorder_id":"460000000038099"}]}
   */
  async listPurchaseOrders(organizationId, status, vendorId, dateStart, dateEnd, page, perPage, fetchAll) {
    const orgId = this.#resolveOrganizationId(organizationId)

    status = this.#resolveChoice(status, PURCHASE_ORDER_STATUS_MAP)

    return this.#listEntities({
      logTag: 'listPurchaseOrders',
      url: `${ this.#base() }/purchaseorders`,
      orgId,
      listKey: 'purchaseorders',
      page,
      perPage,
      fetchAll,
      extraQuery: {
        status: status || undefined,
        vendor_id: vendorId || undefined,
        date_start: dateStart || undefined,
        date_end: dateEnd || undefined,
      },
    })
  }

  /**
   * @operationName Receive Purchase Order
   * @category Purchase Orders
   * @description Records the physical receipt of items against a purchase order. Receives are separate from bills (financial liability).
   *
   * @route POST /receive-purchase-order
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Purchase Order","name":"purchaseOrderId","required":true,"dictionary":"listPurchaseOrdersDictionary","dependsOn":["organizationId"],"description":"PO being received against."}
   * @paramDef {"type":"String","label":"Date","name":"date","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"Receipt date YYYY-MM-DD."}
   * @paramDef {"type":"Array<ZohoReceiveLineItem>","label":"Line Items","name":"lineItems","required":true,"description":"Array of received lines: {line_item_id, quantity} — line_item_id is the purchase-order line's ID and quantity is the amount received."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional notes."}
   * @paramDef {"type":"String","label":"Receive Number","name":"receiveNumber","description":"Optional receive number. Required only if the organization has disabled auto-numbering for purchase receives; otherwise leave blank to auto-number."}
   * @paramDef {"type":"Object","label":"Extra Fields","name":"extraFields","freeform":true,"description":"Advanced: a JSON object of additional documented Zoho fields not exposed as parameters above (including custom_fields) merged into the request body. Leave empty for the common case."}
   *
   * @returns {Object}
   * @sampleResult {"purchasereceive_id":"460000000039001","receive_number":"PR-00001","date":"2026-05-10"}
   */
  async receivePurchaseOrder(organizationId, purchaseOrderId, date, lineItems, notes, receiveNumber, extraFields) {
    if (!purchaseOrderId) {
      throw new Error('"Purchase Order" is required')
    }

    if (!date) {
      throw new Error('"Date" is required')
    }

    if (!Array.isArray(lineItems) || lineItems.length === 0) {
      throw new Error('"Line Items" must be a non-empty array')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const body = cleanupObject({
      date,
      notes,
      receive_number: receiveNumber,
      line_items: lineItems.map(li => cleanupObject(li)),
      ...(extraFields && typeof extraFields === 'object' ? extraFields : {}),
    })

    const response = await this.#apiRequest({
      logTag: 'receivePurchaseOrder',
      method: 'post',
      url: `${ this.#base() }/purchasereceives`,
      organizationId: orgId,
      query: { purchaseorder_id: purchaseOrderId },
      body,
    })

    return response?.purchasereceive || response
  }

  /**
   * @operationName Get Purchase Receive
   * @category Purchase Orders
   * @description Retrieves a purchase receive record by ID. Use after listing/picker selection or a trigger event to read full details.
   * @route POST /get-purchase-receive
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Receive ID","name":"receiveId","required":true,"freeform":true,"description":"Purchase receive ID (returned by Receive Purchase Order). Purchase receive toretrieve."}
   * @returns {Object}
   * @sampleResult {"purchasereceive_id":"460000000039001"}
   */
  async getPurchaseReceive(organizationId, receiveId) {
    if (!receiveId) {
      throw new Error('"Receive ID" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const response = await this.#apiRequest({
      logTag: 'getPurchaseReceive',
      url: `${ this.#base() }/purchasereceives/${ receiveId }`,
      organizationId: orgId,
    })

    return response?.purchasereceive
  }

  /**
   * @operationName Delete Purchase Receive
   * @category Purchase Orders
   * @description Permanently deletes a purchase receive record.
   * @route POST /delete-purchase-receive
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Receive ID","name":"receiveId","required":true,"freeform":true,"description":"Purchase receive ID (returned by Receive Purchase Order). Purchase receive todelete."}
   * @returns {Object}
   * @sampleResult {"code":0,"message":"The purchase receive has been deleted."}
   */
  async deletePurchaseReceive(organizationId, receiveId) {
    if (!receiveId) {
      throw new Error('"Receive ID" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    return this.#apiRequest({
      logTag: 'deletePurchaseReceive',
      method: 'delete',
      url: `${ this.#base() }/purchasereceives/${ receiveId }`,
      organizationId: orgId,
    })
  }

  // BILLS + VENDOR PAYMENTS + VENDOR CREDITS

  /**
   * @operationName Create Bill
   * @category Bills
   * @description Creates a vendor bill recording purchases received. Optionally references a PO via extraFields.purchaseorder_ids.
   *
   * @route POST /create-bill
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Vendor","name":"vendorId","required":true,"dictionary":"listContacts","dependsOn":["organizationId"],"description":"Vendor billing the purchase."}
   * @paramDef {"type":"Array<ZohoLineItem>","label":"Line Items","name":"lineItems","required":true,"description":"Array of bill line items."}
   * @paramDef {"type":"String","label":"Bill Number","name":"billNumber","description":"Vendor's invoice/bill number."}
   * @paramDef {"type":"String","label":"Date","name":"date","uiComponent":{"type":"DATE_PICKER"},"description":"Bill date YYYY-MM-DD (defaults to today)."}
   * @paramDef {"type":"String","label":"Due Date","name":"dueDate","uiComponent":{"type":"DATE_PICKER"},"description":"Due date YYYY-MM-DD."}
   * @paramDef {"type":"String","label":"Reference Number","name":"referenceNumber","description":"Optional reference."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional notes."}
   * @paramDef {"type":"Object","label":"Extra Fields","name":"extraFields","freeform":true,"description":"Additional fields merged into the body (purchaseorder_ids, custom_fields, etc.)."}
   *
   * @returns {Object}
   * @sampleResult {"bill_id":"460000000038099","bill_number":"BILL-007","status":"open","total":480}
   */
  async createBill(organizationId, vendorId, lineItems, billNumber, date, dueDate, referenceNumber, notes, extraFields) {
    if (!vendorId) {
      throw new Error('"Vendor" is required')
    }

    if (!Array.isArray(lineItems) || lineItems.length === 0) {
      throw new Error('"Line Items" must be a non-empty array')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const body = cleanupObject({
      vendor_id: vendorId,
      bill_number: billNumber,
      date: date || todayDate(),
      due_date: dueDate,
      reference_number: referenceNumber,
      notes,
      line_items: lineItems.map(li => cleanupObject(li)),
      ...(extraFields && typeof extraFields === 'object' ? extraFields : {}),
    })

    const response = await this.#apiRequest({
      logTag: 'createBill',
      method: 'post',
      url: `${ this.#base() }/bills`,
      organizationId: orgId,
      body,
    })

    return response?.bill
  }

  /**
   * @operationName Get Bill
   * @category Bills
   * @description Retrieves a vendor bill with line items, payment history, and status. Use after listing or a trigger event for full detail.
   * @route POST /get-bill
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Bill","name":"billId","required":true,"dictionary":"listBillsDictionary","dependsOn":["organizationId"],"description":"Bill to retrieve."}
   * @returns {Object}
   * @sampleResult {"bill_id":"460000000038099","status":"open"}
   */
  async getBill(organizationId, billId) {
    if (!billId) {
      throw new Error('"Bill" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const response = await this.#apiRequest({
      logTag: 'getBill',
      url: `${ this.#base() }/bills/${ billId }`,
      organizationId: orgId,
    })

    return response?.bill
  }

  /**
   * @operationName Update Bill
   * @category Bills
   * @description Updates a bill by merging supplied fields. Use when correcting or amending without re-sending the whole record.
   * @route POST /update-bill
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Bill","name":"billId","required":true,"dictionary":"listBillsDictionary","dependsOn":["organizationId"],"description":"Bill to update."}
   * @paramDef {"type":"Object","label":"Fields","name":"fields","required":true,"freeform":true,"description":"Partial update: a JSON object of the documented fields to change on this record. Only the keys you include are modified."}
   * @returns {Object}
   * @sampleResult {"bill_id":"460000000038099","status":"open"}
   */
  async updateBill(organizationId, billId, fields) {
    if (!billId) {
      throw new Error('"Bill" is required')
    }

    if (!fields || typeof fields !== 'object' || Object.keys(fields).length === 0) {
      throw new Error('"Fields" must be a non-empty object')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const response = await this.#apiRequest({
      logTag: 'updateBill',
      method: 'put',
      url: `${ this.#base() }/bills/${ billId }`,
      organizationId: orgId,
      body: cleanupObject(fields),
    })

    return response?.bill
  }

  /**
   * @operationName Delete Bill
   * @category Bills
   * @description Permanently deletes a bill. Use for draft cleanup; for posted bills void via Mark Bill Void to preserve the audit trail.
   * @route POST /delete-bill
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Bill","name":"billId","required":true,"dictionary":"listBillsDictionary","dependsOn":["organizationId"],"description":"Bill to delete."}
   * @returns {Object}
   * @sampleResult {"code":0,"message":"The bill has been deleted."}
   */
  async deleteBill(organizationId, billId) {
    if (!billId) {
      throw new Error('"Bill" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    return this.#apiRequest({
      logTag: 'deleteBill',
      method: 'delete',
      url: `${ this.#base() }/bills/${ billId }`,
      organizationId: orgId,
    })
  }

  /**
   * @operationName Mark Bill Open
   * @category Bills
   * @description Marks a draft bill as open and ready to pay. Use when finalizing a vendor bill staged via createBill in draft mode.
   * @route POST /mark-bill-open
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Bill","name":"billId","required":true,"dictionary":"listBillsDictionary","dependsOn":["organizationId"],"description":"Bill to mark open."}
   * @returns {Object}
   * @sampleResult {"code":0,"message":"The bill has been marked as open."}
   */
  async markBillOpen(organizationId, billId) {
    if (!billId) {
      throw new Error('"Bill" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    return this.#apiRequest({
      logTag: 'markBillOpen',
      method: 'post',
      url: `${ this.#base() }/bills/${ billId }/status/open`,
      organizationId: orgId,
    })
  }

  /**
   * @operationName Mark Bill Void
   * @category Bills
   * @description Voids a vendor bill so it no longer counts toward AP. Use as the audit-safe alternative to deletion when a posted bill will not be paid.
   * @route POST /mark-bill-void
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Bill","name":"billId","required":true,"dictionary":"listBillsDictionary","dependsOn":["organizationId"],"description":"Bill to void."}
   * @returns {Object}
   * @sampleResult {"code":0,"message":"The bill has been marked as void."}
   */
  async markBillVoid(organizationId, billId) {
    if (!billId) {
      throw new Error('"Bill" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    return this.#apiRequest({
      logTag: 'markBillVoid',
      method: 'post',
      url: `${ this.#base() }/bills/${ billId }/status/void`,
      organizationId: orgId,
    })
  }

  /**
   * @operationName List Bills
   * @category Bills
   * @description Lists vendor bills with optional filters.
   * @route POST /list-bills
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Open","Paid","Void","Draft","Overdue","Unpaid","Partially Paid"]}},"description":"Optional status filter."}
   * @paramDef {"type":"String","label":"Vendor","name":"vendorId","dictionary":"listContacts","dependsOn":["organizationId"],"description":"Optional vendor filter."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page size 1-200."}
   * @paramDef {"type":"Boolean","label":"Fetch All","name":"fetchAll","uiComponent":{"type":"TOGGLE"},"description":"Auto-paginate."}
   * @returns {Object}
   * @sampleResult {"bills":[{"bill_id":"460000000038099"}]}
   */
  async listBills(organizationId, status, vendorId, page, perPage, fetchAll) {
    const orgId = this.#resolveOrganizationId(organizationId)

    status = this.#resolveChoice(status, BILL_STATUS_MAP)

    return this.#listEntities({
      logTag: 'listBills',
      url: `${ this.#base() }/bills`,
      orgId,
      listKey: 'bills',
      page,
      perPage,
      fetchAll,
      extraQuery: {
        status: status || undefined,
        vendor_id: vendorId || undefined,
      },
    })
  }

  /**
   * @typedef {Object} ZohoBillApply
   * @property {String} bill_id
   * @property {Number} amount_applied
   */

  /**
   * @operationName Record Vendor Payment
   * @category Vendor Payments
   * @description Records a vendor payment and optionally applies it to one or more bills.
   * @route POST /create-vendor-payment
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Vendor","name":"vendorId","required":true,"dictionary":"listContacts","dependsOn":["organizationId"],"description":"Vendor being paid."}
   * @paramDef {"type":"Number","label":"Amount","name":"amount","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Total payment amount."}
   * @paramDef {"type":"String","label":"Payment Mode","name":"paymentMode","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Cash","Check","Credit Card","Bank Transfer","Bank Remittance","Auto Transaction","Others"]}},"description":"Method of payment."}
   * @paramDef {"type":"String","label":"Date","name":"date","uiComponent":{"type":"DATE_PICKER"},"description":"Payment date YYYY-MM-DD (defaults to today)."}
   * @paramDef {"type":"String","label":"Reference Number","name":"referenceNumber","description":"Optional reference."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional notes."}
   * @paramDef {"type":"Array<ZohoBillApply>","label":"Apply To Bills","name":"applyToBills","description":"Optional array of {bill_id, amount_applied}."}
   * @paramDef {"type":"Object","label":"Extra Fields","name":"extraFields","freeform":true,"description":"Advanced: a JSON object of additional documented Zoho fields not exposed as parameters above (including custom_fields) merged into the request body. Leave empty for the common case."}
   * @returns {Object}
   * @sampleResult {"payment_id":"460000000049011","vendor_id":"460000000026099","amount":480,"payment_mode":"banktransfer"}
   */
  async createVendorPayment(organizationId, vendorId, amount, paymentMode, date, referenceNumber, description, applyToBills, extraFields) {
    if (!vendorId) {
      throw new Error('"Vendor" is required')
    }

    if (amount === undefined || amount === null || amount === '' || isNaN(Number(amount))) {
      throw new Error('"Amount" is required and must be a number')
    }

    if (!paymentMode) {
      throw new Error('"Payment Mode" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const body = cleanupObject({
      vendor_id: vendorId,
      amount: Number(amount),
      payment_mode: this.#resolveChoice(paymentMode, PAYMENT_MODE_MAP),
      date: date || todayDate(),
      reference_number: referenceNumber,
      description,
      bills: Array.isArray(applyToBills) && applyToBills.length > 0
        ? applyToBills.map(b => ({ bill_id: b.bill_id, amount_applied: Number(b.amount_applied) }))
        : undefined,
      ...(extraFields && typeof extraFields === 'object' ? extraFields : {}),
    })

    const response = await this.#apiRequest({
      logTag: 'createVendorPayment',
      method: 'post',
      url: `${ this.#base() }/vendorpayments`,
      organizationId: orgId,
      body,
    })

    return response?.payment || response?.vendor_payment || response?.vendorpayment || response
  }

  /**
   * @operationName Get Vendor Payment
   * @category Vendor Payments
   * @description Retrieves a vendor payment with applied bill breakdown. Use to inspect AP disbursement detail.
   * @route POST /get-vendor-payment
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Payment ID","name":"paymentId","required":true,"dictionary":"listVendorPaymentsDictionary","dependsOn":["organizationId"],"description":"Vendor payment to retrieve."}
   * @returns {Object}
   * @sampleResult {"payment_id":"460000000049011","amount":480}
   */
  async getVendorPayment(organizationId, paymentId) {
    if (!paymentId) {
      throw new Error('"Payment ID" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const response = await this.#apiRequest({
      logTag: 'getVendorPayment',
      url: `${ this.#base() }/vendorpayments/${ paymentId }`,
      organizationId: orgId,
    })

    return response?.payment || response?.vendor_payment || response?.vendorpayment || response
  }

  /**
   * @operationName Delete Vendor Payment
   * @category Vendor Payments
   * @description Permanently deletes a vendor payment and releases any applied amounts back to the bills. Use to correct a mistakenly-recorded payment.
   * @route POST /delete-vendor-payment
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Payment ID","name":"paymentId","required":true,"dictionary":"listVendorPaymentsDictionary","dependsOn":["organizationId"],"description":"Vendor payment to delete."}
   * @returns {Object}
   * @sampleResult {"code":0,"message":"The payment has been deleted."}
   */
  async deleteVendorPayment(organizationId, paymentId) {
    if (!paymentId) {
      throw new Error('"Payment ID" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    return this.#apiRequest({
      logTag: 'deleteVendorPayment',
      method: 'delete',
      url: `${ this.#base() }/vendorpayments/${ paymentId }`,
      organizationId: orgId,
    })
  }

  /**
   * @operationName List Vendor Payments
   * @category Vendor Payments
   * @description Lists vendor payments with optional vendor and date filters.
   * @route POST /list-vendor-payments
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Vendor","name":"vendorId","dictionary":"listContacts","dependsOn":["organizationId"],"description":"Optional vendor filter."}
   * @paramDef {"type":"String","label":"Date Start","name":"dateStart","uiComponent":{"type":"DATE_PICKER"},"description":"Optional start date."}
   * @paramDef {"type":"String","label":"Date End","name":"dateEnd","uiComponent":{"type":"DATE_PICKER"},"description":"Optional end date."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page size 1-200."}
   * @paramDef {"type":"Boolean","label":"Fetch All","name":"fetchAll","uiComponent":{"type":"TOGGLE"},"description":"Auto-paginate."}
   * @returns {Object}
   * @sampleResult {"vendorpayments":[{"payment_id":"460000000049011","amount":480}]}
   */
  async listVendorPayments(organizationId, vendorId, dateStart, dateEnd, page, perPage, fetchAll) {
    const orgId = this.#resolveOrganizationId(organizationId)

    return this.#listEntities({
      logTag: 'listVendorPayments',
      url: `${ this.#base() }/vendorpayments`,
      orgId,
      listKey: 'vendorpayments',
      page,
      perPage,
      fetchAll,
      extraQuery: {
        vendor_id: vendorId || undefined,
        date_start: dateStart || undefined,
        date_end: dateEnd || undefined,
      },
    })
  }

  /**
   * @operationName Create Vendor Credit
   * @category Vendor Credits
   * @description Creates a vendor credit (credit memo from a vendor) used to offset future bills.
   * @route POST /create-vendor-credit
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Vendor","name":"vendorId","required":true,"dictionary":"listContacts","dependsOn":["organizationId"],"description":"Vendor issuing the credit."}
   * @paramDef {"type":"Array<ZohoLineItem>","label":"Line Items","name":"lineItems","required":true,"description":"Array of credit line items."}
   * @paramDef {"type":"String","label":"Date","name":"date","uiComponent":{"type":"DATE_PICKER"},"description":"Credit date YYYY-MM-DD (defaults to today)."}
   * @paramDef {"type":"String","label":"Vendor Credit Number","name":"vendorCreditNumber","description":"Optional credit memo number."}
   * @paramDef {"type":"String","label":"Reference Number","name":"referenceNumber","description":"Optional reference."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional notes."}
   * @paramDef {"type":"Object","label":"Extra Fields","name":"extraFields","freeform":true,"description":"Advanced: a JSON object of additional documented Zoho fields not exposed as parameters above (including custom_fields) merged into the request body. Leave empty for the common case."}
   * @returns {Object}
   * @sampleResult {"vendor_credit_id":"460000000071001","vendor_credit_number":"VC-001","status":"open"}
   */
  async createVendorCredit(organizationId, vendorId, lineItems, date, vendorCreditNumber, referenceNumber, notes, extraFields) {
    if (!vendorId) {
      throw new Error('"Vendor" is required')
    }

    if (!Array.isArray(lineItems) || lineItems.length === 0) {
      throw new Error('"Line Items" must be a non-empty array')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const body = cleanupObject({
      vendor_id: vendorId,
      vendor_credit_number: vendorCreditNumber,
      reference_number: referenceNumber,
      date: date || todayDate(),
      notes,
      line_items: lineItems.map(li => cleanupObject(li)),
      ...(extraFields && typeof extraFields === 'object' ? extraFields : {}),
    })

    const response = await this.#apiRequest({
      logTag: 'createVendorCredit',
      method: 'post',
      url: `${ this.#base() }/vendorcredits`,
      organizationId: orgId,
      body,
    })

    return response?.vendor_credit
  }

  /**
   * @operationName Get Vendor Credit
   * @category Vendor Credits
   * @description Retrieves a vendor credit with line items and application history. Use to inspect open credit available against future bills.
   * @route POST /get-vendor-credit
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Vendor Credit ID","name":"vendorCreditId","required":true,"dictionary":"listVendorCreditsDictionary","dependsOn":["organizationId"],"description":"Vendor credit to retrieve."}
   * @returns {Object}
   * @sampleResult {"vendor_credit_id":"460000000071001","status":"open"}
   */
  async getVendorCredit(organizationId, vendorCreditId) {
    if (!vendorCreditId) {
      throw new Error('"Vendor Credit ID" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const response = await this.#apiRequest({
      logTag: 'getVendorCredit',
      url: `${ this.#base() }/vendorcredits/${ vendorCreditId }`,
      organizationId: orgId,
    })

    return response?.vendor_credit
  }

  /**
   * @operationName Delete Vendor Credit
   * @category Vendor Credits
   * @description Permanently deletes a vendor credit. Cannot be undone; use only for accidental drafts.
   * @route POST /delete-vendor-credit
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Vendor Credit ID","name":"vendorCreditId","required":true,"dictionary":"listVendorCreditsDictionary","dependsOn":["organizationId"],"description":"Vendor credit to delete."}
   * @returns {Object}
   * @sampleResult {"code":0,"message":"The vendor credit has been deleted."}
   */
  async deleteVendorCredit(organizationId, vendorCreditId) {
    if (!vendorCreditId) {
      throw new Error('"Vendor Credit ID" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    return this.#apiRequest({
      logTag: 'deleteVendorCredit',
      method: 'delete',
      url: `${ this.#base() }/vendorcredits/${ vendorCreditId }`,
      organizationId: orgId,
    })
  }

  /**
   * @operationName Apply Vendor Credit To Bills
   * @category Vendor Credits
   * @description Applies all or part of a vendor credit to one or more bills.
   * @route POST /apply-vendor-credit
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Vendor Credit ID","name":"vendorCreditId","required":true,"dictionary":"listVendorCreditsDictionary","dependsOn":["organizationId"],"description":"Vendor credit to apply."}
   * @paramDef {"type":"Array<ZohoBillApply>","label":"Bills","name":"bills","required":true,"description":"Array of {bill_id, amount_applied} entries."}
   * @returns {Object}
   * @sampleResult {"code":0,"message":"Credits have been applied to the bill(s)."}
   */
  async applyVendorCreditToBills(organizationId, vendorCreditId, bills) {
    if (!vendorCreditId) {
      throw new Error('"Vendor Credit ID" is required')
    }

    if (!Array.isArray(bills) || bills.length === 0) {
      throw new Error('"Bills" must be a non-empty array')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    return this.#apiRequest({
      logTag: 'applyVendorCreditToBills',
      method: 'post',
      url: `${ this.#base() }/vendorcredits/${ vendorCreditId }/bills`,
      organizationId: orgId,
      body: { bills: bills.map(b => ({ bill_id: b.bill_id, amount_applied: Number(b.amount_applied) })) },
    })
  }

  /**
   * @operationName List Vendor Credits
   * @category Vendor Credits
   * @description Lists vendor credits.
   * @route POST /list-vendor-credits
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Vendor","name":"vendorId","dictionary":"listContacts","dependsOn":["organizationId"],"description":"Optional vendor filter."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Draft","Open","Closed","Void"]}},"description":"Optional status filter."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page size 1-200."}
   * @paramDef {"type":"Boolean","label":"Fetch All","name":"fetchAll","uiComponent":{"type":"TOGGLE"},"description":"Auto-paginate."}
   * @returns {Object}
   * @sampleResult {"vendorcredits":[{"vendor_credit_id":"460000000071001"}]}
   */
  async listVendorCredits(organizationId, vendorId, status, page, perPage, fetchAll) {
    const orgId = this.#resolveOrganizationId(organizationId)

    status = this.#resolveChoice(status, CREDIT_STATUS_MAP)

    return this.#listEntities({
      logTag: 'listVendorCredits',
      url: `${ this.#base() }/vendorcredits`,
      orgId,
      listKey: 'vendorcredits',
      page,
      perPage,
      fetchAll,
      extraQuery: {
        vendor_id: vendorId || undefined,
        status: status || undefined,
      },
    })
  }

  // TRANSFER ORDERS + LOCATIONS

  /**
   * @typedef {Object} ZohoTransferLineItem
   * @property {String} item_id
   * @property {Number} quantity_transfer - Use quantity_transfer (NOT quantity) — Zoho-specific naming
   * @property {String} [unit]
   */

  /**
   * @operationName Create Transfer Order
   * @category Transfer Orders
   * @description Creates a warehouse-to-warehouse transfer order. Uses location_id semantics (the modern Zoho term replacing warehouse_id).
   *
   * @route POST /create-transfer-order
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"From Location","name":"fromLocationId","required":true,"dictionary":"listLocations","dependsOn":["organizationId"],"description":"Source location."}
   * @paramDef {"type":"String","label":"To Location","name":"toLocationId","required":true,"dictionary":"listLocations","dependsOn":["organizationId"],"description":"Destination location."}
   * @paramDef {"type":"Array<ZohoTransferLineItem>","label":"Line Items","name":"lineItems","required":true,"description":"Array of {item_id, quantity_transfer, unit?}."}
   * @paramDef {"type":"String","label":"Transfer Order Number","name":"transferOrderNumber","description":"Optional override; auto-numbered when omitted."}
   * @paramDef {"type":"String","label":"Date","name":"date","uiComponent":{"type":"DATE_PICKER"},"description":"Transfer date YYYY-MM-DD (defaults to today)."}
   * @paramDef {"type":"Boolean","label":"Is In-Transit","name":"isInTransit","uiComponent":{"type":"TOGGLE"},"description":"Mark goods as in-transit (otherwise stock moves immediately)."}
   * @paramDef {"type":"String","label":"Reference Number","name":"referenceNumber","description":"Optional reference."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional notes."}
   *
   * @returns {Object}
   * @sampleResult {"transfer_order_id":"460000000080001","transfer_order_number":"TO-00001","date":"2026-05-10"}
   */
  async createTransferOrder(organizationId, fromLocationId, toLocationId, lineItems, transferOrderNumber, date, isInTransit, referenceNumber, notes) {
    if (!fromLocationId) {
      throw new Error('"From Location" is required')
    }

    if (!toLocationId) {
      throw new Error('"To Location" is required')
    }

    if (!Array.isArray(lineItems) || lineItems.length === 0) {
      throw new Error('"Line Items" must be a non-empty array')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const body = cleanupObject({
      transfer_order_number: transferOrderNumber,
      date: date || todayDate(),
      from_location_id: fromLocationId,
      to_location_id: toLocationId,
      is_intransit_order: typeof isInTransit === 'boolean' ? isInTransit : undefined,
      reference_number: referenceNumber,
      notes,
      line_items: lineItems.map(li => cleanupObject({
        item_id: li.item_id,
        quantity_transfer: Number(li.quantity_transfer ?? li.quantity),
        unit: li.unit,
      })),
    })

    const response = await this.#apiRequest({
      logTag: 'createTransferOrder',
      method: 'post',
      url: `${ this.#base() }/transferorders`,
      organizationId: orgId,
      body,
    })

    return response?.transfer_order
  }

  /**
   * @operationName Get Transfer Order
   * @category Transfer Orders
   * @description Retrieves a transfer order with line items, from/to locations, and in-transit status. Use to track stock movements between warehouses.
   * @route POST /get-transfer-order
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Transfer Order ID","name":"transferOrderId","required":true,"dictionary":"listTransferOrdersDictionary","dependsOn":["organizationId"],"description":"Transfer order to retrieve."}
   * @returns {Object}
   * @sampleResult {"transfer_order_id":"460000000080001","status":"in_transit"}
   */
  async getTransferOrder(organizationId, transferOrderId) {
    if (!transferOrderId) {
      throw new Error('"Transfer Order ID" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const response = await this.#apiRequest({
      logTag: 'getTransferOrder',
      url: `${ this.#base() }/transferorders/${ transferOrderId }`,
      organizationId: orgId,
    })

    return response?.transfer_order
  }

  /**
   * @operationName Delete Transfer Order
   * @category Transfer Orders
   * @description Permanently deletes a transfer order. Use to undo a not-yet-transferred move; for completed transfers, create a reverse transfer order instead.
   * @route POST /delete-transfer-order
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Transfer Order ID","name":"transferOrderId","required":true,"dictionary":"listTransferOrdersDictionary","dependsOn":["organizationId"],"description":"Transfer order to delete."}
   * @returns {Object}
   * @sampleResult {"code":0,"message":"The transfer order has been deleted."}
   */
  async deleteTransferOrder(organizationId, transferOrderId) {
    if (!transferOrderId) {
      throw new Error('"Transfer Order ID" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    return this.#apiRequest({
      logTag: 'deleteTransferOrder',
      method: 'delete',
      url: `${ this.#base() }/transferorders/${ transferOrderId }`,
      organizationId: orgId,
    })
  }

  /**
   * @operationName Mark Transfer Received
   * @category Transfer Orders
   * @description Marks an in-transit transfer order as received at the destination, releasing stock from in-transit into available inventory at the destination location.
   * @route POST /mark-transfer-received
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Transfer Order ID","name":"transferOrderId","required":true,"dictionary":"listTransferOrdersDictionary","dependsOn":["organizationId"],"description":"Transfer order to mark received."}
   * @returns {Object}
   * @sampleResult {"code":0,"message":"Transfer order status has been changed."}
   */
  async markTransferReceived(organizationId, transferOrderId) {
    if (!transferOrderId) {
      throw new Error('"Transfer Order ID" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    return this.#apiRequest({
      logTag: 'markTransferReceived',
      method: 'post',
      url: `${ this.#base() }/transferorders/${ transferOrderId }/markastransferred`,
      organizationId: orgId,
    })
  }

  /**
   * @operationName List Transfer Orders
   * @category Transfer Orders
   * @description Lists transfer orders with optional filters.
   * @route POST /list-transfer-orders
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Date Start","name":"dateStart","uiComponent":{"type":"DATE_PICKER"},"description":"Optional start date."}
   * @paramDef {"type":"String","label":"Date End","name":"dateEnd","uiComponent":{"type":"DATE_PICKER"},"description":"Optional end date."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page size 1-200."}
   * @paramDef {"type":"Boolean","label":"Fetch All","name":"fetchAll","uiComponent":{"type":"TOGGLE"},"description":"Auto-paginate."}
   * @returns {Object}
   * @sampleResult {"transfer_orders":[{"transfer_order_id":"460000000080001","status":"transferred"}]}
   */
  async listTransferOrders(organizationId, dateStart, dateEnd, page, perPage, fetchAll) {
    const orgId = this.#resolveOrganizationId(organizationId)

    return this.#listEntities({
      logTag: 'listTransferOrders',
      url: `${ this.#base() }/transferorders`,
      orgId,
      listKey: 'transfer_orders',
      page,
      perPage,
      fetchAll,
      extraQuery: {
        date_start: dateStart || undefined,
        date_end: dateEnd || undefined,
      },
    })
  }

  /**
   * @operationName Enable Multi-Location
   * @category Locations
   * @description One-time enables the multi-location (multi-warehouse) feature for the organization. Required before creating locations.
   * @route POST /enable-locations
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @returns {Object}
   * @sampleResult {"code":0,"message":"Multi-location has been enabled."}
   */
  async enableLocations(organizationId) {
    const orgId = this.#resolveOrganizationId(organizationId)

    return this.#apiRequest({
      logTag: 'enableLocations',
      method: 'post',
      url: `${ this.#base() }/settings/locations/enable`,
      organizationId: orgId,
    })
  }

  /**
   * @typedef {Object} ZohoLocationAddress
   * @property {String} [attention] - Recipient / attention name
   * @property {String} [street_address1] - Street line 1
   * @property {String} [street_address2] - Street line 2
   * @property {String} [city] - City
   * @property {String} [state] - State / province
   * @property {String} [state_code] - State code
   * @property {String} [zip] - Postal code
   * @property {String} [country] - Country
   */

  /**
   * @operationName Create Location
   * @category Locations
   * @description Creates a new warehouse/location.
   * @route POST /create-location
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Name","name":"locationName","required":true,"description":"Display name of the location."}
   * @paramDef {"type":"ZohoLocationAddress","label":"Address","name":"address","description":"Optional location address (street_address1, street_address2, city, state, state_code, zip, country)."}
   * @paramDef {"type":"String","label":"Type","name":"type","uiComponent":{"type":"DROPDOWN","options":{"values":["General","Line Item Only"]}},"description":"Location type. \"General\" applies to all transactions; \"Line Item Only\" restricts the location to line-item-level use. Defaults to General."}
   * @paramDef {"type":"Object","label":"Extra Fields","name":"extraFields","freeform":true,"description":"Advanced: a JSON object of additional documented Zoho fields not exposed as parameters above (including custom_fields) merged into the request body. Leave empty for the common case."}
   * @returns {Object}
   * @sampleResult {"location_id":"460000000038080","location_name":"Main Warehouse","is_primary":true}
   */
  async createLocation(organizationId, locationName, address, type, extraFields) {
    if (!locationName) {
      throw new Error('"Name" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const body = cleanupObject({
      location_name: locationName,
      address: cleanupObject(address),
      type: this.#resolveChoice(type, LOCATION_TYPE_MAP) || 'general',
      ...(extraFields && typeof extraFields === 'object' ? extraFields : {}),
    })

    const response = await this.#apiRequest({
      logTag: 'createLocation',
      method: 'post',
      url: `${ this.#base() }/locations`,
      organizationId: orgId,
      body,
    })

    return response?.location
  }

  /**
   * @operationName Get Location
   * @category Locations
   * @description Retrieves a location/warehouse with its users and address. Use to inspect warehouse configuration.
   * @route POST /get-location
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Location","name":"locationId","required":true,"dictionary":"listLocations","dependsOn":["organizationId"],"description":"Location to retrieve."}
   * @returns {Object}
   * @sampleResult {"location_id":"460000000038080","location_name":"Main Warehouse"}
   */
  async getLocation(organizationId, locationId) {
    if (!locationId) {
      throw new Error('"Location" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const response = await this.#apiRequest({
      logTag: 'getLocation',
      url: `${ this.#base() }/locations/${ locationId }`,
      organizationId: orgId,
    })

    return response?.location
  }

  /**
   * @operationName Update Location
   * @category Locations
   * @description Updates a location by merging supplied fields. Use when correcting or amending without re-sending the whole record.
   * @route POST /update-location
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Location","name":"locationId","required":true,"dictionary":"listLocations","dependsOn":["organizationId"],"description":"Location to update."}
   * @paramDef {"type":"Object","label":"Fields","name":"fields","required":true,"freeform":true,"description":"Partial update: a JSON object of the documented fields to change on this record. Only the keys you include are modified."}
   * @returns {Object}
   * @sampleResult {"location_id":"460000000038080","location_name":"Main Warehouse"}
   */
  async updateLocation(organizationId, locationId, fields) {
    if (!locationId) {
      throw new Error('"Location" is required')
    }

    if (!fields || typeof fields !== 'object' || Object.keys(fields).length === 0) {
      throw new Error('"Fields" must be a non-empty object')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    const response = await this.#apiRequest({
      logTag: 'updateLocation',
      method: 'put',
      url: `${ this.#base() }/locations/${ locationId }`,
      organizationId: orgId,
      body: cleanupObject(fields),
    })

    return response?.location
  }

  /**
   * @operationName Delete Location
   * @category Locations
   * @description Permanently deletes a location/warehouse. Inventory at the location must first be moved out via transfer order or adjusted to zero. Use to retire a closed warehouse.
   * @route POST /delete-location
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Location","name":"locationId","required":true,"dictionary":"listLocations","dependsOn":["organizationId"],"description":"Location to delete."}
   * @returns {Object}
   * @sampleResult {"code":0,"message":"The location has been deleted."}
   */
  async deleteLocation(organizationId, locationId) {
    if (!locationId) {
      throw new Error('"Location" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    return this.#apiRequest({
      logTag: 'deleteLocation',
      method: 'delete',
      url: `${ this.#base() }/locations/${ locationId }`,
      organizationId: orgId,
    })
  }

  /**
   * @operationName Mark Location Primary
   * @category Locations
   * @description Sets a location as the organization's primary warehouse.
   * @route POST /mark-location-primary
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization."}
   * @paramDef {"type":"String","label":"Location","name":"locationId","required":true,"dictionary":"listLocations","dependsOn":["organizationId"],"description":"Location to mark primary."}
   * @returns {Object}
   * @sampleResult {"code":0,"message":"The location has been marked as primary."}
   */
  async markLocationPrimary(organizationId, locationId) {
    if (!locationId) {
      throw new Error('"Location" is required')
    }

    const orgId = this.#resolveOrganizationId(organizationId)

    return this.#apiRequest({
      logTag: 'markLocationPrimary',
      method: 'post',
      url: `${ this.#base() }/locations/${ locationId }/markasprimary`,
      organizationId: orgId,
    })
  }

  // POLLING TRIGGERS
  //
  // Cursor stores the highest `last_modified_time` already emitted. Each poll requests
  // records sorted ascending by that field starting at the cursor; only records strictly
  // newer than the cursor are emitted (sort-asc + strict-gt is required to avoid losing
  // records when many share a timestamp and span >1 page). The first poll seeds the cursor
  // from the most recent record without emitting it, so subscribers don't replay the org's
  // entire history.

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerPollingForEvent(invocation) {
    return this[invocation.eventName](invocation)
  }

  async #pollByModified({ logTag, url, organizationId, listKey, modifiedField, extraQuery, cursor }) {
    const events = []
    let nextCursor = cursor
    let page = 1

    while (page <= POLLING_MAX_PAGES) {
      const response = await this.#apiRequest({
        logTag,
        url,
        organizationId,
        query: cleanupObject({
          page,
          per_page: LIST_MAX_PER_PAGE,
          sort_column: modifiedField,
          sort_order: 'A',
          last_modified_time: cursor || undefined,
          ...(extraQuery || {}),
        }),
      })

      const records = response?.[listKey] || []

      for (const record of records) {
        const modAt = record[modifiedField] || record.last_modified_time || record.created_time

        if (!cursor || (modAt && modAt > cursor)) {
          events.push(record)

          if (modAt && (!nextCursor || modAt > nextCursor)) {
            nextCursor = modAt
          }
        }
      }

      if (response?.page_context?.has_more_page !== true) {
        break
      }

      page++
    }

    return { events, nextCursor: nextCursor || cursor }
  }

  async #runPollingTrigger(invocation, { eventName, listKey, urlPath, modifiedField, extraQuery }) {
    const { organizationId } = invocation.triggerData || {}
    const orgId = this.#resolveOrganizationId(organizationId)
    const url = `${ this.#base() }/${ urlPath }`

    if (invocation.learningMode) {
      const response = await this.#apiRequest({
        logTag: `${ eventName }.learning`,
        url,
        organizationId: orgId,
        query: cleanupObject({
          page: 1,
          per_page: 1,
          sort_column: modifiedField,
          sort_order: 'D',
          ...(extraQuery || {}),
        }),
      })

      const sample = response?.[listKey]?.[0]

      return { events: sample ? [sample] : [], state: null }
    }

    const cursor = invocation.state?.lastModifiedAt

    if (!cursor) {
      const response = await this.#apiRequest({
        logTag: `${ eventName }.seed`,
        url,
        organizationId: orgId,
        query: cleanupObject({
          page: 1,
          per_page: 1,
          sort_column: modifiedField,
          sort_order: 'D',
          ...(extraQuery || {}),
        }),
      })

      const sample = response?.[listKey]?.[0]
      const seedTime = sample?.[modifiedField] || sample?.last_modified_time || sample?.created_time || new Date().toISOString()

      return { events: [], state: { lastModifiedAt: seedTime } }
    }

    const { events, nextCursor } = await this.#pollByModified({
      logTag: eventName,
      url,
      organizationId: orgId,
      listKey,
      modifiedField,
      extraQuery,
      cursor,
    })

    return {
      events: events.map(data => ({ name: eventName, data })),
      state: { lastModifiedAt: nextCursor },
    }
  }

  /**
   * @operationName On New Or Updated Sales Order (Polling)
   * @category Event Tracking
   * @description Fires when a sales order is created or updated since the last poll. First run primes the cursor without replaying history.
   * @registerAs POLLING_TRIGGER
   * @route POST /on-new-sales-order
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization to monitor."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Draft","Open","Invoiced","Partially Invoiced","Void","Overdue","On Hold","Confirmed","Closed"]}},"description":"Optional status filter."}
   * @returns {Object}
   * @sampleResult {"salesorder_id":"460000000034037","salesorder_number":"SO-00003","status":"confirmed","total":1250,"last_modified_time":"2026-05-08T09:30:00-0500"}
   */
  async onNewSalesOrder(invocation) {
    const { status } = invocation.triggerData || {}

    return this.#runPollingTrigger(invocation, {
      eventName: 'onNewSalesOrder',
      listKey: 'salesorders',
      urlPath: 'salesorders',
      modifiedField: 'last_modified_time',
      extraQuery: { status: this.#resolveChoice(status, SALES_ORDER_STATUS_MAP) },
    })
  }

  /**
   * @operationName On New Or Updated Purchase Order (Polling)
   * @category Event Tracking
   * @description Fires when a purchase order is created or updated since the last poll.
   * @registerAs POLLING_TRIGGER
   * @route POST /on-new-purchase-order
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization to monitor."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Draft","Open","Billed","Partially Billed","Cancelled","Closed"]}},"description":"Optional status filter."}
   * @returns {Object}
   * @sampleResult {"purchaseorder_id":"460000000038099","purchaseorder_number":"PO-007","status":"open","total":480}
   */
  async onNewPurchaseOrder(invocation) {
    const { status } = invocation.triggerData || {}

    return this.#runPollingTrigger(invocation, {
      eventName: 'onNewPurchaseOrder',
      listKey: 'purchaseorders',
      urlPath: 'purchaseorders',
      modifiedField: 'last_modified_time',
      extraQuery: { status: this.#resolveChoice(status, PURCHASE_ORDER_STATUS_MAP) },
    })
  }

  /**
   * @operationName On New Or Updated Invoice (Polling)
   * @category Event Tracking
   * @description Fires when an invoice is created or updated since the last poll.
   * @registerAs POLLING_TRIGGER
   * @route POST /on-new-invoice
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization to monitor."}
   * @returns {Object}
   * @sampleResult {"invoice_id":"460000000034037","invoice_number":"INV-000123","status":"sent","total":1250}
   */
  async onNewInvoice(invocation) {
    return this.#runPollingTrigger(invocation, {
      eventName: 'onNewInvoice',
      listKey: 'invoices',
      urlPath: 'invoices',
      modifiedField: 'last_modified_time',
    })
  }

  /**
   * @operationName On New Or Updated Bill (Polling)
   * @category Event Tracking
   * @description Fires when a vendor bill is created or updated since the last poll.
   * @registerAs POLLING_TRIGGER
   * @route POST /on-new-bill
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization to monitor."}
   * @returns {Object}
   * @sampleResult {"bill_id":"460000000038099","bill_number":"BILL-007","status":"open","total":480}
   */
  async onNewBill(invocation) {
    return this.#runPollingTrigger(invocation, {
      eventName: 'onNewBill',
      listKey: 'bills',
      urlPath: 'bills',
      modifiedField: 'last_modified_time',
    })
  }

  /**
   * @operationName On New Or Updated Item (Polling)
   * @category Event Tracking
   * @description Fires when an item is created or updated since the last poll. Useful for syncing the catalog into another system.
   * @registerAs POLLING_TRIGGER
   * @route POST /on-new-item
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization to monitor."}
   * @returns {Object}
   * @sampleResult {"item_id":"460000000027111","name":"Laptop","sku":"SK-001","rate":999,"stock_on_hand":12}
   */
  async onNewItem(invocation) {
    return this.#runPollingTrigger(invocation, {
      eventName: 'onNewItem',
      listKey: 'items',
      urlPath: 'items',
      modifiedField: 'last_modified_time',
    })
  }

  /**
   * @operationName On New Or Updated Contact (Polling)
   * @category Event Tracking
   * @description Fires when a contact is created or updated since the last poll.
   * @registerAs POLLING_TRIGGER
   * @route POST /on-new-contact
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization to monitor."}
   * @paramDef {"type":"String","label":"Contact Type","name":"contactType","uiComponent":{"type":"DROPDOWN","options":{"values":["Customer","Vendor"]}},"description":"Optional filter to monitor only one type."}
   * @returns {Object}
   * @sampleResult {"contact_id":"460000000026049","contact_name":"Acme Corp","contact_type":"customer"}
   */
  async onNewContact(invocation) {
    const { contactType } = invocation.triggerData || {}

    return this.#runPollingTrigger(invocation, {
      eventName: 'onNewContact',
      listKey: 'contacts',
      urlPath: 'contacts',
      modifiedField: 'last_modified_time',
      extraQuery: { contact_type: this.#resolveChoice(contactType, CONTACT_TYPE_MAP) },
    })
  }

  /**
   * @operationName On New Or Updated Package (Polling)
   * @category Event Tracking
   * @description Fires when a package is created or its shipment status changes.
   * @registerAs POLLING_TRIGGER
   * @route POST /on-new-package
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization to monitor."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Not Shipped","Shipped","Delivered"]}},"description":"Optional shipment status filter."}
   * @returns {Object}
   * @sampleResult {"package_id":"460000000040001","package_number":"PA-00001","status":"Shipped"}
   */
  async onNewPackage(invocation) {
    const { status } = invocation.triggerData || {}

    return this.#runPollingTrigger(invocation, {
      eventName: 'onNewPackage',
      listKey: 'packages',
      urlPath: 'packages',
      modifiedField: 'last_modified_time',
      extraQuery: { filter_by: this.#resolveChoice(status, SHIPMENT_STATUS_MAP) },
    })
  }

  /**
   * @operationName On Low Stock Item (Polling)
   * @category Event Tracking
   * @description Fires for any item whose stock_on_hand is at or below its reorder_level (multiplied by the configured threshold multiplier). Use to drive reorder workflows.
   * @registerAs POLLING_TRIGGER
   * @route POST /on-low-stock-item
   * @appearanceColor #E42527 #F26C6F
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Organization","name":"organizationId","required":true,"dictionary":"listOrganizations","description":"Zoho Inventory organization to monitor."}
   * @returns {Object}
   * @sampleResult {"item_id":"460000000027111","name":"Laptop","sku":"SK-001","stock_on_hand":2,"reorder_level":5}
   */
  async onLowStockItem(invocation) {
    const { organizationId } = invocation.triggerData || {}
    const orgId = this.#resolveOrganizationId(organizationId)
    const url = `${ this.#base() }/items`
    const multiplier = this.lowStockThresholdMultiplier

    // For the default multiplier (1) Zoho's built-in LowStock filter keeps the working set small.
    // For multiplier > 1 the early-warning items (stock above Zoho's reorder threshold but within
    // multiplier x reorder_level) sit OUTSIDE Zoho's LowStock set, so we must scan all items and
    // apply the threshold in code. Either way, page to the end so large catalogs aren't truncated.
    const baseQuery = multiplier > 1
      ? { per_page: LIST_MAX_PER_PAGE }
      : { filter_by: 'Status.Lowstock', per_page: LIST_MAX_PER_PAGE }

    const items = []
    let page = 1

    while (page <= POLLING_MAX_PAGES) {
      const response = await this.#apiRequest({
        logTag: `onLowStockItem.page${ page }`,
        url,
        organizationId: orgId,
        query: { ...baseQuery, page },
      })

      items.push(...(response?.items || []))

      if (response?.page_context?.has_more_page !== true) {
        break
      }

      page++
    }

    const previouslyNotified = new Set(invocation.state?.notifiedIds || [])
    const fresh = []
    const allIds = []

    for (const item of items) {
      const stock = Number(item.stock_on_hand ?? item.available_stock ?? 0)
      const reorder = Number(item.reorder_level ?? 0) * multiplier

      if (reorder > 0 && stock <= reorder) {
        allIds.push(item.item_id)

        if (!previouslyNotified.has(item.item_id)) {
          fresh.push(item)
        }
      }
    }

    if (invocation.learningMode) {
      const sample = items.find(it => Number(it.reorder_level ?? 0) > 0) || items[0] || null

      return { events: sample ? [sample] : [], state: null }
    }

    return {
      events: fresh.map(data => ({ name: 'onLowStockItem', data })),
      state: { notifiedIds: allIds },
    }
  }
}

// SERVICE REGISTRATION

Flowrunner.ServerCode.addService(ZohoInventoryService, [
  {
    displayName: 'Client ID',
    name: 'clientId',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'OAuth 2.0 Client ID from the Zoho API Console (https://api-console.zoho.com).',
  },
  {
    displayName: 'Client Secret',
    name: 'clientSecret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'OAuth 2.0 Client Secret issued alongside the Client ID.',
  },
  {
    displayName: 'Data Center',
    name: 'dataCenter',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.CHOICE,
    required: false,
    shared: false,
    defaultValue: 'US',
    options: ['US', 'EU', 'IN', 'AU', 'JP', 'CA', 'CN', 'SA'],
    hint: 'Default Zoho data center for the initial OAuth redirect. Multi-DC clients are auto-detected via accounts-server returned during the callback.',
  },
  {
    displayName: 'Default Organization ID',
    name: 'defaultOrganizationId',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'Optional fallback organization_id used when an action does not specify one. Find IDs in Zoho Inventory > Settings > Organizations.',
  },
  {
    displayName: 'Low Stock Threshold Multiplier',
    name: 'lowStockThresholdMultiplier',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    defaultValue: '1',
    hint: 'Multiplier applied to each item\'s reorder_level when evaluating the low-stock trigger. 1 = trigger at exactly the reorder level; 1.5 = trigger when stock drops below 1.5x the reorder level.',
  },
])

// UTILITY FUNCTIONS

function cleanupObject(data) {
  if (!data || typeof data !== 'object') {
    return data
  }

  const result = {}

  Object.keys(data).forEach(key => {
    const value = data[key]

    if (value !== undefined && value !== null && value !== '') {
      result[key] = value
    }
  })

  return Object.keys(result).length > 0 ? result : undefined
}

function searchFilter(list, props, searchString) {
  if (!searchString) {
    return list
  }

  const needle = String(searchString).toLowerCase()

  return list.filter(item =>
    props.some(prop => {
      const value = prop.split('.').reduce((acc, key) => acc?.[key], item)

      return value !== undefined && value !== null && String(value).toLowerCase().includes(needle)
    })
  )
}

function todayDate() {
  const now = new Date()
  const yyyy = now.getUTCFullYear()
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(now.getUTCDate()).padStart(2, '0')

  return `${ yyyy }-${ mm }-${ dd }`
}

module.exports = ZohoInventoryService
