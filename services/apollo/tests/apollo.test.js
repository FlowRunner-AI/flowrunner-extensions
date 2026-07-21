'use strict'

const { createSandbox } = require('../../../service-sandbox')

const CLIENT_ID = 'test-client-id'
const CLIENT_SECRET = 'test-client-secret'
const MASTER_API_KEY = 'test-master-api-key'
const ACCESS_TOKEN = 'test-oauth-access-token'

// Note: the service source has a leading space in API_BASE_URL
const API_BASE = ' https://app.apollo.io/api/v1'
const ACCESS_TOKEN_URL = 'https://app.apollo.io/api/v1/oauth/token'

describe('Apollo.io Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      masterAPIKey: MASTER_API_KEY,
    })

    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()

    // Simulate the OAuth access token that the Flowrunner runtime injects
    service.request = {
      headers: { 'oauth-access-token': ACCESS_TOKEN },
    }
  })

  afterEach(() => {
    mock.reset()
    // Reset so #resolveAccessToken picks up the token again after reset
    service.accessTokenResolved = false
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Registration ──

  describe('service registration', () => {
    it('registers with correct config items', () => {
      expect(sandbox.getConfigItems()).toEqual([
        expect.objectContaining({
          name: 'clientId',
          required: true,
          shared: true,
          type: 'STRING',
        }),
        expect.objectContaining({
          name: 'clientSecret',
          required: true,
          shared: true,
          type: 'STRING',
        }),
        expect.objectContaining({
          name: 'masterAPIKey',
          required: true,
          type: 'STRING',
        }),
      ])
    })
  })

  // ── OAuth System Methods ──

  describe('getOAuth2ConnectionURL', () => {
    it('returns the correct authorization URL', async () => {
      const url = await service.getOAuth2ConnectionURL()

      expect(url).toContain('https://app.apollo.io/#/oauth/authorize')
      expect(url).toContain(`client_id=${CLIENT_ID}`)
      expect(url).toContain('response_type=code')
      expect(url).toContain('scope=')
      expect(url).toContain('read_user_profile')
    })
  })

  describe('refreshToken', () => {
    it('sends correct POST request to exchange refresh token', async () => {
      const mockResponse = {
        access_token: 'new-access-token',
        expires_in: 3600,
        refresh_token: 'new-refresh-token',
      }

      mock.onPost(ACCESS_TOKEN_URL).reply(mockResponse)

      const result = await service.refreshToken('old-refresh-token')

      expect(result).toEqual({
        token: 'new-access-token',
        expirationInSeconds: 3600,
        refreshToken: 'new-refresh-token',
      })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({
        'Content-Type': 'application/x-www-form-urlencoded',
      })
      expect(mock.history[0].body).toContain('grant_type=refresh_token')
      expect(mock.history[0].body).toContain('refresh_token=old-refresh-token')
      expect(mock.history[0].body).toContain(`client_id=${CLIENT_ID}`)
      expect(mock.history[0].body).toContain(`client_secret=${CLIENT_SECRET}`)
    })

    it('falls back to original refresh token when none returned', async () => {
      mock.onPost(ACCESS_TOKEN_URL).reply({
        access_token: 'new-token',
        expires_in: 7200,
      })

      const result = await service.refreshToken('keep-this-token')

      expect(result.refreshToken).toBe('keep-this-token')
    })

    it('throws on API error', async () => {
      mock.onPost(ACCESS_TOKEN_URL).replyWithError({ message: 'Unauthorized' })

      await expect(service.refreshToken('bad-token')).rejects.toThrow()
    })
  })

  describe('executeCallback', () => {
    it('exchanges code for token and fetches user info', async () => {
      const tokenResponse = {
        access_token: 'callback-access-token',
        expires_in: 3600,
        refresh_token: 'callback-refresh-token',
      }

      const userInfoResponse = {
        first_name: 'John',
        last_name: 'Doe',
        email: 'john@example.com',
      }

      mock.onPost(ACCESS_TOKEN_URL).reply(tokenResponse)
      mock.onGet(`${API_BASE}/users/api_profile`).reply(userInfoResponse)

      const result = await service.executeCallback({
        code: 'auth-code',
        redirectURI: 'https://app.flowrunner.com/callback',
      })

      expect(result).toEqual({
        token: 'callback-access-token',
        expirationInSeconds: 3600,
        refreshToken: 'callback-refresh-token',
        connectionIdentityName: 'John Doe (john@example.com)',
        overwrite: true,
        userData: {},
      })

      // Verify token exchange request
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toContain('grant_type=authorization_code')
      expect(mock.history[0].body).toContain('code=auth-code')
      expect(mock.history[0].body).toContain(`client_id=${CLIENT_ID}`)
      expect(mock.history[0].body).toContain(`client_secret=${CLIENT_SECRET}`)

      // Verify user info request uses the exchanged access token
      expect(mock.history[1].method).toBe('get')
      expect(mock.history[1].headers).toMatchObject({
        Authorization: 'Bearer callback-access-token',
      })
    })

    it('returns empty object when user info request fails', async () => {
      mock.onPost(ACCESS_TOKEN_URL).reply({
        access_token: 'token',
        expires_in: 3600,
      })
      mock.onGet(`${API_BASE}/users/api_profile`).replyWithError({ message: 'Forbidden' })

      const result = await service.executeCallback({
        code: 'auth-code',
        redirectURI: 'https://example.com/callback',
      })

      expect(result).toEqual({})
    })
  })

  // ── People Enrichment ──

  describe('enrichPerson', () => {
    it('sends POST with only provided fields', async () => {
      const mockResponse = { person: { id: 'p1', name: 'Jane' } }
      mock.onPost(`${API_BASE}/people/match`).reply(mockResponse)

      const result = await service.enrichPerson(
        null, 'jane@example.com', 'Jane', 'Doe'
      )

      expect(result).toEqual(mockResponse)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({
        Authorization: `Bearer ${ACCESS_TOKEN}`,
      })
      expect(mock.history[0].body).toEqual({
        email: 'jane@example.com',
        first_name: 'Jane',
        last_name: 'Doe',
      })
    })

    it('includes all fields when provided', async () => {
      mock.onPost(`${API_BASE}/people/match`).reply({ person: {} })

      await service.enrichPerson(
        'p1', 'test@co.com', 'John', 'Smith', 'John Smith',
        'co.com', 'CompanyCo', 'https://linkedin.com/in/john',
        true, true, 'https://webhook.example.com'
      )

      expect(mock.history[0].body).toEqual({
        id: 'p1',
        email: 'test@co.com',
        first_name: 'John',
        last_name: 'Smith',
        name: 'John Smith',
        domain: 'co.com',
        organization_name: 'CompanyCo',
        linkedin_url: 'https://linkedin.com/in/john',
        reveal_personal_emails: true,
        reveal_phone_number: true,
        webhook_url: 'https://webhook.example.com',
      })
    })

    it('omits webhook_url when reveal_phone_number is false', async () => {
      mock.onPost(`${API_BASE}/people/match`).reply({ person: {} })

      await service.enrichPerson(
        null, 'test@co.com', null, null, null,
        null, null, null, null, false, 'https://webhook.example.com'
      )

      expect(mock.history[0].body).toEqual({
        email: 'test@co.com',
        reveal_phone_number: false,
      })
    })

    it('handles boolean false for reveal_personal_emails', async () => {
      mock.onPost(`${API_BASE}/people/match`).reply({ person: {} })

      await service.enrichPerson(
        null, null, null, null, null,
        null, null, null, false
      )

      expect(mock.history[0].body).toEqual({
        reveal_personal_emails: false,
      })
    })

    it('throws on API error', async () => {
      mock.onPost(`${API_BASE}/people/match`).replyWithError({ message: 'Not Found' })

      await expect(service.enrichPerson(null, 'bad@test.com')).rejects.toThrow()
    })
  })

  describe('enrichPeople', () => {
    it('sends POST with people array and options', async () => {
      const people = [
        { email: 'a@test.com', first_name: 'Alice' },
        { email: 'b@test.com', first_name: 'Bob' },
      ]

      mock.onPost(`${API_BASE}/mixed_people/bulk_enrich`).reply({
        people: [{ first_name: 'Alice' }, { first_name: 'Bob' }],
      })

      const result = await service.enrichPeople(people, true, false, 'https://hook.example.com')

      expect(result).toEqual({
        status: { code: 200, message: '' },
        data: [{ first_name: 'Alice' }, { first_name: 'Bob' }],
      })
      expect(mock.history[0].body).toEqual({
        people,
        reveal_personal_emails: true,
        reveal_phone_number: false,
        webhook_url: 'https://hook.example.com',
      })
    })

    it('sends minimal body when optional params are undefined', async () => {
      mock.onPost(`${API_BASE}/mixed_people/bulk_enrich`).reply({ people: [] })

      await service.enrichPeople([{ email: 'x@test.com' }])

      expect(mock.history[0].body).toEqual({
        people: [{ email: 'x@test.com' }],
      })
    })

    it('returns empty array when response has no people', async () => {
      mock.onPost(`${API_BASE}/mixed_people/bulk_enrich`).reply({})

      const result = await service.enrichPeople([{ email: 'x@test.com' }])

      expect(result.data).toEqual([])
    })

    it('throws when people is not an array', async () => {
      await expect(service.enrichPeople(null)).rejects.toThrow(
        'The \'people\' parameter must be a non-empty array.'
      )
    })

    it('throws when people is an empty array', async () => {
      await expect(service.enrichPeople([])).rejects.toThrow(
        'The \'people\' parameter must be a non-empty array.'
      )
    })

    it('throws when people exceeds 100 entries', async () => {
      const tooMany = Array(101).fill({ email: 'x@test.com' })

      await expect(service.enrichPeople(tooMany)).rejects.toThrow(
        'Apollo API supports a maximum of 100 people per request.'
      )
    })
  })

  // ── Company Research ──

  describe('enrichOrganization', () => {
    it('sends GET with domain and master API key', async () => {
      const orgData = { organization: { id: 'org1', name: 'TestCorp' } }
      mock.onGet(`${API_BASE}/organizations/enrich`).reply(orgData)

      const result = await service.enrichOrganization('testcorp.com')

      expect(result).toEqual(orgData)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({
        'X-API-Key': MASTER_API_KEY,
      })
      expect(mock.history[0].query).toMatchObject({ domain: 'testcorp.com' })
      // Should NOT have OAuth Bearer token when X-API-Key is used
      expect(mock.history[0].headers.Authorization).toBeUndefined()
    })
  })

  describe('getOrganizationJobPostings', () => {
    it('sends GET with organization ID and master API key', async () => {
      const jobsData = { organization_job_postings: [{ id: 'j1', title: 'Engineer' }] }
      mock.onGet(`${API_BASE}/organizations/org123/job_postings`).reply(jobsData)

      const result = await service.getOrganizationJobPostings('org123')

      expect(result).toEqual(jobsData)
      expect(mock.history[0].headers).toMatchObject({
        'X-API-Key': MASTER_API_KEY,
      })
    })
  })

  // ── People Search ──

  describe('peopleSearch', () => {
    it('sends POST with all parameters', async () => {
      const searchResult = {
        pagination: { page: 1, per_page: 10, total_entries: 1 },
        contacts: [{ id: 'c1', name: 'Alice' }],
      }
      mock.onPost(`${API_BASE}/mixed_people/search`).reply(searchResult)

      const result = await service.peopleSearch(
        'Alice',
        ['VP of Sales'],
        true,
        ['director', 'vp'],
        ['San Francisco'],
        ['New York'],
        ['google.com'],
        ['verified'],
        ['org1'],
        ['100,500'],
        'sales',
        1,
        10
      )

      expect(result).toEqual(searchResult)
      expect(mock.history[0].body).toEqual({
        person_name: 'Alice',
        'person_titles[]': ['VP of Sales'],
        include_similar_titles: true,
        'person_seniorities[]': ['director', 'vp'],
        'person_locations[]': ['San Francisco'],
        'organization_locations[]': ['New York'],
        'q_organization_domains_list[]': ['google.com'],
        'contact_email_status[]': ['verified'],
        'organization_ids[]': ['org1'],
        'organization_num_employees_ranges[]': ['100,500'],
        q_keywords: 'sales',
        page: 1,
        per_page: 10,
      })
      // Uses OAuth token, not API key
      expect(mock.history[0].headers).toMatchObject({
        Authorization: `Bearer ${ACCESS_TOKEN}`,
      })
    })

    it('sends POST with no parameters (empty body)', async () => {
      mock.onPost(`${API_BASE}/mixed_people/search`).reply({ contacts: [] })

      await service.peopleSearch()

      expect(mock.history[0].body).toEqual({})
    })
  })

  // ── Organization Search ──

  describe('searchOrganizations', () => {
    it('sends POST with all parameters', async () => {
      mock.onPost(`${API_BASE}/mixed_companies/search`).reply({
        pagination: { page: 1, total_entries: 5 },
        organizations: [],
      })

      await service.searchOrganizations(
        ['100,500'],
        ['San Francisco'],
        ['London'],
        1000000,
        50000000,
        ['salesforce', 'hubspot crm'],
        ['saas'],
        'TechCorp',
        ['org1'],
        1,
        25
      )

      expect(mock.history[0].query).toEqual({
        'organization_num_employees_ranges[]': ['100,500'],
        'organization_locations[]': ['San Francisco'],
        'organization_not_locations[]': ['London'],
        'revenue_range[min]': 1000000,
        'revenue_range[max]': 50000000,
        'currently_using_any_of_technology_uids[]': ['salesforce', 'hubspot_crm'],
        'q_organization_keyword_tags[]': ['saas'],
        q_organization_name: 'TechCorp',
        'organization_ids[]': ['org1'],
        page: 1,
        per_page: 25,
      })
    })

    it('replaces spaces with underscores in technology UIDs', async () => {
      mock.onPost(`${API_BASE}/mixed_companies/search`).reply({ organizations: [] })

      await service.searchOrganizations(
        null, null, null, undefined, undefined,
        ['Google Cloud Platform', 'amazon web services']
      )

      expect(mock.history[0].query).toMatchObject({
        'currently_using_any_of_technology_uids[]': ['Google_Cloud_Platform', 'amazon_web_services'],
      })
    })

    it('sends POST with no parameters (empty query)', async () => {
      mock.onPost(`${API_BASE}/mixed_companies/search`).reply({ organizations: [] })

      await service.searchOrganizations()

      expect(mock.history[0].query).toEqual({})
    })
  })

  // ── Task Management ──

  describe('createTask', () => {
    it('sends POST with all parameters and master API key', async () => {
      const taskResult = { success: true, tasks_created: 1 }
      mock.onPost(`${API_BASE}/tasks/bulk_create`).reply(taskResult)

      const dueAt = new Date('2026-08-15T14:30:00.000Z').getTime()

      const result = await service.createTask(
        'user1', ['contact1', 'contact2'], 'high', dueAt,
        'call', 'scheduled', 'Follow up call'
      )

      expect(result).toEqual(taskResult)
      expect(mock.history[0].headers).toMatchObject({
        'X-API-Key': MASTER_API_KEY,
      })
      expect(mock.history[0].query).toMatchObject({
        user_id: 'user1',
        'contact_ids[]': ['contact1', 'contact2'],
        priority: 'high',
        due_at: '2026-08-15T14:30:00Z',
        type: 'call',
        status: 'scheduled',
        note: 'Follow up call',
      })
    })

    it('formats due_at by stripping milliseconds', async () => {
      mock.onPost(`${API_BASE}/tasks/bulk_create`).reply({ success: true })

      const dueAt = new Date('2026-01-01T12:00:00.456Z').getTime()
      await service.createTask('u1', ['c1'], 'low', dueAt, 'action_item', 'scheduled')

      expect(mock.history[0].query.due_at).toBe('2026-01-01T12:00:00Z')
    })
  })

  // ── Team Management ──

  describe('getUsers', () => {
    it('sends GET with pagination and master API key', async () => {
      const usersResponse = {
        pagination: { page: 1, per_page: 10, total_entries: 2 },
        users: [{ id: 'u1', name: 'Alice' }],
      }
      mock.onGet(`${API_BASE}/users/search`).reply(usersResponse)

      const result = await service.getUsers(1, 10)

      expect(result).toEqual(usersResponse)
      expect(mock.history[0].headers).toMatchObject({
        'X-API-Key': MASTER_API_KEY,
      })
      expect(mock.history[0].query).toMatchObject({ page: 1, per_page: 10 })
    })

    it('sends GET with no pagination params', async () => {
      mock.onGet(`${API_BASE}/users/search`).reply({ users: [] })

      await service.getUsers()

      expect(mock.history[0].query).toEqual({})
    })
  })

  // ── Sequences ──

  describe('searchSequences', () => {
    it('sends POST with query and pagination using master API key', async () => {
      mock.onPost(`${API_BASE}/emailer_campaigns/search`).reply({
        emailer_campaigns: [{ id: 's1', name: 'Welcome' }],
      })

      await service.searchSequences('Welcome', 1, 5)

      expect(mock.history[0].headers).toMatchObject({
        'X-API-Key': MASTER_API_KEY,
      })
      expect(mock.history[0].query).toMatchObject({
        q_name: 'Welcome',
        page: 1,
        per_page: 5,
      })
    })

    it('sends POST with no params', async () => {
      mock.onPost(`${API_BASE}/emailer_campaigns/search`).reply({ emailer_campaigns: [] })

      await service.searchSequences()

      expect(mock.history[0].query).toEqual({})
    })
  })

  describe('addContactsToSequence', () => {
    it('sends POST with all parameters', async () => {
      mock.onPost(`${API_BASE}/emailer_campaigns/seq1/add_contact_ids`).reply({
        entity_progress_job: { id: 'job1' },
      })

      await service.addContactsToSequence(
        'seq1', ['c1', 'c2'], 'email-acc-1',
        true, false, true, false, true, 'user1'
      )

      expect(mock.history[0].headers).toMatchObject({
        'X-API-Key': MASTER_API_KEY,
      })
      expect(mock.history[0].query).toMatchObject({
        'contact_ids[]': ['c1', 'c2'],
        send_email_from_email_account_id: 'email-acc-1',
        sequence_no_email: true,
        sequence_unverified_email: false,
        sequence_job_change: true,
        sequence_active_in_other_campaigns: false,
        sequence_finished_in_other_campaigns: true,
        user_id: 'user1',
        emailer_campaign_id: 'seq1',
      })
    })

    it('sends only required fields when optional booleans are undefined', async () => {
      mock.onPost(`${API_BASE}/emailer_campaigns/seq2/add_contact_ids`).reply({})

      await service.addContactsToSequence('seq2', ['c1'], 'email-acc-1')

      expect(mock.history[0].query).toEqual({
        'contact_ids[]': ['c1'],
        send_email_from_email_account_id: 'email-acc-1',
        emailer_campaign_id: 'seq2',
      })
    })
  })

  // ── Contact Management ──

  describe('searchContacts', () => {
    it('sends POST with all parameters using OAuth token', async () => {
      mock.onPost(`${API_BASE}/contacts/search`).reply({
        contacts: [{ id: 'c1', first_name: 'Walt' }],
        pagination: { page: 1, total_entries: 1 },
      })

      await service.searchContacts(
        'Walt', ['stage1', 'stage2'], 'contact_created_at', true, 1, 25
      )

      expect(mock.history[0].headers).toMatchObject({
        Authorization: `Bearer ${ACCESS_TOKEN}`,
      })
      expect(mock.history[0].query).toMatchObject({
        q_keywords: 'Walt',
        'contact_stage_ids[]': ['stage1', 'stage2'],
        sort_by_field: 'contact_created_at',
        sort_ascending: true,
        page: 1,
        per_page: 25,
      })
    })

    it('includes sort_ascending false when explicitly set', async () => {
      mock.onPost(`${API_BASE}/contacts/search`).reply({ contacts: [] })

      await service.searchContacts(null, null, 'contact_updated_at', false)

      expect(mock.history[0].query).toMatchObject({
        sort_by_field: 'contact_updated_at',
        sort_ascending: false,
      })
    })

    it('sends POST with empty query when no params provided', async () => {
      mock.onPost(`${API_BASE}/contacts/search`).reply({ contacts: [] })

      await service.searchContacts()

      expect(mock.history[0].query).toEqual({})
    })
  })

  // ── Dictionary Methods ──

  describe('getContactStagesDictionary', () => {
    it('returns mapped stages from API', async () => {
      mock.onGet(`${API_BASE}/account_stages`).reply({
        account_stages: [
          { id: 's1', name: 'Qualified Lead' },
          { id: 's2', name: 'Nurture' },
        ],
      })

      const result = await service.getContactStagesDictionary({})

      expect(result).toEqual({
        items: [
          { label: 'Qualified Lead', value: 's1' },
          { label: 'Nurture', value: 's2' },
        ],
      })
      expect(mock.history[0].headers).toMatchObject({
        'X-API-Key': MASTER_API_KEY,
      })
    })

    it('filters by search string (case-insensitive)', async () => {
      mock.onGet(`${API_BASE}/account_stages`).reply({
        account_stages: [
          { id: 's1', name: 'Qualified Lead' },
          { id: 's2', name: 'Nurture' },
          { id: 's3', name: 'Disqualified' },
        ],
      })

      const result = await service.getContactStagesDictionary({ search: 'qual' })

      expect(result.items).toHaveLength(2)
      expect(result.items[0].label).toBe('Qualified Lead')
      expect(result.items[1].label).toBe('Disqualified')
    })

    it('returns empty items when no stages exist', async () => {
      mock.onGet(`${API_BASE}/account_stages`).reply({})

      const result = await service.getContactStagesDictionary({})

      expect(result.items).toEqual([])
    })
  })

  describe('getSequencesDictionary', () => {
    it('returns mapped sequences with pagination cursor', async () => {
      mock.onPost(`${API_BASE}/emailer_campaigns/search`).reply({
        emailer_campaigns: [
          { id: 'seq1', name: 'Welcome Series' },
          { id: 'seq2', name: 'Product Launch' },
        ],
        pagination: { page: 1, total_pages: 3 },
      })

      const result = await service.getSequencesDictionary({})

      expect(result).toEqual({
        items: [
          { label: 'Welcome Series', value: 'seq1' },
          { label: 'Product Launch', value: 'seq2' },
        ],
        cursor: '2',
      })
      expect(mock.history[0].query).toMatchObject({ page: 1, per_page: 10 })
    })

    it('passes search as q_name and cursor as page', async () => {
      mock.onPost(`${API_BASE}/emailer_campaigns/search`).reply({
        emailer_campaigns: [],
        pagination: { page: 3, total_pages: 3 },
      })

      const result = await service.getSequencesDictionary({ search: 'test', cursor: '3' })

      expect(mock.history[0].query).toMatchObject({
        q_name: 'test',
        page: 3,
        per_page: 10,
      })
      expect(result.cursor).toBeNull()
    })

    it('returns null cursor on last page', async () => {
      mock.onPost(`${API_BASE}/emailer_campaigns/search`).reply({
        emailer_campaigns: [{ id: 's1', name: 'Only' }],
        pagination: { page: 1, total_pages: 1 },
      })

      const result = await service.getSequencesDictionary({})

      expect(result.cursor).toBeNull()
    })
  })

  describe('getEmailAccountsDictionary', () => {
    it('returns mapped email accounts', async () => {
      mock.onGet(`${API_BASE}/email_accounts`).reply({
        email_accounts: [
          { id: 'ea1', name: 'John Doe', email: 'john@co.com' },
          { id: 'ea2', name: null, email: 'jane@co.com' },
        ],
      })

      const result = await service.getEmailAccountsDictionary({})

      expect(result).toEqual({
        items: [
          { label: 'John Doe', value: 'ea1' },
          { label: 'jane@co.com', value: 'ea2' },
        ],
      })
      expect(mock.history[0].headers).toMatchObject({
        'X-API-Key': MASTER_API_KEY,
      })
    })

    it('filters by search on name and email', async () => {
      mock.onGet(`${API_BASE}/email_accounts`).reply({
        email_accounts: [
          { id: 'ea1', name: 'John Doe', email: 'john@co.com' },
          { id: 'ea2', name: 'Jane Smith', email: 'jane@co.com' },
        ],
      })

      const result = await service.getEmailAccountsDictionary({ search: 'jane' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('ea2')
    })

    it('returns empty items when no accounts exist', async () => {
      mock.onGet(`${API_BASE}/email_accounts`).reply({})

      const result = await service.getEmailAccountsDictionary({})

      expect(result.items).toEqual([])
    })
  })

  describe('getContactsDictionary', () => {
    it('returns mapped contacts with pagination cursor', async () => {
      mock.onPost(`${API_BASE}/contacts/search`).reply({
        contacts: [
          { id: 'c1', first_name: 'Alice', last_name: 'Smith', email: 'alice@co.com', organization_name: 'Co' },
          { id: 'c2', first_name: null, last_name: null, email: 'unknown@co.com', organization_name: 'Co2' },
        ],
        pagination: { page: 1, total_pages: 5 },
      })

      const result = await service.getContactsDictionary({})

      expect(result.items).toEqual([
        { label: 'Alice Smith', value: 'c1', note: 'alice@co.com' },
        { label: 'unknown@co.com', value: 'c2', note: 'unknown@co.com' },
      ])
      expect(result.cursor).toBe('2')
      expect(mock.history[0].query).toMatchObject({ page: 1, per_page: 20 })
    })

    it('passes search as q_keywords', async () => {
      mock.onPost(`${API_BASE}/contacts/search`).reply({
        contacts: [],
        pagination: { page: 1, total_pages: 1 },
      })

      await service.getContactsDictionary({ search: 'alice' })

      expect(mock.history[0].query).toMatchObject({ q_keywords: 'alice' })
    })

    it('uses organization_name as note fallback when email is absent', async () => {
      mock.onPost(`${API_BASE}/contacts/search`).reply({
        contacts: [
          { id: 'c1', first_name: 'Bob', last_name: null, email: null, organization_name: 'ACME' },
        ],
        pagination: { page: 1, total_pages: 1 },
      })

      const result = await service.getContactsDictionary({})

      expect(result.items[0]).toEqual({
        label: 'Bob',
        value: 'c1',
        note: 'ACME',
      })
    })
  })

  describe('getUsersDictionary', () => {
    it('returns mapped users with pagination cursor', async () => {
      mock.onGet(`${API_BASE}/users/search`).reply({
        users: [
          { id: 'u1', first_name: 'Alice', last_name: 'Smith', email: 'alice@co.com' },
          { id: 'u2', first_name: '', last_name: '', email: 'anon@co.com' },
        ],
        pagination: { page: 1, total_pages: 2 },
      })

      const result = await service.getUsersDictionary({})

      expect(result.items).toEqual([
        { label: 'Alice Smith', value: 'u1', note: 'alice@co.com' },
        { label: 'anon@co.com', value: 'u2', note: 'anon@co.com' },
      ])
      expect(result.cursor).toBe('2')
    })

    it('filters users by search (case-insensitive)', async () => {
      mock.onGet(`${API_BASE}/users/search`).reply({
        users: [
          { id: 'u1', first_name: 'Alice', last_name: 'Jones', email: 'alice@co.com' },
          { id: 'u2', first_name: 'Bob', last_name: 'Smith', email: 'bob@co.com' },
        ],
        pagination: { page: 1, total_pages: 1 },
      })

      const result = await service.getUsersDictionary({ search: 'alice' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('u1')
    })

    it('uses master API key header', async () => {
      mock.onGet(`${API_BASE}/users/search`).reply({ users: [], pagination: { page: 1, total_pages: 1 } })

      await service.getUsersDictionary({})

      expect(mock.history[0].headers).toMatchObject({
        'X-API-Key': MASTER_API_KEY,
      })
    })
  })
})
