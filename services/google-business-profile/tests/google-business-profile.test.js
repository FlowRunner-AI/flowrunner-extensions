'use strict'

const { createSandbox } = require('../../../service-sandbox')

const CLIENT_ID = 'test-client-id'
const CLIENT_SECRET = 'test-client-secret'
const ACCESS_TOKEN = 'test-access-token'

const OAUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const USER_INFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo'

const ACCOUNT_MGMT = 'https://mybusinessaccountmanagement.googleapis.com/v1'
const BIZ_INFO = 'https://mybusinessbusinessinformation.googleapis.com/v1'
const REVIEWS = 'https://mybusiness.googleapis.com/v4'

const DEFAULT_READ_MASK = 'name,title,storefrontAddress,phoneNumbers,websiteUri,regularHours,categories,metadata,latlng'

describe('Google Business Profile Service', () => {
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
      expect(sandbox.getConfigItems()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'clientId', required: true, shared: true }),
          expect.objectContaining({ name: 'clientSecret', required: true, shared: true }),
        ])
      )
    })
  })

  // ── OAuth ──

  describe('getOAuth2ConnectionURL', () => {
    it('returns a valid authorization URL with correct params', async () => {
      const url = await service.getOAuth2ConnectionURL()

      expect(url).toContain(OAUTH_URL)
      expect(url).toContain(`client_id=${ encodeURIComponent(CLIENT_ID) }`)
      expect(url).toContain('response_type=code')
      expect(url).toContain('access_type=offline')
      expect(url).toContain('prompt=consent')
      expect(url).toContain(encodeURIComponent('https://www.googleapis.com/auth/business.manage'))
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
        name: 'John Doe',
        email: 'john@example.com',
        picture: 'https://example.com/photo.jpg',
      })

      const result = await service.executeCallback({
        code: 'auth-code',
        redirectURI: 'https://app.example.com/callback',
      })

      expect(result).toEqual({
        token: 'new-access-token',
        refreshToken: 'new-refresh-token',
        expirationInSeconds: 3600,
        connectionIdentityName: 'John Doe (john@example.com)',
        connectionIdentityImageURL: 'https://example.com/photo.jpg',
        overwrite: true,
        userData: expect.objectContaining({ name: 'John Doe', email: 'john@example.com' }),
      })

      expect(mock.history).toHaveLength(2)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(TOKEN_URL)
    })

    it('uses email-only identity when name is missing', async () => {
      mock.onPost(TOKEN_URL).reply({
        access_token: 'tok',
        expires_in: 3600,
      })

      mock.onGet(USER_INFO_URL).reply({
        email: 'john@example.com',
      })

      const result = await service.executeCallback({ code: 'c', redirectURI: 'https://r' })

      expect(result.connectionIdentityName).toBe('john@example.com')
    })

    it('falls back to default identity when user info request fails', async () => {
      mock.onPost(TOKEN_URL).reply({
        access_token: 'tok',
        expires_in: 3600,
      })

      mock.onGet(USER_INFO_URL).replyWithError({ message: 'Forbidden' })

      const result = await service.executeCallback({ code: 'c', redirectURI: 'https://r' })

      expect(result.connectionIdentityName).toBe('Google Business Profile Account')
      expect(result.connectionIdentityImageURL).toBeNull()
    })
  })

  describe('refreshToken', () => {
    it('refreshes access token successfully', async () => {
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

    it('throws a specific message on invalid_grant error', async () => {
      mock.onPost(TOKEN_URL).replyWithError({
        message: 'invalid_grant',
        body: { error: 'invalid_grant' },
      })

      await expect(service.refreshToken('bad-token')).rejects.toThrow(
        'Refresh token expired or invalid, please re-authenticate.'
      )
    })

    it('re-throws other errors', async () => {
      mock.onPost(TOKEN_URL).replyWithError({
        message: 'Network error',
        body: {},
      })

      await expect(service.refreshToken('tok')).rejects.toThrow()
    })
  })

  // ── Dictionaries ──

  describe('getAccountsDictionary', () => {
    it('returns mapped accounts', async () => {
      mock.onGet(`${ACCOUNT_MGMT}/accounts`).reply({
        accounts: [
          { name: 'accounts/123', accountName: 'Acme', type: 'LOCATION_GROUP' },
          { name: 'accounts/456', accountName: 'Beta Corp', type: 'PERSONAL' },
        ],
        nextPageToken: 'page2',
      })

      const result = await service.getAccountsDictionary({})

      expect(result.cursor).toBe('page2')
      expect(result.items).toHaveLength(2)
      expect(result.items[0]).toEqual({ label: 'Acme', value: 'accounts/123', note: 'LOCATION_GROUP' })
    })

    it('filters by search', async () => {
      mock.onGet(`${ACCOUNT_MGMT}/accounts`).reply({
        accounts: [
          { name: 'accounts/1', accountName: 'Acme Coffee' },
          { name: 'accounts/2', accountName: 'Beta Corp' },
        ],
      })

      const result = await service.getAccountsDictionary({ search: 'acme' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toBe('Acme Coffee')
    })

    it('passes pagination cursor', async () => {
      mock.onGet(`${ACCOUNT_MGMT}/accounts`).reply({ accounts: [] })

      await service.getAccountsDictionary({ cursor: 'tok123' })

      expect(mock.history[0].query).toMatchObject({ pageToken: 'tok123' })
    })

    it('handles empty payload', async () => {
      mock.onGet(`${ACCOUNT_MGMT}/accounts`).reply({})

      const result = await service.getAccountsDictionary()

      expect(result.items).toEqual([])
    })
  })

  describe('getLocationsDictionary', () => {
    it('returns empty items when no accountId provided', async () => {
      const result = await service.getLocationsDictionary({})

      expect(result).toEqual({ items: [] })
      expect(mock.history).toHaveLength(0)
    })

    it('returns mapped locations', async () => {
      mock.onGet(`${BIZ_INFO}/accounts/123/locations`).reply({
        locations: [
          { name: 'locations/L1', title: 'Downtown', phoneNumbers: { primaryPhone: '+1 555' } },
          { name: 'locations/L2', title: 'Uptown', storefrontAddress: { locality: 'Austin' } },
        ],
        nextPageToken: 'page2',
      })

      const result = await service.getLocationsDictionary({
        criteria: { accountId: 'accounts/123' },
      })

      expect(result.cursor).toBe('page2')
      expect(result.items).toHaveLength(2)
      expect(result.items[0]).toEqual({ label: 'Downtown', value: 'locations/L1', note: '+1 555' })
      expect(result.items[1]).toEqual({ label: 'Uptown', value: 'locations/L2', note: 'Austin' })
    })

    it('normalizes bare account id', async () => {
      mock.onGet(`${BIZ_INFO}/accounts/789/locations`).reply({ locations: [] })

      await service.getLocationsDictionary({ criteria: { accountId: '789' } })

      expect(mock.history[0].url).toBe(`${BIZ_INFO}/accounts/789/locations`)
    })

    it('filters by search', async () => {
      mock.onGet(`${BIZ_INFO}/accounts/1/locations`).reply({
        locations: [
          { name: 'locations/A', title: 'Downtown' },
          { name: 'locations/B', title: 'Uptown' },
        ],
      })

      const result = await service.getLocationsDictionary({
        search: 'down',
        criteria: { accountId: '1' },
      })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toBe('Downtown')
    })
  })

  // ── Accounts ──

  describe('listAccounts', () => {
    it('sends correct request with defaults', async () => {
      mock.onGet(`${ACCOUNT_MGMT}/accounts`).reply({ accounts: [] })

      const result = await service.listAccounts()

      expect(result).toEqual({ accounts: [] })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({
        Authorization: `Bearer ${ACCESS_TOKEN}`,
      })
    })

    it('passes pageSize and pageToken', async () => {
      mock.onGet(`${ACCOUNT_MGMT}/accounts`).reply({ accounts: [] })

      await service.listAccounts(5, 'cursor-abc')

      expect(mock.history[0].query).toMatchObject({ pageSize: 5, pageToken: 'cursor-abc' })
    })
  })

  describe('getAccount', () => {
    it('fetches account by full resource name', async () => {
      mock.onGet(`${ACCOUNT_MGMT}/accounts/123`).reply({
        name: 'accounts/123',
        accountName: 'Acme',
      })

      const result = await service.getAccount('accounts/123')

      expect(result.name).toBe('accounts/123')
    })

    it('normalizes bare account id', async () => {
      mock.onGet(`${ACCOUNT_MGMT}/accounts/456`).reply({ name: 'accounts/456' })

      await service.getAccount('456')

      expect(mock.history[0].url).toBe(`${ACCOUNT_MGMT}/accounts/456`)
    })

    it('throws when accountId is missing', async () => {
      await expect(service.getAccount()).rejects.toThrow('"Account" is required')
    })
  })

  // ── Locations ──

  describe('listLocations', () => {
    it('sends correct request with defaults', async () => {
      mock.onGet(`${BIZ_INFO}/accounts/123/locations`).reply({ locations: [] })

      await service.listLocations('accounts/123')

      expect(mock.history[0].query).toMatchObject({
        readMask: 'name,title,storefrontAddress,phoneNumbers',
      })
    })

    it('passes custom readMask and pagination', async () => {
      mock.onGet(`${BIZ_INFO}/accounts/1/locations`).reply({ locations: [] })

      await service.listLocations('1', 'name,title', 10, 'cursorXYZ', 'title="Acme"')

      expect(mock.history[0].query).toMatchObject({
        readMask: 'name,title',
        pageSize: 10,
        pageToken: 'cursorXYZ',
        filter: 'title="Acme"',
      })
    })

    it('resolves orderBy dropdown values', async () => {
      mock.onGet(`${BIZ_INFO}/accounts/1/locations`).reply({ locations: [] })

      await service.listLocations('1', undefined, undefined, undefined, undefined, 'Title (Z-A)')

      expect(mock.history[0].query).toMatchObject({ orderBy: 'title desc' })
    })

    it('throws when accountId is missing', async () => {
      await expect(service.listLocations()).rejects.toThrow('"Account" is required')
    })
  })

  describe('getLocation', () => {
    it('sends request with default readMask', async () => {
      mock.onGet(`${BIZ_INFO}/locations/L1`).reply({ name: 'locations/L1', title: 'Downtown' })

      const result = await service.getLocation('locations/L1')

      expect(result.title).toBe('Downtown')
      expect(mock.history[0].query).toMatchObject({ readMask: DEFAULT_READ_MASK })
    })

    it('uses custom readMask', async () => {
      mock.onGet(`${BIZ_INFO}/locations/L1`).reply({ name: 'locations/L1' })

      await service.getLocation('L1', 'name,title')

      expect(mock.history[0].query).toMatchObject({ readMask: 'name,title' })
    })

    it('normalizes bare location id', async () => {
      mock.onGet(`${BIZ_INFO}/locations/L2`).reply({ name: 'locations/L2' })

      await service.getLocation('L2')

      expect(mock.history[0].url).toBe(`${BIZ_INFO}/locations/L2`)
    })

    it('throws when locationName is missing', async () => {
      await expect(service.getLocation()).rejects.toThrow('"Location" is required')
    })
  })

  describe('updateLocation', () => {
    it('sends PATCH with correct body and query', async () => {
      mock.onPatch(`${BIZ_INFO}/locations/L1`).reply({ name: 'locations/L1', title: 'New Title' })

      const result = await service.updateLocation('L1', 'title', { title: 'New Title' })

      expect(result.title).toBe('New Title')
      expect(mock.history[0].method).toBe('patch')
      expect(mock.history[0].query).toMatchObject({ updateMask: 'title' })
      expect(mock.history[0].body).toEqual({ title: 'New Title' })
    })

    it('passes validateOnly when true', async () => {
      mock.onPatch(`${BIZ_INFO}/locations/L1`).reply({})

      await service.updateLocation('L1', 'title', { title: 'T' }, true)

      expect(mock.history[0].query).toMatchObject({ validateOnly: true })
    })

    it('omits validateOnly when false', async () => {
      mock.onPatch(`${BIZ_INFO}/locations/L1`).reply({})

      await service.updateLocation('L1', 'title', { title: 'T' }, false)

      expect(mock.history[0].query.validateOnly).toBeUndefined()
    })

    it('throws when locationName is missing', async () => {
      await expect(service.updateLocation()).rejects.toThrow('"Location" is required')
    })

    it('throws when updateMask is missing', async () => {
      await expect(service.updateLocation('L1')).rejects.toThrow('"Update Mask" is required')
    })

    it('throws when location object is missing', async () => {
      await expect(service.updateLocation('L1', 'title')).rejects.toThrow('"Location" object is required')
    })

    it('throws when location is not an object', async () => {
      await expect(service.updateLocation('L1', 'title', 'bad')).rejects.toThrow('"Location" object is required')
    })
  })

  // ── Reviews ──

  describe('listReviews', () => {
    it('sends correct request with defaults', async () => {
      mock.onGet(`${REVIEWS}/accounts/A/locations/L/reviews`).reply({
        reviews: [],
        averageRating: 4.5,
        totalReviewCount: 10,
      })

      const result = await service.listReviews('accounts/A', 'locations/L')

      expect(result.averageRating).toBe(4.5)
      expect(mock.history[0].query).toMatchObject({ orderBy: 'updateTime desc' })
    })

    it('resolves orderBy to API values', async () => {
      mock.onGet(`${REVIEWS}/accounts/A/locations/L/reviews`).reply({ reviews: [] })

      await service.listReviews('A', 'L', 'Lowest Rating')

      expect(mock.history[0].query).toMatchObject({ orderBy: 'rating' })
    })

    it('strips resource prefixes using bareId', async () => {
      mock.onGet(`${REVIEWS}/accounts/A/locations/L/reviews`).reply({ reviews: [] })

      await service.listReviews('accounts/A', 'locations/L')

      expect(mock.history[0].url).toBe(`${REVIEWS}/accounts/A/locations/L/reviews`)
    })

    it('passes pageSize and pageToken', async () => {
      mock.onGet(`${REVIEWS}/accounts/A/locations/L/reviews`).reply({ reviews: [] })

      await service.listReviews('A', 'L', undefined, 25, 'pg2')

      expect(mock.history[0].query).toMatchObject({ pageSize: 25, pageToken: 'pg2' })
    })

    it('throws when accountId is missing', async () => {
      await expect(service.listReviews()).rejects.toThrow('"Account" is required')
    })

    it('throws when locationId is missing', async () => {
      await expect(service.listReviews('A')).rejects.toThrow('"Location" is required')
    })
  })

  describe('getReview', () => {
    it('fetches a single review', async () => {
      mock.onGet(`${REVIEWS}/accounts/A/locations/L/reviews/R1`).reply({
        reviewId: 'R1',
        starRating: 'FIVE',
      })

      const result = await service.getReview('A', 'L', 'R1')

      expect(result.reviewId).toBe('R1')
    })

    it('strips resource prefixes from all ids', async () => {
      mock.onGet(`${REVIEWS}/accounts/A/locations/L/reviews/R`).reply({})

      await service.getReview('accounts/A', 'locations/L', 'reviews/R')

      expect(mock.history[0].url).toBe(`${REVIEWS}/accounts/A/locations/L/reviews/R`)
    })

    it('throws when accountId is missing', async () => {
      await expect(service.getReview()).rejects.toThrow('"Account" is required')
    })

    it('throws when locationId is missing', async () => {
      await expect(service.getReview('A')).rejects.toThrow('"Location" is required')
    })

    it('throws when reviewId is missing', async () => {
      await expect(service.getReview('A', 'L')).rejects.toThrow('"Review ID" is required')
    })
  })

  describe('replyToReview', () => {
    it('sends PUT with comment body', async () => {
      mock.onPut(`${REVIEWS}/accounts/A/locations/L/reviews/R1/reply`).reply({
        comment: 'Thanks!',
        updateTime: '2026-01-06T09:00:00Z',
      })

      const result = await service.replyToReview('A', 'L', 'R1', 'Thanks!')

      expect(result.comment).toBe('Thanks!')
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].body).toEqual({ comment: 'Thanks!' })
    })

    it('throws when accountId is missing', async () => {
      await expect(service.replyToReview()).rejects.toThrow('"Account" is required')
    })

    it('throws when locationId is missing', async () => {
      await expect(service.replyToReview('A')).rejects.toThrow('"Location" is required')
    })

    it('throws when reviewId is missing', async () => {
      await expect(service.replyToReview('A', 'L')).rejects.toThrow('"Review ID" is required')
    })

    it('throws when comment is missing', async () => {
      await expect(service.replyToReview('A', 'L', 'R')).rejects.toThrow('"Comment" is required')
    })
  })

  describe('deleteReviewReply', () => {
    it('sends DELETE and returns success', async () => {
      mock.onDelete(`${REVIEWS}/accounts/A/locations/L/reviews/R1/reply`).reply({})

      const result = await service.deleteReviewReply('A', 'L', 'R1')

      expect(result).toEqual({ success: true, reviewId: 'R1' })
      expect(mock.history[0].method).toBe('delete')
    })

    it('strips resource prefix from reviewId in return value', async () => {
      mock.onDelete(`${REVIEWS}/accounts/A/locations/L/reviews/R2/reply`).reply({})

      const result = await service.deleteReviewReply('accounts/A', 'locations/L', 'reviews/R2')

      expect(result.reviewId).toBe('R2')
    })

    it('throws when accountId is missing', async () => {
      await expect(service.deleteReviewReply()).rejects.toThrow('"Account" is required')
    })

    it('throws when locationId is missing', async () => {
      await expect(service.deleteReviewReply('A')).rejects.toThrow('"Location" is required')
    })

    it('throws when reviewId is missing', async () => {
      await expect(service.deleteReviewReply('A', 'L')).rejects.toThrow('"Review ID" is required')
    })
  })

  describe('batchGetReviews', () => {
    it('sends POST with normalized location names', async () => {
      mock.onPost(`${REVIEWS}/accounts/A/locations:batchGetReviews`).reply({
        locationReviews: [],
      })

      await service.batchGetReviews('A', ['L1', 'locations/L2'])

      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toMatchObject({
        locationNames: ['locations/L1', 'locations/L2'],
        orderBy: 'updateTime desc',
      })
    })

    it('resolves orderBy and passes pageSize', async () => {
      mock.onPost(`${REVIEWS}/accounts/A/locations:batchGetReviews`).reply({
        locationReviews: [],
      })

      await service.batchGetReviews('A', ['L1'], 'Highest Rating', 25)

      expect(mock.history[0].body).toMatchObject({
        orderBy: 'rating desc',
        pageSize: 25,
      })
    })

    it('throws when accountId is missing', async () => {
      await expect(service.batchGetReviews()).rejects.toThrow('"Account" is required')
    })

    it('throws when locationNames is empty', async () => {
      await expect(service.batchGetReviews('A', [])).rejects.toThrow(
        '"Location Names" must be a non-empty array'
      )
    })

    it('throws when locationNames is not an array', async () => {
      await expect(service.batchGetReviews('A', 'L1')).rejects.toThrow(
        '"Location Names" must be a non-empty array'
      )
    })
  })

  // ── Media ──

  describe('listLocationMedia', () => {
    it('sends correct request', async () => {
      mock.onGet(`${REVIEWS}/accounts/A/locations/L/media`).reply({
        mediaItems: [{ name: 'media/1', mediaFormat: 'PHOTO' }],
        totalMediaItemCount: 1,
      })

      const result = await service.listLocationMedia('A', 'L')

      expect(result.mediaItems).toHaveLength(1)
      expect(mock.history[0].url).toBe(`${REVIEWS}/accounts/A/locations/L/media`)
    })

    it('passes pageSize and pageToken', async () => {
      mock.onGet(`${REVIEWS}/accounts/A/locations/L/media`).reply({ mediaItems: [] })

      await service.listLocationMedia('A', 'L', 10, 'pg2')

      expect(mock.history[0].query).toMatchObject({ pageSize: 10, pageToken: 'pg2' })
    })

    it('throws when accountId is missing', async () => {
      await expect(service.listLocationMedia()).rejects.toThrow('"Account" is required')
    })

    it('throws when locationId is missing', async () => {
      await expect(service.listLocationMedia('A')).rejects.toThrow('"Location" is required')
    })
  })

  // ── Error handling ──

  describe('API error handling', () => {
    it('wraps API errors with a descriptive message', async () => {
      mock.onGet(`${ACCOUNT_MGMT}/accounts`).replyWithError({
        message: 'Unauthorized',
        body: { error: { message: 'Invalid credentials' } },
        status: 401,
      })

      await expect(service.listAccounts()).rejects.toThrow(
        'Google Business Profile API error: Invalid credentials'
      )
    })

    it('falls back to error.message when body has no nested error', async () => {
      mock.onGet(`${ACCOUNT_MGMT}/accounts`).replyWithError({
        message: 'Server Error',
        body: {},
      })

      await expect(service.listAccounts()).rejects.toThrow(
        'Google Business Profile API error: Server Error'
      )
    })
  })
})
