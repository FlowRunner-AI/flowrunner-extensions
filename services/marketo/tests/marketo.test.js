'use strict'

const { createSandbox } = require('../../../service-sandbox')

const CLIENT_ID = 'test-client-id'
const CLIENT_SECRET = 'test-client-secret'
const BASE_URL = 'https://123-ABC-456.mktorest.com'
const REST = `${ BASE_URL }/rest/v1`
const ASSET = `${ BASE_URL }/rest/asset/v1`
const BULK = `${ BASE_URL }/bulk/v1`
const TOKEN_URL = `${ BASE_URL }/identity/oauth/token`

const TOKEN_REPLY = { access_token: 'mock-token-123', token_type: 'bearer', expires_in: 3600, scope: 'test@marketo.com' }
const OK = { requestId: 'r#1', success: true }

describe('Marketo Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, baseUrl: BASE_URL, rootFolderId: '1035' })
    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()
  })

  afterEach(() => {
    mock.reset()
    // Reset cached token between tests
    service._token = null
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Helpers ──

  /** Sets up the token endpoint mock so #getAccessToken succeeds. */
  function mockToken() {
    mock.onGet(TOKEN_URL).reply(TOKEN_REPLY)
  }

  // ── Registration ──

  describe('service registration', () => {
    it('registers with correct config items', () => {
      expect(sandbox.getConfigItems()).toEqual([
        expect.objectContaining({ name: 'clientId', displayName: 'Client ID', required: true, shared: true }),
        expect.objectContaining({ name: 'clientSecret', displayName: 'Client Secret', required: true, shared: true }),
        expect.objectContaining({ name: 'baseUrl', displayName: 'Base URL', required: true, shared: false }),
        expect.objectContaining({ name: 'rootFolderId', displayName: 'Root Folder ID', required: false, shared: false }),
      ])
    })

    // Regression guard: rootFolderId was read by getFoldersDictionary / getSmartListsDictionary
    // but never registered, so it was unsettable in production and both dictionaries were
    // permanently empty. Every config key the service reads must be registered.
    it('registers every config key the service reads', () => {
      const registered = sandbox.getConfigItems().map(item => item.name)
      const source = require('fs').readFileSync(require.resolve('../src/index.js'), 'utf8')
      const read = [...new Set([...source.matchAll(/this\.config\.([A-Za-z0-9_]+)/g)].map(m => m[1]))]

      // Guard against a vacuous pass if the scan ever stops matching.
      expect(read).toEqual(expect.arrayContaining(['rootFolderId', 'baseUrl']))
      expect(read.sort()).toEqual([...read].sort().filter(key => registered.includes(key)))
    })
  })

  // ── Auth ──

  describe('authentication', () => {
    it('fetches an access token before the first API call', async () => {
      mockToken()
      mock.onGet(`${ REST }/leads/describe.json`).reply({ ...OK, result: [] })

      await service.describeLeadFields()

      // First call is token, second is the API call
      expect(mock.history).toHaveLength(2)
      expect(mock.history[0].url).toBe(TOKEN_URL)

      expect(mock.history[0].query).toMatchObject({
        grant_type: 'client_credentials',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
      })
    })

    it('sends Bearer token in Authorization header', async () => {
      mockToken()
      mock.onGet(`${ REST }/leads/describe.json`).reply({ ...OK, result: [] })

      await service.describeLeadFields()

      expect(mock.history[1].headers).toMatchObject({
        Authorization: 'Bearer mock-token-123',
      })
    })

    it('retries on token error (601/602)', async () => {
      mockToken()

      // First API call returns token error, then after refresh the retry succeeds
      mock.onGet(`${ REST }/leads/describe.json`).replyWith(call => {
        // First call (after token) returns 601, second call returns success
        const apiCalls = mock.history.filter(h => h.url.includes('/leads/describe.json'))

        if (apiCalls.length <= 1) {
          return { success: false, errors: [{ code: '601', message: 'Access token invalid' }] }
        }

        return { ...OK, result: [] }
      })

      await service.describeLeadFields()

      // token + API call + token refresh + API retry = 4
      expect(mock.history.length).toBeGreaterThanOrEqual(3)
    })

    it('throws when not configured', async () => {
      // Temporarily clear config to simulate missing credentials
      const origId = service.clientId
      const origSecret = service.clientSecret
      const origBase = service.baseUrl

      service.clientId = ''
      service.clientSecret = ''
      service.baseUrl = ''

      await expect(service.describeLeadFields()).rejects.toThrow('not configured')

      service.clientId = origId
      service.clientSecret = origSecret
      service.baseUrl = origBase
    })
  })

  // ── Leads ──

  describe('syncLeads', () => {
    it('sends POST with correct body and defaults', async () => {
      mockToken()
      mock.onPost(`${ REST }/leads.json`).reply({ ...OK, result: [{ id: 50, status: 'created' }] })

      const result = await service.syncLeads([{ email: 'test@example.com', firstName: 'Test' }])

      expect(result.success).toBe(true)
      expect(result.result[0].status).toBe('created')

      const apiCall = mock.history.find(h => h.url.includes('/leads.json') && h.method === 'post')

      expect(apiCall.body).toMatchObject({
        action: 'createOrUpdate',
        lookupField: 'email',
        input: [{ email: 'test@example.com', firstName: 'Test' }],
      })
    })

    it('maps action and lookup field dropdown values', async () => {
      mockToken()
      mock.onPost(`${ REST }/leads.json`).reply({ ...OK, result: [] })

      await service.syncLeads([{ id: 1 }], 'Update Only', 'Marketo ID', 'myPartition')

      const apiCall = mock.history.find(h => h.url.includes('/leads.json') && h.method === 'post')

      expect(apiCall.body).toMatchObject({
        action: 'updateOnly',
        lookupField: 'id',
        partitionName: 'myPartition',
      })
    })

    it('throws when leads array is empty', async () => {
      await expect(service.syncLeads([])).rejects.toThrow('Leads is required')
    })
  })

  describe('getLeadById', () => {
    it('fetches a lead with optional fields', async () => {
      mockToken()
      mock.onGet(`${ REST }/lead/123.json`).reply({ ...OK, result: [{ id: 123, email: 'j@test.com' }] })

      const result = await service.getLeadById('123', ['email', 'firstName'])

      expect(result.result[0].id).toBe(123)
      expect(mock.history[1].query).toMatchObject({ fields: 'email,firstName' })
    })

    it('throws when lead is not provided', async () => {
      await expect(service.getLeadById('')).rejects.toThrow('Lead is required')
    })
  })

  describe('getLeads', () => {
    it('sends correct query params', async () => {
      mockToken()
      mock.onGet(`${ REST }/leads.json`).reply({ ...OK, result: [] })

      await service.getLeads('Email', ['a@test.com', 'b@test.com'], ['email'], 100, 'TOKEN123')

      const apiCall = mock.history.find(h => h.url.includes('/leads.json') && h.method === 'get')

      expect(apiCall.query).toMatchObject({
        filterType: 'email',
        filterValues: 'a@test.com,b@test.com',
        fields: 'email',
        batchSize: 100,
        nextPageToken: 'TOKEN123',
      })
    })

    it('throws when filter type is missing', async () => {
      await expect(service.getLeads('', [])).rejects.toThrow('Filter Field is required')
    })

    it('throws when filter values are empty', async () => {
      await expect(service.getLeads('Email', [])).rejects.toThrow('Filter Values is required')
    })
  })

  describe('deleteLeads', () => {
    it('sends POST with lead IDs', async () => {
      mockToken()
      mock.onPost(`${ REST }/leads/delete.json`).reply({ ...OK, result: [{ id: 235, status: 'deleted' }] })

      await service.deleteLeads(['235', '766'])

      const apiCall = mock.history.find(h => h.url.includes('/leads/delete.json'))

      expect(apiCall.body).toEqual({ input: [{ id: 235 }, { id: 766 }] })
    })

    it('throws when lead IDs are empty', async () => {
      await expect(service.deleteLeads([])).rejects.toThrow('Lead IDs is required')
    })
  })

  describe('describeLeadFields', () => {
    it('calls the describe endpoint', async () => {
      mockToken()
      mock.onGet(`${ REST }/leads/describe.json`).reply({ ...OK, result: [{ id: 2, displayName: 'Company Name' }] })

      const result = await service.describeLeadFields()

      expect(result.result[0].displayName).toBe('Company Name')
    })
  })

  // ── Lists ──

  describe('getLists', () => {
    it('sends with optional filters', async () => {
      mockToken()
      mock.onGet(`${ REST }/lists.json`).reply({ ...OK, result: [{ id: 1027, name: 'My List' }] })

      await service.getLists('My List', 'Newsletter', 50, 'TOK')

      const apiCall = mock.history.find(h => h.url.includes('/lists.json') && h.method === 'get')

      expect(apiCall.query).toMatchObject({
        name: 'My List',
        programName: 'Newsletter',
        batchSize: 50,
        nextPageToken: 'TOK',
      })
    })
  })

  describe('getListById', () => {
    it('fetches by ID', async () => {
      mockToken()
      mock.onGet(`${ REST }/lists/1027.json`).reply({ ...OK, result: [{ id: 1027, name: 'My List' }] })

      const result = await service.getListById('1027')

      expect(result.result[0].name).toBe('My List')
    })

    it('throws when list is not provided', async () => {
      await expect(service.getListById('')).rejects.toThrow('List is required')
    })
  })

  describe('addLeadsToList', () => {
    it('sends repeated id query params', async () => {
      mockToken()
      mock.onPost(`${ REST }/lists/1027/leads.json`).reply({ ...OK, result: [{ id: 100, status: 'added' }] })

      await service.addLeadsToList('1027', ['100', '200'])

      const apiCall = mock.history.find(h => h.url.includes('/lists/1027/leads.json') && h.method === 'post')

      expect(apiCall.query).toMatchObject({ id: ['100', '200'] })
    })

    it('throws when lead IDs are empty', async () => {
      await expect(service.addLeadsToList('1027', [])).rejects.toThrow('Lead IDs is required')
    })
  })

  describe('removeLeadsFromList', () => {
    it('sends DELETE with repeated id query params', async () => {
      mockToken()
      mock.onDelete(`${ REST }/lists/1027/leads.json`).reply({ ...OK, result: [{ id: 100, status: 'removed' }] })

      await service.removeLeadsFromList('1027', ['100'])

      const apiCall = mock.history.find(h => h.method === 'delete')

      expect(apiCall.query).toMatchObject({ id: ['100'] })
    })
  })

  describe('isMemberOfList', () => {
    it('sends GET with repeated id query params', async () => {
      mockToken()
      mock.onGet(`${ REST }/lists/1027/leads/ismember.json`).reply({ ...OK, result: [{ id: 100, status: 'memberof' }] })

      const result = await service.isMemberOfList('1027', ['100'])

      expect(result.result[0].status).toBe('memberof')
    })
  })

  describe('getLeadsByList', () => {
    it('sends correct request', async () => {
      mockToken()
      mock.onGet(`${ REST }/lists/1027/leads.json`).reply({ ...OK, result: [] })

      await service.getLeadsByList('1027', ['email'], 100, 'TOK')

      const apiCall = mock.history.find(h => h.url.includes('/lists/1027/leads.json'))

      expect(apiCall.query).toMatchObject({ fields: 'email', batchSize: 100, nextPageToken: 'TOK' })
    })

    it('throws when list is not provided', async () => {
      await expect(service.getLeadsByList('')).rejects.toThrow('List is required')
    })
  })

  // ── Campaigns ──

  describe('getCampaigns', () => {
    it('sends with optional filters', async () => {
      mockToken()
      mock.onGet(`${ REST }/campaigns.json`).reply({ ...OK, result: [] })

      await service.getCampaigns('Test', 'Program', true, 50, 'TOK')

      const apiCall = mock.history.find(h => h.url.includes('/campaigns.json'))

      expect(apiCall.query).toMatchObject({
        name: 'Test',
        programName: 'Program',
        isTriggerable: true,
        batchSize: 50,
        nextPageToken: 'TOK',
      })
    })
  })

  describe('getCampaignById', () => {
    it('fetches by ID', async () => {
      mockToken()
      mock.onGet(`${ REST }/campaigns/1069.json`).reply({ ...OK, result: [{ id: 1069, name: 'Test' }] })

      const result = await service.getCampaignById('1069')

      expect(result.result[0].id).toBe(1069)
    })

    it('throws when campaign is not provided', async () => {
      await expect(service.getCampaignById('')).rejects.toThrow('Campaign is required')
    })
  })

  describe('requestCampaign', () => {
    it('sends POST with leads and optional tokens', async () => {
      mockToken()
      mock.onPost(`${ REST }/campaigns/1069/trigger.json`).reply({ ...OK, result: [{ id: 8304 }] })

      await service.requestCampaign('1069', ['100', '200'], [{ name: '{{my.Title}}', value: 'Hello' }])

      const apiCall = mock.history.find(h => h.url.includes('/trigger.json'))

      expect(apiCall.body).toEqual({
        input: {
          leads: [{ id: 100 }, { id: 200 }],
          tokens: [{ name: '{{my.Title}}', value: 'Hello' }],
        },
      })
    })

    it('omits tokens when empty', async () => {
      mockToken()
      mock.onPost(`${ REST }/campaigns/1069/trigger.json`).reply(OK)

      await service.requestCampaign('1069', ['100'])

      const apiCall = mock.history.find(h => h.url.includes('/trigger.json'))

      expect(apiCall.body.input.tokens).toBeUndefined()
    })

    it('throws when lead IDs are empty', async () => {
      await expect(service.requestCampaign('1069', [])).rejects.toThrow('Lead IDs is required')
    })
  })

  describe('scheduleCampaign', () => {
    it('sends POST with optional params', async () => {
      mockToken()
      mock.onPost(`${ REST }/campaigns/1069/schedule.json`).reply(OK)

      await service.scheduleCampaign('1069', '2026-01-01T00:00:00Z', 'Clone Name', [{ name: '{{my.Token}}', value: 'v' }])

      const apiCall = mock.history.find(h => h.url.includes('/schedule.json'))

      expect(apiCall.body).toEqual({
        input: {
          runAt: '2026-01-01T00:00:00Z',
          cloneToProgramName: 'Clone Name',
          tokens: [{ name: '{{my.Token}}', value: 'v' }],
        },
      })
    })
  })

  // ── Activities ──

  describe('getActivityTypes', () => {
    it('calls the types endpoint', async () => {
      mockToken()
      mock.onGet(`${ REST }/activities/types.json`).reply({ ...OK, result: [{ id: 2, name: 'Fill Out Form' }] })

      const result = await service.getActivityTypes()

      expect(result.result[0].name).toBe('Fill Out Form')
    })
  })

  describe('getPagingToken', () => {
    it('sends sinceDatetime query', async () => {
      mockToken()
      mock.onGet(`${ REST }/activities/pagingtoken.json`).reply({ ...OK, nextPageToken: 'TOKEN==' })

      const result = await service.getPagingToken('2025-01-01T00:00:00Z')

      expect(mock.history[1].query).toMatchObject({ sinceDatetime: '2025-01-01T00:00:00Z' })
      expect(result.nextPageToken).toBe('TOKEN==')
    })

    it('throws when sinceDatetime is missing', async () => {
      await expect(service.getPagingToken('')).rejects.toThrow('Since Date/Time is required')
    })
  })

  describe('getLeadActivities', () => {
    it('sends correct query params', async () => {
      mockToken()
      mock.onGet(`${ REST }/activities.json`).reply({ ...OK, result: [], moreResult: false })

      await service.getLeadActivities('TOK', ['1', '2'], ['100'], '1027', 50)

      const apiCall = mock.history.find(h => h.url.includes('/activities.json'))

      expect(apiCall.query).toMatchObject({
        nextPageToken: 'TOK',
        activityTypeIds: '1,2',
        leadIds: '100',
        listId: '1027',
        batchSize: 50,
      })
    })

    it('throws when nextPageToken is missing', async () => {
      await expect(service.getLeadActivities('', ['1'])).rejects.toThrow('Next Page Token is required')
    })

    it('throws when activity type IDs are empty', async () => {
      await expect(service.getLeadActivities('TOK', [])).rejects.toThrow('Activity Types is required')
    })
  })

  // ── Custom Objects ──

  describe('listCustomObjectTypes', () => {
    it('sends with optional names filter', async () => {
      mockToken()
      mock.onGet(`${ REST }/customobjects.json`).reply({ ...OK, result: [{ name: 'car_c' }] })

      await service.listCustomObjectTypes(['car_c'])

      expect(mock.history[1].query).toMatchObject({ names: 'car_c' })
    })
  })

  describe('describeCustomObject', () => {
    it('fetches by API name', async () => {
      mockToken()
      mock.onGet(`${ REST }/customobjects/car_c/describe.json`).reply({ ...OK, result: [{ name: 'car_c' }] })

      const result = await service.describeCustomObject('car_c')

      expect(result.result[0].name).toBe('car_c')
    })

    it('throws when API name is missing', async () => {
      await expect(service.describeCustomObject('')).rejects.toThrow('Custom Object is required')
    })
  })

  describe('queryCustomObjects', () => {
    it('sends correct query', async () => {
      mockToken()
      mock.onGet(`${ REST }/customobjects/car_c.json`).reply({ ...OK, result: [] })

      await service.queryCustomObjects('car_c', 'vin', ['VIN123'], ['vin', 'make'])

      const apiCall = mock.history.find(h => h.url.includes('/customobjects/car_c.json'))

      expect(apiCall.query).toMatchObject({
        filterType: 'vin',
        filterValues: 'VIN123',
        fields: 'vin,make',
      })
    })
  })

  describe('syncCustomObjects', () => {
    it('sends POST with records and action', async () => {
      mockToken()
      mock.onPost(`${ REST }/customobjects/car_c.json`).reply({ ...OK, result: [{ seq: 0, status: 'created' }] })

      await service.syncCustomObjects('car_c', [{ vin: 'VIN123' }], 'Create Only', 'Dedupe Fields')

      const apiCall = mock.history.find(h => h.url.includes('/customobjects/car_c.json') && h.method === 'post')

      expect(apiCall.body).toMatchObject({
        action: 'createOnly',
        input: [{ vin: 'VIN123' }],
        dedupeBy: 'dedupeFields',
      })
    })
  })

  describe('deleteCustomObjects', () => {
    it('sends POST to delete endpoint', async () => {
      mockToken()
      mock.onPost(`${ REST }/customobjects/car_c/delete.json`).reply({ ...OK, result: [{ seq: 0, status: 'deleted' }] })

      await service.deleteCustomObjects('car_c', [{ vin: 'VIN123' }], 'ID Field')

      const apiCall = mock.history.find(h => h.url.includes('/delete.json'))

      expect(apiCall.body).toMatchObject({ input: [{ vin: 'VIN123' }], deleteBy: 'idField' })
    })
  })

  // ── Asset API - Programs ──

  describe('browsePrograms', () => {
    it('sends with optional filters', async () => {
      mockToken()
      mock.onGet(`${ ASSET }/programs.json`).reply({ ...OK, result: [] })

      await service.browsePrograms('On', 50, 10)

      const apiCall = mock.history.find(h => h.url.includes('/programs.json'))

      expect(apiCall.query).toMatchObject({ status: 'on', maxReturn: 50, offset: 10 })
    })
  })

  describe('getProgramById', () => {
    it('fetches by ID', async () => {
      mockToken()
      mock.onGet(`${ ASSET }/program/1107.json`).reply({ ...OK, result: [{ id: 1107, name: 'Test' }] })

      const result = await service.getProgramById('1107')

      expect(result.result[0].name).toBe('Test')
    })
  })

  describe('createProgram', () => {
    it('sends form-encoded POST', async () => {
      mockToken()
      mock.onPost(`${ ASSET }/programs.json`).reply({ ...OK, result: [{ id: 1108 }] })

      await service.createProgram('Test', '1035', 'Default', 'Email Blast', 'Desc')

      const apiCall = mock.history.find(h => h.url.includes('/programs.json') && h.method === 'post')

      expect(apiCall.headers['Content-Type']).toBe('application/x-www-form-urlencoded')
      // Body is form-encoded string
      expect(typeof apiCall.body).toBe('string')
      expect(apiCall.body).toContain('name=Test')
      expect(apiCall.body).toContain('channel=Email%20Blast')
    })

    it('throws when required params are missing', async () => {
      await expect(service.createProgram('', '', '', '')).rejects.toThrow('Name is required')
      await expect(service.createProgram('Test', '', '', '')).rejects.toThrow('Folder is required')
      await expect(service.createProgram('Test', '1', '', '')).rejects.toThrow('Type is required')
      await expect(service.createProgram('Test', '1', 'Default', '')).rejects.toThrow('Channel is required')
    })
  })

  describe('deleteProgram', () => {
    it('sends POST to delete endpoint', async () => {
      mockToken()
      mock.onPost(`${ ASSET }/program/1109/delete.json`).reply({ ...OK, result: [{ id: 1109 }] })

      await service.deleteProgram('1109')

      const apiCall = mock.history.find(h => h.url.includes('/delete.json'))

      expect(apiCall.method).toBe('post')
    })
  })

  // ── Asset API - Folders ──

  describe('browseFolders', () => {
    it('sends root as JSON string query param', async () => {
      mockToken()
      mock.onGet(`${ ASSET }/folders.json`).reply({ ...OK, result: [] })

      await service.browseFolders('1035', 3, 50, 10)

      const apiCall = mock.history.find(h => h.url.includes('/folders.json'))

      expect(apiCall.query).toMatchObject({
        root: JSON.stringify({ id: 1035, type: 'Folder' }),
        maxDepth: 3,
        maxReturn: 50,
        offset: 10,
      })
    })
  })

  describe('createFolder', () => {
    it('sends form-encoded POST', async () => {
      mockToken()
      mock.onPost(`${ ASSET }/folders.json`).reply({ ...OK, result: [{ id: 1240 }] })

      await service.createFolder('New Folder', '1035', 'Description')

      const apiCall = mock.history.find(h => h.url.includes('/folders.json') && h.method === 'post')

      expect(apiCall.body).toContain('name=New%20Folder')
    })
  })

  // ── Asset API - Emails ──

  describe('browseEmails', () => {
    it('sends with optional filters', async () => {
      mockToken()
      mock.onGet(`${ ASSET }/emails.json`).reply({ ...OK, result: [] })

      await service.browseEmails('Approved', '1035', 50, 10)

      const apiCall = mock.history.find(h => h.url.includes('/emails.json'))

      expect(apiCall.query).toMatchObject({
        status: 'Approved',
        folder: JSON.stringify({ id: 1035, type: 'Folder' }),
        maxReturn: 50,
        offset: 10,
      })
    })
  })

  describe('getEmailById', () => {
    it('maps version dropdown to API value', async () => {
      mockToken()
      mock.onGet(`${ ASSET }/email/1356.json`).reply({ ...OK, result: [{ id: 1356 }] })

      await service.getEmailById('1356', 'Draft')

      expect(mock.history[1].query).toMatchObject({ status: 'draft' })
    })
  })

  describe('createEmail', () => {
    it('sends form-encoded POST with all params', async () => {
      mockToken()
      mock.onPost(`${ ASSET }/emails.json`).reply({ ...OK, result: [{ id: 2212 }] })

      await service.createEmail('Test Email', '24', '1035', 'Subject', 'Sender', 'from@test.com', 'reply@test.com', true, 'Desc')

      const apiCall = mock.history.find(h => h.url.includes('/emails.json') && h.method === 'post')

      expect(apiCall.body).toContain('name=Test%20Email')
      expect(apiCall.body).toContain('template=24')
      expect(apiCall.body).toContain('subject=Subject')
      expect(apiCall.body).toContain('operational=true')
    })
  })

  describe('sendSampleEmail', () => {
    it('sends form-encoded POST', async () => {
      mockToken()
      mock.onPost(`${ ASSET }/email/1356/sendSample.json`).reply({ ...OK, result: [{ id: 1356 }] })

      await service.sendSampleEmail('1356', 'test@test.com', '100', true)

      const apiCall = mock.history.find(h => h.url.includes('/sendSample.json'))

      expect(apiCall.body).toContain('emailAddress=test%40test.com')
      expect(apiCall.body).toContain('leadId=100')
      expect(apiCall.body).toContain('textOnly=true')
    })
  })

  // ── Asset API - Forms ──

  describe('browseForms', () => {
    it('sends with optional filters', async () => {
      mockToken()
      mock.onGet(`${ ASSET }/forms.json`).reply({ ...OK, result: [] })

      await service.browseForms('Approved', 50, 10)

      const apiCall = mock.history.find(h => h.url.includes('/forms.json'))

      expect(apiCall.query).toMatchObject({ status: 'Approved', maxReturn: 50, offset: 10 })
    })
  })

  describe('getFormFields', () => {
    it('fetches form fields', async () => {
      mockToken()
      mock.onGet(`${ ASSET }/form/1029/fields.json`).reply({ ...OK, result: [{ id: 'Email' }] })

      const result = await service.getFormFields('1029')

      expect(result.result[0].id).toBe('Email')
    })
  })

  // ── Asset API - Landing Pages ──

  describe('browseLandingPages', () => {
    it('sends with optional filters', async () => {
      mockToken()
      mock.onGet(`${ ASSET }/landingPages.json`).reply({ ...OK, result: [] })

      await service.browseLandingPages('Approved', '1035', 50, 10)

      const apiCall = mock.history.find(h => h.url.includes('/landingPages.json'))

      expect(apiCall.query).toMatchObject({
        status: 'Approved',
        folder: JSON.stringify({ id: 1035, type: 'Folder' }),
      })
    })
  })

  // ── Asset API - Smart Lists ──

  describe('browseSmartLists', () => {
    it('sends folder as JSON query param', async () => {
      mockToken()
      mock.onGet(`${ ASSET }/smartLists.json`).reply({ ...OK, result: [] })

      await service.browseSmartLists('1035', 50, 10)

      const apiCall = mock.history.find(h => h.url.includes('/smartLists.json'))

      expect(apiCall.query).toMatchObject({
        folder: JSON.stringify({ id: 1035, type: 'Folder' }),
        maxReturn: 50,
        offset: 10,
      })
    })
  })

  // ── Asset API - Snippets ──

  describe('getSnippetById', () => {
    it('fetches by ID', async () => {
      mockToken()
      mock.onGet(`${ ASSET }/snippet/33.json`).reply({ ...OK, result: [{ id: 33 }] })

      const result = await service.getSnippetById('33')

      expect(result.result[0].id).toBe(33)
    })

    it('throws when snippet is missing', async () => {
      await expect(service.getSnippetById('')).rejects.toThrow('Snippet is required')
    })
  })

  describe('createSnippet', () => {
    it('sends form-encoded POST', async () => {
      mockToken()
      mock.onPost(`${ ASSET }/snippets.json`).reply({ ...OK, result: [{ id: 34 }] })

      await service.createSnippet('Test Snippet', '1035', 'A snippet')

      const apiCall = mock.history.find(h => h.url.includes('/snippets.json') && h.method === 'post')

      expect(apiCall.body).toContain('name=Test%20Snippet')
    })
  })

  describe('updateSnippetContent', () => {
    it('sends content and type', async () => {
      mockToken()
      mock.onPost(`${ ASSET }/snippet/34/content.json`).reply({ ...OK, result: [{ id: 34 }] })

      await service.updateSnippetContent('34', '<p>Hello</p>')

      const apiCall = mock.history.find(h => h.url.includes('/content.json'))

      expect(apiCall.body).toContain('type=HTML')
    })

    it('throws when content is empty', async () => {
      await expect(service.updateSnippetContent('34', '')).rejects.toThrow('HTML Content is required')
    })
  })

  // ── CRM Objects (shared methods) ──

  describe('describeOpportunity', () => {
    it('calls /opportunities/describe.json', async () => {
      mockToken()
      mock.onGet(`${ REST }/opportunities/describe.json`).reply({ ...OK, result: [] })

      await service.describeOpportunity()

      expect(mock.history[1].url).toBe(`${ REST }/opportunities/describe.json`)
    })
  })

  describe('syncOpportunities', () => {
    it('sends POST with records', async () => {
      mockToken()
      mock.onPost(`${ REST }/opportunities.json`).reply({ ...OK, result: [] })

      await service.syncOpportunities([{ externalOpportunityId: 'OPP-1' }], 'Create Only')

      const apiCall = mock.history.find(h => h.url.includes('/opportunities.json') && h.method === 'post')

      expect(apiCall.body).toMatchObject({ action: 'createOnly', input: [{ externalOpportunityId: 'OPP-1' }] })
    })

    it('throws when records are empty', async () => {
      await expect(service.syncOpportunities([])).rejects.toThrow('Records is required')
    })
  })

  describe('deleteCompanies', () => {
    it('sends POST to delete endpoint', async () => {
      mockToken()
      mock.onPost(`${ REST }/companies/delete.json`).reply({ ...OK, result: [] })

      await service.deleteCompanies([{ externalCompanyId: 'C-1' }], 'Dedupe Fields')

      const apiCall = mock.history.find(h => h.url.includes('/companies/delete.json'))

      expect(apiCall.body).toMatchObject({ input: [{ externalCompanyId: 'C-1' }], deleteBy: 'dedupeFields' })
    })
  })

  // ── Lead Lifecycle ──

  describe('mergeLeads', () => {
    it('sends POST with query params', async () => {
      mockToken()
      mock.onPost(`${ REST }/leads/100/merge.json`).reply(OK)

      await service.mergeLeads('100', ['200', '300'], true)

      const apiCall = mock.history.find(h => h.url.includes('/merge.json'))

      expect(apiCall.query).toMatchObject({ leadIds: '200,300', mergeInCRM: true })
    })

    it('throws when winning lead is missing', async () => {
      await expect(service.mergeLeads('', [])).rejects.toThrow('Winning Lead is required')
    })
  })

  describe('pushLead', () => {
    it('sends POST with correct body', async () => {
      mockToken()
      mock.onPost(`${ REST }/leads/push.json`).reply({ ...OK, result: [{ id: 100, status: 'created' }] })

      await service.pushLead('My Program', [{ email: 'a@test.com' }], 'Email', 'API', 'Test')

      const apiCall = mock.history.find(h => h.url.includes('/leads/push.json'))

      expect(apiCall.body).toMatchObject({
        programName: 'My Program',
        lookupField: 'email',
        input: [{ email: 'a@test.com' }],
        source: 'API',
        reason: 'Test',
      })
    })
  })

  describe('submitForm', () => {
    it('sends POST with form fields and visitor data', async () => {
      mockToken()
      mock.onPost(`${ REST }/leads/submitForm.json`).reply({ ...OK, result: [{ id: 100, status: 'updated' }] })

      await service.submitForm('1029', { email: 'a@test.com' }, 'cookie123', 'https://page.com', 'utm=test')

      const apiCall = mock.history.find(h => h.url.includes('/submitForm.json'))

      expect(apiCall.body).toMatchObject({
        formId: 1029,
        input: [{
          leadFormFields: { email: 'a@test.com' },
          cookie: 'cookie123',
          visitorData: { pageURL: 'https://page.com', queryString: 'utm=test' },
        }],
      })
    })

    it('throws when form fields is not an object', async () => {
      await expect(service.submitForm('1029', null)).rejects.toThrow('Form Fields is required')
    })
  })

  describe('associateLead', () => {
    it('sends POST with cookie query', async () => {
      mockToken()
      mock.onPost(`${ REST }/leads/100/associate.json`).reply(OK)

      await service.associateLead('100', 'cookie123')

      const apiCall = mock.history.find(h => h.url.includes('/associate.json'))

      expect(apiCall.query).toMatchObject({ cookie: 'cookie123' })
    })
  })

  // ── Bulk Export ──

  describe('bulk export lifecycle', () => {
    it('enqueueLeadExport sends POST', async () => {
      mockToken()
      mock.onPost(`${ BULK }/leads/export/job123/enqueue.json`).reply({ ...OK, result: [{ exportId: 'job123', status: 'Queued' }] })

      const result = await service.enqueueLeadExport('job123')

      expect(result.result[0].status).toBe('Queued')
    })

    it('getLeadExportStatus sends GET', async () => {
      mockToken()
      mock.onGet(`${ BULK }/leads/export/job123/status.json`).reply({ ...OK, result: [{ exportId: 'job123', status: 'Completed' }] })

      const result = await service.getLeadExportStatus('job123')

      expect(result.result[0].status).toBe('Completed')
    })

    it('cancelLeadExport sends POST', async () => {
      mockToken()
      mock.onPost(`${ BULK }/leads/export/job123/cancel.json`).reply({ ...OK, result: [{ exportId: 'job123', status: 'Cancelled' }] })

      const result = await service.cancelLeadExport('job123')

      expect(result.result[0].status).toBe('Cancelled')
    })

    it('getLeadExportFile sends GET and returns content', async () => {
      mockToken()
      mock.onGet(`${ BULK }/leads/export/job123/file.json`).reply('email,firstName\na@test.com,Test')

      const result = await service.getLeadExportFile('job123')

      expect(result.exportId).toBe('job123')
      expect(result.content).toContain('email')
    })

    it('throws when exportJob is missing', async () => {
      await expect(service.enqueueLeadExport('')).rejects.toThrow('Export Job is required')
      await expect(service.getLeadExportStatus('')).rejects.toThrow('Export Job is required')
    })
  })

  // ── Dictionaries ──

  describe('getListsDictionary', () => {
    it('maps lists to dictionary items', async () => {
      mockToken()

      mock.onGet(`${ REST }/lists.json`).reply({
        ...OK,
        result: [
          { id: 1027, name: 'My List', programName: 'Newsletter' },
          { id: 1028, name: 'Other List' },
        ],
      })

      const result = await service.getListsDictionary({})

      expect(result.items).toEqual([
        { label: 'My List', value: '1027', note: 'ID: 1027 · Newsletter' },
        { label: 'Other List', value: '1028', note: 'ID: 1028' },
      ])

      expect(result.cursor).toBeNull()
    })

    it('filters by search term', async () => {
      mockToken()

      mock.onGet(`${ REST }/lists.json`).reply({
        ...OK,
        result: [
          { id: 1027, name: 'My List' },
          { id: 1028, name: 'Other' },
        ],
      })

      const result = await service.getListsDictionary({ search: 'other' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('1028')
    })

    it('passes cursor as nextPageToken', async () => {
      mockToken()
      mock.onGet(`${ REST }/lists.json`).reply({ ...OK, result: [], nextPageToken: 'NEXT' })

      const result = await service.getListsDictionary({ cursor: 'PREV' })

      expect(mock.history[1].query).toMatchObject({ nextPageToken: 'PREV' })
      expect(result.cursor).toBe('NEXT')
    })

    it('handles null payload', async () => {
      mockToken()
      mock.onGet(`${ REST }/lists.json`).reply({ ...OK, result: [] })

      const result = await service.getListsDictionary(null)

      expect(result.items).toEqual([])
    })
  })

  describe('getCampaignsDictionary', () => {
    it('maps campaigns to dictionary items', async () => {
      mockToken()

      mock.onGet(`${ REST }/campaigns.json`).reply({
        ...OK,
        result: [{ id: 1069, name: 'Test Campaign', type: 'trigger' }],
      })

      const result = await service.getCampaignsDictionary({})

      expect(result.items[0]).toEqual({
        label: 'Test Campaign',
        value: '1069',
        note: 'trigger · ID: 1069',
      })
    })
  })

  describe('getActivityTypesDictionary', () => {
    it('maps activity types to dictionary items', async () => {
      mockToken()

      mock.onGet(`${ REST }/activities/types.json`).reply({
        ...OK,
        result: [{ id: 2, name: 'Fill Out Form', description: 'User fills out a form' }],
      })

      const result = await service.getActivityTypesDictionary({})

      expect(result.items[0]).toEqual({
        label: 'Fill Out Form',
        value: '2',
        note: 'User fills out a form',
      })

      expect(result.cursor).toBeNull()
    })
  })

  describe('getCustomObjectsDictionary', () => {
    it('maps custom objects to dictionary items', async () => {
      mockToken()

      mock.onGet(`${ REST }/customobjects.json`).reply({
        ...OK,
        result: [{ name: 'car_c', displayName: 'Car' }],
      })

      const result = await service.getCustomObjectsDictionary({})

      expect(result.items[0]).toEqual({
        label: 'Car',
        value: 'car_c',
        note: 'API name: car_c',
      })
    })

    it('filters by displayName and name', async () => {
      mockToken()

      mock.onGet(`${ REST }/customobjects.json`).reply({
        ...OK,
        result: [
          { name: 'car_c', displayName: 'Car' },
          { name: 'ticket_c', displayName: 'Support Ticket' },
        ],
      })

      const result = await service.getCustomObjectsDictionary({ search: 'ticket' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('ticket_c')
    })
  })

  describe('getProgramsDictionary', () => {
    it('maps programs to dictionary items via asset endpoint', async () => {
      mockToken()

      mock.onGet(`${ ASSET }/programs.json`).reply({
        ...OK,
        result: [{ id: 1107, name: 'Newsletter', type: 'Default' }],
      })

      const result = await service.getProgramsDictionary({})

      expect(result.items[0]).toEqual({
        label: 'Newsletter',
        value: '1107',
        note: 'Default · ID: 1107',
      })
    })

    it('returns cursor when page is full (200)', async () => {
      mockToken()
      const items = Array.from({ length: 200 }, (_, i) => ({ id: i, name: `P${ i }`, type: 'Default' }))

      mock.onGet(`${ ASSET }/programs.json`).reply({ ...OK, result: items })

      const result = await service.getProgramsDictionary({})

      expect(result.cursor).toBe('200')
    })

    it('returns null cursor when page is not full', async () => {
      mockToken()
      mock.onGet(`${ ASSET }/programs.json`).reply({ ...OK, result: [{ id: 1, name: 'P', type: 'Default' }] })

      const result = await service.getProgramsDictionary({})

      expect(result.cursor).toBeNull()
    })
  })

  describe('getFoldersDictionary', () => {
    it('returns folders using rootFolderId config', async () => {
      mockToken()

      mock.onGet(`${ ASSET }/folders.json`).reply({
        ...OK,
        result: [{ id: 1035, name: 'Marketing' }],
      })

      const result = await service.getFoldersDictionary({})

      expect(result.items[0]).toEqual({
        label: 'Marketing',
        value: '1035',
        note: 'Folder · ID: 1035',
      })

      expect(mock.history[1].query).toMatchObject({
        root: JSON.stringify({ id: 1035, type: 'Folder' }),
      })
    })

    it('returns empty items when rootFolderId is not configured', async () => {
      const origRoot = service.config.rootFolderId

      service.config.rootFolderId = ''

      const result = await service.getFoldersDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
      service.config.rootFolderId = origRoot
    })
  })

  describe('getSmartListsDictionary', () => {
    it('returns empty when rootFolderId is not configured', async () => {
      const origRoot = service.config.rootFolderId

      service.config.rootFolderId = ''

      const result = await service.getSmartListsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
      service.config.rootFolderId = origRoot
    })
  })

  // ── Triggers ──

  describe('onNewLead (polling trigger)', () => {
    it('anchors stream on first poll and returns no events', async () => {
      mockToken()
      mock.onGet(`${ REST }/activities/pagingtoken.json`).reply({ ...OK, nextPageToken: 'ANCHOR==' })

      const result = await service.onNewLead({ state: {} })

      expect(result.events).toEqual([])
      expect(result.state.nextPageToken).toBe('ANCHOR==')
    })

    it('returns activities on subsequent polls', async () => {
      mockToken()

      // Resolve the activity type
      mock.onGet(`${ REST }/activities/types.json`).reply({
        ...OK,
        result: [{ id: 12, name: 'New Lead' }],
      })

      mock.onGet(`${ REST }/activities.json`).reply({
        ...OK,
        result: [{ id: 1001, leadId: 100, activityTypeId: 12 }],
        nextPageToken: 'NEXT==',
        moreResult: false,
      })

      const result = await service.onNewLead({ state: { nextPageToken: 'PREV==' } })

      expect(result.events).toHaveLength(1)
      expect(result.events[0].activityTypeId).toBe(12)
      expect(result.state.nextPageToken).toBe('NEXT==')
    })
  })

  describe('onNewActivity (polling trigger)', () => {
    it('anchors on first poll', async () => {
      mockToken()
      mock.onGet(`${ REST }/activities/pagingtoken.json`).reply({ ...OK, nextPageToken: 'ANCHOR==' })

      const result = await service.onNewActivity({
        state: {},
        triggerData: { activityTypeIds: ['1'] },
      })

      expect(result.events).toEqual([])
      expect(result.state.nextPageToken).toBe('ANCHOR==')
    })

    it('throws when activity type IDs are missing', async () => {
      await expect(service.onNewActivity({
        state: { nextPageToken: 'TOK' },
        triggerData: {},
      })).rejects.toThrow('Activity Types is required')
    })
  })

  describe('onLeadFieldChange (polling trigger)', () => {
    it('anchors on first poll', async () => {
      mockToken()
      mock.onGet(`${ REST }/activities/pagingtoken.json`).reply({ ...OK, nextPageToken: 'ANCHOR==' })

      const result = await service.onLeadFieldChange({
        state: {},
        triggerData: { fields: ['email'] },
      })

      expect(result.events).toEqual([])
    })

    it('queries leadchanges on subsequent polls', async () => {
      mockToken()

      mock.onGet(`${ REST }/activities/leadchanges.json`).reply({
        ...OK,
        result: [{ id: 54, leadId: 100 }],
        nextPageToken: 'NEXT==',
        moreResult: false,
      })

      const result = await service.onLeadFieldChange({
        state: { nextPageToken: 'PREV==' },
        triggerData: { fields: ['email'], listId: '1027' },
      })

      expect(result.events).toHaveLength(1)

      const apiCall = mock.history.find(h => h.url.includes('/leadchanges.json'))

      expect(apiCall.query).toMatchObject({ fields: 'email', listId: '1027' })
    })

    it('throws when fields are missing', async () => {
      await expect(service.onLeadFieldChange({
        state: { nextPageToken: 'TOK' },
        triggerData: {},
      })).rejects.toThrow('Fields to Watch is required')
    })
  })

  describe('onDeletedLead (polling trigger)', () => {
    it('anchors on first poll', async () => {
      mockToken()
      mock.onGet(`${ REST }/activities/pagingtoken.json`).reply({ ...OK, nextPageToken: 'ANCHOR==' })

      const result = await service.onDeletedLead({ state: {} })

      expect(result.events).toEqual([])
    })

    it('queries deletedleads on subsequent polls', async () => {
      mockToken()

      mock.onGet(`${ REST }/activities/deletedleads.json`).reply({
        ...OK,
        result: [{ id: 999, leadId: 50 }],
        nextPageToken: 'NEXT==',
        moreResult: false,
      })

      const result = await service.onDeletedLead({ state: { nextPageToken: 'PREV==' } })

      expect(result.events).toHaveLength(1)
      expect(result.state.nextPageToken).toBe('NEXT==')
    })
  })

  // ── Error Handling ──

  describe('error handling', () => {
    it('surfaces Marketo API error messages', async () => {
      mockToken()

      mock.onGet(`${ REST }/leads/describe.json`).reply({
        success: false,
        errors: [{ code: '603', message: 'Access denied — the API user lacks permission' }],
      })

      await expect(service.describeLeadFields()).rejects.toThrow('Access denied')
    })

    it('surfaces error hints for known error codes', async () => {
      mockToken()

      mock.onGet(`${ REST }/leads/describe.json`).reply({
        success: false,
        errors: [{ code: '606', message: 'Rate limit exceeded' }],
      })

      await expect(service.describeLeadFields()).rejects.toThrow('Rate limit hit')
    })

    it('throws on HTTP error', async () => {
      mockToken()
      mock.onGet(`${ REST }/leads/describe.json`).replyWithError({ message: 'Internal Server Error' })

      await expect(service.describeLeadFields()).rejects.toThrow()
    })
  })

  // ==========================================================================
  //  EXTENDED COVERAGE
  // ==========================================================================

  // ── Auth: caching, refresh, token-exchange failures ──

  describe('access token lifecycle', () => {
    it('caches the token across calls and only exchanges once', async () => {
      mockToken()
      mock.onGet(`${ REST }/leads/describe.json`).reply({ ...OK, result: [] })
      mock.onGet(`${ REST }/activities/types.json`).reply({ ...OK, result: [] })

      await service.describeLeadFields()
      await service.getActivityTypes()

      const tokenCalls = mock.history.filter(h => h.url === TOKEN_URL)

      expect(tokenCalls).toHaveLength(1)
    })

    it('re-exchanges when the cached token is inside the expiry skew', async () => {
      mockToken()
      mock.onGet(`${ REST }/leads/describe.json`).reply({ ...OK, result: [] })

      // Expires in 5s — inside the 60s skew, so it must be refreshed.
      service._token = { token: 'stale', expiresAt: Date.now() + 5000 }

      await service.describeLeadFields()

      expect(mock.history[0].url).toBe(TOKEN_URL)
      expect(mock.history[1].headers.Authorization).toBe('Bearer mock-token-123')
    })

    it('reuses a token that is comfortably in-date', async () => {
      mock.onGet(`${ REST }/leads/describe.json`).reply({ ...OK, result: [] })

      service._token = { token: 'fresh', expiresAt: Date.now() + 600000 }

      await service.describeLeadFields()

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers.Authorization).toBe('Bearer fresh')
    })

    it('defaults expires_in to 3600 when absent', async () => {
      mock.onGet(TOKEN_URL).reply({ access_token: 'no-expiry' })
      mock.onGet(`${ REST }/leads/describe.json`).reply({ ...OK, result: [] })

      const before = Date.now()

      await service.describeLeadFields()

      expect(service._token.token).toBe('no-expiry')
      expect(service._token.expiresAt).toBeGreaterThanOrEqual(before + 3600 * 1000 - 50)
    })

    it('throws when the token exchange returns no access_token', async () => {
      mock.onGet(TOKEN_URL).reply({ token_type: 'bearer' })

      await expect(service.describeLeadFields()).rejects.toThrow('Token exchange returned no access_token')
    })

    it('throws when the token exchange returns an empty body', async () => {
      mock.onGet(TOKEN_URL).reply(undefined)

      await expect(service.describeLeadFields()).rejects.toThrow('Token exchange returned no access_token')
    })

    it('surfaces an HTTP failure from the token endpoint', async () => {
      mock.onGet(TOKEN_URL).replyWithError({ message: 'unauthorized_client' })

      await expect(service.describeLeadFields()).rejects.toThrow('unauthorized_client')
    })

    it('refreshes on a 602 token error and retries once', async () => {
      mockToken()

      mock.onGet(`${ REST }/leads/describe.json`).replyWith(() => {
        const apiCalls = mock.history.filter(h => h.url.includes('/leads/describe.json'))

        if (apiCalls.length <= 1) {
          return { success: false, errors: [{ code: 602, message: 'Access token expired' }] }
        }

        return { ...OK, result: [{ id: 1 }] }
      })

      const result = await service.describeLeadFields()

      expect(result.result[0].id).toBe(1)
      expect(mock.history.filter(h => h.url === TOKEN_URL)).toHaveLength(2)
    })

    it('does not retry a second time — a persistent token error surfaces', async () => {
      mockToken()

      mock.onGet(`${ REST }/leads/describe.json`).reply({
        success: false,
        errors: [{ code: '601', message: 'Access token invalid' }],
      })

      await expect(service.describeLeadFields()).rejects.toThrow('Access token invalid')
    })
  })

  // ── Error shaping ──

  describe('error shaping', () => {
    it.each([
      ['body.errors[0].message', { body: { errors: [{ message: 'from errors array' }] } }, 'from errors array'],
      ['body.error.message', { body: { error: { message: 'from error object' } } }, 'from error object'],
      ['body.message', { body: { message: 'from body message' } }, 'from body message'],
      ['error.message', { message: 'from error message' }, 'from error message'],
    ])('prefers %s', async (_label, errorShape, expected) => {
      mockToken()
      mock.onGet(`${ REST }/leads/describe.json`).replyWithError({ message: 'fallback', ...errorShape })

      await expect(service.describeLeadFields()).rejects.toThrow(expected)
    })

    it('falls back to a generic message when success:false has no errors', async () => {
      mockToken()
      mock.onGet(`${ REST }/leads/describe.json`).reply({ success: false })

      await expect(service.describeLeadFields()).rejects.toThrow('Marketo request failed.')
    })

    it('uses the raw message for an unmapped error code', async () => {
      mockToken()

      mock.onGet(`${ REST }/leads/describe.json`).reply({
        success: false,
        errors: [{ code: '9999', message: 'Something exotic happened' }],
      })

      await expect(service.describeLeadFields()).rejects.toThrow('Something exotic happened')
    })

    it('combines the hint and the API message for a mapped code', async () => {
      mockToken()

      mock.onGet(`${ REST }/leads/describe.json`).reply({
        success: false,
        errors: [{ code: 610, message: 'Requested resource not found' }],
      })

      await expect(service.describeLeadFields()).rejects.toThrow(
        'Requested resource not found — verify the ID or API name. (Requested resource not found)'
      )
    })

    it('attaches the Marketo code to the thrown error', async () => {
      mockToken()
      mock.onGet(`${ REST }/leads/describe.json`).reply({ success: false, errors: [{ code: 1004 }] })

      await expect(service.describeLeadFields()).rejects.toMatchObject({ marketoCode: '1004' })
    })
  })

  // ── Choice mapping & list coercion helpers (exercised through public methods) ──

  describe('choice mapping and list coercion', () => {
    it.each([
      ['Create or Update', 'createOrUpdate'],
      ['Create Only', 'createOnly'],
      ['Update Only', 'updateOnly'],
      ['Create Duplicate', 'createDuplicate'],
      ['createDuplicate', 'createDuplicate'],
    ])('maps action label %s to %s', async (label, apiValue) => {
      mockToken()
      mock.onPost(`${ REST }/leads.json`).reply(OK)

      await service.syncLeads([{ id: 1 }], label)

      const call = mock.history.find(h => h.method === 'post')

      expect(call.body.action).toBe(apiValue)
    })

    it.each([
      ['Email', 'email'],
      ['Marketo ID', 'id'],
      ['Cookie', 'cookies'],
      ['myCustomField', 'myCustomField'],
    ])('maps lookup field %s to %s', async (label, apiValue) => {
      mockToken()
      mock.onPost(`${ REST }/leads.json`).reply(OK)

      await service.syncLeads([{ id: 1 }], undefined, label)

      const call = mock.history.find(h => h.method === 'post')

      expect(call.body.lookupField).toBe(apiValue)
    })

    it('accepts a comma-separated string wherever an array is expected', async () => {
      mockToken()
      mock.onPost(`${ REST }/leads/delete.json`).reply(OK)

      await service.deleteLeads('235, 766 ,')

      const call = mock.history.find(h => h.url.includes('/leads/delete.json'))

      expect(call.body).toEqual({ input: [{ id: 235 }, { id: 766 }] })
    })

    it('keeps non-numeric IDs as strings', async () => {
      mockToken()
      mock.onPost(`${ REST }/leads/delete.json`).reply(OK)

      await service.deleteLeads(['abc'])

      const call = mock.history.find(h => h.url.includes('/leads/delete.json'))

      expect(call.body).toEqual({ input: [{ id: 'abc' }] })
    })

    it('treats a null list as empty', async () => {
      await expect(service.deleteLeads(null)).rejects.toThrow('Lead IDs is required')
    })
  })

  // ── Asset API: GET reads ──

  describe('asset API reads', () => {
    it.each([
      ['getFolderById', ['1035'], `${ ASSET }/folder/1035.json`, { type: 'Folder' }],
      ['getFolderById', ['1035', 'Program'], `${ ASSET }/folder/1035.json`, { type: 'Program' }],
      ['getTokensByFolder', ['1035'], `${ ASSET }/folder/1035/tokens.json`, { folderType: 'Folder' }],
      ['getTokensByFolder', ['1107', 'Program'], `${ ASSET }/folder/1107/tokens.json`, { folderType: 'Program' }],
      ['getEmailContent', ['1356', 'Approved'], `${ ASSET }/email/1356/content.json`, { status: 'approved' }],
      ['getEmailContent', ['1356'], `${ ASSET }/email/1356/content.json`, {}],
      ['getFormById', ['1029'], `${ ASSET }/form/1029.json`, {}],
      ['getLandingPageById', ['500'], `${ ASSET }/landingPage/500.json`, {}],
      ['getLandingPageContent', ['500'], `${ ASSET }/landingPage/500/content.json`, {}],
      ['getSmartListById', ['77', true], `${ ASSET }/smartList/77.json`, { includeRules: true }],
      ['getSmartListById', ['77'], `${ ASSET }/smartList/77.json`, {}],
      ['getSnippetContent', ['33'], `${ ASSET }/snippet/33/content.json`, {}],
    ])('%s issues GET %s', async (methodName, args, url, query) => {
      mockToken()
      mock.onGet(url).reply({ ...OK, result: [{ id: 1 }] })

      const result = await service[methodName](...args)

      expect(result.success).toBe(true)

      const call = mock.history.find(h => h.url === url)

      expect(call.method).toBe('get')
      expect(call.query).toEqual(query)
    })

    it('browseEmails sends an empty query when no filters are supplied', async () => {
      mockToken()
      mock.onGet(`${ ASSET }/emails.json`).reply({ ...OK, result: [] })

      await service.browseEmails()

      expect(mock.history[1].query).toEqual({})
    })

    it('browseForms sends an empty query when no filters are supplied', async () => {
      mockToken()
      mock.onGet(`${ ASSET }/forms.json`).reply({ ...OK, result: [] })

      await service.browseForms()

      expect(mock.history[1].query).toEqual({})
    })

    it('browseLandingPages sends an empty query when no filters are supplied', async () => {
      mockToken()
      mock.onGet(`${ ASSET }/landingPages.json`).reply({ ...OK, result: [] })

      await service.browseLandingPages()

      expect(mock.history[1].query).toEqual({})
    })

    it('browsePrograms sends an empty query when no filters are supplied', async () => {
      mockToken()
      mock.onGet(`${ ASSET }/programs.json`).reply({ ...OK, result: [] })

      await service.browsePrograms()

      expect(mock.history[1].query).toEqual({})
    })

    it.each([
      ['On', 'on'],
      ['Off', 'off'],
      ['Unlocked', 'unlocked'],
      ['somethingElse', 'somethingElse'],
    ])('browsePrograms maps status %s to %s', async (label, apiValue) => {
      mockToken()
      mock.onGet(`${ ASSET }/programs.json`).reply({ ...OK, result: [] })

      await service.browsePrograms(label)

      expect(mock.history[1].query.status).toBe(apiValue)
    })

    it('browseFolders omits optional paging params', async () => {
      mockToken()
      mock.onGet(`${ ASSET }/folders.json`).reply({ ...OK, result: [] })

      await service.browseFolders('1035')

      expect(mock.history[1].query).toEqual({ root: JSON.stringify({ id: 1035, type: 'Folder' }) })
    })

    it('browseSmartLists omits optional paging params', async () => {
      mockToken()
      mock.onGet(`${ ASSET }/smartLists.json`).reply({ ...OK, result: [] })

      await service.browseSmartLists('1035')

      expect(mock.history[1].query).toEqual({ folder: JSON.stringify({ id: 1035, type: 'Folder' }) })
    })

    it('folder refs keep a non-numeric id verbatim', async () => {
      mockToken()
      mock.onGet(`${ ASSET }/folders.json`).reply({ ...OK, result: [] })

      await service.browseFolders('root-alias')

      expect(mock.history[1].query.root).toBe(JSON.stringify({ id: 'root-alias', type: 'Folder' }))
    })
  })

  // ── Asset API: bodyless POST lifecycle operations ──

  describe('asset API approve / unapprove / delete operations', () => {
    it.each([
      ['approveEmailProgram', ['1107'], `${ ASSET }/program/1107/approve.json`],
      ['unapproveEmailProgram', ['1107'], `${ ASSET }/program/1107/unapprove.json`],
      ['deleteEmail', ['1356'], `${ ASSET }/email/1356/delete.json`],
      ['approveEmail', ['1356'], `${ ASSET }/email/1356/approveDraft.json`],
      ['unapproveEmail', ['1356'], `${ ASSET }/email/1356/unapprove.json`],
      ['approveForm', ['1029'], `${ ASSET }/form/1029/approve.json`],
      ['unapproveForm', ['1029'], `${ ASSET }/form/1029/unapprove.json`],
      ['deleteForm', ['1029'], `${ ASSET }/form/1029/delete.json`],
      ['approveLandingPage', ['500'], `${ ASSET }/landingPage/500/approve.json`],
      ['unapproveLandingPage', ['500'], `${ ASSET }/landingPage/500/unapprove.json`],
      ['deleteLandingPage', ['500'], `${ ASSET }/landingPage/500/delete.json`],
      ['deleteSmartList', ['77'], `${ ASSET }/smartList/77/delete.json`],
      ['approveSnippetDraft', ['33'], `${ ASSET }/snippet/33/approveDraft.json`],
      ['deleteSnippet', ['33'], `${ ASSET }/snippet/33/delete.json`],
    ])('%s issues POST %s', async (methodName, args, url) => {
      mockToken()
      mock.onPost(url).reply({ ...OK, result: [{ id: 1 }] })

      const result = await service[methodName](...args)

      expect(result.success).toBe(true)

      const call = mock.history.find(h => h.url === url)

      expect(call.method).toBe('post')
      expect(call.body).toBeUndefined()
    })
  })

  // ── Asset API: form-encoded writes ──

  describe('asset API form-encoded writes', () => {
    it.each([
      [
        'updateProgram', ['1107', 'Renamed', 'Desc'], `${ ASSET }/program/1107.json`,
        ['name=Renamed', 'description=Desc'],
      ],
      [
        'cloneProgram', ['1107', 'Copy', '1035', 'Desc'], `${ ASSET }/program/1107/clone.json`,
        ['name=Copy', 'folder=%7B%22id%22%3A1035', 'description=Desc'],
      ],
      [
        'updateFolder', ['1035', 'Program', 'Renamed', 'Desc', true], `${ ASSET }/folder/1035.json`,
        ['type=Program', 'name=Renamed', 'description=Desc', 'isArchive=true'],
      ],
      [
        'updateFolder', ['1035'], `${ ASSET }/folder/1035.json`,
        ['type=Folder'],
      ],
      [
        'deleteFolder', ['1035'], `${ ASSET }/folder/1035/delete.json`,
        ['type=Folder'],
      ],
      [
        'deleteFolder', ['1035', 'Program'], `${ ASSET }/folder/1035/delete.json`,
        ['type=Program'],
      ],
      [
        'createToken', ['1107', 'Program', 'my.Title', 'Rich Text', 'Hello'], `${ ASSET }/folder/1107/tokens.json`,
        ['name=my.Title', 'type=rich%20text', 'value=Hello', 'folderType=Program'],
      ],
      [
        'createToken', ['1107', undefined, 'my.Score', 'Score', '0'], `${ ASSET }/folder/1107/tokens.json`,
        ['type=score', 'folderType=Folder'],
      ],
      [
        'deleteToken', ['1107', 'Program', 'my.Title', 'Text'], `${ ASSET }/folder/1107/tokens/delete.json`,
        ['name=my.Title', 'type=text', 'folderType=Program'],
      ],
      [
        'updateEmail', ['1356', 'Renamed', 'Desc'], `${ ASSET }/email/1356.json`,
        ['name=Renamed', 'description=Desc'],
      ],
      [
        'cloneEmail', ['1356', 'Copy', '1035', 'Desc'], `${ ASSET }/email/1356/clone.json`,
        ['name=Copy', 'folder=%7B%22id%22%3A1035', 'description=Desc'],
      ],
      [
        'createForm', ['Signup', '1035', 'Desc', 'English', 'simple', true], `${ ASSET }/forms.json`,
        ['name=Signup', 'description=Desc', 'language=English', 'theme=simple', 'progressiveProfiling=true'],
      ],
      [
        'createForm', ['Signup', '1035'], `${ ASSET }/forms.json`,
        ['name=Signup', 'folder=%7B%22id%22%3A1035'],
      ],
      [
        'updateForm', ['1029', 'Renamed', 'Desc', false], `${ ASSET }/form/1029.json`,
        ['name=Renamed', 'description=Desc', 'progressiveProfiling=false'],
      ],
      [
        'cloneForm', ['1029', 'Copy', '1035', 'Desc'], `${ ASSET }/form/1029/clone.json`,
        ['name=Copy', 'folder=%7B%22id%22%3A1035'],
      ],
      [
        'createLandingPage', ['LP', '12', '1035', 'Title', 'Desc', true], `${ ASSET }/landingPages.json`,
        ['name=LP', 'template=12', 'title=Title', 'description=Desc', 'mobileEnabled=true'],
      ],
      [
        'createLandingPage', ['LP', '12', '1035'], `${ ASSET }/landingPages.json`,
        ['name=LP', 'template=12'],
      ],
      [
        'updateLandingPage', ['500', 'Title', 'Desc', false], `${ ASSET }/landingPage/500.json`,
        ['title=Title', 'description=Desc', 'mobileEnabled=false'],
      ],
      [
        'cloneLandingPage', ['500', 'Copy', '1035', '12', 'Desc'], `${ ASSET }/landingPage/500/clone.json`,
        ['name=Copy', 'template=12', 'description=Desc'],
      ],
      [
        'cloneSmartList', ['77', 'Copy', '1035', 'Desc'], `${ ASSET }/smartList/77/clone.json`,
        ['name=Copy', 'folder=%7B%22id%22%3A1035', 'description=Desc'],
      ],
      [
        'updateSnippet', ['33', 'Renamed', 'Desc'], `${ ASSET }/snippet/33.json`,
        ['name=Renamed', 'description=Desc'],
      ],
      [
        'updateSnippet', ['33'], `${ ASSET }/snippet/33.json`,
        [],
      ],
    ])('%s posts a form-encoded body to %s', async (methodName, args, url, fragments) => {
      mockToken()
      mock.onPost(url).reply({ ...OK, result: [{ id: 1 }] })

      await service[methodName](...args)

      const call = mock.history.find(h => h.url === url && h.method === 'post')

      expect(call.headers['Content-Type']).toBe('application/x-www-form-urlencoded')
      expect(typeof call.body).toBe('string')
      fragments.forEach(fragment => expect(call.body).toContain(fragment))
    })

    it('sendSampleEmail omits optional fields when not supplied', async () => {
      mockToken()
      mock.onPost(`${ ASSET }/email/1356/sendSample.json`).reply(OK)

      await service.sendSampleEmail('1356', 'a@test.com')

      const call = mock.history.find(h => h.url.includes('/sendSample.json'))

      expect(call.body).toBe('emailAddress=a%40test.com')
    })

    it('createProgram omits description when not supplied', async () => {
      mockToken()
      mock.onPost(`${ ASSET }/programs.json`).reply(OK)

      await service.createProgram('P', '1035', 'Default', 'Email Blast')

      const call = mock.history.find(h => h.url.includes('/programs.json') && h.method === 'post')

      expect(call.body).not.toContain('description')
    })

    it('createSnippet omits description when not supplied', async () => {
      mockToken()
      mock.onPost(`${ ASSET }/snippets.json`).reply(OK)

      await service.createSnippet('S', '1035')

      const call = mock.history.find(h => h.url.includes('/snippets.json') && h.method === 'post')

      expect(call.body).not.toContain('description')
    })

    it('createFolder omits description when not supplied', async () => {
      mockToken()
      mock.onPost(`${ ASSET }/folders.json`).reply(OK)

      await service.createFolder('F', '1035')

      const call = mock.history.find(h => h.url.includes('/folders.json') && h.method === 'post')

      expect(call.body).not.toContain('description')
    })

    it('createEmail omits every optional field when not supplied', async () => {
      mockToken()
      mock.onPost(`${ ASSET }/emails.json`).reply(OK)

      await service.createEmail('E', '24', '1035')

      const call = mock.history.find(h => h.url.includes('/emails.json') && h.method === 'post')

      expect(call.body).toBe(`name=E&template=24&folder=${ encodeURIComponent(JSON.stringify({ id: 1035, type: 'Folder' })) }`)
    })

    it('updateSnippetContent posts the HTML content with type HTML', async () => {
      mockToken()
      mock.onPost(`${ ASSET }/snippet/33/content.json`).reply(OK)

      await service.updateSnippetContent('33', '<p>Hi</p>')

      const call = mock.history.find(h => h.url.includes('/content.json'))

      expect(call.body).toBe('content=%3Cp%3EHi%3C%2Fp%3E&type=HTML')
    })
  })

  // ── CRM object families ──

  describe('CRM object families', () => {
    const FAMILIES = [
      ['Opportunity', 'Opportunities', 'opportunities'],
      ['OpportunityRole', 'OpportunityRoles', 'opportunities/roles'],
      ['Company', 'Companies', 'companies'],
      ['SalesPerson', 'SalesPersons', 'salespersons'],
      ['NamedAccount', 'NamedAccounts', 'namedaccounts'],
    ]

    it.each(FAMILIES)('describe%s issues GET /%s/describe.json', async (singular, _plural, family) => {
      mockToken()
      mock.onGet(`${ REST }/${ family }/describe.json`).reply({ ...OK, result: [] })

      await service[`describe${ singular }`]()

      expect(mock.history[1].url).toBe(`${ REST }/${ family }/describe.json`)
    })

    it.each(FAMILIES)('query%2$s issues GET /%3$s.json with mapped filters', async (_singular, plural, family) => {
      mockToken()
      mock.onGet(`${ REST }/${ family }.json`).reply({ ...OK, result: [] })

      await service[`query${ plural }`]('Marketo ID', ['1', '2'], ['a', 'b'], 25, 'TOK')

      const call = mock.history.find(h => h.url === `${ REST }/${ family }.json`)

      expect(call.query).toEqual({
        filterType: 'id',
        filterValues: '1,2',
        fields: 'a,b',
        batchSize: 25,
        nextPageToken: 'TOK',
      })
    })

    it.each(FAMILIES)('query%2$s omits optional params', async (_singular, plural, family) => {
      mockToken()
      mock.onGet(`${ REST }/${ family }.json`).reply({ ...OK, result: [] })

      await service[`query${ plural }`]('externalId', 'X-1')

      const call = mock.history.find(h => h.url === `${ REST }/${ family }.json`)

      expect(call.query).toEqual({ filterType: 'externalId', filterValues: 'X-1' })
    })

    it.each(FAMILIES)('sync%2$s posts records to /%3$s.json', async (_singular, plural, family) => {
      mockToken()
      mock.onPost(`${ REST }/${ family }.json`).reply({ ...OK, result: [] })

      await service[`sync${ plural }`]([{ externalId: 'X-1' }], 'Update Only', 'ID Field')

      const call = mock.history.find(h => h.url === `${ REST }/${ family }.json` && h.method === 'post')

      expect(call.body).toEqual({ action: 'updateOnly', input: [{ externalId: 'X-1' }], dedupeBy: 'idField' })
    })

    it.each(FAMILIES)('sync%2$s defaults the action and omits dedupeBy', async (_singular, plural, family) => {
      mockToken()
      mock.onPost(`${ REST }/${ family }.json`).reply({ ...OK, result: [] })

      await service[`sync${ plural }`]([{ externalId: 'X-1' }])

      const call = mock.history.find(h => h.url === `${ REST }/${ family }.json` && h.method === 'post')

      expect(call.body).toEqual({ action: 'createOrUpdate', input: [{ externalId: 'X-1' }] })
    })

    it.each(FAMILIES)('delete%2$s posts records to /%3$s/delete.json', async (_singular, plural, family) => {
      mockToken()
      mock.onPost(`${ REST }/${ family }/delete.json`).reply({ ...OK, result: [] })

      await service[`delete${ plural }`]([{ externalId: 'X-1' }])

      const call = mock.history.find(h => h.url === `${ REST }/${ family }/delete.json`)

      expect(call.body).toEqual({ input: [{ externalId: 'X-1' }] })
    })

    it.each(FAMILIES)('delete%2$s rejects an empty record set', async (_singular, plural) => {
      await expect(service[`delete${ plural }`]([])).rejects.toThrow('Records is required')
    })

    it.each(FAMILIES)('sync%2$s rejects a non-array record set', async (_singular, plural) => {
      await expect(service[`sync${ plural }`]('not-an-array')).rejects.toThrow('Records is required')
    })

    it.each(FAMILIES)('query%2$s rejects a missing filter field', async (_singular, plural) => {
      await expect(service[`query${ plural }`]('')).rejects.toThrow('Filter Field is required')
    })

    it.each(FAMILIES)('query%2$s rejects empty filter values', async (_singular, plural) => {
      await expect(service[`query${ plural }`]('Email', [])).rejects.toThrow('Filter Values is required')
    })
  })

  // ── Bulk: lead import ──

  describe('importLeads', () => {
    const FILE_URL = 'https://files.example.com/leads.csv'

    it('streams the file as multipart and sends the mapped query', async () => {
      mockToken()
      mock.onGet(FILE_URL).reply('email\na@test.com')
      mock.onPost(`${ BULK }/leads.json`).reply({ ...OK, result: [{ batchId: 1, status: 'Queued' }] })

      const result = await service.importLeads(FILE_URL, 'TSV', 'Marketo ID', '1027', 'Partition A')

      expect(result.result[0].status).toBe('Queued')

      const call = mock.history.find(h => h.url === `${ BULK }/leads.json`)

      expect(call.query).toEqual({ lookupField: 'id', listId: '1027', partitionName: 'Partition A' })
      expect(call.formData._fields.map(f => f.name)).toEqual(['format', 'file'])
      expect(call.formData._fields[0].value).toBe('tsv')
      expect(call.formData._fields[1].filename).toEqual({ filename: 'leads.tsv' })
      expect(Buffer.isBuffer(call.formData._fields[1].value)).toBe(true)
    })

    it('defaults the format to csv and omits optional query params', async () => {
      mockToken()
      mock.onGet(FILE_URL).reply('email\na@test.com')
      mock.onPost(`${ BULK }/leads.json`).reply(OK)

      await service.importLeads(FILE_URL)

      const call = mock.history.find(h => h.url === `${ BULK }/leads.json`)

      expect(call.query).toEqual({})
      expect(call.formData._fields[0].value).toBe('csv')
    })

    it('passes an already-buffered file through unchanged', async () => {
      mockToken()

      const buffer = Buffer.from('email\nb@test.com')

      mock.onGet(FILE_URL).reply(buffer)
      mock.onPost(`${ BULK }/leads.json`).reply(OK)

      await service.importLeads(FILE_URL)

      const call = mock.history.find(h => h.url === `${ BULK }/leads.json`)

      expect(call.formData._fields[1].value).toBe(buffer)
    })

    it('surfaces a Marketo success:false body', async () => {
      mockToken()
      mock.onGet(FILE_URL).reply('email\na@test.com')

      mock.onPost(`${ BULK }/leads.json`).reply({
        success: false,
        errors: [{ code: '1003', message: 'Invalid columns' }],
      })

      await expect(service.importLeads(FILE_URL)).rejects.toThrow('Invalid data')
    })

    it('surfaces an HTTP failure', async () => {
      mockToken()
      mock.onGet(FILE_URL).reply('email\na@test.com')
      mock.onPost(`${ BULK }/leads.json`).replyWithError({ message: 'Bad Gateway' })

      await expect(service.importLeads(FILE_URL)).rejects.toThrow('Bad Gateway')
    })

    it('throws when the file URL is missing', async () => {
      await expect(service.importLeads('')).rejects.toThrow('File is required')
    })
  })

  describe('import batch status endpoints', () => {
    it('getImportLeadStatus issues GET on the bulk batch endpoint', async () => {
      mockToken()
      mock.onGet(`${ BULK }/leads/batch/B1.json`).reply({ ...OK, result: [{ batchId: 1, status: 'Complete' }] })

      const result = await service.getImportLeadStatus('B1')

      expect(result.result[0].status).toBe('Complete')
    })

    it('getImportLeadFailures returns the CSV payload', async () => {
      mockToken()
      mock.onGet(`${ BULK }/leads/batch/B1/failures.json`).reply('email,reason\na@test.com,bad')

      const result = await service.getImportLeadFailures('B1')

      expect(result).toEqual({ batchId: 'B1', csv: 'email,reason\na@test.com,bad' })
    })

    it('getImportLeadWarnings normalizes an empty payload to an empty string', async () => {
      mockToken()
      mock.onGet(`${ BULK }/leads/batch/B1/warnings.json`).reply(undefined)

      const result = await service.getImportLeadWarnings('B1')

      expect(result).toEqual({ batchId: 'B1', csv: '' })
    })

    it.each([
      ['getImportLeadStatus'],
      ['getImportLeadFailures'],
      ['getImportLeadWarnings'],
    ])('%s throws when the batch is missing', async methodName => {
      await expect(service[methodName]('')).rejects.toThrow('Import Batch is required')
    })
  })

  // ── Bulk: export jobs ──

  describe('createLeadExport', () => {
    it('builds a filter with a static list and a mapped date window', async () => {
      mockToken()
      mock.onPost(`${ BULK }/leads/export/create.json`).reply({ ...OK, result: [{ exportId: 'e1' }] })

      await service.createLeadExport(['email', 'firstName'], 'TSV', 'Updated At', '2025-01-01', '2025-02-01', '1027')

      const call = mock.history.find(h => h.url === `${ BULK }/leads/export/create.json`)

      expect(call.body).toEqual({
        fields: ['email', 'firstName'],
        format: 'TSV',
        filter: { staticListId: 1027, updatedAt: { startAt: '2025-01-01', endAt: '2025-02-01' } },
      })
    })

    it('defaults the filter key to createdAt and the format to CSV', async () => {
      mockToken()
      mock.onPost(`${ BULK }/leads/export/create.json`).reply(OK)

      await service.createLeadExport('email', undefined, undefined, '2025-01-01')

      const call = mock.history.find(h => h.url === `${ BULK }/leads/export/create.json`)

      expect(call.body).toEqual({
        fields: ['email'],
        format: 'CSV',
        filter: { createdAt: { startAt: '2025-01-01' } },
      })
    })

    it('sends an empty filter when no window or list is supplied', async () => {
      mockToken()
      mock.onPost(`${ BULK }/leads/export/create.json`).reply(OK)

      await service.createLeadExport(['email'])

      const call = mock.history.find(h => h.url === `${ BULK }/leads/export/create.json`)

      expect(call.body.filter).toEqual({})
    })

    it('keeps a non-numeric static list id verbatim', async () => {
      mockToken()
      mock.onPost(`${ BULK }/leads/export/create.json`).reply(OK)

      await service.createLeadExport(['email'], 'CSV', undefined, undefined, undefined, 'list-alias')

      const call = mock.history.find(h => h.url === `${ BULK }/leads/export/create.json`)

      expect(call.body.filter).toEqual({ staticListId: 'list-alias' })
    })

    it('throws when fields are empty', async () => {
      await expect(service.createLeadExport([])).rejects.toThrow('Fields is required')
    })
  })

  describe('createActivityExport', () => {
    it('builds the createdAt window and numeric activity type IDs', async () => {
      mockToken()
      mock.onPost(`${ BULK }/activities/export/create.json`).reply({ ...OK, result: [{ exportId: 'a1' }] })

      await service.createActivityExport(['leadId', 'activityDate'], 'CSV', '2025-01-01', '2025-02-01', ['1', '2'])

      const call = mock.history.find(h => h.url === `${ BULK }/activities/export/create.json`)

      expect(call.body).toEqual({
        fields: ['leadId', 'activityDate'],
        format: 'CSV',
        filter: { createdAt: { startAt: '2025-01-01', endAt: '2025-02-01' }, activityTypeIds: [1, 2] },
      })
    })

    it('omits activityTypeIds when none are supplied', async () => {
      mockToken()
      mock.onPost(`${ BULK }/activities/export/create.json`).reply(OK)

      await service.createActivityExport(['leadId'], undefined, '2025-01-01', '2025-02-01')

      const call = mock.history.find(h => h.url === `${ BULK }/activities/export/create.json`)

      expect(call.body.filter.activityTypeIds).toBeUndefined()
      expect(call.body.format).toBe('CSV')
    })

    it.each([
      [[[], 'CSV', 's', 'e'], 'Fields is required'],
      [[['leadId'], 'CSV', '', 'e'], 'Start is required'],
      [[['leadId'], 'CSV', 's', ''], 'End is required'],
    ])('rejects invalid input %#', async (args, message) => {
      await expect(service.createActivityExport(...args)).rejects.toThrow(message)
    })
  })

  describe('activity export lifecycle', () => {
    it.each([
      ['enqueueActivityExport', 'post', `${ BULK }/activities/export/a1/enqueue.json`],
      ['getActivityExportStatus', 'get', `${ BULK }/activities/export/a1/status.json`],
      ['cancelActivityExport', 'post', `${ BULK }/activities/export/a1/cancel.json`],
    ])('%s issues %s %s', async (methodName, httpMethod, url) => {
      mockToken()
      mock.on(httpMethod, url).reply({ ...OK, result: [{ exportId: 'a1' }] })

      const result = await service[methodName]('a1')

      expect(result.result[0].exportId).toBe('a1')

      const call = mock.history.find(h => h.url === url)

      expect(call.method).toBe(httpMethod)
    })

    it('getActivityExportFile returns the file content', async () => {
      mockToken()
      mock.onGet(`${ BULK }/activities/export/a1/file.json`).reply('leadId,activityDate\n1,2025')

      const result = await service.getActivityExportFile('a1')

      expect(result).toEqual({ exportId: 'a1', content: 'leadId,activityDate\n1,2025' })
    })

    it('getLeadExportFile normalizes an empty payload', async () => {
      mockToken()
      mock.onGet(`${ BULK }/leads/export/e1/file.json`).reply(undefined)

      const result = await service.getLeadExportFile('e1')

      expect(result).toEqual({ exportId: 'e1', content: '' })
    })

    it.each([
      ['enqueueActivityExport'],
      ['getActivityExportStatus'],
      ['getActivityExportFile'],
      ['cancelActivityExport'],
      ['getLeadExportFile'],
      ['cancelLeadExport'],
    ])('%s throws when the export job is missing', async methodName => {
      await expect(service[methodName]('')).rejects.toThrow('Export Job is required')
    })
  })

  // ── Asset dictionaries ──

  describe('asset dictionaries', () => {
    it.each([
      ['getEmailsDictionary', `${ ASSET }/emails.json`, { id: 1, name: 'Welcome', status: 'approved' }, 'approved · ID: 1'],
      ['getEmailsDictionary', `${ ASSET }/emails.json`, { id: 1, name: 'Welcome' }, 'email · ID: 1'],
      ['getFormsDictionary', `${ ASSET }/forms.json`, { id: 2, name: 'Signup', status: 'draft' }, 'draft · ID: 2'],
      ['getFormsDictionary', `${ ASSET }/forms.json`, { id: 2, name: 'Signup' }, 'form · ID: 2'],
      ['getLandingPagesDictionary', `${ ASSET }/landingPages.json`, { id: 3, name: 'LP', status: 'approved' }, 'approved · ID: 3'],
      ['getLandingPagesDictionary', `${ ASSET }/landingPages.json`, { id: 3, name: 'LP' }, 'page · ID: 3'],
      ['getProgramsDictionary', `${ ASSET }/programs.json`, { id: 4, name: 'Prog' }, 'Program · ID: 4'],
    ])('%s maps %#', async (methodName, url, record, note) => {
      mockToken()
      mock.onGet(url).reply({ ...OK, result: [record] })

      const result = await service[methodName]({})

      expect(result.items).toEqual([{ label: record.name, value: String(record.id), note }])
      expect(result.cursor).toBeNull()
    })

    it.each([
      ['getEmailsDictionary', `${ ASSET }/emails.json`],
      ['getFormsDictionary', `${ ASSET }/forms.json`],
      ['getLandingPagesDictionary', `${ ASSET }/landingPages.json`],
      ['getProgramsDictionary', `${ ASSET }/programs.json`],
    ])('%s filters by search and honours the offset cursor', async (methodName, url) => {
      mockToken()

      mock.onGet(url).reply({
        ...OK,
        result: [{ id: 1, name: 'Alpha' }, { id: 2, name: 'Beta' }],
      })

      const result = await service[methodName]({ search: 'BET', cursor: '400' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('2')
      expect(mock.history[1].query).toMatchObject({ maxReturn: 200, offset: 400 })
    })

    it.each([
      ['getEmailsDictionary', `${ ASSET }/emails.json`],
      ['getFormsDictionary', `${ ASSET }/forms.json`],
      ['getLandingPagesDictionary', `${ ASSET }/landingPages.json`],
    ])('%s handles a null payload and an empty result', async (methodName, url) => {
      mockToken()
      mock.onGet(url).reply({ ...OK })

      const result = await service[methodName](null)

      expect(result).toEqual({ items: [], cursor: null })
      expect(mock.history[1].query).toMatchObject({ maxReturn: 200, offset: 0 })
    })

    it('advances the cursor by maxReturn when a page comes back full', async () => {
      mockToken()

      const items = Array.from({ length: 200 }, (_, i) => ({ id: i, name: `E${ i }` }))

      mock.onGet(`${ ASSET }/emails.json`).reply({ ...OK, result: items })

      const result = await service.getEmailsDictionary({ cursor: '200' })

      expect(result.cursor).toBe('400')
    })
  })

  describe('getFoldersDictionary', () => {
    it('filters by search term', async () => {
      mockToken()

      mock.onGet(`${ ASSET }/folders.json`).reply({
        ...OK,
        result: [{ id: 1, name: 'Marketing' }, { id: 2, name: 'Sales' }],
      })

      const result = await service.getFoldersDictionary({ search: 'sal' })

      expect(result.items).toEqual([{ label: 'Sales', value: '2', note: 'Folder · ID: 2' }])
    })

    it('advances the cursor when the page is full', async () => {
      mockToken()

      const items = Array.from({ length: 200 }, (_, i) => ({ id: i, name: `F${ i }` }))

      mock.onGet(`${ ASSET }/folders.json`).reply({ ...OK, result: items })

      const result = await service.getFoldersDictionary({ cursor: '200' })

      expect(result.cursor).toBe('400')
      expect(mock.history[1].query).toMatchObject({ offset: 200 })
    })

    it('handles a null payload and an empty result', async () => {
      mockToken()
      mock.onGet(`${ ASSET }/folders.json`).reply({ ...OK })

      const result = await service.getFoldersDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getSmartListsDictionary', () => {
    it('maps smart lists using the configured root folder', async () => {
      mockToken()

      mock.onGet(`${ ASSET }/smartLists.json`).reply({
        ...OK,
        result: [{ id: 77, name: 'Engaged' }, { id: 78, name: 'Churned' }],
      })

      const result = await service.getSmartListsDictionary({})

      expect(result.items).toEqual([
        { label: 'Engaged', value: '77', note: 'ID: 77' },
        { label: 'Churned', value: '78', note: 'ID: 78' },
      ])

      expect(mock.history[1].query).toMatchObject({
        folder: JSON.stringify({ id: 1035, type: 'Folder' }),
        maxReturn: 200,
        offset: 0,
      })
    })

    it('filters by search term and advances a full page cursor', async () => {
      mockToken()

      const items = Array.from({ length: 200 }, (_, i) => ({ id: i, name: `SL${ i }` }))

      mock.onGet(`${ ASSET }/smartLists.json`).reply({ ...OK, result: items })

      const result = await service.getSmartListsDictionary({ search: 'sl199', cursor: '200' })

      expect(result.items).toEqual([{ label: 'SL199', value: '199', note: 'ID: 199' }])
      expect(result.cursor).toBe('400')
    })

    it('handles a null payload and an empty result', async () => {
      mockToken()
      mock.onGet(`${ ASSET }/smartLists.json`).reply({ ...OK })

      const result = await service.getSmartListsDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('REST dictionaries', () => {
    it('getCampaignsDictionary filters by search and forwards the cursor', async () => {
      mockToken()

      mock.onGet(`${ REST }/campaigns.json`).reply({
        ...OK,
        result: [{ id: 1, name: 'Alpha' }, { id: 2, name: 'Beta' }],
        nextPageToken: 'NEXT',
      })

      const result = await service.getCampaignsDictionary({ search: 'alp', cursor: 'PREV' })

      expect(result.items).toEqual([{ label: 'Alpha', value: '1', note: 'campaign · ID: 1' }])
      expect(result.cursor).toBe('NEXT')
      expect(mock.history[1].query).toMatchObject({ batchSize: 300, nextPageToken: 'PREV' })
    })

    it('getCampaignsDictionary handles a null payload and an empty result', async () => {
      mockToken()
      mock.onGet(`${ REST }/campaigns.json`).reply({ ...OK })

      const result = await service.getCampaignsDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('getActivityTypesDictionary filters by search and falls back to an ID note', async () => {
      mockToken()

      mock.onGet(`${ REST }/activities/types.json`).reply({
        ...OK,
        result: [{ id: 2, name: 'Fill Out Form' }, { id: 3, name: 'Click Link' }],
      })

      const result = await service.getActivityTypesDictionary({ search: 'click' })

      expect(result.items).toEqual([{ label: 'Click Link', value: '3', note: 'ID: 3' }])
    })

    it('getActivityTypesDictionary handles a null payload and an empty result', async () => {
      mockToken()
      mock.onGet(`${ REST }/activities/types.json`).reply({ ...OK })

      const result = await service.getActivityTypesDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('getCustomObjectsDictionary falls back to the API name as the label', async () => {
      mockToken()
      mock.onGet(`${ REST }/customobjects.json`).reply({ ...OK, result: [{ name: 'car_c' }] })

      const result = await service.getCustomObjectsDictionary(null)

      expect(result.items).toEqual([{ label: 'car_c', value: 'car_c', note: 'API name: car_c' }])
    })

    it('getCustomObjectsDictionary handles an empty result', async () => {
      mockToken()
      mock.onGet(`${ REST }/customobjects.json`).reply({ ...OK })

      const result = await service.getCustomObjectsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('getListsDictionary handles an empty result', async () => {
      mockToken()
      mock.onGet(`${ REST }/lists.json`).reply({ ...OK })

      const result = await service.getListsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  // ── Triggers: pagination draining and dispatch ──

  describe('polling trigger pagination', () => {
    it('onNewLead drains every page while moreResult is true', async () => {
      mockToken()
      mock.onGet(`${ REST }/activities/types.json`).reply({ ...OK, result: [{ id: 12, name: 'New Lead' }] })

      let page = 0

      mock.onGet(`${ REST }/activities.json`).replyWith(() => {
        page += 1

        if (page === 1) {
          return { ...OK, result: [{ id: 1 }], nextPageToken: 'P2', moreResult: true }
        }

        return { ...OK, result: [{ id: 2 }], nextPageToken: 'P3', moreResult: false }
      })

      const result = await service.onNewLead({ state: { nextPageToken: 'P1' } })

      expect(result.events.map(e => e.id)).toEqual([1, 2])
      expect(result.state.nextPageToken).toBe('P3')
      expect(page).toBe(2)
    })

    it('onNewLead falls back to activity type 12 when no "New Lead" type is returned', async () => {
      mockToken()
      mock.onGet(`${ REST }/activities/types.json`).reply({ ...OK, result: [{ id: 5, name: 'Other' }] })
      mock.onGet(`${ REST }/activities.json`).reply({ ...OK, result: [], moreResult: false })

      await service.onNewLead({ state: { nextPageToken: 'P1' } })

      const call = mock.history.find(h => h.url === `${ REST }/activities.json`)

      expect(call.query.activityTypeIds).toBe(12)
    })

    it('onNewLead falls back to activity type 12 when the types response is empty', async () => {
      mockToken()
      mock.onGet(`${ REST }/activities/types.json`).reply({ ...OK })
      mock.onGet(`${ REST }/activities.json`).reply({ ...OK, result: [], moreResult: false })

      await service.onNewLead({ state: { nextPageToken: 'P1' } })

      const call = mock.history.find(h => h.url === `${ REST }/activities.json`)

      expect(call.query.activityTypeIds).toBe(12)
    })

    it('onNewLead anchors with a null token when the paging token is absent', async () => {
      mockToken()
      mock.onGet(`${ REST }/activities/pagingtoken.json`).reply({ ...OK })

      const result = await service.onNewLead({})

      expect(result).toEqual({ events: [], state: { nextPageToken: null } })
    })

    it('onNewActivity drains pages and joins the requested type IDs', async () => {
      mockToken()

      let page = 0

      mock.onGet(`${ REST }/activities.json`).replyWith(() => {
        page += 1

        if (page === 1) {
          return { ...OK, result: [{ id: 1 }], nextPageToken: 'P2', moreResult: true }
        }

        return { ...OK, result: [{ id: 2 }], moreResult: false }
      })

      const result = await service.onNewActivity({
        state: { nextPageToken: 'P1' },
        triggerData: { activityTypeIds: ['1', '2'] },
      })

      expect(result.events).toHaveLength(2)
      // No nextPageToken on the final page, so the previous token is retained.
      expect(result.state.nextPageToken).toBe('P2')
      expect(mock.history[1].query.activityTypeIds).toBe('1,2')
    })

    it('onNewActivity accepts a comma-separated type list', async () => {
      mockToken()
      mock.onGet(`${ REST }/activities.json`).reply({ ...OK, result: [], moreResult: false })

      await service.onNewActivity({
        state: { nextPageToken: 'P1' },
        triggerData: { activityTypeIds: '1, 2' },
      })

      expect(mock.history[1].query.activityTypeIds).toBe('1,2')
    })

    it('onLeadFieldChange omits listId when not configured and drains pages', async () => {
      mockToken()

      let page = 0

      mock.onGet(`${ REST }/activities/leadchanges.json`).replyWith(() => {
        page += 1

        if (page === 1) {
          return { ...OK, result: [{ id: 1 }], nextPageToken: 'P2', moreResult: true }
        }

        return { ...OK, result: [{ id: 2 }], nextPageToken: 'P3', moreResult: false }
      })

      const result = await service.onLeadFieldChange({
        state: { nextPageToken: 'P1' },
        triggerData: { fields: ['email'] },
      })

      expect(result.events).toHaveLength(2)
      expect(result.state.nextPageToken).toBe('P3')
      expect(mock.history[1].query.listId).toBeUndefined()
    })

    it('onDeletedLead drains pages', async () => {
      mockToken()

      let page = 0

      mock.onGet(`${ REST }/activities/deletedleads.json`).replyWith(() => {
        page += 1

        if (page === 1) {
          return { ...OK, result: [{ id: 1 }], nextPageToken: 'P2', moreResult: true }
        }

        return { ...OK, result: [{ id: 2 }], nextPageToken: 'P3', moreResult: false }
      })

      const result = await service.onDeletedLead({ state: { nextPageToken: 'P1' } })

      expect(result.events).toHaveLength(2)
      expect(result.state.nextPageToken).toBe('P3')
    })

    it('onNewActivity anchors with an undefined invocation-less state', async () => {
      mockToken()
      mock.onGet(`${ REST }/activities/pagingtoken.json`).reply({ ...OK, nextPageToken: 'A==' })

      const result = await service.onNewActivity({ triggerData: { activityTypeIds: ['1'] } })

      expect(result).toEqual({ events: [], state: { nextPageToken: 'A==' } })
    })

    it('onDeletedLead anchors when invoked with no arguments', async () => {
      mockToken()
      mock.onGet(`${ REST }/activities/pagingtoken.json`).reply({ ...OK, nextPageToken: 'A==' })

      const result = await service.onDeletedLead()

      expect(result).toEqual({ events: [], state: { nextPageToken: 'A==' } })
    })

    it('onLeadFieldChange throws when invoked with no arguments', async () => {
      await expect(service.onLeadFieldChange()).rejects.toThrow('Fields to Watch is required')
    })

    it('onNewActivity throws when invoked with no arguments', async () => {
      await expect(service.onNewActivity()).rejects.toThrow('Activity Types is required')
    })
  })

  describe('handleTriggerPollingForEvent', () => {
    it.each([
      ['onNewLead'],
      ['onDeletedLead'],
    ])('dispatches to %s', async eventName => {
      mockToken()
      mock.onGet(`${ REST }/activities/pagingtoken.json`).reply({ ...OK, nextPageToken: 'A==' })

      const result = await service.handleTriggerPollingForEvent({ eventName, state: {} })

      expect(result).toEqual({ events: [], state: { nextPageToken: 'A==' } })
    })

    it('dispatches to onNewActivity with trigger data', async () => {
      mockToken()
      mock.onGet(`${ REST }/activities/pagingtoken.json`).reply({ ...OK, nextPageToken: 'A==' })

      const result = await service.handleTriggerPollingForEvent({
        eventName: 'onNewActivity',
        state: {},
        triggerData: { activityTypeIds: ['1'] },
      })

      expect(result.events).toEqual([])
    })
  })

  // ── Required-parameter guards ──

  describe('required parameter guards', () => {
    it.each([
      ['getProgramById', [''], 'Program is required'],
      ['updateProgram', [''], 'Program is required'],
      ['cloneProgram', [''], 'Program is required'],
      ['cloneProgram', ['1107', ''], 'New Name is required'],
      ['cloneProgram', ['1107', 'Copy', ''], 'Destination Folder is required'],
      ['deleteProgram', [''], 'Program is required'],
      ['approveEmailProgram', [''], 'Program is required'],
      ['unapproveEmailProgram', [''], 'Program is required'],
      ['browseFolders', [''], 'Root Folder is required'],
      ['getFolderById', [''], 'Folder is required'],
      ['createFolder', [''], 'Name is required'],
      ['createFolder', ['F', ''], 'Parent Folder is required'],
      ['updateFolder', [''], 'Folder is required'],
      ['deleteFolder', [''], 'Folder is required'],
      ['getTokensByFolder', [''], 'Folder / Program is required'],
      ['createToken', [''], 'Folder / Program is required'],
      ['createToken', ['1035', 'Folder', ''], 'Token Name is required'],
      ['createToken', ['1035', 'Folder', 'my.T', ''], 'Token Type is required'],
      ['createToken', ['1035', 'Folder', 'my.T', 'Text', ''], 'Value is required'],
      ['createToken', ['1035', 'Folder', 'my.T', 'Text', null], 'Value is required'],
      ['deleteToken', [''], 'Folder / Program is required'],
      ['deleteToken', ['1035', 'Folder', ''], 'Token Name is required'],
      ['deleteToken', ['1035', 'Folder', 'my.T', ''], 'Token Type is required'],
      ['getEmailById', [''], 'Email is required'],
      ['getEmailContent', [''], 'Email is required'],
      ['createEmail', [''], 'Name is required'],
      ['createEmail', ['E', ''], 'Email Template ID is required'],
      ['createEmail', ['E', '24', ''], 'Folder is required'],
      ['updateEmail', [''], 'Email is required'],
      ['cloneEmail', [''], 'Email is required'],
      ['cloneEmail', ['1356', ''], 'New Name is required'],
      ['cloneEmail', ['1356', 'Copy', ''], 'Destination Folder is required'],
      ['deleteEmail', [''], 'Email is required'],
      ['approveEmail', [''], 'Email is required'],
      ['unapproveEmail', [''], 'Email is required'],
      ['sendSampleEmail', [''], 'Email is required'],
      ['sendSampleEmail', ['1356', ''], 'Recipient is required'],
      ['getFormById', [''], 'Form is required'],
      ['getFormFields', [''], 'Form is required'],
      ['createForm', [''], 'Name is required'],
      ['createForm', ['F', ''], 'Folder is required'],
      ['updateForm', [''], 'Form is required'],
      ['cloneForm', [''], 'Form is required'],
      ['cloneForm', ['1029', ''], 'New Name is required'],
      ['cloneForm', ['1029', 'Copy', ''], 'Destination Folder is required'],
      ['approveForm', [''], 'Form is required'],
      ['unapproveForm', [''], 'Form is required'],
      ['deleteForm', [''], 'Form is required'],
      ['getLandingPageById', [''], 'Landing Page is required'],
      ['getLandingPageContent', [''], 'Landing Page is required'],
      ['createLandingPage', [''], 'Name is required'],
      ['createLandingPage', ['LP', ''], 'Landing Page Template ID is required'],
      ['createLandingPage', ['LP', '12', ''], 'Folder is required'],
      ['updateLandingPage', [''], 'Landing Page is required'],
      ['cloneLandingPage', [''], 'Landing Page is required'],
      ['cloneLandingPage', ['500', ''], 'New Name is required'],
      ['cloneLandingPage', ['500', 'Copy', ''], 'Destination Folder is required'],
      ['cloneLandingPage', ['500', 'Copy', '1035', ''], 'Template ID is required'],
      ['approveLandingPage', [''], 'Landing Page is required'],
      ['unapproveLandingPage', [''], 'Landing Page is required'],
      ['deleteLandingPage', [''], 'Landing Page is required'],
      ['browseSmartLists', [''], 'Folder is required'],
      ['getSmartListById', [''], 'Smart List is required'],
      ['cloneSmartList', [''], 'Smart List is required'],
      ['cloneSmartList', ['77', ''], 'New Name is required'],
      ['cloneSmartList', ['77', 'Copy', ''], 'Destination Folder is required'],
      ['deleteSmartList', [''], 'Smart List is required'],
      ['getSnippetContent', [''], 'Snippet is required'],
      ['createSnippet', [''], 'Name is required'],
      ['createSnippet', ['S', ''], 'Folder is required'],
      ['updateSnippet', [''], 'Snippet is required'],
      ['updateSnippetContent', [''], 'Snippet is required'],
      ['updateSnippetContent', ['33', null], 'HTML Content is required'],
      ['approveSnippetDraft', [''], 'Snippet is required'],
      ['deleteSnippet', [''], 'Snippet is required'],
      ['queryCustomObjects', [''], 'Custom Object is required'],
      ['queryCustomObjects', ['car_c', ''], 'Filter Field is required'],
      ['queryCustomObjects', ['car_c', 'vin', []], 'Filter Values is required'],
      ['syncCustomObjects', [''], 'Custom Object is required'],
      ['syncCustomObjects', ['car_c', []], 'Records is required'],
      ['deleteCustomObjects', [''], 'Custom Object is required'],
      ['deleteCustomObjects', ['car_c', []], 'Records is required'],
      ['addLeadsToList', [''], 'List is required'],
      ['removeLeadsFromList', [''], 'List is required'],
      ['removeLeadsFromList', ['1027', []], 'Lead IDs is required'],
      ['isMemberOfList', [''], 'List is required'],
      ['isMemberOfList', ['1027', []], 'Lead IDs is required'],
      ['requestCampaign', [''], 'Campaign is required'],
      ['scheduleCampaign', [''], 'Campaign is required'],
      ['mergeLeads', ['100', []], 'Losing Leads is required'],
      ['pushLead', [''], 'Program is required'],
      ['pushLead', ['My Program', []], 'Leads is required'],
      ['submitForm', [''], 'Form is required'],
      ['associateLead', [''], 'Lead is required'],
      ['associateLead', ['100', ''], 'Munchkin Cookie is required'],
      ['syncLeads', ['not-an-array'], 'Leads is required'],
    ])('%s%j throws "%s"', async (methodName, args, message) => {
      await expect(service[methodName](...args)).rejects.toThrow(message)
    })

    it('makes no HTTP call when a guard rejects', async () => {
      await expect(service.deleteProgram('')).rejects.toThrow('Program is required')

      expect(mock.history).toHaveLength(0)
    })
  })

  // ── Remaining REST action coverage ──

  describe('remaining REST actions', () => {
    it('getLeadById omits fields when none are supplied', async () => {
      mockToken()
      mock.onGet(`${ REST }/lead/123.json`).reply({ ...OK, result: [] })

      await service.getLeadById('123')

      expect(mock.history[1].query).toEqual({})
    })

    it('getLeads omits optional params', async () => {
      mockToken()
      mock.onGet(`${ REST }/leads.json`).reply({ ...OK, result: [] })

      await service.getLeads('Email', 'a@test.com')

      const call = mock.history.find(h => h.url === `${ REST }/leads.json`)

      expect(call.query).toEqual({ filterType: 'email', filterValues: 'a@test.com' })
    })

    it('getLists sends an empty query with no filters', async () => {
      mockToken()
      mock.onGet(`${ REST }/lists.json`).reply({ ...OK, result: [] })

      await service.getLists()

      expect(mock.history[1].query).toEqual({})
    })

    it('getLeadsByList omits optional params', async () => {
      mockToken()
      mock.onGet(`${ REST }/lists/1027/leads.json`).reply({ ...OK, result: [] })

      await service.getLeadsByList('1027')

      expect(mock.history[1].query).toEqual({})
    })

    it('getCampaigns sends an empty query with no filters', async () => {
      mockToken()
      mock.onGet(`${ REST }/campaigns.json`).reply({ ...OK, result: [] })

      await service.getCampaigns()

      expect(mock.history[1].query).toEqual({})
    })

    it('getCampaigns forwards isTriggerable false', async () => {
      mockToken()
      mock.onGet(`${ REST }/campaigns.json`).reply({ ...OK, result: [] })

      await service.getCampaigns(undefined, undefined, false)

      expect(mock.history[1].query).toEqual({ isTriggerable: false })
    })

    it('scheduleCampaign sends an empty input when nothing optional is supplied', async () => {
      mockToken()
      mock.onPost(`${ REST }/campaigns/1069/schedule.json`).reply(OK)

      await service.scheduleCampaign('1069')

      const call = mock.history.find(h => h.url.includes('/schedule.json'))

      expect(call.body).toEqual({ input: {} })
    })

    it('scheduleCampaign ignores an empty tokens array', async () => {
      mockToken()
      mock.onPost(`${ REST }/campaigns/1069/schedule.json`).reply(OK)

      await service.scheduleCampaign('1069', '2026-01-01T00:00:00Z', undefined, [])

      const call = mock.history.find(h => h.url.includes('/schedule.json'))

      expect(call.body).toEqual({ input: { runAt: '2026-01-01T00:00:00Z' } })
    })

    it('getLeadActivities omits optional params', async () => {
      mockToken()
      mock.onGet(`${ REST }/activities.json`).reply({ ...OK, result: [] })

      await service.getLeadActivities('TOK', ['1'])

      const call = mock.history.find(h => h.url === `${ REST }/activities.json`)

      expect(call.query).toEqual({ nextPageToken: 'TOK', activityTypeIds: '1' })
    })

    it('listCustomObjectTypes sends an empty query when no names are supplied', async () => {
      mockToken()
      mock.onGet(`${ REST }/customobjects.json`).reply({ ...OK, result: [] })

      await service.listCustomObjectTypes()

      expect(mock.history[1].query).toEqual({})
    })

    it('queryCustomObjects omits optional params', async () => {
      mockToken()
      mock.onGet(`${ REST }/customobjects/car_c.json`).reply({ ...OK, result: [] })

      await service.queryCustomObjects('car_c', 'vin', 'VIN1')

      const call = mock.history.find(h => h.url === `${ REST }/customobjects/car_c.json`)

      expect(call.query).toEqual({ filterType: 'vin', filterValues: 'VIN1' })
    })

    it('syncCustomObjects defaults the action and omits dedupeBy', async () => {
      mockToken()
      mock.onPost(`${ REST }/customobjects/car_c.json`).reply(OK)

      await service.syncCustomObjects('car_c', [{ vin: 'V1' }])

      const call = mock.history.find(h => h.url === `${ REST }/customobjects/car_c.json` && h.method === 'post')

      expect(call.body).toEqual({ action: 'createOrUpdate', input: [{ vin: 'V1' }] })
    })

    it('deleteCustomObjects omits deleteBy when not supplied', async () => {
      mockToken()
      mock.onPost(`${ REST }/customobjects/car_c/delete.json`).reply(OK)

      await service.deleteCustomObjects('car_c', [{ vin: 'V1' }])

      const call = mock.history.find(h => h.url.includes('/customobjects/car_c/delete.json'))

      expect(call.body).toEqual({ input: [{ vin: 'V1' }] })
    })

    it('mergeLeads omits mergeInCRM when not supplied', async () => {
      mockToken()
      mock.onPost(`${ REST }/leads/100/merge.json`).reply(OK)

      await service.mergeLeads('100', ['200'])

      const call = mock.history.find(h => h.url.includes('/merge.json'))

      expect(call.query).toEqual({ leadIds: '200' })
    })

    it('pushLead omits source and reason when not supplied', async () => {
      mockToken()
      mock.onPost(`${ REST }/leads/push.json`).reply(OK)

      await service.pushLead('My Program', [{ email: 'a@test.com' }])

      const call = mock.history.find(h => h.url.includes('/leads/push.json'))

      expect(call.body).toEqual({
        programName: 'My Program',
        lookupField: 'email',
        input: [{ email: 'a@test.com' }],
      })
    })

    it('submitForm omits cookie and visitorData when not supplied', async () => {
      mockToken()
      mock.onPost(`${ REST }/leads/submitForm.json`).reply(OK)

      await service.submitForm('1029', { email: 'a@test.com' })

      const call = mock.history.find(h => h.url.includes('/submitForm.json'))

      expect(call.body).toEqual({ formId: 1029, input: [{ leadFormFields: { email: 'a@test.com' } }] })
    })

    it('submitForm keeps a non-numeric form id verbatim', async () => {
      mockToken()
      mock.onPost(`${ REST }/leads/submitForm.json`).reply(OK)

      await service.submitForm('form-alias', { email: 'a@test.com' })

      const call = mock.history.find(h => h.url.includes('/submitForm.json'))

      expect(call.body.formId).toBe('form-alias')
    })

    it('submitForm rejects a non-object field map', async () => {
      await expect(service.submitForm('1029', 'not-an-object')).rejects.toThrow('Form Fields is required')
    })

    it('syncLeads omits partitionName when not supplied', async () => {
      mockToken()
      mock.onPost(`${ REST }/leads.json`).reply(OK)

      await service.syncLeads([{ email: 'a@test.com' }])

      const call = mock.history.find(h => h.method === 'post')

      expect(call.body.partitionName).toBeUndefined()
    })
  })
})
