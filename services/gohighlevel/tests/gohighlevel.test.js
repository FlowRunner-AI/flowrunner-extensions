'use strict'

const { createSandbox } = require('../../../service-sandbox')

const CLIENT_ID = 'test-client-id'
const CLIENT_SECRET = 'test-client-secret'
const BASE = 'https://services.leadconnectorhq.com'
const OAUTH_TOKEN_URL = `${BASE}/oauth/token`
const API_VERSION = '2021-07-28'
const API_VERSION_LEGACY = '2021-04-15'

// A minimal JWT payload for testing token decoding. The service reads location/company from the JWT claims.
const TOKEN_PAYLOAD = { authClass: 'Location', authClassId: 'loc_test123', companyId: 'comp_test456', locationId: 'loc_test123' }
const FAKE_ACCESS_TOKEN = `header.${Buffer.from(JSON.stringify(TOKEN_PAYLOAD)).toString('base64')}.signature`

describe('GoHighLevel Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET })
    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()

    // Simulate the OAuth access token header that the runtime injects.
    service.request = { headers: { 'oauth-access-token': FAKE_ACCESS_TOKEN } }
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

  // ── OAuth2 System Methods ──

  describe('getOAuth2ConnectionURL', () => {
    it('returns a valid connection URL with client_id and scopes', async () => {
      const url = await service.getOAuth2ConnectionURL()

      expect(url).toContain('https://marketplace.gohighlevel.com/oauth/chooselocation')
      expect(url).toContain(`client_id=${CLIENT_ID}`)
      expect(url).toContain('response_type=code')
      expect(url).toContain('scope=')
    })
  })

  describe('executeCallback', () => {
    it('exchanges auth code for tokens and fetches location info', async () => {
      const tokenResponse = {
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        expires_in: 86400,
        locationId: 'loc_123',
      }
      const locationResponse = {
        location: { name: 'Test Location', logoUrl: 'https://example.com/logo.png' },
      }

      mock.onPost(OAUTH_TOKEN_URL).reply(tokenResponse)
      mock.onGet(`${BASE}/locations/loc_123`).reply(locationResponse)

      const result = await service.executeCallback({
        code: 'auth-code-123',
        redirectURI: 'https://app.example.com/callback',
      })

      expect(result).toEqual({
        token: 'new-access-token',
        refreshToken: 'new-refresh-token',
        expirationInSeconds: 86400,
        connectionIdentityName: 'Test Location',
        connectionIdentityImageURL: 'https://example.com/logo.png',
        overwrite: true,
      })

      // Verify token exchange request
      expect(mock.history[0].url).toBe(OAUTH_TOKEN_URL)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].headers).toMatchObject({ 'Content-Type': 'application/x-www-form-urlencoded' })
      const body = mock.history[0].body
      expect(body).toContain('grant_type=authorization_code')
      expect(body).toContain(`client_id=${CLIENT_ID}`)
      expect(body).toContain(`client_secret=${CLIENT_SECRET}`)
      expect(body).toContain('code=auth-code-123')
    })

    it('falls back to default identity name when location fetch fails', async () => {
      const tokenResponse = {
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        expires_in: 86400,
        locationId: 'loc_123',
      }

      mock.onPost(OAUTH_TOKEN_URL).reply(tokenResponse)
      mock.onGet(`${BASE}/locations/loc_123`).replyWithError({ message: 'Not found' })

      const result = await service.executeCallback({
        code: 'auth-code-123',
        redirectURI: 'https://app.example.com/callback',
      })

      expect(result.connectionIdentityName).toBe('GoHighLevel Account')
      expect(result.connectionIdentityImageURL).toBeUndefined()
    })
  })

  describe('refreshToken', () => {
    it('refreshes the access token', async () => {
      const tokenResponse = {
        access_token: 'refreshed-token',
        refresh_token: 'new-refresh-token',
        expires_in: 86400,
      }

      mock.onPost(OAUTH_TOKEN_URL).reply(tokenResponse)

      const result = await service.refreshToken('old-refresh-token')

      expect(result).toEqual({
        token: 'refreshed-token',
        expirationInSeconds: 86400,
        refreshToken: 'new-refresh-token',
      })

      const body = mock.history[0].body
      expect(body).toContain('grant_type=refresh_token')
      expect(body).toContain(`client_id=${CLIENT_ID}`)
      expect(body).toContain(`client_secret=${CLIENT_SECRET}`)
      expect(body).toContain('refresh_token=old-refresh-token')
    })

    it('throws on token refresh failure', async () => {
      mock.onPost(OAUTH_TOKEN_URL).replyWithError({ message: 'Invalid refresh token' })

      await expect(service.refreshToken('invalid-token')).rejects.toThrow()
    })
  })

  // ── Dictionaries ──

  describe('getContactsDictionary', () => {
    it('returns formatted contact items', async () => {
      mock.onPost(`${BASE}/contacts/search`).reply({
        contacts: [
          { id: 'c1', firstName: 'John', lastName: 'Doe', email: 'john@example.com' },
          { id: 'c2', firstName: 'Jane', lastName: '', email: '' },
        ],
      })

      const result = await service.getContactsDictionary({ search: 'john' })

      expect(result.items).toHaveLength(2)
      expect(result.items[0]).toEqual({
        label: 'John Doe (john@example.com)',
        value: 'c1',
        note: 'ID: c1',
      })
      expect(result.items[1].label).toBe('Jane')
      expect(result.cursor).toBeNull()
    })

    it('sends search query in request body', async () => {
      mock.onPost(`${BASE}/contacts/search`).reply({ contacts: [] })

      await service.getContactsDictionary({ search: 'test' })

      expect(mock.history[0].body).toMatchObject({ query: 'test' })
    })

    it('returns empty items on error', async () => {
      mock.onPost(`${BASE}/contacts/search`).replyWithError({ message: 'Error' })

      const result = await service.getContactsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('handles contact with no name', async () => {
      mock.onPost(`${BASE}/contacts/search`).reply({
        contacts: [{ id: 'c3', firstName: '', lastName: '', email: 'no-name@test.com' }],
      })

      const result = await service.getContactsDictionary({})

      expect(result.items[0].label).toBe('[No Name] (no-name@test.com)')
    })
  })

  describe('getUsersDictionary', () => {
    it('returns formatted user items', async () => {
      mock.onGet(`${BASE}/users/search`).reply({
        users: [{ id: 'u1', name: 'Admin User', email: 'admin@example.com' }],
      })

      const result = await service.getUsersDictionary({})

      expect(result.items[0]).toEqual({
        label: 'Admin User (admin@example.com)',
        value: 'u1',
        note: 'ID: u1',
      })
      expect(mock.history[0].query).toMatchObject({ companyId: 'comp_test456', locationId: 'loc_test123' })
    })

    it('applies search filter via API query', async () => {
      mock.onGet(`${BASE}/users/search`).reply({ users: [] })

      await service.getUsersDictionary({ search: 'admin' })

      expect(mock.history[0].query).toMatchObject({ query: 'admin' })
    })
  })

  describe('getPipelinesDictionary', () => {
    it('returns pipeline items with local search filtering', async () => {
      mock.onGet(`${BASE}/opportunities/pipelines`).reply({
        pipelines: [
          { id: 'p1', name: 'Sales Pipeline' },
          { id: 'p2', name: 'Support Pipeline' },
        ],
      })

      const result = await service.getPipelinesDictionary({ search: 'Sales' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toBe('Sales Pipeline')
    })
  })

  describe('getPipelineStagesDictionary', () => {
    it('returns stages for the specified pipeline', async () => {
      mock.onGet(`${BASE}/opportunities/pipelines`).reply({
        pipelines: [
          { id: 'p1', name: 'Sales', stages: [{ id: 's1', name: 'Qualified' }, { id: 's2', name: 'Proposal' }] },
        ],
      })

      const result = await service.getPipelineStagesDictionary({ criteria: { pipelineId: 'p1' } })

      expect(result.items).toHaveLength(2)
      expect(result.items[0]).toEqual({ label: 'Qualified', value: 's1', note: 'ID: s1' })
    })

    it('returns empty items when no pipelineId is provided', async () => {
      const result = await service.getPipelineStagesDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
      expect(mock.history).toHaveLength(0)
    })

    it('returns empty items when pipeline not found', async () => {
      mock.onGet(`${BASE}/opportunities/pipelines`).reply({ pipelines: [] })

      const result = await service.getPipelineStagesDictionary({ criteria: { pipelineId: 'nonexistent' } })

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getOpportunitiesDictionary', () => {
    it('returns opportunity items with monetary value', async () => {
      mock.onGet(`${BASE}/opportunities/search`).reply({
        opportunities: [{ id: 'o1', name: 'Deal', monetaryValue: 5000 }],
      })

      const result = await service.getOpportunitiesDictionary({})

      expect(result.items[0].label).toBe('Deal ($5000)')
    })

    it('handles opportunities without monetary value', async () => {
      mock.onGet(`${BASE}/opportunities/search`).reply({
        opportunities: [{ id: 'o1', name: 'Deal', monetaryValue: null }],
      })

      const result = await service.getOpportunitiesDictionary({})

      expect(result.items[0].label).toBe('Deal')
    })
  })

  describe('getCalendarsDictionary', () => {
    it('returns calendar items using legacy API version', async () => {
      mock.onGet(`${BASE}/calendars/`).reply({
        calendars: [{ id: 'cal1', name: 'Sales Calls' }],
      })

      const result = await service.getCalendarsDictionary({})

      expect(result.items[0]).toEqual({ label: 'Sales Calls', value: 'cal1', note: 'ID: cal1' })
      // Calendars use legacy API version
      expect(mock.history[0].headers).toMatchObject({ Version: API_VERSION_LEGACY })
    })
  })

  describe('getConversationsDictionary', () => {
    it('truncates long messages in labels', async () => {
      const longMessage = 'A'.repeat(100)

      mock.onGet(`${BASE}/conversations/search`).reply({
        conversations: [{ id: 'conv1', contactName: 'John', lastMessageBody: longMessage }],
      })

      const result = await service.getConversationsDictionary({})

      expect(result.items[0].label).toBe(`John - ${'A'.repeat(50)}...`)
    })
  })

  describe('getBusinessesDictionary', () => {
    it('returns business items with local search', async () => {
      mock.onGet(`${BASE}/businesses/`).reply({
        businesses: [{ id: 'b1', name: 'Acme Corp' }, { id: 'b2', name: 'Widget Inc' }],
      })

      const result = await service.getBusinessesDictionary({ search: 'Acme' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toBe('Acme Corp')
    })
  })

  describe('getTagsDictionary', () => {
    it('returns tag items', async () => {
      mock.onGet(`${BASE}/locations/loc_test123/tags`).reply({
        tags: [{ id: 't1', name: 'VIP' }],
      })

      const result = await service.getTagsDictionary({})

      expect(result.items[0]).toEqual({ label: 'VIP', value: 't1', note: 'ID: t1' })
    })
  })

  describe('getWorkflowsDictionary', () => {
    it('returns workflow items', async () => {
      mock.onGet(`${BASE}/workflows/`).reply({
        workflows: [{ id: 'w1', name: 'Follow-Up' }],
      })

      const result = await service.getWorkflowsDictionary({})

      expect(result.items[0]).toEqual({ label: 'Follow-Up', value: 'w1', note: 'ID: w1' })
    })
  })

  describe('getFormsDictionary', () => {
    it('returns form items', async () => {
      mock.onGet(`${BASE}/forms/`).reply({
        forms: [{ id: 'f1', name: 'Contact Us' }],
      })

      const result = await service.getFormsDictionary({})

      expect(result.items[0]).toEqual({ label: 'Contact Us', value: 'f1', note: 'ID: f1' })
    })
  })

  describe('getInvoicesDictionary', () => {
    it('returns invoice items with amount', async () => {
      mock.onGet(`${BASE}/invoices/`).reply({
        invoices: [{ id: 'inv1', name: 'Web Design', invoiceNumber: 'INV-001', amount: 2500 }],
      })

      const result = await service.getInvoicesDictionary({})

      expect(result.items[0].label).toBe('Web Design ($2500)')
    })
  })

  describe('getProductsDictionary', () => {
    it('returns product items with price', async () => {
      mock.onGet(`${BASE}/products/`).reply({
        products: [{ id: 'prod1', name: 'Premium Plan', price: 99 }],
      })

      const result = await service.getProductsDictionary({})

      expect(result.items[0].label).toBe('Premium Plan ($99)')
    })
  })

  describe('getCustomFieldsDictionary', () => {
    it('returns custom field items with field key', async () => {
      mock.onGet(`${BASE}/locations/loc_test123/customFields`).reply({
        customFields: [{ id: 'cf1', name: 'pincode', fieldKey: 'contact.pincode' }],
      })

      const result = await service.getCustomFieldsDictionary({})

      expect(result.items[0]).toEqual({
        label: 'pincode (contact.pincode)',
        value: 'cf1',
        note: 'ID: cf1',
      })
    })
  })

  // ── Custom Fields ──

  describe('listCustomFields', () => {
    it('sends correct request with model resolved', async () => {
      mock.onGet(`${BASE}/locations/loc_test123/customFields`).reply({ customFields: [] })

      await service.listCustomFields('Contact')

      expect(mock.history[0].query).toMatchObject({ model: 'contact' })
      expect(mock.history[0].headers).toMatchObject({
        Authorization: `Bearer ${FAKE_ACCESS_TOKEN}`,
        Version: API_VERSION,
      })
    })

    it('uses explicit locationId when provided', async () => {
      mock.onGet(`${BASE}/locations/loc_explicit/customFields`).reply({ customFields: [] })

      await service.listCustomFields(undefined, 'loc_explicit')

      expect(mock.history[0].url).toBe(`${BASE}/locations/loc_explicit/customFields`)
    })
  })

  // ── Contacts ──

  describe('searchContacts', () => {
    it('sends POST with query, limit and page in body', async () => {
      mock.onPost(`${BASE}/contacts/search`).reply({ contacts: [], total: 0 })

      const result = await service.searchContacts('john', undefined, 10, 2)

      expect(result).toEqual({ contacts: [], total: 0 })
      expect(mock.history[0].body).toMatchObject({
        locationId: 'loc_test123',
        query: 'john',
        pageLimit: 10,
        page: 2,
      })
    })
  })

  describe('getContactById', () => {
    it('sends GET with contact ID in URL', async () => {
      mock.onGet(`${BASE}/contacts/c1`).reply({ contact: { id: 'c1' } })

      const result = await service.getContactById('c1')

      expect(result.contact.id).toBe('c1')
    })
  })

  describe('createContact', () => {
    it('sends POST with all fields and splits tags', async () => {
      mock.onPost(`${BASE}/contacts/`).reply({ contact: { id: 'c_new' } })

      await service.createContact(undefined, 'John', 'Doe', 'j@test.com', '+15551234567', '123 Main', 'Austin', 'TX', '78701', 'lead, vip', 'website')

      expect(mock.history[0].body).toMatchObject({
        locationId: 'loc_test123',
        firstName: 'John',
        lastName: 'Doe',
        email: 'j@test.com',
        phone: '+15551234567',
        tags: ['lead', 'vip'],
        source: 'website',
      })
    })

    it('omits optional fields when not provided', async () => {
      mock.onPost(`${BASE}/contacts/`).reply({ contact: { id: 'c_new' } })

      await service.createContact(undefined, 'John')

      const body = mock.history[0].body
      expect(body.firstName).toBe('John')
      expect(body.email).toBeUndefined()
      expect(body.tags).toBeUndefined()
    })
  })

  describe('updateContact', () => {
    it('sends PUT with contact ID in URL', async () => {
      mock.onPut(`${BASE}/contacts/c1`).reply({ contact: { id: 'c1' } })

      await service.updateContact('c1', 'Jane', 'Updated')

      expect(mock.history[0].url).toBe(`${BASE}/contacts/c1`)
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].body).toMatchObject({ firstName: 'Jane', lastName: 'Updated' })
    })
  })

  describe('upsertContact', () => {
    it('sends POST to upsert endpoint with all fields', async () => {
      mock.onPost(`${BASE}/contacts/upsert`).reply({ new: true, contact: { id: 'c_upsert' } })

      await service.upsertContact(undefined, 'Jane', 'Smith', undefined, 'jane@test.com', '+15559876543', undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'lead, vip', undefined, 'website')

      expect(mock.history[0].body).toMatchObject({
        locationId: 'loc_test123',
        firstName: 'Jane',
        lastName: 'Smith',
        email: 'jane@test.com',
        tags: ['lead', 'vip'],
        source: 'website',
      })
    })
  })

  describe('deleteContact', () => {
    it('sends DELETE with contact ID', async () => {
      mock.onDelete(`${BASE}/contacts/c1`).reply({ succeeded: true })

      const result = await service.deleteContact('c1')

      expect(result.succeeded).toBe(true)
      expect(mock.history[0].method).toBe('delete')
    })
  })

  // ── Opportunities ──

  describe('searchOpportunities', () => {
    it('sends GET with query params', async () => {
      mock.onGet(`${BASE}/opportunities/search`).reply({ opportunities: [], total: 0 })

      await service.searchOpportunities('deal', undefined, 'pipe1', 10, 2)

      expect(mock.history[0].query).toMatchObject({
        location_id: 'loc_test123',
        q: 'deal',
        pipeline_id: 'pipe1',
        limit: 10,
        page: 2,
      })
    })
  })

  describe('getOpportunityById', () => {
    it('sends GET with opportunity ID', async () => {
      mock.onGet(`${BASE}/opportunities/opp1`).reply({ opportunity: { id: 'opp1' } })

      const result = await service.getOpportunityById('opp1')

      expect(result.opportunity.id).toBe('opp1')
    })
  })

  describe('createOpportunity', () => {
    it('sends POST with resolved status from dropdown label', async () => {
      mock.onPost(`${BASE}/opportunities/`).reply({ opportunity: { id: 'opp_new' } })

      await service.createOpportunity('pipe1', undefined, 'stage1', 'c1', 'New Deal', 10000, 'Won')

      expect(mock.history[0].body).toMatchObject({
        pipelineId: 'pipe1',
        locationId: 'loc_test123',
        pipelineStageId: 'stage1',
        contactId: 'c1',
        name: 'New Deal',
        monetaryValue: 10000,
        status: 'won',
      })
    })

    it('defaults status to open when not provided', async () => {
      mock.onPost(`${BASE}/opportunities/`).reply({ opportunity: { id: 'opp_new' } })

      await service.createOpportunity('pipe1', undefined, 'stage1', 'c1', 'Deal')

      expect(mock.history[0].body.status).toBe('open')
    })
  })

  describe('updateOpportunity', () => {
    it('sends PUT with opportunity ID', async () => {
      mock.onPut(`${BASE}/opportunities/opp1`).reply({ opportunity: { id: 'opp1' } })

      await service.updateOpportunity('opp1', undefined, undefined, 'Updated Name', 7500, 'Lost')

      expect(mock.history[0].body).toMatchObject({
        name: 'Updated Name',
        monetaryValue: 7500,
        status: 'lost',
      })
    })
  })

  describe('updateOpportunityStatus', () => {
    it('sends PUT to status endpoint with resolved value', async () => {
      mock.onPut(`${BASE}/opportunities/opp1/status`).reply({ opportunity: { id: 'opp1', status: 'won' } })

      await service.updateOpportunityStatus('opp1', 'Won')

      expect(mock.history[0].body).toEqual({ status: 'won' })
    })
  })

  describe('deleteOpportunity', () => {
    it('sends DELETE with opportunity ID', async () => {
      mock.onDelete(`${BASE}/opportunities/opp1`).reply({ succeeded: true })

      await service.deleteOpportunity('opp1')

      expect(mock.history[0].method).toBe('delete')
    })
  })

  // ── Conversations / Messages ──

  describe('sendMessage', () => {
    it('sends POST with resolved message type', async () => {
      mock.onPost(`${BASE}/conversations/messages`).reply({ messageId: 'msg1' })

      await service.sendMessage('c1', 'WhatsApp', 'Hello!', undefined, undefined)

      expect(mock.history[0].body).toMatchObject({
        contactId: 'c1',
        type: 'WhatsApp',
        message: 'Hello!',
      })
      // Conversations use legacy API version
      expect(mock.history[0].headers).toMatchObject({ Version: API_VERSION_LEGACY })
    })

    it('resolves Instagram to IG', async () => {
      mock.onPost(`${BASE}/conversations/messages`).reply({ messageId: 'msg2' })

      await service.sendMessage('c1', 'Instagram', 'Hi')

      expect(mock.history[0].body.type).toBe('IG')
    })

    it('resolves Facebook to FB', async () => {
      mock.onPost(`${BASE}/conversations/messages`).reply({ messageId: 'msg3' })

      await service.sendMessage('c1', 'Facebook', 'Hi')

      expect(mock.history[0].body.type).toBe('FB')
    })

    it('resolves Live Chat to Live_Chat', async () => {
      mock.onPost(`${BASE}/conversations/messages`).reply({ messageId: 'msg4' })

      await service.sendMessage('c1', 'Live Chat', 'Hi')

      expect(mock.history[0].body.type).toBe('Live_Chat')
    })

    it('includes subject and html for email messages', async () => {
      mock.onPost(`${BASE}/conversations/messages`).reply({ messageId: 'msg5' })

      await service.sendMessage('c1', 'Email', 'Plain text', 'Subject Line', '<h1>HTML</h1>')

      expect(mock.history[0].body).toMatchObject({
        type: 'Email',
        subject: 'Subject Line',
        html: '<h1>HTML</h1>',
      })
    })
  })

  describe('getMessages', () => {
    it('sends GET with conversation ID and limit', async () => {
      mock.onGet(`${BASE}/conversations/conv1/messages`).reply({ messages: [], nextPage: null })

      await service.getMessages('conv1', 10)

      expect(mock.history[0].query).toMatchObject({ limit: 10 })
    })
  })

  describe('getConversationById', () => {
    it('sends GET with conversation ID', async () => {
      mock.onGet(`${BASE}/conversations/conv1`).reply({ id: 'conv1' })

      const result = await service.getConversationById('conv1')

      expect(result.id).toBe('conv1')
    })
  })

  describe('deleteConversation', () => {
    it('sends DELETE with conversation ID', async () => {
      mock.onDelete(`${BASE}/conversations/conv1`).reply({ succeeded: true })

      await service.deleteConversation('conv1')

      expect(mock.history[0].method).toBe('delete')
    })
  })

  // ── Calendar ──

  describe('getCalendars', () => {
    it('sends GET with locationId', async () => {
      mock.onGet(`${BASE}/calendars/`).reply({ calendars: [] })

      await service.getCalendars()

      expect(mock.history[0].query).toMatchObject({ locationId: 'loc_test123' })
      expect(mock.history[0].headers.Version).toBe(API_VERSION_LEGACY)
    })
  })

  describe('getCalendarFreeSlots', () => {
    it('sends GET with calendar ID and date range', async () => {
      mock.onGet(`${BASE}/calendars/cal1/free-slots`).reply({ '2025-04-01': { slots: [] } })

      await service.getCalendarFreeSlots('cal1', 1711929600000, 1712534400000, 'America/Chicago')

      expect(mock.history[0].query).toMatchObject({
        startDate: 1711929600000,
        endDate: 1712534400000,
        timezone: 'America/Chicago',
      })
    })
  })

  describe('createAppointment', () => {
    it('sends POST with resolved appointment status', async () => {
      mock.onPost(`${BASE}/calendars/events/appointments`).reply({ id: 'apt1' })

      await service.createAppointment('cal1', 'c1', '2025-04-01T10:00:00Z', '2025-04-01T11:00:00Z', 'Consultation', 'No Show')

      expect(mock.history[0].body).toMatchObject({
        calendarId: 'cal1',
        contactId: 'c1',
        startTime: '2025-04-01T10:00:00Z',
        endTime: '2025-04-01T11:00:00Z',
        title: 'Consultation',
        appointmentStatus: 'noshow',
      })
    })
  })

  describe('getAppointmentById', () => {
    it('sends GET with appointment ID', async () => {
      mock.onGet(`${BASE}/calendars/events/appointments/apt1`).reply({ id: 'apt1' })

      const result = await service.getAppointmentById('apt1')

      expect(result.id).toBe('apt1')
    })
  })

  describe('updateAppointment', () => {
    it('sends PUT with appointment ID and resolved status', async () => {
      mock.onPut(`${BASE}/calendars/events/appointments/apt1`).reply({ id: 'apt1' })

      await service.updateAppointment('apt1', undefined, undefined, undefined, 'Updated Title', 'Confirmed')

      expect(mock.history[0].body).toMatchObject({
        title: 'Updated Title',
        appointmentStatus: 'confirmed',
      })
    })
  })

  describe('deleteAppointment', () => {
    it('sends DELETE with event ID and empty body', async () => {
      mock.onDelete(`${BASE}/calendars/events/evt1`).reply({ succeeded: true })

      await service.deleteAppointment('evt1')

      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].body).toEqual({})
    })
  })

  // ── Businesses ──

  describe('listBusinesses', () => {
    it('sends GET with locationId and limit', async () => {
      mock.onGet(`${BASE}/businesses/`).reply({ businesses: [] })

      await service.listBusinesses(undefined, 50)

      expect(mock.history[0].query).toMatchObject({ locationId: 'loc_test123', limit: 50 })
    })
  })

  describe('getBusinessById', () => {
    it('sends GET with business ID', async () => {
      mock.onGet(`${BASE}/businesses/biz1`).reply({ business: { id: 'biz1' } })

      const result = await service.getBusinessById('biz1')

      expect(result.business.id).toBe('biz1')
    })
  })

  describe('createBusiness', () => {
    it('sends POST with all fields', async () => {
      mock.onPost(`${BASE}/businesses/`).reply({ business: { id: 'biz_new' } })

      await service.createBusiness('Acme', undefined, 'info@acme.com', '+15551234567', 'https://acme.com', '123 St', 'Austin', 'TX', '78701', 'US', 'A company')

      expect(mock.history[0].body).toMatchObject({
        name: 'Acme',
        locationId: 'loc_test123',
        email: 'info@acme.com',
        website: 'https://acme.com',
        country: 'US',
        description: 'A company',
      })
    })
  })

  describe('updateBusiness', () => {
    it('sends PUT with business ID', async () => {
      mock.onPut(`${BASE}/businesses/biz1`).reply({ business: { id: 'biz1' } })

      await service.updateBusiness('biz1', 'Updated Name')

      expect(mock.history[0].body).toMatchObject({ name: 'Updated Name' })
    })
  })

  describe('deleteBusiness', () => {
    it('sends DELETE with business ID', async () => {
      mock.onDelete(`${BASE}/businesses/biz1`).reply({ succeeded: true })

      await service.deleteBusiness('biz1')

      expect(mock.history[0].method).toBe('delete')
    })
  })

  // ── Tasks ──

  describe('listTasks', () => {
    it('sends GET with contact ID and limit', async () => {
      mock.onGet(`${BASE}/contacts/c1/tasks`).reply({ tasks: [] })

      await service.listTasks('c1', 10)

      expect(mock.history[0].query).toMatchObject({ limit: 10 })
    })
  })

  describe('getTaskById', () => {
    it('sends GET with contact ID and task ID', async () => {
      mock.onGet(`${BASE}/contacts/c1/tasks/t1`).reply({ task: { id: 't1' } })

      const result = await service.getTaskById('c1', 't1')

      expect(result.task.id).toBe('t1')
    })
  })

  describe('createTask', () => {
    it('sends POST with correct body mapping (description -> body)', async () => {
      mock.onPost(`${BASE}/contacts/c1/tasks`).reply({ task: { id: 't_new' } })

      await service.createTask('c1', 'Follow up', '2025-04-15T14:00:00Z', 'Call client', 'u1', true)

      expect(mock.history[0].body).toMatchObject({
        title: 'Follow up',
        dueDate: '2025-04-15T14:00:00Z',
        body: 'Call client',
        assignedTo: 'u1',
        completed: true,
      })
    })

    it('defaults completed to false when not provided', async () => {
      mock.onPost(`${BASE}/contacts/c1/tasks`).reply({ task: { id: 't_new' } })

      await service.createTask('c1', 'Task', '2025-04-15T14:00:00Z')

      expect(mock.history[0].body.completed).toBe(false)
    })
  })

  describe('updateTask', () => {
    it('sends PUT with contact/task IDs and optional completed flag', async () => {
      mock.onPut(`${BASE}/contacts/c1/tasks/t1`).reply({ task: { id: 't1' } })

      await service.updateTask('c1', 't1', 'Updated Title', undefined, undefined, undefined, true)

      expect(mock.history[0].body).toMatchObject({ title: 'Updated Title', completed: true })
    })

    it('omits completed when undefined', async () => {
      mock.onPut(`${BASE}/contacts/c1/tasks/t1`).reply({ task: { id: 't1' } })

      await service.updateTask('c1', 't1', 'Title')

      expect(mock.history[0].body.completed).toBeUndefined()
    })
  })

  describe('deleteTask', () => {
    it('sends DELETE with contact and task IDs', async () => {
      mock.onDelete(`${BASE}/contacts/c1/tasks/t1`).reply({ succeeded: true })

      await service.deleteTask('c1', 't1')

      expect(mock.history[0].method).toBe('delete')
    })
  })

  // ── Notes ──

  describe('listNotes', () => {
    it('sends GET with contact ID', async () => {
      mock.onGet(`${BASE}/contacts/c1/notes`).reply({ notes: [] })

      await service.listNotes('c1', 5)

      expect(mock.history[0].query).toMatchObject({ limit: 5 })
    })
  })

  describe('getNoteById', () => {
    it('sends GET with contact and note IDs', async () => {
      mock.onGet(`${BASE}/contacts/c1/notes/n1`).reply({ note: { id: 'n1' } })

      const result = await service.getNoteById('c1', 'n1')

      expect(result.note.id).toBe('n1')
    })
  })

  describe('createNote', () => {
    it('sends POST with body text', async () => {
      mock.onPost(`${BASE}/contacts/c1/notes`).reply({ note: { id: 'n_new' } })

      await service.createNote('c1', 'This is a note')

      expect(mock.history[0].body).toEqual({ body: 'This is a note' })
    })
  })

  describe('updateNote', () => {
    it('sends PUT with note ID and body', async () => {
      mock.onPut(`${BASE}/contacts/c1/notes/n1`).reply({ note: { id: 'n1' } })

      await service.updateNote('c1', 'n1', 'Updated note')

      expect(mock.history[0].body).toEqual({ body: 'Updated note' })
    })
  })

  describe('deleteNote', () => {
    it('sends DELETE with contact and note IDs', async () => {
      mock.onDelete(`${BASE}/contacts/c1/notes/n1`).reply({ succeeded: true })

      await service.deleteNote('c1', 'n1')

      expect(mock.history[0].method).toBe('delete')
    })
  })

  // ── Tags ──

  describe('listTags', () => {
    it('sends GET with resolved location ID in URL', async () => {
      mock.onGet(`${BASE}/locations/loc_test123/tags`).reply({ tags: [] })

      await service.listTags()

      expect(mock.history[0].url).toBe(`${BASE}/locations/loc_test123/tags`)
    })
  })

  describe('createTag', () => {
    it('sends POST with tag name', async () => {
      mock.onPost(`${BASE}/locations/loc_test123/tags`).reply({ tag: { id: 't_new', name: 'VIP' } })

      await service.createTag('VIP')

      expect(mock.history[0].body).toEqual({ name: 'VIP' })
    })
  })

  describe('addTagsToContact', () => {
    it('sends POST with tag array split from comma-separated string', async () => {
      mock.onPost(`${BASE}/contacts/c1/tags`).reply({ tags: ['VIP', 'Lead'] })

      await service.addTagsToContact('c1', 'VIP, Lead, ')

      expect(mock.history[0].body).toEqual({ tags: ['VIP', 'Lead'] })
    })
  })

  describe('removeTagsFromContact', () => {
    it('sends DELETE with tag array', async () => {
      mock.onDelete(`${BASE}/contacts/c1/tags`).reply({ tags: ['VIP'] })

      await service.removeTagsFromContact('c1', 'VIP')

      expect(mock.history[0].body).toEqual({ tags: ['VIP'] })
    })
  })

  // ── Workflows ──

  describe('triggerWorkflow', () => {
    it('sends POST with contact and workflow IDs in URL', async () => {
      mock.onPost(`${BASE}/contacts/c1/workflow/wf1`).reply({ success: true })

      const result = await service.triggerWorkflow('wf1', 'c1')

      expect(result.success).toBe(true)
      expect(mock.history[0].url).toBe(`${BASE}/contacts/c1/workflow/wf1`)
    })
  })

  // ── Forms ──

  describe('listForms', () => {
    it('sends GET with locationId and limit', async () => {
      mock.onGet(`${BASE}/forms/`).reply({ forms: [] })

      await service.listForms(undefined, 50)

      expect(mock.history[0].query).toMatchObject({ locationId: 'loc_test123', limit: 50 })
    })
  })

  describe('getFormSubmissions', () => {
    it('sends GET with formId and pagination params', async () => {
      mock.onGet(`${BASE}/forms/submissions`).reply({ submissions: [], total: 0 })

      await service.getFormSubmissions('f1', undefined, 10, 2, '2025-01-01', '2025-03-31')

      expect(mock.history[0].query).toMatchObject({
        formId: 'f1',
        locationId: 'loc_test123',
        limit: 10,
        page: 2,
        startAt: '2025-01-01',
        endAt: '2025-03-31',
      })
    })
  })

  // ── Invoices ──

  describe('listInvoices', () => {
    it('sends GET with location as altId and altType', async () => {
      mock.onGet(`${BASE}/invoices/`).reply({ invoices: [] })

      await service.listInvoices(undefined, 'draft', 50)

      expect(mock.history[0].query).toMatchObject({
        altId: 'loc_test123',
        altType: 'location',
        status: 'draft',
        limit: 50,
        offset: 0,
      })
    })

    it('defaults limit to 20', async () => {
      mock.onGet(`${BASE}/invoices/`).reply({ invoices: [] })

      await service.listInvoices()

      expect(mock.history[0].query.limit).toBe(20)
    })
  })

  describe('getInvoiceById', () => {
    it('sends GET with invoice ID and altId query', async () => {
      mock.onGet(`${BASE}/invoices/inv1`).reply({ invoice: { id: 'inv1' } })

      await service.getInvoiceById('inv1')

      expect(mock.history[0].query).toMatchObject({ altId: 'loc_test123', altType: 'location' })
    })
  })

  describe('createInvoice', () => {
    it('fetches contact and sends POST with full invoice body', async () => {
      mock.onGet(`${BASE}/contacts/c1`).reply({
        contact: { id: 'c1', firstName: 'John', lastName: 'Doe', email: 'john@test.com', phone: '+15551234567' },
      })
      mock.onPost(`${BASE}/invoices/`).reply({ invoice: { id: 'inv_new' } })

      const items = [{ name: 'Service', amount: 100, qty: 2, currency: 'USD' }]
      await service.createInvoice('c1', 'Invoice A', 'USD', items, '2025-03-25', '2025-04-30', 'My Biz')

      // First call is getContactById, second is createInvoice
      expect(mock.history).toHaveLength(2)
      const invoiceBody = mock.history[1].body
      expect(invoiceBody.name).toBe('Invoice A')
      expect(invoiceBody.currency).toBe('USD')
      expect(invoiceBody.contactDetails).toMatchObject({
        id: 'c1',
        name: 'John Doe',
        email: 'john@test.com',
      })
      expect(invoiceBody.items).toEqual([{ name: 'Service', amount: 100, qty: 2, currency: 'USD' }])
      expect(invoiceBody.businessDetails).toEqual({ name: 'My Biz' })
      expect(invoiceBody.liveMode).toBe(true)
    })

    it('handles contact fetch failure gracefully', async () => {
      mock.onGet(`${BASE}/contacts/c1`).replyWithError({ message: 'Not found' })
      mock.onPost(`${BASE}/invoices/`).reply({ invoice: { id: 'inv_new' } })

      const items = [{ name: 'Item', amount: 50, qty: 1 }]
      await service.createInvoice('c1', 'Invoice B', 'USD', items, '2025-03-25')

      // Should still create the invoice even if contact fetch failed
      expect(mock.history).toHaveLength(2)
      const invoiceBody = mock.history[1].body
      expect(invoiceBody.contactDetails.id).toBe('c1')
    })
  })

  describe('updateInvoice', () => {
    it('sends PUT with invoice items', async () => {
      mock.onPut(`${BASE}/invoices/inv1`).reply({ invoice: { id: 'inv1' } })

      const items = [{ name: 'Updated Service', amount: 200, qty: 1 }]
      await service.updateInvoice('inv1', 'Updated Invoice', 'USD', items, '2025-03-25', '2025-05-01')

      expect(mock.history[0].body).toMatchObject({
        name: 'Updated Invoice',
        currency: 'USD',
        issueDate: '2025-03-25',
        dueDate: '2025-05-01',
      })
      expect(mock.history[0].body.invoiceItems).toEqual([{ name: 'Updated Service', amount: 200, qty: 1, currency: 'USD' }])
    })
  })

  describe('sendInvoice', () => {
    it('sends POST with resolved delivery method', async () => {
      mock.onPost(`${BASE}/invoices/inv1/send`).reply({ success: true })

      await service.sendInvoice('inv1', 'u1', 'SMS and Email')

      expect(mock.history[0].body).toMatchObject({
        altId: 'loc_test123',
        altType: 'location',
        userId: 'u1',
        action: 'sms_and_email',
        liveMode: true,
      })
    })

    it('defaults delivery method to email', async () => {
      mock.onPost(`${BASE}/invoices/inv1/send`).reply({ success: true })

      await service.sendInvoice('inv1', 'u1')

      expect(mock.history[0].body.action).toBe('email')
    })
  })

  // ── Products ──

  describe('listProducts', () => {
    it('sends GET with search and limit', async () => {
      mock.onGet(`${BASE}/products/`).reply({ products: [] })

      await service.listProducts(undefined, 'plan', 10)

      expect(mock.history[0].query).toMatchObject({
        locationId: 'loc_test123',
        search: 'plan',
        limit: 10,
      })
    })
  })

  describe('getProductById', () => {
    it('sends GET with product ID', async () => {
      mock.onGet(`${BASE}/products/prod1`).reply({ product: { id: 'prod1' } })

      await service.getProductById('prod1')

      expect(mock.history[0].query).toMatchObject({ locationId: 'loc_test123' })
    })
  })

  describe('createProduct', () => {
    it('sends POST with resolved product type', async () => {
      mock.onPost(`${BASE}/products/`).reply({ product: { id: 'prod_new' } })

      await service.createProduct('Basic Plan', 'Service', 'A plan')

      expect(mock.history[0].body).toMatchObject({
        name: 'Basic Plan',
        productType: 'SERVICE',
        description: 'A plan',
        locationId: 'loc_test123',
      })
    })

    it('resolves Physical and Digital product type', async () => {
      mock.onPost(`${BASE}/products/`).reply({ product: { id: 'prod_new' } })

      await service.createProduct('Combo', 'Physical and Digital')

      expect(mock.history[0].body.productType).toBe('PHYSICAL/DIGITAL')
    })
  })

  describe('updateProduct', () => {
    it('sends PUT with product ID and resolved type', async () => {
      mock.onPut(`${BASE}/products/prod1`).reply({ product: { id: 'prod1' } })

      await service.updateProduct('prod1', 'Updated Plan', 'Digital', 'New description')

      expect(mock.history[0].body).toMatchObject({
        name: 'Updated Plan',
        productType: 'DIGITAL',
        description: 'New description',
      })
    })
  })

  describe('createProductPrice', () => {
    it('sends POST with resolved billing type', async () => {
      mock.onPost(`${BASE}/products/prod1/price`).reply({ _id: 'price_new' })

      await service.createProductPrice('prod1', 'Monthly', 'Recurring', 'USD', 99)

      expect(mock.history[0].body).toMatchObject({
        name: 'Monthly',
        type: 'recurring',
        currency: 'USD',
        amount: 99,
        locationId: 'loc_test123',
      })
    })

    it('resolves One Time billing type', async () => {
      mock.onPost(`${BASE}/products/prod1/price`).reply({ _id: 'price_new' })

      await service.createProductPrice('prod1', 'Standard', 'One Time', 'USD', 199)

      expect(mock.history[0].body.type).toBe('one_time')
    })
  })

  describe('deleteProduct', () => {
    it('sends DELETE with product ID and locationId query', async () => {
      mock.onDelete(`${BASE}/products/prod1`).reply({ succeeded: true })

      await service.deleteProduct('prod1')

      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].query).toMatchObject({ locationId: 'loc_test123' })
    })
  })

  // ── Polling Triggers ──

  describe('handleTriggerPollingForEvent', () => {
    it('dispatches to the correct trigger method', async () => {
      mock.onGet(`${BASE}/opportunities/search`).reply({ opportunities: [], meta: {} })

      const result = await service.handleTriggerPollingForEvent({
        eventName: 'onNewOpportunity',
        triggerData: {},
        state: null,
        learningMode: true,
      })

      expect(result).toHaveProperty('events')
      expect(result).toHaveProperty('state')
    })
  })

  describe('onNewOpportunity', () => {
    it('returns sample opportunity in learning mode', async () => {
      const opp = { id: 'opp1', name: 'Deal', createdAt: '2025-01-01T00:00:00Z' }

      mock.onGet(`${BASE}/opportunities/search`).reply({ opportunities: [opp] })

      const result = await service.onNewOpportunity({
        triggerData: {},
        state: null,
        learningMode: true,
      })

      expect(result.events).toEqual([opp])
      expect(result.state).toBeNull()
    })

    it('returns empty events and seeds state on first real cycle', async () => {
      const result = await service.onNewOpportunity({
        triggerData: {},
        state: null,
        learningMode: false,
      })

      expect(result.events).toEqual([])
      expect(result.state).toHaveProperty('since')
      expect(result.state.seenIds).toEqual([])
      expect(result.state.resumeCursor).toBeNull()
      expect(mock.history).toHaveLength(0) // No API call on first seed
    })

    it('polls and deduplicates on subsequent cycles', async () => {
      const opp1 = { id: 'opp1', name: 'Deal 1', createdAt: '2025-03-25T10:00:00Z' }
      const opp2 = { id: 'opp2', name: 'Deal 2', createdAt: '2025-03-25T11:00:00Z' }

      mock.onGet(`${BASE}/opportunities/search`).reply({ opportunities: [opp1, opp2] })

      const result = await service.onNewOpportunity({
        triggerData: {},
        state: { since: Date.now() - 60000, seenIds: ['opp1'], resumeCursor: null },
        learningMode: false,
      })

      // opp1 is in seenIds, so only opp2 should be emitted
      expect(result.events).toEqual([opp2])
      expect(result.state.seenIds).toContain('opp1')
      expect(result.state.seenIds).toContain('opp2')
    })
  })

  describe('onNewFormSubmission', () => {
    it('returns sample submission in learning mode', async () => {
      const sub = { id: 'sub1', createdAt: '2025-03-25T10:00:00Z' }

      mock.onGet(`${BASE}/forms/submissions`).reply({ submissions: [sub] })

      const result = await service.onNewFormSubmission({
        triggerData: {},
        state: null,
        learningMode: true,
      })

      expect(result.events).toEqual([sub])
      expect(result.state).toBeNull()
    })

    it('seeds state on first real cycle with no API call', async () => {
      const result = await service.onNewFormSubmission({
        triggerData: {},
        state: null,
        learningMode: false,
      })

      expect(result.events).toEqual([])
      expect(result.state).toHaveProperty('since')
      expect(result.state.seenIds).toEqual([])
      expect(mock.history).toHaveLength(0)
    })

    it('filters submissions by createdAt and deduplicates', async () => {
      const since = '2025-03-25T10:00:00.000Z'
      const sub1 = { id: 'sub1', createdAt: '2025-03-25T09:00:00Z' } // before since
      const sub2 = { id: 'sub2', createdAt: '2025-03-25T11:00:00Z' } // after since
      const sub3 = { id: 'sub3', createdAt: '2025-03-25T12:00:00Z' } // after since

      mock.onGet(`${BASE}/forms/submissions`).reply({ submissions: [sub1, sub2, sub3] })

      const result = await service.onNewFormSubmission({
        triggerData: {},
        state: { since, seenIds: ['sub2'], resumePage: null },
        learningMode: false,
      })

      // sub1 is before since, sub2 is in seenIds, so only sub3 should be emitted
      expect(result.events).toEqual([sub3])
    })
  })

  // ── Error Handling ──

  describe('error handling', () => {
    it('wraps API errors with friendly hints for known status codes', async () => {
      mock.onGet(`${BASE}/contacts/c1`).replyWithError({
        message: 'Unauthorized',
        body: { statusCode: 401 },
        status: 401,
      })

      await expect(service.getContactById('c1')).rejects.toThrow('Authentication failed')
    })

    it('includes API message in error when available', async () => {
      mock.onGet(`${BASE}/contacts/c1`).replyWithError({
        message: 'Bad Request',
        body: { statusCode: 400, message: 'Invalid contact ID format' },
        status: 400,
      })

      await expect(service.getContactById('c1')).rejects.toThrow('Invalid contact ID format')
    })

    it('provides generic message for unknown errors', async () => {
      mock.onGet(`${BASE}/contacts/c1`).replyWithError({ message: '' })

      await expect(service.getContactById('c1')).rejects.toThrow('The GoHighLevel request failed')
    })
  })

  // ── API Version Selection ──

  describe('API version selection', () => {
    it('uses legacy version for calendars endpoints', async () => {
      mock.onGet(`${BASE}/calendars/`).reply({ calendars: [] })

      await service.getCalendars()

      expect(mock.history[0].headers.Version).toBe(API_VERSION_LEGACY)
    })

    it('uses legacy version for conversations endpoints', async () => {
      mock.onGet(`${BASE}/conversations/conv1`).reply({ id: 'conv1' })

      await service.getConversationById('conv1')

      expect(mock.history[0].headers.Version).toBe(API_VERSION_LEGACY)
    })

    it('uses current version for contacts endpoints', async () => {
      mock.onGet(`${BASE}/contacts/c1`).reply({ contact: { id: 'c1' } })

      await service.getContactById('c1')

      expect(mock.history[0].headers.Version).toBe(API_VERSION)
    })

    it('uses current version for opportunities endpoints', async () => {
      mock.onGet(`${BASE}/opportunities/opp1`).reply({ opportunity: { id: 'opp1' } })

      await service.getOpportunityById('opp1')

      expect(mock.history[0].headers.Version).toBe(API_VERSION)
    })
  })
})
