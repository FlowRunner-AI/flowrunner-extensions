'use strict'

const crypto = require('crypto')

const AUTHORIZE_URL = 'https://www.canva.com/api/oauth/authorize'
const TOKEN_URL = 'https://api.canva.com/rest/v1/oauth/token'
const API_BASE_URL = 'https://api.canva.com/rest/v1'

// Full scope set for the integration. Note: a Canva integration starts in "preview" mode,
// where only members of the developer's Canva team can connect. Public availability requires
// Canva's integration review.
const SCOPES = [
  'asset:read',
  'asset:write',
  'design:content:read',
  'design:content:write',
  'design:meta:read',
  'brandtemplate:meta:read',
  'brandtemplate:content:read',
  'folder:read',
  'folder:write',
  'profile:read',
].join(' ')

const POLL_INTERVAL_MS = 3000
const POLL_TIMEOUT_MS = 280 * 1000

const OWNERSHIP_OPTIONS = {
  'Any': 'any',
  'Owned': 'owned',
  'Shared': 'shared',
}

const SORT_BY_OPTIONS = {
  'Relevance': 'relevance',
  'Modified (Newest First)': 'modified_descending',
  'Modified (Oldest First)': 'modified_ascending',
  'Title (A-Z)': 'title_ascending',
  'Title (Z-A)': 'title_descending',
}

const DESIGN_TYPE_OPTIONS = {
  'Presentation': 'presentation',
  'Whiteboard': 'whiteboard',
  'Doc': 'doc',
  'Custom': 'custom',
}

const EXPORT_FORMAT_OPTIONS = {
  'PDF': 'pdf',
  'PNG': 'png',
  'JPG': 'jpg',
  'PowerPoint (PPTX)': 'pptx',
  'GIF': 'gif',
  'Video (MP4)': 'mp4',
}

const EXPORT_QUALITY_OPTIONS = {
  'Regular': 'regular',
  'Pro': 'pro',
}

const PDF_SIZE_OPTIONS = {
  'A4': 'a4',
  'A3': 'a3',
  'Letter': 'letter',
  'Legal': 'legal',
}

const MP4_QUALITY_OPTIONS = {
  'Horizontal 480p': 'horizontal_480p',
  'Horizontal 720p': 'horizontal_720p',
  'Horizontal 1080p': 'horizontal_1080p',
  'Horizontal 4K': 'horizontal_4k',
  'Vertical 480p': 'vertical_480p',
  'Vertical 720p': 'vertical_720p',
  'Vertical 1080p': 'vertical_1080p',
  'Vertical 4K': 'vertical_4k',
}

const FOLDER_ITEM_TYPE_OPTIONS = {
  'Design': 'design',
  'Folder': 'folder',
  'Image': 'image',
}

const logger = {
  info: (...args) => console.log('[Canva] info:', ...args),
  debug: (...args) => console.log('[Canva] debug:', ...args),
  error: (...args) => console.log('[Canva] error:', ...args),
  warn: (...args) => console.log('[Canva] warn:', ...args),
}

/**
 * @requireOAuth
 * @usesFileStorage
 * @integrationName Canva
 * @integrationIcon /icon.png
 **/
class CanvaService {
  constructor(config) {
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
  }

  #accessToken() {
    return this.request.headers['oauth-access-token']
  }

  async #apiRequest({ url, method = 'get', body, query, headers, logTag }) {
    if (query) {
      query = cleanupObject(query)
    }

    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=[${ JSON.stringify(query) }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Authorization': `Bearer ${ this.#accessToken() }`,
          'Content-Type': 'application/json',
          ...(headers || {}),
        })
        .query(query || {})

      const response = body !== undefined ? await request.send(body) : await request

      // Canva delete/move endpoints return 204 No Content with an empty body.
      // Normalize those to a consistent success object.
      return isEmptyResponse(response) ? { status: 'success' } : response
    } catch (error) {
      const message = this.#extractError(error)

      logger.error(`${ logTag } - failed: ${ message }`)

      throw new Error(`Canva API error: ${ message }`)
    }
  }

  // Canva Connect errors are shaped as { code, message }; the OAuth token endpoint
  // uses { error, error_description }.
  #extractError(error) {
    const body = error.body

    if (body) {
      if (body.message) {
        return body.code ? `${ body.message } [${ body.code }]` : body.message
      }

      if (body.error_description) {
        return body.error_description
      }

      if (typeof body.error === 'string') {
        return body.error
      }
    }

    return error.message
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  #toBuffer(bytes) {
    return Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
  }

  // ============================================= OAUTH ================================================

  // Canva mandates PKCE for every authorization request. This runtime shares no state between
  // the connection-URL generation and the OAuth callback, so the code verifier is derived
  // DETERMINISTICALLY from the app credentials: both methods can compute the exact same value
  // independently. The result is a 43-character base64url string — a valid PKCE verifier.
  #codeVerifier() {
    return crypto.createHash('sha256').update(`${ this.clientSecret }::${ this.clientId }`).digest('base64url')
  }

  #codeChallenge() {
    return crypto.createHash('sha256').update(this.#codeVerifier()).digest('base64url')
  }

  #basicAuthHeader() {
    const encoded = Buffer.from(`${ this.clientId }:${ this.clientSecret }`).toString('base64')

    return {
      'Authorization': `Basic ${ encoded }`,
      'Content-Type': 'application/x-www-form-urlencoded',
    }
  }

  /**
   * @registerAs SYSTEM
   * @route GET /getOAuth2ConnectionURL
   * @returns {String}
   */
  async getOAuth2ConnectionURL() {
    const params = new URLSearchParams()

    params.append('code_challenge', this.#codeChallenge())
    params.append('code_challenge_method', 's256')
    params.append('response_type', 'code')
    params.append('client_id', this.clientId)
    params.append('state', `flowrunner_${ Date.now() }`)

    // Scopes are appended manually so spaces are encoded as %20, matching Canva's documented URLs.
    const connectionURL = `${ AUTHORIZE_URL }?${ params.toString() }&scope=${ encodeURIComponent(SCOPES) }`

    logger.debug(`composed connectionURL: ${ connectionURL }`)

    return connectionURL
  }

  /**
   * @typedef {Object} executeCallback_ResultObject
   *
   * @property {String} token
   * @property {String} [refreshToken]
   * @property {Number} [expirationInSeconds]
   * @property {Object} [userData]
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
    const params = new URLSearchParams()

    params.append('grant_type', 'authorization_code')
    params.append('code', callbackObject.code)
    params.append('code_verifier', this.#codeVerifier())
    params.append('redirect_uri', callbackObject.redirectURI)

    const tokenResponse = await Flowrunner.Request.post(TOKEN_URL)
      .set(this.#basicAuthHeader())
      .send(params.toString())

    let userData = {}
    let connectionIdentityName = 'Canva Account'

    try {
      const authHeader = { 'Authorization': `Bearer ${ tokenResponse.access_token }` }

      const profileResponse = await Flowrunner.Request.get(`${ API_BASE_URL }/users/me/profile`).set(authHeader)
      const meResponse = await Flowrunner.Request.get(`${ API_BASE_URL }/users/me`).set(authHeader)

      userData = {
        display_name: profileResponse?.profile?.display_name,
        ...(meResponse?.team_user || {}),
      }

      connectionIdentityName = userData.display_name || userData.user_id || connectionIdentityName
    } catch (error) {
      logger.error(`[executeCallback] identity lookup error: ${ error.message }`)
    }

    return {
      token: tokenResponse.access_token,
      expirationInSeconds: tokenResponse.expires_in,
      refreshToken: tokenResponse.refresh_token,
      connectionIdentityName,
      connectionIdentityImageURL: null,
      overwrite: true,
      userData,
    }
  }

  /**
   * @typedef {Object} refreshToken_ResultObject
   *
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
    try {
      const params = new URLSearchParams()

      params.append('grant_type', 'refresh_token')
      params.append('refresh_token', refreshToken)

      const { access_token, expires_in, refresh_token } = await Flowrunner.Request.post(TOKEN_URL)
        .set(this.#basicAuthHeader())
        .send(params.toString())

      return {
        token: access_token,
        expirationInSeconds: expires_in,
        // Canva rotates refresh tokens: each one is single-use, so the newly issued one MUST be stored.
        refreshToken: refresh_token || refreshToken,
      }
    } catch (error) {
      logger.error(`refreshToken error: ${ error.message }`)

      if (error.body?.error === 'invalid_grant') {
        throw new Error('Refresh token expired or invalid, please re-authenticate.')
      }

      throw error
    }
  }

  // ========================================== JOB POLLING ===========================================

  // Polls an asynchronous Canva job (export, asset upload, autofill) until it reaches a terminal
  // status. Returns the completed job on success and throws a descriptive error on failure/timeout.
  async #pollJobUntilDone({ fetchJob, jobKind }) {
    const startedAt = Date.now()

    for (;;) {
      const response = await fetchJob()
      const job = response?.job

      if (!job) {
        throw new Error(`Canva API error: unexpected ${ jobKind } job response shape`)
      }

      if (job.status === 'success') {
        return job
      }

      if (job.status === 'failed') {
        const message = job.error?.message || job.error?.code || 'unknown error'

        throw new Error(`Canva ${ jobKind } job ${ job.id } failed: ${ message }`)
      }

      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        throw new Error(
          `Canva ${ jobKind } job ${ job.id } did not finish within the polling window (status: ${ job.status }). ` +
          'Use the matching "Get Job" action to keep checking it.'
        )
      }

      logger.debug(`${ jobKind } job ${ job.id } status ${ job.status }, waiting...`)

      await sleep(POLL_INTERVAL_MS)
    }
  }

  // ========================================== DICTIONARIES ===========================================

  /**
   * @typedef {Object} DictionaryItem
   * @property {String} label
   * @property {any} value
   * @property {String} note
   */

  /**
   * @typedef {Object} DictionaryResponse
   * @property {Array<DictionaryItem>} items
   * @property {String} cursor
   */

  /**
   * @typedef {Object} getDesignsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to match against design titles (passed to Canva's design search)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Continuation token from a previous response, used to retrieve the next page of designs."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Designs Dictionary
   * @description Lists the connected user's Canva designs for selection in dependent parameters. Returns the design title as the label and the design id as the value.
   * @route POST /get-designs-dictionary
   * @paramDef {"type":"getDesignsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Q3 Marketing Deck","value":"DAFVztcvd9z","note":"5 pages"}],"cursor":"RkFGMgXlsVTDbMd"}
   */
  async getDesignsDictionary(payload) {
    const { search, cursor } = payload || {}

    const response = await this.#apiRequest({
      logTag: 'getDesignsDictionary',
      url: `${ API_BASE_URL }/designs`,
      query: { query: search, continuation: cursor },
    })

    const items = Array.isArray(response.items) ? response.items : []

    return {
      cursor: response.continuation || undefined,
      items: items.map(design => ({
        label: design.title || 'Untitled design',
        value: design.id,
        note: design.page_count ? `${ design.page_count } page${ design.page_count === 1 ? '' : 's' }` : '',
      })),
    }
  }

  /**
   * @typedef {Object} getFoldersDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter folders by name. Filtering is applied locally to the current page."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Continuation token from a previous response, used to retrieve the next page of folders."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Folders Dictionary
   * @description Lists the folders at the top level of the connected user's Canva projects for selection in dependent parameters. The first page includes a synthetic "Root (Projects)" entry with the value "root".
   * @route POST /get-folders-dictionary
   * @paramDef {"type":"getFoldersDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Root (Projects)","value":"root","note":"Top level"},{"label":"Brand Assets","value":"FAF2lZtloor","note":"Folder"}],"cursor":"eyJvIjoxfQ"}
   */
  async getFoldersDictionary(payload) {
    const { search, cursor } = payload || {}

    const response = await this.#apiRequest({
      logTag: 'getFoldersDictionary',
      url: `${ API_BASE_URL }/folders/root/items`,
      query: { item_types: 'folder', continuation: cursor },
    })

    const rawItems = Array.isArray(response.items) ? response.items : []

    const folders = rawItems
      .map(item => item.folder)
      .filter(Boolean)

    const filtered = search
      ? folders.filter(folder => folder.name && folder.name.toLowerCase().includes(search.toLowerCase()))
      : folders

    const items = filtered.map(folder => ({
      label: folder.name,
      value: folder.id,
      note: 'Folder',
    }))

    // Offer the projects root as an explicit choice on the first page.
    if (!cursor && (!search || 'root (projects)'.includes(search.toLowerCase()))) {
      items.unshift({ label: 'Root (Projects)', value: 'root', note: 'Top level' })
    }

    return {
      cursor: response.continuation || undefined,
      items,
    }
  }

  /**
   * @typedef {Object} getBrandTemplatesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to match against brand template titles (passed to Canva's brand template search)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Continuation token from a previous response, used to retrieve the next page of brand templates."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Brand Templates Dictionary
   * @description Lists the brand templates available to the connected user (Canva Enterprise only) for selection in dependent parameters. Returns the template title as the label and the template id as the value.
   * @route POST /get-brand-templates-dictionary
   * @paramDef {"type":"getBrandTemplatesDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Advertisement Template","value":"DEMzWSwy3BI","note":"Brand template"}],"cursor":"RkFGMgXlsVTDbMd"}
   */
  async getBrandTemplatesDictionary(payload) {
    const { search, cursor } = payload || {}

    const response = await this.#apiRequest({
      logTag: 'getBrandTemplatesDictionary',
      url: `${ API_BASE_URL }/brand-templates`,
      query: { query: search, continuation: cursor },
    })

    const items = Array.isArray(response.items) ? response.items : []

    return {
      cursor: response.continuation || undefined,
      items: items.map(template => ({
        label: template.title || 'Untitled template',
        value: template.id,
        note: 'Brand template',
      })),
    }
  }

  // ============================================= DESIGNS =============================================

  /**
   * @description Lists the Canva designs available to the connected user, optionally filtered by a search term and ownership, and sorted by relevance, modification date, or title. Results are paginated with a continuation token: pass the returned "continuation" value back to retrieve the next page. Each design includes its id, title, thumbnail, page count, owner, and edit/view URLs.
   *
   * @route GET /list-designs
   * @operationName List Designs
   * @category Designs
   *
   * @paramDef {"type":"String","label":"Search Query","name":"query","description":"Optional text to search design titles for (e.g. 'logo')."}
   * @paramDef {"type":"String","label":"Ownership","name":"ownership","defaultValue":"Any","uiComponent":{"type":"DROPDOWN","options":{"values":["Any","Owned","Shared"]}},"description":"Filter by ownership: 'Owned' returns only designs the user owns, 'Shared' only designs shared with them, 'Any' (default) returns both."}
   * @paramDef {"type":"String","label":"Sort By","name":"sortBy","defaultValue":"Relevance","uiComponent":{"type":"DROPDOWN","options":{"values":["Relevance","Modified (Newest First)","Modified (Oldest First)","Title (A-Z)","Title (Z-A)"]}},"description":"Sort order for the results. Default: 'Relevance'."}
   * @paramDef {"type":"String","label":"Continuation","name":"continuation","description":"Continuation token from a previous response, used to retrieve the next page of results."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"DAFVztcvd9z","title":"Q3 Marketing Deck","design_type":{"type":"preset","name":"presentation"},"owner":{"user_id":"auDAbliZ2rQNNOsUl5OLu","team_id":"Oi2RJILTrKk0KRhRUZozX"},"thumbnail":{"width":595,"height":335,"url":"https://document-export.canva.com/thumb.png"},"urls":{"edit_url":"https://www.canva.com/api/design/edit","view_url":"https://www.canva.com/api/design/view"},"page_count":5,"created_at":1377396000,"updated_at":1692928800}],"continuation":"RkFGMgXlsVTDbMd"}
   */
  async listDesigns(query, ownership, sortBy, continuation) {
    return this.#apiRequest({
      logTag: 'listDesigns',
      url: `${ API_BASE_URL }/designs`,
      query: {
        query,
        ownership: this.#resolveChoice(ownership, OWNERSHIP_OPTIONS),
        sort_by: this.#resolveChoice(sortBy, SORT_BY_OPTIONS),
        continuation,
      },
    })
  }

  /**
   * @description Retrieves the metadata of a single Canva design by its id, including title, design type, owner, thumbnail, page count, timestamps, and edit/view URLs. Design contents cannot be read directly through the Connect API — use Export Design to obtain the design as a file.
   *
   * @route GET /get-design
   * @operationName Get Design
   * @category Designs
   *
   * @paramDef {"type":"String","label":"Design","name":"designId","required":true,"dictionary":"getDesignsDictionary","description":"The design to retrieve. Select one of your designs or enter a design id directly (e.g. 'DAFVztcvd9z')."}
   *
   * @returns {Object}
   * @sampleResult {"design":{"id":"DAFVztcvd9z","title":"Q3 Marketing Deck","design_type":{"type":"preset","name":"presentation"},"owner":{"user_id":"auDAbliZ2rQNNOsUl5OLu","team_id":"Oi2RJILTrKk0KRhRUZozX"},"thumbnail":{"width":595,"height":335,"url":"https://document-export.canva.com/thumb.png"},"urls":{"edit_url":"https://www.canva.com/api/design/edit","view_url":"https://www.canva.com/api/design/view"},"page_count":5,"created_at":1377396000,"updated_at":1692928800}}
   */
  async getDesign(designId) {
    if (!designId) {
      throw new Error('"Design" is required')
    }

    return this.#apiRequest({
      logTag: 'getDesign',
      url: `${ API_BASE_URL }/designs/${ encodeURIComponent(designId) }`,
    })
  }

  /**
   * @description Creates a new Canva design from a preset type (Presentation, Whiteboard, or Doc) or with Custom pixel dimensions. Optionally seeds the design with a previously uploaded asset (e.g. an image) and sets a title. Returns the new design's metadata including its id and an edit URL the user can open in Canva. Requires the 'design:content:write' scope.
   *
   * @route POST /create-design
   * @operationName Create Design
   * @category Designs
   *
   * @paramDef {"type":"String","label":"Design Type","name":"designType","required":true,"defaultValue":"Presentation","uiComponent":{"type":"DROPDOWN","options":{"values":["Presentation","Whiteboard","Doc","Custom"]}},"description":"The type of design to create. Choose 'Custom' to specify exact pixel dimensions with the Width and Height parameters."}
   * @paramDef {"type":"Number","label":"Width","name":"width","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Design width in pixels (40-8000). Required when Design Type is 'Custom'; ignored otherwise."}
   * @paramDef {"type":"Number","label":"Height","name":"height","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Design height in pixels (40-8000). Required when Design Type is 'Custom'; ignored otherwise."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"Optional title for the new design (maximum 255 characters)."}
   * @paramDef {"type":"String","label":"Asset ID","name":"assetId","description":"Optional id of a previously uploaded asset to insert into the new design (e.g. from Upload Asset and Wait)."}
   *
   * @returns {Object}
   * @sampleResult {"design":{"id":"DAFVztcvd9z","title":"My New Presentation","design_type":{"type":"preset","name":"presentation"},"urls":{"edit_url":"https://www.canva.com/api/design/edit","view_url":"https://www.canva.com/api/design/view"},"page_count":1,"created_at":1692928800,"updated_at":1692928800}}
   */
  async createDesign(designType, width, height, title, assetId) {
    const type = this.#resolveChoice(designType, DESIGN_TYPE_OPTIONS)

    if (!type) {
      throw new Error('"Design Type" is required')
    }

    const body = {}

    if (type === 'custom') {
      if (!width || !height) {
        throw new Error('"Width" and "Height" are required when Design Type is "Custom"')
      }

      body.design_type = { type: 'custom', width, height }
    } else {
      body.design_type = { type: 'preset', name: type }
    }

    if (title !== undefined && title !== null && title !== '') {
      body.title = title
    }

    if (assetId) {
      body.asset_id = assetId
    }

    return this.#apiRequest({
      logTag: 'createDesign',
      method: 'post',
      url: `${ API_BASE_URL }/designs`,
      body,
    })
  }

  // ============================================= EXPORTS =============================================

  #buildExportFormat(format, { exportQuality, pdfSize, jpgQuality, mp4Quality, width, height, pages, transparentBackground }) {
    const type = this.#resolveChoice(format, EXPORT_FORMAT_OPTIONS)

    if (!type) {
      throw new Error('"Format" is required')
    }

    const result = { type }
    const quality = this.#resolveChoice(exportQuality, EXPORT_QUALITY_OPTIONS)

    // export_quality applies to every format except pptx.
    if (quality && type !== 'pptx') {
      result.export_quality = quality
    }

    if (Array.isArray(pages) && pages.length) {
      result.pages = pages.map(Number)
    }

    if (type === 'pdf' && pdfSize) {
      result.size = this.#resolveChoice(pdfSize, PDF_SIZE_OPTIONS)
    }

    if (type === 'jpg') {
      // "quality" (1-100) is mandatory for JPG exports.
      result.quality = jpgQuality || 90
    }

    if (type === 'mp4') {
      // A resolution "quality" is mandatory for MP4 exports.
      result.quality = this.#resolveChoice(mp4Quality, MP4_QUALITY_OPTIONS) || 'horizontal_1080p'
    }

    if (['png', 'jpg', 'gif'].includes(type)) {
      if (width) {
        result.width = width
      }

      if (height) {
        result.height = height
      }
    }

    if (type === 'png' && transparentBackground !== undefined && transparentBackground !== null) {
      result.transparent_background = transparentBackground
    }

    return result
  }

  /**
   * @description Starts an asynchronous job that exports a Canva design as a file (PDF, PNG, JPG, PPTX, GIF, or MP4). Returns immediately with a job id and 'in_progress' status — poll it with Get Export Job, or use Export Design and Wait to do the polling and file storage automatically. 'Pro' export quality and premium-element exports may require a Canva subscription. Requires the 'design:content:read' scope.
   *
   * @route POST /export-design
   * @operationName Export Design
   * @category Exports
   *
   * @paramDef {"type":"String","label":"Design","name":"designId","required":true,"dictionary":"getDesignsDictionary","description":"The design to export. Select one of your designs or enter a design id directly."}
   * @paramDef {"type":"String","label":"Format","name":"format","required":true,"defaultValue":"PDF","uiComponent":{"type":"DROPDOWN","options":{"values":["PDF","PNG","JPG","PowerPoint (PPTX)","GIF","Video (MP4)"]}},"description":"The file format to export the design to."}
   * @paramDef {"type":"String","label":"Export Quality","name":"exportQuality","uiComponent":{"type":"DROPDOWN","options":{"values":["Regular","Pro"]}},"description":"Export quality tier. 'Pro' produces premium quality but may require a Canva Pro subscription. Default: 'Regular'. Not applicable to PPTX."}
   * @paramDef {"type":"String","label":"PDF Size","name":"pdfSize","uiComponent":{"type":"DROPDOWN","options":{"values":["A4","A3","Letter","Legal"]}},"description":"Paper size for PDF exports. Default: 'A4'. Ignored for other formats."}
   * @paramDef {"type":"Number","label":"JPG Quality","name":"jpgQuality","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Compression quality for JPG exports, from 1 (smallest file) to 100 (best quality). Default: 90. Ignored for other formats."}
   * @paramDef {"type":"String","label":"MP4 Quality","name":"mp4Quality","uiComponent":{"type":"DROPDOWN","options":{"values":["Horizontal 480p","Horizontal 720p","Horizontal 1080p","Horizontal 4K","Vertical 480p","Vertical 720p","Vertical 1080p","Vertical 4K"]}},"description":"Video resolution for MP4 exports. Default: 'Horizontal 1080p'. Ignored for other formats."}
   * @paramDef {"type":"Number","label":"Width","name":"width","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Output width in pixels (40-25000) for PNG, JPG, and GIF exports. When omitted, the design's own dimensions are used."}
   * @paramDef {"type":"Number","label":"Height","name":"height","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Output height in pixels (40-25000) for PNG, JPG, and GIF exports. When omitted, the design's own dimensions are used."}
   * @paramDef {"type":"Array<Number>","label":"Pages","name":"pages","description":"Optional page numbers to export (e.g. [1,3]). When omitted, all pages are exported. Multi-page image exports produce one file per page."}
   * @paramDef {"type":"Boolean","label":"Transparent Background","name":"transparentBackground","uiComponent":{"type":"CHECKBOX"},"description":"Export PNGs with a transparent background (requires a Canva subscription that supports it). PNG only. Default: false."}
   *
   * @returns {Object}
   * @sampleResult {"job":{"id":"e08861ae-3b29-45db-8dc1-1fe0bf7f1cc8","status":"in_progress"}}
   */
  async exportDesign(designId, format, exportQuality, pdfSize, jpgQuality, mp4Quality, width, height, pages, transparentBackground) {
    if (!designId) {
      throw new Error('"Design" is required')
    }

    const body = {
      design_id: designId,
      format: this.#buildExportFormat(format, {
        exportQuality, pdfSize, jpgQuality, mp4Quality, width, height, pages, transparentBackground,
      }),
    }

    return this.#apiRequest({
      logTag: 'exportDesign',
      method: 'post',
      url: `${ API_BASE_URL }/exports`,
      body,
    })
  }

  /**
   * @description Retrieves the status and result of a design export job started with Export Design. While running, the status is 'in_progress'; on 'success' the job contains download URLs for the exported files (the URLs expire after 24 hours); on 'failed' it contains an error code and message.
   *
   * @route GET /get-export-job
   * @operationName Get Export Job
   * @category Exports
   *
   * @paramDef {"type":"String","label":"Export Job ID","name":"exportId","required":true,"description":"The id of the export job, as returned by Export Design."}
   *
   * @returns {Object}
   * @sampleResult {"job":{"id":"e08861ae-3b29-45db-8dc1-1fe0bf7f1cc8","status":"success","urls":["https://export-download.canva.com/file1.pdf"]}}
   */
  async getExportJob(exportId) {
    if (!exportId) {
      throw new Error('"Export Job ID" is required')
    }

    return this.#apiRequest({
      logTag: 'getExportJob',
      url: `${ API_BASE_URL }/exports/${ encodeURIComponent(exportId) }`,
    })
  }

  /**
   * @description Exports a Canva design and waits for the result in a single action: starts the export job, polls it every 3 seconds until it completes (up to about 5 minutes), then downloads each exported file and saves it to FlowRunner file storage. Returns the completed job plus durable FlowRunner file URLs (Canva's own download URLs expire after 24 hours). Fails with a descriptive error if the export job fails or does not finish in time.
   *
   * @route POST /export-design-and-wait
   * @operationName Export Design and Wait
   * @category Exports
   * @executionTimeoutInSeconds 300
   *
   * @paramDef {"type":"String","label":"Design","name":"designId","required":true,"dictionary":"getDesignsDictionary","description":"The design to export. Select one of your designs or enter a design id directly."}
   * @paramDef {"type":"String","label":"Format","name":"format","required":true,"defaultValue":"PDF","uiComponent":{"type":"DROPDOWN","options":{"values":["PDF","PNG","JPG","PowerPoint (PPTX)","GIF","Video (MP4)"]}},"description":"The file format to export the design to."}
   * @paramDef {"type":"String","label":"Export Quality","name":"exportQuality","uiComponent":{"type":"DROPDOWN","options":{"values":["Regular","Pro"]}},"description":"Export quality tier. 'Pro' produces premium quality but may require a Canva Pro subscription. Default: 'Regular'. Not applicable to PPTX."}
   * @paramDef {"type":"String","label":"PDF Size","name":"pdfSize","uiComponent":{"type":"DROPDOWN","options":{"values":["A4","A3","Letter","Legal"]}},"description":"Paper size for PDF exports. Default: 'A4'. Ignored for other formats."}
   * @paramDef {"type":"Number","label":"JPG Quality","name":"jpgQuality","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Compression quality for JPG exports, from 1 (smallest file) to 100 (best quality). Default: 90. Ignored for other formats."}
   * @paramDef {"type":"String","label":"MP4 Quality","name":"mp4Quality","uiComponent":{"type":"DROPDOWN","options":{"values":["Horizontal 480p","Horizontal 720p","Horizontal 1080p","Horizontal 4K","Vertical 480p","Vertical 720p","Vertical 1080p","Vertical 4K"]}},"description":"Video resolution for MP4 exports. Default: 'Horizontal 1080p'. Ignored for other formats."}
   * @paramDef {"type":"Number","label":"Width","name":"width","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Output width in pixels (40-25000) for PNG, JPG, and GIF exports. When omitted, the design's own dimensions are used."}
   * @paramDef {"type":"Number","label":"Height","name":"height","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Output height in pixels (40-25000) for PNG, JPG, and GIF exports. When omitted, the design's own dimensions are used."}
   * @paramDef {"type":"Array<Number>","label":"Pages","name":"pages","description":"Optional page numbers to export (e.g. [1,3]). When omitted, all pages are exported. Multi-page image exports produce one file per page."}
   * @paramDef {"type":"Boolean","label":"Transparent Background","name":"transparentBackground","uiComponent":{"type":"CHECKBOX"},"description":"Export PNGs with a transparent background (requires a Canva subscription that supports it). PNG only. Default: false."}
   * @paramDef {"type":"FilesUploadOptions","label":"File Settings","name":"fileOptions","required":false,"include":["scope"],"description":"Where to store the exported files in FlowRunner file storage. Default scope: FLOW."}
   *
   * @returns {Object}
   * @sampleResult {"job":{"id":"e08861ae-3b29-45db-8dc1-1fe0bf7f1cc8","status":"success","urls":["https://export-download.canva.com/file1.pdf"]},"files":["https://api.flowrunner.pro/files/flow/canva_DAFVztcvd9z_1.pdf"]}
   */
  async exportDesignAndWait(designId, format, exportQuality, pdfSize, jpgQuality, mp4Quality, width, height, pages, transparentBackground, fileOptions) {
    const started = await this.exportDesign(
      designId, format, exportQuality, pdfSize, jpgQuality, mp4Quality, width, height, pages, transparentBackground
    )

    const job = await this.#pollJobUntilDone({
      jobKind: 'export',
      fetchJob: () => this.getExportJob(started.job.id),
    })

    const extension = this.#resolveChoice(format, EXPORT_FORMAT_OPTIONS)
    const urls = Array.isArray(job.urls) ? job.urls : []
    const files = []

    for (let i = 0; i < urls.length; i++) {
      const bytes = await Flowrunner.Request.get(urls[i]).setEncoding(null)
      const buffer = this.#toBuffer(bytes)

      const { url } = await this.flowrunner.Files.uploadFile(buffer, {
        filename: `canva_${ designId }_${ i + 1 }.${ extension }`,
        generateUrl: true,
        overwrite: true,
        ...(fileOptions || { scope: 'FLOW' }),
      })

      logger.debug(`exportDesignAndWait - saved file ${ i + 1 }/${ urls.length } (${ buffer.length } bytes)`)

      files.push(url)
    }

    return { job, files }
  }

  // ============================================= ASSETS ==============================================

  async #startAssetUpload(fileUrl, assetName, logTag) {
    if (!fileUrl) {
      throw new Error('"File" is required')
    }

    const fallbackName = decodeURIComponent(String(fileUrl).split('/').pop().split('?')[0]) || 'upload'
    // Canva limits asset names to 50 characters.
    const resolvedName = String(assetName || fallbackName).slice(0, 50)

    const bytes = await Flowrunner.Request.get(fileUrl).setEncoding(null)
    const buffer = this.#toBuffer(bytes)

    logger.debug(`${ logTag } - uploading ${ buffer.length } bytes as "${ resolvedName }"`)

    try {
      return await Flowrunner.Request.post(`${ API_BASE_URL }/asset-uploads`)
        .set({
          'Authorization': `Bearer ${ this.#accessToken() }`,
          'Content-Type': 'application/octet-stream',
          'Asset-Upload-Metadata': JSON.stringify({ name_base64: Buffer.from(resolvedName).toString('base64') }),
        })
        .send(buffer)
    } catch (error) {
      const message = this.#extractError(error)

      logger.error(`${ logTag } - failed: ${ message }`)

      throw new Error(`Canva API error: ${ message }`)
    }
  }

  /**
   * @description Starts an asynchronous job that uploads a file from FlowRunner file storage to the connected user's Canva media library as an asset (image, video, or audio). Returns immediately with a job id — poll it with Get Asset Upload Job, or use Upload Asset and Wait to do the polling automatically. The resulting asset id can be used in Create Design or Autofill Design. Requires the 'asset:write' scope.
   *
   * @route POST /upload-asset
   * @operationName Upload Asset
   * @category Assets
   *
   * @paramDef {"type":"String","label":"File","name":"fileUrl","required":true,"uiComponent":{"type":"FILE_SELECTOR"},"description":"The FlowRunner file to upload to Canva (its URL). The file's bytes are sent to Canva as-is."}
   * @paramDef {"type":"String","label":"Asset Name","name":"assetName","description":"Optional name for the asset in Canva (maximum 50 characters). Defaults to the source file name."}
   *
   * @returns {Object}
   * @sampleResult {"job":{"id":"e08861ae-3b29-45db-8dc1-1fe0bf7f1cc8","status":"in_progress"}}
   */
  async uploadAsset(fileUrl, assetName) {
    return this.#startAssetUpload(fileUrl, assetName, 'uploadAsset')
  }

  /**
   * @description Retrieves the status and result of an asset upload job started with Upload Asset. While running, the status is 'in_progress'; on 'success' the job contains the created asset (id, name, tags, thumbnail); on 'failed' it contains an error code and message.
   *
   * @route GET /get-asset-upload-job
   * @operationName Get Asset Upload Job
   * @category Assets
   *
   * @paramDef {"type":"String","label":"Upload Job ID","name":"jobId","required":true,"description":"The id of the asset upload job, as returned by Upload Asset."}
   *
   * @returns {Object}
   * @sampleResult {"job":{"id":"e08861ae-3b29-45db-8dc1-1fe0bf7f1cc8","status":"success","asset":{"id":"Msd59349ff","name":"My Awesome Upload","tags":["image","holiday"],"created_at":1377396000,"updated_at":1692928800,"thumbnail":{"width":595,"height":335,"url":"https://document-export.canva.com/thumb.png"}}}}
   */
  async getAssetUploadJob(jobId) {
    if (!jobId) {
      throw new Error('"Upload Job ID" is required')
    }

    return this.#apiRequest({
      logTag: 'getAssetUploadJob',
      url: `${ API_BASE_URL }/asset-uploads/${ encodeURIComponent(jobId) }`,
    })
  }

  /**
   * @description Uploads a file from FlowRunner file storage to Canva and waits for processing to finish in a single action: starts the upload job, then polls it every 3 seconds until it completes (up to about 5 minutes). Returns the completed job including the created asset and its id, ready to use in Create Design or Autofill Design. Fails with a descriptive error if the upload job fails or does not finish in time. Requires the 'asset:write' scope.
   *
   * @route POST /upload-asset-and-wait
   * @operationName Upload Asset and Wait
   * @category Assets
   * @executionTimeoutInSeconds 300
   *
   * @paramDef {"type":"String","label":"File","name":"fileUrl","required":true,"uiComponent":{"type":"FILE_SELECTOR"},"description":"The FlowRunner file to upload to Canva (its URL). The file's bytes are sent to Canva as-is."}
   * @paramDef {"type":"String","label":"Asset Name","name":"assetName","description":"Optional name for the asset in Canva (maximum 50 characters). Defaults to the source file name."}
   *
   * @returns {Object}
   * @sampleResult {"job":{"id":"e08861ae-3b29-45db-8dc1-1fe0bf7f1cc8","status":"success","asset":{"id":"Msd59349ff","name":"My Awesome Upload","tags":["image","holiday"],"created_at":1377396000,"updated_at":1692928800,"thumbnail":{"width":595,"height":335,"url":"https://document-export.canva.com/thumb.png"}}}}
   */
  async uploadAssetAndWait(fileUrl, assetName) {
    const started = await this.#startAssetUpload(fileUrl, assetName, 'uploadAssetAndWait')

    const job = await this.#pollJobUntilDone({
      jobKind: 'asset upload',
      fetchJob: () => this.getAssetUploadJob(started.job.id),
    })

    return { job }
  }

  /**
   * @description Retrieves the metadata of a single asset in the connected user's Canva media library: name, tags, timestamps, and thumbnail. Requires the 'asset:read' scope.
   *
   * @route GET /get-asset
   * @operationName Get Asset
   * @category Assets
   *
   * @paramDef {"type":"String","label":"Asset ID","name":"assetId","required":true,"description":"The id of the asset to retrieve (e.g. 'Msd59349ff')."}
   *
   * @returns {Object}
   * @sampleResult {"asset":{"id":"Msd59349ff","name":"My Awesome Upload","tags":["image","holiday"],"created_at":1377396000,"updated_at":1692928800,"thumbnail":{"width":595,"height":335,"url":"https://document-export.canva.com/thumb.png"}}}
   */
  async getAsset(assetId) {
    if (!assetId) {
      throw new Error('"Asset ID" is required')
    }

    return this.#apiRequest({
      logTag: 'getAsset',
      url: `${ API_BASE_URL }/assets/${ encodeURIComponent(assetId) }`,
    })
  }

  /**
   * @description Updates the name and/or tags of an asset in the connected user's Canva media library. Only provided fields are changed, but note that providing Tags replaces the asset's entire tag list. Returns the updated asset. Requires the 'asset:write' scope.
   *
   * @route PATCH /update-asset
   * @operationName Update Asset
   * @category Assets
   *
   * @paramDef {"type":"String","label":"Asset ID","name":"assetId","required":true,"description":"The id of the asset to update (e.g. 'Msd59349ff')."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"Optional new name for the asset (maximum 50 characters)."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","description":"Optional new tag list for the asset. Replaces all existing tags. Maximum 50 tags."}
   *
   * @returns {Object}
   * @sampleResult {"asset":{"id":"Msd59349ff","name":"Renamed Upload","tags":["campaign","2026"],"created_at":1377396000,"updated_at":1692928800,"thumbnail":{"width":595,"height":335,"url":"https://document-export.canva.com/thumb.png"}}}
   */
  async updateAsset(assetId, name, tags) {
    if (!assetId) {
      throw new Error('"Asset ID" is required')
    }

    const body = {}

    if (name !== undefined && name !== null && name !== '') {
      body.name = name
    }

    if (Array.isArray(tags)) {
      body.tags = tags
    }

    if (!Object.keys(body).length) {
      throw new Error('At least one of "Name" or "Tags" is required')
    }

    return this.#apiRequest({
      logTag: 'updateAsset',
      method: 'patch',
      url: `${ API_BASE_URL }/assets/${ encodeURIComponent(assetId) }`,
      body,
    })
  }

  /**
   * @description Permanently deletes an asset from the connected user's Canva media library (it is moved to the user's trash). Designs that already use the asset are not affected. Returns a success status. Requires the 'asset:write' scope.
   *
   * @route DELETE /delete-asset
   * @operationName Delete Asset
   * @category Assets
   *
   * @paramDef {"type":"String","label":"Asset ID","name":"assetId","required":true,"description":"The id of the asset to delete (e.g. 'Msd59349ff')."}
   *
   * @returns {Object}
   * @sampleResult {"status":"success"}
   */
  async deleteAsset(assetId) {
    if (!assetId) {
      throw new Error('"Asset ID" is required')
    }

    return this.#apiRequest({
      logTag: 'deleteAsset',
      method: 'delete',
      url: `${ API_BASE_URL }/assets/${ encodeURIComponent(assetId) }`,
    })
  }

  // ============================================= FOLDERS =============================================

  /**
   * @description Creates a new folder in the connected user's Canva projects, either at the top level (parent 'root') or inside another folder. Returns the new folder's id, name, and timestamps. Requires the 'folder:write' scope.
   *
   * @route POST /create-folder
   * @operationName Create Folder
   * @category Folders
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The name for the new folder (maximum 255 characters)."}
   * @paramDef {"type":"String","label":"Parent Folder","name":"parentFolderId","defaultValue":"root","dictionary":"getFoldersDictionary","description":"The folder to create the new folder inside. Use 'root' (default) for the top level of the user's projects."}
   *
   * @returns {Object}
   * @sampleResult {"folder":{"id":"FAF2lZtloor","name":"Campaign Assets","created_at":1692928800,"updated_at":1692928800}}
   */
  async createFolder(name, parentFolderId) {
    if (!name) {
      throw new Error('"Name" is required')
    }

    return this.#apiRequest({
      logTag: 'createFolder',
      method: 'post',
      url: `${ API_BASE_URL }/folders`,
      body: {
        name,
        parent_folder_id: parentFolderId || 'root',
      },
    })
  }

  /**
   * @description Retrieves the metadata of a single Canva folder: name, timestamps, and thumbnail. Use List Folder Items to see what the folder contains. Requires the 'folder:read' scope.
   *
   * @route GET /get-folder
   * @operationName Get Folder
   * @category Folders
   *
   * @paramDef {"type":"String","label":"Folder","name":"folderId","required":true,"dictionary":"getFoldersDictionary","description":"The folder to retrieve. Select a folder or enter a folder id directly (e.g. 'FAF2lZtloor')."}
   *
   * @returns {Object}
   * @sampleResult {"folder":{"id":"FAF2lZtloor","name":"Campaign Assets","created_at":1377396000,"updated_at":1692928800,"thumbnail":{"width":595,"height":335,"url":"https://document-export.canva.com/thumb.png"}}}
   */
  async getFolder(folderId) {
    if (!folderId) {
      throw new Error('"Folder" is required')
    }

    return this.#apiRequest({
      logTag: 'getFolder',
      url: `${ API_BASE_URL }/folders/${ encodeURIComponent(folderId) }`,
    })
  }

  /**
   * @description Renames an existing Canva folder. Returns the updated folder. Requires the 'folder:write' scope.
   *
   * @route PATCH /update-folder
   * @operationName Update Folder
   * @category Folders
   *
   * @paramDef {"type":"String","label":"Folder","name":"folderId","required":true,"dictionary":"getFoldersDictionary","description":"The folder to rename. Select a folder or enter a folder id directly."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The new name for the folder (maximum 255 characters)."}
   *
   * @returns {Object}
   * @sampleResult {"folder":{"id":"FAF2lZtloor","name":"Renamed Folder","created_at":1377396000,"updated_at":1692928800}}
   */
  async updateFolder(folderId, name) {
    if (!folderId) {
      throw new Error('"Folder" is required')
    }

    if (!name) {
      throw new Error('"Name" is required')
    }

    return this.#apiRequest({
      logTag: 'updateFolder',
      method: 'patch',
      url: `${ API_BASE_URL }/folders/${ encodeURIComponent(folderId) }`,
      body: { name },
    })
  }

  /**
   * @description Deletes a Canva folder, moving it and its contents to the user's trash. Returns a success status. Requires the 'folder:write' scope.
   *
   * @route DELETE /delete-folder
   * @operationName Delete Folder
   * @category Folders
   *
   * @paramDef {"type":"String","label":"Folder","name":"folderId","required":true,"dictionary":"getFoldersDictionary","description":"The folder to delete. Select a folder or enter a folder id directly."}
   *
   * @returns {Object}
   * @sampleResult {"status":"success"}
   */
  async deleteFolder(folderId) {
    if (!folderId) {
      throw new Error('"Folder" is required')
    }

    return this.#apiRequest({
      logTag: 'deleteFolder',
      method: 'delete',
      url: `${ API_BASE_URL }/folders/${ encodeURIComponent(folderId) }`,
    })
  }

  /**
   * @description Lists the items inside a Canva folder (use 'root' for the top level of the user's projects), optionally filtered to designs, folders, and/or images. Results are paginated with a continuation token. Each item is wrapped in an object whose 'type' indicates whether it holds a 'design', 'folder', or 'image' payload. Requires the 'folder:read' scope.
   *
   * @route GET /list-folder-items
   * @operationName List Folder Items
   * @category Folders
   *
   * @paramDef {"type":"String","label":"Folder","name":"folderId","required":true,"defaultValue":"root","dictionary":"getFoldersDictionary","description":"The folder whose items to list. Use 'root' (default) for the top level of the user's projects."}
   * @paramDef {"type":"Array<String>","label":"Item Types","name":"itemTypes","uiComponent":{"type":"DROPDOWN","options":{"values":["Design","Folder","Image"]}},"description":"Optional item types to include. When omitted, all item types are returned."}
   * @paramDef {"type":"String","label":"Continuation","name":"continuation","description":"Continuation token from a previous response, used to retrieve the next page of items."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"type":"folder","folder":{"id":"FAF2lZtloor","name":"Campaign Assets","created_at":1377396000,"updated_at":1692928800}},{"type":"design","design":{"id":"DAFVztcvd9z","title":"Q3 Marketing Deck","page_count":5}}],"continuation":"RkFGMgXlsVTDbMd"}
   */
  async listFolderItems(folderId, itemTypes, continuation) {
    if (!folderId) {
      throw new Error('"Folder" is required')
    }

    const types = (Array.isArray(itemTypes) ? itemTypes : (itemTypes ? [itemTypes] : []))
      .filter(Boolean)
      .map(t => this.#resolveChoice(t, FOLDER_ITEM_TYPE_OPTIONS))

    return this.#apiRequest({
      logTag: 'listFolderItems',
      url: `${ API_BASE_URL }/folders/${ encodeURIComponent(folderId) }/items`,
      query: {
        item_types: types.length ? types.join(',') : undefined,
        continuation,
      },
    })
  }

  /**
   * @description Moves an item (a design, folder, or image asset) into a different Canva folder. Provide the id of the item to move and the id of the destination folder (use 'root' for the top level of the user's projects). Returns a success status. Requires the 'folder:write' scope.
   *
   * @route POST /move-folder-item
   * @operationName Move Folder Item
   * @category Folders
   *
   * @paramDef {"type":"String","label":"Item ID","name":"itemId","required":true,"description":"The id of the design, folder, or asset to move (e.g. 'DAFVztcvd9z' or 'FAF2lZtloor')."}
   * @paramDef {"type":"String","label":"Destination Folder","name":"toFolderId","required":true,"dictionary":"getFoldersDictionary","description":"The folder to move the item into. Use 'root' for the top level of the user's projects."}
   *
   * @returns {Object}
   * @sampleResult {"status":"success"}
   */
  async moveFolderItem(itemId, toFolderId) {
    if (!itemId) {
      throw new Error('"Item ID" is required')
    }

    if (!toFolderId) {
      throw new Error('"Destination Folder" is required')
    }

    return this.#apiRequest({
      logTag: 'moveFolderItem',
      method: 'post',
      url: `${ API_BASE_URL }/folders/move`,
      body: {
        item_id: itemId,
        to_folder_id: toFolderId,
      },
    })
  }

  // ========================================= BRAND TEMPLATES =========================================

  /**
   * @description Lists the brand templates available to the connected user, optionally filtered by a search term. Brand templates are a Canva Enterprise feature — this action fails for users on other Canva plans. Results are paginated with a continuation token. Requires the 'brandtemplate:meta:read' scope.
   *
   * @route GET /list-brand-templates
   * @operationName List Brand Templates
   * @category Brand Templates
   *
   * @paramDef {"type":"String","label":"Search Query","name":"query","description":"Optional text to search brand template titles for."}
   * @paramDef {"type":"String","label":"Continuation","name":"continuation","description":"Continuation token from a previous response, used to retrieve the next page of results."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"DEMzWSwy3BI","title":"Advertisement Template","view_url":"https://www.canva.com/design/view","create_url":"https://www.canva.com/design/create","thumbnail":{"width":595,"height":335,"url":"https://document-export.canva.com/thumb.png"},"created_at":1704110400,"updated_at":1719835200}],"continuation":"RkFGMgXlsVTDbMd"}
   */
  async listBrandTemplates(query, continuation) {
    return this.#apiRequest({
      logTag: 'listBrandTemplates',
      url: `${ API_BASE_URL }/brand-templates`,
      query: { query, continuation },
    })
  }

  /**
   * @description Retrieves the metadata of a single brand template: title, view/create URLs, thumbnail, and timestamps. Brand templates are a Canva Enterprise feature — this action fails for users on other Canva plans. Requires the 'brandtemplate:meta:read' scope.
   *
   * @route GET /get-brand-template
   * @operationName Get Brand Template
   * @category Brand Templates
   *
   * @paramDef {"type":"String","label":"Brand Template","name":"brandTemplateId","required":true,"dictionary":"getBrandTemplatesDictionary","description":"The brand template to retrieve. Select one or enter a brand template id directly (e.g. 'DEMzWSwy3BI')."}
   *
   * @returns {Object}
   * @sampleResult {"brand_template":{"id":"DEMzWSwy3BI","title":"Advertisement Template","view_url":"https://www.canva.com/design/view","create_url":"https://www.canva.com/design/create","thumbnail":{"width":595,"height":335,"url":"https://document-export.canva.com/thumb.png"},"created_at":1704110400,"updated_at":1719835200}}
   */
  async getBrandTemplate(brandTemplateId) {
    if (!brandTemplateId) {
      throw new Error('"Brand Template" is required')
    }

    return this.#apiRequest({
      logTag: 'getBrandTemplate',
      url: `${ API_BASE_URL }/brand-templates/${ encodeURIComponent(brandTemplateId) }`,
    })
  }

  /**
   * @description Retrieves the dataset definition of a brand template — the named data fields (text, image, and chart) that can be filled with Autofill Design. Use this to discover the field names and types expected in the Autofill "Data" parameter. Brand templates are a Canva Enterprise feature — this action fails for users on other Canva plans. Requires the 'brandtemplate:content:read' scope.
   *
   * @route GET /get-brand-template-dataset
   * @operationName Get Brand Template Dataset
   * @category Brand Templates
   *
   * @paramDef {"type":"String","label":"Brand Template","name":"brandTemplateId","required":true,"dictionary":"getBrandTemplatesDictionary","description":"The brand template whose dataset to retrieve. Select one or enter a brand template id directly."}
   *
   * @returns {Object}
   * @sampleResult {"dataset":{"headline_text":{"type":"text"},"product_image":{"type":"image"},"sales_chart":{"type":"chart"}}}
   */
  async getBrandTemplateDataset(brandTemplateId) {
    if (!brandTemplateId) {
      throw new Error('"Brand Template" is required')
    }

    return this.#apiRequest({
      logTag: 'getBrandTemplateDataset',
      url: `${ API_BASE_URL }/brand-templates/${ encodeURIComponent(brandTemplateId) }/dataset`,
    })
  }

  // ============================================ AUTOFILL =============================================

  /**
   * @description Starts an asynchronous job that creates a new design by filling a brand template's data fields with your values. The Data object maps each dataset field name to a value object: {"type":"text","text":"..."} for text fields, {"type":"image","asset_id":"..."} for image fields, or {"type":"chart","chart_data":{...}} for chart fields (discover the fields with Get Brand Template Dataset). Returns immediately with a job id — poll it with Get Autofill Job, or use Autofill Design and Wait. Autofill is a Canva Enterprise feature. Requires the 'design:content:write' scope.
   *
   * @route POST /autofill-design
   * @operationName Autofill Design
   * @category Autofill
   *
   * @paramDef {"type":"String","label":"Brand Template","name":"brandTemplateId","required":true,"dictionary":"getBrandTemplatesDictionary","description":"The brand template to autofill. Select one or enter a brand template id directly."}
   * @paramDef {"type":"Object","label":"Data","name":"data","required":true,"description":"Field values keyed by dataset field name, e.g. {\"headline_text\":{\"type\":\"text\",\"text\":\"Spring Sale\"},\"product_image\":{\"type\":\"image\",\"asset_id\":\"Msd59349ff\"}}. Use Get Brand Template Dataset to discover the available fields and their types (text, image, or chart)."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"Optional title for the design created by the autofill (maximum 255 characters)."}
   *
   * @returns {Object}
   * @sampleResult {"job":{"id":"450a76e7-8f28-4f8e-a9b2-56d1f2c31a8f","status":"in_progress"}}
   */
  async autofillDesign(brandTemplateId, data, title) {
    if (!brandTemplateId) {
      throw new Error('"Brand Template" is required')
    }

    if (!data || typeof data !== 'object' || !Object.keys(data).length) {
      throw new Error('"Data" is required and must map at least one dataset field to a value')
    }

    const body = {
      brand_template_id: brandTemplateId,
      data,
    }

    if (title !== undefined && title !== null && title !== '') {
      body.title = title
    }

    return this.#apiRequest({
      logTag: 'autofillDesign',
      method: 'post',
      url: `${ API_BASE_URL }/autofills`,
      body,
    })
  }

  /**
   * @description Retrieves the status and result of an autofill job started with Autofill Design. While running, the status is 'in_progress'; on 'success' the job's result contains the newly created design (id, title, URL, thumbnail); on 'failed' it contains an error code and message.
   *
   * @route GET /get-autofill-job
   * @operationName Get Autofill Job
   * @category Autofill
   *
   * @paramDef {"type":"String","label":"Autofill Job ID","name":"jobId","required":true,"description":"The id of the autofill job, as returned by Autofill Design."}
   *
   * @returns {Object}
   * @sampleResult {"job":{"id":"450a76e7-8f28-4f8e-a9b2-56d1f2c31a8f","status":"success","result":{"type":"create_design","design":{"id":"DAFVztcvd9z","title":"Spring Sale Ad","url":"https://www.canva.com/design/DAFVztcvd9z","thumbnail":{"width":595,"height":335,"url":"https://document-export.canva.com/thumb.png"}}}}}
   */
  async getAutofillJob(jobId) {
    if (!jobId) {
      throw new Error('"Autofill Job ID" is required')
    }

    return this.#apiRequest({
      logTag: 'getAutofillJob',
      url: `${ API_BASE_URL }/autofills/${ encodeURIComponent(jobId) }`,
    })
  }

  /**
   * @description Autofills a brand template and waits for the result in a single action: starts the autofill job, then polls it every 3 seconds until it completes (up to about 5 minutes). Returns the completed job whose result contains the newly created design (id, title, URL, thumbnail). Fails with a descriptive error if the autofill job fails or does not finish in time. Autofill is a Canva Enterprise feature. Requires the 'design:content:write' scope.
   *
   * @route POST /autofill-design-and-wait
   * @operationName Autofill Design and Wait
   * @category Autofill
   * @executionTimeoutInSeconds 300
   *
   * @paramDef {"type":"String","label":"Brand Template","name":"brandTemplateId","required":true,"dictionary":"getBrandTemplatesDictionary","description":"The brand template to autofill. Select one or enter a brand template id directly."}
   * @paramDef {"type":"Object","label":"Data","name":"data","required":true,"description":"Field values keyed by dataset field name, e.g. {\"headline_text\":{\"type\":\"text\",\"text\":\"Spring Sale\"},\"product_image\":{\"type\":\"image\",\"asset_id\":\"Msd59349ff\"}}. Use Get Brand Template Dataset to discover the available fields and their types (text, image, or chart)."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"Optional title for the design created by the autofill (maximum 255 characters)."}
   *
   * @returns {Object}
   * @sampleResult {"job":{"id":"450a76e7-8f28-4f8e-a9b2-56d1f2c31a8f","status":"success","result":{"type":"create_design","design":{"id":"DAFVztcvd9z","title":"Spring Sale Ad","url":"https://www.canva.com/design/DAFVztcvd9z","thumbnail":{"width":595,"height":335,"url":"https://document-export.canva.com/thumb.png"}}}}}
   */
  async autofillDesignAndWait(brandTemplateId, data, title) {
    const started = await this.autofillDesign(brandTemplateId, data, title)

    const job = await this.#pollJobUntilDone({
      jobKind: 'autofill',
      fetchJob: () => this.getAutofillJob(started.job.id),
    })

    return { job }
  }

  // ============================================== USERS ==============================================

  /**
   * @description Retrieves the ids of the connected Canva user and their team. Useful as a lightweight connection check and for correlating Canva webhooks or audit data.
   *
   * @route GET /get-current-user
   * @operationName Get Current User
   * @category Users
   *
   * @returns {Object}
   * @sampleResult {"team_user":{"user_id":"auDAbliZ2rQNNOsUl5OLu","team_id":"Oi2RJILTrKk0KRhRUZozX"}}
   */
  async getCurrentUser() {
    return this.#apiRequest({
      logTag: 'getCurrentUser',
      url: `${ API_BASE_URL }/users/me`,
    })
  }

  /**
   * @description Retrieves the profile of the connected Canva user, currently their display name. Requires the 'profile:read' scope.
   *
   * @route GET /get-user-profile
   * @operationName Get User Profile
   * @category Users
   *
   * @returns {Object}
   * @sampleResult {"profile":{"display_name":"Jane Doe"}}
   */
  async getUserProfile() {
    return this.#apiRequest({
      logTag: 'getUserProfile',
      url: `${ API_BASE_URL }/users/me/profile`,
    })
  }
}

Flowrunner.ServerCode.addService(CanvaService, [
  {
    displayName: 'Client Id',
    defaultValue: '',
    name: 'clientId',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'The Client ID of your Canva integration from https://www.canva.com/developers/integrations. ' +
      'Note: new Canva integrations start in preview mode — only members of your Canva team can connect ' +
      'until Canva reviews and approves the integration for public use.',
  },
  {
    displayName: 'Client Secret',
    defaultValue: '',
    name: 'clientSecret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'The Client Secret of your Canva integration from https://www.canva.com/developers/integrations.',
  },
])

function cleanupObject(data) {
  const result = {}

  Object.keys(data).forEach(key => {
    if (data[key] !== undefined && data[key] !== null && data[key] !== '') {
      result[key] = data[key]
    }
  })

  return result
}

function isEmptyResponse(response) {
  if (response === undefined || response === null || response === '') {
    return true
  }

  return typeof response === 'object' && !Buffer.isBuffer(response) && Object.keys(response).length === 0
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
