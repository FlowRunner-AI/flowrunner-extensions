'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Vonage Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('vonage')
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

      expect(result).toHaveProperty('value')
      expect(typeof result.value).toBe('number')
      expect(result).toHaveProperty('autoReload')
    })
  })

  // ── Numbers ──

  describe('listOwnedNumbers', () => {
    it('returns owned numbers with expected shape', async () => {
      const result = await service.listOwnedNumbers(undefined, 5, 1)

      expect(result).toHaveProperty('count')
      expect(typeof result.count).toBe('number')
      expect(result).toHaveProperty('numbers')
      expect(Array.isArray(result.numbers)).toBe(true)
    })

    it('filters numbers by pattern', async () => {
      const { numberPattern } = testValues

      if (!numberPattern) {
        console.log('Skipping: testValues.numberPattern not set')
        return
      }

      const result = await service.listOwnedNumbers(numberPattern, 5, 1)

      expect(result).toHaveProperty('count')
      expect(result).toHaveProperty('numbers')
    })
  })

  // ── Number Insight ──

  describe('numberInsightBasic', () => {
    it('returns basic insight for a phone number', async () => {
      const { phoneNumber } = testValues

      if (!phoneNumber) {
        console.log('Skipping: testValues.phoneNumber not set')
        return
      }

      const result = await service.numberInsightBasic(phoneNumber)

      expect(result).toHaveProperty('status', 0)
      expect(result).toHaveProperty('international_format_number')
      expect(result).toHaveProperty('country_code')
      expect(result).toHaveProperty('country_name')
    })
  })

  describe('numberInsightStandard', () => {
    it('returns standard insight for a phone number', async () => {
      const { phoneNumber } = testValues

      if (!phoneNumber) {
        console.log('Skipping: testValues.phoneNumber not set')
        return
      }

      const result = await service.numberInsightStandard(phoneNumber)

      expect(result).toHaveProperty('status', 0)
      expect(result).toHaveProperty('international_format_number')
      expect(result).toHaveProperty('country_code')
      expect(result).toHaveProperty('current_carrier')
    })
  })

  // ── Messaging ──

  describe('sendSms', () => {
    it('sends an SMS message', async () => {
      const { fromNumber, toNumber } = testValues

      if (!fromNumber || !toNumber) {
        console.log('Skipping sendSms: testValues.fromNumber or testValues.toNumber not set')
        return
      }

      const result = await service.sendSms(fromNumber, toNumber, 'FlowRunner e2e test')

      expect(result).toHaveProperty('message-count')
      expect(result).toHaveProperty('messages')
      expect(Array.isArray(result.messages)).toBe(true)
      expect(result.messages[0]).toHaveProperty('status', '0')
    })
  })

  describe('sendMessage', () => {
    it('sends a multichannel SMS message', async () => {
      const { fromNumber, toNumber } = testValues

      if (!fromNumber || !toNumber) {
        console.log('Skipping sendMessage: testValues.fromNumber or testValues.toNumber not set')
        return
      }

      const result = await service.sendMessage('SMS', toNumber, fromNumber, 'FlowRunner e2e test')

      expect(result).toHaveProperty('message_uuid')
      expect(typeof result.message_uuid).toBe('string')
    })
  })

  // ── Verify ──

  describe('startVerification + cancelVerification', () => {
    it('starts and cancels a verification', async () => {
      const { toNumber } = testValues

      if (!toNumber) {
        console.log('Skipping verification: testValues.toNumber not set')
        return
      }

      const startResult = await service.startVerification('FlowRunnerTest', 'SMS', toNumber)

      expect(startResult).toHaveProperty('request_id')
      expect(typeof startResult.request_id).toBe('string')

      const cancelResult = await service.cancelVerification(startResult.request_id)

      expect(cancelResult).toEqual({
        success: true,
        request_id: startResult.request_id,
      })
    })
  })
})
