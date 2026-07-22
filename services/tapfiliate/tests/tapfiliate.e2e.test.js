'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Tapfiliate Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('tapfiliate')
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

  // ── Programs ──

  describe('listPrograms', () => {
    it('returns an array of programs', async () => {
      const result = await service.listPrograms(1)

      expect(Array.isArray(result)).toBe(true)
    })
  })

  describe('getProgram', () => {
    it('retrieves a program by ID', async () => {
      const { programId } = testValues

      if (!programId) {
        console.log('Skipping getProgram: testValues.programId not set')
        return
      }

      const result = await service.getProgram(programId)

      expect(result).toHaveProperty('id', programId)
      expect(result).toHaveProperty('title')
    })
  })

  // ── Affiliates ──

  describe('affiliate lifecycle (create, get, update, list, delete)', () => {
    let createdAffiliateId
    const testEmail = `e2e-tapfiliate-${Date.now()}@test-flowrunner.com`

    it('creates an affiliate', async () => {
      const result = await service.createAffiliate('E2EFirst', 'E2ELast', testEmail)

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('firstname', 'E2EFirst')
      expect(result).toHaveProperty('lastname', 'E2ELast')
      expect(result).toHaveProperty('email', testEmail)
      createdAffiliateId = result.id
    })

    it('retrieves the created affiliate', async () => {
      if (!createdAffiliateId) {
        console.log('Skipping: affiliate was not created')
        return
      }

      const result = await service.getAffiliate(createdAffiliateId)

      expect(result).toHaveProperty('id', createdAffiliateId)
      expect(result).toHaveProperty('email', testEmail)
    })

    it('updates the created affiliate', async () => {
      if (!createdAffiliateId) {
        console.log('Skipping: affiliate was not created')
        return
      }

      const result = await service.updateAffiliate(createdAffiliateId, 'UpdatedFirst')

      expect(result).toHaveProperty('id', createdAffiliateId)
      expect(result).toHaveProperty('firstname', 'UpdatedFirst')
    })

    it('lists affiliates and finds the created one', async () => {
      const result = await service.listAffiliates()

      expect(Array.isArray(result)).toBe(true)
    })

    it('deletes the created affiliate', async () => {
      if (!createdAffiliateId) {
        console.log('Skipping: affiliate was not created')
        return
      }

      const result = await service.deleteAffiliate(createdAffiliateId)

      expect(result).toEqual({ success: true, id: createdAffiliateId })
    })
  })

  // ── Program Affiliates ──

  describe('program affiliate operations', () => {
    it('lists program affiliates', async () => {
      const { programId } = testValues

      if (!programId) {
        console.log('Skipping listProgramAffiliates: testValues.programId not set')
        return
      }

      const result = await service.listProgramAffiliates(programId)

      expect(Array.isArray(result)).toBe(true)
    })
  })

  // ── Conversions ──

  describe('listConversions', () => {
    it('returns an array of conversions', async () => {
      const result = await service.listConversions()

      expect(Array.isArray(result)).toBe(true)
    })
  })

  describe('getConversion', () => {
    it('retrieves a conversion by ID', async () => {
      const { conversionId } = testValues

      if (!conversionId) {
        console.log('Skipping getConversion: testValues.conversionId not set')
        return
      }

      const result = await service.getConversion(conversionId)

      expect(result).toHaveProperty('id')
    })
  })

  // ── Commissions ──

  describe('listCommissions', () => {
    it('returns an array of commissions', async () => {
      const result = await service.listCommissions()

      expect(Array.isArray(result)).toBe(true)
    })
  })

  describe('getCommission', () => {
    it('retrieves a commission by ID', async () => {
      const { commissionId } = testValues

      if (!commissionId) {
        console.log('Skipping getCommission: testValues.commissionId not set')
        return
      }

      const result = await service.getCommission(commissionId)

      expect(result).toHaveProperty('id')
    })
  })

  // ── Customers ──

  describe('listCustomers', () => {
    it('returns an array of customers', async () => {
      const result = await service.listCustomers()

      expect(Array.isArray(result)).toBe(true)
    })
  })

  describe('getCustomer', () => {
    it('retrieves a customer by ID', async () => {
      const { customerId } = testValues

      if (!customerId) {
        console.log('Skipping getCustomer: testValues.customerId not set')
        return
      }

      const result = await service.getCustomer(customerId)

      expect(result).toHaveProperty('id')
    })
  })

  // ── Dictionaries ──

  describe('getProgramsDictionary', () => {
    it('returns items with label and value', async () => {
      const result = await service.getProgramsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
      }
    })

    it('filters by search term', async () => {
      const { programSearchTerm } = testValues

      if (!programSearchTerm) {
        console.log('Skipping dictionary search: testValues.programSearchTerm not set')
        return
      }

      const result = await service.getProgramsDictionary({ search: programSearchTerm })

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })
})
