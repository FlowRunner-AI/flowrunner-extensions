'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-keap-api-key'
const BASE = 'https://api.infusionsoft.com/crm/rest/v1'
const HOOKS_BASE = `${ BASE }/hooks`

describe('Keap Service', () => {
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

  // ── Authentication ──

  describe('authentication', () => {
    it('sends Bearer token and Content-Type on GET requests', async () => {
      mock.onGet(`${ BASE }/contacts/123`).reply({ id: 123 })

      await service.getContact('123')

      expect(mock.history[0].headers).toMatchObject({
        Authorization: `Bearer ${ API_KEY }`,
        'Content-Type': 'application/json',
      })
    })

    it('sends Bearer token on POST requests', async () => {
      mock.onPost(`${ BASE }/tags`).reply({ id: 101 })

      await service.createTag('Test')

      expect(mock.history[0].headers).toMatchObject({
        Authorization: `Bearer ${ API_KEY }`,
      })
    })

    it('sends Bearer token on PATCH requests', async () => {
      mock.onPatch(`${ BASE }/contacts/123`).reply({ id: 123 })

      await service.updateContact('123', 'Jane')

      expect(mock.history[0].headers).toMatchObject({
        Authorization: `Bearer ${ API_KEY }`,
      })
    })

    it('sends Bearer token on DELETE requests', async () => {
      mock.onDelete(`${ BASE }/contacts/123`).reply({})

      await service.deleteContact('123')

      expect(mock.history[0].headers).toMatchObject({
        Authorization: `Bearer ${ API_KEY }`,
      })
    })
  })

  // ── Contacts ──

  describe('createContact', () => {
    it('sends POST with all fields', async () => {
      mock.onPost(`${ BASE }/contacts`).reply({ id: 12345 })

      const address = { line1: '123 Main St', locality: 'Denver', region: 'CO' }
      const customFields = { '7': 'custom value' }

      const result = await service.createContact(
        'Jane', 'Doe', 'jane@example.com', '555-1234', 'Acme Inc', address, customFields, 'Match Email'
      )

      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/contacts`)
      expect(mock.history[0].body).toEqual({
        given_name: 'Jane',
        family_name: 'Doe',
        email_addresses: [{ email: 'jane@example.com', field: 'EMAIL1' }],
        phone_numbers: [{ number: '555-1234', field: 'PHONE1' }],
        company: { company_name: 'Acme Inc' },
        addresses: [{ line1: '123 Main St', locality: 'Denver', region: 'CO', field: 'BILLING' }],
        custom_fields: [{ id: 7, content: 'custom value' }],
      })
      expect(mock.history[0].query).toMatchObject({ duplicate_option: 'Email' })
      expect(result).toEqual({ id: 12345 })
    })

    it('sends POST with only given name', async () => {
      mock.onPost(`${ BASE }/contacts`).reply({ id: 12346 })

      await service.createContact('Jane')

      expect(mock.history[0].body).toEqual({ given_name: 'Jane' })
      expect(mock.history[0].query).toEqual({})
    })

    it('omits optional fields when not provided', async () => {
      mock.onPost(`${ BASE }/contacts`).reply({ id: 12347 })

      await service.createContact()

      expect(mock.history[0].body).toEqual({})
    })

    it('resolves Match Email and Name duplicate option', async () => {
      mock.onPost(`${ BASE }/contacts`).reply({ id: 12348 })

      await service.createContact('Jane', undefined, undefined, undefined, undefined, undefined, undefined, 'Match Email and Name')

      expect(mock.history[0].query).toMatchObject({ duplicate_option: 'EmailAndName' })
    })

    it('does not set duplicate_option for Create New', async () => {
      mock.onPost(`${ BASE }/contacts`).reply({ id: 12349 })

      await service.createContact('Jane', undefined, undefined, undefined, undefined, undefined, undefined, 'Create New')

      expect(mock.history[0].query).toEqual({})
    })

    it('throws on API error', async () => {
      mock.onPost(`${ BASE }/contacts`).replyWithError({ message: 'Bad Request' })

      await expect(service.createContact('Jane')).rejects.toThrow('Keap API error')
    })
  })

  describe('getContact', () => {
    it('sends GET to correct URL', async () => {
      mock.onGet(`${ BASE }/contacts/12345`).reply({ id: 12345, given_name: 'Jane' })

      const result = await service.getContact('12345')

      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/contacts/12345`)
      expect(result).toEqual({ id: 12345, given_name: 'Jane' })
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/contacts/99999`).replyWithError({ message: 'Not found' })

      await expect(service.getContact('99999')).rejects.toThrow('Keap API error')
    })
  })

  describe('listContacts', () => {
    it('sends GET with no query when no params', async () => {
      mock.onGet(`${ BASE }/contacts`).reply({ contacts: [], count: 0 })

      const result = await service.listContacts()

      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].query).toEqual({})
      expect(result).toEqual({ contacts: [], count: 0 })
    })

    it('passes all filter params', async () => {
      mock.onGet(`${ BASE }/contacts`).reply({ contacts: [], count: 0 })

      await service.listContacts('jane@example.com', 'Jane', 'Doe', 10, 20)

      expect(mock.history[0].query).toEqual({
        email: 'jane@example.com',
        given_name: 'Jane',
        family_name: 'Doe',
        limit: 10,
        offset: 20,
      })
    })

    it('omits undefined params from query', async () => {
      mock.onGet(`${ BASE }/contacts`).reply({ contacts: [], count: 0 })

      await service.listContacts('test@example.com')

      expect(mock.history[0].query).toEqual({ email: 'test@example.com' })
    })
  })

  describe('updateContact', () => {
    it('sends PATCH with only provided fields', async () => {
      mock.onPatch(`${ BASE }/contacts/123`).reply({ id: 123, given_name: 'Janet' })

      const result = await service.updateContact('123', 'Janet')

      expect(mock.history[0].method).toBe('patch')
      expect(mock.history[0].url).toBe(`${ BASE }/contacts/123`)
      expect(mock.history[0].body).toEqual({ given_name: 'Janet' })
      expect(result).toEqual({ id: 123, given_name: 'Janet' })
    })

    it('sends PATCH with all fields', async () => {
      mock.onPatch(`${ BASE }/contacts/123`).reply({ id: 123 })

      const address = { line1: '456 Oak Ave' }
      const customFields = { '10': 'val' }

      await service.updateContact('123', 'Janet', 'Smith', 'janet@example.com', '555-5678', 'NewCo', address, customFields)

      expect(mock.history[0].body).toEqual({
        given_name: 'Janet',
        family_name: 'Smith',
        email_addresses: [{ email: 'janet@example.com', field: 'EMAIL1' }],
        phone_numbers: [{ number: '555-5678', field: 'PHONE1' }],
        company: { company_name: 'NewCo' },
        addresses: [{ line1: '456 Oak Ave', field: 'BILLING' }],
        custom_fields: [{ id: 10, content: 'val' }],
      })
    })

    it('sends empty body when no updatable fields provided', async () => {
      mock.onPatch(`${ BASE }/contacts/123`).reply({ id: 123 })

      await service.updateContact('123')

      expect(mock.history[0].body).toEqual({})
    })
  })

  describe('deleteContact', () => {
    it('sends DELETE and returns confirmation', async () => {
      mock.onDelete(`${ BASE }/contacts/123`).reply({})

      const result = await service.deleteContact('123')

      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${ BASE }/contacts/123`)
      expect(result).toEqual({ deleted: true, contactId: '123' })
    })

    it('throws on API error', async () => {
      mock.onDelete(`${ BASE }/contacts/999`).replyWithError({ message: 'Forbidden' })

      await expect(service.deleteContact('999')).rejects.toThrow('Keap API error')
    })
  })

  // ── Tags ──

  describe('listTags', () => {
    it('sends GET with no query when no params', async () => {
      mock.onGet(`${ BASE }/tags`).reply({ tags: [], count: 0 })

      const result = await service.listTags()

      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].query).toEqual({})
      expect(result).toEqual({ tags: [], count: 0 })
    })

    it('passes limit and offset', async () => {
      mock.onGet(`${ BASE }/tags`).reply({ tags: [], count: 0 })

      await service.listTags(25, 50)

      expect(mock.history[0].query).toEqual({ limit: 25, offset: 50 })
    })
  })

  describe('createTag', () => {
    it('sends POST with name only', async () => {
      mock.onPost(`${ BASE }/tags`).reply({ id: 101, name: 'Newsletter' })

      const result = await service.createTag('Newsletter')

      expect(mock.history[0].url).toBe(`${ BASE }/tags`)
      expect(mock.history[0].body).toEqual({ name: 'Newsletter' })
      expect(result).toEqual({ id: 101, name: 'Newsletter' })
    })

    it('includes description and category', async () => {
      mock.onPost(`${ BASE }/tags`).reply({ id: 102 })

      await service.createTag('VIP', 'Important contacts', '5')

      expect(mock.history[0].body).toEqual({
        name: 'VIP',
        description: 'Important contacts',
        category: { id: 5 },
      })
    })

    it('omits optional fields when not provided', async () => {
      mock.onPost(`${ BASE }/tags`).reply({ id: 103 })

      await service.createTag('Simple')

      expect(mock.history[0].body).toEqual({ name: 'Simple' })
    })
  })

  describe('applyTagToContact', () => {
    it('sends POST with tag IDs as numbers', async () => {
      mock.onPost(`${ BASE }/contacts/123/tags`).reply({})

      const result = await service.applyTagToContact('123', ['101', '102'])

      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/contacts/123/tags`)
      expect(mock.history[0].body).toEqual({ tagIds: [101, 102] })
      expect(result).toEqual({ contactId: '123', tagIds: ['101', '102'], applied: true })
    })
  })

  describe('removeTagFromContact', () => {
    it('sends DELETE and returns confirmation', async () => {
      mock.onDelete(`${ BASE }/contacts/123/tags/101`).reply({})

      const result = await service.removeTagFromContact('123', '101')

      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${ BASE }/contacts/123/tags/101`)
      expect(result).toEqual({ contactId: '123', tagId: '101', removed: true })
    })
  })

  // ── Companies ──

  describe('createCompany', () => {
    it('sends POST with all fields', async () => {
      mock.onPost(`${ BASE }/companies`).reply({ id: 555 })

      const address = { line1: '123 Corp Blvd' }

      const result = await service.createCompany('Acme Inc', 'info@acme.com', '555-0000', 'https://acme.com', address)

      expect(mock.history[0].url).toBe(`${ BASE }/companies`)
      expect(mock.history[0].body).toEqual({
        company_name: 'Acme Inc',
        email_address: 'info@acme.com',
        phone_number: { number: '555-0000', field: 'PHONE1' },
        website: 'https://acme.com',
        address: { line1: '123 Corp Blvd' },
      })
      expect(result).toEqual({ id: 555 })
    })

    it('sends POST with name only', async () => {
      mock.onPost(`${ BASE }/companies`).reply({ id: 556 })

      await service.createCompany('Simple Co')

      expect(mock.history[0].body).toEqual({ company_name: 'Simple Co' })
    })
  })

  describe('getCompany', () => {
    it('sends GET to correct URL', async () => {
      mock.onGet(`${ BASE }/companies/555`).reply({ id: 555, company_name: 'Acme Inc' })

      const result = await service.getCompany('555')

      expect(mock.history[0].url).toBe(`${ BASE }/companies/555`)
      expect(result).toEqual({ id: 555, company_name: 'Acme Inc' })
    })
  })

  describe('listCompanies', () => {
    it('sends GET with no query when no params', async () => {
      mock.onGet(`${ BASE }/companies`).reply({ companies: [], count: 0 })

      const result = await service.listCompanies()

      expect(mock.history[0].query).toEqual({})
      expect(result).toEqual({ companies: [], count: 0 })
    })

    it('passes all filter params', async () => {
      mock.onGet(`${ BASE }/companies`).reply({ companies: [], count: 0 })

      await service.listCompanies('Acme', 10, 20)

      expect(mock.history[0].query).toEqual({ company_name: 'Acme', limit: 10, offset: 20 })
    })
  })

  describe('updateCompany', () => {
    it('sends PATCH with only provided fields', async () => {
      mock.onPatch(`${ BASE }/companies/555`).reply({ id: 555 })

      await service.updateCompany('555', 'Acme Corporation')

      expect(mock.history[0].method).toBe('patch')
      expect(mock.history[0].url).toBe(`${ BASE }/companies/555`)
      expect(mock.history[0].body).toEqual({ company_name: 'Acme Corporation' })
    })

    it('sends PATCH with all fields', async () => {
      mock.onPatch(`${ BASE }/companies/555`).reply({ id: 555 })

      const address = { line1: '789 New St' }

      await service.updateCompany('555', 'NewCo', 'new@co.com', '555-9999', 'https://newco.com', address)

      expect(mock.history[0].body).toEqual({
        company_name: 'NewCo',
        email_address: 'new@co.com',
        phone_number: { number: '555-9999', field: 'PHONE1' },
        website: 'https://newco.com',
        address: { line1: '789 New St' },
      })
    })

    it('sends empty body when no updatable fields provided', async () => {
      mock.onPatch(`${ BASE }/companies/555`).reply({ id: 555 })

      await service.updateCompany('555')

      expect(mock.history[0].body).toEqual({})
    })
  })

  // ── Opportunities ──

  describe('createOpportunity', () => {
    it('sends POST with required fields', async () => {
      mock.onPost(`${ BASE }/opportunities`).reply({ id: 900 })

      const result = await service.createOpportunity('New Deal', '12345', '2')

      expect(mock.history[0].url).toBe(`${ BASE }/opportunities`)
      expect(mock.history[0].body).toEqual({
        opportunity_title: 'New Deal',
        contact: { id: 12345 },
        stage: { id: 2 },
      })
      expect(result).toEqual({ id: 900 })
    })

    it('includes optional fields', async () => {
      mock.onPost(`${ BASE }/opportunities`).reply({ id: 901 })

      await service.createOpportunity('Deal', '123', '2', '10', 5000, 10000)

      expect(mock.history[0].body).toEqual({
        opportunity_title: 'Deal',
        contact: { id: 123 },
        stage: { id: 2 },
        user: { id: 10 },
        projected_revenue_low: 5000,
        projected_revenue_high: 10000,
      })
    })
  })

  describe('getOpportunity', () => {
    it('sends GET to correct URL', async () => {
      mock.onGet(`${ BASE }/opportunities/900`).reply({ id: 900, opportunity_title: 'Deal' })

      const result = await service.getOpportunity('900')

      expect(mock.history[0].url).toBe(`${ BASE }/opportunities/900`)
      expect(result).toEqual({ id: 900, opportunity_title: 'Deal' })
    })
  })

  describe('listOpportunities', () => {
    it('sends GET with no query when no params', async () => {
      mock.onGet(`${ BASE }/opportunities`).reply({ opportunities: [], count: 0 })

      const result = await service.listOpportunities()

      expect(mock.history[0].query).toEqual({})
      expect(result).toEqual({ opportunities: [], count: 0 })
    })

    it('passes all filter params', async () => {
      mock.onGet(`${ BASE }/opportunities`).reply({ opportunities: [], count: 0 })

      await service.listOpportunities('2', '10', 25, 50)

      expect(mock.history[0].query).toEqual({
        stage_id: '2',
        user_id: '10',
        limit: 25,
        offset: 50,
      })
    })
  })

  describe('updateOpportunity', () => {
    it('sends PATCH with only provided fields', async () => {
      mock.onPatch(`${ BASE }/opportunities/900`).reply({ id: 900 })

      await service.updateOpportunity('900', 'Updated Deal')

      expect(mock.history[0].method).toBe('patch')
      expect(mock.history[0].url).toBe(`${ BASE }/opportunities/900`)
      expect(mock.history[0].body).toEqual({ opportunity_title: 'Updated Deal' })
    })

    it('sends PATCH with stage and user', async () => {
      mock.onPatch(`${ BASE }/opportunities/900`).reply({ id: 900 })

      await service.updateOpportunity('900', undefined, '3', '5')

      expect(mock.history[0].body).toEqual({
        stage: { id: 3 },
        user: { id: 5 },
      })
    })

    it('sends empty body when no updatable fields provided', async () => {
      mock.onPatch(`${ BASE }/opportunities/900`).reply({ id: 900 })

      await service.updateOpportunity('900')

      expect(mock.history[0].body).toEqual({})
    })
  })

  // ── Orders & Products ──

  describe('listOrders', () => {
    it('sends GET with no query when no params', async () => {
      mock.onGet(`${ BASE }/orders`).reply({ orders: [], count: 0 })

      const result = await service.listOrders()

      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].query).toEqual({})
      expect(result).toEqual({ orders: [], count: 0 })
    })

    it('passes all filter params', async () => {
      mock.onGet(`${ BASE }/orders`).reply({ orders: [], count: 0 })

      await service.listOrders('123', true, 10, 20)

      expect(mock.history[0].query).toEqual({
        contact_id: '123',
        paid: true,
        limit: 10,
        offset: 20,
      })
    })
  })

  describe('getOrder', () => {
    it('sends GET to correct URL', async () => {
      mock.onGet(`${ BASE }/orders/700`).reply({ id: 700 })

      const result = await service.getOrder('700')

      expect(mock.history[0].url).toBe(`${ BASE }/orders/700`)
      expect(result).toEqual({ id: 700 })
    })
  })

  describe('listProducts', () => {
    it('sends GET with no query when no params', async () => {
      mock.onGet(`${ BASE }/products`).reply({ products: [], count: 0 })

      const result = await service.listProducts()

      expect(mock.history[0].query).toEqual({})
      expect(result).toEqual({ products: [], count: 0 })
    })

    it('passes activeOnly, limit and offset', async () => {
      mock.onGet(`${ BASE }/products`).reply({ products: [], count: 0 })

      await service.listProducts(true, 10, 20)

      expect(mock.history[0].query).toEqual({ active: true, limit: 10, offset: 20 })
    })
  })

  // ── Notes & Tasks ──

  describe('createNote', () => {
    it('sends POST with all fields', async () => {
      mock.onPost(`${ BASE }/notes`).reply({ id: 800 })

      const result = await service.createNote('12345', 'Follow-up call', 'Discussed pricing', 'Call')

      expect(mock.history[0].url).toBe(`${ BASE }/notes`)
      expect(mock.history[0].body).toEqual({
        contact_id: 12345,
        title: 'Follow-up call',
        body: 'Discussed pricing',
        type: 'Call',
      })
      expect(result).toEqual({ id: 800 })
    })

    it('sends POST with contact ID only', async () => {
      mock.onPost(`${ BASE }/notes`).reply({ id: 801 })

      await service.createNote('12345')

      expect(mock.history[0].body).toEqual({ contact_id: 12345 })
    })
  })

  describe('createTask', () => {
    it('sends POST with all fields', async () => {
      mock.onPost(`${ BASE }/tasks`).reply({ id: 600 })

      const result = await service.createTask('Call Jane', '12345', '2024-02-01T17:00:00.000Z', 'Important task')

      expect(mock.history[0].url).toBe(`${ BASE }/tasks`)
      expect(mock.history[0].body).toEqual({
        title: 'Call Jane',
        contact: { id: 12345 },
        due_date: '2024-02-01T17:00:00.000Z',
        description: 'Important task',
      })
      expect(result).toEqual({ id: 600 })
    })

    it('sends POST with title only', async () => {
      mock.onPost(`${ BASE }/tasks`).reply({ id: 601 })

      await service.createTask('Simple task')

      expect(mock.history[0].body).toEqual({ title: 'Simple task' })
    })
  })

  describe('listTasks', () => {
    it('sends GET with no query when no params', async () => {
      mock.onGet(`${ BASE }/tasks`).reply({ tasks: [], count: 0 })

      const result = await service.listTasks()

      expect(mock.history[0].query).toEqual({})
      expect(result).toEqual({ tasks: [], count: 0 })
    })

    it('passes all filter params', async () => {
      mock.onGet(`${ BASE }/tasks`).reply({ tasks: [], count: 0 })

      await service.listTasks('123', false, 10, 20)

      expect(mock.history[0].query).toEqual({
        contact_id: '123',
        completed: false,
        limit: 10,
        offset: 20,
      })
    })
  })

  // ── Campaigns ──

  describe('listCampaigns', () => {
    it('sends GET with no query when no params', async () => {
      mock.onGet(`${ BASE }/campaigns`).reply({ campaigns: [], count: 0 })

      const result = await service.listCampaigns()

      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].query).toEqual({})
      expect(result).toEqual({ campaigns: [], count: 0 })
    })

    it('passes limit and offset', async () => {
      mock.onGet(`${ BASE }/campaigns`).reply({ campaigns: [], count: 0 })

      await service.listCampaigns(25, 50)

      expect(mock.history[0].query).toEqual({ limit: 25, offset: 50 })
    })
  })

  // ── Dictionaries ──

  describe('getTagsDictionary', () => {
    it('maps tags to items with category note', async () => {
      mock.onGet(`${ BASE }/tags`).reply({
        tags: [
          { id: 101, name: 'Newsletter', category: { name: 'Marketing' } },
          { id: 102, name: 'VIP' },
        ],
      })

      const result = await service.getTagsDictionary({})

      expect(mock.history[0].query).toMatchObject({ limit: 50, offset: 0 })
      expect(result.items).toEqual([
        { label: 'Newsletter', value: '101', note: 'Marketing' },
        { label: 'VIP', value: '102', note: undefined },
      ])
      expect(result.cursor).toBeUndefined()
    })

    it('filters by search', async () => {
      mock.onGet(`${ BASE }/tags`).reply({
        tags: [
          { id: 101, name: 'Newsletter' },
          { id: 102, name: 'VIP' },
        ],
      })

      const result = await service.getTagsDictionary({ search: 'news' })

      expect(result.items).toEqual([
        { label: 'Newsletter', value: '101', note: undefined },
      ])
    })

    it('returns cursor when page is full', async () => {
      const tags = Array.from({ length: 50 }, (_, i) => ({ id: i, name: `Tag ${ i }` }))
      mock.onGet(`${ BASE }/tags`).reply({ tags })

      const result = await service.getTagsDictionary({})

      expect(result.cursor).toBe('50')
    })

    it('uses cursor for offset', async () => {
      mock.onGet(`${ BASE }/tags`).reply({ tags: [] })

      await service.getTagsDictionary({ cursor: '100' })

      expect(mock.history[0].query).toMatchObject({ offset: 100 })
    })

    it('handles null payload', async () => {
      mock.onGet(`${ BASE }/tags`).reply({ tags: [] })

      const result = await service.getTagsDictionary(null)

      expect(result.items).toEqual([])
    })
  })

  describe('getProductsDictionary', () => {
    it('maps products to items with price note', async () => {
      mock.onGet(`${ BASE }/products`).reply({
        products: [
          { id: 10, product_name: 'Pro Plan', product_price: 49.99 },
          { id: 11, product_name: 'Free Plan' },
        ],
      })

      const result = await service.getProductsDictionary({})

      expect(result.items).toEqual([
        { label: 'Pro Plan', value: '10', note: '$49.99' },
        { label: 'Free Plan', value: '11', note: undefined },
      ])
    })

    it('filters by search', async () => {
      mock.onGet(`${ BASE }/products`).reply({
        products: [
          { id: 10, product_name: 'Pro Plan', product_price: 49.99 },
          { id: 11, product_name: 'Free Plan' },
        ],
      })

      const result = await service.getProductsDictionary({ search: 'pro' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toBe('Pro Plan')
    })
  })

  describe('getCampaignsDictionary', () => {
    it('maps campaigns to items with active count note', async () => {
      mock.onGet(`${ BASE }/campaigns`).reply({
        campaigns: [{ id: 300, name: 'Welcome Sequence', active_contact_count: 42 }],
      })

      const result = await service.getCampaignsDictionary({})

      expect(result.items).toEqual([
        { label: 'Welcome Sequence', value: '300', note: '42 active contacts' },
      ])
    })

    it('filters by search', async () => {
      mock.onGet(`${ BASE }/campaigns`).reply({
        campaigns: [
          { id: 300, name: 'Welcome Sequence' },
          { id: 301, name: 'Exit Campaign' },
        ],
      })

      const result = await service.getCampaignsDictionary({ search: 'welcome' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toBe('Welcome Sequence')
    })
  })

  describe('getOpportunityStagesDictionary', () => {
    it('flattens pipelines into stage items with pipeline note', async () => {
      mock.onGet(`${ BASE }/opportunity/stage_pipeline`).reply([
        {
          name: 'Sales Pipeline',
          stages: [
            { id: 1, stage_name: 'Lead' },
            { id: 2, stage_name: 'Qualified' },
          ],
        },
        {
          name: 'Support Pipeline',
          stages: [
            { id: 3, name: 'Open' },
          ],
        },
      ])

      const result = await service.getOpportunityStagesDictionary({})

      expect(result.items).toEqual([
        { label: 'Lead', value: '1', note: 'Sales Pipeline' },
        { label: 'Qualified', value: '2', note: 'Sales Pipeline' },
        { label: 'Open', value: '3', note: 'Support Pipeline' },
      ])
      expect(result.cursor).toBeNull()
    })

    it('filters by search', async () => {
      mock.onGet(`${ BASE }/opportunity/stage_pipeline`).reply([
        { name: 'Pipeline', stages: [{ id: 1, stage_name: 'Lead' }, { id: 2, stage_name: 'Qualified' }] },
      ])

      const result = await service.getOpportunityStagesDictionary({ search: 'qual' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toBe('Qualified')
    })

    it('handles null payload', async () => {
      mock.onGet(`${ BASE }/opportunity/stage_pipeline`).reply([])

      const result = await service.getOpportunityStagesDictionary(null)

      expect(result.items).toEqual([])
    })
  })

  // ── Triggers ──

  describe('onKeapEvent', () => {
    it('shapes event data with SHAPE_EVENT call type', () => {
      const body = { event_key: 'contact.add', object_keys: [{ id: 12345 }] }

      const result = service.onKeapEvent('SHAPE_EVENT', body)

      expect(result).toEqual([
        {
          name: 'onKeapEvent',
          data: { eventKey: 'contact.add', objectType: 'contact', objectKeys: [{ id: 12345 }] },
        },
      ])
    })

    it('shapes event data with eventKey and objectKeys fields', () => {
      const body = { eventKey: 'opportunity.add', objectKeys: [{ id: 900 }] }

      const result = service.onKeapEvent('SHAPE_EVENT', body)

      expect(result[0].data).toEqual({
        eventKey: 'opportunity.add',
        objectType: 'opportunity',
        objectKeys: [{ id: 900 }],
      })
    })

    it('filters triggers with FILTER_TRIGGER call type', () => {
      const payload = {
        eventData: { eventKey: 'contact.add' },
        triggers: [
          { id: 't1', data: { event: 'Contact Added' } },
          { id: 't2', data: { event: 'Contact Deleted' } },
          { id: 't3', data: { event: 'contact.add' } },
        ],
      }

      const result = service.onKeapEvent('FILTER_TRIGGER', payload)

      expect(result).toEqual({ ids: ['t1', 't3'] })
    })

    it('returns empty ids when no trigger matches', () => {
      const payload = {
        eventData: { eventKey: 'order.add' },
        triggers: [{ id: 't1', data: { event: 'Contact Added' } }],
      }

      const result = service.onKeapEvent('FILTER_TRIGGER', payload)

      expect(result).toEqual({ ids: [] })
    })
  })

  describe('handleTriggerUpsertWebhook', () => {
    it('creates webhook subscriptions and returns webhookData', async () => {
      mock.onPost(HOOKS_BASE).reply({ key: 'hook-key-1' })

      const invocation = {
        callbackUrl: 'https://cb.example.com/hook',
        connectionId: 'conn-1',
        events: [{ id: 'trigger-1', triggerData: { event: 'Contact Added' } }],
      }

      const result = await service.handleTriggerUpsertWebhook(invocation)

      expect(mock.history[0].url).toBe(HOOKS_BASE)
      expect(mock.history[0].body).toEqual({
        eventKey: 'contact.add',
        hookUrl: 'https://cb.example.com/hook?connectionId=conn-1',
      })
      expect(result.webhookData.hooks).toEqual([
        { triggerId: 'trigger-1', hookKey: 'hook-key-1', eventKey: 'contact.add' },
      ])
      expect(result.connectionId).toBe('conn-1')
    })

    it('appends connectionId with & when callbackUrl already has query params', async () => {
      mock.onPost(HOOKS_BASE).reply({ key: 'hook-key-2' })

      const invocation = {
        callbackUrl: 'https://cb.example.com/hook?token=abc',
        connectionId: 'conn-2',
        events: [{ id: 'trigger-2', triggerData: { event: 'Contact Deleted' } }],
      }

      await service.handleTriggerUpsertWebhook(invocation)

      expect(mock.history[0].body.hookUrl).toBe('https://cb.example.com/hook?token=abc&connectionId=conn-2')
    })
  })

  describe('handleTriggerResolveEvents', () => {
    it('responds to X-Hook-Secret verification handshake', async () => {
      const invocation = {
        headers: { 'X-Hook-Secret': 'secret-123' },
        body: {},
      }

      const result = await service.handleTriggerResolveEvents(invocation)

      expect(result.handshake).toBe(true)
      expect(result.responseHeaders).toEqual({ 'X-Hook-Secret': 'secret-123' })
    })

    it('handles lowercase x-hook-secret header', async () => {
      const invocation = {
        headers: { 'x-hook-secret': 'secret-456' },
        body: {},
      }

      const result = await service.handleTriggerResolveEvents(invocation)

      expect(result.handshake).toBe(true)
      expect(result.responseHeaders).toEqual({ 'X-Hook-Secret': 'secret-456' })
    })

    it('shapes event data from webhook body', async () => {
      const invocation = {
        headers: {},
        body: { event_key: 'contact.add', object_keys: [{ id: 123 }] },
        queryParams: { connectionId: 'conn-1' },
      }

      const result = await service.handleTriggerResolveEvents(invocation)

      expect(result.connectionId).toBe('conn-1')
      expect(result.events).toEqual([
        {
          name: 'onKeapEvent',
          data: { eventKey: 'contact.add', objectType: 'contact', objectKeys: [{ id: 123 }] },
        },
      ])
    })

    it('returns empty events when no body', async () => {
      const invocation = { headers: {}, queryParams: { connectionId: 'conn-2' } }

      const result = await service.handleTriggerResolveEvents(invocation)

      expect(result.connectionId).toBe('conn-2')
      expect(result.events).toEqual([])
    })
  })

  describe('handleTriggerSelectMatched', () => {
    it('delegates to the named event method', async () => {
      const invocation = {
        eventName: 'onKeapEvent',
        eventData: { eventKey: 'contact.add' },
        triggers: [
          { id: 't1', data: { event: 'Contact Added' } },
          { id: 't2', data: { event: 'Contact Deleted' } },
        ],
      }

      const result = await service.handleTriggerSelectMatched(invocation)

      expect(result).toEqual({ ids: ['t1'] })
    })
  })

  describe('handleTriggerDeleteWebhook', () => {
    it('deletes each hook by key', async () => {
      mock.onDelete(`${ HOOKS_BASE }/hook-key-1`).reply({})
      mock.onDelete(`${ HOOKS_BASE }/hook-key-2`).reply({})

      const invocation = {
        webhookData: {
          hooks: [{ hookKey: 'hook-key-1' }, { hookKey: 'hook-key-2' }],
        },
      }

      const result = await service.handleTriggerDeleteWebhook(invocation)

      expect(mock.history).toHaveLength(2)
      expect(mock.history[0].url).toBe(`${ HOOKS_BASE }/hook-key-1`)
      expect(mock.history[1].url).toBe(`${ HOOKS_BASE }/hook-key-2`)
      expect(result).toEqual({ webhookData: {} })
    })

    it('skips hooks without a hookKey', async () => {
      const invocation = {
        webhookData: { hooks: [{ hookKey: null }, { triggerId: 't1' }] },
      }

      const result = await service.handleTriggerDeleteWebhook(invocation)

      expect(mock.history).toHaveLength(0)
      expect(result).toEqual({ webhookData: {} })
    })

    it('swallows individual delete errors', async () => {
      mock.onDelete(`${ HOOKS_BASE }/hook-key-1`).replyWithError({ message: 'gone' })

      const invocation = {
        webhookData: { hooks: [{ hookKey: 'hook-key-1' }] },
      }

      const result = await service.handleTriggerDeleteWebhook(invocation)

      expect(result).toEqual({ webhookData: {} })
    })

    it('handles missing webhookData gracefully', async () => {
      const result = await service.handleTriggerDeleteWebhook({})

      expect(mock.history).toHaveLength(0)
      expect(result).toEqual({ webhookData: {} })
    })
  })
})
