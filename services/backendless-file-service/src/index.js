const path = require('path')
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
  info: (...args) => console.log('[Backendless File Service] info:', ...args),
  debug: (...args) => console.log('[Backendless File Service] debug:', ...args),
  error: (...args) => console.log('[Backendless File Service] error:', ...args),
  warn: (...args) => console.log('[Backendless File Service] warn:', ...args),
}

const EventTypes = {
  onFileCopied: 'COPY_FILE_OR_DIRECTORY',
  onFileDeleted: 'DELETE_FILE_OR_DIRECTORY',
  onFileDownloaded: 'DOWNLOAD',
  onFileMoved: 'MOVE_FILE_OR_DIRECTORY',
  onFileRenamed: 'RENAME_FILE_OR_DIRECTORY',
  onFileUploaded: 'UPLOAD',
}

const MethodTypes = Object.keys(EventTypes).reduce((acc, key) => ((acc[EventTypes[key]] = key), acc), {})

const MethodCallTypes = {
  SHAPE_EVENT: 'SHAPE_EVENT',
  FILTER_TRIGGER: 'FILTER_TRIGGER',
}

/**
 *  @requireOAuth
 *  @integrationName Backendless Files Service
 *  @integrationTriggersScope SINGLE_APP
 *  @integrationIcon /icon.png
 **/
class BackendlessFileService {
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
          service: 'FILE_SERVICE',
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

  // ==================================== END OF DICTIONARIES ====================================

  /**
   * @operationName Create Directory
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
   * @sampleResult {"fileName":"activity.log","directoryPath":"/logs","filePath":"/logs/activity.log","fileURL":"https://your-app.backendless.app/api/files/logs/activity.log"}
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
   * @sampleResult {"fileName":"user-report.json","directoryPath":"/reports","fileURL":"https://your-app.backendless.app/api/files/reports/user-report.json","filePath":"/reports/user-report.json"}
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
   * @sampleResult {"data":[{"name":"documents","createdOn":1609459200000,"updatedOn":1609459200000,"publicUrl":"https://your-app.backendless.app/api/files/documents","url":"documents"},{"name":"config.json","createdOn":1609459200000,"updatedOn":1609459200000,"publicUrl":"https://your-app.backendless.app/api/files/config.json","size":1024,"url":"config.json"}],"totalRows":2}
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

  // ------- PRIVATE METHODS ====>

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

Flowrunner.ServerCode.addService(BackendlessFileService, [
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
    defaultValue: '',
    hint: 'Provide when you need to specify your own Backendless PRO cluster. Example: https://develop.backendless.com',
  },
])

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
