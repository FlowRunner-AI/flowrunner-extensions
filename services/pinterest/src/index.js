'use strict'

const AUTHORIZE_URL = 'https://www.pinterest.com/oauth/'
const TOKEN_URL = 'https://api.pinterest.com/v5/oauth/token'
const API_BASE_URL = 'https://api.pinterest.com/v5'

// Comma-separated scopes required by the actions in this service.
const DEFAULT_SCOPE_LIST = [
  'boards:read',
  'boards:write',
  'pins:read',
  'pins:write',
  'user_accounts:read',
]

const DEFAULT_SCOPE_STRING = DEFAULT_SCOPE_LIST.join(',')

const DEFAULT_PAGE_SIZE = 25

// Media processing (video pins) is asynchronous; poll GET /media/{id} until it succeeds.
const MEDIA_POLL_ATTEMPTS = 30
const MEDIA_POLL_INTERVAL_MS = 4000

// Board privacy on list/read endpoints (blank = All).
const BOARD_LIST_PRIVACY_OPTIONS = {
  'All': undefined,
  'Public': 'PUBLIC',
  'Protected': 'PROTECTED',
  'Secret': 'SECRET',
}

// Board privacy on create/update endpoints (no "All" - a concrete value is written).
const BOARD_WRITE_PRIVACY_OPTIONS = {
  'Public': 'PUBLIC',
  'Protected': 'PROTECTED',
  'Secret': 'SECRET',
}

// Pin analytics metric types.
const PIN_METRIC_OPTIONS = {
  'Impression': 'IMPRESSION',
  'Save': 'SAVE',
  'Pin Click': 'PIN_CLICK',
  'Outbound Click': 'OUTBOUND_CLICK',
  'Video Views': 'VIDEO_MRC_VIEW',
}

// Device/app type breakdown for analytics.
const APP_TYPE_OPTIONS = {
  'All': 'ALL',
  'Mobile': 'MOBILE',
  'Tablet': 'TABLET',
  'Web': 'WEB',
}

// Filter for the "List Pins" endpoint.
const PIN_FILTER_OPTIONS = {
  'All': undefined,
  'Exclude Native': 'exclude_native',
  'Has Been Promoted': 'has_been_promoted',
}

const logger = {
  info: (...args) => console.log('[Pinterest] info:', ...args),
  debug: (...args) => console.log('[Pinterest] debug:', ...args),
  error: (...args) => console.log('[Pinterest] error:', ...args),
  warn: (...args) => console.log('[Pinterest] warn:', ...args),
}

/**
 * @requireOAuth
 * @usesFileStorage
 * @integrationName Pinterest
 * @integrationIcon /icon.svg
 **/
class PinterestService {
  constructor(config) {
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
    this.scopes = DEFAULT_SCOPE_STRING
  }

  // Single private request helper - all Pinterest API calls go through here.
  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    if (query) {
      query = cleanupObject(query)
    }

    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=[${ JSON.stringify(query) }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Authorization': `Bearer ${ this.request.headers['oauth-access-token'] }`,
          'Content-Type': 'application/json',
        })
        .query(query || {})

      const response = body !== undefined ? await request.send(body) : await request

      return isEmptyResponse(response) ? { status: 'success' } : response
    } catch (error) {
      const message = this.#extractError(error)

      logger.error(`${ logTag } - failed: ${ message }`)

      throw new Error(`Pinterest API error: ${ message }`)
    }
  }

  // Pinterest errors are shaped { code, message } (v5) or { error, error_description } (auth server).
  #extractError(error) {
    const body = error.body

    if (body) {
      if (body.message) {
        const code = body.code !== undefined ? ` (code ${ body.code })` : ''

        return `${ body.message }${ code }`
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

  #basicAuthHeader() {
    const encoded = Buffer.from(`${ this.clientId }:${ this.clientSecret }`).toString('base64')

    return {
      'Authorization': `Basic ${ encoded }`,
      'Content-Type': 'application/x-www-form-urlencoded',
    }
  }

  // Normalizes a list of enum labels (or a single label) to their API values.
  #mapChoiceList(value, mapping) {
    return (Array.isArray(value) ? value : (value ? [value] : []))
      .filter(Boolean)
      .map(item => this.#resolveChoice(item, mapping))
      .filter(Boolean)
  }

  // ============================================= OAUTH ================================================

  /**
   * @registerAs SYSTEM
   * @route GET /getOAuth2ConnectionURL
   * @returns {String}
   */
  async getOAuth2ConnectionURL() {
    const params = new URLSearchParams()

    params.append('client_id', this.clientId)
    params.append('response_type', 'code')
    // Pinterest expects comma-separated scopes; URLSearchParams encodes the commas, which Pinterest accepts.
    params.append('scope', this.scopes)
    params.append('state', `flowrunner_${ Date.now() }`)

    const connectionURL = `${ AUTHORIZE_URL }?${ params.toString() }`

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
    params.append('redirect_uri', callbackObject.redirectURI)

    const tokenResponse = await Flowrunner.Request.post(TOKEN_URL)
      .set(this.#basicAuthHeader())
      .send(params.toString())

    let userData = {}
    let connectionIdentityName = 'Pinterest Account'
    let connectionIdentityImageURL = null

    try {
      userData = await Flowrunner.Request
        .get(`${ API_BASE_URL }/user_account`)
        .set({ 'Authorization': `Bearer ${ tokenResponse.access_token }` })

      connectionIdentityName = userData.username || connectionIdentityName
      connectionIdentityImageURL = userData.profile_image || null
    } catch (error) {
      logger.error(`[executeCallback] /user_account error: ${ error.message }`)
    }

    return {
      token: tokenResponse.access_token,
      expirationInSeconds: tokenResponse.expires_in,
      refreshToken: tokenResponse.refresh_token,
      connectionIdentityName,
      connectionIdentityImageURL,
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
      params.append('scope', this.scopes)

      const { access_token, expires_in, refresh_token } = await Flowrunner.Request.post(TOKEN_URL)
        .set(this.#basicAuthHeader())
        .send(params.toString())

      return {
        token: access_token,
        expirationInSeconds: expires_in,
        // Pinterest keeps the original long-lived refresh token; reuse it if none is returned.
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
   * @typedef {Object} getBoardsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter the retrieved boards by name. Filtering is applied locally to the current page."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination bookmark from a previous response, used to retrieve the next page of boards."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Boards Dictionary
   * @description Lists the connected account's boards for selection in dependent parameters. Returns the board name as the label and the board id as the value.
   * @route POST /get-boards-dictionary
   * @paramDef {"type":"getBoardsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Recipes","value":"549755885175","note":"42 pins"}],"cursor":"Pz9QQ0YxT0M0d09EQXpNVEEw"}
   */
  async getBoardsDictionary(payload) {
    const { search, cursor } = payload || {}

    const response = await this.#apiRequest({
      logTag: 'getBoardsDictionary',
      url: `${ API_BASE_URL }/boards`,
      query: { page_size: 100, bookmark: cursor || undefined },
    })

    const items = Array.isArray(response.items) ? response.items : []

    const filtered = search
      ? items.filter(board => board?.name && board.name.toLowerCase().includes(search.toLowerCase()))
      : items

    return {
      cursor: response.bookmark || undefined,
      items: filtered.map(board => ({
        label: board.name,
        value: board.id,
        note: board.pin_count !== undefined ? `${ board.pin_count } pins` : (board.privacy || ''),
      })),
    }
  }

  /**
   * @typedef {Object} getBoardSectionsDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Board","name":"boardId","required":true,"dictionary":"getBoardsDictionary","description":"The board whose sections should be listed."}
   */

  /**
   * @typedef {Object} getBoardSectionsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter the retrieved sections by name. Filtering is applied locally to the current page."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination bookmark from a previous response, used to retrieve the next page of sections."}
   * @paramDef {"type":"getBoardSectionsDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"Dependency values - the board to list sections for."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Board Sections Dictionary
   * @description Lists the sections of a selected board for use in dependent parameters. Returns the section name as the label and the section id as the value. Depends on a board selection.
   * @route POST /get-board-sections-dictionary
   * @paramDef {"type":"getBoardSectionsDictionary__payload","label":"Payload","name":"payload","description":"Search, pagination, and board dependency input."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Desserts","value":"5064525295458","note":""}],"cursor":"Pz9QQ0YxT0M0d09EQXpNVEEw"}
   */
  async getBoardSectionsDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const boardId = criteria?.boardId

    if (!boardId) {
      return { items: [] }
    }

    const response = await this.#apiRequest({
      logTag: 'getBoardSectionsDictionary',
      url: `${ API_BASE_URL }/boards/${ boardId }/sections`,
      query: { page_size: 100, bookmark: cursor || undefined },
    })

    const items = Array.isArray(response.items) ? response.items : []

    const filtered = search
      ? items.filter(section => section?.name && section.name.toLowerCase().includes(search.toLowerCase()))
      : items

    return {
      cursor: response.bookmark || undefined,
      items: filtered.map(section => ({
        label: section.name,
        value: section.id,
        note: '',
      })),
    }
  }

  // ============================================== USER ================================================

  /**
   * @description Retrieves the profile of the connected Pinterest account, including username, account type (personal or business), profile image, website URL, and aggregate counts of pins, boards, followers, and following. Useful as a connection check.
   *
   * @route GET /get-user-account
   * @operationName Get User Account
   * @category User
   *
   * @returns {Object}
   * @sampleResult {"account_type":"BUSINESS","username":"exampleuser","profile_image":"https://i.pinimg.com/280x280_RS/abc.jpg","website_url":"https://example.com","board_count":12,"pin_count":340,"follower_count":1500,"following_count":230}
   */
  async getUserAccount() {
    return this.#apiRequest({
      logTag: 'getUserAccount',
      url: `${ API_BASE_URL }/user_account`,
    })
  }

  /**
   * @description Retrieves engagement and reach analytics for the connected account over a date range (both dates required, in YYYY-MM-DD format, within the last 90 days). Optionally break results down by a field such as pin format or content type. Returns daily metric values keyed by the split field. Note: analytics require a business account and Standard API access.
   *
   * @route GET /get-user-account-analytics
   * @operationName Get User Account Analytics
   * @category User
   *
   * @paramDef {"type":"String","label":"Start Date","name":"startDate","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"The first day of the reporting window, in YYYY-MM-DD format. Must be within the last 90 days."}
   * @paramDef {"type":"String","label":"End Date","name":"endDate","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"The last day of the reporting window, in YYYY-MM-DD format. Must be on or after the start date."}
   * @paramDef {"type":"String","label":"Split Field","name":"splitField","uiComponent":{"type":"DROPDOWN","options":{"values":["No Split","By Format","By Content Type"]}},"description":"Optional dimension to break the metrics down by. 'No Split' returns totals only."}
   * @paramDef {"type":"Array<String>","label":"App Types","name":"appTypes","uiComponent":{"type":"DROPDOWN","options":{"values":["All","Mobile","Tablet","Web"]}},"description":"Optional device/app breakdown for the metrics. Defaults to All."}
   *
   * @returns {Object}
   * @sampleResult {"all":{"summary_metrics":{"IMPRESSION":12000,"SAVE":340,"PIN_CLICK":210,"OUTBOUND_CLICK":98},"daily_metrics":[{"date":"2024-01-01","metrics":{"IMPRESSION":400}}]}}
   */
  async getUserAccountAnalytics(startDate, endDate, splitField, appTypes) {
    if (!startDate || !endDate) {
      throw new Error('"Start Date" and "End Date" are required')
    }

    const splitMap = {
      'No Split': undefined,
      'By Format': 'PIN_FORMAT',
      'By Content Type': 'CONTENT_TYPE',
    }

    const appTypeList = this.#mapChoiceList(appTypes, APP_TYPE_OPTIONS)

    return this.#apiRequest({
      logTag: 'getUserAccountAnalytics',
      url: `${ API_BASE_URL }/user_account/analytics`,
      query: {
        start_date: startDate,
        end_date: endDate,
        split_field: this.#resolveChoice(splitField, splitMap),
        app_types: appTypeList.length ? appTypeList.join(',') : undefined,
      },
    })
  }

  // ============================================= BOARDS ===============================================

  /**
   * @description Retrieves the boards owned by the connected account, paginated. Optionally filter by privacy (Public, Protected, or Secret). Returns board objects with a "bookmark" pagination token for retrieving the next page.
   *
   * @route GET /list-boards
   * @operationName List Boards
   * @category Boards
   *
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of boards to return per page. Range: 1-250. Default: 25."}
   * @paramDef {"type":"String","label":"Bookmark","name":"bookmark","description":"Pagination token returned as 'bookmark' in a previous response. Omit to retrieve the first page."}
   * @paramDef {"type":"String","label":"Privacy","name":"privacy","defaultValue":"All","uiComponent":{"type":"DROPDOWN","options":{"values":["All","Public","Protected","Secret"]}},"description":"Optional privacy filter. 'All' returns boards of every privacy level."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"549755885175","name":"Recipes","description":"Dinner ideas","privacy":"PUBLIC","pin_count":42,"follower_count":10}],"bookmark":"Pz9QQ0YxT0M0d09EQXpNVEEw"}
   */
  async listBoards(pageSize, bookmark, privacy) {
    return this.#apiRequest({
      logTag: 'listBoards',
      url: `${ API_BASE_URL }/boards`,
      query: {
        page_size: pageSize || DEFAULT_PAGE_SIZE,
        bookmark: bookmark || undefined,
        privacy: this.#resolveChoice(privacy, BOARD_LIST_PRIVACY_OPTIONS),
      },
    })
  }

  /**
   * @description Retrieves a single board by its id, including its name, description, privacy, owner, cover image, and pin/follower counts.
   *
   * @route GET /get-board
   * @operationName Get Board
   * @category Boards
   *
   * @paramDef {"type":"String","label":"Board","name":"boardId","required":true,"dictionary":"getBoardsDictionary","description":"The board to retrieve. Select one of your boards or enter a board id directly."}
   *
   * @returns {Object}
   * @sampleResult {"id":"549755885175","name":"Recipes","description":"Dinner ideas","privacy":"PUBLIC","pin_count":42,"follower_count":10,"owner":{"username":"exampleuser"}}
   */
  async getBoard(boardId) {
    if (!boardId) {
      throw new Error('"Board" is required')
    }

    return this.#apiRequest({
      logTag: 'getBoard',
      url: `${ API_BASE_URL }/boards/${ boardId }`,
    })
  }

  /**
   * @description Creates a new board on the connected account. Only the name is required; description and privacy are optional (privacy defaults to Public). Returns the newly created board object including its id.
   *
   * @route POST /create-board
   * @operationName Create Board
   * @category Boards
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The name for the new board. Maximum 180 characters."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional board description. Maximum 500 characters."}
   * @paramDef {"type":"String","label":"Privacy","name":"privacy","defaultValue":"Public","uiComponent":{"type":"DROPDOWN","options":{"values":["Public","Protected","Secret"]}},"description":"Board visibility. 'Public' is visible to everyone, 'Secret' only to the owner and collaborators. Default: Public."}
   *
   * @returns {Object}
   * @sampleResult {"id":"549755885175","name":"Recipes","description":"Dinner ideas","privacy":"PUBLIC","pin_count":0,"follower_count":0}
   */
  async createBoard(name, description, privacy) {
    if (!name) {
      throw new Error('"Name" is required')
    }

    const body = cleanupObject({
      name,
      description,
      privacy: this.#resolveChoice(privacy || 'Public', BOARD_WRITE_PRIVACY_OPTIONS),
    })

    return this.#apiRequest({
      logTag: 'createBoard',
      method: 'post',
      url: `${ API_BASE_URL }/boards`,
      body,
    })
  }

  /**
   * @description Updates the name, description, and/or privacy of an existing board. Only the fields you provide are changed. Returns the updated board object.
   *
   * @route PATCH /update-board
   * @operationName Update Board
   * @category Boards
   *
   * @paramDef {"type":"String","label":"Board","name":"boardId","required":true,"dictionary":"getBoardsDictionary","description":"The board to update. Select one of your boards or enter a board id directly."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"Optional new name for the board."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional new description for the board."}
   * @paramDef {"type":"String","label":"Privacy","name":"privacy","uiComponent":{"type":"DROPDOWN","options":{"values":["Public","Protected","Secret"]}},"description":"Optional new visibility for the board."}
   *
   * @returns {Object}
   * @sampleResult {"id":"549755885175","name":"Dinner Recipes","description":"Weeknight meals","privacy":"PROTECTED","pin_count":42,"follower_count":10}
   */
  async updateBoard(boardId, name, description, privacy) {
    if (!boardId) {
      throw new Error('"Board" is required')
    }

    const body = cleanupObject({
      name,
      description,
      privacy: this.#resolveChoice(privacy, BOARD_WRITE_PRIVACY_OPTIONS),
    })

    if (!Object.keys(body).length) {
      throw new Error('At least one field to update is required')
    }

    return this.#apiRequest({
      logTag: 'updateBoard',
      method: 'patch',
      url: `${ API_BASE_URL }/boards/${ boardId }`,
      body,
    })
  }

  /**
   * @description Permanently deletes a board and all of the pins it contains. This action cannot be undone. Returns a success status.
   *
   * @route DELETE /delete-board
   * @operationName Delete Board
   * @category Boards
   *
   * @paramDef {"type":"String","label":"Board","name":"boardId","required":true,"dictionary":"getBoardsDictionary","description":"The board to delete. Select one of your boards or enter a board id directly."}
   *
   * @returns {Object}
   * @sampleResult {"status":"success"}
   */
  async deleteBoard(boardId) {
    if (!boardId) {
      throw new Error('"Board" is required')
    }

    return this.#apiRequest({
      logTag: 'deleteBoard',
      method: 'delete',
      url: `${ API_BASE_URL }/boards/${ boardId }`,
    })
  }

  /**
   * @description Retrieves the pins contained in a board, paginated. Returns pin objects with a "bookmark" pagination token for retrieving the next page.
   *
   * @route GET /list-board-pins
   * @operationName List Board Pins
   * @category Boards
   *
   * @paramDef {"type":"String","label":"Board","name":"boardId","required":true,"dictionary":"getBoardsDictionary","description":"The board whose pins should be listed."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of pins to return per page. Range: 1-100. Default: 25."}
   * @paramDef {"type":"String","label":"Bookmark","name":"bookmark","description":"Pagination token returned as 'bookmark' in a previous response. Omit to retrieve the first page."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"813744123456","board_id":"549755885175","title":"Pasta","link":"https://example.com/pasta","media":{"media_type":"image"}}],"bookmark":"Pz9QQ0YxT0M0d09EQXpNVEEw"}
   */
  async listBoardPins(boardId, pageSize, bookmark) {
    if (!boardId) {
      throw new Error('"Board" is required')
    }

    return this.#apiRequest({
      logTag: 'listBoardPins',
      url: `${ API_BASE_URL }/boards/${ boardId }/pins`,
      query: {
        page_size: pageSize || DEFAULT_PAGE_SIZE,
        bookmark: bookmark || undefined,
      },
    })
  }

  // ========================================= BOARD SECTIONS ===========================================

  /**
   * @description Retrieves the sections of a board, paginated. Sections group pins within a board. Returns section objects with a "bookmark" pagination token.
   *
   * @route GET /list-board-sections
   * @operationName List Board Sections
   * @category Board Sections
   *
   * @paramDef {"type":"String","label":"Board","name":"boardId","required":true,"dictionary":"getBoardsDictionary","description":"The board whose sections should be listed."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of sections to return per page. Range: 1-100. Default: 25."}
   * @paramDef {"type":"String","label":"Bookmark","name":"bookmark","description":"Pagination token returned as 'bookmark' in a previous response. Omit to retrieve the first page."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"5064525295458","name":"Desserts"}],"bookmark":"Pz9QQ0YxT0M0d09EQXpNVEEw"}
   */
  async listBoardSections(boardId, pageSize, bookmark) {
    if (!boardId) {
      throw new Error('"Board" is required')
    }

    return this.#apiRequest({
      logTag: 'listBoardSections',
      url: `${ API_BASE_URL }/boards/${ boardId }/sections`,
      query: {
        page_size: pageSize || DEFAULT_PAGE_SIZE,
        bookmark: bookmark || undefined,
      },
    })
  }

  /**
   * @description Creates a new section within a board to help organize its pins. Returns the newly created section object including its id.
   *
   * @route POST /create-board-section
   * @operationName Create Board Section
   * @category Board Sections
   *
   * @paramDef {"type":"String","label":"Board","name":"boardId","required":true,"dictionary":"getBoardsDictionary","description":"The board to add the section to."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The name for the new section."}
   *
   * @returns {Object}
   * @sampleResult {"id":"5064525295458","name":"Desserts"}
   */
  async createBoardSection(boardId, name) {
    if (!boardId) {
      throw new Error('"Board" is required')
    }

    if (!name) {
      throw new Error('"Name" is required')
    }

    return this.#apiRequest({
      logTag: 'createBoardSection',
      method: 'post',
      url: `${ API_BASE_URL }/boards/${ boardId }/sections`,
      body: { name },
    })
  }

  /**
   * @description Retrieves the pins contained in a specific section of a board, paginated. Returns pin objects with a "bookmark" pagination token.
   *
   * @route GET /list-section-pins
   * @operationName List Section Pins
   * @category Board Sections
   *
   * @paramDef {"type":"String","label":"Board","name":"boardId","required":true,"dictionary":"getBoardsDictionary","description":"The board that contains the section."}
   * @paramDef {"type":"String","label":"Section","name":"sectionId","required":true,"dependsOn":["boardId"],"dictionary":"getBoardSectionsDictionary","description":"The section whose pins should be listed. Choose the board first."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of pins to return per page. Range: 1-100. Default: 25."}
   * @paramDef {"type":"String","label":"Bookmark","name":"bookmark","description":"Pagination token returned as 'bookmark' in a previous response. Omit to retrieve the first page."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"813744123456","board_id":"549755885175","board_section_id":"5064525295458","title":"Cake"}],"bookmark":"Pz9QQ0YxT0M0d09EQXpNVEEw"}
   */
  async listSectionPins(boardId, sectionId, pageSize, bookmark) {
    if (!boardId) {
      throw new Error('"Board" is required')
    }

    if (!sectionId) {
      throw new Error('"Section" is required')
    }

    return this.#apiRequest({
      logTag: 'listSectionPins',
      url: `${ API_BASE_URL }/boards/${ boardId }/sections/${ sectionId }/pins`,
      query: {
        page_size: pageSize || DEFAULT_PAGE_SIZE,
        bookmark: bookmark || undefined,
      },
    })
  }

  /**
   * @description Deletes a section from a board. The pins that were in the section remain on the board (they are moved out of the section, not deleted). Returns a success status.
   *
   * @route DELETE /delete-board-section
   * @operationName Delete Board Section
   * @category Board Sections
   *
   * @paramDef {"type":"String","label":"Board","name":"boardId","required":true,"dictionary":"getBoardsDictionary","description":"The board that contains the section."}
   * @paramDef {"type":"String","label":"Section","name":"sectionId","required":true,"dependsOn":["boardId"],"dictionary":"getBoardSectionsDictionary","description":"The section to delete. Choose the board first."}
   *
   * @returns {Object}
   * @sampleResult {"status":"success"}
   */
  async deleteBoardSection(boardId, sectionId) {
    if (!boardId) {
      throw new Error('"Board" is required')
    }

    if (!sectionId) {
      throw new Error('"Section" is required')
    }

    return this.#apiRequest({
      logTag: 'deleteBoardSection',
      method: 'delete',
      url: `${ API_BASE_URL }/boards/${ boardId }/sections/${ sectionId }`,
    })
  }

  // ============================================== PINS ================================================

  /**
   * @description Creates an image pin on a board from one or more publicly accessible image URLs. A single image URL produces a standard image pin; supplying more than one URL produces a carousel pin. Optionally set a title, description, destination link, alt text, dominant color, and target section. For video pins use "Create Video Pin" instead. Returns the newly created pin object including its id.
   *
   * @route POST /create-pin
   * @operationName Create Pin
   * @category Pins
   *
   * @paramDef {"type":"String","label":"Board","name":"boardId","required":true,"dictionary":"getBoardsDictionary","description":"The board to create the pin on."}
   * @paramDef {"type":"Array<String>","label":"Image URLs","name":"imageUrls","required":true,"description":"One or more publicly accessible image URLs. A single URL creates an image pin; multiple URLs create a carousel pin (up to 5 images)."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"Optional pin title. Maximum 100 characters."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional pin description. Maximum 800 characters."}
   * @paramDef {"type":"String","label":"Link","name":"link","description":"Optional destination URL that the pin links to when clicked."}
   * @paramDef {"type":"String","label":"Alt Text","name":"altText","description":"Optional alternative text describing the image for accessibility. Maximum 500 characters."}
   * @paramDef {"type":"String","label":"Dominant Color","name":"dominantColor","description":"Optional dominant color of the pin as a hex code (e.g. '#6E7874'). Used for pin display."}
   * @paramDef {"type":"String","label":"Section","name":"boardSectionId","dependsOn":["boardId"],"dictionary":"getBoardSectionsDictionary","description":"Optional board section to place the pin in. Choose the board first."}
   *
   * @returns {Object}
   * @sampleResult {"id":"813744123456","board_id":"549755885175","title":"Pasta","description":"Weeknight dinner","link":"https://example.com/pasta","media":{"media_type":"image"}}
   */
  async createPin(boardId, imageUrls, title, description, link, altText, dominantColor, boardSectionId) {
    if (!boardId) {
      throw new Error('"Board" is required')
    }

    const urls = (Array.isArray(imageUrls) ? imageUrls : (imageUrls ? [imageUrls] : [])).filter(Boolean)

    if (!urls.length) {
      throw new Error('At least one image URL is required')
    }

    const mediaSource = urls.length > 1
      ? { source_type: 'multiple_image_urls', items: urls.map(url => ({ url })) }
      : { source_type: 'image_url', url: urls[0] }

    const body = cleanupObject({
      board_id: boardId,
      board_section_id: boardSectionId,
      title,
      description,
      link,
      alt_text: altText,
      dominant_color: dominantColor,
      media_source: mediaSource,
    })

    return this.#apiRequest({
      logTag: 'createPin',
      method: 'post',
      url: `${ API_BASE_URL }/pins`,
      body,
    })
  }

  /**
   * @description Retrieves a single pin by its id, including its board, title, description, destination link, media details, and creation time.
   *
   * @route GET /get-pin
   * @operationName Get Pin
   * @category Pins
   *
   * @paramDef {"type":"String","label":"Pin ID","name":"pinId","required":true,"description":"The id of the pin to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":"813744123456","board_id":"549755885175","title":"Pasta","description":"Weeknight dinner","link":"https://example.com/pasta","media":{"media_type":"image"},"created_at":"2024-01-15T09:30:00"}
   */
  async getPin(pinId) {
    if (!pinId) {
      throw new Error('"Pin ID" is required')
    }

    return this.#apiRequest({
      logTag: 'getPin',
      url: `${ API_BASE_URL }/pins/${ pinId }`,
    })
  }

  /**
   * @description Updates an existing pin's metadata and/or moves it to a different board or section. Only the fields you provide are changed. To move a pin, supply a new Board (and optionally Section). Returns the updated pin object.
   *
   * @route PATCH /update-pin
   * @operationName Update Pin
   * @category Pins
   *
   * @paramDef {"type":"String","label":"Pin ID","name":"pinId","required":true,"description":"The id of the pin to update."}
   * @paramDef {"type":"String","label":"Board","name":"boardId","dictionary":"getBoardsDictionary","description":"Optional board to move the pin to. Omit to leave the pin on its current board."}
   * @paramDef {"type":"String","label":"Section","name":"boardSectionId","dependsOn":["boardId"],"dictionary":"getBoardSectionsDictionary","description":"Optional board section to move the pin to. Choose the board first."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"Optional new pin title."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional new pin description."}
   * @paramDef {"type":"String","label":"Link","name":"link","description":"Optional new destination URL for the pin."}
   * @paramDef {"type":"String","label":"Alt Text","name":"altText","description":"Optional new alternative text for the pin image."}
   * @paramDef {"type":"String","label":"Note","name":"note","description":"Optional private note about the pin, visible only to you."}
   *
   * @returns {Object}
   * @sampleResult {"id":"813744123456","board_id":"549755885176","title":"Updated Pasta","description":"New description","link":"https://example.com/pasta"}
   */
  async updatePin(pinId, boardId, boardSectionId, title, description, link, altText, note) {
    if (!pinId) {
      throw new Error('"Pin ID" is required')
    }

    const body = cleanupObject({
      board_id: boardId,
      board_section_id: boardSectionId,
      title,
      description,
      link,
      alt_text: altText,
      note,
    })

    if (!Object.keys(body).length) {
      throw new Error('At least one field to update is required')
    }

    return this.#apiRequest({
      logTag: 'updatePin',
      method: 'patch',
      url: `${ API_BASE_URL }/pins/${ pinId }`,
      body,
    })
  }

  /**
   * @description Permanently deletes a pin. This action cannot be undone. Returns a success status.
   *
   * @route DELETE /delete-pin
   * @operationName Delete Pin
   * @category Pins
   *
   * @paramDef {"type":"String","label":"Pin ID","name":"pinId","required":true,"description":"The id of the pin to delete."}
   *
   * @returns {Object}
   * @sampleResult {"status":"success"}
   */
  async deletePin(pinId) {
    if (!pinId) {
      throw new Error('"Pin ID" is required')
    }

    return this.#apiRequest({
      logTag: 'deletePin',
      method: 'delete',
      url: `${ API_BASE_URL }/pins/${ pinId }`,
    })
  }

  /**
   * @description Retrieves the pins owned by the connected account across all boards, paginated. Optionally filter to exclude native pins or return only promoted pins. Returns pin objects with a "bookmark" pagination token.
   *
   * @route GET /list-pins
   * @operationName List Pins
   * @category Pins
   *
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of pins to return per page. Range: 1-100. Default: 25."}
   * @paramDef {"type":"String","label":"Bookmark","name":"bookmark","description":"Pagination token returned as 'bookmark' in a previous response. Omit to retrieve the first page."}
   * @paramDef {"type":"String","label":"Pin Filter","name":"pinFilter","defaultValue":"All","uiComponent":{"type":"DROPDOWN","options":{"values":["All","Exclude Native","Has Been Promoted"]}},"description":"Optional filter. 'Exclude Native' omits pins created directly on Pinterest; 'Has Been Promoted' returns only promoted pins."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"813744123456","board_id":"549755885175","title":"Pasta","media":{"media_type":"image"}}],"bookmark":"Pz9QQ0YxT0M0d09EQXpNVEEw"}
   */
  async listPins(pageSize, bookmark, pinFilter) {
    return this.#apiRequest({
      logTag: 'listPins',
      url: `${ API_BASE_URL }/pins`,
      query: {
        page_size: pageSize || DEFAULT_PAGE_SIZE,
        bookmark: bookmark || undefined,
        pin_filter: this.#resolveChoice(pinFilter, PIN_FILTER_OPTIONS),
      },
    })
  }

  /**
   * @description Saves (repins) an existing pin to one of your boards, optionally into a specific section. This copies the pin to your board rather than creating new media. Returns the saved pin object.
   *
   * @route POST /save-pin-to-board
   * @operationName Save Pin to Board
   * @category Pins
   *
   * @paramDef {"type":"String","label":"Pin ID","name":"pinId","required":true,"description":"The id of the pin to save (repin)."}
   * @paramDef {"type":"String","label":"Board","name":"boardId","required":true,"dictionary":"getBoardsDictionary","description":"The board to save the pin to."}
   * @paramDef {"type":"String","label":"Section","name":"boardSectionId","dependsOn":["boardId"],"dictionary":"getBoardSectionsDictionary","description":"Optional board section to save the pin into. Choose the board first."}
   *
   * @returns {Object}
   * @sampleResult {"id":"813744999999","board_id":"549755885175","title":"Pasta","media":{"media_type":"image"}}
   */
  async savePinToBoard(pinId, boardId, boardSectionId) {
    if (!pinId) {
      throw new Error('"Pin ID" is required')
    }

    if (!boardId) {
      throw new Error('"Board" is required')
    }

    const body = cleanupObject({
      board_id: boardId,
      board_section_id: boardSectionId,
    })

    return this.#apiRequest({
      logTag: 'savePinToBoard',
      method: 'post',
      url: `${ API_BASE_URL }/pins/${ pinId }/save`,
      body,
    })
  }

  /**
   * @description Retrieves engagement analytics for a single pin over a date range (both dates required, YYYY-MM-DD, within the last 90 days). Select one or more metric types and an optional device/app breakdown. Returns daily and summary metric values. Note: analytics require a business account and Standard API access.
   *
   * @route GET /get-pin-analytics
   * @operationName Get Pin Analytics
   * @category Pins
   *
   * @paramDef {"type":"String","label":"Pin ID","name":"pinId","required":true,"description":"The id of the pin to retrieve analytics for."}
   * @paramDef {"type":"String","label":"Start Date","name":"startDate","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"The first day of the reporting window, in YYYY-MM-DD format. Must be within the last 90 days."}
   * @paramDef {"type":"String","label":"End Date","name":"endDate","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"The last day of the reporting window, in YYYY-MM-DD format. Must be on or after the start date."}
   * @paramDef {"type":"Array<String>","label":"Metric Types","name":"metricTypes","uiComponent":{"type":"DROPDOWN","options":{"values":["Impression","Save","Pin Click","Outbound Click","Video Views"]}},"description":"One or more metrics to report. When omitted, all available metrics are returned."}
   * @paramDef {"type":"String","label":"App Types","name":"appTypes","defaultValue":"All","uiComponent":{"type":"DROPDOWN","options":{"values":["All","Mobile","Tablet","Web"]}},"description":"Device/app breakdown for the metrics. Defaults to All."}
   *
   * @returns {Object}
   * @sampleResult {"all":{"summary_metrics":{"IMPRESSION":1200,"SAVE":34,"PIN_CLICK":21,"OUTBOUND_CLICK":9},"daily_metrics":[{"date":"2024-01-01","metrics":{"IMPRESSION":40}}]}}
   */
  async getPinAnalytics(pinId, startDate, endDate, metricTypes, appTypes) {
    if (!pinId) {
      throw new Error('"Pin ID" is required')
    }

    if (!startDate || !endDate) {
      throw new Error('"Start Date" and "End Date" are required')
    }

    const metrics = this.#mapChoiceList(metricTypes, PIN_METRIC_OPTIONS)

    return this.#apiRequest({
      logTag: 'getPinAnalytics',
      url: `${ API_BASE_URL }/pins/${ pinId }/analytics`,
      query: {
        start_date: startDate,
        end_date: endDate,
        metric_types: metrics.length ? metrics.join(',') : undefined,
        app_types: this.#resolveChoice(appTypes || 'All', APP_TYPE_OPTIONS),
      },
    })
  }

  /**
   * @description Creates a video pin on a board from a Flowrunner video file. This performs the full Pinterest video flow: it registers a media upload, uploads the video bytes to Pinterest's storage, waits for processing to succeed, then creates the pin using the processed media and a cover image. Requires a publicly accessible cover image URL. Note: video processing can take up to a couple of minutes.
   *
   * @route POST /create-video-pin
   * @operationName Create Video Pin
   * @category Pins
   * @executionTimeoutInSeconds 300
   *
   * @paramDef {"type":"String","label":"Board","name":"boardId","required":true,"dictionary":"getBoardsDictionary","description":"The board to create the video pin on."}
   * @paramDef {"type":"String","label":"Video File","name":"videoFileUrl","required":true,"uiComponent":{"type":"FILE_SELECTOR"},"description":"The Flowrunner video file to upload (its URL). Its bytes are streamed to Pinterest. Supported formats include MP4, MOV, and M4V."}
   * @paramDef {"type":"String","label":"Cover Image URL","name":"coverImageUrl","required":true,"description":"A publicly accessible image URL to use as the video's cover/thumbnail. Required by Pinterest for video pins."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"Optional pin title. Maximum 100 characters."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional pin description. Maximum 800 characters."}
   * @paramDef {"type":"String","label":"Link","name":"link","description":"Optional destination URL that the pin links to when clicked."}
   * @paramDef {"type":"String","label":"Alt Text","name":"altText","description":"Optional alternative text describing the video for accessibility."}
   * @paramDef {"type":"String","label":"Section","name":"boardSectionId","dependsOn":["boardId"],"dictionary":"getBoardSectionsDictionary","description":"Optional board section to place the pin in. Choose the board first."}
   *
   * @returns {Object}
   * @sampleResult {"id":"813744123456","board_id":"549755885175","title":"Product Demo","media":{"media_type":"video"}}
   */
  async createVideoPin(boardId, videoFileUrl, coverImageUrl, title, description, link, altText, boardSectionId) {
    if (!boardId) {
      throw new Error('"Board" is required')
    }

    if (!videoFileUrl) {
      throw new Error('"Video File" is required')
    }

    if (!coverImageUrl) {
      throw new Error('"Cover Image URL" is required')
    }

    // 1. Register a media upload to obtain the S3 upload target and required form fields.
    const registration = await this.#apiRequest({
      logTag: 'createVideoPin.register',
      method: 'post',
      url: `${ API_BASE_URL }/media`,
      body: { media_type: 'video' },
    })

    const mediaId = registration.media_id
    const uploadUrl = registration.upload_url
    const uploadParameters = registration.upload_parameters || {}

    if (!mediaId || !uploadUrl) {
      throw new Error('Pinterest did not return a valid media upload target')
    }

    // 2. Download the Flowrunner file bytes and POST them (multipart) to the provided upload URL.
    const videoBytes = toBuffer(await Flowrunner.Request.get(videoFileUrl).setEncoding(null))

    const formData = new Flowrunner.Request.FormData()

    // The signed upload_parameters fields MUST be appended before the file part.
    Object.keys(uploadParameters).forEach(key => {
      formData.append(key, String(uploadParameters[key]))
    })

    formData.append('file', videoBytes, { filename: `video_${ Date.now() }.mp4` })

    try {
      await Flowrunner.Request.post(uploadUrl).form(formData)
    } catch (error) {
      const message = error.body?.message || error.message

      logger.error(`createVideoPin.upload - failed: ${ message }`)

      throw new Error(`Pinterest video upload failed: ${ message }`)
    }

    // 3. Poll the media status until Pinterest reports it as succeeded.
    await this.#waitForMediaSucceeded(mediaId)

    // 4. Create the pin referencing the processed media.
    const body = cleanupObject({
      board_id: boardId,
      board_section_id: boardSectionId,
      title,
      description,
      link,
      alt_text: altText,
      media_source: {
        source_type: 'video_id',
        media_id: mediaId,
        cover_image_url: coverImageUrl,
      },
    })

    return this.#apiRequest({
      logTag: 'createVideoPin.create',
      method: 'post',
      url: `${ API_BASE_URL }/pins`,
      body,
    })
  }

  // Polls GET /media/{id} until status is 'succeeded', throwing on failure or timeout.
  async #waitForMediaSucceeded(mediaId) {
    for (let attempt = 0; attempt < MEDIA_POLL_ATTEMPTS; attempt++) {
      const status = await this.#apiRequest({
        logTag: 'createVideoPin.status',
        url: `${ API_BASE_URL }/media/${ mediaId }`,
      })

      const state = status.status

      if (state === 'succeeded') {
        return status
      }

      if (state === 'failed') {
        throw new Error('Pinterest reported that video processing failed')
      }

      await sleep(MEDIA_POLL_INTERVAL_MS)
    }

    throw new Error('Timed out waiting for Pinterest to finish processing the video')
  }

  // ============================================= SEARCH ==============================================

  /**
   * @description Searches the connected account's own pins by keyword, paginated. On Trial API access, search is limited to your own content. Returns matching pin objects with a "bookmark" pagination token.
   *
   * @route GET /search-my-pins
   * @operationName Search My Pins
   * @category Search
   *
   * @paramDef {"type":"String","label":"Query","name":"query","required":true,"description":"The keyword(s) to search your pins for."}
   * @paramDef {"type":"String","label":"Bookmark","name":"bookmark","description":"Pagination token returned as 'bookmark' in a previous response. Omit to retrieve the first page."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"813744123456","board_id":"549755885175","title":"Pasta","media":{"media_type":"image"}}],"bookmark":"Pz9QQ0YxT0M0d09EQXpNVEEw"}
   */
  async searchMyPins(query, bookmark) {
    if (!query) {
      throw new Error('"Query" is required')
    }

    return this.#apiRequest({
      logTag: 'searchMyPins',
      url: `${ API_BASE_URL }/search/pins`,
      query: {
        query,
        bookmark: bookmark || undefined,
      },
    })
  }

  /**
   * @description Searches the connected account's own boards by keyword, paginated. On Trial API access, search is limited to your own content. Returns matching board objects with a "bookmark" pagination token.
   *
   * @route GET /search-my-boards
   * @operationName Search My Boards
   * @category Search
   *
   * @paramDef {"type":"String","label":"Query","name":"query","required":true,"description":"The keyword(s) to search your boards for."}
   * @paramDef {"type":"String","label":"Bookmark","name":"bookmark","description":"Pagination token returned as 'bookmark' in a previous response. Omit to retrieve the first page."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"549755885175","name":"Recipes","privacy":"PUBLIC","pin_count":42}],"bookmark":"Pz9QQ0YxT0M0d09EQXpNVEEw"}
   */
  async searchMyBoards(query, bookmark) {
    if (!query) {
      throw new Error('"Query" is required')
    }

    return this.#apiRequest({
      logTag: 'searchMyBoards',
      url: `${ API_BASE_URL }/search/boards`,
      query: {
        query,
        bookmark: bookmark || undefined,
      },
    })
  }

  // ============================================== MEDIA ==============================================

  /**
   * @description Registers a media upload for a video pin and returns the upload target. The response includes a media_id, an upload_url, and the signed upload_parameters that must be submitted with the video file. After uploading the bytes to the upload_url, poll "Get Media Upload Status" until it succeeds, then create a pin with the media_id. For most cases, prefer "Create Video Pin", which performs this entire flow automatically.
   *
   * @route POST /register-media-upload
   * @operationName Register Media Upload
   * @category Media
   *
   * @returns {Object}
   * @sampleResult {"media_id":"1234567890","media_type":"video","upload_url":"https://pinterest-media-upload.s3.amazonaws.com/","upload_parameters":{"x-amz-signature":"abc","x-amz-date":"20240101T000000Z","key":"videos/1234567890"}}
   */
  async registerMediaUpload() {
    return this.#apiRequest({
      logTag: 'registerMediaUpload',
      method: 'post',
      url: `${ API_BASE_URL }/media`,
      body: { media_type: 'video' },
    })
  }

  /**
   * @description Retrieves the processing status of a registered media upload by its media id. The status field is 'registered', 'processing', 'succeeded', or 'failed'. Use this to confirm a video is ready before creating a pin with it.
   *
   * @route GET /get-media-upload-status
   * @operationName Get Media Upload Status
   * @category Media
   *
   * @paramDef {"type":"String","label":"Media ID","name":"mediaId","required":true,"description":"The media id returned by 'Register Media Upload'."}
   *
   * @returns {Object}
   * @sampleResult {"media_id":"1234567890","media_type":"video","status":"succeeded"}
   */
  async getMediaUploadStatus(mediaId) {
    if (!mediaId) {
      throw new Error('"Media ID" is required')
    }

    return this.#apiRequest({
      logTag: 'getMediaUploadStatus',
      url: `${ API_BASE_URL }/media/${ mediaId }`,
    })
  }
}

Flowrunner.ServerCode.addService(PinterestService, [
  {
    displayName: 'Client Id',
    defaultValue: '',
    name: 'clientId',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'The App ID of your Pinterest app from https://developers.pinterest.com/apps.',
  },
  {
    displayName: 'Client Secret',
    defaultValue: '',
    name: 'clientSecret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'The App secret of your Pinterest app from https://developers.pinterest.com/apps.',
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

// Some runtimes hand back the decoded body as an object/string despite .setEncoding(null);
// Buffer.from() normalizes those cases while leaving real Buffers untouched.
function toBuffer(data) {
  if (Buffer.isBuffer(data)) {
    return data
  }

  if (data instanceof ArrayBuffer) {
    return Buffer.from(data)
  }

  return Buffer.from(typeof data === 'string' ? data : JSON.stringify(data))
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
