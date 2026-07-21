'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'pk_test-api-key'
const BASE = 'https://a.klaviyo.com/api'

const EXPECTED_HEADERS = {
  'Authorization': `Klaviyo-API-Key ${ API_KEY }`,
  'revision': '2026-01-15',
  'Content-Type': 'application/json',
}

// Reusable JSON:API list response factory
function jsonApiList(type, items, nextLink) {
  return {
    data: items.map((attrs, i) => ({ type, id: `id-${ i }`, attributes: attrs })),
    links: nextLink ? { next: nextLink } : {},
  }
}

describe('Klaviyo Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ apiKey: API_KEY })
    require('../src/index.js')
    service = sandbox.getService()
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
      expect(sandbox.getConfigItems()).toEqual([
        expect.objectContaining({
          name: 'apiKey',
          displayName: 'API Key',
          required: true,
          shared: false,
          type: 'STRING',
        }),
      ])
    })

    it('sends correct auth headers on requests', async () => {
      mock.onGet(`${ BASE }/profiles`).reply({ data: [], links: {} })

      await service.listProfiles()

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject(EXPECTED_HEADERS)
    })
  })

  // ── Profiles ──

  describe('listProfiles', () => {
    it('sends GET with defaults', async () => {
      mock.onGet(`${ BASE }/profiles`).reply({ data: [], links: {} })

      const result = await service.listProfiles()

      expect(mock.history).toHaveLength(1)
      expect(result).toEqual({ items: [], nextCursor: null })
    })

    it('passes filter, sort, pageSize, and cursor', async () => {
      mock.onGet(`${ BASE }/profiles`).reply({
        data: [{ type: 'profile', id: 'p1', attributes: { email: 'a@b.com' } }],
        links: { next: 'https://a.klaviyo.com/api/profiles?page[cursor]=abc123' },
      })

      const result = await service.listProfiles('equals(email,"a@b.com")', 'Created (Newest First)', 10, 'prev-cursor')

      expect(mock.history[0].query).toMatchObject({
        'filter': 'equals(email,"a@b.com")',
        'sort': '-created',
        'page[size]': 10,
        'page[cursor]': 'prev-cursor',
      })
      expect(result.items).toHaveLength(1)
      expect(result.nextCursor).toBe('abc123')
    })

    it('clamps pageSize to max 100', async () => {
      mock.onGet(`${ BASE }/profiles`).reply({ data: [], links: {} })

      await service.listProfiles(undefined, undefined, 500)

      expect(mock.history[0].query['page[size]']).toBe(100)
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/profiles`).replyWithError({
        message: 'Unauthorized',
        body: { errors: [{ detail: 'Invalid API key' }] },
      })

      await expect(service.listProfiles()).rejects.toThrow('Klaviyo API error')
    })
  })

  describe('getProfile', () => {
    it('sends GET to profile endpoint', async () => {
      const profileData = { data: { type: 'profile', id: 'p1', attributes: { email: 'a@b.com' } } }
      mock.onGet(`${ BASE }/profiles/p1`).reply(profileData)

      const result = await service.getProfile('p1')

      expect(result).toEqual(profileData)
      expect(mock.history[0].url).toBe(`${ BASE }/profiles/p1`)
    })

    it('sends additional fields when requested', async () => {
      mock.onGet(`${ BASE }/profiles/p1`).reply({ data: {} })

      await service.getProfile('p1', ['Subscriptions', 'Predictive Analytics'])

      expect(mock.history[0].query['additional-fields[profile]']).toBe('subscriptions,predictive_analytics')
    })

    it('omits additional-fields when not provided', async () => {
      mock.onGet(`${ BASE }/profiles/p1`).reply({ data: {} })

      await service.getProfile('p1')

      expect(mock.history[0].query['additional-fields[profile]']).toBeUndefined()
    })
  })

  describe('getProfileByEmail', () => {
    it('sends filter query and returns first profile', async () => {
      mock.onGet(`${ BASE }/profiles`).reply({
        data: [{ type: 'profile', id: 'p1', attributes: { email: 'a@b.com' } }],
        links: {},
      })

      const result = await service.getProfileByEmail('a@b.com')

      expect(mock.history[0].query.filter).toBe('equals(email,"a@b.com")')
      expect(result).toEqual({ type: 'profile', id: 'p1', attributes: { email: 'a@b.com' } })
    })

    it('returns null when no profile matches', async () => {
      mock.onGet(`${ BASE }/profiles`).reply({ data: [], links: {} })

      const result = await service.getProfileByEmail('none@test.com')

      expect(result).toBeNull()
    })
  })

  describe('createProfile', () => {
    it('sends POST with profile attributes', async () => {
      mock.onPost(`${ BASE }/profiles`).reply({ data: { type: 'profile', id: 'p1' } })

      await service.createProfile('a@b.com', '+15005550006', 'ext-1', 'Sarah', 'Mason', 'Acme', 'Manager', { city: 'Boston' }, { tier: 'gold' })

      expect(mock.history[0].body).toEqual({
        data: {
          type: 'profile',
          attributes: {
            email: 'a@b.com',
            phone_number: '+15005550006',
            external_id: 'ext-1',
            first_name: 'Sarah',
            last_name: 'Mason',
            organization: 'Acme',
            title: 'Manager',
            location: { city: 'Boston' },
            properties: { tier: 'gold' },
          },
        },
      })
    })

    it('omits empty optional fields', async () => {
      mock.onPost(`${ BASE }/profiles`).reply({ data: { type: 'profile', id: 'p2' } })

      await service.createProfile('a@b.com')

      expect(mock.history[0].body.data.attributes).toEqual({ email: 'a@b.com' })
    })

    it('throws if no identifier is provided', async () => {
      await expect(service.createProfile()).rejects.toThrow('at least one identifier')
    })
  })

  describe('updateProfile', () => {
    it('sends PATCH with profile ID and attributes', async () => {
      mock.onPatch(`${ BASE }/profiles/p1`).reply({ data: { type: 'profile', id: 'p1' } })

      await service.updateProfile('p1', 'new@b.com', undefined, undefined, 'Jane')

      expect(mock.history[0].body).toEqual({
        data: {
          type: 'profile',
          id: 'p1',
          attributes: { email: 'new@b.com', first_name: 'Jane' },
        },
      })
    })
  })

  describe('createOrUpdateProfile', () => {
    it('sends POST to profile-import endpoint', async () => {
      mock.onPost(`${ BASE }/profile-import`).reply({ data: { type: 'profile', id: 'p1' } })

      await service.createOrUpdateProfile('a@b.com', undefined, undefined, 'Sarah')

      expect(mock.history[0].url).toBe(`${ BASE }/profile-import`)
      expect(mock.history[0].body.data.attributes).toMatchObject({
        email: 'a@b.com',
        first_name: 'Sarah',
      })
    })

    it('throws if no identifier is provided', async () => {
      await expect(service.createOrUpdateProfile()).rejects.toThrow('at least one identifier')
    })
  })

  describe('suppressProfiles', () => {
    it('sends POST with email list', async () => {
      mock.onPost(`${ BASE }/profile-suppression-bulk-create-jobs`).reply({})

      const result = await service.suppressProfiles(['a@b.com', 'c@d.com'])

      expect(result).toEqual({ success: true, emails: ['a@b.com', 'c@d.com'] })
      expect(mock.history[0].body.data.attributes.profiles.data).toEqual([
        { type: 'profile', attributes: { email: 'a@b.com' } },
        { type: 'profile', attributes: { email: 'c@d.com' } },
      ])
    })

    it('throws if emails array is empty', async () => {
      await expect(service.suppressProfiles([])).rejects.toThrow('at least one email')
    })
  })

  describe('unsuppressProfiles', () => {
    it('sends POST to bulk-delete endpoint', async () => {
      mock.onPost(`${ BASE }/profile-suppression-bulk-delete-jobs`).reply({})

      const result = await service.unsuppressProfiles(['a@b.com'])

      expect(result).toEqual({ success: true, emails: ['a@b.com'] })
      expect(mock.history[0].body.data.type).toBe('profile-suppression-bulk-delete-job')
    })

    it('throws if emails array is empty', async () => {
      await expect(service.unsuppressProfiles([])).rejects.toThrow('at least one email')
    })
  })

  // ── Subscriptions ──

  describe('subscribeProfiles', () => {
    it('subscribes to email channel when email provided', async () => {
      mock.onPost(`${ BASE }/profile-subscription-bulk-create-jobs`).reply({})

      const result = await service.subscribeProfiles('a@b.com')

      expect(result).toEqual({ success: true, listId: null, channels: ['email'] })

      const profileAttrs = mock.history[0].body.data.attributes.profiles.data[0].attributes
      expect(profileAttrs.subscriptions.email.marketing.consent).toBe('SUBSCRIBED')
    })

    it('subscribes to both channels when both identifiers provided', async () => {
      mock.onPost(`${ BASE }/profile-subscription-bulk-create-jobs`).reply({})

      const result = await service.subscribeProfiles('a@b.com', '+15005550006')

      expect(result.channels).toEqual(['email', 'sms'])
    })

    it('includes list relationship when listId provided', async () => {
      mock.onPost(`${ BASE }/profile-subscription-bulk-create-jobs`).reply({})

      await service.subscribeProfiles('a@b.com', undefined, 'list-1')

      expect(mock.history[0].body.data.relationships).toEqual({
        list: { data: { type: 'list', id: 'list-1' } },
      })
    })

    it('resolves channel dropdown values', async () => {
      mock.onPost(`${ BASE }/profile-subscription-bulk-create-jobs`).reply({})

      await service.subscribeProfiles('a@b.com', '+15005550006', undefined, ['SMS'])

      const profileAttrs = mock.history[0].body.data.attributes.profiles.data[0].attributes
      expect(profileAttrs.subscriptions.sms).toBeDefined()
      expect(profileAttrs.subscriptions.email).toBeUndefined()
    })

    it('throws when email channel selected but no email', async () => {
      await expect(service.subscribeProfiles(undefined, '+15005550006', undefined, ['Email']))
        .rejects.toThrow('email address is required')
    })

    it('throws when sms channel selected but no phone', async () => {
      await expect(service.subscribeProfiles('a@b.com', undefined, undefined, ['SMS']))
        .rejects.toThrow('phone number is required')
    })

    it('throws if no identifiers provided', async () => {
      await expect(service.subscribeProfiles()).rejects.toThrow('email address or a phone number')
    })
  })

  describe('unsubscribeProfiles', () => {
    it('unsubscribes from email channel', async () => {
      mock.onPost(`${ BASE }/profile-subscription-bulk-delete-jobs`).reply({})

      const result = await service.unsubscribeProfiles('a@b.com')

      expect(result).toEqual({ success: true, listId: null, channels: ['email'] })

      const profileAttrs = mock.history[0].body.data.attributes.profiles.data[0].attributes
      expect(profileAttrs.subscriptions.email.marketing.consent).toBe('UNSUBSCRIBED')
    })

    it('throws if no identifiers provided', async () => {
      await expect(service.unsubscribeProfiles()).rejects.toThrow('email address or a phone number')
    })
  })

  // ── Lists ──

  describe('listLists', () => {
    it('sends GET with filter and cursor', async () => {
      mock.onGet(`${ BASE }/lists`).reply(jsonApiList('list', [{ name: 'Newsletter' }]))

      const result = await service.listLists('equals(name,"Newsletter")', 'cur1')

      expect(mock.history[0].query).toMatchObject({
        'filter': 'equals(name,"Newsletter")',
        'page[cursor]': 'cur1',
      })
      expect(result.items).toHaveLength(1)
    })
  })

  describe('getList', () => {
    it('sends GET to list endpoint', async () => {
      mock.onGet(`${ BASE }/lists/L1`).reply({ data: { type: 'list', id: 'L1' } })

      await service.getList('L1')

      expect(mock.history[0].url).toBe(`${ BASE }/lists/L1`)
    })

    it('includes profile_count when requested', async () => {
      mock.onGet(`${ BASE }/lists/L1`).reply({ data: { type: 'list', id: 'L1' } })

      await service.getList('L1', true)

      expect(mock.history[0].query['additional-fields[list]']).toBe('profile_count')
    })
  })

  describe('createList', () => {
    it('sends POST with list name', async () => {
      mock.onPost(`${ BASE }/lists`).reply({ data: { type: 'list', id: 'L1', attributes: { name: 'Test' } } })

      await service.createList('Test')

      expect(mock.history[0].body).toEqual({
        data: { type: 'list', attributes: { name: 'Test' } },
      })
    })
  })

  describe('updateList', () => {
    it('sends PATCH with list id and name', async () => {
      mock.onPatch(`${ BASE }/lists/L1`).reply({ data: { type: 'list', id: 'L1' } })

      await service.updateList('L1', 'Renamed')

      expect(mock.history[0].body).toEqual({
        data: { type: 'list', id: 'L1', attributes: { name: 'Renamed' } },
      })
    })
  })

  describe('deleteList', () => {
    it('sends DELETE and returns success', async () => {
      mock.onDelete(`${ BASE }/lists/L1`).reply({})

      const result = await service.deleteList('L1')

      expect(result).toEqual({ success: true })
    })
  })

  describe('addProfilesToList', () => {
    it('sends POST with profile IDs', async () => {
      mock.onPost(`${ BASE }/lists/L1/relationships/profiles`).reply({})

      const result = await service.addProfilesToList('L1', ['p1', 'p2'])

      expect(result).toEqual({ success: true, listId: 'L1', added: 2 })
      expect(mock.history[0].body).toEqual({
        data: [
          { type: 'profile', id: 'p1' },
          { type: 'profile', id: 'p2' },
        ],
      })
    })

    it('throws if profileIds is empty', async () => {
      await expect(service.addProfilesToList('L1', [])).rejects.toThrow('at least one profile ID')
    })
  })

  describe('removeProfilesFromList', () => {
    it('sends DELETE with profile IDs', async () => {
      mock.onDelete(`${ BASE }/lists/L1/relationships/profiles`).reply({})

      const result = await service.removeProfilesFromList('L1', ['p1'])

      expect(result).toEqual({ success: true, listId: 'L1', removed: 1 })
    })

    it('throws if profileIds is empty', async () => {
      await expect(service.removeProfilesFromList('L1', [])).rejects.toThrow('at least one profile ID')
    })
  })

  describe('getListProfiles', () => {
    it('sends GET with filter, pageSize, and cursor', async () => {
      mock.onGet(`${ BASE }/lists/L1/profiles`).reply({ data: [], links: {} })

      await service.getListProfiles('L1', 'equals(email,"a@b.com")', 50, 'cur1')

      expect(mock.history[0].query).toMatchObject({
        'filter': 'equals(email,"a@b.com")',
        'page[size]': 50,
        'page[cursor]': 'cur1',
      })
    })
  })

  // ── Segments ──

  describe('listSegments', () => {
    it('sends GET with filter and cursor', async () => {
      mock.onGet(`${ BASE }/segments`).reply(jsonApiList('segment', [{ name: 'VIP' }]))

      const result = await service.listSegments('equals(is_active,true)', 'cur1')

      expect(mock.history[0].query).toMatchObject({
        'filter': 'equals(is_active,true)',
        'page[cursor]': 'cur1',
      })
      expect(result.items).toHaveLength(1)
    })
  })

  describe('getSegment', () => {
    it('sends GET to segment endpoint', async () => {
      mock.onGet(`${ BASE }/segments/S1`).reply({ data: { type: 'segment', id: 'S1' } })

      await service.getSegment('S1')

      expect(mock.history[0].url).toBe(`${ BASE }/segments/S1`)
    })

    it('includes profile_count when requested', async () => {
      mock.onGet(`${ BASE }/segments/S1`).reply({ data: {} })

      await service.getSegment('S1', true)

      expect(mock.history[0].query['additional-fields[segment]']).toBe('profile_count')
    })
  })

  describe('getSegmentProfiles', () => {
    it('sends GET with filter, pageSize, and cursor', async () => {
      mock.onGet(`${ BASE }/segments/S1/profiles`).reply({ data: [], links: {} })

      await service.getSegmentProfiles('S1', undefined, 25, 'cur1')

      expect(mock.history[0].query).toMatchObject({
        'page[size]': 25,
        'page[cursor]': 'cur1',
      })
    })
  })

  // ── Events ──

  describe('createEvent', () => {
    it('sends POST with event data', async () => {
      mock.onPost(`${ BASE }/events`).reply({})

      const result = await service.createEvent('Placed Order', 'a@b.com', undefined, { order_id: '1042' }, 29.98, 'uid-1', '2025-06-15T14:30:00Z')

      expect(result).toEqual({ success: true, metric: 'Placed Order' })
      expect(mock.history[0].body.data.attributes).toMatchObject({
        value: 29.98,
        unique_id: 'uid-1',
        time: '2025-06-15T14:30:00Z',
        properties: { order_id: '1042' },
        metric: { data: { type: 'metric', attributes: { name: 'Placed Order' } } },
        profile: { data: { type: 'profile', attributes: { email: 'a@b.com' } } },
      })
    })

    it('sends event with phone number only', async () => {
      mock.onPost(`${ BASE }/events`).reply({})

      await service.createEvent('SMS Click', undefined, '+15005550006')

      expect(mock.history[0].body.data.attributes.profile.data.attributes).toEqual({
        phone_number: '+15005550006',
      })
    })

    it('throws if no identifier is provided', async () => {
      await expect(service.createEvent('Test')).rejects.toThrow('email address or a phone number')
    })
  })

  describe('listEvents', () => {
    it('sends GET with combined filters', async () => {
      mock.onGet(`${ BASE }/events`).reply({ data: [], links: {} })

      await service.listEvents('metric-1', 'profile-1', 'greater-than(datetime,2025-01-01T00:00:00Z)', 'Oldest First', ['Metric', 'Profile'])

      const query = mock.history[0].query
      expect(query.filter).toContain('equals(metric_id,"metric-1")')
      expect(query.filter).toContain('equals(profile_id,"profile-1")')
      expect(query.filter).toContain('greater-than(datetime,2025-01-01T00:00:00Z)')
      expect(query.sort).toBe('datetime')
      expect(query.include).toBe('metric,profile')
    })

    it('defaults sort to -datetime', async () => {
      mock.onGet(`${ BASE }/events`).reply({ data: [], links: {} })

      await service.listEvents()

      expect(mock.history[0].query.sort).toBe('-datetime')
    })
  })

  describe('getEvent', () => {
    it('sends GET with include parameter', async () => {
      mock.onGet(`${ BASE }/events/E1`).reply({ data: { type: 'event', id: 'E1' } })

      await service.getEvent('E1', ['Metric', 'Attributions'])

      expect(mock.history[0].query.include).toBe('metric,attributions')
    })

    it('omits include when not provided', async () => {
      mock.onGet(`${ BASE }/events/E1`).reply({ data: {} })

      await service.getEvent('E1')

      expect(mock.history[0].query.include).toBeUndefined()
    })
  })

  // ── Metrics ──

  describe('listMetrics', () => {
    it('sends GET with filter and cursor', async () => {
      mock.onGet(`${ BASE }/metrics`).reply(jsonApiList('metric', [{ name: 'Placed Order' }]))

      const result = await service.listMetrics(undefined, 'cur1')

      expect(mock.history[0].query['page[cursor]']).toBe('cur1')
      expect(result.items).toHaveLength(1)
    })
  })

  describe('getMetric', () => {
    it('sends GET to metric endpoint', async () => {
      mock.onGet(`${ BASE }/metrics/M1`).reply({ data: { type: 'metric', id: 'M1' } })

      const result = await service.getMetric('M1')

      expect(result.data.id).toBe('M1')
    })
  })

  describe('queryMetricAggregates', () => {
    it('sends POST with aggregation query', async () => {
      mock.onPost(`${ BASE }/metric-aggregates`).reply({ data: { type: 'metric-aggregate' } })

      await service.queryMetricAggregates('M1', '2025-06-01T00:00:00Z', '2025-07-01T00:00:00Z', ['Count', 'Sum Value'], 'Week', ['$message'], 'America/New_York')

      const body = mock.history[0].body.data.attributes
      expect(body.metric_id).toBe('M1')
      expect(body.measurements).toEqual(['count', 'sum_value'])
      expect(body.interval).toBe('week')
      expect(body.filter).toEqual([
        'greater-or-equal(datetime,2025-06-01T00:00:00Z)',
        'less-than(datetime,2025-07-01T00:00:00Z)',
      ])
      expect(body.by).toEqual(['$message'])
      expect(body.timezone).toBe('America/New_York')
    })

    it('uses defaults for measurements, interval, and timezone', async () => {
      mock.onPost(`${ BASE }/metric-aggregates`).reply({ data: {} })

      await service.queryMetricAggregates('M1', '2025-06-01T00:00:00Z', '2025-07-01T00:00:00Z')

      const body = mock.history[0].body.data.attributes
      expect(body.measurements).toEqual(['count'])
      expect(body.interval).toBe('day')
      expect(body.timezone).toBe('UTC')
      expect(body.by).toBeUndefined()
    })
  })

  // ── Campaigns ──

  describe('listCampaigns', () => {
    it('sends GET with channel filter', async () => {
      mock.onGet(`${ BASE }/campaigns`).reply(jsonApiList('campaign', [{ name: 'Sale' }]))

      await service.listCampaigns('Email')

      expect(mock.history[0].query.filter).toContain("equals(messages.channel,'email')")
    })

    it('combines channel and additional filter', async () => {
      mock.onGet(`${ BASE }/campaigns`).reply({ data: [], links: {} })

      await service.listCampaigns('SMS', 'equals(status,"Draft")')

      const filter = mock.history[0].query.filter
      expect(filter).toContain("equals(messages.channel,'sms')")
      expect(filter).toContain('equals(status,"Draft")')
    })

    it('defaults channel to email', async () => {
      mock.onGet(`${ BASE }/campaigns`).reply({ data: [], links: {} })

      await service.listCampaigns()

      expect(mock.history[0].query.filter).toContain("equals(messages.channel,'email')")
    })
  })

  describe('getCampaign', () => {
    it('sends GET to campaign endpoint', async () => {
      mock.onGet(`${ BASE }/campaigns/C1`).reply({ data: { type: 'campaign', id: 'C1' } })

      const result = await service.getCampaign('C1')

      expect(result.data.id).toBe('C1')
    })
  })

  describe('deleteCampaign', () => {
    it('sends DELETE and returns success', async () => {
      mock.onDelete(`${ BASE }/campaigns/C1`).reply({})

      const result = await service.deleteCampaign('C1')

      expect(result).toEqual({ success: true })
    })
  })

  describe('sendCampaign', () => {
    it('sends POST to campaign-send-jobs', async () => {
      mock.onPost(`${ BASE }/campaign-send-jobs`).reply({})

      const result = await service.sendCampaign('C1')

      expect(mock.history[0].body).toEqual({
        data: { type: 'campaign-send-job', id: 'C1' },
      })
      expect(result).toEqual({ success: true, campaignId: 'C1' })
    })

    it('returns response data when present', async () => {
      const responseData = { data: { type: 'campaign-send-job', id: 'C1' } }
      mock.onPost(`${ BASE }/campaign-send-jobs`).reply(responseData)

      const result = await service.sendCampaign('C1')

      expect(result).toEqual(responseData)
    })
  })

  describe('getCampaignRecipientEstimation', () => {
    it('sends GET to recipient estimation endpoint', async () => {
      const resp = { data: { type: 'campaign-recipient-estimation', id: 'C1', attributes: { estimated_recipient_count: 100 } } }
      mock.onGet(`${ BASE }/campaign-recipient-estimations/C1`).reply(resp)

      const result = await service.getCampaignRecipientEstimation('C1')

      expect(result).toEqual(resp)
    })
  })

  // ── Templates ──

  describe('listTemplates', () => {
    it('sends GET with name filter', async () => {
      mock.onGet(`${ BASE }/templates`).reply(jsonApiList('template', [{ name: 'Newsletter' }]))

      await service.listTemplates('Newsletter')

      expect(mock.history[0].query.filter).toBe('equals(name,"Newsletter")')
    })

    it('combines name and raw filter', async () => {
      mock.onGet(`${ BASE }/templates`).reply({ data: [], links: {} })

      await service.listTemplates('Newsletter', 'greater-than(created,2025-01-01T00:00:00Z)')

      const filter = mock.history[0].query.filter
      expect(filter).toContain('equals(name,"Newsletter")')
      expect(filter).toContain('greater-than(created,2025-01-01T00:00:00Z)')
    })
  })

  describe('getTemplate', () => {
    it('sends GET to template endpoint', async () => {
      mock.onGet(`${ BASE }/templates/T1`).reply({ data: { type: 'template', id: 'T1' } })

      await service.getTemplate('T1')

      expect(mock.history[0].url).toBe(`${ BASE }/templates/T1`)
    })
  })

  describe('createTemplate', () => {
    it('sends POST with template data', async () => {
      mock.onPost(`${ BASE }/templates`).reply({ data: { type: 'template', id: 'T1' } })

      await service.createTemplate('Test', '<p>Hello</p>', 'Hello')

      expect(mock.history[0].body).toEqual({
        data: {
          type: 'template',
          attributes: { name: 'Test', editor_type: 'CODE', html: '<p>Hello</p>', text: 'Hello' },
        },
      })
    })

    it('omits text when not provided', async () => {
      mock.onPost(`${ BASE }/templates`).reply({ data: {} })

      await service.createTemplate('Test', '<p>Hello</p>')

      expect(mock.history[0].body.data.attributes.text).toBeUndefined()
    })
  })

  describe('renderTemplate', () => {
    it('sends POST with context', async () => {
      mock.onPost(`${ BASE }/template-render`).reply({ data: { type: 'template', id: 'T1' } })

      await service.renderTemplate('T1', { first_name: 'Sarah' })

      expect(mock.history[0].body).toEqual({
        data: {
          type: 'template',
          id: 'T1',
          attributes: { context: { first_name: 'Sarah' } },
        },
      })
    })

    it('defaults context to empty object', async () => {
      mock.onPost(`${ BASE }/template-render`).reply({ data: {} })

      await service.renderTemplate('T1')

      expect(mock.history[0].body.data.attributes.context).toEqual({})
    })
  })

  // ── Flows ──

  describe('listFlows', () => {
    it('sends GET with filter and cursor', async () => {
      mock.onGet(`${ BASE }/flows`).reply(jsonApiList('flow', [{ name: 'Welcome' }]))

      const result = await service.listFlows('equals(status,"live")', 'cur1')

      expect(mock.history[0].query).toMatchObject({
        'filter': 'equals(status,"live")',
        'page[cursor]': 'cur1',
      })
      expect(result.items).toHaveLength(1)
    })
  })

  describe('getFlow', () => {
    it('sends GET to flow endpoint', async () => {
      mock.onGet(`${ BASE }/flows/F1`).reply({ data: { type: 'flow', id: 'F1' } })

      await service.getFlow('F1')

      expect(mock.history[0].url).toBe(`${ BASE }/flows/F1`)
    })
  })

  describe('updateFlowStatus', () => {
    it('sends PATCH with resolved status', async () => {
      mock.onPatch(`${ BASE }/flows/F1`).reply({ data: { type: 'flow', id: 'F1' } })

      await service.updateFlowStatus('F1', 'Draft')

      expect(mock.history[0].body).toEqual({
        data: {
          type: 'flow',
          id: 'F1',
          attributes: { status: 'draft' },
        },
      })
    })
  })

  // ── Tags ──

  describe('listTags', () => {
    it('sends GET with filter and cursor', async () => {
      mock.onGet(`${ BASE }/tags`).reply(jsonApiList('tag', [{ name: 'holiday' }]))

      const result = await service.listTags('contains(name,"holiday")')

      expect(mock.history[0].query.filter).toBe('contains(name,"holiday")')
      expect(result.items).toHaveLength(1)
    })
  })

  describe('createTag', () => {
    it('sends POST with tag name', async () => {
      mock.onPost(`${ BASE }/tags`).reply({ data: { type: 'tag', id: 'tag-1' } })

      await service.createTag('holiday-2025')

      expect(mock.history[0].body).toEqual({
        data: { type: 'tag', attributes: { name: 'holiday-2025' } },
      })
    })
  })

  describe('deleteTag', () => {
    it('sends DELETE and returns success', async () => {
      mock.onDelete(`${ BASE }/tags/tag-1`).reply({})

      const result = await service.deleteTag('tag-1')

      expect(result).toEqual({ success: true })
    })
  })

  // ── Data Privacy ──

  describe('requestProfileDeletion', () => {
    it('sends POST with email', async () => {
      mock.onPost(`${ BASE }/data-privacy-deletion-jobs`).reply({})

      const result = await service.requestProfileDeletion('a@b.com')

      expect(result).toEqual({ success: true, email: 'a@b.com' })
      expect(mock.history[0].body.data.attributes.profile.data.attributes.email).toBe('a@b.com')
    })
  })

  // ── Dictionary Methods ──

  describe('getListsDictionary', () => {
    it('maps lists to dictionary items', async () => {
      mock.onGet(`${ BASE }/lists`).reply({
        data: [
          { type: 'list', id: 'L1', attributes: { name: 'Newsletter', created: '2025-01-15T12:00:00+00:00' } },
          { type: 'list', id: 'L2', attributes: { name: 'VIP', created: '2025-02-01T12:00:00+00:00' } },
        ],
        links: { next: 'https://a.klaviyo.com/api/lists?page[cursor]=next1' },
      })

      const result = await service.getListsDictionary({})

      expect(result.items).toEqual([
        { label: 'Newsletter', value: 'L1', note: 'Created 2025-01-15' },
        { label: 'VIP', value: 'L2', note: 'Created 2025-02-01' },
      ])
      expect(result.cursor).toBe('next1')
    })

    it('filters by search term', async () => {
      mock.onGet(`${ BASE }/lists`).reply({
        data: [
          { type: 'list', id: 'L1', attributes: { name: 'Newsletter' } },
          { type: 'list', id: 'L2', attributes: { name: 'VIP' } },
        ],
        links: {},
      })

      const result = await service.getListsDictionary({ search: 'vip' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('L2')
    })

    it('handles null payload', async () => {
      mock.onGet(`${ BASE }/lists`).reply({ data: [], links: {} })

      const result = await service.getListsDictionary(null)

      expect(result.items).toEqual([])
    })

    it('passes cursor to query', async () => {
      mock.onGet(`${ BASE }/lists`).reply({ data: [], links: {} })

      await service.getListsDictionary({ cursor: 'page2' })

      expect(mock.history[0].query['page[cursor]']).toBe('page2')
    })
  })

  describe('getSegmentsDictionary', () => {
    it('maps segments to dictionary items with activity note', async () => {
      mock.onGet(`${ BASE }/segments`).reply({
        data: [
          { type: 'segment', id: 'S1', attributes: { name: 'VIP', is_active: true } },
          { type: 'segment', id: 'S2', attributes: { name: 'Old', is_active: false } },
        ],
        links: {},
      })

      const result = await service.getSegmentsDictionary({})

      expect(result.items).toEqual([
        { label: 'VIP', value: 'S1', note: 'Active' },
        { label: 'Old', value: 'S2', note: 'Inactive' },
      ])
    })
  })

  describe('getMetricsDictionary', () => {
    it('maps metrics to dictionary items with integration note', async () => {
      mock.onGet(`${ BASE }/metrics`).reply({
        data: [
          { type: 'metric', id: 'M1', attributes: { name: 'Placed Order', integration: { name: 'Shopify' } } },
          { type: 'metric', id: 'M2', attributes: { name: 'Custom Event' } },
        ],
        links: {},
      })

      const result = await service.getMetricsDictionary({})

      expect(result.items).toEqual([
        { label: 'Placed Order', value: 'M1', note: 'Shopify' },
        { label: 'Custom Event', value: 'M2', note: undefined },
      ])
    })
  })

  describe('getCampaignsDictionary', () => {
    it('maps campaigns with status note and defaults to email channel', async () => {
      mock.onGet(`${ BASE }/campaigns`).reply({
        data: [{ type: 'campaign', id: 'C1', attributes: { name: 'Sale', status: 'Draft' } }],
        links: {},
      })

      const result = await service.getCampaignsDictionary({})

      expect(result.items).toEqual([
        { label: 'Sale', value: 'C1', note: 'Draft' },
      ])
      expect(mock.history[0].query.filter).toContain("equals(messages.channel,'email')")
    })

    it('uses SMS channel from criteria', async () => {
      mock.onGet(`${ BASE }/campaigns`).reply({ data: [], links: {} })

      await service.getCampaignsDictionary({ criteria: { channel: 'SMS' } })

      expect(mock.history[0].query.filter).toContain("equals(messages.channel,'sms')")
    })
  })

  describe('getTemplatesDictionary', () => {
    it('maps templates with editor_type note', async () => {
      mock.onGet(`${ BASE }/templates`).reply({
        data: [{ type: 'template', id: 'T1', attributes: { name: 'Newsletter', editor_type: 'CODE' } }],
        links: {},
      })

      const result = await service.getTemplatesDictionary({})

      expect(result.items).toEqual([
        { label: 'Newsletter', value: 'T1', note: 'CODE' },
      ])
    })
  })

  describe('getFlowsDictionary', () => {
    it('maps flows with status note', async () => {
      mock.onGet(`${ BASE }/flows`).reply({
        data: [{ type: 'flow', id: 'F1', attributes: { name: 'Welcome', status: 'live' } }],
        links: {},
      })

      const result = await service.getFlowsDictionary({})

      expect(result.items).toEqual([
        { label: 'Welcome', value: 'F1', note: 'live' },
      ])
    })
  })

  describe('getTagsDictionary', () => {
    it('maps tags to dictionary items', async () => {
      mock.onGet(`${ BASE }/tags`).reply({
        data: [{ type: 'tag', id: 'tag-1', attributes: { name: 'holiday' } }],
        links: {},
      })

      const result = await service.getTagsDictionary({})

      expect(result.items).toEqual([
        { label: 'holiday', value: 'tag-1' },
      ])
    })
  })
})
