const logger = {
  info: (...args) => console.log('[PandaDoc] info:', ...args),
  debug: (...args) => console.log('[PandaDoc] debug:', ...args),
  error: (...args) => console.log('[PandaDoc] error:', ...args),
  warn: (...args) => console.log('[PandaDoc] warn:', ...args),
}

const API_BASE_URL = 'https://api.pandadoc.com/public/v1'

const SHARE_LINK_BASE_URL = 'https://app.pandadoc.com/s'

const DRAFT_POLL_INTERVAL_MS = 2000
const DRAFT_POLL_MAX_ATTEMPTS = 15 // ~30 seconds total

const DEFAULT_PAGE_SIZE = 50

// Verified against https://developers.pandadoc.com/reference/list-documents (full 0-14 set).
const DOCUMENT_STATUS_MAP = {
  'Draft': 0,
  'Sent': 1,
  'Completed': 2,
  'Uploaded': 3,
  'Error': 4,
  'Viewed': 5,
  'Waiting Approval': 6,
  'Approved': 7,
  'Rejected': 8,
  'Waiting Pay': 9,
  'Paid': 10,
  'Voided': 11,
  'Declined': 12,
  'External Review': 13,
  'Scheduled': 14,
}

const ORDER_BY_MAP = {
  'Date Created (Newest First)': '-date_created',
  'Date Created (Oldest First)': 'date_created',
  'Date Modified (Newest First)': '-date_modified',
  'Date Modified (Oldest First)': 'date_modified',
  'Date Sent (Newest First)': '-date_sent',
  'Date Sent (Oldest First)': 'date_sent',
  'Date Completed (Newest First)': '-date_completed',
  'Date Completed (Oldest First)': 'date_completed',
  'Date Expiration (Newest First)': '-date_expiration',
  'Date Expiration (Oldest First)': 'date_expiration',
  'Date Declined (Newest First)': '-date_declined',
  'Date Declined (Oldest First)': 'date_declined',
  'Date Status Changed (Newest First)': '-date_status_changed',
  'Date Status Changed (Oldest First)': 'date_status_changed',
  'Date of Last Action (Newest First)': '-date_of_last_action',
  'Date of Last Action (Oldest First)': 'date_of_last_action',
  'Name (A to Z)': 'name',
  'Name (Z to A)': '-name',
  'Status (Ascending)': 'status',
  'Status (Descending)': '-status',
}

const WEBHOOK_TRIGGER_MAP = {
  'Document State Changed': 'document_state_changed',
  'Recipient Completed': 'recipient_completed',
  'Document Updated': 'document_updated',
  'Document Deleted': 'document_deleted',
  'Document Creation Failed': 'document_creation_failed',
}

const WEBHOOK_PAYLOAD_MAP = {
  'Fields': 'fields',
  'Tokens': 'tokens',
  'Products': 'products',
  'Pricing': 'pricing',
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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * @usesFileStorage
 * @integrationName PandaDoc
 * @integrationIcon /icon.png
 */
class PandaDocService {
  constructor(config) {
    this.apiKey = config.apiKey
  }

  #authHeaders(extra) {
    return {
      'Authorization': `API-Key ${ this.apiKey }`,
      ...extra,
    }
  }

  #extractErrorMessage(error) {
    const detail = error.body?.detail || error.body?.message || error.body?.error

    if (detail) {
      return typeof detail === 'string' ? detail : JSON.stringify(detail)
    }

    if (error.body && typeof error.body === 'object') {
      return JSON.stringify(error.body)
    }

    return typeof error.message === 'string' ? error.message : JSON.stringify(error.message)
  }

  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=${ JSON.stringify(cleanedQuery) }`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set(this.#authHeaders({ 'Content-Type': 'application/json' }))
        .query(cleanedQuery || {})

      const response = body !== undefined ? await request.send(body) : await request

      // DELETE endpoints return 204 with an empty body.
      return response === undefined || response === '' ? { success: true } : response
    } catch (error) {
      const message = this.#extractErrorMessage(error)

      logger.error(`${ logTag } - request failed: ${ message }`)

      throw new Error(`PandaDoc API error: ${ message }`)
    }
  }

  // Maps a friendly dropdown label to its PandaDoc API value. Unmapped values
  // (and identity dropdowns) pass through unchanged.
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) return undefined

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // Normalize a downloaded binary body to a Buffer. Flowrunner.Request auto-parses
  // the response by Content-Type, so a JSON/text body may come back parsed even
  // with .setEncoding(null); re-serialize anything that isn't already a Buffer.
  #toBuffer(body) {
    if (Buffer.isBuffer(body)) {
      return body
    }

    if (typeof body === 'string') {
      return Buffer.from(body)
    }

    return Buffer.from(JSON.stringify(body))
  }

  // A freshly created document stays in the transient `document.uploaded` state for a few
  // seconds while PandaDoc processes it. It cannot be sent until it reaches `document.draft`.
  // Polls Get Document Status every 2 seconds for up to ~30 seconds.
  async #waitForDraft(documentId) {
    for (let attempt = 1; attempt <= DRAFT_POLL_MAX_ATTEMPTS; attempt++) {
      const doc = await this.#apiRequest({
        url: `${ API_BASE_URL }/documents/${ documentId }`,
        logTag: `[waitForDraft attempt ${ attempt }]`,
      })

      if (doc.status === 'document.error') {
        throw new Error(`PandaDoc API error: document ${ documentId } failed processing (status document.error)`)
      }

      if (doc.status !== 'document.uploaded') {
        return doc
      }

      await sleep(DRAFT_POLL_INTERVAL_MS)
    }

    throw new Error(
      `PandaDoc API error: document ${ documentId } is still processing (status document.uploaded) after ` +
      `${ (DRAFT_POLL_INTERVAL_MS * DRAFT_POLL_MAX_ATTEMPTS) / 1000 } seconds. Wait a moment and try sending again.`
    )
  }

  // ==========================================================================
  //  DOCUMENTS
  // ==========================================================================

  /**
   * @operationName List Documents
   * @category Documents
   * @description Lists documents in the workspace with optional filtering by search text, status, tag, folder, source template, creation date range, and deletion flag. Returns up to 100 documents per page (default 50) with id, name, status, and timestamps; use Get Document Details for the full content of a specific document.
   * @route GET /documents
   * @appearanceColor #2F8A68 #4FAE8C
   * @paramDef {"type":"String","label":"Search","name":"query","description":"Search documents by name or reference number."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Draft","Sent","Completed","Uploaded","Error","Viewed","Waiting Approval","Approved","Rejected","Waiting Pay","Paid","Voided","Declined","External Review","Scheduled"]}},"description":"Only return documents in this status. Leave empty for all statuses."}
   * @paramDef {"type":"String","label":"Tag","name":"tag","description":"Only return documents with this tag."}
   * @paramDef {"type":"String","label":"Folder","name":"folderUuid","dictionary":"getDocumentFoldersDictionary","description":"Only return documents stored in this folder. Pick a folder or paste its UUID."}
   * @paramDef {"type":"String","label":"Template","name":"templateId","dictionary":"getTemplatesDictionary","description":"Only return documents created from this template. Pick a template or paste its ID."}
   * @paramDef {"type":"String","label":"Created From","name":"createdFrom","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Only return documents created at or after this date/time (ISO 8601)."}
   * @paramDef {"type":"String","label":"Created To","name":"createdTo","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Only return documents created at or before this date/time (ISO 8601)."}
   * @paramDef {"type":"Boolean","label":"Deleted Only","name":"deleted","uiComponent":{"type":"CHECKBOX"},"description":"When enabled, returns only deleted documents."}
   * @paramDef {"type":"String","label":"Order By","name":"orderBy","uiComponent":{"type":"DROPDOWN","options":{"values":["Date Created (Newest First)","Date Created (Oldest First)","Date Modified (Newest First)","Date Modified (Oldest First)","Date Sent (Newest First)","Date Sent (Oldest First)","Date Completed (Newest First)","Date Completed (Oldest First)","Date Expiration (Newest First)","Date Expiration (Oldest First)","Date Declined (Newest First)","Date Declined (Oldest First)","Date Status Changed (Newest First)","Date Status Changed (Oldest First)","Date of Last Action (Newest First)","Date of Last Action (Oldest First)","Name (A to Z)","Name (Z to A)","Status (Ascending)","Status (Descending)"]}},"description":"Sort order for the results. Defaults to the PandaDoc API default (newest first)."}
   * @paramDef {"type":"Number","label":"Page Size","name":"count","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of documents per page (max 100). Defaults to 50."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to return, starting at 1."}
   * @returns {Object}
   * @sampleResult {"results":[{"id":"msFYActMfJHqNTKH8YSvF1","name":"Consulting Agreement - Acme","status":"document.sent","date_created":"2026-07-01T10:00:00.000000Z","date_modified":"2026-07-01T10:05:12.000000Z","expiration_date":null,"version":"2"}]}
   */
  async listDocuments(query, status, tag, folderUuid, templateId, createdFrom, createdTo, deleted, orderBy, count, page) {
    return await this.#apiRequest({
      logTag: '[listDocuments]',
      url: `${ API_BASE_URL }/documents`,
      query: {
        q: query,
        status: this.#resolveChoice(status, DOCUMENT_STATUS_MAP),
        tag,
        folder_uuid: folderUuid,
        template_id: templateId,
        created_from: createdFrom,
        created_to: createdTo,
        deleted,
        order_by: this.#resolveChoice(orderBy, ORDER_BY_MAP),
        count: count || DEFAULT_PAGE_SIZE,
        page,
      },
    })
  }

  /**
   * @operationName Get Document Status
   * @category Documents
   * @description Retrieves basic information about a document: id, name, current status (e.g. document.uploaded, document.draft, document.sent, document.completed), timestamps, and version. Useful for polling a freshly created document, which stays in document.uploaded for a few seconds before becoming document.draft and sendable.
   * @route GET /document-status
   * @appearanceColor #2F8A68 #4FAE8C
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"getDocumentsDictionary","description":"The document to check. Pick a document or paste its ID."}
   * @returns {Object}
   * @sampleResult {"id":"msFYActMfJHqNTKH8YSvF1","name":"Consulting Agreement - Acme","status":"document.draft","date_created":"2026-07-01T10:00:00.000000Z","date_modified":"2026-07-01T10:00:06.000000Z","expiration_date":null,"version":"1"}
   */
  async getDocumentStatus(documentId) {
    return await this.#apiRequest({
      logTag: '[getDocumentStatus]',
      url: `${ API_BASE_URL }/documents/${ documentId }`,
    })
  }

  /**
   * @operationName Get Document Details
   * @category Documents
   * @description Retrieves the full details of a document, including recipients with their completion status, tokens, fields with current values, pricing tables, grand total, tags, and creation metadata. Use this after a document is completed to read the values recipients filled in.
   * @route GET /document-details
   * @appearanceColor #2F8A68 #4FAE8C
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"getDocumentsDictionary","description":"The document to fetch. Pick a document or paste its ID."}
   * @returns {Object}
   * @sampleResult {"id":"msFYActMfJHqNTKH8YSvF1","name":"Consulting Agreement - Acme","status":"document.completed","date_created":"2026-07-01T10:00:00.000000Z","date_modified":"2026-07-02T09:12:00.000000Z","created_by":{"id":"FyXaS4SlT2FY7uLPqKD9f2","email":"owner@acme.com","first_name":"Jane","last_name":"Doe"},"recipients":[{"id":"a5YsGqeZxSrsGYzY8LSN5b","email":"client@example.com","first_name":"John","last_name":"Smith","role":"Client","has_completed":true}],"tokens":[{"name":"Client.Company","value":"Example Corp"}],"fields":[{"field_id":"signature_1","type":"signature","value":{"status":"filled"}}],"tags":["sales"],"grand_total":{"amount":"1500.00","currency":"USD"},"template":{"id":"ssdjWDdpsBnGDmKrfGrcp2","name":"Consulting Agreement"}}
   */
  async getDocumentDetails(documentId) {
    return await this.#apiRequest({
      logTag: '[getDocumentDetails]',
      url: `${ API_BASE_URL }/documents/${ documentId }/details`,
    })
  }

  /**
   * @typedef {Object} DocRecipient
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"description":"Recipient email address."}
   * @paramDef {"type":"String","label":"First Name","name":"first_name","description":"Recipient first name."}
   * @paramDef {"type":"String","label":"Last Name","name":"last_name","description":"Recipient last name."}
   * @paramDef {"type":"String","label":"Role","name":"role","description":"Template role to assign this recipient to (e.g. Client). Must match a role defined in the template. Leave empty for recipients without a role."}
   * @paramDef {"type":"Number","label":"Signing Order","name":"signing_order","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Position in the signing order (1 = signs first). Leave empty when signing order is not enforced."}
   */

  /**
   * @typedef {Object} DocToken
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Token (variable) name exactly as defined in the template, without square brackets (e.g. Client.Company)."}
   * @paramDef {"type":"String","label":"Value","name":"value","required":true,"description":"Text value to substitute for the token."}
   */

  /**
   * @operationName Create Document from Template
   * @category Documents
   * @description Creates a new document from a PandaDoc template, assigning recipients to template roles and pre-filling tokens (variables), fields, metadata, and pricing tables. The new document starts in the transient document.uploaded status and becomes document.draft after a few seconds of processing — use Send Document (which waits for draft automatically) or poll Get Document Status before sending.
   * @route POST /create-document-from-template
   * @appearanceColor #2F8A68 #4FAE8C
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Name for the new document."}
   * @paramDef {"type":"String","label":"Template","name":"templateUuid","required":true,"dictionary":"getTemplatesDictionary","description":"The template to create the document from. Pick a template or paste its ID."}
   * @paramDef {"type":"Array<DocRecipient>","label":"Recipients","name":"recipients","required":true,"description":"Document recipients. Assign each to a template role via the role property so they inherit that role's fields."}
   * @paramDef {"type":"Array<DocToken>","label":"Tokens","name":"tokens","description":"Values for template tokens (variables), e.g. Client.Company."}
   * @paramDef {"type":"Object","label":"Fields","name":"fields","description":"Pre-filled field values keyed by field ID, each as an object with a value property. Example: {\"delivery_date\":{\"value\":\"2026-08-01\"}}."}
   * @paramDef {"type":"Object","label":"Metadata","name":"metadata","description":"Arbitrary key/value metadata stored on the document, e.g. {\"crm_deal_id\":\"D-1042\"}. Not visible to recipients."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","description":"Tags to attach to the document for filtering and reporting."}
   * @paramDef {"type":"String","label":"Folder","name":"folderUuid","dictionary":"getDocumentFoldersDictionary","description":"Folder to place the document in. Defaults to the workspace root."}
   * @paramDef {"type":"Array<Object>","label":"Pricing Tables","name":"pricingTables","description":"Advanced: pricing table payloads matching the PandaDoc API structure ({\"name\":\"Pricing Table 1\",\"sections\":[{\"title\":\"...\",\"rows\":[...]}]}). See developers.pandadoc.com for the full schema."}
   * @returns {Object}
   * @sampleResult {"id":"msFYActMfJHqNTKH8YSvF1","name":"Consulting Agreement - Acme","status":"document.uploaded","date_created":"2026-07-01T10:00:00.000000Z","date_modified":"2026-07-01T10:00:00.000000Z","expiration_date":null,"uuid":"msFYActMfJHqNTKH8YSvF1","links":[{"rel":"self","href":"https://api.pandadoc.com/public/v1/documents/msFYActMfJHqNTKH8YSvF1","type":"GET"}]}
   */
  async createDocumentFromTemplate(name, templateUuid, recipients, tokens, fields, metadata, tags, folderUuid, pricingTables) {
    return await this.#apiRequest({
      logTag: '[createDocumentFromTemplate]',
      url: `${ API_BASE_URL }/documents`,
      method: 'post',
      body: clean({
        name,
        template_uuid: templateUuid,
        recipients,
        tokens,
        fields,
        metadata,
        tags,
        folder_uuid: folderUuid,
        pricing_tables: pricingTables,
      }),
    })
  }

  /**
   * @operationName Create Document from File
   * @category Documents
   * @description Creates a new document by uploading a file (PDF or DOCX) from FlowRunner file storage. Optionally parses form fields embedded in the file into PandaDoc fields. The new document starts in the transient document.uploaded status and becomes document.draft once processing finishes (file parsing can take several seconds) — use Send Document, which waits for draft automatically.
   * @route POST /create-document-from-file
   * @appearanceColor #2F8A68 #4FAE8C
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"File","name":"fileUrl","required":true,"uiComponent":{"type":"FILE_SELECTOR"},"description":"The FlowRunner file to upload (its URL). PDF or DOCX."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Name for the new document."}
   * @paramDef {"type":"Array<DocRecipient>","label":"Recipients","name":"recipients","required":true,"description":"Document recipients who will receive and sign the document."}
   * @paramDef {"type":"Boolean","label":"Parse Form Fields","name":"parseFormFields","uiComponent":{"type":"TOGGLE"},"description":"When enabled, PandaDoc converts form fields embedded in the uploaded file into PandaDoc fields."}
   * @paramDef {"type":"Object","label":"Fields","name":"fields","description":"Pre-filled field values keyed by field ID, each as an object with a value property. Example: {\"delivery_date\":{\"value\":\"2026-08-01\"}}."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","description":"Tags to attach to the document for filtering and reporting."}
   * @paramDef {"type":"String","label":"Folder","name":"folderUuid","dictionary":"getDocumentFoldersDictionary","description":"Folder to place the document in. Defaults to the workspace root."}
   * @returns {Object}
   * @sampleResult {"id":"msFYActMfJHqNTKH8YSvF1","name":"NDA - Example Corp","status":"document.uploaded","date_created":"2026-07-01T10:00:00.000000Z","date_modified":"2026-07-01T10:00:00.000000Z","expiration_date":null,"uuid":"msFYActMfJHqNTKH8YSvF1"}
   */
  async createDocumentFromFile(fileUrl, name, recipients, parseFormFields, fields, tags, folderUuid) {
    const logTag = '[createDocumentFromFile]'

    try {
      logger.debug(`${ logTag } - uploading file from ${ fileUrl }`)

      const fileName = decodeURIComponent(String(fileUrl).split('/').pop().split('?')[0]) || 'document.pdf'
      const fileBytes = this.#toBuffer(await Flowrunner.Request.get(fileUrl).setEncoding(null))

      const data = clean({
        name,
        recipients,
        fields,
        tags,
        folder_uuid: folderUuid,
        parse_form_fields: parseFormFields === true ? true : undefined,
      })

      // Do NOT set Content-Type manually — the form supplies the multipart boundary.
      const formData = new Flowrunner.Request.FormData()

      formData.append('data', JSON.stringify(data))
      formData.append('file', fileBytes, { filename: fileName })

      return await Flowrunner.Request.post(`${ API_BASE_URL }/documents`)
        .set(this.#authHeaders())
        .form(formData)
    } catch (error) {
      const message = this.#extractErrorMessage(error)

      logger.error(`${ logTag } - request failed: ${ message }`)

      throw new Error(`PandaDoc API error: ${ message }`)
    }
  }

  /**
   * @operationName Send Document
   * @category Documents
   * @description Sends a document to its recipients for review and signing. A freshly created document stays in the transient document.uploaded status for a few seconds; this action automatically polls the document every 2 seconds (up to 30 seconds) until it reaches document.draft before sending. Enable Silent to mark the document as sent without emailing the recipients (useful when sharing links yourself via Create Document Link).
   * @route POST /send-document
   * @appearanceColor #2F8A68 #4FAE8C
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"getDocumentsDictionary","description":"The document to send. Pick a document or paste its ID."}
   * @paramDef {"type":"String","label":"Email Subject","name":"subject","description":"Subject line of the email sent to recipients. Defaults to the PandaDoc standard subject."}
   * @paramDef {"type":"String","label":"Email Message","name":"message","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Message body of the email sent to recipients."}
   * @paramDef {"type":"Boolean","label":"Silent","name":"silent","uiComponent":{"type":"TOGGLE"},"description":"When enabled, the document is marked as sent but no emails are delivered to recipients."}
   * @returns {Object}
   * @sampleResult {"id":"msFYActMfJHqNTKH8YSvF1","name":"Consulting Agreement - Acme","status":"document.sent","date_created":"2026-07-01T10:00:00.000000Z","date_modified":"2026-07-01T10:02:00.000000Z","expiration_date":"2026-09-01T10:02:00.000000Z","uuid":"msFYActMfJHqNTKH8YSvF1","recipients":[{"id":"a5YsGqeZxSrsGYzY8LSN5b","email":"client@example.com","first_name":"John","last_name":"Smith","role":"Client","shared_link":"https://app.pandadoc.com/s/QYCPtavst3DqqBK72ZRtbF"}]}
   */
  async sendDocument(documentId, subject, message, silent) {
    // Documents cannot be sent while still in document.uploaded — wait for draft first.
    await this.#waitForDraft(documentId)

    return await this.#apiRequest({
      logTag: '[sendDocument]',
      url: `${ API_BASE_URL }/documents/${ documentId }/send`,
      method: 'post',
      body: clean({
        subject,
        message,
        silent: silent === true ? true : undefined,
      }),
    })
  }

  /**
   * @operationName Create Document Link
   * @category Documents
   * @description Creates a signing session for one recipient of a sent document and returns both the session ID and a ready-to-share link (https://app.pandadoc.com/s/{sessionId}). The document must already be sent (use Send Document with Silent enabled to avoid PandaDoc's own emails) and the email must match one of the document's recipients. The link expires after the given lifetime.
   * @route POST /create-document-link
   * @appearanceColor #2F8A68 #4FAE8C
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"getDocumentsDictionary","description":"The sent document to create a signing link for. Pick a document or paste its ID."}
   * @paramDef {"type":"String","label":"Recipient Email","name":"recipientEmail","required":true,"description":"Email address of the document recipient the link is for. Must match an existing recipient on the document."}
   * @paramDef {"type":"Number","label":"Lifetime (Seconds)","name":"lifetimeSeconds","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How long the link stays valid, in seconds. Defaults to 3600 (1 hour)."}
   * @returns {Object}
   * @sampleResult {"sessionId":"QYCPtavst3DqqBK72ZRtbF","expiresAt":"2026-07-01T11:00:00.000000Z","shareLink":"https://app.pandadoc.com/s/QYCPtavst3DqqBK72ZRtbF"}
   */
  async createDocumentLink(documentId, recipientEmail, lifetimeSeconds) {
    const session = await this.#apiRequest({
      logTag: '[createDocumentLink]',
      url: `${ API_BASE_URL }/documents/${ documentId }/session`,
      method: 'post',
      body: clean({
        recipient: recipientEmail,
        lifetime: lifetimeSeconds,
      }),
    })

    return {
      sessionId: session.id,
      expiresAt: session.expires_at,
      shareLink: `${ SHARE_LINK_BASE_URL }/${ session.id }`,
    }
  }

  /**
   * @operationName Download Document PDF
   * @category Documents
   * @description Downloads a document as a PDF, saves it to FlowRunner file storage, and returns the stored file's URL. Optionally stamps a text watermark with configurable color, font size, and opacity onto every page. Works for documents in draft, sent, and completed states.
   * @route GET /download-document-pdf
   * @appearanceColor #2F8A68 #4FAE8C
   * @executionTimeoutInSeconds 60
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"getDocumentsDictionary","description":"The document to download. Pick a document or paste its ID."}
   * @paramDef {"type":"String","label":"Watermark Text","name":"watermarkText","description":"Optional text stamped across every page of the PDF (e.g. CONFIDENTIAL)."}
   * @paramDef {"type":"String","label":"Watermark Color","name":"watermarkColor","description":"Watermark color as a HEX value, e.g. #FF5733. Used only when Watermark Text is set."}
   * @paramDef {"type":"Number","label":"Watermark Font Size","name":"watermarkFontSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Watermark font size in points. Used only when Watermark Text is set."}
   * @paramDef {"type":"Number","label":"Watermark Opacity","name":"watermarkOpacity","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Watermark opacity between 0 and 1 (e.g. 0.5). Used only when Watermark Text is set."}
   * @paramDef {"type":"FilesUploadOptions","name":"fileOptions","label":"File Settings","required":false,"include":["scope"]}
   * @returns {Object}
   * @sampleResult {"fileName":"Consulting Agreement - Acme.pdf","sizeBytes":184320,"url":"https://files.flowrunner.com/abc123/Consulting%20Agreement%20-%20Acme.pdf"}
   */
  async downloadDocumentPdf(documentId, watermarkText, watermarkColor, watermarkFontSize, watermarkOpacity, fileOptions) {
    const logTag = '[downloadDocumentPdf]'

    try {
      const info = await this.getDocumentStatus(documentId)

      logger.debug(`${ logTag } - downloading document ${ documentId }`)

      const pdfBytes = await Flowrunner.Request.get(`${ API_BASE_URL }/documents/${ documentId }/download`)
        .set(this.#authHeaders())
        .query(clean({
          watermark_text: watermarkText,
          watermark_color: watermarkColor,
          watermark_font_size: watermarkFontSize,
          watermark_opacity: watermarkOpacity,
        }))
        .setEncoding(null)

      const buffer = Buffer.isBuffer(pdfBytes) ? pdfBytes : Buffer.from(pdfBytes)
      const fileName = `${ info.name || documentId }.pdf`

      const { url } = await this.flowrunner.Files.uploadFile(buffer, {
        filename: fileName, // hardcoded
        generateUrl: true, // hardcoded — REQUIRED or url is null
        overwrite: true, // hardcoded
        ...(fileOptions || { scope: 'FLOW' }),
      })

      return {
        fileName,
        sizeBytes: buffer.length,
        url,
      }
    } catch (error) {
      const message = this.#extractErrorMessage(error)

      logger.error(`${ logTag } - request failed: ${ message }`)

      throw new Error(`PandaDoc API error: ${ message }`)
    }
  }

  /**
   * @operationName Update Document Name
   * @category Documents
   * @description Renames a document. Only documents in the document.draft status can be updated; sent or completed documents cannot be renamed via the API.
   * @route PATCH /update-document-name
   * @appearanceColor #2F8A68 #4FAE8C
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"getDocumentsDictionary","description":"The draft document to rename. Pick a document or paste its ID."}
   * @paramDef {"type":"String","label":"New Name","name":"name","required":true,"description":"The new document name."}
   * @returns {Object}
   * @sampleResult {"success":true,"documentId":"msFYActMfJHqNTKH8YSvF1","name":"Consulting Agreement - Acme (Rev 2)"}
   */
  async updateDocumentName(documentId, name) {
    await this.#apiRequest({
      logTag: '[updateDocumentName]',
      url: `${ API_BASE_URL }/documents/${ documentId }`,
      method: 'patch',
      body: { name },
    })

    // The API returns 204 No Content on success.
    return { success: true, documentId, name }
  }

  /**
   * @operationName Delete Document
   * @category Documents
   * @description Permanently deletes a document from the workspace. This cannot be undone via the API.
   * @route DELETE /delete-document
   * @appearanceColor #2F8A68 #4FAE8C
   * @paramDef {"type":"String","label":"Document","name":"documentId","required":true,"dictionary":"getDocumentsDictionary","description":"The document to delete. Pick a document or paste its ID."}
   * @returns {Object}
   * @sampleResult {"success":true,"documentId":"msFYActMfJHqNTKH8YSvF1"}
   */
  async deleteDocument(documentId) {
    await this.#apiRequest({
      logTag: '[deleteDocument]',
      url: `${ API_BASE_URL }/documents/${ documentId }`,
      method: 'delete',
    })

    return { success: true, documentId }
  }

  // ==========================================================================
  //  TEMPLATES
  // ==========================================================================

  /**
   * @operationName List Templates
   * @category Templates
   * @description Lists templates in the workspace with optional filtering by search text, tag, and template folder. Returns up to 100 templates per page (default 50) with id, name, version, and timestamps; use Get Template Details for a template's roles, tokens, and fields.
   * @route GET /templates
   * @appearanceColor #2F8A68 #4FAE8C
   * @paramDef {"type":"String","label":"Search","name":"query","description":"Search templates by name."}
   * @paramDef {"type":"String","label":"Tag","name":"tag","description":"Only return templates with this tag."}
   * @paramDef {"type":"String","label":"Template Folder UUID","name":"folderUuid","description":"Only return templates stored in this template folder. Find UUIDs with List Template Folders."}
   * @paramDef {"type":"Number","label":"Page Size","name":"count","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of templates per page (max 100). Defaults to 50."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to return, starting at 1."}
   * @returns {Object}
   * @sampleResult {"results":[{"id":"ssdjWDdpsBnGDmKrfGrcp2","name":"Consulting Agreement","version":"3","date_created":"2026-01-10T09:00:00.000000Z","date_modified":"2026-06-20T14:30:00.000000Z"}]}
   */
  async listTemplates(query, tag, folderUuid, count, page) {
    return await this.#apiRequest({
      logTag: '[listTemplates]',
      url: `${ API_BASE_URL }/templates`,
      query: {
        q: query,
        tag,
        folder_uuid: folderUuid,
        count: count || DEFAULT_PAGE_SIZE,
        page,
      },
    })
  }

  /**
   * @operationName Get Template Details
   * @category Templates
   * @description Retrieves the full details of a template, including its roles (needed to assign recipients in Create Document from Template), tokens (variables), fields, pricing tables, and content placeholders.
   * @route GET /template-details
   * @appearanceColor #2F8A68 #4FAE8C
   * @paramDef {"type":"String","label":"Template","name":"templateId","required":true,"dictionary":"getTemplatesDictionary","description":"The template to fetch. Pick a template or paste its ID."}
   * @returns {Object}
   * @sampleResult {"id":"ssdjWDdpsBnGDmKrfGrcp2","name":"Consulting Agreement","version":"3","created_by":{"id":"FyXaS4SlT2FY7uLPqKD9f2","email":"owner@acme.com"},"date_created":"2026-01-10T09:00:00.000000Z","date_modified":"2026-06-20T14:30:00.000000Z","roles":[{"id":"aRoLe1","name":"Client","signing_order":null}],"tokens":[{"name":"Client.Company","value":""}],"fields":[{"field_id":"signature_1","type":"signature","assigned_to":{"type":"role","name":"Client"}}],"tags":["sales"]}
   */
  async getTemplateDetails(templateId) {
    return await this.#apiRequest({
      logTag: '[getTemplateDetails]',
      url: `${ API_BASE_URL }/templates/${ templateId }/details`,
    })
  }

  // ==========================================================================
  //  CONTACTS
  // ==========================================================================

  /**
   * @operationName List Contacts
   * @category Contacts
   * @description Lists all contacts in the workspace, optionally filtered by exact email address. Contacts store recipient details (name, company, address) that PandaDoc reuses when adding them to documents.
   * @route GET /contacts
   * @appearanceColor #2F8A68 #4FAE8C
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Only return the contact with this exact email address."}
   * @returns {Object}
   * @sampleResult {"results":[{"id":"y8YP3fMkDcSkkQEXvXWCLi","email":"client@example.com","first_name":"John","last_name":"Smith","company":"Example Corp","job_title":"CTO","phone":"+14155550101","state":"CA","street_address":"100 Market St","city":"San Francisco","postal_code":"94105"}]}
   */
  async listContacts(email) {
    return await this.#apiRequest({
      logTag: '[listContacts]',
      url: `${ API_BASE_URL }/contacts`,
      query: { email },
    })
  }

  /**
   * @operationName Get Contact
   * @category Contacts
   * @description Retrieves a single contact by ID, including email, name, company, job title, phone, and address fields.
   * @route GET /contact
   * @appearanceColor #2F8A68 #4FAE8C
   * @paramDef {"type":"String","label":"Contact","name":"contactId","required":true,"dictionary":"getContactsDictionary","description":"The contact to fetch. Pick a contact or paste its ID."}
   * @returns {Object}
   * @sampleResult {"id":"y8YP3fMkDcSkkQEXvXWCLi","email":"client@example.com","first_name":"John","last_name":"Smith","company":"Example Corp","job_title":"CTO","phone":"+14155550101","state":"CA","street_address":"100 Market St","city":"San Francisco","postal_code":"94105"}
   */
  async getContact(contactId) {
    return await this.#apiRequest({
      logTag: '[getContact]',
      url: `${ API_BASE_URL }/contacts/${ contactId }`,
    })
  }

  /**
   * @operationName Create Contact
   * @category Contacts
   * @description Creates a new contact in the workspace. Only the email address is required; name, company, and address details are reused by PandaDoc whenever the contact is added to a document.
   * @route POST /create-contact
   * @appearanceColor #2F8A68 #4FAE8C
   * @paramDef {"type":"String","label":"Email","name":"email","required":true,"description":"Contact email address. Must be unique within the workspace."}
   * @paramDef {"type":"String","label":"First Name","name":"firstName","description":"Contact first name."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","description":"Contact last name."}
   * @paramDef {"type":"String","label":"Company","name":"company","description":"Company the contact works for."}
   * @paramDef {"type":"String","label":"Job Title","name":"jobTitle","description":"Contact job title."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"Contact phone number."}
   * @paramDef {"type":"String","label":"Street Address","name":"streetAddress","description":"Street address."}
   * @paramDef {"type":"String","label":"City","name":"city","description":"City."}
   * @paramDef {"type":"String","label":"State","name":"state","description":"State or region."}
   * @paramDef {"type":"String","label":"Postal Code","name":"postalCode","description":"Postal or ZIP code."}
   * @returns {Object}
   * @sampleResult {"id":"y8YP3fMkDcSkkQEXvXWCLi","email":"client@example.com","first_name":"John","last_name":"Smith","company":"Example Corp","job_title":"CTO","phone":"+14155550101","state":"CA","street_address":"100 Market St","city":"San Francisco","postal_code":"94105"}
   */
  async createContact(email, firstName, lastName, company, jobTitle, phone, streetAddress, city, state, postalCode) {
    return await this.#apiRequest({
      logTag: '[createContact]',
      url: `${ API_BASE_URL }/contacts`,
      method: 'post',
      body: clean({
        email,
        first_name: firstName,
        last_name: lastName,
        company,
        job_title: jobTitle,
        phone,
        street_address: streetAddress,
        city,
        state,
        postal_code: postalCode,
      }),
    })
  }

  /**
   * @operationName Update Contact
   * @category Contacts
   * @description Updates an existing contact. Only the provided fields are changed; fields left empty keep their current values.
   * @route PATCH /update-contact
   * @appearanceColor #2F8A68 #4FAE8C
   * @paramDef {"type":"String","label":"Contact","name":"contactId","required":true,"dictionary":"getContactsDictionary","description":"The contact to update. Pick a contact or paste its ID."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"New email address."}
   * @paramDef {"type":"String","label":"First Name","name":"firstName","description":"New first name."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","description":"New last name."}
   * @paramDef {"type":"String","label":"Company","name":"company","description":"New company."}
   * @paramDef {"type":"String","label":"Job Title","name":"jobTitle","description":"New job title."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"New phone number."}
   * @paramDef {"type":"String","label":"Street Address","name":"streetAddress","description":"New street address."}
   * @paramDef {"type":"String","label":"City","name":"city","description":"New city."}
   * @paramDef {"type":"String","label":"State","name":"state","description":"New state or region."}
   * @paramDef {"type":"String","label":"Postal Code","name":"postalCode","description":"New postal or ZIP code."}
   * @returns {Object}
   * @sampleResult {"id":"y8YP3fMkDcSkkQEXvXWCLi","email":"client@example.com","first_name":"John","last_name":"Smith","company":"Example Corp","job_title":"VP Engineering","phone":"+14155550101","state":"CA","street_address":"100 Market St","city":"San Francisco","postal_code":"94105"}
   */
  async updateContact(contactId, email, firstName, lastName, company, jobTitle, phone, streetAddress, city, state, postalCode) {
    return await this.#apiRequest({
      logTag: '[updateContact]',
      url: `${ API_BASE_URL }/contacts/${ contactId }`,
      method: 'patch',
      body: clean({
        email,
        first_name: firstName,
        last_name: lastName,
        company,
        job_title: jobTitle,
        phone,
        street_address: streetAddress,
        city,
        state,
        postal_code: postalCode,
      }),
    })
  }

  /**
   * @operationName Delete Contact
   * @category Contacts
   * @description Permanently deletes a contact from the workspace. Documents the contact already appears on are not affected.
   * @route DELETE /delete-contact
   * @appearanceColor #2F8A68 #4FAE8C
   * @paramDef {"type":"String","label":"Contact","name":"contactId","required":true,"dictionary":"getContactsDictionary","description":"The contact to delete. Pick a contact or paste its ID."}
   * @returns {Object}
   * @sampleResult {"success":true,"contactId":"y8YP3fMkDcSkkQEXvXWCLi"}
   */
  async deleteContact(contactId) {
    await this.#apiRequest({
      logTag: '[deleteContact]',
      url: `${ API_BASE_URL }/contacts/${ contactId }`,
      method: 'delete',
    })

    return { success: true, contactId }
  }

  // ==========================================================================
  //  FOLDERS
  // ==========================================================================

  /**
   * @operationName List Document Folders
   * @category Folders
   * @description Lists document folders in the workspace. Pass a parent folder UUID to list its subfolders, or leave it empty to list root-level folders. Folder UUIDs are used to file documents with Create Document from Template/File and to filter List Documents.
   * @route GET /document-folders
   * @appearanceColor #2F8A68 #4FAE8C
   * @paramDef {"type":"String","label":"Parent Folder","name":"parentUuid","dictionary":"getDocumentFoldersDictionary","description":"List subfolders of this folder. Leave empty for root-level folders."}
   * @paramDef {"type":"Number","label":"Page Size","name":"count","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of folders per page (max 100). Defaults to 50."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to return, starting at 1."}
   * @returns {Object}
   * @sampleResult {"results":[{"uuid":"NidQL9bqbdrjjBrE3BFCJb","name":"Sales Contracts","date_created":"2026-02-01T08:00:00.000000Z","has_folders":false,"has_items":true}]}
   */
  async listDocumentFolders(parentUuid, count, page) {
    return await this.#apiRequest({
      logTag: '[listDocumentFolders]',
      url: `${ API_BASE_URL }/documents/folders`,
      query: {
        parent_uuid: parentUuid,
        count: count || DEFAULT_PAGE_SIZE,
        page,
      },
    })
  }

  /**
   * @operationName Create Document Folder
   * @category Folders
   * @description Creates a new document folder, optionally nested inside an existing parent folder. Returns the new folder's UUID for use when creating or filtering documents.
   * @route POST /create-document-folder
   * @appearanceColor #2F8A68 #4FAE8C
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Name of the new folder."}
   * @paramDef {"type":"String","label":"Parent Folder","name":"parentUuid","dictionary":"getDocumentFoldersDictionary","description":"Folder to create the new folder inside. Leave empty to create it at the root level."}
   * @returns {Object}
   * @sampleResult {"uuid":"NidQL9bqbdrjjBrE3BFCJb","name":"Sales Contracts","date_created":"2026-02-01T08:00:00.000000Z"}
   */
  async createDocumentFolder(name, parentUuid) {
    return await this.#apiRequest({
      logTag: '[createDocumentFolder]',
      url: `${ API_BASE_URL }/documents/folders`,
      method: 'post',
      body: clean({
        name,
        parent_uuid: parentUuid,
      }),
    })
  }

  /**
   * @operationName List Template Folders
   * @category Folders
   * @description Lists template folders in the workspace. Pass a parent folder UUID to list its subfolders, or leave it empty to list root-level folders. Template folder UUIDs can be used to filter List Templates.
   * @route GET /template-folders
   * @appearanceColor #2F8A68 #4FAE8C
   * @paramDef {"type":"String","label":"Parent Folder UUID","name":"parentUuid","description":"List subfolders of this template folder. Leave empty for root-level folders."}
   * @paramDef {"type":"Number","label":"Page Size","name":"count","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of folders per page (max 100). Defaults to 50."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to return, starting at 1."}
   * @returns {Object}
   * @sampleResult {"results":[{"uuid":"BhVzXcMc3CBr2jq44hjBrE","name":"Agreements","date_created":"2026-01-05T08:00:00.000000Z","has_folders":false,"has_items":true}]}
   */
  async listTemplateFolders(parentUuid, count, page) {
    return await this.#apiRequest({
      logTag: '[listTemplateFolders]',
      url: `${ API_BASE_URL }/templates/folders`,
      query: {
        parent_uuid: parentUuid,
        count: count || DEFAULT_PAGE_SIZE,
        page,
      },
    })
  }

  // ==========================================================================
  //  MEMBERS
  // ==========================================================================

  /**
   * @operationName List Members
   * @category Members
   * @description Lists all workspace members with their membership ID, user ID, email, name, role, and active status. Membership IDs can be used to filter documents by owner and with Get Member.
   * @route GET /members
   * @appearanceColor #2F8A68 #4FAE8C
   * @returns {Object}
   * @sampleResult {"results":[{"user_id":"FyXaS4SlT2FY7uLPqKD9f2","membership_id":"pFqCsvGiJHmSDwqjBiKDWc","email":"owner@acme.com","first_name":"Jane","last_name":"Doe","role":"Admin","workspace":"Acme Workspace","is_active":true,"date_created":"2025-11-01T09:00:00.000000Z"}]}
   */
  async listMembers() {
    return await this.#apiRequest({
      logTag: '[listMembers]',
      url: `${ API_BASE_URL }/members`,
    })
  }

  /**
   * @operationName Get Member
   * @category Members
   * @description Retrieves the details of a single workspace member by membership ID, including email, name, role, and active status.
   * @route GET /member
   * @appearanceColor #2F8A68 #4FAE8C
   * @paramDef {"type":"String","label":"Membership ID","name":"membershipId","required":true,"description":"The membership ID of the member to fetch. Find it with List Members."}
   * @returns {Object}
   * @sampleResult {"user_id":"FyXaS4SlT2FY7uLPqKD9f2","membership_id":"pFqCsvGiJHmSDwqjBiKDWc","email":"owner@acme.com","first_name":"Jane","last_name":"Doe","role":"Admin","workspace":"Acme Workspace","is_active":true,"date_created":"2025-11-01T09:00:00.000000Z"}
   */
  async getMember(membershipId) {
    return await this.#apiRequest({
      logTag: '[getMember]',
      url: `${ API_BASE_URL }/members/${ membershipId }`,
    })
  }

  // ==========================================================================
  //  WEBHOOKS
  // ==========================================================================

  /**
   * @operationName List Webhook Subscriptions
   * @category Webhooks
   * @description Lists all webhook subscriptions configured for the workspace, including each subscription's UUID, target URL, subscribed trigger events, extra payload sections, and active status.
   * @route GET /webhook-subscriptions
   * @appearanceColor #2F8A68 #4FAE8C
   * @returns {Object}
   * @sampleResult {"items":[{"uuid":"9e37a3f5-63f2-4dc3-b255-2e6dc0e0dd39","name":"CRM Sync","url":"https://example.com/pandadoc-webhook","active":true,"triggers":["document_state_changed","recipient_completed"],"payload":["fields","tokens"]}]}
   */
  async listWebhookSubscriptions() {
    return await this.#apiRequest({
      logTag: '[listWebhookSubscriptions]',
      url: `${ API_BASE_URL }/webhook-subscriptions`,
    })
  }

  /**
   * @operationName Create Webhook Subscription
   * @category Webhooks
   * @description Creates a webhook subscription that POSTs event notifications to your URL when the selected events occur (document state changes, recipient completion, document updates/deletions, or creation failures). Optionally include extra payload sections (fields, tokens, products, pricing) in the notification body. Returns the subscription with its UUID and the shared key used to verify webhook signatures.
   * @route POST /create-webhook-subscription
   * @appearanceColor #2F8A68 #4FAE8C
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Display name for the subscription."}
   * @paramDef {"type":"String","label":"URL","name":"url","required":true,"description":"HTTPS endpoint that will receive the webhook POST notifications."}
   * @paramDef {"type":"Array<String>","label":"Triggers","name":"triggers","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Document State Changed","Recipient Completed","Document Updated","Document Deleted","Document Creation Failed"]}},"description":"Events that fire the webhook. Select one or more."}
   * @paramDef {"type":"Array<String>","label":"Extra Payload","name":"payload","uiComponent":{"type":"DROPDOWN","options":{"values":["Fields","Tokens","Products","Pricing"]}},"description":"Additional document data sections to include in each notification body."}
   * @returns {Object}
   * @sampleResult {"uuid":"9e37a3f5-63f2-4dc3-b255-2e6dc0e0dd39","name":"CRM Sync","url":"https://example.com/pandadoc-webhook","active":true,"triggers":["document_state_changed","recipient_completed"],"payload":["fields","tokens"],"shared_key":"gJhsdgfSJFGsdfgSDFGsdfg"}
   */
  async createWebhookSubscription(name, url, triggers, payload) {
    return await this.#apiRequest({
      logTag: '[createWebhookSubscription]',
      url: `${ API_BASE_URL }/webhook-subscriptions`,
      method: 'post',
      body: clean({
        name,
        url,
        triggers: (triggers || []).map(trigger => this.#resolveChoice(trigger, WEBHOOK_TRIGGER_MAP)),
        payload: payload && payload.length
          ? payload.map(section => this.#resolveChoice(section, WEBHOOK_PAYLOAD_MAP))
          : undefined,
      }),
    })
  }

  /**
   * @operationName Delete Webhook Subscription
   * @category Webhooks
   * @description Permanently deletes a webhook subscription so its URL stops receiving event notifications.
   * @route DELETE /delete-webhook-subscription
   * @appearanceColor #2F8A68 #4FAE8C
   * @paramDef {"type":"String","label":"Subscription UUID","name":"uuid","required":true,"description":"UUID of the webhook subscription to delete. Find it with List Webhook Subscriptions."}
   * @returns {Object}
   * @sampleResult {"success":true,"uuid":"9e37a3f5-63f2-4dc3-b255-2e6dc0e0dd39"}
   */
  async deleteWebhookSubscription(uuid) {
    await this.#apiRequest({
      logTag: '[deleteWebhookSubscription]',
      url: `${ API_BASE_URL }/webhook-subscriptions/${ uuid }`,
      method: 'delete',
    })

    return { success: true, uuid }
  }

  // ==========================================================================
  //  API LOGS
  // ==========================================================================

  /**
   * @operationName List API Log Events
   * @category API Logs
   * @description Lists recent PandaDoc API request logs for the account, filterable by time range, HTTP response status codes, and HTTP methods. Useful for debugging integration issues. Use Get API Log Event with a log ID for full request/response details.
   * @route GET /api-logs
   * @appearanceColor #2F8A68 #4FAE8C
   * @paramDef {"type":"String","label":"Since","name":"since","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Only return log events at or after this date/time (ISO 8601)."}
   * @paramDef {"type":"String","label":"To","name":"to","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Only return log events at or before this date/time (ISO 8601)."}
   * @paramDef {"type":"Array<Number>","label":"Status Codes","name":"statuses","description":"Only return requests with these HTTP response status codes (e.g. 200, 400, 404)."}
   * @paramDef {"type":"Array<String>","label":"Methods","name":"methods","uiComponent":{"type":"DROPDOWN","options":{"values":["GET","POST","PUT","PATCH","DELETE"]}},"description":"Only return requests made with these HTTP methods."}
   * @paramDef {"type":"Number","label":"Page Size","name":"count","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of log events per page (max 100). Defaults to 50."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to return, starting at 1."}
   * @returns {Object}
   * @sampleResult {"results":[{"id":"GDsxrCdJ9vXFYw6KYfLDgo","url":"/public/v1/documents","method":"POST","status":201,"request_time":"2026-07-01T10:00:00.000000Z","response_time":"2026-07-01T10:00:01.000000Z","token_type":"api_key"}]}
   */
  async listApiLogEvents(since, to, statuses, methods, count, page) {
    return await this.#apiRequest({
      logTag: '[listApiLogEvents]',
      url: `${ API_BASE_URL }/logs`,
      query: {
        since,
        to,
        statuses: statuses && statuses.length ? statuses : undefined,
        methods: methods && methods.length ? methods : undefined,
        count: count || DEFAULT_PAGE_SIZE,
        page,
      },
    })
  }

  /**
   * @operationName Get API Log Event
   * @category API Logs
   * @description Retrieves the full details of a single API log event, including the request URL, method, response status, timing, and the request/response bodies. Useful for diagnosing why a specific API call failed.
   * @route GET /api-log-event
   * @appearanceColor #2F8A68 #4FAE8C
   * @paramDef {"type":"String","label":"Log Event ID","name":"logId","required":true,"description":"ID of the log event to fetch. Find it with List API Log Events."}
   * @returns {Object}
   * @sampleResult {"id":"GDsxrCdJ9vXFYw6KYfLDgo","url":"/public/v1/documents","method":"POST","status":201,"request_time":"2026-07-01T10:00:00.000000Z","response_time":"2026-07-01T10:00:01.000000Z","token_type":"api_key","request_body":"{\"name\":\"Consulting Agreement - Acme\"}","response_body":"{\"id\":\"msFYActMfJHqNTKH8YSvF1\",\"status\":\"document.uploaded\"}"}
   */
  async getApiLogEvent(logId) {
    return await this.#apiRequest({
      logTag: '[getApiLogEvent]',
      url: `${ API_BASE_URL }/logs/${ logId }`,
    })
  }

  // ==========================================================================
  //  DICTIONARIES
  // ==========================================================================

  /**
   * @typedef {Object} getTemplatesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Text to filter templates by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (page number) returned by the previous call."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Templates Dictionary
   * @description Provides a searchable, paginated list of workspace templates for selecting a template in document creation and filtering operations. The option value is the template ID.
   * @route POST /get-templates-dictionary
   * @paramDef {"type":"getTemplatesDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Consulting Agreement","value":"ssdjWDdpsBnGDmKrfGrcp2","note":"Modified 2026-06-20"}],"cursor":"2"}
   */
  async getTemplatesDictionary(payload) {
    const { search, cursor } = payload || {}
    const page = parseInt(cursor, 10) || 1

    const response = await this.#apiRequest({
      logTag: '[getTemplatesDictionary]',
      url: `${ API_BASE_URL }/templates`,
      query: {
        q: search,
        count: DEFAULT_PAGE_SIZE,
        page,
      },
    })

    const results = response.results || []

    return {
      items: results.map(template => ({
        label: template.name,
        value: template.id,
        note: template.date_modified ? `Modified ${ String(template.date_modified).slice(0, 10) }` : undefined,
      })),
      cursor: results.length === DEFAULT_PAGE_SIZE ? String(page + 1) : null,
    }
  }

  /**
   * @typedef {Object} getDocumentFoldersDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Text to filter folders by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (page number) returned by the previous call."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Document Folders Dictionary
   * @description Provides a paginated list of root-level document folders for selecting a folder when creating or filtering documents. The option value is the folder UUID. The API lists one level at a time; paste a UUID directly for nested folders.
   * @route POST /get-document-folders-dictionary
   * @paramDef {"type":"getDocumentFoldersDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Sales Contracts","value":"NidQL9bqbdrjjBrE3BFCJb","note":"Created 2026-02-01"}],"cursor":null}
   */
  async getDocumentFoldersDictionary(payload) {
    const { search, cursor } = payload || {}
    const page = parseInt(cursor, 10) || 1

    const response = await this.#apiRequest({
      logTag: '[getDocumentFoldersDictionary]',
      url: `${ API_BASE_URL }/documents/folders`,
      query: {
        count: DEFAULT_PAGE_SIZE,
        page,
      },
    })

    const results = response.results || []
    const needle = search ? String(search).toLowerCase() : null
    const filtered = needle
      ? results.filter(folder => (folder.name || '').toLowerCase().includes(needle))
      : results

    return {
      items: filtered.map(folder => ({
        label: folder.name,
        value: folder.uuid,
        note: folder.date_created ? `Created ${ String(folder.date_created).slice(0, 10) }` : undefined,
      })),
      cursor: results.length === DEFAULT_PAGE_SIZE ? String(page + 1) : null,
    }
  }

  /**
   * @typedef {Object} getContactsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Text to filter contacts by name, email, or company."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. The contacts API returns all contacts in one call, so this is unused but kept for API compatibility."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Contacts Dictionary
   * @description Provides a searchable list of workspace contacts for selecting a contact in contact operations. The option value is the contact ID. Filtering by name, email, or company is applied client-side because the PandaDoc contacts list is not paginated.
   * @route POST /get-contacts-dictionary
   * @paramDef {"type":"getContactsDictionary__payload","label":"Payload","name":"payload","description":"Search input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"John Smith (client@example.com)","value":"y8YP3fMkDcSkkQEXvXWCLi","note":"Example Corp"}],"cursor":null}
   */
  async getContactsDictionary(payload) {
    const { search } = payload || {}

    const response = await this.#apiRequest({
      logTag: '[getContactsDictionary]',
      url: `${ API_BASE_URL }/contacts`,
    })

    const results = response.results || []
    const needle = search ? String(search).toLowerCase() : null
    const filtered = needle
      ? results.filter(contact =>
        [contact.email, contact.first_name, contact.last_name, contact.company]
          .filter(Boolean)
          .some(value => String(value).toLowerCase().includes(needle))
      )
      : results

    return {
      items: filtered.map(contact => {
        const fullName = [contact.first_name, contact.last_name].filter(Boolean).join(' ')

        return {
          label: fullName ? `${ fullName } (${ contact.email })` : contact.email,
          value: contact.id,
          note: contact.company || undefined,
        }
      }),
      cursor: null,
    }
  }

  /**
   * @typedef {Object} getDocumentsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Text to filter documents by name or reference number."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (page number) returned by the previous call."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Documents Dictionary
   * @description Provides a searchable, paginated list of documents (most recently created first) for selecting a document in send, download, session, and other document operations. The option value is the document ID and the note shows the document's current status.
   * @route POST /get-documents-dictionary
   * @paramDef {"type":"getDocumentsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Consulting Agreement - Acme","value":"msFYActMfJHqNTKH8YSvF1","note":"document.sent"}],"cursor":"2"}
   */
  async getDocumentsDictionary(payload) {
    const { search, cursor } = payload || {}
    const page = parseInt(cursor, 10) || 1

    const response = await this.#apiRequest({
      logTag: '[getDocumentsDictionary]',
      url: `${ API_BASE_URL }/documents`,
      query: {
        q: search,
        order_by: '-date_created',
        count: DEFAULT_PAGE_SIZE,
        page,
      },
    })

    const results = response.results || []

    return {
      items: results.map(document => ({
        label: document.name,
        value: document.id,
        note: document.status || undefined,
      })),
      cursor: results.length === DEFAULT_PAGE_SIZE ? String(page + 1) : null,
    }
  }
}

Flowrunner.ServerCode.addService(PandaDocService, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your PandaDoc API key, sent as "Authorization: API-Key <key>". Get it in PandaDoc under Settings > API & Integrations. A sandbox key is free and instant; a production key requires an API-enabled plan.',
  },
])
