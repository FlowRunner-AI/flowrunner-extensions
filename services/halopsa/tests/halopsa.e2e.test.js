'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('HaloPSA Service (e2e)', () => {
  let sandbox
  let service

  beforeAll(() => {
    sandbox = createE2ESandbox('halopsa')
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

  // ── Agents ──

  describe('getAgents', () => {
    it('returns agents with expected shape', async () => {
      const result = await service.getAgents()

      expect(result).toHaveProperty('items')
      expect(result).toHaveProperty('count')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Clients ──

  describe('getClients', () => {
    it('returns clients with expected shape', async () => {
      const result = await service.getClients()

      expect(result).toHaveProperty('items')
      expect(result).toHaveProperty('count')
      expect(Array.isArray(result.items)).toBe(true)
    })

    it('supports search filter', async () => {
      const result = await service.getClients('test')

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Client CRUD ──

  describe('client create + get + update', () => {
    const testClientName = `E2E Test Client ${Date.now()}`
    let createdClient

    it('creates a client', async () => {
      const result = await service.createClient(testClientName, 'https://e2e-test.example.com', 'e2e@test.com')

      expect(result).toBeDefined()
      // Halo POST returns the created record (may be array or single object)
      createdClient = Array.isArray(result) ? result[0] : result
      expect(createdClient).toHaveProperty('id')
    })

    it('retrieves the created client', async () => {
      const result = await service.getClient(createdClient.id)

      expect(result).toHaveProperty('id', createdClient.id)
    })

    it('updates the created client', async () => {
      const result = await service.updateClient(createdClient.id, `${testClientName} Updated`)

      expect(result).toBeDefined()
    })
  })

  // ── Tickets CRUD ──

  describe('ticket create + get + update + delete', () => {
    let createdTicket
    let clientId

    it('gets a client id for ticket creation', async () => {
      const clients = await service.getClients()

      expect(clients.items.length).toBeGreaterThan(0)
      clientId = clients.items[0].id
    })

    it('creates a ticket', async () => {
      const result = await service.createTicket(
        'E2E Test Ticket',
        'This ticket was created by an automated e2e test and should be deleted.',
        clientId
      )

      expect(result).toBeDefined()
      createdTicket = Array.isArray(result) ? result[0] : result
      expect(createdTicket).toHaveProperty('id')
    })

    it('retrieves the created ticket', async () => {
      const result = await service.getTicket(createdTicket.id)

      expect(result).toHaveProperty('id', createdTicket.id)
    })

    it('lists tickets', async () => {
      const result = await service.getTickets()

      expect(result).toHaveProperty('items')
      expect(result).toHaveProperty('count')
    })

    it('lists tickets with pagination', async () => {
      const result = await service.getTickets(undefined, undefined, false, 1, 5)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })

    it('updates the created ticket', async () => {
      const result = await service.updateTicket(createdTicket.id, 'E2E Test Ticket (updated)')

      expect(result).toBeDefined()
    })

    it('deletes the created ticket', async () => {
      const result = await service.deleteTicket(createdTicket.id)

      expect(result).toEqual({ ticketId: createdTicket.id, deleted: true })
    })
  })

  // ── Actions ──

  describe('actions on a ticket', () => {
    let ticketId
    let clientId

    beforeAll(async () => {
      const clients = await service.getClients()

      clientId = clients.items[0].id

      const result = await service.createTicket(
        'E2E Actions Test Ticket',
        'Ticket for testing actions.',
        clientId
      )

      const ticket = Array.isArray(result) ? result[0] : result

      ticketId = ticket.id
    })

    afterAll(async () => {
      if (ticketId) {
        await service.deleteTicket(ticketId)
      }
    })

    it('creates an action on the ticket', async () => {
      const result = await service.createAction(ticketId, 'E2E test note', 'Note', false)

      expect(result).toBeDefined()
    })

    it('creates a private action on the ticket', async () => {
      const result = await service.createAction(ticketId, 'E2E private note', 'Note', true)

      expect(result).toBeDefined()
    })

    it('lists actions for the ticket', async () => {
      const result = await service.getActions(ticketId)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result.items.length).toBeGreaterThan(0)
    })
  })

  // ── Sites ──

  describe('getSites', () => {
    it('returns sites with expected shape', async () => {
      const result = await service.getSites()

      expect(result).toHaveProperty('items')
      expect(result).toHaveProperty('count')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Users ──

  describe('getUsers', () => {
    it('returns users with expected shape', async () => {
      const result = await service.getUsers()

      expect(result).toHaveProperty('items')
      expect(result).toHaveProperty('count')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Assets ──

  describe('getAssets', () => {
    it('returns assets with expected shape', async () => {
      const result = await service.getAssets()

      expect(result).toHaveProperty('items')
      expect(result).toHaveProperty('count')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Invoices ──

  describe('getInvoices', () => {
    it('returns invoices with expected shape', async () => {
      const result = await service.getInvoices()

      expect(result).toHaveProperty('items')
      expect(result).toHaveProperty('count')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Dictionaries ──

  describe('getClientsDictionary', () => {
    it('returns dictionary items with label and value', async () => {
      const result = await service.getClientsDictionary()

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
      }
    })

    it('supports search filter', async () => {
      const result = await service.getClientsDictionary({ search: 'test' })

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getAgentsDictionary', () => {
    it('returns dictionary items with label and value', async () => {
      const result = await service.getAgentsDictionary()

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
      }
    })
  })
})
