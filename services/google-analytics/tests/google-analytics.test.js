'use strict'

const { createSandbox } = require('../../../service-sandbox')

const CLIENT_ID = 'test-client-id'
const CLIENT_SECRET = 'test-client-secret'
const ACCESS_TOKEN = 'test-access-token'
const REFRESH_TOKEN = 'test-refresh-token'

const DATA_API_BASE = 'https://analyticsdata.googleapis.com/v1beta'
const ADMIN_API_BASE = 'https://analyticsadmin.googleapis.com/v1beta'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const USER_INFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo'

describe('Google Analytics Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET })
    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()

    // Simulate OAuth access token header
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
      const configs = sandbox.getConfigItems()

      expect(configs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'clientId', required: true, shared: true }),
          expect.objectContaining({ name: 'clientSecret', required: true, shared: true }),
        ])
      )
    })
  })

  // ── OAuth ──

  describe('getOAuth2ConnectionURL', () => {
    it('returns a correctly formed OAuth URL', async () => {
      const url = await service.getOAuth2ConnectionURL()

      expect(url).toContain('https://accounts.google.com/o/oauth2/v2/auth')
      expect(url).toContain(`client_id=${CLIENT_ID}`)
      expect(url).toContain('response_type=code')
      expect(url).toContain('access_type=offline')
      expect(url).toContain('prompt=consent')
      expect(url).toContain('scope=')
    })
  })

  describe('executeCallback', () => {
    it('exchanges code for tokens and fetches user info', async () => {
      mock.onPost(TOKEN_URL).reply({
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        expires_in: 3600,
      })

      mock.onGet(USER_INFO_URL).reply({
        name: 'Test User',
        email: 'test@example.com',
        picture: 'https://example.com/photo.jpg',
      })

      const result = await service.executeCallback({
        code: 'auth-code-123',
        redirectURI: 'https://app.flowrunner.com/callback',
      })

      expect(result).toEqual({
        token: 'new-access-token',
        refreshToken: 'new-refresh-token',
        expirationInSeconds: 3600,
        connectionIdentityName: 'Test User (test@example.com)',
        connectionIdentityImageURL: 'https://example.com/photo.jpg',
        overwrite: true,
        userData: {
          name: 'Test User',
          email: 'test@example.com',
          picture: 'https://example.com/photo.jpg',
        },
      })

      // Verify token exchange request
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(TOKEN_URL)
      expect(mock.history[0].headers).toMatchObject({
        'Content-Type': 'application/x-www-form-urlencoded',
      })
      const body = mock.history[0].body
      expect(body).toContain(`client_id=${CLIENT_ID}`)
      expect(body).toContain('code=auth-code-123')
      expect(body).toContain('grant_type=authorization_code')
      expect(body).toContain(`client_secret=${CLIENT_SECRET}`)

      // Verify user info request uses the new access token
      expect(mock.history[1].url).toBe(USER_INFO_URL)
      expect(mock.history[1].headers).toMatchObject({
        Authorization: 'Bearer new-access-token',
      })
    })

    it('handles user info with email only (no name)', async () => {
      mock.onPost(TOKEN_URL).reply({
        access_token: 'token',
        expires_in: 3600,
      })

      mock.onGet(USER_INFO_URL).reply({
        email: 'test@example.com',
      })

      const result = await service.executeCallback({ code: 'code', redirectURI: 'uri' })

      expect(result.connectionIdentityName).toBe('test@example.com')
      expect(result.connectionIdentityImageURL).toBeNull()
    })

    it('handles user info fetch failure gracefully', async () => {
      mock.onPost(TOKEN_URL).reply({
        access_token: 'token',
        expires_in: 3600,
      })

      mock.onGet(USER_INFO_URL).replyWithError({ message: 'Forbidden' })

      const result = await service.executeCallback({ code: 'code', redirectURI: 'uri' })

      expect(result.token).toBe('token')
      expect(result.connectionIdentityName).toBe('Google Analytics Account')
      expect(result.connectionIdentityImageURL).toBeNull()
    })
  })

  describe('refreshToken', () => {
    it('refreshes the access token', async () => {
      mock.onPost(TOKEN_URL).reply({
        access_token: 'refreshed-token',
        expires_in: 3600,
      })

      const result = await service.refreshToken(REFRESH_TOKEN)

      expect(result).toEqual({
        token: 'refreshed-token',
        expirationInSeconds: 3600,
      })

      expect(mock.history[0].url).toBe(TOKEN_URL)
      expect(mock.history[0].query).toMatchObject({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: 'refresh_token',
        refresh_token: REFRESH_TOKEN,
      })
    })

    it('throws a friendly message on invalid_grant', async () => {
      mock.onPost(TOKEN_URL).replyWithError({
        message: 'invalid_grant',
        body: { error: 'invalid_grant' },
      })

      await expect(service.refreshToken(REFRESH_TOKEN))
        .rejects.toThrow('Refresh token expired or invalid, please re-authenticate.')
    })

    it('re-throws other errors', async () => {
      mock.onPost(TOKEN_URL).replyWithError({
        message: 'Server Error',
        body: { error: 'server_error' },
      })

      await expect(service.refreshToken(REFRESH_TOKEN)).rejects.toThrow()
    })
  })

  // ── Dictionaries ──

  describe('getPropertiesDictionary', () => {
    const URL = `${ADMIN_API_BASE}/accountSummaries`

    it('returns properties from account summaries', async () => {
      mock.onGet(URL).reply({
        accountSummaries: [
          {
            displayName: 'Acme Inc',
            propertySummaries: [
              { displayName: 'My Website', property: 'properties/123456' },
              { displayName: 'My App', property: 'properties/789012' },
            ],
          },
        ],
        nextPageToken: 'page2',
      })

      const result = await service.getPropertiesDictionary({})

      expect(result.items).toEqual([
        { label: 'My Website', value: '123456', note: 'Acme Inc' },
        { label: 'My App', value: '789012', note: 'Acme Inc' },
      ])
      expect(result.cursor).toBe('page2')

      expect(mock.history[0].query).toMatchObject({ pageSize: 200 })
      expect(mock.history[0].headers).toMatchObject({
        Authorization: `Bearer ${ACCESS_TOKEN}`,
      })
    })

    it('filters items by search', async () => {
      mock.onGet(URL).reply({
        accountSummaries: [
          {
            displayName: 'Acme',
            propertySummaries: [
              { displayName: 'My Website', property: 'properties/111' },
              { displayName: 'My App', property: 'properties/222' },
            ],
          },
        ],
      })

      const result = await service.getPropertiesDictionary({ search: 'App' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toBe('My App')
    })

    it('passes pagination cursor', async () => {
      mock.onGet(URL).reply({ accountSummaries: [] })

      await service.getPropertiesDictionary({ cursor: 'page2token' })

      expect(mock.history[0].query).toMatchObject({ pageToken: 'page2token' })
    })

    it('handles empty response', async () => {
      mock.onGet(URL).reply({})

      const result = await service.getPropertiesDictionary({})

      expect(result.items).toEqual([])
      expect(result.cursor).toBeUndefined()
    })

    it('handles null payload', async () => {
      mock.onGet(URL).reply({ accountSummaries: [] })

      const result = await service.getPropertiesDictionary(null)

      expect(result.items).toEqual([])
    })
  })

  describe('getAccountsDictionary', () => {
    const URL = `${ADMIN_API_BASE}/accounts`

    it('returns accounts', async () => {
      mock.onGet(URL).reply({
        accounts: [
          { displayName: 'Acme Inc', name: 'accounts/100200300' },
          { displayName: 'Beta Corp', name: 'accounts/400500600' },
        ],
        nextPageToken: 'next',
      })

      const result = await service.getAccountsDictionary({})

      expect(result.items).toEqual([
        { label: 'Acme Inc', value: '100200300', note: 'accounts/100200300' },
        { label: 'Beta Corp', value: '400500600', note: 'accounts/400500600' },
      ])
      expect(result.cursor).toBe('next')
    })

    it('filters accounts by search', async () => {
      mock.onGet(URL).reply({
        accounts: [
          { displayName: 'Acme Inc', name: 'accounts/100' },
          { displayName: 'Beta Corp', name: 'accounts/200' },
        ],
      })

      const result = await service.getAccountsDictionary({ search: 'Beta' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toBe('Beta Corp')
    })

    it('handles empty accounts list', async () => {
      mock.onGet(URL).reply({})

      const result = await service.getAccountsDictionary({})

      expect(result.items).toEqual([])
    })
  })

  describe('getDimensionsDictionary', () => {
    it('returns dimensions from metadata', async () => {
      mock.onGet(`${DATA_API_BASE}/properties/0/metadata`).reply({
        dimensions: [
          { apiName: 'country', uiName: 'Country', category: 'Geography' },
          { apiName: 'pagePath', uiName: 'Page path', category: 'Page / screen' },
        ],
        metrics: [],
      })

      const result = await service.getDimensionsDictionary({})

      expect(result.items).toEqual([
        { label: 'Country', value: 'country', note: 'Geography' },
        { label: 'Page path', value: 'pagePath', note: 'Page / screen' },
      ])
    })

    it('uses property-specific metadata when propertyId is provided', async () => {
      mock.onGet(`${DATA_API_BASE}/properties/555/metadata`).reply({
        dimensions: [
          { apiName: 'city', uiName: 'City', category: 'Geography' },
        ],
        metrics: [],
      })

      const result = await service.getDimensionsDictionary({
        criteria: { propertyId: '555' },
      })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('city')
    })

    it('filters dimensions by search', async () => {
      mock.onGet(`${DATA_API_BASE}/properties/0/metadata`).reply({
        dimensions: [
          { apiName: 'country', uiName: 'Country', category: 'Geography' },
          { apiName: 'pagePath', uiName: 'Page path', category: 'Page / screen' },
        ],
        metrics: [],
      })

      const result = await service.getDimensionsDictionary({ search: 'page' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('pagePath')
    })
  })

  describe('getMetricsDictionary', () => {
    it('returns metrics from metadata', async () => {
      mock.onGet(`${DATA_API_BASE}/properties/0/metadata`).reply({
        dimensions: [],
        metrics: [
          { apiName: 'activeUsers', uiName: 'Active users', category: 'User' },
          { apiName: 'sessions', uiName: 'Sessions', category: 'Session' },
        ],
      })

      const result = await service.getMetricsDictionary({})

      expect(result.items).toEqual([
        { label: 'Active users', value: 'activeUsers', note: 'User' },
        { label: 'Sessions', value: 'sessions', note: 'Session' },
      ])
    })

    it('filters metrics by search', async () => {
      mock.onGet(`${DATA_API_BASE}/properties/0/metadata`).reply({
        dimensions: [],
        metrics: [
          { apiName: 'activeUsers', uiName: 'Active users', category: 'User' },
          { apiName: 'sessions', uiName: 'Sessions', category: 'Session' },
        ],
      })

      const result = await service.getMetricsDictionary({ search: 'session' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('sessions')
    })
  })

  // ── Reports ──

  describe('runReport', () => {
    it('sends correct request with required params', async () => {
      mock.onPost(`${DATA_API_BASE}/properties/123:runReport`).reply({
        dimensionHeaders: [{ name: 'country' }],
        metricHeaders: [{ name: 'activeUsers', type: 'TYPE_INTEGER' }],
        rows: [
          {
            dimensionValues: [{ value: 'US' }],
            metricValues: [{ value: '1234' }],
          },
        ],
        totals: [
          { metricValues: [{ value: '1234' }] },
        ],
        rowCount: 1,
        metadata: { currencyCode: 'USD' },
      })

      const result = await service.runReport('123', 'activeUsers')

      expect(result).toEqual({
        rows: [{ country: 'US', activeUsers: 1234 }],
        totals: { activeUsers: 1234 },
        rowCount: 1,
        metadata: { currencyCode: 'USD' },
      })

      const call = mock.history[0]
      expect(call.method).toBe('post')
      expect(call.url).toBe(`${DATA_API_BASE}/properties/123:runReport`)
      expect(call.headers).toMatchObject({ Authorization: `Bearer ${ACCESS_TOKEN}` })
      expect(call.body).toMatchObject({
        metrics: [{ name: 'activeUsers' }],
        dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }],
        metricAggregations: ['TOTAL'],
      })
      // No dimensions key when not provided
      expect(call.body.dimensions).toBeUndefined()
    })

    it('normalizes property ID with properties/ prefix', async () => {
      mock.onPost(`${DATA_API_BASE}/properties/456:runReport`).reply({
        rows: [],
        rowCount: 0,
      })

      await service.runReport('properties/456', 'sessions')

      expect(mock.history[0].url).toBe(`${DATA_API_BASE}/properties/456:runReport`)
    })

    it('sends all optional parameters', async () => {
      mock.onPost(`${DATA_API_BASE}/properties/123:runReport`).reply({
        rows: [],
        rowCount: 0,
      })

      const dimFilter = { filter: { fieldName: 'country', stringFilter: { matchType: 'EXACT', value: 'US' } } }
      const orderBy = { metric: { metricName: 'activeUsers' }, desc: true }

      await service.runReport(
        '123',
        'activeUsers,sessions',
        'country,date',
        '2025-01-01',
        '2025-01-31',
        100,
        50,
        dimFilter,
        orderBy
      )

      const body = mock.history[0].body

      expect(body.metrics).toEqual([{ name: 'activeUsers' }, { name: 'sessions' }])
      expect(body.dimensions).toEqual([{ name: 'country' }, { name: 'date' }])
      expect(body.dateRanges).toEqual([{ startDate: '2025-01-01', endDate: '2025-01-31' }])
      expect(body.limit).toBe(100)
      expect(body.offset).toBe(50)
      expect(body.dimensionFilter).toEqual(dimFilter)
      expect(body.orderBys).toEqual([orderBy])
    })

    it('accepts metrics as an array', async () => {
      mock.onPost(`${DATA_API_BASE}/properties/123:runReport`).reply({ rows: [], rowCount: 0 })

      await service.runReport('123', ['activeUsers', 'sessions'])

      expect(mock.history[0].body.metrics).toEqual([
        { name: 'activeUsers' },
        { name: 'sessions' },
      ])
    })

    it('throws when propertyId is missing', async () => {
      await expect(service.runReport(null, 'activeUsers')).rejects.toThrow('"Property" is required')
      await expect(service.runReport('', 'activeUsers')).rejects.toThrow('"Property" is required')
    })

    it('throws when metrics are missing', async () => {
      await expect(service.runReport('123', null)).rejects.toThrow('"Metrics" is required')
      await expect(service.runReport('123', '')).rejects.toThrow('"Metrics" is required')
    })

    it('handles empty rows response', async () => {
      mock.onPost(`${DATA_API_BASE}/properties/123:runReport`).reply({})

      const result = await service.runReport('123', 'activeUsers')

      expect(result.rows).toEqual([])
      expect(result.totals).toBeNull()
      expect(result.rowCount).toBe(0)
    })

    it('throws on API error', async () => {
      mock.onPost(`${DATA_API_BASE}/properties/123:runReport`).replyWithError({
        message: 'Bad Request',
        body: { error: { message: 'Invalid metric name' } },
      })

      await expect(service.runReport('123', 'invalidMetric'))
        .rejects.toThrow('Google Analytics API error: Invalid metric name')
    })
  })

  describe('runRealtimeReport', () => {
    it('sends correct request', async () => {
      mock.onPost(`${DATA_API_BASE}/properties/123:runRealtimeReport`).reply({
        dimensionHeaders: [{ name: 'country' }],
        metricHeaders: [{ name: 'activeUsers', type: 'TYPE_INTEGER' }],
        rows: [
          {
            dimensionValues: [{ value: 'US' }],
            metricValues: [{ value: '42' }],
          },
        ],
        totals: [{ metricValues: [{ value: '42' }] }],
        rowCount: 1,
      })

      const result = await service.runRealtimeReport('123', 'activeUsers', 'country', 50)

      expect(result.rows).toEqual([{ country: 'US', activeUsers: 42 }])
      expect(result.totals).toEqual({ activeUsers: 42 })

      const body = mock.history[0].body
      expect(body.metrics).toEqual([{ name: 'activeUsers' }])
      expect(body.dimensions).toEqual([{ name: 'country' }])
      expect(body.limit).toBe(50)
      expect(body.metricAggregations).toEqual(['TOTAL'])
      // No dateRanges for realtime
      expect(body.dateRanges).toBeUndefined()
    })

    it('omits dimensions when not provided', async () => {
      mock.onPost(`${DATA_API_BASE}/properties/123:runRealtimeReport`).reply({
        rows: [],
        rowCount: 0,
      })

      await service.runRealtimeReport('123', 'activeUsers')

      expect(mock.history[0].body.dimensions).toBeUndefined()
      expect(mock.history[0].body.limit).toBeUndefined()
    })

    it('throws when propertyId is missing', async () => {
      await expect(service.runRealtimeReport('', 'activeUsers'))
        .rejects.toThrow('"Property" is required')
    })

    it('throws when metrics are missing', async () => {
      await expect(service.runRealtimeReport('123', ''))
        .rejects.toThrow('"Metrics" is required')
    })
  })

  describe('getMetadata', () => {
    it('fetches metadata for a specific property', async () => {
      const metadataResponse = {
        name: 'properties/123/metadata',
        dimensions: [{ apiName: 'country', uiName: 'Country' }],
        metrics: [{ apiName: 'activeUsers', uiName: 'Active users' }],
      }

      mock.onGet(`${DATA_API_BASE}/properties/123/metadata`).reply(metadataResponse)

      const result = await service.getMetadata('123')

      expect(result).toEqual(metadataResponse)
      expect(mock.history[0].headers).toMatchObject({
        Authorization: `Bearer ${ACCESS_TOKEN}`,
      })
    })

    it('normalizes property ID with prefix', async () => {
      mock.onGet(`${DATA_API_BASE}/properties/456/metadata`).reply({ dimensions: [], metrics: [] })

      await service.getMetadata('properties/456')

      expect(mock.history[0].url).toBe(`${DATA_API_BASE}/properties/456/metadata`)
    })

    it('falls back to common metadata when propertyId is empty', async () => {
      mock.onGet(`${DATA_API_BASE}/properties/0/metadata`).reply({ dimensions: [], metrics: [] })

      const result = await service.getMetadata('')

      expect(mock.history[0].url).toBe(`${DATA_API_BASE}/properties/0/metadata`)
      expect(result).toEqual({ dimensions: [], metrics: [] })
    })
  })

  // ── Admin ──

  describe('listAccounts', () => {
    const URL = `${ADMIN_API_BASE}/accounts`

    it('lists accounts with defaults', async () => {
      const response = {
        accounts: [
          { name: 'accounts/100', displayName: 'Acme Inc' },
        ],
        nextPageToken: 'next',
      }

      mock.onGet(URL).reply(response)

      const result = await service.listAccounts()

      expect(result).toEqual(response)
      expect(mock.history[0].headers).toMatchObject({
        Authorization: `Bearer ${ACCESS_TOKEN}`,
      })
    })

    it('passes pageSize, pageToken, and showDeleted', async () => {
      mock.onGet(URL).reply({ accounts: [] })

      await service.listAccounts(10, 'page2', true)

      expect(mock.history[0].query).toMatchObject({
        pageSize: 10,
        pageToken: 'page2',
        showDeleted: true,
      })
    })

    it('omits showDeleted when false', async () => {
      mock.onGet(URL).reply({ accounts: [] })

      await service.listAccounts(50, undefined, false)

      expect(mock.history[0].query.showDeleted).toBeUndefined()
    })
  })

  describe('listProperties', () => {
    const URL = `${ADMIN_API_BASE}/properties`

    it('lists properties for an account', async () => {
      const response = {
        properties: [
          { name: 'properties/123', displayName: 'My Website' },
        ],
      }

      mock.onGet(URL).reply(response)

      const result = await service.listProperties('100200300')

      expect(result).toEqual(response)
      expect(mock.history[0].query).toMatchObject({
        filter: 'parent:accounts/100200300',
      })
    })

    it('normalizes account ID with accounts/ prefix', async () => {
      mock.onGet(URL).reply({ properties: [] })

      await service.listProperties('accounts/100200300')

      expect(mock.history[0].query.filter).toBe('parent:accounts/100200300')
    })

    it('passes pagination and showDeleted', async () => {
      mock.onGet(URL).reply({ properties: [] })

      await service.listProperties('100', 25, 'page2', true)

      expect(mock.history[0].query).toMatchObject({
        pageSize: 25,
        pageToken: 'page2',
        showDeleted: true,
      })
    })

    it('throws when accountId is missing', async () => {
      await expect(service.listProperties('')).rejects.toThrow('"Account" is required')
      await expect(service.listProperties(null)).rejects.toThrow('"Account" is required')
    })
  })
})
