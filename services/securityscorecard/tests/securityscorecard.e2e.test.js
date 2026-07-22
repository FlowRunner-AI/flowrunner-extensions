'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

/**
 * Required e2e-config.json entry:
 *
 * "securityscorecard": {
 *   "configs": {
 *     "apiKey": "<SecurityScorecard API token>"
 *   },
 *   "testValues": {
 *     "domain": "google.com",           // any domain the token can score
 *     "industry": "technology",         // optional, defaults to technology
 *     "issueType": "tlscert_expired",   // optional, used by the issues read
 *     "reportType": "detailed"          // optional, enables the report generation test
 *   }
 * }
 */
describe('SecurityScorecard Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('securityscorecard')
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

  const domain = () => testValues.domain || 'google.com'
  const industry = () => testValues.industry || 'technology'

  // ── Companies ──

  describe('getCompanyScore', () => {
    it('returns a grade and a score', async () => {
      const result = await service.getCompanyScore(domain())

      expect(result).toHaveProperty('domain')
      expect(result).toHaveProperty('score')
    })
  })

  describe('getCompanyFactorScores', () => {
    it('returns factor entries', async () => {
      const result = await service.getCompanyFactorScores(domain())

      expect(result).toHaveProperty('entries')
      expect(Array.isArray(result.entries)).toBe(true)
    })
  })

  describe('getCompanyHistoricalScores', () => {
    it('returns historical score entries', async () => {
      const result = await service.getCompanyHistoricalScores(domain())

      expect(result).toHaveProperty('entries')
    })
  })

  describe('getCompanyHistoricalFactorScores', () => {
    it('returns historical factor entries', async () => {
      const result = await service.getCompanyHistoricalFactorScores(domain())

      expect(result).toHaveProperty('entries')
    })
  })

  describe('getCompanyInformation', () => {
    it('returns company profile metadata', async () => {
      const result = await service.getCompanyInformation(domain())

      expect(result).toBeDefined()
    })
  })

  describe('getCompanyIssuesByType', () => {
    it('returns findings for an issue type', async () => {
      const issueType = testValues.issueType

      if (!issueType) {
        console.log('Skipping getCompanyIssuesByType: testValues.issueType not set')

        return
      }

      const result = await service.getCompanyIssuesByType(domain(), issueType)

      expect(result).toHaveProperty('entries')
    })
  })

  describe('getScorePlan', () => {
    it('returns a plan toward a target score', async () => {
      const result = await service.getScorePlan(domain(), 95)

      expect(result).toBeDefined()
    })
  })

  // ── Industries ──

  describe('getIndustryScore', () => {
    it('returns the aggregate industry score', async () => {
      const result = await service.getIndustryScore(industry())

      expect(result).toBeDefined()
    })
  })

  describe('getIndustryFactorScores', () => {
    it('returns the aggregate industry factor scores', async () => {
      const result = await service.getIndustryFactorScores(industry())

      expect(result).toBeDefined()
    })
  })

  // ── Portfolios ──

  describe('portfolio lifecycle', () => {
    let portfolioId

    it('creates a portfolio', async () => {
      const result = await service.createPortfolio(
        `FlowRunner e2e ${ Date.now() }`,
        'Created by the FlowRunner e2e test suite',
        'private'
      )

      expect(result).toHaveProperty('id')
      portfolioId = result.id
    })

    it('lists portfolios including the created one', async () => {
      const result = await service.listPortfolios()

      expect(result).toHaveProperty('entries')

      if (portfolioId) {
        expect(result.entries.some(entry => entry.id === portfolioId)).toBe(true)
      }
    })

    it('returns the portfolios dictionary', async () => {
      const result = await service.getPortfoliosDictionary({})

      expect(Array.isArray(result.items)).toBe(true)
      expect(result.cursor).toBeNull()
    })

    it('adds a company to the portfolio', async () => {
      if (!portfolioId) {
        console.log('Skipping addCompanyToPortfolio: no portfolio was created')

        return
      }

      await expect(service.addCompanyToPortfolio(portfolioId, domain())).resolves.toBeDefined()
    })

    it('lists the companies in the portfolio', async () => {
      if (!portfolioId) {
        console.log('Skipping getPortfolioCompanies: no portfolio was created')

        return
      }

      const result = await service.getPortfolioCompanies(portfolioId)

      expect(result).toHaveProperty('entries')
    })

    it('removes the company from the portfolio', async () => {
      if (!portfolioId) {
        console.log('Skipping removeCompanyFromPortfolio: no portfolio was created')

        return
      }

      await expect(service.removeCompanyFromPortfolio(portfolioId, domain())).resolves.toBeDefined()
    })
  })

  // ── Reports ──

  describe('generateReport', () => {
    it('queues a report', async () => {
      const reportType = testValues.reportType

      if (!reportType) {
        console.log('Skipping generateReport: testValues.reportType not set')

        return
      }

      const result = await service.generateReport(reportType, domain())

      expect(result).toBeDefined()
    })
  })

  // ── Errors ──

  describe('error handling', () => {
    it('throws a wrapped error for an unknown domain', async () => {
      await expect(
        service.getCompanyScore('this-domain-should-not-exist-flowrunner.test')
      ).rejects.toThrow(/SecurityScorecard API error/)
    })
  })
})
