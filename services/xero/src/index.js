'use strict'

const OAUTH_BASE_URL = 'https://login.xero.com/identity/connect'
const TOKEN_URL = 'https://identity.xero.com/connect/token'
const API_BASE_URL = 'https://api.xero.com/api.xro/2.0'
const CONNECTIONS_URL = 'https://api.xero.com/connections'

const DEFAULT_SCOPE_LIST = [
  'openid',
  'profile',
  'email',
  'offline_access',
  'accounting.transactions',
  'accounting.contacts',
  'accounting.settings',
  'accounting.reports.read',
  'accounting.attachments',
]

const DEFAULT_SCOPE_STRING = DEFAULT_SCOPE_LIST.join(' ')

const DEFAULT_LIMIT = 100

const InvoiceTypes = {
  SALES: 'ACCREC',
  BILL: 'ACCPAY',
}

const InvoiceStatuses = {
  DRAFT: 'DRAFT',
  SUBMITTED: 'SUBMITTED',
  AUTHORISED: 'AUTHORISED',
  PAID: 'PAID',
  VOIDED: 'VOIDED',
  DELETED: 'DELETED',
}

const BankTransactionTypes = {
  RECEIVE: 'RECEIVE',
  SPEND: 'SPEND',
  RECEIVE_OVERPAYMENT: 'RECEIVE-OVERPAYMENT',
  SPEND_OVERPAYMENT: 'SPEND-OVERPAYMENT',
  RECEIVE_PREPAYMENT: 'RECEIVE-PREPAYMENT',
  SPEND_PREPAYMENT: 'SPEND-PREPAYMENT',
}

const WebhookEventTypes = {
  onContactCreated: 'CONTACT.CREATE',
  onContactUpdated: 'CONTACT.UPDATE',
  onInvoiceCreated: 'INVOICE.CREATE',
  onInvoiceUpdated: 'INVOICE.UPDATE',
  onCreditNoteCreated: 'CREDITNOTE.CREATE',
  onCreditNoteUpdated: 'CREDITNOTE.UPDATE',
}

const MethodTypes = Object.keys(WebhookEventTypes).reduce((acc, key) => ((acc[WebhookEventTypes[key]] = key), acc), {})

const MethodCallTypes = {
  SHAPE_EVENT: 'SHAPE_EVENT',
  FILTER_TRIGGER: 'FILTER_TRIGGER',
}

const logger = {
  info: (...args) => console.log('[Xero Service] info:', ...args),
  debug: (...args) => console.log('[Xero Service] debug:', ...args),
  error: (...args) => console.log('[Xero Service] error:', ...args),
  warn: (...args) => console.log('[Xero Service] warn:', ...args),
}

/**
 * @requireOAuth
 * @integrationName Xero
 * @integrationTriggersScope SINGLE_APP
 * @integrationIcon /icon.svg
 **/
class XeroService {
  constructor(config) {
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
    this.scopes = DEFAULT_SCOPE_STRING
  }

  async #apiRequest({ url, method, body, query, logTag, tenantId }) {
    method = method || 'get'

    if (query) {
      query = cleanupObject(query)
    }

    try {
      logger.debug(`${ logTag } - api request: [${ method }::${ url }] q=[${ JSON.stringify(query) }]`)

      const request = Flowrunner.Request[method](url)
        .set(this.#getAccessTokenHeader())
        .set(this.#getTenantHeader(tenantId))
        .query(query)

      if (body) {
        return await request.send(body)
      }

      return await request
    } catch (error) {
      logger.error(`${ logTag } - error: ${ JSON.stringify({ ...error }) }`)

      throw error
    }
  }

  #getAccessTokenHeader(accessToken) {
    return {
      Authorization: `Bearer ${ accessToken || this.request.headers['oauth-access-token'] }`,
    }
  }

  #getSecretTokenHeader() {
    const credentials = Buffer.from(`${ this.clientId }:${ this.clientSecret }`).toString('base64')

    return {
      Authorization: `Basic ${ credentials }`,
    }
  }

  #getTenantHeader(tenantId) {
    if (!tenantId) {
      throw new Error('Xero Tenant ID is required. Please reconnect your Xero account.')
    }

    return {
      'xero-tenant-id': tenantId,
    }
  }

  // ========================================== OAUTH2 METHODS ===========================================

  /**
   * @registerAs SYSTEM
   * @route GET /getOAuth2ConnectionURL
   * @returns {String}
   */
  async getOAuth2ConnectionURL() {
    const params = new URLSearchParams()

    params.append('client_id', this.clientId)
    params.append('scope', this.scopes)
    params.append('response_type', 'code')

    return `${ OAUTH_BASE_URL }/authorize?${ params.toString() }`
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
    const params = new URLSearchParams()

    params.append('grant_type', 'refresh_token')
    params.append('refresh_token', refreshToken)

    try {
      const response = await Flowrunner.Request.post(TOKEN_URL)
        .set(this.#getSecretTokenHeader())
        .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        .send(params.toString())

      return {
        token: response.access_token,
        expirationInSeconds: response.expires_in,
        refreshToken: response.refresh_token || refreshToken,
      }
    } catch (error) {
      logger.error(`refreshToken: ${ error.message }`)

      throw error
    }
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

    params.append('code', callbackObject.code)
    params.append('redirect_uri', callbackObject.redirectURI)
    params.append('grant_type', 'authorization_code')

    let codeExchangeResponse = {}

    try {
      codeExchangeResponse = await Flowrunner.Request.post(TOKEN_URL)
        .set(this.#getSecretTokenHeader())
        .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        .send(params.toString())

      logger.debug(`[executeCallback] codeExchangeResponse: ${ JSON.stringify(codeExchangeResponse) }`)
    } catch (error) {
      logger.error(`[executeCallback] codeExchangeResponse error: ${ error.message }`)

      return {}
    }

    // Get connected tenants (organizations)
    let tenants = []

    try {
      tenants = await Flowrunner.Request.get(CONNECTIONS_URL)
        .set({ Authorization: `Bearer ${ codeExchangeResponse.access_token }` })

      logger.debug(`[executeCallback] tenants: ${ JSON.stringify(tenants) }`)
    } catch (error) {
      logger.error(`[executeCallback] tenants error: ${ error.message }`)

      return {}
    }

    if (!tenants || tenants.length === 0) {
      logger.error('[executeCallback] No Xero organizations found')

      return {}
    }

    // Use the first tenant by default
    const primaryTenant = tenants[0]

    return {
      token: codeExchangeResponse.access_token,
      expirationInSeconds: codeExchangeResponse.expires_in,
      refreshToken: codeExchangeResponse.refresh_token,
      connectionIdentityName: primaryTenant.tenantName || 'Xero Organization',
      connectionIdentityImageURL: null,
      overwrite: true,
      userData: {
        tenantId: primaryTenant.tenantId,
        tenantName: primaryTenant.tenantName,
        tenantType: primaryTenant.tenantType,
        allTenants: tenants,
      },
    }
  }

  // ========================================== DICTIONARIES ===========================================

  /**
   * @typedef {Object} DictionaryPayload
   * @property {String} [search]
   * @property {String} [cursor]
   */

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
   * @typedef {Object} getTenantsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter organizations by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (not used for tenants)."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Organizations
   * @category Organization
   * @description Returns connected Xero organizations (tenants) for selection. When multiple organizations are connected, use this to specify which one to operate on.
   *
   * @route POST /get-tenants-dictionary
   *
   * @paramDef {"type":"getTenantsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string for filtering organizations."}
   *
   * @sampleResult {"cursor":null,"items":[{"label":"My Company Ltd","note":"Type: ORGANISATION","value":"abc123-def456-789"}]}
   * @returns {DictionaryResponse}
   */
  async getTenantsDictionary(payload) {
    const { search } = payload || {}

    // Get tenants from stored userData
    const allTenantsHeader = this.request.headers['oauth-user-data-alltenants']

    let tenants = []

    if (allTenantsHeader) {
      try {
        tenants = JSON.parse(allTenantsHeader)
      } catch (e) {
        logger.warn('Failed to parse allTenants from userData')
      }
    }

    // If no tenants in userData, try to fetch from API
    if (!tenants || tenants.length === 0) {
      try {
        tenants = await Flowrunner.Request.get(CONNECTIONS_URL)
          .set(this.#getAccessTokenHeader())

        logger.debug(`getTenantsDictionary - fetched tenants: ${ JSON.stringify(tenants) }`)
      } catch (error) {
        logger.error(`getTenantsDictionary - error fetching tenants: ${ error.message }`)
        tenants = []
      }
    }

    // Filter by search if provided
    if (search) {
      tenants = tenants.filter(t =>
        t.tenantName?.toLowerCase().includes(search.toLowerCase())
      )
    }

    return {
      cursor: null,
      items: tenants.map(tenant => ({
        label: tenant.tenantName || 'Unnamed Organization',
        note: `Type: ${ tenant.tenantType || 'ORGANISATION' }`,
        value: tenant.tenantId,
      })),
    }
  }

  /**
   * @typedef {Object} getContactsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter contacts by name or email."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for retrieving the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Contacts
   * @category Contacts
   * @description Returns contacts (customers and suppliers) for selection in AI-powered workflows.
   *
   * @route POST /get-contacts-dictionary
   *
   * @paramDef {"type":"getContactsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for filtering contacts."}
   *
   * @sampleResult {"cursor":null,"items":[{"label":"Acme Corp","note":"Contact ID: abc123","value":"abc123-def456"}]}
   * @returns {DictionaryResponse}
   */
  async getContactsDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const tenantId = criteria?.tenantId

    const page = cursor ? parseInt(cursor) : 1

    const response = await this.#apiRequest({
      logTag: 'getContactsDictionary',
      url: `${ API_BASE_URL }/Contacts`,
      query: {
        page,
        where: search ? `Name.Contains("${ search }") OR EmailAddress.Contains("${ search }")` : undefined,
      },
      tenantId,
    })

    const contacts = response.Contacts || []
    const hasMore = contacts.length >= DEFAULT_LIMIT

    return {
      cursor: hasMore ? String(page + 1) : null,
      items: contacts.map(contact => ({
        label: contact.Name || contact.EmailAddress || '[No Name]',
        note: `Contact ID: ${ contact.ContactID }`,
        value: contact.ContactID,
      })),
    }
  }

  /**
   * @typedef {Object} getInvoicesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter invoices by number or reference."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for retrieving the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Invoices
   * @category Invoices
   * @description Returns invoices for selection in payment and billing workflows.
   *
   * @route POST /get-invoices-dictionary
   *
   * @paramDef {"type":"getInvoicesDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for filtering invoices."}
   *
   * @sampleResult {"cursor":null,"items":[{"label":"INV-001 - Acme Corp ($1,000.00)","note":"Status: AUTHORISED","value":"inv-123-456"}]}
   * @returns {DictionaryResponse}
   */
  async getInvoicesDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const tenantId = criteria?.tenantId

    const page = cursor ? parseInt(cursor) : 1

    const response = await this.#apiRequest({
      logTag: 'getInvoicesDictionary',
      url: `${ API_BASE_URL }/Invoices`,
      query: {
        page,
        where: search ? `InvoiceNumber.Contains("${ search }") OR Reference.Contains("${ search }")` : undefined,
      },
      tenantId,
    })

    const invoices = response.Invoices || []
    const hasMore = invoices.length >= DEFAULT_LIMIT

    return {
      cursor: hasMore ? String(page + 1) : null,
      items: invoices.map(invoice => ({
        label: `${ invoice.InvoiceNumber || 'No Number' } - ${ invoice.Contact?.Name || 'Unknown' } (${ formatCurrency(
          invoice.Total,
          invoice.CurrencyCode
        ) })`,
        note: `Status: ${ invoice.Status }`,
        value: invoice.InvoiceID,
      })),
    }
  }

  /**
   * @typedef {Object} getAccountsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter accounts by name or code."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for retrieving the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Accounts Dictionary
   * @category Accounts
   * @description Returns chart of accounts for transaction categorization.
   *
   * @route POST /get-accounts-dictionary
   *
   * @paramDef {"type":"getAccountsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for filtering accounts."}
   *
   * @sampleResult {"cursor":null,"items":[{"label":"200 - Sales Revenue","note":"Type: REVENUE","value":"acc-123-456"}]}
   * @returns {DictionaryResponse}
   */
  async getAccountsDictionary(payload) {
    const { search, criteria } = payload || {}
    const tenantId = criteria?.tenantId

    const response = await this.#apiRequest({
      logTag: 'getAccountsDictionary',
      url: `${ API_BASE_URL }/Accounts`,
      tenantId,
    })

    let accounts = response.Accounts || []

    if (search) {
      accounts = searchFilter(accounts, ['Name', 'Code'], search)
    }

    return {
      cursor: null,
      items: accounts.map(account => ({
        label: `${ account.Code } - ${ account.Name }`,
        note: `Type: ${ account.Type }`,
        value: account.AccountID,
      })),
    }
  }

  /**
   * @typedef {Object} getTaxRatesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter tax rates by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for retrieving the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Tax Rates Dictionary
   * @category Settings
   * @description Returns available tax rates for invoice and transaction creation.
   *
   * @route POST /get-tax-rates-dictionary
   *
   * @paramDef {"type":"getTaxRatesDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for filtering tax rates."}
   *
   * @sampleResult {"cursor":null,"items":[{"label":"GST 10%","note":"Rate: 10%","value":"OUTPUT"}]}
   * @returns {DictionaryResponse}
   */
  async getTaxRatesDictionary(payload) {
    const { search, criteria } = payload || {}
    const tenantId = criteria?.tenantId

    const response = await this.#apiRequest({
      logTag: 'getTaxRatesDictionary',
      url: `${ API_BASE_URL }/TaxRates`,
      tenantId,
    })

    let taxRates = response.TaxRates || []

    if (search) {
      taxRates = searchFilter(taxRates, ['Name'], search)
    }

    return {
      cursor: null,
      items: taxRates.map(rate => ({
        label: rate.Name,
        note: `Rate: ${ rate.EffectiveRate }%`,
        value: rate.TaxType,
      })),
    }
  }

  /**
   * @typedef {Object} getItemsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter items by name or code."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for retrieving the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Items
   * @category Items
   * @description Returns products and services for invoice line items.
   *
   * @route POST /get-items-dictionary
   *
   * @paramDef {"type":"getItemsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for filtering items."}
   *
   * @sampleResult {"cursor":null,"items":[{"label":"PROD-001 - Widget","note":"$99.00","value":"item-123-456"}]}
   * @returns {DictionaryResponse}
   */
  async getItemsDictionary(payload) {
    const { search, criteria } = payload || {}
    const tenantId = criteria?.tenantId

    const response = await this.#apiRequest({
      logTag: 'getItemsDictionary',
      url: `${ API_BASE_URL }/Items`,
      tenantId,
    })

    let items = response.Items || []

    if (search) {
      items = searchFilter(items, ['Name', 'Code'], search)
    }

    return {
      cursor: null,
      items: items.map(item => ({
        label: `${ item.Code } - ${ item.Name }`,
        note: item.SalesDetails?.UnitPrice ? `$${ item.SalesDetails.UnitPrice }` : 'No price set',
        value: item.ItemID,
      })),
    }
  }

  /**
   * @typedef {Object} getBankAccountsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter bank accounts by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for retrieving the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Bank Accounts
   * @category Accounts
   * @description Returns bank accounts for payment and transaction creation.
   *
   * @route POST /get-bank-accounts-dictionary
   *
   * @paramDef {"type":"getBankAccountsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for filtering bank accounts."}
   *
   * @sampleResult {"cursor":null,"items":[{"label":"Business Checking Account","note":"Code: 090","value":"acc-123-456"}]}
   * @returns {DictionaryResponse}
   */
  async getBankAccountsDictionary(payload) {
    const { search, criteria } = payload || {}
    const tenantId = criteria?.tenantId

    const response = await this.#apiRequest({
      logTag: 'getBankAccountsDictionary',
      url: `${ API_BASE_URL }/Accounts`,
      query: {
        where: 'Type=="BANK"',
      },
      tenantId,
    })

    let accounts = response.Accounts || []

    if (search) {
      accounts = searchFilter(accounts, ['Name', 'Code'], search)
    }

    return {
      cursor: null,
      items: accounts.map(account => ({
        label: account.Name,
        note: `Code: ${ account.Code }`,
        value: account.AccountID,
      })),
    }
  }

  /**
   * @typedef {Object} getCurrenciesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter currencies by code or description."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for retrieving the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Currencies Dictionary
   * @category Settings
   * @description Returns enabled currencies for multi-currency transactions.
   *
   * @route POST /get-currencies-dictionary
   *
   * @paramDef {"type":"getCurrenciesDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for filtering currencies."}
   *
   * @sampleResult {"cursor":null,"items":[{"label":"USD - US Dollar","note":"","value":"USD"}]}
   * @returns {DictionaryResponse}
   */
  async getCurrenciesDictionary(payload) {
    const { search, criteria } = payload || {}
    const tenantId = criteria?.tenantId

    const response = await this.#apiRequest({
      logTag: 'getCurrenciesDictionary',
      url: `${ API_BASE_URL }/Currencies`,
      tenantId,
    })

    let currencies = response.Currencies || []

    if (search) {
      currencies = searchFilter(currencies, ['Code', 'Description'], search)
    }

    return {
      cursor: null,
      items: currencies.map(currency => ({
        label: `${ currency.Code } - ${ currency.Description || currency.Code }`,
        note: '',
        value: currency.Code,
      })),
    }
  }

  /**
   * @typedef {Object} getTrackingCategoriesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter tracking categories by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for retrieving the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Tracking Categories
   * @category Settings
   * @description Returns tracking categories for cost center and project tracking.
   *
   * @route POST /get-tracking-categories-dictionary
   *
   * @paramDef {"type":"getTrackingCategoriesDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for filtering tracking categories."}
   *
   * @sampleResult {"cursor":null,"items":[{"label":"Region","note":"Options: North, South, East, West","value":"cat-123-456"}]}
   * @returns {DictionaryResponse}
   */
  async getTrackingCategoriesDictionary(payload) {
    const { search, criteria } = payload || {}
    const tenantId = criteria?.tenantId

    const response = await this.#apiRequest({
      logTag: 'getTrackingCategoriesDictionary',
      url: `${ API_BASE_URL }/TrackingCategories`,
      tenantId,
    })

    let categories = response.TrackingCategories || []

    if (search) {
      categories = searchFilter(categories, ['Name'], search)
    }

    return {
      cursor: null,
      items: categories.map(category => ({
        label: category.Name,
        note: `Options: ${ category.Options?.map(o => o.Name).join(', ') || 'None' }`,
        value: category.TrackingCategoryID,
      })),
    }
  }

  // ======================================= END OF DICTIONARIES =======================================

  // ========================================== CONTACTS ===========================================

  /**
   * @operationName Create Contact
   * @category Contacts
   * @description Creates a new contact (customer or supplier) in Xero. Contacts are used for invoicing, bills, and tracking business relationships.
   *
   * @route POST /create-contact
   * @appearanceColor #13B5EA #25C0F0
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"tenantId","dictionary":"getTenantsDictionary","description":"Select the Xero organization. Required if multiple organizations are connected."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Contact name (person or company). Example: 'Acme Corporation'."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Primary email address for the contact."}
   * @paramDef {"type":"String","label":"First Name","name":"firstName","description":"Contact's first name (for individuals)."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","description":"Contact's last name (for individuals)."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"Primary phone number."}
   * @paramDef {"type":"String","label":"Account Number","name":"accountNumber","description":"Unique account number for the contact."}
   * @paramDef {"type":"String","label":"Tax Number","name":"taxNumber","description":"Tax identification number (VAT, GST, etc.)."}
   * @paramDef {"type":"Boolean","label":"Is Supplier","name":"isSupplier","uiComponent":{"type":"TOGGLE"},"description":"Set to true if this contact is a supplier/vendor."}
   * @paramDef {"type":"Boolean","label":"Is Customer","name":"isCustomer","uiComponent":{"type":"TOGGLE"},"description":"Set to true if this contact is a customer."}
   *
   * @returns {Object}
   * @sampleResult {"ContactID":"a1b2c3d4-e5f6-7890-abcd-ef1234567890","Name":"Acme Corporation","EmailAddress":"billing@acme.com","IsSupplier":false,"IsCustomer":true}
   */
  async createContact(tenantId, name, email, firstName, lastName, phone, accountNumber, taxNumber, isSupplier, isCustomer) {
    if (!name) {
      throw new Error('"Name" is required')
    }

    const contact = cleanupObject({
      Name: name,
      EmailAddress: email,
      FirstName: firstName,
      LastName: lastName,
      Phones: phone ? [{ PhoneType: 'DEFAULT', PhoneNumber: phone }] : undefined,
      AccountNumber: accountNumber,
      TaxNumber: taxNumber,
      IsSupplier: isSupplier,
      IsCustomer: isCustomer,
    })

    const response = await this.#apiRequest({
      logTag: 'createContact',
      method: 'post',
      url: `${ API_BASE_URL }/Contacts`,
      body: { Contacts: [contact] },
      tenantId,
    })

    return response.Contacts?.[0]
  }

  /**
   * @operationName Update Contact
   * @category Contacts
   * @description Updates an existing contact's information in Xero.
   *
   * @route POST /update-contact
   * @appearanceColor #13B5EA #25C0F0
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"tenantId","dictionary":"getTenantsDictionary","description":"Select the Xero organization. Required if multiple organizations are connected."}
   * @paramDef {"type":"String","label":"Contact","name":"contactId","required":true,"dictionary":"getContactsDictionary","dependsOn":["tenantId"],"description":"Select the contact to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"Updated contact name."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Updated email address."}
   * @paramDef {"type":"String","label":"First Name","name":"firstName","description":"Updated first name."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","description":"Updated last name."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"Updated phone number."}
   * @paramDef {"type":"String","label":"Account Number","name":"accountNumber","description":"Updated account number."}
   * @paramDef {"type":"String","label":"Tax Number","name":"taxNumber","description":"Updated tax number."}
   *
   * @returns {Object}
   * @sampleResult {"ContactID":"a1b2c3d4-e5f6-7890-abcd-ef1234567890","Name":"Acme Corporation Updated","EmailAddress":"new-billing@acme.com"}
   */
  async updateContact(tenantId, contactId, name, email, firstName, lastName, phone, accountNumber, taxNumber) {
    if (!contactId) {
      throw new Error('"Contact" is required')
    }

    const contact = cleanupObject({
      ContactID: contactId,
      Name: name,
      EmailAddress: email,
      FirstName: firstName,
      LastName: lastName,
      Phones: phone ? [{ PhoneType: 'DEFAULT', PhoneNumber: phone }] : undefined,
      AccountNumber: accountNumber,
      TaxNumber: taxNumber,
    })

    const response = await this.#apiRequest({
      logTag: 'updateContact',
      method: 'post',
      url: `${ API_BASE_URL }/Contacts/${ contactId }`,
      body: contact,
      tenantId,
    })

    return response.Contacts?.[0]
  }

  /**
   * @operationName Get Contact
   * @category Contacts
   * @description Retrieves a single contact by ID with full details including addresses and phone numbers.
   *
   * @route POST /get-contact
   * @appearanceColor #13B5EA #25C0F0
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"tenantId","dictionary":"getTenantsDictionary","description":"Select the Xero organization. Required if multiple organizations are connected."}
   * @paramDef {"type":"String","label":"Contact","name":"contactId","required":true,"dictionary":"getContactsDictionary","dependsOn":["tenantId"],"description":"Select the contact to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"ContactID":"a1b2c3d4-e5f6-7890-abcd-ef1234567890","Name":"Acme Corporation","EmailAddress":"billing@acme.com","Phones":[{"PhoneType":"DEFAULT","PhoneNumber":"555-1234"}],"Addresses":[{"AddressType":"POBOX","City":"New York"}],"IsSupplier":false,"IsCustomer":true,"ContactStatus":"ACTIVE"}
   */
  async getContact(tenantId, contactId) {
    if (!contactId) {
      throw new Error('"Contact" is required')
    }

    const response = await this.#apiRequest({
      logTag: 'getContact',
      url: `${ API_BASE_URL }/Contacts/${ contactId }`,
      tenantId,
    })

    return response.Contacts?.[0]
  }

  /**
   * @operationName Find Contacts
   * @category Contacts
   * @description Searches for contacts with optional filters. Supports pagination for large result sets.
   *
   * @route POST /find-contacts
   * @appearanceColor #13B5EA #25C0F0
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"tenantId","dictionary":"getTenantsDictionary","description":"Select the Xero organization. Required if multiple organizations are connected."}
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Search by name or email address."}
   * @paramDef {"type":"Boolean","label":"Suppliers Only","name":"suppliersOnly","uiComponent":{"type":"TOGGLE"},"description":"Filter to show only suppliers."}
   * @paramDef {"type":"Boolean","label":"Customers Only","name":"customersOnly","uiComponent":{"type":"TOGGLE"},"description":"Filter to show only customers."}
   * @paramDef {"type":"Boolean","label":"Include Archived","name":"includeArchived","uiComponent":{"type":"TOGGLE"},"description":"Include archived contacts in results."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number for pagination. Default: 1."}
   *
   * @returns {Object}
   * @sampleResult {"Contacts":[{"ContactID":"a1b2c3d4","Name":"Acme Corp","EmailAddress":"billing@acme.com","IsSupplier":false,"IsCustomer":true}],"pagination":{"page":1,"pageSize":100}}
   */
  async findContacts(tenantId, search, suppliersOnly, customersOnly, includeArchived, page) {
    const whereFilters = []

    if (search) {
      whereFilters.push(`Name.Contains("${ search }") OR EmailAddress.Contains("${ search }")`)
    }

    if (suppliersOnly) {
      whereFilters.push('IsSupplier==true')
    }

    if (customersOnly) {
      whereFilters.push('IsCustomer==true')
    }

    if (!includeArchived) {
      whereFilters.push('ContactStatus!="ARCHIVED"')
    }

    const response = await this.#apiRequest({
      logTag: 'findContacts',
      url: `${ API_BASE_URL }/Contacts`,
      query: {
        page: page || 1,
        where: whereFilters.length > 0 ? whereFilters.join(' AND ') : undefined,
      },
      tenantId,
    })

    return {
      Contacts: response.Contacts || [],
      pagination: {
        page: page || 1,
        pageSize: DEFAULT_LIMIT,
      },
    }
  }

  /**
   * @operationName Archive Contact
   * @category Contacts
   * @description Archives a contact, making it inactive but preserving historical data.
   *
   * @route POST /archive-contact
   * @appearanceColor #13B5EA #25C0F0
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"tenantId","dictionary":"getTenantsDictionary","description":"Select the Xero organization. Required if multiple organizations are connected."}
   * @paramDef {"type":"String","label":"Contact","name":"contactId","required":true,"dictionary":"getContactsDictionary","dependsOn":["tenantId"],"description":"Select the contact to archive."}
   *
   * @returns {Object}
   * @sampleResult {"ContactID":"a1b2c3d4-e5f6-7890-abcd-ef1234567890","Name":"Acme Corporation","ContactStatus":"ARCHIVED"}
   */
  async archiveContact(tenantId, contactId) {
    if (!contactId) {
      throw new Error('"Contact" is required')
    }

    const response = await this.#apiRequest({
      logTag: 'archiveContact',
      method: 'post',
      url: `${ API_BASE_URL }/Contacts/${ contactId }`,
      tenantId,
      body: {
        ContactID: contactId,
        ContactStatus: 'ARCHIVED',
      },
    })

    return response.Contacts?.[0]
  }

  // ======================================= END OF CONTACTS =======================================

  // ========================================== INVOICES ===========================================

  /**
   * @operationName Create Invoice
   * @category Invoices
   * @description Creates a new invoice (sales invoice or bill) in Xero. Supports line items, tax, and multi-currency.
   *
   * @route POST /create-invoice
   * @appearanceColor #13B5EA #25C0F0
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"tenantId","dictionary":"getTenantsDictionary","description":"Select the Xero organization. Required if multiple organizations are connected."}
   * @paramDef {"type":"String","label":"Contact","name":"contactId","required":true,"dictionary":"getContactsDictionary","dependsOn":["tenantId"],"description":"Select the customer or supplier for this invoice."}
   * @paramDef {"type":"String","label":"Type","name":"type","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["ACCREC","ACCPAY"]}},"description":"Invoice type: ACCREC (Sales Invoice) or ACCPAY (Bill/Purchase Invoice)."}
   * @paramDef {"type":"String","label":"Invoice Number","name":"invoiceNumber","description":"Custom invoice number. Auto-generated if not provided."}
   * @paramDef {"type":"String","label":"Reference","name":"reference","description":"Reference field for tracking purposes."}
   * @paramDef {"type":"String","label":"Date","name":"date","uiComponent":{"type":"DATE_PICKER"},"description":"Invoice date. Defaults to today."}
   * @paramDef {"type":"String","label":"Due Date","name":"dueDate","uiComponent":{"type":"DATE_PICKER"},"description":"Payment due date."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["DRAFT","SUBMITTED","AUTHORISED"]}},"description":"Initial status: DRAFT, SUBMITTED, or AUTHORISED."}
   * @paramDef {"type":"String","label":"Currency","name":"currencyCode","dictionary":"getCurrenciesDictionary","dependsOn":["tenantId"],"description":"Currency code for multi-currency invoices."}
   * @paramDef {"type":"Array<Object>","label":"Line Items","name":"lineItems","required":true,"description":"Array of line items with Description, Quantity, UnitAmount, AccountCode."}
   *
   * @returns {Object}
   * @sampleResult {"InvoiceID":"inv-123-456","InvoiceNumber":"INV-001","Type":"ACCREC","Contact":{"Name":"Acme Corp"},"Status":"DRAFT","Total":1100.00,"AmountDue":1100.00}
   */
  async createInvoice(tenantId, contactId, type, invoiceNumber, reference, date, dueDate, status, currencyCode, lineItems) {
    if (!contactId) {
      throw new Error('"Contact" is required')
    }

    if (!type) {
      throw new Error('"Type" is required')
    }

    if (!lineItems || lineItems.length === 0) {
      throw new Error('"Line Items" is required')
    }

    const invoice = cleanupObject({
      Type: type,
      Contact: { ContactID: contactId },
      InvoiceNumber: invoiceNumber,
      Reference: reference,
      Date: date,
      DueDate: dueDate,
      Status: status || 'DRAFT',
      CurrencyCode: currencyCode,
      LineItems: lineItems,
    })

    const response = await this.#apiRequest({
      logTag: 'createInvoice',
      method: 'post',
      url: `${ API_BASE_URL }/Invoices`,
      body: { Invoices: [invoice] },
      tenantId,
    })

    return response.Invoices?.[0]
  }

  /**
   * @operationName Update Invoice
   * @category Invoices
   * @description Updates an existing invoice. Only DRAFT invoices can have line items modified.
   *
   * @route POST /update-invoice
   * @appearanceColor #13B5EA #25C0F0
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"tenantId","dictionary":"getTenantsDictionary","description":"Select the Xero organization. Required if multiple organizations are connected."}
   * @paramDef {"type":"String","label":"Invoice","name":"invoiceId","required":true,"dictionary":"getInvoicesDictionary","dependsOn":["tenantId"],"description":"Select the invoice to update."}
   * @paramDef {"type":"String","label":"Reference","name":"reference","description":"Updated reference field."}
   * @paramDef {"type":"String","label":"Due Date","name":"dueDate","uiComponent":{"type":"DATE_PICKER"},"description":"Updated due date."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["DRAFT","SUBMITTED","AUTHORISED"]}},"description":"Updated status."}
   * @paramDef {"type":"Array<Object>","label":"Line Items","name":"lineItems","description":"Updated line items (only for DRAFT invoices)."}
   *
   * @returns {Object}
   * @sampleResult {"InvoiceID":"inv-123-456","InvoiceNumber":"INV-001","Status":"AUTHORISED","Total":1100.00}
   */
  async updateInvoice(tenantId, invoiceId, reference, dueDate, status, lineItems) {
    if (!invoiceId) {
      throw new Error('"Invoice" is required')
    }

    const invoice = cleanupObject({
      InvoiceID: invoiceId,
      Reference: reference,
      DueDate: dueDate,
      Status: status,
      LineItems: lineItems,
    })

    const response = await this.#apiRequest({
      logTag: 'updateInvoice',
      method: 'post',
      url: `${ API_BASE_URL }/Invoices/${ invoiceId }`,
      body: invoice,
      tenantId,
    })

    return response.Invoices?.[0]
  }

  /**
   * @operationName Get Invoice
   * @category Invoices
   * @description Retrieves a single invoice by ID with full details including line items and payments.
   *
   * @route POST /get-invoice
   * @appearanceColor #13B5EA #25C0F0
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"tenantId","dictionary":"getTenantsDictionary","description":"Select the Xero organization. Required if multiple organizations are connected."}
   * @paramDef {"type":"String","label":"Invoice","name":"invoiceId","required":true,"dictionary":"getInvoicesDictionary","dependsOn":["tenantId"],"description":"Select the invoice to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"InvoiceID":"inv-123-456","InvoiceNumber":"INV-001","Type":"ACCREC","Contact":{"ContactID":"c-123","Name":"Acme Corp"},"Status":"AUTHORISED","LineItems":[{"Description":"Consulting Services","Quantity":10,"UnitAmount":100,"LineAmount":1000}],"SubTotal":1000,"TotalTax":100,"Total":1100,"AmountDue":1100,"AmountPaid":0}
   */
  async getInvoice(tenantId, invoiceId) {
    if (!invoiceId) {
      throw new Error('"Invoice" is required')
    }

    const response = await this.#apiRequest({
      tenantId,
      logTag: 'getInvoice',
      url: `${ API_BASE_URL }/Invoices/${ invoiceId }`,
    })

    return response.Invoices?.[0]
  }

  /**
   * @operationName Find Invoices
   * @category Invoices
   * @description Searches for invoices with optional filters by contact, status, type, and date range.
   *
   * @route POST /find-invoices
   * @appearanceColor #13B5EA #25C0F0
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"tenantId","dictionary":"getTenantsDictionary","description":"Select the Xero organization. Required if multiple organizations are connected."}
   * @paramDef {"type":"String","label":"Contact","name":"contactId","dictionary":"getContactsDictionary","dependsOn":["tenantId"],"description":"Filter by contact."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["DRAFT","SUBMITTED","AUTHORISED","PAID","VOIDED"]}},"description":"Filter by status."}
   * @paramDef {"type":"String","label":"Type","name":"type","uiComponent":{"type":"DROPDOWN","options":{"values":["ACCREC","ACCPAY"]}},"description":"Filter by type: ACCREC (Sales) or ACCPAY (Bills)."}
   * @paramDef {"type":"String","label":"From Date","name":"fromDate","uiComponent":{"type":"DATE_PICKER"},"description":"Filter invoices from this date."}
   * @paramDef {"type":"String","label":"To Date","name":"toDate","uiComponent":{"type":"DATE_PICKER"},"description":"Filter invoices until this date."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number for pagination. Default: 1."}
   *
   * @returns {Object}
   * @sampleResult {"Invoices":[{"InvoiceID":"inv-123","InvoiceNumber":"INV-001","Type":"ACCREC","Status":"AUTHORISED","Total":1100}],"pagination":{"page":1,"pageSize":100}}
   */
  async findInvoices(tenantId, contactId, status, type, fromDate, toDate, page) {
    const whereFilters = []

    if (contactId) {
      whereFilters.push(`Contact.ContactID==Guid("${ contactId }")`)
    }

    if (status) {
      whereFilters.push(`Status=="${ status }"`)
    }

    if (type) {
      whereFilters.push(`Type=="${ type }"`)
    }

    if (fromDate) {
      whereFilters.push(`Date>=DateTime(${ formatDateForXero(fromDate) })`)
    }

    if (toDate) {
      whereFilters.push(`Date<=DateTime(${ formatDateForXero(toDate) })`)
    }

    const response = await this.#apiRequest({
      logTag: 'findInvoices',
      url: `${ API_BASE_URL }/Invoices`,
      query: {
        page: page || 1,
        where: whereFilters.length > 0 ? whereFilters.join(' AND ') : undefined,
      },
      tenantId,
    })

    return {
      Invoices: response.Invoices || [],
      pagination: {
        page: page || 1,
        pageSize: DEFAULT_LIMIT,
      },
    }
  }

  /**
   * @operationName Void Invoice
   * @category Invoices
   * @description Voids an invoice, making it inactive while preserving the record.
   *
   * @route POST /void-invoice
   * @appearanceColor #13B5EA #25C0F0
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"tenantId","dictionary":"getTenantsDictionary","description":"Select the Xero organization. Required if multiple organizations are connected."}
   * @paramDef {"type":"String","label":"Invoice","name":"invoiceId","required":true,"dictionary":"getInvoicesDictionary","dependsOn":["tenantId"],"description":"Select the invoice to void."}
   *
   * @returns {Object}
   * @sampleResult {"InvoiceID":"inv-123-456","InvoiceNumber":"INV-001","Status":"VOIDED"}
   */
  async voidInvoice(tenantId, invoiceId) {
    if (!invoiceId) {
      throw new Error('"Invoice" is required')
    }

    const response = await this.#apiRequest({
      logTag: 'voidInvoice',
      method: 'post',
      url: `${ API_BASE_URL }/Invoices/${ invoiceId }`,
      body: {
        InvoiceID: invoiceId,
        Status: 'VOIDED',
      },
      tenantId,
    })

    return response.Invoices?.[0]
  }

  /**
   * @operationName Email Invoice
   * @category Invoices
   * @description Sends an invoice to the contact via email directly from Xero.
   *
   * @route POST /email-invoice
   * @appearanceColor #13B5EA #25C0F0
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"tenantId","dictionary":"getTenantsDictionary","description":"Select the Xero organization. Required if multiple organizations are connected."}
   * @paramDef {"type":"String","label":"Invoice","name":"invoiceId","required":true,"dictionary":"getInvoicesDictionary","dependsOn":["tenantId"],"description":"Select the invoice to email."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"message":"Invoice emailed successfully"}
   */
  async emailInvoice(tenantId, invoiceId) {
    if (!invoiceId) {
      throw new Error('"Invoice" is required')
    }

    await this.#apiRequest({
      logTag: 'emailInvoice',
      method: 'post',
      url: `${ API_BASE_URL }/Invoices/${ invoiceId }/Email`,
      tenantId,
    })

    return {
      success: true,
      message: 'Invoice emailed successfully',
    }
  }

  // ======================================= END OF INVOICES =======================================

  // ========================================== PAYMENTS ===========================================

  /**
   * @operationName Create Payment
   * @category Payments
   * @description Records a payment against an invoice or bill in Xero.
   *
   * @route POST /create-payment
   * @appearanceColor #13B5EA #25C0F0
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"tenantId","dictionary":"getTenantsDictionary","description":"Select the Xero organization. Required if multiple organizations are connected."}
   * @paramDef {"type":"String","label":"Invoice","name":"invoiceId","required":true,"dictionary":"getInvoicesDictionary","dependsOn":["tenantId"],"description":"Select the invoice to apply payment to."}
   * @paramDef {"type":"String","label":"Bank Account","name":"accountId","required":true,"dictionary":"getBankAccountsDictionary","dependsOn":["tenantId"],"description":"Select the bank account for the payment."}
   * @paramDef {"type":"Number","label":"Amount","name":"amount","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Payment amount."}
   * @paramDef {"type":"String","label":"Date","name":"date","uiComponent":{"type":"DATE_PICKER"},"description":"Payment date. Defaults to today."}
   * @paramDef {"type":"String","label":"Reference","name":"reference","description":"Payment reference (e.g., check number, transaction ID)."}
   *
   * @returns {Object}
   * @sampleResult {"PaymentID":"pay-123-456","Invoice":{"InvoiceID":"inv-123","InvoiceNumber":"INV-001"},"Amount":500.00,"Date":"2025-01-15","Reference":"CHK-1234"}
   */
  async createPayment(tenantId, invoiceId, accountId, amount, date, reference) {
    if (!invoiceId) {
      throw new Error('"Invoice" is required')
    }

    if (!accountId) {
      throw new Error('"Bank Account" is required')
    }

    if (!amount) {
      throw new Error('"Amount" is required')
    }

    const payment = cleanupObject({
      Invoice: { InvoiceID: invoiceId },
      Account: { AccountID: accountId },
      Amount: amount,
      Date: date || new Date().toISOString().split('T')[0],
      Reference: reference,
    })

    const response = await this.#apiRequest({
      logTag: 'createPayment',
      method: 'put',
      url: `${ API_BASE_URL }/Payments`,
      body: { Payments: [payment] },
      tenantId,
    })

    return response.Payments?.[0]
  }

  /**
   * @operationName Get Payment
   * @category Payments
   * @description Retrieves a single payment by ID with full details.
   *
   * @route POST /get-payment
   * @appearanceColor #13B5EA #25C0F0
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"tenantId","dictionary":"getTenantsDictionary","description":"Select the Xero organization. Required if multiple organizations are connected."}
   * @paramDef {"type":"String","label":"Payment ID","name":"paymentId","required":true,"description":"The unique identifier of the payment."}
   *
   * @returns {Object}
   * @sampleResult {"PaymentID":"pay-123-456","PaymentType":"ACCRECPAYMENT","Invoice":{"InvoiceID":"inv-123","InvoiceNumber":"INV-001","Contact":{"Name":"Acme Corp"}},"Account":{"AccountID":"acc-123","Name":"Business Checking"},"Amount":500.00,"Date":"2025-01-15","Reference":"CHK-1234","Status":"AUTHORISED"}
   */
  async getPayment(tenantId, paymentId) {
    if (!paymentId) {
      throw new Error('"Payment ID" is required')
    }

    const response = await this.#apiRequest({
      logTag: 'getPayment',
      url: `${ API_BASE_URL }/Payments/${ paymentId }`,
      tenantId,
    })

    return response.Payments?.[0]
  }

  /**
   * @operationName Find Payments
   * @category Payments
   * @description Searches for payments with optional filters by invoice or reference.
   *
   * @route POST /find-payments
   * @appearanceColor #13B5EA #25C0F0
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"tenantId","dictionary":"getTenantsDictionary","description":"Select the Xero organization. Required if multiple organizations are connected."}
   * @paramDef {"type":"String","label":"Invoice","name":"invoiceId","dictionary":"getInvoicesDictionary","dependsOn":["tenantId"],"description":"Filter payments by invoice."}
   * @paramDef {"type":"String","label":"Reference","name":"reference","description":"Filter by payment reference."}
   * @paramDef {"type":"String","label":"From Date","name":"fromDate","uiComponent":{"type":"DATE_PICKER"},"description":"Filter payments from this date."}
   * @paramDef {"type":"String","label":"To Date","name":"toDate","uiComponent":{"type":"DATE_PICKER"},"description":"Filter payments until this date."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number for pagination. Default: 1."}
   *
   * @returns {Object}
   * @sampleResult {"Payments":[{"PaymentID":"pay-123","Amount":500.00,"Date":"2025-01-15","Reference":"CHK-1234","Invoice":{"InvoiceNumber":"INV-001"}}],"pagination":{"page":1,"pageSize":100}}
   */
  async findPayments(tenantId, invoiceId, reference, fromDate, toDate, page) {
    const whereFilters = []

    if (invoiceId) {
      whereFilters.push(`Invoice.InvoiceID==Guid("${ invoiceId }")`)
    }

    if (reference) {
      whereFilters.push(`Reference=="${ reference }"`)
    }

    if (fromDate) {
      whereFilters.push(`Date>=DateTime(${ formatDateForXero(fromDate) })`)
    }

    if (toDate) {
      whereFilters.push(`Date<=DateTime(${ formatDateForXero(toDate) })`)
    }

    const response = await this.#apiRequest({
      logTag: 'findPayments',
      url: `${ API_BASE_URL }/Payments`,
      query: {
        page: page || 1,
        where: whereFilters.length > 0 ? whereFilters.join(' AND ') : undefined,
      },
      tenantId,
    })

    return {
      Payments: response.Payments || [],
      pagination: {
        page: page || 1,
        pageSize: DEFAULT_LIMIT,
      },
    }
  }

  /**
   * @operationName Delete Payment
   * @category Payments
   * @description Deletes a payment from Xero. Only non-reconciled payments can be deleted.
   *
   * @route DELETE /delete-payment
   * @appearanceColor #13B5EA #25C0F0
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"tenantId","dictionary":"getTenantsDictionary","description":"Select the Xero organization. Required if multiple organizations are connected."}
   * @paramDef {"type":"String","label":"Payment ID","name":"paymentId","required":true,"description":"The unique identifier of the payment to delete."}
   *
   * @returns {Object}
   * @sampleResult {"PaymentID":"pay-123-456","Status":"DELETED"}
   */
  async deletePayment(tenantId, paymentId) {
    if (!paymentId) {
      throw new Error('"Payment ID" is required')
    }

    const response = await this.#apiRequest({
      logTag: 'deletePayment',
      method: 'post',
      url: `${ API_BASE_URL }/Payments/${ paymentId }`,
      body: {
        PaymentID: paymentId,
        Status: 'DELETED',
      },
      tenantId,
    })

    return response.Payments?.[0]
  }

  // ======================================= END OF PAYMENTS =======================================

  // ========================================== BANK TRANSACTIONS ===========================================

  /**
   * @operationName Create Bank Transaction
   * @category Bank Transactions
   * @description Creates a spend or receive money transaction in Xero.
   *
   * @route POST /create-bank-transaction
   * @appearanceColor #13B5EA #25C0F0
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"tenantId","dictionary":"getTenantsDictionary","description":"Select the Xero organization. Required if multiple organizations are connected."}
   * @paramDef {"type":"String","label":"Type","name":"type","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["RECEIVE","SPEND"]}},"description":"Transaction type: RECEIVE (money in) or SPEND (money out)."}
   * @paramDef {"type":"String","label":"Contact","name":"contactId","required":true,"dictionary":"getContactsDictionary","dependsOn":["tenantId"],"description":"Select the contact for this transaction."}
   * @paramDef {"type":"String","label":"Bank Account","name":"bankAccountId","required":true,"dictionary":"getBankAccountsDictionary","dependsOn":["tenantId"],"description":"Select the bank account."}
   * @paramDef {"type":"String","label":"Date","name":"date","uiComponent":{"type":"DATE_PICKER"},"description":"Transaction date. Defaults to today."}
   * @paramDef {"type":"String","label":"Reference","name":"reference","description":"Transaction reference for tracking."}
   * @paramDef {"type":"Array<Object>","label":"Line Items","name":"lineItems","required":true,"description":"Array of line items with Description, Quantity, UnitAmount, AccountCode."}
   *
   * @returns {Object}
   * @sampleResult {"BankTransactionID":"bt-123-456","Type":"RECEIVE","Contact":{"Name":"Client Inc"},"BankAccount":{"Name":"Business Checking"},"Total":500.00,"Reference":"Payment received"}
   */
  async createBankTransaction(tenantId, type, contactId, bankAccountId, date, reference, lineItems) {
    if (!type) {
      throw new Error('"Type" is required')
    }

    if (!contactId) {
      throw new Error('"Contact" is required')
    }

    if (!bankAccountId) {
      throw new Error('"Bank Account" is required')
    }

    if (!lineItems || lineItems.length === 0) {
      throw new Error('"Line Items" is required')
    }

    const transaction = cleanupObject({
      Type: type,
      Contact: { ContactID: contactId },
      BankAccount: { AccountID: bankAccountId },
      Date: date || new Date().toISOString().split('T')[0],
      Reference: reference,
      LineItems: lineItems,
    })

    const response = await this.#apiRequest({
      logTag: 'createBankTransaction',
      method: 'put',
      url: `${ API_BASE_URL }/BankTransactions`,
      body: { BankTransactions: [transaction] },
      tenantId,
    })

    return response.BankTransactions?.[0]
  }

  /**
   * @operationName Get Bank Transaction
   * @category Bank Transactions
   * @description Retrieves a single bank transaction by ID with full details.
   *
   * @route POST /get-bank-transaction
   * @appearanceColor #13B5EA #25C0F0
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"tenantId","dictionary":"getTenantsDictionary","description":"Select the Xero organization. Required if multiple organizations are connected."}
   * @paramDef {"type":"String","label":"Transaction ID","name":"transactionId","required":true,"description":"The unique identifier of the bank transaction."}
   *
   * @returns {Object}
   * @sampleResult {"BankTransactionID":"bt-123-456","Type":"RECEIVE","Contact":{"ContactID":"c-123","Name":"Client Inc"},"BankAccount":{"AccountID":"acc-123","Name":"Business Checking"},"Date":"2025-01-15","Reference":"INV-001 Payment","LineItems":[{"Description":"Payment for services","LineAmount":500}],"SubTotal":500,"Total":500,"IsReconciled":false}
   */
  async getBankTransaction(tenantId, transactionId) {
    if (!transactionId) {
      throw new Error('"Transaction ID" is required')
    }

    const response = await this.#apiRequest({
      logTag: 'getBankTransaction',
      url: `${ API_BASE_URL }/BankTransactions/${ transactionId }`,
      tenantId,
    })

    return response.BankTransactions?.[0]
  }

  /**
   * @operationName Find Bank Transactions
   * @category Bank Transactions
   * @description Searches for bank transactions with optional filters by type, reference, invoice, or date range.
   *
   * @route POST /find-bank-transactions
   * @appearanceColor #13B5EA #25C0F0
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"tenantId","dictionary":"getTenantsDictionary","description":"Select the Xero organization. Required if multiple organizations are connected."}
   * @paramDef {"type":"String","label":"Type","name":"type","uiComponent":{"type":"DROPDOWN","options":{"values":["RECEIVE","SPEND"]}},"description":"Filter by transaction type."}
   * @paramDef {"type":"String","label":"Bank Account","name":"bankAccountId","dictionary":"getBankAccountsDictionary","dependsOn":["tenantId"],"description":"Filter by bank account."}
   * @paramDef {"type":"String","label":"Reference","name":"reference","description":"Filter by transaction reference."}
   * @paramDef {"type":"String","label":"From Date","name":"fromDate","uiComponent":{"type":"DATE_PICKER"},"description":"Filter transactions from this date."}
   * @paramDef {"type":"String","label":"To Date","name":"toDate","uiComponent":{"type":"DATE_PICKER"},"description":"Filter transactions until this date."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number for pagination. Default: 1."}
   *
   * @returns {Object}
   * @sampleResult {"BankTransactions":[{"BankTransactionID":"bt-123","Type":"RECEIVE","Contact":{"Name":"Client Inc"},"Total":500,"Reference":"Payment"}],"pagination":{"page":1,"pageSize":100}}
   */
  async findBankTransactions(tenantId, type, bankAccountId, reference, fromDate, toDate, page) {
    const whereFilters = []

    if (type) {
      whereFilters.push(`Type=="${ type }"`)
    }

    if (bankAccountId) {
      whereFilters.push(`BankAccount.AccountID==Guid("${ bankAccountId }")`)
    }

    if (reference) {
      whereFilters.push(`Reference!=null AND Reference.Contains("${ reference }")`)
    }

    if (fromDate) {
      whereFilters.push(`Date>=DateTime(${ formatDateForXero(fromDate) })`)
    }

    if (toDate) {
      whereFilters.push(`Date<=DateTime(${ formatDateForXero(toDate) })`)
    }

    const response = await this.#apiRequest({
      logTag: 'findBankTransactions',
      url: `${ API_BASE_URL }/BankTransactions`,
      query: {
        page: page || 1,
        where: whereFilters.length > 0 ? whereFilters.join(' AND ') : undefined,
      },
      tenantId,
    })

    return {
      BankTransactions: response.BankTransactions || [],
      pagination: {
        page: page || 1,
        pageSize: DEFAULT_LIMIT,
      },
    }
  }

  // ======================================= END OF BANK TRANSACTIONS =======================================

  // ========================================== CREDIT NOTES ===========================================

  /**
   * @operationName Create Credit Note
   * @category Credit Notes
   * @description Creates a credit note to refund or credit a customer/supplier.
   *
   * @route POST /create-credit-note
   * @appearanceColor #13B5EA #25C0F0
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"tenantId","dictionary":"getTenantsDictionary","description":"Select the Xero organization. Required if multiple organizations are connected."}
   * @paramDef {"type":"String","label":"Contact","name":"contactId","required":true,"dictionary":"getContactsDictionary","dependsOn":["tenantId"],"description":"Select the contact for this credit note."}
   * @paramDef {"type":"String","label":"Type","name":"type","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["ACCRECCREDIT","ACCPAYCREDIT"]}},"description":"Type: ACCRECCREDIT (customer) or ACCPAYCREDIT (supplier)."}
   * @paramDef {"type":"String","label":"Credit Note Number","name":"creditNoteNumber","description":"Custom credit note number."}
   * @paramDef {"type":"String","label":"Reference","name":"reference","description":"Reference for tracking."}
   * @paramDef {"type":"String","label":"Date","name":"date","uiComponent":{"type":"DATE_PICKER"},"description":"Credit note date."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["DRAFT","SUBMITTED","AUTHORISED"]}},"description":"Initial status."}
   * @paramDef {"type":"Array<Object>","label":"Line Items","name":"lineItems","required":true,"description":"Array of line items."}
   *
   * @returns {Object}
   * @sampleResult {"CreditNoteID":"cn-123-456","CreditNoteNumber":"CN-001","Type":"ACCRECCREDIT","Contact":{"Name":"Acme Corp"},"Status":"AUTHORISED","Total":100.00}
   */
  async createCreditNote(tenantId, contactId, type, creditNoteNumber, reference, date, status, lineItems) {
    if (!contactId) {
      throw new Error('"Contact" is required')
    }

    if (!type) {
      throw new Error('"Type" is required')
    }

    if (!lineItems || lineItems.length === 0) {
      throw new Error('"Line Items" is required')
    }

    const creditNote = cleanupObject({
      Type: type,
      Contact: { ContactID: contactId },
      CreditNoteNumber: creditNoteNumber,
      Reference: reference,
      Date: date,
      Status: status || 'DRAFT',
      LineItems: lineItems,
    })

    const response = await this.#apiRequest({
      logTag: 'createCreditNote',
      method: 'put',
      url: `${ API_BASE_URL }/CreditNotes`,
      body: { CreditNotes: [creditNote] },
      tenantId,
    })

    return response.CreditNotes?.[0]
  }

  /**
   * @operationName Get Credit Note
   * @category Credit Notes
   * @description Retrieves a single credit note by ID.
   *
   * @route POST /get-credit-note
   * @appearanceColor #13B5EA #25C0F0
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"tenantId","dictionary":"getTenantsDictionary","description":"Select the Xero organization. Required if multiple organizations are connected."}
   * @paramDef {"type":"String","label":"Credit Note ID","name":"creditNoteId","required":true,"description":"The unique identifier of the credit note."}
   *
   * @returns {Object}
   * @sampleResult {"CreditNoteID":"cn-123-456","CreditNoteNumber":"CN-001","Type":"ACCRECCREDIT","Contact":{"Name":"Acme Corp"},"Status":"AUTHORISED","Total":100.00,"RemainingCredit":100.00}
   */
  async getCreditNote(tenantId, creditNoteId) {
    if (!creditNoteId) {
      throw new Error('"Credit Note ID" is required')
    }

    const response = await this.#apiRequest({
      logTag: 'getCreditNote',
      url: `${ API_BASE_URL }/CreditNotes/${ creditNoteId }`,
      tenantId,
    })

    return response.CreditNotes?.[0]
  }

  /**
   * @operationName Allocate Credit Note
   * @category Credit Notes
   * @description Allocates a credit note to an invoice to reduce the amount due.
   *
   * @route POST /allocate-credit-note
   * @appearanceColor #13B5EA #25C0F0
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"tenantId","dictionary":"getTenantsDictionary","description":"Select the Xero organization. Required if multiple organizations are connected."}
   * @paramDef {"type":"String","label":"Credit Note ID","name":"creditNoteId","required":true,"description":"The credit note to allocate."}
   * @paramDef {"type":"String","label":"Invoice","name":"invoiceId","required":true,"dictionary":"getInvoicesDictionary","dependsOn":["tenantId"],"description":"Select the invoice to apply the credit to."}
   * @paramDef {"type":"Number","label":"Amount","name":"amount","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Amount to allocate from the credit note."}
   *
   * @returns {Object}
   * @sampleResult {"CreditNoteID":"cn-123-456","Allocations":[{"Invoice":{"InvoiceID":"inv-123"},"Amount":100.00,"Date":"2025-01-15"}],"RemainingCredit":0.00}
   */
  async allocateCreditNote(tenantId, creditNoteId, invoiceId, amount) {
    if (!creditNoteId) {
      throw new Error('"Credit Note ID" is required')
    }

    if (!invoiceId) {
      throw new Error('"Invoice" is required')
    }

    if (!amount) {
      throw new Error('"Amount" is required')
    }

    const response = await this.#apiRequest({
      logTag: 'allocateCreditNote',
      method: 'put',
      url: `${ API_BASE_URL }/CreditNotes/${ creditNoteId }/Allocations`,
      body: {
        Allocations: [
          {
            Invoice: { InvoiceID: invoiceId },
            Amount: amount,
            Date: new Date().toISOString().split('T')[0],
          },
        ],
      },
      tenantId,
    })

    return response.CreditNotes?.[0]
  }

  // ======================================= END OF CREDIT NOTES =======================================

  // ========================================== QUOTES ===========================================

  /**
   * @operationName Create Quote
   * @category Quotes
   * @description Creates a new quote/estimate for a customer.
   *
   * @route POST /create-quote
   * @appearanceColor #13B5EA #25C0F0
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"tenantId","dictionary":"getTenantsDictionary","description":"Select the Xero organization. Required if multiple organizations are connected."}
   * @paramDef {"type":"String","label":"Contact","name":"contactId","required":true,"dictionary":"getContactsDictionary","dependsOn":["tenantId"],"description":"Select the customer for this quote."}
   * @paramDef {"type":"String","label":"Quote Number","name":"quoteNumber","description":"Custom quote number."}
   * @paramDef {"type":"String","label":"Reference","name":"reference","description":"Reference for tracking."}
   * @paramDef {"type":"String","label":"Date","name":"date","uiComponent":{"type":"DATE_PICKER"},"description":"Quote date."}
   * @paramDef {"type":"String","label":"Expiry Date","name":"expiryDate","uiComponent":{"type":"DATE_PICKER"},"description":"Quote expiry date."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"Quote title or summary."}
   * @paramDef {"type":"String","label":"Summary","name":"summary","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Detailed summary or notes."}
   * @paramDef {"type":"Array<Object>","label":"Line Items","name":"lineItems","required":true,"description":"Array of line items."}
   *
   * @returns {Object}
   * @sampleResult {"QuoteID":"q-123-456","QuoteNumber":"QU-001","Contact":{"Name":"Acme Corp"},"Status":"DRAFT","Total":1500.00}
   */
  async createQuote(tenantId, contactId, quoteNumber, reference, date, expiryDate, title, summary, lineItems) {
    if (!contactId) {
      throw new Error('"Contact" is required')
    }

    if (!lineItems || lineItems.length === 0) {
      throw new Error('"Line Items" is required')
    }

    const quote = cleanupObject({
      Contact: { ContactID: contactId },
      QuoteNumber: quoteNumber,
      Reference: reference,
      Date: date,
      ExpiryDate: expiryDate,
      Title: title,
      Summary: summary,
      LineItems: lineItems,
    })

    const response = await this.#apiRequest({
      logTag: 'createQuote',
      method: 'put',
      url: `${ API_BASE_URL }/Quotes`,
      body: { Quotes: [quote] },
      tenantId,
    })

    return response.Quotes?.[0]
  }

  /**
   * @operationName Get Quote
   * @category Quotes
   * @description Retrieves a single quote by ID.
   *
   * @route POST /get-quote
   * @appearanceColor #13B5EA #25C0F0
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"tenantId","dictionary":"getTenantsDictionary","description":"Select the Xero organization. Required if multiple organizations are connected."}
   * @paramDef {"type":"String","label":"Quote ID","name":"quoteId","required":true,"description":"The unique identifier of the quote."}
   *
   * @returns {Object}
   * @sampleResult {"QuoteID":"q-123-456","QuoteNumber":"QU-001","Contact":{"Name":"Acme Corp"},"Status":"SENT","Title":"Project Proposal","LineItems":[{"Description":"Consulting","Quantity":10,"UnitAmount":150}],"Total":1500.00}
   */
  async getQuote(tenantId, quoteId) {
    if (!quoteId) {
      throw new Error('"Quote ID" is required')
    }

    const response = await this.#apiRequest({
      logTag: 'getQuote',
      url: `${ API_BASE_URL }/Quotes/${ quoteId }`,
      tenantId,
    })

    return response.Quotes?.[0]
  }

  /**
   * @operationName Find Quotes
   * @category Quotes
   * @description Searches for quotes with optional filters.
   *
   * @route POST /find-quotes
   * @appearanceColor #13B5EA #25C0F0
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"tenantId","dictionary":"getTenantsDictionary","description":"Select the Xero organization. Required if multiple organizations are connected."}
   * @paramDef {"type":"String","label":"Contact","name":"contactId","dictionary":"getContactsDictionary","dependsOn":["tenantId"],"description":"Filter by contact."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["DRAFT","SENT","ACCEPTED","DECLINED","INVOICED"]}},"description":"Filter by status."}
   * @paramDef {"type":"String","label":"From Date","name":"fromDate","uiComponent":{"type":"DATE_PICKER"},"description":"Filter quotes from this date."}
   * @paramDef {"type":"String","label":"To Date","name":"toDate","uiComponent":{"type":"DATE_PICKER"},"description":"Filter quotes until this date."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number for pagination."}
   *
   * @returns {Object}
   * @sampleResult {"Quotes":[{"QuoteID":"q-123","QuoteNumber":"QU-001","Contact":{"Name":"Acme Corp"},"Status":"SENT","Total":1500}],"pagination":{"page":1,"pageSize":100}}
   */
  async findQuotes(tenantId, contactId, status, fromDate, toDate, page) {
    const whereFilters = []

    if (contactId) {
      whereFilters.push(`Contact.ContactID==Guid("${ contactId }")`)
    }

    if (status) {
      whereFilters.push(`Status=="${ status }"`)
    }

    if (fromDate) {
      whereFilters.push(`Date>=DateTime(${ formatDateForXero(fromDate) })`)
    }

    if (toDate) {
      whereFilters.push(`Date<=DateTime(${ formatDateForXero(toDate) })`)
    }

    const response = await this.#apiRequest({
      logTag: 'findQuotes',
      url: `${ API_BASE_URL }/Quotes`,
      query: {
        page: page || 1,
        where: whereFilters.length > 0 ? whereFilters.join(' AND ') : undefined,
      },
      tenantId,
    })

    return {
      Quotes: response.Quotes || [],
      pagination: {
        page: page || 1,
        pageSize: DEFAULT_LIMIT,
      },
    }
  }

  // ======================================= END OF QUOTES =======================================

  // ========================================== PURCHASE ORDERS ===========================================

  /**
   * @operationName Create Purchase Order
   * @category Purchase Orders
   * @description Creates a new purchase order for a supplier.
   *
   * @route POST /create-purchase-order
   * @appearanceColor #13B5EA #25C0F0
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"tenantId","dictionary":"getTenantsDictionary","description":"Select the Xero organization. Required if multiple organizations are connected."}
   * @paramDef {"type":"String","label":"Contact","name":"contactId","required":true,"dictionary":"getContactsDictionary","dependsOn":["tenantId"],"description":"Select the supplier."}
   * @paramDef {"type":"String","label":"PO Number","name":"purchaseOrderNumber","description":"Custom purchase order number."}
   * @paramDef {"type":"String","label":"Reference","name":"reference","description":"Reference for tracking."}
   * @paramDef {"type":"String","label":"Date","name":"date","uiComponent":{"type":"DATE_PICKER"},"description":"Purchase order date."}
   * @paramDef {"type":"String","label":"Delivery Date","name":"deliveryDate","uiComponent":{"type":"DATE_PICKER"},"description":"Expected delivery date."}
   * @paramDef {"type":"String","label":"Delivery Address","name":"deliveryAddress","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Delivery address."}
   * @paramDef {"type":"Array<Object>","label":"Line Items","name":"lineItems","required":true,"description":"Array of line items."}
   *
   * @returns {Object}
   * @sampleResult {"PurchaseOrderID":"po-123-456","PurchaseOrderNumber":"PO-001","Contact":{"Name":"Supplier Inc"},"Status":"DRAFT","Total":2000.00}
   */
  async createPurchaseOrder(tenantId, contactId, purchaseOrderNumber, reference, date, deliveryDate, deliveryAddress, lineItems) {
    if (!contactId) {
      throw new Error('"Contact" is required')
    }

    if (!lineItems || lineItems.length === 0) {
      throw new Error('"Line Items" is required')
    }

    const purchaseOrder = cleanupObject({
      Contact: { ContactID: contactId },
      PurchaseOrderNumber: purchaseOrderNumber,
      Reference: reference,
      Date: date,
      DeliveryDate: deliveryDate,
      DeliveryAddress: deliveryAddress,
      LineItems: lineItems,
    })

    const response = await this.#apiRequest({
      logTag: 'createPurchaseOrder',
      method: 'put',
      url: `${ API_BASE_URL }/PurchaseOrders`,
      body: { PurchaseOrders: [purchaseOrder] },
      tenantId,
    })

    return response.PurchaseOrders?.[0]
  }

  /**
   * @operationName Get Purchase Order
   * @category Purchase Orders
   * @description Retrieves a single purchase order by ID.
   *
   * @route POST /get-purchase-order
   * @appearanceColor #13B5EA #25C0F0
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"tenantId","dictionary":"getTenantsDictionary","description":"Select the Xero organization. Required if multiple organizations are connected."}
   * @paramDef {"type":"String","label":"Purchase Order ID","name":"purchaseOrderId","required":true,"description":"The unique identifier of the purchase order."}
   *
   * @returns {Object}
   * @sampleResult {"PurchaseOrderID":"po-123-456","PurchaseOrderNumber":"PO-001","Contact":{"Name":"Supplier Inc"},"Status":"AUTHORISED","DeliveryDate":"2025-02-01","LineItems":[{"Description":"Office Supplies","Quantity":100,"UnitAmount":20}],"Total":2000.00}
   */
  async getPurchaseOrder(tenantId, purchaseOrderId) {
    if (!purchaseOrderId) {
      throw new Error('"Purchase Order ID" is required')
    }

    const response = await this.#apiRequest({
      logTag: 'getPurchaseOrder',
      url: `${ API_BASE_URL }/PurchaseOrders/${ purchaseOrderId }`,
      tenantId,
    })

    return response.PurchaseOrders?.[0]
  }

  // ======================================= END OF PURCHASE ORDERS =======================================

  // ========================================== ITEMS ===========================================

  /**
   * @operationName Create Item
   * @category Items
   * @description Creates a new product or service item in Xero.
   *
   * @route POST /create-item
   * @appearanceColor #13B5EA #25C0F0
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"tenantId","dictionary":"getTenantsDictionary","description":"Select the Xero organization. Required if multiple organizations are connected."}
   * @paramDef {"type":"String","label":"Code","name":"code","required":true,"description":"Unique item code (SKU)."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Item name."}
   * @paramDef {"type":"String","label":"Description","name":"description","description":"Item description for sales."}
   * @paramDef {"type":"Number","label":"Sales Unit Price","name":"salesUnitPrice","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Default sales price."}
   * @paramDef {"type":"String","label":"Sales Account","name":"salesAccountCode","dictionary":"getAccountsDictionary","dependsOn":["tenantId"],"description":"Revenue account for sales."}
   * @paramDef {"type":"Number","label":"Purchase Unit Price","name":"purchaseUnitPrice","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Default purchase price."}
   * @paramDef {"type":"String","label":"Purchase Account","name":"purchaseAccountCode","dictionary":"getAccountsDictionary","dependsOn":["tenantId"],"description":"Expense account for purchases."}
   * @paramDef {"type":"Boolean","label":"Is Sold","name":"isSold","uiComponent":{"type":"TOGGLE"},"description":"Item can be sold."}
   * @paramDef {"type":"Boolean","label":"Is Purchased","name":"isPurchased","uiComponent":{"type":"TOGGLE"},"description":"Item can be purchased."}
   *
   * @returns {Object}
   * @sampleResult {"ItemID":"item-123-456","Code":"WIDGET-001","Name":"Premium Widget","SalesDetails":{"UnitPrice":99.00},"PurchaseDetails":{"UnitPrice":50.00}}
   */
  async createItem(tenantId, code, name, description, salesUnitPrice, salesAccountCode, purchaseUnitPrice, purchaseAccountCode, isSold, isPurchased) {
    if (!code) {
      throw new Error('"Code" is required')
    }

    if (!name) {
      throw new Error('"Name" is required')
    }

    const item = cleanupObject({
      Code: code,
      Name: name,
      Description: description,
      IsSold: isSold !== false,
      IsPurchased: isPurchased !== false,
      SalesDetails: salesUnitPrice || salesAccountCode ? cleanupObject({
        UnitPrice: salesUnitPrice,
        AccountCode: salesAccountCode,
      }) : undefined,
      PurchaseDetails: purchaseUnitPrice || purchaseAccountCode ? cleanupObject({
        UnitPrice: purchaseUnitPrice,
        COGSAccountCode: purchaseAccountCode,
      }) : undefined,
    })

    const response = await this.#apiRequest({
      logTag: 'createItem',
      method: 'put',
      url: `${ API_BASE_URL }/Items`,
      body: { Items: [item] },
      tenantId,
    })

    return response.Items?.[0]
  }

  /**
   * @operationName Get Item
   * @category Items
   * @description Retrieves a single item by ID or code.
   *
   * @route POST /get-item
   * @appearanceColor #13B5EA #25C0F0
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"tenantId","dictionary":"getTenantsDictionary","description":"Select the Xero organization. Required if multiple organizations are connected."}
   * @paramDef {"type":"String","label":"Item","name":"itemId","required":true,"dictionary":"getItemsDictionary","dependsOn":["tenantId"],"description":"Select the item to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"ItemID":"item-123-456","Code":"WIDGET-001","Name":"Premium Widget","Description":"High-quality widget","IsSold":true,"IsPurchased":true,"SalesDetails":{"UnitPrice":99.00,"AccountCode":"200"},"PurchaseDetails":{"UnitPrice":50.00}}
   */
  async getItem(tenantId, itemId) {
    if (!itemId) {
      throw new Error('"Item" is required')
    }

    const response = await this.#apiRequest({
      logTag: 'getItem',
      url: `${ API_BASE_URL }/Items/${ itemId }`,
      tenantId,
    })

    return response.Items?.[0]
  }

  /**
   * @operationName Find Items
   * @category Items
   * @description Lists all items in Xero with optional search filter.
   *
   * @route POST /find-items
   * @appearanceColor #13B5EA #25C0F0
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"tenantId","dictionary":"getTenantsDictionary","description":"Select the Xero organization. Required if multiple organizations are connected."}
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Search by name or code."}
   *
   * @returns {Object}
   * @sampleResult {"Items":[{"ItemID":"item-123","Code":"WIDGET-001","Name":"Premium Widget","SalesDetails":{"UnitPrice":99.00}}]}
   */
  async findItems(tenantId, search) {
    const response = await this.#apiRequest({
      logTag: 'findItems',
      url: `${ API_BASE_URL }/Items`,
      query: {
        where: search ? `Name.Contains("${ search }") OR Code.Contains("${ search }")` : undefined,
      },
      tenantId,
    })

    return {
      Items: response.Items || [],
    }
  }

  // ======================================= END OF ITEMS =======================================

  // ========================================== ACCOUNTS ===========================================

  /**
   * @operationName Get Accounts
   * @category Accounts
   * @description Retrieves the chart of accounts with optional type filter.
   *
   * @route POST /get-accounts
   * @appearanceColor #13B5EA #25C0F0
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"tenantId","dictionary":"getTenantsDictionary","description":"Select the Xero organization. Required if multiple organizations are connected."}
   * @paramDef {"type":"String","label":"Type","name":"type","uiComponent":{"type":"DROPDOWN","options":{"values":["BANK","CURRENT","CURRLIAB","DEPRECIATN","DIRECTCOSTS","EQUITY","EXPENSE","FIXED","INVENTORY","LIABILITY","NONCURRENT","OTHERINCOME","OVERHEADS","PREPAYMENT","REVENUE","SALES","TERMLIAB"]}},"description":"Filter by account type."}
   * @paramDef {"type":"String","label":"Class","name":"accountClass","uiComponent":{"type":"DROPDOWN","options":{"values":["ASSET","EQUITY","EXPENSE","LIABILITY","REVENUE"]}},"description":"Filter by account class."}
   *
   * @returns {Object}
   * @sampleResult {"Accounts":[{"AccountID":"acc-123","Code":"200","Name":"Sales Revenue","Type":"REVENUE","Class":"REVENUE","Status":"ACTIVE"}]}
   */
  async getAccounts(tenantId, type, accountClass) {
    const whereFilters = []

    if (type) {
      whereFilters.push(`Type=="${ type }"`)
    }

    if (accountClass) {
      whereFilters.push(`Class=="${ accountClass }"`)
    }

    const response = await this.#apiRequest({
      logTag: 'getAccounts',
      url: `${ API_BASE_URL }/Accounts`,
      query: {
        where: whereFilters.length > 0 ? whereFilters.join(' AND ') : undefined,
      },
      tenantId,
    })

    return {
      Accounts: response.Accounts || [],
    }
  }

  // ======================================= END OF ACCOUNTS =======================================

  // ========================================== REPORTS ===========================================

  /**
   * @operationName Get Balance Sheet
   * @category Reports
   * @description Retrieves the balance sheet report showing assets, liabilities, and equity.
   *
   * @route POST /get-balance-sheet
   * @appearanceColor #13B5EA #25C0F0
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"tenantId","dictionary":"getTenantsDictionary","description":"Select the Xero organization. Required if multiple organizations are connected."}
   * @paramDef {"type":"String","label":"Date","name":"date","uiComponent":{"type":"DATE_PICKER"},"description":"Balance sheet date. Defaults to today."}
   * @paramDef {"type":"String","label":"Tracking Category 1","name":"trackingCategoryId1","dictionary":"getTrackingCategoriesDictionary","dependsOn":["tenantId"],"description":"Filter by first tracking category."}
   * @paramDef {"type":"String","label":"Tracking Option 1","name":"trackingOptionId1","description":"Tracking option value for category 1."}
   *
   * @returns {Object}
   * @sampleResult {"ReportID":"BalanceSheet","ReportName":"Balance Sheet","ReportDate":"2025-01-15","Rows":[{"RowType":"Section","Title":"Assets","Rows":[{"Cells":[{"Value":"Current Assets"},{"Value":"50000.00"}]}]}]}
   */
  async getBalanceSheet(tenantId, date, trackingCategoryId1, trackingOptionId1) {
    const response = await this.#apiRequest({
      logTag: 'getBalanceSheet',
      url: `${ API_BASE_URL }/Reports/BalanceSheet`,
      query: cleanupObject({
        date: date || new Date().toISOString().split('T')[0],
        trackingCategoryID: trackingCategoryId1,
        trackingOptionID: trackingOptionId1,
      }),
      tenantId,
    })

    return response.Reports?.[0]
  }

  /**
   * @operationName Get Profit and Loss
   * @category Reports
   * @description Retrieves the profit and loss (income statement) report.
   *
   * @route POST /get-profit-and-loss
   * @appearanceColor #13B5EA #25C0F0
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"tenantId","dictionary":"getTenantsDictionary","description":"Select the Xero organization. Required if multiple organizations are connected."}
   * @paramDef {"type":"String","label":"From Date","name":"fromDate","uiComponent":{"type":"DATE_PICKER"},"description":"Start date for the report period."}
   * @paramDef {"type":"String","label":"To Date","name":"toDate","uiComponent":{"type":"DATE_PICKER"},"description":"End date for the report period."}
   * @paramDef {"type":"String","label":"Tracking Category 1","name":"trackingCategoryId1","dictionary":"getTrackingCategoriesDictionary","dependsOn":["tenantId"],"description":"Filter by tracking category."}
   * @paramDef {"type":"String","label":"Tracking Option 1","name":"trackingOptionId1","description":"Tracking option value."}
   *
   * @returns {Object}
   * @sampleResult {"ReportID":"ProfitAndLoss","ReportName":"Profit and Loss","ReportDate":"2025-01-15","Rows":[{"RowType":"Section","Title":"Revenue","Rows":[{"Cells":[{"Value":"Sales"},{"Value":"100000.00"}]}]}]}
   */
  async getProfitAndLoss(tenantId, fromDate, toDate, trackingCategoryId1, trackingOptionId1) {
    const response = await this.#apiRequest({
      logTag: 'getProfitAndLoss',
      url: `${ API_BASE_URL }/Reports/ProfitAndLoss`,
      query: cleanupObject({
        fromDate,
        toDate,
        trackingCategoryID: trackingCategoryId1,
        trackingOptionID: trackingOptionId1,
      }),
      tenantId,
    })

    return response.Reports?.[0]
  }

  /**
   * @operationName Get Trial Balance
   * @category Reports
   * @description Retrieves the trial balance report showing all account balances.
   *
   * @route POST /get-trial-balance
   * @appearanceColor #13B5EA #25C0F0
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"tenantId","dictionary":"getTenantsDictionary","description":"Select the Xero organization. Required if multiple organizations are connected."}
   * @paramDef {"type":"String","label":"Date","name":"date","uiComponent":{"type":"DATE_PICKER"},"description":"Trial balance date."}
   *
   * @returns {Object}
   * @sampleResult {"ReportID":"TrialBalance","ReportName":"Trial Balance","ReportDate":"2025-01-15","Rows":[{"RowType":"Section","Title":"Revenue","Rows":[{"Cells":[{"Value":"Sales Revenue"},{"Value":"0.00"},{"Value":"100000.00"}]}]}]}
   */
  async getTrialBalance(tenantId, date) {
    const response = await this.#apiRequest({
      logTag: 'getTrialBalance',
      url: `${ API_BASE_URL }/Reports/TrialBalance`,
      query: cleanupObject({
        date,
      }),
      tenantId,
    })

    return response.Reports?.[0]
  }

  /**
   * @operationName Get Aged Receivables
   * @category Reports
   * @description Retrieves aged receivables report showing outstanding customer invoices.
   *
   * @route POST /get-aged-receivables
   * @appearanceColor #13B5EA #25C0F0
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"tenantId","dictionary":"getTenantsDictionary","description":"Select the Xero organization. Required if multiple organizations are connected."}
   * @paramDef {"type":"String","label":"Date","name":"date","uiComponent":{"type":"DATE_PICKER"},"description":"Report date."}
   * @paramDef {"type":"String","label":"Contact","name":"contactId","dictionary":"getContactsDictionary","dependsOn":["tenantId"],"description":"Filter by specific contact."}
   *
   * @returns {Object}
   * @sampleResult {"ReportID":"AgedReceivablesByContact","ReportName":"Aged Receivables by Contact","Rows":[{"RowType":"Row","Cells":[{"Value":"Acme Corp"},{"Value":"1000.00"},{"Value":"500.00"},{"Value":"0.00"},{"Value":"0.00"},{"Value":"1500.00"}]}]}
   */
  async getAgedReceivables(tenantId, date, contactId) {
    const response = await this.#apiRequest({
      logTag: 'getAgedReceivables',
      url: `${ API_BASE_URL }/Reports/AgedReceivablesByContact`,
      query: cleanupObject({
        date,
        contactID: contactId,
      }),
      tenantId,
    })

    return response.Reports?.[0]
  }

  /**
   * @operationName Get Aged Payables
   * @category Reports
   * @description Retrieves aged payables report showing outstanding supplier bills.
   *
   * @route POST /get-aged-payables
   * @appearanceColor #13B5EA #25C0F0
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"tenantId","dictionary":"getTenantsDictionary","description":"Select the Xero organization. Required if multiple organizations are connected."}
   * @paramDef {"type":"String","label":"Date","name":"date","uiComponent":{"type":"DATE_PICKER"},"description":"Report date."}
   * @paramDef {"type":"String","label":"Contact","name":"contactId","dictionary":"getContactsDictionary","dependsOn":["tenantId"],"description":"Filter by specific contact."}
   *
   * @returns {Object}
   * @sampleResult {"ReportID":"AgedPayablesByContact","ReportName":"Aged Payables by Contact","Rows":[{"RowType":"Row","Cells":[{"Value":"Supplier Inc"},{"Value":"2000.00"},{"Value":"0.00"},{"Value":"0.00"},{"Value":"0.00"},{"Value":"2000.00"}]}]}
   */
  async getAgedPayables(tenantId, date, contactId) {
    const response = await this.#apiRequest({
      logTag: 'getAgedPayables',
      url: `${ API_BASE_URL }/Reports/AgedPayablesByContact`,
      query: cleanupObject({
        date,
        contactID: contactId,
      }),
      tenantId,
    })

    return response.Reports?.[0]
  }

  // ======================================= END OF REPORTS =======================================

  // ========================================== ORGANIZATION ===========================================

  /**
   * @operationName Get Organization
   * @category Organization
   * @description Retrieves details about the connected Xero organization.
   *
   * @route POST /get-organization
   * @appearanceColor #13B5EA #25C0F0
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"tenantId","dictionary":"getTenantsDictionary","description":"Select the Xero organization. Required if multiple organizations are connected."}
   *
   * @returns {Object}
   * @sampleResult {"OrganisationID":"org-123-456","Name":"My Company Ltd","LegalName":"My Company Limited","PaysTax":true,"Version":"AU","OrganisationType":"COMPANY","BaseCurrency":"AUD","CountryCode":"AU","IsDemoCompany":false,"OrganisationStatus":"ACTIVE"}
   */
  async getOrganization(tenantId) {
    const response = await this.#apiRequest({
      logTag: 'getOrganization',
      url: `${ API_BASE_URL }/Organisation`,
      tenantId,
    })

    return response.Organisations?.[0]
  }

  /**
   * @operationName Get Currencies
   * @category Organization
   * @description Retrieves all currencies enabled for the organization.
   *
   * @route POST /get-currencies
   * @appearanceColor #13B5EA #25C0F0
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"tenantId","dictionary":"getTenantsDictionary","description":"Select the Xero organization. Required if multiple organizations are connected."}
   *
   * @returns {Object}
   * @sampleResult {"Currencies":[{"Code":"AUD","Description":"Australian Dollar"},{"Code":"USD","Description":"US Dollar"},{"Code":"EUR","Description":"Euro"}]}
   */
  async getCurrencies(tenantId) {
    const response = await this.#apiRequest({
      logTag: 'getCurrencies',
      url: `${ API_BASE_URL }/Currencies`,
      tenantId,
    })

    return {
      Currencies: response.Currencies || [],
    }
  }

  /**
   * @operationName Get Tax Rates
   * @category Organization
   * @description Retrieves all tax rates available in the organization.
   *
   * @route POST /get-tax-rates
   * @appearanceColor #13B5EA #25C0F0
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"tenantId","dictionary":"getTenantsDictionary","description":"Select the Xero organization. Required if multiple organizations are connected."}
   *
   * @returns {Object}
   * @sampleResult {"TaxRates":[{"Name":"GST on Income","TaxType":"OUTPUT","EffectiveRate":10,"Status":"ACTIVE"},{"Name":"GST on Expenses","TaxType":"INPUT","EffectiveRate":10,"Status":"ACTIVE"}]}
   */
  async getTaxRates(tenantId) {
    const response = await this.#apiRequest({
      logTag: 'getTaxRates',
      url: `${ API_BASE_URL }/TaxRates`,
      tenantId,
    })

    return {
      TaxRates: response.TaxRates || [],
    }
  }

  // ======================================= END OF ORGANIZATION =======================================

  // ========================================== TRIGGERS ===========================================

  /**
   * @operationName On Contact Created
   * @category Event Tracking
   * @description Triggers when a new contact is created in Xero. Use this to sync contacts to CRM systems, send welcome emails, or trigger onboarding workflows.
   * @registerAs REALTIME_TRIGGER
   *
   * @route POST /on-contact-created
   * @appearanceColor #13B5EA #25C0F0
   * @executionTimeoutInSeconds 120
   *
   * @returns {Object}
   * @sampleResult {"ContactID":"c-123-456","Name":"New Customer Inc","EmailAddress":"contact@newcustomer.com","IsCustomer":true,"IsSupplier":false}
   */
  onContactCreated(callType, payload) {
    if (callType === MethodCallTypes.SHAPE_EVENT) {
      return [{ name: 'onContactCreated', data: payload }]
    }

    if (callType === MethodCallTypes.FILTER_TRIGGER) {
      return { ids: payload.triggers.map(t => t.id) }
    }
  }

  /**
   * @operationName On Contact Updated
   * @category Event Tracking
   * @description Triggers when an existing contact is updated in Xero. Use this to keep external systems in sync.
   * @registerAs REALTIME_TRIGGER
   *
   * @route POST /on-contact-updated
   * @appearanceColor #13B5EA #25C0F0
   * @executionTimeoutInSeconds 120
   *
   * @returns {Object}
   * @sampleResult {"ContactID":"c-123-456","Name":"Updated Customer Inc","EmailAddress":"newemail@customer.com"}
   */
  onContactUpdated(callType, payload) {
    if (callType === MethodCallTypes.SHAPE_EVENT) {
      return [{ name: 'onContactUpdated', data: payload }]
    }

    if (callType === MethodCallTypes.FILTER_TRIGGER) {
      return { ids: payload.triggers.map(t => t.id) }
    }
  }

  /**
   * @operationName On Invoice Created
   * @category Event Tracking
   * @description Triggers when a new invoice is created in Xero. Perfect for notifying sales teams, sending customer communications, or updating dashboards.
   * @registerAs REALTIME_TRIGGER
   *
   * @route POST /on-invoice-created
   * @appearanceColor #13B5EA #25C0F0
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Invoice Type","name":"invoiceType","uiComponent":{"type":"DROPDOWN","options":{"values":["ACCREC","ACCPAY"]}},"description":"Filter by invoice type: ACCREC (Sales) or ACCPAY (Bills)."}
   *
   * @returns {Object}
   * @sampleResult {"InvoiceID":"inv-123-456","InvoiceNumber":"INV-001","Type":"ACCREC","Contact":{"Name":"Acme Corp"},"Total":1100.00,"Status":"DRAFT"}
   */
  onInvoiceCreated(callType, payload) {
    if (callType === MethodCallTypes.SHAPE_EVENT) {
      return [{ name: 'onInvoiceCreated', data: payload }]
    }

    if (callType === MethodCallTypes.FILTER_TRIGGER) {
      const ids = payload.triggers
        .filter(trigger => {
          if (!trigger.data.invoiceType) return true

          return trigger.data.invoiceType === payload.eventData.Type
        })
        .map(t => t.id)

      return { ids }
    }
  }

  /**
   * @operationName On Invoice Updated
   * @category Event Tracking
   * @description Triggers when an invoice is updated in Xero. Use this to track status changes, payment updates, or modifications.
   * @registerAs REALTIME_TRIGGER
   *
   * @route POST /on-invoice-updated
   * @appearanceColor #13B5EA #25C0F0
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Invoice Type","name":"invoiceType","uiComponent":{"type":"DROPDOWN","options":{"values":["ACCREC","ACCPAY"]}},"description":"Filter by invoice type."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["DRAFT","SUBMITTED","AUTHORISED","PAID","VOIDED"]}},"description":"Filter by status."}
   *
   * @returns {Object}
   * @sampleResult {"InvoiceID":"inv-123-456","InvoiceNumber":"INV-001","Type":"ACCREC","Status":"PAID","AmountPaid":1100.00}
   */
  onInvoiceUpdated(callType, payload) {
    if (callType === MethodCallTypes.SHAPE_EVENT) {
      return [{ name: 'onInvoiceUpdated', data: payload }]
    }

    if (callType === MethodCallTypes.FILTER_TRIGGER) {
      const ids = payload.triggers
        .filter(trigger => {
          if (trigger.data.invoiceType && trigger.data.invoiceType !== payload.eventData.Type) {
            return false
          }

          if (trigger.data.status && trigger.data.status !== payload.eventData.Status) {
            return false
          }

          return true
        })
        .map(t => t.id)

      return { ids }
    }
  }

  /**
   * @operationName On Credit Note Created
   * @category Event Tracking
   * @description Triggers when a credit note is created in Xero.
   * @registerAs REALTIME_TRIGGER
   *
   * @route POST /on-credit-note-created
   * @appearanceColor #13B5EA #25C0F0
   * @executionTimeoutInSeconds 120
   *
   * @returns {Object}
   * @sampleResult {"CreditNoteID":"cn-123-456","CreditNoteNumber":"CN-001","Type":"ACCRECCREDIT","Contact":{"Name":"Acme Corp"},"Total":100.00}
   */
  onCreditNoteCreated(callType, payload) {
    if (callType === MethodCallTypes.SHAPE_EVENT) {
      return [{ name: 'onCreditNoteCreated', data: payload }]
    }

    if (callType === MethodCallTypes.FILTER_TRIGGER) {
      return { ids: payload.triggers.map(t => t.id) }
    }
  }

  /**
   * @operationName On Credit Note Updated
   * @category Event Tracking
   * @description Triggers when a credit note is updated in Xero.
   * @registerAs REALTIME_TRIGGER
   *
   * @route POST /on-credit-note-updated
   * @appearanceColor #13B5EA #25C0F0
   * @executionTimeoutInSeconds 120
   *
   * @returns {Object}
   * @sampleResult {"CreditNoteID":"cn-123-456","CreditNoteNumber":"CN-001","Status":"AUTHORISED","RemainingCredit":50.00}
   */
  onCreditNoteUpdated(callType, payload) {
    if (callType === MethodCallTypes.SHAPE_EVENT) {
      return [{ name: 'onCreditNoteUpdated', data: payload }]
    }

    if (callType === MethodCallTypes.FILTER_TRIGGER) {
      return { ids: payload.triggers.map(t => t.id) }
    }
  }

  // ========================================== TRIGGER SYSTEM METHODS ===========================================

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerUpsertWebhook(invocation) {
    logger.debug(`handleTriggerUpsertWebhook.invocation: ${ JSON.stringify(invocation) }`)

    // Xero webhooks require setup in the Xero Developer Portal
    // This returns an eventScopeId to identify the connection
    return {
      eventScopeId: invocation.connectionId,
      webhookData: {
        connectionId: invocation.connectionId,
        events: invocation.events.map(e => WebhookEventTypes[e.name]),
      },
    }
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerResolveEvents(invocation) {
    logger.debug(`handleTriggerResolveEvents.invocation: ${ JSON.stringify(invocation) }`)

    const eventType = invocation.body?.eventType || invocation.body?.Events?.[0]?.EventType
    const methodName = MethodTypes[eventType]

    if (!methodName) {
      logger.warn(`Unknown event type: ${ eventType }`)

      return null
    }

    const eventData = invocation.body?.resource || invocation.body?.Events?.[0]?.EventData

    const events = await this[methodName](MethodCallTypes.SHAPE_EVENT, eventData)

    return {
      connectionId: invocation.queryParams?.connectionId || invocation.webhookData?.connectionId,
      events,
    }
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerSelectMatched(invocation) {
    logger.debug(`handleTriggerSelectMatched.invocation: ${ JSON.stringify(invocation) }`)

    const data = await this[invocation.eventName](MethodCallTypes.FILTER_TRIGGER, invocation)

    return data
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation"}
   */
  async handleTriggerDeleteWebhook(invocation) {
    logger.debug(`handleTriggerDeleteWebhook.invocation: ${ JSON.stringify(invocation) }`)
    // Xero webhook cleanup would happen here if we created webhooks programmatically
  }

  // ======================================= END OF TRIGGERS =======================================

  // ========================================== POLLING TRIGGERS ===========================================

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerPollingForEvent(invocation) {
    return this[invocation.eventName](invocation)
  }

  /**
   * @operationName On New Payment Received
   * @category Event Tracking
   * @description Triggers when a new payment is received. Polling interval can be customized (minimum 30 seconds).
   * @registerAs POLLING_TRIGGER
   *
   * @route POST /on-new-payment
   * @appearanceColor #13B5EA #25C0F0
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"tenantId","dictionary":"getTenantsDictionary","description":"Select the Xero organization. Required if multiple organizations are connected."}
   *
   * @returns {Object}
   * @sampleResult {"PaymentID":"pay-123","Amount":500.00,"Date":"2025-01-15","Invoice":{"InvoiceNumber":"INV-001"}}
   */
  async onNewPayment(invocation) {
    const { tenantId } = invocation.triggerData || {}

    const response = await this.#apiRequest({
      logTag: 'onNewPayment',
      url: `${ API_BASE_URL }/Payments`,
      query: {
        order: 'Date DESC',
        page: 1,
      },
      tenantId,
    })

    const payments = response.Payments || []

    if (!invocation.state?.lastSeenIds) {
      return {
        events: [],
        state: { lastSeenIds: payments.slice(0, 50).map(p => p.PaymentID) },
      }
    }

    const previousIds = new Set(invocation.state.lastSeenIds)
    const newPayments = payments.filter(p => !previousIds.has(p.PaymentID))

    return {
      events: newPayments.map(p => ({ name: 'onNewPayment', data: p })),
      state: { lastSeenIds: payments.slice(0, 50).map(p => p.PaymentID) },
    }
  }

  /**
   * @operationName On New Bank Transaction
   * @category Event Tracking
   * @description Triggers when a new bank transaction is created. Polling interval can be customized (minimum 30 seconds).
   * @registerAs POLLING_TRIGGER
   *
   * @route POST /on-new-bank-transaction
   * @appearanceColor #13B5EA #25C0F0
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Organization","name":"tenantId","dictionary":"getTenantsDictionary","description":"Select the Xero organization. Required if multiple organizations are connected."}
   * @paramDef {"type":"String","label":"Type","name":"type","uiComponent":{"type":"DROPDOWN","options":{"values":["RECEIVE","SPEND"]}},"description":"Filter by transaction type."}
   *
   * @returns {Object}
   * @sampleResult {"BankTransactionID":"bt-123","Type":"RECEIVE","Total":500.00,"Contact":{"Name":"Client Inc"}}
   */
  async onNewBankTransaction(invocation) {
    const { tenantId, type } = invocation.triggerData || {}

    const whereFilters = []

    if (type) {
      whereFilters.push(`Type=="${ type }"`)
    }

    const response = await this.#apiRequest({
      logTag: 'onNewBankTransaction',
      url: `${ API_BASE_URL }/BankTransactions`,
      query: {
        order: 'Date DESC',
        page: 1,
        where: whereFilters.length > 0 ? whereFilters.join(' AND ') : undefined,
      },
      tenantId,
    })

    const transactions = response.BankTransactions || []

    if (!invocation.state?.lastSeenIds) {
      return {
        events: [],
        state: { lastSeenIds: transactions.slice(0, 50).map(t => t.BankTransactionID) },
      }
    }

    const previousIds = new Set(invocation.state.lastSeenIds)
    const newTransactions = transactions.filter(t => !previousIds.has(t.BankTransactionID))

    return {
      events: newTransactions.map(t => ({ name: 'onNewBankTransaction', data: t })),
      state: { lastSeenIds: transactions.slice(0, 50).map(t => t.BankTransactionID) },
    }
  }

  // ======================================= END OF POLLING TRIGGERS =======================================
}

Flowrunner.ServerCode.addService(XeroService, [
  {
    order: 0,
    displayName: 'Client ID',
    defaultValue: '',
    name: 'clientId',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'OAuth 2.0 Client ID from the Xero Developer Portal (https://developer.xero.com/app/manage).',
  },
  {
    order: 1,
    displayName: 'Client Secret',
    defaultValue: '',
    name: 'clientSecret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'OAuth 2.0 Client Secret from the Xero Developer Portal.',
  },
])

// ========================================== UTILITY FUNCTIONS ===========================================

function cleanupObject(data) {
  if (!data) return data

  const result = {}

  Object.keys(data).forEach(key => {
    if (data[key] !== undefined && data[key] !== null && data[key] !== '') {
      result[key] = data[key]
    }
  })

  return Object.keys(result).length > 0 ? result : undefined
}

function searchFilter(list, props, searchString) {
  if (!searchString) return list

  return list.filter(item =>
    props.some(prop => {
      const value = prop.split('.').reduce((acc, key) => acc?.[key], item)

      return value && String(value).toLowerCase().includes(searchString.toLowerCase())
    })
  )
}

function formatCurrency(amount, currencyCode) {
  if (amount === undefined || amount === null) return 'N/A'

  return `${ currencyCode || '' }${ Number(amount).toFixed(2) }`.trim()
}

function formatDateForXero(dateString) {
  if (!dateString) return null

  const date = new Date(dateString)
  const year = date.getFullYear()
  const month = date.getMonth() + 1
  const day = date.getDate()

  return `${ year },${ month },${ day }`
}
