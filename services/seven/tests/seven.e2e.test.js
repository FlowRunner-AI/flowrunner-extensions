'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('seven Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('seven')
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
    it('returns the account balance', async () => {
      const result = await service.getBalance()

      expect(result).toHaveProperty('amount')
      expect(result).toHaveProperty('currency')
    })
  })

  describe('getPricing', () => {
    it('returns pricing for a single country', async () => {
      const result = await service.getPricing('DE')

      expect(result).toHaveProperty('countries')
      expect(Array.isArray(result.countries)).toBe(true)
    })

    it('returns pricing for all countries when no country is given', async () => {
      const result = await service.getPricing()

      expect(result).toHaveProperty('countCountries')
    })
  })

  // ── Lookup ──

  describe('numberLookup', () => {
    it('performs a format lookup', async () => {
      const number = testValues.lookupNumber || testValues.mobile

      if (!number) {
        console.log('Skipping numberLookup: testValues.lookupNumber / testValues.mobile not set')

        return
      }

      const result = await service.numberLookup('Format', number)

      expect(result).toHaveProperty('international')
    })
  })

  // ── Contacts ──

  describe('listContacts', () => {
    it('returns the account contacts', async () => {
      const result = await service.listContacts()

      expect(Array.isArray(result) || typeof result === 'object').toBe(true)
    })
  })

  describe('createContact', () => {
    it('creates a contact', async () => {
      if (!testValues.createContacts) {
        console.log('Skipping createContact: testValues.createContacts not enabled')

        return
      }

      const result = await service.createContact(
        `E2E Contact ${ Date.now() }`,
        testValues.mobile,
        testValues.email
      )

      expect(result).toBeDefined()
    })
  })

  // ── Messaging ──

  describe('sendSms + getSmsStatus', () => {
    let messageId

    it('sends an SMS', async () => {
      if (!testValues.mobile) {
        console.log('Skipping sendSms: testValues.mobile not set')

        return
      }

      const result = await service.sendSms(testValues.mobile, 'FlowRunner e2e test message', testValues.from)

      expect(String(result.success)).toBe('100')

      messageId = result.messages && result.messages[0] && result.messages[0].id
    })

    it('reads the delivery status of the sent SMS', async () => {
      if (!messageId) {
        console.log('Skipping getSmsStatus: no message id from sendSms')

        return
      }

      const result = await service.getSmsStatus(messageId)

      expect(result).toBeDefined()
    })
  })

  describe('sendVoiceCall', () => {
    it('places a voice call', async () => {
      if (!testValues.voiceNumber) {
        console.log('Skipping sendVoiceCall: testValues.voiceNumber not set')

        return
      }

      const result = await service.sendVoiceCall(testValues.voiceNumber, 'This is a FlowRunner test call.')

      expect(String(result.success)).toBe('100')
    })
  })
})
