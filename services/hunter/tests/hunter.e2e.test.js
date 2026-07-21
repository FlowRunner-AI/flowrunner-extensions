'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Hunter.io Service (e2e)', () => {
  let sandbox
  let service

  beforeAll(() => {
    sandbox = createE2ESandbox('hunter')
    require('../src/index.js')

    try {
      sandbox.validateConfigs()
    } catch (error) {
      console.log(error)
      process.exit(1)
    }

    service = sandbox.getService()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Account ──

  describe('getAccount', () => {
    it('returns account data with expected shape', async () => {
      const result = await service.getAccount()

      expect(result).toHaveProperty('data')
      expect(result.data).toHaveProperty('first_name')
      expect(result.data).toHaveProperty('plan_name')
      expect(result.data).toHaveProperty('calls')
      expect(result.data.calls).toHaveProperty('used')
      expect(result.data.calls).toHaveProperty('available')
    })
  })

  // ── Email Discovery ──

  describe('emailCount', () => {
    it('returns email count for a well-known domain', async () => {
      const result = await service.emailCount('stripe.com')

      expect(result).toHaveProperty('data')
      expect(result.data).toHaveProperty('total')
      expect(typeof result.data.total).toBe('number')
      expect(result.data).toHaveProperty('personal_emails')
      expect(result.data).toHaveProperty('generic_emails')
    })
  })

  describe('domainSearch', () => {
    it('returns emails for a well-known domain', async () => {
      const result = await service.domainSearch('stripe.com', undefined, 5)

      expect(result).toHaveProperty('data')
      expect(result.data).toHaveProperty('domain', 'stripe.com')
      expect(result.data).toHaveProperty('emails')
      expect(Array.isArray(result.data.emails)).toBe(true)
      expect(result).toHaveProperty('meta')
    })
  })

  describe('emailFinder', () => {
    it('finds an email for a known person at a domain', async () => {
      const result = await service.emailFinder('Patrick', 'Collison', 'stripe.com')

      expect(result).toHaveProperty('data')
      expect(result.data).toHaveProperty('email')
      expect(result.data).toHaveProperty('score')
      expect(typeof result.data.score).toBe('number')
    })
  })

  describe('emailVerifier', () => {
    it('verifies a known email address', async () => {
      const result = await service.emailVerifier('patrick@stripe.com')

      expect(result).toHaveProperty('data')
      expect(result.data).toHaveProperty('status')
      expect(result.data).toHaveProperty('score')
      expect(result.data).toHaveProperty('email', 'patrick@stripe.com')
    })
  })

  // ── Enrichment ──

  describe('combinedEnrichment', () => {
    it('returns enrichment data for a known email', async () => {
      const result = await service.combinedEnrichment('patrick@stripe.com')

      expect(result).toHaveProperty('data')
    })
  })

  // ── Leads Lists + Leads lifecycle ──

  describe('leads lifecycle', () => {
    let leadId
    let listId

    it('creates a leads list', async () => {
      const result = await service.createLeadsList(`E2E Test ${Date.now()}`)

      expect(result).toHaveProperty('data')
      expect(result.data).toHaveProperty('id')
      expect(result.data).toHaveProperty('name')
      listId = result.data.id
    })

    it('lists leads lists and finds the created one', async () => {
      const result = await service.listLeadsLists(100, 0)

      expect(result).toHaveProperty('data')
      expect(result.data).toHaveProperty('leads_lists')
      expect(Array.isArray(result.data.leads_lists)).toBe(true)

      const found = result.data.leads_lists.find(l => l.id === listId)
      expect(found).toBeDefined()
    })

    it('creates a lead in the list', async () => {
      const result = await service.createLead(
        `e2e-test-${Date.now()}@example.com`,
        'E2E', 'Test', 'Tester', 'TestCorp',
        'testcorp.com', undefined, undefined, undefined,
        'e2e-test', 'Automated test lead', String(listId)
      )

      expect(result).toHaveProperty('data')
      expect(result.data).toHaveProperty('id')
      expect(result.data).toHaveProperty('email')
      leadId = result.data.id
    })

    it('gets the created lead by ID', async () => {
      const result = await service.getLead(leadId)

      expect(result).toHaveProperty('data')
      expect(result.data).toHaveProperty('id', leadId)
      expect(result.data).toHaveProperty('first_name', 'E2E')
    })

    it('updates the lead', async () => {
      const result = await service.updateLead(leadId, undefined, undefined, undefined, 'Senior Tester')

      expect(result).toHaveProperty('data')
      expect(result.data).toHaveProperty('id', leadId)
    })

    it('lists leads and finds the created one', async () => {
      const result = await service.listLeads(String(listId), 100, 0)

      expect(result).toHaveProperty('data')
      expect(result.data).toHaveProperty('leads')
      expect(Array.isArray(result.data.leads)).toBe(true)

      const found = result.data.leads.find(l => l.id === leadId)
      expect(found).toBeDefined()
    })

    it('deletes the lead', async () => {
      const result = await service.deleteLead(leadId)

      expect(result).toEqual({ deleted: true, leadId })
    })
  })

  // ── Dictionary ──

  describe('getLeadsListsDictionary', () => {
    it('returns dictionary items with correct shape', async () => {
      const result = await service.getLeadsListsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
      }
    })

    it('filters by search text', async () => {
      const all = await service.getLeadsListsDictionary({})
      if (all.items.length === 0) {
        return
      }
      const firstName = all.items[0].label
      const filtered = await service.getLeadsListsDictionary({ search: firstName })

      expect(filtered.items.length).toBeGreaterThan(0)
      expect(filtered.items.every(item => item.label.toLowerCase().includes(firstName.toLowerCase()))).toBe(true)
    })
  })
})
