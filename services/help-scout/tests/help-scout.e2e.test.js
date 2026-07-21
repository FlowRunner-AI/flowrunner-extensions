'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Help Scout Service (e2e)', () => {
  let sandbox
  let service

  beforeAll(() => {
    sandbox = createE2ESandbox('help-scout')
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

  // ── Connection check ──

  describe('getMe', () => {
    it('returns current user profile', async () => {
      const result = await service.getMe()

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('email')
      expect(result).toHaveProperty('role')
    })
  })

  // ── Mailboxes ──

  describe('listMailboxes', () => {
    it('returns mailboxes with expected shape', async () => {
      const result = await service.listMailboxes()

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('page')

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('id')
        expect(result.items[0]).toHaveProperty('name')
      }
    })
  })

  describe('listMailboxFolders', () => {
    it('returns folders for the first mailbox', async () => {
      const mailboxes = await service.listMailboxes()

      if (!mailboxes.items.length) {
        console.log('No mailboxes found, skipping listMailboxFolders test')
        return
      }

      const mailboxId = String(mailboxes.items[0].id)
      const result = await service.listMailboxFolders(mailboxId)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Users ──

  describe('listUsers', () => {
    it('returns users with expected shape', async () => {
      const result = await service.listUsers()

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('id')
        expect(result.items[0]).toHaveProperty('email')
      }
    })
  })

  // ── Tags ──

  describe('listTags', () => {
    it('returns tags with expected shape', async () => {
      const result = await service.listTags()

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('page')
    })
  })

  // ── Dictionaries ──

  describe('getMailboxesDictionary', () => {
    it('returns dictionary items with label, value, note', async () => {
      const result = await service.getMailboxesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
        expect(result.items[0]).toHaveProperty('note')
      }
    })
  })

  describe('getUsersDictionary', () => {
    it('returns dictionary items with label, value, note', async () => {
      const result = await service.getUsersDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
        expect(result.items[0]).toHaveProperty('note')
      }
    })
  })

  // ── Customers ──

  describe('listCustomers', () => {
    it('returns customers with expected shape', async () => {
      const result = await service.listCustomers()

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('page')
    })
  })

  // ── Conversations ──

  describe('listConversations', () => {
    it('returns conversations with expected shape', async () => {
      const result = await service.listConversations()

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('page')
    })
  })

  // ── Full conversation lifecycle ──

  describe('conversation lifecycle (create, get, reply, note, tags, update, assign, delete)', () => {
    let conversationId
    let mailboxId
    let userId

    beforeAll(async () => {
      const mailboxes = await service.listMailboxes()

      if (!mailboxes.items.length) {
        throw new Error('No mailboxes found - cannot run lifecycle tests')
      }

      mailboxId = String(mailboxes.items[0].id)

      const users = await service.listUsers()

      if (users.items.length > 0) {
        userId = String(users.items[0].id)
      }
    })

    it('creates a conversation', async () => {
      const result = await service.createConversation(
        'E2E Test Conversation',
        mailboxId,
        'e2e-test@flowrunner-test.example.com',
        'This is an automated e2e test conversation.',
        'Customer',
        'Email',
        'Active',
      )

      expect(result).toHaveProperty('id')
      conversationId = result.id

      if (!conversationId) {
        throw new Error('Could not create conversation (no ID returned)')
      }
    })

    it('gets the created conversation', async () => {
      const result = await service.getConversation(conversationId, false)

      expect(result).toHaveProperty('id', conversationId)
      expect(result).toHaveProperty('subject', 'E2E Test Conversation')
    })

    it('gets conversation with threads', async () => {
      const result = await service.getConversation(conversationId, true)

      expect(result).toHaveProperty('id', conversationId)
      expect(result).toHaveProperty('_embedded')
    })

    it('adds a reply', async () => {
      const result = await service.addReply(
        conversationId,
        'This is an e2e test reply.',
        null,
        'e2e-test@flowrunner-test.example.com',
        null,
        true, // draft to avoid actually sending email
      )

      expect(result).toHaveProperty('conversationId', conversationId)
      expect(result).toHaveProperty('created', true)
    })

    it('adds a note', async () => {
      const result = await service.addNote(
        conversationId,
        'This is an e2e test internal note.',
      )

      expect(result).toHaveProperty('conversationId', conversationId)
      expect(result).toHaveProperty('created', true)
    })

    it('lists threads', async () => {
      const result = await service.listThreads(conversationId)

      expect(result).toHaveProperty('items')
      expect(result.items.length).toBeGreaterThanOrEqual(1)
    })

    it('adds tags', async () => {
      const result = await service.addTags(conversationId, ['e2e-test-tag'])

      expect(result).toHaveProperty('conversationId', conversationId)
      expect(result.tags).toContain('e2e-test-tag')
    })

    it('removes tags', async () => {
      const result = await service.removeTags(conversationId, ['e2e-test-tag'])

      expect(result).toHaveProperty('conversationId', conversationId)
      expect(result.tags).not.toContain('e2e-test-tag')
    })

    it('updates the conversation subject and status', async () => {
      const result = await service.updateConversation(
        conversationId,
        'E2E Test - Updated Subject',
        'Pending',
      )

      expect(result).toHaveProperty('conversationId', conversationId)
      expect(result.updatedFields).toContain('subject')
      expect(result.updatedFields).toContain('status')
    })

    it('assigns the conversation', async () => {
      if (!userId) {
        console.log('No users found, skipping assign test')
        return
      }

      const result = await service.assignConversation(conversationId, userId, false)

      expect(result).toHaveProperty('conversationId', conversationId)
      expect(result).toHaveProperty('assignedTo')
    })

    it('unassigns the conversation', async () => {
      const result = await service.assignConversation(conversationId, null, true)

      expect(result).toEqual({ conversationId, assignedTo: null })
    })

    it('deletes the conversation', async () => {
      const result = await service.deleteConversation(conversationId)

      expect(result).toEqual({ conversationId, deleted: true })
    })
  })

  // ── Customer lifecycle ──

  describe('customer lifecycle (create, get, update)', () => {
    let customerId

    it('creates a customer', async () => {
      const result = await service.createCustomer(
        'E2ETest',
        `e2e-test-${Date.now()}@flowrunner-test.example.com`,
        'AutoDelete',
        '555-0000',
        'E2E Test Org',
      )

      expect(result).toHaveProperty('id')
      customerId = result.id

      if (!customerId) {
        console.log('Customer created but no ID returned, skipping subsequent customer tests')
      }
    })

    it('gets the customer', async () => {
      if (!customerId) {
        return
      }

      const result = await service.getCustomer(customerId)

      expect(result).toHaveProperty('id', customerId)
      expect(result).toHaveProperty('firstName', 'E2ETest')
    })

    it('updates the customer', async () => {
      if (!customerId) {
        return
      }

      const result = await service.updateCustomer(
        customerId,
        null,
        null,
        'E2E Tester',
        'Updated Org',
      )

      expect(result).toHaveProperty('customerId', customerId)
      expect(result.updatedFields).toContain('jobTitle')
      expect(result.updatedFields).toContain('organization')
    })
  })
})
