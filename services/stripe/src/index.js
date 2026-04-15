const StripeApiClient = require('stripe')

const logger = {
  info: (...args) => console.log('[Stripe Service] info:', ...args),
  debug: (...args) => console.log('[Stripe Service] debug:', ...args),
  error: (...args) => console.log('[Stripe Service] error:', ...args),
  warn: (...args) => console.log('[Stripe Service] warn:', ...args),
}

function isObject(obj) {
  return typeof obj === 'object' && !Array.isArray(obj) && obj !== null
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

const EXPIRATION = 12 * 60 * 60 - 1

/**
 *  @requireOAuth
 *  @integrationName Stripe
 *  @integrationIcon /icon.png
 **/
class Stripe {
  constructor(config) {
    this.currency = config.currency

    this.clientId = config.clientId
    this.clientSecret = config.privateKey

    this.safeClientSecret = config.privateKey
  }

  #initApiClient(apiKey) {
    apiKey = apiKey || this.request.headers['oauth-access-token']

    this.stripe = StripeApiClient(apiKey)
  }

  #initSafeApiClient() {
    assert(
      this.safeClientSecret,
      'This method can be used only with your own Client ID and Client Secret. You could set them in Service Configurations'
    )

    this.stripe = StripeApiClient(this.safeClientSecret)
  }

  /**
   * @registerAs SYSTEM
   * @route GET /getOAuth2ConnectionURL
   */
  async getOAuth2ConnectionURL() {
    const params = new URLSearchParams()

    params.append('client_id', this.clientId)
    params.append('response_type', 'code')
    params.append('scope', 'read_write')

    return `https://connect.stripe.com/oauth/authorize?${ params.toString() }`
  }

  /**
   * @registerAs SYSTEM
   * @route PUT /refreshToken
   * @paramDef {"type":"String","label":"Refresh Token","name":"refreshToken","required":true,"description":"The refresh token used to obtain a new access token"}
   * @returns {refreshToken_ResultObject}
   */
  async refreshToken(refreshToken) {
    this.#initApiClient(this.clientSecret)

    try {
      const { access_token, refresh_token } = await this.stripe.oauth.token({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      })

      return {
        token: access_token,
        refreshToken: refresh_token,
        expirationInSeconds: EXPIRATION,
      }
    } catch (error) {
      logger.error('Error refreshing token:', error?.message || error)

      throw error
    }
  }

  /**
   * @registerAs SYSTEM
   * @route POST /executeCallback
   * @param {Object} callbackObject
   * @returns {executeCallback_ResultObject}
   */
  async executeCallback(callbackObject) {
    this.#initApiClient(this.clientSecret)

    const { access_token, refresh_token, stripe_user_id } = await this.stripe.oauth.token({
      grant_type: 'authorization_code',
      code: callbackObject.code,
    })

    let identityName

    try {
      const account = await this.stripe.accounts.retrieve(stripe_user_id)

      identityName = account.business_profile.name
    } catch (e) {
      logger.debug("Can't load user profile", { error: e })
    }

    return {
      token: access_token,
      refreshToken: refresh_token,
      expirationInSeconds: EXPIRATION,
      overwrite: true,
      connectionIdentityName: identityName || 'Stripe Admin',
      connectionIdentityImageURL: null,
    }
  }

  /**
   * @description Retrieves the current account balance
   *
   * @route POST /balance/get
   * @operationName Get Balance
   * @category Account Management
   * @appearanceColor #635bff #5b84ff
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes read_only
   *
   * @paramDef {"type":"Object","label":"Request Options","name":"requestOptions","description":"Request Options. Could be found in Stripe method documentation."}
   *
   * @returns {Object} Current balance
   * @sampleResult {"object":"balance","available":[{"amount":666670,"currency":"usd","source_types":{"card":666670}}],"connect_reserved":[{"amount":0,"currency":"usd"}],"livemode":false,"pending":[{"amount":61414,"currency":"usd","source_types":{"card":61414}}]}
   *
   * @throws {Error}
   */
  async getBalance(requestOptions) {
    logger.debug('[getBalance] Payload', { requestOptions })

    this.#initApiClient()

    return this.stripe.balance.retrieve(requestOptions)
  }

  /**
   * @description Get a list of all connected accounts
   *
   * @route POST /accounts
   * @operationName Get Connected accounts
   * @category Account Management
   * @appearanceColor #635bff #5b84ff
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes read_only
   *
   * @paramDef {"type":"Object","label":"Parameters","name":"methodParams","description":"Parameters. Could be found in Stripe method documentation."}
   * @paramDef {"type":"Object","label":"Request Options","name":"requestOptions","description":"Request Options. Could be found in Stripe method documentation."}
   *
   * @returns {Object} Returns a list of accounts connected to your platform via Connect. If you’re not a platform, the list is empty.
   * @sampleResult {"object":"list","url":"/v1/accounts","has_more":false,"data":[{"id":"acct_1Nv0FGQ9RKHgCVdK","object":"account","business_profile":{"annual_revenue":null,"estimated_worker_count":null,"mcc":null,"name":null,"product_description":null,"support_address":null,"support_email":null,"support_phone":null,"support_url":null,"url":null},"business_type":null,"capabilities":{},"charges_enabled":false,"controller":{"fees":{"payer":"application"},"is_controller":true,"losses":{"payments":"application"},"requirement_collection":"stripe","stripe_dashboard":{"type":"express"},"type":"application"},"country":"US","created":1695830751,"default_currency":"usd","details_submitted":false,"email":"jenny.rosen@example.com","external_accounts":{"object":"list","data":[],"has_more":false,"total_count":0,"url":"/v1/accounts/acct_1Nv0FGQ9RKHgCVdK/external_accounts"},"future_requirements":{"alternatives":[],"current_deadline":null,"currently_due":[],"disabled_reason":null,"errors":[],"eventually_due":[],"past_due":[],"pending_verification":[]},"login_links":{"object":"list","total_count":0,"has_more":false,"url":"/v1/accounts/acct_1Nv0FGQ9RKHgCVdK/login_links","data":[]},"metadata":{},"payouts_enabled":false,"requirements":{"alternatives":[],"current_deadline":null,"currently_due":["business_profile.mcc","business_profile.url","business_type","external_account","representative.first_name","representative.last_name","tos_acceptance.date","tos_acceptance.ip"],"disabled_reason":"requirements.past_due","errors":[],"eventually_due":["business_profile.mcc","business_profile.url","business_type","external_account","representative.first_name","representative.last_name","tos_acceptance.date","tos_acceptance.ip"],"past_due":["business_profile.mcc","business_profile.url","business_type","external_account","representative.first_name","representative.last_name","tos_acceptance.date","tos_acceptance.ip"],"pending_verification":[]},"settings":{"bacs_debit_payments":{"display_name":null,"service_user_number":null},"branding":{"icon":null,"logo":null,"primary_color":null,"secondary_color":null},"card_issuing":{"tos_acceptance":{"date":null,"ip":null}},"card_payments":{"decline_on":{"avs_failure":false,"cvc_failure":false},"statement_descriptor_prefix":null,"statement_descriptor_prefix_kanji":null,"statement_descriptor_prefix_kana":null},"dashboard":{"display_name":null,"timezone":"Etc/UTC"},"invoices":{"default_account_tax_ids":null},"payments":{"statement_descriptor":null,"statement_descriptor_kana":null,"statement_descriptor_kanji":null},"payouts":{"debit_negative_balances":true,"schedule":{"delay_days":2,"interval":"daily"},"statement_descriptor":null},"sepa_debit_payments":{}},"tos_acceptance":{"date":null,"ip":null,"user_agent":null},"type":"none"}]}
   *
   * @throws {Error}
   */
  async getConnectedAccountsList(options, requestOptions) {
    logger.debug('[getConnectedAccountsList] Payload', { options, requestOptions })

    this.#initSafeApiClient()

    return this.stripe.accounts.list(options, requestOptions)
  }

  /**
   * @description Creates a new customer.
   *
   * @route POST /customer
   * @operationName Create Customer
   * @category Customer Management
   * @appearanceColor #635bff #5b84ff
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes read_write
   *
   * @paramDef {"type":"Object","label":"Customer Data","name":"customer","required":true,"description":"Properties which will be assigned to a new customer."}
   * @paramDef {"type":"Object","label":"Request Options","name":"requestOptions","description":"Request Options. Could be found in Stripe method documentation."}
   *
   * @returns {Promise.<Object>} A promise that resolves with the created customer object.
   * @sampleResult {"id":"cus_NffrFeUfNV2Hib","object":"customer","address":null,"balance":0,"created":1680893993,"currency":null,"default_source":null,"delinquent":false,"description":null,"discount":null,"email":"jennyrosen@example.com","invoice_prefix":"0759376C","invoice_settings":{"custom_fields":null,"default_payment_method":null,"footer":null,"rendering_options":null},"livemode":false,"metadata":{},"name":"Jenny Rosen","next_invoice_sequence":1,"phone":null,"preferred_locales":[],"shipping":null,"tax_exempt":"none","test_clock":null}
   *
   * @throws {Error} Throws an error if customer creation fails.
   */
  async createCustomer(customer, requestOptions) {
    logger.debug('[createCustomer] Payload', { customer, requestOptions })

    assert(isObject(customer), 'Customer must be provided and must be an object.')

    this.#initApiClient()

    return this.stripe.customers.create(customer, requestOptions)
  }

  /**
   * @description Updates the specified customer by setting the values of the parameters passed. Most parameters can be changed, including `default_source`, `email`, and `payment_method`.
   *
   * @route PUT /customer
   * @operationName Update Customer
   * @category Customer Management
   * @appearanceColor #635bff #5b84ff
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes read_write
   *
   * @paramDef {"type":"String","label":"Customer ID","name":"id","required":true,"description":"The ID of the customer to update."}
   * @paramDef {"type":"Object","label":"Customer Data","name":"customerData","required":true,"description":"The customer properties to be updated, such as `email`, `default_source`, `invoice_settings`."}
   * @paramDef {"type":"Object","label":"Request Options","name":"requestOptions","description":"Request Options. Could be found in Stripe method documentation."}
   *
   * @returns {Promise.<Object>} A promise that resolves with the updated customer object.
   * @sampleResult {"id":"cus_NffrFeUfNV2Hib","object":"customer","address":null,"balance":0,"created":1680893993,"currency":null,"default_source":null,"delinquent":false,"description":null,"discount":null,"email":"jennyrosen@example.com","invoice_prefix":"0759376C","invoice_settings":{"custom_fields":null,"default_payment_method":null,"footer":null,"rendering_options":null},"livemode":false,"metadata":{},"name":"Jenny Rosen","next_invoice_sequence":1,"phone":null,"preferred_locales":[],"shipping":null,"tax_exempt":"none","test_clock":null}
   *
   * @throws {Error} Throws an error if customer update fails.
   */
  async updateCustomer(id, customerData, requestOptions) {
    logger.debug('[updateCustomer] Payload', { id, customerData, requestOptions })

    assert(id, 'Customer ID must be provided.')
    assert(isObject(customerData), 'Customer Data must be provided and must be an object.')

    this.#initApiClient()

    return this.stripe.customers.update(id, customerData, requestOptions)
  }

  /**
   * @description Retrieves the details of an existing customer. You need to supply the unique customer ID from either a customer creation request or the Stripe dashboard.
   *
   * @route POST /customer/get
   * @operationName Get Customer
   * @category Customer Management
   * @appearanceColor #635bff #5b84ff
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes read_write
   *
   * @paramDef {"type":"String","label":"Customer ID","name":"id","required":true,"description":"The ID of the customer to retrieve."}
   * @paramDef {"type":"Object","label":"Request Options","name":"requestOptions","description":"Request Options. Could be found in Stripe method documentation."}
   *
   * @returns {Promise.<Object>} A promise that resolves with the retrieved customer object.
   * @sampleResult {"id":"cus_NffrFeUfNV2Hib","object":"customer","address":null,"balance":0,"created":1680893993,"currency":null,"default_source":null,"delinquent":false,"description":null,"discount":null,"email":"jennyrosen@example.com","invoice_prefix":"0759376C","invoice_settings":{"custom_fields":null,"default_payment_method":null,"footer":null,"rendering_options":null},"livemode":false,"metadata":{},"name":"Jenny Rosen","next_invoice_sequence":1,"phone":null,"preferred_locales":[],"shipping":null,"tax_exempt":"none","test_clock":null}
   *
   * @throws {Error} Throws an error if customer retrieval fails.
   */
  async getCustomer(id, requestOptions) {
    logger.debug('[getCustomer] Payload', { id, requestOptions })

    assert(id, 'Customer ID must be provided.')

    this.#initApiClient()

    return this.stripe.customers.retrieve(id, requestOptions)
  }

  /**
   * @description Returns a list of your customers. The customers are returned sorted by creation date, with the most recent customers appearing first.
   *
   * @route POST /customers/get
   * @operationName Get Customers List
   * @category Customer Management
   * @appearanceColor #635bff #5b84ff
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes read_write
   *
   * @paramDef {"type":"Object","label":"Options","name":"options","description":"Options to filter the list of customers, such as `limit`, `starting_after`, `ending_before`."}
   * @paramDef {"type":"Object","label":"Request Options","name":"requestOptions","description":"Request Options. Could be found in Stripe method documentation."}
   *
   * @returns {Promise.<Object>} A promise that resolves with a list of customer objects.
   * @sampleResult {"object":"list","url":"/v1/customers","has_more":false,"data":[{"id":"cus_NffrFeUfNV2Hib","object":"customer","address":null,"balance":0,"created":1680893993,"currency":null,"default_source":null,"delinquent":false,"description":null,"discount":null,"email":"jennyrosen@example.com","invoice_prefix":"0759376C","invoice_settings":{"custom_fields":null,"default_payment_method":null,"footer":null,"rendering_options":null},"livemode":false,"metadata":{},"name":"Jenny Rosen","next_invoice_sequence":1,"phone":null,"preferred_locales":[],"shipping":null,"tax_exempt":"none","test_clock":null}]}
   *
   * @throws {Error} Throws an error if listing customers fails.
   */
  async getCustomersList(options, requestOptions) {
    logger.debug('[getCustomersList] Payload', { options, requestOptions })

    this.#initApiClient()

    return this.stripe.customers.list(options, requestOptions)
  }

  /**
   * @description Permanently deletes a customer. It cannot be undone. Also immediately cancels any active subscriptions on the customer.
   *
   * @route DELETE /customer
   * @operationName Delete Customer
   * @category Customer Management
   * @appearanceColor #635bff #5b84ff
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes read_write
   *
   * @paramDef {"type":"String","label":"Customer ID","name":"id","required":true,"description":"The ID of the customer to delete."}
   * @paramDef {"type":"Object","label":"Request Options","name":"requestOptions","description":"Request Options. Could be found in Stripe method documentation."}
   *
   * @returns {Promise.<Object>} A promise that resolves with an object containing the `deleted` status.
   * @sampleResult {"id":"cus_JyFIBFsgHSfHUv","object":"customer","deleted":true}
   *
   * @throws {Error} Throws an error if customer deletion fails.
   */
  async deleteCustomer(id, requestOptions) {
    logger.debug('[deleteCustomer] Payload', { id, requestOptions })

    assert(id, 'Customer ID must be provided.')

    this.#initApiClient()

    return this.stripe.customers.del(id, requestOptions)
  }

  /**
   * @description Creates a Payment Intent, which is an object representing your intent to collect payment from a customer.
   *
   * @route POST /payment_intents
   * @operationName Create Payment Intent
   * @category Payment Processing
   * @appearanceColor #635bff #5b84ff
   * @actionBlockColorEnd #2684fc
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes read_write
   *
   * @paramDef {"type":"Object","label":"Payment Data","name":"paymentData","required":true,"description":"Details about the payment. `amount` and `currency` are required."}
   * @paramDef {"type":"Object","label":"Request Options","name":"requestOptions","description":"Request Options. Could be found in Stripe method documentation."}
   *
   * @returns {Promise.<Object>} A promise that resolves with the created Payment Intent object.
   * @sampleResult {"id":"pi_3MtwBwLkdIwHu7ix28a3tqPa","object":"payment_intent","amount":2000,"amount_capturable":0,"amount_details":{"tip":{}},"amount_received":0,"application":null,"application_fee_amount":null,"automatic_payment_methods":{"enabled":true},"canceled_at":null,"cancellation_reason":null,"capture_method":"automatic","client_secret":"pi_3MtwBwLkdIwHu7ix28a3tqPa_secret_YrKJUKribcBjcG8HVhfZluoGH","confirmation_method":"automatic","created":1680800504,"currency":"usd","customer":null,"description":null,"invoice":null,"last_payment_error":null,"latest_charge":null,"livemode":false,"metadata":{},"next_action":null,"on_behalf_of":null,"payment_method":null,"payment_method_options":{"card":{"installments":null,"mandate_options":null,"network":null,"request_three_d_secure":"automatic"},"link":{"persistent_token":null}},"payment_method_types":["card","link"],"processing":null,"receipt_email":null,"review":null,"setup_future_usage":null,"shipping":null,"source":null,"statement_descriptor":null,"statement_descriptor_suffix":null,"status":"requires_payment_method","transfer_data":null,"transfer_group":null}
   *
   * @throws {Error} If an error occurs during the creation of the Payment Intent.
   */
  async createPaymentIntent(paymentData, requestOptions) {
    logger.debug('[createPaymentIntent] Payload', { paymentData, requestOptions })

    assert(paymentData?.amount, 'Payment property "amount" must be provided.')
    assert(paymentData?.currency, 'Payment property "currency" must be provided.')

    this.#initApiClient()

    return this.stripe.paymentIntents.create(paymentData, requestOptions)
  }

  /**
   * @description Retrieves a Payment Intent by its ID.
   *
   * @route POST /payment-intents/get
   * @operationName Get Payment Intent
   * @category Payment Processing
   * @appearanceColor #635bff #5b84ff
   * @actionBlockColorEnd #2684fc
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes read_only
   *
   * @paramDef {"type":"String","label":"Payment Intent ID","name":"id","required":true,"description":"The ID of the Payment Intent to retrieve."}
   * @paramDef {"type":"Object","label":"Request Options","name":"requestOptions","description":"Request Options. Could be found in Stripe method documentation."}
   *
   * @returns {Promise.<Object>} A promise that resolves with the retrieved Payment Intent object.
   * @sampleResult {"id":"pi_3MtwBwLkdIwHu7ix28a3tqPa","object":"payment_intent","amount":2000,"amount_capturable":0,"amount_details":{"tip":{}},"amount_received":0,"application":null,"application_fee_amount":null,"automatic_payment_methods":{"enabled":true},"canceled_at":null,"cancellation_reason":null,"capture_method":"automatic","client_secret":"pi_3MtwBwLkdIwHu7ix28a3tqPa_secret_YrKJUKribcBjcG8HVhfZluoGH","confirmation_method":"automatic","created":1680800504,"currency":"usd","customer":null,"description":null,"invoice":null,"last_payment_error":null,"latest_charge":null,"livemode":false,"metadata":{},"next_action":null,"on_behalf_of":null,"payment_method":null,"payment_method_options":{"card":{"installments":null,"mandate_options":null,"network":null,"request_three_d_secure":"automatic"},"link":{"persistent_token":null}},"payment_method_types":["card","link"],"processing":null,"receipt_email":null,"review":null,"setup_future_usage":null,"shipping":null,"source":null,"statement_descriptor":null,"statement_descriptor_suffix":null,"status":"requires_payment_method","transfer_data":null,"transfer_group":null}
   *
   * @throws {Error} If an error occurs while retrieving the Payment Intent.
   */
  async getPaymentIntent(id, requestOptions) {
    logger.debug('[getPaymentIntent] Payload', { id, requestOptions })

    assert(id, 'Payment ID must be provided.')

    this.#initApiClient()

    return this.stripe.paymentIntents.retrieve(id, requestOptions)
  }

  /**
   * @description Confirms a Payment Intent, indicating that the customer intends to pay with a specific payment method.
   *
   * @route POST /payment_intents/confirm
   * @operationName Confirm Payment Intent
   * @category Payment Processing
   * @appearanceColor #635bff #5b84ff
   * @actionBlockColorEnd #2684fc
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes read_write
   *
   * @paramDef {"type":"String","label":"Payment Intent ID","name":"id","required":true,"description":"The ID of the Payment Intent to confirm."}
   * @paramDef {"type":"Object","label":"Payment Method Data","name":"paymentMethodData","description":"Optional payment method data for confirmation."}
   * @paramDef {"type":"Object","label":"Request Options","name":"requestOptions","description":"Request Options. Could be found in Stripe method documentation."}
   *
   * @returns {Promise.<Object>} A promise that resolves with the confirmed Payment Intent object.
   * @sampleResult {"id":"pi_3MtweELkdIwHu7ix0Dt0gF2H","object":"payment_intent","amount":2000,"amount_capturable":0,"amount_details":{"tip":{}},"amount_received":2000,"application":null,"application_fee_amount":null,"automatic_payment_methods":{"enabled":true},"canceled_at":null,"cancellation_reason":null,"capture_method":"automatic","client_secret":"pi_3MtweELkdIwHu7ix0Dt0gF2H_secret_ALlpPMIZse0ac8YzPxkMkFgGC","confirmation_method":"automatic","created":1680802258,"currency":"usd","customer":null,"description":null,"invoice":null,"last_payment_error":null,"latest_charge":"ch_3MtweELkdIwHu7ix05lnLAFd","livemode":false,"metadata":{},"next_action":null,"on_behalf_of":null,"payment_method":"pm_1MtweELkdIwHu7ixxrsejPtG","payment_method_options":{"card":{"installments":null,"mandate_options":null,"network":null,"request_three_d_secure":"automatic"},"link":{"persistent_token":null}},"payment_method_types":["card","link"],"processing":null,"receipt_email":null,"review":null,"setup_future_usage":null,"shipping":null,"source":null,"statement_descriptor":null,"statement_descriptor_suffix":null,"status":"succeeded","transfer_data":null,"transfer_group":null}
   *
   * @throws {Error} If an error occurs while confirming the Payment Intent.
   */
  async confirmPaymentIntent(id, paymentMethodData, requestOptions) {
    logger.debug('[confirmPaymentIntent] Payload', { id, paymentMethodData, requestOptions })

    assert(id, 'Payment ID must be provided.')

    this.#initApiClient()

    return this.stripe.paymentIntents.confirm(id, paymentMethodData, requestOptions)
  }

  /**
   * @description Cancels a Payment Intent, if it is in a state that allows cancellation.
   *
   * @route POST /payment_intents/cancel
   * @operationName Cancel Payment Intent
   * @category Payment Processing
   * @appearanceColor #635bff #5b84ff
   * @actionBlockColorEnd #2684fc
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes read_write
   *
   * @paramDef {"type":"String","label":"Payment Intent ID","name":"id","required":true,"description":"The ID of the Payment Intent to cancel."}
   * @paramDef {"type":"Object","label":"Request Options","name":"requestOptions","description":"Request Options. Could be found in Stripe method documentation."}
   *
   * @returns {Promise.<Object>} A promise that resolves with the canceled Payment Intent object.
   * @sampleResult {"id":"pi_3MtwBwLkdIwHu7ix28a3tqPa","object":"payment_intent","amount":2000,"amount_capturable":0,"amount_details":{"tip":{}},"amount_received":0,"application":null,"application_fee_amount":null,"automatic_payment_methods":{"enabled":true},"canceled_at":1680801569,"cancellation_reason":null,"capture_method":"automatic","client_secret":"pi_3MtwBwLkdIwHu7ix28a3tqPa_secret_YrKJUKribcBjcG8HVhfZluoGH","confirmation_method":"automatic","created":1680800504,"currency":"usd","customer":null,"description":null,"invoice":null,"last_payment_error":null,"latest_charge":null,"livemode":false,"metadata":{},"next_action":null,"on_behalf_of":null,"payment_method":null,"payment_method_options":{"card":{"installments":null,"mandate_options":null,"network":null,"request_three_d_secure":"automatic"},"link":{"persistent_token":null}},"payment_method_types":["card","link"],"processing":null,"receipt_email":null,"review":null,"setup_future_usage":null,"shipping":null,"source":null,"statement_descriptor":null,"statement_descriptor_suffix":null,"status":"canceled","transfer_data":null,"transfer_group":null}
   *
   * @throws {Error} If an error occurs while canceling the Payment Intent.
   */
  async cancelPaymentIntent(id, requestOptions) {
    logger.debug('[cancelPaymentIntent] Payload', { id, requestOptions })

    assert(id, 'Payment ID must be provided.')

    this.#initApiClient()

    return this.stripe.paymentIntents.cancel(id, requestOptions)
  }

  /**
   * @description Lists all Payment Intents. You can provide various options to filter the list.
   *
   * @route POST /payment-intents/list/get
   * @operationName Get Payment Intents List
   * @category Payment Processing
   * @appearanceColor #635bff #5b84ff
   * @actionBlockColorEnd #2684fc
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes read_write
   *
   * @paramDef {"type":"Object","label":"Options","name":"options","description":"Options to filter the list of Payment Intents, such as `customer`, `limit`, and `starting_after`."}
   * @paramDef {"type":"Object","label":"Request Options","name":"requestOptions","description":"Request Options. Could be found in Stripe method documentation."}
   *
   * @returns {Promise.<Object>} A promise that resolves with a list of Payment Intents.
   * @sampleResult {"object":"list","url":"/v1/payment_intents","has_more":false,"data":[{"id":"pi_3MtwBwLkdIwHu7ix28a3tqPa","object":"payment_intent","amount":2000,"amount_capturable":0,"amount_details":{"tip":{}},"amount_received":0,"application":null,"application_fee_amount":null,"automatic_payment_methods":{"enabled":true},"canceled_at":null,"cancellation_reason":null,"capture_method":"automatic","client_secret":"pi_3MtwBwLkdIwHu7ix28a3tqPa_secret_YrKJUKribcBjcG8HVhfZluoGH","confirmation_method":"automatic","created":1680800504,"currency":"usd","customer":null,"description":null,"invoice":null,"last_payment_error":null,"latest_charge":null,"livemode":false,"metadata":{},"next_action":null,"on_behalf_of":null,"payment_method":null,"payment_method_options":{"card":{"installments":null,"mandate_options":null,"network":null,"request_three_d_secure":"automatic"},"link":{"persistent_token":null}},"payment_method_types":["card","link"],"processing":null,"receipt_email":null,"review":null,"setup_future_usage":null,"shipping":null,"source":null,"statement_descriptor":null,"statement_descriptor_suffix":null,"status":"requires_payment_method","transfer_data":null,"transfer_group":null}]}
   *
   * @throws {Error} If an error occurs while listing the Payment Intents.
   */
  async getPaymentIntentsList(options, requestOptions) {
    logger.debug('[getPaymentIntentsList] Payload', { options, requestOptions })

    this.#initApiClient()

    return this.stripe.paymentIntents.list(options, requestOptions)
  }

  /**
   * @description Creates a new subscription on an existing customer.
   *
   * @route POST /subscriptions
   * @operationName Create Subscription
   * @category Subscription Management
   * @appearanceColor #635bff #5b84ff
   * @actionBlockColorEnd #2684fc
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes read_write
   *
   * @paramDef {"type":"Object","label":"Subscription Data","name":"subscriptionData","required":true,"description":"Details about the subscription. `customer` and `items` are required."}
   * @paramDef {"type":"Object","label":"Request Options","name":"requestOptions","description":"Request Options. Could be found in Stripe method documentation."}
   *
   * @returns {Promise.<Object>} A promise that resolves with the created Subscription object.
   * @sampleResult {"id":"sub_1MowQVLkdIwHu7ixeRlqHVzs","object":"subscription","application":null,"application_fee_percent":null,"automatic_tax":{"enabled":false,"liability":null},"billing_cycle_anchor":1679609767,"billing_thresholds":null,"cancel_at":null,"cancel_at_period_end":false,"canceled_at":null,"cancellation_details":{"comment":null,"feedback":null,"reason":null},"collection_method":"charge_automatically","created":1679609767,"currency":"usd","current_period_end":1682288167,"current_period_start":1679609767,"customer":"cus_Na6dX7aXxi11N4","days_until_due":null,"default_payment_method":null,"default_source":null,"default_tax_rates":[],"description":null,"discount":null,"discounts":null,"ended_at":null,"invoice_settings":{"issuer":{"type":"self"}},"items":{"object":"list","data":[{"id":"si_Na6dzxczY5fwHx","object":"subscription_item","billing_thresholds":null,"created":1679609768,"metadata":{},"plan":{"id":"price_1MowQULkdIwHu7ixraBm864M","object":"plan","active":true,"aggregate_usage":null,"amount":1000,"amount_decimal":"1000","billing_scheme":"per_unit","created":1679609766,"currency":"usd","discounts":null,"interval":"month","interval_count":1,"livemode":false,"metadata":{},"nickname":null,"product":"prod_Na6dGcTsmU0I4R","tiers_mode":null,"transform_usage":null,"trial_period_days":null,"usage_type":"licensed"},"price":{"id":"price_1MowQULkdIwHu7ixraBm864M","object":"price","active":true,"billing_scheme":"per_unit","created":1679609766,"currency":"usd","custom_unit_amount":null,"livemode":false,"lookup_key":null,"metadata":{},"nickname":null,"product":"prod_Na6dGcTsmU0I4R","recurring":{"aggregate_usage":null,"interval":"month","interval_count":1,"trial_period_days":null,"usage_type":"licensed"},"tax_behavior":"unspecified","tiers_mode":null,"transform_quantity":null,"type":"recurring","unit_amount":1000,"unit_amount_decimal":"1000"},"quantity":1,"subscription":"sub_1MowQVLkdIwHu7ixeRlqHVzs","tax_rates":[]}],"has_more":false,"total_count":1,"url":"/v1/subscription_items?subscription=sub_1MowQVLkdIwHu7ixeRlqHVzs"},"latest_invoice":"in_1MowQWLkdIwHu7ixuzkSPfKd","livemode":false,"metadata":{},"next_pending_invoice_item_invoice":null,"on_behalf_of":null,"pause_collection":null,"payment_settings":{"payment_method_options":null,"payment_method_types":null,"save_default_payment_method":"off"},"pending_invoice_item_interval":null,"pending_setup_intent":null,"pending_update":null,"schedule":null,"start_date":1679609767,"status":"active","test_clock":null,"transfer_data":null,"trial_end":null,"trial_settings":{"end_behavior":{"missing_payment_method":"create_invoice"}},"trial_start":null}
   *
   * @throws {Error} Throws an error if the subscription creation fails.
   */
  async createSubscription(subscriptionData, requestOptions) {
    logger.debug('[createSubscription] Payload', { subscriptionData, requestOptions })

    assert(subscriptionData?.customer, 'Subscription property "customer" must be provided.')
    assert(Array.isArray(subscriptionData?.items), 'Subscription property "items" must be an array and provided.')

    this.#initApiClient()

    return this.stripe.subscriptions.create(subscriptionData, requestOptions)
  }

  /**
   * @description Retrieves the subscription with the given ID.
   *
   * @route POST /subscriptions/item/get
   * @operationName Get Subscription
   * @category Subscription Management
   * @appearanceColor #635bff #5b84ff
   * @actionBlockColorEnd #2684fc
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes read_only
   *
   * @paramDef {"type":"String","label":"Subscription ID","name":"id","required":true,"description":"The ID of the subscription to retrieve."}
   * @paramDef {"type":"Object","label":"Request Options","name":"requestOptions","description":"Request Options. Could be found in Stripe method documentation."}
   *
   * @returns {Promise.<Object>} A promise that resolves with the retrieved Subscription object.
   * @sampleResult {"id":"sub_1MowQVLkdIwHu7ixeRlqHVzs","object":"subscription","application":null,"application_fee_percent":null,"automatic_tax":{"enabled":false,"liability":null},"billing_cycle_anchor":1679609767,"billing_thresholds":null,"cancel_at":null,"cancel_at_period_end":false,"canceled_at":null,"cancellation_details":{"comment":null,"feedback":null,"reason":null},"collection_method":"charge_automatically","created":1679609767,"currency":"usd","current_period_end":1682288167,"current_period_start":1679609767,"customer":"cus_Na6dX7aXxi11N4","days_until_due":null,"default_payment_method":null,"default_source":null,"default_tax_rates":[],"description":null,"discount":null,"discounts":null,"ended_at":null,"invoice_settings":{"issuer":{"type":"self"}},"items":{"object":"list","data":[{"id":"si_Na6dzxczY5fwHx","object":"subscription_item","billing_thresholds":null,"created":1679609768,"metadata":{},"plan":{"id":"price_1MowQULkdIwHu7ixraBm864M","object":"plan","active":true,"aggregate_usage":null,"amount":1000,"amount_decimal":"1000","billing_scheme":"per_unit","created":1679609766,"currency":"usd","discounts":null,"interval":"month","interval_count":1,"livemode":false,"metadata":{},"nickname":null,"product":"prod_Na6dGcTsmU0I4R","tiers_mode":null,"transform_usage":null,"trial_period_days":null,"usage_type":"licensed"},"price":{"id":"price_1MowQULkdIwHu7ixraBm864M","object":"price","active":true,"billing_scheme":"per_unit","created":1679609766,"currency":"usd","custom_unit_amount":null,"livemode":false,"lookup_key":null,"metadata":{},"nickname":null,"product":"prod_Na6dGcTsmU0I4R","recurring":{"aggregate_usage":null,"interval":"month","interval_count":1,"trial_period_days":null,"usage_type":"licensed"},"tax_behavior":"unspecified","tiers_mode":null,"transform_quantity":null,"type":"recurring","unit_amount":1000,"unit_amount_decimal":"1000"},"quantity":1,"subscription":"sub_1MowQVLkdIwHu7ixeRlqHVzs","tax_rates":[]}],"has_more":false,"total_count":1,"url":"/v1/subscription_items?subscription=sub_1MowQVLkdIwHu7ixeRlqHVzs"},"latest_invoice":"in_1MowQWLkdIwHu7ixuzkSPfKd","livemode":false,"metadata":{},"next_pending_invoice_item_invoice":null,"on_behalf_of":null,"pause_collection":null,"payment_settings":{"payment_method_options":null,"payment_method_types":null,"save_default_payment_method":"off"},"pending_invoice_item_interval":null,"pending_setup_intent":null,"pending_update":null,"schedule":null,"start_date":1679609767,"status":"active","test_clock":null,"transfer_data":null,"trial_end":null,"trial_settings":{"end_behavior":{"missing_payment_method":"create_invoice"}},"trial_start":null}
   *
   * @throws {Error} Throws an error if the subscription retrieval fails.
   */
  async getSubscription(id, requestOptions) {
    logger.debug('[getSubscription] Payload', { id, requestOptions })

    assert(id, 'Subscription ID must be provided.')

    this.#initApiClient()

    return this.stripe.subscriptions.retrieve(id, requestOptions)
  }

  /**
   * @description Updates the specified subscription.
   *
   * @route PUT /subscriptions/item
   * @operationName Update Subscription
   * @category Subscription Management
   * @appearanceColor #635bff #5b84ff
   * @actionBlockColorEnd #2684fc
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes read_write
   *
   * @paramDef {"type":"String","label":"Subscription ID","name":"id","required":true,"description":"The ID of the subscription to update."}
   * @paramDef {"type":"Object","label":"Update Data","name":"updateData","required":true,"description":"The subscription data to update, such as `items`, `trial_period_days`, or `metadata`."}
   * @paramDef {"type":"Object","label":"Request Options","name":"requestOptions","description":"Request Options. Could be found in Stripe method documentation."}
   *
   * @returns {Promise.<Object>} A promise that resolves with the updated Subscription object.
   * @sampleResult {"id":"sub_1MowQVLkdIwHu7ixeRlqHVzs","object":"subscription","application":null,"application_fee_percent":null,"automatic_tax":{"enabled":false,"liability":null},"billing_cycle_anchor":1679609767,"billing_thresholds":null,"cancel_at":null,"cancel_at_period_end":false,"canceled_at":null,"cancellation_details":{"comment":null,"feedback":null,"reason":null},"collection_method":"charge_automatically","created":1679609767,"currency":"usd","current_period_end":1682288167,"current_period_start":1679609767,"customer":"cus_Na6dX7aXxi11N4","days_until_due":null,"default_payment_method":null,"default_source":null,"default_tax_rates":[],"description":null,"discount":null,"discounts":null,"ended_at":null,"invoice_settings":{"issuer":{"type":"self"}},"items":{"object":"list","data":[{"id":"si_Na6dzxczY5fwHx","object":"subscription_item","billing_thresholds":null,"created":1679609768,"metadata":{},"plan":{"id":"price_1MowQULkdIwHu7ixraBm864M","object":"plan","active":true,"aggregate_usage":null,"amount":1000,"amount_decimal":"1000","billing_scheme":"per_unit","created":1679609766,"currency":"usd","discounts":null,"interval":"month","interval_count":1,"livemode":false,"metadata":{},"nickname":null,"product":"prod_Na6dGcTsmU0I4R","tiers_mode":null,"transform_usage":null,"trial_period_days":null,"usage_type":"licensed"},"price":{"id":"price_1MowQULkdIwHu7ixraBm864M","object":"price","active":true,"billing_scheme":"per_unit","created":1679609766,"currency":"usd","custom_unit_amount":null,"livemode":false,"lookup_key":null,"metadata":{},"nickname":null,"product":"prod_Na6dGcTsmU0I4R","recurring":{"aggregate_usage":null,"interval":"month","interval_count":1,"trial_period_days":null,"usage_type":"licensed"},"tax_behavior":"unspecified","tiers_mode":null,"transform_quantity":null,"type":"recurring","unit_amount":1000,"unit_amount_decimal":"1000"},"quantity":1,"subscription":"sub_1MowQVLkdIwHu7ixeRlqHVzs","tax_rates":[]}],"has_more":false,"total_count":1,"url":"/v1/subscription_items?subscription=sub_1MowQVLkdIwHu7ixeRlqHVzs"},"latest_invoice":"in_1MowQWLkdIwHu7ixuzkSPfKd","livemode":false,"metadata":{"order_id":"6735"},"next_pending_invoice_item_invoice":null,"on_behalf_of":null,"pause_collection":null,"payment_settings":{"payment_method_options":null,"payment_method_types":null,"save_default_payment_method":"off"},"pending_invoice_item_interval":null,"pending_setup_intent":null,"pending_update":null,"schedule":null,"start_date":1679609767,"status":"active","test_clock":null,"transfer_data":null,"trial_end":null,"trial_settings":{"end_behavior":{"missing_payment_method":"create_invoice"}},"trial_start":null}
   *
   * @throws {Error} Throws an error if the subscription update fails.
   */
  async updateSubscription(id, updateData, requestOptions) {
    logger.debug('[updateSubscription] Payload', { id, updateData, requestOptions })

    assert(id, 'Subscription ID must be provided.')
    assert(isObject(updateData), 'Update data must be provided and must be an object.')

    this.#initApiClient()

    return this.stripe.subscriptions.update(id, updateData, requestOptions)
  }

  /**
   * @description Cancels a subscription and, by default, immediately finalizes the current period and sends a final invoice. Optional prorate behavior can be set.
   *
   * @route DELETE /subscriptions/item
   * @operationName Cancel Subscription
   * @category Subscription Management
   * @appearanceColor #635bff #5b84ff
   * @actionBlockColorEnd #2684fc
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes read_write
   *
   * @paramDef {"type":"String","label":"Subscription ID","name":"id","required":true,"description":"The ID of the subscription to cancel."}
   * @paramDef {"type":"Object","label":"Cancellation Data","name":"cancellationData","description":"Additional options for the cancellation, such as `invoice_now` or `prorate`."}
   * @paramDef {"type":"Object","label":"Request Options","name":"requestOptions","description":"Request Options. Could be found in Stripe method documentation."}
   *
   * @returns {Promise.<Object>} A promise that resolves with the canceled Subscription object.
   * @sampleResult {"id":"sub_1MlPf9LkdIwHu7ixB6VIYRyX","object":"subscription","application":null,"application_fee_percent":null,"automatic_tax":{"enabled":false,"liability":null},"billing_cycle_anchor":1678768838,"billing_thresholds":null,"cancel_at":null,"cancel_at_period_end":false,"canceled_at":1678768842,"cancellation_details":{"comment":null,"feedback":null,"reason":"cancellation_requested"},"collection_method":"charge_automatically","created":1678768838,"currency":"usd","current_period_end":1681447238,"current_period_start":1678768838,"customer":"cus_NWSaVkvdacCUi4","days_until_due":null,"default_payment_method":null,"default_source":null,"default_tax_rates":[],"description":null,"discount":null,"ended_at":1678768842,"invoice_settings":{"issuer":{"type":"self"}},"items":{"object":"list","data":[{"id":"si_NWSaWTp80M123q","object":"subscription_item","billing_thresholds":null,"created":1678768839,"metadata":{},"plan":{"id":"price_1MlPf7LkdIwHu7ixgcbP7cwE","object":"plan","active":true,"aggregate_usage":null,"amount":1099,"amount_decimal":"1099","billing_scheme":"per_unit","created":1678768837,"currency":"usd","interval":"month","interval_count":1,"livemode":false,"metadata":{},"nickname":null,"product":"prod_NWSaMgipulx8IQ","tiers_mode":null,"transform_usage":null,"trial_period_days":null,"usage_type":"licensed"},"price":{"id":"price_1MlPf7LkdIwHu7ixgcbP7cwE","object":"price","active":true,"billing_scheme":"per_unit","created":1678768837,"currency":"usd","custom_unit_amount":null,"livemode":false,"lookup_key":null,"metadata":{},"nickname":null,"product":"prod_NWSaMgipulx8IQ","recurring":{"aggregate_usage":null,"interval":"month","interval_count":1,"trial_period_days":null,"usage_type":"licensed"},"tax_behavior":"unspecified","tiers_mode":null,"transform_quantity":null,"type":"recurring","unit_amount":1099,"unit_amount_decimal":"1099"},"quantity":1,"subscription":"sub_1MlPf9LkdIwHu7ixB6VIYRyX","tax_rates":[]}],"has_more":false,"total_count":1,"url":"/v1/subscription_items?subscription=sub_1MlPf9LkdIwHu7ixB6VIYRyX"},"latest_invoice":"in_1MlPf9LkdIwHu7ixEo6hdgCw","livemode":false,"metadata":{},"next_pending_invoice_item_invoice":null,"on_behalf_of":null,"pause_collection":null,"payment_settings":{"payment_method_options":null,"payment_method_types":null,"save_default_payment_method":"off"},"pending_invoice_item_interval":null,"pending_setup_intent":null,"pending_update":null,"plan":{"id":"price_1MlPf7LkdIwHu7ixgcbP7cwE","object":"plan","active":true,"aggregate_usage":null,"amount":1099,"amount_decimal":"1099","billing_scheme":"per_unit","created":1678768837,"currency":"usd","interval":"month","interval_count":1,"livemode":false,"metadata":{},"nickname":null,"product":"prod_NWSaMgipulx8IQ","tiers_mode":null,"transform_usage":null,"trial_period_days":null,"usage_type":"licensed"},"quantity":1,"schedule":null,"start_date":1678768838,"status":"canceled","test_clock":null,"transfer_data":null,"trial_end":null,"trial_settings":{"end_behavior":{"missing_payment_method":"create_invoice"}},"trial_start":null}
   *
   * @throws {Error} Throws an error if the subscription cancellation fails.
   */
  async cancelSubscription(id, cancellationData, requestOptions) {
    logger.debug('[cancelSubscription] Payload', { id, cancellationData, requestOptions })

    assert(id, 'Subscription ID must be provided.')

    this.#initApiClient()

    return this.stripe.subscriptions.cancel(id, cancellationData, requestOptions)
  }

  /**
   * @description Lists all subscriptions. You can provide various options to filter the list, such as filtering by customer or subscription status.
   *
   * @route POST /subscriptions/list/get
   * @operationName Get Subscriptions List
   * @category Subscription Management
   * @appearanceColor #635bff #5b84ff
   * @actionBlockColorEnd #2684fc
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes read_only
   *
   * @paramDef {"type":"Object","label":"Options","name":"options","description":"Options to filter the list, such as `customer`, `status`, `limit`, and more."}
   * @paramDef {"type":"Object","label":"Request Options","name":"requestOptions","description":"Request Options. Could be found in Stripe method documentation."}
   *
   * @returns {Promise.<Object>} A promise that resolves with a list of Subscription objects.
   * @sampleResult {"object":"list","url":"/v1/subscriptions","has_more":false,"data":[{"id":"sub_1MowQVLkdIwHu7ixeRlqHVzs","object":"subscription","application":null,"application_fee_percent":null,"automatic_tax":{"enabled":false,"liability":null},"billing_cycle_anchor":1679609767,"billing_thresholds":null,"cancel_at":null,"cancel_at_period_end":false,"canceled_at":null,"cancellation_details":{"comment":null,"feedback":null,"reason":null},"collection_method":"charge_automatically","created":1679609767,"currency":"usd","current_period_end":1682288167,"current_period_start":1679609767,"customer":"cus_Na6dX7aXxi11N4","days_until_due":null,"default_payment_method":null,"default_source":null,"default_tax_rates":[],"description":null,"discount":null,"discounts":null,"ended_at":null,"invoice_settings":{"issuer":{"type":"self"}},"items":{"object":"list","data":[{"id":"si_Na6dzxczY5fwHx","object":"subscription_item","billing_thresholds":null,"created":1679609768,"metadata":{},"plan":{"id":"price_1MowQULkdIwHu7ixraBm864M","object":"plan","active":true,"aggregate_usage":null,"amount":1000,"amount_decimal":"1000","billing_scheme":"per_unit","created":1679609766,"currency":"usd","discounts":null,"interval":"month","interval_count":1,"livemode":false,"metadata":{},"nickname":null,"product":"prod_Na6dGcTsmU0I4R","tiers_mode":null,"transform_usage":null,"trial_period_days":null,"usage_type":"licensed"},"price":{"id":"price_1MowQULkdIwHu7ixraBm864M","object":"price","active":true,"billing_scheme":"per_unit","created":1679609766,"currency":"usd","custom_unit_amount":null,"livemode":false,"lookup_key":null,"metadata":{},"nickname":null,"product":"prod_Na6dGcTsmU0I4R","recurring":{"aggregate_usage":null,"interval":"month","interval_count":1,"trial_period_days":null,"usage_type":"licensed"},"tax_behavior":"unspecified","tiers_mode":null,"transform_quantity":null,"type":"recurring","unit_amount":1000,"unit_amount_decimal":"1000"},"quantity":1,"subscription":"sub_1MowQVLkdIwHu7ixeRlqHVzs","tax_rates":[]}],"has_more":false,"total_count":1,"url":"/v1/subscription_items?subscription=sub_1MowQVLkdIwHu7ixeRlqHVzs"},"latest_invoice":"in_1MowQWLkdIwHu7ixuzkSPfKd","livemode":false,"metadata":{},"next_pending_invoice_item_invoice":null,"on_behalf_of":null,"pause_collection":null,"payment_settings":{"payment_method_options":null,"payment_method_types":null,"save_default_payment_method":"off"},"pending_invoice_item_interval":null,"pending_setup_intent":null,"pending_update":null,"schedule":null,"start_date":1679609767,"status":"active","test_clock":null,"transfer_data":null,"trial_end":null,"trial_settings":{"end_behavior":{"missing_payment_method":"create_invoice"}},"trial_start":null}]}
   *
   * @throws {Error} Throws an error if the subscription listing fails.
   */
  async getSubscriptionsList(options, requestOptions) {
    logger.debug('[getSubscriptionsList] Payload', { options, requestOptions })

    this.#initApiClient()

    return this.stripe.subscriptions.list(options, requestOptions)
  }

  /**
   * @description Creates a new product object, which can then be used in subscriptions or as part of the Stripe checkout process.
   *
   * @route POST /products
   * @operationName Create Product
   * @category Product Management
   * @appearanceColor #635bff #5b84ff
   * @actionBlockColorEnd #2684fc
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes read_write
   *
   * @paramDef {"type":"Object","label":"Product Data","name":"productData","required":true,"description":"Details about the product, such as the `name` and `type`."}
   * @paramDef {"type":"Object","label":"Request Options","name":"requestOptions","description":"Request Options. Could be found in Stripe method documentation."}
   *
   * @returns {Promise.<Object>} A promise that resolves with the created Product object.
   * @sampleResult {"id":"prod_NWjs8kKbJWmuuc","object":"product","active":true,"created":1678833149,"default_price":null,"description":null,"images":[],"marketing_features":[],"livemode":false,"metadata":{},"name":"Gold Plan","package_dimensions":null,"shippable":null,"statement_descriptor":null,"tax_code":null,"unit_label":null,"updated":1678833149,"url":null}
   *
   * @throws {Error} Throws an error if the product creation fails.
   */
  async createProduct(productData, requestOptions) {
    logger.debug('[createProduct] Payload', { productData, requestOptions })

    assert(isObject(productData), 'Product data must be provided and must be an object.')
    assert(productData?.name, 'Product property "name" must be provided.')

    this.#initApiClient()

    return this.stripe.products.create(productData, requestOptions)
  }

  /**
   * @description Retrieves the details of a specific product by its ID.
   *
   * @route POST /products/item/get
   * @operationName Get Product
   * @category Product Management
   * @appearanceColor #635bff #5b84ff
   * @actionBlockColorEnd #2684fc
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes read_only
   *
   * @paramDef {"type":"String","label":"Product ID","name":"id","required":true,"description":"The ID of the product to retrieve."}
   * @paramDef {"type":"Object","label":"Request Options","name":"requestOptions","description":"Request Options. Could be found in Stripe method documentation."}
   *
   * @returns {Promise.<Object>} A promise that resolves with the retrieved Product object.
   * @sampleResult {"id":"prod_NWjs8kKbJWmuuc","object":"product","active":true,"created":1678833149,"default_price":null,"description":null,"images":[],"marketing_features":[],"livemode":false,"metadata":{},"name":"Gold Plan","package_dimensions":null,"shippable":null,"statement_descriptor":null,"tax_code":null,"unit_label":null,"updated":1678833149,"url":null}
   *
   * @throws {Error} Throws an error if the product retrieval fails.
   */
  async getProduct(id, requestOptions) {
    logger.debug('[getProduct] Payload', { id, requestOptions })

    assert(id, 'Product ID must be provided.')

    this.#initApiClient()

    return this.stripe.products.retrieve(id, requestOptions)
  }

  /**
   * @description Updates the details of an existing product by its ID.
   *
   * @route PUT /products/item
   * @operationName Update Product
   * @category Product Management
   * @appearanceColor #635bff #5b84ff
   * @actionBlockColorEnd #2684fc
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes read_write
   *
   * @paramDef {"type":"String","label":"Product ID","name":"id","required":true,"description":"The ID of the product to update."}
   * @paramDef {"type":"Object","label":"Update Data","name":"updateData","required":true,"description":"Details to update on the product, such as `name`, `metadata`, etc."}
   * @paramDef {"type":"Object","label":"Request Options","name":"requestOptions","description":"Request Options. Could be found in Stripe method documentation."}
   *
   * @returns {Promise.<Object>} A promise that resolves with the updated Product object.
   * @sampleResult {"id":"prod_NWjs8kKbJWmuuc","object":"product","active":true,"created":1678833149,"default_price":null,"description":null,"images":[],"marketing_features":[],"livemode":false,"metadata":{"order_id":"6735"},"name":"Gold Plan","package_dimensions":null,"shippable":null,"statement_descriptor":null,"tax_code":null,"unit_label":null,"updated":1678833149,"url":null}
   *
   * @throws {Error} Throws an error if the product update fails.
   */
  async updateProduct(id, updateData, requestOptions) {
    logger.debug('[updateProduct] Payload', { id, updateData, requestOptions })

    assert(id, 'Product ID must be provided.')
    assert(isObject(updateData), 'Update data must be provided and must be an object.')

    this.#initApiClient()

    return this.stripe.products.update(id, updateData, requestOptions)
  }

  /**
   * @description Deletes a product. Deleting a product also deletes its associated prices.
   *
   * @route DELETE /products/item
   * @operationName Delete Product
   * @category Product Management
   * @appearanceColor #635bff #5b84ff
   * @actionBlockColorEnd #2684fc
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes read_write
   *
   * @paramDef {"type":"String","label":"Product ID","name":"id","required":true,"description":"The ID of the product to delete."}
   * @paramDef {"type":"Object","label":"Request Options","name":"requestOptions","description":"Request Options. Could be found in Stripe method documentation."}
   *
   * @returns {Promise.<Object>} A promise that resolves with the deleted Product object.
   * @sampleResult {"id":"prod_NWjs8kKbJWmuuc","object":"product","deleted":true}
   *
   * @throws {Error} Throws an error if the product deletion fails.
   */
  async deleteProduct(id, requestOptions) {
    logger.debug('[deleteProduct] Payload', { id, requestOptions })

    assert(id, 'Product ID must be provided.')

    this.#initApiClient()

    return this.stripe.products.del(id, requestOptions)
  }

  /**
   * @description Lists all products. You can provide options to filter the list, such as by `active` status or `limit`.
   *
   * @route POST /products/get
   * @operationName Get Products List
   * @category Product Management
   * @appearanceColor #635bff #5b84ff
   * @actionBlockColorEnd #2684fc
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes read_only
   *
   * @paramDef {"type":"Object","label":"Options","name":"options","description":"Options to filter the list of products, such as `active` status, `limit`, or `starting_after`."}
   * @paramDef {"type":"Object","label":"Request Options","name":"requestOptions","description":"Request Options. Could be found in Stripe method documentation."}
   *
   * @returns {Promise.<Object>} A promise that resolves with a list of Product objects.
   * @sampleResult {"object":"list","url":"/v1/products","has_more":false,"data":[{"id":"prod_NWjs8kKbJWmuuc","object":"product","active":true,"created":1678833149,"default_price":null,"description":null,"images":[],"marketing_features":[],"livemode":false,"metadata":{},"name":"Gold Plan","package_dimensions":null,"shippable":null,"statement_descriptor":null,"tax_code":null,"unit_label":null,"updated":1678833149,"url":null}]}
   *
   * @throws {Error} Throws an error if the product listing fails.
   */
  async getProductsList(options, requestOptions) {
    logger.debug('[getProductsList] Payload', { options, requestOptions })

    this.#initApiClient()

    return this.stripe.products.list(options, requestOptions)
  }

  /**
   * @description Creates a new price object. A price is used to define a recurring or one-time charge for a product.
   *
   * @route POST /prices
   * @operationName Create Price
   * @category Product Management
   * @appearanceColor #635bff #5b84ff
   * @actionBlockColorEnd #2684fc
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes read_write
   *
   * @paramDef {"type":"Object","label":"Price Data","name":"priceData","required":true,"description":"Details about the price (`currency`, and `product` or `product_data` are required)"}
   * @paramDef {"type":"Object","label":"Request Options","name":"requestOptions","description":"Request Options. Could be found in Stripe method documentation."}
   *
   * @returns {Promise.<Object>} A promise that resolves with the created Price object.
   * @sampleResult {"id":"price_1MoBy5LkdIwHu7ixZhnattbh","object":"price","active":true,"billing_scheme":"per_unit","created":1679431181,"currency":"usd","custom_unit_amount":null,"livemode":false,"lookup_key":null,"metadata":{},"nickname":null,"product":"prod_NZKdYqrwEYx6iK","recurring":{"aggregate_usage":null,"interval":"month","interval_count":1,"trial_period_days":null,"usage_type":"licensed"},"tax_behavior":"unspecified","tiers_mode":null,"transform_quantity":null,"type":"recurring","unit_amount":1000,"unit_amount_decimal":"1000"}
   *
   * @throws {Error} Throws an error if price creation fails.
   */
  async createPrice(priceData, requestOptions) {
    logger.debug('[createPrice] Payload', { priceData, requestOptions })

    const { currency, product, product_data } = priceData || {}

    assert(currency, 'Price property - "currency" must be provided.')
    assert(product || product_data, 'Price property "product" or "product_data" must be provided.')

    this.#initApiClient()

    return this.stripe.prices.create(priceData, requestOptions)
  }

  /**
   * @description Retrieves the details of a specific price by its ID.
   *
   * @route POST /prices/item/get
   * @operationName Get Price
   * @category Product Management
   * @appearanceColor #635bff #5b84ff
   * @actionBlockColorEnd #2684fc
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes read_only
   *
   * @paramDef {"type":"String","label":"Price ID","name":"id","required":true,"description":"The ID of the price to retrieve."}
   * @paramDef {"type":"Object","label":"Request Options","name":"requestOptions","description":"Request Options. Could be found in Stripe method documentation."}
   *
   * @returns {Promise.<Object>} A promise that resolves with the retrieved Price object.
   * @sampleResult {"id":"price_1MoBy5LkdIwHu7ixZhnattbh","object":"price","active":true,"billing_scheme":"per_unit","created":1679431181,"currency":"usd","custom_unit_amount":null,"livemode":false,"lookup_key":null,"metadata":{},"nickname":null,"product":"prod_NZKdYqrwEYx6iK","recurring":{"aggregate_usage":null,"interval":"month","interval_count":1,"trial_period_days":null,"usage_type":"licensed"},"tax_behavior":"unspecified","tiers_mode":null,"transform_quantity":null,"type":"recurring","unit_amount":1000,"unit_amount_decimal":"1000"}
   *
   * @throws {Error} Throws an error if the price retrieval fails.
   */
  async getPrice(id, requestOptions) {
    logger.debug('[getPrice] Payload', { id, requestOptions })

    assert(id, 'Price ID must be provided.')

    this.#initApiClient()

    return this.stripe.prices.retrieve(id, requestOptions)
  }

  /**
   * @description Updates the details of an existing price.
   *
   * @route PUT /prices/item
   * @operationName Update Price
   * @category Product Management
   * @appearanceColor #635bff #5b84ff
   * @actionBlockColorEnd #2684fc
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes read_write
   *
   * @paramDef {"type":"String","label":"Price ID","name":"id","required":true,"description":"The ID of the price to update."}
   * @paramDef {"type":"Object","label":"Update Data","name":"updateData","required":true,"description":"Details to update on the price, such as `metadata`, `nickname`, or `active` status."}
   * @paramDef {"type":"Object","label":"Request Options","name":"requestOptions","description":"Request Options. Could be found in Stripe method documentation."}
   *
   * @returns {Promise.<Object>} A promise that resolves with the updated Price object.
   * @sampleResult {"id":"price_1MoBy5LkdIwHu7ixZhnattbh","object":"price","active":true,"billing_scheme":"per_unit","created":1679431181,"currency":"usd","custom_unit_amount":null,"livemode":false,"lookup_key":null,"metadata":{"order_id":"6735"},"nickname":null,"product":"prod_NZKdYqrwEYx6iK","recurring":{"aggregate_usage":null,"interval":"month","interval_count":1,"trial_period_days":null,"usage_type":"licensed"},"tax_behavior":"unspecified","tiers_mode":null,"transform_quantity":null,"type":"recurring","unit_amount":1000,"unit_amount_decimal":"1000"}
   *
   * @throws {Error} Throws an error if the price update fails.
   */
  async updatePrice(id, updateData, requestOptions) {
    logger.debug('[updatePrice] Payload', { id, updateData, requestOptions })

    assert(id, 'Price ID must be provided.')
    assert(isObject(updateData), 'Update data must be provided and must be an object.')

    this.#initApiClient()

    return this.stripe.prices.update(id, updateData, requestOptions)
  }

  /**
   * @description Lists all prices, optionally filtered by parameters such as `active` status or `product`.
   *
   * @route POST /prices/get
   * @operationName Get Prices List
   * @category Product Management
   * @appearanceColor #635bff #5b84ff
   * @actionBlockColorEnd #2684fc
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes read_only
   *
   * @paramDef {"type":"Object","label":"Options","name":"options","description":"Options to filter the list of prices, such as `active` status, `product`, or `limit`."}
   * @paramDef {"type":"Object","label":"Request Options","name":"requestOptions","description":"Request Options. Could be found in Stripe method documentation."}
   *
   * @returns {Promise.<Object>} A promise that resolves with a list of Price objects.
   * @sampleResult {"object":"list","url":"/v1/prices","has_more":false,"data":[{"id":"price_1MoBy5LkdIwHu7ixZhnattbh","object":"price","active":true,"billing_scheme":"per_unit","created":1679431181,"currency":"usd","custom_unit_amount":null,"livemode":false,"lookup_key":null,"metadata":{},"nickname":null,"product":"prod_NZKdYqrwEYx6iK","recurring":{"aggregate_usage":null,"interval":"month","interval_count":1,"trial_period_days":null,"usage_type":"licensed"},"tax_behavior":"unspecified","tiers_mode":null,"transform_quantity":null,"type":"recurring","unit_amount":1000,"unit_amount_decimal":"1000"}]}
   *
   * @throws {Error} Throws an error if the price listing fails.
   */
  async getPricesList(options, requestOptions) {
    logger.debug('[getPricesList] Payload', { options, requestOptions })

    this.#initApiClient()

    return this.stripe.prices.list(options, requestOptions)
  }

  /**
   * @description Creates a new Payment Link object, allowing you to generate shareable URLs to collect payment.
   *
   * @route POST /payment_links
   * @operationName Create Payment Link
   * @category Payment Links
   * @appearanceColor #635bff #5b84ff
   * @actionBlockColorEnd #2684fc
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes read_write
   *
   * @paramDef {"type":"Object","label":"Payment Link Data","name":"paymentLinkData","required":true,"description":"Details about the Payment Link, such as the `line_items`."}
   * @paramDef {"type":"Object","label":"Request Options","name":"requestOptions","description":"Request Options. Could be found in Stripe method documentation."}
   *
   * @returns {Promise.<Object>} A promise that resolves with the created Payment Link object.
   * @sampleResult {"id":"plink_1MoC3ULkdIwHu7ixZjtGpVl2","object":"payment_link","active":true,"after_completion":{"hosted_confirmation":{"custom_message":null},"type":"hosted_confirmation"},"allow_promotion_codes":false,"application_fee_amount":null,"application_fee_percent":null,"automatic_tax":{"enabled":false,"liability":null},"billing_address_collection":"auto","consent_collection":null,"currency":"usd","custom_fields":[],"custom_text":{"shipping_address":null,"submit":null},"customer_creation":"if_required","invoice_creation":{"enabled":false,"invoice_data":{"account_tax_ids":null,"custom_fields":null,"description":null,"footer":null,"issuer":null,"metadata":{},"rendering_options":null}},"livemode":false,"metadata":{},"on_behalf_of":null,"payment_intent_data":null,"payment_method_collection":"always","payment_method_types":null,"phone_number_collection":{"enabled":false},"shipping_address_collection":null,"shipping_options":[],"submit_type":"auto","subscription_data":{"description":null,"invoice_settings":{"issuer":{"type":"self"}},"trial_period_days":null},"tax_id_collection":{"enabled":false},"transfer_data":null,"url":"https://buy.stripe.com/test_cN25nr0iZ7bUa7meUY"}
   *
   * @throws {Error} Throws an error if the payment link creation fails.
   */
  async createPaymentLink(paymentLinkData, requestOptions) {
    logger.debug('[createPaymentLink] Payload', { paymentLinkData, requestOptions })

    assert(isObject(paymentLinkData), 'Payment Link data must be provided and must be an object.')

    this.#initApiClient()

    return this.stripe.paymentLinks.create(paymentLinkData, requestOptions)
  }

  /**
   * @description Deactivate a Payment Link
   *
   * @route POST /payment_links/item/deactivate
   * @operationName Deactivate Payment Link
   * @category Payment Links
   * @appearanceColor #635bff #5b84ff
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes read_write
   *
   * @paramDef {"type":"String","label":"Payment Link ID","name":"id","required":true,"description":"ID of the Payment Link to deactivate"}
   * @paramDef {"type":"Object","label":"Request Options","name":"requestOptions","description":"Request Options. Could be found in Stripe method documentation."}
   *
   * @returns {Object} <PaymentLink>
   * @sampleResult {"id":"plink_1MoC3ULkdIwHu7ixZjtGpVl2","object":"payment_link","active":true,"after_completion":{"hosted_confirmation":{"custom_message":null},"type":"hosted_confirmation"},"allow_promotion_codes":false,"application_fee_amount":null,"application_fee_percent":null,"automatic_tax":{"enabled":false,"liability":null},"billing_address_collection":"auto","consent_collection":null,"currency":"usd","custom_fields":[],"custom_text":{"shipping_address":null,"submit":null},"customer_creation":"if_required","invoice_creation":{"enabled":false,"invoice_data":{"account_tax_ids":null,"custom_fields":null,"description":null,"footer":null,"issuer":null,"metadata":{},"rendering_options":null}},"livemode":false,"metadata":{"order_id":"6735"},"on_behalf_of":null,"payment_intent_data":null,"payment_method_collection":"always","payment_method_types":null,"phone_number_collection":{"enabled":false},"shipping_address_collection":null,"shipping_options":[],"submit_type":"auto","subscription_data":{"description":null,"invoice_settings":{"issuer":{"type":"self"}},"trial_period_days":null},"tax_id_collection":{"enabled":false},"transfer_data":null,"url":"https://buy.stripe.com/test_cN25nr0iZ7bUa7meUY"}
   *
   * @throws {Error} Throws an error if the payment link update fails.
   */
  async deactivatePaymentLink(id, requestOptions) {
    logger.debug('[deactivatePaymentLink] Payload', { id, requestOptions })

    assert(id, 'Payment Link ID must be provided.')

    this.#initApiClient()

    return this.stripe.paymentLinks.update(id, { active: false }, requestOptions)
  }

  /**
   * @description Updates an existing Payment Link, including its status(deactivating).
   *
   * @route PUT /payment_links/item
   * @operationName Update Payment Link
   * @category Payment Links
   * @appearanceColor #635bff #5b84ff
   * @actionBlockColorEnd #2684fc
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes read_write
   *
   * @paramDef {"type":"String","label":"Payment Link ID","name":"id","required":true,"description":"The ID of the Payment Link to update."}
   * @paramDef {"type":"Object","label":"Update Data","name":"updateData","required":true,"description":"Details to update on the Payment Link, such as `active` status."}
   * @paramDef {"type":"Object","label":"Request Options","name":"requestOptions","description":"Request Options. Could be found in Stripe method documentation."}
   *
   * @returns {Promise.<Object>} A promise that resolves with the updated Payment Link object.
   * @sampleResult {"id":"plink_1MoC3ULkdIwHu7ixZjtGpVl2","object":"payment_link","active":true,"after_completion":{"hosted_confirmation":{"custom_message":null},"type":"hosted_confirmation"},"allow_promotion_codes":false,"application_fee_amount":null,"application_fee_percent":null,"automatic_tax":{"enabled":false,"liability":null},"billing_address_collection":"auto","consent_collection":null,"currency":"usd","custom_fields":[],"custom_text":{"shipping_address":null,"submit":null},"customer_creation":"if_required","invoice_creation":{"enabled":false,"invoice_data":{"account_tax_ids":null,"custom_fields":null,"description":null,"footer":null,"issuer":null,"metadata":{},"rendering_options":null}},"livemode":false,"metadata":{"order_id":"6735"},"on_behalf_of":null,"payment_intent_data":null,"payment_method_collection":"always","payment_method_types":null,"phone_number_collection":{"enabled":false},"shipping_address_collection":null,"shipping_options":[],"submit_type":"auto","subscription_data":{"description":null,"invoice_settings":{"issuer":{"type":"self"}},"trial_period_days":null},"tax_id_collection":{"enabled":false},"transfer_data":null,"url":"https://buy.stripe.com/test_cN25nr0iZ7bUa7meUY"}
   *
   * @throws {Error} Throws an error if the payment link update fails.
   */
  async updatePaymentLink(id, updateData, requestOptions) {
    logger.debug('[updatePaymentLink] Payload', { id, updateData, requestOptions })

    assert(id, 'Payment Link ID must be provided.')
    assert(isObject(updateData), 'Update data must be provided and must be an object.')

    this.#initApiClient()

    return this.stripe.paymentLinks.update(id, updateData, requestOptions)
  }

  /**
   * @description Retrieves the details of a specific Payment Link by its ID.
   *
   * @route POST /payment-links/item/get
   * @operationName Get Payment Link
   * @category Payment Links
   * @appearanceColor #635bff #5b84ff
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes read_only
   *
   * @paramDef {"type":"String","label":"Payment Link ID","name":"id","required":true,"description":"The ID of the Payment Link to retrieve."}
   * @paramDef {"type":"Object","label":"Request Options","name":"requestOptions","description":"Request Options. Could be found in Stripe method documentation."}
   *
   * @returns {Promise.<Object>} A promise that resolves with the retrieved Payment Link object.
   * @sampleResult {"id":"plink_1MoC3ULkdIwHu7ixZjtGpVl2","object":"payment_link","active":true,"after_completion":{"hosted_confirmation":{"custom_message":null},"type":"hosted_confirmation"},"allow_promotion_codes":false,"application_fee_amount":null,"application_fee_percent":null,"automatic_tax":{"enabled":false,"liability":null},"billing_address_collection":"auto","consent_collection":null,"currency":"usd","custom_fields":[],"custom_text":{"shipping_address":null,"submit":null},"customer_creation":"if_required","invoice_creation":{"enabled":false,"invoice_data":{"account_tax_ids":null,"custom_fields":null,"description":null,"footer":null,"issuer":null,"metadata":{},"rendering_options":null}},"livemode":false,"metadata":{},"on_behalf_of":null,"payment_intent_data":null,"payment_method_collection":"always","payment_method_types":null,"phone_number_collection":{"enabled":false},"shipping_address_collection":null,"shipping_options":[],"submit_type":"auto","subscription_data":{"description":null,"invoice_settings":{"issuer":{"type":"self"}},"trial_period_days":null},"tax_id_collection":{"enabled":false},"transfer_data":null,"url":"https://buy.stripe.com/test_cN25nr0iZ7bUa7meUY"}
   *
   * @throws {Error} Throws an error if the payment link retrieval fails.
   */
  async getPaymentLink(id, requestOptions) {
    logger.debug('[getPaymentLink] Payload', { id, requestOptions })

    assert(id, 'Payment Link ID must be provided.')

    this.#initApiClient()

    return this.stripe.paymentLinks.retrieve(id, requestOptions)
  }

  /**
   * @description Lists all Payment Links. You can filter the results using various parameters, such as `limit`.
   *
   * @route POST /payment-links/get
   * @operationName Get Payment Links List
   * @category Payment Links
   * @appearanceColor #635bff #5b84ff
   * @actionBlockColorEnd #2684fc
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes read_only
   *
   * @paramDef {"type":"Object","label":"Options","name":"options","description":"Options to filter the list of Payment Links, such as `limit` or `starting_after`."}
   * @paramDef {"type":"Object","label":"Request Options","name":"requestOptions","description":"Request Options. Could be found in Stripe method documentation."}
   *
   * @returns {Promise.<Object>} A promise that resolves with a list of Payment Link objects.
   * @sampleResult {"object":"list","url":"/v1/payment_links","has_more":false,"data":[{"id":"plink_1MoC3ULkdIwHu7ixZjtGpVl2","object":"payment_link","active":true,"after_completion":{"hosted_confirmation":{"custom_message":null},"type":"hosted_confirmation"},"allow_promotion_codes":false,"application_fee_amount":null,"application_fee_percent":null,"automatic_tax":{"enabled":false,"liability":null},"billing_address_collection":"auto","consent_collection":null,"currency":"usd","custom_fields":[],"custom_text":{"shipping_address":null,"submit":null},"customer_creation":"if_required","invoice_creation":{"enabled":false,"invoice_data":{"account_tax_ids":null,"custom_fields":null,"description":null,"footer":null,"issuer":null,"metadata":{},"rendering_options":null}},"livemode":false,"metadata":{},"on_behalf_of":null,"payment_intent_data":null,"payment_method_collection":"always","payment_method_types":null,"phone_number_collection":{"enabled":false},"shipping_address_collection":null,"shipping_options":[],"submit_type":"auto","subscription_data":{"description":null,"invoice_settings":{"issuer":{"type":"self"}},"trial_period_days":null},"tax_id_collection":{"enabled":false},"transfer_data":null,"url":"https://buy.stripe.com/test_cN25nr0iZ7bUa7meUY"}]}
   *
   * @throws {Error} Throws an error if the payment link listing fails.
   */
  async getPaymentLinksList(options, requestOptions) {
    logger.debug('[getPaymentLinksList] Payload', { options, requestOptions })

    this.#initApiClient()

    return this.stripe.paymentLinks.list(options, requestOptions)
  }

  /**
   * @description Retrieves line items of a specific Payment Link.
   *
   * @route POST /payment-links/item/line-items/get
   * @operationName Get Payment Link Line Items
   * @category Payment Links
   * @appearanceColor #635bff #5b84ff
   * @actionBlockColorEnd #2684fc
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes read_only
   *
   * @paramDef {"type":"String","label":"Payment Link ID","name":"id","required":true,"description":"The ID of the Payment Link to retrieve its line items."}
   * @paramDef {"type":"Object","label":"Options","name":"options","description":"Options to filter the list of line items, such as `limit`."}
   * @paramDef {"type":"Object","label":"Request Options","name":"requestOptions","description":"Request Options. Could be found in Stripe method documentation."}
   *
   * @returns {Promise.<Object>} A promise that resolves with the list of line items.
   * @sampleResult {"object":"list","data":[{"id":"li_NpsHNiHSaDeU0X","object":"item","amount_discount":0,"amount_subtotal":1099,"amount_tax":0,"amount_total":1099,"currency":"usd","description":"T-shirt","price":{"id":"price_1N4AEsLkdIwHu7ix7Ssho8Cl","object":"price","active":true,"billing_scheme":"per_unit","created":1683237782,"currency":"usd","custom_unit_amount":null,"livemode":false,"lookup_key":null,"metadata":{},"nickname":null,"product":"prod_NppuJWzzNnD5Ut","recurring":null,"tax_behavior":"unspecified","tiers_mode":null,"transform_quantity":null,"type":"one_time","unit_amount":1099,"unit_amount_decimal":"1099"},"quantity":1}],"has_more":false,"url":"/v1/payment_links/plink_1N4CWjLkdIwHu7ix2Y2F1kqb/line_items"}
   *
   * @throws {Error} Throws an error if the payment link line item retrieval fails.
   */
  async getPaymentLinkLineItems(id, options, requestOptions) {
    logger.debug('[getPaymentLinkLineItems] Payload', { id, options, requestOptions })

    assert(id, 'Payment Link ID must be provided.')

    this.#initApiClient()

    return this.stripe.paymentLinks.listLineItems(id, options, requestOptions)
  }

  /**
   * @description Creates a transfer to move funds between accounts.
   *
   * @route POST /transfers
   * @operationName Create Transfer
   * @category Money Movement
   * @appearanceColor #635bff #5b84ff
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes read_write
   *
   * @paramDef {"type":"Object","label":"Transfer Data","name":"transferData","required":true,"description":"Details about the transfer (`amount`, `currency`, and `destination` are required)."}
   * @paramDef {"type":"Object","label":"Request Options","name":"requestOptions","description":"Request Options. Could be found in Stripe method documentation."}
   *
   * @returns {Promise.<Object>} A promise that resolves with the created Transfer object.
   * @sampleResult {"id":"tr_1MiN3gLkdIwHu7ixNCZvFdgA","object":"transfer","amount":400,"amount_reversed":0,"balance_transaction":"txn_1MiN3gLkdIwHu7ixxapQrznl","created":1678043844,"currency":"usd","description":null,"destination":"acct_1MTfjCQ9PRzxEwkZ","destination_payment":"py_1MiN3gQ9PRzxEwkZWTPGNq9o","livemode":false,"metadata":{},"reversals":{"object":"list","data":[],"has_more":false,"total_count":0,"url":"/v1/transfers/tr_1MiN3gLkdIwHu7ixNCZvFdgA/reversals"},"reversed":false,"source_transaction":null,"source_type":"card","transfer_group":"ORDER_95"}
   *
   * @throws {Error} Throws an error if the transfer creation fails.
   */
  async createTransfer(transferData, requestOptions) {
    logger.debug('[createTransfer] Payload', { transferData, requestOptions })

    assert(transferData?.amount, 'Transfer property "amount" must be provided.')
    assert(transferData?.currency, 'Transfer property "currency" must be provided.')
    assert(transferData?.destination, 'Transfer property "destination" must be provided.')

    this.#initApiClient()

    return this.stripe.transfers.create(transferData, requestOptions)
  }

  /**
   * @description Updates the specified transfer by setting the values of the parameters passed.
   *
   * @route PUT /transfers/item
   * @operationName Update Transfer
   * @category Money Movement
   * @appearanceColor #635bff #5b84ff
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes read_write
   *
   * @paramDef {"type":"String","label":"Transfer ID","name":"id","required":true,"description":"The ID of the transfer to update."}
   * @paramDef {"type":"Object","label":"Update Data","name":"updateData","required":true,"description":"Details to update on the transfer, such as `metadata` and `description`."}
   * @paramDef {"type":"Object","label":"Request Options","name":"requestOptions","description":"Request Options. Could be found in Stripe method documentation."}
   *
   * @returns {Promise.<Object>} A promise that resolves with the updated Transfer object.
   * @sampleResult {"id":"tr_1MiN3gLkdIwHu7ixNCZvFdgA","object":"transfer","amount":400,"amount_reversed":0,"balance_transaction":"txn_1MiN3gLkdIwHu7ixxapQrznl","created":1678043844,"currency":"usd","description":null,"destination":"acct_1MTfjCQ9PRzxEwkZ","destination_payment":"py_1MiN3gQ9PRzxEwkZWTPGNq9o","livemode":false,"metadata":{"order_id":"6735"},"reversals":{"object":"list","data":[],"has_more":false,"total_count":0,"url":"/v1/transfers/tr_1MiN3gLkdIwHu7ixNCZvFdgA/reversals"},"reversed":false,"source_transaction":null,"source_type":"card","transfer_group":"ORDER_95"}
   *
   * @throws {Error} Throws an error if the transfer update fails.
   */
  async updateTransfer(id, updateData, requestOptions) {
    logger.debug('[updateTransfer] Payload', { id, updateData, requestOptions })

    assert(id, 'Transfer ID must be provided.')
    assert(isObject(updateData), 'Update data must be provided and must be an object.')

    this.#initApiClient()

    return this.stripe.transfers.update(id, updateData, requestOptions)
  }

  /**
   * @description Retrieves the details of a specific transfer by its ID.
   *
   * @route POST /transfers/item/get
   * @operationName Get Transfer
   * @category Money Movement
   * @appearanceColor #635bff #5b84ff
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes read_only
   *
   * @paramDef {"type":"String","label":"Transfer ID","name":"id","required":true,"description":"The ID of the transfer to retrieve."}
   * @paramDef {"type":"Object","label":"Request Options","name":"requestOptions","description":"Request Options. Could be found in Stripe method documentation."}
   *
   * @returns {Promise.<Object>} A promise that resolves with the retrieved Transfer object.
   * @sampleResult {"id":"tr_1MiN3gLkdIwHu7ixNCZvFdgA","object":"transfer","amount":400,"amount_reversed":0,"balance_transaction":"txn_1MiN3gLkdIwHu7ixxapQrznl","created":1678043844,"currency":"usd","description":null,"destination":"acct_1MTfjCQ9PRzxEwkZ","destination_payment":"py_1MiN3gQ9PRzxEwkZWTPGNq9o","livemode":false,"metadata":{},"reversals":{"object":"list","data":[],"has_more":false,"total_count":0,"url":"/v1/transfers/tr_1MiN3gLkdIwHu7ixNCZvFdgA/reversals"},"reversed":false,"source_transaction":null,"source_type":"card","transfer_group":"ORDER_95"}
   *
   * @throws {Error} Throws an error if the transfer retrieval fails.
   */
  async getTransfer(id, requestOptions) {
    logger.debug('[getTransfer] Payload', { id, requestOptions })

    assert(id, 'Transfer ID must be provided.')

    this.#initApiClient()

    return this.stripe.transfers.retrieve(id, requestOptions)
  }

  /**
   * @description Lists all transfers, with optional filters such as `created`, `limit`, or `starting_after`.
   *
   * @route POST /transfers/get
   * @operationName Get Transfers List
   * @category Money Movement
   * @appearanceColor #635bff #5b84ff
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes read_only
   *
   * @paramDef {"type":"Object","label":"Options","name":"options","description":"Options to filter the list of transfers, such as `limit` and `starting_after`."}
   * @paramDef {"type":"Object","label":"Request Options","name":"requestOptions","description":"Request Options. Could be found in Stripe method documentation."}
   *
   * @returns {Promise.<Object>} A promise that resolves with a list of Transfer objects.
   * @sampleResult {"object":"list","url":"/v1/transfers","has_more":false,"data":[{"id":"tr_1MiN3gLkdIwHu7ixNCZvFdgA","object":"transfer","amount":400,"amount_reversed":0,"balance_transaction":"txn_1MiN3gLkdIwHu7ixxapQrznl","created":1678043844,"currency":"usd","description":null,"destination":"acct_1MTfjCQ9PRzxEwkZ","destination_payment":"py_1MiN3gQ9PRzxEwkZWTPGNq9o","livemode":false,"metadata":{},"reversals":{"object":"list","data":[],"has_more":false,"total_count":0,"url":"/v1/transfers/tr_1MiN3gLkdIwHu7ixNCZvFdgA/reversals"},"reversed":false,"source_transaction":null,"source_type":"card","transfer_group":"ORDER_95"}]}
   *
   * @throws {Error} Throws an error if the transfer listing fails.
   */
  async getTransfersList(options, requestOptions) {
    logger.debug('[getTransfersList] Payload', { options, requestOptions })

    this.#initApiClient()

    return this.stripe.transfers.list(options, requestOptions)
  }

  /**
   * @description Creates a refund for a previously created charge or payment intent.
   *
   * @route POST /refunds
   * @operationName Create Refund
   * @category Money Movement
   * @appearanceColor #635bff #5b84ff
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes read_write
   *
   * @paramDef {"type":"Object","label":"Refund Data","name":"refundData","required":true,"description":"Details about the refund(`charge` or `payment_intent` is required)."}
   * @paramDef {"type":"Object","label":"Request Options","name":"requestOptions","description":"Request Options. Could be found in Stripe method documentation."}
   *
   * @returns {Promise.<Object>} A promise that resolves with the created Refund object.
   * @sampleResult {"id":"re_1Nispe2eZvKYlo2Cd31jOCgZ","object":"refund","amount":1000,"balance_transaction":"txn_1Nispe2eZvKYlo2CYezqFhEx","charge":"ch_1NirD82eZvKYlo2CIvbtLWuY","created":1692942318,"currency":"usd","destination_details":{"card":{"reference":"123456789012","reference_status":"available","reference_type":"acquirer_reference_number","type":"refund"},"type":"card"},"metadata":{},"payment_intent":"pi_1GszsK2eZvKYlo2CfhZyoZLp","reason":null,"receipt_number":null,"source_transfer_reversal":null,"status":"succeeded","transfer_reversal":null}
   *
   * @throws {Error} Throws an error if the refund creation fails.
   */
  async createRefund(refundData, requestOptions) {
    logger.debug('[createRefund] Payload', { refundData, requestOptions })

    assert(
      refundData?.charge || refundData?.payment_intent,
      'Refund property "charge" or "payment_intent" must be provided.'
    )

    this.#initApiClient()

    return this.stripe.refunds.create(refundData, requestOptions)
  }

  /**
   * @description Updates the specified refund by setting the values of the parameters passed.
   *
   * @route PUT /refunds/item
   * @operationName Update Refund
   * @category Money Movement
   * @appearanceColor #635bff #5b84ff
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes read_write
   *
   * @paramDef {"type":"String","label":"Refund ID","name":"id","required":true,"description":"The ID of the refund to update."}
   * @paramDef {"type":"Object","label":"Update Data","name":"updateData","required":true,"description":"Details to update on the refund, such as `metadata`."}
   * @paramDef {"type":"Object","label":"Request Options","name":"requestOptions","description":"Request Options. Could be found in Stripe method documentation."}
   *
   * @returns {Promise.<Object>} A promise that resolves with the updated Refund object.
   * @sampleResult {"id":"re_1Nispe2eZvKYlo2Cd31jOCgZ","object":"refund","amount":1000,"balance_transaction":"txn_1Nispe2eZvKYlo2CYezqFhEx","charge":"ch_1NirD82eZvKYlo2CIvbtLWuY","created":1692942318,"currency":"usd","destination_details":{"card":{"reference":"123456789012","reference_status":"available","reference_type":"acquirer_reference_number","type":"refund"},"type":"card"},"metadata":{"order_id":"6735"},"payment_intent":"pi_1GszsK2eZvKYlo2CfhZyoZLp","reason":null,"receipt_number":null,"source_transfer_reversal":null,"status":"succeeded","transfer_reversal":null}
   *
   * @throws {Error} Throws an error if the refund update fails.
   */
  async updateRefund(id, updateData, requestOptions) {
    logger.debug('[updateRefund] Payload', { id, updateData, requestOptions })

    assert(id, 'Refund ID must be provided.')
    assert(isObject(updateData), 'Update data must be provided and must be an object.')

    this.#initApiClient()

    return this.stripe.refunds.update(id, updateData, requestOptions)
  }

  /**
   * @description Retrieves the details of a specific refund by its ID.
   *
   * @route POST /refunds/item/get
   * @operationName Retrieve Refund
   * @category Money Movement
   * @appearanceColor #635bff #5b84ff
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes read_only
   *
   * @paramDef {"type":"String","label":"Refund ID","name":"id","required":true,"description":"The ID of the refund to retrieve."}
   * @paramDef {"type":"Object","label":"Request Options","name":"requestOptions","description":"Request Options. Could be found in Stripe method documentation."}
   *
   * @returns {Promise.<Object>} A promise that resolves with the retrieved Refund object.
   * @sampleResult {"id":"re_1Nispe2eZvKYlo2Cd31jOCgZ","object":"refund","amount":1000,"balance_transaction":"txn_1Nispe2eZvKYlo2CYezqFhEx","charge":"ch_1NirD82eZvKYlo2CIvbtLWuY","created":1692942318,"currency":"usd","destination_details":{"card":{"reference":"123456789012","reference_status":"available","reference_type":"acquirer_reference_number","type":"refund"},"type":"card"},"metadata":{},"payment_intent":"pi_1GszsK2eZvKYlo2CfhZyoZLp","reason":null,"receipt_number":null,"source_transfer_reversal":null,"status":"succeeded","transfer_reversal":null}
   *
   * @throws {Error} Throws an error if the refund retrieval fails.
   */
  async retrieveRefund(id, requestOptions) {
    logger.debug('[retrieveRefund] Payload', { id, requestOptions })

    assert(id, 'Refund ID must be provided.')

    this.#initApiClient()

    return this.stripe.refunds.retrieve(id, requestOptions)
  }

  /**
   * @description Lists all refunds, with optional filters such as `charge`, `payment_intent`, or `limit`.
   *
   * @route POST /refunds/get
   * @operationName Get Refunds List
   * @category Money Movement
   * @appearanceColor #635bff #5b84ff
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes read_only
   *
   * @paramDef {"type":"Object","label":"Options","name":"options","description":"Options to filter the list of refunds, such as `charge`, `payment_intent`, or `limit`."}
   * @paramDef {"type":"Object","label":"Request Options","name":"requestOptions","description":"Request Options. Could be found in Stripe method documentation."}
   *
   * @returns {Promise.<Object>} A promise that resolves with a list of Refund objects.
   * @sampleResult {"object":"list","url":"/v1/refunds","has_more":false,"data":[{"id":"re_1Nispe2eZvKYlo2Cd31jOCgZ","object":"refund","amount":1000,"balance_transaction":"txn_1Nispe2eZvKYlo2CYezqFhEx","charge":"ch_1NirD82eZvKYlo2CIvbtLWuY","created":1692942318,"currency":"usd","destination_details":{"card":{"reference":"123456789012","reference_status":"available","reference_type":"acquirer_reference_number","type":"refund"},"type":"card"},"metadata":{},"payment_intent":"pi_1GszsK2eZvKYlo2CfhZyoZLp","reason":null,"receipt_number":null,"source_transfer_reversal":null,"status":"succeeded","transfer_reversal":null}]}
   *
   * @throws {Error} Throws an error if the refund listing fails.
   */
  async getRefundsList(options, requestOptions) {
    logger.debug('[getRefundsList] Payload', { options, requestOptions })

    this.#initApiClient()

    return this.stripe.refunds.list(options, requestOptions)
  }

  /**
   * @description Cancels a refund if it has not yet been submitted to the bank or card network.
   *
   * @route POST /refunds/item/cancel
   * @operationName Cancel Refund
   * @category Money Movement
   * @appearanceColor #635bff #5b84ff
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes read_write
   *
   * @paramDef {"type":"String","label":"Refund ID","name":"id","required":true,"description":"The ID of the refund to cancel."}
   * @paramDef {"type":"Object","label":"Request Options","name":"requestOptions","description":"Request Options. Could be found in Stripe method documentation."}
   *
   * @returns {Promise.<Object>} A promise that resolves with the canceled Refund object.
   * @sampleResult {"id":"re_1Nispe2eZvKYlo2Cd31jOCgZ","object":"refund","amount":1000,"balance_transaction":"txn_1Nispe2eZvKYlo2CYezqFhEx","charge":"ch_1NirD82eZvKYlo2CIvbtLWuY","created":1692942318,"currency":"usd","failure_balance_transaction":"txn_3MmlLrLkdIwHu7ix0uke3Ezy","failure_reason":"merchant_request","metadata":{},"payment_intent":"pi_1GszsK2eZvKYlo2CfhZyoZLp","reason":null,"receipt_number":null,"source_transfer_reversal":null,"status":"canceled","transfer_reversal":null}
   *
   * @throws {Error} Throws an error if the refund cancellation fails.
   */
  async cancelRefund(id, requestOptions) {
    logger.debug('[cancelRefund] Payload', { id, requestOptions })

    assert(id, 'Refund ID must be provided.')

    this.#initApiClient()

    return this.stripe.refunds.cancel(id, requestOptions)
  }

  /**
   * @description Creates a new invoice for a customer.
   *
   * @route POST /invoices
   * @operationName Create Invoice
   * @category Invoicing
   * @appearanceColor #635bff #5b84ff
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes read_write
   *
   * @paramDef {"type":"Object","label":"Invoice Data","name":"invoiceData","required":true,"description":"Details about the invoice."}
   * @paramDef {"type":"Object","label":"Request Options","name":"requestOptions","description":"Request Options. Could be found in Stripe method documentation."}
   *
   * @returns {Promise.<Object>} A promise that resolves with the created Invoice object.
   * @sampleResult {"id":"in_1MtHbELkdIwHu7ixl4OzzPMv","object":"invoice","account_country":"US","account_name":"Stripe Docs","account_tax_ids":null,"amount_due":0,"amount_paid":0,"amount_remaining":0,"amount_shipping":0,"application":null,"application_fee_amount":null,"attempt_count":0,"attempted":false,"auto_advance":false,"automatic_tax":{"enabled":false,"liability":null,"status":null},"billing_reason":"manual","charge":null,"collection_method":"charge_automatically","created":1680644467,"currency":"usd","custom_fields":null,"customer":"cus_NeZwdNtLEOXuvB","customer_address":null,"customer_email":"jennyrosen@example.com","customer_name":"Jenny Rosen","customer_phone":null,"customer_shipping":null,"customer_tax_exempt":"none","customer_tax_ids":[],"default_payment_method":null,"default_source":null,"default_tax_rates":[],"description":null,"discount":null,"discounts":[],"due_date":null,"ending_balance":null,"footer":null,"from_invoice":null,"hosted_invoice_url":null,"invoice_pdf":null,"issuer":{"type":"self"},"last_finalization_error":null,"latest_revision":null,"lines":{"object":"list","data":[],"has_more":false,"total_count":0,"url":"/v1/invoices/in_1MtHbELkdIwHu7ixl4OzzPMv/lines"},"livemode":false,"metadata":{},"next_payment_attempt":null,"number":null,"on_behalf_of":null,"paid":false,"paid_out_of_band":false,"payment_intent":null,"payment_settings":{"default_mandate":null,"payment_method_options":null,"payment_method_types":null},"period_end":1680644467,"period_start":1680644467,"post_payment_credit_notes_amount":0,"pre_payment_credit_notes_amount":0,"quote":null,"receipt_number":null,"rendering_options":null,"shipping_cost":null,"shipping_details":null,"starting_balance":0,"statement_descriptor":null,"status":"draft","status_transitions":{"finalized_at":null,"marked_uncollectible_at":null,"paid_at":null,"voided_at":null},"subscription":null,"subtotal":0,"subtotal_excluding_tax":0,"tax":null,"test_clock":null,"total":0,"total_discount_amounts":[],"total_excluding_tax":0,"total_tax_amounts":[],"transfer_data":null,"webhooks_delivered_at":1680644467}
   *
   * @throws {Error} Throws an error if the invoice creation fails.
   */
  async createInvoice(invoiceData, requestOptions) {
    logger.debug('[createInvoice] Payload', { invoiceData, requestOptions })

    assert(invoiceData?.customer, 'Invoice property "customer" must be provided.')

    this.#initApiClient()

    return this.stripe.invoices.create(invoiceData, requestOptions)
  }

  /**
   * @description Updates an existing invoice by its ID.
   *
   * @route PUT /invoices/item
   * @operationName Update Invoice
   * @category Invoicing
   * @appearanceColor #635bff #5b84ff
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes read_write
   *
   * @paramDef {"type":"String","label":"Invoice ID","name":"id","required":true,"description":"The ID of the invoice to update."}
   * @paramDef {"type":"Object","label":"Update Data","name":"updateData","required":true,"description":"Details to update on the invoice, such as `metadata` or `invoice_settings`."}
   * @paramDef {"type":"Object","label":"Request Options","name":"requestOptions","description":"Request Options. Could be found in Stripe method documentation."}
   *
   * @returns {Promise.<Object>} A promise that resolves with the updated Invoice object.
   * @sampleResult {"id":"in_1MtHbELkdIwHu7ixl4OzzPMv","object":"invoice","account_country":"US","account_name":"Stripe Docs","account_tax_ids":null,"amount_due":0,"amount_paid":0,"amount_remaining":0,"amount_shipping":0,"application":null,"application_fee_amount":null,"attempt_count":0,"attempted":false,"auto_advance":false,"automatic_tax":{"enabled":false,"liability":null,"status":null},"billing_reason":"manual","charge":null,"collection_method":"charge_automatically","created":1680644467,"currency":"usd","custom_fields":null,"customer":"cus_NeZwdNtLEOXuvB","customer_address":null,"customer_email":"jennyrosen@example.com","customer_name":"Jenny Rosen","customer_phone":null,"customer_shipping":null,"customer_tax_exempt":"none","customer_tax_ids":[],"default_payment_method":null,"default_source":null,"default_tax_rates":[],"description":null,"discount":null,"discounts":[],"due_date":null,"ending_balance":null,"footer":null,"from_invoice":null,"hosted_invoice_url":null,"invoice_pdf":null,"issuer":{"type":"self"},"last_finalization_error":null,"latest_revision":null,"lines":{"object":"list","data":[],"has_more":false,"total_count":0,"url":"/v1/invoices/in_1MtHbELkdIwHu7ixl4OzzPMv/lines"},"livemode":false,"metadata":{"order_id":"6735"},"next_payment_attempt":null,"number":null,"on_behalf_of":null,"paid":false,"paid_out_of_band":false,"payment_intent":null,"payment_settings":{"default_mandate":null,"payment_method_options":null,"payment_method_types":null},"period_end":1680644467,"period_start":1680644467,"post_payment_credit_notes_amount":0,"pre_payment_credit_notes_amount":0,"quote":null,"receipt_number":null,"rendering_options":null,"shipping_cost":null,"shipping_details":null,"starting_balance":0,"statement_descriptor":null,"status":"draft","status_transitions":{"finalized_at":null,"marked_uncollectible_at":null,"paid_at":null,"voided_at":null},"subscription":null,"subtotal":0,"subtotal_excluding_tax":0,"tax":null,"test_clock":null,"total":0,"total_discount_amounts":[],"total_excluding_tax":0,"total_tax_amounts":[],"transfer_data":null,"webhooks_delivered_at":1680644467}
   *
   * @throws {Error} Throws an error if the invoice update fails.
   */
  async updateInvoice(id, updateData, requestOptions) {
    logger.debug('[updateInvoice] Payload', { id, updateData, requestOptions })
    assert(id, 'Invoice ID must be provided.')
    assert(isObject(updateData), 'Update data must be provided and must be an object.')

    this.#initApiClient()

    return this.stripe.invoices.update(id, updateData, requestOptions)
  }

  /**
   * @description Retrieves the details of a specific invoice by its ID.
   *
   * @route POST /invoices/item/get
   * @operationName Get Invoice
   * @category Invoicing
   * @appearanceColor #635bff #5b84ff
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes read_only
   *
   * @paramDef {"type":"String","label":"Invoice ID","name":"id","required":true,"description":"The ID of the invoice to retrieve."}
   * @paramDef {"type":"Object","label":"Request Options","name":"requestOptions","description":"Request Options. Could be found in Stripe method documentation."}
   *
   * @returns {Promise.<Object>} A promise that resolves with the retrieved Invoice object.
   * @sampleResult {"id":"in_1MtHbELkdIwHu7ixl4OzzPMv","object":"invoice","account_country":"US","account_name":"Stripe Docs","account_tax_ids":null,"amount_due":0,"amount_paid":0,"amount_remaining":0,"amount_shipping":0,"application":null,"application_fee_amount":null,"attempt_count":0,"attempted":false,"auto_advance":false,"automatic_tax":{"enabled":false,"liability":null,"status":null},"billing_reason":"manual","charge":null,"collection_method":"charge_automatically","created":1680644467,"currency":"usd","custom_fields":null,"customer":"cus_NeZwdNtLEOXuvB","customer_address":null,"customer_email":"jennyrosen@example.com","customer_name":"Jenny Rosen","customer_phone":null,"customer_shipping":null,"customer_tax_exempt":"none","customer_tax_ids":[],"default_payment_method":null,"default_source":null,"default_tax_rates":[],"description":null,"discount":null,"discounts":[],"due_date":null,"ending_balance":null,"footer":null,"from_invoice":null,"hosted_invoice_url":null,"invoice_pdf":null,"issuer":{"type":"self"},"last_finalization_error":null,"latest_revision":null,"lines":{"object":"list","data":[],"has_more":false,"total_count":0,"url":"/v1/invoices/in_1MtHbELkdIwHu7ixl4OzzPMv/lines"},"livemode":false,"metadata":{},"next_payment_attempt":null,"number":null,"on_behalf_of":null,"paid":false,"paid_out_of_band":false,"payment_intent":null,"payment_settings":{"default_mandate":null,"payment_method_options":null,"payment_method_types":null},"period_end":1680644467,"period_start":1680644467,"post_payment_credit_notes_amount":0,"pre_payment_credit_notes_amount":0,"quote":null,"receipt_number":null,"rendering_options":null,"shipping_cost":null,"shipping_details":null,"starting_balance":0,"statement_descriptor":null,"status":"draft","status_transitions":{"finalized_at":null,"marked_uncollectible_at":null,"paid_at":null,"voided_at":null},"subscription":null,"subtotal":0,"subtotal_excluding_tax":0,"tax":null,"test_clock":null,"total":0,"total_discount_amounts":[],"total_excluding_tax":0,"total_tax_amounts":[],"transfer_data":null,"webhooks_delivered_at":1680644467}
   *
   * @throws {Error} Throws an error if the invoice retrieval fails.
   */
  async getInvoice(id, requestOptions) {
    logger.debug('[getInvoice] Payload', { id, requestOptions })

    assert(id, 'Invoice ID must be provided.')

    this.#initApiClient()

    return this.stripe.invoices.retrieve(id, requestOptions)
  }

  /**
   * @description Lists all invoices, with optional filters such as `customer`, `limit`, or `starting_after`.
   *
   * @route POST /invoices/get
   * @operationName Get Invoices List
   * @category Invoicing
   * @appearanceColor #635bff #5b84ff
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes read_only
   *
   * @paramDef {"type":"Object","label":"Options","name":"options","description":"Options to filter the list of invoices, such as `customer` or `limit`."}
   * @paramDef {"type":"Object","label":"Request Options","name":"requestOptions","description":"Request Options. Could be found in Stripe method documentation."}
   *
   * @returns {Promise.<Object>} A promise that resolves with a list of Invoice objects.
   * @sampleResult {"object":"list","url":"/v1/invoices","has_more":false,"data":[{"id":"in_1MtHbELkdIwHu7ixl4OzzPMv","object":"invoice","account_country":"US","account_name":"Stripe Docs","account_tax_ids":null,"amount_due":0,"amount_paid":0,"amount_remaining":0,"amount_shipping":0,"application":null,"application_fee_amount":null,"attempt_count":0,"attempted":false,"auto_advance":false,"automatic_tax":{"enabled":false,"liability":null,"status":null},"billing_reason":"manual","charge":null,"collection_method":"charge_automatically","created":1680644467,"currency":"usd","custom_fields":null,"customer":"cus_NeZwdNtLEOXuvB","customer_address":null,"customer_email":"jennyrosen@example.com","customer_name":"Jenny Rosen","customer_phone":null,"customer_shipping":null,"customer_tax_exempt":"none","customer_tax_ids":[],"default_payment_method":null,"default_source":null,"default_tax_rates":[],"description":null,"discount":null,"discounts":[],"due_date":null,"ending_balance":null,"footer":null,"from_invoice":null,"hosted_invoice_url":null,"invoice_pdf":null,"issuer":{"type":"self"},"last_finalization_error":null,"latest_revision":null,"lines":{"object":"list","data":[],"has_more":false,"total_count":0,"url":"/v1/invoices/in_1MtHbELkdIwHu7ixl4OzzPMv/lines"},"livemode":false,"metadata":{},"next_payment_attempt":null,"number":null,"on_behalf_of":null,"paid":false,"paid_out_of_band":false,"payment_intent":null,"payment_settings":{"default_mandate":null,"payment_method_options":null,"payment_method_types":null},"period_end":1680644467,"period_start":1680644467,"post_payment_credit_notes_amount":0,"pre_payment_credit_notes_amount":0,"quote":null,"receipt_number":null,"rendering_options":null,"shipping_cost":null,"shipping_details":null,"starting_balance":0,"statement_descriptor":null,"status":"draft","status_transitions":{"finalized_at":null,"marked_uncollectible_at":null,"paid_at":null,"voided_at":null},"subscription":null,"subtotal":0,"subtotal_excluding_tax":0,"tax":null,"test_clock":null,"total":0,"total_discount_amounts":[],"total_excluding_tax":0,"total_tax_amounts":[],"transfer_data":null,"webhooks_delivered_at":1680644467}]}
   *
   * @throws {Error} Throws an error if the invoice listing fails.
   */
  async getInvoicesList(options, requestOptions) {
    logger.debug('[listInvoices] Payload', { options, requestOptions })

    this.#initApiClient()

    return this.stripe.invoices.list(options, requestOptions)
  }

  /**
   * @description Finalizes the invoice, which locks it for any further changes and attempts to charge the customer.
   *
   * @route POST /invoices/item/finalize
   * @operationName Finalize Invoice
   * @category Invoicing
   * @appearanceColor #635bff #5b84ff
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes read_write
   *
   * @paramDef {"type":"String","label":"Invoice ID","name":"id","required":true,"description":"The ID of the invoice to finalize."}
   * @paramDef {"type":"Object","label":"Request Options","name":"requestOptions","description":"Request Options. Could be found in Stripe method documentation."}
   *
   * @returns {Promise.<Object>} A promise that resolves with the finalized Invoice object.
   * @sampleResult {"id":"in_1MtGmCLkdIwHu7ix6PgS6g8S","object":"invoice","account_country":"US","account_name":"Stripe Docs","account_tax_ids":null,"amount_due":0,"amount_paid":0,"amount_remaining":0,"amount_shipping":0,"application":null,"application_fee_amount":null,"attempt_count":0,"attempted":true,"auto_advance":false,"automatic_tax":{"enabled":false,"liability":null,"status":null},"billing_reason":"manual","charge":null,"collection_method":"send_invoice","created":1680641304,"currency":"usd","custom_fields":null,"customer":"cus_NeZw0zvTyquTfF","customer_address":null,"customer_email":"jennyrosen@example.com","customer_name":"Jenny Rosen","customer_phone":null,"customer_shipping":null,"customer_tax_exempt":"none","customer_tax_ids":[],"default_payment_method":null,"default_source":null,"default_tax_rates":[],"description":null,"discount":null,"discounts":[],"due_date":1681246104,"ending_balance":0,"footer":null,"from_invoice":null,"hosted_invoice_url":"https://invoice.stripe.com/i/acct_1M2JTkLkdIwHu7ix/test_YWNjdF8xTTJKVGtMa2RJd0h1N2l4LF9OZVp3dVBYNnF0dGlvdXRubGVjSXVOOWhiVWpmUktPLDcxMTgyMTA10200x7P2wMSm?s=ap","invoice_pdf":"https://pay.stripe.com/invoice/acct_1M2JTkLkdIwHu7ix/test_YWNjdF8xTTJKVGtMa2RJd0h1N2l4LF9OZVp3dVBYNnF0dGlvdXRubGVjSXVOOWhiVWpmUktPLDcxMTgyMTA10200x7P2wMSm/pdf?s=ap","issuer":{"type":"self"},"last_finalization_error":null,"latest_revision":null,"lines":{"object":"list","data":[],"has_more":false,"total_count":0,"url":"/v1/invoices/in_1MtGmCLkdIwHu7ix6PgS6g8S/lines"},"livemode":false,"metadata":{},"next_payment_attempt":null,"number":"9545A614-0001","on_behalf_of":null,"paid":true,"paid_out_of_band":false,"payment_intent":null,"payment_settings":{"default_mandate":null,"payment_method_options":null,"payment_method_types":null},"period_end":1680641304,"period_start":1680641304,"post_payment_credit_notes_amount":0,"pre_payment_credit_notes_amount":0,"quote":null,"receipt_number":null,"rendering_options":null,"shipping_cost":null,"shipping_details":null,"starting_balance":0,"statement_descriptor":null,"status":"paid","status_transitions":{"finalized_at":1680641304,"marked_uncollectible_at":null,"paid_at":1680641304,"voided_at":null},"subscription":null,"subtotal":0,"subtotal_excluding_tax":0,"tax":null,"test_clock":null,"total":0,"total_discount_amounts":[],"total_excluding_tax":0,"total_tax_amounts":[],"transfer_data":null,"webhooks_delivered_at":1680641304}
   *
   * @throws {Error} Throws an error if the invoice finalization fails.
   */
  async finalizeInvoice(id, requestOptions) {
    logger.debug('[finalizeInvoice] Payload', { id, requestOptions })

    assert(id, 'Invoice ID must be provided.')

    this.#initApiClient()

    return this.stripe.invoices.finalizeInvoice(id, requestOptions)
  }

  /**
   * @description Sends the invoice.
   *
   * @route POST /invoices/item/send
   * @operationName Send Invoice
   * @category Invoicing
   * @appearanceColor #635bff #5b84ff
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes read_write
   *
   * @paramDef {"type":"String","label":"Invoice ID","name":"id","required":true,"description":"The ID of the invoice to send."}
   * @paramDef {"type":"Object","label":"Request Options","name":"requestOptions","description":"Request Options. Could be found in Stripe method documentation."}
   *
   * @returns {Promise.<Object>} A promise that resolves with the sent Invoice object.
   * @sampleResult {"id":"in_1MtGmCLkdIwHu7ixJlveR2DO","object":"invoice","account_country":"US","account_name":"Stripe Docs","account_tax_ids":null,"amount_due":0,"amount_paid":0,"amount_remaining":0,"amount_shipping":0,"application":null,"application_fee_amount":null,"attempt_count":0,"attempted":true,"auto_advance":false,"automatic_tax":{"enabled":false,"liability":null,"status":null},"billing_reason":"manual","charge":null,"collection_method":"send_invoice","created":1680641304,"currency":"usd","custom_fields":null,"customer":"cus_NeZwvqcz9Sh2uw","customer_address":null,"customer_email":"jennyrosen@example.com","customer_name":"Jenny Rosen","customer_phone":null,"customer_shipping":null,"customer_tax_exempt":"none","customer_tax_ids":[],"default_payment_method":null,"default_source":null,"default_tax_rates":[],"description":null,"discount":null,"discounts":[],"due_date":1681246104,"ending_balance":0,"footer":null,"from_invoice":null,"hosted_invoice_url":"https://invoice.stripe.com/i/acct_1M2JTkLkdIwHu7ix/test_YWNjdF8xTTJKVGtMa2RJd0h1N2l4LF9OZVp3SDR0Q1Q4U1N0YkVjY2lvSmRoRGppU3E1eGVJLDcxMTgyMTA10200hQIJrDM1?s=ap","invoice_pdf":"https://pay.stripe.com/invoice/acct_1M2JTkLkdIwHu7ix/test_YWNjdF8xTTJKVGtMa2RJd0h1N2l4LF9OZVp3SDR0Q1Q4U1N0YkVjY2lvSmRoRGppU3E1eGVJLDcxMTgyMTA10200hQIJrDM1/pdf?s=ap","issuer":{"type":"self"},"last_finalization_error":null,"latest_revision":null,"lines":{"object":"list","data":[],"has_more":false,"total_count":0,"url":"/v1/invoices/in_1MtGmCLkdIwHu7ixJlveR2DO/lines"},"livemode":false,"metadata":{},"next_payment_attempt":null,"number":"3AB9C0CA-0001","on_behalf_of":null,"paid":true,"paid_out_of_band":false,"payment_intent":null,"payment_settings":{"default_mandate":null,"payment_method_options":null,"payment_method_types":null},"period_end":1680641304,"period_start":1680641304,"post_payment_credit_notes_amount":0,"pre_payment_credit_notes_amount":0,"quote":null,"receipt_number":null,"rendering_options":null,"shipping_cost":null,"shipping_details":null,"starting_balance":0,"statement_descriptor":null,"status":"paid","status_transitions":{"finalized_at":1680641304,"marked_uncollectible_at":null,"paid_at":1680641304,"voided_at":null},"subscription":null,"subtotal":0,"subtotal_excluding_tax":0,"tax":null,"test_clock":null,"total":0,"total_discount_amounts":[],"total_excluding_tax":0,"total_tax_amounts":[],"transfer_data":null,"webhooks_delivered_at":1680641304}
   *
   * @throws {Error} Throws an error if the invoice sending fails.
   */
  async sendInvoice(id, requestOptions) {
    logger.debug('[sendInvoice] Payload', { id, requestOptions })

    assert(id, 'Invoice ID must be provided.')

    this.#initApiClient()

    return this.stripe.invoices.sendInvoice(id, requestOptions)
  }

  /**
   * @description Mark a finalized invoice as void. This cannot be undone. Voiding an invoice is similar to deletion, however it only applies to finalized invoices and maintains a papertrail where the invoice can still be found.
   *
   * @route POST /invoices/item/void
   * @operationName Void Invoice
   * @category Invoicing
   * @appearanceColor #635bff #5b84ff
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes read_write
   *
   * @paramDef {"type":"String","label":"Invoice ID","name":"id","required":true,"description":"The ID of the invoice to void."}
   * @paramDef {"type":"Object","label":"Request Options","name":"requestOptions","description":"Request Options. Could be found in Stripe method documentation."}
   *
   * @returns {Promise.<Object>} A promise that resolves with the voided Invoice object.
   * @sampleResult {"id":"in_1MtGmCLkdIwHu7ix6PgS6g8S","object":"invoice","account_country":"US","account_name":"Stripe Docs","account_tax_ids":null,"amount_due":0,"amount_paid":0,"amount_remaining":0,"amount_shipping":0,"application":null,"application_fee_amount":null,"attempt_count":0,"attempted":false,"auto_advance":false,"automatic_tax":{"enabled":false,"liability":null,"status":null},"billing_reason":"manual","charge":null,"collection_method":"charge_automatically","created":1680644467,"currency":"usd","custom_fields":null,"customer":"cus_NeZwdNtLEOXuvB","customer_address":null,"customer_email":"jennyrosen@example.com","customer_name":"Jenny Rosen","customer_phone":null,"customer_shipping":null,"customer_tax_exempt":"none","customer_tax_ids":[],"default_payment_method":null,"default_source":null,"default_tax_rates":[],"description":null,"discount":null,"discounts":[],"due_date":null,"ending_balance":null,"footer":null,"from_invoice":null,"hosted_invoice_url":null,"invoice_pdf":null,"issuer":{"type":"self"},"last_finalization_error":null,"latest_revision":null,"lines":{"object":"list","data":[],"has_more":false,"total_count":0,"url":"/v1/invoices/in_1MtGmCLkdIwHu7ix6PgS6g8S/lines"},"livemode":false,"metadata":{},"next_payment_attempt":null,"number":null,"on_behalf_of":null,"paid":false,"paid_out_of_band":false,"payment_intent":null,"payment_settings":{"default_mandate":null,"payment_method_options":null,"payment_method_types":null},"period_end":1680644467,"period_start":1680644467,"post_payment_credit_notes_amount":0,"pre_payment_credit_notes_amount":0,"quote":null,"receipt_number":null,"rendering_options":null,"shipping_cost":null,"shipping_details":null,"starting_balance":0,"statement_descriptor":null,"status":"void","status_transitions":{"finalized_at":null,"marked_uncollectible_at":null,"paid_at":null,"voided_at":null},"subscription":null,"subtotal":0,"subtotal_excluding_tax":0,"tax":null,"test_clock":null,"total":0,"total_discount_amounts":[],"total_excluding_tax":0,"total_tax_amounts":[],"transfer_data":null,"webhooks_delivered_at":1680644467}
   *
   * @throws {Error} Throws an error if the invoice voiding fails.
   */
  async voidInvoice(id, requestOptions) {
    logger.debug('[voidInvoice] Payload', { id, requestOptions })

    assert(id, 'Invoice ID must be provided.')

    this.#initApiClient()

    return this.stripe.invoices.voidInvoice(id, requestOptions)
  }

  /**
   * @description Marking an invoice as uncollectible is useful for keeping track of bad debts that can be written off for accounting purposes.
   *
   * @route POST /invoices/item/mark-uncollectible
   * @operationName Mark Invoice as Uncollectible
   * @category Invoicing
   * @appearanceColor #635bff #5b84ff
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes read_write
   *
   * @paramDef {"type":"String","label":"Invoice ID","name":"id","required":true,"description":"The ID of the invoice to mark as uncollectible."}
   * @paramDef {"type":"Object","label":"Request Options","name":"requestOptions","description":"Request Options. Could be found in Stripe method documentation."}
   *
   * @returns {Promise.<Object>} A promise that resolves with the Invoice object marked as uncollectible.
   * @sampleResult {"id":"in_1MtG0nLkdIwHu7ixAaUw3Cb4","object":"invoice","account_country":"US","account_name":"Stripe Docs","account_tax_ids":null,"amount_due":599,"amount_paid":0,"amount_remaining":599,"amount_shipping":0,"application":null,"application_fee_amount":null,"attempt_count":0,"attempted":false,"auto_advance":false,"automatic_tax":{"enabled":false,"liability":null,"status":null},"billing_reason":"manual","charge":null,"collection_method":"charge_automatically","created":1680638365,"currency":"usd","custom_fields":null,"customer":"cus_NeZw0zvTyquTfF","customer_address":null,"customer_email":"jennyrosen@example.com","customer_name":"Jenny Rosen","customer_phone":null,"customer_shipping":null,"customer_tax_exempt":"none","customer_tax_ids":[{"type":"eu_vat","value":"DE123456789"},{"type":"eu_vat","value":"DE123456781"}],"default_payment_method":null,"default_source":null,"default_tax_rates":[],"description":null,"discount":null,"discounts":[],"due_date":null,"ending_balance":null,"footer":null,"from_invoice":null,"hosted_invoice_url":null,"invoice_pdf":null,"issuer":{"type":"self"},"last_finalization_error":null,"latest_revision":null,"lines":{"object":"list","data":[{"id":"il_1MtG0nLkdIwHu7ix3eCoIIw7","object":"line_item","amount":1099,"amount_excluding_tax":1099,"currency":"usd","description":"My First Invoice Item (created for API docs)","discount_amounts":[],"discountable":true,"discounts":[],"invoice_item":"ii_1MtG0nLkdIwHu7ixDqfiUgg8","livemode":false,"metadata":{},"period":{"end":1680638365,"start":1680638365},"price":{"id":"price_1Mr89PLkdIwHu7ixf5QhiWm2","object":"price","active":true,"billing_scheme":"per_unit","created":1680131491,"currency":"usd","custom_unit_amount":null,"livemode":false,"lookup_key":null,"metadata":{},"nickname":null,"product":"prod_NcMtLgctyqlJDC","recurring":null,"tax_behavior":"unspecified","tiers_mode":null,"transform_quantity":null,"type":"one_time","unit_amount":1099,"unit_amount_decimal":"1099"},"proration":false,"proration_details":{"credited_items":null},"quantity":1,"subscription":null,"tax_amounts":[],"tax_rates":[],"type":"invoiceitem","unit_amount_excluding_tax":"1099"}],"has_more":false,"url":"/v1/invoices/in_1MtG0nLkdIwHu7ixAaUw3Cb4/lines"},"livemode":false,"metadata":{},"next_payment_attempt":null,"number":null,"on_behalf_of":null,"paid":false,"paid_out_of_band":false,"payment_intent":null,"payment_settings":{"default_mandate":null,"payment_method_options":null,"payment_method_types":null},"period_end":1680638365,"period_start":1680638365,"post_payment_credit_notes_amount":0,"pre_payment_credit_notes_amount":0,"quote":null,"receipt_number":null,"rendering_options":null,"shipping_cost":null,"shipping_details":null,"starting_balance":-500,"statement_descriptor":null,"status":"uncollectible","status_transitions":{"finalized_at":null,"marked_uncollectible_at":null,"paid_at":null,"voided_at":null},"subscription":null,"subtotal":1099,"subtotal_excluding_tax":1099,"tax":null,"test_clock":null,"total":1099,"total_discount_amounts":[],"total_excluding_tax":1099,"total_tax_amounts":[],"transfer_data":null,"webhooks_delivered_at":null,"closed":true,"forgiven":true}
   *
   * @throws {Error} Throws an error if the invoice marking as uncollectible fails.
   */
  async markInvoiceUncollectible(id, requestOptions) {
    logger.debug('[markInvoiceUncollectible] Payload', { id, requestOptions })

    assert(id, 'Invoice ID must be provided.')

    this.#initApiClient()

    return this.stripe.invoices.markUncollectible(id, requestOptions)
  }

  /**
   * @description Stripe automatically creates and then attempts to collect payment on invoices for customers on subscriptions according to your subscriptions settings. However, if you’d like to attempt payment on an invoice out of the normal collection schedule or for some other reason, you can do so.
   *
   * @route POST /invoices/item/pay
   * @operationName Pay Invoice
   * @category Invoicing
   * @appearanceColor #635bff #5b84ff
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes read_write
   *
   * @paramDef {"type":"String","label":"Invoice ID","name":"id","required":true,"description":"The ID of the invoice to pay."}
   * @paramDef {"type":"Object","label":"Payment Options","name":"paymentOptions","description":"Optional payment options."}
   * @paramDef {"type":"Object","label":"Request Options","name":"requestOptions","description":"Request Options. Could be found in Stripe method documentation."}
   *
   * @returns {Promise.<Object>} A promise that resolves with the paid Invoice object.
   * @sampleResult {"id":"in_1MtGmCLkdIwHu7ix6PgS6g8S","object":"invoice","account_country":"US","account_name":"Stripe Docs","account_tax_ids":null,"amount_due":0,"amount_paid":0,"amount_remaining":0,"amount_shipping":0,"application":null,"application_fee_amount":null,"attempt_count":0,"attempted":true,"auto_advance":false,"automatic_tax":{"enabled":false,"liability":null,"status":null},"billing_reason":"manual","charge":null,"collection_method":"send_invoice","created":1680641304,"currency":"usd","custom_fields":null,"customer":"cus_NeZw0zvTyquTfF","customer_address":null,"customer_email":"jennyrosen@example.com","customer_name":"Jenny Rosen","customer_phone":null,"customer_shipping":null,"customer_tax_exempt":"none","customer_tax_ids":[],"default_payment_method":null,"default_source":null,"default_tax_rates":[],"description":null,"discount":null,"discounts":[],"due_date":1681246104,"ending_balance":0,"footer":null,"from_invoice":null,"hosted_invoice_url":"https://invoice.stripe.com/i/acct_1M2JTkLkdIwHu7ix/test_YWNjdF8xTTJKVGtMa2RJd0h1N2l4LF9OZVp3dVBYNnF0dGlvdXRubGVjSXVOOWhiVWpmUktPLDcxMTgyMTA10200x7P2wMSm?s=ap","invoice_pdf":"https://pay.stripe.com/invoice/acct_1M2JTkLkdIwHu7ix/test_YWNjdF8xTTJKVGtMa2RJd0h1N2l4LF9OZVp3dVBYNnF0dGlvdXRubGVjSXVOOWhiVWpmUktPLDcxMTgyMTA10200x7P2wMSm/pdf?s=ap","issuer":{"type":"self"},"last_finalization_error":null,"latest_revision":null,"lines":{"object":"list","data":[],"has_more":false,"total_count":0,"url":"/v1/invoices/in_1MtGmCLkdIwHu7ix6PgS6g8S/lines"},"livemode":false,"metadata":{},"next_payment_attempt":null,"number":"9545A614-0001","on_behalf_of":null,"paid":true,"paid_out_of_band":false,"payment_intent":null,"payment_settings":{"default_mandate":null,"payment_method_options":null,"payment_method_types":null},"period_end":1680641304,"period_start":1680641304,"post_payment_credit_notes_amount":0,"pre_payment_credit_notes_amount":0,"quote":null,"receipt_number":null,"rendering_options":null,"shipping_cost":null,"shipping_details":null,"starting_balance":0,"statement_descriptor":null,"status":"paid","status_transitions":{"finalized_at":1680641304,"marked_uncollectible_at":null,"paid_at":1680641304,"voided_at":null},"subscription":null,"subtotal":0,"subtotal_excluding_tax":0,"tax":null,"test_clock":null,"total":0,"total_discount_amounts":[],"total_excluding_tax":0,"total_tax_amounts":[],"transfer_data":null,"webhooks_delivered_at":1680641304}
   *
   * @throws {Error} Throws an error if the invoice payment fails.
   */
  async payInvoice(id, paymentOptions, requestOptions) {
    logger.debug('[payInvoice] Payload', { id, paymentOptions, requestOptions })

    assert(id, 'Invoice ID must be provided.')

    this.#initApiClient()

    return this.stripe.invoices.pay(id, paymentOptions, requestOptions)
  }

  /**
   * @description Creates a new payout to your bank account or debit card.
   *
   * @route POST /payouts
   * @operationName Create Payout
   * @category Money Movement
   * @appearanceColor #635bff #5b84ff
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes read_write
   *
   * @paramDef {"type":"Object","label":"Payout Data","name":"payoutData","required":true,"description":"Details about the payout (`amount` and `currency` are required)."}
   * @paramDef {"type":"Object","label":"Request Options","name":"requestOptions","description":"Request Options. Could be found in Stripe method documentation."}
   *
   * @returns {Promise.<Object>} A promise that resolves with the created Payout object.
   * @sampleResult {"id":"po_1OaFDbEcg9tTZuTgNYmX0PKB","object":"payout","amount":1100,"arrival_date":1680652800,"automatic":false,"balance_transaction":"txn_1OaFDcEcg9tTZuTgYMR25tSe","created":1680648691,"currency":"usd","description":null,"destination":"ba_1MtIhL2eZvKYlo2CAElKwKu2","failure_balance_transaction":null,"failure_code":null,"failure_message":null,"livemode":false,"metadata":{},"method":"standard","original_payout":null,"reconciliation_status":"not_applicable","reversed_by":null,"source_type":"card","statement_descriptor":null,"status":"pending","type":"bank_account"}
   *
   * @throws {Error} Throws an error if the payout creation fails.
   */
  async createPayout(payoutData, requestOptions) {
    logger.debug('[createPayout] Payload', { payoutData, requestOptions })

    assert(payoutData?.amount, 'Payout property "amount" must be provided.')
    assert(payoutData?.currency, 'Payout property "currency" must be provided.')

    this.#initApiClient()

    return this.stripe.payouts.create(payoutData, requestOptions)
  }

  /**
   * @description Updates the specified payout by setting the values of the parameters passed.
   *
   * @route PUT /payouts/item
   * @operationName Update Payout
   * @category Money Movement
   * @appearanceColor #635bff #5b84ff
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes read_write
   *
   * @paramDef {"type":"String","label":"Payout ID","name":"id","required":true,"description":"The ID of the payout to update."}
   * @paramDef {"type":"Object","label":"Update Data","name":"updateData","required":true,"description":"Details to update on the payout, such as `metadata` or `description`."}
   * @paramDef {"type":"Object","label":"Request Options","name":"requestOptions","description":"Request Options. Could be found in Stripe method documentation."}
   *
   * @returns {Promise.<Object>} A promise that resolves with the updated Payout object.
   * @sampleResult {"id":"po_1OaFDbEcg9tTZuTgNYmX0PKB","object":"payout","amount":1100,"arrival_date":1680652800,"automatic":false,"balance_transaction":"txn_1OaFDcEcg9tTZuTgYMR25tSe","created":1680648691,"currency":"usd","description":null,"destination":"ba_1MtIhL2eZvKYlo2CAElKwKu2","failure_balance_transaction":null,"failure_code":null,"failure_message":null,"livemode":false,"metadata":{"order_id":"6735"},"method":"standard","original_payout":null,"reconciliation_status":"not_applicable","reversed_by":null,"source_type":"card","statement_descriptor":null,"status":"pending","type":"bank_account"}
   *
   * @throws {Error} Throws an error if the payout update fails.
   */
  async updatePayout(id, updateData, requestOptions) {
    logger.debug('[updatePayout] Payload', { id, updateData, requestOptions })

    assert(id, 'Payout ID must be provided.')
    assert(isObject(updateData), 'Update data must be provided and must be an object.')

    this.#initApiClient()

    return this.stripe.payouts.update(id, updateData, requestOptions)
  }

  /**
   * @description Retrieves the details of a specific payout by its ID.
   *
   * @route POST /payouts/item/get
   * @operationName Get Payout
   * @category Money Movement
   * @appearanceColor #635bff #5b84ff
   * @appearanceColor #635bff #5b84ff
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes read_only
   *
   * @paramDef {"type":"String","label":"Payout ID","name":"id","required":true,"description":"The ID of the payout to retrieve."}
   * @paramDef {"type":"Object","label":"Request Options","name":"requestOptions","description":"Request Options. Could be found in Stripe method documentation."}
   *
   * @returns {Promise.<Object>} A promise that resolves with the retrieved Payout object.
   * @sampleResult {"id":"po_1OaFDbEcg9tTZuTgNYmX0PKB","object":"payout","amount":1100,"arrival_date":1680652800,"automatic":false,"balance_transaction":"txn_1OaFDcEcg9tTZuTgYMR25tSe","created":1680648691,"currency":"usd","description":null,"destination":"ba_1MtIhL2eZvKYlo2CAElKwKu2","failure_balance_transaction":null,"failure_code":null,"failure_message":null,"livemode":false,"metadata":{},"method":"standard","original_payout":null,"reconciliation_status":"not_applicable","reversed_by":null,"source_type":"card","statement_descriptor":null,"status":"pending","type":"bank_account"}
   *
   * @throws {Error} Throws an error if the payout retrieval fails.
   */
  async getPayout(id, requestOptions) {
    logger.debug('[getPayout] Payload', { id, requestOptions })

    assert(id, 'Payout ID must be provided.')

    this.#initApiClient()

    return this.stripe.payouts.retrieve(id, requestOptions)
  }

  /**
   * @description Lists all payouts, with optional filters such as `created`, `destination`, or `status`.
   *
   * @route POST /payouts/get
   * @operationName Get Payouts List
   * @category Money Movement
   * @appearanceColor #635bff #5b84ff
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes read_only
   *
   * @paramDef {"type":"Object","label":"Options","name":"options","description":"Options to filter the list of payouts, such as `limit` or `starting_after`."}
   * @paramDef {"type":"Object","label":"Request Options","name":"requestOptions","description":"Request Options. Could be found in Stripe method documentation."}
   *
   * @returns {Promise.<Object>} A promise that resolves with a list of Payout objects.
   * @sampleResult {"object":"list","url":"/v1/payouts","has_more":false,"data":[{"id":"po_1OaFDbEcg9tTZuTgNYmX0PKB","object":"payout","amount":1100,"arrival_date":1680652800,"automatic":false,"balance_transaction":"txn_1OaFDcEcg9tTZuTgYMR25tSe","created":1680648691,"currency":"usd","description":null,"destination":"ba_1MtIhL2eZvKYlo2CAElKwKu2","failure_balance_transaction":null,"failure_code":null,"failure_message":null,"livemode":false,"metadata":{},"method":"standard","original_payout":null,"reconciliation_status":"not_applicable","reversed_by":null,"source_type":"card","statement_descriptor":null,"status":"pending","type":"bank_account"}]}
   *
   * @throws {Error} Throws an error if the payout listing fails.
   */
  async getPayoutsList(options, requestOptions) {
    logger.debug('[getPayoutsList] Payload', { options, requestOptions })

    this.#initApiClient()

    return this.stripe.payouts.list(options, requestOptions)
  }

  /**
   * @description You can cancel a previously created payout if its status is pending. Stripe refunds the funds to your available balance. You can’t cancel automatic Stripe payouts.
   *
   * @route POST /payouts/item/cancel
   * @operationName Cancel Payout
   * @category Money Movement
   * @appearanceColor #635bff #5b84ff
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes read_write
   *
   * @paramDef {"type":"String","label":"Payout ID","name":"id","required":true,"description":"The ID of the payout to cancel."}
   * @paramDef {"type":"Object","label":"Request Options","name":"requestOptions","description":"Request Options. Could be found in Stripe method documentation."}
   *
   * @returns {Promise.<Object>} A promise that resolves with the canceled Payout object.
   * @sampleResult {"id":"po_1OaFDbEcg9tTZuTgNYmX0PKB","object":"payout","amount":1100,"arrival_date":1680652800,"automatic":false,"balance_transaction":"txn_1OaFDcEcg9tTZuTgYMR25tSe","created":1680648691,"currency":"usd","description":null,"destination":"ba_1MtIhL2eZvKYlo2CAElKwKu2","failure_balance_transaction":"txn_1OaFJKEcg9tTZuTg2RdsWQhi","failure_code":null,"failure_message":null,"livemode":false,"metadata":{},"method":"standard","original_payout":null,"reconciliation_status":"not_applicable","reversed_by":null,"source_type":"card","statement_descriptor":null,"status":"canceled","type":"bank_account"}
   *
   * @throws {Error} Throws an error if the payout cancellation fails.
   */
  async cancelPayout(id, requestOptions) {
    logger.debug('[cancelPayout] Payload', { id, requestOptions })

    assert(id, 'Payout ID must be provided.')

    this.#initApiClient()

    return this.stripe.payouts.cancel(id, requestOptions)
  }

  /**
   * @description Creates a new Checkout Session object, allowing customers to make a payment through Stripe's hosted checkout page.
   *
   * @route POST /checkout/sessions
   * @operationName Create Checkout Session
   * @category Checkout Sessions
   * @appearanceColor #635bff #5b84ff
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes read_write
   *
   * @paramDef {"type":"Object","label":"Session Data","name":"sessionData","required":true,"description":"Details about the checkout session, such as `line_items` and `payment_method_types`."}
   * @paramDef {"type":"Object","label":"Request Options","name":"requestOptions","description":"Request Options. Could be found in Stripe method documentation."}
   *
   * @returns {Promise.<Object>} A promise that resolves with the created Checkout Session object.
   * @sampleResult {"id":"cs_test_a11YYufWQzNY63zpQ6QSNRQhkUpVph4WRmzW0zWJO2znZKdVujZ0N0S22u","object":"checkout.session","after_expiration":null,"allow_promotion_codes":null,"amount_subtotal":2198,"amount_total":2198,"automatic_tax":{"enabled":false,"liability":null,"status":null},"billing_address_collection":null,"cancel_url":null,"client_reference_id":null,"consent":null,"consent_collection":null,"created":1679600215,"currency":"usd","custom_fields":[],"custom_text":{"shipping_address":null,"submit":null},"customer":null,"customer_creation":"if_required","customer_details":null,"customer_email":null,"expires_at":1679686615,"invoice":null,"invoice_creation":{"enabled":false,"invoice_data":{"account_tax_ids":null,"custom_fields":null,"description":null,"footer":null,"issuer":null,"metadata":{},"rendering_options":null}},"livemode":false,"locale":null,"metadata":{},"mode":"payment","payment_intent":null,"payment_link":null,"payment_method_collection":"always","payment_method_options":{},"payment_method_types":["card"],"payment_status":"unpaid","phone_number_collection":{"enabled":false},"recovered_from":null,"setup_intent":null,"shipping_address_collection":null,"shipping_cost":null,"shipping_details":null,"shipping_options":[],"status":"open","submit_type":null,"subscription":null,"success_url":"https://example.com/success","total_details":{"amount_discount":0,"amount_shipping":0,"amount_tax":0},"url":"https://checkout.stripe.com/c/pay/cs_test_a11YYufWQzNY63zpQ6QSNRQhkUpVph4WRmzW0zWJO2znZKdVujZ0N0S22u#fidkdWxOYHwnPyd1blpxYHZxWjA0SDdPUW5JbmFMck1wMmx9N2BLZjFEfGRUNWhqTmJ%2FM2F8bUA2SDRySkFdUV81T1BSV0YxcWJcTUJcYW5rSzN3dzBLPUE0TzRKTTxzNFBjPWZEX1NKSkxpNTVjRjN8VHE0YicpJ2N3amhWYHdzYHcnP3F3cGApJ2lkfGpwcVF8dWAnPyd2bGtiaWBabHFgaCcpJ2BrZGdpYFVpZGZgbWppYWB3dic%2FcXdwYHgl"}
   *
   * @throws {Error} Throws an error if the session creation fails.
   */
  async createCheckoutSession(sessionData, requestOptions) {
    logger.debug('[createCheckoutSession] Payload', { sessionData, requestOptions })

    assert(isObject(sessionData), 'Session data must be provided and must be an object.')

    this.#initApiClient()

    return this.stripe.checkout.sessions.create(sessionData)
  }

  /**
   * @description Retrieves an existing Checkout Session by its ID.
   *
   * @route POST /checkout/sessions/item/get
   * @operationName Get Checkout Session
   * @category Checkout Sessions
   * @appearanceColor #635bff #5b84ff
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes read_only
   *
   * @paramDef {"type":"String","label":"Session ID","name":"id","required":true,"description":"The ID of the Checkout Session to retrieve."}
   * @paramDef {"type":"Object","label":"Request Options","name":"requestOptions","description":"Request Options. Could be found in Stripe method documentation."}
   *
   * @returns {Promise.<Object>} A promise that resolves with the retrieved Checkout Session object.
   * @sampleResult {"id":"cs_test_a11YYufWQzNY63zpQ6QSNRQhkUpVph4WRmzW0zWJO2znZKdVujZ0N0S22u","object":"checkout.session","after_expiration":null,"allow_promotion_codes":null,"amount_subtotal":2198,"amount_total":2198,"automatic_tax":{"enabled":false,"liability":null,"status":null},"billing_address_collection":null,"cancel_url":null,"client_reference_id":null,"consent":null,"consent_collection":null,"created":1679600215,"currency":"usd","custom_fields":[],"custom_text":{"shipping_address":null,"submit":null},"customer":null,"customer_creation":"if_required","customer_details":null,"customer_email":null,"expires_at":1679686615,"invoice":null,"invoice_creation":{"enabled":false,"invoice_data":{"account_tax_ids":null,"custom_fields":null,"description":null,"footer":null,"issuer":null,"metadata":{},"rendering_options":null}},"livemode":false,"locale":null,"metadata":{},"mode":"payment","payment_intent":null,"payment_link":null,"payment_method_collection":"always","payment_method_options":{},"payment_method_types":["card"],"payment_status":"unpaid","phone_number_collection":{"enabled":false},"recovered_from":null,"setup_intent":null,"shipping_address_collection":null,"shipping_cost":null,"shipping_details":null,"shipping_options":[],"status":"open","submit_type":null,"subscription":null,"success_url":"https://example.com/success","total_details":{"amount_discount":0,"amount_shipping":0,"amount_tax":0},"url":"https://checkout.stripe.com/c/pay/cs_test_a11YYufWQzNY63zpQ6QSNRQhkUpVph4WRmzW0zWJO2znZKdVujZ0N0S22u#fidkdWxOYHwnPyd1blpxYHZxWjA0SDdPUW5JbmFMck1wMmx9N2BLZjFEfGRUNWhqTmJ%2FM2F8bUA2SDRySkFdUV81T1BSV0YxcWJcTUJcYW5rSzN3dzBLPUE0TzRKTTxzNFBjPWZEX1NKSkxpNTVjRjN8VHE0YicpJ2N3amhWYHdzYHcnP3F3cGApJ2lkfGpwcVF8dWAnPyd2bGtiaWBabHFgaCcpJ2BrZGdpYFVpZGZgbWppYWB3dic%2FcXdwYHgl"}
   *
   * @throws {Error} Throws an error if the session retrieval fails.
   */
  async getCheckoutSession(id, requestOptions) {
    logger.debug('[getCheckoutSession] Payload', { id, requestOptions })

    assert(id, 'Session ID must be provided.')

    this.#initApiClient()

    return this.stripe.checkout.sessions.retrieve(id)
  }

  /**
   * @description Lists all Checkout Sessions, with optional filters such as `customer` or `limit`.
   *
   * @route POST /checkout/sessions/get
   * @operationName Get Checkout Sessions List
   * @category Checkout Sessions
   * @appearanceColor #635bff #5b84ff
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes read_only
   *
   * @paramDef {"type":"Object","label":"Options","name":"options","description":"Options to filter the list of sessions, such as `customer` and `limit`."}
   * @paramDef {"type":"Object","label":"Request Options","name":"requestOptions","description":"Request Options. Could be found in Stripe method documentation."}
   *
   * @returns {Promise.<Object>} A promise that resolves with a list of Checkout Session objects.
   * @sampleResult {"object":"list","url":"/v1/checkout/sessions","has_more":false,"data":[{"id":"cs_test_a11YYufWQzNY63zpQ6QSNRQhkUpVph4WRmzW0zWJO2znZKdVujZ0N0S22u","object":"checkout.session","after_expiration":null,"allow_promotion_codes":null,"amount_subtotal":2198,"amount_total":2198,"automatic_tax":{"enabled":false,"liability":null,"status":null},"billing_address_collection":null,"cancel_url":null,"client_reference_id":null,"consent":null,"consent_collection":null,"created":1679600215,"currency":"usd","custom_fields":[],"custom_text":{"shipping_address":null,"submit":null},"customer":null,"customer_creation":"if_required","customer_details":null,"customer_email":null,"expires_at":1679686615,"invoice":null,"invoice_creation":{"enabled":false,"invoice_data":{"account_tax_ids":null,"custom_fields":null,"description":null,"footer":null,"issuer":null,"metadata":{},"rendering_options":null}},"livemode":false,"locale":null,"metadata":{},"mode":"payment","payment_intent":null,"payment_link":null,"payment_method_collection":"always","payment_method_options":{},"payment_method_types":["card"],"payment_status":"unpaid","phone_number_collection":{"enabled":false},"recovered_from":null,"setup_intent":null,"shipping_address_collection":null,"shipping_cost":null,"shipping_details":null,"shipping_options":[],"status":"open","submit_type":null,"subscription":null,"success_url":"https://example.com/success","total_details":{"amount_discount":0,"amount_shipping":0,"amount_tax":0},"url":"https://checkout.stripe.com/c/pay/cs_test_a11YYufWQzNY63zpQ6QSNRQhkUpVph4WRmzW0zWJO2znZKdVujZ0N0S22u#fidkdWxOYHwnPyd1blpxYHZxWjA0SDdPUW5JbmFMck1wMmx9N2BLZjFEfGRUNWhqTmJ%2FM2F8bUA2SDRySkFdUV81T1BSV0YxcWJcTUJcYW5rSzN3dzBLPUE0TzRKTTxzNFBjPWZEX1NKSkxpNTVjRjN8VHE0YicpJ2N3amhWYHdzYHcnP3F3cGApJ2lkfGpwcVF8dWAnPyd2bGtiaWBabHFgaCcpJ2BrZGdpYFVpZGZgbWppYWB3dic%2FcXdwYHgl"}]}
   *
   * @throws {Error} Throws an error if the session listing fails.
   */
  async getCheckoutSessionsList(options, requestOptions) {
    logger.debug('[getCheckoutSessionsList] Payload', { options, requestOptions })

    this.#initApiClient()

    return this.stripe.checkout.sessions.list(options)
  }

  /**
   * @description Updates a Checkout Session, allowing modifications to certain properties such as `metadata` and `payment_method_options`.
   *
   * @route PUT /checkout/sessions/item
   * @operationName Update Checkout Session
   * @category Checkout Sessions
   * @appearanceColor #635bff #5b84ff
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes read_write
   *
   * @paramDef {"type":"String","label":"Session ID","name":"id","required":true,"description":"The ID of the Checkout Session to update."}
   * @paramDef {"type":"Object","label":"Update Data","name":"updateData","required":true,"description":"Details to update on the Checkout Session, such as `metadata` or `payment_method_options`."}
   * @paramDef {"type":"Object","label":"Request Options","name":"requestOptions","description":"Request Options. Could be found in Stripe method documentation."}
   *
   * @returns {Promise.<Object>} A promise that resolves with the updated Checkout Session object.
   * @sampleResult {"id":"cs_test_a11YYufWQzNY63zpQ6QSNRQhkUpVph4WRmzW0zWJO2znZKdVujZ0N0S22u","object":"checkout.session","after_expiration":null,"allow_promotion_codes":null,"amount_subtotal":2198,"amount_total":2198,"automatic_tax":{"enabled":false,"liability":null,"status":null},"billing_address_collection":null,"cancel_url":null,"client_reference_id":null,"consent":null,"consent_collection":null,"created":1679600215,"currency":"usd","custom_fields":[],"custom_text":{"shipping_address":null,"submit":null},"customer":null,"customer_creation":"if_required","customer_details":null,"customer_email":null,"expires_at":1679686615,"invoice":null,"invoice_creation":{"enabled":false,"invoice_data":{"account_tax_ids":null,"custom_fields":null,"description":null,"footer":null,"issuer":null,"metadata":{},"rendering_options":null}},"livemode":false,"locale":null,"metadata":{"order_id":"6735"},"mode":"payment","payment_intent":null,"payment_link":null,"payment_method_collection":"always","payment_method_options":{},"payment_method_types":["card"],"payment_status":"unpaid","phone_number_collection":{"enabled":false},"recovered_from":null,"setup_intent":null,"shipping_address_collection":null,"shipping_cost":null,"shipping_details":null,"shipping_options":[],"status":"open","submit_type":null,"subscription":null,"success_url":"https://example.com/success","total_details":{"amount_discount":0,"amount_shipping":0,"amount_tax":0},"url":"https://checkout.stripe.com/c/pay/cs_test_a11YYufWQzNY63zpQ6QSNRQhkUpVph4WRmzW0zWJO2znZKdVujZ0N0S22u#fidkdWxOYHwnPyd1blpxYHZxWjA0SDdPUW5JbmFMck1wMmx9N2BLZjFEfGRUNWhqTmJ%2FM2F8bUA2SDRySkFdUV81T1BSV0YxcWJcTUJcYW5rSzN3dzBLPUE0TzRKTTxzNFBjPWZEX1NKSkxpNTVjRjN8VHE0YicpJ2N3amhWYHdzYHcnP3F3cGApJ2lkfGpwcVF8dWAnPyd2bGtiaWBabHFgaCcpJ2BrZGdpYFVpZGZgbWppYWB3dic%2FcXdwYHgl"}
   *
   * @throws {Error} Throws an error if the session update fails.
   */
  async updateCheckoutSession(id, updateData, requestOptions) {
    logger.debug('[updateCheckoutSession] Payload', { id, updateData, requestOptions })

    assert(id, 'Session ID must be provided.')
    assert(isObject(updateData), 'Update data must be provided and must be an object.')

    this.#initApiClient()

    return this.stripe.checkout.sessions.update(id, updateData)
  }

  /**
   * @description Expires a Checkout Session, preventing any further interactions or payments.
   *
   * @route POST /checkout/sessions/item/expire
   * @operationName Expire Checkout Session
   * @category Checkout Sessions
   * @appearanceColor #635bff #5b84ff
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes read_write
   *
   * @paramDef {"type":"String","label":"Session ID","name":"id","required":true,"description":"The ID of the Checkout Session to expire."}
   * @paramDef {"type":"Object","label":"Request Options","name":"requestOptions","description":"Request Options. Could be found in Stripe method documentation."}
   *
   * @returns {Promise.<Object>} A promise that resolves with the expired Checkout Session object.
   * @sampleResult {"id":"cs_test_a1Ae6ClgOkjygKwrf9B3L6ITtUuZW4Xx9FivL6DZYoYFdfAefQxsYpJJd3","object":"checkout.session","after_expiration":null,"allow_promotion_codes":null,"amount_subtotal":2198,"amount_total":2198,"automatic_tax":{"enabled":false,"status":null},"billing_address_collection":null,"cancel_url":null,"client_reference_id":null,"consent":null,"consent_collection":null,"created":1679434412,"currency":"usd","custom_fields":[],"custom_text":{"shipping_address":null,"submit":null},"customer":null,"customer_creation":"if_required","customer_details":null,"customer_email":null,"expires_at":1679520812,"invoice":null,"invoice_creation":{"enabled":false,"invoice_data":{"account_tax_ids":null,"custom_fields":null,"description":null,"footer":null,"metadata":{},"rendering_options":null}},"livemode":false,"locale":null,"metadata":{},"mode":"payment","payment_intent":null,"payment_link":null,"payment_method_collection":"always","payment_method_options":{},"payment_method_types":["card"],"payment_status":"unpaid","phone_number_collection":{"enabled":false},"recovered_from":null,"setup_intent":null,"shipping_address_collection":null,"shipping_cost":null,"shipping_details":null,"shipping_options":[],"status":"expired","submit_type":null,"subscription":null,"success_url":"https://example.com/success","total_details":{"amount_discount":0,"amount_shipping":0,"amount_tax":0},"url":null}
   *
   * @throws {Error} Throws an error if the session expiration fails.
   */
  async expireCheckoutSession(id, requestOptions) {
    logger.debug('[expireCheckoutSession] Payload', { id, requestOptions })

    assert(id, 'Session ID must be provided.')

    this.#initApiClient()

    return this.stripe.checkout.sessions.expire(id)
  }

  /**
   * @description Creates a new Webhook Endpoint object to receive events from Stripe.
   *
   * @route POST /webhook_endpoints
   * @operationName Create Webhook Endpoint
   * @category Developer Tools
   * @appearanceColor #635bff #5b84ff
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes read_write
   *
   * @paramDef {"type":"Object","label":"Webhook Data","name":"webhookData","required":true,"description":"Details for creating the webhook, including `url` and `enabled_events`."}
   * @paramDef {"type":"Object","label":"Request Options","name":"requestOptions","description":"Request Options. Could be found in Stripe method documentation."}
   *
   * @returns {Promise.<Object>} A promise that resolves with the created Webhook Endpoint object.
   * @sampleResult {"id":"we_1Mr5jULkdIwHu7ix1ibLTM0x","object":"webhook_endpoint","api_version":null,"application":null,"created":1680122196,"description":null,"enabled_events":["charge.succeeded","charge.failed"],"livemode":false,"metadata":{},"secret":"whsec_wRNftLajMZNeslQOP6vEPm4iVx5NlZ6z","status":"enabled","url":"https://example.com/my/webhook/endpoint"}
   *
   * @throws {Error} Throws an error if the webhook endpoint creation fails.
   */
  async createWebhookEndpoint(webhookData, requestOptions) {
    logger.debug('[createWebhookEndpoint] Payload', { webhookData, requestOptions })

    assert(webhookData?.url, 'Webhook property "url" must be provided.')
    assert(Array.isArray(webhookData?.enabled_events), 'Webhook property "enabled_events" must be an array.')

    this.#initSafeApiClient()

    return this.stripe.webhookEndpoints.create(webhookData, requestOptions)
  }

  /**
   * @description Retrieves the details of a specific Webhook Endpoint by its ID.
   *
   * @route POST /webhook-endpoints/item/get
   * @operationName Get Webhook Endpoint
   * @category Developer Tools
   * @appearanceColor #635bff #5b84ff
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes read_only
   *
   * @paramDef {"type":"String","label":"Webhook ID","name":"id","required":true,"description":"The ID of the Webhook Endpoint to retrieve."}
   * @paramDef {"type":"Object","label":"Request Options","name":"requestOptions","description":"Request Options. Could be found in Stripe method documentation."}
   *
   * @returns {Promise.<Object>} A promise that resolves with the retrieved Webhook Endpoint object.
   * @sampleResult {"id":"we_1Mr5jULkdIwHu7ix1ibLTM0x","object":"webhook_endpoint","api_version":null,"application":null,"created":1680122196,"description":null,"enabled_events":["charge.succeeded","charge.failed"],"livemode":false,"metadata":{},"status":"enabled","url":"https://example.com/my/webhook/endpoint"}
   *
   * @throws {Error} Throws an error if the webhook endpoint retrieval fails.
   */
  async getWebhookEndpoint(id, requestOptions) {
    logger.debug('[getWebhookEndpoint] Payload', { id, requestOptions })

    assert(id, 'Webhook ID must be provided.')

    this.#initSafeApiClient()

    return this.stripe.webhookEndpoints.retrieve(id, requestOptions)
  }

  /**
   * @description Updates an existing Webhook Endpoint, including changes to its `url` or `enabled_events`.
   *
   * @route PUT /webhook_endpoints/item
   * @operationName Update Webhook Endpoint
   * @category Developer Tools
   * @appearanceColor #635bff #5b84ff
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes read_write
   *
   * @paramDef {"type":"String","label":"Webhook ID","name":"id","required":true,"description":"The ID of the Webhook Endpoint to update."}
   * @paramDef {"type":"Object","label":"Update Data","name":"updateData","required":true,"description":"Details to update on the Webhook Endpoint, such as `url` or `enabled_events`."}
   * @paramDef {"type":"Object","label":"Request Options","name":"requestOptions","description":"Request Options. Could be found in Stripe method documentation."}
   *
   * @returns {Promise.<Object>} A promise that resolves with the updated Webhook Endpoint object.
   * @sampleResult {"id":"we_1Mr5jULkdIwHu7ix1ibLTM0x","object":"webhook_endpoint","api_version":null,"application":null,"created":1680122196,"description":null,"enabled_events":["charge.succeeded","charge.failed"],"livemode":false,"metadata":{},"status":"disabled","url":"https://example.com/new_endpoint"}
   *
   * @throws {Error} Throws an error if the webhook endpoint update fails.
   */
  async updateWebhookEndpoint(id, updateData, requestOptions) {
    logger.debug('[updateWebhookEndpoint] Payload', { id, updateData, requestOptions })

    assert(id, 'Webhook ID must be provided.')
    assert(isObject(updateData), 'Update data must be provided and must be an object.')

    this.#initSafeApiClient()

    return this.stripe.webhookEndpoints.update(id, updateData, requestOptions)
  }

  /**
   * @description Lists all Webhook Endpoints.
   *
   * @route POST /webhook-endpoints/get
   * @operationName Get Webhook Endpoints List
   * @category Developer Tools
   * @appearanceColor #635bff #5b84ff
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes read_only
   * @paramDef {"type":"Object","label":"Request Options","name":"requestOptions","description":"Request Options. Could be found in Stripe method documentation."}
   *
   * @returns {Promise.<Object>} A promise that resolves with a list of Webhook Endpoints.
   * @sampleResult {"object":"list","url":"/v1/webhook_endpoints","has_more":false,"data":[{"id":"we_1Mr5jULkdIwHu7ix1ibLTM0x","object":"webhook_endpoint","api_version":null,"application":null,"created":1680122196,"description":null,"enabled_events":["charge.succeeded","charge.failed"],"livemode":false,"metadata":{},"status":"enabled","url":"https://example.com/my/webhook/endpoint"}]}
   */
  async getWebhookEndpointsList(options, requestOptions) {
    logger.debug('[getWebhookEndpointsList] Payload', { options, requestOptions })

    this.#initSafeApiClient()

    return this.stripe.webhookEndpoints.list(options, requestOptions)
  }

  /**
   * @description Deletes a Webhook Endpoint by its ID.
   *
   * @route DELETE /webhook_endpoints/item
   * @operationName Delete Webhook Endpoint
   * @category Developer Tools
   * @appearanceColor #635bff #5b84ff
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes read_write
   *
   * @paramDef {"type":"String","label":"Webhook ID","name":"id","required":true,"description":"The ID of the Webhook Endpoint to delete."}
   * @paramDef {"type":"Object","label":"Request Options","name":"requestOptions","description":"Request Options. Could be found in Stripe method documentation."}
   *
   * @returns {Promise.<Object>} An object with the deleted webhook endpoint’s ID.
   * @sampleResult {"id":"we_1Mr5jULkdIwHu7ix1ibLTM0x","object":"webhook_endpoint","deleted":true}
   *
   * @throws {Error} Throws an error if the webhook endpoint deletion fails.
   */
  async deleteWebhookEndpoint(id, requestOptions) {
    logger.debug('[deleteWebhookEndpoint] Payload', { id, requestOptions })

    assert(id, 'Webhook ID must be provided.')

    this.#initSafeApiClient()

    return this.stripe.webhookEndpoints.del(id, requestOptions)
  }

  /**
   * @description Allows to run any of Stripe methods with attached auth credentials
   *
   * @route POST /custom-request
   * @operationName Run Custom Request
   * @category Developer Tools
   * @appearanceColor #635bff #5b84ff
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes read_write
   *
   * @paramDef {"type":"String","label":"Namespace","name":"namespace","required":true,"description":"Method namespace"}
   * @paramDef {"type":"String","label":"Method Name","name":"methodName","required":true,"description":"Method name"}
   * @paramDef {"type":"Array","label":"Arguments","name":"payload","description":"Arguments passed into method"}
   */
  async runCustomRequest(namespace, methodName, payload) {
    logger.debug('[runCustomRequest] Payload', { namespace, methodName, payload })

    assert(namespace, 'Namespace must be provided.')
    assert(methodName, 'Method Name must be provided.')

    if (payload) {
      assert(Array.isArray(payload), 'Arguments must be an array.')
    } else {
      payload = []
    }

    this.#initApiClient()

    return this.stripe[namespace]?.[methodName](...payload)
  }
}

Flowrunner.ServerCode.addService(Stripe, [
  {
    order: 0,
    displayName: 'Currency',
    name: 'currency',
    defaultValue: 'usd',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
  },
  {
    order: 1,
    displayName: 'Secret key',
    name: 'privateKey',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Client Secret could be found at Stripe Dashboard page.',
  },
  {
    order: 2,
    displayName: 'Client ID',
    name: 'clientId',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Client ID could be found at Stripe site. Settings > Connect > Onboarding options > Oauth.',
  },
])

/**
 * @typedef {Object} executeCallback_ResultObject
 *
 * @property {String} token
 * @property {String} refreshToken
 * @property {Number} expirationInSeconds
 * @property {Object} userData
 * @property {String} connectionIdentityName
 */

/**
 * @typedef {Object} refreshToken_ResultObject
 *
 * @property {String} token
 * @property {Number} expirationInSeconds
 */

/**
 * @typedef {Object} chargeData
 * @property {String} token
 * @property {Number} amount
 */
