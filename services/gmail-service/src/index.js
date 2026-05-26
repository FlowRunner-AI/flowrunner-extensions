'use strict'

const { logger } = require('./logger')
const { DEFAULT_SCOPE_STRING } = require('./constants')
const {
  getRandomLabelColor,
  constructIdentityName,
  getIdentityImageURL,
  getValidAttachments,
  createSearchParams,
  searchFilter,
  assert,
} = require('./utils')
const EmailParser = require('./email-parser')

const API_BASE_URL = 'https://gmail.googleapis.com/gmail/v1'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const OAUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const USER_INFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo'

const MAX_MESSAGES_LIST_COUNT = 30
const DEFAULT_MESSAGES_LIST_COUNT = 10

/**
 *  @requireOAuth
 *  @usesFileStorage
 *  @integrationName Gmail
 *  @integrationIcon /icon.png
 **/
class GmailService {
  constructor(config) {
    this.emailParser = new EmailParser()

    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
    this.scopes = DEFAULT_SCOPE_STRING
  }

  /**
   * @private
   */
  async #apiRequest({ url, method, body, query, logTag, headers }) {
    method = method || 'get'

    if (query) {
      query = cleanupObject(query)
    }

    try {
      logger.debug(`${ logTag } - api request: [${ method }::${ url }] q=[${ JSON.stringify(query) }]`)

      return await Flowrunner.Request[method](url)
        .set(this.#getAccessTokenHeader())
        .set({ ...headers })
        .query(query)
        .send(body)
    } catch (error) {
      logger.error(`${ logTag } - error: ${ JSON.stringify({ ...error }) }`)

      throw error
    }
  }

  /**
   * @private
   */
  #getAccessTokenHeader(accessToken) {
    return {
      Authorization: `Bearer ${ accessToken || this.request.headers['oauth-access-token'] }`,
    }
  }

  /**
   * @registerAs SYSTEM
   * @route GET /getOAuth2ConnectionURL
   * @returns {String}
   */
  async getOAuth2ConnectionURL() {
    const params = new URLSearchParams()

    params.append('client_id', this.clientId)
    params.append('response_type', 'code')
    params.append('scope', this.scopes)
    params.append('access_type', 'offline')
    params.append('prompt', 'consent')

    const connectionURL = `${ OAUTH_URL }?${ params.toString() }`

    logger.debug(`composed connectionURL: ${ connectionURL }`)

    return connectionURL
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
    const { access_token, expires_in } = await Flowrunner.Request.post(TOKEN_URL)
      .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
      .query({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      })

    return {
      token: access_token,
      expirationInSeconds: expires_in,
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
    params.append('client_id', this.clientId)
    params.append('code', callbackObject.code)
    params.append('redirect_uri', callbackObject.redirectURI)
    params.append('grant_type', 'authorization_code')
    params.append('client_secret', this.clientSecret)
    params.append('access_type', 'offline')

    const codeExchangeResponse = await Flowrunner.Request.post(TOKEN_URL)
      .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
      .send(params.toString())

    const userData = await this.#apiRequest({
      logTag: 'getCurrentUserInfo',
      url: USER_INFO_URL,
      headers: this.#getAccessTokenHeader(codeExchangeResponse['access_token']),
    })

    return {
      token: codeExchangeResponse['access_token'],
      expirationInSeconds: codeExchangeResponse['expires_in'],
      refreshToken: codeExchangeResponse['refresh_token'],
      connectionIdentityName:
        constructIdentityName(userData) || 'Unknown Gmail Account',
      connectionIdentityImageURL: getIdentityImageURL(userData),
      overwrite: true,
      userData: userData,
    }
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerPollingForEvent(invocation) {
    return this[invocation.eventName](invocation)
  }

  /**
   * @private
   */
  #getCurrentAccountInfo() {
    return this.#apiRequest({
      logTag: 'getCurrentAccountInfo',
      url: USER_INFO_URL,
    })
  }

  /**
   * @private
   */
  async #getLabels() {
    const { labels } = await this.#apiRequest({
      logTag: 'getLabels',
      url: `${ API_BASE_URL }/users/me/labels`,
    })

    return labels
  }

  /**
   * @private
   */
  #getAttachments(parts) {
    return parts
      .filter(part => part.filename && part.body?.attachmentId)
      .map(part => ({
        id: part.body.attachmentId,
        name: part.filename,
      }))
  }

  /**
   * @private
   */
  async #getDraft(id) {
    assert(id, 'Draft ID')

    return await this.#apiRequest({
      logTag: 'getDraft',
      url: `${ API_BASE_URL }/users/me/drafts/${ id }`,
    })
  }

  /**
   * @private
   */
  async #getThreads(cursor) {
    const { threads, nextPageToken } = await this.#apiRequest({
      logTag: 'getThreads',
      url: `${ API_BASE_URL }/users/me/threads`,
      query: { maxResults: DEFAULT_MESSAGES_LIST_COUNT, pageToken: cursor },
    })

    return { threads, nextPageToken }
  }

  /**
   * @private
   */
  async #getThread(threadId) {
    return await this.#apiRequest({
      logTag: 'getThread',
      url: `${ API_BASE_URL }/users/me/threads/${ threadId }`,
    })
  }

  // ========================================== DICTIONARIES ===========================================

  /**
   * @registerAs DICTIONARY
   *
   * @param {Object} payload
   * @returns {Object}
   */
  async getMessagesDictionary({ search, cursor }) {
    const query = createSearchParams({
      query: search,
      nextPageToken: cursor,
      maxResults: DEFAULT_MESSAGES_LIST_COUNT,
    })

    const { messages, nextPageToken } = await this.#apiRequest({
      logTag: 'getMessagesDictionary',
      url: `${ API_BASE_URL }/users/me/messages`,
      query,
    })

    const detailedMessages = await Promise.all((messages || []).map(message => this.getMessage(message.id)))

    return {
      cursor: nextPageToken,
      items: detailedMessages.map(({ id, snippet }) => ({
        label: truncateMessageSnippet(snippet) || '[empty]',
        note: `ID: ${ id }`,
        value: id,
      })),
    }
  }

  /**
   * @typedef {Object} getLabelsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter Gmail labels by their name."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Labels
   * @category Label Management
   * @description Returns Gmail labels for AI agents to categorize emails, organize messages, or filter content by specific criteria.
   *
   * @route POST /get-labels
   *
   * @paramDef {"type":"getLabelsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string for retrieving and filtering Gmail labels."}
   *
   * @sampleResult {"items":[{"label":"Inbox","note":"ID: INBOX","value":"INBOX"}]}
   * @returns {Object}
   */
  async getLabelsDictionary(payload) {
    const { search } = payload || {}

    const labels = await this.#getLabels()

    const filteredLabels = search
      ? searchFilter(labels, ['name'], search)
      : labels

    return {
      items: filteredLabels.map(({ id, name }) => ({
        label: name || id,
        note: `ID: ${ id }`,
        value: id,
      })),
    }
  }

  /**
   * @typedef {Object} getMessageLabelsDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Message ID","name":"messageId","required":true,"description":"Unique identifier of the Gmail message whose labels will be listed."}
   */

  /**
   * @typedef {Object} getMessageLabelsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter label IDs."}
   * @paramDef {"type":"getMessageLabelsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required parameter to identify the Gmail message."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Message Labels
   * @category Label Management
   * @description Returns a list of labels associated with the specified Gmail message.
   *
   * @route POST /get-message-labels
   *
   * @paramDef {"type":"getMessageLabelsDictionary__payload","label":"Payload","name":"payload","description":"Contains message ID and optional search string for retrieving and filtering label IDs."}
   *
   * @sampleResult {"items":[{"label":"Label_Important","note":"ID: Label_Important","value":"Label_Important"}]}
   * @returns {Object}
   */
  async getMessageLabelsDictionary({ search, criteria: { messageId } }) {
    assert(messageId, 'Message ID')

    const { labelIds } = await this.#apiRequest({
      logTag: 'getMessageLabelsDictionary',
      url: `${ API_BASE_URL }/users/me/messages/${ messageId }`,
    })

    const filteredLabelIds = search
      ? searchFilter(labelIds, [], search)
      : labelIds

    return {
      items: filteredLabelIds.map(id => ({
        label: id,
        note: `ID: ${ id }`,
        value: id,
      })),
    }
  }

  /**
   * @typedef {Object} getAttachmentsDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Message ID","name":"messageId","required":true,"description":"Unique identifier of the Gmail message whose attachments will be listed."}
   */

  /**
   * @typedef {Object} getAttachmentsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter attachments by their name."}
   * @paramDef {"type":"getAttachmentsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required parameter to identify the Gmail message."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Attachments
   * @category Attachment Management
   * @description Returns a list of attachments for the specified Gmail message.
   *
   * @route POST /get-attachments
   *
   * @paramDef {"type":"getAttachmentsDictionary__payload","label":"Payload","name":"payload","description":"Contains message ID and optional search string for retrieving and filtering attachments."}
   *
   * @sampleResult {"items":[{"label":"invoice.pdf","note":"ID: 123abc456","value":"123abc456"}]}
   * @returns {Object}
   */
  async getAttachmentsDictionary({ search, criteria: { messageId } }) {
    assert(messageId, 'Message ID')

    const message = await this.#apiRequest({
      logTag: 'getAttachmentsDictionary',
      url: `${ API_BASE_URL }/users/me/messages/${ messageId }`,
    })

    const attachments = message.payload?.parts
      ? this.#getAttachments(message.payload?.parts)
      : []

    const filteredAttachments = search
      ? searchFilter(attachments, ['name'], search)
      : attachments

    return {
      items: filteredAttachments.map(({ id, name }) => ({
        label: name || '[empty]',
        note: `ID: ${ id }`,
        value: id,
      })),
    }
  }

  /**
   * @registerAs DICTIONARY
   *
   * @param {Object} payload
   * @returns {Object}
   */
  async getDraftsDictionary({ search, cursor }) {
    const query = createSearchParams({
      query: search,
      nextPageToken: cursor,
      maxResults: DEFAULT_MESSAGES_LIST_COUNT,
    })

    const { drafts, nextPageToken } = await this.#apiRequest({
      logTag: 'getDraftsDictionary',
      url: `${ API_BASE_URL }/users/me/drafts`,
      query,
    })

    const detailedDrafts = await Promise.all((drafts || []).map(draft => this.#getDraft(draft.id)))

    return {
      cursor: nextPageToken,
      items: detailedDrafts.map(({ id, message }) => ({
        label: truncateMessageSnippet(message.snippet) || '[empty]',
        note: `ID: ${ id }`,
        value: id,
      })),
    }
  }

  /**
   * @typedef {Object} getThreadsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter Gmail threads by their content."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination token for retrieving the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Threads
   * @category Thread Management
   * @description Returns a paginated list of Gmail threads.
   *
   * @route POST /get-threads
   *
   * @paramDef {"type":"getThreadsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination token for retrieving and filtering Gmail threads."}
   *
   * @sampleResult {"cursor":"Cg0KGnd1ZXJ5X3Rva2VuXzEyMw","items":[{"label":"Let's schedule a meeting","note":"ID: 9f8e7d6c5b","value":"9f8e7d6c5b"}]}
   * @returns {Object}
   */
  async getThreadsDictionary({ search, cursor }) {
    const { threads, nextPageToken } = await this.#getThreads(cursor)

    const filteredThreads = search
      ? searchFilter(threads, ['snippet'], search)
      : threads

    return {
      cursor: nextPageToken,
      items: filteredThreads.map(({ id, snippet }) => ({
        label: truncateMessageSnippet(snippet) || '[empty]',
        note: `ID: ${ id }`,
        value: id,
      })),
    }
  }

  // ======================================= END OF DICTIONARIES =======================================

  /**
   * @description Retrieves Gmail messages for AI agents to analyze email content, extract leads, monitor communications, or automate email-based workflows.
   *
   * @route POST /get-messages-list
   * @operationName Get Messages List
   * @category Message Management
   * @appearanceColor #33a854 #ea4435
   * @requiredOauth2Scopes https://www.googleapis.com/auth/gmail.readonly
   *
   * @paramDef {"type":"String","label":"Query","name":"query","description":"Gmail search query to filter messages."}
   * @paramDef {"type":"Boolean","label":"Load Unread","name":"loadUnread","uiComponent":{"type":"TOGGLE"},"description":"Enable to focus on unread messages only."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","description":"Maximum number of messages to retrieve (1-30). Default: 10.","uiComponent":{"type":"NUMERIC_STEPPER"}}
   * @paramDef {"type":"String","label":"Label(s)","name":"labels","dictionary":"getLabelsDictionary","description":"Filter by Gmail labels."}
   * @paramDef {"type":"Boolean","label":"Include From Spam and Trash","name":"includeSpamTrash","uiComponent":{"type":"TOGGLE"},"description":"Enable to include messages from Spam and Trash folders."}
   * @paramDef {"type":"Boolean","label":"Include Content","name":"includeContent","uiComponent":{"type":"TOGGLE"},"description":"Enable to load full message content."}
   *
   * @sampleResult [{"snippet":"Example snippet text","date":1234567890000,"subject":"Example Subject","id":"example_message_id"}]
   * @returns {Promise<Array.<Object>>}
   */
  async getMessagesList(query, loadUnread, maxResults, labels, includeSpamTrash, includeContent) {
    const labelIds = await this.ensureExistedLabelIdsList(labels)

    maxResults = Math.min(Math.max(maxResults || DEFAULT_MESSAGES_LIST_COUNT, 1), MAX_MESSAGES_LIST_COUNT)

    const parameters = createSearchParams({
      query,
      loadUnread,
      maxResults,
      labelIds,
      includeSpamTrash,
    })

    const result = await this.#apiRequest({
      logTag: 'getMessagesList',
      url: `${ API_BASE_URL }/users/me/messages`,
      query: parameters,
    })

    const messages = result.messages || []

    if (includeContent) {
      return Promise.all(messages.map(message => this.getMessage(message.id)))
    }

    return messages
  }

  /**
   * @description Retrieves a specified email message by its ID.
   *
   * @route POST /get-message
   * @operationName Get Message
   * @category Message Management
   * @appearanceColor #33a854 #ea4435
   * @requiredOauth2Scopes https://www.googleapis.com/auth/gmail.readonly
   *
   * @paramDef {"type":"String","label":"Message ID","name":"messageId","required":true,"dictionary":"getMessagesDictionary","description":"The ID of the message to retrieve."}
   *
   * @sampleResult {"snippet":"Example snippet text","date":1234567890000,"subject":"Example Subject","id":"example_message_id"}
   * @returns {Promise<Object>}
   */
  async getMessage(messageId) {
    assert(messageId, 'Message ID')

    const rawEmail = await this.#apiRequest({
      logTag: 'getMessage',
      url: `${ API_BASE_URL }/users/me/messages/${ messageId }`,
    })

    return this.emailParser.parseMessage(rawEmail)
  }

  /**
   * @description Sends emails through Gmail for AI agents to automate customer communication.
   *
   * @route POST /send-message
   * @operationName Send Message
   * @category Email Sending
   * @appearanceColor #33a854 #ea4435
   * @requiredOauth2Scopes https://www.googleapis.com/auth/gmail.send
   *
   * @paramDef {"type":"String","label":"To","name":"to","required":true,"description":"Recipient's email address."}
   * @paramDef {"type":"String","label":"Subject","name":"subject","required":true,"description":"Email subject line."}
   * @paramDef {"type":"String","label":"Body Type","name":"bodyType","uiComponent":{"type":"DROPDOWN","options":{"values":["html","plain"]}},"description":"Select HTML for rich formatting or plain text for simple messages."}
   * @paramDef {"type":"String","label":"Body Content","name":"bodyContent","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Email body content."}
   * @paramDef {"type":"String","label":"From","name":"from","description":"The sender's email address (by default, your Gmail account)."}
   * @paramDef {"type":"Array.<String>","label":"CC","name":"cc","description":"Optional CC email addresses."}
   * @paramDef {"type":"Array.<String>","label":"BCC","name":"bcc","description":"Optional BCC email addresses."}
   * @paramDef {"type":"String","label":"Thread ID","name":"threadId","dictionary":"getThreadsDictionary","description":"Optional. The ID of the thread to reply to."}
   * @paramDef {"type":"String","label":"Attachments URLs","name":"attachments","description":"Optional. Attachments can be a string URL or an array of string URLs. Total attachments size - 25mb."}
   *
   * @sampleResult { "threadId": "example_id_d760daf7d", "labelIds": ["EXAMPLE_SENT"], "id": "example_id_4d760daf7d" }
   * @returns {Promise<Object>}
   */
  async sendMessage(to, subject, bodyType, bodyContent, from, cc, bcc, threadId, attachments) {
    const emailData = {
      to,
      subject,
      bodyType,
      bodyContent,
      from,
      cc,
      bcc,
    }

    if (!emailData.from) {
      const currentAccount = await this.#getCurrentAccountInfo()
      emailData.from = currentAccount.name
    }

    if (attachments) {
      const validAttachments = await getValidAttachments(attachments)

      if (validAttachments.length > 0) {
        emailData.attachments = validAttachments
      }
    }

    const userData = await this.#getCurrentAccountInfo()

    emailData.myEmail = userData.email

    const rawMessage = this.emailParser.createEmailMessage(emailData)

    const body = {
      raw: rawMessage,
    }

    if (threadId) {
      body.threadId = threadId

      try {
        const thread = await this.#getThread(threadId)
        logger.debug(`sendMessage -> thread: ${ JSON.stringify(thread) }`)

        const latestMessage = thread.messages?.[thread.messages.length - 1]
        const headers = latestMessage?.payload?.headers || []

        const messageId = headers.find(h => h.name.toLowerCase() === 'message-id')?.value
        const existingRefs = headers.find(h => h.name.toLowerCase() === 'references')?.value

        logger.debug(`messageId: ${ messageId }, existingRefs: ${ existingRefs }`)

        if (messageId) {
          emailData.inReplyTo = messageId
          emailData.references = existingRefs ? `${ existingRefs } ${ messageId }` : messageId
          body.raw = this.emailParser.createEmailMessage(emailData)

          logger.debug('email rebuilt with thread headers')
        }
      } catch (error) {
        logger.error(`Failed to add thread headers: ${ error.message }`)
      }
    }

    return this.#apiRequest({
      logTag: 'sendMessage',
      method: 'post',
      url: `${ API_BASE_URL }/users/me/messages/send`,
      body,
    })
  }

  /**
   * @description Adds labels to a message.
   *
   * @route POST /add-label
   * @operationName Add Label To Message
   * @category Label Management
   * @appearanceColor #33a854 #ea4435
   * @requiredOauth2Scopes https://www.googleapis.com/auth/gmail.modify
   *
   * @paramDef {"type":"String","label":"Message ID","name":"messageId","required":true,"dictionary":"getMessagesDictionary","description":"The unique identifier of the message to update."}
   * @paramDef {"type":"String","label":"Label(s)","name":"labels","required":true,"dictionary":"getLabelsDictionary","description":"Single Label name or ID or a list of Label IDs or Names to add to the message."}
   *
   * @sampleResult { "labelIds": ["EXAMPLE_LABEL_ID_1", "EXAMPLE_LABEL_ID_2"] }
   * @returns {Promise<Object>}
   */
  async addLabelToMessage(messageId, labels) {
    assert(messageId, 'Message ID')

    if (typeof labels === 'string') {
      labels = [labels]
    }

    if (!Array.isArray(labels)) {
      throw new Error('The Label(s) argument must be a string or a list of strings')
    }

    const { existedLabelsMap, missedLabelsMap } = await this.#resolveLabelIds(labels)

    const missedTokens = Object.keys(missedLabelsMap)

    if (missedTokens.length) {
      logger.debug(`can not find labels with tokens=[${ JSON.stringify(missedTokens) }]`)

      await Promise.all(
        missedTokens.map(name => {
          logger.debug(`create a new label with name="${ name }"`)

          const { backgroundColor, textColor } = getRandomLabelColor(name)

          return this.createLabel(name, null, null, backgroundColor, textColor).then(label => {
            existedLabelsMap[name] = label.id
          })
        })
      )
    }

    const addLabelIds = labels.map(token => existedLabelsMap[token])

    const result = await this.#apiRequest({
      logTag: 'addLabelToMessage',
      method: 'post',
      url: `${ API_BASE_URL }/users/me/messages/${ messageId }/modify`,
      body: { addLabelIds },
    })

    return {
      labelIds: result.labelIds,
    }
  }

  /**
   * @description Marks a message as "Read".
   *
   * @route POST /mark-message-as-read
   * @operationName Mark Message as Read
   * @category Message Status
   * @appearanceColor #33a854 #ea4435
   * @requiredOauth2Scopes https://www.googleapis.com/auth/gmail.modify
   *
   * @paramDef {"type":"String","label":"Message ID","name":"messageId","required":true,"dictionary":"getMessagesDictionary","description":"The unique identifier of the message."}
   */
  async markMessageAsRead(messageId) {
    await this.removeLabelFromMessage(messageId, 'UNREAD')
  }

  /**
   * @description Marks a message as "Unread".
   *
   * @route POST /mark-message-as-unread
   * @operationName Mark Message as Unread
   * @category Message Status
   * @appearanceColor #33a854 #ea4435
   * @requiredOauth2Scopes https://www.googleapis.com/auth/gmail.modify
   *
   * @paramDef {"type":"String","label":"Message ID","name":"messageId","required":true,"dictionary":"getMessagesDictionary","description":"The unique identifier of the message."}
   */
  async markMessageAsUnread(messageId) {
    await this.addLabelToMessage(messageId, 'UNREAD')
  }

  /**
   * @registerAs SYSTEM
   *
   * @description Creates a new label in the user's Gmail account to organize emails.
   *
   * @route POST /create-label
   * @operationName Create Label
   * @appearanceColor #33a854 #ea4435
   * @requiredOauth2Scopes https://www.googleapis.com/auth/gmail.labels
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The name of the label."}
   * @paramDef {"type":"String","label":"Label List Visibility","name":"labelListVisibility","uiComponent":{"type":"DROPDOWN","options":{"values":["labelShow","labelShowIfUnread","labelHide"]}},"description":"Determines the visibility of the label in the user interface."}
   * @paramDef {"type":"String","label":"Message List Visibility","name":"messageListVisibility","uiComponent":{"type":"DROPDOWN","options":{"values":["show","hide"]}},"description":"Determines the visibility of the label for message lists."}
   * @paramDef {"type":"String","label":"Background Color","name":"backgroundColor","description":"The background color of the label in HEX format."}
   * @paramDef {"type":"String","label":"Text Color","name":"textColor","description":"The text color of the label in HEX format."}
   *
   * @sampleResult {"messageListVisibility":"show","name":"Example Name","id":"EXAMPLE_LABEL_ID","labelListVisibility":"labelShow"}
   * @returns {Promise<Object>}
   */
  async createLabel(name, labelListVisibility, messageListVisibility, backgroundColor, textColor) {
    const body = {}

    if (name) body.name = name
    if (labelListVisibility) body.labelListVisibility = labelListVisibility
    if (messageListVisibility) body.messageListVisibility = messageListVisibility

    if (backgroundColor && textColor) {
      body.color = {
        backgroundColor,
        textColor,
      }
    }

    return this.#apiRequest({
      logTag: 'createLabel',
      method: 'post',
      url: `${ API_BASE_URL }/users/me/labels`,
      body,
    })
  }

  /**
   * @description Removes labels from a message.
   *
   * @route POST /remove-label
   * @operationName Remove Label From Message
   * @category Label Management
   * @appearanceColor #33a854 #ea4435
   * @requiredOauth2Scopes https://www.googleapis.com/auth/gmail.modify
   *
   * @paramDef {"type":"String","label":"Message ID","name":"messageId","required":true,"dictionary":"getMessagesDictionary","description":"The unique identifier of the message to update."}
   * @paramDef {"type":"String","label":"Label(s)","name":"labels","required":true,"dictionary":"getMessageLabelsDictionary","dependsOn":["messageId"],"description":"An array of label IDs or Names or a single string of label ID or Name to remove from the message."}
   *
   * @sampleResult { "labelIds": ["EXAMPLE_INBOX"] }
   * @returns {Promise<Object>}
   */
  async removeLabelFromMessage(messageId, labels) {
    assert(messageId, 'Message ID')

    const removeLabelIds = await this.ensureExistedLabelIdsList(labels)

    const result = await this.#apiRequest({
      logTag: 'removeLabelFromMessage',
      method: 'post',
      url: `${ API_BASE_URL }/users/me/messages/${ messageId }/modify`,
      body: { removeLabelIds },
    })

    return {
      labelIds: result.labelIds,
    }
  }

  /**
   * @private
   * */
  async ensureExistedLabelIdsList(labels) {
    if (!labels) {
      return
    }

    if (typeof labels === 'string') {
      labels = [labels]
    }

    if (!Array.isArray(labels)) {
      throw new Error('The Label(s) argument must be a string or a list of strings')
    }

    const { existedLabelsMap } = await this.#resolveLabelIds(labels)

    return labels.map(token => existedLabelsMap[token]).filter(id => id)
  }

  /**
   * @description Deletes a list of messages from the user's mailbox.
   *
   * @route POST /delete-messages
   * @operationName Delete Messages
   * @category Message Management
   * @appearanceColor #33a854 #ea4435
   * @requiredOauth2Scopes https://mail.google.com/
   *
   * @paramDef {"type":"String","label":"Message ID(s)","name":"messageIds","required":true,"dictionary":"getMessagesDictionary","description":"Single message id or a list of message ids to delete. Maximum 15."}
   * @paramDef {"type":"Boolean","label":"Delete Permanently","name":"isPermanentlyDelete","uiComponent":{"type":"TOGGLE"},"description":"Specifies whether the message should be permanently deleted."}
   *
   * @returns {Promise<void>}
   */
  async deleteMessages(messageIds, isPermanentlyDelete) {
    if (typeof messageIds === 'string') {
      messageIds = [messageIds]
    }

    if (messageIds.length > 15) {
      throw new Error('The number of messages to delete must not exceed 15.')
    }

    let deleteMessages = 0

    await Promise.all(
      messageIds.map(messageId => {
        return this.#apiRequest({
          logTag: `deleteMessages[${ isPermanentlyDelete ? 'Permanently' : 'Put into the Trash' }]`,
          method: isPermanentlyDelete ? 'delete' : 'post',
          url: `${ API_BASE_URL }/users/me/messages/${ messageId }${ isPermanentlyDelete ? '' : '/trash' }`,
        }).then(() => deleteMessages++)
      })
    )

    return {
      successCount: deleteMessages,
      failsCount: messageIds.length - deleteMessages,
    }
  }

  /**
   * @description Retrieves a specified attachment from a message using its message ID and attachment ID.
   *
   * @route POST /messages/attachments
   * @operationName Get Attachment
   * @category Attachment Management
   * @appearanceColor #33a854 #ea4435
   * @requiredOauth2Scopes https://www.googleapis.com/auth/gmail.readonly
   *
   * @paramDef {"type":"String","label":"Message ID","name":"messageId","required":true,"dictionary":"getMessagesDictionary","description":"The unique identifier of the message containing the attachment."}
   * @paramDef {"type":"String","label":"Attachment ID","name":"attachmentId","required":true,"dictionary":"getAttachmentsDictionary","dependsOn":["messageId"],"description":"The unique identifier of the attachment to retrieve."}
   *
   * @returns {Promise<Object>}
   * @sampleResult { "size": 106005, "data": "base64string..." }
   */
  async getAttachment(messageId, attachmentId) {
    assert(messageId, 'Message ID')
    assert(attachmentId, 'Attachment ID')

    return this.#apiRequest({
      logTag: 'getAttachment',
      url: `${ API_BASE_URL }/users/me/messages/${ messageId }/attachments/${ attachmentId }`,
    })
  }

  /**
   * @description Saves a Gmail attachment to Flowrunner Files and returns the file URL.
   *
   * @route POST /save-attachment
   * @operationName Save Attachment
   * @category Attachment Management
   * @appearanceColor #33a854 #ea4435
   * @requiredOauth2Scopes https://www.googleapis.com/auth/gmail.readonly
   *
   * @paramDef {"type":"String","label":"Message ID","name":"messageId","required":true,"dictionary":"getMessagesDictionary","description":"The unique identifier of the message containing the attachment."}
   * @paramDef {"type":"String","label":"Attachment ID","name":"attachmentId","required":true,"dictionary":"getAttachmentsDictionary","dependsOn":["messageId"],"description":"The unique identifier of the attachment to save."}
   * @paramDef {"type":"String","label":"File Name","name":"fileName","required":true,"description":"The name to use for the saved file. Example: 'document.pdf'."}
   * @paramDef {"type":"FilesUploadOptions","name":"fileOptions","label":"File Settings","required":false,"include":["scope"]}
   *
   * @returns {Promise<Object>}
   * @sampleResult {"fileUrl":"https://files.example.com/attachments/document.pdf"}
   */
  async saveAttachment(messageId, attachmentId, fileName, fileOptions) {
    assert(messageId, 'Message ID')
    assert(attachmentId, 'Attachment ID')
    assert(fileName, 'File Name')

    try {
      const attachment = await this.getAttachment(messageId, attachmentId)

      const base64Data = attachment.data.replace(/-/g, '+').replace(/_/g, '/')
      const binaryData = Buffer.from(base64Data, 'base64')

      const { url: fileURL } = await this.flowrunner.Files.uploadFile(binaryData, {
        filename: fileName,
        generateUrl: true,
        overwrite: true,
        ...(fileOptions || { scope: 'FLOW' }),
      })

      return { fileUrl: fileURL }
    } catch (error) {
      logger.error(`error saving attachment - ${ error.message }`)
      throw error
    }
  }

  /**
   * @description Deletes a draft email from the user's Gmail account by its draft ID.
   *
   * @route POST /delete-draft
   * @operationName Delete Draft
   * @category Draft Management
   * @appearanceColor #33a854 #ea4435
   * @requiredOauth2Scopes https://www.googleapis.com/auth/gmail.modify
   *
   * @paramDef {"type":"String","label":"Draft ID","name":"draftId","required":true,"dictionary":"getDraftsDictionary","description":"The ID of the draft to be deleted."}
   *
   * @returns {Promise<void>}
   */
  async deleteDraft(draftId) {
    assert(draftId, 'Draft ID')

    return this.#apiRequest({
      logTag: 'deleteDraft',
      method: 'delete',
      url: `${ API_BASE_URL }/users/me/drafts/${ draftId }`,
    })
  }

  /**
   * @description Sends a draft email by its draft ID and returns the details of the sent message.
   *
   * @route POST /send-draft
   * @operationName Send Draft
   * @category Draft Management
   * @appearanceColor #33a854 #ea4435
   * @requiredOauth2Scopes https://www.googleapis.com/auth/gmail.send
   *
   * @paramDef {"type":"String","label":"Draft ID","name":"draftId","required":true,"dictionary":"getDraftsDictionary","description":"The draft ID to send."}
   *
   * @sampleResult {"messageThreadId": "example_id_7aa6afe", "messageLabelIds": ["EXAMPLE_UNREAD", "EXAMPLE_SENT"], "messageId": "example_id_179bf3"}
   * @returns {Promise<Object>}
   */
  async sendDraft(draftId) {
    const result = await this.#apiRequest({
      logTag: 'sendDraft',
      method: 'post',
      url: `${ API_BASE_URL }/users/me/drafts/send`,
      body: { id: draftId },
    })

    return {
      messageId: result.id,
      messageThreadId: result.threadId,
      messageLabelIds: result.labelIds,
    }
  }

  /**
   * @description Creates a new draft message in the user's Gmail account.
   *
   * @route POST /create-draft
   * @operationName Create Draft
   * @category Draft Management
   * @appearanceColor #33a854 #ea4435
   * @requiredOauth2Scopes https://www.googleapis.com/auth/gmail.compose
   *
   * @paramDef {"type":"String","label":"To","name":"to","required":true,"description":"The recipient's email address."}
   * @paramDef {"type":"String","label":"Subject","required":true,"name":"subject","description":"The subject of the email."}
   * @paramDef {"type":"String","label":"Body Type","name":"bodyType","uiComponent":{"type":"DROPDOWN","options":{"values":["html","plain"]}},"description":"Choose HTML to send content formatted as HTML otherwise plain text will be sent."}
   * @paramDef {"type":"String","label":"Body Content","name":"bodyContent","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Email body content."}
   * @paramDef {"type":"String","label":"From","name":"from","description":"The sender's email address (by default, your Gmail account)."}
   * @paramDef {"type":"Array","label":"CC","name":"cc","description":"Optional CC email addresses."}
   * @paramDef {"type":"Array","label":"BCC","name":"bcc","description":"Optional BCC email addresses."}
   * @paramDef {"type":"String","label":"Thread ID","name":"threadId","dictionary":"getThreadsDictionary","description":"Optional. The ID of the thread to which the message belongs."}
   * @paramDef {"type":"String","label":"Attachments URLs","name":"attachments","description":"Optional. Attachments can be a string URL or an array of string URLs. Total attachment size must not exceed 25MB."}
   *
   * @sampleResult { "messageThreadId": "example_id_97373e", "messageLabelIds": ["EXAMPLE_DRAFT"], "messageId": "example_id_97373e", "id": "example_id_82608" }
   * @returns {Promise<Object>}
   */
  async createDraft(to, subject, bodyType, bodyContent, from, cc, bcc, threadId, attachments) {
    const draft = { to, subject, bodyType, bodyContent, from, cc, bcc }

    if (!draft.from) {
      const currentAccount = await this.#getCurrentAccountInfo()
      draft.from = currentAccount.name
    }

    if (attachments) {
      const validAttachments = await getValidAttachments(attachments)

      if (validAttachments.length > 0) {
        draft.attachments = validAttachments
      }
    }

    const userData = await this.#getCurrentAccountInfo()

    draft.myEmail = userData.email

    const rawMessage = this.emailParser.createEmailMessage(draft)

    const message = {
      raw: rawMessage,
    }

    if (threadId) {
      message.threadId = threadId
    }

    const result = await this.#apiRequest({
      logTag: 'createDraft',
      method: 'post',
      url: `${ API_BASE_URL }/users/me/drafts`,
      body: { message },
    })

    return {
      id: result.id,
      messageId: result.message.id,
      messageThreadId: result.message.threadId,
      messageLabelIds: result.message.labelIds,
    }
  }

  /**
   * @description Retrieves up to 10 draft messages from the user's Gmail account based on specified parameters.
   *
   * @route POST /get-drafts-list
   * @operationName Get Drafts List
   * @category Draft Management
   * @appearanceColor #33a854 #ea4435
   * @requiredOauth2Scopes https://www.googleapis.com/auth/gmail.readonly
   *
   * @paramDef {"type":"String","label":"Query","name":"query","description":"A string query for filtering drafts."}
   * @paramDef {"type":"String","label":"Label(s)","name":"labels","dictionary":"getLabelsDictionary","description":"Single label Name or ID or a list of Label IDs or Names to query messages."}
   * @paramDef {"type":"Boolean","label":"Include From Spam and Trash","name":"includeSpamTrash","uiComponent":{"type":"TOGGLE"},"description":"Whether to include drafts from Spam and Trash folders."}
   *
   * @sampleResult [{ "id": "example_id_705872964", "messageThreadId": "example_id_9a39002", "messageMessageId": "example_id_9a39002" }]
   * @returns {Promise<Array.<Object>>}
   */
  async getDraftsList(query, labels, includeSpamTrash) {
    const labelIds = await this.ensureExistedLabelIdsList(labels)

    const parameters = createSearchParams({
      query,
      maxResults: DEFAULT_MESSAGES_LIST_COUNT,
      labelIds,
      includeSpamTrash,
    })

    const { drafts } = await this.#apiRequest({
      logTag: 'listDrafts',
      url: `${ API_BASE_URL }/users/me/drafts`,
      query: parameters,
    })

    return drafts.map(draft => ({
      id: draft.id,
      messageThreadId: draft.message.threadId,
      messageMessageId: draft.message.id,
    }))
  }

  /**
   * @operationName On New Email
   * @category Email Triggers
   * @description Triggers when new emails arrive. Polling interval can be customized (minimum 30 seconds).
   * @registerAs POLLING_TRIGGER
   *
   * @route POST /on-new-email
   * @appearanceColor #f9566d #fb874b
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Label(s)","name":"labels","dictionary":"getLabelsDictionary","description":"Single label Name or ID or a list of Label IDs or Names to match messages."}
   * @paramDef {"type":"String","label":"Query","name":"query","description":"A string query for filtering messages."}
   * @paramDef {"type":"Boolean","label":"Include From Spam and Trash","name":"includeSpamTrash","uiComponent":{"type":"TOGGLE"},"description":"Whether to include messages from Spam and Trash in the results."}
   *
   * @returns {Object}
   * @sampleResult {"threadId":"19645ae19919c860","snippet":"test content","date":1744925747000,"subject":"test subject","id":"19645ae19919c860"}
   */
  async onNewEmail(invocation) {
    if (invocation.learningMode) {
      const latestMessages = await this.getMessagesList(
        invocation.triggerData.query,
        false,
        1,
        invocation.triggerData.labels,
        invocation.triggerData.includeSpamTrash,
        true
      )

      const latestMessage = latestMessages[0]

      logger.debug(`onNewEmail learningMode message.id=${ latestMessage?.id }`)

      return {
        events: [latestMessage],
        state: null,
      }
    }

    if (!invocation.state?.initialized) {
      logger.debug('onNewEmail.init')

      const latestMessages = await this.getMessagesList(
        invocation.triggerData.query,
        false,
        1,
        invocation.triggerData.labels,
        invocation.triggerData.includeSpamTrash,
        false
      )

      const latestMessageId = latestMessages[0]?.id

      logger.debug(`onNewEmail loaded latestMessageId=${ latestMessageId }`)

      return {
        events: [],
        state: {
          initialized: true,
          latestMessageId,
        },
      }
    }

    const messages = await this.getMessagesList(
      invocation.triggerData.query,
      false,
      MAX_MESSAGES_LIST_COUNT,
      invocation.triggerData.labels,
      invocation.triggerData.includeSpamTrash,
      false
    )

    const latestMessageId = messages[0]?.id

    logger.debug(`onNewEmail loaded messages.length=${ messages.length }`)

    const newMessages = []

    for (const message of messages) {
      if (message.id !== invocation.state.latestMessageId) {
        newMessages.push(message)
      } else {
        break
      }
    }

    logger.debug(`onNewEmail.newMessage.length=${ newMessages.length }`)

    const newMessagesWithContent = await Promise.all(
      newMessages.map(message => {
        return this.getMessage(message.id)
      })
    )

    logger.debug(`onNewEmail.newMessagesWithContent.length=${ newMessagesWithContent.length }`)

    return {
      events: newMessagesWithContent,
      state: { ...invocation.state, latestMessageId },
    }
  }

  /**
   * @operationName On New Attachment
   * @category Email Triggers
   * @description Triggers when an email with a new attachment is received. Polling interval can be customized (minimum 30 seconds).
   * @registerAs POLLING_TRIGGER
   *
   * @route POST /on-new-attachment
   * @appearanceColor #f9566d #fb874b
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Label(s)","name":"labels","dictionary":"getLabelsDictionary","description":"Single label Name or ID or a list of Label IDs or Names to match messages."}
   * @paramDef {"type":"String","label":"Query","name":"query","description":"A string query for filtering messages."}
   * @paramDef {"type":"Boolean","label":"Include From Spam and Trash","name":"includeSpamTrash","uiComponent":{"type":"TOGGLE"},"description":"Whether to include messages from Spam and Trash in the results."}
   *
   * @returns {Object}
   * @sampleResult {"threadId":"19645ae19919c860","snippet":"test content","date":1744925747000,"subject":"test subject","id":"19645ae19919c860"}
   */
  async onNewAttachment(invocation) {
    if (invocation.learningMode) {
      const latestMessages = await this.getMessagesList(
        'has:attachment ' + (invocation.triggerData.query || ''),
        false,
        1,
        invocation.triggerData.labels,
        invocation.triggerData.includeSpamTrash,
        true
      )

      const latestMessage = latestMessages[0]

      logger.debug(`onNewAttachment learningMode message.id=${ latestMessage?.id }`)

      return {
        events: [latestMessage],
        state: null,
      }
    }

    if (!invocation.state?.initialized) {
      logger.debug('onNewAttachment.init')

      const latestMessages = await this.getMessagesList(
        'has:attachment ' + (invocation.triggerData.query || ''),
        false,
        1,
        invocation.triggerData.labels,
        invocation.triggerData.includeSpamTrash,
        true
      )

      const latestMessageId = latestMessages[0]?.id

      logger.debug(`onNewAttachment.latestMessageId=${ latestMessageId }`)

      return {
        events: [],
        state: {
          initialized: true,
          latestMessageId,
        },
      }
    }

    const messages = await this.getMessagesList(
      'has:attachment ' + (invocation.triggerData.query || ''),
      false,
      MAX_MESSAGES_LIST_COUNT,
      invocation.triggerData.labels,
      invocation.triggerData.includeSpamTrash,
      false
    )

    const latestMessageId = messages[0]?.id

    const newMessages = []

    for (const message of messages) {
      if (message.id !== invocation.state.latestMessageId) {
        newMessages.push(message)
      } else {
        break
      }
    }

    logger.debug(`onNewAttachment.newMessage.length=${ newMessages.length }`)

    const newMessagesWithContent = await Promise.all(
      newMessages.map(message => {
        return this.getMessage(message.id)
      })
    )

    logger.debug(`onNewAttachment.newMessagesWithContent.length=${ newMessagesWithContent.length }`)

    return {
      events: newMessagesWithContent,
      state: { latestMessageId },
    }
  }

  /**
   * @operationName On New Label
   * @category Email Triggers
   * @description Triggers when a new label is created in your Gmail account. Polling interval can be customized (minimum 30 seconds).
   * @registerAs POLLING_TRIGGER
   *
   * @route POST /on-new-label
   * @appearanceColor #f9566d #fb874b
   * @executionTimeoutInSeconds 120
   *
   * @returns {Object}
   * @sampleResult {"id":"CATEGORY_UPDATES","name":"CATEGORY_UPDATES","type":"system"}
   */
  async onNewLabel(invocation) {
    const labels = await this.#getLabels()

    logger.debug(`onNewLabel.labels.length=${ labels.length }`)

    if (invocation.learningMode) {
      const label = labels[0]

      logger.debug(`onNewLabel learningMode label.id=${ label?.id }`)

      return {
        events: [label],
        state: null,
      }
    }

    if (!invocation.state?.labels) {
      const labelsList = invocation.state.labels.map(({ id }) => id)

      return {
        events: [],
        state: { labelsList },
      }
    }

    const prevIDs = new Set(invocation.state.labelsList)
    const newLabels = labels.filter(({ id }) => !prevIDs.has(id))

    logger.debug(`onNewLabel.newLabels.length=${ newLabels.length }`)

    return {
      events: newLabels,
      state: { labels },
    }
  }

  /**
   * @operationName On Email Starred
   * @category Email Triggers
   * @description Triggers when an email is marked as starred. Polling interval can be customized (minimum 30 seconds).
   * @registerAs POLLING_TRIGGER
   *
   * @route POST /on-email-starred
   * @appearanceColor #f9566d #fb874b
   * @executionTimeoutInSeconds 120
   *
   * @returns {Object}
   * @sampleResult {"snippet":"test content","date":1744925747000,"subject":"test subject","id":"19645ae19919c860"}
   */
  async onEmailStarred(invocation) {
    if (invocation.learningMode) {
      const messages = await this.getMessagesList('is:starred', true, 1, null, true, true)
      const message = messages[0]

      logger.debug(`onEmailStarred learningMode message.id=${ message?.id }`)

      return {
        events: [message],
        state: null,
      }
    }

    const messages = await this.getMessagesList('is:starred', true, MAX_MESSAGES_LIST_COUNT, null, true, true)

    logger.debug(`onEmailStarred.messages.length=${ messages.length }`)

    if (!invocation.state?.messages) {
      return {
        events: [],
        state: { messagesIds: messages.map(({ id }) => id) },
      }
    }

    const prevIDs = new Set(invocation.state.messagesIds)
    const newMessages = messages.filter(({ id }) => !prevIDs.has(id))

    logger.debug(`onEmailStarred.newMessages.length=${ newMessages.length }`)

    return {
      events: newMessages,
      state: { messages },
    }
  }

  /**
   * @operationName On New Thread
   * @category Email Triggers
   * @description Triggers when a new conversation thread is started. Polling interval can be customized (minimum 30 seconds).
   * @registerAs POLLING_TRIGGER
   *
   * @route POST /on-new-thread
   * @appearanceColor #f9566d #fb874b
   * @executionTimeoutInSeconds 120
   *
   * @returns {Object}
   * @sampleResult {"id":"1964411a620bac2f","snippet":"thread test snippet","historyId":"980522"}
   */
  async onNewThread(invocation) {
    const { threads } = await this.#getThreads()

    logger.debug(`onNewThread.threads.length=${ threads.length }`)

    if (invocation.learningMode) {
      const thread = threads[0]

      logger.debug(`onNewThread learningMode thread.id=${ thread?.id }`)

      return {
        events: [thread],
        state: null,
      }
    }

    if (!invocation.state?.threads) {
      return {
        events: [],
        state: { threadsIds: threads.map(({ id }) => id) },
      }
    }

    const prevIDs = new Set(invocation.state.threadsIds)
    const newThreads = threads.filter(({ id }) => !prevIDs.has(id))

    return {
      events: newThreads,
      state: { threadsIds: threads.map(({ id }) => id) },
    }
  }

  /**
   * @private
   */
  async #resolveLabelIds(tokens) {
    const labels = await this.#getLabels()

    const labelsMap = {}

    labels.forEach(label => {
      labelsMap[label.name] = label.id
      labelsMap[label.id] = label.id
    })

    const existedLabelsMap = {}
    const missedLabelsMap = {}

    tokens.forEach(token => {
      if (labelsMap[token]) {
        existedLabelsMap[token] = labelsMap[token]
      } else {
        missedLabelsMap[token] = true
      }
    })

    return { existedLabelsMap, missedLabelsMap }
  }
}

function cleanupObject(obj) {
  if (!obj) return obj

  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined && v !== null)
  )
}

function truncateMessageSnippet(snippet, maxLength = 60) {
  if (!snippet) return snippet

  return snippet.length > maxLength ? snippet.substring(0, maxLength) + '...' : snippet
}

Flowrunner.ServerCode.addService(GmailService, [
  {
    order: 0,
    displayName: 'Client Id',
    defaultValue: '',
    name: 'clientId',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'Your OAuth 2.0 Client ID from the Google Cloud Console.',
  },
  {
    order: 1,
    displayName: 'Client Secret',
    defaultValue: '',
    name: 'clientSecret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'Your OAuth 2.0 Client Secret from the Google Cloud Console.',
  },
])