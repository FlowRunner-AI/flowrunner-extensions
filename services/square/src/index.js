const crypto = require('crypto')

const logger = {
  info: (...args) => console.log('[Square] info:', ...args),
  debug: (...args) => console.log('[Square] debug:', ...args),
  error: (...args) => console.log('[Square] error:', ...args),
  warn: (...args) => console.log('[Square] warn:', ...args),
}

const SQUARE_API_VERSION = '2026-05-20'

const BASE_URLS = {
  Production: 'https://connect.squareup.com',
  Sandbox: 'https://connect.squareupsandbox.com',
}

const DEFAULT_DICTIONARY_PAGE_SIZE = 50

function clean(obj) {
  if (!obj) {
    return obj
  }

  const result = {}

  for (const key in obj) {
    const value = obj[key]

    if (value !== undefined && value !== null && value !== '') {
      result[key] = value
    }
  }

  return result
}

/**
 * @integrationName Square
 * @integrationIcon /icon.svg
 */
class SquareService {
  constructor(config) {
    this.accessToken = config.accessToken
    this.baseUrl = BASE_URLS[config.environment] || BASE_URLS.Production
  }

  async #apiRequest({ path, method = 'get', body, query, logTag }) {
    const url = `${ this.baseUrl }${ path }`

    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Authorization': `Bearer ${ this.accessToken }`,
          'Square-Version': SQUARE_API_VERSION,
          'Content-Type': 'application/json',
        })
        .query(clean(query) || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const squareErrors = error.body?.errors
      const message = Array.isArray(squareErrors) && squareErrors.length
        ? squareErrors.map(e => e.detail || e.code || e.category).join('; ')
        : (error.body?.message || error.message)

      logger.error(`${ logTag } - request failed: ${ message }`)

      throw new Error(`Square API error: ${ message }`)
    }
  }

  #idempotencyKey(override) {
    return override || crypto.randomUUID()
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  #resolveChoices(values, mapping) {
    if (!Array.isArray(values) || !values.length) {
      return undefined
    }

    return values.map(value => this.#resolveChoice(value, mapping))
  }

  #sortOrder(sortOrder) {
    return this.#resolveChoice(sortOrder, { 'Ascending': 'ASC', 'Descending': 'DESC' })
  }

  #inventoryState(state) {
    return this.#resolveChoice(state, {
      'None': 'NONE',
      'In Stock': 'IN_STOCK',
      'Sold': 'SOLD',
      'Waste': 'WASTE',
      'Received From Vendor': 'RECEIVED_FROM_VENDOR',
      'Returned By Customer': 'RETURNED_BY_CUSTOMER',
    })
  }

  #catalogTypes(types) {
    return this.#resolveChoices(types, {
      'Item': 'ITEM',
      'Item Variation': 'ITEM_VARIATION',
      'Category': 'CATEGORY',
      'Tax': 'TAX',
      'Discount': 'DISCOUNT',
      'Modifier List': 'MODIFIER_LIST',
      'Modifier': 'MODIFIER',
      'Image': 'IMAGE',
    })
  }

  // ==================== LOCATIONS ====================

  /**
   * @operationName List Locations
   * @category Locations
   * @description Lists all business locations of the Square account, including inactive ones. Each location includes its ID, name, address, timezone, currency, status and capabilities. Location IDs are required by many other operations such as Create Payment, Create Order and Create Invoice.
   * @route GET /list-locations
   * @returns {Object}
   * @sampleResult {"locations":[{"id":"L88917AVBK2S5","name":"Main Store","address":{"address_line_1":"1234 Peachtree St NE","locality":"Atlanta","administrative_district_level_1":"GA","postal_code":"30309","country":"US"},"timezone":"America/New_York","status":"ACTIVE","currency":"USD","merchant_id":"3MYCJG5GVYQ8Q","type":"PHYSICAL"}]}
   */
  async listLocations() {
    return await this.#apiRequest({
      logTag: '[listLocations]',
      path: '/v2/locations',
    })
  }

  /**
   * @operationName Get Location
   * @category Locations
   * @description Retrieves full details of a single business location by its ID, including address, business hours, capabilities, currency and status. Pass the special value "main" to retrieve the account's main location.
   * @route GET /get-location
   * @paramDef {"type":"String","label":"Location","name":"locationId","required":true,"dictionary":"getLocationsDictionary","description":"The Square location ID, or \"main\" for the account's main location."}
   * @returns {Object}
   * @sampleResult {"location":{"id":"L88917AVBK2S5","name":"Main Store","timezone":"America/New_York","capabilities":["CREDIT_CARD_PROCESSING"],"status":"ACTIVE","currency":"USD","country":"US","language_code":"en-US","type":"PHYSICAL"}}
   */
  async getLocation(locationId) {
    return await this.#apiRequest({
      logTag: '[getLocation]',
      path: `/v2/locations/${ encodeURIComponent(locationId) }`,
    })
  }

  // ==================== PAYMENTS ====================

  /**
   * @operationName List Payments
   * @category Payments
   * @description Lists payments taken by the account, newest first by default. Supports filtering by an RFC 3339 time window (defaults to the last year, maximum one year range) and by location. Results are paginated with a cursor; pass the returned cursor to fetch the next page.
   * @route GET /list-payments
   * @paramDef {"type":"String","label":"Begin Time","name":"beginTime","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Include payments created at or after this RFC 3339 timestamp, e.g. 2026-01-01T00:00:00Z. Defaults to one year ago."}
   * @paramDef {"type":"String","label":"End Time","name":"endTime","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Include payments created before this RFC 3339 timestamp. Defaults to now."}
   * @paramDef {"type":"String","label":"Sort Order","name":"sortOrder","uiComponent":{"type":"DROPDOWN","options":{"values":["Ascending","Descending"]}},"description":"Order results by creation time. Defaults to Descending (newest first)."}
   * @paramDef {"type":"String","label":"Location","name":"locationId","dictionary":"getLocationsDictionary","description":"Limit results to payments taken at this location. Defaults to all locations."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum results per page (1-100). Defaults to 100."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor returned by a previous List Payments call."}
   * @returns {Object}
   * @sampleResult {"payments":[{"id":"bP9mAsEMYPUGjjGNaNO5ZDVyLhSZY","created_at":"2026-07-01T15:23:45.000Z","amount_money":{"amount":1500,"currency":"USD"},"status":"COMPLETED","source_type":"CARD","location_id":"L88917AVBK2S5","order_id":"nUSN9TdxpiK3SrQg3wzmf6r8V"}],"cursor":"bXkgY3Vyc29y"}
   */
  async listPayments(beginTime, endTime, sortOrder, locationId, limit, cursor) {
    return await this.#apiRequest({
      logTag: '[listPayments]',
      path: '/v2/payments',
      query: {
        begin_time: beginTime,
        end_time: endTime,
        sort_order: this.#sortOrder(sortOrder),
        location_id: locationId,
        limit,
        cursor,
      },
    })
  }

  /**
   * @operationName Get Payment
   * @category Payments
   * @description Retrieves full details of a single payment by its ID, including amounts, status, card details, processing fees, associated order and customer, and the version token needed for updates.
   * @route GET /get-payment
   * @paramDef {"type":"String","label":"Payment ID","name":"paymentId","required":true,"description":"The unique ID of the payment to retrieve."}
   * @returns {Object}
   * @sampleResult {"payment":{"id":"bP9mAsEMYPUGjjGNaNO5ZDVyLhSZY","status":"COMPLETED","amount_money":{"amount":1500,"currency":"USD"},"total_money":{"amount":1500,"currency":"USD"},"source_type":"CARD","card_details":{"card":{"card_brand":"VISA","last_4":"1111"}},"location_id":"L88917AVBK2S5","version_token":"5rBpVhaobbAedTQnvCAqYaAPHtRLsgs4qGBUeGXAc5P6o"}}
   */
  async getPayment(paymentId) {
    return await this.#apiRequest({
      logTag: '[getPayment]',
      path: `/v2/payments/${ encodeURIComponent(paymentId) }`,
    })
  }

  /**
   * @operationName Create Payment
   * @category Payments
   * @description Charges a payment source. The source can be a card on file (a card ID created with Create Card), or the special values CASH / EXTERNAL to record payments taken outside Square. Amount is in cents (smallest currency unit), e.g. 1000 = $10.00. When Autocomplete is off the payment is only authorized and must later be finished with Complete Payment or voided with Cancel Payment. An idempotency key is generated automatically unless you provide one.
   * @route POST /create-payment
   * @paramDef {"type":"String","label":"Source ID","name":"sourceId","required":true,"description":"The payment source: a card-on-file ID (ccof:...), a payment token, or the literal value CASH or EXTERNAL to record an out-of-band payment."}
   * @paramDef {"type":"Number","label":"Amount","name":"amount","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Payment amount in cents (smallest currency unit), e.g. 1000 = $10.00."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","description":"ISO 4217 currency code, e.g. USD. Defaults to USD."}
   * @paramDef {"type":"String","label":"Customer","name":"customerId","dictionary":"getCustomersDictionary","description":"Customer to associate with the payment. Required when charging a card on file."}
   * @paramDef {"type":"String","label":"Location","name":"locationId","dictionary":"getLocationsDictionary","description":"Location to associate with the payment. Defaults to the account's main location."}
   * @paramDef {"type":"String","label":"Order ID","name":"orderId","description":"Existing order to attach this payment to."}
   * @paramDef {"type":"String","label":"Reference ID","name":"referenceId","description":"Your own reference for the payment (up to 40 characters), e.g. an external invoice number."}
   * @paramDef {"type":"String","label":"Note","name":"note","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"An optional note about the payment (up to 500 characters)."}
   * @paramDef {"type":"Boolean","label":"Autocomplete","name":"autocomplete","defaultValue":true,"uiComponent":{"type":"CHECKBOX"},"description":"When enabled (default) the payment completes immediately. Disable to only authorize; then use Complete Payment to capture."}
   * @paramDef {"type":"Number","label":"Buyer Supplied Cash Amount","name":"buyerSuppliedAmount","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Only for CASH payments: the cash amount the buyer handed over, in cents (smallest currency unit). Defaults to the payment amount."}
   * @paramDef {"type":"String","label":"External Payment Type","name":"externalType","uiComponent":{"type":"DROPDOWN","options":{"values":["Check","Bank Transfer","Other Gift Card","Crypto","Square Cash","Social","External","Emoney","Card","Stored Balance","Food Voucher","Other"]}},"description":"Only for EXTERNAL payments: how the payment was made outside of Square. Defaults to Other."}
   * @paramDef {"type":"String","label":"External Payment Source","name":"externalSource","description":"Only for EXTERNAL payments: a description of the external payment source, e.g. \"Food Delivery Service\"."}
   * @paramDef {"type":"String","label":"Idempotency Key","name":"idempotencyKey","description":"Optional idempotency key to safely retry the request. Auto-generated when omitted."}
   * @returns {Object}
   * @sampleResult {"payment":{"id":"bP9mAsEMYPUGjjGNaNO5ZDVyLhSZY","status":"COMPLETED","amount_money":{"amount":1500,"currency":"USD"},"source_type":"CARD","location_id":"L88917AVBK2S5","receipt_url":"https://squareup.com/receipt/preview/bP9mAsEMYPUGjjGNaNO5ZDVyLhSZY"}}
   */
  async createPayment(
    sourceId, amount, currency, customerId, locationId, orderId, referenceId,
    note, autocomplete, buyerSuppliedAmount, externalType, externalSource, idempotencyKey
  ) {
    const resolvedCurrency = currency || 'USD'

    const body = clean({
      idempotency_key: this.#idempotencyKey(idempotencyKey),
      source_id: sourceId,
      amount_money: { amount, currency: resolvedCurrency },
      customer_id: customerId,
      location_id: locationId,
      order_id: orderId,
      reference_id: referenceId,
      note,
      autocomplete: autocomplete !== false,
    })

    if (sourceId === 'CASH') {
      body.cash_details = {
        buyer_supplied_money: {
          amount: buyerSuppliedAmount !== undefined && buyerSuppliedAmount !== null ? buyerSuppliedAmount : amount,
          currency: resolvedCurrency,
        },
      }
    }

    if (sourceId === 'EXTERNAL') {
      body.external_details = {
        type: this.#resolveChoice(externalType, {
          'Check': 'CHECK',
          'Bank Transfer': 'BANK_TRANSFER',
          'Other Gift Card': 'OTHER_GIFT_CARD',
          'Crypto': 'CRYPTO',
          'Square Cash': 'SQUARE_CASH',
          'Social': 'SOCIAL',
          'External': 'EXTERNAL',
          'Emoney': 'EMONEY',
          'Card': 'CARD',
          'Stored Balance': 'STORED_BALANCE',
          'Food Voucher': 'FOOD_VOUCHER',
          'Other': 'OTHER',
        }) || 'OTHER',
        source: externalSource || 'External payment',
      }
    }

    return await this.#apiRequest({
      logTag: '[createPayment]',
      path: '/v2/payments',
      method: 'post',
      body,
    })
  }

  /**
   * @operationName Update Payment
   * @category Payments
   * @description Updates the amount or tip of a payment that is in the APPROVED state (created with Autocomplete off), before it is completed. Amounts are in cents (smallest currency unit). Requires the payment's current version token, available from Get Payment.
   * @route PUT /update-payment
   * @paramDef {"type":"String","label":"Payment ID","name":"paymentId","required":true,"description":"The ID of the payment to update."}
   * @paramDef {"type":"Number","label":"Amount","name":"amount","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"New payment amount in cents (smallest currency unit)."}
   * @paramDef {"type":"Number","label":"Tip Amount","name":"tipAmount","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"New tip amount in cents (smallest currency unit)."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","description":"ISO 4217 currency code for the amounts, e.g. USD. Defaults to USD."}
   * @paramDef {"type":"String","label":"Version Token","name":"versionToken","description":"The payment's current version_token from Get Payment; protects against concurrent updates."}
   * @paramDef {"type":"String","label":"Idempotency Key","name":"idempotencyKey","description":"Optional idempotency key to safely retry the request. Auto-generated when omitted."}
   * @returns {Object}
   * @sampleResult {"payment":{"id":"bP9mAsEMYPUGjjGNaNO5ZDVyLhSZY","status":"APPROVED","amount_money":{"amount":2000,"currency":"USD"},"tip_money":{"amount":300,"currency":"USD"},"version_token":"kNsvq3WhqPBsYI22TSXqRSPZBBhV4M8zSw768UXBmoC6o"}}
   */
  async updatePayment(paymentId, amount, tipAmount, currency, versionToken, idempotencyKey) {
    const resolvedCurrency = currency || 'USD'

    const payment = clean({
      version_token: versionToken,
    })

    if (amount !== undefined && amount !== null) {
      payment.amount_money = { amount, currency: resolvedCurrency }
    }

    if (tipAmount !== undefined && tipAmount !== null) {
      payment.tip_money = { amount: tipAmount, currency: resolvedCurrency }
    }

    return await this.#apiRequest({
      logTag: '[updatePayment]',
      path: `/v2/payments/${ encodeURIComponent(paymentId) }`,
      method: 'put',
      body: {
        idempotency_key: this.#idempotencyKey(idempotencyKey),
        payment,
      },
    })
  }

  /**
   * @operationName Complete Payment
   * @category Payments
   * @description Captures (completes) a payment that was previously authorized with Create Payment and Autocomplete off. By default an approved payment must be completed within 6 days or it is automatically voided.
   * @route POST /complete-payment
   * @paramDef {"type":"String","label":"Payment ID","name":"paymentId","required":true,"description":"The ID of the APPROVED payment to complete."}
   * @paramDef {"type":"String","label":"Version Token","name":"versionToken","description":"The payment's current version_token from Get Payment; protects against concurrent updates."}
   * @returns {Object}
   * @sampleResult {"payment":{"id":"bP9mAsEMYPUGjjGNaNO5ZDVyLhSZY","status":"COMPLETED","amount_money":{"amount":1500,"currency":"USD"},"location_id":"L88917AVBK2S5"}}
   */
  async completePayment(paymentId, versionToken) {
    return await this.#apiRequest({
      logTag: '[completePayment]',
      path: `/v2/payments/${ encodeURIComponent(paymentId) }/complete`,
      method: 'post',
      body: clean({ version_token: versionToken }),
    })
  }

  /**
   * @operationName Cancel Payment
   * @category Payments
   * @description Cancels (voids) a payment in the APPROVED state, releasing the hold on the buyer's funds. Only payments created with Autocomplete off can be canceled; completed payments must be refunded instead with Refund Payment.
   * @route POST /cancel-payment
   * @paramDef {"type":"String","label":"Payment ID","name":"paymentId","required":true,"description":"The ID of the APPROVED payment to cancel."}
   * @returns {Object}
   * @sampleResult {"payment":{"id":"bP9mAsEMYPUGjjGNaNO5ZDVyLhSZY","status":"CANCELED","amount_money":{"amount":1500,"currency":"USD"},"location_id":"L88917AVBK2S5"}}
   */
  async cancelPayment(paymentId) {
    return await this.#apiRequest({
      logTag: '[cancelPayment]',
      path: `/v2/payments/${ encodeURIComponent(paymentId) }/cancel`,
      method: 'post',
      body: {},
    })
  }

  // ==================== REFUNDS ====================

  /**
   * @operationName Refund Payment
   * @category Refunds
   * @description Refunds all or part of a completed payment. The refund amount is in cents (smallest currency unit) and must not exceed the remaining refundable balance of the payment. An idempotency key is generated automatically unless you provide one. Refunds are processed asynchronously; check the status with Get Refund.
   * @route POST /refund-payment
   * @paramDef {"type":"String","label":"Payment ID","name":"paymentId","required":true,"description":"The ID of the payment to refund."}
   * @paramDef {"type":"Number","label":"Amount","name":"amount","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Refund amount in cents (smallest currency unit), e.g. 500 = $5.00. Must not exceed the payment's remaining refundable amount."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","description":"ISO 4217 currency code, e.g. USD. Must match the payment currency. Defaults to USD."}
   * @paramDef {"type":"String","label":"Reason","name":"reason","description":"A reason for the refund (up to 192 characters), shown in the Seller Dashboard."}
   * @paramDef {"type":"String","label":"Idempotency Key","name":"idempotencyKey","description":"Optional idempotency key to safely retry the request. Auto-generated when omitted."}
   * @returns {Object}
   * @sampleResult {"refund":{"id":"bP9mAsEMYPUGjjGNaNO5ZDVyLhSZY_KlWisad4HcZzTZAKrKLzrCc","status":"PENDING","amount_money":{"amount":500,"currency":"USD"},"payment_id":"bP9mAsEMYPUGjjGNaNO5ZDVyLhSZY","reason":"Damaged item"}}
   */
  async refundPayment(paymentId, amount, currency, reason, idempotencyKey) {
    return await this.#apiRequest({
      logTag: '[refundPayment]',
      path: '/v2/refunds',
      method: 'post',
      body: clean({
        idempotency_key: this.#idempotencyKey(idempotencyKey),
        payment_id: paymentId,
        amount_money: { amount, currency: currency || 'USD' },
        reason,
      }),
    })
  }

  /**
   * @operationName List Refunds
   * @category Refunds
   * @description Lists refunds issued by the account, newest first by default. Supports filtering by an RFC 3339 time window (defaults to the last year, maximum one year range) and by location. Results are paginated with a cursor.
   * @route GET /list-refunds
   * @paramDef {"type":"String","label":"Begin Time","name":"beginTime","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Include refunds created at or after this RFC 3339 timestamp. Defaults to one year ago."}
   * @paramDef {"type":"String","label":"End Time","name":"endTime","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Include refunds created before this RFC 3339 timestamp. Defaults to now."}
   * @paramDef {"type":"String","label":"Sort Order","name":"sortOrder","uiComponent":{"type":"DROPDOWN","options":{"values":["Ascending","Descending"]}},"description":"Order results by creation time. Defaults to Descending (newest first)."}
   * @paramDef {"type":"String","label":"Location","name":"locationId","dictionary":"getLocationsDictionary","description":"Limit results to refunds of payments taken at this location."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum results per page (1-100). Defaults to 100."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor returned by a previous List Refunds call."}
   * @returns {Object}
   * @sampleResult {"refunds":[{"id":"bP9mAsEMYPUGjjGNaNO5ZDVyLhSZY_KlWisad4HcZzTZAKrKLzrCc","status":"COMPLETED","amount_money":{"amount":500,"currency":"USD"},"payment_id":"bP9mAsEMYPUGjjGNaNO5ZDVyLhSZY","created_at":"2026-07-02T10:00:00.000Z"}],"cursor":"bXkgY3Vyc29y"}
   */
  async listRefunds(beginTime, endTime, sortOrder, locationId, limit, cursor) {
    return await this.#apiRequest({
      logTag: '[listRefunds]',
      path: '/v2/refunds',
      query: {
        begin_time: beginTime,
        end_time: endTime,
        sort_order: this.#sortOrder(sortOrder),
        location_id: locationId,
        limit,
        cursor,
      },
    })
  }

  /**
   * @operationName Get Refund
   * @category Refunds
   * @description Retrieves full details of a single payment refund by its ID, including its status (PENDING, COMPLETED, REJECTED or FAILED), amount and associated payment.
   * @route GET /get-refund
   * @paramDef {"type":"String","label":"Refund ID","name":"refundId","required":true,"description":"The unique ID of the refund to retrieve."}
   * @returns {Object}
   * @sampleResult {"refund":{"id":"bP9mAsEMYPUGjjGNaNO5ZDVyLhSZY_KlWisad4HcZzTZAKrKLzrCc","status":"COMPLETED","amount_money":{"amount":500,"currency":"USD"},"payment_id":"bP9mAsEMYPUGjjGNaNO5ZDVyLhSZY","order_id":"nUSN9TdxpiK3SrQg3wzmf6r8V"}}
   */
  async getRefund(refundId) {
    return await this.#apiRequest({
      logTag: '[getRefund]',
      path: `/v2/refunds/${ encodeURIComponent(refundId) }`,
    })
  }

  // ==================== ORDERS ====================

  /**
   * @typedef {Object} OrderLineItem
   * @paramDef {"type":"String","label":"Quantity","name":"quantity","required":true,"description":"Quantity as a decimal string, e.g. \"1\" or \"2.5\"."}
   * @paramDef {"type":"String","label":"Catalog Object ID","name":"catalogObjectId","description":"ID of a catalog ITEM_VARIATION to sell. Leave empty for an ad hoc line item defined by Name and Base Price."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"Name of an ad hoc line item. Ignored when a Catalog Object ID is provided."}
   * @paramDef {"type":"Number","label":"Base Price","name":"basePrice","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Unit price of an ad hoc line item in cents (smallest currency unit). Ignored when a Catalog Object ID is provided."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","description":"ISO 4217 currency code for the base price, e.g. USD. Defaults to USD."}
   * @paramDef {"type":"String","label":"Note","name":"note","description":"An optional note for this line item."}
   */

  /**
   * @typedef {Object} OrderTax
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Display name of the tax, e.g. \"Sales Tax\"."}
   * @paramDef {"type":"String","label":"Percentage","name":"percentage","required":true,"description":"Tax percentage as a decimal string, e.g. \"8.5\" for 8.5%."}
   * @paramDef {"type":"String","label":"Scope","name":"scope","uiComponent":{"type":"DROPDOWN","options":{"values":["Order","Line Item"]}},"description":"Whether the tax applies to the whole order or to individual line items. Defaults to Order."}
   */

  /**
   * @typedef {Object} OrderDiscount
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Display name of the discount, e.g. \"Loyalty Discount\"."}
   * @paramDef {"type":"String","label":"Percentage","name":"percentage","description":"Discount percentage as a decimal string, e.g. \"10\" for 10%. Provide either a percentage or a fixed amount."}
   * @paramDef {"type":"Number","label":"Amount","name":"amount","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Fixed discount amount in cents (smallest currency unit). Provide either a percentage or a fixed amount."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","description":"ISO 4217 currency code for a fixed discount amount, e.g. USD. Defaults to USD."}
   * @paramDef {"type":"String","label":"Scope","name":"scope","uiComponent":{"type":"DROPDOWN","options":{"values":["Order","Line Item"]}},"description":"Whether the discount applies to the whole order or to individual line items. Defaults to Order."}
   */

  #buildOrderLineItems(lineItems) {
    return (lineItems || []).map(item => {
      const lineItem = clean({
        quantity: item.quantity !== undefined && item.quantity !== null ? String(item.quantity) : '1',
        note: item.note,
      })

      if (item.catalogObjectId) {
        lineItem.catalog_object_id = item.catalogObjectId
      } else {
        lineItem.name = item.name

        lineItem.base_price_money = {
          amount: item.basePrice,
          currency: item.currency || 'USD',
        }
      }

      return lineItem
    })
  }

  #orderScope(scope) {
    return this.#resolveChoice(scope, { 'Order': 'ORDER', 'Line Item': 'LINE_ITEM' }) || 'ORDER'
  }

  /**
   * @operationName Create Order
   * @category Orders
   * @description Creates an order at a location. Line items can reference catalog item variations by ID or be ad hoc items with a name and a unit price in cents (smallest currency unit). Optional order-level taxes and discounts are applied with ORDER scope by default. The created order is OPEN and can later be paid with Pay Order. An idempotency key is generated automatically unless you provide one.
   * @route POST /create-order
   * @paramDef {"type":"String","label":"Location","name":"locationId","required":true,"dictionary":"getLocationsDictionary","description":"The location to create the order at."}
   * @paramDef {"type":"Array<OrderLineItem>","label":"Line Items","name":"lineItems","required":true,"description":"The products or services being sold. Each entry is either a catalog ITEM_VARIATION reference or an ad hoc item with name and base price."}
   * @paramDef {"type":"String","label":"Customer","name":"customerId","dictionary":"getCustomersDictionary","description":"Customer to associate with the order."}
   * @paramDef {"type":"String","label":"Reference ID","name":"referenceId","description":"Your own reference for the order (up to 40 characters)."}
   * @paramDef {"type":"Array<OrderTax>","label":"Taxes","name":"taxes","description":"Percentage-based taxes to apply to the order."}
   * @paramDef {"type":"Array<OrderDiscount>","label":"Discounts","name":"discounts","description":"Percentage or fixed-amount discounts to apply to the order."}
   * @paramDef {"type":"String","label":"Idempotency Key","name":"idempotencyKey","description":"Optional idempotency key to safely retry the request. Auto-generated when omitted."}
   * @returns {Object}
   * @sampleResult {"order":{"id":"nUSN9TdxpiK3SrQg3wzmf6r8V","location_id":"L88917AVBK2S5","state":"OPEN","version":1,"line_items":[{"uid":"8uSwfzvUImn3IRrvciqlXC","name":"Coffee","quantity":"2","base_price_money":{"amount":350,"currency":"USD"},"total_money":{"amount":700,"currency":"USD"}}],"total_money":{"amount":700,"currency":"USD"}}}
   */
  async createOrder(locationId, lineItems, customerId, referenceId, taxes, discounts, idempotencyKey) {
    const order = clean({
      location_id: locationId,
      customer_id: customerId,
      reference_id: referenceId,
      line_items: this.#buildOrderLineItems(lineItems),
    })

    if (Array.isArray(taxes) && taxes.length) {
      order.taxes = taxes.map((tax, index) => clean({
        uid: `tax-${ index }`,
        name: tax.name,
        type: 'ADDITIVE',
        percentage: tax.percentage !== undefined && tax.percentage !== null ? String(tax.percentage) : undefined,
        scope: this.#orderScope(tax.scope),
      }))
    }

    if (Array.isArray(discounts) && discounts.length) {
      order.discounts = discounts.map((discount, index) => {
        const result = clean({
          uid: `discount-${ index }`,
          name: discount.name,
          scope: this.#orderScope(discount.scope),
        })

        if (discount.percentage !== undefined && discount.percentage !== null && discount.percentage !== '') {
          result.type = 'FIXED_PERCENTAGE'
          result.percentage = String(discount.percentage)
        } else {
          result.type = 'FIXED_AMOUNT'
          result.amount_money = { amount: discount.amount, currency: discount.currency || 'USD' }
        }

        return result
      })
    }

    return await this.#apiRequest({
      logTag: '[createOrder]',
      path: '/v2/orders',
      method: 'post',
      body: {
        idempotency_key: this.#idempotencyKey(idempotencyKey),
        order,
      },
    })
  }

  /**
   * @operationName Get Order
   * @category Orders
   * @description Retrieves full details of a single order by its ID, including line items, taxes, discounts, fulfillments, tenders, totals and the version number needed for updates.
   * @route GET /get-order
   * @paramDef {"type":"String","label":"Order ID","name":"orderId","required":true,"description":"The unique ID of the order to retrieve."}
   * @returns {Object}
   * @sampleResult {"order":{"id":"nUSN9TdxpiK3SrQg3wzmf6r8V","location_id":"L88917AVBK2S5","state":"OPEN","version":1,"total_money":{"amount":700,"currency":"USD"},"created_at":"2026-07-01T15:00:00.000Z"}}
   */
  async getOrder(orderId) {
    return await this.#apiRequest({
      logTag: '[getOrder]',
      path: `/v2/orders/${ encodeURIComponent(orderId) }`,
    })
  }

  /**
   * @operationName Update Order
   * @category Orders
   * @description Updates an open order using sparse updates: pass only the fields to add or change in the Order object, and list dot-notation paths of fields to remove in Fields To Clear (e.g. line_items[uid].note). Requires the order's current version number from Get Order for optimistic concurrency.
   * @route PUT /update-order
   * @paramDef {"type":"String","label":"Order ID","name":"orderId","required":true,"description":"The ID of the order to update."}
   * @paramDef {"type":"Number","label":"Version","name":"version","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The order's current version number from Get Order. The update fails if it does not match."}
   * @paramDef {"type":"Object","label":"Order","name":"order","description":"Sparse Order object containing only the fields to add or change, in Square API format (snake_case), e.g. {\"reference_id\":\"NEW-REF\"}."}
   * @paramDef {"type":"Array<String>","label":"Fields To Clear","name":"fieldsToClear","description":"Dot-notation paths of order fields to clear, e.g. discounts or line_items[a1B2c3].note."}
   * @paramDef {"type":"String","label":"Idempotency Key","name":"idempotencyKey","description":"Optional idempotency key to safely retry the request. Auto-generated when omitted."}
   * @returns {Object}
   * @sampleResult {"order":{"id":"nUSN9TdxpiK3SrQg3wzmf6r8V","location_id":"L88917AVBK2S5","state":"OPEN","version":2,"reference_id":"NEW-REF","total_money":{"amount":700,"currency":"USD"}}}
   */
  async updateOrder(orderId, version, order, fieldsToClear, idempotencyKey) {
    return await this.#apiRequest({
      logTag: '[updateOrder]',
      path: `/v2/orders/${ encodeURIComponent(orderId) }`,
      method: 'put',
      body: clean({
        idempotency_key: this.#idempotencyKey(idempotencyKey),
        order: { ...(order || {}), version },
        fields_to_clear: Array.isArray(fieldsToClear) && fieldsToClear.length ? fieldsToClear : undefined,
      }),
    })
  }

  /**
   * @operationName Search Orders
   * @category Orders
   * @description Searches orders across one or more locations with optional filters on order state and a date-time window on the created, updated or closed timestamp. When a date-time filter is used, results are sorted by that same field. Results are paginated with a cursor.
   * @route POST /search-orders
   * @paramDef {"type":"Array<String>","label":"Locations","name":"locationIds","required":true,"description":"Location IDs to search (up to 10). Use List Locations to find IDs."}
   * @paramDef {"type":"Array<String>","label":"States","name":"states","uiComponent":{"type":"DROPDOWN","options":{"values":["Open","Completed","Canceled","Draft"]}},"description":"Only return orders in these states."}
   * @paramDef {"type":"String","label":"Date Time Field","name":"dateTimeField","uiComponent":{"type":"DROPDOWN","options":{"values":["Created At","Updated At","Closed At"]}},"description":"Which timestamp the Start/End Time window filters on. Defaults to Created At when a time window is given."}
   * @paramDef {"type":"String","label":"Start Time","name":"startTime","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Include orders whose selected timestamp is at or after this RFC 3339 time."}
   * @paramDef {"type":"String","label":"End Time","name":"endTime","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Include orders whose selected timestamp is before this RFC 3339 time."}
   * @paramDef {"type":"String","label":"Sort Order","name":"sortOrder","uiComponent":{"type":"DROPDOWN","options":{"values":["Ascending","Descending"]}},"description":"Sort direction for the selected timestamp field. Defaults to Descending."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum results per page (1-1000). Defaults to 500."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor returned by a previous Search Orders call."}
   * @returns {Object}
   * @sampleResult {"orders":[{"id":"nUSN9TdxpiK3SrQg3wzmf6r8V","location_id":"L88917AVBK2S5","state":"COMPLETED","total_money":{"amount":700,"currency":"USD"},"closed_at":"2026-07-01T16:00:00.000Z"}],"cursor":"bXkgY3Vyc29y"}
   */
  async searchOrders(locationIds, states, dateTimeField, startTime, endTime, sortOrder, limit, cursor) {
    const filter = {}
    const query = {}

    const resolvedStates = this.#resolveChoices(states, {
      'Open': 'OPEN',
      'Completed': 'COMPLETED',
      'Canceled': 'CANCELED',
      'Draft': 'DRAFT',
    })

    if (resolvedStates) {
      filter.state_filter = { states: resolvedStates }
    }

    const field = this.#resolveChoice(dateTimeField, {
      'Created At': 'created_at',
      'Updated At': 'updated_at',
      'Closed At': 'closed_at',
    }) || ((startTime || endTime) ? 'created_at' : undefined)

    if (field && (startTime || endTime)) {
      filter.date_time_filter = { [field]: clean({ start_at: startTime, end_at: endTime }) }

      query.sort = {
        sort_field: field.toUpperCase(),
        sort_order: this.#sortOrder(sortOrder) || 'DESC',
      }
    }

    if (Object.keys(filter).length) {
      query.filter = filter
    }

    return await this.#apiRequest({
      logTag: '[searchOrders]',
      path: '/v2/orders/search',
      method: 'post',
      body: clean({
        location_ids: locationIds,
        query: Object.keys(query).length ? query : undefined,
        limit,
        cursor,
      }),
    })
  }

  /**
   * @operationName Pay Order
   * @category Orders
   * @description Pays for an open order using one or more previously approved payments (created with Create Payment and Autocomplete off), or marks it paid with a zero total. The sum of the payments must equal the order total. Requires the order's current version number.
   * @route POST /pay-order
   * @paramDef {"type":"String","label":"Order ID","name":"orderId","required":true,"description":"The ID of the order to pay."}
   * @paramDef {"type":"Number","label":"Order Version","name":"orderVersion","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The order's current version number from Get Order. Defaults to the latest version if omitted."}
   * @paramDef {"type":"Array<String>","label":"Payment IDs","name":"paymentIds","description":"IDs of APPROVED payments to apply to the order. Their sum must equal the order total. Omit for zero-total orders."}
   * @paramDef {"type":"String","label":"Idempotency Key","name":"idempotencyKey","description":"Optional idempotency key to safely retry the request. Auto-generated when omitted."}
   * @returns {Object}
   * @sampleResult {"order":{"id":"nUSN9TdxpiK3SrQg3wzmf6r8V","location_id":"L88917AVBK2S5","state":"COMPLETED","version":3,"tenders":[{"id":"bP9mAsEMYPUGjjGNaNO5ZDVyLhSZY","type":"CARD","amount_money":{"amount":700,"currency":"USD"}}]}}
   */
  async payOrder(orderId, orderVersion, paymentIds, idempotencyKey) {
    return await this.#apiRequest({
      logTag: '[payOrder]',
      path: `/v2/orders/${ encodeURIComponent(orderId) }/pay`,
      method: 'post',
      body: clean({
        idempotency_key: this.#idempotencyKey(idempotencyKey),
        order_version: orderVersion,
        payment_ids: Array.isArray(paymentIds) && paymentIds.length ? paymentIds : undefined,
      }),
    })
  }

  /**
   * @operationName Calculate Order
   * @category Orders
   * @description Calculates totals, taxes and discounts for an order without creating it. Pass a full Order object in Square API format (snake_case, including location_id and line_items); the response returns the order with all computed amounts in cents (smallest currency unit). Useful for previewing a cart before Create Order.
   * @route POST /calculate-order
   * @paramDef {"type":"Object","label":"Order","name":"order","required":true,"description":"An Order object in Square API format to price, e.g. {\"location_id\":\"L88917AVBK2S5\",\"line_items\":[{\"name\":\"Coffee\",\"quantity\":\"2\",\"base_price_money\":{\"amount\":350,\"currency\":\"USD\"}}]}."}
   * @returns {Object}
   * @sampleResult {"order":{"location_id":"L88917AVBK2S5","line_items":[{"uid":"8uSwfzvUImn3IRrvciqlXC","name":"Coffee","quantity":"2","total_money":{"amount":700,"currency":"USD"}}],"total_money":{"amount":700,"currency":"USD"},"total_tax_money":{"amount":0,"currency":"USD"}}}
   */
  async calculateOrder(order) {
    return await this.#apiRequest({
      logTag: '[calculateOrder]',
      path: '/v2/orders/calculate',
      method: 'post',
      body: { order },
    })
  }

  /**
   * @operationName Clone Order
   * @category Orders
   * @description Creates a new DRAFT order as a copy of an existing order. The draft copies line items, taxes and discounts but not payment information, and can be modified with Update Order before being finalized. An idempotency key is generated automatically unless you provide one.
   * @route POST /clone-order
   * @paramDef {"type":"String","label":"Order ID","name":"orderId","required":true,"description":"The ID of the order to clone."}
   * @paramDef {"type":"Number","label":"Version","name":"version","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The version of the order to clone. Defaults to the latest version."}
   * @paramDef {"type":"String","label":"Idempotency Key","name":"idempotencyKey","description":"Optional idempotency key to safely retry the request. Auto-generated when omitted."}
   * @returns {Object}
   * @sampleResult {"order":{"id":"CAISENgvlJ6jLWAzERDzjyHVybY","location_id":"L88917AVBK2S5","state":"DRAFT","version":1,"total_money":{"amount":700,"currency":"USD"}}}
   */
  async cloneOrder(orderId, version, idempotencyKey) {
    return await this.#apiRequest({
      logTag: '[cloneOrder]',
      path: '/v2/orders/clone',
      method: 'post',
      body: clean({
        idempotency_key: this.#idempotencyKey(idempotencyKey),
        order_id: orderId,
        version,
      }),
    })
  }

  // ==================== CATALOG ====================

  /**
   * @operationName List Catalog
   * @category Catalog
   * @description Lists catalog objects of the selected types (items, categories, taxes, discounts, etc.). When no types are selected, all types are returned. Results are paginated with a cursor. Deleted objects are not included.
   * @route GET /list-catalog
   * @paramDef {"type":"Array<String>","label":"Types","name":"types","uiComponent":{"type":"DROPDOWN","options":{"values":["Item","Item Variation","Category","Tax","Discount","Modifier List","Modifier","Image"]}},"description":"Catalog object types to list. Defaults to all types."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor returned by a previous List Catalog call."}
   * @returns {Object}
   * @sampleResult {"objects":[{"type":"ITEM","id":"W62UWFY35CWMYGVWK6TWJDNI","updated_at":"2026-06-01T12:00:00.000Z","version":1625583284357,"item_data":{"name":"Coffee","variations":[{"type":"ITEM_VARIATION","id":"6ULWO3OAML6K2NThZLDYGNXR","item_variation_data":{"name":"Regular","pricing_type":"FIXED_PRICING","price_money":{"amount":350,"currency":"USD"}}}]}}],"cursor":"bXkgY3Vyc29y"}
   */
  async listCatalog(types, cursor) {
    const resolvedTypes = this.#catalogTypes(types)

    return await this.#apiRequest({
      logTag: '[listCatalog]',
      path: '/v2/catalog/list',
      query: {
        types: resolvedTypes ? resolvedTypes.join(',') : undefined,
        cursor,
      },
    })
  }

  /**
   * @operationName Get Catalog Object
   * @category Catalog
   * @description Retrieves a single catalog object (item, variation, category, tax, etc.) by its ID. Optionally includes related objects, e.g. the category and taxes of an item, in a separate related_objects array.
   * @route GET /get-catalog-object
   * @paramDef {"type":"String","label":"Catalog Object","name":"objectId","required":true,"dictionary":"getCatalogItemsDictionary","description":"The ID of the catalog object to retrieve. Select an item or enter any catalog object ID."}
   * @paramDef {"type":"Boolean","label":"Include Related Objects","name":"includeRelatedObjects","uiComponent":{"type":"CHECKBOX"},"description":"Also return related objects such as the item's category, taxes and images."}
   * @returns {Object}
   * @sampleResult {"object":{"type":"ITEM","id":"W62UWFY35CWMYGVWK6TWJDNI","version":1625583284357,"item_data":{"name":"Coffee","description":"Fresh brewed coffee","variations":[{"type":"ITEM_VARIATION","id":"6ULWO3OAML6K2NThZLDYGNXR","item_variation_data":{"pricing_type":"FIXED_PRICING","price_money":{"amount":350,"currency":"USD"}}}]}},"related_objects":[{"type":"CATEGORY","id":"BJNQCF2FJ6S6UIDT65ABHLRX","category_data":{"name":"Beverages"}}]}
   */
  async getCatalogObject(objectId, includeRelatedObjects) {
    return await this.#apiRequest({
      logTag: '[getCatalogObject]',
      path: `/v2/catalog/object/${ encodeURIComponent(objectId) }`,
      query: {
        include_related_objects: includeRelatedObjects === true ? 'true' : undefined,
      },
    })
  }

  /**
   * @operationName Upsert Catalog Item
   * @category Catalog
   * @description Creates or updates a catalog object. In simple mode, provide a name and price to create an ITEM with a single fixed-price variation (price in cents, smallest currency unit). For full control (updates, other object types, multiple variations), provide a complete CatalogObject in the Raw Object parameter instead, which overrides the simple-mode parameters. An idempotency key is generated automatically unless you provide one.
   * @route POST /upsert-catalog-item
   * @paramDef {"type":"String","label":"Name","name":"name","description":"Name of the new item. Required unless a Raw Object is provided."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Description of the new item."}
   * @paramDef {"type":"Number","label":"Price","name":"price","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Price of the item's variation in cents (smallest currency unit), e.g. 350 = $3.50. Required unless a Raw Object is provided."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","description":"ISO 4217 currency code for the price, e.g. USD. Defaults to USD."}
   * @paramDef {"type":"String","label":"Variation Name","name":"variationName","description":"Name of the single variation created for the item. Defaults to \"Regular\"."}
   * @paramDef {"type":"String","label":"Category ID","name":"categoryId","description":"ID of an existing CATEGORY catalog object to place the item in."}
   * @paramDef {"type":"Object","label":"Raw Object","name":"rawObject","description":"A complete CatalogObject in Square API format for full control, e.g. {\"type\":\"ITEM\",\"id\":\"#new\",\"item_data\":{...}}. To update an existing object, include its real id and current version. Overrides all simple-mode parameters."}
   * @paramDef {"type":"String","label":"Idempotency Key","name":"idempotencyKey","description":"Optional idempotency key to safely retry the request. Auto-generated when omitted."}
   * @returns {Object}
   * @sampleResult {"catalog_object":{"type":"ITEM","id":"W62UWFY35CWMYGVWK6TWJDNI","version":1625583284357,"item_data":{"name":"Coffee","variations":[{"type":"ITEM_VARIATION","id":"6ULWO3OAML6K2NThZLDYGNXR","item_variation_data":{"pricing_type":"FIXED_PRICING","price_money":{"amount":350,"currency":"USD"}}}]}},"id_mappings":[{"client_object_id":"#new","object_id":"W62UWFY35CWMYGVWK6TWJDNI"}]}
   */
  async upsertCatalogItem(name, description, price, currency, variationName, categoryId, rawObject, idempotencyKey) {
    const object = rawObject || {
      type: 'ITEM',
      id: '#new',
      item_data: clean({
        name,
        description,
        category_id: categoryId,
        variations: [{
          type: 'ITEM_VARIATION',
          id: '#new-variation',
          item_variation_data: {
            name: variationName || 'Regular',
            pricing_type: 'FIXED_PRICING',
            price_money: { amount: price, currency: currency || 'USD' },
          },
        }],
      }),
    }

    return await this.#apiRequest({
      logTag: '[upsertCatalogItem]',
      path: '/v2/catalog/object',
      method: 'post',
      body: {
        idempotency_key: this.#idempotencyKey(idempotencyKey),
        object,
      },
    })
  }

  /**
   * @operationName Delete Catalog Object
   * @category Catalog
   * @description Deletes a catalog object and all of its children by ID. For example, deleting an ITEM also deletes all of its ITEM_VARIATION children. Returns the IDs of all deleted objects. Deletion is permanent.
   * @route DELETE /delete-catalog-object
   * @paramDef {"type":"String","label":"Catalog Object","name":"objectId","required":true,"dictionary":"getCatalogItemsDictionary","description":"The ID of the catalog object to delete. Select an item or enter any catalog object ID."}
   * @returns {Object}
   * @sampleResult {"deleted_object_ids":["W62UWFY35CWMYGVWK6TWJDNI","6ULWO3OAML6K2NThZLDYGNXR"],"deleted_at":"2026-07-01T12:00:00.000Z"}
   */
  async deleteCatalogObject(objectId) {
    return await this.#apiRequest({
      logTag: '[deleteCatalogObject]',
      path: `/v2/catalog/object/${ encodeURIComponent(objectId) }`,
      method: 'delete',
    })
  }

  /**
   * @operationName Search Catalog
   * @category Catalog
   * @description Searches catalog objects by a text filter matched against names, descriptions and abbreviations, optionally limited to specific object types. Results are paginated with a cursor and include deleted objects only when requested via the API defaults (deleted objects are excluded).
   * @route POST /search-catalog
   * @paramDef {"type":"String","label":"Text Filter","name":"textFilter","description":"Text to search for in object names, descriptions and abbreviations, e.g. \"coffee\"."}
   * @paramDef {"type":"Array<String>","label":"Object Types","name":"objectTypes","uiComponent":{"type":"DROPDOWN","options":{"values":["Item","Item Variation","Category","Tax","Discount","Modifier List","Modifier","Image"]}},"description":"Limit the search to these catalog object types. Defaults to all types."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum results per page (1-1000). Defaults to 100."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor returned by a previous Search Catalog call."}
   * @returns {Object}
   * @sampleResult {"objects":[{"type":"ITEM","id":"W62UWFY35CWMYGVWK6TWJDNI","item_data":{"name":"Coffee","variations":[{"type":"ITEM_VARIATION","id":"6ULWO3OAML6K2NThZLDYGNXR","item_variation_data":{"price_money":{"amount":350,"currency":"USD"}}}]}}],"cursor":"bXkgY3Vyc29y"}
   */
  async searchCatalog(textFilter, objectTypes, limit, cursor) {
    const body = clean({
      object_types: this.#catalogTypes(objectTypes),
      limit,
      cursor,
    })

    if (textFilter) {
      body.query = { text_query: { keywords: String(textFilter).split(/\s+/).filter(Boolean).slice(0, 3) } }
    }

    return await this.#apiRequest({
      logTag: '[searchCatalog]',
      path: '/v2/catalog/search',
      method: 'post',
      body,
    })
  }

  /**
   * @operationName Get Catalog Info
   * @category Catalog
   * @description Retrieves information about the Square Catalog API for the account, including batch size limits for catalog operations and the standard-unit measurement metadata.
   * @route GET /get-catalog-info
   * @returns {Object}
   * @sampleResult {"limits":{"batch_upsert_max_objects_per_batch":1000,"batch_upsert_max_total_objects":10000,"batch_retrieve_max_object_ids":1000,"search_max_page_limit":1000,"batch_delete_max_object_ids":200},"standard_unit_description_group":{"language_code":"en-US"}}
   */
  async getCatalogInfo() {
    return await this.#apiRequest({
      logTag: '[getCatalogInfo]',
      path: '/v2/catalog/info',
    })
  }

  // ==================== CUSTOMERS ====================

  /**
   * @typedef {Object} CustomerAddress
   * @paramDef {"type":"String","label":"Address Line 1","name":"addressLine1","description":"First line of the street address."}
   * @paramDef {"type":"String","label":"Address Line 2","name":"addressLine2","description":"Second line of the street address (apartment, suite, etc.)."}
   * @paramDef {"type":"String","label":"City","name":"locality","description":"City or town."}
   * @paramDef {"type":"String","label":"State / Province","name":"administrativeDistrictLevel1","description":"State, province or region code, e.g. GA."}
   * @paramDef {"type":"String","label":"Postal Code","name":"postalCode","description":"Postal or ZIP code."}
   * @paramDef {"type":"String","label":"Country","name":"country","description":"Two-letter ISO 3166 country code, e.g. US."}
   */

  #buildAddress(address) {
    if (!address) {
      return undefined
    }

    const result = clean({
      address_line_1: address.addressLine1,
      address_line_2: address.addressLine2,
      locality: address.locality,
      administrative_district_level_1: address.administrativeDistrictLevel1,
      postal_code: address.postalCode,
      country: address.country,
    })

    return Object.keys(result).length ? result : undefined
  }

  /**
   * @operationName List Customers
   * @category Customers
   * @description Lists customer profiles of the account with optional sorting by creation date or by default alphabetical order. Results are paginated with a cursor; pass the returned cursor to fetch the next page.
   * @route GET /list-customers
   * @paramDef {"type":"String","label":"Sort Field","name":"sortField","uiComponent":{"type":"DROPDOWN","options":{"values":["Default","Created At"]}},"description":"Sort by the default alphanumeric ordering or by creation date. Defaults to Default."}
   * @paramDef {"type":"String","label":"Sort Order","name":"sortOrder","uiComponent":{"type":"DROPDOWN","options":{"values":["Ascending","Descending"]}},"description":"Sort direction. Defaults to Ascending."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum results per page (1-100). Defaults to 100."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor returned by a previous List Customers call."}
   * @returns {Object}
   * @sampleResult {"customers":[{"id":"JDKYHBWT1D4F8MFH63DBMEN8Y4","given_name":"Amelia","family_name":"Earhart","email_address":"amelia@example.com","phone_number":"+14155551234","created_at":"2026-01-15T10:00:00.000Z","version":2}],"cursor":"bXkgY3Vyc29y"}
   */
  async listCustomers(sortField, sortOrder, limit, cursor) {
    return await this.#apiRequest({
      logTag: '[listCustomers]',
      path: '/v2/customers',
      query: {
        sort_field: this.#resolveChoice(sortField, { 'Default': 'DEFAULT', 'Created At': 'CREATED_AT' }),
        sort_order: this.#sortOrder(sortOrder),
        limit,
        cursor,
      },
    })
  }

  /**
   * @operationName Get Customer
   * @category Customers
   * @description Retrieves full details of a customer profile by its ID, including name, contact information, address, note, creation source and the version number needed for updates.
   * @route GET /get-customer
   * @paramDef {"type":"String","label":"Customer","name":"customerId","required":true,"dictionary":"getCustomersDictionary","description":"The ID of the customer to retrieve."}
   * @returns {Object}
   * @sampleResult {"customer":{"id":"JDKYHBWT1D4F8MFH63DBMEN8Y4","given_name":"Amelia","family_name":"Earhart","email_address":"amelia@example.com","phone_number":"+14155551234","reference_id":"YOUR-REF-123","note":"VIP customer","version":2}}
   */
  async getCustomer(customerId) {
    return await this.#apiRequest({
      logTag: '[getCustomer]',
      path: `/v2/customers/${ encodeURIComponent(customerId) }`,
    })
  }

  /**
   * @operationName Create Customer
   * @category Customers
   * @description Creates a customer profile. At least one of first name, last name, company name, email address or phone number must be provided. Phone numbers must be valid and include the country code, e.g. +14155551234. An idempotency key is generated automatically unless you provide one.
   * @route POST /create-customer
   * @paramDef {"type":"String","label":"First Name","name":"givenName","description":"The customer's first name."}
   * @paramDef {"type":"String","label":"Last Name","name":"familyName","description":"The customer's last name."}
   * @paramDef {"type":"String","label":"Company Name","name":"companyName","description":"The customer's company name."}
   * @paramDef {"type":"String","label":"Email Address","name":"emailAddress","description":"The customer's email address."}
   * @paramDef {"type":"String","label":"Phone Number","name":"phoneNumber","description":"The customer's phone number including country code, e.g. +14155551234."}
   * @paramDef {"type":"CustomerAddress","label":"Address","name":"address","description":"The customer's physical address."}
   * @paramDef {"type":"String","label":"Reference ID","name":"referenceId","description":"Your own reference for the customer, e.g. an ID from another system."}
   * @paramDef {"type":"String","label":"Note","name":"note","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"A note about the customer, visible in the Seller Dashboard."}
   * @paramDef {"type":"String","label":"Idempotency Key","name":"idempotencyKey","description":"Optional idempotency key to safely retry the request. Auto-generated when omitted."}
   * @returns {Object}
   * @sampleResult {"customer":{"id":"JDKYHBWT1D4F8MFH63DBMEN8Y4","given_name":"Amelia","family_name":"Earhart","email_address":"amelia@example.com","created_at":"2026-07-01T10:00:00.000Z","version":0}}
   */
  async createCustomer(givenName, familyName, companyName, emailAddress, phoneNumber, address, referenceId, note, idempotencyKey) {
    return await this.#apiRequest({
      logTag: '[createCustomer]',
      path: '/v2/customers',
      method: 'post',
      body: clean({
        idempotency_key: this.#idempotencyKey(idempotencyKey),
        given_name: givenName,
        family_name: familyName,
        company_name: companyName,
        email_address: emailAddress,
        phone_number: phoneNumber,
        address: this.#buildAddress(address),
        reference_id: referenceId,
        note,
      }),
    })
  }

  /**
   * @operationName Update Customer
   * @category Customers
   * @description Updates a customer profile. Only the provided fields are changed; other fields keep their current values. Optionally pass the customer's current version number (from Get Customer) for optimistic concurrency.
   * @route PUT /update-customer
   * @paramDef {"type":"String","label":"Customer","name":"customerId","required":true,"dictionary":"getCustomersDictionary","description":"The ID of the customer to update."}
   * @paramDef {"type":"String","label":"First Name","name":"givenName","description":"New first name."}
   * @paramDef {"type":"String","label":"Last Name","name":"familyName","description":"New last name."}
   * @paramDef {"type":"String","label":"Company Name","name":"companyName","description":"New company name."}
   * @paramDef {"type":"String","label":"Email Address","name":"emailAddress","description":"New email address."}
   * @paramDef {"type":"String","label":"Phone Number","name":"phoneNumber","description":"New phone number including country code, e.g. +14155551234."}
   * @paramDef {"type":"CustomerAddress","label":"Address","name":"address","description":"New physical address."}
   * @paramDef {"type":"String","label":"Reference ID","name":"referenceId","description":"New reference ID."}
   * @paramDef {"type":"String","label":"Note","name":"note","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New note about the customer."}
   * @paramDef {"type":"Number","label":"Version","name":"version","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The customer's current version number from Get Customer. The update fails if it does not match."}
   * @returns {Object}
   * @sampleResult {"customer":{"id":"JDKYHBWT1D4F8MFH63DBMEN8Y4","given_name":"Amelia","family_name":"Earhart","email_address":"new-email@example.com","updated_at":"2026-07-02T10:00:00.000Z","version":3}}
   */
  async updateCustomer(customerId, givenName, familyName, companyName, emailAddress, phoneNumber, address, referenceId, note, version) {
    return await this.#apiRequest({
      logTag: '[updateCustomer]',
      path: `/v2/customers/${ encodeURIComponent(customerId) }`,
      method: 'put',
      body: clean({
        given_name: givenName,
        family_name: familyName,
        company_name: companyName,
        email_address: emailAddress,
        phone_number: phoneNumber,
        address: this.#buildAddress(address),
        reference_id: referenceId,
        note,
        version,
      }),
    })
  }

  /**
   * @operationName Delete Customer
   * @category Customers
   * @description Permanently deletes a customer profile. Optionally pass the customer's current version number for optimistic concurrency. Deleting a customer does not delete their linked payments or orders.
   * @route DELETE /delete-customer
   * @paramDef {"type":"String","label":"Customer","name":"customerId","required":true,"dictionary":"getCustomersDictionary","description":"The ID of the customer to delete."}
   * @paramDef {"type":"Number","label":"Version","name":"version","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The customer's current version number from Get Customer. The deletion fails if it does not match."}
   * @returns {Object}
   * @sampleResult {}
   */
  async deleteCustomer(customerId, version) {
    return await this.#apiRequest({
      logTag: '[deleteCustomer]',
      path: `/v2/customers/${ encodeURIComponent(customerId) }`,
      method: 'delete',
      query: { version },
    })
  }

  /**
   * @operationName Search Customers
   * @category Customers
   * @description Searches customer profiles by email address, phone number and/or reference ID using exact or fuzzy matching. Fuzzy matching finds records with any sequence of the query characters (e.g. "amel" matches amelia@example.com). Results can be sorted by creation date and are paginated with a cursor.
   * @route POST /search-customers
   * @paramDef {"type":"String","label":"Email Address","name":"emailAddress","description":"Email address to search for."}
   * @paramDef {"type":"String","label":"Phone Number","name":"phoneNumber","description":"Phone number to search for. For exact matching include the country code, e.g. +14155551234."}
   * @paramDef {"type":"String","label":"Reference ID","name":"referenceId","description":"Reference ID to search for."}
   * @paramDef {"type":"String","label":"Match Type","name":"matchType","uiComponent":{"type":"DROPDOWN","options":{"values":["Exact","Fuzzy"]}},"description":"Whether search values must match exactly or fuzzily (substring-like matching). Defaults to Fuzzy."}
   * @paramDef {"type":"String","label":"Sort Order","name":"sortOrder","uiComponent":{"type":"DROPDOWN","options":{"values":["Ascending","Descending"]}},"description":"Sort direction by creation date. Defaults to Ascending (oldest first)."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum results per page (1-100). Defaults to 100."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor returned by a previous Search Customers call."}
   * @returns {Object}
   * @sampleResult {"customers":[{"id":"JDKYHBWT1D4F8MFH63DBMEN8Y4","given_name":"Amelia","family_name":"Earhart","email_address":"amelia@example.com","created_at":"2026-01-15T10:00:00.000Z"}],"cursor":"bXkgY3Vyc29y"}
   */
  async searchCustomers(emailAddress, phoneNumber, referenceId, matchType, sortOrder, limit, cursor) {
    const matchKey = this.#resolveChoice(matchType, { 'Exact': 'exact', 'Fuzzy': 'fuzzy' }) || 'fuzzy'
    const filter = {}

    if (emailAddress) {
      filter.email_address = { [matchKey]: emailAddress }
    }

    if (phoneNumber) {
      filter.phone_number = { [matchKey]: phoneNumber }
    }

    if (referenceId) {
      filter.reference_id = { [matchKey]: referenceId }
    }

    const query = {}

    if (Object.keys(filter).length) {
      query.filter = filter
    }

    if (sortOrder) {
      query.sort = { field: 'CREATED_AT', order: this.#sortOrder(sortOrder) }
    }

    return await this.#apiRequest({
      logTag: '[searchCustomers]',
      path: '/v2/customers/search',
      method: 'post',
      body: clean({
        query: Object.keys(query).length ? query : undefined,
        limit,
        cursor,
      }),
    })
  }

  // ==================== CARDS ====================

  /**
   * @operationName Create Card
   * @category Cards
   * @description Saves a card on file for a customer so it can be charged later with Create Payment. The source is the ID of an existing payment made with the card (or a payment token from Square's Web Payments SDK). An idempotency key is generated automatically unless you provide one.
   * @route POST /create-card
   * @paramDef {"type":"String","label":"Source ID","name":"sourceId","required":true,"description":"The ID of a payment made with the card to save, or a payment token generated by the Web Payments SDK."}
   * @paramDef {"type":"String","label":"Customer","name":"customerId","required":true,"dictionary":"getCustomersDictionary","description":"The customer to save the card for."}
   * @paramDef {"type":"String","label":"Cardholder Name","name":"cardholderName","description":"The name of the cardholder, e.g. \"Amelia Earhart\"."}
   * @paramDef {"type":"String","label":"Reference ID","name":"referenceId","description":"Your own reference for the card, e.g. an ID from another system."}
   * @paramDef {"type":"String","label":"Idempotency Key","name":"idempotencyKey","description":"Optional idempotency key to safely retry the request. Auto-generated when omitted."}
   * @returns {Object}
   * @sampleResult {"card":{"id":"ccof:uIbfJXhXETSP197M3GB","customer_id":"JDKYHBWT1D4F8MFH63DBMEN8Y4","cardholder_name":"Amelia Earhart","card_brand":"VISA","last_4":"1111","exp_month":11,"exp_year":2028,"enabled":true,"version":1}}
   */
  async createCard(sourceId, customerId, cardholderName, referenceId, idempotencyKey) {
    return await this.#apiRequest({
      logTag: '[createCard]',
      path: '/v2/cards',
      method: 'post',
      body: {
        idempotency_key: this.#idempotencyKey(idempotencyKey),
        source_id: sourceId,
        card: clean({
          customer_id: customerId,
          cardholder_name: cardholderName,
          reference_id: referenceId,
        }),
      },
    })
  }

  /**
   * @operationName List Cards
   * @category Cards
   * @description Lists cards on file, optionally limited to a single customer and optionally including disabled cards. Results are paginated with a cursor.
   * @route GET /list-cards
   * @paramDef {"type":"String","label":"Customer","name":"customerId","dictionary":"getCustomersDictionary","description":"Only list cards on file for this customer. Defaults to all customers."}
   * @paramDef {"type":"Boolean","label":"Include Disabled","name":"includeDisabled","uiComponent":{"type":"CHECKBOX"},"description":"Also include disabled cards. Defaults to enabled cards only."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor returned by a previous List Cards call."}
   * @returns {Object}
   * @sampleResult {"cards":[{"id":"ccof:uIbfJXhXETSP197M3GB","customer_id":"JDKYHBWT1D4F8MFH63DBMEN8Y4","card_brand":"VISA","last_4":"1111","exp_month":11,"exp_year":2028,"enabled":true}],"cursor":"bXkgY3Vyc29y"}
   */
  async listCards(customerId, includeDisabled, cursor) {
    return await this.#apiRequest({
      logTag: '[listCards]',
      path: '/v2/cards',
      query: {
        customer_id: customerId,
        include_disabled: includeDisabled === true ? 'true' : undefined,
        cursor,
      },
    })
  }

  /**
   * @operationName Get Card
   * @category Cards
   * @description Retrieves details of a card on file by its ID, including brand, last 4 digits, expiration, billing address, linked customer and enabled status. Full card numbers are never returned.
   * @route GET /get-card
   * @paramDef {"type":"String","label":"Card ID","name":"cardId","required":true,"description":"The ID of the card to retrieve, e.g. ccof:uIbfJXhXETSP197M3GB."}
   * @returns {Object}
   * @sampleResult {"card":{"id":"ccof:uIbfJXhXETSP197M3GB","customer_id":"JDKYHBWT1D4F8MFH63DBMEN8Y4","cardholder_name":"Amelia Earhart","card_brand":"VISA","last_4":"1111","exp_month":11,"exp_year":2028,"card_type":"CREDIT","enabled":true,"version":1}}
   */
  async getCard(cardId) {
    return await this.#apiRequest({
      logTag: '[getCard]',
      path: `/v2/cards/${ encodeURIComponent(cardId) }`,
    })
  }

  /**
   * @operationName Disable Card
   * @category Cards
   * @description Disables a card on file so it can no longer be charged. Disabling a card is permanent; to charge the customer again a new card must be saved with Create Card.
   * @route POST /disable-card
   * @paramDef {"type":"String","label":"Card ID","name":"cardId","required":true,"description":"The ID of the card to disable, e.g. ccof:uIbfJXhXETSP197M3GB."}
   * @returns {Object}
   * @sampleResult {"card":{"id":"ccof:uIbfJXhXETSP197M3GB","customer_id":"JDKYHBWT1D4F8MFH63DBMEN8Y4","card_brand":"VISA","last_4":"1111","enabled":false,"version":2}}
   */
  async disableCard(cardId) {
    return await this.#apiRequest({
      logTag: '[disableCard]',
      path: `/v2/cards/${ encodeURIComponent(cardId) }/disable`,
      method: 'post',
      body: {},
    })
  }

  // ==================== INVOICES ====================

  /**
   * @typedef {Object} InvoiceAcceptedPaymentMethods
   * @paramDef {"type":"Boolean","label":"Card","name":"card","uiComponent":{"type":"CHECKBOX"},"description":"Accept credit or debit card payments."}
   * @paramDef {"type":"Boolean","label":"Square Gift Card","name":"squareGiftCard","uiComponent":{"type":"CHECKBOX"},"description":"Accept Square gift card payments."}
   * @paramDef {"type":"Boolean","label":"Bank Account","name":"bankAccount","uiComponent":{"type":"CHECKBOX"},"description":"Accept ACH bank transfer payments (US only)."}
   * @paramDef {"type":"Boolean","label":"Buy Now Pay Later","name":"buyNowPayLater","uiComponent":{"type":"CHECKBOX"},"description":"Accept Afterpay (buy now, pay later) payments."}
   * @paramDef {"type":"Boolean","label":"Cash App Pay","name":"cashAppPay","uiComponent":{"type":"CHECKBOX"},"description":"Accept Cash App Pay payments."}
   */

  /**
   * @operationName Create Invoice
   * @category Invoices
   * @description Creates a draft invoice for an existing order. The invoice remains a draft until Publish Invoice is called, which sends it (Email delivery) or generates a public payment URL (Share Manually delivery). The full balance is requested by default with an optional due date. An idempotency key is generated automatically unless you provide one.
   * @route POST /create-invoice
   * @paramDef {"type":"String","label":"Location","name":"locationId","required":true,"dictionary":"getLocationsDictionary","description":"The location of the associated order."}
   * @paramDef {"type":"String","label":"Order ID","name":"orderId","required":true,"description":"The ID of the order the invoice bills. Create it first with Create Order."}
   * @paramDef {"type":"String","label":"Customer","name":"customerId","required":true,"dictionary":"getCustomersDictionary","description":"The customer to bill (the invoice's primary recipient)."}
   * @paramDef {"type":"String","label":"Due Date","name":"dueDate","uiComponent":{"type":"DATE_PICKER"},"description":"Payment due date in YYYY-MM-DD format, in the location's timezone. Defaults to the send date."}
   * @paramDef {"type":"String","label":"Request Type","name":"requestType","defaultValue":"Balance","uiComponent":{"type":"DROPDOWN","options":{"values":["Balance","Deposit","Installment"]}},"description":"What the payment request asks for: the full balance, an upfront deposit, or installments. Defaults to Balance."}
   * @paramDef {"type":"String","label":"Delivery Method","name":"deliveryMethod","defaultValue":"Email","uiComponent":{"type":"DROPDOWN","options":{"values":["Email","Share Manually"]}},"description":"How the invoice reaches the customer when published: Square emails it, or you share the payment URL manually. Defaults to Email."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"The title of the invoice, shown to the customer."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"A description of the invoice, shown to the customer under the title."}
   * @paramDef {"type":"String","label":"Invoice Number","name":"invoiceNumber","description":"A user-friendly invoice number (unique within the account). Auto-generated when omitted."}
   * @paramDef {"type":"String","label":"Scheduled At","name":"scheduledAt","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"RFC 3339 timestamp at which Square sends the invoice after publishing. Defaults to sending immediately on publish."}
   * @paramDef {"type":"InvoiceAcceptedPaymentMethods","label":"Accepted Payment Methods","name":"acceptedPaymentMethods","description":"Which payment methods the customer can use to pay the invoice. Defaults to card payments."}
   * @paramDef {"type":"String","label":"Idempotency Key","name":"idempotencyKey","description":"Optional idempotency key to safely retry the request. Auto-generated when omitted."}
   * @returns {Object}
   * @sampleResult {"invoice":{"id":"inv:0-ChCHu2mZEabLeeHahQnXDjZQECY","version":0,"location_id":"L88917AVBK2S5","order_id":"nUSN9TdxpiK3SrQg3wzmf6r8V","status":"DRAFT","invoice_number":"000001","primary_recipient":{"customer_id":"JDKYHBWT1D4F8MFH63DBMEN8Y4"},"payment_requests":[{"request_type":"BALANCE","due_date":"2026-08-01"}],"delivery_method":"EMAIL"}}
   */
  async createInvoice(
    locationId, orderId, customerId, dueDate, requestType, deliveryMethod, title,
    description, invoiceNumber, scheduledAt, acceptedPaymentMethods, idempotencyKey
  ) {
    const invoice = clean({
      location_id: locationId,
      order_id: orderId,
      primary_recipient: { customer_id: customerId },
      payment_requests: [clean({
        request_type: this.#resolveChoice(requestType, {
          'Balance': 'BALANCE',
          'Deposit': 'DEPOSIT',
          'Installment': 'INSTALLMENT',
        }) || 'BALANCE',
        due_date: dueDate,
      })],
      delivery_method: this.#resolveChoice(deliveryMethod, {
        'Email': 'EMAIL',
        'Share Manually': 'SHARE_MANUALLY',
      }) || 'EMAIL',
      title,
      description,
      invoice_number: invoiceNumber,
      scheduled_at: scheduledAt,
    })

    if (acceptedPaymentMethods) {
      invoice.accepted_payment_methods = clean({
        card: acceptedPaymentMethods.card,
        square_gift_card: acceptedPaymentMethods.squareGiftCard,
        bank_account: acceptedPaymentMethods.bankAccount,
        buy_now_pay_later: acceptedPaymentMethods.buyNowPayLater,
        cash_app_pay: acceptedPaymentMethods.cashAppPay,
      })
    }

    return await this.#apiRequest({
      logTag: '[createInvoice]',
      path: '/v2/invoices',
      method: 'post',
      body: {
        idempotency_key: this.#idempotencyKey(idempotencyKey),
        invoice,
      },
    })
  }

  /**
   * @operationName List Invoices
   * @category Invoices
   * @description Lists invoices for a location, most recently created first. Results are paginated with a cursor; pass the returned cursor to fetch the next page.
   * @route GET /list-invoices
   * @paramDef {"type":"String","label":"Location","name":"locationId","required":true,"dictionary":"getLocationsDictionary","description":"The location whose invoices to list."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum results per page (1-200). Defaults to 100."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor returned by a previous List Invoices call."}
   * @returns {Object}
   * @sampleResult {"invoices":[{"id":"inv:0-ChCHu2mZEabLeeHahQnXDjZQECY","version":2,"location_id":"L88917AVBK2S5","order_id":"nUSN9TdxpiK3SrQg3wzmf6r8V","status":"UNPAID","invoice_number":"000001","public_url":"https://squareup.com/pay-invoice/inv:0-ChCHu2mZEabLeeHahQnXDjZQECY"}],"cursor":"bXkgY3Vyc29y"}
   */
  async listInvoices(locationId, limit, cursor) {
    return await this.#apiRequest({
      logTag: '[listInvoices]',
      path: '/v2/invoices',
      query: {
        location_id: locationId,
        limit,
        cursor,
      },
    })
  }

  /**
   * @operationName Get Invoice
   * @category Invoices
   * @description Retrieves full details of an invoice by its ID, including status, payment requests, delivery method, public URL (after publishing) and the version number needed for updates.
   * @route GET /get-invoice
   * @paramDef {"type":"String","label":"Invoice ID","name":"invoiceId","required":true,"description":"The ID of the invoice to retrieve, e.g. inv:0-ChCHu2mZEabLeeHahQnXDjZQECY."}
   * @returns {Object}
   * @sampleResult {"invoice":{"id":"inv:0-ChCHu2mZEabLeeHahQnXDjZQECY","version":2,"location_id":"L88917AVBK2S5","status":"UNPAID","invoice_number":"000001","payment_requests":[{"request_type":"BALANCE","due_date":"2026-08-01","computed_amount_money":{"amount":700,"currency":"USD"}}],"public_url":"https://squareup.com/pay-invoice/inv:0-ChCHu2mZEabLeeHahQnXDjZQECY"}}
   */
  async getInvoice(invoiceId) {
    return await this.#apiRequest({
      logTag: '[getInvoice]',
      path: `/v2/invoices/${ encodeURIComponent(invoiceId) }`,
    })
  }

  /**
   * @operationName Update Invoice
   * @category Invoices
   * @description Updates a draft or published invoice using sparse updates: pass only the fields to change in the Invoice object (Square API format, snake_case) and list fields to remove in Fields To Clear. Requires the invoice's current version number from Get Invoice. Published invoices only allow limited changes.
   * @route PUT /update-invoice
   * @paramDef {"type":"String","label":"Invoice ID","name":"invoiceId","required":true,"description":"The ID of the invoice to update."}
   * @paramDef {"type":"Number","label":"Version","name":"version","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The invoice's current version number from Get Invoice. The update fails if it does not match."}
   * @paramDef {"type":"Object","label":"Invoice","name":"invoice","description":"Sparse Invoice object with only the fields to change, in Square API format, e.g. {\"title\":\"Updated title\"}."}
   * @paramDef {"type":"Array<String>","label":"Fields To Clear","name":"fieldsToClear","description":"Names of invoice fields to clear, e.g. description or scheduled_at."}
   * @paramDef {"type":"String","label":"Idempotency Key","name":"idempotencyKey","description":"Optional idempotency key to safely retry the request. Auto-generated when omitted."}
   * @returns {Object}
   * @sampleResult {"invoice":{"id":"inv:0-ChCHu2mZEabLeeHahQnXDjZQECY","version":3,"location_id":"L88917AVBK2S5","status":"DRAFT","title":"Updated title","invoice_number":"000001"}}
   */
  async updateInvoice(invoiceId, version, invoice, fieldsToClear, idempotencyKey) {
    return await this.#apiRequest({
      logTag: '[updateInvoice]',
      path: `/v2/invoices/${ encodeURIComponent(invoiceId) }`,
      method: 'put',
      body: clean({
        idempotency_key: this.#idempotencyKey(idempotencyKey),
        invoice: { ...(invoice || {}), version },
        fields_to_clear: Array.isArray(fieldsToClear) && fieldsToClear.length ? fieldsToClear : undefined,
      }),
    })
  }

  /**
   * @operationName Publish Invoice
   * @category Invoices
   * @description Publishes a draft invoice, changing its status from DRAFT and making it payable. Depending on the delivery method, Square emails the invoice to the customer or returns a public payment URL to share manually. Requires the invoice's current version number. An idempotency key is generated automatically unless you provide one.
   * @route POST /publish-invoice
   * @paramDef {"type":"String","label":"Invoice ID","name":"invoiceId","required":true,"description":"The ID of the draft invoice to publish."}
   * @paramDef {"type":"Number","label":"Version","name":"version","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The invoice's current version number from Get Invoice or Create Invoice."}
   * @paramDef {"type":"String","label":"Idempotency Key","name":"idempotencyKey","description":"Optional idempotency key to safely retry the request. Auto-generated when omitted."}
   * @returns {Object}
   * @sampleResult {"invoice":{"id":"inv:0-ChCHu2mZEabLeeHahQnXDjZQECY","version":1,"status":"UNPAID","invoice_number":"000001","public_url":"https://squareup.com/pay-invoice/inv:0-ChCHu2mZEabLeeHahQnXDjZQECY","next_payment_amount_money":{"amount":700,"currency":"USD"}}}
   */
  async publishInvoice(invoiceId, version, idempotencyKey) {
    return await this.#apiRequest({
      logTag: '[publishInvoice]',
      path: `/v2/invoices/${ encodeURIComponent(invoiceId) }/publish`,
      method: 'post',
      body: {
        version,
        idempotency_key: this.#idempotencyKey(idempotencyKey),
      },
    })
  }

  /**
   * @operationName Cancel Invoice
   * @category Invoices
   * @description Cancels a published invoice so it can no longer be paid. The customer is notified when applicable. Invoices that are already paid, refunded, canceled or failed cannot be canceled. Requires the invoice's current version number.
   * @route POST /cancel-invoice
   * @paramDef {"type":"String","label":"Invoice ID","name":"invoiceId","required":true,"description":"The ID of the published invoice to cancel."}
   * @paramDef {"type":"Number","label":"Version","name":"version","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The invoice's current version number from Get Invoice."}
   * @returns {Object}
   * @sampleResult {"invoice":{"id":"inv:0-ChCHu2mZEabLeeHahQnXDjZQECY","version":2,"status":"CANCELED","invoice_number":"000001"}}
   */
  async cancelInvoice(invoiceId, version) {
    return await this.#apiRequest({
      logTag: '[cancelInvoice]',
      path: `/v2/invoices/${ encodeURIComponent(invoiceId) }/cancel`,
      method: 'post',
      body: { version },
    })
  }

  /**
   * @operationName Delete Invoice
   * @category Invoices
   * @description Permanently deletes a DRAFT invoice. Published invoices cannot be deleted; cancel them instead with Cancel Invoice. Deleting the invoice also removes its association with the order.
   * @route DELETE /delete-invoice
   * @paramDef {"type":"String","label":"Invoice ID","name":"invoiceId","required":true,"description":"The ID of the draft invoice to delete."}
   * @paramDef {"type":"Number","label":"Version","name":"version","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The invoice's current version number. Defaults to the latest version."}
   * @returns {Object}
   * @sampleResult {}
   */
  async deleteInvoice(invoiceId, version) {
    return await this.#apiRequest({
      logTag: '[deleteInvoice]',
      path: `/v2/invoices/${ encodeURIComponent(invoiceId) }`,
      method: 'delete',
      query: { version },
    })
  }

  /**
   * @operationName Search Invoices
   * @category Invoices
   * @description Searches invoices by location and optionally by customer, sorted by invoice date (newest first by default). Square currently requires exactly one location ID in the filter. Results are paginated with a cursor.
   * @route POST /search-invoices
   * @paramDef {"type":"Array<String>","label":"Locations","name":"locationIds","required":true,"description":"Location IDs to filter by. Square currently supports exactly one location ID."}
   * @paramDef {"type":"Array<String>","label":"Customers","name":"customerIds","description":"Only return invoices for these customer IDs."}
   * @paramDef {"type":"String","label":"Sort Order","name":"sortOrder","uiComponent":{"type":"DROPDOWN","options":{"values":["Ascending","Descending"]}},"description":"Sort direction by invoice date. Defaults to Descending (newest first)."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum results per page (1-200). Defaults to 100."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor returned by a previous Search Invoices call."}
   * @returns {Object}
   * @sampleResult {"invoices":[{"id":"inv:0-ChCHu2mZEabLeeHahQnXDjZQECY","version":2,"location_id":"L88917AVBK2S5","status":"UNPAID","invoice_number":"000001","primary_recipient":{"customer_id":"JDKYHBWT1D4F8MFH63DBMEN8Y4"}}],"cursor":"bXkgY3Vyc29y"}
   */
  async searchInvoices(locationIds, customerIds, sortOrder, limit, cursor) {
    return await this.#apiRequest({
      logTag: '[searchInvoices]',
      path: '/v2/invoices/search',
      method: 'post',
      body: clean({
        query: {
          filter: clean({
            location_ids: locationIds,
            customer_ids: Array.isArray(customerIds) && customerIds.length ? customerIds : undefined,
          }),
          sort: {
            field: 'INVOICE_SORT_DATE',
            order: this.#sortOrder(sortOrder) || 'DESC',
          },
        },
        limit,
        cursor,
      }),
    })
  }

  // ==================== INVENTORY ====================

  /**
   * @operationName Get Inventory Count
   * @category Inventory
   * @description Retrieves the current calculated stock counts of a catalog item variation, optionally limited to specific locations. Quantities are returned as decimal strings per location and state (e.g. IN_STOCK). Results are paginated with a cursor.
   * @route GET /get-inventory-count
   * @paramDef {"type":"String","label":"Catalog Object ID","name":"catalogObjectId","required":true,"description":"The ID of the catalog ITEM_VARIATION to get counts for."}
   * @paramDef {"type":"Array<String>","label":"Locations","name":"locationIds","description":"Only return counts at these location IDs. Defaults to all locations."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor returned by a previous Get Inventory Count call."}
   * @returns {Object}
   * @sampleResult {"counts":[{"catalog_object_id":"6ULWO3OAML6K2NThZLDYGNXR","catalog_object_type":"ITEM_VARIATION","state":"IN_STOCK","location_id":"L88917AVBK2S5","quantity":"22","calculated_at":"2026-07-01T12:00:00.000Z"}]}
   */
  async getInventoryCount(catalogObjectId, locationIds, cursor) {
    return await this.#apiRequest({
      logTag: '[getInventoryCount]',
      path: `/v2/inventory/${ encodeURIComponent(catalogObjectId) }`,
      query: {
        location_ids: Array.isArray(locationIds) && locationIds.length ? locationIds.join(',') : undefined,
        cursor,
      },
    })
  }

  /**
   * @operationName Batch Retrieve Inventory Counts
   * @category Inventory
   * @description Retrieves current stock counts for multiple catalog item variations and/or locations in one call. Filters combine as intersections; omit a filter to include everything. Results are paginated with a cursor.
   * @route POST /batch-retrieve-inventory-counts
   * @paramDef {"type":"Array<String>","label":"Catalog Object IDs","name":"catalogObjectIds","description":"IDs of catalog ITEM_VARIATION objects to get counts for. Defaults to all."}
   * @paramDef {"type":"Array<String>","label":"Locations","name":"locationIds","description":"Only return counts at these location IDs. Defaults to all locations."}
   * @paramDef {"type":"String","label":"Updated After","name":"updatedAfter","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Only return counts calculated after this RFC 3339 timestamp."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor returned by a previous Batch Retrieve Inventory Counts call."}
   * @returns {Object}
   * @sampleResult {"counts":[{"catalog_object_id":"6ULWO3OAML6K2NThZLDYGNXR","catalog_object_type":"ITEM_VARIATION","state":"IN_STOCK","location_id":"L88917AVBK2S5","quantity":"22","calculated_at":"2026-07-01T12:00:00.000Z"}],"cursor":"bXkgY3Vyc29y"}
   */
  async batchRetrieveInventoryCounts(catalogObjectIds, locationIds, updatedAfter, cursor) {
    return await this.#apiRequest({
      logTag: '[batchRetrieveInventoryCounts]',
      path: '/v2/inventory/counts/batch-retrieve',
      method: 'post',
      body: clean({
        catalog_object_ids: Array.isArray(catalogObjectIds) && catalogObjectIds.length ? catalogObjectIds : undefined,
        location_ids: Array.isArray(locationIds) && locationIds.length ? locationIds : undefined,
        updated_after: updatedAfter,
        cursor,
      }),
    })
  }

  /**
   * @operationName Adjust Inventory
   * @category Inventory
   * @description Records an inventory adjustment that moves a quantity of a catalog item variation from one state to another at a location, e.g. from In Stock to Sold, or from None to In Stock to receive new stock. The quantity is a positive number. An idempotency key is generated automatically unless you provide one.
   * @route POST /adjust-inventory
   * @paramDef {"type":"String","label":"Catalog Object ID","name":"catalogObjectId","required":true,"description":"The ID of the catalog ITEM_VARIATION to adjust."}
   * @paramDef {"type":"String","label":"Location","name":"locationId","required":true,"dictionary":"getLocationsDictionary","description":"The location where the adjustment happens."}
   * @paramDef {"type":"Number","label":"Quantity","name":"quantity","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The quantity to move between states, as a positive number."}
   * @paramDef {"type":"String","label":"From State","name":"fromState","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["None","In Stock","Sold","Waste","Received From Vendor","Returned By Customer"]}},"description":"The state the quantity moves out of. Use None when receiving new stock."}
   * @paramDef {"type":"String","label":"To State","name":"toState","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["None","In Stock","Sold","Waste","Received From Vendor","Returned By Customer"]}},"description":"The state the quantity moves into, e.g. In Stock."}
   * @paramDef {"type":"String","label":"Occurred At","name":"occurredAt","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"RFC 3339 timestamp when the adjustment took place. Defaults to now."}
   * @paramDef {"type":"String","label":"Idempotency Key","name":"idempotencyKey","description":"Optional idempotency key to safely retry the request. Auto-generated when omitted."}
   * @returns {Object}
   * @sampleResult {"counts":[{"catalog_object_id":"6ULWO3OAML6K2NThZLDYGNXR","catalog_object_type":"ITEM_VARIATION","state":"IN_STOCK","location_id":"L88917AVBK2S5","quantity":"27","calculated_at":"2026-07-01T12:00:00.000Z"}]}
   */
  async adjustInventory(catalogObjectId, locationId, quantity, fromState, toState, occurredAt, idempotencyKey) {
    return await this.#apiRequest({
      logTag: '[adjustInventory]',
      path: '/v2/inventory/changes/batch-create',
      method: 'post',
      body: {
        idempotency_key: this.#idempotencyKey(idempotencyKey),
        changes: [{
          type: 'ADJUSTMENT',
          adjustment: {
            catalog_object_id: catalogObjectId,
            location_id: locationId,
            from_state: this.#inventoryState(fromState),
            to_state: this.#inventoryState(toState),
            quantity: String(quantity),
            occurred_at: occurredAt || new Date().toISOString(),
          },
        }],
      },
    })
  }

  /**
   * @operationName Record Physical Count
   * @category Inventory
   * @description Records a physical count of a catalog item variation at a location, setting the absolute quantity on hand for the given state (In Stock by default). Use this after a stocktake to overwrite the calculated quantity. An idempotency key is generated automatically unless you provide one.
   * @route POST /record-physical-count
   * @paramDef {"type":"String","label":"Catalog Object ID","name":"catalogObjectId","required":true,"description":"The ID of the catalog ITEM_VARIATION that was counted."}
   * @paramDef {"type":"String","label":"Location","name":"locationId","required":true,"dictionary":"getLocationsDictionary","description":"The location where the count was taken."}
   * @paramDef {"type":"Number","label":"Quantity","name":"quantity","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The absolute counted quantity on hand."}
   * @paramDef {"type":"String","label":"State","name":"state","defaultValue":"In Stock","uiComponent":{"type":"DROPDOWN","options":{"values":["In Stock","Sold","Waste","Received From Vendor","Returned By Customer"]}},"description":"The inventory state the count applies to. Defaults to In Stock."}
   * @paramDef {"type":"String","label":"Occurred At","name":"occurredAt","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"RFC 3339 timestamp when the count was taken. Defaults to now."}
   * @paramDef {"type":"String","label":"Idempotency Key","name":"idempotencyKey","description":"Optional idempotency key to safely retry the request. Auto-generated when omitted."}
   * @returns {Object}
   * @sampleResult {"counts":[{"catalog_object_id":"6ULWO3OAML6K2NThZLDYGNXR","catalog_object_type":"ITEM_VARIATION","state":"IN_STOCK","location_id":"L88917AVBK2S5","quantity":"50","calculated_at":"2026-07-01T12:00:00.000Z"}]}
   */
  async recordPhysicalCount(catalogObjectId, locationId, quantity, state, occurredAt, idempotencyKey) {
    return await this.#apiRequest({
      logTag: '[recordPhysicalCount]',
      path: '/v2/inventory/changes/batch-create',
      method: 'post',
      body: {
        idempotency_key: this.#idempotencyKey(idempotencyKey),
        changes: [{
          type: 'PHYSICAL_COUNT',
          physical_count: {
            catalog_object_id: catalogObjectId,
            location_id: locationId,
            state: this.#inventoryState(state) || 'IN_STOCK',
            quantity: String(quantity),
            occurred_at: occurredAt || new Date().toISOString(),
          },
        }],
      },
    })
  }

  // ==================== SUBSCRIPTIONS ====================

  /**
   * @operationName Create Subscription
   * @category Subscriptions
   * @description Enrolls a customer in a subscription plan variation at a location. If a card on file is provided, Square charges it automatically each billing period; otherwise the customer is invoiced. The start date defaults to today. An idempotency key is generated automatically unless you provide one.
   * @route POST /create-subscription
   * @paramDef {"type":"String","label":"Location","name":"locationId","required":true,"dictionary":"getLocationsDictionary","description":"The location the subscription is associated with."}
   * @paramDef {"type":"String","label":"Plan Variation ID","name":"planVariationId","required":true,"description":"The ID of the SUBSCRIPTION_PLAN_VARIATION catalog object to subscribe the customer to."}
   * @paramDef {"type":"String","label":"Customer","name":"customerId","required":true,"dictionary":"getCustomersDictionary","description":"The customer to enroll in the subscription."}
   * @paramDef {"type":"String","label":"Start Date","name":"startDate","uiComponent":{"type":"DATE_PICKER"},"description":"Start date in YYYY-MM-DD format. Defaults to today."}
   * @paramDef {"type":"String","label":"Card ID","name":"cardId","description":"A card on file of the customer to charge automatically each billing period. When omitted the customer is invoiced instead."}
   * @paramDef {"type":"String","label":"Timezone","name":"timezone","description":"IANA timezone for billing dates, e.g. America/New_York. Defaults to the location's timezone."}
   * @paramDef {"type":"String","label":"Idempotency Key","name":"idempotencyKey","description":"Optional idempotency key to safely retry the request. Auto-generated when omitted."}
   * @returns {Object}
   * @sampleResult {"subscription":{"id":"56214fb2-cc85-47a1-93bc-44f3766bb56f","location_id":"L88917AVBK2S5","plan_variation_id":"6JHXF3B2CW3YKHDV4XEM674H","customer_id":"JDKYHBWT1D4F8MFH63DBMEN8Y4","status":"ACTIVE","start_date":"2026-07-01","version":1}}
   */
  async createSubscription(locationId, planVariationId, customerId, startDate, cardId, timezone, idempotencyKey) {
    return await this.#apiRequest({
      logTag: '[createSubscription]',
      path: '/v2/subscriptions',
      method: 'post',
      body: clean({
        idempotency_key: this.#idempotencyKey(idempotencyKey),
        location_id: locationId,
        plan_variation_id: planVariationId,
        customer_id: customerId,
        start_date: startDate,
        card_id: cardId,
        timezone,
      }),
    })
  }

  /**
   * @operationName Search Subscriptions
   * @category Subscriptions
   * @description Searches subscriptions filtered by customer and/or location. Filters combine as intersections; omit both to list all subscriptions. Results are paginated with a cursor.
   * @route POST /search-subscriptions
   * @paramDef {"type":"Array<String>","label":"Customers","name":"customerIds","description":"Only return subscriptions of these customer IDs."}
   * @paramDef {"type":"Array<String>","label":"Locations","name":"locationIds","description":"Only return subscriptions at these location IDs."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum results per page (1-200). Defaults to 200."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor returned by a previous Search Subscriptions call."}
   * @returns {Object}
   * @sampleResult {"subscriptions":[{"id":"56214fb2-cc85-47a1-93bc-44f3766bb56f","location_id":"L88917AVBK2S5","customer_id":"JDKYHBWT1D4F8MFH63DBMEN8Y4","status":"ACTIVE","start_date":"2026-07-01","version":1}],"cursor":"bXkgY3Vyc29y"}
   */
  async searchSubscriptions(customerIds, locationIds, limit, cursor) {
    const filter = clean({
      customer_ids: Array.isArray(customerIds) && customerIds.length ? customerIds : undefined,
      location_ids: Array.isArray(locationIds) && locationIds.length ? locationIds : undefined,
    })

    return await this.#apiRequest({
      logTag: '[searchSubscriptions]',
      path: '/v2/subscriptions/search',
      method: 'post',
      body: clean({
        query: Object.keys(filter).length ? { filter } : undefined,
        limit,
        cursor,
      }),
    })
  }

  /**
   * @operationName Get Subscription
   * @category Subscriptions
   * @description Retrieves full details of a subscription by its ID, including status, plan variation, billing anchor dates, charged card and the version number needed for updates.
   * @route GET /get-subscription
   * @paramDef {"type":"String","label":"Subscription ID","name":"subscriptionId","required":true,"description":"The ID of the subscription to retrieve."}
   * @returns {Object}
   * @sampleResult {"subscription":{"id":"56214fb2-cc85-47a1-93bc-44f3766bb56f","location_id":"L88917AVBK2S5","plan_variation_id":"6JHXF3B2CW3YKHDV4XEM674H","customer_id":"JDKYHBWT1D4F8MFH63DBMEN8Y4","status":"ACTIVE","start_date":"2026-07-01","charged_through_date":"2026-08-01","version":2}}
   */
  async getSubscription(subscriptionId) {
    return await this.#apiRequest({
      logTag: '[getSubscription]',
      path: `/v2/subscriptions/${ encodeURIComponent(subscriptionId) }`,
    })
  }

  /**
   * @operationName Update Subscription
   * @category Subscriptions
   * @description Updates a subscription using sparse updates: pass only the fields to change in the Subscription object (Square API format, snake_case), e.g. a new card_id. Include the current version from Get Subscription for optimistic concurrency.
   * @route PUT /update-subscription
   * @paramDef {"type":"String","label":"Subscription ID","name":"subscriptionId","required":true,"description":"The ID of the subscription to update."}
   * @paramDef {"type":"Object","label":"Subscription","name":"subscription","required":true,"description":"Sparse Subscription object with only the fields to change, in Square API format, e.g. {\"card_id\":\"ccof:uIbfJXhXETSP197M3GB\"}."}
   * @paramDef {"type":"Number","label":"Version","name":"version","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The subscription's current version number from Get Subscription. The update fails if it does not match."}
   * @returns {Object}
   * @sampleResult {"subscription":{"id":"56214fb2-cc85-47a1-93bc-44f3766bb56f","location_id":"L88917AVBK2S5","status":"ACTIVE","card_id":"ccof:uIbfJXhXETSP197M3GB","version":3}}
   */
  async updateSubscription(subscriptionId, subscription, version) {
    const body = { subscription: { ...(subscription || {}) } }

    if (version !== undefined && version !== null) {
      body.subscription.version = version
    }

    return await this.#apiRequest({
      logTag: '[updateSubscription]',
      path: `/v2/subscriptions/${ encodeURIComponent(subscriptionId) }`,
      method: 'put',
      body,
    })
  }

  /**
   * @operationName Cancel Subscription
   * @category Subscriptions
   * @description Schedules a subscription cancellation at the end of the current billing period (the paid-through date). The subscription stays active until then and no further charges are made.
   * @route POST /cancel-subscription
   * @paramDef {"type":"String","label":"Subscription ID","name":"subscriptionId","required":true,"description":"The ID of the subscription to cancel."}
   * @returns {Object}
   * @sampleResult {"subscription":{"id":"56214fb2-cc85-47a1-93bc-44f3766bb56f","location_id":"L88917AVBK2S5","status":"ACTIVE","canceled_date":"2026-08-01","version":3},"actions":[{"id":"18ff74f4-3da4-30c5-8500-667d5e4d965d","type":"CANCEL","effective_date":"2026-08-01"}]}
   */
  async cancelSubscription(subscriptionId) {
    return await this.#apiRequest({
      logTag: '[cancelSubscription]',
      path: `/v2/subscriptions/${ encodeURIComponent(subscriptionId) }/cancel`,
      method: 'post',
      body: {},
    })
  }

  /**
   * @operationName Pause Subscription
   * @category Subscriptions
   * @description Schedules a pause of a subscription. By default the pause starts at the beginning of the next billing cycle; optionally set an effective date, the number of billing cycles to pause for (indefinite when omitted), and a reason.
   * @route POST /pause-subscription
   * @paramDef {"type":"String","label":"Subscription ID","name":"subscriptionId","required":true,"description":"The ID of the subscription to pause."}
   * @paramDef {"type":"String","label":"Pause Effective Date","name":"pauseEffectiveDate","uiComponent":{"type":"DATE_PICKER"},"description":"YYYY-MM-DD date when the pause takes effect. Defaults to the start of the next billing cycle."}
   * @paramDef {"type":"Number","label":"Pause Cycle Duration","name":"pauseCycleDuration","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of billing cycles to pause for before resuming automatically. Omit to pause indefinitely."}
   * @paramDef {"type":"String","label":"Pause Reason","name":"pauseReason","description":"A reason for the pause (up to 255 characters)."}
   * @returns {Object}
   * @sampleResult {"subscription":{"id":"56214fb2-cc85-47a1-93bc-44f3766bb56f","status":"ACTIVE","version":4},"actions":[{"id":"99b2439e-63f7-3ad5-95f7-ab2447a80673","type":"PAUSE","effective_date":"2026-08-01"}]}
   */
  async pauseSubscription(subscriptionId, pauseEffectiveDate, pauseCycleDuration, pauseReason) {
    return await this.#apiRequest({
      logTag: '[pauseSubscription]',
      path: `/v2/subscriptions/${ encodeURIComponent(subscriptionId) }/pause`,
      method: 'post',
      body: clean({
        pause_effective_date: pauseEffectiveDate,
        pause_cycle_duration: pauseCycleDuration,
        pause_reason: pauseReason,
      }),
    })
  }

  /**
   * @operationName Resume Subscription
   * @category Subscriptions
   * @description Resumes a paused or deactivated subscription, either immediately or at the start of the next billing cycle, optionally on a specific effective date.
   * @route POST /resume-subscription
   * @paramDef {"type":"String","label":"Subscription ID","name":"subscriptionId","required":true,"description":"The ID of the subscription to resume."}
   * @paramDef {"type":"String","label":"Resume Effective Date","name":"resumeEffectiveDate","uiComponent":{"type":"DATE_PICKER"},"description":"YYYY-MM-DD date when the subscription resumes. Defaults to resuming based on the Change Timing setting."}
   * @paramDef {"type":"String","label":"Resume Change Timing","name":"resumeChangeTiming","uiComponent":{"type":"DROPDOWN","options":{"values":["Immediate","End Of Billing Cycle"]}},"description":"Whether the resume takes effect immediately or at the end of the current billing cycle."}
   * @returns {Object}
   * @sampleResult {"subscription":{"id":"56214fb2-cc85-47a1-93bc-44f3766bb56f","status":"ACTIVE","version":5},"actions":[{"id":"3aac8b0c-3d83-33a5-a3d1-4f2b58ccbccd","type":"RESUME","effective_date":"2026-08-01"}]}
   */
  async resumeSubscription(subscriptionId, resumeEffectiveDate, resumeChangeTiming) {
    return await this.#apiRequest({
      logTag: '[resumeSubscription]',
      path: `/v2/subscriptions/${ encodeURIComponent(subscriptionId) }/resume`,
      method: 'post',
      body: clean({
        resume_effective_date: resumeEffectiveDate,
        resume_change_timing: this.#resolveChoice(resumeChangeTiming, {
          'Immediate': 'IMMEDIATE',
          'End Of Billing Cycle': 'END_OF_BILLING_CYCLE',
        }),
      }),
    })
  }

  // ==================== PAYOUTS ====================

  /**
   * @operationName List Payouts
   * @category Payouts
   * @description Lists payouts (transfers of Square balance to the seller's bank account or card) with optional filters on location, status and an RFC 3339 time window. Results are paginated with a cursor. Requires the account to have the payouts read permission.
   * @route GET /list-payouts
   * @paramDef {"type":"String","label":"Location","name":"locationId","dictionary":"getLocationsDictionary","description":"Only list payouts for this location. Defaults to the account's main location."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Sent","Paid","Failed"]}},"description":"Only list payouts with this status."}
   * @paramDef {"type":"String","label":"Begin Time","name":"beginTime","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Include payouts created at or after this RFC 3339 timestamp. Defaults to one year ago."}
   * @paramDef {"type":"String","label":"End Time","name":"endTime","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Include payouts created before this RFC 3339 timestamp. Defaults to now."}
   * @paramDef {"type":"String","label":"Sort Order","name":"sortOrder","uiComponent":{"type":"DROPDOWN","options":{"values":["Ascending","Descending"]}},"description":"Order results by creation time. Defaults to Descending (newest first)."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum results per page (1-100). Defaults to 100."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor returned by a previous List Payouts call."}
   * @returns {Object}
   * @sampleResult {"payouts":[{"id":"po_4d28e6c4-7dd5-11ec-a3aa-89e71bbb0d60","status":"PAID","location_id":"L88917AVBK2S5","amount_money":{"amount":6259,"currency":"USD"},"created_at":"2026-07-01T09:00:00.000Z","type":"BATCH"}],"cursor":"bXkgY3Vyc29y"}
   */
  async listPayouts(locationId, status, beginTime, endTime, sortOrder, limit, cursor) {
    return await this.#apiRequest({
      logTag: '[listPayouts]',
      path: '/v2/payouts',
      query: {
        location_id: locationId,
        status: this.#resolveChoice(status, { 'Sent': 'SENT', 'Paid': 'PAID', 'Failed': 'FAILED' }),
        begin_time: beginTime,
        end_time: endTime,
        sort_order: this.#sortOrder(sortOrder),
        limit,
        cursor,
      },
    })
  }

  /**
   * @operationName Get Payout
   * @category Payouts
   * @description Retrieves details of a single payout by its ID, including status, amount, destination (bank account or card) and timestamps. Amounts are in cents (smallest currency unit).
   * @route GET /get-payout
   * @paramDef {"type":"String","label":"Payout ID","name":"payoutId","required":true,"description":"The ID of the payout to retrieve."}
   * @returns {Object}
   * @sampleResult {"payout":{"id":"po_4d28e6c4-7dd5-11ec-a3aa-89e71bbb0d60","status":"PAID","location_id":"L88917AVBK2S5","amount_money":{"amount":6259,"currency":"USD"},"destination":{"type":"BANK_ACCOUNT","id":"bact:ZPp9oXRETrbt6r"},"type":"BATCH"}}
   */
  async getPayout(payoutId) {
    return await this.#apiRequest({
      logTag: '[getPayout]',
      path: `/v2/payouts/${ encodeURIComponent(payoutId) }`,
    })
  }

  /**
   * @operationName List Payout Entries
   * @category Payouts
   * @description Lists the individual entries that make up a payout, such as charges, refunds and fees, each with gross, fee and net amounts in cents (smallest currency unit). Results are paginated with a cursor.
   * @route GET /list-payout-entries
   * @paramDef {"type":"String","label":"Payout ID","name":"payoutId","required":true,"description":"The ID of the payout whose entries to list."}
   * @paramDef {"type":"String","label":"Sort Order","name":"sortOrder","uiComponent":{"type":"DROPDOWN","options":{"values":["Ascending","Descending"]}},"description":"Order entries by effective time. Defaults to Descending (newest first)."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum results per page (1-100). Defaults to 100."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor returned by a previous List Payout Entries call."}
   * @returns {Object}
   * @sampleResult {"payout_entries":[{"id":"poe_ZQWcw41d0SGJS6IWd4cSi8mKHk","payout_id":"po_4d28e6c4-7dd5-11ec-a3aa-89e71bbb0d60","type":"CHARGE","gross_amount_money":{"amount":1500,"currency":"USD"},"fee_amount_money":{"amount":74,"currency":"USD"},"net_amount_money":{"amount":1426,"currency":"USD"}}],"cursor":"bXkgY3Vyc29y"}
   */
  async listPayoutEntries(payoutId, sortOrder, limit, cursor) {
    return await this.#apiRequest({
      logTag: '[listPayoutEntries]',
      path: `/v2/payouts/${ encodeURIComponent(payoutId) }/payout-entries`,
      query: {
        sort_order: this.#sortOrder(sortOrder),
        limit,
        cursor,
      },
    })
  }

  // ==================== TEAM ====================

  /**
   * @operationName Search Team Members
   * @category Team
   * @description Searches team member profiles of the account, optionally filtered by assigned location and by active/inactive status. Results are paginated with a cursor.
   * @route POST /search-team-members
   * @paramDef {"type":"Array<String>","label":"Locations","name":"locationIds","description":"Only return team members assigned to these location IDs."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Active","Inactive"]}},"description":"Only return team members with this status."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum results per page (1-25). Defaults to 25."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor returned by a previous Search Team Members call."}
   * @returns {Object}
   * @sampleResult {"team_members":[{"id":"TMoK_ogh6rH1o4dV","is_owner":false,"status":"ACTIVE","given_name":"John","family_name":"Smith","email_address":"john@example.com","assigned_locations":{"assignment_type":"ALL_CURRENT_AND_FUTURE_LOCATIONS"}}],"cursor":"bXkgY3Vyc29y"}
   */
  async searchTeamMembers(locationIds, status, limit, cursor) {
    const filter = clean({
      location_ids: Array.isArray(locationIds) && locationIds.length ? locationIds : undefined,
      status: this.#resolveChoice(status, { 'Active': 'ACTIVE', 'Inactive': 'INACTIVE' }),
    })

    return await this.#apiRequest({
      logTag: '[searchTeamMembers]',
      path: '/v2/team-members/search',
      method: 'post',
      body: clean({
        query: Object.keys(filter).length ? { filter } : undefined,
        limit,
        cursor,
      }),
    })
  }

  /**
   * @operationName Get Team Member
   * @category Team
   * @description Retrieves a team member profile by its ID, including name, contact information, status, owner flag and assigned locations.
   * @route GET /get-team-member
   * @paramDef {"type":"String","label":"Team Member ID","name":"teamMemberId","required":true,"description":"The ID of the team member to retrieve."}
   * @returns {Object}
   * @sampleResult {"team_member":{"id":"TMoK_ogh6rH1o4dV","is_owner":false,"status":"ACTIVE","given_name":"John","family_name":"Smith","email_address":"john@example.com","phone_number":"+14155551234","created_at":"2026-01-01T10:00:00.000Z"}}
   */
  async getTeamMember(teamMemberId) {
    return await this.#apiRequest({
      logTag: '[getTeamMember]',
      path: `/v2/team-members/${ encodeURIComponent(teamMemberId) }`,
    })
  }

  // ==================== DICTIONARIES ====================

  /**
   * @typedef {Object} getLocationsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Text to filter locations by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Square returns all locations in one call, so this is unused but kept for API compatibility."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Locations Dictionary
   * @description Lists the account's business locations for selection in location parameters. The option value is the location ID.
   * @route POST /get-locations-dictionary
   * @paramDef {"type":"getLocationsDictionary__payload","label":"Payload","name":"payload","description":"Search input used to filter locations by name."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Main Store","value":"L88917AVBK2S5","note":"Atlanta, GA - ACTIVE"}],"cursor":null}
   */
  async getLocationsDictionary(payload) {
    const { search } = payload || {}

    const response = await this.#apiRequest({
      logTag: '[getLocationsDictionary]',
      path: '/v2/locations',
    })

    const searchLower = (search || '').toLowerCase()

    const items = (response.locations || [])
      .filter(location => !searchLower || (location.name || '').toLowerCase().includes(searchLower))
      .map(location => {
        const noteParts = [
          location.address?.locality,
          location.address?.administrative_district_level_1,
        ].filter(Boolean)

        return {
          label: location.name || location.id,
          value: location.id,
          note: [noteParts.join(', '), location.status].filter(Boolean).join(' - ') || undefined,
        }
      })

    return { items, cursor: null }
  }

  /**
   * @typedef {Object} getCustomersDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Text to filter customers. An email-like value searches fuzzily by email via the Square API; other text filters the current page by name, email and phone."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a previous page."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Customers Dictionary
   * @description Lists customer profiles for selection in customer parameters, with cursor pagination. Email-like searches use the Square fuzzy email filter; other searches filter the current page by name, email and phone. The option value is the customer ID.
   * @route POST /get-customers-dictionary
   * @paramDef {"type":"getCustomersDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Amelia Earhart","value":"JDKYHBWT1D4F8MFH63DBMEN8Y4","note":"amelia@example.com"}],"cursor":"bXkgY3Vyc29y"}
   */
  async getCustomersDictionary(payload) {
    const { search, cursor } = payload || {}

    let customers
    let nextCursor

    if (search && search.includes('@')) {
      const response = await this.#apiRequest({
        logTag: '[getCustomersDictionary]',
        path: '/v2/customers/search',
        method: 'post',
        body: clean({
          query: { filter: { email_address: { fuzzy: search } } },
          limit: DEFAULT_DICTIONARY_PAGE_SIZE,
          cursor,
        }),
      })

      customers = response.customers || []
      nextCursor = response.cursor || null
    } else {
      const response = await this.#apiRequest({
        logTag: '[getCustomersDictionary]',
        path: '/v2/customers',
        query: {
          limit: DEFAULT_DICTIONARY_PAGE_SIZE,
          cursor,
        },
      })

      customers = response.customers || []
      nextCursor = response.cursor || null

      if (search) {
        const searchLower = search.toLowerCase()

        customers = customers.filter(customer => {
          const haystack = [
            customer.given_name, customer.family_name, customer.company_name,
            customer.email_address, customer.phone_number,
          ].filter(Boolean).join(' ').toLowerCase()

          return haystack.includes(searchLower)
        })
      }
    }

    return {
      items: customers.map(customer => {
        const name = [customer.given_name, customer.family_name].filter(Boolean).join(' ')

        return {
          label: name || customer.company_name || customer.email_address || customer.id,
          value: customer.id,
          note: customer.email_address || customer.phone_number || undefined,
        }
      }),
      cursor: nextCursor,
    }
  }

  /**
   * @typedef {Object} getCatalogItemsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Text to search item names and descriptions."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a previous page."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Catalog Items Dictionary
   * @description Lists catalog items for selection in catalog object parameters, with text search and cursor pagination. The option value is the ITEM object ID; the note shows the first variation's price when available.
   * @route POST /get-catalog-items-dictionary
   * @paramDef {"type":"getCatalogItemsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Coffee","value":"W62UWFY35CWMYGVWK6TWJDNI","note":"350 USD"}],"cursor":"bXkgY3Vyc29y"}
   */
  async getCatalogItemsDictionary(payload) {
    const { search, cursor } = payload || {}

    const body = clean({
      object_types: ['ITEM'],
      limit: DEFAULT_DICTIONARY_PAGE_SIZE,
      cursor,
    })

    if (search) {
      body.query = { text_query: { keywords: String(search).split(/\s+/).filter(Boolean).slice(0, 3) } }
    }

    const response = await this.#apiRequest({
      logTag: '[getCatalogItemsDictionary]',
      path: '/v2/catalog/search',
      method: 'post',
      body,
    })

    return {
      items: (response.objects || []).map(object => {
        const priceMoney = object.item_data?.variations?.[0]?.item_variation_data?.price_money

        return {
          label: object.item_data?.name || object.id,
          value: object.id,
          note: priceMoney ? `${ priceMoney.amount } ${ priceMoney.currency }` : undefined,
        }
      }),
      cursor: response.cursor || null,
    }
  }
}

Flowrunner.ServerCode.addService(SquareService, [
  {
    name: 'accessToken',
    displayName: 'Access Token',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Square access token. Create an application at https://developer.squareup.com/apps and copy the access token for the chosen environment.',
  },
  {
    name: 'environment',
    displayName: 'Environment',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.CHOICE,
    defaultValue: 'Production',
    required: true,
    shared: false,
    options: ['Production', 'Sandbox'],
    hint: 'Production uses connect.squareup.com; Sandbox uses connect.squareupsandbox.com for testing. The access token must match the selected environment.',
  },
])
