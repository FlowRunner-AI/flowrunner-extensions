'use strict'

const { createSandbox } = require('../../../service-sandbox')

const CLIENT_ID = 'test-client-id'
const CLIENT_SECRET = 'test-client-secret'
const ACCESS_TOKEN = 'test-access-token'
const BASE = 'https://api.cc.email/v3'
const TOKEN_URL = 'https://authz.constantcontact.com/oauth2/default/v1/token'

const basicAuth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')

describe('Constant Contact Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET })
    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()

    // Simulate the OAuth access token header
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
    it('returns authorization URL with correct parameters', async () => {
      const url = await service.getOAuth2ConnectionURL()

      expect(url).toContain('https://authz.constantcontact.com/oauth2/default/v1/authorize')
      expect(url).toContain(`client_id=${CLIENT_ID}`)
      expect(url).toContain('response_type=code')
      expect(url).toContain('scope=account_read+contact_data+campaign_data+offline_access')
      expect(url).toContain('state=flowrunner_')
    })
  })

  describe('executeCallback', () => {
    it('exchanges code for token and fetches account summary', async () => {
      mock.onPost(TOKEN_URL).reply({
        access_token: 'new-access-token',
        expires_in: 7200,
        refresh_token: 'new-refresh-token',
      })
      mock.onGet(`${BASE}/account/summary`).reply({
        organization_name: 'Test Org',
        contact_email: 'test@example.com',
      })

      const result = await service.executeCallback({
        code: 'auth-code-123',
        redirectURI: 'https://callback.example.com',
      })

      expect(result).toEqual({
        token: 'new-access-token',
        expirationInSeconds: 7200,
        refreshToken: 'new-refresh-token',
        connectionIdentityName: 'Test Org',
        connectionIdentityImageURL: null,
        overwrite: true,
        userData: {
          organization_name: 'Test Org',
          contact_email: 'test@example.com',
        },
      })

      // Verify token request
      expect(mock.history[0].url).toBe(TOKEN_URL)
      expect(mock.history[0].headers).toMatchObject({
        'Authorization': `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      })
    })

    it('falls back to default identity name when account summary fails', async () => {
      mock.onPost(TOKEN_URL).reply({
        access_token: 'new-access-token',
        expires_in: 7200,
        refresh_token: 'new-refresh-token',
      })
      mock.onGet(`${BASE}/account/summary`).replyWithError({ message: 'Forbidden' })

      const result = await service.executeCallback({
        code: 'auth-code-123',
        redirectURI: 'https://callback.example.com',
      })

      expect(result.connectionIdentityName).toBe('Constant Contact Account')
    })
  })

  describe('refreshToken', () => {
    it('refreshes the token and returns new credentials', async () => {
      mock.onPost(TOKEN_URL).reply({
        access_token: 'refreshed-access-token',
        expires_in: 7200,
        refresh_token: 'rotated-refresh-token',
      })

      const result = await service.refreshToken('old-refresh-token')

      expect(result).toEqual({
        token: 'refreshed-access-token',
        expirationInSeconds: 7200,
        refreshToken: 'rotated-refresh-token',
      })

      expect(mock.history[0].headers).toMatchObject({
        'Authorization': `Basic ${basicAuth}`,
      })
    })

    it('falls back to original refresh token when no new one is returned', async () => {
      mock.onPost(TOKEN_URL).reply({
        access_token: 'refreshed-token',
        expires_in: 7200,
      })

      const result = await service.refreshToken('original-refresh-token')

      expect(result.refreshToken).toBe('original-refresh-token')
    })

    it('throws clear error on invalid_grant', async () => {
      mock.onPost(TOKEN_URL).replyWithError({
        message: 'invalid_grant',
        body: { error: 'invalid_grant' },
      })

      await expect(service.refreshToken('expired-token'))
        .rejects.toThrow('Refresh token expired or invalid, please re-authenticate.')
    })
  })

  // ── Dictionaries ──

  describe('getContactListsDictionary', () => {
    it('returns formatted list items', async () => {
      mock.onGet(`${BASE}/contact_lists`).reply({
        lists: [
          { name: 'Newsletter', list_id: 'list-1', membership_count: 100 },
          { name: 'Webinar', list_id: 'list-2', membership_count: 50 },
        ],
      })

      const result = await service.getContactListsDictionary({})

      expect(result.items).toEqual([
        { label: 'Newsletter', value: 'list-1', note: '100 members' },
        { label: 'Webinar', value: 'list-2', note: '50 members' },
      ])
      expect(mock.history[0].query).toMatchObject({ limit: 1000, include_membership_count: 'active' })
    })

    it('filters by search term', async () => {
      mock.onGet(`${BASE}/contact_lists`).reply({
        lists: [
          { name: 'Newsletter', list_id: 'list-1', membership_count: 100 },
          { name: 'Webinar', list_id: 'list-2', membership_count: 50 },
        ],
      })

      const result = await service.getContactListsDictionary({ search: 'news' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toBe('Newsletter')
    })

    it('extracts cursor from _links.next.href', async () => {
      mock.onGet(`${BASE}/contact_lists`).reply({
        lists: [],
        _links: { next: { href: '/v3/contact_lists?cursor=abc123' } },
      })

      const result = await service.getContactListsDictionary({})

      expect(result.cursor).toBe('abc123')
    })
  })

  describe('getTagsDictionary', () => {
    it('returns formatted tag items', async () => {
      mock.onGet(`${BASE}/contact_tags`).reply({
        tags: [
          { name: 'VIP', tag_id: 'tag-1', contacts_count: 37 },
        ],
      })

      const result = await service.getTagsDictionary({})

      expect(result.items).toEqual([
        { label: 'VIP', value: 'tag-1', note: '37 contacts' },
      ])
    })

    it('filters by search', async () => {
      mock.onGet(`${BASE}/contact_tags`).reply({
        tags: [
          { name: 'VIP', tag_id: 'tag-1' },
          { name: 'Lead', tag_id: 'tag-2' },
        ],
      })

      const result = await service.getTagsDictionary({ search: 'lead' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toBe('Lead')
    })
  })

  describe('getSegmentsDictionary', () => {
    it('returns formatted segment items', async () => {
      mock.onGet(`${BASE}/segments`).reply({
        segments: [
          { name: 'Recently Engaged', segment_id: 14, edited_at: '2026-06-10T15:30:00Z' },
        ],
      })

      const result = await service.getSegmentsDictionary({})

      expect(result.items).toEqual([
        { label: 'Recently Engaged', value: 14, note: 'Updated 2026-06-10T15:30:00Z' },
      ])
    })
  })

  describe('getCampaignsDictionary', () => {
    it('returns formatted campaign items', async () => {
      mock.onGet(`${BASE}/emails`).reply({
        campaigns: [
          { name: 'July Newsletter', campaign_id: 'camp-1', current_status: 'DRAFT' },
        ],
      })

      const result = await service.getCampaignsDictionary({})

      expect(result.items).toEqual([
        { label: 'July Newsletter', value: 'camp-1', note: 'DRAFT' },
      ])
    })
  })

  describe('getCustomFieldsDictionary', () => {
    it('returns formatted custom field items', async () => {
      mock.onGet(`${BASE}/contact_custom_fields`).reply({
        custom_fields: [
          { label: 'Membership Level', custom_field_id: 'cf-1', type: 'string' },
        ],
      })

      const result = await service.getCustomFieldsDictionary({})

      expect(result.items).toEqual([
        { label: 'Membership Level', value: 'cf-1', note: 'string' },
      ])
    })

    it('filters by label search', async () => {
      mock.onGet(`${BASE}/contact_custom_fields`).reply({
        custom_fields: [
          { label: 'Membership Level', custom_field_id: 'cf-1', type: 'string' },
          { label: 'Birthday', custom_field_id: 'cf-2', type: 'date' },
        ],
      })

      const result = await service.getCustomFieldsDictionary({ search: 'birth' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toBe('Birthday')
    })
  })

  // ── Account ──

  describe('getAccountSummary', () => {
    it('sends GET to /account/summary', async () => {
      const summaryData = { organization_name: 'Test Org', contact_email: 'test@example.com' }
      mock.onGet(`${BASE}/account/summary`).reply(summaryData)

      const result = await service.getAccountSummary()

      expect(result).toEqual(summaryData)
      expect(mock.history[0].headers).toMatchObject({
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
      })
    })
  })

  // ── Contacts ──

  describe('listContacts', () => {
    it('sends correct request with defaults', async () => {
      mock.onGet(`${BASE}/contacts`).reply({ contacts: [], contacts_count: 0 })

      const result = await service.listContacts()

      expect(result).toEqual({ contacts: [], contacts_count: 0 })
      expect(mock.history).toHaveLength(1)
    })

    it('passes all filter parameters', async () => {
      mock.onGet(`${BASE}/contacts`).reply({ contacts: [], contacts_count: 0 })

      await service.listContacts(
        'Active',
        ['list-1', 'list-2'],
        'jane@example.com',
        '2026-07-01T00:00:00Z',
        ['Custom Fields', 'Phone Numbers'],
        100,
        'cursor-abc'
      )

      expect(mock.history[0].query).toMatchObject({
        status: 'active',
        lists: 'list-1,list-2',
        email: 'jane@example.com',
        updated_after: '2026-07-01T00:00:00Z',
        include: 'custom_fields,phone_numbers',
        limit: 100,
        cursor: 'cursor-abc',
      })
    })

    it('appends cursor from _links', async () => {
      mock.onGet(`${BASE}/contacts`).reply({
        contacts: [],
        contacts_count: 100,
        _links: { next: { href: '/v3/contacts?cursor=nextPage' } },
      })

      const result = await service.listContacts()

      expect(result.cursor).toBe('nextPage')
    })
  })

  describe('getContact', () => {
    it('retrieves a contact by id', async () => {
      const contact = { contact_id: 'c-1', first_name: 'Jane' }
      mock.onGet(`${BASE}/contacts/c-1`).reply(contact)

      const result = await service.getContact('c-1')

      expect(result).toEqual(contact)
    })

    it('passes include parameter', async () => {
      mock.onGet(`${BASE}/contacts/c-1`).reply({ contact_id: 'c-1' })

      await service.getContact('c-1', ['List Memberships'])

      expect(mock.history[0].query).toMatchObject({ include: 'list_memberships' })
    })

    it('throws when contactId is missing', async () => {
      await expect(service.getContact()).rejects.toThrow('"Contact ID" is required')
    })
  })

  describe('createContact', () => {
    it('sends POST with required email only', async () => {
      mock.onPost(`${BASE}/contacts`).reply({ contact_id: 'c-new' })

      await service.createContact('jane@example.com')

      expect(mock.history[0].body).toMatchObject({
        email_address: { address: 'jane@example.com', permission_to_send: 'implicit' },
        create_source: 'Account',
      })
    })

    it('sends POST with all optional fields', async () => {
      mock.onPost(`${BASE}/contacts`).reply({ contact_id: 'c-new' })

      await service.createContact(
        'jane@example.com',
        'Jane',
        'Doe',
        'CTO',
        'Example Co',
        '555-1234',
        'Mobile',
        ['list-1'],
        [{ custom_field_id: 'cf-1', value: 'Gold' }],
        { kind: 'Work', street: '123 Main St', city: 'Boston' }
      )

      const body = mock.history[0].body

      expect(body.first_name).toBe('Jane')
      expect(body.last_name).toBe('Doe')
      expect(body.job_title).toBe('CTO')
      expect(body.company_name).toBe('Example Co')
      expect(body.phone_numbers).toEqual([{ phone_number: '555-1234', kind: 'mobile' }])
      expect(body.list_memberships).toEqual(['list-1'])
      expect(body.custom_fields).toEqual([{ custom_field_id: 'cf-1', value: 'Gold' }])
      expect(body.street_addresses).toEqual([
        expect.objectContaining({ kind: 'work', street: '123 Main St', city: 'Boston' }),
      ])
    })

    it('throws when email is missing', async () => {
      await expect(service.createContact()).rejects.toThrow('"Email" is required')
    })
  })

  describe('updateContact', () => {
    it('fetches existing contact then sends merged PUT', async () => {
      const existing = {
        contact_id: 'c-1',
        email_address: { address: 'old@example.com', permission_to_send: 'implicit' },
        first_name: 'Jane',
        last_name: 'Doe',
        phone_numbers: [],
        custom_fields: [],
        list_memberships: ['list-1'],
        street_addresses: [],
      }

      mock.onGet(`${BASE}/contacts/c-1`).reply(existing)
      mock.onPut(`${BASE}/contacts/c-1`).reply({ contact_id: 'c-1', first_name: 'Janet' })

      await service.updateContact('c-1', undefined, 'Janet')

      // First call is the fetch, second is the PUT
      expect(mock.history).toHaveLength(2)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[1].method).toBe('put')
      expect(mock.history[1].body).toMatchObject({
        first_name: 'Janet',
        last_name: 'Doe',
        email_address: { address: 'old@example.com', permission_to_send: 'implicit' },
        update_source: 'Account',
      })
    })

    it('throws when contactId is missing', async () => {
      await expect(service.updateContact()).rejects.toThrow('"Contact ID" is required')
    })
  })

  describe('deleteContact', () => {
    it('sends DELETE request', async () => {
      mock.onDelete(`${BASE}/contacts/c-1`).reply({})

      const result = await service.deleteContact('c-1')

      expect(result).toEqual({ status: 'success' })
      expect(mock.history[0].method).toBe('delete')
    })

    it('throws when contactId is missing', async () => {
      await expect(service.deleteContact()).rejects.toThrow('"Contact ID" is required')
    })
  })

  describe('createOrUpdateContact', () => {
    it('sends POST to sign_up_form endpoint', async () => {
      mock.onPost(`${BASE}/contacts/sign_up_form`).reply({ contact_id: 'c-1', action: 'created' })

      const result = await service.createOrUpdateContact('jane@example.com', ['list-1'], 'Jane', 'Doe')

      expect(result).toEqual({ contact_id: 'c-1', action: 'created' })
      expect(mock.history[0].body).toEqual({
        email_address: 'jane@example.com',
        first_name: 'Jane',
        last_name: 'Doe',
        list_memberships: ['list-1'],
      })
    })

    it('throws when email is missing', async () => {
      await expect(service.createOrUpdateContact()).rejects.toThrow('"Email" is required')
    })

    it('throws when list memberships are empty', async () => {
      await expect(service.createOrUpdateContact('jane@example.com', []))
        .rejects.toThrow('At least one list in "List Memberships" is required')
    })
  })

  // ── Contact Lists ──

  describe('listContactLists', () => {
    it('sends GET with optional parameters', async () => {
      mock.onGet(`${BASE}/contact_lists`).reply({ lists: [], lists_count: 0 })

      await service.listContactLists(true, 'Active', 100)

      expect(mock.history[0].query).toMatchObject({
        include_count: true,
        include_membership_count: 'active',
        limit: 100,
      })
    })
  })

  describe('getContactList', () => {
    it('retrieves a single list', async () => {
      mock.onGet(`${BASE}/contact_lists/list-1`).reply({ list_id: 'list-1', name: 'Newsletter' })

      const result = await service.getContactList('list-1', 'All')

      expect(result).toEqual({ list_id: 'list-1', name: 'Newsletter' })
      expect(mock.history[0].query).toMatchObject({ include_membership_count: 'all' })
    })

    it('throws when listId is missing', async () => {
      await expect(service.getContactList()).rejects.toThrow('"List" is required')
    })
  })

  describe('createContactList', () => {
    it('sends POST with name and optional fields', async () => {
      mock.onPost(`${BASE}/contact_lists`).reply({ list_id: 'new-list' })

      await service.createContactList('Webinar', 'Attendees list', true)

      expect(mock.history[0].body).toEqual({
        name: 'Webinar',
        description: 'Attendees list',
        favorite: true,
      })
    })

    it('throws when name is missing', async () => {
      await expect(service.createContactList()).rejects.toThrow('"Name" is required')
    })
  })

  describe('updateContactList', () => {
    it('fetches existing list then sends merged PUT', async () => {
      mock.onGet(`${BASE}/contact_lists/list-1`).reply({
        list_id: 'list-1',
        name: 'Old Name',
        description: 'Old desc',
        favorite: false,
      })
      mock.onPut(`${BASE}/contact_lists/list-1`).reply({ list_id: 'list-1', name: 'New Name' })

      await service.updateContactList('list-1', 'New Name')

      expect(mock.history[1].body).toMatchObject({
        name: 'New Name',
        description: 'Old desc',
        favorite: false,
      })
    })

    it('throws when listId is missing', async () => {
      await expect(service.updateContactList()).rejects.toThrow('"List" is required')
    })
  })

  describe('deleteContactList', () => {
    it('sends DELETE request', async () => {
      mock.onDelete(`${BASE}/contact_lists/list-1`).reply({ activity_id: 'act-1', state: 'processing' })

      const result = await service.deleteContactList('list-1')

      expect(result).toEqual({ activity_id: 'act-1', state: 'processing' })
    })

    it('throws when listId is missing', async () => {
      await expect(service.deleteContactList()).rejects.toThrow('"List" is required')
    })
  })

  describe('addContactsToLists', () => {
    it('sends POST to add_list_memberships', async () => {
      mock.onPost(`${BASE}/activities/add_list_memberships`).reply({ activity_id: 'act-1', state: 'initialized' })

      const result = await service.addContactsToLists(['c-1', 'c-2'], ['list-1'])

      expect(result).toEqual({ activity_id: 'act-1', state: 'initialized' })
      expect(mock.history[0].body).toEqual({
        source: { contact_ids: ['c-1', 'c-2'] },
        list_ids: ['list-1'],
      })
    })

    it('throws when contactIds are empty', async () => {
      await expect(service.addContactsToLists([], ['list-1']))
        .rejects.toThrow('At least one contact in "Contact IDs" is required')
    })

    it('throws when listIds are empty', async () => {
      await expect(service.addContactsToLists(['c-1'], []))
        .rejects.toThrow('At least one list in "Lists" is required')
    })
  })

  describe('removeContactsFromLists', () => {
    it('sends POST to remove_list_memberships', async () => {
      mock.onPost(`${BASE}/activities/remove_list_memberships`).reply({ activity_id: 'act-2', state: 'initialized' })

      const result = await service.removeContactsFromLists(['c-1'], ['list-1'])

      expect(result).toEqual({ activity_id: 'act-2', state: 'initialized' })
      expect(mock.history[0].body).toEqual({
        source: { contact_ids: ['c-1'] },
        list_ids: ['list-1'],
      })
    })
  })

  describe('getActivityStatus', () => {
    it('retrieves activity by id', async () => {
      const activity = { activity_id: 'act-1', state: 'completed', percent_done: 100 }
      mock.onGet(`${BASE}/activities/act-1`).reply(activity)

      const result = await service.getActivityStatus('act-1')

      expect(result).toEqual(activity)
    })

    it('throws when activityId is missing', async () => {
      await expect(service.getActivityStatus()).rejects.toThrow('"Activity ID" is required')
    })
  })

  // ── Custom Fields ──

  describe('listCustomFields', () => {
    it('sends GET with pagination', async () => {
      mock.onGet(`${BASE}/contact_custom_fields`).reply({ custom_fields: [] })

      await service.listCustomFields(25, 'cur-1')

      expect(mock.history[0].query).toMatchObject({ limit: 25, cursor: 'cur-1' })
    })

    it('appends cursor from response', async () => {
      mock.onGet(`${BASE}/contact_custom_fields`).reply({
        custom_fields: [],
        _links: { next: { href: '/v3/contact_custom_fields?cursor=page2' } },
      })

      const result = await service.listCustomFields()

      expect(result.cursor).toBe('page2')
    })
  })

  describe('createCustomField', () => {
    it('sends POST with label and resolved type', async () => {
      mock.onPost(`${BASE}/contact_custom_fields`).reply({ custom_field_id: 'cf-new' })

      await service.createCustomField('Birthday', 'Date')

      expect(mock.history[0].body).toEqual({ label: 'Birthday', type: 'date' })
    })

    it('defaults type to string', async () => {
      mock.onPost(`${BASE}/contact_custom_fields`).reply({ custom_field_id: 'cf-new' })

      await service.createCustomField('Notes')

      expect(mock.history[0].body).toEqual({ label: 'Notes', type: 'string' })
    })

    it('throws when label is missing', async () => {
      await expect(service.createCustomField()).rejects.toThrow('"Label" is required')
    })
  })

  describe('deleteCustomField', () => {
    it('sends DELETE request', async () => {
      mock.onDelete(`${BASE}/contact_custom_fields/cf-1`).reply({})

      const result = await service.deleteCustomField('cf-1')

      expect(result).toEqual({ status: 'success' })
    })

    it('throws when customFieldId is missing', async () => {
      await expect(service.deleteCustomField()).rejects.toThrow('"Custom Field" is required')
    })
  })

  // ── Tags ──

  describe('listTags', () => {
    it('sends GET with parameters', async () => {
      mock.onGet(`${BASE}/contact_tags`).reply({ tags: [] })

      await service.listTags(true, 100, 'cur-1')

      expect(mock.history[0].query).toMatchObject({
        include_count: true,
        limit: 100,
        cursor: 'cur-1',
      })
    })
  })

  describe('createTag', () => {
    it('sends POST with name', async () => {
      mock.onPost(`${BASE}/contact_tags`).reply({ tag_id: 'tag-new', name: 'VIP' })

      const result = await service.createTag('VIP')

      expect(result).toEqual({ tag_id: 'tag-new', name: 'VIP' })
      expect(mock.history[0].body).toEqual({ name: 'VIP' })
    })

    it('throws when name is missing', async () => {
      await expect(service.createTag()).rejects.toThrow('"Name" is required')
    })
  })

  describe('deleteTag', () => {
    it('sends DELETE request', async () => {
      mock.onDelete(`${BASE}/contact_tags/tag-1`).reply({ activity_id: 'act-1' })

      const result = await service.deleteTag('tag-1')

      expect(result).toEqual({ activity_id: 'act-1' })
    })

    it('throws when tagId is missing', async () => {
      await expect(service.deleteTag()).rejects.toThrow('"Tag" is required')
    })
  })

  // ── Segments ──

  describe('listSegments', () => {
    it('sends GET with sort parameter resolved', async () => {
      mock.onGet(`${BASE}/segments`).reply({ segments: [] })

      await service.listSegments('Name', 'cur-1')

      expect(mock.history[0].query).toMatchObject({ sort_by: 'name', cursor: 'cur-1' })
    })

    it('appends cursor from response', async () => {
      mock.onGet(`${BASE}/segments`).reply({
        segments: [],
        _links: { next: { href: '/v3/segments?cursor=seg-page2' } },
      })

      const result = await service.listSegments()

      expect(result.cursor).toBe('seg-page2')
    })
  })

  describe('getSegment', () => {
    it('retrieves a segment by id', async () => {
      mock.onGet(`${BASE}/segments/14`).reply({ name: 'Recently Engaged', segment_id: 14 })

      const result = await service.getSegment(14)

      expect(result).toEqual({ name: 'Recently Engaged', segment_id: 14 })
    })

    it('throws when segmentId is missing', async () => {
      await expect(service.getSegment()).rejects.toThrow('"Segment" is required')
    })
  })

  describe('createSegment', () => {
    it('sends POST with name and string criteria', async () => {
      const criteria = '{"version":"1.0.0","criteria":{"type":"and","group":[]}}'
      mock.onPost(`${BASE}/segments`).reply({ segment_id: 15 })

      await service.createSegment('Test Segment', criteria)

      expect(mock.history[0].body).toEqual({
        name: 'Test Segment',
        segment_criteria: criteria,
      })
    })

    it('accepts object criteria and stringifies it', async () => {
      const criteria = { version: '1.0.0', criteria: { type: 'and', group: [] } }
      mock.onPost(`${BASE}/segments`).reply({ segment_id: 15 })

      await service.createSegment('Test Segment', criteria)

      expect(mock.history[0].body.segment_criteria).toBe(JSON.stringify(criteria))
    })

    it('throws on invalid JSON string criteria', async () => {
      await expect(service.createSegment('Test', 'not-json'))
        .rejects.toThrow('"Segment Criteria" must be a valid JSON string')
    })

    it('throws when name is missing', async () => {
      await expect(service.createSegment()).rejects.toThrow('"Name" is required')
    })

    it('throws when criteria is missing', async () => {
      await expect(service.createSegment('Test')).rejects.toThrow('"Segment Criteria" is required')
    })
  })

  describe('updateSegmentName', () => {
    it('sends PATCH with new name', async () => {
      mock.onPatch(`${BASE}/segments/14/name`).reply({ segment_id: 14, name: 'Renamed' })

      const result = await service.updateSegmentName(14, 'Renamed')

      expect(result).toEqual({ segment_id: 14, name: 'Renamed' })
      expect(mock.history[0].body).toEqual({ name: 'Renamed' })
    })

    it('throws when segmentId is missing', async () => {
      await expect(service.updateSegmentName(undefined, 'Name'))
        .rejects.toThrow('"Segment" is required')
    })

    it('throws when name is missing', async () => {
      await expect(service.updateSegmentName(14))
        .rejects.toThrow('"Name" is required')
    })
  })

  describe('deleteSegment', () => {
    it('sends DELETE request', async () => {
      mock.onDelete(`${BASE}/segments/14`).reply({})

      const result = await service.deleteSegment(14)

      expect(result).toEqual({ status: 'success' })
    })

    it('throws when segmentId is missing', async () => {
      await expect(service.deleteSegment()).rejects.toThrow('"Segment" is required')
    })
  })

  // ── Email Campaigns ──

  describe('listCampaigns', () => {
    it('sends GET with date filters and pagination', async () => {
      mock.onGet(`${BASE}/emails`).reply({ campaigns: [] })

      await service.listCampaigns('2026-07-01', '2026-07-31', 50, 'cur-1')

      expect(mock.history[0].query).toMatchObject({
        after_date: '2026-07-01',
        before_date: '2026-07-31',
        limit: 50,
        cursor: 'cur-1',
      })
    })
  })

  describe('getCampaign', () => {
    it('retrieves a campaign by id', async () => {
      mock.onGet(`${BASE}/emails/camp-1`).reply({ campaign_id: 'camp-1', name: 'Newsletter' })

      const result = await service.getCampaign('camp-1')

      expect(result).toEqual({ campaign_id: 'camp-1', name: 'Newsletter' })
    })

    it('throws when campaignId is missing', async () => {
      await expect(service.getCampaign()).rejects.toThrow('"Campaign" is required')
    })
  })

  describe('createCampaign', () => {
    it('sends POST with campaign activity', async () => {
      mock.onPost(`${BASE}/emails`).reply({ campaign_id: 'camp-new' })

      await service.createCampaign(
        'July News',
        'Marketing Team',
        'marketing@example.com',
        'Our July Update',
        '<html>Content</html>',
        'reply@example.com',
        'Preview text'
      )

      const body = mock.history[0].body

      expect(body.name).toBe('July News')
      expect(body.email_campaign_activities).toHaveLength(1)
      expect(body.email_campaign_activities[0]).toMatchObject({
        format_type: 5,
        from_name: 'Marketing Team',
        from_email: 'marketing@example.com',
        reply_to_email: 'reply@example.com',
        subject: 'Our July Update',
        preheader: 'Preview text',
        html_content: '<html>Content</html>',
      })
    })

    it('defaults reply_to_email to fromEmail when not provided', async () => {
      mock.onPost(`${BASE}/emails`).reply({ campaign_id: 'camp-new' })

      await service.createCampaign('Name', 'From', 'from@example.com', 'Subject', '<html></html>')

      expect(mock.history[0].body.email_campaign_activities[0].reply_to_email).toBe('from@example.com')
    })

    it('throws when name is missing', async () => {
      await expect(service.createCampaign()).rejects.toThrow('"Name" is required')
    })

    it('throws when required fields are missing', async () => {
      await expect(service.createCampaign('Name'))
        .rejects.toThrow('"From Name", "From Email", "Subject" and "HTML Content" are required')
    })
  })

  describe('updateCampaignName', () => {
    it('sends PATCH with new name', async () => {
      mock.onPatch(`${BASE}/emails/camp-1`).reply({})

      const result = await service.updateCampaignName('camp-1', 'Updated Name')

      expect(result).toEqual({ status: 'success' })
      expect(mock.history[0].body).toEqual({ name: 'Updated Name' })
    })

    it('throws when campaignId is missing', async () => {
      await expect(service.updateCampaignName()).rejects.toThrow('"Campaign" is required')
    })

    it('throws when name is missing', async () => {
      await expect(service.updateCampaignName('camp-1')).rejects.toThrow('"Name" is required')
    })
  })

  describe('deleteCampaign', () => {
    it('sends DELETE request', async () => {
      mock.onDelete(`${BASE}/emails/camp-1`).reply({})

      const result = await service.deleteCampaign('camp-1')

      expect(result).toEqual({ status: 'success' })
    })

    it('throws when campaignId is missing', async () => {
      await expect(service.deleteCampaign()).rejects.toThrow('"Campaign" is required')
    })
  })

  // ── Campaign Activities ──

  describe('getCampaignActivity', () => {
    it('retrieves an activity by id', async () => {
      const activity = { campaign_activity_id: 'act-1', role: 'primary_email' }
      mock.onGet(`${BASE}/emails/activities/act-1`).reply(activity)

      const result = await service.getCampaignActivity('act-1')

      expect(result).toEqual(activity)
    })

    it('throws when campaignActivityId is missing', async () => {
      await expect(service.getCampaignActivity()).rejects.toThrow('"Campaign Activity ID" is required')
    })
  })

  describe('updateCampaignActivity', () => {
    it('fetches existing activity then sends merged PUT', async () => {
      const existing = {
        campaign_activity_id: 'act-1',
        from_name: 'Old Name',
        from_email: 'old@example.com',
        subject: 'Old Subject',
        html_content: '<html>Old</html>',
        contact_list_ids: ['list-1'],
        segment_ids: [],
      }

      mock.onGet(`${BASE}/emails/activities/act-1`).reply(existing)
      mock.onPut(`${BASE}/emails/activities/act-1`).reply({ campaign_activity_id: 'act-1' })

      await service.updateCampaignActivity('act-1', undefined, undefined, undefined, 'New Subject')

      expect(mock.history).toHaveLength(2)
      expect(mock.history[1].body).toMatchObject({
        from_name: 'Old Name',
        subject: 'New Subject',
      })
    })

    it('replaces contact lists when provided', async () => {
      mock.onGet(`${BASE}/emails/activities/act-1`).reply({
        campaign_activity_id: 'act-1',
        contact_list_ids: ['list-1'],
      })
      mock.onPut(`${BASE}/emails/activities/act-1`).reply({ campaign_activity_id: 'act-1' })

      await service.updateCampaignActivity(
        'act-1', undefined, undefined, undefined, undefined, undefined, undefined,
        ['list-2', 'list-3']
      )

      expect(mock.history[1].body.contact_list_ids).toEqual(['list-2', 'list-3'])
    })

    it('converts segment ids to numbers', async () => {
      mock.onGet(`${BASE}/emails/activities/act-1`).reply({ campaign_activity_id: 'act-1' })
      mock.onPut(`${BASE}/emails/activities/act-1`).reply({ campaign_activity_id: 'act-1' })

      await service.updateCampaignActivity(
        'act-1', undefined, undefined, undefined, undefined, undefined, undefined,
        undefined, ['14', '15']
      )

      expect(mock.history[1].body.segment_ids).toEqual([14, 15])
    })

    it('throws when campaignActivityId is missing', async () => {
      await expect(service.updateCampaignActivity()).rejects.toThrow('"Campaign Activity ID" is required')
    })
  })

  describe('sendTestEmail', () => {
    it('sends POST with recipients and message', async () => {
      mock.onPost(`${BASE}/emails/activities/act-1/tests`).reply({})

      const result = await service.sendTestEmail('act-1', ['test@example.com'], 'Check this')

      expect(result).toEqual({ status: 'success' })
      expect(mock.history[0].body).toEqual({
        email_addresses: ['test@example.com'],
        personal_message: 'Check this',
      })
    })

    it('throws when campaignActivityId is missing', async () => {
      await expect(service.sendTestEmail()).rejects.toThrow('"Campaign Activity ID" is required')
    })

    it('throws when recipients are empty', async () => {
      await expect(service.sendTestEmail('act-1', []))
        .rejects.toThrow('At least one address in "Recipients" is required')
    })
  })

  describe('scheduleCampaign', () => {
    it('sends POST with scheduled date', async () => {
      mock.onPost(`${BASE}/emails/activities/act-1/schedules`).reply([{ scheduled_date: '2026-08-01T13:00:00Z' }])

      const result = await service.scheduleCampaign('act-1', '2026-08-01T13:00:00Z')

      expect(result).toEqual([{ scheduled_date: '2026-08-01T13:00:00Z' }])
      expect(mock.history[0].body).toEqual({ scheduled_date: '2026-08-01T13:00:00Z' })
    })

    it('sends "0" to schedule immediately when no date provided', async () => {
      mock.onPost(`${BASE}/emails/activities/act-1/schedules`).reply([{}])

      await service.scheduleCampaign('act-1')

      expect(mock.history[0].body).toEqual({ scheduled_date: '0' })
    })

    it('throws when campaignActivityId is missing', async () => {
      await expect(service.scheduleCampaign()).rejects.toThrow('"Campaign Activity ID" is required')
    })
  })

  describe('getCampaignSchedules', () => {
    it('retrieves schedules for an activity', async () => {
      mock.onGet(`${BASE}/emails/activities/act-1/schedules`).reply([{ scheduled_date: '2026-08-01T13:00:00Z' }])

      const result = await service.getCampaignSchedules('act-1')

      expect(result).toEqual([{ scheduled_date: '2026-08-01T13:00:00Z' }])
    })

    it('throws when campaignActivityId is missing', async () => {
      await expect(service.getCampaignSchedules()).rejects.toThrow('"Campaign Activity ID" is required')
    })
  })

  describe('unscheduleCampaign', () => {
    it('sends DELETE request', async () => {
      mock.onDelete(`${BASE}/emails/activities/act-1/schedules`).reply({})

      const result = await service.unscheduleCampaign('act-1')

      expect(result).toEqual({ status: 'success' })
    })

    it('throws when campaignActivityId is missing', async () => {
      await expect(service.unscheduleCampaign()).rejects.toThrow('"Campaign Activity ID" is required')
    })
  })

  // ── Reporting ──

  describe('getCampaignSummaryReports', () => {
    it('sends GET with pagination', async () => {
      mock.onGet(`${BASE}/reports/summary_reports/email_campaign_summaries`).reply({
        bulk_email_campaign_summaries: [],
      })

      await service.getCampaignSummaryReports(100, 'cur-1')

      expect(mock.history[0].query).toMatchObject({ limit: 100, cursor: 'cur-1' })
    })

    it('appends cursor from response', async () => {
      mock.onGet(`${BASE}/reports/summary_reports/email_campaign_summaries`).reply({
        bulk_email_campaign_summaries: [],
        _links: { next: { href: '/v3/reports?cursor=rpt-page2' } },
      })

      const result = await service.getCampaignSummaryReports()

      expect(result.cursor).toBe('rpt-page2')
    })
  })

  describe('getCampaignActivityStats', () => {
    it('sends GET with joined activity ids in URL', async () => {
      mock.onGet(`${BASE}/reports/stats/email_campaign_activities/act-1,act-2`).reply({
        results: [],
        errors: [],
      })

      const result = await service.getCampaignActivityStats(['act-1', 'act-2'])

      expect(result).toEqual({ results: [], errors: [] })
    })

    it('throws when no ids are provided', async () => {
      await expect(service.getCampaignActivityStats([]))
        .rejects.toThrow('At least one id in "Campaign Activity IDs" is required')
    })

    it('throws when more than 25 ids are provided', async () => {
      const ids = Array.from({ length: 26 }, (_, i) => `act-${i}`)

      await expect(service.getCampaignActivityStats(ids))
        .rejects.toThrow('"Campaign Activity IDs" accepts at most 25 ids per request')
    })
  })

  // ── Error Handling ──

  describe('error handling', () => {
    it('extracts error from array body', async () => {
      mock.onGet(`${BASE}/contacts`).replyWithError({
        message: 'Bad Request',
        body: [{ error_key: 'contacts.api.validation', error_message: 'Invalid email' }],
      })

      await expect(service.listContacts()).rejects.toThrow('Invalid email')
    })

    it('extracts error_description from auth errors', async () => {
      mock.onGet(`${BASE}/contacts`).replyWithError({
        message: 'Unauthorized',
        body: { error_description: 'Token expired' },
      })

      await expect(service.listContacts()).rejects.toThrow('Token expired')
    })

    it('falls back to error.message when body has no recognized format', async () => {
      mock.onGet(`${BASE}/contacts`).replyWithError({
        message: 'Network Error',
      })

      await expect(service.listContacts()).rejects.toThrow('Network Error')
    })
  })
})
