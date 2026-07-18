'use strict'

const AUTHORIZE_URL = 'https://www.sageone.com/oauth2/auth/central'
const TOKEN_URL = 'https://oauth.accounting.sage.com/token'
const API_BASE_URL = 'https://api.accounting.sage.com/v3.1'

const OAUTH_SCOPE = 'full_access'

const DEFAULT_ITEMS_PER_PAGE = 20
const MAX_ITEMS_PER_PAGE = 200
const DICTIONARY_PAGE_SIZE = 50

const CONTACT_TYPE_OPTIONS = {
  'Customer': 'CUSTOMER',
  'Vendor': 'VENDOR',
}

const PAYMENT_TRANSACTION_TYPE_OPTIONS = {
  'Customer Receipt': 'CUSTOMER_RECEIPT',
  'Customer Refund': 'CUSTOMER_REFUND',
  'Vendor Payment': 'VENDOR_PAYMENT',
  'Vendor Refund': 'VENDOR_REFUND',
}

const logger = {
  info: (...args) => console.log('[Sage Accounting] info:', ...args),
  debug: (...args) => console.log('[Sage Accounting] debug:', ...args),
  error: (...args) => console.log('[Sage Accounting] error:', ...args),
  warn: (...args) => console.log('[Sage Accounting] warn:', ...args),
}

/**
 * @requireOAuth
 * @integrationName Sage Accounting
 * @integrationIcon /icon.svg
 **/
class SageAccountingService {
  constructor(config) {
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
  }

  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    if (query) {
      query = cleanupObject(query)
    }

    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=[${ JSON.stringify(query) }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Authorization': `Bearer ${ this.request.headers['oauth-access-token'] }`,
          'Content-Type': 'application/json',
        })
        .query(query || {})

      const response = body !== undefined ? await request.send(body) : await request

      // Sage returns 204 No Content for successful deletes; normalize to a consistent success object.
      return isEmptyResponse(response) ? { status: 'success' } : response
    } catch (error) {
      const message = this.#extractError(error)

      logger.error(`${ logTag } - failed: ${ message }`)

      throw new Error(`Sage Accounting API error: ${ message }`)
    }
  }

  // Sage errors are shaped as an array of { $severity, $dataCode, $message, $source } objects,
  // or { error, error_description } for the auth server.
  #extractError(error) {
    const body = error.body

    if (body) {
      if (Array.isArray(body) && body.length) {
        return body
          .map(item => {
            const source = item.$source ? ` (${ item.$source })` : ''

            return `${ item.$message || item.$dataCode || 'Request failed' }${ source }`
          })
          .join('; ')
      }

      if (body.$message) {
        return body.$message
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

  // Normalizes a date-picker value (ISO datetime, timestamp, or date string) to Sage's YYYY-MM-DD format.
  #toDate(value) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
      return value.trim()
    }

    const date = new Date(value)

    if (isNaN(date.getTime())) {
      return value
    }

    return date.toISOString().slice(0, 10)
  }

  // Normalizes a datetime-picker value to an ISO 8601 UTC datetime string.
  #toDateTime(value) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    const date = new Date(value)

    if (isNaN(date.getTime())) {
      return value
    }

    return date.toISOString()
  }

  #pagingQuery(itemsPerPage, page) {
    return {
      items_per_page: Math.min(itemsPerPage || DEFAULT_ITEMS_PER_PAGE, MAX_ITEMS_PER_PAGE),
      page: page || undefined,
    }
  }

  // Runs a paged GET against a Sage list endpoint and maps its $items into dictionary items.
  async #dictionaryRequest({ logTag, path, query, search, cursor, searchParamSupported, toItem }) {
    const page = cursor ? parseInt(cursor, 10) || 1 : 1

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }${ path }`,
      query: {
        ...query,
        search: searchParamSupported ? (search || undefined) : undefined,
        items_per_page: DICTIONARY_PAGE_SIZE,
        page,
      },
    })

    let items = Array.isArray(response.$items) ? response.$items : []

    if (search && !searchParamSupported) {
      const needle = search.toLowerCase()

      items = items.filter(item => (item.displayed_as || item.name || '').toLowerCase().includes(needle))
    }

    return {
      cursor: response.$next ? String(page + 1) : undefined,
      items: items.map(toItem),
    }
  }

  // ============================================= OAUTH ================================================

  /**
   * @registerAs SYSTEM
   * @route GET /oauth/url
   * @returns {String}
   */
  async getOAuth2ConnectionURL() {
    const params = new URLSearchParams()

    params.append('filter', 'apiv3.1')
    params.append('response_type', 'code')
    params.append('client_id', this.clientId)
    params.append('scope', OAUTH_SCOPE)
    params.append('state', `flowrunner_${ Date.now() }`)

    const connectionURL = `${ AUTHORIZE_URL }?${ params.toString() }`

    logger.debug(`composed connectionURL: ${ connectionURL }`)

    return connectionURL
  }

  async #tokenRequest(params) {
    const body = new URLSearchParams()

    body.append('client_id', this.clientId)
    body.append('client_secret', this.clientSecret)

    Object.entries(params).forEach(([key, value]) => body.append(key, value))

    return Flowrunner.Request.post(TOKEN_URL)
      .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
      .send(body.toString())
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
   * @route POST /oauth/callback
   * @param {Object} callbackObject
   * @returns {executeCallback_ResultObject}
   */
  async executeCallback(callbackObject) {
    const tokenResponse = await this.#tokenRequest({
      grant_type: 'authorization_code',
      code: callbackObject.code,
      redirect_uri: callbackObject.redirectURI,
    })

    let userData = {}
    let connectionIdentityName = 'Sage Accounting'

    const authHeader = { 'Authorization': `Bearer ${ tokenResponse.access_token }` }

    try {
      userData = await Flowrunner.Request.get(`${ API_BASE_URL }/user`).set(authHeader)

      const fullName = [userData.first_name, userData.last_name].filter(Boolean).join(' ')

      connectionIdentityName = fullName || userData.email || connectionIdentityName
    } catch (error) {
      logger.warn(`[executeCallback] /user lookup failed (${ error.message }), falling back to /businesses`)

      try {
        const businesses = await Flowrunner.Request.get(`${ API_BASE_URL }/businesses`).set(authHeader)
        const business = Array.isArray(businesses.$items) ? businesses.$items[0] : undefined

        connectionIdentityName = business?.name || business?.displayed_as || connectionIdentityName
      } catch (fallbackError) {
        logger.error(`[executeCallback] /businesses fallback failed: ${ fallbackError.message }`)
      }
    }

    // Sage access tokens live ~5 minutes; refresh tokens are single-use and rotate on every refresh.
    return {
      token: tokenResponse.access_token,
      expirationInSeconds: tokenResponse.expires_in,
      refreshToken: tokenResponse.refresh_token,
      connectionIdentityName,
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
   * @route PUT /oauth/refresh
   * @param {String} refreshToken
   * @returns {refreshToken_ResultObject}
   */
  async refreshToken(refreshToken) {
    try {
      const tokenResponse = await this.#tokenRequest({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      })

      // CRITICAL: Sage refresh tokens are single-use — always return the NEW refresh token.
      return {
        token: tokenResponse.access_token,
        expirationInSeconds: tokenResponse.expires_in,
        refreshToken: tokenResponse.refresh_token || refreshToken,
      }
    } catch (error) {
      logger.error(`refreshToken error: ${ error.message }`)

      if (error.body?.error === 'invalid_grant') {
        throw new Error('Refresh token expired or already used, please re-authenticate.')
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
   * @typedef {Object} getContactsDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Contact Type","name":"contactType","uiComponent":{"type":"DROPDOWN","options":{"values":["Customer","Vendor"]}},"description":"Optional contact type to restrict the list to customers or vendors only."}
   */

  /**
   * @typedef {Object} getContactsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter contacts by name, reference, or email."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Page number (as a string) from a previous response, used to retrieve the next page."}
   * @paramDef {"type":"getContactsDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"Optional contact type filter."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Contacts Dictionary
   * @description Lists contacts (customers and vendors) of the connected Sage business for selection in dependent parameters. Returns the contact display name as the label and the contact id as the value.
   * @route POST /get-contacts-dictionary
   * @paramDef {"type":"getContactsDictionary__payload","label":"Payload","name":"payload","description":"Search, pagination, and contact type criteria input."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Acme Corp","value":"a1b2c3d4e5f6","note":"Customer"}],"cursor":"2"}
   */
  async getContactsDictionary(payload) {
    const { search, cursor, criteria } = payload || {}

    return this.#dictionaryRequest({
      logTag: 'getContactsDictionary',
      path: '/contacts',
      query: { contact_type_id: this.#resolveChoice(criteria?.contactType, CONTACT_TYPE_OPTIONS) },
      search,
      cursor,
      searchParamSupported: true,
      toItem: contact => ({
        label: contact.displayed_as || contact.name,
        value: contact.id,
        note: contact.email || '',
      }),
    })
  }

  /**
   * @typedef {Object} getLedgerAccountsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter ledger accounts by displayed name. Filtering is applied locally to the current page."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Page number (as a string) from a previous response, used to retrieve the next page."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Ledger Accounts Dictionary
   * @description Lists ledger accounts from the business's chart of accounts for selection in dependent parameters. Returns the account name (with nominal code) as the label and the ledger account id as the value.
   * @route POST /get-ledger-accounts-dictionary
   * @paramDef {"type":"getLedgerAccountsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Sales Type A (4000)","value":"b2c3d4e5f6a1","note":""}],"cursor":"2"}
   */
  async getLedgerAccountsDictionary(payload) {
    const { search, cursor } = payload || {}

    return this.#dictionaryRequest({
      logTag: 'getLedgerAccountsDictionary',
      path: '/ledger_accounts',
      search,
      cursor,
      toItem: account => ({
        label: account.displayed_as || account.name,
        value: account.id,
        note: '',
      }),
    })
  }

  /**
   * @typedef {Object} getLedgerAccountTypesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter ledger account types by name. Filtering is applied locally to the current page."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Page number (as a string) from a previous response, used to retrieve the next page."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Ledger Account Types Dictionary
   * @description Lists the ledger account types (categories such as Sales, Overheads, Current Assets) available in the business, for use when creating ledger accounts.
   * @route POST /get-ledger-account-types-dictionary
   * @paramDef {"type":"getLedgerAccountTypesDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Sales","value":"SALES","note":""}],"cursor":"2"}
   */
  async getLedgerAccountTypesDictionary(payload) {
    const { search, cursor } = payload || {}

    return this.#dictionaryRequest({
      logTag: 'getLedgerAccountTypesDictionary',
      path: '/ledger_account_types',
      search,
      cursor,
      toItem: type => ({
        label: type.displayed_as || type.name,
        value: type.id,
        note: '',
      }),
    })
  }

  /**
   * @typedef {Object} getBankAccountsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter bank accounts by displayed name. Filtering is applied locally to the current page."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Page number (as a string) from a previous response, used to retrieve the next page."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Bank Accounts Dictionary
   * @description Lists the business's bank accounts for selection in dependent parameters. Returns the bank account display name as the label and the bank account id as the value.
   * @route POST /get-bank-accounts-dictionary
   * @paramDef {"type":"getBankAccountsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Current Account (1200)","value":"c3d4e5f6a1b2","note":""}],"cursor":"2"}
   */
  async getBankAccountsDictionary(payload) {
    const { search, cursor } = payload || {}

    return this.#dictionaryRequest({
      logTag: 'getBankAccountsDictionary',
      path: '/bank_accounts',
      search,
      cursor,
      toItem: account => ({
        label: account.displayed_as || account.name,
        value: account.id,
        note: '',
      }),
    })
  }

  /**
   * @typedef {Object} getTaxRatesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter tax rates by displayed name. Filtering is applied locally to the current page."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Page number (as a string) from a previous response, used to retrieve the next page."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Tax Rates Dictionary
   * @description Lists the tax rates available to the business (e.g. standard, reduced, zero-rated) for selection in invoice, credit note, and quote line parameters.
   * @route POST /get-tax-rates-dictionary
   * @paramDef {"type":"getTaxRatesDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Standard 20.00%","value":"GB_STANDARD","note":""}],"cursor":"2"}
   */
  async getTaxRatesDictionary(payload) {
    const { search, cursor } = payload || {}

    return this.#dictionaryRequest({
      logTag: 'getTaxRatesDictionary',
      path: '/tax_rates',
      search,
      cursor,
      toItem: rate => ({
        label: rate.displayed_as || rate.name,
        value: rate.id,
        note: '',
      }),
    })
  }

  /**
   * @typedef {Object} getProductsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter products by description or item code."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Page number (as a string) from a previous response, used to retrieve the next page."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Products Dictionary
   * @description Lists the business's stock/non-stock products for selection in dependent parameters. Returns the product description as the label and the product id as the value.
   * @route POST /get-products-dictionary
   * @paramDef {"type":"getProductsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Widget Pro","value":"d4e5f6a1b2c3","note":"WID-001"}],"cursor":"2"}
   */
  async getProductsDictionary(payload) {
    const { search, cursor } = payload || {}

    return this.#dictionaryRequest({
      logTag: 'getProductsDictionary',
      path: '/products',
      search,
      cursor,
      searchParamSupported: true,
      toItem: product => ({
        label: product.displayed_as || product.description,
        value: product.id,
        note: product.item_code || '',
      }),
    })
  }

  /**
   * @typedef {Object} getServicesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter services by description or item code."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Page number (as a string) from a previous response, used to retrieve the next page."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Services Dictionary
   * @description Lists the business's service items for selection in dependent parameters. Returns the service description as the label and the service id as the value.
   * @route POST /get-services-dictionary
   * @paramDef {"type":"getServicesDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Consulting Hour","value":"e5f6a1b2c3d4","note":"CONS-01"}],"cursor":"2"}
   */
  async getServicesDictionary(payload) {
    const { search, cursor } = payload || {}

    return this.#dictionaryRequest({
      logTag: 'getServicesDictionary',
      path: '/services',
      search,
      cursor,
      searchParamSupported: true,
      toItem: service => ({
        label: service.displayed_as || service.description,
        value: service.id,
        note: service.item_code || '',
      }),
    })
  }

  /**
   * @typedef {Object} getArtefactStatusesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter statuses by name. Filtering is applied locally to the current page."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Page number (as a string) from a previous response, used to retrieve the next page."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Artefact Statuses Dictionary
   * @description Lists the artefact statuses (e.g. Draft, Sent, Paid, Void) used to filter sales invoices, credit notes, and purchase invoices by status.
   * @route POST /get-artefact-statuses-dictionary
   * @paramDef {"type":"getArtefactStatusesDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Paid","value":"PAID","note":""}],"cursor":"2"}
   */
  async getArtefactStatusesDictionary(payload) {
    const { search, cursor } = payload || {}

    return this.#dictionaryRequest({
      logTag: 'getArtefactStatusesDictionary',
      path: '/artefact_statuses',
      search,
      cursor,
      toItem: status => ({
        label: status.displayed_as || status.name,
        value: status.id,
        note: '',
      }),
    })
  }

  // ============================================ BUSINESSES ===========================================

  /**
   * @description Retrieves the Sage businesses accessible to the connected user. Most accounts contain a single business; multi-business subscriptions return one entry per business. Useful as a connection check and for looking up business ids.
   *
   * @route GET /list-businesses
   * @operationName List Businesses
   * @category Businesses
   *
   * @returns {Object}
   * @sampleResult {"$total":1,"$page":1,"$itemsPerPage":20,"$items":[{"id":"a1b2c3d4","name":"Acme Ltd","displayed_as":"Acme Ltd"}]}
   */
  async listBusinesses() {
    return this.#apiRequest({
      logTag: 'listBusinesses',
      url: `${ API_BASE_URL }/businesses`,
    })
  }

  /**
   * @description Retrieves full details of a single Sage business by id, including its name, address, country, and subscription details.
   *
   * @route GET /get-business
   * @operationName Get Business
   * @category Businesses
   *
   * @paramDef {"type":"String","label":"Business ID","name":"businessId","required":true,"description":"The unique id of the business, as returned by List Businesses."}
   *
   * @returns {Object}
   * @sampleResult {"id":"a1b2c3d4","name":"Acme Ltd","displayed_as":"Acme Ltd","country_id":"GB","created_at":"2023-01-15T10:00:00Z"}
   */
  async getBusiness(businessId) {
    if (!businessId) {
      throw new Error('"Business ID" is required')
    }

    return this.#apiRequest({
      logTag: 'getBusiness',
      url: `${ API_BASE_URL }/businesses/${ encodeURIComponent(businessId) }`,
    })
  }

  // ============================================= CONTACTS ============================================

  /**
   * @description Retrieves contacts (customers and vendors) of the connected business, paginated (up to 200 per page). Supports filtering by free-text search, contact type, exact email address, and last-modified timestamp. Returns summary contact objects with id and display name.
   *
   * @route GET /list-contacts
   * @operationName List Contacts
   * @category Contacts
   *
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Free-text filter matching the contact's name, reference, or email."}
   * @paramDef {"type":"String","label":"Contact Type","name":"contactType","uiComponent":{"type":"DROPDOWN","options":{"values":["Customer","Vendor"]}},"description":"Optional contact type filter: only customers or only vendors."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Optional exact email address filter."}
   * @paramDef {"type":"String","label":"Updated or Created Since","name":"updatedOrCreatedSince","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Only return contacts created or updated at or after this ISO 8601 timestamp."}
   * @paramDef {"type":"Number","label":"Items Per Page","name":"itemsPerPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of contacts per page. Range: 1-200. Default: 20."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve. Default: 1."}
   *
   * @returns {Object}
   * @sampleResult {"$total":2,"$page":1,"$itemsPerPage":20,"$items":[{"id":"a1b2c3d4e5f6","displayed_as":"Acme Corp"},{"id":"f6e5d4c3b2a1","displayed_as":"Supplies Inc"}]}
   */
  async listContacts(search, contactType, email, updatedOrCreatedSince, itemsPerPage, page) {
    return this.#apiRequest({
      logTag: 'listContacts',
      url: `${ API_BASE_URL }/contacts`,
      query: {
        search,
        contact_type_id: this.#resolveChoice(contactType, CONTACT_TYPE_OPTIONS),
        email,
        updated_or_created_since: this.#toDateTime(updatedOrCreatedSince),
        ...this.#pagingQuery(itemsPerPage, page),
      },
    })
  }

  /**
   * @description Retrieves the full record of a single contact by id, including contact types, addresses, contact persons, bank account details, default ledger accounts, currency, credit terms, and balance information.
   *
   * @route GET /get-contact
   * @operationName Get Contact
   * @category Contacts
   *
   * @paramDef {"type":"String","label":"Contact","name":"contactId","required":true,"dictionary":"getContactsDictionary","description":"The contact to retrieve. Select a contact or provide its id."}
   *
   * @returns {Object}
   * @sampleResult {"id":"a1b2c3d4e5f6","displayed_as":"Acme Corp","name":"Acme Corp","reference":"ACME","contact_types":[{"id":"CUSTOMER"}],"email":"billing@acme.com","balance":"1250.00","currency":{"id":"GBP"}}
   */
  async getContact(contactId) {
    if (!contactId) {
      throw new Error('"Contact" is required')
    }

    return this.#apiRequest({
      logTag: 'getContact',
      url: `${ API_BASE_URL }/contacts/${ encodeURIComponent(contactId) }`,
      query: { attributes: 'all' },
    })
  }

  /**
   * @typedef {Object} ContactPerson
   * @paramDef {"type":"String","label":"Name","name":"name","description":"The contact person's full name."}
   * @paramDef {"type":"String","label":"Job Title","name":"job_title","description":"The contact person's job title."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"The contact person's email address."}
   * @paramDef {"type":"String","label":"Telephone","name":"telephone","description":"The contact person's telephone number."}
   * @paramDef {"type":"String","label":"Mobile","name":"mobile","description":"The contact person's mobile number."}
   */

  /**
   * @description Creates a new contact (customer, vendor, or both) in the connected business. Requires a name and at least one contact type. Optionally sets a reference, email, phone numbers, main address, main contact person, default sales ledger account, currency, credit limit, and tax number. Returns the created contact.
   *
   * @route POST /create-contact
   * @operationName Create Contact
   * @category Contacts
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The contact's company or person name."}
   * @paramDef {"type":"Array<String>","label":"Contact Types","name":"contactTypes","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Customer","Vendor"]}},"description":"One or both contact types. A contact can be a customer, a vendor, or both."}
   * @paramDef {"type":"String","label":"Reference","name":"reference","description":"Optional unique reference code for the contact."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"The contact's primary email address."}
   * @paramDef {"type":"String","label":"Mobile","name":"mobile","description":"The contact's mobile number."}
   * @paramDef {"type":"String","label":"Telephone","name":"telephone","description":"The contact's telephone number."}
   * @paramDef {"type":"String","label":"Address Line 1","name":"addressLine1","description":"First line of the contact's main address."}
   * @paramDef {"type":"String","label":"City","name":"city","description":"City of the contact's main address."}
   * @paramDef {"type":"String","label":"Postal Code","name":"postalCode","description":"Postal/ZIP code of the contact's main address."}
   * @paramDef {"type":"String","label":"Country","name":"countryId","description":"ISO country id of the main address, e.g. 'GB', 'US', 'IE'."}
   * @paramDef {"type":"ContactPerson","label":"Main Contact Person","name":"mainContactPerson","description":"Optional main contact person details (name, job title, email, phone)."}
   * @paramDef {"type":"String","label":"Default Sales Ledger Account","name":"defaultSalesLedgerAccountId","dictionary":"getLedgerAccountsDictionary","description":"Optional default ledger account used on sales artefacts for this contact."}
   * @paramDef {"type":"String","label":"Currency","name":"currencyId","description":"Optional ISO currency id for the contact, e.g. 'GBP', 'USD'. Requires multi-currency to differ from the base currency."}
   * @paramDef {"type":"Number","label":"Credit Limit","name":"creditLimit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional credit limit amount for the contact."}
   * @paramDef {"type":"String","label":"Tax Number","name":"taxNumber","description":"Optional VAT/tax registration number."}
   *
   * @returns {Object}
   * @sampleResult {"id":"a1b2c3d4e5f6","displayed_as":"Acme Corp","name":"Acme Corp","reference":"ACME","email":"billing@acme.com","created_at":"2026-07-18T10:00:00Z"}
   */
  async createContact(
    name, contactTypes, reference, email, mobile, telephone,
    addressLine1, city, postalCode, countryId,
    mainContactPerson, defaultSalesLedgerAccountId, currencyId, creditLimit, taxNumber
  ) {
    if (!name) {
      throw new Error('"Name" is required')
    }

    const typeIds = (Array.isArray(contactTypes) ? contactTypes : [contactTypes])
      .filter(Boolean)
      .map(type => this.#resolveChoice(type, CONTACT_TYPE_OPTIONS))

    if (!typeIds.length) {
      throw new Error('At least one "Contact Type" is required')
    }

    const contact = cleanupObject({
      name,
      contact_type_ids: typeIds,
      reference,
      email,
      mobile,
      telephone,
      main_contact_person: mainContactPerson ? cleanupObject(mainContactPerson) : undefined,
      default_sales_ledger_account_id: defaultSalesLedgerAccountId,
      currency_id: currencyId,
      credit_limit: creditLimit,
      tax_number: taxNumber,
    })

    const mainAddress = cleanupObject({
      address_line_1: addressLine1,
      city,
      postal_code: postalCode,
      country_id: countryId,
    })

    if (Object.keys(mainAddress).length) {
      contact.main_address = mainAddress
    }

    return this.#apiRequest({
      logTag: 'createContact',
      method: 'post',
      url: `${ API_BASE_URL }/contacts`,
      body: { contact },
    })
  }

  /**
   * @description Updates an existing contact. Only the provided fields are changed; omitted fields keep their current values. Returns the updated contact.
   *
   * @route PUT /update-contact
   * @operationName Update Contact
   * @category Contacts
   *
   * @paramDef {"type":"String","label":"Contact","name":"contactId","required":true,"dictionary":"getContactsDictionary","description":"The contact to update. Select a contact or provide its id."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"New company or person name."}
   * @paramDef {"type":"Array<String>","label":"Contact Types","name":"contactTypes","uiComponent":{"type":"DROPDOWN","options":{"values":["Customer","Vendor"]}},"description":"New contact type set. Replaces the existing types when provided."}
   * @paramDef {"type":"String","label":"Reference","name":"reference","description":"New unique reference code."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"New primary email address."}
   * @paramDef {"type":"String","label":"Mobile","name":"mobile","description":"New mobile number."}
   * @paramDef {"type":"String","label":"Telephone","name":"telephone","description":"New telephone number."}
   * @paramDef {"type":"String","label":"Default Sales Ledger Account","name":"defaultSalesLedgerAccountId","dictionary":"getLedgerAccountsDictionary","description":"New default ledger account for sales artefacts."}
   * @paramDef {"type":"Number","label":"Credit Limit","name":"creditLimit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"New credit limit amount."}
   * @paramDef {"type":"String","label":"Tax Number","name":"taxNumber","description":"New VAT/tax registration number."}
   *
   * @returns {Object}
   * @sampleResult {"id":"a1b2c3d4e5f6","displayed_as":"Acme Corporation","name":"Acme Corporation","updated_at":"2026-07-18T10:05:00Z"}
   */
  async updateContact(
    contactId, name, contactTypes, reference, email, mobile, telephone,
    defaultSalesLedgerAccountId, creditLimit, taxNumber
  ) {
    if (!contactId) {
      throw new Error('"Contact" is required')
    }

    const contact = cleanupObject({
      name,
      reference,
      email,
      mobile,
      telephone,
      default_sales_ledger_account_id: defaultSalesLedgerAccountId,
      credit_limit: creditLimit,
      tax_number: taxNumber,
    })

    if (contactTypes !== undefined && contactTypes !== null) {
      const typeIds = (Array.isArray(contactTypes) ? contactTypes : [contactTypes])
        .filter(Boolean)
        .map(type => this.#resolveChoice(type, CONTACT_TYPE_OPTIONS))

      if (typeIds.length) {
        contact.contact_type_ids = typeIds
      }
    }

    if (!Object.keys(contact).length) {
      throw new Error('At least one field to update is required')
    }

    return this.#apiRequest({
      logTag: 'updateContact',
      method: 'put',
      url: `${ API_BASE_URL }/contacts/${ encodeURIComponent(contactId) }`,
      body: { contact },
    })
  }

  /**
   * @description Deletes a contact from the business. Sage only allows deleting contacts that have no associated transactions (invoices, payments, etc.). Returns a success status.
   *
   * @route DELETE /delete-contact
   * @operationName Delete Contact
   * @category Contacts
   *
   * @paramDef {"type":"String","label":"Contact","name":"contactId","required":true,"dictionary":"getContactsDictionary","description":"The contact to delete. Select a contact or provide its id."}
   *
   * @returns {Object}
   * @sampleResult {"status":"success"}
   */
  async deleteContact(contactId) {
    if (!contactId) {
      throw new Error('"Contact" is required')
    }

    return this.#apiRequest({
      logTag: 'deleteContact',
      method: 'delete',
      url: `${ API_BASE_URL }/contacts/${ encodeURIComponent(contactId) }`,
    })
  }

  // Filters out empty line entries and strips undefined/null/empty properties from each line object.
  #cleanLines(lines, label) {
    const cleaned = (Array.isArray(lines) ? lines : [lines])
      .filter(Boolean)
      .map(line => cleanupObject(line))
      .filter(line => Object.keys(line).length)

    if (!cleaned.length) {
      throw new Error(`At least one ${ label } is required`)
    }

    return cleaned
  }

  // ========================================== SALES INVOICES =========================================

  /**
   * @typedef {Object} SalesInvoiceLine
   * @paramDef {"type":"String","label":"Description","name":"description","required":true,"description":"The line item description shown on the document."}
   * @paramDef {"type":"String","label":"Ledger Account ID","name":"ledger_account_id","required":true,"dictionary":"getLedgerAccountsDictionary","description":"The ledger account to post this line to."}
   * @paramDef {"type":"Number","label":"Quantity","name":"quantity","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The quantity of units for this line."}
   * @paramDef {"type":"Number","label":"Unit Price","name":"unit_price","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The net price per unit."}
   * @paramDef {"type":"String","label":"Tax Rate ID","name":"tax_rate_id","dictionary":"getTaxRatesDictionary","description":"The tax rate to apply to this line."}
   * @paramDef {"type":"Number","label":"Discount Amount","name":"discount_amount","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional discount amount applied to this line."}
   * @paramDef {"type":"String","label":"Product ID","name":"product_id","dictionary":"getProductsDictionary","description":"Optional product this line refers to."}
   * @paramDef {"type":"String","label":"Service ID","name":"service_id","dictionary":"getServicesDictionary","description":"Optional service item this line refers to."}
   */

  /**
   * @description Retrieves sales invoices of the connected business, paginated (up to 200 per page). Supports filtering by status, customer, issue date range, free-text search, and last-modified timestamp. Returns summary invoice objects with id and display reference.
   *
   * @route GET /list-sales-invoices
   * @operationName List Sales Invoices
   * @category Sales Invoices
   *
   * @paramDef {"type":"String","label":"Status","name":"statusId","dictionary":"getArtefactStatusesDictionary","description":"Optional status filter (e.g. Draft, Sent, Paid, Void)."}
   * @paramDef {"type":"String","label":"Contact","name":"contactId","dictionary":"getContactsDictionary","description":"Optional customer filter: only invoices for this contact."}
   * @paramDef {"type":"String","label":"From Date","name":"fromDate","uiComponent":{"type":"DATE_PICKER"},"description":"Only return invoices dated on or after this date (YYYY-MM-DD)."}
   * @paramDef {"type":"String","label":"To Date","name":"toDate","uiComponent":{"type":"DATE_PICKER"},"description":"Only return invoices dated on or before this date (YYYY-MM-DD)."}
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Free-text filter matching invoice number, reference, or contact name."}
   * @paramDef {"type":"String","label":"Updated or Created Since","name":"updatedOrCreatedSince","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Only return invoices created or updated at or after this ISO 8601 timestamp."}
   * @paramDef {"type":"Number","label":"Items Per Page","name":"itemsPerPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of invoices per page. Range: 1-200. Default: 20."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve. Default: 1."}
   *
   * @returns {Object}
   * @sampleResult {"$total":1,"$page":1,"$itemsPerPage":20,"$items":[{"id":"b2c3d4e5f6a1","displayed_as":"SI-2026-001"}]}
   */
  async listSalesInvoices(statusId, contactId, fromDate, toDate, search, updatedOrCreatedSince, itemsPerPage, page) {
    return this.#apiRequest({
      logTag: 'listSalesInvoices',
      url: `${ API_BASE_URL }/sales_invoices`,
      query: {
        status_id: statusId,
        contact_id: contactId,
        from_date: this.#toDate(fromDate),
        to_date: this.#toDate(toDate),
        search,
        updated_or_created_since: this.#toDateTime(updatedOrCreatedSince),
        ...this.#pagingQuery(itemsPerPage, page),
      },
    })
  }

  /**
   * @description Retrieves the full record of a single sales invoice by id, including all invoice lines, tax analysis, totals, outstanding amount, status, and payment allocations.
   *
   * @route GET /get-sales-invoice
   * @operationName Get Sales Invoice
   * @category Sales Invoices
   *
   * @paramDef {"type":"String","label":"Sales Invoice ID","name":"salesInvoiceId","required":true,"description":"The unique id of the sales invoice to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":"b2c3d4e5f6a1","displayed_as":"SI-2026-001","invoice_number":"SI-2026-001","contact":{"id":"a1b2c3d4e5f6","displayed_as":"Acme Corp"},"date":"2026-07-01","due_date":"2026-07-31","total_amount":"1200.00","outstanding_amount":"1200.00","status":{"id":"SENT"}}
   */
  async getSalesInvoice(salesInvoiceId) {
    if (!salesInvoiceId) {
      throw new Error('"Sales Invoice ID" is required')
    }

    return this.#apiRequest({
      logTag: 'getSalesInvoice',
      url: `${ API_BASE_URL }/sales_invoices/${ encodeURIComponent(salesInvoiceId) }`,
      query: { attributes: 'all' },
    })
  }

  /**
   * @description Creates a sales invoice for a customer with one or more invoice lines. Each line requires a description, ledger account, quantity, and unit price, and may reference a product or service, a tax rate, and a discount. Optionally sets a due date, reference, notes, terms and conditions, currency, and exchange rate. Returns the created invoice with its assigned invoice number and calculated totals.
   *
   * @route POST /create-sales-invoice
   * @operationName Create Sales Invoice
   * @category Sales Invoices
   *
   * @paramDef {"type":"String","label":"Contact","name":"contactId","required":true,"dictionary":"getContactsDictionary","description":"The customer to invoice."}
   * @paramDef {"type":"String","label":"Date","name":"date","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"The invoice issue date (YYYY-MM-DD)."}
   * @paramDef {"type":"Array<SalesInvoiceLine>","label":"Invoice Lines","name":"invoiceLines","required":true,"description":"The invoice line items. At least one line is required."}
   * @paramDef {"type":"String","label":"Due Date","name":"dueDate","uiComponent":{"type":"DATE_PICKER"},"description":"Optional payment due date (YYYY-MM-DD). Defaults from the customer's credit terms."}
   * @paramDef {"type":"String","label":"Reference","name":"reference","description":"Optional reference shown on the invoice."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional notes shown on the invoice."}
   * @paramDef {"type":"String","label":"Terms and Conditions","name":"termsAndConditions","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional terms and conditions text shown on the invoice."}
   * @paramDef {"type":"String","label":"Currency","name":"currencyId","description":"Optional ISO currency id (e.g. 'GBP', 'USD'). Requires multi-currency to differ from the base currency."}
   * @paramDef {"type":"Number","label":"Exchange Rate","name":"exchangeRate","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional exchange rate to the base currency when invoicing in a foreign currency."}
   *
   * @returns {Object}
   * @sampleResult {"id":"b2c3d4e5f6a1","displayed_as":"SI-2026-001","invoice_number":"SI-2026-001","date":"2026-07-01","due_date":"2026-07-31","total_amount":"1200.00","status":{"id":"DRAFT"}}
   */
  async createSalesInvoice(contactId, date, invoiceLines, dueDate, reference, notes, termsAndConditions, currencyId, exchangeRate) {
    if (!contactId) {
      throw new Error('"Contact" is required')
    }

    if (!date) {
      throw new Error('"Date" is required')
    }

    const salesInvoice = cleanupObject({
      contact_id: contactId,
      date: this.#toDate(date),
      due_date: this.#toDate(dueDate),
      reference,
      notes,
      terms_and_conditions: termsAndConditions,
      invoice_lines: this.#cleanLines(invoiceLines, 'invoice line'),
      currency_id: currencyId,
      exchange_rate: exchangeRate,
    })

    return this.#apiRequest({
      logTag: 'createSalesInvoice',
      method: 'post',
      url: `${ API_BASE_URL }/sales_invoices`,
      body: { sales_invoice: salesInvoice },
    })
  }

  /**
   * @description Updates an existing sales invoice. Only the provided fields are changed. When Invoice Lines are provided, they replace ALL existing lines. Invoices that already have payments allocated cannot be edited. Returns the updated invoice.
   *
   * @route PUT /update-sales-invoice
   * @operationName Update Sales Invoice
   * @category Sales Invoices
   *
   * @paramDef {"type":"String","label":"Sales Invoice ID","name":"salesInvoiceId","required":true,"description":"The unique id of the sales invoice to update."}
   * @paramDef {"type":"String","label":"Contact","name":"contactId","dictionary":"getContactsDictionary","description":"New customer for the invoice."}
   * @paramDef {"type":"String","label":"Date","name":"date","uiComponent":{"type":"DATE_PICKER"},"description":"New invoice issue date (YYYY-MM-DD)."}
   * @paramDef {"type":"Array<SalesInvoiceLine>","label":"Invoice Lines","name":"invoiceLines","description":"Replacement invoice lines. When provided, ALL existing lines are replaced."}
   * @paramDef {"type":"String","label":"Due Date","name":"dueDate","uiComponent":{"type":"DATE_PICKER"},"description":"New payment due date (YYYY-MM-DD)."}
   * @paramDef {"type":"String","label":"Reference","name":"reference","description":"New reference shown on the invoice."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New notes shown on the invoice."}
   * @paramDef {"type":"String","label":"Terms and Conditions","name":"termsAndConditions","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New terms and conditions text."}
   *
   * @returns {Object}
   * @sampleResult {"id":"b2c3d4e5f6a1","displayed_as":"SI-2026-001","date":"2026-07-02","updated_at":"2026-07-18T10:05:00Z"}
   */
  async updateSalesInvoice(salesInvoiceId, contactId, date, invoiceLines, dueDate, reference, notes, termsAndConditions) {
    if (!salesInvoiceId) {
      throw new Error('"Sales Invoice ID" is required')
    }

    const salesInvoice = cleanupObject({
      contact_id: contactId,
      date: this.#toDate(date),
      due_date: this.#toDate(dueDate),
      reference,
      notes,
      terms_and_conditions: termsAndConditions,
      invoice_lines: invoiceLines ? this.#cleanLines(invoiceLines, 'invoice line') : undefined,
    })

    if (!Object.keys(salesInvoice).length) {
      throw new Error('At least one field to update is required')
    }

    return this.#apiRequest({
      logTag: 'updateSalesInvoice',
      method: 'put',
      url: `${ API_BASE_URL }/sales_invoices/${ encodeURIComponent(salesInvoiceId) }`,
      body: { sales_invoice: salesInvoice },
    })
  }

  /**
   * @description Deletes a sales invoice. Sage only allows deleting invoices with no payments or allocations against them (typically drafts); paid or partially paid invoices must be voided in Sage instead. Returns a success status.
   *
   * @route DELETE /delete-sales-invoice
   * @operationName Delete Sales Invoice
   * @category Sales Invoices
   *
   * @paramDef {"type":"String","label":"Sales Invoice ID","name":"salesInvoiceId","required":true,"description":"The unique id of the sales invoice to delete."}
   *
   * @returns {Object}
   * @sampleResult {"status":"success"}
   */
  async deleteSalesInvoice(salesInvoiceId) {
    if (!salesInvoiceId) {
      throw new Error('"Sales Invoice ID" is required')
    }

    return this.#apiRequest({
      logTag: 'deleteSalesInvoice',
      method: 'delete',
      url: `${ API_BASE_URL }/sales_invoices/${ encodeURIComponent(salesInvoiceId) }`,
    })
  }

  // ======================================== SALES CREDIT NOTES =======================================

  /**
   * @description Retrieves sales credit notes of the connected business, paginated (up to 200 per page). Supports filtering by status, customer, date range, free-text search, and last-modified timestamp.
   *
   * @route GET /list-sales-credit-notes
   * @operationName List Sales Credit Notes
   * @category Sales Credit Notes
   *
   * @paramDef {"type":"String","label":"Status","name":"statusId","dictionary":"getArtefactStatusesDictionary","description":"Optional status filter (e.g. Draft, Sent, Paid, Void)."}
   * @paramDef {"type":"String","label":"Contact","name":"contactId","dictionary":"getContactsDictionary","description":"Optional customer filter: only credit notes for this contact."}
   * @paramDef {"type":"String","label":"From Date","name":"fromDate","uiComponent":{"type":"DATE_PICKER"},"description":"Only return credit notes dated on or after this date (YYYY-MM-DD)."}
   * @paramDef {"type":"String","label":"To Date","name":"toDate","uiComponent":{"type":"DATE_PICKER"},"description":"Only return credit notes dated on or before this date (YYYY-MM-DD)."}
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Free-text filter matching credit note number, reference, or contact name."}
   * @paramDef {"type":"String","label":"Updated or Created Since","name":"updatedOrCreatedSince","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Only return credit notes created or updated at or after this ISO 8601 timestamp."}
   * @paramDef {"type":"Number","label":"Items Per Page","name":"itemsPerPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of credit notes per page. Range: 1-200. Default: 20."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve. Default: 1."}
   *
   * @returns {Object}
   * @sampleResult {"$total":1,"$page":1,"$itemsPerPage":20,"$items":[{"id":"c3d4e5f6a1b2","displayed_as":"SCN-2026-001"}]}
   */
  async listSalesCreditNotes(statusId, contactId, fromDate, toDate, search, updatedOrCreatedSince, itemsPerPage, page) {
    return this.#apiRequest({
      logTag: 'listSalesCreditNotes',
      url: `${ API_BASE_URL }/sales_credit_notes`,
      query: {
        status_id: statusId,
        contact_id: contactId,
        from_date: this.#toDate(fromDate),
        to_date: this.#toDate(toDate),
        search,
        updated_or_created_since: this.#toDateTime(updatedOrCreatedSince),
        ...this.#pagingQuery(itemsPerPage, page),
      },
    })
  }

  /**
   * @description Retrieves the full record of a single sales credit note by id, including all credit note lines, tax analysis, totals, and allocation details.
   *
   * @route GET /get-sales-credit-note
   * @operationName Get Sales Credit Note
   * @category Sales Credit Notes
   *
   * @paramDef {"type":"String","label":"Sales Credit Note ID","name":"salesCreditNoteId","required":true,"description":"The unique id of the sales credit note to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":"c3d4e5f6a1b2","displayed_as":"SCN-2026-001","contact":{"id":"a1b2c3d4e5f6","displayed_as":"Acme Corp"},"date":"2026-07-05","total_amount":"200.00","status":{"id":"SENT"}}
   */
  async getSalesCreditNote(salesCreditNoteId) {
    if (!salesCreditNoteId) {
      throw new Error('"Sales Credit Note ID" is required')
    }

    return this.#apiRequest({
      logTag: 'getSalesCreditNote',
      url: `${ API_BASE_URL }/sales_credit_notes/${ encodeURIComponent(salesCreditNoteId) }`,
      query: { attributes: 'all' },
    })
  }

  /**
   * @description Creates a sales credit note for a customer with one or more credit note lines (same line structure as sales invoice lines). Optionally sets a reference and notes. Returns the created credit note with calculated totals.
   *
   * @route POST /create-sales-credit-note
   * @operationName Create Sales Credit Note
   * @category Sales Credit Notes
   *
   * @paramDef {"type":"String","label":"Contact","name":"contactId","required":true,"dictionary":"getContactsDictionary","description":"The customer to credit."}
   * @paramDef {"type":"String","label":"Date","name":"date","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"The credit note issue date (YYYY-MM-DD)."}
   * @paramDef {"type":"Array<SalesInvoiceLine>","label":"Credit Note Lines","name":"creditNoteLines","required":true,"description":"The credit note line items. At least one line is required."}
   * @paramDef {"type":"String","label":"Reference","name":"reference","description":"Optional reference shown on the credit note."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional notes shown on the credit note."}
   *
   * @returns {Object}
   * @sampleResult {"id":"c3d4e5f6a1b2","displayed_as":"SCN-2026-001","date":"2026-07-05","total_amount":"200.00","status":{"id":"DRAFT"}}
   */
  async createSalesCreditNote(contactId, date, creditNoteLines, reference, notes) {
    if (!contactId) {
      throw new Error('"Contact" is required')
    }

    if (!date) {
      throw new Error('"Date" is required')
    }

    const salesCreditNote = cleanupObject({
      contact_id: contactId,
      date: this.#toDate(date),
      reference,
      notes,
      credit_note_lines: this.#cleanLines(creditNoteLines, 'credit note line'),
    })

    return this.#apiRequest({
      logTag: 'createSalesCreditNote',
      method: 'post',
      url: `${ API_BASE_URL }/sales_credit_notes`,
      body: { sales_credit_note: salesCreditNote },
    })
  }

  /**
   * @description Updates an existing sales credit note. Only the provided fields are changed. When Credit Note Lines are provided, they replace ALL existing lines. Credit notes that are already allocated cannot be edited. Returns the updated credit note.
   *
   * @route PUT /update-sales-credit-note
   * @operationName Update Sales Credit Note
   * @category Sales Credit Notes
   *
   * @paramDef {"type":"String","label":"Sales Credit Note ID","name":"salesCreditNoteId","required":true,"description":"The unique id of the sales credit note to update."}
   * @paramDef {"type":"String","label":"Contact","name":"contactId","dictionary":"getContactsDictionary","description":"New customer for the credit note."}
   * @paramDef {"type":"String","label":"Date","name":"date","uiComponent":{"type":"DATE_PICKER"},"description":"New credit note issue date (YYYY-MM-DD)."}
   * @paramDef {"type":"Array<SalesInvoiceLine>","label":"Credit Note Lines","name":"creditNoteLines","description":"Replacement credit note lines. When provided, ALL existing lines are replaced."}
   * @paramDef {"type":"String","label":"Reference","name":"reference","description":"New reference shown on the credit note."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New notes shown on the credit note."}
   *
   * @returns {Object}
   * @sampleResult {"id":"c3d4e5f6a1b2","displayed_as":"SCN-2026-001","date":"2026-07-06","updated_at":"2026-07-18T10:05:00Z"}
   */
  async updateSalesCreditNote(salesCreditNoteId, contactId, date, creditNoteLines, reference, notes) {
    if (!salesCreditNoteId) {
      throw new Error('"Sales Credit Note ID" is required')
    }

    const salesCreditNote = cleanupObject({
      contact_id: contactId,
      date: this.#toDate(date),
      reference,
      notes,
      credit_note_lines: creditNoteLines ? this.#cleanLines(creditNoteLines, 'credit note line') : undefined,
    })

    if (!Object.keys(salesCreditNote).length) {
      throw new Error('At least one field to update is required')
    }

    return this.#apiRequest({
      logTag: 'updateSalesCreditNote',
      method: 'put',
      url: `${ API_BASE_URL }/sales_credit_notes/${ encodeURIComponent(salesCreditNoteId) }`,
      body: { sales_credit_note: salesCreditNote },
    })
  }

  /**
   * @description Deletes a sales credit note. Sage only allows deleting credit notes that are not allocated to any invoice or payment. Returns a success status.
   *
   * @route DELETE /delete-sales-credit-note
   * @operationName Delete Sales Credit Note
   * @category Sales Credit Notes
   *
   * @paramDef {"type":"String","label":"Sales Credit Note ID","name":"salesCreditNoteId","required":true,"description":"The unique id of the sales credit note to delete."}
   *
   * @returns {Object}
   * @sampleResult {"status":"success"}
   */
  async deleteSalesCreditNote(salesCreditNoteId) {
    if (!salesCreditNoteId) {
      throw new Error('"Sales Credit Note ID" is required')
    }

    return this.#apiRequest({
      logTag: 'deleteSalesCreditNote',
      method: 'delete',
      url: `${ API_BASE_URL }/sales_credit_notes/${ encodeURIComponent(salesCreditNoteId) }`,
    })
  }

  // =========================================== SALES QUOTES ==========================================

  /**
   * @description Retrieves sales quotes (estimates) of the connected business, paginated (up to 200 per page). Supports filtering by customer, date range, free-text search, and last-modified timestamp.
   *
   * @route GET /list-sales-quotes
   * @operationName List Sales Quotes
   * @category Sales Quotes
   *
   * @paramDef {"type":"String","label":"Contact","name":"contactId","dictionary":"getContactsDictionary","description":"Optional customer filter: only quotes for this contact."}
   * @paramDef {"type":"String","label":"From Date","name":"fromDate","uiComponent":{"type":"DATE_PICKER"},"description":"Only return quotes dated on or after this date (YYYY-MM-DD)."}
   * @paramDef {"type":"String","label":"To Date","name":"toDate","uiComponent":{"type":"DATE_PICKER"},"description":"Only return quotes dated on or before this date (YYYY-MM-DD)."}
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Free-text filter matching quote number, reference, or contact name."}
   * @paramDef {"type":"String","label":"Updated or Created Since","name":"updatedOrCreatedSince","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Only return quotes created or updated at or after this ISO 8601 timestamp."}
   * @paramDef {"type":"Number","label":"Items Per Page","name":"itemsPerPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of quotes per page. Range: 1-200. Default: 20."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve. Default: 1."}
   *
   * @returns {Object}
   * @sampleResult {"$total":1,"$page":1,"$itemsPerPage":20,"$items":[{"id":"d4e5f6a1b2c3","displayed_as":"SQ-2026-001"}]}
   */
  async listSalesQuotes(contactId, fromDate, toDate, search, updatedOrCreatedSince, itemsPerPage, page) {
    return this.#apiRequest({
      logTag: 'listSalesQuotes',
      url: `${ API_BASE_URL }/sales_quotes`,
      query: {
        contact_id: contactId,
        from_date: this.#toDate(fromDate),
        to_date: this.#toDate(toDate),
        search,
        updated_or_created_since: this.#toDateTime(updatedOrCreatedSince),
        ...this.#pagingQuery(itemsPerPage, page),
      },
    })
  }

  /**
   * @description Retrieves the full record of a single sales quote by id, including all quote lines, tax analysis, totals, expiry date, and status.
   *
   * @route GET /get-sales-quote
   * @operationName Get Sales Quote
   * @category Sales Quotes
   *
   * @paramDef {"type":"String","label":"Sales Quote ID","name":"salesQuoteId","required":true,"description":"The unique id of the sales quote to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":"d4e5f6a1b2c3","displayed_as":"SQ-2026-001","contact":{"id":"a1b2c3d4e5f6","displayed_as":"Acme Corp"},"date":"2026-07-01","expiry_date":"2026-07-31","total_amount":"5000.00"}
   */
  async getSalesQuote(salesQuoteId) {
    if (!salesQuoteId) {
      throw new Error('"Sales Quote ID" is required')
    }

    return this.#apiRequest({
      logTag: 'getSalesQuote',
      url: `${ API_BASE_URL }/sales_quotes/${ encodeURIComponent(salesQuoteId) }`,
      query: { attributes: 'all' },
    })
  }

  /**
   * @description Creates a sales quote (estimate) for a customer with one or more quote lines (same line structure as sales invoice lines). Optionally sets an expiry date, reference, and notes. Returns the created quote with calculated totals.
   *
   * @route POST /create-sales-quote
   * @operationName Create Sales Quote
   * @category Sales Quotes
   *
   * @paramDef {"type":"String","label":"Contact","name":"contactId","required":true,"dictionary":"getContactsDictionary","description":"The customer to quote."}
   * @paramDef {"type":"String","label":"Date","name":"date","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"The quote issue date (YYYY-MM-DD)."}
   * @paramDef {"type":"Array<SalesInvoiceLine>","label":"Quote Lines","name":"quoteLines","required":true,"description":"The quote line items. At least one line is required."}
   * @paramDef {"type":"String","label":"Expiry Date","name":"expiryDate","uiComponent":{"type":"DATE_PICKER"},"description":"Optional date the quote expires (YYYY-MM-DD)."}
   * @paramDef {"type":"String","label":"Reference","name":"reference","description":"Optional reference shown on the quote."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional notes shown on the quote."}
   *
   * @returns {Object}
   * @sampleResult {"id":"d4e5f6a1b2c3","displayed_as":"SQ-2026-001","date":"2026-07-01","expiry_date":"2026-07-31","total_amount":"5000.00"}
   */
  async createSalesQuote(contactId, date, quoteLines, expiryDate, reference, notes) {
    if (!contactId) {
      throw new Error('"Contact" is required')
    }

    if (!date) {
      throw new Error('"Date" is required')
    }

    const salesQuote = cleanupObject({
      contact_id: contactId,
      date: this.#toDate(date),
      expiry_date: this.#toDate(expiryDate),
      reference,
      notes,
      quote_lines: this.#cleanLines(quoteLines, 'quote line'),
    })

    return this.#apiRequest({
      logTag: 'createSalesQuote',
      method: 'post',
      url: `${ API_BASE_URL }/sales_quotes`,
      body: { sales_quote: salesQuote },
    })
  }

  /**
   * @description Updates an existing sales quote. Only the provided fields are changed. When Quote Lines are provided, they replace ALL existing lines. Returns the updated quote.
   *
   * @route PUT /update-sales-quote
   * @operationName Update Sales Quote
   * @category Sales Quotes
   *
   * @paramDef {"type":"String","label":"Sales Quote ID","name":"salesQuoteId","required":true,"description":"The unique id of the sales quote to update."}
   * @paramDef {"type":"String","label":"Contact","name":"contactId","dictionary":"getContactsDictionary","description":"New customer for the quote."}
   * @paramDef {"type":"String","label":"Date","name":"date","uiComponent":{"type":"DATE_PICKER"},"description":"New quote issue date (YYYY-MM-DD)."}
   * @paramDef {"type":"Array<SalesInvoiceLine>","label":"Quote Lines","name":"quoteLines","description":"Replacement quote lines. When provided, ALL existing lines are replaced."}
   * @paramDef {"type":"String","label":"Expiry Date","name":"expiryDate","uiComponent":{"type":"DATE_PICKER"},"description":"New expiry date (YYYY-MM-DD)."}
   * @paramDef {"type":"String","label":"Reference","name":"reference","description":"New reference shown on the quote."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New notes shown on the quote."}
   *
   * @returns {Object}
   * @sampleResult {"id":"d4e5f6a1b2c3","displayed_as":"SQ-2026-001","date":"2026-07-02","updated_at":"2026-07-18T10:05:00Z"}
   */
  async updateSalesQuote(salesQuoteId, contactId, date, quoteLines, expiryDate, reference, notes) {
    if (!salesQuoteId) {
      throw new Error('"Sales Quote ID" is required')
    }

    const salesQuote = cleanupObject({
      contact_id: contactId,
      date: this.#toDate(date),
      expiry_date: this.#toDate(expiryDate),
      reference,
      notes,
      quote_lines: quoteLines ? this.#cleanLines(quoteLines, 'quote line') : undefined,
    })

    if (!Object.keys(salesQuote).length) {
      throw new Error('At least one field to update is required')
    }

    return this.#apiRequest({
      logTag: 'updateSalesQuote',
      method: 'put',
      url: `${ API_BASE_URL }/sales_quotes/${ encodeURIComponent(salesQuoteId) }`,
      body: { sales_quote: salesQuote },
    })
  }

  /**
   * @description Deletes a sales quote. Quotes that have been converted to an invoice cannot be deleted. Returns a success status.
   *
   * @route DELETE /delete-sales-quote
   * @operationName Delete Sales Quote
   * @category Sales Quotes
   *
   * @paramDef {"type":"String","label":"Sales Quote ID","name":"salesQuoteId","required":true,"description":"The unique id of the sales quote to delete."}
   *
   * @returns {Object}
   * @sampleResult {"status":"success"}
   */
  async deleteSalesQuote(salesQuoteId) {
    if (!salesQuoteId) {
      throw new Error('"Sales Quote ID" is required')
    }

    return this.#apiRequest({
      logTag: 'deleteSalesQuote',
      method: 'delete',
      url: `${ API_BASE_URL }/sales_quotes/${ encodeURIComponent(salesQuoteId) }`,
    })
  }

  // ======================================== PURCHASE INVOICES ========================================

  /**
   * @typedef {Object} PurchaseInvoiceLine
   * @paramDef {"type":"String","label":"Description","name":"description","required":true,"description":"The line item description."}
   * @paramDef {"type":"String","label":"Ledger Account ID","name":"ledger_account_id","required":true,"dictionary":"getLedgerAccountsDictionary","description":"The ledger account to post this line to."}
   * @paramDef {"type":"Number","label":"Quantity","name":"quantity","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The quantity of units for this line."}
   * @paramDef {"type":"Number","label":"Unit Price","name":"unit_price","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The net price per unit."}
   * @paramDef {"type":"String","label":"Tax Rate ID","name":"tax_rate_id","dictionary":"getTaxRatesDictionary","description":"The tax rate to apply to this line."}
   * @paramDef {"type":"String","label":"Product ID","name":"product_id","dictionary":"getProductsDictionary","description":"Optional product this line refers to."}
   */

  /**
   * @description Retrieves purchase invoices (vendor bills) of the connected business, paginated (up to 200 per page). Supports filtering by vendor, status, issue date range, free-text search, and last-modified timestamp.
   *
   * @route GET /list-purchase-invoices
   * @operationName List Purchase Invoices
   * @category Purchase Invoices
   *
   * @paramDef {"type":"String","label":"Contact","name":"contactId","dictionary":"getContactsDictionary","description":"Optional vendor filter: only invoices from this contact."}
   * @paramDef {"type":"String","label":"Status","name":"statusId","dictionary":"getArtefactStatusesDictionary","description":"Optional status filter (e.g. Paid, Part Paid, Void)."}
   * @paramDef {"type":"String","label":"From Date","name":"fromDate","uiComponent":{"type":"DATE_PICKER"},"description":"Only return invoices dated on or after this date (YYYY-MM-DD)."}
   * @paramDef {"type":"String","label":"To Date","name":"toDate","uiComponent":{"type":"DATE_PICKER"},"description":"Only return invoices dated on or before this date (YYYY-MM-DD)."}
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Free-text filter matching invoice reference or contact name."}
   * @paramDef {"type":"String","label":"Updated or Created Since","name":"updatedOrCreatedSince","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Only return invoices created or updated at or after this ISO 8601 timestamp."}
   * @paramDef {"type":"Number","label":"Items Per Page","name":"itemsPerPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of invoices per page. Range: 1-200. Default: 20."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve. Default: 1."}
   *
   * @returns {Object}
   * @sampleResult {"$total":1,"$page":1,"$itemsPerPage":20,"$items":[{"id":"e5f6a1b2c3d4","displayed_as":"PI-2026-001"}]}
   */
  async listPurchaseInvoices(contactId, statusId, fromDate, toDate, search, updatedOrCreatedSince, itemsPerPage, page) {
    return this.#apiRequest({
      logTag: 'listPurchaseInvoices',
      url: `${ API_BASE_URL }/purchase_invoices`,
      query: {
        contact_id: contactId,
        status_id: statusId,
        from_date: this.#toDate(fromDate),
        to_date: this.#toDate(toDate),
        search,
        updated_or_created_since: this.#toDateTime(updatedOrCreatedSince),
        ...this.#pagingQuery(itemsPerPage, page),
      },
    })
  }

  /**
   * @description Retrieves the full record of a single purchase invoice (vendor bill) by id, including all invoice lines, tax analysis, totals, outstanding amount, and payment allocations.
   *
   * @route GET /get-purchase-invoice
   * @operationName Get Purchase Invoice
   * @category Purchase Invoices
   *
   * @paramDef {"type":"String","label":"Purchase Invoice ID","name":"purchaseInvoiceId","required":true,"description":"The unique id of the purchase invoice to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":"e5f6a1b2c3d4","displayed_as":"PI-2026-001","contact":{"id":"f6e5d4c3b2a1","displayed_as":"Supplies Inc"},"date":"2026-07-01","due_date":"2026-07-31","total_amount":"480.00","outstanding_amount":"480.00"}
   */
  async getPurchaseInvoice(purchaseInvoiceId) {
    if (!purchaseInvoiceId) {
      throw new Error('"Purchase Invoice ID" is required')
    }

    return this.#apiRequest({
      logTag: 'getPurchaseInvoice',
      url: `${ API_BASE_URL }/purchase_invoices/${ encodeURIComponent(purchaseInvoiceId) }`,
      query: { attributes: 'all' },
    })
  }

  /**
   * @description Records a purchase invoice (vendor bill) with one or more invoice lines. Each line requires a description, ledger account, quantity, and unit price, and may reference a product and a tax rate. Optionally sets a due date, the vendor's invoice reference, and notes. Returns the created invoice with calculated totals.
   *
   * @route POST /create-purchase-invoice
   * @operationName Create Purchase Invoice
   * @category Purchase Invoices
   *
   * @paramDef {"type":"String","label":"Contact","name":"contactId","required":true,"dictionary":"getContactsDictionary","description":"The vendor the invoice was received from."}
   * @paramDef {"type":"String","label":"Date","name":"date","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"The invoice issue date (YYYY-MM-DD)."}
   * @paramDef {"type":"Array<PurchaseInvoiceLine>","label":"Invoice Lines","name":"invoiceLines","required":true,"description":"The invoice line items. At least one line is required."}
   * @paramDef {"type":"String","label":"Due Date","name":"dueDate","uiComponent":{"type":"DATE_PICKER"},"description":"Optional payment due date (YYYY-MM-DD). Defaults from the vendor's credit terms."}
   * @paramDef {"type":"String","label":"Reference","name":"reference","description":"Optional reference, typically the vendor's own invoice number."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional internal notes."}
   *
   * @returns {Object}
   * @sampleResult {"id":"e5f6a1b2c3d4","displayed_as":"PI-2026-001","date":"2026-07-01","due_date":"2026-07-31","total_amount":"480.00"}
   */
  async createPurchaseInvoice(contactId, date, invoiceLines, dueDate, reference, notes) {
    if (!contactId) {
      throw new Error('"Contact" is required')
    }

    if (!date) {
      throw new Error('"Date" is required')
    }

    const purchaseInvoice = cleanupObject({
      contact_id: contactId,
      date: this.#toDate(date),
      due_date: this.#toDate(dueDate),
      reference,
      notes,
      invoice_lines: this.#cleanLines(invoiceLines, 'invoice line'),
    })

    return this.#apiRequest({
      logTag: 'createPurchaseInvoice',
      method: 'post',
      url: `${ API_BASE_URL }/purchase_invoices`,
      body: { purchase_invoice: purchaseInvoice },
    })
  }

  /**
   * @description Updates an existing purchase invoice. Only the provided fields are changed. When Invoice Lines are provided, they replace ALL existing lines. Invoices with payments allocated cannot be edited. Returns the updated invoice.
   *
   * @route PUT /update-purchase-invoice
   * @operationName Update Purchase Invoice
   * @category Purchase Invoices
   *
   * @paramDef {"type":"String","label":"Purchase Invoice ID","name":"purchaseInvoiceId","required":true,"description":"The unique id of the purchase invoice to update."}
   * @paramDef {"type":"String","label":"Contact","name":"contactId","dictionary":"getContactsDictionary","description":"New vendor for the invoice."}
   * @paramDef {"type":"String","label":"Date","name":"date","uiComponent":{"type":"DATE_PICKER"},"description":"New invoice issue date (YYYY-MM-DD)."}
   * @paramDef {"type":"Array<PurchaseInvoiceLine>","label":"Invoice Lines","name":"invoiceLines","description":"Replacement invoice lines. When provided, ALL existing lines are replaced."}
   * @paramDef {"type":"String","label":"Due Date","name":"dueDate","uiComponent":{"type":"DATE_PICKER"},"description":"New payment due date (YYYY-MM-DD)."}
   * @paramDef {"type":"String","label":"Reference","name":"reference","description":"New reference (vendor's invoice number)."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New internal notes."}
   *
   * @returns {Object}
   * @sampleResult {"id":"e5f6a1b2c3d4","displayed_as":"PI-2026-001","date":"2026-07-02","updated_at":"2026-07-18T10:05:00Z"}
   */
  async updatePurchaseInvoice(purchaseInvoiceId, contactId, date, invoiceLines, dueDate, reference, notes) {
    if (!purchaseInvoiceId) {
      throw new Error('"Purchase Invoice ID" is required')
    }

    const purchaseInvoice = cleanupObject({
      contact_id: contactId,
      date: this.#toDate(date),
      due_date: this.#toDate(dueDate),
      reference,
      notes,
      invoice_lines: invoiceLines ? this.#cleanLines(invoiceLines, 'invoice line') : undefined,
    })

    if (!Object.keys(purchaseInvoice).length) {
      throw new Error('At least one field to update is required')
    }

    return this.#apiRequest({
      logTag: 'updatePurchaseInvoice',
      method: 'put',
      url: `${ API_BASE_URL }/purchase_invoices/${ encodeURIComponent(purchaseInvoiceId) }`,
      body: { purchase_invoice: purchaseInvoice },
    })
  }

  /**
   * @description Deletes a purchase invoice. Sage only allows deleting invoices with no payments or allocations against them; paid invoices must be voided in Sage instead. Returns a success status.
   *
   * @route DELETE /delete-purchase-invoice
   * @operationName Delete Purchase Invoice
   * @category Purchase Invoices
   *
   * @paramDef {"type":"String","label":"Purchase Invoice ID","name":"purchaseInvoiceId","required":true,"description":"The unique id of the purchase invoice to delete."}
   *
   * @returns {Object}
   * @sampleResult {"status":"success"}
   */
  async deletePurchaseInvoice(purchaseInvoiceId) {
    if (!purchaseInvoiceId) {
      throw new Error('"Purchase Invoice ID" is required')
    }

    return this.#apiRequest({
      logTag: 'deletePurchaseInvoice',
      method: 'delete',
      url: `${ API_BASE_URL }/purchase_invoices/${ encodeURIComponent(purchaseInvoiceId) }`,
    })
  }

  // ============================================= PRODUCTS ============================================

  /**
   * @description Retrieves the business's products, paginated (up to 200 per page). Supports free-text search on description and item code, and a last-modified timestamp filter.
   *
   * @route GET /list-products
   * @operationName List Products
   * @category Products
   *
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Free-text filter matching the product description or item code."}
   * @paramDef {"type":"String","label":"Updated or Created Since","name":"updatedOrCreatedSince","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Only return products created or updated at or after this ISO 8601 timestamp."}
   * @paramDef {"type":"Number","label":"Items Per Page","name":"itemsPerPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of products per page. Range: 1-200. Default: 20."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve. Default: 1."}
   *
   * @returns {Object}
   * @sampleResult {"$total":1,"$page":1,"$itemsPerPage":20,"$items":[{"id":"d4e5f6a1b2c3","displayed_as":"Widget Pro"}]}
   */
  async listProducts(search, updatedOrCreatedSince, itemsPerPage, page) {
    return this.#apiRequest({
      logTag: 'listProducts',
      url: `${ API_BASE_URL }/products`,
      query: {
        search,
        updated_or_created_since: this.#toDateTime(updatedOrCreatedSince),
        ...this.#pagingQuery(itemsPerPage, page),
      },
    })
  }

  /**
   * @description Retrieves the full record of a single product by id, including item code, ledger accounts, cost price, sales prices, and notes.
   *
   * @route GET /get-product
   * @operationName Get Product
   * @category Products
   *
   * @paramDef {"type":"String","label":"Product","name":"productId","required":true,"dictionary":"getProductsDictionary","description":"The product to retrieve. Select a product or provide its id."}
   *
   * @returns {Object}
   * @sampleResult {"id":"d4e5f6a1b2c3","displayed_as":"Widget Pro","description":"Widget Pro","item_code":"WID-001","cost_price":"10.00","sales_prices":[{"price_name":"Sales Price","price":"25.00"}]}
   */
  async getProduct(productId) {
    if (!productId) {
      throw new Error('"Product" is required')
    }

    return this.#apiRequest({
      logTag: 'getProduct',
      url: `${ API_BASE_URL }/products/${ encodeURIComponent(productId) }`,
      query: { attributes: 'all' },
    })
  }

  /**
   * @description Creates a product in the business's catalog. Requires a description; optionally sets an item code, default sales and purchase ledger accounts, cost price, a standard sales price, and notes. Returns the created product.
   *
   * @route POST /create-product
   * @operationName Create Product
   * @category Products
   *
   * @paramDef {"type":"String","label":"Description","name":"description","required":true,"description":"The product name/description shown on documents."}
   * @paramDef {"type":"String","label":"Item Code","name":"itemCode","description":"Optional unique item code (SKU) for the product."}
   * @paramDef {"type":"String","label":"Sales Ledger Account","name":"salesLedgerAccountId","dictionary":"getLedgerAccountsDictionary","description":"Optional default ledger account for sales of this product."}
   * @paramDef {"type":"String","label":"Purchase Ledger Account","name":"purchaseLedgerAccountId","dictionary":"getLedgerAccountsDictionary","description":"Optional default ledger account for purchases of this product."}
   * @paramDef {"type":"Number","label":"Cost Price","name":"costPrice","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional cost price per unit."}
   * @paramDef {"type":"Number","label":"Sales Price","name":"salesPrice","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional standard sales price per unit, stored as the product's 'Sales Price' entry."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional internal notes about the product."}
   *
   * @returns {Object}
   * @sampleResult {"id":"d4e5f6a1b2c3","displayed_as":"Widget Pro","description":"Widget Pro","item_code":"WID-001","created_at":"2026-07-18T10:00:00Z"}
   */
  async createProduct(description, itemCode, salesLedgerAccountId, purchaseLedgerAccountId, costPrice, salesPrice, notes) {
    if (!description) {
      throw new Error('"Description" is required')
    }

    const product = cleanupObject({
      description,
      item_code: itemCode,
      sales_ledger_account_id: salesLedgerAccountId,
      purchase_ledger_account_id: purchaseLedgerAccountId,
      cost_price: costPrice,
      sales_prices: salesPrice !== undefined && salesPrice !== null
        ? [{ price_name: 'Sales Price', price: salesPrice }]
        : undefined,
      notes,
    })

    return this.#apiRequest({
      logTag: 'createProduct',
      method: 'post',
      url: `${ API_BASE_URL }/products`,
      body: { product },
    })
  }

  /**
   * @description Updates an existing product. Only the provided fields are changed. When Sales Price is provided, it replaces the product's sales price entries. Returns the updated product.
   *
   * @route PUT /update-product
   * @operationName Update Product
   * @category Products
   *
   * @paramDef {"type":"String","label":"Product","name":"productId","required":true,"dictionary":"getProductsDictionary","description":"The product to update. Select a product or provide its id."}
   * @paramDef {"type":"String","label":"Description","name":"description","description":"New product name/description."}
   * @paramDef {"type":"String","label":"Item Code","name":"itemCode","description":"New unique item code (SKU)."}
   * @paramDef {"type":"String","label":"Sales Ledger Account","name":"salesLedgerAccountId","dictionary":"getLedgerAccountsDictionary","description":"New default ledger account for sales of this product."}
   * @paramDef {"type":"String","label":"Purchase Ledger Account","name":"purchaseLedgerAccountId","dictionary":"getLedgerAccountsDictionary","description":"New default ledger account for purchases of this product."}
   * @paramDef {"type":"Number","label":"Cost Price","name":"costPrice","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"New cost price per unit."}
   * @paramDef {"type":"Number","label":"Sales Price","name":"salesPrice","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"New standard sales price per unit. Replaces the existing sales price entries."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New internal notes."}
   *
   * @returns {Object}
   * @sampleResult {"id":"d4e5f6a1b2c3","displayed_as":"Widget Pro v2","description":"Widget Pro v2","updated_at":"2026-07-18T10:05:00Z"}
   */
  async updateProduct(productId, description, itemCode, salesLedgerAccountId, purchaseLedgerAccountId, costPrice, salesPrice, notes) {
    if (!productId) {
      throw new Error('"Product" is required')
    }

    const product = cleanupObject({
      description,
      item_code: itemCode,
      sales_ledger_account_id: salesLedgerAccountId,
      purchase_ledger_account_id: purchaseLedgerAccountId,
      cost_price: costPrice,
      sales_prices: salesPrice !== undefined && salesPrice !== null
        ? [{ price_name: 'Sales Price', price: salesPrice }]
        : undefined,
      notes,
    })

    if (!Object.keys(product).length) {
      throw new Error('At least one field to update is required')
    }

    return this.#apiRequest({
      logTag: 'updateProduct',
      method: 'put',
      url: `${ API_BASE_URL }/products/${ encodeURIComponent(productId) }`,
      body: { product },
    })
  }

  /**
   * @description Deletes a product from the catalog. Products already used on invoices or other artefacts may not be deletable. Returns a success status.
   *
   * @route DELETE /delete-product
   * @operationName Delete Product
   * @category Products
   *
   * @paramDef {"type":"String","label":"Product","name":"productId","required":true,"dictionary":"getProductsDictionary","description":"The product to delete. Select a product or provide its id."}
   *
   * @returns {Object}
   * @sampleResult {"status":"success"}
   */
  async deleteProduct(productId) {
    if (!productId) {
      throw new Error('"Product" is required')
    }

    return this.#apiRequest({
      logTag: 'deleteProduct',
      method: 'delete',
      url: `${ API_BASE_URL }/products/${ encodeURIComponent(productId) }`,
    })
  }

  // ========================================= SERVICE ITEMS ===========================================

  /**
   * @description Retrieves the business's service items, paginated (up to 200 per page). Supports free-text search on description and item code, and a last-modified timestamp filter.
   *
   * @route GET /list-services
   * @operationName List Services
   * @category Services
   *
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Free-text filter matching the service description or item code."}
   * @paramDef {"type":"String","label":"Updated or Created Since","name":"updatedOrCreatedSince","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Only return services created or updated at or after this ISO 8601 timestamp."}
   * @paramDef {"type":"Number","label":"Items Per Page","name":"itemsPerPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of services per page. Range: 1-200. Default: 20."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve. Default: 1."}
   *
   * @returns {Object}
   * @sampleResult {"$total":1,"$page":1,"$itemsPerPage":20,"$items":[{"id":"e5f6a1b2c3d4","displayed_as":"Consulting Hour"}]}
   */
  async listServices(search, updatedOrCreatedSince, itemsPerPage, page) {
    return this.#apiRequest({
      logTag: 'listServices',
      url: `${ API_BASE_URL }/services`,
      query: {
        search,
        updated_or_created_since: this.#toDateTime(updatedOrCreatedSince),
        ...this.#pagingQuery(itemsPerPage, page),
      },
    })
  }

  /**
   * @description Retrieves the full record of a single service item by id, including item code, sales ledger account, sales prices, and notes.
   *
   * @route GET /get-service
   * @operationName Get Service
   * @category Services
   *
   * @paramDef {"type":"String","label":"Service","name":"serviceId","required":true,"dictionary":"getServicesDictionary","description":"The service item to retrieve. Select a service or provide its id."}
   *
   * @returns {Object}
   * @sampleResult {"id":"e5f6a1b2c3d4","displayed_as":"Consulting Hour","description":"Consulting Hour","item_code":"CONS-01","sales_prices":[{"price_name":"Sales Price","price":"150.00"}]}
   */
  async getService(serviceId) {
    if (!serviceId) {
      throw new Error('"Service" is required')
    }

    return this.#apiRequest({
      logTag: 'getService',
      url: `${ API_BASE_URL }/services/${ encodeURIComponent(serviceId) }`,
      query: { attributes: 'all' },
    })
  }

  /**
   * @description Creates a service item in the business's catalog. Requires a description; optionally sets an item code, a default sales ledger account, a standard sales price, and notes. Returns the created service item.
   *
   * @route POST /create-service
   * @operationName Create Service
   * @category Services
   *
   * @paramDef {"type":"String","label":"Description","name":"description","required":true,"description":"The service name/description shown on documents."}
   * @paramDef {"type":"String","label":"Item Code","name":"itemCode","description":"Optional unique item code for the service."}
   * @paramDef {"type":"String","label":"Sales Ledger Account","name":"salesLedgerAccountId","dictionary":"getLedgerAccountsDictionary","description":"Optional default ledger account for sales of this service."}
   * @paramDef {"type":"Number","label":"Sales Price","name":"salesPrice","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional standard sales price per unit, stored as the service's 'Sales Price' entry."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional internal notes about the service."}
   *
   * @returns {Object}
   * @sampleResult {"id":"e5f6a1b2c3d4","displayed_as":"Consulting Hour","description":"Consulting Hour","item_code":"CONS-01","created_at":"2026-07-18T10:00:00Z"}
   */
  async createService(description, itemCode, salesLedgerAccountId, salesPrice, notes) {
    if (!description) {
      throw new Error('"Description" is required')
    }

    const service = cleanupObject({
      description,
      item_code: itemCode,
      sales_ledger_account_id: salesLedgerAccountId,
      sales_prices: salesPrice !== undefined && salesPrice !== null
        ? [{ price_name: 'Sales Price', price: salesPrice }]
        : undefined,
      notes,
    })

    return this.#apiRequest({
      logTag: 'createService',
      method: 'post',
      url: `${ API_BASE_URL }/services`,
      body: { service },
    })
  }

  /**
   * @description Updates an existing service item. Only the provided fields are changed. When Sales Price is provided, it replaces the service's sales price entries. Returns the updated service item.
   *
   * @route PUT /update-service
   * @operationName Update Service
   * @category Services
   *
   * @paramDef {"type":"String","label":"Service","name":"serviceId","required":true,"dictionary":"getServicesDictionary","description":"The service item to update. Select a service or provide its id."}
   * @paramDef {"type":"String","label":"Description","name":"description","description":"New service name/description."}
   * @paramDef {"type":"String","label":"Item Code","name":"itemCode","description":"New unique item code."}
   * @paramDef {"type":"String","label":"Sales Ledger Account","name":"salesLedgerAccountId","dictionary":"getLedgerAccountsDictionary","description":"New default ledger account for sales of this service."}
   * @paramDef {"type":"Number","label":"Sales Price","name":"salesPrice","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"New standard sales price per unit. Replaces the existing sales price entries."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New internal notes."}
   *
   * @returns {Object}
   * @sampleResult {"id":"e5f6a1b2c3d4","displayed_as":"Consulting Hour","description":"Consulting Hour","updated_at":"2026-07-18T10:05:00Z"}
   */
  async updateService(serviceId, description, itemCode, salesLedgerAccountId, salesPrice, notes) {
    if (!serviceId) {
      throw new Error('"Service" is required')
    }

    const service = cleanupObject({
      description,
      item_code: itemCode,
      sales_ledger_account_id: salesLedgerAccountId,
      sales_prices: salesPrice !== undefined && salesPrice !== null
        ? [{ price_name: 'Sales Price', price: salesPrice }]
        : undefined,
      notes,
    })

    if (!Object.keys(service).length) {
      throw new Error('At least one field to update is required')
    }

    return this.#apiRequest({
      logTag: 'updateService',
      method: 'put',
      url: `${ API_BASE_URL }/services/${ encodeURIComponent(serviceId) }`,
      body: { service },
    })
  }

  /**
   * @description Deletes a service item from the catalog. Services already used on invoices or other artefacts may not be deletable. Returns a success status.
   *
   * @route DELETE /delete-service
   * @operationName Delete Service
   * @category Services
   *
   * @paramDef {"type":"String","label":"Service","name":"serviceId","required":true,"dictionary":"getServicesDictionary","description":"The service item to delete. Select a service or provide its id."}
   *
   * @returns {Object}
   * @sampleResult {"status":"success"}
   */
  async deleteService(serviceId) {
    if (!serviceId) {
      throw new Error('"Service" is required')
    }

    return this.#apiRequest({
      logTag: 'deleteService',
      method: 'delete',
      url: `${ API_BASE_URL }/services/${ encodeURIComponent(serviceId) }`,
    })
  }

  // ========================================= LEDGER ACCOUNTS =========================================

  /**
   * @description Retrieves ledger accounts from the business's chart of accounts, paginated (up to 200 per page). Supports visibility toggles to only return accounts usable in banking, sales, expenses, or journals, and a local-page free-text search.
   *
   * @route GET /list-ledger-accounts
   * @operationName List Ledger Accounts
   * @category Ledger Accounts
   *
   * @paramDef {"type":"Boolean","label":"Visible In Banking","name":"visibleInBanking","uiComponent":{"type":"TOGGLE"},"description":"When enabled, only return accounts selectable in bank transactions."}
   * @paramDef {"type":"Boolean","label":"Visible In Sales","name":"visibleInSales","uiComponent":{"type":"TOGGLE"},"description":"When enabled, only return accounts selectable on sales artefacts."}
   * @paramDef {"type":"Boolean","label":"Visible In Expenses","name":"visibleInExpenses","uiComponent":{"type":"TOGGLE"},"description":"When enabled, only return accounts selectable on purchases/expenses."}
   * @paramDef {"type":"Boolean","label":"Visible In Journals","name":"visibleInJournals","uiComponent":{"type":"TOGGLE"},"description":"When enabled, only return accounts selectable in journals."}
   * @paramDef {"type":"Number","label":"Items Per Page","name":"itemsPerPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of accounts per page. Range: 1-200. Default: 20."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve. Default: 1."}
   *
   * @returns {Object}
   * @sampleResult {"$total":2,"$page":1,"$itemsPerPage":20,"$items":[{"id":"b2c3d4e5f6a1","displayed_as":"Sales Type A (4000)"},{"id":"c3d4e5f6a1b2","displayed_as":"Office costs (7502)"}]}
   */
  async listLedgerAccounts(visibleInBanking, visibleInSales, visibleInExpenses, visibleInJournals, itemsPerPage, page) {
    return this.#apiRequest({
      logTag: 'listLedgerAccounts',
      url: `${ API_BASE_URL }/ledger_accounts`,
      query: {
        visible_in_banking: visibleInBanking || undefined,
        visible_in_sales: visibleInSales || undefined,
        visible_in_expenses: visibleInExpenses || undefined,
        visible_in_journals: visibleInJournals || undefined,
        ...this.#pagingQuery(itemsPerPage, page),
      },
    })
  }

  /**
   * @description Retrieves the full record of a single ledger account by id, including its name, nominal code, ledger account type, tax rate, and visibility settings.
   *
   * @route GET /get-ledger-account
   * @operationName Get Ledger Account
   * @category Ledger Accounts
   *
   * @paramDef {"type":"String","label":"Ledger Account","name":"ledgerAccountId","required":true,"dictionary":"getLedgerAccountsDictionary","description":"The ledger account to retrieve. Select an account or provide its id."}
   *
   * @returns {Object}
   * @sampleResult {"id":"b2c3d4e5f6a1","displayed_as":"Sales Type A (4000)","name":"Sales Type A","nominal_code":4000,"ledger_account_type":{"id":"SALES"}}
   */
  async getLedgerAccount(ledgerAccountId) {
    if (!ledgerAccountId) {
      throw new Error('"Ledger Account" is required')
    }

    return this.#apiRequest({
      logTag: 'getLedgerAccount',
      url: `${ API_BASE_URL }/ledger_accounts/${ encodeURIComponent(ledgerAccountId) }`,
      query: { attributes: 'all' },
    })
  }

  /**
   * @description Creates a new ledger account in the business's chart of accounts. Requires a display name, a nominal code, and a ledger account type. Returns the created ledger account.
   *
   * @route POST /create-ledger-account
   * @operationName Create Ledger Account
   * @category Ledger Accounts
   *
   * @paramDef {"type":"String","label":"Display Name","name":"displayName","required":true,"description":"The name shown for the account in ledgers and reports."}
   * @paramDef {"type":"Number","label":"Nominal Code","name":"nominalCode","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The unique nominal code for the account, e.g. 4000."}
   * @paramDef {"type":"String","label":"Ledger Account Type","name":"ledgerAccountTypeId","required":true,"dictionary":"getLedgerAccountTypesDictionary","description":"The category of the account (e.g. Sales, Overheads, Current Assets)."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"Optional internal name for the account. Defaults to the display name."}
   *
   * @returns {Object}
   * @sampleResult {"id":"f6a1b2c3d4e5","displayed_as":"Consulting Income (4010)","name":"Consulting Income","nominal_code":4010,"ledger_account_type":{"id":"SALES"}}
   */
  async createLedgerAccount(displayName, nominalCode, ledgerAccountTypeId, name) {
    if (!displayName) {
      throw new Error('"Display Name" is required')
    }

    if (nominalCode === undefined || nominalCode === null) {
      throw new Error('"Nominal Code" is required')
    }

    if (!ledgerAccountTypeId) {
      throw new Error('"Ledger Account Type" is required')
    }

    const ledgerAccount = cleanupObject({
      name: name || displayName,
      display_name: displayName,
      nominal_code: nominalCode,
      ledger_account_type_id: ledgerAccountTypeId,
    })

    return this.#apiRequest({
      logTag: 'createLedgerAccount',
      method: 'post',
      url: `${ API_BASE_URL }/ledger_accounts`,
      body: { ledger_account: ledgerAccount },
    })
  }

  // ========================================== BANK ACCOUNTS ==========================================

  /**
   * @description Retrieves the business's bank accounts, paginated. Returns summary bank account objects with id and display name.
   *
   * @route GET /list-bank-accounts
   * @operationName List Bank Accounts
   * @category Bank Accounts
   *
   * @paramDef {"type":"Number","label":"Items Per Page","name":"itemsPerPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of bank accounts per page. Range: 1-200. Default: 20."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve. Default: 1."}
   *
   * @returns {Object}
   * @sampleResult {"$total":1,"$page":1,"$itemsPerPage":20,"$items":[{"id":"c3d4e5f6a1b2","displayed_as":"Current Account (1200)"}]}
   */
  async listBankAccounts(itemsPerPage, page) {
    return this.#apiRequest({
      logTag: 'listBankAccounts',
      url: `${ API_BASE_URL }/bank_accounts`,
      query: this.#pagingQuery(itemsPerPage, page),
    })
  }

  /**
   * @description Retrieves the full record of a single bank account by id, including account details, sort code/IBAN where set, associated ledger account, and current balance.
   *
   * @route GET /get-bank-account
   * @operationName Get Bank Account
   * @category Bank Accounts
   *
   * @paramDef {"type":"String","label":"Bank Account","name":"bankAccountId","required":true,"dictionary":"getBankAccountsDictionary","description":"The bank account to retrieve. Select an account or provide its id."}
   *
   * @returns {Object}
   * @sampleResult {"id":"c3d4e5f6a1b2","displayed_as":"Current Account (1200)","account_name":"Current Account","balance":"10250.00","main_address":null,"ledger_account":{"id":"b2c3d4e5f6a1"}}
   */
  async getBankAccount(bankAccountId) {
    if (!bankAccountId) {
      throw new Error('"Bank Account" is required')
    }

    return this.#apiRequest({
      logTag: 'getBankAccount',
      url: `${ API_BASE_URL }/bank_accounts/${ encodeURIComponent(bankAccountId) }`,
      query: { attributes: 'all' },
    })
  }

  // ========================================= CONTACT PAYMENTS ========================================

  /**
   * @typedef {Object} AllocatedArtefact
   * @paramDef {"type":"String","label":"Artefact ID","name":"artefact_id","required":true,"description":"The id of the invoice or credit note to allocate this payment against."}
   * @paramDef {"type":"Number","label":"Amount","name":"amount","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The amount to allocate to this artefact."}
   */

  /**
   * @description Records a payment or receipt against a contact from a bank account — this is how invoice payments are recorded in Sage. Choose the transaction type (Customer Receipt, Customer Refund, Vendor Payment, or Vendor Refund), then optionally allocate the total across one or more invoices/credit notes via Allocated Artefacts. Unallocated amounts are recorded as a payment on account. Returns the created contact payment.
   *
   * @route POST /create-contact-payment
   * @operationName Create Contact Payment
   * @category Contact Payments
   *
   * @paramDef {"type":"String","label":"Transaction Type","name":"transactionType","required":true,"defaultValue":"Customer Receipt","uiComponent":{"type":"DROPDOWN","options":{"values":["Customer Receipt","Customer Refund","Vendor Payment","Vendor Refund"]}},"description":"The kind of payment: money received from a customer, refunded to a customer, paid to a vendor, or refunded by a vendor."}
   * @paramDef {"type":"String","label":"Contact","name":"contactId","required":true,"dictionary":"getContactsDictionary","description":"The customer or vendor the payment relates to."}
   * @paramDef {"type":"String","label":"Bank Account","name":"bankAccountId","required":true,"dictionary":"getBankAccountsDictionary","description":"The bank account the money moves through."}
   * @paramDef {"type":"String","label":"Date","name":"date","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"The payment date (YYYY-MM-DD)."}
   * @paramDef {"type":"Number","label":"Total Amount","name":"totalAmount","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The total payment amount."}
   * @paramDef {"type":"String","label":"Reference","name":"reference","description":"Optional payment reference, e.g. a bank transaction reference."}
   * @paramDef {"type":"Array<AllocatedArtefact>","label":"Allocated Artefacts","name":"allocatedArtefacts","description":"Optional allocations of the payment against specific invoices or credit notes. The allocated amounts may not exceed the total amount."}
   *
   * @returns {Object}
   * @sampleResult {"id":"a1b2c3d4e5f7","displayed_as":"Customer Receipt","transaction_type":{"id":"CUSTOMER_RECEIPT"},"date":"2026-07-18","total_amount":"1200.00","allocated_artefacts":[{"artefact":{"id":"b2c3d4e5f6a1"},"amount":"1200.00"}]}
   */
  async createContactPayment(transactionType, contactId, bankAccountId, date, totalAmount, reference, allocatedArtefacts) {
    if (!transactionType) {
      throw new Error('"Transaction Type" is required')
    }

    if (!contactId) {
      throw new Error('"Contact" is required')
    }

    if (!bankAccountId) {
      throw new Error('"Bank Account" is required')
    }

    if (!date) {
      throw new Error('"Date" is required')
    }

    if (totalAmount === undefined || totalAmount === null) {
      throw new Error('"Total Amount" is required')
    }

    const contactPayment = cleanupObject({
      transaction_type_id: this.#resolveChoice(transactionType, PAYMENT_TRANSACTION_TYPE_OPTIONS),
      contact_id: contactId,
      bank_account_id: bankAccountId,
      date: this.#toDate(date),
      total_amount: totalAmount,
      reference,
      allocated_artefacts: allocatedArtefacts ? this.#cleanLines(allocatedArtefacts, 'allocated artefact') : undefined,
    })

    return this.#apiRequest({
      logTag: 'createContactPayment',
      method: 'post',
      url: `${ API_BASE_URL }/contact_payments`,
      body: { contact_payment: contactPayment },
    })
  }

  /**
   * @description Retrieves contact payments (customer receipts/refunds and vendor payments/refunds), paginated (up to 200 per page). Supports filtering by contact, bank account, transaction type, and date range.
   *
   * @route GET /list-contact-payments
   * @operationName List Contact Payments
   * @category Contact Payments
   *
   * @paramDef {"type":"String","label":"Contact","name":"contactId","dictionary":"getContactsDictionary","description":"Optional filter: only payments for this contact."}
   * @paramDef {"type":"String","label":"Bank Account","name":"bankAccountId","dictionary":"getBankAccountsDictionary","description":"Optional filter: only payments through this bank account."}
   * @paramDef {"type":"String","label":"Transaction Type","name":"transactionType","uiComponent":{"type":"DROPDOWN","options":{"values":["Customer Receipt","Customer Refund","Vendor Payment","Vendor Refund"]}},"description":"Optional filter by payment kind."}
   * @paramDef {"type":"String","label":"From Date","name":"fromDate","uiComponent":{"type":"DATE_PICKER"},"description":"Only return payments dated on or after this date (YYYY-MM-DD)."}
   * @paramDef {"type":"String","label":"To Date","name":"toDate","uiComponent":{"type":"DATE_PICKER"},"description":"Only return payments dated on or before this date (YYYY-MM-DD)."}
   * @paramDef {"type":"Number","label":"Items Per Page","name":"itemsPerPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of payments per page. Range: 1-200. Default: 20."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve. Default: 1."}
   *
   * @returns {Object}
   * @sampleResult {"$total":1,"$page":1,"$itemsPerPage":20,"$items":[{"id":"a1b2c3d4e5f7","displayed_as":"Customer Receipt"}]}
   */
  async listContactPayments(contactId, bankAccountId, transactionType, fromDate, toDate, itemsPerPage, page) {
    return this.#apiRequest({
      logTag: 'listContactPayments',
      url: `${ API_BASE_URL }/contact_payments`,
      query: {
        contact_id: contactId,
        bank_account_id: bankAccountId,
        transaction_type_id: this.#resolveChoice(transactionType, PAYMENT_TRANSACTION_TYPE_OPTIONS),
        from_date: this.#toDate(fromDate),
        to_date: this.#toDate(toDate),
        ...this.#pagingQuery(itemsPerPage, page),
      },
    })
  }

  /**
   * @description Retrieves the full record of a single contact payment by id, including the transaction type, contact, bank account, total amount, and allocations against invoices or credit notes.
   *
   * @route GET /get-contact-payment
   * @operationName Get Contact Payment
   * @category Contact Payments
   *
   * @paramDef {"type":"String","label":"Contact Payment ID","name":"contactPaymentId","required":true,"description":"The unique id of the contact payment to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":"a1b2c3d4e5f7","displayed_as":"Customer Receipt","transaction_type":{"id":"CUSTOMER_RECEIPT"},"contact":{"id":"a1b2c3d4e5f6"},"bank_account":{"id":"c3d4e5f6a1b2"},"date":"2026-07-18","total_amount":"1200.00"}
   */
  async getContactPayment(contactPaymentId) {
    if (!contactPaymentId) {
      throw new Error('"Contact Payment ID" is required')
    }

    return this.#apiRequest({
      logTag: 'getContactPayment',
      url: `${ API_BASE_URL }/contact_payments/${ encodeURIComponent(contactPaymentId) }`,
      query: { attributes: 'all' },
    })
  }

  // ============================================ TAX RATES ============================================

  /**
   * @description Retrieves the tax rates available to the business (e.g. standard, reduced, zero-rated), paginated. Enable Full Details to include the current percentage and historical rate breakdown for each tax rate.
   *
   * @route GET /list-tax-rates
   * @operationName List Tax Rates
   * @category Tax Rates
   *
   * @paramDef {"type":"Boolean","label":"Full Details","name":"fullDetails","uiComponent":{"type":"TOGGLE"},"description":"When enabled, returns all attributes of each tax rate, including the current percentage and effective date ranges."}
   * @paramDef {"type":"Number","label":"Items Per Page","name":"itemsPerPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of tax rates per page. Range: 1-200. Default: 20."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve. Default: 1."}
   *
   * @returns {Object}
   * @sampleResult {"$total":2,"$page":1,"$itemsPerPage":20,"$items":[{"id":"GB_STANDARD","displayed_as":"Standard 20.00%"},{"id":"GB_ZERO","displayed_as":"Zero Rated 0.00%"}]}
   */
  async listTaxRates(fullDetails, itemsPerPage, page) {
    return this.#apiRequest({
      logTag: 'listTaxRates',
      url: `${ API_BASE_URL }/tax_rates`,
      query: {
        attributes: fullDetails ? 'all' : undefined,
        ...this.#pagingQuery(itemsPerPage, page),
      },
    })
  }

  // ============================================= JOURNALS ============================================

  /**
   * @typedef {Object} JournalLine
   * @paramDef {"type":"String","label":"Ledger Account ID","name":"ledger_account_id","required":true,"dictionary":"getLedgerAccountsDictionary","description":"The ledger account to post this line to."}
   * @paramDef {"type":"Number","label":"Debit","name":"debit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The debit amount for this line. Use 0 (or omit) when the line is a credit."}
   * @paramDef {"type":"Number","label":"Credit","name":"credit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The credit amount for this line. Use 0 (or omit) when the line is a debit."}
   * @paramDef {"type":"String","label":"Details","name":"details","required":true,"description":"A description of what this journal line represents."}
   * @paramDef {"type":"Boolean","label":"Include on Tax Return","name":"include_on_tax_return","uiComponent":{"type":"CHECKBOX"},"description":"Whether this line should be included on the tax (VAT) return."}
   */

  /**
   * @description Creates a manual journal entry with two or more journal lines. The total debits must equal the total credits across all lines. Each line posts a debit or credit to a ledger account with a details description. Returns the created journal.
   *
   * @route POST /create-journal
   * @operationName Create Journal
   * @category Journals
   *
   * @paramDef {"type":"String","label":"Date","name":"date","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"The journal posting date (YYYY-MM-DD)."}
   * @paramDef {"type":"Array<JournalLine>","label":"Journal Lines","name":"journalLines","required":true,"description":"The journal lines. At least two lines are typically required, and total debits must equal total credits."}
   * @paramDef {"type":"String","label":"Reference","name":"reference","description":"Optional reference for the journal."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional description of the journal entry."}
   *
   * @returns {Object}
   * @sampleResult {"id":"f7a1b2c3d4e5","displayed_as":"JNL-001","date":"2026-07-18","reference":"JNL-001","journal_lines":[{"ledger_account":{"id":"b2c3d4e5f6a1"},"debit":"100.00","credit":"0.00","details":"Accrual"}]}
   */
  async createJournal(date, journalLines, reference, description) {
    if (!date) {
      throw new Error('"Date" is required')
    }

    const journal = cleanupObject({
      date: this.#toDate(date),
      reference,
      description,
      journal_lines: this.#cleanLines(journalLines, 'journal line'),
    })

    return this.#apiRequest({
      logTag: 'createJournal',
      method: 'post',
      url: `${ API_BASE_URL }/journals`,
      body: { journal },
    })
  }

  /**
   * @description Retrieves manual journal entries of the connected business, paginated (up to 200 per page). Supports filtering by posting date range and last-modified timestamp.
   *
   * @route GET /list-journals
   * @operationName List Journals
   * @category Journals
   *
   * @paramDef {"type":"String","label":"From Date","name":"fromDate","uiComponent":{"type":"DATE_PICKER"},"description":"Only return journals dated on or after this date (YYYY-MM-DD)."}
   * @paramDef {"type":"String","label":"To Date","name":"toDate","uiComponent":{"type":"DATE_PICKER"},"description":"Only return journals dated on or before this date (YYYY-MM-DD)."}
   * @paramDef {"type":"String","label":"Updated or Created Since","name":"updatedOrCreatedSince","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Only return journals created or updated at or after this ISO 8601 timestamp."}
   * @paramDef {"type":"Number","label":"Items Per Page","name":"itemsPerPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of journals per page. Range: 1-200. Default: 20."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve. Default: 1."}
   *
   * @returns {Object}
   * @sampleResult {"$total":1,"$page":1,"$itemsPerPage":20,"$items":[{"id":"f7a1b2c3d4e5","displayed_as":"JNL-001"}]}
   */
  async listJournals(fromDate, toDate, updatedOrCreatedSince, itemsPerPage, page) {
    return this.#apiRequest({
      logTag: 'listJournals',
      url: `${ API_BASE_URL }/journals`,
      query: {
        from_date: this.#toDate(fromDate),
        to_date: this.#toDate(toDate),
        updated_or_created_since: this.#toDateTime(updatedOrCreatedSince),
        ...this.#pagingQuery(itemsPerPage, page),
      },
    })
  }

  /**
   * @description Retrieves the full record of a single journal entry by id, including all journal lines with their ledger accounts, debit/credit amounts, and details.
   *
   * @route GET /get-journal
   * @operationName Get Journal
   * @category Journals
   *
   * @paramDef {"type":"String","label":"Journal ID","name":"journalId","required":true,"description":"The unique id of the journal entry to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":"f7a1b2c3d4e5","displayed_as":"JNL-001","date":"2026-07-18","total":"100.00","journal_lines":[{"ledger_account":{"id":"b2c3d4e5f6a1"},"debit":"100.00","credit":"0.00","details":"Accrual"}]}
   */
  async getJournal(journalId) {
    if (!journalId) {
      throw new Error('"Journal ID" is required')
    }

    return this.#apiRequest({
      logTag: 'getJournal',
      url: `${ API_BASE_URL }/journals/${ encodeURIComponent(journalId) }`,
      query: { attributes: 'all' },
    })
  }
}

Flowrunner.ServerCode.addService(SageAccountingService, [
  {
    displayName: 'Client Id',
    defaultValue: '',
    name: 'clientId',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'The Client ID of your Sage app from https://developer.sage.com (Sage Business Cloud Accounting).',
  },
  {
    displayName: 'Client Secret',
    defaultValue: '',
    name: 'clientSecret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'The Client Secret of your Sage app from https://developer.sage.com (Sage Business Cloud Accounting).',
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
