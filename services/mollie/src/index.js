const logger = {
  info: (...args) => console.log('[Mollie] info:', ...args),
  debug: (...args) => console.log('[Mollie] debug:', ...args),
  error: (...args) => console.log('[Mollie] error:', ...args),
  warn: (...args) => console.log('[Mollie] warn:', ...args),
}

const API_BASE_URL = 'https://api.mollie.com/v2'

const ZERO_DECIMAL_CURRENCIES = ['JPY', 'ISK']

const PAYMENT_METHOD_MAP = {
  'iDEAL': 'ideal',
  'Credit Card': 'creditcard',
  'PayPal': 'paypal',
  'Bancontact': 'bancontact',
  'SEPA Direct Debit': 'directdebit',
  'Bank Transfer': 'banktransfer',
  'Apple Pay': 'applepay',
  'Klarna Pay Later': 'klarnapaylater',
  'Przelewy24': 'przelewy24',
  'EPS': 'eps',
}

const MANDATE_METHOD_MAP = {
  'SEPA Direct Debit': 'directdebit',
  'PayPal': 'paypal',
}

const SUBSCRIPTION_METHOD_MAP = {
  'Credit Card': 'creditcard',
  'SEPA Direct Debit': 'directdebit',
  'PayPal': 'paypal',
}

const SEQUENCE_TYPE_MAP = {
  'One-off': 'oneoff',
  'First': 'first',
  'Recurring': 'recurring',
}

const EMBED_MAP = {
  'Refunds': 'refunds',
  'Chargebacks': 'chargebacks',
  'Captures': 'captures',
  'Refunds and Chargebacks': 'refunds,chargebacks',
  'All': 'refunds,chargebacks,captures',
}

const GROUPING_MAP = {
  'Status Balances': 'status-balances',
  'Transaction Categories': 'transaction-categories',
}

const RESOURCE_MAP = {
  'Payments': 'payments',
  'Orders': 'orders',
}

const LOCALE_MAP = {
  'English (US)': 'en_US',
  'English (UK)': 'en_GB',
  'Dutch (Netherlands)': 'nl_NL',
  'Dutch (Belgium)': 'nl_BE',
  'German (Germany)': 'de_DE',
  'German (Austria)': 'de_AT',
  'German (Switzerland)': 'de_CH',
  'French (France)': 'fr_FR',
  'French (Belgium)': 'fr_BE',
  'Spanish': 'es_ES',
  'Catalan': 'ca_ES',
  'Portuguese': 'pt_PT',
  'Italian': 'it_IT',
  'Norwegian': 'nb_NO',
  'Swedish': 'sv_SE',
  'Finnish': 'fi_FI',
  'Danish': 'da_DK',
  'Icelandic': 'is_IS',
  'Hungarian': 'hu_HU',
  'Polish': 'pl_PL',
  'Latvian': 'lv_LV',
  'Lithuanian': 'lt_LT',
}

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
 * @integrationName Mollie
 * @integrationIcon /icon.png
 */
class MollieService {
  constructor(config) {
    this.apiKey = config.apiKey
  }

  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - API request: [${ method.toUpperCase() }::${ url }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Authorization': `Bearer ${ this.apiKey }`,
          'Content-Type': 'application/json',
        })
        .query(cleanedQuery || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const detail = error.body?.detail || error.body?.title || error.message
      const field = error.body?.field ? ` (field: ${ error.body.field })` : ''

      logger.error(`${ logTag } - request failed: ${ detail }${ field }`)

      throw new Error(`Mollie API error: ${ detail }${ field }`)
    }
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  #formatAmount(value, currency) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    const numeric = typeof value === 'number' ? value : Number(String(value).trim().replace(',', '.'))

    if (!Number.isFinite(numeric)) {
      throw new Error(`Mollie API error: invalid amount value "${ value }". Provide a number such as 10.00`)
    }

    const code = (currency || 'EUR').toUpperCase()
    const decimals = ZERO_DECIMAL_CURRENCIES.includes(code) ? 0 : 2

    return { currency: code, value: numeric.toFixed(decimals) }
  }

  #unwrapList(response, resourceKey) {
    const items = response?._embedded?.[resourceKey] || []
    const nextHref = response?._links?.next?.href

    let nextCursor = null

    if (nextHref) {
      try {
        nextCursor = new URL(nextHref).searchParams.get('from')
      } catch (error) {
        nextCursor = null
      }
    }

    return {
      items,
      count: response?.count ?? items.length,
      nextCursor,
    }
  }

  async #listResource({ url, resourceKey, logTag, query }) {
    const response = await this.#apiRequest({ url, method: 'get', query, logTag })

    return this.#unwrapList(response, resourceKey)
  }

  // ---------------------------------------------------------------------------
  // Payments
  // ---------------------------------------------------------------------------

  /**
   * @operationName Create Payment
   * @category Payments
   * @description Creates a payment in Mollie and returns it together with a hosted checkout URL (checkoutUrl) to redirect the customer to. Leave Method empty to let the customer choose from all payment methods enabled on your profile. Amounts are sent as Mollie amount objects with a string value with two decimals (e.g. 10.00). Set Sequence Type to First to establish a mandate for later recurring charges, or Recurring together with a Customer ID to charge an existing mandate without customer interaction. Due Date only applies to bank transfer payments; Lines itemize the payment and are required by some methods such as Klarna.
   * @route POST /payments
   *
   * @paramDef {"type":"String","label":"Amount","name":"amount","required":true,"description":"The amount to charge, e.g. 10.00. It is formatted automatically into the two-decimal string Mollie requires (no decimals for JPY and ISK)."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","defaultValue":"EUR","description":"Three-letter ISO 4217 currency code, e.g. EUR, USD, GBP. Defaults to EUR."}
   * @paramDef {"type":"String","label":"Description","name":"description","required":true,"description":"Payment description shown to the customer on their bank or card statement and in the Mollie Dashboard."}
   * @paramDef {"type":"String","label":"Redirect URL","name":"redirectUrl","description":"URL the customer is redirected to after completing or abandoning checkout. Required for one-off and first payments; not needed for recurring payments."}
   * @paramDef {"type":"String","label":"Cancel URL","name":"cancelUrl","description":"URL the customer is redirected to when they cancel at the checkout. If omitted, the Redirect URL is used."}
   * @paramDef {"type":"String","label":"Webhook URL","name":"webhookUrl","description":"Publicly reachable URL Mollie calls with the payment ID whenever the payment status changes."}
   * @paramDef {"type":"String","label":"Method","name":"method","uiComponent":{"type":"DROPDOWN","options":{"values":["iDEAL","Credit Card","PayPal","Bancontact","SEPA Direct Debit","Bank Transfer","Apple Pay","Klarna Pay Later","Przelewy24","EPS"]}},"description":"Force a specific payment method. Leave empty to let the customer pick any method enabled on your profile in the hosted checkout."}
   * @paramDef {"type":"String","label":"Locale","name":"locale","uiComponent":{"type":"DROPDOWN","options":{"values":["English (US)","English (UK)","Dutch (Netherlands)","Dutch (Belgium)","German (Germany)","German (Austria)","German (Switzerland)","French (France)","French (Belgium)","Spanish","Catalan","Portuguese","Italian","Norwegian","Swedish","Finnish","Danish","Icelandic","Hungarian","Polish","Latvian","Lithuanian"]}},"description":"Language of the hosted checkout. If empty, Mollie detects it from the customer's browser."}
   * @paramDef {"type":"Object","label":"Metadata","name":"metadata","description":"Any JSON object to store with the payment, e.g. your own order ID. Returned with the payment and included in webhooks."}
   * @paramDef {"type":"String","label":"Sequence Type","name":"sequenceType","uiComponent":{"type":"DROPDOWN","options":{"values":["One-off","First","Recurring"]}},"description":"One-off is a regular payment (default). First starts a checkout that creates a mandate for recurring charges. Recurring charges an existing mandate without customer interaction and requires a Customer ID."}
   * @paramDef {"type":"String","label":"Customer ID","name":"customerId","dictionary":"getCustomersDictionary","description":"Mollie customer to attach the payment to, e.g. cst_8wmqcHMN4U. Required for recurring payments."}
   * @paramDef {"type":"String","label":"Mandate ID","name":"mandateId","description":"Specific mandate to charge for recurring payments, e.g. mdt_h3gAaD5zP. If omitted, Mollie uses the customer's most recent valid mandate."}
   * @paramDef {"type":"String","label":"Due Date","name":"dueDate","description":"Latest date the payment may be completed, in YYYY-MM-DD format. Only applies to bank transfer payments."}
   * @paramDef {"type":"Object","label":"Billing Address","name":"billingAddress","description":"Customer billing address object with keys such as streetAndNumber, postalCode, city, country (ISO 3166-1 alpha-2), givenName, familyName, email. Required by some methods such as Klarna."}
   * @paramDef {"type":"Array<Object>","label":"Lines","name":"lines","description":"Order line items for itemized payments. Each line supports keys such as description, quantity, unitPrice {currency, value}, totalAmount {currency, value}, vatRate, vatAmount, sku. Required by some methods such as Klarna."}
   *
   * @returns {Object}
   * @sampleResult {"resource":"payment","id":"tr_7UhSN1zuXS","mode":"test","createdAt":"2026-07-17T10:00:00+00:00","amount":{"currency":"EUR","value":"10.00"},"description":"Order #12345","method":"ideal","status":"open","isCancelable":false,"expiresAt":"2026-07-17T10:15:00+00:00","profileId":"pfl_QkEhN94Ba","sequenceType":"oneoff","redirectUrl":"https://example.org/return","checkoutUrl":"https://www.mollie.com/checkout/select-method/7UhSN1zuXS"}
   */
  async createPayment(amount, currency, description, redirectUrl, cancelUrl, webhookUrl, method, locale, metadata, sequenceType, customerId, mandateId, dueDate, billingAddress, lines) {
    const logTag = '[createPayment]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/payments`,
      method: 'post',
      body: clean({
        amount: this.#formatAmount(amount, currency),
        description,
        redirectUrl,
        cancelUrl,
        webhookUrl,
        method: this.#resolveChoice(method, PAYMENT_METHOD_MAP),
        locale: this.#resolveChoice(locale, LOCALE_MAP),
        metadata,
        sequenceType: this.#resolveChoice(sequenceType, SEQUENCE_TYPE_MAP),
        customerId,
        mandateId,
        dueDate,
        billingAddress,
        lines,
      }),
    })

    return { ...response, checkoutUrl: response?._links?.checkout?.href || null }
  }

  /**
   * @operationName List Payments
   * @category Payments
   * @description Retrieves payments created with the current API key, newest first. Returns up to 250 payments per page as a plain items array with a nextCursor for fetching the next page.
   * @route GET /payments
   *
   * @paramDef {"type":"String","label":"From","name":"from","description":"Pagination cursor: the payment ID to start the result set from. Use the nextCursor value returned by a previous call."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of payments to return per page (default 50, maximum 250)."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"resource":"payment","id":"tr_7UhSN1zuXS","mode":"live","status":"paid","amount":{"currency":"EUR","value":"10.00"},"description":"Order #12345","method":"ideal","createdAt":"2026-07-17T10:00:00+00:00"}],"count":1,"nextCursor":"tr_8XiTO2abYT"}
   */
  async listPayments(from, limit) {
    return await this.#listResource({
      logTag: '[listPayments]',
      url: `${ API_BASE_URL }/payments`,
      resourceKey: 'payments',
      query: { from, limit },
    })
  }

  /**
   * @operationName Get Payment
   * @category Payments
   * @description Retrieves a single payment by its ID, including status, amounts (paid, remaining, refunded), payment method details, and metadata. Optionally embeds the payment's refunds, chargebacks, and/or captures in the response.
   * @route GET /payments/{paymentId}
   *
   * @paramDef {"type":"String","label":"Payment ID","name":"paymentId","required":true,"description":"The Mollie payment ID, e.g. tr_7UhSN1zuXS."}
   * @paramDef {"type":"String","label":"Embed","name":"embed","uiComponent":{"type":"DROPDOWN","options":{"values":["Refunds","Chargebacks","Captures","Refunds and Chargebacks","All"]}},"description":"Include related resources in the _embedded property of the response."}
   *
   * @returns {Object}
   * @sampleResult {"resource":"payment","id":"tr_7UhSN1zuXS","mode":"live","status":"paid","amount":{"currency":"EUR","value":"10.00"},"amountRefunded":{"currency":"EUR","value":"0.00"},"amountRemaining":{"currency":"EUR","value":"10.00"},"description":"Order #12345","method":"ideal","paidAt":"2026-07-17T10:05:00+00:00","createdAt":"2026-07-17T10:00:00+00:00","profileId":"pfl_QkEhN94Ba","sequenceType":"oneoff","metadata":{"orderId":"12345"}}
   */
  async getPayment(paymentId, embed) {
    return await this.#apiRequest({
      logTag: '[getPayment]',
      url: `${ API_BASE_URL }/payments/${ paymentId }`,
      query: { embed: this.#resolveChoice(embed, EMBED_MAP) },
    })
  }

  /**
   * @operationName Update Payment
   * @category Payments
   * @description Updates the description, redirect URL, webhook URL, or metadata of an existing payment. Only certain properties can be changed, and generally only while the payment is still open.
   * @route PATCH /payments/{paymentId}
   *
   * @paramDef {"type":"String","label":"Payment ID","name":"paymentId","required":true,"description":"The Mollie payment ID, e.g. tr_7UhSN1zuXS."}
   * @paramDef {"type":"String","label":"Description","name":"description","description":"New payment description shown to the customer."}
   * @paramDef {"type":"String","label":"Redirect URL","name":"redirectUrl","description":"New URL the customer is redirected to after checkout."}
   * @paramDef {"type":"String","label":"Webhook URL","name":"webhookUrl","description":"New webhook URL Mollie calls on payment status changes."}
   * @paramDef {"type":"Object","label":"Metadata","name":"metadata","description":"JSON object that replaces the metadata stored on the payment."}
   *
   * @returns {Object}
   * @sampleResult {"resource":"payment","id":"tr_7UhSN1zuXS","mode":"live","status":"open","amount":{"currency":"EUR","value":"10.00"},"description":"Updated order #12345","redirectUrl":"https://example.org/return","webhookUrl":"https://example.org/webhook","metadata":{"orderId":"12345"},"createdAt":"2026-07-17T10:00:00+00:00"}
   */
  async updatePayment(paymentId, description, redirectUrl, webhookUrl, metadata) {
    return await this.#apiRequest({
      logTag: '[updatePayment]',
      url: `${ API_BASE_URL }/payments/${ paymentId }`,
      method: 'patch',
      body: clean({ description, redirectUrl, webhookUrl, metadata }),
    })
  }

  /**
   * @operationName Cancel Payment
   * @category Payments
   * @description Cancels a payment that has not been completed yet. Only possible while the payment's isCancelable property is true (e.g. open bank transfer payments or authorized card payments). Returns the payment with status canceled.
   * @route DELETE /payments/{paymentId}
   *
   * @paramDef {"type":"String","label":"Payment ID","name":"paymentId","required":true,"description":"The Mollie payment ID, e.g. tr_7UhSN1zuXS."}
   *
   * @returns {Object}
   * @sampleResult {"resource":"payment","id":"tr_7UhSN1zuXS","mode":"live","status":"canceled","canceledAt":"2026-07-17T11:00:00+00:00","amount":{"currency":"EUR","value":"10.00"},"description":"Order #12345","method":"banktransfer","createdAt":"2026-07-17T10:00:00+00:00"}
   */
  async cancelPayment(paymentId) {
    return await this.#apiRequest({
      logTag: '[cancelPayment]',
      url: `${ API_BASE_URL }/payments/${ paymentId }`,
      method: 'delete',
    })
  }

  // ---------------------------------------------------------------------------
  // Refunds
  // ---------------------------------------------------------------------------

  /**
   * @operationName Create Refund
   * @category Refunds
   * @description Refunds a paid payment, fully or partially. If no amount is provided, the payment's full remaining refundable amount is refunded automatically. Partial refunds can be created repeatedly as long as a refundable amount remains. The refund is processed towards the customer's original payment method.
   * @route POST /payments/{paymentId}/refunds
   *
   * @paramDef {"type":"String","label":"Payment ID","name":"paymentId","required":true,"description":"The Mollie payment ID to refund, e.g. tr_7UhSN1zuXS."}
   * @paramDef {"type":"String","label":"Amount","name":"amount","description":"The amount to refund, e.g. 5.00. Leave empty to refund the full remaining refundable amount of the payment."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","defaultValue":"EUR","description":"Three-letter ISO 4217 currency code of the refund amount. Must match the payment currency. Defaults to EUR."}
   * @paramDef {"type":"String","label":"Description","name":"description","description":"Refund description that may be shown to the customer on their statement, depending on the payment method."}
   * @paramDef {"type":"Object","label":"Metadata","name":"metadata","description":"Any JSON object to store with the refund, e.g. your own reference."}
   *
   * @returns {Object}
   * @sampleResult {"resource":"refund","id":"re_4qqhO89gsT","amount":{"currency":"EUR","value":"5.00"},"status":"pending","createdAt":"2026-07-17T11:00:00+00:00","description":"Refund for order #12345","paymentId":"tr_7UhSN1zuXS"}
   */
  async createRefund(paymentId, amount, currency, description, metadata) {
    const logTag = '[createRefund]'

    let amountObject = this.#formatAmount(amount, currency)

    if (!amountObject) {
      const payment = await this.#apiRequest({
        logTag,
        url: `${ API_BASE_URL }/payments/${ paymentId }`,
      })

      amountObject = payment.amountRemaining || payment.amount
    }

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/payments/${ paymentId }/refunds`,
      method: 'post',
      body: clean({ amount: amountObject, description, metadata }),
    })
  }

  /**
   * @operationName List Payment Refunds
   * @category Refunds
   * @description Retrieves all refunds created for a specific payment, newest first, as a plain items array with a nextCursor for pagination.
   * @route GET /payments/{paymentId}/refunds
   *
   * @paramDef {"type":"String","label":"Payment ID","name":"paymentId","required":true,"description":"The Mollie payment ID, e.g. tr_7UhSN1zuXS."}
   * @paramDef {"type":"String","label":"From","name":"from","description":"Pagination cursor: the refund ID to start the result set from. Use the nextCursor value returned by a previous call."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of refunds to return per page (default 50, maximum 250)."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"resource":"refund","id":"re_4qqhO89gsT","amount":{"currency":"EUR","value":"5.00"},"status":"refunded","createdAt":"2026-07-17T11:00:00+00:00","paymentId":"tr_7UhSN1zuXS"}],"count":1,"nextCursor":null}
   */
  async listPaymentRefunds(paymentId, from, limit) {
    return await this.#listResource({
      logTag: '[listPaymentRefunds]',
      url: `${ API_BASE_URL }/payments/${ paymentId }/refunds`,
      resourceKey: 'refunds',
      query: { from, limit },
    })
  }

  /**
   * @operationName Get Refund
   * @category Refunds
   * @description Retrieves a single refund by its ID and the ID of the payment it belongs to, including its amount, status (queued, pending, processing, refunded, failed, canceled), and settlement amount.
   * @route GET /payments/{paymentId}/refunds/{refundId}
   *
   * @paramDef {"type":"String","label":"Payment ID","name":"paymentId","required":true,"description":"The Mollie payment ID, e.g. tr_7UhSN1zuXS."}
   * @paramDef {"type":"String","label":"Refund ID","name":"refundId","required":true,"description":"The Mollie refund ID, e.g. re_4qqhO89gsT."}
   *
   * @returns {Object}
   * @sampleResult {"resource":"refund","id":"re_4qqhO89gsT","amount":{"currency":"EUR","value":"5.00"},"settlementAmount":{"currency":"EUR","value":"-5.00"},"status":"refunded","createdAt":"2026-07-17T11:00:00+00:00","description":"Refund for order #12345","paymentId":"tr_7UhSN1zuXS"}
   */
  async getRefund(paymentId, refundId) {
    return await this.#apiRequest({
      logTag: '[getRefund]',
      url: `${ API_BASE_URL }/payments/${ paymentId }/refunds/${ refundId }`,
    })
  }

  /**
   * @operationName Cancel Refund
   * @category Refunds
   * @description Cancels a refund that has not been processed yet. Only refunds with status queued or pending can be canceled; once a refund reaches processing it can no longer be stopped.
   * @route DELETE /payments/{paymentId}/refunds/{refundId}
   *
   * @paramDef {"type":"String","label":"Payment ID","name":"paymentId","required":true,"description":"The Mollie payment ID, e.g. tr_7UhSN1zuXS."}
   * @paramDef {"type":"String","label":"Refund ID","name":"refundId","required":true,"description":"The Mollie refund ID to cancel, e.g. re_4qqhO89gsT."}
   *
   * @returns {Object}
   * @sampleResult {"canceled":true,"paymentId":"tr_7UhSN1zuXS","refundId":"re_4qqhO89gsT"}
   */
  async cancelRefund(paymentId, refundId) {
    await this.#apiRequest({
      logTag: '[cancelRefund]',
      url: `${ API_BASE_URL }/payments/${ paymentId }/refunds/${ refundId }`,
      method: 'delete',
    })

    return { canceled: true, paymentId, refundId }
  }

  /**
   * @operationName List All Refunds
   * @category Refunds
   * @description Retrieves all refunds across all payments created with the current API key, newest first, as a plain items array with a nextCursor for pagination.
   * @route GET /refunds
   *
   * @paramDef {"type":"String","label":"From","name":"from","description":"Pagination cursor: the refund ID to start the result set from. Use the nextCursor value returned by a previous call."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of refunds to return per page (default 50, maximum 250)."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"resource":"refund","id":"re_4qqhO89gsT","amount":{"currency":"EUR","value":"5.00"},"status":"refunded","createdAt":"2026-07-17T11:00:00+00:00","paymentId":"tr_7UhSN1zuXS"}],"count":1,"nextCursor":"re_5rriP90htU"}
   */
  async listAllRefunds(from, limit) {
    return await this.#listResource({
      logTag: '[listAllRefunds]',
      url: `${ API_BASE_URL }/refunds`,
      resourceKey: 'refunds',
      query: { from, limit },
    })
  }

  // ---------------------------------------------------------------------------
  // Chargebacks
  // ---------------------------------------------------------------------------

  /**
   * @operationName List Payment Chargebacks
   * @category Chargebacks
   * @description Retrieves all chargebacks issued for a specific payment as a plain items array with a nextCursor for pagination. Chargebacks occur when a customer disputes a payment through their bank or card issuer.
   * @route GET /payments/{paymentId}/chargebacks
   *
   * @paramDef {"type":"String","label":"Payment ID","name":"paymentId","required":true,"description":"The Mollie payment ID, e.g. tr_7UhSN1zuXS."}
   * @paramDef {"type":"String","label":"From","name":"from","description":"Pagination cursor: the chargeback ID to start the result set from. Use the nextCursor value returned by a previous call."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of chargebacks to return per page (default 50, maximum 250)."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"resource":"chargeback","id":"chb_n9z0tp","amount":{"currency":"EUR","value":"-13.00"},"createdAt":"2026-07-17T11:00:00+00:00","reason":{"code":"AC01","description":"Account identifier incorrect"},"paymentId":"tr_7UhSN1zuXS"}],"count":1,"nextCursor":null}
   */
  async listPaymentChargebacks(paymentId, from, limit) {
    return await this.#listResource({
      logTag: '[listPaymentChargebacks]',
      url: `${ API_BASE_URL }/payments/${ paymentId }/chargebacks`,
      resourceKey: 'chargebacks',
      query: { from, limit },
    })
  }

  /**
   * @operationName Get Chargeback
   * @category Chargebacks
   * @description Retrieves a single chargeback by its ID and the ID of the payment it belongs to, including the disputed amount, settlement impact, and the reason reported by the bank or card scheme.
   * @route GET /payments/{paymentId}/chargebacks/{chargebackId}
   *
   * @paramDef {"type":"String","label":"Payment ID","name":"paymentId","required":true,"description":"The Mollie payment ID, e.g. tr_7UhSN1zuXS."}
   * @paramDef {"type":"String","label":"Chargeback ID","name":"chargebackId","required":true,"description":"The Mollie chargeback ID, e.g. chb_n9z0tp."}
   *
   * @returns {Object}
   * @sampleResult {"resource":"chargeback","id":"chb_n9z0tp","amount":{"currency":"EUR","value":"-13.00"},"settlementAmount":{"currency":"EUR","value":"-13.00"},"createdAt":"2026-07-17T11:00:00+00:00","reason":{"code":"AC01","description":"Account identifier incorrect"},"paymentId":"tr_7UhSN1zuXS"}
   */
  async getChargeback(paymentId, chargebackId) {
    return await this.#apiRequest({
      logTag: '[getChargeback]',
      url: `${ API_BASE_URL }/payments/${ paymentId }/chargebacks/${ chargebackId }`,
    })
  }

  /**
   * @operationName List All Chargebacks
   * @category Chargebacks
   * @description Retrieves all chargebacks across all payments created with the current API key, newest first, as a plain items array with a nextCursor for pagination. Useful for dispute monitoring and reconciliation.
   * @route GET /chargebacks
   *
   * @paramDef {"type":"String","label":"From","name":"from","description":"Pagination cursor: the chargeback ID to start the result set from. Use the nextCursor value returned by a previous call."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of chargebacks to return per page (default 50, maximum 250)."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"resource":"chargeback","id":"chb_n9z0tp","amount":{"currency":"EUR","value":"-13.00"},"createdAt":"2026-07-17T11:00:00+00:00","paymentId":"tr_7UhSN1zuXS"}],"count":1,"nextCursor":"chb_p1a2b3"}
   */
  async listAllChargebacks(from, limit) {
    return await this.#listResource({
      logTag: '[listAllChargebacks]',
      url: `${ API_BASE_URL }/chargebacks`,
      resourceKey: 'chargebacks',
      query: { from, limit },
    })
  }

  // ---------------------------------------------------------------------------
  // Captures
  // ---------------------------------------------------------------------------

  /**
   * @operationName Create Capture
   * @category Captures
   * @description Captures an authorized payment, transferring the reserved funds to your account. Applies to card and Klarna payments created with a manual capture mode. Leave the amount empty to capture the full authorized amount; provide an amount for a partial capture.
   * @route POST /payments/{paymentId}/captures
   *
   * @paramDef {"type":"String","label":"Payment ID","name":"paymentId","required":true,"description":"The Mollie payment ID with status authorized, e.g. tr_WDqYK6vllg."}
   * @paramDef {"type":"String","label":"Amount","name":"amount","description":"The amount to capture, e.g. 35.95. Leave empty to capture the full authorized amount."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","defaultValue":"EUR","description":"Three-letter ISO 4217 currency code of the capture amount. Must match the payment currency. Defaults to EUR."}
   * @paramDef {"type":"String","label":"Description","name":"description","description":"Description of the capture, shown in the Mollie Dashboard."}
   *
   * @returns {Object}
   * @sampleResult {"resource":"capture","id":"cpt_4qqhO89gsT","mode":"live","amount":{"currency":"EUR","value":"35.95"},"status":"succeeded","paymentId":"tr_WDqYK6vllg","createdAt":"2026-07-17T11:00:00+00:00"}
   */
  async createCapture(paymentId, amount, currency, description) {
    return await this.#apiRequest({
      logTag: '[createCapture]',
      url: `${ API_BASE_URL }/payments/${ paymentId }/captures`,
      method: 'post',
      body: clean({
        amount: this.#formatAmount(amount, currency),
        description,
      }),
    })
  }

  /**
   * @operationName List Captures
   * @category Captures
   * @description Retrieves all captures created for a specific payment as a plain items array with a nextCursor for pagination.
   * @route GET /payments/{paymentId}/captures
   *
   * @paramDef {"type":"String","label":"Payment ID","name":"paymentId","required":true,"description":"The Mollie payment ID, e.g. tr_WDqYK6vllg."}
   * @paramDef {"type":"String","label":"From","name":"from","description":"Pagination cursor: the capture ID to start the result set from. Use the nextCursor value returned by a previous call."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of captures to return per page (default 50, maximum 250)."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"resource":"capture","id":"cpt_4qqhO89gsT","mode":"live","amount":{"currency":"EUR","value":"35.95"},"status":"succeeded","paymentId":"tr_WDqYK6vllg","createdAt":"2026-07-17T11:00:00+00:00"}],"count":1,"nextCursor":null}
   */
  async listCaptures(paymentId, from, limit) {
    return await this.#listResource({
      logTag: '[listCaptures]',
      url: `${ API_BASE_URL }/payments/${ paymentId }/captures`,
      resourceKey: 'captures',
      query: { from, limit },
    })
  }

  /**
   * @operationName Get Capture
   * @category Captures
   * @description Retrieves a single capture by its ID and the ID of the payment it belongs to, including the captured amount, settlement amount, and status.
   * @route GET /payments/{paymentId}/captures/{captureId}
   *
   * @paramDef {"type":"String","label":"Payment ID","name":"paymentId","required":true,"description":"The Mollie payment ID, e.g. tr_WDqYK6vllg."}
   * @paramDef {"type":"String","label":"Capture ID","name":"captureId","required":true,"description":"The Mollie capture ID, e.g. cpt_4qqhO89gsT."}
   *
   * @returns {Object}
   * @sampleResult {"resource":"capture","id":"cpt_4qqhO89gsT","mode":"live","amount":{"currency":"EUR","value":"35.95"},"settlementAmount":{"currency":"EUR","value":"35.95"},"status":"succeeded","paymentId":"tr_WDqYK6vllg","createdAt":"2026-07-17T11:00:00+00:00"}
   */
  async getCapture(paymentId, captureId) {
    return await this.#apiRequest({
      logTag: '[getCapture]',
      url: `${ API_BASE_URL }/payments/${ paymentId }/captures/${ captureId }`,
    })
  }

  // ---------------------------------------------------------------------------
  // Payment Links
  // ---------------------------------------------------------------------------

  /**
   * @operationName Create Payment Link
   * @category Payment Links
   * @description Creates a shareable Mollie payment link and returns it with the hosted paymentLinkUrl to send to customers via email, chat, or invoices. Set a fixed amount, or leave the amount empty (optionally with a minimum amount) to let the customer decide what to pay. Reusable links can be paid multiple times by different customers.
   * @route POST /payment-links
   *
   * @paramDef {"type":"String","label":"Description","name":"description","required":true,"description":"Description of the payment link, visible to the customer on the hosted payment page."}
   * @paramDef {"type":"String","label":"Amount","name":"amount","description":"Fixed amount to charge, e.g. 24.95. Leave empty to let the customer enter the amount themselves."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","defaultValue":"EUR","description":"Three-letter ISO 4217 currency code, e.g. EUR, USD. Defaults to EUR."}
   * @paramDef {"type":"String","label":"Minimum Amount","name":"minimumAmount","description":"Minimum amount the customer must pay, e.g. 5.00. Only used when no fixed Amount is set."}
   * @paramDef {"type":"String","label":"Expires At","name":"expiresAt","description":"Expiry date and time of the link in ISO 8601 format, e.g. 2026-08-17T11:00:00+02:00. The link can no longer be paid after this moment."}
   * @paramDef {"type":"String","label":"Redirect URL","name":"redirectUrl","description":"URL the customer is redirected to after completing the payment."}
   * @paramDef {"type":"String","label":"Webhook URL","name":"webhookUrl","description":"Publicly reachable URL Mollie calls when a payment on this link changes status."}
   * @paramDef {"type":"Boolean","label":"Reusable","name":"reusable","uiComponent":{"type":"TOGGLE"},"description":"When enabled, the link can be paid multiple times by different customers. Disabled by default, meaning the link closes after the first payment."}
   *
   * @returns {Object}
   * @sampleResult {"resource":"payment-link","id":"pl_4Y0eZitmBnQ6IDoMqZQKh","mode":"live","description":"Bicycle tires","amount":{"currency":"EUR","value":"24.95"},"archived":false,"reusable":false,"createdAt":"2026-07-17T11:00:00+00:00","expiresAt":"2026-08-17T11:00:00+00:00","redirectUrl":"https://example.org/thanks","paymentLinkUrl":"https://paymentlink.mollie.com/payment/4Y0eZitmBnQ6IDoMqZQKh/"}
   */
  async createPaymentLink(description, amount, currency, minimumAmount, expiresAt, redirectUrl, webhookUrl, reusable) {
    const logTag = '[createPaymentLink]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/payment-links`,
      method: 'post',
      body: clean({
        description,
        amount: this.#formatAmount(amount, currency),
        minimumAmount: this.#formatAmount(minimumAmount, currency),
        expiresAt,
        redirectUrl,
        webhookUrl,
        reusable,
      }),
    })

    return { ...response, paymentLinkUrl: response?._links?.paymentLink?.href || null }
  }

  /**
   * @operationName List Payment Links
   * @category Payment Links
   * @description Retrieves all payment links created with the current API key, newest first, as a plain items array with a nextCursor for pagination.
   * @route GET /payment-links
   *
   * @paramDef {"type":"String","label":"From","name":"from","description":"Pagination cursor: the payment link ID to start the result set from. Use the nextCursor value returned by a previous call."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of payment links to return per page (default 50, maximum 250)."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"resource":"payment-link","id":"pl_4Y0eZitmBnQ6IDoMqZQKh","description":"Bicycle tires","amount":{"currency":"EUR","value":"24.95"},"archived":false,"createdAt":"2026-07-17T11:00:00+00:00"}],"count":1,"nextCursor":"pl_5Z1fAjunCoR7JEpNrARLi"}
   */
  async listPaymentLinks(from, limit) {
    return await this.#listResource({
      logTag: '[listPaymentLinks]',
      url: `${ API_BASE_URL }/payment-links`,
      resourceKey: 'payment_links',
      query: { from, limit },
    })
  }

  /**
   * @operationName Get Payment Link
   * @category Payment Links
   * @description Retrieves a single payment link by its ID, including its amount, expiry, archive state, and the hosted paymentLinkUrl customers use to pay.
   * @route GET /payment-links/{paymentLinkId}
   *
   * @paramDef {"type":"String","label":"Payment Link ID","name":"paymentLinkId","required":true,"description":"The Mollie payment link ID, e.g. pl_4Y0eZitmBnQ6IDoMqZQKh."}
   *
   * @returns {Object}
   * @sampleResult {"resource":"payment-link","id":"pl_4Y0eZitmBnQ6IDoMqZQKh","mode":"live","description":"Bicycle tires","amount":{"currency":"EUR","value":"24.95"},"archived":false,"reusable":false,"createdAt":"2026-07-17T11:00:00+00:00","paymentLinkUrl":"https://paymentlink.mollie.com/payment/4Y0eZitmBnQ6IDoMqZQKh/"}
   */
  async getPaymentLink(paymentLinkId) {
    const response = await this.#apiRequest({
      logTag: '[getPaymentLink]',
      url: `${ API_BASE_URL }/payment-links/${ paymentLinkId }`,
    })

    return { ...response, paymentLinkUrl: response?._links?.paymentLink?.href || null }
  }

  /**
   * @operationName Update Payment Link
   * @category Payment Links
   * @description Updates the description of a payment link or archives it. Archived links can no longer be paid but remain available for reporting.
   * @route PATCH /payment-links/{paymentLinkId}
   *
   * @paramDef {"type":"String","label":"Payment Link ID","name":"paymentLinkId","required":true,"description":"The Mollie payment link ID, e.g. pl_4Y0eZitmBnQ6IDoMqZQKh."}
   * @paramDef {"type":"String","label":"Description","name":"description","description":"New description of the payment link, visible to the customer on the hosted payment page."}
   * @paramDef {"type":"Boolean","label":"Archived","name":"archived","uiComponent":{"type":"TOGGLE"},"description":"Enable to archive the link so it can no longer be paid; disable to restore it."}
   *
   * @returns {Object}
   * @sampleResult {"resource":"payment-link","id":"pl_4Y0eZitmBnQ6IDoMqZQKh","mode":"live","description":"Bicycle tires - archived","amount":{"currency":"EUR","value":"24.95"},"archived":true,"createdAt":"2026-07-17T11:00:00+00:00"}
   */
  async updatePaymentLink(paymentLinkId, description, archived) {
    return await this.#apiRequest({
      logTag: '[updatePaymentLink]',
      url: `${ API_BASE_URL }/payment-links/${ paymentLinkId }`,
      method: 'patch',
      body: clean({ description, archived }),
    })
  }

  /**
   * @operationName Delete Payment Link
   * @category Payment Links
   * @description Permanently deletes a payment link. The link immediately stops working and this cannot be undone. Payments already made through the link are not affected.
   * @route DELETE /payment-links/{paymentLinkId}
   *
   * @paramDef {"type":"String","label":"Payment Link ID","name":"paymentLinkId","required":true,"description":"The Mollie payment link ID to delete, e.g. pl_4Y0eZitmBnQ6IDoMqZQKh."}
   *
   * @returns {Object}
   * @sampleResult {"deleted":true,"paymentLinkId":"pl_4Y0eZitmBnQ6IDoMqZQKh"}
   */
  async deletePaymentLink(paymentLinkId) {
    await this.#apiRequest({
      logTag: '[deletePaymentLink]',
      url: `${ API_BASE_URL }/payment-links/${ paymentLinkId }`,
      method: 'delete',
    })

    return { deleted: true, paymentLinkId }
  }

  /**
   * @operationName List Payment Link Payments
   * @category Payment Links
   * @description Retrieves all payments made through a specific payment link, newest first, as a plain items array with a nextCursor for pagination. Useful for tracking who paid a reusable link.
   * @route GET /payment-links/{paymentLinkId}/payments
   *
   * @paramDef {"type":"String","label":"Payment Link ID","name":"paymentLinkId","required":true,"description":"The Mollie payment link ID, e.g. pl_4Y0eZitmBnQ6IDoMqZQKh."}
   * @paramDef {"type":"String","label":"From","name":"from","description":"Pagination cursor: the payment ID to start the result set from. Use the nextCursor value returned by a previous call."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of payments to return per page (default 50, maximum 250)."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"resource":"payment","id":"tr_7UhSN1zuXS","status":"paid","amount":{"currency":"EUR","value":"24.95"},"description":"Bicycle tires","method":"ideal","createdAt":"2026-07-17T11:00:00+00:00"}],"count":1,"nextCursor":null}
   */
  async listPaymentLinkPayments(paymentLinkId, from, limit) {
    return await this.#listResource({
      logTag: '[listPaymentLinkPayments]',
      url: `${ API_BASE_URL }/payment-links/${ paymentLinkId }/payments`,
      resourceKey: 'payments',
      query: { from, limit },
    })
  }

  // ---------------------------------------------------------------------------
  // Customers
  // ---------------------------------------------------------------------------

  /**
   * @operationName Create Customer
   * @category Customers
   * @description Creates a customer in Mollie. Customers let you link payments to a person, enable single-click payments, and are required for recurring payments via mandates and subscriptions.
   * @route POST /customers
   *
   * @paramDef {"type":"String","label":"Name","name":"name","description":"Full name of the customer, e.g. Jane Doe."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Email address of the customer."}
   * @paramDef {"type":"String","label":"Locale","name":"locale","uiComponent":{"type":"DROPDOWN","options":{"values":["English (US)","English (UK)","Dutch (Netherlands)","Dutch (Belgium)","German (Germany)","German (Austria)","German (Switzerland)","French (France)","French (Belgium)","Spanish","Catalan","Portuguese","Italian","Norwegian","Swedish","Finnish","Danish","Icelandic","Hungarian","Polish","Latvian","Lithuanian"]}},"description":"Preferred language used for this customer's payment screens. If empty, Mollie detects it from the customer's browser."}
   * @paramDef {"type":"Object","label":"Metadata","name":"metadata","description":"Any JSON object to store with the customer, e.g. your own CRM ID."}
   *
   * @returns {Object}
   * @sampleResult {"resource":"customer","id":"cst_8wmqcHMN4U","mode":"test","name":"Jane Doe","email":"jane@example.org","locale":"en_US","metadata":{"crmId":"12345"},"createdAt":"2026-07-17T11:00:00+00:00"}
   */
  async createCustomer(name, email, locale, metadata) {
    return await this.#apiRequest({
      logTag: '[createCustomer]',
      url: `${ API_BASE_URL }/customers`,
      method: 'post',
      body: clean({
        name,
        email,
        locale: this.#resolveChoice(locale, LOCALE_MAP),
        metadata,
      }),
    })
  }

  /**
   * @operationName List Customers
   * @category Customers
   * @description Retrieves all customers created with the current API key, newest first, as a plain items array with a nextCursor for pagination.
   * @route GET /customers
   *
   * @paramDef {"type":"String","label":"From","name":"from","description":"Pagination cursor: the customer ID to start the result set from. Use the nextCursor value returned by a previous call."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of customers to return per page (default 50, maximum 250)."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"resource":"customer","id":"cst_8wmqcHMN4U","name":"Jane Doe","email":"jane@example.org","createdAt":"2026-07-17T11:00:00+00:00"}],"count":1,"nextCursor":"cst_9xnrdINO5V"}
   */
  async listCustomers(from, limit) {
    return await this.#listResource({
      logTag: '[listCustomers]',
      url: `${ API_BASE_URL }/customers`,
      resourceKey: 'customers',
      query: { from, limit },
    })
  }

  /**
   * @operationName Get Customer
   * @category Customers
   * @description Retrieves a single customer by their ID, including name, email, locale, and metadata.
   * @route GET /customers/{customerId}
   *
   * @paramDef {"type":"String","label":"Customer ID","name":"customerId","required":true,"dictionary":"getCustomersDictionary","description":"The Mollie customer ID, e.g. cst_8wmqcHMN4U. Select a customer or provide the ID directly."}
   *
   * @returns {Object}
   * @sampleResult {"resource":"customer","id":"cst_8wmqcHMN4U","mode":"live","name":"Jane Doe","email":"jane@example.org","locale":"en_US","metadata":{"crmId":"12345"},"createdAt":"2026-07-17T11:00:00+00:00"}
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
   * @description Updates a customer's name, email, locale, or metadata. Only the fields you provide are changed.
   * @route PATCH /customers/{customerId}
   *
   * @paramDef {"type":"String","label":"Customer ID","name":"customerId","required":true,"dictionary":"getCustomersDictionary","description":"The Mollie customer ID, e.g. cst_8wmqcHMN4U. Select a customer or provide the ID directly."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"New full name of the customer."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"New email address of the customer."}
   * @paramDef {"type":"String","label":"Locale","name":"locale","uiComponent":{"type":"DROPDOWN","options":{"values":["English (US)","English (UK)","Dutch (Netherlands)","Dutch (Belgium)","German (Germany)","German (Austria)","German (Switzerland)","French (France)","French (Belgium)","Spanish","Catalan","Portuguese","Italian","Norwegian","Swedish","Finnish","Danish","Icelandic","Hungarian","Polish","Latvian","Lithuanian"]}},"description":"New preferred language for this customer's payment screens."}
   * @paramDef {"type":"Object","label":"Metadata","name":"metadata","description":"JSON object that replaces the metadata stored on the customer."}
   *
   * @returns {Object}
   * @sampleResult {"resource":"customer","id":"cst_8wmqcHMN4U","mode":"live","name":"Jane Smith","email":"jane.smith@example.org","locale":"en_US","createdAt":"2026-07-17T11:00:00+00:00"}
   */
  async updateCustomer(customerId, name, email, locale, metadata) {
    return await this.#apiRequest({
      logTag: '[updateCustomer]',
      url: `${ API_BASE_URL }/customers/${ customerId }`,
      method: 'patch',
      body: clean({
        name,
        email,
        locale: this.#resolveChoice(locale, LOCALE_MAP),
        metadata,
      }),
    })
  }

  /**
   * @operationName Delete Customer
   * @category Customers
   * @description Permanently deletes a customer. All of the customer's mandates are revoked and pending subscriptions are canceled. This cannot be undone.
   * @route DELETE /customers/{customerId}
   *
   * @paramDef {"type":"String","label":"Customer ID","name":"customerId","required":true,"dictionary":"getCustomersDictionary","description":"The Mollie customer ID to delete, e.g. cst_8wmqcHMN4U."}
   *
   * @returns {Object}
   * @sampleResult {"deleted":true,"customerId":"cst_8wmqcHMN4U"}
   */
  async deleteCustomer(customerId) {
    await this.#apiRequest({
      logTag: '[deleteCustomer]',
      url: `${ API_BASE_URL }/customers/${ customerId }`,
      method: 'delete',
    })

    return { deleted: true, customerId }
  }

  /**
   * @operationName List Customer Payments
   * @category Customers
   * @description Retrieves all payments linked to a specific customer, newest first, as a plain items array with a nextCursor for pagination.
   * @route GET /customers/{customerId}/payments
   *
   * @paramDef {"type":"String","label":"Customer ID","name":"customerId","required":true,"dictionary":"getCustomersDictionary","description":"The Mollie customer ID, e.g. cst_8wmqcHMN4U. Select a customer or provide the ID directly."}
   * @paramDef {"type":"String","label":"From","name":"from","description":"Pagination cursor: the payment ID to start the result set from. Use the nextCursor value returned by a previous call."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of payments to return per page (default 50, maximum 250)."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"resource":"payment","id":"tr_7UhSN1zuXS","status":"paid","amount":{"currency":"EUR","value":"25.00"},"description":"Subscription payment","sequenceType":"recurring","customerId":"cst_8wmqcHMN4U","createdAt":"2026-07-17T11:00:00+00:00"}],"count":1,"nextCursor":null}
   */
  async listCustomerPayments(customerId, from, limit) {
    return await this.#listResource({
      logTag: '[listCustomerPayments]',
      url: `${ API_BASE_URL }/customers/${ customerId }/payments`,
      resourceKey: 'payments',
      query: { from, limit },
    })
  }

  /**
   * @operationName Create Customer Payment
   * @category Customers
   * @description Creates a payment for an existing customer. With Sequence Type Recurring (the default), the customer's valid mandate is charged immediately without any customer interaction (on-demand recurring billing). With First, a checkout is started that establishes a mandate for future recurring charges (Redirect URL required); the returned checkoutUrl should then be presented to the customer.
   * @route POST /customers/{customerId}/payments
   *
   * @paramDef {"type":"String","label":"Customer ID","name":"customerId","required":true,"dictionary":"getCustomersDictionary","description":"The Mollie customer ID to charge, e.g. cst_8wmqcHMN4U."}
   * @paramDef {"type":"String","label":"Amount","name":"amount","required":true,"description":"The amount to charge, e.g. 25.00. It is formatted automatically into the two-decimal string Mollie requires."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","defaultValue":"EUR","description":"Three-letter ISO 4217 currency code, e.g. EUR, USD. Defaults to EUR."}
   * @paramDef {"type":"String","label":"Description","name":"description","required":true,"description":"Payment description shown on the customer's statement and in the Mollie Dashboard."}
   * @paramDef {"type":"String","label":"Sequence Type","name":"sequenceType","defaultValue":"Recurring","uiComponent":{"type":"DROPDOWN","options":{"values":["One-off","First","Recurring"]}},"description":"Recurring (default) charges the customer's mandate directly without interaction. First starts a checkout that creates a mandate. One-off is a regular checkout payment for this customer."}
   * @paramDef {"type":"String","label":"Mandate ID","name":"mandateId","description":"Specific mandate to charge, e.g. mdt_h3gAaD5zP. If omitted, Mollie uses the customer's most recent valid mandate."}
   * @paramDef {"type":"String","label":"Redirect URL","name":"redirectUrl","description":"URL the customer is redirected to after checkout. Required for first and one-off payments; not used for recurring."}
   * @paramDef {"type":"String","label":"Webhook URL","name":"webhookUrl","description":"Publicly reachable URL Mollie calls with the payment ID whenever the payment status changes."}
   * @paramDef {"type":"Object","label":"Metadata","name":"metadata","description":"Any JSON object to store with the payment, e.g. your own invoice ID."}
   *
   * @returns {Object}
   * @sampleResult {"resource":"payment","id":"tr_7UhSN1zuXS","mode":"live","status":"paid","amount":{"currency":"EUR","value":"25.00"},"description":"Monthly charge","sequenceType":"recurring","customerId":"cst_8wmqcHMN4U","mandateId":"mdt_h3gAaD5zP","createdAt":"2026-07-17T11:00:00+00:00","checkoutUrl":null}
   */
  async createCustomerPayment(customerId, amount, currency, description, sequenceType, mandateId, redirectUrl, webhookUrl, metadata) {
    const logTag = '[createCustomerPayment]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/customers/${ customerId }/payments`,
      method: 'post',
      body: clean({
        amount: this.#formatAmount(amount, currency),
        description,
        sequenceType: this.#resolveChoice(sequenceType, SEQUENCE_TYPE_MAP) || 'recurring',
        mandateId,
        redirectUrl,
        webhookUrl,
        metadata,
      }),
    })

    return { ...response, checkoutUrl: response?._links?.checkout?.href || null }
  }

  // ---------------------------------------------------------------------------
  // Mandates
  // ---------------------------------------------------------------------------

  /**
   * @operationName Create Mandate
   * @category Mandates
   * @description Creates a mandate for a customer, authorizing you to charge them with recurring payments. Use this when the customer's consent was obtained outside Mollie's checkout (e.g. a signed SEPA Direct Debit form or an existing PayPal billing agreement). For SEPA Direct Debit, provide the consumer's name and IBAN; for PayPal, provide the consumer's email and PayPal billing agreement ID.
   * @route POST /customers/{customerId}/mandates
   *
   * @paramDef {"type":"String","label":"Customer ID","name":"customerId","required":true,"dictionary":"getCustomersDictionary","description":"The Mollie customer ID to create the mandate for, e.g. cst_8wmqcHMN4U."}
   * @paramDef {"type":"String","label":"Method","name":"method","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["SEPA Direct Debit","PayPal"]}},"description":"Payment method of the mandate."}
   * @paramDef {"type":"String","label":"Consumer Name","name":"consumerName","required":true,"description":"Name of the account holder or PayPal account owner."}
   * @paramDef {"type":"String","label":"Consumer Account (IBAN)","name":"consumerAccount","description":"IBAN of the consumer's bank account, e.g. NL55INGB0000000000. Required for SEPA Direct Debit mandates."}
   * @paramDef {"type":"String","label":"Consumer BIC","name":"consumerBic","description":"BIC of the consumer's bank, e.g. INGBNL2A. Optional for SEPA Direct Debit mandates."}
   * @paramDef {"type":"String","label":"Consumer Email","name":"consumerEmail","description":"Email address of the consumer's PayPal account. Required for PayPal mandates."}
   * @paramDef {"type":"String","label":"PayPal Billing Agreement ID","name":"paypalBillingAgreementId","description":"ID of an existing PayPal billing agreement, e.g. B-12A34567B8901234CD. Required for PayPal mandates."}
   * @paramDef {"type":"String","label":"Signature Date","name":"signatureDate","description":"Date the mandate was signed, in YYYY-MM-DD format."}
   * @paramDef {"type":"String","label":"Mandate Reference","name":"mandateReference","description":"Your own custom mandate reference, e.g. YOUR-COMPANY-MD13804."}
   *
   * @returns {Object}
   * @sampleResult {"resource":"mandate","id":"mdt_h3gAaD5zP","mode":"test","status":"valid","method":"directdebit","details":{"consumerName":"Jane Doe","consumerAccount":"NL55INGB0000000000","consumerBic":"INGBNL2A"},"mandateReference":"YOUR-COMPANY-MD13804","signatureDate":"2026-07-01","createdAt":"2026-07-17T11:00:00+00:00","customerId":"cst_8wmqcHMN4U"}
   */
  async createMandate(customerId, method, consumerName, consumerAccount, consumerBic, consumerEmail, paypalBillingAgreementId, signatureDate, mandateReference) {
    return await this.#apiRequest({
      logTag: '[createMandate]',
      url: `${ API_BASE_URL }/customers/${ customerId }/mandates`,
      method: 'post',
      body: clean({
        method: this.#resolveChoice(method, MANDATE_METHOD_MAP),
        consumerName,
        consumerAccount,
        consumerBic,
        consumerEmail,
        paypalBillingAgreementId,
        signatureDate,
        mandateReference,
      }),
    })
  }

  /**
   * @operationName List Mandates
   * @category Mandates
   * @description Retrieves all mandates of a customer as a plain items array with a nextCursor for pagination. Check the status property (valid, pending, invalid) to see which mandates can be charged.
   * @route GET /customers/{customerId}/mandates
   *
   * @paramDef {"type":"String","label":"Customer ID","name":"customerId","required":true,"dictionary":"getCustomersDictionary","description":"The Mollie customer ID, e.g. cst_8wmqcHMN4U. Select a customer or provide the ID directly."}
   * @paramDef {"type":"String","label":"From","name":"from","description":"Pagination cursor: the mandate ID to start the result set from. Use the nextCursor value returned by a previous call."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of mandates to return per page (default 50, maximum 250)."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"resource":"mandate","id":"mdt_h3gAaD5zP","status":"valid","method":"directdebit","details":{"consumerName":"Jane Doe","consumerAccount":"NL55INGB0000000000"},"signatureDate":"2026-07-01","createdAt":"2026-07-17T11:00:00+00:00"}],"count":1,"nextCursor":null}
   */
  async listMandates(customerId, from, limit) {
    return await this.#listResource({
      logTag: '[listMandates]',
      url: `${ API_BASE_URL }/customers/${ customerId }/mandates`,
      resourceKey: 'mandates',
      query: { from, limit },
    })
  }

  /**
   * @operationName Get Mandate
   * @category Mandates
   * @description Retrieves a single mandate by its ID and the ID of the customer it belongs to, including its method, status, and consumer details.
   * @route GET /customers/{customerId}/mandates/{mandateId}
   *
   * @paramDef {"type":"String","label":"Customer ID","name":"customerId","required":true,"dictionary":"getCustomersDictionary","description":"The Mollie customer ID, e.g. cst_8wmqcHMN4U."}
   * @paramDef {"type":"String","label":"Mandate ID","name":"mandateId","required":true,"description":"The Mollie mandate ID, e.g. mdt_h3gAaD5zP."}
   *
   * @returns {Object}
   * @sampleResult {"resource":"mandate","id":"mdt_h3gAaD5zP","mode":"live","status":"valid","method":"directdebit","details":{"consumerName":"Jane Doe","consumerAccount":"NL55INGB0000000000","consumerBic":"INGBNL2A"},"signatureDate":"2026-07-01","createdAt":"2026-07-17T11:00:00+00:00","customerId":"cst_8wmqcHMN4U"}
   */
  async getMandate(customerId, mandateId) {
    return await this.#apiRequest({
      logTag: '[getMandate]',
      url: `${ API_BASE_URL }/customers/${ customerId }/mandates/${ mandateId }`,
    })
  }

  /**
   * @operationName Revoke Mandate
   * @category Mandates
   * @description Revokes a customer's mandate so it can no longer be charged. Pending subscription payments that rely on this mandate will fail, and subscriptions using it are canceled. This cannot be undone.
   * @route DELETE /customers/{customerId}/mandates/{mandateId}
   *
   * @paramDef {"type":"String","label":"Customer ID","name":"customerId","required":true,"dictionary":"getCustomersDictionary","description":"The Mollie customer ID, e.g. cst_8wmqcHMN4U."}
   * @paramDef {"type":"String","label":"Mandate ID","name":"mandateId","required":true,"description":"The Mollie mandate ID to revoke, e.g. mdt_h3gAaD5zP."}
   *
   * @returns {Object}
   * @sampleResult {"revoked":true,"customerId":"cst_8wmqcHMN4U","mandateId":"mdt_h3gAaD5zP"}
   */
  async revokeMandate(customerId, mandateId) {
    await this.#apiRequest({
      logTag: '[revokeMandate]',
      url: `${ API_BASE_URL }/customers/${ customerId }/mandates/${ mandateId }`,
      method: 'delete',
    })

    return { revoked: true, customerId, mandateId }
  }

  // ---------------------------------------------------------------------------
  // Subscriptions
  // ---------------------------------------------------------------------------

  /**
   * @operationName Create Subscription
   * @category Subscriptions
   * @description Creates a subscription that automatically charges a customer's valid mandate at a regular interval (e.g. every 1 month or 14 days). The customer must have a valid mandate first, typically created by a payment with Sequence Type First. Use Times to limit the number of charges, or leave it empty for an ongoing subscription.
   * @route POST /customers/{customerId}/subscriptions
   *
   * @paramDef {"type":"String","label":"Customer ID","name":"customerId","required":true,"dictionary":"getCustomersDictionary","description":"The Mollie customer ID to subscribe, e.g. cst_8wmqcHMN4U. The customer must have a valid mandate."}
   * @paramDef {"type":"String","label":"Amount","name":"amount","required":true,"description":"The amount to charge each cycle, e.g. 25.00. It is formatted automatically into the two-decimal string Mollie requires."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","defaultValue":"EUR","description":"Three-letter ISO 4217 currency code, e.g. EUR, USD. Defaults to EUR."}
   * @paramDef {"type":"String","label":"Interval","name":"interval","required":true,"description":"Charge interval, e.g. 1 month, 14 days, 3 months, or 1 year (up to 12 months / 52 weeks / 365 days)."}
   * @paramDef {"type":"String","label":"Description","name":"description","required":true,"description":"Description of the subscription, included in each payment's description. Must be unique per customer."}
   * @paramDef {"type":"Number","label":"Times","name":"times","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Total number of charges to complete before the subscription ends. Leave empty for an ongoing subscription."}
   * @paramDef {"type":"String","label":"Start Date","name":"startDate","description":"Date of the first charge in YYYY-MM-DD format. Defaults to today."}
   * @paramDef {"type":"String","label":"Method","name":"method","uiComponent":{"type":"DROPDOWN","options":{"values":["Credit Card","SEPA Direct Debit","PayPal"]}},"description":"Force a specific mandate method for the charges. Leave empty to use any valid mandate of the customer."}
   * @paramDef {"type":"String","label":"Mandate ID","name":"mandateId","description":"Specific mandate to charge, e.g. mdt_h3gAaD5zP. If omitted, Mollie uses the customer's most recent valid mandate."}
   * @paramDef {"type":"String","label":"Webhook URL","name":"webhookUrl","description":"Publicly reachable URL Mollie calls with the payment ID for every charge created by this subscription."}
   * @paramDef {"type":"Object","label":"Metadata","name":"metadata","description":"Any JSON object to store with the subscription, e.g. your own plan ID."}
   *
   * @returns {Object}
   * @sampleResult {"resource":"subscription","id":"sub_rVKGtNd6s3","mode":"live","createdAt":"2026-07-17T11:00:00+00:00","status":"active","amount":{"currency":"EUR","value":"25.00"},"times":4,"timesRemaining":4,"interval":"3 months","startDate":"2026-08-01","description":"Quarterly payment","mandateId":"mdt_h3gAaD5zP","customerId":"cst_8wmqcHMN4U"}
   */
  async createSubscription(customerId, amount, currency, interval, description, times, startDate, method, mandateId, webhookUrl, metadata) {
    return await this.#apiRequest({
      logTag: '[createSubscription]',
      url: `${ API_BASE_URL }/customers/${ customerId }/subscriptions`,
      method: 'post',
      body: clean({
        amount: this.#formatAmount(amount, currency),
        interval,
        description,
        times,
        startDate,
        method: this.#resolveChoice(method, SUBSCRIPTION_METHOD_MAP),
        mandateId,
        webhookUrl,
        metadata,
      }),
    })
  }

  /**
   * @operationName List Customer Subscriptions
   * @category Subscriptions
   * @description Retrieves all subscriptions of a specific customer as a plain items array with a nextCursor for pagination.
   * @route GET /customers/{customerId}/subscriptions
   *
   * @paramDef {"type":"String","label":"Customer ID","name":"customerId","required":true,"dictionary":"getCustomersDictionary","description":"The Mollie customer ID, e.g. cst_8wmqcHMN4U. Select a customer or provide the ID directly."}
   * @paramDef {"type":"String","label":"From","name":"from","description":"Pagination cursor: the subscription ID to start the result set from. Use the nextCursor value returned by a previous call."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of subscriptions to return per page (default 50, maximum 250)."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"resource":"subscription","id":"sub_rVKGtNd6s3","status":"active","amount":{"currency":"EUR","value":"25.00"},"interval":"1 month","description":"Monthly plan","createdAt":"2026-07-17T11:00:00+00:00"}],"count":1,"nextCursor":null}
   */
  async listCustomerSubscriptions(customerId, from, limit) {
    return await this.#listResource({
      logTag: '[listCustomerSubscriptions]',
      url: `${ API_BASE_URL }/customers/${ customerId }/subscriptions`,
      resourceKey: 'subscriptions',
      query: { from, limit },
    })
  }

  /**
   * @operationName List All Subscriptions
   * @category Subscriptions
   * @description Retrieves all subscriptions across all customers created with the current API key as a plain items array with a nextCursor for pagination.
   * @route GET /subscriptions
   *
   * @paramDef {"type":"String","label":"From","name":"from","description":"Pagination cursor: the subscription ID to start the result set from. Use the nextCursor value returned by a previous call."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of subscriptions to return per page (default 50, maximum 250)."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"resource":"subscription","id":"sub_rVKGtNd6s3","status":"active","amount":{"currency":"EUR","value":"25.00"},"interval":"1 month","description":"Monthly plan","customerId":"cst_8wmqcHMN4U","createdAt":"2026-07-17T11:00:00+00:00"}],"count":1,"nextCursor":"sub_sWLHuOe7t4"}
   */
  async listAllSubscriptions(from, limit) {
    return await this.#listResource({
      logTag: '[listAllSubscriptions]',
      url: `${ API_BASE_URL }/subscriptions`,
      resourceKey: 'subscriptions',
      query: { from, limit },
    })
  }

  /**
   * @operationName Get Subscription
   * @category Subscriptions
   * @description Retrieves a single subscription by its ID and the ID of the customer it belongs to, including its status, amount, interval, remaining charges, and next payment date.
   * @route GET /customers/{customerId}/subscriptions/{subscriptionId}
   *
   * @paramDef {"type":"String","label":"Customer ID","name":"customerId","required":true,"dictionary":"getCustomersDictionary","description":"The Mollie customer ID, e.g. cst_8wmqcHMN4U."}
   * @paramDef {"type":"String","label":"Subscription ID","name":"subscriptionId","required":true,"description":"The Mollie subscription ID, e.g. sub_rVKGtNd6s3."}
   *
   * @returns {Object}
   * @sampleResult {"resource":"subscription","id":"sub_rVKGtNd6s3","mode":"live","status":"active","amount":{"currency":"EUR","value":"25.00"},"times":4,"timesRemaining":3,"interval":"3 months","startDate":"2026-08-01","nextPaymentDate":"2026-11-01","description":"Quarterly payment","mandateId":"mdt_h3gAaD5zP","customerId":"cst_8wmqcHMN4U","createdAt":"2026-07-17T11:00:00+00:00"}
   */
  async getSubscription(customerId, subscriptionId) {
    return await this.#apiRequest({
      logTag: '[getSubscription]',
      url: `${ API_BASE_URL }/customers/${ customerId }/subscriptions/${ subscriptionId }`,
    })
  }

  /**
   * @operationName Update Subscription
   * @category Subscriptions
   * @description Updates a running subscription. You can change the amount, interval, description, number of charges, start date, mandate, webhook URL, or metadata. Only the fields you provide are changed.
   * @route PATCH /customers/{customerId}/subscriptions/{subscriptionId}
   *
   * @paramDef {"type":"String","label":"Customer ID","name":"customerId","required":true,"dictionary":"getCustomersDictionary","description":"The Mollie customer ID, e.g. cst_8wmqcHMN4U."}
   * @paramDef {"type":"String","label":"Subscription ID","name":"subscriptionId","required":true,"description":"The Mollie subscription ID to update, e.g. sub_rVKGtNd6s3."}
   * @paramDef {"type":"String","label":"Amount","name":"amount","description":"New amount to charge each cycle, e.g. 30.00."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","defaultValue":"EUR","description":"Three-letter ISO 4217 currency code of the new amount. Defaults to EUR."}
   * @paramDef {"type":"String","label":"Interval","name":"interval","description":"New charge interval, e.g. 1 month or 14 days."}
   * @paramDef {"type":"String","label":"Description","name":"description","description":"New description of the subscription."}
   * @paramDef {"type":"Number","label":"Times","name":"times","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"New total number of charges before the subscription ends."}
   * @paramDef {"type":"String","label":"Start Date","name":"startDate","description":"New date of the next charge in YYYY-MM-DD format."}
   * @paramDef {"type":"String","label":"Mandate ID","name":"mandateId","description":"Mandate the subscription should charge from now on, e.g. mdt_h3gAaD5zP."}
   * @paramDef {"type":"String","label":"Webhook URL","name":"webhookUrl","description":"New webhook URL for the subscription's payments."}
   * @paramDef {"type":"Object","label":"Metadata","name":"metadata","description":"JSON object that replaces the metadata stored on the subscription."}
   *
   * @returns {Object}
   * @sampleResult {"resource":"subscription","id":"sub_rVKGtNd6s3","mode":"live","status":"active","amount":{"currency":"EUR","value":"30.00"},"interval":"1 month","description":"Monthly plan - upgraded","customerId":"cst_8wmqcHMN4U","createdAt":"2026-07-17T11:00:00+00:00"}
   */
  async updateSubscription(customerId, subscriptionId, amount, currency, interval, description, times, startDate, mandateId, webhookUrl, metadata) {
    return await this.#apiRequest({
      logTag: '[updateSubscription]',
      url: `${ API_BASE_URL }/customers/${ customerId }/subscriptions/${ subscriptionId }`,
      method: 'patch',
      body: clean({
        amount: this.#formatAmount(amount, currency),
        interval,
        description,
        times,
        startDate,
        mandateId,
        webhookUrl,
        metadata,
      }),
    })
  }

  /**
   * @operationName Cancel Subscription
   * @category Subscriptions
   * @description Cancels a subscription so no further charges are created. Returns the subscription with status canceled. Payments already created by the subscription are not affected.
   * @route DELETE /customers/{customerId}/subscriptions/{subscriptionId}
   *
   * @paramDef {"type":"String","label":"Customer ID","name":"customerId","required":true,"dictionary":"getCustomersDictionary","description":"The Mollie customer ID, e.g. cst_8wmqcHMN4U."}
   * @paramDef {"type":"String","label":"Subscription ID","name":"subscriptionId","required":true,"description":"The Mollie subscription ID to cancel, e.g. sub_rVKGtNd6s3."}
   *
   * @returns {Object}
   * @sampleResult {"resource":"subscription","id":"sub_rVKGtNd6s3","mode":"live","status":"canceled","canceledAt":"2026-07-17T12:00:00+00:00","amount":{"currency":"EUR","value":"25.00"},"interval":"1 month","description":"Monthly plan","customerId":"cst_8wmqcHMN4U","createdAt":"2026-07-17T11:00:00+00:00"}
   */
  async cancelSubscription(customerId, subscriptionId) {
    return await this.#apiRequest({
      logTag: '[cancelSubscription]',
      url: `${ API_BASE_URL }/customers/${ customerId }/subscriptions/${ subscriptionId }`,
      method: 'delete',
    })
  }

  /**
   * @operationName List Subscription Payments
   * @category Subscriptions
   * @description Retrieves all payments created by a specific subscription, newest first, as a plain items array with a nextCursor for pagination. Useful for checking which recurring charges succeeded or failed.
   * @route GET /customers/{customerId}/subscriptions/{subscriptionId}/payments
   *
   * @paramDef {"type":"String","label":"Customer ID","name":"customerId","required":true,"dictionary":"getCustomersDictionary","description":"The Mollie customer ID, e.g. cst_8wmqcHMN4U."}
   * @paramDef {"type":"String","label":"Subscription ID","name":"subscriptionId","required":true,"description":"The Mollie subscription ID, e.g. sub_rVKGtNd6s3."}
   * @paramDef {"type":"String","label":"From","name":"from","description":"Pagination cursor: the payment ID to start the result set from. Use the nextCursor value returned by a previous call."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of payments to return per page (default 50, maximum 250)."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"resource":"payment","id":"tr_7UhSN1zuXS","status":"paid","amount":{"currency":"EUR","value":"25.00"},"description":"Monthly plan","sequenceType":"recurring","subscriptionId":"sub_rVKGtNd6s3","customerId":"cst_8wmqcHMN4U","createdAt":"2026-07-17T11:00:00+00:00"}],"count":1,"nextCursor":null}
   */
  async listSubscriptionPayments(customerId, subscriptionId, from, limit) {
    return await this.#listResource({
      logTag: '[listSubscriptionPayments]',
      url: `${ API_BASE_URL }/customers/${ customerId }/subscriptions/${ subscriptionId }/payments`,
      resourceKey: 'payments',
      query: { from, limit },
    })
  }

  // ---------------------------------------------------------------------------
  // Payment Methods
  // ---------------------------------------------------------------------------

  /**
   * @operationName List Enabled Payment Methods
   * @category Payment Methods
   * @description Retrieves the payment methods currently enabled on your Mollie profile, in the order they appear in the checkout. Optionally filter by amount (methods have minimum and maximum amounts), sequence type for recurring flows, or billing country, and include the Apple Pay wallet.
   * @route GET /methods
   *
   * @paramDef {"type":"String","label":"Amount","name":"amount","description":"Only return methods that support this payment amount, e.g. 100.00."}
   * @paramDef {"type":"String","label":"Currency","name":"currency","defaultValue":"EUR","description":"Three-letter ISO 4217 currency code for the amount filter. Defaults to EUR."}
   * @paramDef {"type":"String","label":"Locale","name":"locale","uiComponent":{"type":"DROPDOWN","options":{"values":["English (US)","English (UK)","Dutch (Netherlands)","Dutch (Belgium)","German (Germany)","German (Austria)","German (Switzerland)","French (France)","French (Belgium)","Spanish","Catalan","Portuguese","Italian","Norwegian","Swedish","Finnish","Danish","Icelandic","Hungarian","Polish","Latvian","Lithuanian"]}},"description":"Language for the returned method names."}
   * @paramDef {"type":"String","label":"Sequence Type","name":"sequenceType","uiComponent":{"type":"DROPDOWN","options":{"values":["One-off","First","Recurring"]}},"description":"Only return methods usable for this payment sequence type, e.g. Recurring to see which methods support recurring charges."}
   * @paramDef {"type":"String","label":"Resource","name":"resource","uiComponent":{"type":"DROPDOWN","options":{"values":["Payments","Orders"]}},"description":"Resource the methods will be used with. Defaults to Payments; Orders relates to the deprecated Orders API and is rarely needed."}
   * @paramDef {"type":"Boolean","label":"Include Apple Pay","name":"includeApplePay","uiComponent":{"type":"TOGGLE"},"description":"Enable to include the Apple Pay wallet in the result."}
   * @paramDef {"type":"String","label":"Billing Country","name":"billingCountry","description":"Only return methods available in this country, as an ISO 3166-1 alpha-2 code, e.g. NL or DE."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"resource":"method","id":"ideal","description":"iDEAL","minimumAmount":{"currency":"EUR","value":"0.01"},"maximumAmount":{"currency":"EUR","value":"50000.00"},"status":"activated"}],"count":1,"nextCursor":null}
   */
  async listEnabledMethods(amount, currency, locale, sequenceType, resource, includeApplePay, billingCountry) {
    const amountObject = this.#formatAmount(amount, currency)

    return await this.#listResource({
      logTag: '[listEnabledMethods]',
      url: `${ API_BASE_URL }/methods`,
      resourceKey: 'methods',
      query: {
        'amount[value]': amountObject?.value,
        'amount[currency]': amountObject?.currency,
        locale: this.#resolveChoice(locale, LOCALE_MAP),
        sequenceType: this.#resolveChoice(sequenceType, SEQUENCE_TYPE_MAP),
        resource: this.#resolveChoice(resource, RESOURCE_MAP),
        includeWallets: includeApplePay ? 'applepay' : undefined,
        billingCountry,
      },
    })
  }

  /**
   * @operationName List All Payment Methods
   * @category Payment Methods
   * @description Retrieves every payment method Mollie offers, regardless of whether it is enabled on your profile. Useful for discovering method IDs and building settings screens. Optionally includes Mollie's pricing per method.
   * @route GET /methods/all
   *
   * @paramDef {"type":"String","label":"Locale","name":"locale","uiComponent":{"type":"DROPDOWN","options":{"values":["English (US)","English (UK)","Dutch (Netherlands)","Dutch (Belgium)","German (Germany)","German (Austria)","German (Switzerland)","French (France)","French (Belgium)","Spanish","Catalan","Portuguese","Italian","Norwegian","Swedish","Finnish","Danish","Icelandic","Hungarian","Polish","Latvian","Lithuanian"]}},"description":"Language for the returned method names."}
   * @paramDef {"type":"Boolean","label":"Include Pricing","name":"includePricing","uiComponent":{"type":"TOGGLE"},"description":"Enable to include Mollie's per-method pricing in the response."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"resource":"method","id":"ideal","description":"iDEAL","minimumAmount":{"currency":"EUR","value":"0.01"},"maximumAmount":{"currency":"EUR","value":"50000.00"},"status":"activated"},{"resource":"method","id":"creditcard","description":"Card","minimumAmount":{"currency":"EUR","value":"0.01"},"maximumAmount":null,"status":"activated"}],"count":2,"nextCursor":null}
   */
  async listAllMethods(locale, includePricing) {
    return await this.#listResource({
      logTag: '[listAllMethods]',
      url: `${ API_BASE_URL }/methods/all`,
      resourceKey: 'methods',
      query: {
        locale: this.#resolveChoice(locale, LOCALE_MAP),
        include: includePricing ? 'pricing' : undefined,
      },
    })
  }

  /**
   * @operationName Get Payment Method
   * @category Payment Methods
   * @description Retrieves a single payment method by its ID, including its display name, image assets, and minimum and maximum amounts. Optionally includes the method's issuers (e.g. the list of iDEAL banks).
   * @route GET /methods/{methodId}
   *
   * @paramDef {"type":"String","label":"Method ID","name":"methodId","required":true,"dictionary":"getPaymentMethodsDictionary","description":"The Mollie payment method ID, e.g. ideal, creditcard, paypal. Select a method or provide the ID directly."}
   * @paramDef {"type":"Boolean","label":"Include Issuers","name":"includeIssuers","uiComponent":{"type":"TOGGLE"},"description":"Enable to include the method's issuers in the response, e.g. the list of iDEAL banks."}
   *
   * @returns {Object}
   * @sampleResult {"resource":"method","id":"ideal","description":"iDEAL","minimumAmount":{"currency":"EUR","value":"0.01"},"maximumAmount":{"currency":"EUR","value":"50000.00"},"image":{"size1x":"https://www.mollie.com/external/icons/payment-methods/ideal.png","svg":"https://www.mollie.com/external/icons/payment-methods/ideal.svg"},"status":"activated"}
   */
  async getMethod(methodId, includeIssuers) {
    return await this.#apiRequest({
      logTag: '[getMethod]',
      url: `${ API_BASE_URL }/methods/${ methodId }`,
      query: { include: includeIssuers ? 'issuers' : undefined },
    })
  }

  // ---------------------------------------------------------------------------
  // Balances
  // ---------------------------------------------------------------------------

  /**
   * @operationName List Balances
   * @category Balances
   * @description Retrieves the balances of your organization, including available and pending amounts per currency, as a plain items array with a nextCursor for pagination. Note: the Balances API requires an organization access token; standard API keys are not accepted, so supply an organization access token in the API Key configuration field to use this operation.
   * @route GET /balances
   *
   * @paramDef {"type":"String","label":"From","name":"from","description":"Pagination cursor: the balance ID to start the result set from. Use the nextCursor value returned by a previous call."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of balances to return per page (default 50, maximum 250)."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"resource":"balance","id":"bal_gVMhHKqSSRYJyPsuoPNFH","mode":"live","currency":"EUR","status":"active","availableAmount":{"currency":"EUR","value":"905.25"},"pendingAmount":{"currency":"EUR","value":"55.44"},"transferFrequency":"daily","createdAt":"2026-01-01T10:00:00+00:00"}],"count":1,"nextCursor":null}
   */
  async listBalances(from, limit) {
    return await this.#listResource({
      logTag: '[listBalances]',
      url: `${ API_BASE_URL }/balances`,
      resourceKey: 'balances',
      query: { from, limit },
    })
  }

  /**
   * @operationName Get Balance
   * @category Balances
   * @description Retrieves a single balance by its ID, including available and pending amounts and payout settings. Pass primary as the Balance ID to fetch your organization's primary balance. Note: the Balances API requires an organization access token; standard API keys are not accepted.
   * @route GET /balances/{balanceId}
   *
   * @paramDef {"type":"String","label":"Balance ID","name":"balanceId","required":true,"description":"The Mollie balance ID, e.g. bal_gVMhHKqSSRYJyPsuoPNFH, or primary for the primary balance."}
   *
   * @returns {Object}
   * @sampleResult {"resource":"balance","id":"bal_gVMhHKqSSRYJyPsuoPNFH","mode":"live","currency":"EUR","status":"active","availableAmount":{"currency":"EUR","value":"905.25"},"pendingAmount":{"currency":"EUR","value":"55.44"},"transferFrequency":"daily","transferThreshold":{"currency":"EUR","value":"5.00"},"transferReference":"Mollie payout","createdAt":"2026-01-01T10:00:00+00:00"}
   */
  async getBalance(balanceId) {
    return await this.#apiRequest({
      logTag: '[getBalance]',
      url: `${ API_BASE_URL }/balances/${ balanceId }`,
    })
  }

  /**
   * @operationName Get Balance Report
   * @category Balances
   * @description Retrieves a summarized report of a balance over a given period, grouped either by status balances (opening/closing balances) or by transaction categories (payments, refunds, chargebacks, fees). Pass primary as the Balance ID for the primary balance. Note: the Balances API requires an organization access token; standard API keys are not accepted.
   * @route GET /balances/{balanceId}/report
   *
   * @paramDef {"type":"String","label":"Balance ID","name":"balanceId","required":true,"description":"The Mollie balance ID, e.g. bal_gVMhHKqSSRYJyPsuoPNFH, or primary for the primary balance."}
   * @paramDef {"type":"String","label":"From Date","name":"fromDate","required":true,"description":"Start date of the report period in YYYY-MM-DD format (inclusive)."}
   * @paramDef {"type":"String","label":"Until Date","name":"untilDate","required":true,"description":"End date of the report period in YYYY-MM-DD format (exclusive)."}
   * @paramDef {"type":"String","label":"Grouping","name":"grouping","defaultValue":"Status Balances","uiComponent":{"type":"DROPDOWN","options":{"values":["Status Balances","Transaction Categories"]}},"description":"How to group the report figures."}
   *
   * @returns {Object}
   * @sampleResult {"resource":"balance-report","balanceId":"bal_gVMhHKqSSRYJyPsuoPNFH","timeZone":"Europe/Amsterdam","from":"2026-07-01","until":"2026-07-15","grouping":"status-balances","totals":{"open":{"available":{"amount":{"currency":"EUR","value":"0.00"}},"pending":{"amount":{"currency":"EUR","value":"0.00"}}}}}
   */
  async getBalanceReport(balanceId, fromDate, untilDate, grouping) {
    return await this.#apiRequest({
      logTag: '[getBalanceReport]',
      url: `${ API_BASE_URL }/balances/${ balanceId }/report`,
      query: {
        from: fromDate,
        until: untilDate,
        grouping: this.#resolveChoice(grouping, GROUPING_MAP),
      },
    })
  }

  /**
   * @operationName List Balance Transactions
   * @category Balances
   * @description Retrieves the individual movements on a balance (payments, refunds, chargebacks, payouts, fees), newest first, as a plain items array with a nextCursor for pagination. Pass primary as the Balance ID for the primary balance. Note: the Balances API requires an organization access token; standard API keys are not accepted.
   * @route GET /balances/{balanceId}/transactions
   *
   * @paramDef {"type":"String","label":"Balance ID","name":"balanceId","required":true,"description":"The Mollie balance ID, e.g. bal_gVMhHKqSSRYJyPsuoPNFH, or primary for the primary balance."}
   * @paramDef {"type":"String","label":"From","name":"from","description":"Pagination cursor: the balance transaction ID to start the result set from. Use the nextCursor value returned by a previous call."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of transactions to return per page (default 50, maximum 250)."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"resource":"balance_transaction","id":"baltr_QM24QwzUWR4ev4Xfgyt29A","type":"payment","resultAmount":{"currency":"EUR","value":"9.71"},"initialAmount":{"currency":"EUR","value":"10.00"},"deductions":{"currency":"EUR","value":"-0.29"},"context":{"paymentId":"tr_7UhSN1zuXS"},"createdAt":"2026-07-17T11:00:00+00:00"}],"count":1,"nextCursor":"baltr_RN35RxAVXS5fw5Ygzu30B"}
   */
  async listBalanceTransactions(balanceId, from, limit) {
    return await this.#listResource({
      logTag: '[listBalanceTransactions]',
      url: `${ API_BASE_URL }/balances/${ balanceId }/transactions`,
      resourceKey: 'balance_transactions',
      query: { from, limit },
    })
  }

  // ---------------------------------------------------------------------------
  // Settlements
  // ---------------------------------------------------------------------------

  /**
   * @operationName List Settlements
   * @category Settlements
   * @description Retrieves the settlements (payouts to your bank account) of your organization, newest first, as a plain items array with a nextCursor for pagination. Note: the Settlements API requires an organization access token; standard API keys are not accepted, so supply an organization access token in the API Key configuration field to use this operation.
   * @route GET /settlements
   *
   * @paramDef {"type":"String","label":"From","name":"from","description":"Pagination cursor: the settlement ID to start the result set from. Use the nextCursor value returned by a previous call."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of settlements to return per page (default 50, maximum 250)."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"resource":"settlement","id":"stl_jDk30akdN","reference":"1234567.2607.03","status":"paidout","amount":{"currency":"EUR","value":"39.75"},"createdAt":"2026-07-17T11:00:00+00:00","settledAt":"2026-07-18T06:00:00+00:00"}],"count":1,"nextCursor":null}
   */
  async listSettlements(from, limit) {
    return await this.#listResource({
      logTag: '[listSettlements]',
      url: `${ API_BASE_URL }/settlements`,
      resourceKey: 'settlements',
      query: { from, limit },
    })
  }

  /**
   * @operationName Get Settlement
   * @category Settlements
   * @description Retrieves a single settlement by its ID, including its status, total amount, and period breakdown. Pass next as the ID to preview the upcoming settlement, or open for amounts not yet scheduled for settlement. Note: the Settlements API requires an organization access token; standard API keys are not accepted.
   * @route GET /settlements/{settlementId}
   *
   * @paramDef {"type":"String","label":"Settlement ID","name":"settlementId","required":true,"description":"The Mollie settlement ID, e.g. stl_jDk30akdN, or next / open for the upcoming or unscheduled settlement."}
   *
   * @returns {Object}
   * @sampleResult {"resource":"settlement","id":"stl_jDk30akdN","reference":"1234567.2607.03","status":"paidout","amount":{"currency":"EUR","value":"39.75"},"balanceId":"bal_gVMhHKqSSRYJyPsuoPNFH","createdAt":"2026-07-17T11:00:00+00:00","settledAt":"2026-07-18T06:00:00+00:00","periods":{"2026":{"07":{"revenue":[{"description":"iDEAL","count":6,"amountNet":{"currency":"EUR","value":"86.10"}}]}}}}
   */
  async getSettlement(settlementId) {
    return await this.#apiRequest({
      logTag: '[getSettlement]',
      url: `${ API_BASE_URL }/settlements/${ settlementId }`,
    })
  }

  /**
   * @operationName List Settlement Payments
   * @category Settlements
   * @description Retrieves all payments included in a specific settlement as a plain items array with a nextCursor for pagination. Useful for reconciling a payout with the individual payments it contains. Note: the Settlements API requires an organization access token; standard API keys are not accepted.
   * @route GET /settlements/{settlementId}/payments
   *
   * @paramDef {"type":"String","label":"Settlement ID","name":"settlementId","required":true,"description":"The Mollie settlement ID, e.g. stl_jDk30akdN."}
   * @paramDef {"type":"String","label":"From","name":"from","description":"Pagination cursor: the payment ID to start the result set from. Use the nextCursor value returned by a previous call."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of payments to return per page (default 50, maximum 250)."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"resource":"payment","id":"tr_7UhSN1zuXS","status":"paid","amount":{"currency":"EUR","value":"10.00"},"description":"Order #12345","method":"ideal","settlementId":"stl_jDk30akdN","createdAt":"2026-07-17T11:00:00+00:00"}],"count":1,"nextCursor":null}
   */
  async listSettlementPayments(settlementId, from, limit) {
    return await this.#listResource({
      logTag: '[listSettlementPayments]',
      url: `${ API_BASE_URL }/settlements/${ settlementId }/payments`,
      resourceKey: 'payments',
      query: { from, limit },
    })
  }

  // ---------------------------------------------------------------------------
  // Invoices
  // ---------------------------------------------------------------------------

  /**
   * @operationName List Invoices
   * @category Invoices
   * @description Retrieves the invoices Mollie issued to your organization for its fees, newest first, as a plain items array with a nextCursor for pagination. Note: the Invoices API requires an organization access token; standard API keys are not accepted, so supply an organization access token in the API Key configuration field to use this operation.
   * @route GET /invoices
   *
   * @paramDef {"type":"String","label":"From","name":"from","description":"Pagination cursor: the invoice ID to start the result set from. Use the nextCursor value returned by a previous call."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of invoices to return per page (default 50, maximum 250)."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"resource":"invoice","id":"inv_xBEbP9rvAq","reference":"2026.10000","status":"open","issuedAt":"2026-07-01","dueAt":"2026-07-15","netAmount":{"currency":"EUR","value":"45.00"},"vatAmount":{"currency":"EUR","value":"9.45"},"grossAmount":{"currency":"EUR","value":"54.45"}}],"count":1,"nextCursor":null}
   */
  async listInvoices(from, limit) {
    return await this.#listResource({
      logTag: '[listInvoices]',
      url: `${ API_BASE_URL }/invoices`,
      resourceKey: 'invoices',
      query: { from, limit },
    })
  }

  /**
   * @operationName Get Invoice
   * @category Invoices
   * @description Retrieves a single Mollie fee invoice by its ID, including its status, line items, amounts, and a link to the PDF version. Note: the Invoices API requires an organization access token; standard API keys are not accepted.
   * @route GET /invoices/{invoiceId}
   *
   * @paramDef {"type":"String","label":"Invoice ID","name":"invoiceId","required":true,"description":"The Mollie invoice ID, e.g. inv_xBEbP9rvAq."}
   *
   * @returns {Object}
   * @sampleResult {"resource":"invoice","id":"inv_xBEbP9rvAq","reference":"2026.10000","vatNumber":"NL001234567B01","status":"open","issuedAt":"2026-07-01","dueAt":"2026-07-15","netAmount":{"currency":"EUR","value":"45.00"},"vatAmount":{"currency":"EUR","value":"9.45"},"grossAmount":{"currency":"EUR","value":"54.45"},"lines":[{"period":"2026-06","description":"iDEAL transaction costs","count":100,"vatPercentage":21,"amount":{"currency":"EUR","value":"45.00"}}]}
   */
  async getInvoice(invoiceId) {
    return await this.#apiRequest({
      logTag: '[getInvoice]',
      url: `${ API_BASE_URL }/invoices/${ invoiceId }`,
    })
  }

  // ---------------------------------------------------------------------------
  // Profiles
  // ---------------------------------------------------------------------------

  /**
   * @operationName List Profiles
   * @category Profiles
   * @description Retrieves the website profiles of your organization as a plain items array with a nextCursor for pagination. Each profile represents a website or app you accept payments on.
   * @route GET /profiles
   *
   * @paramDef {"type":"String","label":"From","name":"from","description":"Pagination cursor: the profile ID to start the result set from. Use the nextCursor value returned by a previous call."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of profiles to return per page (default 50, maximum 250)."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"resource":"profile","id":"pfl_v9hTf7K33","mode":"live","name":"My website name","website":"https://example.org","email":"info@example.org","status":"verified","createdAt":"2026-01-01T10:00:00+00:00"}],"count":1,"nextCursor":null}
   */
  async listProfiles(from, limit) {
    return await this.#listResource({
      logTag: '[listProfiles]',
      url: `${ API_BASE_URL }/profiles`,
      resourceKey: 'profiles',
      query: { from, limit },
    })
  }

  /**
   * @operationName Get Profile
   * @category Profiles
   * @description Retrieves a single website profile by its ID, including its name, website, contact details, and review status. Pass me as the Profile ID to fetch the profile belonging to the current API key.
   * @route GET /profiles/{profileId}
   *
   * @paramDef {"type":"String","label":"Profile ID","name":"profileId","required":true,"dictionary":"getProfilesDictionary","description":"The Mollie profile ID, e.g. pfl_v9hTf7K33, or me for the profile of the current API key."}
   *
   * @returns {Object}
   * @sampleResult {"resource":"profile","id":"pfl_v9hTf7K33","mode":"live","name":"My website name","website":"https://example.org","email":"info@example.org","phone":"+31208202070","businessCategory":"OTHER_MERCHANDISE","status":"verified","createdAt":"2026-01-01T10:00:00+00:00"}
   */
  async getProfile(profileId) {
    return await this.#apiRequest({
      logTag: '[getProfile]',
      url: `${ API_BASE_URL }/profiles/${ profileId }`,
    })
  }

  // ---------------------------------------------------------------------------
  // Terminals
  // ---------------------------------------------------------------------------

  /**
   * @operationName List Terminals
   * @category Terminals
   * @description Retrieves the physical point-of-sale terminals linked to your Mollie account as a plain items array with a nextCursor for pagination.
   * @route GET /terminals
   *
   * @paramDef {"type":"String","label":"From","name":"from","description":"Pagination cursor: the terminal ID to start the result set from. Use the nextCursor value returned by a previous call."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of terminals to return per page (default 50, maximum 250)."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"resource":"terminal","id":"term_7MgL4wea46qkRcoTZjWEH","profileId":"pfl_QkEhN94Ba","status":"active","brand":"PAX","model":"A920","serialNumber":"1234567890","currency":"EUR","description":"Terminal #12345","createdAt":"2026-01-01T10:00:00+00:00"}],"count":1,"nextCursor":null}
   */
  async listTerminals(from, limit) {
    return await this.#listResource({
      logTag: '[listTerminals]',
      url: `${ API_BASE_URL }/terminals`,
      resourceKey: 'terminals',
      query: { from, limit },
    })
  }

  /**
   * @operationName Get Terminal
   * @category Terminals
   * @description Retrieves a single point-of-sale terminal by its ID, including its brand, model, serial number, and activation status.
   * @route GET /terminals/{terminalId}
   *
   * @paramDef {"type":"String","label":"Terminal ID","name":"terminalId","required":true,"description":"The Mollie terminal ID, e.g. term_7MgL4wea46qkRcoTZjWEH."}
   *
   * @returns {Object}
   * @sampleResult {"resource":"terminal","id":"term_7MgL4wea46qkRcoTZjWEH","profileId":"pfl_QkEhN94Ba","status":"active","brand":"PAX","model":"A920","serialNumber":"1234567890","currency":"EUR","description":"Terminal #12345","createdAt":"2026-01-01T10:00:00+00:00"}
   */
  async getTerminal(terminalId) {
    return await this.#apiRequest({
      logTag: '[getTerminal]',
      url: `${ API_BASE_URL }/terminals/${ terminalId }`,
    })
  }

  // ---------------------------------------------------------------------------
  // Dictionaries
  // ---------------------------------------------------------------------------

  /**
   * @typedef {Object} getCustomersDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text used to filter customers by name or email."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor: the customer ID to start the result set from."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Customers Dictionary
   * @description Lists Mollie customers for selection in customer parameters. The option value is the customer ID (cst_...). Supports text search on name and email and cursor-based pagination.
   * @route POST /get-customers-dictionary
   * @paramDef {"type":"getCustomersDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Jane Doe","value":"cst_8wmqcHMN4U","note":"jane@example.org"}],"cursor":"cst_9xnrdINO5V"}
   */
  async getCustomersDictionary(payload) {
    const { search, cursor } = payload || {}

    const { items, nextCursor } = await this.#listResource({
      logTag: '[getCustomersDictionary]',
      url: `${ API_BASE_URL }/customers`,
      resourceKey: 'customers',
      query: { from: cursor, limit: 250 },
    })

    const searchLower = (search || '').toLowerCase()

    const filtered = searchLower
      ? items.filter(customer =>
        (customer.name || '').toLowerCase().includes(searchLower) ||
        (customer.email || '').toLowerCase().includes(searchLower))
      : items

    return {
      items: filtered.map(customer => ({
        label: customer.name || customer.email || customer.id,
        value: customer.id,
        note: customer.email || undefined,
      })),
      cursor: nextCursor,
    }
  }

  /**
   * @typedef {Object} getPaymentMethodsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text used to filter payment methods by name or ID."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. The methods list is returned in one call, so this is unused but kept for API compatibility."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Payment Methods Dictionary
   * @description Lists all payment methods Mollie offers for selection in method parameters. The option value is the method ID expected by the API (e.g. ideal, creditcard).
   * @route POST /get-payment-methods-dictionary
   * @paramDef {"type":"getPaymentMethodsDictionary__payload","label":"Payload","name":"payload","description":"Search input used to filter methods."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"iDEAL","value":"ideal","note":"activated"}],"cursor":null}
   */
  async getPaymentMethodsDictionary(payload) {
    const { search } = payload || {}

    const { items } = await this.#listResource({
      logTag: '[getPaymentMethodsDictionary]',
      url: `${ API_BASE_URL }/methods/all`,
      resourceKey: 'methods',
    })

    const searchLower = (search || '').toLowerCase()

    const filtered = searchLower
      ? items.filter(method =>
        (method.description || '').toLowerCase().includes(searchLower) ||
        (method.id || '').toLowerCase().includes(searchLower))
      : items

    return {
      items: filtered.map(method => ({
        label: method.description || method.id,
        value: method.id,
        note: method.status || undefined,
      })),
      cursor: null,
    }
  }

  /**
   * @typedef {Object} getProfilesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text used to filter profiles by name or website."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor: the profile ID to start the result set from."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Profiles Dictionary
   * @description Lists the website profiles of your Mollie organization for selection in profile parameters. The option value is the profile ID (pfl_...).
   * @route POST /get-profiles-dictionary
   * @paramDef {"type":"getProfilesDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"My website name","value":"pfl_v9hTf7K33","note":"https://example.org"}],"cursor":null}
   */
  async getProfilesDictionary(payload) {
    const { search, cursor } = payload || {}

    const { items, nextCursor } = await this.#listResource({
      logTag: '[getProfilesDictionary]',
      url: `${ API_BASE_URL }/profiles`,
      resourceKey: 'profiles',
      query: { from: cursor, limit: 250 },
    })

    const searchLower = (search || '').toLowerCase()

    const filtered = searchLower
      ? items.filter(profile =>
        (profile.name || '').toLowerCase().includes(searchLower) ||
        (profile.website || '').toLowerCase().includes(searchLower))
      : items

    return {
      items: filtered.map(profile => ({
        label: profile.name || profile.id,
        value: profile.id,
        note: profile.website || undefined,
      })),
      cursor: nextCursor,
    }
  }
}

Flowrunner.ServerCode.addService(MollieService, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Mollie API key (live_... or test_...) from the Mollie Dashboard under Developers -> API keys. Test keys run the same API in test mode. For organization-level operations (Balances, Settlements, Invoices), supply an organization access token instead.',
  },
])
