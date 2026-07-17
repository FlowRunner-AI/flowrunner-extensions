const OAUTH_BASE_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0'
const API_BASE_URL = 'https://api.powerbi.com/v1.0/myorg'
const POWER_BI_RESOURCE = 'https://analysis.windows.net/powerbi/api'

const PAGE_SIZE_DICTIONARY = 100
const EXPORT_POLL_INTERVAL_MS = 3000
// Leave headroom below the 300-second execution timeout for the download and upload steps.
const EXPORT_WAIT_LIMIT_MS = 260000

// Power BI delegated permissions live on the Power BI resource (analysis.windows.net), not on
// Microsoft Graph, so every resource scope must be fully qualified. The OIDC scopes (openid,
// profile, email) yield an id_token whose claims provide the connection identity - combining
// Graph scopes (e.g. User.Read) with Power BI scopes in one token request is not possible.
const DEFAULT_SCOPE_LIST = [
  'openid',
  'profile',
  'email',
  'offline_access',
  `${ POWER_BI_RESOURCE }/Workspace.Read.All`,
  `${ POWER_BI_RESOURCE }/Dataset.ReadWrite.All`,
  `${ POWER_BI_RESOURCE }/Report.ReadWrite.All`,
  `${ POWER_BI_RESOURCE }/Dashboard.Read.All`,
  `${ POWER_BI_RESOURCE }/Dataflow.ReadWrite.All`,
  `${ POWER_BI_RESOURCE }/App.Read.All`,
  `${ POWER_BI_RESOURCE }/Capacity.Read.All`,
  `${ POWER_BI_RESOURCE }/Content.Create`,
]

const DEFAULT_SCOPE_STRING = DEFAULT_SCOPE_LIST.join(' ')

const NOTIFY_OPTION_MAPPING = {
  'No Notification': 'NoNotification',
  'Mail On Failure': 'MailOnFailure',
  'Mail On Completion': 'MailOnCompletion',
}

const EXPORT_FORMAT_MAPPING = {
  'PDF': 'PDF',
  'PowerPoint': 'PPTX',
  'PNG': 'PNG',
}

const DATASET_MODE_MAPPING = {
  'Push': 'Push',
  'Push Streaming': 'PushStreaming',
  'Streaming': 'Streaming',
}

const RETENTION_POLICY_MAPPING = {
  'None': 'None',
  'Basic FIFO': 'basicFIFO',
}

const COLUMN_DATA_TYPE_MAPPING = {
  'String': 'String',
  'Int64': 'Int64',
  'Double': 'Double',
  'Boolean': 'Boolean',
  'DateTime': 'Datetime',
  'Decimal': 'Decimal',
}

const logger = {
  info: (...args) => console.log('[Microsoft Power BI] info:', ...args),
  debug: (...args) => console.log('[Microsoft Power BI] debug:', ...args),
  error: (...args) => console.log('[Microsoft Power BI] error:', ...args),
  warn: (...args) => console.log('[Microsoft Power BI] warn:', ...args),
}

/**
 * @usesFileStorage
 * @requireOAuth
 * @integrationName Microsoft Power BI
 * @integrationIcon /icon.svg
 **/
class MicrosoftPowerBIService {
  /**
   * @typedef {Object} getWorkspacesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter workspaces by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for retrieving the next page of results."}
   */

  /**
   * @typedef {Object} workspaceScopedDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","description":"The workspace whose items populate the list. Empty means My workspace."}
   */

  /**
   * @typedef {Object} workspaceScopedDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter the list by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for the next page of results."}
   * @paramDef {"type":"workspaceScopedDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"The workspace whose items to list."}
   */

  /**
   * @typedef {Object} PushTableColumn
   * @paramDef {"type":"String","label":"Column Name","name":"name","required":true,"description":"The name of the column, e.g. ProductID."}
   * @paramDef {"type":"String","label":"Data Type","name":"dataType","required":true,"defaultValue":"String","uiComponent":{"type":"DROPDOWN","options":{"values":["String","Int64","Double","Boolean","DateTime","Decimal"]}},"description":"The data type of the column values."}
   */

  /**
   * @typedef {Object} PushDatasetTable
   * @paramDef {"type":"String","label":"Table Name","name":"name","required":true,"description":"The name of the table, e.g. Sales."}
   * @paramDef {"type":"Array<PushTableColumn>","label":"Columns","name":"columns","required":true,"description":"The column definitions (name and data type) for the table."}
   */

  /**
   * @typedef {Object} DatasetParameterUpdate
   * @paramDef {"type":"String","label":"Parameter Name","name":"name","required":true,"description":"The name of the mashup (Power Query) parameter to update. Use Get Dataset Parameters to discover the available names."}
   * @paramDef {"type":"String","label":"New Value","name":"newValue","required":true,"description":"The new value to assign to the parameter."}
   */
  constructor(config) {
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
    this.scopes = DEFAULT_SCOPE_STRING
  }

  #getAccessTokenHeader(extraHeaders) {
    return {
      Authorization: `Bearer ${ this.request.headers['oauth-access-token'] }`,
      ...(extraHeaders || {}),
    }
  }

  async #apiRequest({ url, method, body, query, headers, logTag }) {
    method = method || 'get'
    query = cleanupObject(query)

    try {
      logger.debug(`${ logTag } - api request: [${ method }::${ url }] q=[${ JSON.stringify(query) }]`)

      const request = Flowrunner.Request[method](url)
        .set(this.#getAccessTokenHeader(headers))
        .query(query)

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const apiError = error.body?.error
      const message = apiError?.message || error.message
      const code = apiError?.code ? `${ apiError.code }: ` : ''

      logger.error(`${ logTag } - error [${ error.status || error.statusCode || '' }]: ${ code }${ message }`)

      throw new Error(`Microsoft Power BI API error: ${ code }${ message }`)
    }
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // Builds an API URL scoped to a workspace (group) when one is provided, or to My workspace
  // (the myorg root) when the workspace ID is empty.
  #scopedUrl(workspaceId, path) {
    const groupSegment = workspaceId ? `/groups/${ encodeURIComponent(workspaceId) }` : ''

    return `${ API_BASE_URL }${ groupSegment }${ path }`
  }

  // Normalize a downloaded file body to a Buffer. Flowrunner.Request auto-parses the response by
  // Content-Type, so a JSON/text source may come back as a parsed object or string rather than
  // bytes despite .setEncoding(null); re-serialize anything that is not already a Buffer.
  #toBuffer(body) {
    if (Buffer.isBuffer(body)) {
      return body
    }

    if (typeof body === 'string') {
      return Buffer.from(body)
    }

    return Buffer.from(JSON.stringify(body))
  }

  #decodeJwtPayload(token) {
    try {
      const payload = String(token).split('.')[1].replace(/-/g, '+').replace(/_/g, '/')

      return JSON.parse(Buffer.from(payload, 'base64').toString('utf8'))
    } catch (error) {
      logger.warn(`decodeJwtPayload - unable to decode token: ${ error.message }`)

      return {}
    }
  }

  #sanitizeFileName(name) {
    return String(name || '').replace(/[\\/:*?"<>|]/g, '_').trim() || 'export'
  }

  #sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  #mapPushTables(tables) {
    return (tables || []).map(table => ({
      name: table.name,
      columns: (table.columns || []).map(column => ({
        name: column.name,
        dataType: this.#resolveChoice(column.dataType, COLUMN_DATA_TYPE_MAPPING),
      })),
    }))
  }

  #filterBySearch(items, search, getName) {
    if (!search) {
      return items
    }

    const searchLower = String(search).toLowerCase()

    return items.filter(item => String(getName(item) || '').toLowerCase().includes(searchLower))
  }

  async #downloadExportFile({ workspaceId, reportId, exportId, logTag }) {
    const url = this.#scopedUrl(workspaceId, `/reports/${ encodeURIComponent(reportId) }/exports/${ encodeURIComponent(exportId) }/file`)

    try {
      logger.debug(`${ logTag } - downloading export file: ${ url }`)

      const bytes = await Flowrunner.Request.get(url)
        .set(this.#getAccessTokenHeader())
        .setEncoding(null)

      return this.#toBuffer(bytes)
    } catch (error) {
      const message = error.body?.error?.message || error.message

      logger.error(`${ logTag } - download error: ${ message }`)

      throw new Error(`Microsoft Power BI API error: ${ message }`)
    }
  }

  async #saveExportToStorage({ workspaceId, reportId, exportStatus, fileName, fileOptions, logTag }) {
    const buffer = await this.#downloadExportFile({ workspaceId, reportId, exportId: exportStatus.id, logTag })

    const rawExtension = String(exportStatus.resourceFileExtension || '')
    const extension = rawExtension && !rawExtension.startsWith('.') ? `.${ rawExtension }` : rawExtension

    let resolvedName = fileName || `${ this.#sanitizeFileName(exportStatus.reportName) }${ extension }`

    if (extension && !resolvedName.toLowerCase().endsWith(extension.toLowerCase())) {
      resolvedName = `${ resolvedName }${ extension }`
    }

    const { url } = await this.flowrunner.Files.uploadFile(buffer, {
      filename: resolvedName,
      generateUrl: true,
      overwrite: true,
      ...(fileOptions || { scope: 'FLOW' }),
    })

    return {
      fileUrl: url,
      fileName: resolvedName,
      size: buffer.length,
      reportId,
      exportId: exportStatus.id,
      reportName: exportStatus.reportName || null,
    }
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

    // The access token is scoped to the Power BI resource, so Microsoft Graph /me cannot be
    // called with it. Derive the connection identity from the id_token (OIDC) claims instead,
    // falling back to the access token's own JWT claims.
    const claims = response.id_token
      ? this.#decodeJwtPayload(response.id_token)
      : this.#decodeJwtPayload(response.access_token)

    const userData = {
      name: claims.name || null,
      email: claims.email || claims.preferred_username || claims.upn || claims.unique_name || null,
      objectId: claims.oid || null,
      tenantId: claims.tid || null,
    }

    logger.debug(`[executeCallback] resolved identity: ${ JSON.stringify(userData) }`)

    return {
      token: response.access_token,
      refreshToken: response.refresh_token,
      expirationInSeconds: response.expires_in,
      connectionIdentityName: constructIdentityName(userData),
      overwrite: true,
      userData,
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
   * @operationName Get Workspaces Dictionary
   * @description Provides a searchable list of Power BI workspaces (groups) the user belongs to for dynamic parameter selection. Each entry maps the workspace name to its ID. My workspace is not included; leave the parameter empty to target My workspace.
   * @route POST /get-workspaces-dictionary
   * @paramDef {"type":"getWorkspacesDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering workspaces."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Sales Analytics","value":"f089354e-8366-4e18-aea3-4cb4a3a50b48","note":"On dedicated capacity"}],"cursor":null}
   */
  async getWorkspacesDictionary(payload) {
    const { search, cursor } = payload || {}
    const skip = cursor ? parseInt(cursor, 10) || 0 : 0

    const query = {
      $top: PAGE_SIZE_DICTIONARY,
      $skip: skip || undefined,
    }

    if (search) {
      query.$filter = `contains(name,'${ String(search).replace(/'/g, "''") }')`
    }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/groups`,
      query,
      logTag: 'getWorkspacesDictionary',
    })

    const groups = response.value || []

    return {
      cursor: groups.length === PAGE_SIZE_DICTIONARY ? String(skip + PAGE_SIZE_DICTIONARY) : null,
      items: groups.map(group => ({
        label: group.name || group.id,
        value: group.id,
        note: group.isOnDedicatedCapacity ? 'On dedicated capacity' : `ID: ${ group.id }`,
      })),
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Datasets Dictionary
   * @description Provides a searchable list of datasets (semantic models) in the selected workspace, or in My workspace when no workspace is chosen. Each entry maps the dataset name to its ID.
   * @route POST /get-datasets-dictionary
   * @paramDef {"type":"workspaceScopedDictionary__payload","label":"Payload","name":"payload","description":"Search text, pagination cursor, and the workspace criteria whose datasets to list."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"SalesMarketing","value":"cfafbeb1-8037-4d0c-896e-a46fb27ff229","note":"Configured by john@contoso.com"}],"cursor":null}
   */
  async getDatasetsDictionary(payload) {
    const { search, criteria } = payload || {}

    const response = await this.#apiRequest({
      url: this.#scopedUrl(criteria?.workspaceId, '/datasets'),
      logTag: 'getDatasetsDictionary',
    })

    const datasets = this.#filterBySearch(response.value || [], search, dataset => dataset.name)

    return {
      cursor: null,
      items: datasets.map(dataset => ({
        label: dataset.name || dataset.id,
        value: dataset.id,
        note: dataset.configuredBy ? `Configured by ${ dataset.configuredBy }` : `ID: ${ dataset.id }`,
      })),
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Reports Dictionary
   * @description Provides a searchable list of reports in the selected workspace, or in My workspace when no workspace is chosen. Each entry maps the report name to its ID and shows the report type as a note.
   * @route POST /get-reports-dictionary
   * @paramDef {"type":"workspaceScopedDictionary__payload","label":"Payload","name":"payload","description":"Search text, pagination cursor, and the workspace criteria whose reports to list."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Quarterly Sales","value":"5b218778-e7a5-4d73-8187-f10824047715","note":"PowerBIReport"}],"cursor":null}
   */
  async getReportsDictionary(payload) {
    const { search, criteria } = payload || {}

    const response = await this.#apiRequest({
      url: this.#scopedUrl(criteria?.workspaceId, '/reports'),
      logTag: 'getReportsDictionary',
    })

    const reports = this.#filterBySearch(response.value || [], search, report => report.name)

    return {
      cursor: null,
      items: reports.map(report => ({
        label: report.name || report.id,
        value: report.id,
        note: report.reportType || `ID: ${ report.id }`,
      })),
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Dashboards Dictionary
   * @description Provides a searchable list of dashboards in the selected workspace, or in My workspace when no workspace is chosen. Each entry maps the dashboard display name to its ID.
   * @route POST /get-dashboards-dictionary
   * @paramDef {"type":"workspaceScopedDictionary__payload","label":"Payload","name":"payload","description":"Search text, pagination cursor, and the workspace criteria whose dashboards to list."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Executive Overview","value":"69ffaa6c-b36d-4d01-96f5-1ed67c64d4af","note":"Read-only"}],"cursor":null}
   */
  async getDashboardsDictionary(payload) {
    const { search, criteria } = payload || {}

    const response = await this.#apiRequest({
      url: this.#scopedUrl(criteria?.workspaceId, '/dashboards'),
      logTag: 'getDashboardsDictionary',
    })

    const dashboards = this.#filterBySearch(response.value || [], search, dashboard => dashboard.displayName)

    return {
      cursor: null,
      items: dashboards.map(dashboard => ({
        label: dashboard.displayName || dashboard.id,
        value: dashboard.id,
        note: dashboard.isReadOnly ? 'Read-only' : `ID: ${ dashboard.id }`,
      })),
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Dataflows Dictionary
   * @description Provides a searchable list of dataflows in the selected workspace. Dataflows only exist in shared workspaces, so a workspace must be selected before this list can populate. Each entry maps the dataflow name to its object ID.
   * @route POST /get-dataflows-dictionary
   * @paramDef {"type":"workspaceScopedDictionary__payload","label":"Payload","name":"payload","description":"Search text, pagination cursor, and the workspace criteria whose dataflows to list."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Customer Orders","value":"928228ba-008d-4fd9-864a-92d2752ee5ce","note":"ID: 928228ba-008d-4fd9-864a-92d2752ee5ce"}],"cursor":null}
   */
  async getDataflowsDictionary(payload) {
    const { search, criteria } = payload || {}

    if (!criteria?.workspaceId) {
      return { items: [], cursor: null }
    }

    const response = await this.#apiRequest({
      url: this.#scopedUrl(criteria.workspaceId, '/dataflows'),
      logTag: 'getDataflowsDictionary',
    })

    const dataflows = this.#filterBySearch(response.value || [], search, dataflow => dataflow.name)

    return {
      cursor: null,
      items: dataflows.map(dataflow => ({
        label: dataflow.name || dataflow.objectId,
        value: dataflow.objectId,
        note: dataflow.description || `ID: ${ dataflow.objectId }`,
      })),
    }
  }

  /**
   * @operationName List Workspaces
   * @category Workspaces
   * @appearanceColor #F2C811 #B78A00
   * @description Retrieves the Power BI workspaces (groups) the user has access to, including each workspace's ID, name, and capacity information. My workspace is not included in the list. Supports OData filtering and offset-based paging with the Max Results and Skip parameters.
   * @route GET /list-workspaces
   * @paramDef {"type":"String","label":"Filter","name":"filter","description":"Optional OData $filter expression, for example: contains(name,'Sales') or name eq 'Sales Analytics'."}
   * @paramDef {"type":"Number","label":"Max Results","name":"top","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of workspaces to return. Defaults to 100."}
   * @paramDef {"type":"Number","label":"Skip","name":"skip","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of workspaces to skip, used together with Max Results for paging through large lists."}
   * @returns {Object}
   * @sampleResult {"value":[{"id":"f089354e-8366-4e18-aea3-4cb4a3a50b48","name":"Sales Analytics","isReadOnly":false,"isOnDedicatedCapacity":false,"type":"Workspace"}]}
   */
  listWorkspaces(filter, top, skip) {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/groups`,
      query: {
        $filter: filter,
        $top: top || PAGE_SIZE_DICTIONARY,
        $skip: skip,
      },
      logTag: 'listWorkspaces',
    })
  }

  /**
   * @operationName List Datasets
   * @category Datasets
   * @appearanceColor #F2C811 #B78A00
   * @description Retrieves the datasets (semantic models) in the selected workspace, or in My workspace when no workspace is chosen. Each dataset includes its ID, name, configured owner, and capability flags such as whether refresh and Q&A are supported.
   * @route GET /list-datasets
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","dictionary":"getWorkspacesDictionary","description":"The workspace to list datasets from. Choose a workspace or paste its ID. Leave empty to use My workspace."}
   * @returns {Object}
   * @sampleResult {"value":[{"id":"cfafbeb1-8037-4d0c-896e-a46fb27ff229","name":"SalesMarketing","configuredBy":"john@contoso.com","isRefreshable":true,"addRowsAPIEnabled":false}]}
   */
  listDatasets(workspaceId) {
    return this.#apiRequest({
      url: this.#scopedUrl(workspaceId, '/datasets'),
      logTag: 'listDatasets',
    })
  }

  /**
   * @operationName Get Dataset
   * @category Datasets
   * @appearanceColor #F2C811 #B78A00
   * @description Retrieves a single dataset (semantic model) by ID from the selected workspace or My workspace, including its name, configured owner, and capability flags such as whether it is refreshable or push-enabled.
   * @route GET /get-dataset
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","dictionary":"getWorkspacesDictionary","description":"The workspace containing the dataset. Choose a workspace or paste its ID. Leave empty to use My workspace."}
   * @paramDef {"type":"String","label":"Dataset","name":"datasetId","required":true,"dictionary":"getDatasetsDictionary","dependsOn":["workspaceId"],"description":"The dataset to fetch. Choose a dataset from the selected workspace or paste a dataset ID."}
   * @returns {Object}
   * @sampleResult {"id":"cfafbeb1-8037-4d0c-896e-a46fb27ff229","name":"SalesMarketing","configuredBy":"john@contoso.com","isRefreshable":true,"isEffectiveIdentityRequired":false,"addRowsAPIEnabled":false}
   */
  async getDataset(workspaceId, datasetId) {
    if (!datasetId) {
      throw new Error('Parameter "Dataset" is required')
    }

    return this.#apiRequest({
      url: this.#scopedUrl(workspaceId, `/datasets/${ encodeURIComponent(datasetId) }`),
      logTag: 'getDataset',
    })
  }

  /**
   * @operationName Delete Dataset
   * @category Datasets
   * @appearanceColor #F2C811 #B78A00
   * @description Permanently deletes a dataset (semantic model) from the selected workspace or My workspace. Reports built on the dataset stop working. This action cannot be undone. Returns a confirmation message; the API returns no content on success.
   * @route DELETE /delete-dataset
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","dictionary":"getWorkspacesDictionary","description":"The workspace containing the dataset. Choose a workspace or paste its ID. Leave empty to use My workspace."}
   * @paramDef {"type":"String","label":"Dataset","name":"datasetId","required":true,"dictionary":"getDatasetsDictionary","dependsOn":["workspaceId"],"description":"The dataset to delete. Choose a dataset from the selected workspace or paste a dataset ID."}
   * @returns {Object}
   * @sampleResult {"message":"Dataset deleted successfully","datasetId":"cfafbeb1-8037-4d0c-896e-a46fb27ff229"}
   */
  async deleteDataset(workspaceId, datasetId) {
    if (!datasetId) {
      throw new Error('Parameter "Dataset" is required')
    }

    await this.#apiRequest({
      url: this.#scopedUrl(workspaceId, `/datasets/${ encodeURIComponent(datasetId) }`),
      method: 'delete',
      logTag: 'deleteDataset',
    })

    return { message: 'Dataset deleted successfully', datasetId }
  }

  /**
   * @operationName Refresh Dataset
   * @category Datasets
   * @appearanceColor #F2C811 #B78A00
   * @description Triggers an asynchronous data refresh for a dataset (semantic model) in the selected workspace or My workspace. On shared capacity a maximum of eight refreshes per day is allowed (including scheduled refreshes). Use Get Refresh History to track the refresh outcome. Returns a confirmation message; the API responds with 202 Accepted and no body.
   * @route POST /refresh-dataset
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","dictionary":"getWorkspacesDictionary","description":"The workspace containing the dataset. Choose a workspace or paste its ID. Leave empty to use My workspace."}
   * @paramDef {"type":"String","label":"Dataset","name":"datasetId","required":true,"dictionary":"getDatasetsDictionary","dependsOn":["workspaceId"],"description":"The dataset to refresh. Choose a dataset from the selected workspace or paste a dataset ID."}
   * @paramDef {"type":"String","label":"Notify Option","name":"notifyOption","defaultValue":"No Notification","uiComponent":{"type":"DROPDOWN","options":{"values":["No Notification","Mail On Failure","Mail On Completion"]}},"description":"Whether Power BI should send a mail notification about the refresh outcome. Defaults to No Notification."}
   * @returns {Object}
   * @sampleResult {"message":"Dataset refresh triggered successfully","datasetId":"cfafbeb1-8037-4d0c-896e-a46fb27ff229","notifyOption":"NoNotification"}
   */
  async refreshDataset(workspaceId, datasetId, notifyOption) {
    if (!datasetId) {
      throw new Error('Parameter "Dataset" is required')
    }

    const resolvedNotifyOption = this.#resolveChoice(notifyOption, NOTIFY_OPTION_MAPPING) || 'NoNotification'

    await this.#apiRequest({
      url: this.#scopedUrl(workspaceId, `/datasets/${ encodeURIComponent(datasetId) }/refreshes`),
      method: 'post',
      body: { notifyOption: resolvedNotifyOption },
      logTag: 'refreshDataset',
    })

    return {
      message: 'Dataset refresh triggered successfully',
      datasetId,
      notifyOption: resolvedNotifyOption,
    }
  }

  /**
   * @operationName Get Refresh History
   * @category Datasets
   * @appearanceColor #F2C811 #B78A00
   * @description Retrieves the refresh history of a dataset (semantic model) in the selected workspace or My workspace, including each refresh's type, start and end time, and completion status (Completed, Failed, Unknown, or Disabled). Failed entries include error details in the serviceExceptionJson property.
   * @route GET /get-refresh-history
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","dictionary":"getWorkspacesDictionary","description":"The workspace containing the dataset. Choose a workspace or paste its ID. Leave empty to use My workspace."}
   * @paramDef {"type":"String","label":"Dataset","name":"datasetId","required":true,"dictionary":"getDatasetsDictionary","dependsOn":["workspaceId"],"description":"The dataset whose refresh history to fetch. Choose a dataset from the selected workspace or paste a dataset ID."}
   * @paramDef {"type":"Number","label":"Max Results","name":"top","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of refresh entries to return, newest first. Leave empty to return all available entries."}
   * @returns {Object}
   * @sampleResult {"value":[{"refreshType":"ViaApi","startTime":"2026-07-15T13:02:26.680Z","endTime":"2026-07-15T13:03:31.483Z","status":"Completed","requestId":"9399bb89-25d1-44f8-8576-136d7e9014b1"}]}
   */
  async getRefreshHistory(workspaceId, datasetId, top) {
    if (!datasetId) {
      throw new Error('Parameter "Dataset" is required')
    }

    return this.#apiRequest({
      url: this.#scopedUrl(workspaceId, `/datasets/${ encodeURIComponent(datasetId) }/refreshes`),
      query: { $top: top },
      logTag: 'getRefreshHistory',
    })
  }

  /**
   * @operationName Get Dataset Parameters
   * @category Datasets
   * @appearanceColor #F2C811 #B78A00
   * @description Retrieves the mashup (Power Query) parameters of a dataset (semantic model) in the selected workspace or My workspace, including each parameter's name, type, whether it is required, and its current value.
   * @route GET /get-dataset-parameters
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","dictionary":"getWorkspacesDictionary","description":"The workspace containing the dataset. Choose a workspace or paste its ID. Leave empty to use My workspace."}
   * @paramDef {"type":"String","label":"Dataset","name":"datasetId","required":true,"dictionary":"getDatasetsDictionary","dependsOn":["workspaceId"],"description":"The dataset whose parameters to fetch. Choose a dataset from the selected workspace or paste a dataset ID."}
   * @returns {Object}
   * @sampleResult {"value":[{"name":"ServerName","type":"Text","isRequired":true,"currentValue":"sql.contoso.com"},{"name":"MaxRows","type":"Number","isRequired":false,"currentValue":"1000"}]}
   */
  async getDatasetParameters(workspaceId, datasetId) {
    if (!datasetId) {
      throw new Error('Parameter "Dataset" is required')
    }

    return this.#apiRequest({
      url: this.#scopedUrl(workspaceId, `/datasets/${ encodeURIComponent(datasetId) }/parameters`),
      logTag: 'getDatasetParameters',
    })
  }

  /**
   * @operationName Update Dataset Parameters
   * @category Datasets
   * @appearanceColor #F2C811 #B78A00
   * @description Updates the values of mashup (Power Query) parameters of a dataset (semantic model) in the selected workspace or My workspace. The caller must be the dataset owner (use Take Over Dataset first if not), and a dataset refresh is required for the new values to take effect. Returns a confirmation message; the API returns no content on success.
   * @route POST /update-dataset-parameters
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","dictionary":"getWorkspacesDictionary","description":"The workspace containing the dataset. Choose a workspace or paste its ID. Leave empty to use My workspace."}
   * @paramDef {"type":"String","label":"Dataset","name":"datasetId","required":true,"dictionary":"getDatasetsDictionary","dependsOn":["workspaceId"],"description":"The dataset whose parameters to update. Choose a dataset from the selected workspace or paste a dataset ID."}
   * @paramDef {"type":"Array<DatasetParameterUpdate>","label":"Parameter Updates","name":"updateDetails","required":true,"description":"The parameters to update, each with the parameter name and its new value. A maximum of 100 parameters can be updated per call."}
   * @returns {Object}
   * @sampleResult {"message":"Dataset parameters updated successfully","datasetId":"cfafbeb1-8037-4d0c-896e-a46fb27ff229","updatedCount":2}
   */
  async updateDatasetParameters(workspaceId, datasetId, updateDetails) {
    if (!datasetId) {
      throw new Error('Parameter "Dataset" is required')
    }

    if (!Array.isArray(updateDetails) || updateDetails.length === 0) {
      throw new Error('Parameter "Parameter Updates" must contain at least one entry')
    }

    await this.#apiRequest({
      url: this.#scopedUrl(workspaceId, `/datasets/${ encodeURIComponent(datasetId) }/Default.UpdateParameters`),
      method: 'post',
      body: {
        updateDetails: updateDetails.map(({ name, newValue }) => ({ name, newValue })),
      },
      logTag: 'updateDatasetParameters',
    })

    return {
      message: 'Dataset parameters updated successfully',
      datasetId,
      updatedCount: updateDetails.length,
    }
  }

  /**
   * @operationName Take Over Dataset
   * @category Datasets
   * @appearanceColor #F2C811 #B78A00
   * @description Transfers ownership of a dataset (semantic model) in a shared workspace to the connected user. Required before operations that only the dataset owner can perform, such as updating parameters or data source credentials. Only supported for datasets in shared workspaces, not in My workspace. Returns a confirmation message; the API returns no content on success.
   * @route POST /take-over-dataset
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"The shared workspace containing the dataset. Choose a workspace or paste its ID. My workspace is not supported."}
   * @paramDef {"type":"String","label":"Dataset","name":"datasetId","required":true,"dictionary":"getDatasetsDictionary","dependsOn":["workspaceId"],"description":"The dataset to take ownership of. Choose a dataset from the selected workspace or paste a dataset ID."}
   * @returns {Object}
   * @sampleResult {"message":"Dataset ownership taken over successfully","datasetId":"cfafbeb1-8037-4d0c-896e-a46fb27ff229"}
   */
  async takeOverDataset(workspaceId, datasetId) {
    if (!workspaceId) {
      throw new Error('Parameter "Workspace" is required')
    }

    if (!datasetId) {
      throw new Error('Parameter "Dataset" is required')
    }

    await this.#apiRequest({
      url: this.#scopedUrl(workspaceId, `/datasets/${ encodeURIComponent(datasetId) }/Default.TakeOver`),
      method: 'post',
      logTag: 'takeOverDataset',
    })

    return { message: 'Dataset ownership taken over successfully', datasetId }
  }

  /**
   * @operationName Execute DAX Query
   * @category DAX Queries
   * @appearanceColor #F2C811 #B78A00
   * @description Executes a DAX query against a dataset (semantic model) in the selected workspace or My workspace and returns the resulting rows. One query with one result table per call; up to 100,000 rows or 1,000,000 values (whichever is reached first) and 15 MB of data per query, with a limit of 120 query requests per minute per user. The tenant setting "Dataset Execute Queries REST API" must be enabled, and the user needs read and build permission on the dataset. Only DAX is supported (no MDX or DMV queries).
   * @route POST /execute-dax-query
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","dictionary":"getWorkspacesDictionary","description":"The workspace containing the dataset. Choose a workspace or paste its ID. Leave empty to use My workspace."}
   * @paramDef {"type":"String","label":"Dataset","name":"datasetId","required":true,"dictionary":"getDatasetsDictionary","dependsOn":["workspaceId"],"description":"The dataset to query. Choose a dataset from the selected workspace or paste a dataset ID."}
   * @paramDef {"type":"String","label":"DAX Query","name":"daxQuery","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The DAX query to execute, e.g. EVALUATE TOPN(10, 'Sales') or EVALUATE SUMMARIZECOLUMNS('Date'[Year], \"Total\", SUM('Sales'[Amount]))."}
   * @paramDef {"type":"Boolean","label":"Include Nulls","name":"includeNulls","uiComponent":{"type":"TOGGLE"},"description":"Whether null (blank) values are included in the result set. Defaults to false, which omits null-valued properties from the rows."}
   * @paramDef {"type":"String","label":"Impersonated User","name":"impersonatedUserName","description":"Optional UPN of a user to impersonate for row-level security evaluation. Ignored when the dataset has no RLS."}
   * @returns {Object}
   * @sampleResult {"results":[{"tables":[{"rows":[{"'Sales'[Year]":2026,"[Total]":1250000.5},{"'Sales'[Year]":2025,"[Total]":983221.75}]}]}]}
   */
  async executeDaxQuery(workspaceId, datasetId, daxQuery, includeNulls, impersonatedUserName) {
    if (!datasetId) {
      throw new Error('Parameter "Dataset" is required')
    }

    if (!daxQuery) {
      throw new Error('Parameter "DAX Query" is required')
    }

    const body = cleanupObject({
      queries: [{ query: daxQuery }],
      serializerSettings: includeNulls === undefined ? undefined : { includeNulls },
      impersonatedUserName,
    })

    return this.#apiRequest({
      url: this.#scopedUrl(workspaceId, `/datasets/${ encodeURIComponent(datasetId) }/executeQueries`),
      method: 'post',
      body,
      logTag: 'executeDaxQuery',
    })
  }

  /**
   * @operationName Create Push Dataset
   * @category Push Datasets
   * @appearanceColor #F2C811 #B78A00
   * @description Creates a new push dataset in the selected workspace or My workspace with the given table schema. Rows can then be streamed into the dataset with Add Rows to Table, and its data is immediately available to reports and dashboard tiles. Choose Push mode for datasets that keep data (queryable and usable in reports), Streaming for dashboard streaming tiles only, or Push Streaming for both.
   * @route POST /create-push-dataset
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","dictionary":"getWorkspacesDictionary","description":"The workspace to create the dataset in. Choose a workspace or paste its ID. Leave empty to use My workspace."}
   * @paramDef {"type":"String","label":"Dataset Name","name":"name","required":true,"description":"The name of the new dataset, e.g. SalesTelemetry."}
   * @paramDef {"type":"Array<PushDatasetTable>","label":"Tables","name":"tables","required":true,"description":"The table schemas for the dataset. Each table has a name and a list of columns with data types."}
   * @paramDef {"type":"String","label":"Default Mode","name":"defaultMode","defaultValue":"Push","uiComponent":{"type":"DROPDOWN","options":{"values":["Push","Push Streaming","Streaming"]}},"description":"The dataset mode. Push keeps data for reports and queries, Streaming feeds dashboard streaming tiles only, Push Streaming does both. Defaults to Push."}
   * @paramDef {"type":"String","label":"Retention Policy","name":"defaultRetentionPolicy","defaultValue":"None","uiComponent":{"type":"DROPDOWN","options":{"values":["None","Basic FIFO"]}},"description":"The retention policy for pushed rows. Basic FIFO keeps about the latest 200,000 rows and drops the oldest as new rows arrive; None keeps all rows up to the push dataset limits. Defaults to None."}
   * @returns {Object}
   * @sampleResult {"id":"3d43c17a-8bd9-4b0a-b33a-3b0f5da1c6a1","name":"SalesTelemetry","defaultRetentionPolicy":"None","tables":[{"name":"Sales","columns":[{"name":"Amount","dataType":"Double"}]}]}
   */
  async createPushDataset(workspaceId, name, tables, defaultMode, defaultRetentionPolicy) {
    if (!name) {
      throw new Error('Parameter "Dataset Name" is required')
    }

    if (!Array.isArray(tables) || tables.length === 0) {
      throw new Error('Parameter "Tables" must contain at least one table definition')
    }

    const body = {
      name,
      defaultMode: this.#resolveChoice(defaultMode, DATASET_MODE_MAPPING) || 'Push',
      tables: this.#mapPushTables(tables),
    }

    return this.#apiRequest({
      url: this.#scopedUrl(workspaceId, '/datasets'),
      method: 'post',
      query: {
        defaultRetentionPolicy: this.#resolveChoice(defaultRetentionPolicy, RETENTION_POLICY_MAPPING),
      },
      body,
      logTag: 'createPushDataset',
    })
  }

  /**
   * @operationName Get Dataset Tables
   * @category Push Datasets
   * @appearanceColor #F2C811 #B78A00
   * @description Retrieves the tables of a push dataset in the selected workspace or My workspace. Only supported for push datasets; regular imported or DirectQuery datasets do not expose their tables through this API.
   * @route GET /get-dataset-tables
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","dictionary":"getWorkspacesDictionary","description":"The workspace containing the dataset. Choose a workspace or paste its ID. Leave empty to use My workspace."}
   * @paramDef {"type":"String","label":"Dataset","name":"datasetId","required":true,"dictionary":"getDatasetsDictionary","dependsOn":["workspaceId"],"description":"The push dataset whose tables to fetch. Choose a dataset from the selected workspace or paste a dataset ID."}
   * @returns {Object}
   * @sampleResult {"value":[{"name":"Sales"},{"name":"Products"}]}
   */
  async getDatasetTables(workspaceId, datasetId) {
    if (!datasetId) {
      throw new Error('Parameter "Dataset" is required')
    }

    return this.#apiRequest({
      url: this.#scopedUrl(workspaceId, `/datasets/${ encodeURIComponent(datasetId) }/tables`),
      logTag: 'getDatasetTables',
    })
  }

  /**
   * @operationName Add Rows to Table
   * @category Push Datasets
   * @appearanceColor #F2C811 #B78A00
   * @description Adds data rows to a table of a push dataset in the selected workspace or My workspace. Each row is an object whose keys match the table's column names. Push datasets accept up to 10,000 rows per request and 120 requests per minute; new data appears in connected reports and dashboard tiles immediately. Only supported for push datasets. Returns a confirmation message; the API returns no content on success.
   * @route POST /add-rows-to-table
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","dictionary":"getWorkspacesDictionary","description":"The workspace containing the dataset. Choose a workspace or paste its ID. Leave empty to use My workspace."}
   * @paramDef {"type":"String","label":"Dataset","name":"datasetId","required":true,"dictionary":"getDatasetsDictionary","dependsOn":["workspaceId"],"description":"The push dataset to add rows to. Choose a dataset from the selected workspace or paste a dataset ID."}
   * @paramDef {"type":"String","label":"Table Name","name":"tableName","required":true,"description":"The name of the table in the push dataset, e.g. Sales."}
   * @paramDef {"type":"Array<Object>","label":"Rows","name":"rows","required":true,"description":"The data rows to add. Each row is a key-value object whose keys match the table's column names, e.g. [{\"ProductID\":1,\"Amount\":19.99}]."}
   * @returns {Object}
   * @sampleResult {"message":"Rows added successfully","datasetId":"3d43c17a-8bd9-4b0a-b33a-3b0f5da1c6a1","tableName":"Sales","rowCount":3}
   */
  async addRowsToTable(workspaceId, datasetId, tableName, rows) {
    if (!datasetId) {
      throw new Error('Parameter "Dataset" is required')
    }

    if (!tableName) {
      throw new Error('Parameter "Table Name" is required')
    }

    if (!Array.isArray(rows) || rows.length === 0) {
      throw new Error('Parameter "Rows" must contain at least one row')
    }

    await this.#apiRequest({
      url: this.#scopedUrl(workspaceId, `/datasets/${ encodeURIComponent(datasetId) }/tables/${ encodeURIComponent(tableName) }/rows`),
      method: 'post',
      body: { rows },
      logTag: 'addRowsToTable',
    })

    return {
      message: 'Rows added successfully',
      datasetId,
      tableName,
      rowCount: rows.length,
    }
  }

  /**
   * @operationName Delete Rows from Table
   * @category Push Datasets
   * @appearanceColor #F2C811 #B78A00
   * @description Removes all rows from a table of a push dataset in the selected workspace or My workspace. The table schema is kept, so new rows can be added afterwards. Only supported for push datasets. Returns a confirmation message; the API returns no content on success.
   * @route DELETE /delete-rows-from-table
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","dictionary":"getWorkspacesDictionary","description":"The workspace containing the dataset. Choose a workspace or paste its ID. Leave empty to use My workspace."}
   * @paramDef {"type":"String","label":"Dataset","name":"datasetId","required":true,"dictionary":"getDatasetsDictionary","dependsOn":["workspaceId"],"description":"The push dataset whose table to clear. Choose a dataset from the selected workspace or paste a dataset ID."}
   * @paramDef {"type":"String","label":"Table Name","name":"tableName","required":true,"description":"The name of the table whose rows to remove, e.g. Sales."}
   * @returns {Object}
   * @sampleResult {"message":"All rows deleted successfully","datasetId":"3d43c17a-8bd9-4b0a-b33a-3b0f5da1c6a1","tableName":"Sales"}
   */
  async deleteRowsFromTable(workspaceId, datasetId, tableName) {
    if (!datasetId) {
      throw new Error('Parameter "Dataset" is required')
    }

    if (!tableName) {
      throw new Error('Parameter "Table Name" is required')
    }

    await this.#apiRequest({
      url: this.#scopedUrl(workspaceId, `/datasets/${ encodeURIComponent(datasetId) }/tables/${ encodeURIComponent(tableName) }/rows`),
      method: 'delete',
      logTag: 'deleteRowsFromTable',
    })

    return { message: 'All rows deleted successfully', datasetId, tableName }
  }

  /**
   * @operationName Update Table Schema
   * @category Push Datasets
   * @appearanceColor #F2C811 #B78A00
   * @description Updates the schema (column definitions) of a table in a push dataset in the selected workspace or My workspace. Existing rows may be dropped depending on the schema change. Only supported for push datasets. Returns a confirmation message; the API returns the updated table on success.
   * @route PUT /update-table-schema
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","dictionary":"getWorkspacesDictionary","description":"The workspace containing the dataset. Choose a workspace or paste its ID. Leave empty to use My workspace."}
   * @paramDef {"type":"String","label":"Dataset","name":"datasetId","required":true,"dictionary":"getDatasetsDictionary","dependsOn":["workspaceId"],"description":"The push dataset containing the table. Choose a dataset from the selected workspace or paste a dataset ID."}
   * @paramDef {"type":"String","label":"Table Name","name":"tableName","required":true,"description":"The name of the table whose schema to replace, e.g. Sales."}
   * @paramDef {"type":"Array<PushTableColumn>","label":"Columns","name":"columns","required":true,"description":"The new column definitions (name and data type) for the table. This replaces the existing schema."}
   * @returns {Object}
   * @sampleResult {"name":"Sales","columns":[{"name":"ProductID","dataType":"Int64"},{"name":"Amount","dataType":"Double"}]}
   */
  async updateTableSchema(workspaceId, datasetId, tableName, columns) {
    if (!datasetId) {
      throw new Error('Parameter "Dataset" is required')
    }

    if (!tableName) {
      throw new Error('Parameter "Table Name" is required')
    }

    if (!Array.isArray(columns) || columns.length === 0) {
      throw new Error('Parameter "Columns" must contain at least one column definition')
    }

    const [table] = this.#mapPushTables([{ name: tableName, columns }])

    return this.#apiRequest({
      url: this.#scopedUrl(workspaceId, `/datasets/${ encodeURIComponent(datasetId) }/tables/${ encodeURIComponent(tableName) }`),
      method: 'put',
      body: table,
      logTag: 'updateTableSchema',
    })
  }

  /**
   * @operationName List Reports
   * @category Reports
   * @appearanceColor #F2C811 #B78A00
   * @description Retrieves the reports in the selected workspace, or in My workspace when no workspace is chosen. Each report includes its ID, name, type (PowerBIReport or PaginatedReport), associated dataset ID, and web and embed URLs.
   * @route GET /list-reports
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","dictionary":"getWorkspacesDictionary","description":"The workspace to list reports from. Choose a workspace or paste its ID. Leave empty to use My workspace."}
   * @returns {Object}
   * @sampleResult {"value":[{"id":"5b218778-e7a5-4d73-8187-f10824047715","name":"Quarterly Sales","reportType":"PowerBIReport","datasetId":"cfafbeb1-8037-4d0c-896e-a46fb27ff229","webUrl":"https://app.powerbi.com/reports/5b218778-e7a5-4d73-8187-f10824047715"}]}
   */
  listReports(workspaceId) {
    return this.#apiRequest({
      url: this.#scopedUrl(workspaceId, '/reports'),
      logTag: 'listReports',
    })
  }

  /**
   * @operationName Get Report
   * @category Reports
   * @appearanceColor #F2C811 #B78A00
   * @description Retrieves a single report by ID from the selected workspace or My workspace, including its name, type, associated dataset ID, and web and embed URLs.
   * @route GET /get-report
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","dictionary":"getWorkspacesDictionary","description":"The workspace containing the report. Choose a workspace or paste its ID. Leave empty to use My workspace."}
   * @paramDef {"type":"String","label":"Report","name":"reportId","required":true,"dictionary":"getReportsDictionary","dependsOn":["workspaceId"],"description":"The report to fetch. Choose a report from the selected workspace or paste a report ID."}
   * @returns {Object}
   * @sampleResult {"id":"5b218778-e7a5-4d73-8187-f10824047715","name":"Quarterly Sales","reportType":"PowerBIReport","datasetId":"cfafbeb1-8037-4d0c-896e-a46fb27ff229","webUrl":"https://app.powerbi.com/reports/5b218778-e7a5-4d73-8187-f10824047715","embedUrl":"https://app.powerbi.com/reportEmbed?reportId=5b218778-e7a5-4d73-8187-f10824047715"}
   */
  async getReport(workspaceId, reportId) {
    if (!reportId) {
      throw new Error('Parameter "Report" is required')
    }

    return this.#apiRequest({
      url: this.#scopedUrl(workspaceId, `/reports/${ encodeURIComponent(reportId) }`),
      logTag: 'getReport',
    })
  }

  /**
   * @operationName Get Report Pages
   * @category Reports
   * @appearanceColor #F2C811 #B78A00
   * @description Retrieves the pages of a report in the selected workspace or My workspace, including each page's internal name, display name, and order. The internal page names can be used to export specific pages with Export Report to File.
   * @route GET /get-report-pages
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","dictionary":"getWorkspacesDictionary","description":"The workspace containing the report. Choose a workspace or paste its ID. Leave empty to use My workspace."}
   * @paramDef {"type":"String","label":"Report","name":"reportId","required":true,"dictionary":"getReportsDictionary","dependsOn":["workspaceId"],"description":"The report whose pages to fetch. Choose a report from the selected workspace or paste a report ID."}
   * @returns {Object}
   * @sampleResult {"value":[{"name":"ReportSection1","displayName":"Overview","order":0},{"name":"ReportSection2","displayName":"Regional Detail","order":1}]}
   */
  async getReportPages(workspaceId, reportId) {
    if (!reportId) {
      throw new Error('Parameter "Report" is required')
    }

    return this.#apiRequest({
      url: this.#scopedUrl(workspaceId, `/reports/${ encodeURIComponent(reportId) }/pages`),
      logTag: 'getReportPages',
    })
  }

  /**
   * @operationName Clone Report
   * @category Reports
   * @appearanceColor #F2C811 #B78A00
   * @description Creates a copy of a report in the selected workspace or My workspace. Optionally place the clone in a different target workspace and/or rebind it to a different dataset. Reports with a live connection lose that connection and get a direct binding to the target dataset. Requires write permission on the report and build permission on the target dataset if one is specified.
   * @route POST /clone-report
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","dictionary":"getWorkspacesDictionary","description":"The workspace containing the source report. Choose a workspace or paste its ID. Leave empty to use My workspace."}
   * @paramDef {"type":"String","label":"Report","name":"reportId","required":true,"dictionary":"getReportsDictionary","dependsOn":["workspaceId"],"description":"The report to clone. Choose a report from the selected workspace or paste a report ID."}
   * @paramDef {"type":"String","label":"New Report Name","name":"name","required":true,"description":"The name for the cloned report."}
   * @paramDef {"type":"String","label":"Target Workspace","name":"targetWorkspaceId","dictionary":"getWorkspacesDictionary","description":"Optional workspace to place the clone in. Use an empty GUID (00000000-0000-0000-0000-000000000000) for My workspace. Leave empty to clone within the source workspace."}
   * @paramDef {"type":"String","label":"Target Dataset ID","name":"targetModelId","description":"Optional dataset ID to associate the clone with. Leave empty to keep the source report's dataset."}
   * @returns {Object}
   * @sampleResult {"id":"8e9d51fc-b6b0-41c1-84c9-08b23d872c8b","name":"Quarterly Sales - Copy","reportType":"PowerBIReport","datasetId":"cfafbeb1-8037-4d0c-896e-a46fb27ff229","webUrl":"https://app.powerbi.com/reports/8e9d51fc-b6b0-41c1-84c9-08b23d872c8b"}
   */
  async cloneReport(workspaceId, reportId, name, targetWorkspaceId, targetModelId) {
    if (!reportId) {
      throw new Error('Parameter "Report" is required')
    }

    if (!name) {
      throw new Error('Parameter "New Report Name" is required')
    }

    return this.#apiRequest({
      url: this.#scopedUrl(workspaceId, `/reports/${ encodeURIComponent(reportId) }/Clone`),
      method: 'post',
      body: cleanupObject({ name, targetWorkspaceId, targetModelId }),
      logTag: 'cloneReport',
    })
  }

  /**
   * @operationName Delete Report
   * @category Reports
   * @appearanceColor #F2C811 #B78A00
   * @description Permanently deletes a report from the selected workspace or My workspace. This action cannot be undone. Returns a confirmation message; the API returns no content on success.
   * @route DELETE /delete-report
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","dictionary":"getWorkspacesDictionary","description":"The workspace containing the report. Choose a workspace or paste its ID. Leave empty to use My workspace."}
   * @paramDef {"type":"String","label":"Report","name":"reportId","required":true,"dictionary":"getReportsDictionary","dependsOn":["workspaceId"],"description":"The report to delete. Choose a report from the selected workspace or paste a report ID."}
   * @returns {Object}
   * @sampleResult {"message":"Report deleted successfully","reportId":"5b218778-e7a5-4d73-8187-f10824047715"}
   */
  async deleteReport(workspaceId, reportId) {
    if (!reportId) {
      throw new Error('Parameter "Report" is required')
    }

    await this.#apiRequest({
      url: this.#scopedUrl(workspaceId, `/reports/${ encodeURIComponent(reportId) }`),
      method: 'delete',
      logTag: 'deleteReport',
    })

    return { message: 'Report deleted successfully', reportId }
  }

  /**
   * @operationName Export Report to File
   * @category Report Export
   * @appearanceColor #F2C811 #B78A00
   * @executionTimeoutInSeconds 300
   * @description Exports a report to PDF, PowerPoint, or PNG, waits for the asynchronous export job to finish, downloads the result, and saves it to FlowRunner file storage, returning a URL to the stored file. Optionally export only specific pages (use Get Report Pages to find the internal page names) or include hidden pages. Requires the report's workspace to be on Premium, Embedded, or Fabric capacity. Waits up to about 4 minutes; for longer exports use Start Report Export, Get Report Export Status, and Save Exported Report File instead. PNG is only supported for Power BI (non-paginated) reports.
   * @route POST /export-report-to-file
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","dictionary":"getWorkspacesDictionary","description":"The workspace containing the report. Choose a workspace or paste its ID. Leave empty to use My workspace."}
   * @paramDef {"type":"String","label":"Report","name":"reportId","required":true,"dictionary":"getReportsDictionary","dependsOn":["workspaceId"],"description":"The report to export. Choose a report from the selected workspace or paste a report ID."}
   * @paramDef {"type":"String","label":"Format","name":"format","required":true,"defaultValue":"PDF","uiComponent":{"type":"DROPDOWN","options":{"values":["PDF","PowerPoint","PNG"]}},"description":"The file format to export to. PNG is only supported for Power BI (non-paginated) reports."}
   * @paramDef {"type":"Array<String>","label":"Pages","name":"pages","description":"Optional list of internal page names to export (e.g. ReportSection1). Leave empty to export the whole report. Use Get Report Pages to look up page names."}
   * @paramDef {"type":"Boolean","label":"Include Hidden Pages","name":"includeHiddenPages","uiComponent":{"type":"TOGGLE"},"description":"Whether hidden pages are included when exporting the whole report. Ignored when specific pages are listed. Defaults to false."}
   * @paramDef {"type":"String","label":"Locale","name":"locale","description":"Optional locale to apply to the export, e.g. en-US or de-DE."}
   * @paramDef {"type":"FilesUploadOptions","label":"File Settings","name":"fileOptions","required":false,"include":["scope"],"description":"Where to store the exported file in FlowRunner. Defaults to the FLOW scope."}
   * @returns {Object}
   * @sampleResult {"fileUrl":"https://storage.flowrunner.com/files/flow/Quarterly Sales.pdf","fileName":"Quarterly Sales.pdf","size":183220,"reportId":"5b218778-e7a5-4d73-8187-f10824047715","exportId":"Mi9nGkpKTUuFkQ2sfDIYPw==","reportName":"Quarterly Sales"}
   */
  async exportReportToFile(workspaceId, reportId, format, pages, includeHiddenPages, locale, fileOptions) {
    if (!reportId) {
      throw new Error('Parameter "Report" is required')
    }

    const exportJob = await this.#startExport({
      workspaceId,
      reportId,
      format,
      pages,
      includeHiddenPages,
      locale,
      logTag: 'exportReportToFile',
    })

    const deadline = Date.now() + EXPORT_WAIT_LIMIT_MS
    let exportStatus = exportJob

    while (exportStatus.status !== 'Succeeded') {
      if (exportStatus.status === 'Failed') {
        throw new Error(`Report export failed (export ID: ${ exportJob.id })`)
      }

      if (Date.now() > deadline) {
        throw new Error(`Report export did not finish in time (export ID: ${ exportJob.id }, last status: ${ exportStatus.status }). Use Get Report Export Status and Save Exported Report File to retrieve it once complete.`)
      }

      await this.#sleep(EXPORT_POLL_INTERVAL_MS)

      exportStatus = await this.#apiRequest({
        url: this.#scopedUrl(workspaceId, `/reports/${ encodeURIComponent(reportId) }/exports/${ encodeURIComponent(exportJob.id) }`),
        logTag: 'exportReportToFile',
      })

      logger.debug(`exportReportToFile - export ${ exportJob.id } status: ${ exportStatus.status } (${ exportStatus.percentComplete }%)`)
    }

    return this.#saveExportToStorage({
      workspaceId,
      reportId,
      exportStatus,
      fileOptions,
      logTag: 'exportReportToFile',
    })
  }

  async #startExport({ workspaceId, reportId, format, pages, includeHiddenPages, locale, logTag }) {
    const resolvedFormat = this.#resolveChoice(format, EXPORT_FORMAT_MAPPING) || 'PDF'

    const settings = cleanupObject({ includeHiddenPages, locale })

    const configuration = cleanupObject({
      pages: Array.isArray(pages) && pages.length ? pages.map(pageName => ({ pageName })) : undefined,
      settings: Object.keys(settings).length ? settings : undefined,
    })

    const body = {
      format: resolvedFormat,
      ...(Object.keys(configuration).length ? { powerBIReportConfiguration: configuration } : {}),
    }

    return this.#apiRequest({
      url: this.#scopedUrl(workspaceId, `/reports/${ encodeURIComponent(reportId) }/ExportTo`),
      method: 'post',
      body,
      logTag,
    })
  }

  /**
   * @operationName Start Report Export
   * @category Report Export
   * @appearanceColor #F2C811 #B78A00
   * @description Starts an asynchronous export job for a report to PDF, PowerPoint, or PNG and returns immediately with the export job ID. Track progress with Get Report Export Status and retrieve the finished file with Save Exported Report File. Use this instead of Export Report to File when exports take longer than a few minutes. Requires the report's workspace to be on Premium, Embedded, or Fabric capacity.
   * @route POST /start-report-export
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","dictionary":"getWorkspacesDictionary","description":"The workspace containing the report. Choose a workspace or paste its ID. Leave empty to use My workspace."}
   * @paramDef {"type":"String","label":"Report","name":"reportId","required":true,"dictionary":"getReportsDictionary","dependsOn":["workspaceId"],"description":"The report to export. Choose a report from the selected workspace or paste a report ID."}
   * @paramDef {"type":"String","label":"Format","name":"format","required":true,"defaultValue":"PDF","uiComponent":{"type":"DROPDOWN","options":{"values":["PDF","PowerPoint","PNG"]}},"description":"The file format to export to. PNG is only supported for Power BI (non-paginated) reports."}
   * @paramDef {"type":"Array<String>","label":"Pages","name":"pages","description":"Optional list of internal page names to export (e.g. ReportSection1). Leave empty to export the whole report. Use Get Report Pages to look up page names."}
   * @paramDef {"type":"Boolean","label":"Include Hidden Pages","name":"includeHiddenPages","uiComponent":{"type":"TOGGLE"},"description":"Whether hidden pages are included when exporting the whole report. Ignored when specific pages are listed. Defaults to false."}
   * @paramDef {"type":"String","label":"Locale","name":"locale","description":"Optional locale to apply to the export, e.g. en-US or de-DE."}
   * @returns {Object}
   * @sampleResult {"id":"Mi9nGkpKTUuFkQ2sfDIYPw==","createdDateTime":"2026-07-16T12:00:00Z","status":"Running","percentComplete":0,"reportId":"5b218778-e7a5-4d73-8187-f10824047715","reportName":"Quarterly Sales"}
   */
  async startReportExport(workspaceId, reportId, format, pages, includeHiddenPages, locale) {
    if (!reportId) {
      throw new Error('Parameter "Report" is required')
    }

    return this.#startExport({
      workspaceId,
      reportId,
      format,
      pages,
      includeHiddenPages,
      locale,
      logTag: 'startReportExport',
    })
  }

  /**
   * @operationName Get Report Export Status
   * @category Report Export
   * @appearanceColor #F2C811 #B78A00
   * @description Retrieves the status of an asynchronous report export job started with Start Report Export, including its state (NotStarted, Running, Succeeded, or Failed), progress percentage, and the resulting file extension once complete.
   * @route GET /get-report-export-status
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","dictionary":"getWorkspacesDictionary","description":"The workspace containing the report. Choose a workspace or paste its ID. Leave empty to use My workspace."}
   * @paramDef {"type":"String","label":"Report","name":"reportId","required":true,"dictionary":"getReportsDictionary","dependsOn":["workspaceId"],"description":"The exported report. Choose a report from the selected workspace or paste a report ID."}
   * @paramDef {"type":"String","label":"Export ID","name":"exportId","required":true,"description":"The export job ID returned by Start Report Export."}
   * @returns {Object}
   * @sampleResult {"id":"Mi9nGkpKTUuFkQ2sfDIYPw==","createdDateTime":"2026-07-16T12:00:00Z","lastActionDateTime":"2026-07-16T12:01:30Z","status":"Succeeded","percentComplete":100,"reportId":"5b218778-e7a5-4d73-8187-f10824047715","reportName":"Quarterly Sales","resourceFileExtension":".pdf"}
   */
  async getReportExportStatus(workspaceId, reportId, exportId) {
    if (!reportId) {
      throw new Error('Parameter "Report" is required')
    }

    if (!exportId) {
      throw new Error('Parameter "Export ID" is required')
    }

    return this.#apiRequest({
      url: this.#scopedUrl(workspaceId, `/reports/${ encodeURIComponent(reportId) }/exports/${ encodeURIComponent(exportId) }`),
      logTag: 'getReportExportStatus',
    })
  }

  /**
   * @operationName Save Exported Report File
   * @category Report Export
   * @appearanceColor #F2C811 #B78A00
   * @executionTimeoutInSeconds 300
   * @description Downloads the file produced by a completed report export job and saves it to FlowRunner file storage, returning a URL to the stored file. The export job must have reached the Succeeded state (check with Get Report Export Status). The whole file is loaded into memory during transfer, so keep exports within the memory available to this function.
   * @route POST /save-exported-report-file
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","dictionary":"getWorkspacesDictionary","description":"The workspace containing the report. Choose a workspace or paste its ID. Leave empty to use My workspace."}
   * @paramDef {"type":"String","label":"Report","name":"reportId","required":true,"dictionary":"getReportsDictionary","dependsOn":["workspaceId"],"description":"The exported report. Choose a report from the selected workspace or paste a report ID."}
   * @paramDef {"type":"String","label":"Export ID","name":"exportId","required":true,"description":"The export job ID returned by Start Report Export."}
   * @paramDef {"type":"String","label":"File Name","name":"fileName","description":"Optional name for the stored file, including or excluding the extension. Defaults to the report name with the export's file extension."}
   * @paramDef {"type":"FilesUploadOptions","label":"File Settings","name":"fileOptions","required":false,"include":["scope"],"description":"Where to store the exported file in FlowRunner. Defaults to the FLOW scope."}
   * @returns {Object}
   * @sampleResult {"fileUrl":"https://storage.flowrunner.com/files/flow/Quarterly Sales.pdf","fileName":"Quarterly Sales.pdf","size":183220,"reportId":"5b218778-e7a5-4d73-8187-f10824047715","exportId":"Mi9nGkpKTUuFkQ2sfDIYPw==","reportName":"Quarterly Sales"}
   */
  async saveExportedReportFile(workspaceId, reportId, exportId, fileName, fileOptions) {
    if (!reportId) {
      throw new Error('Parameter "Report" is required')
    }

    if (!exportId) {
      throw new Error('Parameter "Export ID" is required')
    }

    const exportStatus = await this.#apiRequest({
      url: this.#scopedUrl(workspaceId, `/reports/${ encodeURIComponent(reportId) }/exports/${ encodeURIComponent(exportId) }`),
      logTag: 'saveExportedReportFile',
    })

    if (exportStatus.status !== 'Succeeded') {
      throw new Error(`The export job is not complete yet (current status: ${ exportStatus.status }). Retry once Get Report Export Status reports Succeeded.`)
    }

    return this.#saveExportToStorage({
      workspaceId,
      reportId,
      exportStatus,
      fileName,
      fileOptions,
      logTag: 'saveExportedReportFile',
    })
  }

  /**
   * @operationName List Dashboards
   * @category Dashboards
   * @appearanceColor #F2C811 #B78A00
   * @description Retrieves the dashboards in the selected workspace, or in My workspace when no workspace is chosen. Each dashboard includes its ID, display name, read-only flag, and web and embed URLs.
   * @route GET /list-dashboards
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","dictionary":"getWorkspacesDictionary","description":"The workspace to list dashboards from. Choose a workspace or paste its ID. Leave empty to use My workspace."}
   * @returns {Object}
   * @sampleResult {"value":[{"id":"69ffaa6c-b36d-4d01-96f5-1ed67c64d4af","displayName":"Executive Overview","isReadOnly":false,"webUrl":"https://app.powerbi.com/dashboards/69ffaa6c-b36d-4d01-96f5-1ed67c64d4af"}]}
   */
  listDashboards(workspaceId) {
    return this.#apiRequest({
      url: this.#scopedUrl(workspaceId, '/dashboards'),
      logTag: 'listDashboards',
    })
  }

  /**
   * @operationName Get Dashboard
   * @category Dashboards
   * @appearanceColor #F2C811 #B78A00
   * @description Retrieves a single dashboard by ID from the selected workspace or My workspace, including its display name, read-only flag, and web and embed URLs.
   * @route GET /get-dashboard
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","dictionary":"getWorkspacesDictionary","description":"The workspace containing the dashboard. Choose a workspace or paste its ID. Leave empty to use My workspace."}
   * @paramDef {"type":"String","label":"Dashboard","name":"dashboardId","required":true,"dictionary":"getDashboardsDictionary","dependsOn":["workspaceId"],"description":"The dashboard to fetch. Choose a dashboard from the selected workspace or paste a dashboard ID."}
   * @returns {Object}
   * @sampleResult {"id":"69ffaa6c-b36d-4d01-96f5-1ed67c64d4af","displayName":"Executive Overview","isReadOnly":false,"webUrl":"https://app.powerbi.com/dashboards/69ffaa6c-b36d-4d01-96f5-1ed67c64d4af","embedUrl":"https://app.powerbi.com/dashboardEmbed?dashboardId=69ffaa6c-b36d-4d01-96f5-1ed67c64d4af"}
   */
  async getDashboard(workspaceId, dashboardId) {
    if (!dashboardId) {
      throw new Error('Parameter "Dashboard" is required')
    }

    return this.#apiRequest({
      url: this.#scopedUrl(workspaceId, `/dashboards/${ encodeURIComponent(dashboardId) }`),
      logTag: 'getDashboard',
    })
  }

  /**
   * @operationName List Dashboard Tiles
   * @category Dashboards
   * @appearanceColor #F2C811 #B78A00
   * @description Retrieves the tiles of a dashboard in the selected workspace or My workspace, including each tile's ID, title, size, position, and the report and dataset it is built on.
   * @route GET /list-dashboard-tiles
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","dictionary":"getWorkspacesDictionary","description":"The workspace containing the dashboard. Choose a workspace or paste its ID. Leave empty to use My workspace."}
   * @paramDef {"type":"String","label":"Dashboard","name":"dashboardId","required":true,"dictionary":"getDashboardsDictionary","dependsOn":["workspaceId"],"description":"The dashboard whose tiles to fetch. Choose a dashboard from the selected workspace or paste a dashboard ID."}
   * @returns {Object}
   * @sampleResult {"value":[{"id":"312fbfe9-2eda-44e0-9ed0-ab5dc571bb4b","title":"Revenue by Region","rowSpan":4,"colSpan":4,"reportId":"5b218778-e7a5-4d73-8187-f10824047715","datasetId":"cfafbeb1-8037-4d0c-896e-a46fb27ff229"}]}
   */
  async listDashboardTiles(workspaceId, dashboardId) {
    if (!dashboardId) {
      throw new Error('Parameter "Dashboard" is required')
    }

    return this.#apiRequest({
      url: this.#scopedUrl(workspaceId, `/dashboards/${ encodeURIComponent(dashboardId) }/tiles`),
      logTag: 'listDashboardTiles',
    })
  }

  /**
   * @operationName List Dataflows
   * @category Dataflows
   * @appearanceColor #F2C811 #B78A00
   * @description Retrieves the dataflows in a shared workspace, including each dataflow's object ID, name, description, and model URL. Dataflows only exist in shared workspaces, so a workspace is required.
   * @route GET /list-dataflows
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"The shared workspace to list dataflows from. Choose a workspace or paste its ID."}
   * @returns {Object}
   * @sampleResult {"value":[{"objectId":"928228ba-008d-4fd9-864a-92d2752ee5ce","name":"Customer Orders","description":"Curated order data","modelUrl":"https://myorg-my.sharepoint.com/personal/model.json"}]}
   */
  async listDataflows(workspaceId) {
    if (!workspaceId) {
      throw new Error('Parameter "Workspace" is required')
    }

    return this.#apiRequest({
      url: this.#scopedUrl(workspaceId, '/dataflows'),
      logTag: 'listDataflows',
    })
  }

  /**
   * @operationName Refresh Dataflow
   * @category Dataflows
   * @appearanceColor #F2C811 #B78A00
   * @description Triggers an asynchronous refresh for a dataflow in a shared workspace. Mail notification can be sent on failure; Mail On Completion is not supported for dataflows. Returns a confirmation message; the API returns no content on success.
   * @route POST /refresh-dataflow
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"The shared workspace containing the dataflow. Choose a workspace or paste its ID."}
   * @paramDef {"type":"String","label":"Dataflow","name":"dataflowId","required":true,"dictionary":"getDataflowsDictionary","dependsOn":["workspaceId"],"description":"The dataflow to refresh. Choose a dataflow from the selected workspace or paste its object ID."}
   * @paramDef {"type":"String","label":"Notify Option","name":"notifyOption","defaultValue":"No Notification","uiComponent":{"type":"DROPDOWN","options":{"values":["No Notification","Mail On Failure"]}},"description":"Whether Power BI should send a mail notification if the refresh fails. Defaults to No Notification."}
   * @paramDef {"type":"String","label":"Process Type","name":"processType","description":"Optional type of refresh process to use, e.g. default. Leave empty unless a specific process type is required."}
   * @returns {Object}
   * @sampleResult {"message":"Dataflow refresh triggered successfully","dataflowId":"928228ba-008d-4fd9-864a-92d2752ee5ce","notifyOption":"NoNotification"}
   */
  async refreshDataflow(workspaceId, dataflowId, notifyOption, processType) {
    if (!workspaceId) {
      throw new Error('Parameter "Workspace" is required')
    }

    if (!dataflowId) {
      throw new Error('Parameter "Dataflow" is required')
    }

    const resolvedNotifyOption = this.#resolveChoice(notifyOption, NOTIFY_OPTION_MAPPING) || 'NoNotification'

    await this.#apiRequest({
      url: this.#scopedUrl(workspaceId, `/dataflows/${ encodeURIComponent(dataflowId) }/refreshes`),
      method: 'post',
      query: { processType },
      body: { notifyOption: resolvedNotifyOption },
      logTag: 'refreshDataflow',
    })

    return {
      message: 'Dataflow refresh triggered successfully',
      dataflowId,
      notifyOption: resolvedNotifyOption,
    }
  }

  /**
   * @operationName List Apps
   * @category Apps
   * @appearanceColor #F2C811 #B78A00
   * @description Retrieves the Power BI apps installed for the connected user, including each app's ID, name, description, publisher, and last update time.
   * @route GET /list-apps
   * @returns {Object}
   * @sampleResult {"value":[{"id":"f089354e-8366-4e18-aea3-4cb4a3a50b48","name":"Finance","description":"The finance app","publishedBy":"Bill","lastUpdate":"2026-01-13T09:46:53.094+02:00"}]}
   */
  listApps() {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/apps`,
      logTag: 'listApps',
    })
  }

  /**
   * @operationName Get App
   * @category Apps
   * @appearanceColor #F2C811 #B78A00
   * @description Retrieves a single installed Power BI app by ID, including its name, description, publisher, and last update time. The app must be installed for the connected user.
   * @route GET /get-app
   * @paramDef {"type":"String","label":"App ID","name":"appId","required":true,"description":"The ID of the installed app. Use List Apps to look up app IDs."}
   * @returns {Object}
   * @sampleResult {"id":"f089354e-8366-4e18-aea3-4cb4a3a50b48","name":"Finance","description":"The finance app","publishedBy":"Bill","lastUpdate":"2026-01-13T09:46:53.094+02:00"}
   */
  async getApp(appId) {
    if (!appId) {
      throw new Error('Parameter "App ID" is required')
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/apps/${ encodeURIComponent(appId) }`,
      logTag: 'getApp',
    })
  }

  /**
   * @operationName List App Reports
   * @category Apps
   * @appearanceColor #F2C811 #B78A00
   * @description Retrieves the reports published in an installed Power BI app, including each report's ID, name, associated dataset, and web and embed URLs. The app must be installed for the connected user.
   * @route GET /list-app-reports
   * @paramDef {"type":"String","label":"App ID","name":"appId","required":true,"description":"The ID of the installed app whose reports to list. Use List Apps to look up app IDs."}
   * @returns {Object}
   * @sampleResult {"value":[{"id":"66b2570c-d9d3-40b2-83d9-1095c6700041","name":"[App] Quarterly Sales","reportType":"PowerBIReport","appId":"f089354e-8366-4e18-aea3-4cb4a3a50b48","datasetId":"cfafbeb1-8037-4d0c-896e-a46fb27ff229"}]}
   */
  async listAppReports(appId) {
    if (!appId) {
      throw new Error('Parameter "App ID" is required')
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/apps/${ encodeURIComponent(appId) }/reports`,
      logTag: 'listAppReports',
    })
  }

  /**
   * @operationName List App Dashboards
   * @category Apps
   * @appearanceColor #F2C811 #B78A00
   * @description Retrieves the dashboards published in an installed Power BI app, including each dashboard's ID, display name, and embed URL. The app must be installed for the connected user.
   * @route GET /list-app-dashboards
   * @paramDef {"type":"String","label":"App ID","name":"appId","required":true,"description":"The ID of the installed app whose dashboards to list. Use List Apps to look up app IDs."}
   * @returns {Object}
   * @sampleResult {"value":[{"id":"03dac094-2ff8-47e8-b2b9-dedbbc4d22ac","displayName":"[App] Executive Overview","isReadOnly":true,"appId":"f089354e-8366-4e18-aea3-4cb4a3a50b48"}]}
   */
  async listAppDashboards(appId) {
    if (!appId) {
      throw new Error('Parameter "App ID" is required')
    }

    return this.#apiRequest({
      url: `${ API_BASE_URL }/apps/${ encodeURIComponent(appId) }/dashboards`,
      logTag: 'listAppDashboards',
    })
  }

  /**
   * @operationName List Imports
   * @category Platform
   * @appearanceColor #F2C811 #B78A00
   * @description Retrieves the imports (uploaded PBIX files and other content publications) in the selected workspace or My workspace, including each import's ID, name, state, and the reports and datasets it produced.
   * @route GET /list-imports
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","dictionary":"getWorkspacesDictionary","description":"The workspace to list imports from. Choose a workspace or paste its ID. Leave empty to use My workspace."}
   * @returns {Object}
   * @sampleResult {"value":[{"id":"82d9a37a-2b45-4221-b012-cb109b8e30c7","importState":"Succeeded","name":"SalesMarketing.pbix","createdDateTime":"2026-06-13T09:51:43.540Z","reports":[{"id":"5b218778-e7a5-4d73-8187-f10824047715","name":"SalesMarketing"}]}]}
   */
  listImports(workspaceId) {
    return this.#apiRequest({
      url: this.#scopedUrl(workspaceId, '/imports'),
      logTag: 'listImports',
    })
  }

  /**
   * @operationName List Gateways
   * @category Platform
   * @appearanceColor #F2C811 #B78A00
   * @description Retrieves the on-premises data gateways the connected user administers, including each gateway's ID, name, type, and public key. Only gateways for which the user has admin permission are returned; virtual network gateways are not supported.
   * @route GET /list-gateways
   * @returns {Object}
   * @sampleResult {"value":[{"id":"1f69e798-5852-4fdd-ab01-33bb14b6e934","name":"My_Sample_Gateway","type":"Resource","gatewayStatus":"Live"}]}
   */
  listGateways() {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/gateways`,
      logTag: 'listGateways',
    })
  }

  /**
   * @operationName List Capacities
   * @category Platform
   * @appearanceColor #F2C811 #B78A00
   * @description Retrieves the Premium, Embedded, and Fabric capacities the connected user has access to, including each capacity's ID, display name, SKU, state, and region.
   * @route GET /list-capacities
   * @returns {Object}
   * @sampleResult {"value":[{"id":"0f084df7-c13d-451b-af5f-ed0c466403b2","displayName":"MyCapacity","sku":"A1","state":"Active","region":"West Central US","capacityUserAccessRight":"Admin"}]}
   */
  listCapacities() {
    return this.#apiRequest({
      url: `${ API_BASE_URL }/capacities`,
      logTag: 'listCapacities',
    })
  }
}

Flowrunner.ServerCode.addService(MicrosoftPowerBIService, [
  {
    name: 'clientId',
    displayName: 'Client ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'OAuth2 Client ID (Application ID) of your Microsoft Entra app registration with Power BI Service delegated permissions.',
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
  if (user.email && user.name) {
    return `${ user.email } (${ user.name })`
  }

  return user.email || user.name || 'Microsoft Power BI Connection'
}
