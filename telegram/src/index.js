const API_BASE_URL = 'https://api.telegram.org'

const logger = {
  info: (...args) => console.log('[Telegram Service] info:', ...args),
  debug: (...args) => console.log('[Telegram Service] debug:', ...args),
  error: (...args) => console.log('[Telegram Service] error:', ...args),
  warn: (...args) => console.log('[Telegram Service] warn:', ...args),
}

const MethodCallTypes = {
  SHAPE_EVENT: 'SHAPE_EVENT',
  FILTER_TRIGGER: 'FILTER_TRIGGER',
}

class ResponseError extends Error {
  constructor(message, httpStatusCode, data) {
    super(message)

    this.message = message
    this.httpStatusCode = httpStatusCode
    this.data = data
  }

  toJSON() {
    return {
      message: this.message,
      httpStatusCode: this.httpStatusCode,
      data: this.data,
    }
  }
}

/**
 * @integrationName Telegram
 * @integrationIcon /icon.png
 * @integrationTriggersScope SINGLE_APP
 */
class Telegram {

  constructor(config) {
    this.botToken = config.botToken
  }

  async #apiRequest({ url, method, body, query, logTag }) {
    method = method || 'get'
    query = cleanupObject(query)

    try {
      logger.debug(`${ logTag } - api request: [${ method }::${ url }] q=[${ JSON.stringify(query) }]`)

      return await Backendless.Request[method](url).query(query).send(body)
    } catch (error) {
      if (typeof error.body === 'object') {
        error = new ResponseError(
          `Telegram Error: [${ error.body.error_code }] ${ error.body.description }`,
          null,
          error.body
        )
      }

      logger.error(`${ logTag } - error: ${ error.message }`)

      throw error
    }
  }

  /**
   * @operationName Send Message
   * @category Messaging
   * @appearanceColor #0088CC #54A9EB
   * @description Sends a text message to a specified chat, group, or channel.
   * @route POST /send-message
   * @paramDef {"type":"String","label":"Chat ID","name":"chatId","required":true,"dictionary":"getChatsDictionary","description":"Unique identifier for the target chat, group, or channel."}
   * @paramDef {"type":"String","label":"Message Text","name":"text","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Text of the message to be sent."}
   * @paramDef {"type":"String","label":"Parse Mode","name":"parseMode","uiComponent":{"type":"DROPDOWN","options":{"values":["","Markdown","MarkdownV2","HTML"]}},"description":"Mode for parsing entities in the message text."}
   * @paramDef {"type":"Boolean","label":"Disable Web Page Preview","name":"disableWebPagePreview","uiComponent":{"type":"TOGGLE"},"description":"Disables link previews for links in this message."}
   * @paramDef {"type":"Boolean","label":"Disable Notification","name":"disableNotification","uiComponent":{"type":"TOGGLE"},"description":"Sends the message silently without notification."}
   * @paramDef {"type":"Number","label":"Reply to Message ID","name":"replyToMessageId","description":"If the message is a reply, ID of the original message."}
   * @returns {Object}
   * @sampleResult {"message_id":123,"from":{"id":123456789,"is_bot":true,"first_name":"BotName"},"chat":{"id":-1001234567890,"title":"Test Group","type":"supergroup"},"date":1642781234,"text":"Hello from Telegram!"}
   */
  async sendMessage(chatId, text, parseMode, disableWebPagePreview, disableNotification, replyToMessageId) {
    const messageData = {
      chat_id: chatId,
      text: text,
    }

    if (parseMode) messageData.parse_mode = parseMode
    if (disableWebPagePreview) messageData.disable_web_page_preview = disableWebPagePreview
    if (disableNotification) messageData.disable_notification = disableNotification
    if (replyToMessageId) messageData.reply_to_message_id = replyToMessageId

    return this.#apiRequest({
      url: `${ API_BASE_URL }/bot${ this.botToken }/sendMessage`,
      method: 'post',
      body: messageData,
      logTag: 'sendMessage',
    })
  }

  /**
   * @operationName Send Photo
   * @category Messaging
   * @appearanceColor #0088CC #54A9EB
   * @description Sends a photo to a specified chat, group, or channel with optional caption.
   * @route POST /send-photo
   * @paramDef {"type":"String","label":"Chat ID","name":"chatId","required":true,"dictionary":"getChatsDictionary","description":"Unique identifier for the target chat, group, or channel."}
   * @paramDef {"type":"String","label":"Photo URL","name":"photo","required":true,"description":"URL of the photo to send. Must be accessible via HTTP."}
   * @paramDef {"type":"String","label":"Caption","name":"caption","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Photo caption."}
   * @paramDef {"type":"String","label":"Parse Mode","name":"parseMode","uiComponent":{"type":"DROPDOWN","options":{"values":["","Markdown","MarkdownV2","HTML"]}},"description":"Mode for parsing entities in the photo caption."}
   * @paramDef {"type":"Boolean","label":"Disable Notification","name":"disableNotification","uiComponent":{"type":"TOGGLE"},"description":"Sends the message silently without notification."}
   * @paramDef {"type":"Number","label":"Reply to Message ID","name":"replyToMessageId","description":"If the message is a reply, ID of the original message."}
   * @returns {Object}
   * @sampleResult {"message_id":124,"from":{"id":123456789,"is_bot":true,"first_name":"BotName"},"chat":{"id":-1001234567890,"title":"Test Group","type":"supergroup"},"date":1642781234,"photo":[{"file_id":"AgACAgIAAxkBAAIBY2FkZGVkZGVkZGVk","width":90,"height":67}]}
   */
  async sendPhoto(chatId, photo, caption, parseMode, disableNotification, replyToMessageId) {
    const photoData = {
      chat_id: chatId,
      photo: photo,
    }

    if (caption) photoData.caption = caption
    if (parseMode) photoData.parse_mode = parseMode
    if (disableNotification) photoData.disable_notification = disableNotification
    if (replyToMessageId) photoData.reply_to_message_id = replyToMessageId

    return this.#apiRequest({
      url: `${ API_BASE_URL }/bot${ this.botToken }/sendPhoto`,
      method: 'post',
      body: photoData,
      logTag: 'sendPhoto',
    })
  }

  /**
   * @operationName Send Document
   * @category Messaging
   * @appearanceColor #0088CC #54A9EB
   * @description Sends a general file (document) to a specified chat, group, or channel.
   * @route POST /send-document
   * @paramDef {"type":"String","label":"Chat ID","name":"chatId","required":true,"dictionary":"getChatsDictionary","description":"Unique identifier for the target chat, group, or channel."}
   * @paramDef {"type":"String","label":"Document URL","name":"document","required":true,"description":"URL of the document to send. Must be accessible via HTTP."}
   * @paramDef {"type":"String","label":"Caption","name":"caption","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Document caption."}
   * @paramDef {"type":"String","label":"Parse Mode","name":"parseMode","uiComponent":{"type":"DROPDOWN","options":{"values":["","Markdown","MarkdownV2","HTML"]}},"description":"Mode for parsing entities in the document caption."}
   * @paramDef {"type":"Boolean","label":"Disable Notification","name":"disableNotification","uiComponent":{"type":"TOGGLE"},"description":"Sends the message silently without notification."}
   * @paramDef {"type":"Number","label":"Reply to Message ID","name":"replyToMessageId","description":"If the message is a reply, ID of the original message."}
   * @returns {Object}
   * @sampleResult {"message_id":125,"from":{"id":123456789,"is_bot":true,"first_name":"BotName"},"chat":{"id":-1001234567890,"title":"Test Group","type":"supergroup"},"date":1642781234,"document":{"file_name":"document.pdf","mime_type":"application/pdf","file_id":"BAADBAADrwADBREAAYag2wr3UT0NkPWaBA"}}
   */
  async sendDocument(chatId, document, caption, parseMode, disableNotification, replyToMessageId) {
    const documentData = {
      chat_id: chatId,
      document: document,
    }

    if (caption) documentData.caption = caption
    if (parseMode) documentData.parse_mode = parseMode
    if (disableNotification) documentData.disable_notification = disableNotification
    if (replyToMessageId) documentData.reply_to_message_id = replyToMessageId

    return this.#apiRequest({
      url: `${ API_BASE_URL }/bot${ this.botToken }/sendDocument`,
      method: 'post',
      body: documentData,
      logTag: 'sendDocument',
    })
  }

  /**
   * @operationName Get Chat Info
   * @category Chat Management
   * @appearanceColor #0088CC #54A9EB
   * @description Retrieves information about a chat, group, or channel.
   * @route POST /get-chat
   * @paramDef {"type":"String","label":"Chat ID","name":"chatId","required":true,"dictionary":"getChatsDictionary","description":"Unique identifier for the target chat, group, or channel."}
   * @returns {Object}
   * @sampleResult {"id":-1001234567890,"title":"Test Group","type":"supergroup","description":"A test group for bots","invite_link":"https://t.me/joinchat/AAAAAAAAAAAAAAABBBBBBBBBaaaaaaaA","member_count":42,"permissions":{"can_send_messages":true,"can_send_media_messages":true}}
   */
  async getChat(chatId) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/bot${ this.botToken }/getChat`,
      query: { chat_id: chatId },
      logTag: 'getChat',
    })
  }

  /**
   * @operationName Get Chat Member
   * @category Chat Management
   * @appearanceColor #0088CC #54A9EB
   * @description Retrieves information about a member of a chat, group, or channel.
   * @route POST /get-chat-member
   * @paramDef {"type":"String","label":"Chat ID","name":"chatId","required":true,"dictionary":"getChatsDictionary","description":"Unique identifier for the target chat, group, or channel."}
   * @paramDef {"type":"String","label":"User ID","name":"userId","required":true,"description":"Unique identifier of the target user."}
   * @returns {Object}
   * @sampleResult {"user":{"id":123456789,"is_bot":false,"first_name":"John","last_name":"Doe","username":"johndoe"},"status":"member","until_date":0}
   */
  async getChatMember(chatId, userId) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/bot${ this.botToken }/getChatMember`,
      query: { chat_id: chatId, user_id: userId },
      logTag: 'getChatMember',
    })
  }

  /**
   * @operationName Get Bot Info
   * @category Bot Management
   * @appearanceColor #0088CC #54A9EB
   * @description Retrieves basic information about the bot.
   * @route POST /get-me
   * @returns {Object}
   * @sampleResult {"id":123456789,"is_bot":true,"first_name":"MyBot","username":"mybot","can_join_groups":true,"can_read_all_group_messages":false,"supports_inline_queries":true}
   */
  async getMe() {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/bot${ this.botToken }/getMe`,
      logTag: 'getMe',
    })
  }

  /**
   * @operationName Get Updates
   * @category Bot Management
   * @appearanceColor #0088CC #54A9EB
   * @description Retrieves incoming updates for the bot (messages, callbacks, etc.).
   * @route POST /get-updates
   * @paramDef {"type":"Number","label":"Offset","name":"offset","description":"Identifier of the first update to be returned."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","default":100,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of updates to retrieve. Can be between 1 and 100 updates."}
   * @paramDef {"type":"Number","label":"Timeout","name":"timeout","default":0,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Timeout in seconds for long polling. Can be up to 50 seconds."}
   * @returns {Object}
   * @sampleResult {"ok":true,"result":[{"update_id":123456789,"message":{"message_id":123,"from":{"id":987654321,"is_bot":false,"first_name":"User"},"chat":{"id":987654321,"first_name":"User","type":"private"},"date":1642781234,"text":"Hello bot!"}}]}
   */
  async getUpdates(offset, limit = 100, timeout = 0) {
    const params = {}

    if (offset !== undefined) params.offset = offset
    if (limit !== undefined) params.limit = limit
    if (timeout !== undefined) params.timeout = timeout

    return this.#apiRequest({
      url: `${ API_BASE_URL }/bot${ this.botToken }/getUpdates`,
      query: params,
      logTag: 'getUpdates',
    })
  }

  /**
   * @operationName Get Webhook Info
   * @category Bot Management
   * @appearanceColor #0088CC #54A9EB
   * @description Retrieves current webhook status and information.
   * @route POST /get-webhook-info
   * @returns {Object}
   * @sampleResult {"ok":true,"result":{"url":"https://example.com/webhook","has_custom_certificate":false,"pending_update_count":0,"max_connections":40,"allowed_updates":["message","callback_query"]}}
   */
  async getWebhookInfo() {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/bot${ this.botToken }/getWebhookInfo`,
      logTag: 'getWebhookInfo',
    })
  }

  /**
   * @operationName Edit Message Text
   * @category Messaging
   * @appearanceColor #0088CC #54A9EB
   * @description Edits text and formatting of a message sent by the bot.
   * @route POST /edit-message-text
   * @paramDef {"type":"String","label":"Chat ID","name":"chatId","required":true,"dictionary":"getChatsDictionary","description":"Unique identifier for the target chat."}
   * @paramDef {"type":"Number","label":"Message ID","name":"messageId","required":true,"description":"Identifier of the message to edit."}
   * @paramDef {"type":"String","label":"New Text","name":"text","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New text of the message."}
   * @paramDef {"type":"String","label":"Parse Mode","name":"parseMode","uiComponent":{"type":"DROPDOWN","options":{"values":["","Markdown","MarkdownV2","HTML"]}},"description":"Mode for parsing entities in the message text."}
   * @paramDef {"type":"Boolean","label":"Disable Web Page Preview","name":"disableWebPagePreview","uiComponent":{"type":"TOGGLE"},"description":"Disables link previews for links in this message."}
   * @returns {Object}
   * @sampleResult {"ok":true,"result":{"message_id":123,"from":{"id":123456789,"is_bot":true,"first_name":"BotName"},"chat":{"id":-1001234567890,"title":"Test Group","type":"supergroup"},"date":1642781234,"edit_date":1642781300,"text":"Edited message text"}}
   */
  async editMessageText(chatId, messageId, text, parseMode, disableWebPagePreview) {
    const editData = {
      chat_id: chatId,
      message_id: messageId,
      text: text,
    }

    if (parseMode) editData.parse_mode = parseMode
    if (disableWebPagePreview !== undefined) editData.disable_web_page_preview = disableWebPagePreview

    return this.#apiRequest({
      url: `${ API_BASE_URL }/bot${ this.botToken }/editMessageText`,
      method: 'post',
      body: editData,
      logTag: 'editMessageText',
    })
  }

  /**
   * @operationName Delete Message
   * @category Messaging
   * @appearanceColor #0088CC #54A9EB
   * @description Deletes a message, including service messages.
   * @route POST /delete-message
   * @paramDef {"type":"String","label":"Chat ID","name":"chatId","required":true,"dictionary":"getChatsDictionary","description":"Unique identifier for the target chat."}
   * @paramDef {"type":"Number","label":"Message ID","name":"messageId","required":true,"description":"Identifier of the message to delete."}
   * @returns {Object}
   * @sampleResult {"ok":true,"result":true}
   */
  async deleteMessage(chatId, messageId) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/bot${ this.botToken }/deleteMessage`,
      method: 'post',
      body: { chat_id: chatId, message_id: messageId },
      logTag: 'deleteMessage',
    })
  }

  /**
   * @operationName Forward Message
   * @category Messaging
   * @appearanceColor #0088CC #54A9EB
   * @description Forwards messages of any kind from one chat to another.
   * @route POST /forward-message
   * @paramDef {"type":"String","label":"To Chat ID","name":"chatId","required":true,"dictionary":"getChatsDictionary","description":"Unique identifier for the target chat where the message will be forwarded."}
   * @paramDef {"type":"String","label":"From Chat ID","name":"fromChatId","required":true,"dictionary":"getChatsDictionary","description":"Unique identifier for the chat where the original message was sent."}
   * @paramDef {"type":"Number","label":"Message ID","name":"messageId","required":true,"description":"Message identifier in the chat specified in fromChatId."}
   * @paramDef {"type":"Boolean","label":"Disable Notification","name":"disableNotification","uiComponent":{"type":"TOGGLE"},"description":"Sends the message silently without notification."}
   * @returns {Object}
   * @sampleResult {"message_id":126,"from":{"id":123456789,"is_bot":true,"first_name":"BotName"},"chat":{"id":-1001234567890,"title":"Test Group","type":"supergroup"},"date":1642781234,"forward_from":{"id":987654321,"is_bot":false,"first_name":"User"},"forward_date":1642781200,"text":"Forwarded message text"}
   */
  async forwardMessage(chatId, fromChatId, messageId, disableNotification) {
    const forwardData = {
      chat_id: chatId,
      from_chat_id: fromChatId,
      message_id: messageId,
    }

    if (disableNotification) forwardData.disable_notification = disableNotification

    return this.#apiRequest({
      url: `${ API_BASE_URL }/bot${ this.botToken }/forwardMessage`,
      method: 'post',
      body: forwardData,
      logTag: 'forwardMessage',
    })
  }

  /**
   * @operationName Send Audio
   * @category Messaging
   * @appearanceColor #0088CC #54A9EB
   * @description Sends audio files to a specified chat. Audio must be in MP3 or M4A format.
   * @route POST /send-audio
   * @paramDef {"type":"String","label":"Chat ID","name":"chatId","required":true,"dictionary":"getChatsDictionary","description":"Unique identifier for the target chat, group, or channel."}
   * @paramDef {"type":"String","label":"Audio URL","name":"audio","required":true,"description":"URL of the audio file to send. Must be accessible via HTTP."}
   * @paramDef {"type":"String","label":"Caption","name":"caption","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Audio caption."}
   * @paramDef {"type":"String","label":"Parse Mode","name":"parseMode","uiComponent":{"type":"DROPDOWN","options":{"values":["","Markdown","MarkdownV2","HTML"]}},"description":"Mode for parsing entities in the audio caption."}
   * @paramDef {"type":"Number","label":"Duration","name":"duration","description":"Duration of the audio in seconds."}
   * @paramDef {"type":"String","label":"Performer","name":"performer","description":"Performer of the audio."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"Track title."}
   * @paramDef {"type":"Boolean","label":"Disable Notification","name":"disableNotification","uiComponent":{"type":"TOGGLE"},"description":"Sends the message silently without notification."}
   * @paramDef {"type":"Number","label":"Reply to Message ID","name":"replyToMessageId","description":"If the message is a reply, ID of the original message."}
   * @returns {Object}
   * @sampleResult {"message_id":127,"from":{"id":123456789,"is_bot":true,"first_name":"BotName"},"chat":{"id":-1001234567890,"title":"Test Group","type":"supergroup"},"date":1642781234,"audio":{"duration":180,"performer":"Artist Name","title":"Song Title","file_id":"AwACAgIAAxkBAAIBZGPkZGVkZGVkZGVk","file_unique_id":"AgADrwADBREAAYag","file_size":7654321}}
   */
  async sendAudio(chatId, audio, caption, parseMode, duration, performer, title, disableNotification, replyToMessageId) {
    const audioData = {
      chat_id: chatId,
      audio: audio,
    }

    if (caption) audioData.caption = caption
    if (parseMode) audioData.parse_mode = parseMode
    if (duration) audioData.duration = duration
    if (performer) audioData.performer = performer
    if (title) audioData.title = title
    if (disableNotification) audioData.disable_notification = disableNotification
    if (replyToMessageId) audioData.reply_to_message_id = replyToMessageId

    return this.#apiRequest({
      url: `${ API_BASE_URL }/bot${ this.botToken }/sendAudio`,
      method: 'post',
      body: audioData,
      logTag: 'sendAudio',
    })
  }

  /**
   * @operationName Send Sticker
   * @category Messaging
   * @appearanceColor #0088CC #54A9EB
   * @description Sends static .WEBP, animated .TGS, or video .WEBM stickers to a specified chat.
   * @route POST /send-sticker
   * @paramDef {"type":"String","label":"Chat ID","name":"chatId","required":true,"dictionary":"getChatsDictionary","description":"Unique identifier for the target chat, group, or channel."}
   * @paramDef {"type":"String","label":"Sticker","name":"sticker","required":true,"description":"Sticker to send. Can be a file_id or HTTP URL."}
   * @paramDef {"type":"String","label":"Emoji","name":"emoji","description":"Emoji associated with the sticker."}
   * @paramDef {"type":"Boolean","label":"Disable Notification","name":"disableNotification","uiComponent":{"type":"TOGGLE"},"description":"Sends the message silently without notification."}
   * @paramDef {"type":"Number","label":"Reply to Message ID","name":"replyToMessageId","description":"If the message is a reply, ID of the original message."}
   * @returns {Object}
   * @sampleResult {"message_id":128,"from":{"id":123456789,"is_bot":true,"first_name":"BotName"},"chat":{"id":-1001234567890,"title":"Test Group","type":"supergroup"},"date":1642781234,"sticker":{"width":512,"height":512,"emoji":"😊","set_name":"StickerSetName","is_animated":false,"is_video":false,"file_id":"CAACAgIAAxkBAAEBZWPkZGVkZGVkZGVk","file_unique_id":"AgADsgADO0KkSg","file_size":12345}}
   */
  async sendSticker(chatId, sticker, emoji, disableNotification, replyToMessageId) {
    const stickerData = {
      chat_id: chatId,
      sticker: sticker,
    }

    if (emoji) stickerData.emoji = emoji
    if (disableNotification) stickerData.disable_notification = disableNotification
    if (replyToMessageId) stickerData.reply_to_message_id = replyToMessageId

    return this.#apiRequest({
      url: `${ API_BASE_URL }/bot${ this.botToken }/sendSticker`,
      method: 'post',
      body: stickerData,
      logTag: 'sendSticker',
    })
  }

  /**
   * @operationName Send Location
   * @category Messaging
   * @appearanceColor #0088CC #54A9EB
   * @description Sends a point on the map to a specified chat.
   * @route POST /send-location
   * @paramDef {"type":"String","label":"Chat ID","name":"chatId","required":true,"dictionary":"getChatsDictionary","description":"Unique identifier for the target chat, group, or channel."}
   * @paramDef {"type":"Number","label":"Latitude","name":"latitude","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Latitude of the location. Must be between -90 and 90 degrees."}
   * @paramDef {"type":"Number","label":"Longitude","name":"longitude","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Longitude of the location. Must be between -180 and 180 degrees."}
   * @paramDef {"type":"Number","label":"Horizontal Accuracy","name":"horizontalAccuracy","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The radius of uncertainty for the location in meters. Can be up to 1500 meters."}
   * @paramDef {"type":"Number","label":"Live Period","name":"livePeriod","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Period in seconds for which the location will be updated. Should be between 60 and 86400 seconds. For live locations only."}
   * @paramDef {"type":"Number","label":"Heading","name":"heading","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Direction in which the user is moving. Should be between 1 and 360 degrees. For live locations only."}
   * @paramDef {"type":"Number","label":"Proximity Alert Radius","name":"proximityAlertRadius","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum distance for proximity alerts about approaching another chat member. Can be up to 100,000 meters. For live locations only."}
   * @paramDef {"type":"Boolean","label":"Disable Notification","name":"disableNotification","uiComponent":{"type":"TOGGLE"},"description":"Sends the message silently without notification."}
   * @paramDef {"type":"Number","label":"Reply to Message ID","name":"replyToMessageId","description":"If the message is a reply, ID of the original message."}
   * @returns {Object}
   * @sampleResult {"message_id":129,"from":{"id":123456789,"is_bot":true,"first_name":"BotName"},"chat":{"id":-1001234567890,"title":"Test Group","type":"supergroup"},"date":1642781234,"location":{"latitude":40.7128,"longitude":-74.0060}}
   */
  async sendLocation(chatId, latitude, longitude, horizontalAccuracy, livePeriod, heading, proximityAlertRadius, disableNotification, replyToMessageId) {
    const locationData = {
      chat_id: chatId,
      latitude: latitude,
      longitude: longitude,
    }

    if (horizontalAccuracy) locationData.horizontal_accuracy = horizontalAccuracy
    if (livePeriod) locationData.live_period = livePeriod
    if (heading) locationData.heading = heading
    if (proximityAlertRadius) locationData.proximity_alert_radius = proximityAlertRadius
    if (disableNotification) locationData.disable_notification = disableNotification
    if (replyToMessageId) locationData.reply_to_message_id = replyToMessageId

    return this.#apiRequest({
      url: `${ API_BASE_URL }/bot${ this.botToken }/sendLocation`,
      method: 'post',
      body: locationData,
      logTag: 'sendLocation',
    })
  }

  /**
   * @operationName Get File
   * @category File Management
   * @appearanceColor #0088CC #54A9EB
   * @description Gets basic information about a file and prepares it for downloading.
   * @route POST /get-file
   * @paramDef {"type":"String","label":"File ID","name":"fileId","required":true,"description":"File identifier to get information about."}
   * @returns {Object}
   * @sampleResult {"file_id":"AwACAgIAAxkBAAIBZGPkZGVkZGVkZGVk","file_unique_id":"AgADrwADBREAAYag","file_size":1234567,"file_path":"photos/file_123.jpg"}
   */
  async getFile(fileId) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/bot${ this.botToken }/getFile`,
      query: { file_id: fileId },
      logTag: 'getFile',
    })
  }

  /**
   * @typedef {Object} getChatsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter chats by title or username."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for retrieving the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Chats Dictionary
   * @description Provides a searchable list of bot chats for dynamic parameter selection.
   * @route POST /get-chats-dictionary
   * @paramDef {"type":"getChatsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Test Group (@testgroup)","value":"-1001234567890","note":"Type: supergroup, Members: 42"}],"cursor":null}
   */
  async getChatsDictionary(payload) {
    let search = (payload?.search || '').toLowerCase().trim()
    const cursor = payload?.cursor || 0

    const { result: updates } = await this.#apiRequest({
      url: `${ API_BASE_URL }/bot${ this.botToken }/getUpdates`,
      logTag: 'getUpdates',
      query: {
        offset: cursor,
      },
    })

    const chatsSet = new Map()

    updates.forEach(update => {
      const chat = update.message?.chat

      if (chat && !chatsSet.has(chat.id)) {
        const isPrivate = chat.type === 'private'

        if (search) {
          search = search.toLowerCase().trim()

          let matched

          if (chat.id === search) {
            matched = true
          } else if (isPrivate) {
            matched = searchInText(chat.username, search) ||
              searchInText(`${ chat.first_name } ${ chat.last_name }`, search)
          } else {
            matched = searchInText(chat.title, search)
          }

          if (!matched) {
            return
          }
        }

        const label = isPrivate
          ? `${ chat.first_name } ${ chat.last_name } (${ chat.type })`
          : `${ chat.title } (${ chat.type })`

        const note = isPrivate
          ? `ID: ${ chat.id }, @${ chat.username }`
          : `ID: ${ chat.id }${ chat.member_count ? `, Members: ${ chat.member_count }` : '' }`

        chatsSet.set(chat.id, {
          value: chat.id.toString(),
          label,
          note,
        })
      }
    })

    return {
      cursor: cursor + 1,
      items: [...chatsSet.values()],
    }

  }

  /**
   * @description Triggered when the bot receives a new message.
   * @route POST /on-message
   * @operationName On New Message
   * @registerAs REALTIME_TRIGGER
   * @appearanceColor #0088CC #54A9EB
   * @paramDef {"type":"String","label":"Chat ID","name":"chatId","required":false, "dictionary":"getChatsDictionary", "description":""}
   * @returns {Object}
   * @sampleResult {"update_id":123456789,"message":{"message_id":123,"from":{"id":987654321,"is_bot":false,"first_name":"User","username":"username"},"chat":{"id":987654321,"first_name":"User","type":"private"},"date":1642781234,"text":"Hello bot!"}}
   */
  async onMessage(callType, payload) {
    if (callType === MethodCallTypes.SHAPE_EVENT) {
      return [
        {
          name: 'onMessage',
          data: payload,
        },
      ]
    }

    if (callType === MethodCallTypes.FILTER_TRIGGER) {
      const triggersToActivate = payload.triggers
        .filter(({ data }) => {
          if (!data.chatId) {
            return true
          }

          return data.chatId === `${ payload.eventData.message.chat.id }`// message.chat.id comes as number
        })
        .map(({ id }) => id)

      logger.debug(`onCreateInvitee.triggersIdsToActivate: ${ JSON.stringify(triggersToActivate) }`)

      return {
        ids: triggersToActivate,
      }
    }
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerUpsertWebhook(invocation) {
    const { callbackUrl } = invocation

    try {
      logger.debug('[handleTriggerUpsertWebhook] Starting webhook upsert', invocation)

      const webhookResponse = await this.#setWebhook(callbackUrl)

      logger.info('[handleTriggerUpsertWebhook] Webhook set successfully', webhookResponse)

      return {
        webhookData: {
          webhookUrl: callbackUrl,
          created: new Date().toISOString(),
        },
      }
    } catch (error) {
      logger.error('[handleTriggerUpsertWebhook] Failed to set webhook', error)

      throw error
    }
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerResolveEvents(invocation) {
    const { body } = invocation

    logger.debug('[handleTriggerResolveEvents] Received webhook event', invocation)

    let events = []

    if (body.message) {
      events = await this.onMessage(MethodCallTypes.SHAPE_EVENT, invocation.body)
    }

    logger.debug(`[handleTriggerResolveEvents] Composed webhook events: ${ JSON.stringify(events) }`)

    return {
      events,
      connectionId: invocation.queryParams.connectionId,
    }
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerSelectMatched(invocation) {
    logger.debug(`handleTriggerSelectMatched.${ invocation.eventName }.FILTER_TRIGGER: ${ JSON.stringify(invocation) }`)

    const data = await this[invocation.eventName](MethodCallTypes.FILTER_TRIGGER, invocation)

    logger.debug(`handleTriggerSelectMatched.${ invocation.eventName }.triggersToActivate: ${ JSON.stringify(data) }`)

    return data
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerDeleteWebhook(invocation) {
    try {
      logger.debug('[handleTriggerDeleteWebhook] Deleting webhook', invocation)

      // Remove the webhook by setting an empty URL
      await this.#deleteWebhook(false)

      logger.info('[handleTriggerDeleteWebhook] Webhook deleted successfully')

      return {}
    } catch (error) {
      logger.error('[handleTriggerDeleteWebhook] Failed to delete webhook', error)

      throw error
    }
  }

  async #setWebhook(url) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/bot${ this.botToken }/setWebhook`,
      method: 'post',
      logTag: 'setWebhook',
      body: {
        url,
      },
    })
  }

  async #deleteWebhook() {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/bot${ this.botToken }/deleteWebhook`,
      method: 'post',
      logTag: 'deleteWebhook',
      body: {
        drop_pending_updates: false,
      },
    })
  }

}

Backendless.ServerCode.addService(Telegram, [
  {
    name: 'botToken',
    displayName: 'Bot Token',
    type: Backendless.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    hint: 'Your Telegram Bot Token. Get it from @BotFather on Telegram by creating a new bot.',
  },
])

function searchInText(source, search) {
  return source.toLowerCase().includes(search)
}

function cleanupObject(data) {
  if (!data) {
    return
  }

  Object.keys(data).forEach(key => {
    if (data[key] === undefined || data[key] === null) {
      delete data[key]
    }
  })

  return data
}