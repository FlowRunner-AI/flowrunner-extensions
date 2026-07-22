'use strict'

const { createSandbox } = require('../../../service-sandbox')

const CLIENT_ID = 'test-client-id'
const CLIENT_SECRET = 'test-client-secret'
const ACCESS_TOKEN = 'test-access-token'

const OAUTH_BASE = 'https://login.microsoftonline.com/common/oauth2/v2.0'
const API_BASE = 'https://api.powerbi.com/v1.0/myorg'
const POWER_BI_RESOURCE = 'https://analysis.windows.net/powerbi/api'

const WORKSPACE_ID = 'f089354e-8366-4e18-aea3-4cb4a3a50b48'
const GROUP_BASE = `${ API_BASE }/groups/${ WORKSPACE_ID }`
const DATASET_ID = 'cfafbeb1-8037-4d0c-896e-a46fb27ff229'
const REPORT_ID = '5b218778-e7a5-4d73-8187-f10824047715'
const DASHBOARD_ID = '69ffaa6c-b36d-4d01-96f5-1ed67c64d4af'
const DATAFLOW_ID = '928228ba-008d-4fd9-864a-92d2752ee5ce'
const APP_ID = 'a1b2c3d4-0000-1111-2222-333344445555'
const EXPORT_ID = 'export-1'

const AUTH_HEADER = { Authorization: `Bearer ${ ACCESS_TOKEN }` }

function makeJwt(payload) {
  const encoded = Buffer.from(JSON.stringify(payload))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')

  return `headerpart.${ encoded }.signaturepart`
}

describe('Microsoft Power BI Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
    })

    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()

    service.request = { headers: { 'oauth-access-token': ACCESS_TOKEN } }
  })

  afterEach(() => {
    mock.reset()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Registration ──

  describe('service registration', () => {
    it('registers with correct config items', () => {
      expect(sandbox.getConfigItems()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'clientId', required: true, shared: true }),
          expect.objectContaining({ name: 'clientSecret', required: true, shared: true }),
        ])
      )
    })

    it('stores credentials and default scopes', () => {
      expect(service.clientId).toBe(CLIENT_ID)
      expect(service.clientSecret).toBe(CLIENT_SECRET)
      expect(service.scopes).toContain('offline_access')
      expect(service.scopes).toContain(`${ POWER_BI_RESOURCE }/Dataset.ReadWrite.All`)
    })
  })

  // ── OAuth system methods ──

  describe('getOAuth2ConnectionURL', () => {
    it('builds the authorization URL with client id and scopes', async () => {
      const url = await service.getOAuth2ConnectionURL()

      expect(url).toContain(`${ OAUTH_BASE }/authorize?`)
      expect(url).toContain(`client_id=${ CLIENT_ID }`)
      expect(url).toContain('response_type=code')
      expect(url).toContain('response_mode=query')
      expect(url).toContain(encodeURIComponent('offline_access'))
      expect(url).toContain(encodeURIComponent(`${ POWER_BI_RESOURCE }/Report.ReadWrite.All`))
    })
  })

  describe('executeCallback', () => {
    it('exchanges the code and derives identity from the id_token', async () => {
      const idToken = makeJwt({
        name: 'John Doe',
        email: 'john@contoso.com',
        oid: 'object-id-1',
        tid: 'tenant-id-1',
      })

      mock.onPost(`${ OAUTH_BASE }/token`).reply({
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        expires_in: 3600,
        id_token: idToken,
      })

      const result = await service.executeCallback({
        code: 'auth-code-123',
        redirectURI: 'https://redirect.example.com/callback',
      })

      expect(result).toEqual({
        token: 'new-access-token',
        refreshToken: 'new-refresh-token',
        expirationInSeconds: 3600,
        connectionIdentityName: 'john@contoso.com (John Doe)',
        overwrite: true,
        userData: {
          name: 'John Doe',
          email: 'john@contoso.com',
          objectId: 'object-id-1',
          tenantId: 'tenant-id-1',
        },
      })

      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ OAUTH_BASE }/token`)

      expect(mock.history[0].headers).toMatchObject({
        'Content-Type': 'application/x-www-form-urlencoded',
      })

      expect(mock.history[0].body).toContain('grant_type=authorization_code')
      expect(mock.history[0].body).toContain('code=auth-code-123')
      expect(mock.history[0].body).toContain(`client_id=${ CLIENT_ID }`)
      expect(mock.history[0].body).toContain(`client_secret=${ CLIENT_SECRET }`)

      expect(mock.history[0].body).toContain(
        `redirect_uri=${ encodeURIComponent('https://redirect.example.com/callback') }`
      )
    })

    it('falls back to the access token claims when no id_token is returned', async () => {
      mock.onPost(`${ OAUTH_BASE }/token`).reply({
        access_token: makeJwt({ preferred_username: 'jane@contoso.com' }),
        refresh_token: 'refresh-2',
        expires_in: 1800,
      })

      const result = await service.executeCallback({ code: 'c', redirectURI: 'https://r' })

      expect(result.userData).toEqual({
        name: null,
        email: 'jane@contoso.com',
        objectId: null,
        tenantId: null,
      })

      expect(result.connectionIdentityName).toBe('jane@contoso.com')
    })

    it('falls back to a default identity name when the token cannot be decoded', async () => {
      mock.onPost(`${ OAUTH_BASE }/token`).reply({
        access_token: 'not-a-jwt',
        refresh_token: 'refresh-3',
        expires_in: 60,
      })

      const result = await service.executeCallback({ code: 'c', redirectURI: 'https://r' })

      expect(result.connectionIdentityName).toBe('Microsoft Power BI Connection')
      expect(result.userData).toEqual({ name: null, email: null, objectId: null, tenantId: null })
    })

    it('uses the name alone when no email claim is present', async () => {
      mock.onPost(`${ OAUTH_BASE }/token`).reply({
        access_token: 'a',
        refresh_token: 'r',
        expires_in: 60,
        id_token: makeJwt({ name: 'Nameless Email' }),
      })

      const result = await service.executeCallback({ code: 'c', redirectURI: 'https://r' })

      expect(result.connectionIdentityName).toBe('Nameless Email')
    })

    it('propagates token endpoint errors', async () => {
      mock.onPost(`${ OAUTH_BASE }/token`).replyWithError({ message: 'invalid_grant' })

      await expect(service.executeCallback({ code: 'bad', redirectURI: 'https://r' }))
        .rejects.toThrow('invalid_grant')
    })
  })

  describe('refreshToken', () => {
    it('requests a new token with the refresh grant', async () => {
      mock.onPost(`${ OAUTH_BASE }/token`).reply({
        access_token: 'refreshed-token',
        refresh_token: 'refreshed-refresh',
        expires_in: 3599,
      })

      const result = await service.refreshToken('old-refresh-token')

      expect(result).toEqual({
        token: 'refreshed-token',
        refreshToken: 'refreshed-refresh',
        expirationInSeconds: 3599,
      })

      expect(mock.history[0].body).toContain('grant_type=refresh_token')
      expect(mock.history[0].body).toContain('refresh_token=old-refresh-token')
      expect(mock.history[0].body).toContain(`client_secret=${ CLIENT_SECRET }`)
    })

    it('rethrows refresh failures', async () => {
      mock.onPost(`${ OAUTH_BASE }/token`).replyWithError({ message: 'expired refresh token' })

      await expect(service.refreshToken('old')).rejects.toThrow('expired refresh token')
    })
  })

  // ── Dictionaries ──

  describe('getWorkspacesDictionary', () => {
    it('maps workspaces and returns a null cursor for a short page', async () => {
      mock.onGet(`${ API_BASE }/groups`).reply({
        value: [
          { id: WORKSPACE_ID, name: 'Sales Analytics', isOnDedicatedCapacity: true },
          { id: 'ws-2', name: 'Ops' },
        ],
      })

      const result = await service.getWorkspacesDictionary({})

      expect(result).toEqual({
        cursor: null,
        items: [
          { label: 'Sales Analytics', value: WORKSPACE_ID, note: 'On dedicated capacity' },
          { label: 'Ops', value: 'ws-2', note: 'ID: ws-2' },
        ],
      })

      expect(mock.history[0].headers).toMatchObject(AUTH_HEADER)
      expect(mock.history[0].query).toEqual({ $top: 100 })
    })

    it('handles a null payload and an empty response', async () => {
      mock.onGet(`${ API_BASE }/groups`).reply({})

      const result = await service.getWorkspacesDictionary(null)

      expect(result).toEqual({ cursor: null, items: [] })
    })

    it('applies the search filter with escaped quotes', async () => {
      mock.onGet(`${ API_BASE }/groups`).reply({ value: [] })

      await service.getWorkspacesDictionary({ search: "O'Brien" })

      expect(mock.history[0].query.$filter).toBe("contains(name,'O''Brien')")
    })

    it('paginates with the cursor and returns the next cursor on a full page', async () => {
      const value = Array.from({ length: 100 }, (_, index) => ({ id: `id-${ index }`, name: `WS ${ index }` }))

      mock.onGet(`${ API_BASE }/groups`).reply({ value })

      const result = await service.getWorkspacesDictionary({ cursor: '100' })

      expect(mock.history[0].query).toEqual({ $top: 100, $skip: 100 })
      expect(result.cursor).toBe('200')
      expect(result.items).toHaveLength(100)
    })

    it('falls back to the id as label when the workspace has no name', async () => {
      mock.onGet(`${ API_BASE }/groups`).reply({ value: [{ id: 'ws-9' }] })

      const result = await service.getWorkspacesDictionary({ cursor: 'not-a-number' })

      expect(result.items[0]).toEqual({ label: 'ws-9', value: 'ws-9', note: 'ID: ws-9' })
      expect(mock.history[0].query).toEqual({ $top: 100 })
    })
  })

  describe('getDatasetsDictionary', () => {
    it('lists datasets of a workspace', async () => {
      mock.onGet(`${ GROUP_BASE }/datasets`).reply({
        value: [{ id: DATASET_ID, name: 'SalesMarketing', configuredBy: 'john@contoso.com' }],
      })

      const result = await service.getDatasetsDictionary({ criteria: { workspaceId: WORKSPACE_ID } })

      expect(result).toEqual({
        cursor: null,
        items: [
          { label: 'SalesMarketing', value: DATASET_ID, note: 'Configured by john@contoso.com' },
        ],
      })
    })

    it('uses My workspace when no criteria are provided and filters by search', async () => {
      mock.onGet(`${ API_BASE }/datasets`).reply({
        value: [
          { id: '1', name: 'Alpha' },
          { id: '2', name: 'Beta' },
        ],
      })

      const result = await service.getDatasetsDictionary({ search: 'BET' })

      expect(mock.history[0].url).toBe(`${ API_BASE }/datasets`)
      expect(result.items).toEqual([{ label: 'Beta', value: '2', note: 'ID: 2' }])
    })

    it('handles a null payload and missing value array', async () => {
      mock.onGet(`${ API_BASE }/datasets`).reply({})

      await expect(service.getDatasetsDictionary(null)).resolves.toEqual({ cursor: null, items: [] })
    })
  })

  describe('getReportsDictionary', () => {
    it('maps reports with the report type as note', async () => {
      mock.onGet(`${ GROUP_BASE }/reports`).reply({
        value: [
          { id: REPORT_ID, name: 'Quarterly Sales', reportType: 'PowerBIReport' },
          { id: 'r-2' },
        ],
      })

      const result = await service.getReportsDictionary({ criteria: { workspaceId: WORKSPACE_ID } })

      expect(result).toEqual({
        cursor: null,
        items: [
          { label: 'Quarterly Sales', value: REPORT_ID, note: 'PowerBIReport' },
          { label: 'r-2', value: 'r-2', note: 'ID: r-2' },
        ],
      })
    })

    it('filters reports by search', async () => {
      mock.onGet(`${ API_BASE }/reports`).reply({
        value: [{ id: '1', name: 'Alpha' }, { id: '2', name: 'Beta' }],
      })

      const result = await service.getReportsDictionary({ search: 'alp' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('1')
    })
  })

  describe('getDashboardsDictionary', () => {
    it('maps dashboards using the display name', async () => {
      mock.onGet(`${ GROUP_BASE }/dashboards`).reply({
        value: [
          { id: DASHBOARD_ID, displayName: 'Executive Overview', isReadOnly: true },
          { id: 'd-2' },
        ],
      })

      const result = await service.getDashboardsDictionary({ criteria: { workspaceId: WORKSPACE_ID } })

      expect(result).toEqual({
        cursor: null,
        items: [
          { label: 'Executive Overview', value: DASHBOARD_ID, note: 'Read-only' },
          { label: 'd-2', value: 'd-2', note: 'ID: d-2' },
        ],
      })
    })

    it('filters dashboards by search', async () => {
      mock.onGet(`${ API_BASE }/dashboards`).reply({
        value: [{ id: '1', displayName: 'Sales' }, { id: '2', displayName: 'Ops' }],
      })

      const result = await service.getDashboardsDictionary({ search: 'ops' })

      expect(result.items).toEqual([{ label: 'Ops', value: '2', note: 'ID: 2' }])
    })
  })

  describe('getDataflowsDictionary', () => {
    it('returns an empty list without a workspace', async () => {
      const result = await service.getDataflowsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
      expect(mock.history).toHaveLength(0)
    })

    it('maps dataflows with description as note', async () => {
      mock.onGet(`${ GROUP_BASE }/dataflows`).reply({
        value: [
          { objectId: DATAFLOW_ID, name: 'Customer Orders', description: 'Curated order data' },
          { objectId: 'df-2' },
        ],
      })

      const result = await service.getDataflowsDictionary({ criteria: { workspaceId: WORKSPACE_ID } })

      expect(result).toEqual({
        cursor: null,
        items: [
          { label: 'Customer Orders', value: DATAFLOW_ID, note: 'Curated order data' },
          { label: 'df-2', value: 'df-2', note: 'ID: df-2' },
        ],
      })
    })

    it('filters dataflows by search', async () => {
      mock.onGet(`${ GROUP_BASE }/dataflows`).reply({
        value: [{ objectId: '1', name: 'Orders' }, { objectId: '2', name: 'Invoices' }],
      })

      const result = await service.getDataflowsDictionary({
        search: 'invo',
        criteria: { workspaceId: WORKSPACE_ID },
      })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('2')
    })
  })

  // ── Workspaces ──

  describe('listWorkspaces', () => {
    it('sends default paging', async () => {
      mock.onGet(`${ API_BASE }/groups`).reply({ value: [] })

      const result = await service.listWorkspaces()

      expect(result).toEqual({ value: [] })
      expect(mock.history[0].query).toEqual({ $top: 100 })
      expect(mock.history[0].headers).toMatchObject(AUTH_HEADER)
    })

    it('passes filter, top and skip', async () => {
      mock.onGet(`${ API_BASE }/groups`).reply({ value: [] })

      await service.listWorkspaces("contains(name,'Sales')", 5, 10)

      expect(mock.history[0].query).toEqual({
        $filter: "contains(name,'Sales')",
        $top: 5,
        $skip: 10,
      })
    })

    it('wraps API errors with code and message', async () => {
      mock.onGet(`${ API_BASE }/groups`).replyWithError({
        status: 401,
        message: 'Unauthorized',
        body: { error: { code: 'PowerBINotAuthorizedException', message: 'Token expired' } },
      })

      await expect(service.listWorkspaces()).rejects.toThrow(
        'Microsoft Power BI API error: PowerBINotAuthorizedException: Token expired'
      )
    })

    it('falls back to the transport error message', async () => {
      mock.onGet(`${ API_BASE }/groups`).replyWithError({ message: 'socket hang up' })

      await expect(service.listWorkspaces()).rejects.toThrow(
        'Microsoft Power BI API error: socket hang up'
      )
    })
  })

  // ── Datasets ──

  describe('listDatasets', () => {
    it('scopes to a workspace when given', async () => {
      mock.onGet(`${ GROUP_BASE }/datasets`).reply({ value: [] })

      await service.listDatasets(WORKSPACE_ID)

      expect(mock.history[0].url).toBe(`${ GROUP_BASE }/datasets`)
    })

    it('uses My workspace when the workspace is empty', async () => {
      mock.onGet(`${ API_BASE }/datasets`).reply({ value: [] })

      await service.listDatasets('')

      expect(mock.history[0].url).toBe(`${ API_BASE }/datasets`)
    })
  })

  describe('getDataset', () => {
    it('fetches a dataset by id', async () => {
      mock.onGet(`${ GROUP_BASE }/datasets/${ DATASET_ID }`).reply({ id: DATASET_ID, name: 'SalesMarketing' })

      const result = await service.getDataset(WORKSPACE_ID, DATASET_ID)

      expect(result).toEqual({ id: DATASET_ID, name: 'SalesMarketing' })
      expect(mock.history[0].method).toBe('get')
    })

    it('requires a dataset id', async () => {
      await expect(service.getDataset(WORKSPACE_ID)).rejects.toThrow('Parameter "Dataset" is required')
      expect(mock.history).toHaveLength(0)
    })
  })

  describe('deleteDataset', () => {
    it('deletes and returns a confirmation', async () => {
      mock.onDelete(`${ GROUP_BASE }/datasets/${ DATASET_ID }`).reply('')

      const result = await service.deleteDataset(WORKSPACE_ID, DATASET_ID)

      expect(result).toEqual({ message: 'Dataset deleted successfully', datasetId: DATASET_ID })
      expect(mock.history[0].method).toBe('delete')
    })

    it('requires a dataset id', async () => {
      await expect(service.deleteDataset(WORKSPACE_ID)).rejects.toThrow('Parameter "Dataset" is required')
    })
  })

  describe('refreshDataset', () => {
    it('defaults to NoNotification', async () => {
      mock.onPost(`${ GROUP_BASE }/datasets/${ DATASET_ID }/refreshes`).reply('')

      const result = await service.refreshDataset(WORKSPACE_ID, DATASET_ID)

      expect(result).toEqual({
        message: 'Dataset refresh triggered successfully',
        datasetId: DATASET_ID,
        notifyOption: 'NoNotification',
      })

      expect(mock.history[0].body).toEqual({ notifyOption: 'NoNotification' })
    })

    it('maps the friendly notify option label', async () => {
      mock.onPost(`${ API_BASE }/datasets/${ DATASET_ID }/refreshes`).reply('')

      const result = await service.refreshDataset('', DATASET_ID, 'Mail On Completion')

      expect(mock.history[0].body).toEqual({ notifyOption: 'MailOnCompletion' })
      expect(result.notifyOption).toBe('MailOnCompletion')
    })

    it('passes an unmapped notify option through unchanged', async () => {
      mock.onPost(`${ API_BASE }/datasets/${ DATASET_ID }/refreshes`).reply('')

      await service.refreshDataset('', DATASET_ID, 'MailOnFailure')

      expect(mock.history[0].body).toEqual({ notifyOption: 'MailOnFailure' })
    })

    it('requires a dataset id', async () => {
      await expect(service.refreshDataset(WORKSPACE_ID)).rejects.toThrow('Parameter "Dataset" is required')
    })
  })

  describe('getRefreshHistory', () => {
    it('requests the refresh history with a top limit', async () => {
      mock.onGet(`${ GROUP_BASE }/datasets/${ DATASET_ID }/refreshes`).reply({ value: [] })

      await service.getRefreshHistory(WORKSPACE_ID, DATASET_ID, 5)

      expect(mock.history[0].query).toEqual({ $top: 5 })
    })

    it('omits the top limit when not provided', async () => {
      mock.onGet(`${ GROUP_BASE }/datasets/${ DATASET_ID }/refreshes`).reply({ value: [] })

      await service.getRefreshHistory(WORKSPACE_ID, DATASET_ID)

      expect(mock.history[0].query).toEqual({})
    })

    it('requires a dataset id', async () => {
      await expect(service.getRefreshHistory(WORKSPACE_ID)).rejects.toThrow('Parameter "Dataset" is required')
    })
  })

  describe('getDatasetParameters', () => {
    it('fetches dataset parameters', async () => {
      mock.onGet(`${ GROUP_BASE }/datasets/${ DATASET_ID }/parameters`).reply({ value: [{ name: 'ServerName' }] })

      const result = await service.getDatasetParameters(WORKSPACE_ID, DATASET_ID)

      expect(result.value[0].name).toBe('ServerName')
    })

    it('requires a dataset id', async () => {
      await expect(service.getDatasetParameters(WORKSPACE_ID)).rejects.toThrow('Parameter "Dataset" is required')
    })
  })

  describe('updateDatasetParameters', () => {
    it('sends only name and newValue for each update', async () => {
      mock.onPost(`${ GROUP_BASE }/datasets/${ DATASET_ID }/Default.UpdateParameters`).reply('')

      const result = await service.updateDatasetParameters(WORKSPACE_ID, DATASET_ID, [
        { name: 'ServerName', newValue: 'sql.contoso.com', extra: 'ignored' },
        { name: 'MaxRows', newValue: '1000' },
      ])

      expect(mock.history[0].body).toEqual({
        updateDetails: [
          { name: 'ServerName', newValue: 'sql.contoso.com' },
          { name: 'MaxRows', newValue: '1000' },
        ],
      })

      expect(result).toEqual({
        message: 'Dataset parameters updated successfully',
        datasetId: DATASET_ID,
        updatedCount: 2,
      })
    })

    it('requires a dataset id', async () => {
      await expect(service.updateDatasetParameters(WORKSPACE_ID, '', [{ name: 'a', newValue: 'b' }]))
        .rejects.toThrow('Parameter "Dataset" is required')
    })

    it('requires at least one update entry', async () => {
      await expect(service.updateDatasetParameters(WORKSPACE_ID, DATASET_ID, []))
        .rejects.toThrow('Parameter "Parameter Updates" must contain at least one entry')

      await expect(service.updateDatasetParameters(WORKSPACE_ID, DATASET_ID, 'nope'))
        .rejects.toThrow('Parameter "Parameter Updates" must contain at least one entry')
    })
  })

  describe('takeOverDataset', () => {
    it('posts to the take over endpoint', async () => {
      mock.onPost(`${ GROUP_BASE }/datasets/${ DATASET_ID }/Default.TakeOver`).reply('')

      const result = await service.takeOverDataset(WORKSPACE_ID, DATASET_ID)

      expect(result).toEqual({
        message: 'Dataset ownership taken over successfully',
        datasetId: DATASET_ID,
      })

      expect(mock.history[0].body).toBeUndefined()
    })

    it('requires a workspace', async () => {
      await expect(service.takeOverDataset('', DATASET_ID)).rejects.toThrow('Parameter "Workspace" is required')
    })

    it('requires a dataset id', async () => {
      await expect(service.takeOverDataset(WORKSPACE_ID)).rejects.toThrow('Parameter "Dataset" is required')
    })
  })

  // ── DAX queries ──

  describe('executeDaxQuery', () => {
    it('sends the query with serializer settings and impersonation', async () => {
      mock.onPost(`${ GROUP_BASE }/datasets/${ DATASET_ID }/executeQueries`).reply({ results: [] })

      await service.executeDaxQuery(
        WORKSPACE_ID,
        DATASET_ID,
        "EVALUATE TOPN(10, 'Sales')",
        true,
        'user@contoso.com'
      )

      expect(mock.history[0].body).toEqual({
        queries: [{ query: "EVALUATE TOPN(10, 'Sales')" }],
        serializerSettings: { includeNulls: true },
        impersonatedUserName: 'user@contoso.com',
      })
    })

    it('omits optional fields when not provided', async () => {
      mock.onPost(`${ API_BASE }/datasets/${ DATASET_ID }/executeQueries`).reply({ results: [] })

      await service.executeDaxQuery('', DATASET_ID, 'EVALUATE Sales')

      expect(mock.history[0].body).toEqual({ queries: [{ query: 'EVALUATE Sales' }] })
    })

    it('requires a dataset id', async () => {
      await expect(service.executeDaxQuery('', '', 'EVALUATE Sales'))
        .rejects.toThrow('Parameter "Dataset" is required')
    })

    it('requires a DAX query', async () => {
      await expect(service.executeDaxQuery('', DATASET_ID, ''))
        .rejects.toThrow('Parameter "DAX Query" is required')
    })
  })

  // ── Push datasets ──

  describe('createPushDataset', () => {
    it('creates a push dataset with mapped mode, retention policy and column types', async () => {
      mock.onPost(`${ GROUP_BASE }/datasets`).reply({ id: 'new-dataset' })

      const result = await service.createPushDataset(
        WORKSPACE_ID,
        'SalesTelemetry',
        [{ name: 'Sales', columns: [{ name: 'When', dataType: 'DateTime' }] }],
        'Push Streaming',
        'Basic FIFO'
      )

      expect(result).toEqual({ id: 'new-dataset' })

      expect(mock.history[0].body).toEqual({
        name: 'SalesTelemetry',
        defaultMode: 'PushStreaming',
        tables: [{ name: 'Sales', columns: [{ name: 'When', dataType: 'Datetime' }] }],
      })

      expect(mock.history[0].query).toEqual({ defaultRetentionPolicy: 'basicFIFO' })
    })

    it('defaults the mode to Push and omits the retention policy', async () => {
      mock.onPost(`${ API_BASE }/datasets`).reply({ id: 'ds' })

      await service.createPushDataset('', 'Telemetry', [{ name: 'T' }])

      expect(mock.history[0].body).toEqual({
        name: 'Telemetry',
        defaultMode: 'Push',
        tables: [{ name: 'T', columns: [] }],
      })

      expect(mock.history[0].query).toEqual({})
    })

    it('requires a dataset name', async () => {
      await expect(service.createPushDataset('', '', [{ name: 'T' }]))
        .rejects.toThrow('Parameter "Dataset Name" is required')
    })

    it('requires at least one table', async () => {
      await expect(service.createPushDataset('', 'Telemetry', []))
        .rejects.toThrow('Parameter "Tables" must contain at least one table definition')
    })
  })

  describe('getDatasetTables', () => {
    it('lists push dataset tables', async () => {
      mock.onGet(`${ GROUP_BASE }/datasets/${ DATASET_ID }/tables`).reply({ value: [{ name: 'Sales' }] })

      const result = await service.getDatasetTables(WORKSPACE_ID, DATASET_ID)

      expect(result.value).toEqual([{ name: 'Sales' }])
    })

    it('requires a dataset id', async () => {
      await expect(service.getDatasetTables(WORKSPACE_ID)).rejects.toThrow('Parameter "Dataset" is required')
    })
  })

  describe('addRowsToTable', () => {
    it('posts rows and returns the row count', async () => {
      mock.onPost(`${ GROUP_BASE }/datasets/${ DATASET_ID }/tables/Sales/rows`).reply('')

      const rows = [{ ProductID: 1 }, { ProductID: 2 }]
      const result = await service.addRowsToTable(WORKSPACE_ID, DATASET_ID, 'Sales', rows)

      expect(mock.history[0].body).toEqual({ rows })

      expect(result).toEqual({
        message: 'Rows added successfully',
        datasetId: DATASET_ID,
        tableName: 'Sales',
        rowCount: 2,
      })
    })

    it('encodes the table name', async () => {
      mock.onPost(`${ API_BASE }/datasets/${ DATASET_ID }/tables/My%20Table/rows`).reply('')

      await service.addRowsToTable('', DATASET_ID, 'My Table', [{ a: 1 }])

      expect(mock.history[0].url).toBe(`${ API_BASE }/datasets/${ DATASET_ID }/tables/My%20Table/rows`)
    })

    it('validates required parameters', async () => {
      await expect(service.addRowsToTable('', '', 'Sales', [{ a: 1 }]))
        .rejects.toThrow('Parameter "Dataset" is required')

      await expect(service.addRowsToTable('', DATASET_ID, '', [{ a: 1 }]))
        .rejects.toThrow('Parameter "Table Name" is required')

      await expect(service.addRowsToTable('', DATASET_ID, 'Sales', []))
        .rejects.toThrow('Parameter "Rows" must contain at least one row')
    })
  })

  describe('deleteRowsFromTable', () => {
    it('deletes all rows of a table', async () => {
      mock.onDelete(`${ GROUP_BASE }/datasets/${ DATASET_ID }/tables/Sales/rows`).reply('')

      const result = await service.deleteRowsFromTable(WORKSPACE_ID, DATASET_ID, 'Sales')

      expect(result).toEqual({
        message: 'All rows deleted successfully',
        datasetId: DATASET_ID,
        tableName: 'Sales',
      })

      expect(mock.history[0].method).toBe('delete')
    })

    it('validates required parameters', async () => {
      await expect(service.deleteRowsFromTable('', '', 'Sales'))
        .rejects.toThrow('Parameter "Dataset" is required')

      await expect(service.deleteRowsFromTable('', DATASET_ID, ''))
        .rejects.toThrow('Parameter "Table Name" is required')
    })
  })

  describe('updateTableSchema', () => {
    it('puts the mapped table definition', async () => {
      mock.onPut(`${ GROUP_BASE }/datasets/${ DATASET_ID }/tables/Sales`).reply({ name: 'Sales' })

      const result = await service.updateTableSchema(WORKSPACE_ID, DATASET_ID, 'Sales', [
        { name: 'ProductID', dataType: 'Int64' },
        { name: 'When', dataType: 'DateTime' },
      ])

      expect(result).toEqual({ name: 'Sales' })

      expect(mock.history[0].body).toEqual({
        name: 'Sales',
        columns: [
          { name: 'ProductID', dataType: 'Int64' },
          { name: 'When', dataType: 'Datetime' },
        ],
      })
    })

    it('validates required parameters', async () => {
      await expect(service.updateTableSchema('', '', 'Sales', [{ name: 'a' }]))
        .rejects.toThrow('Parameter "Dataset" is required')

      await expect(service.updateTableSchema('', DATASET_ID, '', [{ name: 'a' }]))
        .rejects.toThrow('Parameter "Table Name" is required')

      await expect(service.updateTableSchema('', DATASET_ID, 'Sales', []))
        .rejects.toThrow('Parameter "Columns" must contain at least one column definition')
    })
  })

  // ── Reports ──

  describe('listReports', () => {
    it('lists reports of a workspace', async () => {
      mock.onGet(`${ GROUP_BASE }/reports`).reply({ value: [] })

      await service.listReports(WORKSPACE_ID)

      expect(mock.history[0].url).toBe(`${ GROUP_BASE }/reports`)
    })
  })

  describe('getReport', () => {
    it('fetches a report by id', async () => {
      mock.onGet(`${ GROUP_BASE }/reports/${ REPORT_ID }`).reply({ id: REPORT_ID })

      const result = await service.getReport(WORKSPACE_ID, REPORT_ID)

      expect(result).toEqual({ id: REPORT_ID })
    })

    it('requires a report id', async () => {
      await expect(service.getReport(WORKSPACE_ID)).rejects.toThrow('Parameter "Report" is required')
    })
  })

  describe('getReportPages', () => {
    it('fetches report pages', async () => {
      mock.onGet(`${ GROUP_BASE }/reports/${ REPORT_ID }/pages`).reply({ value: [{ name: 'ReportSection1' }] })

      const result = await service.getReportPages(WORKSPACE_ID, REPORT_ID)

      expect(result.value).toHaveLength(1)
    })

    it('requires a report id', async () => {
      await expect(service.getReportPages(WORKSPACE_ID)).rejects.toThrow('Parameter "Report" is required')
    })
  })

  describe('cloneReport', () => {
    it('clones with target workspace and dataset', async () => {
      mock.onPost(`${ GROUP_BASE }/reports/${ REPORT_ID }/Clone`).reply({ id: 'clone-1' })

      const result = await service.cloneReport(WORKSPACE_ID, REPORT_ID, 'Copy', 'target-ws', 'target-ds')

      expect(result).toEqual({ id: 'clone-1' })

      expect(mock.history[0].body).toEqual({
        name: 'Copy',
        targetWorkspaceId: 'target-ws',
        targetModelId: 'target-ds',
      })
    })

    it('omits optional targets', async () => {
      mock.onPost(`${ API_BASE }/reports/${ REPORT_ID }/Clone`).reply({ id: 'clone-2' })

      await service.cloneReport('', REPORT_ID, 'Copy')

      expect(mock.history[0].body).toEqual({ name: 'Copy' })
    })

    it('validates required parameters', async () => {
      await expect(service.cloneReport('', '', 'Copy')).rejects.toThrow('Parameter "Report" is required')
      await expect(service.cloneReport('', REPORT_ID, '')).rejects.toThrow('Parameter "New Report Name" is required')
    })
  })

  describe('deleteReport', () => {
    it('deletes a report', async () => {
      mock.onDelete(`${ GROUP_BASE }/reports/${ REPORT_ID }`).reply('')

      const result = await service.deleteReport(WORKSPACE_ID, REPORT_ID)

      expect(result).toEqual({ message: 'Report deleted successfully', reportId: REPORT_ID })
    })

    it('requires a report id', async () => {
      await expect(service.deleteReport(WORKSPACE_ID)).rejects.toThrow('Parameter "Report" is required')
    })
  })

  // ── Report export ──

  describe('startReportExport', () => {
    it('starts a PDF export by default', async () => {
      mock.onPost(`${ GROUP_BASE }/reports/${ REPORT_ID }/ExportTo`).reply({ id: EXPORT_ID, status: 'Running' })

      const result = await service.startReportExport(WORKSPACE_ID, REPORT_ID)

      expect(result).toEqual({ id: EXPORT_ID, status: 'Running' })
      expect(mock.history[0].body).toEqual({ format: 'PDF' })
    })

    it('maps the format and builds the report configuration', async () => {
      mock.onPost(`${ API_BASE }/reports/${ REPORT_ID }/ExportTo`).reply({ id: EXPORT_ID })

      await service.startReportExport('', REPORT_ID, 'PowerPoint', ['ReportSection1'], true, 'en-US')

      expect(mock.history[0].body).toEqual({
        format: 'PPTX',
        powerBIReportConfiguration: {
          pages: [{ pageName: 'ReportSection1' }],
          settings: { includeHiddenPages: true, locale: 'en-US' },
        },
      })
    })

    it('omits the configuration when there are no pages or settings', async () => {
      mock.onPost(`${ API_BASE }/reports/${ REPORT_ID }/ExportTo`).reply({ id: EXPORT_ID })

      await service.startReportExport('', REPORT_ID, 'PNG', [])

      expect(mock.history[0].body).toEqual({ format: 'PNG' })
    })

    it('requires a report id', async () => {
      await expect(service.startReportExport('', '')).rejects.toThrow('Parameter "Report" is required')
    })
  })

  describe('getReportExportStatus', () => {
    it('fetches the export status', async () => {
      mock.onGet(`${ GROUP_BASE }/reports/${ REPORT_ID }/exports/${ EXPORT_ID }`).reply({
        id: EXPORT_ID,
        status: 'Succeeded',
      })

      const result = await service.getReportExportStatus(WORKSPACE_ID, REPORT_ID, EXPORT_ID)

      expect(result.status).toBe('Succeeded')
    })

    it('validates required parameters', async () => {
      await expect(service.getReportExportStatus('', '', EXPORT_ID))
        .rejects.toThrow('Parameter "Report" is required')

      await expect(service.getReportExportStatus('', REPORT_ID, ''))
        .rejects.toThrow('Parameter "Export ID" is required')
    })
  })

  describe('saveExportedReportFile', () => {
    const STATUS_URL = `${ GROUP_BASE }/reports/${ REPORT_ID }/exports/${ EXPORT_ID }`
    const FILE_URL = `${ STATUS_URL }/file`

    let uploadFile

    beforeEach(() => {
      uploadFile = jest.fn().mockResolvedValue({ url: 'https://storage.example.com/file.pdf' })
      service.flowrunner = { Files: { uploadFile } }
    })

    afterEach(() => {
      delete service.flowrunner
    })

    it('downloads the export and uploads it to file storage', async () => {
      mock.onGet(STATUS_URL).reply({
        id: EXPORT_ID,
        status: 'Succeeded',
        reportName: 'Quarterly Sales',
        resourceFileExtension: '.pdf',
      })

      mock.onGet(FILE_URL).reply(Buffer.from('PDFDATA'))

      const result = await service.saveExportedReportFile(WORKSPACE_ID, REPORT_ID, EXPORT_ID)

      expect(result).toEqual({
        fileUrl: 'https://storage.example.com/file.pdf',
        fileName: 'Quarterly Sales.pdf',
        size: 7,
        reportId: REPORT_ID,
        exportId: EXPORT_ID,
        reportName: 'Quarterly Sales',
      })

      expect(uploadFile).toHaveBeenCalledWith(expect.any(Buffer), {
        filename: 'Quarterly Sales.pdf',
        generateUrl: true,
        overwrite: true,
        scope: 'FLOW',
      })

      const downloadCall = mock.history.find(call => call.url === FILE_URL)
      expect(downloadCall.encoding).toBeNull()
      expect(downloadCall.headers).toMatchObject(AUTH_HEADER)
    })

    it('appends the extension to a custom file name and honours file options', async () => {
      mock.onGet(STATUS_URL).reply({
        id: EXPORT_ID,
        status: 'Succeeded',
        reportName: 'Quarterly Sales',
        resourceFileExtension: 'pdf',
      })

      mock.onGet(FILE_URL).reply('raw-bytes')

      const result = await service.saveExportedReportFile(
        WORKSPACE_ID,
        REPORT_ID,
        EXPORT_ID,
        'my-export',
        { scope: 'APP' }
      )

      expect(result.fileName).toBe('my-export.pdf')

      expect(uploadFile).toHaveBeenCalledWith(expect.any(Buffer), {
        filename: 'my-export.pdf',
        generateUrl: true,
        overwrite: true,
        scope: 'APP',
      })
    })

    it('sanitizes the report name and serializes non-binary bodies', async () => {
      mock.onGet(STATUS_URL).reply({ id: EXPORT_ID, status: 'Succeeded', reportName: 'Q1/Q2: Sales' })
      mock.onGet(FILE_URL).reply({ some: 'json' })

      const result = await service.saveExportedReportFile(WORKSPACE_ID, REPORT_ID, EXPORT_ID)

      expect(result.fileName).toBe('Q1_Q2_ Sales')
      expect(result.size).toBe(JSON.stringify({ some: 'json' }).length)
    })

    it('falls back to a default file name when the report name is missing', async () => {
      mock.onGet(STATUS_URL).reply({ id: EXPORT_ID, status: 'Succeeded' })
      mock.onGet(FILE_URL).reply(Buffer.from('x'))

      const result = await service.saveExportedReportFile(WORKSPACE_ID, REPORT_ID, EXPORT_ID)

      expect(result.fileName).toBe('export')
      expect(result.reportName).toBeNull()
    })

    it('throws when the export has not succeeded yet', async () => {
      mock.onGet(STATUS_URL).reply({ id: EXPORT_ID, status: 'Running' })

      await expect(service.saveExportedReportFile(WORKSPACE_ID, REPORT_ID, EXPORT_ID))
        .rejects.toThrow('The export job is not complete yet (current status: Running)')

      expect(uploadFile).not.toHaveBeenCalled()
    })

    it('wraps download failures', async () => {
      mock.onGet(STATUS_URL).reply({ id: EXPORT_ID, status: 'Succeeded', reportName: 'R' })

      mock.onGet(FILE_URL).replyWithError({
        message: 'Not Found',
        body: { error: { message: 'Export expired' } },
      })

      await expect(service.saveExportedReportFile(WORKSPACE_ID, REPORT_ID, EXPORT_ID))
        .rejects.toThrow('Microsoft Power BI API error: Export expired')
    })

    it('validates required parameters', async () => {
      await expect(service.saveExportedReportFile('', '', EXPORT_ID))
        .rejects.toThrow('Parameter "Report" is required')

      await expect(service.saveExportedReportFile('', REPORT_ID, ''))
        .rejects.toThrow('Parameter "Export ID" is required')
    })
  })

  describe('exportReportToFile', () => {
    const EXPORT_TO_URL = `${ GROUP_BASE }/reports/${ REPORT_ID }/ExportTo`
    const STATUS_URL = `${ GROUP_BASE }/reports/${ REPORT_ID }/exports/${ EXPORT_ID }`
    const FILE_URL = `${ STATUS_URL }/file`

    let uploadFile

    beforeEach(() => {
      uploadFile = jest.fn().mockResolvedValue({ url: 'https://storage.example.com/report.pdf' })
      service.flowrunner = { Files: { uploadFile } }
    })

    afterEach(() => {
      delete service.flowrunner
    })

    it('saves the file when the export succeeds immediately', async () => {
      mock.onPost(EXPORT_TO_URL).reply({
        id: EXPORT_ID,
        status: 'Succeeded',
        reportName: 'Quarterly Sales',
        resourceFileExtension: '.pdf',
      })

      mock.onGet(FILE_URL).reply(Buffer.from('PDF'))

      const result = await service.exportReportToFile(WORKSPACE_ID, REPORT_ID, 'PDF')

      expect(result).toMatchObject({
        fileUrl: 'https://storage.example.com/report.pdf',
        fileName: 'Quarterly Sales.pdf',
        exportId: EXPORT_ID,
      })

      expect(mock.history.filter(call => call.url === STATUS_URL)).toHaveLength(0)
    })

    it('polls until the export succeeds', async () => {
      let statusCalls = 0

      mock.onPost(EXPORT_TO_URL).reply({ id: EXPORT_ID, status: 'Running', percentComplete: 0 })

      mock.onGet(STATUS_URL).replyWith(() => {
        statusCalls += 1

        return statusCalls === 1
          ? { id: EXPORT_ID, status: 'Running', percentComplete: 50 }
          : { id: EXPORT_ID, status: 'Succeeded', percentComplete: 100, reportName: 'R', resourceFileExtension: '.pdf' }
      })

      mock.onGet(FILE_URL).reply(Buffer.from('PDF'))

      const result = await service.exportReportToFile(WORKSPACE_ID, REPORT_ID, 'PDF')

      expect(statusCalls).toBe(2)
      expect(result.fileName).toBe('R.pdf')
    }, 20000)

    it('throws when the export job fails', async () => {
      mock.onPost(EXPORT_TO_URL).reply({ id: EXPORT_ID, status: 'Failed' })

      await expect(service.exportReportToFile(WORKSPACE_ID, REPORT_ID, 'PDF'))
        .rejects.toThrow(`Report export failed (export ID: ${ EXPORT_ID })`)
    })

    it('throws when the export does not finish in time', async () => {
      mock.onPost(EXPORT_TO_URL).reply({ id: EXPORT_ID, status: 'Running' })

      const realNow = Date.now
      let call = 0

      Date.now = () => {
        call += 1

        return call === 1 ? 0 : 10 ** 9
      }

      try {
        await expect(service.exportReportToFile(WORKSPACE_ID, REPORT_ID, 'PDF'))
          .rejects.toThrow('Report export did not finish in time')
      } finally {
        Date.now = realNow
      }
    })

    it('requires a report id', async () => {
      await expect(service.exportReportToFile('', '')).rejects.toThrow('Parameter "Report" is required')
    })
  })

  // ── Dashboards ──

  describe('listDashboards', () => {
    it('lists dashboards of My workspace', async () => {
      mock.onGet(`${ API_BASE }/dashboards`).reply({ value: [] })

      await service.listDashboards()

      expect(mock.history[0].url).toBe(`${ API_BASE }/dashboards`)
    })
  })

  describe('getDashboard', () => {
    it('fetches a dashboard by id', async () => {
      mock.onGet(`${ GROUP_BASE }/dashboards/${ DASHBOARD_ID }`).reply({ id: DASHBOARD_ID })

      const result = await service.getDashboard(WORKSPACE_ID, DASHBOARD_ID)

      expect(result.id).toBe(DASHBOARD_ID)
    })

    it('requires a dashboard id', async () => {
      await expect(service.getDashboard(WORKSPACE_ID)).rejects.toThrow('Parameter "Dashboard" is required')
    })
  })

  describe('listDashboardTiles', () => {
    it('lists dashboard tiles', async () => {
      mock.onGet(`${ GROUP_BASE }/dashboards/${ DASHBOARD_ID }/tiles`).reply({ value: [{ id: 'tile-1' }] })

      const result = await service.listDashboardTiles(WORKSPACE_ID, DASHBOARD_ID)

      expect(result.value).toHaveLength(1)
    })

    it('requires a dashboard id', async () => {
      await expect(service.listDashboardTiles(WORKSPACE_ID)).rejects.toThrow('Parameter "Dashboard" is required')
    })
  })

  // ── Dataflows ──

  describe('listDataflows', () => {
    it('lists dataflows of a workspace', async () => {
      mock.onGet(`${ GROUP_BASE }/dataflows`).reply({ value: [] })

      await service.listDataflows(WORKSPACE_ID)

      expect(mock.history[0].url).toBe(`${ GROUP_BASE }/dataflows`)
    })

    it('requires a workspace', async () => {
      await expect(service.listDataflows()).rejects.toThrow('Parameter "Workspace" is required')
    })
  })

  describe('refreshDataflow', () => {
    it('triggers a refresh with mapped notify option and process type', async () => {
      mock.onPost(`${ GROUP_BASE }/dataflows/${ DATAFLOW_ID }/refreshes`).reply('')

      const result = await service.refreshDataflow(WORKSPACE_ID, DATAFLOW_ID, 'Mail On Failure', 'default')

      expect(mock.history[0].body).toEqual({ notifyOption: 'MailOnFailure' })
      expect(mock.history[0].query).toEqual({ processType: 'default' })

      expect(result).toEqual({
        message: 'Dataflow refresh triggered successfully',
        dataflowId: DATAFLOW_ID,
        notifyOption: 'MailOnFailure',
      })
    })

    it('defaults the notify option and omits the process type', async () => {
      mock.onPost(`${ GROUP_BASE }/dataflows/${ DATAFLOW_ID }/refreshes`).reply('')

      await service.refreshDataflow(WORKSPACE_ID, DATAFLOW_ID)

      expect(mock.history[0].body).toEqual({ notifyOption: 'NoNotification' })
      expect(mock.history[0].query).toEqual({})
    })

    it('validates required parameters', async () => {
      await expect(service.refreshDataflow('', DATAFLOW_ID)).rejects.toThrow('Parameter "Workspace" is required')
      await expect(service.refreshDataflow(WORKSPACE_ID, '')).rejects.toThrow('Parameter "Dataflow" is required')
    })
  })

  // ── Apps ──

  describe('apps', () => {
    it('lists apps', async () => {
      mock.onGet(`${ API_BASE }/apps`).reply({ value: [{ id: APP_ID }] })

      const result = await service.listApps()

      expect(result.value).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject(AUTH_HEADER)
    })

    it('gets a single app', async () => {
      mock.onGet(`${ API_BASE }/apps/${ APP_ID }`).reply({ id: APP_ID, name: 'Finance' })

      const result = await service.getApp(APP_ID)

      expect(result.name).toBe('Finance')
    })

    it('lists app reports', async () => {
      mock.onGet(`${ API_BASE }/apps/${ APP_ID }/reports`).reply({ value: [] })

      await service.listAppReports(APP_ID)

      expect(mock.history[0].url).toBe(`${ API_BASE }/apps/${ APP_ID }/reports`)
    })

    it('lists app dashboards', async () => {
      mock.onGet(`${ API_BASE }/apps/${ APP_ID }/dashboards`).reply({ value: [] })

      await service.listAppDashboards(APP_ID)

      expect(mock.history[0].url).toBe(`${ API_BASE }/apps/${ APP_ID }/dashboards`)
    })

    it('requires an app id', async () => {
      await expect(service.getApp()).rejects.toThrow('Parameter "App ID" is required')
      await expect(service.listAppReports()).rejects.toThrow('Parameter "App ID" is required')
      await expect(service.listAppDashboards()).rejects.toThrow('Parameter "App ID" is required')
    })
  })

  // ── Platform ──

  describe('platform', () => {
    it('lists imports of a workspace', async () => {
      mock.onGet(`${ GROUP_BASE }/imports`).reply({ value: [] })

      await service.listImports(WORKSPACE_ID)

      expect(mock.history[0].url).toBe(`${ GROUP_BASE }/imports`)
    })

    it('lists imports of My workspace', async () => {
      mock.onGet(`${ API_BASE }/imports`).reply({ value: [] })

      await service.listImports()

      expect(mock.history[0].url).toBe(`${ API_BASE }/imports`)
    })

    it('lists gateways', async () => {
      mock.onGet(`${ API_BASE }/gateways`).reply({ value: [{ id: 'gw-1' }] })

      const result = await service.listGateways()

      expect(result.value[0].id).toBe('gw-1')
    })

    it('lists capacities', async () => {
      mock.onGet(`${ API_BASE }/capacities`).reply({ value: [{ id: 'cap-1' }] })

      const result = await service.listCapacities()

      expect(result.value[0].id).toBe('cap-1')
    })

    it('wraps errors from platform endpoints', async () => {
      mock.onGet(`${ API_BASE }/capacities`).replyWithError({
        statusCode: 403,
        message: 'Forbidden',
        body: { error: { message: 'Insufficient privileges' } },
      })

      await expect(service.listCapacities())
        .rejects.toThrow('Microsoft Power BI API error: Insufficient privileges')
    })
  })
})
