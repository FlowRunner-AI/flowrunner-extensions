'use strict'

const logger = {
  info: (...args) => console.log('[TurboDocx Service] info:', ...args),
  debug: (...args) => console.log('[TurboDocx Service] debug:', ...args),
  error: (...args) => console.log('[TurboDocx Service] error:', ...args),
  warn: (...args) => console.log('[TurboDocx Service] warn:', ...args),
}

const API_BASE_URL = 'https://api.turbodocx.com'

/**
 * @integrationName TurboDocx
 * @integrationIcon /icon.svg
 * @usesFileStorage
 */
class TurboDocxService {
  constructor(config) {
    this.apiKey = config.apiKey
    this.orgId = config.orgId
  }

  async #apiRequest({ url, method, body, form, query, logTag }) {
    method = method || 'get'

    try {
      logger.debug(`${ logTag } - api request: [${ method }::${ url }] q=[${ JSON.stringify(query) }]`)

      const request = Flowrunner.Request[method](url)
        .set({
          'Authorization': `Bearer ${ this.apiKey }`,
          'x-rapiddocx-org-id': this.orgId,
          'User-Agent': 'TurboDocx API Client',
        })
        .query(query)

      if (form) {
        request.set({ 'Content-Type': 'multipart/form-data' })
        request.form(form)

        return await request
      }

      if (body) {
        return await request.send(body)
      }

      return await request
    } catch (error) {
      const message = error.message && typeof error.message === 'string'
        ? error.message
        : JSON.stringify(error.message)

      logger.error(`${ logTag } - Failed to execute ${ url }, Error: ${ message } ${ error.stack }`)
      throw new Error(`TurboDocx API error: ${ message }`)
    }
  }

  #buildVariablesPayload(variablesObj) {
    if (!variablesObj || typeof variablesObj !== 'object') {
      return []
    }

    return Object.entries(variablesObj).map(([key, value]) => ({
      name: key,
      placeholder: `{${ key }}`,
      text: String(value),
      mimeType: 'text',
    }))
  }

  // ============================================
  // DICTIONARY METHODS
  // ============================================

  /**
   * @typedef {Object} getTemplatesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter templates by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for retrieving the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Templates Dictionary
   * @description Provides a searchable list of available TurboDocx templates for dropdown selection in action parameters.
   * @route POST /get-templates-dictionary
   * @paramDef {"type":"getTemplatesDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering templates."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Sales Proposal","value":"tmpl_abc123","note":"ID: tmpl_abc123"}],"cursor":null}
   */
  async getTemplatesDictionary(payload) {
    const { search, cursor } = payload || {}
    const logTag = '[getTemplatesDictionary]'

    const offset = cursor ? Number(cursor) : 0
    const limit = 50

    const queryParams = { limit, offset }

    if (search) {
      queryParams.query = search
    }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/template-item`,
      query: queryParams,
      logTag,
    })

    const results = response.data?.results || []

    const templates = results.filter(item => item.type === 'template')

    const outputItems = templates.map(template => ({
      label: template.name || `Template ${ template.id }`,
      value: template.id,
      note: `ID: ${ template.id }`,
    }))

    const totalRecords = response.data?.totalRecords || 0
    const nextOffset = offset + limit
    const nextCursor = nextOffset < totalRecords ? String(nextOffset) : null

    return {
      items: outputItems,
      cursor: nextCursor,
    }
  }

  // ============================================
  // TEMPLATE METHODS
  // ============================================

  /**
   * @operationName Get Template Variables
   * @category Templates
   * @description Retrieves the list of variable definitions for a specific template. Use this to discover which variables need to be filled before generating a document from the template.
   * @route GET /get-template-variables
   * @appearanceColor #1A56DB #3B82F6
   *
   * @paramDef {"type":"String","label":"Template","name":"templateId","required":true,"dictionary":"getTemplatesDictionary","description":"The template to retrieve variables from."}
   *
   * @returns {Object}
   * @sampleResult {"id":"tmpl_abc123","name":"Sales Proposal","variables":[{"placeholder":"{CompanyName}","name":"CompanyName","subvariables":[]},{"placeholder":"{Date}","name":"Date","subvariables":[]}]}
   */
  async getTemplateVariables(templateId) {
    const logTag = '[getTemplateVariables]'

    if (!templateId) {
      throw new Error('Template ID is required')
    }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/template/${ templateId }`,
      logTag,
    })

    const template = response.data?.results || response

    logger.info(`${ logTag } Retrieved ${ template.variables?.length || 0 } variables for template ${ templateId }`)

    return {
      id: template.id,
      name: template.name,
      variables: (template.variables || []).map(v => ({
        placeholder: v.placeholder,
        name: v.name,
        subvariables: v.subvariables || [],
      })),
    }
  }

  /**
   * @operationName Get Template By ID
   * @category Templates
   * @description Retrieves full details of a specific template including its ID, name, fonts, default font, creation date, and all variable definitions. Returns the complete template object from the TurboDocx API.
   * @route GET /get-template-by-id
   * @appearanceColor #1A56DB #3B82F6
   *
   * @paramDef {"type":"String","label":"Template","name":"templateId","required":true,"dictionary":"getTemplatesDictionary","description":"The template to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":"tmpl_abc123","name":"Sales Proposal","fonts":[{"name":"Arial","count":12}],"defaultFont":"Arial","createdOn":"2026-01-10T08:00:00.000Z","variables":[{"placeholder":"{CompanyName}","name":"CompanyName","subvariables":[]}]}
   */
  async getTemplateById(templateId) {
    const logTag = '[getTemplateById]'

    if (!templateId) {
      throw new Error('Template ID is required')
    }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/template/${ templateId }`,
      logTag,
    })

    const template = response.data?.results || response

    logger.info(`${ logTag } Retrieved template ${ templateId }`)

    return template
  }

  /**
   * @operationName Delete Template
   * @category Templates
   * @description Permanently deletes a template from TurboDocx. This action cannot be undone. Any deliverables previously generated from this template will not be affected.
   * @route DELETE /delete-template
   * @appearanceColor #1A56DB #3B82F6
   *
   * @paramDef {"type":"String","label":"Template","name":"templateId","required":true,"dictionary":"getTemplatesDictionary","description":"The template to delete."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"message":"Template deleted successfully"}
   */
  async deleteTemplate(templateId) {
    const logTag = '[deleteTemplate]'

    if (!templateId) {
      throw new Error('Template ID is required')
    }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/template/${ templateId }`,
      method: 'delete',
      logTag,
    })

    logger.info(`${ logTag } Deleted template ${ templateId }`)

    return response || { success: true, message: 'Template deleted successfully' }
  }

  /**
   * @operationName Get Template Preview Link
   * @category Templates
   * @description Gets a PDF preview link for a template. Use this to preview the template layout and variable placements before generating a document.
   * @route GET /get-template-preview-link
   * @appearanceColor #1A56DB #3B82F6
   *
   * @paramDef {"type":"String","label":"Template","name":"templateId","required":true,"dictionary":"getTemplatesDictionary","description":"The template to get a preview link for."}
   *
   * @returns {String}
   * @sampleResult "https://api.turbodocx.com/preview/tmpl_abc123.pdf"
   */
  async getTemplatePreviewLink(templateId) {
    const logTag = '[getTemplatePreviewLink]'

    if (!templateId) {
      throw new Error('Template ID is required')
    }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/template/${ templateId }/previewpdflink`,
      logTag,
    })

    const previewUrl = response.results || response.data?.results || response

    logger.info(`${ logTag } Retrieved preview link for template ${ templateId }`)

    return previewUrl
  }

  // ============================================
  // TAG METHODS
  // ============================================

  /**
   * @operationName Create Tag
   * @category Tags
   * @description Creates a new tag in TurboDocx for organizing templates and knowledge base entries. Tags help categorize and quickly locate templates by topic, department, or project.
   * @route POST /create-tag
   * @appearanceColor #1A56DB #3B82F6
   *
   * @paramDef {"type":"String","label":"Tag Name","name":"name","required":true,"description":"The name for the new tag (e.g. 'Sales', 'Legal', 'HR')."}
   *
   * @returns {Object}
   * @sampleResult {"id":"tag_abc123","name":"Sales","createdOn":"2026-01-15T10:00:00.000Z"}
   */
  async createTag(name) {
    const logTag = '[createTag]'

    if (!name) {
      throw new Error('Tag name is required')
    }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/Tag`,
      method: 'post',
      body: { name },
      logTag,
    })

    logger.info(`${ logTag } Created tag: ${ response.id || response.name }`)

    return response.data?.results || response
  }

  // ============================================
  // DOCUMENT GENERATION METHODS
  // ============================================

  /**
   * @operationName Generate Document
   * @category Document Generation
   * @description Generates a document by filling template variables with provided values. Pass a JSON object of key-value pairs where keys match the template variable names (e.g. {"CompanyName": "Acme", "Date": "2026-01-15"}). Returns the generated deliverable metadata including its ID for download.
   * @route POST /generate-document
   * @appearanceColor #1A56DB #3B82F6
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Template","name":"templateId","required":true,"dictionary":"getTemplatesDictionary","description":"The template to generate the document from."}
   * @paramDef {"type":"String","label":"Document Name","name":"name","required":true,"description":"Name for the generated document (e.g. 'Q1 Sales Proposal')."}
   * @paramDef {"type":"Object","label":"Variables","name":"variables","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"JSON object of variable key-value pairs matching template placeholders, e.g. {\"CompanyName\": \"Acme Corp\", \"Date\": \"2026-01-15\"}."}
   * @paramDef {"type":"String","label":"Description","name":"description","description":"Optional description for the generated document."}
   *
   * @returns {Object}
   * @sampleResult {"id":"del_xyz789","name":"Q1 Sales Proposal","templateId":"tmpl_abc123","createdOn":"2026-01-15T10:30:00.000Z"}
   */
  async generateDocument(templateId, name, variables, description) {
    const logTag = '[generateDocument]'

    if (!templateId) {
      throw new Error('Template ID is required')
    }

    if (!name) {
      throw new Error('Document name is required')
    }

    const variablesPayload = this.#buildVariablesPayload(variables)

    const body = {
      templateId,
      name,
      variables: variablesPayload,
    }

    if (description) {
      body.description = description
    }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/deliverable`,
      method: 'post',
      body,
      logTag,
    })

    const deliverable = response.data?.results?.deliverable || response

    logger.info(`${ logTag } Generated document: ${ deliverable.id } (${ deliverable.name })`)

    return {
      id: deliverable.id,
      name: deliverable.name,
      templateId: deliverable.templateId,
      createdOn: deliverable.createdOn,
    }
  }

  /**
   * @operationName Create Deliverable
   * @category Document Generation
   * @description Creates a deliverable from a template using the raw TurboDocx variables array format. Each variable object can specify name, placeholder, text, mimeType (text or html), subvariables, variableStack, and aiPrompt. Use this for advanced variable types like rich text, nested structures, or AI-generated content.
   * @route POST /create-deliverable
   * @appearanceColor #1A56DB #3B82F6
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Template ID","name":"templateId","required":true,"dictionary":"getTemplatesDictionary","description":"The template to create the deliverable from."}
   * @paramDef {"type":"String","label":"Deliverable Name","name":"name","required":true,"description":"Name for the deliverable."}
   * @paramDef {"type":"String","label":"Variables","name":"variables","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"JSON array of variable objects: [{\"name\":\"CompanyName\",\"placeholder\":\"{CompanyName}\",\"text\":\"Acme\",\"mimeType\":\"text\"}]. Supports subvariables, variableStack, and aiPrompt."}
   * @paramDef {"type":"String","label":"Description","name":"description","description":"Optional description for the deliverable."}
   * @paramDef {"type":"String","label":"Tags","name":"tags","description":"Optional JSON array of tag strings for categorization."}
   *
   * @returns {Object}
   * @sampleResult {"id":"del_xyz789","name":"Q1 Sales Proposal","templateId":"tmpl_abc123","createdOn":"2026-01-15T10:30:00.000Z"}
   */
  async createDeliverable(templateId, name, variables, description, tags) {
    const logTag = '[createDeliverable]'

    if (!templateId) {
      throw new Error('Template ID is required')
    }

    if (!name) {
      throw new Error('Deliverable name is required')
    }

    const parsedVariables = typeof variables === 'string' ? JSON.parse(variables) : variables

    const body = {
      templateId,
      name,
      variables: parsedVariables,
    }

    if (description) {
      body.description = description
    }

    if (tags) {
      body.tags = typeof tags === 'string' ? JSON.parse(tags) : tags
    }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/deliverable`,
      method: 'post',
      body,
      logTag,
    })

    const deliverable = response.data?.results?.deliverable || response

    logger.info(`${ logTag } Created deliverable: ${ deliverable.id } (${ deliverable.name })`)

    return {
      id: deliverable.id,
      name: deliverable.name,
      templateId: deliverable.templateId,
      createdOn: deliverable.createdOn,
    }
  }

  /**
   * @operationName Download Document
   * @category Document Generation
   * @description Downloads a generated document from TurboDocx and saves it to Flowrunner file storage. Provide the deliverable ID from the Generate Document action and a target file path.
   * @route POST /download-document
   * @appearanceColor #1A56DB #3B82F6
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Deliverable ID","name":"deliverableId","required":true,"description":"The deliverable ID returned by the Generate Document action."}
   * @paramDef {"type":"FilesUploadOptions","name":"fileOptions","label":"File Settings","required":false,"include":["filename","scope"]}
   *
   * @returns {String}
   * @sampleResult "https://storage.example.com/documents/proposal.docx"
   */
  async downloadDocument(deliverableId, fileOptions) {
    const logTag = '[downloadDocument]'

    if (!deliverableId) {
      throw new Error('Deliverable ID is required')
    }

    logger.debug(`${ logTag } Downloading deliverable ${ deliverableId }`)

    const fileBuffer = await Flowrunner.Request.get(`${ API_BASE_URL }/deliverable/file/${ deliverableId }`)
      .set({
        'Authorization': `Bearer ${ this.apiKey }`,
        'x-rapiddocx-org-id': this.orgId,
        'User-Agent': 'TurboDocx API Client',
      })
      .setEncoding(null)

    const fileName = fileOptions?.filename || `document_${ deliverableId }.docx`

    logger.debug(`${ logTag } Saving file: ${ fileName }`)

    const { url: fileUrl } = await this.flowrunner.Files.uploadFile(fileBuffer, {
      filename: fileName,
      generateUrl: true,
      overwrite: true,
      ...(fileOptions || { scope: 'FLOW' }),
    })

    logger.info(`${ logTag } Document saved to: ${ fileUrl }`)

    return fileUrl
  }

  // ============================================
  // E-SIGNATURE METHODS (TurboSign)
  // ============================================

  /**
   * @operationName Send for Signing
   * @category E-Signatures
   * @description Sends a document for legally-binding e-signatures via TurboSign. Immediately sends signing request emails to all recipients. Provide either a deliverable ID from a generated document or a file URL. Recipients and signature fields must be JSON arrays.
   * @route POST /send-for-signing
   * @appearanceColor #1A56DB #3B82F6
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Deliverable ID","name":"deliverableId","description":"ID of a previously generated TurboDocx deliverable to send for signing."}
   * @paramDef {"type":"String","label":"File Link","name":"fileLink","description":"URL to a document file (PDF, DOCX, PPTX) to send for signing. Use this if not using a deliverable ID."}
   * @paramDef {"type":"String","label":"Document Name","name":"documentName","description":"Display name for the document (max 255 characters)."}
   * @paramDef {"type":"String","label":"Recipients","name":"recipients","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"JSON array of recipients: [{\"name\":\"John\",\"email\":\"john@example.com\",\"signingOrder\":1}]."}
   * @paramDef {"type":"String","label":"Fields","name":"fields","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"JSON array of signature field definitions with recipientEmail, type, and placement. See TurboDocx docs for field schema."}
   * @paramDef {"type":"String","label":"Sender Name","name":"senderName","description":"Name of the sender displayed in signing emails."}
   * @paramDef {"type":"String","label":"Sender Email","name":"senderEmail","description":"Email address of the sender for signing notifications."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"documentId":"doc_abc123","message":"Document sent for signing successfully"}
   */
  async sendForSigning(deliverableId, fileLink, documentName, recipients, fields, senderName, senderEmail) {
    const logTag = '[sendForSigning]'

    if (!recipients) {
      throw new Error('Recipients are required')
    }

    if (!fields) {
      throw new Error('Fields are required')
    }

    if (!deliverableId && !fileLink) {
      throw new Error('Either deliverable ID or file link is required')
    }

    const formData = new FormData()

    if (deliverableId) {
      formData.append('deliverableId', deliverableId)
    }

    if (fileLink) {
      formData.append('fileLink', fileLink)
    }

    if (documentName) {
      formData.append('documentName', documentName)
    }

    formData.append('recipients', typeof recipients === 'string' ? recipients : JSON.stringify(recipients))
    formData.append('fields', typeof fields === 'string' ? fields : JSON.stringify(fields))

    if (senderName) {
      formData.append('senderName', senderName)
    }

    if (senderEmail) {
      formData.append('senderEmail', senderEmail)
    }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/turbosign/single/prepare-for-signing`,
      method: 'post',
      form: formData,
      logTag,
    })

    logger.info(`${ logTag } Document sent for signing: ${ response.documentId }`)

    return {
      success: response.success,
      documentId: response.documentId,
      message: response.message,
    }
  }

  /**
   * @operationName Send for Review
   * @category E-Signatures
   * @description Creates a signature request with a preview URL without sending emails to recipients. Use this to review the document layout and field placements before sending for actual signing. Returns a preview URL for verification.
   * @route POST /send-for-review
   * @appearanceColor #1A56DB #3B82F6
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Deliverable ID","name":"deliverableId","description":"ID of a previously generated TurboDocx deliverable to review."}
   * @paramDef {"type":"String","label":"File Link","name":"fileLink","description":"URL to a document file (PDF, DOCX, PPTX) to review. Use this if not using a deliverable ID."}
   * @paramDef {"type":"String","label":"Document Name","name":"documentName","description":"Display name for the document (max 255 characters)."}
   * @paramDef {"type":"String","label":"Recipients","name":"recipients","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"JSON array of recipients: [{\"name\":\"John\",\"email\":\"john@example.com\",\"signingOrder\":1}]."}
   * @paramDef {"type":"String","label":"Fields","name":"fields","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"JSON array of signature field definitions with recipientEmail, type, and placement. See TurboDocx docs for field schema."}
   * @paramDef {"type":"String","label":"Sender Name","name":"senderName","description":"Name of the sender displayed in the review."}
   * @paramDef {"type":"String","label":"Sender Email","name":"senderEmail","description":"Email address of the sender."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"documentId":"doc_abc123","status":"REVIEW_READY","previewUrl":"https://app.turbodocx.com/sign/preview/doc_abc123","recipients":[{"id":"r_1","name":"John","email":"john@example.com","signingOrder":1}],"message":"Document ready for review"}
   */
  async sendForReview(deliverableId, fileLink, documentName, recipients, fields, senderName, senderEmail) {
    const logTag = '[sendForReview]'

    if (!recipients) {
      throw new Error('Recipients are required')
    }

    if (!fields) {
      throw new Error('Fields are required')
    }

    if (!deliverableId && !fileLink) {
      throw new Error('Either deliverable ID or file link is required')
    }

    const formData = new FormData()

    if (deliverableId) {
      formData.append('deliverableId', deliverableId)
    }

    if (fileLink) {
      formData.append('fileLink', fileLink)
    }

    if (documentName) {
      formData.append('documentName', documentName)
    }

    formData.append('recipients', typeof recipients === 'string' ? recipients : JSON.stringify(recipients))
    formData.append('fields', typeof fields === 'string' ? fields : JSON.stringify(fields))

    if (senderName) {
      formData.append('senderName', senderName)
    }

    if (senderEmail) {
      formData.append('senderEmail', senderEmail)
    }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/turbosign/single/prepare-for-review`,
      method: 'post',
      form: formData,
      logTag,
    })

    logger.info(`${ logTag } Document prepared for review: ${ response.documentId }`)

    return {
      success: response.success,
      documentId: response.documentId,
      status: response.status,
      previewUrl: response.previewUrl,
      recipients: response.recipients,
      message: response.message,
    }
  }

  /**
   * @operationName Prepare for Signing
   * @category E-Signatures
   * @description Prepares a document and immediately sends signing request emails to all recipients via TurboSign. Accepts a file source (deliverableId, templateId, fileLink, or file URL) along with recipients and signature field definitions. Supports CC emails and custom sender information.
   * @route POST /prepare-for-signing
   * @appearanceColor #1A56DB #3B82F6
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Deliverable ID","name":"deliverableId","description":"ID of a previously generated TurboDocx deliverable."}
   * @paramDef {"type":"String","label":"Template ID","name":"templateId","description":"ID of an existing template to use as the document source."}
   * @paramDef {"type":"String","label":"File Link","name":"fileLink","description":"URL to a document file (PDF, DOCX, PPTX)."}
   * @paramDef {"type":"String","label":"Document Name","name":"documentName","description":"Display name for the document (max 255 characters)."}
   * @paramDef {"type":"String","label":"Document Description","name":"documentDescription","description":"Description for the document (max 1000 characters)."}
   * @paramDef {"type":"String","label":"Recipients","name":"recipients","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"JSON array of recipients: [{\"name\":\"John\",\"email\":\"john@example.com\",\"signingOrder\":1}]."}
   * @paramDef {"type":"String","label":"Fields","name":"fields","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"JSON array of signature field definitions. Supports template-based (anchor) and coordinate-based positioning."}
   * @paramDef {"type":"String","label":"Sender Name","name":"senderName","description":"Name of the sender displayed in signing emails."}
   * @paramDef {"type":"String","label":"Sender Email","name":"senderEmail","description":"Email address of the sender."}
   * @paramDef {"type":"String","label":"CC Emails","name":"ccEmails","description":"JSON array of email addresses to CC on signing notifications."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"documentId":"550e8400-e29b-41d4-a716-446655440000","message":"Document sent for signing successfully"}
   */
  async prepareForSigning(deliverableId, templateId, fileLink, documentName, documentDescription, recipients, fields, senderName, senderEmail, ccEmails) {
    const logTag = '[prepareForSigning]'

    if (!recipients) {
      throw new Error('Recipients are required')
    }

    if (!fields) {
      throw new Error('Fields are required')
    }

    if (!deliverableId && !templateId && !fileLink) {
      throw new Error('A file source is required: deliverableId, templateId, or fileLink')
    }

    const formData = new FormData()

    if (deliverableId) {
      formData.append('deliverableId', deliverableId)
    }

    if (templateId) {
      formData.append('templateId', templateId)
    }

    if (fileLink) {
      formData.append('fileLink', fileLink)
    }

    if (documentName) {
      formData.append('documentName', documentName)
    }

    if (documentDescription) {
      formData.append('documentDescription', documentDescription)
    }

    formData.append('recipients', typeof recipients === 'string' ? recipients : JSON.stringify(recipients))
    formData.append('fields', typeof fields === 'string' ? fields : JSON.stringify(fields))

    if (senderName) {
      formData.append('senderName', senderName)
    }

    if (senderEmail) {
      formData.append('senderEmail', senderEmail)
    }

    if (ccEmails) {
      formData.append('ccEmails', typeof ccEmails === 'string' ? ccEmails : JSON.stringify(ccEmails))
    }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/turbosign/single/prepare-for-signing`,
      method: 'post',
      form: formData,
      logTag,
    })

    logger.info(`${ logTag } Document prepared for signing: ${ response.documentId }`)

    return {
      success: response.success,
      documentId: response.documentId,
      message: response.message,
    }
  }

  /**
   * @operationName Prepare for Review
   * @category E-Signatures
   * @description Prepares a document for review and returns a preview URL without sending emails to recipients. Use this to verify document layout, field placements, and recipient configuration before committing to send. Supports deliverableId, templateId, fileLink, or direct file as the document source.
   * @route POST /prepare-for-review
   * @appearanceColor #1A56DB #3B82F6
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Deliverable ID","name":"deliverableId","description":"ID of a previously generated TurboDocx deliverable."}
   * @paramDef {"type":"String","label":"Template ID","name":"templateId","description":"ID of an existing template to use as the document source."}
   * @paramDef {"type":"String","label":"File Link","name":"fileLink","description":"URL to a document file (PDF, DOCX, PPTX)."}
   * @paramDef {"type":"String","label":"Document Name","name":"documentName","description":"Display name for the document (max 255 characters)."}
   * @paramDef {"type":"String","label":"Document Description","name":"documentDescription","description":"Description for the document (max 1000 characters)."}
   * @paramDef {"type":"String","label":"Recipients","name":"recipients","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"JSON array of recipients: [{\"name\":\"John\",\"email\":\"john@example.com\",\"signingOrder\":1}]."}
   * @paramDef {"type":"String","label":"Fields","name":"fields","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"JSON array of signature field definitions. Supports template-based (anchor) and coordinate-based positioning."}
   * @paramDef {"type":"String","label":"Sender Name","name":"senderName","description":"Name of the sender displayed in the review."}
   * @paramDef {"type":"String","label":"Sender Email","name":"senderEmail","description":"Email address of the sender."}
   * @paramDef {"type":"String","label":"CC Emails","name":"ccEmails","description":"JSON array of email addresses to CC."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"documentId":"550e8400-e29b-41d4-a716-446655440000","status":"REVIEW_READY","previewUrl":"https://www.turbodocx.com/sign/preview/550e8400","recipients":[{"id":"r_1","name":"John","email":"john@example.com","signingOrder":1}],"message":"Document prepared for review"}
   */
  async prepareForReview(deliverableId, templateId, fileLink, documentName, documentDescription, recipients, fields, senderName, senderEmail, ccEmails) {
    const logTag = '[prepareForReview]'

    if (!recipients) {
      throw new Error('Recipients are required')
    }

    if (!fields) {
      throw new Error('Fields are required')
    }

    if (!deliverableId && !templateId && !fileLink) {
      throw new Error('A file source is required: deliverableId, templateId, or fileLink')
    }

    const formData = new FormData()

    if (deliverableId) {
      formData.append('deliverableId', deliverableId)
    }

    if (templateId) {
      formData.append('templateId', templateId)
    }

    if (fileLink) {
      formData.append('fileLink', fileLink)
    }

    if (documentName) {
      formData.append('documentName', documentName)
    }

    if (documentDescription) {
      formData.append('documentDescription', documentDescription)
    }

    formData.append('recipients', typeof recipients === 'string' ? recipients : JSON.stringify(recipients))
    formData.append('fields', typeof fields === 'string' ? fields : JSON.stringify(fields))

    if (senderName) {
      formData.append('senderName', senderName)
    }

    if (senderEmail) {
      formData.append('senderEmail', senderEmail)
    }

    if (ccEmails) {
      formData.append('ccEmails', typeof ccEmails === 'string' ? ccEmails : JSON.stringify(ccEmails))
    }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/turbosign/single/prepare-for-review`,
      method: 'post',
      form: formData,
      logTag,
    })

    logger.info(`${ logTag } Document prepared for review: ${ response.documentId }`)

    return {
      success: response.success,
      documentId: response.documentId,
      status: response.status,
      previewUrl: response.previewUrl,
      recipients: response.recipients,
      message: response.message,
    }
  }

  /**
   * @operationName Download Signed Document
   * @category E-Signatures
   * @description Downloads a completed signed document from TurboSign. Returns a presigned download URL that expires in 1 hour. Only available after all recipients have completed signing.
   * @route GET /download-signed-document
   * @appearanceColor #1A56DB #3B82F6
   *
   * @paramDef {"type":"String","label":"Document ID","name":"documentId","required":true,"description":"The document ID returned by Send for Signing or Send for Review."}
   *
   * @returns {Object}
   * @sampleResult {"downloadUrl":"https://storage.turbodocx.com/signed/doc_abc123.pdf?token=xyz","fileName":"Signed_Contract.pdf"}
   */
  async downloadSignedDocument(documentId) {
    const logTag = '[downloadSignedDocument]'

    if (!documentId) {
      throw new Error('Document ID is required')
    }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/turbosign/documents/${ documentId }/download`,
      logTag,
    })

    logger.info(`${ logTag } Retrieved download URL for signed document: ${ documentId }`)

    return {
      downloadUrl: response.downloadUrl,
      fileName: response.fileName,
    }
  }

  /**
   * @operationName Get Signature Audit Trail
   * @category E-Signatures
   * @description Retrieves the complete audit trail for a signed document including all actions, timestamps, and cryptographic hash chain for compliance verification. Tracks events like document sent, viewed, signed, and voided.
   * @route GET /get-signature-audit-trail
   * @appearanceColor #1A56DB #3B82F6
   *
   * @paramDef {"type":"String","label":"Document ID","name":"documentId","required":true,"description":"The document ID to retrieve the audit trail for."}
   *
   * @returns {Object}
   * @sampleResult {"document":{"id":"doc_abc123","name":"Sales Contract"},"auditTrail":[{"actionType":"document_sent","timestamp":"2026-01-15T10:30:00Z","user":{"name":"Jane Doe","email":"jane@example.com"}},{"actionType":"document_signed","timestamp":"2026-01-15T11:00:00Z","recipient":{"name":"John Smith","email":"john@example.com"}}]}
   */
  async getSignatureAuditTrail(documentId) {
    const logTag = '[getSignatureAuditTrail]'

    if (!documentId) {
      throw new Error('Document ID is required')
    }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/turbosign/documents/${ documentId }/audit-trail`,
      logTag,
    })

    logger.info(`${ logTag } Retrieved audit trail for document: ${ documentId }`)

    return response.data || response
  }

  // ============================================
  // BULK SIGNATURE METHODS (TurboSign Bulk)
  // ============================================

  /**
   * @operationName Ingest Bulk Batch
   * @category Bulk Signatures
   * @description Creates a bulk batch of signature requests via TurboSign. Processes up to 1,000 documents in a single batch, each with its own recipients and signature fields. The batch is queued for asynchronous processing. Costs 1 credit per recipient per job.
   * @route POST /ingest-bulk-batch
   * @appearanceColor #1A56DB #3B82F6
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Source Type","name":"sourceType","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["deliverableId","templateId","fileLink"]}},"description":"The type of file source: deliverableId, templateId, or fileLink."}
   * @paramDef {"type":"String","label":"Source Value","name":"sourceValue","required":true,"description":"UUID or URL matching the source type (e.g. deliverable UUID, template UUID, or file URL)."}
   * @paramDef {"type":"String","label":"Batch Name","name":"batchName","required":true,"description":"Name for the batch (max 255 characters, e.g. 'Q4 Employment Contracts')."}
   * @paramDef {"type":"String","label":"Documents","name":"documents","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"JSON array of document objects, each with recipients and fields arrays. Max 1,000 per batch."}
   * @paramDef {"type":"String","label":"Document Name","name":"documentName","description":"Default document name for all jobs (max 255 characters)."}
   * @paramDef {"type":"String","label":"Document Description","name":"documentDescription","description":"Default document description for all jobs (max 1000 characters)."}
   * @paramDef {"type":"String","label":"Sender Name","name":"senderName","description":"Name of the sender for all signing emails."}
   * @paramDef {"type":"String","label":"Sender Email","name":"senderEmail","description":"Email address of the sender."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"batchId":"550e8400-e29b-41d4-a716-446655440000","batchName":"Q4 Employment Contracts","totalJobs":50,"status":"pending","message":"Batch created successfully with 50 jobs"}
   */
  async ingestBulkBatch(sourceType, sourceValue, batchName, documents, documentName, documentDescription, senderName, senderEmail) {
    const logTag = '[ingestBulkBatch]'

    if (!sourceType) {
      throw new Error('Source type is required')
    }

    if (!sourceValue) {
      throw new Error('Source value is required')
    }

    if (!batchName) {
      throw new Error('Batch name is required')
    }

    if (!documents) {
      throw new Error('Documents array is required')
    }

    const formData = new FormData()

    formData.append('sourceType', sourceType)
    formData.append('sourceValue', sourceValue)
    formData.append('batchName', batchName)
    formData.append('documents', typeof documents === 'string' ? documents : JSON.stringify(documents))

    if (documentName) {
      formData.append('documentName', documentName)
    }

    if (documentDescription) {
      formData.append('documentDescription', documentDescription)
    }

    if (senderName) {
      formData.append('senderName', senderName)
    }

    if (senderEmail) {
      formData.append('senderEmail', senderEmail)
    }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/turbosign/bulk/ingest`,
      method: 'post',
      form: formData,
      logTag,
    })

    logger.info(`${ logTag } Created batch: ${ response.batchId } with ${ response.totalJobs } jobs`)

    return {
      success: response.success,
      batchId: response.batchId,
      batchName: response.batchName,
      totalJobs: response.totalJobs,
      status: response.status,
      message: response.message,
    }
  }

  /**
   * @operationName List All Batches
   * @category Bulk Signatures
   * @description Lists all bulk signature batches with optional filtering by status, date range, and search query. Returns batch metadata including job counts and processing status. Supports pagination with limit and offset.
   * @route GET /list-all-batches
   * @appearanceColor #1A56DB #3B82F6
   *
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of batches per page, default 20, max 100."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Pagination offset, default 0."}
   * @paramDef {"type":"String","label":"Search","name":"query","description":"Search batches by name."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["","pending","processing","completed","failed","cancelled"]}},"description":"Filter batches by status."}
   *
   * @returns {Object}
   * @sampleResult {"batches":[{"id":"550e8400-e29b-41d4-a716-446655440000","name":"Q4 Contracts","status":"completed","totalJobs":50,"succeededJobs":48,"failedJobs":2,"pendingJobs":0,"createdOn":"2026-01-15T10:00:00Z"}],"totalRecords":5}
   */
  async listAllBatches(limit, offset, query, status) {
    const logTag = '[listAllBatches]'

    const queryParams = {}

    if (limit) {
      queryParams.limit = limit
    }

    if (offset) {
      queryParams.offset = offset
    }

    if (query) {
      queryParams.query = query
    }

    if (status) {
      queryParams.status = status
    }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/turbosign/bulk/batches`,
      query: queryParams,
      logTag,
    })

    logger.info(`${ logTag } Listed batches: ${ response.data?.totalRecords || 0 } total`)

    return {
      batches: response.data?.batches || [],
      totalRecords: response.data?.totalRecords || 0,
    }
  }

  /**
   * @operationName List Jobs in Batch
   * @category Bulk Signatures
   * @description Lists all jobs within a specific bulk signature batch. Returns individual job details including document ID, status, recipient emails, error information, and attempt counts. Supports pagination and filtering by job status.
   * @route GET /list-jobs-in-batch
   * @appearanceColor #1A56DB #3B82F6
   *
   * @paramDef {"type":"String","label":"Batch ID","name":"batchId","required":true,"description":"The UUID of the batch to list jobs from."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of jobs per page, default 20, max 100."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Pagination offset, default 0."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["","SUCCEEDED","FAILED","PENDING","PROCESSING"]}},"description":"Filter jobs by status."}
   *
   * @returns {Object}
   * @sampleResult {"batchId":"550e8400-e29b-41d4-a716-446655440000","batchName":"Q4 Contracts","batchStatus":"completed","jobs":[{"id":"job_1","documentId":"doc_1","documentName":"Contract_JohnDoe","status":"SUCCEEDED","recipientEmails":["john@example.com"],"attempts":1}],"totalJobs":50,"totalRecords":50,"succeededJobs":48,"failedJobs":2,"pendingJobs":0}
   */
  async listJobsInBatch(batchId, limit, offset, status) {
    const logTag = '[listJobsInBatch]'

    if (!batchId) {
      throw new Error('Batch ID is required')
    }

    const queryParams = {}

    if (limit) {
      queryParams.limit = limit
    }

    if (offset) {
      queryParams.offset = offset
    }

    if (status) {
      queryParams.status = status
    }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/turbosign/bulk/batch/${ batchId }/jobs`,
      query: queryParams,
      logTag,
    })

    const data = response.data || response

    logger.info(`${ logTag } Listed ${ data.totalRecords || 0 } jobs in batch ${ batchId }`)

    return {
      batchId: data.batchId,
      batchName: data.batchName,
      batchStatus: data.batchStatus,
      jobs: data.jobs || [],
      totalJobs: data.totalJobs,
      totalRecords: data.totalRecords,
      succeededJobs: data.succeededJobs,
      failedJobs: data.failedJobs,
      pendingJobs: data.pendingJobs,
    }
  }
}

Flowrunner.ServerCode.addService(TurboDocxService, [
  {
    name: 'apiKey',
    displayName: 'API Access Token',
    type: 'STRING',
    required: true,
    shared: false,
    hint: 'Generate your API Access Token from your TurboDocx organization settings.',
  },
  {
    name: 'orgId',
    displayName: 'Organization ID',
    type: 'STRING',
    required: true,
    shared: false,
    hint: 'Find your Organization ID in TurboDocx organization settings.',
  },
])