'use strict'

const { createSandbox } = require('../../../service-sandbox')

const CLIENT_ID = 'test-client-id'
const CLIENT_SECRET = 'test-client-secret'
const ACCESS_TOKEN = 'test-access-token'
const DC = 'us1'
const OAUTH_BASE = 'https://login.mailchimp.com'
const API_BASE = `https://${DC}.api.mailchimp.com/3.0`

const METADATA = {
  dc: DC,
  role: 'owner',
  accountname: 'Test Account',
  user_id: 12345,
  login: { email: 'test@example.com', avatar: 'https://example.com/avatar.png' },
  login_url: 'https://login.mailchimp.com',
  api_endpoint: `https://${DC}.api.mailchimp.com`,
}

describe('Mailchimp Marketing Service', () => {
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

  // ── OAuth System Methods ──

  describe('getOAuth2ConnectionURL', () => {
    it('returns the correct authorization URL', async () => {
      const url = await service.getOAuth2ConnectionURL()

      expect(url).toContain(`${OAUTH_BASE}/oauth2/authorize`)
      expect(url).toContain(`response_type=code`)
      expect(url).toContain(`client_id=${CLIENT_ID}`)
    })
  })

  describe('refreshToken', () => {
    it('throws an error explaining tokens do not expire', async () => {
      await expect(service.refreshToken()).rejects.toThrow('do not expire')
    })
  })

  describe('executeCallback', () => {
    it('exchanges code for token and returns identity info', async () => {
      const callbackObject = {
        code: 'auth-code-123',
        redirectURI: 'https://app.flowrunner.com/callback',
      }

      mock.onPost(`${OAUTH_BASE}/oauth2/token`).reply({
        access_token: 'new-access-token',
        expires_in: null,
      })
      mock.onGet(`${OAUTH_BASE}/oauth2/metadata`).reply(METADATA)

      const result = await service.executeCallback(callbackObject)

      expect(result).toEqual({
        token: 'new-access-token',
        expirationInSeconds: null,
        overwrite: true,
        connectionIdentityName: 'Test Account (test@example.com)',
        connectionIdentityImageURL: 'https://example.com/avatar.png',
      })

      // Verify token exchange request
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${OAUTH_BASE}/oauth2/token`)
      expect(mock.history[0].headers).toMatchObject({
        'Content-Type': 'application/x-www-form-urlencoded',
      })
      expect(mock.history[0].body).toContain('grant_type=authorization_code')
      expect(mock.history[0].body).toContain(`client_id=${CLIENT_ID}`)
      expect(mock.history[0].body).toContain(`client_secret=${CLIENT_SECRET}`)
      expect(mock.history[0].body).toContain(`code=auth-code-123`)

      // Verify metadata request
      expect(mock.history[1].method).toBe('get')
      expect(mock.history[1].url).toBe(`${OAUTH_BASE}/oauth2/metadata`)
      expect(mock.history[1].headers).toMatchObject({
        Authorization: 'OAuth new-access-token',
      })
    })

    it('constructs identity name with email only when accountname is missing', async () => {
      mock.onPost(`${OAUTH_BASE}/oauth2/token`).reply({
        access_token: 'tok',
        expires_in: null,
      })
      mock.onGet(`${OAUTH_BASE}/oauth2/metadata`).reply({
        ...METADATA,
        accountname: '',
      })

      const result = await service.executeCallback({ code: 'c', redirectURI: 'https://x.com' })

      expect(result.connectionIdentityName).toBe('test@example.com')
    })
  })

  // ── Dictionary Methods ──

  describe('getDictionaryLists', () => {
    beforeEach(() => {
      mock.onGet(`${OAUTH_BASE}/oauth2/metadata`).reply(METADATA)
    })

    it('returns lists with correct shape', async () => {
      mock.onGet(`${API_BASE}/lists`).reply({
        lists: [
          { id: 'list1', name: 'Newsletter', stats: { member_count: 500 } },
          { id: 'list2', name: 'Updates', stats: { member_count: 200 } },
        ],
        total_items: 2,
      })

      const result = await service.getDictionaryLists({ cursor: 0 })

      expect(result.items).toEqual([
        { label: 'Newsletter', value: 'list1', note: 'Members: 500' },
        { label: 'Updates', value: 'list2', note: 'Members: 200' },
      ])
      expect(result.cursor).toBeNull()
    })

    it('filters lists by search term', async () => {
      mock.onGet(`${API_BASE}/lists`).reply({
        lists: [
          { id: 'list1', name: 'Newsletter', stats: { member_count: 500 } },
          { id: 'list2', name: 'Updates', stats: { member_count: 200 } },
        ],
        total_items: 2,
      })

      const result = await service.getDictionaryLists({ search: 'news' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toBe('Newsletter')
    })

    it('returns cursor when more items are available', async () => {
      mock.onGet(`${API_BASE}/lists`).reply({
        lists: Array(100).fill({ id: 'x', name: 'List', stats: {} }),
        total_items: 250,
      })

      const result = await service.getDictionaryLists({ cursor: 0 })

      expect(result.cursor).toBe(100)
    })

    it('sends correct query parameters', async () => {
      mock.onGet(`${API_BASE}/lists`).reply({ lists: [], total_items: 0 })

      await service.getDictionaryLists({ cursor: 50 })

      expect(mock.history[1].query).toMatchObject({ offset: 50, count: 100 })
    })

    it('handles missing stats gracefully', async () => {
      mock.onGet(`${API_BASE}/lists`).reply({
        lists: [{ id: 'list1', name: 'No Stats' }],
        total_items: 1,
      })

      const result = await service.getDictionaryLists({})

      expect(result.items[0].note).toBe('Members: 0')
    })
  })

  describe('getMembers', () => {
    beforeEach(() => {
      mock.onGet(`${OAUTH_BASE}/oauth2/metadata`).reply(METADATA)
    })

    it('returns members with correct shape', async () => {
      mock.onGet(`${API_BASE}/lists/list1/members`).reply({
        members: [
          { id: 'm1', full_name: 'John Doe', email_address: 'john@test.com', status: 'subscribed' },
        ],
        total_items: 1,
      })

      const result = await service.getMembers({ criteria: { listId: 'list1' } })

      expect(result.items).toEqual([
        { label: 'John Doe (john@test.com)', value: 'm1', note: 'Status: subscribed' },
      ])
    })

    it('uses email as label when full_name is missing', async () => {
      mock.onGet(`${API_BASE}/lists/list1/members`).reply({
        members: [
          { id: 'm1', full_name: '', email_address: 'jane@test.com', status: 'pending' },
        ],
        total_items: 1,
      })

      const result = await service.getMembers({ criteria: { listId: 'list1' } })

      expect(result.items[0].label).toBe('jane@test.com (jane@test.com)')
    })

    it('throws when listId is missing', async () => {
      await expect(service.getMembers({ criteria: {} })).rejects.toThrow('List ID is required')
    })

    it('throws when criteria is missing', async () => {
      await expect(service.getMembers({})).rejects.toThrow('List ID is required')
    })

    it('filters members by search term', async () => {
      mock.onGet(`${API_BASE}/lists/list1/members`).reply({
        members: [
          { id: 'm1', full_name: 'John Doe', email_address: 'john@test.com', status: 'subscribed' },
          { id: 'm2', full_name: 'Jane Smith', email_address: 'jane@test.com', status: 'subscribed' },
        ],
        total_items: 2,
      })

      const result = await service.getMembers({ search: 'jane', criteria: { listId: 'list1' } })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('m2')
    })
  })

  describe('getMemberTags', () => {
    beforeEach(() => {
      mock.onGet(`${OAUTH_BASE}/oauth2/metadata`).reply(METADATA)
    })

    it('returns tags with correct shape', async () => {
      mock.onGet(`${API_BASE}/lists/list1/members/hash1/tags`).reply({
        tags: [{ id: 1, name: 'VIP' }, { id: 2, name: 'Premium' }],
        total_items: 2,
      })

      const result = await service.getMemberTags({
        criteria: { listId: 'list1', subscriberHash: 'hash1' },
      })

      expect(result.items).toEqual([
        { label: 'VIP', value: 'VIP', note: 'ID: 1' },
        { label: 'Premium', value: 'Premium', note: 'ID: 2' },
      ])
    })

    it('throws when criteria is incomplete', async () => {
      await expect(
        service.getMemberTags({ criteria: { listId: 'list1' } })
      ).rejects.toThrow('List ID and Subscriber Hash are required')
    })

    it('filters tags by search', async () => {
      mock.onGet(`${API_BASE}/lists/list1/members/hash1/tags`).reply({
        tags: [{ id: 1, name: 'VIP' }, { id: 2, name: 'Regular' }],
        total_items: 2,
      })

      const result = await service.getMemberTags({
        search: 'vip',
        criteria: { listId: 'list1', subscriberHash: 'hash1' },
      })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toBe('VIP')
    })
  })

  describe('getTags', () => {
    beforeEach(() => {
      mock.onGet(`${OAUTH_BASE}/oauth2/metadata`).reply(METADATA)
    })

    it('returns tags and passes search as query param', async () => {
      mock.onGet(`${API_BASE}/lists/list1/tag-search`).reply({
        tags: [{ id: 10, name: 'Promo' }],
        total_items: 1,
      })

      const result = await service.getTags({
        search: 'Promo',
        criteria: { listId: 'list1' },
      })

      expect(result.items).toEqual([
        { label: 'Promo', value: 'Promo', note: 'ID: 10' },
      ])
      // getTags passes search as query.name, not client-side filtering
      expect(mock.history[1].query).toMatchObject({ name: 'Promo' })
    })

    it('throws when listId is missing', async () => {
      await expect(service.getTags({ criteria: {} })).rejects.toThrow('List ID is required')
    })
  })

  describe('getCampaigns', () => {
    beforeEach(() => {
      mock.onGet(`${OAUTH_BASE}/oauth2/metadata`).reply(METADATA)
    })

    it('returns campaigns with correct shape', async () => {
      mock.onGet(`${API_BASE}/campaigns`).reply({
        campaigns: [
          { id: 'c1', settings: { title: 'Spring Sale', subject_line: 'Buy now' }, status: 'sent' },
        ],
        total_items: 1,
      })

      const result = await service.getCampaigns({})

      expect(result.items).toEqual([
        { label: 'Spring Sale', value: 'c1', note: 'Status: sent' },
      ])
    })

    it('falls back to subject_line when title is missing', async () => {
      mock.onGet(`${API_BASE}/campaigns`).reply({
        campaigns: [
          { id: 'c1', settings: { subject_line: 'Subject Only' }, status: 'draft' },
        ],
        total_items: 1,
      })

      const result = await service.getCampaigns({})

      expect(result.items[0].label).toBe('Subject Only')
    })

    it('falls back to Campaign ID when settings are empty', async () => {
      mock.onGet(`${API_BASE}/campaigns`).reply({
        campaigns: [
          { id: 'c1', settings: {}, status: 'draft' },
        ],
        total_items: 1,
      })

      const result = await service.getCampaigns({})

      expect(result.items[0].label).toBe('Campaign c1')
    })

    it('filters campaigns by search', async () => {
      mock.onGet(`${API_BASE}/campaigns`).reply({
        campaigns: [
          { id: 'c1', settings: { title: 'Spring Sale' }, status: 'sent' },
          { id: 'c2', settings: { title: 'Winter Promo' }, status: 'draft' },
        ],
        total_items: 2,
      })

      const result = await service.getCampaigns({ search: 'winter' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('c2')
    })
  })

  describe('getStores', () => {
    beforeEach(() => {
      mock.onGet(`${OAUTH_BASE}/oauth2/metadata`).reply(METADATA)
    })

    it('returns stores with correct shape', async () => {
      mock.onGet(`${API_BASE}/ecommerce/stores`).reply({
        stores: [{ id: 's1', name: 'My Shop', domain: 'shop.com' }],
        total_items: 1,
      })

      const result = await service.getStores({})

      expect(result.items).toEqual([
        { label: 'My Shop', value: 's1', note: 'Domain: shop.com' },
      ])
    })

    it('shows N/A when domain is missing', async () => {
      mock.onGet(`${API_BASE}/ecommerce/stores`).reply({
        stores: [{ id: 's1', name: 'No Domain' }],
        total_items: 1,
      })

      const result = await service.getStores({})

      expect(result.items[0].note).toBe('Domain: N/A')
    })

    it('filters stores by search', async () => {
      mock.onGet(`${API_BASE}/ecommerce/stores`).reply({
        stores: [
          { id: 's1', name: 'Alpha', domain: 'a.com' },
          { id: 's2', name: 'Beta', domain: 'b.com' },
        ],
        total_items: 2,
      })

      const result = await service.getStores({ search: 'beta' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('s2')
    })
  })

  // ── Action Methods ──

  describe('getListsInfo', () => {
    beforeEach(() => {
      mock.onGet(`${OAUTH_BASE}/oauth2/metadata`).reply(METADATA)
    })

    it('sends correct query with all parameters', async () => {
      const responseData = { lists: [], total_items: 0 }
      mock.onGet(`${API_BASE}/lists`).reply(responseData)

      const result = await service.getListsInfo(
        10,                         // count
        20,                         // offset
        '2024-01-01T00:00:00Z',     // beforeDateCreated
        '2023-01-01T00:00:00Z',     // sinceDateCreated
        '2024-06-01T00:00:00Z',     // beforeCampaignLastSent
        '2023-06-01T00:00:00Z',     // sinceCampaignLastSent
        'test@example.com',         // email
        'Date Created',             // sortField
        'Ascending',                // sortDir
        true,                       // hasEcommerceStore
        true                        // includeTotalContacts
      )

      expect(result).toEqual(responseData)

      const apiCall = mock.history[1] // [0] is metadata
      expect(apiCall.query).toMatchObject({
        count: 10,
        offset: 20,
        before_date_created: '2024-01-01T00:00:00Z',
        since_date_created: '2023-01-01T00:00:00Z',
        before_campaign_last_sent: '2024-06-01T00:00:00Z',
        since_campaign_last_sent: '2023-06-01T00:00:00Z',
        email: 'test@example.com',
        sort_field: 'date_created',
        sort_dir: 'ASC',
        has_ecommerce_store: true,
        include_total_contacts: true,
      })
    })

    it('resolves Descending sort direction', async () => {
      mock.onGet(`${API_BASE}/lists`).reply({ lists: [], total_items: 0 })

      await service.getListsInfo(
        undefined, undefined, undefined, undefined,
        undefined, undefined, undefined,
        'Date Created', 'Descending'
      )

      const apiCall = mock.history[1]
      expect(apiCall.query).toMatchObject({
        sort_field: 'date_created',
        sort_dir: 'DESC',
      })
    })

    it('omits undefined optional parameters from query', async () => {
      mock.onGet(`${API_BASE}/lists`).reply({ lists: [], total_items: 0 })

      await service.getListsInfo()

      const apiCall = mock.history[1]
      // The #clean helper strips undefined/null values
      expect(apiCall.query).not.toHaveProperty('count')
      expect(apiCall.query).not.toHaveProperty('email')
    })

    it('throws on API error', async () => {
      mock.onGet(`${API_BASE}/lists`).replyWithError({ message: 'Unauthorized', status: 401 })

      await expect(service.getListsInfo()).rejects.toThrow()
    })
  })

  describe('addMember', () => {
    beforeEach(() => {
      mock.onGet(`${OAUTH_BASE}/oauth2/metadata`).reply(METADATA)
    })

    it('sends POST with correct body for required fields only', async () => {
      const memberResponse = { id: 'mem1', email_address: 'new@test.com', status: 'subscribed' }
      mock.onPost(`${API_BASE}/lists/list1/members`).reply(memberResponse)

      const result = await service.addMember('list1', 'new@test.com', undefined, 'Subscribed')

      expect(result).toEqual(memberResponse)

      const apiCall = mock.history[1]
      expect(apiCall.method).toBe('post')
      expect(apiCall.body).toMatchObject({
        email_address: 'new@test.com',
        status: 'subscribed',
      })
      // undefined fields should be cleaned out
      expect(apiCall.body).not.toHaveProperty('email_type')
    })

    it('maps dropdown values to API values', async () => {
      mock.onPost(`${API_BASE}/lists/list1/members`).reply({ id: 'mem1' })

      await service.addMember('list1', 'new@test.com', 'HTML', 'Pending')

      const apiCall = mock.history[1]
      expect(apiCall.body).toMatchObject({
        email_type: 'html',
        status: 'pending',
      })
    })

    it('includes optional fields when provided', async () => {
      mock.onPost(`${API_BASE}/lists/list1/members`).reply({ id: 'mem1' })

      await service.addMember(
        'list1', 'new@test.com', 'Text', 'Subscribed',
        { FNAME: 'John' },          // mergeFields
        { interest1: true },         // interests
        'en',                        // language
        true,                        // vip
        { latitude: 40, longitude: -74 }, // location
        [{ marketing_permission_id: 'mp1', enabled: true }], // marketingPermissions
        '192.168.1.1',               // ipSignup
        '2024-01-01T00:00:00Z',      // timestampSignup
        '192.168.1.2',               // ipOpt
        '2024-01-02T00:00:00Z',      // timestampOpt
        ['VIP']                       // tags
      )

      const apiCall = mock.history[1]
      expect(apiCall.body).toMatchObject({
        email_address: 'new@test.com',
        email_type: 'text',
        status: 'subscribed',
        merge_fields: { FNAME: 'John' },
        interests: { interest1: true },
        language: 'en',
        vip: true,
        location: { latitude: 40, longitude: -74 },
        marketing_permissions: [{ marketing_permission_id: 'mp1', enabled: true }],
        ip_signup: '192.168.1.1',
        timestamp_signup: '2024-01-01T00:00:00Z',
        ip_opt: '192.168.1.2',
        timestamp_opt: '2024-01-02T00:00:00Z',
        tags: ['VIP'],
      })
    })

    it('appends skip_merge_validation query param when true', async () => {
      mock.onPost(`${API_BASE}/lists/list1/members?skip_merge_validation=true`).reply({ id: 'mem1' })

      await service.addMember(
        'list1', 'new@test.com', undefined, 'Subscribed',
        undefined, undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined,
        true // skipMergeValidation
      )

      const apiCall = mock.history[1]
      expect(apiCall.url).toContain('skip_merge_validation=true')
    })
  })

  describe('addOrUpdateListMember', () => {
    beforeEach(() => {
      mock.onGet(`${OAUTH_BASE}/oauth2/metadata`).reply(METADATA)
    })

    it('sends PUT with correct body', async () => {
      mock.onPut(`${API_BASE}/lists/list1/members/hash1`).reply({ id: 'mem1' })

      await service.addOrUpdateListMember(
        'list1', 'hash1', 'update@test.com', 'Subscribed', 'HTML', 'Unsubscribed'
      )

      const apiCall = mock.history[1]
      expect(apiCall.method).toBe('put')
      expect(apiCall.body).toMatchObject({
        email_address: 'update@test.com',
        status_if_new: 'subscribed',
        email_type: 'html',
        status: 'unsubscribed',
      })
    })

    it('appends skip_merge_validation when true', async () => {
      mock.onPut(`${API_BASE}/lists/list1/members/hash1?skip_merge_validation=true`).reply({ id: 'mem1' })

      await service.addOrUpdateListMember(
        'list1', 'hash1', 'x@test.com', undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined,
        true // skipMergeValidation
      )

      const apiCall = mock.history[1]
      expect(apiCall.url).toContain('skip_merge_validation=true')
    })
  })

  describe('unsubscribeOrDeleteMember', () => {
    beforeEach(() => {
      mock.onGet(`${OAUTH_BASE}/oauth2/metadata`).reply(METADATA)
    })

    it('sends PATCH to unsubscribe when deleteMember is false', async () => {
      mock.onPatch(`${API_BASE}/lists/list1/members/hash1`).reply({ status: 'unsubscribed' })

      await service.unsubscribeOrDeleteMember('list1', 'hash1', false)

      const apiCall = mock.history[1]
      expect(apiCall.method).toBe('patch')
      expect(apiCall.url).toBe(`${API_BASE}/lists/list1/members/hash1`)
      expect(apiCall.body).toEqual({ status: 'unsubscribed' })
    })

    it('sends POST to delete-permanent when deleteMember is true', async () => {
      mock.onPost(`${API_BASE}/lists/list1/members/hash1/actions/delete-permanent`).reply({})

      await service.unsubscribeOrDeleteMember('list1', 'hash1', true)

      const apiCall = mock.history[1]
      expect(apiCall.method).toBe('post')
      expect(apiCall.url).toBe(`${API_BASE}/lists/list1/members/hash1/actions/delete-permanent`)
    })

    it('unsubscribes when deleteMember is undefined', async () => {
      mock.onPatch(`${API_BASE}/lists/list1/members/hash1`).reply({ status: 'unsubscribed' })

      await service.unsubscribeOrDeleteMember('list1', 'hash1')

      expect(mock.history[1].method).toBe('patch')
    })
  })

  describe('searchMember', () => {
    beforeEach(() => {
      mock.onGet(`${OAUTH_BASE}/oauth2/metadata`).reply(METADATA)
    })

    it('returns exact match when found', async () => {
      const member = { id: 'm1', email_address: 'john@test.com' }
      mock.onGet(`${API_BASE}/search-members`).reply({
        exact_matches: { members: [member] },
        full_search: { members: [] },
      })

      const result = await service.searchMember('john@test.com')

      expect(result).toEqual(member)
      expect(mock.history[1].query).toMatchObject({ query: 'john@test.com' })
    })

    it('returns full search match when no exact match', async () => {
      const member = { id: 'm2', email_address: 'jane@test.com' }
      mock.onGet(`${API_BASE}/search-members`).reply({
        exact_matches: { members: [] },
        full_search: { members: [member] },
      })

      const result = await service.searchMember('jane')

      expect(result).toEqual(member)
    })

    it('passes listId as list_id query param', async () => {
      mock.onGet(`${API_BASE}/search-members`).reply({
        exact_matches: { members: [{ id: 'm1' }] },
        full_search: { members: [] },
      })

      await service.searchMember('query', 'list1')

      expect(mock.history[1].query).toMatchObject({ query: 'query', list_id: 'list1' })
    })

    it('creates member when not found and createFields provided', async () => {
      mock.onGet(`${API_BASE}/search-members`).reply({
        exact_matches: { members: [] },
        full_search: { members: [] },
      })
      mock.onPost(`${API_BASE}/lists/list1/members`).reply({
        id: 'new-mem',
        email_address: 'new@test.com',
      })

      const result = await service.searchMember('new@test.com', undefined, {
        list_id: 'list1',
        email_address: 'new@test.com',
        status: 'subscribed',
      })

      expect(result).toEqual({ id: 'new-mem', email_address: 'new@test.com' })
      expect(mock.history[2].method).toBe('post')
      expect(mock.history[2].body).toMatchObject({
        email_address: 'new@test.com',
        status: 'subscribed',
      })
      // list_id and skip_merge_validation should NOT be in the body
      expect(mock.history[2].body).not.toHaveProperty('list_id')
    })

    it('passes skip_merge_validation to URL when creating', async () => {
      mock.onGet(`${API_BASE}/search-members`).reply({
        exact_matches: { members: [] },
        full_search: { members: [] },
      })
      mock.onPost(`${API_BASE}/lists/list1/members?skip_merge_validation=true`).reply({ id: 'new' })

      await service.searchMember('q', undefined, {
        list_id: 'list1',
        skip_merge_validation: true,
        email_address: 'x@test.com',
      })

      expect(mock.history[2].url).toContain('skip_merge_validation=true')
    })

    it('throws when not found and no createFields', async () => {
      mock.onGet(`${API_BASE}/search-members`).reply({
        exact_matches: { members: [] },
        full_search: { members: [] },
      })

      await expect(service.searchMember('nobody@test.com')).rejects.toThrow(
        "No member was found for the query 'nobody@test.com'."
      )
    })
  })

  describe('addMemberNote', () => {
    beforeEach(() => {
      mock.onGet(`${OAUTH_BASE}/oauth2/metadata`).reply(METADATA)
    })

    it('sends POST with correct body', async () => {
      const noteResponse = { id: 1, note: 'Test note' }
      mock.onPost(`${API_BASE}/lists/list1/members/hash1/notes`).reply(noteResponse)

      const result = await service.addMemberNote('list1', 'hash1', 'Test note')

      expect(result).toEqual(noteResponse)
      expect(mock.history[1].body).toEqual({ note: 'Test note' })
    })
  })

  describe('archiveMember', () => {
    beforeEach(() => {
      mock.onGet(`${OAUTH_BASE}/oauth2/metadata`).reply(METADATA)
    })

    it('sends DELETE request', async () => {
      mock.onDelete(`${API_BASE}/lists/list1/members/hash1`).reply({})

      await service.archiveMember('list1', 'hash1')

      expect(mock.history[1].method).toBe('delete')
      expect(mock.history[1].url).toBe(`${API_BASE}/lists/list1/members/hash1`)
    })
  })

  describe('addMemberTag', () => {
    beforeEach(() => {
      mock.onGet(`${OAUTH_BASE}/oauth2/metadata`).reply(METADATA)
    })

    it('sends POST with tag as active', async () => {
      mock.onPost(`${API_BASE}/lists/list1/members/hash1/tags`).reply({})

      await service.addMemberTag('list1', 'hash1', 'VIP')

      expect(mock.history[1].body).toEqual({
        tags: [{ name: 'VIP', status: 'active' }],
      })
    })

    it('includes is_syncing when provided', async () => {
      mock.onPost(`${API_BASE}/lists/list1/members/hash1/tags`).reply({})

      await service.addMemberTag('list1', 'hash1', 'VIP', true)

      expect(mock.history[1].body).toMatchObject({
        tags: [{ name: 'VIP', status: 'active' }],
        is_syncing: true,
      })
    })
  })

  describe('removeMemberTag', () => {
    beforeEach(() => {
      mock.onGet(`${OAUTH_BASE}/oauth2/metadata`).reply(METADATA)
    })

    it('sends POST with tag as inactive', async () => {
      mock.onPost(`${API_BASE}/lists/list1/members/hash1/tags`).reply({})

      await service.removeMemberTag('list1', 'hash1', 'OldTag')

      expect(mock.history[1].body).toEqual({
        tags: [{ name: 'OldTag', status: 'inactive' }],
      })
    })

    it('includes is_syncing when provided', async () => {
      mock.onPost(`${API_BASE}/lists/list1/members/hash1/tags`).reply({})

      await service.removeMemberTag('list1', 'hash1', 'OldTag', true)

      expect(mock.history[1].body).toMatchObject({
        is_syncing: true,
      })
    })
  })

  describe('createTag', () => {
    beforeEach(() => {
      mock.onGet(`${OAUTH_BASE}/oauth2/metadata`).reply(METADATA)
    })

    it('sends POST with name and empty static_segment', async () => {
      const tagResponse = { id: 99, name: 'NewTag' }
      mock.onPost(`${API_BASE}/lists/list1/segments`).reply(tagResponse)

      const result = await service.createTag('list1', 'NewTag')

      expect(result).toEqual(tagResponse)
      expect(mock.history[1].body).toEqual({ name: 'NewTag', static_segment: [] })
    })
  })

  describe('searchTag', () => {
    beforeEach(() => {
      mock.onGet(`${OAUTH_BASE}/oauth2/metadata`).reply(METADATA)
    })

    it('returns tag when found by exact name', async () => {
      mock.onGet(`${API_BASE}/lists/list1/tag-search`).reply({
        tags: [{ id: 1, name: 'VIP' }, { id: 2, name: 'Premium' }],
      })

      const result = await service.searchTag('list1', 'VIP')

      expect(result).toEqual({ id: 1, name: 'VIP' })
      expect(mock.history[1].query).toMatchObject({ name: 'VIP' })
    })

    it('creates tag when not found and createNewTag is true', async () => {
      mock.onGet(`${API_BASE}/lists/list1/tag-search`).reply({
        tags: [{ id: 1, name: 'Other' }],
      })
      mock.onPost(`${API_BASE}/lists/list1/segments`).reply({ id: 50, name: 'NewTag' })

      const result = await service.searchTag('list1', 'NewTag', true)

      expect(result).toEqual({ id: 50, name: 'NewTag' })
      expect(mock.history[2].body).toEqual({ name: 'NewTag', static_segment: [] })
    })

    it('throws when not found and createNewTag is false', async () => {
      mock.onGet(`${API_BASE}/lists/list1/tag-search`).reply({
        tags: [],
      })

      await expect(service.searchTag('list1', 'Missing')).rejects.toThrow(
        "No tag with name 'Missing' was found."
      )
    })
  })

  describe('getCampaignInfo', () => {
    beforeEach(() => {
      mock.onGet(`${OAUTH_BASE}/oauth2/metadata`).reply(METADATA)
    })

    it('sends GET with campaign ID', async () => {
      const campaign = { id: 'c1', type: 'regular', status: 'sent' }
      mock.onGet(`${API_BASE}/campaigns/c1`).reply(campaign)

      const result = await service.getCampaignInfo('c1')

      expect(result).toEqual(campaign)
      expect(mock.history[1].url).toBe(`${API_BASE}/campaigns/c1`)
    })

    it('sends fields and exclude_fields as comma-separated strings', async () => {
      mock.onGet(`${API_BASE}/campaigns/c1`).reply({ id: 'c1' })

      await service.getCampaignInfo('c1', ['id', 'status'], ['settings'])

      expect(mock.history[1].query).toMatchObject({
        fields: 'id,status',
        exclude_fields: 'settings',
      })
    })

    it('omits fields params when not provided', async () => {
      mock.onGet(`${API_BASE}/campaigns/c1`).reply({ id: 'c1' })

      await service.getCampaignInfo('c1')

      const query = mock.history[1].query
      expect(query).not.toHaveProperty('fields')
      expect(query).not.toHaveProperty('exclude_fields')
    })
  })

  // ── Auth Header Verification ──

  describe('API request auth headers', () => {
    beforeEach(() => {
      mock.onGet(`${OAUTH_BASE}/oauth2/metadata`).reply(METADATA)
    })

    it('sends Bearer token on API requests', async () => {
      mock.onGet(`${API_BASE}/lists`).reply({ lists: [], total_items: 0 })

      await service.getListsInfo()

      const apiCall = mock.history[1]
      expect(apiCall.headers).toMatchObject({
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      })
    })

    it('sends OAuth token on metadata requests', async () => {
      mock.onGet(`${API_BASE}/lists`).reply({ lists: [], total_items: 0 })

      await service.getListsInfo()

      const metadataCall = mock.history[0]
      expect(metadataCall.headers).toMatchObject({
        Authorization: `OAuth ${ACCESS_TOKEN}`,
      })
    })
  })
})
