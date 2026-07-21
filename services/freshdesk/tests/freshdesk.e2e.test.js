'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Freshdesk Service (e2e)', () => {
  let sandbox
  let service

  beforeAll(() => {
    sandbox = createE2ESandbox('freshdesk')
    require('../src/index.js')

    try {
      sandbox.validateConfigs()
    } catch (error) {
      console.log(error)
      process.exit(1)
    }

    service = sandbox.getService()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Admin ──

  describe('listTicketFields', () => {
    it('returns an array of ticket fields', async () => {
      const result = await service.listTicketFields()

      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThan(0)
      expect(result[0]).toHaveProperty('id')
      expect(result[0]).toHaveProperty('name')
      expect(result[0]).toHaveProperty('type')
    })
  })

  describe('listAgents', () => {
    it('returns an array of agents', async () => {
      const result = await service.listAgents()

      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThan(0)
      expect(result[0]).toHaveProperty('id')
      expect(result[0]).toHaveProperty('contact')
    })
  })

  describe('listGroups', () => {
    it('returns an array of groups', async () => {
      const result = await service.listGroups()

      expect(Array.isArray(result)).toBe(true)
      // Groups may be empty in some accounts, so just check the array type
    })
  })

  // ── Dictionaries ──

  describe('getAgentsDictionary', () => {
    it('returns dictionary items with correct shape', async () => {
      const result = await service.getAgentsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor')

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
      }
    })
  })

  describe('getGroupsDictionary', () => {
    it('returns dictionary items with correct shape', async () => {
      const result = await service.getGroupsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor')
    })
  })

  // ── Contacts lifecycle ──

  describe('contact lifecycle', () => {
    let contactId
    const testEmail = `e2e-test-${ Date.now() }@flowrunner-test.com`

    it('creates a contact', async () => {
      const result = await service.createContact('E2E Test Contact', testEmail, '+15550199')

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('name', 'E2E Test Contact')
      expect(result).toHaveProperty('email', testEmail)
      contactId = result.id
    })

    it('gets the created contact', async () => {
      const result = await service.getContact(contactId)

      expect(result).toHaveProperty('id', contactId)
      expect(result).toHaveProperty('name', 'E2E Test Contact')
    })

    it('lists contacts and finds the created one', async () => {
      const result = await service.listContacts(testEmail)

      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThanOrEqual(1)
      expect(result[0]).toHaveProperty('id', contactId)
    })

    it('updates the contact', async () => {
      const result = await service.updateContact(contactId, 'E2E Updated Contact')

      expect(result).toHaveProperty('id', contactId)
      expect(result).toHaveProperty('name', 'E2E Updated Contact')
    })

    it('searches for the contact', async () => {
      // Freshdesk search indexing may have a delay; search by email which is most reliable
      const result = await service.searchContacts(`email:'${ testEmail }'`)

      expect(result).toHaveProperty('total')
      expect(result).toHaveProperty('results')
      expect(Array.isArray(result.results)).toBe(true)
    })

    it('deletes the contact', async () => {
      const result = await service.deleteContact(contactId)

      expect(result).toEqual({ deleted: true, contactId })
    })
  })

  // ── Tickets lifecycle ──

  describe('ticket lifecycle', () => {
    let ticketId
    const testEmail = `e2e-ticket-${ Date.now() }@flowrunner-test.com`

    it('creates a ticket', async () => {
      const result = await service.createTicket(
        'E2E Test Ticket',
        '<p>This is an automated e2e test ticket.</p>',
        testEmail,
        undefined,
        'Low',
        'Open',
        'Portal'
      )

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('subject', 'E2E Test Ticket')
      expect(result).toHaveProperty('priority', 1)
      expect(result).toHaveProperty('status', 2)
      ticketId = result.id
    })

    it('gets the created ticket', async () => {
      const result = await service.getTicket(ticketId)

      expect(result).toHaveProperty('id', ticketId)
      expect(result).toHaveProperty('subject', 'E2E Test Ticket')
    })

    it('gets the ticket with conversations included', async () => {
      const result = await service.getTicket(ticketId, true)

      expect(result).toHaveProperty('id', ticketId)
      expect(result).toHaveProperty('conversations')
      expect(Array.isArray(result.conversations)).toBe(true)
    })

    it('lists tickets', async () => {
      const result = await service.listTickets(undefined, undefined, 1, 5)

      expect(Array.isArray(result)).toBe(true)
    })

    it('adds a note to the ticket', async () => {
      const result = await service.addNote(ticketId, '<p>E2E test note</p>', true)

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('private', true)
    })

    it('adds a public note to the ticket', async () => {
      const result = await service.addNote(ticketId, '<p>E2E public note</p>', false)

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('private', false)
    })

    it('lists ticket conversations', async () => {
      const result = await service.listTicketConversations(ticketId)

      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThanOrEqual(1)
    })

    it('updates the ticket', async () => {
      const result = await service.updateTicket(ticketId, undefined, undefined, 'Medium', 'Pending')

      expect(result).toHaveProperty('id', ticketId)
      expect(result).toHaveProperty('priority', 2)
      expect(result).toHaveProperty('status', 3)
    })

    it('searches for tickets', async () => {
      const result = await service.searchTickets('status:2 OR status:3')

      expect(result).toHaveProperty('total')
      expect(result).toHaveProperty('results')
      expect(Array.isArray(result.results)).toBe(true)
    })

    it('deletes the ticket', async () => {
      const result = await service.deleteTicket(ticketId)

      expect(result).toEqual({ deleted: true, ticketId })
    })
  })

  // ── Companies ──

  describe('company lifecycle', () => {
    let companyId
    const companyName = `E2E Test Company ${ Date.now() }`

    it('creates a company', async () => {
      const result = await service.createCompany(companyName, [], 'E2E test company')

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('name', companyName)
      companyId = result.id
    })

    it('gets the created company', async () => {
      const result = await service.getCompany(companyId)

      expect(result).toHaveProperty('id', companyId)
      expect(result).toHaveProperty('name', companyName)
    })

    it('lists companies', async () => {
      const result = await service.listCompanies()

      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThanOrEqual(1)
    })

    // Note: Freshdesk does not support company deletion via API v2,
    // so we leave the test company. It can be cleaned up manually.
  })
})
