const logger = {
  info: (...args) => console.log('[Confluence] info:', ...args),
  debug: (...args) => console.log('[Confluence] debug:', ...args),
  error: (...args) => console.log('[Confluence] error:', ...args),
  warn: (...args) => console.log('[Confluence] warn:', ...args),
}

const AUTH_BASE_URL = 'https://auth.atlassian.com'
const ATLASSIAN_API_BASE = 'https://api.atlassian.com'
const ACCESSIBLE_RESOURCES_URL = `${ ATLASSIAN_API_BASE }/oauth/token/accessible-resources`

// Confluence classic (current) OAuth 2.0 (3LO) scopes.
// readonly:content.attachment:confluence is required by the v1 attachment download endpoint.
// docs: https://developer.atlassian.com/cloud/confluence/scopes-for-oauth-2-3LO-and-forge-apps/
const SCOPE_LIST = [
  'read:confluence-content.all',
  'write:confluence-content',
  'read:confluence-space.summary',
  'write:confluence-space',
  'search:confluence',
  'read:confluence-user',
  'readonly:content.attachment:confluence',
  'offline_access',
]

const SCOPE_STRING = SCOPE_LIST.join(' ')

// Friendly dropdown label -> Confluence API value mappings.
const CHOICE_MAPS = {
  spaceType: { 'Global': 'global', 'Personal': 'personal' },
  spaceStatus: { 'Current': 'current', 'Archived': 'archived' },
  spaceSort: {
    'Name (A-Z)': 'name',
    'Name (Z-A)': '-name',
    'Key (A-Z)': 'key',
    'Key (Z-A)': '-key',
    'ID (Ascending)': 'id',
    'ID (Descending)': '-id',
  },
  spaceDescriptionFormat: { 'Plain': 'plain', 'View': 'view' },
  contentStatus: { 'Current': 'current', 'Archived': 'archived', 'Deleted': 'deleted', 'Trashed': 'trashed' },
  contentSort: {
    'Title (A-Z)': 'title',
    'Title (Z-A)': '-title',
    'Created (Newest First)': '-created-date',
    'Created (Oldest First)': 'created-date',
    'Modified (Newest First)': '-modified-date',
    'Modified (Oldest First)': 'modified-date',
    'ID (Ascending)': 'id',
    'ID (Descending)': '-id',
  },
  editStatus: { 'Current': 'current', 'Draft': 'draft' },
  bodyFormat: { 'Storage': 'storage', 'Atlas Doc Format': 'atlas_doc_format', 'View': 'view' },
  commentRepresentation: { 'Storage': 'storage', 'Atlas Doc Format': 'atlas_doc_format', 'Wiki': 'wiki' },
  labelPrefix: { 'Global': 'global', 'My': 'my', 'Team': 'team', 'System': 'system' },
  searchType: { 'Page': 'page', 'Blog Post': 'blogpost', 'Comment': 'comment', 'Attachment': 'attachment', 'Space': 'space' },
}

/**
 * @usesFileStorage
 * @requireOAuth
 * @integrationName Confluence
 * @integrationIcon /icon.svg
 */
class Confluence {
  constructor(config) {
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
  }

  // ==========================================================================
  //  CORE — every Confluence API call goes through #apiRequest
  // ==========================================================================
  async #apiRequest({ path, method, body, query, logTag }) {
    method = method || 'get'

    const baseUrl = await this.#getBaseUrl()
    const url = `${ baseUrl }${ path }`

    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=[${ JSON.stringify(query) }]`)

      const request = Flowrunner.Request[method](url)
        .set({
          'Authorization': `Bearer ${ this.#getAccessToken() }`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        })
        .query(query || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      this.#handleError(error, logTag)
    }
  }

  #handleError(error, logTag) {
    const v2Error = error?.body?.errors?.[0]
    const apiMessage =
      (v2Error && (v2Error.title || v2Error.detail)) ||
      error?.body?.message ||
      error?.message ||
      'Request failed'

    logger.error(`${ logTag } - failed: ${ apiMessage }`)

    throw new Error(`Confluence API error: ${ apiMessage }`)
  }

  #getAccessToken() {
    return this.request.headers['oauth-access-token']
  }

  // Resolves the Confluence Cloud site (cloudId) available to the current token.
  async #findConfluenceSite(accessToken) {
    let resources

    try {
      resources = await Flowrunner.Request.get(ACCESSIBLE_RESOURCES_URL)
        .set({ 'Authorization': `Bearer ${ accessToken }`, 'Accept': 'application/json' })
    } catch (error) {
      logger.error(`findConfluenceSite - accessible-resources lookup failed: ${ error.message }`)

      throw new Error(`Confluence API error: could not resolve the Confluence Cloud site (${ error.message })`)
    }

    const sites = Array.isArray(resources) ? resources : []
    const site = sites.find(resource => (resource.scopes || []).some(scope => scope.includes('confluence'))) || sites[0]

    if (!site) {
      throw new Error('No accessible Confluence Cloud site found for this connection. Make sure the authorized Atlassian account has access to a Confluence site.')
    }

    return site
  }

  // Base URL for all Confluence API calls: https://api.atlassian.com/ex/confluence/{cloudId}
  async #getBaseUrl() {
    if (!this.baseUrl) {
      const site = await this.#findConfluenceSite(this.#getAccessToken())

      this.cloudId = site.id
      this.baseUrl = `${ ATLASSIAN_API_BASE }/ex/confluence/${ site.id }`
    }

    return this.baseUrl
  }

  // Maps a friendly dropdown label to its Confluence API value. Unmapped values pass through unchanged.
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null || value === '') return undefined

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // Extracts the `cursor` query value from a v2 response's _links.next, or null when there is no next page.
  #extractCursor(response) {
    const next = response?._links?.next

    if (!next) return null

    const match = /[?&]cursor=([^&]+)/.exec(next)

    return match ? decodeURIComponent(match[1]) : null
  }

  // Normalize a downloaded file body to a Buffer. Flowrunner.Request auto-parses
  // responses by Content-Type, so JSON/text sources come back parsed even with
  // .setEncoding(null); re-serialize anything that is not already a Buffer.
  #toBuffer(body) {
    if (Buffer.isBuffer(body)) return body
    if (typeof body === 'string') return Buffer.from(body)

    return Buffer.from(JSON.stringify(body))
  }

  // Escapes a value for interpolation into a quoted CQL string literal.
  #escapeCql(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  }

  // ==========================================================================
  //  OAUTH2 SYSTEM METHODS
  // ==========================================================================
  /**
   * @registerAs SYSTEM
   * @route GET /getOAuth2ConnectionURL
   */
  async getOAuth2ConnectionURL() {
    // docs: https://developer.atlassian.com/cloud/confluence/oauth-2-3lo-apps/
    // redirect_uri and state are injected by the FlowRunner platform — do not append them here.
    const params = new URLSearchParams({
      audience: 'api.atlassian.com',
      client_id: this.clientId,
      scope: SCOPE_STRING,
      response_type: 'code',
      prompt: 'consent',
    })

    return `${ AUTH_BASE_URL }/authorize?${ params.toString() }`
  }

  /**
   * @registerAs SYSTEM
   * @route POST /executeCallback
   * @param {Object} callbackObject
   */
  async executeCallback(callbackObject) {
    const tokenResponse = await Flowrunner.Request.post(`${ AUTH_BASE_URL }/oauth/token`)
      .set({ 'Content-Type': 'application/json' })
      .send({
        grant_type: 'authorization_code',
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code: callbackObject.code,
        redirect_uri: callbackObject.redirectURI,
      })

    const site = await this.#findConfluenceSite(tokenResponse.access_token)

    let connectionIdentityName = site.name || site.url || 'Confluence Cloud'
    let connectionIdentityImageURL = site.avatarUrl || null

    try {
      const user = await Flowrunner.Request
        .get(`${ ATLASSIAN_API_BASE }/ex/confluence/${ site.id }/wiki/rest/api/user/current`)
        .set({ 'Authorization': `Bearer ${ tokenResponse.access_token }`, 'Accept': 'application/json' })

      if (user?.displayName || user?.publicName) {
        connectionIdentityName = `${ user.displayName || user.publicName } (${ site.name || site.url })`
      }

      if (user?.profilePicture?.path) {
        connectionIdentityImageURL = `${ site.url }${ user.profilePicture.path }`
      }
    } catch (error) {
      logger.warn(`executeCallback - could not load current user for connection identity: ${ error.message }`)
    }

    return {
      token: tokenResponse.access_token,
      expirationInSeconds: tokenResponse.expires_in,
      refreshToken: tokenResponse.refresh_token,
      connectionIdentityName,
      connectionIdentityImageURL,
      overwrite: true,
    }
  }

  /**
   * @registerAs SYSTEM
   * @route PUT /refreshToken
   * @param {String} refreshToken
   */
  async refreshToken(refreshToken) {
    // Atlassian uses rotating refresh tokens — always return the newest one.
    const tokenResponse = await Flowrunner.Request.post(`${ AUTH_BASE_URL }/oauth/token`)
      .set({ 'Content-Type': 'application/json' })
      .send({
        grant_type: 'refresh_token',
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: refreshToken,
      })

    return {
      token: tokenResponse.access_token,
      expirationInSeconds: tokenResponse.expires_in,
      refreshToken: tokenResponse.refresh_token || refreshToken,
    }
  }

  // ==========================================================================
  //  SPACES
  // ==========================================================================
  /**
   * @operationName List Spaces
   * @category Spaces
   * @description Lists the Confluence spaces the connected account can see, with optional type (global/personal) and status (current/archived) filters. Results are cursor-paginated: pass the returned nextCursor back into Cursor to fetch the next page. Returns up to 250 spaces per page (default 25).
   * @route GET /list-spaces
   *
   * @paramDef {"type":"String","label":"Type","name":"type","uiComponent":{"type":"DROPDOWN","options":{"values":["Global","Personal"]}},"description":"Filter by space type. Global spaces are shared team/site spaces; Personal spaces belong to individual users. Leave empty for all types."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Current","Archived"]}},"description":"Filter by space status. Current returns active spaces, Archived returns archived spaces. Leave empty for all."}
   * @paramDef {"type":"String","label":"Sort By","name":"sort","uiComponent":{"type":"DROPDOWN","options":{"values":["Name (A-Z)","Name (Z-A)","Key (A-Z)","Key (Z-A)","ID (Ascending)","ID (Descending)"]}},"description":"Order of the returned spaces. Leave empty for the API default (by ID)."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of spaces to return per page (1-250, default 25)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Opaque pagination cursor from a previous call's nextCursor. Leave empty for the first page."}
   *
   * @returns {Object}
   * @sampleResult {"results":[{"id":"67890","key":"DOCS","name":"Documentation","type":"global","status":"current","homepageId":"12345","authorId":"5b10ac8d82e05b22cc7d4ef5","createdAt":"2024-01-10T08:00:00.000Z","_links":{"webui":"/spaces/DOCS"}}],"nextCursor":"eyJpZCI6Njc4OTB9"}
   */
  async listSpaces(type, status, sort, limit, cursor) {
    const query = {}

    if (type) query.type = this.#resolveChoice(type, CHOICE_MAPS.spaceType)
    if (status) query.status = this.#resolveChoice(status, CHOICE_MAPS.spaceStatus)
    if (sort) query.sort = this.#resolveChoice(sort, CHOICE_MAPS.spaceSort)
    if (limit !== undefined && limit !== null) query.limit = limit
    if (cursor) query.cursor = cursor

    const response = await this.#apiRequest({
      logTag: 'listSpaces',
      path: '/wiki/api/v2/spaces',
      query,
    })

    return { results: response.results || [], nextCursor: this.#extractCursor(response) }
  }

  /**
   * @operationName Get Space
   * @category Spaces
   * @description Retrieves a single Confluence space by its ID, including key, name, type, status, and homepage ID. Optionally includes the space description in plain text or rendered view format.
   * @route GET /get-space
   *
   * @paramDef {"type":"String","label":"Space","name":"spaceId","required":true,"dictionary":"getSpacesDictionary","description":"The space to retrieve. Pick from the list or provide a numeric space ID."}
   * @paramDef {"type":"String","label":"Description Format","name":"descriptionFormat","uiComponent":{"type":"DROPDOWN","options":{"values":["Plain","View"]}},"description":"Include the space description in this format: Plain (plain text) or View (rendered HTML). Leave empty to omit the description."}
   *
   * @returns {Object}
   * @sampleResult {"id":"67890","key":"DOCS","name":"Documentation","type":"global","status":"current","homepageId":"12345","authorId":"5b10ac8d82e05b22cc7d4ef5","createdAt":"2024-01-10T08:00:00.000Z","description":{"plain":{"representation":"plain","value":"Team documentation space"}},"_links":{"webui":"/spaces/DOCS"}}
   */
  async getSpace(spaceId, descriptionFormat) {
    const query = {}

    if (descriptionFormat) {
      query['description-format'] = this.#resolveChoice(descriptionFormat, CHOICE_MAPS.spaceDescriptionFormat)
    }

    return await this.#apiRequest({
      logTag: 'getSpace',
      path: `/wiki/api/v2/spaces/${ spaceId }`,
      query,
    })
  }

  // ==========================================================================
  //  PAGES
  // ==========================================================================
  /**
   * @operationName List Pages
   * @category Pages
   * @description Lists pages across the whole Confluence site with optional space, status, and exact-title filters. Results are cursor-paginated: pass the returned nextCursor back into Cursor for the next page. Returns up to 250 pages per page (default 25). Page bodies are not included — use Get Page to fetch content.
   * @route GET /list-pages
   *
   * @paramDef {"type":"String","label":"Space","name":"spaceId","dictionary":"getSpacesDictionary","description":"Only return pages from this space. Leave empty to list pages from all spaces."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Current","Archived","Deleted","Trashed"]}},"description":"Filter by page status. Current is the published state; Trashed pages are in the trash; Deleted pages are purged drafts. Leave empty for current pages."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"Only return pages whose title exactly matches this value (case-sensitive). For fuzzy matching use Search Content (CQL)."}
   * @paramDef {"type":"String","label":"Sort By","name":"sort","uiComponent":{"type":"DROPDOWN","options":{"values":["Title (A-Z)","Title (Z-A)","Created (Newest First)","Created (Oldest First)","Modified (Newest First)","Modified (Oldest First)","ID (Ascending)","ID (Descending)"]}},"description":"Order of the returned pages. Leave empty for the API default (by ID)."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of pages to return per page (1-250, default 25)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Opaque pagination cursor from a previous call's nextCursor. Leave empty for the first page."}
   *
   * @returns {Object}
   * @sampleResult {"results":[{"id":"12345","status":"current","title":"Release Notes","spaceId":"67890","parentId":"11111","authorId":"5b10ac8d82e05b22cc7d4ef5","createdAt":"2024-01-15T09:30:00.000Z","version":{"number":3,"createdAt":"2024-02-01T10:00:00.000Z"},"_links":{"webui":"/spaces/DOCS/pages/12345/Release+Notes"}}],"nextCursor":"eyJpZCI6MTIzNDV9"}
   */
  async listPages(spaceId, status, title, sort, limit, cursor) {
    const query = {}

    if (spaceId) query['space-id'] = String(spaceId)
    if (status) query.status = this.#resolveChoice(status, CHOICE_MAPS.contentStatus)
    if (title) query.title = title
    if (sort) query.sort = this.#resolveChoice(sort, CHOICE_MAPS.contentSort)
    if (limit !== undefined && limit !== null) query.limit = limit
    if (cursor) query.cursor = cursor

    const response = await this.#apiRequest({
      logTag: 'listPages',
      path: '/wiki/api/v2/pages',
      query,
    })

    return { results: response.results || [], nextCursor: this.#extractCursor(response) }
  }

  /**
   * @operationName Get Page
   * @category Pages
   * @description Retrieves a single Confluence page by its ID, including title, status, space, parent, version, and the page body. Choose the body format: Storage (XHTML source, editable), Atlas Doc Format (ADF JSON), or View (rendered HTML).
   * @route GET /get-page
   *
   * @paramDef {"type":"String","label":"Page","name":"pageId","required":true,"dictionary":"getPagesDictionary","description":"The page to retrieve. Pick from the list or provide a numeric page ID."}
   * @paramDef {"type":"String","label":"Body Format","name":"bodyFormat","defaultValue":"Storage","uiComponent":{"type":"DROPDOWN","options":{"values":["Storage","Atlas Doc Format","View"]}},"description":"Format of the returned page body. Storage is Confluence's editable XHTML source, Atlas Doc Format is ADF JSON, View is rendered HTML."}
   *
   * @returns {Object}
   * @sampleResult {"id":"12345","status":"current","title":"Release Notes","spaceId":"67890","parentId":"11111","authorId":"5b10ac8d82e05b22cc7d4ef5","createdAt":"2024-01-15T09:30:00.000Z","version":{"number":3,"message":"Updated intro","createdAt":"2024-02-01T10:00:00.000Z"},"body":{"storage":{"representation":"storage","value":"<p>Latest release notes</p>"}},"_links":{"webui":"/spaces/DOCS/pages/12345/Release+Notes"}}
   */
  async getPage(pageId, bodyFormat) {
    const query = {
      'body-format': this.#resolveChoice(bodyFormat, CHOICE_MAPS.bodyFormat) || 'storage',
    }

    return await this.#apiRequest({
      logTag: 'getPage',
      path: `/wiki/api/v2/pages/${ pageId }`,
      query,
    })
  }

  /**
   * @operationName Get Pages in Space
   * @category Pages
   * @description Lists all pages that belong to a specific Confluence space, with optional status filter and sorting. Results are cursor-paginated: pass the returned nextCursor back into Cursor for the next page. Returns up to 250 pages per page (default 25).
   * @route GET /get-pages-in-space
   *
   * @paramDef {"type":"String","label":"Space","name":"spaceId","required":true,"dictionary":"getSpacesDictionary","description":"The space whose pages to list. Pick from the list or provide a numeric space ID."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Current","Archived","Deleted","Trashed"]}},"description":"Filter by page status. Leave empty for current pages."}
   * @paramDef {"type":"String","label":"Sort By","name":"sort","uiComponent":{"type":"DROPDOWN","options":{"values":["Title (A-Z)","Title (Z-A)","Created (Newest First)","Created (Oldest First)","Modified (Newest First)","Modified (Oldest First)","ID (Ascending)","ID (Descending)"]}},"description":"Order of the returned pages. Leave empty for the API default (by ID)."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of pages to return per page (1-250, default 25)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Opaque pagination cursor from a previous call's nextCursor. Leave empty for the first page."}
   *
   * @returns {Object}
   * @sampleResult {"results":[{"id":"12345","status":"current","title":"Release Notes","spaceId":"67890","parentId":null,"authorId":"5b10ac8d82e05b22cc7d4ef5","createdAt":"2024-01-15T09:30:00.000Z","version":{"number":3},"_links":{"webui":"/spaces/DOCS/pages/12345/Release+Notes"}}],"nextCursor":null}
   */
  async getPagesInSpace(spaceId, status, sort, limit, cursor) {
    const query = {}

    if (status) query.status = this.#resolveChoice(status, CHOICE_MAPS.contentStatus)
    if (sort) query.sort = this.#resolveChoice(sort, CHOICE_MAPS.contentSort)
    if (limit !== undefined && limit !== null) query.limit = limit
    if (cursor) query.cursor = cursor

    const response = await this.#apiRequest({
      logTag: 'getPagesInSpace',
      path: `/wiki/api/v2/spaces/${ spaceId }/pages`,
      query,
    })

    return { results: response.results || [], nextCursor: this.#extractCursor(response) }
  }

  /**
   * @operationName Get Child Pages
   * @category Pages
   * @description Lists the direct child pages of a Confluence page (one level down; it does not recurse into grandchildren). Useful for walking a page tree. Results are cursor-paginated: pass the returned nextCursor back into Cursor for the next page.
   * @route GET /get-child-pages
   *
   * @paramDef {"type":"String","label":"Parent Page","name":"pageId","required":true,"dictionary":"getPagesDictionary","description":"The page whose direct children to list. Pick from the list or provide a numeric page ID."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of child pages to return per page (1-250, default 25)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Opaque pagination cursor from a previous call's nextCursor. Leave empty for the first page."}
   *
   * @returns {Object}
   * @sampleResult {"results":[{"id":"22222","status":"current","title":"Installation Guide","spaceId":"67890","childPosition":1}],"nextCursor":null}
   */
  async getChildPages(pageId, limit, cursor) {
    const query = {}

    if (limit !== undefined && limit !== null) query.limit = limit
    if (cursor) query.cursor = cursor

    const response = await this.#apiRequest({
      logTag: 'getChildPages',
      path: `/wiki/api/v2/pages/${ pageId }/children`,
      query,
    })

    return { results: response.results || [], nextCursor: this.#extractCursor(response) }
  }

  /**
   * @operationName Create Page
   * @category Pages
   * @description Creates a new page in a Confluence space, optionally nested under a parent page. The body uses Confluence storage format (XHTML) — simple HTML like <p>, <h1>, <ul>, <table>, <a> works directly. Create as Current (published) or Draft.
   * @route POST /create-page
   *
   * @paramDef {"type":"String","label":"Space","name":"spaceId","required":true,"dictionary":"getSpacesDictionary","description":"The space to create the page in. Pick from the list or provide a numeric space ID."}
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"Title of the new page. Must be unique within the space."}
   * @paramDef {"type":"String","label":"Body","name":"body","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Page content in Confluence storage format (XHTML). Simple HTML works, e.g. <h2>Overview</h2><p>Hello <strong>world</strong></p>. Leave empty to create a blank page."}
   * @paramDef {"type":"String","label":"Parent Page","name":"parentId","dictionary":"getPagesDictionary","dependsOn":["spaceId"],"description":"Optional parent page to nest the new page under. Leave empty to create the page at the space's root."}
   * @paramDef {"type":"String","label":"Status","name":"status","defaultValue":"Current","uiComponent":{"type":"DROPDOWN","options":{"values":["Current","Draft"]}},"description":"Current publishes the page immediately; Draft creates an unpublished draft."}
   *
   * @returns {Object}
   * @sampleResult {"id":"33333","status":"current","title":"New Page","spaceId":"67890","parentId":"12345","authorId":"5b10ac8d82e05b22cc7d4ef5","createdAt":"2024-03-01T12:00:00.000Z","version":{"number":1},"_links":{"webui":"/spaces/DOCS/pages/33333/New+Page"}}
   */
  async createPage(spaceId, title, body, parentId, status) {
    const requestBody = {
      spaceId: String(spaceId),
      status: this.#resolveChoice(status, CHOICE_MAPS.editStatus) || 'current',
      title,
      ...(parentId && { parentId: String(parentId) }),
      ...(body && { body: { representation: 'storage', value: body } }),
    }

    return await this.#apiRequest({
      logTag: 'createPage',
      path: '/wiki/api/v2/pages',
      method: 'post',
      body: requestBody,
    })
  }

  /**
   * @operationName Update Page
   * @category Pages
   * @description Updates a Confluence page's title, body, and/or status. Only pass the fields you want to change — the action first fetches the current page, merges your changes, and automatically increments the version number as Confluence requires. The body uses storage format (XHTML); simple HTML works.
   * @route PUT /update-page
   *
   * @paramDef {"type":"String","label":"Page","name":"pageId","required":true,"dictionary":"getPagesDictionary","description":"The page to update. Pick from the list or provide a numeric page ID."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"New title for the page. Leave empty to keep the current title."}
   * @paramDef {"type":"String","label":"Body","name":"body","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New page content in Confluence storage format (XHTML) — this REPLACES the entire existing body. Leave empty to keep the current content."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Current","Draft"]}},"description":"New status for the page. Leave empty to keep the current status."}
   * @paramDef {"type":"String","label":"Version Message","name":"versionMessage","description":"Optional note describing the change, shown in the page's version history."}
   *
   * @returns {Object}
   * @sampleResult {"id":"12345","status":"current","title":"Release Notes","spaceId":"67890","authorId":"5b10ac8d82e05b22cc7d4ef5","version":{"number":4,"message":"Updated via FlowRunner","createdAt":"2024-03-02T09:00:00.000Z"},"body":{"storage":{"representation":"storage","value":"<p>Updated content</p>"}},"_links":{"webui":"/spaces/DOCS/pages/12345/Release+Notes"}}
   */
  async updatePage(pageId, title, body, status, versionMessage) {
    const current = await this.#apiRequest({
      logTag: 'updatePage:fetchCurrent',
      path: `/wiki/api/v2/pages/${ pageId }`,
      query: { 'body-format': 'storage' },
    })

    const requestBody = {
      id: String(pageId),
      status: this.#resolveChoice(status, CHOICE_MAPS.editStatus) || current.status,
      title: title || current.title,
      body: {
        representation: 'storage',
        value: body !== undefined && body !== null && body !== '' ? body : (current.body?.storage?.value || ''),
      },
      version: {
        number: (current.version?.number || 0) + 1,
        message: versionMessage || '',
      },
    }

    return await this.#apiRequest({
      logTag: 'updatePage',
      path: `/wiki/api/v2/pages/${ pageId }`,
      method: 'put',
      body: requestBody,
    })
  }

  /**
   * @operationName Delete Page
   * @category Pages
   * @description Deletes a Confluence page. By default the page is moved to the trash (recoverable). Turn on Purge to permanently remove a page that is already in the trash, or Draft to delete a draft page instead of a published one.
   * @route DELETE /delete-page
   *
   * @paramDef {"type":"String","label":"Page","name":"pageId","required":true,"dictionary":"getPagesDictionary","description":"The page to delete. Pick from the list or provide a numeric page ID."}
   * @paramDef {"type":"Boolean","label":"Delete Draft","name":"draft","uiComponent":{"type":"TOGGLE"},"defaultValue":false,"description":"Turn on to delete the draft version of the page instead of the published page."}
   * @paramDef {"type":"Boolean","label":"Purge Permanently","name":"purge","uiComponent":{"type":"TOGGLE"},"defaultValue":false,"description":"Turn on to permanently purge a page that is already in the trash. This cannot be undone."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async deletePage(pageId, draft, purge) {
    const query = {}

    if (draft) query.draft = 'true'
    if (purge) query.purge = 'true'

    await this.#apiRequest({
      logTag: 'deletePage',
      path: `/wiki/api/v2/pages/${ pageId }`,
      method: 'delete',
      query,
    })

    return { success: true }
  }

  // ==========================================================================
  //  BLOG POSTS
  // ==========================================================================
  /**
   * @operationName List Blog Posts
   * @category Blog Posts
   * @description Lists blog posts across the Confluence site with optional space and status filters. Results are cursor-paginated: pass the returned nextCursor back into Cursor for the next page. Returns up to 250 blog posts per page (default 25). Bodies are not included — use Get Blog Post for content.
   * @route GET /list-blog-posts
   *
   * @paramDef {"type":"String","label":"Space","name":"spaceId","dictionary":"getSpacesDictionary","description":"Only return blog posts from this space. Leave empty to list blog posts from all spaces."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Current","Deleted","Trashed"]}},"description":"Filter by blog post status. Leave empty for current blog posts."}
   * @paramDef {"type":"String","label":"Sort By","name":"sort","uiComponent":{"type":"DROPDOWN","options":{"values":["Title (A-Z)","Title (Z-A)","Created (Newest First)","Created (Oldest First)","Modified (Newest First)","Modified (Oldest First)","ID (Ascending)","ID (Descending)"]}},"description":"Order of the returned blog posts. Leave empty for the API default (by ID)."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of blog posts to return per page (1-250, default 25)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Opaque pagination cursor from a previous call's nextCursor. Leave empty for the first page."}
   *
   * @returns {Object}
   * @sampleResult {"results":[{"id":"55555","status":"current","title":"Team Update — March","spaceId":"67890","authorId":"5b10ac8d82e05b22cc7d4ef5","createdAt":"2024-03-01T12:00:00.000Z","version":{"number":1},"_links":{"webui":"/spaces/DOCS/blog/2024/03/01/55555"}}],"nextCursor":null}
   */
  async listBlogPosts(spaceId, status, sort, limit, cursor) {
    const query = {}

    if (spaceId) query['space-id'] = String(spaceId)
    if (status) query.status = this.#resolveChoice(status, CHOICE_MAPS.contentStatus)
    if (sort) query.sort = this.#resolveChoice(sort, CHOICE_MAPS.contentSort)
    if (limit !== undefined && limit !== null) query.limit = limit
    if (cursor) query.cursor = cursor

    const response = await this.#apiRequest({
      logTag: 'listBlogPosts',
      path: '/wiki/api/v2/blogposts',
      query,
    })

    return { results: response.results || [], nextCursor: this.#extractCursor(response) }
  }

  /**
   * @operationName Get Blog Post
   * @category Blog Posts
   * @description Retrieves a single Confluence blog post by its ID, including title, status, space, version, and the post body in the chosen format (Storage XHTML, Atlas Doc Format JSON, or rendered View HTML).
   * @route GET /get-blog-post
   *
   * @paramDef {"type":"String","label":"Blog Post ID","name":"blogPostId","required":true,"description":"The numeric ID of the blog post to retrieve (e.g. from List Blog Posts or Search Content)."}
   * @paramDef {"type":"String","label":"Body Format","name":"bodyFormat","defaultValue":"Storage","uiComponent":{"type":"DROPDOWN","options":{"values":["Storage","Atlas Doc Format","View"]}},"description":"Format of the returned blog post body. Storage is editable XHTML source, Atlas Doc Format is ADF JSON, View is rendered HTML."}
   *
   * @returns {Object}
   * @sampleResult {"id":"55555","status":"current","title":"Team Update — March","spaceId":"67890","authorId":"5b10ac8d82e05b22cc7d4ef5","createdAt":"2024-03-01T12:00:00.000Z","version":{"number":1},"body":{"storage":{"representation":"storage","value":"<p>This month we shipped...</p>"}},"_links":{"webui":"/spaces/DOCS/blog/2024/03/01/55555"}}
   */
  async getBlogPost(blogPostId, bodyFormat) {
    const query = {
      'body-format': this.#resolveChoice(bodyFormat, CHOICE_MAPS.bodyFormat) || 'storage',
    }

    return await this.#apiRequest({
      logTag: 'getBlogPost',
      path: `/wiki/api/v2/blogposts/${ blogPostId }`,
      query,
    })
  }

  /**
   * @operationName Create Blog Post
   * @category Blog Posts
   * @description Creates a new blog post in a Confluence space. The body uses Confluence storage format (XHTML) — simple HTML like <p>, <h2>, <ul> works directly. Create as Current (published, dated today) or Draft.
   * @route POST /create-blog-post
   *
   * @paramDef {"type":"String","label":"Space","name":"spaceId","required":true,"dictionary":"getSpacesDictionary","description":"The space to create the blog post in. Pick from the list or provide a numeric space ID."}
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"Title of the new blog post."}
   * @paramDef {"type":"String","label":"Body","name":"body","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Blog post content in Confluence storage format (XHTML). Simple HTML works, e.g. <p>This month we shipped <strong>v2</strong>.</p>"}
   * @paramDef {"type":"String","label":"Status","name":"status","defaultValue":"Current","uiComponent":{"type":"DROPDOWN","options":{"values":["Current","Draft"]}},"description":"Current publishes the blog post immediately; Draft creates an unpublished draft."}
   *
   * @returns {Object}
   * @sampleResult {"id":"55556","status":"current","title":"Sprint Review","spaceId":"67890","authorId":"5b10ac8d82e05b22cc7d4ef5","createdAt":"2024-03-15T10:00:00.000Z","version":{"number":1},"_links":{"webui":"/spaces/DOCS/blog/2024/03/15/55556"}}
   */
  async createBlogPost(spaceId, title, body, status) {
    const requestBody = {
      spaceId: String(spaceId),
      status: this.#resolveChoice(status, CHOICE_MAPS.editStatus) || 'current',
      title,
      body: { representation: 'storage', value: body },
    }

    return await this.#apiRequest({
      logTag: 'createBlogPost',
      path: '/wiki/api/v2/blogposts',
      method: 'post',
      body: requestBody,
    })
  }

  // ==========================================================================
  //  COMMENTS
  // ==========================================================================
  /**
   * @operationName List Footer Comments on Page
   * @category Comments
   * @description Lists the footer comments (the regular comments shown below the page content) on a Confluence page, including their bodies in the chosen format. Results are cursor-paginated: pass the returned nextCursor back into Cursor for the next page.
   * @route GET /list-footer-comments
   *
   * @paramDef {"type":"String","label":"Page","name":"pageId","required":true,"dictionary":"getPagesDictionary","description":"The page whose footer comments to list. Pick from the list or provide a numeric page ID."}
   * @paramDef {"type":"String","label":"Body Format","name":"bodyFormat","defaultValue":"Storage","uiComponent":{"type":"DROPDOWN","options":{"values":["Storage","Atlas Doc Format","View"]}},"description":"Format of the returned comment bodies."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of comments to return per page (1-250, default 25)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Opaque pagination cursor from a previous call's nextCursor. Leave empty for the first page."}
   *
   * @returns {Object}
   * @sampleResult {"results":[{"id":"98765","status":"current","title":"","pageId":"12345","version":{"number":1,"authorId":"5b10ac8d82e05b22cc7d4ef5","createdAt":"2024-03-02T14:00:00.000Z"},"body":{"storage":{"representation":"storage","value":"<p>Nice work!</p>"}}}],"nextCursor":null}
   */
  async listFooterComments(pageId, bodyFormat, limit, cursor) {
    const query = {
      'body-format': this.#resolveChoice(bodyFormat, CHOICE_MAPS.bodyFormat) || 'storage',
    }

    if (limit !== undefined && limit !== null) query.limit = limit
    if (cursor) query.cursor = cursor

    const response = await this.#apiRequest({
      logTag: 'listFooterComments',
      path: `/wiki/api/v2/pages/${ pageId }/footer-comments`,
      query,
    })

    return { results: response.results || [], nextCursor: this.#extractCursor(response) }
  }

  /**
   * @operationName Create Footer Comment
   * @category Comments
   * @description Adds a footer comment to a Confluence page, or a threaded reply to an existing footer comment when Parent Comment ID is provided (the Page parameter is ignored for replies). The body defaults to storage format (XHTML) — simple HTML works.
   * @route POST /create-footer-comment
   *
   * @paramDef {"type":"String","label":"Page","name":"pageId","required":true,"dictionary":"getPagesDictionary","description":"The page to comment on. Pick from the list or provide a numeric page ID."}
   * @paramDef {"type":"String","label":"Body","name":"body","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Comment content, e.g. <p>Looks good to me</p> in storage format."}
   * @paramDef {"type":"String","label":"Body Representation","name":"representation","defaultValue":"Storage","uiComponent":{"type":"DROPDOWN","options":{"values":["Storage","Atlas Doc Format","Wiki"]}},"description":"Format of the Body value: Storage (XHTML), Atlas Doc Format (ADF JSON), or Wiki markup."}
   * @paramDef {"type":"String","label":"Parent Comment ID","name":"parentCommentId","description":"To reply to an existing footer comment, provide its ID. The reply is threaded under that comment and the Page parameter is ignored."}
   *
   * @returns {Object}
   * @sampleResult {"id":"98766","status":"current","title":"","pageId":"12345","version":{"number":1,"authorId":"5b10ac8d82e05b22cc7d4ef5","createdAt":"2024-03-02T15:00:00.000Z"},"body":{"storage":{"representation":"storage","value":"<p>Looks good to me</p>"}}}
   */
  async createFooterComment(pageId, body, representation, parentCommentId) {
    const requestBody = {
      ...(parentCommentId ? { parentCommentId: String(parentCommentId) } : { pageId: String(pageId) }),
      body: {
        representation: this.#resolveChoice(representation, CHOICE_MAPS.commentRepresentation) || 'storage',
        value: body,
      },
    }

    return await this.#apiRequest({
      logTag: 'createFooterComment',
      path: '/wiki/api/v2/footer-comments',
      method: 'post',
      body: requestBody,
    })
  }

  /**
   * @operationName Get Comment
   * @category Comments
   * @description Retrieves a single footer comment by its ID, including its body in the chosen format, author, version, and the page or parent comment it belongs to.
   * @route GET /get-comment
   *
   * @paramDef {"type":"String","label":"Comment ID","name":"commentId","required":true,"description":"The numeric ID of the footer comment to retrieve (e.g. from List Footer Comments on Page)."}
   * @paramDef {"type":"String","label":"Body Format","name":"bodyFormat","defaultValue":"Storage","uiComponent":{"type":"DROPDOWN","options":{"values":["Storage","Atlas Doc Format","View"]}},"description":"Format of the returned comment body."}
   *
   * @returns {Object}
   * @sampleResult {"id":"98765","status":"current","title":"","pageId":"12345","version":{"number":1,"authorId":"5b10ac8d82e05b22cc7d4ef5","createdAt":"2024-03-02T14:00:00.000Z"},"body":{"storage":{"representation":"storage","value":"<p>Nice work!</p>"}}}
   */
  async getComment(commentId, bodyFormat) {
    const query = {
      'body-format': this.#resolveChoice(bodyFormat, CHOICE_MAPS.bodyFormat) || 'storage',
    }

    return await this.#apiRequest({
      logTag: 'getComment',
      path: `/wiki/api/v2/footer-comments/${ commentId }`,
      query,
    })
  }

  /**
   * @operationName Delete Comment
   * @category Comments
   * @description Permanently deletes a footer comment from a Confluence page. Deleted comments are removed permanently and cannot be restored; replies to the comment are deleted with it.
   * @route DELETE /delete-comment
   *
   * @paramDef {"type":"String","label":"Comment ID","name":"commentId","required":true,"description":"The numeric ID of the footer comment to delete."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async deleteComment(commentId) {
    await this.#apiRequest({
      logTag: 'deleteComment',
      path: `/wiki/api/v2/footer-comments/${ commentId }`,
      method: 'delete',
    })

    return { success: true }
  }

  /**
   * @operationName List Inline Comments on Page
   * @category Comments
   * @description Lists the inline comments (comments anchored to highlighted text inside the page content) on a Confluence page, including their bodies and resolution status. Results are cursor-paginated: pass the returned nextCursor back into Cursor for the next page.
   * @route GET /list-inline-comments
   *
   * @paramDef {"type":"String","label":"Page","name":"pageId","required":true,"dictionary":"getPagesDictionary","description":"The page whose inline comments to list. Pick from the list or provide a numeric page ID."}
   * @paramDef {"type":"String","label":"Body Format","name":"bodyFormat","defaultValue":"Storage","uiComponent":{"type":"DROPDOWN","options":{"values":["Storage","Atlas Doc Format","View"]}},"description":"Format of the returned comment bodies."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of comments to return per page (1-250, default 25)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Opaque pagination cursor from a previous call's nextCursor. Leave empty for the first page."}
   *
   * @returns {Object}
   * @sampleResult {"results":[{"id":"87654","status":"current","title":"","pageId":"12345","resolutionStatus":"open","properties":{"inlineOriginalSelection":"this sentence"},"version":{"number":1,"authorId":"5b10ac8d82e05b22cc7d4ef5"},"body":{"storage":{"representation":"storage","value":"<p>Can you clarify this?</p>"}}}],"nextCursor":null}
   */
  async listInlineComments(pageId, bodyFormat, limit, cursor) {
    const query = {
      'body-format': this.#resolveChoice(bodyFormat, CHOICE_MAPS.bodyFormat) || 'storage',
    }

    if (limit !== undefined && limit !== null) query.limit = limit
    if (cursor) query.cursor = cursor

    const response = await this.#apiRequest({
      logTag: 'listInlineComments',
      path: `/wiki/api/v2/pages/${ pageId }/inline-comments`,
      query,
    })

    return { results: response.results || [], nextCursor: this.#extractCursor(response) }
  }

  // ==========================================================================
  //  ATTACHMENTS
  // ==========================================================================
  /**
   * @operationName List Page Attachments
   * @category Attachments
   * @description Lists the files attached to a Confluence page, including filename, media type, file size, and download link. Optionally filter by exact filename. Results are cursor-paginated: pass the returned nextCursor back into Cursor for the next page.
   * @route GET /list-page-attachments
   *
   * @paramDef {"type":"String","label":"Page","name":"pageId","required":true,"dictionary":"getPagesDictionary","description":"The page whose attachments to list. Pick from the list or provide a numeric page ID."}
   * @paramDef {"type":"String","label":"Filename","name":"filename","description":"Only return the attachment whose filename exactly matches this value (e.g. diagram.png)."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of attachments to return per page (1-250, default 25)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Opaque pagination cursor from a previous call's nextCursor. Leave empty for the first page."}
   *
   * @returns {Object}
   * @sampleResult {"results":[{"id":"att111222","status":"current","title":"diagram.png","mediaType":"image/png","fileSize":34567,"pageId":"12345","version":{"number":1,"createdAt":"2024-03-02T14:00:00.000Z"},"downloadLink":"/download/attachments/12345/diagram.png?version=1&api=v2"}],"nextCursor":null}
   */
  async listPageAttachments(pageId, filename, limit, cursor) {
    const query = {}

    if (filename) query.filename = filename
    if (limit !== undefined && limit !== null) query.limit = limit
    if (cursor) query.cursor = cursor

    const response = await this.#apiRequest({
      logTag: 'listPageAttachments',
      path: `/wiki/api/v2/pages/${ pageId }/attachments`,
      query,
    })

    return { results: response.results || [], nextCursor: this.#extractCursor(response) }
  }

  /**
   * @operationName Get Attachment
   * @category Attachments
   * @description Retrieves the metadata of a single Confluence attachment by its ID — filename, media type, file size, owning page, version, and download link. To fetch the file's bytes, use Download Attachment.
   * @route GET /get-attachment
   *
   * @paramDef {"type":"String","label":"Attachment ID","name":"attachmentId","required":true,"description":"The attachment ID (e.g. att111222 from List Page Attachments)."}
   *
   * @returns {Object}
   * @sampleResult {"id":"att111222","status":"current","title":"diagram.png","mediaType":"image/png","fileSize":34567,"pageId":"12345","version":{"number":1,"createdAt":"2024-03-02T14:00:00.000Z"},"downloadLink":"/download/attachments/12345/diagram.png?version=1&api=v2"}
   */
  async getAttachment(attachmentId) {
    return await this.#apiRequest({
      logTag: 'getAttachment',
      path: `/wiki/api/v2/attachments/${ attachmentId }`,
    })
  }

  /**
   * @operationName Upload Attachment
   * @category Attachments
   * @description Uploads a FlowRunner file as an attachment on a Confluence page. The upload is marked as a minor edit, so page watchers are not notified. Fails if an attachment with the same filename already exists on the page — delete or rename first in that case.
   * @route POST /upload-attachment
   *
   * @paramDef {"type":"String","label":"Page","name":"pageId","required":true,"dictionary":"getPagesDictionary","description":"The page to attach the file to. Pick from the list or provide a numeric page ID."}
   * @paramDef {"type":"String","label":"File","name":"fileUrl","required":true,"uiComponent":{"type":"FILE_SELECTOR"},"description":"The FlowRunner file to upload (its URL). The file's bytes are streamed to Confluence."}
   * @paramDef {"type":"String","label":"Filename","name":"fileName","description":"Name to give the attachment in Confluence (e.g. report.pdf). Defaults to the source file's name."}
   * @paramDef {"type":"String","label":"Comment","name":"comment","description":"Optional comment describing the attachment, shown in the attachment's version history."}
   *
   * @returns {Object}
   * @sampleResult {"results":[{"id":"att111222","type":"attachment","status":"current","title":"report.pdf","extensions":{"mediaType":"application/pdf","fileSize":102400},"_links":{"download":"/download/attachments/12345/report.pdf?version=1"}}],"size":1}
   */
  async uploadAttachment(pageId, fileUrl, fileName, comment) {
    // docs: https://developer.atlassian.com/cloud/confluence/rest/v1/api-group-content---attachments/
    try {
      logger.debug(`uploadAttachment - from ${ fileUrl } onto page ${ pageId }`)

      const baseUrl = await this.#getBaseUrl()
      const resolvedName = fileName || decodeURIComponent(String(fileUrl).split('/').pop().split('?')[0])
      const fileBytes = this.#toBuffer(await Flowrunner.Request.get(fileUrl).setEncoding(null))

      // Do NOT set Content-Type manually — the form supplies the multipart boundary.
      const formData = new Flowrunner.Request.FormData()

      formData.append('file', fileBytes, { filename: resolvedName })
      formData.append('minorEdit', 'true')

      if (comment) {
        formData.append('comment', comment)
      }

      return await Flowrunner.Request.post(`${ baseUrl }/wiki/rest/api/content/${ pageId }/child/attachment`)
        .set({
          'Authorization': `Bearer ${ this.#getAccessToken() }`,
          'X-Atlassian-Token': 'nocheck',
        })
        .form(formData)
    } catch (error) {
      this.#handleError(error, 'uploadAttachment')
    }
  }

  /**
   * @operationName Download Attachment
   * @category Attachments
   * @description Downloads a Confluence attachment's contents and saves them to FlowRunner file storage, returning the saved file's URL along with its name, media type, and size. Use the returned URL in subsequent flow steps.
   * @route POST /download-attachment
   *
   * @paramDef {"type":"String","label":"Attachment ID","name":"attachmentId","required":true,"description":"The attachment to download (e.g. att111222 from List Page Attachments)."}
   * @paramDef {"type":"FilesUploadOptions","label":"File Settings","name":"fileOptions","required":false,"include":["scope"],"description":"Where to store the downloaded file in FlowRunner file storage."}
   *
   * @returns {Object}
   * @sampleResult {"fileName":"diagram.png","mediaType":"image/png","sizeBytes":34567,"downloadUrl":"https://storage.flowrunner.com/files/diagram.png"}
   */
  async downloadAttachment(attachmentId, fileOptions) {
    const attachment = await this.#apiRequest({
      logTag: 'downloadAttachment:metadata',
      path: `/wiki/api/v2/attachments/${ attachmentId }`,
    })

    const downloadLink = attachment.downloadLink || attachment._links?.download

    if (!downloadLink) {
      throw new Error(`Confluence API error: attachment ${ attachmentId } has no download link`)
    }

    try {
      const baseUrl = await this.#getBaseUrl()
      // .setEncoding(null) keeps the binary intact.
      const fileBytes = await Flowrunner.Request.get(`${ baseUrl }/wiki${ downloadLink }`)
        .set({ 'Authorization': `Bearer ${ this.#getAccessToken() }` })
        .setEncoding(null)

      const buffer = this.#toBuffer(fileBytes)

      const { url } = await this.flowrunner.Files.uploadFile(buffer, {
        filename: attachment.title || `attachment_${ attachmentId }`,
        generateUrl: true,
        overwrite: true,
        ...(fileOptions || { scope: 'FLOW' }),
      })

      return {
        fileName: attachment.title || null,
        mediaType: attachment.mediaType || null,
        sizeBytes: attachment.fileSize || buffer.length,
        downloadUrl: url,
      }
    } catch (error) {
      this.#handleError(error, 'downloadAttachment')
    }
  }

  /**
   * @operationName Delete Attachment
   * @category Attachments
   * @description Deletes an attachment from a Confluence page. By default the attachment is moved to the trash (recoverable). Turn on Purge to permanently remove an attachment that is already in the trash.
   * @route DELETE /delete-attachment
   *
   * @paramDef {"type":"String","label":"Attachment ID","name":"attachmentId","required":true,"description":"The attachment to delete (e.g. att111222 from List Page Attachments)."}
   * @paramDef {"type":"Boolean","label":"Purge Permanently","name":"purge","uiComponent":{"type":"TOGGLE"},"defaultValue":false,"description":"Turn on to permanently purge an attachment that is already in the trash. This cannot be undone."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async deleteAttachment(attachmentId, purge) {
    const query = {}

    if (purge) query.purge = 'true'

    await this.#apiRequest({
      logTag: 'deleteAttachment',
      path: `/wiki/api/v2/attachments/${ attachmentId }`,
      method: 'delete',
      query,
    })

    return { success: true }
  }

  // ==========================================================================
  //  LABELS
  // ==========================================================================
  /**
   * @operationName Get Page Labels
   * @category Labels
   * @description Lists the labels applied to a Confluence page, optionally filtered by label prefix (Global, My, Team, or System). Results are cursor-paginated: pass the returned nextCursor back into Cursor for the next page.
   * @route GET /get-page-labels
   *
   * @paramDef {"type":"String","label":"Page","name":"pageId","required":true,"dictionary":"getPagesDictionary","description":"The page whose labels to list. Pick from the list or provide a numeric page ID."}
   * @paramDef {"type":"String","label":"Prefix","name":"prefix","uiComponent":{"type":"DROPDOWN","options":{"values":["Global","My","Team","System"]}},"description":"Only return labels with this prefix. Global is the standard prefix for user-added labels. Leave empty for all prefixes."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of labels to return per page (1-250, default 25)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Opaque pagination cursor from a previous call's nextCursor. Leave empty for the first page."}
   *
   * @returns {Object}
   * @sampleResult {"results":[{"id":"456","name":"documentation","prefix":"global"}],"nextCursor":null}
   */
  async getPageLabels(pageId, prefix, limit, cursor) {
    const query = {}

    if (prefix) query.prefix = this.#resolveChoice(prefix, CHOICE_MAPS.labelPrefix)
    if (limit !== undefined && limit !== null) query.limit = limit
    if (cursor) query.cursor = cursor

    const response = await this.#apiRequest({
      logTag: 'getPageLabels',
      path: `/wiki/api/v2/pages/${ pageId }/labels`,
      query,
    })

    return { results: response.results || [], nextCursor: this.#extractCursor(response) }
  }

  /**
   * @operationName Add Labels to Page
   * @category Labels
   * @description Adds one or more labels to a Confluence page using the standard global prefix. Labels are lowercase, single-word tags used for organizing and finding content (existing labels are unaffected). Returns the page's resulting label list.
   * @route POST /add-labels-to-page
   *
   * @paramDef {"type":"String","label":"Page","name":"pageId","required":true,"dictionary":"getPagesDictionary","description":"The page to label. Pick from the list or provide a numeric page ID."}
   * @paramDef {"type":"Array<String>","label":"Labels","name":"labels","required":true,"description":"Label names to add, e.g. [\"documentation\", \"api\"]. Labels cannot contain spaces — use hyphens instead."}
   *
   * @returns {Object}
   * @sampleResult {"results":[{"prefix":"global","name":"documentation","id":"456","label":"documentation"},{"prefix":"global","name":"api","id":"457","label":"api"}],"start":0,"limit":200,"size":2}
   */
  async addLabelsToPage(pageId, labels) {
    const labelList = (Array.isArray(labels) ? labels : [labels]).filter(Boolean)

    if (!labelList.length) {
      throw new Error('Provide at least one label name to add.')
    }

    return await this.#apiRequest({
      logTag: 'addLabelsToPage',
      path: `/wiki/rest/api/content/${ pageId }/label`,
      method: 'post',
      body: labelList.map(name => ({ prefix: 'global', name })),
    })
  }

  /**
   * @operationName Remove Label from Page
   * @category Labels
   * @description Removes a single label (global prefix) from a Confluence page. The label itself continues to exist on any other content it is applied to.
   * @route DELETE /remove-label-from-page
   *
   * @paramDef {"type":"String","label":"Page","name":"pageId","required":true,"dictionary":"getPagesDictionary","description":"The page to remove the label from. Pick from the list or provide a numeric page ID."}
   * @paramDef {"type":"String","label":"Label Name","name":"labelName","required":true,"description":"The name of the label to remove, e.g. documentation."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async removeLabelFromPage(pageId, labelName) {
    await this.#apiRequest({
      logTag: 'removeLabelFromPage',
      path: `/wiki/rest/api/content/${ pageId }/label/${ encodeURIComponent(labelName) }`,
      method: 'delete',
    })

    return { success: true }
  }

  // ==========================================================================
  //  SEARCH
  // ==========================================================================
  /**
   * @operationName Search Content (CQL)
   * @category Search
   * @description Searches Confluence content using CQL (Confluence Query Language). Either provide a raw CQL query for full control, or use the convenience filters (Text, Space Key, Content Type) and the query is built for you. Returns matching content with excerpts, ranked by relevance, with offset-based pagination via Start.
   * @route GET /search-content
   *
   * @paramDef {"type":"String","label":"CQL Query","name":"cql","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Raw CQL query, e.g. type = page AND text ~ \"release notes\" AND space = \"DOCS\" ORDER BY lastmodified DESC. Supported fields include type, title, text, space, label, creator, created, lastmodified. When provided, the convenience filters below are ignored."}
   * @paramDef {"type":"String","label":"Text","name":"text","description":"Convenience filter: full-text search term. Builds text ~ \"...\" into the CQL query."}
   * @paramDef {"type":"String","label":"Space Key","name":"spaceKey","description":"Convenience filter: restrict results to this space key (e.g. DOCS). Builds space = \"...\" into the CQL query."}
   * @paramDef {"type":"String","label":"Content Type","name":"type","uiComponent":{"type":"DROPDOWN","options":{"values":["Page","Blog Post","Comment","Attachment","Space"]}},"description":"Convenience filter: restrict results to one content type. Builds type = ... into the CQL query."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of results to return (1-100, default 25)."}
   * @paramDef {"type":"Number","label":"Start","name":"start","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"0-based index of the first result to return, for offset pagination (default 0)."}
   *
   * @returns {Object}
   * @sampleResult {"results":[{"content":{"id":"12345","type":"page","status":"current","title":"Release Notes"},"title":"Release Notes","excerpt":"Latest release notes for version 2.0...","url":"/spaces/DOCS/pages/12345/Release+Notes","lastModified":"2024-02-01T10:00:00.000Z"}],"start":0,"limit":25,"size":1,"totalSize":1}
   */
  async searchContent(cql, text, spaceKey, type, limit, start) {
    let finalCql = cql

    if (!finalCql) {
      const clauses = []

      if (text) clauses.push(`text ~ "${ this.#escapeCql(text) }"`)
      if (spaceKey) clauses.push(`space = "${ this.#escapeCql(spaceKey) }"`)
      if (type) clauses.push(`type = ${ this.#resolveChoice(type, CHOICE_MAPS.searchType) }`)

      if (!clauses.length) {
        throw new Error('Provide a CQL query or at least one convenience filter (Text, Space Key, or Content Type).')
      }

      finalCql = clauses.join(' AND ')
    }

    const query = { cql: finalCql }

    if (limit !== undefined && limit !== null) query.limit = limit
    if (start !== undefined && start !== null) query.start = start

    return await this.#apiRequest({
      logTag: 'searchContent',
      path: '/wiki/rest/api/search',
      query,
    })
  }

  // ==========================================================================
  //  USERS
  // ==========================================================================
  /**
   * @operationName Get Current User
   * @category Users
   * @description Retrieves the profile of the Confluence user the connection is authorized as — account ID, display name, public name, email (when visible), and profile picture. Useful for attributing flow activity or looking up the connected account's ID.
   * @route GET /get-current-user
   *
   * @returns {Object}
   * @sampleResult {"type":"known","accountId":"5b10ac8d82e05b22cc7d4ef5","accountType":"atlassian","email":"jsmith@example.com","publicName":"jsmith","displayName":"John Smith","profilePicture":{"path":"/wiki/aa-avatar/5b10ac8d82e05b22cc7d4ef5","width":48,"height":48,"isDefault":false}}
   */
  async getCurrentUser() {
    return await this.#apiRequest({
      logTag: 'getCurrentUser',
      path: '/wiki/rest/api/user/current',
    })
  }

  // ==========================================================================
  //  DICTIONARIES
  // ==========================================================================
  /**
   * @typedef {Object} getSpacesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter spaces by name or key."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Spaces Dictionary
   * @description Provides a searchable list of Confluence spaces for dynamic parameter selection. Values are numeric space IDs.
   * @route POST /get-spaces-dictionary
   * @paramDef {"type":"getSpacesDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering spaces."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Documentation (DOCS)","value":"67890","note":"Type: global"}],"cursor":"eyJpZCI6Njc4OTB9"}
   */
  async getSpacesDictionary(payload) {
    const { search, cursor } = payload || {}

    const query = { limit: 50, sort: 'name' }

    if (cursor) query.cursor = cursor

    const response = await this.#apiRequest({
      logTag: 'getSpacesDictionary',
      path: '/wiki/api/v2/spaces',
      query,
    })

    let items = (response.results || []).map(space => ({
      label: `${ space.name } (${ space.key })`,
      value: String(space.id),
      note: `Type: ${ space.type }`,
    }))

    if (search) {
      const searchLower = search.toLowerCase()

      items = items.filter(item => item.label.toLowerCase().includes(searchLower))
    }

    return { items, cursor: this.#extractCursor(response) }
  }

  /**
   * @typedef {Object} getPagesDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Space ID","name":"spaceId","description":"Optional space ID to list pages from a specific space only."}
   */

  /**
   * @typedef {Object} getPagesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter pages by title."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for retrieving the next page of results."}
   * @paramDef {"type":"getPagesDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"Optional criteria to restrict the page list to a single space."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Pages Dictionary
   * @description Provides a searchable list of Confluence pages (most recently modified first) for dynamic parameter selection, optionally restricted to one space. Values are numeric page IDs.
   * @route POST /get-pages-dictionary
   * @paramDef {"type":"getPagesDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string, pagination cursor, and space criteria for retrieving and filtering pages."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Release Notes","value":"12345","note":"Status: current"}],"cursor":"eyJpZCI6MTIzNDV9"}
   */
  async getPagesDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const spaceId = criteria?.spaceId

    const path = spaceId ? `/wiki/api/v2/spaces/${ spaceId }/pages` : '/wiki/api/v2/pages'
    const query = { limit: 50, sort: '-modified-date' }

    if (cursor) query.cursor = cursor

    const response = await this.#apiRequest({
      logTag: 'getPagesDictionary',
      path,
      query,
    })

    let items = (response.results || []).map(page => ({
      label: page.title,
      value: String(page.id),
      note: `Status: ${ page.status }`,
    }))

    if (search) {
      const searchLower = search.toLowerCase()

      items = items.filter(item => item.label.toLowerCase().includes(searchLower))
    }

    return { items, cursor: this.#extractCursor(response) }
  }
}

Flowrunner.ServerCode.addService(Confluence, [
  {
    name: 'clientId',
    displayName: 'Client ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'OAuth 2.0 (3LO) Client ID of your app at https://developer.atlassian.com/console/myapps. The app must have the Confluence classic scopes enabled: read:confluence-content.all, write:confluence-content, read:confluence-space.summary, write:confluence-space, search:confluence, read:confluence-user, readonly:content.attachment:confluence, offline_access.',
  },
  {
    name: 'clientSecret',
    displayName: 'Client Secret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'OAuth 2.0 (3LO) Client Secret from the same Atlassian app (Settings → Authentication details).',
  },
])
