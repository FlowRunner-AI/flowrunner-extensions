'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('UpLead Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('uplead')
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

  describe('getCredits', () => {
    it('returns the remaining credits for the account', async () => {
      const result = await service.getCredits()

      expect(result).toHaveProperty('data')
      expect(result.data).toHaveProperty('credits')
    })
  })

  // ── Enrichment ──

  describe('enrichPerson', () => {
    it('enriches a person by work email', async () => {
      const { email } = testValues

      if (!email) {
        console.log('Skipping enrichPerson by email: testValues.email not set')

        return
      }

      const result = await service.enrichPerson(email)

      expect(result).toHaveProperty('data')
    })

    it('enriches a person by name and domain', async () => {
      const { firstName, lastName, companyDomain } = testValues

      if (!firstName || !lastName || !companyDomain) {
        console.log(
          'Skipping enrichPerson by name: testValues.firstName, lastName or companyDomain not set'
        )

        return
      }

      const result = await service.enrichPerson(undefined, firstName, lastName, companyDomain)

      expect(result).toHaveProperty('data')
    })

    it('throws for an invalid lookup', async () => {
      await expect(service.enrichPerson('not-an-email')).rejects.toThrow(/UpLead API error/)
    })
  })

  describe('enrichCompany', () => {
    it('enriches a company by domain', async () => {
      const domain = testValues.companyDomain

      if (!domain) {
        console.log('Skipping enrichCompany by domain: testValues.companyDomain not set')

        return
      }

      const result = await service.enrichCompany(domain)

      expect(result).toHaveProperty('data')
      expect(result.data).toHaveProperty('domain')
    })

    it('enriches a company by name', async () => {
      const result = await service.enrichCompany(undefined, 'Amazon')

      expect(result).toHaveProperty('data')
    })
  })

  describe('enrichPersonAndCompany', () => {
    it('enriches a person and their company from an email', async () => {
      const { email } = testValues

      if (!email) {
        console.log('Skipping enrichPersonAndCompany: testValues.email not set')

        return
      }

      const result = await service.enrichPersonAndCompany(email)

      expect(result).toHaveProperty('data')
    })
  })

  // ── Prospecting ──

  describe('searchContacts', () => {
    it('searches contacts at a company domain', async () => {
      const domain = testValues.companyDomain

      if (!domain) {
        console.log('Skipping searchContacts: testValues.companyDomain not set')

        return
      }

      const result = await service.searchContacts(domain)

      expect(result).toHaveProperty('data')
    })

    it('searches contacts with filters and pagination', async () => {
      const domain = testValues.companyDomain

      if (!domain) {
        console.log('Skipping searchContacts with filters: testValues.companyDomain not set')

        return
      }

      const result = await service.searchContacts(
        domain,
        undefined,
        'marketing',
        'Vice President',
        undefined,
        undefined,
        undefined,
        1,
        5
      )

      expect(result).toHaveProperty('data')
    })
  })
})
