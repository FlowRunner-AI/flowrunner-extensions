'use strict'

const { createSandbox } = require('../../../service-sandbox')

const CLIENT_ID = 'test-client-id'
const CLIENT_SECRET = 'test-client-secret'
const ACCESS_TOKEN = 'test-access-token'

const API_BASE = 'https://www.googleapis.com/webmasters/v3'
const URL_INSPECTION_URL = 'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const OAUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const USER_INFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo'

const SITE_URL = 'https://www.example.com/'
const ENCODED_SITE_URL = encodeURIComponent(SITE_URL)

describe('Google Search Console Service', () => {
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

    it('registers exactly 2 config items', () => {
      expect(sandbox.getConfigItems()).toHaveLength(2)
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
      expect(url).toContain('webmasters')
    })
  })

  describe('executeCallback', () => {
    it('exchanges code for token and fetches user info', async () => {
      mock.onPost(TOKEN_URL).reply({
        access_token: 'new-access-token',
        expires_in: 3600,
        refresh_token: 'new-refresh-token',
      })

      mock.onGet(USER_INFO_URL).reply({
        name: 'Test User',
        email: 'test@example.com',
        picture: 'https://example.com/photo.jpg',
      })

      const result = await service.executeCallback({
        code: 'auth-code',
        redirectURI: 'https://callback.example.com',
      })

      expect(result).toEqual({
        token: 'new-access-token',
        expirationInSeconds: 3600,
        refreshToken: 'new-refresh-token',
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
    })

    it('handles user info with email only (no name)', async () => {
      mock.onPost(TOKEN_URL).reply({
        access_token: 'token',
        expires_in: 3600,
        refresh_token: 'refresh',
      })

      mock.onGet(USER_INFO_URL).reply({
        email: 'test@example.com',
      })

      const result = await service.executeCallback({ code: 'code', redirectURI: 'https://cb.test' })

      expect(result.connectionIdentityName).toBe('test@example.com')
      expect(result.connectionIdentityImageURL).toBeNull()
    })

    it('falls back to default identity name when user info fails', async () => {
      mock.onPost(TOKEN_URL).reply({
        access_token: 'token',
        expires_in: 3600,
        refresh_token: 'refresh',
      })

      mock.onGet(USER_INFO_URL).replyWithError({ message: 'User info failed' })

      const result = await service.executeCallback({ code: 'code', redirectURI: 'https://cb.test' })

      expect(result.connectionIdentityName).toBe('Google Search Console Account')
      expect(result.connectionIdentityImageURL).toBeNull()
    })
  })

  describe('refreshToken', () => {
    it('refreshes the access token', async () => {
      mock.onPost(TOKEN_URL).reply({
        access_token: 'refreshed-token',
        expires_in: 3600,
      })

      const result = await service.refreshToken('old-refresh-token')

      expect(result).toEqual({
        token: 'refreshed-token',
        expirationInSeconds: 3600,
      })

      expect(mock.history[0].url).toBe(TOKEN_URL)
      expect(mock.history[0].query).toMatchObject({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: 'refresh_token',
        refresh_token: 'old-refresh-token',
      })
    })

    it('throws descriptive error on invalid_grant', async () => {
      mock.onPost(TOKEN_URL).replyWithError({
        message: 'Token has been expired or revoked.',
        body: { error: 'invalid_grant' },
      })

      await expect(service.refreshToken('bad-token'))
        .rejects.toThrow('Refresh token expired or invalid, please re-authenticate.')
    })

    it('re-throws other errors', async () => {
      mock.onPost(TOKEN_URL).replyWithError({
        message: 'Server error',
        body: { error: 'server_error' },
      })

      await expect(service.refreshToken('token')).rejects.toThrow()
    })
  })

  // ── Dictionaries ──

  describe('getSitesDictionary', () => {
    it('returns all sites as dictionary items', async () => {
      mock.onGet(`${API_BASE}/sites`).reply({
        siteEntry: [
          { siteUrl: 'https://www.example.com/', permissionLevel: 'siteOwner' },
          { siteUrl: 'sc-domain:example.com', permissionLevel: 'siteFullUser' },
        ],
      })

      const result = await service.getSitesDictionary({})

      expect(result.items).toEqual([
        { label: 'https://www.example.com/', value: 'https://www.example.com/', note: 'siteOwner' },
        { label: 'sc-domain:example.com', value: 'sc-domain:example.com', note: 'siteFullUser' },
      ])
    })

    it('filters sites by search term', async () => {
      mock.onGet(`${API_BASE}/sites`).reply({
        siteEntry: [
          { siteUrl: 'https://www.example.com/', permissionLevel: 'siteOwner' },
          { siteUrl: 'https://other-site.com/', permissionLevel: 'siteFullUser' },
        ],
      })

      const result = await service.getSitesDictionary({ search: 'example' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('https://www.example.com/')
    })

    it('handles empty site list', async () => {
      mock.onGet(`${API_BASE}/sites`).reply({})

      const result = await service.getSitesDictionary({})

      expect(result.items).toEqual([])
    })

    it('handles null payload', async () => {
      mock.onGet(`${API_BASE}/sites`).reply({ siteEntry: [] })

      const result = await service.getSitesDictionary(null)

      expect(result.items).toEqual([])
    })
  })

  describe('getSitemapsDictionary', () => {
    it('returns sitemaps as dictionary items', async () => {
      mock.onGet(`${API_BASE}/sites/${ENCODED_SITE_URL}/sitemaps`).reply({
        sitemap: [
          { path: 'https://www.example.com/sitemap.xml', type: 'sitemap', errors: 0, warnings: 1 },
        ],
      })

      const result = await service.getSitemapsDictionary({ criteria: { siteUrl: SITE_URL } })

      expect(result.items).toEqual([
        {
          label: 'https://www.example.com/sitemap.xml',
          value: 'https://www.example.com/sitemap.xml',
          note: 'sitemap — 0 errors, 1 warnings',
        },
      ])
    })

    it('returns empty items when no criteria siteUrl', async () => {
      const result = await service.getSitemapsDictionary({})

      expect(result).toEqual({ items: [] })
      expect(mock.history).toHaveLength(0)
    })

    it('filters sitemaps by search', async () => {
      mock.onGet(`${API_BASE}/sites/${ENCODED_SITE_URL}/sitemaps`).reply({
        sitemap: [
          { path: 'https://www.example.com/sitemap.xml', type: 'sitemap', errors: 0, warnings: 0 },
          { path: 'https://www.example.com/news-sitemap.xml', type: 'sitemap', errors: 0, warnings: 0 },
        ],
      })

      const result = await service.getSitemapsDictionary({ search: 'news', criteria: { siteUrl: SITE_URL } })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toContain('news')
    })

    it('handles missing type/errors/warnings gracefully', async () => {
      mock.onGet(`${API_BASE}/sites/${ENCODED_SITE_URL}/sitemaps`).reply({
        sitemap: [
          { path: 'https://www.example.com/sitemap.xml' },
        ],
      })

      const result = await service.getSitemapsDictionary({ criteria: { siteUrl: SITE_URL } })

      expect(result.items[0].note).toBe('sitemap — 0 errors, 0 warnings')
    })
  })

  // ── Sites ──

  describe('listSites', () => {
    it('sends GET to /sites and returns response', async () => {
      const responseData = {
        siteEntry: [{ siteUrl: SITE_URL, permissionLevel: 'siteOwner' }],
      }

      mock.onGet(`${API_BASE}/sites`).reply(responseData)

      const result = await service.listSites()

      expect(result).toEqual(responseData)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].headers).toMatchObject({ Authorization: `Bearer ${ACCESS_TOKEN}` })
    })
  })

  describe('getSite', () => {
    it('sends GET with encoded site URL', async () => {
      const responseData = { siteUrl: SITE_URL, permissionLevel: 'siteOwner' }

      mock.onGet(`${API_BASE}/sites/${ENCODED_SITE_URL}`).reply(responseData)

      const result = await service.getSite(SITE_URL)

      expect(result).toEqual(responseData)
      expect(mock.history[0].url).toBe(`${API_BASE}/sites/${ENCODED_SITE_URL}`)
    })

    it('throws when siteUrl is empty', async () => {
      await expect(service.getSite('')).rejects.toThrow('"Site URL" is required')
    })

    it('throws when siteUrl is null', async () => {
      await expect(service.getSite(null)).rejects.toThrow('"Site URL" is required')
    })

    it('throws when siteUrl is whitespace', async () => {
      await expect(service.getSite('   ')).rejects.toThrow('"Site URL" is required')
    })
  })

  describe('addSite', () => {
    it('sends PUT and returns success confirmation', async () => {
      mock.onPut(`${API_BASE}/sites/${ENCODED_SITE_URL}`).reply({})

      const result = await service.addSite(SITE_URL)

      expect(result).toEqual({ success: true, siteUrl: SITE_URL })
      expect(mock.history[0].method).toBe('put')
    })

    it('trims whitespace from siteUrl', async () => {
      mock.onPut(`${API_BASE}/sites/${ENCODED_SITE_URL}`).reply({})

      const result = await service.addSite(`  ${SITE_URL}  `)

      expect(result.siteUrl).toBe(SITE_URL)
    })

    it('throws on API error', async () => {
      mock.onPut(`${API_BASE}/sites/${ENCODED_SITE_URL}`).replyWithError({
        message: 'Forbidden',
        body: { error: { message: 'Insufficient permissions' } },
      })

      await expect(service.addSite(SITE_URL)).rejects.toThrow('Google Search Console API error')
    })
  })

  describe('deleteSite', () => {
    it('sends DELETE and returns success confirmation', async () => {
      mock.onDelete(`${API_BASE}/sites/${ENCODED_SITE_URL}`).reply({})

      const result = await service.deleteSite(SITE_URL)

      expect(result).toEqual({ success: true, siteUrl: SITE_URL })
      expect(mock.history[0].method).toBe('delete')
    })
  })

  // ── Sitemaps ──

  describe('listSitemaps', () => {
    it('sends GET with site URL and returns response', async () => {
      const responseData = {
        sitemap: [{ path: 'https://www.example.com/sitemap.xml', type: 'sitemap' }],
      }

      mock.onGet(`${API_BASE}/sites/${ENCODED_SITE_URL}/sitemaps`).reply(responseData)

      const result = await service.listSitemaps(SITE_URL)

      expect(result).toEqual(responseData)
      expect(mock.history[0].url).toBe(`${API_BASE}/sites/${ENCODED_SITE_URL}/sitemaps`)
    })

    it('passes sitemapIndex as query parameter when provided', async () => {
      mock.onGet(`${API_BASE}/sites/${ENCODED_SITE_URL}/sitemaps`).reply({ sitemap: [] })

      await service.listSitemaps(SITE_URL, 'https://www.example.com/sitemap_index.xml')

      expect(mock.history[0].query).toMatchObject({
        sitemapIndex: 'https://www.example.com/sitemap_index.xml',
      })
    })

    it('does not include sitemapIndex when not provided', async () => {
      mock.onGet(`${API_BASE}/sites/${ENCODED_SITE_URL}/sitemaps`).reply({ sitemap: [] })

      await service.listSitemaps(SITE_URL)

      expect(mock.history[0].query.sitemapIndex).toBeUndefined()
    })
  })

  describe('getSitemap', () => {
    const feedpath = 'https://www.example.com/sitemap.xml'
    const encodedFeedpath = encodeURIComponent(feedpath)

    it('sends GET with encoded site URL and feedpath', async () => {
      const responseData = { path: feedpath, type: 'sitemap' }

      mock.onGet(`${API_BASE}/sites/${ENCODED_SITE_URL}/sitemaps/${encodedFeedpath}`).reply(responseData)

      const result = await service.getSitemap(SITE_URL, feedpath)

      expect(result).toEqual(responseData)
    })

    it('throws when feedpath is empty', async () => {
      await expect(service.getSitemap(SITE_URL, '')).rejects.toThrow('"Sitemap URL" is required')
    })

    it('throws when feedpath is null', async () => {
      await expect(service.getSitemap(SITE_URL, null)).rejects.toThrow('"Sitemap URL" is required')
    })
  })

  describe('submitSitemap', () => {
    const feedpath = 'https://www.example.com/sitemap.xml'
    const encodedFeedpath = encodeURIComponent(feedpath)

    it('sends PUT and returns success confirmation', async () => {
      mock.onPut(`${API_BASE}/sites/${ENCODED_SITE_URL}/sitemaps/${encodedFeedpath}`).reply({})

      const result = await service.submitSitemap(SITE_URL, feedpath)

      expect(result).toEqual({ success: true, siteUrl: SITE_URL, feedpath })
      expect(mock.history[0].method).toBe('put')
    })
  })

  describe('deleteSitemap', () => {
    const feedpath = 'https://www.example.com/sitemap.xml'
    const encodedFeedpath = encodeURIComponent(feedpath)

    it('sends DELETE and returns success confirmation', async () => {
      mock.onDelete(`${API_BASE}/sites/${ENCODED_SITE_URL}/sitemaps/${encodedFeedpath}`).reply({})

      const result = await service.deleteSitemap(SITE_URL, feedpath)

      expect(result).toEqual({ success: true, siteUrl: SITE_URL, feedpath })
      expect(mock.history[0].method).toBe('delete')
    })
  })

  // ── Search Analytics ──

  describe('querySearchAnalytics', () => {
    const analyticsUrl = `${API_BASE}/sites/${ENCODED_SITE_URL}/searchAnalytics/query`

    it('sends POST with required parameters', async () => {
      mock.onPost(analyticsUrl).reply({
        rows: [
          { keys: ['flowrunner'], clicks: 42, impressions: 1024, ctr: 0.041, position: 3.2 },
        ],
        responseAggregationType: 'byProperty',
      })

      const result = await service.querySearchAnalytics(
        SITE_URL, '2026-01-01', '2026-01-31', ['Query']
      )

      expect(result).toEqual({
        rows: [
          { query: 'flowrunner', clicks: 42, impressions: 1024, ctr: 0.041, position: 3.2 },
        ],
        rowCount: 1,
        responseAggregationType: 'byProperty',
      })

      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toMatchObject({
        startDate: '2026-01-01',
        endDate: '2026-01-31',
        dimensions: ['query'],
      })
    })

    it('sends multiple dimensions and maps rows correctly', async () => {
      mock.onPost(analyticsUrl).reply({
        rows: [
          { keys: ['2026-01-01', 'flowrunner'], clicks: 10, impressions: 100, ctr: 0.1, position: 2.0 },
        ],
        responseAggregationType: 'auto',
      })

      const result = await service.querySearchAnalytics(
        SITE_URL, '2026-01-01', '2026-01-31', ['Date', 'Query']
      )

      expect(result.rows[0]).toEqual({
        date: '2026-01-01',
        query: 'flowrunner',
        clicks: 10,
        impressions: 100,
        ctr: 0.1,
        position: 2.0,
      })
    })

    it('handles empty rows response', async () => {
      mock.onPost(analyticsUrl).reply({ responseAggregationType: 'auto' })

      const result = await service.querySearchAnalytics(SITE_URL, '2026-01-01', '2026-01-31')

      expect(result.rows).toEqual([])
      expect(result.rowCount).toBe(0)
    })

    it('throws when startDate or endDate is missing', async () => {
      await expect(service.querySearchAnalytics(SITE_URL, null, '2026-01-31'))
        .rejects.toThrow('"Start Date" and "End Date" are required')

      await expect(service.querySearchAnalytics(SITE_URL, '2026-01-01', null))
        .rejects.toThrow('"Start Date" and "End Date" are required')
    })

    it('includes searchType in request body', async () => {
      mock.onPost(analyticsUrl).reply({ rows: [], responseAggregationType: 'auto' })

      await service.querySearchAnalytics(
        SITE_URL, '2026-01-01', '2026-01-31',
        undefined, 'Image'
      )

      expect(mock.history[0].body).toMatchObject({ type: 'image' })
    })

    it('includes convenience filter when filterDimension and filterExpression are set', async () => {
      mock.onPost(analyticsUrl).reply({ rows: [], responseAggregationType: 'auto' })

      await service.querySearchAnalytics(
        SITE_URL, '2026-01-01', '2026-01-31',
        undefined, undefined,
        'Query', 'Contains', 'flowrunner'
      )

      expect(mock.history[0].body.dimensionFilterGroups).toEqual([{
        filters: [{
          dimension: 'query',
          operator: 'contains',
          expression: 'flowrunner',
        }],
      }])
    })

    it('uses dimensionFilterGroups over convenience filter when provided', async () => {
      mock.onPost(analyticsUrl).reply({ rows: [], responseAggregationType: 'auto' })

      const customGroups = [{
        groupType: 'and',
        filters: [{ dimension: 'page', operator: 'contains', expression: '/blog' }],
      }]

      await service.querySearchAnalytics(
        SITE_URL, '2026-01-01', '2026-01-31',
        undefined, undefined,
        'Query', 'Contains', 'ignored',
        customGroups
      )

      expect(mock.history[0].body.dimensionFilterGroups).toEqual(customGroups)
    })

    it('wraps single dimensionFilterGroups object into array', async () => {
      mock.onPost(analyticsUrl).reply({ rows: [], responseAggregationType: 'auto' })

      const singleGroup = {
        filters: [{ dimension: 'query', operator: 'equals', expression: 'test' }],
      }

      await service.querySearchAnalytics(
        SITE_URL, '2026-01-01', '2026-01-31',
        undefined, undefined,
        undefined, undefined, undefined,
        singleGroup
      )

      expect(mock.history[0].body.dimensionFilterGroups).toEqual([singleGroup])
    })

    it('includes aggregationType, rowLimit, startRow, and dataState', async () => {
      mock.onPost(analyticsUrl).reply({ rows: [], responseAggregationType: 'byPage' })

      await service.querySearchAnalytics(
        SITE_URL, '2026-01-01', '2026-01-31',
        undefined, undefined,
        undefined, undefined, undefined,
        undefined,
        'By Page', 500, 100, 'All (Includes Fresh Data)'
      )

      expect(mock.history[0].body).toMatchObject({
        aggregationType: 'byPage',
        rowLimit: 500,
        startRow: 100,
        dataState: 'all',
      })
    })

    it('omits optional fields when not provided', async () => {
      mock.onPost(analyticsUrl).reply({ rows: [], responseAggregationType: 'auto' })

      await service.querySearchAnalytics(SITE_URL, '2026-01-01', '2026-01-31')

      const body = mock.history[0].body

      expect(body.dimensions).toBeUndefined()
      expect(body.dimensionFilterGroups).toBeUndefined()
      expect(body.rowLimit).toBeUndefined()
      expect(body.startRow).toBeUndefined()
    })

    it('throws on API error', async () => {
      mock.onPost(analyticsUrl).replyWithError({
        message: 'Bad Request',
        body: { error: { message: 'Invalid date range' } },
      })

      await expect(
        service.querySearchAnalytics(SITE_URL, '2026-01-01', '2025-12-31', ['Query'])
      ).rejects.toThrow('Google Search Console API error')
    })
  })

  // ── URL Inspection ──

  describe('inspectUrl', () => {
    it('sends POST with correct body', async () => {
      const responseData = {
        inspectionResult: {
          indexStatusResult: { verdict: 'PASS', coverageState: 'Submitted and indexed' },
        },
      }

      mock.onPost(URL_INSPECTION_URL).reply(responseData)

      const result = await service.inspectUrl(
        'https://www.example.com/pricing',
        SITE_URL,
        'en-US'
      )

      expect(result).toEqual(responseData)
      expect(mock.history[0].body).toEqual({
        inspectionUrl: 'https://www.example.com/pricing',
        siteUrl: SITE_URL,
        languageCode: 'en-US',
      })
    })

    it('omits languageCode when not provided', async () => {
      mock.onPost(URL_INSPECTION_URL).reply({ inspectionResult: {} })

      await service.inspectUrl('https://www.example.com/about', SITE_URL)

      expect(mock.history[0].body.languageCode).toBeUndefined()
    })

    it('trims inspectionUrl', async () => {
      mock.onPost(URL_INSPECTION_URL).reply({ inspectionResult: {} })

      await service.inspectUrl('  https://www.example.com/page  ', SITE_URL)

      expect(mock.history[0].body.inspectionUrl).toBe('https://www.example.com/page')
    })

    it('throws when inspectionUrl is empty', async () => {
      await expect(service.inspectUrl('', SITE_URL)).rejects.toThrow('"URL to Inspect" is required')
    })

    it('throws when inspectionUrl is null', async () => {
      await expect(service.inspectUrl(null, SITE_URL)).rejects.toThrow('"URL to Inspect" is required')
    })

    it('throws when siteUrl is missing', async () => {
      await expect(service.inspectUrl('https://www.example.com/', '')).rejects.toThrow('"Site URL" is required')
    })

    it('throws on API error', async () => {
      mock.onPost(URL_INSPECTION_URL).replyWithError({
        message: 'Not Found',
        body: { error: { message: 'URL not found in property' } },
      })

      await expect(
        service.inspectUrl('https://www.example.com/missing', SITE_URL)
      ).rejects.toThrow('Google Search Console API error')
    })
  })
})
