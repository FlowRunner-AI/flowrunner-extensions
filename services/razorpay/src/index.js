const logger = {
  info: (...args) => console.log('[Razorpay] info:', ...args),
  debug: (...args) => console.log('[Razorpay] debug:', ...args),
  error: (...args) => console.log('[Razorpay] error:', ...args),
  warn: (...args) => console.log('[Razorpay] warn:', ...args),
}

const API_BASE_URL = 'https://api.razorpay.com/v1'

const DEFAULT_CURRENCY = 'INR'
const DICTIONARY_PAGE_SIZE = 100

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
 * @integrationName Razorpay
 * @integrationIcon /icon.svg
 */
class RazorpayService {
  constructor(config) {
    this.keyId = config.keyId
    this.keySecret = config.keySecret
  }

  get #authHeader() {
    return `Basic ${ Buffer.from(`${ this.keyId }:${ this.keySecret }`).toString('base64') }`
  }

  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - API request: [${ method.toUpperCase() }::${ url }] q=${ JSON.stringify(cleanedQuery) }`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Authorization': this.#authHeader,
          'Content-Type': 'application/json',
        })
        .query(cleanedQuery || {})

      if (body !== undefined) {
        return await request.send(body)
      }

      return await request
    } catch (error) {
      const message = error.body?.error?.description || error.body?.message || error.message

      logger.error(`${ logTag } - request failed: ${ message }`)

      throw new Error(`Razorpay API error: ${ message }`)
    }
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  #toFlag(value) {
    if (value === undefined || value === null) {
      return undefined
    }

    return value ? 1 : 0
  }

  /**
   * @operationName Create Order
   * @category Orders
   * @description Creates a new order that a payment can be made against. Orders are the recommended first step of the Razorpay payment flow: create the order, then collect the payment referencing its ID. Supports partial payments with a minimum first-payment amount and custom key-value notes.
   * @route POST /create-order
   *
   * @paramDef {"type":"Number","label":"Amount","name":"amount","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Order amount in the smallest currency unit (e.g. paise for INR: 10000 = ₹100)."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","description":"ISO currency code, e.g. INR, USD. Defaults to INR."}
   * @paramDef {"type":"String","label":"Receipt","name":"receipt","description":"Your internal receipt number for the order, up to 40 characters. Useful for reconciliation."}
   * @paramDef {"type":"Boolean","label":"Allow Partial Payment","name":"partialPayment","uiComponent":{"type":"TOGGLE"},"description":"When enabled, the customer can pay the order amount in multiple installments."}
   * @paramDef {"type":"Number","label":"First Payment Minimum Amount","name":"firstPaymentMinAmount","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Minimum amount for the first partial payment, in the smallest currency unit (paise for INR: 10000 = ₹100). Only relevant when partial payment is enabled."}
   * @paramDef {"type":"Object","label":"Notes","name":"notes","description":"Key-value pairs stored with the order, e.g. {\"customer_ref\":\"abc\"}. Maximum 15 pairs, 256 characters each."}
   *
   * @returns {Object}
   * @sampleResult {"id":"order_IluGWxBm9U8zJ8","entity":"order","amount":50000,"amount_paid":0,"amount_due":50000,"currency":"INR","receipt":"rcpt_001","status":"created","attempts":0,"notes":{},"created_at":1642662092}
   */
  async createOrder(amount, currency, receipt, partialPayment, firstPaymentMinAmount, notes) {
    return await this.#apiRequest({
      logTag: '[createOrder]',
      url: `${ API_BASE_URL }/orders`,
      method: 'post',
      body: clean({
        amount,
        currency: currency || DEFAULT_CURRENCY,
        receipt,
        partial_payment: partialPayment,
        first_payment_min_amount: firstPaymentMinAmount,
        notes,
      }),
    })
  }

  /**
   * @operationName List Orders
   * @category Orders
   * @description Retrieves orders created on your account, newest first. Supports filtering by creation time range, receipt number, and whether the order has at least one authorized payment, plus count/skip pagination (up to 100 records per call).
   * @route GET /list-orders
   *
   * @paramDef {"type":"Number","label":"From","name":"from","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Unix timestamp in seconds; only orders created at or after this time are returned."}
   * @paramDef {"type":"Number","label":"To","name":"to","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Unix timestamp in seconds; only orders created at or before this time are returned."}
   * @paramDef {"type":"Number","label":"Count","name":"count","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of orders to return, between 1 and 100. Defaults to 10."}
   * @paramDef {"type":"Number","label":"Skip","name":"skip","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of orders to skip from the start of the result set, for pagination."}
   * @paramDef {"type":"Boolean","label":"Authorized Only","name":"authorized","uiComponent":{"type":"TOGGLE"},"description":"When enabled, only orders with at least one authorized payment are returned; when disabled, only orders without authorized payments. Leave empty for all orders."}
   * @paramDef {"type":"String","label":"Receipt","name":"receipt","description":"Filter by the exact receipt number stored on the order."}
   *
   * @returns {Object}
   * @sampleResult {"entity":"collection","count":1,"items":[{"id":"order_IluGWxBm9U8zJ8","entity":"order","amount":50000,"amount_paid":50000,"amount_due":0,"currency":"INR","receipt":"rcpt_001","status":"paid","attempts":1,"notes":{},"created_at":1642662092}]}
   */
  async listOrders(from, to, count, skip, authorized, receipt) {
    return await this.#apiRequest({
      logTag: '[listOrders]',
      url: `${ API_BASE_URL }/orders`,
      query: { from, to, count, skip, authorized: this.#toFlag(authorized), receipt },
    })
  }

  /**
   * @operationName Get Order
   * @category Orders
   * @description Retrieves a single order by its ID, including its amount, amount paid/due, status (created, attempted, or paid), attempts, and notes.
   * @route GET /get-order
   *
   * @paramDef {"type":"String","label":"Order ID","name":"orderId","required":true,"description":"Unique order identifier, e.g. order_IluGWxBm9U8zJ8."}
   *
   * @returns {Object}
   * @sampleResult {"id":"order_IluGWxBm9U8zJ8","entity":"order","amount":50000,"amount_paid":50000,"amount_due":0,"currency":"INR","receipt":"rcpt_001","status":"paid","attempts":1,"notes":{},"created_at":1642662092}
   */
  async getOrder(orderId) {
    return await this.#apiRequest({
      logTag: '[getOrder]',
      url: `${ API_BASE_URL }/orders/${ orderId }`,
    })
  }

  /**
   * @operationName Update Order
   * @category Orders
   * @description Updates the notes of an existing order. Notes are the only order attribute that can be modified after creation; the provided object fully replaces the existing notes.
   * @route PATCH /update-order
   *
   * @paramDef {"type":"String","label":"Order ID","name":"orderId","required":true,"description":"Unique order identifier, e.g. order_IluGWxBm9U8zJ8."}
   * @paramDef {"type":"Object","label":"Notes","name":"notes","required":true,"description":"Key-value pairs that replace the order's existing notes, e.g. {\"shipping_status\":\"dispatched\"}. Maximum 15 pairs, 256 characters each."}
   *
   * @returns {Object}
   * @sampleResult {"id":"order_IluGWxBm9U8zJ8","entity":"order","amount":50000,"amount_paid":0,"amount_due":50000,"currency":"INR","receipt":"rcpt_001","status":"created","attempts":0,"notes":{"shipping_status":"dispatched"},"created_at":1642662092}
   */
  async updateOrder(orderId, notes) {
    return await this.#apiRequest({
      logTag: '[updateOrder]',
      url: `${ API_BASE_URL }/orders/${ orderId }`,
      method: 'patch',
      body: { notes },
    })
  }

  /**
   * @operationName List Order Payments
   * @category Orders
   * @description Retrieves all payments made against a specific order, including failed, authorized, and captured attempts. Useful for checking how an order was (or was not) paid.
   * @route GET /list-order-payments
   *
   * @paramDef {"type":"String","label":"Order ID","name":"orderId","required":true,"description":"Unique order identifier, e.g. order_IluGWxBm9U8zJ8."}
   *
   * @returns {Object}
   * @sampleResult {"entity":"collection","count":1,"items":[{"id":"pay_G8VQzjPLoAvm6D","entity":"payment","amount":50000,"currency":"INR","status":"captured","order_id":"order_IluGWxBm9U8zJ8","method":"upi","captured":true,"email":"customer@example.com","contact":"+919000090000","created_at":1642662250}]}
   */
  async listOrderPayments(orderId) {
    return await this.#apiRequest({
      logTag: '[listOrderPayments]',
      url: `${ API_BASE_URL }/orders/${ orderId }/payments`,
    })
  }

  /**
   * @operationName List Payments
   * @category Payments
   * @description Retrieves payments received on your account, newest first. Supports filtering by creation time range and count/skip pagination (up to 100 records per call). Amounts are in the smallest currency unit (paise for INR).
   * @route GET /list-payments
   *
   * @paramDef {"type":"Number","label":"From","name":"from","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Unix timestamp in seconds; only payments created at or after this time are returned."}
   * @paramDef {"type":"Number","label":"To","name":"to","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Unix timestamp in seconds; only payments created at or before this time are returned."}
   * @paramDef {"type":"Number","label":"Count","name":"count","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of payments to return, between 1 and 100. Defaults to 10."}
   * @paramDef {"type":"Number","label":"Skip","name":"skip","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of payments to skip from the start of the result set, for pagination."}
   *
   * @returns {Object}
   * @sampleResult {"entity":"collection","count":1,"items":[{"id":"pay_G8VQzjPLoAvm6D","entity":"payment","amount":100000,"currency":"INR","status":"captured","order_id":"order_G8VPst5npGYPFK","method":"upi","captured":true,"email":"customer@example.com","contact":"+919000090000","fee":2360,"tax":360,"created_at":1606985209}]}
   */
  async listPayments(from, to, count, skip) {
    return await this.#apiRequest({
      logTag: '[listPayments]',
      url: `${ API_BASE_URL }/payments`,
      query: { from, to, count, skip },
    })
  }

  /**
   * @operationName Get Payment
   * @category Payments
   * @description Retrieves a single payment by its ID with full details: amount, status (created, authorized, captured, refunded, or failed), method, fees, and customer contact. Optionally expands nested card, EMI, or offer details in the same response.
   * @route GET /get-payment
   *
   * @paramDef {"type":"String","label":"Payment ID","name":"paymentId","required":true,"description":"Unique payment identifier, e.g. pay_G8VQzjPLoAvm6D."}
   * @paramDef {"type":"Array<String>","label":"Expand","name":"expand","uiComponent":{"type":"DROPDOWN","options":{"values":["Card","EMI","Offers"]}},"description":"Optional nested entities to expand in the response: Card (card details for card payments), EMI (EMI plan details), Offers (offers applied)."}
   *
   * @returns {Object}
   * @sampleResult {"id":"pay_G8VQzjPLoAvm6D","entity":"payment","amount":100000,"currency":"INR","status":"captured","order_id":"order_G8VPst5npGYPFK","method":"card","captured":true,"card_id":"card_JXPULjlKqC5j0i","email":"customer@example.com","contact":"+919000090000","fee":2360,"tax":360,"notes":{},"created_at":1606985209}
   */
  async getPayment(paymentId, expand) {
    const expandMapping = { 'Card': 'card', 'EMI': 'emi', 'Offers': 'offers' }
    const expandValues = (expand || []).map(value => this.#resolveChoice(value, expandMapping)).filter(Boolean)

    return await this.#apiRequest({
      logTag: '[getPayment]',
      url: `${ API_BASE_URL }/payments/${ paymentId }`,
      query: expandValues.length ? { 'expand[]': expandValues } : {},
    })
  }

  /**
   * @operationName Capture Payment
   * @category Payments
   * @description Captures an authorized payment, moving the funds to your account. The capture amount must equal the authorized amount. Payments left uncaptured are auto-refunded after Razorpay's authorization window expires.
   * @route POST /capture-payment
   *
   * @paramDef {"type":"String","label":"Payment ID","name":"paymentId","required":true,"description":"Identifier of the authorized payment to capture, e.g. pay_G8VQzjPLoAvm6D."}
   * @paramDef {"type":"Number","label":"Amount","name":"amount","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Amount to capture in the smallest currency unit (paise for INR: 10000 = ₹100). Must equal the authorized payment amount."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","description":"ISO currency code of the payment, e.g. INR. Defaults to INR."}
   *
   * @returns {Object}
   * @sampleResult {"id":"pay_G8VQzjPLoAvm6D","entity":"payment","amount":100000,"currency":"INR","status":"captured","captured":true,"method":"card","fee":2360,"tax":360,"created_at":1606985209}
   */
  async capturePayment(paymentId, amount, currency) {
    return await this.#apiRequest({
      logTag: '[capturePayment]',
      url: `${ API_BASE_URL }/payments/${ paymentId }/capture`,
      method: 'post',
      body: { amount, currency: currency || DEFAULT_CURRENCY },
    })
  }

  /**
   * @operationName Update Payment
   * @category Payments
   * @description Updates the notes of an existing payment. Notes are the only payment attribute that can be modified; the provided object fully replaces the existing notes.
   * @route PATCH /update-payment
   *
   * @paramDef {"type":"String","label":"Payment ID","name":"paymentId","required":true,"description":"Unique payment identifier, e.g. pay_G8VQzjPLoAvm6D."}
   * @paramDef {"type":"Object","label":"Notes","name":"notes","required":true,"description":"Key-value pairs that replace the payment's existing notes, e.g. {\"support_ticket\":\"1234\"}. Maximum 15 pairs, 256 characters each."}
   *
   * @returns {Object}
   * @sampleResult {"id":"pay_G8VQzjPLoAvm6D","entity":"payment","amount":100000,"currency":"INR","status":"captured","notes":{"support_ticket":"1234"},"created_at":1606985209}
   */
  async updatePayment(paymentId, notes) {
    return await this.#apiRequest({
      logTag: '[updatePayment]',
      url: `${ API_BASE_URL }/payments/${ paymentId }`,
      method: 'patch',
      body: { notes },
    })
  }

  /**
   * @operationName Get Card of Payment
   * @category Payments
   * @description Retrieves the card details used for a card payment: masked number (last 4 digits), network, type (credit/debit), issuer, and whether it is an international or EMI-capable card. Only works for payments made with a card.
   * @route GET /get-card-of-payment
   *
   * @paramDef {"type":"String","label":"Payment ID","name":"paymentId","required":true,"description":"Identifier of a card payment, e.g. pay_G8VQzjPLoAvm6D."}
   *
   * @returns {Object}
   * @sampleResult {"id":"card_JXPULjlKqC5j0i","entity":"card","name":"Gaurav Kumar","last4":"4366","network":"Visa","type":"credit","issuer":"UTIB","international":false,"emi":false,"sub_type":"consumer"}
   */
  async getCardOfPayment(paymentId) {
    return await this.#apiRequest({
      logTag: '[getCardOfPayment]',
      url: `${ API_BASE_URL }/payments/${ paymentId }/card`,
    })
  }

  /**
   * @operationName List Downtimes
   * @category Payments
   * @description Retrieves current and scheduled payment downtimes across methods (cards, UPI, netbanking, wallets), including severity, status, and the affected instrument. Use this to detect bank or network outages that may impact payment success rates.
   * @route GET /list-downtimes
   *
   * @returns {Object}
   * @sampleResult {"entity":"collection","count":1,"items":[{"id":"down_F7LroRQAAFuswd","entity":"payment.downtime","method":"upi","begin":1591946940,"end":null,"status":"started","scheduled":false,"severity":"high","instrument":{"vpa_handle":"@ybl"},"created_at":1591946940,"updated_at":1591946940}]}
   */
  async listDowntimes() {
    return await this.#apiRequest({
      logTag: '[listDowntimes]',
      url: `${ API_BASE_URL }/payments/downtimes`,
    })
  }

  /**
   * @operationName Get Downtime
   * @category Payments
   * @description Retrieves a single payment downtime record by its ID, including method, severity, begin/end times, and current status (scheduled, started, or resolved).
   * @route GET /get-downtime
   *
   * @paramDef {"type":"String","label":"Downtime ID","name":"downtimeId","required":true,"description":"Unique downtime identifier, e.g. down_F7LroRQAAFuswd."}
   *
   * @returns {Object}
   * @sampleResult {"id":"down_F7LroRQAAFuswd","entity":"payment.downtime","method":"upi","begin":1591946940,"end":1591948920,"status":"resolved","scheduled":false,"severity":"high","instrument":{"vpa_handle":"@ybl"},"created_at":1591946940,"updated_at":1591948920}
   */
  async getDowntime(downtimeId) {
    return await this.#apiRequest({
      logTag: '[getDowntime]',
      url: `${ API_BASE_URL }/payments/downtimes/${ downtimeId }`,
    })
  }

  /**
   * @operationName Create Refund
   * @category Refunds
   * @description Refunds a captured payment, either in full (omit the amount) or partially. Supports normal refund speed (5-7 working days) or optimum speed, which attempts an instant refund where supported and falls back to normal otherwise (instant refunds carry a fee).
   * @route POST /create-refund
   *
   * @paramDef {"type":"String","label":"Payment ID","name":"paymentId","required":true,"description":"Identifier of the captured payment to refund, e.g. pay_G8VQzjPLoAvm6D."}
   * @paramDef {"type":"Number","label":"Amount","name":"amount","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Amount to refund in the smallest currency unit (paise for INR: 10000 = ₹100). Omit to refund the full remaining amount. Must not exceed the unrefunded payment amount."}
   * @paramDef {"type":"String","label":"Speed","name":"speed","uiComponent":{"type":"DROPDOWN","options":{"values":["Normal","Optimum"]}},"description":"Refund processing speed. Normal takes 5-7 working days; Optimum attempts an instant refund where supported (additional fee applies), otherwise processes at normal speed. Defaults to Normal."}
   * @paramDef {"type":"Object","label":"Notes","name":"notes","description":"Key-value pairs stored with the refund, e.g. {\"reason\":\"order cancelled\"}. Maximum 15 pairs, 256 characters each."}
   * @paramDef {"type":"String","label":"Receipt","name":"receipt","description":"Your internal receipt number for the refund, up to 40 characters."}
   *
   * @returns {Object}
   * @sampleResult {"id":"rfnd_FP8QHiV938haTz","entity":"refund","amount":10000,"currency":"INR","payment_id":"pay_G8VQzjPLoAvm6D","status":"processed","speed_requested":"normal","speed_processed":"normal","receipt":"rfnd_rcpt_001","notes":{},"created_at":1597078866}
   */
  async createRefund(paymentId, amount, speed, notes, receipt) {
    return await this.#apiRequest({
      logTag: '[createRefund]',
      url: `${ API_BASE_URL }/payments/${ paymentId }/refund`,
      method: 'post',
      body: clean({
        amount,
        speed: this.#resolveChoice(speed, { 'Normal': 'normal', 'Optimum': 'optimum' }),
        notes,
        receipt,
      }),
    })
  }

  /**
   * @operationName List Payment Refunds
   * @category Refunds
   * @description Retrieves all refunds issued against a specific payment, with optional creation time range filtering and count/skip pagination (up to 100 records per call).
   * @route GET /list-payment-refunds
   *
   * @paramDef {"type":"String","label":"Payment ID","name":"paymentId","required":true,"description":"Identifier of the payment whose refunds to list, e.g. pay_G8VQzjPLoAvm6D."}
   * @paramDef {"type":"Number","label":"From","name":"from","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Unix timestamp in seconds; only refunds created at or after this time are returned."}
   * @paramDef {"type":"Number","label":"To","name":"to","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Unix timestamp in seconds; only refunds created at or before this time are returned."}
   * @paramDef {"type":"Number","label":"Count","name":"count","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of refunds to return, between 1 and 100. Defaults to 10."}
   * @paramDef {"type":"Number","label":"Skip","name":"skip","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of refunds to skip from the start of the result set, for pagination."}
   *
   * @returns {Object}
   * @sampleResult {"entity":"collection","count":1,"items":[{"id":"rfnd_FP8QHiV938haTz","entity":"refund","amount":10000,"currency":"INR","payment_id":"pay_G8VQzjPLoAvm6D","status":"processed","created_at":1597078866}]}
   */
  async listPaymentRefunds(paymentId, from, to, count, skip) {
    return await this.#apiRequest({
      logTag: '[listPaymentRefunds]',
      url: `${ API_BASE_URL }/payments/${ paymentId }/refunds`,
      query: { from, to, count, skip },
    })
  }

  /**
   * @operationName Get Payment Refund
   * @category Refunds
   * @description Retrieves a specific refund of a specific payment by both IDs. Returns the refund amount, status (pending, processed, or failed), speed, and notes.
   * @route GET /get-payment-refund
   *
   * @paramDef {"type":"String","label":"Payment ID","name":"paymentId","required":true,"description":"Identifier of the refunded payment, e.g. pay_G8VQzjPLoAvm6D."}
   * @paramDef {"type":"String","label":"Refund ID","name":"refundId","required":true,"description":"Identifier of the refund, e.g. rfnd_FP8QHiV938haTz."}
   *
   * @returns {Object}
   * @sampleResult {"id":"rfnd_FP8QHiV938haTz","entity":"refund","amount":10000,"currency":"INR","payment_id":"pay_G8VQzjPLoAvm6D","status":"processed","speed_requested":"normal","speed_processed":"normal","notes":{},"created_at":1597078866}
   */
  async getPaymentRefund(paymentId, refundId) {
    return await this.#apiRequest({
      logTag: '[getPaymentRefund]',
      url: `${ API_BASE_URL }/payments/${ paymentId }/refunds/${ refundId }`,
    })
  }

  /**
   * @operationName List All Refunds
   * @category Refunds
   * @description Retrieves refunds across all payments on your account, newest first, with optional creation time range filtering and count/skip pagination (up to 100 records per call).
   * @route GET /list-all-refunds
   *
   * @paramDef {"type":"Number","label":"From","name":"from","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Unix timestamp in seconds; only refunds created at or after this time are returned."}
   * @paramDef {"type":"Number","label":"To","name":"to","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Unix timestamp in seconds; only refunds created at or before this time are returned."}
   * @paramDef {"type":"Number","label":"Count","name":"count","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of refunds to return, between 1 and 100. Defaults to 10."}
   * @paramDef {"type":"Number","label":"Skip","name":"skip","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of refunds to skip from the start of the result set, for pagination."}
   *
   * @returns {Object}
   * @sampleResult {"entity":"collection","count":1,"items":[{"id":"rfnd_FP8QHiV938haTz","entity":"refund","amount":10000,"currency":"INR","payment_id":"pay_G8VQzjPLoAvm6D","status":"processed","created_at":1597078866}]}
   */
  async listRefunds(from, to, count, skip) {
    return await this.#apiRequest({
      logTag: '[listRefunds]',
      url: `${ API_BASE_URL }/refunds`,
      query: { from, to, count, skip },
    })
  }

  /**
   * @operationName Get Refund
   * @category Refunds
   * @description Retrieves a single refund by its ID (without needing the payment ID). Returns the refund amount, associated payment, status, speed, and notes.
   * @route GET /get-refund
   *
   * @paramDef {"type":"String","label":"Refund ID","name":"refundId","required":true,"description":"Unique refund identifier, e.g. rfnd_FP8QHiV938haTz."}
   *
   * @returns {Object}
   * @sampleResult {"id":"rfnd_FP8QHiV938haTz","entity":"refund","amount":10000,"currency":"INR","payment_id":"pay_G8VQzjPLoAvm6D","status":"processed","speed_requested":"normal","speed_processed":"normal","notes":{},"created_at":1597078866}
   */
  async getRefund(refundId) {
    return await this.#apiRequest({
      logTag: '[getRefund]',
      url: `${ API_BASE_URL }/refunds/${ refundId }`,
    })
  }

  /**
   * @operationName Update Refund
   * @category Refunds
   * @description Updates the notes of an existing refund. Notes are the only refund attribute that can be modified; the provided object fully replaces the existing notes.
   * @route PATCH /update-refund
   *
   * @paramDef {"type":"String","label":"Refund ID","name":"refundId","required":true,"description":"Unique refund identifier, e.g. rfnd_FP8QHiV938haTz."}
   * @paramDef {"type":"Object","label":"Notes","name":"notes","required":true,"description":"Key-value pairs that replace the refund's existing notes, e.g. {\"reason\":\"duplicate charge\"}. Maximum 15 pairs, 256 characters each."}
   *
   * @returns {Object}
   * @sampleResult {"id":"rfnd_FP8QHiV938haTz","entity":"refund","amount":10000,"currency":"INR","payment_id":"pay_G8VQzjPLoAvm6D","status":"processed","notes":{"reason":"duplicate charge"},"created_at":1597078866}
   */
  async updateRefund(refundId, notes) {
    return await this.#apiRequest({
      logTag: '[updateRefund]',
      url: `${ API_BASE_URL }/refunds/${ refundId }`,
      method: 'patch',
      body: { notes },
    })
  }

  /**
   * @operationName Create Payment Link
   * @category Payment Links
   * @description Creates a shareable payment link (short URL) that a customer can use to pay. Supports partial payments, expiry, customer prefill, SMS/email delivery, payment reminders, and a callback URL invoked after payment. Returns the link with its short_url.
   * @route POST /create-payment-link
   *
   * @paramDef {"type":"Number","label":"Amount","name":"amount","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Amount to collect in the smallest currency unit (paise for INR: 10000 = ₹100)."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","description":"ISO currency code, e.g. INR, USD. Defaults to INR."}
   * @paramDef {"type":"Boolean","label":"Accept Partial Payments","name":"acceptPartial","uiComponent":{"type":"TOGGLE"},"description":"When enabled, the customer can pay the amount in multiple installments."}
   * @paramDef {"type":"Number","label":"First Minimum Partial Amount","name":"firstMinPartialAmount","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Minimum amount the customer must pay first, in the smallest currency unit (paise for INR: 10000 = ₹100). Only relevant when partial payments are accepted."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Purpose of the payment shown to the customer on the payment page, e.g. 'Payment for policy no #23456'."}
   * @paramDef {"type":"String","label":"Customer Name","name":"customerName","description":"Customer's name to prefill on the payment page."}
   * @paramDef {"type":"String","label":"Customer Email","name":"customerEmail","description":"Customer's email address. Required to notify the customer by email."}
   * @paramDef {"type":"String","label":"Customer Contact","name":"customerContact","description":"Customer's phone number, e.g. +919000090000. Required to notify the customer by SMS."}
   * @paramDef {"type":"Boolean","label":"Notify via SMS","name":"notifySms","uiComponent":{"type":"TOGGLE"},"description":"When enabled, Razorpay sends the payment link to the customer's contact number by SMS."}
   * @paramDef {"type":"Boolean","label":"Notify via Email","name":"notifyEmail","uiComponent":{"type":"TOGGLE"},"description":"When enabled, Razorpay sends the payment link to the customer's email address."}
   * @paramDef {"type":"Boolean","label":"Enable Reminders","name":"reminderEnable","uiComponent":{"type":"TOGGLE"},"description":"When enabled, Razorpay sends payment reminders for this link per your dashboard reminder settings."}
   * @paramDef {"type":"Number","label":"Expire By","name":"expireBy","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Unix timestamp in seconds when the link expires. Must be at least 15 minutes in the future."}
   * @paramDef {"type":"String","label":"Reference ID","name":"referenceId","description":"Your unique reference for the link, up to 40 characters. Must be unique across payment links."}
   * @paramDef {"type":"String","label":"Callback URL","name":"callbackUrl","description":"URL the customer is redirected to after payment, with payment details appended as query parameters."}
   * @paramDef {"type":"String","label":"Callback Method","name":"callbackMethod","uiComponent":{"type":"DROPDOWN","options":{"values":["GET"]}},"description":"HTTP method for the callback redirect. Razorpay currently supports only GET; defaults to GET when a callback URL is provided."}
   * @paramDef {"type":"Object","label":"Notes","name":"notes","description":"Key-value pairs stored with the payment link, e.g. {\"policy_name\":\"Jeevan Bima\"}. Maximum 15 pairs, 256 characters each."}
   *
   * @returns {Object}
   * @sampleResult {"id":"plink_ExjpAUN3gVHrPJ","entity":"payment_link","short_url":"https://rzp.io/i/nxrHnLJ","status":"created","amount":10000,"amount_paid":0,"currency":"INR","accept_partial":false,"description":"Payment for policy no #23456","customer":{"name":"Gaurav Kumar","email":"gaurav.kumar@example.com","contact":"+919000090000"},"notify":{"sms":true,"email":true},"reminder_enable":true,"reference_id":"TS1989","created_at":1591097057}
   */
  async createPaymentLink(
    amount, currency, acceptPartial, firstMinPartialAmount, description,
    customerName, customerEmail, customerContact, notifySms, notifyEmail,
    reminderEnable, expireBy, referenceId, callbackUrl, callbackMethod, notes
  ) {
    const customer = clean({ name: customerName, email: customerEmail, contact: customerContact })
    const notify = clean({ sms: notifySms, email: notifyEmail })

    return await this.#apiRequest({
      logTag: '[createPaymentLink]',
      url: `${ API_BASE_URL }/payment_links`,
      method: 'post',
      body: clean({
        amount,
        currency: currency || DEFAULT_CURRENCY,
        accept_partial: acceptPartial,
        first_min_partial_amount: firstMinPartialAmount,
        description,
        customer: Object.keys(customer).length ? customer : undefined,
        notify: Object.keys(notify).length ? notify : undefined,
        reminder_enable: reminderEnable,
        expire_by: expireBy,
        reference_id: referenceId,
        callback_url: callbackUrl,
        callback_method: callbackUrl ? this.#resolveChoice(callbackMethod, { 'GET': 'get' }) || 'get' : undefined,
        notes,
      }),
    })
  }

  /**
   * @operationName List Payment Links
   * @category Payment Links
   * @description Retrieves payment links created on your account. Optionally filter by the payment ID that settled a link or by your reference ID to find a specific link.
   * @route GET /list-payment-links
   *
   * @paramDef {"type":"String","label":"Payment ID","name":"paymentId","description":"Return only the payment link paid by this payment, e.g. pay_G8VQzjPLoAvm6D."}
   * @paramDef {"type":"String","label":"Reference ID","name":"referenceId","description":"Return only the payment link with this reference ID."}
   *
   * @returns {Object}
   * @sampleResult {"payment_links":[{"id":"plink_ExjpAUN3gVHrPJ","entity":"payment_link","short_url":"https://rzp.io/i/nxrHnLJ","status":"paid","amount":10000,"amount_paid":10000,"currency":"INR","reference_id":"TS1989","created_at":1591097057}]}
   */
  async listPaymentLinks(paymentId, referenceId) {
    return await this.#apiRequest({
      logTag: '[listPaymentLinks]',
      url: `${ API_BASE_URL }/payment_links`,
      query: { payment_id: paymentId, reference_id: referenceId },
    })
  }

  /**
   * @operationName Get Payment Link
   * @category Payment Links
   * @description Retrieves a single payment link by its ID, including its status (created, partially_paid, paid, expired, or cancelled), amounts, customer details, and the payments made against it.
   * @route GET /get-payment-link
   *
   * @paramDef {"type":"String","label":"Payment Link ID","name":"paymentLinkId","required":true,"description":"Unique payment link identifier, e.g. plink_ExjpAUN3gVHrPJ."}
   *
   * @returns {Object}
   * @sampleResult {"id":"plink_ExjpAUN3gVHrPJ","entity":"payment_link","short_url":"https://rzp.io/i/nxrHnLJ","status":"paid","amount":10000,"amount_paid":10000,"currency":"INR","reference_id":"TS1989","payments":[{"payment_id":"pay_G8VQzjPLoAvm6D","amount":10000,"status":"captured"}],"created_at":1591097057}
   */
  async getPaymentLink(paymentLinkId) {
    return await this.#apiRequest({
      logTag: '[getPaymentLink]',
      url: `${ API_BASE_URL }/payment_links/${ paymentLinkId }`,
    })
  }

  /**
   * @operationName Update Payment Link
   * @category Payment Links
   * @description Updates an existing payment link. You can change the reference ID, expiry time, notes, and whether reminders are enabled. Only links that are not paid, cancelled, or expired can be updated.
   * @route PATCH /update-payment-link
   *
   * @paramDef {"type":"String","label":"Payment Link ID","name":"paymentLinkId","required":true,"description":"Unique payment link identifier, e.g. plink_ExjpAUN3gVHrPJ."}
   * @paramDef {"type":"String","label":"Reference ID","name":"referenceId","description":"New unique reference for the link, up to 40 characters."}
   * @paramDef {"type":"Number","label":"Expire By","name":"expireBy","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"New expiry as a Unix timestamp in seconds."}
   * @paramDef {"type":"Object","label":"Notes","name":"notes","description":"Key-value pairs that replace the link's existing notes. Maximum 15 pairs, 256 characters each."}
   * @paramDef {"type":"Boolean","label":"Enable Reminders","name":"reminderEnable","uiComponent":{"type":"TOGGLE"},"description":"Enable or disable payment reminders for this link."}
   *
   * @returns {Object}
   * @sampleResult {"id":"plink_ExjpAUN3gVHrPJ","entity":"payment_link","short_url":"https://rzp.io/i/nxrHnLJ","status":"created","amount":10000,"currency":"INR","reference_id":"TS1989-updated","expire_by":1691097057,"reminder_enable":false,"created_at":1591097057}
   */
  async updatePaymentLink(paymentLinkId, referenceId, expireBy, notes, reminderEnable) {
    return await this.#apiRequest({
      logTag: '[updatePaymentLink]',
      url: `${ API_BASE_URL }/payment_links/${ paymentLinkId }`,
      method: 'patch',
      body: clean({
        reference_id: referenceId,
        expire_by: expireBy,
        notes,
        reminder_enable: reminderEnable,
      }),
    })
  }

  /**
   * @operationName Cancel Payment Link
   * @category Payment Links
   * @description Cancels a payment link so it can no longer be paid. Only links in created or partially_paid status can be cancelled; the link's status becomes cancelled.
   * @route POST /cancel-payment-link
   *
   * @paramDef {"type":"String","label":"Payment Link ID","name":"paymentLinkId","required":true,"description":"Unique payment link identifier, e.g. plink_ExjpAUN3gVHrPJ."}
   *
   * @returns {Object}
   * @sampleResult {"id":"plink_ExjpAUN3gVHrPJ","entity":"payment_link","short_url":"https://rzp.io/i/nxrHnLJ","status":"cancelled","amount":10000,"currency":"INR","reference_id":"TS1989","created_at":1591097057}
   */
  async cancelPaymentLink(paymentLinkId) {
    return await this.#apiRequest({
      logTag: '[cancelPaymentLink]',
      url: `${ API_BASE_URL }/payment_links/${ paymentLinkId }/cancel`,
      method: 'post',
      body: {},
    })
  }

  /**
   * @operationName Send Payment Link Notification
   * @category Payment Links
   * @description Sends or resends the payment link to the customer via SMS or email. The customer's contact number (for SMS) or email address must be set on the link.
   * @route POST /send-payment-link-notification
   *
   * @paramDef {"type":"String","label":"Payment Link ID","name":"paymentLinkId","required":true,"description":"Unique payment link identifier, e.g. plink_ExjpAUN3gVHrPJ."}
   * @paramDef {"type":"String","label":"Medium","name":"medium","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["SMS","Email"]}},"description":"Channel to deliver the payment link through: SMS or Email."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async sendPaymentLinkNotification(paymentLinkId, medium) {
    const resolvedMedium = this.#resolveChoice(medium, { 'SMS': 'sms', 'Email': 'email' })

    return await this.#apiRequest({
      logTag: '[sendPaymentLinkNotification]',
      url: `${ API_BASE_URL }/payment_links/${ paymentLinkId }/notify_by/${ resolvedMedium }`,
      method: 'post',
      body: {},
    })
  }

  /**
   * @typedef {Object} InvoiceLineItem
   * @paramDef {"type":"String","label":"Item ID","name":"item_id","description":"ID of an existing item (e.g. item_7Oxp4hmm6T4SCn) to bill. When provided, name/amount/currency can be omitted."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"Name of the line item. Required when no item ID is provided."}
   * @paramDef {"type":"String","label":"Description","name":"description","description":"Description of the line item shown on the invoice."}
   * @paramDef {"type":"Number","label":"Amount","name":"amount","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Unit price in the smallest currency unit (paise for INR: 10000 = ₹100). Required when no item ID is provided."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","description":"ISO currency code for the line item, e.g. INR."}
   * @paramDef {"type":"Number","label":"Quantity","name":"quantity","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of units billed. Defaults to 1."}
   */

  /**
   * @operationName Create Invoice
   * @category Invoices
   * @description Creates an invoice for a customer with one or more line items (referencing existing items by ID or defined inline with name, amount, and currency). Identify the customer by ID or an inline customer object. The invoice is created in draft status unless issued, and can be delivered by SMS and/or email.
   * @route POST /create-invoice
   *
   * @paramDef {"type":"String","label":"Customer ID","name":"customerId","dictionary":"getCustomersDictionary","description":"ID of an existing customer to bill, e.g. cust_1Aa00000000004. Provide either this or an inline Customer object."}
   * @paramDef {"type":"Object","label":"Customer","name":"customer","description":"Inline customer details when no customer ID is provided, e.g. {\"name\":\"Gaurav Kumar\",\"email\":\"gaurav@example.com\",\"contact\":\"+919000090000\"}."}
   * @paramDef {"type":"Array<InvoiceLineItem>","label":"Line Items","name":"lineItems","required":true,"description":"Items billed on the invoice. Each entry references an existing item by item_id or defines the item inline with name, amount (smallest currency unit, e.g. paise), currency, and quantity."}
   * @paramDef {"type":"Number","label":"Expire By","name":"expireBy","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Unix timestamp in seconds when the invoice expires and can no longer be paid."}
   * @paramDef {"type":"Boolean","label":"Notify via SMS","name":"smsNotify","uiComponent":{"type":"TOGGLE"},"description":"When enabled, Razorpay sends the invoice to the customer's contact number by SMS."}
   * @paramDef {"type":"Boolean","label":"Notify via Email","name":"emailNotify","uiComponent":{"type":"TOGGLE"},"description":"When enabled, Razorpay sends the invoice to the customer's email address."}
   * @paramDef {"type":"Boolean","label":"Allow Partial Payment","name":"partialPayment","uiComponent":{"type":"TOGGLE"},"description":"When enabled, the customer can pay the invoice amount in multiple installments."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Brief description of the invoice shown to the customer, up to 2048 characters."}
   * @paramDef {"type":"String","label":"Receipt","name":"receipt","description":"Your internal receipt number for the invoice, up to 40 characters."}
   * @paramDef {"type":"Object","label":"Notes","name":"notes","description":"Key-value pairs stored with the invoice. Maximum 15 pairs, 256 characters each."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","description":"ISO currency code for the invoice, e.g. INR. Defaults to INR."}
   *
   * @returns {Object}
   * @sampleResult {"id":"inv_DAweOiQ7amIUVd","entity":"invoice","type":"invoice","status":"issued","customer_id":"cust_1Aa00000000004","line_items":[{"id":"li_DAweOizsysoJU6","name":"Book / English August","amount":20000,"currency":"INR","quantity":1}],"amount":20000,"currency":"INR","short_url":"https://rzp.io/i/2wxV8Xs","created_at":1595491479}
   */
  async createInvoice(
    customerId, customer, lineItems, expireBy, smsNotify, emailNotify,
    partialPayment, description, receipt, notes, currency
  ) {
    return await this.#apiRequest({
      logTag: '[createInvoice]',
      url: `${ API_BASE_URL }/invoices`,
      method: 'post',
      body: clean({
        type: 'invoice',
        customer_id: customerId,
        customer: customerId ? undefined : customer,
        line_items: lineItems,
        expire_by: expireBy,
        sms_notify: this.#toFlag(smsNotify),
        email_notify: this.#toFlag(emailNotify),
        partial_payment: partialPayment,
        description,
        receipt,
        notes,
        currency,
      }),
    })
  }

  /**
   * @operationName List Invoices
   * @category Invoices
   * @description Retrieves invoices on your account with optional filters by type, the payment that settled them, receipt number, or customer, plus count/skip pagination (up to 100 records per call).
   * @route GET /list-invoices
   *
   * @paramDef {"type":"String","label":"Type","name":"type","uiComponent":{"type":"DROPDOWN","options":{"values":["Invoice","Link"]}},"description":"Filter by entity type: Invoice for standard invoices, Link for legacy invoice-based payment links."}
   * @paramDef {"type":"String","label":"Payment ID","name":"paymentId","description":"Return only invoices paid by this payment, e.g. pay_G8VQzjPLoAvm6D."}
   * @paramDef {"type":"String","label":"Receipt","name":"receipt","description":"Filter by the exact receipt number stored on the invoice."}
   * @paramDef {"type":"String","label":"Customer ID","name":"customerId","dictionary":"getCustomersDictionary","description":"Return only invoices for this customer, e.g. cust_1Aa00000000004."}
   * @paramDef {"type":"Number","label":"Count","name":"count","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of invoices to return, between 1 and 100. Defaults to 10."}
   * @paramDef {"type":"Number","label":"Skip","name":"skip","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of invoices to skip from the start of the result set, for pagination."}
   *
   * @returns {Object}
   * @sampleResult {"entity":"collection","count":1,"items":[{"id":"inv_DAweOiQ7amIUVd","entity":"invoice","type":"invoice","status":"paid","customer_id":"cust_1Aa00000000004","amount":20000,"currency":"INR","short_url":"https://rzp.io/i/2wxV8Xs","created_at":1595491479}]}
   */
  async listInvoices(type, paymentId, receipt, customerId, count, skip) {
    return await this.#apiRequest({
      logTag: '[listInvoices]',
      url: `${ API_BASE_URL }/invoices`,
      query: {
        type: this.#resolveChoice(type, { 'Invoice': 'invoice', 'Link': 'link' }),
        payment_id: paymentId,
        receipt,
        customer_id: customerId,
        count,
        skip,
      },
    })
  }

  /**
   * @operationName Get Invoice
   * @category Invoices
   * @description Retrieves a single invoice by its ID, including line items, amounts, status (draft, issued, partially_paid, paid, cancelled, expired, or deleted), and the short URL customers use to pay.
   * @route GET /get-invoice
   *
   * @paramDef {"type":"String","label":"Invoice ID","name":"invoiceId","required":true,"description":"Unique invoice identifier, e.g. inv_DAweOiQ7amIUVd."}
   *
   * @returns {Object}
   * @sampleResult {"id":"inv_DAweOiQ7amIUVd","entity":"invoice","type":"invoice","status":"issued","customer_id":"cust_1Aa00000000004","line_items":[{"id":"li_DAweOizsysoJU6","name":"Book / English August","amount":20000,"currency":"INR","quantity":1}],"amount":20000,"amount_paid":0,"amount_due":20000,"currency":"INR","short_url":"https://rzp.io/i/2wxV8Xs","created_at":1595491479}
   */
  async getInvoice(invoiceId) {
    return await this.#apiRequest({
      logTag: '[getInvoice]',
      url: `${ API_BASE_URL }/invoices/${ invoiceId }`,
    })
  }

  /**
   * @operationName Update Invoice
   * @category Invoices
   * @description Updates an invoice. Draft invoices accept changes to line items, description, receipt, expiry, notification settings, and partial payment; issued invoices only allow notes updates. Provided line items fully replace the existing ones.
   * @route PATCH /update-invoice
   *
   * @paramDef {"type":"String","label":"Invoice ID","name":"invoiceId","required":true,"description":"Unique invoice identifier, e.g. inv_DAweOiQ7amIUVd."}
   * @paramDef {"type":"Array<InvoiceLineItem>","label":"Line Items","name":"lineItems","description":"Replacement line items for a draft invoice. Each entry references an existing item by item_id or defines the item inline with name, amount (smallest currency unit, e.g. paise), currency, and quantity."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New description shown to the customer, up to 2048 characters. Draft invoices only."}
   * @paramDef {"type":"String","label":"Receipt","name":"receipt","description":"New internal receipt number, up to 40 characters. Draft invoices only."}
   * @paramDef {"type":"Number","label":"Expire By","name":"expireBy","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"New expiry as a Unix timestamp in seconds. Draft invoices only."}
   * @paramDef {"type":"Boolean","label":"Notify via SMS","name":"smsNotify","uiComponent":{"type":"TOGGLE"},"description":"Enable or disable SMS delivery of the invoice. Draft invoices only."}
   * @paramDef {"type":"Boolean","label":"Notify via Email","name":"emailNotify","uiComponent":{"type":"TOGGLE"},"description":"Enable or disable email delivery of the invoice. Draft invoices only."}
   * @paramDef {"type":"Boolean","label":"Allow Partial Payment","name":"partialPayment","uiComponent":{"type":"TOGGLE"},"description":"Enable or disable partial payments. Draft invoices only."}
   * @paramDef {"type":"Object","label":"Notes","name":"notes","description":"Key-value pairs that replace the invoice's existing notes. Allowed for both draft and issued invoices."}
   *
   * @returns {Object}
   * @sampleResult {"id":"inv_DAweOiQ7amIUVd","entity":"invoice","type":"invoice","status":"draft","customer_id":"cust_1Aa00000000004","amount":40000,"currency":"INR","notes":{"updated":"true"},"created_at":1595491479}
   */
  async updateInvoice(invoiceId, lineItems, description, receipt, expireBy, smsNotify, emailNotify, partialPayment, notes) {
    return await this.#apiRequest({
      logTag: '[updateInvoice]',
      url: `${ API_BASE_URL }/invoices/${ invoiceId }`,
      method: 'patch',
      body: clean({
        line_items: lineItems,
        description,
        receipt,
        expire_by: expireBy,
        sms_notify: this.#toFlag(smsNotify),
        email_notify: this.#toFlag(emailNotify),
        partial_payment: partialPayment,
        notes,
      }),
    })
  }

  /**
   * @operationName Issue Invoice
   * @category Invoices
   * @description Issues a draft invoice, changing its status to issued, generating the payable short URL, and triggering configured SMS/email notifications. Once issued, an invoice can be paid by the customer.
   * @route POST /issue-invoice
   *
   * @paramDef {"type":"String","label":"Invoice ID","name":"invoiceId","required":true,"description":"Identifier of the draft invoice to issue, e.g. inv_DAweOiQ7amIUVd."}
   *
   * @returns {Object}
   * @sampleResult {"id":"inv_DAweOiQ7amIUVd","entity":"invoice","type":"invoice","status":"issued","customer_id":"cust_1Aa00000000004","amount":20000,"currency":"INR","short_url":"https://rzp.io/i/2wxV8Xs","issued_at":1595491480,"created_at":1595491479}
   */
  async issueInvoice(invoiceId) {
    return await this.#apiRequest({
      logTag: '[issueInvoice]',
      url: `${ API_BASE_URL }/invoices/${ invoiceId }/issue`,
      method: 'post',
      body: {},
    })
  }

  /**
   * @operationName Cancel Invoice
   * @category Invoices
   * @description Cancels an issued invoice so it can no longer be paid. Only invoices in issued or partially_paid status can be cancelled; the status becomes cancelled.
   * @route POST /cancel-invoice
   *
   * @paramDef {"type":"String","label":"Invoice ID","name":"invoiceId","required":true,"description":"Identifier of the issued invoice to cancel, e.g. inv_DAweOiQ7amIUVd."}
   *
   * @returns {Object}
   * @sampleResult {"id":"inv_DAweOiQ7amIUVd","entity":"invoice","type":"invoice","status":"cancelled","customer_id":"cust_1Aa00000000004","amount":20000,"currency":"INR","created_at":1595491479}
   */
  async cancelInvoice(invoiceId) {
    return await this.#apiRequest({
      logTag: '[cancelInvoice]',
      url: `${ API_BASE_URL }/invoices/${ invoiceId }/cancel`,
      method: 'post',
      body: {},
    })
  }

  /**
   * @operationName Delete Invoice
   * @category Invoices
   * @description Permanently deletes an invoice. Only draft invoices can be deleted; issued invoices must be cancelled instead. Returns an empty array on success.
   * @route DELETE /delete-invoice
   *
   * @paramDef {"type":"String","label":"Invoice ID","name":"invoiceId","required":true,"description":"Identifier of the draft invoice to delete, e.g. inv_DAweOiQ7amIUVd."}
   *
   * @returns {Array<Object>}
   * @sampleResult []
   */
  async deleteInvoice(invoiceId) {
    return await this.#apiRequest({
      logTag: '[deleteInvoice]',
      url: `${ API_BASE_URL }/invoices/${ invoiceId }`,
      method: 'delete',
    })
  }

  /**
   * @operationName Send Invoice Notification
   * @category Invoices
   * @description Sends or resends an issued invoice to the customer via SMS or email. The customer's contact number (for SMS) or email address must be present on the invoice.
   * @route POST /send-invoice-notification
   *
   * @paramDef {"type":"String","label":"Invoice ID","name":"invoiceId","required":true,"description":"Identifier of the issued invoice to send, e.g. inv_DAweOiQ7amIUVd."}
   * @paramDef {"type":"String","label":"Medium","name":"medium","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["SMS","Email"]}},"description":"Channel to deliver the invoice through: SMS or Email."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async sendInvoiceNotification(invoiceId, medium) {
    const resolvedMedium = this.#resolveChoice(medium, { 'SMS': 'sms', 'Email': 'email' })

    return await this.#apiRequest({
      logTag: '[sendInvoiceNotification]',
      url: `${ API_BASE_URL }/invoices/${ invoiceId }/notify_by/${ resolvedMedium }`,
      method: 'post',
      body: {},
    })
  }

  /**
   * @operationName Create Item
   * @category Items
   * @description Creates a reusable billing item (product or service) with a name, unit price, and currency. Items can then be referenced by ID in invoice line items instead of redefining them each time.
   * @route POST /create-item
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Name of the item, e.g. 'Extra appala (papadum)'."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Description of the item shown on invoices."}
   * @paramDef {"type":"Number","label":"Amount","name":"amount","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Unit price in the smallest currency unit (paise for INR: 10000 = ₹100)."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","description":"ISO currency code, e.g. INR. Defaults to INR."}
   *
   * @returns {Object}
   * @sampleResult {"id":"item_7Oxp4hmm6T4SCn","active":true,"name":"Book / English August","description":"An Indian story","amount":20000,"currency":"INR"}
   */
  async createItem(name, description, amount, currency) {
    return await this.#apiRequest({
      logTag: '[createItem]',
      url: `${ API_BASE_URL }/items`,
      method: 'post',
      body: clean({
        name,
        description,
        amount,
        currency: currency || DEFAULT_CURRENCY,
      }),
    })
  }

  /**
   * @operationName List Items
   * @category Items
   * @description Retrieves billing items on your account with optional filtering by creation time range and active state, plus count/skip pagination (up to 100 records per call).
   * @route GET /list-items
   *
   * @paramDef {"type":"Number","label":"From","name":"from","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Unix timestamp in seconds; only items created at or after this time are returned."}
   * @paramDef {"type":"Number","label":"To","name":"to","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Unix timestamp in seconds; only items created at or before this time are returned."}
   * @paramDef {"type":"Number","label":"Count","name":"count","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of items to return, between 1 and 100. Defaults to 10."}
   * @paramDef {"type":"Number","label":"Skip","name":"skip","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of items to skip from the start of the result set, for pagination."}
   * @paramDef {"type":"Boolean","label":"Active Only","name":"active","uiComponent":{"type":"TOGGLE"},"description":"When enabled, only active items are returned; when disabled, only inactive items. Leave empty for all items."}
   *
   * @returns {Object}
   * @sampleResult {"entity":"collection","count":1,"items":[{"id":"item_7Oxp4hmm6T4SCn","active":true,"name":"Book / English August","description":"An Indian story","amount":20000,"currency":"INR"}]}
   */
  async listItems(from, to, count, skip, active) {
    return await this.#apiRequest({
      logTag: '[listItems]',
      url: `${ API_BASE_URL }/items`,
      query: { from, to, count, skip, active: this.#toFlag(active) },
    })
  }

  /**
   * @operationName Get Item
   * @category Items
   * @description Retrieves a single billing item by its ID, including its name, description, unit price, currency, and active state.
   * @route GET /get-item
   *
   * @paramDef {"type":"String","label":"Item ID","name":"itemId","required":true,"dictionary":"getItemsDictionary","description":"Unique item identifier, e.g. item_7Oxp4hmm6T4SCn."}
   *
   * @returns {Object}
   * @sampleResult {"id":"item_7Oxp4hmm6T4SCn","active":true,"name":"Book / English August","description":"An Indian story","amount":20000,"currency":"INR"}
   */
  async getItem(itemId) {
    return await this.#apiRequest({
      logTag: '[getItem]',
      url: `${ API_BASE_URL }/items/${ itemId }`,
    })
  }

  /**
   * @operationName Update Item
   * @category Items
   * @description Updates an existing billing item's name, description, unit price, currency, or active state. Only the provided fields are changed.
   * @route PATCH /update-item
   *
   * @paramDef {"type":"String","label":"Item ID","name":"itemId","required":true,"dictionary":"getItemsDictionary","description":"Unique item identifier, e.g. item_7Oxp4hmm6T4SCn."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"New name for the item."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New description for the item."}
   * @paramDef {"type":"Number","label":"Amount","name":"amount","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"New unit price in the smallest currency unit (paise for INR: 10000 = ₹100)."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","description":"New ISO currency code, e.g. INR."}
   * @paramDef {"type":"Boolean","label":"Active","name":"active","uiComponent":{"type":"TOGGLE"},"description":"Set whether the item is active and available for billing."}
   *
   * @returns {Object}
   * @sampleResult {"id":"item_7Oxp4hmm6T4SCn","active":true,"name":"Book / Updated name","description":"An Indian story","amount":30000,"currency":"INR"}
   */
  async updateItem(itemId, name, description, amount, currency, active) {
    return await this.#apiRequest({
      logTag: '[updateItem]',
      url: `${ API_BASE_URL }/items/${ itemId }`,
      method: 'patch',
      body: clean({ name, description, amount, currency, active }),
    })
  }

  /**
   * @operationName Delete Item
   * @category Items
   * @description Permanently deletes a billing item. Items already referenced by invoices cannot be deleted. Returns an empty array on success.
   * @route DELETE /delete-item
   *
   * @paramDef {"type":"String","label":"Item ID","name":"itemId","required":true,"dictionary":"getItemsDictionary","description":"Identifier of the item to delete, e.g. item_7Oxp4hmm6T4SCn."}
   *
   * @returns {Array<Object>}
   * @sampleResult []
   */
  async deleteItem(itemId) {
    return await this.#apiRequest({
      logTag: '[deleteItem]',
      url: `${ API_BASE_URL }/items/${ itemId }`,
      method: 'delete',
    })
  }

  /**
   * @operationName Create Customer
   * @category Customers
   * @description Creates a customer record with name, contact details, and optional GSTIN. Customers can be referenced when creating invoices, QR codes, and virtual accounts. Choose whether to fail or silently fetch the existing record when a customer with the same details already exists.
   * @route POST /create-customer
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Customer's full name, e.g. 'Gaurav Kumar'."}
   * @paramDef {"type":"String","label":"Contact","name":"contact","description":"Customer's phone number, e.g. +919000090000."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Customer's email address."}
   * @paramDef {"type":"String","label":"If Customer Exists","name":"failExisting","uiComponent":{"type":"DROPDOWN","options":{"values":["Fetch Existing Customer","Fail With Error"]}},"description":"Behavior when a customer with the same details already exists: fetch and return the existing record, or fail with an error. Razorpay's default is to fail."}
   * @paramDef {"type":"String","label":"GSTIN","name":"gstin","description":"Customer's GST identification number, e.g. 29XAbbA4369J1PA."}
   * @paramDef {"type":"Object","label":"Notes","name":"notes","description":"Key-value pairs stored with the customer. Maximum 15 pairs, 256 characters each."}
   *
   * @returns {Object}
   * @sampleResult {"id":"cust_1Aa00000000004","entity":"customer","name":"Gaurav Kumar","email":"gaurav.kumar@example.com","contact":"9123456780","gstin":null,"notes":{},"created_at":1582033731}
   */
  async createCustomer(name, contact, email, failExisting, gstin, notes) {
    return await this.#apiRequest({
      logTag: '[createCustomer]',
      url: `${ API_BASE_URL }/customers`,
      method: 'post',
      body: clean({
        name,
        contact,
        email,
        fail_existing: this.#resolveChoice(failExisting, { 'Fetch Existing Customer': '0', 'Fail With Error': '1' }),
        gstin,
        notes,
      }),
    })
  }

  /**
   * @operationName List Customers
   * @category Customers
   * @description Retrieves customer records on your account, newest first, with count/skip pagination (up to 100 records per call).
   * @route GET /list-customers
   *
   * @paramDef {"type":"Number","label":"Count","name":"count","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of customers to return, between 1 and 100. Defaults to 10."}
   * @paramDef {"type":"Number","label":"Skip","name":"skip","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of customers to skip from the start of the result set, for pagination."}
   *
   * @returns {Object}
   * @sampleResult {"entity":"collection","count":1,"items":[{"id":"cust_1Aa00000000004","entity":"customer","name":"Gaurav Kumar","email":"gaurav.kumar@example.com","contact":"9123456780","gstin":null,"notes":{},"created_at":1582033731}]}
   */
  async listCustomers(count, skip) {
    return await this.#apiRequest({
      logTag: '[listCustomers]',
      url: `${ API_BASE_URL }/customers`,
      query: { count, skip },
    })
  }

  /**
   * @operationName Get Customer
   * @category Customers
   * @description Retrieves a single customer record by its ID, including name, email, contact number, GSTIN, and notes.
   * @route GET /get-customer
   *
   * @paramDef {"type":"String","label":"Customer ID","name":"customerId","required":true,"dictionary":"getCustomersDictionary","description":"Unique customer identifier, e.g. cust_1Aa00000000004."}
   *
   * @returns {Object}
   * @sampleResult {"id":"cust_1Aa00000000004","entity":"customer","name":"Gaurav Kumar","email":"gaurav.kumar@example.com","contact":"9123456780","gstin":"29XAbbA4369J1PA","notes":{},"created_at":1582033731}
   */
  async getCustomer(customerId) {
    return await this.#apiRequest({
      logTag: '[getCustomer]',
      url: `${ API_BASE_URL }/customers/${ customerId }`,
    })
  }

  /**
   * @operationName Update Customer
   * @category Customers
   * @description Updates an existing customer's name, email, or contact number. Only the provided fields are changed.
   * @route PUT /update-customer
   *
   * @paramDef {"type":"String","label":"Customer ID","name":"customerId","required":true,"dictionary":"getCustomersDictionary","description":"Unique customer identifier, e.g. cust_1Aa00000000004."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"New full name for the customer."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"New email address for the customer."}
   * @paramDef {"type":"String","label":"Contact","name":"contact","description":"New phone number for the customer, e.g. +919000090000."}
   *
   * @returns {Object}
   * @sampleResult {"id":"cust_1Aa00000000004","entity":"customer","name":"Gaurav Kumar","email":"new.email@example.com","contact":"9123456780","gstin":null,"notes":{},"created_at":1582033731}
   */
  async updateCustomer(customerId, name, email, contact) {
    return await this.#apiRequest({
      logTag: '[updateCustomer]',
      url: `${ API_BASE_URL }/customers/${ customerId }`,
      method: 'put',
      body: clean({ name, email, contact }),
    })
  }

  /**
   * @operationName Create Plan
   * @category Plans
   * @description Creates a subscription plan defining the billing cycle (period and interval) and the item charged each cycle. For example, period Monthly with interval 1 bills every month; period Weekly with interval 2 bills every two weeks. Plans are immutable once created.
   * @route POST /create-plan
   *
   * @paramDef {"type":"String","label":"Period","name":"period","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Daily","Weekly","Monthly","Yearly"]}},"description":"Billing frequency unit for the plan."}
   * @paramDef {"type":"Number","label":"Interval","name":"interval","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of periods between charges, e.g. period Monthly with interval 3 bills every 3 months."}
   * @paramDef {"type":"String","label":"Item Name","name":"itemName","required":true,"description":"Name of the item billed each cycle, e.g. 'Monthly Pro Plan'."}
   * @paramDef {"type":"Number","label":"Item Amount","name":"itemAmount","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Amount charged per cycle in the smallest currency unit (paise for INR: 10000 = ₹100)."}
   * @paramDef {"type":"String","label":"Item Currency","name":"itemCurrency","description":"ISO currency code for the plan amount, e.g. INR. Defaults to INR."}
   * @paramDef {"type":"String","label":"Item Description","name":"itemDescription","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Description of the billed item shown to subscribers."}
   * @paramDef {"type":"Object","label":"Notes","name":"notes","description":"Key-value pairs stored with the plan. Maximum 15 pairs, 256 characters each."}
   *
   * @returns {Object}
   * @sampleResult {"id":"plan_00000000000001","entity":"plan","interval":1,"period":"monthly","item":{"id":"item_00000000000001","name":"Monthly Pro Plan","amount":69900,"currency":"INR","description":"Pro subscription billed monthly"},"notes":{},"created_at":1580219935}
   */
  async createPlan(period, interval, itemName, itemAmount, itemCurrency, itemDescription, notes) {
    return await this.#apiRequest({
      logTag: '[createPlan]',
      url: `${ API_BASE_URL }/plans`,
      method: 'post',
      body: clean({
        period: this.#resolveChoice(period, { 'Daily': 'daily', 'Weekly': 'weekly', 'Monthly': 'monthly', 'Yearly': 'yearly' }),
        interval,
        item: clean({
          name: itemName,
          amount: itemAmount,
          currency: itemCurrency || DEFAULT_CURRENCY,
          description: itemDescription,
        }),
        notes,
      }),
    })
  }

  /**
   * @operationName List Plans
   * @category Plans
   * @description Retrieves subscription plans on your account with optional creation time range filtering and count/skip pagination (up to 100 records per call).
   * @route GET /list-plans
   *
   * @paramDef {"type":"Number","label":"From","name":"from","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Unix timestamp in seconds; only plans created at or after this time are returned."}
   * @paramDef {"type":"Number","label":"To","name":"to","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Unix timestamp in seconds; only plans created at or before this time are returned."}
   * @paramDef {"type":"Number","label":"Count","name":"count","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of plans to return, between 1 and 100. Defaults to 10."}
   * @paramDef {"type":"Number","label":"Skip","name":"skip","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of plans to skip from the start of the result set, for pagination."}
   *
   * @returns {Object}
   * @sampleResult {"entity":"collection","count":1,"items":[{"id":"plan_00000000000001","entity":"plan","interval":1,"period":"monthly","item":{"id":"item_00000000000001","name":"Monthly Pro Plan","amount":69900,"currency":"INR"},"created_at":1580219935}]}
   */
  async listPlans(from, to, count, skip) {
    return await this.#apiRequest({
      logTag: '[listPlans]',
      url: `${ API_BASE_URL }/plans`,
      query: { from, to, count, skip },
    })
  }

  /**
   * @operationName Get Plan
   * @category Plans
   * @description Retrieves a single subscription plan by its ID, including its billing period, interval, and the item charged each cycle.
   * @route GET /get-plan
   *
   * @paramDef {"type":"String","label":"Plan ID","name":"planId","required":true,"dictionary":"getPlansDictionary","description":"Unique plan identifier, e.g. plan_00000000000001."}
   *
   * @returns {Object}
   * @sampleResult {"id":"plan_00000000000001","entity":"plan","interval":1,"period":"monthly","item":{"id":"item_00000000000001","name":"Monthly Pro Plan","amount":69900,"currency":"INR"},"notes":{},"created_at":1580219935}
   */
  async getPlan(planId) {
    return await this.#apiRequest({
      logTag: '[getPlan]',
      url: `${ API_BASE_URL }/plans/${ planId }`,
    })
  }

  /**
   * @operationName Create Subscription
   * @category Subscriptions
   * @description Creates a recurring subscription on a plan. Set the total number of billing cycles, optional future start time, expiry for the first authorization payment, upfront add-ons, and an offer. Returns the subscription with a short_url the customer uses to authorize recurring payments.
   * @route POST /create-subscription
   *
   * @paramDef {"type":"String","label":"Plan ID","name":"planId","required":true,"dictionary":"getPlansDictionary","description":"Identifier of the plan to subscribe to, e.g. plan_00000000000001."}
   * @paramDef {"type":"Number","label":"Total Count","name":"totalCount","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Total number of billing cycles the subscription runs for, e.g. 12 for a year of monthly billing."}
   * @paramDef {"type":"Number","label":"Quantity","name":"quantity","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of units of the plan item billed each cycle. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Start At","name":"startAt","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Unix timestamp in seconds when the subscription starts billing. Omit to start immediately after authorization."}
   * @paramDef {"type":"Number","label":"Expire By","name":"expireBy","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Unix timestamp in seconds until which the customer can authorize the subscription."}
   * @paramDef {"type":"Boolean","label":"Notify Customer","name":"customerNotify","uiComponent":{"type":"TOGGLE"},"description":"When enabled, Razorpay sends subscription-related communication (authorization link, charge notifications) to the customer."}
   * @paramDef {"type":"Array<Object>","label":"Add-ons","name":"addons","description":"Upfront one-time charges added to the first payment. Each entry: {\"item\":{\"name\":\"Setup fee\",\"amount\":30000,\"currency\":\"INR\"}} with amount in the smallest currency unit (paise)."}
   * @paramDef {"type":"String","label":"Offer ID","name":"offerId","description":"Identifier of an offer to apply to the subscription, e.g. offer_JHD834hjbxzhd38d."}
   * @paramDef {"type":"Object","label":"Notes","name":"notes","description":"Key-value pairs stored with the subscription. Maximum 15 pairs, 256 characters each."}
   *
   * @returns {Object}
   * @sampleResult {"id":"sub_00000000000001","entity":"subscription","plan_id":"plan_00000000000001","status":"created","quantity":1,"total_count":12,"paid_count":0,"customer_notify":true,"short_url":"https://rzp.io/i/z3b1R61A9","notes":{},"created_at":1580283117}
   */
  async createSubscription(planId, totalCount, quantity, startAt, expireBy, customerNotify, addons, offerId, notes) {
    return await this.#apiRequest({
      logTag: '[createSubscription]',
      url: `${ API_BASE_URL }/subscriptions`,
      method: 'post',
      body: clean({
        plan_id: planId,
        total_count: totalCount,
        quantity,
        start_at: startAt,
        expire_by: expireBy,
        customer_notify: this.#toFlag(customerNotify),
        addons,
        offer_id: offerId,
        notes,
      }),
    })
  }

  /**
   * @operationName List Subscriptions
   * @category Subscriptions
   * @description Retrieves subscriptions on your account, optionally filtered by plan, with count/skip pagination (up to 100 records per call).
   * @route GET /list-subscriptions
   *
   * @paramDef {"type":"String","label":"Plan ID","name":"planId","dictionary":"getPlansDictionary","description":"Return only subscriptions on this plan, e.g. plan_00000000000001."}
   * @paramDef {"type":"Number","label":"Count","name":"count","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of subscriptions to return, between 1 and 100. Defaults to 10."}
   * @paramDef {"type":"Number","label":"Skip","name":"skip","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of subscriptions to skip from the start of the result set, for pagination."}
   *
   * @returns {Object}
   * @sampleResult {"entity":"collection","count":1,"items":[{"id":"sub_00000000000001","entity":"subscription","plan_id":"plan_00000000000001","status":"active","quantity":1,"total_count":12,"paid_count":3,"current_start":1580283117,"current_end":1582961517,"created_at":1580283117}]}
   */
  async listSubscriptions(planId, count, skip) {
    return await this.#apiRequest({
      logTag: '[listSubscriptions]',
      url: `${ API_BASE_URL }/subscriptions`,
      query: { plan_id: planId, count, skip },
    })
  }

  /**
   * @operationName Get Subscription
   * @category Subscriptions
   * @description Retrieves a single subscription by its ID, including its status (created, authenticated, active, pending, halted, paused, cancelled, completed, or expired), billing progress, and current cycle window.
   * @route GET /get-subscription
   *
   * @paramDef {"type":"String","label":"Subscription ID","name":"subscriptionId","required":true,"description":"Unique subscription identifier, e.g. sub_00000000000001."}
   *
   * @returns {Object}
   * @sampleResult {"id":"sub_00000000000001","entity":"subscription","plan_id":"plan_00000000000001","status":"active","quantity":1,"total_count":12,"paid_count":3,"remaining_count":9,"current_start":1580283117,"current_end":1582961517,"short_url":"https://rzp.io/i/z3b1R61A9","created_at":1580283117}
   */
  async getSubscription(subscriptionId) {
    return await this.#apiRequest({
      logTag: '[getSubscription]',
      url: `${ API_BASE_URL }/subscriptions/${ subscriptionId }`,
    })
  }

  /**
   * @operationName Update Subscription
   * @category Subscriptions
   * @description Updates an existing subscription: switch it to a different plan, change quantity or remaining billing cycles, and choose whether the change applies immediately or at the end of the current cycle.
   * @route PATCH /update-subscription
   *
   * @paramDef {"type":"String","label":"Subscription ID","name":"subscriptionId","required":true,"description":"Unique subscription identifier, e.g. sub_00000000000001."}
   * @paramDef {"type":"String","label":"Plan ID","name":"planId","dictionary":"getPlansDictionary","description":"New plan to move the subscription to, e.g. plan_00000000000002."}
   * @paramDef {"type":"Number","label":"Quantity","name":"quantity","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"New number of units of the plan item billed each cycle."}
   * @paramDef {"type":"Number","label":"Remaining Count","name":"remainingCount","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"New number of billing cycles remaining on the subscription."}
   * @paramDef {"type":"String","label":"Schedule Change At","name":"scheduleChangeAt","uiComponent":{"type":"DROPDOWN","options":{"values":["Now","Cycle End"]}},"description":"When the update takes effect: immediately (Now) or at the end of the current billing cycle (Cycle End). Defaults to Now."}
   * @paramDef {"type":"Boolean","label":"Notify Customer","name":"customerNotify","uiComponent":{"type":"TOGGLE"},"description":"When enabled, Razorpay notifies the customer about the change."}
   *
   * @returns {Object}
   * @sampleResult {"id":"sub_00000000000001","entity":"subscription","plan_id":"plan_00000000000002","status":"active","quantity":2,"total_count":12,"remaining_count":6,"has_scheduled_changes":false,"created_at":1580283117}
   */
  async updateSubscription(subscriptionId, planId, quantity, remainingCount, scheduleChangeAt, customerNotify) {
    return await this.#apiRequest({
      logTag: '[updateSubscription]',
      url: `${ API_BASE_URL }/subscriptions/${ subscriptionId }`,
      method: 'patch',
      body: clean({
        plan_id: planId,
        quantity,
        remaining_count: remainingCount,
        schedule_change_at: this.#resolveChoice(scheduleChangeAt, { 'Now': 'now', 'Cycle End': 'cycle_end' }),
        customer_notify: this.#toFlag(customerNotify),
      }),
    })
  }

  /**
   * @operationName Cancel Subscription
   * @category Subscriptions
   * @description Cancels an active subscription either immediately or at the end of the current billing cycle. Cancelled subscriptions cannot be reactivated.
   * @route POST /cancel-subscription
   *
   * @paramDef {"type":"String","label":"Subscription ID","name":"subscriptionId","required":true,"description":"Unique subscription identifier, e.g. sub_00000000000001."}
   * @paramDef {"type":"Boolean","label":"Cancel at Cycle End","name":"cancelAtCycleEnd","uiComponent":{"type":"TOGGLE"},"description":"When enabled, the subscription stays active until the end of the current billing cycle and is then cancelled. When disabled (default), it is cancelled immediately."}
   *
   * @returns {Object}
   * @sampleResult {"id":"sub_00000000000001","entity":"subscription","plan_id":"plan_00000000000001","status":"cancelled","quantity":1,"total_count":12,"paid_count":3,"ended_at":1580290000,"created_at":1580283117}
   */
  async cancelSubscription(subscriptionId, cancelAtCycleEnd) {
    return await this.#apiRequest({
      logTag: '[cancelSubscription]',
      url: `${ API_BASE_URL }/subscriptions/${ subscriptionId }/cancel`,
      method: 'post',
      body: clean({ cancel_at_cycle_end: this.#toFlag(cancelAtCycleEnd) }),
    })
  }

  /**
   * @operationName Pause Subscription
   * @category Subscriptions
   * @description Pauses an active subscription immediately, stopping all future charges until it is resumed. Only subscriptions in active status can be paused.
   * @route POST /pause-subscription
   *
   * @paramDef {"type":"String","label":"Subscription ID","name":"subscriptionId","required":true,"description":"Identifier of the active subscription to pause, e.g. sub_00000000000001."}
   *
   * @returns {Object}
   * @sampleResult {"id":"sub_00000000000001","entity":"subscription","plan_id":"plan_00000000000001","status":"paused","pause_initiated_by":"self","quantity":1,"total_count":12,"paid_count":3,"created_at":1580283117}
   */
  async pauseSubscription(subscriptionId) {
    return await this.#apiRequest({
      logTag: '[pauseSubscription]',
      url: `${ API_BASE_URL }/subscriptions/${ subscriptionId }/pause`,
      method: 'post',
      body: { pause_at: 'now' },
    })
  }

  /**
   * @operationName Resume Subscription
   * @category Subscriptions
   * @description Resumes a paused subscription immediately, restoring its billing schedule. Only subscriptions in paused status can be resumed.
   * @route POST /resume-subscription
   *
   * @paramDef {"type":"String","label":"Subscription ID","name":"subscriptionId","required":true,"description":"Identifier of the paused subscription to resume, e.g. sub_00000000000001."}
   *
   * @returns {Object}
   * @sampleResult {"id":"sub_00000000000001","entity":"subscription","plan_id":"plan_00000000000001","status":"active","quantity":1,"total_count":12,"paid_count":3,"created_at":1580283117}
   */
  async resumeSubscription(subscriptionId) {
    return await this.#apiRequest({
      logTag: '[resumeSubscription]',
      url: `${ API_BASE_URL }/subscriptions/${ subscriptionId }/resume`,
      method: 'post',
      body: { resume_at: 'now' },
    })
  }

  /**
   * @operationName Create Subscription Add-on
   * @category Subscriptions
   * @description Adds a one-time charge (add-on) to a subscription, billed on the next invoice. Define the add-on item inline with a name, amount, and currency, plus the quantity to charge.
   * @route POST /create-subscription-addon
   *
   * @paramDef {"type":"String","label":"Subscription ID","name":"subscriptionId","required":true,"description":"Identifier of the subscription to add the charge to, e.g. sub_00000000000001."}
   * @paramDef {"type":"String","label":"Item Name","name":"itemName","required":true,"description":"Name of the one-time charge, e.g. 'Setup fee'."}
   * @paramDef {"type":"Number","label":"Item Amount","name":"itemAmount","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Charge amount in the smallest currency unit (paise for INR: 10000 = ₹100)."}
   * @paramDef {"type":"String","label":"Item Currency","name":"itemCurrency","description":"ISO currency code for the charge, e.g. INR. Defaults to INR."}
   * @paramDef {"type":"Number","label":"Quantity","name":"quantity","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of units to charge. Defaults to 1."}
   *
   * @returns {Object}
   * @sampleResult {"id":"ao_00000000000001","entity":"addon","item":{"id":"item_00000000000001","active":true,"name":"Setup fee","amount":30000,"currency":"INR"},"quantity":1,"subscription_id":"sub_00000000000001","invoice_id":null,"created_at":1581597318}
   */
  async createSubscriptionAddon(subscriptionId, itemName, itemAmount, itemCurrency, quantity) {
    return await this.#apiRequest({
      logTag: '[createSubscriptionAddon]',
      url: `${ API_BASE_URL }/subscriptions/${ subscriptionId }/addons`,
      method: 'post',
      body: clean({
        item: clean({
          name: itemName,
          amount: itemAmount,
          currency: itemCurrency || DEFAULT_CURRENCY,
        }),
        quantity,
      }),
    })
  }

  /**
   * @operationName Get Add-on
   * @category Subscriptions
   * @description Retrieves a single subscription add-on by its ID, including the charged item, quantity, and the invoice it was billed on (null until billed).
   * @route GET /get-addon
   *
   * @paramDef {"type":"String","label":"Add-on ID","name":"addonId","required":true,"description":"Unique add-on identifier, e.g. ao_00000000000001."}
   *
   * @returns {Object}
   * @sampleResult {"id":"ao_00000000000001","entity":"addon","item":{"id":"item_00000000000001","active":true,"name":"Setup fee","amount":30000,"currency":"INR"},"quantity":1,"subscription_id":"sub_00000000000001","invoice_id":"inv_DAweOiQ7amIUVd","created_at":1581597318}
   */
  async getAddon(addonId) {
    return await this.#apiRequest({
      logTag: '[getAddon]',
      url: `${ API_BASE_URL }/addons/${ addonId }`,
    })
  }

  /**
   * @operationName Delete Add-on
   * @category Subscriptions
   * @description Deletes a subscription add-on that has not yet been billed on an invoice. Returns an empty array on success.
   * @route DELETE /delete-addon
   *
   * @paramDef {"type":"String","label":"Add-on ID","name":"addonId","required":true,"description":"Identifier of the unbilled add-on to delete, e.g. ao_00000000000001."}
   *
   * @returns {Array<Object>}
   * @sampleResult []
   */
  async deleteAddon(addonId) {
    return await this.#apiRequest({
      logTag: '[deleteAddon]',
      url: `${ API_BASE_URL }/addons/${ addonId }`,
      method: 'delete',
    })
  }

  /**
   * @operationName Create QR Code
   * @category QR Codes
   * @description Creates a UPI QR code that customers can scan to pay. Supports single-use codes (closed after one payment) or multiple-use codes, fixed or open payment amounts, an automatic close time, and linking payments to a customer.
   * @route POST /create-qr-code
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Label identifying the QR code, e.g. 'Store Front Display'."}
   * @paramDef {"type":"String","label":"Usage","name":"usage","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Single Use","Multiple Use"]}},"description":"Single Use codes close automatically after one successful payment; Multiple Use codes accept payments until closed."}
   * @paramDef {"type":"Boolean","label":"Fixed Amount","name":"fixedAmount","uiComponent":{"type":"TOGGLE"},"description":"When enabled, the QR code only accepts the exact Payment Amount; when disabled, customers can pay any amount."}
   * @paramDef {"type":"Number","label":"Payment Amount","name":"paymentAmount","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Amount to accept in the smallest currency unit (paise for INR: 10000 = ₹100). Required when Fixed Amount is enabled."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Purpose of the QR code shown alongside it, e.g. 'For Store 1'."}
   * @paramDef {"type":"String","label":"Customer ID","name":"customerId","dictionary":"getCustomersDictionary","description":"Optional customer to associate payments made on this QR code with, e.g. cust_1Aa00000000004."}
   * @paramDef {"type":"Number","label":"Close By","name":"closeBy","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Unix timestamp in seconds when the QR code closes automatically. Must be at least 2 minutes in the future."}
   * @paramDef {"type":"Object","label":"Notes","name":"notes","description":"Key-value pairs stored with the QR code. Maximum 15 pairs, 256 characters each."}
   *
   * @returns {Object}
   * @sampleResult {"id":"qr_HMsVL8HOpbMcjU","entity":"qr_code","name":"Store Front Display","usage":"single_use","type":"upi_qr","image_url":"https://rzp.io/i/BWcUVrLp","payment_amount":30000,"status":"active","fixed_amount":true,"payments_amount_received":0,"payments_count_received":0,"customer_id":"cust_1Aa00000000004","created_at":1623660301}
   */
  async createQrCode(name, usage, fixedAmount, paymentAmount, description, customerId, closeBy, notes) {
    return await this.#apiRequest({
      logTag: '[createQrCode]',
      url: `${ API_BASE_URL }/payments/qr_codes`,
      method: 'post',
      body: clean({
        type: 'upi_qr',
        name,
        usage: this.#resolveChoice(usage, { 'Single Use': 'single_use', 'Multiple Use': 'multiple_use' }),
        fixed_amount: fixedAmount,
        payment_amount: paymentAmount,
        description,
        customer_id: customerId,
        close_by: closeBy,
        notes,
      }),
    })
  }

  /**
   * @operationName List QR Codes
   * @category QR Codes
   * @description Retrieves QR codes created on your account with optional creation time range filtering and count/skip pagination (up to 100 records per call).
   * @route GET /list-qr-codes
   *
   * @paramDef {"type":"Number","label":"From","name":"from","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Unix timestamp in seconds; only QR codes created at or after this time are returned."}
   * @paramDef {"type":"Number","label":"To","name":"to","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Unix timestamp in seconds; only QR codes created at or before this time are returned."}
   * @paramDef {"type":"Number","label":"Count","name":"count","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of QR codes to return, between 1 and 100. Defaults to 10."}
   * @paramDef {"type":"Number","label":"Skip","name":"skip","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of QR codes to skip from the start of the result set, for pagination."}
   *
   * @returns {Object}
   * @sampleResult {"entity":"collection","count":1,"items":[{"id":"qr_HMsVL8HOpbMcjU","entity":"qr_code","name":"Store Front Display","usage":"single_use","type":"upi_qr","image_url":"https://rzp.io/i/BWcUVrLp","status":"active","fixed_amount":true,"payment_amount":30000,"created_at":1623660301}]}
   */
  async listQrCodes(from, to, count, skip) {
    return await this.#apiRequest({
      logTag: '[listQrCodes]',
      url: `${ API_BASE_URL }/payments/qr_codes`,
      query: { from, to, count, skip },
    })
  }

  /**
   * @operationName Get QR Code
   * @category QR Codes
   * @description Retrieves a single QR code by its ID, including its image URL, status (active or closed), usage type, and totals for payments received.
   * @route GET /get-qr-code
   *
   * @paramDef {"type":"String","label":"QR Code ID","name":"qrCodeId","required":true,"description":"Unique QR code identifier, e.g. qr_HMsVL8HOpbMcjU."}
   *
   * @returns {Object}
   * @sampleResult {"id":"qr_HMsVL8HOpbMcjU","entity":"qr_code","name":"Store Front Display","usage":"single_use","type":"upi_qr","image_url":"https://rzp.io/i/BWcUVrLp","status":"active","fixed_amount":true,"payment_amount":30000,"payments_amount_received":0,"payments_count_received":0,"created_at":1623660301}
   */
  async getQrCode(qrCodeId) {
    return await this.#apiRequest({
      logTag: '[getQrCode]',
      url: `${ API_BASE_URL }/payments/qr_codes/${ qrCodeId }`,
    })
  }

  /**
   * @operationName Close QR Code
   * @category QR Codes
   * @description Closes an active QR code so it can no longer accept payments. The close reason is recorded as 'on_demand'. Closed QR codes cannot be reactivated.
   * @route POST /close-qr-code
   *
   * @paramDef {"type":"String","label":"QR Code ID","name":"qrCodeId","required":true,"description":"Identifier of the active QR code to close, e.g. qr_HMsVL8HOpbMcjU."}
   *
   * @returns {Object}
   * @sampleResult {"id":"qr_HMsVL8HOpbMcjU","entity":"qr_code","name":"Store Front Display","usage":"single_use","type":"upi_qr","status":"closed","close_reason":"on_demand","closed_at":1623660591,"created_at":1623660301}
   */
  async closeQrCode(qrCodeId) {
    return await this.#apiRequest({
      logTag: '[closeQrCode]',
      url: `${ API_BASE_URL }/payments/qr_codes/${ qrCodeId }/close`,
      method: 'post',
      body: {},
    })
  }

  /**
   * @operationName List QR Code Payments
   * @category QR Codes
   * @description Retrieves payments made through a specific QR code, with optional creation time range filtering and count/skip pagination (up to 100 records per call).
   * @route GET /list-qr-code-payments
   *
   * @paramDef {"type":"String","label":"QR Code ID","name":"qrCodeId","required":true,"description":"Identifier of the QR code whose payments to list, e.g. qr_HMsVL8HOpbMcjU."}
   * @paramDef {"type":"Number","label":"From","name":"from","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Unix timestamp in seconds; only payments created at or after this time are returned."}
   * @paramDef {"type":"Number","label":"To","name":"to","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Unix timestamp in seconds; only payments created at or before this time are returned."}
   * @paramDef {"type":"Number","label":"Count","name":"count","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of payments to return, between 1 and 100. Defaults to 10."}
   * @paramDef {"type":"Number","label":"Skip","name":"skip","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of payments to skip from the start of the result set, for pagination."}
   *
   * @returns {Object}
   * @sampleResult {"entity":"collection","count":1,"items":[{"id":"pay_HMtDKn3TnF4D8x","entity":"payment","amount":30000,"currency":"INR","status":"captured","method":"upi","vpa":"customer@upi","email":"customer@example.com","contact":"+919000090000","created_at":1623660505}]}
   */
  async listQrCodePayments(qrCodeId, from, to, count, skip) {
    return await this.#apiRequest({
      logTag: '[listQrCodePayments]',
      url: `${ API_BASE_URL }/payments/qr_codes/${ qrCodeId }/payments`,
      query: { from, to, count, skip },
    })
  }

  /**
   * @operationName List Settlements
   * @category Settlements
   * @description Retrieves settlements of your Razorpay balance to your bank account, with optional creation time range filtering and count/skip pagination (up to 100 records per call). Amounts are in the smallest currency unit (paise).
   * @route GET /list-settlements
   *
   * @paramDef {"type":"Number","label":"From","name":"from","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Unix timestamp in seconds; only settlements created at or after this time are returned."}
   * @paramDef {"type":"Number","label":"To","name":"to","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Unix timestamp in seconds; only settlements created at or before this time are returned."}
   * @paramDef {"type":"Number","label":"Count","name":"count","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of settlements to return, between 1 and 100. Defaults to 10."}
   * @paramDef {"type":"Number","label":"Skip","name":"skip","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of settlements to skip from the start of the result set, for pagination."}
   *
   * @returns {Object}
   * @sampleResult {"entity":"collection","count":1,"items":[{"id":"setl_DGlQ1Rj8os78Ec","entity":"settlement","amount":9973635,"status":"processed","fees":471699,"tax":42070,"utr":"1568176960vxp0rj","created_at":1568176960}]}
   */
  async listSettlements(from, to, count, skip) {
    return await this.#apiRequest({
      logTag: '[listSettlements]',
      url: `${ API_BASE_URL }/settlements`,
      query: { from, to, count, skip },
    })
  }

  /**
   * @operationName Get Settlement
   * @category Settlements
   * @description Retrieves a single settlement by its ID, including the settled amount, fees, tax, status, and the bank UTR reference for tracing the transfer.
   * @route GET /get-settlement
   *
   * @paramDef {"type":"String","label":"Settlement ID","name":"settlementId","required":true,"description":"Unique settlement identifier, e.g. setl_DGlQ1Rj8os78Ec."}
   *
   * @returns {Object}
   * @sampleResult {"id":"setl_DGlQ1Rj8os78Ec","entity":"settlement","amount":9973635,"status":"processed","fees":471699,"tax":42070,"utr":"1568176960vxp0rj","created_at":1568176960}
   */
  async getSettlement(settlementId) {
    return await this.#apiRequest({
      logTag: '[getSettlement]',
      url: `${ API_BASE_URL }/settlements/${ settlementId }`,
    })
  }

  /**
   * @operationName Get Combined Settlement Recon
   * @category Settlements
   * @description Retrieves the combined settlement reconciliation report for a given day or month, breaking each settlement down into its component payments, refunds, transfers, and adjustments with fees and taxes. Omit the day to get the full month's report.
   * @route GET /get-combined-settlement-recon
   *
   * @paramDef {"type":"Number","label":"Year","name":"year","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Four-digit year of the report, e.g. 2024."}
   * @paramDef {"type":"Number","label":"Month","name":"month","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Month of the report, 1 to 12."}
   * @paramDef {"type":"Number","label":"Day","name":"day","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Day of the month, 1 to 31. Omit to retrieve the report for the whole month."}
   * @paramDef {"type":"Number","label":"Count","name":"count","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of records to return, between 1 and 100. Defaults to 10."}
   * @paramDef {"type":"Number","label":"Skip","name":"skip","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of records to skip from the start of the result set, for pagination."}
   *
   * @returns {Object}
   * @sampleResult {"entity":"report","count":1,"items":[{"entity_id":"pay_DEXrnRiR3SNDHA","type":"payment","debit":0,"credit":97100,"amount":100000,"currency":"INR","fee":2900,"tax":443,"settlement_id":"setl_DGlQ1Rj8os78Ec","settlement_utr":"1568176960vxp0rj","settled_at":1568176960}]}
   */
  async getCombinedSettlementRecon(year, month, day, count, skip) {
    return await this.#apiRequest({
      logTag: '[getCombinedSettlementRecon]',
      url: `${ API_BASE_URL }/settlements/recon/combined`,
      query: { year, month, day, count, skip },
    })
  }

  /**
   * @operationName Create On-demand Settlement
   * @category Settlements
   * @description Requests an instant (on-demand) settlement of your available balance to your bank account, instead of waiting for the scheduled settlement cycle. Settle a specific amount or your full available balance. On-demand settlements carry additional fees.
   * @route POST /create-on-demand-settlement
   *
   * @paramDef {"type":"Number","label":"Amount","name":"amount","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Amount to settle in the smallest currency unit (paise for INR: 10000 = ₹100). Minimum 200000 (₹2000)."}
   * @paramDef {"type":"Boolean","label":"Settle Full Balance","name":"settleFullBalance","uiComponent":{"type":"TOGGLE"},"description":"When enabled, Razorpay settles the maximum available amount and the Amount value acts as a lower bound."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Internal note describing why the settlement was requested, up to 30 characters."}
   * @paramDef {"type":"Object","label":"Notes","name":"notes","description":"Key-value pairs stored with the settlement request. Maximum 15 pairs, 256 characters each."}
   *
   * @returns {Object}
   * @sampleResult {"id":"setlod_FNj7g2YS5J67Rz","entity":"settlement.ondemand","amount_requested":200000,"amount_settled":0,"amount_pending":199410,"amount_reversed":0,"fees":590,"currency":"INR","status":"initiated","created_at":1596771429}
   */
  async createOnDemandSettlement(amount, settleFullBalance, description, notes) {
    return await this.#apiRequest({
      logTag: '[createOnDemandSettlement]',
      url: `${ API_BASE_URL }/settlements/ondemand`,
      method: 'post',
      body: clean({
        amount,
        settle_full_balance: settleFullBalance,
        description,
        notes,
      }),
    })
  }

  /**
   * @operationName List On-demand Settlements
   * @category Settlements
   * @description Retrieves on-demand (instant) settlement requests on your account, with optional creation time range filtering and count/skip pagination (up to 100 records per call).
   * @route GET /list-on-demand-settlements
   *
   * @paramDef {"type":"Number","label":"From","name":"from","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Unix timestamp in seconds; only settlement requests created at or after this time are returned."}
   * @paramDef {"type":"Number","label":"To","name":"to","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Unix timestamp in seconds; only settlement requests created at or before this time are returned."}
   * @paramDef {"type":"Number","label":"Count","name":"count","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of settlement requests to return, between 1 and 100. Defaults to 10."}
   * @paramDef {"type":"Number","label":"Skip","name":"skip","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of settlement requests to skip from the start of the result set, for pagination."}
   *
   * @returns {Object}
   * @sampleResult {"entity":"collection","count":1,"items":[{"id":"setlod_FNj7g2YS5J67Rz","entity":"settlement.ondemand","amount_requested":200000,"amount_settled":199410,"fees":590,"currency":"INR","status":"processed","created_at":1596771429}]}
   */
  async listOnDemandSettlements(from, to, count, skip) {
    return await this.#apiRequest({
      logTag: '[listOnDemandSettlements]',
      url: `${ API_BASE_URL }/settlements/ondemand`,
      query: { from, to, count, skip },
    })
  }

  /**
   * @operationName Get On-demand Settlement
   * @category Settlements
   * @description Retrieves a single on-demand settlement request by its ID, including requested, settled, pending, and reversed amounts, fees, and current status.
   * @route GET /get-on-demand-settlement
   *
   * @paramDef {"type":"String","label":"On-demand Settlement ID","name":"settlementId","required":true,"description":"Unique on-demand settlement identifier, e.g. setlod_FNj7g2YS5J67Rz."}
   *
   * @returns {Object}
   * @sampleResult {"id":"setlod_FNj7g2YS5J67Rz","entity":"settlement.ondemand","amount_requested":200000,"amount_settled":199410,"amount_pending":0,"amount_reversed":0,"fees":590,"currency":"INR","status":"processed","created_at":1596771429}
   */
  async getOnDemandSettlement(settlementId) {
    return await this.#apiRequest({
      logTag: '[getOnDemandSettlement]',
      url: `${ API_BASE_URL }/settlements/ondemand/${ settlementId }`,
    })
  }

  /**
   * @operationName Create Virtual Account
   * @category Virtual Accounts
   * @description Creates a virtual account (smart collect) that customers can transfer money into via bank transfer (NEFT/RTGS/IMPS) or UPI. Choose the receiver types to provision, optionally link a customer, and set an automatic close time.
   * @route POST /create-virtual-account
   *
   * @paramDef {"type":"Array<String>","label":"Receiver Types","name":"receiverTypes","uiComponent":{"type":"DROPDOWN","options":{"values":["Bank Account","VPA"]}},"description":"Receiver types to create for the virtual account: Bank Account (virtual account number + IFSC) and/or VPA (virtual UPI address). Defaults to Bank Account."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Internal description of the virtual account, e.g. 'Virtual Account for Gaurav Kumar'."}
   * @paramDef {"type":"String","label":"Customer ID","name":"customerId","dictionary":"getCustomersDictionary","description":"Optional customer to associate incoming payments with, e.g. cust_1Aa00000000004."}
   * @paramDef {"type":"Number","label":"Close By","name":"closeBy","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Unix timestamp in seconds when the virtual account closes automatically. Must be at least 15 minutes in the future."}
   * @paramDef {"type":"Object","label":"Notes","name":"notes","description":"Key-value pairs stored with the virtual account. Maximum 15 pairs, 256 characters each."}
   *
   * @returns {Object}
   * @sampleResult {"id":"va_DlGmm7jInLudH9","entity":"virtual_account","status":"active","description":"Virtual Account for Gaurav Kumar","amount_expected":null,"amount_paid":0,"customer_id":"cust_1Aa00000000004","receivers":[{"id":"ba_DlGmm9mSj8fjRM","entity":"bank_account","ifsc":"RATN0VAAPIS","bank_name":"RBL Bank","account_number":"1112220061746877","name":"Acme Corp"}],"created_at":1574837626}
   */
  async createVirtualAccount(receiverTypes, description, customerId, closeBy, notes) {
    const typeMapping = { 'Bank Account': 'bank_account', 'VPA': 'vpa' }
    const types = (receiverTypes || []).map(value => this.#resolveChoice(value, typeMapping)).filter(Boolean)

    return await this.#apiRequest({
      logTag: '[createVirtualAccount]',
      url: `${ API_BASE_URL }/virtual_accounts`,
      method: 'post',
      body: clean({
        receivers: { types: types.length ? types : ['bank_account'] },
        description,
        customer_id: customerId,
        close_by: closeBy,
        notes,
      }),
    })
  }

  /**
   * @operationName List Virtual Accounts
   * @category Virtual Accounts
   * @description Retrieves virtual accounts created on your account with optional creation time range filtering and count/skip pagination (up to 100 records per call).
   * @route GET /list-virtual-accounts
   *
   * @paramDef {"type":"Number","label":"From","name":"from","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Unix timestamp in seconds; only virtual accounts created at or after this time are returned."}
   * @paramDef {"type":"Number","label":"To","name":"to","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Unix timestamp in seconds; only virtual accounts created at or before this time are returned."}
   * @paramDef {"type":"Number","label":"Count","name":"count","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of virtual accounts to return, between 1 and 100. Defaults to 10."}
   * @paramDef {"type":"Number","label":"Skip","name":"skip","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of virtual accounts to skip from the start of the result set, for pagination."}
   *
   * @returns {Object}
   * @sampleResult {"entity":"collection","count":1,"items":[{"id":"va_DlGmm7jInLudH9","entity":"virtual_account","status":"active","description":"Virtual Account for Gaurav Kumar","amount_paid":0,"customer_id":"cust_1Aa00000000004","receivers":[{"id":"ba_DlGmm9mSj8fjRM","entity":"bank_account","ifsc":"RATN0VAAPIS","account_number":"1112220061746877"}],"created_at":1574837626}]}
   */
  async listVirtualAccounts(from, to, count, skip) {
    return await this.#apiRequest({
      logTag: '[listVirtualAccounts]',
      url: `${ API_BASE_URL }/virtual_accounts`,
      query: { from, to, count, skip },
    })
  }

  /**
   * @operationName Get Virtual Account
   * @category Virtual Accounts
   * @description Retrieves a single virtual account by its ID, including its status (active or closed), receivers (bank account details and/or VPA), amount paid, and linked customer.
   * @route GET /get-virtual-account
   *
   * @paramDef {"type":"String","label":"Virtual Account ID","name":"virtualAccountId","required":true,"description":"Unique virtual account identifier, e.g. va_DlGmm7jInLudH9."}
   *
   * @returns {Object}
   * @sampleResult {"id":"va_DlGmm7jInLudH9","entity":"virtual_account","status":"active","description":"Virtual Account for Gaurav Kumar","amount_expected":null,"amount_paid":0,"customer_id":"cust_1Aa00000000004","receivers":[{"id":"ba_DlGmm9mSj8fjRM","entity":"bank_account","ifsc":"RATN0VAAPIS","bank_name":"RBL Bank","account_number":"1112220061746877","name":"Acme Corp"}],"created_at":1574837626}
   */
  async getVirtualAccount(virtualAccountId) {
    return await this.#apiRequest({
      logTag: '[getVirtualAccount]',
      url: `${ API_BASE_URL }/virtual_accounts/${ virtualAccountId }`,
    })
  }

  /**
   * @operationName Close Virtual Account
   * @category Virtual Accounts
   * @description Closes an active virtual account so it can no longer receive payments. Closed virtual accounts cannot be reopened.
   * @route POST /close-virtual-account
   *
   * @paramDef {"type":"String","label":"Virtual Account ID","name":"virtualAccountId","required":true,"description":"Identifier of the active virtual account to close, e.g. va_DlGmm7jInLudH9."}
   *
   * @returns {Object}
   * @sampleResult {"id":"va_DlGmm7jInLudH9","entity":"virtual_account","status":"closed","description":"Virtual Account for Gaurav Kumar","amount_paid":15000,"closed_at":1574837726,"close_by":null,"created_at":1574837626}
   */
  async closeVirtualAccount(virtualAccountId) {
    return await this.#apiRequest({
      logTag: '[closeVirtualAccount]',
      url: `${ API_BASE_URL }/virtual_accounts/${ virtualAccountId }/close`,
      method: 'post',
      body: {},
    })
  }

  /**
   * @operationName List Virtual Account Payments
   * @category Virtual Accounts
   * @description Retrieves payments received into a specific virtual account, with optional creation time range filtering and count/skip pagination (up to 100 records per call).
   * @route GET /list-virtual-account-payments
   *
   * @paramDef {"type":"String","label":"Virtual Account ID","name":"virtualAccountId","required":true,"description":"Identifier of the virtual account whose payments to list, e.g. va_DlGmm7jInLudH9."}
   * @paramDef {"type":"Number","label":"From","name":"from","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Unix timestamp in seconds; only payments created at or after this time are returned."}
   * @paramDef {"type":"Number","label":"To","name":"to","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Unix timestamp in seconds; only payments created at or before this time are returned."}
   * @paramDef {"type":"Number","label":"Count","name":"count","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of payments to return, between 1 and 100. Defaults to 10."}
   * @paramDef {"type":"Number","label":"Skip","name":"skip","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of payments to skip from the start of the result set, for pagination."}
   *
   * @returns {Object}
   * @sampleResult {"entity":"collection","count":1,"items":[{"id":"pay_DEXrnRiR3SNDHA","entity":"payment","amount":15000,"currency":"INR","status":"captured","method":"bank_transfer","email":"customer@example.com","contact":"+919000090000","created_at":1574837710}]}
   */
  async listVirtualAccountPayments(virtualAccountId, from, to, count, skip) {
    return await this.#apiRequest({
      logTag: '[listVirtualAccountPayments]',
      url: `${ API_BASE_URL }/virtual_accounts/${ virtualAccountId }/payments`,
      query: { from, to, count, skip },
    })
  }

  /**
   * @typedef {Object} getCustomersDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter customers by name, email, or contact. Filtering is performed client-side on the retrieved page."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset (number of customers to skip) for retrieving the next page."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Customers Dictionary
   * @description Provides a searchable, paginated list of customers for selecting a customer ID in invoice, QR code, and virtual account operations. The option value is the customer ID.
   * @route POST /get-customers-dictionary
   * @paramDef {"type":"getCustomersDictionary__payload","label":"Payload","name":"payload","description":"Contains the optional search string and pagination cursor used to retrieve and filter customers."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Gaurav Kumar","value":"cust_1Aa00000000004","note":"gaurav.kumar@example.com"}],"cursor":"100"}
   */
  async getCustomersDictionary(payload) {
    const { search, cursor } = payload || {}
    const skip = Number(cursor) || 0

    const response = await this.#apiRequest({
      logTag: '[getCustomersDictionary]',
      url: `${ API_BASE_URL }/customers`,
      query: { count: DICTIONARY_PAGE_SIZE, skip },
    })

    const customers = response.items || []
    const searchLower = (search || '').toLowerCase()

    const items = customers
      .filter(customer => !searchLower ||
        `${ customer.name || '' } ${ customer.email || '' } ${ customer.contact || '' }`.toLowerCase().includes(searchLower))
      .map(customer => ({
        label: customer.name || customer.email || customer.id,
        value: customer.id,
        note: [customer.email, customer.contact].filter(Boolean).join(' | ') || undefined,
      }))

    return {
      items,
      cursor: customers.length === DICTIONARY_PAGE_SIZE ? String(skip + DICTIONARY_PAGE_SIZE) : null,
    }
  }

  /**
   * @typedef {Object} getPlansDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter plans by their item name. Filtering is performed client-side on the retrieved page."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset (number of plans to skip) for retrieving the next page."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Plans Dictionary
   * @description Provides a searchable, paginated list of subscription plans for selecting a plan ID in subscription operations. The option value is the plan ID; the note shows the billing cycle and amount.
   * @route POST /get-plans-dictionary
   * @paramDef {"type":"getPlansDictionary__payload","label":"Payload","name":"payload","description":"Contains the optional search string and pagination cursor used to retrieve and filter plans."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Monthly Pro Plan","value":"plan_00000000000001","note":"monthly x1 - 69900 INR"}],"cursor":null}
   */
  async getPlansDictionary(payload) {
    const { search, cursor } = payload || {}
    const skip = Number(cursor) || 0

    const response = await this.#apiRequest({
      logTag: '[getPlansDictionary]',
      url: `${ API_BASE_URL }/plans`,
      query: { count: DICTIONARY_PAGE_SIZE, skip },
    })

    const plans = response.items || []
    const searchLower = (search || '').toLowerCase()

    const items = plans
      .filter(plan => !searchLower || (plan.item?.name || plan.id).toLowerCase().includes(searchLower))
      .map(plan => ({
        label: plan.item?.name || plan.id,
        value: plan.id,
        note: plan.item ? `${ plan.period } x${ plan.interval } - ${ plan.item.amount } ${ plan.item.currency }` : undefined,
      }))

    return {
      items,
      cursor: plans.length === DICTIONARY_PAGE_SIZE ? String(skip + DICTIONARY_PAGE_SIZE) : null,
    }
  }

  /**
   * @typedef {Object} getItemsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter items by name or description. Filtering is performed client-side on the retrieved page."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset (number of items to skip) for retrieving the next page."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Items Dictionary
   * @description Provides a searchable, paginated list of billing items for selecting an item ID in item operations and invoice line items. The option value is the item ID; the note shows the unit price.
   * @route POST /get-items-dictionary
   * @paramDef {"type":"getItemsDictionary__payload","label":"Payload","name":"payload","description":"Contains the optional search string and pagination cursor used to retrieve and filter items."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Book / English August","value":"item_7Oxp4hmm6T4SCn","note":"20000 INR"}],"cursor":null}
   */
  async getItemsDictionary(payload) {
    const { search, cursor } = payload || {}
    const skip = Number(cursor) || 0

    const response = await this.#apiRequest({
      logTag: '[getItemsDictionary]',
      url: `${ API_BASE_URL }/items`,
      query: { count: DICTIONARY_PAGE_SIZE, skip },
    })

    const rawItems = response.items || []
    const searchLower = (search || '').toLowerCase()

    const items = rawItems
      .filter(item => !searchLower ||
        `${ item.name || '' } ${ item.description || '' }`.toLowerCase().includes(searchLower))
      .map(item => ({
        label: item.name || item.id,
        value: item.id,
        note: `${ item.amount } ${ item.currency }${ item.active === false ? ' (inactive)' : '' }`,
      }))

    return {
      items,
      cursor: rawItems.length === DICTIONARY_PAGE_SIZE ? String(skip + DICTIONARY_PAGE_SIZE) : null,
    }
  }
}

Flowrunner.ServerCode.addService(RazorpayService, [
  {
    name: 'keyId',
    displayName: 'Key ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your API Key ID (starts with rzp_test_... or rzp_live_...). Generate it in the Razorpay Dashboard under Account & Settings > API Keys.',
  },
  {
    name: 'keySecret',
    displayName: 'Key Secret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your API Key Secret, shown once when the key pair is generated in the Razorpay Dashboard. Used together with the Key ID for Basic authentication.',
  },
])
