const API_VERSION = 'v21.0'
const API_BASE_WWW_URL = `https://www.facebook.com/${ API_VERSION }`
const API_BASE_GRAPH_URL = `https://graph.facebook.com/${ API_VERSION }`
const OAUTH_BASE_URL = `${ API_BASE_WWW_URL }/dialog/oauth`

const DEFAULT_LIMIT = 25

// Scopes required to list Pages, send/receive messages, manage the Messenger
// profile, and read Page engagement. pages_messaging requires Advanced Access
// (Meta App Review) for public use; Development mode covers your own Pages.
const DEFAULT_SCOPE_LIST = [
  'pages_show_list',
  'pages_messaging',
  'pages_manage_metadata',
  'pages_read_engagement',
]

const DEFAULT_SCOPE_STRING = DEFAULT_SCOPE_LIST.join(' ')

const logger = {
  info: (...args) => console.log('[Facebook Messenger] info:', ...args),
  debug: (...args) => console.log('[Facebook Messenger] debug:', ...args),
  error: (...args) => console.log('[Facebook Messenger] error:', ...args),
  warn: (...args) => console.log('[Facebook Messenger] warn:', ...args),
}

// Remove undefined/null/'' entries so they are not sent to the Graph API.
function clean(obj) {
  if (!obj) {
    return obj
  }

  const result = {}

  for (const key in obj) {
    const value = obj[key]

    if (value !== undefined && value !== null && value !== '') {
      result[key] = value
    }
  }

  return result
}

/**
 * @requireOAuth
 * @integrationName Facebook Messenger
 * @integrationIcon /icon.svg
 */
class FacebookMessengerService {
  constructor(config) {
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
    this.scopes = DEFAULT_SCOPE_STRING
    // Per-invocation cache of Page access tokens keyed by Page id (plus an
    // empty-key entry for the default/first Page) to avoid repeat /me/accounts calls.
    this._pageTokenCache = {}
  }

  #getAccessToken() {
    return this.request.headers['oauth-access-token']
  }

  // Maps a friendly dropdown label to its Graph API value. Unmapped values pass through.
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  async #apiRequest({ url, method = 'get', body, query, token, logTag }) {
    const cleanedQuery = clean(query)

    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=${ JSON.stringify(cleanedQuery) }`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Authorization': `Bearer ${ token || this.#getAccessToken() }`,
          'Content-Type': 'application/json',
        })
        .query(cleanedQuery || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const fbError = error.body?.error
      const message = fbError?.message || error.message

      logger.error(`${ logTag } - failed: ${ message } (trace: ${ fbError?.fbtrace_id || 'n/a' })`)

      const parts = [`Facebook Messenger API error: ${ message }`]

      if (fbError?.type) {
        parts.push(`type=${ fbError.type }`)
      }

      if (fbError?.code !== undefined) {
        parts.push(`code=${ fbError.code }`)
      }

      if (fbError?.error_subcode !== undefined) {
        parts.push(`subcode=${ fbError.error_subcode }`)
      }

      if (fbError?.fbtrace_id) {
        parts.push(`fbtrace_id=${ fbError.fbtrace_id }`)
      }

      throw new Error(parts.join(' | '))
    }
  }

  // Resolves the PAGE access token used by all Send API / Messenger Platform calls.
  // The Send API rejects the user token, so we look up the Page's own token from
  // GET /me/accounts. When pageId is empty the first managed Page is used. Results
  // are cached for the duration of the invocation.
  async #getPageToken(pageId) {
    const cacheKey = pageId || ''

    if (this._pageTokenCache[cacheKey]) {
      return this._pageTokenCache[cacheKey]
    }

    const response = await this.#apiRequest({
      logTag: '[getPageToken]',
      url: `${ API_BASE_GRAPH_URL }/me/accounts`,
      method: 'get',
      query: { fields: 'id,name,access_token', limit: 100 },
    })

    const pages = response.data || []

    if (pages.length === 0) {
      throw new Error('No Facebook Pages are available for this account. Grant the pages_show_list permission and ensure you manage at least one Page.')
    }

    const page = pageId ? pages.find(p => p.id === pageId) : pages[0]

    if (!page) {
      throw new Error(`Page "${ pageId }" was not found among the Pages you manage. Use List My Pages to see available Page ids.`)
    }

    if (!page.access_token) {
      throw new Error(`No Page access token was returned for Page "${ page.id }". Ensure the pages_messaging and pages_read_engagement permissions are granted.`)
    }

    this._pageTokenCache[cacheKey] = page.access_token

    return page.access_token
  }

  // Builds the shared messaging_type / tag / notification_type envelope for Send API calls,
  // mapping friendly dropdown labels to the Graph API tokens.
  #buildMessagingEnvelope(messagingType, tag, notificationType) {
    const resolvedType = this.#resolveChoice(messagingType, {
      'Response': 'RESPONSE',
      'Update': 'UPDATE',
      'Message Tag': 'MESSAGE_TAG',
    }) || 'RESPONSE'

    const envelope = { messaging_type: resolvedType }

    const resolvedTag = this.#resolveChoice(tag, {
      'Account Update': 'ACCOUNT_UPDATE',
      'Confirmed Event Update': 'CONFIRMED_EVENT_UPDATE',
      'Post Purchase Update': 'POST_PURCHASE_UPDATE',
      'Human Agent': 'HUMAN_AGENT',
    })

    if (resolvedType === 'MESSAGE_TAG') {
      if (!resolvedTag) {
        throw new Error('A Message Tag is required when Messaging Type is "Message Tag". Choose one of Account Update, Confirmed Event Update, Post Purchase Update, or Human Agent.')
      }

      envelope.tag = resolvedTag
    }

    const resolvedNotification = this.#resolveChoice(notificationType, {
      'Regular': 'REGULAR',
      'Silent Push': 'SILENT_PUSH',
      'No Push': 'NO_PUSH',
    })

    if (resolvedNotification) {
      envelope.notification_type = resolvedNotification
    }

    return envelope
  }

  // Sends a fully-formed Send API body against POST /{pageId}/messages with the Page token.
  async #sendMessage(pageId, body, logTag) {
    const token = await this.#getPageToken(pageId)
    const targetPage = pageId || 'me'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_GRAPH_URL }/${ targetPage }/messages`,
      method: 'post',
      token,
      body: clean(body),
    })
  }

  // ============================== OAUTH SYSTEM METHODS ==============================

  /**
   * @registerAs SYSTEM
   * @route GET /getOAuth2ConnectionURL
   * @returns {String}
   */
  async getOAuth2ConnectionURL() {
    const params = new URLSearchParams()

    params.append('client_id', this.clientId)
    params.append('scope', this.scopes)
    params.append('response_type', 'code')

    const connectionURL = `${ OAUTH_BASE_URL }/?${ params.toString() }`

    logger.debug(`OAuth2 Connection URL: ${ connectionURL }`)

    return connectionURL
  }

  /**
   * @typedef {Object} refreshToken_ResultObject
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
    const params = new URLSearchParams()

    params.append('client_id', this.clientId)
    params.append('client_secret', this.clientSecret)
    params.append('scope', this.scopes)
    params.append('refresh_token', refreshToken)
    params.append('grant_type', 'refresh_token')

    try {
      const { access_token, expires_in, refresh_token } = await Flowrunner.Request
        .post(`${ API_BASE_GRAPH_URL }/oauth/access_token`)
        .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        .send(params.toString())

      return {
        token: access_token,
        expirationInSeconds: expires_in,
        refreshToken: refresh_token || refreshToken,
      }
    } catch (error) {
      logger.error(`refreshToken: ${ error.message || error }`)

      throw error
    }
  }

  /**
   * @typedef {Object} executeCallback_ResultObject
   * @property {String} token
   * @property {String} [refreshToken]
   * @property {Number} [expirationInSeconds]
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
    logger.debug(`Execute Callback: ${ JSON.stringify(callbackObject) }`)

    const params = new URLSearchParams()

    params.append('grant_type', 'authorization_code')
    params.append('client_id', this.clientId)
    params.append('client_secret', this.clientSecret)
    params.append('redirect_uri', callbackObject.redirectURI)
    params.append('code', callbackObject.code)

    try {
      const response = await Flowrunner.Request.post(`${ API_BASE_GRAPH_URL }/oauth/access_token`)
        .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        .send(params.toString())

      const { access_token, refresh_token, expires_in } = response

      const profile = await Flowrunner.Request
        .get(`${ API_BASE_GRAPH_URL }/me?fields=id,name,picture`)
        .set({ Authorization: `Bearer ${ access_token }` })
        .send()

      return {
        token: access_token,
        refreshToken: refresh_token,
        overwrite: true,
        expirationInSeconds: expires_in,
        connectionIdentityName: profile['name'] || 'Facebook User',
        connectionIdentityImageURL: profile['picture']?.data?.url || null,
      }
    } catch (error) {
      logger.error(`Failed to execute callback: ${ error.message || error }`)

      throw error
    }
  }

  // ================================= SENDING =================================

  /**
   * @operationName Send Text Message
   * @category Sending
   * @description Sends a plain text message to a Messenger user via POST /{pageId}/messages using the Page access token. The recipient must have messaged the Page first; the PSID (page-scoped user id) comes from those conversations (see List Conversations). Standard messaging (RESPONSE/UPDATE) is only allowed inside the 24-hour messaging window after the user's last message; outside that window set Messaging Type to "Message Tag" and pick an eligible tag (e.g. Human Agent). Requires pages_messaging, which needs Meta App Review Advanced Access for public use — Development mode works for Pages you own.
   * @route POST /send-text-message
   * @paramDef {"type":"String","label":"Page ID","name":"pageId","dictionary":"getPagesDictionary","description":"The Page sending the message. Leave empty to use your first managed Page. Determines which Page access token is used."}
   * @paramDef {"type":"String","label":"Recipient PSID","name":"psid","required":true,"description":"The page-scoped user id (PSID) of the recipient. Obtained from List Conversations / Get Conversation Messages; the user must have messaged the Page first."}
   * @paramDef {"type":"String","label":"Message Text","name":"text","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The text to send. Up to 2000 characters."}
   * @paramDef {"type":"String","label":"Messaging Type","name":"messagingType","uiComponent":{"type":"DROPDOWN","options":{"values":["Response","Update","Message Tag"]}},"defaultValue":"Response","description":"Response = reply within the 24-hour window; Update = proactive update within the window; Message Tag = send outside the window using a permitted tag."}
   * @paramDef {"type":"String","label":"Message Tag","name":"tag","uiComponent":{"type":"DROPDOWN","options":{"values":["Account Update","Confirmed Event Update","Post Purchase Update","Human Agent"]}},"description":"Required only when Messaging Type is Message Tag. Declares the permitted use case for sending outside the 24-hour window."}
   * @paramDef {"type":"String","label":"Notification Type","name":"notificationType","uiComponent":{"type":"DROPDOWN","options":{"values":["Regular","Silent Push","No Push"]}},"defaultValue":"Regular","description":"Push behavior on the recipient's device. Regular sends a sound/vibration, Silent Push is quiet, No Push suppresses the notification."}
   * @returns {Object}
   * @sampleResult {"recipient_id":"6899200000000000","message_id":"m_AbC1dEf2Gh3Ij4Kl5"}
   */
  async sendTextMessage(pageId, psid, text, messagingType, tag, notificationType) {
    const body = {
      recipient: { id: psid },
      message: { text },
      ...this.#buildMessagingEnvelope(messagingType, tag, notificationType),
    }

    return await this.#sendMessage(pageId, body, '[sendTextMessage]')
  }

  /**
   * @operationName Send Media Message
   * @category Sending
   * @description Sends an image, audio, video, or file attachment by URL to a Messenger user via POST /{pageId}/messages with the Page access token. Facebook fetches the media from the provided public URL. Set Reusable to true to have Facebook return a reusable attachment_id for future sends. Subject to the same 24-hour window / message tag rules and pages_messaging Advanced Access requirement as text messages.
   * @route POST /send-media-message
   * @paramDef {"type":"String","label":"Page ID","name":"pageId","dictionary":"getPagesDictionary","description":"The Page sending the media. Leave empty to use your first managed Page."}
   * @paramDef {"type":"String","label":"Recipient PSID","name":"psid","required":true,"description":"The page-scoped user id (PSID) of the recipient. The user must have messaged the Page first."}
   * @paramDef {"type":"String","label":"Attachment Type","name":"attachmentType","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Image","Audio","Video","File"]}},"defaultValue":"Image","description":"The kind of media being sent. Determines how Messenger renders the attachment."}
   * @paramDef {"type":"String","label":"Media URL","name":"url","required":true,"description":"Public URL of the media asset for Facebook to fetch (e.g. an image PNG/JPG, MP3, MP4, or PDF)."}
   * @paramDef {"type":"Boolean","label":"Reusable","name":"isReusable","uiComponent":{"type":"TOGGLE"},"description":"When true, Facebook stores the upload and returns an attachment_id you can reuse in later sends without re-fetching the URL."}
   * @paramDef {"type":"String","label":"Messaging Type","name":"messagingType","uiComponent":{"type":"DROPDOWN","options":{"values":["Response","Update","Message Tag"]}},"defaultValue":"Response","description":"Response = reply within the 24-hour window; Update = proactive update within the window; Message Tag = send outside the window using a permitted tag."}
   * @paramDef {"type":"String","label":"Message Tag","name":"tag","uiComponent":{"type":"DROPDOWN","options":{"values":["Account Update","Confirmed Event Update","Post Purchase Update","Human Agent"]}},"description":"Required only when Messaging Type is Message Tag."}
   * @paramDef {"type":"String","label":"Notification Type","name":"notificationType","uiComponent":{"type":"DROPDOWN","options":{"values":["Regular","Silent Push","No Push"]}},"defaultValue":"Regular","description":"Push behavior on the recipient's device."}
   * @returns {Object}
   * @sampleResult {"recipient_id":"6899200000000000","message_id":"m_AbC1dEf2Gh3Ij4Kl5","attachment_id":"1857777774821032"}
   */
  async sendMediaMessage(pageId, psid, attachmentType, url, isReusable, messagingType, tag, notificationType) {
    const resolvedType = this.#resolveChoice(attachmentType, {
      'Image': 'image',
      'Audio': 'audio',
      'Video': 'video',
      'File': 'file',
    }) || 'image'

    const body = {
      recipient: { id: psid },
      message: {
        attachment: {
          type: resolvedType,
          payload: clean({
            url,
            is_reusable: isReusable === undefined ? undefined : Boolean(isReusable),
          }),
        },
      },
      ...this.#buildMessagingEnvelope(messagingType, tag, notificationType),
    }

    return await this.#sendMessage(pageId, body, '[sendMediaMessage]')
  }

  /**
   * @typedef {Object} TemplateButton
   * @property {String} type Button type: "web_url" opens a URL, "postback" sends a payload back to your webhook.
   * @property {String} title Button label text shown to the user (max 20 characters).
   * @property {String} [url] Destination URL. Required when type is "web_url".
   * @property {String} [payload] Developer-defined payload delivered to your webhook. Required when type is "postback".
   */

  /**
   * @operationName Send Button Template
   * @category Sending
   * @description Sends a button template message (text plus up to 3 tappable buttons) via POST /{pageId}/messages with the Page access token. Each button is either a "web_url" button (opens a link) or a "postback" button (sends a developer-defined payload back to your webhook). Uses RESPONSE messaging within the 24-hour window. Requires pages_messaging Advanced Access for public use.
   * @route POST /send-button-template
   * @paramDef {"type":"String","label":"Page ID","name":"pageId","dictionary":"getPagesDictionary","description":"The Page sending the template. Leave empty to use your first managed Page."}
   * @paramDef {"type":"String","label":"Recipient PSID","name":"psid","required":true,"description":"The page-scoped user id (PSID) of the recipient. The user must have messaged the Page first."}
   * @paramDef {"type":"String","label":"Text","name":"text","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The message text displayed above the buttons (up to 640 characters)."}
   * @paramDef {"type":"Array<TemplateButton>","label":"Buttons","name":"buttons","required":true,"description":"Up to 3 buttons. Each: {\"type\":\"web_url\",\"title\":\"Visit\",\"url\":\"https://example.com\"} or {\"type\":\"postback\",\"title\":\"Yes\",\"payload\":\"CONFIRM_YES\"}."}
   * @returns {Object}
   * @sampleResult {"recipient_id":"6899200000000000","message_id":"m_AbC1dEf2Gh3Ij4Kl5"}
   */
  async sendButtonTemplate(pageId, psid, text, buttons) {
    const buttonList = Array.isArray(buttons) ? buttons : []

    if (buttonList.length === 0) {
      throw new Error('At least one button is required for a button template.')
    }

    if (buttonList.length > 3) {
      throw new Error('A button template supports a maximum of 3 buttons.')
    }

    const body = {
      recipient: { id: psid },
      message: {
        attachment: {
          type: 'template',
          payload: {
            template_type: 'button',
            text,
            buttons: buttonList.map(button => clean({
              type: button.type,
              title: button.title,
              url: button.url,
              payload: button.payload,
            })),
          },
        },
      },
      messaging_type: 'RESPONSE',
    }

    return await this.#sendMessage(pageId, body, '[sendButtonTemplate]')
  }

  /**
   * @operationName Send Generic Template
   * @category Sending
   * @description Sends a generic (carousel) template message via POST /{pageId}/messages with the Page access token. The Elements parameter is a raw array of up to 10 element objects, each a horizontally-scrollable card with title, optional subtitle, image_url, default_action, and buttons. Uses RESPONSE messaging within the 24-hour window. Requires pages_messaging Advanced Access for public use.
   * @route POST /send-generic-template
   * @paramDef {"type":"String","label":"Page ID","name":"pageId","dictionary":"getPagesDictionary","description":"The Page sending the template. Leave empty to use your first managed Page."}
   * @paramDef {"type":"String","label":"Recipient PSID","name":"psid","required":true,"description":"The page-scoped user id (PSID) of the recipient. The user must have messaged the Page first."}
   * @paramDef {"type":"Array<Object>","label":"Elements","name":"elements","required":true,"description":"Raw array of up to 10 card objects. Example element: {\"title\":\"Classic T-Shirt\",\"subtitle\":\"Soft cotton tee\",\"image_url\":\"https://example.com/tshirt.png\",\"default_action\":{\"type\":\"web_url\",\"url\":\"https://example.com/tshirt\"},\"buttons\":[{\"type\":\"postback\",\"title\":\"Buy\",\"payload\":\"BUY_TSHIRT\"}]}."}
   * @returns {Object}
   * @sampleResult {"recipient_id":"6899200000000000","message_id":"m_AbC1dEf2Gh3Ij4Kl5"}
   */
  async sendGenericTemplate(pageId, psid, elements) {
    const elementList = Array.isArray(elements) ? elements : []

    if (elementList.length === 0) {
      throw new Error('At least one element is required for a generic template.')
    }

    if (elementList.length > 10) {
      throw new Error('A generic template supports a maximum of 10 elements.')
    }

    const body = {
      recipient: { id: psid },
      message: {
        attachment: {
          type: 'template',
          payload: {
            template_type: 'generic',
            elements: elementList,
          },
        },
      },
      messaging_type: 'RESPONSE',
    }

    return await this.#sendMessage(pageId, body, '[sendGenericTemplate]')
  }

  /**
   * @typedef {Object} QuickReply
   * @property {String} title The quick reply button label shown to the user (max 20 characters).
   * @property {String} payload Developer-defined payload delivered to your webhook when the user taps this quick reply.
   */

  /**
   * @operationName Send Quick Replies
   * @category Sending
   * @description Sends a text message accompanied by up to 13 quick reply buttons via POST /{pageId}/messages with the Page access token. Quick replies appear as tappable chips above the composer and disappear once tapped, sending their payload back to your webhook. Uses RESPONSE messaging within the 24-hour window. Requires pages_messaging Advanced Access for public use.
   * @route POST /send-quick-replies
   * @paramDef {"type":"String","label":"Page ID","name":"pageId","dictionary":"getPagesDictionary","description":"The Page sending the message. Leave empty to use your first managed Page."}
   * @paramDef {"type":"String","label":"Recipient PSID","name":"psid","required":true,"description":"The page-scoped user id (PSID) of the recipient. The user must have messaged the Page first."}
   * @paramDef {"type":"String","label":"Text","name":"text","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The message text displayed above the quick reply chips."}
   * @paramDef {"type":"Array<QuickReply>","label":"Quick Replies","name":"quickReplies","required":true,"description":"Up to 13 quick replies. Each: {\"title\":\"Yes\",\"payload\":\"ANSWER_YES\"}. content_type is set to text automatically."}
   * @returns {Object}
   * @sampleResult {"recipient_id":"6899200000000000","message_id":"m_AbC1dEf2Gh3Ij4Kl5"}
   */
  async sendQuickReplies(pageId, psid, text, quickReplies) {
    const replyList = Array.isArray(quickReplies) ? quickReplies : []

    if (replyList.length === 0) {
      throw new Error('At least one quick reply is required.')
    }

    if (replyList.length > 13) {
      throw new Error('A message supports a maximum of 13 quick replies.')
    }

    const body = {
      recipient: { id: psid },
      message: {
        text,
        quick_replies: replyList.map(reply => ({
          content_type: 'text',
          title: reply.title,
          payload: reply.payload,
        })),
      },
      messaging_type: 'RESPONSE',
    }

    return await this.#sendMessage(pageId, body, '[sendQuickReplies]')
  }

  /**
   * @operationName Send Sender Action
   * @category Sending
   * @description Sends a sender action to a Messenger user via POST /{pageId}/messages with the Page access token. Typing On shows a typing indicator, Typing Off hides it, and Mark Seen marks the user's last message as read. Sender actions do not count as messages and help make automated conversations feel more responsive.
   * @route POST /send-sender-action
   * @paramDef {"type":"String","label":"Page ID","name":"pageId","dictionary":"getPagesDictionary","description":"The Page performing the action. Leave empty to use your first managed Page."}
   * @paramDef {"type":"String","label":"Recipient PSID","name":"psid","required":true,"description":"The page-scoped user id (PSID) of the recipient. The user must have messaged the Page first."}
   * @paramDef {"type":"String","label":"Sender Action","name":"senderAction","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Typing On","Typing Off","Mark Seen"]}},"defaultValue":"Typing On","description":"The action to perform: show a typing indicator, hide it, or mark the last message as seen."}
   * @returns {Object}
   * @sampleResult {"recipient_id":"6899200000000000"}
   */
  async sendSenderAction(pageId, psid, senderAction) {
    const resolvedAction = this.#resolveChoice(senderAction, {
      'Typing On': 'typing_on',
      'Typing Off': 'typing_off',
      'Mark Seen': 'mark_seen',
    }) || 'typing_on'

    const body = {
      recipient: { id: psid },
      sender_action: resolvedAction,
    }

    return await this.#sendMessage(pageId, body, '[sendSenderAction]')
  }

  // ============================== CONVERSATIONS ==============================

  /**
   * @operationName List Conversations
   * @category Conversations
   * @description Lists Messenger conversations for a Page via GET /{pageId}/conversations?platform=messenger using the Page access token. Returns each conversation's id, participants, last update time, a snippet of the latest message, and the unread count. Use the conversation id with Get Conversation Messages, and the participant ids as PSIDs for sending. Requires pages_read_engagement and pages_messaging.
   * @route GET /list-conversations
   * @paramDef {"type":"String","label":"Page ID","name":"pageId","dictionary":"getPagesDictionary","description":"The Page whose conversations to list. Leave empty to use your first managed Page."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of conversations to return per call (default 25)."}
   * @paramDef {"type":"String","label":"After Cursor","name":"after","description":"Pagination cursor from a previous response's paging.cursors.after to fetch the next page."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":"t_10000000000000000","participants":{"data":[{"name":"Jane Doe","id":"6899200000000000"},{"name":"Acme Store","id":"1122334455"}]},"updated_time":"2026-07-16T12:00:00+0000","snippet":"Do you ship internationally?","unread_count":1}],"paging":{"cursors":{"before":"MA","after":"MjQ"}}}
   */
  async listConversations(pageId, limit, after) {
    const token = await this.#getPageToken(pageId)
    const targetPage = pageId || 'me'

    return await this.#apiRequest({
      logTag: '[listConversations]',
      url: `${ API_BASE_GRAPH_URL }/${ targetPage }/conversations`,
      method: 'get',
      token,
      query: {
        platform: 'messenger',
        fields: 'id,participants,updated_time,snippet,unread_count',
        limit: limit || DEFAULT_LIMIT,
        after,
      },
    })
  }

  /**
   * @operationName Get Conversation Messages
   * @category Conversations
   * @description Lists the messages in a Messenger conversation via GET /{conversationId}/messages using the Page access token. Returns each message's id, text, sender (from), recipient (to), creation time, and any attachments. Note that only recent messages are accessible through the API; older history may not be returned. Requires pages_read_engagement and pages_messaging.
   * @route GET /get-conversation-messages
   * @paramDef {"type":"String","label":"Page ID","name":"pageId","dictionary":"getPagesDictionary","description":"The Page that owns the conversation (used to resolve the Page access token). Leave empty to use your first managed Page."}
   * @paramDef {"type":"String","label":"Conversation ID","name":"conversationId","required":true,"description":"The conversation id (e.g. t_10000000000000000) from List Conversations."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of messages to return per call (default 25)."}
   * @paramDef {"type":"String","label":"After Cursor","name":"after","description":"Pagination cursor from a previous response's paging.cursors.after to fetch the next page."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":"m_AbC1dEf2Gh3Ij4Kl5","message":"Do you ship internationally?","from":{"name":"Jane Doe","email":"","id":"6899200000000000"},"to":{"data":[{"name":"Acme Store","id":"1122334455"}]},"created_time":"2026-07-16T12:00:00+0000"}],"paging":{"cursors":{"before":"MA","after":"MjQ"}}}
   */
  async getConversationMessages(pageId, conversationId, limit, after) {
    const token = await this.#getPageToken(pageId)

    return await this.#apiRequest({
      logTag: '[getConversationMessages]',
      url: `${ API_BASE_GRAPH_URL }/${ conversationId }/messages`,
      method: 'get',
      token,
      query: {
        fields: 'id,message,from,to,created_time,attachments',
        limit: limit || DEFAULT_LIMIT,
        after,
      },
    })
  }

  // ================================= USERS =================================

  /**
   * @operationName Get User Profile
   * @category Users
   * @description Retrieves a Messenger user's profile via GET /{psid} using the Page access token. Returns first_name, last_name, profile_pic, locale, and timezone where available. Field availability depends on the permissions granted to your app and the user's privacy settings — some fields (e.g. locale, timezone) may be omitted. The user must have an active conversation with the Page.
   * @route GET /get-user-profile
   * @paramDef {"type":"String","label":"Page ID","name":"pageId","dictionary":"getPagesDictionary","description":"The Page the user is conversing with (used to resolve the Page access token). Leave empty to use your first managed Page."}
   * @paramDef {"type":"String","label":"Recipient PSID","name":"psid","required":true,"description":"The page-scoped user id (PSID) of the user whose profile to fetch. From List Conversations / Get Conversation Messages."}
   * @returns {Object}
   * @sampleResult {"first_name":"Jane","last_name":"Doe","profile_pic":"https://platform-lookaside.fbsbx.com/platform/profilepic/?psid=6899200000000000","locale":"en_US","timezone":-7,"id":"6899200000000000"}
   */
  async getUserProfile(pageId, psid) {
    const token = await this.#getPageToken(pageId)

    return await this.#apiRequest({
      logTag: '[getUserProfile]',
      url: `${ API_BASE_GRAPH_URL }/${ psid }`,
      method: 'get',
      token,
      query: {
        fields: 'first_name,last_name,profile_pic,locale,timezone',
      },
    })
  }

  // ============================ MESSENGER PROFILE ============================

  /**
   * @operationName Get Messenger Profile
   * @category Messenger Profile
   * @description Retrieves the Page's Messenger profile via GET /me/messenger_profile using the Page access token. Returns the configured greeting, Get Started button payload, and persistent menu. The Messenger profile controls the welcome experience and navigation shown to users in the Page's Messenger thread. Requires pages_messaging.
   * @route GET /get-messenger-profile
   * @paramDef {"type":"String","label":"Page ID","name":"pageId","dictionary":"getPagesDictionary","description":"The Page whose Messenger profile to read. Leave empty to use your first managed Page."}
   * @returns {Object}
   * @sampleResult {"data":[{"greeting":[{"locale":"default","text":"Hi! Welcome to Acme Store."}],"get_started":{"payload":"GET_STARTED"},"persistent_menu":[{"locale":"default","composer_input_disabled":false,"call_to_actions":[{"type":"postback","title":"Talk to an agent","payload":"TALK_TO_AGENT"}]}]}]}
   */
  async getMessengerProfile(pageId) {
    const token = await this.#getPageToken(pageId)

    return await this.#apiRequest({
      logTag: '[getMessengerProfile]',
      url: `${ API_BASE_GRAPH_URL }/me/messenger_profile`,
      method: 'get',
      token,
      query: {
        fields: 'greeting,get_started,persistent_menu',
      },
    })
  }

  /**
   * @operationName Set Get Started Button
   * @category Messenger Profile
   * @description Configures the Page's Get Started button via POST /me/messenger_profile using the Page access token. When a user opens the Page's Messenger thread for the first time they see a Get Started button; tapping it sends the specified payload to your webhook so you can trigger a welcome flow. Requires pages_messaging.
   * @route POST /set-get-started-button
   * @paramDef {"type":"String","label":"Page ID","name":"pageId","dictionary":"getPagesDictionary","description":"The Page to configure. Leave empty to use your first managed Page."}
   * @paramDef {"type":"String","label":"Payload","name":"payload","required":true,"description":"Developer-defined payload delivered to your webhook when the user taps Get Started (e.g. GET_STARTED)."}
   * @returns {Object}
   * @sampleResult {"result":"success"}
   */
  async setGetStartedButton(pageId, payload) {
    const token = await this.#getPageToken(pageId)

    return await this.#apiRequest({
      logTag: '[setGetStartedButton]',
      url: `${ API_BASE_GRAPH_URL }/me/messenger_profile`,
      method: 'post',
      token,
      body: {
        get_started: { payload },
      },
    })
  }

  /**
   * @operationName Set Greeting
   * @category Messenger Profile
   * @description Sets the Page's Messenger greeting text via POST /me/messenger_profile using the Page access token. The greeting is shown on the welcome screen before a user starts a conversation. This sets the default-locale greeting; personalization tokens such as {{user_first_name}} are supported by Messenger. Requires pages_messaging.
   * @route POST /set-greeting
   * @paramDef {"type":"String","label":"Page ID","name":"pageId","dictionary":"getPagesDictionary","description":"The Page to configure. Leave empty to use your first managed Page."}
   * @paramDef {"type":"String","label":"Greeting Text","name":"text","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The greeting text shown on the welcome screen (up to 160 characters). Supports {{user_first_name}} and other personalization tokens."}
   * @returns {Object}
   * @sampleResult {"result":"success"}
   */
  async setGreeting(pageId, text) {
    const token = await this.#getPageToken(pageId)

    return await this.#apiRequest({
      logTag: '[setGreeting]',
      url: `${ API_BASE_GRAPH_URL }/me/messenger_profile`,
      method: 'post',
      token,
      body: {
        greeting: [{ locale: 'default', text }],
      },
    })
  }

  /**
   * @operationName Set Persistent Menu
   * @category Messenger Profile
   * @description Sets the Page's persistent menu via POST /me/messenger_profile using the Page access token. The persistent menu is always accessible from the composer and can contain nested call-to-action items (postback, web_url, or nested submenus). The Menu parameter is a raw array of menu objects, one per locale. Requires pages_messaging.
   * @route POST /set-persistent-menu
   * @paramDef {"type":"String","label":"Page ID","name":"pageId","dictionary":"getPagesDictionary","description":"The Page to configure. Leave empty to use your first managed Page."}
   * @paramDef {"type":"Array<Object>","label":"Persistent Menu","name":"persistentMenu","required":true,"description":"Raw array of persistent menu objects, one per locale. Example: [{\"locale\":\"default\",\"composer_input_disabled\":false,\"call_to_actions\":[{\"type\":\"postback\",\"title\":\"Talk to an agent\",\"payload\":\"TALK_TO_AGENT\"},{\"type\":\"web_url\",\"title\":\"Visit site\",\"url\":\"https://example.com\"}]}]."}
   * @returns {Object}
   * @sampleResult {"result":"success"}
   */
  async setPersistentMenu(pageId, persistentMenu) {
    const token = await this.#getPageToken(pageId)
    const menu = Array.isArray(persistentMenu) ? persistentMenu : []

    if (menu.length === 0) {
      throw new Error('The persistent menu must contain at least one menu object (typically one per locale, including a "default" locale).')
    }

    return await this.#apiRequest({
      logTag: '[setPersistentMenu]',
      url: `${ API_BASE_GRAPH_URL }/me/messenger_profile`,
      method: 'post',
      token,
      body: {
        persistent_menu: menu,
      },
    })
  }

  /**
   * @operationName Delete Messenger Profile Fields
   * @category Messenger Profile
   * @description Deletes specific fields from the Page's Messenger profile via DELETE /me/messenger_profile using the Page access token. Select one or more of greeting, get_started, or persistent_menu to remove. Note that deleting get_started also clears the persistent menu, since the Get Started button is a prerequisite for it. Requires pages_messaging.
   * @route DELETE /delete-messenger-profile-fields
   * @paramDef {"type":"String","label":"Page ID","name":"pageId","dictionary":"getPagesDictionary","description":"The Page to modify. Leave empty to use your first managed Page."}
   * @paramDef {"type":"Array<String>","label":"Fields","name":"fields","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["greeting","get_started","persistent_menu"]}},"description":"One or more Messenger profile fields to delete."}
   * @returns {Object}
   * @sampleResult {"result":"success"}
   */
  async deleteMessengerProfileFields(pageId, fields) {
    const token = await this.#getPageToken(pageId)
    const fieldList = Array.isArray(fields) ? fields : (fields ? [fields] : [])

    if (fieldList.length === 0) {
      throw new Error('Select at least one Messenger profile field to delete (greeting, get_started, or persistent_menu).')
    }

    return await this.#apiRequest({
      logTag: '[deleteMessengerProfileFields]',
      url: `${ API_BASE_GRAPH_URL }/me/messenger_profile`,
      method: 'delete',
      token,
      body: {
        fields: fieldList,
      },
    })
  }

  // ================================= PAGES =================================

  /**
   * @operationName List My Pages
   * @category Pages
   * @description Lists the Facebook Pages the authenticated user manages via GET /me/accounts. Returns each Page's id, name, and category. Use a Page id with the messaging and Messenger profile actions — those actions automatically resolve the corresponding Page access token behind the scenes. Requires pages_show_list.
   * @route GET /list-my-pages
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of Pages to return per call (default 25)."}
   * @paramDef {"type":"String","label":"After Cursor","name":"after","description":"Pagination cursor from a previous response's paging.cursors.after to fetch the next page."}
   * @returns {Object}
   * @sampleResult {"data":[{"id":"1122334455","name":"Acme Store","category":"Retail Company"}],"paging":{"cursors":{"before":"MA","after":"MjQ"}}}
   */
  async listMyPages(limit, after) {
    return await this.#apiRequest({
      logTag: '[listMyPages]',
      url: `${ API_BASE_GRAPH_URL }/me/accounts`,
      method: 'get',
      query: {
        fields: 'id,name,category',
        limit: limit || DEFAULT_LIMIT,
        after,
      },
    })
  }

  // ============================== DICTIONARIES ==============================

  /**
   * @typedef {Object} getPagesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter your managed Pages by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (paging.cursors.after) to fetch the next page of managed Pages."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Pages Dictionary
   * @description Lists the Facebook Pages the authenticated user manages (via GET /me/accounts) for selecting a Page id in dependent parameters. Optionally filters by name. The option value is the Page id.
   * @route POST /get-pages-dictionary
   * @paramDef {"type":"getPagesDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor for listing managed Pages."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Acme Store","value":"1122334455","note":"Retail Company"}],"cursor":"MjQ"}
   */
  async getPagesDictionary(payload) {
    const { search, cursor } = payload || {}

    const response = await this.#apiRequest({
      logTag: '[getPagesDictionary]',
      url: `${ API_BASE_GRAPH_URL }/me/accounts`,
      method: 'get',
      query: {
        fields: 'id,name,category',
        limit: 100,
        after: cursor,
      },
    })

    const pages = response.data || []
    const term = (search || '').trim().toLowerCase()
    const filtered = term ? pages.filter(page => (page.name || '').toLowerCase().includes(term)) : pages

    return {
      items: filtered.map(page => ({
        label: page.name || page.id,
        value: page.id,
        note: page.category || undefined,
      })),
      cursor: response.paging?.cursors?.after,
    }
  }
}

Flowrunner.ServerCode.addService(FacebookMessengerService, [
  {
    name: 'clientId',
    displayName: 'App Client ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'The App ID (Client ID) from your Meta app dashboard (Settings > Basic). The app must have the Messenger product added and the pages_show_list, pages_messaging, pages_manage_metadata, and pages_read_engagement permissions.',
  },
  {
    name: 'clientSecret',
    displayName: 'App Client Secret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'The App Secret (Client Secret) from your Meta app dashboard (Settings > Basic). Keep this value confidential.',
  },
])
