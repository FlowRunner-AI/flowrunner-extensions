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
      ])
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
      mock.onGet(`${ REST }/leads/describe.json`).replyWith((call) => {
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
})
