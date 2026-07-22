'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Vero Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('vero')
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

  // ── Identify + Update + Tags + Delete lifecycle ──

  describe('user lifecycle', () => {
    const testUserId = `e2e-test-user-${Date.now()}`
    const testEmail = `e2e-${Date.now()}@example.com`

    it('identifies a new user', async () => {
      const result = await service.identifyUser(testUserId, testEmail, {
        first_name: 'E2E',
        plan: 'free',
      })

      expect(result).toHaveProperty('status', 200)
    })

    it('updates the user', async () => {
      const result = await service.updateUser(testUserId, { plan: 'pro' })

      expect(result).toHaveProperty('status', 200)
    })

    it('adds tags to the user', async () => {
      const result = await service.editUserTags(testUserId, ['e2e-tag', 'test'], undefined)

      expect(result).toHaveProperty('status', 200)
    })

    it('removes tags from the user', async () => {
      const result = await service.editUserTags(testUserId, undefined, ['e2e-tag'])

      expect(result).toHaveProperty('status', 200)
    })

    it('unsubscribes the user', async () => {
      const result = await service.unsubscribeUser(testUserId)

      expect(result).toHaveProperty('status', 200)
    })

    it('resubscribes the user', async () => {
      const result = await service.resubscribeUser(testUserId)

      expect(result).toHaveProperty('status', 200)
    })

    it('deletes the user', async () => {
      const result = await service.deleteUser(testUserId)

      expect(result).toHaveProperty('status', 200)
    })
  })

  // ── Reidentify ──

  describe('reidentifyUser', () => {
    const originalId = `e2e-reident-${Date.now()}`
    const newId = `e2e-reident-new-${Date.now()}`

    it('identifies a user then reidentifies them', async () => {
      await service.identifyUser(originalId, null, { test: true })

      const result = await service.reidentifyUser(originalId, newId)

      expect(result).toHaveProperty('status', 200)
    })

    it('cleans up the reidentified user', async () => {
      const result = await service.deleteUser(newId)

      expect(result).toHaveProperty('status', 200)
    })
  })

  // ── Track Event ──

  describe('trackEvent', () => {
    const eventUserId = `e2e-event-user-${Date.now()}`

    it('tracks an event with identity and data', async () => {
      const result = await service.trackEvent(
        eventUserId,
        null,
        'e2e_test_event',
        { item: 'widget', price: 9.99 },
        undefined
      )

      expect(result).toHaveProperty('status', 200)
    })

    it('cleans up the event user', async () => {
      const result = await service.deleteUser(eventUserId)

      expect(result).toHaveProperty('status', 200)
    })
  })
})
