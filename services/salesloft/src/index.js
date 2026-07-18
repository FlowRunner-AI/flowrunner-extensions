'use strict'

const AUTHORIZE_URL = 'https://accounts.salesloft.com/oauth/authorize'
const TOKEN_URL = 'https://accounts.salesloft.com/oauth/token'
const API_BASE_URL = 'https://api.salesloft.com/v2'

const DEFAULT_PER_PAGE = 25
const MAX_PER_PAGE = 100
const DICTIONARY_PER_PAGE = 100

const TASK_TYPE_OPTIONS = {
  'Call': 'call',
  'Email': 'email',
  'General': 'general',
}

const TASK_STATE_OPTIONS = {
  'Scheduled': 'scheduled',
  'Completed': 'completed',
}

const NOTE_ASSOCIATION_OPTIONS = {
  'Person': 'person',
  'Account': 'account',
}

const SORT_DIRECTION_OPTIONS = {
  'Ascending': 'ASC',
  'Descending': 'DESC',
}

const logger = {
  info: (...args) => console.log('[Salesloft] info:', ...args),
  debug: (...args) => console.log('[Salesloft] debug:', ...args),
  error: (...args) => console.log('[Salesloft] error:', ...args),
  warn: (...args) => console.log('[Salesloft] warn:', ...args),
}

/**
 * @requireOAuth
 * @integrationName Salesloft
 * @integrationIcon /icon.svg
 **/
class SalesloftService {
  constructor(config) {
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
  }

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

      // Salesloft DELETE endpoints return 204 No Content with an empty body.
      // Normalize those to a consistent success object.
      return isEmptyResponse(response) ? { status: 'success' } : response
    } catch (error) {
      const message = this.#extractError(error)

      logger.error(`${ logTag } - failed: ${ message }`)

      throw new Error(`Salesloft API error: ${ message }`)
    }
  }

  // Salesloft errors are shaped as { status, error } for request-level failures, or
  // { errors: { field: ["message"] } } for validation failures. The auth server uses
  // { error, error_description }.
  #extractError(error) {
    const body = error.body

    if (body) {
      if (typeof body.error === 'string') {
        return body.status ? `${ body.error } (status ${ body.status })` : body.error
      }

      if (body.errors && typeof body.errors === 'object') {
        const details = Object.entries(body.errors)
          .map(([field, messages]) => `${ field }: ${ Array.isArray(messages) ? messages.join(', ') : messages }`)
          .join('; ')

        if (details) {
          return details
        }
      }

      if (body.error_description) {
        return body.error_description
      }

      if (body.message) {
        return body.message
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

  // Sets a key on the target object only when the value is meaningful.
  #set(target, key, value) {
    if (value !== undefined && value !== null && value !== '') {
      target[key] = value
    }
  }

  // Coerces id-like values ("123") to numbers; leaves non-numeric values untouched.
  #toId(value) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    const numeric = Number(value)

    return Number.isFinite(numeric) ? numeric : value
  }

  // Normalizes an array parameter that may arrive as a list or a comma-separated string.
  #toList(value) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    if (Array.isArray(value)) {
      const items = value.filter(Boolean)

      return items.length ? items : undefined
    }

    return String(value).split(',').map(item => item.trim()).filter(Boolean)
  }

  // Normalizes an Object parameter that may arrive as a JSON string.
  #toObject(value, label) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    if (typeof value === 'string') {
      try {
        return JSON.parse(value)
      } catch (error) {
        throw new Error(`"${ label }" must be a valid JSON object: ${ error.message }`)
      }
    }

    return value
  }

  // Builds the standard page-based list query. include_paging_counts asks Salesloft
  // to compute total_pages/total_count in the paging metadata.
  #listQuery(page, perPage, extra) {
    return {
      page: page || undefined,
      per_page: Math.min(perPage || DEFAULT_PER_PAGE, MAX_PER_PAGE),
      include_paging_counts: true,
      ...(extra || {}),
    }
  }

  // Unwraps a Salesloft list response ({ data, metadata: { paging } }) into a flat result.
  #listResponse(response) {
    const paging = response?.metadata?.paging || {}

    return {
      items: Array.isArray(response?.data) ? response.data : [],
      currentPage: paging.current_page ?? null,
      perPage: paging.per_page ?? null,
      nextPage: paging.next_page ?? null,
      prevPage: paging.prev_page ?? null,
      totalPages: paging.total_pages ?? null,
      totalCount: paging.total_count ?? null,
    }
  }

  // ============================================= OAUTH ================================================

  /**
   * @registerAs SYSTEM
   * @route GET /getOAuth2ConnectionURL
   * @returns {String}
   */
  async getOAuth2ConnectionURL() {
    // API: https://developers.salesloft.com - OAuth Authentication
    // redirect_uri is injected by the FlowRunner platform - do NOT append it here.
    const params = new URLSearchParams({
      client_id: this.clientId,
      response_type: 'code',
    })

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
    const tokenResponse = await Flowrunner.Request.post(TOKEN_URL)
      .set({ 'Content-Type': 'application/json' })
      .send({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code: callbackObject.code,
        grant_type: 'authorization_code',
        redirect_uri: callbackObject.redirectURI,
      })

    let connectionIdentityName = 'Salesloft Account'

    try {
      const meResponse = await Flowrunner.Request
        .get(`${ API_BASE_URL }/me`)
        .set({ 'Authorization': `Bearer ${ tokenResponse.access_token }` })

      const me = meResponse?.data || {}
      const fullName = [me.first_name, me.last_name].filter(Boolean).join(' ')

      connectionIdentityName = fullName || me.email || connectionIdentityName
    } catch (error) {
      logger.warn(`[executeCallback] /me error: ${ error.message }`)
    }

    return {
      token: tokenResponse.access_token,
      expirationInSeconds: tokenResponse.expires_in,
      refreshToken: tokenResponse.refresh_token,
      connectionIdentityName,
      connectionIdentityImageURL: '',
      overwrite: true,
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
      const tokenResponse = await Flowrunner.Request.post(TOKEN_URL)
        .set({ 'Content-Type': 'application/json' })
        .send({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        })

      return {
        token: tokenResponse.access_token,
        expirationInSeconds: tokenResponse.expires_in,
        refreshToken: tokenResponse.refresh_token || refreshToken,
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
   * @typedef {Object} getCadencesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter the retrieved cadences by name. Filtering is applied locally to the current page."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Page number (as a string) from a previous response, used to retrieve the next page of cadences."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Cadences Dictionary
   * @description Lists the team's cadences for selection in dependent parameters. Returns the cadence name as the label and the cadence id as the value, with the cadence visibility (team, shared, or personal) as the note.
   * @route POST /get-cadences-dictionary
   * @paramDef {"type":"getCadencesDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Outbound SDR","value":"123","note":"Team cadence"}],"cursor":"2"}
   */
  async getCadencesDictionary(payload) {
    const { search, cursor } = payload || {}
    const page = cursor ? parseInt(cursor, 10) || 1 : 1

    const response = await this.#apiRequest({
      logTag: 'getCadencesDictionary',
      url: `${ API_BASE_URL }/cadences`,
      query: { page, per_page: DICTIONARY_PER_PAGE },
    })

    const cadences = Array.isArray(response?.data) ? response.data : []

    const filtered = search
      ? cadences.filter(cadence => cadence?.name && cadence.name.toLowerCase().includes(search.toLowerCase()))
      : cadences

    const nextPage = response?.metadata?.paging?.next_page

    return {
      cursor: nextPage ? String(nextPage) : undefined,
      items: filtered.map(cadence => ({
        label: cadence.name,
        value: String(cadence.id),
        note: cadence.team_cadence ? 'Team cadence' : (cadence.shared ? 'Shared cadence' : 'Personal cadence'),
      })),
    }
  }

  /**
   * @typedef {Object} getUsersDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter the retrieved users by name or email. Filtering is applied locally to the current page."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Page number (as a string) from a previous response, used to retrieve the next page of users."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Users Dictionary
   * @description Lists the team's Salesloft users for selection in user id parameters (owner, task assignee, cadence membership owner). Returns the user's name as the label and the numeric user id as the value, with the email address as the note.
   * @route POST /get-users-dictionary
   * @paramDef {"type":"getUsersDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Grace Hopper","value":"102","note":"grace@example.com"}],"cursor":"2"}
   */
  async getUsersDictionary(payload) {
    return this.#usersDictionary(payload, user => String(user.id), 'getUsersDictionary')
  }

  /**
   * @typedef {Object} getUserGuidsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter the retrieved users by name or email. Filtering is applied locally to the current page."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Page number (as a string) from a previous response, used to retrieve the next page of users."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get User GUIDs Dictionary
   * @description Lists the team's Salesloft users for selection in user guid parameters (owner and user_guid filters). Returns the user's name as the label and the user guid as the value, with the email address as the note.
   * @route POST /get-user-guids-dictionary
   * @paramDef {"type":"getUserGuidsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Grace Hopper","value":"a0f2e5c1-9b3d-4e6f-8a21-3c5d7e9f1b2d","note":"grace@example.com"}],"cursor":"2"}
   */
  async getUserGuidsDictionary(payload) {
    return this.#usersDictionary(payload, user => user.guid, 'getUserGuidsDictionary')
  }

  async #usersDictionary(payload, valueOf, logTag) {
    const { search, cursor } = payload || {}
    const page = cursor ? parseInt(cursor, 10) || 1 : 1

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/users`,
      query: { page, per_page: DICTIONARY_PER_PAGE },
    })

    const users = Array.isArray(response?.data) ? response.data : []

    const filtered = search
      ? users.filter(user => {
        const haystack = `${ user?.name || '' } ${ user?.email || '' }`.toLowerCase()

        return haystack.includes(search.toLowerCase())
      })
      : users

    const nextPage = response?.metadata?.paging?.next_page

    return {
      cursor: nextPage ? String(nextPage) : undefined,
      items: filtered.map(user => ({
        label: user.name || [user.first_name, user.last_name].filter(Boolean).join(' ') || user.email,
        value: valueOf(user),
        note: user.email || '',
      })),
    }
  }

  /**
   * @typedef {Object} getPersonStagesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter the retrieved person stages by name. Filtering is applied locally to the current page."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Page number (as a string) from a previous response, used to retrieve the next page of person stages."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Person Stages Dictionary
   * @description Lists the team's person stages for selection in dependent parameters. Returns the stage name as the label and the stage id as the value.
   * @route POST /get-person-stages-dictionary
   * @paramDef {"type":"getPersonStagesDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Prospect","value":"1","note":""}],"cursor":"2"}
   */
  async getPersonStagesDictionary(payload) {
    const { search, cursor } = payload || {}
    const page = cursor ? parseInt(cursor, 10) || 1 : 1

    const response = await this.#apiRequest({
      logTag: 'getPersonStagesDictionary',
      url: `${ API_BASE_URL }/person_stages`,
      query: { page, per_page: DICTIONARY_PER_PAGE },
    })

    const stages = Array.isArray(response?.data) ? response.data : []

    const filtered = search
      ? stages.filter(stage => stage?.name && stage.name.toLowerCase().includes(search.toLowerCase()))
      : stages

    const nextPage = response?.metadata?.paging?.next_page

    return {
      cursor: nextPage ? String(nextPage) : undefined,
      items: filtered.map(stage => ({
        label: stage.name,
        value: String(stage.id),
        note: '',
      })),
    }
  }

  /**
   * @typedef {Object} getAccountsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter the retrieved accounts by name or domain. Filtering is applied locally to the current page."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Page number (as a string) from a previous response, used to retrieve the next page of accounts."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Accounts Dictionary
   * @description Lists the team's accounts (companies) for selection in dependent parameters. Returns the account name as the label and the account id as the value, with the domain as the note.
   * @route POST /get-accounts-dictionary
   * @paramDef {"type":"getAccountsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Acme Corp","value":"5543","note":"acme.com"}],"cursor":"2"}
   */
  async getAccountsDictionary(payload) {
    const { search, cursor } = payload || {}
    const page = cursor ? parseInt(cursor, 10) || 1 : 1

    const response = await this.#apiRequest({
      logTag: 'getAccountsDictionary',
      url: `${ API_BASE_URL }/accounts`,
      query: { page, per_page: DICTIONARY_PER_PAGE },
    })

    const accounts = Array.isArray(response?.data) ? response.data : []

    const filtered = search
      ? accounts.filter(account => {
        const haystack = `${ account?.name || '' } ${ account?.domain || '' }`.toLowerCase()

        return haystack.includes(search.toLowerCase())
      })
      : accounts

    const nextPage = response?.metadata?.paging?.next_page

    return {
      cursor: nextPage ? String(nextPage) : undefined,
      items: filtered.map(account => ({
        label: account.name,
        value: String(account.id),
        note: account.domain || '',
      })),
    }
  }

  // ============================================= PEOPLE ==============================================

  /**
   * @description Retrieves a page of people (prospects and contacts) from Salesloft. Supports filtering by exact email address, last-updated timestamp, and owning user, plus page-based pagination (up to 100 per page) and sorting. Returns the people as items along with paging details (current page, next page, total pages, and total count).
   *
   * @route GET /list-people
   * @operationName List People
   * @category People
   *
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Filter people by an exact email address. Matches against primary and secondary email addresses."}
   * @paramDef {"type":"String","label":"Updated After","name":"updatedAfter","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Only return people updated after this ISO-8601 timestamp (applies the updated_at[gt] filter)."}
   * @paramDef {"type":"String","label":"Owner","name":"ownedByGuid","dictionary":"getUserGuidsDictionary","description":"Filter people by owning user. Select a user or enter a user guid."}
   * @paramDef {"type":"String","label":"Sort By","name":"sortBy","description":"Field to sort by, e.g. 'updated_at' or 'created_at'. Default: 'updated_at'."}
   * @paramDef {"type":"String","label":"Sort Direction","name":"sortDirection","uiComponent":{"type":"DROPDOWN","options":{"values":["Ascending","Descending"]}},"description":"Sort order for the results. Default: Descending."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve. Default: 1."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Results per page. Range: 1-100. Default: 25."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":38940,"first_name":"Ada","last_name":"Lovelace","email_address":"ada@example.com","title":"VP of Engineering","company_name":"Acme Corp","owner":{"id":102},"updated_at":"2026-02-01T09:30:00.000000-05:00"}],"currentPage":1,"perPage":25,"nextPage":2,"prevPage":null,"totalPages":4,"totalCount":92}
   */
  async listPeople(email, updatedAfter, ownedByGuid, sortBy, sortDirection, page, perPage) {
    const response = await this.#apiRequest({
      logTag: 'listPeople',
      url: `${ API_BASE_URL }/people`,
      query: this.#listQuery(page, perPage, {
        'email_addresses[]': email,
        'updated_at[gt]': updatedAfter,
        'owned_by_guid[]': ownedByGuid,
        sort_by: sortBy,
        sort_direction: this.#resolveChoice(sortDirection, SORT_DIRECTION_OPTIONS),
      }),
    })

    return this.#listResponse(response)
  }

  /**
   * @description Retrieves a single person by their Salesloft id, including contact details, company, owner, stage, tags, custom fields, and engagement counts.
   *
   * @route GET /get-person
   * @operationName Get Person
   * @category People
   *
   * @paramDef {"type":"String","label":"Person ID","name":"personId","required":true,"description":"The Salesloft id of the person to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":38940,"first_name":"Ada","last_name":"Lovelace","email_address":"ada@example.com","phone":"+14045551234","title":"VP of Engineering","company_name":"Acme Corp","person_stage":{"id":1},"owner":{"id":102},"tags":["vip"],"custom_fields":{"Region":"EMEA"},"counts":{"emails_sent":12,"calls":3}}
   */
  async getPerson(personId) {
    if (!personId) {
      throw new Error('"Person ID" is required')
    }

    const response = await this.#apiRequest({
      logTag: 'getPerson',
      url: `${ API_BASE_URL }/people/${ encodeURIComponent(personId) }`,
    })

    return response.data
  }

  /**
   * @description Creates a new person (prospect or contact) in Salesloft with contact details, company info, owner, stage, tags, and custom fields. Salesloft requires at least an email address, a phone number, or a last name to create a person. Returns the newly created person object including its id.
   *
   * @route POST /create-person
   * @operationName Create Person
   * @category People
   *
   * @paramDef {"type":"String","label":"Email Address","name":"emailAddress","description":"The person's primary email address."}
   * @paramDef {"type":"String","label":"First Name","name":"firstName","description":"The person's first name."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","description":"The person's last name."}
   * @paramDef {"type":"String","label":"Job Title","name":"title","description":"The person's job title."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"The person's primary phone number."}
   * @paramDef {"type":"String","label":"Mobile Phone","name":"mobilePhone","description":"The person's mobile phone number."}
   * @paramDef {"type":"String","label":"Company Name","name":"companyName","description":"The name of the company the person works for."}
   * @paramDef {"type":"String","label":"Account","name":"accountId","dictionary":"getAccountsDictionary","description":"The Salesloft account (company) to associate the person with. Select an account or enter an account id."}
   * @paramDef {"type":"String","label":"Owner","name":"ownerId","dictionary":"getUsersDictionary","description":"The Salesloft user who owns this person. Select a user or enter a user id."}
   * @paramDef {"type":"String","label":"Company Website","name":"personCompanyWebsite","description":"The website of the person's company (e.g. 'https://acme.com')."}
   * @paramDef {"type":"String","label":"Person Stage","name":"personStageId","dictionary":"getPersonStagesDictionary","description":"The person stage to place the person in. Select a stage or enter a stage id."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","description":"Tags to apply to the person. Accepts a list or a comma-separated string."}
   * @paramDef {"type":"Object","label":"Custom Fields","name":"customFields","description":"Custom field values as an object of field name to value, e.g. {\"Region\":\"EMEA\"}. Field names must match custom fields configured in Salesloft."}
   * @paramDef {"type":"Boolean","label":"Do Not Contact","name":"doNotContact","uiComponent":{"type":"CHECKBOX"},"description":"When true, marks the person as do-not-contact, which blocks communication from Salesloft."}
   * @paramDef {"type":"String","label":"Secondary Email Address","name":"secondaryEmailAddress","description":"An additional email address for the person."}
   *
   * @returns {Object}
   * @sampleResult {"id":38940,"first_name":"Ada","last_name":"Lovelace","email_address":"ada@example.com","title":"VP of Engineering","company_name":"Acme Corp","owner":{"id":102},"do_not_contact":false,"created_at":"2026-07-15T10:00:00.000000-04:00"}
   */
  async createPerson(
    emailAddress, firstName, lastName, title, phone, mobilePhone, companyName, accountId, ownerId,
    personCompanyWebsite, personStageId, tags, customFields, doNotContact, secondaryEmailAddress
  ) {
    if (!emailAddress && !phone && !lastName) {
      throw new Error('Provide at least an "Email Address", a "Phone", or a "Last Name" to create a person')
    }

    const body = this.#buildPersonBody({
      emailAddress, firstName, lastName, title, phone, mobilePhone, companyName, accountId, ownerId,
      personCompanyWebsite, personStageId, tags, customFields, doNotContact, secondaryEmailAddress,
    })

    const response = await this.#apiRequest({
      logTag: 'createPerson',
      method: 'post',
      url: `${ API_BASE_URL }/people`,
      body,
    })

    return response.data
  }

  /**
   * @description Updates an existing person in Salesloft. Only the provided fields are changed; omitted fields keep their current values. Returns the updated person object.
   *
   * @route PUT /update-person
   * @operationName Update Person
   * @category People
   *
   * @paramDef {"type":"String","label":"Person ID","name":"personId","required":true,"description":"The Salesloft id of the person to update."}
   * @paramDef {"type":"String","label":"Email Address","name":"emailAddress","description":"New primary email address."}
   * @paramDef {"type":"String","label":"First Name","name":"firstName","description":"New first name."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","description":"New last name."}
   * @paramDef {"type":"String","label":"Job Title","name":"title","description":"New job title."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"New primary phone number."}
   * @paramDef {"type":"String","label":"Mobile Phone","name":"mobilePhone","description":"New mobile phone number."}
   * @paramDef {"type":"String","label":"Company Name","name":"companyName","description":"New company name."}
   * @paramDef {"type":"String","label":"Account","name":"accountId","dictionary":"getAccountsDictionary","description":"The Salesloft account (company) to associate the person with. Select an account or enter an account id."}
   * @paramDef {"type":"String","label":"Owner","name":"ownerId","dictionary":"getUsersDictionary","description":"The Salesloft user who owns this person. Select a user or enter a user id."}
   * @paramDef {"type":"String","label":"Company Website","name":"personCompanyWebsite","description":"New company website (e.g. 'https://acme.com')."}
   * @paramDef {"type":"String","label":"Person Stage","name":"personStageId","dictionary":"getPersonStagesDictionary","description":"The person stage to move the person to. Select a stage or enter a stage id."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","description":"Tags to set on the person (replaces existing tags). Accepts a list or a comma-separated string."}
   * @paramDef {"type":"Object","label":"Custom Fields","name":"customFields","description":"Custom field values as an object of field name to value, e.g. {\"Region\":\"EMEA\"}."}
   * @paramDef {"type":"Boolean","label":"Do Not Contact","name":"doNotContact","uiComponent":{"type":"CHECKBOX"},"description":"When true, marks the person as do-not-contact, which blocks communication from Salesloft."}
   * @paramDef {"type":"String","label":"Secondary Email Address","name":"secondaryEmailAddress","description":"New secondary email address."}
   *
   * @returns {Object}
   * @sampleResult {"id":38940,"first_name":"Ada","last_name":"Lovelace","email_address":"ada@example.com","title":"CTO","company_name":"Acme Corp","updated_at":"2026-07-16T12:00:00.000000-04:00"}
   */
  async updatePerson(
    personId, emailAddress, firstName, lastName, title, phone, mobilePhone, companyName, accountId,
    ownerId, personCompanyWebsite, personStageId, tags, customFields, doNotContact, secondaryEmailAddress
  ) {
    if (!personId) {
      throw new Error('"Person ID" is required')
    }

    const body = this.#buildPersonBody({
      emailAddress, firstName, lastName, title, phone, mobilePhone, companyName, accountId, ownerId,
      personCompanyWebsite, personStageId, tags, customFields, doNotContact, secondaryEmailAddress,
    })

    if (!Object.keys(body).length) {
      throw new Error('At least one field to update is required')
    }

    const response = await this.#apiRequest({
      logTag: 'updatePerson',
      method: 'put',
      url: `${ API_BASE_URL }/people/${ encodeURIComponent(personId) }`,
      body,
    })

    return response.data
  }

  #buildPersonBody(fields) {
    const body = {}

    this.#set(body, 'email_address', fields.emailAddress)
    this.#set(body, 'first_name', fields.firstName)
    this.#set(body, 'last_name', fields.lastName)
    this.#set(body, 'title', fields.title)
    this.#set(body, 'phone', fields.phone)
    this.#set(body, 'mobile_phone', fields.mobilePhone)
    this.#set(body, 'company_name', fields.companyName)
    this.#set(body, 'account_id', this.#toId(fields.accountId))
    this.#set(body, 'owner_id', this.#toId(fields.ownerId))
    this.#set(body, 'person_company_website', fields.personCompanyWebsite)
    this.#set(body, 'person_stage_id', this.#toId(fields.personStageId))
    this.#set(body, 'tags', this.#toList(fields.tags))
    this.#set(body, 'custom_fields', this.#toObject(fields.customFields, 'Custom Fields'))
    this.#set(body, 'secondary_email_address', fields.secondaryEmailAddress)

    if (fields.doNotContact !== undefined && fields.doNotContact !== null) {
      body.do_not_contact = fields.doNotContact
    }

    return body
  }

  /**
   * @description Permanently deletes a person from Salesloft by their id. This action cannot be undone. Returns a success status (Salesloft returns no content).
   *
   * @route DELETE /delete-person
   * @operationName Delete Person
   * @category People
   *
   * @paramDef {"type":"String","label":"Person ID","name":"personId","required":true,"description":"The Salesloft id of the person to delete."}
   *
   * @returns {Object}
   * @sampleResult {"status":"success"}
   */
  async deletePerson(personId) {
    if (!personId) {
      throw new Error('"Person ID" is required')
    }

    return this.#apiRequest({
      logTag: 'deletePerson',
      method: 'delete',
      url: `${ API_BASE_URL }/people/${ encodeURIComponent(personId) }`,
    })
  }

  // ============================================ ACCOUNTS =============================================

  /**
   * @description Retrieves a page of accounts (companies) from Salesloft. Supports filtering by name, domain, and last-updated timestamp, plus page-based pagination (up to 100 per page). Returns the accounts as items along with paging details (current page, next page, total pages, and total count).
   *
   * @route GET /list-accounts
   * @operationName List Accounts
   * @category Accounts
   *
   * @paramDef {"type":"String","label":"Name","name":"name","description":"Filter accounts by company name."}
   * @paramDef {"type":"String","label":"Domain","name":"domain","description":"Filter accounts by website domain (e.g. 'acme.com')."}
   * @paramDef {"type":"String","label":"Updated After","name":"updatedAfter","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Only return accounts updated after this ISO-8601 timestamp (applies the updated_at[gt] filter)."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve. Default: 1."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Results per page. Range: 1-100. Default: 25."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":5543,"name":"Acme Corp","domain":"acme.com","industry":"Software","city":"Atlanta","state":"GA","owner":{"id":102},"updated_at":"2026-02-01T09:30:00.000000-05:00"}],"currentPage":1,"perPage":25,"nextPage":2,"prevPage":null,"totalPages":3,"totalCount":68}
   */
  async listAccounts(name, domain, updatedAfter, page, perPage) {
    const response = await this.#apiRequest({
      logTag: 'listAccounts',
      url: `${ API_BASE_URL }/accounts`,
      query: this.#listQuery(page, perPage, {
        name,
        domain,
        'updated_at[gt]': updatedAfter,
      }),
    })

    return this.#listResponse(response)
  }

  /**
   * @description Retrieves a single account (company) by its Salesloft id, including company details, location, owner, stage, tier, tags, and custom fields.
   *
   * @route GET /get-account
   * @operationName Get Account
   * @category Accounts
   *
   * @paramDef {"type":"String","label":"Account","name":"accountId","required":true,"dictionary":"getAccountsDictionary","description":"The Salesloft account to retrieve. Select an account or enter an account id."}
   *
   * @returns {Object}
   * @sampleResult {"id":5543,"name":"Acme Corp","domain":"acme.com","website":"https://acme.com","industry":"Software","description":"Enterprise widgets","city":"Atlanta","state":"GA","country":"US","company_stage":{"id":4},"account_tier":{"id":2},"owner":{"id":102},"tags":["strategic"],"custom_fields":{}}
   */
  async getAccount(accountId) {
    if (!accountId) {
      throw new Error('"Account" is required')
    }

    const response = await this.#apiRequest({
      logTag: 'getAccount',
      url: `${ API_BASE_URL }/accounts/${ encodeURIComponent(accountId) }`,
    })

    return response.data
  }

  /**
   * @description Creates a new account (company) in Salesloft with company details, location, owner, stage, tier, tags, and custom fields. Name and domain are required by Salesloft. Returns the newly created account object including its id.
   *
   * @route POST /create-account
   * @operationName Create Account
   * @category Accounts
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The company name."}
   * @paramDef {"type":"String","label":"Domain","name":"domain","required":true,"description":"The company's website domain (e.g. 'acme.com'). Salesloft requires a domain and enforces uniqueness per team."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"The company's phone number."}
   * @paramDef {"type":"String","label":"Website","name":"website","description":"The company's full website URL (e.g. 'https://acme.com')."}
   * @paramDef {"type":"String","label":"Industry","name":"industry","description":"The company's industry (e.g. 'Software')."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"A description of the company."}
   * @paramDef {"type":"String","label":"Country","name":"country","description":"The company's country."}
   * @paramDef {"type":"String","label":"State","name":"state","description":"The company's state or region."}
   * @paramDef {"type":"String","label":"City","name":"city","description":"The company's city."}
   * @paramDef {"type":"String","label":"Company Stage ID","name":"companyStageId","description":"The id of the account (company) stage to place the account in. Use 'List Account Stages' to find stage ids."}
   * @paramDef {"type":"String","label":"Account Tier ID","name":"accountTierId","description":"The id of the account tier to assign. Use 'List Account Tiers' to find tier ids."}
   * @paramDef {"type":"String","label":"Owner","name":"ownerId","dictionary":"getUsersDictionary","description":"The Salesloft user who owns this account. Select a user or enter a user id."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","description":"Tags to apply to the account. Accepts a list or a comma-separated string."}
   * @paramDef {"type":"Object","label":"Custom Fields","name":"customFields","description":"Custom field values as an object of field name to value, e.g. {\"Segment\":\"Enterprise\"}."}
   *
   * @returns {Object}
   * @sampleResult {"id":5543,"name":"Acme Corp","domain":"acme.com","website":"https://acme.com","industry":"Software","city":"Atlanta","owner":{"id":102},"created_at":"2026-07-15T10:00:00.000000-04:00"}
   */
  async createAccount(
    name, domain, phone, website, industry, description, country, state, city,
    companyStageId, accountTierId, ownerId, tags, customFields
  ) {
    if (!name) {
      throw new Error('"Name" is required')
    }

    if (!domain) {
      throw new Error('"Domain" is required')
    }

    const body = this.#buildAccountBody({
      name, domain, phone, website, industry, description, country, state, city,
      companyStageId, accountTierId, ownerId, tags, customFields,
    })

    const response = await this.#apiRequest({
      logTag: 'createAccount',
      method: 'post',
      url: `${ API_BASE_URL }/accounts`,
      body,
    })

    return response.data
  }

  /**
   * @description Updates an existing account (company) in Salesloft. Only the provided fields are changed; omitted fields keep their current values. Returns the updated account object.
   *
   * @route PUT /update-account
   * @operationName Update Account
   * @category Accounts
   *
   * @paramDef {"type":"String","label":"Account","name":"accountId","required":true,"dictionary":"getAccountsDictionary","description":"The Salesloft account to update. Select an account or enter an account id."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"New company name."}
   * @paramDef {"type":"String","label":"Domain","name":"domain","description":"New website domain (e.g. 'acme.com')."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"New phone number."}
   * @paramDef {"type":"String","label":"Website","name":"website","description":"New full website URL."}
   * @paramDef {"type":"String","label":"Industry","name":"industry","description":"New industry."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New company description."}
   * @paramDef {"type":"String","label":"Country","name":"country","description":"New country."}
   * @paramDef {"type":"String","label":"State","name":"state","description":"New state or region."}
   * @paramDef {"type":"String","label":"City","name":"city","description":"New city."}
   * @paramDef {"type":"String","label":"Company Stage ID","name":"companyStageId","description":"The id of the account (company) stage to move the account to. Use 'List Account Stages' to find stage ids."}
   * @paramDef {"type":"String","label":"Account Tier ID","name":"accountTierId","description":"The id of the account tier to assign. Use 'List Account Tiers' to find tier ids."}
   * @paramDef {"type":"String","label":"Owner","name":"ownerId","dictionary":"getUsersDictionary","description":"The Salesloft user who owns this account. Select a user or enter a user id."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","description":"Tags to set on the account (replaces existing tags). Accepts a list or a comma-separated string."}
   * @paramDef {"type":"Object","label":"Custom Fields","name":"customFields","description":"Custom field values as an object of field name to value."}
   *
   * @returns {Object}
   * @sampleResult {"id":5543,"name":"Acme Corporation","domain":"acme.com","industry":"Manufacturing","updated_at":"2026-07-16T12:00:00.000000-04:00"}
   */
  async updateAccount(
    accountId, name, domain, phone, website, industry, description, country, state, city,
    companyStageId, accountTierId, ownerId, tags, customFields
  ) {
    if (!accountId) {
      throw new Error('"Account" is required')
    }

    const body = this.#buildAccountBody({
      name, domain, phone, website, industry, description, country, state, city,
      companyStageId, accountTierId, ownerId, tags, customFields,
    })

    if (!Object.keys(body).length) {
      throw new Error('At least one field to update is required')
    }

    const response = await this.#apiRequest({
      logTag: 'updateAccount',
      method: 'put',
      url: `${ API_BASE_URL }/accounts/${ encodeURIComponent(accountId) }`,
      body,
    })

    return response.data
  }

  #buildAccountBody(fields) {
    const body = {}

    this.#set(body, 'name', fields.name)
    this.#set(body, 'domain', fields.domain)
    this.#set(body, 'phone', fields.phone)
    this.#set(body, 'website', fields.website)
    this.#set(body, 'industry', fields.industry)
    this.#set(body, 'description', fields.description)
    this.#set(body, 'country', fields.country)
    this.#set(body, 'state', fields.state)
    this.#set(body, 'city', fields.city)
    this.#set(body, 'company_stage_id', this.#toId(fields.companyStageId))
    this.#set(body, 'account_tier_id', this.#toId(fields.accountTierId))
    this.#set(body, 'owner_id', this.#toId(fields.ownerId))
    this.#set(body, 'tags', this.#toList(fields.tags))
    this.#set(body, 'custom_fields', this.#toObject(fields.customFields, 'Custom Fields'))

    return body
  }

  /**
   * @description Permanently deletes an account (company) from Salesloft by its id. This action cannot be undone. Returns a success status (Salesloft returns no content).
   *
   * @route DELETE /delete-account
   * @operationName Delete Account
   * @category Accounts
   *
   * @paramDef {"type":"String","label":"Account","name":"accountId","required":true,"dictionary":"getAccountsDictionary","description":"The Salesloft account to delete. Select an account or enter an account id."}
   *
   * @returns {Object}
   * @sampleResult {"status":"success"}
   */
  async deleteAccount(accountId) {
    if (!accountId) {
      throw new Error('"Account" is required')
    }

    return this.#apiRequest({
      logTag: 'deleteAccount',
      method: 'delete',
      url: `${ API_BASE_URL }/accounts/${ encodeURIComponent(accountId) }`,
    })
  }

  // ============================================ CADENCES =============================================

  /**
   * @description Retrieves a page of cadences (structured sequences of calls, emails, and other steps). Supports filtering by team cadences and shared cadences, plus page-based pagination (up to 100 per page). Returns the cadences as items along with paging details.
   *
   * @route GET /list-cadences
   * @operationName List Cadences
   * @category Cadences
   *
   * @paramDef {"type":"Boolean","label":"Team Cadences Only","name":"teamCadence","uiComponent":{"type":"CHECKBOX"},"description":"When true, only team cadences are returned; when false, only non-team cadences. Leave unset to return both."}
   * @paramDef {"type":"Boolean","label":"Shared Cadences Only","name":"shared","uiComponent":{"type":"CHECKBOX"},"description":"When true, only shared cadences are returned; when false, only private cadences. Leave unset to return both."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve. Default: 1."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Results per page. Range: 1-100. Default: 25."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":123,"name":"Outbound SDR","team_cadence":false,"shared":true,"current_state":"active","cadence_function":"outbound","counts":{"cadence_people":42}}],"currentPage":1,"perPage":25,"nextPage":null,"prevPage":null,"totalPages":1,"totalCount":8}
   */
  async listCadences(teamCadence, shared, page, perPage) {
    const query = this.#listQuery(page, perPage)

    if (teamCadence !== undefined && teamCadence !== null) {
      query.team_cadence = teamCadence
    }

    if (shared !== undefined && shared !== null) {
      query.shared = shared
    }

    const response = await this.#apiRequest({
      logTag: 'listCadences',
      url: `${ API_BASE_URL }/cadences`,
      query,
    })

    return this.#listResponse(response)
  }

  /**
   * @description Retrieves a single cadence by its Salesloft id, including its name, state, sharing settings, cadence function, and people counts.
   *
   * @route GET /get-cadence
   * @operationName Get Cadence
   * @category Cadences
   *
   * @paramDef {"type":"String","label":"Cadence","name":"cadenceId","required":true,"dictionary":"getCadencesDictionary","description":"The cadence to retrieve. Select a cadence or enter a cadence id."}
   *
   * @returns {Object}
   * @sampleResult {"id":123,"name":"Outbound SDR","team_cadence":false,"shared":true,"current_state":"active","cadence_function":"outbound","creator":{"id":102},"counts":{"cadence_people":42,"meetings_booked":5}}
   */
  async getCadence(cadenceId) {
    if (!cadenceId) {
      throw new Error('"Cadence" is required')
    }

    const response = await this.#apiRequest({
      logTag: 'getCadence',
      url: `${ API_BASE_URL }/cadences/${ encodeURIComponent(cadenceId) }`,
    })

    return response.data
  }

  /**
   * @description Adds a person to a cadence by creating a cadence membership, which enrolls them in the cadence's sequence of steps. Optionally assigns the membership to a specific user (otherwise cadence rules determine the assignee). Returns the created cadence membership object.
   *
   * @route POST /add-person-to-cadence
   * @operationName Add Person to Cadence
   * @category Cadences
   *
   * @paramDef {"type":"String","label":"Cadence","name":"cadenceId","required":true,"dictionary":"getCadencesDictionary","description":"The cadence to add the person to. Select a cadence or enter a cadence id."}
   * @paramDef {"type":"String","label":"Person ID","name":"personId","required":true,"description":"The Salesloft id of the person to enroll in the cadence."}
   * @paramDef {"type":"String","label":"User","name":"userId","dictionary":"getUsersDictionary","description":"The Salesloft user who will run the cadence steps for this person. When omitted, cadence membership rules determine the user."}
   *
   * @returns {Object}
   * @sampleResult {"id":9182,"added_at":"2026-07-16T12:00:00.000000-04:00","currently_on_cadence":true,"current_state":"processing","cadence":{"id":123},"person":{"id":38940},"user":{"id":102}}
   */
  async addPersonToCadence(cadenceId, personId, userId) {
    if (!cadenceId) {
      throw new Error('"Cadence" is required')
    }

    if (!personId) {
      throw new Error('"Person ID" is required')
    }

    const body = {
      cadence_id: this.#toId(cadenceId),
      person_id: this.#toId(personId),
    }

    this.#set(body, 'user_id', this.#toId(userId))

    const response = await this.#apiRequest({
      logTag: 'addPersonToCadence',
      method: 'post',
      url: `${ API_BASE_URL }/cadence_memberships`,
      body,
    })

    return response.data
  }

  /**
   * @description Retrieves a page of cadence memberships (person-to-cadence enrollments). Filter by person to see all cadences a person is on, or by cadence to see everyone enrolled in it. Returns the memberships as items along with paging details.
   *
   * @route GET /list-cadence-memberships
   * @operationName List Cadence Memberships
   * @category Cadences
   *
   * @paramDef {"type":"String","label":"Person ID","name":"personId","description":"Filter memberships by the Salesloft id of a person."}
   * @paramDef {"type":"String","label":"Cadence","name":"cadenceId","dictionary":"getCadencesDictionary","description":"Filter memberships by cadence. Select a cadence or enter a cadence id."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve. Default: 1."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Results per page. Range: 1-100. Default: 25."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":9182,"added_at":"2026-07-16T12:00:00.000000-04:00","currently_on_cadence":true,"current_state":"processing","cadence":{"id":123},"person":{"id":38940},"user":{"id":102}}],"currentPage":1,"perPage":25,"nextPage":null,"prevPage":null,"totalPages":1,"totalCount":1}
   */
  async listCadenceMemberships(personId, cadenceId, page, perPage) {
    const response = await this.#apiRequest({
      logTag: 'listCadenceMemberships',
      url: `${ API_BASE_URL }/cadence_memberships`,
      query: this.#listQuery(page, perPage, {
        person_id: personId,
        cadence_id: cadenceId,
      }),
    })

    return this.#listResponse(response)
  }

  /**
   * @description Retrieves a single cadence membership by its id, including the person, cadence, assigned user, enrollment state, and step counts.
   *
   * @route GET /get-cadence-membership
   * @operationName Get Cadence Membership
   * @category Cadences
   *
   * @paramDef {"type":"String","label":"Membership ID","name":"membershipId","required":true,"description":"The Salesloft id of the cadence membership to retrieve. Use 'List Cadence Memberships' to find membership ids."}
   *
   * @returns {Object}
   * @sampleResult {"id":9182,"added_at":"2026-07-16T12:00:00.000000-04:00","currently_on_cadence":true,"current_state":"processing","cadence":{"id":123},"person":{"id":38940},"user":{"id":102},"counts":{"views":2,"clicks":1,"replies":0,"calls":1}}
   */
  async getCadenceMembership(membershipId) {
    if (!membershipId) {
      throw new Error('"Membership ID" is required')
    }

    const response = await this.#apiRequest({
      logTag: 'getCadenceMembership',
      url: `${ API_BASE_URL }/cadence_memberships/${ encodeURIComponent(membershipId) }`,
    })

    return response.data
  }

  /**
   * @description Removes a person from a cadence by deleting their cadence membership. The person is taken off the cadence and no further steps run for them. Use 'List Cadence Memberships' with person and cadence filters to find the membership id. Returns a success status (Salesloft returns no content).
   *
   * @route DELETE /remove-person-from-cadence
   * @operationName Remove Person from Cadence
   * @category Cadences
   *
   * @paramDef {"type":"String","label":"Membership ID","name":"membershipId","required":true,"description":"The Salesloft id of the cadence membership to delete. Use 'List Cadence Memberships' to find membership ids."}
   *
   * @returns {Object}
   * @sampleResult {"status":"success"}
   */
  async removePersonFromCadence(membershipId) {
    if (!membershipId) {
      throw new Error('"Membership ID" is required')
    }

    return this.#apiRequest({
      logTag: 'removePersonFromCadence',
      method: 'delete',
      url: `${ API_BASE_URL }/cadence_memberships/${ encodeURIComponent(membershipId) }`,
    })
  }

  // ============================================== TASKS ==============================================

  /**
   * @description Retrieves a page of tasks (to-dos such as calls, emails, and general reminders). Supports filtering by assigned user, person, task type, and state, plus page-based pagination (up to 100 per page). Returns the tasks as items along with paging details.
   *
   * @route GET /list-tasks
   * @operationName List Tasks
   * @category Tasks
   *
   * @paramDef {"type":"String","label":"User","name":"userGuid","dictionary":"getUserGuidsDictionary","description":"Filter tasks by the assigned user. Select a user or enter a user guid."}
   * @paramDef {"type":"String","label":"Person ID","name":"personId","description":"Filter tasks by the Salesloft id of the associated person."}
   * @paramDef {"type":"String","label":"Task Type","name":"taskType","uiComponent":{"type":"DROPDOWN","options":{"values":["Call","Email","General"]}},"description":"Filter tasks by type."}
   * @paramDef {"type":"String","label":"State","name":"currentState","uiComponent":{"type":"DROPDOWN","options":{"values":["Scheduled","Completed"]}},"description":"Filter tasks by their current state."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve. Default: 1."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Results per page. Range: 1-100. Default: 25."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":85,"subject":"Follow up on pricing","due_date":"2026-08-01","task_type":"call","current_state":"scheduled","person":{"id":38940},"user":{"id":102}}],"currentPage":1,"perPage":25,"nextPage":null,"prevPage":null,"totalPages":1,"totalCount":6}
   */
  async listTasks(userGuid, personId, taskType, currentState, page, perPage) {
    const response = await this.#apiRequest({
      logTag: 'listTasks',
      url: `${ API_BASE_URL }/tasks`,
      query: this.#listQuery(page, perPage, {
        'user_guid[]': userGuid,
        'person_id[]': personId,
        task_type: this.#resolveChoice(taskType, TASK_TYPE_OPTIONS),
        current_state: this.#resolveChoice(currentState, TASK_STATE_OPTIONS),
      }),
    })

    return this.#listResponse(response)
  }

  /**
   * @description Retrieves a single task by its Salesloft id, including its subject, type, due date, state, description, associated person, and assigned user.
   *
   * @route GET /get-task
   * @operationName Get Task
   * @category Tasks
   *
   * @paramDef {"type":"String","label":"Task ID","name":"taskId","required":true,"description":"The Salesloft id of the task to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":85,"subject":"Follow up on pricing","due_date":"2026-08-01","due_at":null,"task_type":"call","current_state":"scheduled","description":"Discuss the enterprise tier","person":{"id":38940},"user":{"id":102},"completed_at":null}
   */
  async getTask(taskId) {
    if (!taskId) {
      throw new Error('"Task ID" is required')
    }

    const response = await this.#apiRequest({
      logTag: 'getTask',
      url: `${ API_BASE_URL }/tasks/${ encodeURIComponent(taskId) }`,
    })

    return response.data
  }

  /**
   * @description Creates a new scheduled task (call, email, or general to-do) for a person, assigned to a user with a due date. The task is created in the 'scheduled' state and appears on the assigned user's task list in Salesloft. Returns the newly created task object.
   *
   * @route POST /create-task
   * @operationName Create Task
   * @category Tasks
   *
   * @paramDef {"type":"String","label":"Subject","name":"subject","required":true,"description":"The subject line of the task shown in the user's task list."}
   * @paramDef {"type":"String","label":"Person ID","name":"personId","required":true,"description":"The Salesloft id of the person the task is about."}
   * @paramDef {"type":"String","label":"Assignee","name":"userId","required":true,"dictionary":"getUsersDictionary","description":"The Salesloft user the task is assigned to. Select a user or enter a user id."}
   * @paramDef {"type":"String","label":"Task Type","name":"taskType","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Call","Email","General"]}},"description":"The type of task to create."}
   * @paramDef {"type":"String","label":"Due Date","name":"dueDate","required":true,"uiComponent":{"type":"DATE_PICKER"},"description":"The date the task is due (ISO-8601 date, e.g. '2026-08-01')."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional details describing what the task involves."}
   * @paramDef {"type":"String","label":"Remind At","name":"remindAt","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Optional ISO-8601 timestamp at which to remind the assignee about the task."}
   *
   * @returns {Object}
   * @sampleResult {"id":85,"subject":"Follow up on pricing","due_date":"2026-08-01","task_type":"call","current_state":"scheduled","person":{"id":38940},"user":{"id":102},"created_at":"2026-07-16T12:00:00.000000-04:00"}
   */
  async createTask(subject, personId, userId, taskType, dueDate, description, remindAt) {
    if (!subject) {
      throw new Error('"Subject" is required')
    }

    if (!personId) {
      throw new Error('"Person ID" is required')
    }

    if (!userId) {
      throw new Error('"Assignee" is required')
    }

    if (!taskType) {
      throw new Error('"Task Type" is required')
    }

    if (!dueDate) {
      throw new Error('"Due Date" is required')
    }

    const body = {
      subject,
      person_id: this.#toId(personId),
      user_id: this.#toId(userId),
      task_type: this.#resolveChoice(taskType, TASK_TYPE_OPTIONS),
      due_date: dueDate,
      current_state: 'scheduled',
    }

    this.#set(body, 'description', description)
    this.#set(body, 'remind_at', remindAt)

    const response = await this.#apiRequest({
      logTag: 'createTask',
      method: 'post',
      url: `${ API_BASE_URL }/tasks`,
      body,
    })

    return response.data
  }

  /**
   * @description Updates an existing task's subject, due date, assignee, or description, or completes it by setting the state to Completed. Only the provided fields are changed. Note: Salesloft only allows 'general' tasks to be completed through the API; call and email tasks are completed by logging the call or sending the email. Returns the updated task object.
   *
   * @route PUT /update-task
   * @operationName Update Task
   * @category Tasks
   *
   * @paramDef {"type":"String","label":"Task ID","name":"taskId","required":true,"description":"The Salesloft id of the task to update."}
   * @paramDef {"type":"String","label":"Subject","name":"subject","description":"New subject line for the task."}
   * @paramDef {"type":"String","label":"Due Date","name":"dueDate","uiComponent":{"type":"DATE_PICKER"},"description":"New due date (ISO-8601 date, e.g. '2026-08-01')."}
   * @paramDef {"type":"String","label":"Assignee","name":"userId","dictionary":"getUsersDictionary","description":"The Salesloft user to reassign the task to. Select a user or enter a user id."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New task description."}
   * @paramDef {"type":"String","label":"State","name":"currentState","uiComponent":{"type":"DROPDOWN","options":{"values":["Completed"]}},"description":"Set to 'Completed' to complete the task. Only general-type tasks can be completed via the API."}
   *
   * @returns {Object}
   * @sampleResult {"id":85,"subject":"Follow up on pricing - updated","due_date":"2026-08-05","task_type":"general","current_state":"scheduled","person":{"id":38940},"user":{"id":102},"updated_at":"2026-07-16T12:00:00.000000-04:00"}
   */
  async updateTask(taskId, subject, dueDate, userId, description, currentState) {
    if (!taskId) {
      throw new Error('"Task ID" is required')
    }

    const body = {}

    this.#set(body, 'subject', subject)
    this.#set(body, 'due_date', dueDate)
    this.#set(body, 'user_id', this.#toId(userId))
    this.#set(body, 'description', description)
    this.#set(body, 'current_state', this.#resolveChoice(currentState, TASK_STATE_OPTIONS))

    if (!Object.keys(body).length) {
      throw new Error('At least one field to update is required')
    }

    const response = await this.#apiRequest({
      logTag: 'updateTask',
      method: 'put',
      url: `${ API_BASE_URL }/tasks/${ encodeURIComponent(taskId) }`,
      body,
    })

    return response.data
  }

  /**
   * @description Marks a task as completed by updating its state to 'completed'. Note: Salesloft only allows 'general' tasks to be completed through the API; call and email tasks are completed by logging the call ('Log a Call') or sending the email in Salesloft. Returns the updated task object.
   *
   * @route PUT /complete-task
   * @operationName Complete Task
   * @category Tasks
   *
   * @paramDef {"type":"String","label":"Task ID","name":"taskId","required":true,"description":"The Salesloft id of the task to complete."}
   *
   * @returns {Object}
   * @sampleResult {"id":85,"subject":"Follow up on pricing","task_type":"general","current_state":"completed","completed_at":"2026-07-16T12:00:00.000000-04:00","person":{"id":38940},"user":{"id":102}}
   */
  async completeTask(taskId) {
    if (!taskId) {
      throw new Error('"Task ID" is required')
    }

    const response = await this.#apiRequest({
      logTag: 'completeTask',
      method: 'put',
      url: `${ API_BASE_URL }/tasks/${ encodeURIComponent(taskId) }`,
      body: { current_state: 'completed' },
    })

    return response.data
  }

  /**
   * @description Permanently deletes a task from Salesloft by its id. This action cannot be undone. Returns a success status (Salesloft returns no content).
   *
   * @route DELETE /delete-task
   * @operationName Delete Task
   * @category Tasks
   *
   * @paramDef {"type":"String","label":"Task ID","name":"taskId","required":true,"description":"The Salesloft id of the task to delete."}
   *
   * @returns {Object}
   * @sampleResult {"status":"success"}
   */
  async deleteTask(taskId) {
    if (!taskId) {
      throw new Error('"Task ID" is required')
    }

    return this.#apiRequest({
      logTag: 'deleteTask',
      method: 'delete',
      url: `${ API_BASE_URL }/tasks/${ encodeURIComponent(taskId) }`,
    })
  }

  // ============================================== NOTES ==============================================

  /**
   * @description Retrieves a page of notes. Filter by the person or account the notes are attached to (both the association type and id must be provided together), plus page-based pagination (up to 100 per page). Returns the notes as items along with paging details.
   *
   * @route GET /list-notes
   * @operationName List Notes
   * @category Notes
   *
   * @paramDef {"type":"String","label":"Associated With Type","name":"associatedWithType","uiComponent":{"type":"DROPDOWN","options":{"values":["Person","Account"]}},"description":"The type of record the notes are attached to. Must be provided together with 'Associated With ID'."}
   * @paramDef {"type":"String","label":"Associated With ID","name":"associatedWithId","description":"The Salesloft id of the person or account the notes are attached to. Must be provided together with 'Associated With Type'."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve. Default: 1."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Results per page. Range: 1-100. Default: 25."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":541,"content":"Spoke with Ada about renewal timing.","associated_type":"person","associated_with":38940,"user":{"id":102},"created_at":"2026-07-15T10:00:00.000000-04:00"}],"currentPage":1,"perPage":25,"nextPage":null,"prevPage":null,"totalPages":1,"totalCount":3}
   */
  async listNotes(associatedWithType, associatedWithId, page, perPage) {
    if ((associatedWithType && !associatedWithId) || (!associatedWithType && associatedWithId)) {
      throw new Error('"Associated With Type" and "Associated With ID" must be provided together')
    }

    const response = await this.#apiRequest({
      logTag: 'listNotes',
      url: `${ API_BASE_URL }/notes`,
      query: this.#listQuery(page, perPage, {
        associated_with_type: this.#resolveChoice(associatedWithType, NOTE_ASSOCIATION_OPTIONS),
        associated_with_id: associatedWithId,
      }),
    })

    return this.#listResponse(response)
  }

  /**
   * @description Retrieves a single note by its Salesloft id, including its content, the record it is attached to, and the authoring user.
   *
   * @route GET /get-note
   * @operationName Get Note
   * @category Notes
   *
   * @paramDef {"type":"String","label":"Note ID","name":"noteId","required":true,"description":"The Salesloft id of the note to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":541,"content":"Spoke with Ada about renewal timing.","associated_type":"person","associated_with":38940,"user":{"id":102},"created_at":"2026-07-15T10:00:00.000000-04:00"}
   */
  async getNote(noteId) {
    if (!noteId) {
      throw new Error('"Note ID" is required')
    }

    const response = await this.#apiRequest({
      logTag: 'getNote',
      url: `${ API_BASE_URL }/notes/${ encodeURIComponent(noteId) }`,
    })

    return response.data
  }

  /**
   * @description Creates a note attached to a person or an account. The note appears on the record's activity feed in Salesloft. Returns the newly created note object.
   *
   * @route POST /create-note
   * @operationName Create Note
   * @category Notes
   *
   * @paramDef {"type":"String","label":"Content","name":"content","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The text content of the note."}
   * @paramDef {"type":"String","label":"Associated With Type","name":"associatedWithType","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Person","Account"]}},"description":"The type of record to attach the note to."}
   * @paramDef {"type":"String","label":"Associated With ID","name":"associatedWithId","required":true,"description":"The Salesloft id of the person or account to attach the note to."}
   *
   * @returns {Object}
   * @sampleResult {"id":541,"content":"Spoke with Ada about renewal timing.","associated_type":"person","associated_with":38940,"user":{"id":102},"created_at":"2026-07-16T12:00:00.000000-04:00"}
   */
  async createNote(content, associatedWithType, associatedWithId) {
    if (!content) {
      throw new Error('"Content" is required')
    }

    if (!associatedWithType) {
      throw new Error('"Associated With Type" is required')
    }

    if (!associatedWithId) {
      throw new Error('"Associated With ID" is required')
    }

    const response = await this.#apiRequest({
      logTag: 'createNote',
      method: 'post',
      url: `${ API_BASE_URL }/notes`,
      body: {
        content,
        associated_with_type: this.#resolveChoice(associatedWithType, NOTE_ASSOCIATION_OPTIONS),
        associated_with_id: this.#toId(associatedWithId),
      },
    })

    return response.data
  }

  /**
   * @description Updates the content of an existing note. Returns the updated note object.
   *
   * @route PUT /update-note
   * @operationName Update Note
   * @category Notes
   *
   * @paramDef {"type":"String","label":"Note ID","name":"noteId","required":true,"description":"The Salesloft id of the note to update."}
   * @paramDef {"type":"String","label":"Content","name":"content","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The new text content of the note."}
   *
   * @returns {Object}
   * @sampleResult {"id":541,"content":"Updated: renewal confirmed for Q4.","associated_type":"person","associated_with":38940,"updated_at":"2026-07-16T12:00:00.000000-04:00"}
   */
  async updateNote(noteId, content) {
    if (!noteId) {
      throw new Error('"Note ID" is required')
    }

    if (!content) {
      throw new Error('"Content" is required')
    }

    const response = await this.#apiRequest({
      logTag: 'updateNote',
      method: 'put',
      url: `${ API_BASE_URL }/notes/${ encodeURIComponent(noteId) }`,
      body: { content },
    })

    return response.data
  }

  /**
   * @description Permanently deletes a note from Salesloft by its id. This action cannot be undone. Returns a success status (Salesloft returns no content).
   *
   * @route DELETE /delete-note
   * @operationName Delete Note
   * @category Notes
   *
   * @paramDef {"type":"String","label":"Note ID","name":"noteId","required":true,"description":"The Salesloft id of the note to delete."}
   *
   * @returns {Object}
   * @sampleResult {"status":"success"}
   */
  async deleteNote(noteId) {
    if (!noteId) {
      throw new Error('"Note ID" is required')
    }

    return this.#apiRequest({
      logTag: 'deleteNote',
      method: 'delete',
      url: `${ API_BASE_URL }/notes/${ encodeURIComponent(noteId) }`,
    })
  }

  // ============================================ ACTIVITIES ===========================================

  /**
   * @description Logs a completed call activity against a person, recording the call's sentiment, disposition, notes, and duration. Logging a call also completes any outstanding call step for the person in an active cadence. Sentiment and disposition values must match the options configured in your Salesloft team settings. Returns the created call activity object.
   *
   * @route POST /log-call
   * @operationName Log a Call
   * @category Activities
   *
   * @paramDef {"type":"String","label":"Person ID","name":"personId","required":true,"description":"The Salesloft id of the person the call was with."}
   * @paramDef {"type":"String","label":"Sentiment","name":"sentiment","description":"The call sentiment, e.g. 'Demo Scheduled'. Must exactly match a sentiment configured in your Salesloft team settings."}
   * @paramDef {"type":"String","label":"Disposition","name":"disposition","description":"The call disposition, e.g. 'Connected' or 'No Answer'. Must exactly match a disposition configured in your Salesloft team settings."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Free-form notes about the call."}
   * @paramDef {"type":"Number","label":"Duration","name":"duration","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The length of the call in seconds."}
   * @paramDef {"type":"String","label":"User","name":"userGuid","dictionary":"getUserGuidsDictionary","description":"The Salesloft user to log the call on behalf of. Defaults to the connected user. Select a user or enter a user guid."}
   *
   * @returns {Object}
   * @sampleResult {"id":9401,"duration":90,"sentiment":"Demo Scheduled","disposition":"Connected","person":{"id":38940},"user":{"id":102},"created_at":"2026-07-16T12:00:00.000000-04:00"}
   */
  async logCall(personId, sentiment, disposition, notes, duration, userGuid) {
    if (!personId) {
      throw new Error('"Person ID" is required')
    }

    const body = { person_id: this.#toId(personId) }

    this.#set(body, 'sentiment', sentiment)
    this.#set(body, 'disposition', disposition)
    this.#set(body, 'notes', notes)
    this.#set(body, 'duration', duration)
    this.#set(body, 'user_guid', userGuid)

    const response = await this.#apiRequest({
      logTag: 'logCall',
      method: 'post',
      url: `${ API_BASE_URL }/activities/calls`,
      body,
    })

    return response.data
  }

  /**
   * @description Retrieves a page of logged call activities. Supports filtering by person, user, and last-updated timestamp, plus page-based pagination (up to 100 per page). Returns the calls as items along with paging details.
   *
   * @route GET /list-calls
   * @operationName List Calls
   * @category Activities
   *
   * @paramDef {"type":"String","label":"Person ID","name":"personId","description":"Filter calls by the Salesloft id of the person the call was with."}
   * @paramDef {"type":"String","label":"User","name":"userGuid","dictionary":"getUserGuidsDictionary","description":"Filter calls by the user who made them. Select a user or enter a user guid."}
   * @paramDef {"type":"String","label":"Updated After","name":"updatedAfter","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Only return calls updated after this ISO-8601 timestamp (applies the updated_at[gt] filter)."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve. Default: 1."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Results per page. Range: 1-100. Default: 25."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":9401,"duration":90,"sentiment":"Demo Scheduled","disposition":"Connected","person":{"id":38940},"user":{"id":102},"created_at":"2026-07-16T12:00:00.000000-04:00"}],"currentPage":1,"perPage":25,"nextPage":null,"prevPage":null,"totalPages":1,"totalCount":4}
   */
  async listCalls(personId, userGuid, updatedAfter, page, perPage) {
    const response = await this.#apiRequest({
      logTag: 'listCalls',
      url: `${ API_BASE_URL }/activities/calls`,
      query: this.#listQuery(page, perPage, {
        'person_id[]': personId,
        'user_guid[]': userGuid,
        'updated_at[gt]': updatedAfter,
      }),
    })

    return this.#listResponse(response)
  }

  /**
   * @description Retrieves a single logged call activity by its Salesloft id, including duration, sentiment, disposition, notes, and the associated person and user.
   *
   * @route GET /get-call
   * @operationName Get Call
   * @category Activities
   *
   * @paramDef {"type":"String","label":"Call ID","name":"callId","required":true,"description":"The Salesloft id of the call activity to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":9401,"to":"7705551234","duration":90,"sentiment":"Demo Scheduled","disposition":"Connected","person":{"id":38940},"user":{"id":102},"crm_activity":{"id":88},"created_at":"2026-07-16T12:00:00.000000-04:00"}
   */
  async getCall(callId) {
    if (!callId) {
      throw new Error('"Call ID" is required')
    }

    const response = await this.#apiRequest({
      logTag: 'getCall',
      url: `${ API_BASE_URL }/activities/calls/${ encodeURIComponent(callId) }`,
    })

    return response.data
  }

  /**
   * @description Retrieves a page of email activities sent through Salesloft. Supports filtering by person, bounce status, scheduled-send time, and last-updated timestamp, plus page-based pagination (up to 100 per page). Returns the emails as items along with paging details.
   *
   * @route GET /list-emails
   * @operationName List Emails
   * @category Activities
   *
   * @paramDef {"type":"String","label":"Person ID","name":"personId","description":"Filter emails by the Salesloft id of the recipient person."}
   * @paramDef {"type":"Boolean","label":"Bounced Only","name":"bounced","uiComponent":{"type":"CHECKBOX"},"description":"When true, only bounced emails are returned; when false, only non-bounced emails. Leave unset to return both."}
   * @paramDef {"type":"String","label":"Scheduled After","name":"scheduledAfter","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Only return emails scheduled to send after this ISO-8601 timestamp (applies the scheduled_at[gt] filter)."}
   * @paramDef {"type":"String","label":"Updated After","name":"updatedAfter","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Only return emails updated after this ISO-8601 timestamp (applies the updated_at[gt] filter)."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve. Default: 1."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Results per page. Range: 1-100. Default: 25."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":51023,"subject":"Intro - Acme + Salesloft","status":"sent","bounced":false,"counts":{"clicks":1,"views":2,"replies":0},"recipient":{"id":38940},"user":{"id":102},"sent_at":"2026-07-15T10:00:00.000000-04:00"}],"currentPage":1,"perPage":25,"nextPage":2,"prevPage":null,"totalPages":5,"totalCount":118}
   */
  async listEmails(personId, bounced, scheduledAfter, updatedAfter, page, perPage) {
    const query = this.#listQuery(page, perPage, {
      'person_id[]': personId,
      'scheduled_at[gt]': scheduledAfter,
      'updated_at[gt]': updatedAfter,
    })

    if (bounced !== undefined && bounced !== null) {
      query.bounced = bounced
    }

    const response = await this.#apiRequest({
      logTag: 'listEmails',
      url: `${ API_BASE_URL }/activities/emails`,
      query,
    })

    return this.#listResponse(response)
  }

  /**
   * @description Retrieves a single email activity by its Salesloft id, including subject, status, bounce state, engagement counts (views, clicks, replies), recipient, and sending user.
   *
   * @route GET /get-email
   * @operationName Get Email
   * @category Activities
   *
   * @paramDef {"type":"String","label":"Email ID","name":"emailId","required":true,"description":"The Salesloft id of the email activity to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":51023,"subject":"Intro - Acme + Salesloft","status":"sent","bounced":false,"counts":{"clicks":1,"views":2,"replies":0},"recipient":{"id":38940},"user":{"id":102},"cadence":{"id":123},"sent_at":"2026-07-15T10:00:00.000000-04:00"}
   */
  async getEmail(emailId) {
    if (!emailId) {
      throw new Error('"Email ID" is required')
    }

    const response = await this.#apiRequest({
      logTag: 'getEmail',
      url: `${ API_BASE_URL }/activities/emails/${ encodeURIComponent(emailId) }`,
    })

    return response.data
  }

  // ============================================= MEETINGS ============================================

  /**
   * @description Retrieves a page of meetings booked through Salesloft. Supports filtering by person and calendar event id, plus page-based pagination (up to 100 per page). Returns the meetings as items along with paging details.
   *
   * @route GET /list-meetings
   * @operationName List Meetings
   * @category Meetings
   *
   * @paramDef {"type":"String","label":"Person ID","name":"personId","description":"Filter meetings by the Salesloft id of the attendee person."}
   * @paramDef {"type":"String","label":"Event ID","name":"eventId","description":"Filter meetings by the calendar event id."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve. Default: 1."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Results per page. Range: 1-100. Default: 25."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":301,"title":"Discovery Call - Acme","start_time":"2026-08-02T15:00:00.000000-04:00","end_time":"2026-08-02T15:30:00.000000-04:00","status":"booked","no_show":false,"person":{"id":38940},"owned_by_user":{"id":102}}],"currentPage":1,"perPage":25,"nextPage":null,"prevPage":null,"totalPages":1,"totalCount":2}
   */
  async listMeetings(personId, eventId, page, perPage) {
    const response = await this.#apiRequest({
      logTag: 'listMeetings',
      url: `${ API_BASE_URL }/meetings`,
      query: this.#listQuery(page, perPage, {
        person_id: personId,
        event_id: eventId,
      }),
    })

    return this.#listResponse(response)
  }

  // ============================================== USERS ==============================================

  /**
   * @description Retrieves a page of Salesloft users on the team, including their names, emails, guids, and active status. Supports page-based pagination (up to 100 per page). Returns the users as items along with paging details.
   *
   * @route GET /list-users
   * @operationName List Users
   * @category Users
   *
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve. Default: 1."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Results per page. Range: 1-100. Default: 25."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":102,"guid":"a0f2e5c1-9b3d-4e6f-8a21-3c5d7e9f1b2d","name":"Grace Hopper","first_name":"Grace","last_name":"Hopper","email":"grace@example.com","active":true}],"currentPage":1,"perPage":25,"nextPage":null,"prevPage":null,"totalPages":1,"totalCount":12}
   */
  async listUsers(page, perPage) {
    const response = await this.#apiRequest({
      logTag: 'listUsers',
      url: `${ API_BASE_URL }/users`,
      query: this.#listQuery(page, perPage),
    })

    return this.#listResponse(response)
  }

  /**
   * @description Retrieves a single Salesloft user by their id, including name, email, guid, role, active status, and team details.
   *
   * @route GET /get-user
   * @operationName Get User
   * @category Users
   *
   * @paramDef {"type":"String","label":"User","name":"userId","required":true,"dictionary":"getUsersDictionary","description":"The Salesloft user to retrieve. Select a user or enter a user id."}
   *
   * @returns {Object}
   * @sampleResult {"id":102,"guid":"a0f2e5c1-9b3d-4e6f-8a21-3c5d7e9f1b2d","name":"Grace Hopper","first_name":"Grace","last_name":"Hopper","email":"grace@example.com","active":true,"role":{"id":"Admin"},"team":{"id":7}}
   */
  async getUser(userId) {
    if (!userId) {
      throw new Error('"User" is required')
    }

    const response = await this.#apiRequest({
      logTag: 'getUser',
      url: `${ API_BASE_URL }/users/${ encodeURIComponent(userId) }`,
    })

    return response.data
  }

  /**
   * @description Retrieves the profile of the currently connected Salesloft user, including their id, guid, name, email, and team. Useful as a connection check and for resolving the connected user's id for other operations.
   *
   * @route GET /get-current-user
   * @operationName Get Current User
   * @category Users
   *
   * @returns {Object}
   * @sampleResult {"id":102,"guid":"a0f2e5c1-9b3d-4e6f-8a21-3c5d7e9f1b2d","name":"Grace Hopper","first_name":"Grace","last_name":"Hopper","email":"grace@example.com","team":{"id":7}}
   */
  async getCurrentUser() {
    const response = await this.#apiRequest({
      logTag: 'getCurrentUser',
      url: `${ API_BASE_URL }/me`,
    })

    return response.data
  }

  // ========================================== REFERENCE DATA =========================================

  /**
   * @description Retrieves a page of person stages configured for the team. Person stages track where a person is in your sales process (e.g. 'Prospect', 'Qualified'). Returns the stages as items along with paging details.
   *
   * @route GET /list-person-stages
   * @operationName List Person Stages
   * @category Reference Data
   *
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve. Default: 1."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Results per page. Range: 1-100. Default: 25."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":1,"name":"Prospect","order":1},{"id":2,"name":"Qualified","order":2}],"currentPage":1,"perPage":25,"nextPage":null,"prevPage":null,"totalPages":1,"totalCount":5}
   */
  async listPersonStages(page, perPage) {
    const response = await this.#apiRequest({
      logTag: 'listPersonStages',
      url: `${ API_BASE_URL }/person_stages`,
      query: this.#listQuery(page, perPage),
    })

    return this.#listResponse(response)
  }

  /**
   * @description Retrieves a page of account stages configured for the team. Account stages track where a company is in your sales process. Returns the stages as items along with paging details.
   *
   * @route GET /list-account-stages
   * @operationName List Account Stages
   * @category Reference Data
   *
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve. Default: 1."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Results per page. Range: 1-100. Default: 25."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":4,"name":"Customer","order":3},{"id":3,"name":"Engaged","order":2}],"currentPage":1,"perPage":25,"nextPage":null,"prevPage":null,"totalPages":1,"totalCount":4}
   */
  async listAccountStages(page, perPage) {
    const response = await this.#apiRequest({
      logTag: 'listAccountStages',
      url: `${ API_BASE_URL }/account_stages`,
      query: this.#listQuery(page, perPage),
    })

    return this.#listResponse(response)
  }

  /**
   * @description Retrieves a page of account tiers configured for the team. Account tiers rank the importance of accounts (e.g. 'Tier 1'). Returns the tiers as items along with paging details.
   *
   * @route GET /list-account-tiers
   * @operationName List Account Tiers
   * @category Reference Data
   *
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve. Default: 1."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Results per page. Range: 1-100. Default: 25."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":2,"name":"Tier 1","order":1},{"id":5,"name":"Tier 2","order":2}],"currentPage":1,"perPage":25,"nextPage":null,"prevPage":null,"totalPages":1,"totalCount":3}
   */
  async listAccountTiers(page, perPage) {
    const response = await this.#apiRequest({
      logTag: 'listAccountTiers',
      url: `${ API_BASE_URL }/account_tiers`,
      query: this.#listQuery(page, perPage),
    })

    return this.#listResponse(response)
  }

  /**
   * @description Retrieves a page of custom fields configured for the team, including each field's name and the record type it applies to. Use the returned names as keys in the 'Custom Fields' parameter of person and account operations. Returns the custom fields as items along with paging details.
   *
   * @route GET /list-custom-fields
   * @operationName List Custom Fields
   * @category Reference Data
   *
   * @paramDef {"type":"String","label":"Field Type","name":"fieldType","description":"Optionally filter custom fields by the record type they apply to, e.g. 'person' or 'company'."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve. Default: 1."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Results per page. Range: 1-100. Default: 25."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":7,"name":"Region","field_type":"person"},{"id":8,"name":"Segment","field_type":"company"}],"currentPage":1,"perPage":25,"nextPage":null,"prevPage":null,"totalPages":1,"totalCount":6}
   */
  async listCustomFields(fieldType, page, perPage) {
    const response = await this.#apiRequest({
      logTag: 'listCustomFields',
      url: `${ API_BASE_URL }/custom_fields`,
      query: this.#listQuery(page, perPage, { field_type: fieldType }),
    })

    return this.#listResponse(response)
  }

  /**
   * @description Retrieves a page of tags defined for the team. Use the returned names in the 'Tags' parameter of person and account operations. Returns the tags as items along with paging details.
   *
   * @route GET /list-tags
   * @operationName List Tags
   * @category Reference Data
   *
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve. Default: 1."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Results per page. Range: 1-100. Default: 25."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":11,"name":"vip"},{"id":12,"name":"strategic"}],"currentPage":1,"perPage":25,"nextPage":null,"prevPage":null,"totalPages":1,"totalCount":9}
   */
  async listTags(page, perPage) {
    const response = await this.#apiRequest({
      logTag: 'listTags',
      url: `${ API_BASE_URL }/tags`,
      query: this.#listQuery(page, perPage),
    })

    return this.#listResponse(response)
  }
}

Flowrunner.ServerCode.addService(SalesloftService, [
  {
    displayName: 'Client Id',
    defaultValue: '',
    name: 'clientId',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'The Application Id of your Salesloft OAuth application from https://accounts.salesloft.com/oauth/applications.',
  },
  {
    displayName: 'Client Secret',
    defaultValue: '',
    name: 'clientSecret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'The Secret of your Salesloft OAuth application from https://accounts.salesloft.com/oauth/applications.',
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
