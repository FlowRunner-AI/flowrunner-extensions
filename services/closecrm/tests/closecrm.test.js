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
})
