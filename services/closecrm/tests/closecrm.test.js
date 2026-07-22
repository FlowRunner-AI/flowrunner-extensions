'use strict'

const { createSandbox } = require('../../../service-sandbox')

const CLIENT_ID = 'test-client-id'
const CLIENT_SECRET = 'test-client-secret'
const OAUTH_TOKEN = 'test-oauth-access-token'
const API_BASE = 'https://api.close.com/api/v1'
const OAUTH_TOKEN_URL = 'https://api.close.com/oauth2/token/'
const OAUTH_AUTHORIZE_URL = 'https://app.close.com/oauth2/authorize/'

const BASIC_TOKEN = Buffer.from(`${ CLIENT_ID }:${ CLIENT_SECRET }`).toString('base64')

describe('Close CRM Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      defaultEmailAccountId: 'emailacct_default',
    })

    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()

    // Simulate OAuth access token header available at runtime
    service.request = { headers: { 'oauth-access-token': OAUTH_TOKEN } }
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
        expect.objectContaining({ name: 'clientId', required: true, shared: true, type: 'STRING' }),
        expect.objectContaining({ name: 'clientSecret', required: true, shared: true, type: 'STRING' }),
        expect.objectContaining({ name: 'defaultEmailAccountId', required: false, shared: false, type: 'STRING' }),
      ])
    })
  })

  // ── OAuth Methods ──

  describe('getOAuth2ConnectionURL', () => {
    it('returns a valid authorization URL with correct params', async () => {
      const url = await service.getOAuth2ConnectionURL()

      expect(url).toContain(OAUTH_AUTHORIZE_URL)
      expect(url).toContain(`client_id=${ CLIENT_ID }`)
      expect(url).toContain('response_type=code')
      expect(url).toContain('scope=all.full_access+offline_access')
    })
  })

  describe('executeCallback', () => {
    it('exchanges code for tokens and fetches identity', async () => {
      mock.onPost(OAUTH_TOKEN_URL).reply({
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        expires_in: 3600,
      })

      mock.onGet(`${ API_BASE }/me/`).reply({
        email: 'alex@acme.com',
        display_name: 'Alex Doe',
        image: 'https://img.close.com/avatar.png',
      })

      const result = await service.executeCallback({ code: 'auth-code', redirectURI: 'https://example.com/cb' })

      expect(result).toMatchObject({
        token: 'new-access',
        refreshToken: 'new-refresh',
        expirationInSeconds: 3600,
        connectionIdentityName: 'alex@acme.com',
        connectionIdentityImageURL: 'https://img.close.com/avatar.png',
        overwrite: true,
      })

      // Verify token exchange request
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(OAUTH_TOKEN_URL)
      expect(mock.history[0].headers).toMatchObject({ Authorization: `Basic ${ BASIC_TOKEN }` })
      expect(mock.history[0].body).toContain('grant_type=authorization_code')
      expect(mock.history[0].body).toContain('code=auth-code')
    })

    it('handles /me/ failure gracefully', async () => {
      mock.onPost(OAUTH_TOKEN_URL).reply({
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        expires_in: 3600,
      })

      mock.onGet(`${ API_BASE }/me/`).replyWithError({ message: 'Not found' })

      const result = await service.executeCallback({ code: 'auth-code', redirectURI: 'https://example.com/cb' })

      expect(result.token).toBe('new-access')
      expect(result.connectionIdentityName).toBe('')
    })
  })

  describe('refreshToken', () => {
    it('sends correct request and returns token data', async () => {
      mock.onPost(OAUTH_TOKEN_URL).reply({
        access_token: 'refreshed-access',
        expires_in: 3600,
        refresh_token: 'rotated-refresh',
      })

      const result = await service.refreshToken('old-refresh-token')

      expect(result).toEqual({
        token: 'refreshed-access',
        expirationInSeconds: 3600,
        refreshToken: 'rotated-refresh',
      })

      expect(mock.history[0].body).toContain('grant_type=refresh_token')
      expect(mock.history[0].body).toContain('refresh_token=old-refresh-token')
    })

    it('keeps old refresh token when API does not return new one', async () => {
      mock.onPost(OAUTH_TOKEN_URL).reply({
        access_token: 'refreshed-access',
        expires_in: 3600,
      })

      const result = await service.refreshToken('keep-this')

      expect(result.refreshToken).toBe('keep-this')
    })
  })

  // ── Dictionaries ──

  describe('getPipelinesDictionary', () => {
    it('returns formatted pipeline items', async () => {
      mock.onGet(`${ API_BASE }/pipeline/`).reply({
        data: [
          { id: 'pipe_1', name: 'Sales', statuses: [{ id: 's1' }, { id: 's2' }] },
          { id: 'pipe_2', name: 'Renewals', statuses: [] },
        ],
      })

      const result = await service.getPipelinesDictionary({})

      expect(result.items).toEqual([
        { label: 'Sales', value: 'pipe_1', note: '2 statuses' },
        { label: 'Renewals', value: 'pipe_2', note: '0 statuses' },
      ])

      expect(result.cursor).toBeNull()
    })

    it('filters by search', async () => {
      mock.onGet(`${ API_BASE }/pipeline/`).reply({
        data: [
          { id: 'pipe_1', name: 'Sales', statuses: [] },
          { id: 'pipe_2', name: 'Renewals', statuses: [] },
        ],
      })

      const result = await service.getPipelinesDictionary({ search: 'renew' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('pipe_2')
    })
  })

  describe('getLeadStatusesDictionary', () => {
    it('returns formatted status items', async () => {
      mock.onGet(`${ API_BASE }/status/lead/`).reply({
        data: [{ id: 'stat_1', label: 'Qualified' }],
      })

      const result = await service.getLeadStatusesDictionary({})

      expect(result.items).toEqual([
        { label: 'Qualified', value: 'stat_1', note: 'ID: stat_1' },
      ])
    })
  })

  describe('getOpportunityStatusesDictionary', () => {
    it('returns formatted status items with type note', async () => {
      mock.onGet(`${ API_BASE }/status/opportunity/`).reply({
        data: [{ id: 'stat_o1', label: 'Won', status_type: 'won' }],
      })

      const result = await service.getOpportunityStatusesDictionary({})

      expect(result.items).toEqual([
        { label: 'Won', value: 'stat_o1', note: 'Type: won' },
      ])
    })
  })

  describe('getUsersDictionary', () => {
    it('returns formatted user items', async () => {
      mock.onGet(`${ API_BASE }/user/`).reply({
        data: [{ id: 'user_1', display_name: 'Alex Doe', email: 'alex@acme.com' }],
      })

      const result = await service.getUsersDictionary({})

      expect(result.items).toEqual([
        { label: 'Alex Doe', value: 'user_1', note: 'alex@acme.com' },
      ])
    })
  })

  describe('getLeadsDictionary', () => {
    it('returns leads with pagination cursor', async () => {
      mock.onGet(`${ API_BASE }/lead/`).reply({
        data: [{ id: 'lead_1', display_name: 'Acme', status_label: 'Qualified' }],
        has_more: true,
      })

      const result = await service.getLeadsDictionary({})

      expect(result.items).toEqual([
        { label: 'Acme', value: 'lead_1', note: 'Status: Qualified' },
      ])

      expect(result.cursor).toBe('1')
    })

    it('passes search as query param', async () => {
      mock.onGet(`${ API_BASE }/lead/`).reply({ data: [], has_more: false })

      await service.getLeadsDictionary({ search: 'Acme' })

      expect(mock.history[0].query).toMatchObject({ query: 'Acme' })
    })
  })

  describe('getContactsDictionary', () => {
    it('scopes to lead when criteria.leadId is provided', async () => {
      mock.onGet(`${ API_BASE }/contact/`).reply({ data: [], has_more: false })

      await service.getContactsDictionary({ criteria: { leadId: 'lead_1' } })

      expect(mock.history[0].query).toMatchObject({ lead_id: 'lead_1' })
    })
  })

  describe('getCustomFieldsDictionary', () => {
    it('returns empty when no objectType', async () => {
      const result = await service.getCustomFieldsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
      expect(mock.history).toHaveLength(0)
    })

    it('uses custom_field_schema for custom_object type', async () => {
      mock.onGet(`${ API_BASE }/custom_field_schema/cot_abc/`).reply({
        data: [{ id: 'cf_1', name: 'Rating', type: 'number' }],
      })

      const result = await service.getCustomFieldsDictionary({
        criteria: { objectType: 'custom_object', customObjectTypeId: 'cot_abc' },
      })

      expect(result.items).toEqual([
        { label: 'Rating', value: 'cf_1', note: 'number' },
      ])
    })

    it('uses custom_field endpoint for standard types', async () => {
      mock.onGet(`${ API_BASE }/custom_field/lead/`).reply({
        data: [{ id: 'cf_2', name: 'Industry', type: 'text' }],
      })

      const result = await service.getCustomFieldsDictionary({ criteria: { objectType: 'lead' } })

      expect(result.items[0].label).toBe('Industry')
    })
  })

  describe('getTasksDictionary', () => {
    it('passes is_complete=false and lead filter', async () => {
      mock.onGet(`${ API_BASE }/task/`).reply({ data: [] })

      await service.getTasksDictionary({ criteria: { leadId: 'lead_x' } })

      expect(mock.history[0].query).toMatchObject({
        is_complete: false,
        lead_id: 'lead_x',
      })
    })
  })

  // ── Leads ──

  describe('listLeads', () => {
    it('sends correct request with defaults', async () => {
      mock.onGet(`${ API_BASE }/lead/`).reply({ data: [], has_more: false, total_results: 0 })

      const result = await service.listLeads()

      expect(result).toEqual({ data: [], has_more: false, total_results: 0 })
      expect(mock.history[0].headers).toMatchObject({ Authorization: `Bearer ${ OAUTH_TOKEN }` })
      expect(mock.history[0].query).toMatchObject({ _limit: 100, _skip: 0 })
    })

    it('passes query and fields parameters', async () => {
      mock.onGet(`${ API_BASE }/lead/`).reply({ data: [], has_more: false })

      await service.listLeads('status_label:"Qualified"', ['id', 'display_name'], 50, 10)

      expect(mock.history[0].query).toMatchObject({
        query: 'status_label:"Qualified"',
        _fields: 'id,display_name',
        _limit: 50,
        _skip: 10,
      })
    })

    it('fetches all pages when fetchAll is true', async () => {
      mock.onGet(`${ API_BASE }/lead/`).reply({ data: [{ id: 'lead_1' }], has_more: false, total_results: 1 })

      const result = await service.listLeads(null, null, null, null, true, 5)

      expect(result.has_more).toBe(false)
    })
  })

  describe('getLead', () => {
    it('fetches a single lead by ID', async () => {
      mock.onGet(`${ API_BASE }/lead/lead_abc/`).reply({ id: 'lead_abc', display_name: 'Acme' })

      const result = await service.getLead('lead_abc')

      expect(result).toMatchObject({ id: 'lead_abc', display_name: 'Acme' })
    })

    it('passes fields parameter', async () => {
      mock.onGet(`${ API_BASE }/lead/lead_abc/`).reply({ id: 'lead_abc' })

      await service.getLead('lead_abc', ['id', 'display_name'])

      expect(mock.history[0].query).toMatchObject({ _fields: 'id,display_name' })
    })
  })

  describe('createLead', () => {
    it('sends POST with correct body', async () => {
      mock.onPost(`${ API_BASE }/lead/`).reply({ id: 'lead_new', display_name: 'Acme' })

      const result = await service.createLead('Acme', 'Great company', 'https://acme.com', 'stat_1')

      expect(result).toMatchObject({ id: 'lead_new' })

      expect(mock.history[0].body).toMatchObject({
        name: 'Acme',
        description: 'Great company',
        url: 'https://acme.com',
        status_id: 'stat_1',
      })
    })

    it('expands custom fields with custom. prefix', async () => {
      mock.onPost(`${ API_BASE }/lead/`).reply({ id: 'lead_new' })

      await service.createLead('Test', null, null, null, null, null, { cf_industry: 'Tech' })

      expect(mock.history[0].body).toMatchObject({ 'custom.cf_industry': 'Tech' })
    })
  })

  describe('updateLead', () => {
    it('sends PUT with correct body', async () => {
      mock.onPut(`${ API_BASE }/lead/lead_abc/`).reply({ id: 'lead_abc' })

      await service.updateLead('lead_abc', 'New Name', null, null, 'stat_q', 'Qualified')

      expect(mock.history[0].body).toMatchObject({
        name: 'New Name',
        status_id: 'stat_q',
        status_label: 'Qualified',
      })
    })
  })

  describe('deleteLead', () => {
    it('sends DELETE and returns confirmation', async () => {
      mock.onDelete(`${ API_BASE }/lead/lead_abc/`).reply({})

      const result = await service.deleteLead('lead_abc')

      expect(result).toEqual({ status: 'deleted', id: 'lead_abc' })
    })
  })

  describe('mergeLeads', () => {
    it('sends POST with source and destination', async () => {
      mock.onPost(`${ API_BASE }/lead/merge/`).reply({ status: 'merged', destination: 'lead_dst' })

      const result = await service.mergeLeads('lead_src', 'lead_dst')

      expect(mock.history[0].body).toEqual({ source: 'lead_src', destination: 'lead_dst' })
      expect(result).toMatchObject({ status: 'merged' })
    })
  })

  describe('findLeadByEmail', () => {
    it('searches by email and returns first result', async () => {
      mock.onGet(`${ API_BASE }/lead/`).reply({ data: [{ id: 'lead_1', display_name: 'Acme' }] })

      const result = await service.findLeadByEmail('jane@acme.com')

      expect(mock.history[0].query).toMatchObject({ query: 'email:jane@acme.com', _limit: 1 })
      expect(result).toMatchObject({ id: 'lead_1' })
    })

    it('returns null when no match', async () => {
      mock.onGet(`${ API_BASE }/lead/`).reply({ data: [] })

      const result = await service.findLeadByEmail('nobody@example.com')

      expect(result).toBeNull()
    })
  })

  describe('findLeadByPhone', () => {
    it('searches by phone and returns first result', async () => {
      mock.onGet(`${ API_BASE }/lead/`).reply({ data: [{ id: 'lead_1' }] })

      const result = await service.findLeadByPhone('+15551234567')

      expect(mock.history[0].query).toMatchObject({ query: 'phone:+15551234567', _limit: 1 })
      expect(result).toMatchObject({ id: 'lead_1' })
    })
  })

  // ── Contacts ──

  describe('listContacts', () => {
    it('sends correct request with lead filter', async () => {
      mock.onGet(`${ API_BASE }/contact/`).reply({ data: [], has_more: false })

      await service.listContacts('lead_1', null, 50, 10)

      expect(mock.history[0].query).toMatchObject({
        lead_id: 'lead_1',
        _limit: 50,
        _skip: 10,
      })
    })
  })

  describe('getContact', () => {
    it('fetches a single contact', async () => {
      mock.onGet(`${ API_BASE }/contact/cont_abc/`).reply({ id: 'cont_abc', name: 'Jane' })

      const result = await service.getContact('cont_abc')

      expect(result).toMatchObject({ id: 'cont_abc', name: 'Jane' })
    })
  })

  describe('createContact', () => {
    it('sends POST with correct body', async () => {
      mock.onPost(`${ API_BASE }/contact/`).reply({ id: 'cont_new', name: 'Jane' })

      const result = await service.createContact(
        'lead_1', 'Jane Doe', 'VP Sales',
        [{ email: 'jane@acme.com', type: 'office' }],
        [{ phone: '+1555', type: 'mobile' }],
        [{ url: 'https://linkedin.com', type: 'url' }]
      )

      expect(mock.history[0].body).toMatchObject({
        lead_id: 'lead_1',
        name: 'Jane Doe',
        title: 'VP Sales',
        emails: [{ email: 'jane@acme.com', type: 'office' }],
      })
    })

    it('throws when leadId is missing', async () => {
      await expect(service.createContact(null, 'Jane')).rejects.toThrow('Lead is required')
    })

    it('throws when name is missing', async () => {
      await expect(service.createContact('lead_1')).rejects.toThrow('Name is required')
    })
  })

  describe('updateContact', () => {
    it('sends PUT with updated fields', async () => {
      mock.onPut(`${ API_BASE }/contact/cont_abc/`).reply({ id: 'cont_abc' })

      await service.updateContact('cont_abc', 'Jane Updated', 'CTO')

      expect(mock.history[0].body).toMatchObject({ name: 'Jane Updated', title: 'CTO' })
    })
  })

  describe('deleteContact', () => {
    it('sends DELETE and returns confirmation', async () => {
      mock.onDelete(`${ API_BASE }/contact/cont_abc/`).reply({})

      const result = await service.deleteContact('cont_abc')

      expect(result).toEqual({ status: 'deleted', id: 'cont_abc' })
    })
  })

  // ── Opportunities ──

  describe('listOpportunities', () => {
    it('sends correct request with filters', async () => {
      mock.onGet(`${ API_BASE }/opportunity/`).reply({ data: [], has_more: false })

      await service.listOpportunities('lead_1', 'pipe_1', 'stat_1', 'Active', 50, 0)

      expect(mock.history[0].query).toMatchObject({
        lead_id: 'lead_1',
        pipeline_id: 'pipe_1',
        status_id: 'stat_1',
        status_type: 'active',
        _limit: 50,
      })
    })
  })

  describe('getOpportunity', () => {
    it('fetches a single opportunity', async () => {
      mock.onGet(`${ API_BASE }/opportunity/oppo_abc/`).reply({ id: 'oppo_abc', value: 5000 })

      const result = await service.getOpportunity('oppo_abc')

      expect(result).toMatchObject({ id: 'oppo_abc', value: 5000 })
    })
  })

  describe('createOpportunity', () => {
    it('sends POST with correct body including choice mappings', async () => {
      mock.onPost(`${ API_BASE }/opportunity/`).reply({ id: 'oppo_new' })

      await service.createOpportunity('lead_1', 'stat_1', 500000, 'USD', 'Monthly', 80, 'Big deal', '2025-06-01')

      expect(mock.history[0].body).toMatchObject({
        lead_id: 'lead_1',
        status_id: 'stat_1',
        value: 500000,
        value_currency: 'USD',
        value_period: 'monthly',
        confidence: 80,
        note: 'Big deal',
        date_won: '2025-06-01',
      })
    })

    it('throws when leadId is missing', async () => {
      await expect(service.createOpportunity(null, 'stat_1')).rejects.toThrow('Lead is required')
    })
  })

  describe('updateOpportunity', () => {
    it('sends PUT with updated fields', async () => {
      mock.onPut(`${ API_BASE }/opportunity/oppo_abc/`).reply({ id: 'oppo_abc' })

      await service.updateOpportunity('oppo_abc', 'stat_won', 750000, null, 'Annual')

      expect(mock.history[0].body).toMatchObject({
        status_id: 'stat_won',
        value: 750000,
        value_period: 'annual',
      })
    })
  })

  describe('deleteOpportunity', () => {
    it('sends DELETE and returns confirmation', async () => {
      mock.onDelete(`${ API_BASE }/opportunity/oppo_abc/`).reply({})

      const result = await service.deleteOpportunity('oppo_abc')

      expect(result).toEqual({ status: 'deleted', id: 'oppo_abc' })
    })
  })

  // ── Notes ──

  describe('listNotes', () => {
    it('sends correct request', async () => {
      mock.onGet(`${ API_BASE }/activity/note/`).reply({ data: [], has_more: false })

      await service.listNotes('lead_1', 50, 10)

      expect(mock.history[0].query).toMatchObject({ lead_id: 'lead_1', _limit: 50, _skip: 10 })
    })
  })

  describe('createNote', () => {
    it('sends POST with lead and note', async () => {
      mock.onPost(`${ API_BASE }/activity/note/`).reply({ id: 'acti_1', note: 'Hello' })

      const result = await service.createNote('lead_1', 'Hello')

      expect(mock.history[0].body).toEqual({ lead_id: 'lead_1', note: 'Hello' })
      expect(result).toMatchObject({ id: 'acti_1' })
    })

    it('throws when leadId is missing', async () => {
      await expect(service.createNote(null, 'Hello')).rejects.toThrow('Lead is required')
    })
  })

  describe('updateNote', () => {
    it('sends PUT with new note text', async () => {
      mock.onPut(`${ API_BASE }/activity/note/acti_1/`).reply({ id: 'acti_1', note: 'Updated' })

      await service.updateNote('acti_1', 'Updated')

      expect(mock.history[0].body).toEqual({ note: 'Updated' })
    })
  })

  describe('deleteNote', () => {
    it('sends DELETE and returns confirmation', async () => {
      mock.onDelete(`${ API_BASE }/activity/note/acti_1/`).reply({})

      const result = await service.deleteNote('acti_1')

      expect(result).toEqual({ status: 'deleted', id: 'acti_1' })
    })
  })

  // ── Calls ──

  describe('listCalls', () => {
    it('sends correct request with direction mapping', async () => {
      mock.onGet(`${ API_BASE }/activity/call/`).reply({ data: [], has_more: false })

      await service.listCalls('lead_1', 'Outbound', 50, 0)

      expect(mock.history[0].query).toMatchObject({
        lead_id: 'lead_1',
        direction: 'outbound',
        _limit: 50,
      })
    })
  })

  describe('logCall', () => {
    it('sends POST with correct body', async () => {
      mock.onPost(`${ API_BASE }/activity/call/`).reply({ id: 'acti_call_1' })

      await service.logCall('lead_1', 'cont_1', 'Outbound', 120, '+1555', 'Good call', 'https://rec.url')

      expect(mock.history[0].body).toMatchObject({
        lead_id: 'lead_1',
        contact_id: 'cont_1',
        direction: 'outbound',
        duration: 120,
        phone: '+1555',
        note: 'Good call',
        recording_url: 'https://rec.url',
      })
    })

    it('throws when leadId is missing', async () => {
      await expect(service.logCall(null)).rejects.toThrow('Lead is required')
    })
  })

  describe('updateCall', () => {
    it('sends PUT with updated fields', async () => {
      mock.onPut(`${ API_BASE }/activity/call/call_1/`).reply({ id: 'call_1' })

      await service.updateCall('call_1', 'New note', 180, 'https://new-rec.url')

      expect(mock.history[0].body).toMatchObject({
        note: 'New note',
        duration: 180,
        recording_url: 'https://new-rec.url',
      })
    })
  })

  describe('deleteCall', () => {
    it('sends DELETE and returns confirmation', async () => {
      mock.onDelete(`${ API_BASE }/activity/call/call_1/`).reply({})

      const result = await service.deleteCall('call_1')

      expect(result).toEqual({ status: 'deleted', id: 'call_1' })
    })
  })

  // ── Emails ──

  describe('listEmails', () => {
    it('sends correct request', async () => {
      mock.onGet(`${ API_BASE }/activity/email/`).reply({ data: [], has_more: false })

      await service.listEmails('lead_1', 25, 0)

      expect(mock.history[0].query).toMatchObject({ lead_id: 'lead_1', _limit: 25, _skip: 0 })
    })
  })

  describe('sendEmail', () => {
    it('sends POST with correct body for outbox status', async () => {
      mock.onPost(`${ API_BASE }/activity/email/`).reply({ id: 'acti_email_1' })

      await service.sendEmail(
        'lead_1', 'emailacct_1', 'Send Now (Outbox)', 'cont_1',
        ['jane@acme.com'], ['cc@acme.com'], ['bcc@acme.com'],
        'Hello', 'Plain text', '<h1>HTML</h1>', null, null
      )

      expect(mock.history[0].body).toMatchObject({
        lead_id: 'lead_1',
        email_account_id: 'emailacct_1',
        status: 'outbox',
        to: ['jane@acme.com'],
        cc: ['cc@acme.com'],
        bcc: ['bcc@acme.com'],
        subject: 'Hello',
        body_text: 'Plain text',
        body_html: '<h1>HTML</h1>',
      })
    })

    it('uses default email account when none provided', async () => {
      mock.onPost(`${ API_BASE }/activity/email/`).reply({ id: 'acti_email_1' })

      await service.sendEmail(
        'lead_1', null, 'Send Now (Outbox)', null,
        ['jane@acme.com'], null, null, 'Test', 'Body'
      )

      expect(mock.history[0].body).toMatchObject({ email_account_id: 'emailacct_default' })
    })

    it('throws when leadId is missing', async () => {
      await expect(service.sendEmail(null, null, 'Send Now (Outbox)', null, ['x@x.com'], null, null, 'S'))
        .rejects.toThrow('Lead is required')
    })

    it('throws when outbox status with no account and no default', async () => {
      // Temporarily clear the defaultEmailAccountId
      const original = service.defaultEmailAccountId
      service.defaultEmailAccountId = null

      await expect(service.sendEmail(
        'lead_1', null, 'Send Now (Outbox)', null, ['x@x.com'], null, null, 'S'
      )).rejects.toThrow('Email Account is required')

      service.defaultEmailAccountId = original
    })

    it('throws when scheduled status without date', async () => {
      await expect(service.sendEmail(
        'lead_1', 'emailacct_1', 'Schedule for Later', null, ['x@x.com'], null, null, 'S', null, null, null, null
      )).rejects.toThrow('Schedule For is required')
    })
  })

  describe('deleteEmail', () => {
    it('sends DELETE and returns confirmation', async () => {
      mock.onDelete(`${ API_BASE }/activity/email/email_1/`).reply({})

      const result = await service.deleteEmail('email_1')

      expect(result).toEqual({ status: 'deleted', id: 'email_1' })
    })
  })

  // ── SMS ──

  describe('listSMS', () => {
    it('sends correct request', async () => {
      mock.onGet(`${ API_BASE }/activity/sms/`).reply({ data: [], has_more: false })

      await service.listSMS('lead_1', 25, 0)

      expect(mock.history[0].query).toMatchObject({ lead_id: 'lead_1', _limit: 25 })
    })
  })

  describe('sendSMS', () => {
    it('sends POST with correct body', async () => {
      mock.onPost(`${ API_BASE }/activity/sms/`).reply({ id: 'acti_sms_1' })

      await service.sendSMS('lead_1', 'Send Now (Outbox)', 'cont_1', '+15550001111', '+15559998888', 'Hello')

      expect(mock.history[0].body).toMatchObject({
        lead_id: 'lead_1',
        status: 'outbox',
        contact_id: 'cont_1',
        local_phone: '+15550001111',
        remote_phone: '+15559998888',
        text: 'Hello',
      })
    })
  })

  describe('deleteSMS', () => {
    it('sends DELETE and returns confirmation', async () => {
      mock.onDelete(`${ API_BASE }/activity/sms/sms_1/`).reply({})

      const result = await service.deleteSMS('sms_1')

      expect(result).toEqual({ status: 'deleted', id: 'sms_1' })
    })
  })

  // ── Meetings ──

  describe('listMeetings', () => {
    it('sends correct request', async () => {
      mock.onGet(`${ API_BASE }/activity/meeting/`).reply({ data: [], has_more: false })

      await service.listMeetings('lead_1', 25, 0)

      expect(mock.history[0].query).toMatchObject({ lead_id: 'lead_1', _limit: 25 })
    })
  })

  describe('getMeeting', () => {
    it('fetches a single meeting', async () => {
      mock.onGet(`${ API_BASE }/activity/meeting/meet_1/`).reply({ id: 'meet_1', title: 'Demo' })

      const result = await service.getMeeting('meet_1')

      expect(result).toMatchObject({ id: 'meet_1', title: 'Demo' })
    })
  })

  // ── Tasks ──

  describe('listTasks', () => {
    it('sends correct request with all filters', async () => {
      mock.onGet(`${ API_BASE }/task/`).reply({ data: [], has_more: false })

      await service.listTasks('lead_1', 'user_1', true, 'Lead', '2025-01-01', '2025-12-31', 50, 0)

      expect(mock.history[0].query).toMatchObject({
        lead_id: 'lead_1',
        assigned_to: 'user_1',
        is_complete: true,
        _type: 'lead',
        date_after: '2025-01-01',
        date_before: '2025-12-31',
        _limit: 50,
      })
    })
  })

  describe('createTask', () => {
    it('sends POST with correct body', async () => {
      mock.onPost(`${ API_BASE }/task/`).reply({ id: 'task_1' })

      await service.createTask('lead_1', 'Follow up', 'user_1', '2025-06-01')

      expect(mock.history[0].body).toMatchObject({
        lead_id: 'lead_1',
        text: 'Follow up',
        assigned_to: 'user_1',
        date: '2025-06-01',
        _type: 'lead',
      })
    })

    it('throws when leadId is missing', async () => {
      await expect(service.createTask(null, 'Follow up')).rejects.toThrow('Lead is required')
    })

    it('throws when text is missing', async () => {
      await expect(service.createTask('lead_1')).rejects.toThrow('Task Text is required')
    })
  })

  describe('updateTask', () => {
    it('sends PUT with updated fields', async () => {
      mock.onPut(`${ API_BASE }/task/task_1/`).reply({ id: 'task_1' })

      await service.updateTask('task_1', 'Updated text', 'user_2', '2025-07-01', true)

      expect(mock.history[0].body).toMatchObject({
        text: 'Updated text',
        assigned_to: 'user_2',
        date: '2025-07-01',
        is_complete: true,
      })
    })
  })

  describe('completeTask', () => {
    it('sends PUT with is_complete=true', async () => {
      mock.onPut(`${ API_BASE }/task/task_1/`).reply({ id: 'task_1', is_complete: true })

      const result = await service.completeTask('task_1')

      expect(mock.history[0].body).toEqual({ is_complete: true })
      expect(result).toMatchObject({ is_complete: true })
    })
  })

  describe('deleteTask', () => {
    it('sends DELETE and returns confirmation', async () => {
      mock.onDelete(`${ API_BASE }/task/task_1/`).reply({})

      const result = await service.deleteTask('task_1')

      expect(result).toEqual({ status: 'deleted', id: 'task_1' })
    })
  })

  // ── Activity Feed ──

  describe('listActivities', () => {
    it('sends correct request with type mapping', async () => {
      mock.onGet(`${ API_BASE }/activity/`).reply({ data: [], has_more: false })

      await service.listActivities('lead_1', 'Note', '2025-01-01', '2025-12-31', 50, 0)

      expect(mock.history[0].query).toMatchObject({
        lead_id: 'lead_1',
        _type: 'note',
        date_created__gte: '2025-01-01',
        date_created__lte: '2025-12-31',
        _limit: 50,
      })
    })
  })

  // ── Configuration ──

  describe('listPipelines', () => {
    it('fetches pipelines', async () => {
      mock.onGet(`${ API_BASE }/pipeline/`).reply({ data: [{ id: 'pipe_1' }] })

      const result = await service.listPipelines()

      expect(result.data).toHaveLength(1)
    })
  })

  describe('listLeadStatuses', () => {
    it('fetches lead statuses', async () => {
      mock.onGet(`${ API_BASE }/status/lead/`).reply({ data: [{ id: 'stat_1' }] })

      const result = await service.listLeadStatuses()

      expect(result.data).toHaveLength(1)
    })
  })

  describe('listOpportunityStatuses', () => {
    it('fetches opportunity statuses', async () => {
      mock.onGet(`${ API_BASE }/status/opportunity/`).reply({ data: [{ id: 'stat_o1' }] })

      const result = await service.listOpportunityStatuses()

      expect(result.data).toHaveLength(1)
    })
  })

  describe('listCustomFields', () => {
    it('resolves choice mapping and fetches fields', async () => {
      mock.onGet(`${ API_BASE }/custom_field/contact/`).reply({ data: [{ id: 'cf_1' }] })

      const result = await service.listCustomFields('Contact')

      expect(result.data).toHaveLength(1)
      expect(mock.history[0].url).toBe(`${ API_BASE }/custom_field/contact/`)
    })
  })

  describe('listCustomObjectTypes', () => {
    it('fetches custom object types', async () => {
      mock.onGet(`${ API_BASE }/custom_object_type/`).reply({ data: [{ id: 'cot_1' }] })

      const result = await service.listCustomObjectTypes()

      expect(result.data).toHaveLength(1)
    })
  })

  describe('getMe', () => {
    it('fetches current user info', async () => {
      mock.onGet(`${ API_BASE }/me/`).reply({ id: 'user_1', email: 'alex@acme.com' })

      const result = await service.getMe()

      expect(result).toMatchObject({ id: 'user_1', email: 'alex@acme.com' })
    })
  })

  describe('listUsers', () => {
    it('fetches users', async () => {
      mock.onGet(`${ API_BASE }/user/`).reply({ data: [{ id: 'user_1' }] })

      const result = await service.listUsers()

      expect(result.data).toHaveLength(1)
    })
  })

  // ── Search ──

  describe('runAdvancedSearch', () => {
    it('sends POST to search endpoint with resolved object type', async () => {
      mock.onPost(`${ API_BASE }/data/search/`).reply({ data: [{ id: 'lead_1' }], cursor: null })

      const result = await service.runAdvancedSearch('Lead', null, null, 50)

      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ API_BASE }/data/search/`)
      expect(mock.history[0].body).toMatchObject({ _limit: 50 })
      expect(result.data).toHaveLength(1)
    })
  })

  describe('runSmartView', () => {
    it('sends POST with smart view query', async () => {
      mock.onPost(`${ API_BASE }/data/search/`).reply({ data: [{ id: 'lead_1' }], cursor: null })

      const result = await service.runSmartView('save_abc', 50)

      expect(mock.history[0].method).toBe('post')
      expect(result.data).toHaveLength(1)
    })
  })

  // ── Sequences ──

  describe('listSequences', () => {
    it('fetches sequences', async () => {
      mock.onGet(`${ API_BASE }/sequence/`).reply({ data: [{ id: 'seq_1' }] })

      const result = await service.listSequences()

      expect(result.data).toHaveLength(1)
    })
  })

  describe('subscribeToSequence', () => {
    it('resolves sender defaults and sends POST', async () => {
      mock.onGet(`${ API_BASE }/connected_account/emailacct_1/`).reply({ email: 'alex@acme.com' })
      mock.onGet(`${ API_BASE }/me/`).reply({ display_name: 'Alex Doe' })
      mock.onPost(`${ API_BASE }/sequence_subscription/`).reply({ id: 'sub_1', status: 'active' })

      const result = await service.subscribeToSequence(
        'seq_1', 'cont_1', 'emailacct_1', 'jane@acme.com'
      )

      expect(result).toMatchObject({ id: 'sub_1', status: 'active' })
      // The POST should contain resolved sender info
      const postCall = mock.history.find(h => h.method === 'post')

      expect(postCall.body).toMatchObject({
        sequence_id: 'seq_1',
        contact_id: 'cont_1',
        sender_account_id: 'emailacct_1',
        sender_email: 'alex@acme.com',
        sender_name: 'Alex Doe',
        contact_email: 'jane@acme.com',
      })
    })

    it('throws when senderAccountId is missing', async () => {
      await expect(service.subscribeToSequence('seq_1', 'cont_1', null, 'jane@acme.com'))
        .rejects.toThrow('Sender Email Account is required')
    })

    it('throws when contactEmail is missing', async () => {
      await expect(service.subscribeToSequence('seq_1', 'cont_1', 'emailacct_1'))
        .rejects.toThrow('Contact Email is required')
    })
  })

  describe('pauseSequenceSubscription', () => {
    it('sends PUT with paused status', async () => {
      mock.onPut(`${ API_BASE }/sequence_subscription/sub_1/`).reply({ id: 'sub_1', status: 'paused' })

      const result = await service.pauseSequenceSubscription(null, 'sub_1')

      expect(mock.history[0].body).toEqual({ status: 'paused' })
      expect(result).toMatchObject({ status: 'paused' })
    })
  })

  describe('resumeSequenceSubscription', () => {
    it('sends PUT with active status', async () => {
      mock.onPut(`${ API_BASE }/sequence_subscription/sub_1/`).reply({ id: 'sub_1', status: 'active' })

      const result = await service.resumeSequenceSubscription(null, 'sub_1')

      expect(mock.history[0].body).toEqual({ status: 'active' })
      expect(result).toMatchObject({ status: 'active' })
    })
  })

  // ── Webhooks ──

  describe('listWebhooks', () => {
    it('fetches webhooks', async () => {
      mock.onGet(`${ API_BASE }/webhook/`).reply({ data: [{ id: 'whsub_1' }] })

      const result = await service.listWebhooks()

      expect(result.data).toHaveLength(1)
    })
  })

  describe('createWebhook', () => {
    it('sends POST with correct body', async () => {
      mock.onPost(`${ API_BASE }/webhook/`).reply({ id: 'whsub_new', signature_key: 'key123' })

      const result = await service.createWebhook(
        'https://example.com/hook',
        [{ object_type: 'lead', action: '*' }],
        true
      )

      expect(mock.history[0].body).toMatchObject({
        url: 'https://example.com/hook',
        events: [{ object_type: 'lead', action: '*' }],
        verify_ssl: true,
      })

      expect(result).toMatchObject({ id: 'whsub_new', signature_key: 'key123' })
    })
  })

  describe('updateWebhook', () => {
    it('sends PUT with status mapping', async () => {
      mock.onPut(`${ API_BASE }/webhook/whsub_1/`).reply({ id: 'whsub_1', status: 'paused' })

      await service.updateWebhook('whsub_1', 'Paused')

      expect(mock.history[0].body).toMatchObject({ status: 'paused' })
    })
  })

  describe('deleteWebhook', () => {
    it('sends DELETE and returns confirmation', async () => {
      mock.onDelete(`${ API_BASE }/webhook/whsub_1/`).reply({})

      const result = await service.deleteWebhook('whsub_1')

      expect(result).toEqual({ status: 'deleted', id: 'whsub_1' })
    })
  })

  // ── Events ──

  describe('listEvents', () => {
    it('sends correct request with filters', async () => {
      mock.onGet(`${ API_BASE }/event/`).reply({ data: [], cursor: null })

      await service.listEvents('lead', 'updated', 'cursor_abc', 25)

      expect(mock.history[0].query).toMatchObject({
        object_type: 'lead',
        action: 'updated',
        _cursor: 'cursor_abc',
        _limit: 25,
      })
    })
  })

  // ── Bulk Actions ──

  describe('getBulkActionStatus', () => {
    it('resolves kind and fetches status', async () => {
      mock.onGet(`${ API_BASE }/bulk_action/edit/bulkact_1/`).reply({ id: 'bulkact_1', status: 'complete' })

      const result = await service.getBulkActionStatus('Edit', 'bulkact_1')

      expect(result).toMatchObject({ id: 'bulkact_1', status: 'complete' })
    })
  })

  // ── Trigger System Handlers ──

  describe('handleTriggerUpsertWebhook', () => {
    it('creates a new webhook when no existing webhookData', async () => {
      mock.onPost(`${ API_BASE }/webhook/`).reply({ id: 'whsub_new', signature_key: 'sig_key' })

      const result = await service.handleTriggerUpsertWebhook({
        events: [{ name: 'onLeadCreated' }],
        callbackUrl: 'https://callback.example.com',
      })

      expect(result.webhookData).toMatchObject({
        id: 'whsub_new',
        signatureKey: 'sig_key',
      })

      expect(mock.history[0].body).toMatchObject({
        url: 'https://callback.example.com',
        events: [{ object_type: 'lead', action: 'created' }],
        verify_ssl: true,
      })
    })

    it('updates existing webhook when webhookData.id is present', async () => {
      mock.onPut(`${ API_BASE }/webhook/whsub_existing/`).reply({ id: 'whsub_existing' })

      const result = await service.handleTriggerUpsertWebhook({
        events: [{ name: 'onLeadCreated' }, { name: 'onLeadUpdated' }],
        webhookData: { id: 'whsub_existing', signatureKey: 'old_key' },
      })

      expect(result.webhookData).toMatchObject({
        id: 'whsub_existing',
        signatureKey: 'old_key',
      })

      expect(mock.history[0].body.events).toEqual(
        expect.arrayContaining([
          { object_type: 'lead', action: 'created' },
          { object_type: 'lead', action: 'updated' },
        ])
      )
    })

    it('returns existing webhookData when no events to subscribe', async () => {
      const result = await service.handleTriggerUpsertWebhook({
        events: [],
        webhookData: { id: 'whsub_x' },
      })

      expect(result.webhookData).toEqual({ id: 'whsub_x' })
      expect(mock.history).toHaveLength(0)
    })
  })

  describe('handleTriggerDeleteWebhook', () => {
    it('deletes webhook by ID from webhookData', async () => {
      mock.onDelete(`${ API_BASE }/webhook/whsub_1/`).reply({})

      await service.handleTriggerDeleteWebhook({ webhookData: { id: 'whsub_1' } })

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('delete')
    })

    it('does nothing when no webhookData id', async () => {
      await service.handleTriggerDeleteWebhook({ webhookData: {} })

      expect(mock.history).toHaveLength(0)
    })
  })

  describe('handleTriggerSelectMatched', () => {
    it('returns all trigger IDs when no custom filter method', async () => {
      const result = await service.handleTriggerSelectMatched({
        eventName: 'nonexistentMethod',
        triggers: [{ id: 't1' }, { id: 't2' }],
      })

      expect(result.ids).toEqual(['t1', 't2'])
    })
  })

  // ── Trigger Methods ──

  describe('onLeadCreated', () => {
    it('shapes event when callType is SHAPE_EVENT', () => {
      const result = service.onLeadCreated('SHAPE_EVENT', {
        object_type: 'lead',
        action: 'created',
        object_id: 'lead_1',
      })

      expect(result).toEqual([{
        name: 'onLeadCreated',
        data: { object_type: 'lead', action: 'created', object_id: 'lead_1' },
      }])
    })

    it('filters triggers when callType is FILTER_TRIGGER', () => {
      const result = service.onLeadCreated('FILTER_TRIGGER', {
        triggers: [
          { id: 't1', data: { statusId: 'stat_q' } },
          { id: 't2', data: {} },
        ],
        eventData: { data: { status_id: 'stat_q' } },
      })

      expect(result.ids).toEqual(['t1', 't2'])
    })

    it('filters out triggers that do not match status', () => {
      const result = service.onLeadCreated('FILTER_TRIGGER', {
        triggers: [
          { id: 't1', data: { statusId: 'stat_q' } },
          { id: 't2', data: { statusId: 'stat_p' } },
        ],
        eventData: { data: { status_id: 'stat_q' } },
      })

      expect(result.ids).toEqual(['t1'])
    })
  })

  describe('onLeadDeleted', () => {
    it('shapes event', () => {
      const result = service.onLeadDeleted('SHAPE_EVENT', { object_type: 'lead', action: 'deleted' })

      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('onLeadDeleted')
    })

    it('matches all triggers (no custom filter)', () => {
      const result = service.onLeadDeleted('FILTER_TRIGGER', {
        triggers: [{ id: 't1' }, { id: 't2' }],
        eventData: {},
      })

      expect(result.ids).toEqual(['t1', 't2'])
    })
  })

  describe('onOpportunityStatusChanged', () => {
    it('filters by statusId', () => {
      const result = service.onOpportunityStatusChanged('FILTER_TRIGGER', {
        triggers: [
          { id: 't1', data: { statusId: 'stat_won' } },
          { id: 't2', data: { statusId: 'stat_lost' } },
        ],
        eventData: { data: { status_id: 'stat_won', status_type: 'won' } },
      })

      expect(result.ids).toEqual(['t1'])
    })

    it('filters by statusType', () => {
      const result = service.onOpportunityStatusChanged('FILTER_TRIGGER', {
        triggers: [
          { id: 't1', data: { statusType: 'Won' } },
          { id: 't2', data: { statusType: 'Lost' } },
        ],
        eventData: { data: { status_type: 'won' } },
      })

      expect(result.ids).toEqual(['t1'])
    })
  })

  describe('onTaskCreated', () => {
    it('filters by assignedToId', () => {
      const result = service.onTaskCreated('FILTER_TRIGGER', {
        triggers: [
          { id: 't1', data: { assignedToId: 'user_1' } },
          { id: 't2', data: { assignedToId: 'user_2' } },
          { id: 't3', data: {} },
        ],
        eventData: { data: { assigned_to: 'user_1' } },
      })

      expect(result.ids).toEqual(['t1', 't3'])
    })
  })

  describe('onCallCompleted', () => {
    it('filters by direction', () => {
      const result = service.onCallCompleted('FILTER_TRIGGER', {
        triggers: [
          { id: 't1', data: { direction: 'Outbound' } },
          { id: 't2', data: { direction: 'Inbound' } },
          { id: 't3', data: {} },
        ],
        eventData: { data: { direction: 'outbound' } },
      })

      expect(result.ids).toEqual(['t1', 't3'])
    })
  })

  describe('onCustomActivityCreated', () => {
    it('filters by customActivityTypeId', () => {
      const result = service.onCustomActivityCreated('FILTER_TRIGGER', {
        triggers: [
          { id: 't1', data: { customActivityTypeId: 'actitype_1' } },
          { id: 't2', data: { customActivityTypeId: 'actitype_2' } },
          { id: 't3', data: {} },
        ],
        eventData: { data: { custom_activity_type_id: 'actitype_1' } },
      })

      expect(result.ids).toEqual(['t1', 't3'])
    })
  })


  // ── Additional Dictionaries ──

  describe('getOpportunitiesDictionary', () => {
    it('returns formatted opportunity items', async () => {
      mock.onGet(`${ API_BASE }/opportunity/`).reply({
        data: [
          { id: 'oppo_1', value_formatted: '$5,000', note: 'Annual Plan', status_label: 'Active' },
          { id: 'oppo_2', value: 1000, status_label: 'Won' },
        ],
        has_more: false,
      })

      const result = await service.getOpportunitiesDictionary({})

      expect(result.items).toEqual([
        { label: '$5,000 — Annual Plan', value: 'oppo_1', note: 'Status: Active' },
        { label: '$1000', value: 'oppo_2', note: 'Status: Won' },
      ])

      expect(result.cursor).toBeNull()
    })

    it('scopes to lead when criteria.leadId is provided', async () => {
      mock.onGet(`${ API_BASE }/opportunity/`).reply({ data: [], has_more: false })

      await service.getOpportunitiesDictionary({ criteria: { leadId: 'lead_1' } })

      expect(mock.history[0].query).toMatchObject({ lead_id: 'lead_1' })
    })

    it('returns pagination cursor when has_more', async () => {
      mock.onGet(`${ API_BASE }/opportunity/`).reply({
        data: [{ id: 'oppo_1', value_formatted: '$100', status_label: 'Active' }],
        has_more: true,
      })

      const result = await service.getOpportunitiesDictionary({})

      expect(result.cursor).toBe('1')
    })
  })

  describe('getSmartViewsDictionary', () => {
    it('returns formatted smart view items', async () => {
      mock.onGet(`${ API_BASE }/saved_search/`).reply({
        data: [
          { id: 'save_1', name: 'My Open Leads', is_shared: true },
          { id: 'save_2', name: 'Stale Deals', is_shared: false },
        ],
      })

      const result = await service.getSmartViewsDictionary({})

      expect(result.items).toEqual([
        { label: 'My Open Leads', value: 'save_1', note: 'shared' },
        { label: 'Stale Deals', value: 'save_2', note: undefined },
      ])

      expect(result.cursor).toBeNull()
    })

    it('filters by search', async () => {
      mock.onGet(`${ API_BASE }/saved_search/`).reply({
        data: [
          { id: 'save_1', name: 'My Open Leads', is_shared: false },
          { id: 'save_2', name: 'Stale Deals', is_shared: false },
        ],
      })

      const result = await service.getSmartViewsDictionary({ search: 'stale' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('save_2')
    })
  })

  describe('getSequencesDictionary', () => {
    it('returns formatted sequence items', async () => {
      mock.onGet(`${ API_BASE }/sequence/`).reply({
        data: [
          { id: 'seq_1', name: 'Cold Outreach v2', steps: [{ id: 1 }, { id: 2 }, { id: 3 }] },
          { id: 'seq_2', name: 'Follow Up' },
        ],
      })

      const result = await service.getSequencesDictionary({})

      expect(result.items).toEqual([
        { label: 'Cold Outreach v2', value: 'seq_1', note: '3 steps' },
        { label: 'Follow Up', value: 'seq_2', note: undefined },
      ])

      expect(result.cursor).toBeNull()
    })
  })

  describe('getCustomActivityTypesDictionary', () => {
    it('returns formatted custom activity type items', async () => {
      mock.onGet(`${ API_BASE }/custom_activity/`).reply({
        data: [{ id: 'actitype_1', name: 'Demo Booked' }],
      })

      const result = await service.getCustomActivityTypesDictionary({})

      expect(result.items).toEqual([
        { label: 'Demo Booked', value: 'actitype_1', note: 'id: actitype_1' },
      ])
    })
  })

  describe('getEmailAccountsDictionary', () => {
    it('returns formatted email account items', async () => {
      mock.onGet(`${ API_BASE }/connected_account/`).reply({
        data: [{ id: 'emailacct_1', email: 'alex@acme.com', account_type: 'gmail' }],
      })

      const result = await service.getEmailAccountsDictionary({})

      expect(result.items).toEqual([
        { label: 'alex@acme.com', value: 'emailacct_1', note: 'gmail' },
      ])
    })

    it('filters by search', async () => {
      mock.onGet(`${ API_BASE }/connected_account/`).reply({
        data: [
          { id: 'emailacct_1', email: 'alex@acme.com', account_type: 'gmail' },
          { id: 'emailacct_2', email: 'jane@acme.com', account_type: 'outlook' },
        ],
      })

      const result = await service.getEmailAccountsDictionary({ search: 'jane' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('emailacct_2')
    })
  })

  describe('getEmailTemplatesDictionary', () => {
    it('returns formatted email template items', async () => {
      mock.onGet(`${ API_BASE }/email_template/`).reply({
        data: [{ id: 'tmpl_1', name: 'Welcome' }],
      })

      const result = await service.getEmailTemplatesDictionary({})

      expect(result.items).toEqual([
        { label: 'Welcome', value: 'tmpl_1', note: 'id: tmpl_1' },
      ])
    })
  })

  describe('getWebhooksDictionary', () => {
    it('returns formatted webhook items', async () => {
      mock.onGet(`${ API_BASE }/webhook/`).reply({
        data: [{ id: 'whsub_1', url: 'https://example.com/hook', status: 'active' }],
      })

      const result = await service.getWebhooksDictionary({})

      expect(result.items).toEqual([
        { label: 'https://example.com/hook', value: 'whsub_1', note: 'active' },
      ])
    })

    it('filters by search', async () => {
      mock.onGet(`${ API_BASE }/webhook/`).reply({
        data: [
          { id: 'whsub_1', url: 'https://example.com/hook', status: 'active' },
          { id: 'whsub_2', url: 'https://other.com/hook', status: 'paused' },
        ],
      })

      const result = await service.getWebhooksDictionary({ search: 'other' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('whsub_2')
    })
  })

  describe('getNotesDictionary', () => {
    it('returns formatted note items with pagination', async () => {
      mock.onGet(`${ API_BASE }/activity/note/`).reply({
        data: [{ id: 'acti_1', note: 'Follow-up after demo', lead_id: 'lead_1' }],
        has_more: true,
      })

      const result = await service.getNotesDictionary({})

      expect(result.items).toEqual([
        { label: 'Follow-up after demo', value: 'acti_1', note: 'lead_1' },
      ])

      expect(result.cursor).toBe('1')
    })

    it('scopes to lead when criteria.leadId is provided', async () => {
      mock.onGet(`${ API_BASE }/activity/note/`).reply({ data: [], has_more: false })

      await service.getNotesDictionary({ criteria: { leadId: 'lead_1' } })

      expect(mock.history[0].query).toMatchObject({ lead_id: 'lead_1' })
    })
  })

  describe('getCallsDictionary', () => {
    it('returns formatted call items', async () => {
      mock.onGet(`${ API_BASE }/activity/call/`).reply({
        data: [{ id: 'acti_call_1', direction: 'outbound', phone: '+15551234567', duration: 120 }],
        has_more: false,
      })

      const result = await service.getCallsDictionary({})

      expect(result.items).toEqual([
        { label: 'Outbound — +15551234567', value: 'acti_call_1', note: '120s' },
      ])

      expect(result.cursor).toBeNull()
    })
  })

  describe('getEmailsDictionary', () => {
    it('returns formatted email items', async () => {
      mock.onGet(`${ API_BASE }/activity/email/`).reply({
        data: [{ id: 'acti_email_1', subject: 'Intro call follow-up', status: 'sent' }],
        has_more: false,
      })

      const result = await service.getEmailsDictionary({})

      expect(result.items).toEqual([
        { label: 'Intro call follow-up', value: 'acti_email_1', note: 'sent' },
      ])
    })

    it('uses fallback label when subject is missing', async () => {
      mock.onGet(`${ API_BASE }/activity/email/`).reply({
        data: [{ id: 'acti_email_2', status: 'draft' }],
        has_more: false,
      })

      const result = await service.getEmailsDictionary({})

      expect(result.items[0].label).toBe('(no subject)')
    })
  })

  describe('getSmsDictionary', () => {
    it('returns formatted SMS items', async () => {
      mock.onGet(`${ API_BASE }/activity/sms/`).reply({
        data: [{ id: 'acti_sms_1', text: 'Thanks for hopping on the call!', direction: 'outbound' }],
        has_more: false,
      })

      const result = await service.getSmsDictionary({})

      expect(result.items).toEqual([
        { label: 'Thanks for hopping on the call!', value: 'acti_sms_1', note: 'outbound' },
      ])
    })
  })

  describe('getMeetingsDictionary', () => {
    it('returns formatted meeting items', async () => {
      mock.onGet(`${ API_BASE }/activity/meeting/`).reply({
        data: [{ id: 'acti_meet_1', title: 'Product Demo', starts_at: '2025-01-20T15:00:00Z' }],
        has_more: false,
      })

      const result = await service.getMeetingsDictionary({})

      expect(result.items).toEqual([
        { label: 'Product Demo', value: 'acti_meet_1', note: '2025-01-20T15:00:00Z' },
      ])
    })

    it('uses fallback label when title is missing', async () => {
      mock.onGet(`${ API_BASE }/activity/meeting/`).reply({
        data: [{ id: 'acti_meet_2', starts_at: '2025-02-01T10:00:00Z' }],
        has_more: false,
      })

      const result = await service.getMeetingsDictionary({})

      expect(result.items[0].label).toBe('(untitled meeting)')
    })
  })

  describe('getSequenceSubscriptionsDictionary', () => {
    it('returns empty when no leadId', async () => {
      const result = await service.getSequenceSubscriptionsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
      expect(mock.history).toHaveLength(0)
    })

    it('returns formatted subscription items scoped to lead', async () => {
      mock.onGet(`${ API_BASE }/sequence_subscription/`).reply({
        data: [{ id: 'sub_1', sequence_name: 'Cold Outreach v2', status: 'active' }],
        has_more: false,
      })

      const result = await service.getSequenceSubscriptionsDictionary({ criteria: { leadId: 'lead_1' } })

      expect(result.items).toEqual([
        { label: 'Cold Outreach v2', value: 'sub_1', note: 'active' },
      ])

      expect(mock.history[0].query).toMatchObject({ lead_id: 'lead_1' })
    })
  })

  describe('getBulkActionsDictionary', () => {
    it('returns empty when no kind', async () => {
      const result = await service.getBulkActionsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
      expect(mock.history).toHaveLength(0)
    })

    it('returns formatted bulk action items for edit kind', async () => {
      mock.onGet(`${ API_BASE }/bulk_action/edit/`).reply({
        data: [{ id: 'bulkact_1', type: 'set_lead_status', status: 'complete', date_created: '2025-01-15' }],
        has_more: false,
      })

      const result = await service.getBulkActionsDictionary({ criteria: { kind: 'Edit' } })

      expect(result.items).toEqual([
        { label: 'set_lead_status — complete', value: 'bulkact_1', note: '2025-01-15' },
      ])
    })
  })

  describe('getLeadCustomFieldsDictionary', () => {
    it('returns formatted lead custom field items', async () => {
      mock.onGet(`${ API_BASE }/custom_field/lead/`).reply({
        data: [{ id: 'cf_1', name: 'Industry', type: 'text' }],
      })

      const result = await service.getLeadCustomFieldsDictionary({})

      expect(result.items).toEqual([
        { label: 'Industry', value: 'cf_1', note: 'text' },
      ])

      expect(result.cursor).toBeNull()
    })

    it('filters by search', async () => {
      mock.onGet(`${ API_BASE }/custom_field/lead/`).reply({
        data: [
          { id: 'cf_1', name: 'Industry', type: 'text' },
          { id: 'cf_2', name: 'Revenue', type: 'number' },
        ],
      })

      const result = await service.getLeadCustomFieldsDictionary({ search: 'rev' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('cf_2')
    })
  })

  // ── Additional Bulk Actions ──

  describe('bulkEditLeads', () => {
    it('throws when type is missing', async () => {
      await expect(service.bulkEditLeads({ leadStatus: 'Qualified' })).rejects.toThrow('Operation is required')
    })

    it('sends POST with set_lead_status operation', async () => {
      mock.onPost(`${ API_BASE }/bulk_action/edit/`).reply({ id: 'bulkact_1', status: 'queued', type: 'set_lead_status' })

      const result = await service.bulkEditLeads(
        { leadStatus: 'Qualified' }, 'Set Lead Status', 'stat_q'
      )

      expect(result).toMatchObject({ id: 'bulkact_1', status: 'queued' })

      expect(mock.history[0].body).toMatchObject({
        type: 'set_lead_status',
        lead_status_id: 'stat_q',
      })
    })

    it('throws when Set Lead Status but no leadStatusId', async () => {
      await expect(service.bulkEditLeads(
        { leadStatus: 'Qualified' }, 'Set Lead Status'
      )).rejects.toThrow('Lead Status is required')
    })

    it('sends POST with set_custom_field operation', async () => {
      mock.onPost(`${ API_BASE }/bulk_action/edit/`).reply({ id: 'bulkact_2', status: 'queued' })

      await service.bulkEditLeads(
        { leadStatus: 'Qualified' }, 'Set Custom Field', null, 'cf_1', 'High'
      )

      expect(mock.history[0].body).toMatchObject({
        type: 'set_custom_field',
        custom_field_id: 'cf_1',
        custom_field_value: 'High',
      })
    })

    it('throws when Set Custom Field but no customFieldId', async () => {
      await expect(service.bulkEditLeads(
        { leadStatus: 'Qualified' }, 'Set Custom Field'
      )).rejects.toThrow('Custom Field is required')
    })

    it('sends POST with clear_custom_field operation', async () => {
      mock.onPost(`${ API_BASE }/bulk_action/edit/`).reply({ id: 'bulkact_3', status: 'queued' })

      await service.bulkEditLeads(
        { leadStatus: 'Qualified' }, 'Clear Custom Field', null, 'cf_1'
      )

      expect(mock.history[0].body).toMatchObject({
        type: 'clear_custom_field',
        custom_field_id: 'cf_1',
      })
    })
  })

  describe('bulkDeleteLeads', () => {
    it('sends POST with s_query', async () => {
      mock.onPost(`${ API_BASE }/bulk_action/delete/`).reply({ id: 'bulkact_1', status: 'queued', type: 'delete' })

      const result = await service.bulkDeleteLeads({ leadStatus: 'Qualified' })

      expect(result).toMatchObject({ id: 'bulkact_1', status: 'queued' })
      expect(mock.history[0].body).toHaveProperty('s_query')
    })
  })

  describe('bulkEmail', () => {
    it('throws when templateId is missing', async () => {
      await expect(service.bulkEmail({ leadStatus: 'Qualified' })).rejects.toThrow('Template is required')
    })

    it('throws when contactPreference is missing', async () => {
      await expect(service.bulkEmail({ leadStatus: 'Qualified' }, 'tmpl_1')).rejects.toThrow('Contact Preference is required')
    })

    it('sends POST with correct body', async () => {
      mock.onPost(`${ API_BASE }/bulk_action/email/`).reply({ id: 'bulkact_1', status: 'queued', type: 'email' })

      const result = await service.bulkEmail(
        { leadStatus: 'Qualified' }, 'tmpl_1', 'Primary Contact Per Lead'
      )

      expect(result).toMatchObject({ id: 'bulkact_1', status: 'queued' })

      expect(mock.history[0].body).toMatchObject({
        template_id: 'tmpl_1',
        contact_preference: 'lead',
      })
    })
  })

  // ── File Upload ──

  describe('uploadFile', () => {
    it('throws when fileUrl is missing', async () => {
      await expect(service.uploadFile()).rejects.toThrow('File is required')
    })

    it('downloads file and uploads via multipart POST', async () => {
      const fileBuffer = Buffer.from('fake-pdf-content')
      mock.onGet('https://storage.example.com/file.pdf').reply(fileBuffer)
      mock.onPost(`${ API_BASE }/files/`).reply({ id: 'file_1', url: 'https://app.close.com/files/file.pdf', filename: 'contract.pdf' })

      const result = await service.uploadFile('https://storage.example.com/file.pdf', 'contract.pdf')

      expect(result).toMatchObject({ id: 'file_1' })
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe('https://storage.example.com/file.pdf')
      expect(mock.history[0].encoding).toBeNull()
      expect(mock.history[1].method).toBe('post')
      expect(mock.history[1].url).toBe(`${ API_BASE }/files/`)
      expect(mock.history[1].headers).toMatchObject({ Authorization: `Bearer ${ OAUTH_TOKEN }` })
    })

    it('derives file name from URL when fileName not provided', async () => {
      const fileBuffer = Buffer.from('data')
      mock.onGet('https://storage.example.com/report.csv').reply(fileBuffer)
      mock.onPost(`${ API_BASE }/files/`).reply({ id: 'file_2', filename: 'report.csv' })

      const result = await service.uploadFile('https://storage.example.com/report.csv')

      expect(result).toMatchObject({ id: 'file_2' })
    })
  })

  // ── Trigger Resolve Events ──

  describe('handleTriggerResolveEvents', () => {
    it('rejects events when signatureKey is set but signature headers are missing', async () => {
      const result = await service.handleTriggerResolveEvents({
        webhookData: { signatureKey: 'abc123' },
        headers: {},
        body: { event: { object_type: 'lead', action: 'created', object_id: 'lead_1' } },
      })

      expect(result).toEqual({ events: [] })
    })

    it('returns empty events when object_type or action is missing', async () => {
      const result = await service.handleTriggerResolveEvents({
        headers: {},
        body: { event: { object_type: 'lead' } },
      })

      expect(result).toEqual({ events: [] })
    })

    it('returns empty events when no method is mapped for the event', async () => {
      const result = await service.handleTriggerResolveEvents({
        headers: {},
        body: { event: { object_type: 'unknown_type', action: 'unknown_action' } },
      })

      expect(result).toEqual({ events: [] })
    })

    it('shapes event correctly when no signatureKey is configured (test mode)', async () => {
      const result = await service.handleTriggerResolveEvents({
        headers: {},
        body: { event: { object_type: 'lead', action: 'created', object_id: 'lead_1' } },
      })

      expect(result.events).toEqual([
        { name: 'onLeadCreated', data: { object_type: 'lead', action: 'created', object_id: 'lead_1' } },
      ])
    })

    it('parses rawBody string when body is not present', async () => {
      const result = await service.handleTriggerResolveEvents({
        headers: {},
        rawBody: JSON.stringify({ event: { object_type: 'contact', action: 'created', object_id: 'cont_1' } }),
      })

      expect(result.events).toEqual([
        { name: 'onContactCreated', data: { object_type: 'contact', action: 'created', object_id: 'cont_1' } },
      ])
    })
  })

  // ── Additional Trigger Event Handlers ──

  describe('onLeadUpdated', () => {
    it('shapes event', () => {
      const result = service.onLeadUpdated('SHAPE_EVENT', {
        object_type: 'lead', action: 'updated', object_id: 'lead_1',
      })

      expect(result).toEqual([{ name: 'onLeadUpdated', data: { object_type: 'lead', action: 'updated', object_id: 'lead_1' } }])
    })

    it('filters by statusId', () => {
      const result = service.onLeadUpdated('FILTER_TRIGGER', {
        triggers: [
          { id: 't1', data: { statusId: 'stat_q' } },
          { id: 't2', data: { statusId: 'stat_p' } },
          { id: 't3', data: {} },
        ],
        eventData: { data: { status_id: 'stat_q' } },
      })

      expect(result.ids).toEqual(['t1', 't3'])
    })

    it('filters by ownerId', () => {
      const result = service.onLeadUpdated('FILTER_TRIGGER', {
        triggers: [
          { id: 't1', data: { ownerId: 'user_1' } },
          { id: 't2', data: { ownerId: 'user_2' } },
        ],
        eventData: { data: { lead_owner_id: 'user_1' } },
      })

      expect(result.ids).toEqual(['t1'])
    })
  })

  describe('onLeadStatusChanged', () => {
    it('shapes event', () => {
      const result = service.onLeadStatusChanged('SHAPE_EVENT', { object_type: 'lead', action: 'status_change', object_id: 'lead_1' })

      expect(result).toEqual([{ name: 'onLeadStatusChanged', data: { object_type: 'lead', action: 'status_change', object_id: 'lead_1' } }])
    })

    it('filters by statusId', () => {
      const result = service.onLeadStatusChanged('FILTER_TRIGGER', {
        triggers: [
          { id: 't1', data: { statusId: 'stat_q' } },
          { id: 't2', data: { statusId: 'stat_p' } },
          { id: 't3', data: {} },
        ],
        eventData: { data: { status_id: 'stat_q' } },
      })

      expect(result.ids).toEqual(['t1', 't3'])
    })
  })

  describe('onLeadMerged', () => {
    it('shapes event', () => {
      const result = service.onLeadMerged('SHAPE_EVENT', { object_type: 'lead', action: 'merged', object_id: 'lead_src' })

      expect(result).toEqual([{ name: 'onLeadMerged', data: { object_type: 'lead', action: 'merged', object_id: 'lead_src' } }])
    })

    it('matches all triggers (no custom filter)', () => {
      const result = service.onLeadMerged('FILTER_TRIGGER', { triggers: [{ id: 't1' }, { id: 't2' }], eventData: {} })

      expect(result.ids).toEqual(['t1', 't2'])
    })
  })

  describe('onOpportunityCreated', () => {
    it('shapes event', () => {
      const result = service.onOpportunityCreated('SHAPE_EVENT', { object_type: 'opportunity', action: 'created', object_id: 'oppo_1' })

      expect(result).toEqual([{ name: 'onOpportunityCreated', data: { object_type: 'opportunity', action: 'created', object_id: 'oppo_1' } }])
    })

    it('filters by pipelineId', () => {
      const result = service.onOpportunityCreated('FILTER_TRIGGER', {
        triggers: [
          { id: 't1', data: { pipelineId: 'pipe_1' } },
          { id: 't2', data: { pipelineId: 'pipe_2' } },
          { id: 't3', data: {} },
        ],
        eventData: { data: { pipeline_id: 'pipe_1' } },
      })

      expect(result.ids).toEqual(['t1', 't3'])
    })
  })

  describe('onOpportunityUpdated', () => {
    it('shapes event', () => {
      const result = service.onOpportunityUpdated('SHAPE_EVENT', { object_type: 'opportunity', action: 'updated', object_id: 'oppo_1' })

      expect(result).toEqual([{ name: 'onOpportunityUpdated', data: { object_type: 'opportunity', action: 'updated', object_id: 'oppo_1' } }])
    })

    it('filters by pipelineId and statusId combined', () => {
      const result = service.onOpportunityUpdated('FILTER_TRIGGER', {
        triggers: [
          { id: 't1', data: { pipelineId: 'pipe_1', statusId: 'stat_won' } },
          { id: 't2', data: { pipelineId: 'pipe_1', statusId: 'stat_active' } },
          { id: 't3', data: {} },
        ],
        eventData: { data: { pipeline_id: 'pipe_1', status_id: 'stat_won' } },
      })

      expect(result.ids).toEqual(['t1', 't3'])
    })
  })

  describe('onContactCreated', () => {
    it('shapes event', () => {
      const result = service.onContactCreated('SHAPE_EVENT', { object_type: 'contact', action: 'created', object_id: 'cont_1' })

      expect(result).toEqual([{ name: 'onContactCreated', data: { object_type: 'contact', action: 'created', object_id: 'cont_1' } }])
    })

    it('matches all triggers', () => {
      const result = service.onContactCreated('FILTER_TRIGGER', { triggers: [{ id: 't1' }, { id: 't2' }], eventData: {} })

      expect(result.ids).toEqual(['t1', 't2'])
    })
  })

  describe('onContactUpdated', () => {
    it('shapes event', () => {
      const result = service.onContactUpdated('SHAPE_EVENT', { object_type: 'contact', action: 'updated', object_id: 'cont_1' })

      expect(result).toEqual([{ name: 'onContactUpdated', data: { object_type: 'contact', action: 'updated', object_id: 'cont_1' } }])
    })

    it('matches all triggers', () => {
      const result = service.onContactUpdated('FILTER_TRIGGER', { triggers: [{ id: 't1' }, { id: 't2' }], eventData: {} })

      expect(result.ids).toEqual(['t1', 't2'])
    })
  })

  describe('onTaskCompleted', () => {
    it('shapes event', () => {
      const result = service.onTaskCompleted('SHAPE_EVENT', { object_type: 'task_completion', action: 'created', object_id: 'taskcomp_1' })

      expect(result).toEqual([{ name: 'onTaskCompleted', data: { object_type: 'task_completion', action: 'created', object_id: 'taskcomp_1' } }])
    })

    it('filters by assignedToId via task.assigned_to', () => {
      const result = service.onTaskCompleted('FILTER_TRIGGER', {
        triggers: [
          { id: 't1', data: { assignedToId: 'user_1' } },
          { id: 't2', data: { assignedToId: 'user_2' } },
          { id: 't3', data: {} },
        ],
        eventData: { data: { task: { assigned_to: 'user_1' } } },
      })

      expect(result.ids).toEqual(['t1', 't3'])
    })

    it('filters by assignedToId via data.assigned_to fallback', () => {
      const result = service.onTaskCompleted('FILTER_TRIGGER', {
        triggers: [
          { id: 't1', data: { assignedToId: 'user_1' } },
          { id: 't2', data: { assignedToId: 'user_2' } },
        ],
        eventData: { data: { assigned_to: 'user_1' } },
      })

      expect(result.ids).toEqual(['t1'])
    })
  })

  describe('onNoteCreated', () => {
    it('shapes event', () => {
      const result = service.onNoteCreated('SHAPE_EVENT', { object_type: 'activity.note', action: 'created', object_id: 'acti_1' })

      expect(result).toEqual([{ name: 'onNoteCreated', data: { object_type: 'activity.note', action: 'created', object_id: 'acti_1' } }])
    })

    it('matches all triggers', () => {
      const result = service.onNoteCreated('FILTER_TRIGGER', { triggers: [{ id: 't1' }, { id: 't2' }], eventData: {} })

      expect(result.ids).toEqual(['t1', 't2'])
    })
  })

  describe('onEmailSent', () => {
    it('shapes event', () => {
      const result = service.onEmailSent('SHAPE_EVENT', { object_type: 'activity.email', action: 'sent', object_id: 'acti_email_1' })

      expect(result).toEqual([{ name: 'onEmailSent', data: { object_type: 'activity.email', action: 'sent', object_id: 'acti_email_1' } }])
    })

    it('matches all triggers', () => {
      const result = service.onEmailSent('FILTER_TRIGGER', { triggers: [{ id: 't1' }, { id: 't2' }], eventData: {} })

      expect(result.ids).toEqual(['t1', 't2'])
    })
  })

  describe('onEmailReceived', () => {
    it('shapes event', () => {
      const result = service.onEmailReceived('SHAPE_EVENT', { object_type: 'activity.email', action: 'created', object_id: 'acti_email_1' })

      expect(result).toEqual([{ name: 'onEmailReceived', data: { object_type: 'activity.email', action: 'created', object_id: 'acti_email_1' } }])
    })

    it('matches all triggers', () => {
      const result = service.onEmailReceived('FILTER_TRIGGER', { triggers: [{ id: 't1' }], eventData: {} })

      expect(result.ids).toEqual(['t1'])
    })
  })

  describe('onSmsSent', () => {
    it('shapes event', () => {
      const result = service.onSmsSent('SHAPE_EVENT', { object_type: 'activity.sms', action: 'sent', object_id: 'acti_sms_1' })

      expect(result).toEqual([{ name: 'onSmsSent', data: { object_type: 'activity.sms', action: 'sent', object_id: 'acti_sms_1' } }])
    })

    it('matches all triggers', () => {
      const result = service.onSmsSent('FILTER_TRIGGER', { triggers: [{ id: 't1' }], eventData: {} })

      expect(result.ids).toEqual(['t1'])
    })
  })

  describe('onSmsReceived', () => {
    it('shapes event', () => {
      const result = service.onSmsReceived('SHAPE_EVENT', { object_type: 'activity.sms', action: 'created', object_id: 'acti_sms_1' })

      expect(result).toEqual([{ name: 'onSmsReceived', data: { object_type: 'activity.sms', action: 'created', object_id: 'acti_sms_1' } }])
    })

    it('matches all triggers', () => {
      const result = service.onSmsReceived('FILTER_TRIGGER', { triggers: [{ id: 't1' }], eventData: {} })

      expect(result.ids).toEqual(['t1'])
    })
  })

  describe('onMeetingCompleted', () => {
    it('shapes event', () => {
      const result = service.onMeetingCompleted('SHAPE_EVENT', { object_type: 'activity.meeting', action: 'completed', object_id: 'acti_meet_1' })

      expect(result).toEqual([{ name: 'onMeetingCompleted', data: { object_type: 'activity.meeting', action: 'completed', object_id: 'acti_meet_1' } }])
    })

    it('matches all triggers', () => {
      const result = service.onMeetingCompleted('FILTER_TRIGGER', { triggers: [{ id: 't1' }, { id: 't2' }], eventData: {} })

      expect(result.ids).toEqual(['t1', 't2'])
    })
  })
  // ── Sample Result Loader ──

  describe('runAdvancedSearch_SampleResultLoader', () => {
    it('returns lead sample by default', async () => {
      const result = await service.runAdvancedSearch_SampleResultLoader({})

      expect(result.data[0]).toHaveProperty('display_name')
    })

    it('returns opportunity sample', async () => {
      const result = await service.runAdvancedSearch_SampleResultLoader({ criteria: { objectType: 'opportunity' } })

      expect(result.data[0]).toHaveProperty('value_formatted')
    })

    it('returns contact sample', async () => {
      const result = await service.runAdvancedSearch_SampleResultLoader({ criteria: { objectType: 'contact' } })

      expect(result.data[0]).toHaveProperty('name', 'Jane Doe')
    })
  })

  // ── Error propagation through helpers/http.js + helpers/errors.js ──

  describe('apiRequest error wrapping', () => {
    it('wraps a Close error body with status, message and friendly hint', async () => {
      mock.onGet(`${ API_BASE }/lead/lead_missing/`).replyWithError({
        message: 'Not Found',
        status: 404,
        body: { error: 'Lead not found' },
      })

      await expect(service.getLead('lead_missing'))
        .rejects.toThrow('[getLead] — Close CRM 404 — Lead not found — The requested Close CRM resource was not found. Verify the ID.')
    })

    it('exposes the wrapped status and original cause on the thrown error', async () => {
      const original = { message: 'Too Many Requests', status: 429, body: { error: 'rate limited' } }
      mock.onGet(`${ API_BASE }/lead/`).replyWithError(original)

      const error = await service.listLeads().catch(e => e)

      expect(error.status).toBe(429)
      expect(error.message).toContain('Close CRM rate limit exceeded')
      expect(error.cause).toBeInstanceOf(Error)
    })

    it('wraps field-errors payloads', async () => {
      mock.onPost(`${ API_BASE }/lead/`).replyWithError({
        message: 'Bad Request',
        status: 400,
        body: { 'field-errors': { name: 'is required' } },
      })

      await expect(service.createLead('')).rejects.toThrow('name: is required')
    })

    it('wraps errors that carry no recognizable body', async () => {
      mock.onGet(`${ API_BASE }/me/`).replyWithError({ message: 'socket hang up' })

      await expect(service.getMe()).rejects.toThrow('Close CRM error — socket hang up')
    })
  })

  // ── OAuth failure paths ──

  describe('executeCallback failures', () => {
    it('throws a wrapped error when the token exchange fails', async () => {
      mock.onPost(OAUTH_TOKEN_URL).replyWithError({
        message: 'Bad Request',
        status: 400,
        body: { error: 'invalid_grant' },
      })

      await expect(service.executeCallback({ code: 'bad-code', redirectURI: 'https://example.com/cb' }))
        .rejects.toThrow('[executeCallback] — Close CRM 400 — invalid_grant')
    })

    it('falls back to display_name when /me/ has no email', async () => {
      mock.onPost(OAUTH_TOKEN_URL).reply({ access_token: 'a', refresh_token: 'r', expires_in: 3600 })
      mock.onGet(`${ API_BASE }/me/`).reply({ display_name: 'Alex Doe' })

      const result = await service.executeCallback({ code: 'c', redirectURI: 'https://example.com/cb' })

      expect(result.connectionIdentityName).toBe('Alex Doe')
    })
  })

  describe('refreshToken failures', () => {
    it('throws a wrapped error when the refresh call fails', async () => {
      mock.onPost(OAUTH_TOKEN_URL).replyWithError({
        message: 'Unauthorized',
        status: 401,
        body: { error: 'invalid refresh token' },
      })

      await expect(service.refreshToken('stale-refresh'))
        .rejects.toThrow('[refreshToken] — Close CRM 401 — invalid refresh token — Close CRM credentials are invalid or expired. Reconnect the account.')
    })

    it('keeps the supplied refresh token when Close does not rotate it', async () => {
      mock.onPost(OAUTH_TOKEN_URL).reply({ access_token: 'refreshed', expires_in: 3600 })

      const result = await service.refreshToken('kept-refresh')

      expect(result).toMatchObject({ token: 'refreshed', refreshToken: 'kept-refresh' })
    })
  })

  // ── Dictionary mapping branches ──

  describe('getTasksDictionary mapping', () => {
    it('maps tasks to label/value/note and applies text search', async () => {
      mock.onGet(`${ API_BASE }/task/`).reply({
        data: [
          { id: 'task_1', text: 'Follow up with Acme', lead_id: 'lead_1' },
          { id: 'task_2', text: 'Send proposal', lead_id: 'lead_2' },
          { id: 'task_3', lead_id: 'lead_3' },
        ],
      })

      const result = await service.getTasksDictionary({ search: 'follow' })

      expect(result).toEqual({
        items: [{ label: 'Follow up with Acme', value: 'task_1', note: 'lead_1' }],
        cursor: null,
      })
    })

    it('falls back to the task id as label when text is absent', async () => {
      mock.onGet(`${ API_BASE }/task/`).reply({ data: [{ id: 'task_9', lead_id: 'lead_9' }] })

      const result = await service.getTasksDictionary(null)

      expect(result.items).toEqual([{ label: 'task_9', value: 'task_9', note: 'lead_9' }])
    })
  })

  // ── fetchAll pagination walkers ──

  describe('listLeads fetchAll', () => {
    it('walks offset pages until has_more is false', async () => {
      let call = 0

      mock.onGet(`${ API_BASE }/lead/`).replyWith(() => {
        call++

        return call === 1
          ? { data: [{ id: 'lead_1' }], has_more: true }
          : { data: [{ id: 'lead_2' }], has_more: false }
      })

      const result = await service.listLeads(null, null, 1, 0, true)

      expect(result).toEqual({
        data: [{ id: 'lead_1' }, { id: 'lead_2' }],
        has_more: false,
        total_results: 2,
      })

      expect(mock.history[0].query).toMatchObject({ _limit: 1, _skip: 0 })
      expect(mock.history[1].query).toMatchObject({ _limit: 1, _skip: 1 })
    })

    it('stops at the maxPages cap', async () => {
      mock.onGet(`${ API_BASE }/lead/`).reply({ data: [{ id: 'lead_x' }], has_more: true })

      const result = await service.listLeads(null, null, 100, 0, true, 2)

      expect(mock.history).toHaveLength(2)
      expect(result.total_results).toBe(2)
    })
  })

  describe('runAdvancedSearch fetchAll', () => {
    it('walks cursor pages until the cursor is exhausted', async () => {
      let call = 0

      mock.onPost(`${ API_BASE }/data/search/`).replyWith(() => {
        call++

        return call === 1
          ? { data: [{ id: 'lead_1' }], cursor: 'cur_2' }
          : { data: [{ id: 'lead_2' }], cursor: null }
      })

      const result = await service.runAdvancedSearch('Lead', null, null, 50, null, true)

      expect(result).toEqual({ data: [{ id: 'lead_1' }, { id: 'lead_2' }], cursor: null })
      expect(mock.history[1].body).toMatchObject({ cursor: 'cur_2' })
    })

    it('honors the maxPages cap when the cursor never clears', async () => {
      mock.onPost(`${ API_BASE }/data/search/`).reply({ data: [{ id: 'lead_1' }], cursor: 'never_ends' })

      const result = await service.runAdvancedSearch('Lead', null, null, 50, null, true, 3)

      expect(mock.history).toHaveLength(3)
      expect(result.data).toHaveLength(3)
    })
  })

  describe('runSmartView fetchAll', () => {
    it('walks cursor pages for a saved search', async () => {
      let call = 0

      mock.onPost(`${ API_BASE }/data/search/`).replyWith(() => {
        call++

        return call === 1
          ? { data: [{ id: 'lead_1' }], cursor: 'cur_2' }
          : { data: [{ id: 'lead_2' }], cursor: null }
      })

      const result = await service.runSmartView('save_abc', 50, null, true, 10)

      expect(result).toEqual({ data: [{ id: 'lead_1' }, { id: 'lead_2' }], cursor: null })
      expect(mock.history[0].body.query).toEqual({ type: 'saved_search', saved_search_id: 'save_abc' })
    })
  })

  // ── subscribeToSequence sender resolution fallbacks ──

  describe('subscribeToSequence sender fallbacks', () => {
    it('tolerates a failing connected_account lookup and a name-less /me/', async () => {
      mock.onGet(`${ API_BASE }/connected_account/emailacct_1/`).replyWithError({ message: 'Forbidden', status: 403 })
      mock.onGet(`${ API_BASE }/me/`).reply({ first_name: 'Alex', last_name: 'Doe' })
      mock.onPost(`${ API_BASE }/sequence_subscription/`).reply({ id: 'sub_1' })

      const result = await service.subscribeToSequence('seq_1', 'cont_1', 'emailacct_1', 'jane@acme.com')

      expect(result).toMatchObject({ id: 'sub_1' })

      const postCall = mock.history.find(h => h.method === 'post')

      expect(postCall.body.sender_name).toBe('Alex Doe')
      expect(postCall.body).not.toHaveProperty('sender_email')
    })

    it('falls back to the /me/ email when no name fields exist', async () => {
      mock.onGet(`${ API_BASE }/connected_account/emailacct_1/`).reply({ identifier: 'alex@acme.com' })
      mock.onGet(`${ API_BASE }/me/`).reply({ email: 'alex@acme.com' })
      mock.onPost(`${ API_BASE }/sequence_subscription/`).reply({ id: 'sub_2' })

      await service.subscribeToSequence('seq_1', 'cont_1', 'emailacct_1', 'jane@acme.com')

      const postCall = mock.history.find(h => h.method === 'post')

      expect(postCall.body).toMatchObject({ sender_email: 'alex@acme.com', sender_name: 'alex@acme.com' })
    })

    it('skips both lookups when sender name and email are supplied', async () => {
      mock.onPost(`${ API_BASE }/sequence_subscription/`).reply({ id: 'sub_3' })

      await service.subscribeToSequence('seq_1', 'cont_1', 'emailacct_1', 'jane@acme.com', 'Me', 'me@acme.com')

      expect(mock.history).toHaveLength(1)
    })

    it('tolerates a failing /me/ lookup and omits the sender name', async () => {
      mock.onGet(`${ API_BASE }/me/`).replyWithError({ message: 'boom' })
      mock.onPost(`${ API_BASE }/sequence_subscription/`).reply({ id: 'sub_4' })

      await service.subscribeToSequence('seq_1', 'cont_1', 'emailacct_1', 'jane@acme.com', undefined, 'me@acme.com')

      const postCall = mock.history.find(h => h.method === 'post')

      expect(postCall.body).not.toHaveProperty('sender_name')
    })
  })

  // ── uploadFile failure ──

  describe('uploadFile failures', () => {
    it('wraps download failures', async () => {
      mock.onGet('https://storage.example.com/missing.pdf').replyWithError({ message: 'Not Found', status: 404 })

      await expect(service.uploadFile('https://storage.example.com/missing.pdf', 'x.pdf'))
        .rejects.toThrow('[uploadFile] — Close CRM 404')
    })

    it('wraps upload failures', async () => {
      mock.onGet('https://storage.example.com/f.pdf').reply(Buffer.from('data'))
      mock.onPost(`${ API_BASE }/files/`).replyWithError({ message: 'Payload Too Large', status: 413 })

      await expect(service.uploadFile('https://storage.example.com/f.pdf', 'f.pdf'))
        .rejects.toThrow('[uploadFile] — Close CRM 413')
    })
  })

  // ── Webhook signature verification through the trigger handler ──

  describe('handleTriggerResolveEvents signature verification', () => {
    const crypto = require('crypto')
    const SIG_KEY_HEX = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'

    function signedInvocation(bodyObject, { key = SIG_KEY_HEX, timestamp } = {}) {
      const rawBody = JSON.stringify(bodyObject)
      const ts = timestamp !== undefined ? timestamp : String(Math.floor(Date.now() / 1000))
      const hash = crypto
        .createHmac('sha256', Buffer.from(key, 'hex'))
        .update(String(ts) + rawBody)
        .digest('hex')

      return {
        webhookData: { signatureKey: SIG_KEY_HEX },
        headers: { 'Close-Sig-Hash': hash, 'Close-Sig-Timestamp': ts },
        rawBody,
      }
    }

    it('accepts an event with a valid signature', async () => {
      const invocation = signedInvocation({ event: { object_type: 'lead', action: 'created', object_id: 'lead_1' } })

      const result = await service.handleTriggerResolveEvents(invocation)

      expect(result.events).toEqual([
        { name: 'onLeadCreated', data: { object_type: 'lead', action: 'created', object_id: 'lead_1' } },
      ])
    })

    it('rejects an event signed with the wrong key', async () => {
      const invocation = signedInvocation(
        { event: { object_type: 'lead', action: 'created', object_id: 'lead_1' } },
        { key: 'ffffffffffffffffffffffffffffffff' }
      )

      const result = await service.handleTriggerResolveEvents(invocation)

      expect(result).toEqual({ events: [] })
    })

    it('rejects an event whose body was tampered with after signing', async () => {
      const invocation = signedInvocation({ event: { object_type: 'lead', action: 'created', object_id: 'lead_1' } })
      invocation.rawBody = JSON.stringify({ event: { object_type: 'lead', action: 'deleted', object_id: 'lead_666' } })

      const result = await service.handleTriggerResolveEvents(invocation)

      expect(result).toEqual({ events: [] })
    })

    it('rejects an event with a stale timestamp', async () => {
      const staleTs = String(Math.floor(Date.now() / 1000) - 3600)
      const invocation = signedInvocation(
        { event: { object_type: 'lead', action: 'created', object_id: 'lead_1' } },
        { timestamp: staleTs }
      )

      const result = await service.handleTriggerResolveEvents(invocation)

      expect(result).toEqual({ events: [] })
    })

    it('returns no events when the raw body is not valid JSON', async () => {
      const result = await service.handleTriggerResolveEvents({ headers: {}, rawBody: 'not-json-at-all' })

      expect(result).toEqual({ events: [] })
    })

    it('reads a Buffer rawBody', async () => {
      const result = await service.handleTriggerResolveEvents({
        headers: {},
        rawBody: Buffer.from(JSON.stringify({ event: { object_type: 'lead', action: 'created', object_id: 'lead_b' } })),
      })

      expect(result.events).toEqual([
        { name: 'onLeadCreated', data: { object_type: 'lead', action: 'created', object_id: 'lead_b' } },
      ])
    })

    it('handles a completely empty invocation', async () => {
      const result = await service.handleTriggerResolveEvents()

      expect(result).toEqual({ events: [] })
    })
  })

  // ── Trigger system handler branches ──

  describe('handleTriggerSelectMatched dispatch', () => {
    it('delegates to the mapped trigger method for filtering', async () => {
      const result = await service.handleTriggerSelectMatched({
        eventName: 'onLeadCreated',
        triggers: [
          { id: 't1', data: { statusId: 'stat_q' } },
          { id: 't2', data: { statusId: 'stat_other' } },
        ],
        eventData: { data: { status_id: 'stat_q' } },
      })

      expect(result.ids).toEqual(['t1'])
    })

    it('returns all trigger ids when eventName is absent', async () => {
      const result = await service.handleTriggerSelectMatched({ triggers: [{ id: 't1' }] })

      expect(result.ids).toEqual(['t1'])
    })

    it('handles a missing invocation', async () => {
      const result = await service.handleTriggerSelectMatched()

      expect(result.ids).toEqual([])
    })
  })

  describe('handleTriggerDeleteWebhook failures', () => {
    it('swallows delete errors instead of throwing', async () => {
      mock.onDelete(`${ API_BASE }/webhook/whsub_gone/`).replyWithError({ message: 'Not Found', status: 404 })

      await expect(service.handleTriggerDeleteWebhook({ webhookData: { id: 'whsub_gone' } })).resolves.toBeUndefined()
      expect(mock.history).toHaveLength(1)
    })

    it('does nothing when the invocation is missing', async () => {
      await expect(service.handleTriggerDeleteWebhook()).resolves.toBeUndefined()
      expect(mock.history).toHaveLength(0)
    })
  })

  describe('trigger method call-type fallthrough', () => {
    it('returns null for an unrecognized call type', () => {
      expect(service.onLeadCreated('SOME_OTHER_CALL_TYPE', {})).toBeNull()
    })

    it('returns null for an unrecognized call type on a filtered trigger', () => {
      expect(service.onOpportunityUpdated('SOME_OTHER_CALL_TYPE', {})).toBeNull()
    })

    it('falls back to the raw payload as event data when eventData is absent', () => {
      const result = service.onLeadCreated('FILTER_TRIGGER', {
        triggers: [{ id: 't1', data: { statusId: 'stat_q' } }],
        data: { status_id: 'stat_q' },
      })

      expect(result.ids).toEqual(['t1'])
    })

    it('reads event data from the `event` key when present', () => {
      const result = service.onLeadCreated('FILTER_TRIGGER', {
        triggers: [{ id: 't1', data: { statusId: 'stat_q' } }],
        event: { data: { status_id: 'stat_q' } },
      })

      expect(result.ids).toEqual(['t1'])
    })

    it('returns an empty id list when there are no triggers', () => {
      expect(service.onLeadCreated('FILTER_TRIGGER', {})).toEqual({ ids: [] })
    })
  })

  // ── Dictionary sweep: nullish payloads, empty responses, id fallbacks, cursors ──

  describe('dictionary sweep', () => {
    // [methodName, GET url, payload accepted with no criteria, sparse record]
    const SIMPLE_DICTIONARIES = [
      ['getPipelinesDictionary', '/pipeline/'],
      ['getLeadStatusesDictionary', '/status/lead/'],
      ['getOpportunityStatusesDictionary', '/status/opportunity/'],
      ['getUsersDictionary', '/user/'],
      ['getLeadsDictionary', '/lead/'],
      ['getContactsDictionary', '/contact/'],
      ['getOpportunitiesDictionary', '/opportunity/'],
      ['getSmartViewsDictionary', '/saved_search/'],
      ['getSequencesDictionary', '/sequence/'],
      ['getCustomActivityTypesDictionary', '/custom_activity/'],
      ['getEmailAccountsDictionary', '/connected_account/'],
      ['getEmailTemplatesDictionary', '/email_template/'],
      ['getTasksDictionary', '/task/'],
      ['getWebhooksDictionary', '/webhook/'],
      ['getNotesDictionary', '/activity/note/'],
      ['getCallsDictionary', '/activity/call/'],
      ['getEmailsDictionary', '/activity/email/'],
      ['getSmsDictionary', '/activity/sms/'],
      ['getMeetingsDictionary', '/activity/meeting/'],
      ['getLeadCustomFieldsDictionary', '/custom_field/lead/'],
    ]

    it.each(SIMPLE_DICTIONARIES)('%s returns an empty list when Close returns no data', async (method, path) => {
      mock.onGet(`${ API_BASE }${ path }`).reply({})

      await expect(service[method]()).resolves.toEqual({ items: [], cursor: null })
    })

    it.each(SIMPLE_DICTIONARIES)('%s maps a record that only carries an id', async (method, path) => {
      mock.onGet(`${ API_BASE }${ path }`).reply({ data: [{ id: 'obj_1' }] })

      const result = await service[method]({})

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('obj_1')
    })

    // Offset-cursor dictionaries: cursor in, next cursor out.
    const CURSOR_DICTIONARIES = [
      ['getLeadsDictionary', '/lead/'],
      ['getContactsDictionary', '/contact/'],
      ['getOpportunitiesDictionary', '/opportunity/'],
      ['getNotesDictionary', '/activity/note/'],
      ['getCallsDictionary', '/activity/call/'],
      ['getEmailsDictionary', '/activity/email/'],
      ['getSmsDictionary', '/activity/sms/'],
      ['getMeetingsDictionary', '/activity/meeting/'],
    ]

    it.each(CURSOR_DICTIONARIES)('%s advances the cursor from _skip when has_more is true', async (method, path) => {
      mock.onGet(`${ API_BASE }${ path }`).reply({ data: [{ id: 'a' }, { id: 'b' }], has_more: true })

      const result = await service[method]({ cursor: '50' })

      expect(mock.history[0].query).toMatchObject({ _limit: 50, _skip: 50 })
      expect(result.cursor).toBe('52')
    })

    // getLeadsDictionary is intentionally absent: leads are not scoped by a parent lead.
    const LEAD_SCOPED_DICTIONARIES = CURSOR_DICTIONARIES.filter(([m]) => m !== 'getLeadsDictionary')

    it.each(LEAD_SCOPED_DICTIONARIES)('%s scopes by criteria.leadId', async (method, path) => {
      mock.onGet(`${ API_BASE }${ path }`).reply({ data: [] })

      await service[method]({ criteria: { leadId: 'lead_x' } })

      expect(mock.history[0].query).toMatchObject({ lead_id: 'lead_x' })
    })

    it('getPipelinesDictionary counts statuses even when the field is absent', async () => {
      mock.onGet(`${ API_BASE }/pipeline/`).reply({ data: [{ id: 'pipe_1', name: 'Sales' }] })

      const result = await service.getPipelinesDictionary({ search: 'sal' })

      expect(result.items).toEqual([{ label: 'Sales', value: 'pipe_1', note: '0 statuses' }])
    })

    it('getUsersDictionary falls back through display_name, first/last name, then email', async () => {
      mock.onGet(`${ API_BASE }/user/`).reply({
        data: [
          { id: 'u1', display_name: 'Alex Doe', email: 'a@x.com' },
          { id: 'u2', first_name: 'Bea', last_name: 'Fox', email: 'b@x.com' },
          { id: 'u3', email: 'c@x.com' },
        ],
      })

      const result = await service.getUsersDictionary({})

      expect(result.items.map(i => i.label)).toEqual(['Alex Doe', 'Bea Fox', 'c@x.com'])
    })

    it('getOpportunitiesDictionary labels from value_formatted, value, note and id', async () => {
      mock.onGet(`${ API_BASE }/opportunity/`).reply({
        data: [
          { id: 'o1', value_formatted: '$5,000', note: 'Annual Plan', status_label: 'Active' },
          { id: 'o2', value: 300 },
          { id: 'o3' },
        ],
      })

      const result = await service.getOpportunitiesDictionary({})

      expect(result.items.map(i => i.label)).toEqual(['$5,000 — Annual Plan', '$300', 'o3'])
      expect(result.items.map(i => i.note)).toEqual(['Status: Active', undefined, undefined])
    })

    it('getCallsDictionary title-cases the direction and prefers duration for the note', async () => {
      mock.onGet(`${ API_BASE }/activity/call/`).reply({
        data: [
          { id: 'c1', direction: 'outbound', phone: '+15551234567', duration: 120 },
          { id: 'c2', lead_id: 'lead_1' },
        ],
      })

      const result = await service.getCallsDictionary({})

      expect(result.items).toEqual([
        { label: 'Outbound — +15551234567', value: 'c1', note: '120s' },
        { label: 'Call', value: 'c2', note: 'lead_1' },
      ])
    })

    it('getNotesDictionary truncates long note bodies into a one-line label', async () => {
      const longNote = `${ 'x'.repeat(200) }`

      mock.onGet(`${ API_BASE }/activity/note/`).reply({
        data: [
          { id: 'n1', note: 'short  \n note', lead_id: 'lead_1' },
          { id: 'n2', note: longNote },
        ],
      })

      const result = await service.getNotesDictionary({})

      expect(result.items[0].label).toBe('short note')
      expect(result.items[1].label).toHaveLength(60)
      expect(result.items[1].label.endsWith('…')).toBe(true)
    })

    it('getSmsDictionary falls back to the id when the message text is blank', async () => {
      mock.onGet(`${ API_BASE }/activity/sms/`).reply({ data: [{ id: 's1', text: '', direction: 'outbound' }] })

      const result = await service.getSmsDictionary({})

      expect(result.items).toEqual([{ label: 's1', value: 's1', note: 'outbound' }])
    })

    it('getEmailsDictionary and getMeetingsDictionary use placeholder labels', async () => {
      mock.onGet(`${ API_BASE }/activity/email/`).reply({ data: [{ id: 'e1', status: 'sent' }] })
      mock.onGet(`${ API_BASE }/activity/meeting/`).reply({ data: [{ id: 'm1' }] })

      await expect(service.getEmailsDictionary({})).resolves.toMatchObject({
        items: [{ label: '(no subject)', value: 'e1', note: 'sent' }],
      })

      await expect(service.getMeetingsDictionary({})).resolves.toMatchObject({
        items: [{ label: '(untitled meeting)', value: 'm1' }],
      })
    })

    it('getEmailAccountsDictionary falls back through email, identifier and id', async () => {
      mock.onGet(`${ API_BASE }/connected_account/`).reply({
        data: [
          { id: 'a1', email: 'a@x.com', account_type: 'gmail' },
          { id: 'a2', identifier: 'b@x.com', provider: 'imap' },
          { id: 'a3' },
        ],
      })

      const result = await service.getEmailAccountsDictionary({})

      expect(result.items.map(i => i.label)).toEqual(['a@x.com', 'b@x.com', 'a3'])
      expect(result.items.map(i => i.note)).toEqual(['gmail', 'imap', undefined])
    })

    it('getSequencesDictionary notes the step count only when steps are present', async () => {
      mock.onGet(`${ API_BASE }/sequence/`).reply({
        data: [{ id: 's1', name: 'Cold', steps: [1, 2, 3] }, { id: 's2', name: 'Warm' }],
      })

      const result = await service.getSequencesDictionary({})

      expect(result.items.map(i => i.note)).toEqual(['3 steps', undefined])
    })

    it('getSmartViewsDictionary notes shared views only', async () => {
      mock.onGet(`${ API_BASE }/saved_search/`).reply({
        data: [{ id: 'v1', name: 'Mine' }, { id: 'v2', name: 'Ours', is_shared: true }],
      })

      const result = await service.getSmartViewsDictionary({})

      expect(result.items.map(i => i.note)).toEqual([undefined, 'shared'])
    })

    it('getOpportunityStatusesDictionary notes the status type only when present', async () => {
      mock.onGet(`${ API_BASE }/status/opportunity/`).reply({
        data: [{ id: 'st1', label: 'Won', status_type: 'won' }, { id: 'st2', label: 'Open' }],
      })

      const result = await service.getOpportunityStatusesDictionary({})

      expect(result.items.map(i => i.note)).toEqual(['Type: won', undefined])
    })

    it('getWebhooksDictionary falls back to the id when there is no URL', async () => {
      mock.onGet(`${ API_BASE }/webhook/`).reply({ data: [{ id: 'w1', status: 'active' }] })

      const result = await service.getWebhooksDictionary({})

      expect(result.items).toEqual([{ label: 'w1', value: 'w1', note: 'active' }])
    })

    it('getCustomFieldsDictionary resolves the custom_object schema endpoint', async () => {
      mock.onGet(`${ API_BASE }/custom_field_schema/cot_1/`).reply({ data: [{ id: 'cf_1', name: 'Industry', type: 'text' }] })

      const result = await service.getCustomFieldsDictionary({
        criteria: { objectType: 'custom_object', customObjectTypeId: 'cot_1' },
      })

      expect(result.items).toEqual([{ label: 'Industry', value: 'cf_1', note: 'text' }])
    })

    it('getCustomFieldsDictionary short-circuits without an objectType', async () => {
      await expect(service.getCustomFieldsDictionary()).resolves.toEqual({ items: [], cursor: null })
      await expect(service.getCustomFieldsDictionary({ criteria: {} })).resolves.toEqual({ items: [], cursor: null })
      expect(mock.history).toHaveLength(0)
    })

    it('getCustomFieldsDictionary short-circuits for custom_object without a type id', async () => {
      await expect(service.getCustomFieldsDictionary({ criteria: { objectType: 'custom_object' } }))
        .resolves.toEqual({ items: [], cursor: null })

      expect(mock.history).toHaveLength(0)
    })

    it('getSequenceSubscriptionsDictionary short-circuits without a leadId', async () => {
      await expect(service.getSequenceSubscriptionsDictionary()).resolves.toEqual({ items: [], cursor: null })
      await expect(service.getSequenceSubscriptionsDictionary({ criteria: {} })).resolves.toEqual({ items: [], cursor: null })
      expect(mock.history).toHaveLength(0)
    })

    it('getSequenceSubscriptionsDictionary falls back through name, sequence id and id', async () => {
      mock.onGet(`${ API_BASE }/sequence_subscription/`).reply({
        data: [
          { id: 'sub1', sequence_name: 'Cold', status: 'active' },
          { id: 'sub2', sequence_id: 'seq_2' },
          { id: 'sub3' },
        ],
        has_more: true,
      })

      const result = await service.getSequenceSubscriptionsDictionary({ criteria: { leadId: 'lead_1' }, cursor: '10' })

      expect(result.items.map(i => i.label)).toEqual(['Cold', 'seq_2', 'sub3'])
      expect(result.cursor).toBe('13')
    })

    it('getBulkActionsDictionary short-circuits without a kind', async () => {
      await expect(service.getBulkActionsDictionary()).resolves.toEqual({ items: [], cursor: null })
      expect(mock.history).toHaveLength(0)
    })

    it('getBulkActionsDictionary labels from type and status with kind fallback', async () => {
      mock.onGet(`${ API_BASE }/bulk_action/edit/`).reply({
        data: [
          { id: 'b1', type: 'set_lead_status', status: 'complete', date_created: '2025-01-01' },
          { id: 'b2' },
        ],
      })

      const result = await service.getBulkActionsDictionary({ criteria: { kind: 'edit' } })

      expect(result.items.map(i => i.label)).toEqual(['set_lead_status — complete', 'edit'])
      expect(result.cursor).toBeNull()
    })
  })

  // ── Miscellaneous branch coverage ──

  describe('sendEmail account resolution', () => {
    it('falls back to the configured defaultEmailAccountId for outbox sends', async () => {
      mock.onPost(`${ API_BASE }/activity/email/`).reply({ id: 'acti_email_1' })

      await service.sendEmail('lead_1', null, null, null, 'jane@acme.com', null, null, 'Hi', 'Body')

      expect(mock.history[0].body).toMatchObject({
        email_account_id: 'emailacct_default',
        status: 'outbox',
        to: ['jane@acme.com'],
      })
    })
  })

  describe('findLeadByEmail edge cases', () => {
    it('returns null when Close returns no matches', async () => {
      mock.onGet(`${ API_BASE }/lead/`).reply({ data: [] })

      await expect(service.findLeadByEmail('nobody@acme.com')).resolves.toBeNull()
    })
  })

  // ── Bulk action filter guards ──

  describe('bulk action filter guards', () => {
    // Regression guard: buildSearchQuery always returns at least the bare
    // `{ type: 'object_type', object_type: 'lead' }` node, so `!sQuery` alone never fires and an
    // omitted Filter used to mean "every lead in the organization" — an org-wide delete/edit/send.
    // #buildBulkQuery must reject any query that carries no conditions.

    const UNFILTERED = [
      ['omitted', undefined],
      ['null', null],
      ['empty object', {}],
      ['empty string', ''],
      ['unparseable JSON string', 'not json'],
      ['object with no recognized keys', { unknownKey: 1 }],
      ['a bare native object_type node', { type: 'object_type', object_type: 'lead' }],
      ['empty customFields', { customFields: {} }],
      ['empty conditions', { conditions: [] }],
    ]

    it.each(UNFILTERED)('bulkDeleteLeads refuses a %s filter', async (_label, filter) => {
      mock.onPost(`${ API_BASE }/bulk_action/delete/`).reply({ id: 'bulkact_1', status: 'queued' })

      await expect(service.bulkDeleteLeads(filter)).rejects.toThrow(/Filter is required/)
      expect(mock.history).toHaveLength(0)
    })

    it.each(UNFILTERED)('bulkEditLeads refuses a %s filter', async (_label, filter) => {
      mock.onPost(`${ API_BASE }/bulk_action/edit/`).reply({ id: 'bulkact_4', status: 'queued' })

      await expect(service.bulkEditLeads(filter, 'Set Lead Status', 'stat_1')).rejects.toThrow(/Filter is required/)
      expect(mock.history).toHaveLength(0)
    })

    it.each(UNFILTERED)('bulkEmail refuses a %s filter', async (_label, filter) => {
      mock.onPost(`${ API_BASE }/bulk_action/email/`).reply({ id: 'bulkact_5', status: 'queued' })

      await expect(service.bulkEmail(filter, 'tmpl_1', 'First Contact Per Lead')).rejects.toThrow(/Filter is required/)
      expect(mock.history).toHaveLength(0)
    })

    it('refuses to delete every lead in the organization', async () => {
      await expect(service.bulkDeleteLeads()).rejects.toThrow(
        'Refusing to delete every lead in the organization.'
      )
    })

    // The guard must not block legitimately filtered calls.

    const FILTERED = [
      ['leadStatus', { leadStatus: 'Potential' }],
      ['assignedToId', { assignedToId: 'user_1' }],
      ['createdAfter', { createdAfter: '2026-01-01' }],
      ['customFields', { customFields: { cf_1: 'x' } }],
      ['native conditions', { conditions: [{ type: 'field_condition', field: {}, condition: {} }] }],
      ['a native and-query', { type: 'and', queries: [] }],
    ]

    it.each(FILTERED)('bulkDeleteLeads allows a %s filter', async (_label, filter) => {
      mock.onPost(`${ API_BASE }/bulk_action/delete/`).reply({ id: 'bulkact_ok', status: 'queued' })

      await service.bulkDeleteLeads(filter)

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].body.s_query).toBeDefined()
    })

    it('bulkDeleteLeads parses a JSON-string filter', async () => {
      mock.onPost(`${ API_BASE }/bulk_action/delete/`).reply({ id: 'bulkact_3', status: 'queued' })

      await service.bulkDeleteLeads('{"leadStatus":"Qualified"}')

      expect(mock.history[0].body.s_query.type).toBe('and')
    })

    it('bulkEditLeads and bulkEmail still send their non-filter fields when filtered', async () => {
      mock.onPost(`${ API_BASE }/bulk_action/edit/`).reply({ id: 'bulkact_4', status: 'queued' })
      mock.onPost(`${ API_BASE }/bulk_action/email/`).reply({ id: 'bulkact_5', status: 'queued' })

      await service.bulkEditLeads({ leadStatus: 'Potential' }, 'Set Lead Status', 'stat_1')
      await service.bulkEmail({ leadStatus: 'Potential' }, 'tmpl_1', 'First Contact Per Lead')

      expect(mock.history[0].body.type).toBe('set_lead_status')
      expect(mock.history[0].body.lead_status_id).toBe('stat_1')
      expect(mock.history[1].body.contact_preference).toBe('contact')
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Helper modules — tested directly (no sandbox required)
// ═══════════════════════════════════════════════════════════════════════════

describe('helpers/utils', () => {
  const { clean, deepClean, toArray, parseMaybeJSON, buildQuery, dictItem, applySearch } = require('../src/helpers/utils')

  describe('clean', () => {
    it('drops undefined, null and empty-string values', () => {
      expect(clean({ a: 1, b: undefined, c: null, d: '', e: 0, f: false })).toEqual({ a: 1, e: 0, f: false })
    })

    it('passes through non-objects unchanged', () => {
      expect(clean(null)).toBeNull()
      expect(clean(undefined)).toBeUndefined()
      expect(clean('str')).toBe('str')
      expect(clean(5)).toBe(5)
    })
  })

  describe('deepClean', () => {
    it('recursively strips null/undefined and empty objects', () => {
      expect(deepClean({
        a: 1,
        b: null,
        c: undefined,
        d: {},
        e: { f: null },
        g: { h: 2 },
      })).toEqual({ a: 1, g: { h: 2 } })
    })

    it('cleans array members and preserves empty arrays', () => {
      expect(deepClean({ list: [{ a: 1, b: null }, 'x'], empty: [] })).toEqual({ list: [{ a: 1 }, 'x'], empty: [] })
    })

    it('preserves falsy scalars', () => {
      expect(deepClean({ a: 0, b: false, c: '' })).toEqual({ a: 0, b: false, c: '' })
    })

    it('returns scalars untouched', () => {
      expect(deepClean('x')).toBe('x')
      expect(deepClean(7)).toBe(7)
      expect(deepClean(null)).toBeNull()
    })
  })

  describe('toArray', () => {
    it('returns an empty array for empty inputs', () => {
      expect(toArray(undefined)).toEqual([])
      expect(toArray(null)).toEqual([])
      expect(toArray('')).toEqual([])
    })

    it('filters falsy members out of arrays', () => {
      expect(toArray(['a', '', null, 'b'])).toEqual(['a', 'b'])
    })

    it('splits comma-separated strings and trims each part', () => {
      expect(toArray('a, b ,,c')).toEqual(['a', 'b', 'c'])
    })

    it('wraps any other value in an array', () => {
      expect(toArray(5)).toEqual([5])
      expect(toArray({ a: 1 })).toEqual([{ a: 1 }])
    })
  })

  describe('parseMaybeJSON', () => {
    it('returns undefined for empty inputs', () => {
      expect(parseMaybeJSON(undefined)).toBeUndefined()
      expect(parseMaybeJSON(null)).toBeUndefined()
      expect(parseMaybeJSON('')).toBeUndefined()
    })

    it('passes objects and arrays through', () => {
      const obj = { a: 1 }

      expect(parseMaybeJSON(obj)).toBe(obj)
    })

    it('passes non-string scalars through', () => {
      expect(parseMaybeJSON(42)).toBe(42)
      expect(parseMaybeJSON(true)).toBe(true)
    })

    it('parses JSON strings', () => {
      expect(parseMaybeJSON('{"a":1}')).toEqual({ a: 1 })
    })

    it('returns the original string when it is not valid JSON', () => {
      expect(parseMaybeJSON('not json')).toBe('not json')
    })
  })

  describe('buildQuery', () => {
    it('returns undefined for empty or non-object filters', () => {
      expect(buildQuery(null)).toBeUndefined()
      expect(buildQuery(undefined)).toBeUndefined()
      expect(buildQuery('')).toBeUndefined()
      expect(buildQuery(7)).toBeUndefined()
    })

    it('passes a string filter through unchanged', () => {
      expect(buildQuery('status_label:"Qualified"')).toBe('status_label:"Qualified"')
    })

    it('serializes an object filter to Close query syntax', () => {
      expect(buildQuery({ status_label: 'Qualified', company: 'Acme Corp', count: 3 }))
        .toBe('status_label:Qualified company:"Acme Corp" count:3')
    })

    it('drops undefined, null and empty-string entries', () => {
      expect(buildQuery({ a: 'x', b: undefined, c: null, d: '' })).toBe('a:x')
    })
  })

  describe('dictItem', () => {
    it('prefers name, then label, then display_name, then id', () => {
      expect(dictItem({ id: '1', name: 'N', label: 'L' })).toEqual({ label: 'N', value: '1', note: undefined })
      expect(dictItem({ id: '2', label: 'L' })).toEqual({ label: 'L', value: '2', note: undefined })
      expect(dictItem({ id: '3', display_name: 'D' })).toEqual({ label: 'D', value: '3', note: undefined })
      expect(dictItem({ id: '4' })).toEqual({ label: '4', value: '4', note: undefined })
    })

    it('honors explicit overrides', () => {
      expect(dictItem({ id: '1', name: 'N' }, { label: 'Custom', value: 'v', note: 'hi' }))
        .toEqual({ label: 'Custom', value: 'v', note: 'hi' })
    })
  })

  describe('applySearch', () => {
    const items = [
      { name: 'Alpha' },
      { display_name: 'Beta' },
      { label: 'Gamma' },
      { other: 'Delta' },
    ]

    it('returns the input untouched when search is empty', () => {
      expect(applySearch(items, '')).toBe(items)
      expect(applySearch(items, undefined)).toBe(items)
    })

    it('matches case-insensitively across the default fields', () => {
      expect(applySearch(items, 'BET')).toEqual([{ display_name: 'Beta' }])
      expect(applySearch(items, 'gam')).toEqual([{ label: 'Gamma' }])
    })

    it('ignores records that have none of the search fields', () => {
      expect(applySearch(items, 'delta')).toEqual([])
    })

    it('honors a custom field list', () => {
      expect(applySearch(items, 'delta', ['other'])).toEqual([{ other: 'Delta' }])
    })
  })
})

describe('helpers/errors', () => {
  const { FRIENDLY_HINTS, extractCloseError, wrapError } = require('../src/helpers/errors')

  describe('extractCloseError', () => {
    it('returns empty fields for a nullish error', () => {
      expect(extractCloseError(null)).toEqual({ status: undefined, message: null, raw: undefined })
    })

    const statusCases = [
      ['status', { status: 404, body: { error: 'x' } }, 404],
      ['statusCode', { statusCode: 500, body: { error: 'x' } }, 500],
      ['code', { code: 'ECONNRESET', body: { error: 'x' } }, 'ECONNRESET'],
    ]

    it.each(statusCases)('reads status from %s', (_label, error, expected) => {
      expect(extractCloseError(error).status).toBe(expected)
    })

    const messageCases = [
      ['body.error', { body: { error: 'boom' } }, 'boom'],
      ['body.message', { body: { message: 'boom' } }, 'boom'],
      ['body.errors array', { body: { errors: ['a', 'b'] } }, 'a; b'],
      ['body field-errors', { body: { 'field-errors': { name: 'required' } } }, 'name: required'],
      ['multi-valued field-errors', { body: { 'field-errors': { name: ['required', 'too short'] } } }, 'name: required, too short'],
      ['multiple field-errors', { body: { 'field-errors': { a: 'x', b: 'y' } } }, 'a: x; b: y'],
      ['a JSON string body', { body: '{"error":"parsed"}' }, 'parsed'],
      ['a plain string body', { body: 'plain failure' }, 'plain failure'],
      ['error.message fallback', { message: 'from message' }, 'from message'],
      ['a JSON message', { message: '{"error":"json message"}' }, 'json message'],
    ]

    it.each(messageCases)('extracts the message from %s', (_label, error, expected) => {
      expect(extractCloseError(error).message).toBe(expected)
    })

    it('returns a null message when nothing usable is present', () => {
      expect(extractCloseError({ body: { unrelated: true } }).message).toBeNull()
    })

    it('exposes the parsed body as raw', () => {
      expect(extractCloseError({ body: '{"error":"e","extra":1}' }).raw).toEqual({ error: 'e', extra: 1 })
    })
  })

  describe('wrapError', () => {
    it('composes tag, status, message and hint', () => {
      const wrapped = wrapError({ status: 429, body: { error: 'slow down' } }, 'listLeads')

      expect(wrapped).toBeInstanceOf(Error)
      expect(wrapped.message).toBe(`[listLeads] — Close CRM 429 — slow down — ${ FRIENDLY_HINTS[429] }`)
      expect(wrapped.status).toBe(429)
    })

    it('omits the tag when none is supplied', () => {
      expect(wrapError({ status: 404, body: { error: 'missing' } }).message)
        .toBe(`Close CRM 404 — missing — ${ FRIENDLY_HINTS[404] }`)
    })

    it('omits the hint for statuses without one', () => {
      expect(wrapError({ status: 418, body: { error: 'teapot' } }, 'tag').message)
        .toBe('[tag] — Close CRM 418 — teapot')
    })

    it('falls back to a generic message when there is no status', () => {
      expect(wrapError({}, 'tag').message).toBe('[tag] — Close CRM error')
    })

    it('preserves the original error as cause', () => {
      const original = new Error('root')

      expect(wrapError(original, 'tag').cause).toBe(original)
    })

    it.each(Object.keys(FRIENDLY_HINTS))('includes the friendly hint for status %s', status => {
      expect(wrapError({ status: Number(status) }, 'tag').message).toContain(FRIENDLY_HINTS[status])
    })
  })
})

describe('helpers/pagination', () => {
  const { paginateOffset, paginateCursor } = require('../src/helpers/pagination')

  describe('paginateOffset', () => {
    it('stops after the first page when has_more is false', async () => {
      const fetcher = jest.fn().mockResolvedValue({ data: [{ id: 1 }], has_more: false })

      await expect(paginateOffset(fetcher)).resolves.toEqual([{ id: 1 }])
      expect(fetcher).toHaveBeenCalledTimes(1)
      expect(fetcher).toHaveBeenCalledWith({ _limit: 100, _skip: 0 })
    })

    it('advances _skip by the page limit across pages', async () => {
      const fetcher = jest.fn()
        .mockResolvedValueOnce({ data: [{ id: 1 }], has_more: true })
        .mockResolvedValueOnce({ data: [{ id: 2 }], has_more: true })
        .mockResolvedValueOnce({ data: [{ id: 3 }], has_more: false })

      await expect(paginateOffset(fetcher, { limit: 2 })).resolves.toEqual([{ id: 1 }, { id: 2 }, { id: 3 }])
      expect(fetcher.mock.calls.map(c => c[0]._skip)).toEqual([0, 2, 4])
    })

    it('stops when a page comes back empty even if has_more is true', async () => {
      const fetcher = jest.fn().mockResolvedValue({ data: [], has_more: true })

      await expect(paginateOffset(fetcher)).resolves.toEqual([])
      expect(fetcher).toHaveBeenCalledTimes(1)
    })

    it('stops on a nullish response', async () => {
      const fetcher = jest.fn().mockResolvedValue(null)

      await expect(paginateOffset(fetcher)).resolves.toEqual([])
      expect(fetcher).toHaveBeenCalledTimes(1)
    })

    it('honors the maxPages cap', async () => {
      const fetcher = jest.fn().mockResolvedValue({ data: [{ id: 1 }], has_more: true })

      await expect(paginateOffset(fetcher, { limit: 1, maxPages: 3 })).resolves.toHaveLength(3)
      expect(fetcher).toHaveBeenCalledTimes(3)
    })

    it('bails out at the MAX_SKIP ceiling', async () => {
      const fetcher = jest.fn().mockResolvedValue({ data: [{ id: 1 }], has_more: true })

      await paginateOffset(fetcher, { limit: 9000, maxPages: 50 })

      // First page skip=0, second attempt would exceed MAX_SKIP so the walk stops.
      expect(fetcher).toHaveBeenCalledTimes(1)
    })
  })

  describe('paginateCursor', () => {
    it('stops when the first page returns no cursor', async () => {
      const fetcher = jest.fn().mockResolvedValue({ data: [{ id: 1 }], cursor: null })

      await expect(paginateCursor(fetcher)).resolves.toEqual([{ id: 1 }])
      expect(fetcher).toHaveBeenCalledWith({ cursor: null, _limit: 50 })
    })

    it('follows cursors across pages', async () => {
      const fetcher = jest.fn()
        .mockResolvedValueOnce({ data: [{ id: 1 }], cursor: 'c2' })
        .mockResolvedValueOnce({ data: [{ id: 2 }], cursor: null })

      await expect(paginateCursor(fetcher, { limit: 10 })).resolves.toEqual([{ id: 1 }, { id: 2 }])
      expect(fetcher.mock.calls[1][0]).toEqual({ cursor: 'c2', _limit: 10 })
    })

    it('honors the maxPages cap', async () => {
      const fetcher = jest.fn().mockResolvedValue({ data: [{ id: 1 }], cursor: 'always' })

      await expect(paginateCursor(fetcher, { maxPages: 2 })).resolves.toHaveLength(2)
      expect(fetcher).toHaveBeenCalledTimes(2)
    })

    it('stops on a nullish response', async () => {
      const fetcher = jest.fn().mockResolvedValue(undefined)

      await expect(paginateCursor(fetcher)).resolves.toEqual([])
      expect(fetcher).toHaveBeenCalledTimes(1)
    })
  })
})

describe('helpers/search', () => {
  const {
    buildSearchQuery,
    smartViewNode,
    objectTypeNode,
    fieldCondition,
    customFieldCondition,
    textExact,
    textContains,
    momentRange,
    reference,
    looksLikeNativeQuery,
  } = require('../src/helpers/search')

  describe('node builders', () => {
    it('builds an object_type node', () => {
      expect(objectTypeNode('lead')).toEqual({ type: 'object_type', object_type: 'lead' })
    })

    it('builds a regular field condition', () => {
      expect(fieldCondition('lead', 'status_label', { type: 'text' })).toEqual({
        type: 'field_condition',
        field: { type: 'regular_field', object_type: 'lead', field_name: 'status_label' },
        condition: { type: 'text' },
      })
    })

    it('builds a custom field condition', () => {
      expect(customFieldCondition('cf_1', { type: 'text' })).toEqual({
        type: 'field_condition',
        field: { type: 'custom_field', custom_field_id: 'cf_1' },
        condition: { type: 'text' },
      })
    })

    it('builds exact and phrase text conditions and stringifies values', () => {
      expect(textExact(42)).toEqual({ type: 'text', mode: 'exact_value', value: '42' })
      expect(textContains('acme')).toEqual({ type: 'text', mode: 'phrase', value: 'acme' })
    })

    it('builds moment ranges with only the supplied bounds', () => {
      expect(momentRange({ after: 'A', before: 'B' })).toEqual({ type: 'moment_range', after: 'A', before: 'B' })
      expect(momentRange({ after: 'A' })).toEqual({ type: 'moment_range', after: 'A' })
      expect(momentRange({})).toEqual({ type: 'moment_range' })
    })

    it('builds reference nodes from scalars and arrays', () => {
      expect(reference('id_1')).toEqual({ type: 'reference', reference_id: ['id_1'] })
      expect(reference(['a', 'b'])).toEqual({ type: 'reference', reference_id: ['a', 'b'] })
    })

    it('builds a saved-search node', () => {
      expect(smartViewNode('save_1')).toEqual({ type: 'saved_search', saved_search_id: 'save_1' })
    })
  })

  describe('looksLikeNativeQuery', () => {
    const nativeTypes = ['and', 'or', 'not', 'object_type', 'field_condition', 'has_related', 'saved_search']

    it.each(nativeTypes)('recognizes type %s', type => {
      expect(looksLikeNativeQuery({ type })).toBe(true)
    })

    it('rejects non-objects, nullish values and unknown types', () => {
      expect(looksLikeNativeQuery(null)).toBeFalsy()
      expect(looksLikeNativeQuery('and')).toBeFalsy()
      expect(looksLikeNativeQuery({})).toBe(false)
      expect(looksLikeNativeQuery({ type: 'bogus' })).toBe(false)
      expect(looksLikeNativeQuery({ type: 7 })).toBe(false)
    })
  })

  describe('buildSearchQuery', () => {
    it('returns null for empty and string inputs', () => {
      expect(buildSearchQuery(null)).toBeNull()
      expect(buildSearchQuery(undefined)).toBeNull()
      expect(buildSearchQuery('')).toBeNull()
      expect(buildSearchQuery('save_abc')).toBeNull()
    })

    it('passes a native query tree through unchanged', () => {
      const native = { type: 'and', queries: [] }

      expect(buildSearchQuery(native)).toBe(native)
    })

    it('returns the bare object_type node when there are no conditions', () => {
      expect(buildSearchQuery({})).toEqual({ type: 'object_type', object_type: 'lead' })
      expect(buildSearchQuery({ objectType: 'contact' })).toEqual({ type: 'object_type', object_type: 'contact' })
    })

    it('adds a lead status condition from leadStatus', () => {
      const q = buildSearchQuery({ leadStatus: 'Qualified' })

      expect(q.type).toBe('and')
      expect(q.queries[1]).toEqual(fieldCondition('lead', 'status_label', textExact('Qualified')))
    })

    it('adds a lead status condition from the generic status when objectType is lead', () => {
      expect(buildSearchQuery({ status: 'Qualified' }).queries[1])
        .toEqual(fieldCondition('lead', 'status_label', textExact('Qualified')))
    })

    it('adds an opportunity status condition from the generic status', () => {
      expect(buildSearchQuery({ objectType: 'opportunity', status: 'Won' }).queries[1])
        .toEqual(fieldCondition('opportunity', 'status_label', textExact('Won')))
    })

    it('prefers opportunityStatus over status', () => {
      expect(buildSearchQuery({ objectType: 'opportunity', status: 'Won', opportunityStatus: 'Lost' }).queries[1])
        .toEqual(fieldCondition('opportunity', 'status_label', textExact('Lost')))
    })

    it('ignores pipelineId unless the object type is opportunity', () => {
      expect(buildSearchQuery({ pipelineId: 'pipe_1' })).toEqual(objectTypeNode('lead'))

      expect(buildSearchQuery({ objectType: 'opportunity', pipelineId: 'pipe_1' }).queries[1])
        .toEqual(fieldCondition('opportunity', 'pipeline_id', reference('pipe_1')))
    })

    it('adds contact and user conditions scoped to the object type', () => {
      const q = buildSearchQuery({ objectType: 'contact', contactId: 'cont_1', userId: 'user_1' })

      expect(q.queries[1]).toEqual(fieldCondition('contact', 'contact_id', reference('cont_1')))
      expect(q.queries[2]).toEqual(fieldCondition('contact', 'user_id', reference('user_1')))
    })

    it('ignores assignedToId unless the object type is lead', () => {
      expect(buildSearchQuery({ objectType: 'opportunity', assignedToId: 'user_1' })).toEqual(objectTypeNode('opportunity'))

      expect(buildSearchQuery({ assignedToId: 'user_1' }).queries[1])
        .toEqual(fieldCondition('lead', 'lead_owner_id', reference('user_1')))
    })

    it('adds created and updated moment ranges', () => {
      const q = buildSearchQuery({ createdAfter: 'A', updatedBefore: 'B' })

      expect(q.queries[1]).toEqual(fieldCondition('lead', 'date_created', momentRange({ after: 'A' })))
      expect(q.queries[2]).toEqual(fieldCondition('lead', 'date_updated', momentRange({ before: 'B' })))
    })

    it('adds custom field conditions and skips empty values', () => {
      const q = buildSearchQuery({ customFields: { cf_a: 'x', cf_b: '', cf_c: null, cf_d: undefined } })

      expect(q.queries).toHaveLength(2)
      expect(q.queries[1]).toEqual(customFieldCondition('cf_a', textExact('x')))
    })

    it('ignores a non-object customFields value', () => {
      expect(buildSearchQuery({ customFields: 'nope' })).toEqual(objectTypeNode('lead'))
    })

    it('appends only native condition nodes from conditions', () => {
      const native = { type: 'field_condition', field: {}, condition: {} }
      const q = buildSearchQuery({ conditions: [native, { type: 'bogus' }, 'string'] })

      expect(q.queries).toEqual([objectTypeNode('lead'), native])
    })

    it('honors a custom top-level operator', () => {
      expect(buildSearchQuery({ leadStatus: 'Q', operator: 'or' }).type).toBe('or')
    })
  })
})

describe('helpers/webhooks', () => {
  const crypto = require('crypto')
  const { verifySignature, rawBodyOf, headersOf } = require('../src/helpers/webhooks')

  const KEY_HEX = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'

  function sign(key, timestamp, rawBody) {
    return crypto.createHmac('sha256', Buffer.from(key, 'hex')).update(String(timestamp) + rawBody).digest('hex')
  }

  describe('verifySignature', () => {
    const nowTs = () => String(Math.floor(Date.now() / 1000))

    it('accepts a correctly signed payload', () => {
      const timestamp = nowTs()
      const rawBody = '{"event":{"object_type":"lead"}}'

      expect(verifySignature({
        signatureKey: KEY_HEX,
        timestamp,
        rawBody,
        signature: sign(KEY_HEX, timestamp, rawBody),
      })).toBe(true)
    })

    const missingCases = [
      ['signatureKey', 'signatureKey'],
      ['timestamp', 'timestamp'],
      ['rawBody', 'rawBody'],
      ['signature', 'signature'],
    ]

    it.each(missingCases)('returns false when %s is missing', (_label, field) => {
      const timestamp = nowTs()
      const rawBody = '{}'
      const args = { signatureKey: KEY_HEX, timestamp, rawBody, signature: sign(KEY_HEX, timestamp, rawBody) }
      delete args[field]

      expect(verifySignature(args)).toBe(false)
    })

    it('returns false when the timestamp is not numeric', () => {
      const rawBody = '{}'

      expect(verifySignature({
        signatureKey: KEY_HEX,
        timestamp: 'not-a-number',
        rawBody,
        signature: sign(KEY_HEX, 'not-a-number', rawBody),
      })).toBe(false)
    })

    it('returns false when the timestamp is outside the tolerance window', () => {
      const rawBody = '{}'
      const stale = String(Math.floor(Date.now() / 1000) - 301)

      expect(verifySignature({
        signatureKey: KEY_HEX,
        timestamp: stale,
        rawBody,
        signature: sign(KEY_HEX, stale, rawBody),
      })).toBe(false)
    })

    it('accepts a timestamp slightly in the future but within tolerance', () => {
      const rawBody = '{}'
      const future = String(Math.floor(Date.now() / 1000) + 60)

      expect(verifySignature({
        signatureKey: KEY_HEX,
        timestamp: future,
        rawBody,
        signature: sign(KEY_HEX, future, rawBody),
      })).toBe(true)
    })

    it('returns false when the signature was produced with a different key', () => {
      const timestamp = nowTs()
      const rawBody = '{}'

      expect(verifySignature({
        signatureKey: KEY_HEX,
        timestamp,
        rawBody,
        signature: sign('ffffffffffffffffffffffffffffffff', timestamp, rawBody),
      })).toBe(false)
    })

    it('returns false when the body differs from the signed body', () => {
      const timestamp = nowTs()

      expect(verifySignature({
        signatureKey: KEY_HEX,
        timestamp,
        rawBody: '{"tampered":true}',
        signature: sign(KEY_HEX, timestamp, '{"original":true}'),
      })).toBe(false)
    })

    it('returns false for a signature of the wrong length instead of throwing', () => {
      expect(verifySignature({
        signatureKey: KEY_HEX,
        timestamp: nowTs(),
        rawBody: '{}',
        signature: 'abcd',
      })).toBe(false)
    })
  })

  describe('rawBodyOf', () => {
    it('returns an empty string for a nullish invocation', () => {
      expect(rawBodyOf(null)).toBe('')
      expect(rawBodyOf(undefined)).toBe('')
    })

    it('prefers a string rawBody', () => {
      expect(rawBodyOf({ rawBody: 'raw', body: { a: 1 } })).toBe('raw')
    })

    it('decodes a Buffer rawBody as utf8', () => {
      expect(rawBodyOf({ rawBody: Buffer.from('buffered') })).toBe('buffered')
    })

    it('uses a string body', () => {
      expect(rawBodyOf({ body: 'string body' })).toBe('string body')
    })

    it('serializes an object body', () => {
      expect(rawBodyOf({ body: { a: 1 } })).toBe('{"a":1}')
    })

    it('returns an empty string when nothing usable is present', () => {
      expect(rawBodyOf({})).toBe('')
      expect(rawBodyOf({ body: 42 })).toBe('')
    })
  })

  describe('headersOf', () => {
    it('returns an empty object when there are no headers', () => {
      expect(headersOf(undefined)).toEqual({})
      expect(headersOf({})).toEqual({})
    })

    it('lowercases header names', () => {
      expect(headersOf({ headers: { 'Close-Sig-Hash': 'abc', 'X-Other': 1 } }))
        .toEqual({ 'close-sig-hash': 'abc', 'x-other': 1 })
    })

    it('falls back to queryParams.headers', () => {
      expect(headersOf({ queryParams: { headers: { 'Close-Sig-Timestamp': '123' } } }))
        .toEqual({ 'close-sig-timestamp': '123' })
    })
  })
})

describe('helpers/logger', () => {
  const { logger } = require('../src/helpers/logger')

  const levels = ['info', 'debug', 'error', 'warn']

  it.each(levels)('%s writes a prefixed line to console.log', level => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {})

    try {
      logger[level]('message', 1)
      expect(spy).toHaveBeenCalledWith(`[Close CRM Service] ${ level }:`, 'message', 1)
    } finally {
      spy.mockRestore()
    }
  })
})
