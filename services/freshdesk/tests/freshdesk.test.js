'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-freshdesk-api-key'
const DOMAIN = 'testcompany'
const BASE = `https://${ DOMAIN }.freshdesk.com/api/v2`
const AUTH_HEADER = `Basic ${ Buffer.from(`${ API_KEY }:X`).toString('base64') }`

describe('Freshdesk Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ domain: DOMAIN, apiKey: API_KEY })
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
          name: 'domain',
          required: true,
          shared: false,
          type: 'STRING',
        }),
        expect.objectContaining({
          name: 'apiKey',
          required: true,
          shared: false,
          type: 'STRING',
        }),
      ])
    })
  })

  // ── Tickets ──

  describe('createTicket', () => {
    it('sends correct request with required params and defaults', async () => {
      mock.onPost(`${ BASE }/tickets`).reply({ id: 42, subject: 'Test' })

      const result = await service.createTicket(
        'Test Subject', '<p>Description</p>', 'user@example.com'
      )

      expect(result).toEqual({ id: 42, subject: 'Test' })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({
        'Authorization': AUTH_HEADER,
        'Content-Type': 'application/json',
      })
      expect(mock.history[0].body).toEqual({
        subject: 'Test Subject',
        description: '<p>Description</p>',
        email: 'user@example.com',
        priority: 1,
        status: 2,
        source: 2,
      })
    })

    it('resolves friendly label choices to numeric values', async () => {
      mock.onPost(`${ BASE }/tickets`).reply({ id: 43 })

      await service.createTicket(
        'Subject', 'Desc', 'a@b.com', undefined,
        'Urgent', 'Pending', 'Email', 'Question'
      )

      expect(mock.history[0].body).toMatchObject({
        priority: 4,
        status: 3,
        source: 1,
        type: 'Question',
      })
    })

    it('includes all optional fields when provided', async () => {
      mock.onPost(`${ BASE }/tickets`).reply({ id: 44 })

      await service.createTicket(
        'Subject', 'Desc', 'a@b.com', 12345,
        'High', 'Resolved', 'Chat', 'Incident',
        ['tag1', 'tag2'], ['cc@example.com'],
        '9999', '8888', { cf_order_id: '123' }
      )

      expect(mock.history[0].body).toEqual({
        subject: 'Subject',
        description: 'Desc',
        email: 'a@b.com',
        requester_id: 12345,
        priority: 3,
        status: 4,
        source: 7,
        type: 'Incident',
        tags: ['tag1', 'tag2'],
        cc_emails: ['cc@example.com'],
        group_id: 9999,
        responder_id: 8888,
        custom_fields: { cf_order_id: '123' },
      })
    })

    it('throws on API error', async () => {
      mock.onPost(`${ BASE }/tickets`).replyWithError({
        message: 'Validation failed',
        body: {
          description: 'Validation failed',
          errors: [{ field: 'email', message: 'is required' }],
        },
      })

      await expect(
        service.createTicket('Subject', 'Desc')
      ).rejects.toThrow('Freshdesk API error')
    })

    it('includes error field details in thrown message', async () => {
      mock.onPost(`${ BASE }/tickets`).replyWithError({
        message: 'Validation failed',
        body: {
          description: 'Validation failed',
          errors: [
            { field: 'email', message: 'is required' },
            { field: 'subject', message: 'cannot be blank' },
          ],
        },
      })

      await expect(
        service.createTicket('', 'Desc')
      ).rejects.toThrow('email: is required; subject: cannot be blank')
    })
  })

  describe('getTicket', () => {
    it('sends correct request without conversations', async () => {
      mock.onGet(`${ BASE }/tickets/42`).reply({ id: 42, subject: 'Test' })

      const result = await service.getTicket(42)

      expect(result).toEqual({ id: 42, subject: 'Test' })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({ 'Authorization': AUTH_HEADER })
      // include should be cleaned (undefined)
      expect(mock.history[0].query).toEqual({})
    })

    it('includes conversations when requested', async () => {
      mock.onGet(`${ BASE }/tickets/42`).reply({ id: 42, conversations: [] })

      await service.getTicket(42, true)

      expect(mock.history[0].query).toMatchObject({ include: 'conversations' })
    })
  })

  describe('listTickets', () => {
    it('sends correct request with defaults', async () => {
      mock.onGet(`${ BASE }/tickets`).reply([])

      const result = await service.listTickets()

      expect(result).toEqual([])
      expect(mock.history[0].query).toMatchObject({ page: 1, per_page: 30 })
    })

    it('resolves filter labels to API values', async () => {
      mock.onGet(`${ BASE }/tickets`).reply([])

      await service.listTickets('New & My Open')

      expect(mock.history[0].query).toMatchObject({ filter: 'new_and_my_open' })
    })

    it('passes custom pagination', async () => {
      mock.onGet(`${ BASE }/tickets`).reply([])

      await service.listTickets(undefined, '2026-07-01T00:00:00Z', 3, 50)

      expect(mock.history[0].query).toMatchObject({
        updated_since: '2026-07-01T00:00:00Z',
        page: 3,
        per_page: 50,
      })
    })
  })

  describe('updateTicket', () => {
    it('sends PUT with only provided fields', async () => {
      mock.onPut(`${ BASE }/tickets/42`).reply({ id: 42, status: 4 })

      const result = await service.updateTicket(42, undefined, undefined, undefined, 'Resolved')

      expect(result).toEqual({ id: 42, status: 4 })
      expect(mock.history[0].body).toEqual({ status: 4 })
    })

    it('sends all optional fields when provided', async () => {
      mock.onPut(`${ BASE }/tickets/42`).reply({ id: 42 })

      await service.updateTicket(
        42, 'New Subject', 'New Desc', 'High', 'Closed',
        'Problem', ['tag'], '111', '222', { cf_field: 'val' }
      )

      expect(mock.history[0].body).toEqual({
        subject: 'New Subject',
        description: 'New Desc',
        priority: 3,
        status: 5,
        type: 'Problem',
        tags: ['tag'],
        group_id: 111,
        responder_id: 222,
        custom_fields: { cf_field: 'val' },
      })
    })
  })

  describe('deleteTicket', () => {
    it('sends DELETE and returns confirmation', async () => {
      mock.onDelete(`${ BASE }/tickets/42`).reply({})

      const result = await service.deleteTicket(42)

      expect(result).toEqual({ deleted: true, ticketId: 42 })
      expect(mock.history).toHaveLength(1)
    })
  })

  describe('addReply', () => {
    it('sends correct request with required params only', async () => {
      mock.onPost(`${ BASE }/tickets/42/reply`).reply({ id: 100, ticket_id: 42 })

      const result = await service.addReply(42, '<p>Reply text</p>')

      expect(result).toEqual({ id: 100, ticket_id: 42 })
      expect(mock.history[0].body).toEqual({ body: '<p>Reply text</p>' })
    })

    it('includes cc and bcc when provided', async () => {
      mock.onPost(`${ BASE }/tickets/42/reply`).reply({ id: 101 })

      await service.addReply(42, 'Reply', ['cc@ex.com'], ['bcc@ex.com'])

      expect(mock.history[0].body).toEqual({
        body: 'Reply',
        cc_emails: ['cc@ex.com'],
        bcc_emails: ['bcc@ex.com'],
      })
    })
  })

  describe('addNote', () => {
    it('sends private note by default', async () => {
      mock.onPost(`${ BASE }/tickets/42/notes`).reply({ id: 200, private: true })

      const result = await service.addNote(42, 'Internal note')

      expect(result).toEqual({ id: 200, private: true })
      expect(mock.history[0].body).toEqual({ body: 'Internal note', private: true })
    })

    it('sends public note when private is false', async () => {
      mock.onPost(`${ BASE }/tickets/42/notes`).reply({ id: 201 })

      await service.addNote(42, 'Public note', false)

      expect(mock.history[0].body).toEqual({ body: 'Public note', private: false })
    })
  })

  describe('searchTickets', () => {
    it('wraps query in double quotes', async () => {
      mock.onGet(`${ BASE }/search/tickets`).reply({ total: 0, results: [] })

      const result = await service.searchTickets('priority:4 AND status:2')

      expect(result).toEqual({ total: 0, results: [] })
      expect(mock.history[0].query).toMatchObject({
        query: '"priority:4 AND status:2"',
        page: 1,
      })
    })

    it('strips existing surrounding quotes from query', async () => {
      mock.onGet(`${ BASE }/search/tickets`).reply({ total: 0, results: [] })

      await service.searchTickets('"priority:4"')

      expect(mock.history[0].query).toMatchObject({
        query: '"priority:4"',
      })
    })

    it('passes custom page', async () => {
      mock.onGet(`${ BASE }/search/tickets`).reply({ total: 50, results: [] })

      await service.searchTickets('status:2', 3)

      expect(mock.history[0].query).toMatchObject({ page: 3 })
    })
  })

  describe('listTicketConversations', () => {
    it('sends correct request with defaults', async () => {
      mock.onGet(`${ BASE }/tickets/42/conversations`).reply([])

      const result = await service.listTicketConversations(42)

      expect(result).toEqual([])
      expect(mock.history[0].query).toMatchObject({ page: 1, per_page: 30 })
    })

    it('passes custom pagination', async () => {
      mock.onGet(`${ BASE }/tickets/42/conversations`).reply([])

      await service.listTicketConversations(42, 2, 50)

      expect(mock.history[0].query).toMatchObject({ page: 2, per_page: 50 })
    })
  })

  // ── Contacts ──

  describe('createContact', () => {
    it('sends correct request with required params', async () => {
      mock.onPost(`${ BASE }/contacts`).reply({ id: 1001, name: 'Jane' })

      const result = await service.createContact('Jane Doe', 'jane@example.com')

      expect(result).toEqual({ id: 1001, name: 'Jane' })
      expect(mock.history[0].body).toEqual({
        name: 'Jane Doe',
        email: 'jane@example.com',
      })
    })

    it('includes all optional fields', async () => {
      mock.onPost(`${ BASE }/contacts`).reply({ id: 1002 })

      await service.createContact('Jane', 'j@ex.com', '+1555', 9876, { dept: 'Sales' })

      expect(mock.history[0].body).toEqual({
        name: 'Jane',
        email: 'j@ex.com',
        phone: '+1555',
        company_id: 9876,
        custom_fields: { dept: 'Sales' },
      })
    })
  })

  describe('getContact', () => {
    it('sends correct request', async () => {
      mock.onGet(`${ BASE }/contacts/1001`).reply({ id: 1001, name: 'Jane' })

      const result = await service.getContact(1001)

      expect(result).toEqual({ id: 1001, name: 'Jane' })
      expect(mock.history).toHaveLength(1)
    })
  })

  describe('listContacts', () => {
    it('sends correct request with defaults', async () => {
      mock.onGet(`${ BASE }/contacts`).reply([])

      const result = await service.listContacts()

      expect(result).toEqual([])
      expect(mock.history[0].query).toMatchObject({ page: 1, per_page: 30 })
    })

    it('filters by email', async () => {
      mock.onGet(`${ BASE }/contacts`).reply([{ id: 1001 }])

      await service.listContacts('jane@example.com')

      expect(mock.history[0].query).toMatchObject({ email: 'jane@example.com' })
    })

    it('passes custom pagination', async () => {
      mock.onGet(`${ BASE }/contacts`).reply([])

      await service.listContacts(undefined, 2, 50)

      expect(mock.history[0].query).toMatchObject({ page: 2, per_page: 50 })
    })
  })

  describe('updateContact', () => {
    it('sends PUT with only provided fields', async () => {
      mock.onPut(`${ BASE }/contacts/1001`).reply({ id: 1001, phone: '+1999' })

      const result = await service.updateContact(1001, undefined, undefined, '+1999')

      expect(result).toEqual({ id: 1001, phone: '+1999' })
      expect(mock.history[0].body).toEqual({ phone: '+1999' })
    })

    it('sends all fields when provided', async () => {
      mock.onPut(`${ BASE }/contacts/1001`).reply({ id: 1001 })

      await service.updateContact(1001, 'New Name', 'new@ex.com', '+1555', 9876, { x: 1 })

      expect(mock.history[0].body).toEqual({
        name: 'New Name',
        email: 'new@ex.com',
        phone: '+1555',
        company_id: 9876,
        custom_fields: { x: 1 },
      })
    })
  })

  describe('deleteContact', () => {
    it('sends DELETE and returns confirmation', async () => {
      mock.onDelete(`${ BASE }/contacts/1001`).reply({})

      const result = await service.deleteContact(1001)

      expect(result).toEqual({ deleted: true, contactId: 1001 })
    })
  })

  describe('searchContacts', () => {
    it('wraps query in double quotes', async () => {
      mock.onGet(`${ BASE }/search/contacts`).reply({ total: 1, results: [] })

      const result = await service.searchContacts("email:'jane@ex.com'")

      expect(result).toEqual({ total: 1, results: [] })
      expect(mock.history[0].query).toMatchObject({
        query: '"email:\'jane@ex.com\'"',
        page: 1,
      })
    })
  })

  // ── Companies ──

  describe('createCompany', () => {
    it('sends correct request with required params', async () => {
      mock.onPost(`${ BASE }/companies`).reply({ id: 5001, name: 'Acme' })

      const result = await service.createCompany('Acme Inc')

      expect(result).toEqual({ id: 5001, name: 'Acme' })
      expect(mock.history[0].body).toEqual({ name: 'Acme Inc' })
    })

    it('includes all optional fields', async () => {
      mock.onPost(`${ BASE }/companies`).reply({ id: 5002 })

      await service.createCompany('Acme', ['acme.com'], 'A company', { size: 'large' })

      expect(mock.history[0].body).toEqual({
        name: 'Acme',
        domains: ['acme.com'],
        description: 'A company',
        custom_fields: { size: 'large' },
      })
    })
  })

  describe('listCompanies', () => {
    it('sends correct request with defaults', async () => {
      mock.onGet(`${ BASE }/companies`).reply([])

      const result = await service.listCompanies()

      expect(result).toEqual([])
      expect(mock.history[0].query).toMatchObject({ page: 1, per_page: 30 })
    })

    it('passes custom pagination', async () => {
      mock.onGet(`${ BASE }/companies`).reply([])

      await service.listCompanies(3, 100)

      expect(mock.history[0].query).toMatchObject({ page: 3, per_page: 100 })
    })
  })

  describe('getCompany', () => {
    it('sends correct request', async () => {
      mock.onGet(`${ BASE }/companies/5001`).reply({ id: 5001, name: 'Acme' })

      const result = await service.getCompany(5001)

      expect(result).toEqual({ id: 5001, name: 'Acme' })
    })
  })

  // ── Admin ──

  describe('listAgents', () => {
    it('sends correct request with defaults', async () => {
      mock.onGet(`${ BASE }/agents`).reply([])

      const result = await service.listAgents()

      expect(result).toEqual([])
      expect(mock.history[0].query).toMatchObject({ page: 1, per_page: 30 })
    })

    it('filters by email', async () => {
      mock.onGet(`${ BASE }/agents`).reply([])

      await service.listAgents('agent@co.com')

      expect(mock.history[0].query).toMatchObject({ email: 'agent@co.com' })
    })
  })

  describe('listGroups', () => {
    it('sends correct request with defaults', async () => {
      mock.onGet(`${ BASE }/groups`).reply([])

      const result = await service.listGroups()

      expect(result).toEqual([])
      expect(mock.history[0].query).toMatchObject({ page: 1, per_page: 30 })
    })

    it('passes custom pagination', async () => {
      mock.onGet(`${ BASE }/groups`).reply([])

      await service.listGroups(2, 50)

      expect(mock.history[0].query).toMatchObject({ page: 2, per_page: 50 })
    })
  })

  describe('listTicketFields', () => {
    it('sends correct request', async () => {
      mock.onGet(`${ BASE }/ticket_fields`).reply([{ id: 1, name: 'subject' }])

      const result = await service.listTicketFields()

      expect(result).toEqual([{ id: 1, name: 'subject' }])
      expect(mock.history).toHaveLength(1)
    })
  })

  // ── Dictionaries ──

  describe('getAgentsDictionary', () => {
    const agentsResponse = [
      { id: 100, contact: { name: 'Alice Agent', email: 'alice@co.com' } },
      { id: 200, contact: { name: 'Bob Support', email: 'bob@co.com' } },
    ]

    it('returns all agents mapped to dictionary items', async () => {
      mock.onGet(`${ BASE }/agents`).reply(agentsResponse)

      const result = await service.getAgentsDictionary({})

      expect(result.items).toEqual([
        { label: 'Alice Agent', value: '100', note: 'alice@co.com' },
        { label: 'Bob Support', value: '200', note: 'bob@co.com' },
      ])
      expect(result.cursor).toBeNull()
      expect(mock.history[0].query).toMatchObject({ page: 1, per_page: 100 })
    })

    it('filters by search text', async () => {
      mock.onGet(`${ BASE }/agents`).reply(agentsResponse)

      const result = await service.getAgentsDictionary({ search: 'alice' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toBe('Alice Agent')
    })

    it('filters by email search', async () => {
      mock.onGet(`${ BASE }/agents`).reply(agentsResponse)

      const result = await service.getAgentsDictionary({ search: 'bob@co' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('200')
    })

    it('uses cursor for pagination', async () => {
      mock.onGet(`${ BASE }/agents`).reply(agentsResponse)

      await service.getAgentsDictionary({ cursor: '3' })

      expect(mock.history[0].query).toMatchObject({ page: 3 })
    })

    it('returns next cursor when page is full', async () => {
      const fullPage = Array.from({ length: 100 }, (_, i) => ({
        id: i, contact: { name: `Agent ${ i }`, email: `a${ i }@co.com` },
      }))

      mock.onGet(`${ BASE }/agents`).reply(fullPage)

      const result = await service.getAgentsDictionary({ cursor: '2' })

      expect(result.cursor).toBe('3')
    })

    it('handles null payload', async () => {
      mock.onGet(`${ BASE }/agents`).reply([])

      const result = await service.getAgentsDictionary(null)

      expect(result.items).toEqual([])
      expect(result.cursor).toBeNull()
    })
  })

  describe('getGroupsDictionary', () => {
    const groupsResponse = [
      { id: 10, name: 'Billing', description: 'Billing team' },
      { id: 20, name: 'Support', description: null },
    ]

    it('returns all groups mapped to dictionary items', async () => {
      mock.onGet(`${ BASE }/groups`).reply(groupsResponse)

      const result = await service.getGroupsDictionary({})

      expect(result.items).toEqual([
        { label: 'Billing', value: '10', note: 'Billing team' },
        { label: 'Support', value: '20' },
      ])
      expect(result.cursor).toBeNull()
    })

    it('filters by search text', async () => {
      mock.onGet(`${ BASE }/groups`).reply(groupsResponse)

      const result = await service.getGroupsDictionary({ search: 'bill' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toBe('Billing')
    })

    it('returns next cursor when page is full', async () => {
      const fullPage = Array.from({ length: 100 }, (_, i) => ({
        id: i, name: `Group ${ i }`,
      }))

      mock.onGet(`${ BASE }/groups`).reply(fullPage)

      const result = await service.getGroupsDictionary({})

      expect(result.cursor).toBe('2')
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('handles rate limit errors with retry-after', async () => {
      mock.onGet(`${ BASE }/tickets`).replyWithError({
        message: 'Too Many Requests',
        status: 429,
        response: { headers: { 'retry-after': '60' } },
      })

      await expect(service.listTickets()).rejects.toThrow('Rate limit exceeded')
    })

    it('handles errors without body', async () => {
      mock.onGet(`${ BASE }/tickets/999`).replyWithError({
        message: 'Not Found',
      })

      await expect(service.getTicket(999)).rejects.toThrow('Freshdesk API error: Not Found')
    })

    it('handles errors with description but no field errors', async () => {
      mock.onGet(`${ BASE }/tickets/999`).replyWithError({
        message: 'Not Found',
        body: { description: 'Ticket not found' },
      })

      await expect(service.getTicket(999)).rejects.toThrow('Freshdesk API error: Ticket not found')
    })
  })
})
