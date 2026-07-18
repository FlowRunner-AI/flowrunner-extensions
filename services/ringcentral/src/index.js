'use strict'

const PRODUCTION_HOST = 'https://platform.ringcentral.com'
const SANDBOX_HOST = 'https://platform.devtest.ringcentral.com'

const DEFAULT_PER_PAGE = 100
const DEFAULT_RECORD_COUNT = 30

// Friendly dropdown label -> RingCentral API value mappings.
// Dropdowns whose labels equal their API values (e.g. Inbound/Outbound) need no mapping.
const MESSAGE_TYPE_OPTIONS = {
  'SMS': 'SMS',
  'Fax': 'Fax',
  'Voicemail': 'VoiceMail',
  'Pager': 'Pager',
}

const CONTACT_SORT_OPTIONS = {
  'First Name': 'FirstName',
  'Last Name': 'LastName',
  'Company': 'Company',
}

const EXTENSION_STATUS_OPTIONS = {
  'Enabled': 'Enabled',
  'Disabled': 'Disabled',
  'Not Activated': 'NotActivated',
  'Unassigned': 'Unassigned',
}

const EXTENSION_TYPE_OPTIONS = {
  'User': 'User',
  'Department': 'Department',
  'Announcement': 'Announcement',
  'Voicemail': 'Voicemail',
  'Shared Lines Group': 'SharedLinesGroup',
  'Paging Only': 'PagingOnly',
  'Park Location': 'ParkLocation',
  'IVR Menu': 'IvrMenu',
  'Limited': 'Limited',
}

const PHONE_USAGE_TYPE_OPTIONS = {
  'Main Company Number': 'MainCompanyNumber',
  'Additional Company Number': 'AdditionalCompanyNumber',
  'Company Number': 'CompanyNumber',
  'Direct Number': 'DirectNumber',
  'Company Fax Number': 'CompanyFaxNumber',
  'Forwarded Number': 'ForwardedNumber',
  'Forwarded Company Number': 'ForwardedCompanyNumber',
}

// Maps a downloaded attachment/recording Content-Type to a file extension.
const CONTENT_TYPE_EXTENSIONS = {
  'audio/mpeg': 'mp3',
  'audio/x-wav': 'wav',
  'audio/wav': 'wav',
  'audio/x-m4a': 'm4a',
  'image/tiff': 'tif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'video/mpeg': 'mpeg',
  'video/mp4': 'mp4',
}

const logger = {
  info: (...args) => console.log('[RingCentral] info:', ...args),
  debug: (...args) => console.log('[RingCentral] debug:', ...args),
  error: (...args) => console.log('[RingCentral] error:', ...args),
  warn: (...args) => console.log('[RingCentral] warn:', ...args),
}

// NOTE: RingCentral gates production API access. A new RingCentral app starts in the
// Sandbox (devtest) environment and must graduate through RingCentral's "Apply for
// Production" review before it can be used against https://platform.ringcentral.com.
// The "Environment" config item selects which platform host is used for both the
// OAuth2 flow and every API call.

/**
 * @requireOAuth
 * @usesFileStorage
 * @integrationName RingCentral
 * @integrationIcon /icon.svg
 **/
class RingCentralService {
  constructor(config) {
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret

    this.platformHost = config.environment === 'Sandbox' ? SANDBOX_HOST : PRODUCTION_HOST
    this.apiBase = `${ this.platformHost }/restapi/v1.0`
    this.teamMessagingBase = `${ this.platformHost }/team-messaging/v1`
  }

  #accessToken() {
    return this.request.headers['oauth-access-token']
  }

  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    if (query) {
      query = cleanupObject(query)
    }

    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=[${ JSON.stringify(query) }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Authorization': `Bearer ${ this.#accessToken() }`,
          'Content-Type': 'application/json',
        })
        .query(query || {})

      const response = body !== undefined ? await request.send(body) : await request

      // Several RingCentral write endpoints (delete message, cancel RingOut, delete
      // contact) return 204 No Content. Normalize those to a consistent success object.
      return isEmptyResponse(response) ? { status: 'success' } : response
    } catch (error) {
      const message = this.#extractError(error)

      logger.error(`${ logTag } - failed: ${ message }`)

      throw new Error(`RingCentral API error: ${ message }`)
    }
  }

  // Downloads a binary resource (voicemail audio, fax pages, MMS media, call recordings)
  // and normalizes the response body to a Buffer.
  async #downloadBinary(url, logTag) {
    try {
      logger.debug(`${ logTag } - downloading [${ url }]`)

      const bytes = await Flowrunner.Request.get(url)
        .set({ 'Authorization': `Bearer ${ this.#accessToken() }` })
        .setEncoding(null)

      return toBuffer(bytes)
    } catch (error) {
      const message = this.#extractError(error)

      logger.error(`${ logTag } - download failed: ${ message }`)

      throw new Error(`RingCentral API error: ${ message }`)
    }
  }

  // RingCentral REST errors are shaped as { errorCode, message, errors: [{ errorCode, message }] };
  // the OAuth endpoints use { error, error_description }.
  #extractError(error) {
    const body = error.body

    if (body) {
      if (Array.isArray(body.errors) && body.errors.length) {
        const details = body.errors.map(item => item.message).filter(Boolean).join('; ')

        if (details) {
          return body.errorCode ? `${ details } (${ body.errorCode })` : details
        }
      }

      if (body.message) {
        return body.errorCode ? `${ body.message } (${ body.errorCode })` : body.message
      }

      if (body.error_description) {
        return body.error_description
      }

      if (typeof body.error === 'string') {
        return body.error
      }
    }

    return error.message
  }

  // Maps a friendly dropdown label to its RingCentral API value. Unmapped values
  // (and identity dropdowns) pass through unchanged.
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // Normalizes a date/date-time parameter (ISO string or epoch millis) to the
  // ISO 8601 format RingCentral expects.
  #toIsoDate(value, label) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    const date = new Date(typeof value === 'number' ? value : String(value))

    if (isNaN(date.getTime())) {
      throw new Error(`"${ label }" is not a valid date: ${ value }`)
    }

    return date.toISOString()
  }

  #toPhoneNumberList(values, label) {
    const list = (Array.isArray(values) ? values : [values])
      .filter(Boolean)
      .map(value => String(value).trim())
      .filter(Boolean)

    if (!list.length) {
      throw new Error(`At least one "${ label }" phone number is required`)
    }

    return list
  }

  // Saves a downloaded Buffer to FlowRunner file storage and returns the generated URL.
  async #saveToFiles(buffer, filename, fileOptions) {
    const { url } = await this.flowrunner.Files.uploadFile(buffer, {
      filename,
      generateUrl: true,
      overwrite: true,
      ...(fileOptions || { scope: 'FLOW' }),
    })

    return url
  }

  // ============================================== OAUTH ===============================================

  /**
   * @registerAs SYSTEM
   * @route GET /getOAuth2ConnectionURL
   * @returns {String}
   */
  async getOAuth2ConnectionURL() {
    const params = new URLSearchParams()

    params.append('response_type', 'code')
    params.append('client_id', this.clientId)
    params.append('state', `flowrunner_${ Date.now() }`)
    // redirect_uri is injected by the FlowRunner platform (repo OAuth pattern) — do not append it here.

    const connectionURL = `${ this.platformHost }/restapi/oauth/authorize?${ params.toString() }`

    logger.debug(`composed connectionURL: ${ connectionURL }`)

    return connectionURL
  }

  #basicAuthHeader() {
    const encoded = Buffer.from(`${ this.clientId }:${ this.clientSecret }`).toString('base64')

    return {
      'Authorization': `Basic ${ encoded }`,
      'Content-Type': 'application/x-www-form-urlencoded',
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
   * @property {String} [connectionIdentityImageURL]
   */

  /**
   * @registerAs SYSTEM
   * @route POST /executeCallback
   * @param {Object} callbackObject
   * @returns {executeCallback_ResultObject}
   */
  async executeCallback(callbackObject) {
    const params = new URLSearchParams()

    params.append('grant_type', 'authorization_code')
    params.append('code', callbackObject.code)
    params.append('redirect_uri', callbackObject.redirectURI)

    const tokenResponse = await Flowrunner.Request.post(`${ this.platformHost }/restapi/oauth/token`)
      .set(this.#basicAuthHeader())
      .send(params.toString())

    let userData = {}
    let connectionIdentityName = 'RingCentral Account'

    try {
      userData = await Flowrunner.Request
        .get(`${ this.apiBase }/account/~/extension/~`)
        .set({ 'Authorization': `Bearer ${ tokenResponse.access_token }` })

      const displayName = userData.name || userData.contact?.email

      if (displayName) {
        connectionIdentityName = userData.extensionNumber
          ? `${ displayName } (ext. ${ userData.extensionNumber })`
          : displayName
      }
    } catch (error) {
      logger.error(`[executeCallback] identity lookup error: ${ error.message }`)
    }

    return {
      token: tokenResponse.access_token,
      expirationInSeconds: tokenResponse.expires_in,
      refreshToken: tokenResponse.refresh_token,
      connectionIdentityName,
      connectionIdentityImageURL: null,
      overwrite: true,
      userData,
    }
  }

  /**
   * @typedef {Object} refreshToken_ResultObject
   *
   * @property {String} token
   * @property {Number} [expirationInSeconds]
   * @property {String} [refreshToken]
   */

  /**
   * @registerAs SYSTEM
   * @route PUT /refreshToken
   * @param {String} refreshToken
   * @returns {refreshToken_ResultObject}
   */
  async refreshToken(refreshToken) {
    try {
      const params = new URLSearchParams()

      params.append('grant_type', 'refresh_token')
      params.append('refresh_token', refreshToken)

      const { access_token, expires_in, refresh_token } = await Flowrunner.Request
        .post(`${ this.platformHost }/restapi/oauth/token`)
        .set(this.#basicAuthHeader())
        .send(params.toString())

      return {
        token: access_token,
        expirationInSeconds: expires_in,
        // RingCentral rotates refresh tokens (they live ~7 days); always keep the newest one.
        refreshToken: refresh_token || refreshToken,
      }
    } catch (error) {
      logger.error(`refreshToken error: ${ error.message }`)

      if (error.body?.error === 'invalid_grant') {
        throw new Error('Refresh token expired or invalid, please re-authenticate.')
      }

      throw error
    }
  }

  // =========================================== DICTIONARIES ===========================================

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
   * @typedef {Object} getSmsNumbersDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter the phone numbers. Filtering is applied locally to the current page."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Page number (as a string) from a previous response, used to retrieve the next page of numbers."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get SMS Numbers Dictionary
   * @description Lists the connected extension's phone numbers that are SMS-enabled (their features include SmsSender), for selection as the sender of an SMS message. Returns the phone number as both label and value, with the number's usage type as the note.
   * @route POST /get-sms-numbers-dictionary
   * @paramDef {"type":"getSmsNumbersDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"+16505550100","value":"+16505550100","note":"Direct Number"}]}
   */
  async getSmsNumbersDictionary(payload) {
    const { search, cursor } = payload || {}
    const page = cursor ? parseInt(cursor, 10) || 1 : 1

    const response = await this.#apiRequest({
      logTag: 'getSmsNumbersDictionary',
      url: `${ this.apiBase }/account/~/extension/~/phone-number`,
      query: { page, perPage: DEFAULT_PER_PAGE },
    })

    const records = (Array.isArray(response.records) ? response.records : [])
      .filter(record => Array.isArray(record.features) && record.features.includes('SmsSender'))

    const filtered = search
      ? records.filter(record => (record.phoneNumber || '').includes(search))
      : records

    const totalPages = response.paging?.totalPages || 1

    return {
      cursor: page < totalPages ? String(page + 1) : undefined,
      items: filtered.map(record => ({
        label: record.phoneNumber,
        value: record.phoneNumber,
        note: [formatUsageType(record.usageType), record.label].filter(Boolean).join(' - '),
      })),
    }
  }

  /**
   * @typedef {Object} getExtensionsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter extensions by name or extension number. Filtering is applied locally to the current page."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Page number (as a string) from a previous response, used to retrieve the next page of extensions."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Extensions Dictionary
   * @description Lists the extensions (users, departments, etc.) of the connected RingCentral account for selection in dependent parameters. Returns the extension name as the label and the extension id as the value, with the extension number and type as the note.
   * @route POST /get-extensions-dictionary
   * @paramDef {"type":"getExtensionsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"John Smith","value":"809646018","note":"Ext. 101 - User"}],"cursor":"2"}
   */
  async getExtensionsDictionary(payload) {
    const { search, cursor } = payload || {}
    const page = cursor ? parseInt(cursor, 10) || 1 : 1

    const response = await this.#apiRequest({
      logTag: 'getExtensionsDictionary',
      url: `${ this.apiBase }/account/~/extension`,
      query: { page, perPage: DEFAULT_PER_PAGE },
    })

    const records = Array.isArray(response.records) ? response.records : []

    const filtered = search
      ? records.filter(record => {
        const haystack = `${ record.name || '' } ${ record.extensionNumber || '' }`.toLowerCase()

        return haystack.includes(search.toLowerCase())
      })
      : records

    const totalPages = response.paging?.totalPages || 1

    return {
      cursor: page < totalPages ? String(page + 1) : undefined,
      items: filtered.map(record => ({
        label: record.name || `Extension ${ record.extensionNumber || record.id }`,
        value: String(record.id),
        note: [record.extensionNumber ? `Ext. ${ record.extensionNumber }` : null, record.type]
          .filter(Boolean)
          .join(' - '),
      })),
    }
  }

  /**
   * @typedef {Object} getChatsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter chats by name or description. Filtering is applied locally to the current page."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Page token from a previous response, used to retrieve the next page of chats."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Chats Dictionary
   * @description Lists the connected user's team messaging chats (teams, group chats, direct chats, and the personal chat) for selection in dependent parameters. Returns the chat name (or a generated label for unnamed chats) as the label and the chat id as the value, with the chat type as the note.
   * @route POST /get-chats-dictionary
   * @paramDef {"type":"getChatsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Deal Desk","value":"637468356610","note":"Team"}],"cursor":"AAB3aG"}
   */
  async getChatsDictionary(payload) {
    const { search, cursor } = payload || {}

    const response = await this.#apiRequest({
      logTag: 'getChatsDictionary',
      url: `${ this.teamMessagingBase }/chats`,
      query: { recordCount: DEFAULT_PER_PAGE, pageToken: cursor || undefined },
    })

    const records = Array.isArray(response.records) ? response.records : []

    const items = records.map(chat => ({
      label: chat.name || chat.description || `${ chat.type } chat ${ chat.id }`,
      value: String(chat.id),
      note: chat.type,
    }))

    const filtered = search
      ? items.filter(item => item.label.toLowerCase().includes(search.toLowerCase()))
      : items

    return {
      cursor: response.navigation?.nextPageToken || undefined,
      items: filtered,
    }
  }

  // ================================================ SMS ===============================================

  /**
   * @description Sends an SMS text message from one of the connected extension's SMS-enabled phone numbers to one or more recipients. The sender number must be owned by the extension and have the SmsSender feature (pick it from the dictionary). Message text is limited to 1000 characters; longer texts are rejected by RingCentral. Requires the SMS permission on the RingCentral app.
   *
   * @route POST /send-sms
   * @operationName Send SMS
   * @category SMS
   *
   * @paramDef {"type":"String","label":"From Number","name":"from","required":true,"dictionary":"getSmsNumbersDictionary","description":"The sender's phone number in E.164 format (e.g. '+16505550100'). Must be an SMS-enabled number owned by the connected extension."}
   * @paramDef {"type":"Array<String>","label":"To Numbers","name":"to","required":true,"description":"Recipient phone numbers in E.164 format (e.g. '+16505550101')."}
   * @paramDef {"type":"String","label":"Text","name":"text","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The message text to send. Maximum 1000 characters."}
   *
   * @returns {Object}
   * @sampleResult {"id":60279564004,"type":"SMS","direction":"Outbound","from":{"phoneNumber":"+16505550100"},"to":[{"phoneNumber":"+16505550101","messageStatus":"Sent"}],"subject":"Hello from FlowRunner","messageStatus":"Sent","readStatus":"Read","creationTime":"2026-07-01T18:00:00.000Z"}
   */
  async sendSMS(from, to, text) {
    if (!from) {
      throw new Error('"From Number" is required')
    }

    if (!text) {
      throw new Error('"Text" is required')
    }

    return this.#apiRequest({
      logTag: 'sendSMS',
      method: 'post',
      url: `${ this.apiBase }/account/~/extension/~/sms`,
      body: {
        from: { phoneNumber: String(from).trim() },
        to: this.#toPhoneNumberList(to, 'To Numbers').map(phoneNumber => ({ phoneNumber })),
        text,
      },
    })
  }

  // ============================================= MESSAGES =============================================

  /**
   * @description Retrieves messages from the connected extension's message store, paginated. Filter by message type (SMS, Fax, Voicemail, Pager), direction, read status, and a creation date range. Without a date filter RingCentral returns messages from the last 7 days. Each record includes the message status, sender/recipients, and attachment metadata (attachment ids can be passed to "Get Message Attachment Content").
   *
   * @route GET /list-messages
   * @operationName List Messages
   * @category Messages
   *
   * @paramDef {"type":"String","label":"Message Type","name":"messageType","uiComponent":{"type":"DROPDOWN","options":{"values":["SMS","Fax","Voicemail","Pager"]}},"description":"Optional message type filter. When omitted, all message types are returned."}
   * @paramDef {"type":"String","label":"Direction","name":"direction","uiComponent":{"type":"DROPDOWN","options":{"values":["Inbound","Outbound"]}},"description":"Optional direction filter. When omitted, both inbound and outbound messages are returned."}
   * @paramDef {"type":"String","label":"Read Status","name":"readStatus","uiComponent":{"type":"DROPDOWN","options":{"values":["Read","Unread"]}},"description":"Optional read status filter."}
   * @paramDef {"type":"String","label":"Date From","name":"dateFrom","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Optional start of the creation time range (ISO 8601 or timestamp). Default: 24 hours before Date To."}
   * @paramDef {"type":"String","label":"Date To","name":"dateTo","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Optional end of the creation time range (ISO 8601 or timestamp). Default: current time."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to return, starting from 1. Default: 1."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of records per page. Maximum 1000. Default: 100."}
   *
   * @returns {Object}
   * @sampleResult {"records":[{"id":60279564004,"type":"SMS","direction":"Inbound","from":{"phoneNumber":"+16505550101"},"to":[{"phoneNumber":"+16505550100"}],"subject":"Hi there","readStatus":"Unread","messageStatus":"Received","creationTime":"2026-07-01T18:00:00.000Z","attachments":[{"id":60279564004,"type":"Text","contentType":"text/plain"}]}],"paging":{"page":1,"perPage":100,"pageStart":0,"pageEnd":0}}
   */
  async listMessages(messageType, direction, readStatus, dateFrom, dateTo, page, perPage) {
    return this.#apiRequest({
      logTag: 'listMessages',
      url: `${ this.apiBase }/account/~/extension/~/message-store`,
      query: {
        messageType: this.#resolveChoice(messageType, MESSAGE_TYPE_OPTIONS),
        direction,
        readStatus,
        dateFrom: this.#toIsoDate(dateFrom, 'Date From'),
        dateTo: this.#toIsoDate(dateTo, 'Date To'),
        page,
        perPage,
      },
    })
  }

  /**
   * @description Retrieves a single message from the connected extension's message store by its id, including sender/recipients, status, read status, and attachment metadata. Use the attachment ids with "Get Message Attachment Content" to download voicemail audio, fax pages, or MMS media.
   *
   * @route GET /get-message
   * @operationName Get Message
   * @category Messages
   *
   * @paramDef {"type":"String","label":"Message ID","name":"messageId","required":true,"description":"The id of the message to retrieve (from \"List Messages\" or a message-received event)."}
   *
   * @returns {Object}
   * @sampleResult {"id":60279564004,"type":"VoiceMail","direction":"Inbound","from":{"phoneNumber":"+16505550101"},"to":[{"phoneNumber":"+16505550100"}],"readStatus":"Unread","messageStatus":"Received","creationTime":"2026-07-01T18:00:00.000Z","attachments":[{"id":60279564005,"type":"AudioRecording","contentType":"audio/mpeg","vmDuration":24}]}
   */
  async getMessage(messageId) {
    if (!messageId) {
      throw new Error('"Message ID" is required')
    }

    return this.#apiRequest({
      logTag: 'getMessage',
      url: `${ this.apiBase }/account/~/extension/~/message-store/${ encodeURIComponent(messageId) }`,
    })
  }

  /**
   * @description Deletes a single message from the connected extension's message store by its id. The message is moved to the Deleted state (RingCentral purges deleted messages later). Returns a success status.
   *
   * @route DELETE /delete-message
   * @operationName Delete Message
   * @category Messages
   *
   * @paramDef {"type":"String","label":"Message ID","name":"messageId","required":true,"description":"The id of the message to delete."}
   *
   * @returns {Object}
   * @sampleResult {"status":"success"}
   */
  async deleteMessage(messageId) {
    if (!messageId) {
      throw new Error('"Message ID" is required')
    }

    return this.#apiRequest({
      logTag: 'deleteMessage',
      method: 'delete',
      url: `${ this.apiBase }/account/~/extension/~/message-store/${ encodeURIComponent(messageId) }`,
    })
  }

  /**
   * @description Downloads the binary content of a message attachment — voicemail audio, fax pages, or MMS media — and saves it to FlowRunner file storage, returning the saved file's URL. The attachment's content type is resolved from the message metadata to give the saved file a proper extension (e.g. .mp3 for voicemail, .pdf/.tif for fax, .jpg for MMS).
   *
   * @route GET /get-message-attachment-content
   * @operationName Get Message Attachment Content
   * @category Messages
   *
   * @paramDef {"type":"String","label":"Message ID","name":"messageId","required":true,"description":"The id of the message that owns the attachment."}
   * @paramDef {"type":"String","label":"Attachment ID","name":"attachmentId","required":true,"description":"The id of the attachment to download (from the message's attachments array)."}
   * @paramDef {"type":"FilesUploadOptions","label":"File Settings","name":"fileOptions","required":false,"include":["scope"],"description":"Optional storage settings for the saved file. Scope defaults to FLOW."}
   *
   * @returns {Object}
   * @sampleResult {"messageId":"60279564004","attachmentId":"60279564005","fileName":"message_60279564004_attachment_60279564005.mp3","contentType":"audio/mpeg","sizeBytes":38200,"downloadUrl":"https://files.flowrunner.com/message_60279564004_attachment_60279564005.mp3"}
   */
  async getMessageAttachmentContent(messageId, attachmentId, fileOptions) {
    if (!messageId) {
      throw new Error('"Message ID" is required')
    }

    if (!attachmentId) {
      throw new Error('"Attachment ID" is required')
    }

    const message = await this.getMessage(messageId)

    const attachment = (Array.isArray(message.attachments) ? message.attachments : [])
      .find(item => String(item.id) === String(attachmentId))

    const contentType = attachment?.contentType || null
    const extension = CONTENT_TYPE_EXTENSIONS[contentType] || 'bin'
    const fileName = `message_${ messageId }_attachment_${ attachmentId }.${ extension }`

    const buffer = await this.#downloadBinary(
      `${ this.apiBase }/account/~/extension/~/message-store/${ encodeURIComponent(messageId) }/content/${ encodeURIComponent(attachmentId) }`,
      'getMessageAttachmentContent'
    )

    const downloadUrl = await this.#saveToFiles(buffer, fileName, fileOptions)

    return {
      messageId: String(messageId),
      attachmentId: String(attachmentId),
      fileName,
      contentType,
      sizeBytes: buffer.length,
      downloadUrl,
    }
  }

  // ================================================ FAX ===============================================

  /**
   * @description Sends a fax with a document from FlowRunner file storage to one or more recipients. The file (e.g. PDF, TIFF, DOCX, or image) is streamed to RingCentral as a multipart request. Optionally adds a cover page with custom text and controls the fax resolution. Requires the Faxes permission on the RingCentral app. Returns the created fax message record; poll it with "Get Message" to track the send status.
   *
   * @route POST /send-fax
   * @operationName Send Fax
   * @category Fax
   *
   * @paramDef {"type":"Array<String>","label":"To Numbers","name":"to","required":true,"description":"Recipient fax numbers in E.164 format (e.g. '+16505550102')."}
   * @paramDef {"type":"String","label":"File","name":"fileUrl","required":true,"uiComponent":{"type":"FILE_SELECTOR"},"description":"The FlowRunner file to fax (its URL). Common formats such as PDF, TIFF, DOC/DOCX, and images are supported."}
   * @paramDef {"type":"String","label":"Fax Resolution","name":"faxResolution","defaultValue":"High","uiComponent":{"type":"DROPDOWN","options":{"values":["High","Low"]}},"description":"The resolution to send the fax in. 'High' (200 dpi) is recommended for documents; 'Low' (100 dpi) transmits faster. Default: 'High'."}
   * @paramDef {"type":"String","label":"Cover Page Text","name":"coverPageText","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional text printed on the fax cover page. Maximum 1024 characters. When omitted, no custom cover text is added."}
   *
   * @returns {Object}
   * @sampleResult {"id":60279577004,"type":"Fax","direction":"Outbound","from":{"phoneNumber":"+16505550100"},"to":[{"phoneNumber":"+16505550102","messageStatus":"Queued"}],"messageStatus":"Queued","faxResolution":"High","faxPageCount":0,"creationTime":"2026-07-01T18:05:00.000Z"}
   */
  async sendFax(to, fileUrl, faxResolution, coverPageText) {
    if (!fileUrl) {
      throw new Error('"File" is required')
    }

    const recipients = this.#toPhoneNumberList(to, 'To Numbers')

    try {
      logger.debug(`sendFax to ${ recipients.join(',') } from ${ fileUrl }`)

      const fileName = decodeURIComponent(String(fileUrl).split('/').pop().split('?')[0]) || `fax_${ Date.now() }.pdf`
      const fileBytes = toBuffer(await Flowrunner.Request.get(fileUrl).setEncoding(null))

      // Do NOT set Content-Type manually — the form supplies the multipart boundary.
      const formData = new Flowrunner.Request.FormData()

      recipients.forEach(phoneNumber => formData.append('to', phoneNumber))
      formData.append('faxResolution', faxResolution || 'High')

      if (coverPageText) {
        formData.append('coverPageText', coverPageText)
      }

      formData.append('attachment', fileBytes, { filename: fileName })

      return await Flowrunner.Request.post(`${ this.apiBase }/account/~/extension/~/fax`)
        .set({ 'Authorization': `Bearer ${ this.#accessToken() }` })
        .form(formData)
    } catch (error) {
      const message = this.#extractError(error)

      logger.error(`sendFax - failed: ${ message }`)

      throw new Error(`RingCentral API error: ${ message }`)
    }
  }

  // ============================================= RINGOUT ==============================================

  /**
   * @description Initiates a two-legged RingOut (click-to-call) call: RingCentral first rings the "From" number (typically the connected user's phone), then connects it to the "To" number. Optionally plays a "press 1 to connect" prompt on the first leg and sets the caller id shown to the callee. Returns the RingOut session with its id and initial status — poll "Get RingOut Status" to track progress.
   *
   * @route POST /make-ringout-call
   * @operationName Make RingOut Call
   * @category RingOut
   *
   * @paramDef {"type":"String","label":"From Number","name":"from","required":true,"description":"The phone number to call first (usually the connected user's own phone), in E.164 format."}
   * @paramDef {"type":"String","label":"To Number","name":"to","required":true,"description":"The destination phone number to connect the call to, in E.164 format."}
   * @paramDef {"type":"Boolean","label":"Play Prompt","name":"playPrompt","uiComponent":{"type":"TOGGLE"},"description":"Whether to play a 'press 1 to connect' prompt when the From number answers. When disabled the call connects immediately. Default: true."}
   * @paramDef {"type":"String","label":"Caller ID","name":"callerId","description":"Optional phone number to display as the caller id to the callee, in E.164 format. Must be one of the account's numbers allowed as caller id."}
   *
   * @returns {Object}
   * @sampleResult {"id":"Y3MtY2FsbC1yaW5nb3V0","status":{"callStatus":"InProgress","callerStatus":"InProgress","calleeStatus":"InProgress"}}
   */
  async makeRingOutCall(from, to, playPrompt, callerId) {
    if (!from) {
      throw new Error('"From Number" is required')
    }

    if (!to) {
      throw new Error('"To Number" is required')
    }

    const body = {
      from: { phoneNumber: String(from).trim() },
      to: { phoneNumber: String(to).trim() },
    }

    if (playPrompt !== undefined && playPrompt !== null) {
      body.playPrompt = playPrompt
    }

    if (callerId) {
      body.callerId = { phoneNumber: String(callerId).trim() }
    }

    return this.#apiRequest({
      logTag: 'makeRingOutCall',
      method: 'post',
      url: `${ this.apiBase }/account/~/extension/~/ring-out`,
      body,
    })
  }

  /**
   * @description Retrieves the status of an active RingOut call session by its id, including the overall call status and the individual caller/callee leg statuses (InProgress, Success, NoAnswer, Busy, CannotReach, etc.).
   *
   * @route GET /get-ringout-status
   * @operationName Get RingOut Status
   * @category RingOut
   *
   * @paramDef {"type":"String","label":"RingOut ID","name":"ringoutId","required":true,"description":"The RingOut session id returned by \"Make RingOut Call\"."}
   *
   * @returns {Object}
   * @sampleResult {"id":"Y3MtY2FsbC1yaW5nb3V0","status":{"callStatus":"Success","callerStatus":"Success","calleeStatus":"Success"}}
   */
  async getRingOutStatus(ringoutId) {
    if (!ringoutId) {
      throw new Error('"RingOut ID" is required')
    }

    return this.#apiRequest({
      logTag: 'getRingOutStatus',
      url: `${ this.apiBase }/account/~/extension/~/ring-out/${ encodeURIComponent(ringoutId) }`,
    })
  }

  /**
   * @description Cancels an in-progress RingOut call session by its id. Only calls that have not yet completed can be canceled. Returns a success status.
   *
   * @route DELETE /cancel-ringout
   * @operationName Cancel RingOut
   * @category RingOut
   *
   * @paramDef {"type":"String","label":"RingOut ID","name":"ringoutId","required":true,"description":"The RingOut session id returned by \"Make RingOut Call\"."}
   *
   * @returns {Object}
   * @sampleResult {"status":"success"}
   */
  async cancelRingOut(ringoutId) {
    if (!ringoutId) {
      throw new Error('"RingOut ID" is required')
    }

    return this.#apiRequest({
      logTag: 'cancelRingOut',
      method: 'delete',
      url: `${ this.apiBase }/account/~/extension/~/ring-out/${ encodeURIComponent(ringoutId) }`,
    })
  }

  // ============================================= CALL LOG =============================================

  /**
   * @description Retrieves the connected extension's call log records, paginated. Filter by date range, call type (Voice or Fax), direction, and whether the call has a recording. The 'Detailed' view includes call legs; 'Simple' returns flat records. Recording ids from records with a recording can be passed to "Get Call Recording Content". Without a date filter RingCentral returns records from the last 24 hours.
   *
   * @route GET /list-call-log-records
   * @operationName List Call Log Records
   * @category Call Log
   *
   * @paramDef {"type":"String","label":"Date From","name":"dateFrom","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Optional start of the call time range (ISO 8601 or timestamp). Default: 24 hours before Date To."}
   * @paramDef {"type":"String","label":"Date To","name":"dateTo","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Optional end of the call time range (ISO 8601 or timestamp). Default: current time."}
   * @paramDef {"type":"String","label":"Type","name":"type","uiComponent":{"type":"DROPDOWN","options":{"values":["Voice","Fax"]}},"description":"Optional call type filter. When omitted, both voice calls and faxes are returned."}
   * @paramDef {"type":"String","label":"Direction","name":"direction","uiComponent":{"type":"DROPDOWN","options":{"values":["Inbound","Outbound"]}},"description":"Optional direction filter. When omitted, both inbound and outbound calls are returned."}
   * @paramDef {"type":"String","label":"View","name":"view","uiComponent":{"type":"DROPDOWN","options":{"values":["Simple","Detailed"]}},"description":"The level of detail to return. 'Detailed' includes call legs for each record. Default: 'Simple'."}
   * @paramDef {"type":"Boolean","label":"With Recording Only","name":"withRecording","uiComponent":{"type":"CHECKBOX"},"description":"When enabled, only returns calls that have an associated recording."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to return, starting from 1. Default: 1."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of records per page. Maximum 1000. Default: 100."}
   *
   * @returns {Object}
   * @sampleResult {"records":[{"id":"X2AvJPtwNQpBzUA","sessionId":"4503991004","type":"Voice","direction":"Inbound","action":"Phone Call","result":"Accepted","from":{"phoneNumber":"+16505550101"},"to":{"phoneNumber":"+16505550100"},"startTime":"2026-07-01T17:30:00.000Z","duration":124,"recording":{"id":"401234567008","contentUri":"https://media.ringcentral.com/restapi/v1.0/account/809646018/recording/401234567008/content"}}],"paging":{"page":1,"perPage":100}}
   */
  async listCallLogRecords(dateFrom, dateTo, type, direction, view, withRecording, page, perPage) {
    return this.#apiRequest({
      logTag: 'listCallLogRecords',
      url: `${ this.apiBase }/account/~/extension/~/call-log`,
      query: {
        dateFrom: this.#toIsoDate(dateFrom, 'Date From'),
        dateTo: this.#toIsoDate(dateTo, 'Date To'),
        type,
        direction,
        view,
        withRecording: withRecording === true ? true : undefined,
        page,
        perPage,
      },
    })
  }

  /**
   * @description Retrieves a single call log record of the connected extension by its id, including caller/callee, result, duration, and recording metadata when present. The 'Detailed' view includes the individual call legs.
   *
   * @route GET /get-call-log-record
   * @operationName Get Call Log Record
   * @category Call Log
   *
   * @paramDef {"type":"String","label":"Record ID","name":"recordId","required":true,"description":"The id of the call log record to retrieve (from \"List Call Log Records\")."}
   * @paramDef {"type":"String","label":"View","name":"view","uiComponent":{"type":"DROPDOWN","options":{"values":["Simple","Detailed"]}},"description":"The level of detail to return. 'Detailed' includes the call legs. Default: 'Simple'."}
   *
   * @returns {Object}
   * @sampleResult {"id":"X2AvJPtwNQpBzUA","sessionId":"4503991004","type":"Voice","direction":"Inbound","action":"Phone Call","result":"Accepted","from":{"phoneNumber":"+16505550101"},"to":{"phoneNumber":"+16505550100"},"startTime":"2026-07-01T17:30:00.000Z","duration":124}
   */
  async getCallLogRecord(recordId, view) {
    if (!recordId) {
      throw new Error('"Record ID" is required')
    }

    return this.#apiRequest({
      logTag: 'getCallLogRecord',
      url: `${ this.apiBase }/account/~/extension/~/call-log/${ encodeURIComponent(recordId) }`,
      query: { view },
    })
  }

  /**
   * @description Retrieves the call log of the entire RingCentral account (all extensions), paginated. Requires admin-level permissions (ReadCallLog for the account). Supports the same filters as the extension call log: date range, call type, direction, view, and recording presence.
   *
   * @route GET /list-account-call-log
   * @operationName List Account Call Log
   * @category Call Log
   *
   * @paramDef {"type":"String","label":"Date From","name":"dateFrom","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Optional start of the call time range (ISO 8601 or timestamp). Default: 24 hours before Date To."}
   * @paramDef {"type":"String","label":"Date To","name":"dateTo","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Optional end of the call time range (ISO 8601 or timestamp). Default: current time."}
   * @paramDef {"type":"String","label":"Type","name":"type","uiComponent":{"type":"DROPDOWN","options":{"values":["Voice","Fax"]}},"description":"Optional call type filter. When omitted, both voice calls and faxes are returned."}
   * @paramDef {"type":"String","label":"Direction","name":"direction","uiComponent":{"type":"DROPDOWN","options":{"values":["Inbound","Outbound"]}},"description":"Optional direction filter. When omitted, both inbound and outbound calls are returned."}
   * @paramDef {"type":"String","label":"View","name":"view","uiComponent":{"type":"DROPDOWN","options":{"values":["Simple","Detailed"]}},"description":"The level of detail to return. 'Detailed' includes call legs for each record. Default: 'Simple'."}
   * @paramDef {"type":"Boolean","label":"With Recording Only","name":"withRecording","uiComponent":{"type":"CHECKBOX"},"description":"When enabled, only returns calls that have an associated recording."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to return, starting from 1. Default: 1."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of records per page. Maximum 1000. Default: 100."}
   *
   * @returns {Object}
   * @sampleResult {"records":[{"id":"X2AvJPtwNQpBzUB","sessionId":"4503991005","type":"Voice","direction":"Outbound","action":"VoIP Call","result":"Call connected","extension":{"id":809646018},"from":{"phoneNumber":"+16505550100"},"to":{"phoneNumber":"+16505550103"},"startTime":"2026-07-01T16:00:00.000Z","duration":301}],"paging":{"page":1,"perPage":100}}
   */
  async listAccountCallLog(dateFrom, dateTo, type, direction, view, withRecording, page, perPage) {
    return this.#apiRequest({
      logTag: 'listAccountCallLog',
      url: `${ this.apiBase }/account/~/call-log`,
      query: {
        dateFrom: this.#toIsoDate(dateFrom, 'Date From'),
        dateTo: this.#toIsoDate(dateTo, 'Date To'),
        type,
        direction,
        view,
        withRecording: withRecording === true ? true : undefined,
        page,
        perPage,
      },
    })
  }

  /**
   * @description Downloads the audio content of a call recording and saves it to FlowRunner file storage, returning the saved file's URL. The recording's content type (WAV or MP3) is resolved from its metadata to give the saved file the proper extension. Recording ids come from call log records that include a "recording" object. Requires call recording to be enabled on the account.
   *
   * @route GET /get-call-recording-content
   * @operationName Get Call Recording Content
   * @category Call Log
   *
   * @paramDef {"type":"String","label":"Recording ID","name":"recordingId","required":true,"description":"The id of the call recording (from a call log record's recording.id field)."}
   * @paramDef {"type":"FilesUploadOptions","label":"File Settings","name":"fileOptions","required":false,"include":["scope"],"description":"Optional storage settings for the saved file. Scope defaults to FLOW."}
   *
   * @returns {Object}
   * @sampleResult {"recordingId":"401234567008","fileName":"recording_401234567008.mp3","contentType":"audio/mpeg","durationSeconds":124,"sizeBytes":992000,"downloadUrl":"https://files.flowrunner.com/recording_401234567008.mp3"}
   */
  async getCallRecordingContent(recordingId, fileOptions) {
    if (!recordingId) {
      throw new Error('"Recording ID" is required')
    }

    const metadata = await this.#apiRequest({
      logTag: 'getCallRecordingContent',
      url: `${ this.apiBase }/account/~/recording/${ encodeURIComponent(recordingId) }`,
    })

    const contentType = metadata.contentType || null
    const extension = CONTENT_TYPE_EXTENSIONS[contentType] || 'mp3'
    const fileName = `recording_${ recordingId }.${ extension }`

    const buffer = await this.#downloadBinary(
      `${ this.apiBase }/account/~/recording/${ encodeURIComponent(recordingId) }/content`,
      'getCallRecordingContent'
    )

    const downloadUrl = await this.#saveToFiles(buffer, fileName, fileOptions)

    return {
      recordingId: String(recordingId),
      fileName,
      contentType,
      durationSeconds: metadata.duration ?? null,
      sizeBytes: buffer.length,
      downloadUrl,
    }
  }

  // ============================================= CONTACTS =============================================

  /**
   * @description Retrieves the connected extension's personal address book contacts, paginated. Optionally filter by a name/company prefix and sort by first name, last name, or company. Returns contact records with names, phone numbers, emails, and addresses.
   *
   * @route GET /list-contacts
   * @operationName List Contacts
   * @category Contacts
   *
   * @paramDef {"type":"String","label":"Starts With","name":"startsWith","description":"Optional prefix to filter contacts by first name, last name, or company name."}
   * @paramDef {"type":"String","label":"Sort By","name":"sortBy","uiComponent":{"type":"DROPDOWN","options":{"values":["First Name","Last Name","Company"]}},"description":"Optional sort field for the returned contacts."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to return, starting from 1. Default: 1."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of records per page. Default: 100."}
   *
   * @returns {Object}
   * @sampleResult {"records":[{"id":702551456008,"firstName":"Jane","lastName":"Doe","company":"Acme Corp","email":"jane.doe@example.com","businessPhone":"+16505550110","mobilePhone":"+16505550111"}],"paging":{"page":1,"perPage":100}}
   */
  async listContacts(startsWith, sortBy, page, perPage) {
    return this.#apiRequest({
      logTag: 'listContacts',
      url: `${ this.apiBase }/account/~/extension/~/address-book/contact`,
      query: {
        startsWith,
        sortBy: this.#resolveChoice(sortBy, CONTACT_SORT_OPTIONS),
        page,
        perPage,
      },
    })
  }

  /**
   * @description Retrieves a single personal address book contact of the connected extension by its id, including all names, phone numbers, emails, addresses, and notes.
   *
   * @route GET /get-contact
   * @operationName Get Contact
   * @category Contacts
   *
   * @paramDef {"type":"String","label":"Contact ID","name":"contactId","required":true,"description":"The id of the contact to retrieve (from \"List Contacts\")."}
   *
   * @returns {Object}
   * @sampleResult {"id":702551456008,"firstName":"Jane","lastName":"Doe","company":"Acme Corp","jobTitle":"CTO","email":"jane.doe@example.com","businessPhone":"+16505550110","mobilePhone":"+16505550111","businessAddress":{"street":"20 Davis Dr","city":"Belmont","state":"CA","zip":"94002"},"notes":"Met at the 2026 expo"}
   */
  async getContact(contactId) {
    if (!contactId) {
      throw new Error('"Contact ID" is required')
    }

    return this.#apiRequest({
      logTag: 'getContact',
      url: `${ this.apiBase }/account/~/extension/~/address-book/contact/${ encodeURIComponent(contactId) }`,
    })
  }

  /**
   * @description Creates a new contact in the connected extension's personal address book with names, company, job title, email, phone numbers, business address, and notes. At least one field should be provided. Returns the created contact including its id.
   *
   * @route POST /create-contact
   * @operationName Create Contact
   * @category Contacts
   *
   * @paramDef {"type":"String","label":"First Name","name":"firstName","description":"The contact's first name."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","description":"The contact's last name."}
   * @paramDef {"type":"String","label":"Company","name":"company","description":"The contact's company name."}
   * @paramDef {"type":"String","label":"Job Title","name":"jobTitle","description":"The contact's job title."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"The contact's primary email address."}
   * @paramDef {"type":"String","label":"Business Phone","name":"businessPhone","description":"The contact's business phone number in E.164 format."}
   * @paramDef {"type":"String","label":"Mobile Phone","name":"mobilePhone","description":"The contact's mobile phone number in E.164 format."}
   * @paramDef {"type":"String","label":"Home Phone","name":"homePhone","description":"The contact's home phone number in E.164 format."}
   * @paramDef {"type":"String","label":"Business Street","name":"businessStreet","description":"Street line of the contact's business address."}
   * @paramDef {"type":"String","label":"Business City","name":"businessCity","description":"City of the contact's business address."}
   * @paramDef {"type":"String","label":"Business State","name":"businessState","description":"State or region of the contact's business address."}
   * @paramDef {"type":"String","label":"Business Zip","name":"businessZip","description":"Postal code of the contact's business address."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Free-form notes about the contact."}
   *
   * @returns {Object}
   * @sampleResult {"id":702551456008,"firstName":"Jane","lastName":"Doe","company":"Acme Corp","jobTitle":"CTO","email":"jane.doe@example.com","businessPhone":"+16505550110","businessAddress":{"street":"20 Davis Dr","city":"Belmont","state":"CA","zip":"94002"}}
   */
  async createContact(
    firstName, lastName, company, jobTitle, email, businessPhone, mobilePhone, homePhone,
    businessStreet, businessCity, businessState, businessZip, notes
  ) {
    const body = buildContactBody({
      firstName, lastName, company, jobTitle, email, businessPhone, mobilePhone, homePhone,
      businessStreet, businessCity, businessState, businessZip, notes,
    })

    if (!Object.keys(body).length) {
      throw new Error('At least one contact field is required')
    }

    return this.#apiRequest({
      logTag: 'createContact',
      method: 'post',
      url: `${ this.apiBase }/account/~/extension/~/address-book/contact`,
      body,
    })
  }

  /**
   * @description Updates an existing personal address book contact. Only the provided fields are changed — the current contact is fetched first and merged, so omitted fields keep their existing values (RingCentral's PUT would otherwise clear them). Returns the updated contact.
   *
   * @route PUT /update-contact
   * @operationName Update Contact
   * @category Contacts
   *
   * @paramDef {"type":"String","label":"Contact ID","name":"contactId","required":true,"description":"The id of the contact to update (from \"List Contacts\")."}
   * @paramDef {"type":"String","label":"First Name","name":"firstName","description":"New first name for the contact."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","description":"New last name for the contact."}
   * @paramDef {"type":"String","label":"Company","name":"company","description":"New company name for the contact."}
   * @paramDef {"type":"String","label":"Job Title","name":"jobTitle","description":"New job title for the contact."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"New primary email address for the contact."}
   * @paramDef {"type":"String","label":"Business Phone","name":"businessPhone","description":"New business phone number in E.164 format."}
   * @paramDef {"type":"String","label":"Mobile Phone","name":"mobilePhone","description":"New mobile phone number in E.164 format."}
   * @paramDef {"type":"String","label":"Home Phone","name":"homePhone","description":"New home phone number in E.164 format."}
   * @paramDef {"type":"String","label":"Business Street","name":"businessStreet","description":"New street line of the business address."}
   * @paramDef {"type":"String","label":"Business City","name":"businessCity","description":"New city of the business address."}
   * @paramDef {"type":"String","label":"Business State","name":"businessState","description":"New state or region of the business address."}
   * @paramDef {"type":"String","label":"Business Zip","name":"businessZip","description":"New postal code of the business address."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New free-form notes for the contact."}
   *
   * @returns {Object}
   * @sampleResult {"id":702551456008,"firstName":"Jane","lastName":"Smith","company":"Acme Corp","jobTitle":"CEO","email":"jane.smith@example.com","businessPhone":"+16505550110"}
   */
  async updateContact(
    contactId, firstName, lastName, company, jobTitle, email, businessPhone, mobilePhone, homePhone,
    businessStreet, businessCity, businessState, businessZip, notes
  ) {
    if (!contactId) {
      throw new Error('"Contact ID" is required')
    }

    const updates = buildContactBody({
      firstName, lastName, company, jobTitle, email, businessPhone, mobilePhone, homePhone,
      businessStreet, businessCity, businessState, businessZip, notes,
    })

    if (!Object.keys(updates).length) {
      throw new Error('At least one field to update is required')
    }

    // RingCentral's PUT replaces the contact, clearing omitted fields — merge with the
    // existing record so only the provided fields change.
    const existing = await this.getContact(contactId)
    const writable = { ...existing }

    delete writable.uri
    delete writable.id
    delete writable.availability

    const body = { ...writable, ...updates }

    if (updates.businessAddress) {
      body.businessAddress = { ...(writable.businessAddress || {}), ...updates.businessAddress }
    }

    return this.#apiRequest({
      logTag: 'updateContact',
      method: 'put',
      url: `${ this.apiBase }/account/~/extension/~/address-book/contact/${ encodeURIComponent(contactId) }`,
      body,
    })
  }

  /**
   * @description Deletes a contact from the connected extension's personal address book by its id. This cannot be undone. Returns a success status.
   *
   * @route DELETE /delete-contact
   * @operationName Delete Contact
   * @category Contacts
   *
   * @paramDef {"type":"String","label":"Contact ID","name":"contactId","required":true,"description":"The id of the contact to delete."}
   *
   * @returns {Object}
   * @sampleResult {"status":"success"}
   */
  async deleteContact(contactId) {
    if (!contactId) {
      throw new Error('"Contact ID" is required')
    }

    return this.#apiRequest({
      logTag: 'deleteContact',
      method: 'delete',
      url: `${ this.apiBase }/account/~/extension/~/address-book/contact/${ encodeURIComponent(contactId) }`,
    })
  }

  // ========================================= ACCOUNT & EXTENSIONS =====================================

  /**
   * @description Retrieves the connected RingCentral account's information, including the main company number, operator extension, service plan, status, and setup state. Useful as a connection check.
   *
   * @route GET /get-account-info
   * @operationName Get Account Info
   * @category Account
   *
   * @returns {Object}
   * @sampleResult {"id":809646018,"mainNumber":"+16505550100","operator":{"id":809646018,"extensionNumber":"101"},"serviceInfo":{"brand":{"name":"RingCentral"},"servicePlan":{"name":"RingCentral MVP"}},"setupWizardState":"Completed","status":"Confirmed"}
   */
  async getAccountInfo() {
    return this.#apiRequest({
      logTag: 'getAccountInfo',
      url: `${ this.apiBase }/account/~`,
    })
  }

  /**
   * @description Retrieves the extensions of the connected RingCentral account, paginated. Filter by extension status (Enabled, Disabled, Not Activated, Unassigned) and type (User, Department, IVR Menu, etc.). Returns each extension's id, number, name, type, and status.
   *
   * @route GET /list-extensions
   * @operationName List Extensions
   * @category Account
   *
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Enabled","Disabled","Not Activated","Unassigned"]}},"description":"Optional extension status filter. When omitted, extensions in all states are returned."}
   * @paramDef {"type":"String","label":"Type","name":"type","uiComponent":{"type":"DROPDOWN","options":{"values":["User","Department","Announcement","Voicemail","Shared Lines Group","Paging Only","Park Location","IVR Menu","Limited"]}},"description":"Optional extension type filter. When omitted, all extension types are returned."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to return, starting from 1. Default: 1."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of records per page. Maximum 1000. Default: 100."}
   *
   * @returns {Object}
   * @sampleResult {"records":[{"id":809646018,"extensionNumber":"101","name":"John Smith","type":"User","status":"Enabled","contact":{"email":"john.smith@example.com"}}],"paging":{"page":1,"perPage":100,"totalElements":12}}
   */
  async listExtensions(status, type, page, perPage) {
    return this.#apiRequest({
      logTag: 'listExtensions',
      url: `${ this.apiBase }/account/~/extension`,
      query: {
        status: this.#resolveChoice(status, EXTENSION_STATUS_OPTIONS),
        type: this.#resolveChoice(type, EXTENSION_TYPE_OPTIONS),
        page,
        perPage,
      },
    })
  }

  /**
   * @description Retrieves a single extension of the connected account by its id, including the extension number, name, type, status, contact details, and regional settings.
   *
   * @route GET /get-extension
   * @operationName Get Extension
   * @category Account
   *
   * @paramDef {"type":"String","label":"Extension","name":"extensionId","required":true,"dictionary":"getExtensionsDictionary","description":"The extension to retrieve. Pick one from the dictionary or enter an extension id directly."}
   *
   * @returns {Object}
   * @sampleResult {"id":809646018,"extensionNumber":"101","name":"John Smith","type":"User","status":"Enabled","contact":{"firstName":"John","lastName":"Smith","email":"john.smith@example.com"},"regionalSettings":{"timezone":{"name":"US/Pacific"}}}
   */
  async getExtension(extensionId) {
    if (!extensionId) {
      throw new Error('"Extension" is required')
    }

    return this.#apiRequest({
      logTag: 'getExtension',
      url: `${ this.apiBase }/account/~/extension/${ encodeURIComponent(extensionId) }`,
    })
  }

  /**
   * @description Retrieves the extension of the connected (authorized) user, including the extension number, name, type, status, contact details, and permissions. Useful for identifying who the connection acts as.
   *
   * @route GET /get-current-extension
   * @operationName Get Current Extension
   * @category Account
   *
   * @returns {Object}
   * @sampleResult {"id":809646018,"extensionNumber":"101","name":"John Smith","type":"User","status":"Enabled","contact":{"firstName":"John","lastName":"Smith","email":"john.smith@example.com"},"permissions":{"admin":{"enabled":true}}}
   */
  async getCurrentExtension() {
    return this.#apiRequest({
      logTag: 'getCurrentExtension',
      url: `${ this.apiBase }/account/~/extension/~`,
    })
  }

  /**
   * @description Retrieves the phone numbers assigned to the connected extension, paginated. Optionally filter by usage type. Each record includes the number's features array (e.g. SmsSender, MmsSender, CallerId), which indicates what the number can be used for — numbers with SmsSender can be used as the "Send SMS" sender.
   *
   * @route GET /list-phone-numbers
   * @operationName List Phone Numbers
   * @category Account
   *
   * @paramDef {"type":"String","label":"Usage Type","name":"usageType","uiComponent":{"type":"DROPDOWN","options":{"values":["Main Company Number","Additional Company Number","Company Number","Direct Number","Company Fax Number","Forwarded Number","Forwarded Company Number"]}},"description":"Optional usage type filter. When omitted, numbers of all usage types are returned."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to return, starting from 1. Default: 1."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of records per page. Default: 100."}
   *
   * @returns {Object}
   * @sampleResult {"records":[{"id":709483306008,"phoneNumber":"+16505550100","usageType":"DirectNumber","type":"VoiceFax","features":["SmsSender","MmsSender","CallerId"],"status":"Normal"}],"paging":{"page":1,"perPage":100}}
   */
  async listPhoneNumbers(usageType, page, perPage) {
    return this.#apiRequest({
      logTag: 'listPhoneNumbers',
      url: `${ this.apiBase }/account/~/extension/~/phone-number`,
      query: {
        usageType: this.#resolveChoice(usageType, PHONE_USAGE_TYPE_OPTIONS),
        page,
        perPage,
      },
    })
  }

  /**
   * @description Retrieves the presence status of the connected extension — availability (Available, Busy, Offline), user-set status, DND status, and optionally the detailed telephony state of ongoing calls.
   *
   * @route GET /get-presence
   * @operationName Get Presence
   * @category Account
   *
   * @paramDef {"type":"Boolean","label":"Detailed Telephony State","name":"detailedTelephonyState","uiComponent":{"type":"CHECKBOX"},"description":"When enabled, includes the detailed telephony state (Ringing, CallConnected, ParkedCall, etc.) and active call information."}
   *
   * @returns {Object}
   * @sampleResult {"presenceStatus":"Available","telephonyStatus":"NoCall","userStatus":"Available","dndStatus":"TakeAllCalls","allowSeeMyPresence":true,"extension":{"id":809646018,"extensionNumber":"101"}}
   */
  async getPresence(detailedTelephonyState) {
    return this.#apiRequest({
      logTag: 'getPresence',
      url: `${ this.apiBase }/account/~/extension/~/presence`,
      query: {
        detailedTelephonyState: detailedTelephonyState === true ? true : undefined,
      },
    })
  }

  // ========================================== TEAM MESSAGING ==========================================

  /**
   * @description Retrieves the connected user's team messaging (RingCentral app) chats, paginated with a page token. Optionally filter by one or more chat types: Everyone (the company-wide chat), Team, Group, Direct, or Personal. Returns chat records with id, type, name (for teams), and member ids.
   *
   * @route GET /list-chats
   * @operationName List Chats
   * @category Team Messaging
   *
   * @paramDef {"type":"Array<String>","label":"Chat Types","name":"chatTypes","uiComponent":{"type":"DROPDOWN","options":{"values":["Everyone","Team","Group","Direct","Personal"]}},"description":"Optional chat types to include. When omitted, chats of all types are returned."}
   * @paramDef {"type":"Number","label":"Record Count","name":"recordCount","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of chats to return per page. Maximum 250. Default: 30."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Optional pagination token from a previous response's navigation.nextPageToken."}
   *
   * @returns {Object}
   * @sampleResult {"records":[{"id":"637468356610","type":"Team","name":"Deal Desk","public":true,"status":"Active","members":[{"id":"62288422018"}],"creationTime":"2026-01-15T10:00:00Z"}],"navigation":{"nextPageToken":"AAB3aG"}}
   */
  async listChats(chatTypes, recordCount, pageToken) {
    const types = (Array.isArray(chatTypes) ? chatTypes : (chatTypes ? [chatTypes] : [])).filter(Boolean)

    return this.#apiRequest({
      logTag: 'listChats',
      url: `${ this.teamMessagingBase }/chats`,
      query: {
        type: types.length ? types.join(',') : undefined,
        recordCount: recordCount || DEFAULT_RECORD_COUNT,
        pageToken,
      },
    })
  }

  /**
   * @description Retrieves the team messaging teams the connected user is a member of, paginated with a page token. Returns team records with id, name, description, public flag, and status.
   *
   * @route GET /list-teams
   * @operationName List Teams
   * @category Team Messaging
   *
   * @paramDef {"type":"Number","label":"Record Count","name":"recordCount","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of teams to return per page. Maximum 250. Default: 30."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Optional pagination token from a previous response's navigation.nextPageToken."}
   *
   * @returns {Object}
   * @sampleResult {"records":[{"id":"637468356610","type":"Team","name":"Deal Desk","description":"Quotes and approvals","public":true,"status":"Active","creationTime":"2026-01-15T10:00:00Z"}],"navigation":{"nextPageToken":"AAB3aG"}}
   */
  async listTeams(recordCount, pageToken) {
    return this.#apiRequest({
      logTag: 'listTeams',
      url: `${ this.teamMessagingBase }/teams`,
      query: {
        recordCount: recordCount || DEFAULT_RECORD_COUNT,
        pageToken,
      },
    })
  }

  /**
   * @description Retrieves a single team messaging chat by its id, including its type, name (for teams), status, and member ids.
   *
   * @route GET /get-chat
   * @operationName Get Chat
   * @category Team Messaging
   *
   * @paramDef {"type":"String","label":"Chat","name":"chatId","required":true,"dictionary":"getChatsDictionary","description":"The chat to retrieve. Pick one from the dictionary or enter a chat id directly."}
   *
   * @returns {Object}
   * @sampleResult {"id":"637468356610","type":"Team","name":"Deal Desk","public":true,"status":"Active","members":[{"id":"62288422018"},{"id":"62288422019"}],"creationTime":"2026-01-15T10:00:00Z"}
   */
  async getChat(chatId) {
    if (!chatId) {
      throw new Error('"Chat" is required')
    }

    return this.#apiRequest({
      logTag: 'getChat',
      url: `${ this.teamMessagingBase }/chats/${ encodeURIComponent(chatId) }`,
    })
  }

  /**
   * @description Posts a text message to a team messaging chat (team, group, direct, or personal chat) on behalf of the connected user. Supports RingCentral's markdown-style formatting and @-mentions (e.g. '![:Person](personId)'). Returns the created post.
   *
   * @route POST /post-message-to-chat
   * @operationName Post Message to Chat
   * @category Team Messaging
   *
   * @paramDef {"type":"String","label":"Chat","name":"chatId","required":true,"dictionary":"getChatsDictionary","description":"The chat to post the message to. Pick one from the dictionary or enter a chat id directly."}
   * @paramDef {"type":"String","label":"Text","name":"text","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The message text to post. Maximum 10000 characters."}
   *
   * @returns {Object}
   * @sampleResult {"id":"6640455628164","groupId":"637468356610","type":"TextMessage","text":"Build passed, deploying now.","creatorId":"62288422018","creationTime":"2026-07-01T18:10:00Z"}
   */
  async postMessageToChat(chatId, text) {
    if (!chatId) {
      throw new Error('"Chat" is required')
    }

    if (!text) {
      throw new Error('"Text" is required')
    }

    return this.#apiRequest({
      logTag: 'postMessageToChat',
      method: 'post',
      url: `${ this.teamMessagingBase }/chats/${ encodeURIComponent(chatId) }/posts`,
      body: { text },
    })
  }

  /**
   * @description Retrieves the posts (messages) of a team messaging chat, newest first, paginated with a page token. Returns post records with text, creator id, attachments, and mentions.
   *
   * @route GET /list-chat-posts
   * @operationName List Chat Posts
   * @category Team Messaging
   *
   * @paramDef {"type":"String","label":"Chat","name":"chatId","required":true,"dictionary":"getChatsDictionary","description":"The chat to read posts from. Pick one from the dictionary or enter a chat id directly."}
   * @paramDef {"type":"Number","label":"Record Count","name":"recordCount","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of posts to return per page. Maximum 250. Default: 30."}
   * @paramDef {"type":"String","label":"Page Token","name":"pageToken","description":"Optional pagination token from a previous response's navigation.prevPageToken."}
   *
   * @returns {Object}
   * @sampleResult {"records":[{"id":"6640455628164","groupId":"637468356610","type":"TextMessage","text":"Build passed, deploying now.","creatorId":"62288422018","creationTime":"2026-07-01T18:10:00Z"}],"navigation":{"prevPageToken":"AAB3aG"}}
   */
  async listChatPosts(chatId, recordCount, pageToken) {
    if (!chatId) {
      throw new Error('"Chat" is required')
    }

    return this.#apiRequest({
      logTag: 'listChatPosts',
      url: `${ this.teamMessagingBase }/chats/${ encodeURIComponent(chatId) }/posts`,
      query: {
        recordCount: recordCount || DEFAULT_RECORD_COUNT,
        pageToken,
      },
    })
  }

  /**
   * @description Creates a new team messaging team with a name, optional member list (by email), and public/private visibility. The connected user becomes the team's creator and admin. Returns the created team including its id, which can be used with "Post Message to Chat".
   *
   * @route POST /create-team
   * @operationName Create Team
   * @category Team Messaging
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The name of the new team. Maximum 250 characters."}
   * @paramDef {"type":"Array<String>","label":"Member Emails","name":"memberEmails","description":"Optional email addresses of users to add to the team. Co-workers are matched by their RingCentral email."}
   * @paramDef {"type":"Boolean","label":"Public","name":"isPublic","uiComponent":{"type":"CHECKBOX"},"description":"Whether the team is public (any co-worker can join) or private (invite-only). Default: false (private)."}
   *
   * @returns {Object}
   * @sampleResult {"id":"637468356610","type":"Team","name":"Deal Desk","public":false,"status":"Active","creationTime":"2026-07-01T18:15:00Z"}
   */
  async createTeam(name, memberEmails, isPublic) {
    if (!name) {
      throw new Error('"Name" is required')
    }

    const members = (Array.isArray(memberEmails) ? memberEmails : (memberEmails ? [memberEmails] : []))
      .filter(Boolean)
      .map(email => ({ email: String(email).trim() }))

    const body = { name }

    if (members.length) {
      body.members = members
    }

    if (isPublic !== undefined && isPublic !== null) {
      body.public = isPublic
    }

    return this.#apiRequest({
      logTag: 'createTeam',
      method: 'post',
      url: `${ this.teamMessagingBase }/teams`,
      body,
    })
  }
}

Flowrunner.ServerCode.addService(RingCentralService, [
  {
    displayName: 'Client Id',
    defaultValue: '',
    name: 'clientId',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'The Client ID of your RingCentral app from https://developers.ringcentral.com/my-account.html. The app must use the "3-legged OAuth flow authorization code" grant.',
  },
  {
    displayName: 'Client Secret',
    defaultValue: '',
    name: 'clientSecret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'The Client Secret of your RingCentral app from https://developers.ringcentral.com/my-account.html.',
  },
  {
    displayName: 'Environment',
    name: 'environment',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.CHOICE,
    options: ['Production', 'Sandbox'],
    defaultValue: 'Production',
    required: true,
    shared: false,
    hint: 'RingCentral environment to connect to. New RingCentral apps start in Sandbox (platform.devtest.ringcentral.com) and must pass RingCentral\'s "Apply for Production" review before they can access Production (platform.ringcentral.com). Use Sandbox with a devtest account while your app is under development.',
  },
])

function cleanupObject(data) {
  const result = {}

  Object.keys(data).forEach(key => {
    if (data[key] !== undefined && data[key] !== null && data[key] !== '') {
      result[key] = data[key]
    }
  })

  return result
}

function isEmptyResponse(response) {
  if (response === undefined || response === null || response === '') {
    return true
  }

  return typeof response === 'object' && !Buffer.isBuffer(response) && Object.keys(response).length === 0
}

// Normalizes a downloaded body to a Buffer. Flowrunner.Request auto-parses the response
// by Content-Type, so a JSON/text source may come back as a parsed object/array/string
// despite .setEncoding(null); re-serialize anything that isn't already a Buffer.
function toBuffer(body) {
  if (Buffer.isBuffer(body)) {
    return body
  }

  if (typeof body === 'string') {
    return Buffer.from(body)
  }

  return Buffer.from(JSON.stringify(body))
}

// Turns a RingCentral usage type token (e.g. "DirectNumber") into a friendly label.
function formatUsageType(usageType) {
  if (!usageType) {
    return ''
  }

  return String(usageType).replace(/([a-z])([A-Z])/g, '$1 $2')
}

// Builds a RingCentral contact body from individual action parameters,
// dropping empty values and nesting the business address.
function buildContactBody({
  firstName, lastName, company, jobTitle, email, businessPhone, mobilePhone, homePhone,
  businessStreet, businessCity, businessState, businessZip, notes,
}) {
  const body = cleanupObject({
    firstName, lastName, company, jobTitle, email, businessPhone, mobilePhone, homePhone, notes,
  })

  const businessAddress = cleanupObject({
    street: businessStreet,
    city: businessCity,
    state: businessState,
    zip: businessZip,
  })

  if (Object.keys(businessAddress).length) {
    body.businessAddress = businessAddress
  }

  return body
}
