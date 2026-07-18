'use strict'

const ZOHO_DESK_SCOPES = 'Desk.tickets.ALL,Desk.contacts.ALL,Desk.settings.READ,Desk.basic.READ,Desk.search.READ'

const ERROR_HINTS = {
  400: 'Zoho Desk rejected the request. Check the field names and values.',
  401: 'Authentication failed - reconnect the Zoho Desk account.',
  403: 'Access denied - your Zoho Desk profile lacks permission for this operation, or the connection is missing a required scope.',
  404: 'Not found - the record ID may be wrong, or your account belongs to a different region than the one configured.',
  422: 'Zoho Desk could not process the input. One of the values is invalid for this operation (e.g. an unknown status, a wrong ID, or a missing mandatory field).',
  429: 'Zoho Desk rate limit hit - retry in a moment.',
  500: 'Zoho Desk had a server error - this is usually transient, retry in a moment.',
}

const logger = {
  info: (...args) => console.log('[Zoho Desk Service] info:', ...args),
  debug: (...args) => console.log('[Zoho Desk Service] debug:', ...args),
  error: (...args) => console.log('[Zoho Desk Service] error:', ...args),
  warn: (...args) => console.log('[Zoho Desk Service] warn:', ...args),
}

function cleanupObject(data) {
  if (!data) {
    return undefined
  }

  const result = {}

  Object.keys(data).forEach(key => {
    const value = data[key]

    if (value === undefined || value === null) {
      return
    }

    if (typeof value === 'string' && value.trim() === '') {
      return
    }

    result[key] = value
  })

  return Object.keys(result).length > 0 ? result : undefined
}

/**
 * @requireOAuth
 * @integrationName Zoho Desk
 * @integrationIcon /icon.png
 */
class ZohoDeskService {
  constructor(config) {
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
    this.dataCenterDomain = config.dataCenterDomain || 'com'
    this.orgId = config.orgId
  }

  // ──────────────────────────────────────────────
  // Private Helpers
  // ──────────────────────────────────────────────

  #getAccessToken() {
    const accessToken = this.request.headers['oauth-access-token']

    if (!accessToken) {
      throw new Error('Access token is not available. Please reconnect your Zoho Desk account.')
    }

    return accessToken
  }

  #getOAuthBaseUrl() {
    return `https://accounts.zoho.${ this.dataCenterDomain }/oauth/v2`
  }

  // Zoho Desk is served from a region-specific domain that maps 1:1 to the accounts
  // data center (desk.zoho.com, desk.zoho.eu, desk.zoho.in, ...), so the API base is
  // derived from the configured region rather than from the token response.
  #getApiBaseUrl() {
    return `https://desk.zoho.${ this.dataCenterDomain }/api/v1`
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  #resolveIncludeList(include, mapping) {
    if (!Array.isArray(include) || include.length === 0) {
      return undefined
    }

    return include.map(value => this.#resolveChoice(value, mapping)).join(',')
  }

  // Almost every Zoho Desk endpoint requires the orgId header. When the Organization ID
  // config item is empty we fetch the account's organizations once and cache the first
  // one on the instance for the rest of the invocation.
  async #getOrgId() {
    if (this.orgId) {
      return this.orgId
    }

    if (this._resolvedOrgId) {
      return this._resolvedOrgId
    }

    const response = await this.#apiRequest({
      url: `${ this.#getApiBaseUrl() }/organizations`,
      logTag: 'getOrgId',
      withOrgId: false,
    })

    const organizations = response?.data || []

    if (organizations.length === 0) {
      throw new Error('No Zoho Desk organization was found for this account. Set the Organization ID in the service configuration.')
    }

    this._resolvedOrgId = String(organizations[0].id)

    logger.debug(`getOrgId - auto-resolved organization ${ this._resolvedOrgId }`)

    return this._resolvedOrgId
  }

  async #apiRequest({ url, method, body, query, logTag, withOrgId = true }) {
    method = method || 'get'
    query = cleanupObject(query)

    const headers = {
      'Authorization': `Zoho-oauthtoken ${ this.#getAccessToken() }`,
      'Content-Type': 'application/json',
    }

    if (withOrgId) {
      headers.orgId = await this.#getOrgId()
    }

    try {
      logger.debug(`${ logTag } - api request: [${ method }::${ url }] q=[${ JSON.stringify(query) }]`)

      const request = Flowrunner.Request[method](url)
        .set(headers)
        .query(query)

      if (body) {
        return await request.send(body)
      }

      return await request
    } catch (error) {
      this.#handleError(error, logTag)
    }
  }

  #handleError(error, logTag) {
    const status = error?.status || error?.body?.status || error?.code
    const errorCode = error?.body?.errorCode
    const apiMessage =
      error?.body?.message ||
      error?.message ||
      'Request failed'
    const hint = ERROR_HINTS[status]
    const message = errorCode ? `${ apiMessage } [${ errorCode }]` : apiMessage

    logger.error(`${ logTag } - API request failed: ${ message }`)

    throw new Error(hint ? `${ hint } (${ message })` : message)
  }

  #buildTicketFields(subject, departmentId, contactId, email, phone, description, status, priority, channel, category, subCategory, assigneeId, dueDate, customFields) {
    const fields = cleanupObject({
      subject,
      departmentId,
      contactId,
      email,
      phone,
      description,
      status,
      priority,
      channel,
      category,
      subCategory,
      assigneeId,
      dueDate,
      cf: cleanupObject(customFields),
    }) || {}

    // Desk resolves the ticket requester either by an explicit contactId or by a contact
    // object: when only an email is given, an existing contact with that email is reused,
    // otherwise Desk auto-creates one (the email doubles as the contact name, which is
    // also what Desk itself does for unknown inbound senders).
    if (!fields.contactId && fields.email) {
      fields.contact = cleanupObject({ email: fields.email, phone: fields.phone, lastName: fields.email })
    }

    return fields
  }

  // ──────────────────────────────────────────────
  // OAuth2 System Methods
  // ──────────────────────────────────────────────

  /**
   * @registerAs SYSTEM
   * @route GET /getOAuth2ConnectionURL
   *
   * @returns {String}
   */
  async getOAuth2ConnectionURL() {
    const params = new URLSearchParams()

    params.append('scope', ZOHO_DESK_SCOPES)
    params.append('client_id', this.clientId)
    params.append('response_type', 'code')
    params.append('access_type', 'offline')
    // Zoho returns a refresh token only on the very first consent. Without prompt=consent a
    // reconnect yields no refresh token and the connection silently dies when the access token
    // expires, so force the consent screen on every connect.
    params.append('prompt', 'consent')

    const connectionURL = `${ this.#getOAuthBaseUrl() }/auth?${ params.toString() }`

    logger.debug(`OAuth2 Connection URL: ${ connectionURL }`)

    return connectionURL
  }

  /**
   * @typedef {Object} executeCallback_ResultObject
   * @property {String} token
   * @property {String} refreshToken
   * @property {Number} expirationInSeconds
   * @property {String} connectionIdentityName
   */

  /**
   * @registerAs SYSTEM
   * @route POST /executeCallback
   *
   * @param {Object} callbackObject
   *
   * @returns {executeCallback_ResultObject}
   */
  async executeCallback(callbackObject) {
    logger.debug('Execute Callback')

    const params = new URLSearchParams()

    params.append('grant_type', 'authorization_code')
    params.append('client_id', this.clientId)
    params.append('client_secret', this.clientSecret)
    params.append('redirect_uri', callbackObject.redirectURI)
    params.append('code', callbackObject.code)

    const tokenResponse = await Flowrunner.Request.post(`${ this.#getOAuthBaseUrl() }/token`)
      .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
      .send(params.toString())

    let connectionIdentityName = 'Zoho Desk Account'
    let connectionIdentityImageURL

    try {
      const myInfo = await Flowrunner.Request.get(`${ this.#getApiBaseUrl() }/myinfo`)
        .set({ 'Authorization': `Zoho-oauthtoken ${ tokenResponse.access_token }` })

      if (myInfo) {
        const fullName = [myInfo.firstName, myInfo.lastName].filter(Boolean).join(' ')

        connectionIdentityName = fullName || myInfo.emailId || 'Zoho Desk Account'
        connectionIdentityImageURL = myInfo.photoURL
      }
    } catch (e) {
      logger.warn('executeCallback - could not fetch agent info:', e.message)
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
   * @typedef {Object} refreshToken_ResultObject
   * @property {String} token
   * @property {Number} expirationInSeconds
   */

  /**
   * @registerAs SYSTEM
   * @route PUT /refreshToken
   *
   * @param {String} refreshToken
   *
   * @returns {refreshToken_ResultObject}
   */
  async refreshToken(refreshToken) {
    logger.debug('Refresh Token')

    const params = new URLSearchParams()

    params.append('grant_type', 'refresh_token')
    params.append('client_id', this.clientId)
    params.append('client_secret', this.clientSecret)
    params.append('refresh_token', refreshToken)

    const response = await Flowrunner.Request.post(`${ this.#getOAuthBaseUrl() }/token`)
      .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
      .send(params.toString())

    return {
      token: response.access_token,
      expirationInSeconds: response.expires_in,
    }
  }

  // ──────────────────────────────────────────────
  // Dictionary Methods
  // ──────────────────────────────────────────────

  /**
   * @registerAs DICTIONARY
   * @operationName Select Organization
   * @description Lists the Zoho Desk organizations your account belongs to so you can pick one instead of pasting an organization ID.
   * @route POST /get-organizations-dictionary
   *
   * @paramDef {"type":"getOrganizationsDictionary__payload","label":"Payload","name":"payload","description":"Optional text to narrow down the list of organizations."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Acme Corp","value":"168000000000001","note":"https://desk.zoho.com/portal/acme"}],"cursor":null}
   */
  async getOrganizationsDictionary(payload) {
    const { search } = payload || {}

    const response = await this.#apiRequest({
      url: `${ this.#getApiBaseUrl() }/organizations`,
      logTag: 'getOrganizationsDictionary',
      withOrgId: false,
    })

    let organizations = response?.data || []

    if (search) {
      const searchLower = search.toLowerCase()

      organizations = organizations.filter(o =>
        o.companyName?.toLowerCase().includes(searchLower) ||
        o.alias?.toLowerCase().includes(searchLower)
      )
    }

    return {
      items: organizations.map(o => ({
        label: o.companyName || o.alias || String(o.id),
        value: String(o.id),
        note: o.portalURL || '',
      })),
      cursor: null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Select Department
   * @description Lists the enabled departments in your Zoho Desk organization so you can pick one instead of pasting a department ID.
   * @route POST /get-departments-dictionary
   *
   * @paramDef {"type":"getDepartmentsDictionary__payload","label":"Payload","name":"payload","description":"Optional text to narrow down the list of departments."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Support","value":"168000000000097","note":"Customer support requests"}],"cursor":null}
   */
  async getDepartmentsDictionary(payload) {
    const { search } = payload || {}

    const response = await this.#apiRequest({
      url: `${ this.#getApiBaseUrl() }/departments`,
      query: { isEnabled: true, limit: 50 },
      logTag: 'getDepartmentsDictionary',
    })

    let departments = response?.data || []

    if (search) {
      const searchLower = search.toLowerCase()

      departments = departments.filter(d =>
        d.name?.toLowerCase().includes(searchLower)
      )
    }

    return {
      items: departments.map(d => ({
        label: d.name,
        value: String(d.id),
        note: d.description || '',
      })),
      cursor: null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Select Agent
   * @description Lists the active agents in your Zoho Desk organization so you can pick an assignee instead of pasting an agent ID.
   * @route POST /get-agents-dictionary
   *
   * @paramDef {"type":"getAgentsDictionary__payload","label":"Payload","name":"payload","description":"Optional text to narrow down the list of agents."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"label":"John Smith","value":"168000000025001","note":"john@acme.com"}],"cursor":null}
   */
  async getAgentsDictionary(payload) {
    const { search } = payload || {}

    const response = await this.#apiRequest({
      url: `${ this.#getApiBaseUrl() }/agents`,
      query: { status: 'ACTIVE', limit: 50 },
      logTag: 'getAgentsDictionary',
    })

    let agents = response?.data || []

    if (search) {
      const searchLower = search.toLowerCase()

      agents = agents.filter(a =>
        a.firstName?.toLowerCase().includes(searchLower) ||
        a.lastName?.toLowerCase().includes(searchLower) ||
        a.name?.toLowerCase().includes(searchLower) ||
        a.emailId?.toLowerCase().includes(searchLower)
      )
    }

    return {
      items: agents.map(a => ({
        label: [a.firstName, a.lastName].filter(Boolean).join(' ') || a.name || a.emailId || String(a.id),
        value: String(a.id),
        note: a.emailId || '',
      })),
      cursor: null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Select Contact
   * @description Lists contacts in your Zoho Desk organization so you can pick one instead of pasting a contact ID. Type an email address or a name to search.
   * @route POST /get-contacts-dictionary
   *
   * @paramDef {"type":"getContactsDictionary__payload","label":"Payload","name":"payload","description":"Optional email address or name to search contacts by."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Jane Doe","value":"168000000038001","note":"jane@example.com"}],"cursor":null}
   */
  async getContactsDictionary(payload) {
    const { search } = payload || {}
    let contacts

    if (search) {
      try {
        const query = search.includes('@')
          ? { email: search, limit: 50 }
          : { fullName: `*${ search }*`, limit: 50 }

        const response = await this.#apiRequest({
          url: `${ this.#getApiBaseUrl() }/contacts/search`,
          query,
          logTag: 'getContactsDictionary',
        })

        contacts = response?.data || []
      } catch (e) {
        logger.warn(`getContactsDictionary - search failed, falling back to plain list: ${ e.message }`)
      }
    }

    if (!contacts) {
      const response = await this.#apiRequest({
        url: `${ this.#getApiBaseUrl() }/contacts`,
        query: { limit: 50 },
        logTag: 'getContactsDictionary',
      })

      contacts = response?.data || []

      if (search) {
        const searchLower = search.toLowerCase()

        contacts = contacts.filter(c =>
          c.firstName?.toLowerCase().includes(searchLower) ||
          c.lastName?.toLowerCase().includes(searchLower) ||
          c.email?.toLowerCase().includes(searchLower)
        )
      }
    }

    return {
      items: contacts.map(c => ({
        label: [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || String(c.id),
        value: String(c.id),
        note: c.email || c.phone || '',
      })),
      cursor: null,
    }
  }

  // ──────────────────────────────────────────────
  // Organization Methods
  // ──────────────────────────────────────────────

  /**
   * @description Retrieves all Zoho Desk organizations that the connected account belongs to, including each organization's ID, company name, portal URL, and plan details. Use the organization ID from this list in the service configuration if you want to work with an organization other than your first one.
   *
   * @route GET /list-organizations
   * @operationName List Organizations
   * @category Organizations
   *
   * @appearanceColor #089949 #0BAB57
   * @executionTimeoutInSeconds 120
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":168000000000001,"companyName":"Acme Corp","alias":"acme","portalURL":"https://desk.zoho.com/portal/acme","isDefault":true,"employeeCount":"50","edition":"ENTERPRISE"}]
   */
  async listOrganizations() {
    const response = await this.#apiRequest({
      url: `${ this.#getApiBaseUrl() }/organizations`,
      logTag: 'listOrganizations',
      withOrgId: false,
    })

    return response?.data || []
  }

  // ──────────────────────────────────────────────
  // Ticket Methods
  // ──────────────────────────────────────────────

  /**
   * @description Retrieves a list of tickets from Zoho Desk with optional filtering by department, assignee, channel, and status. Supports sorting and pagination (up to 100 tickets per call). Use the Include Details option to embed related contact, assignee, and department data in each ticket.
   *
   * @route GET /list-tickets
   * @operationName List Tickets
   * @category Tickets
   *
   * @appearanceColor #089949 #0BAB57
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"Number","label":"Start Index","name":"from","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Index of the first ticket to return. Use together with Limit to paginate through results."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many tickets to return at once (maximum 100). Defaults to 10."}
   * @paramDef {"type":"String","label":"Department","name":"departmentIds","dictionary":"getDepartmentsDictionary","description":"Only return tickets from these departments. Pick a department from the list, or paste one or more department IDs separated by commas."}
   * @paramDef {"type":"String","label":"Assignee","name":"assigneeId","dictionary":"getAgentsDictionary","description":"Only return tickets assigned to these agents. Pick an agent from the list, paste agent IDs separated by commas, or use the keyword Unassigned for tickets without an assignee."}
   * @paramDef {"type":"String","label":"Channel","name":"channel","uiComponent":{"type":"DROPDOWN","options":{"values":["Email","Phone","Web","Twitter","Facebook","Chat","Forums"]}},"description":"Only return tickets received through this channel."}
   * @paramDef {"type":"String","label":"Status","name":"status","description":"Only return tickets with this status (e.g. Open, On Hold, Escalated, Closed, or a custom status from your help desk). Separate multiple statuses with commas."}
   * @paramDef {"type":"String","label":"Sort By","name":"sortBy","uiComponent":{"type":"DROPDOWN","options":{"values":["Created Time (Newest First)","Created Time (Oldest First)","Ticket Number (Descending)","Ticket Number (Ascending)","Customer Response Time (Newest First)","Customer Response Time (Oldest First)","Response Due Date (Latest First)","Response Due Date (Earliest First)"]}},"description":"The order in which tickets are returned."}
   * @paramDef {"type":"Array<String>","label":"Include Details","name":"include","uiComponent":{"type":"DROPDOWN","options":{"values":["Contacts","Assignee","Departments","Team","Products","Is Read"]}},"description":"Related details to embed in each ticket, such as the full contact, assignee, or department record."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":"168000000042001","ticketNumber":"101","subject":"Cannot sign in to the portal","status":"Open","priority":"High","channel":"Email","email":"jane@example.com","departmentId":"168000000000097","contactId":"168000000038001","assigneeId":"168000000025001","createdTime":"2026-01-15T10:30:00.000Z","dueDate":"2026-01-17T10:30:00.000Z","webUrl":"https://desk.zoho.com/support/acme/ShowHomePage.do#Cases/dv/101"}]
   */
  async listTickets(from, limit, departmentIds, assigneeId, channel, status, sortBy, include) {
    const response = await this.#apiRequest({
      url: `${ this.#getApiBaseUrl() }/tickets`,
      query: {
        from,
        limit,
        departmentIds,
        assignee: assigneeId,
        channel,
        status,
        sortBy: this.#resolveChoice(sortBy, {
          'Created Time (Newest First)': '-createdTime',
          'Created Time (Oldest First)': 'createdTime',
          'Ticket Number (Descending)': '-ticketNumber',
          'Ticket Number (Ascending)': 'ticketNumber',
          'Customer Response Time (Newest First)': '-customerResponseTime',
          'Customer Response Time (Oldest First)': 'customerResponseTime',
          'Response Due Date (Latest First)': '-responseDueDate',
          'Response Due Date (Earliest First)': 'responseDueDate',
        }),
        include: this.#resolveIncludeList(include, {
          'Contacts': 'contacts',
          'Assignee': 'assignee',
          'Departments': 'departments',
          'Team': 'team',
          'Products': 'products',
          'Is Read': 'isRead',
        }),
      },
      logTag: 'listTickets',
    })

    return response?.data || []
  }

  /**
   * @description Retrieves a single ticket from Zoho Desk by its ID, including subject, description, status, priority, requester, and timestamps. Use the Include Details option to embed the full contact, assignee, department, and team records in the response.
   *
   * @route GET /get-ticket
   * @operationName Get Ticket
   * @category Tickets
   *
   * @appearanceColor #089949 #0BAB57
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Ticket ID","name":"ticketId","required":true,"description":"The ID of the ticket to retrieve (not the ticket number shown in the UI)."}
   * @paramDef {"type":"Array<String>","label":"Include Details","name":"include","uiComponent":{"type":"DROPDOWN","options":{"values":["Contacts","Assignee","Departments","Team","Products","Is Read"]}},"description":"Related details to embed in the ticket, such as the full contact, assignee, or department record."}
   *
   * @returns {Object}
   * @sampleResult {"id":"168000000042001","ticketNumber":"101","subject":"Cannot sign in to the portal","description":"<div>I get an invalid password error.</div>","status":"Open","priority":"High","channel":"Email","email":"jane@example.com","departmentId":"168000000000097","contactId":"168000000038001","assigneeId":"168000000025001","createdTime":"2026-01-15T10:30:00.000Z","webUrl":"https://desk.zoho.com/support/acme/ShowHomePage.do#Cases/dv/101"}
   */
  async getTicket(ticketId, include) {
    return await this.#apiRequest({
      url: `${ this.#getApiBaseUrl() }/tickets/${ ticketId }`,
      query: {
        include: this.#resolveIncludeList(include, {
          'Contacts': 'contacts',
          'Assignee': 'assignee',
          'Departments': 'departments',
          'Team': 'team',
          'Products': 'products',
          'Is Read': 'isRead',
        }),
      },
      logTag: 'getTicket',
    })
  }

  /**
   * @description Creates a new support ticket in Zoho Desk. Identify the requester either by an existing Contact or by an email address - when only an email is given, Zoho Desk reuses the contact with that email or automatically creates a new one. The description supports HTML formatting, and account-specific custom fields can be set through the Custom Fields object.
   *
   * @route POST /create-ticket
   * @operationName Create Ticket
   * @category Tickets
   *
   * @appearanceColor #089949 #0BAB57
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Subject","name":"subject","required":true,"description":"Subject line of the ticket."}
   * @paramDef {"type":"String","label":"Department","name":"departmentId","required":true,"dictionary":"getDepartmentsDictionary","description":"The department the ticket belongs to."}
   * @paramDef {"type":"String","label":"Contact","name":"contactId","dictionary":"getContactsDictionary","description":"The existing contact who raised the ticket. Leave empty to identify the requester by email instead."}
   * @paramDef {"type":"String","label":"Requester Email","name":"email","description":"Email address of the requester. Used when no Contact is selected: Zoho Desk reuses the contact with this email or auto-creates a new one. Required if Contact is empty."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"Phone number associated with the ticket."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Detailed description of the issue. Supports HTML formatting."}
   * @paramDef {"type":"String","label":"Status","name":"status","description":"Status of the ticket (e.g. Open, On Hold, Escalated, Closed, or a custom status from your help desk). Defaults to Open."}
   * @paramDef {"type":"String","label":"Priority","name":"priority","uiComponent":{"type":"DROPDOWN","options":{"values":["High","Medium","Low"]}},"description":"Priority of the ticket."}
   * @paramDef {"type":"String","label":"Channel","name":"channel","uiComponent":{"type":"DROPDOWN","options":{"values":["Email","Phone","Web","Twitter","Facebook","Chat","Forums"]}},"description":"The channel the ticket was received through."}
   * @paramDef {"type":"String","label":"Category","name":"category","description":"Category of the ticket, as configured in your help desk."}
   * @paramDef {"type":"String","label":"Sub Category","name":"subCategory","description":"Sub-category of the ticket, as configured in your help desk."}
   * @paramDef {"type":"String","label":"Assignee","name":"assigneeId","dictionary":"getAgentsDictionary","description":"The agent to assign the ticket to."}
   * @paramDef {"type":"String","label":"Due Date","name":"dueDate","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"When the ticket is due, in ISO 8601 format (e.g. 2026-08-01T12:00:00.000Z)."}
   * @paramDef {"type":"Object","label":"Custom Fields","name":"customFields","description":"Custom field values as an object keyed by the field's API name (e.g. {\"cf_severity\":\"Sev 1\"})."}
   *
   * @returns {Object}
   * @sampleResult {"id":"168000000042001","ticketNumber":"101","subject":"Cannot sign in to the portal","status":"Open","priority":"High","channel":"Email","departmentId":"168000000000097","contactId":"168000000038001","createdTime":"2026-01-15T10:30:00.000Z","webUrl":"https://desk.zoho.com/support/acme/ShowHomePage.do#Cases/dv/101"}
   */
  async createTicket(subject, departmentId, contactId, email, phone, description, status, priority, channel, category, subCategory, assigneeId, dueDate, customFields) {
    if (!contactId && !email) {
      throw new Error('Provide either a Contact or a Requester Email so Zoho Desk knows who raised the ticket.')
    }

    const fields = this.#buildTicketFields(subject, departmentId, contactId, email, phone, description, status, priority, channel, category, subCategory, assigneeId, dueDate, customFields)

    return await this.#apiRequest({
      url: `${ this.#getApiBaseUrl() }/tickets`,
      method: 'post',
      body: fields,
      logTag: 'createTicket',
    })
  }

  /**
   * @description Updates an existing ticket in Zoho Desk. Only the fields you fill in are changed; all other fields keep their current values. The description supports HTML formatting, and account-specific custom fields can be updated through the Custom Fields object.
   *
   * @route PATCH /update-ticket
   * @operationName Update Ticket
   * @category Tickets
   *
   * @appearanceColor #089949 #0BAB57
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Ticket ID","name":"ticketId","required":true,"description":"The ID of the ticket to update."}
   * @paramDef {"type":"String","label":"Subject","name":"subject","description":"New subject line for the ticket."}
   * @paramDef {"type":"String","label":"Department","name":"departmentId","dictionary":"getDepartmentsDictionary","description":"Move the ticket to this department."}
   * @paramDef {"type":"String","label":"Contact","name":"contactId","dictionary":"getContactsDictionary","description":"Change the requester of the ticket to this contact."}
   * @paramDef {"type":"String","label":"Status","name":"status","description":"New status for the ticket (e.g. Open, On Hold, Escalated, Closed, or a custom status from your help desk)."}
   * @paramDef {"type":"String","label":"Priority","name":"priority","uiComponent":{"type":"DROPDOWN","options":{"values":["High","Medium","Low"]}},"description":"New priority for the ticket."}
   * @paramDef {"type":"String","label":"Channel","name":"channel","uiComponent":{"type":"DROPDOWN","options":{"values":["Email","Phone","Web","Twitter","Facebook","Chat","Forums"]}},"description":"New channel for the ticket."}
   * @paramDef {"type":"String","label":"Category","name":"category","description":"New category for the ticket, as configured in your help desk."}
   * @paramDef {"type":"String","label":"Sub Category","name":"subCategory","description":"New sub-category for the ticket, as configured in your help desk."}
   * @paramDef {"type":"String","label":"Assignee","name":"assigneeId","dictionary":"getAgentsDictionary","description":"Reassign the ticket to this agent."}
   * @paramDef {"type":"String","label":"Due Date","name":"dueDate","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"New due date, in ISO 8601 format (e.g. 2026-08-01T12:00:00.000Z)."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New description for the ticket. Supports HTML formatting."}
   * @paramDef {"type":"Object","label":"Custom Fields","name":"customFields","description":"Custom field values to update, as an object keyed by the field's API name (e.g. {\"cf_severity\":\"Sev 1\"})."}
   *
   * @returns {Object}
   * @sampleResult {"id":"168000000042001","ticketNumber":"101","subject":"Cannot sign in to the portal","status":"On Hold","priority":"Medium","modifiedTime":"2026-01-15T12:00:00.000Z"}
   */
  async updateTicket(ticketId, subject, departmentId, contactId, status, priority, channel, category, subCategory, assigneeId, dueDate, description, customFields) {
    const fields = cleanupObject({
      subject,
      departmentId,
      contactId,
      status,
      priority,
      channel,
      category,
      subCategory,
      assigneeId,
      dueDate,
      description,
      cf: cleanupObject(customFields),
    })

    if (!fields) {
      throw new Error('Provide at least one field to update.')
    }

    return await this.#apiRequest({
      url: `${ this.#getApiBaseUrl() }/tickets/${ ticketId }`,
      method: 'patch',
      body: fields,
      logTag: 'updateTicket',
    })
  }

  /**
   * @description Moves one or more tickets to the Recycle Bin in Zoho Desk. This is how Zoho Desk deletes tickets - trashed tickets can be restored from the Recycle Bin by an administrator before they are permanently purged.
   *
   * @route POST /move-tickets-to-trash
   * @operationName Move Tickets to Trash
   * @category Tickets
   *
   * @appearanceColor #089949 #0BAB57
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"Array<String>","label":"Ticket IDs","name":"ticketIds","required":true,"description":"The IDs of the tickets to move to the Recycle Bin."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"movedTicketIds":["168000000042001"]}
   */
  async moveTicketsToTrash(ticketIds) {
    if (!Array.isArray(ticketIds) || ticketIds.length === 0) {
      throw new Error('Provide at least one ticket ID to move to trash.')
    }

    await this.#apiRequest({
      url: `${ this.#getApiBaseUrl() }/tickets/moveToTrash`,
      method: 'post',
      body: { ticketIds },
      logTag: 'moveTicketsToTrash',
    })

    return { success: true, movedTicketIds: ticketIds }
  }

  /**
   * @description Closes a ticket in Zoho Desk by setting its status to Closed, optionally recording a resolution summary at the same time. This is a convenience shortcut for the most common ticket update.
   *
   * @route PATCH /close-ticket
   * @operationName Close Ticket
   * @category Tickets
   *
   * @appearanceColor #089949 #0BAB57
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Ticket ID","name":"ticketId","required":true,"description":"The ID of the ticket to close."}
   * @paramDef {"type":"String","label":"Resolution","name":"resolution","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"A summary of how the issue was resolved, stored in the ticket's resolution field."}
   *
   * @returns {Object}
   * @sampleResult {"id":"168000000042001","ticketNumber":"101","subject":"Cannot sign in to the portal","status":"Closed","closedTime":"2026-01-16T09:00:00.000Z"}
   */
  async closeTicket(ticketId, resolution) {
    const body = cleanupObject({ status: 'Closed', resolution })

    return await this.#apiRequest({
      url: `${ this.#getApiBaseUrl() }/tickets/${ ticketId }`,
      method: 'patch',
      body,
      logTag: 'closeTicket',
    })
  }

  /**
   * @description Assigns a ticket to an agent, a team, or both in Zoho Desk. Provide at least one of the two. Existing assignments are replaced by the values you set.
   *
   * @route PATCH /assign-ticket
   * @operationName Assign Ticket
   * @category Tickets
   *
   * @appearanceColor #089949 #0BAB57
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Ticket ID","name":"ticketId","required":true,"description":"The ID of the ticket to assign."}
   * @paramDef {"type":"String","label":"Assignee","name":"assigneeId","dictionary":"getAgentsDictionary","description":"The agent to assign the ticket to."}
   * @paramDef {"type":"String","label":"Team ID","name":"teamId","description":"The team to assign the ticket to."}
   *
   * @returns {Object}
   * @sampleResult {"id":"168000000042001","ticketNumber":"101","subject":"Cannot sign in to the portal","assigneeId":"168000000025001","status":"Open"}
   */
  async assignTicket(ticketId, assigneeId, teamId) {
    const body = cleanupObject({ assigneeId, teamId })

    if (!body) {
      throw new Error('Provide an Assignee or a Team ID to assign the ticket to.')
    }

    return await this.#apiRequest({
      url: `${ this.#getApiBaseUrl() }/tickets/${ ticketId }`,
      method: 'patch',
      body,
      logTag: 'assignTicket',
    })
  }

  /**
   * @description Searches tickets in Zoho Desk by keyword, subject, requester email, status, priority, channel, department, or contact. Provide at least one search criterion; multiple criteria are combined. The keyword search supports * as a wildcard. Returns up to 100 tickets per call.
   *
   * @route GET /search-tickets
   * @operationName Search Tickets
   * @category Tickets
   *
   * @appearanceColor #089949 #0BAB57
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Keyword","name":"searchStr","description":"Search across the tickets' searchable fields. Supports * as a wildcard (e.g. sign* matches sign in and signup)."}
   * @paramDef {"type":"String","label":"Subject","name":"subject","description":"Only return tickets whose subject matches this text."}
   * @paramDef {"type":"String","label":"Requester Email","name":"email","description":"Only return tickets raised from this email address."}
   * @paramDef {"type":"String","label":"Status","name":"status","description":"Only return tickets with this status (e.g. Open, On Hold, Escalated, Closed, or a custom status from your help desk)."}
   * @paramDef {"type":"String","label":"Priority","name":"priority","uiComponent":{"type":"DROPDOWN","options":{"values":["High","Medium","Low"]}},"description":"Only return tickets with this priority."}
   * @paramDef {"type":"String","label":"Channel","name":"channel","uiComponent":{"type":"DROPDOWN","options":{"values":["Email","Phone","Web","Twitter","Facebook","Chat","Forums"]}},"description":"Only return tickets received through this channel."}
   * @paramDef {"type":"String","label":"Department","name":"departmentId","dictionary":"getDepartmentsDictionary","description":"Only return tickets from this department."}
   * @paramDef {"type":"String","label":"Contact","name":"contactId","dictionary":"getContactsDictionary","description":"Only return tickets raised by this contact."}
   * @paramDef {"type":"String","label":"Sort By","name":"sortBy","uiComponent":{"type":"DROPDOWN","options":{"values":["Relevance","Created Time (Newest First)","Created Time (Oldest First)","Modified Time (Newest First)","Modified Time (Oldest First)"]}},"description":"The order in which matching tickets are returned."}
   * @paramDef {"type":"Number","label":"Start Index","name":"from","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Index of the first ticket to return. Use together with Limit to paginate through results."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many tickets to return at once (maximum 100). Defaults to 10."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":"168000000042001","ticketNumber":"101","subject":"Cannot sign in to the portal","status":"Open","priority":"High","channel":"Email","email":"jane@example.com","departmentId":"168000000000097","createdTime":"2026-01-15T10:30:00.000Z"}]
   */
  async searchTickets(searchStr, subject, email, status, priority, channel, departmentId, contactId, sortBy, from, limit) {
    if (!searchStr && !subject && !email && !status && !priority && !channel && !departmentId && !contactId) {
      throw new Error('Provide at least one search criterion (Keyword, Subject, Requester Email, Status, Priority, Channel, Department, or Contact).')
    }

    const response = await this.#apiRequest({
      url: `${ this.#getApiBaseUrl() }/tickets/search`,
      query: {
        searchStr,
        subject,
        email,
        status,
        priority,
        channel,
        departmentId,
        contactId,
        sortBy: this.#resolveChoice(sortBy, {
          'Relevance': 'relevance',
          'Created Time (Newest First)': '-createdTime',
          'Created Time (Oldest First)': 'createdTime',
          'Modified Time (Newest First)': '-modifiedTime',
          'Modified Time (Oldest First)': 'modifiedTime',
        }),
        from,
        limit,
      },
      logTag: 'searchTickets',
    })

    return response?.data || []
  }

  // ──────────────────────────────────────────────
  // Ticket Comment Methods
  // ──────────────────────────────────────────────

  /**
   * @description Retrieves the comments on a ticket in Zoho Desk, including each comment's content, visibility (public or private), author, and timestamps. Supports pagination.
   *
   * @route GET /list-ticket-comments
   * @operationName List Ticket Comments
   * @category Ticket Comments
   *
   * @appearanceColor #089949 #0BAB57
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Ticket ID","name":"ticketId","required":true,"description":"The ID of the ticket whose comments to retrieve."}
   * @paramDef {"type":"Number","label":"Start Index","name":"from","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Index of the first comment to return. Use together with Limit to paginate through results."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many comments to return at once (maximum 100). Defaults to 10."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":"168000000045001","content":"Called the customer and walked through a password reset.","isPublic":false,"contentType":"plainText","commentedTime":"2026-01-15T11:00:00.000Z","commenter":{"id":"168000000025001","name":"John Smith","type":"AGENT"}}]
   */
  async listTicketComments(ticketId, from, limit) {
    const response = await this.#apiRequest({
      url: `${ this.#getApiBaseUrl() }/tickets/${ ticketId }/comments`,
      query: { from, limit },
      logTag: 'listTicketComments',
    })

    return response?.data || []
  }

  /**
   * @description Adds a comment to a ticket in Zoho Desk. Comments can be private (visible only to agents) or public (visible to the customer in the help center), and the content can be plain text or HTML.
   *
   * @route POST /add-ticket-comment
   * @operationName Add Ticket Comment
   * @category Ticket Comments
   *
   * @appearanceColor #089949 #0BAB57
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Ticket ID","name":"ticketId","required":true,"description":"The ID of the ticket to comment on."}
   * @paramDef {"type":"String","label":"Content","name":"content","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The comment text. Use HTML markup when the Content Type is set to HTML."}
   * @paramDef {"type":"Boolean","label":"Public Comment","name":"isPublic","uiComponent":{"type":"TOGGLE"},"description":"Whether the comment is visible to the customer. When off, the comment is private and visible only to agents."}
   * @paramDef {"type":"String","label":"Content Type","name":"contentType","uiComponent":{"type":"DROPDOWN","options":{"values":["HTML","Plain Text"]}},"description":"How the comment content should be interpreted. Defaults to plain text."}
   *
   * @returns {Object}
   * @sampleResult {"id":"168000000045001","content":"Called the customer and walked through a password reset.","isPublic":false,"contentType":"plainText","commentedTime":"2026-01-15T11:00:00.000Z"}
   */
  async addTicketComment(ticketId, content, isPublic, contentType) {
    return await this.#apiRequest({
      url: `${ this.#getApiBaseUrl() }/tickets/${ ticketId }/comments`,
      method: 'post',
      body: cleanupObject({
        content,
        isPublic,
        contentType: this.#resolveChoice(contentType, { 'HTML': 'html', 'Plain Text': 'plainText' }),
      }),
      logTag: 'addTicketComment',
    })
  }

  /**
   * @description Updates an existing comment on a ticket in Zoho Desk, replacing its content and optionally changing its visibility or content type. Only comments created by the connected agent can be edited.
   *
   * @route PATCH /update-ticket-comment
   * @operationName Update Ticket Comment
   * @category Ticket Comments
   *
   * @appearanceColor #089949 #0BAB57
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Ticket ID","name":"ticketId","required":true,"description":"The ID of the ticket the comment belongs to."}
   * @paramDef {"type":"String","label":"Comment ID","name":"commentId","required":true,"description":"The ID of the comment to update."}
   * @paramDef {"type":"String","label":"Content","name":"content","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The new comment text. Use HTML markup when the Content Type is set to HTML."}
   * @paramDef {"type":"Boolean","label":"Public Comment","name":"isPublic","uiComponent":{"type":"TOGGLE"},"description":"Whether the comment is visible to the customer. When off, the comment is private and visible only to agents."}
   * @paramDef {"type":"String","label":"Content Type","name":"contentType","uiComponent":{"type":"DROPDOWN","options":{"values":["HTML","Plain Text"]}},"description":"How the comment content should be interpreted."}
   *
   * @returns {Object}
   * @sampleResult {"id":"168000000045001","content":"Update: the customer confirmed access is restored.","isPublic":false,"contentType":"plainText","modifiedTime":"2026-01-15T12:30:00.000Z"}
   */
  async updateTicketComment(ticketId, commentId, content, isPublic, contentType) {
    return await this.#apiRequest({
      url: `${ this.#getApiBaseUrl() }/tickets/${ ticketId }/comments/${ commentId }`,
      method: 'patch',
      body: cleanupObject({
        content,
        isPublic,
        contentType: this.#resolveChoice(contentType, { 'HTML': 'html', 'Plain Text': 'plainText' }),
      }),
      logTag: 'updateTicketComment',
    })
  }

  // ──────────────────────────────────────────────
  // Ticket Thread Methods
  // ──────────────────────────────────────────────

  /**
   * @description Retrieves the conversation threads of a ticket in Zoho Desk - the emails and other channel messages exchanged with the customer. Each thread includes the channel, direction, author, and a content summary; use Get Ticket Thread to fetch a thread's full content.
   *
   * @route GET /list-ticket-threads
   * @operationName List Ticket Threads
   * @category Ticket Threads
   *
   * @appearanceColor #089949 #0BAB57
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Ticket ID","name":"ticketId","required":true,"description":"The ID of the ticket whose conversation threads to retrieve."}
   * @paramDef {"type":"Number","label":"Start Index","name":"from","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Index of the first thread to return. Use together with Limit to paginate through results."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many threads to return at once (maximum 100). Defaults to 10."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":"168000000046001","channel":"EMAIL","direction":"in","summary":"Hello, I cannot sign in to the portal...","fromEmailAddress":"jane@example.com","createdTime":"2026-01-15T10:30:00.000Z","author":{"name":"Jane Doe","type":"CUSTOMER"}}]
   */
  async listTicketThreads(ticketId, from, limit) {
    const response = await this.#apiRequest({
      url: `${ this.#getApiBaseUrl() }/tickets/${ ticketId }/threads`,
      query: { from, limit },
      logTag: 'listTicketThreads',
    })

    return response?.data || []
  }

  /**
   * @description Retrieves a single conversation thread of a ticket in Zoho Desk with its full message content, including the complete email body, sender and recipient addresses, and attachment metadata.
   *
   * @route GET /get-ticket-thread
   * @operationName Get Ticket Thread
   * @category Ticket Threads
   *
   * @appearanceColor #089949 #0BAB57
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Ticket ID","name":"ticketId","required":true,"description":"The ID of the ticket the thread belongs to."}
   * @paramDef {"type":"String","label":"Thread ID","name":"threadId","required":true,"description":"The ID of the thread to retrieve. Use List Ticket Threads to find it."}
   *
   * @returns {Object}
   * @sampleResult {"id":"168000000046001","channel":"EMAIL","direction":"in","content":"<div>Hello, I cannot sign in to the portal. I get an invalid password error.</div>","contentType":"html","fromEmailAddress":"jane@example.com","to":"support@acme.zohodesk.com","createdTime":"2026-01-15T10:30:00.000Z","attachments":[]}
   */
  async getTicketThread(ticketId, threadId) {
    return await this.#apiRequest({
      url: `${ this.#getApiBaseUrl() }/tickets/${ ticketId }/threads/${ threadId }`,
      logTag: 'getTicketThread',
    })
  }

  /**
   * @description Sends an email reply on a ticket in Zoho Desk, adding it to the ticket's conversation and delivering it to the recipients. The From address must be one of the support email addresses configured for the ticket's department in Zoho Desk - arbitrary addresses are rejected. Content supports HTML formatting, and the reply can also be sent as a forward.
   *
   * @route POST /send-ticket-reply
   * @operationName Send Ticket Reply
   * @category Ticket Threads
   *
   * @appearanceColor #089949 #0BAB57
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Ticket ID","name":"ticketId","required":true,"description":"The ID of the ticket to reply on."}
   * @paramDef {"type":"String","label":"Content","name":"content","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The reply message. Use HTML markup when the Content Type is set to HTML."}
   * @paramDef {"type":"String","label":"From Address","name":"fromEmailAddress","required":true,"description":"The support email address to send the reply from. Must be a support address configured for the ticket's department in Zoho Desk."}
   * @paramDef {"type":"String","label":"To","name":"to","required":true,"description":"Recipient email address. Usually the ticket requester's address; separate multiple addresses with commas."}
   * @paramDef {"type":"String","label":"CC","name":"cc","description":"CC recipients, separated by commas."}
   * @paramDef {"type":"String","label":"BCC","name":"bcc","description":"BCC recipients, separated by commas."}
   * @paramDef {"type":"String","label":"Content Type","name":"contentType","uiComponent":{"type":"DROPDOWN","options":{"values":["HTML","Plain Text"]}},"description":"How the reply content should be interpreted. Defaults to HTML."}
   * @paramDef {"type":"Boolean","label":"Send as Forward","name":"isForward","uiComponent":{"type":"TOGGLE"},"description":"Whether to send this message as a forward of the ticket conversation instead of a reply."}
   *
   * @returns {Object}
   * @sampleResult {"id":"168000000046002","channel":"EMAIL","status":"SUCCESS","content":"<div>Thanks for reaching out - your password has been reset.</div>","fromEmailAddress":"support@acme.zohodesk.com","to":"jane@example.com","createdTime":"2026-01-15T11:15:00.000Z"}
   */
  async sendTicketReply(ticketId, content, fromEmailAddress, to, cc, bcc, contentType, isForward) {
    return await this.#apiRequest({
      url: `${ this.#getApiBaseUrl() }/tickets/${ ticketId }/sendReply`,
      method: 'post',
      body: cleanupObject({
        channel: 'EMAIL',
        content,
        fromEmailAddress,
        to,
        cc,
        bcc,
        contentType: this.#resolveChoice(contentType, { 'HTML': 'html', 'Plain Text': 'plainText' }),
        isForward,
      }),
      logTag: 'sendTicketReply',
    })
  }

  // ──────────────────────────────────────────────
  // Contact Methods
  // ──────────────────────────────────────────────

  /**
   * @description Retrieves a list of contacts from your Zoho Desk organization, including each contact's name, email, phone, and account association. Supports sorting and pagination (up to 100 contacts per call).
   *
   * @route GET /list-contacts
   * @operationName List Contacts
   * @category Contacts
   *
   * @appearanceColor #089949 #0BAB57
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"Number","label":"Start Index","name":"from","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Index of the first contact to return. Use together with Limit to paginate through results."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many contacts to return at once (maximum 100). Defaults to 10."}
   * @paramDef {"type":"String","label":"Sort By","name":"sortBy","uiComponent":{"type":"DROPDOWN","options":{"values":["First Name","Last Name","Created Time (Newest First)","Created Time (Oldest First)","Modified Time (Newest First)","Modified Time (Oldest First)"]}},"description":"The order in which contacts are returned."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":"168000000038001","firstName":"Jane","lastName":"Doe","email":"jane@example.com","phone":"+1 555 0100","accountId":"168000000039001","createdTime":"2026-01-10T09:00:00.000Z"}]
   */
  async listContacts(from, limit, sortBy) {
    const response = await this.#apiRequest({
      url: `${ this.#getApiBaseUrl() }/contacts`,
      query: {
        from,
        limit,
        sortBy: this.#resolveChoice(sortBy, {
          'First Name': 'firstName',
          'Last Name': 'lastName',
          'Created Time (Newest First)': '-createdTime',
          'Created Time (Oldest First)': 'createdTime',
          'Modified Time (Newest First)': '-modifiedTime',
          'Modified Time (Oldest First)': 'modifiedTime',
        }),
      },
      logTag: 'listContacts',
    })

    return response?.data || []
  }

  /**
   * @description Retrieves a single contact from Zoho Desk by its ID, including the contact's name, email, phone numbers, title, description, and associated account.
   *
   * @route GET /get-contact
   * @operationName Get Contact
   * @category Contacts
   *
   * @appearanceColor #089949 #0BAB57
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Contact","name":"contactId","required":true,"dictionary":"getContactsDictionary","description":"The contact to retrieve. Pick from the list, or paste a contact ID."}
   *
   * @returns {Object}
   * @sampleResult {"id":"168000000038001","firstName":"Jane","lastName":"Doe","email":"jane@example.com","phone":"+1 555 0100","mobile":"+1 555 0101","title":"IT Manager","accountId":"168000000039001","createdTime":"2026-01-10T09:00:00.000Z"}
   */
  async getContact(contactId) {
    return await this.#apiRequest({
      url: `${ this.#getApiBaseUrl() }/contacts/${ contactId }`,
      logTag: 'getContact',
    })
  }

  /**
   * @description Creates a new contact in Zoho Desk. Only the last name is mandatory; add an email so the contact can raise and receive ticket correspondence, and link an account to group the contact under a company.
   *
   * @route POST /create-contact
   * @operationName Create Contact
   * @category Contacts
   *
   * @appearanceColor #089949 #0BAB57
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","required":true,"description":"Last name of the contact."}
   * @paramDef {"type":"String","label":"First Name","name":"firstName","description":"First name of the contact."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Email address of the contact. Must be unique within the organization."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"Phone number of the contact."}
   * @paramDef {"type":"String","label":"Mobile","name":"mobile","description":"Mobile number of the contact."}
   * @paramDef {"type":"String","label":"Account ID","name":"accountId","description":"The ID of the account (company) to associate the contact with."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"Job title of the contact (e.g. IT Manager)."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Additional notes about the contact."}
   *
   * @returns {Object}
   * @sampleResult {"id":"168000000038001","firstName":"Jane","lastName":"Doe","email":"jane@example.com","phone":"+1 555 0100","accountId":"168000000039001","createdTime":"2026-01-10T09:00:00.000Z"}
   */
  async createContact(lastName, firstName, email, phone, mobile, accountId, title, description) {
    return await this.#apiRequest({
      url: `${ this.#getApiBaseUrl() }/contacts`,
      method: 'post',
      body: cleanupObject({ lastName, firstName, email, phone, mobile, accountId, title, description }),
      logTag: 'createContact',
    })
  }

  /**
   * @description Updates an existing contact in Zoho Desk. Only the fields you fill in are changed; all other fields keep their current values.
   *
   * @route PATCH /update-contact
   * @operationName Update Contact
   * @category Contacts
   *
   * @appearanceColor #089949 #0BAB57
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Contact","name":"contactId","required":true,"dictionary":"getContactsDictionary","description":"The contact to update. Pick from the list, or paste a contact ID."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","description":"New last name for the contact."}
   * @paramDef {"type":"String","label":"First Name","name":"firstName","description":"New first name for the contact."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"New email address for the contact. Must be unique within the organization."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"New phone number for the contact."}
   * @paramDef {"type":"String","label":"Mobile","name":"mobile","description":"New mobile number for the contact."}
   * @paramDef {"type":"String","label":"Account ID","name":"accountId","description":"The ID of the account (company) to associate the contact with."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"New job title for the contact."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New notes for the contact."}
   *
   * @returns {Object}
   * @sampleResult {"id":"168000000038001","firstName":"Jane","lastName":"Doe","email":"jane.doe@example.com","modifiedTime":"2026-01-15T12:00:00.000Z"}
   */
  async updateContact(contactId, lastName, firstName, email, phone, mobile, accountId, title, description) {
    const fields = cleanupObject({ lastName, firstName, email, phone, mobile, accountId, title, description })

    if (!fields) {
      throw new Error('Provide at least one field to update.')
    }

    return await this.#apiRequest({
      url: `${ this.#getApiBaseUrl() }/contacts/${ contactId }`,
      method: 'patch',
      body: fields,
      logTag: 'updateContact',
    })
  }

  /**
   * @description Retrieves the tickets raised by a specific contact in Zoho Desk, most useful for building a customer's support history. Supports pagination (up to 100 tickets per call).
   *
   * @route GET /list-contact-tickets
   * @operationName List Contact Tickets
   * @category Contacts
   *
   * @appearanceColor #089949 #0BAB57
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Contact","name":"contactId","required":true,"dictionary":"getContactsDictionary","description":"The contact whose tickets to retrieve. Pick from the list, or paste a contact ID."}
   * @paramDef {"type":"Number","label":"Start Index","name":"from","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Index of the first ticket to return. Use together with Limit to paginate through results."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many tickets to return at once (maximum 100). Defaults to 10."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":"168000000042001","ticketNumber":"101","subject":"Cannot sign in to the portal","status":"Open","priority":"High","channel":"Email","createdTime":"2026-01-15T10:30:00.000Z"}]
   */
  async listContactTickets(contactId, from, limit) {
    const response = await this.#apiRequest({
      url: `${ this.#getApiBaseUrl() }/contacts/${ contactId }/tickets`,
      query: { from, limit },
      logTag: 'listContactTickets',
    })

    return response?.data || []
  }

  // ──────────────────────────────────────────────
  // Account Methods
  // ──────────────────────────────────────────────

  /**
   * @description Retrieves a list of accounts (companies) from your Zoho Desk organization, including each account's name, email, phone, website, and industry. Supports pagination (up to 100 accounts per call).
   *
   * @route GET /list-accounts
   * @operationName List Accounts
   * @category Accounts
   *
   * @appearanceColor #089949 #0BAB57
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"Number","label":"Start Index","name":"from","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Index of the first account to return. Use together with Limit to paginate through results."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many accounts to return at once (maximum 100). Defaults to 10."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":"168000000039001","accountName":"Acme Corp","email":"info@acme.com","phone":"+1 555 0200","website":"https://acme.com","industry":"Software","createdTime":"2026-01-05T08:00:00.000Z"}]
   */
  async listAccounts(from, limit) {
    const response = await this.#apiRequest({
      url: `${ this.#getApiBaseUrl() }/accounts`,
      query: { from, limit },
      logTag: 'listAccounts',
    })

    return response?.data || []
  }

  /**
   * @description Retrieves a single account (company) from Zoho Desk by its ID, including the account's name, contact details, website, industry, and description.
   *
   * @route GET /get-account
   * @operationName Get Account
   * @category Accounts
   *
   * @appearanceColor #089949 #0BAB57
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Account ID","name":"accountId","required":true,"description":"The ID of the account to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":"168000000039001","accountName":"Acme Corp","email":"info@acme.com","phone":"+1 555 0200","website":"https://acme.com","industry":"Software","description":"Enterprise customer since 2024.","createdTime":"2026-01-05T08:00:00.000Z"}
   */
  async getAccount(accountId) {
    return await this.#apiRequest({
      url: `${ this.#getApiBaseUrl() }/accounts/${ accountId }`,
      logTag: 'getAccount',
    })
  }

  /**
   * @description Creates a new account (company) in Zoho Desk. Only the account name is mandatory; contacts can then be associated with the account to group a company's support activity.
   *
   * @route POST /create-account
   * @operationName Create Account
   * @category Accounts
   *
   * @appearanceColor #089949 #0BAB57
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Account Name","name":"accountName","required":true,"description":"Name of the company."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Primary email address of the company."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"Phone number of the company."}
   * @paramDef {"type":"String","label":"Website","name":"website","description":"Website URL of the company."}
   * @paramDef {"type":"String","label":"Industry","name":"industry","description":"Industry the company operates in (e.g. Software, Manufacturing)."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Additional notes about the company."}
   *
   * @returns {Object}
   * @sampleResult {"id":"168000000039001","accountName":"Acme Corp","email":"info@acme.com","phone":"+1 555 0200","website":"https://acme.com","industry":"Software","createdTime":"2026-01-05T08:00:00.000Z"}
   */
  async createAccount(accountName, email, phone, website, industry, description) {
    return await this.#apiRequest({
      url: `${ this.#getApiBaseUrl() }/accounts`,
      method: 'post',
      body: cleanupObject({ accountName, email, phone, website, industry, description }),
      logTag: 'createAccount',
    })
  }

  /**
   * @description Updates an existing account (company) in Zoho Desk. Only the fields you fill in are changed; all other fields keep their current values.
   *
   * @route PATCH /update-account
   * @operationName Update Account
   * @category Accounts
   *
   * @appearanceColor #089949 #0BAB57
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Account ID","name":"accountId","required":true,"description":"The ID of the account to update."}
   * @paramDef {"type":"String","label":"Account Name","name":"accountName","description":"New name for the company."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"New primary email address for the company."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"New phone number for the company."}
   * @paramDef {"type":"String","label":"Website","name":"website","description":"New website URL for the company."}
   * @paramDef {"type":"String","label":"Industry","name":"industry","description":"New industry for the company."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New notes for the company."}
   *
   * @returns {Object}
   * @sampleResult {"id":"168000000039001","accountName":"Acme Corporation","website":"https://acme.com","modifiedTime":"2026-01-15T12:00:00.000Z"}
   */
  async updateAccount(accountId, accountName, email, phone, website, industry, description) {
    const fields = cleanupObject({ accountName, email, phone, website, industry, description })

    if (!fields) {
      throw new Error('Provide at least one field to update.')
    }

    return await this.#apiRequest({
      url: `${ this.#getApiBaseUrl() }/accounts/${ accountId }`,
      method: 'patch',
      body: fields,
      logTag: 'updateAccount',
    })
  }

  // ──────────────────────────────────────────────
  // Agent Methods
  // ──────────────────────────────────────────────

  /**
   * @description Retrieves the agents in your Zoho Desk organization, including each agent's name, email, role, and status. Filter by status to list only active or disabled agents. Supports pagination.
   *
   * @route GET /list-agents
   * @operationName List Agents
   * @category Agents
   *
   * @appearanceColor #089949 #0BAB57
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Active","Disabled"]}},"description":"Only return agents with this status. Leave empty to return all agents."}
   * @paramDef {"type":"Number","label":"Start Index","name":"from","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Index of the first agent to return. Use together with Limit to paginate through results."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many agents to return at once (maximum 100). Defaults to 10."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":"168000000025001","firstName":"John","lastName":"Smith","emailId":"john@acme.com","status":"ACTIVE","roleId":"168000000006005","associatedDepartmentIds":["168000000000097"]}]
   */
  async listAgents(status, from, limit) {
    const response = await this.#apiRequest({
      url: `${ this.#getApiBaseUrl() }/agents`,
      query: {
        status: this.#resolveChoice(status, { 'Active': 'ACTIVE', 'Disabled': 'DISABLED' }),
        from,
        limit,
      },
      logTag: 'listAgents',
    })

    return response?.data || []
  }

  /**
   * @description Retrieves a single agent from Zoho Desk by its ID, including the agent's name, email, role, status, and department associations.
   *
   * @route GET /get-agent
   * @operationName Get Agent
   * @category Agents
   *
   * @appearanceColor #089949 #0BAB57
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Agent","name":"agentId","required":true,"dictionary":"getAgentsDictionary","description":"The agent to retrieve. Pick from the list, or paste an agent ID."}
   *
   * @returns {Object}
   * @sampleResult {"id":"168000000025001","firstName":"John","lastName":"Smith","emailId":"john@acme.com","status":"ACTIVE","roleId":"168000000006005","associatedDepartmentIds":["168000000000097"],"photoURL":"https://desk.zoho.com/agent/photo"}
   */
  async getAgent(agentId) {
    return await this.#apiRequest({
      url: `${ this.#getApiBaseUrl() }/agents/${ agentId }`,
      logTag: 'getAgent',
    })
  }

  /**
   * @description Retrieves the profile of the agent whose Zoho Desk account is connected to this service, including name, email, role, and profile photo. Useful for identifying who the automation acts as.
   *
   * @route GET /get-current-agent
   * @operationName Get Current Agent
   * @category Agents
   *
   * @appearanceColor #089949 #0BAB57
   * @executionTimeoutInSeconds 120
   *
   * @returns {Object}
   * @sampleResult {"id":"168000000025001","firstName":"John","lastName":"Smith","emailId":"john@acme.com","status":"ACTIVE","roleId":"168000000006005","photoURL":"https://desk.zoho.com/agent/photo"}
   */
  async getCurrentAgent() {
    return await this.#apiRequest({
      url: `${ this.#getApiBaseUrl() }/myinfo`,
      logTag: 'getCurrentAgent',
    })
  }

  // ──────────────────────────────────────────────
  // Department Methods
  // ──────────────────────────────────────────────

  /**
   * @description Retrieves the departments in your Zoho Desk organization, including each department's name, description, and enabled state. Departments are the top-level grouping for tickets and support addresses.
   *
   * @route GET /list-departments
   * @operationName List Departments
   * @category Departments
   *
   * @appearanceColor #089949 #0BAB57
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"Boolean","label":"Enabled Only","name":"isEnabled","uiComponent":{"type":"TOGGLE"},"description":"When on, only enabled departments are returned. When off, only disabled departments are returned. Leave unset to return all departments."}
   * @paramDef {"type":"Number","label":"Start Index","name":"from","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Index of the first department to return. Use together with Limit to paginate through results."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many departments to return at once. Defaults to 10."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":"168000000000097","name":"Support","description":"Customer support requests","isEnabled":true,"isDefault":true,"creatorId":"168000000025001"}]
   */
  async listDepartments(isEnabled, from, limit) {
    const response = await this.#apiRequest({
      url: `${ this.#getApiBaseUrl() }/departments`,
      query: { isEnabled, from, limit },
      logTag: 'listDepartments',
    })

    return response?.data || []
  }

  /**
   * @description Retrieves a single department from Zoho Desk by its ID, including the department's name, description, enabled state, and associated agents.
   *
   * @route GET /get-department
   * @operationName Get Department
   * @category Departments
   *
   * @appearanceColor #089949 #0BAB57
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Department","name":"departmentId","required":true,"dictionary":"getDepartmentsDictionary","description":"The department to retrieve. Pick from the list, or paste a department ID."}
   *
   * @returns {Object}
   * @sampleResult {"id":"168000000000097","name":"Support","description":"Customer support requests","isEnabled":true,"isDefault":true,"associatedAgentIds":["168000000025001"],"createdTime":"2026-01-01T00:00:00.000Z"}
   */
  async getDepartment(departmentId) {
    return await this.#apiRequest({
      url: `${ this.#getApiBaseUrl() }/departments/${ departmentId }`,
      logTag: 'getDepartment',
    })
  }

  // ──────────────────────────────────────────────
  // Search Methods
  // ──────────────────────────────────────────────

  /**
   * @description Searches across a Zoho Desk module (tickets, contacts, or accounts) by keyword. The keyword matches the module's searchable fields and supports * as a wildcard. Optionally restrict the search to a single department. Supports pagination.
   *
   * @route GET /global-search
   * @operationName Global Search
   * @category Search
   *
   * @appearanceColor #089949 #0BAB57
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Keyword","name":"searchStr","required":true,"description":"The text to search for. Supports * as a wildcard (e.g. acme* matches Acme Corp and Acme Inc)."}
   * @paramDef {"type":"String","label":"Module","name":"module","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Tickets","Contacts","Accounts"]}},"description":"The type of records to search."}
   * @paramDef {"type":"String","label":"Department","name":"departmentId","dictionary":"getDepartmentsDictionary","description":"Restrict the search to this department."}
   * @paramDef {"type":"Number","label":"Start Index","name":"from","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Index of the first result to return. Use together with Limit to paginate through results."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many results to return at once (maximum 100). Defaults to 10."}
   *
   * @returns {Array<Object>}
   * @sampleResult [{"id":"168000000042001","ticketNumber":"101","subject":"Cannot sign in to the portal","status":"Open","departmentId":"168000000000097","createdTime":"2026-01-15T10:30:00.000Z"}]
   */
  async globalSearch(searchStr, module, departmentId, from, limit) {
    const response = await this.#apiRequest({
      url: `${ this.#getApiBaseUrl() }/search`,
      query: {
        searchStr,
        module: this.#resolveChoice(module, {
          'Tickets': 'tickets',
          'Contacts': 'contacts',
          'Accounts': 'accounts',
        }),
        departmentId,
        from,
        limit,
      },
      logTag: 'globalSearch',
    })

    return response?.data || []
  }
}

Flowrunner.ServerCode.addService(ZohoDeskService, [
  {
    name: 'clientId',
    displayName: 'Client ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'Your Client ID from the Zoho API Console at api-console.zoho.com.',
  },
  {
    name: 'clientSecret',
    displayName: 'Client Secret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'Your Client Secret from the Zoho API Console.',
  },
  {
    name: 'dataCenterDomain',
    displayName: 'Region',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.CHOICE,
    options: ['com', 'eu', 'in', 'com.au', 'jp', 'ca', 'sa'],
    defaultValue: 'com',
    required: true,
    shared: false,
    hint: 'Your Zoho account region: com (US), eu (Europe), in (India), com.au (Australia), jp (Japan), ca (Canada), sa (Saudi Arabia).',
  },
  {
    name: 'orgId',
    displayName: 'Organization ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'Your Zoho Desk organization ID. Leave empty to auto-use your first organization; use the List Organizations action to look up IDs.',
  },
])

/**
 * @typedef {Object} getOrganizationsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Type to search for an organization by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for loading more results."}
 */

/**
 * @typedef {Object} getDepartmentsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Type to search for a department by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for loading more results."}
 */

/**
 * @typedef {Object} getAgentsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Type to search for an agent by name or email."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for loading more results."}
 */

/**
 * @typedef {Object} getContactsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Type to search for a contact by name, or enter an email address for an exact email match."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for loading more results."}
 */
