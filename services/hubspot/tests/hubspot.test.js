'use strict'

const { createSandbox } = require('../../../service-sandbox')

const CLIENT_ID = 'test-client-id'
const CLIENT_SECRET = 'test-client-secret'
const ACCESS_TOKEN = 'test-access-token'
const API_BASE = 'https://api.hubapi.com'
const OAUTH_BASE = `${API_BASE}/oauth`
const AUTH_URL = 'https://app.hubspot.com/oauth/authorize'

describe('HubSpot Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET })
    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()

    service.request = {
      headers: { 'oauth-access-token': ACCESS_TOKEN },
    }
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
      const configs = sandbox.getConfigItems()

      expect(configs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'clientId', required: true, shared: true }),
          expect.objectContaining({ name: 'clientSecret', required: true, shared: true }),
        ])
      )
    })

    it('registers exactly 2 config items', () => {
      expect(sandbox.getConfigItems()).toHaveLength(2)
    })
  })

  // ── OAuth2 System Methods ──

  describe('getOAuth2ConnectionURL', () => {
    it('returns correct authorization URL with client_id and scopes', async () => {
      const url = await service.getOAuth2ConnectionURL()

      expect(url).toContain(AUTH_URL)
      expect(url).toContain(`client_id=${CLIENT_ID}`)
      expect(url).toContain('response_type=code')
      expect(url).toContain('scope=')
      expect(url).toContain('crm.objects.contacts.read')
    })
  })

  describe('executeCallback', () => {
    it('sends correct token exchange request', async () => {
      const callbackObject = {
        code: 'auth-code-123',
        redirectURI: 'https://example.com/callback',
      }

      mock.onPost(`${OAUTH_BASE}/v1/token`).reply({
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        expires_in: 21600,
      })

      const result = await service.executeCallback(callbackObject)

      expect(result).toEqual({
        token: 'new-access-token',
        refreshToken: 'new-refresh-token',
        expirationInSeconds: 21600,
        overwrite: true,
        connectionIdentityName: 'HubSpot Service Account',
      })

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].headers).toMatchObject({
        'Content-Type': 'application/x-www-form-urlencoded',
      })

      const body = mock.history[0].body
      expect(body).toContain(`client_id=${CLIENT_ID}`)
      expect(body).toContain(`client_secret=${CLIENT_SECRET}`)
      expect(body).toContain('code=auth-code-123')
      expect(body).toContain('grant_type=authorization_code')
      expect(body).toContain(`redirect_uri=${encodeURIComponent('https://example.com/callback')}`)
    })

    it('throws on API error', async () => {
      mock.onPost(`${OAUTH_BASE}/v1/token`).replyWithError({ message: 'Invalid code' })

      await expect(service.executeCallback({ code: 'bad', redirectURI: 'https://x.com' }))
        .rejects.toThrow()
    })
  })

  describe('refreshToken', () => {
    it('sends correct refresh request and returns token data', async () => {
      mock.onPost(`${OAUTH_BASE}/v1/token`).reply({
        access_token: 'refreshed-token',
        expires_in: 21600,
      })

      const result = await service.refreshToken('old-refresh-token')

      expect(result).toEqual({
        token: 'refreshed-token',
        expirationInSeconds: 21600,
      })

      expect(mock.history).toHaveLength(1)
      const body = mock.history[0].body
      expect(body).toContain('grant_type=refresh_token')
      expect(body).toContain('refresh_token=old-refresh-token')
      expect(body).toContain(`client_id=${CLIENT_ID}`)
      expect(body).toContain(`client_secret=${CLIENT_SECRET}`)
    })

    it('throws on API error', async () => {
      mock.onPost(`${OAUTH_BASE}/v1/token`).replyWithError({ message: 'Invalid refresh token' })

      await expect(service.refreshToken('bad-token')).rejects.toThrow()
    })
  })

  // ── Contact Management ──

  describe('getAllContacts', () => {
    const url = `${API_BASE}/contacts/v1/lists/all/contacts/all`

    it('sends GET request with all parameters', async () => {
      const mockResponse = { 'has-more': false, contacts: [], 'vid-offset': 0 }
      mock.onGet(url).reply(mockResponse)

      const result = await service.getAllContacts(50, '12345', ['email'], 'value_only', 'newest', true)

      expect(result).toEqual(mockResponse)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].headers).toMatchObject({
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      })
      expect(mock.history[0].query).toMatchObject({
        count: 50,
        vidOffset: '12345',
        property: ['email'],
        propertyMode: 'value_only',
        formSubmissionMode: 'newest',
        showListMemberships: true,
      })
    })

    it('sends request with no parameters', async () => {
      mock.onGet(url).reply({ 'has-more': false, contacts: [], 'vid-offset': 0 })

      await service.getAllContacts()

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({
        count: undefined,
        vidOffset: undefined,
      })
    })

    it('throws on API error', async () => {
      mock.onGet(url).replyWithError({ message: 'Unauthorized', status: 401 })

      await expect(service.getAllContacts()).rejects.toThrow()
    })
  })

  describe('getContactById', () => {
    const vid = '66626343716'
    const url = `${API_BASE}/contacts/v1/contact/vid/${vid}/profile`

    it('sends GET request with correct URL and parameters', async () => {
      const mockContact = { vid: 66626343716, properties: { email: { value: 'test@test.com' } } }
      mock.onGet(url).reply(mockContact)

      const result = await service.getContactById(vid, ['email', 'firstname'], 'value_and_history', 'all', true)

      expect(result).toEqual(mockContact)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({
        property: ['email', 'firstname'],
        propertyMode: 'value_and_history',
        formSubmissionMode: 'all',
        showListMemberships: true,
      })
    })

    it('sends request with only required vid parameter', async () => {
      mock.onGet(url).reply({ vid: 66626343716 })

      await service.getContactById(vid)

      expect(mock.history).toHaveLength(1)
    })

    it('throws on 404 error', async () => {
      mock.onGet(url).replyWithError({ message: 'Not Found', status: 404 })

      await expect(service.getContactById(vid)).rejects.toThrow()
    })
  })

  describe('getContactByEmail', () => {
    const email = 'some@hubspot.com'
    const url = `${API_BASE}/contacts/v1/contact/email/${email}/profile`

    it('sends GET request with email in URL', async () => {
      const mockContact = { vid: 66626343716, properties: { email: { value: email } } }
      mock.onGet(url).reply(mockContact)

      const result = await service.getContactByEmail(email, ['email'], 'value_only', 'none', false)

      expect(result).toEqual(mockContact)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({
        property: ['email'],
        propertyMode: 'value_only',
        formSubmissionMode: 'none',
        showListMemberships: false,
      })
    })

    it('throws on 404 when email not found', async () => {
      mock.onGet(url).replyWithError({ message: 'Not Found', status: 404 })

      await expect(service.getContactByEmail(email)).rejects.toThrow()
    })
  })

  describe('createContact', () => {
    const url = `${API_BASE}/contacts/v1/contact`

    it('sends POST with properties in body', async () => {
      const properties = [
        { property: 'email', value: 'new@test.com' },
        { property: 'firstname', value: 'John' },
      ]
      const mockResponse = { vid: 12345, properties: { email: { value: 'new@test.com' } } }
      mock.onPost(url).reply(mockResponse)

      const result = await service.createContact(properties)

      expect(result).toEqual(mockResponse)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({ properties })
    })

    it('throws on 409 conflict', async () => {
      mock.onPost(url).replyWithError({ message: 'Conflict', status: 409 })

      await expect(service.createContact([{ property: 'email', value: 'dup@test.com' }]))
        .rejects.toThrow()
    })
  })

  describe('updateContact', () => {
    const vid = '66626343716'
    const url = `${API_BASE}/contacts/v1/contact/vid/${vid}/profile`

    it('sends POST with vid in URL and properties in body', async () => {
      const properties = [{ property: 'firstname', value: 'Updated' }]
      mock.onPost(url).reply(undefined)

      await service.updateContact(vid, properties)

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({ properties })
      expect(mock.history[0].headers).toMatchObject({
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
      })
    })

    it('throws on 404 when vid not found', async () => {
      mock.onPost(url).replyWithError({ message: 'Not Found', status: 404 })

      await expect(service.updateContact(vid, []))
        .rejects.toThrow()
    })
  })

  describe('deleteContact', () => {
    const contactId = '66907555176'
    const url = `${API_BASE}/contacts/v1/contact/vid/${contactId}`

    it('sends DELETE request with contact ID in URL', async () => {
      const mockResponse = { vid: 66907555176, reason: 'OK', deleted: true }
      mock.onDelete(url).reply(mockResponse)

      const result = await service.deleteContact(contactId)

      expect(result).toEqual(mockResponse)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('delete')
    })

    it('throws on 404 when contact not found', async () => {
      mock.onDelete(url).replyWithError({ message: 'Not Found', status: 404 })

      await expect(service.deleteContact(contactId)).rejects.toThrow()
    })
  })

  describe('searchContacts', () => {
    const url = `${API_BASE}/contacts/v1/search/query`

    it('sends GET request with search parameters', async () => {
      const mockResponse = { total: 1, offset: 1, query: 'hub', 'has-more': false, contacts: [] }
      mock.onGet(url).reply(mockResponse)

      const result = await service.searchContacts('hub', 10, '0', ['email'], 'vid', 'ASC')

      expect(result).toEqual(mockResponse)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({
        q: 'hub',
        count: 10,
        offset: '0',
        property: ['email'],
        sort: 'vid',
        order: 'ASC',
      })
    })

    it('sends request with only required query parameter', async () => {
      mock.onGet(url).reply({ total: 0, offset: 0, query: 'test', 'has-more': false, contacts: [] })

      await service.searchContacts('test')

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({ q: 'test' })
    })
  })

  describe('getContactsAtCompany', () => {
    const companyId = '23613829028'
    const url = `${API_BASE}/companies/v2/companies/${companyId}/contacts`

    it('sends GET request with company ID in URL and pagination params', async () => {
      const mockResponse = { vidOffset: 0, hasMore: false, contacts: [] }
      mock.onGet(url).reply(mockResponse)

      const result = await service.getContactsAtCompany(companyId, 50, 100)

      expect(result).toEqual(mockResponse)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({ count: 50, vidOffset: 100 })
    })

    it('sends request with only required companyId', async () => {
      mock.onGet(url).reply({ vidOffset: 0, hasMore: false, contacts: [] })

      await service.getContactsAtCompany(companyId)

      expect(mock.history).toHaveLength(1)
    })
  })

  // ── Company Management ──

  describe('getAllCompanies', () => {
    const url = `${API_BASE}/companies/v2/companies/paged`

    it('sends GET request with all parameters', async () => {
      const mockResponse = { companies: [], hasMore: false, offset: 0 }
      mock.onGet(url).reply(mockResponse)

      const result = await service.getAllCompanies(100, 0, ['name', 'domain'], ['name'])

      expect(result).toEqual(mockResponse)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({
        limit: 100,
        offset: 0,
        properties: ['name', 'domain'],
        propertiesWithHistory: ['name'],
      })
    })

    it('sends request with no parameters', async () => {
      mock.onGet(url).reply({ companies: [], hasMore: false, offset: 0 })

      await service.getAllCompanies()

      expect(mock.history).toHaveLength(1)
    })
  })

  describe('getCompanyById', () => {
    const companyId = '23613829028'
    const url = `${API_BASE}/companies/v2/companies/${companyId}`

    it('sends GET request with company ID in URL', async () => {
      const mockResponse = { portalId: 47634236, companyId: 23613829028, isDeleted: false }
      mock.onGet(url).reply(mockResponse)

      const result = await service.getCompanyById(companyId)

      expect(result).toEqual(mockResponse)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
    })
  })

  describe('createCompany', () => {
    const url = `${API_BASE}/companies/v2/companies/`

    it('sends POST with properties in body', async () => {
      const properties = [
        { name: 'name', value: 'New Company' },
        { name: 'domain', value: 'newcompany.com' },
      ]
      const mockResponse = { portalId: 47634236, companyId: 23613829029, isDeleted: false }
      mock.onPost(url).reply(mockResponse)

      const result = await service.createCompany(properties)

      expect(result).toEqual(mockResponse)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({ properties })
    })
  })

  describe('updateCompany', () => {
    const companyId = '23613829028'
    const url = `${API_BASE}/companies/v2/companies/${companyId}`

    it('sends PUT with company ID in URL and properties in body', async () => {
      const properties = [{ name: 'name', value: 'Updated Company' }]
      mock.onPut(url).reply(undefined)

      await service.updateCompany(companyId, properties)

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].body).toEqual({ properties })
    })
  })

  describe('deleteCompany', () => {
    const companyId = '23613829028'
    const url = `${API_BASE}/companies/v2/companies/${companyId}`

    it('sends DELETE request with company ID in URL', async () => {
      mock.onDelete(url).reply(undefined)

      await service.deleteCompany(companyId)

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('delete')
    })

    it('throws on API error', async () => {
      mock.onDelete(url).replyWithError({ message: 'Not Found', status: 404 })

      await expect(service.deleteCompany(companyId)).rejects.toThrow()
    })
  })

  // ── Deal Management ──

  describe('getAllDeals', () => {
    const url = `${API_BASE}/deals/v1/deal/paged`

    it('sends GET request with all parameters', async () => {
      const mockResponse = { deals: [], hasMore: false, offset: 0 }
      mock.onGet(url).reply(mockResponse)

      const result = await service.getAllDeals(100, 0, ['dealname'], ['amount'], true)

      expect(result).toEqual(mockResponse)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({
        limit: 100,
        offset: 0,
        properties: ['dealname'],
        propertiesWithHistory: ['amount'],
        includeAssociations: true,
      })
    })

    it('sends request with no parameters', async () => {
      mock.onGet(url).reply({ deals: [], hasMore: false, offset: 0 })

      await service.getAllDeals()

      expect(mock.history).toHaveLength(1)
    })
  })

  describe('getDealById', () => {
    const dealId = '23259329303'
    const url = `${API_BASE}/deals/v1/deal/${dealId}`

    it('sends GET request with deal ID in URL', async () => {
      const mockResponse = { dealId: 23259329303, portalId: 47634236 }
      mock.onGet(url).reply(mockResponse)

      const result = await service.getDealById(dealId)

      expect(result).toEqual(mockResponse)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].query).toEqual({})
    })

    it('includes includePropertyVersions query param when true', async () => {
      mock.onGet(url).reply({ dealId: 23259329303 })

      await service.getDealById(dealId, true)

      expect(mock.history[0].query).toEqual({ includePropertyVersions: 'true' })
    })

    it('does not include includePropertyVersions when false', async () => {
      mock.onGet(url).reply({ dealId: 23259329303 })

      await service.getDealById(dealId, false)

      expect(mock.history[0].query).toEqual({})
    })
  })

  describe('createDeal', () => {
    const url = `${API_BASE}/deals/v1/deal`

    it('sends POST with properties and associations', async () => {
      const properties = [{ name: 'dealname', value: 'New Deal' }]
      const companyIds = [123]
      const contactVids = [456]
      const mockResponse = { dealId: 999, portalId: 47634236 }
      mock.onPost(url).reply(mockResponse)

      const result = await service.createDeal(properties, companyIds, contactVids)

      expect(result).toEqual(mockResponse)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].body).toEqual({
        properties,
        associations: {
          associatedCompanyIds: [123],
          associatedVids: [456],
        },
      })
    })

    it('defaults associations to empty arrays when not provided', async () => {
      mock.onPost(url).reply({ dealId: 1000 })

      await service.createDeal([{ name: 'dealname', value: 'Test' }])

      expect(mock.history[0].body.associations).toEqual({
        associatedCompanyIds: [],
        associatedVids: [],
      })
    })
  })

  describe('updateDeal', () => {
    const dealId = '23259329303'
    const url = `${API_BASE}/deals/v1/deal/${dealId}`

    it('sends PUT with deal ID in URL and properties in body', async () => {
      const properties = [{ name: 'amount', value: '2000' }]
      mock.onPut(url).reply(undefined)

      await service.updateDeal(dealId, properties)

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].body).toEqual({ properties })
    })
  })

  describe('deleteDeal', () => {
    const dealId = '23259329303'
    const url = `${API_BASE}/deals/v1/deal/${dealId}`

    it('sends DELETE request with deal ID in URL', async () => {
      mock.onDelete(url).reply(undefined)

      await service.deleteDeal(dealId)

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('delete')
    })
  })

  // ── Association Management ──

  describe('getAssociations', () => {
    const objectId = '66626343716'
    const definitionId = 1
    const url = `${API_BASE}/crm-associations/v1/associations/${objectId}/HUBSPOT_DEFINED/${definitionId}`

    it('sends GET request with object ID and definition ID in URL', async () => {
      const mockResponse = {
        results: [{ fromObjectId: 66626343716, toObjectId: 23613829028, category: 'HUBSPOT_DEFINED', definitionId: 1 }],
        hasMore: false,
        offset: 0,
      }
      mock.onGet(url).reply(mockResponse)

      const result = await service.getAssociations(objectId, definitionId)

      expect(result).toEqual(mockResponse)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
    })
  })

  describe('associateObjects', () => {
    const url = `${API_BASE}/crm-associations/v1/associations`

    it('sends PUT request with association body', async () => {
      mock.onPut(url).reply(undefined)

      await service.associateObjects('111', '222', 'HUBSPOT_DEFINED', 1)

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].body).toEqual({
        fromObjectId: '111',
        toObjectId: '222',
        category: 'HUBSPOT_DEFINED',
        definitionId: 1,
      })
    })
  })

  describe('deleteAssociation', () => {
    const url = `${API_BASE}/crm-associations/v1/associations/delete`

    it('sends PUT request to delete endpoint with association body', async () => {
      mock.onPut(url).reply(undefined)

      await service.deleteAssociation('111', '222', 'HUBSPOT_DEFINED', 1)

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].body).toEqual({
        fromObjectId: '111',
        toObjectId: '222',
        category: 'HUBSPOT_DEFINED',
        definitionId: 1,
      })
    })

    it('throws on API error', async () => {
      mock.onPut(url).replyWithError({ message: 'Not Found' })

      await expect(service.deleteAssociation('111', '222', 'HUBSPOT_DEFINED', 1))
        .rejects.toThrow()
    })
  })
})
