'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Lemlist Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('lemlist')
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

  // A unique-ish suffix so repeated e2e runs don't collide.
  const suffix = Date.now()
  const testEmail = `e2e-test-${ suffix }@flowrunner-test.com`

  // ── Team ──

  describe('getTeam', () => {
    it('returns team info with expected shape', async () => {
      const result = await service.getTeam()

      expect(result).toHaveProperty('_id')
      expect(result).toHaveProperty('name')
    })
  })

  // ── Campaigns ──

  describe('listCampaigns', () => {
    it('returns an array of campaigns', async () => {
      const result = await service.listCampaigns(0, 5)

      expect(Array.isArray(result)).toBe(true)
    })
  })

  describe('getCampaign', () => {
    it('returns a single campaign by ID', async () => {
      const campaigns = await service.listCampaigns(0, 1)

      if (!campaigns || campaigns.length === 0) {
        console.log('Skipping getCampaign: no campaigns available')
        return
      }

      const result = await service.getCampaign(campaigns[0]._id)

      expect(result).toHaveProperty('_id', campaigns[0]._id)
      expect(result).toHaveProperty('name')
    })
  })

  describe('getCampaignStats', () => {
    it('returns campaign stats', async () => {
      const campaigns = await service.listCampaigns(0, 1)

      if (!campaigns || campaigns.length === 0) {
        console.log('Skipping getCampaignStats: no campaigns available')
        return
      }

      const result = await service.getCampaignStats(campaigns[0]._id)

      expect(result).toBeDefined()
      expect(typeof result).toBe('object')
    })
  })

  // ── Leads (create, update, mark, unsubscribe, delete lifecycle) ──

  describe('lead lifecycle', () => {
    let campaignId

    beforeAll(async () => {
      // Use a testValues campaignId if provided, otherwise pick the first available
      if (testValues.campaignId) {
        campaignId = testValues.campaignId
      } else {
        const campaigns = await service.listCampaigns(0, 1)

        if (campaigns && campaigns.length > 0) {
          campaignId = campaigns[0]._id
        }
      }
    })

    it('adds a lead to a campaign', async () => {
      if (!campaignId) {
        console.log('Skipping lead lifecycle: no campaign available')
        return
      }

      const result = await service.addLeadToCampaign(
        campaignId, testEmail, 'E2E', 'Test', 'FlowRunner'
      )

      expect(result).toHaveProperty('_id')
      expect(result).toHaveProperty('email', testEmail)
    })

    it('retrieves the lead by email', async () => {
      if (!campaignId) {
        return
      }

      const result = await service.getLead(testEmail)

      expect(result).toBeDefined()
    })

    it('updates the lead', async () => {
      if (!campaignId) {
        return
      }

      const result = await service.updateLead(
        campaignId, testEmail, 'Updated', 'Name'
      )

      expect(result).toBeDefined()
    })

    it('deletes the lead from the campaign', async () => {
      if (!campaignId) {
        return
      }

      const result = await service.deleteLeadFromCampaign(campaignId, testEmail)

      expect(result).toBeDefined()
    })
  })

  // ── Activities ──

  describe('getActivities', () => {
    it('returns an array of activities', async () => {
      const result = await service.getActivities(undefined, undefined, 5)

      expect(Array.isArray(result)).toBe(true)
    })

    it('returns activities filtered by type', async () => {
      const result = await service.getActivities('Email Sent', undefined, 5)

      expect(Array.isArray(result)).toBe(true)
    })
  })

  // ── Unsubscribes (add + delete lifecycle) ──

  describe('unsubscribe lifecycle', () => {
    const unsubEmail = `e2e-unsub-${ suffix }@flowrunner-test.com`

    it('lists unsubscribes', async () => {
      const result = await service.listUnsubscribes(5)

      expect(Array.isArray(result)).toBe(true)
    })

    it('adds an email to unsubscribes', async () => {
      const result = await service.addUnsubscribe(unsubEmail)

      expect(result).toBeDefined()
    })

    it('removes the email from unsubscribes', async () => {
      const result = await service.deleteUnsubscribe(unsubEmail)

      expect(result).toBeDefined()
    })
  })

  // ── Dictionary ──

  describe('getCampaignsDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getCampaignsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })

    it('filters by search term without error', async () => {
      const result = await service.getCampaignsDictionary({ search: 'zzzz-no-match' })

      expect(result).toHaveProperty('items')
      expect(result.items).toEqual([])
    })
  })
})
