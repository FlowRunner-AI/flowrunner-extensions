const { createClient } = require('backendless-console-sdk')

const ClustersHosts = {
  'US': 'https://develop.backendless.com',
  'Europe': 'https://eu-develop.backendless.com',
  'Stage(SHOULD_NOT_BE_IN_PROD)': 'https://stage.backendless.com',
  'DevTest(SHOULD_NOT_BE_IN_PROD)': 'https://devtest.backendless.com',
  'Local(SHOULD_NOT_BE_IN_PROD)': 'http://localhost:3001',
}

const logger = {
  info: (...args) => console.log('[Backendless Data Service] info:', ...args),
  debug: (...args) => console.log('[Backendless Data Service] debug:', ...args),
  error: (...args) => console.log('[Backendless Data Service] error:', ...args),
  warn: (...args) => console.log('[Backendless Data Service] warn:', ...args),
}

const EventTypes = {
  onRecordCreated: 'CREATE',
  onRecordUpdated: 'UPDATE',
  onRecordDeleted: 'DELETE',
}

const MethodTypes = Object.keys(EventTypes).reduce((acc, key) => ((acc[EventTypes[key]] = key), acc), {})

const MethodCallTypes = {
  SHAPE_EVENT: 'SHAPE_EVENT',
  FILTER_TRIGGER: 'FILTER_TRIGGER',
}

const SystemColumns = ['objectId', '___class', 'created', 'updated', 'ownerId']

/**
 *  @requireOAuth
 *  @integrationName Backendless Data Service
 *  @integrationTriggersScope SINGLE_APP
 *  @integrationIcon /icon.png
 **/
class BackendlessDataService {
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
      const response = await Backendless.Request.post(`${ this.clusterURL }/developer/oauth2/token`)
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

    const { expires_in, access_token, refresh_token } = await Backendless.Request
      .post(`${ this.clusterURL }/developer/oauth2/token`)
      .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
      .set(this.#getSecretTokenHeader())
      .send(params.toString())

    let userInfo = {}

    try {
      userInfo = await Backendless.Request
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
          service: 'DATA_SERVICE',
          operation,
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

  // ==================================== END OF DICTIONARIES ====================================

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

  // ======================================= DYNAMIC PARAM SCHEMA LOADERS ========================

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

  // ======================================= END OF DYNAMIC PARAM SCHEMA LOADERS =================

  /**
   * @operationName Delete Record In Database
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
}

Backendless.ServerCode.addService(BackendlessDataService, [
  {
    displayName: 'Client ID',
    type: Backendless.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    name: 'clientId',
    hint: 'Your OAuth 2.0 Client ID from the Backendless Cluster',
  },
  {
    displayName: 'Client Secret',
    type: Backendless.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    name: 'clientSecret',
    hint: 'Your OAuth 2.0 Client Secret from the Backendless Cluster',
  },
  {
    displayName: 'Cluster Zone',
    name: 'clusterKey',
    type: Backendless.ServerCode.ConfigItems.TYPES.CHOICE,
    options: Object.keys(ClustersHosts),
    required: false,
    defaultValue: 'DevTest(SHOULD_NOT_BE_IN_PROD)',
    hint: 'Select the Backendless cluster where your app is located',
  },
  {
    displayName: 'Cluster Console URL',
    name: 'clusterConsoleURL',
    type: Backendless.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    defaultValue: '',
    hint: 'Provide when you need to specify your own Backendless PRO cluster. Example: https://develop.backendless.com',
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
