'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Mocean Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('mocean')
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
    it('returns account balance with expected shape', async () => {
      const result = await service.getBalance()

      expect(result).toHaveProperty('balance')
      expect(Number(result.status)).toBe(0)
    })
  })

  describe('getPricing', () => {
    it('returns pricing list for all countries', async () => {
      const result = await service.getPricing()

      expect(Number(result.status)).toBe(0)
      expect(result).toHaveProperty('destinations')
    })

    it('returns pricing filtered by country code', async () => {
      const result = await service.getPricing('MY')

      expect(Number(result.status)).toBe(0)
      expect(result).toHaveProperty('destinations')
    })
  })

  // ── SMS (consumes credits) ──

  describe('sendSms', () => {
    it('sends an SMS when a recipient is configured', async () => {
      if (!testValues.smsRecipient) {
        console.log('Skipping sendSms: set testValues.smsRecipient and testValues.smsFrom in e2e-config.json')
        return
      }

      const result = await service.sendSms(
        testValues.smsFrom || 'FlowTest',
        testValues.smsRecipient,
        `E2E test SMS ${Date.now()}`
      )

      expect(result).toHaveProperty('messages')
      expect(Array.isArray(result.messages)).toBe(true)
      expect(result.messages.length).toBeGreaterThan(0)
      expect(Number(result.messages[0].status)).toBe(0)
    })
  })

  // ── Verify (consumes credits) ──

  describe('sendVerificationCode', () => {
    it('sends a verification code when a recipient is configured', async () => {
      if (!testValues.verifyRecipient) {
        console.log('Skipping sendVerificationCode: set testValues.verifyRecipient in e2e-config.json')
        return
      }

      const result = await service.sendVerificationCode(
        testValues.verifyRecipient,
        'E2ETest'
      )

      expect(result).toHaveProperty('reqid')
      expect(Number(result.status)).toBe(0)
    })
  })

  // ── Number Lookup (consumes credits) ──

  describe('numberLookup', () => {
    it('looks up a number when a target is configured', async () => {
      if (!testValues.lookupNumber) {
        console.log('Skipping numberLookup: set testValues.lookupNumber in e2e-config.json')
        return
      }

      const result = await service.numberLookup(testValues.lookupNumber)

      expect(Number(result.status)).toBe(0)
      expect(result).toHaveProperty('to')
      expect(result).toHaveProperty('current_carrier')
    })
  })
})
