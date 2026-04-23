'use strict'

const API_BASE_URL_TEMPLATE = 'https://{accountId}.suitetalk.api.netsuite.com/services/rest'
const AUTH_URL_TEMPLATE = 'https://{accountId}.app.netsuite.com/app/login/oauth2/authorize.nl'
const TOKEN_URL_TEMPLATE = 'https://{accountId}.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/token'

const DEFAULT_SCOPE_LIST = [
  'rest_webservices',
]

const DEFAULT_SCOPE_STRING = DEFAULT_SCOPE_LIST.join(' ')

const DEFAULT_LIMIT = 100

const logger = {
  info: (...args) => console.log('[NetSuite Service] info:', ...args),
  debug: (...args) => console.log('[NetSuite Service] debug:', ...args),
  error: (...args) => console.log('[NetSuite Service] error:', ...args),
  warn: (...args) => console.log('[NetSuite Service] warn:', ...args),
}

function cleanupObject(data) {
  const result = {}

  Object.keys(data).forEach(key => {
    if (data[key] !== undefined && data[key] !== null && data[key] !== '') {
      result[key] = data[key]
    }
  })

  return Object.keys(result).length > 0 ? result : undefined
}

function escapeSuiteQLValue(value) {
  if (typeof value !== 'string') return value

  return value.replace(/'/g, "''")
}

/**
 * @requireOAuth
 * @integrationName NetSuite
 * @integrationIcon /icon.svg
 */
class NetSuiteService {
  constructor(config) {
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
    this.accountId = config.accountId
    this.scopes = DEFAULT_SCOPE_STRING
    this.apiBaseUrl = API_BASE_URL_TEMPLATE.replace('{accountId}', this.accountId)
    this.authUrl = AUTH_URL_TEMPLATE.replace('{accountId}', this.accountId)
    this.tokenUrl = TOKEN_URL_TEMPLATE.replace('{accountId}', this.accountId)
  }

  // ==================== Private Helpers ====================

  #getAccessToken() {
    const token = this.request.headers['oauth-access-token']

    if (!token) {
      throw new Error('Access token is not available. Please reconnect your NetSuite account.')
    }

    return token
  }

  #getAccessTokenHeader() {
    return { Authorization: `Bearer ${ this.#getAccessToken() }` }
  }

  #getSecretTokenHeader() {
    const credentials = Buffer.from(`${ this.clientId }:${ this.clientSecret }`).toString('base64')

    return { Authorization: `Basic ${ credentials }` }
  }

  #getRecordUrl(recordType, id) {
    return `${ this.apiBaseUrl }/record/v1/${ recordType }${ id ? '/' + id : '' }`
  }

  async #apiRequest({ url, method, body, query, headers, logTag }) {
    method = method || 'get'
    query = cleanupObject(query || {})

    logger.debug(`${ logTag } - api request: [${ method }::${ url }] q=[${ JSON.stringify(query) }]`)

    try {
      const request = Flowrunner.Request[method](url)
        .set(this.#getAccessTokenHeader())
        .set({ Accept: 'application/json' })

      if (headers) {
        request.set(headers)
      }

      if (query) {
        request.query(query)
      }

      if (body) {
        request.set({ 'Content-Type': 'application/json' })

        return await request.send(body)
      }

      return await request
    } catch (error) {
      const errorBody = error?.body
      const errorDetails = errorBody?.['o:errorDetails']

      if (Array.isArray(errorDetails) && errorDetails.length > 0) {
        const detailMessage = errorDetails.map(e => `${ e.detail || '' }${ e['o:errorCode'] ? ` (${ e['o:errorCode'] })` : '' }`).join('; ')

        logger.error(`${ logTag } - NetSuite error: ${ detailMessage }`)
        throw new Error(detailMessage)
      }

      if (errorBody?.title) {
        logger.error(`${ logTag } - NetSuite error: ${ errorBody.title }`)
        throw new Error(errorBody.title)
      }

      logger.error(`${ logTag } - api error:`, typeof error === 'object' ? JSON.stringify(error) : error)
      throw error
    }
  }

  async #suiteQLQuery(query, limit, offset, logTag) {
    return await this.#apiRequest({
      url: `${ this.apiBaseUrl }/query/v1/suiteql`,
      method: 'post',
      body: { q: query },
      query: { limit: limit || DEFAULT_LIMIT, offset: offset || 0 },
      headers: { Prefer: 'transient' },
      logTag: logTag || 'suiteQLQuery',
    })
  }

  // ==================== OAuth2 System Methods ====================

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

    return `${ this.authUrl }?${ params.toString() }`
  }

  /**
   * @registerAs SYSTEM
   * @route POST /executeCallback
   * @param {Object} callbackObject
   * @returns {Object}
   */
  async executeCallback(callbackObject) {
    const code = callbackObject.code

    const params = new URLSearchParams()

    params.append('grant_type', 'authorization_code')
    params.append('code', code)
    params.append('redirect_uri', callbackObject.redirectURI)

    const tokenResponse = await Flowrunner.Request.post(this.tokenUrl)
      .set(this.#getSecretTokenHeader())
      .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
      .send(params.toString())

    let connectionIdentityName = 'NetSuite Account'

    try {
      const companyInfo = await Flowrunner.Request.get(`${ this.apiBaseUrl }/record/v1/companyInformation`)
        .set({ Authorization: `Bearer ${ tokenResponse.access_token }` })
        .set({ Accept: 'application/json' })

      if (companyInfo.companyName) {
        connectionIdentityName = companyInfo.companyName
      } else if (companyInfo.legalName) {
        connectionIdentityName = companyInfo.legalName
      }
    } catch (e) {
      logger.warn('executeCallback - could not fetch company info:', e.message)
    }

    return {
      token: tokenResponse.access_token,
      expirationInSeconds: tokenResponse.expires_in,
      refreshToken: tokenResponse.refresh_token,
      connectionIdentityName,
      connectionIdentityImageURL: null,
      overwrite: true,
    }
  }

  /**
   * @registerAs SYSTEM
   * @route PUT /refreshToken
   * @param {String} refreshToken
   * @returns {Object}
   */
  async refreshToken(refreshToken) {
    const params = new URLSearchParams()

    params.append('grant_type', 'refresh_token')
    params.append('refresh_token', refreshToken)

    const response = await Flowrunner.Request.post(this.tokenUrl)
      .set(this.#getSecretTokenHeader())
      .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
      .send(params.toString())

    return {
      token: response.access_token,
      expirationInSeconds: response.expires_in,
      refreshToken: response.refresh_token || refreshToken,
    }
  }

  // ==================== Customers ====================

  /**
   * @operationName Create Customer
   * @category Customers
   * @description Creates a new customer record in NetSuite. Customers represent the people or companies you sell products and services to. You can optionally assign a subsidiary and currency.
   *
   * @route POST /create-customer
   * @appearanceColor #0E6CB7 #2E8BC7
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Company Name","name":"companyName","description":"Name of the customer's company. Either company name or first/last name is required."}
   * @paramDef {"type":"String","label":"First Name","name":"firstName","description":"First name of the customer contact."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","description":"Last name of the customer contact."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Primary email address for the customer."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"Primary phone number for the customer."}
   * @paramDef {"type":"String","label":"Subsidiary","name":"subsidiaryId","dictionary":"getSubsidiariesDictionary","description":"The subsidiary this customer belongs to. Required for OneWorld accounts."}
   * @paramDef {"type":"String","label":"Currency","name":"currencyId","dictionary":"getCurrenciesDictionary","description":"The primary currency for this customer."}
   * @paramDef {"type":"String","label":"Comments","name":"comments","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Free-form comments or notes about the customer."}
   *
   * @returns {Object}
   * @sampleResult {"id":"123","companyName":"Acme Corporation","firstName":"John","lastName":"Smith","email":"john@acme.com","phone":"555-1234","subsidiary":{"id":"1","refName":"US Subsidiary"},"dateCreated":"2026-01-15T10:30:00Z"}
   */
  async createCustomer(companyName, firstName, lastName, email, phone, subsidiaryId, currencyId, comments) {
    const body = cleanupObject({
      companyName,
      firstName,
      lastName,
      email,
      phone,
      subsidiary: subsidiaryId ? { id: subsidiaryId } : undefined,
      currency: currencyId ? { id: currencyId } : undefined,
      comments,
    })

    return await this.#apiRequest({
      url: this.#getRecordUrl('customer'),
      method: 'post',
      body,
      logTag: 'createCustomer',
    })
  }

  /**
   * @operationName Get Customer
   * @category Customers
   * @description Retrieves a single customer record by ID from NetSuite. Returns the full customer details including contact information, subsidiary, currency, and metadata.
   *
   * @route POST /get-customer
   * @appearanceColor #0E6CB7 #2E8BC7
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Customer","name":"customerId","required":true,"dictionary":"getCustomersDictionary","description":"The customer to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":"123","companyName":"Acme Corporation","firstName":"John","lastName":"Smith","email":"john@acme.com","phone":"555-1234","subsidiary":{"id":"1","refName":"US Subsidiary"},"currency":{"id":"1","refName":"USD"},"dateCreated":"2026-01-15T10:30:00Z","lastModifiedDate":"2026-01-20T14:00:00Z"}
   */
  async getCustomer(customerId) {
    if (!customerId) {
      throw new Error('"Customer" is required.')
    }

    return await this.#apiRequest({
      url: this.#getRecordUrl('customer', customerId),
      logTag: 'getCustomer',
    })
  }

  /**
   * @operationName Update Customer
   * @category Customers
   * @description Updates an existing customer record in NetSuite. Only the fields you provide will be changed; all other fields remain unchanged. Uses PATCH for partial updates.
   *
   * @route PATCH /update-customer
   * @appearanceColor #0E6CB7 #2E8BC7
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Customer","name":"customerId","required":true,"dictionary":"getCustomersDictionary","description":"The customer to update."}
   * @paramDef {"type":"String","label":"Company Name","name":"companyName","description":"Updated company name."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Updated email address."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"Updated phone number."}
   * @paramDef {"type":"String","label":"Comments","name":"comments","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Updated comments or notes about the customer."}
   *
   * @returns {Object}
   * @sampleResult {"id":"123","companyName":"Acme Corp Updated","email":"newemail@acme.com","phone":"555-5678","lastModifiedDate":"2026-01-25T09:15:00Z"}
   */
  async updateCustomer(customerId, companyName, email, phone, comments) {
    if (!customerId) {
      throw new Error('"Customer" is required.')
    }

    const body = cleanupObject({
      companyName,
      email,
      phone,
      comments,
    })

    return await this.#apiRequest({
      url: this.#getRecordUrl('customer', customerId),
      method: 'patch',
      body,
      logTag: 'updateCustomer',
    })
  }

  /**
   * @operationName Delete Customer
   * @category Customers
   * @description Deletes a customer record from NetSuite. This action cannot be undone. The customer must not have any associated transactions.
   *
   * @route DELETE /delete-customer
   * @appearanceColor #0E6CB7 #2E8BC7
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Customer","name":"customerId","required":true,"dictionary":"getCustomersDictionary","description":"The customer to delete."}
   *
   * @returns {Object}
   * @sampleResult {"status":"deleted","id":"123"}
   */
  async deleteCustomer(customerId) {
    if (!customerId) {
      throw new Error('"Customer" is required.')
    }

    return await this.#apiRequest({
      url: this.#getRecordUrl('customer', customerId),
      method: 'delete',
      logTag: 'deleteCustomer',
    })
  }

  /**
   * @operationName List Customers
   * @category Customers
   * @description Queries customers in NetSuite using SuiteQL. Supports optional search filtering by company name or entity ID. Results are paginated using limit and offset.
   *
   * @route POST /list-customers
   * @appearanceColor #0E6CB7 #2E8BC7
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search text to filter customers by company name or entity ID."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of customers to return. Defaults to 100."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of records to skip for pagination. Defaults to 0."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"123","entityid":"CUST-001","companyname":"Acme Corporation","email":"info@acme.com","phone":"555-1234"}],"hasMore":false,"totalResults":1}
   */
  async listCustomers(search, limit, offset) {
    let query = 'SELECT id, entityid, companyname, email, phone FROM customer'

    if (search) {
      query += ` WHERE companyname LIKE '%${ escapeSuiteQLValue(search) }%' OR entityid LIKE '%${ escapeSuiteQLValue(search) }%'`
    }

    query += ' ORDER BY companyname ASC'

    return await this.#suiteQLQuery(query, limit, offset, 'listCustomers')
  }

  // ==================== Vendors ====================

  /**
   * @operationName Create Vendor
   * @category Vendors
   * @description Creates a new vendor record in NetSuite. Vendors represent the people or companies you purchase products and services from. You can optionally assign a subsidiary and currency.
   *
   * @route POST /create-vendor
   * @appearanceColor #0E6CB7 #2E8BC7
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Company Name","name":"companyName","description":"Name of the vendor's company. Either company name or first/last name is required."}
   * @paramDef {"type":"String","label":"First Name","name":"firstName","description":"First name of the vendor contact."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","description":"Last name of the vendor contact."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Primary email address for the vendor."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"Primary phone number for the vendor."}
   * @paramDef {"type":"String","label":"Subsidiary","name":"subsidiaryId","dictionary":"getSubsidiariesDictionary","description":"The subsidiary this vendor belongs to. Required for OneWorld accounts."}
   * @paramDef {"type":"String","label":"Currency","name":"currencyId","dictionary":"getCurrenciesDictionary","description":"The primary currency for this vendor."}
   * @paramDef {"type":"String","label":"Comments","name":"comments","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Free-form comments or notes about the vendor."}
   *
   * @returns {Object}
   * @sampleResult {"id":"201","companyName":"Office Supplies Co","firstName":"Jane","lastName":"Doe","email":"jane@officesupplies.com","phone":"555-9876","subsidiary":{"id":"1","refName":"US Subsidiary"},"dateCreated":"2026-01-10T08:00:00Z"}
   */
  async createVendor(companyName, firstName, lastName, email, phone, subsidiaryId, currencyId, comments) {
    const body = cleanupObject({
      companyName,
      firstName,
      lastName,
      email,
      phone,
      subsidiary: subsidiaryId ? { id: subsidiaryId } : undefined,
      currency: currencyId ? { id: currencyId } : undefined,
      comments,
    })

    return await this.#apiRequest({
      url: this.#getRecordUrl('vendor'),
      method: 'post',
      body,
      logTag: 'createVendor',
    })
  }

  /**
   * @operationName Get Vendor
   * @category Vendors
   * @description Retrieves a single vendor record by ID from NetSuite. Returns the full vendor details including contact information, subsidiary, currency, and metadata.
   *
   * @route POST /get-vendor
   * @appearanceColor #0E6CB7 #2E8BC7
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Vendor","name":"vendorId","required":true,"dictionary":"getVendorsDictionary","description":"The vendor to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":"201","companyName":"Office Supplies Co","firstName":"Jane","lastName":"Doe","email":"jane@officesupplies.com","phone":"555-9876","subsidiary":{"id":"1","refName":"US Subsidiary"},"currency":{"id":"1","refName":"USD"},"dateCreated":"2026-01-10T08:00:00Z","lastModifiedDate":"2026-01-18T11:30:00Z"}
   */
  async getVendor(vendorId) {
    if (!vendorId) {
      throw new Error('"Vendor" is required.')
    }

    return await this.#apiRequest({
      url: this.#getRecordUrl('vendor', vendorId),
      logTag: 'getVendor',
    })
  }

  /**
   * @operationName Update Vendor
   * @category Vendors
   * @description Updates an existing vendor record in NetSuite. Only the fields you provide will be changed; all other fields remain unchanged. Uses PATCH for partial updates.
   *
   * @route PATCH /update-vendor
   * @appearanceColor #0E6CB7 #2E8BC7
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Vendor","name":"vendorId","required":true,"dictionary":"getVendorsDictionary","description":"The vendor to update."}
   * @paramDef {"type":"String","label":"Company Name","name":"companyName","description":"Updated company name."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Updated email address."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"Updated phone number."}
   * @paramDef {"type":"String","label":"Comments","name":"comments","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Updated comments or notes about the vendor."}
   *
   * @returns {Object}
   * @sampleResult {"id":"201","companyName":"Office Supplies Co Updated","email":"newemail@officesupplies.com","phone":"555-4321","lastModifiedDate":"2026-01-25T09:15:00Z"}
   */
  async updateVendor(vendorId, companyName, email, phone, comments) {
    if (!vendorId) {
      throw new Error('"Vendor" is required.')
    }

    const body = cleanupObject({
      companyName,
      email,
      phone,
      comments,
    })

    return await this.#apiRequest({
      url: this.#getRecordUrl('vendor', vendorId),
      method: 'patch',
      body,
      logTag: 'updateVendor',
    })
  }

  /**
   * @operationName Delete Vendor
   * @category Vendors
   * @description Deletes a vendor record from NetSuite. This action cannot be undone. The vendor must not have any associated transactions.
   *
   * @route DELETE /delete-vendor
   * @appearanceColor #0E6CB7 #2E8BC7
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Vendor","name":"vendorId","required":true,"dictionary":"getVendorsDictionary","description":"The vendor to delete."}
   *
   * @returns {Object}
   * @sampleResult {"status":"deleted","id":"201"}
   */
  async deleteVendor(vendorId) {
    if (!vendorId) {
      throw new Error('"Vendor" is required.')
    }

    return await this.#apiRequest({
      url: this.#getRecordUrl('vendor', vendorId),
      method: 'delete',
      logTag: 'deleteVendor',
    })
  }

  /**
   * @operationName List Vendors
   * @category Vendors
   * @description Queries vendors in NetSuite using SuiteQL. Supports optional search filtering by company name or entity ID. Results are paginated using limit and offset.
   *
   * @route POST /list-vendors
   * @appearanceColor #0E6CB7 #2E8BC7
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search text to filter vendors by company name or entity ID."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of vendors to return. Defaults to 100."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of records to skip for pagination. Defaults to 0."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"201","entityid":"VEND-001","companyname":"Office Supplies Co","email":"jane@officesupplies.com","phone":"555-9876"}],"hasMore":false,"totalResults":1}
   */
  async listVendors(search, limit, offset) {
    let query = 'SELECT id, entityid, companyname, email, phone FROM vendor'

    if (search) {
      query += ` WHERE companyname LIKE '%${ escapeSuiteQLValue(search) }%' OR entityid LIKE '%${ escapeSuiteQLValue(search) }%'`
    }

    query += ' ORDER BY companyname ASC'

    return await this.#suiteQLQuery(query, limit, offset, 'listVendors')
  }

  // ==================== Invoices ====================

  /**
   * @operationName Create Invoice
   * @category Invoices
   * @description Creates a new invoice in NetSuite for a specified customer. Line items define the products or services being invoiced. Each line item should include an item reference with quantity and amount.
   *
   * @route POST /create-invoice
   * @appearanceColor #0E6CB7 #2E8BC7
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Customer","name":"customerId","required":true,"dictionary":"getCustomersDictionary","description":"The customer to invoice."}
   * @paramDef {"type":"Array.<Object>","label":"Line Items","name":"lineItems","required":true,"description":"Array of line items. Each item should have: item (with id), quantity, and amount or rate."}
   * @paramDef {"type":"String","label":"Transaction Date","name":"tranDate","uiComponent":{"type":"DATE_PICKER"},"description":"Date of the invoice transaction. Defaults to today if not specified."}
   * @paramDef {"type":"String","label":"Due Date","name":"dueDate","uiComponent":{"type":"DATE_PICKER"},"description":"Payment due date for the invoice."}
   * @paramDef {"type":"String","label":"Subsidiary","name":"subsidiaryId","dictionary":"getSubsidiariesDictionary","description":"The subsidiary for this invoice. Required for OneWorld accounts."}
   * @paramDef {"type":"String","label":"Currency","name":"currencyId","dictionary":"getCurrenciesDictionary","description":"The currency for this invoice."}
   * @paramDef {"type":"String","label":"Memo","name":"memo","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Internal memo or note for the invoice."}
   *
   * @returns {Object}
   * @sampleResult {"id":"456","tranId":"INV-001","entity":{"id":"123","refName":"Acme Corporation"},"tranDate":"2026-01-15","dueDate":"2026-02-15","total":500.00,"status":{"id":"open","refName":"Open"},"item":{"items":[{"item":{"id":"10","refName":"Widget"},"quantity":5,"rate":100.00,"amount":500.00}]}}
   */
  async createInvoice(customerId, lineItems, tranDate, dueDate, subsidiaryId, currencyId, memo) {
    if (!customerId) {
      throw new Error('"Customer" is required.')
    }

    if (!lineItems || !Array.isArray(lineItems) || lineItems.length === 0) {
      throw new Error('"Line Items" is required and must be a non-empty array.')
    }

    const body = cleanupObject({
      entity: { id: customerId },
      item: { items: lineItems },
      tranDate,
      dueDate,
      subsidiary: subsidiaryId ? { id: subsidiaryId } : undefined,
      currency: currencyId ? { id: currencyId } : undefined,
      memo,
    })

    return await this.#apiRequest({
      url: this.#getRecordUrl('invoice'),
      method: 'post',
      body,
      logTag: 'createInvoice',
    })
  }

  /**
   * @operationName Get Invoice
   * @category Invoices
   * @description Retrieves a single invoice by ID from NetSuite. Returns the full invoice record including line items, customer reference, amounts, dates, and status.
   *
   * @route POST /get-invoice
   * @appearanceColor #0E6CB7 #2E8BC7
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Invoice","name":"invoiceId","required":true,"dictionary":"getInvoicesDictionary","description":"The invoice to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":"456","tranId":"INV-001","entity":{"id":"123","refName":"Acme Corporation"},"tranDate":"2026-01-15","dueDate":"2026-02-15","total":500.00,"status":{"id":"open","refName":"Open"},"item":{"items":[{"item":{"id":"10","refName":"Widget"},"quantity":5,"rate":100.00,"amount":500.00}]}}
   */
  async getInvoice(invoiceId) {
    if (!invoiceId) {
      throw new Error('"Invoice" is required.')
    }

    return await this.#apiRequest({
      url: this.#getRecordUrl('invoice', invoiceId),
      logTag: 'getInvoice',
    })
  }

  /**
   * @operationName Update Invoice
   * @category Invoices
   * @description Updates an existing invoice in NetSuite. Only the fields you provide will be changed. You can update line items, due date, and memo. Uses PATCH for partial updates.
   *
   * @route PATCH /update-invoice
   * @appearanceColor #0E6CB7 #2E8BC7
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Invoice","name":"invoiceId","required":true,"dictionary":"getInvoicesDictionary","description":"The invoice to update."}
   * @paramDef {"type":"Array.<Object>","label":"Line Items","name":"lineItems","description":"Updated line items array. Replaces all existing line items when provided."}
   * @paramDef {"type":"String","label":"Due Date","name":"dueDate","uiComponent":{"type":"DATE_PICKER"},"description":"Updated payment due date."}
   * @paramDef {"type":"String","label":"Memo","name":"memo","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Updated internal memo."}
   *
   * @returns {Object}
   * @sampleResult {"id":"456","tranId":"INV-001","entity":{"id":"123","refName":"Acme Corporation"},"dueDate":"2026-03-01","total":750.00,"lastModifiedDate":"2026-01-25T09:15:00Z"}
   */
  async updateInvoice(invoiceId, lineItems, dueDate, memo) {
    if (!invoiceId) {
      throw new Error('"Invoice" is required.')
    }

    const body = cleanupObject({
      item: lineItems ? { items: lineItems } : undefined,
      dueDate,
      memo,
    })

    return await this.#apiRequest({
      url: this.#getRecordUrl('invoice', invoiceId),
      method: 'patch',
      body,
      logTag: 'updateInvoice',
    })
  }

  /**
   * @operationName Delete Invoice
   * @category Invoices
   * @description Permanently deletes an invoice from NetSuite. This action cannot be undone. The invoice must not have any payments applied to it.
   *
   * @route DELETE /delete-invoice
   * @appearanceColor #0E6CB7 #2E8BC7
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Invoice","name":"invoiceId","required":true,"dictionary":"getInvoicesDictionary","description":"The invoice to delete."}
   *
   * @returns {Object}
   * @sampleResult {"status":"deleted","id":"456"}
   */
  async deleteInvoice(invoiceId) {
    if (!invoiceId) {
      throw new Error('"Invoice" is required.')
    }

    return await this.#apiRequest({
      url: this.#getRecordUrl('invoice', invoiceId),
      method: 'delete',
      logTag: 'deleteInvoice',
    })
  }

  /**
   * @operationName List Invoices
   * @category Invoices
   * @description Queries invoices in NetSuite using SuiteQL. Supports optional search filtering by transaction ID. Results include transaction date, customer, total, and status. Paginated using limit and offset.
   *
   * @route POST /list-invoices
   * @appearanceColor #0E6CB7 #2E8BC7
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search text to filter invoices by transaction ID."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of invoices to return. Defaults to 100."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of records to skip for pagination. Defaults to 0."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"456","tranid":"INV-001","trandate":"2026-01-15","entity":"123","foreigntotal":500.00,"status":"Open"}],"hasMore":false,"totalResults":1}
   */
  async listInvoices(search, limit, offset) {
    let query = "SELECT id, tranid, trandate, entity, foreigntotal, status FROM transaction WHERE type = 'CustInvc'"

    if (search) {
      query += ` AND tranid LIKE '%${ escapeSuiteQLValue(search) }%'`
    }

    query += ' ORDER BY trandate DESC'

    return await this.#suiteQLQuery(query, limit, offset, 'listInvoices')
  }

  // ==================== Sales Orders ====================

  /**
   * @operationName Create Sales Order
   * @category Sales Orders
   * @description Creates a new sales order in NetSuite for a specified customer. Sales orders represent confirmed orders from customers and can be fulfilled and invoiced later.
   *
   * @route POST /create-sales-order
   * @appearanceColor #0E6CB7 #2E8BC7
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Customer","name":"customerId","required":true,"dictionary":"getCustomersDictionary","description":"The customer placing the sales order."}
   * @paramDef {"type":"Array.<Object>","label":"Line Items","name":"lineItems","required":true,"description":"Array of line items. Each item should have: item (with id), quantity, and rate or amount."}
   * @paramDef {"type":"String","label":"Transaction Date","name":"tranDate","uiComponent":{"type":"DATE_PICKER"},"description":"Date of the sales order. Defaults to today if not specified."}
   * @paramDef {"type":"String","label":"Ship Date","name":"shipDate","uiComponent":{"type":"DATE_PICKER"},"description":"Expected shipping date for the order."}
   * @paramDef {"type":"String","label":"Subsidiary","name":"subsidiaryId","dictionary":"getSubsidiariesDictionary","description":"The subsidiary for this sales order. Required for OneWorld accounts."}
   * @paramDef {"type":"String","label":"Currency","name":"currencyId","dictionary":"getCurrenciesDictionary","description":"The currency for this sales order."}
   * @paramDef {"type":"String","label":"Memo","name":"memo","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Internal memo or note for the sales order."}
   *
   * @returns {Object}
   * @sampleResult {"id":"789","tranId":"SO-001","entity":{"id":"123","refName":"Acme Corporation"},"tranDate":"2026-01-15","shipDate":"2026-01-25","total":1500.00,"status":{"id":"pendingFulfillment","refName":"Pending Fulfillment"},"item":{"items":[{"item":{"id":"10","refName":"Widget"},"quantity":15,"rate":100.00,"amount":1500.00}]}}
   */
  async createSalesOrder(customerId, lineItems, tranDate, shipDate, subsidiaryId, currencyId, memo) {
    if (!customerId) {
      throw new Error('"Customer" is required.')
    }

    if (!lineItems || !Array.isArray(lineItems) || lineItems.length === 0) {
      throw new Error('"Line Items" is required and must be a non-empty array.')
    }

    const body = cleanupObject({
      entity: { id: customerId },
      item: { items: lineItems },
      tranDate,
      shipDate,
      subsidiary: subsidiaryId ? { id: subsidiaryId } : undefined,
      currency: currencyId ? { id: currencyId } : undefined,
      memo,
    })

    return await this.#apiRequest({
      url: this.#getRecordUrl('salesOrder'),
      method: 'post',
      body,
      logTag: 'createSalesOrder',
    })
  }

  /**
   * @operationName Get Sales Order
   * @category Sales Orders
   * @description Retrieves a single sales order by ID from NetSuite. Returns the full sales order record including line items, customer reference, amounts, shipping details, and status.
   *
   * @route POST /get-sales-order
   * @appearanceColor #0E6CB7 #2E8BC7
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Sales Order ID","name":"salesOrderId","required":true,"description":"The ID of the sales order to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":"789","tranId":"SO-001","entity":{"id":"123","refName":"Acme Corporation"},"tranDate":"2026-01-15","shipDate":"2026-01-25","total":1500.00,"status":{"id":"pendingFulfillment","refName":"Pending Fulfillment"},"item":{"items":[{"item":{"id":"10","refName":"Widget"},"quantity":15,"rate":100.00,"amount":1500.00}]}}
   */
  async getSalesOrder(salesOrderId) {
    if (!salesOrderId) {
      throw new Error('"Sales Order ID" is required.')
    }

    return await this.#apiRequest({
      url: this.#getRecordUrl('salesOrder', salesOrderId),
      logTag: 'getSalesOrder',
    })
  }

  /**
   * @operationName Update Sales Order
   * @category Sales Orders
   * @description Updates an existing sales order in NetSuite. Only the fields you provide will be changed. You can update line items, ship date, and memo. Uses PATCH for partial updates.
   *
   * @route PATCH /update-sales-order
   * @appearanceColor #0E6CB7 #2E8BC7
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Sales Order ID","name":"salesOrderId","required":true,"description":"The ID of the sales order to update."}
   * @paramDef {"type":"Array.<Object>","label":"Line Items","name":"lineItems","description":"Updated line items array. Replaces all existing line items when provided."}
   * @paramDef {"type":"String","label":"Ship Date","name":"shipDate","uiComponent":{"type":"DATE_PICKER"},"description":"Updated expected shipping date."}
   * @paramDef {"type":"String","label":"Memo","name":"memo","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Updated internal memo."}
   *
   * @returns {Object}
   * @sampleResult {"id":"789","tranId":"SO-001","entity":{"id":"123","refName":"Acme Corporation"},"shipDate":"2026-02-01","total":2000.00,"lastModifiedDate":"2026-01-25T09:15:00Z"}
   */
  async updateSalesOrder(salesOrderId, lineItems, shipDate, memo) {
    if (!salesOrderId) {
      throw new Error('"Sales Order ID" is required.')
    }

    const body = cleanupObject({
      item: lineItems ? { items: lineItems } : undefined,
      shipDate,
      memo,
    })

    return await this.#apiRequest({
      url: this.#getRecordUrl('salesOrder', salesOrderId),
      method: 'patch',
      body,
      logTag: 'updateSalesOrder',
    })
  }

  /**
   * @operationName Delete Sales Order
   * @category Sales Orders
   * @description Permanently deletes a sales order from NetSuite. This action cannot be undone. The sales order must not have any fulfillments or invoices linked to it.
   *
   * @route DELETE /delete-sales-order
   * @appearanceColor #0E6CB7 #2E8BC7
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Sales Order ID","name":"salesOrderId","required":true,"description":"The ID of the sales order to delete."}
   *
   * @returns {Object}
   * @sampleResult {"status":"deleted","id":"789"}
   */
  async deleteSalesOrder(salesOrderId) {
    if (!salesOrderId) {
      throw new Error('"Sales Order ID" is required.')
    }

    return await this.#apiRequest({
      url: this.#getRecordUrl('salesOrder', salesOrderId),
      method: 'delete',
      logTag: 'deleteSalesOrder',
    })
  }

  /**
   * @operationName List Sales Orders
   * @category Sales Orders
   * @description Queries sales orders in NetSuite using SuiteQL. Supports optional search filtering by transaction ID. Results include transaction date, customer, total, and status. Paginated using limit and offset.
   *
   * @route POST /list-sales-orders
   * @appearanceColor #0E6CB7 #2E8BC7
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search text to filter sales orders by transaction ID."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of sales orders to return. Defaults to 100."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of records to skip for pagination. Defaults to 0."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"789","tranid":"SO-001","trandate":"2026-01-15","entity":"123","foreigntotal":1500.00,"status":"Pending Fulfillment"}],"hasMore":false,"totalResults":1}
   */
  async listSalesOrders(search, limit, offset) {
    let query = "SELECT id, tranid, trandate, entity, foreigntotal, status FROM transaction WHERE type = 'SalesOrd'"

    if (search) {
      query += ` AND tranid LIKE '%${ escapeSuiteQLValue(search) }%'`
    }

    query += ' ORDER BY trandate DESC'

    return await this.#suiteQLQuery(query, limit, offset, 'listSalesOrders')
  }

  // ==================== Items ====================

  /**
   * @operationName Get Item
   * @category Items
   * @description Retrieves a single item by ID from NetSuite. Attempts to fetch the item as an inventory item first. Returns the full item record including pricing, type, and metadata.
   *
   * @route POST /get-item
   * @appearanceColor #0E6CB7 #2E8BC7
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Item","name":"itemId","required":true,"dictionary":"getItemsDictionary","description":"The item to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":"10","itemId":"WIDGET-001","displayName":"Standard Widget","basePrice":25.00,"itemType":"InvtPart","description":"A standard widget for general use","isInactive":false,"dateCreated":"2026-01-05T12:00:00Z"}
   */
  async getItem(itemId) {
    if (!itemId) {
      throw new Error('"Item" is required.')
    }

    try {
      return await this.#apiRequest({
        url: this.#getRecordUrl('inventoryItem', itemId),
        logTag: 'getItem:inventoryItem',
      })
    } catch (e) {
      logger.debug(`getItem - item ${ itemId } is not an inventory item, trying non-inventory item`)

      try {
        return await this.#apiRequest({
          url: this.#getRecordUrl('nonInventoryItem', itemId),
          logTag: 'getItem:nonInventoryItem',
        })
      } catch (e2) {
        logger.debug(`getItem - item ${ itemId } is not a non-inventory item, trying service item`)

        return await this.#apiRequest({
          url: this.#getRecordUrl('serviceItem', itemId),
          logTag: 'getItem:serviceItem',
        })
      }
    }
  }

  /**
   * @operationName List Items
   * @category Items
   * @description Queries items in NetSuite using SuiteQL. Returns all item types including inventory, non-inventory, and service items. Supports optional search filtering by item ID or display name. Paginated using limit and offset.
   *
   * @route POST /list-items
   * @appearanceColor #0E6CB7 #2E8BC7
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search text to filter items by item ID or display name."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of items to return. Defaults to 100."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of records to skip for pagination. Defaults to 0."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"10","itemid":"WIDGET-001","displayname":"Standard Widget","baseprice":25.00,"itemtype":"InvtPart"}],"hasMore":false,"totalResults":1}
   */
  async listItems(search, limit, offset) {
    let query = 'SELECT id, itemid, displayname, baseprice, itemtype FROM item'

    if (search) {
      query += ` WHERE itemid LIKE '%${ escapeSuiteQLValue(search) }%' OR displayname LIKE '%${ escapeSuiteQLValue(search) }%'`
    }

    query += ' ORDER BY itemid ASC'

    return await this.#suiteQLQuery(query, limit, offset, 'listItems')
  }

  // ==================== Payments ====================

  /**
   * @operationName Create Payment
   * @category Payments
   * @description Creates a new customer payment in NetSuite to record a payment received from a customer. The payment amount and customer are required.
   *
   * @route POST /create-payment
   * @appearanceColor #0E6CB7 #2E8BC7
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Customer","name":"customerId","required":true,"dictionary":"getCustomersDictionary","description":"The customer making the payment."}
   * @paramDef {"type":"Number","label":"Payment Amount","name":"payment","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The payment amount received from the customer."}
   * @paramDef {"type":"String","label":"Transaction Date","name":"tranDate","uiComponent":{"type":"DATE_PICKER"},"description":"Date the payment was received. Defaults to today if not specified."}
   * @paramDef {"type":"String","label":"Subsidiary","name":"subsidiaryId","dictionary":"getSubsidiariesDictionary","description":"The subsidiary for this payment. Required for OneWorld accounts."}
   * @paramDef {"type":"String","label":"Currency","name":"currencyId","dictionary":"getCurrenciesDictionary","description":"The currency for this payment."}
   * @paramDef {"type":"String","label":"Memo","name":"memo","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Internal memo or note for the payment."}
   *
   * @returns {Object}
   * @sampleResult {"id":"901","tranId":"PYMT-001","customer":{"id":"123","refName":"Acme Corporation"},"payment":500.00,"tranDate":"2026-01-20","status":{"id":"deposited","refName":"Deposited"}}
   */
  async createPayment(customerId, payment, tranDate, subsidiaryId, currencyId, memo) {
    if (!customerId) {
      throw new Error('"Customer" is required.')
    }

    if (payment === undefined || payment === null) {
      throw new Error('"Payment Amount" is required.')
    }

    const body = cleanupObject({
      customer: { id: customerId },
      payment,
      tranDate,
      subsidiary: subsidiaryId ? { id: subsidiaryId } : undefined,
      currency: currencyId ? { id: currencyId } : undefined,
      memo,
    })

    return await this.#apiRequest({
      url: this.#getRecordUrl('customerPayment'),
      method: 'post',
      body,
      logTag: 'createPayment',
    })
  }

  /**
   * @operationName Get Payment
   * @category Payments
   * @description Retrieves a single customer payment by ID from NetSuite. Returns the full payment record including customer reference, amount, date, and status.
   *
   * @route POST /get-payment
   * @appearanceColor #0E6CB7 #2E8BC7
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Payment ID","name":"paymentId","required":true,"description":"The ID of the payment to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":"901","tranId":"PYMT-001","customer":{"id":"123","refName":"Acme Corporation"},"payment":500.00,"tranDate":"2026-01-20","status":{"id":"deposited","refName":"Deposited"},"dateCreated":"2026-01-20T14:30:00Z"}
   */
  async getPayment(paymentId) {
    if (!paymentId) {
      throw new Error('"Payment ID" is required.')
    }

    return await this.#apiRequest({
      url: this.#getRecordUrl('customerPayment', paymentId),
      logTag: 'getPayment',
    })
  }

  /**
   * @operationName Delete Payment
   * @category Payments
   * @description Permanently deletes a customer payment from NetSuite. This action cannot be undone and will reverse any invoice applications associated with this payment.
   *
   * @route DELETE /delete-payment
   * @appearanceColor #0E6CB7 #2E8BC7
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Payment ID","name":"paymentId","required":true,"description":"The ID of the payment to delete."}
   *
   * @returns {Object}
   * @sampleResult {"status":"deleted","id":"901"}
   */
  async deletePayment(paymentId) {
    if (!paymentId) {
      throw new Error('"Payment ID" is required.')
    }

    return await this.#apiRequest({
      url: this.#getRecordUrl('customerPayment', paymentId),
      method: 'delete',
      logTag: 'deletePayment',
    })
  }

  /**
   * @operationName List Payments
   * @category Payments
   * @description Queries customer payments in NetSuite using SuiteQL. Supports optional filtering by customer. Results include transaction date, customer, total, and status. Paginated using limit and offset.
   *
   * @route POST /list-payments
   * @appearanceColor #0E6CB7 #2E8BC7
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Customer","name":"customerId","dictionary":"getCustomersDictionary","description":"Optional filter to show only payments from a specific customer."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of payments to return. Defaults to 100."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of records to skip for pagination. Defaults to 0."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"901","tranid":"PYMT-001","trandate":"2026-01-20","entity":"123","foreigntotal":500.00}],"hasMore":false,"totalResults":1}
   */
  async listPayments(customerId, limit, offset) {
    let query = "SELECT id, tranid, trandate, entity, foreigntotal FROM transaction WHERE type = 'CustPymt'"

    if (customerId) {
      query += ` AND entity = '${ escapeSuiteQLValue(customerId) }'`
    }

    query += ' ORDER BY trandate DESC'

    return await this.#suiteQLQuery(query, limit, offset, 'listPayments')
  }

  // ==================== Utilities ====================

  /**
   * @operationName Run SuiteQL Query
   * @category Utilities
   * @description Executes a custom SuiteQL query against the NetSuite database. SuiteQL is a SQL-like query language for querying NetSuite records. Use this for advanced queries not covered by other methods.
   *
   * @route POST /run-suiteql
   * @appearanceColor #0E6CB7 #2E8BC7
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Query","name":"query","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The SuiteQL query to execute. Example: SELECT id, entityid FROM customer WHERE companyname LIKE '%Acme%'"}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of results to return. Defaults to 100."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of records to skip for pagination. Defaults to 0."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"123","entityid":"CUST-001","companyname":"Acme Corporation"}],"hasMore":false,"totalResults":1}
   */
  async runSuiteQL(query, limit, offset) {
    if (!query) {
      throw new Error('"Query" is required.')
    }

    return await this.#suiteQLQuery(query, limit, offset, 'runSuiteQL')
  }

  // ==================== Dictionary Methods ====================

  /**
   * @registerAs DICTIONARY
   * @operationName Get Customers Dictionary
   * @description Provides a searchable list of customers for dynamic parameter selection in FlowRunner. Filters by company name or entity ID.
   * @route POST /get-customers-dictionary
   * @paramDef {"type":"getCustomersDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering customers."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Acme Corporation","value":"123","note":"info@acme.com"}],"cursor":null}
   */
  async getCustomersDictionary(payload) {
    const { search, cursor } = payload || {}

    const currentOffset = cursor ? parseInt(cursor) : 0

    let query = 'SELECT id, entityid, companyname, email FROM customer'

    if (search) {
      query += ` WHERE (companyname LIKE '%${ escapeSuiteQLValue(search) }%' OR entityid LIKE '%${ escapeSuiteQLValue(search) }%')`
    }

    query += ' ORDER BY companyname ASC'

    const response = await this.#suiteQLQuery(query, DEFAULT_LIMIT, currentOffset, 'getCustomersDictionary')

    const items = response.items || []

    return {
      cursor: response.hasMore ? String(currentOffset + DEFAULT_LIMIT) : null,
      items: items.map(customer => ({
        label: customer.companyname || customer.entityid || `Customer ${ customer.id }`,
        value: String(customer.id),
        note: customer.email || `ID: ${ customer.id }`,
      })),
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Vendors Dictionary
   * @description Provides a searchable list of vendors for dynamic parameter selection in FlowRunner. Filters by company name or entity ID.
   * @route POST /get-vendors-dictionary
   * @paramDef {"type":"getVendorsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering vendors."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Office Supplies Co","value":"201","note":"jane@officesupplies.com"}],"cursor":null}
   */
  async getVendorsDictionary(payload) {
    const { search, cursor } = payload || {}

    const currentOffset = cursor ? parseInt(cursor) : 0

    let query = 'SELECT id, entityid, companyname, email FROM vendor'

    if (search) {
      query += ` WHERE (companyname LIKE '%${ escapeSuiteQLValue(search) }%' OR entityid LIKE '%${ escapeSuiteQLValue(search) }%')`
    }

    query += ' ORDER BY companyname ASC'

    const response = await this.#suiteQLQuery(query, DEFAULT_LIMIT, currentOffset, 'getVendorsDictionary')

    const items = response.items || []

    return {
      cursor: response.hasMore ? String(currentOffset + DEFAULT_LIMIT) : null,
      items: items.map(vendor => ({
        label: vendor.companyname || vendor.entityid || `Vendor ${ vendor.id }`,
        value: String(vendor.id),
        note: vendor.email || `ID: ${ vendor.id }`,
      })),
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Items Dictionary
   * @description Provides a searchable list of items (products and services) for dynamic parameter selection in FlowRunner. Filters by item ID or display name.
   * @route POST /get-items-dictionary
   * @paramDef {"type":"getItemsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering items."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Standard Widget","value":"10","note":"InvtPart - $25.00"}],"cursor":null}
   */
  async getItemsDictionary(payload) {
    const { search, cursor } = payload || {}

    const currentOffset = cursor ? parseInt(cursor) : 0

    let query = 'SELECT id, itemid, displayname, baseprice, itemtype FROM item'

    if (search) {
      query += ` WHERE (displayname LIKE '%${ escapeSuiteQLValue(search) }%' OR itemid LIKE '%${ escapeSuiteQLValue(search) }%')`
    }

    query += ' ORDER BY itemid ASC'

    const response = await this.#suiteQLQuery(query, DEFAULT_LIMIT, currentOffset, 'getItemsDictionary')

    const items = response.items || []

    return {
      cursor: response.hasMore ? String(currentOffset + DEFAULT_LIMIT) : null,
      items: items.map(item => ({
        label: item.displayname || item.itemid || `Item ${ item.id }`,
        value: String(item.id),
        note: `${ item.itemtype || 'Item' }${ item.baseprice ? ` - $${ Number(item.baseprice).toFixed(2) }` : '' }`,
      })),
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Invoices Dictionary
   * @description Provides a searchable list of invoices for dynamic parameter selection in FlowRunner. Filters by transaction ID.
   * @route POST /get-invoices-dictionary
   * @paramDef {"type":"getInvoicesDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering invoices."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"INV-001","value":"456","note":"$500.00 - Open"}],"cursor":null}
   */
  async getInvoicesDictionary(payload) {
    const { search, cursor } = payload || {}

    const currentOffset = cursor ? parseInt(cursor) : 0

    let query = "SELECT id, tranid, foreigntotal, status FROM transaction WHERE type = 'CustInvc'"

    if (search) {
      query += ` AND tranid LIKE '%${ escapeSuiteQLValue(search) }%'`
    }

    query += ' ORDER BY trandate DESC'

    const response = await this.#suiteQLQuery(query, DEFAULT_LIMIT, currentOffset, 'getInvoicesDictionary')

    const items = response.items || []

    return {
      cursor: response.hasMore ? String(currentOffset + DEFAULT_LIMIT) : null,
      items: items.map(invoice => ({
        label: invoice.tranid || `Invoice ${ invoice.id }`,
        value: String(invoice.id),
        note: `$${ Number(invoice.foreigntotal || 0).toFixed(2) } - ${ invoice.status || 'Unknown' }`,
      })),
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Subsidiaries Dictionary
   * @description Provides a searchable list of subsidiaries for dynamic parameter selection in FlowRunner. Subsidiaries are organizational units within a NetSuite OneWorld account.
   * @route POST /get-subsidiaries-dictionary
   * @paramDef {"type":"getSubsidiariesDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering subsidiaries."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"US Subsidiary","value":"1","note":"Root"}],"cursor":null}
   */
  async getSubsidiariesDictionary(payload) {
    const { search, cursor } = payload || {}

    const currentOffset = cursor ? parseInt(cursor) : 0

    let query = 'SELECT id, name, parent FROM subsidiary'

    if (search) {
      query += ` WHERE name LIKE '%${ escapeSuiteQLValue(search) }%'`
    }

    query += ' ORDER BY name ASC'

    const response = await this.#suiteQLQuery(query, DEFAULT_LIMIT, currentOffset, 'getSubsidiariesDictionary')

    const items = response.items || []

    return {
      cursor: response.hasMore ? String(currentOffset + DEFAULT_LIMIT) : null,
      items: items.map(sub => ({
        label: sub.name || `Subsidiary ${ sub.id }`,
        value: String(sub.id),
        note: sub.parent ? `Parent: ${ sub.parent }` : 'Root',
      })),
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Currencies Dictionary
   * @description Provides a searchable list of active currencies for dynamic parameter selection in FlowRunner. Only returns currencies that are not inactive.
   * @route POST /get-currencies-dictionary
   * @paramDef {"type":"getCurrenciesDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering currencies."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"US Dollar","value":"1","note":"USD"}],"cursor":null}
   */
  async getCurrenciesDictionary(payload) {
    const { search, cursor } = payload || {}

    const currentOffset = cursor ? parseInt(cursor) : 0

    let query = "SELECT id, name, symbol FROM currency WHERE isinactive = 'F'"

    if (search) {
      query += ` AND name LIKE '%${ escapeSuiteQLValue(search) }%'`
    }

    query += ' ORDER BY name ASC'

    const response = await this.#suiteQLQuery(query, DEFAULT_LIMIT, currentOffset, 'getCurrenciesDictionary')

    const items = response.items || []

    return {
      cursor: response.hasMore ? String(currentOffset + DEFAULT_LIMIT) : null,
      items: items.map(currency => ({
        label: currency.name || `Currency ${ currency.id }`,
        value: String(currency.id),
        note: currency.symbol || `ID: ${ currency.id }`,
      })),
    }
  }
}

Flowrunner.ServerCode.addService(NetSuiteService, [
  {
    name: 'clientId',
    displayName: 'Client ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'OAuth 2.0 Client ID from NetSuite Integration Record.',
  },
  {
    name: 'clientSecret',
    displayName: 'Client Secret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'OAuth 2.0 Client Secret from NetSuite Integration Record.',
  },
  {
    name: 'accountId',
    displayName: 'Account ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    hint: 'NetSuite Account ID. Found in Setup > Company > Company Information.',
  },
])

/**
 * @typedef {Object} getCustomersDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter customers by company name or entity ID."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for retrieving the next page of results."}
 */

/**
 * @typedef {Object} getVendorsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter vendors by company name or entity ID."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for retrieving the next page of results."}
 */

/**
 * @typedef {Object} getItemsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter items by item ID or display name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for retrieving the next page of results."}
 */

/**
 * @typedef {Object} getInvoicesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter invoices by transaction ID."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for retrieving the next page of results."}
 */

/**
 * @typedef {Object} getSubsidiariesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter subsidiaries by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for retrieving the next page of results."}
 */

/**
 * @typedef {Object} getCurrenciesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter currencies by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for retrieving the next page of results."}
 */
