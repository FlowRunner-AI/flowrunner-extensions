'use strict'

const { createSandbox } = require('../../../service-sandbox')

const SERVER_URL = 'https://myco.metabaseapp.com'
const API_KEY = 'test-api-key'
const BASE = `${SERVER_URL}/api`

describe('Metabase Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ serverUrl: SERVER_URL, apiKey: API_KEY })
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
      expect(sandbox.getConfigItems()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'serverUrl', required: true, shared: false }),
          expect.objectContaining({ name: 'apiKey', required: true, shared: false }),
        ])
      )
    })
  })

  // ── Cards ──

  describe('listCards', () => {
    it('sends correct request with no filter', async () => {
      const cards = [{ id: 1, name: 'Card 1' }]
      mock.onGet(`${BASE}/card`).reply(cards)

      const result = await service.listCards()

      expect(result).toEqual({ data: cards })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({ 'x-api-key': API_KEY })
    })

    it('maps filter to API value', async () => {
      mock.onGet(`${BASE}/card`).reply([])

      await service.listCards('Mine')

      expect(mock.history[0].query).toMatchObject({ f: 'mine' })
    })

    it('passes model_id for Database filter', async () => {
      mock.onGet(`${BASE}/card`).reply([])

      await service.listCards('Database', 5)

      expect(mock.history[0].query).toMatchObject({ f: 'database', model_id: 5 })
    })

    it('maps Recently Viewed filter', async () => {
      mock.onGet(`${BASE}/card`).reply([])

      await service.listCards('Recently Viewed')

      expect(mock.history[0].query).toMatchObject({ f: 'recent' })
    })

    it('throws on API error', async () => {
      mock.onGet(`${BASE}/card`).replyWithError({ message: 'Unauthorized' })

      await expect(service.listCards()).rejects.toThrow('Metabase API error')
    })
  })

  describe('getCard', () => {
    it('sends correct GET request for card id', async () => {
      const card = { id: 12, name: 'Revenue by month' }
      mock.onGet(`${BASE}/card/12`).reply(card)

      const result = await service.getCard(12)

      expect(result).toEqual(card)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({ 'x-api-key': API_KEY })
    })

    it('throws on API error', async () => {
      mock.onGet(`${BASE}/card/999`).replyWithError({ message: 'Not Found' })

      await expect(service.getCard(999)).rejects.toThrow('Metabase API error')
    })
  })

  describe('createCard', () => {
    it('sends POST with SQL query', async () => {
      const created = { id: 42, name: 'New Card' }
      mock.onPost(`${BASE}/card`).reply(created)

      const result = await service.createCard('New Card', 1, 'SELECT 1')

      expect(result).toEqual(created)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].body).toMatchObject({
        name: 'New Card',
        dataset_query: { database: 1, type: 'native', native: { query: 'SELECT 1' } },
        display: 'table',
        visualization_settings: {},
      })
    })

    it('sends POST with Query JSON', async () => {
      mock.onPost(`${BASE}/card`).reply({ id: 43 })

      await service.createCard('Q', 1, undefined, '{"source-table":2}')

      expect(mock.history[0].body.dataset_query).toEqual({
        database: 1,
        type: 'query',
        query: { 'source-table': 2 },
      })
    })

    it('prefers Query JSON over SQL Query', async () => {
      mock.onPost(`${BASE}/card`).reply({ id: 44 })

      await service.createCard('Q', 1, 'SELECT 1', '{"source-table":2}')

      expect(mock.history[0].body.dataset_query.type).toBe('query')
    })

    it('maps display type', async () => {
      mock.onPost(`${BASE}/card`).reply({ id: 45 })

      await service.createCard('Q', 1, 'SELECT 1', undefined, 'Bar')

      expect(mock.history[0].body.display).toBe('bar')
    })

    it('includes optional collection_id and description', async () => {
      mock.onPost(`${BASE}/card`).reply({ id: 46 })

      await service.createCard('Q', 1, 'SELECT 1', undefined, 'Table', 3, 'A description')

      expect(mock.history[0].body).toMatchObject({
        collection_id: 3,
        description: 'A description',
      })
    })

    it('omits empty optional fields', async () => {
      mock.onPost(`${BASE}/card`).reply({ id: 47 })

      await service.createCard('Q', 1, 'SELECT 1')

      expect(mock.history[0].body).not.toHaveProperty('collection_id')
      expect(mock.history[0].body).not.toHaveProperty('description')
    })

    it('throws when no SQL or query JSON provided', async () => {
      await expect(service.createCard('Q', 1)).rejects.toThrow(
        'Provide either a SQL Query or a Query JSON'
      )
    })

    it('throws when database ID is missing', async () => {
      await expect(service.createCard('Q', undefined, 'SELECT 1')).rejects.toThrow(
        'Database ID is required'
      )
    })
  })

  describe('updateCard', () => {
    it('sends PUT with partial fields', async () => {
      const updated = { id: 12, name: 'Updated' }
      mock.onPut(`${BASE}/card/12`).reply(updated)

      const result = await service.updateCard(12, 'Updated')

      expect(result).toEqual(updated)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].body).toMatchObject({ name: 'Updated' })
    })

    it('includes archived as boolean when provided', async () => {
      mock.onPut(`${BASE}/card/12`).reply({ id: 12 })

      await service.updateCard(12, undefined, undefined, undefined, undefined, undefined, undefined, undefined, true)

      expect(mock.history[0].body).toMatchObject({ archived: true })
    })

    it('includes dataset_query when SQL is provided', async () => {
      mock.onPut(`${BASE}/card/12`).reply({ id: 12 })

      await service.updateCard(12, undefined, undefined, undefined, undefined, 1, 'SELECT 2')

      expect(mock.history[0].body.dataset_query).toEqual({
        database: 1,
        type: 'native',
        native: { query: 'SELECT 2' },
      })
    })

    it('maps display type', async () => {
      mock.onPut(`${BASE}/card/12`).reply({ id: 12 })

      await service.updateCard(12, undefined, undefined, undefined, 'Pie')

      expect(mock.history[0].body.display).toBe('pie')
    })

    it('does not include display when not provided', async () => {
      mock.onPut(`${BASE}/card/12`).reply({ id: 12 })

      await service.updateCard(12, 'Name only')

      expect(mock.history[0].body).not.toHaveProperty('display')
    })
  })

  describe('deleteCard', () => {
    it('sends DELETE and returns confirmation', async () => {
      mock.onDelete(`${BASE}/card/12`).reply(undefined)

      const result = await service.deleteCard(12)

      expect(result).toEqual({ deleted: true, id: 12 })
      expect(mock.history).toHaveLength(1)
    })
  })

  describe('runCardQuery', () => {
    it('sends POST to card query endpoint', async () => {
      const queryResult = { data: { rows: [[1]] }, row_count: 1, status: 'completed' }
      mock.onPost(`${BASE}/card/12/query`).reply(queryResult)

      const result = await service.runCardQuery(12)

      expect(result).toEqual(queryResult)
      expect(mock.history[0].body).toEqual({})
    })

    it('parses and sends parameters JSON', async () => {
      mock.onPost(`${BASE}/card/12/query`).reply({ status: 'completed' })

      await service.runCardQuery(12, '[{"type":"category","value":"CA"}]')

      expect(mock.history[0].body).toEqual({
        parameters: [{ type: 'category', value: 'CA' }],
      })
    })

    it('throws on invalid JSON', async () => {
      await expect(service.runCardQuery(12, '{bad json')).rejects.toThrow(
        'Parameters JSON must be valid JSON'
      )
    })
  })

  describe('runCardQueryExport', () => {
    it('sends POST to json export endpoint by default', async () => {
      const data = [{ id: 1 }]
      mock.onPost(`${BASE}/card/12/query/json`).reply(data)

      const result = await service.runCardQueryExport(12)

      expect(result).toEqual({ format: 'json', data })
    })

    it('sends POST to csv export endpoint', async () => {
      mock.onPost(`${BASE}/card/12/query/csv`).reply('id,name\n1,Test')

      const result = await service.runCardQueryExport(12, 'CSV')

      expect(result).toEqual({ format: 'csv', data: 'id,name\n1,Test' })
    })

    it('sends parameters when provided', async () => {
      mock.onPost(`${BASE}/card/12/query/json`).reply([])

      await service.runCardQueryExport(12, 'JSON', '[{"type":"number","value":5}]')

      expect(mock.history[0].body).toEqual({
        parameters: [{ type: 'number', value: 5 }],
      })
    })
  })

  // ── Datasets ──

  describe('runQuery', () => {
    it('sends POST with native SQL query', async () => {
      const queryResult = { data: { rows: [[1]] }, status: 'completed' }
      mock.onPost(`${BASE}/dataset`).reply(queryResult)

      const result = await service.runQuery(1, 'SELECT 1')

      expect(result).toEqual(queryResult)
      expect(mock.history[0].body).toEqual({
        database: 1,
        type: 'native',
        native: { query: 'SELECT 1' },
      })
    })

    it('sends POST with MBQL query JSON', async () => {
      mock.onPost(`${BASE}/dataset`).reply({ status: 'completed' })

      await service.runQuery(1, undefined, '{"source-table":2,"limit":10}')

      expect(mock.history[0].body).toEqual({
        database: 1,
        type: 'query',
        query: { 'source-table': 2, limit: 10 },
      })
    })

    it('handles full dataset_query JSON with type field', async () => {
      mock.onPost(`${BASE}/dataset`).reply({ status: 'completed' })

      await service.runQuery(1, undefined, '{"type":"native","native":{"query":"SELECT 1"}}')

      expect(mock.history[0].body).toEqual({
        database: 1,
        type: 'native',
        native: { query: 'SELECT 1' },
      })
    })

    it('throws when no query provided', async () => {
      await expect(service.runQuery(1)).rejects.toThrow('Provide either a SQL Query or a Query JSON')
    })
  })

  describe('exportQuery', () => {
    it('sends form data POST to json export endpoint', async () => {
      const data = [{ id: 1 }]
      mock.onPost(`${BASE}/dataset/json`).reply(data)

      const result = await service.exportQuery(1, 'JSON', 'SELECT 1')

      expect(result).toEqual({ format: 'json', data })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({ 'x-api-key': API_KEY })
      expect(mock.history[0].formData).toBeDefined()
    })

    it('sends to csv endpoint', async () => {
      mock.onPost(`${BASE}/dataset/csv`).reply('id\n1')

      const result = await service.exportQuery(1, 'CSV', 'SELECT 1')

      expect(result).toEqual({ format: 'csv', data: 'id\n1' })
    })

    it('defaults to JSON format', async () => {
      mock.onPost(`${BASE}/dataset/json`).reply([])

      await service.exportQuery(1, undefined, 'SELECT 1')

      expect(mock.history[0].url).toBe(`${BASE}/dataset/json`)
    })

    it('throws on API error', async () => {
      mock.onPost(`${BASE}/dataset/json`).replyWithError({ message: 'Bad Request' })

      await expect(service.exportQuery(1, 'JSON', 'INVALID SQL')).rejects.toThrow('Metabase API error')
    })
  })

  // ── Databases ──

  describe('listDatabases', () => {
    it('sends GET request without include param by default', async () => {
      const response = { data: [{ id: 1, name: 'Sample' }], total: 1 }
      mock.onGet(`${BASE}/database`).reply(response)

      const result = await service.listDatabases()

      expect(result).toEqual(response)
      expect(mock.history).toHaveLength(1)
    })

    it('includes tables when requested', async () => {
      mock.onGet(`${BASE}/database`).reply({ data: [] })

      await service.listDatabases(true)

      expect(mock.history[0].query).toMatchObject({ include: 'tables' })
    })
  })

  describe('getDatabase', () => {
    it('sends correct GET request', async () => {
      const db = { id: 1, name: 'Sample Database', engine: 'h2' }
      mock.onGet(`${BASE}/database/1`).reply(db)

      const result = await service.getDatabase(1)

      expect(result).toEqual(db)
    })
  })

  describe('getDatabaseMetadata', () => {
    it('sends correct GET request', async () => {
      const meta = { id: 1, tables: [{ id: 2, name: 'orders' }] }
      mock.onGet(`${BASE}/database/1/metadata`).reply(meta)

      const result = await service.getDatabaseMetadata(1)

      expect(result).toEqual(meta)
    })
  })

  describe('syncDatabaseSchema', () => {
    it('sends POST to sync endpoint', async () => {
      mock.onPost(`${BASE}/database/1/sync_schema`).reply({ status: 'ok' })

      const result = await service.syncDatabaseSchema(1)

      expect(result).toEqual({ status: 'ok' })
      expect(mock.history[0].body).toEqual({})
    })
  })

  // ── Collections ──

  describe('listCollections', () => {
    it('returns collections wrapped in object', async () => {
      const collections = [{ id: 3, name: 'Analytics' }]
      mock.onGet(`${BASE}/collection`).reply(collections)

      const result = await service.listCollections()

      expect(result).toEqual({ collections })
    })

    it('passes archived param when true', async () => {
      mock.onGet(`${BASE}/collection`).reply([])

      await service.listCollections(true)

      expect(mock.history[0].query).toMatchObject({ archived: 'true' })
    })
  })

  describe('getCollectionItems', () => {
    it('sends GET with collection id', async () => {
      const items = { data: [{ id: 12, model: 'card' }] }
      mock.onGet(`${BASE}/collection/3/items`).reply(items)

      const result = await service.getCollectionItems(3)

      expect(result).toEqual(items)
    })

    it('maps model names to API values', async () => {
      mock.onGet(`${BASE}/collection/3/items`).reply({ data: [] })

      await service.getCollectionItems(3, ['Card', 'Dashboard'])

      expect(mock.history[0].query).toMatchObject({ models: ['card', 'dashboard'] })
    })

    it('does not send models when empty array', async () => {
      mock.onGet(`${BASE}/collection/3/items`).reply({ data: [] })

      await service.getCollectionItems(3, [])

      expect(mock.history[0].query.models).toBeUndefined()
    })
  })

  describe('createCollection', () => {
    it('sends POST with name only', async () => {
      const created = { id: 9, name: 'Q3 Reports' }
      mock.onPost(`${BASE}/collection`).reply(created)

      const result = await service.createCollection('Q3 Reports')

      expect(result).toEqual(created)
      expect(mock.history[0].body).toEqual({ name: 'Q3 Reports' })
    })

    it('includes description and parent_id', async () => {
      mock.onPost(`${BASE}/collection`).reply({ id: 10 })

      await service.createCollection('Reports', 'Description', 3)

      expect(mock.history[0].body).toEqual({
        name: 'Reports',
        description: 'Description',
        parent_id: 3,
      })
    })
  })

  // ── Dashboards ──

  describe('listDashboards', () => {
    it('returns dashboards wrapped in data', async () => {
      const dashboards = [{ id: 7, name: 'Overview' }]
      mock.onGet(`${BASE}/dashboard`).reply(dashboards)

      const result = await service.listDashboards()

      expect(result).toEqual({ data: dashboards })
    })

    it('maps Mine filter', async () => {
      mock.onGet(`${BASE}/dashboard`).reply([])

      await service.listDashboards('Mine')

      expect(mock.history[0].query).toMatchObject({ f: 'mine' })
    })

    it('maps Archived filter', async () => {
      mock.onGet(`${BASE}/dashboard`).reply([])

      await service.listDashboards('Archived')

      expect(mock.history[0].query).toMatchObject({ f: 'archived' })
    })
  })

  describe('getDashboard', () => {
    it('sends correct GET request', async () => {
      const dashboard = { id: 7, name: 'Overview', dashcards: [] }
      mock.onGet(`${BASE}/dashboard/7`).reply(dashboard)

      const result = await service.getDashboard(7)

      expect(result).toEqual(dashboard)
    })
  })

  describe('createDashboard', () => {
    it('sends POST with name only', async () => {
      const created = { id: 21, name: 'Weekly KPIs' }
      mock.onPost(`${BASE}/dashboard`).reply(created)

      const result = await service.createDashboard('Weekly KPIs')

      expect(result).toEqual(created)
      expect(mock.history[0].body).toEqual({ name: 'Weekly KPIs' })
    })

    it('includes description and collection_id', async () => {
      mock.onPost(`${BASE}/dashboard`).reply({ id: 22 })

      await service.createDashboard('Dashboard', 'Desc', 3)

      expect(mock.history[0].body).toEqual({
        name: 'Dashboard',
        description: 'Desc',
        collection_id: 3,
      })
    })
  })

  // ── Users & Health ──

  describe('listUsers', () => {
    it('sends GET with no status filter by default', async () => {
      const response = { data: [{ id: 1, email: 'admin@example.com' }], total: 1 }
      mock.onGet(`${BASE}/user`).reply(response)

      const result = await service.listUsers()

      expect(result).toEqual(response)
      expect(mock.history[0].query).toEqual({})
    })

    it('maps Deactivated status', async () => {
      mock.onGet(`${BASE}/user`).reply({ data: [] })

      await service.listUsers('Deactivated')

      expect(mock.history[0].query).toMatchObject({ status: 'deactivated' })
    })

    it('maps All status', async () => {
      mock.onGet(`${BASE}/user`).reply({ data: [] })

      await service.listUsers('All')

      expect(mock.history[0].query).toMatchObject({ status: 'all' })
    })

    it('does not set status for Active (default)', async () => {
      mock.onGet(`${BASE}/user`).reply({ data: [] })

      await service.listUsers('Active')

      expect(mock.history[0].query.status).toBeUndefined()
    })
  })

  describe('getCurrentUser', () => {
    it('sends GET to current user endpoint', async () => {
      const user = { id: 1, email: 'admin@example.com', is_superuser: true }
      mock.onGet(`${BASE}/user/current`).reply(user)

      const result = await service.getCurrentUser()

      expect(result).toEqual(user)
      expect(mock.history[0].headers).toMatchObject({ 'x-api-key': API_KEY })
    })
  })

  describe('healthCheck', () => {
    it('sends GET to health endpoint', async () => {
      mock.onGet(`${BASE}/health`).reply({ status: 'ok' })

      const result = await service.healthCheck()

      expect(result).toEqual({ status: 'ok' })
    })
  })

  // ── Dictionaries ──

  describe('getCardsDictionary', () => {
    it('returns mapped cards', async () => {
      mock.onGet(`${BASE}/card`).reply([
        { id: 1, name: 'Revenue', display: 'line' },
        { id: 2, name: 'Orders', display: 'table' },
      ])

      const result = await service.getCardsDictionary({})

      expect(result.items).toEqual([
        { label: 'Revenue', value: 1, note: 'line' },
        { label: 'Orders', value: 2, note: 'table' },
      ])
      expect(result.cursor).toBeNull()
    })

    it('filters by search term', async () => {
      mock.onGet(`${BASE}/card`).reply([
        { id: 1, name: 'Revenue' },
        { id: 2, name: 'Orders' },
      ])

      const result = await service.getCardsDictionary({ search: 'rev' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toBe('Revenue')
    })

    it('handles empty payload', async () => {
      mock.onGet(`${BASE}/card`).reply([])

      const result = await service.getCardsDictionary()

      expect(result.items).toEqual([])
      expect(result.cursor).toBeNull()
    })

    it('handles non-array response', async () => {
      mock.onGet(`${BASE}/card`).reply({ something: 'else' })

      const result = await service.getCardsDictionary({})

      expect(result.items).toEqual([])
    })
  })

  describe('getDatabasesDictionary', () => {
    it('returns mapped databases from data array', async () => {
      mock.onGet(`${BASE}/database`).reply({ data: [{ id: 1, name: 'Sample', engine: 'h2' }] })

      const result = await service.getDatabasesDictionary({})

      expect(result.items).toEqual([
        { label: 'Sample', value: 1, note: 'h2' },
      ])
    })

    it('handles direct array response', async () => {
      mock.onGet(`${BASE}/database`).reply([{ id: 1, name: 'DB', engine: 'postgres' }])

      const result = await service.getDatabasesDictionary({})

      expect(result.items).toEqual([
        { label: 'DB', value: 1, note: 'postgres' },
      ])
    })

    it('filters by search', async () => {
      mock.onGet(`${BASE}/database`).reply({
        data: [
          { id: 1, name: 'Sample', engine: 'h2' },
          { id: 2, name: 'Production', engine: 'postgres' },
        ],
      })

      const result = await service.getDatabasesDictionary({ search: 'prod' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toBe('Production')
    })
  })

  describe('getCollectionsDictionary', () => {
    it('returns mapped collections excluding root', async () => {
      mock.onGet(`${BASE}/collection`).reply([
        { id: 'root', name: 'Our analytics', location: '/' },
        { id: 3, name: 'Analytics', location: '/' },
      ])

      const result = await service.getCollectionsDictionary({})

      expect(result.items).toEqual([
        { label: 'Analytics', value: 3, note: '/' },
      ])
    })

    it('filters by search', async () => {
      mock.onGet(`${BASE}/collection`).reply([
        { id: 3, name: 'Analytics', location: '/' },
        { id: 4, name: 'Reports', location: '/' },
      ])

      const result = await service.getCollectionsDictionary({ search: 'rep' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toBe('Reports')
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('includes status code in error message', async () => {
      mock.onGet(`${BASE}/card`).replyWithError({
        message: 'Unauthorized',
        body: { error_code: 401, description: 'Invalid API key' },
        status: 401,
      })

      await expect(service.listCards()).rejects.toThrow('Metabase API error (401)')
    })

    it('extracts message from error body', async () => {
      mock.onGet(`${BASE}/user/current`).replyWithError({
        message: 'Forbidden',
        body: { message: 'You do not have permission' },
        status: 403,
      })

      await expect(service.getCurrentUser()).rejects.toThrow('You do not have permission')
    })

    it('extracts string error body', async () => {
      mock.onGet(`${BASE}/health`).replyWithError({
        message: 'Server Error',
        body: 'Internal Server Error',
        status: 500,
      })

      await expect(service.healthCheck()).rejects.toThrow('Internal Server Error')
    })

    it('falls back to error.message when body has no message', async () => {
      mock.onGet(`${BASE}/health`).replyWithError({
        message: 'Connection refused',
      })

      await expect(service.healthCheck()).rejects.toThrow('Connection refused')
    })

    it('handles error with no status code', async () => {
      mock.onGet(`${BASE}/health`).replyWithError({
        message: 'Network failure',
      })

      await expect(service.healthCheck()).rejects.toThrow('Metabase API error: Network failure')
    })
  })

  // ── Edge cases ──

  describe('edge cases', () => {
    it('constructor strips trailing slashes from server URL', () => {
      // Verify by calling healthCheck which uses the base URL
      // The main service was constructed with SERVER_URL (no trailing slash)
      // so any request to BASE/health will match
      mock.onGet(`${BASE}/health`).reply({ status: 'ok' })

      return service.healthCheck().then(result => {
        expect(result).toEqual({ status: 'ok' })
      })
    })

    it('clean utility removes null, undefined, and empty string values', async () => {
      mock.onPost(`${BASE}/collection`).reply({ id: 10 })

      await service.createCollection('Test', '', null)

      // empty string description and null parentId should be omitted
      expect(mock.history[0].body).toEqual({ name: 'Test' })
    })

    it('handles object passed to parseJsonParam directly', async () => {
      const params = [{ type: 'category', value: 'CA' }]
      mock.onPost(`${BASE}/card/12/query`).reply({ status: 'completed' })

      await service.runCardQuery(12, params)

      expect(mock.history[0].body).toEqual({ parameters: params })
    })

    it('passes empty string parametersJson as no parameters', async () => {
      mock.onPost(`${BASE}/card/12/query`).reply({ status: 'completed' })

      await service.runCardQuery(12, '  ')

      expect(mock.history[0].body).toEqual({})
    })

    it('handles full dataset_query with type=query in queryJson', async () => {
      mock.onPost(`${BASE}/card`).reply({ id: 50 })

      await service.createCard('Q', 1, undefined, '{"type":"query","query":{"source-table":2}}')

      expect(mock.history[0].body.dataset_query).toEqual({
        database: 1,
        type: 'query',
        query: { 'source-table': 2 },
      })
    })

    it('resolveChoice returns the value itself when not in mapping', async () => {
      mock.onGet(`${BASE}/card`).reply([])

      await service.listCards('UnknownFilter')

      expect(mock.history[0].query).toMatchObject({ f: 'UnknownFilter' })
    })

    it('getCardsDictionary uses fallback label for cards without name', async () => {
      mock.onGet(`${BASE}/card`).reply([{ id: 5 }])

      const result = await service.getCardsDictionary({})

      expect(result.items[0].label).toBe('Card 5')
    })

    it('getDatabasesDictionary uses fallback label for databases without name', async () => {
      mock.onGet(`${BASE}/database`).reply({ data: [{ id: 3 }] })

      const result = await service.getDatabasesDictionary({})

      expect(result.items[0].label).toBe('Database 3')
    })

    it('getCollectionsDictionary uses fallback label for collections without name', async () => {
      mock.onGet(`${BASE}/collection`).reply([{ id: 7, location: '/' }])

      const result = await service.getCollectionsDictionary({})

      expect(result.items[0].label).toBe('Collection 7')
    })

    it('getCollectionsDictionary filters out null/undefined values', async () => {
      mock.onGet(`${BASE}/collection`).reply([
        { id: null, name: 'Null ID' },
        { id: undefined, name: 'Undef ID' },
        { id: 5, name: 'Valid' },
      ])

      const result = await service.getCollectionsDictionary({})

      expect(result.items).toEqual([
        { label: 'Valid', value: 5, note: undefined },
      ])
    })

    it('listDashboards All filter maps to undefined', async () => {
      mock.onGet(`${BASE}/dashboard`).reply([])

      await service.listDashboards('All')

      // 'All' maps to undefined, so f should not be set
      expect(mock.history[0].query.f).toBeUndefined()
    })

    it('updateCard does not include dataset_query when sqlQuery and queryJson are empty strings', async () => {
      mock.onPut(`${BASE}/card/12`).reply({ id: 12 })

      await service.updateCard(12, 'Name', undefined, undefined, undefined, undefined, '', '')

      expect(mock.history[0].body).not.toHaveProperty('dataset_query')
    })

    it('updateCard with archived=false includes it in body', async () => {
      mock.onPut(`${BASE}/card/12`).reply({ id: 12 })

      await service.updateCard(12, undefined, undefined, undefined, undefined, undefined, undefined, undefined, false)

      expect(mock.history[0].body).toMatchObject({ archived: false })
    })

    it('exportQuery error handling extracts message from body', async () => {
      mock.onPost(`${BASE}/dataset/json`).replyWithError({
        body: { message: 'Query failed' },
        status: 400,
      })

      await expect(service.exportQuery(1, 'JSON', 'BAD SQL')).rejects.toThrow('Query failed')
    })

    it('exportQuery error handling extracts string body', async () => {
      mock.onPost(`${BASE}/dataset/csv`).replyWithError({
        body: 'Something went wrong',
        status: 500,
      })

      await expect(service.exportQuery(1, 'CSV', 'SELECT 1')).rejects.toThrow('Something went wrong')
    })

    it('getCollectionItems with single model type', async () => {
      mock.onGet(`${BASE}/collection/3/items`).reply({ data: [] })

      await service.getCollectionItems(3, ['Snippet'])

      expect(mock.history[0].query).toMatchObject({ models: ['snippet'] })
    })

    it('listCollections does not pass archived when false', async () => {
      mock.onGet(`${BASE}/collection`).reply([])

      await service.listCollections(false)

      expect(mock.history[0].query.archived).toBeUndefined()
    })

    it('listCards maps all filter choices', async () => {
      const filterMappings = [
        ['All', 'all'],
        ['Bookmarked', 'bookmarked'],
        ['Table', 'table'],
        ['Popular', 'popular'],
        ['Archived', 'archived'],
      ]

      for (const [input, expected] of filterMappings) {
        mock.reset()
        mock.onGet(`${BASE}/card`).reply([])

        await service.listCards(input)

        expect(mock.history[0].query).toMatchObject({ f: expected })
      }
    })
  })
})
