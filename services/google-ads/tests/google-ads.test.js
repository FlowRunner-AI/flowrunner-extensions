'use strict'

const { createSandbox } = require('../../../service-sandbox')

const CLIENT_ID = 'test-client-id'
const CLIENT_SECRET = 'test-client-secret'
const DEVELOPER_TOKEN = 'test-developer-token'
const LOGIN_CUSTOMER_ID = '1112223334'
const OAUTH_ACCESS_TOKEN = 'test-oauth-access-token'

const API_VERSION = 'v24'
const API_BASE = `https://googleads.googleapis.com/${API_VERSION}`
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const OAUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const USER_INFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo'

describe('Google Ads Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      developerToken: DEVELOPER_TOKEN,
      loginCustomerId: LOGIN_CUSTOMER_ID,
    })

    require('../src/index.js')
    service = sandbox.getService()
    service.request = { headers: { 'oauth-access-token': OAUTH_ACCESS_TOKEN } }
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
      const configs = sandbox.getConfigItems()

      expect(configs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'clientId', required: true, shared: true }),
          expect.objectContaining({ name: 'clientSecret', required: true, shared: true }),
          expect.objectContaining({ name: 'developerToken', required: true, shared: false }),
          expect.objectContaining({ name: 'loginCustomerId', required: false, shared: false }),
        ])
      )
    })

    it('registers exactly 4 config items', () => {
      expect(sandbox.getConfigItems()).toHaveLength(4)
    })
  })

  // ── OAuth ──

  describe('getOAuth2ConnectionURL', () => {
    it('returns a URL with correct parameters', async () => {
      const url = await service.getOAuth2ConnectionURL()

      expect(url).toContain(OAUTH_URL)
      expect(url).toContain(`client_id=${CLIENT_ID}`)
      expect(url).toContain('response_type=code')
      expect(url).toContain('access_type=offline')
      expect(url).toContain('prompt=consent')
      expect(url).toContain('scope=')
      expect(url).toContain('adwords')
    })
  })

  describe('executeCallback', () => {
    it('exchanges code for token and fetches user info', async () => {
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
        code: 'auth-code',
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
      expect(mock.history[0].body).toContain('grant_type=authorization_code')
      expect(mock.history[0].body).toContain(`client_id=${CLIENT_ID}`)
      expect(mock.history[0].body).toContain(`client_secret=${CLIENT_SECRET}`)
      expect(mock.history[0].body).toContain('code=auth-code')
    })

    it('falls back to email when name is missing', async () => {
      mock.onPost(TOKEN_URL).reply({
        access_token: 'token',
        expires_in: 3600,
      })

      mock.onGet(USER_INFO_URL).reply({
        email: 'user@example.com',
      })

      const result = await service.executeCallback({
        code: 'code',
        redirectURI: 'https://callback.url',
      })

      expect(result.connectionIdentityName).toBe('user@example.com')
      expect(result.connectionIdentityImageURL).toBeNull()
    })

    it('handles user info fetch failure gracefully', async () => {
      mock.onPost(TOKEN_URL).reply({
        access_token: 'token',
        expires_in: 3600,
      })

      mock.onGet(USER_INFO_URL).replyWithError({ message: 'Forbidden' })

      const result = await service.executeCallback({
        code: 'code',
        redirectURI: 'https://callback.url',
      })

      expect(result.token).toBe('token')
      expect(result.connectionIdentityName).toBe('Google Ads Account')
      expect(result.connectionIdentityImageURL).toBeNull()
    })
  })

  describe('refreshToken', () => {
    it('sends refresh request and returns new token', async () => {
      mock.onPost(TOKEN_URL).reply({
        access_token: 'refreshed-token',
        expires_in: 3600,
      })

      const result = await service.refreshToken('old-refresh-token')

      expect(result).toEqual({
        token: 'refreshed-token',
        expirationInSeconds: 3600,
      })

      expect(mock.history[0].query).toMatchObject({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: 'refresh_token',
        refresh_token: 'old-refresh-token',
      })
    })

    it('throws specific error for invalid_grant', async () => {
      mock.onPost(TOKEN_URL).replyWithError({
        message: 'Bad Request',
        body: { error: 'invalid_grant' },
      })

      await expect(service.refreshToken('expired-token'))
        .rejects.toThrow('Refresh token expired or invalid, please re-authenticate.')
    })

    it('re-throws other errors', async () => {
      mock.onPost(TOKEN_URL).replyWithError({
        message: 'Server Error',
        body: { error: 'server_error' },
      })

      await expect(service.refreshToken('token')).rejects.toThrow()
    })
  })

  // ── Dictionaries ──

  describe('getCustomersDictionary', () => {
    const searchUrl = `${API_BASE}/customers/${LOGIN_CUSTOMER_ID}/googleAds:search`

    it('lists client accounts under manager when loginCustomerId is set', async () => {
      mock.onPost(searchUrl).reply({
        results: [
          {
            customerClient: {
              id: '1234567890',
              descriptiveName: 'Acme Corp',
              manager: false,
            },
          },
          {
            customerClient: {
              id: '9876543210',
              descriptiveName: 'Beta LLC',
              manager: true,
            },
          },
        ],
      })

      const result = await service.getCustomersDictionary({})

      expect(result.items).toHaveLength(2)
      expect(result.items[0]).toEqual({
        label: 'Acme Corp (1234567890)',
        value: '1234567890',
        note: 'Client account',
      })
      expect(result.items[1]).toEqual({
        label: 'Beta LLC (9876543210)',
        value: '9876543210',
        note: 'Manager account',
      })
    })

    it('handles client with no descriptive name', async () => {
      mock.onPost(searchUrl).reply({
        results: [
          {
            customerClient: {
              id: '1111111111',
              manager: false,
            },
          },
        ],
      })

      const result = await service.getCustomersDictionary({})

      expect(result.items[0].label).toBe('1111111111')
    })

    it('filters items by search text', async () => {
      mock.onPost(searchUrl).reply({
        results: [
          { customerClient: { id: '1234567890', descriptiveName: 'Acme Corp', manager: false } },
          { customerClient: { id: '9876543210', descriptiveName: 'Beta LLC', manager: false } },
        ],
      })

      const result = await service.getCustomersDictionary({ search: 'acme' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('1234567890')
    })

    it('falls back to directly accessible accounts when client lookup fails', async () => {
      mock.onPost(searchUrl).replyWithError({ message: 'Forbidden' })

      const listUrl = `${API_BASE}/customers:listAccessibleCustomers`

      mock.onGet(listUrl).reply({
        resourceNames: ['customers/5555555555'],
      })

      // The fallback does a name lookup for each account
      mock.onPost(`${API_BASE}/customers/5555555555/googleAds:search`).reply({
        results: [
          {
            customer: {
              id: '5555555555',
              descriptiveName: 'Direct Account',
              manager: false,
            },
          },
        ],
      })

      const result = await service.getCustomersDictionary({})

      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toEqual({
        label: 'Direct Account (5555555555)',
        value: '5555555555',
        note: 'Accessible account',
      })
    })
  })

  describe('getCampaignsDictionary', () => {
    it('returns empty items when no customerId is provided', async () => {
      const result = await service.getCampaignsDictionary({})

      expect(result).toEqual({ items: [] })
      expect(mock.history).toHaveLength(0)
    })

    it('lists campaigns for a customer', async () => {
      const customerId = '1234567890'
      const searchUrl = `${API_BASE}/customers/${customerId}/googleAds:search`

      mock.onPost(searchUrl).reply({
        results: [
          {
            campaign: { id: '111', name: 'Campaign A', status: 'ENABLED' },
          },
          {
            campaign: { id: '222', name: 'Campaign B', status: 'PAUSED' },
          },
        ],
        nextPageToken: 'token123',
      })

      const result = await service.getCampaignsDictionary({
        criteria: { customerId },
      })

      expect(result.items).toHaveLength(2)
      expect(result.items[0]).toEqual({ label: 'Campaign A', value: '111', note: 'ENABLED' })
      expect(result.cursor).toBe('token123')
    })

    it('passes cursor as pageToken and filters by search', async () => {
      const customerId = '1234567890'
      const searchUrl = `${API_BASE}/customers/${customerId}/googleAds:search`

      mock.onPost(searchUrl).reply({
        results: [
          { campaign: { id: '111', name: 'Summer Sale', status: 'ENABLED' } },
          { campaign: { id: '222', name: 'Winter Sale', status: 'ENABLED' } },
        ],
      })

      const result = await service.getCampaignsDictionary({
        search: 'winter',
        cursor: 'page2',
        criteria: { customerId },
      })

      expect(mock.history[0].body).toMatchObject({ pageToken: 'page2' })
      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toBe('Winter Sale')
    })
  })

  // ── Reporting ──

  describe('search', () => {
    const customerId = '1234567890'
    const searchUrl = `${API_BASE}/customers/${customerId}/googleAds:search`

    it('sends GAQL query and returns results', async () => {
      const gaqlQuery = 'SELECT campaign.id FROM campaign'

      mock.onPost(searchUrl).reply({
        results: [{ campaign: { id: '111' } }],
        nextPageToken: 'nextPage',
        fieldMask: 'campaign.id',
      })

      const result = await service.search(customerId, gaqlQuery)

      expect(result).toEqual({
        results: [{ campaign: { id: '111' } }],
        totalCount: 1,
        nextPageToken: 'nextPage',
        fieldMask: 'campaign.id',
      })

      expect(mock.history[0].body).toMatchObject({ query: gaqlQuery })
    })

    it('passes pageToken when provided', async () => {
      mock.onPost(searchUrl).reply({ results: [] })

      await service.search(customerId, 'SELECT campaign.id FROM campaign', 'page2Token')

      expect(mock.history[0].body).toMatchObject({ pageToken: 'page2Token' })
    })

    it('returns null for missing nextPageToken and fieldMask', async () => {
      mock.onPost(searchUrl).reply({})

      const result = await service.search(customerId, 'SELECT campaign.id FROM campaign')

      expect(result.results).toEqual([])
      expect(result.totalCount).toBe(0)
      expect(result.nextPageToken).toBeNull()
      expect(result.fieldMask).toBeNull()
    })

    it('throws when query is missing', async () => {
      await expect(service.search(customerId, '')).rejects.toThrow('"Query" is required')
    })

    it('throws when customerId is missing', async () => {
      await expect(service.search('', 'SELECT campaign.id FROM campaign'))
        .rejects.toThrow('"Customer ID" is required')
    })

    it('normalizes customerId with dashes', async () => {
      const normalizedUrl = `${API_BASE}/customers/1234567890/googleAds:search`

      mock.onPost(normalizedUrl).reply({ results: [] })

      await service.search('123-456-7890', 'SELECT campaign.id FROM campaign')

      expect(mock.history[0].url).toBe(normalizedUrl)
    })

    it('includes auth headers with developer token and login-customer-id', async () => {
      mock.onPost(searchUrl).reply({ results: [] })

      await service.search(customerId, 'SELECT campaign.id FROM campaign')

      expect(mock.history[0].headers).toMatchObject({
        'Authorization': `Bearer ${OAUTH_ACCESS_TOKEN}`,
        'developer-token': DEVELOPER_TOKEN,
        'Content-Type': 'application/json',
        'login-customer-id': LOGIN_CUSTOMER_ID,
      })
    })

    it('throws on API error with extracted detail messages', async () => {
      mock.onPost(searchUrl).replyWithError({
        message: 'Bad Request',
        body: {
          error: {
            message: 'Request contains an invalid argument.',
            details: [
              {
                errors: [
                  { message: 'Unrecognized field in the query' },
                  { message: 'Field is not selectable' },
                ],
              },
            ],
          },
        },
      })

      await expect(service.search(customerId, 'SELECT bad.field FROM campaign'))
        .rejects.toThrow('Unrecognized field in the query; Field is not selectable')
    })
  })

  // ── Accounts ──

  describe('listAccessibleCustomers', () => {
    const listUrl = `${API_BASE}/customers:listAccessibleCustomers`

    it('returns resource names and customer IDs', async () => {
      mock.onGet(listUrl).reply({
        resourceNames: ['customers/1234567890', 'customers/9876543210'],
      })

      const result = await service.listAccessibleCustomers()

      expect(result).toEqual({
        resourceNames: ['customers/1234567890', 'customers/9876543210'],
        customerIds: ['1234567890', '9876543210'],
        totalCount: 2,
      })
    })

    it('handles empty response', async () => {
      mock.onGet(listUrl).reply({})

      const result = await service.listAccessibleCustomers()

      expect(result).toEqual({
        resourceNames: [],
        customerIds: [],
        totalCount: 0,
      })
    })
  })

  // ── Campaigns ──

  describe('listCampaigns', () => {
    const customerId = '1234567890'
    const searchUrl = `${API_BASE}/customers/${customerId}/googleAds:search`

    it('returns campaigns with metrics and converted micros', async () => {
      mock.onPost(searchUrl).reply({
        results: [
          {
            campaign: {
              id: '111',
              name: 'Test Campaign',
              status: 'ENABLED',
              advertisingChannelType: 'SEARCH',
              startDate: '2026-01-01',
              endDate: '2037-12-30',
              resourceName: 'customers/1234567890/campaigns/111',
            },
            campaignBudget: { amountMicros: '50000000' },
            customer: { currencyCode: 'USD' },
            metrics: {
              clicks: '1500',
              impressions: '48000',
              costMicros: '812450000',
              conversions: '37.5',
            },
          },
        ],
        nextPageToken: 'nextPage',
      })

      const result = await service.listCampaigns(customerId, 'Last 30 Days')

      expect(result.campaigns).toHaveLength(1)
      expect(result.campaigns[0]).toEqual({
        id: '111',
        name: 'Test Campaign',
        status: 'ENABLED',
        channelType: 'SEARCH',
        startDate: '2026-01-01',
        endDate: '2037-12-30',
        budget: 50,
        clicks: 1500,
        impressions: 48000,
        cost: 812.45,
        conversions: 37.5,
        currencyCode: 'USD',
        resourceName: 'customers/1234567890/campaigns/111',
      })
      expect(result.totalCount).toBe(1)
      expect(result.nextPageToken).toBe('nextPage')
    })

    it('defaults date range to Last 30 Days', async () => {
      mock.onPost(searchUrl).reply({ results: [] })

      await service.listCampaigns(customerId)

      const queryBody = mock.history[0].body.query

      expect(queryBody).toContain('segments.date DURING LAST_30_DAYS')
    })

    it('handles All Time date range (no date clause)', async () => {
      mock.onPost(searchUrl).reply({ results: [] })

      await service.listCampaigns(customerId, 'All Time')

      const queryBody = mock.history[0].body.query

      expect(queryBody).not.toContain('segments.date')
      expect(queryBody).toContain("campaign.status != 'REMOVED'")
    })

    it('handles Last 90 Days with BETWEEN clause', async () => {
      mock.onPost(searchUrl).reply({ results: [] })

      await service.listCampaigns(customerId, 'Last 90 Days')

      const queryBody = mock.history[0].body.query

      expect(queryBody).toContain('segments.date BETWEEN')
    })

    it('passes pageToken', async () => {
      mock.onPost(searchUrl).reply({ results: [] })

      await service.listCampaigns(customerId, 'Last 30 Days', 'page2')

      expect(mock.history[0].body).toMatchObject({ pageToken: 'page2' })
    })

    it('handles empty results and missing nextPageToken', async () => {
      mock.onPost(searchUrl).reply({})

      const result = await service.listCampaigns(customerId, 'Today')

      expect(result).toEqual({
        campaigns: [],
        totalCount: 0,
        nextPageToken: null,
      })
    })

    it('handles missing metrics and budget gracefully', async () => {
      mock.onPost(searchUrl).reply({
        results: [
          {
            campaign: {
              id: '222',
              name: 'Bare Campaign',
              status: 'PAUSED',
            },
          },
        ],
      })

      const result = await service.listCampaigns(customerId, 'Yesterday')

      expect(result.campaigns[0]).toMatchObject({
        id: '222',
        budget: 0,
        clicks: 0,
        impressions: 0,
        cost: 0,
        conversions: 0,
      })
    })

    it('throws when customerId is missing', async () => {
      await expect(service.listCampaigns(''))
        .rejects.toThrow('"Customer ID" is required')
    })
  })

  describe('getCampaignMetrics', () => {
    const customerId = '1234567890'
    const searchUrl = `${API_BASE}/customers/${customerId}/googleAds:search`

    it('returns metrics for a campaign', async () => {
      mock.onPost(searchUrl).reply({
        results: [
          {
            campaign: { id: '111', name: 'My Campaign', status: 'ENABLED' },
            customer: { currencyCode: 'EUR' },
            metrics: {
              clicks: '500',
              impressions: '10000',
              costMicros: '250000000',
              conversions: '15',
              ctr: '0.05',
              averageCpc: '500000',
            },
          },
        ],
      })

      const result = await service.getCampaignMetrics(customerId, '111', 'Last 7 Days')

      expect(result).toEqual({
        campaignId: '111',
        campaignName: 'My Campaign',
        status: 'ENABLED',
        dateRange: 'Last 7 Days',
        clicks: 500,
        impressions: 10000,
        cost: 250,
        conversions: 15,
        ctr: 0.05,
        averageCpc: 0.5,
        currencyCode: 'EUR',
      })
    })

    it('defaults date range to Last 30 Days', async () => {
      mock.onPost(searchUrl).reply({
        results: [
          {
            campaign: { id: '111', name: 'C', status: 'ENABLED' },
            metrics: {},
          },
        ],
      })

      const result = await service.getCampaignMetrics(customerId, '111')

      expect(result.dateRange).toBe('Last 30 Days')

      const queryBody = mock.history[0].body.query

      expect(queryBody).toContain('segments.date DURING LAST_30_DAYS')
    })

    it('includes campaign ID filter in query', async () => {
      mock.onPost(searchUrl).reply({
        results: [
          {
            campaign: { id: '999', name: 'Test', status: 'PAUSED' },
            metrics: {},
          },
        ],
      })

      await service.getCampaignMetrics(customerId, '999', 'Today')

      const queryBody = mock.history[0].body.query

      expect(queryBody).toContain('campaign.id = 999')
    })

    it('throws when campaign is not found', async () => {
      mock.onPost(searchUrl).reply({ results: [] })

      await expect(service.getCampaignMetrics(customerId, '999', 'Today'))
        .rejects.toThrow('Campaign 999 was not found in this account')
    })

    it('throws when campaignId is missing', async () => {
      await expect(service.getCampaignMetrics(customerId, ''))
        .rejects.toThrow('"Campaign" is required')
    })

    it('throws when customerId is missing', async () => {
      await expect(service.getCampaignMetrics('', '111'))
        .rejects.toThrow('"Customer ID" is required')
    })
  })

  describe('updateCampaignStatus', () => {
    const customerId = '1234567890'
    const campaignId = '21987654321'
    const mutateUrl = `${API_BASE}/customers/${customerId}/campaigns:mutate`

    it('sends mutate request to pause a campaign', async () => {
      mock.onPost(mutateUrl).reply({
        results: [
          { resourceName: `customers/${customerId}/campaigns/${campaignId}` },
        ],
      })

      const result = await service.updateCampaignStatus(customerId, campaignId, 'Paused')

      expect(result).toEqual({
        success: true,
        resourceName: `customers/${customerId}/campaigns/${campaignId}`,
        status: 'PAUSED',
      })

      expect(mock.history[0].body).toEqual({
        operations: [
          {
            update: {
              resourceName: `customers/${customerId}/campaigns/${campaignId}`,
              status: 'PAUSED',
            },
            updateMask: 'status',
          },
        ],
      })
    })

    it('resolves Enabled status to ENABLED', async () => {
      mock.onPost(mutateUrl).reply({ results: [{}] })

      const result = await service.updateCampaignStatus(customerId, campaignId, 'Enabled')

      expect(result.status).toBe('ENABLED')
      expect(mock.history[0].body.operations[0].update.status).toBe('ENABLED')
    })

    it('falls back to resourceName from request when API response is empty', async () => {
      mock.onPost(mutateUrl).reply({})

      const result = await service.updateCampaignStatus(customerId, campaignId, 'Paused')

      expect(result.resourceName).toBe(`customers/${customerId}/campaigns/${campaignId}`)
    })

    it('throws when campaignId is missing', async () => {
      await expect(service.updateCampaignStatus(customerId, '', 'Paused'))
        .rejects.toThrow('"Campaign" is required')
    })

    it('throws when status is missing', async () => {
      await expect(service.updateCampaignStatus(customerId, campaignId, ''))
        .rejects.toThrow('"Status" is required')
    })

    it('throws when customerId is missing', async () => {
      await expect(service.updateCampaignStatus('', campaignId, 'Paused'))
        .rejects.toThrow('"Customer ID" is required')
    })

    it('normalizes customerId with dashes', async () => {
      const normalizedMutateUrl = `${API_BASE}/customers/1234567890/campaigns:mutate`

      mock.onPost(normalizedMutateUrl).reply({ results: [{}] })

      await service.updateCampaignStatus('123-456-7890', campaignId, 'Enabled')

      expect(mock.history[0].url).toBe(normalizedMutateUrl)
    })
  })

  // ── Error extraction ──

  describe('error handling', () => {
    it('extracts nested error details from API error response', async () => {
      const searchUrl = `${API_BASE}/customers/1234567890/googleAds:search`

      mock.onPost(searchUrl).replyWithError({
        message: 'Request had errors',
        body: {
          error: {
            message: 'Top-level error',
            details: [
              {
                errors: [
                  { message: 'First nested error' },
                  { message: 'Second nested error' },
                ],
              },
            ],
          },
        },
      })

      await expect(service.search('1234567890', 'SELECT campaign.id FROM campaign'))
        .rejects.toThrow('First nested error; Second nested error')
    })

    it('falls back to top-level error message when no detail errors', async () => {
      const searchUrl = `${API_BASE}/customers/1234567890/googleAds:search`

      mock.onPost(searchUrl).replyWithError({
        message: 'Request had errors',
        body: {
          error: {
            message: 'Top-level only',
            details: [],
          },
        },
      })

      await expect(service.search('1234567890', 'SELECT campaign.id FROM campaign'))
        .rejects.toThrow('Top-level only')
    })

    it('falls back to error.message when no body.error', async () => {
      const searchUrl = `${API_BASE}/customers/1234567890/googleAds:search`

      mock.onPost(searchUrl).replyWithError({
        message: 'Network failure',
      })

      await expect(service.search('1234567890', 'SELECT campaign.id FROM campaign'))
        .rejects.toThrow('Network failure')
    })
  })
})
