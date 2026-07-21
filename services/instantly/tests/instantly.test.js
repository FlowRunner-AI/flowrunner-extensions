'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-instantly-api-key'
const BASE = 'https://api.instantly.ai/api/v2'
const UUID = '01996da2-2642-7217-9b78-c20b687ade51'
const UUID2 = '0199edb7-e363-7042-89c2-dc9adc8e54b3'

describe('Instantly Service', () => {
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
          required: true,
          type: 'STRING',
        }),
      ])
    })
  })

  // ── Auth / base URL ──

  describe('authentication', () => {
    it('sends Bearer token in Authorization header on GET requests', async () => {
      mock.onGet(`${ BASE }/custom-tags`).reply({ items: [] })

      await service.listTags()

      expect(mock.history[0].headers).toMatchObject({
        Authorization: `Bearer ${ API_KEY }`,
      })
      expect(mock.history[0].url).toBe(`${ BASE }/custom-tags`)
    })

    it('sends Bearer token in Authorization header on POST requests', async () => {
      mock.onPost(`${ BASE }/custom-tags`).reply({ id: 'tag-1' })

      await service.createTag('Hot')

      expect(mock.history[0].headers).toMatchObject({
        Authorization: `Bearer ${ API_KEY }`,
      })
    })

    it('sends Bearer token in Authorization header on DELETE requests', async () => {
      mock.onDelete(`${ BASE }/campaigns/${ UUID }`).reply({})

      await service.deleteCampaign(UUID)

      expect(mock.history[0].headers).toMatchObject({
        Authorization: `Bearer ${ API_KEY }`,
      })
    })
  })

  // ── Tags ──

  describe('addTagsToCampaigns', () => {
    it('sends correct request with required params', async () => {
      mock.onPost(`${ BASE }/custom-tags/toggle-resource`).reply({ ok: true })

      const result = await service.addTagsToCampaigns(['c1'], ['t1', 't2'])

      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/custom-tags/toggle-resource`)
      expect(mock.history[0].body).toEqual({
        resource_type: 2,
        resource_ids: ['c1'],
        tag_ids: ['t1', 't2'],
        assign: true,
      })
      expect(result).toMatchObject({ success: true, message: 'Tags added to campaigns successfully' })
    })

    it('throws when campaignIds is empty', async () => {
      await expect(service.addTagsToCampaigns([], ['t1'])).rejects.toThrow('Campaign IDs are required')
    })

    it('throws when tagIds is empty', async () => {
      await expect(service.addTagsToCampaigns(['c1'], [])).rejects.toThrow('Tag IDs are required')
    })

    it('wraps API errors', async () => {
      mock.onPost(`${ BASE }/custom-tags/toggle-resource`).replyWithError({ message: 'Server error' })

      await expect(service.addTagsToCampaigns(['c1'], ['t1'])).rejects.toThrow('Failed to add tags to campaigns: Server error')
    })
  })

  describe('removeTagsFromCampaigns', () => {
    it('sends correct request with assign false', async () => {
      mock.onPost(`${ BASE }/custom-tags/toggle-resource`).reply({ ok: true })

      await service.removeTagsFromCampaigns(['c1'], ['t1'])

      expect(mock.history[0].body).toEqual({
        resource_type: 2,
        resource_ids: ['c1'],
        tag_ids: ['t1'],
        assign: false,
      })
    })

    it('throws when campaignIds is empty', async () => {
      await expect(service.removeTagsFromCampaigns([], ['t1'])).rejects.toThrow('Campaign IDs are required')
    })

    it('throws when tagIds is empty', async () => {
      await expect(service.removeTagsFromCampaigns(['c1'], null)).rejects.toThrow('Tag IDs are required')
    })
  })

  describe('addTagsToAccounts', () => {
    it('sends correct request with resource_type 1 and assign true', async () => {
      mock.onPost(`${ BASE }/custom-tags/toggle-resource`).reply({ ok: true })

      await service.addTagsToAccounts(['a1'], ['t1'])

      expect(mock.history[0].body).toEqual({
        resource_type: 1,
        resource_ids: ['a1'],
        tag_ids: ['t1'],
        assign: true,
      })
    })

    it('throws when accountIds is empty', async () => {
      await expect(service.addTagsToAccounts([], ['t1'])).rejects.toThrow('Account IDs are required')
    })

    it('throws when tagIds is empty', async () => {
      await expect(service.addTagsToAccounts(['a1'], [])).rejects.toThrow('Tag IDs are required')
    })
  })

  describe('removeTagsFromAccounts', () => {
    it('sends correct request with resource_type 1 and assign false', async () => {
      mock.onPost(`${ BASE }/custom-tags/toggle-resource`).reply({ ok: true })

      await service.removeTagsFromAccounts(['a1'], ['t1'])

      expect(mock.history[0].body).toEqual({
        resource_type: 1,
        resource_ids: ['a1'],
        tag_ids: ['t1'],
        assign: false,
      })
    })

    it('throws when accountIds is empty', async () => {
      await expect(service.removeTagsFromAccounts(null, ['t1'])).rejects.toThrow('Account IDs are required')
    })

    it('throws when tagIds is empty', async () => {
      await expect(service.removeTagsFromAccounts(['a1'], [])).rejects.toThrow('Tag IDs are required')
    })
  })

  describe('createTag', () => {
    it('sends correct request with required params only', async () => {
      mock.onPost(`${ BASE }/custom-tags`).reply({ id: 'tag-1', label: 'Hot' })

      const result = await service.createTag('Hot')

      expect(mock.history[0].url).toBe(`${ BASE }/custom-tags`)
      expect(mock.history[0].body).toEqual({ label: 'Hot' })
      expect(result).toEqual({ id: 'tag-1', label: 'Hot' })
    })

    it('includes description when provided', async () => {
      mock.onPost(`${ BASE }/custom-tags`).reply({ id: 'tag-2' })

      await service.createTag('Hot', 'Important leads')

      expect(mock.history[0].body).toEqual({ label: 'Hot', description: 'Important leads' })
    })

    it('throws when tag name is missing', async () => {
      await expect(service.createTag()).rejects.toThrow('Tag name is required')
    })

    it('wraps API errors', async () => {
      mock.onPost(`${ BASE }/custom-tags`).replyWithError({ message: 'Bad request' })

      await expect(service.createTag('Hot')).rejects.toThrow('Failed to create tag: Bad request')
    })
  })

  describe('listTags', () => {
    it('sends GET with no query when no params', async () => {
      mock.onGet(`${ BASE }/custom-tags`).reply({ items: [{ id: 't1', label: 'VIP' }], next_starting_after: 'cur' })

      const result = await service.listTags()

      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].query).toEqual({})
      expect(result).toEqual({ items: [{ id: 't1', label: 'VIP' }], next_starting_after: 'cur' })
    })

    it('passes limit, startingAfter and search as query params', async () => {
      mock.onGet(`${ BASE }/custom-tags`).reply({ items: [] })

      await service.listTags(25, 'cursor-1', 'vip')

      expect(mock.history[0].query).toEqual({ limit: 25, starting_after: 'cursor-1', search: 'vip' })
    })

    it('defaults items to empty array and next_starting_after to undefined', async () => {
      mock.onGet(`${ BASE }/custom-tags`).reply({})

      const result = await service.listTags()

      expect(result).toEqual({ items: [], next_starting_after: undefined })
    })
  })

  // ── Campaigns ──

  describe('addLeadToCampaign', () => {
    it('sends correct request with valid UUIDs', async () => {
      mock.onPost(`${ BASE }/leads/move`).reply({ moved: 1 })

      const result = await service.addLeadToCampaign([UUID], UUID2)

      expect(mock.history[0].url).toBe(`${ BASE }/leads/move`)
      expect(mock.history[0].body).toEqual({
        ids: [UUID],
        to_campaign_id: UUID2,
        check_duplicates_in_campaigns: false,
      })
      expect(result).toMatchObject({ success: true })
    })

    it('includes checkDuplicates when true', async () => {
      mock.onPost(`${ BASE }/leads/move`).reply({ moved: 1 })

      await service.addLeadToCampaign([UUID], UUID2, true)

      expect(mock.history[0].body).toMatchObject({ check_duplicates_in_campaigns: true })
    })

    it('throws when leadIds is empty', async () => {
      await expect(service.addLeadToCampaign([], UUID2)).rejects.toThrow('Lead IDs are required')
    })

    it('throws when campaignId is missing', async () => {
      await expect(service.addLeadToCampaign([UUID], null)).rejects.toThrow('Campaign ID is required')
    })

    it('throws on invalid lead UUID', async () => {
      await expect(service.addLeadToCampaign(['not-a-uuid'], UUID2)).rejects.toThrow('Invalid lead ID format')
    })

    it('throws on invalid campaign UUID', async () => {
      await expect(service.addLeadToCampaign([UUID], 'not-a-uuid')).rejects.toThrow('Invalid campaign ID format')
    })
  })

  describe('listCampaigns', () => {
    it('sends GET with no query when no params', async () => {
      mock.onGet(`${ BASE }/campaigns`).reply({ items: [{ id: 'c1', name: 'Q1' }] })

      const result = await service.listCampaigns()

      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/campaigns`)
      expect(mock.history[0].query).toEqual({})
      expect(result).toEqual({ items: [{ id: 'c1', name: 'Q1' }] })
    })

    it('passes params and joins tags into comma string', async () => {
      mock.onGet(`${ BASE }/campaigns`).reply({ items: [] })

      await service.listCampaigns(10, 'after-1', 'outreach', ['t1', 't2'])

      expect(mock.history[0].query).toEqual({
        limit: 10,
        starting_after: 'after-1',
        search: 'outreach',
        tag_ids: 't1,t2',
      })
    })

    it('wraps API errors', async () => {
      mock.onGet(`${ BASE }/campaigns`).replyWithError({ message: 'Unauthorized' })

      await expect(service.listCampaigns()).rejects.toThrow('Failed to list campaigns: Unauthorized')
    })
  })

  describe('createCampaign', () => {
    const schedule = { schedules: [{ name: 'default', timing: { from: '09:00', to: '17:00' } }] }

    it('sends required params only', async () => {
      mock.onPost(`${ BASE }/campaigns`).reply({ id: 'new-c', name: 'My Campaign' })

      const result = await service.createCampaign('My Campaign', schedule)

      expect(mock.history[0].url).toBe(`${ BASE }/campaigns`)
      expect(mock.history[0].body).toEqual({
        name: 'My Campaign',
        campaign_schedule: schedule,
      })
      expect(result).toEqual({ id: 'new-c', name: 'My Campaign' })
    })

    it('maps optional params to snake_case body', async () => {
      mock.onPost(`${ BASE }/campaigns`).reply({ id: 'new-c' })

      await service.createCampaign(
        'My Campaign', schedule, 100, true, [{ steps: [] }], 10, 20, false, true,
        ['a@x.com'], 50, true, ['tag1'], true, false, true, 25, false
      )

      expect(mock.history[0].body).toMatchObject({
        name: 'My Campaign',
        campaign_schedule: schedule,
        pl_value: 100,
        is_evergreen: true,
        sequences: [{ steps: [] }],
        email_gap: 10,
        random_wait_max: 20,
        text_only: false,
        first_email_text_only: true,
        email_list: ['a@x.com'],
        daily_limit: 50,
        stop_on_reply: true,
        email_tag_list: ['tag1'],
        link_tracking: true,
        open_tracking: false,
        stop_on_auto_reply: true,
        daily_max_leads: 25,
        prioritize_new_leads: false,
      })
    })

    it('throws when name is missing', async () => {
      await expect(service.createCampaign(null, schedule)).rejects.toThrow('Campaign name is required')
    })

    it('throws when schedule is missing', async () => {
      await expect(service.createCampaign('X', null)).rejects.toThrow('Campaign schedule is required')
    })
  })

  describe('getCampaign', () => {
    it('sends GET to campaign id endpoint', async () => {
      mock.onGet(`${ BASE }/campaigns/${ UUID }`).reply({ id: UUID, name: 'Q1' })

      const result = await service.getCampaign(UUID)

      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/campaigns/${ UUID }`)
      expect(result).toEqual({ id: UUID, name: 'Q1' })
    })

    it('throws when id is missing', async () => {
      await expect(service.getCampaign()).rejects.toThrow('Failed to get campaign: ID is required')
    })
  })

  describe('deleteCampaign', () => {
    it('sends DELETE with no body', async () => {
      mock.onDelete(`${ BASE }/campaigns/${ UUID }`).reply({})

      const result = await service.deleteCampaign(UUID)

      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${ BASE }/campaigns/${ UUID }`)
      expect(mock.history[0].body).toBeUndefined()
      expect(result).toMatchObject({ success: true, message: 'Campaign deleted successfully' })
    })

    it('throws when id is missing', async () => {
      await expect(service.deleteCampaign()).rejects.toThrow('Failed to delete campaign: ID is required')
    })
  })

  describe('updateCampaign', () => {
    it('sends PATCH with only provided fields', async () => {
      mock.onPatch(`${ BASE }/campaigns/${ UUID }`).reply({ id: UUID, name: 'New' })

      const result = await service.updateCampaign(UUID, 'New')

      expect(mock.history[0].method).toBe('patch')
      expect(mock.history[0].url).toBe(`${ BASE }/campaigns/${ UUID }`)
      expect(mock.history[0].body).toEqual({ name: 'New' })
      expect(result).toEqual({ id: UUID, name: 'New' })
    })

    it('sends empty object body when no updatable fields provided', async () => {
      mock.onPatch(`${ BASE }/campaigns/${ UUID }`).reply({ id: UUID })

      await service.updateCampaign(UUID)

      expect(mock.history[0].body).toEqual({})
    })

    it('maps optional params to snake_case', async () => {
      mock.onPatch(`${ BASE }/campaigns/${ UUID }`).reply({ id: UUID })

      await service.updateCampaign(UUID, 'New', 200, false, { schedules: [] }, [{ steps: [] }], 5)

      expect(mock.history[0].body).toMatchObject({
        name: 'New',
        pl_value: 200,
        is_evergreen: false,
        campaign_schedule: { schedules: [] },
        sequences: [{ steps: [] }],
        email_gap: 5,
      })
    })

    it('throws when id is missing', async () => {
      await expect(service.updateCampaign()).rejects.toThrow('Campaign ID is required')
    })
  })

  describe('activateCampaign', () => {
    it('sends POST to activate endpoint', async () => {
      mock.onPost(`${ BASE }/campaigns/${ UUID }/activate`).reply({ ok: true })

      const result = await service.activateCampaign(UUID)

      expect(mock.history[0].url).toBe(`${ BASE }/campaigns/${ UUID }/activate`)
      expect(result).toMatchObject({ success: true, message: 'Campaign activated successfully' })
    })

    it('throws when id is missing', async () => {
      await expect(service.activateCampaign()).rejects.toThrow('Campaign ID is required')
    })
  })

  describe('pauseCampaign', () => {
    it('sends POST to pause endpoint', async () => {
      mock.onPost(`${ BASE }/campaigns/${ UUID }/pause`).reply({ ok: true })

      const result = await service.pauseCampaign(UUID)

      expect(mock.history[0].url).toBe(`${ BASE }/campaigns/${ UUID }/pause`)
      expect(result).toMatchObject({ success: true, message: 'Campaign paused successfully' })
    })

    it('throws when id is missing', async () => {
      await expect(service.pauseCampaign()).rejects.toThrow('Campaign ID is required')
    })
  })

  describe('duplicateCampaign', () => {
    it('sends POST to duplicate endpoint and returns response', async () => {
      mock.onPost(`${ BASE }/campaigns/${ UUID }/duplicate`).reply({ id: 'dup-1' })

      const result = await service.duplicateCampaign(UUID)

      expect(mock.history[0].url).toBe(`${ BASE }/campaigns/${ UUID }/duplicate`)
      expect(result).toEqual({ id: 'dup-1' })
    })

    it('throws when id is missing', async () => {
      await expect(service.duplicateCampaign()).rejects.toThrow('Campaign ID is required')
    })
  })

  describe('searchCampaignsByContact', () => {
    it('sends GET with no query when no params', async () => {
      mock.onGet(`${ BASE }/campaigns/search-by-contact`).reply({ campaigns: [] })

      const result = await service.searchCampaignsByContact()

      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/campaigns/search-by-contact`)
      expect(mock.history[0].query).toEqual({})
      expect(result).toEqual({ campaigns: [] })
    })

    it('passes search, sortColumn and sortOrder', async () => {
      mock.onGet(`${ BASE }/campaigns/search-by-contact`).reply({ campaigns: [] })

      await service.searchCampaignsByContact('john@x.com', 'name', 'Ascending')

      expect(mock.history[0].query).toEqual({
        search: 'john@x.com',
        sort_column: 'name',
        sort_order: 'Ascending',
      })
    })
  })

  describe('getCampaignAnalytics', () => {
    it('sends GET with no query when no params', async () => {
      mock.onGet(`${ BASE }/campaigns/analytics`).reply({ sent: 100 })

      const result = await service.getCampaignAnalytics()

      expect(mock.history[0].url).toBe(`${ BASE }/campaigns/analytics`)
      expect(mock.history[0].query).toEqual({})
      expect(result).toEqual({ sent: 100 })
    })

    it('passes id, dates and excludeTotalLeadsCount', async () => {
      mock.onGet(`${ BASE }/campaigns/analytics`).reply({ sent: 5 })

      await service.getCampaignAnalytics(UUID, '2024-01-01', '2024-02-01', true)

      expect(mock.history[0].query).toEqual({
        id: UUID,
        start_date: '2024-01-01',
        end_date: '2024-02-01',
        exclude_total_leads_count: true,
      })
    })
  })

  describe('getCampaignAnalyticsOverview', () => {
    it('sends GET to overview endpoint with params', async () => {
      mock.onGet(`${ BASE }/campaigns/analytics/overview`).reply({ total_sent: 5000 })

      await service.getCampaignAnalyticsOverview(UUID, '2024-01-01', '2024-02-01', 1)

      expect(mock.history[0].url).toBe(`${ BASE }/campaigns/analytics/overview`)
      expect(mock.history[0].query).toEqual({
        id: UUID,
        start_date: '2024-01-01',
        end_date: '2024-02-01',
        campaign_status: 1,
      })
    })

    it('sends empty query when no params', async () => {
      mock.onGet(`${ BASE }/campaigns/analytics/overview`).reply({ total_sent: 0 })

      await service.getCampaignAnalyticsOverview()

      expect(mock.history[0].query).toEqual({})
    })
  })

  describe('getDailyCampaignAnalytics', () => {
    it('sends GET to daily endpoint with campaign_id param', async () => {
      mock.onGet(`${ BASE }/campaigns/analytics/daily`).reply({ daily_stats: [] })

      await service.getDailyCampaignAnalytics(UUID, '2024-01-01', '2024-02-01', 2)

      expect(mock.history[0].url).toBe(`${ BASE }/campaigns/analytics/daily`)
      expect(mock.history[0].query).toEqual({
        campaign_id: UUID,
        start_date: '2024-01-01',
        end_date: '2024-02-01',
        campaign_status: 2,
      })
    })

    it('sends empty query when no params', async () => {
      mock.onGet(`${ BASE }/campaigns/analytics/daily`).reply({ daily_stats: [] })

      await service.getDailyCampaignAnalytics()

      expect(mock.history[0].query).toEqual({})
    })
  })

  // ── Leads ──

  describe('deleteLeads', () => {
    it('sends a DELETE per lead and returns count', async () => {
      mock.onDelete(`${ BASE }/leads/${ UUID }`).reply({})
      mock.onDelete(`${ BASE }/leads/${ UUID2 }`).reply({})

      const result = await service.deleteLeads([UUID, UUID2])

      expect(mock.history).toHaveLength(2)
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${ BASE }/leads/${ UUID }`)
      expect(mock.history[1].url).toBe(`${ BASE }/leads/${ UUID2 }`)
      expect(result).toMatchObject({ success: true, count: 2 })
    })

    it('throws when leadIds is empty', async () => {
      await expect(service.deleteLeads([])).rejects.toThrow('Lead IDs are required')
    })

    it('throws on invalid UUID', async () => {
      await expect(service.deleteLeads(['bad'])).rejects.toThrow('Invalid lead ID format')
    })
  })

  describe('listLeads', () => {
    it('sends POST to leads/list with empty body by default', async () => {
      mock.onPost(`${ BASE }/leads/list`).reply({ items: [] })

      const result = await service.listLeads()

      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/leads/list`)
      expect(mock.history[0].body).toEqual({})
      expect(result).toEqual({ items: [] })
    })

    it('clamps limit and adds filters', async () => {
      mock.onPost(`${ BASE }/leads/list`).reply({ items: [] })

      await service.listLeads(500, 'after-1', UUID, 'active')

      expect(mock.history[0].body).toEqual({
        limit: 100,
        starting_after: 'after-1',
        filters: { campaign_id: UUID, status: 'active' },
      })
    })

    it('clamps limit to minimum of 1', async () => {
      mock.onPost(`${ BASE }/leads/list`).reply({ items: [] })

      await service.listLeads(0)

      // limit 0 is falsy so body.limit is not set
      expect(mock.history[0].body).toEqual({})
    })
  })

  describe('findLead', () => {
    it('returns the first matching lead', async () => {
      mock.onPost(`${ BASE }/leads/list`).reply({ items: [{ id: UUID, email: 'a@x.com' }] })

      const result = await service.findLead('a@x.com')

      expect(mock.history[0].url).toBe(`${ BASE }/leads/list`)
      expect(mock.history[0].body).toEqual({ filters: { email: 'a@x.com' } })
      expect(result).toEqual({ id: UUID, email: 'a@x.com' })
    })

    it('throws when no lead found', async () => {
      mock.onPost(`${ BASE }/leads/list`).reply({ items: [] })

      await expect(service.findLead('none@x.com')).rejects.toThrow('No lead found with email: none@x.com')
    })

    it('throws when email is missing', async () => {
      await expect(service.findLead()).rejects.toThrow('Email is required')
    })
  })

  describe('updateLeadStatus', () => {
    it('sends PATCH with status body', async () => {
      mock.onPatch(`${ BASE }/leads/${ UUID }`).reply({ id: UUID })

      const result = await service.updateLeadStatus(UUID, 'completed')

      expect(mock.history[0].method).toBe('patch')
      expect(mock.history[0].url).toBe(`${ BASE }/leads/${ UUID }`)
      expect(mock.history[0].body).toEqual({ status: 'completed' })
      expect(result).toMatchObject({ success: true, lead_id: UUID, status: 'completed' })
    })

    it('throws when leadId is missing', async () => {
      await expect(service.updateLeadStatus(null, 'active')).rejects.toThrow('Lead ID is required')
    })

    it('throws when status is missing', async () => {
      await expect(service.updateLeadStatus(UUID)).rejects.toThrow('Status is required')
    })

    it('throws on invalid UUID', async () => {
      await expect(service.updateLeadStatus('bad', 'active')).rejects.toThrow('Invalid lead ID format')
    })
  })

  // ── Blocklist ──

  describe('addToBlocklist', () => {
    it('sends a POST per entry and returns added_count', async () => {
      mock.onPost(`${ BASE }/block-lists-entries`).reply({ id: 'b1' })

      const result = await service.addToBlocklist(['spam@x.com', 'bad.com'])

      expect(mock.history).toHaveLength(2)
      expect(mock.history[0].url).toBe(`${ BASE }/block-lists-entries`)
      expect(mock.history[0].body).toEqual({ bl_value: 'spam@x.com' })
      expect(mock.history[1].body).toEqual({ bl_value: 'bad.com' })
      expect(result).toMatchObject({ success: true, added_count: 2 })
    })

    it('throws when empty', async () => {
      await expect(service.addToBlocklist([])).rejects.toThrow('At least one email or domain is required')
    })
  })

  // ── Accounts ──

  describe('listAccounts', () => {
    it('sends GET with empty query by default', async () => {
      mock.onGet(`${ BASE }/accounts`).reply({ items: [] })

      const result = await service.listAccounts()

      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/accounts`)
      expect(mock.history[0].query).toEqual({})
      expect(result).toEqual({ items: [] })
    })

    it('maps status and provider to numeric codes and joins tags', async () => {
      mock.onGet(`${ BASE }/accounts`).reply({ items: [] })

      await service.listAccounts(200, 'after-1', 'sender', 'Active', 'Google', ['t1', 't2'])

      expect(mock.history[0].query).toEqual({
        limit: 100,
        starting_after: 'after-1',
        search: 'sender',
        status: 1,
        provider_code: 2,
        tag_ids: 't1,t2',
      })
    })

    it('maps error statuses to negative codes', async () => {
      mock.onGet(`${ BASE }/accounts`).reply({ items: [] })

      await service.listAccounts(undefined, undefined, undefined, 'Connection Error', 'Microsoft')

      expect(mock.history[0].query).toEqual({ status: -1, provider_code: 3 })
    })
  })

  describe('getAccount', () => {
    it('sends GET with URL-encoded email', async () => {
      mock.onGet(`${ BASE }/accounts/${ encodeURIComponent('a@x.com') }`).reply({ email: 'a@x.com' })

      const result = await service.getAccount('a@x.com')

      expect(mock.history[0].url).toBe(`${ BASE }/accounts/a%40x.com`)
      expect(result).toEqual({ email: 'a@x.com' })
    })

    it('throws when email is missing', async () => {
      await expect(service.getAccount()).rejects.toThrow('Email is required')
    })
  })

  describe('pauseAccount', () => {
    it('sends POST to pause endpoint', async () => {
      mock.onPost(`${ BASE }/accounts/${ encodeURIComponent('a@x.com') }/pause`).reply({ ok: true })

      const result = await service.pauseAccount('a@x.com')

      expect(mock.history[0].url).toBe(`${ BASE }/accounts/a%40x.com/pause`)
      expect(result).toMatchObject({ success: true, message: 'Account paused successfully' })
    })

    it('throws when email is missing', async () => {
      await expect(service.pauseAccount()).rejects.toThrow('Email is required')
    })
  })

  describe('resumeAccount', () => {
    it('sends POST to resume endpoint', async () => {
      mock.onPost(`${ BASE }/accounts/${ encodeURIComponent('a@x.com') }/resume`).reply({ ok: true })

      const result = await service.resumeAccount('a@x.com')

      expect(mock.history[0].url).toBe(`${ BASE }/accounts/a%40x.com/resume`)
      expect(result).toMatchObject({ success: true, message: 'Account resumed successfully' })
    })

    it('throws when email is missing', async () => {
      await expect(service.resumeAccount()).rejects.toThrow('Email is required')
    })
  })

  describe('markAccountFixed', () => {
    it('sends POST to mark-fixed endpoint', async () => {
      mock.onPost(`${ BASE }/accounts/${ encodeURIComponent('a@x.com') }/mark-fixed`).reply({ ok: true })

      const result = await service.markAccountFixed('a@x.com')

      expect(mock.history[0].url).toBe(`${ BASE }/accounts/a%40x.com/mark-fixed`)
      expect(result).toMatchObject({ success: true, message: 'Account marked as fixed successfully' })
    })

    it('throws when email is missing', async () => {
      await expect(service.markAccountFixed()).rejects.toThrow('Email is required')
    })
  })

  describe('createAccount', () => {
    const imap = { imapUsername: 'iu', imapPassword: 'ip', imapHost: 'imap.x.com', imapPort: 993 }
    const smtp = { smtpUsername: 'su', smtpPassword: 'sp', smtpHost: 'smtp.x.com', smtpPort: 587 }

    it('sends POST with required IMAP/SMTP fields mapped', async () => {
      mock.onPost(`${ BASE }/accounts`).reply({ email: 'a@x.com' })

      const result = await service.createAccount('a@x.com', 'John', 'Doe', 'Google', imap, smtp)

      expect(mock.history[0].url).toBe(`${ BASE }/accounts`)
      expect(mock.history[0].body).toEqual({
        email: 'a@x.com',
        first_name: 'John',
        last_name: 'Doe',
        provider_code: 2,
        imap_username: 'iu',
        imap_password: 'ip',
        imap_host: 'imap.x.com',
        imap_port: 993,
        smtp_username: 'su',
        smtp_password: 'sp',
        smtp_host: 'smtp.x.com',
        smtp_port: 587,
      })
      expect(result).toEqual({ email: 'a@x.com' })
    })

    it('adds optional fields and warmup', async () => {
      mock.onPost(`${ BASE }/accounts`).reply({ email: 'a@x.com' })

      await service.createAccount(
        'a@x.com', 'John', 'Doe', 'Custom IMAP/SMTP', imap, smtp,
        50, 10, 'reply@x.com', true, 5, false, 'track.x.com', { limit: 30 }
      )

      expect(mock.history[0].body).toMatchObject({
        provider_code: 1,
        daily_limit: 50,
        sending_gap: 10,
        reply_to: 'reply@x.com',
        enable_slow_ramp: true,
        inbox_placement_test_limit: 5,
        skip_cname_check: false,
        tracking_domain_name: 'track.x.com',
        warmup: { limit: 30 },
      })
    })

    it('throws when required identity fields are missing', async () => {
      await expect(service.createAccount('', 'John', 'Doe', 'Google', imap, smtp)).rejects.toThrow('Email, first name, last name, and provider are required')
    })

    it('throws when IMAP settings are incomplete', async () => {
      await expect(service.createAccount('a@x.com', 'John', 'Doe', 'Google', { imapUsername: 'iu' }, smtp)).rejects.toThrow('IMAP settings are required')
    })

    it('throws when SMTP settings are incomplete', async () => {
      await expect(service.createAccount('a@x.com', 'John', 'Doe', 'Google', imap, { smtpUsername: 'su' })).rejects.toThrow('SMTP settings are required')
    })

    it('throws on invalid provider', async () => {
      await expect(service.createAccount('a@x.com', 'John', 'Doe', 'Yahoo', imap, smtp)).rejects.toThrow('Invalid provider')
    })
  })

  describe('updateAccount', () => {
    it('sends PATCH with only provided fields', async () => {
      mock.onPatch(`${ BASE }/accounts/${ encodeURIComponent('a@x.com') }`).reply({ ok: true })

      const result = await service.updateAccount('a@x.com', 'Jane')

      expect(mock.history[0].method).toBe('patch')
      expect(mock.history[0].url).toBe(`${ BASE }/accounts/a%40x.com`)
      expect(mock.history[0].body).toEqual({ first_name: 'Jane' })
      expect(result).toMatchObject({ success: true, message: 'Account updated successfully' })
    })

    it('maps all optional fields and warmup', async () => {
      mock.onPatch(`${ BASE }/accounts/${ encodeURIComponent('a@x.com') }`).reply({ ok: true })

      await service.updateAccount('a@x.com', 'Jane', 'Roe', 75, 15, true, 3, false, 'track.x.com', true, { limit: 40 })

      expect(mock.history[0].body).toEqual({
        first_name: 'Jane',
        last_name: 'Roe',
        daily_limit: 75,
        sending_gap: 15,
        enable_slow_ramp: true,
        inbox_placement_test_limit: 3,
        skip_cname_check: false,
        tracking_domain_name: 'track.x.com',
        remove_tracking_domain: true,
        warmup: { limit: 40 },
      })
    })

    it('sends empty body when only email is provided', async () => {
      mock.onPatch(`${ BASE }/accounts/${ encodeURIComponent('a@x.com') }`).reply({ ok: true })

      await service.updateAccount('a@x.com')

      expect(mock.history[0].body).toEqual({})
    })

    it('throws when email is missing', async () => {
      await expect(service.updateAccount()).rejects.toThrow('Email is required')
    })
  })

  describe('deleteAccount', () => {
    it('sends DELETE with no body', async () => {
      mock.onDelete(`${ BASE }/accounts/${ encodeURIComponent('a@x.com') }`).reply({})

      const result = await service.deleteAccount('a@x.com')

      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${ BASE }/accounts/a%40x.com`)
      expect(mock.history[0].body).toBeUndefined()
      expect(result).toMatchObject({ success: true, message: 'Account deleted successfully' })
    })

    it('throws when email is missing', async () => {
      await expect(service.deleteAccount()).rejects.toThrow('Email is required')
    })
  })

  describe('enableWarmup', () => {
    it('sends POST with emails', async () => {
      mock.onPost(`${ BASE }/accounts/warmup/enable`).reply({ ok: true })

      const result = await service.enableWarmup(['a@x.com'])

      expect(mock.history[0].url).toBe(`${ BASE }/accounts/warmup/enable`)
      expect(mock.history[0].body).toEqual({ emails: ['a@x.com'] })
      expect(result).toMatchObject({ success: true, message: 'Warmup enabled successfully' })
    })

    it('sends include_all_emails and excluded_emails', async () => {
      mock.onPost(`${ BASE }/accounts/warmup/enable`).reply({ ok: true })

      await service.enableWarmup(null, true, ['skip@x.com'])

      expect(mock.history[0].body).toEqual({
        include_all_emails: true,
        excluded_emails: ['skip@x.com'],
      })
    })

    it('sends empty object body when no params', async () => {
      mock.onPost(`${ BASE }/accounts/warmup/enable`).reply({ ok: true })

      await service.enableWarmup()

      expect(mock.history[0].body).toEqual({})
    })
  })

  describe('disableWarmup', () => {
    it('sends POST with emails', async () => {
      mock.onPost(`${ BASE }/accounts/warmup/disable`).reply({ ok: true })

      const result = await service.disableWarmup(['a@x.com'])

      expect(mock.history[0].url).toBe(`${ BASE }/accounts/warmup/disable`)
      expect(mock.history[0].body).toEqual({ emails: ['a@x.com'] })
      expect(result).toMatchObject({ success: true, message: 'Warmup disabled successfully' })
    })

    it('sends include_all_emails and excluded_emails', async () => {
      mock.onPost(`${ BASE }/accounts/warmup/disable`).reply({ ok: true })

      await service.disableWarmup(null, true, ['skip@x.com'])

      expect(mock.history[0].body).toEqual({
        include_all_emails: true,
        excluded_emails: ['skip@x.com'],
      })
    })
  })

  describe('getWarmupAnalytics', () => {
    it('sends POST with emails body', async () => {
      mock.onPost(`${ BASE }/accounts/warmup-analytics`).reply({ analytics: [] })

      const result = await service.getWarmupAnalytics(['a@x.com'])

      expect(mock.history[0].url).toBe(`${ BASE }/accounts/warmup-analytics`)
      expect(mock.history[0].body).toEqual({ emails: ['a@x.com'] })
      expect(result).toEqual({ analytics: [] })
    })

    it('throws when emails is empty', async () => {
      await expect(service.getWarmupAnalytics([])).rejects.toThrow('At least one email is required')
    })
  })

  describe('testAccountVitals', () => {
    it('sends POST with accounts body', async () => {
      mock.onPost(`${ BASE }/accounts/test/vitals`).reply({ results: [] })

      const result = await service.testAccountVitals(['a@x.com'])

      expect(mock.history[0].url).toBe(`${ BASE }/accounts/test/vitals`)
      expect(mock.history[0].body).toEqual({ accounts: ['a@x.com'] })
      expect(result).toEqual({ results: [] })
    })

    it('throws when accounts is empty', async () => {
      await expect(service.testAccountVitals([])).rejects.toThrow('At least one account is required')
    })
  })

  // ── Lead Lists ──

  describe('createLeadList', () => {
    it('sends POST with name only', async () => {
      mock.onPost(`${ BASE }/lead-lists`).reply({ id: 'l1', name: 'My List' })

      const result = await service.createLeadList('My List')

      expect(mock.history[0].url).toBe(`${ BASE }/lead-lists`)
      expect(mock.history[0].body).toEqual({ name: 'My List' })
      expect(result).toEqual({ id: 'l1', name: 'My List' })
    })

    it('includes has_enrichment_task and owned_by', async () => {
      mock.onPost(`${ BASE }/lead-lists`).reply({ id: 'l1' })

      await service.createLeadList('My List', true, 'user-1')

      expect(mock.history[0].body).toEqual({
        name: 'My List',
        has_enrichment_task: true,
        owned_by: 'user-1',
      })
    })

    it('throws when name is missing', async () => {
      await expect(service.createLeadList()).rejects.toThrow('Name is required')
    })
  })

  describe('listLeadLists', () => {
    it('sends GET with empty query by default', async () => {
      mock.onGet(`${ BASE }/lead-lists`).reply({ items: [] })

      await service.listLeadLists()

      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/lead-lists`)
      expect(mock.history[0].query).toEqual({})
    })

    it('passes params including boolean has_enrichment_task', async () => {
      mock.onGet(`${ BASE }/lead-lists`).reply({ items: [] })

      await service.listLeadLists(20, 'after-1', false, 'vip')

      expect(mock.history[0].query).toEqual({
        limit: 20,
        starting_after: 'after-1',
        has_enrichment_task: false,
        search: 'vip',
      })
    })
  })

  describe('getLeadList', () => {
    it('sends GET to lead list id endpoint', async () => {
      mock.onGet(`${ BASE }/lead-lists/l1`).reply({ id: 'l1' })

      const result = await service.getLeadList('l1')

      expect(mock.history[0].url).toBe(`${ BASE }/lead-lists/l1`)
      expect(result).toEqual({ id: 'l1' })
    })

    it('throws when id is missing', async () => {
      await expect(service.getLeadList()).rejects.toThrow('ID is required')
    })
  })

  describe('updateLeadList', () => {
    it('sends PATCH with provided fields', async () => {
      mock.onPatch(`${ BASE }/lead-lists/l1`).reply({ ok: true })

      const result = await service.updateLeadList('l1', 'New Name', true, 'user-1')

      expect(mock.history[0].method).toBe('patch')
      expect(mock.history[0].url).toBe(`${ BASE }/lead-lists/l1`)
      expect(mock.history[0].body).toEqual({
        name: 'New Name',
        has_enrichment_task: true,
        owned_by: 'user-1',
      })
      expect(result).toMatchObject({ success: true, message: 'Lead list updated successfully' })
    })

    it('throws when id is missing', async () => {
      await expect(service.updateLeadList()).rejects.toThrow('ID is required')
    })
  })

  describe('deleteLeadList', () => {
    it('sends DELETE with no body', async () => {
      mock.onDelete(`${ BASE }/lead-lists/l1`).reply({})

      const result = await service.deleteLeadList('l1')

      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${ BASE }/lead-lists/l1`)
      expect(mock.history[0].body).toBeUndefined()
      expect(result).toMatchObject({ success: true, message: 'Lead list deleted successfully' })
    })

    it('throws when id is missing', async () => {
      await expect(service.deleteLeadList()).rejects.toThrow('ID is required')
    })
  })

  describe('getLeadListVerificationStats', () => {
    it('sends GET to verification-stats endpoint', async () => {
      mock.onGet(`${ BASE }/lead-lists/l1/verification-stats`).reply({ total: 100 })

      const result = await service.getLeadListVerificationStats('l1')

      expect(mock.history[0].url).toBe(`${ BASE }/lead-lists/l1/verification-stats`)
      expect(result).toEqual({ total: 100 })
    })

    it('throws when id is missing', async () => {
      await expect(service.getLeadListVerificationStats()).rejects.toThrow('ID is required')
    })
  })

  // ── Lead Labels ──

  describe('createLeadLabel', () => {
    it('sends POST with required fields', async () => {
      mock.onPost(`${ BASE }/lead-labels`).reply({ id: 'lbl1' })

      const result = await service.createLeadLabel('Hot', 'positive')

      expect(mock.history[0].url).toBe(`${ BASE }/lead-labels`)
      expect(mock.history[0].body).toEqual({ label: 'Hot', interest_status_label: 'positive' })
      expect(result).toEqual({ id: 'lbl1' })
    })

    it('includes description and use_with_ai', async () => {
      mock.onPost(`${ BASE }/lead-labels`).reply({ id: 'lbl1' })

      await service.createLeadLabel('Hot', 'positive', 'Interested prospects', true)

      expect(mock.history[0].body).toEqual({
        label: 'Hot',
        interest_status_label: 'positive',
        description: 'Interested prospects',
        use_with_ai: true,
      })
    })

    it('throws when required fields missing', async () => {
      await expect(service.createLeadLabel('Hot')).rejects.toThrow('Label and interest status are required')
    })
  })

  describe('listLeadLabels', () => {
    it('sends GET with empty query by default', async () => {
      mock.onGet(`${ BASE }/lead-labels`).reply({ items: [] })

      await service.listLeadLabels()

      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].query).toEqual({})
    })

    it('passes params', async () => {
      mock.onGet(`${ BASE }/lead-labels`).reply({ items: [] })

      await service.listLeadLabels(15, 'after-1', 'hot', 'positive')

      expect(mock.history[0].query).toEqual({
        limit: 15,
        starting_after: 'after-1',
        search: 'hot',
        interest_status: 'positive',
      })
    })
  })

  describe('getLeadLabel', () => {
    it('sends GET to lead label id endpoint', async () => {
      mock.onGet(`${ BASE }/lead-labels/lbl1`).reply({ id: 'lbl1' })

      const result = await service.getLeadLabel('lbl1')

      expect(mock.history[0].url).toBe(`${ BASE }/lead-labels/lbl1`)
      expect(result).toEqual({ id: 'lbl1' })
    })

    it('throws when id is missing', async () => {
      await expect(service.getLeadLabel()).rejects.toThrow('ID is required')
    })
  })

  describe('updateLeadLabel', () => {
    it('sends PATCH with provided fields', async () => {
      mock.onPatch(`${ BASE }/lead-labels/lbl1`).reply({ ok: true })

      const result = await service.updateLeadLabel('lbl1', 'Warm', 'neutral', 'desc', false)

      expect(mock.history[0].method).toBe('patch')
      expect(mock.history[0].url).toBe(`${ BASE }/lead-labels/lbl1`)
      expect(mock.history[0].body).toEqual({
        label: 'Warm',
        interest_status_label: 'neutral',
        description: 'desc',
        use_with_ai: false,
      })
      expect(result).toMatchObject({ success: true, message: 'Lead label updated successfully' })
    })

    it('throws when id is missing', async () => {
      await expect(service.updateLeadLabel()).rejects.toThrow('ID is required')
    })
  })

  describe('deleteLeadLabel', () => {
    it('sends DELETE via apiRequest with reassigned_status body', async () => {
      mock.onDelete(`${ BASE }/lead-labels/lbl1`).reply({})

      const result = await service.deleteLeadLabel('lbl1', 0)

      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${ BASE }/lead-labels/lbl1`)
      expect(mock.history[0].body).toEqual({ reassigned_status: 0 })
      expect(result).toMatchObject({ success: true, message: 'Lead label deleted successfully' })
    })

    it('throws when id is missing', async () => {
      await expect(service.deleteLeadLabel(null, 1)).rejects.toThrow('ID is required')
    })

    it('throws when reassignedStatus is missing', async () => {
      await expect(service.deleteLeadLabel('lbl1')).rejects.toThrow('Reassigned status is required')
    })
  })

  // ── Emails ──

  describe('listEmails', () => {
    it('sends GET with empty query by default', async () => {
      mock.onGet(`${ BASE }/emails`).reply({ items: [] })

      await service.listEmails()

      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/emails`)
      expect(mock.history[0].query).toEqual({})
    })

    it('passes all filter params', async () => {
      mock.onGet(`${ BASE }/emails`).reply({ items: [] })

      await service.listEmails(30, 'email-1', 'thread:abc', UUID, 'a@x.com', true, 'Descending')

      expect(mock.history[0].query).toEqual({
        limit: 30,
        starting_after: 'email-1',
        search: 'thread:abc',
        campaign_id: UUID,
        eaccount: 'a@x.com',
        is_unread: true,
        sort_order: 'Descending',
      })
    })
  })

  describe('getEmail', () => {
    it('sends GET to email id endpoint', async () => {
      mock.onGet(`${ BASE }/emails/e1`).reply({ id: 'e1' })

      const result = await service.getEmail('e1')

      expect(mock.history[0].url).toBe(`${ BASE }/emails/e1`)
      expect(result).toEqual({ id: 'e1' })
    })

    it('throws when id is missing', async () => {
      await expect(service.getEmail()).rejects.toThrow('ID is required')
    })
  })

  describe('updateEmail', () => {
    it('sends PATCH with is_unread and reminder_ts', async () => {
      mock.onPatch(`${ BASE }/emails/e1`).reply({ ok: true })

      const result = await service.updateEmail('e1', false, '2024-01-01T00:00:00Z')

      expect(mock.history[0].method).toBe('patch')
      expect(mock.history[0].url).toBe(`${ BASE }/emails/e1`)
      expect(mock.history[0].body).toEqual({
        is_unread: false,
        reminder_ts: '2024-01-01T00:00:00Z',
      })
      expect(result).toMatchObject({ success: true, message: 'Email updated successfully' })
    })

    it('sends empty body when no updatable fields', async () => {
      mock.onPatch(`${ BASE }/emails/e1`).reply({ ok: true })

      await service.updateEmail('e1')

      expect(mock.history[0].body).toEqual({})
    })

    it('throws when id is missing', async () => {
      await expect(service.updateEmail()).rejects.toThrow('ID is required')
    })
  })

  describe('deleteEmail', () => {
    it('sends DELETE with no body', async () => {
      mock.onDelete(`${ BASE }/emails/e1`).reply({})

      const result = await service.deleteEmail('e1')

      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${ BASE }/emails/e1`)
      expect(mock.history[0].body).toBeUndefined()
      expect(result).toMatchObject({ success: true, message: 'Email deleted successfully' })
    })

    it('throws when id is missing', async () => {
      await expect(service.deleteEmail()).rejects.toThrow('ID is required')
    })
  })

  describe('replyToEmail', () => {
    const body = { html: '<p>Hi</p>' }

    it('sends POST with required fields', async () => {
      mock.onPost(`${ BASE }/emails/reply`).reply({ id: 'reply-1' })

      const result = await service.replyToEmail('a@x.com', 'uuid-1', 'Re: Hello', body)

      expect(mock.history[0].url).toBe(`${ BASE }/emails/reply`)
      expect(mock.history[0].body).toEqual({
        eaccount: 'a@x.com',
        reply_to_uuid: 'uuid-1',
        subject: 'Re: Hello',
        body,
      })
      expect(result).toEqual({ id: 'reply-1' })
    })

    it('includes CC, BCC and reminder', async () => {
      mock.onPost(`${ BASE }/emails/reply`).reply({ id: 'reply-1' })

      await service.replyToEmail('a@x.com', 'uuid-1', 'Re: Hello', body, 'cc@x.com', 'bcc@x.com', '2024-01-01T00:00:00Z')

      expect(mock.history[0].body).toMatchObject({
        cc_address_email_list: 'cc@x.com',
        bcc_address_email_list: 'bcc@x.com',
        reminder_ts: '2024-01-01T00:00:00Z',
      })
    })

    it('throws when required fields are missing', async () => {
      await expect(service.replyToEmail('a@x.com', 'uuid-1', 'Re: Hello')).rejects.toThrow('Email account, reply UUID, subject, and body are required')
    })
  })

  describe('countUnreadEmails', () => {
    it('sends GET to unread count endpoint', async () => {
      mock.onGet(`${ BASE }/emails/unread/count`).reply({ count: 42 })

      const result = await service.countUnreadEmails()

      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/emails/unread/count`)
      expect(result).toEqual({ count: 42 })
    })

    it('wraps API errors', async () => {
      mock.onGet(`${ BASE }/emails/unread/count`).replyWithError({ message: 'Down' })

      await expect(service.countUnreadEmails()).rejects.toThrow('Failed to count unread emails: Down')
    })
  })

  describe('markThreadAsRead', () => {
    it('sends POST to mark-as-read endpoint', async () => {
      mock.onPost(`${ BASE }/emails/threads/thread-1/mark-as-read`).reply({ ok: true })

      const result = await service.markThreadAsRead('thread-1')

      expect(mock.history[0].url).toBe(`${ BASE }/emails/threads/thread-1/mark-as-read`)
      expect(result).toMatchObject({ success: true, message: 'Thread marked as read' })
    })

    it('throws when threadId is missing', async () => {
      await expect(service.markThreadAsRead()).rejects.toThrow('Thread ID is required')
    })
  })

  describe('verifyEmail', () => {
    it('sends POST with email only', async () => {
      mock.onPost(`${ BASE }/email-verification`).reply({ email: 'a@x.com', status: 'valid' })

      const result = await service.verifyEmail('a@x.com')

      expect(mock.history[0].url).toBe(`${ BASE }/email-verification`)
      expect(mock.history[0].body).toEqual({ email: 'a@x.com' })
      expect(result).toEqual({ email: 'a@x.com', status: 'valid' })
    })

    it('includes webhook_url when provided', async () => {
      mock.onPost(`${ BASE }/email-verification`).reply({ email: 'a@x.com' })

      await service.verifyEmail('a@x.com', 'https://hook.x.com')

      expect(mock.history[0].body).toEqual({ email: 'a@x.com', webhook_url: 'https://hook.x.com' })
    })

    it('throws when email is missing', async () => {
      await expect(service.verifyEmail()).rejects.toThrow('Email is required')
    })
  })

  describe('checkEmailVerification', () => {
    it('sends GET with URL-encoded email', async () => {
      mock.onGet(`${ BASE }/email-verification/${ encodeURIComponent('a@x.com') }`).reply({ status: 'valid' })

      const result = await service.checkEmailVerification('a@x.com')

      expect(mock.history[0].url).toBe(`${ BASE }/email-verification/a%40x.com`)
      expect(result).toEqual({ status: 'valid' })
    })

    it('throws when email is missing', async () => {
      await expect(service.checkEmailVerification()).rejects.toThrow('Email is required')
    })
  })

  // ── Dictionaries ──

  describe('getCampaignsDict', () => {
    it('maps campaigns to items with status notes and passes cursor', async () => {
      mock.onGet(`${ BASE }/campaigns`).reply({
        items: [
          { id: 'c1', name: 'Active One', status: 1 },
          { id: 'c2', name: 'Paused One', status: 0 },
          { id: 'c3', name: 'Unknown One', status: 5 },
        ],
        next_starting_after: 'next-cur',
      })

      const result = await service.getCampaignsDict({ search: 'one', cursor: 'cur' })

      expect(mock.history[0].query).toMatchObject({ limit: 100, starting_after: 'cur', search: 'one' })
      expect(result.items).toEqual([
        { label: 'Active One', value: 'c1', note: 'Status: Active' },
        { label: 'Paused One', value: 'c2', note: 'Status: Paused' },
        { label: 'Unknown One', value: 'c3', note: 'Status: Unknown' },
      ])
      expect(result.cursor).toBe('next-cur')
    })

    it('returns empty items on error', async () => {
      mock.onGet(`${ BASE }/campaigns`).replyWithError({ message: 'boom' })

      const result = await service.getCampaignsDict({})

      expect(result).toEqual({ items: [] })
    })

    it('handles null payload', async () => {
      mock.onGet(`${ BASE }/campaigns`).reply({ items: [] })

      const result = await service.getCampaignsDict(null)

      expect(result.items).toEqual([])
    })
  })

  describe('getAccountsDict', () => {
    it('maps accounts to items using email as value and name as note', async () => {
      mock.onGet(`${ BASE }/accounts`).reply({
        items: [
          { email: 'a@x.com', first_name: 'John', last_name: 'Doe' },
          { email: 'b@x.com' },
        ],
        next_starting_after: 'cur2',
      })

      const result = await service.getAccountsDict({})

      expect(result.items).toEqual([
        { label: 'a@x.com', value: 'a@x.com', note: 'John Doe' },
        { label: 'b@x.com', value: 'b@x.com', note: 'No name' },
      ])
      expect(result.cursor).toBe('cur2')
    })

    it('returns empty items on error', async () => {
      mock.onGet(`${ BASE }/accounts`).replyWithError({ message: 'boom' })

      const result = await service.getAccountsDict({})

      expect(result).toEqual({ items: [] })
    })
  })

  describe('getLeadListsDict', () => {
    it('maps lead lists to items with lead count note', async () => {
      mock.onGet(`${ BASE }/lead-lists`).reply({
        items: [{ id: 'l1', name: 'VIP', lead_count: 25 }, { id: 'l2', name: 'Empty' }],
      })

      const result = await service.getLeadListsDict({})

      expect(result.items).toEqual([
        { label: 'VIP', value: 'l1', note: 'Leads: 25' },
        { label: 'Empty', value: 'l2', note: 'Leads: 0' },
      ])
    })

    it('returns empty items on error', async () => {
      mock.onGet(`${ BASE }/lead-lists`).replyWithError({ message: 'boom' })

      const result = await service.getLeadListsDict({})

      expect(result).toEqual({ items: [] })
    })
  })

  describe('getTagsDict', () => {
    it('maps tags to items with description note', async () => {
      mock.onGet(`${ BASE }/custom-tags`).reply({
        items: [{ id: 't1', label: 'VIP', description: 'Important' }, { id: 't2', label: 'Cold' }],
        next_starting_after: 'cur3',
      })

      const result = await service.getTagsDict({})

      expect(result.items).toEqual([
        { label: 'VIP', value: 't1', note: 'Important' },
        { label: 'Cold', value: 't2', note: 'No description' },
      ])
      expect(result.cursor).toBe('cur3')
    })

    it('returns empty items on error', async () => {
      mock.onGet(`${ BASE }/custom-tags`).replyWithError({ message: 'boom' })

      const result = await service.getTagsDict({})

      expect(result).toEqual({ items: [] })
    })
  })

  describe('getLeadLabelsDict', () => {
    it('maps lead labels to items with status note', async () => {
      mock.onGet(`${ BASE }/lead-labels`).reply({
        items: [{ id: 'lbl1', label: 'Hot', interest_status_label: 'positive' }, { id: 'lbl2', label: 'None' }],
      })

      const result = await service.getLeadLabelsDict({})

      expect(result.items).toEqual([
        { label: 'Hot', value: 'lbl1', note: 'Status: positive' },
        { label: 'None', value: 'lbl2', note: 'Status: None' },
      ])
    })

    it('returns empty items on error', async () => {
      mock.onGet(`${ BASE }/lead-labels`).replyWithError({ message: 'boom' })

      const result = await service.getLeadLabelsDict({})

      expect(result).toEqual({ items: [] })
    })
  })

  describe('getLeadsDict', () => {
    it('maps leads to items and filters by search on label', async () => {
      mock.onPost(`${ BASE }/leads/list`).reply({
        items: [
          { id: UUID, email: 'john@x.com', first_name: 'John', last_name: 'Doe', status: 'active' },
          { id: UUID2, email: 'jane@x.com', status: 'paused' },
        ],
        next_starting_after: 'lead-cur',
      })

      const result = await service.getLeadsDict({ search: 'john' })

      // Note: the inner name template is .trim()'d, so the space before the
      // hyphen is removed, producing "email- First Last" (no space before "-").
      expect(result.items).toEqual([
        { label: 'john@x.com- John Doe', value: UUID, note: 'Status: active' },
      ])
      expect(result.cursor).toBe('lead-cur')
    })

    it('returns all leads when no search provided', async () => {
      mock.onPost(`${ BASE }/leads/list`).reply({
        items: [{ id: UUID, email: 'john@x.com', status: 'active' }],
      })

      const result = await service.getLeadsDict({})

      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toMatchObject({ label: 'john@x.com', value: UUID, note: 'Status: active' })
    })

    it('returns empty items on error', async () => {
      mock.onPost(`${ BASE }/leads/list`).replyWithError({ message: 'boom' })

      const result = await service.getLeadsDict({})

      expect(result).toEqual({ items: [] })
    })
  })

  describe('getEventTypesDict', () => {
    it('maps event types fetched from the API', async () => {
      mock.onGet(`${ BASE }/webhooks/event-types`).reply({
        event_types: [
          { id: 'email_sent', label: 'Email Sent', type: 'standard' },
          { id: 'custom_x', label: 'Custom X', type: 'custom' },
        ],
      })

      const result = await service.getEventTypesDict({})

      expect(mock.history[0].url).toBe(`${ BASE }/webhooks/event-types`)
      expect(result.items).toEqual([
        { label: 'Email Sent', value: 'email_sent', note: undefined },
        { label: 'Custom X', value: 'custom_x', note: 'Custom Event' },
      ])
    })

    it('returns empty items when the API call fails', async () => {
      mock.onGet(`${ BASE }/webhooks/event-types`).replyWithError({ message: 'boom' })

      const result = await service.getEventTypesDict({})

      expect(result.items).toEqual([])
    })
  })

  // ── Param Schema Loaders ──

  describe('schema loaders', () => {
    it('createImapSettingsSchemaLoader returns required IMAP fields', async () => {
      const schema = await service.createImapSettingsSchemaLoader()

      expect(schema.map(f => f.name)).toEqual(['imapUsername', 'imapPassword', 'imapHost', 'imapPort'])
      expect(schema.every(f => f.required)).toBe(true)
    })

    it('createSmtpSettingsSchemaLoader returns required SMTP fields', async () => {
      const schema = await service.createSmtpSettingsSchemaLoader()

      expect(schema.map(f => f.name)).toEqual(['smtpUsername', 'smtpPassword', 'smtpHost', 'smtpPort'])
    })

    it('createWarmupSettingsSchemaLoader returns warmup fields with advanced loader', async () => {
      const schema = await service.createWarmupSettingsSchemaLoader()

      expect(schema.map(f => f.name)).toContain('limit')
      expect(schema.find(f => f.name === 'advanced')).toMatchObject({ schemaLoader: 'createWarmupAdvancedSchemaLoader' })
    })

    it('createWarmupAdvancedSchemaLoader returns advanced warmup fields', async () => {
      const schema = await service.createWarmupAdvancedSchemaLoader()

      expect(schema.map(f => f.name)).toEqual(
        expect.arrayContaining(['warm_ctd', 'open_rate', 'important_rate', 'read_emulation', 'spam_save_rate', 'weekday_only'])
      )
    })

    it('createCampaignScheduleSchemaLoader returns schedule fields', async () => {
      const schema = await service.createCampaignScheduleSchemaLoader()

      expect(schema.map(f => f.name)).toEqual(
        expect.arrayContaining(['timezone', 'days', 'time_slots', 'min_time_btw_emails', 'max_new_leads_per_day'])
      )
    })
  })

  // ── Triggers ──

  describe('onActivityEvent', () => {
    it('is a no-op that resolves to undefined', async () => {
      const result = await service.onActivityEvent()

      expect(result).toBeUndefined()
    })
  })

  describe('handleTriggerResolveEvents', () => {
    it('wraps the webhook body into an onActivityEvent event', async () => {
      const invocation = { body: { event_type: 'email_sent', lead_email: 'a@x.com' } }

      const result = await service.handleTriggerResolveEvents(invocation)

      expect(result.events).toEqual([
        { name: 'onActivityEvent', data: invocation.body },
      ])
    })
  })

  describe('handleTriggerUpsertWebhook', () => {
    it('creates a webhook and stores it in webhookData', async () => {
      mock.onPost(`${ BASE }/webhooks`).reply({ id: 'wh-1' })

      const result = await service.handleTriggerUpsertWebhook({
        callbackUrl: 'https://cb.x.com/hook',
        events: [{ data: { eventType: 'Email Sent' } }],
      })

      expect(mock.history[0].url).toBe(`${ BASE }/webhooks`)
      expect(mock.history[0].body).toEqual({
        target_hook_url: 'https://cb.x.com/hook',
        event_type: 'email_sent',
      })
      expect(result.eventScopeId).toBe('email_sent')
      expect(result.webhookData.webhooks).toEqual([
        { id: 'wh-1', event_type: 'email_sent', target_hook_url: 'https://cb.x.com/hook' },
      ])
    })

    it('returns existing webhooks when event type missing', async () => {
      const result = await service.handleTriggerUpsertWebhook({
        callbackUrl: 'https://cb.x.com/hook',
        events: [{ data: {} }],
        webhookData: { webhooks: [{ id: 'existing', event_type: 'reply_received' }] },
      })

      expect(mock.history).toHaveLength(0)
      expect(result.webhookData.webhooks).toEqual([{ id: 'existing', event_type: 'reply_received' }])
    })

    it('does not create a duplicate webhook for an existing event type', async () => {
      const result = await service.handleTriggerUpsertWebhook({
        callbackUrl: 'https://cb.x.com/hook',
        events: [{ data: { eventType: 'Email Sent' } }],
        webhookData: { webhooks: [{ id: 'wh-0', event_type: 'email_sent' }] },
      })

      expect(mock.history).toHaveLength(0)
      expect(result.webhookData.webhooks).toEqual([{ id: 'wh-0', event_type: 'email_sent' }])
    })

    it('throws when webhook creation fails', async () => {
      mock.onPost(`${ BASE }/webhooks`).replyWithError({ message: 'nope' })

      await expect(
        service.handleTriggerUpsertWebhook({
          callbackUrl: 'https://cb.x.com/hook',
          events: [{ data: { eventType: 'Email Sent' } }],
        })
      ).rejects.toThrow()
    })
  })

  describe('handleTriggerSelectMatched', () => {
    it('matches triggers whose event type maps to the event data type', async () => {
      const invocation = {
        eventData: { event_type: 'email_sent' },
        triggers: [
          { id: 't1', data: { eventType: 'Email Sent' } },
          { id: 't2', data: { eventType: 'Reply Received' } },
        ],
      }

      const result = await service.handleTriggerSelectMatched(invocation)

      expect(result).toEqual({ ids: ['t1'] })
    })

    it('returns empty ids when no trigger matches', async () => {
      const invocation = {
        eventData: { event_type: 'lead_closed' },
        triggers: [{ id: 't1', data: { eventType: 'Email Sent' } }],
      }

      const result = await service.handleTriggerSelectMatched(invocation)

      expect(result).toEqual({ ids: [] })
    })
  })

  describe('handleTriggerDeleteWebhook', () => {
    it('deletes each stored webhook and clears webhookData', async () => {
      mock.onDelete(`${ BASE }/webhooks/wh-1`).reply({})
      mock.onDelete(`${ BASE }/webhooks/wh-2`).reply({})

      const result = await service.handleTriggerDeleteWebhook({
        webhookData: { webhooks: [{ id: 'wh-1' }, { id: 'wh-2' }] },
      })

      expect(mock.history).toHaveLength(2)
      expect(mock.history[0].url).toBe(`${ BASE }/webhooks/wh-1`)
      expect(mock.history[1].url).toBe(`${ BASE }/webhooks/wh-2`)
      expect(result).toEqual({ webhookData: { webhooks: [] } })
    })

    it('swallows individual delete errors and still clears webhookData', async () => {
      mock.onDelete(`${ BASE }/webhooks/wh-1`).replyWithError({ message: 'gone' })

      const result = await service.handleTriggerDeleteWebhook({
        webhookData: { webhooks: [{ id: 'wh-1' }] },
      })

      expect(result).toEqual({ webhookData: { webhooks: [] } })
    })

    it('handles missing webhookData gracefully', async () => {
      const result = await service.handleTriggerDeleteWebhook({})

      expect(mock.history).toHaveLength(0)
      expect(result).toEqual({ webhookData: { webhooks: [] } })
    })
  })
})
