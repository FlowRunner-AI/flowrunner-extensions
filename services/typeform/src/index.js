'use strict'

const logger = {
  info: (...args) => console.log('[Typeform Service] info:', ...args),
  debug: (...args) => console.log('[Typeform Service] debug:', ...args),
  error: (...args) => console.log('[Typeform Service] error:', ...args),
  warn: (...args) => console.log('[Typeform Service] warn:', ...args),
}

const QuestionTypes = {
  dropdown: 'dropdown',
  multiple_choice: 'multiple_choice',
  ranking: 'ranking',
}

const API_BASE_URL = 'https://api.typeform.com'

const DEFAULT_SCOPE_LIST = [
  'offline', // this scope is required for oauth authorization
  'accounts:read',
  'forms:write',
  'forms:read',
  'images:write',
  'images:read',
  'themes:write',
  'themes:read',
  'responses:read',
  'responses:write',
  'workspaces:read',
  'workspaces:write',
]

const DEFAULT_SCOPE_STRING = DEFAULT_SCOPE_LIST.join(' ')

const DEFAULT_LIMIT = 100

/**
 *  @requireOAuth
 *  @integrationName Typeform
 *  @integrationIcon /icon.png
 **/
class Typeform {
  constructor(config) {
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
    this.scopes = DEFAULT_SCOPE_STRING
  }

  async #apiRequest({ url, method, body, query, logTag, headers }) {
    method = method || 'get'

    if (query) {
      query = cleanupObject(query)
    }

    try {
      logger.debug(`${ logTag } - api request: [${ method }::${ url }] q=[${ JSON.stringify(query) }]`)

      return await Flowrunner.Request[method](url)
        .set(this.#getAccessTokenHeader())
        .set(headers)
        .query(query)
        .send(body)
    } catch (error) {
      logger.error(`${ logTag } - error: ${ JSON.stringify({ ...error }) }`)

      throw error
    }
  }

  #getAccessTokenHeader(accessToken) {
    return {
      Authorization: `Bearer ${ accessToken || this.#getAccessToken() }`,
    }
  }

  /**
   * @registerAs SYSTEM
   * @route GET /getOAuth2ConnectionURL
   * @returns {String}
   */
  async getOAuth2ConnectionURL() {
    const params = new URLSearchParams()

    params.append('client_id', this.clientId)
    params.append('response_type', 'code')
    params.append('scope', this.scopes)

    const connectionURL = `${ API_BASE_URL }/oauth/authorize?${ params.toString() }`

    logger.debug(`ConnectionURL: ${ connectionURL }`)

    return connectionURL
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
    logger.debug('RefreshToken method parameter:', refreshToken)

    const params = new URLSearchParams()

    params.append('client_id', this.clientId)
    params.append('scope', this.scopes)
    params.append('refresh_token', refreshToken)
    params.append('grant_type', 'refresh_token')
    params.append('client_secret', this.clientSecret)

    try {
      const { access_token, expires_in } = await Flowrunner.Request.post(`${ API_BASE_URL }/oauth/token`)
        .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        .send(params.toString())

      return {
        token: access_token,
        expirationInSeconds: expires_in,
      }
    } catch (error) {
      logger.error(`[refreshToken] - error: ${ error.message }`)

      throw error
    }
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
    const { code, redirectURI } = callbackObject

    const params = new URLSearchParams()
    params.append('code', code)
    params.append('redirect_uri', redirectURI)
    params.append('grant_type', 'authorization_code')
    params.append('client_secret', this.clientSecret)
    params.append('client_id', this.clientId)

    let identityName
    let userData = {}
    let codeExchangeResponse = {}

    try {
      codeExchangeResponse = await Flowrunner.Request.post(`${ API_BASE_URL }/oauth/token`)
        .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        .send(params.toString())

      logger.debug(`[executeCallback] codeExchangeResponse response: ${ JSON.stringify(codeExchangeResponse) }`)
    } catch (error) {
      logger.error(`[executeCallback] codeExchangeResponse error: ${ error.message }`)

      return {}
    }

    const { access_token, expires_in, refresh_token } = codeExchangeResponse

    try {
      userData = await Flowrunner.Request.get(`${ API_BASE_URL }/me`).set(this.#getAccessTokenHeader(access_token))

      identityName = `${ userData.alias } (${ userData.email })`

      logger.debug(`[executeCallback] userData response: ${ JSON.stringify(userData) }`)
    } catch (error) {
      logger.debug(`[executeCallback] userData error: ${ JSON.stringify(error) }`)
    }

    return {
      token: access_token,
      expirationInSeconds: expires_in,
      refreshToken: refresh_token,
      connectionIdentityName: identityName || 'Typeform Service Account',
      connectionIdentityImageURL: null,
      overwrite: true,
      userData: userData,
    }
  }

  #getAccessToken() {
    return this.request.headers['oauth-access-token']
  }

  /**
   * @typedef {Object} getWorkspacesDictionary__payload
   * @property {String} [search] - Filter workspaces by search term
   * @property {Number} [cursor] - Pagination cursor for retrieving next page
   */

  /**
   * @typedef {Object} getFormsDictionary__payload
   * @property {String} [search] - Filter forms by search term
   * @property {Number} [cursor] - Pagination cursor for retrieving next page
   * @property {getFormsDictionary__payloadCriteria} [criteria] - Additional filtering criteria
   */

  /**
   * @typedef {Object} getFormsDictionary__payloadCriteria
   * @property {String} workspaceId - ID of the workspace to filter forms
   */

  /**
   * @typedef {Object} getFieldsDictionary__payload
   * @property {String} [search] - Filter fields by search term
   * @property {Number} [cursor] - Pagination cursor for retrieving next page
   * @property {getFieldsDictionary__payloadCriteria} [criteria] - Additional filtering criteria
   */

  /**
   * @typedef {Object} getFieldsDictionary__payloadCriteria
   * @property {String} formId - ID of the form to retrieve fields from
   */

  /**
   * @typedef {Object} getResponsesDictionary__payload
   * @property {String} [search] - Filter responses by search term
   * @property {Number} [cursor] - Pagination cursor for retrieving next page
   * @property {getResponsesDictionary__payloadCriteria} [criteria] - Additional filtering criteria
   */

  /**
   * @typedef {Object} getResponsesDictionary__payloadCriteria
   * @property {String} formId - ID of the form to retrieve responses from
   */

  /**
   * @typedef {Object} getImagesDictionary__payload
   * @property {String} [search] - Filter images by search term
   * @property {Number} [cursor] - Pagination cursor for retrieving next page
   */

  /**
   * @typedef {Object} getThemesDictionary__payload
   * @property {String} [search] - Filter themes by search term
   * @property {Number} [cursor] - Pagination cursor for retrieving next page
   */

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
   * @property {Object} criteria
   */

  /**
   * @operationName Get Workspaces Dictionary
   * @description Retrieves a list of workspaces for dictionary selection with search and pagination support
   * @route POST /get-workspaces-dictionary
   * @registerAs DICTIONARY
   * @paramDef {"type":"getWorkspacesDictionary__payload","label":"Payload","name":"payload","description":"Dictionary payload containing search, cursor, and criteria"}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"My Workspace","value":"abc123","note":"ID: abc123"}],"cursor":2}
   */
  async getWorkspacesDictionary(payload) {
    const { search, cursor } = payload || {}
    const { items, total_items } = await this.#apiRequest({
      logTag: 'getWorkspacesDictionary',
      url: `${ API_BASE_URL }/workspaces`,
      query: { page: cursor, page_size: DEFAULT_LIMIT },
    })

    const filteredWorkspaces = search ? searchFilter(items, ['id', 'name'], search) : items

    return {
      cursor: getCursor(cursor, total_items, DEFAULT_LIMIT),
      items: filteredWorkspaces.map(({ id, name }) => ({ label: name || '[empty]', note: `ID: ${ id }`, value: id })),
    }
  }

  /**
   * @operationName Get Forms Dictionary
   * @description Retrieves a list of forms for dictionary selection with search, pagination, and workspace filtering support
   * @route POST /get-forms-dictionary
   * @registerAs DICTIONARY
   * @paramDef {"type":"getFormsDictionary__payload","label":"Payload","name":"payload","description":"Dictionary payload containing search, cursor, and criteria"}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Contact Form","value":"def456","note":"ID: def456"}],"cursor":2}
   */
  async getFormsDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const { workspaceId } = criteria || {}
    const query = { page: cursor, page_size: DEFAULT_LIMIT }

    if (workspaceId) {
      query.workspace_id = workspaceId
    }

    const { items, total_items } = await this.#apiRequest({
      logTag: 'getFormsDictionary',
      url: `${ API_BASE_URL }/forms`,
      query,
    })

    const filteredForms = search ? searchFilter(items, ['id', 'title'], search) : items

    return {
      cursor: getCursor(cursor, total_items, DEFAULT_LIMIT),
      items: filteredForms.map(({ id, title }) => ({ label: title || '[empty]', note: `ID: ${ id }`, value: id })),
    }
  }

  /**
   * @operationName Get Fields Dictionary
   * @description Retrieves a list of question fields from a form for dictionary selection with search support
   * @route POST /get-fields-dictionary
   * @registerAs DICTIONARY
   * @paramDef {"type":"getFieldsDictionary__payload","label":"Payload","name":"payload","description":"Dictionary payload containing search, cursor, and criteria"}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"What is your name? (short_text)","value":"field123","note":"ID: field123"}]}
   */
  async getFieldsDictionary(payload) {
    const { search, criteria } = payload || {}
    const { formId } = criteria || {}
    const form = await this.#apiRequest({
      logTag: 'getFieldsDictionary',
      url: `${ API_BASE_URL }/forms/${ formId }`,
    })

    const fields = getQuestionFields(form.fields)
    const filteredFields = search ? searchFilter(fields, ['id', 'title', 'type'], search) : fields

    return {
      items: filteredFields.map(({ id, title, type, properties }) => ({
        label: !!properties.fields?.length ? `${ title } (${ type } [${ properties.fields[0].type }])` : `${ title } (${ type })`,
        note: `ID: ${ id }`,
        value: id,
      })),
    }
  }

  /**
   * @operationName Get Responses Dictionary
   * @description Retrieves a list of form responses for dictionary selection with search and pagination support
   * @route POST /get-responses-dictionary
   * @registerAs DICTIONARY
   * @paramDef {"type":"getResponsesDictionary__payload","label":"Payload","name":"payload","description":"Dictionary payload containing search, cursor, and criteria"}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"2024-01-15T10:30:00Z","value":"resp789","note":"ID: resp789"}],"cursor":"token_xyz"}
   */
  async getResponsesDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const { formId } = criteria || {}
    const { items } = await this.#apiRequest({
      logTag: 'getResponsesDictionary',
      url: `${ API_BASE_URL }/forms/${ formId }/responses`,
      query: { page_size: DEFAULT_LIMIT, before: cursor },
    })

    const filteredResponses = search ? searchFilter(items, ['response_id', 'submitted_at'], search) : items

    return {
      cursor: items.length > 0 ? items[items.length - 1].token : null,
      items: filteredResponses.map(({ response_id, submitted_at }) => ({
        label: submitted_at,
        note: `ID: ${ response_id }`,
        value: response_id,
      })),
    }
  }

  /**
   * @operationName Get Images Dictionary
   * @description Retrieves a list of images for dictionary selection with search support
   * @route POST /get-images-dictionary
   * @registerAs DICTIONARY
   * @paramDef {"type":"getImagesDictionary__payload","label":"Payload","name":"payload","description":"Dictionary payload containing search, cursor, and criteria"}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"mountain-sunset.jpg","value":"img456","note":"ID: img456"}]}
   */
  async getImagesDictionary(payload) {
    const { search } = payload || {}
    const images = await this.#apiRequest({ logTag: 'getImagesDictionary', url: `${ API_BASE_URL }/images` })
    const filteredImages = search ? searchFilter(images, ['id', 'file_name'], search) : images

    return {
      items: filteredImages.map(({ id, file_name }) => ({
        label: file_name || '[empty]',
        note: `ID: ${ id }`,
        value: id,
      })),
    }
  }

  /**
   * @operationName Get Themes Dictionary
   * @description Retrieves a list of themes for dictionary selection with search and pagination support
   * @route POST /get-themes-dictionary
   * @registerAs DICTIONARY
   * @paramDef {"type":"getThemesDictionary__payload","label":"Payload","name":"payload","description":"Dictionary payload containing search, cursor, and criteria"}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Default Theme","value":"theme123","note":"ID: theme123"}],"cursor":2}
   */
  async getThemesDictionary(payload) {
    const { search, cursor } = payload || {}
    const { items, total_items } = await this.#apiRequest({
      logTag: 'getThemesDictionary',
      url: `${ API_BASE_URL }/themes`,
      query: { page: cursor, page_size: DEFAULT_LIMIT },
    })

    const filteredThemes = search ? searchFilter(items, ['id', 'name'], search) : items

    return {
      cursor: getCursor(cursor, total_items, DEFAULT_LIMIT),
      items: filteredThemes.map(({ id, name }) => ({ label: name || '[empty]', note: `ID: ${ id }`, value: id })),
    }
  }

  /**
   * @description Retrieves the authenticated user's profile information from the Typeform API.
   *
   * @route GET /me
   * @operationName Get Current Account Info
   * @category Account Management
   * @appearanceColor #89BC62 #89BC62
   *
   * @returns {Object} - User profile information.
   * @sampleResult {"user_id":"01JB2A19R8E3","alias":"UserName","language":"en","email":"user@email.com"}
   */
  async getCurrentAccountInfo() {
    return this.#apiRequest({
      logTag: 'getCurrentAccountInfo',
      url: `${ API_BASE_URL }/me`,
    })
  }

  /**
   * @description Retrieves a list of workspaces for a specific account from Typeform. This method allows filtering of workspaces by search string and supports pagination.
   *
   * @route POST /get-list-workspaces
   * @operationName Get List Workspaces
   * @category Workspace Management
   * @appearanceColor #89BC62 #89BC62
   * @requiredOauth2Scopes workspaces.read
   *
   * @paramDef {"type":"String","label":"Search","name":"search","description":"A string to filter workspaces by their name."}
   * @paramDef {"type":"Number","label":"Page","name":"page","description":"The page of results to retrieve. Default is 1."}
   * @paramDef {"type":"Number","label":"Page Size","name":"page_size","description":"Number of results to retrieve per page. Default is 10. Maximum is 200."}
   *
   * @returns {Object} - Object containing the list of workspaces, the current page, page size, and total workspaces count.
   * @sampleResult {"items":[{"account_id":"ABCD1234","forms":[{"count":12,"href":"https://api.typeform.com/workspaces/a1b2c3/forms"}],"id":"a1b2c3","name":"My Workspace","self":[{"href":"https://api.typeform.com/workspaces/a1b2c3"}],"shared":false}],"page_count":1,"total_items":10}
   */
  async getListWorkspaces(search, page, pageSize) {
    const query = {
      search,
      page,
      page_size: pageSize,
    }

    return this.#apiRequest({
      logTag: 'getListWorkspaces',
      url: `${ API_BASE_URL }/workspaces`,
      query,
    })
  }

  /**
   * @description Creates an empty form with default settings and properties.
   *
   * @route POST /create-empty-form
   * @operationName Create Empty Form
   * @category Form Management
   * @appearanceColor #89BC62 #89BC62
   * @requiredOauth2Scopes forms:write
   *
   * @paramDef {"type":"String","label":"Form Title","name":"title","required":true,"description":"The title of the new form."}
   *
   * @returns {Object} - The newly created empty form object with default settings.
   * @sampleResult {"settings":{"show_number_of_submissions":false,"show_typeform_branding":true,"show_cookie_consent":false,"autosave_progress":true,"language":"en","progress_bar":"proportion","pro_subdomain_enabled":false,"show_question_number":true,"are_uploads_public":false,"hide_navigation":false,"show_progress_bar":true,"meta":{"allow_indexing":false},"is_public":true,"show_key_hint_on_choices":true,"free_form_navigation":false,"show_time_to_complete":true,"use_lead_qualification":false,"is_trial":false},"workspace":{"href":"https://api.typeform.com/workspaces/QGkx7G"},"_links":{"display":"https://43jo3gai46f.typeform.com/to/v7AAgCC0","responses":"https://api.typeform.com/forms/v7AAgCC0/responses"},"thankyou_screens":[{"ref":"default_tys","attachment":{"href":"https://images.typeform.com/images/2dpnUBBkz2VN","type":"image"},"id":"DefaultTyScreen","title":"Thanks for completing this typeform\nNow *create your own* — it's free, easy, & beautiful","type":"thankyou_screen","properties":{"share_icons":false,"show_button":true,"button_text":"Create a *typeform*","button_mode":"default_redirect"}}],"theme":{"href":"https://api.typeform.com/themes/qHWOQ7"},"id":"v7AAgCC0","type":"quiz","title":"Title"}
   */
  async createEmptyForm(title) {
    return this.#apiRequest({
      logTag: 'createEmptyForm',
      method: 'post',
      url: `${ API_BASE_URL }/forms`,
      body: { title },
    })
  }

  /**
   * @description Duplicates an existing form.
   *
   * @route POST /copy-existing-form
   * @operationName Copy Existing Form
   * @category Form Management
   * @appearanceColor #89BC62 #89BC62
   * @requiredOauth2Scopes forms:write
   *
   * @paramDef {"type":"String","label":"Workspace ID","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"The unique ID of the workspace to delete."}
   * @paramDef {"type":"String","label":"Form ID","name":"formId","required":true,"dictionary":"getFormsDictionary","dependsOn":["workspaceId"],"description":"The unique ID of the form to delete."}
   * @paramDef {"type":"String","label":"Form Title","name":"title","description":"The title of the new form."}
   *
   * @returns {Object} - The newly created form object.
   * @sampleResult {"settings":{"show_number_of_submissions":false,"show_typeform_branding":true,"show_cookie_consent":false,"autosave_progress":true,"language":"en","progress_bar":"proportion","pro_subdomain_enabled":false,"show_question_number":true,"are_uploads_public":false,"hide_navigation":false,"show_progress_bar":true,"meta":{"allow_indexing":false},"is_public":true,"show_key_hint_on_choices":true,"free_form_navigation":false,"show_time_to_complete":true,"use_lead_qualification":false,"is_trial":false},"workspace":{"href":"https://api.typeform.com/workspaces/QGkx7G"},"_links":{"display":"https://43jo3gai46f.typeform.com/to/v7AAgCC0","responses":"https://api.typeform.com/forms/v7AAgCC0/responses"},"thankyou_screens":[{"ref":"default_tys","attachment":{"href":"https://images.typeform.com/images/2dpnUBBkz2VN","type":"image"},"id":"DefaultTyScreen","title":"Thanks for completing this typeform\nNow *create your own* — it's free, easy, & beautiful","type":"thankyou_screen","properties":{"share_icons":false,"show_button":true,"button_text":"Create a *typeform*","button_mode":"default_redirect"}}],"theme":{"href":"https://api.typeform.com/themes/qHWOQ7"},"id":"v7AAgCC0","type":"quiz","title":"Title"}
   */
  async duplicatesExistingForm(workspaceId, formId, title) {
    let createdForm = await this.#apiRequest({
      logTag: 'duplicatesExistingForm',
      method: 'post',
      url: `${ API_BASE_URL }/forms/${ formId }/copy`,
      body: {
        workspace_href: `${ API_BASE_URL }/workspaces/${ workspaceId }`,
      },
    })

    if (title) {
      createdForm.title = title

      createdForm = await this.#apiRequest({
        logTag: 'duplicatesExistingForm',
        method: 'put',
        url: `${ API_BASE_URL }/forms/${ createdForm.id }`,
        body: createdForm,
      })
    }

    return createdForm
  }

  /**
   * @description Updates the options for a dropdown, multiple choice, or ranking question in a Typeform.
   *
   * @route PUT /update-question-options
   * @operationName Update Question Options
   * @category Form Management
   * @appearanceColor #89BC62 #89BC62
   * @requiredOauth2Scopes forms:write
   *
   * @paramDef {"type":"String","label":"Form ID","name":"formId","required":true,"dictionary":"getFormsDictionary","description":"The unique ID of the form to delete."}
   * @paramDef {"type":"String","label":"Field ID","name":"fieldId","required":true,"dictionary":"getFieldsDictionary","dependsOn":["formId"],"description":"The unique ID of the form to delete."}
   * @paramDef {"type":"Array.<String>","label":"New Options","name":"newOptions","required":true,"description":"An array of new options for the field."}
   *
   * @returns {Object} - The updated form object.
   * @sampleResult {"settings":{"show_number_of_submissions":false,"show_typeform_branding":true,"show_cookie_consent":false,"autosave_progress":true,"language":"en","progress_bar":"proportion","pro_subdomain_enabled":false,"show_question_number":true,"are_uploads_public":false,"hide_navigation":false,"show_progress_bar":true,"meta":{"allow_indexing":false},"is_public":true,"show_key_hint_on_choices":true,"free_form_navigation":false,"show_time_to_complete":true,"use_lead_qualification":false,"is_trial":false},"workspace":{"href":"https://api.typeform.com/workspaces/QGkx7G"},"_links":{"display":"https://43jo3gai46f.typeform.com/to/v7AAgCC0","responses":"https://api.typeform.com/forms/v7AAgCC0/responses"},"thankyou_screens":[{"ref":"default_tys","attachment":{"href":"https://images.typeform.com/images/2dpnUBBkz2VN","type":"image"},"id":"DefaultTyScreen","title":"Thanks for completing this typeform\nNow *create your own* — it's free, easy, & beautiful","type":"thankyou_screen","properties":{"share_icons":false,"show_button":true,"button_text":"Create a *typeform*","button_mode":"default_redirect"}}],"theme":{"href":"https://api.typeform.com/themes/qHWOQ7"},"id":"v7AAgCC0","type":"quiz","title":"Title"}
   */
  async updateFormOptions(formId, fieldId, newOptions) {
    const form = await this.#apiRequest({
      logTag: 'updateFormOptions',
      url: `${ API_BASE_URL }/forms/${ formId }`,
    })

    const data = getUpdatedForm(form, fieldId, newOptions)

    return await this.#apiRequest({
      logTag: 'updateFormOptions',
      method: 'put',
      url: `${ API_BASE_URL }/forms/${ formId }`,
      body: data,
    })
  }

  /**
   * @description Creates a new workspace in Typeform under the user's account with organization role - owner.
   *
   * @route POST /create-workspace
   * @operationName Create Workspace
   * @category Workspace Management
   * @appearanceColor #89BC62 #89BC62
   * @requiredOauth2Scopes workspaces.write
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The name of the new workspace."}
   *
   * @returns {Object} - Object containing details of the created workspace, including ID, name, sharing status, and members.
   * @sampleResult {"name":"My new workspace"}
   */
  async createWorkspace(name) {
    return this.#apiRequest({
      logTag: 'createWorkspace',
      method: 'post',
      url: `${ API_BASE_URL }/workspaces`,
      body: { name },
      headers: { 'Content-Type': 'application/json' },
    })
  }

  /**
   * @description Deletes a workspace in Typeform by its unique ID.
   *
   * @route POST /delete-workspace
   * @operationName Delete Workspace
   * @category Workspace Management
   * @appearanceColor #89BC62 #89BC62
   * @requiredOauth2Scopes workspaces.write
   *
   * @paramDef {"type":"String","label":"Workspace ID","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"The unique ID of the workspace to delete."}
   *
   * @returns {void}
   */
  async deleteWorkspace(workspaceId) {
    return this.#apiRequest({
      logTag: 'deleteWorkspace',
      method: 'delete',
      url: `${ API_BASE_URL }/workspaces/${ workspaceId }`,
    })
  }

  /**
   * @description Retrieves details of a workspace in Typeform by its unique ID.
   *
   * @route POST /get-workspace
   * @operationName Get Workspace
   * @category Workspace Management
   * @appearanceColor #89BC62 #89BC62
   * @requiredOauth2Scopes workspaces.read
   *
   * @paramDef {"type":"String","label":"Workspace ID","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"The unique ID of the workspace to retrieve."}
   *
   * @returns {Object} - Object containing details of the workspace, including ID, name, sharing status, and members.
   * @sampleResult {"shared":false,"default":false,"account_id":"ACCOUNT_ID_123","members":[{"role":"owner","permissions":["workspace:delete","workspace:update","workspace:write_members","workspace:read_members","workspace:read_forms","workspace:write_forms","workspace:update_forms","workspace:delete_forms","workspace:publish_forms","workspace:move_forms","workspace:read_responses","workspace:download_responses","workspace:delete_responses","workspace:tag_responses","workspace:read_integrations","workspace:write_integrations","workspace:delete_integrations","workspace:read_webhooks","workspace:write_webhooks","workspace:delete_webhooks","workspace:read_share","workspace:write_share","forms:write","forms:delete","responses:delete","forms:move"],"name":"USER_NAME","account_member_id":"MEMBER_ID_456","id":"MEMBER_ID_789","user":{"name":"USER_NAME","id":"USER_ID_101112","email":"USER_EMAIL"},"email":"USER_EMAIL"}],"name":"testName1","self":{"href":"https://api.typeform.com/workspaces/WORKSPACE_ID_131415"},"id":"WORKSPACE_ID_161718","forms":{"count":0,"href":"https://api.typeform.com/forms?workspace_id=WORKSPACE_ID_131415"}}
   */
  async getWorkspace(workspaceId) {
    return this.#apiRequest({
      logTag: 'getWorkspace',
      url: `${ API_BASE_URL }/workspaces/${ workspaceId }`,
    })
  }

  /**
   * @description Updates a workspace by applying specified operations to its elements, such as renaming or modifying members.
   *
   * @route POST /update-workspaces
   * @operationName Update Workspace
   * @category Workspace Management
   * @appearanceColor #89BC62 #89BC62
   * @requiredOauth2Scopes workspaces.write
   *
   * @paramDef {"type":"String","label":"Workspace ID","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"Unique identifier for the workspace to be updated."}
   * @paramDef {"type":"Array.<Object>","label":"Changes","name":"changes","required":true,"description":"Array of operations to apply to the workspace. Each operation includes 'op' (operation type), 'path' (targeted element), and 'value'."}
   *
   * @returns {void}
   */
  async updateWorkspace(workspaceId, changes) {
    return this.#apiRequest({
      logTag: 'updateWorkspace',
      method: 'patch',
      url: `${ API_BASE_URL }/workspaces/${ workspaceId }`,
      body: changes,
    })
  }

  /**
   * @description Retrieves a list of JSON descriptions for all forms in the Typeform account. Supports filtering, sorting, and pagination.
   *
   * @route POST /get-list-forms
   * @operationName Get List Forms
   * @category Form Management
   * @appearanceColor #89BC62 #89BC62
   * @requiredOauth2Scopes forms.read
   *
   * @paramDef {"type":"String","label":"Workspace ID","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"The workspace ID to retrieve forms from."}
   * @paramDef {"type":"String","label":"Search","name":"search","description":"A string to filter forms that contain the specified text."}
   * @paramDef {"type":"Number","label":"Page","name":"page","description":"The page number to retrieve. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","description":"Number of results per page. Defaults to 10, max is 200."}
   * @paramDef {"type":"String","label":"Sort By","name":"sortBy","uiComponent":{"type":"DROPDOWN","options":{"values":["created_at","last_updated_at"]}},"description":"Sort results by created_at or last_updated_at."}
   * @paramDef {"type":"String","label":"Order By","name":"orderBy","uiComponent":{"type":"DROPDOWN","options":{"values":["asc","desc"]}},"description":"Sort order, either asc or desc."}
   *
   * @returns {Object} - Object containing the list of forms, pagination details, and total items.
   * @sampleResult {"items":[{}],"page_count":1,"total_items":4}
   */
  async getListForms(workspaceId, search, page, pageSize, sortBy, orderBy) {
    const query = {
      search,
      page,
      page_size: pageSize,
      workspace_id: workspaceId,
      sort_by: sortBy,
      order_by: orderBy,
    }

    return this.#apiRequest({
      logTag: 'getListForms',
      url: `${ API_BASE_URL }/forms`,
      query,
    })
  }

  /**
   * @description Deletes a specific form in Typeform along with all its responses.
   *
   * @route POST /delete-form
   * @operationName Delete Form
   * @category Form Management
   * @appearanceColor #89BC62 #89BC62
   * @requiredOauth2Scopes forms.write
   *
   * @paramDef {"type":"String","label":"Form ID","name":"formId","required":true,"dictionary":"getFormsDictionary","description":"The unique ID of the form to delete."}
   *
   * @returns {void}
   */
  async deleteForm(formId) {
    return this.#apiRequest({
      logTag: 'getListForms',
      method: 'delete',
      url: `${ API_BASE_URL }/forms/${ formId }`,
    })
  }

  /**
   * @description Retrieves a form by its unique form ID, including any associated themes and images.
   *
   * @route POST /get-form
   * @operationName Get Form
   * @category Form Management
   * @appearanceColor #89BC62 #89BC62
   * @requiredOauth2Scopes forms.read
   *
   * @paramDef {"type":"String","label":"Form ID","name":"formId","required":true,"dictionary":"getFormsDictionary","description":"The unique ID of the form to retrieve."}
   *
   * @returns {Object} - Object containing the form's details, including theme and images.
   * @sampleResult {"id":"id","title":"title","language":"en","fields":[{}],"hidden":["string"],"variables":{"score":0,"price":0},"welcome_screens":[{"ref":"nice-readable-welcome-ref","title":"Welcome Title","properties":{"description":"Cool description for the welcome","show_button":true,"button_text":"start"},"attachment":{"type":"image","href":{"image":{"value":"https://images.typeform.com/images/4bcd3"},"Pexels":{"value":"https://www.pexels.com/video/people-traveling-in-the-desert-1739011"},"Vimeo":{"value":"https://vimeo.com/245714980"},"YouTube":{"value":"https://www.youtube.com/watch?v=cGk3tZIIpXE"}},"scale":0,"properties":{"description":"description"}},"layout":{"type":"float","placement":"left","attachment":{"type":"image","href":{"image":{"value":"https://images.typeform.com/images/4bcd3"},"Pexels":{"value":"https://www.pexels.com/video/people-traveling-in-the-desert-1739011"},"Vimeo":{"value":"https://vimeo.com/245714980"},"YouTube":{"value":"https://www.youtube.com/watch?v=cGk3tZIIpXE"}},"scale":0,"properties":{"description":"description"}},"viewport_overrides":{"small":{"type":"float","placement":"left"},"large":{"type":"split","placement":"right"}}}}],"thankyou_screens":[{"ref":"nice-readable-thank-you-ref","title":"Thank you Title","type":"type","properties":{"show_button":true,"button_text":"start","button_mode":"redirect","redirect_url":"https://www.typeform.com","share_icons":true},"attachment":{"type":"image","href":{"image":{"value":"https://images.typeform.com/images/4bcd3"},"Pexels":{"value":"https://www.pexels.com/video/people-traveling-in-the-desert-1739011"},"Vimeo":{"value":"https://vimeo.com/245714980"},"YouTube":{"value":"https://www.youtube.com/watch?v=cGk3tZIIpXE"}},"scale":0,"properties":{"description":"description"}},"layout":{"type":"float","placement":"left","attachment":{"type":"image","href":{"image":{"value":"https://images.typeform.com/images/4bcd3"},"Pexels":{"value":"https://www.pexels.com/video/people-traveling-in-the-desert-1739011"},"Vimeo":{"value":"https://vimeo.com/245714980"},"YouTube":{"value":"https://www.youtube.com/watch?v=cGk3tZIIpXE"}},"scale":0,"properties":{"description":"description"}},"viewport_overrides":{"small":{"type":"float","placement":"left"},"large":{"type":"split","placement":"right"}}}}],"logic":[{"type":"type","ref":"ref","actions":[{"action":"action","details":{"to":{"type":"type","value":"value"},"target":{"type":"type","value":"value"},"value":{"type":"type"}},"condition":{"op":"op","vars":[{"type":"type","value":{}}]}}]}],"theme":{"href":"https://api.typeform.com/themes/Fs24as"},"workspace":{"href":"https://api.typeform.com/workspaces/Aw33bz"},"_links":{"display":"https://subdomain.typeform.com/to/abc123"},"settings":{"language":"language","is_public":true,"autosave_progress":true,"progress_bar":"proportion","show_progress_bar":true,"show_typeform_branding":true,"show_time_to_complete":true,"show_number_of_submissions":true,"show_cookie_consent":true,"show_question_number":true,"show_key_hint_on_choices":true,"hide_navigation":true,"meta":{"title":"title","allow_indexing":true,"description":"description","image":{"href":"href"}},"redirect_after_submit_url":"redirect_after_submit_url","google_analytics":"google_analytics","facebook_pixel":"facebook_pixel","google_tag_manager":"google_tag_manager","milestones":[{"field_ref":"field_ref","status":"status","reason":"reason"}],"enrichment_in_renderer":{"toggle":true,"active":true},"captcha":true,"duplicate_prevention":{"type":"type","responses_limit":0,"period":"period"}},"cui_settings":{"avatar":"https://images.typeform.com/images/4bcd3","is_typing_emulation_disabled":true,"typing_emulation_speed":"fast"}}
   */
  async getForm(formId) {
    return this.#apiRequest({
      logTag: 'getForm',
      url: `${ API_BASE_URL }/forms/${ formId }`,
    })
  }

  /**
   * @description Updates specific attributes of an existing form in Typeform. Supports partial updates using JSON Patch format.
   *
   * @route POST /patch-form
   * @operationName Update Form Patch
   * @category Form Management
   * @appearanceColor #89BC62 #89BC62
   * @requiredOauth2Scopes forms.write
   *
   * @paramDef {"type":"String","label":"Form ID","name":"formId","required":true,"dictionary":"getFormsDictionary","description":"The unique ID of the form to update."}
   * @paramDef {"type":"Array.<Object>","label":"Update Operations","name":"operations","required":true,"description":"An array of update operations to apply to the form. Example: [{'op':'replace','path':'/title','value':'foo'}, {'op':'replace','path':'/settings/is_public','value':false}]"}
   *
   * @returns {void}
   */
  async updateFormPatch(formId, operations) {
    return this.#apiRequest({
      logTag: 'updateFormPatch',
      method: 'patch',
      url: `${ API_BASE_URL }/forms/${ formId }`,
      body: operations,
    })
  }

  /**
   * @description Updates an existing form in Typeform. This method overwrites the entire form, so all existing fields must be included in the request body. If fields are omitted, they will be deleted from the form. Make sure to include all necessary fields, including the field IDs.
   *
   * @route POST /update-form
   * @operationName Update Form Completely
   * @category Form Management
   * @appearanceColor #89BC62 #89BC62
   * @requiredOauth2Scopes forms.write
   *
   * @paramDef {"type":"String","label":"Form ID","name":"formId","required":true,"dictionary":"getFormsDictionary","description":"The unique ID of the form to update."}
   * @paramDef {"type":"Object","label":"Form Object","name":"form","required":true,"description":"The complete form object, including all fields and their values."}
   *
   * @returns {void}
   */
  async updateFormCompletely(formId, form) {
    return this.#apiRequest({
      logTag: 'updateFormCompletely',
      method: 'put',
      url: `${ API_BASE_URL }/forms/${ formId }`,
      body: form,
    })
  }

  /**
   * @description Retrieves the customizable messages for a form specified by Form ID, using the form's specified language. Messages can be formatted with bold (*bold*) and italic (_italic_) text. HTML tags are forbidden.
   *
   * @route POST /get-forms-messages
   * @operationName Get Custom Form Messages
   * @category Form Customization
   * @appearanceColor #89BC62 #89BC62
   * @requiredOauth2Scopes forms.read
   *
   * @paramDef {"type":"String","label":"Form ID","name":"formId","required":true,"dictionary":"getFormsDictionary","description":"The unique ID of the form to retrieve messages for."}
   *
   * @returns {Object} - Object containing the customizable messages for the specified form.
   * @sampleResult {"label.buttonHint.default":"label.buttonHint.default","label.buttonHint.longtext":"label.buttonHint.longtext","label.warning.connection":"label.warning.connection","label.buttonNoAnswer.default":"label.buttonNoAnswer.default","label.warning.correction":"label.warning.correction","block.payment.cardNameTitle":"block.payment.cardNameTitle","block.payment.cardNumberTitle":"block.payment.cardNumberTitle","block.payment.cvcDescription":"block.payment.cvcDescription","block.payment.cvcNumberTitle":"block.payment.cvcNumberTitle","block.shortText.placeholder":"block.shortText.placeholder","label.error.emailAddress":"label.error.emailAddress","label.error.expiryMonthTitle":"label.error.expiryMonthTitle","label.error.expiryYearTitle":"label.error.expiryYearTitle","label.warning.fallbackAlert":"label.warning.fallbackAlert","block.fileUpload.choose":"block.fileUpload.choose","block.fileUpload.drag":"block.fileUpload.drag","block.fileUpload.uploadingProgress":"block.fileUpload.uploadingProgress","label.error.sizeLimit":"label.error.sizeLimit","label.warning.formUnavailable":"label.warning.formUnavailable","label.error.incompleteForm":"label.error.incompleteForm","label.hint.key":"label.hint.key","block.legal.reject":"block.legal.reject","block.legal.accept":"block.legal.accept","label.error.maxValue":"label.error.maxValue","label.error.maxLength":"label.error.maxLength","label.error.minValue":"label.error.minValue","label.error.range":"label.error.range","block.multipleChoice.hint":"block.multipleChoice.hint","label.error.mustEnter":"label.error.mustEnter","label.error.mustSelect":"label.error.mustSelect","label.no.shortcut":"label.no.shortcut","label.no.default":"label.no.default","block.dropdown.hint":"block.dropdown.hint","block.multipleChoice.other":"block.multipleChoice.other","label.progress.percent":"label.progress.percent","label.progress.proportion":"label.progress.proportion","label.error.required":"label.error.required","label.preview":"label.preview","label.button.review":"label.button.review","label.error.server":"label.error.server","label.action.share":"label.action.share","label.button.submit":"label.button.submit","label.warning.success":"label.warning.success","label.button.ok":"label.button.ok","label.error.mustAccept":"label.error.mustAccept","block.longtext.hint":"block.longtext.hint","block.dropdown.placeholder":"block.dropdown.placeholder","block.dropdown.placeholderTouch":"block.dropdown.placeholderTouch","label.error.url":"label.error.url","label.yes.shortcut":"label.yes.shortcut","label.yes.default":"label.yes.default"}
   * */
  async getCustomFormMessages(formId) {
    return this.#apiRequest({
      logTag: 'getCustomFormMessages',
      url: `${ API_BASE_URL }/forms/${ formId }/messages`,
    })
  }

  /**
   * @description Updates customizable messages for a form specified by Form ID. Messages can be formatted with bold (*bold*) and italic (_italic_) text. HTML tags are forbidden. All customizable fields you can find here: https://www.typeform.com/developers/create/reference/update-custom-messages/
   *
   * @route POST /update-custom-messages
   * @operationName Update Custom Messages
   * @category Form Customization
   * @appearanceColor #89BC62 #89BC62
   * @requiredOauth2Scopes forms.write
   *
   * @paramDef {"type":"String","label":"Form ID","name":"formId","required":true,"dictionary":"getFormsDictionary","description":"The unique ID of the form to update messages for."}
   * @paramDef {"type":"Object","label":"Messages","name":"messages","required":true,"description":"An object containing the customizable messages for the form."}
   *
   * @returns {void}
   */
  async updateCustomMessages(formId, messages) {
    return this.#apiRequest({
      logTag: 'getCustomFormMessages',
      method: 'put',
      url: `${ API_BASE_URL }/forms/${ formId }/messages`,
      body: messages,
    })
  }

  /**
   * @description Retrieves the form content in the main language, useful for using it as a base for translations in different languages.
   *
   * @route GET /get-translation-payload
   * @operationName Get Form Translations Payload
   * @category Form Translation
   * @appearanceColor #89BC62 #89BC62
   * @requiredOauth2Scopes forms.read
   *
   * @paramDef {"type":"String","label":"Form ID","name":"formId","required":true,"dictionary":"getFormsDictionary","description":"The unique ID of the form to retrieve translations for."}
   *
   * @returns {Object} - The translation payload for the form.
   * @sampleResult {"label.buttonHint.default":"label.buttonHint.default","label.buttonHint.longtext":"label.buttonHint.longtext","label.warning.connection":"label.warning.connection","label.buttonNoAnswer.default":"label.buttonNoAnswer.default","label.warning.correction":"label.warning.correction","block.payment.cardNameTitle":"block.payment.cardNameTitle","block.payment.cardNumberTitle":"block.payment.cardNumberTitle","block.payment.cvcDescription":"block.payment.cvcDescription","block.payment.cvcNumberTitle":"block.payment.cvcNumberTitle","block.shortText.placeholder":"block.shortText.placeholder","label.error.emailAddress":"label.error.emailAddress","label.error.expiryMonthTitle":"label.error.expiryMonthTitle","label.error.expiryYearTitle":"label.error.expiryYearTitle","label.warning.fallbackAlert":"label.warning.fallbackAlert","block.fileUpload.choose":"block.fileUpload.choose","block.fileUpload.drag":"block.fileUpload.drag","block.fileUpload.uploadingProgress":"block.fileUpload.uploadingProgress","label.error.sizeLimit":"label.error.sizeLimit","label.warning.formUnavailable":"label.warning.formUnavailable","label.error.incompleteForm":"label.error.incompleteForm","label.hint.key":"label.hint.key","block.legal.reject":"block.legal.reject","block.legal.accept":"block.legal.accept","label.error.maxValue":"label.error.maxValue","label.error.maxLength":"label.error.maxLength","label.error.minValue":"label.error.minValue","label.error.range":"label.error.range","block.multipleChoice.hint":"block.multipleChoice.hint","label.error.mustEnter":"label.error.mustEnter","label.error.mustSelect":"label.error.mustSelect","label.no.shortcut":"label.no.shortcut","label.no.default":"label.no.default","block.dropdown.hint":"block.dropdown.hint","block.multipleChoice.other":"block.multipleChoice.other","label.progress.percent":"label.progress.percent","label.progress.proportion":"label.progress.proportion","label.error.required":"label.error.required","label.preview":"label.preview","label.button.review":"label.button.review","label.error.server":"label.error.server","label.action.share":"label.action.share","label.button.submit":"label.button.submit","label.warning.success":"label.warning.success","label.button.ok":"label.button.ok","label.error.mustAccept":"label.error.mustAccept","block.longtext.hint":"block.longtext.hint","block.dropdown.placeholder":"block.dropdown.placeholder","block.dropdown.placeholderTouch":"block.dropdown.placeholderTouch","label.error.url":"label.error.url","label.yes.shortcut":"label.yes.shortcut","label.yes.default":"label.yes.default"}
   */
  async getFormTranslationPayload(formId) {
    return this.#apiRequest({
      logTag: 'getFormTranslationPayload',
      url: `${ API_BASE_URL }/forms/${ formId }/translations/main`,
    })
  }

  /**
   * @description Retrieves the translation statuses for each language for a specified form.
   *
   * @route GET /get-translation-statuses
   * @operationName Get Translation Statuses
   * @category Form Translation
   * @appearanceColor #89BC62 #89BC62
   * @requiredOauth2Scopes forms.read
   *
   * @paramDef {"type":"String","label":"Form ID","name":"formId","required":true,"dictionary":"getFormsDictionary","description":"The unique ID of the form to retrieve translation statuses for."}
   *
   * @returns {Object} - The translation status payload for each language.
   * returnsExample {"languages":[{"code":"code","status":"status"}]}
   */
  async getTranslationStatuses(formId) {
    return this.#apiRequest({
      logTag: 'getTranslationStatuses',
      url: `${ API_BASE_URL }/forms/${ formId }/translations/status`,
    })
  }

  /**
   * @description Deletes the translation content for a specified form and language.
   *
   * @route POST /delete-translation
   * @operationName Delete Form Translation
   * @category Form Translation
   * @appearanceColor #89BC62 #89BC62
   * @requiredOauth2Scopes forms.write
   *
   * @paramDef {"type":"String","label":"Form ID","name":"formId","required":true,"dictionary":"getFormsDictionary","description":"The unique ID of the form to delete a translation for."}
   * @paramDef {"type":"String","label":"Language","name":"language","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["ar","ca","ch","cs","da","de","el","en","es","et","fi","fr","he","hr","hu","it","ja","ko","lt","nl","no","pl","pt","ru","sv","tr","uk","zh"]}},"description":"Language code for the translation to delete (e.g., 'en' for English)."}
   *
   * @returns {void}
   */
  async deleteFormTranslation(formId, language) {
    return this.#apiRequest({
      logTag: 'deleteFormTranslation',
      method: 'delete',
      url: `${ API_BASE_URL }/forms/${ formId }/translations/${ language }`,
    })
  }

  /**
   * @description Retrieves the translation content for a specified form and language.
   *
   * @route POST /get-translation
   * @operationName Get Form Translation
   * @category Form Translation
   * @appearanceColor #89BC62 #89BC62
   * @requiredOauth2Scopes forms.read
   *
   * @paramDef {"type":"String","label":"Form ID","name":"formId","required":true,"dictionary":"getFormsDictionary","description":"The unique ID of the form to retrieve translation for."}
   * @paramDef {"type":"String","label":"Language","name":"language","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["ar","ca","ch","cs","da","de","el","en","es","et","fi","fr","he","hr","hu","it","ja","ko","lt","nl","no","pl","pt","ru","sv","tr","uk","zh"]}},"description":"Language code for the translation to retrieve (e.g., 'en' for English)."}
   *
   * @returns {Object} - Translation content for the specified form and language.
   * @sampleResult {"fields":[{"attachment":{"properties":{"description":"description"}},"id":"id","layout":{"attachment":{"properties":{"description":"description"}}},"properties":{"button_text":"button_text","choices":[{"attachment":{"properties":{"description":"description"}},"id":"id","label":"label"}],"description":"description","fields":[null],"labels":[{"center":"center","left":"left","right":"right"}]},"title":"title"}],"messages":{},"thankyou_screens":[{"attachment":{"properties":{"description":"description"}},"id":"id","layout":{"attachment":{"properties":{"description":"description"}}},"properties":{"button_text":"button_text","description":"description"},"title":"title"}],"welcome_screens":[{"attachment":{"properties":{"description":"description"}},"id":"id","layout":{"attachment":{"properties":{"description":"description"}}},"properties":{"button_text":"button_text","description":"description"},"title":"title"}]}
   */
  async getFormTranslation(formId, language) {
    return this.#apiRequest({
      logTag: 'getFormTranslation',
      url: `${ API_BASE_URL }/forms/${ formId }/translations/${ language }`,
    })
  }

  /**
   * @description Updates the translation content for a specified form and language.
   *
   * @route PUT /update-translation
   * @operationName Update Form Translation
   * @category Form Translation
   * @appearanceColor #89BC62 #89BC62
   * @requiredOauth2Scopes forms.write
   *
   * @paramDef {"type":"String","label":"Form ID","name":"formId","required":true,"dictionary":"getFormsDictionary","description":"The unique ID of the form to update translation for."}
   * @paramDef {"type":"String","label":"Language","name":"language","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["ar","ca","ch","cs","da","de","el","en","es","et","fi","fr","he","hr","hu","it","ja","ko","lt","nl","no","pl","pt","ru","sv","tr","uk","zh"]}},"description":"Language code for the translation to update (e.g., 'en' for English)."}
   * @paramDef {"type":"Array.<Object>","label":"Fields","name":"fields","description":"An array of objects representing the fields for the translation."}
   * @paramDef {"type":"Object","label":"Messages","name":"messages","description":"An object containing messages that forms can use."}
   * @paramDef {"type":"Array.<Object","label":"Thank You Screens","name":"thankYouScreens","description":"An array of objects representing the 'thank you' screens for the form."}
   * @paramDef {"type":"Array.<Object","label":"Welcome Screens","name":"welcomeScreens","description":"An array of objects representing the 'welcome' screens for the form."}
   *
   * @returns {void}
   */
  async updateFormTranslation(formId, language, fields, messages, thankYouScreens, welcomeScreens) {
    const body = cleanupObject({ fields, messages, thankyou_screens: thankYouScreens, welcome_screens: welcomeScreens })

    return this.#apiRequest({
      logTag: 'updateFormTranslation',
      method: 'put',
      url: `${ API_BASE_URL }/forms/${ formId }/translations/${ language }`,
      body,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  /**
   * @description Requests an automatic translation for a specified form and language.
   *
   * @route POST /auto-translate
   * @operationName Auto-Translate Form
   * @category Form Translation
   * @appearanceColor #89BC62 #89BC62
   * @requiredOauth2Scopes forms.write
   *
   * @paramDef {"type":"String","label":"Form ID","name":"formId","required":true,"dictionary":"getFormsDictionary","description":"The unique ID of the form to request an automatic translation for."}
   * @paramDef {"type":"String","label":"Language","name":"language","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["ar","ca","ch","cs","da","de","el","en","es","et","fi","fr","he","hr","hu","it","ja","ko","lt","nl","no","pl","pt","ru","sv","tr","uk","zh"]}},"description":"Language code for the translation (e.g., 'en' for English)."}
   *
   * @returns {Object} - Automatic translation confirmation with the translated content.
   * @sampleResult {"fields":[{"attachment":{"properties":{"description":"description"}},"id":"id","layout":{"attachment":{"properties":{"description":"description"}}},"properties":{"button_text":"button_text","choices":[{"attachment":{"properties":{"description":"description"}},"id":"id","label":"label"}],"description":"description","fields":[null],"labels":[{"center":"center","left":"left","right":"right"}]},"title":"title"}],"messages":{},"thankyou_screens":[{"attachment":{"properties":{"description":"description"}},"id":"id","layout":{"attachment":{"properties":{"description":"description"}}},"properties":{"button_text":"button_text","description":"description"},"title":"title"}],"welcome_screens":[{"attachment":{"properties":{"description":"description"}},"id":"id","layout":{"attachment":{"properties":{"description":"description"}}},"properties":{"button_text":"button_text","description":"description"},"title":"title"}]}
   */
  async autoTranslateForm(formId, language) {
    return this.#apiRequest({
      logTag: 'autoTranslateForm',
      method: 'post',
      url: `${ API_BASE_URL }/forms/${ formId }/translations/${ language }/auto`,
      body: {},
      headers: { 'Content-Type': 'application/json' },
    })
  }

  /**
   * @description Retrieves a list of JSON descriptions for all images in your Typeform account.
   *
   * @route GET /get-images
   * @operationName Get Images Collection
   * @category Media Management
   * @appearanceColor #89BC62 #89BC62
   * @requiredOauth2Scopes images:read
   *
   * @returns {Array.<Object>} - Collection of images.
   * @sampleResult [{"src":"https://images.typeform.com/images/aaabbbsss","media_type":"image/jpeg","file_name":"Aviewofamountainrangeatsunset","width":1904,"has_alpha":false,"avg_color":"897c7d","id":"aaabbbsss","height":1080}]
   * */
  async getImages() {
    return this.#apiRequest({
      logTag: 'getImages',
      url: `${ API_BASE_URL }/images`,
    })
  }

  /**
   * @description Adds an image to your Typeform account.
   *
   * @route POST /create-image
   * @operationName Create Image
   * @category Media Management
   * @appearanceColor #89BC62 #89BC62
   * @requiredOauth2Scopes images.write
   *
   * @paramDef {"type":"String","label":"File Name","name":"fileName","required":true,"description":"File name for the image."}
   * @paramDef {"type":"String","label":"Base64 Image","name":"image","required":true,"description":"Base64 code for the image (without descriptors)."}
   * @paramDef {"type":"String","label":"Image URL","name":"url","description":"URL of the image."}
   *
   * @returns {Object} - An object containing metadata about the uploaded image.
   * @sampleResult {"src":"https://images.typeform.com/images/aaabbbsss","media_type":"image/jpeg","file_name":"Aviewofamountainrangeatsunset","width":1904,"has_alpha":false,"avg_color":"897c7d","id":"aaabbbsss","height":1080}
   */
  async createImage(fileName, image, url) {
    const body = cleanupObject({ file_name: fileName, image, url })

    return this.#apiRequest({
      logTag: 'createImage',
      method: 'post',
      url: `${ API_BASE_URL }/images`,
      body,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  /**
   * @description Deletes an image from your Typeform account.
   *
   * @route POST /delete-image
   * @operationName Delete Image
   * @category Media Management
   * @appearanceColor #89BC62 #89BC62
   * @requiredOauth2Scopes images.write
   *
   * @paramDef {"type":"String","label":"Image ID","name":"imageId","required":true,"dictionary":"getImagesDictionary","description":"Unique ID for the image to delete."}
   *
   * @returns {void}
   */
  async deleteImage(imageId) {
    return this.#apiRequest({
      logTag: 'deleteImage',
      method: 'delete',
      url: `${ API_BASE_URL }/images/${ imageId }`,
    })
  }

  /**
   * @description Retrieves the JSON description or the binary of the original image for the specified image_id.
   *
   * @route POST /get-image
   * @operationName Get Image
   * @category Media Management
   * @appearanceColor #89BC62 #89BC62
   * @requiredOauth2Scopes images.read
   *
   * @paramDef {"type":"String","label":"Image ID","name":"imageId","required":true,"dictionary":"getImagesDictionary","description":"Unique ID for the image to retrieve."}
   *
   * @returns {Object} - The JSON description of the image.
   * @sampleResult {"src":"https://images.typeform.com/images/aaabbbsss","media_type":"image/jpeg","file_name":"Aviewofamountainrangeatsunset","width":1904,"has_alpha":false,"avg_color":"897c7d","id":"aaabbbsss","height":1080}
   */
  async getImage(imageId) {
    return this.#apiRequest({
      logTag: 'getImage',
      url: `${ API_BASE_URL }/images/${ imageId }`,
    })
  }

  /**
   * @description Retrieves a specific background image by its unique ID and desired size from Typeform's image library.
   *
   * @route POST /get-background-by-size
   * @operationName Get Background by Size
   * @category Media Management
   * @appearanceColor #89BC62 #89BC62
   * @requiredOauth2Scopes images.read
   *
   * @paramDef {"type":"String","label":"Image ID","name":"imageId","required":true,"dictionary":"getImagesDictionary","description":"Unique ID for the image to retrieve."}
   * @paramDef {"type":"String","label":"Image Size","name":"size","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["default","tablet","mobile","thumbnail"]}},"description":"Image size to retrieve."}
   *
   * @returns {Object} - The JSON description of the image background.
   * @sampleResult {"src":"<background_image_url>","media_type":"image/jpeg","file_name":"<image_name>","width":1680,"height":1050,"id":"<image_id>"}
   */
  async getBackgroundBySize(imageId, size) {
    return this.#apiRequest({
      logTag: 'getBackgroundBySize',
      url: `${ API_BASE_URL }/images/${ imageId }/background/${ size }`,
    })
  }

  /**
   * @description Retrieves a choice image by its unique ID and specified size from Typeform's image library.
   *
   * @route POST /get-choice-image
   * @operationName Get Choice Image By Size
   * @category Media Management
   * @appearanceColor #89BC62 #89BC62
   * @requiredOauth2Scopes images.read
   *
   * @paramDef {"type":"String","label":"Image ID","name":"imageId","required":true,"dictionary":"getImagesDictionary","description":"Unique ID for the image to retrieve."}
   * @paramDef {"type":"String","label":"Image Size","name":"size","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["default","thumbnail","supersize","supermobile","supersizefit","supermobilefit"]}},"description":"Image size to retrieve."}
   *
   * @returns {Object} - The JSON description of the choice image.
   * @sampleResult {"src":"<choice_image_url>","media_type":"image/jpeg","file_name":"<image_name>","width":230,"height":230,"id":"<image_id>"}
   */
  async getChoiceImageBySize(imageId, size) {
    return this.#apiRequest({
      logTag: 'getChoiceImageBySize',
      url: `${ API_BASE_URL }/images/${ imageId }/choice/${ size }`,
    })
  }

  /**
   * @description Get the JSON description or the binary of the requested image format.
   *
   * @route GET /get-image-by-size
   * @operationName Get Image By Size
   * @category Media Management
   * @appearanceColor #89BC62 #89BC62
   * @requiredOauth2Scopes images.read
   *
   * @paramDef {"type":"String","label":"Image ID","name":"imageId","required":true,"dictionary":"getImagesDictionary","description":"Unique ID for the image to retrieve."}
   * @paramDef {"type":"String","label":"Image Size","name":"size","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["default","mobile","thumbnail"]}},"description":"Image size to retrieve."}
   *
   * @returns {Object} - The JSON description of the image.
   * @sampleResult {"src":"<image_url>","media_type":"image/jpeg","file_name":"<image_name>","width":800,"height":600,"id":"<image_id>"}
   */
  async getImageBySize(imageId, size) {
    return this.#apiRequest({
      logTag: 'getImageBySize',
      url: `${ API_BASE_URL }/images/${ imageId }/image/${ size }`,
    })
  }

  /**
   * @description Retrieves a list of JSON descriptions for all themes in the Typeform account, both public and private. Themes are listed in reverse-chronological order based on the date added.
   *
   * @route POST /themes
   * @operationName Get List Themes
   * @category Theme Management
   * @appearanceColor #89BC62 #89BC62
   * @requiredOauth2Scopes themes.read
   *
   * @paramDef {"type":"Number","label":"Page","name":"page","description":"The page of results to retrieve. Default is 1 (first page)."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","description":"Number of results to retrieve per page. Default is 10, maximum is 200."}
   *
   * @returns {Object} - An object of theme JSON descriptions.
   * @sampleResult {"items":[{"rounded_corners":"small","updated_at":"2020-10-14T09:56:16.481543Z","visibility":"public","screens":{"font_size":"x-small","alignment":"center"},"name":"Default Theme","created_at":"2020-10-14T09:56:16.481543Z","id":"qHWOQ7","fields":{"font_size":"medium","alignment":"left"},"has_transparent_button":false,"colors":{"button":"#0445AF","question":"#000000","answer":"#0445AF","background":"#FFFFFF"},"font":"System font"}],"total_items":38,"page_count":4}
   */
  async getThemesList(page, pageSize) {
    const query = { page, page_size: pageSize }

    return this.#apiRequest({
      logTag: 'getThemesList',
      query,
      url: `${ API_BASE_URL }/themes`,
    })
  }

  /**
   * @description Deletes a theme from the Typeform account.
   *
   * @route POST /delete-theme
   * @operationName Delete Theme
   * @category Theme Management
   * @appearanceColor #89BC62 #89BC62
   * @requiredOauth2Scopes themes.write
   *
   * @paramDef {"type":"String","label":"Theme ID","name":"themeId","required":true,"dictionary":"getThemesDictionary","description":"Unique ID for the theme to delete."}
   *
   * @returns {void}
   */
  async deleteTheme(themeId) {
    return this.#apiRequest({
      logTag: 'deleteTheme',
      method: 'delete',
      url: `${ API_BASE_URL }/themes/${ themeId }`,
    })
  }

  /**
   * @description Retrieves a theme from the Typeform account.
   *
   * @route POST /get-theme
   * @operationName Get Theme
   * @category Theme Management
   * @appearanceColor #89BC62 #89BC62
   * @requiredOauth2Scopes themes.read
   *
   * @paramDef {"type":"String","label":"Theme ID","name":"themeId","required":true,"dictionary":"getThemesDictionary","description":"Unique ID for the theme to retrieve."}
   *
   * @returns {Object} - The response object containing theme data.
   * @sampleResult {"background":{"brightness":-0.59,"image_id":987,"layout":"fullscreen"},"colors":{"answer":"#800000","background":"#FFFFFF","button":"#808080","question":"#000000"},"fields":{"alignment":"left","font_size":"medium"},"font":"Arial","has_transparent_button":false,"id":456,"name":"My theme","rounded_corners":"small","screens":{"alignment":"center","font_size":"small"},"visibility":"private"}
   */
  async getTheme(themeId) {
    return this.#apiRequest({
      logTag: 'getTheme',
      url: `${ API_BASE_URL }/themes/${ themeId }`,
    })
  }

  /**
   * @description Creates a new theme in the Typeform account.
   *
   * @route POST /create-theme
   * @operationName Create Theme
   * @category Theme Management
   * @appearanceColor #89BC62 #89BC62
   * @requiredOauth2Scopes themes.write
   *
   * @paramDef {"type":"String","label":"Theme Name","name":"name","required":true,"description":"Name for the theme."}
   * @paramDef {"type":"Number","label":"Background Brightness","name":"brightness","description":"Brightness for the background, from -1 (minimum) to 1 (maximum)."}
   * @paramDef {"type":"String","label":"Background Image URL","name":"href","description":"URL for the background image. Example: https://images.typeform.com/images/AAABBBCCC"}
   * @paramDef {"type":"String","label":"Background Layout","name":"layout","uiComponent":{"type":"DROPDOWN","options":{"values":["fullscreen","repeat","no-repeat"]}},"description":"Layout for the background (\"fullscreen\", \"repeat\", \"no-repeat\")."}
   * @paramDef {"type":"String","label":"Answer Color","name":"answerColor","description":"Hex color for answers (default: \"#4FB0AE\")."}
   * @paramDef {"type":"String","label":"Background Color","name":"backgroundColor","description":"Hex color for the background (default: \"#FFFFFF\")."}
   * @paramDef {"type":"String","label":"Button Color","name":"buttonColor","description":"Hex color for buttons (default: \"#4FB0AE\")."}
   * @paramDef {"type":"String","label":"Question Color","name":"questionColor","description":"Hex color for questions (default: \"#3D3D3D\")."}
   * @paramDef {"type":"String","label":"Fields Alignment","name":"fieldsAlignment","uiComponent":{"type":"DROPDOWN","options":{"values":["left","center"]}},"description":"Fields alignment (\"left\" or \"center\")."}
   * @paramDef {"type":"String","label":"Fields Font Size","name":"fieldsFontSize","uiComponent":{"type":"DROPDOWN","options":{"values":["small","medium","large"]}},"description":"Fields font size (\"small\", \"medium\", or \"large\")."}
   * @paramDef {"type":"String","label":"Font","name":"font","uiComponent":{"type":"DROPDOWN","options":{"values":["Acme","Arial","Arvo","Avenir Next","Bangers","Cabin","Cabin Condensed","Courier","Crete Round","Dancing Script","Exo","Georgia","Handlee","Helvetica Neue","Karla","Lato","Lekton","Lobster","Lora","McLaren","Montserrat","Nixie One","Old Standard TT","Open Sans","Oswald","Playfair Display","Quicksand","Raleway","Signika","Sniglet","Source Sans Pro","Vollkorn"]}},"description":"Font for the theme. Default: \"Source Sans Pro\"."}
   * @paramDef {"type":"Boolean","label":"Transparent Button","name":"hasTransparentButton","uiComponent":{"type":"TOGGLE"},"description":"Set to true for transparent buttons, false otherwise."}
   * @paramDef {"type":"String","label":"Rounded Corners","name":"roundedCorners","uiComponent":{"type":"DROPDOWN","options":{"values":["none","small","large"]}},"description":"Border radius style of buttons and other elements (\"none\", \"small\", or \"large\")."}
   * @paramDef {"type":"String","label":"Screen Alignment","name":"screensAlignment","uiComponent":{"type":"DROPDOWN","options":{"values":["left","center"]}},"description":"Alignment for screens (\"left\" or \"center\")."}
   * @paramDef {"type":"String","label":"Screen Font Size","name":"screensFontSize","uiComponent":{"type":"DROPDOWN","options":{"values":["small","medium","large"]}},"description":"Font size for screens (\"small\", \"medium\", or \"large\")."}
   *
   * @returns {Object} - The newly created theme.
   * @sampleResult {"rounded_corners":"small","updated_at":"2024-10-31T15:11:24.783318Z","visibility":"private","screens":{"font_size":"large","alignment":"left"},"name":"ThemeName","created_at":"2024-10-31T15:11:24.783318Z","id":"themeId","fields":{"font_size":"small","alignment":"left"},"has_transparent_button":true,"colors":{"button":"#3D3D3D","question":"#3D3D3D","answer":"#3D3D3D","background":"#3D3D3D"},"font":"Arial"}
   */
  async createTheme(
    name,
    brightness,
    href,
    layout,
    answerColor,
    backgroundColor,
    buttonColor,
    questionColor,
    fieldsAlignment,
    fieldsFontSize,
    font,
    hasTransparentButton,
    roundedCorners,
    screensAlignment,
    screensFontSize
  ) {
    const body = {
      colors: {
        answer: answerColor || '#4FB0AE',
        background: backgroundColor || '#FFFFFF',
        button: buttonColor || '#4FB0AE',
        question: questionColor || '#3D3D3D',
      },
      fields: { alignment: fieldsAlignment || 'left', font_size: fieldsFontSize || 'medium' },
      font: font || 'Source Sans Pro',
      name,
      screens: { alignment: screensAlignment || 'center', font_size: screensFontSize || 'small' },
    }

    if (brightness) {
      body.background = {}
      body.background.brightness = brightness
      body.background.href = href
      body.background.layout = layout || 'fullscreen'
    }

    if (hasTransparentButton) {
      body.has_transparent_button = hasTransparentButton
    }

    if (roundedCorners) {
      body.rounded_corners = roundedCorners
    }

    logger.debug('CreateTheme - body:', body)

    return this.#apiRequest({
      logTag: 'createTheme',
      method: 'post',
      body,
      url: `${ API_BASE_URL }/themes`,
    })
  }

  /**
   * @description Deletes responses for a specified form in Typeform.
   *
   * @route DELETE /delete-form-responses
   * @operationName Delete Responses
   * @category Response Management
   * @appearanceColor #89BC62 #89BC62
   * @requiredOauth2Scopes responses.write
   *
   * @paramDef {"type":"String","label":"Form ID","name":"formId","required":true,"dictionary":"getFormsDictionary","description":"Unique ID of the form for which responses are to be deleted."}
   * @paramDef {"type":"String","label":"Included Response ID(s)","name":"includedResponseIds","required":true,"dictionary":"getResponsesDictionary","description":"Single response ID or an array of response IDs or a single string of response ID to delete. Up to 1000 IDs can be specified."}
   *
   * @returns {void}
   */
  async deleteResponses(formId, includedResponseIds) {
    if (!Array.isArray(includedResponseIds)) {
      includedResponseIds = [includedResponseIds]
    }

    return this.#apiRequest({
      logTag: 'deleteResponses',
      method: 'delete',
      query: { included_response_ids: includedResponseIds?.join(',') },
      url: `${ API_BASE_URL }/forms/${ formId }/responses`,
    })
  }

  /**
   * @description Retrieves responses for a specified Typeform.
   *
   * @route POST /get-form-responses
   * @operationName Get Form Responses
   * @category Response Management
   * @appearanceColor #89BC62 #89BC62
   * @requiredOauth2Scopes responses.read
   *
   * @paramDef {"type":"String","label":"Form ID","name":"formId","required":true,"dictionary":"getFormsDictionary","description":"Unique ID of the Typeform found in the form's URL (e.g., 'u6nXL7')."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","description":"Maximum number of responses. Default value is 25. Maximum value is 1000."}
   * @paramDef {"type":"String","label":"Start Date","name":"since","description":"Limit request to responses submitted since the specified date and time. The date can be in ISO 8601 format (e.g., 2020-03-20T14:00:59) or as a timestamp (seconds since epoch)."}
   * @paramDef {"type":"String","label":"End Date","name":"until","description":"Limit request to responses submitted until the specified date and time. The date can be in ISO 8601 format (e.g., 2020-03-20T14:00:59) or as a timestamp (seconds since epoch)."}
   * @paramDef {"type":"String","label":"Start Token","name":"after","description":"Limit request to responses submitted after the specified token."}
   * @paramDef {"type":"String","label":"End Token","name":"before","description":"Limit request to responses submitted before the specified token."}
   * @paramDef {"type":"Boolean","label":"Completed Response","name":"isCompleted","uiComponent":{"type":"TOGGLE"},"description":"Filter responses to only include those that are completed."}
   * @paramDef {"type":"String","label":"Search Text in Responses","name":"query","description":"Limit request to only responses that include the specified string."}
   * @paramDef {"type":"Array","label":"Fields","name":"fields","description":"Show only specified fields in answers section."}
   *
   * @returns {Object} - The responses for the specified Typeform.
   * @sampleResult {"items":[{}],"page_count":1,"total_items":4}
   */
  async getResponses(formId, pageSize, since, until, after, before, isCompleted, query, fields) {
    const queryParam = {
      page_size: pageSize,
      since,
      until,
      after,
      before,
      response_type: isCompleted ? 'completed' : '',
      query,
      fields,
    }

    return this.#apiRequest({
      logTag: 'getResponses',
      url: `${ API_BASE_URL }/forms/${ formId }/responses`,
      query: queryParam,
    })
  }

  /**
   * @description Retrieves form-level and individual question-level insights for a specified form.
   *
   * @route POST /get-form-insights-summary
   * @operationName Get Form Insights
   * @category Analytics
   * @appearanceColor #89BC62 #89BC62
   * @requiredOauth2Scopes responses.read
   *
   * @paramDef {"type":"String","label":"Form ID","name":"formId","required":true,"dictionary":"getFormsDictionary","description":"Unique identifier for the form to retrieve insights for."}
   *
   * @returns {Object} - The JSON summary of form insights.
   * @sampleResult {"fields":[{"dropoffs":1,"id":"aBcDe","label":"4","ref":"060e5675-aaf4-4b53-8be8-de956aae4c69","title":"What is your name?","type":"short_text","views":15}],"form":{"platforms":[{"average_time":56000,"completion_rate":45.5,"platform":"desktop","responses_count":100,"total_visits":15,"unique_visits":2}],"summary":{"average_time":56000,"completion_rate":45.5,"responses_count":100,"total_visits":15,"unique_visits":2}}}
   */
  async getFormInsights(formId) {
    return this.#apiRequest({
      logTag: 'getResponses',
      url: `${ API_BASE_URL }/insights/${ formId }/summary`,
    })
  }
}

Flowrunner.ServerCode.addService(Typeform, [
  {
    order: 0,
    displayName: 'Client Id',
    defaultValue: '',
    name: 'clientId',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'Your Client Id from Typeform service',
  },
  {
    order: 1,
    displayName: 'Client Secret',
    defaultValue: '',
    name: 'clientSecret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'Your Client Secret from Typeform service',
  },
])

function getQuestionFields(fields = []) {
  const questionFields = []

  fields.forEach(field => {
    if (QuestionTypes[field.type]) {
      questionFields.push(field)
    }

    const nestedFields = field.properties.fields || []

    if (field.type === 'matrix' && nestedFields.every(({ type }) => QuestionTypes[type])) {
      questionFields.push(field)
    }
  })

  return questionFields
}

function getUpdatedForm(form, fieldId, newOptions) {
  const formToUpdate = { ...form }
  const newChoices = newOptions.map(option => ({ label: option }))

  for (const field of formToUpdate.fields) {
    if (field.id === fieldId && field.properties.choices) {
      field.properties.choices = newChoices
      break
    }

    if (field.id === fieldId && field.properties.fields) {
      for (const nestedField of field.properties.fields) {
        nestedField.properties.choices = newChoices.map(({ label }, index) => ({
          ...nestedField.properties.choices[index],
          label,
        }))
      }

      break
    }
  }

  return formToUpdate
}

function searchFilter(list, props, searchString) {
  const caseInsensitiveSearch = searchString.toLowerCase()

  return list.filter(item => props.some(prop => item[prop]?.toLowerCase().includes(caseInsensitiveSearch)))
}

function getCursor(cursor = 1, total, limit) {
  return cursor * limit < total ? cursor + 1 : null
}

function cleanupObject(data) {
  const result = {}

  Object.keys(data).forEach(key => {
    if (data[key] !== undefined && data[key] !== null) {
      result[key] = data[key]
    }
  })

  return result
}
