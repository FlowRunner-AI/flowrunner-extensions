'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Front Service (e2e)', () => {
  let sandbox
  let service

  beforeAll(() => {
    sandbox = createE2ESandbox('front-service')
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

  // ── Dictionaries ──

  describe('getInboxesDictionary', () => {
    it('returns items array with expected shape', async () => {
      const result = await service.getInboxesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor')

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
        expect(result.items[0]).toHaveProperty('note')
      }
    })
  })

  describe('getChannelsDictionary', () => {
    it('returns items array with expected shape', async () => {
      const result = await service.getChannelsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getTeammatesDictionary', () => {
    it('returns items array with expected shape', async () => {
      const result = await service.getTeammatesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
        expect(result.items[0]).toHaveProperty('note')
      }
    })
  })

  describe('getTagsDictionary', () => {
    it('returns items array with expected shape', async () => {
      const result = await service.getTagsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Conversations ──

  describe('listConversations', () => {
    it('returns paginated conversation list', async () => {
      const result = await service.listConversations(undefined, undefined, undefined, undefined, undefined, 5)

      expect(result).toHaveProperty('_results')
      expect(Array.isArray(result._results)).toBe(true)
      expect(result).toHaveProperty('_pagination')
    })

    it('filters by status', async () => {
      const result = await service.listConversations(undefined, 'open', undefined, undefined, undefined, 5)

      expect(result).toHaveProperty('_results')
      expect(Array.isArray(result._results)).toBe(true)
    })
  })

  describe('searchConversations', () => {
    it('searches conversations with a query', async () => {
      const result = await service.searchConversations('is:open', 5)

      expect(result).toHaveProperty('_results')
      expect(Array.isArray(result._results)).toBe(true)
      expect(result).toHaveProperty('_pagination')
    })
  })

  describe('getConversation', () => {
    it('retrieves a specific conversation', async () => {
      // First list conversations to get a valid ID
      const list = await service.listConversations(undefined, undefined, undefined, undefined, undefined, 1)

      if (list._results.length === 0) {
        console.log('No conversations found, skipping getConversation test')

        return
      }

      const convId = list._results[0].id
      const result = await service.getConversation(convId)

      expect(result).toHaveProperty('id', convId)
      expect(result).toHaveProperty('subject')
      expect(result).toHaveProperty('status')
    })
  })

  describe('listConversationMessages', () => {
    it('retrieves messages for a conversation', async () => {
      const list = await service.listConversations(undefined, undefined, undefined, undefined, undefined, 1)

      if (list._results.length === 0) {
        console.log('No conversations found, skipping listConversationMessages test')

        return
      }

      const convId = list._results[0].id
      const result = await service.listConversationMessages(convId, 5)

      expect(result).toHaveProperty('_results')
      expect(Array.isArray(result._results)).toBe(true)
      expect(result).toHaveProperty('_pagination')
    })
  })

  // ── Contacts ──

  describe('contact lifecycle', () => {
    let createdContactId

    it('creates a contact', async () => {
      const uniqueEmail = `e2e-test-${Date.now()}@flowrunner-test.com`
      const result = await service.createContact(
        'E2E Test Contact',
        `email:${uniqueEmail}`,
        'Created by e2e test'
      )

      expect(result).toHaveProperty('id')
      createdContactId = result.id
    })

    it('retrieves the created contact', async () => {
      if (!createdContactId) {
        console.log('No contact created, skipping')

        return
      }

      const result = await service.getContact(createdContactId)

      expect(result).toHaveProperty('id', createdContactId)
      expect(result).toHaveProperty('name', 'E2E Test Contact')
    })

    it('updates the contact', async () => {
      if (!createdContactId) {
        console.log('No contact created, skipping')

        return
      }

      const result = await service.updateContact(createdContactId, 'E2E Updated Contact', 'Updated description')

      expect(result).toEqual({ success: true, contactId: createdContactId })
    })
  })

  describe('listContacts', () => {
    it('returns paginated contact list', async () => {
      const result = await service.listContacts(undefined, 5)

      expect(result).toHaveProperty('_results')
      expect(Array.isArray(result._results)).toBe(true)
      expect(result).toHaveProperty('_pagination')
    })
  })

  // ── Accounts ──

  describe('account lifecycle', () => {
    let createdAccountId

    it('creates an account', async () => {
      const result = await service.createAccount(
        `E2E Test Account ${Date.now()}`,
        undefined,
        'Created by e2e test'
      )

      expect(result).toHaveProperty('id')
      createdAccountId = result.id
    })

    it('retrieves the created account', async () => {
      if (!createdAccountId) {
        console.log('No account created, skipping')

        return
      }

      const result = await service.getAccount(createdAccountId)

      expect(result).toHaveProperty('id', createdAccountId)
      expect(result).toHaveProperty('name')
    })

    it('updates the account', async () => {
      if (!createdAccountId) {
        console.log('No account created, skipping')

        return
      }

      const result = await service.updateAccount(createdAccountId, 'E2E Updated Account', undefined, 'Updated desc')

      expect(result).toEqual({ success: true, accountId: createdAccountId })
    })
  })

  describe('listAccounts', () => {
    it('returns paginated account list', async () => {
      const result = await service.listAccounts(undefined, 5)

      expect(result).toHaveProperty('_results')
      expect(Array.isArray(result._results)).toBe(true)
      expect(result).toHaveProperty('_pagination')
    })
  })

  // ── Comments ──

  describe('listComments', () => {
    it('retrieves comments for a conversation', async () => {
      const list = await service.listConversations(undefined, undefined, undefined, undefined, undefined, 1)

      if (list._results.length === 0) {
        console.log('No conversations found, skipping listComments test')

        return
      }

      const convId = list._results[0].id
      const result = await service.listComments(convId, 5)

      expect(result).toHaveProperty('_results')
      expect(Array.isArray(result._results)).toBe(true)
      expect(result).toHaveProperty('_pagination')
    })
  })

  describe('addComment', () => {
    it('adds a comment to a conversation', async () => {
      const list = await service.listConversations(undefined, undefined, undefined, undefined, undefined, 1)

      if (list._results.length === 0) {
        console.log('No conversations found, skipping addComment test')

        return
      }

      const convId = list._results[0].id
      const result = await service.addComment(convId, `E2E test comment ${Date.now()}`)

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('body')
    })
  })

  // ── Triggers ──

  describe('onNewConversation (learning mode)', () => {
    it('returns events and null state', async () => {
      const invocation = {
        eventName: 'onNewConversation',
        triggerData: {},
        learningMode: true,
      }

      const result = await service.handleTriggerPollingForEvent(invocation)

      expect(result).toHaveProperty('events')
      expect(Array.isArray(result.events)).toBe(true)
      expect(result.state).toBeNull()
    })
  })

  describe('onNewInboundMessage (learning mode)', () => {
    it('returns events and null state', async () => {
      const invocation = {
        eventName: 'onNewInboundMessage',
        triggerData: {},
        learningMode: true,
      }

      const result = await service.handleTriggerPollingForEvent(invocation)

      expect(result).toHaveProperty('events')
      expect(Array.isArray(result.events)).toBe(true)
      expect(result.state).toBeNull()
    })
  })

  describe('onNewComment (learning mode)', () => {
    it('returns events and null state', async () => {
      const invocation = {
        eventName: 'onNewComment',
        triggerData: {},
        learningMode: true,
      }

      const result = await service.handleTriggerPollingForEvent(invocation)

      expect(result).toHaveProperty('events')
      expect(Array.isArray(result.events)).toBe(true)
      expect(result.state).toBeNull()
    })
  })
})
