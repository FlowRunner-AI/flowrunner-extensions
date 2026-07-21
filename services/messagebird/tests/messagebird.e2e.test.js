'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('MessageBird Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('messagebird')
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

  // ── Account ──

  describe('getBalance', () => {
    it('returns balance with expected shape', async () => {
      const result = await service.getBalance()

      expect(result).toHaveProperty('payment')
      expect(result).toHaveProperty('type')
      expect(result).toHaveProperty('amount')
      expect(typeof result.amount).toBe('number')
    })
  })

  // ── Messaging ──

  describe('listMessages', () => {
    it('returns a paginated list of messages', async () => {
      const result = await service.listMessages(5, 0)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('totalCount')
    })
  })

  describe('sendSms + getMessage', () => {
    let messageId

    it('sends an SMS message', async () => {
      const recipient = testValues.testPhoneNumber
      if (!recipient) {
        console.log('Skipping sendSms: testValues.testPhoneNumber is not set')
        return
      }

      const result = await service.sendSms(
        'FlowTest',
        [recipient],
        'E2E test message from FlowRunner - please ignore',
        'Text',
        `e2e-${Date.now()}`
      )

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('recipients')
      messageId = result.id
    })

    it('retrieves the sent message by ID', async () => {
      if (!messageId) {
        console.log('Skipping getMessage: no messageId from previous test')
        return
      }

      const result = await service.getMessage(messageId)

      expect(result).toHaveProperty('id', messageId)
      expect(result).toHaveProperty('body')
      expect(result).toHaveProperty('recipients')
    })
  })

  // ── Lookup ──

  describe('phoneNumberLookup', () => {
    it('returns phone number metadata', async () => {
      const phoneNumber = testValues.testPhoneNumber
      if (!phoneNumber) {
        console.log('Skipping phoneNumberLookup: testValues.testPhoneNumber is not set')
        return
      }

      const result = await service.phoneNumberLookup(phoneNumber)

      expect(result).toHaveProperty('type')
      expect(result).toHaveProperty('countryCode')
      expect(result).toHaveProperty('formats')
    })
  })

  // ── Contacts ──

  describe('contact lifecycle (create, get, update, list, delete)', () => {
    let contactId

    it('creates a contact', async () => {
      const msisdn = testValues.testPhoneNumber
      if (!msisdn) {
        console.log('Skipping createContact: testValues.testPhoneNumber is not set')
        return
      }

      const result = await service.createContact(
        msisdn, 'E2ETest', 'FlowRunner', `e2e-${Date.now()}`
      )

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('msisdn')
      contactId = result.id
    })

    it('retrieves the created contact', async () => {
      if (!contactId) {
        console.log('Skipping getContact: no contactId from previous test')
        return
      }

      const result = await service.getContact(contactId)

      expect(result).toHaveProperty('id', contactId)
      expect(result).toHaveProperty('firstName', 'E2ETest')
    })

    it('updates the contact', async () => {
      if (!contactId) {
        console.log('Skipping updateContact: no contactId from previous test')
        return
      }

      const result = await service.updateContact(
        contactId, undefined, 'UpdatedName'
      )

      expect(result).toHaveProperty('id', contactId)
    })

    it('lists contacts', async () => {
      const result = await service.listContacts(5, 0)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('totalCount')
    })

    it('deletes the created contact', async () => {
      if (!contactId) {
        console.log('Skipping deleteContact: no contactId from previous test')
        return
      }

      const result = await service.deleteContact(contactId)

      expect(result).toEqual({ success: true })
    })
  })

  // ── Groups ──

  describe('listGroups', () => {
    it('returns a paginated list of groups', async () => {
      const result = await service.listGroups(5, 0)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('totalCount')
    })
  })

  // ── Dictionary ──

  describe('getGroupsDictionary', () => {
    it('returns dictionary items with expected shape', async () => {
      const result = await service.getGroupsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
        expect(result.items[0]).toHaveProperty('note')
      }
    })
  })
})
