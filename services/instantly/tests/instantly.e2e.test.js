'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Instantly Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('instantly')
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

  // ── Campaigns ──

  describe('listCampaigns', () => {
    it('returns campaigns with expected shape', async () => {
      const result = await service.listCampaigns(5, undefined)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getCampaignAnalyticsOverview', () => {
    it('returns an analytics overview object', async () => {
      const result = await service.getCampaignAnalyticsOverview()

      expect(result).toBeDefined()
      expect(typeof result).toBe('object')
    })
  })

  // ── Accounts ──

  describe('listAccounts', () => {
    it('returns accounts with expected shape', async () => {
      const result = await service.listAccounts(5, undefined)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Leads ──

  describe('listLeads', () => {
    it('returns leads with expected shape', async () => {
      const result = await service.listLeads(5)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Lead Lists ──

  describe('listLeadLists', () => {
    it('returns lead lists with expected shape', async () => {
      const result = await service.listLeadLists(5)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Lead Labels ──

  describe('listLeadLabels', () => {
    it('returns lead labels with expected shape', async () => {
      const result = await service.listLeadLabels(5)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Emails ──

  describe('listEmails', () => {
    it('returns emails with expected shape', async () => {
      const result = await service.listEmails(5)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('countUnreadEmails', () => {
    it('returns an unread count', async () => {
      const result = await service.countUnreadEmails()

      expect(result).toBeDefined()
    })
  })

  // ── Tags (list) ──

  describe('listTags', () => {
    it('returns tags with expected shape', async () => {
      const result = await service.listTags(5)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Tag lifecycle (create only; Instantly has no delete-tag action) ──

  describe('createTag', () => {
    it('creates a custom tag with a unique label', async () => {
      const label = `E2E Test Tag ${ Date.now() }`
      const result = await service.createTag(label, 'Created by e2e test suite')

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('label', label)
    })
  })

  // ── Lead List lifecycle ──

  describe('createLeadList + getLeadList + deleteLeadList', () => {
    let listId

    it('creates a lead list', async () => {
      const result = await service.createLeadList(`E2E List ${ Date.now() }`)

      expect(result).toHaveProperty('id')
      listId = result.id
    })

    it('retrieves the created lead list', async () => {
      const result = await service.getLeadList(listId)

      expect(result).toHaveProperty('id', listId)
    })

    it('deletes the created lead list', async () => {
      await expect(service.deleteLeadList(listId)).resolves.toMatchObject({ success: true })
    })
  })

  // ── Email verification ──

  describe('verifyEmail', () => {
    it('submits an email for verification', async () => {
      const email = testValues.verifyEmail || 'test@example.com'
      const result = await service.verifyEmail(email)

      expect(result).toBeDefined()
    })
  })

  // ── Dictionaries ──

  describe('getCampaignsDict', () => {
    it('returns dictionary with an items array', async () => {
      const result = await service.getCampaignsDict({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getAccountsDict', () => {
    it('returns dictionary with an items array', async () => {
      const result = await service.getAccountsDict({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getTagsDict', () => {
    it('returns dictionary with an items array', async () => {
      const result = await service.getTagsDict({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getLeadListsDict', () => {
    it('returns dictionary with an items array', async () => {
      const result = await service.getLeadListsDict({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getLeadLabelsDict', () => {
    it('returns dictionary with an items array', async () => {
      const result = await service.getLeadLabelsDict({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getEventTypesDict', () => {
    it('returns dictionary with an items array', async () => {
      const result = await service.getEventTypesDict({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Optional test-value-dependent checks ──

  describe('getCampaign (requires testValues.campaignId)', () => {
    it('retrieves a specific campaign when a campaignId is configured', async () => {
      if (!testValues.campaignId) {
        console.log('Skipping getCampaign: no testValues.campaignId configured')
        return
      }

      const result = await service.getCampaign(testValues.campaignId)

      expect(result).toHaveProperty('id', testValues.campaignId)
    })
  })

  describe('findLead (requires testValues.leadEmail)', () => {
    it('finds a lead by email when a leadEmail is configured', async () => {
      if (!testValues.leadEmail) {
        console.log('Skipping findLead: no testValues.leadEmail configured')
        return
      }

      const result = await service.findLead(testValues.leadEmail)

      expect(result).toHaveProperty('email')
    })
  })
})
