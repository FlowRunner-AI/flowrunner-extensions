'use strict'

const { createSandbox } = require('../../../service-sandbox')

const CLIENT_ID = 'test-client-id'
const CLIENT_SECRET = 'test-client-secret'
const ACCESS_TOKEN = 'test-access-token'
const BASE = 'https://graph.facebook.com/v20.0'

describe('Facebook Lead Ads Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
    })

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
      const configItems = sandbox.getConfigItems()

      expect(configItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'clientId', required: true, shared: true }),
          expect.objectContaining({ name: 'clientSecret', required: true, shared: true }),
        ])
      )
    })
  })

  // ── OAuth System Methods ──

  describe('getOAuth2ConnectionURL', () => {
    it('returns connection URL with correct parameters', async () => {
      const url = await service.getOAuth2ConnectionURL()

      expect(url).toContain('https://www.facebook.com/v20.0/dialog/oauth')
      expect(url).toContain(`client_id=${CLIENT_ID}`)
      expect(url).toContain('response_type=code')
      expect(url).toContain('scope=')
      expect(url).toContain('pages_manage_metadata')
      expect(url).toContain('leads_retrieval')
    })
  })

  describe('executeCallback', () => {
    it('exchanges code for tokens and fetches profile', async () => {
      const tokenResponse = {
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        expires_in: 3600,
      }
      const profileResponse = { id: '123', name: 'Test User' }

      mock.onPost(`${BASE}/oauth/access_token`).reply(tokenResponse)
      mock.onGet(`${BASE}/me?fields=id,name`).reply(profileResponse)

      const result = await service.executeCallback({
        code: 'auth-code-123',
        redirectURI: 'https://example.com/callback',
      })

      expect(result).toEqual({
        token: 'new-access-token',
        refreshToken: 'new-refresh-token',
        overwrite: true,
        expirationInSeconds: 3600,
        connectionIdentityName: 'Test User',
      })

      // Verify token request
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toContain('grant_type=authorization_code')
      expect(mock.history[0].body).toContain(`client_id=${CLIENT_ID}`)
      expect(mock.history[0].body).toContain(`client_secret=${CLIENT_SECRET}`)
      expect(mock.history[0].body).toContain('code=auth-code-123')

      // Verify profile request
      expect(mock.history[1].method).toBe('get')
      expect(mock.history[1].headers).toMatchObject({
        Authorization: 'Bearer new-access-token',
      })
    })

    it('uses fallback name when profile name is missing', async () => {
      mock.onPost(`${BASE}/oauth/access_token`).reply({
        access_token: 'token',
        refresh_token: 'refresh',
        expires_in: 3600,
      })
      mock.onGet(`${BASE}/me?fields=id,name`).reply({ id: '123' })

      const result = await service.executeCallback({
        code: 'code',
        redirectURI: 'https://example.com/callback',
      })

      expect(result.connectionIdentityName).toBe('Facebook User')
    })

    it('throws on API error', async () => {
      mock.onPost(`${BASE}/oauth/access_token`).replyWithError({
        message: 'Invalid code',
      })

      await expect(
        service.executeCallback({ code: 'bad-code', redirectURI: 'https://example.com/callback' })
      ).rejects.toThrow()
    })
  })

  describe('refreshToken', () => {
    it('sends correct refresh token request', async () => {
      mock.onPost(`${BASE}/oauth/access_token`).reply({
        access_token: 'refreshed-token',
        expires_in: 7200,
      })

      const result = await service.refreshToken('old-refresh-token')

      expect(result).toEqual({
        token: 'refreshed-token',
        expirationInSeconds: 7200,
      })

      expect(mock.history[0].body).toContain(`client_id=${CLIENT_ID}`)
      expect(mock.history[0].body).toContain(`client_secret=${CLIENT_SECRET}`)
      expect(mock.history[0].body).toContain('refresh_token=old-refresh-token')
      expect(mock.history[0].body).toContain('grant_type=refresh_token')
    })

    it('throws on API error', async () => {
      mock.onPost(`${BASE}/oauth/access_token`).replyWithError({
        message: 'Invalid refresh token',
      })

      await expect(service.refreshToken('bad-token')).rejects.toThrow()
    })
  })

  // ── Dictionary Methods ──

  describe('getAdAccountsDictionary', () => {
    it('returns formatted ad accounts', async () => {
      mock.onGet(`${BASE}/me/adaccounts`).reply({
        data: [
          { id: 'act_111', name: 'Account 1', account_status: 1 },
          { id: 'act_222', name: 'Account 2', account_status: 2 },
        ],
        paging: { cursors: { after: 'cursor-abc' } },
      })

      const result = await service.getAdAccountsDictionary({})

      expect(result.items).toHaveLength(2)
      expect(result.items[0]).toEqual({
        label: 'Account 1',
        value: 'act_111',
        note: 'ID: act_111 | Status: ACTIVE',
      })
      expect(result.items[1].note).toContain('DISABLED')
      expect(result.cursor).toBe('cursor-abc')
    })

    it('filters by search term', async () => {
      mock.onGet(`${BASE}/me/adaccounts`).reply({
        data: [
          { id: 'act_111', name: 'Production Account', account_status: 1 },
          { id: 'act_222', name: 'Test Account', account_status: 1 },
        ],
      })

      const result = await service.getAdAccountsDictionary({ search: 'prod' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toBe('Production Account')
    })

    it('passes cursor for pagination', async () => {
      mock.onGet(`${BASE}/me/adaccounts`).reply({ data: [] })

      await service.getAdAccountsDictionary({ cursor: 'next-page' })

      expect(mock.history[0].query).toMatchObject({ after: 'next-page' })
    })

    it('handles empty payload', async () => {
      mock.onGet(`${BASE}/me/adaccounts`).reply({ data: [] })

      const result = await service.getAdAccountsDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('handles unknown account status', async () => {
      mock.onGet(`${BASE}/me/adaccounts`).reply({
        data: [{ id: 'act_333', name: 'Unknown', account_status: 999 }],
      })

      const result = await service.getAdAccountsDictionary({})

      expect(result.items[0].note).toContain('UNKNOWN')
    })

    it('handles unnamed accounts', async () => {
      mock.onGet(`${BASE}/me/adaccounts`).reply({
        data: [{ id: 'act_444', account_status: 1 }],
      })

      const result = await service.getAdAccountsDictionary({})

      expect(result.items[0].label).toBe('Unnamed Account')
    })
  })

  describe('getCampaignsDictionary', () => {
    it('returns formatted campaigns', async () => {
      mock.onGet(`${BASE}/act_123/campaigns`).reply({
        data: [
          { id: 'camp_1', name: 'Summer Campaign', status: 'ACTIVE', objective: 'OUTCOME_TRAFFIC' },
        ],
        paging: { cursors: { after: 'next' } },
      })

      const result = await service.getCampaignsDictionary({
        criteria: { adAccountId: 'act_123' },
      })

      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toEqual({
        label: 'Summer Campaign',
        value: 'camp_1',
        note: 'ID: camp_1 | Status: ACTIVE | Objective: OUTCOME_TRAFFIC',
      })
      expect(result.cursor).toBe('next')
    })

    it('returns empty when no adAccountId', async () => {
      const result = await service.getCampaignsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('filters by search', async () => {
      mock.onGet(`${BASE}/act_123/campaigns`).reply({
        data: [
          { id: '1', name: 'Summer Sale', status: 'ACTIVE', objective: 'LEADS' },
          { id: '2', name: 'Winter Sale', status: 'ACTIVE', objective: 'LEADS' },
        ],
      })

      const result = await service.getCampaignsDictionary({
        search: 'winter',
        criteria: { adAccountId: 'act_123' },
      })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toBe('Winter Sale')
    })
  })

  describe('getAdSetsDictionary', () => {
    it('returns formatted ad sets with daily budget', async () => {
      mock.onGet(`${BASE}/camp_1/adsets`).reply({
        data: [
          { id: 'as_1', name: 'Target 18-25', status: 'ACTIVE', daily_budget: 5000 },
        ],
      })

      const result = await service.getAdSetsDictionary({
        criteria: { campaignId: 'camp_1' },
      })

      expect(result.items[0].note).toContain('Daily Budget: $50.00')
    })

    it('shows lifetime budget when no daily budget', async () => {
      mock.onGet(`${BASE}/camp_1/adsets`).reply({
        data: [
          { id: 'as_2', name: 'Set 2', status: 'ACTIVE', lifetime_budget: 10000 },
        ],
      })

      const result = await service.getAdSetsDictionary({
        criteria: { campaignId: 'camp_1' },
      })

      expect(result.items[0].note).toContain('Lifetime Budget: $100.00')
    })

    it('shows no budget when neither is set', async () => {
      mock.onGet(`${BASE}/camp_1/adsets`).reply({
        data: [{ id: 'as_3', name: 'Set 3', status: 'ACTIVE' }],
      })

      const result = await service.getAdSetsDictionary({
        criteria: { campaignId: 'camp_1' },
      })

      expect(result.items[0].note).toContain('No budget set')
    })

    it('returns empty when no campaignId', async () => {
      const result = await service.getAdSetsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getPagesDictionary', () => {
    it('returns formatted pages', async () => {
      mock.onGet(`${BASE}/me/accounts`).reply({
        data: [
          { id: 'page_1', name: 'My Business', category: 'Local Business' },
          { id: 'page_2', name: 'My Brand' },
        ],
      })

      const result = await service.getPagesDictionary({})

      expect(result.items).toHaveLength(2)
      expect(result.items[0].note).toBe('ID: page_1 | Category: Local Business')
      expect(result.items[1].note).toBe('ID: page_2')
    })

    it('filters by search', async () => {
      mock.onGet(`${BASE}/me/accounts`).reply({
        data: [
          { id: 'page_1', name: 'My Business', category: 'Local Business' },
          { id: 'page_2', name: 'My Brand', category: 'Brand' },
        ],
      })

      const result = await service.getPagesDictionary({ search: 'brand' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('page_2')
    })
  })

  describe('getLeadFormsDictionary', () => {
    it('fetches page token then returns lead forms', async () => {
      mock.onGet(`${BASE}/page_1`).reply({ access_token: 'page-token-123' })
      mock.onGet(`${BASE}/page_1/leadgen_forms`).reply({
        data: [
          { id: 'form_1', name: 'Contact Form', status: 'ACTIVE', locale: 'en_US' },
        ],
        paging: { cursors: { after: 'next-form' } },
      })

      const result = await service.getLeadFormsDictionary({
        criteria: { pageId: 'page_1' },
      })

      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toEqual({
        label: 'Contact Form',
        value: 'form_1',
        note: 'ID: form_1 | Status: ACTIVE | Locale: en_US',
      })
      expect(result.cursor).toBe('next-form')
    })

    it('returns empty when no pageId', async () => {
      const result = await service.getLeadFormsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('filters by search', async () => {
      mock.onGet(`${BASE}/page_1`).reply({ access_token: 'page-token' })
      mock.onGet(`${BASE}/page_1/leadgen_forms`).reply({
        data: [
          { id: 'f1', name: 'Contact Form', status: 'ACTIVE', locale: 'en_US' },
          { id: 'f2', name: 'Survey Form', status: 'ACTIVE', locale: 'en_US' },
        ],
      })

      const result = await service.getLeadFormsDictionary({
        search: 'survey',
        criteria: { pageId: 'page_1' },
      })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toBe('Survey Form')
    })
  })

  // ── Account Management ──

  describe('getAdAccountInfo', () => {
    it('sends correct request', async () => {
      const responseData = {
        id: 'act_123',
        name: 'My Account',
        account_status: 1,
        balance: 500,
        currency: 'USD',
      }

      mock.onGet(`${BASE}/act_123`).reply(responseData)

      const result = await service.getAdAccountInfo('act_123')

      expect(result).toEqual(responseData)
      expect(mock.history[0].headers).toMatchObject({
        Authorization: `Bearer ${ACCESS_TOKEN}`,
      })
      expect(mock.history[0].query).toMatchObject({
        fields: 'id,name,account_status,balance,currency',
      })
    })
  })

  describe('getAdInsights', () => {
    it('sends correct request', async () => {
      const responseData = { data: [{ impressions: 5000, clicks: 150 }] }

      mock.onGet(`${BASE}/act_123/insights`).reply(responseData)

      const result = await service.getAdInsights('act_123')

      expect(result).toEqual(responseData)
      expect(mock.history[0].query).toMatchObject({
        fields: 'date_start,date_stop,campaign_name,spend,impressions,clicks',
      })
    })
  })

  // ── Campaign Management ──

  describe('createAdCampaign', () => {
    it('sends POST with all parameters', async () => {
      mock.onPost(`${BASE}/act_123/campaigns`).reply({ id: '120214682014080036' })

      const result = await service.createAdCampaign(
        'act_123',
        'Test Campaign',
        'OUTCOME_LEADS',
        'ACTIVE',
        ['NONE'],
        'AUCTION',
        10000,
        5000,
        '2024-01-01T00:00:00Z',
        '2024-12-31T00:00:00Z',
        [{ id: 'label1' }],
        'LOWEST_COST',
        { page_id: 'page_1' }
      )

      expect(result).toEqual({ id: '120214682014080036' })

      const body = JSON.parse(mock.history[0].body)

      expect(body).toMatchObject({
        name: 'Test Campaign',
        objective: 'OUTCOME_LEADS',
        status: 'ACTIVE',
        special_ad_categories: ['NONE'],
        buying_type: 'AUCTION',
        spend_cap: 10000,
        daily_budget: 5000,
        start_time: '2024-01-01T00:00:00Z',
        stop_time: '2024-12-31T00:00:00Z',
        bid_strategy: 'LOWEST_COST',
      })
    })

    it('sends POST with only required parameters', async () => {
      mock.onPost(`${BASE}/act_123/campaigns`).reply({ id: '999' })

      await service.createAdCampaign(
        'act_123',
        'Minimal Campaign',
        'OUTCOME_TRAFFIC',
        undefined,
        ['NONE']
      )

      const body = JSON.parse(mock.history[0].body)

      expect(body.name).toBe('Minimal Campaign')
      expect(body.objective).toBe('OUTCOME_TRAFFIC')
      expect(body.special_ad_categories).toEqual(['NONE'])
    })
  })

  describe('getCampaignInsights', () => {
    it('sends correct request with all parameters', async () => {
      mock.onGet(`${BASE}/camp_1/insights`).reply({ data: [{ impressions: 10000 }] })

      await service.getCampaignInsights('camp_1', 'last_7d', ['1d_click', '7d_click'])

      expect(mock.history[0].query).toMatchObject({
        date_preset: 'last_7d',
        fields: 'impressions,clicks,spend,conversions,reach,frequency,ctr',
        action_attribution_windows: '1d_click,7d_click',
      })
    })

    it('omits action_attribution_windows when not provided', async () => {
      mock.onGet(`${BASE}/camp_1/insights`).reply({ data: [] })

      await service.getCampaignInsights('camp_1', 'last_30d')

      expect(mock.history[0].query).not.toHaveProperty('action_attribution_windows')
    })

    it('omits action_attribution_windows when empty array', async () => {
      mock.onGet(`${BASE}/camp_1/insights`).reply({ data: [] })

      await service.getCampaignInsights('camp_1', 'last_30d', [])

      expect(mock.history[0].query).not.toHaveProperty('action_attribution_windows')
    })
  })

  describe('getAllAdCampaigns', () => {
    it('sends correct request', async () => {
      const responseData = {
        data: [{ id: 'c1', name: 'Campaign 1', status: 'ACTIVE', objective: 'OUTCOME_TRAFFIC' }],
      }

      mock.onGet(`${BASE}/act_123/campaigns`).reply(responseData)

      const result = await service.getAllAdCampaigns('act_123')

      expect(result).toEqual(responseData)
      expect(mock.history[0].query).toMatchObject({
        fields: 'id,name,status,objective',
      })
    })
  })

  describe('updateAdCampaign', () => {
    it('sends POST with update payload', async () => {
      mock.onPost(`${BASE}/camp_1`).reply({ success: true })

      await service.updateAdCampaign(
        'camp_1',
        'Updated Name',
        'OUTCOME_LEADS',
        'PAUSED',
        ['HOUSING'],
        'AUCTION',
        20000,
        10000,
        '2024-06-01T00:00:00Z',
        '2024-12-31T00:00:00Z',
        'COST_CAP',
        { page_id: 'page_1' }
      )

      const body = JSON.parse(mock.history[0].body)

      expect(body).toMatchObject({
        name: 'Updated Name',
        status: 'PAUSED',
        special_ad_categories: ['HOUSING'],
        bid_strategy: 'COST_CAP',
      })
    })
  })

  describe('deleteAdCampaign', () => {
    it('sends DELETE request', async () => {
      mock.onDelete(`${BASE}/camp_1`).reply({ success: true })

      const result = await service.deleteAdCampaign('camp_1')

      expect(result).toEqual({ success: true })
      expect(mock.history[0].method).toBe('delete')
    })
  })

  // ── Ad Set Management ──

  describe('createAdSet', () => {
    it('sends POST with all parameters', async () => {
      mock.onPost(`${BASE}/act_123/adsets`).reply({ id: '120214694681520036' })

      const targeting = { geo_locations: { countries: ['US'] } }

      await service.createAdSet(
        'act_123',
        'camp_1',
        'Test Ad Set',
        'ACTIVE',
        5000,
        '2024-01-01T00:00:00Z',
        '2024-12-31T00:00:00Z',
        targeting,
        'IMPRESSIONS',
        1000,
        'LINK_CLICKS',
        [{ start_minute: 0, end_minute: 1440 }],
        3000,
        'WEBSITE',
        { page_id: 'page_1' }
      )

      const body = JSON.parse(mock.history[0].body)

      expect(body).toMatchObject({
        campaign_id: 'camp_1',
        name: 'Test Ad Set',
        status: 'ACTIVE',
        daily_budget: 5000,
        targeting,
        billing_event: 'IMPRESSIONS',
        bid_amount: 1000,
        optimization_goal: 'LINK_CLICKS',
        destination_type: 'WEBSITE',
      })
    })
  })

  describe('updateAdSet', () => {
    it('sends POST with update payload', async () => {
      mock.onPost(`${BASE}/as_1`).reply({ success: true })

      await service.updateAdSet(
        'as_1',
        'Updated Set',
        'PAUSED',
        7000,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { geo_locations: { countries: ['UK'] } }
      )

      const body = JSON.parse(mock.history[0].body)

      expect(body.name).toBe('Updated Set')
      expect(body.status).toBe('PAUSED')
      expect(body.daily_budget).toBe(7000)
      expect(body.targeting).toEqual({ geo_locations: { countries: ['UK'] } })
    })
  })

  describe('getAllAdSets', () => {
    it('sends correct request', async () => {
      mock.onGet(`${BASE}/camp_1/adsets`).reply({ data: [] })

      await service.getAllAdSets('camp_1')

      expect(mock.history[0].query).toMatchObject({
        fields: 'id,name,status,daily_budget,lifetime_budget,bid_strategy,start_time,end_time',
      })
    })
  })

  describe('deleteAdSet', () => {
    it('sends DELETE request', async () => {
      mock.onDelete(`${BASE}/as_1`).reply({ success: true })

      const result = await service.deleteAdSet('as_1')

      expect(result).toEqual({ success: true })
      expect(mock.history[0].method).toBe('delete')
    })
  })

  describe('getAdSetInsights', () => {
    it('sends correct request with datePreset', async () => {
      mock.onGet(`${BASE}/as_1/insights`).reply({ data: [{ impressions: 1000 }] })

      await service.getAdSetInsights('as_1', 'last_7d')

      expect(mock.history[0].query).toMatchObject({
        date_preset: 'last_7d',
        fields: 'impressions,clicks,spend',
      })
    })

    it('sends request without datePreset', async () => {
      mock.onGet(`${BASE}/as_1/insights`).reply({ data: [] })

      await service.getAdSetInsights('as_1')

      expect(mock.history[0].query).toMatchObject({
        fields: 'impressions,clicks,spend',
      })
    })
  })

  // ── Ad Management ──

  describe('createAd', () => {
    it('sends POST with correct body', async () => {
      mock.onPost(`${BASE}/act_123/ads`).reply({ id: 1234567890 })

      const result = await service.createAd('act_123', 'as_1', 'creative_1', 'My Ad', 'ACTIVE')

      expect(result).toEqual({ id: 1234567890 })

      const body = JSON.parse(mock.history[0].body)

      expect(body).toEqual({
        adset_id: 'as_1',
        creative: { creative_id: 'creative_1' },
        name: 'My Ad',
        status: 'ACTIVE',
      })
    })
  })

  describe('updateAd', () => {
    it('sends POST with creative when provided', async () => {
      mock.onPost(`${BASE}/ad_1`).reply({ success: true })

      await service.updateAd('ad_1', 'new_creative', 'Updated Ad', 'PAUSED')

      const body = JSON.parse(mock.history[0].body)

      expect(body).toEqual({
        creative: { creative_id: 'new_creative' },
        name: 'Updated Ad',
        status: 'PAUSED',
      })
    })

    it('omits creative when creativeId is not provided', async () => {
      mock.onPost(`${BASE}/ad_1`).reply({ success: true })

      await service.updateAd('ad_1', undefined, 'Updated Name', 'ACTIVE')

      const body = JSON.parse(mock.history[0].body)

      expect(body.creative).toBeUndefined()
      expect(body.name).toBe('Updated Name')
    })
  })

  describe('deleteAd', () => {
    it('sends DELETE request', async () => {
      mock.onDelete(`${BASE}/ad_1`).reply({ success: true })

      const result = await service.deleteAd('ad_1')

      expect(result).toEqual({ success: true })
      expect(mock.history[0].method).toBe('delete')
    })
  })

  describe('publishAd', () => {
    it('sends POST with ACTIVE status', async () => {
      mock.onPost(`${BASE}/ad_1`).reply({ success: true })

      await service.publishAd('ad_1')

      const body = JSON.parse(mock.history[0].body)

      expect(body).toEqual({ status: 'ACTIVE' })
    })
  })

  // ── Lead Forms ──

  describe('createLeadForm', () => {
    it('sends POST with correct body', async () => {
      mock.onPost(`${BASE}/page_1/leadgen_forms`).reply({ id: '509803975225108' })

      const questions = [{ type: 'FULL_NAME', key: 'q1' }]
      const privacyPolicy = { url: 'https://example.com/privacy' }

      await service.createLeadForm(
        'page_1',
        'My Form',
        'legal_1',
        privacyPolicy,
        questions,
        'https://example.com/thanks'
      )

      const body = JSON.parse(mock.history[0].body)

      expect(body).toEqual({
        name: 'My Form',
        questions,
        legal_content_id: 'legal_1',
        privacy_policy: privacyPolicy,
        follow_up_action_url: 'https://example.com/thanks',
      })
    })
  })

  describe('getLeadForms', () => {
    it('fetches page token then retrieves forms', async () => {
      mock.onGet(`${BASE}/page_1?fields=access_token`).reply({ access_token: 'page-token' })
      mock.onGet(`${BASE}/page_1/leadgen_forms`).reply({
        data: [{ id: 'form_1', name: 'Form 1' }],
      })

      const result = await service.getLeadForms('page_1')

      expect(result.data).toHaveLength(1)

      // First request uses the user access token
      expect(mock.history[0].headers).toMatchObject({
        Authorization: `Bearer ${ACCESS_TOKEN}`,
      })

      // Second request uses the page access token
      expect(mock.history[1].headers).toMatchObject({
        Authorization: 'Bearer page-token',
      })
    })
  })

  describe('getLeadFormInfo', () => {
    it('sends correct request with all fields', async () => {
      const responseData = {
        id: 'form_1',
        name: 'Contact Form',
        status: 'ACTIVE',
        questions: [],
      }

      mock.onGet(`${BASE}/form_1`).reply(responseData)

      const result = await service.getLeadFormInfo('form_1')

      expect(result).toEqual(responseData)
      expect(mock.history[0].query.fields).toContain('id')
      expect(mock.history[0].query.fields).toContain('name')
      expect(mock.history[0].query.fields).toContain('questions')
      expect(mock.history[0].query.fields).toContain('status')
      expect(mock.history[0].query.fields).toContain('privacy_policy_url')
    })
  })

  describe('archiveLeadGenForm', () => {
    it('sends request with ARCHIVED status', async () => {
      mock.onGet(`${BASE}/page_1/form_1`).reply({ success: true })

      await service.archiveLeadGenForm('page_1', 'form_1')

      expect(mock.history[0].query).toMatchObject({ status: 'ARCHIVED' })
    })
  })

  describe('activateLeadGenForm', () => {
    it('sends request with ACTIVE status', async () => {
      mock.onGet(`${BASE}/page_1/form_1`).reply({ success: true })

      await service.activateLeadGenForm('page_1', 'form_1')

      expect(mock.history[0].query).toMatchObject({ status: 'ACTIVE' })
    })
  })

  // ── Ad Creative Management ──

  describe('createAdCreative', () => {
    it('sends POST with correct payload structure', async () => {
      mock.onPost(`${BASE}/act_123/adcreatives`).reply({ id: '1234567890' })

      await service.createAdCreative(
        'act_123',
        'form_1',
        'Ad description',
        'abc123hash',
        'Click here!',
        'page_1',
        'SIGN_UP'
      )

      const body = JSON.parse(mock.history[0].body)

      expect(body).toEqual({
        object_story_spec: {
          link_data: {
            call_to_action: {
              type: 'SIGN_UP',
              value: { lead_gen_form_id: 'form_1' },
            },
            description: 'Ad description',
            image_hash: 'abc123hash',
            link: 'https://fb.me/',
            message: 'Click here!',
          },
          page_id: 'page_1',
        },
      })
    })
  })

  describe('updateAdCreative', () => {
    it('sends POST with update payload', async () => {
      mock.onPost(`${BASE}/creative_1`).reply({ success: true })

      await service.updateAdCreative(
        'act_123',
        'creative_1',
        [{ id: 'label1', name: 'Tag' }],
        'New Creative Name',
        'ACTIVE'
      )

      const body = JSON.parse(mock.history[0].body)

      expect(body).toEqual({
        account_id: 'act_123',
        adlabels: [{ id: 'label1', name: 'Tag' }],
        name: 'New Creative Name',
        status: 'ACTIVE',
      })
    })
  })

  describe('deleteAdCreative', () => {
    it('sends DELETE request', async () => {
      mock.onDelete(`${BASE}/creative_1`).reply({ success: true })

      const result = await service.deleteAdCreative('creative_1')

      expect(result).toEqual({ success: true })
      expect(mock.history[0].method).toBe('delete')
    })
  })

  describe('getMessengerLeadGenForms', () => {
    it('fetches page token then retrieves messenger-eligible forms', async () => {
      mock.onGet(`https://graph.facebook.com/v20.0/page_1?fields=access_token`).reply({
        access_token: 'page-token',
      })
      mock.onGet(`${BASE}/page_1/leadgen_forms`).reply({
        data: [{ id: 'form_1', is_eligible_for_in_thread_forms: true }],
      })

      const result = await service.getMessengerLeadGenForms('page_1')

      expect(result.data).toHaveLength(1)

      // Second request uses page token and queries for eligibility field
      expect(mock.history[1].headers).toMatchObject({
        Authorization: 'Bearer page-token',
      })
      expect(mock.history[1].query).toMatchObject({
        fields: 'is_eligible_for_in_thread_forms',
      })
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('throws on API request failure', async () => {
      mock.onGet(`${BASE}/act_bad`).replyWithError({ message: 'Not Found' })

      await expect(service.getAdAccountInfo('act_bad')).rejects.toThrow()
    })
  })
})
