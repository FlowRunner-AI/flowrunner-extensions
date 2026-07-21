'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Drift Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('drift')
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

  // A unique-ish suffix so repeated e2e runs don't collide.
  const suffix = Date.now()

  // ── Users (agents) ──

  describe('listUsers', () => {
    it('returns users with expected shape', async () => {
      const response = await service.listUsers()

      expect(response).toHaveProperty('data')
      expect(Array.isArray(response.data)).toBe(true)
    })
  })

  describe('getUsersDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getUsersDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getUser', () => {
    // Uses the first user returned by listUsers, or testValues.userId if supplied.
    it('returns a single user with expected shape', async () => {
      let userId = testValues.userId

      if (!userId) {
        const list = await service.listUsers()
        userId = Array.isArray(list.data) && list.data.length ? list.data[0].id : undefined
      }

      if (!userId) {
        console.log('Skipping getUser: no users on the account and testValues.userId not set')
        return
      }

      const response = await service.getUser(userId)

      expect(response).toHaveProperty('data')
    })
  })

  // ── Contacts ──

  describe('createContact + getContact + getContactByEmail + updateContact + deleteContact', () => {
    let contactId
    let email

    it('creates a contact', async () => {
      email = `e2e-contact-${ suffix }@example.com`

      const response = await service.createContact(email, 'E2E Tester', '+15550001111')

      expect(response).toHaveProperty('data')
      expect(response.data).toHaveProperty('id')
      contactId = response.data.id
    })

    it('retrieves the created contact by id', async () => {
      const response = await service.getContact(contactId)

      expect(response).toHaveProperty('data')
    })

    it('looks up the contact by email', async () => {
      const response = await service.getContactByEmail(email)

      expect(response).toHaveProperty('data')
    })

    it('updates the contact', async () => {
      const response = await service.updateContact(contactId, undefined, 'E2E Updated')

      expect(response).toHaveProperty('data')
    })

    it('deletes the contact', async () => {
      const response = await service.deleteContact(contactId)

      expect(response).toEqual({ deleted: true, id: String(contactId) })
    })
  })

  describe('listContacts', () => {
    it('returns contacts with expected shape', async () => {
      const response = await service.listContacts()

      expect(response).toHaveProperty('data')
    })
  })

  // ── Conversations ──

  describe('listConversations', () => {
    it('returns conversations with expected shape', async () => {
      const response = await service.listConversations(undefined, 5)

      expect(response).toHaveProperty('data')
    })

    it('accepts a status filter', async () => {
      const response = await service.listConversations('Open', 5)

      expect(response).toHaveProperty('data')
    })
  })

  describe('getConversation + getConversationMessages', () => {
    // Uses testValues.conversationId if provided, otherwise the first open
    // conversation returned by listConversations.
    async function resolveConversationId() {
      if (testValues.conversationId) return testValues.conversationId

      const list = await service.listConversations(undefined, 1)
      const conversations = list?.data?.conversations

      return Array.isArray(conversations) && conversations.length ? conversations[0].id : undefined
    }

    it('retrieves a single conversation', async () => {
      const conversationId = await resolveConversationId()

      if (!conversationId) {
        console.log('Skipping getConversation: no conversations found and testValues.conversationId not set')
        return
      }

      const response = await service.getConversation(conversationId)

      expect(response).toHaveProperty('data')
    })

    it('retrieves conversation messages', async () => {
      const conversationId = await resolveConversationId()

      if (!conversationId) {
        console.log(
          'Skipping getConversationMessages: no conversations found and testValues.conversationId not set'
        )
        return
      }

      const response = await service.getConversationMessages(conversationId)

      expect(response).toHaveProperty('data')
    })
  })

  describe('createConversation + sendMessage + updateConversationStatus', () => {
    // Starting a real conversation posts a visible chat message, so this only
    // runs when the developer opts in via testValues.contactEmail.
    const canStart = () => Boolean(testValues.contactEmail)
    let conversationId

    it('creates a conversation when a contact email is configured', async () => {
      if (!canStart()) {
        console.log('Skipping createConversation: set testValues.contactEmail to enable live conversation tests')
        return
      }

      const response = await service.createConversation(
        testValues.contactEmail,
        `E2E test conversation ${ suffix }`
      )

      expect(response).toHaveProperty('data')

      const data = response.data || {}
      conversationId = data.conversationId || data.id
    })

    it('sends a message into the created conversation', async () => {
      if (!canStart() || !conversationId) {
        console.log('Skipping sendMessage: no conversation was created')
        return
      }

      const response = await service.sendMessage(
        conversationId,
        `E2E follow-up message ${ suffix }`,
        'Private Note'
      )

      expect(response).toHaveProperty('data')
    })

    it('closes the created conversation', async () => {
      if (!canStart() || !conversationId) {
        console.log('Skipping updateConversationStatus: no conversation was created')
        return
      }

      const response = await service.updateConversationStatus(conversationId, 'Closed')

      expect(response).toHaveProperty('data')
    })
  })

  // ── Accounts ──

  describe('listAccounts', () => {
    it('returns accounts with expected shape', async () => {
      const response = await service.listAccounts()

      expect(response).toHaveProperty('data')
    })
  })

  describe('createOrUpdateAccount + getAccount', () => {
    // Account IDs are developer-supplied; use a unique one per run.
    const accountId = `e2e-acct-${ suffix }`

    it('creates an account', async () => {
      const response = await service.createOrUpdateAccount(
        `E2E Account ${ suffix }`,
        accountId,
        'e2e-example.com',
        undefined,
        { source: 'flowrunner-e2e' }
      )

      expect(response).toHaveProperty('data')
    })

    it('retrieves the created account', async () => {
      const response = await service.getAccount(accountId)

      expect(response).toHaveProperty('data')
    })
  })
})
