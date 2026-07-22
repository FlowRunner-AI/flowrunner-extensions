'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Twilio Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('twilio')
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

  describe('getAccountInfo', () => {
    it('returns account info with expected shape', async () => {
      const result = await service.getAccountInfo()

      expect(result).toHaveProperty('sid')
      expect(result).toHaveProperty('friendly_name')
      expect(result).toHaveProperty('status')
    })
  })

  // ── Phone Numbers ──

  describe('listPhoneNumbers', () => {
    it('returns phone numbers list', async () => {
      const result = await service.listPhoneNumbers(5)

      expect(result).toHaveProperty('incoming_phone_numbers')
      expect(Array.isArray(result.incoming_phone_numbers)).toBe(true)
    })
  })

  // ── Messaging ──

  describe('listMessages', () => {
    it('returns messages list with expected shape', async () => {
      const result = await service.listMessages(null, null, null, 5)

      expect(result).toHaveProperty('messages')
      expect(Array.isArray(result.messages)).toBe(true)
    })
  })

  describe('sendSms', () => {
    it('sends an SMS message', async () => {
      const { toPhoneNumber, fromPhoneNumber } = testValues

      if (!toPhoneNumber || !fromPhoneNumber) {
        console.log('Skipping sendSms: testValues.toPhoneNumber or testValues.fromPhoneNumber not set')
        return
      }

      const result = await service.sendSms(toPhoneNumber, fromPhoneNumber, 'FlowRunner e2e test message')

      expect(result).toHaveProperty('sid')
      expect(result).toHaveProperty('status')
      expect(result.sid).toMatch(/^SM/)
    })
  })

  describe('getMessage', () => {
    it('retrieves a message by SID', async () => {
      const { messageSid } = testValues

      if (!messageSid) {
        console.log('Skipping getMessage: testValues.messageSid not set')
        return
      }

      const result = await service.getMessage(messageSid)

      expect(result).toHaveProperty('sid', messageSid)
      expect(result).toHaveProperty('status')
    })
  })

  // ── Voice ──

  describe('listCalls', () => {
    it('returns calls list with expected shape', async () => {
      const result = await service.listCalls(null, null, null, 5)

      expect(result).toHaveProperty('calls')
      expect(Array.isArray(result.calls)).toBe(true)
    })
  })

  describe('getCall', () => {
    it('retrieves a call by SID', async () => {
      const { callSid } = testValues

      if (!callSid) {
        console.log('Skipping getCall: testValues.callSid not set')
        return
      }

      const result = await service.getCall(callSid)

      expect(result).toHaveProperty('sid', callSid)
      expect(result).toHaveProperty('status')
    })
  })

  // ── Dictionaries ──

  describe('getPhoneNumbersDictionary', () => {
    it('returns dictionary items with correct shape', async () => {
      const result = await service.getPhoneNumbersDictionary({})

      expect(result).toHaveProperty('items')
      expect(result).toHaveProperty('cursor')
      expect(Array.isArray(result.items)).toBe(true)

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
        expect(result.items[0]).toHaveProperty('note')
      }
    })

    it('handles null payload', async () => {
      const result = await service.getPhoneNumbersDictionary(null)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getMessagesDictionary', () => {
    it('returns dictionary items with correct shape', async () => {
      const result = await service.getMessagesDictionary({})

      expect(result).toHaveProperty('items')
      expect(result).toHaveProperty('cursor')
      expect(Array.isArray(result.items)).toBe(true)

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
        expect(result.items[0]).toHaveProperty('note')
      }
    })
  })

  describe('getCallsDictionary', () => {
    it('returns dictionary items with correct shape', async () => {
      const result = await service.getCallsDictionary({})

      expect(result).toHaveProperty('items')
      expect(result).toHaveProperty('cursor')
      expect(Array.isArray(result.items)).toBe(true)

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
        expect(result.items[0]).toHaveProperty('note')
      }
    })
  })

  describe('getConversationsDictionary', () => {
    it('returns dictionary items with correct shape', async () => {
      const result = await service.getConversationsDictionary({})

      expect(result).toHaveProperty('items')
      expect(result).toHaveProperty('cursor')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Conversations ──

  describe('startConversation + addConversationMessage + getConversationMessages + deleteConversationMessage', () => {
    let conversationSid
    let messageSid

    it('creates a conversation', async () => {
      const result = await service.startConversation(
        `E2E Test ${ Date.now() }`,
        `e2e-test-${ Date.now() }`
      )

      expect(result).toHaveProperty('conversation')
      expect(result.conversation).toHaveProperty('sid')
      expect(result).toHaveProperty('participants')
      conversationSid = result.conversation.sid
    })

    it('adds a message to the conversation', async () => {
      if (!conversationSid) {
        console.log('Skipping: conversation was not created')
        return
      }

      const result = await service.addConversationMessage(conversationSid, 'E2E test message', 'e2e-bot')

      expect(result).toHaveProperty('sid')
      expect(result).toHaveProperty('body', 'E2E test message')
      messageSid = result.sid
    })

    it('retrieves conversation messages', async () => {
      if (!conversationSid) {
        console.log('Skipping: conversation was not created')
        return
      }

      const result = await service.getConversationMessages(conversationSid, 'asc', 10)

      expect(result).toHaveProperty('messages')
      expect(Array.isArray(result.messages)).toBe(true)
    })

    it('deletes the conversation message', async () => {
      if (!conversationSid || !messageSid) {
        console.log('Skipping: conversation or message was not created')
        return
      }

      const result = await service.deleteConversationMessage(conversationSid, messageSid)

      expect(result).toEqual({ success: true, message: 'Message deleted successfully' })
    })
  })
})
