'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-api-key'
const BASE = 'https://api.securityscorecard.io'

describe('SecurityScorecard Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ apiKey: API_KEY })
    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()
  })

  afterEach(() => {
    mock.reset()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  const lastCall = () => mock.history[mock.history.length - 1]

  // ── Registration ──

  describe('service registration', () => {
    it('registers a single required API key config item', () => {
      expect(sandbox.getConfigItems()).toEqual([
        expect.objectContaining({
          name: 'apiKey',
          displayName: 'API Key',
          type: 'STRING',
          required: true,
          shared: false,
        }),
      ])
    })
  })

  // ── Companies ──

  describe('getCompanyScore', () => {
    it('sends an authenticated GET for the domain', async () => {
      mock.onGet(`${ BASE }/companies/example.com`).reply({ domain: 'example.com', grade: 'B', score: 85 })

      const result = await service.getCompanyScore('example.com')

      expect(result).toEqual({ domain: 'example.com', grade: 'B', score: 85 })
      expect(mock.history).toHaveLength(1)
      expect(lastCall().method).toBe('get')

      expect(lastCall().headers).toMatchObject({
        'Authorization': `Token ${ API_KEY }`,
        'Content-Type': 'application/json',
      })

      expect(lastCall().query).toEqual({})
    })

    it('url-encodes the domain', async () => {
      mock.onGet(`${ BASE }/companies/foo%20bar.com`).reply({ domain: 'foo bar.com' })

      await service.getCompanyScore('foo bar.com')

      expect(lastCall().url).toBe(`${ BASE }/companies/foo%20bar.com`)
    })

    it('throws a wrapped error using the nested API message', async () => {
      mock.onGet(`${ BASE }/companies/example.com`).replyWithError({
        message: 'Not Found',
        status: 404,
        body: { error: { message: 'Company not found' } },
      })

      await expect(service.getCompanyScore('example.com')).rejects.toThrow(
        'SecurityScorecard API error: Company not found'
      )
    })

    it('falls back to body.message when there is no nested error', async () => {
      mock.onGet(`${ BASE }/companies/example.com`).replyWithError({
        message: 'Unauthorized',
        statusCode: 401,
        body: { message: 'Invalid token' },
      })

      await expect(service.getCompanyScore('example.com')).rejects.toThrow(
        'SecurityScorecard API error: Invalid token'
      )
    })

    it('falls back to the raw error message when there is no body', async () => {
      mock.onGet(`${ BASE }/companies/example.com`).replyWithError({ message: 'Network timeout' })

      await expect(service.getCompanyScore('example.com')).rejects.toThrow(
        'SecurityScorecard API error: Network timeout'
      )
    })
  })

  describe('getCompanyFactorScores', () => {
    it('omits the date when not provided', async () => {
      mock.onGet(`${ BASE }/companies/example.com/factors`).reply({ entries: [] })

      await service.getCompanyFactorScores('example.com')

      expect(lastCall().query).toEqual({})
    })

    it('passes the date when provided', async () => {
      mock.onGet(`${ BASE }/companies/example.com/factors`).reply({ entries: [] })

      await service.getCompanyFactorScores('example.com', '2026-07-01')

      expect(lastCall().query).toEqual({ date: '2026-07-01' })
    })
  })

  describe('getCompanyHistoricalScores', () => {
    it('sends the from/to window', async () => {
      mock.onGet(`${ BASE }/companies/example.com/history/score`).reply({ entries: [] })

      await service.getCompanyHistoricalScores('example.com', '2026-06-01', '2026-07-01')

      expect(lastCall().query).toEqual({ from: '2026-06-01', to: '2026-07-01' })
    })

    it('drops empty date bounds', async () => {
      mock.onGet(`${ BASE }/companies/example.com/history/score`).reply({ entries: [] })

      await service.getCompanyHistoricalScores('example.com', '', null)

      expect(lastCall().query).toEqual({})
    })
  })

  describe('getCompanyHistoricalFactorScores', () => {
    it('requests the historical factors endpoint', async () => {
      mock.onGet(`${ BASE }/companies/example.com/history/factors/score`).reply({ entries: [] })

      await service.getCompanyHistoricalFactorScores('example.com', '2026-06-01', '2026-07-01')

      expect(lastCall().url).toBe(`${ BASE }/companies/example.com/history/factors/score`)
      expect(lastCall().query).toEqual({ from: '2026-06-01', to: '2026-07-01' })
    })
  })

  describe('getCompanyIssuesByType', () => {
    it('encodes both the domain and the issue type', async () => {
      mock.onGet(`${ BASE }/companies/example.com/issues/tlscert_expired`).reply({ entries: [] })

      const result = await service.getCompanyIssuesByType('example.com', 'tlscert_expired')

      expect(result).toEqual({ entries: [] })
      expect(lastCall().url).toBe(`${ BASE }/companies/example.com/issues/tlscert_expired`)
    })
  })

  describe('getCompanyInformation', () => {
    it('requests the information endpoint', async () => {
      mock.onGet(`${ BASE }/companies/example.com/information`).reply({ name: 'Example Inc.' })

      await expect(service.getCompanyInformation('example.com')).resolves.toEqual({
        name: 'Example Inc.',
      })
    })
  })

  // ── Portfolios ──

  describe('listPortfolios', () => {
    it('lists portfolios', async () => {
      mock.onGet(`${ BASE }/portfolios`).reply({ entries: [{ id: 'p1', name: 'Key Vendors' }] })

      const result = await service.listPortfolios()

      expect(result.entries).toHaveLength(1)
      expect(lastCall().method).toBe('get')
    })
  })

  describe('createPortfolio', () => {
    it('defaults privacy to private and drops empty fields', async () => {
      mock.onPost(`${ BASE }/portfolios`).reply({ id: 'p1' })

      await service.createPortfolio('Key Vendors')

      expect(lastCall().method).toBe('post')
      expect(lastCall().body).toEqual({ name: 'Key Vendors', privacy: 'private' })
    })

    it('sends the description and privacy when provided', async () => {
      mock.onPost(`${ BASE }/portfolios`).reply({ id: 'p1' })

      await service.createPortfolio('Key Vendors', 'Critical third parties', 'shared')

      expect(lastCall().body).toEqual({
        name: 'Key Vendors',
        description: 'Critical third parties',
        privacy: 'shared',
      })
    })
  })

  describe('getPortfolioCompanies', () => {
    it('requests the companies of a portfolio', async () => {
      mock.onGet(`${ BASE }/portfolios/p1/companies`).reply({ entries: [] })

      await service.getPortfolioCompanies('p1')

      expect(lastCall().url).toBe(`${ BASE }/portfolios/p1/companies`)
    })
  })

  describe('addCompanyToPortfolio', () => {
    it('sends a PUT with no body', async () => {
      mock.onPut(`${ BASE }/portfolios/p1/companies/example.com`).reply({ added: ['example.com'] })

      const result = await service.addCompanyToPortfolio('p1', 'example.com')

      expect(result).toEqual({ added: ['example.com'] })
      expect(lastCall().method).toBe('put')
      expect(lastCall().body).toBeUndefined()
    })
  })

  describe('removeCompanyFromPortfolio', () => {
    it('sends a DELETE', async () => {
      mock.onDelete(`${ BASE }/portfolios/p1/companies/example.com`).reply({ removed: ['example.com'] })

      await service.removeCompanyFromPortfolio('p1', 'example.com')

      expect(lastCall().method).toBe('delete')
      expect(lastCall().url).toBe(`${ BASE }/portfolios/p1/companies/example.com`)
    })
  })

  // ── Industries ──

  describe('getIndustryScore', () => {
    it('requests the industry score', async () => {
      mock.onGet(`${ BASE }/industries/technology/score`).reply({ industry: 'technology', score: 84 })

      await expect(service.getIndustryScore('technology')).resolves.toMatchObject({ score: 84 })
    })
  })

  describe('getIndustryFactorScores', () => {
    it('requests the industry factor scores', async () => {
      mock.onGet(`${ BASE }/industries/technology/factor/scores`).reply({ factors: [] })

      await service.getIndustryFactorScores('technology')

      expect(lastCall().url).toBe(`${ BASE }/industries/technology/factor/scores`)
    })
  })

  // ── Reports ──

  describe('generateReport', () => {
    it('posts a company-scoped report body', async () => {
      mock.onPost(`${ BASE }/reports/detailed`).reply({ id: 'r1', status: 'pending' })

      await service.generateReport('detailed', 'example.com')

      expect(lastCall().method).toBe('post')
      expect(lastCall().body).toEqual({ domain: 'example.com' })
    })

    it('posts a portfolio-scoped report body', async () => {
      mock.onPost(`${ BASE }/reports/portfolio`).reply({ id: 'r2' })

      await service.generateReport('portfolio', undefined, 'p1')

      expect(lastCall().body).toEqual({ portfolio_id: 'p1' })
    })

    it('sends an empty body when neither scope is provided', async () => {
      mock.onPost(`${ BASE }/reports/events-json`).reply({ id: 'r3' })

      await service.generateReport('events-json')

      expect(lastCall().body).toEqual({})
    })
  })

  describe('getScorePlan', () => {
    it('builds the by-target path', async () => {
      mock.onGet(`${ BASE }/companies/example.com/score-plans/by-target/90`).reply({ entries: [] })

      await service.getScorePlan('example.com', 90)

      expect(lastCall().url).toBe(`${ BASE }/companies/example.com/score-plans/by-target/90`)
    })
  })

  // ── Dictionaries ──

  describe('getPortfoliosDictionary', () => {
    const PORTFOLIOS = {
      entries: [
        { id: 'p1', name: 'Key Vendors', privacy: 'shared' },
        { id: 'p2', name: 'Suppliers' },
        { id: 'p3' },
      ],
    }

    it('maps portfolios to dictionary items', async () => {
      mock.onGet(`${ BASE }/portfolios`).reply(PORTFOLIOS)

      const result = await service.getPortfoliosDictionary({})

      expect(result).toEqual({
        items: [
          { label: 'Key Vendors', value: 'p1', note: 'shared' },
          { label: 'Suppliers', value: 'p2', note: undefined },
          { label: 'p3', value: 'p3', note: undefined },
        ],
        cursor: null,
      })
    })

    it('handles a null payload', async () => {
      mock.onGet(`${ BASE }/portfolios`).reply(PORTFOLIOS)

      const result = await service.getPortfoliosDictionary(null)

      expect(result.items).toHaveLength(3)
    })

    it('filters case-insensitively by search', async () => {
      mock.onGet(`${ BASE }/portfolios`).reply(PORTFOLIOS)

      const result = await service.getPortfoliosDictionary({ search: 'VEND' })

      expect(result.items).toEqual([{ label: 'Key Vendors', value: 'p1', note: 'shared' }])
    })

    it('returns an empty list when the API returns no entries', async () => {
      mock.onGet(`${ BASE }/portfolios`).reply({})

      await expect(service.getPortfoliosDictionary({})).resolves.toEqual({ items: [], cursor: null })
    })

    it('propagates API errors', async () => {
      mock.onGet(`${ BASE }/portfolios`).replyWithError({ message: 'Forbidden', status: 403 })

      await expect(service.getPortfoliosDictionary({})).rejects.toThrow(
        'SecurityScorecard API error: Forbidden'
      )
    })
  })
})
