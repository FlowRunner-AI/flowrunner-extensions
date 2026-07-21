'use strict'

const { createSandbox } = require('../../../service-sandbox')

const WORKSPACE_URL = 'https://dbc-abc123.cloud.databricks.com'
const API_TOKEN = 'dapi-test-token-123'
const BASE = WORKSPACE_URL

describe('Databricks Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ workspaceUrl: WORKSPACE_URL, apiToken: API_TOKEN })
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
          name: 'workspaceUrl',
          displayName: 'Workspace URL',
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

    it('sends Bearer auth and JSON content-type on requests', async () => {
      mock.onGet(`${ BASE }/api/2.0/preview/scim/v2/Me`).reply({ id: '1' })

      await service.getCurrentUser()

      expect(mock.history[0].headers).toMatchObject({
        Authorization: `Bearer ${ API_TOKEN }`,
        'Content-Type': 'application/json',
      })
    })
  })

  // ── Dictionary Methods ──

  describe('getWarehousesDictionary', () => {
    it('maps warehouses to items and hits the warehouses endpoint', async () => {
      mock.onGet(`${ BASE }/api/2.0/sql/warehouses`).reply({
        warehouses: [
          { id: 'wh1', name: 'Serverless Starter', state: 'RUNNING' },
          { id: 'wh2', name: 'Analytics', cluster_size: 'Large' },
        ],
      })

      const result = await service.getWarehousesDictionary({})

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/api/2.0/sql/warehouses`)
      expect(result.items).toEqual([
        { label: 'Serverless Starter', value: 'wh1', note: 'RUNNING' },
        { label: 'Analytics', value: 'wh2', note: 'Large' },
      ])
    })

    it('filters by search term (case-insensitive)', async () => {
      mock.onGet(`${ BASE }/api/2.0/sql/warehouses`).reply({
        warehouses: [
          { id: 'wh1', name: 'Serverless Starter', state: 'RUNNING' },
          { id: 'wh2', name: 'Analytics', state: 'STOPPED' },
        ],
      })

      const result = await service.getWarehousesDictionary({ search: 'analyt' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('wh2')
    })

    it('handles a null payload and missing warehouses field', async () => {
      mock.onGet(`${ BASE }/api/2.0/sql/warehouses`).reply({})

      const result = await service.getWarehousesDictionary(null)

      expect(result.items).toEqual([])
    })

    it('propagates a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/api/2.0/sql/warehouses`).replyWithError({
        message: 'Unauthorized',
        status: 401,
      })

      await expect(service.getWarehousesDictionary({})).rejects.toThrow(
        'Databricks API error [401]: Unauthorized'
      )
    })
  })

  describe('getJobsDictionary', () => {
    it('maps jobs to items with pagination query and returns cursor', async () => {
      mock.onGet(`${ BASE }/api/2.1/jobs/list`).reply({
        jobs: [
          { job_id: 620916987432618, settings: { name: 'Nightly ETL' } },
          { job_id: 12345 },
        ],
        next_page_token: 'CAEQ...',
      })

      const result = await service.getJobsDictionary({})

      expect(mock.history[0].query).toMatchObject({ limit: 25, expand_tasks: false })
      expect(result.items).toEqual([
        { label: 'Nightly ETL', value: '620916987432618', note: 'Job ID: 620916987432618' },
        { label: 'Job 12345', value: '12345', note: 'Job ID: 12345' },
      ])
      expect(result.cursor).toBe('CAEQ...')
    })

    it('passes search as name and cursor as page_token', async () => {
      mock.onGet(`${ BASE }/api/2.1/jobs/list`).reply({ jobs: [] })

      await service.getJobsDictionary({ search: 'etl', cursor: 'TOKEN' })

      expect(mock.history[0].query).toMatchObject({
        name: 'etl',
        page_token: 'TOKEN',
        limit: 25,
        expand_tasks: false,
      })
    })

    it('handles a null payload and missing jobs field', async () => {
      mock.onGet(`${ BASE }/api/2.1/jobs/list`).reply({})

      const result = await service.getJobsDictionary(null)

      expect(result.items).toEqual([])
      expect(result.cursor).toBeUndefined()
    })

    it('propagates a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/api/2.1/jobs/list`).replyWithError({
        message: 'Server Error',
        statusCode: 500,
      })

      await expect(service.getJobsDictionary({})).rejects.toThrow(
        'Databricks API error [500]: Server Error'
      )
    })
  })

  // ── SQL: Statement Execution ──

  describe('executeStatement', () => {
    it('sends with required params and default wait_timeout', async () => {
      mock.onPost(`${ BASE }/api/2.0/sql/statements`).reply({ statement_id: 's1' })

      const result = await service.executeStatement('wh1', 'SELECT 1')

      expect(result).toEqual({ statement_id: 's1' })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/api/2.0/sql/statements`)
      expect(mock.history[0].body).toEqual({
        warehouse_id: 'wh1',
        statement: 'SELECT 1',
        wait_timeout: '10s',
      })
    })

    it('includes all optional params and maps choices', async () => {
      mock.onPost(`${ BASE }/api/2.0/sql/statements`).reply({ statement_id: 's2' })

      await service.executeStatement(
        'wh1',
        'SELECT :n',
        'main',
        'default',
        [{ name: 'n', value: '42', type: 'INT' }],
        30,
        'External Links',
        'Cancel'
      )

      expect(mock.history[0].body).toEqual({
        warehouse_id: 'wh1',
        statement: 'SELECT :n',
        catalog: 'main',
        schema: 'default',
        parameters: [{ name: 'n', value: '42', type: 'INT' }],
        wait_timeout: '30s',
        disposition: 'EXTERNAL_LINKS',
        on_wait_timeout: 'CANCEL',
      })
    })

    it('treats wait_timeout 0 as async', async () => {
      mock.onPost(`${ BASE }/api/2.0/sql/statements`).reply({ statement_id: 's3' })

      await service.executeStatement('wh1', 'SELECT 1', undefined, undefined, undefined, 0)

      expect(mock.history[0].body).toMatchObject({ wait_timeout: '0s' })
    })

    it('omits an empty parameters array', async () => {
      mock.onPost(`${ BASE }/api/2.0/sql/statements`).reply({ statement_id: 's4' })

      await service.executeStatement('wh1', 'SELECT 1', undefined, undefined, [])

      expect(mock.history[0].body).not.toHaveProperty('parameters')
    })

    it('passes through unmapped choice values unchanged', async () => {
      mock.onPost(`${ BASE }/api/2.0/sql/statements`).reply({ statement_id: 's5' })

      await service.executeStatement(
        'wh1',
        'SELECT 1',
        undefined,
        undefined,
        undefined,
        undefined,
        'INLINE'
      )

      expect(mock.history[0].body).toMatchObject({ disposition: 'INLINE' })
    })

    it('propagates a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/api/2.0/sql/statements`).replyWithError({
        message: 'Bad statement',
        status: 400,
      })

      await expect(service.executeStatement('wh1', 'BAD SQL')).rejects.toThrow(
        'Databricks API error [400]: Bad statement'
      )
    })

    it('uses error body message when present', async () => {
      mock.onPost(`${ BASE }/api/2.0/sql/statements`).replyWithError({
        message: 'HTTP failure',
        status: 403,
        body: { message: 'Permission denied' },
      })

      await expect(service.executeStatement('wh1', 'SELECT 1')).rejects.toThrow(
        'Databricks API error [403]: Permission denied'
      )
    })
  })

  describe('getStatementResult', () => {
    it('fetches a statement by id with url encoding', async () => {
      mock.onGet(`${ BASE }/api/2.0/sql/statements/01ef-abc`).reply({ statement_id: '01ef-abc' })

      const result = await service.getStatementResult('01ef-abc')

      expect(result).toEqual({ statement_id: '01ef-abc' })
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/api/2.0/sql/statements/01ef-abc`)
    })

    it('propagates a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/api/2.0/sql/statements/bad`).replyWithError({ message: 'Not found', status: 404 })

      await expect(service.getStatementResult('bad')).rejects.toThrow(
        'Databricks API error [404]: Not found'
      )
    })
  })

  describe('cancelStatement', () => {
    it('posts to the cancel endpoint without a body', async () => {
      mock.onPost(`${ BASE }/api/2.0/sql/statements/01ef-abc/cancel`).reply({})

      const result = await service.cancelStatement('01ef-abc')

      expect(result).toEqual({})
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/api/2.0/sql/statements/01ef-abc/cancel`)
      expect(mock.history[0].body).toBeUndefined()
    })

    it('propagates a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/api/2.0/sql/statements/s1/cancel`).replyWithError({ message: 'Boom' })

      await expect(service.cancelStatement('s1')).rejects.toThrow('Databricks API error: Boom')
    })
  })

  // ── SQL: Warehouses ──

  describe('listWarehouses', () => {
    it('sends a GET to the warehouses endpoint', async () => {
      mock.onGet(`${ BASE }/api/2.0/sql/warehouses`).reply({ warehouses: [] })

      const result = await service.listWarehouses()

      expect(result).toEqual({ warehouses: [] })
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/api/2.0/sql/warehouses`)
    })

    it('propagates a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/api/2.0/sql/warehouses`).replyWithError({ message: 'Boom' })

      await expect(service.listWarehouses()).rejects.toThrow('Databricks API error: Boom')
    })
  })

  describe('getWarehouse', () => {
    it('fetches a warehouse by id with url encoding', async () => {
      mock.onGet(`${ BASE }/api/2.0/sql/warehouses/wh1`).reply({ id: 'wh1', state: 'RUNNING' })

      const result = await service.getWarehouse('wh1')

      expect(result).toEqual({ id: 'wh1', state: 'RUNNING' })
      expect(mock.history[0].url).toBe(`${ BASE }/api/2.0/sql/warehouses/wh1`)
    })

    it('propagates a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/api/2.0/sql/warehouses/wh1`).replyWithError({ message: 'Boom' })

      await expect(service.getWarehouse('wh1')).rejects.toThrow('Databricks API error: Boom')
    })
  })

  describe('startWarehouse', () => {
    it('posts to the start endpoint', async () => {
      mock.onPost(`${ BASE }/api/2.0/sql/warehouses/wh1/start`).reply({})

      const result = await service.startWarehouse('wh1')

      expect(result).toEqual({})
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/api/2.0/sql/warehouses/wh1/start`)
      expect(mock.history[0].body).toBeUndefined()
    })

    it('propagates a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/api/2.0/sql/warehouses/wh1/start`).replyWithError({ message: 'Boom' })

      await expect(service.startWarehouse('wh1')).rejects.toThrow('Databricks API error: Boom')
    })
  })

  describe('stopWarehouse', () => {
    it('posts to the stop endpoint', async () => {
      mock.onPost(`${ BASE }/api/2.0/sql/warehouses/wh1/stop`).reply({})

      const result = await service.stopWarehouse('wh1')

      expect(result).toEqual({})
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/api/2.0/sql/warehouses/wh1/stop`)
    })

    it('propagates a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/api/2.0/sql/warehouses/wh1/stop`).replyWithError({ message: 'Boom' })

      await expect(service.stopWarehouse('wh1')).rejects.toThrow('Databricks API error: Boom')
    })
  })

  // ── Jobs ──

  describe('listJobs', () => {
    it('sends an empty query when no filters are provided', async () => {
      mock.onGet(`${ BASE }/api/2.1/jobs/list`).reply({ jobs: [], has_more: false })

      const result = await service.listJobs()

      expect(result).toEqual({ jobs: [], has_more: false })
      expect(mock.history[0].query).toEqual({})
    })

    it('includes all filters when provided', async () => {
      mock.onGet(`${ BASE }/api/2.1/jobs/list`).reply({ jobs: [] })

      await service.listJobs('ETL', 50, 'PAGE', true)

      expect(mock.history[0].query).toEqual({
        name: 'ETL',
        limit: 50,
        page_token: 'PAGE',
        expand_tasks: true,
      })
    })

    it('propagates a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/api/2.1/jobs/list`).replyWithError({ message: 'Boom' })

      await expect(service.listJobs()).rejects.toThrow('Databricks API error: Boom')
    })
  })

  describe('getJob', () => {
    it('fetches a job with job_id query', async () => {
      mock.onGet(`${ BASE }/api/2.1/jobs/get`).reply({ job_id: 620916987432618 })

      const result = await service.getJob('620916987432618')

      expect(result).toEqual({ job_id: 620916987432618 })
      expect(mock.history[0].query).toEqual({ job_id: '620916987432618' })
    })

    it('propagates a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/api/2.1/jobs/get`).replyWithError({ message: 'Boom' })

      await expect(service.getJob('1')).rejects.toThrow('Databricks API error: Boom')
    })
  })

  describe('runJobNow', () => {
    it('coerces a numeric job id and sends only job_id when no overrides', async () => {
      mock.onPost(`${ BASE }/api/2.1/jobs/run-now`).reply({ run_id: 455644833 })

      const result = await service.runJobNow('620916987432618')

      expect(result).toEqual({ run_id: 455644833 })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({ job_id: 620916987432618 })
      expect(typeof mock.history[0].body.job_id).toBe('number')
    })

    it('includes notebook and job parameters when provided', async () => {
      mock.onPost(`${ BASE }/api/2.1/jobs/run-now`).reply({ run_id: 1 })

      await service.runJobNow(
        '123',
        { widget: 'value' },
        { env: 'prod' }
      )

      expect(mock.history[0].body).toEqual({
        job_id: 123,
        notebook_params: { widget: 'value' },
        job_parameters: { env: 'prod' },
      })
    })

    it('keeps a non-numeric job id as-is', async () => {
      mock.onPost(`${ BASE }/api/2.1/jobs/run-now`).reply({ run_id: 1 })

      await service.runJobNow('not-a-number')

      expect(mock.history[0].body).toEqual({ job_id: 'not-a-number' })
    })

    it('propagates a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/api/2.1/jobs/run-now`).replyWithError({ message: 'Boom' })

      await expect(service.runJobNow('1')).rejects.toThrow('Databricks API error: Boom')
    })
  })

  describe('listRuns', () => {
    it('sends an empty query when no filters are provided', async () => {
      mock.onGet(`${ BASE }/api/2.1/jobs/runs/list`).reply({ runs: [], has_more: false })

      const result = await service.listRuns()

      expect(result).toEqual({ runs: [], has_more: false })
      expect(mock.history[0].query).toEqual({})
    })

    it('coerces a numeric job id and includes all filters', async () => {
      mock.onGet(`${ BASE }/api/2.1/jobs/runs/list`).reply({ runs: [] })

      await service.listRuns('620916987432618', true, false, 25, 'PAGE')

      expect(mock.history[0].query).toEqual({
        job_id: 620916987432618,
        active_only: true,
        completed_only: false,
        limit: 25,
        page_token: 'PAGE',
      })
    })

    it('propagates a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/api/2.1/jobs/runs/list`).replyWithError({ message: 'Boom' })

      await expect(service.listRuns()).rejects.toThrow('Databricks API error: Boom')
    })
  })

  describe('getRun', () => {
    it('fetches a run with run_id query', async () => {
      mock.onGet(`${ BASE }/api/2.1/jobs/runs/get`).reply({ run_id: 455644833 })

      const result = await service.getRun('455644833')

      expect(result).toEqual({ run_id: 455644833 })
      expect(mock.history[0].query).toEqual({ run_id: '455644833' })
    })

    it('propagates a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/api/2.1/jobs/runs/get`).replyWithError({ message: 'Boom' })

      await expect(service.getRun('1')).rejects.toThrow('Databricks API error: Boom')
    })
  })

  describe('getRunOutput', () => {
    it('fetches run output with run_id query', async () => {
      mock.onGet(`${ BASE }/api/2.1/jobs/runs/get-output`).reply({ notebook_output: { result: 'done' } })

      const result = await service.getRunOutput('455644833')

      expect(result).toEqual({ notebook_output: { result: 'done' } })
      expect(mock.history[0].query).toEqual({ run_id: '455644833' })
    })

    it('propagates a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/api/2.1/jobs/runs/get-output`).replyWithError({ message: 'Boom' })

      await expect(service.getRunOutput('1')).rejects.toThrow('Databricks API error: Boom')
    })
  })

  describe('cancelRun', () => {
    it('coerces a numeric run id and posts run_id body', async () => {
      mock.onPost(`${ BASE }/api/2.1/jobs/runs/cancel`).reply({})

      const result = await service.cancelRun('455644833')

      expect(result).toEqual({})
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({ run_id: 455644833 })
      expect(typeof mock.history[0].body.run_id).toBe('number')
    })

    it('keeps a non-numeric run id as-is', async () => {
      mock.onPost(`${ BASE }/api/2.1/jobs/runs/cancel`).reply({})

      await service.cancelRun('run-x')

      expect(mock.history[0].body).toEqual({ run_id: 'run-x' })
    })

    it('propagates a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/api/2.1/jobs/runs/cancel`).replyWithError({ message: 'Boom' })

      await expect(service.cancelRun('1')).rejects.toThrow('Databricks API error: Boom')
    })
  })

  // ── Clusters ──

  describe('listClusters', () => {
    it('sends a GET to the clusters list endpoint', async () => {
      mock.onGet(`${ BASE }/api/2.0/clusters/list`).reply({ clusters: [] })

      const result = await service.listClusters()

      expect(result).toEqual({ clusters: [] })
      expect(mock.history[0].url).toBe(`${ BASE }/api/2.0/clusters/list`)
    })

    it('propagates a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/api/2.0/clusters/list`).replyWithError({ message: 'Boom' })

      await expect(service.listClusters()).rejects.toThrow('Databricks API error: Boom')
    })
  })

  describe('getCluster', () => {
    it('fetches a cluster with cluster_id query', async () => {
      mock.onGet(`${ BASE }/api/2.0/clusters/get`).reply({ cluster_id: '0101-abc' })

      const result = await service.getCluster('0101-abc')

      expect(result).toEqual({ cluster_id: '0101-abc' })
      expect(mock.history[0].query).toEqual({ cluster_id: '0101-abc' })
    })

    it('propagates a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/api/2.0/clusters/get`).replyWithError({ message: 'Boom' })

      await expect(service.getCluster('0101-abc')).rejects.toThrow('Databricks API error: Boom')
    })
  })

  describe('startCluster', () => {
    it('posts cluster_id body to the start endpoint', async () => {
      mock.onPost(`${ BASE }/api/2.0/clusters/start`).reply({})

      const result = await service.startCluster('0101-abc')

      expect(result).toEqual({})
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({ cluster_id: '0101-abc' })
    })

    it('propagates a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/api/2.0/clusters/start`).replyWithError({ message: 'Boom' })

      await expect(service.startCluster('0101-abc')).rejects.toThrow('Databricks API error: Boom')
    })
  })

  describe('terminateCluster', () => {
    it('posts cluster_id body to the delete endpoint', async () => {
      mock.onPost(`${ BASE }/api/2.0/clusters/delete`).reply({})

      const result = await service.terminateCluster('0101-abc')

      expect(result).toEqual({})
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/api/2.0/clusters/delete`)
      expect(mock.history[0].body).toEqual({ cluster_id: '0101-abc' })
    })

    it('propagates a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/api/2.0/clusters/delete`).replyWithError({ message: 'Boom' })

      await expect(service.terminateCluster('0101-abc')).rejects.toThrow('Databricks API error: Boom')
    })
  })

  // ── Unity Catalog ──

  describe('listCatalogs', () => {
    it('sends a GET to the catalogs endpoint', async () => {
      mock.onGet(`${ BASE }/api/2.1/unity-catalog/catalogs`).reply({ catalogs: [] })

      const result = await service.listCatalogs()

      expect(result).toEqual({ catalogs: [] })
      expect(mock.history[0].url).toBe(`${ BASE }/api/2.1/unity-catalog/catalogs`)
    })

    it('propagates a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/api/2.1/unity-catalog/catalogs`).replyWithError({ message: 'Boom' })

      await expect(service.listCatalogs()).rejects.toThrow('Databricks API error: Boom')
    })
  })

  describe('listSchemas', () => {
    it('fetches schemas with catalog_name query', async () => {
      mock.onGet(`${ BASE }/api/2.1/unity-catalog/schemas`).reply({ schemas: [] })

      const result = await service.listSchemas('main')

      expect(result).toEqual({ schemas: [] })
      expect(mock.history[0].query).toEqual({ catalog_name: 'main' })
    })

    it('propagates a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/api/2.1/unity-catalog/schemas`).replyWithError({ message: 'Boom' })

      await expect(service.listSchemas('main')).rejects.toThrow('Databricks API error: Boom')
    })
  })

  describe('listTables', () => {
    it('fetches tables with catalog_name and schema_name query', async () => {
      mock.onGet(`${ BASE }/api/2.1/unity-catalog/tables`).reply({ tables: [] })

      const result = await service.listTables('main', 'default')

      expect(result).toEqual({ tables: [] })
      expect(mock.history[0].query).toEqual({ catalog_name: 'main', schema_name: 'default' })
    })

    it('propagates a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/api/2.1/unity-catalog/tables`).replyWithError({ message: 'Boom' })

      await expect(service.listTables('main', 'default')).rejects.toThrow('Databricks API error: Boom')
    })
  })

  // ── DBFS / Workspace ──

  describe('listDbfs', () => {
    it('fetches DBFS contents with path query', async () => {
      mock.onGet(`${ BASE }/api/2.0/dbfs/list`).reply({ files: [] })

      const result = await service.listDbfs('/FileStore')

      expect(result).toEqual({ files: [] })
      expect(mock.history[0].query).toEqual({ path: '/FileStore' })
    })

    it('propagates a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/api/2.0/dbfs/list`).replyWithError({ message: 'Boom' })

      await expect(service.listDbfs('/FileStore')).rejects.toThrow('Databricks API error: Boom')
    })
  })

  describe('listWorkspace', () => {
    it('fetches workspace contents with path query', async () => {
      mock.onGet(`${ BASE }/api/2.0/workspace/list`).reply({ objects: [] })

      const result = await service.listWorkspace('/Shared')

      expect(result).toEqual({ objects: [] })
      expect(mock.history[0].query).toEqual({ path: '/Shared' })
    })

    it('propagates a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/api/2.0/workspace/list`).replyWithError({ message: 'Boom' })

      await expect(service.listWorkspace('/Shared')).rejects.toThrow('Databricks API error: Boom')
    })
  })

  // ── Current User ──

  describe('getCurrentUser', () => {
    it('fetches the SCIM Me profile', async () => {
      mock.onGet(`${ BASE }/api/2.0/preview/scim/v2/Me`).reply({
        id: '123',
        userName: 'me@example.com',
        active: true,
      })

      const result = await service.getCurrentUser()

      expect(result).toEqual({ id: '123', userName: 'me@example.com', active: true })
      expect(mock.history[0].url).toBe(`${ BASE }/api/2.0/preview/scim/v2/Me`)
    })

    it('falls back to error_code when no message is present', async () => {
      mock.onGet(`${ BASE }/api/2.0/preview/scim/v2/Me`).replyWithError({
        body: { error_code: 'PERMISSION_DENIED' },
        status: 403,
      })

      await expect(service.getCurrentUser()).rejects.toThrow(
        'Databricks API error [403]: PERMISSION_DENIED'
      )
    })

    it('propagates a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/api/2.0/preview/scim/v2/Me`).replyWithError({ message: 'Boom' })

      await expect(service.getCurrentUser()).rejects.toThrow('Databricks API error: Boom')
    })
  })
})

// Isolated suite: constructs the service with a trailing-slash workspace URL.
// Uses its own sandbox and a fresh module registration so it does not disturb
// the primary suite's service instance.
describe('Databricks Service - workspace URL normalization', () => {
  let localSandbox
  let localService
  let localMock

  beforeAll(() => {
    jest.resetModules()
    localSandbox = createSandbox({
      workspaceUrl: 'https://dbc-xyz.cloud.databricks.com/',
      apiToken: 'tok-9',
    })
    require('../src/index.js')
    localService = localSandbox.getService()
    localMock = localSandbox.getRequestMock()
  })

  afterAll(() => {
    localSandbox.cleanup()
    jest.resetModules()
  })

  it('strips the trailing slash so URLs have no double slash', async () => {
    localMock
      .onGet('https://dbc-xyz.cloud.databricks.com/api/2.0/preview/scim/v2/Me')
      .reply({ id: '9' })

    const result = await localService.getCurrentUser()

    expect(result).toEqual({ id: '9' })
    expect(localMock.history[0].url).toBe(
      'https://dbc-xyz.cloud.databricks.com/api/2.0/preview/scim/v2/Me'
    )
  })
})
