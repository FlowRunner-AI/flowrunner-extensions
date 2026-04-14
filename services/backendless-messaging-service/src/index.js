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
  info: (...args) => console.log('[Backendless Messaging Service] info:', ...args),
  debug: (...args) => console.log('[Backendless Messaging Service] debug:', ...args),
  error: (...args) => console.log('[Backendless Messaging Service] error:', ...args),
  warn: (...args) => console.log('[Backendless Messaging Service] warn:', ...args),
}

const EventTypes = {
  onPushNotificationPublished: 'PUBLISH',
  onPushNotificationWithTemplateSent: 'SEND_PUSH_NOTIFICATION_WITH_TEMPLATE',
}

const MethodTypes = Object.keys(EventTypes).reduce((acc, key) => ((acc[EventTypes[key]] = key), acc), {})

const MethodCallTypes = {
  SHAPE_EVENT: 'SHAPE_EVENT',
  FILTER_TRIGGER: 'FILTER_TRIGGER',
}

/**
 * @requireOAuth
 * @integrationName Backendless Messaging Service
 * @integrationTriggersScope SINGLE_APP
 * @integrationIcon /icon.png
 **/
class BackendlessMessagingService {
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
          service: 'MESSAGING_SERVICE',
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

  // ======================================= DICTIONARIES ========================================

  /**
   * @typedef {Object} DictionaryPayload
   * @property {String} [search]
   * @property {Object} [criteria]
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

  // ==================================== END OF DICTIONARIES ====================================

  /**
   * @operationName Send Email
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
}

Flowrunner.ServerCode.addService(BackendlessMessagingService, [
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
