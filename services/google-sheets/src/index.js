const Sheets = require('google-spreadsheet').GoogleSpreadsheet
const Auth = require('@googleapis/oauth2')
const Drive = require('@googleapis/drive')
const crypto = require('crypto')
const Papa = require('papaparse')
const { Buffer } = require('buffer')

const logger = {
  info: (...args) => console.log('[Google Sheets Service] info:', ...args),
  debug: (...args) => console.log('[Google Sheets Service] debug:', ...args),
  error: (...args) => console.log('[Google Sheets Service] error:', ...args),
  warn: (...args) => console.log('[Google Sheets Service] warn:', ...args),
}

const MY_DRIVE_ID = 'MY_GOOGLE_DRIVE'
const MY_DRIVE_LABEL = 'My Google Drive'
const DEFAULT_LIMIT = 100

// Drive push channels expire; refresh once one is within this window of expiring. The refresh
// handler runs every 60s (see refreshIntervalInSeconds), so this leaves several attempts before
// the channel actually lapses.
const WEBHOOK_REFRESH_LEAD_MS = 5 * 60 * 1000

const DEFAULT_SCOPE_LIST = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/spreadsheets.readonly',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
  'https://www.googleapis.com/auth/drive.activity.readonly',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/userinfo.email',
]

const DEFAULT_SCOPE_STRING = DEFAULT_SCOPE_LIST.join(' ')

const ColorMap = {
  White: { red: 1, green: 1, blue: 1 },
  Black: { red: 0, green: 0, blue: 0 },
  Red: { red: 1, green: 0, blue: 0 },
  Green: { red: 0, green: 0.5, blue: 0 },
  Blue: { red: 0, green: 0, blue: 1 },
  Yellow: { red: 1, green: 1, blue: 0 },
  Purple: { red: 0.5, green: 0, blue: 0.5 },
  Pink: { red: 1, green: 0.75, blue: 0.8 },
  Gray: { red: 0.5, green: 0.5, blue: 0.5 },
  'Light Blue': { red: 0.68, green: 0.85, blue: 0.9 },
  'Light Green': { red: 0.56, green: 0.93, blue: 0.56 },
  'Light Yellow': { red: 1, green: 1, blue: 0.88 },
  'Light Gray': { red: 0.83, green: 0.83, blue: 0.83 },
  Orange: { red: 1, green: 0.65, blue: 0 },
  Cyan: { red: 0, green: 1, blue: 1 },
  Indigo: { red: 0.29, green: 0, blue: 0.51 },
  Violet: { red: 0.93, green: 0.51, blue: 0.93 },
}

const MethodCallTypes = {
  SHAPE_EVENT: 'SHAPE_EVENT',
  FILTER_TRIGGER: 'FILTER_TRIGGER',
}

/**
 *  @requireOAuth
 *  @usesFileStorage
 *  @integrationName Google Sheets
 *  @integrationTriggersScope SINGLE_APP
 *  @integrationIcon /icon.png
 **/
class GoogleSheets {
  constructor(config) {
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret

    this.scope = DEFAULT_SCOPE_STRING

    this.documentsCache = {}
    this.sheetsCache = {}
  }

  /**
   * @private
   */
  #getDocument(documentId) {
    assert(documentId, 'Spreadsheet(document) ID must be provided.')

    if (!this.documentsCache[documentId]) {
      this.documentsCache[documentId] = new Sheets(documentId, {
        token: this.#getAccessToken(),
      })
    }

    return this.documentsCache[documentId]
  }

  /**
   * @private
   */
  async #getSheet(documentId, sheetId) {
    assert(documentId, 'Document ID is required.')
    assert(typeof sheetId === 'number', 'Sheet ID is required and must be a number.')

    const cacheKey = `${ documentId }-${ sheetId }`

    if (!this.sheetsCache[cacheKey]) {
      const doc = this.#getDocument(documentId)

      assert(doc, `Document with ID ${ documentId } does not exist.`)

      await doc.loadInfo()

      const sheet = doc.sheetsById[sheetId]

      assert(sheet, `Sheet with ID ${ sheetId } does not exist.`)

      this.sheetsCache[cacheKey] = sheet
    }

    return this.sheetsCache[cacheKey]
  }

  /**
   * Build a URL-safe A1 range. Sheet titles containing spaces, apostrophes, '!' or '/' must be
   * single-quoted in A1 notation (with any internal apostrophe doubled) or Google rejects the
   * range — and the result still has to be percent-encoded to survive the URL path.
   * @private
   */
  #a1Range(sheetName, range) {
    const quoted = `'${ String(sheetName).replace(/'/g, "''") }'`

    return encodeURIComponent(`${ quoted }!${ range }`)
  }

  /**
   * Spreadsheet column letter for a zero-based index: 0 -> A, 25 -> Z, 26 -> AA.
   * String.fromCharCode(65 + index) alone produces '[', '\' … past column Z.
   * @private
   */
  #columnLetter(index) {
    let n = Number(index)
    let letters = ''

    do {
      letters = String.fromCharCode(65 + (n % 26)) + letters
      n = Math.floor(n / 26) - 1
    } while (n >= 0)

    return letters
  }

  /**
   * @private
   */
  #getAccessToken() {
    return this.request.headers['oauth-access-token']
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
    params.append('access_type', 'offline')
    params.append('prompt', 'consent')

    return `https://accounts.google.com/o/oauth2/v2/auth?${ params.toString() }`
  }

  /**
   * @typedef {Object} refreshToken_ResultObject
   *
   * @property {String} token
   * @property {Number} expirationInSeconds
   */

  /**
   * @registerAs SYSTEM
   * @route PUT /refreshToken
   * @param {String} refreshToken
   * @returns {refreshToken_ResultObject}
   */
  async refreshToken(refreshToken) {
    try {
      const { access_token: token, expires_in: expirationInSeconds } = await Flowrunner.Request
        .post('https://oauth2.googleapis.com/token')
        .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        .query({
          client_id: this.clientId,
          scope: this.scope,
          refresh_token: refreshToken,
          grant_type: 'refresh_token',
          client_secret: this.clientSecret,
        })

      return { token, expirationInSeconds }
    } catch (error) {
      logger.debug('refreshToken error:', error.message)

      if (error.body?.error === 'invalid_grant') {
        throw new Error('Refresh token expired or invalid, please re-authenticate.')
      }

      throw error
    }
  }

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
   * @registerAs SYSTEM
   * @route POST /executeCallback
   * @param {Object} callbackObject
   * @returns {executeCallback_ResultObject}
   */
  async executeCallback(callbackObject) {
    const params = new URLSearchParams()

    params.append('client_id', this.clientId)
    params.append('code', callbackObject.code)
    params.append('redirect_uri', callbackObject.redirectURI)
    params.append('grant_type', 'authorization_code')
    params.append('client_secret', this.clientSecret)

    const { access_token, expires_in, refresh_token } = await Flowrunner.Request
      .post('https://oauth2.googleapis.com/token')
      .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
      .send(params.toString())

    let identityName, identityImageURL

    try {
      const { name, email, picture } = await Flowrunner.Request
        .get('https://www.googleapis.com/oauth2/v2/userinfo')
        .set({ Authorization: `Bearer ${ access_token }` })

      identityName = `${ name } (${ email })`
      identityImageURL = picture
    } catch (e) {
      logger.debug(`Can't load user profile: ${ JSON.stringify({ error: e.body?.error || e.message, currentScope: this.scope }) }`)
    }

    return {
      token: access_token,
      refreshToken: refresh_token,
      expirationInSeconds: expires_in,
      overwrite: true,
      connectionIdentityName: identityName || 'Google Sheets User',
      connectionIdentityImageURL: identityImageURL,
    }
  }

  /**
   * @private
   */
  async #executeApiMethod(logTag, payload, operation) {
    try {
      logger.debug(`executeApiMethod:${ logTag }`)

      return operation()
    } catch (error) {
      logger.debug(`executeApiMethod:${ logTag } - error: ${ error.message }`)

      throw error
    }
  }

  /**
   * @private
   */
  initDrive() {
    const auth = new Auth.auth.OAuth2()

    auth.setCredentials({
      access_token: this.#getAccessToken(),
      scope: this.scope,
      token_type: 'Bearer',
    })

    return Drive.drive({ version: 'v3', auth })
  }

  /**
   * @private
   */
  async createWebhook(callbackUrl, fileId) {
    const drive = this.initDrive()
    const channelId = crypto.randomUUID()

    logger.debug(`createWebhook: channelId=${ channelId }, callbackUrl=${ callbackUrl }, fileId=${ fileId }`)

    try {
      const res = await drive.files.watch({
        fileId,
        supportsAllDrives: true,
        requestBody: {
          payload: true,
          id: channelId,
          type: 'web_hook',
          address: callbackUrl,
        },
      })

      logger.debug(`createWebhook.web_hook: ${ JSON.stringify(res) }`)

      const { expiration, resourceId } = res.data

      return { channelId, resourceId, fileId, expiration, callbackUrl }
    } catch (error) {
      logger.error(`failed to create a webhook: ${ error.errors ? JSON.stringify(error.errors) : error.message }`)

      throw error
    }
  }

  /**
   * @private
   */
  async deleteWebhook(channelId, resourceId) {
    const drive = this.initDrive()

    logger.debug(`deleteWebhook: ${ JSON.stringify({ channelId, resourceId }) }`)

    try {
      await drive.channels.stop({ requestBody: { id: channelId, resourceId } })
    } catch (error) {
      logger.error(`failed to delete a webhook. ${ JSON.stringify({ error: error.response?.data?.error || error.message }) }`)
    }
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerUpsertWebhook(invocation) {
    logger.debug(`handleTriggerUpsertWebhook.invocation: ${ JSON.stringify(invocation) }`)

    const webhookData = invocation.webhookData || {}

    logger.debug(`handleTriggerUpsertWebhook.webhookData: ${ JSON.stringify(webhookData) }`)

    const eventFileIds = invocation.events.map(({ triggerData }) => triggerData.documentId)
    const webhookFileIds = Object.keys(webhookData)

    const webhookPromises = eventFileIds
      .filter(fileId => !webhookFileIds.includes(fileId))
      .map(async fileId => {
        const callbackUrl = `${ invocation.callbackUrl }&connectionId=${ invocation.connectionId }`

        webhookData[fileId] = await this.createWebhook(callbackUrl, fileId)
      })

    const deletePromises = webhookFileIds
      .filter(fileId => !eventFileIds.includes(fileId))
      .map(fileId => {
        const { channelId, resourceId } = webhookData[fileId]

        return this.deleteWebhook(channelId, resourceId)
      })

    await Promise.all([...webhookPromises, ...deletePromises])

    return {
      connectionId: invocation.connectionId,
      refreshIntervalInSeconds: 60,
      webhookData,
    }
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerRefreshWebhook(invocation) {
    const webhookData = { ...(invocation.webhookData || {}) }

    logger.debug(`handleTriggerRefreshWebhook.webhookData: ${ JSON.stringify(webhookData) }`)

    for (const fileId of Object.keys(webhookData)) {
      const { channelId, expiration, resourceId, callbackUrl } = webhookData[fileId]
      const expiresAt = Number(expiration)

      // Refresh when the channel is CLOSE to expiring. The comparison used to be inverted, which
      // recreated healthy channels every cycle and never renewed the ones about to lapse. An
      // unusable expiration is treated as due so the channel cannot get stuck.
      const isDueForRefresh = !Number.isFinite(expiresAt) ||
        expiresAt - WEBHOOK_REFRESH_LEAD_MS <= Date.now()

      if (isDueForRefresh) {
        await this.deleteWebhook(channelId, resourceId)
        webhookData[fileId] = await this.createWebhook(callbackUrl, fileId)
      }
    }

    logger.debug(`handleTriggerRefreshWebhook.updated_webhookData: ${ JSON.stringify(webhookData) }`)

    return {
      refreshIntervalInSeconds: 60,
      webhookData,
    }
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerResolveEvents(invocation) {
    logger.debug(`handleTriggerResolveEvents.invocation: ${ JSON.stringify(invocation) }`)

    const { connectionId } = invocation.queryParams

    if (invocation.headers['x-goog-resource-state'] === 'sync') {
      logger.debug('handleTriggerResolveEvents: skip \'sync\' request...')

      return { connectionId, events: [] }
    }

    const events = await this.onDocumentChanged(MethodCallTypes.SHAPE_EVENT, invocation)

    logger.debug(`handleTriggerResolveEvents.events: ${ JSON.stringify(events) }`)

    return { connectionId, events }
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerSelectMatched(invocation) {
    logger.debug(`handleTriggerSelectMatched.invocation: ${ JSON.stringify(invocation) }`)

    const result = await this.onDocumentChanged(MethodCallTypes.FILTER_TRIGGER, invocation)

    logger.debug(`handleTriggerSelectMatched.result: ${ JSON.stringify(result) }`)

    return result
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation"}
   */
  async handleTriggerDeleteWebhook(invocation) {
    logger.debug(`handleTriggerDeleteWebhook.invocation: ${ JSON.stringify(invocation) }`)

    for (const fileId of Object.keys(invocation.webhookData)) {
      const { channelId, resourceId } = invocation.webhookData[fileId]

      await this.deleteWebhook(channelId, resourceId)
    }
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerPollingForEvent(invocation) {
    logger.debug(`handleTriggerPollingForEvent.${ invocation.eventName }`)

    return this[invocation.eventName](invocation)
  }

  /**
   * @operationName On Document Changed
   * @category Triggers
   * @description Triggers when any change is made to a spreadsheet file, such as edits to cell content, structure, or formatting.
   * @registerAs REALTIME_TRIGGER
   *
   * @route POST /on-document-changed
   * @appearanceColor #00ad3c #00831e
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes https://www.googleapis.com/auth/spreadsheets
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"getSpreadsheetsDictionary","description":"Unique identifier for the spreadsheet (document that contains multiple sheets). Spreadsheet ID could be found in URL - 'https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>'"}
   *
   * @sampleResult {"resourceId":"t-nfBJgvxxxxxaxsLA9E","expiration":"Fri, 18 Apr 2025 20:32:11 GMT","resourceUri":"https://www.googleapis.com/drive/v3/files/1xxxyY9k_xxxxxwm7m8xxxxTC1O_ZyO-prqM?alt=json&supportsAllDrives=true","channelId":"7735aa12-xxxx-xxxx-xxxx-abada9b4376e","documentId":"1xxxx9k_Eh1gQdyxxxxxxTCxxxxx-prqM"}
   */
  async onDocumentChanged(callType, payload) {
    if (callType === MethodCallTypes.SHAPE_EVENT) {
      const resourceUri = payload.headers['x-goog-resource-uri']
      const expiration = payload.headers['x-goog-channel-expiration']
      const resourceId = payload.headers['x-goog-resource-id']
      const channelId = payload.headers['x-goog-channel-id']

      const documentId = extractFileId(resourceUri)

      logger.debug(`onDocumentChanged.documentId=${ documentId } `)

      return [
        {
          name: 'onDocumentChanged',
          data: {
            resourceUri,
            expiration,
            resourceId,
            channelId,
            documentId,
          },
        },
      ]
    }

    if (callType === MethodCallTypes.FILTER_TRIGGER) {
      const { eventData, triggers } = payload

      const triggersToActivate = triggers
        .filter(({ data }) => data.documentId === eventData.documentId)
        .map(({ id }) => id)

      return { ids: triggersToActivate }
    }
  }

  /**
   * @operationName On New Row
   * @category Triggers
   * @description Monitors Google Sheets for new rows and triggers AI workflows when data is added. Perfect for automated processing of form submissions, real-time data analysis, or immediate response to user input in collaborative spreadsheets. Polling interval can be customized (minimum 30 seconds).
   * @registerAs POLLING_TRIGGER
   *
   * @route POST /on-new-row
   * @appearanceColor #f9566d #fb874b
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Drive","name":"sharedDriveId","required":false,"dictionary":"getDrivesDictionary","description":"Choose which drive to monitor. If left blank, your personal Google Drive will be used by default. If you're part of any Google Shared Drives, you can select one from the list."}
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"getSpreadsheetsDictionary","description":"Unique identifier for the spreadsheet (document containing multiple sheets). Spreadsheet ID could be found in URL - 'https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>'"}
   * @paramDef {"type":"Number","label":"Sheet","name":"sheetId","required":true,"dictionary":"getSheetsDictionary","dependsOn":["documentId"],"description":"Sheet ID which will be listened for updated. Could be found in URL - '...gid=<SHEET_ID>'"}
   *
   * @returns {Object}
   * @sampleResult {"rowNumber":25,"data":{"col1":"1","col2":"2","col3":"3"}}
   */
  async onNewRow(invocation) {
    const { documentId, sheetId } = invocation.triggerData
    const { rowsCount = 0 } = invocation.state || {}

    const sheet = await this.#getSheet(documentId, sheetId)
    const rows = await sheet.getRows()

    const currentCount = rows.length

    if (invocation.learningMode) {
      const firstRow = rows && rows[0]

      return {
        events: firstRow ? [deserializeRow(firstRow)] : [],
        state: null,
      }
    }

    logger.debug(`[onNewRow] init with records.length=${ currentCount }`)

    if (rowsCount === 0 || currentCount <= rowsCount) {
      return {
        events: [],
        state: { rowsCount: currentCount },
      }
    }

    const newRows = rows.slice(-1 * (currentCount - rowsCount))
    const events = newRows.map(deserializeRow)

    return {
      events,
      state: { rowsCount: currentCount },
    }
  }

  /**
   * @operationName On New or Updated Row
   * @category Triggers
   * @description Will be triggered when a new row is added or an existing row is updated. Polling interval can be customized (minimum 30 seconds).
   * @registerAs POLLING_TRIGGER
   *
   * @route POST /on-new-or-updated-row
   * @appearanceColor #f9566d #fb874b
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"getSpreadsheetsDictionary","description":"Unique identifier for the spreadsheet (document containing multiple sheets). Spreadsheet ID could be found in URL - 'https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>'"}
   * @paramDef {"type":"Number","label":"Sheet","name":"sheetId","required":true,"dictionary":"getSheetsDictionary","dependsOn":["documentId"],"description":"Sheet ID which will be listened for updated. Could be found in URL - '...gid=<SHEET_ID>'"}
   * @paramDef {"type":"String","label":"Trigger Column","name":"column","required":true,"dictionary":"getSheetColumnsDictionary","dependsOn":["documentId","sheetId"],"description":"Column name (value in the header) that will be used in comparing to detect changes."}
   *
   * @returns {Object}
   * @sampleResult {"rowNumber":25,"data":{"col1":"1","col2":"2","col3":"3"}}
   */
  async onNewOrUpdatedRow(invocation) {
    const { documentId, sheetId, column } = invocation.triggerData

    const sheet = await this.#getSheet(documentId, sheetId)

    const rows = await sheet.getRows()

    if (invocation.learningMode) {
      const firstRow = rows && rows[0]

      return {
        events: firstRow ? [deserializeRow(firstRow)] : [],
        state: null,
      }
    }

    const columnValues = rows.map(row => row.toObject()[column])

    if (!invocation.state?.columnValues) {
      logger.debug(`[onNewOrUpdatedRow] init with trigger column: ${ column } and values:${ JSON.stringify(columnValues) }`)

      return {
        events: [],
        state: { columnValues },
      }
    }

    const events = columnValues
      .map((value, i) => {
        if (invocation.state.columnValues[i] === null && value === undefined) {
          return null
        }

        return value !== invocation.state.columnValues[i]
          ? deserializeRow(rows[i])
          : null
      })
      .filter(Boolean)

    return {
      events,
      state: { columnValues },
    }
  }

  /**
   * @private
   */
  async #getDocumentsList(pageToken, driveId) {
    const query = {
      q: 'mimeType=\'application/vnd.google-apps.spreadsheet\'',
      fields: 'nextPageToken, files(id, name, createdTime)',
      orderBy: 'createdTime desc',
      pageSize: DEFAULT_LIMIT,
    }

    if (pageToken != null) {
      query.pageToken = pageToken
    }

    const sharedDriveId = resolveSharedDriveId(driveId)

    if (sharedDriveId) {
      Object.assign(query, {
        driveId: sharedDriveId,
        corpora: 'drive',
        includeItemsFromAllDrives: true,
        supportsAllDrives: true,
      })
    }

    const { files, nextPageToken } = await Flowrunner.Request.get('https://www.googleapis.com/drive/v3/files')
      .set({ Authorization: `Bearer ${ this.#getAccessToken() }` })
      .query(query)

    return { files, nextPageToken }
  }

  /**
   * @operationName On New Document
   * @category Triggers
   * @description Triggers when a new spreadsheet document created. Polling interval can be customized (minimum 30 seconds).
   * @registerAs POLLING_TRIGGER
   *
   * @route POST /on-new-file
   * @appearanceColor #f9566d #fb874b
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Drive","name":"sharedDriveId","required":false,"dictionary":"getDrivesDictionary","description":"Choose which drive to monitor. If left blank, your personal Google Drive will be used by default. If you're part of any Google Shared Drives, you can select one from the list."}
   *
   * @returns {Object}
   * @sampleResult {"id": "long-string-id","name": "MyFileName","createdTime": "2025-05-14T16:00:38.851Z"}
   */
  async onNewDocument(invocation) {
    const { sharedDriveId } = invocation.triggerData

    const { files } = await this.#getDocumentsList(null, sharedDriveId)

    if (invocation.learningMode) {
      const file = files ? files[0] : null

      return {
        events: file ? [file] : [],
        state: null,
      }
    }

    if (!invocation.state?.files) {
      logger.debug(`[onNewDocument] init with documents:${ JSON.stringify(files) }`)

      return {
        events: [],
        state: { files },
      }
    }

    const prevIDs = new Set(invocation.state.files.map(({ id }) => id))

    return {
      events: files.filter(({ id }) => !prevIDs.has(id)),
      state: { files },
    }
  }

  /**
   * @operationName On New Sheet
   * @category Triggers
   * @description Triggers when a new sheet is added to the document. Polling interval can be customized (minimum 30 seconds).
   * @registerAs POLLING_TRIGGER
   *
   * @route POST /on-new-sheet
   * @appearanceColor #f9566d #fb874b
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Drive","name":"sharedDriveId","required":false,"dictionary":"getDrivesDictionary","description":"Choose which drive to monitor. If left blank, your personal Google Drive will be used by default. If you're part of any Google Shared Drives, you can select one from the list."}
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"description":"Unique identifier for the spreadsheet (document that contains multiple sheets). Spreadsheet ID could be found in URL - 'https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>'","dictionary":"getSpreadsheetsDictionary"}
   *
   * @returns {Object}
   * @sampleResult { "sheetId": 2070593284, "title": "CoolSheet" }
   */
  async onNewSheet(invocation) {
    const { documentId } = invocation.triggerData

    const sheets = await this.getSheetList(documentId)

    if (invocation.learningMode) {
      const sheet = sheets[0]

      return {
        events: sheet ? [sheet] : [],
        state: null,
      }
    }

    if (!invocation.state?.sheets) {
      logger.debug(`[onNewSheet] init with sheets:${ JSON.stringify(sheets) }`)

      return {
        events: [],
        state: { sheets },
      }
    }

    const prevIDs = new Set(invocation.state.sheets.map(({ sheetId }) => sheetId))

    return {
      events: sheets.filter(({ sheetId }) => !prevIDs.has(sheetId)),
      state: { sheets },
    }
  }

  // ========================================== DICTIONARIES ===========================================

  /**
   * @typedef {Object} DictionaryPayload
   * @property {String} [search]
   * @property {String} [cursor]
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
   * @property {String} cursor
   */

  /**
   * @typedef {Object} getSpreadsheetsDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Drive ID","name":"sharedDriveId","required":true,"description":"Identifier of the Google Shared Drive to list spreadsheets from."}
   */

  /**
   * @typedef {Object} getSpreadsheetsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter spreadsheets by their name. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination token for retrieving the next page of results. Use the returned cursor to fetch additional spreadsheets."}
   * @paramDef {"type":"getSpreadsheetsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required parameter to specify the Google Drive."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Spreadsheets
   * @description Returns a paginated list of spreadsheets from Google Drive. Note: search functionality filters spreadsheets only within the current page of results. Use the cursor to paginate through all available spreadsheets.
   *
   * @route POST /get-spreadsheets
   *
   * @paramDef {"type":"getSpreadsheetsDictionary__payload","label":"Payload","name":"payload","description":"Contains search string, pagination token, and required shared drive ID for retrieving and filtering spreadsheets."}
   *
   * @sampleResult {"cursor":"nextPageTokenABC","items":[{"label":"Marketing Budget Q3","note":"ID: 9G8H7J6K5L","value":"9G8H7J6K5L"}]}
   * @returns {DictionaryResponse}
   */
  async getSpreadsheetsDictionary({ search, cursor, criteria }) {
    const { files, nextPageToken } = await this.#getDocumentsList(cursor, criteria.sharedDriveId)

    const filteredFiles = search
      ? searchFilter(files, ['name'], search)
      : files

    return {
      cursor: nextPageToken,
      items: filteredFiles.map(({ id, name }) => ({
        label: name || '[empty]',
        note: `ID: ${ id }`,
        value: id,
      })),
    }
  }

  /**
   * @typedef {Object} getDrivesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter Google Drives by their name. Filtering is performed on the server side."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination token for retrieving the next page of results. Use the returned cursor to fetch additional drives."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Drives
   * @description Returns a paginated list of Google Drives (including My Drive and shared drives). Note: search functionality is performed on the server side. Use the cursor to paginate through all available drives.
   *
   * @route POST /get-drives
   *
   * @paramDef {"type":"getDrivesDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination token for retrieving and filtering Google Drives."}
   *
   * @sampleResult {"cursor":"nextPageToken123","items":[{"label":"My Drive","value":"mydriveid","note":"ID: mydriveid"}]}
   * @returns {DictionaryResponse}
   */
  async getDrivesDictionary({ search, cursor }) {
    logger.debug('[getDrivesDictionary] Payload', { search, cursor })

    const drive = this.initDrive()

    const payload = {
      pageToken: cursor,
      q: search ? `name contains '${ search }'` : undefined,
    }

    let res

    try {
      res = await drive.drives.list({ ...payload, useDomainAdminAccess: true })
    } catch {
      res = await drive.drives.list(payload)
    }

    const { nextPageToken, drives: sharedDrives } = res.data

    const drives = [{ id: MY_DRIVE_ID, name: MY_DRIVE_LABEL }, ...sharedDrives]

    return {
      cursor: nextPageToken,
      items: drives.map(({ id, name }) => ({
        label: name,
        value: id,
        note: `ID: ${ id }`,
      })),
    }
  }

  /**
   * @registerAs DICTIONARY
   *
   * @param {DictionaryPayload} payload
   * @returns {DictionaryResponse}
   */
  async getSheetsDictionary({ search, criteria }) {
    const documentId = criteria.documentId || criteria.sourceDocumentId

    const sheets = await this.getSheetList(documentId)

    const filteredSheets = search
      ? searchFilter(sheets, ['sheetId', 'title'], search)
      : sheets

    return {
      items: filteredSheets.map(({ sheetId, title }) => ({
        label: title || '[empty]',
        note: `ID: ${ sheetId }`,
        value: sheetId,
      })),
    }
  }

  /**
   * @typedef {Object} getSheetColumnsDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Document ID","name":"documentId","description":"Unique ID of the Google Sheets document. Required if 'Source Document ID' is not provided."}
   * @paramDef {"type":"String","label":"Source Document ID","name":"sourceDocumentId","description":"Unique ID of the Google Sheets document. Required if 'Document ID' is not provided."}
   */

  /**
   * @typedef {Object} getSheetColumnsDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Document ID","name":"documentId","required":true,"description":"Unique ID of the Google Sheets document."}
   * @paramDef {"type":"String","label":"Sheet ID","name":"sheetId","required":true,"description":"Unique ID of the sheet (tab) within the document."}
   */

  /**
   * @typedef {Object} getSheetColumnsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter columns by their name. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"getSheetColumnsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required parameters to identify the specific sheet within a Google Sheets document."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Sheet Columns
   * @description Returns a list of columns for the specified sheet in a Google Sheets document. Note: search functionality filters columns only within the current result set.
   *
   * @route POST /get-sheet-columns
   *
   * @paramDef {"type":"getSheetColumnsDictionary__payload","label":"Payload","name":"payload","description":"Contains search string and criteria for column lookup."}
   *
   * @sampleResult {"items":[{"label":"Date","note":"ID: COL$A","value":"Date"}]}
   * @returns {DictionaryResponse}
   */
  async getSheetColumnsDictionary({ search, criteria }) {
    const spreadsheetID = criteria.documentId
    const sheetID = criteria.sheetId

    const { sheets } = await Flowrunner.Request
      .get(`https://sheets.googleapis.com/v4/spreadsheets/${ spreadsheetID }`)
      .set({ Authorization: `Bearer ${ this.#getAccessToken() }` })

    const sheetName = sheets.find(s => s.properties.sheetId === sheetID)?.properties?.title

    if (!sheetName) {
      throw new Error(`Sheet with ID '${ sheetID }' not found.`)
    }

    const { values } = await Flowrunner.Request
      .get(`https://sheets.googleapis.com/v4/spreadsheets/${ spreadsheetID }/values/${ this.#a1Range(sheetName, '1:1') }`)
      .set({ Authorization: `Bearer ${ this.#getAccessToken() }` })

    const columns = (values?.[0] || []).map((name, index) => ({
      id: `COL$${ this.#columnLetter(index) }`,
      name,
    }))

    const filteredColumns = search
      ? searchFilter(columns, ['name'], search)
      : columns

    return {
      items: filteredColumns.map(({ id, name }) => ({
        label: name || '[empty]',
        note: `ID: ${ id }`,
        value: name,
      })),
    }
  }

  // ======================================= END OF DICTIONARIES =======================================

  /**
   * @description Allows to create a new Spreadsheet Document (sheets collection).
   *
   * @route POST /add-document
   * @operationName Add Document
   * @category Document Management
   *
   * @appearanceColor #00ad3c #00831e
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes https://www.googleapis.com/auth/spreadsheets
   *
   * @paramDef {"type":"String","label":"Title","name":"title","description":"Document Title"}
   *
   * @returns {Object}
   * @sampleResult {"documentId":"example_id_sPc8DjyB5SSLIqFWNB5DOA"}
   */
  async addDocument(title) {
    return this.#executeApiMethod('addDocument', { title }, async () => {
      const doc = await Sheets.createNewSpreadsheetDocument({ token: this.#getAccessToken() }, { title })

      return {
        documentId: doc.spreadsheetId,
      }
    })
  }

  /**
   * @description Renames an existing Google Spreadsheet document.
   *
   * @route PUT /rename-document
   * @operationName Rename Document
   * @category Document Management
   * @appearanceColor #00ad3c #00831e
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes https://www.googleapis.com/auth/spreadsheets
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"description":"Unique identifier for the spreadsheet (document that contains multiple sheets). Spreadsheet ID could be found in URL - 'https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>'","dictionary":"getSpreadsheetsDictionary"}
   * @paramDef {"type":"String","label":"New Name","name":"newName","required":true,"description":"The new name for the document."}
   */
  async renameDocument(documentId, newName) {
    return this.#executeApiMethod('renameDocument', { documentId, newName }, async () => {
      const doc = this.#getDocument(documentId)

      await doc.updateProperties({ title: newName })
    })
  }

  /**
   * @description Delete an existing Google Spreadsheet document.
   *
   * @route POST /delete-document
   * @operationName Delete Document
   * @category Document Management
   *
   * @appearanceColor #00ad3c #00831e
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes https://www.googleapis.com/auth/spreadsheets
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"getSpreadsheetsDictionary","description":"Unique identifier for the spreadsheet (document that contains multiple sheets). Spreadsheet ID could be found in URL - 'https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>'"}
   */
  async deleteDocument(documentId) {
    return this.#executeApiMethod('deleteDocument', { documentId }, async () => {
      const doc = this.#getDocument(documentId)

      await doc.delete()

      delete this.documentsCache[documentId]
    })
  }

  /**
   * @description Adds a new sheet to an existing Google Spreadsheet document. This method allows you to specify a custom sheet ID and header values for the new sheet.
   *
   * @route POST /add-sheet
   * @operationName Add Sheet
   * @category Sheet Management
   *
   * @appearanceColor #00ad3c #00831e
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes https://www.googleapis.com/auth/spreadsheets
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"description":"Unique identifier for the spreadsheet (document that contains multiple sheets). Spreadsheet ID could be found in URL - 'https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>'","dictionary":"getSpreadsheetsDictionary"}
   * @paramDef {"type":"String","label":"Sheet Title","name":"title","required":true,"description":"The title of the new sheet to be added."}
   * @paramDef {"type":"Number","label":"Sheet","name":"sheetId","description":"Optional. Specifies a custom ID for the new sheet. If not provided, a unique ID will be generated automatically."}
   * @paramDef {"type":"Array","label":"Header Values","name":"headerValues","description":"Optional. List of values that will be set as the header row in the new sheet."}
   *
   * @returns {Object} Sheet id
   * @sampleResult { "sheetId": 1778601712 }
   */
  async addSheet(documentId, title, sheetId, headerValues) {
    return this.#executeApiMethod('addSheet', { documentId, title, sheetId, headerValues }, async () => {
      assert(!sheetId || typeof sheetId === 'number', 'Sheet ID must be a number.')

      // Header Values is documented (and defaulted below) as optional — only validate its shape
      // when the caller actually supplies one.
      assert(
        headerValues === undefined || headerValues === null || Array.isArray(headerValues),
        'Header Values must be an array.'
      )

      const doc = this.#getDocument(documentId)

      const sheet = await doc.addSheet({
        title,
        sheetId,
        headerValues: headerValues || [],
      })

      return {
        sheetId: sheet.sheetId,
      }
    })
  }

  /**
   * @description Formats a specified row in an existing Google Spreadsheet.
   *
   * @route POST /format-sheet-row
   * @operationName Format Row
   * @category Formatting
   *
   * @appearanceColor #00ad3c #00831e
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes https://www.googleapis.com/auth/spreadsheets
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"getSpreadsheetsDictionary","dictionary":"getSpreadsheetsDictionary","description":"Unique identifier for the spreadsheet (document that contains multiple sheets). Spreadsheet ID could be found in URL - 'https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>'"}
   * @paramDef {"type":"Number","label":"Sheet","name":"sheetId","required":true,"dictionary":"getSheetsDictionary","dependsOn":["documentId"],"description":"ID of the sheet containing the row to format. Could be found in URL - '...gid=<SHEET_ID>'"}
   * @paramDef {"type":"Number","label":"Row Index","name":"rowIndex","required":true,"description":"Number of the row (1-based index, where 1 represents the first row)."}
   * @paramDef {"type":"String","label":"Background Color","name":"backgroundColor","uiComponent":{"type":"DROPDOWN","options":{"values":["White","Black","Red","Green","Blue","Yellow","Purple","Pink","Gray","Light Blue","Light Green","Light Yellow","Light Gray","Orange","Cyan","Indigo","Violet"]}},"description":"Background color to apply to the cells in the row."}
   * @paramDef {"type":"String","label":"Text Color","name":"textColor","uiComponent":{"type":"DROPDOWN","options":{"values":["Black","White","Red","Green","Blue","Yellow","Purple","Pink","Gray","Orange","Cyan","Indigo"]}},"description":"Text color to apply to the cells in the row."}
   * @paramDef {"type":"Boolean","label":"Text Bold","name":"textBold","uiComponent":{"type":"TOGGLE"},"description":"True to make the text bold; false otherwise."}
   * @paramDef {"type":"Boolean","label":"Text Italic","name":"textItalic","uiComponent":{"type":"TOGGLE"},"description":"True to make the text italic; false otherwise."}
   * @paramDef {"type":"Boolean","label":"Text Strikethrough","name":"textStrikethrough","uiComponent":{"type":"TOGGLE"},"description":"True to apply strikethrough to the text; false otherwise."}
   */
  async formatSpreadsheetRow(
    documentId,
    sheetId,
    rowIndex,
    backgroundColor,
    textColor,
    textBold,
    textItalic,
    textStrikethrough
  ) {
    return this.#executeApiMethod(
      'formatSpreadsheetRow',
      {
        documentId,
        sheetId,
        rowIndex,
        backgroundColor,
        textColor,
        textBold,
        textItalic,
        textStrikethrough,
      },
      async () => {
        assert(typeof sheetId === 'number', 'Sheet ID must be a number.')

        rowIndex = rowIndex - 1

        const requestData = {
          requests: [
            {
              repeatCell: {
                range: {
                  sheetId: sheetId,
                  startRowIndex: rowIndex,
                  endRowIndex: rowIndex + 1,
                },
                cell: {
                  userEnteredFormat: {
                    ...(ColorMap[backgroundColor] && {
                      backgroundColorStyle: {
                        rgbColor: ColorMap[backgroundColor],
                      },
                    }),
                    textFormat: {
                      ...(ColorMap[textColor] && {
                        foregroundColorStyle: { rgbColor: ColorMap[textColor] },
                      }),
                      bold: textBold,
                      italic: textItalic,
                      strikethrough: textStrikethrough,
                    },
                  },
                },
                fields: [
                  // Gate the mask on the SAME condition as the style above. Keying the mask off
                  // the raw label meant an unrecognized colour listed the field without supplying
                  // a value, which tells Sheets to clear the cell's existing colour.
                  ColorMap[backgroundColor]
                    ? 'userEnteredFormat.backgroundColorStyle'
                    : '',
                  ColorMap[textColor]
                    ? 'userEnteredFormat.textFormat.foregroundColorStyle'
                    : '',
                  'userEnteredFormat.textFormat.bold',
                  'userEnteredFormat.textFormat.italic',
                  'userEnteredFormat.textFormat.strikethrough',
                ]
                  .filter(Boolean)
                  .join(','),
              },
            },
          ],
        }

        await Flowrunner.Request.post(`https://sheets.googleapis.com/v4/spreadsheets/${ documentId }:batchUpdate`)
          .set({ Authorization: `Bearer ${ this.#getAccessToken() }` })
          .send(requestData)
      }
    )
  }

  /**
   * @description Deletes a specified sheet from an existing Google Spreadsheet document.
   *
   * @route POST /delete-sheet
   * @operationName Delete Sheet
   * @category Sheet Management
   *
   * @appearanceColor #00ad3c #00831e
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes https://www.googleapis.com/auth/spreadsheets
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","dictionary":"getSpreadsheetsDictionary","required":true,"description":"Unique identifier for the spreadsheet (document that contains multiple sheets). Spreadsheet ID could be found in URL - 'https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>'"}
   * @paramDef {"type":"Number","label":"Sheet","name":"sheetId","required":true,"dictionary":"getSheetsDictionary","dependsOn":["documentId"],"description":"ID of the sheet to be deleted. Could be found in URL - '...gid=<SHEET_ID>'. Default Sheet ID is not used."}
   */
  async deleteSheet(documentId, sheetId) {
    return this.#executeApiMethod('deleteSheet', { documentId, sheetId }, async () => {
      assert(typeof sheetId === 'number', 'Sheet ID must be a number.')

      const doc = this.#getDocument(documentId)

      await doc.deleteSheet(sheetId)

      delete this.sheetsCache[`${ documentId }-${ sheetId }`]
    })
  }

  /**
   * @description Renames a specific sheet within a Google Spreadsheet document. This method requires the spreadsheet ID, the sheet ID, and the new name for the sheet.
   *
   * @route PUT /rename-sheet
   * @operationName Rename Sheet
   * @category Sheet Management
   *
   * @appearanceColor #00ad3c #00831e
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes https://www.googleapis.com/auth/spreadsheets
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"description":"Unique identifier for the spreadsheet (document that contains multiple sheets). Spreadsheet ID could be found in URL - 'https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>'","dictionary":"getSpreadsheetsDictionary"}
   * @paramDef {"type":"Number","label":"Sheet","name":"sheetId","required":true,"dictionary":"getSheetsDictionary","dependsOn":["documentId"],"description":"ID of the sheet to be renamed. Could be found in URL - '...gid=<SHEET_ID>'"}
   * @paramDef {"type":"String","label":"New Name","name":"newName","required":true,"description":"The new name to be assigned to the chosen sheet."}
   */
  async renameSheet(documentId, sheetId, newName) {
    return this.#executeApiMethod('renameSheet', { documentId, sheetId, newName }, async () => {
      const sheet = await this.#getSheet(documentId, sheetId)

      await sheet.updateProperties({ title: String(newName) })
    })
  }

  /**
   * @description Loads the header row from a specified sheet within a Google Spreadsheet document. You can specify the header row index (starting at 1) if it differs from the default first row.
   *
   * @route POST /load-header-row
   * @operationName Load Header Row
   * @category Row Operations
   *
   * @appearanceColor #00ad3c #00831e
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes https://www.googleapis.com/auth/spreadsheets.readonly
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"description":"Unique identifier for the spreadsheet (document that contains multiple sheets). Spreadsheet ID could be found in URL - 'https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>'","dictionary":"getSpreadsheetsDictionary"}
   * @paramDef {"type":"Number","label":"Sheet","name":"sheetId","required":true,"dictionary":"getSheetsDictionary","dependsOn":["documentId"],"description":"ID of the sheet from which to load the header row. Could be found in URL - '...gid=<SHEET_ID>'"}
   * @paramDef {"type":"Number","label":"Header Row Index","name":"headerRowIndex","description":"Optional. Index of the header row (1-based index, where 1 represents the first row). Defaults to the first row if not provided."}
   *
   * @returns {Array<String>} A promise that resolves to the array of header values from the specified sheet.
   * @sampleResult ["example_header_1","example_header_2","example_header_3"]
   */
  async loadHeaderRow(documentId, sheetId, headerRowIndex) {
    return this.#executeApiMethod('loadHeaderRow', { documentId, sheetId, headerRowIndex }, async () => {
      const sheet = await this.#getSheet(documentId, sheetId)

      await sheet.loadHeaderRow(headerRowIndex || undefined)

      return sheet.headerValues
    })
  }

  /**
   * @description Sets the header row for a given Google Spreadsheet sheet.
   *
   * @route POST /set-header-row
   * @operationName Set Header Row
   * @category Row Operations
   *
   * @appearanceColor #00ad3c #00831e
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes https://www.googleapis.com/auth/spreadsheets
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"description":"Unique identifier for the spreadsheet (document that contains multiple sheets). Spreadsheet ID could be found in URL - 'https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>'","dictionary":"getSpreadsheetsDictionary"}
   * @paramDef {"type":"Number","label":"Sheet","name":"sheetId","required":true,"dictionary":"getSheetsDictionary","dependsOn":["documentId"],"description":"ID of the sheet chosen to set the header row. Could be found in URL - '...gid=<SHEET_ID>'"}
   * @paramDef {"type":"Array","label":"Header Row Values","name":"headerRowValues","required":true,"description":"Values to set in the header row"}
   * @paramDef {"type":"Number","label":"Header Row Index","name":"headerRowIndex","description":"Optional. Index of the header row (1-based index, where 1 represents the first row). Defaults to the first row if not provided."}
   */
  async setHeaderRow(documentId, sheetId, headerRowValues, headerRowIndex) {
    return this.#executeApiMethod(
      'setHeaderRow',
      { documentId, sheetId, headerRowValues, headerRowIndex },
      async () => {
        assert(Array.isArray(headerRowValues), 'Header row values must be provided and must be array.')

        const sheet = await this.#getSheet(documentId, sheetId)

        await sheet.setHeaderRow(headerRowValues, headerRowIndex || undefined)
      }
    )
  }

  /**
   * @description Adds multiple data rows to Google Sheets in bulk for AI agents to efficiently store large datasets, batch process results, or import data from external sources. Essential for high-volume data operations and bulk data migration workflows.
   *
   * @route POST /add-rows
   * @operationName Add Rows
   * @category Row Operations
   *
   * @appearanceColor #00ad3c #00831e
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes https://www.googleapis.com/auth/spreadsheets
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"description":"Unique identifier for the spreadsheet (document that contains multiple sheets). Spreadsheet ID could be found in URL - 'https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>'","dictionary":"getSpreadsheetsDictionary"}
   * @paramDef {"type":"Number","label":"Sheet","name":"sheetId","required":true,"dictionary":"getSheetsDictionary","dependsOn":["documentId"],"description":"ID of the sheet chosen to add rows. Could be found in URL - '...gid=<SHEET_ID>'"}
   * @paramDef {"type":"Array","label":"Rows","name":"rows","required":true,"description":"Array of rows to add. Examples: [{'Name': 'John', 'Email': 'john@example.com'}, {'Name': 'Jane', 'Email': 'jane@example.com'}] or [['John', 'john@example.com'], ['Jane', 'jane@example.com']]. Each element represents one row of data."}
   *
   * @returns {Object} Returns a success message upon completion
   */
  async addRows(documentId, sheetId, rows) {
    return this.#executeApiMethod('addRows', { documentId, sheetId, rows }, async () => {
      assert(Array.isArray(rows), 'Rows must be provided and must be array.')

      const sheet = await this.#getSheet(documentId, sheetId)

      await sheet.addRows(rows, { insert: true })
    })
  }

  /**
   * @description Adds new data rows to Google Sheets for AI agents to store processed results, log user interactions, or collect data from automated workflows. Perfect for building databases, tracking metrics, saving form submissions, or creating data collection pipelines.
   *
   * @route POST /add-row
   * @operationName Add Row
   * @category Row Operations
   *
   * @appearanceColor #00ad3c #00831e
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes https://www.googleapis.com/auth/spreadsheets
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"getSpreadsheetsDictionary","description":"Unique identifier for the spreadsheet (document that contains multiple sheets). Spreadsheet ID could be found in URL - 'https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>'"}
   * @paramDef {"type":"Number","label":"Sheet","name":"sheetId","required":true,"dictionary":"getSheetsDictionary","dependsOn":["documentId"],"description":"ID of the sheet chosen to add rows. Could be found in URL - '...gid=<SHEET_ID>'"}
   * @paramDef {"type":"Object","label":"Row","name":"row","required":true,"description":"Data to add as a new row. Can be an object with column headers as keys (e.g., {'Name': 'John Doe', 'Email': 'john@example.com', 'Score': 95}) or an array of values matching column order (e.g., ['John Doe', 'john@example.com', 95])."}
   *
   */
  async addRow(documentId, sheetId, row) {
    return this.#executeApiMethod('addRow', { documentId, sheetId, row }, async () => {
      const sheet = await this.#getSheet(documentId, sheetId)

      if (Array.isArray(row)) {
        const headerRow = await this.loadHeaderRow(documentId, sheetId)

        row = headerRow.reduce((m, v, i) => ({ ...m, [v]: row[i] }), {})
      }

      await sheet.addRow(row, { insert: true })
    })
  }

  /**
   * @description Retrieves data from Google Sheets for AI agents to analyze spreadsheet content, process existing data, or extract information for automated workflows. Perfect for reading user submissions, analyzing data trends, or importing data for further processing.
   *
   * @route POST /get-rows
   * @operationName Get Rows
   * @category Row Operations
   *
   * @appearanceColor #00ad3c #00831e
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes https://www.googleapis.com/auth/spreadsheets.readonly
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"description":"Unique identifier for the spreadsheet (document that contains multiple sheets). Spreadsheet ID could be found in URL - 'https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>'","dictionary":"getSpreadsheetsDictionary"}
   * @paramDef {"type":"Number","label":"Sheet","name":"sheetId","required":true,"dictionary":"getSheetsDictionary","dependsOn":["documentId"],"description":"ID of the sheet from which rows are to be retrieved. Could be found in URL - '...gid=<SHEET_ID>'"}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","description":"Number of rows to skip from the beginning. Examples: 0 to start from first row, 10 to skip header and first 9 data rows. Useful for pagination."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","description":"Maximum number of rows to retrieve. Examples: 50 for first 50 rows, 1000 for batch processing. Leave blank to get all available rows."}
   * @paramDef {"type":"Boolean","label":"With Row Numbers","name":"withRowNumbers","uiComponent":{"type":"TOGGLE"}, "description":"Include row numbers in the response. Enable to get row indices for update operations, disable for cleaner data processing."}
   *
   * @returns {Array} Array of row objects.
   * @sampleResult [{"Name": "John Doe", "Email": "john@example.com", "Score": 95}, {"Name": "Jane Smith", "Email": "jane@example.com", "Score": 87}]
   */
  async getRows(documentId, sheetId, offset, limit, withRowNumbers) {
    return this.#executeApiMethod('getRows', { documentId, sheetId, offset, limit }, async () => {
      const sheet = await this.#getSheet(documentId, sheetId)

      const rows = await sheet.getRows({ offset, limit })

      logger.debug(`getRows.rowsCount: ${ rows.length }`)

      return rows.map(row => {
        return withRowNumbers ? { rowNumber: row.rowNumber, rowData: row.toObject() } : row.toObject()
      })
    })
  }

  /**
   * @description Retrieves the last data row from a Google Sheet. Useful for getting the most recent entry, checking the latest submission, or determining where new data begins.
   *
   * @route POST /get-last-row
   * @operationName Get Last Row
   * @category Row Operations
   *
   * @appearanceColor #00ad3c #00831e
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes https://www.googleapis.com/auth/spreadsheets.readonly
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"description":"Unique identifier for the spreadsheet (document that contains multiple sheets). Spreadsheet ID could be found in URL - 'https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>'","dictionary":"getSpreadsheetsDictionary"}
   * @paramDef {"type":"Number","label":"Sheet","name":"sheetId","required":true,"dictionary":"getSheetsDictionary","dependsOn":["documentId"],"description":"ID of the sheet from which to retrieve the last row. Could be found in URL - '...gid=<SHEET_ID>'"}
   *
   * @returns {Object}
   * @sampleResult {"rowData":{"Name":"John Doe","Email":"john@example.com","Score":95},"rowNumber":10}
   */
  async getLastRow(documentId, sheetId) {
    return this.#executeApiMethod('getLastRow', { documentId, sheetId }, async () => {
      const sheet = await this.#getSheet(documentId, sheetId)

      const rows = await sheet.getRows()

      if (!rows.length) {
        return null
      }

      const lastRow = rows[rows.length - 1]

      return {
        rowData: lastRow.toObject(),
        rowNumber: lastRow.rowNumber,
      }
    })
  }

  /**
   * @description Clears rows when passing "from" and "to" as numbers (from: 3; to: 8) or cells area when passing A1 style (from: A4; to C16) from a specified sheet in a spreadsheet.
   *
   * @route POST /clear-rows-or-cells-area
   * @operationName Clear Rows or Cells Area
   * @category Row Operations
   *
   * @appearanceColor #00ad3c #00831e
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes https://www.googleapis.com/auth/spreadsheets
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"getSpreadsheetsDictionary","description":"Unique identifier for the spreadsheet (document that contains multiple sheets). Spreadsheet ID could be found in URL - 'https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>'"}
   * @paramDef {"type":"Number","label":"Sheet","name":"sheetId","dictionary":"getSheetsDictionary","dependsOn":["documentId"],"description":"Sheet ID from which rows will be deleted. Could be found in URL - '...gid=<SHEET_ID>'"}
   * @paramDef {"type":"String","label":"From","name":"from","description":"Optional. A1 style row number or cell location. Defaults to first non-header row."}
   * @paramDef {"type":"String","label":"To","name":"to","description":"Optional. A1 style row number or cell location. Defaults to last row."}
   */
  async clearRowsOrCellsArea(documentId, sheetId, from, to) {
    return this.#executeApiMethod('clearRowsOrCellsArea', { documentId, sheetId, from, to }, async () => {
      const sheet = await this.#getSheet(documentId, sheetId)

      await sheet.clearRows({ start: from, end: to })
    })
  }

  /**
   * @description Clears a row by its number from a specified sheet in a spreadsheet.
   *
   * @route POST /clear-row-by-index
   * @operationName Clear Row
   * @category Row Operations
   *
   * @appearanceColor #00ad3c #00831e
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes https://www.googleapis.com/auth/spreadsheets
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"getSpreadsheetsDictionary","description":"Unique identifier for the spreadsheet (document that contains multiple sheets). Spreadsheet ID could be found in URL - 'https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>'"}
   * @paramDef {"type":"Number","label":"Sheet","name":"sheetId","required":true,"dictionary":"getSheetsDictionary","dependsOn":["documentId"],"description":"Sheet ID from which rows will be deleted. Could be found in URL - '...gid=<SHEET_ID>'"}
   * @paramDef {"type":"String","label":"Row Number","name":"rowNumber","required":true,"description":"Optional. A row number to clear"}
   */
  async clearRowByIndex(documentId, sheetId, rowNumber) {
    return this.#executeApiMethod('clearRowByIndex', { documentId, sheetId, rowNumber }, async () => {
      const sheet = await this.#getSheet(documentId, sheetId)

      await sheet.clearRows({ start: rowNumber, end: rowNumber })
    })
  }

  /**
   * @description Finds a specific row in a specified sheet within a spreadsheet based on a column and value.
   *
   * @route POST /find-sheet-row
   * @operationName Find Row
   * @category Row Operations
   *
   * @appearanceColor #00ad3c #00831e
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes https://www.googleapis.com/auth/spreadsheets
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"getSpreadsheetsDictionary","description":"Unique identifier for the spreadsheet (document containing multiple sheets). Spreadsheet ID could be found in URL - 'https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>'"}
   * @paramDef {"type":"Number","label":"Sheet","name":"sheetId","required":true,"dictionary":"getSheetsDictionary","dependsOn":["documentId"],"description":"Sheet ID from which rows will be deleted. Could be found in URL - '...gid=<SHEET_ID>'"}
   * @paramDef {"type":"String","label":"Column","name":"column","required":true,"dictionary":"getSheetColumnsDictionary","dependsOn":["documentId","sheetId"],"description":"Column name (value in the header) to search for the specified value."}
   * @paramDef {"type":"String","label":"Value","name":"value","required":true,"description":"Value to search for in the specified column."}
   *
   * @returns {Object}
   * @sampleResult {"rowData":{"name":"value"},"rowNumber":5}
   */
  async findSheetRow(documentId, sheetId, column, value) {
    return this.#executeApiMethod('findSheetRow', { documentId, sheetId, column, value }, async () => {
      const sheet = await this.#getSheet(documentId, sheetId)

      await sheet.loadCells()

      const rows = await sheet.getRows()

      const row = rows.find(row => row.get(column) === value)

      if (!row) {
        return
      }

      return {
        rowData: row.toObject(),
        rowNumber: row.rowNumber,
      }
    })
  }

  /**
   * @description Finds a specific row in a specified sheet within a spreadsheet based on a column and value.
   *
   * @route POST /find-sheet-rows
   * @operationName Find Rows
   * @category Row Operations
   *
   * @appearanceColor #00ad3c #00831e
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes https://www.googleapis.com/auth/spreadsheets
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"getSpreadsheetsDictionary","description":"Unique identifier for the spreadsheet (document containing multiple sheets). Spreadsheet ID could be found in URL - 'https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>'"}
   * @paramDef {"type":"Number","label":"Sheet","name":"sheetId","required":true,"dictionary":"getSheetsDictionary","dependsOn":["documentId"],"description":"Sheet ID from which rows will be deleted. Could be found in URL - '...gid=<SHEET_ID>'"}
   * @paramDef {"type":"String","label":"Column","name":"column","required":true,"dictionary":"getSheetColumnsDictionary","dependsOn":["documentId","sheetId"],"description":"Column name (value in the header) to search for the specified value."}
   * @paramDef {"type":"String","label":"Value","name":"value","required":true,"description":"Value to search for in the specified column."}
   * @paramDef {"type":"Boolean","label":"With Row Numbers","name":"withRowNumbers","uiComponent":{"type":"TOGGLE"}, "description":"When enabled it returns a list of object where each item contains row data and row index, otherwise it returns a list of row data"}
   *
   * @returns {Array}
   * @sampleResult [{"rowData":{},"rowNumber":5},{"rowData":{},"rowNumber":6},{"rowData":{},"rowNumber":11}]
   */
  async findSheetRows(documentId, sheetId, column, value, withRowNumbers) {
    return this.#executeApiMethod('findSheetRows', { documentId, sheetId, column, value }, async () => {
      const sheet = await this.#getSheet(documentId, sheetId)

      const rows = await sheet.getRows()

      const matchingRows = []

      for (const row of rows) {
        if (row.get(column) === value) {
          if (withRowNumbers) {
            matchingRows.push({
              rowData: row.toObject(),
              rowNumber: row.rowNumber,
            })
          } else {
            matchingRows.push(row.toObject())
          }

          if (matchingRows.length >= 500) {
            break
          }
        }
      }

      return matchingRows
    })
  }

  /**
   * @description Updates multiple rows in a specified sheet.
   *
   * @route PUT /update-rows
   * @operationName Update Rows
   * @category Row Operations
   *
   * @appearanceColor #00ad3c #00831e
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes https://www.googleapis.com/auth/spreadsheets
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"getSpreadsheetsDictionary","description":"Unique identifier for the spreadsheet (document that contains multiple sheets). Spreadsheet ID could be found in URL - 'https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>'"}
   * @paramDef {"type":"Number","label":"Sheet","name":"sheetId","dictionary":"getSheetsDictionary","dependsOn":["documentId"],"description":"ID of the sheet where rows will be updated. Could be found in URL - '...gid=<SHEET_ID>'"}
   * @paramDef {"type":"Array","label":"Rows","name":"rows","required":true,"description":"List of Object containing rows to be updated. Each row should have an 'index' property indicating its position (starting from 1) and 'values' object for the updated values."}
   */
  async updateRows(documentId, sheetId, rows) {
    return this.#executeApiMethod('updateRows', { documentId, sheetId, rows }, async () => {
      assert(Array.isArray(rows), 'Rows must be a valid array.')

      const sheet = await this.#getSheet(documentId, sheetId)

      const savedRows = await sheet.getRows()

      const headerRow = await this.loadHeaderRow(documentId, sheetId)

      const updatedRows = rows.map(({ index, values }) => {
        if (!index) {
          throw new Error('Property "index" is required in Row')
        }

        if (Array.isArray(values)) {
          values = headerRow.reduce((m, v, i) => ({ ...m, [v]: values[i] }), {})
        }

        savedRows[index - 1].assign(values)

        return savedRows[index - 1]
      })

      await Promise.all(updatedRows.map(row => row.save()))
    })
  }

  /**
   * @description Updates existing data in Google Sheets for AI agents to modify records, correct information, or maintain data accuracy in automated workflows. Perfect for updating user profiles, adjusting scores, or maintaining dynamic data that changes over time.
   *
   * @route PUT /update-single-row
   * @operationName Update Row
   * @category Row Operations
   *
   * @appearanceColor #00ad3c #00831e
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes https://www.googleapis.com/auth/spreadsheets
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"getSpreadsheetsDictionary","description":"Unique identifier for the spreadsheet (document that contains multiple sheets). Spreadsheet ID could be found in URL - 'https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>'"}
   * @paramDef {"type":"Number","label":"Sheet","name":"sheetId","required":true,"dictionary":"getSheetsDictionary","dependsOn":["documentId"],"description":"ID of the sheet where rows will be updated. Could be found in URL - '...gid=<SHEET_ID>'"}
   * @paramDef {"type":"Number","label":"Row Number","name":"rowNumber","required":true,"description":"Row number to update (starting from 1). Examples: 2 for second row, 15 for fifteenth row. Note that row 1 is typically the header row."}
   * @paramDef {"type":"Object","label":"Row Data","name":"rowData","required":true,"description":"New data for the row. Examples: {'Name': 'Bob Smith', 'Email': 'bob@example.com', 'Score': 92} or ['Bob Smith', 'bob@example.com', 92]. Only specified columns will be updated."}
   */
  async updateRow(documentId, sheetId, rowNumber, rowData) {
    return this.#executeApiMethod('updateRow', { documentId, sheetId, rowNumber }, async () => {
      const sheet = await this.#getSheet(documentId, sheetId)

      const savedRows = await sheet.getRows({
        offset: rowNumber - 2, // to convert 1-based to 0-based index and since it returns rows after the header
        limit: 1,
      })

      const savedRow = savedRows[0]

      if (Array.isArray(rowData)) {
        const headerRow = await this.loadHeaderRow(documentId, sheetId)

        rowData = headerRow.reduce((m, v, i) => ({ ...m, [v]: rowData[i] }), {})
      }

      savedRow.assign(rowData)

      await savedRow.save()
    })
  }

  /**
   * @description Exports the specified sheet from a Google Spreadsheet as a file in CSV, TSV, or PDF format.
   *
   * @route POST /export-sheet
   * @operationName Export Sheet
   * @category Data Export
   *
   * @appearanceColor #00ad3c #00831e
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes https://www.googleapis.com/auth/spreadsheets.readonly
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"description":"Unique identifier for the spreadsheet (document that contains multiple sheets). Spreadsheet ID could be found in URL - 'https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>'","dictionary":"getSpreadsheetsDictionary"}
   * @paramDef {"type":"Number","label":"Sheet","name":"sheetId","required":true,"dictionary":"getSheetsDictionary","dependsOn":["documentId"],"description":"ID of the sheet to be exported. Could be found in URL - '...gid=<SHEET_ID>'"}
    * @paramDef {"type":"String","label":"Files Type","name":"fileType","uiComponent":{"type":"DROPDOWN","options":{"values":["csv","tsv","pdf"]}},"description":"Optional. The file format for export is `csv`, `tsv`, or `pdf`. Defaults to `csv`."}
   * @paramDef {"type":"String","label":"Files Name","name":"fileName","description":"Optional. The name of the exported file. Defaults to the sheet name."}
   * @paramDef {"type":"FilesUploadOptions","name":"fileOptions","label":"File Settings","required":false,"include":["scope"]}
   *
   * @returns {String} Returns the URL of saved file.
   */
  async exportSheet(documentId, sheetId, fileType, fileName, fileOptions) {
    return this.#executeApiMethod('exportSheet', { documentId, sheetId, fileType, fileName }, async () => {
      const exportType = fileType || 'csv'

      assert(['csv', 'tsv', 'pdf'].includes(exportType), 'File type must be one of "csv", "tsv", or "pdf".')

      const sheet = await this.#getSheet(documentId, sheetId)

      const FileTypeToActionMapper = {
        csv: 'downloadAsCSV',
        tsv: 'downloadAsTSV',
        pdf: 'downloadAsPDF',
      }

      const buffer = await sheet[FileTypeToActionMapper[exportType]]()

      const savedFileName = `${ fileName || sheet.title }.${ exportType }`

      logger.debug(
        `exportSheet.result: ${ JSON.stringify({ savedFileName, exportType, isBuffer: Buffer.isBuffer(buffer) }) }`
      )

      const { url } = await this.flowrunner.Files.uploadFile(buffer, {
        filename: savedFileName,
        generateUrl: true,
        overwrite: true,
        ...(fileOptions || { scope: 'FLOW' }),
      })

      return url
    })
  }

  /**
   * @description Exports the entire Google Spreadsheet document in a specified format (XLSX, ODS, or HTML).
   *
   * @route POST /export-document
   * @operationName Export Document
   * @category Data Export
   *
   * @appearanceColor #00ad3c #00831e
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes https://www.googleapis.com/auth/drive.readonly
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"description":"Unique identifier for the spreadsheet (document that contains multiple sheets). Spreadsheet ID could be found in URL - 'https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>'","dictionary":"getSpreadsheetsDictionary"}
   * @paramDef {"type":"String","label":"Files Type","name":"fileType","uiComponent":{"type":"DROPDOWN","options":{"values":["xlsx","ods","html"]}},"description":"Optional. The file format for export `xlsx`, `ods` or `html`. Defaults to `xlsx`."}
   * @paramDef {"type":"String","label":"Files Name","name":"fileName","description":"Optional. The name of the exported file. Defaults to the spreadsheet name."}
   * @paramDef {"type":"FilesUploadOptions","name":"fileOptions","label":"File Settings","required":false,"include":["scope"]}
   *
   * @returns {String} Returns the URL of saved file.
   */
  async exportDocument(documentId, fileType, fileName, fileOptions) {
    return this.#executeApiMethod('exportDocument', { documentId, fileType, fileName }, async () => {
      fileType = fileType || 'xlsx'

      const validFileTypes = ['xlsx', 'ods', 'html']

      assert(
        validFileTypes.includes(fileType),
        `File type must be one of ${ validFileTypes.join(', ') }.`
      )

      const doc = this.#getDocument(documentId)
      await doc.loadInfo()

      const FileTypeToActionMapper = {
        xlsx: 'downloadAsXLSX',
        ods: 'downloadAsODS',
        html: 'downloadAsHTML',
      }

      const FileTypeToExtensionMapper = {
        xlsx: 'xlsx',
        ods: 'ods',
        html: 'zip',
      }

      const buffer = await doc[FileTypeToActionMapper[fileType]]()

      const resultFileName = `${ fileName || doc.title }.${ FileTypeToExtensionMapper[fileType] }`

      logger.debug(
        `exportDocument.result: ${ JSON.stringify({
          resultFileName,
          fileType,
          isBuffer: Buffer.isBuffer(buffer),
        }) }`
      )

      const { url } = await this.flowrunner.Files.uploadFile(buffer, {
        filename: resultFileName,
        generateUrl: true,
        overwrite: true,
        ...(fileOptions || { scope: 'FLOW' }),
      })

      return url
    })
  }

  /**
   * @description Retrieves the value of a specific cell in a Spreadsheet.
   *
   * @route POST /get-cell
   * @operationName Get Cell
   * @category Cell Operations
   *
   * @appearanceColor #00ad3c #00831e
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes https://www.googleapis.com/auth/spreadsheets.readonly
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"description":"Unique identifier for the spreadsheet (document that contains multiple sheets). Spreadsheet ID could be found in URL - 'https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>'","dictionary":"getSpreadsheetsDictionary"}
   * @paramDef {"type":"Number","label":"Sheet","name":"sheetId","required":true,"dictionary":"getSheetsDictionary","dependsOn":["documentId"],"description":"ID of the sheet containing the cell. Could be found in URL - '...gid=<SHEET_ID>'"}
   * @paramDef {"type":"Number","label":"Row Number","name":"rowNumber","required":true,"description":"Number of the row (1-based index, where 1 represents the first row)"}
   * @paramDef {"type":"Number","label":"Column Number","name":"columnNumber","required":true,"description":"Number of the column (1-based index, where 1 represents the first one)"}
   *
   * @returns {Object} Returns an object with the property "value" of the specified cell.
   * @sampleResult {"value":"example_cell_value"}
   */
  async getCell(documentId, sheetId, rowNumber, columnNumber) {
    return this.#executeApiMethod('getCell', { documentId, sheetId, rowNumber, columnNumber }, async () => {
      assert(typeof rowNumber === 'number', 'Row index must be a number.')
      assert(typeof columnNumber === 'number', 'Column index must be a number.')

      rowNumber = rowNumber - 1
      columnNumber = columnNumber - 1

      const sheet = await this.#getSheet(documentId, sheetId)

      await sheet.loadCells({
        startRowIndex: rowNumber,
        endRowIndex: rowNumber + 1,
        startColumnIndex: columnNumber,
        endColumnIndex: columnNumber + 1,
      })

      const cell = sheet.getCell(rowNumber, columnNumber)

      return {
        value: cell.value,
      }
    })
  }

  /**
   * @description Updates a specific cell in a Google Spreadsheet with a new value.
   *
   * @route PUT /update-cell
   * @operationName Update Cell
   * @category Cell Operations
   *
   * @appearanceColor #00ad3c #00831e
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes https://www.googleapis.com/auth/spreadsheets
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"description":"Unique identifier for the spreadsheet (document that contains multiple sheets). Spreadsheet ID could be found in URL - 'https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>'","dictionary":"getSpreadsheetsDictionary"}
   * @paramDef {"type":"Number","label":"Sheet","name":"sheetId","required":true,"dictionary":"getSheetsDictionary","dependsOn":["documentId"],"description":"ID of the sheet containing the cell. Could be found in URL - '...gid=<SHEET_ID>'"}
   * @paramDef {"type":"Number","label":"Row Number","name":"rowNumber","required":true,"description":"Number of the row (1-based index, where 1 represents the first row)"}
   * @paramDef {"type":"Number","label":"Column Number","name":"columnNumber","required":true,"description":"Number of the column (1-based index, where 1 represents the first one)"}
   * @paramDef {"type":"String","label":"Cell Value","name":"value","description":"New value of the cell"}
   */
  async updateCell(documentId, sheetId, rowNumber, columnNumber, value) {
    return this.#executeApiMethod('updateCell', { documentId, sheetId, rowNumber, columnNumber, value }, async () => {
      assert(typeof rowNumber === 'number', 'Row number must be a number.')
      assert(typeof columnNumber === 'number', 'Column index must be a number.')

      rowNumber = rowNumber - 1
      columnNumber = columnNumber - 1

      const sheet = await this.#getSheet(documentId, sheetId)

      await sheet.loadCells({
        startRowIndex: rowNumber,
        endRowIndex: rowNumber + 1,
        startColumnIndex: columnNumber,
        endColumnIndex: columnNumber + 1,
      })

      const cell = sheet.getCell(rowNumber, columnNumber)

      cell.value = value

      await sheet.saveUpdatedCells()
    })
  }

  /**
   * @description Clears the content of a specific cell in a Google Spreadsheet.
   *
   * @route POST /clear-cell
   * @operationName Clear Cell
   * @category Cell Operations
   *
   * @appearanceColor #00ad3c #00831e
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes https://www.googleapis.com/auth/spreadsheets
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"description":"Unique identifier for the spreadsheet (document that contains multiple sheets). Spreadsheet ID could be found in URL - 'https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>'","dictionary":"getSpreadsheetsDictionary"}
   * @paramDef {"type":"Number","label":"Sheet","name":"sheetId","required":true,"dictionary":"getSheetsDictionary","dependsOn":["documentId"],"description":"ID of the sheet containing the cell. Could be found in URL - '...gid=<SHEET_ID>'"}
   * @paramDef {"type":"Number","label":"Row Number","name":"rowNumber","required":true,"description":"Number of the row (1-based index, where 1 represents the first row)"}
   * @paramDef {"type":"Number","label":"Column Number","name":"columnNumber","required":true,"description":"Number of the column (1-based index, where 1 represents the first one)"}
   */
  async clearCell(documentId, sheetId, rowNumber, columnNumber) {
    return this.#executeApiMethod('clearCell', { documentId, sheetId, rowNumber, columnNumber }, async () => {
      assert(typeof rowNumber === 'number', 'Row index must be a number.')

      assert(
        typeof columnNumber === 'number',
        'Column index must be a number.'
      )

      rowNumber = rowNumber - 1
      columnNumber = columnNumber - 1

      const sheet = await this.#getSheet(documentId, sheetId)

      await sheet.loadCells({
        startRowIndex: rowNumber,
        endRowIndex: rowNumber + 1,
        startColumnIndex: columnNumber,
        endColumnIndex: columnNumber + 1,
      })

      const cell = sheet.getCell(rowNumber, columnNumber)

      cell.value = ''

      await sheet.saveUpdatedCells()
    })
  }

  /**
   * @description Fetches the value of a cell in a Google Spreadsheet using A1 notation.
   *
   * @route POST /get-cell-by-a1
   * @operationName Get Cell by A1
   * @category Cell Operations
   *
   * @appearanceColor #00ad3c #00831e
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes https://www.googleapis.com/auth/spreadsheets.readonly
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"description":"Unique identifier for the spreadsheet (document that contains multiple sheets). Spreadsheet ID could be found in URL - 'https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>'","dictionary":"getSpreadsheetsDictionary"}
   * @paramDef {"type":"Number","label":"Sheet","name":"sheetId","required":true,"dictionary":"getSheetsDictionary","dependsOn":["documentId"],"description":"ID of the sheet containing the cell. Could be found in URL - '...gid=<SHEET_ID>'"}
   * @paramDef {"type":"String","label":"A1 Cell Address","name":"a1Address","required":true,"description":"A1 notation address of the cell, e.g., B5"}
   *
   * @returns {any} Returns the value of the cell at the specified A1 address
   */
  async getCellByA1(documentId, sheetId, a1Address) {
    return this.#executeApiMethod('getCellByA1', { documentId, sheetId, a1Address }, async () => {
      assert(a1Address, 'A1 Address must be provided.')

      const sheet = await this.#getSheet(documentId, sheetId)

      await sheet.loadCells(a1Address)

      return sheet.getCellByA1(a1Address).value
    })
  }

  /**
   * @description Updates the value of a specific cell in a Google Spreadsheet using A1 notation.
   *
   * @route PUT /update-cell-by-a1
   * @operationName Update Cell by A1
   * @category Cell Operations
   *
   * @appearanceColor #00ad3c #00831e
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes https://www.googleapis.com/auth/spreadsheets
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"description":"Unique identifier for the spreadsheet (document that contains multiple sheets). Spreadsheet ID could be found in URL - 'https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>'","dictionary":"getSpreadsheetsDictionary"}
   * @paramDef {"type":"Number","label":"Sheet","name":"sheetId","required":true,"dictionary":"getSheetsDictionary","dependsOn":["documentId"],"description":"Sheet ID. Could be found in URL - '...gid=<SHEET_ID>'"}
   * @paramDef {"type":"String","label":"A1 Cell Address","name":"a1Address","required":true,"description":"A1 notation address of the cell. Example: B5"}
   * @paramDef {"type":"String","label":"Cell Value","name":"value","description":"New value to set in the cell"}
   */
  async updateCellByA1(documentId, sheetId, a1Address, value) {
    return this.#executeApiMethod('updateCellByA1', { documentId, sheetId, a1Address, value }, async () => {
      assert(a1Address, 'A1 cell address must be provided.')

      const sheet = await this.#getSheet(documentId, sheetId)

      const cell = sheet.getCellByA1(a1Address)

      cell.value = value

      await sheet.saveUpdatedCells()
    })
  }

  /**
   * @description Clears the value of a specific cell in a Google Spreadsheet using A1 notation.
   *
   * @route POST /clear-cell-by-a1
   * @operationName Clear Cell by A1
   * @category Cell Operations
   *
   * @appearanceColor #00ad3c #00831e
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes https://www.googleapis.com/auth/spreadsheets
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"description":"Unique identifier for the spreadsheet (document that contains multiple sheets). Spreadsheet ID could be found in URL - 'https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>'","dictionary":"getSpreadsheetsDictionary"}
   * @paramDef {"type":"Number","label":"Sheet","name":"sheetId","required":true,"dictionary":"getSheetsDictionary","dependsOn":["documentId"],"description":"Sheet ID. Could be found in URL - '...gid=<SHEET_ID>'"}
   * @paramDef {"type":"String","label":"A1 Cell Address","name":"a1Address","required":true,"description":"A1 notation address of the cell. Example: B5"}
   */
  async clearCellByA1(documentId, sheetId, a1Address) {
    return this.#executeApiMethod('clearCellByA1', { documentId, sheetId, a1Address }, async () => {
      assert(a1Address, 'A1 cell address must be provided.')

      const sheet = await this.#getSheet(documentId, sheetId)

      await sheet.loadCells(a1Address)

      const cell = sheet.getCellByA1(a1Address)

      cell.value = ''

      await sheet.saveUpdatedCells()
    })
  }

  /**
   * @description Copies a sheet from one spreadsheet to another and optionally deletes the original sheet.
   *
   * @route POST /copy-sheet-to-document
   * @operationName Copy Sheet to Document
   * @category Sheet Management
   *
   * @appearanceColor #00ad3c #00831e
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes https://www.googleapis.com/auth/spreadsheets
   *
   * @paramDef {"type":"String","label":"Source Document ID","name":"sourceDocumentId","dictionary":"getSpreadsheetsDictionary","required":true,"description":"Unique identifier for the source spreadsheet."}
   * @paramDef {"type":"String","label":"Target Document ID","name":"targetDocumentId","dictionary":"getSpreadsheetsDictionary","required":true,"description":"Unique identifier for the target spreadsheet."}
   * @paramDef {"type":"Number","label":"Sheet","name":"sheetId","dictionary":"getSheetsDictionary","dependsOn":["sourceDocumentId"],"description":"Sheet ID to copy/move."}
   * @paramDef {"type":"Boolean","label":"Remove Source Sheet","name":"removeSourceSheet","uiComponent":{"type":"TOGGLE"},"description":"Indicates whether the source sheet should be removed after the operation is completed."}
   *
   * @returns {Object} Returns the ID of the moved sheet in the target document.
   * @sampleResult { "sheetId": 1778601712 }
   */
  async copySheetToDocument(sourceDocumentId, targetDocumentId, sheetId, removeSourceSheet) {
    return this.#executeApiMethod(
      'copySheetToDocument',
      { sourceDocumentId, targetDocumentId, sheetId, removeSourceSheet },
      async () => {
        const sourceDoc = this.#getDocument(sourceDocumentId)
        const targetDoc = this.#getDocument(targetDocumentId)

        await sourceDoc.loadInfo()

        const sourceSheet = sourceDoc.sheetsById[sheetId]
        assert(sourceSheet, `Sheet with ID ${ sheetId } in document with ID ${ sourceDocumentId } not found.`)

        const request = await sourceSheet.copyToSpreadsheet(targetDocumentId)

        const newSheetId = request.data.sheetId
        const sourceTitle = sourceSheet.title

        await targetDoc.loadInfo()
        const targetSheet = targetDoc.sheetsById[newSheetId]

        logger.debug('[moveSheetToDocument] Result', { newSheetId })

        await targetSheet.updateProperties({ title: sourceTitle })

        if (removeSourceSheet) {
          await sourceSheet.delete()

          delete this.sheetsCache[`${ sourceDocumentId }-${ sheetId }`]
        }

        return {
          sheetId: newSheetId,
        }
      }
    )
  }

  /**
   * @description Searches for a sheet by title in a spreadsheet, optionally creating it if not found.
   *
   * @route POST /find-sheet
   * @operationName Find Sheet
   * @category Sheet Management
   *
   * @appearanceColor #00ad3c #00831e
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes https://www.googleapis.com/auth/spreadsheets
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"getSpreadsheetsDictionary","description":"Unique identifier for the spreadsheet (document that contains multiple sheets). Spreadsheet ID could be found in URL - 'https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>'"}
   * @paramDef {"type":"String","label":"Sheet Title","name":"sheetTitle","required":true,"description":"Specifies the title of the sheet to find"}
   * @paramDef {"type":"Boolean","label":"Create If Not Found","name":"createIfNotFound","uiComponent":{"type":"TOGGLE"},"description":"Indicates whether a new sheet should be created if the specified sheet is not found."}
   *
   * @returns {Object}
   * @sampleResult {"sheetId": 1,"title":"Example Sheet Title"}
   */
  async findSheet(documentId, sheetTitle, createIfNotFound) {
    return this.#executeApiMethod('findSheet', { documentId, sheetTitle, createIfNotFound }, async () => {
      const doc = this.#getDocument(documentId)

      await doc.loadInfo()

      let sheet = doc.sheetsByIndex.find(
        ({ title }) => title.toLowerCase() === sheetTitle.toLowerCase()
      )

      if (!sheet && createIfNotFound) {
        sheet = await doc.addSheet({ title: sheetTitle })
      }

      if (!sheet) {
        logger.debug('[findSheet] Not found Sheet with name:', sheetTitle)

        return
      }

      return {
        sheetId: sheet.sheetId,
        title: sheet.title,
      }
    })
  }

  /**
   * @description Retrieves a list of sheets (tabs) from a specified Google Spreadsheet by its ID.
   *
   * @route POST /get-sheet-list
   * @operationName Get Sheets List
   * @category Sheet Management
   *
   * @appearanceColor #00ad3c #00831e
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes https://www.googleapis.com/auth/spreadsheets
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"getSpreadsheetsDictionary","description":"Unique identifier for the spreadsheet (document that contains multiple sheets). Spreadsheet ID could be found in URL - 'https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>'"}

   * @returns {Array}
   * @sampleResult [{"sheetId": 1,"title":"Sheet Title"}]
   */
  async getSheetList(documentId) {
    return this.#executeApiMethod('getSheetList', { documentId }, async () => {
      const doc = this.#getDocument(documentId)

      await doc.loadInfo()

      return doc.sheetsByIndex.map(({ sheetId, title }) => ({
        sheetId,
        title,
      }))
    })
  }

  /**
   * @description Imports data from a CSV file into a Google Spreadsheet. It can either create a new sheet or append to an existing one.
   *
   * @route POST /import-from-csv
   * @operationName Import from CSV
   * @category Data Import
   *
   * @appearanceColor #00ad3c #00831e
   *
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes https://www.googleapis.com/auth/spreadsheets
   *
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"getSpreadsheetsDictionary","description":"Unique identifier for the spreadsheet (document that contains multiple sheets). Spreadsheet ID could be found in URL - 'https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>'"}
   * @paramDef {"type":"String","label":"CSV Url","name":"csvUrl","required":true,"description":"URL of the CSV file to be imported"}
   * @paramDef {"type":"Number","label":"Sheet","name":"sheetId","required":false,"dictionary":"getSheetsDictionary","dependsOn":["documentId"], "description":"Sheet ID to append or create a new sheet if not found. Could be found in URL - '...gid=<SHEET_ID>'. Default Sheet ID is not used."}
   *
   * @returns {Object} Returns the ID of the sheet that was created/updated.
   * @sampleResult { "sheetId": 1778601712 }
   */
  async importFromCSV(documentId, csvUrl, sheetId) {
    return this.#executeApiMethod('importFromCSV', { documentId, csvUrl, sheetId }, async () => {
      assert(csvUrl, 'CSV Url must be provided.')

      const doc = this.#getDocument(documentId)

      await doc.loadInfo()

      const filename = csvUrl.split('/').pop().split('.')[0]

      let sheet = doc.sheetsById[sheetId]
      const isNewSheet = !sheet

      if (isNewSheet) {
        sheet = await doc.addSheet({ title: filename, sheetId })
      }

      const buffer = await Flowrunner.Request.get(csvUrl).setEncoding(null)

      logger.debug(
        `importFromCSV Sheet Data: ${ {
          isNewSheet,
          sheetId: sheet.sheetId,
          isBuffer: Buffer.isBuffer(buffer),
        } }`
      )

      const parsing = new Promise(resolve => {
        Papa.parse(buffer.toString(), {
          complete: result => resolve(result),
        })
      })

      const parsedCsv = await parsing

      const header = parsedCsv.data.shift()

      logger.debug(`importFromCSV CSV Data: ${ JSON.stringify({ parsedCsvType: typeof parsedCsv, header }) }`)

      try {
        await sheet.loadHeaderRow()
      } catch {
        await sheet.setHeaderRow(header)
      }

      await sheet.addRows(parsedCsv.data)

      return {
        sheetId: sheet.sheetId,
      }
    })
  }
}

Flowrunner.ServerCode.addService(GoogleSheets, [
  {
    order: 0,
    displayName: 'Client Id',
    name: 'clientId',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'Your OAuth 2.0 Client ID from the Google Cloud Console (APIs & Services > Credentials).',
  },
  {
    order: 1,
    displayName: 'Client Secret',
    name: 'clientSecret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'Your OAuth 2.0 Client Secret from the Google Cloud Console (APIs & Services > Credentials).',
  },
])

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

function searchFilter(list, props, searchString) {
  const caseInsensitiveSearch = searchString.toLowerCase()

  return list.filter(item =>
    props.some(prop => {
      const value = prop.split('.').reduce((acc, key) => acc?.[key], item)

      return value && String(value).toLowerCase().includes(caseInsensitiveSearch)
    })
  )
}

const extractFileId = url => url.match(/\/files\/([^/?]+)/)[1]

function resolveSharedDriveId(id) {
  return (id !== MY_DRIVE_ID && id) || undefined
}

function deserializeRow(row) {
  return { rowNumber: row.rowNumber, data: row.toObject() }
}