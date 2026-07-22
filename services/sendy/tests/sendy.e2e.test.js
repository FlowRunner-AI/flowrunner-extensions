'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

const SUFFIX = Date.now()

describe('Sendy Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('sendy')
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

  // ── Brands ──

  describe('getBrands', () => {
    it('returns the brands configured in the installation', async () => {
      const result = await service.getBrands()

      expect(typeof result).toBe('string')
      expect(result.length).toBeGreaterThan(0)
    })
  })

  // ── Subscribers ──

  describe('subscriber lifecycle', () => {
    const email = `flowrunner-e2e-${ SUFFIX }@example.com`

    it('subscribes a new address to the test list', async () => {
      const { listId } = testValues

      if (!listId) {
        console.log('Skipping subscribe: testValues.listId not set')

        return
      }

      const result = await service.subscribe(listId, email, 'FlowRunner E2E', 'US', null, null, true, true)

      expect(typeof result).toBe('string')
    })

    it('reports the subscription status of the new address', async () => {
      const { listId } = testValues

      if (!listId) {
        console.log('Skipping getSubscriptionStatus: testValues.listId not set')

        return
      }

      const result = await service.getSubscriptionStatus(listId, email)

      expect(typeof result).toBe('string')
      expect(result.length).toBeGreaterThan(0)
    })

    it('returns the active subscriber count for the test list', async () => {
      const { listId } = testValues

      if (!listId) {
        console.log('Skipping getActiveSubscriberCount: testValues.listId not set')

        return
      }

      const result = await service.getActiveSubscriberCount(listId)

      expect(String(Number(result))).toBe(String(result).trim())
    })

    it('unsubscribes the address', async () => {
      const { listId } = testValues

      if (!listId) {
        console.log('Skipping unsubscribe: testValues.listId not set')

        return
      }

      const result = await service.unsubscribe(listId, email)

      expect(typeof result).toBe('string')
    })

    it('deletes the subscriber', async () => {
      const { listId } = testValues

      if (!listId) {
        console.log('Skipping deleteSubscriber: testValues.listId not set')

        return
      }

      const result = await service.deleteSubscriber(listId, email)

      expect(typeof result).toBe('string')
    })
  })

  // ── Campaigns ──

  describe('createCampaign', () => {
    it('creates a draft campaign under the test brand', async () => {
      const { brandId, fromEmail } = testValues

      if (!brandId || !fromEmail) {
        console.log('Skipping createCampaign: testValues.brandId or testValues.fromEmail not set')

        return
      }

      const result = await service.createCampaign(
        'FlowRunner E2E',
        fromEmail,
        fromEmail,
        `FlowRunner e2e draft ${ SUFFIX }`,
        '<p>Created by the FlowRunner e2e suite.</p>',
        `flowrunner-e2e-${ SUFFIX }`,
        'Created by the FlowRunner e2e suite.',
        null,
        null,
        brandId,
        null,
        false
      )

      expect(typeof result).toBe('string')
      expect(result.toLowerCase()).toContain('campaign created')
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('rejects an invalid list id', async () => {
      await expect(
        service.getActiveSubscriberCount(`missing-list-${ SUFFIX }`)
      ).rejects.toThrow(/Sendy API error/)
    })
  })
})
