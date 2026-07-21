'use strict'

const { createSandbox } = require('../../../service-sandbox')

const HOST = 'fms.example.com'
const DATABASE = 'TestDB'
const USERNAME = 'testuser'
const PASSWORD = 'testpass'
const BASE = `https://${HOST}/fmi/data/vLatest/databases/${encodeURIComponent(DATABASE)}`
const BASIC_TOKEN = Buffer.from(`${USERNAME}:${PASSWORD}`).toString('base64')
const SESSION_TOKEN = 'mock-session-token-abc123'

const SESSION_RESPONSE = {
  response: { token: SESSION_TOKEN },
  messages: [{ code: '0', message: 'OK' }],
}

// Wraps a payload in the standard FileMaker envelope
function fmEnvelope(responsePayload) {
  return {
    response: responsePayload,
    messages: [{ code: '0', message: 'OK' }],
  }
}

// Helper to set up session mock on every test (since mock.reset clears handlers)
function setupSession(mock) {
  mock.onPost(`${BASE}/sessions`).reply(SESSION_RESPONSE)
}

describe('FileMaker Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({
      host: HOST,
      database: DATABASE,
      username: USERNAME,
      password: PASSWORD,
    })

    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()
  })

  afterEach(() => {
    mock.reset()
    // Clear the cached session token between tests so each test re-authenticates
    service.sessionToken = undefined
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Registration ──

  describe('service registration', () => {
    it('registers with correct config items', () => {
      const items = sandbox.getConfigItems()

      expect(items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'host', required: true, shared: false }),
          expect.objectContaining({ name: 'database', required: true, shared: false }),
          expect.objectContaining({ name: 'username', required: true, shared: false }),
          expect.objectContaining({ name: 'password', required: true, shared: false }),
        ])
      )
    })

    it('registers exactly 4 config items', () => {
      expect(sandbox.getConfigItems()).toHaveLength(4)
    })
  })

  // ── Host sanitization ──

  describe('host sanitization', () => {
    it('strips protocol from host', () => {
      expect(service.apiBaseUrl).toBe(BASE)
      // The constructor strips https:// so even if provided, it resolves to bare host
    })

    it('constructs correct apiBaseUrl', () => {
      expect(service.apiBaseUrl).toContain('fms.example.com')
      expect(service.apiBaseUrl).toContain(encodeURIComponent(DATABASE))
    })
  })

  // ── Session authentication ──

  describe('session authentication', () => {
    it('creates a session with Basic auth before making API calls', async () => {
      setupSession(mock)
      mock.onGet(`${BASE}/layouts`).reply(fmEnvelope({ layouts: [] }))

      await service.listLayouts()

      // First call is session creation, second is the actual request
      expect(mock.history).toHaveLength(2)
      expect(mock.history[0].url).toBe(`${BASE}/sessions`)
      expect(mock.history[0].headers).toMatchObject({
        Authorization: `Basic ${BASIC_TOKEN}`,
      })
    })

    it('caches the session token for subsequent calls', async () => {
      setupSession(mock)
      mock.onGet(`${BASE}/layouts`).reply(fmEnvelope({ layouts: [] }))

      await service.listLayouts()
      await service.listLayouts()

      // Only one session creation call, but two layout calls
      const sessionCalls = mock.history.filter(c => c.url === `${BASE}/sessions`)
      const layoutCalls = mock.history.filter(c => c.url === `${BASE}/layouts`)

      expect(sessionCalls).toHaveLength(1)
      expect(layoutCalls).toHaveLength(2)
    })

    it('throws when session endpoint does not return a token', async () => {
      mock.onPost(`${BASE}/sessions`).reply({
        response: {},
        messages: [{ code: '0', message: 'OK' }],
      })

      await expect(service.listLayouts()).rejects.toThrow(
        'FileMaker session endpoint did not return an access token'
      )
    })

    it('throws when session creation fails', async () => {
      mock.onPost(`${BASE}/sessions`).replyWithError({
        message: 'Unauthorized',
        body: { messages: [{ code: '212', message: 'Invalid user account' }] },
      })

      await expect(service.listLayouts()).rejects.toThrow('Failed to create a FileMaker session')
    })
  })

  // ── Records: getRecords ──

  describe('getRecords', () => {
    it('sends GET with defaults', async () => {
      const responsePayload = {
        dataInfo: { totalRecordCount: 0, foundCount: 0, returnedCount: 0 },
        data: [],
      }

      setupSession(mock)
      mock.onGet(`${BASE}/layouts/Products/records`).reply(fmEnvelope(responsePayload))

      const result = await service.getRecords('Products')

      expect(result).toEqual(responsePayload)

      const apiCall = mock.history.find(c => c.url.includes('/records'))

      expect(apiCall.method).toBe('get')
      expect(apiCall.headers).toMatchObject({
        Authorization: `Bearer ${SESSION_TOKEN}`,
      })
    })

    it('passes offset, limit, and sort as query params', async () => {
      setupSession(mock)
      mock.onGet(`${BASE}/layouts/Products/records`).reply(fmEnvelope({ data: [] }))

      const sortDef = [{ fieldName: 'Name', sortOrder: 'ascend' }]

      await service.getRecords('Products', 10, 50, sortDef)

      const apiCall = mock.history.find(c => c.url.includes('/records'))

      expect(apiCall.query).toMatchObject({
        _offset: 10,
        _limit: 50,
        _sort: JSON.stringify(sortDef),
      })
    })

    it('omits sort when not provided', async () => {
      setupSession(mock)
      mock.onGet(`${BASE}/layouts/Products/records`).reply(fmEnvelope({ data: [] }))

      await service.getRecords('Products', 1, 10)

      const apiCall = mock.history.find(c => c.url.includes('/records'))

      expect(apiCall.query._sort).toBeUndefined()
    })

    it('encodes layout names with special characters', async () => {
      const layout = 'My Layout (v2)'
      const encoded = encodeURIComponent(layout)

      setupSession(mock)
      mock.onGet(`${BASE}/layouts/${encoded}/records`).reply(fmEnvelope({ data: [] }))

      await service.getRecords(layout)

      const apiCall = mock.history.find(c => c.url.includes('/records'))

      expect(apiCall.url).toBe(`${BASE}/layouts/${encoded}/records`)
    })
  })

  // ── Records: getRecord ──

  describe('getRecord', () => {
    it('sends GET for a single record by ID', async () => {
      const responsePayload = {
        data: [{ fieldData: { Name: 'Widget' }, recordId: '12', modId: '3' }],
      }

      setupSession(mock)
      mock.onGet(`${BASE}/layouts/Products/records/12`).reply(fmEnvelope(responsePayload))

      const result = await service.getRecord('Products', '12')

      expect(result).toEqual(responsePayload)

      const apiCall = mock.history.find(c => c.url.includes('/records/12'))

      expect(apiCall.method).toBe('get')
    })
  })

  // ── Records: createRecord ──

  describe('createRecord', () => {
    it('sends POST with fieldData in body', async () => {
      setupSession(mock)
      mock.onPost(`${BASE}/layouts/Products/records`).reply(fmEnvelope({ recordId: '251', modId: '0' }))

      const fieldData = { Name: 'New Widget', Price: 19.99 }

      const result = await service.createRecord('Products', fieldData)

      expect(result).toEqual({ recordId: '251', modId: '0' })

      const apiCall = mock.history.find(c => c.method === 'post' && c.url.includes('/layouts/'))

      expect(apiCall.body).toEqual({ fieldData })
    })

    it('defaults to empty fieldData when not provided', async () => {
      setupSession(mock)
      mock.onPost(`${BASE}/layouts/Products/records`).reply(fmEnvelope({ recordId: '252', modId: '0' }))

      await service.createRecord('Products', undefined)

      const apiCall = mock.history.find(c => c.method === 'post' && c.url.includes('/layouts/'))

      expect(apiCall.body).toEqual({ fieldData: {} })
    })
  })

  // ── Records: editRecord ──

  describe('editRecord', () => {
    it('sends PATCH with fieldData in body', async () => {
      setupSession(mock)
      mock.onPatch(`${BASE}/layouts/Products/records/12`).reply(fmEnvelope({ modId: '4' }))

      const fieldData = { Price: 12.5 }

      const result = await service.editRecord('Products', '12', fieldData)

      expect(result).toEqual({ modId: '4' })

      const apiCall = mock.history.find(c => c.method === 'patch')

      expect(apiCall.body).toEqual({ fieldData })
    })

    it('includes modId for optimistic locking when provided', async () => {
      setupSession(mock)
      mock.onPatch(`${BASE}/layouts/Products/records/12`).reply(fmEnvelope({ modId: '5' }))

      await service.editRecord('Products', '12', { Price: 15 }, 4)

      const apiCall = mock.history.find(c => c.method === 'patch')

      expect(apiCall.body).toEqual({ fieldData: { Price: 15 }, modId: '4' })
    })

    it('omits modId when not provided', async () => {
      setupSession(mock)
      mock.onPatch(`${BASE}/layouts/Products/records/12`).reply(fmEnvelope({ modId: '4' }))

      await service.editRecord('Products', '12', { Price: 10 })

      const apiCall = mock.history.find(c => c.method === 'patch')

      expect(apiCall.body).toEqual({ fieldData: { Price: 10 } })
      expect(apiCall.body.modId).toBeUndefined()
    })

    it('omits modId when it is empty string', async () => {
      setupSession(mock)
      mock.onPatch(`${BASE}/layouts/Products/records/12`).reply(fmEnvelope({ modId: '4' }))

      await service.editRecord('Products', '12', { Price: 10 }, '')

      const apiCall = mock.history.find(c => c.method === 'patch')

      expect(apiCall.body.modId).toBeUndefined()
    })
  })

  // ── Records: deleteRecord ──

  describe('deleteRecord', () => {
    it('sends DELETE for a record', async () => {
      setupSession(mock)
      mock.onDelete(`${BASE}/layouts/Products/records/12`).reply(fmEnvelope({}))

      const result = await service.deleteRecord('Products', '12')

      expect(result).toEqual({})

      const apiCall = mock.history.find(c => c.method === 'delete')

      expect(apiCall.url).toBe(`${BASE}/layouts/Products/records/12`)
    })
  })

  // ── Records: duplicateRecord ──

  describe('duplicateRecord', () => {
    it('sends POST to the record URL with empty body', async () => {
      setupSession(mock)
      mock.onPost(`${BASE}/layouts/Products/records/12`).reply(fmEnvelope({ recordId: '253', modId: '0' }))

      const result = await service.duplicateRecord('Products', '12')

      expect(result).toEqual({ recordId: '253', modId: '0' })

      const apiCall = mock.history.find(c => c.method === 'post' && c.url.includes('/records/12'))

      expect(apiCall.body).toEqual({})
    })
  })

  // ── Find ──

  describe('findRecords', () => {
    it('sends POST to _find with query in body', async () => {
      const responsePayload = {
        dataInfo: { foundCount: 1, returnedCount: 1 },
        data: [{ fieldData: { Name: 'Widget' }, recordId: '12' }],
      }

      setupSession(mock)
      mock.onPost(`${BASE}/layouts/Products/_find`).reply(fmEnvelope(responsePayload))

      const query = [{ Name: 'Widget' }]
      const result = await service.findRecords('Products', query)

      expect(result).toEqual(responsePayload)

      const apiCall = mock.history.find(c => c.url.includes('/_find'))

      expect(apiCall.body).toEqual({ query })
    })

    it('includes sort, offset and limit when provided', async () => {
      setupSession(mock)
      mock.onPost(`${BASE}/layouts/Products/_find`).reply(fmEnvelope({ data: [] }))

      const query = [{ Name: '*' }]
      const sort = [{ fieldName: 'Name', sortOrder: 'ascend' }]

      await service.findRecords('Products', query, sort, 5, 25)

      const apiCall = mock.history.find(c => c.url.includes('/_find'))

      expect(apiCall.body).toEqual({
        query,
        sort,
        offset: '5',
        limit: '25',
      })
    })

    it('omits optional fields when not provided', async () => {
      setupSession(mock)
      mock.onPost(`${BASE}/layouts/Products/_find`).reply(fmEnvelope({ data: [] }))

      await service.findRecords('Products', [{ Status: 'Active' }])

      const apiCall = mock.history.find(c => c.url.includes('/_find'))

      expect(apiCall.body).toEqual({ query: [{ Status: 'Active' }] })
      expect(apiCall.body.sort).toBeUndefined()
      expect(apiCall.body.offset).toBeUndefined()
      expect(apiCall.body.limit).toBeUndefined()
    })

    it('defaults to empty query array when query is not provided', async () => {
      setupSession(mock)
      mock.onPost(`${BASE}/layouts/Products/_find`).reply(fmEnvelope({ data: [] }))

      await service.findRecords('Products', undefined)

      const apiCall = mock.history.find(c => c.url.includes('/_find'))

      expect(apiCall.body.query).toEqual([])
    })
  })

  // ── Scripts ──

  describe('runScript', () => {
    it('sends GET with script name and optional param', async () => {
      setupSession(mock)
      mock.onGet(`${BASE}/layouts/Products/script/RecalcTotals`).reply(
        fmEnvelope({ scriptResult: 'Done', scriptError: '0' })
      )

      const result = await service.runScript('Products', 'RecalcTotals', 'paramValue')

      expect(result).toEqual({ scriptResult: 'Done', scriptError: '0' })

      const apiCall = mock.history.find(c => c.url.includes('/script/'))

      expect(apiCall.query).toMatchObject({ 'script.param': 'paramValue' })
    })

    it('omits script.param when not provided', async () => {
      setupSession(mock)
      mock.onGet(`${BASE}/layouts/Products/script/RecalcTotals`).reply(
        fmEnvelope({ scriptResult: '', scriptError: '0' })
      )

      await service.runScript('Products', 'RecalcTotals')

      const apiCall = mock.history.find(c => c.url.includes('/script/'))

      // The cleanedQuery logic strips undefined values
      expect(apiCall.query['script.param']).toBeUndefined()
    })
  })

  describe('listScripts', () => {
    it('sends GET to /scripts', async () => {
      const scripts = [
        { name: 'Recalculate Totals', isFolder: false },
        { name: 'Reports', isFolder: true, folderScriptNames: [{ name: 'Monthly Report', isFolder: false }] },
      ]

      setupSession(mock)
      mock.onGet(`${BASE}/scripts`).reply(fmEnvelope({ scripts }))

      const result = await service.listScripts()

      expect(result).toEqual({ scripts })
    })
  })

  // ── Metadata ──

  describe('listLayouts', () => {
    it('sends GET to /layouts', async () => {
      const layouts = [{ name: 'Products' }, { name: 'Orders' }]

      setupSession(mock)
      mock.onGet(`${BASE}/layouts`).reply(fmEnvelope({ layouts }))

      const result = await service.listLayouts()

      expect(result).toEqual({ layouts })
    })
  })

  describe('getLayoutMetadata', () => {
    it('sends GET to /layouts/{layout}', async () => {
      const responsePayload = {
        fieldMetaData: [{ name: 'Name', type: 'normal', result: 'text' }],
        portalMetaData: {},
        valueLists: [],
      }

      setupSession(mock)
      mock.onGet(`${BASE}/layouts/Products`).reply(fmEnvelope(responsePayload))

      const result = await service.getLayoutMetadata('Products')

      expect(result).toEqual(responsePayload)
    })
  })

  describe('getProductInfo', () => {
    it('sends GET to productInfo at server root', async () => {
      const productInfo = {
        name: 'FileMaker Data API Engine',
        version: '21.0.1.62',
      }

      setupSession(mock)
      mock.onGet(`https://${HOST}/fmi/data/vLatest/productInfo`).reply(fmEnvelope({ productInfo }))

      const result = await service.getProductInfo()

      expect(result).toEqual({ productInfo })
    })
  })

  // ── Globals ──

  describe('setGlobalFields', () => {
    it('sends PATCH with globalFields in body', async () => {
      setupSession(mock)
      mock.onPatch(`${BASE}/globals`).reply(fmEnvelope({}))

      const globalFields = { 'Prefs::CurrentUser': 'jdoe' }

      const result = await service.setGlobalFields(globalFields)

      expect(result).toEqual({})

      const apiCall = mock.history.find(c => c.method === 'patch')

      expect(apiCall.body).toEqual({ globalFields })
    })

    it('defaults to empty globalFields when not provided', async () => {
      setupSession(mock)
      mock.onPatch(`${BASE}/globals`).reply(fmEnvelope({}))

      await service.setGlobalFields(undefined)

      const apiCall = mock.history.find(c => c.method === 'patch')

      expect(apiCall.body).toEqual({ globalFields: {} })
    })
  })

  // ── Dictionary: getLayoutsDictionary ──

  describe('getLayoutsDictionary', () => {
    it('returns flattened layout names as dictionary items', async () => {
      const layouts = [
        { name: 'Products' },
        { name: 'Reports', isFolder: true, folderLayoutNames: [{ name: 'Sales Summary' }] },
        { name: 'Orders' },
      ]

      setupSession(mock)
      mock.onGet(`${BASE}/layouts`).reply(fmEnvelope({ layouts }))

      const result = await service.getLayoutsDictionary({})

      expect(result.items).toEqual([
        { label: 'Products', value: 'Products', note: 'Layout' },
        { label: 'Sales Summary', value: 'Sales Summary', note: 'Layout' },
        { label: 'Orders', value: 'Orders', note: 'Layout' },
      ])
    })

    it('filters by search term', async () => {
      const layouts = [{ name: 'Products' }, { name: 'Orders' }, { name: 'Product Reports' }]

      setupSession(mock)
      mock.onGet(`${BASE}/layouts`).reply(fmEnvelope({ layouts }))

      const result = await service.getLayoutsDictionary({ search: 'product' })

      expect(result.items).toEqual([
        { label: 'Products', value: 'Products', note: 'Layout' },
        { label: 'Product Reports', value: 'Product Reports', note: 'Layout' },
      ])
    })

    it('returns all layouts when search is empty', async () => {
      const layouts = [{ name: 'A' }, { name: 'B' }]

      setupSession(mock)
      mock.onGet(`${BASE}/layouts`).reply(fmEnvelope({ layouts }))

      const result = await service.getLayoutsDictionary({ search: '' })

      expect(result.items).toHaveLength(2)
    })

    it('handles undefined payload', async () => {
      const layouts = [{ name: 'Products' }]

      setupSession(mock)
      mock.onGet(`${BASE}/layouts`).reply(fmEnvelope({ layouts }))

      const result = await service.getLayoutsDictionary(undefined)

      expect(result.items).toHaveLength(1)
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('throws on API error with extracted message', async () => {
      setupSession(mock)
      mock.onGet(`${BASE}/layouts`).replyWithError({
        message: 'Bad Request',
        status: 400,
        body: { messages: [{ code: '401', message: 'No records match the request' }] },
      })

      await expect(service.listLayouts()).rejects.toThrow('FileMaker API error (400)')
    })

    it('retries once on 401 by re-authenticating', async () => {
      const layouts = [{ name: 'Products' }]
      let getCallCount = 0

      setupSession(mock)
      mock.onGet(`${BASE}/layouts`).replyWith(() => {
        getCallCount++

        if (getCallCount === 1) {
          const err = new Error('Unauthorized')

          err.status = 401

          throw err
        }

        return fmEnvelope({ layouts })
      })

      const result = await service.listLayouts()

      expect(result).toEqual({ layouts })

      // Should have 2 session calls (initial + re-auth) and 2 layout calls (fail + retry)
      const sessionCalls = mock.history.filter(c => c.url === `${BASE}/sessions`)

      expect(sessionCalls).toHaveLength(2)
    })

    it('throws after second 401 without infinite retry', async () => {
      setupSession(mock)
      mock.onGet(`${BASE}/layouts`).replyWithError({ message: 'Unauthorized', status: 401 })

      await expect(service.listLayouts()).rejects.toThrow('FileMaker API error (401)')
    })

    it('throws on envelope error code even with 200 response', async () => {
      setupSession(mock)
      mock.onGet(`${BASE}/layouts`).reply({
        response: {},
        messages: [{ code: '802', message: 'Unable to open file' }],
      })

      await expect(service.listLayouts()).rejects.toThrow('Unable to open file (code 802)')
    })

    it('extracts error message from body.message string', async () => {
      setupSession(mock)
      mock.onGet(`${BASE}/layouts`).replyWithError({
        message: 'Server Error',
        status: 500,
        body: { message: 'Internal server error occurred' },
      })

      await expect(service.listLayouts()).rejects.toThrow('Internal server error occurred')
    })

    it('extracts error from plain string body', async () => {
      setupSession(mock)
      mock.onGet(`${BASE}/layouts`).replyWithError({
        message: 'Server Error',
        status: 500,
        body: 'Something went wrong',
      })

      await expect(service.listLayouts()).rejects.toThrow('Something went wrong')
    })

    it('falls back to error.message when body has no useful info', async () => {
      setupSession(mock)
      mock.onGet(`${BASE}/layouts`).replyWithError({
        message: 'Network timeout',
        status: 504,
      })

      await expect(service.listLayouts()).rejects.toThrow('Network timeout')
    })
  })
})
