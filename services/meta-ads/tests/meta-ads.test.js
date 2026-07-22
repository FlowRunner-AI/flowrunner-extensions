'use strict'

const crypto = require('crypto')

const { createSandbox } = require('../../../service-sandbox')

const CLIENT_ID = 'test-client-id'
const CLIENT_SECRET = 'test-client-secret'
const OAUTH_TOKEN = 'test-oauth-access-token'

const API_VERSION = 'v25.0'
const GRAPH = `https://graph.facebook.com/${ API_VERSION }`
const OAUTH_URL = `https://www.facebook.com/${ API_VERSION }/dialog/oauth`
const TOKEN_URL = `${ GRAPH }/oauth/access_token`
const ME_PROFILE_URL = `${ GRAPH }/me?fields=id,name`

const ACCOUNT_ID = '123456789'
const ACCOUNT = `act_${ ACCOUNT_ID }`

const AUTH_HEADERS = {
  'Authorization': `Bearer ${ OAUTH_TOKEN }`,
  'Content-Type': 'application/json',
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

describe('Meta Ads Service', () => {
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

    // Simulate the OAuth access token header available at runtime
    service.request = { headers: { 'oauth-access-token': OAUTH_TOKEN } }
  })

  afterEach(() => {
    mock.reset()
    service.request = { headers: { 'oauth-access-token': OAUTH_TOKEN } }
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Registration ──

  describe('service registration', () => {
    it('registers exactly the two shared OAuth config items', () => {
      expect(sandbox.getConfigItems()).toEqual([
        expect.objectContaining({ name: 'clientId', required: true, shared: true, type: 'STRING' }),
        expect.objectContaining({ name: 'clientSecret', required: true, shared: true, type: 'STRING' }),
      ])
    })

    it('exposes every config key the constructor reads', () => {
      const registered = sandbox.getConfigItems().map(item => item.name)

      expect(registered).toEqual(expect.arrayContaining(['clientId', 'clientSecret']))
      expect(service.clientId).toBe(CLIENT_ID)
      expect(service.clientSecret).toBe(CLIENT_SECRET)
    })

    it('defaults the requested scopes to the ads management set', () => {
      expect(service.scopes).toBe('ads_management ads_read business_management pages_show_list')
    })
  })

  // ── OAuth SYSTEM methods ──

  describe('getOAuth2ConnectionURL', () => {
    it('builds the dialog URL with client id, scope and response type', async () => {
      const url = await service.getOAuth2ConnectionURL()

      expect(url.startsWith(`${ OAUTH_URL }/?`)).toBe(true)

      const params = new URLSearchParams(url.split('?')[1])

      expect(params.get('client_id')).toBe(CLIENT_ID)
      expect(params.get('response_type')).toBe('code')
      expect(params.get('scope')).toBe('ads_management ads_read business_management pages_show_list')
    })

    it('issues no HTTP call', async () => {
      await service.getOAuth2ConnectionURL()

      expect(mock.history).toHaveLength(0)
    })
  })

  describe('executeCallback', () => {
    it('exchanges the code, upgrades to a long-lived token and resolves the identity', async () => {
      let call = 0

      mock.onGet(TOKEN_URL).replyWith(() => {
        call += 1

        return call === 1
          ? { access_token: 'short-lived', expires_in: 3600 }
          : { access_token: 'long-lived', expires_in: 5184000 }
      })

      mock.onGet(ME_PROFILE_URL).reply({ id: '99', name: 'Alex Doe' })

      const result = await service.executeCallback({ code: 'auth-code', redirectURI: 'https://example.com/cb' })

      expect(result).toEqual({
        token: 'long-lived',
        refreshToken: 'long-lived',
        overwrite: true,
        expirationInSeconds: 5184000,
        connectionIdentityName: 'Alex Doe',
      })

      expect(mock.history).toHaveLength(3)

      expect(mock.history[0]).toMatchObject({
        method: 'get',
        url: TOKEN_URL,
        query: {
          grant_type: 'authorization_code',
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          redirect_uri: 'https://example.com/cb',
          code: 'auth-code',
        },
      })

      expect(mock.history[1].query).toEqual({
        grant_type: 'fb_exchange_token',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        fb_exchange_token: 'short-lived',
      })

      expect(mock.history[2]).toMatchObject({
        method: 'get',
        url: ME_PROFILE_URL,
        headers: { Authorization: 'Bearer long-lived' },
      })
    })

    it('falls back to the short-lived token and its expiry when the exchange returns neither', async () => {
      let call = 0

      mock.onGet(TOKEN_URL).replyWith(() => {
        call += 1

        return call === 1 ? { access_token: 'short-lived', expires_in: 3600 } : {}
      })

      mock.onGet(ME_PROFILE_URL).reply({ id: '99', name: 'Alex Doe' })

      const result = await service.executeCallback({ code: 'auth-code', redirectURI: 'https://example.com/cb' })

      expect(result.token).toBe('short-lived')
      expect(result.refreshToken).toBe('short-lived')
      expect(result.expirationInSeconds).toBe(3600)
    })

    it('falls back to "Meta User" when the profile has no name', async () => {
      mock.onGet(TOKEN_URL).reply({ access_token: 'tok', expires_in: 10 })
      mock.onGet(ME_PROFILE_URL).reply({ id: '99' })

      const result = await service.executeCallback({ code: 'c', redirectURI: 'https://example.com/cb' })

      expect(result.connectionIdentityName).toBe('Meta User')
    })

    it('rethrows when the code exchange fails', async () => {
      mock.onGet(TOKEN_URL).replyWithError({
        message: 'Bad Request',
        body: { error: { message: 'Invalid verification code format.' } },
      })

      await expect(
        service.executeCallback({ code: 'bad', redirectURI: 'https://example.com/cb' })
      ).rejects.toThrow('Bad Request')

      expect(mock.history).toHaveLength(1)
    })

    it('rethrows when the identity lookup fails', async () => {
      mock.onGet(TOKEN_URL).reply({ access_token: 'tok', expires_in: 10 })
      mock.onGet(ME_PROFILE_URL).replyWithError({ message: 'Profile unavailable' })

      await expect(
        service.executeCallback({ code: 'c', redirectURI: 'https://example.com/cb' })
      ).rejects.toThrow('Profile unavailable')
    })

    it('tolerates a callback object without a redirectURI', async () => {
      mock.onGet(TOKEN_URL).reply({ access_token: 'tok', expires_in: 10 })
      mock.onGet(ME_PROFILE_URL).reply({ name: 'N' })

      await service.executeCallback({ code: 'c' })

      // clean() is not applied here — URLSearchParams stringifies the missing value
      expect(mock.history[0].query.redirect_uri).toBe('undefined')
    })
  })

  describe('refreshToken', () => {
    it('re-exchanges the stored long-lived token via fb_exchange_token', async () => {
      mock.onGet(TOKEN_URL).reply({ access_token: 'renewed', expires_in: 5184000 })

      const result = await service.refreshToken('stored-long-lived')

      expect(result).toEqual({
        token: 'renewed',
        expirationInSeconds: 5184000,
        refreshToken: 'renewed',
      })

      expect(mock.history).toHaveLength(1)

      expect(mock.history[0].query).toEqual({
        grant_type: 'fb_exchange_token',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        fb_exchange_token: 'stored-long-lived',
      })
    })

    it('rethrows when the re-exchange fails', async () => {
      mock.onGet(TOKEN_URL).replyWithError({ message: 'Session has expired' })

      await expect(service.refreshToken('stale')).rejects.toThrow('Session has expired')
    })
  })

  // ── Access token plumbing ──

  describe('access token handling', () => {
    it('sends the runtime oauth-access-token header as a bearer token', async () => {
      mock.onGet(`${ GRAPH }/me/adaccounts`).reply({ data: [] })

      await service.listAdAccounts()

      expect(mock.history[0].headers).toEqual(AUTH_HEADERS)
    })

    it('still issues the call with "Bearer undefined" when the header is absent', async () => {
      service.request = { headers: {} }
      mock.onGet(`${ GRAPH }/me/adaccounts`).reply({ data: [] })

      await service.listAdAccounts()

      expect(mock.history[0].headers.Authorization).toBe('Bearer undefined')
    })

    it('wraps the failure when no request context exists at all', async () => {
      service.request = undefined
      mock.onGet(`${ GRAPH }/me/adaccounts`).reply({ data: [] })

      await expect(service.listAdAccounts()).rejects.toThrow(/Meta Ads API error: .*headers/)
      expect(mock.history).toHaveLength(0)
    })
  })

  // ── Ad Accounts ──

  describe('listAdAccounts', () => {
    it('requests the default field set and limit', async () => {
      mock.onGet(`${ GRAPH }/me/adaccounts`).reply({ data: [{ id: ACCOUNT }], paging: { cursors: { after: 'MjQ' } } })

      const result = await service.listAdAccounts()

      expect(result.data[0].id).toBe(ACCOUNT)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].body).toBeUndefined()

      expect(mock.history[0].query).toEqual({
        fields: 'id,account_id,name,account_status,currency,timezone_name,amount_spent,balance',
        limit: 25,
      })
    })

    it('passes an explicit limit and after cursor', async () => {
      mock.onGet(`${ GRAPH }/me/adaccounts`).reply({ data: [] })

      await service.listAdAccounts(5, 'MjQ')

      expect(mock.history[0].query).toMatchObject({ limit: 5, after: 'MjQ' })
    })

    it('falls back to the default limit for a falsy limit', async () => {
      mock.onGet(`${ GRAPH }/me/adaccounts`).reply({ data: [] })

      await service.listAdAccounts(0)

      expect(mock.history[0].query.limit).toBe(25)
    })
  })

  describe('getAdAccount', () => {
    it.each([
      ['bare id', ACCOUNT_ID],
      ['prefixed id', ACCOUNT],
      ['padded prefixed id', `  ${ ACCOUNT }  `],
    ])('normalizes a %s to the act_ form', async (_label, input) => {
      mock.onGet(`${ GRAPH }/${ ACCOUNT }`).reply({ id: ACCOUNT })

      await service.getAdAccount(input)

      expect(mock.history[0].url).toBe(`${ GRAPH }/${ ACCOUNT }`)
    })

    it('uses the default field list when none is supplied', async () => {
      mock.onGet(`${ GRAPH }/${ ACCOUNT }`).reply({ id: ACCOUNT })

      await service.getAdAccount(ACCOUNT_ID)

      expect(mock.history[0].query.fields).toBe(
        'id,account_id,name,account_status,currency,timezone_name,amount_spent,balance,spend_cap,business'
      )
    })

    it('honours a custom field list', async () => {
      mock.onGet(`${ GRAPH }/${ ACCOUNT }`).reply({ id: ACCOUNT })

      await service.getAdAccount(ACCOUNT_ID, 'id,name')

      expect(mock.history[0].query.fields).toBe('id,name')
    })

    it('produces a bare act_ path for an empty account id', async () => {
      mock.onGet(`${ GRAPH }/act_`).reply({})

      await service.getAdAccount(undefined)

      expect(mock.history[0].url).toBe(`${ GRAPH }/act_`)
    })
  })

  // ── Campaigns ──

  describe('listCampaigns', () => {
    it('requests the account campaigns edge with the default field set', async () => {
      mock.onGet(`${ GRAPH }/${ ACCOUNT }/campaigns`).reply({ data: [] })

      await service.listCampaigns(ACCOUNT_ID)

      expect(mock.history[0].query).toEqual({
        fields: 'id,name,objective,status,effective_status,daily_budget,lifetime_budget,created_time,start_time,stop_time',
        limit: 25,
      })
    })

    it.each([
      ['Active', 'ACTIVE'],
      ['Paused', 'PAUSED'],
      ['Deleted', 'DELETED'],
      ['Pending Review', 'PENDING_REVIEW'],
      ['Disapproved', 'DISAPPROVED'],
      ['Preapproved', 'PREAPPROVED'],
      ['Pending Billing Info', 'PENDING_BILLING_INFO'],
      ['Campaign Paused', 'CAMPAIGN_PAUSED'],
      ['Archived', 'ARCHIVED'],
      ['In Process', 'IN_PROCESS'],
      ['With Issues', 'WITH_ISSUES'],
      ['SOMETHING_ELSE', 'SOMETHING_ELSE'],
    ])('maps effective status %s to %s', async (label, apiValue) => {
      mock.onGet(`${ GRAPH }/${ ACCOUNT }/campaigns`).reply({ data: [] })

      await service.listCampaigns(ACCOUNT_ID, [label])

      expect(mock.history[0].query.effective_status).toBe(JSON.stringify([apiValue]))
    })

    it('JSON-encodes multiple statuses', async () => {
      mock.onGet(`${ GRAPH }/${ ACCOUNT }/campaigns`).reply({ data: [] })

      await service.listCampaigns(ACCOUNT_ID, ['Active', 'Paused'], 10, 'MjQ')

      expect(mock.history[0].query).toMatchObject({
        effective_status: '["ACTIVE","PAUSED"]',
        limit: 10,
        after: 'MjQ',
      })
    })

    it.each([
      ['an empty array', []],
      ['a non-array value', 'Active'],
      ['undefined', undefined],
    ])('omits effective_status for %s', async (_label, input) => {
      mock.onGet(`${ GRAPH }/${ ACCOUNT }/campaigns`).reply({ data: [] })

      await service.listCampaigns(ACCOUNT_ID, input)

      expect(mock.history[0].query.effective_status).toBeUndefined()
    })
  })

  describe('getCampaign', () => {
    it('reads a campaign by id with the default field set', async () => {
      mock.onGet(`${ GRAPH }/c1`).reply({ id: 'c1' })

      await service.getCampaign('c1', ACCOUNT_ID)

      expect(mock.history[0].url).toBe(`${ GRAPH }/c1`)

      expect(mock.history[0].query.fields).toBe(
        'id,name,objective,status,effective_status,daily_budget,lifetime_budget,buying_type,special_ad_categories,created_time,start_time,stop_time'
      )
    })

    it('never sends the picker-only account id', async () => {
      mock.onGet(`${ GRAPH }/c1`).reply({ id: 'c1' })

      await service.getCampaign('c1', ACCOUNT_ID, 'id,name')

      expect(mock.history[0].query).toEqual({ fields: 'id,name' })
    })
  })

  describe('createCampaign', () => {
    it('sends the full body with resolved choices', async () => {
      mock.onPost(`${ GRAPH }/${ ACCOUNT }/campaigns`).reply({ id: 'c1' })

      const result = await service.createCampaign(
        ACCOUNT_ID, 'Summer Sale', 'Traffic', 'Active', ['Housing', 'Credit'], 5000, 20000, 'Reserved'
      )

      expect(result).toEqual({ id: 'c1' })
      expect(mock.history[0].method).toBe('post')

      expect(mock.history[0].body).toEqual({
        name: 'Summer Sale',
        objective: 'OUTCOME_TRAFFIC',
        status: 'ACTIVE',
        special_ad_categories: ['HOUSING', 'CREDIT'],
        daily_budget: 5000,
        lifetime_budget: 20000,
        buying_type: 'RESERVED',
      })
    })

    it('defaults status to PAUSED and buying type to AUCTION', async () => {
      mock.onPost(`${ GRAPH }/${ ACCOUNT }/campaigns`).reply({ id: 'c1' })

      await service.createCampaign(ACCOUNT_ID, 'Name', 'Sales', undefined, undefined)

      expect(mock.history[0].body).toEqual({
        name: 'Name',
        objective: 'OUTCOME_SALES',
        status: 'PAUSED',
        special_ad_categories: [],
        buying_type: 'AUCTION',
      })
    })

    it('drops the "None" special ad category to an empty array', async () => {
      mock.onPost(`${ GRAPH }/${ ACCOUNT }/campaigns`).reply({ id: 'c1' })

      await service.createCampaign(ACCOUNT_ID, 'Name', 'Leads', 'Paused', ['None'])

      expect(mock.history[0].body.special_ad_categories).toEqual([])
    })

    it.each([
      ['Traffic', 'OUTCOME_TRAFFIC'],
      ['Sales', 'OUTCOME_SALES'],
      ['Leads', 'OUTCOME_LEADS'],
      ['Awareness', 'OUTCOME_AWARENESS'],
      ['Engagement', 'OUTCOME_ENGAGEMENT'],
      ['App Promotion', 'OUTCOME_APP_PROMOTION'],
      ['OUTCOME_CUSTOM', 'OUTCOME_CUSTOM'],
    ])('maps objective %s to %s', async (label, apiValue) => {
      mock.onPost(`${ GRAPH }/${ ACCOUNT }/campaigns`).reply({ id: 'c1' })

      await service.createCampaign(ACCOUNT_ID, 'Name', label, 'Paused', [])

      expect(mock.history[0].body.objective).toBe(apiValue)
    })

    it.each([
      ['Housing', 'HOUSING'],
      ['Employment', 'EMPLOYMENT'],
      ['Credit', 'CREDIT'],
      ['Financial Products And Services', 'FINANCIAL_PRODUCTS_SERVICES'],
      ['Issues Elections Politics', 'ISSUES_ELECTIONS_POLITICS'],
      ['ALREADY_RAW', 'ALREADY_RAW'],
    ])('maps special ad category %s to %s', async (label, apiValue) => {
      mock.onPost(`${ GRAPH }/${ ACCOUNT }/campaigns`).reply({ id: 'c1' })

      await service.createCampaign(ACCOUNT_ID, 'Name', 'Leads', 'Paused', [label])

      expect(mock.history[0].body.special_ad_categories).toEqual([apiValue])
    })

    it('omits an empty-string objective entirely', async () => {
      mock.onPost(`${ GRAPH }/${ ACCOUNT }/campaigns`).reply({ id: 'c1' })

      await service.createCampaign(ACCOUNT_ID, 'Name', '', 'Paused', [])

      expect(mock.history[0].body.objective).toBeUndefined()
    })
  })

  describe('updateCampaign', () => {
    it('sends only the supplied fields', async () => {
      mock.onPost(`${ GRAPH }/c1`).reply({ success: true })

      const result = await service.updateCampaign('c1', ACCOUNT_ID, 'Renamed', 'Archived', 1000, 2000)

      expect(result).toEqual({ success: true })

      expect(mock.history[0].body).toEqual({
        name: 'Renamed',
        status: 'ARCHIVED',
        daily_budget: 1000,
        lifetime_budget: 2000,
      })
    })

    it.each([
      ['Active', 'ACTIVE'],
      ['Paused', 'PAUSED'],
      ['Archived', 'ARCHIVED'],
      ['DELETED', 'DELETED'],
    ])('maps status %s to %s', async (label, apiValue) => {
      mock.onPost(`${ GRAPH }/c1`).reply({ success: true })

      await service.updateCampaign('c1', ACCOUNT_ID, undefined, label)

      expect(mock.history[0].body.status).toBe(apiValue)
    })

    it('sends an empty body when nothing is supplied', async () => {
      mock.onPost(`${ GRAPH }/c1`).reply({ success: true })

      await service.updateCampaign('c1')

      expect(mock.history[0].body).toEqual({})
    })
  })

  describe('deleteCampaign', () => {
    it('issues DELETE with no body', async () => {
      mock.onDelete(`${ GRAPH }/c1`).reply({ success: true })

      const result = await service.deleteCampaign('c1', ACCOUNT_ID)

      expect(result).toEqual({ success: true })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].body).toBeUndefined()
      expect(mock.history[0].query).toEqual({})
    })
  })

  // ── Ad Sets ──

  describe('listAdSets', () => {
    it('uses the account edge when no campaign id is given', async () => {
      mock.onGet(`${ GRAPH }/${ ACCOUNT }/adsets`).reply({ data: [] })

      await service.listAdSets(ACCOUNT_ID)

      expect(mock.history[0].url).toBe(`${ GRAPH }/${ ACCOUNT }/adsets`)
      expect(mock.history[0].query.limit).toBe(25)
    })

    it('uses the campaign edge when a campaign id is given', async () => {
      mock.onGet(`${ GRAPH }/c1/adsets`).reply({ data: [] })

      await service.listAdSets(ACCOUNT_ID, 'c1', 50, 'MjQ')

      expect(mock.history[0].url).toBe(`${ GRAPH }/c1/adsets`)
      expect(mock.history[0].query).toMatchObject({ limit: 50, after: 'MjQ' })
    })
  })

  describe('getAdSet', () => {
    it('reads an ad set with the default field set', async () => {
      mock.onGet(`${ GRAPH }/s1`).reply({ id: 's1' })

      await service.getAdSet('s1', ACCOUNT_ID)

      expect(mock.history[0].query.fields).toContain('promoted_object')
    })

    it('honours a custom field list', async () => {
      mock.onGet(`${ GRAPH }/s1`).reply({ id: 's1' })

      await service.getAdSet('s1', ACCOUNT_ID, 'id')

      expect(mock.history[0].query).toEqual({ fields: 'id' })
    })
  })

  describe('createAdSet', () => {
    const targeting = { geo_locations: { countries: ['US'] }, age_min: 18, age_max: 65 }

    it('sends the full body with resolved choices', async () => {
      mock.onPost(`${ GRAPH }/${ ACCOUNT }/adsets`).reply({ id: 's1' })

      await service.createAdSet(
        ACCOUNT_ID, 'US Adults', 'c1', undefined, 90000, 'Link Clicks', 'Conversions',
        'Cost Cap', 250, targeting, { pixel_id: '1', custom_event_type: 'PURCHASE' },
        '2026-06-01T10:00:00-0700', '2026-06-30T10:00:00-0700', 'Active'
      )

      expect(mock.history[0].body).toEqual({
        name: 'US Adults',
        campaign_id: 'c1',
        lifetime_budget: 90000,
        billing_event: 'LINK_CLICKS',
        optimization_goal: 'OFFSITE_CONVERSIONS',
        bid_strategy: 'COST_CAP',
        bid_amount: 250,
        targeting,
        promoted_object: { pixel_id: '1', custom_event_type: 'PURCHASE' },
        start_time: '2026-06-01T10:00:00-0700',
        end_time: '2026-06-30T10:00:00-0700',
        status: 'ACTIVE',
      })
    })

    it('defaults the billing event to IMPRESSIONS and the status to PAUSED', async () => {
      mock.onPost(`${ GRAPH }/${ ACCOUNT }/adsets`).reply({ id: 's1' })

      await service.createAdSet(ACCOUNT_ID, 'N', 'c1', 3000, undefined, undefined, 'Reach', undefined, undefined, targeting)

      expect(mock.history[0].body).toEqual({
        name: 'N',
        campaign_id: 'c1',
        daily_budget: 3000,
        billing_event: 'IMPRESSIONS',
        optimization_goal: 'REACH',
        targeting,
        status: 'PAUSED',
      })
    })

    it.each([
      ['Impressions', 'IMPRESSIONS'],
      ['Link Clicks', 'LINK_CLICKS'],
      ['Post Engagement', 'POST_ENGAGEMENT'],
      ['Thruplay', 'THRUPLAY'],
      ['CUSTOM_EVENT', 'CUSTOM_EVENT'],
    ])('maps billing event %s to %s', async (label, apiValue) => {
      mock.onPost(`${ GRAPH }/${ ACCOUNT }/adsets`).reply({ id: 's1' })

      await service.createAdSet(ACCOUNT_ID, 'N', 'c1', 1, undefined, label, 'Reach', undefined, undefined, targeting)

      expect(mock.history[0].body.billing_event).toBe(apiValue)
    })

    it.each([
      ['Link Clicks', 'LINK_CLICKS'],
      ['Impressions', 'IMPRESSIONS'],
      ['Reach', 'REACH'],
      ['Landing Page Views', 'LANDING_PAGE_VIEWS'],
      ['Conversions', 'OFFSITE_CONVERSIONS'],
      ['Lead Generation', 'LEAD_GENERATION'],
      ['Post Engagement', 'POST_ENGAGEMENT'],
      ['Thruplay', 'THRUPLAY'],
      ['VALUE', 'VALUE'],
    ])('maps optimization goal %s to %s', async (label, apiValue) => {
      mock.onPost(`${ GRAPH }/${ ACCOUNT }/adsets`).reply({ id: 's1' })

      await service.createAdSet(ACCOUNT_ID, 'N', 'c1', 1, undefined, undefined, label, undefined, undefined, targeting)

      expect(mock.history[0].body.optimization_goal).toBe(apiValue)
    })

    it.each([
      ['Lowest Cost', 'LOWEST_COST_WITHOUT_CAP'],
      ['Cost Cap', 'COST_CAP'],
      ['Bid Cap', 'LOWEST_COST_WITH_BID_CAP'],
      ['LOWEST_COST_WITH_MIN_ROAS', 'LOWEST_COST_WITH_MIN_ROAS'],
    ])('maps bid strategy %s to %s', async (label, apiValue) => {
      mock.onPost(`${ GRAPH }/${ ACCOUNT }/adsets`).reply({ id: 's1' })

      await service.createAdSet(ACCOUNT_ID, 'N', 'c1', 1, undefined, undefined, 'Reach', label, undefined, targeting)

      expect(mock.history[0].body.bid_strategy).toBe(apiValue)
    })
  })

  describe('updateAdSet', () => {
    it('sends only the supplied fields', async () => {
      mock.onPost(`${ GRAPH }/s1`).reply({ success: true })

      const targeting = { geo_locations: { countries: ['CA'] } }

      await service.updateAdSet(
        's1', ACCOUNT_ID, 'Renamed', 'Paused', 4000, 50000, 300, 'Landing Page Views',
        targeting, '2026-07-01T00:00:00-0700', '2026-07-31T00:00:00-0700'
      )

      expect(mock.history[0].body).toEqual({
        name: 'Renamed',
        status: 'PAUSED',
        daily_budget: 4000,
        lifetime_budget: 50000,
        bid_amount: 300,
        optimization_goal: 'LANDING_PAGE_VIEWS',
        targeting,
        start_time: '2026-07-01T00:00:00-0700',
        end_time: '2026-07-31T00:00:00-0700',
      })
    })

    it('sends an empty body when nothing is supplied', async () => {
      mock.onPost(`${ GRAPH }/s1`).reply({ success: true })

      await service.updateAdSet('s1')

      expect(mock.history[0].body).toEqual({})
    })
  })

  describe('deleteAdSet', () => {
    it('issues DELETE with no body', async () => {
      mock.onDelete(`${ GRAPH }/s1`).reply({ success: true })

      await service.deleteAdSet('s1', ACCOUNT_ID)

      expect(mock.history[0]).toMatchObject({ method: 'delete', url: `${ GRAPH }/s1` })
      expect(mock.history[0].body).toBeUndefined()
    })
  })

  // ── Ads ──

  describe('listAds', () => {
    it('uses the account edge when no ad set id is given', async () => {
      mock.onGet(`${ GRAPH }/${ ACCOUNT }/ads`).reply({ data: [] })

      await service.listAds(ACCOUNT_ID)

      expect(mock.history[0].url).toBe(`${ GRAPH }/${ ACCOUNT }/ads`)
      expect(mock.history[0].query.fields).toBe('id,name,adset_id,campaign_id,status,effective_status,creative')
    })

    it('uses the ad set edge when an ad set id is given', async () => {
      mock.onGet(`${ GRAPH }/s1/ads`).reply({ data: [] })

      await service.listAds(ACCOUNT_ID, 's1', 100, 'MjQ')

      expect(mock.history[0].url).toBe(`${ GRAPH }/s1/ads`)
      expect(mock.history[0].query).toMatchObject({ limit: 100, after: 'MjQ' })
    })
  })

  describe('getAd', () => {
    it('reads an ad with the default field set', async () => {
      mock.onGet(`${ GRAPH }/a1`).reply({ id: 'a1' })

      await service.getAd('a1')

      expect(mock.history[0].query.fields).toBe('id,name,adset_id,campaign_id,status,effective_status,creative,created_time')
    })

    it('honours a custom field list', async () => {
      mock.onGet(`${ GRAPH }/a1`).reply({ id: 'a1' })

      await service.getAd('a1', 'id,name')

      expect(mock.history[0].query).toEqual({ fields: 'id,name' })
    })
  })

  describe('createAd', () => {
    it('nests the creative id and defaults the status to PAUSED', async () => {
      mock.onPost(`${ GRAPH }/${ ACCOUNT }/ads`).reply({ id: 'a1' })

      await service.createAd(ACCOUNT_ID, 'Ad 1', 's1', 'cr1')

      expect(mock.history[0].body).toEqual({
        name: 'Ad 1',
        adset_id: 's1',
        creative: { creative_id: 'cr1' },
        status: 'PAUSED',
      })
    })

    it('honours an explicit Active status', async () => {
      mock.onPost(`${ GRAPH }/${ ACCOUNT }/ads`).reply({ id: 'a1' })

      await service.createAd(ACCOUNT_ID, 'Ad 1', 's1', 'cr1', 'Active')

      expect(mock.history[0].body.status).toBe('ACTIVE')
    })
  })

  describe('updateAd', () => {
    it('sends name and mapped status', async () => {
      mock.onPost(`${ GRAPH }/a1`).reply({ success: true })

      await service.updateAd('a1', 'Renamed', 'Archived')

      expect(mock.history[0].body).toEqual({ name: 'Renamed', status: 'ARCHIVED' })
    })

    it('sends an empty body when nothing is supplied', async () => {
      mock.onPost(`${ GRAPH }/a1`).reply({ success: true })

      await service.updateAd('a1')

      expect(mock.history[0].body).toEqual({})
    })
  })

  describe('deleteAd', () => {
    it('issues DELETE with no body', async () => {
      mock.onDelete(`${ GRAPH }/a1`).reply({ success: true })

      await service.deleteAd('a1')

      expect(mock.history[0]).toMatchObject({ method: 'delete', url: `${ GRAPH }/a1` })
    })
  })

  // ── Creatives ──

  describe('listAdCreatives', () => {
    it('requests the account adcreatives edge', async () => {
      mock.onGet(`${ GRAPH }/${ ACCOUNT }/adcreatives`).reply({ data: [] })

      await service.listAdCreatives(ACCOUNT_ID, 5, 'MjQ')

      expect(mock.history[0].query).toEqual({
        fields: 'id,name,title,body,object_story_spec,thumbnail_url',
        limit: 5,
        after: 'MjQ',
      })
    })
  })

  describe('getAdCreative', () => {
    it('reads a creative with the default field set', async () => {
      mock.onGet(`${ GRAPH }/cr1`).reply({ id: 'cr1' })

      await service.getAdCreative('cr1')

      expect(mock.history[0].query.fields).toContain('image_hash')
    })

    it('honours a custom field list', async () => {
      mock.onGet(`${ GRAPH }/cr1`).reply({ id: 'cr1' })

      await service.getAdCreative('cr1', 'id')

      expect(mock.history[0].query).toEqual({ fields: 'id' })
    })
  })

  describe('createLinkAdCreative', () => {
    it('builds an object_story_spec from the convenience fields', async () => {
      mock.onPost(`${ GRAPH }/${ ACCOUNT }/adcreatives`).reply({ id: 'cr1' })

      await service.createLinkAdCreative(
        ACCOUNT_ID, 'Summer Creative', '1122334455', 'https://example.com',
        'Shop now', 'Big Summer Sale', 'Up to 50% off', 'Shop Now', 'hash123'
      )

      expect(mock.history[0].body).toEqual({
        name: 'Summer Creative',
        object_story_spec: {
          page_id: '1122334455',
          link_data: {
            link: 'https://example.com',
            message: 'Shop now',
            name: 'Big Summer Sale',
            description: 'Up to 50% off',
            image_hash: 'hash123',
            call_to_action: { type: 'SHOP_NOW', value: { link: 'https://example.com' } },
          },
        },
      })
    })

    it('uses the picture URL when no image hash is given and omits the CTA when unset', async () => {
      mock.onPost(`${ GRAPH }/${ ACCOUNT }/adcreatives`).reply({ id: 'cr1' })

      await service.createLinkAdCreative(
        ACCOUNT_ID, 'C', '1122334455', 'https://example.com', undefined, undefined, undefined,
        undefined, undefined, 'https://cdn.example.com/img.jpg'
      )

      expect(mock.history[0].body.object_story_spec.link_data).toEqual({
        link: 'https://example.com',
        picture: 'https://cdn.example.com/img.jpg',
      })
    })

    it.each([
      ['Learn More', 'LEARN_MORE'],
      ['Shop Now', 'SHOP_NOW'],
      ['Sign Up', 'SIGN_UP'],
      ['Subscribe', 'SUBSCRIBE'],
      ['Contact Us', 'CONTACT_US'],
      ['Download', 'DOWNLOAD'],
      ['GET_QUOTE', 'GET_QUOTE'],
    ])('maps call to action %s to %s', async (label, apiValue) => {
      mock.onPost(`${ GRAPH }/${ ACCOUNT }/adcreatives`).reply({ id: 'cr1' })

      await service.createLinkAdCreative(ACCOUNT_ID, 'C', 'p1', 'https://example.com', undefined, undefined, undefined, label)

      expect(mock.history[0].body.object_story_spec.link_data.call_to_action.type).toBe(apiValue)
    })

    it('lets a raw object story spec override every convenience field', async () => {
      mock.onPost(`${ GRAPH }/${ ACCOUNT }/adcreatives`).reply({ id: 'cr1' })

      const raw = { page_id: 'p9', video_data: { video_id: 'v1' } }

      await service.createLinkAdCreative(
        ACCOUNT_ID, 'C', 'ignored', 'https://ignored.example.com', 'ignored',
        'ignored', 'ignored', 'Shop Now', 'ignored', 'ignored', raw
      )

      expect(mock.history[0].body).toEqual({ name: 'C', object_story_spec: raw })
    })

    it('still sends a story spec shell when no link fields are provided', async () => {
      mock.onPost(`${ GRAPH }/${ ACCOUNT }/adcreatives`).reply({ id: 'cr1' })

      await service.createLinkAdCreative(ACCOUNT_ID, 'C')

      expect(mock.history[0].body).toEqual({
        name: 'C',
        object_story_spec: { page_id: undefined, link_data: {} },
      })
    })
  })

  // ── Ad Images ──

  describe('uploadAdImage', () => {
    const FILE_URL = 'https://files.flowrunner.io/img.jpg'

    it('downloads the file as binary and posts its base64 bytes', async () => {
      const bytes = Buffer.from('image-bytes')

      mock.onGet(FILE_URL).reply(bytes)

      mock.onPost(`${ GRAPH }/${ ACCOUNT }/adimages`).reply({
        images: { 'a1b2c3.jpg': { hash: 'e5f6', url: 'https://scontent.example.com/adimage.jpg' } },
      })

      const result = await service.uploadAdImage(ACCOUNT_ID, FILE_URL)

      expect(result).toEqual({
        hash: 'e5f6',
        name: 'a1b2c3.jpg',
        images: { 'a1b2c3.jpg': { hash: 'e5f6', url: 'https://scontent.example.com/adimage.jpg' } },
      })

      expect(mock.history[0]).toMatchObject({ method: 'get', url: FILE_URL, encoding: null })
      expect(mock.history[1].body).toEqual({ bytes: bytes.toString('base64') })
    })

    it('wraps a non-buffer download body into a buffer', async () => {
      mock.onGet(FILE_URL).reply('raw-string-bytes')
      mock.onPost(`${ GRAPH }/${ ACCOUNT }/adimages`).reply({ images: { 'x.png': { hash: 'h' } } })

      const result = await service.uploadAdImage(ACCOUNT, FILE_URL)

      expect(mock.history[1].body.bytes).toBe(Buffer.from('raw-string-bytes').toString('base64'))
      expect(result.hash).toBe('h')
    })

    it('returns undefined hash and name when the response carries no images map', async () => {
      mock.onGet(FILE_URL).reply(Buffer.from('x'))
      mock.onPost(`${ GRAPH }/${ ACCOUNT }/adimages`).reply({})

      const result = await service.uploadAdImage(ACCOUNT_ID, FILE_URL)

      expect(result).toEqual({ hash: undefined, name: undefined, images: {} })
    })

    it('propagates the raw download error unwrapped', async () => {
      mock.onGet(FILE_URL).replyWithError({ message: 'File not found' })

      await expect(service.uploadAdImage(ACCOUNT_ID, FILE_URL)).rejects.toThrow('File not found')
      expect(mock.history).toHaveLength(1)
    })

    it('wraps an upload failure in the Meta error envelope', async () => {
      mock.onGet(FILE_URL).reply(Buffer.from('x'))

      mock.onPost(`${ GRAPH }/${ ACCOUNT }/adimages`).replyWithError({
        message: 'Bad Request',
        body: { error: { message: 'Invalid image format', code: 100 } },
      })

      await expect(service.uploadAdImage(ACCOUNT_ID, FILE_URL))
        .rejects.toThrow('Meta Ads API error: Invalid image format | code=100')
    })
  })

  // ── Insights ──

  describe('getInsights', () => {
    const INSIGHTS_URL = `${ GRAPH }/${ ACCOUNT }/insights`

    it('applies the default metric set and limit', async () => {
      mock.onGet(INSIGHTS_URL).reply({ data: [] })

      await service.getInsights(ACCOUNT)

      expect(mock.history[0].query).toEqual({
        fields: 'impressions,clicks,spend,cpc,cpm,ctr,reach',
        limit: 25,
      })
    })

    it.each([
      ['Impressions', 'impressions'],
      ['Clicks', 'clicks'],
      ['Spend', 'spend'],
      ['CPC', 'cpc'],
      ['CPM', 'cpm'],
      ['CTR', 'ctr'],
      ['Reach', 'reach'],
      ['Frequency', 'frequency'],
      ['Actions', 'actions'],
      ['Cost Per Action', 'cost_per_action_type'],
      ['Unique Clicks', 'unique_clicks'],
      ['video_p50_watched_actions', 'video_p50_watched_actions'],
    ])('maps field %s to %s', async (label, apiValue) => {
      mock.onGet(INSIGHTS_URL).reply({ data: [] })

      await service.getInsights(ACCOUNT, undefined, [label])

      expect(mock.history[0].query.fields).toBe(apiValue)
    })

    it('falls back to the default metrics for an empty field selection', async () => {
      mock.onGet(INSIGHTS_URL).reply({ data: [] })

      await service.getInsights(ACCOUNT, undefined, [])

      expect(mock.history[0].query.fields).toBe('impressions,clicks,spend,cpc,cpm,ctr,reach')
    })

    it.each([
      ['Account', 'account'],
      ['Campaign', 'campaign'],
      ['Ad Set', 'adset'],
      ['Ad', 'ad'],
      ['adset', 'adset'],
    ])('maps level %s to %s', async (label, apiValue) => {
      mock.onGet(INSIGHTS_URL).reply({ data: [] })

      await service.getInsights(ACCOUNT, label)

      expect(mock.history[0].query.level).toBe(apiValue)
    })

    it.each([
      ['Today', 'today'],
      ['Yesterday', 'yesterday'],
      ['Last 7 Days', 'last_7d'],
      ['Last 14 Days', 'last_14d'],
      ['Last 30 Days', 'last_30d'],
      ['This Month', 'this_month'],
      ['Last Month', 'last_month'],
      ['Maximum', 'maximum'],
      ['last_90d', 'last_90d'],
    ])('maps date preset %s to %s', async (label, apiValue) => {
      mock.onGet(INSIGHTS_URL).reply({ data: [] })

      await service.getInsights(ACCOUNT, undefined, undefined, label)

      expect(mock.history[0].query.date_preset).toBe(apiValue)
      expect(mock.history[0].query.time_range).toBeUndefined()
    })

    it('sends a JSON time_range and drops the date preset when both dates are given', async () => {
      mock.onGet(INSIGHTS_URL).reply({ data: [] })

      await service.getInsights(ACCOUNT, 'Campaign', ['Spend'], 'Last 7 Days', '2026-06-01', '2026-06-30')

      expect(mock.history[0].query.time_range).toBe('{"since":"2026-06-01","until":"2026-06-30"}')
      expect(mock.history[0].query.date_preset).toBeUndefined()
    })

    it.each([
      ['only since', '2026-06-01', undefined],
      ['only until', undefined, '2026-06-30'],
    ])('keeps the date preset when %s is supplied', async (_label, since, until) => {
      mock.onGet(INSIGHTS_URL).reply({ data: [] })

      await service.getInsights(ACCOUNT, undefined, undefined, 'Today', since, until)

      expect(mock.history[0].query.time_range).toBeUndefined()
      expect(mock.history[0].query.date_preset).toBe('today')
    })

    it.each([
      ['Age', 'age'],
      ['Gender', 'gender'],
      ['Country', 'country'],
      ['Region', 'region'],
      ['Platform', 'publisher_platform'],
      ['Placement', 'platform_position'],
      ['device_platform', 'device_platform'],
    ])('maps breakdown %s to %s', async (label, apiValue) => {
      mock.onGet(INSIGHTS_URL).reply({ data: [] })

      await service.getInsights(ACCOUNT, undefined, undefined, undefined, undefined, undefined, [label])

      expect(mock.history[0].query.breakdowns).toBe(apiValue)
    })

    it('joins multiple breakdowns and forwards time increment, limit and cursor', async () => {
      mock.onGet(INSIGHTS_URL).reply({ data: [] })

      await service.getInsights(
        ACCOUNT, 'Ad', ['Impressions', 'Spend'], undefined, undefined, undefined, ['Age', 'Gender'], 1, 100, 'MjQ'
      )

      expect(mock.history[0].query).toEqual({
        fields: 'impressions,spend',
        level: 'ad',
        breakdowns: 'age,gender',
        time_increment: 1,
        limit: 100,
        after: 'MjQ',
      })
    })

    it('omits breakdowns for an empty selection', async () => {
      mock.onGet(INSIGHTS_URL).reply({ data: [] })

      await service.getInsights(ACCOUNT, undefined, undefined, undefined, undefined, undefined, [])

      expect(mock.history[0].query.breakdowns).toBeUndefined()
    })

    it('does not prefix a campaign object id with act_', async () => {
      mock.onGet(`${ GRAPH }/120210000000000000/insights`).reply({ data: [] })

      await service.getInsights('120210000000000000')

      expect(mock.history[0].url).toBe(`${ GRAPH }/120210000000000000/insights`)
    })
  })

  // ── Custom Audiences ──

  describe('listCustomAudiences', () => {
    it('requests the account customaudiences edge', async () => {
      mock.onGet(`${ GRAPH }/${ ACCOUNT }/customaudiences`).reply({ data: [] })

      await service.listCustomAudiences(ACCOUNT_ID, 10, 'MjQ')

      expect(mock.history[0].query).toEqual({
        fields: 'id,name,subtype,approximate_count_lower_bound,delivery_status',
        limit: 10,
        after: 'MjQ',
      })
    })
  })

  describe('createCustomAudience', () => {
    it('always sends subtype CUSTOM', async () => {
      mock.onPost(`${ GRAPH }/${ ACCOUNT }/customaudiences`).reply({ id: 'au1' })

      await service.createCustomAudience(ACCOUNT_ID, 'Subscribers', 'Both', 'From the newsletter')

      expect(mock.history[0].body).toEqual({
        name: 'Subscribers',
        subtype: 'CUSTOM',
        customer_file_source: 'BOTH_USER_AND_PARTNER_PROVIDED',
        description: 'From the newsletter',
      })
    })

    it.each([
      ['User Provided Only', 'USER_PROVIDED_ONLY'],
      ['Partner Provided Only', 'PARTNER_PROVIDED_ONLY'],
      ['Both', 'BOTH_USER_AND_PARTNER_PROVIDED'],
      ['USER_PROVIDED_ONLY', 'USER_PROVIDED_ONLY'],
    ])('maps customer file source %s to %s', async (label, apiValue) => {
      mock.onPost(`${ GRAPH }/${ ACCOUNT }/customaudiences`).reply({ id: 'au1' })

      await service.createCustomAudience(ACCOUNT_ID, 'N', label)

      expect(mock.history[0].body.customer_file_source).toBe(apiValue)
    })

    it('omits the description when not supplied', async () => {
      mock.onPost(`${ GRAPH }/${ ACCOUNT }/customaudiences`).reply({ id: 'au1' })

      await service.createCustomAudience(ACCOUNT_ID, 'N', 'Both')

      expect(mock.history[0].body).not.toHaveProperty('description')
    })
  })

  describe('addUsersToAudience', () => {
    const URL = `${ GRAPH }/au1/users`

    it('normalizes and SHA256-hashes emails by default', async () => {
      mock.onPost(URL).reply({ num_received: 2 })

      await service.addUsersToAudience('au1', ACCOUNT_ID, ['  Alex@Acme.COM ', 'bob@acme.com'])

      expect(mock.history[0].method).toBe('post')

      expect(mock.history[0].body).toEqual({
        payload: {
          schema: ['EMAIL_SHA256'],
          data: [[sha256('alex@acme.com')], [sha256('bob@acme.com')]],
        },
      })
    })

    it('strips non-digits and leading zeros for the Phone schema', async () => {
      mock.onPost(URL).reply({ num_received: 1 })

      await service.addUsersToAudience('au1', ACCOUNT_ID, ['+1 (555) 010-2030'], 'Phone')

      expect(mock.history[0].body).toEqual({
        payload: {
          schema: ['PHONE_SHA256'],
          data: [[sha256('15550102030')]],
        },
      })
    })

    it('strips leading zeros from an international prefix', async () => {
      mock.onPost(URL).reply({ num_received: 1 })

      await service.addUsersToAudience('au1', ACCOUNT_ID, ['0044 20 7946 0000'], 'Phone')

      expect(mock.history[0].body.payload.data).toEqual([[sha256('442079460000')]])
    })

    it('sends an empty data set when no users are supplied', async () => {
      mock.onPost(URL).reply({ num_received: 0 })

      await service.addUsersToAudience('au1', ACCOUNT_ID, undefined)

      expect(mock.history[0].body.payload.data).toEqual([])
    })

    it('hashes falsy entries as the empty string', async () => {
      mock.onPost(URL).reply({ num_received: 1 })

      await service.addUsersToAudience('au1', ACCOUNT_ID, [null])

      expect(mock.history[0].body.payload.data).toEqual([[sha256('')]])
    })

    it.each([
      ['Email', 'EMAIL_SHA256'],
      ['Phone', 'PHONE_SHA256'],
      [undefined, 'EMAIL_SHA256'],
      ['MOBILE_ADVERTISER_ID', 'MOBILE_ADVERTISER_ID'],
    ])('maps schema %s to %s', async (label, apiValue) => {
      mock.onPost(URL).reply({})

      await service.addUsersToAudience('au1', ACCOUNT_ID, ['a@b.com'], label)

      expect(mock.history[0].body.payload.schema).toEqual([apiValue])
    })
  })

  describe('removeUsersFromAudience', () => {
    const URL = `${ GRAPH }/au1/users`

    it('issues DELETE with the same hashed payload shape', async () => {
      mock.onDelete(URL).reply({ num_received: 1 })

      await service.removeUsersFromAudience('au1', ACCOUNT_ID, ['Alex@Acme.com'], 'Email')

      expect(mock.history[0].method).toBe('delete')

      expect(mock.history[0].body).toEqual({
        payload: { schema: ['EMAIL_SHA256'], data: [[sha256('alex@acme.com')]] },
      })
    })

    it('supports the Phone schema', async () => {
      mock.onDelete(URL).reply({})

      await service.removeUsersFromAudience('au1', ACCOUNT_ID, ['555-0102'], 'Phone')

      expect(mock.history[0].body.payload).toEqual({
        schema: ['PHONE_SHA256'],
        data: [[sha256('5550102')]],
      })
    })

    it('sends an empty data set when no users are supplied', async () => {
      mock.onDelete(URL).reply({})

      await service.removeUsersFromAudience('au1', ACCOUNT_ID)

      expect(mock.history[0].body.payload.data).toEqual([])
    })
  })

  describe('deleteCustomAudience', () => {
    it('issues DELETE on the audience node', async () => {
      mock.onDelete(`${ GRAPH }/au1`).reply({ success: true })

      await service.deleteCustomAudience('au1', ACCOUNT_ID)

      expect(mock.history[0]).toMatchObject({ method: 'delete', url: `${ GRAPH }/au1` })
      expect(mock.history[0].body).toBeUndefined()
    })
  })

  // ── Pages ──

  describe('listMyPages', () => {
    it('requests the me/accounts edge with defaults', async () => {
      mock.onGet(`${ GRAPH }/me/accounts`).reply({ data: [{ id: 'p1', name: 'Acme Store' }] })

      const result = await service.listMyPages()

      expect(result.data[0].name).toBe('Acme Store')
      expect(mock.history[0].query).toEqual({ fields: 'id,name', limit: 25 })
    })

    it('forwards the limit and cursor', async () => {
      mock.onGet(`${ GRAPH }/me/accounts`).reply({ data: [] })

      await service.listMyPages(3, 'MjQ')

      expect(mock.history[0].query).toMatchObject({ limit: 3, after: 'MjQ' })
    })
  })

  // ── Dictionaries ──

  describe('getAdAccountsDictionary', () => {
    const URL = `${ GRAPH }/me/adaccounts`

    const PAYLOAD = {
      data: [
        { id: 'act_1', name: 'Alpha Account', currency: 'USD' },
        { id: 'act_2', name: 'Beta Account', currency: 'EUR' },
        { id: 'act_3' },
      ],
      paging: { cursors: { after: 'MjQ' } },
    }

    it('maps accounts to label/value/note and returns the after cursor', async () => {
      mock.onGet(URL).reply(PAYLOAD)

      const result = await service.getAdAccountsDictionary({})

      expect(result).toEqual({
        items: [
          { label: 'Alpha Account', value: 'act_1', note: 'USD' },
          { label: 'Beta Account', value: 'act_2', note: 'EUR' },
          { label: 'act_3', value: 'act_3', note: undefined },
        ],
        cursor: 'MjQ',
      })

      expect(mock.history[0].query).toEqual({ fields: 'id,name,currency', limit: 100 })
    })

    it('filters case-insensitively on the trimmed search term', async () => {
      mock.onGet(URL).reply(PAYLOAD)

      const result = await service.getAdAccountsDictionary({ search: '  ALPHA ' })

      expect(result.items).toEqual([{ label: 'Alpha Account', value: 'act_1', note: 'USD' }])
    })

    it('forwards the cursor as the after parameter', async () => {
      mock.onGet(URL).reply({ data: [] })

      await service.getAdAccountsDictionary({ cursor: 'MjQ' })

      expect(mock.history[0].query.after).toBe('MjQ')
    })

    it('handles a null payload', async () => {
      mock.onGet(URL).reply(PAYLOAD)

      const result = await service.getAdAccountsDictionary(null)

      expect(result.items).toHaveLength(3)
    })

    it('returns an empty list and no cursor when the edge has no data or paging', async () => {
      mock.onGet(URL).reply({})

      const result = await service.getAdAccountsDictionary({})

      expect(result).toEqual({ items: [], cursor: undefined })
    })
  })

  describe('getCampaignsDictionary', () => {
    const URL = `${ GRAPH }/${ ACCOUNT }/campaigns`

    it('maps campaigns and joins status and objective into the note', async () => {
      mock.onGet(URL).reply({
        data: [
          { id: 'c1', name: 'Summer Sale', status: 'ACTIVE', objective: 'OUTCOME_TRAFFIC' },
          { id: 'c2', name: 'No Objective', status: 'PAUSED' },
          { id: 'c3' },
        ],
        paging: { cursors: { after: 'MjQ' } },
      })

      const result = await service.getCampaignsDictionary({ criteria: { accountId: ACCOUNT_ID } })

      expect(result).toEqual({
        items: [
          { label: 'Summer Sale', value: 'c1', note: 'ACTIVE | OUTCOME_TRAFFIC' },
          { label: 'No Objective', value: 'c2', note: 'PAUSED' },
          { label: 'c3', value: 'c3', note: undefined },
        ],
        cursor: 'MjQ',
      })

      expect(mock.history[0].query).toEqual({ fields: 'id,name,status,objective', limit: 100 })
    })

    it('filters case-insensitively', async () => {
      mock.onGet(URL).reply({ data: [{ id: 'c1', name: 'Summer' }, { id: 'c2', name: 'Winter' }, { id: 'c3' }] })

      const result = await service.getCampaignsDictionary({
        search: 'WINT',
        criteria: { accountId: ACCOUNT },
      })

      expect(result.items).toEqual([{ label: 'Winter', value: 'c2', note: undefined }])
    })

    it('forwards the cursor', async () => {
      mock.onGet(URL).reply({ data: [] })

      await service.getCampaignsDictionary({ cursor: 'MjQ', criteria: { accountId: ACCOUNT_ID } })

      expect(mock.history[0].query.after).toBe('MjQ')
    })

    it('returns an empty list when the edge has no data', async () => {
      mock.onGet(URL).reply({})

      const result = await service.getCampaignsDictionary({ criteria: { accountId: ACCOUNT_ID } })

      expect(result).toEqual({ items: [], cursor: undefined })
    })
  })

  describe('getAdSetsDictionary', () => {
    const URL = `${ GRAPH }/${ ACCOUNT }/adsets`

    it('maps ad sets with the status as note', async () => {
      mock.onGet(URL).reply({
        data: [{ id: 's1', name: 'US Adults', status: 'ACTIVE' }, { id: 's2' }],
        paging: { cursors: { after: 'MjQ' } },
      })

      const result = await service.getAdSetsDictionary({ criteria: { accountId: ACCOUNT_ID } })

      expect(result).toEqual({
        items: [
          { label: 'US Adults', value: 's1', note: 'ACTIVE' },
          { label: 's2', value: 's2', note: undefined },
        ],
        cursor: 'MjQ',
      })

      expect(mock.history[0].query).toEqual({ fields: 'id,name,status', limit: 100 })
    })

    it('filters case-insensitively', async () => {
      mock.onGet(URL).reply({ data: [{ id: 's1', name: 'US Adults' }, { id: 's2', name: 'CA Adults' }, { id: 's3' }] })

      const result = await service.getAdSetsDictionary({ search: 'ca ', criteria: { accountId: ACCOUNT_ID } })

      expect(result.items).toEqual([{ label: 'CA Adults', value: 's2', note: undefined }])
    })

    it('returns an empty list when the edge has no data', async () => {
      mock.onGet(URL).reply({})

      const result = await service.getAdSetsDictionary({ criteria: { accountId: ACCOUNT_ID } })

      expect(result).toEqual({ items: [], cursor: undefined })
    })
  })

  describe('getCustomAudiencesDictionary', () => {
    const URL = `${ GRAPH }/${ ACCOUNT }/customaudiences`

    it('maps audiences with the subtype as note', async () => {
      mock.onGet(URL).reply({
        data: [{ id: 'au1', name: 'Subscribers', subtype: 'CUSTOM' }, { id: 'au2' }],
        paging: { cursors: { after: 'MjQ' } },
      })

      const result = await service.getCustomAudiencesDictionary({ criteria: { accountId: ACCOUNT_ID } })

      expect(result).toEqual({
        items: [
          { label: 'Subscribers', value: 'au1', note: 'CUSTOM' },
          { label: 'au2', value: 'au2', note: undefined },
        ],
        cursor: 'MjQ',
      })

      expect(mock.history[0].query).toEqual({ fields: 'id,name,subtype', limit: 100 })
    })

    it('filters case-insensitively', async () => {
      mock.onGet(URL).reply({ data: [{ id: 'au1', name: 'Subscribers' }, { id: 'au2', name: 'Buyers' }, { id: 'au3' }] })

      const result = await service.getCustomAudiencesDictionary({ search: 'BUY', criteria: { accountId: ACCOUNT_ID } })

      expect(result.items).toEqual([{ label: 'Buyers', value: 'au2', note: undefined }])
    })

    it('returns an empty list when the edge has no data', async () => {
      mock.onGet(URL).reply({})

      const result = await service.getCustomAudiencesDictionary({ criteria: { accountId: ACCOUNT_ID } })

      expect(result).toEqual({ items: [], cursor: undefined })
    })
  })

  describe('getPagesDictionary', () => {
    const URL = `${ GRAPH }/me/accounts`

    it('maps pages to label/value without a note', async () => {
      mock.onGet(URL).reply({
        data: [{ id: 'p1', name: 'Acme Store' }, { id: 'p2' }],
        paging: { cursors: { after: 'MjQ' } },
      })

      const result = await service.getPagesDictionary({})

      expect(result).toEqual({
        items: [
          { label: 'Acme Store', value: 'p1' },
          { label: 'p2', value: 'p2' },
        ],
        cursor: 'MjQ',
      })

      expect(mock.history[0].query).toEqual({ fields: 'id,name', limit: 100 })
    })

    it('filters case-insensitively and forwards the cursor', async () => {
      mock.onGet(URL).reply({ data: [{ id: 'p1', name: 'Acme Store' }, { id: 'p2', name: 'Other' }, { id: 'p3' }] })

      const result = await service.getPagesDictionary({ search: 'acme', cursor: 'MjQ' })

      expect(result.items).toEqual([{ label: 'Acme Store', value: 'p1' }])
      expect(mock.history[0].query.after).toBe('MjQ')
    })

    it('handles a null payload and an empty edge', async () => {
      mock.onGet(URL).reply({})

      const result = await service.getPagesDictionary(null)

      expect(result).toEqual({ items: [], cursor: undefined })
    })
  })

  // ── Guard sweep: dictionaries that require an account id issue no HTTP call ──

  describe('dictionary criteria guards', () => {
    const GUARDED = ['getCampaignsDictionary', 'getAdSetsDictionary', 'getCustomAudiencesDictionary']

    const MISSING = [
      ['a null payload', null],
      ['an empty payload', {}],
      ['a payload without criteria', { search: 'x' }],
      ['empty criteria', { criteria: {} }],
      ['a blank account id', { criteria: { accountId: '' } }],
    ]

    const cases = GUARDED.flatMap(method => MISSING.map(([label, payload]) => [method, label, payload]))

    it.each(cases)('%s returns an empty result for %s and issues no HTTP call', async (method, _label, payload) => {
      mock.onAny().reply({ data: [{ id: 'should-not-be-used' }] })

      const result = await service[method](payload)

      expect(result).toEqual({ items: [], cursor: undefined })
      expect(mock.history).toHaveLength(0)
    })
  })

  // ── Error shaping ──

  describe('Meta error envelope', () => {
    const URL = `${ GRAPH }/me/adaccounts`

    it('includes type, code, subcode and trace id when present', async () => {
      mock.onGet(URL).replyWithError({
        message: 'Bad Request',
        body: {
          error: {
            message: 'Unsupported get request.',
            type: 'GraphMethodException',
            code: 100,
            error_subcode: 33,
            fbtrace_id: 'Ax9',
          },
        },
      })

      await expect(service.listAdAccounts()).rejects.toThrow(
        'Meta Ads API error: Unsupported get request. | type=GraphMethodException | code=100 | error_subcode=33 | fbtrace_id=Ax9'
      )
    })

    it('emits only the message when the envelope carries nothing else', async () => {
      mock.onGet(URL).replyWithError({ message: 'Bad Request', body: { error: { message: 'Just a message' } } })

      await expect(service.listAdAccounts()).rejects.toThrow('Meta Ads API error: Just a message')
    })

    it('falls back to the transport error message when there is no body', async () => {
      mock.onGet(URL).replyWithError({ message: 'Network timeout' })

      await expect(service.listAdAccounts()).rejects.toThrow('Meta Ads API error: Network timeout')
    })

    it('falls back to the transport message when the body has no error key', async () => {
      mock.onGet(URL).replyWithError({ message: 'Service Unavailable', body: { foo: 'bar' } })

      await expect(service.listAdAccounts()).rejects.toThrow('Meta Ads API error: Service Unavailable')
    })

    it('keeps a zero code and zero subcode in the message', async () => {
      mock.onGet(URL).replyWithError({
        message: 'x',
        body: { error: { message: 'Zeroed', code: 0, error_subcode: 0 } },
      })

      await expect(service.listAdAccounts()).rejects.toThrow('Meta Ads API error: Zeroed | code=0 | error_subcode=0')
    })

    it('surfaces error_user_msg only when it is the envelope message', async () => {
      mock.onGet(URL).replyWithError({
        message: 'Bad Request',
        body: {
          error: {
            message: 'Invalid parameter',
            error_user_msg: 'Your ad account is not authorized.',
            type: 'OAuthException',
            code: 190,
          },
        },
      })

      // The service reports error.message; error_user_msg is not surfaced.
      await expect(service.listAdAccounts()).rejects.toThrow(
        'Meta Ads API error: Invalid parameter | type=OAuthException | code=190'
      )
    })
  })

  // ── Error propagation sweep across every Graph-backed operation ──

  describe('error propagation', () => {
    const targeting = { geo_locations: { countries: ['US'] } }

    const OPERATIONS = [
      ['listAdAccounts', []],
      ['getAdAccount', [ACCOUNT_ID]],
      ['listCampaigns', [ACCOUNT_ID]],
      ['getCampaign', ['c1']],
      ['createCampaign', [ACCOUNT_ID, 'N', 'Traffic', 'Paused', []]],
      ['updateCampaign', ['c1']],
      ['deleteCampaign', ['c1']],
      ['listAdSets', [ACCOUNT_ID]],
      ['getAdSet', ['s1']],
      ['createAdSet', [ACCOUNT_ID, 'N', 'c1', 1, undefined, undefined, 'Reach', undefined, undefined, targeting]],
      ['updateAdSet', ['s1']],
      ['deleteAdSet', ['s1']],
      ['listAds', [ACCOUNT_ID]],
      ['getAd', ['a1']],
      ['createAd', [ACCOUNT_ID, 'N', 's1', 'cr1']],
      ['updateAd', ['a1']],
      ['deleteAd', ['a1']],
      ['listAdCreatives', [ACCOUNT_ID]],
      ['getAdCreative', ['cr1']],
      ['createLinkAdCreative', [ACCOUNT_ID, 'N', 'p1', 'https://example.com']],
      ['getInsights', [ACCOUNT]],
      ['listCustomAudiences', [ACCOUNT_ID]],
      ['createCustomAudience', [ACCOUNT_ID, 'N', 'Both']],
      ['addUsersToAudience', ['au1', ACCOUNT_ID, ['a@b.com']]],
      ['removeUsersFromAudience', ['au1', ACCOUNT_ID, ['a@b.com']]],
      ['deleteCustomAudience', ['au1']],
      ['listMyPages', []],
      ['getAdAccountsDictionary', [{}]],
      ['getCampaignsDictionary', [{ criteria: { accountId: ACCOUNT_ID } }]],
      ['getAdSetsDictionary', [{ criteria: { accountId: ACCOUNT_ID } }]],
      ['getCustomAudiencesDictionary', [{ criteria: { accountId: ACCOUNT_ID } }]],
      ['getPagesDictionary', [{}]],
    ]

    it.each(OPERATIONS)('%s wraps a Meta API error', async (methodName, args) => {
      mock.onAny().replyWithError({
        message: 'Bad Request',
        body: { error: { message: 'Permission denied', type: 'OAuthException', code: 200, fbtrace_id: 'Zz1' } },
      })

      await expect(service[methodName](...args)).rejects.toThrow(
        'Meta Ads API error: Permission denied | type=OAuthException | code=200 | fbtrace_id=Zz1'
      )

      expect(mock.history).toHaveLength(1)
    })
  })
})
