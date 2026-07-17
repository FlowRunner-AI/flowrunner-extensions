const { randomUUID } = require('crypto')

const OAUTH_BASE_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0'
const API_BASE_URL = 'https://graph.microsoft.com/v1.0'
const PLANNER_BASE_URL = `${ API_BASE_URL }/planner`
const PAGE_SIZE_DICTIONARY = 50

const DEFAULT_SCOPE_LIST = [
  'offline_access',
  'User.Read',
  'User.ReadBasic.All',
  'Tasks.ReadWrite',
  'Group.ReadWrite.All',
]

const DEFAULT_SCOPE_STRING = DEFAULT_SCOPE_LIST.join(' ')

const DEFAULT_ORDER_HINT = ' !'

const PRIORITY_MAPPING = { Urgent: 1, Important: 3, Medium: 5, Low: 9 }

const PREVIEW_TYPE_MAPPING = {
  'Automatic': 'automatic',
  'No Preview': 'noPreview',
  'Checklist': 'checklist',
  'Description': 'description',
  'Reference': 'reference',
}

const logger = {
  info: (...args) => console.log('[Microsoft Planner] info:', ...args),
  debug: (...args) => console.log('[Microsoft Planner] debug:', ...args),
  error: (...args) => console.log('[Microsoft Planner] error:', ...args),
  warn: (...args) => console.log('[Microsoft Planner] warn:', ...args),
}

/**
 * @requireOAuth
 * @integrationName Microsoft Planner
 * @integrationIcon /icon.svg
 **/
class MicrosoftPlannerService {
  /**
   * @typedef {Object} getGroupsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter groups by display name or mail. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination link for retrieving the next page of results."}
   */

  /**
   * @typedef {Object} getPlansDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Group ID","name":"groupId","description":"Optional ID of the Microsoft 365 group whose plans to list. When omitted, all plans shared with the signed-in user are listed."}
   */

  /**
   * @typedef {Object} getPlansDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter plans by title. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination link for retrieving the next page of results."}
   * @paramDef {"type":"getPlansDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"The group whose plans to list."}
   */

  /**
   * @typedef {Object} getBucketsDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Plan ID","name":"planId","required":true,"description":"The ID of the plan whose buckets to list."}
   */

  /**
   * @typedef {Object} getBucketsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter buckets by name. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination link for retrieving the next page of results."}
   * @paramDef {"type":"getBucketsDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"The plan whose buckets to list."}
   */

  /**
   * @typedef {Object} getTasksDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Plan ID","name":"planId","description":"Optional ID of the plan whose tasks to list. When omitted, tasks assigned to the signed-in user are listed."}
   */

  /**
   * @typedef {Object} getTasksDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter tasks by title. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination link for retrieving the next page of results."}
   * @paramDef {"type":"getTasksDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"The plan whose tasks to list."}
   */

  /**
   * @typedef {Object} getUsersDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Group ID","name":"groupId","description":"Optional ID of a Microsoft 365 group. When provided, only members of that group are listed; otherwise users from the whole directory are listed."}
   */

  /**
   * @typedef {Object} getUsersDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter users by display name, mail, or user principal name. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination link for retrieving the next page of results."}
   * @paramDef {"type":"getUsersDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"Optional group whose members to list."}
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

      const wrappedError = new Error(`Microsoft Planner API error: ${ message }`)
      wrappedError.status = error.status || error.statusCode

      throw wrappedError
    }
  }

  async #getEtag(url, logTag) {
    const resource = await this.#apiRequest({ url, logTag: `${ logTag } (fetch etag)` })
    const etag = resource?.['@odata.etag']

    if (!etag) {
      throw new Error('Unable to determine the current version (etag) of the Planner object to modify')
    }

    return etag
  }

  /**
   * Planner requires every PATCH/DELETE to carry an If-Match header with the object's current
   * @odata.etag. This helper fetches the object first to obtain the etag automatically and
   * retries once with a fresh etag if the service reports a version conflict (409/412).
   */
  async #plannerWrite({ url, method, body, logTag }) {
    const attempt = async () => {
      const etag = await this.#getEtag(url, logTag)
      const headers = { 'If-Match': etag }

      if (method === 'patch') {
        headers.Prefer = 'return=representation'
      }

      return this.#apiRequest({ url, method, body, headers, logTag })
    }

    try {
      return await attempt()
    } catch (error) {
      if (error.status === 409 || error.status === 412) {
        logger.warn(`${ logTag } - version conflict detected, retrying with a fresh etag`)

        return attempt()
      }

      throw error
    }
  }

  async #plannerUpdate({ url, body, logTag }) {
    const response = await this.#plannerWrite({ url, method: 'patch', body, logTag })

    return response || this.#apiRequest({ url, logTag: `${ logTag } (fetch updated)` })
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  #resolvePriority(priority) {
    const resolved = this.#resolveChoice(priority, PRIORITY_MAPPING)

    if (resolved === undefined) {
      return undefined
    }

    const numeric = Number(resolved)

    if (Number.isNaN(numeric) || numeric < 0 || numeric > 10) {
      throw new Error('Parameter "Priority" must be Urgent, Important, Medium, Low, or a number between 0 and 10')
    }

    return numeric
  }

  #normalizeDateTime(value) {
    if (!value) {
      return undefined
    }

    const trimmed = String(value).trim()
    const withTime = trimmed.includes('T') ? trimmed : `${ trimmed }T00:00:00`

    return /(Z|[+-]\d{2}:\d{2})$/.test(withTime) ? withTime : `${ withTime }Z`
  }

  #buildAssignments(assigneeIds) {
    if (!assigneeIds || !assigneeIds.length) {
      return undefined
    }

    const assignments = {}

    assigneeIds.forEach(userId => {
      assignments[userId] = {
        '@odata.type': '#microsoft.graph.plannerAssignment',
        orderHint: DEFAULT_ORDER_HINT,
      }
    })

    return assignments
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
   * @operationName Get Groups Dictionary
   * @description Provides a searchable list of the Microsoft 365 groups the signed-in user is a member of, for dynamic parameter selection. Only Microsoft 365 (Unified) groups can contain Planner plans.
   * @route POST /get-groups-dictionary
   * @paramDef {"type":"getGroupsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering groups."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Marketing Team","value":"ebf3b108-5234-4e22-b93d-656d7dae5874","note":"marketing@contoso.com"}],"cursor":null}
   */
  async getGroupsDictionary(payload) {
    const { search, cursor } = payload || {}
    const url = cursor ? cursor : `${ API_BASE_URL }/me/memberOf/microsoft.graph.group`
    const query = cursor ? undefined : {
      $top: 100,
      $select: 'id,displayName,description,mail,groupTypes',
    }

    const response = await this.#apiRequest({
      url,
      query,
      logTag: 'getGroupsDictionary',
    })

    const groups = (response.value || []).filter(group => (group.groupTypes || []).includes('Unified'))
    const filteredGroups = search ? searchFilter(groups, ['displayName', 'mail'], search) : groups

    return {
      cursor: response['@odata.nextLink'] || null,
      items: filteredGroups.map(({ id, displayName, mail, description }) => ({
        label: displayName,
        note: mail || description || `ID: ${ id }`,
        value: id,
      })),
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Plans Dictionary
   * @description Provides a searchable list of Planner plans for dynamic parameter selection. Lists plans of a specific Microsoft 365 group when a group is chosen, or all plans shared with the signed-in user otherwise.
   * @route POST /get-plans-dictionary
   * @paramDef {"type":"getPlansDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string, pagination cursor, and the group criteria whose plans to list."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Product Launch","value":"xqQg5FS2LkCp935s-FIFm2QAFkHM","note":"Group: ebf3b108-5234-4e22-b93d-656d7dae5874"}],"cursor":null}
   */
  async getPlansDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const groupId = criteria?.groupId

    const baseUrl = groupId
      ? `${ API_BASE_URL }/groups/${ groupId }/planner/plans`
      : `${ API_BASE_URL }/me/planner/plans`

    const response = await this.#apiRequest({
      url: cursor ? cursor : baseUrl,
      logTag: 'getPlansDictionary',
    })

    const plans = response.value || []
    const filteredPlans = search ? searchFilter(plans, ['title'], search) : plans

    return {
      cursor: response['@odata.nextLink'] || null,
      items: filteredPlans.map(({ id, title, owner, container }) => ({
        label: title,
        note: `Group: ${ container?.containerId || owner || 'unknown' }`,
        value: id,
      })),
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Buckets Dictionary
   * @description Provides a searchable list of buckets within a selected plan for dynamic parameter selection. Requires a plan to be chosen first.
   * @route POST /get-buckets-dictionary
   * @paramDef {"type":"getBucketsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string, pagination cursor, and the plan criteria whose buckets to list."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"To do","value":"hsOf2dhOJkqyYYZEtdzDe2QAIUCR","note":"ID: hsOf2dhOJkqyYYZEtdzDe2QAIUCR"}],"cursor":null}
   */
  async getBucketsDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const planId = criteria?.planId

    if (!planId) {
      return { items: [], cursor: null }
    }

    const response = await this.#apiRequest({
      url: cursor ? cursor : `${ PLANNER_BASE_URL }/plans/${ planId }/buckets`,
      logTag: 'getBucketsDictionary',
    })

    const buckets = response.value || []
    const filteredBuckets = search ? searchFilter(buckets, ['name'], search) : buckets

    return {
      cursor: response['@odata.nextLink'] || null,
      items: filteredBuckets.map(({ id, name }) => ({
        label: name,
        note: `ID: ${ id }`,
        value: id,
      })),
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Tasks Dictionary
   * @description Provides a searchable list of Planner tasks for dynamic parameter selection. Lists tasks of a specific plan when a plan is chosen, or tasks assigned to the signed-in user otherwise.
   * @route POST /get-tasks-dictionary
   * @paramDef {"type":"getTasksDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string, pagination cursor, and the plan criteria whose tasks to list."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Update client list","value":"01gzSlKkIUSUl6DF_EilrmQAKKQZ","note":"50% complete"}],"cursor":null}
   */
  async getTasksDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const planId = criteria?.planId

    const baseUrl = planId
      ? `${ PLANNER_BASE_URL }/plans/${ planId }/tasks`
      : `${ API_BASE_URL }/me/planner/tasks`

    const response = await this.#apiRequest({
      url: cursor ? cursor : baseUrl,
      logTag: 'getTasksDictionary',
    })

    const tasks = response.value || []
    const filteredTasks = search ? searchFilter(tasks, ['title'], search) : tasks

    return {
      cursor: response['@odata.nextLink'] || null,
      items: filteredTasks.map(({ id, title, percentComplete }) => ({
        label: title,
        note: `${ percentComplete || 0 }% complete`,
        value: id,
      })),
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Users Dictionary
   * @description Provides a searchable list of users for task assignment. Lists members of a specific Microsoft 365 group when a group is chosen, or users from the whole directory otherwise.
   * @route POST /get-users-dictionary
   * @paramDef {"type":"getUsersDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string, pagination cursor, and the optional group criteria whose members to list."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Adele Vance","value":"fbab97d0-4932-4511-b675-204639209557","note":"adelev@contoso.com"}],"cursor":null}
   */
  async getUsersDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const groupId = criteria?.groupId

    const baseUrl = groupId
      ? `${ API_BASE_URL }/groups/${ groupId }/members/microsoft.graph.user`
      : `${ API_BASE_URL }/users`

    const query = cursor ? undefined : {
      $top: PAGE_SIZE_DICTIONARY,
      $select: 'id,displayName,mail,userPrincipalName',
    }

    const response = await this.#apiRequest({
      url: cursor ? cursor : baseUrl,
      query,
      logTag: 'getUsersDictionary',
    })

    const users = response.value || []
    const filteredUsers = search ? searchFilter(users, ['displayName', 'mail', 'userPrincipalName'], search) : users

    return {
      cursor: response['@odata.nextLink'] || null,
      items: filteredUsers.map(({ id, displayName, mail, userPrincipalName }) => ({
        label: displayName || mail || userPrincipalName,
        note: mail || userPrincipalName || `ID: ${ id }`,
        value: id,
      })),
    }
  }

  /**
   * @operationName List Plans
   * @category Plans
   * @appearanceColor #31752F #26591D
   * @description Retrieves all Planner plans owned by a Microsoft 365 group, including each plan's ID, title, owner, container, and creation info.
   * @route GET /list-plans
   * @paramDef {"type":"String","label":"Group","name":"groupId","required":true,"dictionary":"getGroupsDictionary","description":"The Microsoft 365 group whose plans to retrieve. Choose a group or paste a group ID."}
   * @returns {Object}
   * @sampleResult {"value":[{"id":"xqQg5FS2LkCp935s-FIFm2QAFkHM","title":"Product Launch","owner":"ebf3b108-5234-4e22-b93d-656d7dae5874","createdDateTime":"2026-05-30T18:36:49Z","container":{"containerId":"ebf3b108-5234-4e22-b93d-656d7dae5874","type":"group","url":"https://graph.microsoft.com/v1.0/groups/ebf3b108-5234-4e22-b93d-656d7dae5874"}}]}
   */
  async listPlans(groupId) {
    if (!groupId) {
      throw new Error('Parameter "Group" is required')
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/groups/${ groupId }/planner/plans`,
      logTag: 'listPlans',
    })
  }

  /**
   * @operationName Get Plan
   * @category Plans
   * @appearanceColor #31752F #26591D
   * @description Retrieves a single Planner plan by its ID, including its title, owner group, container, and creation info.
   * @route GET /get-plan
   * @paramDef {"type":"String","label":"Plan","name":"planId","required":true,"dictionary":"getPlansDictionary","description":"The plan to retrieve. Choose a plan or paste a plan ID."}
   * @returns {Object}
   * @sampleResult {"id":"xqQg5FS2LkCp935s-FIFm2QAFkHM","title":"Product Launch","owner":"ebf3b108-5234-4e22-b93d-656d7dae5874","createdDateTime":"2026-05-30T18:36:49Z","createdBy":{"user":{"id":"b108ebf3-4e22-b93d-5234-dae5874656d7"}},"container":{"containerId":"ebf3b108-5234-4e22-b93d-656d7dae5874","type":"group","url":"https://graph.microsoft.com/v1.0/groups/ebf3b108-5234-4e22-b93d-656d7dae5874"}}
   */
  async getPlan(planId) {
    if (!planId) {
      throw new Error('Parameter "Plan" is required')
    }

    return this.#apiRequest({
      url: `${ PLANNER_BASE_URL }/plans/${ planId }`,
      logTag: 'getPlan',
    })
  }

  /**
   * @operationName Create Plan
   * @category Plans
   * @appearanceColor #31752F #26591D
   * @description Creates a new Planner plan inside a Microsoft 365 group. The signed-in user must be a member of the group that will contain the plan. A group can own up to 200 plans.
   * @route POST /create-plan
   * @paramDef {"type":"String","label":"Group","name":"groupId","required":true,"dictionary":"getGroupsDictionary","description":"The Microsoft 365 group that will contain the plan. Choose a group or paste a group ID. The signed-in user must be a member of this group."}
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"The title of the new plan."}
   * @returns {Object}
   * @sampleResult {"id":"xqQg5FS2LkCp935s-FIFm2QAFkHM","title":"Product Launch","owner":"ebf3b108-5234-4e22-b93d-656d7dae5874","createdDateTime":"2026-07-17T10:00:00Z","container":{"containerId":"ebf3b108-5234-4e22-b93d-656d7dae5874","type":"group","url":"https://graph.microsoft.com/v1.0/groups/ebf3b108-5234-4e22-b93d-656d7dae5874"}}
   */
  async createPlan(groupId, title) {
    if (!groupId) {
      throw new Error('Parameter "Group" is required')
    }

    if (!title) {
      throw new Error('Parameter "Title" is required')
    }

    return this.#apiRequest({
      url: `${ PLANNER_BASE_URL }/plans`,
      logTag: 'createPlan',
      method: 'post',
      body: {
        container: { url: `${ API_BASE_URL }/groups/${ groupId }` },
        title,
      },
    })
  }

  /**
   * @operationName Update Plan
   * @category Plans
   * @appearanceColor #31752F #26591D
   * @description Renames a Planner plan. The plan's current version (etag) is fetched automatically and sent in the required If-Match header, so no manual etag handling is needed.
   * @route PATCH /update-plan
   * @paramDef {"type":"String","label":"Plan","name":"planId","required":true,"dictionary":"getPlansDictionary","description":"The plan to rename. Choose a plan or paste a plan ID."}
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"The new title for the plan."}
   * @returns {Object}
   * @sampleResult {"id":"xqQg5FS2LkCp935s-FIFm2QAFkHM","title":"Product Launch 2.0","owner":"ebf3b108-5234-4e22-b93d-656d7dae5874","createdDateTime":"2026-05-30T18:36:49Z"}
   */
  async updatePlan(planId, title) {
    if (!planId) {
      throw new Error('Parameter "Plan" is required')
    }

    if (!title) {
      throw new Error('Parameter "Title" is required')
    }

    return this.#plannerUpdate({
      url: `${ PLANNER_BASE_URL }/plans/${ planId }`,
      logTag: 'updatePlan',
      body: { title },
    })
  }

  /**
   * @operationName Delete Plan
   * @category Plans
   * @appearanceColor #31752F #26591D
   * @description Permanently deletes a Planner plan together with all of its buckets and tasks. The plan's current version (etag) is fetched automatically and sent in the required If-Match header.
   * @route DELETE /delete-plan
   * @paramDef {"type":"String","label":"Plan","name":"planId","required":true,"dictionary":"getPlansDictionary","description":"The plan to delete. Choose a plan or paste a plan ID."}
   * @returns {Object}
   * @sampleResult {"message":"Plan deleted successfully"}
   */
  async deletePlan(planId) {
    if (!planId) {
      throw new Error('Parameter "Plan" is required')
    }

    await this.#plannerWrite({
      url: `${ PLANNER_BASE_URL }/plans/${ planId }`,
      logTag: 'deletePlan',
      method: 'delete',
    })

    return { message: 'Plan deleted successfully' }
  }

  /**
   * @operationName Get Plan Details
   * @category Plans
   * @appearanceColor #31752F #26591D
   * @description Retrieves the details object of a plan, including its category (label) descriptions and the collection of users the plan is shared with.
   * @route GET /get-plan-details
   * @paramDef {"type":"String","label":"Plan","name":"planId","required":true,"dictionary":"getPlansDictionary","description":"The plan whose details to retrieve. Choose a plan or paste a plan ID."}
   * @returns {Object}
   * @sampleResult {"id":"xqQg5FS2LkCp935s-FIFm2QAFkHM","sharedWith":{"fbab97d0-4932-4511-b675-204639209557":true},"categoryDescriptions":{"category1":"Design","category2":"Marketing","category3":null}}
   */
  async getPlanDetails(planId) {
    if (!planId) {
      throw new Error('Parameter "Plan" is required')
    }

    return this.#apiRequest({
      url: `${ PLANNER_BASE_URL }/plans/${ planId }/details`,
      logTag: 'getPlanDetails',
    })
  }

  /**
   * @operationName Update Plan Details
   * @category Plans
   * @appearanceColor #31752F #26591D
   * @description Updates a plan's details: category (label) descriptions and/or the collection of users the plan is shared with. Only the provided keys are changed. The details object's current version (etag) is fetched automatically and sent in the required If-Match header.
   * @route PATCH /update-plan-details
   * @paramDef {"type":"String","label":"Plan","name":"planId","required":true,"dictionary":"getPlansDictionary","description":"The plan whose details to update. Choose a plan or paste a plan ID."}
   * @paramDef {"type":"Object","label":"Category Descriptions","name":"categoryDescriptions","description":"Object mapping label keys category1 through category25 to their display names, e.g. {\"category1\":\"Design\",\"category2\":\"Urgent\"}. Set a key to null to clear its name. Only the provided keys are changed."}
   * @paramDef {"type":"Object","label":"Shared With","name":"sharedWith","description":"Object mapping user IDs to true (share) or false (unshare), e.g. {\"fbab97d0-4932-4511-b675-204639209557\":true}. Only the provided user IDs are changed."}
   * @returns {Object}
   * @sampleResult {"id":"xqQg5FS2LkCp935s-FIFm2QAFkHM","sharedWith":{"fbab97d0-4932-4511-b675-204639209557":true},"categoryDescriptions":{"category1":"Design","category2":"Urgent"}}
   */
  async updatePlanDetails(planId, categoryDescriptions, sharedWith) {
    if (!planId) {
      throw new Error('Parameter "Plan" is required')
    }

    const body = cleanupObject({ categoryDescriptions, sharedWith })

    if (!Object.keys(body).length) {
      throw new Error('At least one of "Category Descriptions" or "Shared With" must be provided')
    }

    return this.#plannerUpdate({
      url: `${ PLANNER_BASE_URL }/plans/${ planId }/details`,
      logTag: 'updatePlanDetails',
      body,
    })
  }

  /**
   * @operationName List Buckets
   * @category Buckets
   * @appearanceColor #31752F #26591D
   * @description Retrieves all buckets (board columns) of a plan, including each bucket's ID, name, plan ID, and order hint.
   * @route GET /list-buckets
   * @paramDef {"type":"String","label":"Plan","name":"planId","required":true,"dictionary":"getPlansDictionary","description":"The plan whose buckets to retrieve. Choose a plan or paste a plan ID."}
   * @returns {Object}
   * @sampleResult {"value":[{"id":"hsOf2dhOJkqyYYZEtdzDe2QAIUCR","name":"To do","planId":"xqQg5FS2LkCp935s-FIFm2QAFkHM","orderHint":"85752723360752+"},{"id":"gcrYAaAkgU2EQUvpkNNXLGQAGTtu","name":"In progress","planId":"xqQg5FS2LkCp935s-FIFm2QAFkHM","orderHint":"85752723360753+"}]}
   */
  async listBuckets(planId) {
    if (!planId) {
      throw new Error('Parameter "Plan" is required')
    }

    return this.#apiRequest({
      url: `${ PLANNER_BASE_URL }/plans/${ planId }/buckets`,
      logTag: 'listBuckets',
    })
  }

  /**
   * @operationName Get Bucket
   * @category Buckets
   * @appearanceColor #31752F #26591D
   * @description Retrieves a single bucket by its ID, including its name, plan ID, and order hint.
   * @route GET /get-bucket
   * @paramDef {"type":"String","label":"Plan","name":"planId","dictionary":"getPlansDictionary","description":"Optional. Used only to populate the Bucket picker below; the operation itself only needs the Bucket ID."}
   * @paramDef {"type":"String","label":"Bucket","name":"bucketId","required":true,"dictionary":"getBucketsDictionary","dependsOn":["planId"],"description":"The bucket to retrieve. Choose a plan above to pick from its buckets, or paste a bucket ID."}
   * @returns {Object}
   * @sampleResult {"id":"hsOf2dhOJkqyYYZEtdzDe2QAIUCR","name":"To do","planId":"xqQg5FS2LkCp935s-FIFm2QAFkHM","orderHint":"85752723360752+"}
   */
  async getBucket(planId, bucketId) {
    if (!bucketId) {
      throw new Error('Parameter "Bucket" is required')
    }

    return this.#apiRequest({
      url: `${ PLANNER_BASE_URL }/buckets/${ bucketId }`,
      logTag: 'getBucket',
    })
  }

  /**
   * @operationName Create Bucket
   * @category Buckets
   * @appearanceColor #31752F #26591D
   * @description Creates a new bucket (board column) in a plan. New buckets are placed according to the order hint; the default places the bucket at the end of the board.
   * @route POST /create-bucket
   * @paramDef {"type":"String","label":"Plan","name":"planId","required":true,"dictionary":"getPlansDictionary","description":"The plan in which to create the bucket. Choose a plan or paste a plan ID."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The name of the new bucket."}
   * @paramDef {"type":"String","label":"Order Hint","name":"orderHint","description":"Optional Planner order hint controlling the bucket's position on the board. Defaults to ' !' (end of the board). See Planner order hint format documentation for custom positioning."}
   * @returns {Object}
   * @sampleResult {"id":"hsOf2dhOJkqyYYZEtdzDe2QAIUCR","name":"Backlog","planId":"xqQg5FS2LkCp935s-FIFm2QAFkHM","orderHint":"85752723360752+"}
   */
  async createBucket(planId, name, orderHint) {
    if (!planId) {
      throw new Error('Parameter "Plan" is required')
    }

    if (!name) {
      throw new Error('Parameter "Name" is required')
    }

    return this.#apiRequest({
      url: `${ PLANNER_BASE_URL }/buckets`,
      logTag: 'createBucket',
      method: 'post',
      body: {
        name,
        planId,
        orderHint: orderHint || DEFAULT_ORDER_HINT,
      },
    })
  }

  /**
   * @operationName Update Bucket
   * @category Buckets
   * @appearanceColor #31752F #26591D
   * @description Renames a bucket (board column). The bucket's current version (etag) is fetched automatically and sent in the required If-Match header.
   * @route PATCH /update-bucket
   * @paramDef {"type":"String","label":"Plan","name":"planId","dictionary":"getPlansDictionary","description":"Optional. Used only to populate the Bucket picker below; the operation itself only needs the Bucket ID."}
   * @paramDef {"type":"String","label":"Bucket","name":"bucketId","required":true,"dictionary":"getBucketsDictionary","dependsOn":["planId"],"description":"The bucket to rename. Choose a plan above to pick from its buckets, or paste a bucket ID."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"The new name for the bucket."}
   * @returns {Object}
   * @sampleResult {"id":"hsOf2dhOJkqyYYZEtdzDe2QAIUCR","name":"Ready for review","planId":"xqQg5FS2LkCp935s-FIFm2QAFkHM","orderHint":"85752723360752+"}
   */
  async updateBucket(planId, bucketId, name) {
    if (!bucketId) {
      throw new Error('Parameter "Bucket" is required')
    }

    if (!name) {
      throw new Error('Parameter "Name" is required')
    }

    return this.#plannerUpdate({
      url: `${ PLANNER_BASE_URL }/buckets/${ bucketId }`,
      logTag: 'updateBucket',
      body: { name },
    })
  }

  /**
   * @operationName Delete Bucket
   * @category Buckets
   * @appearanceColor #31752F #26591D
   * @description Permanently deletes a bucket (board column) and all tasks it contains. The bucket's current version (etag) is fetched automatically and sent in the required If-Match header.
   * @route DELETE /delete-bucket
   * @paramDef {"type":"String","label":"Plan","name":"planId","dictionary":"getPlansDictionary","description":"Optional. Used only to populate the Bucket picker below; the operation itself only needs the Bucket ID."}
   * @paramDef {"type":"String","label":"Bucket","name":"bucketId","required":true,"dictionary":"getBucketsDictionary","dependsOn":["planId"],"description":"The bucket to delete. Choose a plan above to pick from its buckets, or paste a bucket ID."}
   * @returns {Object}
   * @sampleResult {"message":"Bucket deleted successfully"}
   */
  async deleteBucket(planId, bucketId) {
    if (!bucketId) {
      throw new Error('Parameter "Bucket" is required')
    }

    await this.#plannerWrite({
      url: `${ PLANNER_BASE_URL }/buckets/${ bucketId }`,
      logTag: 'deleteBucket',
      method: 'delete',
    })

    return { message: 'Bucket deleted successfully' }
  }

  /**
   * @operationName List Plan Tasks
   * @category Tasks
   * @appearanceColor #31752F #26591D
   * @description Retrieves all tasks of a plan, including titles, bucket assignments, progress, priority, dates, and assignees. Large plans are paged; follow the returned @odata.nextLink via the Next Page Link parameter.
   * @route GET /list-plan-tasks
   * @paramDef {"type":"String","label":"Plan","name":"planId","required":true,"dictionary":"getPlansDictionary","description":"The plan whose tasks to retrieve. Choose a plan or paste a plan ID."}
   * @paramDef {"type":"String","label":"Next Page Link","name":"nextLink","description":"URL to retrieve the next page of results. If provided, all other parameters are ignored."}
   * @returns {Object}
   * @sampleResult {"value":[{"id":"01gzSlKkIUSUl6DF_EilrmQAKKQZ","title":"Update client list","planId":"xqQg5FS2LkCp935s-FIFm2QAFkHM","bucketId":"hsOf2dhOJkqyYYZEtdzDe2QAIUCR","percentComplete":50,"priority":5,"dueDateTime":"2026-08-01T00:00:00Z","assignments":{"fbab97d0-4932-4511-b675-204639209557":{"assignedDateTime":"2026-07-10T10:00:00Z","orderHint":"8585074604365493719"}}}]}
   */
  async listPlanTasks(planId, nextLink) {
    if (nextLink) {
      return this.#apiRequest({
        url: nextLink,
        logTag: 'listPlanTasks',
      })
    }

    if (!planId) {
      throw new Error('Parameter "Plan" is required')
    }

    return this.#apiRequest({
      url: `${ PLANNER_BASE_URL }/plans/${ planId }/tasks`,
      logTag: 'listPlanTasks',
    })
  }

  /**
   * @operationName List Bucket Tasks
   * @category Tasks
   * @appearanceColor #31752F #26591D
   * @description Retrieves all tasks of a single bucket (board column), including titles, progress, priority, dates, and assignees. Large buckets are paged; follow the returned @odata.nextLink via the Next Page Link parameter.
   * @route GET /list-bucket-tasks
   * @paramDef {"type":"String","label":"Plan","name":"planId","dictionary":"getPlansDictionary","description":"Optional. Used only to populate the Bucket picker below; the operation itself only needs the Bucket ID."}
   * @paramDef {"type":"String","label":"Bucket","name":"bucketId","required":true,"dictionary":"getBucketsDictionary","dependsOn":["planId"],"description":"The bucket whose tasks to retrieve. Choose a plan above to pick from its buckets, or paste a bucket ID."}
   * @paramDef {"type":"String","label":"Next Page Link","name":"nextLink","description":"URL to retrieve the next page of results. If provided, all other parameters are ignored."}
   * @returns {Object}
   * @sampleResult {"value":[{"id":"01gzSlKkIUSUl6DF_EilrmQAKKQZ","title":"Update client list","planId":"xqQg5FS2LkCp935s-FIFm2QAFkHM","bucketId":"hsOf2dhOJkqyYYZEtdzDe2QAIUCR","percentComplete":0,"priority":9,"dueDateTime":null}]}
   */
  async listBucketTasks(planId, bucketId, nextLink) {
    if (nextLink) {
      return this.#apiRequest({
        url: nextLink,
        logTag: 'listBucketTasks',
      })
    }

    if (!bucketId) {
      throw new Error('Parameter "Bucket" is required')
    }

    return this.#apiRequest({
      url: `${ PLANNER_BASE_URL }/buckets/${ bucketId }/tasks`,
      logTag: 'listBucketTasks',
    })
  }

  /**
   * @operationName List My Tasks
   * @category Tasks
   * @appearanceColor #31752F #26591D
   * @description Retrieves all Planner tasks assigned to the signed-in user across all plans. Large result sets are paged; follow the returned @odata.nextLink via the Next Page Link parameter.
   * @route GET /list-my-tasks
   * @paramDef {"type":"String","label":"Next Page Link","name":"nextLink","description":"URL to retrieve the next page of results. If provided, all other parameters are ignored."}
   * @returns {Object}
   * @sampleResult {"value":[{"id":"01gzSlKkIUSUl6DF_EilrmQAKKQZ","title":"Update client list","planId":"xqQg5FS2LkCp935s-FIFm2QAFkHM","bucketId":"hsOf2dhOJkqyYYZEtdzDe2QAIUCR","percentComplete":50,"priority":3,"dueDateTime":"2026-08-01T00:00:00Z"}]}
   */
  async listMyTasks(nextLink) {
    return this.#apiRequest({
      url: nextLink || `${ API_BASE_URL }/me/planner/tasks`,
      logTag: 'listMyTasks',
    })
  }

  /**
   * @operationName Get Task
   * @category Tasks
   * @appearanceColor #31752F #26591D
   * @description Retrieves a single Planner task by its ID, including its title, plan, bucket, progress, priority, dates, assignments, and applied category labels.
   * @route GET /get-task
   * @paramDef {"type":"String","label":"Plan","name":"planId","dictionary":"getPlansDictionary","description":"Optional. Used only to populate the Task picker below; the operation itself only needs the Task ID."}
   * @paramDef {"type":"String","label":"Task","name":"taskId","required":true,"dictionary":"getTasksDictionary","dependsOn":["planId"],"description":"The task to retrieve. Choose a plan above to pick from its tasks, or paste a task ID."}
   * @returns {Object}
   * @sampleResult {"id":"01gzSlKkIUSUl6DF_EilrmQAKKQZ","title":"Update client list","planId":"xqQg5FS2LkCp935s-FIFm2QAFkHM","bucketId":"hsOf2dhOJkqyYYZEtdzDe2QAIUCR","percentComplete":50,"priority":5,"startDateTime":"2026-07-01T00:00:00Z","dueDateTime":"2026-08-01T00:00:00Z","appliedCategories":{"category1":true},"assignments":{"fbab97d0-4932-4511-b675-204639209557":{"assignedDateTime":"2026-07-10T10:00:00Z","orderHint":"8585074604365493719"}},"createdDateTime":"2026-07-01T09:00:00Z"}
   */
  async getTask(planId, taskId) {
    if (!taskId) {
      throw new Error('Parameter "Task" is required')
    }

    return this.#apiRequest({
      url: `${ PLANNER_BASE_URL }/tasks/${ taskId }`,
      logTag: 'getTask',
    })
  }

  /**
   * @operationName Create Task
   * @category Tasks
   * @appearanceColor #31752F #26591D
   * @description Creates a new task in a plan, optionally placed in a specific bucket and assigned to one or more users. Supports start and due dates, priority (Urgent, Important, Medium, Low), completion percentage, and applied category labels.
   * @route POST /create-task
   * @paramDef {"type":"String","label":"Plan","name":"planId","required":true,"dictionary":"getPlansDictionary","description":"The plan in which to create the task. Choose a plan or paste a plan ID."}
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"The title of the task."}
   * @paramDef {"type":"String","label":"Bucket","name":"bucketId","dictionary":"getBucketsDictionary","dependsOn":["planId"],"description":"Optional bucket (board column) to place the task in. Must belong to the selected plan. Choose a bucket or paste a bucket ID."}
   * @paramDef {"type":"Array<String>","label":"Assignee User IDs","name":"assigneeIds","description":"Optional list of user IDs (GUIDs) to assign the task to, e.g. [\"fbab97d0-4932-4511-b675-204639209557\"]. Use the Assign User To Task action or the users dictionary to look up IDs."}
   * @paramDef {"type":"String","label":"Due Date","name":"dueDateTime","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Optional date (YYYY-MM-DD) or ISO 8601 date-time when the task is due. Interpreted as UTC when no time zone offset is given."}
   * @paramDef {"type":"String","label":"Start Date","name":"startDateTime","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Optional date (YYYY-MM-DD) or ISO 8601 date-time when work on the task starts. Interpreted as UTC when no time zone offset is given."}
   * @paramDef {"type":"String","label":"Priority","name":"priority","uiComponent":{"type":"DROPDOWN","options":{"values":["Urgent","Important","Medium","Low"]}},"description":"Optional priority of the task. Maps to Planner priority values 1 (Urgent), 3 (Important), 5 (Medium), and 9 (Low)."}
   * @paramDef {"type":"Number","label":"Percent Complete","name":"percentComplete","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Optional completion percentage between 0 and 100. 0 = not started, 1-99 = in progress, 100 = completed."}
   * @paramDef {"type":"Object","label":"Applied Categories","name":"appliedCategories","description":"Optional object applying category labels to the task, mapping keys category1 through category25 to true, e.g. {\"category1\":true,\"category3\":true}. Label display names are defined per plan via Update Plan Details."}
   * @returns {Object}
   * @sampleResult {"id":"01gzSlKkIUSUl6DF_EilrmQAKKQZ","title":"Update client list","planId":"xqQg5FS2LkCp935s-FIFm2QAFkHM","bucketId":"hsOf2dhOJkqyYYZEtdzDe2QAIUCR","percentComplete":0,"priority":5,"dueDateTime":"2026-08-01T00:00:00Z","assignments":{"fbab97d0-4932-4511-b675-204639209557":{"@odata.type":"#microsoft.graph.plannerAssignment","orderHint":"8585074604365493719"}},"createdDateTime":"2026-07-17T10:00:00Z"}
   */
  async createTask(planId, title, bucketId, assigneeIds, dueDateTime, startDateTime, priority, percentComplete, appliedCategories) {
    if (!planId) {
      throw new Error('Parameter "Plan" is required')
    }

    if (!title) {
      throw new Error('Parameter "Title" is required')
    }

    const body = cleanupObject({
      planId,
      title,
      bucketId,
      assignments: this.#buildAssignments(assigneeIds),
      dueDateTime: this.#normalizeDateTime(dueDateTime),
      startDateTime: this.#normalizeDateTime(startDateTime),
      priority: this.#resolvePriority(priority),
      percentComplete,
      appliedCategories,
    })

    return this.#apiRequest({
      url: `${ PLANNER_BASE_URL }/tasks`,
      logTag: 'createTask',
      method: 'post',
      body,
    })
  }

  /**
   * @operationName Update Task
   * @category Tasks
   * @appearanceColor #31752F #26591D
   * @description Updates one or more properties of an existing task: title, bucket, dates, priority, completion percentage, applied category labels, or assignments. Only the provided fields are changed. The task's current version (etag) is fetched automatically and sent in the required If-Match header. Set Percent Complete to 100 to mark the task completed.
   * @route PATCH /update-task
   * @paramDef {"type":"String","label":"Plan","name":"planId","dictionary":"getPlansDictionary","description":"Optional. Used only to populate the Task and Bucket pickers below; the operation itself only needs the Task ID."}
   * @paramDef {"type":"String","label":"Task","name":"taskId","required":true,"dictionary":"getTasksDictionary","dependsOn":["planId"],"description":"The task to update. Choose a plan above to pick from its tasks, or paste a task ID."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"A new title for the task."}
   * @paramDef {"type":"String","label":"Bucket","name":"bucketId","dictionary":"getBucketsDictionary","dependsOn":["planId"],"description":"A new bucket (board column) for the task. Must belong to the task's plan. Choose a bucket or paste a bucket ID."}
   * @paramDef {"type":"String","label":"Due Date","name":"dueDateTime","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"A new date (YYYY-MM-DD) or ISO 8601 date-time when the task is due. Interpreted as UTC when no time zone offset is given."}
   * @paramDef {"type":"String","label":"Start Date","name":"startDateTime","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"A new date (YYYY-MM-DD) or ISO 8601 date-time when work on the task starts. Interpreted as UTC when no time zone offset is given."}
   * @paramDef {"type":"String","label":"Priority","name":"priority","uiComponent":{"type":"DROPDOWN","options":{"values":["Urgent","Important","Medium","Low"]}},"description":"A new priority for the task. Maps to Planner priority values 1 (Urgent), 3 (Important), 5 (Medium), and 9 (Low)."}
   * @paramDef {"type":"Number","label":"Percent Complete","name":"percentComplete","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"A new completion percentage between 0 and 100. 0 = not started, 1-99 = in progress, 100 = completed."}
   * @paramDef {"type":"Object","label":"Applied Categories","name":"appliedCategories","description":"Object changing category labels on the task, mapping keys category1 through category25 to true (apply) or false (remove), e.g. {\"category1\":true,\"category3\":false}. Only the provided keys are changed."}
   * @paramDef {"type":"Object","label":"Assignments","name":"assignments","description":"Advanced. Object keyed by user ID; map a user ID to {\"@odata.type\":\"#microsoft.graph.plannerAssignment\",\"orderHint\":\" !\"} to assign or to null to unassign. Prefer the dedicated Assign User To Task and Unassign User From Task actions."}
   * @returns {Object}
   * @sampleResult {"id":"01gzSlKkIUSUl6DF_EilrmQAKKQZ","title":"Update client list v2","planId":"xqQg5FS2LkCp935s-FIFm2QAFkHM","bucketId":"gcrYAaAkgU2EQUvpkNNXLGQAGTtu","percentComplete":100,"priority":1,"completedDateTime":"2026-07-17T12:00:00Z"}
   */
  async updateTask(planId, taskId, title, bucketId, dueDateTime, startDateTime, priority, percentComplete, appliedCategories, assignments) {
    if (!taskId) {
      throw new Error('Parameter "Task" is required')
    }

    const body = cleanupObject({
      title,
      bucketId,
      dueDateTime: this.#normalizeDateTime(dueDateTime),
      startDateTime: this.#normalizeDateTime(startDateTime),
      priority: this.#resolvePriority(priority),
      percentComplete,
      appliedCategories,
      assignments,
    })

    if (!Object.keys(body).length) {
      throw new Error('At least one field to update must be provided')
    }

    return this.#plannerUpdate({
      url: `${ PLANNER_BASE_URL }/tasks/${ taskId }`,
      logTag: 'updateTask',
      body,
    })
  }

  /**
   * @operationName Delete Task
   * @category Tasks
   * @appearanceColor #31752F #26591D
   * @description Permanently deletes a Planner task, including its checklist items and attachments (references). The task's current version (etag) is fetched automatically and sent in the required If-Match header.
   * @route DELETE /delete-task
   * @paramDef {"type":"String","label":"Plan","name":"planId","dictionary":"getPlansDictionary","description":"Optional. Used only to populate the Task picker below; the operation itself only needs the Task ID."}
   * @paramDef {"type":"String","label":"Task","name":"taskId","required":true,"dictionary":"getTasksDictionary","dependsOn":["planId"],"description":"The task to delete. Choose a plan above to pick from its tasks, or paste a task ID."}
   * @returns {Object}
   * @sampleResult {"message":"Task deleted successfully"}
   */
  async deleteTask(planId, taskId) {
    if (!taskId) {
      throw new Error('Parameter "Task" is required')
    }

    await this.#plannerWrite({
      url: `${ PLANNER_BASE_URL }/tasks/${ taskId }`,
      logTag: 'deleteTask',
      method: 'delete',
    })

    return { message: 'Task deleted successfully' }
  }

  /**
   * @operationName Get Task Details
   * @category Task Details
   * @appearanceColor #31752F #26591D
   * @description Retrieves the details object of a task, including its description, preview type, checklist items with their GUIDs, and external references (attachments).
   * @route GET /get-task-details
   * @paramDef {"type":"String","label":"Plan","name":"planId","dictionary":"getPlansDictionary","description":"Optional. Used only to populate the Task picker below; the operation itself only needs the Task ID."}
   * @paramDef {"type":"String","label":"Task","name":"taskId","required":true,"dictionary":"getTasksDictionary","dependsOn":["planId"],"description":"The task whose details to retrieve. Choose a plan above to pick from its tasks, or paste a task ID."}
   * @returns {Object}
   * @sampleResult {"id":"01gzSlKkIUSUl6DF_EilrmQAKKQZ","description":"Refresh the client list before the campaign","previewType":"checklist","checklist":{"95e27074-6c4a-447a-aa24-9d718a0b86fa":{"isChecked":false,"title":"Export current list","orderHint":"8587094707721254251P]"}},"references":{"https%3A//contoso%2Esharepoint%2Ecom/doc%2Exlsx":{"alias":"Client list","type":"Excel","previewPriority":"8599273"}}}
   */
  async getTaskDetails(planId, taskId) {
    if (!taskId) {
      throw new Error('Parameter "Task" is required')
    }

    return this.#apiRequest({
      url: `${ PLANNER_BASE_URL }/tasks/${ taskId }/details`,
      logTag: 'getTaskDetails',
    })
  }

  /**
   * @operationName Update Task Details
   * @category Task Details
   * @appearanceColor #31752F #26591D
   * @description Updates a task's details: description, preview type, checklist items, and/or external references (attachments). Only the provided fields are changed. The details object's current version (etag) is fetched automatically and sent in the required If-Match header. For simple checklist management, prefer the dedicated Add Checklist Items, Update Checklist Item, and Delete Checklist Item actions.
   * @route PATCH /update-task-details
   * @paramDef {"type":"String","label":"Plan","name":"planId","dictionary":"getPlansDictionary","description":"Optional. Used only to populate the Task picker below; the operation itself only needs the Task ID."}
   * @paramDef {"type":"String","label":"Task","name":"taskId","required":true,"dictionary":"getTasksDictionary","dependsOn":["planId"],"description":"The task whose details to update. Choose a plan above to pick from its tasks, or paste a task ID."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"A new plain-text description (notes) for the task."}
   * @paramDef {"type":"String","label":"Preview Type","name":"previewType","uiComponent":{"type":"DROPDOWN","options":{"values":["Automatic","No Preview","Checklist","Description","Reference"]}},"description":"The type of preview shown on the task card. Automatic lets the Planner app choose."}
   * @paramDef {"type":"Object","label":"Checklist","name":"checklist","description":"Advanced. Object keyed by checklist item GUID; map a GUID to {\"@odata.type\":\"microsoft.graph.plannerChecklistItem\",\"title\":\"...\",\"isChecked\":false} to add or update an item, or to null to delete it. Only the provided GUIDs are changed."}
   * @paramDef {"type":"Object","label":"References","name":"references","description":"Advanced. Object keyed by percent-encoded URL ('.' encoded as %2E, ':' as %3A); map a URL to {\"@odata.type\":\"microsoft.graph.plannerExternalReference\",\"alias\":\"Docs\",\"type\":\"Other\",\"previewPriority\":\" !\"} to add an attachment, or to null to remove it."}
   * @returns {Object}
   * @sampleResult {"id":"01gzSlKkIUSUl6DF_EilrmQAKKQZ","description":"Refresh the client list before the campaign","previewType":"description","checklist":{"95e27074-6c4a-447a-aa24-9d718a0b86fa":{"isChecked":false,"title":"Export current list"}},"references":{}}
   */
  async updateTaskDetails(planId, taskId, description, previewType, checklist, references) {
    if (!taskId) {
      throw new Error('Parameter "Task" is required')
    }

    const body = cleanupObject({
      description,
      previewType: this.#resolveChoice(previewType, PREVIEW_TYPE_MAPPING),
      checklist,
      references,
    })

    if (!Object.keys(body).length) {
      throw new Error('At least one field to update must be provided')
    }

    return this.#plannerUpdate({
      url: `${ PLANNER_BASE_URL }/tasks/${ taskId }/details`,
      logTag: 'updateTaskDetails',
      body,
    })
  }

  /**
   * @operationName Add Checklist Items
   * @category Task Details
   * @appearanceColor #31752F #26591D
   * @description Adds one or more checklist items (subtasks) to a task from a simple list of titles. Item GUIDs are generated automatically and the items are created unchecked. The details object's current version (etag) is fetched automatically and sent in the required If-Match header.
   * @route PATCH /add-checklist-items
   * @paramDef {"type":"String","label":"Plan","name":"planId","dictionary":"getPlansDictionary","description":"Optional. Used only to populate the Task picker below; the operation itself only needs the Task ID."}
   * @paramDef {"type":"String","label":"Task","name":"taskId","required":true,"dictionary":"getTasksDictionary","dependsOn":["planId"],"description":"The task to add checklist items to. Choose a plan above to pick from its tasks, or paste a task ID."}
   * @paramDef {"type":"Array<String>","label":"Item Titles","name":"itemTitles","required":true,"description":"List of checklist item titles to add, e.g. [\"Export current list\",\"Verify addresses\"]. A task can hold up to 20 checklist items."}
   * @returns {Object}
   * @sampleResult {"id":"01gzSlKkIUSUl6DF_EilrmQAKKQZ","description":"Refresh the client list","previewType":"checklist","checklist":{"95e27074-6c4a-447a-aa24-9d718a0b86fa":{"isChecked":false,"title":"Export current list"},"d280ed1a-9f6b-4f9c-a962-fb4d00dc50ff":{"isChecked":false,"title":"Verify addresses"}}}
   */
  async addChecklistItems(planId, taskId, itemTitles) {
    if (!taskId) {
      throw new Error('Parameter "Task" is required')
    }

    if (!itemTitles || !itemTitles.length) {
      throw new Error('Parameter "Item Titles" is required')
    }

    const checklist = {}

    itemTitles.forEach(title => {
      checklist[randomUUID()] = {
        '@odata.type': 'microsoft.graph.plannerChecklistItem',
        title: String(title),
        isChecked: false,
      }
    })

    return this.#plannerUpdate({
      url: `${ PLANNER_BASE_URL }/tasks/${ taskId }/details`,
      logTag: 'addChecklistItems',
      body: { checklist },
    })
  }

  /**
   * @operationName Update Checklist Item
   * @category Task Details
   * @appearanceColor #31752F #26591D
   * @description Updates a single checklist item (subtask) of a task: check or uncheck it and/or change its title. The details object's current version (etag) is fetched automatically and sent in the required If-Match header.
   * @route PATCH /update-checklist-item
   * @paramDef {"type":"String","label":"Plan","name":"planId","dictionary":"getPlansDictionary","description":"Optional. Used only to populate the Task picker below; the operation itself only needs the Task ID."}
   * @paramDef {"type":"String","label":"Task","name":"taskId","required":true,"dictionary":"getTasksDictionary","dependsOn":["planId"],"description":"The task that contains the checklist item. Choose a plan above to pick from its tasks, or paste a task ID."}
   * @paramDef {"type":"String","label":"Checklist Item ID","name":"checklistItemId","required":true,"description":"The GUID of the checklist item to update. Use Get Task Details to find checklist item GUIDs."}
   * @paramDef {"type":"String","label":"New Title","name":"title","description":"A new title for the checklist item."}
   * @paramDef {"type":"Boolean","label":"Checked","name":"isChecked","uiComponent":{"type":"TOGGLE"},"description":"Whether the checklist item is checked (completed). Leave empty to keep the current state."}
   * @returns {Object}
   * @sampleResult {"id":"01gzSlKkIUSUl6DF_EilrmQAKKQZ","previewType":"checklist","checklist":{"95e27074-6c4a-447a-aa24-9d718a0b86fa":{"isChecked":true,"title":"Export current list"}}}
   */
  async updateChecklistItem(planId, taskId, checklistItemId, title, isChecked) {
    if (!taskId) {
      throw new Error('Parameter "Task" is required')
    }

    if (!checklistItemId) {
      throw new Error('Parameter "Checklist Item ID" is required')
    }

    const itemChanges = cleanupObject({ title, isChecked })

    if (!Object.keys(itemChanges).length) {
      throw new Error('At least one of "New Title" or "Checked" must be provided')
    }

    return this.#plannerUpdate({
      url: `${ PLANNER_BASE_URL }/tasks/${ taskId }/details`,
      logTag: 'updateChecklistItem',
      body: {
        checklist: {
          [checklistItemId]: {
            '@odata.type': 'microsoft.graph.plannerChecklistItem',
            ...itemChanges,
          },
        },
      },
    })
  }

  /**
   * @operationName Delete Checklist Item
   * @category Task Details
   * @appearanceColor #31752F #26591D
   * @description Permanently deletes a single checklist item (subtask) from a task. The details object's current version (etag) is fetched automatically and sent in the required If-Match header.
   * @route DELETE /delete-checklist-item
   * @paramDef {"type":"String","label":"Plan","name":"planId","dictionary":"getPlansDictionary","description":"Optional. Used only to populate the Task picker below; the operation itself only needs the Task ID."}
   * @paramDef {"type":"String","label":"Task","name":"taskId","required":true,"dictionary":"getTasksDictionary","dependsOn":["planId"],"description":"The task that contains the checklist item. Choose a plan above to pick from its tasks, or paste a task ID."}
   * @paramDef {"type":"String","label":"Checklist Item ID","name":"checklistItemId","required":true,"description":"The GUID of the checklist item to delete. Use Get Task Details to find checklist item GUIDs."}
   * @returns {Object}
   * @sampleResult {"message":"Checklist item deleted successfully"}
   */
  async deleteChecklistItem(planId, taskId, checklistItemId) {
    if (!taskId) {
      throw new Error('Parameter "Task" is required')
    }

    if (!checklistItemId) {
      throw new Error('Parameter "Checklist Item ID" is required')
    }

    await this.#plannerUpdate({
      url: `${ PLANNER_BASE_URL }/tasks/${ taskId }/details`,
      logTag: 'deleteChecklistItem',
      body: {
        checklist: {
          [checklistItemId]: null,
        },
      },
    })

    return { message: 'Checklist item deleted successfully' }
  }

  /**
   * @operationName Assign User To Task
   * @category Assignments
   * @appearanceColor #31752F #26591D
   * @description Assigns a user to a Planner task. The user must have access to the plan (typically a member of the plan's group). Existing assignees are kept; a task can have up to 20 assignees. The task's current version (etag) is fetched automatically and sent in the required If-Match header.
   * @route PATCH /assign-user-to-task
   * @paramDef {"type":"String","label":"Plan","name":"planId","dictionary":"getPlansDictionary","description":"Optional. Used only to populate the Task picker below; the operation itself only needs the Task ID."}
   * @paramDef {"type":"String","label":"Task","name":"taskId","required":true,"dictionary":"getTasksDictionary","dependsOn":["planId"],"description":"The task to assign the user to. Choose a plan above to pick from its tasks, or paste a task ID."}
   * @paramDef {"type":"String","label":"User","name":"userId","required":true,"dictionary":"getUsersDictionary","description":"The user to assign. Choose a user or paste a user ID (GUID)."}
   * @returns {Object}
   * @sampleResult {"id":"01gzSlKkIUSUl6DF_EilrmQAKKQZ","title":"Update client list","assignments":{"fbab97d0-4932-4511-b675-204639209557":{"assignedDateTime":"2026-07-17T10:00:00Z","orderHint":"8585074604365493719"}}}
   */
  async assignUserToTask(planId, taskId, userId) {
    if (!taskId) {
      throw new Error('Parameter "Task" is required')
    }

    if (!userId) {
      throw new Error('Parameter "User" is required')
    }

    return this.#plannerUpdate({
      url: `${ PLANNER_BASE_URL }/tasks/${ taskId }`,
      logTag: 'assignUserToTask',
      body: {
        assignments: this.#buildAssignments([userId]),
      },
    })
  }

  /**
   * @operationName Unassign User From Task
   * @category Assignments
   * @appearanceColor #31752F #26591D
   * @description Removes a user from a Planner task's assignees. Other assignees are kept. The task's current version (etag) is fetched automatically and sent in the required If-Match header.
   * @route PATCH /unassign-user-from-task
   * @paramDef {"type":"String","label":"Plan","name":"planId","dictionary":"getPlansDictionary","description":"Optional. Used only to populate the Task picker below; the operation itself only needs the Task ID."}
   * @paramDef {"type":"String","label":"Task","name":"taskId","required":true,"dictionary":"getTasksDictionary","dependsOn":["planId"],"description":"The task to remove the user from. Choose a plan above to pick from its tasks, or paste a task ID."}
   * @paramDef {"type":"String","label":"User","name":"userId","required":true,"dictionary":"getUsersDictionary","description":"The user to unassign. Choose a user or paste a user ID (GUID)."}
   * @returns {Object}
   * @sampleResult {"id":"01gzSlKkIUSUl6DF_EilrmQAKKQZ","title":"Update client list","assignments":{}}
   */
  async unassignUserFromTask(planId, taskId, userId) {
    if (!taskId) {
      throw new Error('Parameter "Task" is required')
    }

    if (!userId) {
      throw new Error('Parameter "User" is required')
    }

    return this.#plannerUpdate({
      url: `${ PLANNER_BASE_URL }/tasks/${ taskId }`,
      logTag: 'unassignUserFromTask',
      body: {
        assignments: {
          [userId]: null,
        },
      },
    })
  }
}

Flowrunner.ServerCode.addService(MicrosoftPlannerService, [
  {
    name: 'clientId',
    displayName: 'Client ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'OAuth2 Client ID (Application ID) of your Microsoft Entra app registration.',
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

function constructIdentityName(user) {
  const email = user.mail || user.userPrincipalName

  if (email && user.displayName) {
    return `${ email } (${ user.displayName })`
  }

  return email || user.displayName || 'Microsoft Planner Connection'
}
