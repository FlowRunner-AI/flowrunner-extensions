'use strict'

const logger = {
  info: (...args) => console.log('[Azure DevOps] info:', ...args),
  debug: (...args) => console.log('[Azure DevOps] debug:', ...args),
  error: (...args) => console.log('[Azure DevOps] error:', ...args),
  warn: (...args) => console.log('[Azure DevOps] warn:', ...args),
}

// Core services (projects, work items, git, build, pipelines) live on dev.azure.com.
const CORE_HOST = 'https://dev.azure.com'

// Stable API version for the core REST surface. Comment endpoints use a preview flavor.
const API_VERSION = '7.1'
const COMMENTS_API_VERSION = '7.1-preview.4'

// Azure DevOps work item types selectable in the UI, mapped to the exact type name the
// API expects in the ${type} URL segment (e.g. "User Story").
const WORK_ITEM_TYPES = {
  Bug: 'Bug',
  Task: 'Task',
  'User Story': 'User Story',
  Feature: 'Feature',
  Epic: 'Epic',
  Issue: 'Issue',
}

// Pull request status filter labels mapped to the API enum values.
const PR_STATUS = {
  Active: 'active',
  Completed: 'completed',
  Abandoned: 'abandoned',
  All: 'all',
}

// Pull request completion/abandon states (used when updating a PR).
const PR_UPDATE_STATUS = {
  Completed: 'completed',
  Abandoned: 'abandoned',
  Active: 'active',
}

// Build status/result filters.
const BUILD_STATUS = {
  'In Progress': 'inProgress',
  Completed: 'completed',
  Cancelling: 'cancelling',
  Postponed: 'postponed',
  'Not Started': 'notStarted',
  All: 'all',
}

const BUILD_RESULT = {
  Succeeded: 'succeeded',
  'Partially Succeeded': 'partiallySucceeded',
  Failed: 'failed',
  Canceled: 'canceled',
}

/**
 * Removes undefined, null and empty-string properties so they are not sent as query
 * parameters or request-body fields.
 */
function clean(obj) {
  if (!obj || typeof obj !== 'object') {
    return obj
  }

  const result = {}

  for (const key in obj) {
    const value = obj[key]

    if (value !== undefined && value !== null && value !== '') {
      result[key] = value
    }
  }

  return result
}

/**
 * @integrationName Azure DevOps
 * @integrationIcon /icon.svg
 * @description Connects to Azure DevOps Services to manage projects, teams, work items, WIQL queries, Git repositories, pull requests, pipelines, builds and team iterations. Authenticates with a Personal Access Token over HTTP Basic auth against a single organization.
 */
class AzureDevOps {
  constructor(config) {
    this.config = config || {}
    this.organization = (this.config.organization || '').trim()
    this.pat = this.config.pat || ''
  }

  // Basic auth with an empty username and the PAT as the password: base64(":{pat}").
  #authHeader() {
    const encoded = Buffer.from(`:${ this.pat }`).toString('base64')

    return { Authorization: `Basic ${ encoded }` }
  }

  // Base URL for the organization on the core host.
  #orgBase() {
    return `${ CORE_HOST }/${ encodeURIComponent(this.organization) }`
  }

  #handleError(error, logTag) {
    // Azure DevOps error payloads are shaped { message, typeKey, ... } on error.body.
    const bodyMessage = typeof error?.body?.message === 'string' ? error.body.message : null
    const errMessage = typeof error?.message === 'string' ? error.message : null

    let message = bodyMessage || errMessage || 'request failed'

    if (error?.status) {
      message = `${ message } (HTTP ${ error.status })`
    }

    logger.error(`${ logTag } - failed: ${ message }`)

    const wrapped = new Error(`Azure DevOps API error: ${ message }`)

    wrapped.status = error?.status

    throw wrapped
  }

  /**
   * Single request helper. All external calls flow through here.
   * - `apiVersion` is appended as the `api-version` query parameter (default 7.1).
   * - `contentType` overrides the request Content-Type (e.g. application/json-patch+json).
   * - When `raw` is true, the full response object ({ headers, body, status }) is returned
   *   so callers can read the `x-ms-continuationtoken` pagination header.
   */
  async #apiRequest({ url, method = 'get', body, query, contentType = 'application/json', apiVersion = API_VERSION, raw = false, logTag = '#apiRequest' }) {
    if (!this.organization) {
      throw new Error('Azure DevOps API error: organization is not configured.')
    }

    if (!this.pat) {
      throw new Error('Azure DevOps API error: personal access token (PAT) is not configured.')
    }

    try {
      const fullQuery = clean({ ...(query || {}), 'api-version': apiVersion })

      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=${ JSON.stringify(fullQuery) }`)

      let request = Flowrunner.Request[method.toLowerCase()](url)
        .set(this.#authHeader())
        .set({ 'Content-Type': contentType, Accept: 'application/json' })
        .query(fullQuery)

      if (raw) {
        request = request.unwrapBody(false)
      }

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      this.#handleError(error, logTag)
    }
  }

  /**
   * Executes a list request that supports Azure DevOps continuation-token paging.
   * Reads the `x-ms-continuationtoken` response header and returns the unwrapped
   * `{ count, value }` body plus the next continuation token (if any).
   */
  async #listRequest({ url, query, top, continuationToken, apiVersion = API_VERSION, logTag }) {
    const response = await this.#apiRequest({
      url,
      query: clean({ ...(query || {}), $top: top, continuationToken }),
      apiVersion,
      raw: true,
      logTag,
    })

    const headers = response?.headers || {}
    const nextToken = headers['x-ms-continuationtoken'] || headers['X-MS-ContinuationToken'] || null
    const payload = response?.body || {}

    return {
      items: Array.isArray(payload.value) ? payload.value : [],
      count: typeof payload.count === 'number' ? payload.count : (Array.isArray(payload.value) ? payload.value.length : 0),
      continuationToken: nextToken,
    }
  }

  // Maps a friendly dropdown label to its API value; passes through unknown values.
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // ------------------------------------------------------------------
  // Projects
  // ------------------------------------------------------------------

  /**
   * @operationName List Projects
   * @category Projects
   * @description Lists all team projects in the connected Azure DevOps organization that the token can access. Supports paging via a continuation token and an optional state filter. Returns each project's id, name, description, state, visibility and last update time.
   * @route GET /projects
   * @appearanceColor #0078D7 #2B88D8
   *
   * @paramDef {"type":"String","label":"State Filter","name":"stateFilter","uiComponent":{"type":"DROPDOWN","options":{"values":["All","Well Formed","Creating","Deleting","New"]}},"description":"Filter projects by lifecycle state. Defaults to Well Formed (active projects)."}
   * @paramDef {"type":"Number","label":"Top","name":"top","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of projects to return in this page (1-1000)."}
   * @paramDef {"type":"String","label":"Continuation Token","name":"continuationToken","description":"Continuation token returned by a previous call to fetch the next page."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"eb6e4656-77fc-42a1-9181-4c6d8e9da5d1","name":"Fabrikam","description":"Sample project","state":"wellFormed","visibility":"private","lastUpdateTime":"2024-05-01T12:00:00Z"}],"count":1,"continuationToken":null}
   */
  async listProjects(stateFilter, top, continuationToken) {
    const state = this.#resolveChoice(stateFilter, {
      All: 'all',
      'Well Formed': 'wellFormed',
      Creating: 'createPending',
      Deleting: 'deleting',
      New: 'new',
    })

    return await this.#listRequest({
      url: `${ this.#orgBase() }/_apis/projects`,
      query: { stateFilter: state },
      top,
      continuationToken,
      logTag: '[listProjects]',
    })
  }

  /**
   * @operationName Get Project
   * @category Projects
   * @description Retrieves a single team project by its ID or name, including its description, state, visibility, revision and capabilities. Use List Projects to discover available project identifiers.
   * @route GET /projects/get
   * @appearanceColor #0078D7 #2B88D8
   *
   * @paramDef {"type":"String","label":"Project","name":"projectId","required":true,"dictionary":"projectsDictionary","description":"Project ID (GUID) or project name."}
   * @paramDef {"type":"Boolean","label":"Include Capabilities","name":"includeCapabilities","uiComponent":{"type":"CHECKBOX"},"description":"Include the project's process and version-control capabilities in the response."}
   *
   * @returns {Object}
   * @sampleResult {"id":"eb6e4656-77fc-42a1-9181-4c6d8e9da5d1","name":"Fabrikam","description":"Sample project","state":"wellFormed","revision":45,"visibility":"private","lastUpdateTime":"2024-05-01T12:00:00Z"}
   */
  async getProject(projectId, includeCapabilities) {
    return await this.#apiRequest({
      url: `${ this.#orgBase() }/_apis/projects/${ encodeURIComponent(projectId) }`,
      query: { includeCapabilities: includeCapabilities === true ? true : undefined },
      logTag: '[getProject]',
    })
  }

  // ------------------------------------------------------------------
  // Teams
  // ------------------------------------------------------------------

  /**
   * @operationName List Teams
   * @category Teams
   * @description Lists all teams in a project. Returns each team's id, name and description. Use the team identifier with List Team Iterations to read a team's sprints.
   * @route GET /teams
   * @appearanceColor #0078D7 #2B88D8
   *
   * @paramDef {"type":"String","label":"Project","name":"projectId","required":true,"dictionary":"projectsDictionary","description":"Project ID (GUID) or project name."}
   * @paramDef {"type":"Number","label":"Top","name":"top","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of teams to return."}
   * @paramDef {"type":"Number","label":"Skip","name":"skip","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of teams to skip for paging."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"564e8204-a90b-4432-883b-d4363c6125ca","name":"Fabrikam Team","description":"The default project team."}],"count":1}
   */
  async listTeams(projectId, top, skip) {
    const response = await this.#apiRequest({
      url: `${ this.#orgBase() }/_apis/projects/${ encodeURIComponent(projectId) }/teams`,
      query: { $top: top, $skip: skip },
      logTag: '[listTeams]',
    })

    return {
      items: Array.isArray(response?.value) ? response.value : [],
      count: typeof response?.count === 'number' ? response.count : 0,
    }
  }

  // ------------------------------------------------------------------
  // Work Items
  // ------------------------------------------------------------------

  /**
   * Builds a JSON-Patch document from convenience field arguments using the given op
   * ("add" for create, "replace" for update). Only fields with a value are emitted, and
   * any caller-supplied raw operations are appended (and win over convenience fields).
   */
  #buildWorkItemPatch(op, { title, description, assignedTo, state, tags, priority, areaPath, iterationPath }, operations) {
    const patch = []

    const push = (path, value) => {
      if (value !== undefined && value !== null && value !== '') {
        patch.push({ op, path, value })
      }
    }

    push('/fields/System.Title', title)
    push('/fields/System.Description', description)
    push('/fields/System.AssignedTo', assignedTo)
    push('/fields/System.State', state)
    push('/fields/System.Tags', Array.isArray(tags) ? tags.join('; ') : tags)
    push('/fields/Microsoft.VSTS.Common.Priority', priority)
    push('/fields/System.AreaPath', areaPath)
    push('/fields/System.IterationPath', iterationPath)

    if (Array.isArray(operations)) {
      for (const raw of operations) {
        if (raw && typeof raw === 'object' && raw.path) {
          patch.push({ op: raw.op || op, path: raw.path, value: raw.value, from: raw.from })
        }
      }
    }

    return patch
  }

  /**
   * @operationName Get Work Item
   * @category Work Items
   * @description Retrieves a single work item by ID, expanding all fields, relations and links. Returns the work item's numeric id, revision and its System.* / Microsoft.VSTS.* field map (title, state, assigned-to, area/iteration path, etc.).
   * @route GET /work-items/get
   * @appearanceColor #0078D7 #2B88D8
   *
   * @paramDef {"type":"String","label":"Project","name":"project","required":true,"dictionary":"projectsDictionary","description":"Project ID (GUID) or name that owns the work item."}
   * @paramDef {"type":"Number","label":"Work Item ID","name":"id","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric ID of the work item to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":131489,"rev":1,"fields":{"System.WorkItemType":"Task","System.State":"New","System.Title":"Sample task","System.AssignedTo":{"displayName":"Jamal Hartnett"},"Microsoft.VSTS.Common.Priority":2},"url":"https://dev.azure.com/fabrikam/_apis/wit/workItems/131489"}
   */
  async getWorkItem(project, id) {
    return await this.#apiRequest({
      url: `${ this.#orgBase() }/${ encodeURIComponent(project) }/_apis/wit/workitems/${ encodeURIComponent(id) }`,
      query: { $expand: 'all' },
      logTag: '[getWorkItem]',
    })
  }

  /**
   * @operationName Get Work Items Batch
   * @category Work Items
   * @description Retrieves multiple work items at once by a list of IDs (up to 200 per call). Returns the unwrapped array of work items with their expanded fields. Faster than fetching items individually — useful after running a WIQL query that returns only IDs.
   * @route GET /work-items/batch
   * @appearanceColor #0078D7 #2B88D8
   *
   * @paramDef {"type":"Array<Number>","label":"Work Item IDs","name":"ids","required":true,"description":"List of numeric work item IDs to retrieve (maximum 200)."}
   * @paramDef {"type":"String","label":"Expand","name":"expand","uiComponent":{"type":"DROPDOWN","options":{"values":["None","Fields","Relations","Links","All"]}},"description":"How much of each work item to expand. Defaults to All."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":297,"rev":1,"fields":{"System.Title":"Fix login","System.State":"Active"}}],"count":1}
   */
  async getWorkItemsBatch(ids, expand) {
    const idList = (Array.isArray(ids) ? ids : [ids]).filter(v => v !== undefined && v !== null && v !== '')
    const expandValue = this.#resolveChoice(expand, {
      None: 'none',
      Fields: 'fields',
      Relations: 'relations',
      Links: 'links',
      All: 'all',
    }) || 'all'

    const response = await this.#apiRequest({
      url: `${ this.#orgBase() }/_apis/wit/workitems`,
      query: { ids: idList.join(','), $expand: expandValue },
      logTag: '[getWorkItemsBatch]',
    })

    return {
      items: Array.isArray(response?.value) ? response.value : [],
      count: typeof response?.count === 'number' ? response.count : 0,
    }
  }

  /**
   * @operationName Create Work Item
   * @category Work Items
   * @description Creates a work item of a chosen type (Bug, Task, User Story, Feature, Epic, Issue) in a project. Set common fields directly via the title, description, assigned-to, state, tags, priority, area-path and iteration-path parameters, or supply raw JSON-Patch operations for any other field. Returns the created work item with its new numeric id.
   * @route POST /work-items/create
   * @appearanceColor #0078D7 #2B88D8
   *
   * @paramDef {"type":"String","label":"Project","name":"project","required":true,"dictionary":"projectsDictionary","description":"Project ID (GUID) or name to create the work item in."}
   * @paramDef {"type":"String","label":"Work Item Type","name":"type","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Bug","Task","User Story","Feature","Epic","Issue"]}},"description":"Type of work item to create. Available types depend on the project's process."}
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"Title of the work item (System.Title)."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"HTML or plain-text description (System.Description)."}
   * @paramDef {"type":"String","label":"Assigned To","name":"assignedTo","description":"Assignee, given as a user's unique name / email or display name (System.AssignedTo)."}
   * @paramDef {"type":"String","label":"State","name":"state","description":"Initial state, e.g. New, Active, To Do (System.State). Valid values depend on the type and process."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","description":"Tags to apply to the work item (System.Tags)."}
   * @paramDef {"type":"Number","label":"Priority","name":"priority","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Priority 1-4 (Microsoft.VSTS.Common.Priority)."}
   * @paramDef {"type":"String","label":"Area Path","name":"areaPath","description":"Area path classification (System.AreaPath)."}
   * @paramDef {"type":"String","label":"Iteration Path","name":"iterationPath","description":"Iteration / sprint path (System.IterationPath)."}
   * @paramDef {"type":"Array<Object>","label":"Raw Operations","name":"operations","description":"Optional raw JSON-Patch operations, e.g. [{\"op\":\"add\",\"path\":\"/fields/Custom.Field\",\"value\":\"x\"}]. Appended after and overriding the convenience fields above."}
   *
   * @returns {Object}
   * @sampleResult {"id":131489,"rev":1,"fields":{"System.WorkItemType":"Task","System.State":"New","System.Title":"Sample task"},"url":"https://dev.azure.com/fabrikam/_apis/wit/workItems/131489"}
   */
  async createWorkItem(project, type, title, description, assignedTo, state, tags, priority, areaPath, iterationPath, operations) {
    const typeName = this.#resolveChoice(type, WORK_ITEM_TYPES) || type

    const patch = this.#buildWorkItemPatch('add', { title, description, assignedTo, state, tags, priority, areaPath, iterationPath }, operations)

    // The type goes in the URL prefixed with "$", URL-encoded (e.g. "$User%20Story").
    return await this.#apiRequest({
      url: `${ this.#orgBase() }/${ encodeURIComponent(project) }/_apis/wit/workitems/${ encodeURIComponent(`$${ typeName }`) }`,
      method: 'post',
      contentType: 'application/json-patch+json',
      body: patch,
      logTag: '[createWorkItem]',
    })
  }

  /**
   * @operationName Update Work Item
   * @category Work Items
   * @description Updates fields on an existing work item using replace operations. Set any of the convenience fields (title, description, assigned-to, state, tags, priority, area/iteration path) or supply raw JSON-Patch operations for other fields. Returns the updated work item with its incremented revision.
   * @route PATCH /work-items/update
   * @appearanceColor #0078D7 #2B88D8
   *
   * @paramDef {"type":"Number","label":"Work Item ID","name":"id","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric ID of the work item to update."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"New title (System.Title)."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New description (System.Description)."}
   * @paramDef {"type":"String","label":"Assigned To","name":"assignedTo","description":"New assignee, given as a user's unique name / email or display name (System.AssignedTo)."}
   * @paramDef {"type":"String","label":"State","name":"state","description":"New state, e.g. Active, Resolved, Closed (System.State)."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","description":"Replacement tag set (System.Tags). Replaces existing tags."}
   * @paramDef {"type":"Number","label":"Priority","name":"priority","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"New priority 1-4 (Microsoft.VSTS.Common.Priority)."}
   * @paramDef {"type":"String","label":"Area Path","name":"areaPath","description":"New area path (System.AreaPath)."}
   * @paramDef {"type":"String","label":"Iteration Path","name":"iterationPath","description":"New iteration path (System.IterationPath)."}
   * @paramDef {"type":"Array<Object>","label":"Raw Operations","name":"operations","description":"Optional raw JSON-Patch operations. Appended after and overriding the convenience fields above."}
   *
   * @returns {Object}
   * @sampleResult {"id":131489,"rev":2,"fields":{"System.State":"Active","System.Title":"Updated task"},"url":"https://dev.azure.com/fabrikam/_apis/wit/workItems/131489"}
   */
  async updateWorkItem(id, title, description, assignedTo, state, tags, priority, areaPath, iterationPath, operations) {
    const patch = this.#buildWorkItemPatch('replace', { title, description, assignedTo, state, tags, priority, areaPath, iterationPath }, operations)

    if (patch.length === 0) {
      throw new Error('Azure DevOps API error: no fields provided to update.')
    }

    return await this.#apiRequest({
      url: `${ this.#orgBase() }/_apis/wit/workitems/${ encodeURIComponent(id) }`,
      method: 'patch',
      contentType: 'application/json-patch+json',
      body: patch,
      logTag: '[updateWorkItem]',
    })
  }

  /**
   * @operationName Delete Work Item
   * @category Work Items
   * @description Deletes a work item, sending it to the project's recycle bin (or permanently deleting it when Destroy is enabled). Returns the deleted work item's id and details.
   * @route DELETE /work-items/delete
   * @appearanceColor #0078D7 #2B88D8
   *
   * @paramDef {"type":"Number","label":"Work Item ID","name":"id","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric ID of the work item to delete."}
   * @paramDef {"type":"Boolean","label":"Destroy","name":"destroy","uiComponent":{"type":"CHECKBOX"},"description":"Permanently destroy the work item instead of moving it to the recycle bin. This cannot be undone."}
   *
   * @returns {Object}
   * @sampleResult {"id":72,"code":200,"deletedDate":"2024-05-01T12:00:00Z","name":"Sample task","type":"Task"}
   */
  async deleteWorkItem(id, destroy) {
    return await this.#apiRequest({
      url: `${ this.#orgBase() }/_apis/wit/workitems/${ encodeURIComponent(id) }`,
      method: 'delete',
      query: { destroy: destroy === true ? true : undefined },
      logTag: '[deleteWorkItem]',
    })
  }

  /**
   * @operationName Add Comment to Work Item
   * @category Work Items
   * @description Adds a comment to a work item's discussion. Returns the created comment with its id, text, author and created date.
   * @route POST /work-items/comments/add
   * @appearanceColor #0078D7 #2B88D8
   *
   * @paramDef {"type":"String","label":"Project","name":"project","required":true,"dictionary":"projectsDictionary","description":"Project ID (GUID) or name that owns the work item."}
   * @paramDef {"type":"Number","label":"Work Item ID","name":"id","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric ID of the work item to comment on."}
   * @paramDef {"type":"String","label":"Comment Text","name":"text","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Comment body. Supports HTML markup."}
   *
   * @returns {Object}
   * @sampleResult {"id":50,"workItemId":131489,"text":"Looks good to me.","createdBy":{"displayName":"Jamal Hartnett"},"createdDate":"2024-05-01T12:00:00Z"}
   */
  async addWorkItemComment(project, id, text) {
    return await this.#apiRequest({
      url: `${ this.#orgBase() }/${ encodeURIComponent(project) }/_apis/wit/workItems/${ encodeURIComponent(id) }/comments`,
      method: 'post',
      apiVersion: COMMENTS_API_VERSION,
      body: { text },
      logTag: '[addWorkItemComment]',
    })
  }

  /**
   * @operationName List Work Item Comments
   * @category Work Items
   * @description Lists the comments on a work item, most recent first. Returns each comment's id, text, author and created/modified dates plus the total count.
   * @route GET /work-items/comments/list
   * @appearanceColor #0078D7 #2B88D8
   *
   * @paramDef {"type":"String","label":"Project","name":"project","required":true,"dictionary":"projectsDictionary","description":"Project ID (GUID) or name that owns the work item."}
   * @paramDef {"type":"Number","label":"Work Item ID","name":"id","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric ID of the work item whose comments to list."}
   * @paramDef {"type":"Number","label":"Top","name":"top","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of comments to return."}
   *
   * @returns {Object}
   * @sampleResult {"totalCount":1,"count":1,"comments":[{"id":50,"workItemId":131489,"text":"Looks good to me.","createdBy":{"displayName":"Jamal Hartnett"},"createdDate":"2024-05-01T12:00:00Z"}]}
   */
  async listWorkItemComments(project, id, top) {
    return await this.#apiRequest({
      url: `${ this.#orgBase() }/${ encodeURIComponent(project) }/_apis/wit/workItems/${ encodeURIComponent(id) }/comments`,
      apiVersion: COMMENTS_API_VERSION,
      query: { $top: top },
      logTag: '[listWorkItemComments]',
    })
  }

  // ------------------------------------------------------------------
  // Queries (WIQL)
  // ------------------------------------------------------------------

  /**
   * @operationName Run WIQL Query
   * @category Queries
   * @description Runs a Work Item Query Language (WIQL) statement and returns the matching work item references (IDs and URLs). WIQL selects only fields you name; to get full field values, pass the returned IDs to Get Work Items Batch. Scope the query to a project for project-relative asOf and macro support.
   * @route POST /wiql/run
   * @appearanceColor #0078D7 #2B88D8
   *
   * @paramDef {"type":"String","label":"Project","name":"project","required":true,"dictionary":"projectsDictionary","description":"Project ID (GUID) or name to run the query against."}
   * @paramDef {"type":"String","label":"WIQL Query","name":"query","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"WIQL statement, e.g. SELECT [System.Id] FROM WorkItems WHERE [System.WorkItemType] = 'Bug' AND [System.State] = 'Active' ORDER BY [System.ChangedDate] DESC."}
   * @paramDef {"type":"Number","label":"Top","name":"top","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of work item references to return."}
   *
   * @returns {Object}
   * @sampleResult {"queryType":"flat","asOf":"2024-05-01T12:00:00Z","columns":[{"referenceName":"System.Id","name":"ID"}],"workItems":[{"id":297,"url":"https://dev.azure.com/fabrikam/_apis/wit/workItems/297"}]}
   */
  async runWiqlQuery(project, query, top) {
    return await this.#apiRequest({
      url: `${ this.#orgBase() }/${ encodeURIComponent(project) }/_apis/wit/wiql`,
      method: 'post',
      query: { $top: top },
      body: { query },
      logTag: '[runWiqlQuery]',
    })
  }

  // ------------------------------------------------------------------
  // Repositories (Git)
  // ------------------------------------------------------------------

  /**
   * @operationName List Repositories
   * @category Repositories
   * @description Lists the Git repositories in a project. Returns each repository's id, name, default branch, size, remote/web URLs and disabled/fork flags.
   * @route GET /git/repositories
   * @appearanceColor #0078D7 #2B88D8
   *
   * @paramDef {"type":"String","label":"Project","name":"project","required":true,"dictionary":"projectsDictionary","description":"Project ID (GUID) or name whose repositories to list."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"5febef5a-833d-4e14-b9c0-14cb638f91e6","name":"Fabrikam","defaultBranch":"refs/heads/main","size":728,"remoteUrl":"https://dev.azure.com/fabrikam/_git/Fabrikam","webUrl":"https://dev.azure.com/fabrikam/_git/Fabrikam"}],"count":1}
   */
  async listRepositories(project) {
    const response = await this.#apiRequest({
      url: `${ this.#orgBase() }/${ encodeURIComponent(project) }/_apis/git/repositories`,
      logTag: '[listRepositories]',
    })

    return {
      items: Array.isArray(response?.value) ? response.value : [],
      count: typeof response?.count === 'number' ? response.count : 0,
    }
  }

  /**
   * @operationName Get Repository
   * @category Repositories
   * @description Retrieves a single Git repository by its ID or name, including default branch, size, project reference and clone URLs.
   * @route GET /git/repositories/get
   * @appearanceColor #0078D7 #2B88D8
   *
   * @paramDef {"type":"String","label":"Project","name":"project","required":true,"dictionary":"projectsDictionary","description":"Project ID (GUID) or name that owns the repository."}
   * @paramDef {"type":"String","label":"Repository","name":"repositoryId","required":true,"dictionary":"repositoriesDictionary","description":"Repository ID (GUID) or name."}
   *
   * @returns {Object}
   * @sampleResult {"id":"5febef5a-833d-4e14-b9c0-14cb638f91e6","name":"Fabrikam","defaultBranch":"refs/heads/main","size":728,"remoteUrl":"https://dev.azure.com/fabrikam/_git/Fabrikam"}
   */
  async getRepository(project, repositoryId) {
    return await this.#apiRequest({
      url: `${ this.#orgBase() }/${ encodeURIComponent(project) }/_apis/git/repositories/${ encodeURIComponent(repositoryId) }`,
      logTag: '[getRepository]',
    })
  }

  /**
   * @operationName List Branches
   * @category Repositories
   * @description Lists the branches (heads) of a Git repository. Returns each branch's full ref name (e.g. refs/heads/main), object ID and the identity that last updated it.
   * @route GET /git/branches
   * @appearanceColor #0078D7 #2B88D8
   *
   * @paramDef {"type":"String","label":"Project","name":"project","required":true,"dictionary":"projectsDictionary","description":"Project ID (GUID) or name that owns the repository."}
   * @paramDef {"type":"String","label":"Repository","name":"repositoryId","required":true,"dictionary":"repositoriesDictionary","description":"Repository ID (GUID) or name."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"name":"refs/heads/main","objectId":"6f689c15b23c0da8e0aa0a4e7e6f74dab9c0e21f","creator":{"displayName":"Jamal Hartnett"}}],"count":1}
   */
  async listBranches(project, repositoryId) {
    const response = await this.#apiRequest({
      url: `${ this.#orgBase() }/${ encodeURIComponent(project) }/_apis/git/repositories/${ encodeURIComponent(repositoryId) }/refs`,
      query: { filter: 'heads/' },
      logTag: '[listBranches]',
    })

    return {
      items: Array.isArray(response?.value) ? response.value : [],
      count: typeof response?.count === 'number' ? response.count : 0,
    }
  }

  /**
   * @operationName List Commits
   * @category Repositories
   * @description Lists commits in a Git repository, newest first. Optionally filter by branch/version, author and limit the count. Returns each commit's id (SHA-1), comment, author, committer and change counts.
   * @route GET /git/commits
   * @appearanceColor #0078D7 #2B88D8
   *
   * @paramDef {"type":"String","label":"Project","name":"project","required":true,"dictionary":"projectsDictionary","description":"Project ID (GUID) or name that owns the repository."}
   * @paramDef {"type":"String","label":"Repository","name":"repositoryId","required":true,"dictionary":"repositoriesDictionary","description":"Repository ID (GUID) or name."}
   * @paramDef {"type":"String","label":"Branch","name":"branch","description":"Branch name to list commits from, e.g. main (without the refs/heads/ prefix). Defaults to the repository's default branch."}
   * @paramDef {"type":"String","label":"Author","name":"author","description":"Filter to commits by this author name."}
   * @paramDef {"type":"Number","label":"Top","name":"top","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of commits to return."}
   * @paramDef {"type":"Number","label":"Skip","name":"skip","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of commits to skip for paging."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"commitId":"be67f8871a4d1a5b3b5a2e7d3a1c9f0e2d4b6c8a","comment":"Fix login bug","author":{"name":"Jamal Hartnett","date":"2024-05-01T12:00:00Z"},"changeCounts":{"Edit":2}}],"count":1}
   */
  async listCommits(project, repositoryId, branch, author, top, skip) {
    const response = await this.#apiRequest({
      url: `${ this.#orgBase() }/${ encodeURIComponent(project) }/_apis/git/repositories/${ encodeURIComponent(repositoryId) }/commits`,
      query: clean({
        'searchCriteria.itemVersion.version': branch,
        'searchCriteria.itemVersion.versionType': branch ? 'branch' : undefined,
        'searchCriteria.author': author,
        'searchCriteria.$top': top,
        'searchCriteria.$skip': skip,
      }),
      logTag: '[listCommits]',
    })

    return {
      items: Array.isArray(response?.value) ? response.value : [],
      count: typeof response?.count === 'number' ? response.count : 0,
    }
  }

  /**
   * @operationName Get File Content
   * @category Repositories
   * @description Retrieves the text content of a file at a path in a Git repository, optionally at a specific branch. Returns the raw file text. Binary files are not decoded — use the repository's web/remote URL to download binary blobs.
   * @route GET /git/file
   * @appearanceColor #0078D7 #2B88D8
   *
   * @paramDef {"type":"String","label":"Project","name":"project","required":true,"dictionary":"projectsDictionary","description":"Project ID (GUID) or name that owns the repository."}
   * @paramDef {"type":"String","label":"Repository","name":"repositoryId","required":true,"dictionary":"repositoriesDictionary","description":"Repository ID (GUID) or name."}
   * @paramDef {"type":"String","label":"Path","name":"path","required":true,"description":"Path of the file within the repository, e.g. /src/index.js."}
   * @paramDef {"type":"String","label":"Branch","name":"branch","description":"Branch name to read the file from, e.g. main (without the refs/heads/ prefix). Defaults to the repository's default branch."}
   *
   * @returns {Object}
   * @sampleResult {"path":"/README.md","branch":"main","content":"# Fabrikam\n\nProject readme content."}
   */
  async getFileContent(project, repositoryId, path, branch) {
    const content = await this.#apiRequest({
      url: `${ this.#orgBase() }/${ encodeURIComponent(project) }/_apis/git/repositories/${ encodeURIComponent(repositoryId) }/items`,
      query: clean({
        path,
        download: false,
        'versionDescriptor.version': branch,
        'versionDescriptor.versionType': branch ? 'branch' : undefined,
        includeContent: true,
      }),
      contentType: 'text/plain',
      logTag: '[getFileContent]',
    })

    return {
      path,
      branch: branch || null,
      content: typeof content === 'string' ? content : (content?.content ?? JSON.stringify(content)),
    }
  }

  // ------------------------------------------------------------------
  // Pull Requests
  // ------------------------------------------------------------------

  /**
   * @operationName List Pull Requests
   * @category Pull Requests
   * @description Lists pull requests in a repository, filtered by status (Active, Completed, Abandoned or All), target branch and creator. Returns each pull request's id, title, status, source/target branches and creator.
   * @route GET /git/pull-requests
   * @appearanceColor #0078D7 #2B88D8
   *
   * @paramDef {"type":"String","label":"Project","name":"project","required":true,"dictionary":"projectsDictionary","description":"Project ID (GUID) or name that owns the repository."}
   * @paramDef {"type":"String","label":"Repository","name":"repositoryId","required":true,"dictionary":"repositoriesDictionary","description":"Repository ID (GUID) or name."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Active","Completed","Abandoned","All"]}},"description":"Filter pull requests by status. Defaults to Active."}
   * @paramDef {"type":"String","label":"Target Branch","name":"targetRefName","description":"Filter to pull requests targeting this branch, given as a full ref, e.g. refs/heads/main."}
   * @paramDef {"type":"String","label":"Creator ID","name":"creatorId","description":"Filter to pull requests created by this user (identity GUID)."}
   * @paramDef {"type":"Number","label":"Top","name":"top","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of pull requests to return."}
   * @paramDef {"type":"Number","label":"Skip","name":"skip","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of pull requests to skip for paging."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"pullRequestId":22,"title":"A new feature","status":"active","sourceRefName":"refs/heads/feature","targetRefName":"refs/heads/main","createdBy":{"displayName":"Normal Paulk"}}],"count":1}
   */
  async listPullRequests(project, repositoryId, status, targetRefName, creatorId, top, skip) {
    const statusValue = this.#resolveChoice(status, PR_STATUS)

    const response = await this.#apiRequest({
      url: `${ this.#orgBase() }/${ encodeURIComponent(project) }/_apis/git/repositories/${ encodeURIComponent(repositoryId) }/pullrequests`,
      query: clean({
        'searchCriteria.status': statusValue,
        'searchCriteria.targetRefName': targetRefName,
        'searchCriteria.creatorId': creatorId,
        $top: top,
        $skip: skip,
      }),
      logTag: '[listPullRequests]',
    })

    return {
      items: Array.isArray(response?.value) ? response.value : [],
      count: typeof response?.count === 'number' ? response.count : 0,
    }
  }

  /**
   * @operationName Get Pull Request
   * @category Pull Requests
   * @description Retrieves a single pull request by its ID, including title, description, status, reviewers with their votes, merge status and source/target branches.
   * @route GET /git/pull-requests/get
   * @appearanceColor #0078D7 #2B88D8
   *
   * @paramDef {"type":"String","label":"Project","name":"project","required":true,"dictionary":"projectsDictionary","description":"Project ID (GUID) or name that owns the repository."}
   * @paramDef {"type":"String","label":"Repository","name":"repositoryId","required":true,"dictionary":"repositoriesDictionary","description":"Repository ID (GUID) or name."}
   * @paramDef {"type":"Number","label":"Pull Request ID","name":"pullRequestId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric ID of the pull request."}
   *
   * @returns {Object}
   * @sampleResult {"pullRequestId":22,"title":"A new feature","description":"Adding a new feature","status":"active","sourceRefName":"refs/heads/feature","targetRefName":"refs/heads/main","mergeStatus":"succeeded"}
   */
  async getPullRequest(project, repositoryId, pullRequestId) {
    return await this.#apiRequest({
      url: `${ this.#orgBase() }/${ encodeURIComponent(project) }/_apis/git/repositories/${ encodeURIComponent(repositoryId) }/pullrequests/${ encodeURIComponent(pullRequestId) }`,
      logTag: '[getPullRequest]',
    })
  }

  /**
   * @operationName Create Pull Request
   * @category Pull Requests
   * @description Creates a pull request from a source branch into a target branch. Provide branches as full refs (e.g. refs/heads/feature). Optionally set a description, mark it as a draft and add reviewers by identity ID. Returns the created pull request with its new id.
   * @route POST /git/pull-requests/create
   * @appearanceColor #0078D7 #2B88D8
   *
   * @paramDef {"type":"String","label":"Project","name":"project","required":true,"dictionary":"projectsDictionary","description":"Project ID (GUID) or name that owns the repository."}
   * @paramDef {"type":"String","label":"Repository","name":"repositoryId","required":true,"dictionary":"repositoriesDictionary","description":"Repository ID (GUID) or name."}
   * @paramDef {"type":"String","label":"Source Branch","name":"sourceRefName","required":true,"description":"Full source branch ref, e.g. refs/heads/feature."}
   * @paramDef {"type":"String","label":"Target Branch","name":"targetRefName","required":true,"description":"Full target branch ref, e.g. refs/heads/main."}
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"Title of the pull request."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Description of the pull request."}
   * @paramDef {"type":"Boolean","label":"Draft","name":"isDraft","uiComponent":{"type":"CHECKBOX"},"description":"Create the pull request as a draft (work in progress)."}
   * @paramDef {"type":"Array<String>","label":"Reviewer IDs","name":"reviewerIds","description":"Identity GUIDs of reviewers to add to the pull request."}
   *
   * @returns {Object}
   * @sampleResult {"pullRequestId":22,"title":"A new feature","status":"active","sourceRefName":"refs/heads/feature","targetRefName":"refs/heads/main"}
   */
  async createPullRequest(project, repositoryId, sourceRefName, targetRefName, title, description, isDraft, reviewerIds) {
    const reviewers = (Array.isArray(reviewerIds) ? reviewerIds : [])
      .filter(Boolean)
      .map(id => ({ id }))

    return await this.#apiRequest({
      url: `${ this.#orgBase() }/${ encodeURIComponent(project) }/_apis/git/repositories/${ encodeURIComponent(repositoryId) }/pullrequests`,
      method: 'post',
      body: clean({
        sourceRefName,
        targetRefName,
        title,
        description,
        isDraft: isDraft === true ? true : undefined,
        reviewers: reviewers.length ? reviewers : undefined,
      }),
      logTag: '[createPullRequest]',
    })
  }

  /**
   * @operationName Update Pull Request
   * @category Pull Requests
   * @description Updates a pull request: change its title or description, complete it, abandon it or reactivate it, and set completion options (e.g. delete source branch, merge strategy) when completing. Returns the updated pull request.
   * @route PATCH /git/pull-requests/update
   * @appearanceColor #0078D7 #2B88D8
   *
   * @paramDef {"type":"String","label":"Project","name":"project","required":true,"dictionary":"projectsDictionary","description":"Project ID (GUID) or name that owns the repository."}
   * @paramDef {"type":"String","label":"Repository","name":"repositoryId","required":true,"dictionary":"repositoriesDictionary","description":"Repository ID (GUID) or name."}
   * @paramDef {"type":"Number","label":"Pull Request ID","name":"pullRequestId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric ID of the pull request to update."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Completed","Abandoned","Active"]}},"description":"New status. Completed merges the pull request; Abandoned closes it without merging; Active reactivates an abandoned PR."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"New title for the pull request."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"New description for the pull request."}
   * @paramDef {"type":"Object","label":"Completion Options","name":"completionOptions","description":"Optional completion options object when completing, e.g. {\"deleteSourceBranch\":true,\"mergeStrategy\":\"squash\"}."}
   *
   * @returns {Object}
   * @sampleResult {"pullRequestId":22,"title":"A new feature","status":"completed","targetRefName":"refs/heads/main"}
   */
  async updatePullRequest(project, repositoryId, pullRequestId, status, title, description, completionOptions) {
    const statusValue = this.#resolveChoice(status, PR_UPDATE_STATUS)

    const body = clean({
      status: statusValue,
      title,
      description,
      completionOptions: completionOptions && typeof completionOptions === 'object' ? completionOptions : undefined,
    })

    if (Object.keys(body).length === 0) {
      throw new Error('Azure DevOps API error: no fields provided to update.')
    }

    return await this.#apiRequest({
      url: `${ this.#orgBase() }/${ encodeURIComponent(project) }/_apis/git/repositories/${ encodeURIComponent(repositoryId) }/pullrequests/${ encodeURIComponent(pullRequestId) }`,
      method: 'patch',
      body,
      logTag: '[updatePullRequest]',
    })
  }

  /**
   * @operationName Add Pull Request Comment
   * @category Pull Requests
   * @description Adds a new comment thread to a pull request. Returns the created thread with its id and the contained comment. To reply within an existing thread, target that thread in the Azure DevOps UI or a dedicated threads endpoint.
   * @route POST /git/pull-requests/threads
   * @appearanceColor #0078D7 #2B88D8
   *
   * @paramDef {"type":"String","label":"Project","name":"project","required":true,"dictionary":"projectsDictionary","description":"Project ID (GUID) or name that owns the repository."}
   * @paramDef {"type":"String","label":"Repository","name":"repositoryId","required":true,"dictionary":"repositoriesDictionary","description":"Repository ID (GUID) or name."}
   * @paramDef {"type":"Number","label":"Pull Request ID","name":"pullRequestId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric ID of the pull request to comment on."}
   * @paramDef {"type":"String","label":"Comment","name":"content","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Text of the comment to post."}
   * @paramDef {"type":"String","label":"Thread Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Active","Fixed","Won't Fix","Closed","By Design","Pending"]}},"description":"Optional status for the new comment thread."}
   *
   * @returns {Object}
   * @sampleResult {"id":148,"pullRequestThreadContext":null,"status":"active","comments":[{"id":1,"content":"Please add a test.","commentType":"text"}]}
   */
  async addPullRequestComment(project, repositoryId, pullRequestId, content, status) {
    const statusValue = this.#resolveChoice(status, {
      Active: 'active',
      Fixed: 'fixed',
      "Won't Fix": 'wontFix',
      Closed: 'closed',
      'By Design': 'byDesign',
      Pending: 'pending',
    })

    return await this.#apiRequest({
      url: `${ this.#orgBase() }/${ encodeURIComponent(project) }/_apis/git/repositories/${ encodeURIComponent(repositoryId) }/pullrequests/${ encodeURIComponent(pullRequestId) }/threads`,
      method: 'post',
      body: clean({
        comments: [{ parentCommentId: 0, content, commentType: 'text' }],
        status: statusValue,
      }),
      logTag: '[addPullRequestComment]',
    })
  }

  // ------------------------------------------------------------------
  // Pipelines & Builds
  // ------------------------------------------------------------------

  /**
   * @operationName List Pipelines
   * @category Pipelines
   * @description Lists the pipelines defined in a project. Returns each pipeline's id, name, folder and revision. Use a pipeline id with Run Pipeline or Get Pipeline Run.
   * @route GET /pipelines
   * @appearanceColor #0078D7 #2B88D8
   *
   * @paramDef {"type":"String","label":"Project","name":"project","required":true,"dictionary":"projectsDictionary","description":"Project ID (GUID) or name whose pipelines to list."}
   * @paramDef {"type":"Number","label":"Top","name":"top","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of pipelines to return in this page."}
   * @paramDef {"type":"String","label":"Continuation Token","name":"continuationToken","description":"Continuation token from a previous call to fetch the next page."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":1,"name":"CI Pipeline","folder":"\\","revision":3,"url":"https://dev.azure.com/fabrikam/_apis/pipelines/1?revision=3"}],"count":1,"continuationToken":null}
   */
  async listPipelines(project, top, continuationToken) {
    return await this.#listRequest({
      url: `${ this.#orgBase() }/${ encodeURIComponent(project) }/_apis/pipelines`,
      top,
      continuationToken,
      logTag: '[listPipelines]',
    })
  }

  /**
   * @operationName Run Pipeline
   * @category Pipelines
   * @description Queues a run of a pipeline, optionally overriding the branch it runs on, passing template parameters and defining variables. Returns the new run with its id, state and result. Poll Get Pipeline Run to track completion.
   * @route POST /pipelines/run
   * @appearanceColor #0078D7 #2B88D8
   *
   * @paramDef {"type":"String","label":"Project","name":"project","required":true,"dictionary":"projectsDictionary","description":"Project ID (GUID) or name that owns the pipeline."}
   * @paramDef {"type":"Number","label":"Pipeline ID","name":"pipelineId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric ID of the pipeline to run."}
   * @paramDef {"type":"String","label":"Branch","name":"refName","description":"Branch ref to run the pipeline's self repository on, e.g. refs/heads/main. Defaults to the pipeline's default branch."}
   * @paramDef {"type":"Object","label":"Template Parameters","name":"templateParameters","description":"Optional key/value map of runtime template parameters, e.g. {\"environment\":\"staging\"}."}
   * @paramDef {"type":"Object","label":"Variables","name":"variables","description":"Optional map of pipeline variables, e.g. {\"deploy\":{\"value\":\"true\"}}."}
   *
   * @returns {Object}
   * @sampleResult {"id":137,"name":"20240501.1","state":"inProgress","createdDate":"2024-05-01T12:00:00Z","url":"https://dev.azure.com/fabrikam/_apis/pipelines/1/runs/137"}
   */
  async runPipeline(project, pipelineId, refName, templateParameters, variables) {
    const body = { resources: {} }

    if (refName) {
      body.resources.repositories = { self: { refName } }
    }

    if (templateParameters && typeof templateParameters === 'object') {
      body.templateParameters = templateParameters
    }

    if (variables && typeof variables === 'object') {
      body.variables = variables
    }

    return await this.#apiRequest({
      url: `${ this.#orgBase() }/${ encodeURIComponent(project) }/_apis/pipelines/${ encodeURIComponent(pipelineId) }/runs`,
      method: 'post',
      body,
      logTag: '[runPipeline]',
    })
  }

  /**
   * @operationName Get Pipeline Run
   * @category Pipelines
   * @description Retrieves a specific pipeline run, including its state (inProgress, completed), result (succeeded, failed, canceled), created/finished dates and resolved resources.
   * @route GET /pipelines/runs/get
   * @appearanceColor #0078D7 #2B88D8
   *
   * @paramDef {"type":"String","label":"Project","name":"project","required":true,"dictionary":"projectsDictionary","description":"Project ID (GUID) or name that owns the pipeline."}
   * @paramDef {"type":"Number","label":"Pipeline ID","name":"pipelineId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric ID of the pipeline."}
   * @paramDef {"type":"Number","label":"Run ID","name":"runId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric ID of the run to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":137,"name":"20240501.1","state":"completed","result":"succeeded","createdDate":"2024-05-01T12:00:00Z","finishedDate":"2024-05-01T12:05:00Z"}
   */
  async getPipelineRun(project, pipelineId, runId) {
    return await this.#apiRequest({
      url: `${ this.#orgBase() }/${ encodeURIComponent(project) }/_apis/pipelines/${ encodeURIComponent(pipelineId) }/runs/${ encodeURIComponent(runId) }`,
      logTag: '[getPipelineRun]',
    })
  }

  /**
   * @operationName List Builds
   * @category Pipelines
   * @description Lists builds in a project, optionally filtered by build definition IDs, status and result. Returns each build's id, build number, status, result, queue/start/finish times and requested-for identity.
   * @route GET /build/builds
   * @appearanceColor #0078D7 #2B88D8
   *
   * @paramDef {"type":"String","label":"Project","name":"project","required":true,"dictionary":"projectsDictionary","description":"Project ID (GUID) or name whose builds to list."}
   * @paramDef {"type":"Array<Number>","label":"Definition IDs","name":"definitions","description":"Filter to builds of these build definition IDs."}
   * @paramDef {"type":"String","label":"Status Filter","name":"statusFilter","uiComponent":{"type":"DROPDOWN","options":{"values":["In Progress","Completed","Cancelling","Postponed","Not Started","All"]}},"description":"Filter builds by status."}
   * @paramDef {"type":"String","label":"Result Filter","name":"resultFilter","uiComponent":{"type":"DROPDOWN","options":{"values":["Succeeded","Partially Succeeded","Failed","Canceled"]}},"description":"Filter completed builds by result."}
   * @paramDef {"type":"Number","label":"Top","name":"top","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of builds to return in this page."}
   * @paramDef {"type":"String","label":"Continuation Token","name":"continuationToken","description":"Continuation token from a previous call to fetch the next page."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":501,"buildNumber":"20240501.1","status":"completed","result":"succeeded","queueTime":"2024-05-01T12:00:00Z","definition":{"id":12,"name":"CI"}}],"count":1,"continuationToken":null}
   */
  async listBuilds(project, definitions, statusFilter, resultFilter, top, continuationToken) {
    const defList = (Array.isArray(definitions) ? definitions : [])
      .filter(v => v !== undefined && v !== null && v !== '')

    return await this.#listRequest({
      url: `${ this.#orgBase() }/${ encodeURIComponent(project) }/_apis/build/builds`,
      query: clean({
        definitions: defList.length ? defList.join(',') : undefined,
        statusFilter: this.#resolveChoice(statusFilter, BUILD_STATUS),
        resultFilter: this.#resolveChoice(resultFilter, BUILD_RESULT),
      }),
      top,
      continuationToken,
      logTag: '[listBuilds]',
    })
  }

  /**
   * @operationName Get Build
   * @category Pipelines
   * @description Retrieves a single build by its ID, including status, result, build number, source branch/version, definition reference and timing.
   * @route GET /build/builds/get
   * @appearanceColor #0078D7 #2B88D8
   *
   * @paramDef {"type":"String","label":"Project","name":"project","required":true,"dictionary":"projectsDictionary","description":"Project ID (GUID) or name that owns the build."}
   * @paramDef {"type":"Number","label":"Build ID","name":"buildId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric ID of the build to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":501,"buildNumber":"20240501.1","status":"completed","result":"succeeded","sourceBranch":"refs/heads/main","definition":{"id":12,"name":"CI"}}
   */
  async getBuild(project, buildId) {
    return await this.#apiRequest({
      url: `${ this.#orgBase() }/${ encodeURIComponent(project) }/_apis/build/builds/${ encodeURIComponent(buildId) }`,
      logTag: '[getBuild]',
    })
  }

  /**
   * @operationName Queue Build
   * @category Pipelines
   * @description Queues a new build for a build definition, optionally on a specific source branch. Returns the queued build with its id, status and build number. This uses the classic Build API; for YAML pipelines prefer Run Pipeline.
   * @route POST /build/builds/queue
   * @appearanceColor #0078D7 #2B88D8
   *
   * @paramDef {"type":"String","label":"Project","name":"project","required":true,"dictionary":"projectsDictionary","description":"Project ID (GUID) or name that owns the build definition."}
   * @paramDef {"type":"Number","label":"Definition ID","name":"definitionId","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Numeric ID of the build definition to queue."}
   * @paramDef {"type":"String","label":"Source Branch","name":"sourceBranch","description":"Branch ref to build, e.g. refs/heads/main. Defaults to the definition's default branch."}
   *
   * @returns {Object}
   * @sampleResult {"id":502,"buildNumber":"20240501.2","status":"notStarted","definition":{"id":12,"name":"CI"},"sourceBranch":"refs/heads/main"}
   */
  async queueBuild(project, definitionId, sourceBranch) {
    return await this.#apiRequest({
      url: `${ this.#orgBase() }/${ encodeURIComponent(project) }/_apis/build/builds`,
      method: 'post',
      body: clean({
        definition: { id: definitionId },
        sourceBranch,
      }),
      logTag: '[queueBuild]',
    })
  }

  // ------------------------------------------------------------------
  // Boards / Iterations
  // ------------------------------------------------------------------

  /**
   * @operationName List Team Iterations
   * @category Boards
   * @description Lists the iterations (sprints) configured for a team, optionally filtered to the current sprint. Returns each iteration's id, name, path and start/finish dates.
   * @route GET /work/iterations
   * @appearanceColor #0078D7 #2B88D8
   *
   * @paramDef {"type":"String","label":"Project","name":"project","required":true,"dictionary":"projectsDictionary","description":"Project ID (GUID) or name that owns the team."}
   * @paramDef {"type":"String","label":"Team","name":"team","required":true,"dictionary":"teamsDictionary","description":"Team ID (GUID) or name whose iterations to list."}
   * @paramDef {"type":"Boolean","label":"Current Only","name":"currentOnly","uiComponent":{"type":"CHECKBOX"},"description":"Return only the team's current iteration."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"a589a806-bf11-4d4f-a031-c19813331553","name":"Sprint 1","path":"Fabrikam\\Sprint 1","attributes":{"startDate":"2024-05-01T00:00:00Z","finishDate":"2024-05-14T00:00:00Z","timeFrame":"current"}}],"count":1}
   */
  async listTeamIterations(project, team, currentOnly) {
    const response = await this.#apiRequest({
      url: `${ this.#orgBase() }/${ encodeURIComponent(project) }/${ encodeURIComponent(team) }/_apis/work/teamsettings/iterations`,
      query: { $timeframe: currentOnly === true ? 'current' : undefined },
      logTag: '[listTeamIterations]',
    })

    return {
      items: Array.isArray(response?.value) ? response.value : [],
      count: typeof response?.count === 'number' ? response.count : 0,
    }
  }

  // ------------------------------------------------------------------
  // Dictionaries
  // ------------------------------------------------------------------

  /**
   * @typedef {Object} projectsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter projects by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Continuation token to fetch the next page of projects."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Projects Dictionary
   * @description Provides a selectable list of projects in the organization. The option value is the project name, which is accepted anywhere a project ID or name is required.
   * @route POST /dictionaries/projects
   * @paramDef {"type":"projectsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input for filtering projects."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Fabrikam","value":"Fabrikam","note":"wellFormed"}],"cursor":null}
   */
  async projectsDictionary(payload) {
    const { search, cursor } = payload || {}

    const result = await this.#listRequest({
      url: `${ this.#orgBase() }/_apis/projects`,
      top: 100,
      continuationToken: cursor,
      logTag: '[projectsDictionary]',
    })

    const term = (search || '').toLowerCase()

    const items = result.items
      .filter(p => !term || (p.name || '').toLowerCase().includes(term))
      .map(p => ({ label: p.name, value: p.name, note: p.state || undefined }))

    return { items, cursor: result.continuationToken }
  }

  /**
   * @typedef {Object} repositoriesDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Project","name":"project","dictionary":"projectsDictionary","description":"Project whose repositories to list."}
   */

  /**
   * @typedef {Object} repositoriesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter repositories by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Unused; repositories are returned in a single page."}
   * @paramDef {"type":"repositoriesDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"Selected project the repositories belong to."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Repositories Dictionary
   * @description Provides a selectable list of Git repositories in the chosen project. The option value is the repository ID (GUID), which every repository operation accepts.
   * @route POST /dictionaries/repositories
   * @paramDef {"type":"repositoriesDictionary__payload","label":"Payload","name":"payload","description":"Search, pagination and the selected project."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Fabrikam","value":"5febef5a-833d-4e14-b9c0-14cb638f91e6","note":"refs/heads/main"}],"cursor":null}
   */
  async repositoriesDictionary(payload) {
    const { search, criteria } = payload || {}
    const project = criteria?.project

    if (!project) {
      return { items: [], cursor: null }
    }

    const response = await this.#apiRequest({
      url: `${ this.#orgBase() }/${ encodeURIComponent(project) }/_apis/git/repositories`,
      logTag: '[repositoriesDictionary]',
    })

    const term = (search || '').toLowerCase()

    const items = (Array.isArray(response?.value) ? response.value : [])
      .filter(r => !term || (r.name || '').toLowerCase().includes(term))
      .map(r => ({ label: r.name, value: r.id, note: r.defaultBranch || undefined }))

    return { items, cursor: null }
  }

  /**
   * @typedef {Object} pipelinesDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Project","name":"project","dictionary":"projectsDictionary","description":"Project whose pipelines to list."}
   */

  /**
   * @typedef {Object} pipelinesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter pipelines by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Continuation token to fetch the next page of pipelines."}
   * @paramDef {"type":"pipelinesDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"Selected project the pipelines belong to."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Pipelines Dictionary
   * @description Provides a selectable list of pipelines in the chosen project. The option value is the numeric pipeline ID accepted by Run Pipeline and Get Pipeline Run.
   * @route POST /dictionaries/pipelines
   * @paramDef {"type":"pipelinesDictionary__payload","label":"Payload","name":"payload","description":"Search, pagination and the selected project."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"CI Pipeline","value":"1","note":"\\"}],"cursor":null}
   */
  async pipelinesDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const project = criteria?.project

    if (!project) {
      return { items: [], cursor: null }
    }

    const result = await this.#listRequest({
      url: `${ this.#orgBase() }/${ encodeURIComponent(project) }/_apis/pipelines`,
      top: 100,
      continuationToken: cursor,
      logTag: '[pipelinesDictionary]',
    })

    const term = (search || '').toLowerCase()

    const items = result.items
      .filter(p => !term || (p.name || '').toLowerCase().includes(term))
      .map(p => ({ label: p.name, value: String(p.id), note: p.folder || undefined }))

    return { items, cursor: result.continuationToken }
  }

  /**
   * @typedef {Object} teamsDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Project","name":"project","dictionary":"projectsDictionary","description":"Project whose teams to list."}
   */

  /**
   * @typedef {Object} teamsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter teams by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Unused; teams are returned in a single page."}
   * @paramDef {"type":"teamsDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"Selected project the teams belong to."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Teams Dictionary
   * @description Provides a selectable list of teams in the chosen project. The option value is the team name, accepted by List Team Iterations.
   * @route POST /dictionaries/teams
   * @paramDef {"type":"teamsDictionary__payload","label":"Payload","name":"payload","description":"Search, pagination and the selected project."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Fabrikam Team","value":"Fabrikam Team","note":"The default project team."}],"cursor":null}
   */
  async teamsDictionary(payload) {
    const { search, criteria } = payload || {}
    const project = criteria?.project

    if (!project) {
      return { items: [], cursor: null }
    }

    const response = await this.#apiRequest({
      url: `${ this.#orgBase() }/_apis/projects/${ encodeURIComponent(project) }/teams`,
      logTag: '[teamsDictionary]',
    })

    const term = (search || '').toLowerCase()

    const items = (Array.isArray(response?.value) ? response.value : [])
      .filter(t => !term || (t.name || '').toLowerCase().includes(term))
      .map(t => ({ label: t.name, value: t.name, note: t.description || undefined }))

    return { items, cursor: null }
  }
}

Flowrunner.ServerCode.addService(AzureDevOps, [
  {
    name: 'organization',
    displayName: 'Organization',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Azure DevOps organization name — the {organization} segment in https://dev.azure.com/{organization}.',
  },
  {
    name: 'pat',
    displayName: 'Personal Access Token',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'A Personal Access Token from User Settings → Personal Access Tokens. Grant the scopes for the resources you use (Work Items, Code, Build, Release). Sent as HTTP Basic auth.',
  },
])
