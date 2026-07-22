'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Pushover Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('pushover')
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

  describe('getLimits', () => {
    it('returns the application message quota', async () => {
      const result = await service.getLimits()

      expect(result).toHaveProperty('status', 1)
      expect(result).toHaveProperty('limit')
      expect(result).toHaveProperty('remaining')
      expect(result).toHaveProperty('reset')
    })
  })

  describe('getSounds', () => {
    it('returns the available sounds', async () => {
      const result = await service.getSounds()

      expect(result).toHaveProperty('status', 1)
      expect(typeof result.sounds).toBe('object')
      expect(result.sounds).toHaveProperty('pushover')
    })
  })

  // ── Validation ──

  describe('validateUser', () => {
    it('validates the configured recipient key', async () => {
      const { userKey } = testValues

      if (!userKey) {
        console.log('Skipping validateUser: testValues.userKey not set')

        return
      }

      const result = await service.validateUser(userKey)

      expect(result).toHaveProperty('status', 1)
      expect(Array.isArray(result.devices)).toBe(true)
    })

    it('rejects an invalid user key', async () => {
      await expect(service.validateUser('invalid-user-key-000000000000')).rejects.toThrow('Pushover API error:')
    })
  })

  // ── Notifications ──

  describe('sendNotification', () => {
    it('sends a normal-priority notification', async () => {
      const { userKey } = testValues

      if (!userKey) {
        console.log('Skipping sendNotification: testValues.userKey not set')

        return
      }

      const result = await service.sendNotification(userKey, 'FlowRunner e2e test message', 'E2E Test', 'Low', 'None (silent)')

      expect(result).toHaveProperty('status', 1)
      expect(result).toHaveProperty('request')
    })

    it('rejects Emergency priority without retry and expire', async () => {
      await expect(
        service.sendNotification('any-user', 'msg', undefined, 'Emergency')
      ).rejects.toThrow('Emergency priority requires both Retry Interval and Expire After')
    })

    it('rejects a retry interval below the minimum', async () => {
      await expect(
        service.sendNotification('any-user', 'msg', undefined, 'Emergency', undefined, undefined, undefined, undefined, undefined, undefined, undefined, 5, 600)
      ).rejects.toThrow('Retry Interval must be at least 30 seconds')
    })

    it('rejects an expiry above the maximum', async () => {
      await expect(
        service.sendNotification('any-user', 'msg', undefined, 'Emergency', undefined, undefined, undefined, undefined, undefined, undefined, undefined, 60, 99999)
      ).rejects.toThrow('Expire After must be at most 10800 seconds')
    })

    it('rejects an unknown recipient', async () => {
      await expect(service.sendNotification('invalid-user-key-000000000000', 'msg')).rejects.toThrow('Pushover API error:')
    })
  })

  // ── Emergency receipts ──

  describe('emergency lifecycle', () => {
    let receipt

    it('sends an emergency-priority notification and returns a receipt', async () => {
      const { userKey } = testValues

      if (!userKey) {
        console.log('Skipping emergency send: testValues.userKey not set')

        return
      }

      const result = await service.sendNotification(
        userKey,
        'FlowRunner e2e emergency test',
        'E2E Emergency',
        'Emergency',
        'None (silent)',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        30,
        60
      )

      expect(result).toHaveProperty('status', 1)
      expect(result).toHaveProperty('receipt')
      receipt = result.receipt
    })

    it('reads the receipt status', async () => {
      if (!receipt) {
        console.log('Skipping getReceipt: no receipt available')

        return
      }

      const result = await service.getReceipt(receipt)

      expect(result).toHaveProperty('status', 1)
      expect(result).toHaveProperty('acknowledged')
    })

    it('cancels the emergency retries', async () => {
      if (!receipt) {
        console.log('Skipping cancelEmergencyRetry: no receipt available')

        return
      }

      const result = await service.cancelEmergencyRetry(receipt)

      expect(result).toHaveProperty('status', 1)
    })

    it('rejects an unknown receipt id', async () => {
      await expect(service.getReceipt('invalid-receipt-id')).rejects.toThrow('Pushover API error:')
    })
  })
})
