'use strict'

// PROD ENV
// const OAUTH_BASE_URL = 'https://auth.shipbob.com/connect'
// const API_BASE_URL = 'https://api.shipbob.com/2026-01'

const OAUTH_BASE_URL = 'https://authstage.shipbob.com/connect'
const API_BASE_URL = 'https://sandbox-api.shipbob.com/2026-01'

const DEFAULT_SCOPE_LIST = [
  'openid',
  'offline_access',
  'channels_read',
  'orders_read',
  'orders_write',
  'products_read',
  'products_write',
  'inventory_read',
  'returns_read',
  'returns_write',
  'webhooks_read',
  'webhooks_write',
  'locations_read',
  'fulfillments_read',
  'receiving_read',
  'receiving_write',
]

const DEFAULT_SCOPE_STRING = DEFAULT_SCOPE_LIST.join(' ')

const DEFAULT_PAGE_SIZE = 50

const WebhookTopics = {
  onOrderShipped     : 'order.shipped',
  onShipmentDelivered: 'order.shipment.delivered',
  onShipmentException: 'order.shipment.exception',
  onShipmentOnHold   : 'order.shipment.on_hold',
  onReturnCompleted  : 'return.completed',
}

const TopicToMethod = Object.keys(WebhookTopics).reduce((acc, key) => {
  acc[WebhookTopics[key]] = key

  return acc
}, {})

const MethodCallTypes = {
  SHAPE_EVENT   : 'SHAPE_EVENT',
  FILTER_TRIGGER: 'FILTER_TRIGGER',
}

const logger = {
  info : (...args) => console.log('[ShipBob Service] info:', ...args),
  debug: (...args) => console.log('[ShipBob Service] debug:', ...args),
  error: (...args) => console.log('[ShipBob Service] error:', ...args),
  warn : (...args) => console.log('[ShipBob Service] warn:', ...args),
}

/**
 * @requireOAuth
 * @integrationName ShipBob
 * @integrationTriggersScope SINGLE_APP
 * @integrationIcon /icon.svg
 **/
class ShipBobService {
  constructor(config) {
    this.apiToken = config.apiToken || config.clientId // TODO: check me
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
    this.scopes = DEFAULT_SCOPE_STRING
  }

  async #apiRequest({ url, method, body, query, logTag, channelId }) {
    method = method || 'get'

    if (query) {
      query = cleanupObject(query)
    }

    try {
      logger.debug(`${ logTag } - api request: [${ method }::${ url }] q=[${ JSON.stringify(query) }]`)

      const headers = this.#getAccessTokenHeader()

      if (channelId) {
        headers['shipbob_channel_id'] = String(channelId)
      }

      return await Flowrunner.Request[method](url)
        .set(headers)
        .query(query)
        .send(body)
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

  async #getChannelId() {
    const response = await this.#apiRequest({
      logTag: 'getChannelId',
      url   : `${ API_BASE_URL }/channel`,
    })

    const channels = response.items || response || []

    const writeChannel = channels.find(ch =>
      ch.scopes?.some(s => s.includes('write')),
    )

    return writeChannel?.id || channels[0]?.id
  }

  // =============================== OAUTH2 SYSTEM METHODS ================================

  /**
   * @route GET /getOAuth2ConnectionURL
   * @registerAs SYSTEM
   * @returns {String}
   */
  async getOAuth2ConnectionURL() {
    const params = new URLSearchParams()

    params.append('client_id', this.apiToken)
    params.append('scope', this.scopes)
    params.append('response_type', 'code')
    params.append('response_mode', 'query')

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
   * @route PUT /refreshToken
   * @registerAs SYSTEM
   * @param {String} refreshToken
   * @returns {refreshToken_ResultObject}
   */
  async refreshToken(refreshToken) {
    const params = new URLSearchParams()

    params.append('grant_type', 'refresh_token')
    params.append('client_id', this.apiToken)
    params.append('client_secret', this.clientSecret)
    params.append('refresh_token', refreshToken)

    try {
      const response = await Flowrunner.Request.post(`${ OAUTH_BASE_URL }/token`)
        .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        .send(params.toString())

      return {
        token              : response.access_token,
        expirationInSeconds: response.expires_in,
        refreshToken       : response.refresh_token || refreshToken,
      }
    } catch (error) {
      logger.error(`refreshToken: ${ JSON.stringify(error) }`)

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
   */

  /**
   * @route POST /executeCallback
   * @registerAs SYSTEM
   * @param {Object} callbackObject
   * @returns {executeCallback_ResultObject}
   */
  async executeCallback(callbackObject) {
    const params = new URLSearchParams()

    params.append('code', callbackObject.code)
    params.append('redirect_uri', callbackObject.redirectURI)
    params.append('grant_type', 'authorization_code')
    params.append('client_id', this.apiToken)
    params.append('client_secret', this.clientSecret)

    let codeExchangeResponse = {}

    try {
      codeExchangeResponse = await Flowrunner.Request.post(`${ OAUTH_BASE_URL }/token`)
        .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        .send(params.toString())

      logger.debug(`[executeCallback] codeExchangeResponse: ${ JSON.stringify(codeExchangeResponse) }`)
    } catch (error) {
      logger.error(`[executeCallback] codeExchangeResponse error: ${ JSON.stringify(error) }`)

      return {}
    }

    let channelInfo = {}

    try {
      const channelsResponse = await Flowrunner.Request.get(`${ API_BASE_URL }/channel`)
        .set(this.#getAccessTokenHeader(codeExchangeResponse.access_token))

      const channels = channelsResponse.items || channelsResponse || []

      channelInfo = channels.find(ch =>
        ch.scopes?.some(s => s.includes('write')),
      ) || channels[0] || {}

      logger.debug(`[executeCallback] channelInfo: ${ JSON.stringify(channelInfo) }`)
    } catch (error) {
      logger.error(`[executeCallback] channels error: ${ error.message }`)
    }

    return {
      token                 : codeExchangeResponse.access_token,
      expirationInSeconds   : codeExchangeResponse.expires_in,
      refreshToken          : codeExchangeResponse.refresh_token,
      connectionIdentityName: channelInfo.name
        ? `${ channelInfo.application_name || 'ShipBob' } (${ channelInfo.name })`
        : 'ShipBob Account',
      overwrite             : true,
      userData              : { channelId: channelInfo.id },
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
   * @typedef {Object} getProductsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter products by name or SKU."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination token for retrieving the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Products List
   * @category Product Management
   * @description Returns products from your ShipBob account for dynamic selection in order creation and inventory management workflows.
   *
   * @route POST /get-products-dictionary
   *
   * @paramDef {"type":"getProductsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination token for retrieving and filtering products."}
   *
   * @sampleResult {"items":[{"label":"Medium Blue T-Shirt (SKU: TShirtBlueM)","note":"ID: 12345","value":"12345"}],"cursor":null}
   * @returns {DictionaryResponse}
   */
  async getProductsDictionary({ search, cursor }) {
    const response = await this.#apiRequest({
      logTag: 'getProductsDictionary',
      url   : `${ API_BASE_URL }/product`,
      query : {
        Search  : search || undefined,
        PageSize: DEFAULT_PAGE_SIZE,
      },
    })

    const products = response.items || response || []

    return {
      cursor: extractCursor(response.next),
      items : products.map(product => {
        const variant = product.variants?.[0]
        const sku = variant?.sku || 'N/A'

        return {
          label: `${ product.name || '[unnamed]' } (SKU: ${ sku })`,
          note : `ID: ${ product.id }`,
          value: String(product.id),
        }
      }),
    }
  }

  /**
   * @typedef {Object} getChannelsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter channels by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination token for retrieving the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Channels
   * @category Configuration
   * @description Returns available ShipBob channels for selecting the target sales channel in order and product operations.
   *
   * @route POST /get-channels-dictionary
   *
   * @paramDef {"type":"getChannelsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination token for retrieving and filtering channels."}
   *
   * @sampleResult {"items":[{"label":"My Shopify Store","note":"App: ShipBob Shopify","value":"100102"}],"cursor":null}
   * @returns {DictionaryResponse}
   */
  async getChannelsDictionary({ search, cursor }) {
    const response = await this.#apiRequest({
      logTag: 'getChannelsDictionary',
      url   : `${ API_BASE_URL }/channel`,
      query : {
        RecordsPerPage: DEFAULT_PAGE_SIZE,
        Cursor        : cursor || undefined,
      },
    })

    const channels = response.items || response || []

    const filtered = search
      ? searchFilter(channels, ['name', 'application_name'], search)
      : channels

    return {
      cursor: extractCursor(response.next),
      items : filtered.map(channel => ({
        label: channel.name || '[unnamed]',
        note : `App: ${ channel.application_name || 'N/A' }`,
        value: String(channel.id),
      })),
    }
  }

  /**
   * @typedef {Object} getLocationsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter fulfillment center locations by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination token for retrieving the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Locations
   * @category Configuration
   * @description Returns ShipBob fulfillment center locations for selecting warehouse destinations in receiving and return operations.
   *
   * @route POST /get-locations-dictionary
   *
   * @paramDef {"type":"getLocationsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination token for retrieving and filtering locations."}
   *
   * @sampleResult {"items":[{"label":"Cicero (IL)","note":"ID: 1","value":"1"}],"cursor":null}
   * @returns {DictionaryResponse}
   */
  async getLocationsDictionary({ search, cursor }) {
    const response = await this.#apiRequest({
      logTag: 'getLocationsDictionary',
      url   : `${ API_BASE_URL }/location`,
      query : {
        ReceivingEnabled: true,
      },
    })

    const locations = Array.isArray(response) ? response : response.items || []

    const filtered = search
      ? searchFilter(locations, ['name'], search)
      : locations

    return {
      cursor: null,
      items : filtered.map(location => ({
        label: location.name || '[unnamed]',
        note : `ID: ${ location.id }`,
        value: String(location.id),
      })),
    }
  }

  /**
   * @typedef {Object} getShippingMethodsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter shipping methods by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination token for retrieving the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Shipping Methods
   * @category Configuration
   * @description Returns available shipping methods configured in your ShipBob account for selecting delivery options when creating orders.
   *
   * @route POST /get-shipping-methods-dictionary
   *
   * @paramDef {"type":"getShippingMethodsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination token for retrieving and filtering shipping methods."}
   *
   * @sampleResult {"items":[{"label":"Standard","note":"Active","value":"Standard"},{"label":"Expedited","note":"Active","value":"Expedited"}],"cursor":null}
   * @returns {DictionaryResponse}
   */
  async getShippingMethodsDictionary({ search, cursor }) {
    const response = await this.#apiRequest({
      logTag: 'getShippingMethodsDictionary',
      url   : `${ API_BASE_URL }/shipping-method`,
      query : {
        Page : 0,
        Limit: 250,
      },
    })

    const methods = Array.isArray(response) ? response : response.items || []

    const filtered = search
      ? searchFilter(methods, ['name'], search)
      : methods

    return {
      cursor: null,
      items : filtered.map(method => ({
        label: method.name || '[unnamed]',
        note : method.active ? 'Active' : 'Inactive',
        value: method.name,
      })),
    }
  }

  /**
   * @typedef {Object} getFulfillmentCentersDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter fulfillment centers by name or location."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination token for retrieving the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Fulfillment Centers List
   * @category Warehouse Receiving
   * @description Returns available ShipBob fulfillment centers for selecting the target warehouse when creating Warehouse Receiving Orders (WROs).
   *
   * @route POST /get-fulfillment-centers-dictionary
   *
   * @paramDef {"type":"getFulfillmentCentersDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination token for retrieving and filtering fulfillment centers."}
   *
   * @sampleResult {"items":[{"label":"Cicero (IL)","note":"5900 W Ogden Ave, Cicero, IL, 60804","value":"1"}],"cursor":null}
   * @returns {DictionaryResponse}
   */
  async getFulfillmentCentersDictionary({ search, cursor }) {
    const response = await this.#apiRequest({
      logTag: 'getFulfillmentCentersDictionary',
      url   : `${ API_BASE_URL }/fulfillment-center`,
    })

    const centers = Array.isArray(response) ? response : response.items || []

    const filtered = search
      ? searchFilter(centers, ['name', 'city', 'state'], search)
      : centers

    return {
      cursor: null,
      items : filtered.map(center => ({
        label: center.name || '[unnamed]',
        note : [center.address1, center.city, center.state, center.zip_code].filter(Boolean).join(', ') || `ID: ${ center.id }`,
        value: String(center.id),
      })),
    }
  }

  // ======================================= END OF DICTIONARIES =======================================

  // ========================================== TRIGGERS ===============================================

  async #createWebhook(topics, invocation) {
    const response = await this.#apiRequest({
      logTag: 'createWebhook',
      method: 'post',
      url   : `${ API_BASE_URL }/webhook`,
      body  : {
        topics,
        url        : `${ invocation.callbackUrl }&connectionId=${ invocation.connectionId }`,
        description: `FlowRunner trigger for ${ topics.join(', ') }`,
      },
    })

    return response
  }

  async #deleteWebhook(webhookId) {
    await this.#apiRequest({
      logTag: 'deleteWebhook',
      url   : `${ API_BASE_URL }/webhook/${ webhookId }`,
      method: 'delete',
    })
  }

  async #getWebhook(invocation) {
    const topics = invocation.events.map(event => WebhookTopics[event.name])

    if (invocation.webhookData?.id) {
      await this.#deleteWebhook(invocation.webhookData.id)
    }

    return this.#createWebhook(topics, invocation)
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerUpsertWebhook(invocation) {
    logger.debug(`handleTriggerUpsertWebhook.invocation: ${ JSON.stringify(invocation) }`)

    const webhookData = await this.#getWebhook(invocation)

    logger.debug(`handleTriggerUpsertWebhook.webhookData: ${ JSON.stringify(webhookData) }`)

    return {
      webhookData,
      connectionId: invocation.connectionId,
    }
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerResolveEvents(invocation) {
    logger.debug(`handleTriggerResolveEvents.invocation: ${ JSON.stringify(invocation) }`)

    const topic = invocation.headers?.['x-webhook-topic'] || invocation.body?.topic
    const methodName = TopicToMethod[topic]

    logger.debug(`handleTriggerResolveEvents.methodName: ${ methodName }`)

    if (!methodName) {
      return null
    }

    const events = await this[methodName](MethodCallTypes.SHAPE_EVENT, invocation.body)

    logger.debug(`handleTriggerResolveEvents.events: ${ JSON.stringify(events) }`)

    return {
      connectionId: invocation.queryParams?.connectionId,
      events,
    }
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerSelectMatched(invocation) {
    logger.debug(`handleTriggerSelectMatched.${ invocation.eventName }.FILTER_TRIGGER: ${ JSON.stringify(invocation) }`)

    const data = await this[invocation.eventName](MethodCallTypes.FILTER_TRIGGER, invocation)

    logger.debug(`handleTriggerSelectMatched.${ invocation.eventName }.triggersToActivate: ${ JSON.stringify(data) }`)

    return data
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation"}
   */
  async handleTriggerDeleteWebhook(invocation) {
    logger.debug(`handleTriggerDeleteWebhook.invocation: ${ JSON.stringify(invocation) }`)

    if (invocation.webhookData?.id) {
      await this.#deleteWebhook(invocation.webhookData.id)
    }
  }

  /**
   * @operationName On Order Shipped
   * @category Order Tracking
   * @description Triggers when an order is shipped from a ShipBob fulfillment center, enabling automated shipping confirmation emails, order status updates in external systems, customer notifications, or post-shipment follow-up workflows.
   * @registerAs REALTIME_TRIGGER
   *
   * @route POST /on-order-shipped
   * @appearanceColor #2D5BF6 #2D5BF6
   * @executionTimeoutInSeconds 120
   *
   * @returns {Object}
   * @sampleResult {"id":67890,"order_id":12345,"reference_id":"ORD-001","status":"Completed","created_date":"2025-01-15T10:30:00Z","actual_fulfillment_date":"2025-01-16T12:00:00Z","location":{"id":1,"name":"Cicero (IL)"},"tracking":{"tracking_number":"1Z999AA10123456784","carrier":"UPS","carrier_service":"Ground","tracking_url":"https://www.ups.com/track?tracknum=1Z999AA10123456784","shipping_date":"2025-01-16T12:00:00Z"},"products":[{"id":100,"name":"Blue T-Shirt","sku":"TShirtBlueM","quantity":2}],"recipient":{"name":"John Doe","email":"john@example.com","address":{"address1":"100 Nowhere Blvd","city":"New York","state":"NY","zip_code":"10001","country":"US"}}}
   */
  onOrderShipped(callType, payload) {
    if (callType === MethodCallTypes.SHAPE_EVENT) {
      return [
        {
          name: 'onOrderShipped',
          data: payload,
        },
      ]
    }

    if (callType === MethodCallTypes.FILTER_TRIGGER) {
      const ids = payload.triggers.map(trigger => trigger.id)

      logger.debug(`onOrderShipped.triggersIdsToActivate: ${ JSON.stringify(ids) }`)

      return { ids }
    }
  }

  /**
   * @operationName On Shipment Delivered
   * @category Order Tracking
   * @description Triggers when a shipment is delivered to the customer, enabling automated delivery confirmation emails, review requests, CRM record updates, or post-delivery follow-up workflows.
   * @registerAs REALTIME_TRIGGER
   *
   * @route POST /on-shipment-delivered
   * @appearanceColor #2D5BF6 #2D5BF6
   * @executionTimeoutInSeconds 120
   *
   * @returns {Object}
   * @sampleResult {"id":67890,"order_id":12345,"reference_id":"ORD-001","status":"Completed","delivery_date":"2025-01-20T14:30:00Z","actual_fulfillment_date":"2025-01-16T12:00:00Z","location":{"id":1,"name":"Cicero (IL)"},"tracking":{"tracking_number":"1Z999AA10123456784","carrier":"UPS","carrier_service":"Ground","tracking_url":"https://www.ups.com/track?tracknum=1Z999AA10123456784"},"products":[{"id":100,"name":"Blue T-Shirt","sku":"TShirtBlueM","quantity":2}],"recipient":{"name":"John Doe","address":{"address1":"100 Nowhere Blvd","city":"New York","state":"NY","country":"US"}}}
   */
  onShipmentDelivered(callType, payload) {
    if (callType === MethodCallTypes.SHAPE_EVENT) {
      return [
        {
          name: 'onShipmentDelivered',
          data: payload,
        },
      ]
    }

    if (callType === MethodCallTypes.FILTER_TRIGGER) {
      const ids = payload.triggers.map(trigger => trigger.id)

      logger.debug(`onShipmentDelivered.triggersIdsToActivate: ${ JSON.stringify(ids) }`)

      return { ids }
    }
  }

  /**
   * @operationName On Shipment Exception
   * @category Order Tracking
   * @description Triggers when a shipment encounters an exception such as delivery failure, address issues, or carrier problems. Enables automated alerts to support teams, customer notifications, or resolution workflows.
   * @registerAs REALTIME_TRIGGER
   *
   * @route POST /on-shipment-exception
   * @appearanceColor #2D5BF6 #2D5BF6
   * @executionTimeoutInSeconds 120
   *
   * @returns {Object}
   * @sampleResult {"id":67890,"order_id":12345,"reference_id":"ORD-001","status":"Exception","status_details":[{"id":300,"name":"OutOfStock","description":"Insufficient inventory to fulfill"}],"location":{"id":1,"name":"Cicero (IL)"},"tracking":{"tracking_number":"1Z999AA10123456784","carrier":"UPS"},"products":[{"id":100,"name":"Blue T-Shirt","sku":"TShirtBlueM","quantity":2}],"recipient":{"name":"John Doe","address":{"city":"New York","state":"NY","country":"US"}}}
   */
  onShipmentException(callType, payload) {
    if (callType === MethodCallTypes.SHAPE_EVENT) {
      return [
        {
          name: 'onShipmentException',
          data: payload,
        },
      ]
    }

    if (callType === MethodCallTypes.FILTER_TRIGGER) {
      const ids = payload.triggers.map(trigger => trigger.id)

      logger.debug(`onShipmentException.triggersIdsToActivate: ${ JSON.stringify(ids) }`)

      return { ids }
    }
  }

  /**
   * @operationName On Shipment On Hold
   * @category Order Tracking
   * @description Triggers when a shipment is placed on hold at a fulfillment center. Enables automated alerts to operations teams, customer notifications about delays, or escalation workflows for held orders.
   * @registerAs REALTIME_TRIGGER
   *
   * @route POST /on-shipment-on-hold
   * @appearanceColor #2D5BF6 #2D5BF6
   * @executionTimeoutInSeconds 120
   *
   * @returns {Object}
   * @sampleResult {"id":67890,"order_id":12345,"reference_id":"ORD-001","status":"OnHold","status_details":[{"id":401,"name":"InvalidAddress","description":"The shipping address could not be validated"}],"location":{"id":1,"name":"Cicero (IL)"},"products":[{"id":100,"name":"Blue T-Shirt","sku":"TShirtBlueM","quantity":2}],"recipient":{"name":"John Doe","address":{"city":"New York","state":"NY","country":"US"}}}
   */
  onShipmentOnHold(callType, payload) {
    if (callType === MethodCallTypes.SHAPE_EVENT) {
      return [
        {
          name: 'onShipmentOnHold',
          data: payload,
        },
      ]
    }

    if (callType === MethodCallTypes.FILTER_TRIGGER) {
      const ids = payload.triggers.map(trigger => trigger.id)

      logger.debug(`onShipmentOnHold.triggersIdsToActivate: ${ JSON.stringify(ids) }`)

      return { ids }
    }
  }

  /**
   * @operationName On Return Completed
   * @category Returns
   * @description Triggers when a return order is fully processed at a ShipBob fulfillment center. Enables automated refund processing, inventory restocking updates, customer notifications, or return analytics workflows.
   * @registerAs REALTIME_TRIGGER
   *
   * @route POST /on-return-completed
   * @appearanceColor #2D5BF6 #2D5BF6
   * @executionTimeoutInSeconds 120
   *
   * @returns {Object}
   * @sampleResult {"id":11111,"reference_id":"RET-001","status":"Completed","fulfillment_center":{"id":1},"inventory":[{"id":222,"quantity":1,"requested_action":"Restock"}],"tracking_number":"1Z999AA10123456784","original_shipment_id":67890}
   */
  onReturnCompleted(callType, payload) {
    if (callType === MethodCallTypes.SHAPE_EVENT) {
      return [
        {
          name: 'onReturnCompleted',
          data: payload,
        },
      ]
    }

    if (callType === MethodCallTypes.FILTER_TRIGGER) {
      const ids = payload.triggers.map(trigger => trigger.id)

      logger.debug(`onReturnCompleted.triggersIdsToActivate: ${ JSON.stringify(ids) }`)

      return { ids }
    }
  }

  // ======================================= END OF TRIGGERS ===========================================

  // ======================================= ORDER MANAGEMENT ==========================================

  /**
   * @description Creates a new fulfillment order in ShipBob. Supports DTC (direct-to-consumer), DropShip, and B2B order types. Products can be referenced by SKU using the products JSON array. The order is queued for fulfillment upon creation.
   *
   * @route POST /create-order
   * @operationName Create Order
   * @category Order Management
   * @appearanceColor #2D5BF6 #2D5BF6
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Reference ID","name":"referenceId","required":true,"description":"Unique external order identifier for linking back to your system. Must be unique per channel. Max 300 characters."}
   * @paramDef {"type":"String","label":"Shipping Method","name":"shippingMethod","required":true,"dictionary":"getShippingMethodsDictionary","description":"Shipping service level matching your Ship Option Mapping in ShipBob. Examples: 'Standard', 'Expedited', 'Free 2-day Shipping'."}
   * @paramDef {"type":"String","label":"Order Type","name":"orderType","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["DTC","DropShip","B2B"]}},"description":"Order fulfillment type: DTC (direct-to-consumer), DropShip, or B2B (business-to-business)."}
   * @paramDef {"type":"String","label":"Recipient Name","name":"recipientName","required":true,"description":"Full name of the order recipient. Max 300 characters."}
   * @paramDef {"type":"String","label":"Address Line 1","name":"address1","required":true,"description":"Primary street address for delivery."}
   * @paramDef {"type":"String","label":"City","name":"city","required":true,"description":"Delivery city name."}
   * @paramDef {"type":"String","label":"Country","name":"country","required":true,"description":"Two-letter ISO country code. Examples: 'US', 'CA', 'GB', 'DE'."}
   * @paramDef {"type":"String","label":"Products JSON","name":"productsJson","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"JSON array of products to fulfill. Each item needs reference_id (SKU) and quantity. Example: [{\"reference_id\":\"SKU1\",\"quantity\":2,\"name\":\"Blue T-Shirt\"}]"}
   * @paramDef {"type":"String","label":"State","name":"state","description":"State or province code for delivery address."}
   * @paramDef {"type":"String","label":"Zip Code","name":"zipCode","description":"Postal or ZIP code for delivery address."}
   * @paramDef {"type":"String","label":"Address Line 2","name":"address2","description":"Secondary address line (apartment, suite, unit, etc.)."}
   * @paramDef {"type":"String","label":"Order Number","name":"orderNumber","description":"User-friendly order display number. Defaults to reference_id if not specified. Max 400 characters."}
   * @paramDef {"type":"String","label":"Recipient Email","name":"recipientEmail","description":"Email address of the recipient for shipping notifications."}
   * @paramDef {"type":"String","label":"Recipient Phone","name":"recipientPhone","description":"Phone number of the recipient for delivery coordination."}
   * @paramDef {"type":"String","label":"Gift Message","name":"giftMessage","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional gift message to include with the shipment. Max 500 characters."}
   *
   * @returns {Object}
   * @sampleResult {"id":12345,"reference_id":"ORD-001","order_number":"ORD-001","status":"Processing","type":"DTC","created_date":"2025-01-15T10:30:00Z","shipping_method":"Standard","products":[{"id":100,"reference_id":"TShirtBlueM","sku":"TShirtBlueM","quantity":2}],"recipient":{"name":"John Doe","address":{"address1":"100 Nowhere Blvd","city":"New York","state":"NY","zip_code":"10001","country":"US"}},"channel":{"id":100102,"name":"My Store"}}
   */
  async createOrder(
    referenceId,
    shippingMethod,
    orderType,
    recipientName,
    address1,
    city,
    country,
    productsJson,
    state,
    zipCode,
    address2,
    orderNumber,
    recipientEmail,
    recipientPhone,
    giftMessage,
  ) {
    if (!referenceId) {
      throw new Error('"Reference ID" is required')
    }

    if (!productsJson) {
      throw new Error('"Products JSON" is required')
    }

    let products

    try {
      products = typeof productsJson === 'string' ? JSON.parse(productsJson) : productsJson
    } catch (error) {
      throw new Error('"Products JSON" must be a valid JSON array')
    }

    const channelId = await this.#getChannelId()

    const body = cleanupObject({
      reference_id   : referenceId,
      order_number   : orderNumber || undefined,
      shipping_method: shippingMethod,
      type           : orderType || 'DTC',
      products,
      recipient      : {
        name        : recipientName,
        email       : recipientEmail || undefined,
        phone_number: recipientPhone || undefined,
        address     : cleanupObject({
          address1,
          address2,
          city,
          state,
          zip_code: zipCode,
          country,
        }),
      },
      gift_message   : giftMessage || undefined,
    })

    return await this.#apiRequest({
      logTag: 'createOrder',
      method: 'post',
      url   : `${ API_BASE_URL }/order`,
      body,
      channelId,
    })
  }

  /**
   * @description Retrieves details of a specific order by its ShipBob order ID, including current status, shipments with tracking information, products, and recipient details. Useful for checking order fulfillment progress.
   *
   * @route POST /get-order
   * @operationName Get Order
   * @category Order Management
   * @appearanceColor #2D5BF6 #2D5BF6
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"Number","label":"Order ID","name":"orderId","required":true,"description":"The unique ShipBob order ID to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":12345,"reference_id":"ORD-001","order_number":"ORD-001","status":"Fulfilled","type":"DTC","created_date":"2025-01-15T10:30:00Z","shipping_method":"Standard","products":[{"id":100,"reference_id":"TShirtBlueM","sku":"TShirtBlueM","quantity":2,"unit_price":29.99}],"shipments":[{"id":67890,"status":"Completed","tracking":{"tracking_number":"1Z999AA10123456784","carrier":"UPS","carrier_service":"Ground","tracking_url":"https://www.ups.com/track?tracknum=1Z999AA10123456784"}}],"recipient":{"name":"John Doe","address":{"address1":"100 Nowhere Blvd","city":"New York","state":"NY","zip_code":"10001","country":"US"}}}
   */
  async getOrder(orderId) {
    if (!orderId) {
      throw new Error('"Order ID" is required')
    }

    return await this.#apiRequest({
      logTag: 'getOrder',
      url   : `${ API_BASE_URL }/order/${ orderId }`,
    })
  }

  /**
   * @description Lists orders with optional filtering by date range, tracking status, and pagination. Returns an array of orders with current status, shipment details, and tracking information. Supports up to 250 orders per page.
   *
   * @route POST /get-orders
   * @operationName Get Orders
   * @category Order Management
   * @appearanceColor #2D5BF6 #2D5BF6
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Start Date","name":"startDate","uiComponent":{"type":"DATE_PICKER"},"description":"Filter orders created on or after this date."}
   * @paramDef {"type":"String","label":"End Date","name":"endDate","uiComponent":{"type":"DATE_PICKER"},"description":"Filter orders created on or before this date."}
   * @paramDef {"type":"Boolean","label":"Has Tracking","name":"hasTracking","uiComponent":{"type":"TOGGLE"},"description":"Filter to only return orders that have tracking information assigned."}
   * @paramDef {"type":"Number","label":"Page","name":"page","description":"Page number for pagination starting at 1."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","description":"Number of orders per page, up to 250. Default: 50."}
   *
   * @returns {Array}
   * @sampleResult [{"id":12345,"reference_id":"ORD-001","order_number":"ORD-001","status":"Processing","type":"DTC","created_date":"2025-01-15T10:30:00Z","shipping_method":"Standard","products":[{"reference_id":"TShirtBlueM","quantity":2}],"recipient":{"name":"John Doe"}},{"id":12346,"reference_id":"ORD-002","order_number":"ORD-002","status":"Fulfilled","type":"DTC","created_date":"2025-01-16T11:00:00Z","products":[{"reference_id":"HoodieRedL","quantity":1}],"recipient":{"name":"Jane Smith"}}]
   */
  async getOrders(startDate, endDate, hasTracking, page, limit) {
    return await this.#apiRequest({
      logTag: 'getOrders',
      url   : `${ API_BASE_URL }/order`,
      query : {
        StartDate  : startDate || undefined,
        EndDate    : endDate || undefined,
        HasTracking: hasTracking !== undefined && hasTracking !== null ? hasTracking : undefined,
        Page       : page || 1,
        Limit      : limit || DEFAULT_PAGE_SIZE,
      },
    })
  }

  /**
   * @description Cancels an existing order and its associated shipments in ShipBob. Returns the cancellation result including which shipments were successfully cancelled. Orders already fulfilled cannot be cancelled.
   *
   * @route POST /cancel-order
   * @operationName Cancel Order
   * @category Order Management
   * @appearanceColor #2D5BF6 #2D5BF6
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"Number","label":"Order ID","name":"orderId","required":true,"description":"The unique ShipBob order ID to cancel."}
   *
   * @returns {Object}
   * @sampleResult {"order_id":12345,"status":"Success","canceled_shipment_results":[{"shipment_id":67890,"action":"Cancel","success":true,"reason":"Successfully cancelled"}],"order":{"id":12345,"status":"Cancelled","reference_id":"ORD-001"}}
   */
  async cancelOrder(orderId) {
    if (!orderId) {
      throw new Error('"Order ID" is required')
    }

    return await this.#apiRequest({
      logTag: 'cancelOrder',
      method: 'post',
      url   : `${ API_BASE_URL }/order/${ orderId }:cancel`,
    })
  }

  /**
   * @description Estimates the fulfillment cost for an order before creating it. Returns cost estimates per shipping method and fulfillment center, including shipping price and package weight. Useful for displaying shipping costs to customers or selecting optimal fulfillment options.
   *
   * @route POST /estimate-fulfillment
   * @operationName Estimate Fulfillment Cost
   * @category Order Management
   * @appearanceColor #2D5BF6 #2D5BF6
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Address Line 1","name":"address1","required":true,"description":"Primary street address for the delivery estimate."}
   * @paramDef {"type":"String","label":"City","name":"city","required":true,"description":"Delivery city name."}
   * @paramDef {"type":"String","label":"Country","name":"country","required":true,"description":"Two-letter ISO country code. Examples: 'US', 'CA', 'GB'."}
   * @paramDef {"type":"String","label":"Products JSON","name":"productsJson","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"JSON array of products for the estimate. Each item needs reference_id (SKU) and quantity. Example: [{\"reference_id\":\"SKU1\",\"quantity\":2}]"}
   * @paramDef {"type":"String","label":"State","name":"state","description":"State or province code."}
   * @paramDef {"type":"String","label":"Zip Code","name":"zipCode","description":"Postal or ZIP code."}
   *
   * @returns {Object}
   * @sampleResult {"estimates":[{"estimated_price":5.99,"estimated_currency_code":"USD","shipping_method":"Standard","fulfillment_center":{"id":1,"name":"Cicero (IL)"},"total_weight_oz":16.0},{"estimated_price":12.99,"estimated_currency_code":"USD","shipping_method":"Expedited","fulfillment_center":{"id":1,"name":"Cicero (IL)"},"total_weight_oz":16.0}]}
   */
  async estimateFulfillmentCost(address1, city, country, productsJson, state, zipCode) {
    if (!address1 || !city || !country) {
      throw new Error('"Address Line 1", "City", and "Country" are required')
    }

    if (!productsJson) {
      throw new Error('"Products JSON" is required')
    }

    let products

    try {
      products = typeof productsJson === 'string' ? JSON.parse(productsJson) : productsJson
    } catch (error) {
      throw new Error('"Products JSON" must be a valid JSON array')
    }

    const channelId = await this.#getChannelId()

    const body = {
      address: cleanupObject({
        address1,
        city,
        state,
        zip_code: zipCode,
        country,
      }),
      products,
    }

    return await this.#apiRequest({
      logTag: 'estimateFulfillmentCost',
      method: 'post',
      url   : `${ API_BASE_URL }/order:estimate`,
      body,
      channelId,
    })
  }

  /**
   * @description Cancels multiple shipments in a single batch request. Returns per-shipment results indicating success or failure with reasons. Shipments can only be cancelled if they have not yet been picked, packed, or shipped.
   *
   * @route POST /batch-cancel-shipments
   * @operationName Batch Cancel Shipments
   * @category Order Management
   * @appearanceColor #2D5BF6 #2D5BF6
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Shipment IDs","name":"shipmentIdsJson","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"JSON array of shipment IDs to cancel. Example: [12345, 12346, 12347]"}
   *
   * @returns {Object}
   * @sampleResult {"results":[{"shipment_id":12345,"action":"Cancel","is_success":true,"reason":"Successfully cancelled"},{"shipment_id":12346,"action":"Cancel","is_success":false,"reason":"Shipment already shipped"}]}
   */
  async batchCancelShipments(shipmentIdsJson) {
    if (!shipmentIdsJson) {
      throw new Error('"Shipment IDs" is required')
    }

    let shipmentIds

    try {
      shipmentIds = typeof shipmentIdsJson === 'string' ? JSON.parse(shipmentIdsJson) : shipmentIdsJson
    } catch (error) {
      throw new Error('"Shipment IDs" must be a valid JSON array of numeric IDs')
    }

    if (!Array.isArray(shipmentIds) || shipmentIds.length === 0) {
      throw new Error('"Shipment IDs" must be a non-empty array')
    }

    const channelId = await this.#getChannelId()

    return await this.#apiRequest({
      logTag: 'batchCancelShipments',
      method: 'post',
      url   : `${ API_BASE_URL }/shipment:batchCancel`,
      body  : { shipment_ids: shipmentIds },
      channelId,
    })
  }

  /**
   * @description Marks tracking information as uploaded to an external system for multiple shipments. After marking, these shipments will no longer appear when filtering by IsTrackingUploaded=false. Typical workflow: retrieve orders with tracking, sync to your system, then call this to mark them as synced.
   *
   * @route POST /mark-tracking-uploaded
   * @operationName Mark Tracking Uploaded
   * @category Order Management
   * @appearanceColor #2D5BF6 #2D5BF6
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Shipment IDs","name":"shipmentIdsJson","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"JSON array of shipment IDs to mark tracking as uploaded. Example: [100810005, 100810006]"}
   * @paramDef {"type":"Boolean","label":"Is Tracking Uploaded","name":"isTrackingUploaded","required":true,"uiComponent":{"type":"TOGGLE"},"description":"Set to true to mark tracking as uploaded, or false to unmark."}
   *
   * @returns {Object}
   * @sampleResult {"results":[{"shipmentId":100810005,"isSuccess":true,"error":null},{"shipmentId":100810006,"isSuccess":true,"error":null}],"summary":{"successful":2,"failed":0,"total":2}}
   */
  async markTrackingUploaded(shipmentIdsJson, isTrackingUploaded) {
    if (!shipmentIdsJson) {
      throw new Error('"Shipment IDs" is required')
    }

    let shipmentIds

    try {
      shipmentIds = typeof shipmentIdsJson === 'string' ? JSON.parse(shipmentIdsJson) : shipmentIdsJson
    } catch (error) {
      throw new Error('"Shipment IDs" must be a valid JSON array of numeric IDs')
    }

    if (!Array.isArray(shipmentIds) || shipmentIds.length === 0) {
      throw new Error('"Shipment IDs" must be a non-empty array')
    }

    return await this.#apiRequest({
      logTag: 'markTrackingUploaded',
      method: 'post',
      url   : `${ API_BASE_URL }/shipment:batchUpdateTrackingUpload`,
      body  : {
        shipment_ids        : shipmentIds,
        is_tracking_uploaded: isTrackingUploaded === true,
      },
    })
  }

  // ======================================= PRODUCT MANAGEMENT ========================================

  /**
   * @description Creates a new product in ShipBob with one variant. Each variant requires a unique SKU. Supports physical dimensions, weight, and barcode data. The product is created in the channel associated with your authentication.
   *
   * @route POST /create-product
   * @operationName Create Product
   * @category Product Management
   * @appearanceColor #2D5BF6 #2D5BF6
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Product Name","name":"name","required":true,"description":"Display name for the product in ShipBob."}
   * @paramDef {"type":"String","label":"SKU","name":"sku","required":true,"description":"Unique stock keeping unit identifier for the product variant."}
   * @paramDef {"type":"String","label":"Variant Name","name":"variantName","description":"Name for the product variant. Defaults to product name if not specified."}
   * @paramDef {"type":"String","label":"UPC","name":"upc","description":"Universal Product Code barcode for the variant."}
   * @paramDef {"type":"String","label":"GTIN","name":"gtin","description":"Global Trade Item Number for the variant."}
   * @paramDef {"type":"Number","label":"Weight (oz)","name":"weight","description":"Product weight in ounces."}
   * @paramDef {"type":"Number","label":"Length (in)","name":"length","description":"Product length in inches."}
   * @paramDef {"type":"Number","label":"Width (in)","name":"width","description":"Product width in inches."}
   * @paramDef {"type":"Number","label":"Height (in)","name":"height","description":"Product height in inches."}
   *
   * @returns {Object}
   * @sampleResult {"id":12345,"name":"Blue T-Shirt","type":"Regular","created_on":"2025-01-15T10:30:00Z","variants":[{"id":54321,"sku":"TShirtBlueM","name":"Medium","weight":{"weight":8.0,"unit":"oz"},"status":"Active","inventory":{"inventory_id":111,"on_hand_qty":0}}]}
   */
  async createProduct(name, sku, variantName, upc, gtin, weight, length, width, height) {
    if (!name) {
      throw new Error('"Product Name" is required')
    }

    if (!sku) {
      throw new Error('"SKU" is required')
    }

    const channelId = await this.#getChannelId()

    const variant = cleanupObject({
      sku,
      name     : variantName || name,
      upc      : upc || undefined,
      gtin     : gtin || undefined,
      weight   : weight || undefined,
      dimension: length || width || height
        ? cleanupObject({ length, width, height })
        : undefined,
    })

    const body = {
      name,
      type_id : 1,
      variants: [variant],
    }

    return await this.#apiRequest({
      logTag: 'createProduct',
      method: 'post',
      url   : `${ API_BASE_URL }/product`,
      body,
      channelId,
    })
  }

  /**
   * @description Searches and lists products in your ShipBob account with comprehensive filtering options. Returns variant details including SKU, inventory levels, dimensions, and status. Supports filtering by name, SKU, barcode, category, taxonomy, channel, platform, product type, variant status, inventory sync, and more. Results are paginated with cursor-based navigation.
   *
   * @route POST /get-products
   * @operationName Get Products
   * @category Product Management
   * @appearanceColor #2D5BF6 #2D5BF6
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Search","name":"search","description":"General search across product name, SKU, inventory ID, and product ID."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"Filter products by name (exact or partial match)."}
   * @paramDef {"type":"String","label":"SKU","name":"sku","description":"Filter products by SKU."}
   * @paramDef {"type":"String","label":"Seller SKU","name":"sellerSku","description":"Filter products by seller SKU."}
   * @paramDef {"type":"String","label":"Barcode","name":"barcode","description":"Filter by a single barcode associated with a variant."}
   * @paramDef {"type":"String","label":"Barcodes","name":"barcodes","description":"Filter by multiple barcodes (comma-separated)."}
   * @paramDef {"type":"String","label":"Product ID","name":"productId","description":"Filter by ShipBob product ID."}
   * @paramDef {"type":"String","label":"Variant ID","name":"variantId","description":"Filter products containing a variant with the given ID."}
   * @paramDef {"type":"String","label":"Inventory ID","name":"inventoryId","description":"Filter variants by associated inventory ID."}
   * @paramDef {"type":"String","label":"Category IDs","name":"categoryIds","description":"Filter by category IDs (comma-separated)."}
   * @paramDef {"type":"String","label":"Taxonomy IDs","name":"taxonomyIds","description":"Filter by taxonomy IDs or their descendants (comma-separated)."}
   * @paramDef {"type":"String","label":"Channel IDs","name":"channelIds","description":"Filter variants by channel IDs (comma-separated)."}
   * @paramDef {"type":"String","label":"Platform IDs","name":"platformIds","description":"Filter variants by external platform IDs (comma-separated)."}
   * @paramDef {"type":"String","label":"Legacy IDs","name":"legacyIds","description":"Filter by legacy product IDs (comma-separated)."}
   * @paramDef {"type":"String","label":"Sales Channel","name":"salesChannel","description":"Filter variants assigned to a specific platform or sales channel."}
   * @paramDef {"type":"String","label":"Product Type","name":"productType","description":"Filter products by type."}
   * @paramDef {"type":"String","label":"Variant Status","name":"variantStatus","description":"Filter products with variants containing the specified status."}
   * @paramDef {"type":"Boolean","label":"Has Variants","name":"hasVariants","uiComponent":{"type":"TOGGLE"},"description":"Filter products that have or do not have variants."}
   * @paramDef {"type":"Boolean","label":"Has Digital Variants","name":"hasDigitalVariants","uiComponent":{"type":"TOGGLE"},"description":"Filter products that have or do not have digital variants."}
   * @paramDef {"type":"Boolean","label":"On Hand","name":"onHand","uiComponent":{"type":"TOGGLE"},"description":"Filter products that have inventory on hand."}
   * @paramDef {"type":"Boolean","label":"Inventory Sync Enabled","name":"isInventorySyncEnabled","uiComponent":{"type":"TOGGLE"},"description":"Filter variants where inventory sync is enabled."}
   * @paramDef {"type":"Boolean","label":"Reviews Pending","name":"reviewsPending","uiComponent":{"type":"TOGGLE"},"description":"Filter products with pending reviews."}
   * @paramDef {"type":"String","label":"Updated Since","name":"lastUpdatedTimestamp","uiComponent":{"type":"DATE"},"description":"Filter products updated since this date and time."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","description":"Number of products per page (1-250). Default: 50."}
   * @paramDef {"type":"String","label":"Sort By","name":"sortBy","uiComponent":{"type":"DROPDOWN","options":{"values":["Id","Name","Category","TotalOnHandQty"]}},"description":"Field to sort results by."}
   * @paramDef {"type":"String","label":"Sort Order","name":"sortOrder","uiComponent":{"type":"DROPDOWN","options":{"values":["ASC","DESC"]}},"description":"Sort direction: ascending or descending."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":12345,"name":"Blue T-Shirt","type":"Regular","created_on":"2025-01-15T10:30:00Z","variants":[{"id":54321,"sku":"TShirtBlueM","name":"Medium","status":"Active","inventory":{"inventory_id":111,"on_hand_qty":150}}]},{"id":12346,"name":"Red Hoodie","type":"Regular","variants":[{"id":54322,"sku":"HoodieRedL","name":"Large","status":"Active","inventory":{"inventory_id":112,"on_hand_qty":75}}]}],"next":null,"prev":null}
   */
  async getProductsShipBob(search, name, sku, sellerSku, barcode, barcodes, productId, variantId, inventoryId, categoryIds, taxonomyIds, channelIds, platformIds, legacyIds, salesChannel, productType, variantStatus, hasVariants, hasDigitalVariants, onHand, isInventorySyncEnabled, reviewsPending, lastUpdatedTimestamp, pageSize, sortBy, sortOrder) {
    const boolToString = v => v === true ? 'true' : v === false ? 'false' : undefined

    return await this.#apiRequest({
      logTag: 'getProducts',
      url   : `${ API_BASE_URL }/product`,
      query : {
        Search                : search || undefined,
        Name                  : name || undefined,
        SKU                   : sku || undefined,
        SellerSKU             : sellerSku || undefined,
        Barcode               : barcode || undefined,
        Barcodes              : barcodes || undefined,
        ProductId             : productId || undefined,
        VariantId             : variantId || undefined,
        InventoryId           : inventoryId || undefined,
        CategoryIds           : categoryIds || undefined,
        TaxonomyIds           : taxonomyIds || undefined,
        ChannelIds            : channelIds || undefined,
        PlatformIds           : platformIds || undefined,
        LegacyIds             : legacyIds || undefined,
        SalesChannel          : salesChannel || undefined,
        ProductType           : productType || undefined,
        VariantStatus         : variantStatus || undefined,
        HasVariants           : boolToString(hasVariants),
        HasDigitalVariants    : boolToString(hasDigitalVariants),
        OnHand                : boolToString(onHand),
        IsInventorySyncEnabled: boolToString(isInventorySyncEnabled),
        ReviewsPending        : boolToString(reviewsPending),
        LastUpdatedTimestamp  : lastUpdatedTimestamp || undefined,
        PageSize              : pageSize || DEFAULT_PAGE_SIZE,
        SortBy                : sortBy || undefined,
        SortOrder             : sortOrder || undefined,
      },
    })
  }

  // ======================================= INVENTORY MANAGEMENT ======================================

  /**
   * @description Retrieves inventory items with stock levels, SKU details, and warehouse information. Supports filtering by active status and searching. Useful for monitoring stock levels and inventory health across fulfillment centers.
   *
   * @route POST /get-inventory
   * @operationName Get Inventory
   * @category Inventory Management
   * @appearanceColor #2D5BF6 #2D5BF6
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Search inventory items by name or SKU."}
   * @paramDef {"type":"Boolean","label":"Active Only","name":"isActive","uiComponent":{"type":"TOGGLE"},"description":"Filter to show only active inventory items."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","description":"Number of inventory items per page. Default: 50."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"inventory_id":111,"sku":"TShirtBlueM","name":"Medium Blue T-Shirt","is_case":false,"is_lot":false,"dimensions":{"length":12.0,"width":8.0,"height":1.0,"unit":"in"},"weight":{"value":8.0,"unit":"oz"}},{"inventory_id":112,"sku":"HoodieRedL","name":"Large Red Hoodie","is_case":false,"is_lot":false}],"next":null,"prev":null}
   */
  async getInventory(search, isActive, pageSize) {
    return await this.#apiRequest({
      logTag: 'getInventory',
      url   : `${ API_BASE_URL }/inventory`,
      query : {
        SearchBy: search || undefined,
        IsActive: isActive !== undefined && isActive !== null ? isActive : undefined,
        PageSize: pageSize || DEFAULT_PAGE_SIZE,
      },
    })
  }

  // ======================================= SHIPMENT TRACKING =========================================

  /**
   * @description Retrieves detailed shipment information including carrier tracking data, fulfillment status, delivery dates, package dimensions, and contents. Essential for providing customers with shipping updates and monitoring fulfillment progress.
   *
   * @route POST /get-shipment
   * @operationName Get Shipment
   * @category Shipment Tracking
   * @appearanceColor #2D5BF6 #2D5BF6
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"Number","label":"Shipment ID","name":"shipmentId","required":true,"description":"The unique ShipBob shipment ID to retrieve tracking and fulfillment details for."}
   *
   * @returns {Object}
   * @sampleResult {"id":67890,"order_id":12345,"status":"Completed","created_date":"2025-01-15T10:30:00Z","actual_fulfillment_date":"2025-01-16T08:00:00Z","delivery_date":"2025-01-20T14:30:00Z","location":{"id":1,"name":"Cicero (IL)"},"tracking":{"tracking_number":"1Z999AA10123456784","carrier":"UPS","carrier_service":"Ground","tracking_url":"https://www.ups.com/track?tracknum=1Z999AA10123456784","shipping_date":"2025-01-16T08:00:00Z"},"measurements":{"length_in":12,"width_in":8,"depth_in":4,"total_weight_oz":16},"products":[{"id":100,"sku":"TShirtBlueM","reference_id":"TShirtBlueM","quantity":2}]}
   */
  async getShipment(shipmentId) {
    if (!shipmentId) {
      throw new Error('"Shipment ID" is required')
    }

    return await this.#apiRequest({
      logTag: 'getShipment',
      url   : `${ API_BASE_URL }/shipment/${ shipmentId }`,
    })
  }

  // ======================================= RETURNS ===================================================

  /**
   * @description Creates a return order (RMA) in ShipBob for processing returned inventory. Specify the fulfillment center, inventory items with quantities, and the requested action for each item (Restock, Quarantine, or Dispose). Optionally link to the original shipment for tracking.
   *
   * @route POST /create-return
   * @operationName Create Return
   * @category Returns
   * @appearanceColor #2D5BF6 #2D5BF6
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Reference ID","name":"referenceId","required":true,"description":"Unique external reference ID for this return. Max 50 characters."}
   * @paramDef {"type":"String","label":"Fulfillment Center","name":"fulfillmentCenterId","required":true,"dictionary":"getLocationsDictionary","description":"The fulfillment center where the return will be processed."}
   * @paramDef {"type":"String","label":"Inventory Items JSON","name":"inventoryJson","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"JSON array of items to return. Each needs id (inventory ID), quantity, and requested_action (Default, Restock, Quarantine, Dispose). Example: [{\"id\":111,\"quantity\":1,\"requested_action\":\"Restock\"}]"}
   * @paramDef {"type":"Number","label":"Original Shipment ID","name":"originalShipmentId","description":"The original shipment ID this return is associated with."}
   * @paramDef {"type":"String","label":"Tracking Number","name":"trackingNumber","description":"Tracking number for the return shipment. Max 500 characters."}
   *
   * @returns {Object}
   * @sampleResult {"id":11111,"reference_id":"RET-001","status":"Awaiting","channel":{"id":100102,"name":"My Store"},"fulfillment_center":{"id":1,"name":"Cicero (IL)"},"inventory":[{"id":111,"name":"Blue T-Shirt","quantity":1,"action_requested":"Restock"}],"insert_date":"2025-01-22T10:00:00Z","tracking_number":"1Z999AA10123456784"}
   */
  async createReturn(referenceId, fulfillmentCenterId, inventoryJson, originalShipmentId, trackingNumber) {
    if (!referenceId) {
      throw new Error('"Reference ID" is required')
    }

    if (!fulfillmentCenterId) {
      throw new Error('"Fulfillment Center" is required')
    }

    if (!inventoryJson) {
      throw new Error('"Inventory Items JSON" is required')
    }

    let inventory

    try {
      inventory = typeof inventoryJson === 'string' ? JSON.parse(inventoryJson) : inventoryJson
    } catch (error) {
      throw new Error('"Inventory Items JSON" must be a valid JSON array')
    }

    const channelId = await this.#getChannelId()

    const body = cleanupObject({
      reference_id        : referenceId,
      fulfillment_center  : { id: parseInt(fulfillmentCenterId) },
      inventory,
      original_shipment_id: originalShipmentId || undefined,
      tracking_number     : trackingNumber || undefined,
    })

    return await this.#apiRequest({
      logTag: 'createReturn',
      method: 'post',
      url   : `${ API_BASE_URL }/return`,
      body,
      channelId,
    })
  }

  // ======================================= WAREHOUSE RECEIVING ========================================

  /**
   * @typedef {Object} WROBoxItem
   * @paramDef {"type":"Number","label":"Inventory ID","name":"inventory_id","required":true,"description":"The ShipBob inventory ID for this item. Must reference an existing inventory record."}
   * @paramDef {"type":"Number","label":"Quantity","name":"quantity","required":true,"description":"Number of units of this item in the box."}
   * @paramDef {"type":"String","label":"Lot Number","name":"lot_number","description":"Lot or batch number for lot-tracked inventory items."}
   * @paramDef {"type":"String","label":"Lot Date","name":"lot_date","uiComponent":{"type":"DATE_PICKER"},"description":"Expiration or manufacturing date for the lot."}
   */

  /**
   * @typedef {Object} WROBox
   * @paramDef {"type":"String","label":"Tracking Number","name":"tracking_number","required":true,"description":"Carrier tracking number for this box."}
   * @paramDef {"type":"Array.<WROBoxItem>","label":"Box Items","name":"box_items","required":true,"description":"List of inventory items and quantities contained in this box."}
   */

  /**
   * @description Creates a new Warehouse Receiving Order (WRO) to send inventory to a ShipBob fulfillment center. Specify the target fulfillment center, package type, box packaging configuration, expected arrival date, and boxes with their inventory items and quantities. Maximum 50 boxes per request for Package type.
   *
   * @route POST /create-wro
   * @operationName Create WRO
   * @category Warehouse Receiving
   * @appearanceColor #2D5BF6 #2D5BF6
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Fulfillment Center","name":"fulfillmentCenterId","required":true,"dictionary":"getFulfillmentCentersDictionary","description":"The fulfillment center where inventory will be received."}
   * @paramDef {"type":"String","label":"Package Type","name":"packageType","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Package","Pallet","FloorLoadedContainer"]}},"description":"Type of package being sent: Package (standard boxes, max 50), Pallet, or FloorLoadedContainer."}
   * @paramDef {"type":"String","label":"Box Packaging Type","name":"boxPackagingType","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["EverythingInOneBox","OneSkuPerBox","MultipleSkuPerBox"]}},"description":"How items are packed: EverythingInOneBox (all SKUs in one box), OneSkuPerBox (each SKU in its own box), or MultipleSkuPerBox (mixed SKUs per box)."}
   * @paramDef {"type":"String","label":"Expected Arrival Date","name":"expectedArrivalDate","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"Expected date that all packages will arrive at the fulfillment center. Must be a future date."}
   * @paramDef {"type":"Array.<WROBox>","label":"Boxes","name":"boxes","required":true,"description":"List of boxes to include in this WRO. Each box must have a tracking number and at least one inventory item with quantity."}
   * @paramDef {"type":"String","label":"Purchase Order Number","name":"purchaseOrderNumber","description":"Optional purchase order number for internal reference tracking."}
   *
   * @returns {Object}
   * @sampleResult {"id":987654,"status":"Awaiting","package_type":"Package","box_packaging_type":"EverythingInOneBox","expected_arrival_date":"2025-01-15T00:00:00+00:00","purchase_order_number":"PO-2026-001","box_labels_uri":"/2026-01/receiving/987654/labels","fulfillment_center":{"id":10,"name":"Cicero (IL)"},"inventory_quantities":[{"inventory_id":12345678,"sku":"light-roast","expected_quantity":50,"received_quantity":0,"stowed_quantity":0}]}
   */
  async createWRO(fulfillmentCenterId, packageType, boxPackagingType, expectedArrivalDate, boxes, purchaseOrderNumber) {
    if (!fulfillmentCenterId) {
      throw new Error('"Fulfillment Center" is required')
    }

    if (!expectedArrivalDate) {
      throw new Error('"Expected Arrival Date" is required')
    }

    if (!boxes || !Array.isArray(boxes) || boxes.length === 0) {
      throw new Error('"Boxes" is required and must be a non-empty array')
    }

    boxes = boxes.map((box, i) => {
      logger.debug(`createWRO - box[${ i }] type=${ typeof box } value=${ JSON.stringify(box) }`)

      return typeof box === 'string' ? JSON.parse(box) : box
    })

    const body = cleanupObject({
      fulfillment_center   : { id: parseInt(fulfillmentCenterId) },
      package_type         : packageType || 'Package',
      box_packaging_type   : boxPackagingType || 'EverythingInOneBox',
      expected_arrival_date: new Date(Number(expectedArrivalDate) || expectedArrivalDate).toISOString(),
      boxes,
      purchase_order_number: purchaseOrderNumber || undefined,
    })

    logger.debug(`createWRO - request body: ${ JSON.stringify(body, null, 2) }`)

    return await this.#apiRequest({
      logTag: 'createWRO',
      method: 'post',
      url   : `${ API_BASE_URL }/receiving`,
      body,
    })
  }

  /**
   * @description Retrieves a list of Warehouse Receiving Orders with optional filtering by status, date range, fulfillment center, and external sync flag. Supports pagination. Useful for monitoring inbound shipments and inventory receiving progress.
   *
   * @route POST /get-wros
   * @operationName Get WROs
   * @category Warehouse Receiving
   * @appearanceColor #2D5BF6 #2D5BF6
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Statuses","name":"statuses","description":"Comma-separated list of statuses to filter by. Values: Awaiting, Processing, Completed, Cancelled, Incomplete, Arrived, PartiallyArrived."}
   * @paramDef {"type":"String","label":"Insert Start Date","name":"insertStartDate","uiComponent":{"type":"DATE_PICKER"},"description":"Filter WROs created on or after this date."}
   * @paramDef {"type":"String","label":"Insert End Date","name":"insertEndDate","uiComponent":{"type":"DATE_PICKER"},"description":"Filter WROs created on or before this date."}
   * @paramDef {"type":"Boolean","label":"External Sync","name":"externalSync","uiComponent":{"type":"TOGGLE"},"description":"Filter by external sync flag. Use false to find WROs not yet synced to your system."}
   * @paramDef {"type":"Number","label":"Page","name":"page","description":"Page number for pagination starting at 1."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","description":"Number of WROs per page. Default: 50."}
   *
   * @returns {Array}
   * @sampleResult [{"id":987654,"status":"Awaiting","package_type":"Package","box_packaging_type":"EverythingInOneBox","expected_arrival_date":"2025-01-15T00:00:00Z","purchase_order_number":"PO-2026-001","fulfillment_center":{"id":10,"name":"Cicero (IL)"},"inventory_quantities":[{"inventory_id":12345,"sku":"TShirtBlueM","expected_quantity":50,"received_quantity":0,"stowed_quantity":0}]},{"id":987655,"status":"Completed","package_type":"Package","box_packaging_type":"OneSkuPerBox","expected_arrival_date":"2025-01-10T00:00:00Z","fulfillment_center":{"id":10,"name":"Cicero (IL)"},"inventory_quantities":[{"inventory_id":12346,"sku":"HoodieRedL","expected_quantity":100,"received_quantity":100,"stowed_quantity":98}]}]
   */
  async getWROs(statuses, insertStartDate, insertEndDate, externalSync, page, limit) {
    return await this.#apiRequest({
      logTag: 'getWROs',
      url   : `${ API_BASE_URL }/receiving`,
      query : {
        Statuses       : statuses || undefined,
        InsertStartDate: insertStartDate || undefined,
        InsertEndDate  : insertEndDate || undefined,
        ExternalSync   : externalSync !== undefined && externalSync !== null ? externalSync : undefined,
        Page           : page || 1,
        Limit          : limit || DEFAULT_PAGE_SIZE,
      },
    })
  }

  /**
   * @description Retrieves details of a specific Warehouse Receiving Order by its ID, including current status, fulfillment center, inventory quantities with expected/received/stowed counts, and status history. Essential for tracking inbound shipment progress.
   *
   * @route POST /get-wro
   * @operationName Get WRO
   * @category Warehouse Receiving
   * @appearanceColor #2D5BF6 #2D5BF6
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"Number","label":"WRO ID","name":"wroId","required":true,"description":"The unique Warehouse Receiving Order ID to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":987654,"status":"Processing","package_type":"Package","box_packaging_type":"EverythingInOneBox","expected_arrival_date":"2025-01-15T00:00:00Z","purchase_order_number":"PO-2026-001","box_labels_uri":"https://api.shipbob.com/2026-01/receiving/987654/labels","fulfillment_center":{"id":10,"name":"Cicero (IL)","address1":"5900 W Ogden Ave","city":"Cicero","state":"IL","zip_code":"60804","country":"USA"},"inventory_quantities":[{"inventory_id":12345678,"sku":"light-roast","expected_quantity":50,"received_quantity":50,"stowed_quantity":48}],"status_history":[{"id":1,"status":"Awaiting","timestamp":"2025-01-10T10:00:00Z"},{"id":2,"status":"Arrived","timestamp":"2025-01-15T08:00:00Z"},{"id":3,"status":"Processing","timestamp":"2025-01-15T09:00:00Z"}]}
   */
  async getWRO(wroId) {
    if (!wroId) {
      throw new Error('"WRO ID" is required')
    }

    return await this.#apiRequest({
      logTag: 'getWRO',
      url   : `${ API_BASE_URL }/receiving/${ wroId }`,
    })
  }

  /**
   * @description Retrieves all available ShipBob fulfillment centers with their addresses, contact information, and timezone details. Use this to identify valid fulfillment center IDs for creating Warehouse Receiving Orders.
   *
   * @route POST /get-fulfillment-centers
   * @operationName Get Fulfillment Centers
   * @category Warehouse Receiving
   * @appearanceColor #2D5BF6 #2D5BF6
   * @executionTimeoutInSeconds 120
   *
   * @returns {Array}
   * @sampleResult [{"id":1,"name":"Cicero (IL)","address1":"5900 W Ogden Ave","address2":"Suite 100","city":"Cicero","state":"IL","zip_code":"60804","country":"USA","timezone":"Central Standard Time","email":"example@example.com","phone_number":"555-555-5555"},{"id":2,"name":"Moreno Valley (CA)","address1":"15500 Park Ave","city":"Moreno Valley","state":"CA","zip_code":"92551","country":"USA","timezone":"Pacific Standard Time"}]
   */
  async getFulfillmentCenters() {
    return await this.#apiRequest({
      logTag: 'getFulfillmentCenters',
      url   : `${ API_BASE_URL }/fulfillment-center`,
    })
  }

  /**
   * @description Retrieves all boxes and their contents for a specific Warehouse Receiving Order. Each box includes its status, tracking number, arrival/receiving dates, and a detailed list of items with expected, received, and stowed quantities.
   *
   * @route POST /get-wro-boxes
   * @operationName Get WRO Boxes
   * @category Warehouse Receiving
   * @appearanceColor #2D5BF6 #2D5BF6
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"Number","label":"WRO ID","name":"wroId","required":true,"description":"The unique Warehouse Receiving Order ID to retrieve boxes for."}
   *
   * @returns {Array}
   * @sampleResult [{"box_id":111,"box_number":1,"box_status":"Completed","tracking_number":"1Z999AA10123456784","arrived_date":"2025-01-15T08:00:00Z","received_date":"2025-01-15T10:00:00Z","counting_started_date":"2025-01-15T09:00:00Z","box_items":[{"inventory_id":12345678,"quantity":50,"received_quantity":50,"stowed_quantity":48,"lot_number":"LOT-2222","lot_date":"2025-06-15T00:00:00Z"}]}]
   */
  async getWROBoxes(wroId) {
    if (!wroId) {
      throw new Error('"WRO ID" is required')
    }

    return await this.#apiRequest({
      logTag: 'getWROBoxes',
      url   : `${ API_BASE_URL }/receiving/${ wroId }/boxes`,
    })
  }

  /**
   * @description Downloads the box labels PDF for a specific Warehouse Receiving Order. Labels should be printed and attached to each box before shipping to the fulfillment center to help warehouse staff identify your shipment. Returns base64-encoded PDF content.
   *
   * @route POST /get-wro-box-labels
   * @operationName Get WRO Box Labels
   * @category Warehouse Receiving
   * @appearanceColor #2D5BF6 #2D5BF6
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"Number","label":"WRO ID","name":"wroId","required":true,"description":"The unique Warehouse Receiving Order ID to retrieve box labels for."}
   *
   * @returns {String}
   * @sampleResult "JVBERi0xLjQKMSAwIG9iago8PAovVHlwZSAvQ2F0YWxvZwovUGFnZXMgMiAwIFIKPj4KZW5kb2Jq..."
   */
  async getWROBoxLabels(wroId) {
    if (!wroId) {
      throw new Error('"WRO ID" is required')
    }

    return await this.#apiRequest({
      logTag: 'getWROBoxLabels',
      url   : `${ API_BASE_URL }/receiving/${ wroId }/labels`,
    })
  }

  /**
   * @description Cancels a Warehouse Receiving Order. Only WROs in "Awaiting" status can be cancelled. Once a WRO has arrived at or is being processed by the fulfillment center, it cannot be cancelled.
   *
   * @route POST /cancel-wro
   * @operationName Cancel WRO
   * @category Warehouse Receiving
   * @appearanceColor #2D5BF6 #2D5BF6
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"Number","label":"WRO ID","name":"wroId","required":true,"description":"The unique Warehouse Receiving Order ID to cancel. The WRO must be in Awaiting status."}
   *
   * @returns {Object}
   * @sampleResult {"id":987654,"status":"Cancelled","package_type":"Package","box_packaging_type":"EverythingInOneBox","expected_arrival_date":"2025-01-15T00:00:00Z","purchase_order_number":"PO-2026-001","fulfillment_center":{"id":10,"name":"Cicero (IL)"},"inventory_quantities":[{"inventory_id":12345678,"sku":"light-roast","expected_quantity":50,"received_quantity":0,"stowed_quantity":0}],"status_history":[{"id":1,"status":"Awaiting","timestamp":"2025-01-10T10:00:00Z"},{"id":2,"status":"Cancelled","timestamp":"2025-01-12T14:00:00Z"}]}
   */
  async cancelWRO(wroId) {
    if (!wroId) {
      throw new Error('"WRO ID" is required')
    }

    return await this.#apiRequest({
      logTag: 'cancelWRO',
      method: 'post',
      url   : `${ API_BASE_URL }/receiving/${ wroId }:cancel`,
    })
  }

  /**
   * @description Sets or clears the external sync flag on one or more Warehouse Receiving Orders. Use this to mark WROs as synced after processing them in your system, allowing you to filter for unsynced WROs on subsequent polling requests.
   *
   * @route POST /set-wro-external-sync
   * @operationName Set WRO External Sync
   * @category Warehouse Receiving
   * @appearanceColor #2D5BF6 #2D5BF6
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"WRO IDs JSON","name":"wroIdsJson","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"JSON array of Warehouse Receiving Order IDs to update. Example: [987654, 987655]"}
   * @paramDef {"type":"Boolean","label":"Is External Sync","name":"isExternalSync","required":true,"uiComponent":{"type":"TOGGLE"},"description":"Set to true to mark WROs as externally synced, or false to clear the sync flag."}
   *
   * @returns {Object}
   * @sampleResult {"id":987654,"status":"Completed","package_type":"Package","box_packaging_type":"EverythingInOneBox","expected_arrival_date":"2025-01-15T00:00:00Z","external_sync_timestamp":"2025-01-20T10:30:00Z","fulfillment_center":{"id":10,"name":"Cicero (IL)"},"inventory_quantities":[{"inventory_id":12345678,"sku":"light-roast","expected_quantity":50,"received_quantity":50,"stowed_quantity":48}]}
   */
  async setWROExternalSync(wroIdsJson, isExternalSync) {
    if (!wroIdsJson) {
      throw new Error('"WRO IDs JSON" is required')
    }

    let ids

    try {
      ids = typeof wroIdsJson === 'string' ? JSON.parse(wroIdsJson) : wroIdsJson
    } catch (error) {
      throw new Error('"WRO IDs JSON" must be a valid JSON array')
    }

    return await this.#apiRequest({
      logTag: 'setWROExternalSync',
      method: 'post',
      url   : `${ API_BASE_URL }/receiving:setExternalSync`,
      body  : {
        ids,
        is_external_sync: isExternalSync === true || isExternalSync === 'true',
      },
    })
  }
}

Flowrunner.ServerCode.addService(ShipBobService, [
  {
    displayName : 'Personal Access Token',
    defaultValue: '',
    name        : 'apiToken',
    type        : Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required    : true,
    shared      : false,
    hint        : 'Your Personal Access Token (PAT) from the ShipBob Developer Dashboard (Settings > API Tokens)',
  },
  {
    displayName : 'Client ID',
    defaultValue: '',
    name        : 'clientId',
    type        : Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required    : true,
    shared      : true,
    hint        : 'Client ID when using with OAuth2 flow.',
  },
  {
    displayName : 'Client Secret',
    defaultValue: '',
    name        : 'clientSecret',
    type        : Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required    : true,
    shared      : true,
    hint        : 'Client Secret from the ShipBob Developer Dashboard (Settings > API Tokens). Required if using OAuth2 flow. Not needed if using Personal Access Token (PAT) for authentication.',
  },
])

function cleanupObject(data) {
  const result = {}

  Object.keys(data).forEach(key => {
    if (data[key] !== undefined && data[key] !== null) {
      result[key] = data[key]
    }
  })

  return result
}

function searchFilter(list, props, searchString) {
  return list.filter(item =>
    props.some(prop => {
      const value = prop.split('.').reduce((acc, key) => acc?.[key], item)

      return value && String(value).toLowerCase().includes(searchString.toLowerCase())
    }),
  )
}

function extractCursor(nextUrl) {
  if (!nextUrl) return null

  try {
    const url = new URL(nextUrl)

    return url.searchParams.get('Cursor') || url.searchParams.get('cursor') || null
  } catch {
    return null
  }
}
