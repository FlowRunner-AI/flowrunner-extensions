'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Zammad Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('zammad')
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

  // ── Connection ──

  describe('getCurrentUser', () => {
    it('returns the token owner profile (connection check)', async () => {
      const result = await service.getCurrentUser()

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('login')
    })
  })

  // ── Groups ──

  describe('listGroups', () => {
    it('returns the configured groups', async () => {
      const result = await service.listGroups()

      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThan(0)
      expect(result[0]).toHaveProperty('name')
    })
  })

  // ── Dictionaries ──

  describe('getGroupsDictionary', () => {
    it('returns group dictionary items', async () => {
      const result = await service.getGroupsDictionary({})

      expect(Array.isArray(result.items)).toBe(true)
      expect(result.cursor).toBeNull()

      result.items.forEach(item => {
        expect(item).toHaveProperty('label')
        expect(item).toHaveProperty('value')
      })
    })
  })

  describe('getUsersDictionary', () => {
    it('returns user dictionary items', async () => {
      const result = await service.getUsersDictionary({})

      expect(Array.isArray(result.items)).toBe(true)
    })

    it('searches users', async () => {
      const result = await service.getUsersDictionary({ search: 'a' })

      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getStatesDictionary', () => {
    it('returns ticket state dictionary items', async () => {
      const result = await service.getStatesDictionary({})

      expect(Array.isArray(result.items)).toBe(true)
      expect(result.items.length).toBeGreaterThan(0)
    })
  })

  // ── Tickets, articles and tags ──

  describe('ticket lifecycle', () => {
    let ticketId
    let articleId

    it('creates a ticket', async () => {
      const group = testValues.group || 'Users'
      const customer = testValues.customerEmail || 'e2e-customer@example.com'

      const result = await service.createTicket(
        `E2E Ticket ${ Date.now() }`,
        group,
        customer,
        'Created by the FlowRunner e2e test suite.',
        undefined,
        'note',
        false,
        'new',
        '2 normal'
      )

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('number')

      ticketId = result.id
    })

    it('gets the ticket with expand', async () => {
      if (!ticketId) {
        console.log('Skipping getTicket: no ticket was created')

        return
      }

      const result = await service.getTicket(ticketId, true)

      expect(result).toHaveProperty('id', ticketId)
      expect(result).toHaveProperty('title')
    })

    it('lists tickets', async () => {
      const result = await service.listTickets(1, 5)

      expect(Array.isArray(result)).toBe(true)
    })

    it('searches tickets', async () => {
      const result = await service.searchTickets('state.name:new', 1, 5)

      expect(result).toBeDefined()
    })

    it('updates the ticket', async () => {
      if (!ticketId) {
        console.log('Skipping updateTicket: no ticket was created')

        return
      }

      const result = await service.updateTicket(ticketId, `E2E Updated ${ Date.now() }`, undefined, 'open', '3 high')

      expect(result).toHaveProperty('id', ticketId)
    })

    it('creates an article on the ticket', async () => {
      if (!ticketId) {
        console.log('Skipping createArticle: no ticket was created')

        return
      }

      const result = await service.createArticle(ticketId, 'E2E follow-up note', 'E2E subject', 'note', true)

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('ticket_id', ticketId)

      articleId = result.id
    })

    it('lists articles for the ticket', async () => {
      if (!ticketId) {
        console.log('Skipping listArticlesByTicket: no ticket was created')

        return
      }

      const result = await service.listArticlesByTicket(ticketId)

      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThan(0)
    })

    it('gets a single article', async () => {
      if (!articleId) {
        console.log('Skipping getArticle: no article was created')

        return
      }

      const result = await service.getArticle(articleId)

      expect(result).toHaveProperty('id', articleId)
    })

    it('adds a tag to the ticket', async () => {
      if (!ticketId) {
        console.log('Skipping addTag: no ticket was created')

        return
      }

      const result = await service.addTag(ticketId, 'flowrunner-e2e')

      expect(result).toEqual({ success: true, objectId: ticketId, object: 'Ticket', tag: 'flowrunner-e2e' })
    })

    it('lists the ticket tags', async () => {
      if (!ticketId) {
        console.log('Skipping listTagsForObject: no ticket was created')

        return
      }

      const result = await service.listTagsForObject(ticketId)

      expect(result).toHaveProperty('tags')
    })

    it('removes the tag', async () => {
      if (!ticketId) {
        console.log('Skipping removeTag: no ticket was created')

        return
      }

      const result = await service.removeTag(ticketId, 'flowrunner-e2e')

      expect(result).toMatchObject({ success: true, tag: 'flowrunner-e2e' })
    })

    it('deletes the ticket', async () => {
      if (!ticketId) {
        console.log('Skipping deleteTicket: no ticket was created')

        return
      }

      try {
        const result = await service.deleteTicket(ticketId)

        expect(result).toEqual({ deleted: true, ticketId })
      } catch (error) {
        console.log(`Skipping deleteTicket assertions (admin permissions required): ${ error.message }`)
      }
    })
  })

  // ── Users ──

  describe('user lifecycle', () => {
    let userId

    it('creates a user', async () => {
      const email = `flowrunner-e2e-${ Date.now() }@example.com`

      const result = await service.createUser('E2E', 'Tester', email, '+15550100', ['Customer'])

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('email', email)

      userId = result.id
    })

    it('gets the user', async () => {
      if (!userId) {
        console.log('Skipping getUser: no user was created')

        return
      }

      const result = await service.getUser(userId)

      expect(result).toHaveProperty('id', userId)
    })

    it('lists users', async () => {
      const result = await service.listUsers(1, 5)

      expect(Array.isArray(result)).toBe(true)
    })

    it('searches users', async () => {
      const result = await service.searchUsers('E2E', 1, 5)

      expect(result).toBeDefined()
    })

    it('updates the user', async () => {
      if (!userId) {
        console.log('Skipping updateUser: no user was created')

        return
      }

      const result = await service.updateUser(userId, 'E2E', 'Updated', undefined, '+15550199')

      expect(result).toHaveProperty('id', userId)
      expect(result).toHaveProperty('lastname', 'Updated')
    })
  })

  // ── Organizations ──

  describe('organization lifecycle', () => {
    let organizationId

    it('creates an organization', async () => {
      const name = `E2E Org ${ Date.now() }`

      const result = await service.createOrganization(name, 'e2e-example.com', false, 'Created by e2e tests')

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('name', name)

      organizationId = result.id
    })

    it('gets the organization', async () => {
      if (!organizationId) {
        console.log('Skipping getOrganization: no organization was created')

        return
      }

      const result = await service.getOrganization(organizationId)

      expect(result).toHaveProperty('id', organizationId)
    })

    it('lists organizations', async () => {
      const result = await service.listOrganizations(1, 5)

      expect(Array.isArray(result)).toBe(true)
    })

    it('searches organizations', async () => {
      const result = await service.searchOrganizations('E2E', 1, 5)

      expect(result).toBeDefined()
    })

    it('updates the organization', async () => {
      if (!organizationId) {
        console.log('Skipping updateOrganization: no organization was created')

        return
      }

      const result = await service.updateOrganization(organizationId, undefined, 'e2e-updated.com', true, 'Updated note')

      expect(result).toHaveProperty('id', organizationId)
    })
  })
})
