const OAUTH_BASE_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0'
const API_BASE_URL = 'https://graph.microsoft.com/v1.0/me'
const PAGE_SIZE_DICTIONARY = 10

const DEFAULT_SCOPE_LIST = [
  'User.Read',
  'Mail.Send',
  'Mail.ReadWrite',
  'MailboxItem.Read',
  'MailboxFolder.Read',
  'MailboxFolder.ReadWrite',
  'Calendars.ReadWrite',
  'Contacts.ReadWrite',
  'offline_access',
]

const DEFAULT_SCOPE_STRING = DEFAULT_SCOPE_LIST.join(' ')

const logger = {
  info: (...args) => console.log('[Outlook Service] info:', ...args),
  debug: (...args) => console.log('[Outlook Service] debug:', ...args),
  error: (...args) => console.log('[Outlook Service] error:', ...args),
  warn: (...args) => console.log('[Outlook Service] warn:', ...args),
}

/**
 * @requireOAuth
 * @integrationName Outlook
 * @integrationIcon /icon.png
 **/
class OutlookService {
  /**
   * @typedef {Object} getMessageDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter messages by subject or sender. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for retrieving the next page of results."}
   */

  /**
   * @typedef {Object} getMessageConversationIdDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter conversation threads by subject. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for retrieving the next page of results."}
   */

  /**
   * @typedef {Object} getDraftMessageIdDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter draft messages by subject. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for retrieving the next page of results."}
   */

  /**
   * @typedef {Object} getUnreadMessageDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter unread messages by subject or sender. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for retrieving the next page of results."}
   */

  /**
   * @typedef {Object} getEventIdDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter calendar events by subject. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for retrieving the next page of results."}
   */

  /**
   * @typedef {Object} getContactIdDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter contacts by display name. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for retrieving the next page of results."}
   */
  constructor(config) {
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
    this.scopes = DEFAULT_SCOPE_STRING
  }

  #getAccessTokenHeader(accessToken) {
    return {
      Authorization: `Bearer ${ this.request.headers['oauth-access-token'] || accessToken }`,
    }
  }

  async #apiRequest({ url, method, body, query, logTag }) {
    method = method || 'get'
    query = cleanupObject(query)

    try {
      logger.debug(`${ logTag } - api request: [${ method }::${ url }] q=[${ JSON.stringify(query) }]`)

      return await Flowrunner.Request[method](url).set(this.#getAccessTokenHeader()).query(query).send(body)
    } catch (error) {
      logger.error(`${ logTag } - error: ${ error.message }`)
      throw error
    }
  }

  /**
   * @registerAs SYSTEM
   * @route GET /getOAuth2ConnectionURL
   */
  async getOAuth2ConnectionURL() {
    const params = new URLSearchParams()
    params.append('client_id', this.clientId)
    params.append('response_type', 'code')
    params.append('scope', this.scopes)
    params.append('response_mode', 'query')

    return `${ OAUTH_BASE_URL }/authorize?${ params.toString() }`
  }

  /**
   * @typedef {Object} refreshToken_ResultObject
   * @property {String} token
   * @property {Number} expirationInSeconds
   * @property {String} refreshToken
   */

  /**
   * @registerAs SYSTEM
   * @route PUT /refreshToken
   * @param {String} refreshToken
   * @returns {refreshToken_ResultObject}
   */
  async refreshToken(refreshToken) {
    const url = `${ OAUTH_BASE_URL }/token`

    const params = new URLSearchParams()
    params.append('client_id', this.clientId)
    params.append('scope', this.scopes)
    params.append('refresh_token', refreshToken)
    params.append('grant_type', 'refresh_token')
    params.append('client_secret', this.clientSecret)

    try {
      const response = await Flowrunner.Request.post(url)
        .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        .send(params.toString())

      return {
        token: response.access_token,
        refreshToken: response.refresh_token,
        expirationInSeconds: response.expires_in,
      }
    } catch (error) {
      logger.error('Error refreshing token: ', error.message || error)
      throw error
    }
  }

  /**
   * @typedef {Object} executeCallback_ResultObject
   * @property {String} token
   * @property {String} refreshToken
   * @property {Number} expirationInSeconds
   * @property {Object} userData
   * @property {String} connectionIdentityName
   * @property {Boolean} overwrite
   */

  /**
   * @registerAs SYSTEM
   * @route POST /executeCallback
   * @param {Object} callbackObject
   * @returns {executeCallback_ResultObject}
   */
  async executeCallback(callbackObject) {
    const code = callbackObject.code
    const url = `${ OAUTH_BASE_URL }/token`

    const params = new URLSearchParams()
    params.append('client_id', this.clientId)
    params.append('code', code)
    params.append('redirect_uri', callbackObject.redirectURI)
    params.append('grant_type', 'authorization_code')
    params.append('client_secret', this.clientSecret)

    const response = await Flowrunner.Request.post(url)
      .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
      .send(params.toString())

    let userData = {}

    try {
      userData = await Flowrunner.Request.get(API_BASE_URL).set({
        Authorization: `Bearer ${ response.access_token }`,
        'Content-Type': 'application/json',
      })

      logger.debug(`[executeCallback] userData response: ${ JSON.stringify(userData, null, 2) }`)
    } catch (error) {
      logger.error(`[executeCallback] getUserProfile error: ${ error.message }`)
    }

    return {
      token: response.access_token,
      refreshToken: response.refresh_token,
      expirationInSeconds: response.expires_in,
      connectionIdentityName: constructIdentityName(userData),
      overwrite: true,
      userData: userData,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Message Dictionary
   * @description Provides a searchable list of email messages for dynamic parameter selection.
   * @route POST /get-message-dictionary
   * @paramDef {"type":"getMessageDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering messages."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Meeting Reminder","value":"AAMkAGVmMDEzMTM4","note":"ID: AAMkAGVmMDEzMTM4"}],"cursor":null}
   */
  async getMessageDictionary(payload) {
    const { search, cursor } = payload || {}
    const url = cursor ? cursor : `${ API_BASE_URL }/messages`

    const query = {
      $top: PAGE_SIZE_DICTIONARY,
      $select: 'subject',
    }

    const response = await this.#apiRequest({
      url,
      logTag: 'getMessageDictionary',
      query,
    })

    const messages = response.value
    const filteredMessages = search ? searchFilter(messages, ['subject'], search) : messages

    return {
      cursor: response['@odata.nextLink'] || null,
      items: filteredMessages.map(({ id, subject }) => ({
        label: subject,
        note: `ID: ${ id }`,
        value: id,
      })),
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Message Conversation ID Dictionary
   * @description Provides a searchable list of email conversation threads for dynamic parameter selection.
   * @route POST /get-message-conversation-id-dictionary
   * @paramDef {"type":"getMessageConversationIdDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering conversation threads."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Project Discussion","value":"AAQkADAwATNiZmY","note":"ID: AAQkADAwATNiZmY"}],"cursor":null}
   */
  async getMessageConversationIdDictionary(payload) {
    const { search, cursor } = payload || {}
    const url = cursor ? cursor : `${ API_BASE_URL }/messages`

    const query = {
      $top: PAGE_SIZE_DICTIONARY,
      $select: 'subject,conversationId',
    }

    const response = await this.#apiRequest({
      url,
      logTag: 'getMessageConversationIdDictionary',
      query,
    })

    const messages = response.value
    const filteredMessages = search ? searchFilter(messages, ['subject'], search) : messages

    return {
      cursor: response['@odata.nextLink'] || null,
      items: filteredMessages.map(({ conversationId, subject }) => ({
        label: subject,
        note: `ID: ${ conversationId }`,
        value: conversationId,
      })),
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Draft Message ID Dictionary
   * @description Provides a searchable list of draft emails for dynamic parameter selection.
   * @route POST /get-draft-message-id-dictionary
   * @paramDef {"type":"getDraftMessageIdDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering draft messages."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Draft Email","value":"AAMkAGVmMDEzMTM4","note":"ID: AAMkAGVmMDEzMTM4"}],"cursor":null}
   */
  async getDraftMessageIdDictionary(payload) {
    const { search, cursor } = payload || {}
    const url = cursor ? cursor : `${ API_BASE_URL }/messages`

    const query = {
      $top: PAGE_SIZE_DICTIONARY,
      $select: 'subject',
      filter: 'isDraft eq true',
    }

    const response = await this.#apiRequest({
      url,
      logTag: 'getDraftMessageIdDictionary',
      query,
    })

    const messages = response.value
    const filteredMessages = search ? searchFilter(messages, ['subject'], search) : messages

    return {
      cursor: response['@odata.nextLink'] || null,
      items: filteredMessages.map(({ id, subject }) => ({
        label: subject,
        note: `ID: ${ id }`,
        value: id,
      })),
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Unread Message Dictionary
   * @description Provides a searchable list of unread email messages for dynamic parameter selection.
   * @route POST /get-unread-message-dictionary
   * @paramDef {"type":"getUnreadMessageDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering unread messages."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Important Update","value":"AAMkAGVmMDEzMTM4","note":"ID: AAMkAGVmMDEzMTM4"}],"cursor":null}
   */
  async getUnreadMessageDictionary(payload) {
    const { search, cursor } = payload || {}
    const url = cursor ? cursor : `${ API_BASE_URL }/messages`

    const query = {
      $top: PAGE_SIZE_DICTIONARY,
      $select: 'subject',
      filter: 'isRead eq false',
    }

    const response = await this.#apiRequest({
      url,
      logTag: 'getUnreadMessageDictionary',
      query,
    })

    const messages = response.value
    const filteredMessages = search ? searchFilter(messages, ['subject'], search) : messages

    return {
      cursor: response['@odata.nextLink'] || null,
      items: filteredMessages.map(({ id, subject }) => ({
        label: subject,
        note: `ID: ${ id }`,
        value: id,
      })),
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Event ID Dictionary
   * @description Provides a searchable list of calendar events for dynamic parameter selection.
   * @route POST /get-event-id-dictionary
   * @paramDef {"type":"getEventIdDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering calendar events."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Team Meeting","value":"AAMkAGVmMDEzMTM4","note":"ID: AAMkAGVmMDEzMTM4"}],"cursor":null}
   */
  async getEventIdDictionary(payload) {
    const { search, cursor } = payload || {}
    const url = cursor ? cursor : `${ API_BASE_URL }/calendar/events`

    const query = {
      $top: PAGE_SIZE_DICTIONARY,
      $select: 'subject',
    }

    const response = await this.#apiRequest({
      logTag: 'getEventIdDictionary',
      query,
      url,
    })

    const messages = response.value
    const filteredMessages = search ? searchFilter(messages, ['subject'], search) : messages

    return {
      cursor: response['@odata.nextLink'] || null,
      items: filteredMessages.map(({ id, subject }) => ({
        label: subject,
        note: `ID: ${ id }`,
        value: id,
      })),
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Contact ID Dictionary
   * @description Provides a searchable list of contacts for dynamic parameter selection.
   * @route POST /get-contact-id-dictionary
   * @paramDef {"type":"getContactIdDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering contacts."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"John Smith","value":"AAMkAGVmMDEzMTM4","note":"Name: John Smith"}],"cursor":null}
   */
  async getContactIdDictionary(payload) {
    const { search, cursor } = payload || {}
    const url = cursor ? cursor : `${ API_BASE_URL }/contacts`

    const query = {
      $top: PAGE_SIZE_DICTIONARY,
      $select: 'givenName,surname',
    }

    const response = await this.#apiRequest({
      logTag: 'getContactIdDictionary',
      query,
      url,
    })

    const contacts = response.value
    const filteredContacts = search ? searchFilter(contacts, ['givenName', 'surname'], search) : contacts

    return {
      cursor: response['@odata.nextLink'] || null,
      items: filteredContacts.map(({ id, givenName, surname }) => ({
        label: `${ givenName } ${ surname }`,
        note: `Name: ${ givenName } ${ surname }`,
        value: id,
      })),
    }
  }

  /**
   * @operationName Get User Profile
   * @category User Information
   * @appearanceColor #0078D4 #40BFFF
   * @description Retrieves the profile details of the signed-in user including display name, email, and other basic information.
   * @route GET /me
   * @returns {Object}
   * @sampleResult {"id":"87d349ed-44d7-43e1-9a83-5f2406dee5bd","displayName":"John Smith","mail":"john.smith@company.com","userPrincipalName":"john.smith@company.com","mobilePhone":null,"officeLocation":"Building 1"}
   */
  getUserProfile() {
    return this.#apiRequest({
      logTag: 'getUserProfile',
      url: API_BASE_URL,
    })
  }

  /**
   * @operationName Get Messages List
   * @category Email Management
   * @appearanceColor #0078D4 #40BFFF
   * @description Retrieves a list of email messages from the user's mailbox with optional filtering by sender, subject, date range, and read status.
   * @route POST /get-messages-list
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","description":"The maximum number of emails to retrieve. Defaults to 10. Maximum allowed is 30."}
   * @paramDef {"type":"String","label":"From","name":"from","description":"Filter emails by sender's email address."}
   * @paramDef {"type":"String","label":"Subject","name":"subject","description":"Filter emails by subject. Performs a search based on the provided text."}
   * @paramDef {"type":"String","label":"Since Date","name":"since","description":"Filter emails received after this date (ex. 2024-12-11T16:13:35Z)."}
   * @paramDef {"type":"String","label":"Before Date","name":"before","description":"Filter emails received before this date (ex. 2024-12-11T16:13:35Z)."}
   * @paramDef {"type":"Boolean","label":"Load Unread","name":"loadUnread","uiComponent":{"type":"TOGGLE"},"description":"Filter emails by read/unread status. Set to false for read emails, true for unread emails."}
   * @paramDef {"type":"String","label":"Next Page Link","name":"nextLink","description":"URL to retrieve the next page of results. If provided, all other parameters are ignored."}
   * @returns {Object}
   * @sampleResult {"@odata.context":"https://graph.microsoft.com/v1.0/$metadata#users/messages","value":[{"id":"AAMkAGVmMDEzMTM4","subject":"Team Meeting","from":{"emailAddress":{"name":"Jane Doe","address":"jane.doe@company.com"}},"receivedDateTime":"2024-12-11T16:13:35Z","isRead":true}],"@odata.nextLink":"https://graph.microsoft.com/v1.0/me/messages?$skip=10"}
   */
  async getMessagesList(maxResults, from, subject, since, before, loadUnread, nextLink) {
    let url

    if (nextLink) {
      url = nextLink
    } else {
      const baseUrl = `${ API_BASE_URL }/messages`
      const filters = []

      if (from) {
        filters.push(`from/emailAddress/address eq '${ from }'`)
      }

      if (typeof loadUnread === 'boolean') {
        filters.push(`isRead eq ${ !loadUnread }`)
      }

      if (since) {
        filters.push(`receivedDateTime ge ${ new Date(since).toISOString() }`)
      }

      if (before) {
        filters.push(`receivedDateTime le ${ new Date(before).toISOString() }`)
      }

      const queryParams = []

      if (filters.length > 0) {
        queryParams.push(`$filter=${ filters.join(' and ') }`)
      }

      if (subject) {
        queryParams.push(`$search="subject:${ subject }"`)
      }

      queryParams.push(`$top=${ Math.min(maxResults || 10, 30) }`)
      url = `${ baseUrl }?${ queryParams.join('&') }`
    }

    const response = await this.#apiRequest({
      logTag: 'getMessagesList',
      url,
    })

    return {
      ...response,
      value:
        response.value?.map(email => ({
          ...email,
          toRecipients: email.toRecipients.map(recipients => recipients.emailAddress),
        })) || [],
    }
  }

  /**
   * @operationName Send Message
   * @category Email Management
   * @appearanceColor #0078D4 #40BFFF
   * @description Sends an email to the specified recipient with the provided content and optional parameters like subject, CC, and BCC.
   * @route POST /send-message
   * @paramDef {"type":"String","label":"To","name":"to","required":true,"description":"The recipient's email address."}
   * @paramDef {"type":"String","label":"From","name":"from","description":"Leave this field empty to send from your own address. Use this field to send from a shared inbox you have access to."}
   * @paramDef {"type":"String","label":"Subject","name":"subject","required":true,"description":"The subject of the email."}
   * @paramDef {"type":"String","label":"Body Format","name":"bodyType","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["HTML","Text"]}},"description":"The type of body content."}
   * @paramDef {"type":"String","label":"Body","name":"body","required":true,"description":"The body content of the email."}
   * @paramDef {"type":"Array","label":"CC","name":"cc","description":"The email addresses to send a carbon copy (CC) to."}
   * @paramDef {"type":"Array","label":"BCC","name":"bcc","description":"The email addresses to send a blind carbon copy (BCC) to."}
   * @returns {Object}
   * @sampleResult {"@odata.context":"https://graph.microsoft.com/v1.0/$metadata#microsoft.graph.message","id":"AAMkAGVmMDEzMTM4","subject":"Test Email","from":{"emailAddress":{"name":"John Smith","address":"john.smith@company.com"}}}
   */
  async sendMessage(to, from, subject, bodyType, body, cc, bcc) {
    const url = `${ API_BASE_URL }/sendMail`

    const message = {
      message: {
        subject: subject,
        body: {
          contentType: bodyType,
          content: body,
        },
        toRecipients: [{ emailAddress: { address: to } }],
      },
    }

    if (cc) {
      message.message.ccRecipients = [{ emailAddress: { address: cc } }]
    }

    if (bcc) {
      message.message.bccRecipients = [{ emailAddress: { address: bcc } }]
    }

    if (from) {
      message.message.sender = { emailAddress: { address: from } }
    }

    return this.#apiRequest({
      logTag: 'sendMessage',
      body: message,
      method: 'post',
      url,
    })
  }

  /**
   * @operationName Reply to Message
   * @category Email Management
   * @appearanceColor #0078D4 #40BFFF
   * @description Sends a reply to an existing email with the specified content and optional parameters.
   * @route POST /reply-to-message
   * @paramDef {"type":"String","label":"Reply To","name":"messageId","required":true,"dictionary":"getMessageDictionary","description":"The ID of the message to reply to."}
   * @paramDef {"type":"String","label":"Body Format","name":"bodyType","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["HTML","Text"]}},"description":"The type of body content."}
   * @paramDef {"type":"String","label":"Body","name":"body","required":true,"description":"The body content of the reply email."}
   * @returns {Object}
   * @sampleResult {"@odata.context":"https://graph.microsoft.com/v1.0/$metadata#microsoft.graph.message","id":"AAMkAGVmMDEzMTM4","subject":"Re: Original Subject","from":{"emailAddress":{"name":"John Smith","address":"john.smith@company.com"}}}
   */
  async replyToMessage(messageId, bodyType, body) {
    if (!messageId) {
      throw new Error('Message ID is required parameter')
    }

    const url = `${ API_BASE_URL }/messages/${ messageId }/reply`

    const message = {
      message: {
        body: {
          contentType: bodyType,
          content: body,
        },
      },
    }

    return this.#apiRequest({
      url,
      logTag: 'replyToMessage',
      body: message,
      method: 'post',
    })
  }

  /**
   * @operationName Create Draft Email
   * @category Email Management
   * @appearanceColor #0078D4 #40BFFF
   * @description Creates a draft email with the specified content and optional parameters that can be sent later.
   * @route POST /create-draft-email
   * @paramDef {"type":"String","label":"To","name":"to","description":"The recipient's email address. If provided 'Reply To', parameter 'To' will be ignored"}
   * @paramDef {"type":"String","label":"From","name":"from","description":"Leave this field empty to send from your own address. Use this field to send from a shared inbox you have access to."}
   * @paramDef {"type":"String","label":"Subject","name":"subject","required":true,"description":"The subject of the email."}
   * @paramDef {"type":"String","label":"Body Format","name":"bodyType","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["HTML","Text"]}},"description":"The type of body content."}
   * @paramDef {"type":"String","label":"Body","name":"body","required":true,"description":"The body content of the email."}
   * @paramDef {"type":"Array","label":"CC","name":"cc","description":"The email addresses to send a carbon copy (CC) to."}
   * @paramDef {"type":"Array","label":"BCC","name":"bcc","description":"The email addresses to send a blind carbon copy (BCC) to."}
   * @paramDef {"type":"String","label":"Reply To","name":"conversationId","dictionary":"getMessageConversationIdDictionary","description":"The ID of the message to reply to."}
   * @returns {Object}
   * @sampleResult {"id":"AAMkAGVmMDEzMTM4","subject":"Draft Email Subject","isDraft":true,"from":{"emailAddress":{"name":"John Smith","address":"john.smith@company.com"}},"createdDateTime":"2024-12-11T16:13:35Z"}
   */
  async createDraftEmail(to, from, subject, bodyType, body, cc, bcc, conversationId) {
    const url = `${ API_BASE_URL }/messages`

    const message = {
      subject: subject,
      body: {
        contentType: bodyType,
        content: body,
      },
    }

    if (conversationId) {
      message.conversationId = conversationId
    } else if (to) {
      message.toRecipients = [{ emailAddress: { address: to } }]
    }

    if (cc) {
      message.ccRecipients = cc.map(email => ({ emailAddress: { address: email } }))
    }

    if (bcc) {
      message.bccRecipients = bcc.map(email => ({ emailAddress: { address: email } }))
    }

    if (from) {
      message.from = { emailAddress: { address: from } }
    }

    return this.#apiRequest({
      url,
      logTag: 'createDraftEmail',
      body: message,
      method: 'post',
    })
  }

  /**
   * @operationName Send Draft Email
   * @category Email Management
   * @appearanceColor #0078D4 #40BFFF
   * @description Sends an email from an existing draft specified by the draft ID.
   * @route POST /send-draft-email
   * @paramDef {"type":"String","label":"Draft ID","name":"draftId","required":true,"dictionary":"getDraftMessageIdDictionary","description":"The ID of the draft email to send."}
   * @returns {Object}
   * @sampleResult {"@odata.context":"https://graph.microsoft.com/v1.0/$metadata#microsoft.graph.message","id":"AAMkAGVmMDEzMTM4","subject":"Draft Email Subject","from":{"emailAddress":{"name":"John Smith","address":"john.smith@company.com"}}}
   */
  async sendDraftEmail(draftId) {
    if (!draftId) {
      throw new Error('The \'draftId\' parameter is required.')
    }

    const url = `${ API_BASE_URL }/messages/${ draftId }/send`

    return this.#apiRequest({
      url,
      logTag: 'sendDraftEmail',
      method: 'post',
    })
  }

  /**
   * @operationName Create Event
   * @category Calendar Management
   * @appearanceColor #0078D4 #40BFFF
   * @description Creates a calendar event with the specified details such as subject, start and end time, time zone, location, description, and attendees.
   * @route POST /create-event
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Subject","name":"subject","required":true,"description":"The subject of the event."}
   * @paramDef {"type":"String","label":"Start Time","name":"start","required":true,"description":"The start time of the event in ISO 8601 format (e.g., '2024-12-15T10:00:00')."}
   * @paramDef {"type":"String","label":"End Time","name":"end","required":true,"description":"The end time of the event in ISO 8601 format (e.g., '2024-12-15T11:00:00')."}
   * @paramDef {"type":"String","label":"Time Zone","name":"timeZone","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Etc/GMT+12","Etc/GMT+11","Pacific/Honolulu","America/Anchorage","America/Santa_Isabel","America/Los_Angeles","America/Phoenix","America/Chihuahua","America/Denver","America/Guatemala","America/Chicago","America/Mexico_City","America/Regina","America/Bogota","America/New_York","America/Indiana/Indianapolis","America/Caracas","America/Asuncion","America/Halifax","America/Cuiaba","America/La_Paz","America/Santiago","America/St_Johns","America/Sao_Paulo","America/Argentina/Buenos_Aires","America/Cayenne","America/Godthab","America/Montevideo","America/Bahia","Etc/GMT+2","Atlantic/Azores","Atlantic/Cape_Verde","Africa/Casablanca","Etc/GMT","Europe/London","Atlantic/Reykjavik","Europe/Berlin","Europe/Budapest","Europe/Paris","Europe/Warsaw","Africa/Lagos","Africa/Windhoek","Europe/Bucharest","Asia/Beirut","Africa/Cairo","Asia/Damascus","Africa/Johannesburg","Europe/Kyiv","Europe/Istanbul","Asia/Jerusalem","Asia/Amman","Asia/Baghdad","Europe/Kaliningrad","Asia/Riyadh","Africa/Nairobi","Asia/Tehran","Asia/Dubai","Asia/Baku","Europe/Moscow","Indian/Mauritius","Asia/Tbilisi","Asia/Yerevan","Asia/Kabul","Asia/Karachi","Asia/Toshkent","Asia/Kolkata","Asia/Colombo","Asia/Kathmandu","Asia/Astana","Asia/Dhaka","Asia/Yekaterinburg","Asia/Yangon","Asia/Bangkok","Asia/Novosibirsk","Asia/Shanghai","Asia/Krasnoyarsk","Asia/Singapore","Australia/Perth","Asia/Taipei","Asia/Ulaanbaatar","Asia/Irkutsk","Asia/Tokyo","Asia/Seoul","Australia/Adelaide","Australia/Darwin","Australia/Brisbane","Australia/Sydney","Pacific/Port_Moresby","Australia/Hobart","Asia/Yakutsk","Pacific/Guadalcanal","Asia/Vladivostok","Pacific/Auckland","Etc/GMT-12","Pacific/Fiji","Asia/Magadan","Pacific/Tongatapu","Pacific/Apia","Pacific/Kiritimati"]}},"description":"The time zone for the event."}
   * @paramDef {"type":"String","label":"Location","name":"location","description":"The location of the event."}
   * @paramDef {"type":"String","label":"Description","name":"description","description":"A detailed description of the event."}
   * @paramDef {"type":"Array","label":"Attendees","name":"attendees","description":"A list of email addresses of the attendees."}
   * @returns {Object}
   * @sampleResult {"id":"AAMkAGVmMDEzMTM4","subject":"Team Meeting","start":{"dateTime":"2024-12-15T10:00:00","timeZone":"America/New_York"},"end":{"dateTime":"2024-12-15T11:00:00","timeZone":"America/New_York"},"location":{"displayName":"Conference Room A"},"attendees":[{"emailAddress":{"address":"jane.doe@company.com"},"type":"required"}]}
   */
  async createEvent(subject, start, end, timeZone, location, description, attendees) {
    const url = `${ API_BASE_URL }/events`

    const event = {
      subject: subject,
      start: {
        dateTime: start,
        timeZone: timeZone,
      },
      end: {
        dateTime: end,
        timeZone: timeZone,
      },
      body: {
        contentType: 'HTML',
        content: description,
      },
    }

    if (location) {
      event.location = { displayName: location }
    }

    if (Array.isArray(attendees)) {
      event.attendees = attendees.map(email => ({
        emailAddress: { address: email },
        type: 'required',
      }))
    }

    return this.#apiRequest({
      url,
      logTag: 'createEvent',
      method: 'post',
      body: event,
    })
  }

  /**
   * @operationName Delete Event
   * @category Calendar Management
   * @appearanceColor #0078D4 #40BFFF
   * @description Deletes a calendar event specified by the unique event ID.
   * @route DELETE /delete-event
   * @paramDef {"type":"String","label":"Event ID","name":"eventId","required":true,"dictionary":"getEventIdDictionary","description":"The unique ID of the event to delete."}
   * @returns {Object}
   * @sampleResult {"message":"Event deleted successfully"}
   */
  async deleteEvent(eventId) {
    if (!eventId) {
      throw new Error('Parameter "Event ID" is required')
    }

    const url = `${ API_BASE_URL }/events/${ eventId }`

    return this.#apiRequest({
      url,
      logTag: 'deleteEvent',
      method: 'delete',
    })
  }

  /**
   * @operationName Update Calendar Event
   * @category Calendar Management
   * @appearanceColor #0078D4 #40BFFF
   * @description Updates an existing calendar event with the provided details including subject, body, time, and attendees.
   * @route POST /update-calendar-event
   * @paramDef {"type":"String","label":"Event ID","name":"eventId","required":true,"dictionary":"getEventIdDictionary","description":"The unique identifier of the event to update."}
   * @paramDef {"type":"String","label":"Subject","name":"subject","description":"The subject of the event."}
   * @paramDef {"type":"String","label":"Body","name":"body","description":"The body content of the event. Supports HTML format."}
   * @paramDef {"type":"String","label":"Start Time","name":"start","description":"The start time of the event in ISO 8601 format (e.g., '2024-12-15T10:00:00').Required 'Time Zone'"}
   * @paramDef {"type":"String","label":"End Time","name":"end","description":"The end time of the event in ISO 8601 format (e.g., '2024-12-15T11:00:00').Required 'Time Zone'"}
   * @paramDef {"type":"String","label":"Time Zone","name":"timeZone","uiComponent":{"type":"DROPDOWN","options":{"values":["Etc/GMT+12","Etc/GMT+11","Pacific/Honolulu","America/Anchorage","America/Santa_Isabel","America/Los_Angeles","America/Phoenix","America/Chihuahua","America/Denver","America/Guatemala","America/Chicago","America/Mexico_City","America/Regina","America/Bogota","America/New_York","America/Indiana/Indianapolis","America/Caracas","America/Asuncion","America/Halifax","America/Cuiaba","America/La_Paz","America/Santiago","America/St_Johns","America/Sao_Paulo","America/Argentina/Buenos_Aires","America/Cayenne","America/Godthab","America/Montevideo","America/Bahia","Etc/GMT+2","Atlantic/Azores","Atlantic/Cape_Verde","Africa/Casablanca","Etc/GMT","Europe/London","Atlantic/Reykjavik","Europe/Berlin","Europe/Budapest","Europe/Paris","Europe/Warsaw","Africa/Lagos","Africa/Windhoek","Europe/Bucharest","Asia/Beirut","Africa/Cairo","Asia/Damascus","Africa/Johannesburg","Europe/Kyiv","Europe/Istanbul","Asia/Jerusalem","Asia/Amman","Asia/Baghdad","Europe/Kaliningrad","Asia/Riyadh","Africa/Nairobi","Asia/Tehran","Asia/Dubai","Asia/Baku","Europe/Moscow","Indian/Mauritius","Asia/Tbilisi","Asia/Yerevan","Asia/Kabul","Asia/Karachi","Asia/Toshkent (Tashkent)","Asia/Kolkata","Asia/Colombo","Asia/Kathmandu","Asia/Astana (Almaty)","Asia/Dhaka","Asia/Yekaterinburg","Asia/Yangon (Rangoon)","Asia/Bangkok","Asia/Novosibirsk","Asia/Shanghai","Asia/Krasnoyarsk","Asia/Singapore","Australia/Perth","Asia/Taipei","Asia/Ulaanbaatar","Asia/Irkutsk","Asia/Tokyo","Asia/Seoul","Australia/Adelaide","Australia/Darwin","Australia/Brisbane","Australia/Sydney","Pacific/Port_Moresby","Australia/Hobart","Asia/Yakutsk","Pacific/Guadalcanal","Asia/Vladivostok","Pacific/Auckland","Etc/GMT-12","Pacific/Fiji","Asia/Magadan","Pacific/Tongatapu","Pacific/Apia","Pacific/Kiritimati"]}},"description":"The time zone for the event."}
   * @paramDef {"type":"Array","label":"Attendees","name":"attendees","description":"A list of email addresses of the attendees. Providing this will overwrite all current attendees"}
   * @returns {Object}
   * @sampleResult {"id":"AAMkAGVmMDEzMTM4","subject":"Updated Meeting Subject","start":{"dateTime":"2024-12-15T10:00:00","timeZone":"America/New_York"},"end":{"dateTime":"2024-12-15T11:00:00","timeZone":"America/New_York"},"attendees":[{"emailAddress":{"address":"jane.doe@company.com"},"type":"required"}]}
   */
  async updateCalendarEvent(eventId, subject, body, startDateTime, endDateTime, timeZone, attendees) {
    if (!eventId) {
      throw new Error('Parameter "Event ID" is required')
    }

    const url = `${ API_BASE_URL }/events/${ eventId }`
    const payload = {}

    if (subject) {
      payload.subject = subject
    }

    if (body) {
      payload.body = {
        contentType: 'HTML',
        content: body,
      }
    }

    if (startDateTime && timeZone) {
      payload.start = {
        dateTime: startDateTime,
        timeZone,
      }
    }

    if (endDateTime && timeZone) {
      payload.end = {
        dateTime: endDateTime,
        timeZone,
      }
    }

    if (Array.isArray(attendees)) {
      payload.attendees = attendees.map(email => ({
        emailAddress: { address: email },
        type: 'required',
      }))
    }

    return this.#apiRequest({
      url,
      logTag: 'updateCalendarEvent',
      method: 'patch',
      body: payload,
    })
  }

  /**
   * @operationName Add Attendees to Calendar Event
   * @category Calendar Management
   * @appearanceColor #0078D4 #40BFFF
   * @description Adds attendees to an existing calendar event without overwriting existing attendees.
   * @route POST /add-attendees-to-calendar-event
   * @paramDef {"type":"String","label":"Event ID","name":"eventId","required":true,"dictionary":"getEventIdDictionary","description":"The unique identifier of the event to update."}
   * @paramDef {"type":"Array","label":"Attendees","name":"attendees","required":true,"description":"A list of email addresses or single string of the attendees to be added to the event."}
   * @returns {Object}
   * @sampleResult {"id":"AAMkAGVmMDEzMTM4","attendees":[{"emailAddress":{"address":"john.smith@company.com"},"type":"required"},{"emailAddress":{"address":"jane.doe@company.com"},"type":"required"}],"subject":"Team Meeting"}
   */
  async addAttendeesToCalendarEvent(eventId, attendees) {
    if (!eventId) {
      throw new Error('Parameter "Event ID" is required')
    }

    if (!attendees || (Array.isArray(attendees) && attendees.length === 0)) {
      throw new Error('Parameter "Attendees" is required and cannot be empty')
    }

    if (typeof attendees === 'string') {
      attendees = [attendees]
    }

    const eventUrl = `${ API_BASE_URL }/events/${ eventId }`

    const eventResponse = await this.#apiRequest({
      url: eventUrl,
      logTag: 'addAttendeesToCalendarEvent',
    })

    const currentAttendees = eventResponse.attendees || []

    const newAttendees = attendees.map(email => ({
      emailAddress: { address: email },
      type: 'required',
    }))

    const updatedAttendees = [
      ...currentAttendees,
      ...newAttendees.filter(
        newAttendee =>
          !currentAttendees.some(
            currentAttendee => currentAttendee.emailAddress.address === newAttendee.emailAddress.address
          )
      ),
    ]

    return this.#apiRequest({
      url: eventUrl,
      logTag: 'addAttendeesToCalendarEvent',
      method: 'patch',
      body: { attendees: updatedAttendees },
    })
  }

  /**
   * @operationName Create Contact
   * @category Contact Management
   * @appearanceColor #0078D4 #40BFFF
   * @description Creates a new contact in the user's contact list with basic information including name, email, phone, and company details.
   * @route POST /create-contact
   * @paramDef {"type":"String","label":"First Name","name":"firstName","required":true,"description":"The first name of the contact."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","description":"The last name of the contact."}
   * @paramDef {"type":"String","label":"Middle Name","name":"middleName","description":"The middle name of the contact."}
   * @paramDef {"type":"Array","label":"Email(s)","name":"emails","description":"The email address of the contact.(Max 3)"}
   * @paramDef {"type":"String","label":"Mobile Phone Number","name":"phoneNumber","description":"The mobile phone number of the contact."}
   * @paramDef {"type":"String","label":"Company","name":"company","description":"The company where the contact works."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","description":"Additional notes about the contact."}
   * @returns {Object}
   * @sampleResult {"id":"AAMkAGVmMDEzMTM4","givenName":"John","surname":"Smith","emailAddresses":[{"address":"john.smith@company.com"}],"mobilePhone":"555-123-4567","companyName":"Acme Corp","personalNotes":"Team lead"}
   */
  async createContact(firstName, lastName, middleName, emails, phoneNumber, company, notes) {
    const url = `${ API_BASE_URL }/contacts`

    const payload = cleanupObject({
      givenName: firstName,
      surname: lastName,
      middleName,
      mobilePhone: phoneNumber,
      companyName: company,
      personalNotes: notes,
    })

    if (emails) {
      if (!Array.isArray(emails)) {
        emails = [emails]
      }

      payload.emailAddresses = emails.map(email => ({
        address: email,
      }))
    }

    return this.#apiRequest({
      url,
      logTag: 'createContact',
      method: 'post',
      body: payload,
    })
  }

  /**
   * @operationName Update Contact
   * @category Contact Management
   * @appearanceColor #0078D4 #40BFFF
   * @description Updates an existing contact in the user's contact list with basic information including name, email, phone, and company details.
   * @route POST /update-contact
   * @paramDef {"type":"String","label":"Contact ID","name":"id","required":true,"dictionary":"getContactIdDictionary","description":"The unique identifier of the contact to update."}
   * @paramDef {"type":"String","label":"First Name","name":"firstName","description":"The first name of the contact."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","description":"The last name of the contact."}
   * @paramDef {"type":"String","label":"Middle Name","name":"middleName","description":"The middle name of the contact."}
   * @paramDef {"type":"Array","label":"Email(s)","name":"emails","description":"The email address of the contact.(Max 3)"}
   * @paramDef {"type":"String","label":"Mobile Phone Number","name":"phoneNumber","description":"The mobile phone number of the contact."}
   * @paramDef {"type":"String","label":"Company","name":"company","description":"The company where the contact works."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","description":"Additional notes about the contact."}
   * @returns {Object}
   * @sampleResult {"id":"AAMkAGVmMDEzMTM4","givenName":"John","surname":"Smith","emailAddresses":[{"address":"john.smith@company.com"}],"mobilePhone":"555-123-4567","companyName":"Updated Corp","personalNotes":"Updated notes"}
   */
  async updateContact(id, firstName, lastName, middleName, emails, phoneNumber, company, notes) {
    const url = `${ API_BASE_URL }/contacts/${ id }`

    const payload = cleanupObject({
      givenName: firstName,
      surname: lastName,
      middleName,
      mobilePhone: phoneNumber,
      companyName: company,
      personalNotes: notes,
    })

    if (emails) {
      if (!Array.isArray(emails)) {
        emails = [emails]
      }

      payload.emailAddresses = emails.map(email => ({
        address: email,
      }))
    }

    return this.#apiRequest({
      url,
      logTag: 'updateContact',
      method: 'patch',
      body: payload,
    })
  }

  /**
   * @operationName Mark Email As Unread
   * @category Email Management
   * @appearanceColor #0078D4 #40BFFF
   * @description Marks an email as unread in the user's inbox to indicate it needs attention.
   * @route POST /mark-email-as-unread
   * @paramDef {"type":"String","label":"Message ID","name":"messageId","required":true,"dictionary":"getUnreadMessageDictionary","description":"The unique identifier of the email message to mark as unread."}
   * @returns {Object}
   * @sampleResult {"@odata.context":"https://graph.microsoft.com/v1.0/$metadata#users/messages/$entity","id":"AAMkAGVmMDEzMTM4","isRead":false,"subject":"Important Update"}
   */
  async markEmailAsUnread(messageId) {
    if (!messageId) {
      throw new Error('Parameter "Message ID" is required')
    }

    const url = `${ API_BASE_URL }/messages/${ messageId }`

    return this.#apiRequest({
      url,
      logTag: 'markEmailAsUnread',
      method: 'patch',
      body: { isRead: false },
    })
  }
}

Flowrunner.ServerCode.addService(OutlookService, [
  {
    name: 'clientId',
    displayName: 'Client ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'OAuth2 Client ID for Microsoft Graph API integration. Leave blank to use default.',
  },
  {
    name: 'clientSecret',
    displayName: 'Client Secret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'OAuth2 Client Secret for Microsoft Graph API integration. Leave blank to use default.',
  },
])

function searchFilter(list, props, searchString) {
  const caseInsensitiveSearch = searchString.toLowerCase()

  return list.filter(item =>
    props.some(prop => {
      const value = prop.split('.').reduce((acc, key) => acc?.[key], item)

      return value && String(value).toLowerCase().includes(caseInsensitiveSearch)
    })
  )
}

function cleanupObject(data) {
  if (!data) {
    return
  }

  const result = {}

  Object.keys(data).forEach(key => {
    if (data[key] !== undefined && data[key] !== null) {
      result[key] = data[key]
    }
  })

  return result
}

function constructIdentityName(user) {
  let connectionIdentityName = null

  if (user.mail) {
    connectionIdentityName = user.mail
  }

  if (user.displayName) {
    connectionIdentityName += user.mail ? ` (${ user.displayName })` : user.displayName
  }

  return connectionIdentityName || 'Microsoft Connection'
}