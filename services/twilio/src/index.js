const BASE_URL = 'https://api.twilio.com'
const API_BASE_URL = `${ BASE_URL }/2010-04-01`
const CONVERSATIONS_BASE_URL = 'https://conversations.twilio.com/v1'
const PAGE_SIZE_DICTIONARY = 50

const logger = {
  info: (...args) => console.log('[Twilio Service] info:', ...args),
  debug: (...args) => console.log('[Twilio Service] debug:', ...args),
  error: (...args) => console.log('[Twilio Service] error:', ...args),
  warn: (...args) => console.log('[Twilio Service] warn:', ...args),
}

const MethodCallTypes = {
  SHAPE_EVENT: 'SHAPE_EVENT',
  FILTER_TRIGGER: 'FILTER_TRIGGER',
}

/**
 * @integrationName Twilio
 * @integrationIcon /icon.webp
 * @integrationTriggersScope SINGLE_APP
 */
class TwilioService {
  /**
   * @typedef {Object} getPhoneNumbersDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter phone numbers by number or friendly name. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for retrieving the next page of results."}
   */

  /**
   * @typedef {Object} getMessagesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter messages by phone number or status. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for retrieving the next page of results."}
   */

  /**
   * @typedef {Object} getCallsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter calls by phone number or status. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for retrieving the next page of results."}
   */

  /**
   * @typedef {Object} getConversationsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter conversations by friendly name or unique name. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for retrieving the next page of results."}
   */

  constructor(config) {
    this.accountSid = config.accountSid
    this.authToken = config.authToken
  }

  #getAuthHeader() {
    const credentials = Buffer.from(`${ this.accountSid }:${ this.authToken }`).toString('base64')

    return {
      'Authorization': `Basic ${ credentials }`,
      'Content-Type': 'application/x-www-form-urlencoded',
    }
  }

  async #apiRequest({ url, method, body, query, logTag }) {
    method = method || 'get'
    query = cleanupObject(query)

    try {
      logger.debug(`${ logTag } - api request: [${ method }::${ url }] q=[${ JSON.stringify(query) }]`)

      return await Flowrunner.Request[method](url).set(this.#getAuthHeader()).query(query).send(body)
    } catch (error) {
      logger.error(`${ logTag } - error: ${ error.message }`)

      throw error
    }
  }

  /**
   * @operationName Send SMS
   * @category Messaging
   * @appearanceColor #F22F46 #FF6B7A
   * @description Sends an SMS message to a specified phone number using Twilio's messaging service.
   * @route POST /send-sms
   * @paramDef {"type":"String","label":"To Phone Number","name":"to","required":true,"description":"The recipient's phone number in E.164 format (e.g., +1234567890)."}
   * @paramDef {"type":"String","label":"From Phone Number","name":"from","required":true,"dictionary":"getPhoneNumbersDictionary","description":"Your Twilio phone number to send from."}
   * @paramDef {"type":"String","label":"Message Body","name":"body","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The text content of the SMS message (up to 1600 characters)."}
   * @paramDef {"type":"String","label":"Media URL","name":"mediaUrl","description":"Optional URL of an image to include in the message (MMS)."}
   * @returns {Object}
   * @sampleResult {"sid":"SM1234567890abcdef1234567890abcdef","status":"queued","to":"+1234567890","from":"+0987654321","body":"Hello from Twilio!"}
   */
  async sendSms(to, from, body, mediaUrl) {
    const params = new URLSearchParams()
    params.append('To', to)
    params.append('From', from)
    params.append('Body', body)

    if (mediaUrl) {
      params.append('MediaUrl', mediaUrl)
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/Accounts/${ this.accountSid }/Messages.json`,
      method: 'post',
      body: params.toString(),
      logTag: 'sendSms',
    })
  }

  /**
   * @operationName Make Voice Call
   * @category Voice
   * @appearanceColor #F22F46 #FF6B7A
   * @description Initiates a voice call to a specified phone number with custom instructions or TwiML.
   * @route POST /make-call
   * @paramDef {"type":"String","label":"To Phone Number","name":"to","required":true,"description":"The recipient's phone number in E.164 format (e.g., +1234567890)."}
   * @paramDef {"type":"String","label":"From Phone Number","name":"from","required":true,"dictionary":"getPhoneNumbersDictionary","description":"Your Twilio phone number to call from."}
   * @paramDef {"type":"String","label":"TwiML URL","name":"url","description":"URL that returns TwiML instructions for the call. If not provided, a default message will be used."}
   * @paramDef {"type":"String","label":"Voice Message","name":"voiceMessage","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Simple text message to convert to speech (alternative to TwiML URL)."}
   * @paramDef {"type":"Number","label":"Timeout","name":"timeout","default":60,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Time in seconds to wait for the call to be answered. Typically, between 1 and 600 seconds."}
   * @returns {Object}
   * @sampleResult {"sid":"CA1234567890abcdef1234567890abcdef","status":"queued","to":"+1234567890","from":"+0987654321","direction":"outbound-api"}
   */
  async makeCall(to, from, url, voiceMessage, timeout) {
    timeout = timeout || 60

    const params = new URLSearchParams()
    params.append('To', to)
    params.append('From', from)
    params.append('Timeout', timeout.toString())

    if (url) {
      params.append('Url', url)
    } else if (voiceMessage) {
      // Create simple TwiML for text-to-speech
      const twimlUrl = `http://twimlets.com/message?Message=${ encodeURIComponent(voiceMessage) }`
      params.append('Url', twimlUrl)
    } else {
      params.append('Url', 'http://twimlets.com/message?Message=Hello%20from%20Twilio!')
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/Accounts/${ this.accountSid }/Calls.json`,
      method: 'post',
      body: params.toString(),
      logTag: 'makeCall',
    })
  }

  /**
   * @operationName Get Message Details
   * @category Messaging
   * @appearanceColor #F22F46 #FF6B7A
   * @description Retrieves detailed information about a specific SMS or MMS message.
   * @route POST /get-message
   * @paramDef {"type":"String","label":"Message SID","name":"messageSid","required":true,"dictionary":"getMessagesDictionary","description":"The unique identifier of the message to retrieve."}
   * @returns {Object}
   * @sampleResult {"sid":"SM1234567890abcdef","status":"delivered","to":"+1234567890","from":"+0987654321","body":"Hello!","date_sent":"2024-01-15T10:30:00Z","price":"-0.0075"}
   */
  async getMessage(messageSid) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/Accounts/${ this.accountSid }/Messages/${ messageSid }.json`,
      logTag: 'getMessage',
    })
  }

  /**
   * @operationName Get Call Details
   * @category Voice
   * @appearanceColor #F22F46 #FF6B7A
   * @description Retrieves detailed information about a specific voice call.
   * @route POST /get-call
   * @paramDef {"type":"String","label":"Call SID","name":"callSid","required":true,"dictionary":"getCallsDictionary","description":"The unique identifier of the call to retrieve."}
   * @returns {Object}
   * @sampleResult {"sid":"CA1234567890abcdef","status":"completed","to":"+1234567890","from":"+0987654321","duration":"45","price":"-0.02","direction":"outbound-api"}
   */
  async getCall(callSid) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/Accounts/${ this.accountSid }/Calls/${ callSid }.json`,
      logTag: 'getCall',
    })
  }

  /**
   * @operationName List Messages
   * @category Messaging
   * @appearanceColor #F22F46 #FF6B7A
   * @description Retrieves a list of SMS and MMS messages from your Twilio account with optional filtering.
   * @route POST /list-messages
   * @paramDef {"type":"String","label":"To Phone Number","name":"to","description":"Filter messages sent to this phone number."}
   * @paramDef {"type":"String","label":"From Phone Number","name":"from","description":"Filter messages sent from this phone number."}
   * @paramDef {"type":"String","label":"Date Sent","name":"dateSent","description":"Filter messages sent on this date (YYYY-MM-DD format)."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","default":50,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of messages to retrieve per page. Can range from 1 to 1000 items."}
   * @returns {Object}
   * @sampleResult {"messages":[{"sid":"SM123","status":"delivered","to":"+1234567890","from":"+0987654321","body":"Hello!","date_sent":"2024-01-15T10:30:00Z"}],"page":0,"page_size":50}
   */
  async listMessages(to, from, dateSent, pageSize) {
    const params = {
      PageSize: pageSize || PAGE_SIZE_DICTIONARY,
    }

    if (to) params.To = to
    if (from) params.From = from
    if (dateSent) params.DateSent = dateSent

    return this.#apiRequest({
      url: `${ API_BASE_URL }/Accounts/${ this.accountSid }/Messages.json`,
      query: params,
      logTag: 'listMessages',
    })
  }

  /**
   * @operationName Start Conversation
   * @category Conversations
   * @appearanceColor #F22F46 #FF6B7A
   * @description Creates a new conversation and optionally adds participants to it. This combines conversation creation and participant addition into a single operation.
   * @route POST /start-conversation
   * @paramDef {"type":"String","label":"Friendly Name","name":"friendlyName","description":"Human-readable name for the conversation (max 256 characters)."}
   * @paramDef {"type":"String","label":"Unique Name","name":"uniqueName","description":"Unique application-defined identifier for the conversation."}
   * @paramDef {"type":"String","label":"Participant Phone Numbers","name":"participantPhones","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Comma-separated list of participant phone numbers in E.164 format (e.g., +1234567890, +0987654321)."}
   * @paramDef {"type":"String","label":"Proxy Phone Number","name":"proxyPhone","dictionary":"getPhoneNumbersDictionary","description":"Your Twilio phone number to use as the conversation proxy."}
   * @paramDef {"type":"String","label":"Attributes","name":"attributes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional JSON metadata for the conversation."}
   * @returns {Object}
   * @sampleResult {"conversation":{"sid":"CH1234567890abcdef","friendly_name":"Customer Support","unique_name":"support-001","state":"active","date_created":"2024-01-15T10:30:00Z"},"participants":[{"sid":"MB123","messaging_binding":{"address":"+1234567890","proxy_address":"+0987654321"}}]}
   */
  async startConversation(friendlyName, uniqueName, participantPhones, proxyPhone, attributes) {
    try {
      // Create the conversation
      const conversationParams = new URLSearchParams()

      if (friendlyName) conversationParams.append('FriendlyName', friendlyName)
      if (uniqueName) conversationParams.append('UniqueName', uniqueName)
      if (attributes) conversationParams.append('Attributes', attributes)

      const conversation = await this.#apiRequest({
        url: `${ CONVERSATIONS_BASE_URL }/Conversations`,
        method: 'post',
        body: conversationParams.toString(),
        logTag: 'startConversation',
      })

      logger.info(`[startConversation] Created conversation: ${ conversation.sid }`)

      const participants = []

      // Add participants if provided
      if (participantPhones && proxyPhone) {
        const phoneNumbers = participantPhones.split(',').map(p => p.trim()).filter(Boolean)

        for (const phoneNumber of phoneNumbers) {
          const participantParams = new URLSearchParams()
          participantParams.append('MessagingBinding.Address', phoneNumber)
          participantParams.append('MessagingBinding.ProxyAddress', proxyPhone)

          const participant = await this.#apiRequest({
            url: `${ CONVERSATIONS_BASE_URL }/Conversations/${ conversation.sid }/Participants`,
            method: 'post',
            body: participantParams.toString(),
            logTag: 'startConversation',
          })

          participants.push(participant)
          logger.debug(`[startConversation] Added participant: ${ phoneNumber }`)
        }
      }

      return {
        conversation,
        participants,
      }
    } catch (error) {
      logger.error(`[startConversation] Failed to start conversation: ${ error.message }`)
      throw error
    }
  }

  /**
   * @operationName Add Conversation Participant (SMS)
   * @category Conversations
   * @appearanceColor #F22F46 #FF6B7A
   * @description Adds an SMS participant to an existing conversation. The participant will receive messages via SMS.
   * @route POST /add-conversation-participant-sms
   * @paramDef {"type":"String","label":"Conversation SID","name":"conversationSid","required":true,"dictionary":"getConversationsDictionary","description":"The unique identifier of the conversation."}
   * @paramDef {"type":"String","label":"Participant Phone Number","name":"messagingBindingAddress","required":true,"description":"The participant's phone number in E.164 format (e.g., +1234567890)."}
   * @paramDef {"type":"String","label":"Proxy Phone Number","name":"messagingBindingProxyAddress","required":true,"dictionary":"getPhoneNumbersDictionary","description":"Your Twilio phone number to use as the conversation proxy."}
   * @paramDef {"type":"String","label":"Attributes","name":"attributes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional JSON metadata for the participant."}
   * @returns {Object}
   * @sampleResult {"sid":"MB1234567890abcdef","conversation_sid":"CH123","messaging_binding":{"address":"+1234567890","proxy_address":"+0987654321","type":"sms"},"date_created":"2024-01-15T10:30:00Z"}
   */
  async addConversationParticipantSms(conversationSid, messagingBindingAddress, messagingBindingProxyAddress, attributes) {
    const params = new URLSearchParams()
    params.append('MessagingBinding.Address', messagingBindingAddress)
    params.append('MessagingBinding.ProxyAddress', messagingBindingProxyAddress)

    if (attributes) params.append('Attributes', attributes)

    return this.#apiRequest({
      url: `${ CONVERSATIONS_BASE_URL }/Conversations/${ conversationSid }/Participants`,
      method: 'post',
      body: params.toString(),
      logTag: 'addConversationParticipantSms',
    })
  }

  /**
   * @operationName Add Message to Conversation
   * @category Conversations
   * @appearanceColor #F22F46 #FF6B7A
   * @description Adds a new message to an existing conversation.
   * @route POST /add-conversation-message
   * @paramDef {"type":"String","label":"Conversation SID","name":"conversationSid","required":true,"dictionary":"getConversationsDictionary","description":"The unique identifier of the conversation."}
   * @paramDef {"type":"String","label":"Message Body","name":"body","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The text content of the message (max 1,600 characters)."}
   * @paramDef {"type":"String","label":"Author","name":"author","description":"The identity of the message author."}
   * @paramDef {"type":"String","label":"Attributes","name":"attributes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional JSON metadata for the message."}
   * @returns {Object}
   * @sampleResult {"sid":"IM1234567890abcdef","conversation_sid":"CH123","body":"Hello from the conversation!","author":"user123","date_created":"2024-01-15T10:30:00Z","index":0}
   */
  async addConversationMessage(conversationSid, body, author, attributes) {
    const params = new URLSearchParams()

    if (body) params.append('Body', body)
    if (author) params.append('Author', author)
    if (attributes) params.append('Attributes', attributes)

    return this.#apiRequest({
      url: `${ CONVERSATIONS_BASE_URL }/Conversations/${ conversationSid }/Messages`,
      method: 'post',
      body: params.toString(),
      logTag: 'addConversationMessage',
    })
  }

  /**
   * @operationName Get Conversation Messages
   * @category Conversations
   * @appearanceColor #F22F46 #FF6B7A
   * @description Retrieves a list of messages from a specific conversation.
   * @route POST /get-conversation-messages
   * @paramDef {"type":"String","label":"Conversation SID","name":"conversationSid","required":true,"dictionary":"getConversationsDictionary","description":"The unique identifier of the conversation."}
   * @paramDef {"type":"String","label":"Order","name":"order","uiComponent":{"type":"DROPDOWN","options":{"values":["asc","desc"]}},"default":"asc","description":"Sort order for messages by date created."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","default":50,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of messages to retrieve per page. Can range from 1 to 100 items."}
   * @returns {Object}
   * @sampleResult {"messages":[{"sid":"IM123","conversation_sid":"CH123","body":"Hello!","author":"user123","date_created":"2024-01-15T10:30:00Z","index":0}],"meta":{"page":0,"page_size":50}}
   */
  async getConversationMessages(conversationSid, order, pageSize) {
    const params = {
      PageSize: pageSize || PAGE_SIZE_DICTIONARY,
    }

    if (order) params.Order = order

    return this.#apiRequest({
      url: `${ CONVERSATIONS_BASE_URL }/Conversations/${ conversationSid }/Messages`,
      query: params,
      logTag: 'getConversationMessages',
    })
  }

  /**
   * @operationName Delete Conversation Message
   * @category Conversations
   * @appearanceColor #F22F46 #FF6B7A
   * @description Deletes a specific message from a conversation.
   * @route POST /delete-conversation-message
   * @paramDef {"type":"String","label":"Conversation SID","name":"conversationSid","required":true,"dictionary":"getConversationsDictionary","description":"The unique identifier of the conversation."}
   * @paramDef {"type":"String","label":"Message SID","name":"messageSid","required":true,"description":"The unique identifier of the message to delete."}
   * @returns {Object}
   * @sampleResult {"success":true,"message":"Message deleted successfully"}
   */
  async deleteConversationMessage(conversationSid, messageSid) {
    try {
      await this.#apiRequest({
        url: `${ CONVERSATIONS_BASE_URL }/Conversations/${ conversationSid }/Messages/${ messageSid }`,
        method: 'delete',
        logTag: 'deleteConversationMessage',
      })

      return {
        success: true,
        message: 'Message deleted successfully',
      }
    } catch (error) {
      logger.error(`[deleteConversationMessage] Failed to delete message: ${ error.message }`)
      throw error
    }
  }

  /**
   * @operationName List Calls
   * @category Voice
   * @appearanceColor #F22F46 #FF6B7A
   * @description Retrieves a list of voice calls from your Twilio account with optional filtering.
   * @route POST /list-calls
   * @paramDef {"type":"String","label":"To Phone Number","name":"to","description":"Filter calls made to this phone number."}
   * @paramDef {"type":"String","label":"From Phone Number","name":"from","description":"Filter calls made from this phone number."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["queued","ringing","in-progress","completed","busy","failed","no-answer","canceled"]}},"description":"Filter calls by their status."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","default":50,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of calls to retrieve per page. Can range from 1 to 1000 items."}
   * @returns {Object}
   * @sampleResult {"calls":[{"sid":"CA123","status":"completed","to":"+1234567890","from":"+0987654321","duration":"45","price":"-0.02","start_time":"2024-01-15T10:30:00Z"}],"page":0,"page_size":50}
   */
  async listCalls(to, from, status, pageSize) {
    const params = {
      PageSize: pageSize || PAGE_SIZE_DICTIONARY,
    }

    if (to) params.To = to
    if (from) params.From = from
    if (status) params.Status = status

    return this.#apiRequest({
      url: `${ API_BASE_URL }/Accounts/${ this.accountSid }/Calls.json`,
      query: params,
      logTag: 'listCalls',
    })
  }

  /**
   * @operationName List Phone Numbers
   * @category Phone Numbers
   * @appearanceColor #F22F46 #FF6B7A
   * @description Retrieves all phone numbers associated with your Twilio account.
   * @route POST /list-phone-numbers
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","default":50,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of phone numbers to retrieve per page. Can range from 1 to 1000 items."}
   * @returns {Object}
   * @sampleResult {"incoming_phone_numbers":[{"sid":"PN123","phone_number":"+1234567890","friendly_name":"Main Line","capabilities":{"voice":true,"sms":true,"mms":true}}],"page":0,"page_size":50}
   */
  async listPhoneNumbers(pageSize) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/Accounts/${ this.accountSid }/IncomingPhoneNumbers.json`,
      query: { PageSize: pageSize || PAGE_SIZE_DICTIONARY },
      logTag: 'listPhoneNumbers',
    })
  }

  /**
   * @operationName Get Account Info
   * @category Account
   * @appearanceColor #F22F46 #FF6B7A
   * @description Retrieves information about your Twilio account including balance and status.
   * @route POST /get-account-info
   * @returns {Object}
   * @sampleResult {"sid":"AC123","friendly_name":"My Account","status":"active","type":"Full","date_created":"2024-01-01T00:00:00Z","auth_token":"[REDACTED]"}
   */
  async getAccountInfo() {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/Accounts/${ this.accountSid }.json`,
      logTag: 'getAccountInfo',
    })
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Phone Numbers Dictionary
   * @description Provides a searchable list of Twilio phone numbers for dynamic parameter selection.
   * @route POST /get-phone-numbers-dictionary
   * @paramDef {"type":"getPhoneNumbersDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering phone numbers."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"+1234567890 (Main Line)","value":"+1234567890","note":"Capabilities: SMS, Voice, MMS"}],"cursor":null}
   */
  async getPhoneNumbersDictionary(payload) {
    const { search, cursor } = payload || {}

    const response = await this.#apiRequest({
      url: cursor || `${ API_BASE_URL }/Accounts/${ this.accountSid }/IncomingPhoneNumbers.json`,
      query: cursor ? null : { PageSize: PAGE_SIZE_DICTIONARY },
      logTag: 'getPhoneNumbersDictionary',
    })

    const phoneNumbers = response.incoming_phone_numbers || []
    const filteredNumbers = search
      ? searchFilter(phoneNumbers, ['phone_number', 'friendly_name'], search)
      : phoneNumbers

    return {
      cursor: response.next_page_uri ? `${ BASE_URL }${ response.next_page_uri }` : null,
      items: filteredNumbers.map(number => ({
        label: number.friendly_name ? number.friendly_name : number.phone_number,
        value: number.phone_number,
        note: `${ number.phone_number } (${ [
          number.capabilities?.sms && 'SMS',
          number.capabilities?.voice && 'Voice',
          number.capabilities?.mms && 'MMS',
        ].filter(Boolean).join(', ') })`,
      })),
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Messages Dictionary
   * @description Provides a searchable list of SMS/MMS messages for dynamic parameter selection.
   * @route POST /get-messages-dictionary
   * @paramDef {"type":"getMessagesDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering messages."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"To: +1234567890 - Hello there!","value":"SM1234567890abcdef","note":"Status: delivered, Sent: 2024-01-15"}],"cursor":null}
   */
  async getMessagesDictionary(payload) {
    const { search, cursor } = payload || {}

    const response = await this.#apiRequest({
      url: cursor || `${ API_BASE_URL }/Accounts/${ this.accountSid }/Messages.json`,
      query: cursor ? null : { PageSize: PAGE_SIZE_DICTIONARY },
      logTag: 'getMessagesDictionary',
    })

    const messages = response.messages || []
    const filteredMessages = search
      ? searchFilter(messages, ['to', 'from', 'body', 'status'], search)
      : messages

    return {
      cursor: response.next_page_uri ? `${ BASE_URL }${ response.next_page_uri }` : null,
      items: filteredMessages.map(message => ({
        label: `To: ${ message.to } - ${ message.body?.substring(0, 50) }${ message.body?.length > 50 ? '...' : '' }`,
        value: message.sid,
        note: `Status: ${ message.status }, Sent: ${ message.date_sent?.split('T')[0] }`,
      })),
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Calls Dictionary
   * @description Provides a searchable list of voice calls for dynamic parameter selection.
   * @route POST /get-calls-dictionary
   * @paramDef {"type":"getCallsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering calls."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"To: +1234567890 - Duration: 45s","value":"CA1234567890abcdef","note":"Status: completed, Started: 2024-01-15"}],"cursor":null}
   */
  async getCallsDictionary(payload) {
    const { search, cursor } = payload || {}

    const response = await this.#apiRequest({
      url: cursor || `${ API_BASE_URL }/Accounts/${ this.accountSid }/Calls.json`,
      query: cursor ? null : { PageSize: PAGE_SIZE_DICTIONARY },
      logTag: 'getCallsDictionary',
    })

    const calls = response.calls || []
    const filteredCalls = search
      ? searchFilter(calls, ['to', 'from', 'status'], search)
      : calls

    return {
      cursor: response.next_page_uri ? `${ BASE_URL }${ response.next_page_uri }` : null,
      items: filteredCalls.map(call => ({
        label: `To: ${ call.to } - Duration: ${ call.duration || 0 }s`,
        value: call.sid,
        note: `Status: ${ call.status }, Started: ${ call.start_time?.split('T')[0] }`,
      })),
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Conversations Dictionary
   * @description Provides a searchable list of conversations for dynamic parameter selection.
   * @route POST /get-conversations-dictionary
   * @paramDef {"type":"getConversationsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering conversations."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Customer Support","value":"CH1234567890abcdef","note":"Unique Name: support-001, State: active"}],"cursor":null}
   */
  async getConversationsDictionary(payload) {
    const { search, cursor } = payload || {}

    const response = await this.#apiRequest({
      url: cursor || `${ CONVERSATIONS_BASE_URL }/Conversations`,
      query: cursor ? null : { PageSize: PAGE_SIZE_DICTIONARY },
      logTag: 'getConversationsDictionary',
    })

    const conversations = response.conversations || []
    const filteredConversations = search
      ? searchFilter(conversations, ['friendly_name', 'unique_name', 'state'], search)
      : conversations

    return {
      cursor: response.meta?.next_page_url || null,
      items: filteredConversations.map(conversation => ({
        label: conversation.friendly_name || conversation.unique_name || conversation.sid,
        value: conversation.sid,
        note: `${ conversation.unique_name ? `Unique Name: ${ conversation.unique_name }, ` : '' }State: ${ conversation.state || 'unknown' }`,
      })),
    }
  }

  /**
   * @operationName On New SMS
   * @category Messaging
   * @appearanceColor #F22F46 #FF6B7A
   * @description Triggered when a new SMS message is received on any of your Twilio phone numbers.
   * @route POST /on-new-sms
   * @registerAs REALTIME_TRIGGER
   * @paramDef {"type":"String","label":"Phone Number","name":"phoneNumber","dictionary":"getPhoneNumbersDictionary","description":"Only trigger for messages received on this specific phone number. Leave empty to trigger for all numbers."}
   * @returns {Object}
   * @sampleResult {"MessageSid":"SM1234567890abcdef","From":"+1234567890","To":"+0987654321","Body":"Hello from SMS!","MessageStatus":"received","DateSent":"2024-01-15T10:30:00Z"}
   */
  async onNewSms(callType, payload) {
    if (callType === MethodCallTypes.SHAPE_EVENT) {
      return [
        {
          name: 'onNewSms',
          data: payload,
        },
      ]
    }

    if (callType === MethodCallTypes.FILTER_TRIGGER) {
      const triggersToActivate = payload.triggers
        .filter(({ data }) => {
          if (!data.phoneNumber) {
            return true
          }

          return data.phoneNumber === payload.eventData.To
        })
        .map(({ id }) => id)

      logger.debug(`onNewSms.triggersIdsToActivate: ${ JSON.stringify(triggersToActivate) }`)

      return {
        ids: triggersToActivate,
      }
    }
  }

  /**
   * @operationName On New Call
   * @category Voice
   * @appearanceColor #F22F46 #FF6B7A
   * @description Triggered when a new voice call is received on any of your Twilio phone numbers.
   * @route POST /on-new-call
   * @registerAs REALTIME_TRIGGER
   * @paramDef {"type":"String","label":"Phone Number","name":"phoneNumber","dictionary":"getPhoneNumbersDictionary","description":"Only trigger for calls received on this specific phone number. Leave empty to trigger for all numbers."}
   * @returns {Object}
   * @sampleResult {"CallSid":"CA1234567890abcdef","From":"+1234567890","To":"+0987654321","CallStatus":"ringing","Direction":"inbound","DateCreated":"2024-01-15T10:30:00Z"}
   */
  async onNewCall(callType, payload) {
    if (callType === MethodCallTypes.SHAPE_EVENT) {
      return [
        {
          name: 'onNewCall',
          data: payload,
        },
      ]
    }

    if (callType === MethodCallTypes.FILTER_TRIGGER) {
      const triggersToActivate = payload.triggers
        .filter(({ data }) => {
          if (!data.phoneNumber) {
            return true
          }

          return data.phoneNumber === payload.eventData.To
        })
        .map(({ id }) => id)

      logger.debug(`onNewCall.triggersIdsToActivate: ${ JSON.stringify(triggersToActivate) }`)

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

      // For Twilio, we need to set webhooks on incoming phone numbers
      // This is a simplified implementation - in production you'd want to manage webhooks per phone number
      const phoneNumbers = await this.#apiRequest({
        url: `${ API_BASE_URL }/Accounts/${ this.accountSid }/IncomingPhoneNumbers.json`,
        logTag: 'handleTriggerUpsertWebhook',
      })

      // Set webhook URL for the first phone number as an example
      // In a full implementation, you'd manage this more granularly
      if (phoneNumbers.incoming_phone_numbers && phoneNumbers.incoming_phone_numbers.length > 0) {
        const phoneNumber = phoneNumbers.incoming_phone_numbers[0]

        const params = new URLSearchParams()
        params.append('SmsUrl', callbackUrl)
        params.append('VoiceUrl', callbackUrl)

        await this.#apiRequest({
          url: `${ API_BASE_URL }/Accounts/${ this.accountSid }/IncomingPhoneNumbers/${ phoneNumber.sid }.json`,
          method: 'post',
          body: params.toString(),
          logTag: 'handleTriggerUpsertWebhook',
        })
      }

      logger.info('[handleTriggerUpsertWebhook] Webhook set successfully')

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

    // Check if it's an SMS webhook
    if (body.MessageSid) {
      events = await this.onNewSms(MethodCallTypes.SHAPE_EVENT, invocation.body)
    } else if (body.CallSid) {// Check if it's a Voice webhook
      events = await this.onNewCall(MethodCallTypes.SHAPE_EVENT, invocation.body)
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

      // Get phone numbers and remove webhook URLs
      const phoneNumbers = await this.#apiRequest({
        url: `${ API_BASE_URL }/Accounts/${ this.accountSid }/IncomingPhoneNumbers.json`,
        logTag: 'handleTriggerDeleteWebhook',
      })

      // Remove webhook URLs from phone numbers
      for (const phoneNumber of phoneNumbers.incoming_phone_numbers || []) {
        const params = new URLSearchParams()
        params.append('SmsUrl', '')
        params.append('VoiceUrl', '')

        await this.#apiRequest({
          url: `${ API_BASE_URL }/Accounts/${ this.accountSid }/IncomingPhoneNumbers/${ phoneNumber.sid }.json`,
          method: 'post',
          body: params.toString(),
          logTag: 'handleTriggerDeleteWebhook',
        })
      }

      logger.info('[handleTriggerDeleteWebhook] Webhooks deleted successfully')

      return {}
    } catch (error) {
      logger.error('[handleTriggerDeleteWebhook] Failed to delete webhooks', error)
      throw error
    }
  }
}

Flowrunner.ServerCode.addService(TwilioService, [
  {
    name: 'accountSid',
    displayName: 'Account SID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    hint: 'Your Twilio Account SID. Find it in your Twilio Console Dashboard.',
  },
  {
    name: 'authToken',
    displayName: 'Auth Token',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    hint: 'Your Twilio Auth Token. Find it in your Twilio Console Dashboard. Keep this secure!',
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

  Object.keys(data).forEach(key => {
    if (data[key] === undefined || data[key] === null) {
      delete data[key]
    }
  })

  return data
}