'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Pushcut Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('pushcut')
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

  // ── Devices ──

  describe('listDevices', () => {
    it('returns the connected devices', async () => {
      const result = await service.listDevices()

      expect(Array.isArray(result)).toBe(true)
    })
  })

  describe('getDevicesDictionary', () => {
    it('returns dictionary items', async () => {
      const result = await service.getDevicesDictionary({})

      expect(result).toHaveProperty('cursor', null)
      expect(Array.isArray(result.items)).toBe(true)

      result.items.forEach(item => {
        expect(item).toHaveProperty('label')
        expect(item).toHaveProperty('value')
        expect(item).toHaveProperty('note', 'Pushcut device')
      })
    })

    it('applies the search filter', async () => {
      const result = await service.getDevicesDictionary({ search: 'zzz-no-such-device' })

      expect(result.items).toHaveLength(0)
    })
  })

  // ── Notifications ──

  describe('listNotifications', () => {
    it('returns the defined notifications', async () => {
      const result = await service.listNotifications()

      expect(Array.isArray(result)).toBe(true)
    })
  })

  describe('getNotificationsDictionary', () => {
    it('returns dictionary items', async () => {
      const result = await service.getNotificationsDictionary({})

      expect(result).toHaveProperty('cursor', null)
      expect(Array.isArray(result.items)).toBe(true)
    })

    it('applies the search filter', async () => {
      const result = await service.getNotificationsDictionary({ search: 'zzz-no-such-notification' })

      expect(result.items).toHaveLength(0)
    })
  })

  describe('sendNotification', () => {
    it('rejects a missing notification name', async () => {
      await expect(service.sendNotification()).rejects.toThrow('notificationName is required')
    })

    it('sends a predefined notification', async () => {
      const { notificationName } = testValues

      if (!notificationName) {
        console.log('Skipping sendNotification: testValues.notificationName not set')

        return
      }

      const result = await service.sendNotification(notificationName, 'E2E Test', 'Sent from the FlowRunner e2e suite')

      expect(result).toBeDefined()
    })
  })

  // ── Execute ──

  describe('executeAction', () => {
    it('rejects when no target is provided', async () => {
      await expect(service.executeAction()).rejects.toThrow('provide one of shortcut, homekit, or automation')
    })

    it('executes a shortcut', async () => {
      const { shortcutName } = testValues

      if (!shortcutName) {
        console.log('Skipping executeAction: testValues.shortcutName not set')

        return
      }

      const result = await service.executeAction(shortcutName, undefined, undefined, 'e2e-input')

      expect(result).toBeDefined()
    })
  })

  // ── Subscriptions ──

  describe('subscriptions lifecycle', () => {
    let createdId

    it('lists existing subscriptions', async () => {
      const result = await service.listSubscriptions()

      expect(Array.isArray(result)).toBe(true)
    })

    it('rejects incomplete subscription input', async () => {
      await expect(service.addSubscription('Some Action')).rejects.toThrow('actionName and url are required')
      await expect(service.addSubscription(undefined, 'https://example.com/hook')).rejects.toThrow('actionName and url are required')
    })

    it('adds a subscription', async () => {
      const { subscriptionActionName } = testValues

      if (!subscriptionActionName) {
        console.log('Skipping addSubscription: testValues.subscriptionActionName not set')

        return
      }

      const result = await service.addSubscription(subscriptionActionName, `https://example.com/flowrunner-e2e-${ Date.now() }`)

      expect(result).toHaveProperty('id')
      createdId = result.id
    })

    it('removes the created subscription', async () => {
      if (!createdId) {
        console.log('Skipping removeSubscription: no subscription was created')

        return
      }

      const result = await service.removeSubscription(createdId)

      expect(result).toBeDefined()
    })

    it('rejects a missing subscription id', async () => {
      await expect(service.removeSubscription()).rejects.toThrow('subscriptionId is required')
    })
  })
})
