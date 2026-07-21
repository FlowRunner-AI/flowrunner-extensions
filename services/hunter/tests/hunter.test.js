'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-hunter-api-key'
const BASE = 'https://api.hunter.io/v2'

describe('Hunter.io Service', () => {
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
          shared: false,
          type: 'STRING',
        }),
      ])
    })
  })

  // ── Email Discovery ──

  describe('domainSearch', () => {
    const URL = `${BASE}/domain-search`

    it('sends correct request with domain only', async () => {
      const responseData = { data: { domain: 'stripe.com', emails: [] }, meta: { results: 0 } }
      mock.onGet(URL).reply(responseData)

      const result = await service.domainSearch('stripe.com')

      expect(result).toEqual(responseData)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({
        domain: 'stripe.com',
        api_key: API_KEY,
      })
    })

    it('sends correct request with company name', async () => {
      mock.onGet(URL).reply({ data: { emails: [] } })

      await service.domainSearch(undefined, 'Stripe')

      expect(mock.history[0].query).toMatchObject({
        company: 'Stripe',
        api_key: API_KEY,
      })
      expect(mock.history[0].query.domain).toBeUndefined()
    })

    it('passes all optional filters', async () => {
      mock.onGet(URL).reply({ data: { emails: [] } })

      await service.domainSearch('stripe.com', undefined, 50, 10, 'Personal', 'Senior', 'IT')

      expect(mock.history[0].query).toMatchObject({
        domain: 'stripe.com',
        limit: 50,
        offset: 10,
        type: 'personal',
        seniority: 'senior',
        department: 'it',
        api_key: API_KEY,
      })
    })

    it('resolves dropdown labels to API values for department', async () => {
      mock.onGet(URL).reply({ data: { emails: [] } })

      await service.domainSearch('stripe.com', undefined, undefined, undefined, undefined, undefined, 'Marketing')

      expect(mock.history[0].query).toMatchObject({ department: 'marketing' })
    })

    it('passes through unknown choice values unchanged', async () => {
      mock.onGet(URL).reply({ data: { emails: [] } })

      await service.domainSearch('stripe.com', undefined, undefined, undefined, 'custom_type')

      expect(mock.history[0].query).toMatchObject({ type: 'custom_type' })
    })

    it('throws on API error', async () => {
      mock.onGet(URL).replyWithError({
        message: 'Unauthorized',
        body: { errors: [{ code: 'unauthorized', details: 'Invalid API key' }] },
      })

      await expect(service.domainSearch('stripe.com')).rejects.toThrow('Hunter.io API error: Invalid API key')
    })
  })

  describe('emailFinder', () => {
    const URL = `${BASE}/email-finder`

    it('sends correct request with required params', async () => {
      const responseData = { data: { email: 'patrick@stripe.com', score: 97 } }
      mock.onGet(URL).reply(responseData)

      const result = await service.emailFinder('Patrick', 'Collison', 'stripe.com')

      expect(result).toEqual(responseData)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({
        first_name: 'Patrick',
        last_name: 'Collison',
        domain: 'stripe.com',
        api_key: API_KEY,
      })
    })

    it('sends company instead of domain when provided', async () => {
      mock.onGet(URL).reply({ data: {} })

      await service.emailFinder('Patrick', 'Collison', undefined, 'Stripe')

      expect(mock.history[0].query).toMatchObject({
        first_name: 'Patrick',
        last_name: 'Collison',
        company: 'Stripe',
        api_key: API_KEY,
      })
      expect(mock.history[0].query.domain).toBeUndefined()
    })

    it('throws on API error', async () => {
      mock.onGet(URL).replyWithError({
        message: 'Bad Request',
        body: { errors: [{ details: 'Missing required fields' }] },
      })

      await expect(service.emailFinder('Patrick', 'Collison')).rejects.toThrow('Hunter.io API error: Missing required fields')
    })
  })

  describe('emailVerifier', () => {
    const URL = `${BASE}/email-verifier`

    it('sends correct request', async () => {
      const responseData = { data: { status: 'valid', score: 95, email: 'patrick@stripe.com' } }
      mock.onGet(URL).reply(responseData)

      const result = await service.emailVerifier('patrick@stripe.com')

      expect(result).toEqual(responseData)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({
        email: 'patrick@stripe.com',
        api_key: API_KEY,
      })
    })

    it('throws on API error', async () => {
      mock.onGet(URL).replyWithError({
        message: 'Error',
        body: { errors: [{ code: 'invalid_email' }] },
      })

      await expect(service.emailVerifier('bad')).rejects.toThrow('Hunter.io API error: invalid_email')
    })
  })

  describe('emailCount', () => {
    const URL = `${BASE}/email-count`

    it('sends correct request with domain', async () => {
      const responseData = { data: { total: 351, personal_emails: 328, generic_emails: 23 } }
      mock.onGet(URL).reply(responseData)

      const result = await service.emailCount('stripe.com')

      expect(result).toEqual(responseData)
      expect(mock.history[0].query).toMatchObject({
        domain: 'stripe.com',
        api_key: API_KEY,
      })
    })

    it('sends correct request with company and type filter', async () => {
      mock.onGet(URL).reply({ data: { total: 100 } })

      await service.emailCount(undefined, 'Stripe', 'Generic')

      expect(mock.history[0].query).toMatchObject({
        company: 'Stripe',
        type: 'generic',
        api_key: API_KEY,
      })
    })
  })

  // ── Enrichment ──

  describe('combinedEnrichment', () => {
    const URL = `${BASE}/combined/find`

    it('sends correct request', async () => {
      const responseData = { data: { person: { name: { fullName: 'Patrick Collison' } }, company: { name: 'Stripe' } } }
      mock.onGet(URL).reply(responseData)

      const result = await service.combinedEnrichment('patrick@stripe.com')

      expect(result).toEqual(responseData)
      expect(mock.history[0].query).toMatchObject({
        email: 'patrick@stripe.com',
        api_key: API_KEY,
      })
    })

    it('throws on API error', async () => {
      mock.onGet(URL).replyWithError({
        message: 'Not Found',
        body: { errors: [{ details: 'No data found' }] },
      })

      await expect(service.combinedEnrichment('unknown@example.com')).rejects.toThrow('Hunter.io API error: No data found')
    })
  })

  // ── Account ──

  describe('getAccount', () => {
    const URL = `${BASE}/account`

    it('sends correct request and returns account data', async () => {
      const responseData = { data: { first_name: 'Jane', plan_name: 'Starter', calls: { used: 420, available: 5000 } } }
      mock.onGet(URL).reply(responseData)

      const result = await service.getAccount()

      expect(result).toEqual(responseData)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({ api_key: API_KEY })
    })
  })

  // ── Leads ──

  describe('listLeads', () => {
    const URL = `${BASE}/leads`

    it('sends correct request with defaults', async () => {
      const responseData = { data: { leads: [] }, meta: { total: 0 } }
      mock.onGet(URL).reply(responseData)

      const result = await service.listLeads()

      expect(result).toEqual(responseData)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({ api_key: API_KEY })
    })

    it('passes all optional filters', async () => {
      mock.onGet(URL).reply({ data: { leads: [] } })

      await service.listLeads('7', 50, 10, 'test@example.com', 'John', 'Doe', 'Acme')

      expect(mock.history[0].query).toMatchObject({
        lead_list_id: '7',
        limit: 50,
        offset: 10,
        email: 'test@example.com',
        first_name: 'John',
        last_name: 'Doe',
        company: 'Acme',
        api_key: API_KEY,
      })
    })
  })

  describe('createLead', () => {
    const URL = `${BASE}/leads`

    it('sends POST with required email only', async () => {
      const responseData = { data: { id: 42, email: 'test@example.com' } }
      mock.onPost(URL).reply(responseData)

      const result = await service.createLead('test@example.com')

      expect(result).toEqual(responseData)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toMatchObject({ email: 'test@example.com' })
    })

    it('sends POST with all optional fields', async () => {
      mock.onPost(URL).reply({ data: { id: 43 } })

      await service.createLead(
        'patrick@stripe.com', 'Patrick', 'Collison', 'CEO', 'Stripe',
        'stripe.com', '+1234567890', 'https://linkedin.com/in/patrick',
        'patrickc', 'Website', 'Met at conference', '7'
      )

      expect(mock.history[0].body).toEqual({
        email: 'patrick@stripe.com',
        first_name: 'Patrick',
        last_name: 'Collison',
        position: 'CEO',
        company: 'Stripe',
        website: 'stripe.com',
        phone_number: '+1234567890',
        linkedin_url: 'https://linkedin.com/in/patrick',
        twitter: 'patrickc',
        source: 'Website',
        notes: 'Met at conference',
        lead_list_id: '7',
      })
    })

    it('omits empty optional fields via clean()', async () => {
      mock.onPost(URL).reply({ data: { id: 44 } })

      await service.createLead('test@example.com', '', null, undefined)

      const body = mock.history[0].body
      expect(body).toEqual({ email: 'test@example.com' })
      expect(body).not.toHaveProperty('first_name')
      expect(body).not.toHaveProperty('last_name')
      expect(body).not.toHaveProperty('position')
    })
  })

  describe('getLead', () => {
    it('sends GET to correct URL with lead ID', async () => {
      const responseData = { data: { id: 42, email: 'test@example.com' } }
      mock.onGet(`${BASE}/leads/42`).reply(responseData)

      const result = await service.getLead(42)

      expect(result).toEqual(responseData)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({ api_key: API_KEY })
    })
  })

  describe('updateLead', () => {
    it('sends PUT with updated fields', async () => {
      const responseData = { data: { id: 42, position: 'Co-founder' } }
      mock.onPut(`${BASE}/leads/42`).reply(responseData)

      const result = await service.updateLead(42, undefined, undefined, undefined, 'Co-founder')

      expect(result).toEqual(responseData)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].body).toMatchObject({ position: 'Co-founder' })
    })

    it('sends PUT with all fields', async () => {
      mock.onPut(`${BASE}/leads/42`).reply({ data: { id: 42 } })

      await service.updateLead(
        42, 'new@example.com', 'Jane', 'Doe', 'CTO', 'Acme',
        'acme.com', '+9876543210', 'https://linkedin.com/in/jane',
        'janedoe', 'Referral', 'Updated notes'
      )

      expect(mock.history[0].body).toEqual({
        email: 'new@example.com',
        first_name: 'Jane',
        last_name: 'Doe',
        position: 'CTO',
        company: 'Acme',
        website: 'acme.com',
        phone_number: '+9876543210',
        linkedin_url: 'https://linkedin.com/in/jane',
        twitter: 'janedoe',
        source: 'Referral',
        notes: 'Updated notes',
      })
    })
  })

  describe('deleteLead', () => {
    it('sends DELETE and returns confirmation', async () => {
      mock.onDelete(`${BASE}/leads/42`).reply({})

      const result = await service.deleteLead(42)

      expect(result).toEqual({ deleted: true, leadId: 42 })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('delete')
    })
  })

  // ── Leads Lists ──

  describe('listLeadsLists', () => {
    const URL = `${BASE}/leads_lists`

    it('sends correct request with defaults', async () => {
      const responseData = { data: { leads_lists: [{ id: 7, name: 'Prospects', leads_count: 42 }] } }
      mock.onGet(URL).reply(responseData)

      const result = await service.listLeadsLists()

      expect(result).toEqual(responseData)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({ api_key: API_KEY })
    })

    it('passes limit and offset', async () => {
      mock.onGet(URL).reply({ data: { leads_lists: [] } })

      await service.listLeadsLists(50, 10)

      expect(mock.history[0].query).toMatchObject({ limit: 50, offset: 10, api_key: API_KEY })
    })
  })

  describe('createLeadsList', () => {
    const URL = `${BASE}/leads_lists`

    it('sends POST with name', async () => {
      const responseData = { data: { id: 8, name: 'Q3 Prospects', leads_count: 0 } }
      mock.onPost(URL).reply(responseData)

      const result = await service.createLeadsList('Q3 Prospects')

      expect(result).toEqual(responseData)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({ name: 'Q3 Prospects' })
    })
  })

  // ── Dictionary ──

  describe('getLeadsListsDictionary', () => {
    const URL = `${BASE}/leads_lists`

    it('returns formatted items with no search or cursor', async () => {
      mock.onGet(URL).reply({
        data: {
          leads_lists: [
            { id: 7, name: 'Prospects', leads_count: 42 },
            { id: 8, name: 'Clients', leads_count: 10 },
          ],
        },
      })

      const result = await service.getLeadsListsDictionary({})

      expect(result.items).toEqual([
        { label: 'Prospects', value: '7', note: '42 leads' },
        { label: 'Clients', value: '8', note: '10 leads' },
      ])
      expect(result.cursor).toBeNull()
      expect(mock.history[0].query).toMatchObject({ limit: 100, offset: 0, api_key: API_KEY })
    })

    it('filters by search text (case-insensitive)', async () => {
      mock.onGet(URL).reply({
        data: {
          leads_lists: [
            { id: 7, name: 'Prospects', leads_count: 42 },
            { id: 8, name: 'Clients', leads_count: 10 },
          ],
        },
      })

      const result = await service.getLeadsListsDictionary({ search: 'pros' })

      expect(result.items).toEqual([
        { label: 'Prospects', value: '7', note: '42 leads' },
      ])
    })

    it('paginates with cursor', async () => {
      mock.onGet(URL).reply({ data: { leads_lists: [] } })

      await service.getLeadsListsDictionary({ cursor: '200' })

      expect(mock.history[0].query).toMatchObject({ limit: 100, offset: 200 })
    })

    it('returns next cursor when results fill a full page', async () => {
      const fullPage = Array.from({ length: 100 }, (_, i) => ({
        id: i + 1,
        name: `List ${i + 1}`,
        leads_count: i,
      }))
      mock.onGet(URL).reply({ data: { leads_lists: fullPage } })

      const result = await service.getLeadsListsDictionary({})

      expect(result.cursor).toBe('100')
      expect(result.items).toHaveLength(100)
    })

    it('handles empty payload gracefully', async () => {
      mock.onGet(URL).reply({ data: { leads_lists: [] } })

      const result = await service.getLeadsListsDictionary(null)

      expect(result.items).toEqual([])
      expect(result.cursor).toBeNull()
    })

    it('handles missing leads_count', async () => {
      mock.onGet(URL).reply({
        data: { leads_lists: [{ id: 1, name: 'No Count' }] },
      })

      const result = await service.getLeadsListsDictionary({})

      expect(result.items[0].note).toBeUndefined()
    })
  })

  // ── Error Handling ──

  describe('error handling', () => {
    it('falls back to error code when details is missing', async () => {
      mock.onGet(`${BASE}/account`).replyWithError({
        message: 'Error',
        body: { errors: [{ code: 'rate_limit_exceeded' }] },
      })

      await expect(service.getAccount()).rejects.toThrow('Hunter.io API error: rate_limit_exceeded')
    })

    it('falls back to body.message when errors array is missing', async () => {
      mock.onGet(`${BASE}/account`).replyWithError({
        message: 'Error',
        body: { message: 'Server error' },
      })

      await expect(service.getAccount()).rejects.toThrow('Hunter.io API error: Server error')
    })

    it('falls back to error.message when body has no useful info', async () => {
      mock.onGet(`${BASE}/account`).replyWithError({
        message: 'Network timeout',
      })

      await expect(service.getAccount()).rejects.toThrow('Hunter.io API error: Network timeout')
    })
  })

  // ── Auth ──

  describe('authentication', () => {
    it('includes api_key in query params and Content-Type header', async () => {
      mock.onGet(`${BASE}/account`).reply({ data: {} })

      await service.getAccount()

      expect(mock.history[0].query).toMatchObject({ api_key: API_KEY })
      expect(mock.history[0].headers).toMatchObject({ 'Content-Type': 'application/json' })
    })
  })
})
