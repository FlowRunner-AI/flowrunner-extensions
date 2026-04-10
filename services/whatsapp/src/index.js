const API_BASE_URL = 'https://graph.facebook.com/v21.0'

const logger = {
  info: (...args) => console.log('[WhatsApp Service] info:', ...args),
  debug: (...args) => console.log('[WhatsApp Service] debug:', ...args),
  error: (...args) => console.log('[WhatsApp Service] error:', ...args),
  warn: (...args) => console.log('[WhatsApp Service] warn:', ...args),
}

/**
 * @integrationName WhatsApp Business API
 * @integrationIcon /icon.png
 */
class WhatsAppService {
  constructor(config) {
    this.accessToken = config.accessToken
    this.phoneNumberId = config.phoneNumberId
    this.businessId = config.businessId
    this.webhookVerifyToken = config.webhookVerifyToken
  }

  async #apiRequest({ url, method, body, query, logTag }) {
    method = method || 'get'

    try {
      logger.debug(`${ logTag } - api request: [${ method }::${ url }] q=[${ JSON.stringify(query) }]`)

      return await Flowrunner.Request[method](url)
        .set({
          'Authorization': `Bearer ${ this.accessToken }`,
          'Content-Type': 'application/json',
        })
        .query(query)
        .send(body)
    } catch (error) {
      logger.error(`${ logTag } - api request failed: ${ error.message }`)
      throw new Error(`WhatsApp API request failed: ${ error.message }`)
    }
  }

  #formatPhoneNumber(phoneNumber) {
    // Remove all non-digit characters
    const cleaned = phoneNumber.replace(/\D/g, '')
    
    // Add country code if not present (assuming it starts with country code)
    if (cleaned.length >= 10) {
      return cleaned
    }
    
    throw new Error('Invalid phone number format. Please include country code.')
  }

  #validateUrl(url) {
    try {
      new URL(url)

      return true
    } catch {
      throw new Error('Invalid URL format')
    }
  }

  /**
   * @operationName Send Text Message
   * @category Messaging
   * @description Sends a text message to a WhatsApp user. Supports Unicode characters, emojis, and formatting. Messages are delivered through the WhatsApp Business API.
   * @route POST /send-text-message
   *
   * @paramDef {"type":"String","label":"Recipient Phone Number","name":"to","required":true,"description":"Phone number in international format (e.g., +1234567890)"}
   * @paramDef {"type":"String","label":"Message Text","name":"text","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Text content to send (supports Unicode and emojis, max 4096 characters)"}
   * @paramDef {"type":"Boolean","label":"Preview URLs","name":"previewUrl","uiComponent":{"type":"TOGGLE"},"description":"Enable URL previews in the message"}
   *
   * @returns {Object}
   * @sampleResult {"messaging_product":"whatsapp","contacts":[{"input":"+1234567890","wa_id":"1234567890"}],"messages":[{"id":"wamid.ABC123"}]}
   */
  async sendTextMessage(to, text, previewUrl) {
    try {
      logger.debug(`[sendTextMessage] Sending text message to ${ to }`)

      const formattedPhone = this.#formatPhoneNumber(to)

      if (!text || text.trim().length === 0) {
        throw new Error('Message text cannot be empty')
      }

      if (text.length > 4096) {
        throw new Error('Message text cannot exceed 4096 characters')
      }

      const payload = {
        messaging_product: 'whatsapp',
        to: formattedPhone,
        type: 'text',
        text: {
          body: text,
          preview_url: Boolean(previewUrl),
        },
      }

      const response = await this.#apiRequest({
        url: `${ API_BASE_URL }/${ this.phoneNumberId }/messages`,
        method: 'post',
        body: payload,
        logTag: 'sendTextMessage',
      })

      logger.info(`[sendTextMessage] Message sent successfully to ${ formattedPhone }`)

      return response

    } catch (error) {
      logger.error(`[sendTextMessage] Failed to send message: ${ error.message }`)
      throw error
    }
  }

  /**
   * @operationName Send Image Message
   * @category Messaging
   * @description Sends an image message to a WhatsApp user. Supports JPEG, PNG, and WebP formats. Images can be sent by URL or media ID with optional caption text.
   * @route POST /send-image-message
   *
   * @paramDef {"type":"String","label":"Recipient Phone Number","name":"to","required":true,"description":"Phone number in international format (e.g., +1234567890)"}
   * @paramDef {"type":"String","label":"Image URL","name":"imageUrl","required":true,"description":"Public URL of the image file (JPEG, PNG, or WebP format, max 5MB)"}
   * @paramDef {"type":"String","label":"Caption","name":"caption","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional caption text for the image (max 1024 characters)"}
   *
   * @returns {Object}
   * @sampleResult {"messaging_product":"whatsapp","contacts":[{"input":"+1234567890","wa_id":"1234567890"}],"messages":[{"id":"wamid.ABC123"}]}
   */
  async sendImageMessage(to, imageUrl, caption) {
    try {
      logger.debug(`[sendImageMessage] Sending image message to ${ to }`)

      const formattedPhone = this.#formatPhoneNumber(to)
      this.#validateUrl(imageUrl)

      if (caption && caption.length > 1024) {
        throw new Error('Caption cannot exceed 1024 characters')
      }

      const payload = {
        messaging_product: 'whatsapp',
        to: formattedPhone,
        type: 'image',
        image: {
          link: imageUrl,
        },
      }

      if (caption && caption.trim().length > 0) {
        payload.image.caption = caption
      }

      const response = await this.#apiRequest({
        url: `${ API_BASE_URL }/${ this.phoneNumberId }/messages`,
        method: 'post',
        body: payload,
        logTag: 'sendImageMessage',
      })

      logger.info(`[sendImageMessage] Image message sent successfully to ${ formattedPhone }`)

      return response

    } catch (error) {
      logger.error(`[sendImageMessage] Failed to send image: ${ error.message }`)
      throw error
    }
  }

  /**
   * @operationName Send Document
   * @category Messaging
   * @description Sends a document file to a WhatsApp user. Supports various file formats including PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX, and TXT. Files are sent by URL with optional filename and caption.
   * @route POST /send-document
   *
   * @paramDef {"type":"String","label":"Recipient Phone Number","name":"to","required":true,"description":"Phone number in international format (e.g., +1234567890)"}
   * @paramDef {"type":"String","label":"Document URL","name":"documentUrl","required":true,"description":"Public URL of the document file (max 100MB)"}
   * @paramDef {"type":"String","label":"Filename","name":"filename","description":"Custom filename with extension (e.g., report.pdf)"}
   * @paramDef {"type":"String","label":"Caption","name":"caption","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional caption text for the document (max 1024 characters)"}
   *
   * @returns {Object}
   * @sampleResult {"messaging_product":"whatsapp","contacts":[{"input":"+1234567890","wa_id":"1234567890"}],"messages":[{"id":"wamid.ABC123"}]}
   */
  async sendDocument(to, documentUrl, filename, caption) {
    try {
      logger.debug(`[sendDocument] Sending document to ${ to }`)

      const formattedPhone = this.#formatPhoneNumber(to)
      this.#validateUrl(documentUrl)

      if (caption && caption.length > 1024) {
        throw new Error('Caption cannot exceed 1024 characters')
      }

      const payload = {
        messaging_product: 'whatsapp',
        to: formattedPhone,
        type: 'document',
        document: {
          link: documentUrl,
        },
      }

      if (filename && filename.trim().length > 0) {
        payload.document.filename = filename
      }

      if (caption && caption.trim().length > 0) {
        payload.document.caption = caption
      }

      const response = await this.#apiRequest({
        url: `${ API_BASE_URL }/${ this.phoneNumberId }/messages`,
        method: 'post',
        body: payload,
        logTag: 'sendDocument',
      })

      logger.info(`[sendDocument] Document sent successfully to ${ formattedPhone }`)

      return response

    } catch (error) {
      logger.error(`[sendDocument] Failed to send document: ${ error.message }`)
      throw error
    }
  }

  /**
   * @operationName Send Template Message
   * @category Messaging
   * @description Sends a pre-approved message template to a WhatsApp user. Templates must be approved by Meta and can include variables, headers, and call-to-action buttons for structured communication.
   * @route POST /send-template-message
   *
   * @paramDef {"type":"String","label":"Recipient Phone Number","name":"to","required":true,"description":"Phone number in international format (e.g., +1234567890)"}
   * @paramDef {"type":"String","label":"Template Name","name":"templateName","required":true,"dictionary":"getTemplatesDictionary","description":"Name of the approved message template"}
   * @paramDef {"type":"String","label":"Language Code","name":"languageCode","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["en","en_US","es","es_ES","pt_BR","fr","de","it","ja","ko","zh_CN","zh_TW","ar","hi","ru"]}},"description":"Language code for the template (e.g., en, es, pt_BR)"}
   * @paramDef {"type":"Array<String>","label":"Template Variables","name":"templateVariables","description":"Array of variables to replace placeholders in the template"}
   *
   * @returns {Object}
   * @sampleResult {"messaging_product":"whatsapp","contacts":[{"input":"+1234567890","wa_id":"1234567890"}],"messages":[{"id":"wamid.ABC123"}]}
   */
  async sendTemplateMessage(to, templateName, languageCode, templateVariables) {
    try {
      logger.debug(`[sendTemplateMessage] Sending template ${ templateName } to ${ to }`)

      const formattedPhone = this.#formatPhoneNumber(to)

      if (!templateName || templateName.trim().length === 0) {
        throw new Error('Template name is required')
      }

      if (!languageCode || languageCode.trim().length === 0) {
        throw new Error('Language code is required')
      }

      const payload = {
        messaging_product: 'whatsapp',
        to: formattedPhone,
        type: 'template',
        template: {
          name: templateName,
          language: {
            code: languageCode,
          },
        },
      }

      // Add template variables if provided
      if (templateVariables && Array.isArray(templateVariables) && templateVariables.length > 0) {
        payload.template.components = [
          {
            type: 'body',
            parameters: templateVariables.map(variable => ({
              type: 'text',
              text: String(variable),
            })),
          },
        ]
      }

      const response = await this.#apiRequest({
        url: `${ API_BASE_URL }/${ this.phoneNumberId }/messages`,
        method: 'post',
        body: payload,
        logTag: 'sendTemplateMessage',
      })

      logger.info(`[sendTemplateMessage] Template message sent successfully to ${ formattedPhone }`)

      return response

    } catch (error) {
      logger.error(`[sendTemplateMessage] Failed to send template: ${ error.message }`)
      throw error
    }
  }

  /**
   * @operationName Send Location
   * @category Messaging
   * @description Sends a location message to a WhatsApp user. Includes latitude, longitude coordinates with optional name and address information for sharing geographic locations.
   * @route POST /send-location
   *
   * @paramDef {"type":"String","label":"Recipient Phone Number","name":"to","required":true,"description":"Phone number in international format (e.g., +1234567890)"}
   * @paramDef {"type":"Number","label":"Latitude","name":"latitude","required":true,"description":"Latitude coordinate (-90 to 90)"}
   * @paramDef {"type":"Number","label":"Longitude","name":"longitude","required":true,"description":"Longitude coordinate (-180 to 180)"}
   * @paramDef {"type":"String","label":"Location Name","name":"name","description":"Name of the location (e.g., 'Coffee Shop', 'Office')"}
   * @paramDef {"type":"String","label":"Address","name":"address","description":"Address or description of the location"}
   *
   * @returns {Object}
   * @sampleResult {"messaging_product":"whatsapp","contacts":[{"input":"+1234567890","wa_id":"1234567890"}],"messages":[{"id":"wamid.ABC123"}]}
   */
  async sendLocation(to, latitude, longitude, name, address) {
    try {
      logger.debug(`[sendLocation] Sending location to ${ to }`)

      const formattedPhone = this.#formatPhoneNumber(to)

      // Validate coordinates
      if (typeof latitude !== 'number' || latitude < -90 || latitude > 90) {
        throw new Error('Latitude must be a number between -90 and 90')
      }

      if (typeof longitude !== 'number' || longitude < -180 || longitude > 180) {
        throw new Error('Longitude must be a number between -180 and 180')
      }

      const payload = {
        messaging_product: 'whatsapp',
        to: formattedPhone,
        type: 'location',
        location: {
          latitude: latitude,
          longitude: longitude,
        },
      }

      if (name && name.trim().length > 0) {
        payload.location.name = name
      }

      if (address && address.trim().length > 0) {
        payload.location.address = address
      }

      const response = await this.#apiRequest({
        url: `${ API_BASE_URL }/${ this.phoneNumberId }/messages`,
        method: 'post',
        body: payload,
        logTag: 'sendLocation',
      })

      logger.info(`[sendLocation] Location sent successfully to ${ formattedPhone }`)

      return response

    } catch (error) {
      logger.error(`[sendLocation] Failed to send location: ${ error.message }`)
      throw error
    }
  }

  /**
   * @operationName Mark Message as Read
   * @category Messaging
   * @description Marks a received WhatsApp message as read. This sends a read receipt to the sender and helps maintain conversation status in your business communications.
   * @route POST /mark-message-read
   *
   * @paramDef {"type":"String","label":"Message ID","name":"messageId","required":true,"description":"WhatsApp message ID to mark as read (e.g., wamid.ABC123)"}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async markMessageAsRead(messageId) {
    try {
      logger.debug(`[markMessageAsRead] Marking message ${ messageId } as read`)

      if (!messageId || messageId.trim().length === 0) {
        throw new Error('Message ID is required')
      }

      const payload = {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
      }

      const response = await this.#apiRequest({
        url: `${ API_BASE_URL }/${ this.phoneNumberId }/messages`,
        method: 'post',
        body: payload,
        logTag: 'markMessageAsRead',
      })

      logger.info(`[markMessageAsRead] Message ${ messageId } marked as read`)

      return response

    } catch (error) {
      logger.error(`[markMessageAsRead] Failed to mark message as read: ${ error.message }`)
      throw error
    }
  }

  /**
   * @operationName Get Business Profile
   * @category Business Management
   * @description Retrieves the WhatsApp Business profile information including business name, description, contact details, and verification status for the connected business account.
   * @route GET /get-business-profile
   *
   * @returns {Object}
   * @sampleResult {"data":[{"about":"Business description","address":"123 Main St","description":"Business description","email":"contact@business.com","profile_picture_url":"https://example.com/pic.jpg","websites":["https://business.com"],"vertical":"Other"}]}
   */
  async getBusinessProfile() {
    try {
      logger.debug('[getBusinessProfile] Fetching business profile')

      const response = await this.#apiRequest({
        url: `${ API_BASE_URL }/${ this.phoneNumberId }/whatsapp_business_profile`,
        method: 'get',
        query: {
          fields: 'about,address,description,email,profile_picture_url,websites,vertical',
        },
        logTag: 'getBusinessProfile',
      })

      logger.info('[getBusinessProfile] Business profile retrieved successfully')

      return response

    } catch (error) {
      logger.error(`[getBusinessProfile] Failed to get business profile: ${ error.message }`)
      throw error
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Templates Dictionary
   * @description Provides a searchable list of approved message templates for dynamic parameter selection.
   * @route POST /get-templates-dictionary
   * @paramDef {"type":"getTemplatesDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering message templates."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Welcome Message","value":"welcome_message","note":"Status: APPROVED"},{"label":"Order Confirmation","value":"order_confirmation","note":"Status: APPROVED"}],"cursor":null}
   */
  async getTemplatesDictionary(payload) {
    try {
      const { search } = payload || {}
      logger.debug('[getTemplatesDictionary] Fetching templates dictionary')

      if (!this.businessId) {
        logger.warn('[getTemplatesDictionary] Business ID not configured, returning empty list')

        return { items: [], cursor: null }
      }

      const response = await this.#apiRequest({
        url: `${ API_BASE_URL }/${ this.businessId }/message_templates`,
        method: 'get',
        query: {
          fields: 'name,status,language',
          limit: 100,
        },
        logTag: 'getTemplatesDictionary',
      })

      let templates = response.data || []

      // Filter by search term if provided
      if (search && search.trim().length > 0) {
        const searchLower = search.toLowerCase()

        templates = templates.filter(template => 
          template.name.toLowerCase().includes(searchLower)
        )
      }

      const items = templates
        .filter(template => template.status === 'APPROVED')
        .map(template => ({
          label: template.name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
          value: template.name,
          note: `Status: ${ template.status }`,
        }))

      logger.debug(`[getTemplatesDictionary] Retrieved ${ items.length } templates`)

      return { items, cursor: null }

    } catch (error) {
      logger.error(`[getTemplatesDictionary] Failed to fetch templates: ${ error.message }`)

      return { items: [], cursor: null }
    }
  }
}

// Define payload typedef for templates dictionary
/**
 * @typedef {Object} getTemplatesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter templates by name. Filtering is performed locally on retrieved results."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for retrieving the next page of results."}
 */

Flowrunner.ServerCode.addService(WhatsAppService, [
  {
    name: 'accessToken',
    displayName: 'Access Token',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    hint: 'WhatsApp Business API access token from Meta Business Platform. Get it from https://developers.facebook.com/apps/ > Your App > WhatsApp > API Setup.',
  },
  {
    name: 'phoneNumberId',
    displayName: 'Phone Number ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    hint: 'Phone number ID from Meta Business Platform. Found in WhatsApp > API Setup > Phone numbers section.',
  },
  {
    name: 'businessId',
    displayName: 'Business ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    hint: 'Business account ID for accessing message templates. Optional, but required for template operations. Found in Business Settings.',
  },
  {
    name: 'webhookVerifyToken',
    displayName: 'Webhook Verify Token',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    hint: 'Token for webhook verification. Optional, used for webhook endpoint security. Set in WhatsApp > Configuration > Webhooks.',
  },
])