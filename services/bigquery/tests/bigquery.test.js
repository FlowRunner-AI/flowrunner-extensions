'use strict'

const crypto = require('node:crypto')
const { createSandbox } = require('../../../service-sandbox')

// A real 2048-bit RSA keypair so the service's genuine JWT signing path
// (crypto.createSign('RSA-SHA256').sign(private_key)) executes for real. Only the
// HTTP boundary (Google token endpoint + BigQuery API) is mocked; signing is not.
const { privateKey: PRIVATE_KEY } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
})

const SERVICE_ACCOUNT = {
  type: 'service_account',
  project_id: 'key-file-project',
  client_email: 'svc@key-file-project.iam.gserviceaccount.com',
  private_key: PRIVATE_KEY,
}

const SERVICE_ACCOUNT_KEY = JSON.stringify(SERVICE_ACCOUNT)
const PROJECT_ID = 'test-project'
const LOCATION = 'US'
const BASE = `https://bigquery.googleapis.com/bigquery/v2/projects/${ PROJECT_ID }`
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const ACCESS_TOKEN = 'ya29.test-access-token'

function stubToken(mock) {
  mock.onPost(TOKEN_URL).reply({ access_token: ACCESS_TOKEN, expires_in: 3600 })
}

describe('Google BigQuery Service', () => {
  let sandbox
  let service
  let mock
  let mainFlowrunner

  // Build a service instance backed by its own config + mock, isolated from the
  // shared instance. The service module caches on first require and only calls
  // addService() once, so we clear the require cache to force re-registration with
  // the new config. The isolated sandbox reassigns global.Flowrunner, so the
  // returned cleanup() restores the shared instance's global before other tests run.
  function createIsolatedService(config) {
    const isoSandbox = createSandbox(config)

    // Under Jest the service module is registered in Jest's own module registry, so
    // deleting Node's require.cache is not enough — jest.isolateModules() gives the
    // enclosed require() a fresh registry so addService() runs again against the
    // isolated sandbox's global.Flowrunner.
    jest.isolateModules(() => {
      require('../src/index.js')
    })

    return {
      service: isoSandbox.getService(),
      mock: isoSandbox.getRequestMock(),
      cleanup() {
        isoSandbox.cleanup()
        global.Flowrunner = mainFlowrunner
      },
    }
  }

  beforeAll(async () => {
    sandbox = createSandbox({
      serviceAccountKey: SERVICE_ACCOUNT_KEY,
      projectId: PROJECT_ID,
      location: LOCATION,
    })
    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()
    mainFlowrunner = global.Flowrunner

    // Warm up: perform one request so the access token is signed and cached on the
    // shared service instance. After this, mock.history[0] in every test is the
    // actual BigQuery request (the token endpoint is not hit again for ~1h).
    stubToken(mock)
    mock.onGet(`${ BASE }/datasets`).reply({ datasets: [] })
    await service.listDatasets()
    mock.reset()
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
          name: 'serviceAccountKey',
          displayName: 'Service Account Key (JSON)',
          required: true,
          shared: false,
          type: 'TEXT',
        }),
        expect.objectContaining({
          name: 'projectId',
          displayName: 'Project ID',
          required: false,
          shared: false,
          type: 'STRING',
        }),
        expect.objectContaining({
          name: 'location',
          displayName: 'Location',
          required: false,
          shared: false,
          type: 'STRING',
        }),
      ])
    })

    it('sends the bearer token and JSON content-type on requests', async () => {
      mock.onGet(`${ BASE }/datasets`).reply({ datasets: [] })

      await service.listDatasets()

      expect(mock.history[0].headers).toMatchObject({
        'Authorization': `Bearer ${ ACCESS_TOKEN }`,
        'Content-Type': 'application/json',
      })
    })
  })

  // ── Authentication / token exchange ──

  describe('access token exchange', () => {
    it('exchanges a signed JWT for an access token on the first request', async () => {
      // Isolated instance so the token is not yet cached and the token endpoint is hit.
      const iso = createIsolatedService({
        serviceAccountKey: SERVICE_ACCOUNT_KEY,
        projectId: PROJECT_ID,
        location: LOCATION,
      })

      stubToken(iso.mock)
      iso.mock.onGet(`${ BASE }/datasets`).reply({ datasets: [] })

      await iso.service.listDatasets()

      // First call is the JWT-bearer token exchange to Google.
      expect(iso.mock.history[0].method).toBe('post')
      expect(iso.mock.history[0].url).toBe(TOKEN_URL)
      expect(iso.mock.history[0].headers).toMatchObject({
        'Content-Type': 'application/x-www-form-urlencoded',
      })
      expect(typeof iso.mock.history[0].body).toBe('string')
      expect(iso.mock.history[0].body).toContain('grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer')
      expect(iso.mock.history[0].body).toContain('assertion=')

      // Second call is the BigQuery request carrying the returned token.
      expect(iso.mock.history[1].url).toBe(`${ BASE }/datasets`)
      expect(iso.mock.history[1].headers).toMatchObject({
        'Authorization': `Bearer ${ ACCESS_TOKEN }`,
      })

      iso.cleanup()
    })

    it('caches the access token across requests', async () => {
      const iso = createIsolatedService({
        serviceAccountKey: SERVICE_ACCOUNT_KEY,
        projectId: PROJECT_ID,
      })

      stubToken(iso.mock)
      iso.mock.onGet(`${ BASE }/datasets`).reply({ datasets: [] })

      await iso.service.listDatasets()
      await iso.service.listDatasets()

      // Only one token exchange for two BigQuery requests (token endpoint hit once).
      const tokenCalls = iso.mock.history.filter(h => h.url === TOKEN_URL)

      expect(tokenCalls).toHaveLength(1)
      iso.cleanup()
    })

    it('throws a helpful error when the service account key is not valid JSON', async () => {
      const iso = createIsolatedService({ serviceAccountKey: 'not-json', projectId: PROJECT_ID })

      await expect(iso.service.listDatasets()).rejects.toThrow(
        'Service account key is not valid JSON'
      )

      iso.cleanup()
    })

    it('throws when the key is missing client_email or private_key', async () => {
      const iso = createIsolatedService({
        serviceAccountKey: JSON.stringify({ project_id: 'x' }),
        projectId: PROJECT_ID,
      })

      await expect(iso.service.listDatasets()).rejects.toThrow(
        'is missing "client_email" or "private_key"'
      )

      iso.cleanup()
    })

    it('surfaces token endpoint failures', async () => {
      const iso = createIsolatedService({
        serviceAccountKey: SERVICE_ACCOUNT_KEY,
        projectId: PROJECT_ID,
      })

      iso.mock.onPost(TOKEN_URL).replyWithError({
        message: 'invalid_grant',
        body: { error: 'invalid_grant', error_description: 'Invalid JWT Signature' },
      })

      await expect(iso.service.listDatasets()).rejects.toThrow(
        'Failed to obtain an access token from Google: Invalid JWT Signature'
      )

      iso.cleanup()
    })

    it('throws when the token endpoint returns no access_token', async () => {
      const iso = createIsolatedService({
        serviceAccountKey: SERVICE_ACCOUNT_KEY,
        projectId: PROJECT_ID,
      })

      iso.mock.onPost(TOKEN_URL).reply({ token_type: 'Bearer' })
      iso.mock.onGet(`${ BASE }/datasets`).reply({ datasets: [] })

      await expect(iso.service.listDatasets()).rejects.toThrow(
        'Google token endpoint did not return an access token'
      )

      iso.cleanup()
    })

    it('derives the project id from the key file when projectId config is empty', async () => {
      // No projectId config -> base URL should use key file's project_id.
      const iso = createIsolatedService({ serviceAccountKey: SERVICE_ACCOUNT_KEY })
      const keyBase = `https://bigquery.googleapis.com/bigquery/v2/projects/${ SERVICE_ACCOUNT.project_id }`

      stubToken(iso.mock)
      iso.mock.onGet(`${ keyBase }/datasets`).reply({ datasets: [] })

      await iso.service.listDatasets()

      const bqCall = iso.mock.history.find(h => h.url === `${ keyBase }/datasets`)

      expect(bqCall).toBeDefined()
      iso.cleanup()
    })
  })

  // ── Queries ──

  describe('runQuery', () => {
    it('sends the required body for a completed query and converts rows', async () => {
      mock.onPost(`${ BASE }/queries`).reply({
        jobComplete: true,
        jobReference: { jobId: 'job_1', location: 'US' },
        schema: {
          fields: [
            { name: 'name', type: 'STRING' },
            { name: 'age', type: 'INTEGER' },
            { name: 'active', type: 'BOOLEAN' },
          ],
        },
        rows: [{ f: [{ v: 'Alice' }, { v: '30' }, { v: 'true' }] }],
        totalRows: '1',
        totalBytesProcessed: '65536',
        cacheHit: false,
      })

      const result = await service.runQuery('SELECT name, age, active FROM `ds.users`')

      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/queries`)
      expect(mock.history[0].body).toEqual({
        query: 'SELECT name, age, active FROM `ds.users`',
        useLegacySql: false,
        timeoutMs: 30000,
        location: 'US',
      })
      expect(result).toEqual({
        jobComplete: true,
        jobId: 'job_1',
        location: 'US',
        rows: [{ name: 'Alice', age: 30, active: true }],
        totalRows: 1,
        pageToken: null,
        totalBytesProcessed: 65536,
        cacheHit: false,
        numDmlAffectedRows: null,
      })
    })

    it('includes named parameters, maxResults and custom timeout', async () => {
      mock.onPost(`${ BASE }/queries`).reply({
        jobComplete: true,
        jobReference: { jobId: 'job_2' },
        schema: { fields: [] },
        rows: [],
        totalRows: '0',
      })

      await service.runQuery(
        'SELECT * FROM `ds.t` WHERE age > @minAge AND score > @score AND active = @flag AND name = @name',
        { minAge: 30, score: 1.5, flag: true, name: 'Alice' },
        100,
        5000
      )

      expect(mock.history[0].body).toEqual({
        query: 'SELECT * FROM `ds.t` WHERE age > @minAge AND score > @score AND active = @flag AND name = @name',
        useLegacySql: false,
        timeoutMs: 5000,
        maxResults: 100,
        location: 'US',
        parameterMode: 'NAMED',
        queryParameters: [
          { name: 'minAge', parameterType: { type: 'INT64' }, parameterValue: { value: '30' } },
          { name: 'score', parameterType: { type: 'FLOAT64' }, parameterValue: { value: '1.5' } },
          { name: 'flag', parameterType: { type: 'BOOL' }, parameterValue: { value: 'true' } },
          { name: 'name', parameterType: { type: 'STRING' }, parameterValue: { value: 'Alice' } },
        ],
      })
    })

    it('returns a pending result when the job has not completed', async () => {
      mock.onPost(`${ BASE }/queries`).reply({
        jobComplete: false,
        jobReference: { jobId: 'job_pending', location: 'EU' },
        pageToken: 'tok',
      })

      const result = await service.runQuery('SELECT 1')

      expect(result).toEqual({
        jobComplete: false,
        jobId: 'job_pending',
        location: 'EU',
        pageToken: 'tok',
        message: expect.stringContaining('Get Query Results'),
      })
    })

    it('reports numDmlAffectedRows for DML statements', async () => {
      mock.onPost(`${ BASE }/queries`).reply({
        jobComplete: true,
        jobReference: { jobId: 'job_dml' },
        schema: { fields: [] },
        rows: [],
        totalRows: '0',
        numDmlAffectedRows: '5',
      })

      const result = await service.runQuery('UPDATE `ds.t` SET x = 1 WHERE y = 2')

      expect(result.numDmlAffectedRows).toBe(5)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/queries`).replyWithError({
        message: 'Bad Request',
        body: { error: { message: 'Syntax error', errors: [{ reason: 'invalidQuery' }] } },
      })

      await expect(service.runQuery('SELECT bad')).rejects.toThrow(
        'BigQuery API error: Syntax error (reason: invalidQuery)'
      )
    })
  })

  describe('getQueryResults', () => {
    it('fetches results by job id with location and url encoding', async () => {
      mock.onGet(`${ BASE }/queries/job%201`).reply({
        jobComplete: true,
        jobReference: { jobId: 'job 1', location: 'US' },
        schema: { fields: [{ name: 'n', type: 'INTEGER' }] },
        rows: [{ f: [{ v: '42' }] }],
        totalRows: '420',
        pageToken: 'next-token',
      })

      const result = await service.getQueryResults('job 1')

      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/queries/job%201`)
      expect(mock.history[0].query).toEqual({ location: 'US' })
      expect(result).toMatchObject({
        jobComplete: true,
        jobId: 'job 1',
        rows: [{ n: 42 }],
        totalRows: 420,
        pageToken: 'next-token',
      })
    })

    it('passes pageToken and maxResults', async () => {
      mock.onGet(`${ BASE }/queries/job_1`).reply({
        jobComplete: true,
        jobReference: { jobId: 'job_1' },
        schema: { fields: [] },
        rows: [],
        totalRows: '0',
      })

      await service.getQueryResults('job_1', 'page-2', 50)

      expect(mock.history[0].query).toEqual({
        pageToken: 'page-2',
        maxResults: 50,
        location: 'US',
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/queries/job_1`).replyWithError({
        message: 'Not Found',
        body: { error: { message: 'Job not found' } },
      })

      await expect(service.getQueryResults('job_1')).rejects.toThrow(
        'BigQuery API error: Job not found'
      )
    })
  })

  // ── Table Data ──

  describe('insertRows', () => {
    it('wraps rows in json envelopes and reports success', async () => {
      mock
        .onPost(`${ BASE }/datasets/analytics/tables/events/insertAll`)
        .reply({ kind: 'bigquery#tableDataInsertAllResponse' })

      const result = await service.insertRows('analytics', 'events', [
        { name: 'Alice', age: 30 },
        { name: 'Bob', age: 25 },
      ])

      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/datasets/analytics/tables/events/insertAll`)
      expect(mock.history[0].body).toEqual({
        rows: [
          { json: { name: 'Alice', age: 30 } },
          { json: { name: 'Bob', age: 25 } },
        ],
      })
      expect(result).toEqual({
        success: true,
        insertedRowCount: 2,
        failedRowCount: 0,
        insertErrors: [],
      })
    })

    it('includes skipInvalidRows and ignoreUnknownValues when provided', async () => {
      mock.onPost(`${ BASE }/datasets/ds/tables/t/insertAll`).reply({})

      await service.insertRows('ds', 't', [{ a: 1 }], true, true)

      expect(mock.history[0].body).toEqual({
        rows: [{ json: { a: 1 } }],
        skipInvalidRows: true,
        ignoreUnknownValues: true,
      })
    })

    it('reports partial failures from insertErrors', async () => {
      mock.onPost(`${ BASE }/datasets/ds/tables/t/insertAll`).reply({
        insertErrors: [
          { index: 1, errors: [{ reason: 'invalid', message: 'bad row' }] },
        ],
      })

      const result = await service.insertRows('ds', 't', [{ a: 1 }, { a: 2 }])

      expect(result).toEqual({
        success: false,
        insertedRowCount: 1,
        failedRowCount: 1,
        insertErrors: [{ index: 1, errors: [{ reason: 'invalid', message: 'bad row' }] }],
      })
    })

    it('throws when no rows are provided', async () => {
      await expect(service.insertRows('ds', 't', [])).rejects.toThrow('At least one row is required')
      expect(mock.history).toHaveLength(0)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/datasets/ds/tables/t/insertAll`).replyWithError({
        message: 'Forbidden',
        body: { error: { message: 'Permission denied' } },
      })

      await expect(service.insertRows('ds', 't', [{ a: 1 }])).rejects.toThrow(
        'BigQuery API error: Permission denied'
      )
    })
  })

  describe('listRows', () => {
    it('fetches table schema then data and converts rows', async () => {
      const tableUrl = `${ BASE }/datasets/ds/tables/t`

      mock.onGet(tableUrl).reply({
        schema: {
          fields: [
            { name: 'name', type: 'STRING' },
            { name: 'age', type: 'INTEGER' },
          ],
        },
      })
      mock.onGet(`${ tableUrl }/data`).reply({
        rows: [{ f: [{ v: 'Alice' }, { v: '30' }] }],
        totalRows: '1250',
        pageToken: 'next',
      })

      const result = await service.listRows('ds', 't', 10, 0)

      expect(mock.history).toHaveLength(2)
      expect(mock.history[0].url).toBe(tableUrl)
      expect(mock.history[1].url).toBe(`${ tableUrl }/data`)
      expect(mock.history[1].query).toMatchObject({ maxResults: 10, startIndex: 0 })
      expect(result).toEqual({
        rows: [{ name: 'Alice', age: 30 }],
        totalRows: 1250,
        pageToken: 'next',
      })
    })

    it('passes pageToken when provided', async () => {
      const tableUrl = `${ BASE }/datasets/ds/tables/t`

      mock.onGet(tableUrl).reply({ schema: { fields: [] } })
      mock.onGet(`${ tableUrl }/data`).reply({ rows: [], totalRows: '0' })

      await service.listRows('ds', 't', undefined, undefined, 'page-token')

      expect(mock.history[1].query).toEqual({ pageToken: 'page-token' })
    })

    it('throws a wrapped error when the table lookup fails', async () => {
      mock.onGet(`${ BASE }/datasets/ds/tables/missing`).replyWithError({
        message: 'Not Found',
        body: { error: { message: 'Table not found' } },
      })

      await expect(service.listRows('ds', 'missing')).rejects.toThrow(
        'BigQuery API error: Table not found'
      )
    })
  })

  // ── Datasets ──

  describe('listDatasets', () => {
    it('lists datasets and maps them with defaults', async () => {
      mock.onGet(`${ BASE }/datasets`).reply({
        datasets: [
          {
            datasetReference: { datasetId: 'analytics', projectId: PROJECT_ID },
            location: 'US',
            id: `${ PROJECT_ID }:analytics`,
            labels: { env: 'prod' },
          },
          {
            datasetReference: { datasetId: 'raw', projectId: PROJECT_ID },
          },
        ],
        nextPageToken: 'page-2',
      })

      const result = await service.listDatasets()

      expect(mock.history[0].query).toEqual({})
      expect(result).toEqual({
        datasets: [
          {
            datasetId: 'analytics',
            projectId: PROJECT_ID,
            location: 'US',
            fullId: `${ PROJECT_ID }:analytics`,
            labels: { env: 'prod' },
          },
          {
            datasetId: 'raw',
            projectId: PROJECT_ID,
            location: null,
            fullId: null,
            labels: {},
          },
        ],
        pageToken: 'page-2',
      })
    })

    it('passes pagination and the all flag', async () => {
      mock.onGet(`${ BASE }/datasets`).reply({ datasets: [] })

      await service.listDatasets(25, 'cursor', true)

      expect(mock.history[0].query).toEqual({ maxResults: 25, pageToken: 'cursor', all: 'true' })
    })

    it('omits the all flag when false', async () => {
      mock.onGet(`${ BASE }/datasets`).reply({ datasets: [] })

      await service.listDatasets(10, undefined, false)

      expect(mock.history[0].query).toEqual({ maxResults: 10 })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/datasets`).replyWithError({
        message: 'Forbidden',
        body: { error: { message: 'Access Denied', errors: [{ reason: 'accessDenied' }] } },
      })

      await expect(service.listDatasets()).rejects.toThrow(
        'BigQuery API error: Access Denied (reason: accessDenied)'
      )
    })
  })

  describe('createDataset', () => {
    it('creates a dataset with the configured location by default', async () => {
      mock.onPost(`${ BASE }/datasets`).reply({
        datasetReference: { datasetId: 'analytics', projectId: PROJECT_ID },
        location: 'US',
        id: `${ PROJECT_ID }:analytics`,
        selfLink: 'https://self-link',
      })

      const result = await service.createDataset('analytics')

      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({
        datasetReference: { projectId: PROJECT_ID, datasetId: 'analytics' },
        location: 'US',
      })
      expect(result).toEqual({
        datasetId: 'analytics',
        projectId: PROJECT_ID,
        location: 'US',
        fullId: `${ PROJECT_ID }:analytics`,
        selfLink: 'https://self-link',
      })
    })

    it('includes an explicit location and description', async () => {
      mock.onPost(`${ BASE }/datasets`).reply({
        datasetReference: { datasetId: 'eu_data', projectId: PROJECT_ID },
        location: 'EU',
      })

      await service.createDataset('eu_data', 'EU', 'European data')

      expect(mock.history[0].body).toEqual({
        datasetReference: { projectId: PROJECT_ID, datasetId: 'eu_data' },
        location: 'EU',
        description: 'European data',
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/datasets`).replyWithError({
        message: 'Conflict',
        body: { error: { message: 'Already Exists' } },
      })

      await expect(service.createDataset('analytics')).rejects.toThrow(
        'BigQuery API error: Already Exists'
      )
    })
  })

  describe('deleteDataset', () => {
    it('deletes a dataset without deleteContents by default', async () => {
      mock.onDelete(`${ BASE }/datasets/analytics`).reply(undefined)

      const result = await service.deleteDataset('analytics')

      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${ BASE }/datasets/analytics`)
      expect(mock.history[0].query).toEqual({})
      expect(result).toEqual({ success: true, datasetId: 'analytics' })
    })

    it('passes deleteContents when enabled', async () => {
      mock.onDelete(`${ BASE }/datasets/analytics`).reply(undefined)

      await service.deleteDataset('analytics', true)

      expect(mock.history[0].query).toEqual({ deleteContents: 'true' })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onDelete(`${ BASE }/datasets/analytics`).replyWithError({
        message: 'Bad Request',
        body: { error: { message: 'Dataset is not empty', errors: [{ reason: 'resourceInUse' }] } },
      })

      await expect(service.deleteDataset('analytics')).rejects.toThrow(
        'BigQuery API error: Dataset is not empty (reason: resourceInUse)'
      )
    })
  })

  // ── Tables ──

  describe('listTables', () => {
    it('lists tables and maps them', async () => {
      mock.onGet(`${ BASE }/datasets/analytics/tables`).reply({
        tables: [
          {
            tableReference: { tableId: 'events', datasetId: 'analytics', projectId: PROJECT_ID },
            type: 'TABLE',
            creationTime: '1736947200000',
          },
        ],
        totalItems: 1,
        nextPageToken: 'next',
      })

      const result = await service.listTables('analytics')

      expect(mock.history[0].url).toBe(`${ BASE }/datasets/analytics/tables`)
      expect(mock.history[0].query).toEqual({})
      expect(result).toEqual({
        tables: [
          {
            tableId: 'events',
            datasetId: 'analytics',
            projectId: PROJECT_ID,
            type: 'TABLE',
            creationTime: '1736947200000',
          },
        ],
        totalItems: 1,
        pageToken: 'next',
      })
    })

    it('passes pagination', async () => {
      mock.onGet(`${ BASE }/datasets/analytics/tables`).reply({ tables: [] })

      await service.listTables('analytics', 10, 'cursor')

      expect(mock.history[0].query).toEqual({ maxResults: 10, pageToken: 'cursor' })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/datasets/analytics/tables`).replyWithError({
        message: 'Not Found',
        body: { error: { message: 'Dataset not found' } },
      })

      await expect(service.listTables('analytics')).rejects.toThrow(
        'BigQuery API error: Dataset not found'
      )
    })
  })

  describe('getTable', () => {
    it('returns table metadata', async () => {
      mock.onGet(`${ BASE }/datasets/analytics/tables/events`).reply({
        tableReference: { tableId: 'events', datasetId: 'analytics', projectId: PROJECT_ID },
        type: 'TABLE',
        schema: { fields: [{ name: 'name', type: 'STRING', mode: 'NULLABLE' }] },
        numRows: '1250',
        numBytes: '204800',
        description: 'User events',
        creationTime: '1736947200000',
        lastModifiedTime: '1736990400000',
        location: 'US',
      })

      const result = await service.getTable('analytics', 'events')

      expect(result).toEqual({
        tableId: 'events',
        datasetId: 'analytics',
        projectId: PROJECT_ID,
        type: 'TABLE',
        schema: { fields: [{ name: 'name', type: 'STRING', mode: 'NULLABLE' }] },
        numRows: 1250,
        numBytes: 204800,
        description: 'User events',
        creationTime: '1736947200000',
        lastModifiedTime: '1736990400000',
        location: 'US',
      })
    })

    it('defaults missing fields', async () => {
      mock.onGet(`${ BASE }/datasets/analytics/tables/events`).reply({
        tableReference: { tableId: 'events', datasetId: 'analytics', projectId: PROJECT_ID },
      })

      const result = await service.getTable('analytics', 'events')

      expect(result).toMatchObject({
        type: null,
        schema: { fields: [] },
        numRows: null,
        numBytes: null,
        description: null,
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/datasets/analytics/tables/events`).replyWithError({
        message: 'Not Found',
        body: { error: { message: 'Table not found' } },
      })

      await expect(service.getTable('analytics', 'events')).rejects.toThrow(
        'BigQuery API error: Table not found'
      )
    })
  })

  describe('createTable', () => {
    it('maps friendly schema field types/modes and posts them', async () => {
      mock.onPost(`${ BASE }/datasets/analytics/tables`).reply({
        tableReference: { tableId: 'events', datasetId: 'analytics', projectId: PROJECT_ID },
        type: 'TABLE',
        schema: { fields: [] },
        selfLink: 'https://self-link',
      })

      const result = await service.createTable('analytics', 'events', [
        { name: 'name', type: 'String', mode: 'Required' },
        { name: 'age', type: 'Integer' },
        {
          name: 'address',
          type: 'Record (Struct)',
          mode: 'Nullable',
          fields: [
            { name: 'city', type: 'String' },
            { name: 'zip', type: 'Integer', description: 'ZIP code' },
          ],
        },
      ])

      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({
        tableReference: { projectId: PROJECT_ID, datasetId: 'analytics', tableId: 'events' },
        schema: {
          fields: [
            { name: 'name', type: 'STRING', mode: 'REQUIRED' },
            { name: 'age', type: 'INT64' },
            {
              name: 'address',
              type: 'RECORD',
              mode: 'NULLABLE',
              fields: [
                { name: 'city', type: 'STRING' },
                { name: 'zip', type: 'INT64', description: 'ZIP code' },
              ],
            },
          ],
        },
      })
      expect(result).toEqual({
        tableId: 'events',
        datasetId: 'analytics',
        projectId: PROJECT_ID,
        type: 'TABLE',
        schema: { fields: [] },
        selfLink: 'https://self-link',
      })
    })

    it('includes a description when provided', async () => {
      mock.onPost(`${ BASE }/datasets/analytics/tables`).reply({
        tableReference: { tableId: 'events', datasetId: 'analytics', projectId: PROJECT_ID },
      })

      await service.createTable('analytics', 'events', [{ name: 'id', type: 'Integer' }], 'A table')

      expect(mock.history[0].body).toMatchObject({ description: 'A table' })
    })

    it('throws when no schema fields are provided', async () => {
      await expect(service.createTable('analytics', 'events', [])).rejects.toThrow(
        'At least one schema field is required'
      )
      expect(mock.history).toHaveLength(0)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/datasets/analytics/tables`).replyWithError({
        message: 'Conflict',
        body: { error: { message: 'Already Exists' } },
      })

      await expect(
        service.createTable('analytics', 'events', [{ name: 'id', type: 'Integer' }])
      ).rejects.toThrow('BigQuery API error: Already Exists')
    })
  })

  describe('deleteTable', () => {
    it('deletes a table and returns success', async () => {
      mock.onDelete(`${ BASE }/datasets/analytics/tables/events`).reply(undefined)

      const result = await service.deleteTable('analytics', 'events')

      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${ BASE }/datasets/analytics/tables/events`)
      expect(result).toEqual({ success: true, datasetId: 'analytics', tableId: 'events' })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onDelete(`${ BASE }/datasets/analytics/tables/events`).replyWithError({
        message: 'Not Found',
        body: { error: { message: 'Table not found' } },
      })

      await expect(service.deleteTable('analytics', 'events')).rejects.toThrow(
        'BigQuery API error: Table not found'
      )
    })
  })

  // ── Dictionaries ──

  describe('getDatasetsDictionary', () => {
    const datasetsResponse = {
      datasets: [
        { datasetReference: { datasetId: 'analytics' }, location: 'US' },
        { datasetReference: { datasetId: 'raw_events' }, location: 'EU' },
      ],
      nextPageToken: 'next-cursor',
    }

    it('maps datasets to items and returns the cursor', async () => {
      mock.onGet(`${ BASE }/datasets`).reply(datasetsResponse)

      const result = await service.getDatasetsDictionary({})

      expect(mock.history[0].query).toMatchObject({ maxResults: 1000 })
      expect(result).toEqual({
        items: [
          { label: 'analytics', value: 'analytics', note: 'US' },
          { label: 'raw_events', value: 'raw_events', note: 'EU' },
        ],
        cursor: 'next-cursor',
      })
    })

    it('filters by search term', async () => {
      mock.onGet(`${ BASE }/datasets`).reply(datasetsResponse)

      const result = await service.getDatasetsDictionary({ search: 'raw' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('raw_events')
    })

    it('passes the cursor as pageToken', async () => {
      mock.onGet(`${ BASE }/datasets`).reply({ datasets: [] })

      await service.getDatasetsDictionary({ cursor: 'page-3' })

      expect(mock.history[0].query).toMatchObject({ pageToken: 'page-3' })
    })

    it('handles a null payload', async () => {
      mock.onGet(`${ BASE }/datasets`).reply({ datasets: [] })

      const result = await service.getDatasetsDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getTablesDictionary', () => {
    const tablesResponse = {
      tables: [
        { tableReference: { tableId: 'events' }, type: 'TABLE' },
        { tableReference: { tableId: 'events_view' }, type: 'VIEW' },
      ],
      nextPageToken: null,
    }

    it('returns empty items without a dataset criterion', async () => {
      const result = await service.getTablesDictionary({})

      expect(result).toEqual({ items: [] })
      expect(mock.history).toHaveLength(0)
    })

    it('lists tables for the chosen dataset', async () => {
      mock.onGet(`${ BASE }/datasets/analytics/tables`).reply(tablesResponse)

      const result = await service.getTablesDictionary({ criteria: { datasetId: 'analytics' } })

      expect(mock.history[0].url).toBe(`${ BASE }/datasets/analytics/tables`)
      expect(mock.history[0].query).toMatchObject({ maxResults: 1000 })
      expect(result).toEqual({
        items: [
          { label: 'events', value: 'events', note: 'TABLE' },
          { label: 'events_view', value: 'events_view', note: 'VIEW' },
        ],
        cursor: null,
      })
    })

    it('filters tables by search term', async () => {
      mock.onGet(`${ BASE }/datasets/analytics/tables`).reply(tablesResponse)

      const result = await service.getTablesDictionary({
        search: 'view',
        criteria: { datasetId: 'analytics' },
      })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('events_view')
    })

    it('passes the cursor as pageToken', async () => {
      mock.onGet(`${ BASE }/datasets/analytics/tables`).reply({ tables: [] })

      await service.getTablesDictionary({ cursor: 'page-2', criteria: { datasetId: 'analytics' } })

      expect(mock.history[0].query).toMatchObject({ pageToken: 'page-2' })
    })
  })
})
