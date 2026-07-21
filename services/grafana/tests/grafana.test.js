'use strict'

const { createSandbox } = require('../../../service-sandbox')

const SERVER_URL = 'https://myorg.grafana.net'
const API_TOKEN = 'test-service-account-token'
const BASE = `${ SERVER_URL }/api`

describe('Grafana Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ serverUrl: SERVER_URL, apiToken: API_TOKEN })
    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()
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
      expect(sandbox.getConfigItems()).toEqual([
        expect.objectContaining({
          name: 'serverUrl',
          displayName: 'Server URL',
          required: true,
          shared: false,
          type: 'STRING',
        }),
        expect.objectContaining({
          name: 'apiToken',
          displayName: 'API Token',
          required: true,
          shared: false,
          type: 'STRING',
        }),
      ])
    })

    it('sends the Bearer auth header and JSON headers on requests', async () => {
      mock.onGet(`${ BASE }/health`).reply({ database: 'ok' })

      await service.healthCheck()

      expect(mock.history[0].headers).toMatchObject({
        'Authorization': `Bearer ${ API_TOKEN }`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      })
    })

    it('builds request URLs by appending /api to the configured server URL', async () => {
      mock.onGet(`${ BASE }/org`).reply({ id: 1 })

      await service.getOrg()

      expect(mock.history[0].url.startsWith(`${ SERVER_URL }/api/`)).toBe(true)
    })
  })

  // ── Dashboards ──

  describe('searchDashboards', () => {
    it('defaults to dash-db type with no other filters', async () => {
      mock.onGet(`${ BASE }/search`).reply([{ uid: 'a', title: 'A' }])

      const result = await service.searchDashboards()

      expect(result).toEqual([{ uid: 'a', title: 'A' }])
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/search`)
      expect(mock.history[0].query).toEqual({ type: 'dash-db' })
    })

    it('resolves the Folders choice and passes query, tags and limit', async () => {
      mock.onGet(`${ BASE }/search`).reply([])

      await service.searchDashboards('prod', 'Folders', ['prod', 'ops'], 25)

      expect(mock.history[0].query).toEqual({
        query: 'prod',
        type: 'dash-folder',
        tag: ['prod', 'ops'],
        limit: 25,
      })
    })

    it('resolves the Dashboards choice to dash-db', async () => {
      mock.onGet(`${ BASE }/search`).reply([])

      await service.searchDashboards('x', 'Dashboards')

      expect(mock.history[0].query).toMatchObject({ type: 'dash-db' })
    })

    it('passes through an already-resolved raw type value', async () => {
      mock.onGet(`${ BASE }/search`).reply([])

      await service.searchDashboards(undefined, 'dash-folder')

      expect(mock.history[0].query).toMatchObject({ type: 'dash-folder' })
    })

    it('omits empty tag arrays', async () => {
      mock.onGet(`${ BASE }/search`).reply([])

      await service.searchDashboards('x', undefined, [])

      expect(mock.history[0].query).toEqual({ query: 'x', type: 'dash-db' })
    })

    it('wraps API errors with status and message', async () => {
      mock.onGet(`${ BASE }/search`).replyWithError({
        message: 'Unauthorized',
        status: 401,
        body: { message: 'Invalid API key' },
      })

      await expect(service.searchDashboards()).rejects.toThrow('Grafana API error [401]: Invalid API key')
    })
  })

  describe('getDashboardByUid', () => {
    it('fetches a dashboard by uid with url encoding', async () => {
      mock.onGet(`${ BASE }/dashboards/uid/cIB%20gcSjkk`).reply({ dashboard: { uid: 'cIB gcSjkk' } })

      const result = await service.getDashboardByUid('cIB gcSjkk')

      expect(result).toEqual({ dashboard: { uid: 'cIB gcSjkk' } })
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/dashboards/uid/cIB%20gcSjkk`)
    })

    it('wraps API errors', async () => {
      mock.onGet(`${ BASE }/dashboards/uid/missing`).replyWithError({ message: 'Not Found', status: 404 })

      await expect(service.getDashboardByUid('missing')).rejects.toThrow('Grafana API error [404]: Not Found')
    })
  })

  describe('createOrUpdateDashboard', () => {
    it('sends required dashboard with overwrite defaulting to false', async () => {
      mock.onPost(`${ BASE }/dashboards/db`).reply({ status: 'success', uid: 'x' })

      const dashboard = { title: 'New', panels: [] }
      const result = await service.createOrUpdateDashboard(dashboard)

      expect(result).toEqual({ status: 'success', uid: 'x' })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({
        dashboard,
        overwrite: false,
      })
    })

    it('includes folderUid, message and overwrite true when provided', async () => {
      mock.onPost(`${ BASE }/dashboards/db`).reply({ status: 'success' })

      const dashboard = { uid: 'existing', title: 'Updated' }
      await service.createOrUpdateDashboard(dashboard, 'folder-uid', true, 'v2 change')

      expect(mock.history[0].body).toEqual({
        dashboard,
        folderUid: 'folder-uid',
        overwrite: true,
        message: 'v2 change',
      })
    })

    it('coerces non-boolean overwrite to false', async () => {
      mock.onPost(`${ BASE }/dashboards/db`).reply({ status: 'success' })

      await service.createOrUpdateDashboard({ title: 'X' }, undefined, 'yes')

      expect(mock.history[0].body).toEqual({
        dashboard: { title: 'X' },
        overwrite: false,
      })
    })

    it('wraps API errors', async () => {
      mock.onPost(`${ BASE }/dashboards/db`).replyWithError({ message: 'Bad Request', status: 400 })

      await expect(service.createOrUpdateDashboard({ title: 'X' })).rejects.toThrow(
        'Grafana API error [400]: Bad Request'
      )
    })
  })

  describe('deleteDashboard', () => {
    it('sends delete with url encoding', async () => {
      mock.onDelete(`${ BASE }/dashboards/uid/abc`).reply({ message: 'Dashboard deleted' })

      const result = await service.deleteDashboard('abc')

      expect(result).toEqual({ message: 'Dashboard deleted' })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${ BASE }/dashboards/uid/abc`)
    })

    it('wraps API errors', async () => {
      mock.onDelete(`${ BASE }/dashboards/uid/abc`).replyWithError({ message: 'Forbidden', statusCode: 403 })

      await expect(service.deleteDashboard('abc')).rejects.toThrow('Grafana API error [403]: Forbidden')
    })
  })

  describe('getHomeDashboard', () => {
    it('fetches the home dashboard', async () => {
      mock.onGet(`${ BASE }/dashboards/home`).reply({ meta: { isHome: true } })

      const result = await service.getHomeDashboard()

      expect(result).toEqual({ meta: { isHome: true } })
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/dashboards/home`)
    })

    it('wraps API errors', async () => {
      mock.onGet(`${ BASE }/dashboards/home`).replyWithError({ message: 'Boom' })

      await expect(service.getHomeDashboard()).rejects.toThrow('Grafana API error: Boom')
    })
  })

  // ── Folders ──

  describe('listFolders', () => {
    it('lists folders with no limit query by default', async () => {
      mock.onGet(`${ BASE }/folders`).reply([{ uid: 'f1', title: 'Ops' }])

      const result = await service.listFolders()

      expect(result).toEqual([{ uid: 'f1', title: 'Ops' }])
      expect(mock.history[0].query).toEqual({})
    })

    it('passes the limit query when provided', async () => {
      mock.onGet(`${ BASE }/folders`).reply([])

      await service.listFolders(10)

      expect(mock.history[0].query).toEqual({ limit: 10 })
    })

    it('wraps API errors', async () => {
      mock.onGet(`${ BASE }/folders`).replyWithError({ message: 'Boom' })

      await expect(service.listFolders()).rejects.toThrow('Grafana API error: Boom')
    })
  })

  describe('getFolder', () => {
    it('fetches a folder by uid with url encoding', async () => {
      mock.onGet(`${ BASE }/folders/f1`).reply({ uid: 'f1', title: 'Ops' })

      const result = await service.getFolder('f1')

      expect(result).toEqual({ uid: 'f1', title: 'Ops' })
      expect(mock.history[0].url).toBe(`${ BASE }/folders/f1`)
    })

    it('wraps API errors', async () => {
      mock.onGet(`${ BASE }/folders/f1`).replyWithError({ message: 'Not Found', status: 404 })

      await expect(service.getFolder('f1')).rejects.toThrow('Grafana API error [404]: Not Found')
    })
  })

  describe('createFolder', () => {
    it('sends only the title when no uid is provided', async () => {
      mock.onPost(`${ BASE }/folders`).reply({ uid: 'gen', title: 'Ops' })

      const result = await service.createFolder('Ops')

      expect(result).toEqual({ uid: 'gen', title: 'Ops' })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({ title: 'Ops' })
    })

    it('includes a custom uid when provided', async () => {
      mock.onPost(`${ BASE }/folders`).reply({ uid: 'custom', title: 'Ops' })

      await service.createFolder('Ops', 'custom')

      expect(mock.history[0].body).toEqual({ title: 'Ops', uid: 'custom' })
    })

    it('wraps API errors', async () => {
      mock.onPost(`${ BASE }/folders`).replyWithError({ message: 'Conflict', status: 409 })

      await expect(service.createFolder('Ops')).rejects.toThrow('Grafana API error [409]: Conflict')
    })
  })

  describe('deleteFolder', () => {
    it('sends delete by uid', async () => {
      mock.onDelete(`${ BASE }/folders/f1`).reply({ message: 'Folder deleted' })

      const result = await service.deleteFolder('f1')

      expect(result).toEqual({ message: 'Folder deleted' })
      expect(mock.history[0].method).toBe('delete')
    })

    it('wraps API errors', async () => {
      mock.onDelete(`${ BASE }/folders/f1`).replyWithError({ message: 'Boom' })

      await expect(service.deleteFolder('f1')).rejects.toThrow('Grafana API error: Boom')
    })
  })

  // ── Data Sources ──

  describe('listDataSources', () => {
    it('lists data sources', async () => {
      mock.onGet(`${ BASE }/datasources`).reply([{ uid: 'ds1', name: 'Prometheus' }])

      const result = await service.listDataSources()

      expect(result).toEqual([{ uid: 'ds1', name: 'Prometheus' }])
      expect(mock.history[0].method).toBe('get')
    })

    it('wraps API errors', async () => {
      mock.onGet(`${ BASE }/datasources`).replyWithError({ message: 'Boom' })

      await expect(service.listDataSources()).rejects.toThrow('Grafana API error: Boom')
    })
  })

  describe('getDataSource', () => {
    it('fetches a data source by uid', async () => {
      mock.onGet(`${ BASE }/datasources/uid/ds1`).reply({ uid: 'ds1', name: 'Prometheus' })

      const result = await service.getDataSource('ds1')

      expect(result).toEqual({ uid: 'ds1', name: 'Prometheus' })
      expect(mock.history[0].url).toBe(`${ BASE }/datasources/uid/ds1`)
    })

    it('wraps API errors', async () => {
      mock.onGet(`${ BASE }/datasources/uid/ds1`).replyWithError({ message: 'Boom' })

      await expect(service.getDataSource('ds1')).rejects.toThrow('Grafana API error: Boom')
    })
  })

  describe('createDataSource', () => {
    it('sends required params with proxy access and isDefault false by default', async () => {
      mock.onPost(`${ BASE }/datasources`).reply({ id: 1, message: 'Datasource added' })

      const result = await service.createDataSource('Prometheus', 'prometheus')

      expect(result).toEqual({ id: 1, message: 'Datasource added' })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({
        name: 'Prometheus',
        type: 'prometheus',
        access: 'proxy',
        isDefault: false,
      })
    })

    it('resolves the Browser (direct) access choice and includes all params', async () => {
      mock.onPost(`${ BASE }/datasources`).reply({ id: 2 })

      await service.createDataSource(
        'Loki',
        'loki',
        'http://localhost:3100',
        'Browser (direct)',
        true,
        { httpMethod: 'POST' },
        { apiKey: 'secret' }
      )

      expect(mock.history[0].body).toEqual({
        name: 'Loki',
        type: 'loki',
        url: 'http://localhost:3100',
        access: 'direct',
        isDefault: true,
        jsonData: { httpMethod: 'POST' },
        secureJsonData: { apiKey: 'secret' },
      })
    })

    it('resolves the Server (proxy) access choice', async () => {
      mock.onPost(`${ BASE }/datasources`).reply({ id: 3 })

      await service.createDataSource('X', 'prometheus', undefined, 'Server (proxy)')

      expect(mock.history[0].body).toMatchObject({ access: 'proxy' })
    })

    it('passes through an already-resolved raw access value', async () => {
      mock.onPost(`${ BASE }/datasources`).reply({ id: 4 })

      await service.createDataSource('X', 'prometheus', undefined, 'direct')

      expect(mock.history[0].body).toMatchObject({ access: 'direct' })
    })

    it('wraps API errors', async () => {
      mock.onPost(`${ BASE }/datasources`).replyWithError({ message: 'Conflict', status: 409 })

      await expect(service.createDataSource('X', 'prometheus')).rejects.toThrow(
        'Grafana API error [409]: Conflict'
      )
    })
  })

  describe('queryDataSource', () => {
    it('sends queries with default from/to', async () => {
      mock.onPost(`${ BASE }/ds/query`).reply({ results: {} })

      const queries = [{ refId: 'A', datasource: { uid: 'ds1' }, expr: 'up' }]
      const result = await service.queryDataSource(queries)

      expect(result).toEqual({ results: {} })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({
        queries,
        from: 'now-1h',
        to: 'now',
      })
    })

    it('uses provided from/to', async () => {
      mock.onPost(`${ BASE }/ds/query`).reply({ results: {} })

      const queries = [{ refId: 'A' }]
      await service.queryDataSource(queries, 'now-6h', 'now-1m')

      expect(mock.history[0].body).toEqual({
        queries,
        from: 'now-6h',
        to: 'now-1m',
      })
    })

    it('wraps API errors', async () => {
      mock.onPost(`${ BASE }/ds/query`).replyWithError({ message: 'Boom', status: 400 })

      await expect(service.queryDataSource([{ refId: 'A' }])).rejects.toThrow(
        'Grafana API error [400]: Boom'
      )
    })
  })

  // ── Annotations ──

  describe('createAnnotation', () => {
    it('sends required text and time only', async () => {
      mock.onPost(`${ BASE }/annotations`).reply({ id: 1, message: 'Annotation added' })

      const result = await service.createAnnotation('Deploy', 1644488152084)

      expect(result).toEqual({ id: 1, message: 'Annotation added' })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({
        text: 'Deploy',
        time: 1644488152084,
      })
    })

    it('includes all optional params and non-empty tags', async () => {
      mock.onPost(`${ BASE }/annotations`).reply({ id: 2 })

      await service.createAnnotation('Deploy', 1000, 2000, 'dash-uid', 5, ['deploy', 'prod'])

      expect(mock.history[0].body).toEqual({
        text: 'Deploy',
        time: 1000,
        timeEnd: 2000,
        dashboardUID: 'dash-uid',
        panelId: 5,
        tags: ['deploy', 'prod'],
      })
    })

    it('omits an empty tags array', async () => {
      mock.onPost(`${ BASE }/annotations`).reply({ id: 3 })

      await service.createAnnotation('Deploy', 1000, undefined, undefined, undefined, [])

      expect(mock.history[0].body).toEqual({ text: 'Deploy', time: 1000 })
    })

    it('wraps API errors', async () => {
      mock.onPost(`${ BASE }/annotations`).replyWithError({ message: 'Boom' })

      await expect(service.createAnnotation('x', 1)).rejects.toThrow('Grafana API error: Boom')
    })
  })

  describe('listAnnotations', () => {
    it('sends no query params when none provided', async () => {
      mock.onGet(`${ BASE }/annotations`).reply([])

      const result = await service.listAnnotations()

      expect(result).toEqual([])
      expect(mock.history[0].query).toEqual({})
    })

    it('includes all filters with non-empty tags', async () => {
      mock.onGet(`${ BASE }/annotations`).reply([])

      await service.listAnnotations(1000, 2000, ['deploy'], 'dash-uid', 50)

      expect(mock.history[0].query).toEqual({
        from: 1000,
        to: 2000,
        tags: ['deploy'],
        dashboardUID: 'dash-uid',
        limit: 50,
      })
    })

    it('omits an empty tags array', async () => {
      mock.onGet(`${ BASE }/annotations`).reply([])

      await service.listAnnotations(undefined, undefined, [], undefined, 10)

      expect(mock.history[0].query).toEqual({ limit: 10 })
    })

    it('wraps API errors', async () => {
      mock.onGet(`${ BASE }/annotations`).replyWithError({ message: 'Boom' })

      await expect(service.listAnnotations()).rejects.toThrow('Grafana API error: Boom')
    })
  })

  describe('deleteAnnotation', () => {
    it('sends delete by id', async () => {
      mock.onDelete(`${ BASE }/annotations/1124`).reply({ message: 'Annotation deleted' })

      const result = await service.deleteAnnotation(1124)

      expect(result).toEqual({ message: 'Annotation deleted' })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${ BASE }/annotations/1124`)
    })

    it('wraps API errors', async () => {
      mock.onDelete(`${ BASE }/annotations/1124`).replyWithError({ message: 'Boom' })

      await expect(service.deleteAnnotation(1124)).rejects.toThrow('Grafana API error: Boom')
    })
  })

  // ── Alerting ──

  describe('listAlertRules', () => {
    it('lists alert rules via the provisioning API', async () => {
      mock.onGet(`${ BASE }/v1/provisioning/alert-rules`).reply([{ uid: 'r1', title: 'CPU' }])

      const result = await service.listAlertRules()

      expect(result).toEqual([{ uid: 'r1', title: 'CPU' }])
      expect(mock.history[0].url).toBe(`${ BASE }/v1/provisioning/alert-rules`)
    })

    it('wraps API errors', async () => {
      mock.onGet(`${ BASE }/v1/provisioning/alert-rules`).replyWithError({ message: 'Boom' })

      await expect(service.listAlertRules()).rejects.toThrow('Grafana API error: Boom')
    })
  })

  describe('getAlertRule', () => {
    it('fetches an alert rule by uid', async () => {
      mock.onGet(`${ BASE }/v1/provisioning/alert-rules/r1`).reply({ uid: 'r1' })

      const result = await service.getAlertRule('r1')

      expect(result).toEqual({ uid: 'r1' })
      expect(mock.history[0].url).toBe(`${ BASE }/v1/provisioning/alert-rules/r1`)
    })

    it('wraps API errors', async () => {
      mock.onGet(`${ BASE }/v1/provisioning/alert-rules/r1`).replyWithError({ message: 'Not Found', status: 404 })

      await expect(service.getAlertRule('r1')).rejects.toThrow('Grafana API error [404]: Not Found')
    })
  })

  describe('listContactPoints', () => {
    it('lists contact points via the provisioning API', async () => {
      mock.onGet(`${ BASE }/v1/provisioning/contact-points`).reply([{ uid: 'c1', name: 'email' }])

      const result = await service.listContactPoints()

      expect(result).toEqual([{ uid: 'c1', name: 'email' }])
      expect(mock.history[0].url).toBe(`${ BASE }/v1/provisioning/contact-points`)
    })

    it('wraps API errors', async () => {
      mock.onGet(`${ BASE }/v1/provisioning/contact-points`).replyWithError({ message: 'Boom' })

      await expect(service.listContactPoints()).rejects.toThrow('Grafana API error: Boom')
    })
  })

  // ── Organization & Users ──

  describe('getOrg', () => {
    it('fetches the current org', async () => {
      mock.onGet(`${ BASE }/org`).reply({ id: 1, name: 'Main Org.' })

      const result = await service.getOrg()

      expect(result).toEqual({ id: 1, name: 'Main Org.' })
      expect(mock.history[0].url).toBe(`${ BASE }/org`)
    })

    it('wraps API errors', async () => {
      mock.onGet(`${ BASE }/org`).replyWithError({ message: 'Boom' })

      await expect(service.getOrg()).rejects.toThrow('Grafana API error: Boom')
    })
  })

  describe('listOrgUsers', () => {
    it('lists org users', async () => {
      mock.onGet(`${ BASE }/org/users`).reply([{ userId: 1, login: 'admin' }])

      const result = await service.listOrgUsers()

      expect(result).toEqual([{ userId: 1, login: 'admin' }])
      expect(mock.history[0].url).toBe(`${ BASE }/org/users`)
    })

    it('wraps API errors', async () => {
      mock.onGet(`${ BASE }/org/users`).replyWithError({ message: 'Boom' })

      await expect(service.listOrgUsers()).rejects.toThrow('Grafana API error: Boom')
    })
  })

  describe('getCurrentUser', () => {
    it('fetches the current user', async () => {
      mock.onGet(`${ BASE }/user`).reply({ id: 1, login: 'admin' })

      const result = await service.getCurrentUser()

      expect(result).toEqual({ id: 1, login: 'admin' })
      expect(mock.history[0].url).toBe(`${ BASE }/user`)
    })

    it('wraps API errors', async () => {
      mock.onGet(`${ BASE }/user`).replyWithError({ message: 'Boom' })

      await expect(service.getCurrentUser()).rejects.toThrow('Grafana API error: Boom')
    })
  })

  describe('healthCheck', () => {
    it('fetches the health status', async () => {
      mock.onGet(`${ BASE }/health`).reply({ database: 'ok', version: '11.6.0' })

      const result = await service.healthCheck()

      expect(result).toEqual({ database: 'ok', version: '11.6.0' })
      expect(mock.history[0].url).toBe(`${ BASE }/health`)
    })

    it('wraps API errors', async () => {
      mock.onGet(`${ BASE }/health`).replyWithError({ message: 'Unreachable' })

      await expect(service.healthCheck()).rejects.toThrow('Grafana API error: Unreachable')
    })
  })

  // ── Dictionaries ──

  describe('getFoldersDictionary', () => {
    const folders = [
      { uid: 'f1', title: 'Ops' },
      { uid: 'f2', title: 'Marketing' },
    ]

    it('maps folders to items and requests with a high limit', async () => {
      mock.onGet(`${ BASE }/folders`).reply(folders)

      const result = await service.getFoldersDictionary({})

      expect(mock.history[0].query).toEqual({ limit: 5000 })
      expect(result).toEqual({
        items: [
          { label: 'Ops', value: 'f1', note: 'f1' },
          { label: 'Marketing', value: 'f2', note: 'f2' },
        ],
        cursor: null,
      })
    })

    it('filters folders by search term (case-insensitive)', async () => {
      mock.onGet(`${ BASE }/folders`).reply(folders)

      const result = await service.getFoldersDictionary({ search: 'ops' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('f1')
    })

    it('handles a null payload', async () => {
      mock.onGet(`${ BASE }/folders`).reply(folders)

      const result = await service.getFoldersDictionary(null)

      expect(result.items).toHaveLength(2)
    })

    it('handles a non-array API response', async () => {
      mock.onGet(`${ BASE }/folders`).reply({ notAnArray: true })

      const result = await service.getFoldersDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('propagates a wrapped API error', async () => {
      mock.onGet(`${ BASE }/folders`).replyWithError({ message: 'Boom' })

      await expect(service.getFoldersDictionary({})).rejects.toThrow('Grafana API error: Boom')
    })
  })

  describe('getDataSourcesDictionary', () => {
    const dataSources = [
      { uid: 'ds1', name: 'Prometheus', type: 'prometheus' },
      { uid: 'ds2', name: 'Loki Logs', type: 'loki' },
    ]

    it('maps data sources to items', async () => {
      mock.onGet(`${ BASE }/datasources`).reply(dataSources)

      const result = await service.getDataSourcesDictionary({})

      expect(result).toEqual({
        items: [
          { label: 'Prometheus', value: 'ds1', note: 'prometheus' },
          { label: 'Loki Logs', value: 'ds2', note: 'loki' },
        ],
        cursor: null,
      })
    })

    it('filters by name (case-insensitive)', async () => {
      mock.onGet(`${ BASE }/datasources`).reply(dataSources)

      const result = await service.getDataSourcesDictionary({ search: 'prometheus' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('ds1')
    })

    it('filters by type when the name does not match', async () => {
      mock.onGet(`${ BASE }/datasources`).reply(dataSources)

      const result = await service.getDataSourcesDictionary({ search: 'loki' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('ds2')
    })

    it('handles a null payload', async () => {
      mock.onGet(`${ BASE }/datasources`).reply(dataSources)

      const result = await service.getDataSourcesDictionary(null)

      expect(result.items).toHaveLength(2)
    })

    it('handles a non-array API response', async () => {
      mock.onGet(`${ BASE }/datasources`).reply({ notAnArray: true })

      const result = await service.getDataSourcesDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('propagates a wrapped API error', async () => {
      mock.onGet(`${ BASE }/datasources`).replyWithError({ message: 'Boom' })

      await expect(service.getDataSourcesDictionary({})).rejects.toThrow('Grafana API error: Boom')
    })
  })

  // ── Error handling edge cases ──

  describe('error handling', () => {
    it('omits the status segment when no status is present on the error', async () => {
      mock.onGet(`${ BASE }/health`).replyWithError({ message: 'Network down' })

      await expect(service.healthCheck()).rejects.toThrow('Grafana API error: Network down')
    })

    it('prefers error.body.message over error.message', async () => {
      mock.onGet(`${ BASE }/health`).replyWithError({
        message: 'generic',
        status: 500,
        body: { message: 'detailed server message' },
      })

      await expect(service.healthCheck()).rejects.toThrow('Grafana API error [500]: detailed server message')
    })

    it('falls back to error.message when body has no message', async () => {
      mock.onGet(`${ BASE }/health`).replyWithError({
        message: 'plain message',
        statusCode: 502,
        body: {},
      })

      await expect(service.healthCheck()).rejects.toThrow('Grafana API error [502]: plain message')
    })
  })
})
