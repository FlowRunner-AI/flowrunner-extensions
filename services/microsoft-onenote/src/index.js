const OAUTH_BASE_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0'
const API_BASE_URL = 'https://graph.microsoft.com/v1.0'
const ONENOTE_BASE_URL = `${ API_BASE_URL }/me/onenote`
const PAGE_SIZE_DICTIONARY = 20
const OPERATION_POLL_INTERVAL_MS = 3000
const OPERATION_WAIT_TIMEOUT_MS = 100 * 1000

const DEFAULT_SCOPE_LIST = [
  'offline_access',
  'User.Read',
  'Notes.ReadWrite',
  'Notes.Create',
]

const DEFAULT_SCOPE_STRING = DEFAULT_SCOPE_LIST.join(' ')

const PATCH_ACTION_MAP = { Append: 'append', Insert: 'insert', Prepend: 'prepend', Replace: 'replace' }
const PATCH_POSITION_MAP = { After: 'after', Before: 'before' }

const logger = {
  info: (...args) => console.log('[Microsoft OneNote] info:', ...args),
  debug: (...args) => console.log('[Microsoft OneNote] debug:', ...args),
  error: (...args) => console.log('[Microsoft OneNote] error:', ...args),
  warn: (...args) => console.log('[Microsoft OneNote] warn:', ...args),
}

/**
 * @requireOAuth
 * @integrationName Microsoft OneNote
 * @integrationIcon /icon.svg
 **/
class MicrosoftOneNoteService {
  /**
   * @typedef {Object} getNotebooksDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter notebooks by display name. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination link for retrieving the next page of results."}
   */

  /**
   * @typedef {Object} getSectionGroupsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter section groups by display name. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination link for retrieving the next page of results."}
   */

  /**
   * @typedef {Object} getSectionsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter sections by display name. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination link for retrieving the next page of results."}
   */

  /**
   * @typedef {Object} getPagesDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Section ID","name":"sectionId","description":"Optional ID of the section whose pages to list. When omitted, pages from all notebooks are listed."}
   */

  /**
   * @typedef {Object} getPagesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter pages by title. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination link for retrieving the next page of results."}
   * @paramDef {"type":"getPagesDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"The section whose pages to list."}
   */

  /**
   * @typedef {Object} PatchContentCommand
   * @paramDef {"type":"String","label":"Target","name":"target","required":true,"description":"The element to update. Use a data-id prefixed with #, e.g. #intro; a generated element id retrieved via Get Page Content with Include Element IDs enabled (no # prefix), e.g. p:{a1b2c3d4-...}{40}; the keyword body to target the first div on the page; or the keyword title to target the page title."}
   * @paramDef {"type":"String","label":"Action","name":"action","required":true,"defaultValue":"Append","uiComponent":{"type":"DROPDOWN","options":{"values":["Append","Insert","Prepend","Replace"]}},"description":"What to do with the content. Append adds it as a child of the target (body, div, ol, and ul targets only); Insert adds it as a sibling of the target; Prepend adds it as the first child (shortcut for Append + Before); Replace swaps the target for the content (most elements require a generated element id as the target; the page title is replaced by targeting title)."}
   * @paramDef {"type":"String","label":"Position","name":"position","defaultValue":"After","uiComponent":{"type":"DROPDOWN","options":{"values":["After","Before"]}},"description":"Where to place the content relative to the target. With Append: After adds the last child, Before adds the first child. With Insert: After adds the following sibling, Before adds the preceding sibling. Defaults to After."}
   * @paramDef {"type":"String","label":"Content","name":"content","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"A string of well-formed HTML to place on the page, e.g. <p>New paragraph</p> or <li>New list item</li>. External image URLs are not supported in update commands."}
   */
  constructor(config) {
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
    this.scopes = DEFAULT_SCOPE_STRING
  }

  #getAccessTokenHeader(accessToken) {
    return {
      Authorization: `Bearer ${ this.request.headers['oauth-access-token'] || accessToken }`,
    }
  }

  async #apiRequest({ url, method, body, query, headers, logTag }) {
    method = method || 'get'
    query = cleanupObject(query)

    try {
      logger.debug(`${ logTag } - api request: [${ method }::${ url }] q=[${ JSON.stringify(query) }]`)

      return await Flowrunner.Request[method](url)
        .set({ ...this.#getAccessTokenHeader(), ...headers })
        .query(query)
        .send(body)
    } catch (error) {
      const message = error.body?.error?.message || error.message

      logger.error(`${ logTag } - error: ${ message }`)

      throw new Error(`Microsoft OneNote API error: ${ message }`)
    }
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  #buildPageHtml(title, htmlContent) {
    return [
      '<!DOCTYPE html>',
      '<html>',
      '  <head>',
      `    <title>${ escapeHtml(title || '') }</title>`,
      `    <meta name="created" content="${ new Date().toISOString() }" />`,
      '  </head>',
      '  <body>',
      `    ${ htmlContent || '' }`,
      '  </body>',
      '</html>',
    ].join('\n')
  }

  async #waitForOperation(operationId, logTag) {
    const deadline = Date.now() + OPERATION_WAIT_TIMEOUT_MS

    for (;;) {
      const operation = await this.#apiRequest({
        url: `${ ONENOTE_BASE_URL }/operations/${ operationId }`,
        logTag,
      })

      const status = String(operation.status || '').toLowerCase()

      if (status === 'failed') {
        const details = operation.error
          ? `${ operation.error.code || '' } ${ operation.error.message || '' }`.trim()
          : 'no error details provided'

        throw new Error(`Microsoft OneNote copy operation ${ operationId } failed: ${ details }`)
      }

      if (status === 'completed' || Date.now() >= deadline) {
        return operation
      }

      await sleep(OPERATION_POLL_INTERVAL_MS)
    }
  }

  async #startCopyOperation({ url, body, waitForCompletion, logTag }) {
    const operation = await this.#apiRequest({
      url,
      logTag,
      method: 'post',
      body: cleanupObject(body) || {},
    })

    if (waitForCompletion === false || !operation?.id) {
      return operation
    }

    return this.#waitForOperation(operation.id, logTag)
  }

  /**
   * @registerAs SYSTEM
   * @route GET /getOAuth2ConnectionURL
   */
  async getOAuth2ConnectionURL() {
    const params = new URLSearchParams()
    params.append('client_id', this.clientId)
    params.append('response_type', 'code')
    params.append('scope', this.scopes)
    params.append('response_mode', 'query')

    return `${ OAUTH_BASE_URL }/authorize?${ params.toString() }`
  }

  /**
   * @typedef {Object} executeCallback_ResultObject
   * @property {String} token
   * @property {String} refreshToken
   * @property {Number} expirationInSeconds
   * @property {Object} userData
   * @property {String} connectionIdentityName
   * @property {Boolean} overwrite
   */

  /**
   * @registerAs SYSTEM
   * @route POST /executeCallback
   * @param {Object} callbackObject
   * @returns {executeCallback_ResultObject}
   */
  async executeCallback(callbackObject) {
    const code = callbackObject.code
    const url = `${ OAUTH_BASE_URL }/token`

    const params = new URLSearchParams()
    params.append('client_id', this.clientId)
    params.append('code', code)
    params.append('redirect_uri', callbackObject.redirectURI)
    params.append('grant_type', 'authorization_code')
    params.append('client_secret', this.clientSecret)

    const response = await Flowrunner.Request.post(url)
      .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
      .send(params.toString())

    let userData = {}

    try {
      userData = await Flowrunner.Request.get(`${ API_BASE_URL }/me`).set({
        Authorization: `Bearer ${ response.access_token }`,
        'Content-Type': 'application/json',
      })

      logger.debug(`[executeCallback] userData response: ${ JSON.stringify(userData, null, 2) }`)
    } catch (error) {
      logger.error(`[executeCallback] getUserProfile error: ${ error.message }`)
    }

    return {
      token: response.access_token,
      refreshToken: response.refresh_token,
      expirationInSeconds: response.expires_in,
      connectionIdentityName: constructIdentityName(userData),
      overwrite: true,
      userData: userData,
    }
  }

  /**
   * @typedef {Object} refreshToken_ResultObject
   * @property {String} token
   * @property {Number} expirationInSeconds
   * @property {String} refreshToken
   */

  /**
   * @registerAs SYSTEM
   * @route PUT /refreshToken
   * @param {String} refreshToken
   * @returns {refreshToken_ResultObject}
   */
  async refreshToken(refreshToken) {
    const url = `${ OAUTH_BASE_URL }/token`

    const params = new URLSearchParams()
    params.append('client_id', this.clientId)
    params.append('scope', this.scopes)
    params.append('refresh_token', refreshToken)
    params.append('grant_type', 'refresh_token')
    params.append('client_secret', this.clientSecret)

    try {
      const response = await Flowrunner.Request.post(url)
        .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        .send(params.toString())

      return {
        token: response.access_token,
        refreshToken: response.refresh_token,
        expirationInSeconds: response.expires_in,
      }
    } catch (error) {
      logger.error('Error refreshing token: ', error.message || error)
      throw error
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Notebooks Dictionary
   * @description Provides a searchable list of the signed-in user's OneNote notebooks for dynamic parameter selection.
   * @route POST /get-notebooks-dictionary
   * @paramDef {"type":"getNotebooksDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering notebooks."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Work Notebook","value":"1-f0f09ab6-3a68-4d59-b40e-0f8254e14dd6","note":"Default notebook"}],"cursor":null}
   */
  async getNotebooksDictionary(payload) {
    const { search, cursor } = payload || {}
    const url = cursor ? cursor : `${ ONENOTE_BASE_URL }/notebooks`
    const query = cursor ? undefined : { $top: PAGE_SIZE_DICTIONARY }

    const response = await this.#apiRequest({
      url,
      query,
      logTag: 'getNotebooksDictionary',
    })

    const notebooks = response.value || []
    const filteredNotebooks = search ? searchFilter(notebooks, ['displayName'], search) : notebooks

    return {
      cursor: response['@odata.nextLink'] || null,
      items: filteredNotebooks.map(({ id, displayName, isDefault, userRole }) => ({
        label: displayName,
        note: isDefault ? 'Default notebook' : `Role: ${ userRole }`,
        value: id,
      })),
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Section Groups Dictionary
   * @description Provides a searchable list of the signed-in user's OneNote section groups across all notebooks for dynamic parameter selection.
   * @route POST /get-section-groups-dictionary
   * @paramDef {"type":"getSectionGroupsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering section groups."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Projects","value":"1-a3c5e8f0-1b2d-4c6e-9f01-23456789abcd","note":"Notebook: Work Notebook"}],"cursor":null}
   */
  async getSectionGroupsDictionary(payload) {
    const { search, cursor } = payload || {}
    const url = cursor ? cursor : `${ ONENOTE_BASE_URL }/sectionGroups`
    const query = cursor ? undefined : { $top: PAGE_SIZE_DICTIONARY }

    const response = await this.#apiRequest({
      url,
      query,
      logTag: 'getSectionGroupsDictionary',
    })

    const sectionGroups = response.value || []
    const filteredSectionGroups = search ? searchFilter(sectionGroups, ['displayName'], search) : sectionGroups

    return {
      cursor: response['@odata.nextLink'] || null,
      items: filteredSectionGroups.map(({ id, displayName, parentNotebook }) => ({
        label: displayName,
        note: parentNotebook?.displayName ? `Notebook: ${ parentNotebook.displayName }` : `ID: ${ id }`,
        value: id,
      })),
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Sections Dictionary
   * @description Provides a searchable list of the signed-in user's OneNote sections across all notebooks, including sections nested in section groups, for dynamic parameter selection.
   * @route POST /get-sections-dictionary
   * @paramDef {"type":"getSectionsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering sections."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Meeting Notes","value":"1-b7d9f1a3-5c8e-4a2b-8d0f-13579bdf2468","note":"Notebook: Work Notebook"}],"cursor":null}
   */
  async getSectionsDictionary(payload) {
    const { search, cursor } = payload || {}
    const url = cursor ? cursor : `${ ONENOTE_BASE_URL }/sections`
    const query = cursor ? undefined : { $top: PAGE_SIZE_DICTIONARY }

    const response = await this.#apiRequest({
      url,
      query,
      logTag: 'getSectionsDictionary',
    })

    const sections = response.value || []
    const filteredSections = search ? searchFilter(sections, ['displayName'], search) : sections

    return {
      cursor: response['@odata.nextLink'] || null,
      items: filteredSections.map(({ id, displayName, parentNotebook }) => ({
        label: displayName,
        note: parentNotebook?.displayName ? `Notebook: ${ parentNotebook.displayName }` : `ID: ${ id }`,
        value: id,
      })),
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Pages Dictionary
   * @description Provides a searchable list of OneNote pages for dynamic parameter selection. Lists pages of a specific section when one is chosen, or the most recently modified pages across all notebooks otherwise.
   * @route POST /get-pages-dictionary
   * @paramDef {"type":"getPagesDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string, pagination cursor, and the section criteria whose pages to list."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Weekly sync","value":"1-c2e4a6b8-0d1f-4e3a-9b5c-2468ace02468","note":"Section: Meeting Notes"}],"cursor":null}
   */
  async getPagesDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const sectionId = criteria?.sectionId

    const baseUrl = sectionId
      ? `${ ONENOTE_BASE_URL }/sections/${ sectionId }/pages`
      : `${ ONENOTE_BASE_URL }/pages`

    const url = cursor ? cursor : baseUrl
    const query = cursor ? undefined : { $top: PAGE_SIZE_DICTIONARY }

    const response = await this.#apiRequest({
      url,
      query,
      logTag: 'getPagesDictionary',
    })

    const pages = response.value || []
    const filteredPages = search ? searchFilter(pages, ['title'], search) : pages

    return {
      cursor: response['@odata.nextLink'] || null,
      items: filteredPages.map(({ id, title, parentSection }) => ({
        label: title || '(untitled page)',
        note: parentSection?.displayName ? `Section: ${ parentSection.displayName }` : `ID: ${ id }`,
        value: id,
      })),
    }
  }

  /**
   * @operationName List Notebooks
   * @category Notebooks
   * @appearanceColor #7719AA #5B1382
   * @description Retrieves the signed-in user's OneNote notebooks, including each notebook's ID, display name, default flag, user role, sharing status, and OneNote client/web links. Sorted by name ascending by default. Supports OData filtering, ordering, paging, and expanding sections and section groups inline.
   * @route GET /list-notebooks
   * @paramDef {"type":"String","label":"Filter","name":"filter","description":"OData $filter expression, e.g. isDefault eq true or contains(tolower(displayName),'work'). Property names are case-sensitive."}
   * @paramDef {"type":"String","label":"Order By","name":"orderBy","description":"OData $orderby expression, e.g. displayName asc or lastModifiedDateTime desc. Defaults to name ascending."}
   * @paramDef {"type":"String","label":"Expand","name":"expand","description":"OData $expand expression to include child items inline, e.g. sections,sectionGroups($expand=sections) to return the full notebook hierarchy in one call."}
   * @paramDef {"type":"Number","label":"Max Results","name":"top","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The maximum number of notebooks to return, up to 100. Defaults to 20."}
   * @paramDef {"type":"String","label":"Next Page Link","name":"nextLink","description":"URL to retrieve the next page of results. If provided, all other parameters are ignored."}
   * @returns {Object}
   * @sampleResult {"value":[{"id":"1-f0f09ab6-3a68-4d59-b40e-0f8254e14dd6","displayName":"Work Notebook","isDefault":true,"userRole":"Owner","isShared":false,"createdDateTime":"2026-05-01T09:00:00Z","lastModifiedDateTime":"2026-07-15T14:30:00Z","sectionsUrl":"https://graph.microsoft.com/v1.0/me/onenote/notebooks/1-f0f09ab6-3a68-4d59-b40e-0f8254e14dd6/sections","links":{"oneNoteWebUrl":{"href":"https://onedrive.live.com/redir.aspx?cid=abc"}}}]}
   */
  async listNotebooks(filter, orderBy, expand, top, nextLink) {
    if (nextLink) {
      return this.#apiRequest({
        url: nextLink,
        logTag: 'listNotebooks',
      })
    }

    return this.#apiRequest({
      url: `${ ONENOTE_BASE_URL }/notebooks`,
      logTag: 'listNotebooks',
      query: {
        $filter: filter,
        $orderby: orderBy,
        $expand: expand,
        $top: top,
      },
    })
  }

  /**
   * @operationName Get Notebook
   * @category Notebooks
   * @appearanceColor #7719AA #5B1382
   * @description Retrieves a single OneNote notebook by its ID, including its display name, default flag, user role, sharing status, timestamps, and OneNote client/web links.
   * @route GET /get-notebook
   * @paramDef {"type":"String","label":"Notebook","name":"notebookId","required":true,"dictionary":"getNotebooksDictionary","description":"The notebook to retrieve. Choose a notebook or paste a notebook ID."}
   * @returns {Object}
   * @sampleResult {"id":"1-f0f09ab6-3a68-4d59-b40e-0f8254e14dd6","displayName":"Work Notebook","isDefault":true,"userRole":"Owner","isShared":false,"createdDateTime":"2026-05-01T09:00:00Z","lastModifiedDateTime":"2026-07-15T14:30:00Z","links":{"oneNoteClientUrl":{"href":"onenote:https://d.docs.live.net/abc/Documents/Work%20Notebook"},"oneNoteWebUrl":{"href":"https://onedrive.live.com/redir.aspx?cid=abc"}}}
   */
  async getNotebook(notebookId) {
    if (!notebookId) {
      throw new Error('Parameter "Notebook" is required')
    }

    return this.#apiRequest({
      url: `${ ONENOTE_BASE_URL }/notebooks/${ notebookId }`,
      logTag: 'getNotebook',
    })
  }

  /**
   * @operationName Create Notebook
   * @category Notebooks
   * @appearanceColor #7719AA #5B1382
   * @description Creates a new OneNote notebook with the given name in the signed-in user's account. Notebook names must be unique, cannot exceed 128 characters, and cannot contain the characters ? * \ / : < > | ' ".
   * @route POST /create-notebook
   * @paramDef {"type":"String","label":"Notebook Name","name":"displayName","required":true,"description":"The name of the new notebook. Must be unique, at most 128 characters, and must not contain ? * \\ / : < > | ' \" characters."}
   * @returns {Object}
   * @sampleResult {"id":"1-9a8b7c6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d","displayName":"Project Phoenix","isDefault":false,"userRole":"Owner","isShared":false,"createdDateTime":"2026-07-16T10:00:00Z","lastModifiedDateTime":"2026-07-16T10:00:00Z","sectionsUrl":"https://graph.microsoft.com/v1.0/me/onenote/notebooks/1-9a8b7c6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d/sections"}
   */
  async createNotebook(displayName) {
    if (!displayName) {
      throw new Error('Parameter "Notebook Name" is required')
    }

    return this.#apiRequest({
      url: `${ ONENOTE_BASE_URL }/notebooks`,
      logTag: 'createNotebook',
      method: 'post',
      body: { displayName },
    })
  }

  /**
   * @operationName List Notebook Sections
   * @category Notebooks
   * @appearanceColor #7719AA #5B1382
   * @description Retrieves the sections directly under a specific notebook, including each section's ID, display name, default flag, and pages URL. Sections nested inside the notebook's section groups are not included; use List Section Group Sections for those. Sorted by name ascending by default.
   * @route GET /list-notebook-sections
   * @paramDef {"type":"String","label":"Notebook","name":"notebookId","required":true,"dictionary":"getNotebooksDictionary","description":"The notebook whose sections to retrieve. Choose a notebook or paste a notebook ID."}
   * @paramDef {"type":"String","label":"Filter","name":"filter","description":"OData $filter expression, e.g. contains(tolower(displayName),'notes'). Property names are case-sensitive."}
   * @paramDef {"type":"Number","label":"Max Results","name":"top","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The maximum number of sections to return, up to 100. Defaults to 20."}
   * @paramDef {"type":"String","label":"Next Page Link","name":"nextLink","description":"URL to retrieve the next page of results. If provided, all other parameters are ignored."}
   * @returns {Object}
   * @sampleResult {"value":[{"id":"1-b7d9f1a3-5c8e-4a2b-8d0f-13579bdf2468","displayName":"Meeting Notes","isDefault":false,"createdDateTime":"2026-05-02T09:00:00Z","lastModifiedDateTime":"2026-07-15T14:30:00Z","pagesUrl":"https://graph.microsoft.com/v1.0/me/onenote/sections/1-b7d9f1a3-5c8e-4a2b-8d0f-13579bdf2468/pages"}]}
   */
  async listNotebookSections(notebookId, filter, top, nextLink) {
    if (nextLink) {
      return this.#apiRequest({
        url: nextLink,
        logTag: 'listNotebookSections',
      })
    }

    if (!notebookId) {
      throw new Error('Parameter "Notebook" is required')
    }

    return this.#apiRequest({
      url: `${ ONENOTE_BASE_URL }/notebooks/${ notebookId }/sections`,
      logTag: 'listNotebookSections',
      query: {
        $filter: filter,
        $top: top,
      },
    })
  }

  /**
   * @operationName Create Section
   * @category Notebooks
   * @appearanceColor #7719AA #5B1382
   * @description Creates a new section directly under a notebook. Section names must be unique within the notebook, cannot exceed 50 characters, and cannot contain the characters ? * \ / : < > | & # ' % ~.
   * @route POST /create-section
   * @paramDef {"type":"String","label":"Notebook","name":"notebookId","required":true,"dictionary":"getNotebooksDictionary","description":"The notebook in which to create the section. Choose a notebook or paste a notebook ID."}
   * @paramDef {"type":"String","label":"Section Name","name":"displayName","required":true,"description":"The name of the new section. Must be unique within the notebook, at most 50 characters, and must not contain ? * \\ / : < > | & # ' % ~ characters."}
   * @returns {Object}
   * @sampleResult {"id":"1-d4f6a8b0-2c3e-4d5f-8a9b-fedcba987654","displayName":"Sprint Planning","isDefault":false,"createdDateTime":"2026-07-16T10:05:00Z","lastModifiedDateTime":"2026-07-16T10:05:00Z","pagesUrl":"https://graph.microsoft.com/v1.0/me/onenote/sections/1-d4f6a8b0-2c3e-4d5f-8a9b-fedcba987654/pages"}
   */
  async createSection(notebookId, displayName) {
    if (!notebookId) {
      throw new Error('Parameter "Notebook" is required')
    }

    if (!displayName) {
      throw new Error('Parameter "Section Name" is required')
    }

    return this.#apiRequest({
      url: `${ ONENOTE_BASE_URL }/notebooks/${ notebookId }/sections`,
      logTag: 'createSection',
      method: 'post',
      body: { displayName },
    })
  }

  /**
   * @operationName Copy Notebook
   * @category Notebooks
   * @appearanceColor #7719AA #5B1382
   * @executionTimeoutInSeconds 120
   * @description Copies a notebook to the Notebooks folder in the signed-in user's OneDrive Documents library (the folder is created if it does not exist). The copy runs asynchronously on the Microsoft side; by default this action polls until the operation completes (up to about 100 seconds) and returns the final operation status including the ID of the created notebook. Turn off Wait For Completion to return immediately and track progress with Get Operation Status.
   * @route POST /copy-notebook
   * @paramDef {"type":"String","label":"Notebook","name":"notebookId","required":true,"dictionary":"getNotebooksDictionary","description":"The notebook to copy. Choose a notebook or paste a notebook ID."}
   * @paramDef {"type":"String","label":"New Name","name":"renameAs","description":"Optional name for the copy. Defaults to the name of the existing notebook."}
   * @paramDef {"type":"Boolean","label":"Wait For Completion","name":"waitForCompletion","defaultValue":true,"uiComponent":{"type":"TOGGLE"},"description":"When enabled, polls the copy operation until it completes or fails (up to about 100 seconds) and returns the final status. When disabled, returns the pending operation immediately; use Get Operation Status with the returned operation ID to track progress."}
   * @returns {Object}
   * @sampleResult {"id":"copy-4f8a2c1e-9b3d-4e5f-8a7b-1c2d3e4f5a6b","status":"Completed","createdDateTime":"2026-07-16T10:10:00Z","lastActionDateTime":"2026-07-16T10:10:45Z","resourceLocation":"https://graph.microsoft.com/v1.0/me/onenote/notebooks/1-9a8b7c6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d","resourceId":"1-9a8b7c6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d","error":null,"percentComplete":"100"}
   */
  async copyNotebook(notebookId, renameAs, waitForCompletion) {
    if (!notebookId) {
      throw new Error('Parameter "Notebook" is required')
    }

    return this.#startCopyOperation({
      url: `${ ONENOTE_BASE_URL }/notebooks/${ notebookId }/copyNotebook`,
      body: { renameAs },
      waitForCompletion,
      logTag: 'copyNotebook',
    })
  }

  /**
   * @operationName List Section Groups
   * @category Section Groups
   * @appearanceColor #7719AA #5B1382
   * @description Retrieves the signed-in user's OneNote section groups, including nested section groups, across all notebooks or within a specific notebook. Each section group includes its ID, display name, parent notebook, and URLs for its sections and child section groups. Sorted by name ascending by default.
   * @route GET /list-section-groups
   * @paramDef {"type":"String","label":"Notebook","name":"notebookId","dictionary":"getNotebooksDictionary","description":"Optional notebook to list section groups from. When omitted, section groups from all notebooks are returned, including nested section groups."}
   * @paramDef {"type":"String","label":"Filter","name":"filter","description":"OData $filter expression, e.g. contains(tolower(displayName),'projects'). Property names are case-sensitive."}
   * @paramDef {"type":"String","label":"Order By","name":"orderBy","description":"OData $orderby expression, e.g. displayName asc or lastModifiedDateTime desc. Defaults to name ascending."}
   * @paramDef {"type":"Number","label":"Max Results","name":"top","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The maximum number of section groups to return, up to 100. Defaults to 20."}
   * @paramDef {"type":"String","label":"Next Page Link","name":"nextLink","description":"URL to retrieve the next page of results. If provided, all other parameters are ignored."}
   * @returns {Object}
   * @sampleResult {"value":[{"id":"1-a3c5e8f0-1b2d-4c6e-9f01-23456789abcd","displayName":"Projects","createdDateTime":"2026-05-03T09:00:00Z","lastModifiedDateTime":"2026-07-10T11:00:00Z","sectionsUrl":"https://graph.microsoft.com/v1.0/me/onenote/sectionGroups/1-a3c5e8f0-1b2d-4c6e-9f01-23456789abcd/sections","sectionGroupsUrl":"https://graph.microsoft.com/v1.0/me/onenote/sectionGroups/1-a3c5e8f0-1b2d-4c6e-9f01-23456789abcd/sectionGroups","parentNotebook":{"id":"1-f0f09ab6-3a68-4d59-b40e-0f8254e14dd6","displayName":"Work Notebook"}}]}
   */
  async listSectionGroups(notebookId, filter, orderBy, top, nextLink) {
    if (nextLink) {
      return this.#apiRequest({
        url: nextLink,
        logTag: 'listSectionGroups',
      })
    }

    const url = notebookId
      ? `${ ONENOTE_BASE_URL }/notebooks/${ notebookId }/sectionGroups`
      : `${ ONENOTE_BASE_URL }/sectionGroups`

    return this.#apiRequest({
      url,
      logTag: 'listSectionGroups',
      query: {
        $filter: filter,
        $orderby: orderBy,
        $top: top,
      },
    })
  }

  /**
   * @operationName Get Section Group
   * @category Section Groups
   * @appearanceColor #7719AA #5B1382
   * @description Retrieves a single section group by its ID, including its display name, parent notebook, parent section group, and URLs for its sections and child section groups.
   * @route GET /get-section-group
   * @paramDef {"type":"String","label":"Section Group","name":"sectionGroupId","required":true,"dictionary":"getSectionGroupsDictionary","description":"The section group to retrieve. Choose a section group or paste a section group ID."}
   * @returns {Object}
   * @sampleResult {"id":"1-a3c5e8f0-1b2d-4c6e-9f01-23456789abcd","displayName":"Projects","createdDateTime":"2026-05-03T09:00:00Z","lastModifiedDateTime":"2026-07-10T11:00:00Z","sectionsUrl":"https://graph.microsoft.com/v1.0/me/onenote/sectionGroups/1-a3c5e8f0-1b2d-4c6e-9f01-23456789abcd/sections","parentNotebook":{"id":"1-f0f09ab6-3a68-4d59-b40e-0f8254e14dd6","displayName":"Work Notebook"}}
   */
  async getSectionGroup(sectionGroupId) {
    if (!sectionGroupId) {
      throw new Error('Parameter "Section Group" is required')
    }

    return this.#apiRequest({
      url: `${ ONENOTE_BASE_URL }/sectionGroups/${ sectionGroupId }`,
      logTag: 'getSectionGroup',
    })
  }

  /**
   * @operationName List Section Group Sections
   * @category Section Groups
   * @appearanceColor #7719AA #5B1382
   * @description Retrieves the sections directly under a specific section group, including each section's ID, display name, and pages URL. Sorted by name ascending by default.
   * @route GET /list-section-group-sections
   * @paramDef {"type":"String","label":"Section Group","name":"sectionGroupId","required":true,"dictionary":"getSectionGroupsDictionary","description":"The section group whose sections to retrieve. Choose a section group or paste a section group ID."}
   * @paramDef {"type":"String","label":"Filter","name":"filter","description":"OData $filter expression, e.g. contains(tolower(displayName),'notes'). Property names are case-sensitive."}
   * @paramDef {"type":"Number","label":"Max Results","name":"top","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The maximum number of sections to return, up to 100. Defaults to 20."}
   * @paramDef {"type":"String","label":"Next Page Link","name":"nextLink","description":"URL to retrieve the next page of results. If provided, all other parameters are ignored."}
   * @returns {Object}
   * @sampleResult {"value":[{"id":"1-e5a7c9b1-3d4f-4e6a-8b0c-97531fdb8642","displayName":"Phoenix Design","isDefault":false,"createdDateTime":"2026-05-04T09:00:00Z","lastModifiedDateTime":"2026-07-12T16:20:00Z","pagesUrl":"https://graph.microsoft.com/v1.0/me/onenote/sections/1-e5a7c9b1-3d4f-4e6a-8b0c-97531fdb8642/pages"}]}
   */
  async listSectionGroupSections(sectionGroupId, filter, top, nextLink) {
    if (nextLink) {
      return this.#apiRequest({
        url: nextLink,
        logTag: 'listSectionGroupSections',
      })
    }

    if (!sectionGroupId) {
      throw new Error('Parameter "Section Group" is required')
    }

    return this.#apiRequest({
      url: `${ ONENOTE_BASE_URL }/sectionGroups/${ sectionGroupId }/sections`,
      logTag: 'listSectionGroupSections',
      query: {
        $filter: filter,
        $top: top,
      },
    })
  }

  /**
   * @operationName Create Section in Section Group
   * @category Section Groups
   * @appearanceColor #7719AA #5B1382
   * @description Creates a new section inside a section group. Section names must be unique within the section group, cannot exceed 50 characters, and cannot contain the characters ? * \ / : < > | & # ' % ~.
   * @route POST /create-section-in-section-group
   * @paramDef {"type":"String","label":"Section Group","name":"sectionGroupId","required":true,"dictionary":"getSectionGroupsDictionary","description":"The section group in which to create the section. Choose a section group or paste a section group ID."}
   * @paramDef {"type":"String","label":"Section Name","name":"displayName","required":true,"description":"The name of the new section. Must be unique within the section group, at most 50 characters, and must not contain ? * \\ / : < > | & # ' % ~ characters."}
   * @returns {Object}
   * @sampleResult {"id":"1-f6b8d0c2-4e5a-4f7b-9c1d-8642fdb97531","displayName":"Research","isDefault":false,"createdDateTime":"2026-07-16T10:15:00Z","lastModifiedDateTime":"2026-07-16T10:15:00Z","pagesUrl":"https://graph.microsoft.com/v1.0/me/onenote/sections/1-f6b8d0c2-4e5a-4f7b-9c1d-8642fdb97531/pages"}
   */
  async createSectionInSectionGroup(sectionGroupId, displayName) {
    if (!sectionGroupId) {
      throw new Error('Parameter "Section Group" is required')
    }

    if (!displayName) {
      throw new Error('Parameter "Section Name" is required')
    }

    return this.#apiRequest({
      url: `${ ONENOTE_BASE_URL }/sectionGroups/${ sectionGroupId }/sections`,
      logTag: 'createSectionInSectionGroup',
      method: 'post',
      body: { displayName },
    })
  }

  /**
   * @operationName List Sections
   * @category Sections
   * @appearanceColor #7719AA #5B1382
   * @description Retrieves all sections from all of the signed-in user's notebooks, including sections nested in section groups. Each section includes its ID, display name, parent notebook, and pages URL. Sorted by name ascending by default.
   * @route GET /list-sections
   * @paramDef {"type":"String","label":"Filter","name":"filter","description":"OData $filter expression, e.g. contains(tolower(displayName),'meeting') or createdDateTime ge 2026-01-01. Property names are case-sensitive."}
   * @paramDef {"type":"String","label":"Order By","name":"orderBy","description":"OData $orderby expression, e.g. displayName asc or lastModifiedDateTime desc. Defaults to name ascending."}
   * @paramDef {"type":"Number","label":"Max Results","name":"top","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The maximum number of sections to return, up to 100. Defaults to 20."}
   * @paramDef {"type":"String","label":"Next Page Link","name":"nextLink","description":"URL to retrieve the next page of results. If provided, all other parameters are ignored."}
   * @returns {Object}
   * @sampleResult {"value":[{"id":"1-b7d9f1a3-5c8e-4a2b-8d0f-13579bdf2468","displayName":"Meeting Notes","isDefault":false,"createdDateTime":"2026-05-02T09:00:00Z","lastModifiedDateTime":"2026-07-15T14:30:00Z","pagesUrl":"https://graph.microsoft.com/v1.0/me/onenote/sections/1-b7d9f1a3-5c8e-4a2b-8d0f-13579bdf2468/pages","parentNotebook":{"id":"1-f0f09ab6-3a68-4d59-b40e-0f8254e14dd6","displayName":"Work Notebook"}}]}
   */
  async listSections(filter, orderBy, top, nextLink) {
    if (nextLink) {
      return this.#apiRequest({
        url: nextLink,
        logTag: 'listSections',
      })
    }

    return this.#apiRequest({
      url: `${ ONENOTE_BASE_URL }/sections`,
      logTag: 'listSections',
      query: {
        $filter: filter,
        $orderby: orderBy,
        $top: top,
      },
    })
  }

  /**
   * @operationName Get Section
   * @category Sections
   * @appearanceColor #7719AA #5B1382
   * @description Retrieves a single section by its ID, including its display name, parent notebook, parent section group, timestamps, and pages URL.
   * @route GET /get-section
   * @paramDef {"type":"String","label":"Section","name":"sectionId","required":true,"dictionary":"getSectionsDictionary","description":"The section to retrieve. Choose a section or paste a section ID."}
   * @returns {Object}
   * @sampleResult {"id":"1-b7d9f1a3-5c8e-4a2b-8d0f-13579bdf2468","displayName":"Meeting Notes","isDefault":false,"createdDateTime":"2026-05-02T09:00:00Z","lastModifiedDateTime":"2026-07-15T14:30:00Z","pagesUrl":"https://graph.microsoft.com/v1.0/me/onenote/sections/1-b7d9f1a3-5c8e-4a2b-8d0f-13579bdf2468/pages","parentNotebook":{"id":"1-f0f09ab6-3a68-4d59-b40e-0f8254e14dd6","displayName":"Work Notebook"}}
   */
  async getSection(sectionId) {
    if (!sectionId) {
      throw new Error('Parameter "Section" is required')
    }

    return this.#apiRequest({
      url: `${ ONENOTE_BASE_URL }/sections/${ sectionId }`,
      logTag: 'getSection',
    })
  }

  /**
   * @operationName List Section Pages
   * @category Sections
   * @appearanceColor #7719AA #5B1382
   * @description Retrieves the pages of a specific section, including each page's ID, title, timestamps, content URL, and OneNote client/web links. Sorted by last modified time descending by default; up to 100 pages per call with offset paging. This is the recommended way to enumerate pages for accounts with many sections.
   * @route GET /list-section-pages
   * @paramDef {"type":"String","label":"Section","name":"sectionId","required":true,"dictionary":"getSectionsDictionary","description":"The section whose pages to retrieve. Choose a section or paste a section ID."}
   * @paramDef {"type":"String","label":"Order By","name":"orderBy","description":"OData $orderby expression, e.g. title asc or createdDateTime desc. Defaults to lastModifiedDateTime descending."}
   * @paramDef {"type":"Number","label":"Max Results","name":"top","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The maximum number of pages to return, up to 100. Defaults to 20."}
   * @paramDef {"type":"Number","label":"Skip","name":"skip","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The number of pages to skip before returning results. Useful for offset-based paging."}
   * @paramDef {"type":"Boolean","label":"Include Page Level","name":"pageLevel","uiComponent":{"type":"TOGGLE"},"description":"When enabled, each page includes its indentation level and order within the section."}
   * @paramDef {"type":"String","label":"Next Page Link","name":"nextLink","description":"URL to retrieve the next page of results. If provided, all other parameters are ignored."}
   * @returns {Object}
   * @sampleResult {"value":[{"id":"1-c2e4a6b8-0d1f-4e3a-9b5c-2468ace02468","title":"Weekly sync","createdDateTime":"2026-07-14T09:00:00Z","lastModifiedDateTime":"2026-07-15T14:30:00Z","contentUrl":"https://graph.microsoft.com/v1.0/me/onenote/pages/1-c2e4a6b8-0d1f-4e3a-9b5c-2468ace02468/content","links":{"oneNoteWebUrl":{"href":"https://onedrive.live.com/redir.aspx?cid=abc"}}}]}
   */
  async listSectionPages(sectionId, orderBy, top, skip, pageLevel, nextLink) {
    if (nextLink) {
      return this.#apiRequest({
        url: nextLink,
        logTag: 'listSectionPages',
      })
    }

    if (!sectionId) {
      throw new Error('Parameter "Section" is required')
    }

    return this.#apiRequest({
      url: `${ ONENOTE_BASE_URL }/sections/${ sectionId }/pages`,
      logTag: 'listSectionPages',
      query: {
        $orderby: orderBy,
        $top: top,
        $skip: skip,
        pagelevel: pageLevel ? 'true' : undefined,
      },
    })
  }

  /**
   * @operationName Copy Section To Notebook
   * @category Sections
   * @appearanceColor #7719AA #5B1382
   * @executionTimeoutInSeconds 120
   * @description Copies a section (with all of its pages) into a target notebook. The copy runs asynchronously on the Microsoft side; by default this action polls until the operation completes (up to about 100 seconds) and returns the final operation status including the ID of the created section. Turn off Wait For Completion to return immediately and track progress with Get Operation Status.
   * @route POST /copy-section-to-notebook
   * @paramDef {"type":"String","label":"Section","name":"sectionId","required":true,"dictionary":"getSectionsDictionary","description":"The section to copy. Choose a section or paste a section ID."}
   * @paramDef {"type":"String","label":"Target Notebook","name":"targetNotebookId","required":true,"dictionary":"getNotebooksDictionary","description":"The notebook to copy the section into. Choose a notebook or paste a notebook ID."}
   * @paramDef {"type":"String","label":"New Name","name":"renameAs","description":"Optional name for the copied section. Defaults to the name of the existing section."}
   * @paramDef {"type":"Boolean","label":"Wait For Completion","name":"waitForCompletion","defaultValue":true,"uiComponent":{"type":"TOGGLE"},"description":"When enabled, polls the copy operation until it completes or fails (up to about 100 seconds) and returns the final status. When disabled, returns the pending operation immediately; use Get Operation Status with the returned operation ID to track progress."}
   * @returns {Object}
   * @sampleResult {"id":"copy-7b3e9d2a-1c4f-4a6b-8e5d-2f1a3b4c5d6e","status":"Completed","createdDateTime":"2026-07-16T10:20:00Z","lastActionDateTime":"2026-07-16T10:20:30Z","resourceLocation":"https://graph.microsoft.com/v1.0/me/onenote/sections/1-d4f6a8b0-2c3e-4d5f-8a9b-fedcba987654","resourceId":"1-d4f6a8b0-2c3e-4d5f-8a9b-fedcba987654","error":null,"percentComplete":"100"}
   */
  async copySectionToNotebook(sectionId, targetNotebookId, renameAs, waitForCompletion) {
    if (!sectionId) {
      throw new Error('Parameter "Section" is required')
    }

    if (!targetNotebookId) {
      throw new Error('Parameter "Target Notebook" is required')
    }

    return this.#startCopyOperation({
      url: `${ ONENOTE_BASE_URL }/sections/${ sectionId }/copyToNotebook`,
      body: { id: targetNotebookId, renameAs },
      waitForCompletion,
      logTag: 'copySectionToNotebook',
    })
  }

  /**
   * @operationName Copy Section To Section Group
   * @category Sections
   * @appearanceColor #7719AA #5B1382
   * @executionTimeoutInSeconds 120
   * @description Copies a section (with all of its pages) into a target section group. The copy runs asynchronously on the Microsoft side; by default this action polls until the operation completes (up to about 100 seconds) and returns the final operation status including the ID of the created section. Turn off Wait For Completion to return immediately and track progress with Get Operation Status.
   * @route POST /copy-section-to-section-group
   * @paramDef {"type":"String","label":"Section","name":"sectionId","required":true,"dictionary":"getSectionsDictionary","description":"The section to copy. Choose a section or paste a section ID."}
   * @paramDef {"type":"String","label":"Target Section Group","name":"targetSectionGroupId","required":true,"dictionary":"getSectionGroupsDictionary","description":"The section group to copy the section into. Choose a section group or paste a section group ID."}
   * @paramDef {"type":"String","label":"New Name","name":"renameAs","description":"Optional name for the copied section. Defaults to the name of the existing section."}
   * @paramDef {"type":"Boolean","label":"Wait For Completion","name":"waitForCompletion","defaultValue":true,"uiComponent":{"type":"TOGGLE"},"description":"When enabled, polls the copy operation until it completes or fails (up to about 100 seconds) and returns the final status. When disabled, returns the pending operation immediately; use Get Operation Status with the returned operation ID to track progress."}
   * @returns {Object}
   * @sampleResult {"id":"copy-2d8f4b6c-3e5a-4c7d-9f1b-6a5b4c3d2e1f","status":"Completed","createdDateTime":"2026-07-16T10:25:00Z","lastActionDateTime":"2026-07-16T10:25:30Z","resourceLocation":"https://graph.microsoft.com/v1.0/me/onenote/sections/1-f6b8d0c2-4e5a-4f7b-9c1d-8642fdb97531","resourceId":"1-f6b8d0c2-4e5a-4f7b-9c1d-8642fdb97531","error":null,"percentComplete":"100"}
   */
  async copySectionToSectionGroup(sectionId, targetSectionGroupId, renameAs, waitForCompletion) {
    if (!sectionId) {
      throw new Error('Parameter "Section" is required')
    }

    if (!targetSectionGroupId) {
      throw new Error('Parameter "Target Section Group" is required')
    }

    return this.#startCopyOperation({
      url: `${ ONENOTE_BASE_URL }/sections/${ sectionId }/copyToSectionGroup`,
      body: { id: targetSectionGroupId, renameAs },
      waitForCompletion,
      logTag: 'copySectionToSectionGroup',
    })
  }

  /**
   * @operationName List Pages
   * @category Pages
   * @appearanceColor #7719AA #5B1382
   * @description Retrieves page metadata across all of the signed-in user's notebooks, sorted by last modified time descending by default. Supports full-text search (personal Microsoft accounts with notebooks on consumer OneDrive only), OData filtering, ordering, and offset paging up to 100 pages per call. For work or school accounts with many sections, Microsoft recommends List Section Pages instead; this endpoint returns an error when the account exceeds the maximum number of sections.
   * @route GET /list-pages
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Full-text search query matched against page content and titles, e.g. quarterly report. Supported only for personal Microsoft accounts (notebooks on consumer OneDrive); work or school accounts should use Filter instead."}
   * @paramDef {"type":"String","label":"Filter","name":"filter","description":"OData $filter expression, e.g. contains(tolower(title),'sync') or createdDateTime ge 2026-01-01. Property names are case-sensitive."}
   * @paramDef {"type":"String","label":"Order By","name":"orderBy","description":"OData $orderby expression, e.g. lastModifiedDateTime desc, createdDateTime desc, or title asc. Defaults to lastModifiedDateTime descending."}
   * @paramDef {"type":"Number","label":"Max Results","name":"top","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The maximum number of pages to return, up to 100. Defaults to 20."}
   * @paramDef {"type":"Number","label":"Skip","name":"skip","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The number of pages to skip before returning results. Useful for offset-based paging."}
   * @paramDef {"type":"String","label":"Next Page Link","name":"nextLink","description":"URL to retrieve the next page of results. If provided, all other parameters are ignored."}
   * @returns {Object}
   * @sampleResult {"value":[{"id":"1-c2e4a6b8-0d1f-4e3a-9b5c-2468ace02468","title":"Weekly sync","createdDateTime":"2026-07-14T09:00:00Z","lastModifiedDateTime":"2026-07-15T14:30:00Z","contentUrl":"https://graph.microsoft.com/v1.0/me/onenote/pages/1-c2e4a6b8-0d1f-4e3a-9b5c-2468ace02468/content","parentSection":{"id":"1-b7d9f1a3-5c8e-4a2b-8d0f-13579bdf2468","displayName":"Meeting Notes"}}],"@odata.nextLink":"https://graph.microsoft.com/v1.0/me/onenote/pages?$skip=20"}
   */
  async listPages(search, filter, orderBy, top, skip, nextLink) {
    if (nextLink) {
      return this.#apiRequest({
        url: nextLink,
        logTag: 'listPages',
      })
    }

    return this.#apiRequest({
      url: `${ ONENOTE_BASE_URL }/pages`,
      logTag: 'listPages',
      query: {
        search,
        $filter: filter,
        $orderby: orderBy,
        $top: top,
        $skip: skip,
      },
    })
  }

  /**
   * @operationName Get Page
   * @category Pages
   * @appearanceColor #7719AA #5B1382
   * @description Retrieves the metadata of a single page by its ID, including its title, timestamps, content URL, parent section, and OneNote client/web links. Use Get Page Content to retrieve the page HTML.
   * @route GET /get-page
   * @paramDef {"type":"String","label":"Section","name":"sectionId","dictionary":"getSectionsDictionary","description":"Optional. Narrows the Page drop-down below to pages of this section; it is not sent to the API."}
   * @paramDef {"type":"String","label":"Page","name":"pageId","required":true,"dictionary":"getPagesDictionary","dependsOn":["sectionId"],"description":"The page to retrieve. Choose a page or paste a page ID."}
   * @returns {Object}
   * @sampleResult {"id":"1-c2e4a6b8-0d1f-4e3a-9b5c-2468ace02468","title":"Weekly sync","createdDateTime":"2026-07-14T09:00:00Z","lastModifiedDateTime":"2026-07-15T14:30:00Z","contentUrl":"https://graph.microsoft.com/v1.0/me/onenote/pages/1-c2e4a6b8-0d1f-4e3a-9b5c-2468ace02468/content","links":{"oneNoteClientUrl":{"href":"onenote:https://d.docs.live.net/abc"},"oneNoteWebUrl":{"href":"https://onedrive.live.com/redir.aspx?cid=abc"}},"parentSection":{"id":"1-b7d9f1a3-5c8e-4a2b-8d0f-13579bdf2468","displayName":"Meeting Notes"}}
   */
  async getPage(sectionId, pageId) {
    if (!pageId) {
      throw new Error('Parameter "Page" is required')
    }

    return this.#apiRequest({
      url: `${ ONENOTE_BASE_URL }/pages/${ pageId }`,
      logTag: 'getPage',
    })
  }

  /**
   * @operationName Get Page Content
   * @category Pages
   * @appearanceColor #7719AA #5B1382
   * @description Retrieves the full content of a page as an XHTML string, including its structure, text, and resource links for embedded images and files. Enable Include Element IDs to also receive generated element IDs, which are required as targets for most Update Page Content commands.
   * @route GET /get-page-content
   * @paramDef {"type":"String","label":"Section","name":"sectionId","dictionary":"getSectionsDictionary","description":"Optional. Narrows the Page drop-down below to pages of this section; it is not sent to the API."}
   * @paramDef {"type":"String","label":"Page","name":"pageId","required":true,"dictionary":"getPagesDictionary","dependsOn":["sectionId"],"description":"The page whose content to retrieve. Choose a page or paste a page ID."}
   * @paramDef {"type":"Boolean","label":"Include Element IDs","name":"includeIDs","uiComponent":{"type":"TOGGLE"},"description":"When enabled, the returned HTML includes generated element IDs (e.g. p:{a1b2c3d4-...}{40}) needed to target elements in Update Page Content. Generated IDs can change after a page update, so retrieve them right before updating."}
   * @returns {String}
   * @sampleResult "<html lang=\"en-US\"><head><title>Weekly sync</title><meta name=\"created\" content=\"2026-07-14T09:00:00.0000000\" /></head><body><div style=\"position:absolute;left:48px;top:120px;width:624px\"><p>Agenda: roadmap review</p></div></body></html>"
   */
  async getPageContent(sectionId, pageId, includeIDs) {
    if (!pageId) {
      throw new Error('Parameter "Page" is required')
    }

    const content = await this.#apiRequest({
      url: `${ ONENOTE_BASE_URL }/pages/${ pageId }/content`,
      logTag: 'getPageContent',
      query: includeIDs ? { includeIDs: 'true' } : undefined,
    })

    return Buffer.isBuffer(content) ? content.toString('utf8') : content
  }

  /**
   * @operationName Create Page
   * @category Pages
   * @appearanceColor #7719AA #5B1382
   * @description Creates a new page in a section from a title and HTML body, or from a complete raw XHTML document for full control. The body HTML supports standard elements (p, h1-h6, ul, ol, table, div, img, a) and images referenced by public URL, e.g. <img src='https://example.com/chart.png' width='500' />, which OneNote downloads and renders on the page. Returns the created page metadata including its ID and OneNote links.
   * @route POST /create-page
   * @paramDef {"type":"String","label":"Section","name":"sectionId","required":true,"dictionary":"getSectionsDictionary","description":"The section in which to create the page. Choose a section or paste a section ID."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"The title of the new page. Ignored when Raw XHTML Document is provided."}
   * @paramDef {"type":"String","label":"Body HTML","name":"htmlContent","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"HTML placed in the page body, e.g. <p>Notes from today</p><ul><li>First item</li></ul>. Images by public URL are rendered on the page: <img src=\"https://example.com/chart.png\" width=\"500\" />. Ignored when Raw XHTML Document is provided."}
   * @paramDef {"type":"String","label":"Raw XHTML Document","name":"rawHtml","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional complete XHTML document sent to the API as-is, e.g. <!DOCTYPE html><html><head><title>My page</title></head><body><p>Content</p></body></html>. Overrides Title and Body HTML. Use data-id attributes on elements to make them addressable by Update Page Content."}
   * @returns {Object}
   * @sampleResult {"id":"1-d3f5b7a9-1e2c-4d6f-8a0b-13572468ace0","title":"Notes from today","createdDateTime":"2026-07-16T10:30:00Z","lastModifiedDateTime":"2026-07-16T10:30:00Z","contentUrl":"https://graph.microsoft.com/v1.0/me/onenote/pages/1-d3f5b7a9-1e2c-4d6f-8a0b-13572468ace0/content","links":{"oneNoteWebUrl":{"href":"https://onedrive.live.com/redir.aspx?cid=abc"}}}
   */
  async createPage(sectionId, title, htmlContent, rawHtml) {
    if (!sectionId) {
      throw new Error('Parameter "Section" is required')
    }

    if (!rawHtml && !title && !htmlContent) {
      throw new Error('Provide "Title", "Body HTML", or "Raw XHTML Document"')
    }

    const html = rawHtml || this.#buildPageHtml(title, htmlContent)

    return this.#apiRequest({
      url: `${ ONENOTE_BASE_URL }/sections/${ sectionId }/pages`,
      logTag: 'createPage',
      method: 'post',
      headers: { 'Content-Type': 'text/html' },
      body: html,
    })
  }

  /**
   * @operationName Update Page Content
   * @category Pages
   * @appearanceColor #7719AA #5B1382
   * @description Updates the content of an existing page by applying change commands. Use Append HTML for the common case of adding content to the end of the page, or supply structured commands to append, insert, prepend, or replace specific elements. Targets are data-id values prefixed with # (defined in the page HTML at creation), generated element IDs from Get Page Content with Include Element IDs enabled, or the keywords body and title. External image URLs are not supported in update commands (unlike Create Page).
   * @route PATCH /update-page-content
   * @paramDef {"type":"String","label":"Section","name":"sectionId","dictionary":"getSectionsDictionary","description":"Optional. Narrows the Page drop-down below to pages of this section; it is not sent to the API."}
   * @paramDef {"type":"String","label":"Page","name":"pageId","required":true,"dictionary":"getPagesDictionary","dependsOn":["sectionId"],"description":"The page whose content to update. Choose a page or paste a page ID."}
   * @paramDef {"type":"String","label":"Append HTML","name":"appendHtml","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Convenience shortcut: well-formed HTML appended to the end of the page body, e.g. <p>Follow-up: send recap email</p>. Applied in addition to any structured commands."}
   * @paramDef {"type":"Array<PatchContentCommand>","label":"Commands","name":"commands","description":"Structured change commands applied to the page in order. Each command specifies a target element, an action (Append, Insert, Prepend, or Replace), an optional position (After or Before), and the HTML content."}
   * @returns {Object}
   * @sampleResult {"message":"Page content updated successfully"}
   */
  async updatePageContent(sectionId, pageId, appendHtml, commands) {
    if (!pageId) {
      throw new Error('Parameter "Page" is required')
    }

    const normalizedCommands = (commands || []).map(command => cleanupObject({
      target: command.target,
      action: this.#resolveChoice(command.action, PATCH_ACTION_MAP),
      position: this.#resolveChoice(command.position, PATCH_POSITION_MAP),
      content: command.content,
    }))

    if (appendHtml) {
      normalizedCommands.push({
        target: 'body',
        action: 'append',
        position: 'after',
        content: appendHtml,
      })
    }

    if (!normalizedCommands.length) {
      throw new Error('Provide "Append HTML" or at least one entry in "Commands"')
    }

    await this.#apiRequest({
      url: `${ ONENOTE_BASE_URL }/pages/${ pageId }/content`,
      logTag: 'updatePageContent',
      method: 'patch',
      headers: { 'Content-Type': 'application/json' },
      body: normalizedCommands,
    })

    return { message: 'Page content updated successfully' }
  }

  /**
   * @operationName Copy Page To Section
   * @category Pages
   * @appearanceColor #7719AA #5B1382
   * @executionTimeoutInSeconds 120
   * @description Copies a page into a target section. The copy runs asynchronously on the Microsoft side; by default this action polls until the operation completes (up to about 100 seconds) and returns the final operation status including the ID of the created page. Turn off Wait For Completion to return immediately and track progress with Get Operation Status.
   * @route POST /copy-page-to-section
   * @paramDef {"type":"String","label":"Source Section","name":"sectionId","dictionary":"getSectionsDictionary","description":"Optional. Narrows the Page drop-down below to pages of this section; it is not sent to the API."}
   * @paramDef {"type":"String","label":"Page","name":"pageId","required":true,"dictionary":"getPagesDictionary","dependsOn":["sectionId"],"description":"The page to copy. Choose a page or paste a page ID."}
   * @paramDef {"type":"String","label":"Target Section","name":"targetSectionId","required":true,"dictionary":"getSectionsDictionary","description":"The section to copy the page into. Choose a section or paste a section ID."}
   * @paramDef {"type":"Boolean","label":"Wait For Completion","name":"waitForCompletion","defaultValue":true,"uiComponent":{"type":"TOGGLE"},"description":"When enabled, polls the copy operation until it completes or fails (up to about 100 seconds) and returns the final status. When disabled, returns the pending operation immediately; use Get Operation Status with the returned operation ID to track progress."}
   * @returns {Object}
   * @sampleResult {"id":"copy-9e5c7a3b-2d4f-4b6e-8c1a-3e2d1c0b9a8f","status":"Completed","createdDateTime":"2026-07-16T10:35:00Z","lastActionDateTime":"2026-07-16T10:35:20Z","resourceLocation":"https://graph.microsoft.com/v1.0/me/onenote/pages/1-e4a6c8d0-2f3b-4e5a-9c7d-2468bdf13579","resourceId":"1-e4a6c8d0-2f3b-4e5a-9c7d-2468bdf13579","error":null,"percentComplete":"100"}
   */
  async copyPageToSection(sectionId, pageId, targetSectionId, waitForCompletion) {
    if (!pageId) {
      throw new Error('Parameter "Page" is required')
    }

    if (!targetSectionId) {
      throw new Error('Parameter "Target Section" is required')
    }

    return this.#startCopyOperation({
      url: `${ ONENOTE_BASE_URL }/pages/${ pageId }/copyToSection`,
      body: { id: targetSectionId },
      waitForCompletion,
      logTag: 'copyPageToSection',
    })
  }

  /**
   * @operationName Delete Page
   * @category Pages
   * @appearanceColor #7719AA #5B1382
   * @description Permanently deletes a page from its section, including all of its content.
   * @route DELETE /delete-page
   * @paramDef {"type":"String","label":"Section","name":"sectionId","dictionary":"getSectionsDictionary","description":"Optional. Narrows the Page drop-down below to pages of this section; it is not sent to the API."}
   * @paramDef {"type":"String","label":"Page","name":"pageId","required":true,"dictionary":"getPagesDictionary","dependsOn":["sectionId"],"description":"The page to delete. Choose a page or paste a page ID."}
   * @returns {Object}
   * @sampleResult {"message":"Page deleted successfully"}
   */
  async deletePage(sectionId, pageId) {
    if (!pageId) {
      throw new Error('Parameter "Page" is required')
    }

    await this.#apiRequest({
      url: `${ ONENOTE_BASE_URL }/pages/${ pageId }`,
      logTag: 'deletePage',
      method: 'delete',
    })

    return { message: 'Page deleted successfully' }
  }

  /**
   * @operationName Get Operation Status
   * @category Operations
   * @appearanceColor #7719AA #5B1382
   * @description Retrieves the status of a long-running OneNote copy operation started by Copy Notebook, Copy Section To Notebook, Copy Section To Section Group, or Copy Page To Section. While the operation runs, the status is NotStarted or Running. When the status is Completed, resourceId and resourceLocation identify the created copy; when the status is Failed, the error property contains details.
   * @route GET /get-operation-status
   * @paramDef {"type":"String","label":"Operation ID","name":"operationId","required":true,"description":"The ID of the copy operation to check, as returned in the id property of a copy action started with Wait For Completion disabled."}
   * @returns {Object}
   * @sampleResult {"id":"copy-4f8a2c1e-9b3d-4e5f-8a7b-1c2d3e4f5a6b","status":"Running","createdDateTime":"2026-07-16T10:10:00Z","lastActionDateTime":"2026-07-16T10:10:15Z","resourceLocation":null,"resourceId":null,"error":null,"percentComplete":"40"}
   */
  async getOperationStatus(operationId) {
    if (!operationId) {
      throw new Error('Parameter "Operation ID" is required')
    }

    return this.#apiRequest({
      url: `${ ONENOTE_BASE_URL }/operations/${ operationId }`,
      logTag: 'getOperationStatus',
    })
  }
}

Flowrunner.ServerCode.addService(MicrosoftOneNoteService, [
  {
    name: 'clientId',
    displayName: 'Client ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'OAuth2 Client ID (Application ID) of your Microsoft Entra app registration. The app must have the delegated Microsoft Graph permissions Notes.ReadWrite, Notes.Create, User.Read, and offline_access.',
  },
  {
    name: 'clientSecret',
    displayName: 'Client Secret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'OAuth2 Client Secret of your Microsoft Entra app registration.',
  },
])

function searchFilter(list, props, searchString) {
  const caseInsensitiveSearch = searchString.toLowerCase()

  return list.filter(item =>
    props.some(prop => {
      const value = prop.split('.').reduce((acc, key) => acc?.[key], item)

      return value && String(value).toLowerCase().includes(caseInsensitiveSearch)
    })
  )
}

function cleanupObject(data) {
  if (!data) {
    return
  }

  const result = {}

  Object.keys(data).forEach(key => {
    if (data[key] !== undefined && data[key] !== null) {
      result[key] = data[key]
    }
  })

  return result
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function constructIdentityName(user) {
  const email = user.mail || user.userPrincipalName

  if (email && user.displayName) {
    return `${ email } (${ user.displayName })`
  }

  return email || user.displayName || 'Microsoft OneNote Connection'
}
