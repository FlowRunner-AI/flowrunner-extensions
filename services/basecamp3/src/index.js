// Basecamp integration - manage projects, to-dos, messages, comments, campfires, people,
// schedules, and documents via the Basecamp 4 (bc3) REST API (OAuth2 through 37signals Launchpad).

// ============================================================================
//  CONSTANTS
// ============================================================================
// 37signals Launchpad OAuth 2.0 endpoints. Launchpad uses non-standard parameter names:
// `type=web_server` for the authorization-code flow and `type=refresh` for token refresh,
// with all token-endpoint parameters accepted in the query string.
const LAUNCHPAD_AUTHORIZE_URL = 'https://launchpad.37signals.com/authorization/new'
const LAUNCHPAD_TOKEN_URL = 'https://launchpad.37signals.com/authorization/token'
const LAUNCHPAD_AUTHORIZATION_INFO_URL = 'https://launchpad.37signals.com/authorization.json'

// Every Basecamp API path is scoped to a numeric account id: https://3.basecampapi.com/{accountId}.
// The account id is NOT part of the token response - it is resolved once from authorization.json
// (the first account with product "bc3") right after the token exchange, and embedded into the
// stored token via the platform's composite-token pattern so it rides back on the
// oauth-access-token header on every later invocation.
const API_HOST = 'https://3.basecampapi.com'
const TOKEN_DELIMITER = '::bc3::'

// Basecamp rejects any request without a descriptive User-Agent (400 Bad Request), so it is set
// on every call, including the OAuth handshake.
const USER_AGENT = 'FlowRunner Integration (support@flowrunner.com)'

// Friendly DROPDOWN labels the UI shows, mapped to the API values Basecamp expects.
// "Active" maps to an empty string so the status query parameter is omitted (the API default).
const RECORDING_STATUS_MAP = {
  'Active': '',
  'Archived': 'archived',
  'Trashed': 'trashed',
}

const ERROR_HINTS = {
  400: 'The request was rejected — check the field values.',
  401: 'Authentication failed — reconnect the Basecamp account.',
  403: 'Access denied — the connected user cannot perform this action in this project.',
  404: 'Not found — the id may be wrong, the item may be trashed, or the connected user has no access to it.',
  429: 'Rate limit hit (Basecamp allows roughly 50 requests per 10 seconds) — retry in a moment.',
  507: 'The account has reached a plan limit (for example the maximum number of projects).',
}

// ============================================================================
//  LOGGER
// ============================================================================
const logger = {
  info: (...args) => console.log('[Basecamp] info:', ...args),
  debug: (...args) => console.log('[Basecamp] debug:', ...args),
  error: (...args) => console.log('[Basecamp] error:', ...args),
  warn: (...args) => console.log('[Basecamp] warn:', ...args),
}

// ============================================================================
//  DICTIONARY PAYLOAD TYPEDEFS
// ============================================================================
/**
 * @typedef {Object} getProjectsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter projects by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination page number for the next page of results."}
 */

/**
 * @typedef {Object} getTodoListsDictionary__payloadCriteria
 * @paramDef {"type":"String","label":"Project","name":"projectId","description":"The project whose to-do lists populate the list."}
 */

/**
 * @typedef {Object} getTodoListsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter to-do lists by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination page number for the next page of results."}
 * @paramDef {"type":"getTodoListsDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"The project whose to-do lists to list."}
 */

/**
 * @typedef {Object} getPeopleDictionary__payloadCriteria
 * @paramDef {"type":"String","label":"Project","name":"projectId","description":"Optional project id — when set, only people with access to that project are listed."}
 */

/**
 * @typedef {Object} getPeopleDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter people by name or email address."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination page number for the next page of results."}
 * @paramDef {"type":"getPeopleDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"Optional project scope for the people list."}
 */

/**
 * @integrationName Basecamp
 * @integrationIcon /icon.png
 * @requireOAuth
 */
class Basecamp {
  constructor(config) {
    this.config = config || {}
    this.clientId = this.config.clientId
    this.clientSecret = this.config.clientSecret
  }

  // ==========================================================================
  //  CORE - every Basecamp API call goes through #apiRequest
  // ==========================================================================
  // Resolves the full response (`.unwrapBody(false)`) so the Link / X-Total-Count headers are
  // available for pagination, then returns { body, headers }.
  async #apiRequest({ url, method, body, query, logTag }) {
    method = method || 'get'

    try {
      logger.debug(`${ logTag } ${ method.toUpperCase() } ${ url }`)

      const request = Flowrunner.Request[method](url)
        .set(this.#headers(body !== undefined))
        .query(query || {})
        .unwrapBody(false)

      const response = body !== undefined ? await request.send(body) : await request

      return { body: response?.body, headers: response?.headers || {} }
    } catch (error) {
      this.#handleError(error, logTag)
    }
  }

  #headers(hasBody) {
    const headers = {
      'Authorization': `Bearer ${ this.#creds().accessToken }`,
      'User-Agent': USER_AGENT,
      'Accept': 'application/json',
    }

    if (hasBody) {
      headers['Content-Type'] = 'application/json'
    }

    return headers
  }

  #handleError(error, logTag) {
    const status = error?.status || error?.statusCode
    const apiMessage =
      error?.body?.error ||
      error?.body?.error_description ||
      error?.body?.message ||
      error?.message ||
      'Request failed'
    const hint = ERROR_HINTS[status]

    logger.error(`${ logTag } failed: ${ apiMessage }`)

    throw new Error(hint ? `${ hint } (${ apiMessage })` : apiMessage)
  }

  // Translate a friendly DROPDOWN label into the API value; pass through anything unmapped.
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) return undefined

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // The composite token from the header: "<accessToken>::bc3::<accountId>". The account id is
  // captured from authorization.json at connect time (see executeCallback) because every
  // Basecamp API URL is scoped to it.
  #creds() {
    const composite = this.request.headers['oauth-access-token']

    if (!composite) {
      throw new Error('Access token is not available. Please reconnect the Basecamp account.')
    }

    const [accessToken, accountId] = composite.split(TOKEN_DELIMITER)

    if (!accountId) {
      throw new Error('Basecamp account id is unavailable — reconnect the Basecamp account so it can be captured.')
    }

    return { accessToken, accountId }
  }

  #apiBase() {
    return `${ API_HOST }/${ this.#creds().accountId }`
  }

  #buildCompositeToken(accessToken, accountId) {
    return [accessToken, accountId].join(TOKEN_DELIMITER)
  }

  // Basecamp paginates via the HTTP Link header: <...?page=N>; rel="next". Returns the full
  // next-page URL, or null when the last page was reached.
  #parseNextPageUrl(headers) {
    const link = headers?.link || headers?.Link

    if (!link) return null

    for (const part of String(link).split(',')) {
      if (!/rel="next"/.test(part)) continue

      const urlMatch = /<([^>]+)>/.exec(part)

      if (urlMatch) return urlMatch[1]
    }

    return null
  }

  // Wraps a list response as { items, totalCount, nextPage, nextPageUrl } using the Link and
  // X-Total-Count headers Basecamp sends with every paginated collection.
  #withPagination(response) {
    const items = Array.isArray(response.body) ? response.body : []
    const nextPageUrl = this.#parseNextPageUrl(response.headers)
    const pageMatch = nextPageUrl ? /[?&]page=(\d+)/.exec(nextPageUrl) : null
    const totalHeader = response.headers?.['x-total-count']

    return {
      items,
      totalCount: totalHeader !== undefined ? Number(totalHeader) : items.length,
      nextPage: pageMatch ? Number(pageMatch[1]) : null,
      nextPageUrl,
    }
  }

  // Basecamp scopes tool endpoints (to-dos, messages, documents, schedule, campfire) to per-project
  // tool ids that live in the project's dock. This helper fetches the project and resolves the
  // dock entry by name ("todoset", "message_board", "vault", "schedule", "chat") so callers only
  // ever pass a project id.
  async #getDockTool(projectId, toolName) {
    const { body: project } = await this.#apiRequest({
      url: `${ this.#apiBase() }/projects/${ projectId }.json`,
      logTag: `getDockTool(${ toolName })`,
    })

    const tool = (project?.dock || []).find(entry => entry.name === toolName)

    if (!tool || !tool.id) {
      throw new Error(`The project does not have a "${ toolName }" tool in its dock.`)
    }

    if (tool.enabled === false) {
      throw new Error(`The "${ tool.title || toolName }" tool is disabled in this project — enable it in the project settings in Basecamp first.`)
    }

    return tool
  }

  // Normalizes an Array<Number> param (people ids) that may arrive as a parsed array or as a
  // JSON string; validates every entry is numeric.
  #parseIdArray(value, label) {
    if (value === undefined || value === null || value === '') return undefined

    let parsed = value

    if (typeof value === 'string') {
      try {
        parsed = JSON.parse(value)
      } catch (error) {
        throw new Error(`${ label } must be an array of numeric people ids, e.g. [1049715914, 1049715915].`)
      }
    }

    if (!Array.isArray(parsed)) {
      throw new Error(`${ label } must be an array of numeric people ids, e.g. [1049715914, 1049715915].`)
    }

    const ids = parsed.map(id => Number(id))

    if (ids.some(id => !Number.isFinite(id))) {
      throw new Error(`${ label } must contain only numeric people ids.`)
    }

    return ids
  }

  #normalizeBoolean(value) {
    if (value === undefined || value === null || value === '') return undefined

    return Boolean(value)
  }

  // Resolves the Launchpad identity and the first Basecamp 4 ("bc3") account the connected user
  // can access. Both are needed at connect time: the account id for API URLs and the names for
  // the connection identity label.
  async #fetchAuthorizationInfo(accessToken) {
    const info = await Flowrunner.Request.get(LAUNCHPAD_AUTHORIZATION_INFO_URL)
      .set({ 'Authorization': `Bearer ${ accessToken }`, 'User-Agent': USER_AGENT, 'Accept': 'application/json' })

    const accounts = Array.isArray(info?.accounts) ? info.accounts : []
    const account = accounts.find(entry => entry.product === 'bc3')

    if (!account || !account.id) {
      throw new Error('The connected 37signals identity has no Basecamp account. Sign in with a user that belongs to a Basecamp (bc3) account and try again.')
    }

    return { identity: info?.identity || {}, account }
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
    const params = new URLSearchParams({
      type: 'web_server',
      client_id: this.clientId,
    })

    return `${ LAUNCHPAD_AUTHORIZE_URL }?${ params.toString() }`
  }

  /**
   * @registerAs SYSTEM
   * @route POST /executeCallback
   * @param {Object} callbackObject
   */
  async executeCallback(callbackObject) {
    // Launchpad accepts the token-exchange parameters in the query string of the POST
    // (type=web_server is its non-standard grant marker). The token response carries only
    // access_token/refresh_token/expires_in — the bc3 account id every API URL needs is fetched
    // from authorization.json and embedded into the stored token (composite-token pattern).
    const tokenResponse = await Flowrunner.Request.post(LAUNCHPAD_TOKEN_URL)
      .set({ 'User-Agent': USER_AGENT, 'Accept': 'application/json' })
      .query({
        type: 'web_server',
        client_id: this.clientId,
        redirect_uri: callbackObject.redirectURI,
        client_secret: this.clientSecret,
        code: callbackObject.code,
      })

    const { identity, account } = await this.#fetchAuthorizationInfo(tokenResponse.access_token)

    const fullName = [identity.first_name, identity.last_name].filter(Boolean).join(' ').trim()
    const identityName = fullName || identity.email_address || String(account.id)

    return {
      token: this.#buildCompositeToken(tokenResponse.access_token, account.id),
      expirationInSeconds: tokenResponse.expires_in,
      refreshToken: tokenResponse.refresh_token,
      connectionIdentityName: `${ identityName } (${ account.name })`,
      connectionIdentityImageURL: null,
      userData: { accountId: account.id, accountName: account.name, email: identity.email_address || null },
      overwrite: true,
    }
  }

  /**
   * @registerAs SYSTEM
   * @route PUT /refreshToken
   * @param {String} refreshToken
   */
  async refreshToken(refreshToken) {
    const tokenResponse = await Flowrunner.Request.post(LAUNCHPAD_TOKEN_URL)
      .set({ 'User-Agent': USER_AGENT, 'Accept': 'application/json' })
      .query({
        type: 'refresh',
        refresh_token: refreshToken,
        client_id: this.clientId,
        client_secret: this.clientSecret,
      })

    // The refresh response does not carry the bc3 account id, so re-embed the value already
    // captured in the current composite token.
    const { accountId } = this.#creds()

    return {
      token: this.#buildCompositeToken(tokenResponse.access_token, accountId),
      expirationInSeconds: tokenResponse.expires_in,
      refreshToken: tokenResponse.refresh_token || refreshToken,
    }
  }

  // ==========================================================================
  //  PROJECTS
  // ==========================================================================
  /**
   * @operationName List Projects
   * @category Projects
   * @description Lists the projects visible to the connected user. By default only active projects are returned; choose Archived or Trashed to list those instead. Results are paginated — the response includes items, totalCount, and nextPage/nextPageUrl when more pages exist (pass nextPage back as the Page parameter to continue). Each project includes its dock array with the per-project tool ids (to-dos, message board, docs and files, schedule, campfire).
   * @route GET /list-projects
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Active","Archived","Trashed"]}},"defaultValue":"Active","description":"Which projects to list: Active (default), Archived, or Trashed."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to fetch (starts at 1). Use nextPage from the previous response to continue."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":2085958499,"status":"active","name":"Marketing Campaign","description":"Q3 launch planning","purpose":"topic","created_at":"2026-01-05T10:00:00.000Z","app_url":"https://3.basecamp.com/1234567/projects/2085958499"}],"totalCount":12,"nextPage":2,"nextPageUrl":"https://3.basecampapi.com/1234567/projects.json?page=2"}
   */
  async listProjects(status, page) {
    const query = {}
    const statusValue = this.#resolveChoice(status, RECORDING_STATUS_MAP)

    if (statusValue) query.status = statusValue
    if (page) query.page = page

    const response = await this.#apiRequest({
      url: `${ this.#apiBase() }/projects.json`,
      query,
      logTag: 'listProjects',
    })

    return this.#withPagination(response)
  }

  /**
   * @operationName Get Project
   * @category Projects
   * @description Retrieves a single project by id, including its name, description, people access settings, and the dock array. The dock lists the project's tools with their per-project ids — todoset (to-dos), message_board (messages), vault (docs and files), chat (campfire), and schedule — which other Basecamp endpoints are scoped to. The to-do list, message, document, schedule, and campfire actions in this integration resolve those ids automatically, so you normally only need the project id.
   * @route GET /get-project
   * @paramDef {"type":"String","label":"Project","name":"projectId","required":true,"dictionary":"getProjectsDictionary","description":"The project to fetch."}
   * @returns {Object}
   * @sampleResult {"id":2085958499,"status":"active","name":"Marketing Campaign","description":"Q3 launch planning","created_at":"2026-01-05T10:00:00.000Z","dock":[{"id":1069479338,"title":"Message Board","name":"message_board","enabled":true},{"id":1069479339,"title":"To-dos","name":"todoset","enabled":true},{"id":1069479340,"title":"Docs & Files","name":"vault","enabled":true},{"id":1069479341,"title":"Campfire","name":"chat","enabled":true},{"id":1069479342,"title":"Schedule","name":"schedule","enabled":true}],"app_url":"https://3.basecamp.com/1234567/projects/2085958499"}
   */
  async getProject(projectId) {
    if (!projectId) throw new Error('Project is required.')

    const { body } = await this.#apiRequest({
      url: `${ this.#apiBase() }/projects/${ projectId }.json`,
      logTag: 'getProject',
    })

    return body
  }

  /**
   * @operationName Create Project
   * @category Projects
   * @description Creates a new project with the given name and optional description. The connected user becomes a member of the new project. Returns the full project including its dock of tools. Fails with a plan-limit error if the account has reached its maximum number of projects.
   * @route POST /create-project
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The project name."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"A short description of the project."}
   * @returns {Object}
   * @sampleResult {"id":2085958500,"status":"active","name":"Website Redesign","description":"New marketing site","created_at":"2026-07-16T12:00:00.000Z","dock":[{"id":1069479350,"title":"To-dos","name":"todoset","enabled":true}],"app_url":"https://3.basecamp.com/1234567/projects/2085958500"}
   */
  async createProject(name, description) {
    if (!name) throw new Error('Name is required.')

    const body = { name }

    if (description) body.description = description

    const { body: project } = await this.#apiRequest({
      url: `${ this.#apiBase() }/projects.json`,
      method: 'post',
      body,
      logTag: 'createProject',
    })

    return project
  }

  /**
   * @operationName Update Project
   * @category Projects
   * @description Updates a project's name and/or description. Only the fields you provide are changed — omitted fields keep their current values (the current project is fetched first and merged). Returns the updated project.
   * @route PUT /update-project
   * @paramDef {"type":"String","label":"Project","name":"projectId","required":true,"dictionary":"getProjectsDictionary","description":"The project to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"New project name. Leave empty to keep the current name."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New project description. Leave empty to keep the current description."}
   * @returns {Object}
   * @sampleResult {"id":2085958499,"status":"active","name":"Marketing Campaign 2026","description":"Q3 and Q4 launch planning","app_url":"https://3.basecamp.com/1234567/projects/2085958499"}
   */
  async updateProject(projectId, name, description) {
    if (!projectId) throw new Error('Project is required.')

    // Basecamp's project update expects the name; fetch the current project and merge so callers
    // can change a single field without clearing the others.
    const { body: existing } = await this.#apiRequest({
      url: `${ this.#apiBase() }/projects/${ projectId }.json`,
      logTag: 'updateProject(fetch)',
    })

    const body = {
      name: name || existing?.name,
      description: description !== undefined && description !== null && description !== ''
        ? description
        : existing?.description || '',
    }

    const { body: project } = await this.#apiRequest({
      url: `${ this.#apiBase() }/projects/${ projectId }.json`,
      method: 'put',
      body,
      logTag: 'updateProject',
    })

    return project
  }

  /**
   * @operationName Trash Project
   * @category Projects
   * @description Moves a project to the trash. Trashed projects are hidden from everyone and are permanently deleted by Basecamp after 30 days (until then they can be restored from the trash in the Basecamp UI). Use List Projects with status Trashed to see what is in the trash.
   * @route DELETE /trash-project
   * @paramDef {"type":"String","label":"Project","name":"projectId","required":true,"dictionary":"getProjectsDictionary","description":"The project to move to the trash."}
   * @returns {Object}
   * @sampleResult {"trashed":true,"projectId":"2085958499"}
   */
  async trashProject(projectId) {
    if (!projectId) throw new Error('Project is required.')

    await this.#apiRequest({
      url: `${ this.#apiBase() }/projects/${ projectId }.json`,
      method: 'delete',
      logTag: 'trashProject',
    })

    return { trashed: true, projectId: String(projectId) }
  }

  // ==========================================================================
  //  TO-DO LISTS
  // ==========================================================================
  /**
   * @operationName Get Todoset
   * @category To-do Lists
   * @description Retrieves a project's todoset — the container that holds all of the project's to-do lists. The todoset id is resolved automatically from the project's dock, so only the project id is needed. Returns the todoset with its to-do list count, completion ratio, and the URL for its to-do lists.
   * @route GET /get-todoset
   * @paramDef {"type":"String","label":"Project","name":"projectId","required":true,"dictionary":"getProjectsDictionary","description":"The project whose todoset to fetch."}
   * @returns {Object}
   * @sampleResult {"id":1069479339,"status":"active","type":"Todoset","title":"To-dos","name":"To-dos","todolists_count":3,"completed":false,"completed_ratio":"5/12","todolists_url":"https://3.basecampapi.com/1234567/buckets/2085958499/todosets/1069479339/todolists.json","app_url":"https://3.basecamp.com/1234567/buckets/2085958499/todosets/1069479339"}
   */
  async getTodoset(projectId) {
    if (!projectId) throw new Error('Project is required.')

    const tool = await this.#getDockTool(projectId, 'todoset')

    const { body } = await this.#apiRequest({
      url: `${ this.#apiBase() }/buckets/${ projectId }/todosets/${ tool.id }.json`,
      logTag: 'getTodoset',
    })

    return body
  }

  /**
   * @operationName List To-do Lists
   * @category To-do Lists
   * @description Lists the to-do lists in a project. The project's todoset is resolved automatically from its dock, so only the project id is needed. By default only active lists are returned; choose Archived or Trashed to list those instead. Results are paginated — the response includes items, totalCount, and nextPage/nextPageUrl when more pages exist.
   * @route GET /list-todo-lists
   * @paramDef {"type":"String","label":"Project","name":"projectId","required":true,"dictionary":"getProjectsDictionary","description":"The project whose to-do lists to list."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Active","Archived","Trashed"]}},"defaultValue":"Active","description":"Which to-do lists to include: Active (default), Archived, or Trashed."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to fetch (starts at 1). Use nextPage from the previous response to continue."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":1069479520,"status":"active","type":"Todolist","name":"Launch checklist","description":"Everything before go-live","completed":false,"completed_ratio":"2/8","todos_url":"https://3.basecampapi.com/1234567/buckets/2085958499/todolists/1069479520/todos.json","app_url":"https://3.basecamp.com/1234567/buckets/2085958499/todolists/1069479520"}],"totalCount":3,"nextPage":null,"nextPageUrl":null}
   */
  async listTodoLists(projectId, status, page) {
    if (!projectId) throw new Error('Project is required.')

    const tool = await this.#getDockTool(projectId, 'todoset')

    const query = {}
    const statusValue = this.#resolveChoice(status, RECORDING_STATUS_MAP)

    if (statusValue) query.status = statusValue
    if (page) query.page = page

    const response = await this.#apiRequest({
      url: `${ this.#apiBase() }/buckets/${ projectId }/todosets/${ tool.id }/todolists.json`,
      query,
      logTag: 'listTodoLists',
    })

    return this.#withPagination(response)
  }

  /**
   * @operationName Get To-do List
   * @category To-do Lists
   * @description Retrieves a single to-do list by id, including its name, description, completion ratio, and the URL for its to-dos.
   * @route GET /get-todo-list
   * @paramDef {"type":"String","label":"Project","name":"projectId","required":true,"dictionary":"getProjectsDictionary","description":"The project the to-do list belongs to."}
   * @paramDef {"type":"String","label":"To-do List","name":"todolistId","required":true,"dictionary":"getTodoListsDictionary","dependsOn":["projectId"],"description":"The to-do list to fetch. Choose a project above to pick from its lists, or paste a to-do list id."}
   * @returns {Object}
   * @sampleResult {"id":1069479520,"status":"active","type":"Todolist","name":"Launch checklist","description":"Everything before go-live","completed":false,"completed_ratio":"2/8","todos_url":"https://3.basecampapi.com/1234567/buckets/2085958499/todolists/1069479520/todos.json","app_url":"https://3.basecamp.com/1234567/buckets/2085958499/todolists/1069479520"}
   */
  async getTodoList(projectId, todolistId) {
    if (!projectId) throw new Error('Project is required.')
    if (!todolistId) throw new Error('To-do List is required.')

    const { body } = await this.#apiRequest({
      url: `${ this.#apiBase() }/buckets/${ projectId }/todolists/${ todolistId }.json`,
      logTag: 'getTodoList',
    })

    return body
  }

  /**
   * @operationName Create To-do List
   * @category To-do Lists
   * @description Creates a new to-do list in a project. The project's todoset is resolved automatically from its dock, so only the project id is needed. The description may contain simple HTML formatting. Returns the new to-do list, including the URL to add to-dos to it.
   * @route POST /create-todo-list
   * @paramDef {"type":"String","label":"Project","name":"projectId","required":true,"dictionary":"getProjectsDictionary","description":"The project to create the to-do list in."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The to-do list name."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional description; simple HTML formatting is supported (e.g. <strong>, <em>, links)."}
   * @returns {Object}
   * @sampleResult {"id":1069479521,"status":"active","type":"Todolist","name":"QA pass","description":"<div>Final checks</div>","completed":false,"todos_url":"https://3.basecampapi.com/1234567/buckets/2085958499/todolists/1069479521/todos.json","app_url":"https://3.basecamp.com/1234567/buckets/2085958499/todolists/1069479521"}
   */
  async createTodoList(projectId, name, description) {
    if (!projectId) throw new Error('Project is required.')
    if (!name) throw new Error('Name is required.')

    const tool = await this.#getDockTool(projectId, 'todoset')

    const body = { name }

    if (description) body.description = description

    const { body: todolist } = await this.#apiRequest({
      url: `${ this.#apiBase() }/buckets/${ projectId }/todosets/${ tool.id }/todolists.json`,
      method: 'post',
      body,
      logTag: 'createTodoList',
    })

    return todolist
  }

  /**
   * @operationName Update To-do List
   * @category To-do Lists
   * @description Updates a to-do list's name and/or description. Only the fields you provide are changed — omitted fields keep their current values (the current list is fetched first and merged). Returns the updated to-do list.
   * @route PUT /update-todo-list
   * @paramDef {"type":"String","label":"Project","name":"projectId","required":true,"dictionary":"getProjectsDictionary","description":"The project the to-do list belongs to."}
   * @paramDef {"type":"String","label":"To-do List","name":"todolistId","required":true,"dictionary":"getTodoListsDictionary","dependsOn":["projectId"],"description":"The to-do list to update. Choose a project above to pick from its lists, or paste a to-do list id."}
   * @paramDef {"type":"String","label":"Name","name":"name","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"New name. Leave empty to keep the current name."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New description (simple HTML supported). Leave empty to keep the current description."}
   * @returns {Object}
   * @sampleResult {"id":1069479520,"status":"active","type":"Todolist","name":"Launch checklist (final)","description":"<div>Everything before go-live</div>","app_url":"https://3.basecamp.com/1234567/buckets/2085958499/todolists/1069479520"}
   */
  async updateTodoList(projectId, todolistId, name, description) {
    if (!projectId) throw new Error('Project is required.')
    if (!todolistId) throw new Error('To-do List is required.')

    // Basecamp expects the name on update; fetch the current list and merge so callers can change
    // a single field without clearing the others.
    const { body: existing } = await this.#apiRequest({
      url: `${ this.#apiBase() }/buckets/${ projectId }/todolists/${ todolistId }.json`,
      logTag: 'updateTodoList(fetch)',
    })

    const body = {
      name: name || existing?.name,
      description: description !== undefined && description !== null && description !== ''
        ? description
        : existing?.description || '',
    }

    const { body: todolist } = await this.#apiRequest({
      url: `${ this.#apiBase() }/buckets/${ projectId }/todolists/${ todolistId }.json`,
      method: 'put',
      body,
      logTag: 'updateTodoList',
    })

    return todolist
  }

  // ==========================================================================
  //  TO-DOS
  // ==========================================================================
  /**
   * @operationName List To-dos
   * @category To-dos
   * @description Lists the to-dos in a to-do list. By default only active, incomplete to-dos are returned; enable Completed to list completed ones, or choose Archived/Trashed status. Results are paginated — the response includes items, totalCount, and nextPage/nextPageUrl when more pages exist. Each to-do includes its content, due date, assignees, and completion state.
   * @route GET /list-todos
   * @paramDef {"type":"String","label":"Project","name":"projectId","required":true,"dictionary":"getProjectsDictionary","description":"The project the to-do list belongs to."}
   * @paramDef {"type":"String","label":"To-do List","name":"todolistId","required":true,"dictionary":"getTodoListsDictionary","dependsOn":["projectId"],"description":"The to-do list whose to-dos to list. Choose a project above to pick from its lists."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Active","Archived","Trashed"]}},"defaultValue":"Active","description":"Which to-dos to include: Active (default), Archived, or Trashed."}
   * @paramDef {"type":"Boolean","label":"Completed Only","name":"completed","uiComponent":{"type":"CHECKBOX"},"description":"When enabled, only completed to-dos are returned (by default only incomplete ones are)."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to fetch (starts at 1). Use nextPage from the previous response to continue."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":1069479852,"status":"active","type":"Todo","content":"Design the landing page","description":"<div>Include the hero section</div>","completed":false,"due_on":"2026-08-01","starts_on":null,"assignees":[{"id":1049715914,"name":"Victor Cooper"}],"comments_count":2,"app_url":"https://3.basecamp.com/1234567/buckets/2085958499/todos/1069479852"}],"totalCount":8,"nextPage":null,"nextPageUrl":null}
   */
  async listTodos(projectId, todolistId, status, completed, page) {
    if (!projectId) throw new Error('Project is required.')
    if (!todolistId) throw new Error('To-do List is required.')

    const query = {}
    const statusValue = this.#resolveChoice(status, RECORDING_STATUS_MAP)

    if (statusValue) query.status = statusValue
    if (this.#normalizeBoolean(completed)) query.completed = true
    if (page) query.page = page

    const response = await this.#apiRequest({
      url: `${ this.#apiBase() }/buckets/${ projectId }/todolists/${ todolistId }/todos.json`,
      query,
      logTag: 'listTodos',
    })

    return this.#withPagination(response)
  }

  /**
   * @operationName Get To-do
   * @category To-dos
   * @description Retrieves a single to-do by id, including its content, rich-text description, due date, start date, assignees, completion subscribers, completion state, and comment count.
   * @route GET /get-todo
   * @paramDef {"type":"String","label":"Project","name":"projectId","required":true,"dictionary":"getProjectsDictionary","description":"The project the to-do belongs to."}
   * @paramDef {"type":"String","label":"To-do ID","name":"todoId","required":true,"description":"The numeric id of the to-do (from List To-dos)."}
   * @returns {Object}
   * @sampleResult {"id":1069479852,"status":"active","type":"Todo","content":"Design the landing page","description":"<div>Include the hero section</div>","completed":false,"due_on":"2026-08-01","starts_on":null,"assignees":[{"id":1049715914,"name":"Victor Cooper"}],"completion_subscribers":[],"comments_count":2,"app_url":"https://3.basecamp.com/1234567/buckets/2085958499/todos/1069479852"}
   */
  async getTodo(projectId, todoId) {
    if (!projectId) throw new Error('Project is required.')
    if (!todoId) throw new Error('To-do ID is required.')

    const { body } = await this.#apiRequest({
      url: `${ this.#apiBase() }/buckets/${ projectId }/todos/${ todoId }.json`,
      logTag: 'getTodo',
    })

    return body
  }

  /**
   * @operationName Create To-do
   * @category To-dos
   * @description Creates a new to-do in a to-do list. Content is the task text; the optional description supports simple HTML. Assignees and completion subscribers are set by numeric people ids (use the people dictionary or List Project People to find them). Set Notify to email the assignees about the new task. Due and start dates use YYYY-MM-DD format. Returns the new to-do.
   * @route POST /create-todo
   * @paramDef {"type":"String","label":"Project","name":"projectId","required":true,"dictionary":"getProjectsDictionary","description":"The project to create the to-do in."}
   * @paramDef {"type":"String","label":"To-do List","name":"todolistId","required":true,"dictionary":"getTodoListsDictionary","dependsOn":["projectId"],"description":"The to-do list to add the to-do to. Choose a project above to pick from its lists."}
   * @paramDef {"type":"String","label":"Content","name":"content","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The task text, e.g. \"Design the landing page\"."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional longer description; simple HTML formatting is supported."}
   * @paramDef {"type":"Array<Number>","label":"Assignee IDs","name":"assigneeIds","description":"Numeric ids of the people to assign, e.g. [1049715914]. Find ids with List Project People."}
   * @paramDef {"type":"Array<Number>","label":"Completion Subscriber IDs","name":"completionSubscriberIds","description":"Numeric ids of the people to notify when the to-do is completed."}
   * @paramDef {"type":"Boolean","label":"Notify Assignees","name":"notify","uiComponent":{"type":"CHECKBOX"},"description":"When enabled, the assignees are notified about the new to-do."}
   * @paramDef {"type":"String","label":"Due On","name":"dueOn","uiComponent":{"type":"DATE_PICKER"},"description":"Due date in YYYY-MM-DD format."}
   * @paramDef {"type":"String","label":"Starts On","name":"startsOn","uiComponent":{"type":"DATE_PICKER"},"description":"Start date in YYYY-MM-DD format (shown as a date range together with Due On)."}
   * @returns {Object}
   * @sampleResult {"id":1069479853,"status":"active","type":"Todo","content":"Write the launch announcement","description":"<div>Draft for review by Friday</div>","completed":false,"due_on":"2026-08-05","assignees":[{"id":1049715914,"name":"Victor Cooper"}],"app_url":"https://3.basecamp.com/1234567/buckets/2085958499/todos/1069479853"}
   */
  async createTodo(projectId, todolistId, content, description, assigneeIds, completionSubscriberIds, notify, dueOn, startsOn) {
    if (!projectId) throw new Error('Project is required.')
    if (!todolistId) throw new Error('To-do List is required.')
    if (!content) throw new Error('Content is required.')

    const body = { content }

    if (description) body.description = description

    const parsedAssignees = this.#parseIdArray(assigneeIds, 'Assignee IDs')
    const parsedSubscribers = this.#parseIdArray(completionSubscriberIds, 'Completion Subscriber IDs')

    if (parsedAssignees) body.assignee_ids = parsedAssignees
    if (parsedSubscribers) body.completion_subscriber_ids = parsedSubscribers

    const notifyValue = this.#normalizeBoolean(notify)

    if (notifyValue !== undefined) body.notify = notifyValue
    if (dueOn) body.due_on = dueOn
    if (startsOn) body.starts_on = startsOn

    const { body: todo } = await this.#apiRequest({
      url: `${ this.#apiBase() }/buckets/${ projectId }/todolists/${ todolistId }/todos.json`,
      method: 'post',
      body,
      logTag: 'createTodo',
    })

    return todo
  }

  /**
   * @operationName Update To-do
   * @category To-dos
   * @description Updates an existing to-do. The Basecamp API replaces the whole to-do on update (omitted fields would be cleared), so this action fetches the current to-do first and merges your changes — only the fields you provide are changed, everything else keeps its current value. Returns the updated to-do.
   * @route PUT /update-todo
   * @paramDef {"type":"String","label":"Project","name":"projectId","required":true,"dictionary":"getProjectsDictionary","description":"The project the to-do belongs to."}
   * @paramDef {"type":"String","label":"To-do ID","name":"todoId","required":true,"description":"The numeric id of the to-do to update (from List To-dos)."}
   * @paramDef {"type":"String","label":"Content","name":"content","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"New task text. Leave empty to keep the current text."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New description (simple HTML supported). Leave empty to keep the current description."}
   * @paramDef {"type":"Array<Number>","label":"Assignee IDs","name":"assigneeIds","description":"Replacement list of assignee people ids, e.g. [1049715914]. Leave empty to keep the current assignees."}
   * @paramDef {"type":"Array<Number>","label":"Completion Subscriber IDs","name":"completionSubscriberIds","description":"Replacement list of people ids to notify on completion. Leave empty to keep the current subscribers."}
   * @paramDef {"type":"Boolean","label":"Notify Assignees","name":"notify","uiComponent":{"type":"CHECKBOX"},"description":"When enabled, the assignees are notified about the change."}
   * @paramDef {"type":"String","label":"Due On","name":"dueOn","uiComponent":{"type":"DATE_PICKER"},"description":"New due date in YYYY-MM-DD format. Leave empty to keep the current due date."}
   * @paramDef {"type":"String","label":"Starts On","name":"startsOn","uiComponent":{"type":"DATE_PICKER"},"description":"New start date in YYYY-MM-DD format. Leave empty to keep the current start date."}
   * @returns {Object}
   * @sampleResult {"id":1069479852,"status":"active","type":"Todo","content":"Design the landing page (v2)","description":"<div>Include the hero section</div>","completed":false,"due_on":"2026-08-08","assignees":[{"id":1049715914,"name":"Victor Cooper"}],"app_url":"https://3.basecamp.com/1234567/buckets/2085958499/todos/1069479852"}
   */
  async updateTodo(projectId, todoId, content, description, assigneeIds, completionSubscriberIds, notify, dueOn, startsOn) {
    if (!projectId) throw new Error('Project is required.')
    if (!todoId) throw new Error('To-do ID is required.')

    // Basecamp's to-do update is a full replace — any omitted field is cleared. Fetch the current
    // to-do and merge so callers can change one field without wiping the rest.
    const { body: existing } = await this.#apiRequest({
      url: `${ this.#apiBase() }/buckets/${ projectId }/todos/${ todoId }.json`,
      logTag: 'updateTodo(fetch)',
    })

    const parsedAssignees = this.#parseIdArray(assigneeIds, 'Assignee IDs')
    const parsedSubscribers = this.#parseIdArray(completionSubscriberIds, 'Completion Subscriber IDs')

    const body = {
      content: content || existing?.content,
      description: description !== undefined && description !== null && description !== ''
        ? description
        : existing?.description || '',
      assignee_ids: parsedAssignees || (existing?.assignees || []).map(person => person.id),
      completion_subscriber_ids: parsedSubscribers || (existing?.completion_subscribers || []).map(person => person.id),
      due_on: dueOn || existing?.due_on || null,
      starts_on: startsOn || existing?.starts_on || null,
    }

    const notifyValue = this.#normalizeBoolean(notify)

    if (notifyValue !== undefined) body.notify = notifyValue

    const { body: todo } = await this.#apiRequest({
      url: `${ this.#apiBase() }/buckets/${ projectId }/todos/${ todoId }.json`,
      method: 'put',
      body,
      logTag: 'updateTodo',
    })

    return todo
  }

  /**
   * @operationName Complete To-do
   * @category To-dos
   * @description Marks a to-do as completed. People subscribed to the to-do's completion are notified by Basecamp. Use Uncomplete To-do to revert.
   * @route POST /complete-todo
   * @paramDef {"type":"String","label":"Project","name":"projectId","required":true,"dictionary":"getProjectsDictionary","description":"The project the to-do belongs to."}
   * @paramDef {"type":"String","label":"To-do ID","name":"todoId","required":true,"description":"The numeric id of the to-do to complete (from List To-dos)."}
   * @returns {Object}
   * @sampleResult {"completed":true,"todoId":"1069479852"}
   */
  async completeTodo(projectId, todoId) {
    if (!projectId) throw new Error('Project is required.')
    if (!todoId) throw new Error('To-do ID is required.')

    await this.#apiRequest({
      url: `${ this.#apiBase() }/buckets/${ projectId }/todos/${ todoId }/completion.json`,
      method: 'post',
      logTag: 'completeTodo',
    })

    return { completed: true, todoId: String(todoId) }
  }

  /**
   * @operationName Uncomplete To-do
   * @category To-dos
   * @description Marks a completed to-do as incomplete again, putting it back on the active to-do list.
   * @route DELETE /uncomplete-todo
   * @paramDef {"type":"String","label":"Project","name":"projectId","required":true,"dictionary":"getProjectsDictionary","description":"The project the to-do belongs to."}
   * @paramDef {"type":"String","label":"To-do ID","name":"todoId","required":true,"description":"The numeric id of the to-do to uncomplete."}
   * @returns {Object}
   * @sampleResult {"completed":false,"todoId":"1069479852"}
   */
  async uncompleteTodo(projectId, todoId) {
    if (!projectId) throw new Error('Project is required.')
    if (!todoId) throw new Error('To-do ID is required.')

    await this.#apiRequest({
      url: `${ this.#apiBase() }/buckets/${ projectId }/todos/${ todoId }/completion.json`,
      method: 'delete',
      logTag: 'uncompleteTodo',
    })

    return { completed: false, todoId: String(todoId) }
  }

  // ==========================================================================
  //  RECORDINGS
  // ==========================================================================
  /**
   * @operationName Trash Recording
   * @category Recordings
   * @description Moves any recording to the trash by its id. In Basecamp almost everything is a recording, so this works for to-dos, to-do lists, messages, documents, comments, schedule entries, and campfire lines alike. Trashed recordings are permanently deleted by Basecamp after 30 days; until then they can be restored from the trash in the Basecamp UI.
   * @route PUT /trash-recording
   * @paramDef {"type":"String","label":"Project","name":"projectId","required":true,"dictionary":"getProjectsDictionary","description":"The project the recording belongs to."}
   * @paramDef {"type":"String","label":"Recording ID","name":"recordingId","required":true,"description":"The numeric id of the recording to trash — a to-do, to-do list, message, document, comment, schedule entry, or campfire line id."}
   * @returns {Object}
   * @sampleResult {"trashed":true,"recordingId":"1069479852"}
   */
  async trashRecording(projectId, recordingId) {
    if (!projectId) throw new Error('Project is required.')
    if (!recordingId) throw new Error('Recording ID is required.')

    await this.#apiRequest({
      url: `${ this.#apiBase() }/buckets/${ projectId }/recordings/${ recordingId }/status/trashed.json`,
      method: 'put',
      logTag: 'trashRecording',
    })

    return { trashed: true, recordingId: String(recordingId) }
  }

  // ==========================================================================
  //  MESSAGES
  // ==========================================================================
  /**
   * @operationName List Messages
   * @category Messages
   * @description Lists the messages on a project's message board. The message board is resolved automatically from the project's dock, so only the project id is needed. Results are paginated — the response includes items, totalCount, and nextPage/nextPageUrl when more pages exist. Each message includes its subject, rich-text content, creator, and comment count.
   * @route GET /list-messages
   * @paramDef {"type":"String","label":"Project","name":"projectId","required":true,"dictionary":"getProjectsDictionary","description":"The project whose message board to read."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to fetch (starts at 1). Use nextPage from the previous response to continue."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":1069479351,"status":"active","type":"Message","subject":"Kickoff notes","content":"<div><strong>Welcome!</strong> Here is the plan…</div>","creator":{"id":1049715914,"name":"Victor Cooper"},"comments_count":3,"created_at":"2026-07-01T12:00:00.000Z","app_url":"https://3.basecamp.com/1234567/buckets/2085958499/messages/1069479351"}],"totalCount":5,"nextPage":null,"nextPageUrl":null}
   */
  async listMessages(projectId, page) {
    if (!projectId) throw new Error('Project is required.')

    const tool = await this.#getDockTool(projectId, 'message_board')

    const query = {}

    if (page) query.page = page

    const response = await this.#apiRequest({
      url: `${ this.#apiBase() }/buckets/${ projectId }/message_boards/${ tool.id }/messages.json`,
      query,
      logTag: 'listMessages',
    })

    return this.#withPagination(response)
  }

  /**
   * @operationName Get Message
   * @category Messages
   * @description Retrieves a single message by id, including its subject, full rich-text HTML content, creator, and comment count.
   * @route GET /get-message
   * @paramDef {"type":"String","label":"Project","name":"projectId","required":true,"dictionary":"getProjectsDictionary","description":"The project the message belongs to."}
   * @paramDef {"type":"String","label":"Message ID","name":"messageId","required":true,"description":"The numeric id of the message (from List Messages)."}
   * @returns {Object}
   * @sampleResult {"id":1069479351,"status":"active","type":"Message","subject":"Kickoff notes","content":"<div><strong>Welcome!</strong> Here is the plan…</div>","creator":{"id":1049715914,"name":"Victor Cooper"},"comments_count":3,"created_at":"2026-07-01T12:00:00.000Z","app_url":"https://3.basecamp.com/1234567/buckets/2085958499/messages/1069479351"}
   */
  async getMessage(projectId, messageId) {
    if (!projectId) throw new Error('Project is required.')
    if (!messageId) throw new Error('Message ID is required.')

    const { body } = await this.#apiRequest({
      url: `${ this.#apiBase() }/buckets/${ projectId }/messages/${ messageId }.json`,
      logTag: 'getMessage',
    })

    return body
  }

  /**
   * @operationName Create Message
   * @category Messages
   * @description Posts a new message to a project's message board and publishes it immediately. The message board is resolved automatically from the project's dock. Content is rich text — it may contain HTML such as <strong>, <em>, lists, block quotes, and links. Returns the new message.
   * @route POST /create-message
   * @paramDef {"type":"String","label":"Project","name":"projectId","required":true,"dictionary":"getProjectsDictionary","description":"The project whose message board to post to."}
   * @paramDef {"type":"String","label":"Subject","name":"subject","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The message title."}
   * @paramDef {"type":"String","label":"Content","name":"content","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The message body as rich-text HTML (e.g. <div><strong>Welcome!</strong> Here is the plan…</div>)."}
   * @returns {Object}
   * @sampleResult {"id":1069479352,"status":"active","type":"Message","subject":"Launch update","content":"<div>We ship on Friday.</div>","creator":{"id":1049715914,"name":"Victor Cooper"},"created_at":"2026-07-16T09:30:00.000Z","app_url":"https://3.basecamp.com/1234567/buckets/2085958499/messages/1069479352"}
   */
  async createMessage(projectId, subject, content) {
    if (!projectId) throw new Error('Project is required.')
    if (!subject) throw new Error('Subject is required.')

    const tool = await this.#getDockTool(projectId, 'message_board')

    const body = { subject, status: 'active' }

    if (content) body.content = content

    const { body: message } = await this.#apiRequest({
      url: `${ this.#apiBase() }/buckets/${ projectId }/message_boards/${ tool.id }/messages.json`,
      method: 'post',
      body,
      logTag: 'createMessage',
    })

    return message
  }

  /**
   * @operationName Update Message
   * @category Messages
   * @description Updates a message's subject and/or rich-text content. Only the fields you provide are changed — omitted fields keep their current values (the current message is fetched first and merged). Returns the updated message.
   * @route PUT /update-message
   * @paramDef {"type":"String","label":"Project","name":"projectId","required":true,"dictionary":"getProjectsDictionary","description":"The project the message belongs to."}
   * @paramDef {"type":"String","label":"Message ID","name":"messageId","required":true,"description":"The numeric id of the message to update (from List Messages)."}
   * @paramDef {"type":"String","label":"Subject","name":"subject","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"New message title. Leave empty to keep the current title."}
   * @paramDef {"type":"String","label":"Content","name":"content","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New rich-text HTML body. Leave empty to keep the current body."}
   * @returns {Object}
   * @sampleResult {"id":1069479351,"status":"active","type":"Message","subject":"Kickoff notes (updated)","content":"<div>Here is the revised plan…</div>","app_url":"https://3.basecamp.com/1234567/buckets/2085958499/messages/1069479351"}
   */
  async updateMessage(projectId, messageId, subject, content) {
    if (!projectId) throw new Error('Project is required.')
    if (!messageId) throw new Error('Message ID is required.')

    const { body: existing } = await this.#apiRequest({
      url: `${ this.#apiBase() }/buckets/${ projectId }/messages/${ messageId }.json`,
      logTag: 'updateMessage(fetch)',
    })

    const body = {
      subject: subject || existing?.subject,
      content: content || existing?.content || '',
    }

    const { body: message } = await this.#apiRequest({
      url: `${ this.#apiBase() }/buckets/${ projectId }/messages/${ messageId }.json`,
      method: 'put',
      body,
      logTag: 'updateMessage',
    })

    return message
  }

  // ==========================================================================
  //  COMMENTS
  // ==========================================================================
  /**
   * @operationName List Comments
   * @category Comments
   * @description Lists the comments on any recording — a to-do, message, document, or schedule entry. Pass the recording's id (for example a message id from List Messages or a to-do id from List To-dos). Results are paginated — the response includes items, totalCount, and nextPage/nextPageUrl when more pages exist.
   * @route GET /list-comments
   * @paramDef {"type":"String","label":"Project","name":"projectId","required":true,"dictionary":"getProjectsDictionary","description":"The project the recording belongs to."}
   * @paramDef {"type":"String","label":"Recording ID","name":"recordingId","required":true,"description":"The numeric id of the recording whose comments to list — a to-do, message, document, or schedule entry id."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to fetch (starts at 1). Use nextPage from the previous response to continue."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":1069479361,"status":"active","type":"Comment","content":"<div>Looks great!</div>","creator":{"id":1049715915,"name":"Annie Bryan"},"created_at":"2026-07-10T09:00:00.000Z","app_url":"https://3.basecamp.com/1234567/buckets/2085958499/comments/1069479361"}],"totalCount":3,"nextPage":null,"nextPageUrl":null}
   */
  async listComments(projectId, recordingId, page) {
    if (!projectId) throw new Error('Project is required.')
    if (!recordingId) throw new Error('Recording ID is required.')

    const query = {}

    if (page) query.page = page

    const response = await this.#apiRequest({
      url: `${ this.#apiBase() }/buckets/${ projectId }/recordings/${ recordingId }/comments.json`,
      query,
      logTag: 'listComments',
    })

    return this.#withPagination(response)
  }

  /**
   * @operationName Get Comment
   * @category Comments
   * @description Retrieves a single comment by id, including its rich-text HTML content, creator, and the recording it belongs to.
   * @route GET /get-comment
   * @paramDef {"type":"String","label":"Project","name":"projectId","required":true,"dictionary":"getProjectsDictionary","description":"The project the comment belongs to."}
   * @paramDef {"type":"String","label":"Comment ID","name":"commentId","required":true,"description":"The numeric id of the comment (from List Comments)."}
   * @returns {Object}
   * @sampleResult {"id":1069479361,"status":"active","type":"Comment","content":"<div>Looks great!</div>","creator":{"id":1049715915,"name":"Annie Bryan"},"parent":{"id":1069479351,"title":"Kickoff notes","type":"Message"},"created_at":"2026-07-10T09:00:00.000Z","app_url":"https://3.basecamp.com/1234567/buckets/2085958499/comments/1069479361"}
   */
  async getComment(projectId, commentId) {
    if (!projectId) throw new Error('Project is required.')
    if (!commentId) throw new Error('Comment ID is required.')

    const { body } = await this.#apiRequest({
      url: `${ this.#apiBase() }/buckets/${ projectId }/comments/${ commentId }.json`,
      logTag: 'getComment',
    })

    return body
  }

  /**
   * @operationName Create Comment
   * @category Comments
   * @description Adds a comment to any recording — a to-do, message, document, or schedule entry. Content is rich text and may contain HTML formatting. People subscribed to the recording are notified by Basecamp. Returns the new comment.
   * @route POST /create-comment
   * @paramDef {"type":"String","label":"Project","name":"projectId","required":true,"dictionary":"getProjectsDictionary","description":"The project the recording belongs to."}
   * @paramDef {"type":"String","label":"Recording ID","name":"recordingId","required":true,"description":"The numeric id of the recording to comment on — a to-do, message, document, or schedule entry id."}
   * @paramDef {"type":"String","label":"Content","name":"content","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The comment body as rich-text HTML (e.g. <div>Looks great!</div>)."}
   * @returns {Object}
   * @sampleResult {"id":1069479362,"status":"active","type":"Comment","content":"<div>Shipping this today.</div>","creator":{"id":1049715914,"name":"Victor Cooper"},"created_at":"2026-07-16T10:00:00.000Z","app_url":"https://3.basecamp.com/1234567/buckets/2085958499/comments/1069479362"}
   */
  async createComment(projectId, recordingId, content) {
    if (!projectId) throw new Error('Project is required.')
    if (!recordingId) throw new Error('Recording ID is required.')
    if (!content) throw new Error('Content is required.')

    const { body: comment } = await this.#apiRequest({
      url: `${ this.#apiBase() }/buckets/${ projectId }/recordings/${ recordingId }/comments.json`,
      method: 'post',
      body: { content },
      logTag: 'createComment',
    })

    return comment
  }

  // ==========================================================================
  //  CAMPFIRE
  // ==========================================================================
  /**
   * @operationName List Campfires
   * @category Campfire
   * @description Lists all campfires (chat rooms) visible to the connected user across every project. Each campfire includes its id, the project (bucket) it belongs to, and the URL for its chat lines. Results are paginated — the response includes items, totalCount, and nextPage/nextPageUrl when more pages exist.
   * @route GET /list-campfires
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to fetch (starts at 1). Use nextPage from the previous response to continue."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":1069479341,"status":"active","type":"Chat::Transcript","title":"Campfire","bucket":{"id":2085958499,"name":"Marketing Campaign"},"lines_url":"https://3.basecampapi.com/1234567/buckets/2085958499/chats/1069479341/lines.json","app_url":"https://3.basecamp.com/1234567/buckets/2085958499/chats/1069479341"}],"totalCount":4,"nextPage":null,"nextPageUrl":null}
   */
  async listCampfires(page) {
    const query = {}

    if (page) query.page = page

    const response = await this.#apiRequest({
      url: `${ this.#apiBase() }/chats.json`,
      query,
      logTag: 'listCampfires',
    })

    return this.#withPagination(response)
  }

  /**
   * @operationName Get Campfire Lines
   * @category Campfire
   * @description Retrieves the chat lines (messages) from a project's campfire, newest first. If no campfire id is given, the project's main campfire is resolved automatically from its dock. Results are paginated — the response includes items, totalCount, and nextPage/nextPageUrl when more pages exist.
   * @route GET /get-campfire-lines
   * @paramDef {"type":"String","label":"Project","name":"projectId","required":true,"dictionary":"getProjectsDictionary","description":"The project whose campfire to read."}
   * @paramDef {"type":"String","label":"Campfire ID","name":"chatId","description":"Optional campfire id (from List Campfires). Leave empty to use the project's main campfire."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to fetch (starts at 1). Use nextPage from the previous response to continue."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":1069479852,"status":"active","type":"Chat::Lines::Text","content":"The deploy is done","creator":{"id":1049715914,"name":"Victor Cooper"},"created_at":"2026-07-16T15:04:05.000Z"}],"totalCount":25,"nextPage":2,"nextPageUrl":"https://3.basecampapi.com/1234567/buckets/2085958499/chats/1069479341/lines.json?page=2"}
   */
  async getCampfireLines(projectId, chatId, page) {
    if (!projectId) throw new Error('Project is required.')

    const resolvedChatId = chatId || (await this.#getDockTool(projectId, 'chat')).id

    const query = {}

    if (page) query.page = page

    const response = await this.#apiRequest({
      url: `${ this.#apiBase() }/buckets/${ projectId }/chats/${ resolvedChatId }/lines.json`,
      query,
      logTag: 'getCampfireLines',
    })

    return this.#withPagination(response)
  }

  /**
   * @operationName Create Campfire Line
   * @category Campfire
   * @description Posts a chat line (message) to a project's campfire. If no campfire id is given, the project's main campfire is resolved automatically from its dock. Content is rich text and may contain simple HTML. Returns the new chat line.
   * @route POST /create-campfire-line
   * @paramDef {"type":"String","label":"Project","name":"projectId","required":true,"dictionary":"getProjectsDictionary","description":"The project whose campfire to post to."}
   * @paramDef {"type":"String","label":"Campfire ID","name":"chatId","description":"Optional campfire id (from List Campfires). Leave empty to use the project's main campfire."}
   * @paramDef {"type":"String","label":"Content","name":"content","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The chat message text; simple HTML formatting is supported."}
   * @returns {Object}
   * @sampleResult {"id":1069479853,"status":"active","type":"Chat::Lines::Text","content":"Release 2.4 is live","creator":{"id":1049715914,"name":"Victor Cooper"},"created_at":"2026-07-16T15:10:00.000Z"}
   */
  async createCampfireLine(projectId, chatId, content) {
    if (!projectId) throw new Error('Project is required.')
    if (!content) throw new Error('Content is required.')

    const resolvedChatId = chatId || (await this.#getDockTool(projectId, 'chat')).id

    const { body: line } = await this.#apiRequest({
      url: `${ this.#apiBase() }/buckets/${ projectId }/chats/${ resolvedChatId }/lines.json`,
      method: 'post',
      body: { content },
      logTag: 'createCampfireLine',
    })

    return line
  }

  // ==========================================================================
  //  PEOPLE
  // ==========================================================================
  /**
   * @operationName List All People
   * @category People
   * @description Lists every person visible to the connected user across the whole Basecamp account, including their id, name, email address, title, and admin/owner flags. Use the ids for to-do assignees and schedule participants. Results are paginated — the response includes items, totalCount, and nextPage/nextPageUrl when more pages exist.
   * @route GET /list-all-people
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to fetch (starts at 1). Use nextPage from the previous response to continue."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":1049715914,"name":"Victor Cooper","email_address":"victor@honchodesign.com","title":"Chief Strategist","admin":true,"owner":true,"avatar_url":"https://bc3-production-assets-cdn.basecamp-static.com/avatar.png"}],"totalCount":18,"nextPage":2,"nextPageUrl":"https://3.basecampapi.com/1234567/people.json?page=2"}
   */
  async listAllPeople(page) {
    const query = {}

    if (page) query.page = page

    const response = await this.#apiRequest({
      url: `${ this.#apiBase() }/people.json`,
      query,
      logTag: 'listAllPeople',
    })

    return this.#withPagination(response)
  }

  /**
   * @operationName List Project People
   * @category People
   * @description Lists the people with access to a specific project. Use this to find valid assignee and participant ids for that project's to-dos and schedule entries. Results are paginated — the response includes items, totalCount, and nextPage/nextPageUrl when more pages exist.
   * @route GET /list-project-people
   * @paramDef {"type":"String","label":"Project","name":"projectId","required":true,"dictionary":"getProjectsDictionary","description":"The project whose people to list."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to fetch (starts at 1). Use nextPage from the previous response to continue."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":1049715914,"name":"Victor Cooper","email_address":"victor@honchodesign.com","title":"Chief Strategist","admin":true,"owner":true,"avatar_url":"https://bc3-production-assets-cdn.basecamp-static.com/avatar.png"}],"totalCount":6,"nextPage":null,"nextPageUrl":null}
   */
  async listProjectPeople(projectId, page) {
    if (!projectId) throw new Error('Project is required.')

    const query = {}

    if (page) query.page = page

    const response = await this.#apiRequest({
      url: `${ this.#apiBase() }/projects/${ projectId }/people.json`,
      query,
      logTag: 'listProjectPeople',
    })

    return this.#withPagination(response)
  }

  /**
   * @operationName Get Person
   * @category People
   * @description Retrieves a single person by id, including their name, email address, title, company, admin/owner flags, and avatar URL.
   * @route GET /get-person
   * @paramDef {"type":"String","label":"Person","name":"personId","required":true,"dictionary":"getPeopleDictionary","description":"The person to fetch."}
   * @returns {Object}
   * @sampleResult {"id":1049715914,"name":"Victor Cooper","email_address":"victor@honchodesign.com","title":"Chief Strategist","admin":true,"owner":true,"company":{"id":1033447817,"name":"Honcho Design"},"avatar_url":"https://bc3-production-assets-cdn.basecamp-static.com/avatar.png"}
   */
  async getPerson(personId) {
    if (!personId) throw new Error('Person is required.')

    const { body } = await this.#apiRequest({
      url: `${ this.#apiBase() }/people/${ personId }.json`,
      logTag: 'getPerson',
    })

    return body
  }

  /**
   * @operationName Get My Profile
   * @category People
   * @description Retrieves the profile of the connected user — their id, name, email address, title, admin/owner flags, and avatar URL. Useful to find your own person id for assignments and subscriptions.
   * @route GET /get-my-profile
   * @returns {Object}
   * @sampleResult {"id":1049715914,"name":"Victor Cooper","email_address":"victor@honchodesign.com","title":"Chief Strategist","admin":true,"owner":true,"avatar_url":"https://bc3-production-assets-cdn.basecamp-static.com/avatar.png"}
   */
  async getMyProfile() {
    const { body } = await this.#apiRequest({
      url: `${ this.#apiBase() }/my/profile.json`,
      logTag: 'getMyProfile',
    })

    return body
  }

  // ==========================================================================
  //  SCHEDULE
  // ==========================================================================
  /**
   * @operationName List Schedule Entries
   * @category Schedule
   * @description Lists the entries (events) on a project's schedule. The schedule is resolved automatically from the project's dock, so only the project id is needed. Each entry includes its summary, start/end times, all-day flag, and participants. Results are paginated — the response includes items, totalCount, and nextPage/nextPageUrl when more pages exist.
   * @route GET /list-schedule-entries
   * @paramDef {"type":"String","label":"Project","name":"projectId","required":true,"dictionary":"getProjectsDictionary","description":"The project whose schedule to read."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to fetch (starts at 1). Use nextPage from the previous response to continue."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":1069479847,"status":"active","type":"Schedule::Entry","summary":"Team sync","description":"<div>Weekly status call</div>","starts_at":"2026-08-01T15:00:00.000Z","ends_at":"2026-08-01T16:00:00.000Z","all_day":false,"participants":[{"id":1049715914,"name":"Victor Cooper"}],"app_url":"https://3.basecamp.com/1234567/buckets/2085958499/schedule_entries/1069479847"}],"totalCount":2,"nextPage":null,"nextPageUrl":null}
   */
  async listScheduleEntries(projectId, page) {
    if (!projectId) throw new Error('Project is required.')

    const tool = await this.#getDockTool(projectId, 'schedule')

    const query = {}

    if (page) query.page = page

    const response = await this.#apiRequest({
      url: `${ this.#apiBase() }/buckets/${ projectId }/schedules/${ tool.id }/entries.json`,
      query,
      logTag: 'listScheduleEntries',
    })

    return this.#withPagination(response)
  }

  /**
   * @operationName Create Schedule Entry
   * @category Schedule
   * @description Creates an event on a project's schedule. The schedule is resolved automatically from the project's dock. Provide the summary and start/end times in ISO 8601 (e.g. 2026-08-01T15:00:00Z); enable All Day for date-only events. Participants are set by numeric people ids, and Notify controls whether they are notified about the new event. Returns the new schedule entry.
   * @route POST /create-schedule-entry
   * @paramDef {"type":"String","label":"Project","name":"projectId","required":true,"dictionary":"getProjectsDictionary","description":"The project whose schedule to add the event to."}
   * @paramDef {"type":"String","label":"Summary","name":"summary","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The event title, e.g. \"Team sync\"."}
   * @paramDef {"type":"String","label":"Starts At","name":"startsAt","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Event start in ISO 8601 (e.g. 2026-08-01T15:00:00Z). For all-day events a date (YYYY-MM-DD) is enough."}
   * @paramDef {"type":"String","label":"Ends At","name":"endsAt","required":true,"uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Event end in ISO 8601 (e.g. 2026-08-01T16:00:00Z)."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional event description; simple HTML formatting is supported."}
   * @paramDef {"type":"Array<Number>","label":"Participant IDs","name":"participantIds","description":"Numeric ids of the people to add as participants, e.g. [1049715914]. Find ids with List Project People."}
   * @paramDef {"type":"Boolean","label":"All Day","name":"allDay","uiComponent":{"type":"CHECKBOX"},"description":"When enabled, the event is an all-day event (times are ignored, only the dates are used)."}
   * @paramDef {"type":"Boolean","label":"Notify Participants","name":"notify","uiComponent":{"type":"CHECKBOX"},"description":"When enabled, the participants are notified about the new event."}
   * @returns {Object}
   * @sampleResult {"id":1069479848,"status":"active","type":"Schedule::Entry","summary":"Launch review","starts_at":"2026-08-05T14:00:00.000Z","ends_at":"2026-08-05T15:00:00.000Z","all_day":false,"participants":[{"id":1049715914,"name":"Victor Cooper"}],"app_url":"https://3.basecamp.com/1234567/buckets/2085958499/schedule_entries/1069479848"}
   */
  async createScheduleEntry(projectId, summary, startsAt, endsAt, description, participantIds, allDay, notify) {
    if (!projectId) throw new Error('Project is required.')
    if (!summary) throw new Error('Summary is required.')
    if (!startsAt) throw new Error('Starts At is required.')
    if (!endsAt) throw new Error('Ends At is required.')

    const tool = await this.#getDockTool(projectId, 'schedule')

    const body = { summary, starts_at: startsAt, ends_at: endsAt }

    if (description) body.description = description

    const parsedParticipants = this.#parseIdArray(participantIds, 'Participant IDs')

    if (parsedParticipants) body.participant_ids = parsedParticipants

    const allDayValue = this.#normalizeBoolean(allDay)
    const notifyValue = this.#normalizeBoolean(notify)

    if (allDayValue !== undefined) body.all_day = allDayValue
    if (notifyValue !== undefined) body.notify = notifyValue

    const { body: entry } = await this.#apiRequest({
      url: `${ this.#apiBase() }/buckets/${ projectId }/schedules/${ tool.id }/entries.json`,
      method: 'post',
      body,
      logTag: 'createScheduleEntry',
    })

    return entry
  }

  // ==========================================================================
  //  DOCUMENTS
  // ==========================================================================
  /**
   * @operationName List Documents
   * @category Documents
   * @description Lists the documents in a project's Docs & Files vault. The vault is resolved automatically from the project's dock, so only the project id is needed. Each document includes its title, creator, and comment count (fetch a single document for its full content). Results are paginated — the response includes items, totalCount, and nextPage/nextPageUrl when more pages exist.
   * @route GET /list-documents
   * @paramDef {"type":"String","label":"Project","name":"projectId","required":true,"dictionary":"getProjectsDictionary","description":"The project whose documents to list."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to fetch (starts at 1). Use nextPage from the previous response to continue."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":1069479894,"status":"active","type":"Document","title":"Launch Plan","creator":{"id":1049715914,"name":"Victor Cooper"},"comments_count":1,"created_at":"2026-07-02T08:00:00.000Z","app_url":"https://3.basecamp.com/1234567/buckets/2085958499/documents/1069479894"}],"totalCount":4,"nextPage":null,"nextPageUrl":null}
   */
  async listDocuments(projectId, page) {
    if (!projectId) throw new Error('Project is required.')

    const tool = await this.#getDockTool(projectId, 'vault')

    const query = {}

    if (page) query.page = page

    const response = await this.#apiRequest({
      url: `${ this.#apiBase() }/buckets/${ projectId }/vaults/${ tool.id }/documents.json`,
      query,
      logTag: 'listDocuments',
    })

    return this.#withPagination(response)
  }

  /**
   * @operationName Get Document
   * @category Documents
   * @description Retrieves a single document by id, including its title, full rich-text HTML content, creator, and comment count.
   * @route GET /get-document
   * @paramDef {"type":"String","label":"Project","name":"projectId","required":true,"dictionary":"getProjectsDictionary","description":"The project the document belongs to."}
   * @paramDef {"type":"String","label":"Document ID","name":"documentId","required":true,"description":"The numeric id of the document (from List Documents)."}
   * @returns {Object}
   * @sampleResult {"id":1069479894,"status":"active","type":"Document","title":"Launch Plan","content":"<div><h1>Phase one</h1><p>Ship the beta…</p></div>","creator":{"id":1049715914,"name":"Victor Cooper"},"comments_count":1,"created_at":"2026-07-02T08:00:00.000Z","app_url":"https://3.basecamp.com/1234567/buckets/2085958499/documents/1069479894"}
   */
  async getDocument(projectId, documentId) {
    if (!projectId) throw new Error('Project is required.')
    if (!documentId) throw new Error('Document ID is required.')

    const { body } = await this.#apiRequest({
      url: `${ this.#apiBase() }/buckets/${ projectId }/documents/${ documentId }.json`,
      logTag: 'getDocument',
    })

    return body
  }

  /**
   * @operationName Create Document
   * @category Documents
   * @description Creates a new document in a project's Docs & Files vault and publishes it immediately. The vault is resolved automatically from the project's dock. Content is rich text — it may contain HTML such as headings, lists, block quotes, and links. Returns the new document.
   * @route POST /create-document
   * @paramDef {"type":"String","label":"Project","name":"projectId","required":true,"dictionary":"getProjectsDictionary","description":"The project to create the document in."}
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"The document title."}
   * @paramDef {"type":"String","label":"Content","name":"content","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The document body as rich-text HTML (e.g. <div><h1>Plan</h1><p>Details…</p></div>)."}
   * @returns {Object}
   * @sampleResult {"id":1069479895,"status":"active","type":"Document","title":"Retro Notes","content":"<div><p>What went well…</p></div>","creator":{"id":1049715914,"name":"Victor Cooper"},"created_at":"2026-07-16T11:00:00.000Z","app_url":"https://3.basecamp.com/1234567/buckets/2085958499/documents/1069479895"}
   */
  async createDocument(projectId, title, content) {
    if (!projectId) throw new Error('Project is required.')
    if (!title) throw new Error('Title is required.')

    const tool = await this.#getDockTool(projectId, 'vault')

    const body = { title, status: 'active' }

    if (content) body.content = content

    const { body: document } = await this.#apiRequest({
      url: `${ this.#apiBase() }/buckets/${ projectId }/vaults/${ tool.id }/documents.json`,
      method: 'post',
      body,
      logTag: 'createDocument',
    })

    return document
  }

  /**
   * @operationName Update Document
   * @category Documents
   * @description Updates a document's title and/or rich-text content. Only the fields you provide are changed — omitted fields keep their current values (the current document is fetched first and merged). Returns the updated document.
   * @route PUT /update-document
   * @paramDef {"type":"String","label":"Project","name":"projectId","required":true,"dictionary":"getProjectsDictionary","description":"The project the document belongs to."}
   * @paramDef {"type":"String","label":"Document ID","name":"documentId","required":true,"description":"The numeric id of the document to update (from List Documents)."}
   * @paramDef {"type":"String","label":"Title","name":"title","uiComponent":{"type":"SINGLE_LINE_TEXT"},"description":"New document title. Leave empty to keep the current title."}
   * @paramDef {"type":"String","label":"Content","name":"content","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New rich-text HTML body. Leave empty to keep the current body."}
   * @returns {Object}
   * @sampleResult {"id":1069479894,"status":"active","type":"Document","title":"Launch Plan v2","content":"<div><h1>Phase one</h1><p>Ship the beta…</p></div>","app_url":"https://3.basecamp.com/1234567/buckets/2085958499/documents/1069479894"}
   */
  async updateDocument(projectId, documentId, title, content) {
    if (!projectId) throw new Error('Project is required.')
    if (!documentId) throw new Error('Document ID is required.')

    const { body: existing } = await this.#apiRequest({
      url: `${ this.#apiBase() }/buckets/${ projectId }/documents/${ documentId }.json`,
      logTag: 'updateDocument(fetch)',
    })

    const body = {
      title: title || existing?.title,
      content: content || existing?.content || '',
    }

    const { body: document } = await this.#apiRequest({
      url: `${ this.#apiBase() }/buckets/${ projectId }/documents/${ documentId }.json`,
      method: 'put',
      body,
      logTag: 'updateDocument',
    })

    return document
  }

  // ==========================================================================
  //  DICTIONARIES
  // ==========================================================================
  /**
   * @registerAs DICTIONARY
   * @operationName Get Projects Dictionary
   * @description Lists active projects for selection in dependent parameters, with the project name as the label.
   * @route POST /get-projects-dictionary
   * @paramDef {"type":"getProjectsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Marketing Campaign","value":"2085958499","note":"Q3 launch planning"}],"cursor":"2"}
   */
  async getProjectsDictionary(payload) {
    const { search, cursor } = payload || {}

    const query = {}

    if (cursor) query.page = Number(cursor)

    const response = await this.#apiRequest({
      url: `${ this.#apiBase() }/projects.json`,
      query,
      logTag: 'getProjectsDictionary',
    })

    const { items: projects, nextPage } = this.#withPagination(response)
    const term = (search || '').toLowerCase()

    const items = projects
      .filter(project => !term || (project.name || '').toLowerCase().includes(term))
      .map(project => ({
        label: project.name,
        value: String(project.id),
        note: project.description || undefined,
      }))

    return { items, cursor: nextPage ? String(nextPage) : null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get To-do Lists Dictionary
   * @description Lists the to-do lists of the project chosen in a dependent parameter, with the list name as the label and its completion ratio as the note.
   * @route POST /get-todo-lists-dictionary
   * @paramDef {"type":"getTodoListsDictionary__payload","label":"Payload","name":"payload","description":"Search text, pagination cursor, and the project criteria whose to-do lists to list."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Launch checklist","value":"1069479520","note":"2/8 completed"}],"cursor":null}
   */
  async getTodoListsDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const projectId = criteria?.projectId

    if (!projectId) {
      return { items: [], cursor: null }
    }

    const tool = await this.#getDockTool(projectId, 'todoset')

    const query = {}

    if (cursor) query.page = Number(cursor)

    const response = await this.#apiRequest({
      url: `${ this.#apiBase() }/buckets/${ projectId }/todosets/${ tool.id }/todolists.json`,
      query,
      logTag: 'getTodoListsDictionary',
    })

    const { items: todolists, nextPage } = this.#withPagination(response)
    const term = (search || '').toLowerCase()

    const items = todolists
      .filter(todolist => !term || (todolist.name || '').toLowerCase().includes(term))
      .map(todolist => ({
        label: todolist.name,
        value: String(todolist.id),
        note: todolist.completed_ratio ? `${ todolist.completed_ratio } completed` : undefined,
      }))

    return { items, cursor: nextPage ? String(nextPage) : null }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get People Dictionary
   * @description Lists people for selection in dependent parameters, with the person's name as the label and their email address as the note. When a project criteria is supplied, only people with access to that project are listed; otherwise everyone visible in the account is.
   * @route POST /get-people-dictionary
   * @paramDef {"type":"getPeopleDictionary__payload","label":"Payload","name":"payload","description":"Search text, pagination cursor, and an optional project criteria to scope the people list."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Victor Cooper","value":"1049715914","note":"victor@honchodesign.com"}],"cursor":null}
   */
  async getPeopleDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const projectId = criteria?.projectId

    const url = projectId
      ? `${ this.#apiBase() }/projects/${ projectId }/people.json`
      : `${ this.#apiBase() }/people.json`

    const query = {}

    if (cursor) query.page = Number(cursor)

    const response = await this.#apiRequest({
      url,
      query,
      logTag: 'getPeopleDictionary',
    })

    const { items: people, nextPage } = this.#withPagination(response)
    const term = (search || '').toLowerCase()

    const items = people
      .filter(person =>
        !term ||
        (person.name || '').toLowerCase().includes(term) ||
        (person.email_address || '').toLowerCase().includes(term))
      .map(person => ({
        label: person.name,
        value: String(person.id),
        note: person.email_address || undefined,
      }))

    return { items, cursor: nextPage ? String(nextPage) : null }
  }
}

Flowrunner.ServerCode.addService(Basecamp, [
  {
    name: 'clientId',
    displayName: 'Client ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'The Client ID of your 37signals Launchpad app. Create one at https://launchpad.37signals.com/integrations.',
  },
  {
    name: 'clientSecret',
    displayName: 'Client Secret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'The Client Secret of your 37signals Launchpad app.',
  },
])
