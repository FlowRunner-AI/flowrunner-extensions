const path = require('path')
const { createClient } = require('backendless-console-sdk')
const Backendless = require('backendless')

const ClustersHosts = {
  'US': 'https://develop.Flowrunner.com',
  'Europe': 'https://eu-develop.Flowrunner.com',
  'Stage(SHOULD_NOT_BE_IN_PROD)': 'https://stage.Flowrunner.com',
  'DevTest(SHOULD_NOT_BE_IN_PROD)': 'https://devtest.Flowrunner.com',
  'Local(SHOULD_NOT_BE_IN_PROD)': 'http://localhost:3001',
}

const logger = {
  info: (...args) => console.log('[Backendless Service] info:', ...args),
  debug: (...args) => console.log('[Backendless Service] debug:', ...args),
  error: (...args) => console.log('[Backendless Service] error:', ...args),
  warn: (...args) => console.log('[Backendless Service] warn:', ...args),
}

const EventTypes = {
  // Cloud Code
  onTimerExecute: 'EXECUTE',
  // Counters
  onCounterReset: 'RESET',
  onCounterGetAndIncrement: 'GET_AND_INCREMENT',
  onCounterIncrementAndGet: 'INCREMENT_AND_GET',
  onCounterGetAndDecrement: 'GET_AND_DECREMENT',
  onCounterDecrementAndGet: 'DECREMENT_AND_GET',
  onCounterAddAndGet: 'ADD_AND_GET',
  onCounterGetAndAdd: 'GET_AND_ADD',
  onCounterCompareAndSet: 'COMPARE_AND_SET',
  // Data
  onRecordCreated: 'CREATE',
  onRecordUpdated: 'UPDATE',
  onRecordDeleted: 'DELETE',
  // Files
  onFileCopied: 'COPY_FILE_OR_DIRECTORY',
  onFileDeleted: 'DELETE_FILE_OR_DIRECTORY',
  onFileDownloaded: 'DOWNLOAD',
  onFileMoved: 'MOVE_FILE_OR_DIRECTORY',
  onFileRenamed: 'RENAME_FILE_OR_DIRECTORY',
  onFileUploaded: 'UPLOAD',
  // Messaging
  onPushNotificationPublished: 'PUBLISH',
  onPushNotificationWithTemplateSent: 'SEND_PUSH_NOTIFICATION_WITH_TEMPLATE',
  // Users
  onRegistered: 'REGISTER',
}

const WebhookServiceMap = {
  EXECUTE: { service: 'TIMER_SERVICE' },
  RESET: { service: 'ATOMIC_OPERATIONS', enabledForConsole: true },
  GET_AND_INCREMENT: { service: 'ATOMIC_OPERATIONS', enabledForConsole: true },
  INCREMENT_AND_GET: { service: 'ATOMIC_OPERATIONS', enabledForConsole: true },
  GET_AND_DECREMENT: { service: 'ATOMIC_OPERATIONS', enabledForConsole: true },
  DECREMENT_AND_GET: { service: 'ATOMIC_OPERATIONS', enabledForConsole: true },
  ADD_AND_GET: { service: 'ATOMIC_OPERATIONS', enabledForConsole: true },
  GET_AND_ADD: { service: 'ATOMIC_OPERATIONS', enabledForConsole: true },
  COMPARE_AND_SET: { service: 'ATOMIC_OPERATIONS', enabledForConsole: true },
  CREATE: { service: 'DATA_SERVICE' },
  UPDATE: { service: 'DATA_SERVICE' },
  DELETE: { service: 'DATA_SERVICE' },
  COPY_FILE_OR_DIRECTORY: { service: 'FILE_SERVICE' },
  DELETE_FILE_OR_DIRECTORY: { service: 'FILE_SERVICE' },
  DOWNLOAD: { service: 'FILE_SERVICE' },
  MOVE_FILE_OR_DIRECTORY: { service: 'FILE_SERVICE' },
  RENAME_FILE_OR_DIRECTORY: { service: 'FILE_SERVICE' },
  UPLOAD: { service: 'FILE_SERVICE' },
  PUBLISH: { service: 'MESSAGING_SERVICE', enabledForConsole: true },
  SEND_PUSH_NOTIFICATION_WITH_TEMPLATE: { service: 'MESSAGING_SERVICE', enabledForConsole: true },
  REGISTER: { service: 'USER_SERVICE', enabledForConsole: true },
}

const MethodTypes = Object.keys(EventTypes).reduce((acc, key) => ((acc[EventTypes[key]] = key), acc), {})

const MethodCallTypes = {
  SHAPE_EVENT: 'SHAPE_EVENT',
  FILTER_TRIGGER: 'FILTER_TRIGGER',
}

const SystemColumns = ['objectId', '___class', 'created', 'updated', 'ownerId']

/**
 *  @requireOAuth
 *  @integrationName Backendless
 *  @integrationTriggersScope SINGLE_APP
 *  @integrationIcon /icon.png
 **/
class BackendlessService {

  // ======================================= CONSTRUCTOR & PRIVATE UTILITIES ========================================

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

  // ======================================= OAUTH2 SYSTEM METHODS ========================================

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
      error = normalizeOauthError(error)

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

    let callbackResult

    try {
      logger.debug(`[executeCallback] callbackObject: ${ JSON.stringify(callbackObject, null, 2) }`)

      callbackResult = await Flowrunner.Request
        .post(`${ this.clusterURL }/developer/oauth2/token`)
        .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        .set(this.#getSecretTokenHeader())
        .send(params.toString())

      logger.debug(`[executeCallback] callbackResult: ${ JSON.stringify(callbackResult, null, 2) }`)

    } catch (error) {
      error = normalizeOauthError(error)

      logger.error(`[executeCallback] callbackResult error: ${ JSON.stringify(error, null, 2) }`)

      throw error
    }

    const { expires_in, access_token, refresh_token } = callbackResult

    let userInfo = {}

    try {
      userInfo = await Flowrunner.Request
        .get(`${ this.clusterURL }/console/home/myaccount`)
        .set(this.#getAccessTokenHeader(access_token))

      logger.debug(`[executeCallback] userInfo response: ${ JSON.stringify(userInfo, null, 2) }`)
    } catch (error) {
      error = normalizeOauthError(error)

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

  // ======================================= TRIGGER SYSTEM METHODS ========================================

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

  // ======================================= PRIVATE WEBHOOK METHODS ========================================

  async #createWebhook(invocation) {
    logger.debug(`createWebhook: ${ JSON.stringify(invocation) }`)

    const client = this.#getClient()

    const appId = invocation.events[0].triggerData.appId
    logger.debug(`appId: ${ appId }`)

    const eventsMap = new Map()

    invocation.events.forEach(event => {
      const operation = EventTypes[event.name]

      if (!eventsMap.has(operation)) {
        const webhookConfig = WebhookServiceMap[operation] || { service: operation }

        eventsMap.set(operation, {
          service: webhookConfig.service,
          operation,
          ...(webhookConfig.enabledForConsole ? { enabledForConsole: true } : {}),
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

  // ======================================= REALTIME TRIGGERS: CLOUD CODE ========================================

  /**
   * @operationName Timer: Execute
   * @category Timer Events
   * @description Triggers when a scheduled timer executes in Backendless Cloud Code, enabling AI agents to monitor timer executions, track scheduled tasks, log timer runs, or trigger workflows based on timer events. Perfect for monitoring cron jobs, scheduled operations, and automated tasks.
   * @registerAs REALTIME_TRIGGER
   *
   * @route POST /on-timer-execute
   * @appearanceColor #7DA8E8 #4A7FD8
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"App","name":"appId","required":true,"dictionary":"getAppsDictionary","description":"Select the Backendless application to monitor for timer execution events."}
   * @paramDef {"type":"String","label":"Timer","name":"timerName","required":true,"dictionary":"getTimersDictionary","description":"Select Timer in the Backendless application to monitor for timer execution events."}
   *
   * @returns {Object}
   * @sampleResult {"timerName":"dailyCleanup","executionTime":1756287035184,"status":"SUCCESS"}
   */
  onTimerExecute(callType, payload) {
    logger.debug(`onTimerExecute: ${ JSON.stringify({ callType, payload }) }`)

    if (callType === MethodCallTypes.SHAPE_EVENT) {
      return [
        {
          name: 'onTimerExecute',
          data: payload,
        },
      ]
    }

    if (callType === MethodCallTypes.FILTER_TRIGGER) {
      const eventData = payload.eventData
      const triggers = payload.triggers

      const ids = triggers
        .filter(trigger => trigger.data.timername === eventData.timerName)
        .map(trigger => trigger.id)

      logger.debug(`onTimerExecute.triggersIdsToActivate: ${ JSON.stringify(ids) }`)

      return { ids }
    }
  }

  // ======================================= REALTIME TRIGGERS: COUNTERS ========================================

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

  // ======================================= REALTIME TRIGGERS: DATA ========================================

  /**
   * @operationName On Record Created
   * @category Database Events
   * @description Triggers when a new record is created in a Backendless database table, enabling AI agents to automate workflows like sending notifications, updating related records, logging activity, or triggering business logic. Perfect for real-time data processing and event-driven architectures.
   * @registerAs REALTIME_TRIGGER
   *
   * @route POST /on-record-created
   * @appearanceColor #AAE2D1 #1FC997
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"App","name":"appId","required":true,"dictionary":"getAppsDictionary","description":"Select the Backendless application to monitor for new records."}
   * @paramDef {"type":"String","label":"Table","name":"tableId","required":true,"dictionary":"getTableIdsDictionary","dependsOn":["appId"],"description":"Select the database table to monitor for new record creation events."}
   *
   * @returns {Object}
   * @sampleResult {"objectId":"6C2C18E3-E208-47V6-9G1B-6E92E5512405","name":"John Doe","email":"john@example.com","created":1756287035184,"___class":"Users"}
   */
  onRecordCreated(callType, payload) {
    logger.debug(`onRecordCreated: ${ JSON.stringify({ callType, payload }) }`)

    if (callType === MethodCallTypes.SHAPE_EVENT) {
      return [
        {
          name: 'onRecordCreated',
          data: payload,
        },
      ]
    }

    if (callType === MethodCallTypes.FILTER_TRIGGER) {
      const eventData = payload.eventData
      const triggers = payload.triggers

      const ids = triggers
        .filter(trigger => trigger.data.tableId === eventData.tableId)
        .map(trigger => trigger.id)

      logger.debug(`onRecordCreated.triggersIdsToActivate: ${ JSON.stringify(ids) }`)

      return { ids }
    }
  }

  /**
   * @operationName On Record Updated
   * @category Database Events
   * @description Triggers when an existing record is updated in a Backendless database table, enabling AI agents to automate workflows like sending notifications, syncing data, auditing changes, or triggering business logic based on record modifications. Perfect for real-time change tracking and event-driven architectures.
   * @registerAs REALTIME_TRIGGER
   *
   * @route POST /on-record-updated
   * @appearanceColor #AAE2D1 #1FC997
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"App","name":"appId","required":true,"dictionary":"getAppsDictionary","description":"Select the Backendless application to monitor for record updates."}
   * @paramDef {"type":"String","label":"Table","name":"tableId","required":true,"dictionary":"getTableIdsDictionary","dependsOn":["appId"],"description":"Select the database table to monitor for record update events."}
   *
   * @returns {Object}
   * @sampleResult {"objectId":"6C2C18E3-E208-47V6-9G1B-6E92E5512405","name":"Jane Doe","email":"jane@example.com","updated":1756287135284,"___class":"Users"}
   */
  onRecordUpdated(callType, payload) {
    logger.debug(`onRecordUpdated: ${ JSON.stringify({ callType, payload }) }`)

    if (callType === MethodCallTypes.SHAPE_EVENT) {
      return [
        {
          name: 'onRecordUpdated',
          data: payload,
        },
      ]
    }

    if (callType === MethodCallTypes.FILTER_TRIGGER) {
      const eventData = payload.eventData
      const triggers = payload.triggers

      const ids = triggers
        .filter(trigger => trigger.data.tableId === eventData.tableId)
        .map(trigger => trigger.id)

      logger.debug(`onRecordUpdated.triggersIdsToActivate: ${ JSON.stringify(ids) }`)

      return { ids }
    }
  }

  /**
   * @operationName On Record Deleted
   * @category Database Events
   * @description Triggers when a record is deleted from a Backendless database table, enabling AI agents to automate workflows like archiving data, updating related records, sending notifications, or triggering cleanup logic. Perfect for real-time deletion tracking and event-driven architectures.
   * @registerAs REALTIME_TRIGGER
   *
   * @route POST /on-record-deleted
   * @appearanceColor #AAE2D1 #1FC997
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"App","name":"appId","required":true,"dictionary":"getAppsDictionary","description":"Select the Backendless application to monitor for record deletions."}
   * @paramDef {"type":"String","label":"Table","name":"tableId","required":true,"dictionary":"getTableIdsDictionary","dependsOn":["appId"],"description":"Select the database table to monitor for record deletion events."}
   *
   * @returns {Object}
   * @sampleResult {"objectId":"6C2C18E3-E208-47V6-9G1B-6E92E5512405","name":"John Doe","email":"john@example.com","___class":"Users"}
   */
  onRecordDeleted(callType, payload) {
    logger.debug(`onRecordDeleted: ${ JSON.stringify({ callType, payload }) }`)

    if (callType === MethodCallTypes.SHAPE_EVENT) {
      return [
        {
          name: 'onRecordDeleted',
          data: payload,
        },
      ]
    }

    if (callType === MethodCallTypes.FILTER_TRIGGER) {
      const eventData = payload.eventData
      const triggers = payload.triggers

      const ids = triggers
        .filter(trigger => trigger.data.tableId === eventData.tableId)
        .map(trigger => trigger.id)

      logger.debug(`onRecordDeleted.triggersIdsToActivate: ${ JSON.stringify(ids) }`)

      return { ids }
    }
  }

  // ======================================= REALTIME TRIGGERS: FILES ========================================

  /**
   * @operationName File Copied
   * @category File Events
   * @description Triggers when a file is copied in Backendless file storage, enabling AI agents to track file duplication, audit copy operations, or trigger workflows based on file copying events.
   * @registerAs REALTIME_TRIGGER
   *
   * @route POST /on-file-copied
   * @appearanceColor #5a60b6 #5a60b6
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"App","name":"appId","required":true,"dictionary":"getAppsDictionary","description":"Select the Backendless application to monitor for file copy events."}
   *
   * @returns {Object}
   * @sampleResult {"sourcePath":"/documents/original.pdf","targetPath":"/backup/original.pdf","timestamp":1756287035184}
   */
  onFileCopied(callType, payload) {
    logger.debug(`onFileCopied: ${ JSON.stringify({ callType, payload }) }`)

    if (callType === MethodCallTypes.SHAPE_EVENT) {
      return [
        {
          name: 'onFileCopied',
          data: payload,
        },
      ]
    }

    if (callType === MethodCallTypes.FILTER_TRIGGER) {
      const ids = payload.triggers.map(trigger => trigger.id)
      logger.debug(`onFileCopied.triggersIdsToActivate: ${ JSON.stringify(ids) }`)

      return { ids }
    }
  }

  /**
   * @operationName File Deleted
   * @category File Events
   * @description Triggers when a file is deleted from Backendless file storage, enabling AI agents to track deletions, maintain audit logs, cleanup related data, or trigger archival workflows.
   * @registerAs REALTIME_TRIGGER
   *
   * @route POST /on-file-deleted
   * @appearanceColor #5a60b6 #5a60b6
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"App","name":"appId","required":true,"dictionary":"getAppsDictionary","description":"Select the Backendless application to monitor for file deletion events."}
   *
   * @returns {Object}
   * @sampleResult {"filePath":"/documents/old-file.pdf","timestamp":1756287035184}
   */
  onFileDeleted(callType, payload) {
    logger.debug(`onFileDeleted: ${ JSON.stringify({ callType, payload }) }`)

    if (callType === MethodCallTypes.SHAPE_EVENT) {
      return [
        {
          name: 'onFileDeleted',
          data: payload,
        },
      ]
    }

    if (callType === MethodCallTypes.FILTER_TRIGGER) {
      const ids = payload.triggers.map(trigger => trigger.id)
      logger.debug(`onFileDeleted.triggersIdsToActivate: ${ JSON.stringify(ids) }`)

      return { ids }
    }
  }

  /**
   * @operationName File Moved
   * @category File Events
   * @description Triggers when a file is moved to a different location in Backendless file storage, enabling AI agents to track file relocations, update references, or trigger organizational workflows.
   * @registerAs REALTIME_TRIGGER
   *
   * @route POST /on-file-moved
   * @appearanceColor #5a60b6 #5a60b6
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"App","name":"appId","required":true,"dictionary":"getAppsDictionary","description":"Select the Backendless application to monitor for file move events."}
   *
   * @returns {Object}
   * @sampleResult {"sourcePath":"/temp/document.pdf","targetPath":"/archive/document.pdf","timestamp":1756287035184}
   */
  onFileMoved(callType, payload) {
    logger.debug(`onFileMoved: ${ JSON.stringify({ callType, payload }) }`)

    if (callType === MethodCallTypes.SHAPE_EVENT) {
      return [
        {
          name: 'onFileMoved',
          data: payload,
        },
      ]
    }

    if (callType === MethodCallTypes.FILTER_TRIGGER) {
      const ids = payload.triggers.map(trigger => trigger.id)
      logger.debug(`onFileMoved.triggersIdsToActivate: ${ JSON.stringify(ids) }`)

      return { ids }
    }
  }

  /**
   * @operationName File Renamed
   * @category File Events
   * @description Triggers when a file is renamed in Backendless file storage, enabling AI agents to track name changes, update references, maintain history, or trigger notification workflows.
   * @registerAs REALTIME_TRIGGER
   *
   * @route POST /on-file-renamed
   * @appearanceColor #5a60b6 #5a60b6
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"App","name":"appId","required":true,"dictionary":"getAppsDictionary","description":"Select the Backendless application to monitor for file rename events."}
   *
   * @returns {Object}
   * @sampleResult {"oldName":"draft.pdf","newName":"final.pdf","filePath":"/documents/final.pdf","timestamp":1756287035184}
   */
  onFileRenamed(callType, payload) {
    logger.debug(`onFileRenamed: ${ JSON.stringify({ callType, payload }) }`)

    if (callType === MethodCallTypes.SHAPE_EVENT) {
      return [
        {
          name: 'onFileRenamed',
          data: payload,
        },
      ]
    }

    if (callType === MethodCallTypes.FILTER_TRIGGER) {
      const ids = payload.triggers.map(trigger => trigger.id)
      logger.debug(`onFileRenamed.triggersIdsToActivate: ${ JSON.stringify(ids) }`)

      return { ids }
    }
  }

  /**
   * @operationName File Uploaded
   * @category File Events
   * @description Triggers when a file is uploaded to Backendless file storage, enabling AI agents to process new files, trigger analysis workflows, send notifications, or perform automated actions on uploaded content.
   * @registerAs REALTIME_TRIGGER
   *
   * @route POST /on-file-uploaded
   * @appearanceColor #5a60b6 #5a60b6
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"App","name":"appId","required":true,"dictionary":"getAppsDictionary","description":"Select the Backendless application to monitor for file upload events."}
   *
   * @returns {Object}
   * @sampleResult {"filePath":"/uploads/new-document.pdf","size":245680,"timestamp":1756287035184}
   */
  onFileUploaded(callType, payload) {
    logger.debug(`onFileUploaded: ${ JSON.stringify({ callType, payload }) }`)

    if (callType === MethodCallTypes.SHAPE_EVENT) {
      return [
        {
          name: 'onFileUploaded',
          data: payload,
        },
      ]
    }

    if (callType === MethodCallTypes.FILTER_TRIGGER) {
      const ids = payload.triggers.map(trigger => trigger.id)
      logger.debug(`onFileUploaded.triggersIdsToActivate: ${ JSON.stringify(ids) }`)

      return { ids }
    }
  }

  // ======================================= REALTIME TRIGGERS: MESSAGING ========================================

  /**
   * @operationName On Push Notification Published
   * @category Messaging Events
   * @description Triggers when a push notification is published to Backendless, enabling AI agents to automate workflows like logging notifications, sending follow-up messages, updating analytics, or triggering related business logic. Perfect for real-time notification tracking and event-driven architectures.
   * @registerAs REALTIME_TRIGGER
   *
   * @route POST /on-push-notification-published
   * @appearanceColor #9DCEF2 #408EC6
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"App","name":"appId","required":true,"dictionary":"getAppsDictionary","description":"Select the Backendless application to monitor for published push notifications."}
   *
   * @returns {Object}
   * @sampleResult {"messageId":"push:abc123-def456-ghi789","status":"PUBLISHED","timestamp":1756287035184}
   */
  onPushNotificationPublished(callType, payload) {
    logger.debug(`onPushNotificationPublished: ${ JSON.stringify({ callType, payload }) }`)

    if (callType === MethodCallTypes.SHAPE_EVENT) {
      return [
        {
          name: 'onPushNotificationPublished',
          data: payload,
        },
      ]
    }

    if (callType === MethodCallTypes.FILTER_TRIGGER) {
      const ids = payload.triggers.map(trigger => trigger.id)
      logger.debug(`onPushNotificationPublished.triggersIdsToActivate: ${ JSON.stringify(ids) }`)

      return { ids }
    }
  }

  /**
   * @operationName On Push Notification Sent From Template
   * @category Messaging Events
   * @description Triggers when a push notification is sent from a template in Backendless, enabling AI agents to automate workflows like tracking template usage, updating delivery metrics, logging campaigns, or triggering follow-up actions. Perfect for template-based notification tracking and event-driven architectures.
   * @registerAs REALTIME_TRIGGER
   *
   * @route POST /on-push-notification-sent-from-template
   * @appearanceColor #9DCEF2 #408EC6
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"App","name":"appId","required":true,"dictionary":"getAppsDictionary","description":"Select the Backendless application to monitor for template-based push notifications."}
   *
   * @returns {Object}
   * @sampleResult {"messageId":"push:abc123-def456-ghi789","templateName":"welcome-notification","status":"SENT","timestamp":1756287035184}
   */
  onPushNotificationWithTemplateSent(callType, payload) {
    logger.debug(`onPushNotificationWithTemplateSent: ${ JSON.stringify({ callType, payload }) }`)

    if (callType === MethodCallTypes.SHAPE_EVENT) {
      return [
        {
          name: 'onPushNotificationWithTemplateSent',
          data: payload,
        },
      ]
    }

    if (callType === MethodCallTypes.FILTER_TRIGGER) {
      const ids = payload.triggers.map(trigger => trigger.id)
      logger.debug(`onPushNotificationWithTemplateSent.triggersIdsToActivate: ${ JSON.stringify(ids) }`)

      return { ids }
    }
  }

  // ======================================= REALTIME TRIGGERS: USERS ========================================

  /**
   * @operationName On New User Registered
   * @category Registration
   * @description Triggers when a new user is registered in a Backendless app, including new users created through the Backendless Console.
   * @registerAs REALTIME_TRIGGER
   *
   * @route POST /on-user-registered
   * @appearanceColor #AAE2D1 #1FC997
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"App","name":"appId","required":true,"dictionary":"getAppsDictionary","description":"Select the Backendless application to monitor for new records."}
   *
   * @returns {Object}
   * @sampleResult {"objectId":"6C2C18E3-E208-47V6-9G1B-6E92E5512405","name":"John Doe","email":"john@example.com","created":1756287035184,"___class":"Users"}
   */
  onRegistered(callType, payload) {
    logger.debug(`onRegistered: ${ JSON.stringify({ callType, payload }) }`)

    if (callType === MethodCallTypes.SHAPE_EVENT) {
      return [
        {
          name: 'onRegistered',
          data: payload,
        },
      ]
    }

    if (callType === MethodCallTypes.FILTER_TRIGGER) {
      const ids = payload.triggers.map(trigger => trigger.id)
      logger.debug(`onRegistered.triggersIdsToActivate: ${ JSON.stringify(ids) }`)

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

  // ------- Cloud Code Dictionaries -------

  /**
   * @typedef {Object} getTimersDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"App ID","name":"appId","required":true,"description":"Unique identifier of the Backendless application."}
   */

  /**
   * @typedef {Object} getTimersDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter Timers by name."}
   * @paramDef {"type":"getApiKeysDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required parameter to identify the Backendless application."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Timers
   * @description Returns available Timers for the selected Backendless application.
   *
   * @route POST /get-timers
   *
   * @paramDef {"type":"getTimersDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string for filtering Timers."}
   *
   * @sampleResult {"items":[]}
   * @returns {DictionaryResponse}
   */
  async getTimersDictionary({ search, criteria: { appId } }) {
    const client = this.#getClient()
    const timers = await client.bl.getEventHandlers(appId, ['PRODUCTION'])
    console.log('getTimersDictionary', timers)
    const filtered = search
      ? timers.filter(timer => timer.timername.toLowerCase().includes(search.toLowerCase()))
      : timers

    return {
      items: filtered.map(timer => ({
        label: timer.timername,
        value: timer.id,
        note: `${ timer.model } (${ timer.language })`,
      })),
    }
  }

  // ------- Counters Dictionaries -------

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

  // ------- Data Dictionaries -------

  /**
   * @typedef {Object} getTableIdsDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"App ID","name":"appId","required":true,"description":"Unique identifier of the Backendless application."}
   */

  /**
   * @typedef {Object} getTableIdsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter tables by name."}
   * @paramDef {"type":"getTableIdsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required parameter to identify the Backendless application."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Table IDs
   * @category Database Management
   * @description Returns available database tables for AI-powered data operations.
   *
   * @route POST /get-table-ids-dictionary
   *
   * @paramDef {"type":"getTableIdsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string for filtering tables."}
   *
   * @sampleResult {"items":[{"label":"Users","note":"ID: EEEE5555-FFFF-6666-GGGG-7777HHHH8888","value":"EEEE5555-FFFF-6666-GGGG-7777HHHH8888"}]}
   * @returns {DictionaryResponse}
   */
  async getTableIdsDictionary({ search, criteria: { appId } }) {
    const client = this.#getClient()
    const { tables } = await client.tables.get(appId)

    const filteredTables = search
      ? tables.filter(item => item.name.toLowerCase().includes(search.toLowerCase()))
      : tables

    return {
      items: filteredTables.map(({ tableId, name }) => ({
        label: name,
        value: tableId,
        note: `ID: ${ tableId } `,
      })),
    }
  }


  /**
   * @typedef {Object} getTableNamesDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"App ID","name":"appId","required":true,"description":"Unique identifier of the Backendless application."}
   */

  /**
   * @typedef {Object} getTableNamesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter tables by name."}
   * @paramDef {"type":"getTableNamesDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required parameter to identify the Backendless application."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Table Names
   * @category Database Management
   * @description Returns available database tables for AI-powered data operations.
   *
   * @route POST /get-table-names-dictionary
   *
   * @paramDef {"type":"getTableNamesDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string for filtering tables."}
   *
   * @sampleResult {"items":[{"label":"Users","note":"ID: EEEE5555-FFFF-6666-GGGG-7777HHHH8888","value":"Users"}]}
   * @returns {DictionaryResponse}
   */
  async getTableNamesDictionary({ search, criteria: { appId } }) {
    const client = this.#getClient()
    const { tables } = await client.tables.get(appId)

    const filteredTables = search
      ? tables.filter(item => item.name.toLowerCase().includes(search.toLowerCase()))
      : tables

    return {
      items: filteredTables.map(({ tableId, name }) => ({
        label: name,
        value: name,
        note: `ID: ${ tableId } `,
      })),
    }
  }

  /**
   * @typedef {Object} getTablesAndViewsDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"App ID","name":"appId","required":true,"description":"Unique identifier of the Backendless application."}
   */

  /**
   * @typedef {Object} getTablesAndViewsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter tables and views by name."}
   * @paramDef {"type":"getTablesAndViewsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required parameter to identify the Backendless application."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Tables and Views
   * @category Database Management
   * @description Returns available database tables and views for AI-powered data operations.
   *
   * @route POST /get-tables-and-views
   *
   * @paramDef {"type":"getTablesAndViewsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string for filtering tables and views."}
   *
   * @sampleResult {"items":[{"label":"View","note":"ID: EEEE5555-FFFF-6666-GGGG-7777HHHH8888","value":"View"}]}
   * @returns {DictionaryResponse}
   */
  async getTablesAndViewsDictionary({ search, criteria: { appId } }) {
    const client = this.#getClient()

    const { tables } = await client.tables.get(appId)
    const dataViews = await client.dataViews.getViews(appId)

    const tablesAndViews = []
    tables.forEach(({ tableId, name }) => tablesAndViews.push({ id: tableId, name }))
    dataViews.forEach(({ viewId, name }) => tablesAndViews.push({ id: viewId, name }))

    const filteredTablesAndViews = search
      ? tablesAndViews.filter(item => item.name.toLowerCase().includes(search.toLowerCase()))
      : tablesAndViews

    return {
      items: filteredTablesAndViews.map(({ id, name }) => ({
        label: name,
        value: name,
        note: `ID: ${ id } `,
      })),
    }
  }

  // ------- Messaging Dictionaries -------

  /**
   * @typedef {Object} getEmailTemplatesDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"App ID","name":"appId","required":true,"description":"Unique identifier of the Backendless application."}
   */

  /**
   * @typedef {Object} getEmailTemplatesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter email templates by name."}
   * @paramDef {"type":"getEmailTemplatesDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required parameter to identify the Backendless application."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Email Templates
   * @category Messaging
   * @description Returns available email templates for AI-powered messaging operations. Enables AI agents to dynamically select appropriate email templates for messaging operations.
   *
   * @route POST /get-email-templates
   *
   * @paramDef {"type":"getEmailTemplatesDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string for filtering email templates."}
   *
   * @sampleResult {"items":[{"label":"email-template","value":"email-template"}]}
   * @returns {DictionaryResponse}
   */
  async getEmailTemplatesDictionary({ search, criteria: { appId } }) {
    const client = this.#getClient()
    const emailTemplates = await client.email.loadCustomTemplates(appId)

    const filteredEmailTemplates = search
      ? emailTemplates.filter(item => item.name.toLowerCase().includes(search.toLowerCase()))
      : emailTemplates

    return {
      items: filteredEmailTemplates.map(({ name }) => ({
        label: name,
        value: name,
      })),
    }
  }

  /**
   * @typedef {Object} getPushTemplatesDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"App ID","name":"appId","required":true,"description":"Unique identifier of the Backendless application."}
   */

  /**
   * @typedef {Object} getPushTemplatesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter push notification templates by name."}
   * @paramDef {"type":"getPushTemplatesDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required parameter to identify the Backendless application."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Push Templates
   * @category Messaging
   * @description Returns available push notification templates for AI-powered messaging operations. Enables AI agents to dynamically select appropriate push templates for mobile and web notifications.
   *
   * @route POST /get-push-templates
   *
   * @paramDef {"type":"getPushTemplatesDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string for filtering push notification templates."}
   *
   * @sampleResult {"items":[{"label":"push-template","note":"ID: 67d98e7bd12345efa123c45f","value":"push-template"}]}
   * @returns {DictionaryResponse}
   */
  async getPushTemplatesDictionary({ search, criteria: { appId } }) {
    const client = this.#getClient()
    const pushTemplates = await client.messaging.getPushTemplates(appId)

    const filteredPushTemplates = search
      ? pushTemplates.filter(item => item.name.toLowerCase().includes(search.toLowerCase()))
      : pushTemplates

    return {
      items: filteredPushTemplates.map(({ id, name }) => ({
        label: name,
        value: name,
        note: `ID: ${ id }`,
      })),
    }
  }

  // ------- PDF Dictionaries -------

  /**
   * @typedef {Object} getPdfTemplatesDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"App ID","name":"appId","required":true,"description":"Unique identifier of the Backendless application."}
   */

  /**
   * @typedef {Object} getPdfTemplatesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter PDF templates by name."}
   * @paramDef {"type":"getPdfTemplatesDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required parameter to identify the Backendless application."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get PDF Templates
   * @category PDF Management
   * @description Returns available PDF templates for AI-powered document operations. Enables AI agents to dynamically select appropriate PDF templates for document generation and processing.
   *
   * @route POST /get-pdf-templates
   *
   * @paramDef {"type":"getPdfTemplatesDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string for filtering PDF templates."}
   *
   * @sampleResult {"items":[{"label":"pdf-template","note":"ID: EEEE5555-FFFF-6666-GGGG-7777HHHH8888","value":"EEEE5555-FFFF-6666-GGGG-7777HHHH8888"}]}
   * @returns {DictionaryResponse}
   */
  async getPdfTemplatesDictionary({ search, criteria: { appId } }) {
    const client = this.#getClient()
    const pdfTemplates = await client.pdf.listTemplates(appId)

    const filteredPdfTemplates = search
      ? pdfTemplates.filter(item => item.name.toLowerCase().includes(search.toLowerCase()))
      : pdfTemplates

    return {
      items: filteredPdfTemplates.map(({ id, name }) => ({
        label: name,
        value: id,
        note: `ID: ${ id }`,
      })),
    }
  }

  // ==================================== END OF DICTIONARIES ====================================

  // ======================================= PARAM SCHEMA LOADERS ========================================

  #getUiComponentForColumnType(dataType) {
    switch (dataType) {
      case 'BOOLEAN':
        return { type: 'TOGGLE' }
      case 'TEXT':
        return { type: 'MULTI_LINE_TEXT' }
      case 'INT':
      case 'DOUBLE':
      case 'AUTO_INCREMENT':
        return { type: 'NUMERIC_STEPPER' }
      case 'DATETIME':
        return { type: 'DATE_TIME_PICKER' }
      default:
        return { type: 'SINGLE_LINE_TEXT' }
    }
  }

  /**
   * @registerAs PARAM_SCHEMA_DEFINITION
   * @paramDef {"type":"Object","name":"payload","required":true}
   * @returns {Array}
   * */
  async createRecordFieldsSchemaLoader({ criteria }) {
    const { appId, tableName } = criteria

    if (!appId || !tableName) {
      return []
    }

    const client = this.#getClient()
    const { tables } = await client.tables.get(appId)
    const table = tables.find(t => t.name === tableName)

    if (!table) {
      return []
    }

    return table.columns
      .filter(col => !SystemColumns.includes(col.name))
      .map(col => ({
        type: col.dataType,
        label: col.name,
        name: col.name,
        required: col.required,
        description: `Column type: "${ col.dataType }"`,
        uiComponent: this.#getUiComponentForColumnType(col.dataType),
      }))
  }

  // ======================================= ACTIONS: DATABASE ========================================

  /**
   * @operationName Delete Record In Database
   * @category Database
   * @description Removes records from a Backendless database table.
   *
   * @appearanceColor #AAE2D1 #1FC997
   * @executionTimeoutInSeconds 120
   * @route POST /delete-record
   *
   * @paramDef {"type":"String","label":"App","name":"appId","required":true,"dictionary":"getAppsDictionary","description":"Select the Backendless application to delete records from. This determines which app's database will be accessed for the operation."}
   * @paramDef {"type":"String","label":"API Key","name":"apiKey","required":false,"dictionary":"getApiKeysDictionary","dependsOn":["appId"],"description":"Select the Backendless API Key which will be used for connecting to the Backendless application. By default, it uses REST API Key."}
   * @paramDef {"type":"String","label":"Table Name","name":"tableName","required":true,"dictionary":"getTableNamesDictionary","dependsOn":["appId"],"description":"Select the database table. Must match an existing table in your Backendless database."}
   * @paramDef {"type":"String","label":"Record","name":"recordId","required":true,"description":"Unique identifier of the record to delete."}
   *
   * @returns {Object}
   * @sampleResult {}
   */
  async deleteRecord(appId, apiKey, tableName, recordId) {
    const apiSdk = await this.#getApiSdk(appId, apiKey)

    return apiSdk.Data.of(tableName).remove(recordId)
  }

  /**
   * @operationName Delete Records In Database
   * @category Database
   * @description Removes records from a Backendless database table.
   *
   * @appearanceColor #AAE2D1 #1FC997
   * @executionTimeoutInSeconds 120
   * @route POST /delete-records
   *
   * @paramDef {"type":"String","label":"App","name":"appId","required":true,"dictionary":"getAppsDictionary","description":"Select the Backendless application to delete records from. This determines which app's database will be accessed for the operation."}
   * @paramDef {"type":"String","label":"API Key","name":"apiKey","required":false,"dictionary":"getApiKeysDictionary","dependsOn":["appId"],"description":"Select the Backendless API Key which will be used for connecting to the Backendless application. By default, it uses REST API Key."}
   * @paramDef {"type":"String","label":"Table Name","name":"tableName","required":true,"dictionary":"getTableNamesDictionary","dependsOn":["appId"],"description":"Select the database table. Must match an existing table in your Backendless database."}
   * @paramDef {"type":"String","label":"Where Clause","name":"whereClause","required":false,"description":"SQL-like condition to identify records for deletion. Examples: `email='user@example.com'`, `age > 65 AND status = 'inactive'`. Either this or Object IDs must be provided."}
   * @paramDef {"type":"Array<String>","label":"Object IDs","name":"objectIds","required":false,"description":"Array of record objectIds to delete. Either this or Where Clause must be provided."}
   *
   * @returns {Object}
   * @sampleResult {"deletedCount":1}
   */
  async deleteRecords(appId, apiKey, tableName, whereClause, objectIds) {
    if (!whereClause && !objectIds) {
      throw new Error('Either `whereClause` or `objectIds` must be provided.')
    }

    const apiSdk = await this.#getApiSdk(appId, apiKey)

    const deletedCount = await apiSdk.Data.of(tableName).bulkDelete(whereClause || objectIds)

    return { deletedCount }
  }

  /**
   * @operationName Find Record(s) in Database
   * @category Database
   * @description Fetches records from a Backendless table based on specified criteria.
   *
   * @appearanceColor #AAE2D1 #1FC997
   * @executionTimeoutInSeconds 120
   * @route POST /find-records
   *
   * @paramDef {"type":"String","label":"App","name":"appId","required":true,"dictionary":"getAppsDictionary","description":"Select the Backendless application to query records from. This determines which app's database will be accessed for the search operation."}
   * @paramDef {"type":"String","label":"API Key","name":"apiKey","required":false,"dictionary":"getApiKeysDictionary","dependsOn":["appId"],"description":"Select the Backendless API Key which will be used for connecting to the Backendless application. By default, it uses REST API Key."}
   * @paramDef {"type":"String","label":"Table or View","name":"tableOrView","required":true,"dictionary":"getTablesAndViewsDictionary","dependsOn":["appId"],"description":"Select the database table or view. Must match an existing table in your Backendless database."}
   * @paramDef {"type":"String","label":"Where Clause","name":"whereClause","description":"SQL-like condition to identify records. Examples: `email='user@example.com'`, `age > 65 AND status = 'inactive'`, `created < '2024-01-01'`."}
   * @paramDef {"type":"String","label":"Sort By","name":"sortBy","description":"Field name(s) for sorting results. Examples: `created DESC`, `name ASC`, `age DESC, created ASC`."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of records to return. Default is `10`."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of records to skip for pagination. Default is `0`. Use with *Page Size* for pagination."}
   *
   * @returns {Object}
   * @sampleResult {"records":[{"objectId":"6C2C18E3-E208-47V6-9G1B-6E92E5512405","name":"John","created":"1756287035184"}],"totalCount":1}
   */
  async findRecords(appId, apiKey, tableOrView, whereClause, sortBy, pageSize, offset) {
    const apiSDK = await this.#getApiSdk(appId, apiKey)

    const queryBuilder = apiSDK.DataQueryBuilder.create()

    if (whereClause) {
      queryBuilder.setWhereClause(whereClause)
    }

    if (sortBy) {
      queryBuilder.setSortBy(sortBy.split(',').map(s => s.trim()))
    }

    if (pageSize) {
      queryBuilder.setPageSize(pageSize)
    }

    if (offset) {
      queryBuilder.setOffset(offset)
    }

    logger.debug(`[findRecords] query builder: ${ JSON.stringify(queryBuilder) }`)
    const store = apiSDK.Data.of(tableOrView)

    const [records, totalCount] = await Promise.all([
      store.find(queryBuilder),
      store.getObjectCount(queryBuilder),
    ])

    return {
      records,
      totalCount,
    }
  }

  /**
   * @operationName Save Record In Database
   * @category Database
   * @description Creates new records or updates existing ones in Backendless database tables.
   *
   * @appearanceColor #AAE2D1 #1FC997
   * @executionTimeoutInSeconds 120
   * @route POST /save-record
   *
   * @paramDef {"type":"String","label":"App","name":"appId","required":true,"dictionary":"getAppsDictionary","description":"Select the Backendless application to update records. This determines which app's database will be accessed for the operation."}
   * @paramDef {"type":"String","label":"API Key","name":"apiKey","required":false,"dictionary":"getApiKeysDictionary","dependsOn":["appId"],"description":"Select the Backendless API Key which will be used for connecting to the Backendless application. By default, it uses REST API Key."}
   * @paramDef {"type":"String","label":"Table Name","name":"tableName","required":true,"dictionary":"getTableNamesDictionary","dependsOn":["appId"],"description":"Select the database table. Must match an existing table in your Backendless database."}
   * @paramDef {"type":"Object","label":"Record Fields","name":"fields","dependsOn":["appId","tableName"],"schemaLoader":"createRecordFieldsSchemaLoader","description":"Specify individual column values for the record. Fields are generated dynamically based on the selected table schema."}
   *
   * @returns {Object}
   * @sampleResult {"objectId":"6C2C18E3-E208-47V6-9G1B-6E92E5512405","name":"John Doe","created":"1756287035184"}
   */
  async saveRecord(appId, apiKey, tableName, fields) {
    const apiSDK = await this.#getApiSdk(appId, apiKey)

    return apiSDK.Data.of(tableName).save(fields || {})
  }

  /**
   * @operationName Update Records With Query
   * @category Database
   * @description Updates records in Backendless database tables.
   *
   * @appearanceColor #AAE2D1 #1FC997
   * @executionTimeoutInSeconds 120
   * @route POST /update-records-with-query
   *
   * @paramDef {"type":"String","label":"App","name":"appId","required":true,"dictionary":"getAppsDictionary","description":"Select the Backendless application to update records. This determines which app's database will be accessed for the operation."}
   * @paramDef {"type":"String","label":"API Key","name":"apiKey","required":false,"dictionary":"getApiKeysDictionary","dependsOn":["appId"],"description":"Select the Backendless API Key which will be used for connecting to the Backendless application. By default, it uses REST API Key."}
   * @paramDef {"type":"String","label":"Table Name","name":"tableName","required":true,"dictionary":"getTableNamesDictionary","dependsOn":["appId"],"description":"Select the database table. Must match an existing table in your Backendless database."}
   * @paramDef {"type":"String","label":"Where Clause","name":"whereClause","required":true,"description":"SQL-like condition to identify records when performing an update by query. Examples: `email='user@example.com'`, `age > 65 AND status = 'inactive'`, `created < '2024-01-01'`."}
   * @paramDef {"type":"Object","label":"Record Fields","name":"fields","dependsOn":["appId","tableName"],"schemaLoader":"createRecordFieldsSchemaLoader","description":"Object containing field names as keys and their new values to apply to matching records."}
   *
   * @returns {Object}
   * @sampleResult {"updatedCount":12}
   */
  async updateRecordsWithQuery(appId, apiKey, tableName, whereClause, fields) {
    const apiSDK = await this.#getApiSdk(appId, apiKey)
    const updatedCount = await apiSDK.Data.of(tableName).bulkUpdate(whereClause, cleanupObject(fields))

    return { updatedCount }
  }

  // ======================================= ACTIONS: FILES ========================================

  /**
   * @operationName Create Directory
   * @category Files
   * @description Creates directories in Backendless file storage for AI agents to organize generated content, user uploads, or data exports. Perfect for creating dynamic folder structures based on user IDs, project names, or automated workflows that need organized file storage.
   *
   * @appearanceColor #5a60b6 #5a60b6
   * @executionTimeoutInSeconds 120
   * @route POST /createDirectory
   *
   * @paramDef {"type":"String","label":"App","name":"appId","required":true,"dictionary":"getAppsDictionary","description":"Select the Backendless application to create the directory in. This determines which app's file storage will be used."}
   * @paramDef {"type":"String","label":"API Key","name":"apiKey","required":false,"dictionary":"getApiKeysDictionary","dependsOn":["appId"],"description":"Select the Backendless API Key which will be used for connecting to the Backendless application. By default, it uses REST API Key."}
   * @paramDef {"type":"String","label":"Directory Path","name":"directoryPath","required":true,"description": "Path for the new directory. Examples: '/user-uploads/john-doe', '/reports/2025-01', '/ai-generated/images'. Use forward slashes to create nested directories."}
   *
   * @sampleResult {"directoryPath":"/user-uploads/john-doe"}
   */
  async createDirectory(appId, apiKey, directoryPath) {
    const apiSdk = await this.#getApiSdk(appId, apiKey)

    directoryPath = this.#composeTargetPath(directoryPath)

    await apiSdk.Files.createDirectory(directoryPath)

    return {
      directoryPath,
    }
  }

  /**
   * @operationName Delete File
   * @category Files
   * @description Removes files from Backendless storage, enabling AI agents to clean up temporary files, delete outdated content, or manage storage quotas automatically. Essential for maintaining organized file systems and preventing storage bloat in automated workflows.
   *
   * @appearanceColor #5a60b6 #5a60b6
   * @executionTimeoutInSeconds 120
   * @route POST /deleteFile
   *
   * @paramDef {"type":"String","label":"App","name":"appId","required":true,"dictionary":"getAppsDictionary","description":"Select the Backendless application to delete files from. This determines which app's file storage will be used."}
   * @paramDef {"type":"String","label":"API Key","name":"apiKey","required":false,"dictionary":"getApiKeysDictionary","dependsOn":["appId"],"description":"Select the Backendless API Key which will be used for connecting to the Backendless application. By default, it uses REST API Key."}
   * @paramDef {"type":"String","label":"File Path","name":"filePath","required":true,"description": "Complete path to the file to delete. Examples: '/uploads/document.pdf', '/temp/cache-data.json', '/user-files/john/profile.jpg'. Include directory path and filename."}
   * @paramDef {"type":"Boolean","label":"Fail if File Not Found","name":"failIfFileNotFound","required":false,"uiComponent":{"type":"TOGGLE"}, "description": "Enable to throw an error if the file doesn't exist. Disable for graceful handling in cleanup operations where files may already be deleted."}
   *
   * @sampleResult {"deleted":true}
   */
  async deleteFile(appId, apiKey, filePath, failIfFileNotFound) {
    const apiSdk = await this.#getApiSdk(appId, apiKey)

    try {
      await apiSdk.Files.remove(filePath)
    } catch (error) {
      // code:6000 => "File or directory cannot be found: 'parent/test.txt'",
      if (!failIfFileNotFound && error.code === 6000) {
        return {
          deleted: false,
        }
      }

      throw error
    }

    return {
      deleted: true,
    }
  }

  /**
   * @operationName Add To File
   * @category Files
   * @description Appends content to files, enabling AI agents to build logs, accumulate data, or create progressive reports. Perfect for adding new entries to CSV files, appending chat logs, building audit trails, or collecting data from multiple sources into single files.
   *
   * @appearanceColor #5a60b6 #5a60b6
   * @executionTimeoutInSeconds 120
   * @route POST /addToFile
   *
   * @paramDef {"type":"String","label":"App","name":"appId","required":true,"dictionary":"getAppsDictionary","description":"Select the Backendless application to add content to files. This determines which app's file storage will be used."}
   * @paramDef {"type":"String","label":"API Key","name":"apiKey","required":false,"dictionary":"getApiKeysDictionary","dependsOn":["appId"],"description":"Select the Backendless API Key which will be used for connecting to the Backendless application. By default, it uses REST API Key."}
   * @paramDef {"type":"String","label":"Directory Path","name":"directoryPath","required":false,"description": "Directory containing the target file. Examples: '/logs', '/reports/2025', '/user-data'. Defaults to root directory if not specified."}
   * @paramDef {"type":"String","label":"File Name","name":"fileName","required":true,"description": "Target filename for appending content. Examples: 'activity.log', 'user-data.csv', 'chat-history.txt'. File will be created if it doesn't exist."}
   * @paramDef {"type":"String","label":"Content","name":"content","required":false,"description": "Text content to append. Examples: 'New log entry\n', 'John,Doe,john@example.com\n', '{\"timestamp\": \"2025-01-15\"}'. Use either this or Content From URL.","uiComponent":{"type":"MULTI_LINE_TEXT"}}
   * @paramDef {"type":"String","label":"Content From URL","name":"contentFromUrl","required":false,"description": "URL to fetch content for appending. Examples: 'https://api.example.com/data.txt', 'https://domain.com/report.csv'. Alternative to direct content input."}
   *
   * @sampleResult {"fileName":"activity.log","directoryPath":"/logs","filePath":"/logs/activity.log","fileURL":"https://your-app.Flowrunner.app/api/files/logs/activity.log"}
   */
  async addToFile(appId, apiKey, directoryPath, fileName, content, contentFromUrl) {
    const apiSdk = await this.#getApiSdk(appId, apiKey)

    directoryPath = this.#composeTargetPath(directoryPath)

    if (!content && !contentFromUrl) {
      throw new Error('Please provide one of the arguments: Content or Content from URL')
    }

    if (fileName.startsWith('https://') || fileName.startsWith('http://')) {
      fileName = fileName.split('/').slice(-1)[0]
    }

    const filePath = path.join(directoryPath, fileName)

    if (contentFromUrl) {
      let { fileURL } = await apiSdk.Files.append(filePath, contentFromUrl)

      fileURL = await this.#replaceWithPublicBaseURL(apiSdk, fileURL)

      return {
        directoryPath,
        filePath,
        fileURL,
        fileName,
      }
    }

    if (typeof content !== 'string') {
      content = JSON.stringify(content)
    }

    let fileURL = await apiSdk.Files.appendText(filePath, content)

    fileURL = await this.#replaceWithPublicBaseURL(apiSdk, fileURL)

    return {
      directoryPath,
      filePath,
      fileURL,
      fileName,
    }
  }

  /**
   * @operationName Create File
   * @category Files
   * @description Creates new files in Backendless storage, enabling AI agents to generate reports, save processed data, create configuration files, or store user-generated content. Perfect for exporting data, saving AI outputs, or creating dynamic content files.
   *
   * @appearanceColor #5a60b6 #5a60b6
   * @executionTimeoutInSeconds 120
   * @route POST /createFile
   *
   * @paramDef {"type":"String","label":"App","name":"appId","required":true,"dictionary":"getAppsDictionary","description":"Select the Backendless application to create files in. This determines which app's file storage will be used."}
   * @paramDef {"type":"String","label":"API Key","name":"apiKey","required":false,"dictionary":"getApiKeysDictionary","dependsOn":["appId"],"description":"Select the Backendless API Key which will be used for connecting to the Backendless application. By default, it uses REST API Key."}
   * @paramDef {"type":"String","label":"Directory","name":"directoryPath","required":false,"description": "Target directory for the new file. Examples: '/reports', '/user-uploads/john', '/ai-generated'. Defaults to root directory if not specified."}
   * @paramDef {"type":"String","label":"File Name","name":"fileName","required":true,"description": "Name for the new file with extension. Examples: 'report.pdf', 'user-data.json', 'config.xml', 'summary.txt'. Include the file extension."}
   * @paramDef {"type":"String","label":"Content","name":"content","required":true,"description": "File content as text. Examples: JSON data, CSV rows, HTML markup, plain text. Non-string values will be converted to JSON format.","uiComponent":{"type":"MULTI_LINE_TEXT"}}
   * @paramDef {"type":"Boolean","label":"Overwrite","name":"overwrite","required":false,"uiComponent":{"type":"TOGGLE"}, "description": "Enable to replace existing files with the same name. Disable to prevent accidental overwrites and fail if file exists."}
   *
   * @sampleResult {"fileName":"user-report.json","directoryPath":"/reports","fileURL":"https://your-app.Flowrunner.app/api/files/reports/user-report.json","filePath":"/reports/user-report.json"}
   */
  async createFile(appId, apiKey, directoryPath, fileName, content, overwrite) {
    const apiSdk = await this.#getApiSdk(appId, apiKey)

    directoryPath = this.#composeTargetPath(directoryPath)

    if (typeof content !== 'string') {
      content = JSON.stringify(content)
    }

    let fileURL = await apiSdk.Files.saveFile(directoryPath, fileName, content, overwrite)

    fileURL = await this.#replaceWithPublicBaseURL(apiSdk, fileURL)

    const filePath = path.join(directoryPath, fileName)

    return {
      directoryPath,
      fileURL,
      fileName,
      filePath,
    }
  }

  /**
   * @operationName List Directory
   * @category Files
   * @description Lists files and directories in a Backendless file storage directory with optional filtering, sorting, and pagination. Enables AI agents to explore file structures, search for specific files, or paginate through large directories.
   *
   * @appearanceColor #5a60b6 #5a60b6
   * @executionTimeoutInSeconds 120
   * @route POST /listDirectory
   *
   * @paramDef {"type":"String","label":"App","name":"appId","required":true,"dictionary":"getAppsDictionary","description":"Select the Backendless application to list files from. This determines which app's file storage will be used."}
   * @paramDef {"type":"String","label":"Directory Path","name":"directoryPath","required":false,"description":"Directory path to list. Examples: '/uploads', '/reports/2025', '/user-files'. Defaults to root directory if not specified."}
   * @paramDef {"type":"String","label":"Pattern","name":"pattern","required":false,"description":"Optional search pattern to filter files and directories by name. Examples: '*.pdf', 'report*', '*.json'. Supports wildcard matching."}
   * @paramDef {"type":"Boolean","label":"Include Subdirectories","name":"sub","required":false,"uiComponent":{"type":"TOGGLE"},"description":"Enable to include files from subdirectories in the search results. Useful for recursive file listing."}
   * @paramDef {"type":"String","label":"Sort By","name":"sortBy","required":false,"description":"Field to sort results by. Options: 'name', 'size', 'createdOn', 'updatedOn'. Defaults to unsorted if not specified."}
   * @paramDef {"type":"String","label":"Sort Direction","name":"sortDirection","required":false,"description":"Sort direction: 'asc' for ascending, 'desc' for descending. Defaults to 'asc' if not specified."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","required":false,"uiComponent":{"type":"NUMERIC"},"description":"Number of items to return per page. Use with offset for pagination through large directories."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","required":false,"uiComponent":{"type":"NUMERIC"},"description":"Number of items to skip for pagination. Use with pageSize to paginate through large directories."}
   *
   * @sampleResult {"data":[{"name":"documents","createdOn":1609459200000,"updatedOn":1609459200000,"publicUrl":"https://your-app.Flowrunner.app/api/files/documents","url":"documents"},{"name":"config.json","createdOn":1609459200000,"updatedOn":1609459200000,"publicUrl":"https://your-app.Flowrunner.app/api/files/config.json","size":1024,"url":"config.json"}],"totalRows":2}
   */
  async listDirectory(appId, directoryPath, pattern, sub, sortBy, sortDirection, pageSize, offset) {
    const client = this.#getClient()

    directoryPath = this.#composeTargetPath(directoryPath)

    const params = {
      sub: !!sub,
    }

    if (pattern) params.pattern = pattern
    if (sortBy) params.sortBy = sortBy
    if (sortDirection) params.sortDirection = sortDirection
    if (pageSize) params.pageSize = pageSize
    if (offset) params.offset = offset

    return client.files.loadDirectory(appId, directoryPath, params)
  }

  // ======================================= ACTIONS: MESSAGING ========================================

  /**
   * @operationName Send Email
   * @category Messaging
   * @description Sends email messages using Backendless email templates with support for multiple recipients, CC/BCC, and file attachments.
   *
   * @appearanceColor #9DCEF2 #408EC6
   * @executionTimeoutInSeconds 120
   * @route POST /send-email
   *
   * @paramDef {"type":"String","label":"App","name":"appId","required":true,"dictionary":"getAppsDictionary","description":"Select the Backendless application to send emails from. This determines which app's messaging service will be used for the operation."}
   * @paramDef {"type":"String","label":"API Key","name":"apiKey","required":false,"dictionary":"getApiKeysDictionary","dependsOn":["appId"],"description":"Select the Backendless API Key which will be used for connecting to the Backendless application. By default, it uses REST API Key."}
   * @paramDef {"type":"String","label":"Email Template","name":"emailTemplate","required":true,"dictionary":"getEmailTemplatesDictionary","dependsOn":["appId"],"description":"The name of the Backendless email template to use."}
   * @paramDef {"type":"Array","label":"Send To","name":"sendTo","description":"A list of email addresses to deliver an email generated from the template to. At least one of `Send To`, `CC`, or `BCC` must be provided."}
   * @paramDef {"type":"Array","label":"CC","name":"cc","description":"A list of email addresses to include into the CC (carbon copy) distribution list of the email message generated from the template. At least one of `Send To`, `CC`, or `BCC` must be provided."}
   * @paramDef {"type":"Array","label":"BCC","name":"bcc","description":"A list of email addresses to include into the BCC (blind carbon copy) distribution list of the email message generated from the template. At least one of `Send To`, `CC`, or `BCC` must be provided."}
   * @paramDef {"type":"String","label":"Criteria","name":"criteria","description":"A where clause for the `Users` table which defined the condition for selecting the users who will be receiving an email message generated from the template. The resulting collection of users takes precedence of the email addresses (if any are) provided through the `address` property. Example: `name = 'Bob'`"}
   * @paramDef {"type":"Array","label":"Attachments","name":"attachments","description":"An array of string values representing paths to the files stored in the Backendless Cloud. Specified files are attached to the email message. The path begins from the root of the Backendless Cloud without the leading slash. For instance, if the file `agreement.txt` is located at `/documents/legal/agreement.txt`, then the path passed to the parameter must be `documents/legal/agreement.txt`."}
   *
   * @returns {Object}
   * @sampleResult {"messageId":"mail:bca18d4e-f74b-1c93-602e-dc68e147b934","errorMessage":null,"status":"SCHEDULED","sendingTimeInMillis":null,"successfulSendsAmount":null,"failedSendsAmount":null}
   */
  async sendEmail(appId, apiKey, emailTemplate, sendTo, cc, bcc, criteria, attachments) {
    const apiSdk = await this.#getApiSdk(appId, apiKey)

    if (!sendTo?.length && !cc?.length && !bcc?.length && !criteria) {
      throw new Error('At least one of "Send To", "CC", "BCC", or "Criteria" must be provided.')
    }

    const emailEnvelope = new apiSdk.EmailEnvelope.create()

    if (sendTo) {
      emailEnvelope.setTo(sendTo)
    }

    if (cc) {
      emailEnvelope.setCc(cc)
    }

    if (bcc) {
      emailEnvelope.setBcc(bcc)
    }

    if (criteria) {
      emailEnvelope.setQuery(criteria)
    }

    return apiSdk.Messaging.sendEmailFromTemplate(
      emailTemplate,
      emailEnvelope,
      attachments
    )
  }

  /**
   * @operationName Send Push Notification
   * @category Messaging
   * @description Sends push notifications using Backendless push templates with customizable parameters for dynamic content.
   *
   * @appearanceColor #9DCEF2 #408EC6
   * @executionTimeoutInSeconds 120
   * @route POST /send-push
   *
   * @paramDef {"type":"String","label":"App","name":"appId","required":true,"dictionary":"getAppsDictionary","description":"Select the Backendless application to send push notifications from. This determines which app's messaging service and registered devices will be used for the operation."}
   * @paramDef {"type":"String","label":"API Key","name":"apiKey","required":false,"dictionary":"getApiKeysDictionary","dependsOn":["appId"],"description":"Select the Backendless API Key which will be used for connecting to the Backendless application. By default, it uses REST API Key."}
   * @paramDef {"type":"String","label":"Push Template","name":"pushTemplate","required":true,"dictionary":"getPushTemplatesDictionary","dependsOn":["appId"],"description":"The name of the Backendless push template from which the notification will be created."}
   * @paramDef {"type":"Object","label":"Template Values","name":"params","description":"An object containing values which will be used for Smart and Dynamic text substitutions. The key names in the object are matched against the *Smart/Dynamic* text placeholder names. The corresponding values are used for substitution in the resulting email message. Example: `{'name':'John','age':25}`"}
   *
   * @returns {Object}
   * @sampleResult {"messageId":"mail:bca18d4e-f74b-1c93-602e-dc68e147b934","errorMessage":null,"status":"SCHEDULED","sendingTimeInMillis":0,"successfulSendsAmount":1,"failedSendsAmount":0}
   */
  async sendPushNotification(appId, apiKey, pushTemplate, params) {
    const apiSdk = await this.#getApiSdk(appId, apiKey)

    return apiSdk.Messaging.pushWithTemplate(pushTemplate, params)
  }

  // ======================================= ACTIONS: PDF ========================================

  /**
   * @operationName Generate PDF
   * @category PDF
   * @description Generates PDF documents from HTML templates using Backendless template system.
   *
   * @appearanceColor #F4C3C5 #ED797E
   * @executionTimeoutInSeconds 120
   * @route POST /generate-pdf
   *
   * @paramDef {"type":"String","label":"App","name":"appId","required":true,"dictionary":"getAppsDictionary","description":"Select the Backendless application to generate PDFs from. This determines which app's PDF service will be used for the operation."}
   * @paramDef {"type":"String","label":"API Key","name":"apiKey","required":false,"dictionary":"getApiKeysDictionary","dependsOn":["appId"],"description":"Select the Backendless API Key which will be used for connecting to the Backendless application. By default, it uses REST API Key."}
   * @paramDef {"type":"String","label":"Template","name":"templateId","required":true,"dictionary":"getPdfTemplatesDictionary","dependsOn":["appId"],"description":"ID of the HTML template to use for PDF generation."}
   * @paramDef {"type":"String","label":"File Name","name":"fileName","required":true,"description":"Name for the generated PDF file including extension. Example: `generated.pdf`"}
   * @paramDef {"type":"String","label":"File Path","name":"filePath","required":true,"description":"Complete path where the PDF will be saved in Backendless storage. Example: `/path/to/folder`"}
   * @paramDef {"type":"String","label":"Template Values","name":"values","description":"Key\u2013value pairs for **dynamic fields** defined in the template's *Field List*."}
   *
   * @sampleResult {"path":"path/to/folder/generated.pdf","__fileUrlAware":true,"fileURL":"https://test.Flowrunner.app/api/files/path/to/folder/generated.pdf"}
   */
  async generatePDF(appId, apiKey, templateId, fileName, filePath, values) {
    const client = this.#getClient()

    const template = await client.pdf.loadTemplate(appId, templateId)
    logger.debug('template:', JSON.stringify(template))

    return client.pdf.generatePDF(appId, {
      template: JSON.stringify(template),
      values: values || {},
      name: fileName,
      path: filePath,
    })
  }

  // ======================================= PRIVATE FILE HELPERS ========================================

  #composeTargetPath(dirPath) {
    return path.join('/', dirPath || '')
  }

  #appRequest(apiSdk, { url, method }) {
    return apiSdk.Request[method || 'get'](`${ apiSdk.appPath }${ url }`)
  }

  async #getAppAPIInfo(apiSdk) {
    if (!this.apiInfo) {
      this.apiInfo = await this.#appRequest(apiSdk, { url: '/info' })
    }

    return this.apiInfo
  }

  async #getServerBaseURL(apiSdk) {
    const apiInfo = await this.#getAppAPIInfo(apiSdk)

    return `${ apiInfo.filesURL }/${ apiInfo.appId }/${ apiInfo.apiKey }/files`
  }

  async #getPublicCloudeDomain(apiSdk) {
    try {
      const domains = await this.#appRequest(apiSdk, { url: '/domains' })

      if (domains.length) {
        const domain = domains[0]

        return `${ domain.useSSL ? 'https' : 'http' }://${ domain.domain }/api/files`
      }
    } catch (error) {
      logger.error(`Failed to load domains: ${ error.message }`)
    }

    return null
  }

  async #getPublicBaseURL(apiSdk) {
    const publicCloudeDomain = await this.#getPublicCloudeDomain(apiSdk)

    if (publicCloudeDomain) {
      return publicCloudeDomain
    }

    const apiInfo = await this.#getAppAPIInfo(apiSdk)

    return `${ apiInfo.apiURL }/${ apiInfo.appId }/${ apiInfo.apiKey }/files`
  }

  async #replaceWithPublicBaseURL(apiSdk, fileURL) {
    const serverBaseURL = await this.#getServerBaseURL(apiSdk)
    const publicBaseURL = await this.#getPublicBaseURL(apiSdk)

    if (publicBaseURL && fileURL && fileURL.startsWith(serverBaseURL)) {
      return fileURL.replace(serverBaseURL, publicBaseURL)
    }

    return fileURL
  }
}

Flowrunner.ServerCode.addService(BackendlessService, [
  {
    displayName: 'Client ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    name: 'clientId',
    hint: 'Your OAuth 2.0 Client ID from the Backendless Cluster',
  },
  {
    displayName: 'Client Secret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    name: 'clientSecret',
    hint: 'Your OAuth 2.0 Client Secret from the Backendless Cluster',
  },
  {
    displayName: 'Cluster Zone',
    name: 'clusterKey',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.CHOICE,
    options: Object.keys(ClustersHosts),
    required: true,
    shared: true,
    defaultValue: 'DevTest(SHOULD_NOT_BE_IN_PROD)',
    hint: 'Select the Backendless cluster where your app is located',
  },
  {
    displayName: 'Cluster Console URL',
    name: 'clusterConsoleURL',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    defaultValue: '',
    hint: 'Provide when you need to specify your own Backendless PRO cluster. Example: https://develop.Flowrunner.com',
  },
])

function cleanupObject(data) {
  if (!data) {
    return {}
  }

  const result = {}

  Object.keys(data).forEach(key => {
    const value = data[key]

    if (value === undefined || value === null) {
      return
    }

    if (typeof value === 'string' && value.trim() === '') {
      return
    }

    result[key] = value
  })

  return result
}

function normalizeOauthError(error) {
  if (typeof error.message !== 'string') {
    const newError = new Error(JSON.stringify(error.message))
    newError.code = error.status
    newError.status = error.headers
    newError.headers = error.headers
    newError.body = error.headers

    return newError
  }

  return error
}
