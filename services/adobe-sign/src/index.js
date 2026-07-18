// Adobe Acrobat Sign integration - upload documents, send agreements for e-signature, track
// signing progress, and download signed PDFs via the Acrobat Sign REST API v6 (OAuth2).

// ============================================================================
//  CONSTANTS
// ============================================================================
// Adobe Acrobat Sign is REGION-SHARDED: every account lives on a shard (na1, eu1, jp1, ...)
// visible in the account URL (e.g. secure.na1.adobesign.com). The OAuth authorize page lives on
// secure.{shard}.adobesign.com and the OAuth token endpoints on api.{shard}.adobesign.com.
//
// IMPORTANT: the OAuth shard host must NOT be used for regular API calls. After the token
// exchange, GET /api/rest/v6/baseUris returns the account's `apiAccessPoint`, and Adobe requires
// all subsequent API calls to go through it. Following the platform's composite-token pattern
// (docs/flowrunner-extension-oauth2.md), the apiAccessPoint is embedded into the stored `token`
// field so it rides back on the oauth-access-token header on every call.
const TOKEN_DELIMITER = '::sign::'

// Scopes use the `scope:modifier` form (modifier self/group/account); space-separated.
const OAUTH_SCOPES = [
  'user_read:self',
  'user_write:self',
  'agreement_read:self',
  'agreement_write:self',
  'agreement_send:self',
  'library_read:self',
  'widget_read:self',
].join(' ')

const DEFAULT_SHARD = 'na1'
const SHARDS = ['na1', 'na2', 'na3', 'na4', 'eu1', 'eu2', 'jp1', 'au1', 'in1', 'sg1']

// Friendly DROPDOWN labels the UI shows, mapped to the API values Acrobat Sign expects.
const RECIPIENT_ROLE_MAP = {
  'Signer': 'SIGNER',
  'Approver': 'APPROVER',
  'Acceptor': 'ACCEPTOR',
  'Certified Recipient': 'CERTIFIED_RECIPIENT',
  'Form Filler': 'FORM_FILLER',
}

const REMINDER_FREQUENCY_MAP = {
  'Daily Until Signed': 'DAILY_UNTIL_SIGNED',
  'Weekdays Until Signed': 'WEEKDAILY_UNTIL_SIGNED',
  'Every Other Day Until Signed': 'EVERY_OTHER_DAY_UNTIL_SIGNED',
  'Every Third Day Until Signed': 'EVERY_THIRD_DAY_UNTIL_SIGNED',
  'Every Fifth Day Until Signed': 'EVERY_FIFTH_DAY_UNTIL_SIGNED',
  'Weekly Until Signed': 'WEEKLY_UNTIL_SIGNED',
  'Once': 'ONCE',
}

const ERROR_HINTS = {
  400: 'The request was rejected — check the field values (emails, IDs, and dates must be valid).',
  401: 'Authentication failed — reconnect the Adobe Acrobat Sign account.',
  403: 'Access denied — the connected account lacks permission or the OAuth app is missing the required scope.',
  404: 'Not found — the ID may be wrong, or the resource is not yet available (e.g. signing URLs before the agreement is out for signature).',
  429: 'Rate limit hit — retry in a moment.',
}

// ============================================================================
//  LOGGER
// ============================================================================
const logger = {
  info: (...args) => console.log('[Adobe Acrobat Sign] info:', ...args),
  debug: (...args) => console.log('[Adobe Acrobat Sign] debug:', ...args),
  error: (...args) => console.log('[Adobe Acrobat Sign] error:', ...args),
  warn: (...args) => console.log('[Adobe Acrobat Sign] warn:', ...args),
}

// ============================================================================
//  DICTIONARY PAYLOAD TYPEDEFS
// ============================================================================
/**
 * @typedef {Object} getLibraryDocumentsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter library templates by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 */

/**
 * @typedef {Object} getAgreementsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter agreements by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 */

/**
 * @typedef {Object} getGroupsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter groups by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
 */

/**
 * @usesFileStorage
 * @integrationName Adobe Acrobat Sign
 * @integrationIcon /icon.png
 * @requireOAuth
 */
class AdobeAcrobatSign {
  constructor(config) {
    this.config = config || {}
    this.clientId = this.config.clientId
    this.clientSecret = this.config.clientSecret
    this.shard = this.config.shard || DEFAULT_SHARD
  }

  // ==========================================================================
  //  CORE - every v6 API call goes through #apiRequest
  // ==========================================================================
  async #apiRequest({ path, method, body, query, logTag }) {
    method = method || 'get'

    const { accessToken, apiBase } = this.#creds()
    const url = `${ apiBase }${ path }`

    try {
      logger.debug(`${ logTag } ${ method.toUpperCase() } ${ url }`)

      const request = Flowrunner.Request[method](url)
        .set(this.#headers(accessToken, body !== undefined))
        .query(query || {})

      if (body !== undefined) {
        return await request.send(body)
      }

      return await request
    } catch (error) {
      this.#handleError(error, logTag)
    }
  }

  #headers(accessToken, hasBody) {
    const headers = {
      Authorization: `Bearer ${ accessToken }`,
      Accept: 'application/json',
    }

    if (hasBody) {
      headers['Content-Type'] = 'application/json'
    }

    return headers
  }

  #handleError(error, logTag) {
    const status = error?.status || error?.statusCode
    const apiMessage =
      error?.body?.message ||
      error?.body?.error_description ||
      error?.body?.error ||
      error?.message ||
      'Request failed'
    const apiCode = error?.body?.code
    const hint = ERROR_HINTS[status]

    logger.error(`${ logTag } failed: ${ apiMessage }${ apiCode ? ` (${ apiCode })` : '' }`)

    throw new Error(hint ? `${ hint } (${ apiMessage })` : apiMessage)
  }

  // Translate a friendly DROPDOWN label into the API value; pass through anything unmapped.
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) return undefined

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // The composite token from the header: "<accessToken>::sign::<apiAccessPoint>".
  #getCompositeToken() {
    const token = this.request.headers['oauth-access-token']

    if (!token) {
      throw new Error('Access token is not available. Please reconnect the Adobe Acrobat Sign account.')
    }

    return token
  }

  // Splits the composite token into the bearer token and the account's API access point.
  // apiAccessPoint always ends with a trailing slash (e.g. https://api.na1.adobesign.com/).
  #creds() {
    const [accessToken, apiAccessPoint] = this.#getCompositeToken().split(TOKEN_DELIMITER)

    if (!apiAccessPoint) {
      throw new Error('API access point is unavailable — reconnect the Adobe Acrobat Sign account so it can be captured.')
    }

    return { accessToken, apiAccessPoint, apiBase: `${ apiAccessPoint }api/rest/v6` }
  }

  #buildCompositeToken(accessToken, apiAccessPoint) {
    return [accessToken, apiAccessPoint].join(TOKEN_DELIMITER)
  }

  // OAuth token endpoints live on the shard host configured for the connection; regular API calls
  // must instead use the apiAccessPoint resolved from /baseUris (see #resolveApiAccessPoint).
  #oauthApiHost() {
    return `https://api.${ this.shard }.adobesign.com`
  }

  // Adobe requires all API calls to use the access point returned by GET /api/rest/v6/baseUris
  // (calling the wrong host fails once the account is not on the queried shard).
  async #resolveApiAccessPoint(accessToken) {
    const response = await Flowrunner.Request.get(`${ this.#oauthApiHost() }/api/rest/v6/baseUris`)
      .set({ Authorization: `Bearer ${ accessToken }`, Accept: 'application/json' })

    const apiAccessPoint = response?.apiAccessPoint

    if (!apiAccessPoint) {
      throw new Error('Could not resolve the Adobe Acrobat Sign API access point from /baseUris. Verify the Shard config item matches your account region and reconnect.')
    }

    return apiAccessPoint.endsWith('/') ? apiAccessPoint : `${ apiAccessPoint }/`
  }

  // ==========================================================================
  //  OAUTH2 SYSTEM METHODS
  // ==========================================================================
  /**
   * @registerAs SYSTEM
   * @route GET /getOAuth2ConnectionURL
   */
  async getOAuth2ConnectionURL() {
    // redirect_uri and state are injected by the FlowRunner platform - do not append them here.
    // The authorize page lives on the account's shard host (secure.{shard}.adobesign.com).
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId,
      scope: OAUTH_SCOPES,
    })

    return `https://secure.${ this.shard }.adobesign.com/public/oauth/v2?${ params.toString() }`
  }

  /**
   * @registerAs SYSTEM
   * @route POST /executeCallback
   * @param {Object} callbackObject
   */
  async executeCallback(callbackObject) {
    // Exchange the code on the shard's token endpoint, then resolve the account's apiAccessPoint
    // from /baseUris and embed it into the stored token (composite-token pattern) so every later
    // operation calls the correct regional API host.
    const tokenResponse = await Flowrunner.Request.post(`${ this.#oauthApiHost() }/oauth/v2/token`)
      .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
      .send(
        new URLSearchParams({
          grant_type: 'authorization_code',
          code: callbackObject.code,
          client_id: this.clientId,
          client_secret: this.clientSecret,
          redirect_uri: callbackObject.redirectURI,
        }).toString()
      )

    const apiAccessPoint = await this.#resolveApiAccessPoint(tokenResponse.access_token)

    // Identify the connected user for the connection card (best-effort).
    let identityName = null

    try {
      const me = await Flowrunner.Request.get(`${ apiAccessPoint }api/rest/v6/users/me`)
        .set({ Authorization: `Bearer ${ tokenResponse.access_token }`, Accept: 'application/json' })

      identityName = [me?.firstName, me?.lastName].filter(Boolean).join(' ').trim() || me?.email || null
    } catch (error) {
      logger.warn(`executeCallback: could not resolve user identity: ${ error?.body?.message || error?.message }`)
    }

    return {
      token: this.#buildCompositeToken(tokenResponse.access_token, apiAccessPoint),
      expirationInSeconds: tokenResponse.expires_in,
      refreshToken: tokenResponse.refresh_token,
      connectionIdentityName: identityName,
      connectionIdentityImageURL: null,
      overwrite: true,
    }
  }

  /**
   * @registerAs SYSTEM
   * @route PUT /refreshToken
   * @param {String} refreshToken
   */
  async refreshToken(refreshToken) {
    // NOTE: Acrobat Sign uses a DIFFERENT path for refresh (/oauth/v2/refresh, not /oauth/v2/token).
    // Access tokens live 3600s; the refresh token is long-lived and is not rotated on refresh.
    const tokenResponse = await Flowrunner.Request.post(`${ this.#oauthApiHost() }/oauth/v2/refresh`)
      .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
      .send(
        new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: this.clientId,
          client_secret: this.clientSecret,
          refresh_token: refreshToken,
        }).toString()
      )

    // The account stays on the same shard, but re-resolve /baseUris to be safe; if that fails,
    // fall back to the access point already embedded in the current composite token.
    let apiAccessPoint

    try {
      apiAccessPoint = await this.#resolveApiAccessPoint(tokenResponse.access_token)
    } catch (error) {
      logger.warn(`refreshToken: baseUris re-resolution failed, reusing stored access point: ${ error?.message }`)
      apiAccessPoint = this.#getCompositeToken().split(TOKEN_DELIMITER)[1]

      if (!apiAccessPoint) throw error
    }

    return {
      token: this.#buildCompositeToken(tokenResponse.access_token, apiAccessPoint),
      expirationInSeconds: tokenResponse.expires_in,
      refreshToken: tokenResponse.refresh_token || refreshToken,
    }
  }

  // ==========================================================================
  //  TRANSIENT DOCUMENTS
  // ==========================================================================
  /**
   * @operationName Upload Transient Document
   * @category Transient Documents
   * @description Uploads a FlowRunner file to Adobe Acrobat Sign as a transient document and returns its transientDocumentId. A transient document is temporary server-side storage (kept for about 7 days) that exists solely to be referenced when sending an agreement or creating a draft — pass the returned ID to Send Agreement or Create Draft Agreement as the Transient Document ID. Supported formats include PDF, Word, Excel, PowerPoint, text, and common image types.
   * @route POST /upload-transient-document
   * @paramDef {"type":"String","label":"File","name":"fileUrl","required":true,"uiComponent":{"type":"FILE_SELECTOR"},"description":"The FlowRunner file to upload (its URL). The file's bytes are streamed to Acrobat Sign."}
   * @paramDef {"type":"String","label":"File Name","name":"fileName","description":"Name to record for the document, including extension (e.g. Contract.pdf). Defaults to the source file name."}
   * @paramDef {"type":"String","label":"MIME Type","name":"mimeType","description":"Optional MIME type of the file (e.g. application/pdf). When omitted, Acrobat Sign detects it from the file name."}
   * @returns {Object}
   * @sampleResult {"transientDocumentId":"3AAABLblqZhB8LOu8DGVzD1D0e_ums2Q0EagVmS9NGB1JAe3Il9wUnAlOncNqyqzC"}
   */
  async uploadTransientDocument(fileUrl, fileName, mimeType) {
    if (!fileUrl) throw new Error('File is required.')

    const { accessToken, apiBase } = this.#creds()

    try {
      logger.debug(`uploadTransientDocument from ${ fileUrl }`)

      const resolvedName = fileName || decodeURIComponent(String(fileUrl).split('/').pop().split('?')[0])
      const fileBytes = await Flowrunner.Request.get(fileUrl).setEncoding(null)
      const buffer = Buffer.isBuffer(fileBytes) ? fileBytes : Buffer.from(fileBytes)

      // Do NOT set Content-Type manually — the form supplies the multipart boundary.
      const formData = new Flowrunner.Request.FormData()

      formData.append('File-Name', resolvedName)

      if (mimeType) formData.append('Mime-Type', mimeType)

      formData.append('File', buffer, { filename: resolvedName })

      return await Flowrunner.Request.post(`${ apiBase }/transientDocuments`)
        .set({ Authorization: `Bearer ${ accessToken }` })
        .form(formData)
    } catch (error) {
      this.#handleError(error, 'uploadTransientDocument')
    }
  }

  // ==========================================================================
  //  AGREEMENTS
  // ==========================================================================
  /**
   * @operationName Send Agreement
   * @category Agreements
   * @description Creates an agreement and immediately sends it out for e-signature. Provide the document as either a Transient Document ID (from Upload Transient Document) or a library template, plus the recipient emails — each recipient becomes their own participant set and signs in the listed order. Recipients get an email with a signing link; use Get Agreement to track status. For multi-member participant sets, mixed roles, or phone authentication, supply the raw Participant Sets Info override instead of Recipient Emails.
   * @route POST /send-agreement
   * @paramDef {"type":"String","label":"Agreement Name","name":"name","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The agreement title shown to recipients and in the Acrobat Sign manage page."}
   * @paramDef {"type":"Array<String>","label":"Recipient Emails","name":"recipientEmails","description":"Email addresses of the recipients. Each becomes its own participant set and acts in the listed order (first email signs first). Required unless Participant Sets Info is provided."}
   * @paramDef {"type":"String","label":"Transient Document ID","name":"transientDocumentId","description":"The document to send, from Upload Transient Document. Provide this OR a Library Template."}
   * @paramDef {"type":"String","label":"Library Template","name":"templateId","dictionary":"getLibraryDocumentsDictionary","description":"A reusable library template to send instead of an uploaded file. Provide this OR a Transient Document ID."}
   * @paramDef {"type":"String","label":"Recipient Role","name":"recipientRole","uiComponent":{"type":"DROPDOWN","options":{"values":["Signer","Approver","Acceptor","Certified Recipient","Form Filler"]}},"defaultValue":"Signer","description":"The role every recipient plays: Signer (signs), Approver (approves without signing), Acceptor (accepts terms), Certified Recipient (acknowledges receipt), or Form Filler (fills form fields)."}
   * @paramDef {"type":"String","label":"Message","name":"message","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional message included in the email sent to recipients."}
   * @paramDef {"type":"Array<String>","label":"CC Emails","name":"ccEmails","description":"Email addresses to CC. They receive the final signed document but take no action."}
   * @paramDef {"type":"String","label":"Expiration Time","name":"expirationTime","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Deadline after which the agreement can no longer be signed (ISO8601, e.g. 2026-09-30T23:59:59Z)."}
   * @paramDef {"type":"String","label":"Reminder Frequency","name":"reminderFrequency","uiComponent":{"type":"DROPDOWN","options":{"values":["Daily Until Signed","Weekdays Until Signed","Every Other Day Until Signed","Every Third Day Until Signed","Every Fifth Day Until Signed","Weekly Until Signed","Once"]}},"description":"How often Acrobat Sign automatically reminds recipients who have not yet acted."}
   * @paramDef {"type":"String","label":"External ID","name":"externalId","description":"Optional identifier from your own system, stored on the agreement and searchable later."}
   * @paramDef {"type":"Array<Object>","label":"Participant Sets Info","name":"participantSetsInfo","description":"Advanced override: raw Acrobat Sign participantSetsInfo array (e.g. [{\"memberInfos\":[{\"email\":\"a@b.com\"}],\"order\":1,\"role\":\"SIGNER\"}]). When provided, Recipient Emails and Recipient Role are ignored."}
   * @returns {Object}
   * @sampleResult {"id":"CBJCHBCAABAAxwOZk7Y_1PYPGvMPUxbSDVvBQIRTAcYs"}
   */
  async sendAgreement(name, recipientEmails, transientDocumentId, templateId, recipientRole, message, ccEmails, expirationTime, reminderFrequency, externalId, participantSetsInfo) {
    const body = this.#buildAgreementBody({
      name,
      recipientEmails,
      transientDocumentId,
      templateId,
      recipientRole,
      message,
      ccEmails,
      expirationTime,
      reminderFrequency,
      externalId,
      participantSetsInfo,
      state: 'IN_PROCESS',
    })

    return await this.#apiRequest({
      path: '/agreements',
      method: 'post',
      body,
      logTag: 'sendAgreement',
    })
  }

  /**
   * @operationName Create Draft Agreement
   * @category Agreements
   * @description Creates an agreement in DRAFT state without sending it, so it can be reviewed or completed in the Acrobat Sign web app before going out. Takes the same inputs as Send Agreement: a Transient Document ID or library template plus recipient emails (each its own participant set, acting in the listed order). Returns the new agreement's ID.
   * @route POST /create-draft-agreement
   * @paramDef {"type":"String","label":"Agreement Name","name":"name","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The agreement title shown in the Acrobat Sign manage page."}
   * @paramDef {"type":"Array<String>","label":"Recipient Emails","name":"recipientEmails","description":"Email addresses of the recipients. Each becomes its own participant set and acts in the listed order. Required unless Participant Sets Info is provided."}
   * @paramDef {"type":"String","label":"Transient Document ID","name":"transientDocumentId","description":"The document for the draft, from Upload Transient Document. Provide this OR a Library Template."}
   * @paramDef {"type":"String","label":"Library Template","name":"templateId","dictionary":"getLibraryDocumentsDictionary","description":"A reusable library template to use instead of an uploaded file. Provide this OR a Transient Document ID."}
   * @paramDef {"type":"String","label":"Recipient Role","name":"recipientRole","uiComponent":{"type":"DROPDOWN","options":{"values":["Signer","Approver","Acceptor","Certified Recipient","Form Filler"]}},"defaultValue":"Signer","description":"The role every recipient plays: Signer, Approver, Acceptor, Certified Recipient, or Form Filler."}
   * @paramDef {"type":"String","label":"Message","name":"message","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional message that will be included in the recipient email when the draft is eventually sent."}
   * @paramDef {"type":"Array<String>","label":"CC Emails","name":"ccEmails","description":"Email addresses to CC on the final signed document."}
   * @paramDef {"type":"String","label":"Expiration Time","name":"expirationTime","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Deadline after which the agreement can no longer be signed (ISO8601)."}
   * @paramDef {"type":"String","label":"Reminder Frequency","name":"reminderFrequency","uiComponent":{"type":"DROPDOWN","options":{"values":["Daily Until Signed","Weekdays Until Signed","Every Other Day Until Signed","Every Third Day Until Signed","Every Fifth Day Until Signed","Weekly Until Signed","Once"]}},"description":"How often Acrobat Sign automatically reminds recipients once the agreement is sent."}
   * @paramDef {"type":"String","label":"External ID","name":"externalId","description":"Optional identifier from your own system, stored on the agreement and searchable later."}
   * @paramDef {"type":"Array<Object>","label":"Participant Sets Info","name":"participantSetsInfo","description":"Advanced override: raw Acrobat Sign participantSetsInfo array. When provided, Recipient Emails and Recipient Role are ignored."}
   * @returns {Object}
   * @sampleResult {"id":"CBJCHBCAABAAxwOZk7Y_1PYPGvMPUxbSDVvBQIRTAcYs"}
   */
  async createDraftAgreement(name, recipientEmails, transientDocumentId, templateId, recipientRole, message, ccEmails, expirationTime, reminderFrequency, externalId, participantSetsInfo) {
    const body = this.#buildAgreementBody({
      name,
      recipientEmails,
      transientDocumentId,
      templateId,
      recipientRole,
      message,
      ccEmails,
      expirationTime,
      reminderFrequency,
      externalId,
      participantSetsInfo,
      state: 'DRAFT',
    })

    return await this.#apiRequest({
      path: '/agreements',
      method: 'post',
      body,
      logTag: 'createDraftAgreement',
    })
  }

  /**
   * @operationName List Agreements
   * @category Agreements
   * @description Lists the connected user's agreements, most recent first, with each agreement's ID, name, status (e.g. OUT_FOR_SIGNATURE, SIGNED, CANCELLED), and display date. Paginate with the cursor returned in page.nextCursor.
   * @route GET /list-agreements
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":20,"description":"Number of agreements per page (default 20, max 100)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a previous call's page.nextCursor."}
   * @returns {Object}
   * @sampleResult {"userAgreementList":[{"id":"CBJCHBCAABAAxwOZk7Y_1PYPGvMPUxbSDVvBQIRTAcYs","name":"NDA - Acme Corp","status":"OUT_FOR_SIGNATURE","esign":true,"displayDate":"2026-07-01T10:15:00Z","latestVersionId":"versionId","groupId":"groupId","hidden":false}],"page":{"nextCursor":"Am9vgFvIfd3iKf..."}}
   */
  async listAgreements(pageSize, cursor) {
    const query = { pageSize: pageSize || 20 }

    if (cursor) query.cursor = cursor

    return await this.#apiRequest({
      path: '/agreements',
      query,
      logTag: 'listAgreements',
    })
  }

  /**
   * @operationName Get Agreement
   * @category Agreements
   * @description Retrieves the full details of a single agreement — name, status, participant sets with roles and order, sender, creation date, expiration, message, and external ID. Use this to check whether an agreement has been signed, declined, or is still out for signature.
   * @route GET /get-agreement
   * @paramDef {"type":"String","label":"Agreement","name":"agreementId","required":true,"dictionary":"getAgreementsDictionary","description":"The agreement to fetch."}
   * @returns {Object}
   * @sampleResult {"id":"CBJCHBCAABAAxwOZk7Y_1PYPGvMPUxbSDVvBQIRTAcYs","name":"NDA - Acme Corp","status":"OUT_FOR_SIGNATURE","signatureType":"ESIGN","senderEmail":"sender@example.com","createdDate":"2026-07-01T10:15:00Z","expirationTime":"2026-09-30T23:59:59Z","message":"Please sign this NDA.","participantSetsInfo":[{"memberInfos":[{"email":"jane@example.com"}],"order":1,"role":"SIGNER"}],"locale":"en_US"}
   */
  async getAgreement(agreementId) {
    if (!agreementId) throw new Error('Agreement is required.')

    return await this.#apiRequest({
      path: `/agreements/${ agreementId }`,
      logTag: 'getAgreement',
    })
  }

  /**
   * @operationName Cancel Agreement
   * @category Agreements
   * @description Cancels an in-process agreement so it can no longer be signed. Optionally records a cancellation comment and notifies the remaining participants by email. Only agreements that are still in progress (e.g. OUT_FOR_SIGNATURE) can be cancelled; completed agreements cannot.
   * @route PUT /cancel-agreement
   * @paramDef {"type":"String","label":"Agreement","name":"agreementId","required":true,"dictionary":"getAgreementsDictionary","description":"The agreement to cancel."}
   * @paramDef {"type":"String","label":"Comment","name":"comment","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional reason for the cancellation, recorded in the agreement's audit trail."}
   * @paramDef {"type":"Boolean","label":"Notify Participants","name":"notifyOthers","uiComponent":{"type":"CHECKBOX"},"description":"When enabled, participants who had not yet completed the agreement are emailed about the cancellation."}
   * @returns {Object}
   * @sampleResult {"cancelled":true,"agreementId":"CBJCHBCAABAAxwOZk7Y_1PYPGvMPUxbSDVvBQIRTAcYs"}
   */
  async cancelAgreement(agreementId, comment, notifyOthers) {
    if (!agreementId) throw new Error('Agreement is required.')

    const agreementCancellationInfo = {}

    if (comment) agreementCancellationInfo.comment = comment

    if (notifyOthers !== undefined && notifyOthers !== null && notifyOthers !== '') {
      agreementCancellationInfo.notifyOthers = Boolean(notifyOthers)
    }

    await this.#apiRequest({
      path: `/agreements/${ agreementId }/state`,
      method: 'put',
      body: { state: 'CANCELLED', agreementCancellationInfo },
      logTag: 'cancelAgreement',
    })

    return { cancelled: true, agreementId }
  }

  /**
   * @operationName Get Signing URLs
   * @category Agreements
   * @description Retrieves the signing URLs for an agreement's current participants — the links each signer uses to open and sign the document. Useful for embedding a signing link in your own email or app instead of relying on Acrobat Sign's notification. Only available while the agreement is out for signature; Acrobat Sign returns 404 before the agreement reaches the participant or after completion.
   * @route GET /get-signing-urls
   * @paramDef {"type":"String","label":"Agreement","name":"agreementId","required":true,"dictionary":"getAgreementsDictionary","description":"The agreement whose signing URLs to fetch."}
   * @returns {Object}
   * @sampleResult {"signingUrlSetInfos":[{"signingUrlSetName":"Signers","signingUrls":[{"email":"jane@example.com","esignUrl":"https://secure.na1.adobesign.com/public/apiesign?pid=CBFCIBAA3..."}]}]}
   */
  async getSigningUrls(agreementId) {
    if (!agreementId) throw new Error('Agreement is required.')

    return await this.#apiRequest({
      path: `/agreements/${ agreementId }/signingUrls`,
      logTag: 'getSigningUrls',
    })
  }

  /**
   * @operationName Get Agreement Members
   * @category Agreements
   * @description Lists all members of an agreement — the participant sets with each participant's ID, email, role, order, and status, plus CC recipients and the sender. The participant IDs returned here are what Send Reminder expects in Recipient Participant IDs.
   * @route GET /get-agreement-members
   * @paramDef {"type":"String","label":"Agreement","name":"agreementId","required":true,"dictionary":"getAgreementsDictionary","description":"The agreement whose members to list."}
   * @paramDef {"type":"Boolean","label":"Include Next Participant Set","name":"includeNextParticipantSet","uiComponent":{"type":"CHECKBOX"},"description":"When enabled, the response also identifies which participant set is next in line to act."}
   * @returns {Object}
   * @sampleResult {"participantSets":[{"id":"CBJCHBCAABAA5JnZDgsBYtBcbvRpUOl3P4kBksSbLR9U","memberInfos":[{"id":"memberId","email":"jane@example.com","status":"WAITING_FOR_MY_SIGNATURE"}],"order":1,"role":"SIGNER","status":"WAITING_FOR_MY_SIGNATURE"}],"ccsInfo":[{"email":"legal@example.com"}],"senderInfo":{"email":"sender@example.com","status":"OUT_FOR_SIGNATURE"}}
   */
  async getAgreementMembers(agreementId, includeNextParticipantSet) {
    if (!agreementId) throw new Error('Agreement is required.')

    const query = {}

    if (includeNextParticipantSet) query.includeNextParticipantSet = true

    return await this.#apiRequest({
      path: `/agreements/${ agreementId }/members`,
      query,
      logTag: 'getAgreementMembers',
    })
  }

  /**
   * @operationName Get Agreement Events
   * @category Agreements
   * @description Retrieves the audit event history of an agreement — creation, emails sent and viewed, signatures, delegations, reminders, cancellation, and completion — each with its timestamp, acting participant, and event type. Use this to build a timeline of what happened to an agreement.
   * @route GET /get-agreement-events
   * @paramDef {"type":"String","label":"Agreement","name":"agreementId","required":true,"dictionary":"getAgreementsDictionary","description":"The agreement whose event history to fetch."}
   * @returns {Object}
   * @sampleResult {"events":[{"type":"CREATED","date":"2026-07-01T10:15:00Z","participantEmail":"sender@example.com","description":"Document created by sender@example.com"},{"type":"ESIGNED","date":"2026-07-02T09:30:00Z","participantEmail":"jane@example.com","description":"Document e-signed by jane@example.com"}]}
   */
  async getAgreementEvents(agreementId) {
    if (!agreementId) throw new Error('Agreement is required.')

    return await this.#apiRequest({
      path: `/agreements/${ agreementId }/events`,
      logTag: 'getAgreementEvents',
    })
  }

  /**
   * @operationName Send Reminder
   * @category Agreements
   * @description Sends a reminder email to specific participants of an agreement who have not yet acted. Get the participant IDs from Get Agreement Members (the participantSets[].id values); an optional note is included in the reminder email.
   * @route POST /send-reminder
   * @paramDef {"type":"String","label":"Agreement","name":"agreementId","required":true,"dictionary":"getAgreementsDictionary","description":"The agreement to send reminders for."}
   * @paramDef {"type":"Array<String>","label":"Recipient Participant IDs","name":"recipientParticipantIds","required":true,"description":"The participant IDs to remind, from Get Agreement Members (participantSets[].id)."}
   * @paramDef {"type":"String","label":"Note","name":"note","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional note included in the reminder email."}
   * @returns {Object}
   * @sampleResult {"id":"3AAABLblqZhAJxDVLLKrK1_R8Y3v","status":"ACTIVE","recipientParticipantIds":["CBJCHBCAABAA5JnZDgsBYtBcbvRpUOl3P4kBksSbLR9U"]}
   */
  async sendReminder(agreementId, recipientParticipantIds, note) {
    if (!agreementId) throw new Error('Agreement is required.')

    const participantIds = this.#parseStringArray(recipientParticipantIds)

    if (!participantIds || participantIds.length === 0) {
      throw new Error('At least one Recipient Participant ID is required (from Get Agreement Members).')
    }

    const body = { recipientParticipantIds: participantIds, status: 'ACTIVE' }

    if (note) body.note = note

    return await this.#apiRequest({
      path: `/agreements/${ agreementId }/reminders`,
      method: 'post',
      body,
      logTag: 'sendReminder',
    })
  }

  /**
   * @operationName Get Form Data
   * @category Agreements
   * @description Retrieves the form field data entered by participants of an agreement as CSV. Returns the raw CSV text plus, when it can be parsed, an array of row objects keyed by the CSV headers (one row per participant/submission). Useful for pulling signer-entered values (names, dates, custom fields) into a flow after signing.
   * @route GET /get-form-data
   * @paramDef {"type":"String","label":"Agreement","name":"agreementId","required":true,"dictionary":"getAgreementsDictionary","description":"The agreement whose form field data to fetch."}
   * @returns {Object}
   * @sampleResult {"csv":"completed,email,role,first,last\n2026-07-02,jane@example.com,SIGNER,Jane,Doe","rows":[{"completed":"2026-07-02","email":"jane@example.com","role":"SIGNER","first":"Jane","last":"Doe"}]}
   */
  async getFormData(agreementId) {
    if (!agreementId) throw new Error('Agreement is required.')

    const { accessToken, apiBase } = this.#creds()

    try {
      logger.debug(`getFormData GET ${ apiBase }/agreements/${ agreementId }/formData`)

      const raw = await Flowrunner.Request.get(`${ apiBase }/agreements/${ agreementId }/formData`)
        .set({ Authorization: `Bearer ${ accessToken }`, Accept: 'text/csv' })

      const csv = typeof raw === 'string' ? raw : Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw)

      return { csv, rows: this.#parseCsv(csv) }
    } catch (error) {
      this.#handleError(error, 'getFormData')
    }
  }

  /**
   * @operationName Download Agreement PDF
   * @category Agreements
   * @description Downloads the agreement's combined document PDF (all documents merged into one file, including signatures once signed), saves it to FlowRunner file storage, and returns the saved file's URL. Optionally includes supporting documents and appends the audit report to the PDF.
   * @route POST /download-agreement-pdf
   * @paramDef {"type":"String","label":"Agreement","name":"agreementId","required":true,"dictionary":"getAgreementsDictionary","description":"The agreement whose combined PDF to download."}
   * @paramDef {"type":"Boolean","label":"Attach Supporting Documents","name":"attachSupportingDocuments","uiComponent":{"type":"CHECKBOX"},"defaultValue":true,"description":"When enabled, participant-uploaded supporting documents are included in the PDF."}
   * @paramDef {"type":"Boolean","label":"Attach Audit Report","name":"attachAuditReport","uiComponent":{"type":"CHECKBOX"},"description":"When enabled, the audit report is appended to the end of the PDF."}
   * @paramDef {"type":"FilesUploadOptions","label":"File Settings","name":"fileOptions","required":false,"include":["scope"],"description":"Where to store the downloaded PDF in FlowRunner file storage."}
   * @returns {Object}
   * @sampleResult {"url":"https://files.flowrunner.com/flows/abc/agreement_CBJCHBCAABAA.pdf","filename":"agreement_CBJCHBCAABAA.pdf","sizeBytes":245760,"agreementId":"CBJCHBCAABAAxwOZk7Y_1PYPGvMPUxbSDVvBQIRTAcYs"}
   */
  async downloadAgreementPdf(agreementId, attachSupportingDocuments, attachAuditReport, fileOptions) {
    if (!agreementId) throw new Error('Agreement is required.')

    const { accessToken, apiBase } = this.#creds()

    try {
      logger.debug(`downloadAgreementPdf ${ agreementId }`)

      const query = {
        attachSupportingDocuments:
          attachSupportingDocuments === undefined || attachSupportingDocuments === null || attachSupportingDocuments === ''
            ? true
            : Boolean(attachSupportingDocuments),
        attachAuditReport: Boolean(attachAuditReport),
      }

      const bytes = await Flowrunner.Request.get(`${ apiBase }/agreements/${ agreementId }/combinedDocument`)
        .set({ Authorization: `Bearer ${ accessToken }` })
        .query(query)
        .setEncoding(null)

      const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
      const filename = `agreement_${ agreementId }.pdf`

      const { url } = await this.flowrunner.Files.uploadFile(buffer, {
        filename,
        generateUrl: true,
        overwrite: true,
        ...(fileOptions || { scope: 'FLOW' }),
      })

      return { url, filename, sizeBytes: buffer.length, agreementId }
    } catch (error) {
      this.#handleError(error, 'downloadAgreementPdf')
    }
  }

  /**
   * @operationName Download Audit Trail
   * @category Agreements
   * @description Downloads the agreement's audit trail as a PDF — the certified record of who did what and when (sent, viewed, signed, IP addresses) — saves it to FlowRunner file storage, and returns the saved file's URL. Commonly archived alongside the signed document for compliance.
   * @route POST /download-audit-trail
   * @paramDef {"type":"String","label":"Agreement","name":"agreementId","required":true,"dictionary":"getAgreementsDictionary","description":"The agreement whose audit trail PDF to download."}
   * @paramDef {"type":"FilesUploadOptions","label":"File Settings","name":"fileOptions","required":false,"include":["scope"],"description":"Where to store the downloaded PDF in FlowRunner file storage."}
   * @returns {Object}
   * @sampleResult {"url":"https://files.flowrunner.com/flows/abc/audit_trail_CBJCHBCAABAA.pdf","filename":"audit_trail_CBJCHBCAABAA.pdf","sizeBytes":83214,"agreementId":"CBJCHBCAABAAxwOZk7Y_1PYPGvMPUxbSDVvBQIRTAcYs"}
   */
  async downloadAuditTrail(agreementId, fileOptions) {
    if (!agreementId) throw new Error('Agreement is required.')

    const { accessToken, apiBase } = this.#creds()

    try {
      logger.debug(`downloadAuditTrail ${ agreementId }`)

      const bytes = await Flowrunner.Request.get(`${ apiBase }/agreements/${ agreementId }/auditTrail`)
        .set({ Authorization: `Bearer ${ accessToken }` })
        .setEncoding(null)

      const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
      const filename = `audit_trail_${ agreementId }.pdf`

      const { url } = await this.flowrunner.Files.uploadFile(buffer, {
        filename,
        generateUrl: true,
        overwrite: true,
        ...(fileOptions || { scope: 'FLOW' }),
      })

      return { url, filename, sizeBytes: buffer.length, agreementId }
    } catch (error) {
      this.#handleError(error, 'downloadAuditTrail')
    }
  }

  /**
   * @operationName List Agreement Documents
   * @category Agreements
   * @description Lists the individual documents that make up an agreement, with each document's ID, name, MIME type, and page count. Use this to see what files were included before downloading the combined PDF.
   * @route GET /list-agreement-documents
   * @paramDef {"type":"String","label":"Agreement","name":"agreementId","required":true,"dictionary":"getAgreementsDictionary","description":"The agreement whose documents to list."}
   * @returns {Object}
   * @sampleResult {"documents":[{"id":"3AAABLblqZhBK-1XkeqmnHERT","name":"NDA.pdf","mimeType":"application/pdf","numPages":4}]}
   */
  async listAgreementDocuments(agreementId) {
    if (!agreementId) throw new Error('Agreement is required.')

    return await this.#apiRequest({
      path: `/agreements/${ agreementId }/documents`,
      logTag: 'listAgreementDocuments',
    })
  }

  // ==========================================================================
  //  LIBRARY TEMPLATES
  // ==========================================================================
  /**
   * @operationName List Library Documents
   * @category Library Templates
   * @description Lists the reusable library templates available to the connected user, with each template's ID, name, sharing mode, and template types. Use a template's ID as the Library Template when sending an agreement. Paginate with the cursor returned in page.nextCursor.
   * @route GET /list-library-documents
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":20,"description":"Number of templates per page (default 20, max 100)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a previous call's page.nextCursor."}
   * @returns {Object}
   * @sampleResult {"libraryDocumentList":[{"id":"3AAABLblqZhCkPeg_H1yq_ic7","name":"Standard NDA Template","sharingMode":"USER","status":"ACTIVE","templateTypes":["DOCUMENT"],"modifiedDate":"2026-06-15T08:00:00Z","creatorEmail":"sender@example.com","hidden":false}],"page":{"nextCursor":"Am9vgFvIfd3iKf..."}}
   */
  async listLibraryDocuments(pageSize, cursor) {
    const query = { pageSize: pageSize || 20 }

    if (cursor) query.cursor = cursor

    return await this.#apiRequest({
      path: '/libraryDocuments',
      query,
      logTag: 'listLibraryDocuments',
    })
  }

  /**
   * @operationName Get Library Document
   * @category Library Templates
   * @description Retrieves the details of a single library template — name, status, sharing mode, template types, creator, and timestamps. Use this to inspect a template before sending agreements from it.
   * @route GET /get-library-document
   * @paramDef {"type":"String","label":"Library Template","name":"libraryDocumentId","required":true,"dictionary":"getLibraryDocumentsDictionary","description":"The library template to fetch."}
   * @returns {Object}
   * @sampleResult {"id":"3AAABLblqZhCkPeg_H1yq_ic7","name":"Standard NDA Template","sharingMode":"USER","status":"ACTIVE","templateTypes":["DOCUMENT"],"createdDate":"2026-01-10T12:00:00Z","modifiedDate":"2026-06-15T08:00:00Z","creatorEmail":"sender@example.com","hidden":false}
   */
  async getLibraryDocument(libraryDocumentId) {
    if (!libraryDocumentId) throw new Error('Library Template is required.')

    return await this.#apiRequest({
      path: `/libraryDocuments/${ libraryDocumentId }`,
      logTag: 'getLibraryDocument',
    })
  }

  // ==========================================================================
  //  WEB FORMS
  // ==========================================================================
  /**
   * @operationName List Web Forms
   * @category Web Forms
   * @description Lists the connected user's web forms (hosted signing forms, formerly called widgets), with each form's ID, name, status, and URL. Paginate with the cursor returned in page.nextCursor.
   * @route GET /list-web-forms
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":20,"description":"Number of web forms per page (default 20, max 100)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a previous call's page.nextCursor."}
   * @returns {Object}
   * @sampleResult {"userWidgetList":[{"id":"CBJCHBCAABAA6H3-uhBHTL5PqcJTb","name":"Event Waiver Form","status":"ACTIVE","url":"https://secure.na1.adobesign.com/public/hostedForm?formid=CBFCIBAA3","javascript":"<script src=...></script>","modifiedDate":"2026-06-20T14:30:00Z","hidden":false}],"page":{"nextCursor":"Am9vgFvIfd3iKf..."}}
   */
  async listWebForms(pageSize, cursor) {
    const query = { pageSize: pageSize || 20 }

    if (cursor) query.cursor = cursor

    return await this.#apiRequest({
      path: '/widgets',
      query,
      logTag: 'listWebForms',
    })
  }

  /**
   * @operationName Get Web Form
   * @category Web Forms
   * @description Retrieves the details of a single web form — name, status, hosted URL, embed code, and creation info. Use this to fetch a web form's public signing URL for sharing or embedding.
   * @route GET /get-web-form
   * @paramDef {"type":"String","label":"Web Form ID","name":"widgetId","required":true,"description":"The web form's ID (from List Web Forms)."}
   * @returns {Object}
   * @sampleResult {"id":"CBJCHBCAABAA6H3-uhBHTL5PqcJTb","name":"Event Waiver Form","status":"ACTIVE","url":"https://secure.na1.adobesign.com/public/hostedForm?formid=CBFCIBAA3","javascript":"<script src=...></script>","createdDate":"2026-05-01T09:00:00Z","locale":"en_US"}
   */
  async getWebForm(widgetId) {
    if (!widgetId) throw new Error('Web Form ID is required.')

    return await this.#apiRequest({
      path: `/widgets/${ widgetId }`,
      logTag: 'getWebForm',
    })
  }

  // ==========================================================================
  //  USERS
  // ==========================================================================
  /**
   * @operationName Get Current User
   * @category Users
   * @description Retrieves the profile of the connected Adobe Acrobat Sign user — ID, email, name, company, account and group membership, and locale. Useful for confirming which account the connection is bound to.
   * @route GET /get-current-user
   * @returns {Object}
   * @sampleResult {"id":"CBJCHBCAABAAo8NUXQOnBnbYCz","email":"sender@example.com","firstName":"Alex","lastName":"Morgan","company":"Acme Corp","accountId":"CBJCHBCAABAAdE2Copm","isAccountAdmin":false,"locale":"en_US","status":"ACTIVE"}
   */
  async getCurrentUser() {
    return await this.#apiRequest({
      path: '/users/me',
      logTag: 'getCurrentUser',
    })
  }

  /**
   * @operationName List Users
   * @category Users
   * @description Lists the users in the Adobe Acrobat Sign account with each user's ID, email, name, and company. NOTE: this endpoint requires the connected user to be an account administrator; non-admin connections receive a permission error. Paginate with the cursor returned in page.nextCursor.
   * @route GET /list-users
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":20,"description":"Number of users per page (default 20, max 100)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a previous call's page.nextCursor."}
   * @returns {Object}
   * @sampleResult {"userInfoList":[{"id":"CBJCHBCAABAAo8NUXQOnBnbYCz","email":"jane@example.com","firstName":"Jane","lastName":"Doe","company":"Acme Corp","isAccountAdmin":false}],"page":{"nextCursor":"Am9vgFvIfd3iKf..."}}
   */
  async listUsers(pageSize, cursor) {
    const query = { pageSize: pageSize || 20 }

    if (cursor) query.cursor = cursor

    return await this.#apiRequest({
      path: '/users',
      query,
      logTag: 'listUsers',
    })
  }

  // ==========================================================================
  //  GROUPS
  // ==========================================================================
  /**
   * @operationName List Groups
   * @category Groups
   * @description Lists the groups in the Adobe Acrobat Sign account that are visible to the connected user, with each group's ID, name, and creation date. Groups organize users and templates within an account. Paginate with the cursor returned in page.nextCursor.
   * @route GET /list-groups
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":20,"description":"Number of groups per page (default 20, max 100)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor from a previous call's page.nextCursor."}
   * @returns {Object}
   * @sampleResult {"groupInfoList":[{"groupId":"CBJCHBCAABAAUcc2NmO4kD","groupName":"Sales","createdDate":"2026-01-05T10:00:00Z","isDefaultGroup":true}],"page":{"nextCursor":"Am9vgFvIfd3iKf..."}}
   */
  async listGroups(pageSize, cursor) {
    const query = { pageSize: pageSize || 20 }

    if (cursor) query.cursor = cursor

    return await this.#apiRequest({
      path: '/groups',
      query,
      logTag: 'listGroups',
    })
  }

  // ==========================================================================
  //  DICTIONARIES
  // ==========================================================================
  /**
   * @registerAs DICTIONARY
   * @operationName Get Library Documents Dictionary
   * @description Lists reusable library templates for selection in dependent parameters. Each option shows the template name with its status as a note.
   * @route POST /get-library-documents-dictionary
   * @paramDef {"type":"getLibraryDocumentsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Standard NDA Template","value":"3AAABLblqZhCkPeg_H1yq_ic7","note":"ACTIVE"}],"cursor":null}
   */
  async getLibraryDocumentsDictionary(payload) {
    const { search, cursor } = payload || {}

    const query = { pageSize: 100 }

    if (cursor) query.cursor = cursor

    const result = await this.#apiRequest({
      path: '/libraryDocuments',
      query,
      logTag: 'getLibraryDocumentsDictionary',
    })

    const templates = result?.libraryDocumentList || []
    const term = (search || '').toLowerCase()

    const items = templates
      .filter(template => !term || (template.name || '').toLowerCase().includes(term))
      .map(template => ({
        label: template.name || template.id,
        value: template.id,
        note: template.status || undefined,
      }))

    return { items, cursor: result?.page?.nextCursor || null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Agreements Dictionary
   * @description Lists the connected user's recent agreements for selection in dependent parameters. Each option shows the agreement name with its status as a note.
   * @route POST /get-agreements-dictionary
   * @paramDef {"type":"getAgreementsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"NDA - Acme Corp","value":"CBJCHBCAABAAxwOZk7Y_1PYPGvMPUxbSDVvBQIRTAcYs","note":"OUT_FOR_SIGNATURE"}],"cursor":"Am9vgFvIfd3iKf"}
   */
  async getAgreementsDictionary(payload) {
    const { search, cursor } = payload || {}

    const query = { pageSize: 100 }

    if (cursor) query.cursor = cursor

    const result = await this.#apiRequest({
      path: '/agreements',
      query,
      logTag: 'getAgreementsDictionary',
    })

    const agreements = result?.userAgreementList || []
    const term = (search || '').toLowerCase()

    const items = agreements
      .filter(agreement => !term || (agreement.name || '').toLowerCase().includes(term))
      .map(agreement => ({
        label: agreement.name || agreement.id,
        value: agreement.id,
        note: agreement.status || undefined,
      }))

    return { items, cursor: result?.page?.nextCursor || null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Groups Dictionary
   * @description Lists the account's groups for selection in dependent parameters. Each option shows the group name.
   * @route POST /get-groups-dictionary
   * @paramDef {"type":"getGroupsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Sales","value":"CBJCHBCAABAAUcc2NmO4kD","note":"Default group"}],"cursor":null}
   */
  async getGroupsDictionary(payload) {
    const { search, cursor } = payload || {}

    const query = { pageSize: 100 }

    if (cursor) query.cursor = cursor

    const result = await this.#apiRequest({
      path: '/groups',
      query,
      logTag: 'getGroupsDictionary',
    })

    const groups = result?.groupInfoList || []
    const term = (search || '').toLowerCase()

    const items = groups
      .filter(group => !term || (group.groupName || '').toLowerCase().includes(term))
      .map(group => ({
        label: group.groupName || group.groupId,
        value: group.groupId,
        note: group.isDefaultGroup ? 'Default group' : undefined,
      }))

    return { items, cursor: result?.page?.nextCursor || null }
  }

  // ==========================================================================
  //  HELPERS
  // ==========================================================================
  // Builds the AgreementCreationInfo body shared by Send Agreement (IN_PROCESS) and
  // Create Draft Agreement (DRAFT).
  #buildAgreementBody({ name, recipientEmails, transientDocumentId, templateId, recipientRole, message, ccEmails, expirationTime, reminderFrequency, externalId, participantSetsInfo, state }) {
    if (!name) throw new Error('Agreement Name is required.')

    if (!transientDocumentId && !templateId) {
      throw new Error('Provide a document: either a Transient Document ID (from Upload Transient Document) or a Library Template.')
    }

    if (transientDocumentId && templateId) {
      throw new Error('Provide only one document source: a Transient Document ID OR a Library Template, not both.')
    }

    const fileInfos = transientDocumentId
      ? [{ transientDocumentId }]
      : [{ libraryDocumentId: templateId }]

    // Advanced override wins; otherwise each recipient email becomes its own single-member
    // participant set, acting in the listed order (order 1 first).
    let participantSets = this.#parseJsonArray(participantSetsInfo)

    if (!participantSets || participantSets.length === 0) {
      const emails = this.#parseStringArray(recipientEmails)

      if (!emails || emails.length === 0) {
        throw new Error('Recipient Emails is required (or provide a raw Participant Sets Info override).')
      }

      const role = this.#resolveChoice(recipientRole, RECIPIENT_ROLE_MAP) || 'SIGNER'

      participantSets = emails.map((email, index) => ({
        memberInfos: [{ email }],
        order: index + 1,
        role,
      }))
    }

    const body = {
      fileInfos,
      name,
      participantSetsInfo: participantSets,
      signatureType: 'ESIGN',
      state,
    }

    if (message) body.message = message

    const ccs = this.#parseStringArray(ccEmails)

    if (ccs && ccs.length > 0) body.ccs = ccs.map(email => ({ email }))

    if (expirationTime) body.expirationTime = expirationTime

    const frequency = this.#resolveChoice(reminderFrequency, REMINDER_FREQUENCY_MAP)

    if (frequency) body.reminderFrequency = frequency

    if (externalId) body.externalId = { id: externalId }

    return body
  }

  // Normalizes an Array<String> param into a real array of trimmed, non-empty strings.
  // FlowRunner may hand these over as an array, a JSON string, or a comma-separated string.
  #parseStringArray(value) {
    if (value === undefined || value === null || value === '') return undefined

    let parsed = value

    if (typeof value === 'string') {
      const trimmed = value.trim()

      if (trimmed.startsWith('[')) {
        try {
          parsed = JSON.parse(trimmed)
        } catch (error) {
          throw new Error('Expected a JSON array of strings.')
        }
      } else {
        parsed = trimmed.split(',')
      }
    }

    if (!Array.isArray(parsed)) {
      throw new Error('Expected an array of strings.')
    }

    return parsed.map(item => String(item).trim()).filter(Boolean)
  }

  // Normalizes an Array<Object> param into a real array. FlowRunner may hand these over as a
  // parsed array or as a JSON string depending on the caller; both are accepted.
  #parseJsonArray(value) {
    if (value === undefined || value === null || value === '') return undefined

    let parsed = value

    if (typeof value === 'string') {
      try {
        parsed = JSON.parse(value)
      } catch (error) {
        throw new Error('Expected a JSON array of objects.')
      }
    }

    if (!Array.isArray(parsed)) {
      throw new Error('Expected a JSON array of objects.')
    }

    return parsed
  }

  // Parses the formData CSV into row objects keyed by header. Handles quoted fields with commas
  // and escaped quotes; returns null when the text does not look like parseable CSV so the caller
  // can still fall back to the raw text.
  #parseCsv(text) {
    try {
      const records = []
      let record = []
      let field = ''
      let inQuotes = false

      for (let i = 0; i < text.length; i++) {
        const char = text[i]

        if (inQuotes) {
          if (char === '"') {
            if (text[i + 1] === '"') {
              field += '"'
              i++
            } else {
              inQuotes = false
            }
          } else {
            field += char
          }
        } else if (char === '"') {
          inQuotes = true
        } else if (char === ',') {
          record.push(field)
          field = ''
        } else if (char === '\n' || char === '\r') {
          if (char === '\r' && text[i + 1] === '\n') i++

          record.push(field)
          field = ''
          records.push(record)
          record = []
        } else {
          field += char
        }
      }

      if (field !== '' || record.length > 0) {
        record.push(field)
        records.push(record)
      }

      const nonEmpty = records.filter(row => row.length > 1 || (row[0] || '').trim() !== '')

      if (nonEmpty.length < 2) return null

      const headers = nonEmpty[0]

      return nonEmpty.slice(1).map(row => {
        const rowObject = {}

        headers.forEach((header, index) => {
          rowObject[header] = row[index] !== undefined ? row[index] : null
        })

        return rowObject
      })
    } catch (error) {
      return null
    }
  }
}

Flowrunner.ServerCode.addService(AdobeAcrobatSign, [
  {
    name: 'clientId',
    displayName: 'Client ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'The Application ID of your Adobe Acrobat Sign OAuth app. Create one in the Acrobat Sign web app under Account > Acrobat Sign API > API Applications (Domain: CUSTOMER), then Configure OAuth for the app and enable the user_read, user_write, agreement_read, agreement_write, agreement_send, library_read, and widget_read scopes with the self modifier.',
  },
  {
    name: 'clientSecret',
    displayName: 'Client Secret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'The Client Secret of your Adobe Acrobat Sign OAuth app.',
  },
  {
    name: 'shard',
    displayName: 'Shard',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.CHOICE,
    options: SHARDS,
    defaultValue: DEFAULT_SHARD,
    required: true,
    shared: false,
    hint: 'The region shard your Adobe Acrobat Sign account lives on, visible in your account URL (e.g. secure.na1.adobesign.com => na1).',
  },
])
