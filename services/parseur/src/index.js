const logger = {
  info: (...args) => console.log('[Parseur Service] info:', ...args),
  debug: (...args) => console.log('[Parseur Service] debug:', ...args),
  error: (...args) => console.log('[Parseur Service] error:', ...args),
  warn: (...args) => console.log('[Parseur Service] warn:', ...args),
}

const API_BASE_URL = 'https://api.parseur.com'

const EventTypes = {
  onDocumentProcessedRealtime: 'document.processed',
}

const MethodTypes = Object.keys(EventTypes).reduce((acc, key) => ((acc[EventTypes[key]] = key), acc), {})

const MethodCallTypes = {
  SHAPE_EVENT: 'SHAPE_EVENT',
  FILTER_TRIGGER: 'FILTER_TRIGGER',
}

/**
 * @integrationName Parseur Document Parser
 * @integrationIcon /icon.png
 * @integrationTriggersScope SINGLE_APP
 */
class ParseurService {
  constructor(config) {
    this.apiKey = config.apiKey
  }

  async #apiRequest({ url, method = 'GET', body, form, logTag }) {
    try {
      logger.debug(`${ logTag } - API request: [${ method }::${ url }]`)

      let request = Flowrunner.Request[method.toLowerCase()](url)
        .set({ Authorization: `${ this.apiKey }` })

      if (form) {
        request = request
          .set({ 'Content-Type': 'multipart/form-data' })
          .form(form)
      } else if (body) {
        request = request.send(body)
      }

      const response = await request

      logger.debug(`${ logTag } - Response received`)

      return response
    } catch (error) {
      const message = error.message && typeof error.message === 'string'
        ? error.message
        : JSON.stringify(error.message)

      logger.error(`${ logTag } - Failed to execute ${ url }, Error: ${ message } ${ error.stack }`)
      throw new Error(`Parseur API error: ${ message }`)
    }
  }

  /**
   * @typedef {Object} getMailboxesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter mailboxes by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for retrieving the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Mailboxes Dictionary
   * @description Provides a list of available mailboxes for selection
   * @route POST /get-mailboxes-dictionary
   * @paramDef {"type":"getMailboxesDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering mailboxes."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Sales Leads","value":"abc123","note":"ID: abc123"}],"cursor":null}
   */
  async getMailboxesDictionary(payload) {
    const { search, cursor } = payload || {}
    const logTag = '[getMailboxesDictionary]'

    let url = `${ API_BASE_URL }/parser`

    if (cursor) {
      url = cursor
    }

    const response = await this.#apiRequest({ url, logTag })

    let mailboxes = response.results || []

    if (search) {
      const searchLower = search.toLowerCase()
      mailboxes = mailboxes.filter(mailbox => mailbox.name.toLowerCase().includes(searchLower))
    }

    return {
      items: mailboxes.map(mailbox => ({
        label: mailbox.name,
        value: mailbox.id,
        note: `ID: ${ mailbox.id }`,
      })),
      cursor: response.next || null,
    }
  }

  /**
   * @operationName Upload Document
   * @description Uploads a document to a mailbox for parsing
   * @route POST /upload-document
   * @appearanceColor #1465FF #4B8FFF
   *
   * @paramDef {"type":"String","label":"Mailbox","name":"mailboxId","required":true,"dictionary":"getMailboxesDictionary","description":"The mailbox to upload the document to"}
   * @paramDef {"type":"String","label":"Document URL","name":"documentUrl","required":true,"description":"URL of the document to upload (PDF, Word, images, emails)"}
   * @paramDef {"type":"String","label":"Document Name","name":"filename","description":"Optional custom name for the document"}
   *
   * @returns {Object}
   * @sampleResult { "name": "invoice-name.pdf", "DocumentID": "6f24de6e65af407e81da0f195292e03b" }
   */
  async uploadDocument(mailboxId, documentUrl, filename) {
    const logTag = '[uploadDocument]'

    if (!mailboxId) {
      throw new Error('Mailbox ID is required')
    }

    if (!documentUrl) {
      throw new Error('Document URL is required')
    }

    filename = filename || documentUrl.split('/').pop() || 'document'

    // First, fetch the document from the URL
    logger.debug(`${ logTag } Fetching document with name="${ filename }" from URL: ${ documentUrl }`)

    const documentResponse = await Flowrunner.Request.get(documentUrl)
      .setEncoding(null)
      .unwrapBody(false)

    const mimeType = documentResponse.headers['content-type']
    const fileBuffer = documentResponse.body

    logger.debug(`${ logTag } Fetched document with mimeType="${ mimeType }", fileBufferSize=${ fileBuffer.length } from URL: ${ documentUrl }`)

    const formData = new Flowrunner.Request.FormData()

    formData.append('file', fileBuffer, {
      filename: filename,
      contentType: mimeType,
    })

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/parser/${ mailboxId }/upload`,
      method: 'POST',
      form: formData,
      logTag,
    })

    const document = response.attachments[0]

    logger.info(`${ logTag } Successfully uploaded document: ${ document.DocumentID } (${ document.name })`)

    return document
  }

  /**
   * @operationName List Documents
   * @description Lists all documents in a mailbox
   * @route POST /list-documents
   * @appearanceColor #1465FF #4B8FFF
   *
   * @paramDef {"type":"String","label":"Mailbox","name":"mailboxId","required":true,"dictionary":"getMailboxesDictionary","description":"The mailbox to list documents from"}
   * @paramDef {"type":"String","label":"Status Filter","name":"statusFilter","uiComponent":{"type":"DROPDOWN","options":{"values":["all","pending","processing","processed","failed"]}},"description":"Filter documents by processing status"}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of documents to return (default: 20)"}
   *
   * @returns {Array<Object>}
   * @sampleResult {"documents":[{"id":"doc_001","filename":"invoice1.pdf","status":"processed","created":"2024-01-15T10:00:00Z","templateId":"tpl_123"}],"total":15,"nextCursor":"page_2"}
   */
  async listDocuments(mailboxId, statusFilter, limit) {
    const logTag = '[listDocuments]'

    if (!mailboxId) {
      throw new Error('Mailbox ID is required')
    }

    const params = new URLSearchParams()

    if (statusFilter && statusFilter !== 'all') {
      params.append('status', statusFilter)
    }

    if (limit) {
      params.append('limit', limit.toString())
    } else {
      params.append('limit', '20')
    }

    const url = `${ API_BASE_URL }/parser/${ mailboxId }/document_set?${ params.toString() }`
    const response = await this.#apiRequest({ url, logTag })

    const documents = response.results || []

    logger.info(`${ logTag } Successfully listed ${ documents.length } documents`)

    return response
  }

  /**
   * @operationName Reprocess Document
   * @description Reprocesses a document with updated template or settings
   * @route POST /reprocess-document
   * @appearanceColor #1465FF #4B8FFF
   *
   * @paramDef {"type":"String","label":"Document ID","name":"documentId","required":true,"description":"The document ID to reprocess"}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"message":"Document queued for reprocessing","documentId":"doc_xyz789"}
   */
  async reprocessDocument(mailboxId, documentId) {
    const logTag = '[reprocessDocument]'

    if (!documentId) {
      throw new Error('Document ID is required')
    }

    const result = await this.#apiRequest({
      url: `${ API_BASE_URL }/parser/document/${ documentId }/process`,
      method: 'process',
      logTag,
    })

    logger.info(`${ logTag } Successfully queued document for reprocessing: ${ documentId }`)

    return result
  }

  /**
   * @operationName Delete Document
   * @description Deletes a document from a mailbox
   * @route POST /delete-document
   * @appearanceColor #FF4444 #FF6666
   *
   * @paramDef {"type":"String","label":"Mailbox","name":"mailboxId","required":true,"dictionary":"getMailboxesDictionary","description":"The mailbox containing the document"}
   * @paramDef {"type":"String","label":"Document ID","name":"documentId","required":true,"description":"The document ID to delete"}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"message":"Document deleted successfully","documentId":"doc_xyz789"}
   */
  async deleteDocument(mailboxId, documentId) {
    const logTag = '[deleteDocument]'

    if (!mailboxId) {
      throw new Error('Mailbox ID is required')
    }

    if (!documentId) {
      throw new Error('Document ID is required')
    }

    const result = await this.#apiRequest({
      url: `${ API_BASE_URL }/parser/${ mailboxId }/document_set/${ documentId }`,
      method: 'DELETE',
      logTag,
    })

    logger.info(`${ logTag } Successfully deleted document: ${ documentId }`)

    return result
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
   * @description Triggered when a document is processed in Parseur (realtime webhook)
   * @route POST /on-document-processed-realtime
   * @operationName On Document Processed
   * @registerAs REALTIME_TRIGGER
   *
   * @paramDef {"type":"String","label":"Mailbox","name":"mailboxId","required":true,"dictionary":"getMailboxesDictionary","description":"The mailbox to monitor for processed documents"}
   *
   * @returns {Object}
   * @sampleResult { "mailboxId": "13118", "documentId": "d63f1122c7bb6b33e9d91", "parsedData":{}}
   */
  onDocumentProcessedRealtime(callType, payload) {
    if (callType === MethodCallTypes.SHAPE_EVENT) {
      return [
        {
          name: 'onDocumentProcessedRealtime',
          data: {
            mailboxId: payload.queryParams.mailboxId,
            documentId: payload.body.DocumentID,
            parsedData: payload.body,
          },
        },
      ]
    }

    if (callType === MethodCallTypes.FILTER_TRIGGER) {
      const ids = []

      payload.triggers.forEach(trigger => {
        const { mailboxId } = trigger.data
        const eventData = payload.eventData

        // Check if mailbox matches
        if (`${ mailboxId }` === eventData.mailboxId) {
          ids.push(trigger.id)
        }
      })

      return { ids }
    }
  }

  async #createWebhook(eventName, webhookUrl) {
    const logTag = '[#createWebhook]'

    const webhook = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/webhook`,
      method: 'POST',
      body: {
        target: webhookUrl,
        event: eventName,
      },
    })

    logger.info(`${ logTag } Created webhook ${ webhook.id } for ${ eventName }`)

    return webhook
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerUpsertWebhook(invocation) {
    const logTag = '[handleTriggerUpsertWebhook]'

    logger.debug(`${ logTag }.invocation: ${ JSON.stringify(invocation) }`)

    const webhookUrl = invocation.callbackUrl

    const webhooks = invocation.webhookData?.webhooks || {}

    for (const event of invocation.events) {
      const eventName = EventTypes[event.name]
      const { mailboxId } = event.triggerData
      const webhookKey = `${ eventName }---${ mailboxId }`

      if (!webhooks[webhookKey]) {
        const eventWebhookUrl = `${ webhookUrl }&mailboxId=${ mailboxId }`

        const webhook = await this.#createWebhook(eventName, eventWebhookUrl)

        await this.#apiRequest({
          url: `${ API_BASE_URL }/parser/${ mailboxId }/webhook_set/${ webhook.id }`,
          method: 'POST',
          logTag: '[#enableWebhook]',
        })

        webhooks[webhookKey] = webhook.id
      }
    }

    const webhookData = {
      webhooks,
    }

    logger.debug(`${ logTag }.webhookData: ${ JSON.stringify(webhookData) }`)

    return {
      webhookData,
    }
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerResolveEvents(invocation) {
    const logTag = '[handleTriggerResolveEvents]'

    logger.debug(`${ logTag }.invocation: ${ JSON.stringify(invocation) }`)

    const eventType = invocation.headers['x-parseur-event']
    const methodName = MethodTypes[eventType]

    logger.debug(`${ logTag }.methodName: ${ methodName }`)

    if (!methodName) {
      return null
    }

    logger.debug(`${ logTag }.${ methodName }.SHAPE_EVENT: ${ JSON.stringify(invocation.body) }`)

    // Pass the entire invocation to get access to headers and query params
    const events = await this[methodName](MethodCallTypes.SHAPE_EVENT, invocation)

    logger.debug(`${ logTag }.${ methodName }.events: ${ JSON.stringify(events) }`)

    return {
      events,
    }
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerSelectMatched(invocation) {
    const logTag = '[handleTriggerSelectMatched]'

    logger.debug(`${ logTag }.${ invocation.eventName }.FILTER_TRIGGER: ${ JSON.stringify(invocation) }`)

    const data = await this[invocation.eventName](MethodCallTypes.FILTER_TRIGGER, invocation)

    logger.debug(`${ logTag }.${ invocation.eventName }.triggersToActivate: ${ JSON.stringify(data) }`)

    return data
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerDeleteWebhook(invocation) {
    const logTag = '[handleTriggerDeleteWebhook]'
    const { webhookData } = invocation

    if (webhookData?.webhooks) {
      for (const webhookKey in webhookData.webhooks) {
        const webhookId = webhookData.webhooks[webhookKey]

        logger.info(`${ logTag } Delete webhook ${ webhookKey } id=${ webhookId }`)

        try {
          await this.#apiRequest({
            url: `${ API_BASE_URL }/webhook/${ webhookId }`,
            method: 'DELETE',
            logTag,
          })

          logger.info(`${ logTag } Deleted webhook ${ webhookKey } id=${ webhookId }`)
        } catch (error) {
          logger.warn(`${ logTag } Failed to delete webhook ${ webhookKey } id=${ webhookId }: ${ error.message }`)
        }
      }
    }

    return {}
  }
}

Flowrunner.ServerCode.addService(ParseurService, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    hint: 'Your Parseur API key. Get it from your account at https://app.parseur.com/account/api-keys',
  },
])