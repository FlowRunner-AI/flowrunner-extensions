'use strict'

const OAUTH_HOST_PRODUCTION = 'https://account.docusign.com'
const OAUTH_HOST_DEMO = 'https://account-d.docusign.com'

const API_VERSION = 'v2.1'

const DEFAULT_SCOPE_LIST = [
  'signature',
  'extended',
]

const DEFAULT_SCOPE_STRING = DEFAULT_SCOPE_LIST.join(' ')

const DELIMITER = '::meta::'

const DEFAULT_PAGE_SIZE = 50

const DOCUSIGN_EVENT_MAP = {
  'envelope-sent': 'onEnvelopeSent',
  'envelope-completed': 'onEnvelopeCompleted',
  'envelope-declined': 'onEnvelopeDeclined',
  'envelope-voided': 'onEnvelopeVoided',
}

const TRIGGER_EVENT_MAP = {
  onEnvelopeSent: 'sent',
  onEnvelopeCompleted: 'completed',
  onEnvelopeDeclined: 'declined',
  onEnvelopeVoided: 'voided',
}

const logger = {
  info: (...args) => console.log('[DocuSign Service] info:', ...args),
  debug: (...args) => console.log('[DocuSign Service] debug:', ...args),
  error: (...args) => console.log('[DocuSign Service] error:', ...args),
  warn: (...args) => console.log('[DocuSign Service] warn:', ...args),
}

function cleanupObject(data) {
  const result = {}

  Object.keys(data).forEach(key => {
    if (data[key] !== undefined && data[key] !== null && data[key] !== '') {
      result[key] = data[key]
    }
  })

  return Object.keys(result).length > 0 ? result : undefined
}

/**
 * @requireOAuth
 * @integrationName DocuSign
 * @integrationIcon /icon.svg
 * @integrationTriggersScope SINGLE_APP
 */
class DocuSignService {
  constructor(config) {
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
    this.scopes = DEFAULT_SCOPE_STRING
    this.oauthHost = config.environment === 'Demo' ? OAUTH_HOST_DEMO : OAUTH_HOST_PRODUCTION
  }

  // ==================== Private Helpers ====================

  #getCompositeToken() {
    const compositeToken = this.request.headers['oauth-access-token']

    if (!compositeToken) {
      throw new Error('Access token is not available. Please reconnect your DocuSign account.')
    }

    return compositeToken
  }

  #getAccessTokenHeader() {
    const compositeToken = this.#getCompositeToken()
    const accessToken = compositeToken.split(DELIMITER)[0]

    return { Authorization: `Bearer ${ accessToken }` }
  }

  #getAccountId() {
    const compositeToken = this.#getCompositeToken()
    const accountId = compositeToken.split(DELIMITER)[1]

    if (!accountId) {
      throw new Error('Account ID is not available. Please reconnect your DocuSign account.')
    }

    return accountId
  }

  #getBaseUri() {
    const compositeToken = this.#getCompositeToken()
    const parts = compositeToken.split(DELIMITER)
    const baseUri = parts.slice(2).join(DELIMITER)

    if (!baseUri) {
      throw new Error('Base URI is not available. Please reconnect your DocuSign account.')
    }

    return baseUri
  }

  #getSecretTokenHeader() {
    const credentials = Buffer.from(`${ this.clientId }:${ this.clientSecret }`).toString('base64')

    return { Authorization: `Basic ${ credentials }` }
  }

  #getApiBaseUrl() {
    return `${ this.#getBaseUri() }/restapi/${ API_VERSION }/accounts/${ this.#getAccountId() }`
  }

  async #apiRequest({ url, method, body, query, logTag, headers }) {
    method = method || 'get'

    if (query) {
      query = cleanupObject(query)
    }

    logger.debug(`${ logTag } - api request: [${ method }::${ url }] q=[${ JSON.stringify(query) }]`)

    try {
      const request = Flowrunner.Request[method](url)
        .set(this.#getAccessTokenHeader())
        .set({ Accept: 'application/json' })

      if (query) {
        request.query(query)
      }

      if (headers) {
        request.set(headers)
      }

      if (body) {
        request.set({ 'Content-Type': 'application/json' })

        return await request.send(body)
      }

      return await request
    } catch (error) {
      const errorMessage = error?.body?.message || error?.body?.errorCode || error?.message

      logger.error(`${ logTag } - api error: ${ typeof error === 'object' ? JSON.stringify(error) : error }`)
      throw new Error(errorMessage || 'DocuSign API request failed.')
    }
  }

  // ==================== OAuth2 System Methods ====================

  /**
   * @registerAs SYSTEM
   * @route GET /getOAuth2ConnectionURL
   * @returns {String}
   */
  async getOAuth2ConnectionURL() {
    const params = new URLSearchParams()

    params.append('response_type', 'code')
    params.append('scope', this.scopes)
    params.append('client_id', this.clientId)

    return `${ this.oauthHost }/oauth/auth?${ params.toString() }`
  }

  /**
   * @registerAs SYSTEM
   * @route POST /executeCallback
   * @param {Object} [callbackObject]
   * @returns {executeCallback_ResultObject}
   */
  async executeCallback(callbackObject) {
    logger.debug('executeCallback - starting token exchange')
    logger.debug(`executeCallback - oauthHost: ${ this.oauthHost }`)
    logger.debug(`executeCallback - redirectURI: ${ callbackObject.redirectURI }`)
    logger.debug(`executeCallback - code present: ${ !!callbackObject.code }`)

    const params = new URLSearchParams()

    params.append('grant_type', 'authorization_code')
    params.append('code', callbackObject.code)
    params.append('redirect_uri', callbackObject.redirectURI)

    let tokenResponse

    try {
      tokenResponse = await Flowrunner.Request.post(`${ this.oauthHost }/oauth/token`)
        .set(this.#getSecretTokenHeader())
        .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        .send(params.toString())
    } catch (error) {
      logger.error('executeCallback - token exchange failed:', JSON.stringify(error))
      logger.error('executeCallback - error body:', JSON.stringify(error?.body))
      logger.error('executeCallback - error message:', error?.message)

      const errorDetail = error?.body?.error_description || error?.body?.error || error?.message || 'Token exchange failed'

      throw new Error(`DocuSign token exchange failed: ${ errorDetail }`)
    }

    const userInfo = await Flowrunner.Request.get(`${ this.oauthHost }/oauth/userinfo`)
      .set({ Authorization: `Bearer ${ tokenResponse.access_token }` })

    const defaultAccount = userInfo.accounts?.find(a => a.is_default) || userInfo.accounts?.[0]

    if (!defaultAccount) {
      throw new Error('No DocuSign account found for this user.')
    }

    const accountId = defaultAccount.account_id
    const baseUri = defaultAccount.base_uri

    const compositeToken = `${ tokenResponse.access_token }${ DELIMITER }${ accountId }${ DELIMITER }${ baseUri }`

    return {
      token: compositeToken,
      expirationInSeconds: tokenResponse.expires_in,
      refreshToken: tokenResponse.refresh_token,
      connectionIdentityName: userInfo.name || userInfo.email || 'DocuSign User',
      connectionIdentityImageURL: null,
      overwrite: true,
      userData: {
        accountId,
        baseUri,
        accountName: defaultAccount.account_name,
        email: userInfo.email,
      },
    }
  }

  /**
   * @registerAs SYSTEM
   * @route PUT /refreshToken
   * @param {String} refreshToken
   * @returns {refreshToken_ResultObject}
   */
  async refreshToken(refreshToken) {
    const accountId = this.#getAccountId()
    const baseUri = this.#getBaseUri()

    const params = new URLSearchParams()

    params.append('grant_type', 'refresh_token')
    params.append('refresh_token', refreshToken)

    const response = await Flowrunner.Request.post(`${ this.oauthHost }/oauth/token`)
      .set(this.#getSecretTokenHeader())
      .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
      .send(params.toString())

    const compositeToken = `${ response.access_token }${ DELIMITER }${ accountId }${ DELIMITER }${ baseUri }`

    return {
      token: compositeToken,
      expirationInSeconds: response.expires_in,
      refreshToken: response.refresh_token || refreshToken,
    }
  }

  // ==================== Dictionary Methods ====================

  /**
   * @registerAs DICTIONARY
   * @operationName Get Templates
   * @description Provides a searchable list of DocuSign templates for dynamic parameter selection in envelope creation.
   * @route POST /get-templates-dictionary
   * @paramDef {"type":"getTemplatesDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering templates."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"NDA Template","value":"abc-123-def","note":"ID: abc-123-def"}],"cursor":null}
   */
  async getTemplatesDictionary(payload) {
    const { search, cursor } = payload || {}
    const startPosition = cursor || '0'

    const response = await this.#apiRequest({
      url: `${ this.#getApiBaseUrl() }/templates`,
      query: {
        count: String(DEFAULT_PAGE_SIZE),
        start_position: startPosition,
        search_text: search || undefined,
      },
      logTag: 'getTemplatesDictionary',
    })

    const templates = response.envelopeTemplates || []
    const nextPosition = response.nextUri ? String(parseInt(startPosition) + DEFAULT_PAGE_SIZE) : null

    return {
      cursor: nextPosition,
      items: templates.map(t => ({
        label: t.name || 'Unnamed Template',
        value: t.templateId,
        note: `ID: ${ t.templateId }`,
      })),
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Envelopes
   * @description Provides a searchable list of recent DocuSign envelopes for dynamic parameter selection.
   * @route POST /get-envelopes-dictionary
   * @paramDef {"type":"getEnvelopesDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering envelopes."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"NDA - John Smith","value":"env-123-abc","note":"Status: sent"}],"cursor":null}
   */
  async getEnvelopesDictionary(payload) {
    const { search, cursor } = payload || {}
    const startPosition = cursor || '0'

    const fromDate = new Date()
    fromDate.setDate(fromDate.getDate() - 30)

    const response = await this.#apiRequest({
      url: `${ this.#getApiBaseUrl() }/envelopes`,
      query: {
        count: String(DEFAULT_PAGE_SIZE),
        start_position: startPosition,
        from_date: fromDate.toISOString(),
        search_text: search || undefined,
        order_by: 'last_modified',
        order: 'desc',
      },
      logTag: 'getEnvelopesDictionary',
    })

    const envelopes = response.envelopes || []
    const nextPosition = response.nextUri ? String(parseInt(startPosition) + DEFAULT_PAGE_SIZE) : null

    return {
      cursor: nextPosition,
      items: envelopes.map(e => ({
        label: e.emailSubject || `Envelope ${ e.envelopeId.substring(0, 8) }`,
        value: e.envelopeId,
        note: `Status: ${ e.status }`,
      })),
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Template Roles
   * @description Provides a list of signer roles defined in a DocuSign template for recipient assignment.
   * @route POST /get-template-roles-dictionary
   * @paramDef {"type":"getTemplateRolesDictionary__payload","label":"Payload","name":"payload","description":"Contains criteria with template ID to retrieve roles from."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Signer 1","value":"Signer 1","note":"Role Name"}],"cursor":null}
   */
  async getTemplateRolesDictionary(payload) {
    const { search, criteria } = payload || {}
    const templateId = criteria?.templateId

    if (!templateId) {
      return { items: [], cursor: null }
    }

    const response = await this.#apiRequest({
      url: `${ this.#getApiBaseUrl() }/templates/${ templateId }`,
      logTag: 'getTemplateRolesDictionary',
    })

    let roles = response.recipients?.signers || []

    if (search) {
      const searchLower = search.toLowerCase()
      roles = roles.filter(r => r.roleName?.toLowerCase().includes(searchLower))
    }

    return {
      cursor: null,
      items: roles.map(r => ({
        label: r.roleName || 'Unnamed Role',
        value: r.roleName,
        note: 'Role Name',
      })),
    }
  }

  // ==================== Envelopes ====================

  /**
   * @operationName Send Envelope from Template
   * @category Envelopes
   * @description Creates and sends a DocuSign envelope using a pre-configured template. Assign a signer to a template role and optionally customize the email subject and body. Set status to 'created' to save as draft without sending.
   *
   * @route POST /send-envelope-from-template
   * @appearanceColor #4C00FF #6B33FF
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Template","name":"templateId","required":true,"dictionary":"getTemplatesDictionary","description":"The template to use for creating the envelope."}
   * @paramDef {"type":"String","label":"Email Subject","name":"emailSubject","required":true,"description":"Subject line for the envelope email sent to recipients."}
   * @paramDef {"type":"String","label":"Signer Email","name":"signerEmail","required":true,"description":"Email address of the signer recipient."}
   * @paramDef {"type":"String","label":"Signer Name","name":"signerName","required":true,"description":"Full name of the signer recipient."}
   * @paramDef {"type":"String","label":"Role Name","name":"roleName","required":true,"dictionary":"getTemplateRolesDictionary","dependsOn":["templateId"],"description":"Template role to assign the signer to."}
   * @paramDef {"type":"String","label":"Email Body","name":"emailBody","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional custom message body for the envelope email."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["sent","created"]}},"description":"Set to 'sent' to send immediately or 'created' to save as draft."}
   *
   * @returns {Object}
   * @sampleResult {"envelopeId":"abc-123-def-456","status":"sent","statusDateTime":"2024-01-15T10:30:00Z","uri":"/envelopes/abc-123-def-456"}
   */
  async sendEnvelopeFromTemplate(templateId, emailSubject, signerEmail, signerName, roleName, emailBody, status) {
    if (!templateId) throw new Error('"Template" is required.')
    if (!emailSubject) throw new Error('"Email Subject" is required.')
    if (!signerEmail) throw new Error('"Signer Email" is required.')
    if (!signerName) throw new Error('"Signer Name" is required.')
    if (!roleName) throw new Error('"Role Name" is required.')

    const body = {
      templateId,
      emailSubject,
      emailBlurb: emailBody || undefined,
      status: status || 'sent',
      templateRoles: [
        {
          email: signerEmail,
          name: signerName,
          roleName,
        },
      ],
    }

    return await this.#apiRequest({
      url: `${ this.#getApiBaseUrl() }/envelopes`,
      method: 'post',
      body,
      logTag: 'sendEnvelopeFromTemplate',
    })
  }

  /**
   * @operationName Send Envelope with Document
   * @category Envelopes
   * @description Creates and sends a DocuSign envelope with a document from a URL. Downloads the document, embeds it in the envelope, and assigns a signer. Ideal for dynamically generated documents or files stored in Flowrunner.
   *
   * @route POST /send-envelope-with-document
   * @appearanceColor #4C00FF #6B33FF
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Document URL","name":"documentUrl","required":true,"description":"URL of the document to include in the envelope. Must be a publicly accessible file URL."}
   * @paramDef {"type":"String","label":"Document Name","name":"documentName","required":true,"description":"File name for the document, for example 'contract.pdf'."}
   * @paramDef {"type":"String","label":"Email Subject","name":"emailSubject","required":true,"description":"Subject line for the envelope email sent to recipients."}
   * @paramDef {"type":"String","label":"Signer Email","name":"signerEmail","required":true,"description":"Email address of the signer recipient."}
   * @paramDef {"type":"String","label":"Signer Name","name":"signerName","required":true,"description":"Full name of the signer recipient."}
   * @paramDef {"type":"String","label":"Email Body","name":"emailBody","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional custom message body for the envelope email."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["sent","created"]}},"description":"Set to 'sent' to send immediately or 'created' to save as draft."}
   *
   * @returns {Object}
   * @sampleResult {"envelopeId":"abc-123-def-456","status":"sent","statusDateTime":"2024-01-15T10:30:00Z","uri":"/envelopes/abc-123-def-456"}
   */
  async sendEnvelopeWithDocument(documentUrl, documentName, emailSubject, signerEmail, signerName, emailBody, status) {
    if (!documentUrl) throw new Error('"Document URL" is required.')
    if (!documentName) throw new Error('"Document Name" is required.')
    if (!emailSubject) throw new Error('"Email Subject" is required.')
    if (!signerEmail) throw new Error('"Signer Email" is required.')
    if (!signerName) throw new Error('"Signer Name" is required.')

    logger.debug('sendEnvelopeWithDocument - downloading document from URL')

    const documentBytes = await Flowrunner.Request.get(documentUrl).setEncoding(null)
    const documentBase64 = Buffer.from(documentBytes).toString('base64')

    const fileExtension = documentName.split('.').pop() || 'pdf'

    const body = {
      emailSubject,
      emailBlurb: emailBody || undefined,
      status: status || 'sent',
      documents: [
        {
          documentBase64,
          name: documentName,
          fileExtension,
          documentId: '1',
        },
      ],
      recipients: {
        signers: [
          {
            email: signerEmail,
            name: signerName,
            recipientId: '1',
            routingOrder: '1',
          },
        ],
      },
    }

    return await this.#apiRequest({
      url: `${ this.#getApiBaseUrl() }/envelopes`,
      method: 'post',
      body,
      logTag: 'sendEnvelopeWithDocument',
    })
  }

  /**
   * @operationName Get Envelope Status
   * @category Envelopes
   * @description Retrieves the current status and details of a DocuSign envelope including sent date, status changes, and recipient information. Use this to check if an envelope has been signed, delivered, or declined.
   *
   * @route POST /get-envelope-status
   * @appearanceColor #4C00FF #6B33FF
   *
   * @paramDef {"type":"String","label":"Envelope","name":"envelopeId","required":true,"dictionary":"getEnvelopesDictionary","description":"The envelope to get status for."}
   *
   * @returns {Object}
   * @sampleResult {"envelopeId":"abc-123","status":"completed","emailSubject":"Please sign this","sentDateTime":"2024-01-15T10:30:00Z","completedDateTime":"2024-01-16T14:20:00Z"}
   */
  async getEnvelopeStatus(envelopeId) {
    if (!envelopeId) throw new Error('"Envelope" is required.')

    return await this.#apiRequest({
      url: `${ this.#getApiBaseUrl() }/envelopes/${ envelopeId }`,
      logTag: 'getEnvelopeStatus',
    })
  }

  /**
   * @operationName List Envelopes
   * @category Envelopes
   * @description Lists envelopes from your DocuSign account with optional filtering by status, date range, and search text. Results are ordered by last modified date descending. Use this to find envelopes or monitor signing progress.
   *
   * @route POST /list-envelopes
   * @appearanceColor #4C00FF #6B33FF
   *
   * @paramDef {"type":"String","label":"From Date","name":"fromDate","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"Start date for the envelope search. Only envelopes created on or after this date are returned."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["created","sent","delivered","signed","completed","declined","voided"]}},"description":"Optional filter by envelope status."}
   * @paramDef {"type":"String","label":"Search Text","name":"searchText","description":"Optional text to search in envelope subjects and recipient names."}
   * @paramDef {"type":"Number","label":"Count","name":"count","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of envelopes to return, up to 100. Defaults to 25."}
   *
   * @returns {Object}
   * @sampleResult {"envelopes":[{"envelopeId":"abc-123","status":"completed","emailSubject":"Please sign","sentDateTime":"2024-01-15T10:30:00Z"}],"totalSetSize":"42","resultSetSize":"25"}
   */
  async listEnvelopes(fromDate, status, searchText, count) {
    if (!fromDate) throw new Error('"From Date" is required.')

    return await this.#apiRequest({
      url: `${ this.#getApiBaseUrl() }/envelopes`,
      query: {
        from_date: fromDate,
        status: status || undefined,
        search_text: searchText || undefined,
        count: count ? String(count) : undefined,
        order_by: 'last_modified',
        order: 'desc',
      },
      logTag: 'listEnvelopes',
    })
  }

  /**
   * @operationName Void Envelope
   * @category Envelopes
   * @description Voids (cancels) a sent DocuSign envelope, preventing any further signing activity. A void reason is required and will be visible to all recipients. Only envelopes with status 'sent' or 'delivered' can be voided.
   *
   * @route POST /void-envelope
   * @appearanceColor #4C00FF #6B33FF
   *
   * @paramDef {"type":"String","label":"Envelope","name":"envelopeId","required":true,"dictionary":"getEnvelopesDictionary","description":"The envelope to void."}
   * @paramDef {"type":"String","label":"Void Reason","name":"voidReason","required":true,"description":"Reason for voiding the envelope. This is displayed to all recipients."}
   *
   * @returns {Object}
   * @sampleResult {"envelopeId":"abc-123","status":"voided"}
   */
  async voidEnvelope(envelopeId, voidReason) {
    if (!envelopeId) throw new Error('"Envelope" is required.')
    if (!voidReason) throw new Error('"Void Reason" is required.')

    return await this.#apiRequest({
      url: `${ this.#getApiBaseUrl() }/envelopes/${ envelopeId }`,
      method: 'put',
      body: {
        status: 'voided',
        voidedReason: voidReason,
      },
      logTag: 'voidEnvelope',
    })
  }

  /**
   * @operationName Resend Envelope
   * @category Envelopes
   * @description Resends email notifications to all pending recipients of a DocuSign envelope. Useful when recipients have not received or lost the original signing notification email.
   *
   * @route POST /resend-envelope
   * @appearanceColor #4C00FF #6B33FF
   *
   * @paramDef {"type":"String","label":"Envelope","name":"envelopeId","required":true,"dictionary":"getEnvelopesDictionary","description":"The envelope to resend notifications for."}
   *
   * @returns {Object}
   * @sampleResult {"envelopeId":"abc-123"}
   */
  async resendEnvelope(envelopeId) {
    if (!envelopeId) throw new Error('"Envelope" is required.')

    return await this.#apiRequest({
      url: `${ this.#getApiBaseUrl() }/envelopes/${ envelopeId }`,
      method: 'put',
      query: {
        resend_envelope: 'true',
      },
      logTag: 'resendEnvelope',
    })
  }

  // ==================== Documents ====================

  /**
   * @operationName Download Document
   * @category Documents
   * @description Downloads a specific document from a DocuSign envelope as a PDF. Use document ID 'combined' to get all documents merged into a single PDF, or 'certificate' to download the certificate of completion.
   *
   * @route POST /download-document
   * @appearanceColor #4C00FF #6B33FF
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Envelope","name":"envelopeId","required":true,"dictionary":"getEnvelopesDictionary","description":"The envelope containing the document."}
   * @paramDef {"type":"String","label":"Document ID","name":"documentId","required":true,"description":"Document ID within the envelope. Use 'combined' to download all documents as a single PDF, or 'certificate' for the signing certificate."}
   *
   * @returns {Object}
   * @sampleResult {"contentType":"application/pdf","content":"<binary PDF data>"}
   */
  async downloadDocument(envelopeId, documentId) {
    if (!envelopeId) throw new Error('"Envelope" is required.')
    if (!documentId) throw new Error('"Document ID" is required.')

    logger.debug(`downloadDocument - downloading document ${ documentId } from envelope: ${ envelopeId }`)

    const url = `${ this.#getApiBaseUrl() }/envelopes/${ envelopeId }/documents/${ documentId }`

    const pdfData = await Flowrunner.Request.get(url)
      .set(this.#getAccessTokenHeader())
      .set({ Accept: 'application/pdf' })
      .setEncoding(null)

    return {
      contentType: 'application/pdf',
      content: pdfData,
    }
  }

  /**
   * @operationName List Envelope Documents
   * @category Documents
   * @description Lists all documents contained in a DocuSign envelope, including their names, IDs, and file types. Useful for identifying which document to download from a multi-document envelope.
   *
   * @route POST /list-envelope-documents
   * @appearanceColor #4C00FF #6B33FF
   *
   * @paramDef {"type":"String","label":"Envelope","name":"envelopeId","required":true,"dictionary":"getEnvelopesDictionary","description":"The envelope to list documents for."}
   *
   * @returns {Object}
   * @sampleResult {"envelopeId":"abc-123","envelopeDocuments":[{"documentId":"1","name":"Contract.pdf","type":"content","uri":"/documents/1"}]}
   */
  async listEnvelopeDocuments(envelopeId) {
    if (!envelopeId) throw new Error('"Envelope" is required.')

    return await this.#apiRequest({
      url: `${ this.#getApiBaseUrl() }/envelopes/${ envelopeId }/documents`,
      logTag: 'listEnvelopeDocuments',
    })
  }

  // ==================== Recipients ====================

  /**
   * @operationName Get Envelope Recipients
   * @category Recipients
   * @description Retrieves all recipients of a DocuSign envelope with their signing status, delivery timestamps, and role information. Returns signers, carbon copy recipients, and other recipient types with their individual completion status.
   *
   * @route POST /get-envelope-recipients
   * @appearanceColor #4C00FF #6B33FF
   *
   * @paramDef {"type":"String","label":"Envelope","name":"envelopeId","required":true,"dictionary":"getEnvelopesDictionary","description":"The envelope to get recipients for."}
   *
   * @returns {Object}
   * @sampleResult {"signers":[{"email":"signer@example.com","name":"Jane Smith","status":"completed","signedDateTime":"2024-01-16T14:20:00Z","recipientId":"1"}],"carbonCopies":[]}
   */
  async getEnvelopeRecipients(envelopeId) {
    if (!envelopeId) throw new Error('"Envelope" is required.')

    return await this.#apiRequest({
      url: `${ this.#getApiBaseUrl() }/envelopes/${ envelopeId }/recipients`,
      logTag: 'getEnvelopeRecipients',
    })
  }

  // ==================== Trigger Definitions ====================

  /**
   * @description Triggered when all recipients have signed and the envelope status changes to completed. Use this to automate post-signing workflows such as archiving signed documents or updating records.
   *
   * @route POST /on-envelope-completed
   * @operationName On Envelope Completed
   *
   * @registerAs REALTIME_TRIGGER
   *
   * @returns {Object}
   * @sampleResult {"envelopeId":"abc-123","status":"completed","emailSubject":"Please sign this contract","sentDateTime":"2024-01-15T10:30:00Z","completedDateTime":"2024-01-16T14:20:00Z","sender":{"email":"sender@example.com","name":"John Doe"},"recipients":[{"email":"signer@example.com","name":"Jane Smith","status":"completed"}]}
   */
  async onEnvelopeCompleted() {}

  /**
   * @description Triggered when an envelope is sent to recipients for signing. Use this to track envelope delivery or trigger follow-up actions when documents are dispatched.
   *
   * @route POST /on-envelope-sent
   * @operationName On Envelope Sent
   *
   * @registerAs REALTIME_TRIGGER
   *
   * @returns {Object}
   * @sampleResult {"envelopeId":"abc-123","status":"sent","emailSubject":"Please sign this contract","sentDateTime":"2024-01-15T10:30:00Z","sender":{"email":"sender@example.com","name":"John Doe"},"recipients":[{"email":"signer@example.com","name":"Jane Smith","status":"sent"}]}
   */
  async onEnvelopeSent() {}

  /**
   * @description Triggered when a recipient declines to sign an envelope. Use this to handle rejection scenarios such as sending notifications, escalating to managers, or initiating alternative workflows.
   *
   * @route POST /on-envelope-declined
   * @operationName On Envelope Declined
   *
   * @registerAs REALTIME_TRIGGER
   *
   * @returns {Object}
   * @sampleResult {"envelopeId":"abc-123","status":"declined","emailSubject":"Please sign this contract","sentDateTime":"2024-01-15T10:30:00Z","declinedDateTime":"2024-01-16T09:00:00Z","sender":{"email":"sender@example.com","name":"John Doe"},"recipients":[{"email":"signer@example.com","name":"Jane Smith","status":"declined"}]}
   */
  async onEnvelopeDeclined() {}

  /**
   * @description Triggered when an envelope is voided (cancelled) by the sender. Use this to clean up related records, notify stakeholders, or trigger compensating actions when a signing process is cancelled.
   *
   * @route POST /on-envelope-voided
   * @operationName On Envelope Voided
   *
   * @registerAs REALTIME_TRIGGER
   *
   * @returns {Object}
   * @sampleResult {"envelopeId":"abc-123","status":"voided","emailSubject":"Please sign this contract","sentDateTime":"2024-01-15T10:30:00Z","voidedDateTime":"2024-01-16T11:00:00Z","voidedReason":"Contract terms changed","sender":{"email":"sender@example.com","name":"John Doe"}}
   */
  async onEnvelopeVoided() {}

  // ==================== Trigger System Methods ====================

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerUpsertWebhook(invocation) {
    const { callbackUrl, events, webhookData, connectionId } = invocation

    const callbackUrlWithConnection = connectionId
      ? `${ callbackUrl }${ callbackUrl.includes('?') ? '&' : '?' }connectionId=${ connectionId }`
      : callbackUrl

    const envelopeEvents = events
      .map(e => TRIGGER_EVENT_MAP[e.name])
      .filter(Boolean)

    if (webhookData?.connectId) {
      try {
        await this.#apiRequest({
          url: `${ this.#getApiBaseUrl() }/connect/${ webhookData.connectId }`,
          method: 'delete',
          logTag: 'handleTriggerUpsertWebhook:deleteOld',
        })
      } catch (e) {
        logger.warn('handleTriggerUpsertWebhook - could not delete old connect config:', e.message)
      }
    }

    const connectConfig = {
      name: `FlowRunner - ${ Date.now() }`,
      urlToPublishTo: callbackUrlWithConnection,
      allUsers: 'true',
      allowEnvelopePublish: 'true',
      configurationType: 'custom',
      deliveryMode: 'SIM',
      envelopeEvents: envelopeEvents,
      eventData: {
        version: 'restv2.1',
        format: 'json',
        includeData: ['recipients'],
      },
    }

    const response = await this.#apiRequest({
      url: `${ this.#getApiBaseUrl() }/connect`,
      method: 'post',
      body: connectConfig,
      logTag: 'handleTriggerUpsertWebhook:create',
    })

    return {
      webhookData: {
        connectId: response.connectId,
      },
    }
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerResolveEvents(invocation) {
    const body = invocation.body

    if (!body || !body.event) {
      logger.warn('handleTriggerResolveEvents - no event in body')

      return { events: [] }
    }

    const eventType = body.event
    const triggerName = DOCUSIGN_EVENT_MAP[eventType]

    if (!triggerName) {
      logger.warn(`handleTriggerResolveEvents - unknown event type: ${ eventType }`)

      return { events: [] }
    }

    const envelopeSummary = body.data || {}
    const envelopeId = envelopeSummary.envelopeId
    const recipients = envelopeSummary.recipients?.signers || []

    const eventData = {
      envelopeId,
      status: envelopeSummary.status,
      emailSubject: envelopeSummary.emailSubject,
      sentDateTime: envelopeSummary.sentDateTime,
      completedDateTime: envelopeSummary.completedDateTime,
      declinedDateTime: envelopeSummary.declinedDateTime,
      voidedDateTime: envelopeSummary.voidedDateTime,
      voidedReason: envelopeSummary.voidedReason,
      sender: envelopeSummary.sender
        ? { email: envelopeSummary.sender.email, name: envelopeSummary.sender.userName }
        : undefined,
      recipients: recipients.map(r => ({
        email: r.email,
        name: r.name,
        status: r.status,
        signedDateTime: r.signedDateTime,
        declinedDateTime: r.declinedDateTime,
        declinedReason: r.declinedReason,
      })),
    }

    return {
      events: [
        {
          name: triggerName,
          data: cleanupObject(eventData) || eventData,
        },
      ],
    }
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerSelectMatched(invocation) {
    const { triggers } = invocation

    return {
      ids: triggers.map(t => t.id),
    }
  }

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerDeleteWebhook(invocation) {
    const { webhookData } = invocation

    if (webhookData?.connectId) {
      try {
        await this.#apiRequest({
          url: `${ this.#getApiBaseUrl() }/connect/${ webhookData.connectId }`,
          method: 'delete',
          logTag: 'handleTriggerDeleteWebhook',
        })
      } catch (e) {
        logger.warn('handleTriggerDeleteWebhook - could not delete connect config:', e.message)
      }
    }

    return {
      webhookData: {},
    }
  }
}

/**
 * @typedef {Object} getTemplatesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter templates by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for retrieving the next page of results."}
 */

/**
 * @typedef {Object} getEnvelopesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter envelopes by subject or recipient."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for retrieving the next page of results."}
 */

/**
 * @typedef {Object} getTemplateRolesDictionary__payloadCriteria
 * @paramDef {"type":"String","label":"Template ID","name":"templateId","required":true,"description":"The template ID to retrieve roles from."}
 */

/**
 * @typedef {Object} getTemplateRolesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter roles by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (not used for roles)."}
 * @paramDef {"type":"getTemplateRolesDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required parameters including the template ID."}
 */

Flowrunner.ServerCode.addService(DocuSignService, [
  {
    name: 'clientId',
    displayName: 'Integration Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'Integration Key (Client ID) from DocuSign Apps and Keys settings.',
  },
  {
    name: 'clientSecret',
    displayName: 'Secret Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'Secret Key from DocuSign Apps and Keys settings.',
  },
  {
    name: 'environment',
    displayName: 'Environment',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.CHOICE,
    defaultValue: 'Production',
    required: true,
    options: ['Production', 'Demo'],
    hint: 'Select Demo for development/testing, Production for live signing.',
  },
])
