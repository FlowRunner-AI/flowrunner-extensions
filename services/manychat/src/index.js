const logger = {
  info: (...args) => console.log('[ManyChat] info:', ...args),
  debug: (...args) => console.log('[ManyChat] debug:', ...args),
  error: (...args) => console.log('[ManyChat] error:', ...args),
  warn: (...args) => console.log('[ManyChat] warn:', ...args),
}

const API_BASE_URL = 'https://api.manychat.com'

const MESSAGE_TAG_MAP = {
  'Account Update': 'ACCOUNT_UPDATE',
  'Confirmed Event Update': 'CONFIRMED_EVENT_UPDATE',
  'Post-Purchase Update': 'POST_PURCHASE_UPDATE',
  'Human Agent': 'HUMAN_AGENT',
}

const GENDER_MAP = {
  'Male': 'male',
  'Female': 'female',
}

const FIELD_TYPE_MAP = {
  'Text': 'text',
  'Number': 'number',
  'Date': 'date',
  'Date & Time': 'datetime',
  'Boolean': 'boolean',
}

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
 * @integrationName ManyChat
 * @integrationIcon /icon.png
 */
class ManyChatService {
  constructor(config) {
    this.apiKey = config.apiKey
  }

  // Single request helper. ManyChat responds with { status: "success", data: {...} };
  // this unwraps "data" (or returns { success: true } when there is no payload) and
  // surfaces { status: "error" } responses as thrown errors.
  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - API request: [${ method.toUpperCase() }::${ url }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Authorization': `Bearer ${ this.apiKey }`,
          'Content-Type': 'application/json',
        })
        .query(cleanedQuery || {})

      const response = body !== undefined ? await request.send(body) : await request

      if (response && response.status === 'error') {
        throw new Error(this.#formatApiError(response))
      }

      if (response && response.data !== undefined) {
        return response.data
      }

      return { success: true }
    } catch (error) {
      if (error.message && error.message.startsWith('ManyChat API error:')) {
        throw error
      }

      const message = this.#formatApiError(error.body) ||
        `ManyChat API error: ${ typeof error.message === 'string' ? error.message : JSON.stringify(error.message) }`

      logger.error(`${ logTag } - Request failed: ${ message }`)

      throw new Error(message)
    }
  }

  #formatApiError(body) {
    if (!body || (body.status !== 'error' && !body.message)) {
      return null
    }

    const parts = []

    if (body.message) {
      parts.push(body.message)
    }

    if (body.details) {
      parts.push(JSON.stringify(body.details))
    }

    return `ManyChat API error: ${ parts.join(' - ') || 'Unknown error' }`
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  #buildContentData(messageText, content) {
    if (content) {
      return { version: 'v2', content }
    }

    if (messageText) {
      return {
        version: 'v2',
        content: {
          messages: [{ type: 'text', text: messageText }],
          actions: [],
          quick_replies: [],
        },
      }
    }

    throw new Error('ManyChat API error: Either Message Text or Raw Content must be provided')
  }

  #filterDictionaryItems(items, search) {
    if (!search) {
      return items
    }

    const term = search.toLowerCase()

    return items.filter(item => item.label.toLowerCase().includes(term))
  }

  // ---------------------------------------------------------------------------
  // Subscribers
  // ---------------------------------------------------------------------------

  /**
   * @operationName Get Subscriber
   * @category Subscribers
   * @description Retrieves full profile information for a subscriber by ID, including name, gender, locale, channel identifiers (Messenger, Instagram, WhatsApp, phone, email), opt-in statuses, subscription timestamps, custom field values, and tags. Works for subscribers on any connected channel.
   * @route GET /get-subscriber
   *
   * @paramDef {"type":"String","label":"Subscriber ID","name":"subscriberId","required":true,"description":"The ManyChat subscriber ID."}
   *
   * @returns {Object}
   * @sampleResult {"id":"1017391471234567","page_id":"1234567890","first_name":"John","last_name":"Doe","name":"John Doe","gender":"male","locale":"en_US","language":"English","timezone":"UTC-05","live_chat_url":"https://manychat.com/fb1234567890/chat/1017391471234567","last_input_text":"Hi there","optin_phone":true,"phone":"+15551234567","optin_email":true,"email":"john@example.com","subscribed":"2025-01-15T10:00:00+00:00","last_interaction":"2025-06-01T12:30:00+00:00","whatsapp_phone":"+15551234567","optin_whatsapp":true,"custom_fields":[{"id":11,"name":"Order ID","type":"text","description":"","value":"A-1001"}],"tags":[{"id":101,"name":"vip"}]}
   */
  async getSubscriber(subscriberId) {
    const logTag = '[getSubscriber]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/fb/subscriber/getInfo`,
      method: 'get',
      query: { subscriber_id: subscriberId },
    })
  }

  /**
   * @operationName Find Subscribers by Name
   * @category Subscribers
   * @description Searches subscribers whose full name matches the given text and returns a list of matching subscriber profiles. Useful for locating a subscriber when you only know their display name.
   * @route GET /find-subscribers-by-name
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Full or partial subscriber name to search for, e.g. \"John Doe\"."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":"1017391471234567","page_id":"1234567890","first_name":"John","last_name":"Doe","name":"John Doe","gender":"male","subscribed":"2025-01-15T10:00:00+00:00","last_interaction":"2025-06-01T12:30:00+00:00","email":"john@example.com","phone":"+15551234567","tags":[{"id":101,"name":"vip"}]}]
   */
  async findSubscribersByName(name) {
    const logTag = '[findSubscribersByName]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/fb/subscriber/findByName`,
      method: 'get',
      query: { name },
    })
  }

  /**
   * @operationName Find Subscriber by System Field
   * @category Subscribers
   * @description Finds a subscriber by email address or phone number (system fields). Provide at least one of the two; if both are given, ManyChat matches on either. Returns the matching subscriber profile or an empty result when no subscriber matches.
   * @route GET /find-subscriber-by-system-field
   *
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Email address to search by, e.g. test@example.com. Provide this and/or Phone."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"Phone number to search by in international format, e.g. +15551234567. Provide this and/or Email."}
   *
   * @returns {Object}
   * @sampleResult {"id":"1017391471234567","page_id":"1234567890","first_name":"John","last_name":"Doe","name":"John Doe","email":"john@example.com","phone":"+15551234567","optin_email":true,"optin_phone":true,"subscribed":"2025-01-15T10:00:00+00:00","tags":[{"id":101,"name":"vip"}]}
   */
  async findSubscriberBySystemField(email, phone) {
    const logTag = '[findSubscriberBySystemField]'

    if (!email && !phone) {
      throw new Error('ManyChat API error: Either Email or Phone must be provided')
    }

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/fb/subscriber/findBySystemField`,
      method: 'get',
      query: { email, phone },
    })
  }

  /**
   * @operationName Find Subscribers by Custom Field
   * @category Subscribers
   * @description Finds subscribers whose custom field exactly matches the given value. Select the custom field and provide the value to match; returns a list of matching subscriber profiles.
   * @route GET /find-subscribers-by-custom-field
   *
   * @paramDef {"type":"Number","label":"Custom Field","name":"fieldId","required":true,"dictionary":"getCustomFieldsDictionary","description":"The custom field to search by. Select a field or provide its numeric ID."}
   * @paramDef {"type":"String","label":"Field Value","name":"fieldValue","required":true,"description":"The exact value to match against the selected custom field."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":"1017391471234567","page_id":"1234567890","first_name":"John","last_name":"Doe","name":"John Doe","subscribed":"2025-01-15T10:00:00+00:00","custom_fields":[{"id":11,"name":"Order ID","type":"text","description":"","value":"A-1001"}]}]
   */
  async findSubscribersByCustomField(fieldId, fieldValue) {
    const logTag = '[findSubscribersByCustomField]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/fb/subscriber/findByCustomField`,
      method: 'get',
      query: {
        field_id: Number(fieldId),
        field_value: fieldValue,
      },
    })
  }

  /**
   * @operationName Create Subscriber
   * @category Subscribers
   * @description Creates a new subscriber in ManyChat for phone-based channels (WhatsApp and SMS). Messenger and Instagram subscribers cannot be created via the API - they must opt in through the channel itself. Provide a phone or WhatsApp phone plus any profile details; record the consent phrase your business collected for compliance.
   * @route POST /create-subscriber
   *
   * @paramDef {"type":"String","label":"First Name","name":"firstName","description":"Subscriber's first name."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","description":"Subscriber's last name."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"Phone number in international format, e.g. +15551234567. Used for the SMS channel."}
   * @paramDef {"type":"String","label":"WhatsApp Phone","name":"whatsappPhone","description":"WhatsApp phone number in international format, e.g. +15551234567. Used for the WhatsApp channel."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Subscriber's email address."}
   * @paramDef {"type":"String","label":"Gender","name":"gender","uiComponent":{"type":"DROPDOWN","options":{"values":["Male","Female"]}},"description":"Subscriber's gender."}
   * @paramDef {"type":"Boolean","label":"SMS Opt-In","name":"hasOptInSms","uiComponent":{"type":"TOGGLE"},"description":"Whether the subscriber consented to receive SMS messages."}
   * @paramDef {"type":"Boolean","label":"Email Opt-In","name":"hasOptInEmail","uiComponent":{"type":"TOGGLE"},"description":"Whether the subscriber consented to receive emails."}
   * @paramDef {"type":"String","label":"Consent Phrase","name":"consentPhrase","description":"The exact consent phrase the subscriber agreed to, stored for compliance records."}
   *
   * @returns {Object}
   * @sampleResult {"id":"9876543210987654","page_id":"1234567890","first_name":"Jane","last_name":"Smith","name":"Jane Smith","gender":"female","phone":"+15559876543","optin_phone":true,"email":"jane@example.com","optin_email":true,"whatsapp_phone":"+15559876543","optin_whatsapp":true,"subscribed":"2025-06-15T09:00:00+00:00","custom_fields":[],"tags":[]}
   */
  async createSubscriber(firstName, lastName, phone, whatsappPhone, email, gender, hasOptInSms, hasOptInEmail, consentPhrase) {
    const logTag = '[createSubscriber]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/fb/subscriber/createSubscriber`,
      method: 'post',
      body: clean({
        first_name: firstName,
        last_name: lastName,
        phone,
        whatsapp_phone: whatsappPhone,
        email,
        gender: this.#resolveChoice(gender, GENDER_MAP),
        has_opt_in_sms: hasOptInSms,
        has_opt_in_email: hasOptInEmail,
        consent_phrase: consentPhrase,
      }),
    })
  }

  /**
   * @operationName Update Subscriber
   * @category Subscribers
   * @description Updates profile details of an existing subscriber - name, phone, email, gender, SMS/email opt-in flags, and consent phrase. Only the fields you provide are changed; all others keep their current values.
   * @route PUT /update-subscriber
   *
   * @paramDef {"type":"String","label":"Subscriber ID","name":"subscriberId","required":true,"description":"The ManyChat subscriber ID to update."}
   * @paramDef {"type":"String","label":"First Name","name":"firstName","description":"New first name."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","description":"New last name."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"New phone number in international format, e.g. +15551234567."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"New email address."}
   * @paramDef {"type":"String","label":"Gender","name":"gender","uiComponent":{"type":"DROPDOWN","options":{"values":["Male","Female"]}},"description":"Subscriber's gender."}
   * @paramDef {"type":"Boolean","label":"SMS Opt-In","name":"hasOptInSms","uiComponent":{"type":"TOGGLE"},"description":"Whether the subscriber consented to receive SMS messages."}
   * @paramDef {"type":"Boolean","label":"Email Opt-In","name":"hasOptInEmail","uiComponent":{"type":"TOGGLE"},"description":"Whether the subscriber consented to receive emails."}
   * @paramDef {"type":"String","label":"Consent Phrase","name":"consentPhrase","description":"The exact consent phrase the subscriber agreed to, stored for compliance records."}
   *
   * @returns {Object}
   * @sampleResult {"id":"1017391471234567","page_id":"1234567890","first_name":"John","last_name":"Doe","name":"John Doe","gender":"male","phone":"+15551234567","optin_phone":true,"email":"john@example.com","optin_email":true,"subscribed":"2025-01-15T10:00:00+00:00","custom_fields":[],"tags":[{"id":101,"name":"vip"}]}
   */
  async updateSubscriber(subscriberId, firstName, lastName, phone, email, gender, hasOptInSms, hasOptInEmail, consentPhrase) {
    const logTag = '[updateSubscriber]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/fb/subscriber/updateSubscriber`,
      method: 'post',
      body: clean({
        subscriber_id: subscriberId,
        first_name: firstName,
        last_name: lastName,
        phone,
        email,
        gender: this.#resolveChoice(gender, GENDER_MAP),
        has_opt_in_sms: hasOptInSms,
        has_opt_in_email: hasOptInEmail,
        consent_phrase: consentPhrase,
      }),
    })
  }

  // ---------------------------------------------------------------------------
  // Tagging
  // ---------------------------------------------------------------------------

  /**
   * @operationName Add Tag to Subscriber
   * @category Tagging
   * @description Applies an existing tag to a subscriber, selected by tag ID. Tags can be used for segmentation, automation conditions, and triggering flows.
   * @route POST /add-tag-to-subscriber
   *
   * @paramDef {"type":"String","label":"Subscriber ID","name":"subscriberId","required":true,"description":"The ManyChat subscriber ID."}
   * @paramDef {"type":"Number","label":"Tag","name":"tagId","required":true,"dictionary":"getTagsDictionary","description":"The tag to apply. Select a tag or provide its numeric ID."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async addTagToSubscriber(subscriberId, tagId) {
    const logTag = '[addTagToSubscriber]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/fb/subscriber/addTag`,
      method: 'post',
      body: {
        subscriber_id: subscriberId,
        tag_id: Number(tagId),
      },
    })
  }

  /**
   * @operationName Add Tag to Subscriber by Name
   * @category Tagging
   * @description Applies a tag to a subscriber by tag name instead of ID. The tag must already exist in the ManyChat account - use Create Tag first if needed.
   * @route POST /add-tag-to-subscriber-by-name
   *
   * @paramDef {"type":"String","label":"Subscriber ID","name":"subscriberId","required":true,"description":"The ManyChat subscriber ID."}
   * @paramDef {"type":"String","label":"Tag Name","name":"tagName","required":true,"description":"The exact name of an existing tag, e.g. \"vip\"."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async addTagToSubscriberByName(subscriberId, tagName) {
    const logTag = '[addTagToSubscriberByName]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/fb/subscriber/addTagByName`,
      method: 'post',
      body: {
        subscriber_id: subscriberId,
        tag_name: tagName,
      },
    })
  }

  /**
   * @operationName Remove Tag from Subscriber
   * @category Tagging
   * @description Removes a tag from a subscriber, selected by tag ID. The tag itself remains in the account and stays applied to other subscribers.
   * @route POST /remove-tag-from-subscriber
   *
   * @paramDef {"type":"String","label":"Subscriber ID","name":"subscriberId","required":true,"description":"The ManyChat subscriber ID."}
   * @paramDef {"type":"Number","label":"Tag","name":"tagId","required":true,"dictionary":"getTagsDictionary","description":"The tag to remove. Select a tag or provide its numeric ID."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async removeTagFromSubscriber(subscriberId, tagId) {
    const logTag = '[removeTagFromSubscriber]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/fb/subscriber/removeTag`,
      method: 'post',
      body: {
        subscriber_id: subscriberId,
        tag_id: Number(tagId),
      },
    })
  }

  /**
   * @operationName Remove Tag from Subscriber by Name
   * @category Tagging
   * @description Removes a tag from a subscriber by tag name instead of ID. The tag itself remains in the account and stays applied to other subscribers.
   * @route POST /remove-tag-from-subscriber-by-name
   *
   * @paramDef {"type":"String","label":"Subscriber ID","name":"subscriberId","required":true,"description":"The ManyChat subscriber ID."}
   * @paramDef {"type":"String","label":"Tag Name","name":"tagName","required":true,"description":"The exact name of the tag to remove, e.g. \"vip\"."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async removeTagFromSubscriberByName(subscriberId, tagName) {
    const logTag = '[removeTagFromSubscriberByName]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/fb/subscriber/removeTagByName`,
      method: 'post',
      body: {
        subscriber_id: subscriberId,
        tag_name: tagName,
      },
    })
  }

  /**
   * @operationName List Tags
   * @category Tagging
   * @description Retrieves all tags defined in the ManyChat account with their IDs and names.
   * @route GET /list-tags
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":101,"name":"vip"},{"id":102,"name":"newsletter"}]
   */
  async listTags() {
    const logTag = '[listTags]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/fb/page/getTags`,
      method: 'get',
    })
  }

  /**
   * @operationName Create Tag
   * @category Tagging
   * @description Creates a new tag in the ManyChat account. The tag can then be applied to subscribers with Add Tag to Subscriber.
   * @route POST /create-tag
   *
   * @paramDef {"type":"String","label":"Tag Name","name":"name","required":true,"description":"Name of the new tag, e.g. \"customer\"."}
   *
   * @returns {Object}
   * @sampleResult {"tag":{"id":103,"name":"customer"}}
   */
  async createTag(name) {
    const logTag = '[createTag]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/fb/page/createTag`,
      method: 'post',
      body: { name },
    })
  }

  /**
   * @operationName Delete Tag
   * @category Tagging
   * @description Permanently deletes a tag from the ManyChat account by ID, removing it from every subscriber it was applied to. This cannot be undone.
   * @route DELETE /delete-tag
   *
   * @paramDef {"type":"Number","label":"Tag","name":"tagId","required":true,"dictionary":"getTagsDictionary","description":"The tag to delete. Select a tag or provide its numeric ID."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async deleteTag(tagId) {
    const logTag = '[deleteTag]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/fb/page/removeTag`,
      method: 'post',
      body: { tag_id: Number(tagId) },
    })
  }

  /**
   * @operationName Delete Tag by Name
   * @category Tagging
   * @description Permanently deletes a tag from the ManyChat account by name, removing it from every subscriber it was applied to. This cannot be undone.
   * @route DELETE /delete-tag-by-name
   *
   * @paramDef {"type":"String","label":"Tag Name","name":"tagName","required":true,"description":"The exact name of the tag to delete, e.g. \"vip\"."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async deleteTagByName(tagName) {
    const logTag = '[deleteTagByName]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/fb/page/removeTagByName`,
      method: 'post',
      body: { tag_name: tagName },
    })
  }

  // ---------------------------------------------------------------------------
  // Custom Fields
  // ---------------------------------------------------------------------------

  /**
   * @operationName Set Custom Field
   * @category Custom Fields
   * @description Sets a custom field value on a subscriber, selected by field ID. The value should match the field's type: text, number, boolean (true/false), date (YYYY-MM-DD), or datetime (ISO 8601 such as 2025-07-02T00:00:00+00:00).
   * @route POST /set-custom-field
   *
   * @paramDef {"type":"String","label":"Subscriber ID","name":"subscriberId","required":true,"description":"The ManyChat subscriber ID."}
   * @paramDef {"type":"Number","label":"Custom Field","name":"fieldId","required":true,"dictionary":"getCustomFieldsDictionary","description":"The custom field to set. Select a field or provide its numeric ID."}
   * @paramDef {"type":"String","label":"Field Value","name":"fieldValue","required":true,"description":"The value to store. Match the field's type: text, number, true/false, YYYY-MM-DD for dates, or ISO 8601 for datetimes."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async setCustomField(subscriberId, fieldId, fieldValue) {
    const logTag = '[setCustomField]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/fb/subscriber/setCustomField`,
      method: 'post',
      body: {
        subscriber_id: subscriberId,
        field_id: Number(fieldId),
        field_value: fieldValue,
      },
    })
  }

  /**
   * @operationName Set Custom Field by Name
   * @category Custom Fields
   * @description Sets a custom field value on a subscriber by field name instead of ID. The value should match the field's type: text, number, boolean (true/false), date (YYYY-MM-DD), or datetime (ISO 8601).
   * @route POST /set-custom-field-by-name
   *
   * @paramDef {"type":"String","label":"Subscriber ID","name":"subscriberId","required":true,"description":"The ManyChat subscriber ID."}
   * @paramDef {"type":"String","label":"Field Name","name":"fieldName","required":true,"description":"The exact name of an existing custom field, e.g. \"Order ID\"."}
   * @paramDef {"type":"String","label":"Field Value","name":"fieldValue","required":true,"description":"The value to store. Match the field's type: text, number, true/false, YYYY-MM-DD for dates, or ISO 8601 for datetimes."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async setCustomFieldByName(subscriberId, fieldName, fieldValue) {
    const logTag = '[setCustomFieldByName]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/fb/subscriber/setCustomFieldByName`,
      method: 'post',
      body: {
        subscriber_id: subscriberId,
        field_name: fieldName,
        field_value: fieldValue,
      },
    })
  }

  /**
   * @operationName List Custom Fields
   * @category Custom Fields
   * @description Retrieves all subscriber custom fields defined in the ManyChat account with their IDs, names, types, and descriptions.
   * @route GET /list-custom-fields
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":11,"name":"Order ID","type":"text","description":"Latest order reference"},{"id":12,"name":"Loyalty Points","type":"number","description":""}]
   */
  async listCustomFields() {
    const logTag = '[listCustomFields]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/fb/page/getCustomFields`,
      method: 'get',
    })
  }

  /**
   * @operationName Create Custom Field
   * @category Custom Fields
   * @description Creates a new subscriber custom field in the ManyChat account. Choose the field type carefully - it cannot be changed after creation.
   * @route POST /create-custom-field
   *
   * @paramDef {"type":"String","label":"Field Name","name":"caption","required":true,"description":"Display name for the new custom field, e.g. \"Order ID\"."}
   * @paramDef {"type":"String","label":"Field Type","name":"type","required":true,"defaultValue":"Text","uiComponent":{"type":"DROPDOWN","options":{"values":["Text","Number","Date","Date & Time","Boolean"]}},"description":"Data type of the field."}
   * @paramDef {"type":"String","label":"Description","name":"description","description":"Optional description of what the field stores."}
   *
   * @returns {Object}
   * @sampleResult {"field":{"id":12,"name":"Loyalty Points","type":"number","description":"Reward balance"}}
   */
  async createCustomField(caption, type, description) {
    const logTag = '[createCustomField]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/fb/page/createCustomField`,
      method: 'post',
      body: clean({
        caption,
        type: this.#resolveChoice(type, FIELD_TYPE_MAP),
        description,
      }),
    })
  }

  // ---------------------------------------------------------------------------
  // Bot Fields
  // ---------------------------------------------------------------------------

  /**
   * @operationName Set Bot Field
   * @category Bot Fields
   * @description Sets the value of a bot field (a global variable shared across all subscribers), selected by field ID. The value should match the field's type: text, number, boolean (true/false), date (YYYY-MM-DD), or datetime (ISO 8601).
   * @route POST /set-bot-field
   *
   * @paramDef {"type":"Number","label":"Bot Field","name":"fieldId","required":true,"dictionary":"getBotFieldsDictionary","description":"The bot field to set. Select a field or provide its numeric ID."}
   * @paramDef {"type":"String","label":"Field Value","name":"fieldValue","required":true,"description":"The value to store. Match the field's type: text, number, true/false, YYYY-MM-DD for dates, or ISO 8601 for datetimes."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async setBotField(fieldId, fieldValue) {
    const logTag = '[setBotField]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/fb/page/setBotField`,
      method: 'post',
      body: {
        field_id: Number(fieldId),
        field_value: fieldValue,
      },
    })
  }

  /**
   * @operationName Set Bot Field by Name
   * @category Bot Fields
   * @description Sets the value of a bot field (a global variable shared across all subscribers) by field name instead of ID. The value should match the field's type: text, number, boolean (true/false), date (YYYY-MM-DD), or datetime (ISO 8601).
   * @route POST /set-bot-field-by-name
   *
   * @paramDef {"type":"String","label":"Field Name","name":"fieldName","required":true,"description":"The exact name of an existing bot field, e.g. \"promo_code\"."}
   * @paramDef {"type":"String","label":"Field Value","name":"fieldValue","required":true,"description":"The value to store. Match the field's type: text, number, true/false, YYYY-MM-DD for dates, or ISO 8601 for datetimes."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async setBotFieldByName(fieldName, fieldValue) {
    const logTag = '[setBotFieldByName]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/fb/page/setBotFieldByName`,
      method: 'post',
      body: {
        field_name: fieldName,
        field_value: fieldValue,
      },
    })
  }

  /**
   * @operationName List Bot Fields
   * @category Bot Fields
   * @description Retrieves all bot fields (global variables shared across all subscribers) defined in the ManyChat account, including their current values.
   * @route GET /list-bot-fields
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":21,"name":"support_email","type":"text","description":"Support contact shown in flows","value":"help@example.com"}]
   */
  async listBotFields() {
    const logTag = '[listBotFields]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/fb/page/getBotFields`,
      method: 'get',
    })
  }

  /**
   * @operationName Create Bot Field
   * @category Bot Fields
   * @description Creates a new bot field (a global variable shared across all subscribers) with an optional initial value. Choose the field type carefully - it cannot be changed after creation.
   * @route POST /create-bot-field
   *
   * @paramDef {"type":"String","label":"Field Name","name":"name","required":true,"description":"Name for the new bot field, e.g. \"promo_code\"."}
   * @paramDef {"type":"String","label":"Field Type","name":"type","required":true,"defaultValue":"Text","uiComponent":{"type":"DROPDOWN","options":{"values":["Text","Number","Date","Date & Time","Boolean"]}},"description":"Data type of the field."}
   * @paramDef {"type":"String","label":"Description","name":"description","description":"Optional description of what the field stores."}
   * @paramDef {"type":"String","label":"Initial Value","name":"initValue","description":"Optional initial value. Match the field's type: text, number, true/false, YYYY-MM-DD for dates, or ISO 8601 for datetimes."}
   *
   * @returns {Object}
   * @sampleResult {"field":{"id":22,"name":"promo_code","type":"text","description":"Current promotion code","value":"SPRING25"}}
   */
  async createBotField(name, type, description, initValue) {
    const logTag = '[createBotField]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/fb/page/createBotField`,
      method: 'post',
      body: clean({
        name,
        type: this.#resolveChoice(type, FIELD_TYPE_MAP),
        description,
        value: initValue,
      }),
    })
  }

  // ---------------------------------------------------------------------------
  // Sending
  // ---------------------------------------------------------------------------

  /**
   * @operationName Send Content
   * @category Sending
   * @description Sends a message to a subscriber on their channel. Provide Message Text for a simple text message, or Raw Content with a full ManyChat dynamic content object ({messages, actions, quick_replies}) for rich messages - Raw Content takes precedence when both are set. On Facebook Messenger, sending outside the 24-hour messaging window requires a Message Tag (or a One-Time Notification topic); on WhatsApp, messages outside the 24-hour service window must use pre-approved template messages. Rate limit: 25 requests per second.
   * @route POST /send-content
   *
   * @paramDef {"type":"String","label":"Subscriber ID","name":"subscriberId","required":true,"description":"The ManyChat subscriber ID to send the message to."}
   * @paramDef {"type":"String","label":"Message Text","name":"messageText","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Plain text message to send. Ignored when Raw Content is provided."}
   * @paramDef {"type":"Object","label":"Raw Content","name":"content","description":"Full ManyChat dynamic content object with messages, actions, and quick_replies arrays, per https://manychat.github.io/dynamic_block_docs/. Overrides Message Text. Example: {\"messages\":[{\"type\":\"text\",\"text\":\"Hello!\"}],\"actions\":[],\"quick_replies\":[]}"}
   * @paramDef {"type":"String","label":"Message Tag","name":"messageTag","uiComponent":{"type":"DROPDOWN","options":{"values":["Account Update","Confirmed Event Update","Post-Purchase Update","Human Agent"]}},"description":"Facebook message tag that permits sending outside the 24-hour messaging window. Required for Messenger messages sent outside the window."}
   * @paramDef {"type":"String","label":"OTN Topic Name","name":"otnTopicName","description":"One-Time Notification topic name to send under, as an alternative to a message tag for Messenger. The subscriber must have opted in to the topic."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async sendContent(subscriberId, messageText, content, messageTag, otnTopicName) {
    const logTag = '[sendContent]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/fb/sending/sendContent`,
      method: 'post',
      body: clean({
        subscriber_id: subscriberId,
        data: this.#buildContentData(messageText, content),
        message_tag: this.#resolveChoice(messageTag, MESSAGE_TAG_MAP),
        otn_topic_name: otnTopicName,
      }),
    })
  }

  /**
   * @operationName Send Flow
   * @category Sending
   * @description Starts an existing ManyChat flow for a subscriber, sending its first message immediately. Channel messaging rules still apply: on Facebook Messenger the 24-hour messaging window is enforced, and WhatsApp requires pre-approved templates outside its 24-hour service window.
   * @route POST /send-flow
   *
   * @paramDef {"type":"String","label":"Subscriber ID","name":"subscriberId","required":true,"description":"The ManyChat subscriber ID to send the flow to."}
   * @paramDef {"type":"String","label":"Flow","name":"flowNs","required":true,"dictionary":"getFlowsDictionary","description":"The flow to send. Select a flow or provide its namespace (ns) identifier."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async sendFlow(subscriberId, flowNs) {
    const logTag = '[sendFlow]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/fb/sending/sendFlow`,
      method: 'post',
      body: {
        subscriber_id: subscriberId,
        flow_ns: flowNs,
      },
    })
  }

  /**
   * @operationName Send Content by User Ref
   * @category Sending
   * @description Sends a message to a Facebook user identified by a user_ref from the checkbox plugin, before they become a full subscriber. Provide Message Text for a simple text message or Raw Content for a rich ManyChat dynamic content object - Raw Content takes precedence when both are set. Each user_ref can only be messaged once and expires after use.
   * @route POST /send-content-by-user-ref
   *
   * @paramDef {"type":"String","label":"User Ref","name":"userRef","required":true,"description":"The user_ref value produced by the Facebook checkbox plugin opt-in."}
   * @paramDef {"type":"String","label":"Message Text","name":"messageText","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Plain text message to send. Ignored when Raw Content is provided."}
   * @paramDef {"type":"Object","label":"Raw Content","name":"content","description":"Full ManyChat dynamic content object with messages, actions, and quick_replies arrays, per https://manychat.github.io/dynamic_block_docs/. Overrides Message Text."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async sendContentByUserRef(userRef, messageText, content) {
    const logTag = '[sendContentByUserRef]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/fb/sending/sendContentByUserRef`,
      method: 'post',
      body: {
        user_ref: userRef,
        data: this.#buildContentData(messageText, content),
      },
    })
  }

  // ---------------------------------------------------------------------------
  // Page
  // ---------------------------------------------------------------------------

  /**
   * @operationName Get Page Info
   * @category Page
   * @description Retrieves information about the connected ManyChat account/page: ID, name, category, avatar, username, description, Pro status, and timezone. Despite the "page" naming, this reflects the whole ManyChat account regardless of channel (Messenger, Instagram, WhatsApp, Telegram, SMS).
   * @route GET /get-page-info
   *
   * @returns {Object}
   * @sampleResult {"id":1234567890,"name":"My Business","category":"Shopping & Retail","avatar_link":"https://example.com/avatar.jpg","username":"mybusiness","about":"We sell great things","description":"Official My Business account","is_pro":true,"timezone":"UTC+00"}
   */
  async getPageInfo() {
    const logTag = '[getPageInfo]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/fb/page/getInfo`,
      method: 'get',
    })
  }

  /**
   * @operationName List Flows
   * @category Page
   * @description Retrieves all flows and flow folders in the ManyChat account. Each flow includes its namespace (ns) identifier, which is what Send Flow expects, plus its name and folder.
   * @route GET /list-flows
   *
   * @returns {Object}
   * @sampleResult {"flows":[{"ns":"content20250115123456_123456","name":"Welcome Flow","folder_id":1}],"folders":[{"id":1,"name":"Onboarding","parent_id":0}]}
   */
  async listFlows() {
    const logTag = '[listFlows]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/fb/page/getFlows`,
      method: 'get',
    })
  }

  /**
   * @operationName List Growth Tools
   * @category Page
   * @description Retrieves all growth tools (widgets) configured in the ManyChat account with their IDs, names, and types.
   * @route GET /list-growth-tools
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":201,"name":"Website Chat Widget","type":"widget"},{"id":202,"name":"Landing Page","type":"landing"}]
   */
  async listGrowthTools() {
    const logTag = '[listGrowthTools]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/fb/page/getGrowthTools`,
      method: 'get',
    })
  }

  /**
   * @operationName List OTN Topics
   * @category Page
   * @description Retrieves all One-Time Notification (OTN) topics defined in the ManyChat account. Subscribers who opted in to a topic can be messaged once outside Facebook's 24-hour messaging window via Send Content with the OTN Topic Name parameter.
   * @route GET /list-otn-topics
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":31,"name":"Product updates","description":"Occasional product news"}]
   */
  async listOtnTopics() {
    const logTag = '[listOtnTopics]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/fb/page/getOtnTopics`,
      method: 'get',
    })
  }

  // ---------------------------------------------------------------------------
  // Dictionaries
  // ---------------------------------------------------------------------------

  /**
   * @typedef {Object} getTagsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter tags by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. ManyChat returns all tags in one call, so this is unused but kept for API compatibility."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Tags Dictionary
   * @description Provides the list of account tags for selecting a tag in tagging operations. The option value is the numeric tag ID.
   * @route POST /get-tags-dictionary
   * @paramDef {"type":"getTagsDictionary__payload","label":"Payload","name":"payload","description":"Contains the search string used to filter tags by name."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"vip","value":"101"}],"cursor":null}
   */
  async getTagsDictionary(payload) {
    const { search } = payload || {}
    const logTag = '[getTagsDictionary]'

    const tags = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/fb/page/getTags`,
      method: 'get',
    })

    const items = (Array.isArray(tags) ? tags : []).map(tag => ({
      label: tag.name,
      value: String(tag.id),
    }))

    return { items: this.#filterDictionaryItems(items, search), cursor: null }
  }

  /**
   * @typedef {Object} getFlowsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter flows by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. ManyChat returns all flows in one call, so this is unused but kept for API compatibility."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Flows Dictionary
   * @description Provides the list of account flows for selecting a flow in Send Flow. The option value is the flow namespace (ns) identifier; the note shows the containing folder.
   * @route POST /get-flows-dictionary
   * @paramDef {"type":"getFlowsDictionary__payload","label":"Payload","name":"payload","description":"Contains the search string used to filter flows by name."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Welcome Flow","value":"content20250115123456_123456","note":"Onboarding"}],"cursor":null}
   */
  async getFlowsDictionary(payload) {
    const { search } = payload || {}
    const logTag = '[getFlowsDictionary]'

    const data = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/fb/page/getFlows`,
      method: 'get',
    })

    const folderNames = {}

    for (const folder of data.folders || []) {
      folderNames[folder.id] = folder.name
    }

    const items = (data.flows || []).map(flow => ({
      label: flow.name,
      value: flow.ns,
      note: folderNames[flow.folder_id] || undefined,
    }))

    return { items: this.#filterDictionaryItems(items, search), cursor: null }
  }

  /**
   * @typedef {Object} getCustomFieldsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter custom fields by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. ManyChat returns all custom fields in one call, so this is unused but kept for API compatibility."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Custom Fields Dictionary
   * @description Provides the list of subscriber custom fields for selecting a field in custom field operations. The option value is the numeric field ID; the note shows the field type.
   * @route POST /get-custom-fields-dictionary
   * @paramDef {"type":"getCustomFieldsDictionary__payload","label":"Payload","name":"payload","description":"Contains the search string used to filter custom fields by name."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Order ID","value":"11","note":"text"}],"cursor":null}
   */
  async getCustomFieldsDictionary(payload) {
    const { search } = payload || {}
    const logTag = '[getCustomFieldsDictionary]'

    const fields = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/fb/page/getCustomFields`,
      method: 'get',
    })

    const items = (Array.isArray(fields) ? fields : []).map(field => ({
      label: field.name,
      value: String(field.id),
      note: field.type,
    }))

    return { items: this.#filterDictionaryItems(items, search), cursor: null }
  }

  /**
   * @typedef {Object} getBotFieldsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter bot fields by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. ManyChat returns all bot fields in one call, so this is unused but kept for API compatibility."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Bot Fields Dictionary
   * @description Provides the list of bot fields (global variables) for selecting a field in Set Bot Field. The option value is the numeric field ID; the note shows the field type.
   * @route POST /get-bot-fields-dictionary
   * @paramDef {"type":"getBotFieldsDictionary__payload","label":"Payload","name":"payload","description":"Contains the search string used to filter bot fields by name."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"support_email","value":"21","note":"text"}],"cursor":null}
   */
  async getBotFieldsDictionary(payload) {
    const { search } = payload || {}
    const logTag = '[getBotFieldsDictionary]'

    const fields = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/fb/page/getBotFields`,
      method: 'get',
    })

    const items = (Array.isArray(fields) ? fields : []).map(field => ({
      label: field.name,
      value: String(field.id),
      note: field.type,
    }))

    return { items: this.#filterDictionaryItems(items, search), cursor: null }
  }
}

Flowrunner.ServerCode.addService(ManyChatService, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your ManyChat API token. Generate it in ManyChat under Settings -> API (a Pro account is required).',
  },
])
