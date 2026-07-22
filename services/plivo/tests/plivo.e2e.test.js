'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Plivo Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('plivo')
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

  describe('getAccountDetails', () => {
    it('returns the authenticated account', async () => {
      const result = await service.getAccountDetails()

      expect(result).toHaveProperty('name')
      expect(result).toHaveProperty('auth_id')
    })
  })

  // ── Messages ──

  describe('messages', () => {
    it('lists messages', async () => {
      const result = await service.listMessages(null, 5, 0)

      expect(result).toHaveProperty('objects')
      expect(Array.isArray(result.objects)).toBe(true)
      expect(result).toHaveProperty('meta')
    })

    it('sends an SMS and retrieves it by uuid', async () => {
      const { srcNumber, dstNumber } = testValues

      if (!srcNumber || !dstNumber) {
        console.log('Skipping sendSms: testValues.srcNumber or testValues.dstNumber not set')

        return
      }

      const sent = await service.sendSms(srcNumber, dstNumber, 'FlowRunner Plivo e2e test', 'SMS')

      expect(sent).toHaveProperty('message_uuid')
      expect(Array.isArray(sent.message_uuid)).toBe(true)

      const message = await service.getMessage(sent.message_uuid[0])

      expect(message).toHaveProperty('message_uuid', sent.message_uuid[0])
    })

    it('rejects an unknown message uuid', async () => {
      await expect(service.getMessage('00000000-0000-0000-0000-000000000000'))
        .rejects.toThrow(/Plivo API error/)
    })
  })

  // ── Calls ──

  describe('calls', () => {
    it('lists calls', async () => {
      const result = await service.listCalls('Outbound', 5, 0)

      expect(result).toHaveProperty('objects')
      expect(Array.isArray(result.objects)).toBe(true)
    })

    it('places a call and hangs it up', async () => {
      const { srcNumber, dstNumber, answerUrl } = testValues

      if (!srcNumber || !dstNumber || !answerUrl) {
        console.log('Skipping makeCall: testValues.srcNumber, testValues.dstNumber or testValues.answerUrl not set')

        return
      }

      const call = await service.makeCall(srcNumber, dstNumber, answerUrl, 'GET')

      expect(call).toHaveProperty('request_uuid')

      if (call.call_uuid) {
        const hangup = await service.hangupCall(call.call_uuid)

        expect(hangup).toMatchObject({ success: true, call_uuid: call.call_uuid })
      }
    })

    it('rejects an unknown call uuid', async () => {
      await expect(service.getCall('00000000-0000-0000-0000-000000000000'))
        .rejects.toThrow(/Plivo API error/)
    })
  })

  // ── Numbers ──

  describe('numbers', () => {
    it('lists rented numbers', async () => {
      const result = await service.listNumbers(null, 5, 0)

      expect(result).toHaveProperty('objects')
      expect(Array.isArray(result.objects)).toBe(true)
    })

    it('fetches a rented number', async () => {
      const { rentedNumber } = testValues

      if (!rentedNumber) {
        console.log('Skipping getNumber: testValues.rentedNumber not set')

        return
      }

      const result = await service.getNumber(rentedNumber)

      expect(result).toHaveProperty('number')
    })

    it('searches the number inventory', async () => {
      const result = await service.searchNumbers('US', 'Local', 5, 0)

      expect(result).toHaveProperty('objects')
      expect(Array.isArray(result.objects)).toBe(true)
    })
  })

  // ── Powerpacks / Applications ──

  describe('listPowerpacks', () => {
    it('lists the powerpacks', async () => {
      const result = await service.listPowerpacks(5, 0)

      expect(result).toHaveProperty('objects')
    })
  })

  describe('listApplications', () => {
    it('lists the applications', async () => {
      const result = await service.listApplications(5, 0)

      expect(result).toHaveProperty('objects')
      expect(Array.isArray(result.objects)).toBe(true)
    })
  })

  // ── Dictionaries ──

  describe('dictionaries', () => {
    it('returns the numbers dictionary', async () => {
      const result = await service.getNumbersDictionary({})

      expect(result).toHaveProperty('items')
      expect(result).toHaveProperty('cursor')

      result.items.forEach(item => {
        expect(item).toHaveProperty('label')
        expect(item).toHaveProperty('value')
        expect(item).toHaveProperty('note')
      })
    })

    it('returns the applications dictionary', async () => {
      const result = await service.getApplicationsDictionary({})

      expect(result).toHaveProperty('items')
      expect(result).toHaveProperty('cursor')

      result.items.forEach(item => {
        expect(item).toHaveProperty('label')
        expect(item).toHaveProperty('value')
      })
    })

    it('applies the search filter without failing', async () => {
      const result = await service.getApplicationsDictionary({ search: 'zzz-no-such-app' })

      expect(result.items).toEqual([])
    })
  })
})
