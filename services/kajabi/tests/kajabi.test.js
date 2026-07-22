'use strict'

const { createSandbox } = require('../../../service-sandbox')

const CLIENT_ID = 'test-client-id'
const CLIENT_SECRET = 'test-client-secret'
const BASE = 'https://api.kajabi.com/v1'
const TOKEN_URL = 'https://api.kajabi.com/v1/oauth/token'
const ACCESS_TOKEN = 'test-access-token-abc'

describe('Kajabi Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET })
    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()
  })

  afterEach(() => {
    mock.reset()
    service.accessToken = null
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  function mockToken() {
    mock.onPost(TOKEN_URL).reply({ access_token: ACCESS_TOKEN })
  }

  function lastRequest() {
    return mock.history[mock.history.length - 1]
  }

  // ── Registration ──

  describe('service registration', () => {
    it('registers with correct config items', () => {
      expect(sandbox.getConfigItems()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'clientId', required: true, shared: false }),
          expect.objectContaining({ name: 'clientSecret', required: true, shared: false }),
        ])
      )
    })
  })

  // ── Token acquisition ──

  describe('token acquisition', () => {
    it('sends client_credentials token request with FormData', async () => {
      mockToken()
      mock.onGet(`${BASE}/sites`).reply({ data: [], links: {}, meta: {} })

      await service.listSites()

      const tokenReq = mock.history[0]

      expect(tokenReq.method).toBe('post')
      expect(tokenReq.url).toBe(TOKEN_URL)
      expect(tokenReq.headers).toMatchObject({ Accept: 'application/json' })
      expect(tokenReq.body).toBeDefined()
      expect(tokenReq.body._fields).toBeDefined()
    })

    it('caches the token for subsequent calls', async () => {
      mockToken()
      mock.onGet(`${BASE}/sites`).reply({ data: [], links: {}, meta: {} })

      await service.listSites()
      mock.reset()

      // Second call should NOT request a new token
      mock.onGet(`${BASE}/sites`).reply({ data: [], links: {}, meta: {} })
      await service.listSites()

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
    })

    it('throws when token endpoint does not return access_token', async () => {
      mock.onPost(TOKEN_URL).reply({ token_type: 'bearer' })

      await expect(service.listSites()).rejects.toThrow('authentication failed')
    })

    it('throws when clientId or clientSecret is missing', async () => {
      const origClientId = service.clientId
      const origClientSecret = service.clientSecret

      service.clientId = ''
      service.clientSecret = ''

      await expect(service.listSites()).rejects.toThrow('Client ID and Client Secret are required')

      service.clientId = origClientId
      service.clientSecret = origClientSecret
    })
  })

  // ── Sites ──

  describe('listSites', () => {
    it('sends correct request with defaults', async () => {
      mockToken()
      mock.onGet(`${BASE}/sites`).reply({ data: [{ id: '1', type: 'sites' }], links: {}, meta: { total_count: 1 } })

      const result = await service.listSites()

      const req = lastRequest()

      expect(req.url).toBe(`${BASE}/sites`)
      expect(req.method).toBe('get')
      expect(req.headers).toMatchObject({
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/vnd.api+json',
        Accept: 'application/vnd.api+json',
      })
      expect(req.query).toMatchObject({ 'page[size]': 25 })
      expect(result.items).toHaveLength(1)
      expect(result.meta).toHaveProperty('total_count', 1)
    })

    it('passes custom page and pageSize', async () => {
      mockToken()
      mock.onGet(`${BASE}/sites`).reply({ data: [], links: {}, meta: {} })

      await service.listSites(2, 10)

      expect(lastRequest().query).toMatchObject({ 'page[number]': 2, 'page[size]': 10 })
    })

    it('extracts nextPage from links.next', async () => {
      mockToken()
      mock.onGet(`${BASE}/sites`).reply({
        data: [{ id: '1' }],
        links: { next: 'https://api.kajabi.com/v1/sites?page%5Bnumber%5D=3&page%5Bsize%5D=25' },
        meta: {},
      })

      const result = await service.listSites()

      expect(result.nextPage).toBe(3)
    })

    it('returns null nextPage when no links.next', async () => {
      mockToken()
      mock.onGet(`${BASE}/sites`).reply({ data: [], links: {}, meta: {} })

      const result = await service.listSites()

      expect(result.nextPage).toBeNull()
    })
  })

  describe('getSite', () => {
    it('sends GET to correct URL', async () => {
      mockToken()
      const siteData = { data: { id: '123', type: 'sites', attributes: { title: 'Test' } } }

      mock.onGet(`${BASE}/sites/123`).reply(siteData)

      const result = await service.getSite('123')

      expect(lastRequest().url).toBe(`${BASE}/sites/123`)
      expect(result).toEqual(siteData)
    })
  })

  // ── Contacts ──

  describe('listContacts', () => {
    it('sends correct request with all filters', async () => {
      mockToken()
      mock.onGet(`${BASE}/contacts`).reply({ data: [], links: {}, meta: {} })

      await service.listContacts('site1', 'john', 'Doe', 'john@', 'tag1', 'offer1', 'Name (A-Z)', 2, 10)

      const req = lastRequest()

      expect(req.query).toMatchObject({
        'filter[site_id]': 'site1',
        'filter[search]': 'john',
        'filter[name_contains]': 'Doe',
        'filter[email_contains]': 'john@',
        'filter[has_tag_id]': 'tag1',
        'filter[has_offer_id]': 'offer1',
        sort: 'name',
        'page[number]': 2,
        'page[size]': 10,
      })
    })

    it('resolves sort choices correctly', async () => {
      mockToken()

      const sortMappings = [
        ['Name (Z-A)', '-name'],
        ['Email (A-Z)', 'email'],
        ['Email (Z-A)', '-email'],
        ['Newest First', '-created_at'],
        ['Oldest First', 'created_at'],
      ]

      for (const [label, expected] of sortMappings) {
        mock.reset()
        service.accessToken = null
        mockToken()
        mock.onGet(`${BASE}/contacts`).reply({ data: [], links: {}, meta: {} })

        await service.listContacts(undefined, undefined, undefined, undefined, undefined, undefined, label)

        expect(lastRequest().query.sort).toBe(expected)
      }
    })

    it('omits undefined filter params', async () => {
      mockToken()
      mock.onGet(`${BASE}/contacts`).reply({ data: [], links: {}, meta: {} })

      await service.listContacts()

      const query = lastRequest().query

      expect(query).not.toHaveProperty('filter[search]')
      expect(query).not.toHaveProperty('filter[name_contains]')
      expect(query).not.toHaveProperty('filter[email_contains]')
    })
  })

  describe('getContact', () => {
    it('sends GET to correct URL', async () => {
      mockToken()
      mock.onGet(`${BASE}/contacts/456`).reply({ data: { id: '456' } })

      const result = await service.getContact('456')

      expect(lastRequest().url).toBe(`${BASE}/contacts/456`)
      expect(result).toEqual({ data: { id: '456' } })
    })
  })

  describe('createContact', () => {
    it('sends POST with required fields only', async () => {
      mockToken()
      mock.onPost(`${BASE}/contacts`).reply({ data: { id: '789', type: 'contacts' } })

      await service.createContact('site1', 'test@example.com')

      const req = lastRequest()

      expect(req.method).toBe('post')
      expect(req.body).toEqual({
        data: {
          type: 'contacts',
          attributes: { email: 'test@example.com' },
          relationships: {
            site: { data: { type: 'sites', id: 'site1' } },
          },
        },
      })
    })

    it('sends POST with all fields', async () => {
      mockToken()
      mock.onPost(`${BASE}/contacts`).reply({ data: { id: '789' } })

      await service.createContact(
        'site1', 'test@example.com', 'John Doe', '+1234567890', true,
        '123 Main St', 'Apt 4', 'Springfield', 'IL', 'US', '62701'
      )

      const attrs = lastRequest().body.data.attributes

      expect(attrs).toEqual({
        email: 'test@example.com',
        name: 'John Doe',
        phone_number: '+1234567890',
        subscribed: true,
        address_line_1: '123 Main St',
        address_line_2: 'Apt 4',
        address_city: 'Springfield',
        address_state: 'IL',
        address_country: 'US',
        address_zip: '62701',
      })
    })

    it('omits optional fields when not provided', async () => {
      mockToken()
      mock.onPost(`${BASE}/contacts`).reply({ data: { id: '789' } })

      await service.createContact('site1', 'test@example.com', undefined, undefined, undefined)

      const attrs = lastRequest().body.data.attributes

      expect(attrs).toEqual({ email: 'test@example.com' })
    })
  })

  describe('updateContact', () => {
    it('sends PATCH with correct body', async () => {
      mockToken()
      mock.onPatch(`${BASE}/contacts/456`).reply({ data: { id: '456' } })

      await service.updateContact('456', 'Jane Doe', 'jane@example.com')

      const req = lastRequest()

      expect(req.method).toBe('patch')
      expect(req.url).toBe(`${BASE}/contacts/456`)
      expect(req.body).toEqual({
        data: {
          id: '456',
          type: 'contacts',
          attributes: { name: 'Jane Doe', email: 'jane@example.com' },
        },
      })
    })

    it('omits unchanged fields', async () => {
      mockToken()
      mock.onPatch(`${BASE}/contacts/456`).reply({ data: { id: '456' } })

      await service.updateContact('456', 'Jane Doe')

      const attrs = lastRequest().body.data.attributes

      expect(attrs).toEqual({ name: 'Jane Doe' })
    })
  })

  describe('deleteContact', () => {
    it('sends DELETE and returns confirmation', async () => {
      mockToken()
      mock.onDelete(`${BASE}/contacts/456`).reply({})

      const result = await service.deleteContact('456')

      expect(lastRequest().method).toBe('delete')
      expect(lastRequest().url).toBe(`${BASE}/contacts/456`)
      expect(result).toEqual({ deleted: true, contactId: '456' })
    })
  })

  describe('addTagToContact', () => {
    it('sends POST to relationships/tags', async () => {
      mockToken()
      mock.onPost(`${BASE}/contacts/456/relationships/tags`).reply({
        data: [{ type: 'contact_tags', id: '111' }],
      })

      const result = await service.addTagToContact('456', '111')

      expect(lastRequest().url).toBe(`${BASE}/contacts/456/relationships/tags`)
      expect(lastRequest().body).toEqual({
        data: [{ type: 'contact_tags', id: '111' }],
      })
      expect(result.data).toHaveLength(1)
    })
  })

  describe('removeTagFromContact', () => {
    it('sends DELETE to relationships/tags with body', async () => {
      mockToken()
      mock.onDelete(`${BASE}/contacts/456/relationships/tags`).reply({
        data: [],
      })

      const result = await service.removeTagFromContact('456', '111')

      expect(lastRequest().method).toBe('delete')
      expect(lastRequest().body).toEqual({
        data: [{ type: 'contact_tags', id: '111' }],
      })
      expect(result.data).toEqual([])
    })
  })

  // ── Offers ──

  describe('listOffers', () => {
    it('sends correct request with site filter and sort', async () => {
      mockToken()
      mock.onGet(`${BASE}/offers`).reply({ data: [], links: {}, meta: {} })

      await service.listOffers('site1', 'Title (A-Z)', 1, 10)

      const req = lastRequest()

      expect(req.query).toMatchObject({
        'filter[site_id]': 'site1',
        sort: 'title',
        'page[number]': 1,
        'page[size]': 10,
      })
    })

    it('resolves Title (Z-A) sort', async () => {
      mockToken()
      mock.onGet(`${BASE}/offers`).reply({ data: [], links: {}, meta: {} })

      await service.listOffers(undefined, 'Title (Z-A)')

      expect(lastRequest().query.sort).toBe('-title')
    })
  })

  describe('getOffer', () => {
    it('sends GET to correct URL', async () => {
      mockToken()
      mock.onGet(`${BASE}/offers/off1`).reply({ data: { id: 'off1' } })

      const result = await service.getOffer('off1')

      expect(lastRequest().url).toBe(`${BASE}/offers/off1`)
      expect(result.data.id).toBe('off1')
    })
  })

  describe('grantOfferToContact', () => {
    it('sends POST to relationships/offers without meta when sendWelcomeEmail is undefined', async () => {
      mockToken()
      mock.onPost(`${BASE}/contacts/456/relationships/offers`).reply({
        data: [{ type: 'offers', id: 'off1' }],
      })

      await service.grantOfferToContact('456', 'off1')

      const body = lastRequest().body

      expect(body).toEqual({
        data: [{ type: 'offers', id: 'off1' }],
      })
      expect(body).not.toHaveProperty('meta')
    })

    it('includes meta.send_customer_welcome_email when explicitly set', async () => {
      mockToken()
      mock.onPost(`${BASE}/contacts/456/relationships/offers`).reply({
        data: [{ type: 'offers', id: 'off1' }],
      })

      await service.grantOfferToContact('456', 'off1', false)

      expect(lastRequest().body.meta).toEqual({ send_customer_welcome_email: false })
    })
  })

  describe('revokeOfferFromContact', () => {
    it('sends DELETE to relationships/offers with body', async () => {
      mockToken()
      mock.onDelete(`${BASE}/contacts/456/relationships/offers`).reply({ data: [] })

      const result = await service.revokeOfferFromContact('456', 'off1')

      expect(lastRequest().method).toBe('delete')
      expect(lastRequest().body).toEqual({
        data: [{ type: 'offers', id: 'off1' }],
      })
      expect(result.data).toEqual([])
    })
  })

  // ── Products ──

  describe('listProducts', () => {
    it('sends correct request with sort and pagination', async () => {
      mockToken()
      mock.onGet(`${BASE}/products`).reply({ data: [{ id: 'p1' }], links: {}, meta: {} })

      await service.listProducts('Title (A-Z)', 1, 5)

      expect(lastRequest().query).toMatchObject({
        sort: 'title',
        'page[number]': 1,
        'page[size]': 5,
      })
    })

    it('uses default page size of 25', async () => {
      mockToken()
      mock.onGet(`${BASE}/products`).reply({ data: [], links: {}, meta: {} })

      await service.listProducts()

      expect(lastRequest().query['page[size]']).toBe(25)
    })
  })

  describe('getProduct', () => {
    it('sends GET to correct URL', async () => {
      mockToken()
      mock.onGet(`${BASE}/products/p1`).reply({ data: { id: 'p1' } })

      await service.getProduct('p1')

      expect(lastRequest().url).toBe(`${BASE}/products/p1`)
    })
  })

  // ── Courses ──

  describe('listCourses', () => {
    it('sends correct request with all filters', async () => {
      mockToken()
      mock.onGet(`${BASE}/courses`).reply({ data: [], links: {}, meta: {} })

      await service.listCourses('site1', 'Baking', 'Published', 'Title (A-Z)', 1, 10)

      const query = lastRequest().query

      expect(query).toMatchObject({
        'filter[site_id]': 'site1',
        'filter[title_cont]': 'Baking',
        'filter[publish_status_eq]': 'published',
        sort: 'title',
        'page[number]': 1,
        'page[size]': 10,
      })
    })

    it('resolves Draft publish status', async () => {
      mockToken()
      mock.onGet(`${BASE}/courses`).reply({ data: [], links: {}, meta: {} })

      await service.listCourses(undefined, undefined, 'Draft')

      expect(lastRequest().query['filter[publish_status_eq]']).toBe('draft')
    })

    it('resolves sort choices for courses', async () => {
      mockToken()
      mock.onGet(`${BASE}/courses`).reply({ data: [], links: {}, meta: {} })

      await service.listCourses(undefined, undefined, undefined, 'Newest First')

      expect(lastRequest().query.sort).toBe('-created_at')
    })
  })

  describe('getCourse', () => {
    it('sends GET with include param when provided', async () => {
      mockToken()
      mock.onGet(`${BASE}/courses/c1`).reply({ data: { id: 'c1' } })

      await service.getCourse('c1', ['modules', 'lessons'])

      expect(lastRequest().query).toMatchObject({ include: 'modules,lessons' })
    })

    it('omits include param when not provided', async () => {
      mockToken()
      mock.onGet(`${BASE}/courses/c1`).reply({ data: { id: 'c1' } })

      await service.getCourse('c1')

      expect(lastRequest().query).not.toHaveProperty('include')
    })

    it('omits include param when array is empty', async () => {
      mockToken()
      mock.onGet(`${BASE}/courses/c1`).reply({ data: { id: 'c1' } })

      await service.getCourse('c1', [])

      expect(lastRequest().query).not.toHaveProperty('include')
    })
  })

  // ── Tags ──

  describe('listTags', () => {
    it('sends correct request with filters', async () => {
      mockToken()
      mock.onGet(`${BASE}/contact_tags`).reply({ data: [], links: {}, meta: {} })

      await service.listTags('site1', 'VIP', 'Name (A-Z)', 1, 10)

      expect(lastRequest().query).toMatchObject({
        'filter[site_id]': 'site1',
        'filter[name_cont]': 'VIP',
        sort: 'name',
        'page[number]': 1,
        'page[size]': 10,
      })
    })
  })

  describe('getTag', () => {
    it('sends GET to correct URL', async () => {
      mockToken()
      mock.onGet(`${BASE}/contact_tags/t1`).reply({ data: { id: 't1' } })

      await service.getTag('t1')

      expect(lastRequest().url).toBe(`${BASE}/contact_tags/t1`)
    })
  })

  // ── Commerce ──

  describe('listPurchases', () => {
    it('sends correct request with Active status filter', async () => {
      mockToken()
      mock.onGet(`${BASE}/purchases`).reply({ data: [], links: {}, meta: {} })

      await service.listPurchases('site1', 'cust1', 'Active', 'SAVE10', 1, 10)

      const query = lastRequest().query

      expect(query).toMatchObject({
        'filter[site_id]': 'site1',
        'filter[customer_id]': 'cust1',
        'filter[active]': true,
        'filter[coupon_code_eq]': 'SAVE10',
        'page[number]': 1,
        'page[size]': 10,
      })
      expect(query).not.toHaveProperty('filter[deactivated]')
    })

    it('sends Deactivated status filter', async () => {
      mockToken()
      mock.onGet(`${BASE}/purchases`).reply({ data: [], links: {}, meta: {} })

      await service.listPurchases(undefined, undefined, 'Deactivated')

      const query = lastRequest().query

      expect(query).toMatchObject({ 'filter[deactivated]': true })
      expect(query).not.toHaveProperty('filter[active]')
    })

    it('sends no status filter when not specified', async () => {
      mockToken()
      mock.onGet(`${BASE}/purchases`).reply({ data: [], links: {}, meta: {} })

      await service.listPurchases()

      const query = lastRequest().query

      expect(query).not.toHaveProperty('filter[active]')
      expect(query).not.toHaveProperty('filter[deactivated]')
    })
  })

  describe('getPurchase', () => {
    it('sends GET to correct URL', async () => {
      mockToken()
      mock.onGet(`${BASE}/purchases/pur1`).reply({ data: { id: 'pur1' } })

      await service.getPurchase('pur1')

      expect(lastRequest().url).toBe(`${BASE}/purchases/pur1`)
    })
  })

  describe('listOrders', () => {
    it('sends correct request with filters', async () => {
      mockToken()
      mock.onGet(`${BASE}/orders`).reply({ data: [], links: {}, meta: {} })

      await service.listOrders('site1', 'cust1', '1001', 1, 10)

      expect(lastRequest().query).toMatchObject({
        'filter[site_id]': 'site1',
        'filter[customer_id]': 'cust1',
        'filter[order_number_eq]': '1001',
        'page[number]': 1,
        'page[size]': 10,
      })
    })
  })

  describe('getOrder', () => {
    it('sends GET to correct URL', async () => {
      mockToken()
      mock.onGet(`${BASE}/orders/ord1`).reply({ data: { id: 'ord1' } })

      await service.getOrder('ord1')

      expect(lastRequest().url).toBe(`${BASE}/orders/ord1`)
    })
  })

  // ── Forms ──

  describe('listForms', () => {
    it('sends correct request with filters', async () => {
      mockToken()
      mock.onGet(`${BASE}/forms`).reply({ data: [], links: {}, meta: {} })

      await service.listForms('site1', 'Newsletter', 1, 10)

      expect(lastRequest().query).toMatchObject({
        'filter[site_id]': 'site1',
        'filter[title_cont]': 'Newsletter',
        'page[number]': 1,
        'page[size]': 10,
      })
    })
  })

  describe('getForm', () => {
    it('sends GET to correct URL', async () => {
      mockToken()
      mock.onGet(`${BASE}/forms/f1`).reply({ data: { id: 'f1' } })

      await service.getForm('f1')

      expect(lastRequest().url).toBe(`${BASE}/forms/f1`)
    })
  })

  // ── Webhooks ──

  describe('listWebhooks', () => {
    it('sends correct request with pagination', async () => {
      mockToken()
      mock.onGet(`${BASE}/hooks`).reply({ data: [], links: {}, meta: {} })

      await service.listWebhooks(1, 10)

      expect(lastRequest().query).toMatchObject({ 'page[number]': 1, 'page[size]': 10 })
    })
  })

  describe('createWebhook', () => {
    it('sends POST with correct body and resolved event', async () => {
      mockToken()
      mock.onPost(`${BASE}/hooks`).reply({ data: { id: '77', type: 'hooks' } })

      await service.createWebhook('site1', 'https://example.com/hook', 'Tag Added', 'tag123')

      const body = lastRequest().body

      expect(body).toEqual({
        data: {
          type: 'hooks',
          attributes: {
            target_url: 'https://example.com/hook',
            event: 'tag_added',
            resource_id: 'tag123',
          },
          relationships: {
            site: { data: { type: 'sites', id: 'site1' } },
          },
        },
      })
    })

    it('resolves all event choices', async () => {
      const eventMap = {
        'Purchase': 'purchase',
        'Payment Succeeded': 'payment_succeeded',
        'Order Created': 'order_created',
        'Form Submission': 'form_submission',
        'Tag Added': 'tag_added',
        'Tag Removed': 'tag_removed',
      }

      for (const [label, expected] of Object.entries(eventMap)) {
        mock.reset()
        service.accessToken = null
        mockToken()
        mock.onPost(`${BASE}/hooks`).reply({ data: { id: '77' } })

        await service.createWebhook('site1', 'https://example.com/hook', label)

        expect(lastRequest().body.data.attributes.event).toBe(expected)
      }
    })

    it('omits resource_id when not provided', async () => {
      mockToken()
      mock.onPost(`${BASE}/hooks`).reply({ data: { id: '77' } })

      await service.createWebhook('site1', 'https://example.com/hook', 'Purchase')

      expect(lastRequest().body.data.attributes).not.toHaveProperty('resource_id')
    })
  })

  describe('getWebhook', () => {
    it('sends GET to correct URL', async () => {
      mockToken()
      mock.onGet(`${BASE}/hooks/77`).reply({ data: { id: '77' } })

      await service.getWebhook('77')

      expect(lastRequest().url).toBe(`${BASE}/hooks/77`)
    })
  })

  describe('deleteWebhook', () => {
    it('sends DELETE and returns confirmation', async () => {
      mockToken()
      mock.onDelete(`${BASE}/hooks/77`).reply({})

      const result = await service.deleteWebhook('77')

      expect(lastRequest().method).toBe('delete')
      expect(result).toEqual({ deleted: true, webhookId: '77' })
    })
  })

  // ── Dictionaries ──

  describe('sitesDictionary', () => {
    it('returns mapped items with label/value/note', async () => {
      mockToken()
      mock.onGet(`${BASE}/sites`).reply({
        data: [
          { id: '1', attributes: { title: 'My Academy', subdomain: 'my-academy' } },
          { id: '2', attributes: { title: 'Other Site', subdomain: 'other' } },
        ],
        links: {},
        meta: {},
      })

      const result = await service.sitesDictionary({})

      expect(result.items).toEqual([
        { label: 'My Academy', value: '1', note: 'my-academy' },
        { label: 'Other Site', value: '2', note: 'other' },
      ])
    })

    it('filters by search client-side', async () => {
      mockToken()
      mock.onGet(`${BASE}/sites`).reply({
        data: [
          { id: '1', attributes: { title: 'My Academy' } },
          { id: '2', attributes: { title: 'Other Site' } },
        ],
        links: {},
        meta: {},
      })

      const result = await service.sitesDictionary({ search: 'academy' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('1')
    })

    it('uses cursor for pagination', async () => {
      mockToken()
      mock.onGet(`${BASE}/sites`).reply({ data: [], links: {}, meta: {} })

      await service.sitesDictionary({ cursor: '3' })

      expect(lastRequest().query).toMatchObject({ 'page[number]': 3, 'page[size]': 50 })
    })

    it('returns cursor from nextPage', async () => {
      mockToken()
      mock.onGet(`${BASE}/sites`).reply({
        data: [],
        links: { next: 'https://api.kajabi.com/v1/sites?page[number]=2' },
        meta: {},
      })

      const result = await service.sitesDictionary({})

      expect(result.cursor).toBe(2)
    })
  })

  describe('offersDictionary', () => {
    it('returns mapped items with price note', async () => {
      mockToken()
      mock.onGet(`${BASE}/offers`).reply({
        data: [
          { id: '1', attributes: { title: 'Course Bundle', price_in_cents: 19900, currency: 'USD' } },
        ],
        links: {},
        meta: {},
      })

      const result = await service.offersDictionary({})

      expect(result.items).toEqual([
        { label: 'Course Bundle', value: '1', note: '199.00 USD' },
      ])
    })

    it('passes criteria.siteId as filter', async () => {
      mockToken()
      mock.onGet(`${BASE}/offers`).reply({ data: [], links: {}, meta: {} })

      await service.offersDictionary({ criteria: { siteId: 'site1' } })

      expect(lastRequest().query['filter[site_id]']).toBe('site1')
    })

    it('filters by search client-side', async () => {
      mockToken()
      mock.onGet(`${BASE}/offers`).reply({
        data: [
          { id: '1', attributes: { title: 'Course Bundle' } },
          { id: '2', attributes: { title: 'Membership' } },
        ],
        links: {},
        meta: {},
      })

      const result = await service.offersDictionary({ search: 'member' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('2')
    })
  })

  describe('productsDictionary', () => {
    it('returns mapped items with status note', async () => {
      mockToken()
      mock.onGet(`${BASE}/products`).reply({
        data: [
          { id: 'p1', attributes: { title: 'Masterclass', status: 'published' } },
        ],
        links: {},
        meta: {},
      })

      const result = await service.productsDictionary({})

      expect(result.items).toEqual([
        { label: 'Masterclass', value: 'p1', note: 'published' },
      ])
    })

    it('filters by search client-side', async () => {
      mockToken()
      mock.onGet(`${BASE}/products`).reply({
        data: [
          { id: 'p1', attributes: { title: 'Photo Course' } },
          { id: 'p2', attributes: { title: 'Baking Course' } },
        ],
        links: {},
        meta: {},
      })

      const result = await service.productsDictionary({ search: 'baking' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('p2')
    })
  })

  describe('tagsDictionary', () => {
    it('returns mapped items with "Tag" note', async () => {
      mockToken()
      mock.onGet(`${BASE}/contact_tags`).reply({
        data: [{ id: 't1', attributes: { name: 'VIP' } }],
        links: {},
        meta: {},
      })

      const result = await service.tagsDictionary({})

      expect(result.items).toEqual([
        { label: 'VIP', value: 't1', note: 'Tag' },
      ])
    })

    it('passes search as server-side filter', async () => {
      mockToken()
      mock.onGet(`${BASE}/contact_tags`).reply({ data: [], links: {}, meta: {} })

      await service.tagsDictionary({ search: 'vip' })

      expect(lastRequest().query['filter[name_cont]']).toBe('vip')
    })

    it('passes criteria.siteId as filter', async () => {
      mockToken()
      mock.onGet(`${BASE}/contact_tags`).reply({ data: [], links: {}, meta: {} })

      await service.tagsDictionary({ criteria: { siteId: 'site1' } })

      expect(lastRequest().query['filter[site_id]']).toBe('site1')
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('throws with JSON:API error detail', async () => {
      mockToken()
      mock.onGet(`${BASE}/sites/bad`).replyWithError({
        message: 'Not Found',
        body: { errors: [{ title: 'Not Found', detail: 'Site not found' }] },
      })

      await expect(service.getSite('bad')).rejects.toThrow('Site not found')
    })

    it('throws with generic message when no JSON:API errors', async () => {
      mockToken()
      mock.onGet(`${BASE}/sites/bad`).replyWithError({
        message: 'Internal Server Error',
      })

      await expect(service.getSite('bad')).rejects.toThrow('Internal Server Error')
    })
  })
})
