'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Clearbit Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('clearbit')
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

  // Clearbit resolves some lookups asynchronously and answers with HTTP 202
  // while it works. The service translates that into a `{ pending: true }`
  // payload, which is a legitimate outcome for a live call — so shape
  // assertions accept either a resolved record or a pending payload.
  const expectRecordOrPending = (response, resolvedKeys) => {
    expect(response).toBeDefined()

    if (response.pending) {
      expect(response).toMatchObject({ pending: true, status: 202 })
      return
    }

    for (const key of resolvedKeys) {
      expect(response).toHaveProperty(key)
    }
  }

  // ── Enrichment ──

  describe('enrichPerson', () => {
    it('enriches a person by email (or returns pending)', async () => {
      const email = testValues.personEmail || 'alex@clearbit.com'

      const response = await service.enrichPerson(email)

      // A resolved person record exposes id + name; a pending payload is allowed.
      expectRecordOrPending(response, ['id'])
    })
  })

  describe('enrichCompany', () => {
    it('enriches a company by domain (or returns pending)', async () => {
      const domain = testValues.companyDomain || 'clearbit.com'

      const response = await service.enrichCompany(domain)

      expectRecordOrPending(response, ['id', 'domain'])
    })
  })

  describe('enrichCombined', () => {
    it('enriches a person and company by email (or returns pending)', async () => {
      const email = testValues.personEmail || 'alex@clearbit.com'

      const response = await service.enrichCombined(email)

      if (response.pending) {
        expect(response).toMatchObject({ pending: true, status: 202 })
        return
      }

      expect(response).toHaveProperty('person')
      expect(response).toHaveProperty('company')
    })
  })

  // ── Discovery ──

  describe('revealCompany', () => {
    // Reveal is a legacy API that may be unavailable on newer accounts, and
    // needs a real IP that maps to a company; only runs when supplied.
    const ip = () => testValues.revealIp

    it('resolves an IP to a company when a test IP is configured', async () => {
      if (!ip()) {
        console.log('Skipping revealCompany: set testValues.revealIp to a company IP to run this test')
        return
      }

      const response = await service.revealCompany(ip())

      expectRecordOrPending(response, ['ip'])
    })
  })

  describe('searchCompanies', () => {
    // Discovery is a legacy API that may be unavailable on newer accounts;
    // only runs when the developer opts in with a query.
    const query = () => testValues.discoveryQuery

    it('searches companies when a discovery query is configured', async () => {
      if (!query()) {
        console.log('Skipping searchCompanies: set testValues.discoveryQuery to run this legacy Discovery test')
        return
      }

      const response = await service.searchCompanies(query(), undefined, 5)

      expect(response).toHaveProperty('results')
      expect(Array.isArray(response.results)).toBe(true)
    })
  })

  // ── Prospecting ──

  describe('findContacts', () => {
    // Prospector is a legacy API that may be unavailable on newer accounts;
    // only runs when the developer supplies a domain to prospect.
    const domain = () => testValues.prospectDomain

    it('finds contacts at a domain when a prospect domain is configured', async () => {
      if (!domain()) {
        console.log('Skipping findContacts: set testValues.prospectDomain to run this legacy Prospector test')
        return
      }

      const response = await service.findContacts(domain())

      expect(response).toHaveProperty('results')
      expect(Array.isArray(response.results)).toBe(true)
    })
  })
})
