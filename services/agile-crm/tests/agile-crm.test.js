'use strict'

const { createSandbox } = require('../../../service-sandbox')

const DOMAIN = 'testcompany'
const EMAIL = 'test@example.com'
const API_KEY = 'test-api-key-123'
const BASE = `https://${ DOMAIN }.agilecrm.com/dev/api`
const AUTH_HEADER = `Basic ${ Buffer.from(`${ EMAIL }:${ API_KEY }`).toString('base64') }`

describe('Agile CRM Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ domain: DOMAIN, email: EMAIL, apiKey: API_KEY })
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
        expect.objectContaining({ name: 'domain', required: true, shared: false, type: 'STRING' }),
        expect.objectContaining({ name: 'email', required: true, shared: false, type: 'STRING' }),
        expect.objectContaining({ name: 'apiKey', required: true, shared: false, type: 'STRING' }),
      ])
    })
  })

  // ── Contacts ──

  describe('createContact', () => {
    const contactResponse = {
      id: 5685809876205568,
      type: 'PERSON',
      tags: ['lead'],
      properties: [
        { type: 'SYSTEM', name: 'first_name', value: 'John' },
        { type: 'SYSTEM', name: 'email', subtype: 'work', value: 'john@example.com' },
      ],
    }

    it('sends correct request with simple fields', async () => {
      mock.onPost(`${ BASE }/contacts`).reply(contactResponse)

      const result = await service.createContact('John', 'Doe', 'john@example.com', '555-1234', 'Acme', 'CEO', ['lead'])

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({
        Authorization: AUTH_HEADER,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      })
      expect(mock.history[0].body).toEqual({
        type: 'PERSON',
        tags: ['lead'],
        properties: [
          { type: 'SYSTEM', name: 'first_name', value: 'John' },
          { type: 'SYSTEM', name: 'last_name', value: 'Doe' },
          { type: 'SYSTEM', name: 'email', subtype: 'work', value: 'john@example.com' },
          { type: 'SYSTEM', name: 'phone', subtype: 'work', value: '555-1234' },
          { type: 'SYSTEM', name: 'company', value: 'Acme' },
          { type: 'SYSTEM', name: 'title', value: 'CEO' },
        ],
      })
      expect(result).toHaveProperty('simple')
      expect(result.simple).toEqual({ first_name: 'John', email: 'john@example.com' })
    })

    it('omits empty fields and tags when not provided', async () => {
      mock.onPost(`${ BASE }/contacts`).reply({ id: 1, type: 'PERSON', properties: [] })

      await service.createContact('Jane')

      expect(mock.history[0].body).toEqual({
        type: 'PERSON',
        properties: [{ type: 'SYSTEM', name: 'first_name', value: 'Jane' }],
      })
    })

    it('appends raw properties with correct type inference', async () => {
      mock.onPost(`${ BASE }/contacts`).reply({ id: 1, type: 'PERSON', properties: [] })

      await service.createContact(undefined, undefined, undefined, undefined, undefined, undefined, undefined, [
        { name: 'custom_field', value: '123' },
        { name: 'email', value: 'alt@example.com', type: 'SYSTEM', subtype: 'personal' },
      ])

      const props = mock.history[0].body.properties
      expect(props).toEqual([
        { name: 'custom_field', value: '123', type: 'CUSTOM' },
        { name: 'email', value: 'alt@example.com', type: 'SYSTEM', subtype: 'personal' },
      ])
    })

    it('throws on API error', async () => {
      mock.onPost(`${ BASE }/contacts`).replyWithError({ message: 'Bad Request', status: 400 })

      await expect(service.createContact('John')).rejects.toThrow('Agile CRM API error')
    })
  })

  describe('getContact', () => {
    it('sends GET request with contact id', async () => {
      mock.onGet(`${ BASE }/contacts/123`).reply({
        id: 123,
        type: 'PERSON',
        properties: [{ type: 'SYSTEM', name: 'first_name', value: 'John' }],
      })

      const result = await service.getContact('123')

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].url).toBe(`${ BASE }/contacts/123`)
      expect(result.simple).toEqual({ first_name: 'John' })
    })
  })

  describe('getContactByEmail', () => {
    it('encodes email in URL path', async () => {
      mock.onGet(`${ BASE }/contacts/search/email/john%40example.com`).reply({
        id: 123,
        type: 'PERSON',
        properties: [{ type: 'SYSTEM', name: 'email', value: 'john@example.com' }],
      })

      const result = await service.getContactByEmail('john@example.com')

      expect(mock.history[0].url).toBe(`${ BASE }/contacts/search/email/john%40example.com`)
      expect(result.simple).toEqual({ email: 'john@example.com' })
    })
  })

  describe('listContacts', () => {
    it('sends correct query params with defaults', async () => {
      mock.onGet(`${ BASE }/contacts`).reply([])

      await service.listContacts()

      expect(mock.history[0].query).toMatchObject({ page_size: 20 })
    })

    it('passes custom page size and cursor', async () => {
      mock.onGet(`${ BASE }/contacts`).reply([])

      await service.listContacts(50, 'abc123')

      expect(mock.history[0].query).toMatchObject({ page_size: 50, cursor: 'abc123' })
    })

    it('returns paginated result with cursor from last item', async () => {
      mock.onGet(`${ BASE }/contacts`).reply([
        { id: 1, properties: [], cursor: 'next-cursor' },
      ])

      const result = await service.listContacts()

      expect(result.items).toHaveLength(1)
      expect(result.cursor).toBe('next-cursor')
    })

    it('omits cursor when not present in result', async () => {
      mock.onGet(`${ BASE }/contacts`).reply([
        { id: 1, properties: [] },
      ])

      const result = await service.listContacts()

      expect(result).not.toHaveProperty('cursor')
    })
  })

  describe('updateContact', () => {
    it('sends PUT with id and updated properties', async () => {
      mock.onPut(`${ BASE }/contacts/edit-properties`).reply({
        id: 123,
        type: 'PERSON',
        properties: [{ type: 'SYSTEM', name: 'title', value: 'VP Sales' }],
      })

      const result = await service.updateContact('123', undefined, undefined, undefined, undefined, undefined, 'VP Sales')

      expect(mock.history[0].body).toEqual({
        id: '123',
        properties: [{ type: 'SYSTEM', name: 'title', value: 'VP Sales' }],
      })
      expect(result.simple).toEqual({ title: 'VP Sales' })
    })
  })

  describe('deleteContact', () => {
    it('sends DELETE and returns success', async () => {
      mock.onDelete(`${ BASE }/contacts/123`).reply({})

      const result = await service.deleteContact('123')

      expect(mock.history).toHaveLength(1)
      expect(result).toEqual({ success: true, id: '123' })
    })
  })

  describe('searchContacts', () => {
    it('sends correct query params with defaults', async () => {
      mock.onGet(`${ BASE }/search`).reply([])

      await service.searchContacts('John')

      expect(mock.history[0].query).toMatchObject({ q: 'John', type: 'PERSON', page_size: 10 })
    })

    it('resolves dropdown choice for type', async () => {
      mock.onGet(`${ BASE }/search`).reply([])

      await service.searchContacts('Acme', 'Company', 5)

      expect(mock.history[0].query).toMatchObject({ q: 'Acme', type: 'COMPANY', page_size: 5 })
    })

    it('flattens properties on each result', async () => {
      mock.onGet(`${ BASE }/search`).reply([
        { id: 1, properties: [{ name: 'first_name', value: 'John' }] },
      ])

      const result = await service.searchContacts('John')

      expect(result).toHaveLength(1)
      expect(result[0].simple).toEqual({ first_name: 'John' })
    })

    it('returns empty array for non-array response', async () => {
      mock.onGet(`${ BASE }/search`).reply(null)

      const result = await service.searchContacts('nobody')

      expect(result).toEqual([])
    })
  })

  describe('addTagsToContact', () => {
    it('sends form-encoded POST with email and tags', async () => {
      mock.onPost(`${ BASE }/contacts/email/tags/add`).reply({})

      const result = await service.addTagsToContact('john@example.com', ['lead', 'vip'])

      expect(mock.history[0].headers).toMatchObject({
        'Content-Type': 'application/x-www-form-urlencoded',
      })
      expect(result).toEqual({ success: true, email: 'john@example.com', tags: ['lead', 'vip'] })
    })

    it('wraps single tag in array', async () => {
      mock.onPost(`${ BASE }/contacts/email/tags/add`).reply({})

      const result = await service.addTagsToContact('john@example.com', 'lead')

      expect(result.tags).toEqual('lead')
    })
  })

  describe('deleteTagsFromContact', () => {
    it('sends form-encoded POST for tag deletion', async () => {
      mock.onPost(`${ BASE }/contacts/email/tags/delete`).reply({})

      const result = await service.deleteTagsFromContact('john@example.com', ['vip'])

      expect(mock.history[0].headers).toMatchObject({
        'Content-Type': 'application/x-www-form-urlencoded',
      })
      expect(result).toEqual({ success: true, email: 'john@example.com', tags: ['vip'] })
    })
  })

  // ── Companies ──

  describe('createCompany', () => {
    it('sends correct request with company fields', async () => {
      mock.onPost(`${ BASE }/contacts`).reply({
        id: 5123456789012345,
        type: 'COMPANY',
        properties: [{ type: 'SYSTEM', name: 'name', value: 'Acme Inc' }],
      })

      const result = await service.createCompany('Acme Inc', 'https://acme.com', '555-0000', ['enterprise'])

      expect(mock.history[0].body).toEqual({
        type: 'COMPANY',
        tags: ['enterprise'],
        properties: [
          { type: 'SYSTEM', name: 'name', value: 'Acme Inc' },
          { type: 'SYSTEM', name: 'website', value: 'https://acme.com' },
          { type: 'SYSTEM', name: 'phone', subtype: 'work', value: '555-0000' },
        ],
      })
      expect(result.simple).toEqual({ name: 'Acme Inc' })
    })

    it('omits tags when not provided', async () => {
      mock.onPost(`${ BASE }/contacts`).reply({ id: 1, type: 'COMPANY', properties: [] })

      await service.createCompany('Test Co')

      expect(mock.history[0].body).not.toHaveProperty('tags')
    })
  })

  describe('getCompany', () => {
    it('fetches company by id', async () => {
      mock.onGet(`${ BASE }/contacts/456`).reply({
        id: 456,
        type: 'COMPANY',
        properties: [{ type: 'SYSTEM', name: 'name', value: 'Acme' }],
      })

      const result = await service.getCompany('456')

      expect(result.simple).toEqual({ name: 'Acme' })
    })
  })

  describe('listCompanies', () => {
    it('sends form-encoded POST with defaults', async () => {
      mock.onPost(`${ BASE }/contacts/companies/list`).reply([])

      await service.listCompanies()

      expect(mock.history[0].headers).toMatchObject({
        'Content-Type': 'application/x-www-form-urlencoded',
      })
    })

    it('returns paginated result', async () => {
      mock.onPost(`${ BASE }/contacts/companies/list`).reply([
        { id: 1, properties: [], cursor: 'next' },
      ])

      const result = await service.listCompanies(10)

      expect(result.items).toHaveLength(1)
      expect(result.cursor).toBe('next')
    })
  })

  describe('updateCompany', () => {
    it('sends PUT with id and properties', async () => {
      mock.onPut(`${ BASE }/contacts/edit-properties`).reply({
        id: 456,
        type: 'COMPANY',
        properties: [{ type: 'SYSTEM', name: 'name', value: 'Acme LLC' }],
      })

      const result = await service.updateCompany('456', 'Acme LLC')

      expect(mock.history[0].body).toEqual({
        id: '456',
        properties: [{ type: 'SYSTEM', name: 'name', value: 'Acme LLC' }],
      })
      expect(result.simple).toEqual({ name: 'Acme LLC' })
    })
  })

  describe('deleteCompany', () => {
    it('sends DELETE and returns success', async () => {
      mock.onDelete(`${ BASE }/contacts/456`).reply({})

      const result = await service.deleteCompany('456')

      expect(result).toEqual({ success: true, id: '456' })
    })
  })

  // ── Deals ──

  describe('createDeal', () => {
    it('sends correct request with required fields only', async () => {
      mock.onPost(`${ BASE }/opportunity`).reply({ id: 6001, name: 'Big Deal', expected_value: 5000 })

      const result = await service.createDeal('Big Deal', 5000)

      expect(mock.history[0].body).toEqual({ name: 'Big Deal', expected_value: 5000 })
      expect(result).toEqual({ id: 6001, name: 'Big Deal', expected_value: 5000 })
    })

    it('includes all optional fields when provided', async () => {
      mock.onPost(`${ BASE }/opportunity`).reply({ id: 6001 })

      await service.createDeal('Deal', 1000, 'Prospect', '5700', 75, 1700000000, ['c1', 'c2'])

      expect(mock.history[0].body).toEqual({
        name: 'Deal',
        expected_value: 1000,
        milestone: 'Prospect',
        pipeline_id: '5700',
        probability: 75,
        close_date: 1700000000,
        contact_ids: ['c1', 'c2'],
      })
    })
  })

  describe('getDeal', () => {
    it('fetches deal by id', async () => {
      mock.onGet(`${ BASE }/opportunity/6001`).reply({ id: 6001, name: 'Deal' })

      const result = await service.getDeal('6001')

      expect(result).toEqual({ id: 6001, name: 'Deal' })
    })
  })

  describe('listDeals', () => {
    it('sends correct query with defaults', async () => {
      mock.onGet(`${ BASE }/opportunity`).reply([])

      await service.listDeals()

      expect(mock.history[0].query).toMatchObject({ page_size: 10 })
    })

    it('returns paginated result', async () => {
      mock.onGet(`${ BASE }/opportunity`).reply([{ id: 1, cursor: 'abc' }])

      const result = await service.listDeals(5, 'prev')

      expect(mock.history[0].query).toMatchObject({ page_size: 5, cursor: 'prev' })
      expect(result.cursor).toBe('abc')
    })
  })

  describe('updateDeal', () => {
    it('sends PUT with id only when no fields changed', async () => {
      mock.onPut(`${ BASE }/opportunity/partial-update`).reply({ id: 6001 })

      await service.updateDeal('6001')

      expect(mock.history[0].body).toEqual({ id: '6001' })
    })

    it('includes all optional fields when provided', async () => {
      mock.onPut(`${ BASE }/opportunity/partial-update`).reply({ id: 6001 })

      await service.updateDeal('6001', 'New Name', 2000, 'Won', '5700', 100, 1700000000)

      expect(mock.history[0].body).toEqual({
        id: '6001',
        name: 'New Name',
        expected_value: 2000,
        milestone: 'Won',
        pipeline_id: '5700',
        probability: 100,
        close_date: 1700000000,
      })
    })
  })

  describe('deleteDeal', () => {
    it('sends DELETE and returns success', async () => {
      mock.onDelete(`${ BASE }/opportunity/6001`).reply({})

      const result = await service.deleteDeal('6001')

      expect(result).toEqual({ success: true, id: '6001' })
    })
  })

  // ── Tasks ──

  describe('createTask', () => {
    it('sends correct request with defaults', async () => {
      mock.onPost(`${ BASE }/tasks`).reply({ id: 6100, subject: 'Call John', type: 'CALL' })

      const result = await service.createTask('Call John')

      expect(mock.history[0].body).toEqual({
        subject: 'Call John',
        type: 'CALL',
        priority_type: 'NORMAL',
      })
      expect(result).toHaveProperty('id', 6100)
    })

    it('resolves dropdown choices for type and priority', async () => {
      mock.onPost(`${ BASE }/tasks`).reply({ id: 6100 })

      await service.createTask('Meeting prep', 'Meeting', 'High', 1700000000, ['c1'])

      expect(mock.history[0].body).toEqual({
        subject: 'Meeting prep',
        type: 'MEETING',
        priority_type: 'HIGH',
        due: 1700000000,
        contacts: ['c1'],
      })
    })

    it('resolves Follow Up type correctly', async () => {
      mock.onPost(`${ BASE }/tasks`).reply({ id: 6100 })

      await service.createTask('Follow up', 'Follow Up')

      expect(mock.history[0].body.type).toBe('FOLLOW_UP')
    })
  })

  describe('listPendingTasks', () => {
    it('uses default 7 days when not provided', async () => {
      mock.onGet(`${ BASE }/tasks/pending/7`).reply([])

      const result = await service.listPendingTasks()

      expect(result).toEqual([])
    })

    it('uses custom days value', async () => {
      mock.onGet(`${ BASE }/tasks/pending/30`).reply([{ id: 1 }])

      const result = await service.listPendingTasks(30)

      expect(result).toEqual([{ id: 1 }])
    })

    it('returns empty array for non-array response', async () => {
      mock.onGet(`${ BASE }/tasks/pending/7`).reply(null)

      const result = await service.listPendingTasks()

      expect(result).toEqual([])
    })
  })

  describe('updateTask', () => {
    it('sends PUT with id only when no changes', async () => {
      mock.onPut(`${ BASE }/tasks`).reply({ id: 6100 })

      await service.updateTask('6100')

      expect(mock.history[0].body).toEqual({ id: '6100' })
    })

    it('resolves choices and maps isComplete to status', async () => {
      mock.onPut(`${ BASE }/tasks`).reply({ id: 6100 })

      await service.updateTask('6100', 'Updated', 'Email', 'Low', 1700000000, true)

      expect(mock.history[0].body).toEqual({
        id: '6100',
        subject: 'Updated',
        type: 'EMAIL',
        priority_type: 'LOW',
        due: 1700000000,
        status: 'COMPLETED',
      })
    })

    it('sets status to YET_TO_START when isComplete is false', async () => {
      mock.onPut(`${ BASE }/tasks`).reply({ id: 6100 })

      await service.updateTask('6100', undefined, undefined, undefined, undefined, false)

      expect(mock.history[0].body.status).toBe('YET_TO_START')
    })
  })

  describe('deleteTask', () => {
    it('sends DELETE and returns success', async () => {
      mock.onDelete(`${ BASE }/tasks/6100`).reply({})

      const result = await service.deleteTask('6100')

      expect(result).toEqual({ success: true, id: '6100' })
    })
  })

  // ── Notes ──

  describe('createNote', () => {
    it('sends correct request with required fields', async () => {
      mock.onPost(`${ BASE }/notes`).reply({ id: 6200, subject: 'Call notes' })

      const result = await service.createNote('Call notes', undefined, ['c1', 'c2'])

      expect(mock.history[0].body).toEqual({
        subject: 'Call notes',
        contact_ids: ['c1', 'c2'],
      })
      expect(result).toHaveProperty('id', 6200)
    })

    it('includes description when provided', async () => {
      mock.onPost(`${ BASE }/notes`).reply({ id: 6200 })

      await service.createNote('Call notes', 'Discussed pricing', ['c1'])

      expect(mock.history[0].body).toEqual({
        subject: 'Call notes',
        description: 'Discussed pricing',
        contact_ids: ['c1'],
      })
    })

    it('wraps single contactId in array', async () => {
      mock.onPost(`${ BASE }/notes`).reply({ id: 6200 })

      await service.createNote('Note', undefined, 'c1')

      expect(mock.history[0].body.contact_ids).toEqual(['c1'])
    })
  })

  describe('listNotesForContact', () => {
    it('fetches notes for a contact', async () => {
      mock.onGet(`${ BASE }/contacts/c1/notes`).reply([{ id: 1, subject: 'Note 1' }])

      const result = await service.listNotesForContact('c1')

      expect(result).toEqual([{ id: 1, subject: 'Note 1' }])
    })

    it('returns empty array for non-array response', async () => {
      mock.onGet(`${ BASE }/contacts/c1/notes`).reply(null)

      const result = await service.listNotesForContact('c1')

      expect(result).toEqual([])
    })
  })

  // ── Dictionaries ──

  describe('getTracksDictionary', () => {
    const tracksResponse = [
      { id: 5700, name: 'Sales Pipeline' },
      { id: 5701, name: 'Support Pipeline' },
    ]

    it('returns all tracks as dictionary items', async () => {
      mock.onGet(`${ BASE }/tracks`).reply(tracksResponse)

      const result = await service.getTracksDictionary({})

      expect(result.items).toEqual([
        { label: 'Sales Pipeline', value: '5700', note: 'Track' },
        { label: 'Support Pipeline', value: '5701', note: 'Track' },
      ])
    })

    it('filters tracks by search term', async () => {
      mock.onGet(`${ BASE }/tracks`).reply(tracksResponse)

      const result = await service.getTracksDictionary({ search: 'support' })

      expect(result.items).toEqual([
        { label: 'Support Pipeline', value: '5701', note: 'Track' },
      ])
    })

    it('handles empty payload', async () => {
      mock.onGet(`${ BASE }/tracks`).reply([])

      const result = await service.getTracksDictionary()

      expect(result.items).toEqual([])
    })
  })

  describe('getMilestonesDictionary', () => {
    const tracksResponse = [
      { id: 5700, name: 'Sales', is_default: true, milestones: 'Prospect,Proposal,Won,Lost' },
      { id: 5701, name: 'Support', is_default: false, milestones: 'New,In Progress,Resolved' },
    ]

    it('returns milestones from default track when no criteria', async () => {
      mock.onGet(`${ BASE }/tracks`).reply(tracksResponse)

      const result = await service.getMilestonesDictionary({})

      expect(result.items).toEqual([
        { label: 'Prospect', value: 'Prospect', note: 'Milestone' },
        { label: 'Proposal', value: 'Proposal', note: 'Milestone' },
        { label: 'Won', value: 'Won', note: 'Milestone' },
        { label: 'Lost', value: 'Lost', note: 'Milestone' },
      ])
    })

    it('returns milestones from selected track via criteria', async () => {
      mock.onGet(`${ BASE }/tracks`).reply(tracksResponse)

      const result = await service.getMilestonesDictionary({ criteria: { pipelineId: '5701' } })

      expect(result.items).toEqual([
        { label: 'New', value: 'New', note: 'Milestone' },
        { label: 'In Progress', value: 'In Progress', note: 'Milestone' },
        { label: 'Resolved', value: 'Resolved', note: 'Milestone' },
      ])
    })

    it('filters milestones by search term', async () => {
      mock.onGet(`${ BASE }/tracks`).reply(tracksResponse)

      const result = await service.getMilestonesDictionary({ search: 'pro' })

      expect(result.items).toEqual([
        { label: 'Prospect', value: 'Prospect', note: 'Milestone' },
        { label: 'Proposal', value: 'Proposal', note: 'Milestone' },
      ])
    })

    it('handles empty payload', async () => {
      mock.onGet(`${ BASE }/tracks`).reply(tracksResponse)

      const result = await service.getMilestonesDictionary()

      expect(result.items).toHaveLength(4)
    })

    it('falls back to first track when no default found', async () => {
      mock.onGet(`${ BASE }/tracks`).reply([
        { id: 5700, name: 'Only', milestones: 'A,B' },
      ])

      const result = await service.getMilestonesDictionary({})

      expect(result.items).toEqual([
        { label: 'A', value: 'A', note: 'Milestone' },
        { label: 'B', value: 'B', note: 'Milestone' },
      ])
    })
  })
})
