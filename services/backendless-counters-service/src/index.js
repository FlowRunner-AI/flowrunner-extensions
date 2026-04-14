const { createClient } = require('backendless-console-sdk')
const Backendless = require('backendless')

const ClustersHosts = {
  'US': 'https://develop.backendless.com',
  'Europe': 'https://eu-develop.backendless.com',
  'Stage(SHOULD_NOT_BE_IN_PROD)': 'https://stage.backendless.com',
  'DevTest(SHOULD_NOT_BE_IN_PROD)': 'https://devtest.backendless.com',
  'Local(SHOULD_NOT_BE_IN_PROD)': 'http://localhost:3001',
}

const logger = {
  info: (...args) => console.log('[Backendless Counters Service] info:', ...args),
  debug: (...args) => console.log('[Backendless Counters Service] debug:', ...args),
  error: (...args) => console.log('[Backendless Counters Service] error:', ...args),
  warn: (...args) => console.log('[Backendless Counters Service] warn:', ...args),
}

const EventTypes = {
  onCounterReset: 'RESET',
  onCounterGetAndIncrement: 'GET_AND_INCREMENT',
  onCounterIncrementAndGet: 'INCREMENT_AND_GET',
  onCounterGetAndDecrement: 'GET_AND_DECREMENT',
  onCounterDecrementAndGet: 'DECREMENT_AND_GET',
  onCounterAddAndGet: 'ADD_AND_GET',
  onCounterGetAndAdd: 'GET_AND_ADD',
  onCounterCompareAndSet: 'COMPARE_AND_SET',
}

const MethodTypes = Object.keys(EventTypes).reduce((acc, key) => ((acc[EventTypes[key]] = key), acc), {})

const MethodCallTypes = {
  SHAPE_EVENT: 'SHAPE_EVENT',
  FILTER_TRIGGER: 'FILTER_TRIGGER',
}

/**
 *  @requireOAuth
 *  @integrationName Backendless Counters Service
 *  @integrationTriggersScope SINGLE_APP
 *  @integrationIcon /icon.png
 **/
class BackendlessCountersService {
  constructor(config) {
    this.clusterURL = config.clusterConsoleURL || ClustersHosts[config.clusterKey] || ClustersHosts['DevTest(SHOULD_NOT_BE_IN_PROD)']

    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
    this.scope = ''
  }

  async #getApiSdk(appId, apiKey) {
    if (!this.apiSDK) {
      const client = this.#getClient()

      const { apiURL: serverURL } = await client.system.loadStatus()

      if (!apiKey) {
        const appSettings = await client.settings.getAppSettings(appId)

        apiKey = appSettings.apiKeysMap.REST
      }

      this.apiSDK = Backendless.initApp({
        appId,
        apiKey,
        serverURL,
        standalone: true,
      })
    }

    return this.apiSDK
  }

  #getAccessToken() {
    return this.request.headers['oauth-access-token']
  }

  #getAccessTokenHeader(accessToken) {
    logger.debug(`[#getAccessTokenHeader] accessToken=${ accessToken }`)

    return {
      'auth-key': accessToken,
      // Authorization: `Bearer ${ accessToken }`,
    }
  }

  #getSecretTokenHeader() {
    const token = Buffer.from(`${ this.clientId }:${ this.clientSecret }`).toString('base64')

    return {
      Authorization: `Basic ${ token }`,
    }
  }

  #getClient() {
    return createClient(this.clusterURL, this.#getAccessToken())
  }

  /**
   * @registerAs SYSTEM
   * @route GET /getOAuth2ConnectionURL
   */
  async getOAuth2ConnectionURL() {
    const params = new URLSearchParams()

    params.append('client_id', this.clientId)
    params.append('response_type', 'code')
    params.append('scope', this.scope)

    return `${ this.clusterURL }/developer/oauth2/authorize?${ params.toString() }`
  }

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
    params.append('scope', this.scope)

    try {
      const response = await Flowrunner.Request.post(`${ this.clusterURL }/developer/oauth2/token`)
        .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        .set(this.#getSecretTokenHeader())
        .send(params.toString())

      return {
        token: response.access_token,
        expirationInSeconds: response.expires_in,
        refreshToken: response.refresh_token || refreshToken,
      }
    } catch (error) {
      logger.error('Error refreshing token: ', error.message || error)

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
    const params = new URLSearchParams()
    params.append('grant_type', 'authorization_code')
    params.append('redirect_uri', callbackObject.redirectURI)
    params.append('code', callbackObject.code)

    const { expires_in, access_token, refresh_token } = await Flowrunner.Request
      .post(`${ this.clusterURL }/developer/oauth2/token`)
      .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
      .set(this.#getSecretTokenHeader())
      .send(params.toString())

    let userInfo = {}

    try {
      userInfo = await Flowrunner.Request
        .get(`${ this.clusterURL }/console/home/myaccount`)
        .set(this.#getAccessTokenHeader(access_token))

      logger.debug(`[executeCallback] userInfo response: ${ JSON.stringify(userInfo, null, 2) }`)
    } catch (error) {
      logger.error(`[executeCallback] userInfo error: ${ JSON.stringify(error, null, 2) }`)

      return {}
    }

    return {
      token: access_token,
      refreshToken: refresh_token,
      expirationInSeconds: expires_in,
      overwrite: true,
      connectionIdentityName: `${ userInfo.name } (${ userInfo.email })`,
      connectionIdentityImageURL: null,
    }
  }

  // ======================================= TRIGGERS ========================================

  async #createWebhook(invocation) {
    logger.debug(`createWebhook: ${ JSON.stringify(invocation) }`)

    const client = this.#getClient()

    const appId = invocation.events[0].triggerData.appId
    logger.debug(`appId: ${ appId }`)

    const eventsMap = new Map()

    invocation.events.forEach(event => {
      const operation = EventTypes[event.name]

      if (!eventsMap.has(operation)) {
        eventsMap.set(operation, {
          service: 'ATOMIC_OPERATIONS',
          operation,
          enabledForConsole: true,
        })
      }
    })

    const events = Array.from(eventsMap.values())
    logger.debug(`events: ${ JSON.stringify(events) }`)

    const response = await client.webhooks.saveWebhook(appId, {
      url: invocation.callbackUrl,
      enabledOperations: events,
    })

    logger.debug(`response: ${ JSON.stringify(response) }`)

    return { ...response, appId }
  }

  async #deleteWebhook(invocation) {
    logger.debug(`deleteWebhook: ${ JSON.stringify(invocation) }`)

    const client = this.#getClient()

    const { id: webhookId, appId } = invocation.webhookData
    logger.debug(`appId, webhookId: ${ JSON.stringify({ appId, webhookId }) }`)

    const deleted = await client.webhooks.deleteWebhook(appId, webhookId)
    logger.debug(`deleted: ${ JSON.stringify(deleted) }`)

    return deleted
  }

  async #getWebhook(invocation) {
    if (invocation.webhookData) {
      await this.#deleteWebhook(invocation)
    }

    return this.#createWebhook(invocation)
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerUpsertWebhook(invocation) {
    logger.debug(`handleTriggerUpsertWebhook: ${ JSON.stringify(invocation) }`)

    const webhookData = await this.#getWebhook(invocation)
    logger.debug(`webhookData: ${ JSON.stringify(webhookData) }`)

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
    logger.debug(`handleTriggerResolveEvents: ${ JSON.stringify(invocation) }`)

    const methodName = MethodTypes[invocation.body.operation]
    logger.debug(`methodName: ${ JSON.stringify(methodName) }`)

    if (!methodName) {
      return null
    }

    const events = await this[methodName](MethodCallTypes.SHAPE_EVENT, invocation.body)
    logger.debug(`events: ${ JSON.stringify(events) }`)

    return {
      events,
      connectionId: invocation.queryParams.connectionId,
    }
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerSelectMatched(invocation) {
    logger.debug(`handleTriggerSelectMatched: ${ JSON.stringify(invocation) }`)

    const data = await this[invocation.eventName](MethodCallTypes.FILTER_TRIGGER, invocation)
    logger.debug(`triggers: ${ JSON.stringify(data) }`)

    return data
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation"}
   */
  async handleTriggerDeleteWebhook(invocation) {
    logger.debug(`handleTriggerDeleteWebhook: ${ JSON.stringify(invocation) }`)

    await this.#deleteWebhook(invocation)
  }

  /**
   * @operationName Counter: Reset
   * @category Counter Events
   * @description Triggers when a counter is reset to zero in Backendless, enabling AI agents to track counter resets, log reset events, or trigger workflows based on counter reset operations.
   * @registerAs REALTIME_TRIGGER
   *
   * @route POST /on-counter-reset
   * @appearanceColor #F4C3C5 #ED797E
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"App","name":"appId","required":true,"dictionary":"getAppsDictionary","description":"Select the Backendless application to monitor for counter reset events."}
   * @paramDef {"type":"String","label":"Counter","name":"counter","required":true,"dictionary":"getCounterNamesDictionary","dependsOn":["appId"],"description":"..."}
   *
   * @returns {Object}
   * @sampleResult {"counterName":"pageViews","value":0,"timestamp":1756287035184}
   */
  onCounterReset(callType, payload) {
    logger.debug(`onCounterReset: ${ JSON.stringify({ callType, payload }) }`)

    if (callType === MethodCallTypes.SHAPE_EVENT) {
      return [
        {
          name: 'onCounterReset',
          data: payload,
        },
      ]
    }

    if (callType === MethodCallTypes.FILTER_TRIGGER) {
      const eventData = payload.eventData
      const triggers = payload.triggers

      const ids = triggers
        .filter(trigger => trigger.data.counter === eventData.counterName)
        .map(trigger => trigger.id)

      logger.debug(`onCounterReset.triggersIdsToActivate: ${ JSON.stringify(ids) }`)

      return { ids }
    }
  }

  /**
   * @operationName Counter: Get And Increment
   * @category Counter Events
   * @description Triggers when a counter value is retrieved and then incremented in Backendless, enabling AI agents to track counter reads with increments, monitor usage patterns, or trigger workflows based on get-and-increment operations.
   * @registerAs REALTIME_TRIGGER
   *
   * @route POST /on-counter-get-and-increment
   * @appearanceColor #F4C3C5 #ED797E
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"App","name":"appId","required":true,"dictionary":"getAppsDictionary","description":"Select the Backendless application to monitor for counter get-and-increment events."}
   * @paramDef {"type":"String","label":"Counter","name":"counter","required":true,"dictionary":"getCounterNamesDictionary","dependsOn":["appId"],"description":"..."}
   *
   * @returns {Object}
   * @sampleResult {"counterName":"pageViews","previousValue":42,"newValue":43,"timestamp":1756287035184}
   */
  onCounterGetAndIncrement(callType, payload) {
    logger.debug(`onCounterGetAndIncrement: ${ JSON.stringify({ callType, payload }) }`)

    if (callType === MethodCallTypes.SHAPE_EVENT) {
      return [
        {
          name: 'onCounterGetAndIncrement',
          data: payload,
        },
      ]
    }

    if (callType === MethodCallTypes.FILTER_TRIGGER) {
      const eventData = payload.eventData
      const triggers = payload.triggers

      const ids = triggers
        .filter(trigger => trigger.data.counter === eventData.counterName)
        .map(trigger => trigger.id)

      logger.debug(`onCounterGetAndIncrement.triggersIdsToActivate: ${ JSON.stringify(ids) }`)

      return { ids }
    }
  }

  /**
   * @operationName Counter: Increment And Get
   * @category Counter Events
   * @description Triggers when a counter is incremented and then the new value is retrieved in Backendless, enabling AI agents to track counter increments, monitor growth patterns, or trigger workflows based on increment-and-get operations.
   * @registerAs REALTIME_TRIGGER
   *
   * @route POST /on-counter-increment-and-get
   * @appearanceColor #F4C3C5 #ED797E
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"App","name":"appId","required":true,"dictionary":"getAppsDictionary","description":"Select the Backendless application to monitor for counter increment-and-get events."}
   * @paramDef {"type":"String","label":"Counter","name":"counter","required":true,"dictionary":"getCounterNamesDictionary","dependsOn":["appId"],"description":"..."}
   *
   * @returns {Object}
   * @sampleResult {"counterName":"pageViews","previousValue":42,"newValue":43,"timestamp":1756287035184}
   */
  onCounterIncrementAndGet(callType, payload) {
    logger.debug(`onCounterIncrementAndGet: ${ JSON.stringify({ callType, payload }) }`)

    if (callType === MethodCallTypes.SHAPE_EVENT) {
      return [
        {
          name: 'onCounterIncrementAndGet',
          data: payload,
        },
      ]
    }

    if (callType === MethodCallTypes.FILTER_TRIGGER) {
      const eventData = payload.eventData
      const triggers = payload.triggers

      const ids = triggers
        .filter(trigger => trigger.data.counter === eventData.counterName)
        .map(trigger => trigger.id)

      logger.debug(`onCounterIncrementAndGet.triggersIdsToActivate: ${ JSON.stringify(ids) }`)

      return { ids }
    }
  }

  /**
   * @operationName Counter: Get And Decrement
   * @category Counter Events
   * @description Triggers when a counter value is retrieved and then decremented in Backendless, enabling AI agents to track counter reads with decrements, monitor usage patterns, or trigger workflows based on get-and-decrement operations.
   * @registerAs REALTIME_TRIGGER
   *
   * @route POST /on-counter-get-and-decrement
   * @appearanceColor #F4C3C5 #ED797E
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"App","name":"appId","required":true,"dictionary":"getAppsDictionary","description":"Select the Backendless application to monitor for counter get-and-decrement events."}
   * @paramDef {"type":"String","label":"Counter","name":"counter","required":true,"dictionary":"getCounterNamesDictionary","dependsOn":["appId"],"description":"..."}
   *
   * @returns {Object}
   * @sampleResult {"counterName":"itemsLeft","previousValue":10,"newValue":9,"timestamp":1756287035184}
   */
  onCounterGetAndDecrement(callType, payload) {
    logger.debug(`onCounterGetAndDecrement: ${ JSON.stringify({ callType, payload }) }`)

    if (callType === MethodCallTypes.SHAPE_EVENT) {
      return [
        {
          name: 'onCounterGetAndDecrement',
          data: payload,
        },
      ]
    }

    if (callType === MethodCallTypes.FILTER_TRIGGER) {
      const eventData = payload.eventData
      const triggers = payload.triggers

      const ids = triggers
        .filter(trigger => trigger.data.counter === eventData.counterName)
        .map(trigger => trigger.id)

      logger.debug(`onCounterGetAndDecrement.triggersIdsToActivate: ${ JSON.stringify(ids) }`)

      return { ids }
    }
  }

  /**
   * @operationName Counter: Decrement And Get
   * @category Counter Events
   * @description Triggers when a counter is decremented and then the new value is retrieved in Backendless, enabling AI agents to track counter decrements, monitor reduction patterns, or trigger workflows based on decrement-and-get operations.
   * @registerAs REALTIME_TRIGGER
   *
   * @route POST /on-counter-decrement-and-get
   * @appearanceColor #F4C3C5 #ED797E
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"App","name":"appId","required":true,"dictionary":"getAppsDictionary","description":"Select the Backendless application to monitor for counter decrement-and-get events."}
   * @paramDef {"type":"String","label":"Counter","name":"counter","required":true,"dictionary":"getCounterNamesDictionary","dependsOn":["appId"],"description":"..."}
   *
   * @returns {Object}
   * @sampleResult {"counterName":"itemsLeft","previousValue":10,"newValue":9,"timestamp":1756287035184}
   */
  onCounterDecrementAndGet(callType, payload) {
    logger.debug(`onCounterDecrementAndGet: ${ JSON.stringify({ callType, payload }) }`)

    if (callType === MethodCallTypes.SHAPE_EVENT) {
      return [
        {
          name: 'onCounterDecrementAndGet',
          data: payload,
        },
      ]
    }

    if (callType === MethodCallTypes.FILTER_TRIGGER) {
      const eventData = payload.eventData
      const triggers = payload.triggers

      const ids = triggers
        .filter(trigger => trigger.data.counter === eventData.counterName)
        .map(trigger => trigger.id)

      logger.debug(`onCounterDecrementAndGet.triggersIdsToActivate: ${ JSON.stringify(ids) }`)

      return { ids }
    }
  }

  /**
   * @operationName Counter: Add And Get
   * @category Counter Events
   * @description Triggers when a value is added to a counter and then the new value is retrieved in Backendless, enabling AI agents to track counter additions, monitor accumulation patterns, or trigger workflows based on add-and-get operations.
   * @registerAs REALTIME_TRIGGER
   *
   * @route POST /on-counter-add-and-get
   * @appearanceColor #F4C3C5 #ED797E
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"App","name":"appId","required":true,"dictionary":"getAppsDictionary","description":"Select the Backendless application to monitor for counter add-and-get events."}
   * @paramDef {"type":"String","label":"Counter","name":"counter","required":true,"dictionary":"getCounterNamesDictionary","dependsOn":["appId"],"description":"..."}
   *
   * @returns {Object}
   * @sampleResult {"counterName":"totalPoints","addedValue":5,"previousValue":100,"newValue":105,"timestamp":1756287035184}
   */
  onCounterAddAndGet(callType, payload) {
    logger.debug(`onCounterAddAndGet: ${ JSON.stringify({ callType, payload }) }`)

    if (callType === MethodCallTypes.SHAPE_EVENT) {
      return [
        {
          name: 'onCounterAddAndGet',
          data: payload,
        },
      ]
    }

    if (callType === MethodCallTypes.FILTER_TRIGGER) {
      const eventData = payload.eventData
      const triggers = payload.triggers

      const ids = triggers
        .filter(trigger => trigger.data.counter === eventData.counterName)
        .map(trigger => trigger.id)

      logger.debug(`onCounterAddAndGet.triggersIdsToActivate: ${ JSON.stringify(ids) }`)

      return { ids }
    }
  }

  /**
   * @operationName Counter: Get And Add
   * @category Counter Events
   * @description Triggers when a counter value is retrieved and then a value is added to it in Backendless, enabling AI agents to track counter reads with additions, monitor usage patterns, or trigger workflows based on get-and-add operations.
   * @registerAs REALTIME_TRIGGER
   *
   * @route POST /on-counter-get-and-add
   * @appearanceColor #F4C3C5 #ED797E
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"App","name":"appId","required":true,"dictionary":"getAppsDictionary","description":"Select the Backendless application to monitor for counter get-and-add events."}
   * @paramDef {"type":"String","label":"Counter","name":"counter","required":true,"dictionary":"getCounterNamesDictionary","dependsOn":["appId"],"description":"..."}
   *
   * @returns {Object}
   * @sampleResult {"counterName":"totalPoints","addedValue":5,"previousValue":100,"newValue":105,"timestamp":1756287035184}
   */
  onCounterGetAndAdd(callType, payload) {
    logger.debug(`onCounterGetAndAdd: ${ JSON.stringify({ callType, payload }) }`)

    if (callType === MethodCallTypes.SHAPE_EVENT) {
      return [
        {
          name: 'onCounterGetAndAdd',
          data: payload,
        },
      ]
    }

    if (callType === MethodCallTypes.FILTER_TRIGGER) {
      const eventData = payload.eventData
      const triggers = payload.triggers

      const ids = triggers
        .filter(trigger => trigger.data.counter === eventData.counterName)
        .map(trigger => trigger.id)

      logger.debug(`onCounterGetAndAdd.triggersIdsToActivate: ${ JSON.stringify(ids) }`)

      return { ids }
    }
  }

  /**
   * @operationName Counter: Compare And Set
   * @category Counter Events
   * @description Triggers when a counter value is compared and conditionally set in Backendless, enabling AI agents to track atomic compare-and-set operations, monitor state changes, or trigger workflows based on conditional counter updates.
   * @registerAs REALTIME_TRIGGER
   *
   * @route POST /on-counter-compare-and-set
   * @appearanceColor #F4C3C5 #ED797E
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"App","name":"appId","required":true,"dictionary":"getAppsDictionary","description":"Select the Backendless application to monitor for counter compare-and-set events."}
   * @paramDef {"type":"String","label":"Counter","name":"counter","required":true,"dictionary":"getCounterNamesDictionary","dependsOn":["appId"],"description":"..."}
   *
   * @returns {Object}
   * @sampleResult {"counterName":"lockStatus","expectedValue":0,"newValue":1,"success":true,"timestamp":1756287035184}
   */
  onCounterCompareAndSet(callType, payload) {
    logger.debug(`onCounterCompareAndSet: ${ JSON.stringify({ callType, payload }) }`)

    if (callType === MethodCallTypes.SHAPE_EVENT) {
      return [
        {
          name: 'onCounterCompareAndSet',
          data: payload,
        },
      ]
    }

    if (callType === MethodCallTypes.FILTER_TRIGGER) {
      const eventData = payload.eventData
      const triggers = payload.triggers

      const ids = triggers
        .filter(trigger => trigger.data.counter === eventData.counterName)
        .map(trigger => trigger.id)

      logger.debug(`onCounterCompareAndSet.triggersIdsToActivate: ${ JSON.stringify(ids) }`)

      return { ids }
    }
  }

  // ======================================= DICTIONARIES ========================================

  /**
   * @typedef {Object} DictionaryItem
   * @property {String} label
   * @property {any} value
   * @property {String} note
   */

  /**
   * @typedef {Object} DictionaryResponse
   * @property {Array<DictionaryItem>} items
   */

  /**
   * @typedef {Object} getAppsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter applications by name."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Apps
   * @category Application Management
   * @description Returns available Backendless applications for AI-powered app selection.
   *
   * @route POST /get-apps
   *
   * @paramDef {"type":"getAppsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string for filtering applications."}
   *
   * @sampleResult {"items":[{"label":"Production App","note":"ID: EEEE5555-FFFF-6666-GGGG-7777HHHH8888","value":"EEEE5555-FFFF-6666-GGGG-7777HHHH8888"}]}
   * @returns {DictionaryResponse}
   */
  async getAppsDictionary({ search }) {
    const client = this.#getClient()
    const apps = await client.apps.getApps()

    const filteredApps = search
      ? apps.filter(app => app.name.toLowerCase().includes(search.toLowerCase()))
      : apps

    return {
      items: filteredApps.map(({ id, name }) => ({
        label: name,
        value: id,
        note: `ID: ${ id } `,
      })),
    }
  }

  /**
   * @typedef {Object} getApiKeysDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"App ID","name":"appId","required":true,"description":"Unique identifier of the Backendless application."}
   */

  /**
   * @typedef {Object} getApiKeysDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter API keys by name."}
   * @paramDef {"type":"getApiKeysDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required parameter to identify the Backendless application."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get API Keys
   * @category Application Management
   * @description Returns available API keys for the selected Backendless application.
   *
   * @route POST /get-api-keys
   *
   * @paramDef {"type":"getApiKeysDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string for filtering API keys."}
   *
   * @sampleResult {"items":[{"label":"REST","value":"E652EBBB-1234-6578-A5CB-D31092D9E54D"},{"label":"JS","value":"49C1A506-5084-49DB-8F17-AF921F496C72"}]}
   * @returns {DictionaryResponse}
   */
  async getApiKeysDictionary({ search, criteria: { appId } }) {
    const client = this.#getClient()
    const appSettings = await client.settings.getAppSettings(appId)

    const filteredApiKeys = search
      ? appSettings.apiKeys.filter(apiKey => apiKey.name.toLowerCase().includes(search.toLowerCase()))
      : appSettings.apiKeys

    return {
      items: filteredApiKeys.map(apiKey => ({
        label: apiKey.name,
        value: apiKey.apiKey,
      })),
    }
  }


  /**
   * @typedef {Object} getCounterNamesDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"App ID","name":"appId","required":true,"description":"Unique identifier of the Backendless application."}
   */

  /**
   * @typedef {Object} getCounterNamesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter counters by name."}
   * @paramDef {"type":"getCounterNamesDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required parameter to identify the Backendless application."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Counter Names
   * @description Returns available Backendless Counter names.
   *
   * @route POST /get-counter-names-dictionary
   *
   * @paramDef {"type":"getCounterNamesDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string for filtering applications."}
   *
   * @sampleResult {"items":[{"label":"My Counter","value":"My Counter"}]}
   * @returns {DictionaryResponse}
   */
  async getCounterNamesDictionary({ search, criteria: { appId } }) {
    const client = this.#getClient()
    const counters = await client.counters.listNames(appId)

    const filtered = search
      ? counters.filter(counter => counter.toLowerCase().includes(search.toLowerCase()))
      : counters

    return {
      items: filtered.map(counter => ({
        label: counter,
        value: counter,
      })),
    }
  }

  // ==================================== END OF DICTIONARIES ====================================

}

Flowrunner.ServerCode.addService(BackendlessCountersService, [
  {
    displayName: 'Client ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    name: 'clientId',
    hint: 'Your OAuth 2.0 Client ID from the Backendless Cluster',
  },
  {
    displayName: 'Client Secret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    name: 'clientSecret',
    hint: 'Your OAuth 2.0 Client Secret from the Backendless Cluster',
  },
  {
    displayName: 'Cluster Zone',
    name: 'clusterKey',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.CHOICE,
    options: Object.keys(ClustersHosts),
    required: false,
    defaultValue: 'DevTest(SHOULD_NOT_BE_IN_PROD)',
    hint: 'Select the Backendless cluster where your app is located',
  },
  {
    displayName: 'Cluster Console URL',
    name: 'clusterConsoleURL',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    defaultValue: '',
    hint: 'Provide when you need to specify your own Backendless PRO cluster. Example: https://develop.backendless.com',
  },
])
