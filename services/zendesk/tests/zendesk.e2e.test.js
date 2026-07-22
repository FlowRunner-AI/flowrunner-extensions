'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

const SUFFIX = Date.now()

describe('Zendesk Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('zendesk')
    require('../src/index.js')

    try {
      sandbox.validateConfigs()
    } catch (error) {
      console.log(error)
      process.exit(1)
    }

    service = sandbox.getService()
    testValues = sandbox.getTestValues()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Tickets ──

  describe('ticket lifecycle', () => {
    let ticketId

    it('creates a ticket', async () => {
      const result = await service.createTicket(
        `FlowRunner e2e ticket ${ SUFFIX }`,
        'Created by the FlowRunner e2e test suite.',
        undefined,
        false,
        'Low',
        'Task',
        'Open',
        undefined,
        undefined,
        undefined,
        undefined,
        ['flowrunner-e2e']
      )

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('subject', `FlowRunner e2e ticket ${ SUFFIX }`)

      ticketId = result.id
    })

    it('retrieves the ticket', async () => {
      const result = await service.getTicket(ticketId)

      expect(result).toHaveProperty('id', ticketId)
      expect(result).toHaveProperty('status')
    })

    it('updates the ticket', async () => {
      const result = await service.updateTicket(ticketId, `FlowRunner e2e ticket ${ SUFFIX } (updated)`, 'Pending', 'Normal')

      expect(result).toHaveProperty('id', ticketId)
      expect(result).toHaveProperty('status', 'pending')
    })

    it('adds a private comment to the ticket', async () => {
      const result = await service.addCommentToTicket(ticketId, 'Internal note from the e2e suite.', undefined, false, 'Solved')

      expect(result).toHaveProperty('id', ticketId)
    })

    it('lists the ticket comments', async () => {
      const result = await service.listTicketComments(ticketId, 100)

      expect(result).toHaveProperty('comments')
      expect(Array.isArray(result.comments)).toBe(true)
      expect(result.comments.length).toBeGreaterThan(0)
    })

    it('deletes the ticket', async () => {
      const result = await service.deleteTicket(ticketId)

      expect(result).toEqual({ deleted: true, ticketId: Number(ticketId) })
    })
  })

  describe('listTickets', () => {
    it('lists tickets with sorting and paging', async () => {
      const result = await service.listTickets('Created At', 'Descending', 5, 1)

      expect(result).toHaveProperty('tickets')
      expect(Array.isArray(result.tickets)).toBe(true)
    })
  })

  describe('searchTickets', () => {
    it('searches tickets', async () => {
      const result = await service.searchTickets('status:open', 'Created At', 'Descending', 5)

      expect(result).toHaveProperty('results')
      expect(Array.isArray(result.results)).toBe(true)
    })
  })

  // ── Users ──

  describe('users', () => {
    it('lists agents', async () => {
      const result = await service.listAgents(10)

      expect(result).toHaveProperty('users')
      expect(Array.isArray(result.users)).toBe(true)
    })

    it('searches users', async () => {
      const result = await service.searchUsers('role:agent', 5)

      expect(result).toHaveProperty('users')
      expect(Array.isArray(result.users)).toBe(true)
    })

    it('retrieves a user by id', async () => {
      const agents = await service.listAgents(1)

      if (!agents.users.length) {
        console.log('Skipping getUser: the account has no agents')

        return
      }

      const result = await service.getUser(agents.users[0].id)

      expect(result).toHaveProperty('id', agents.users[0].id)
    })

    it('creates and updates a user when a test email is configured', async () => {
      const { newUserEmail } = testValues

      if (!newUserEmail) {
        console.log('Skipping createUser/updateUser: testValues.newUserEmail not set')

        return
      }

      const created = await service.createUser(`FlowRunner E2E ${ SUFFIX }`, newUserEmail, 'End User')

      expect(created).toHaveProperty('id')

      const updated = await service.updateUser(created.id, `FlowRunner E2E ${ SUFFIX } (updated)`)

      expect(updated).toHaveProperty('id', created.id)
    })
  })

  // ── Organizations ──

  describe('organizations', () => {
    it('lists organizations', async () => {
      const result = await service.listOrganizations(5)

      expect(result).toHaveProperty('organizations')
      expect(Array.isArray(result.organizations)).toBe(true)
    })

    it('retrieves an organization by id', async () => {
      const organizations = await service.listOrganizations(1)

      if (!organizations.organizations.length) {
        console.log('Skipping getOrganization: the account has no organizations')

        return
      }

      const result = await service.getOrganization(organizations.organizations[0].id)

      expect(result).toHaveProperty('id', organizations.organizations[0].id)
    })

    it('creates an organization when explicitly enabled', async () => {
      const { createOrganization } = testValues

      if (!createOrganization) {
        console.log('Skipping createOrganization: testValues.createOrganization not set to true')

        return
      }

      const result = await service.createOrganization(
        `FlowRunner E2E ${ SUFFIX }`,
        [`e2e-${ SUFFIX }.example.com`],
        'Created by the FlowRunner e2e suite.',
        'Safe to delete.',
        ['flowrunner-e2e']
      )

      expect(result).toHaveProperty('id')
    })
  })

  // ── Dictionaries ──

  describe('dictionaries', () => {
    it('returns agents as dictionary items', async () => {
      const result = await service.getAgentsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)

      for (const item of result.items) {
        expect(item).toHaveProperty('label')
        expect(item).toHaveProperty('value')
      }
    })

    it('filters agents by search text', async () => {
      const result = await service.getAgentsDictionary({ search: 'zzz-no-match-zzz' })

      expect(result.items).toEqual([])
    })

    it('returns groups as dictionary items', async () => {
      const result = await service.getGroupsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Triggers ──

  describe('trigger provisioning', () => {
    it('creates and deletes a webhook + business-rule trigger pair', async () => {
      const invocation = {
        callbackUrl: 'https://example.com/flowrunner-e2e-callback',
        connectionId: `e2e-${ SUFFIX }`,
        events: [{ id: `e2e-event-${ SUFFIX }`, triggerData: { event: 'Ticket Created' } }],
      }

      const upserted = await service.handleTriggerUpsertWebhook(invocation)

      expect(upserted.webhookData.webhooks).toHaveLength(1)
      expect(upserted.webhookData.webhooks[0]).toHaveProperty('webhookId')
      expect(upserted.webhookData.webhooks[0]).toHaveProperty('zendeskTriggerId')

      const deleted = await service.handleTriggerDeleteWebhook({ webhookData: upserted.webhookData })

      expect(deleted).toEqual({ webhookData: {} })
    })
  })

  // ── Errors ──

  describe('error handling', () => {
    it('throws a descriptive error for an unknown ticket', async () => {
      await expect(service.getTicket(999999999)).rejects.toThrow(/Zendesk API error/)
    })
  })
})
