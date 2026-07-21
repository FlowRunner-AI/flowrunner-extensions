'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'sk_test_clearbit_key'
const EXPECTED_AUTH = `Basic ${ Buffer.from(`${ API_KEY }:`).toString('base64') }`

const PERSON_API = 'https://person.clearbit.com/v2'
const COMPANY_API = 'https://company.clearbit.com/v2'
const PROSPECTOR_API = 'https://prospector.clearbit.com/v1'
const DISCOVERY_API = 'https://discovery.clearbit.com/v1'
const REVEAL_API = 'https://reveal.clearbit.com/v1'

describe('Clearbit Service', () => {
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

  // ── Registration ──

  describe('service registration', () => {
    it('registers with correct config items', () => {
      expect(sandbox.getConfigItems()).toEqual([
        expect.objectContaining({
          name: 'apiKey',
          displayName: 'API Key',
          required: true,
          shared: false,
          type: 'STRING',
        }),
      ])
    })

    it('sends HTTP Basic auth and JSON content-type headers', async () => {
      mock.onGet(`${ PERSON_API }/people/find`).reply({ id: 'p1' })

      await service.enrichPerson('alex@example.com')

      expect(mock.history[0].headers).toMatchObject({
        'Authorization': EXPECTED_AUTH,
        'Content-Type': 'application/json',
      })
    })
  })

  // ── Enrichment ──

  describe('enrichPerson', () => {
    it('hits the person subdomain with email only', async () => {
      mock.onGet(`${ PERSON_API }/people/find`).reply({ id: 'p1', name: { fullName: 'Alex' } })

      const result = await service.enrichPerson('alex@example.com')

      expect(result).toEqual({ id: 'p1', name: { fullName: 'Alex' } })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ PERSON_API }/people/find`)
      expect(mock.history[0].query).toEqual({ email: 'alex@example.com' })
    })

    it('includes webhook_only as string "true" when webhookOnly is set', async () => {
      mock.onGet(`${ PERSON_API }/people/find`).reply({ id: 'p1' })

      await service.enrichPerson('alex@example.com', true)

      expect(mock.history[0].query).toEqual({
        email: 'alex@example.com',
        webhook_only: 'true',
      })
    })

    it('omits webhook_only when webhookOnly is false', async () => {
      mock.onGet(`${ PERSON_API }/people/find`).reply({ id: 'p1' })

      await service.enrichPerson('alex@example.com', false)

      expect(mock.history[0].query).toEqual({ email: 'alex@example.com' })
    })

    it('returns a pending payload on HTTP 202', async () => {
      mock.onGet(`${ PERSON_API }/people/find`).replyWithError({
        message: 'Accepted',
        status: 202,
      })

      const result = await service.enrichPerson('alex@example.com')

      expect(result).toEqual({
        pending: true,
        status: 202,
        message: 'Clearbit is still resolving this lookup. Retry the request in a few seconds.',
      })
    })

    it('wraps API errors with a structured message', async () => {
      mock.onGet(`${ PERSON_API }/people/find`).replyWithError({
        message: 'Ignore',
        status: 404,
        body: { error: { message: 'Unknown record', type: 'unknown_record' } },
      })

      await expect(service.enrichPerson('nope@example.com')).rejects.toThrow(
        'Clearbit API error: Unknown record | type=unknown_record | status=404'
      )
    })

    it('falls back to error.message when no structured body is present', async () => {
      mock.onGet(`${ PERSON_API }/people/find`).replyWithError({ message: 'Network down' })

      await expect(service.enrichPerson('a@b.com')).rejects.toThrow('Clearbit API error: Network down')
    })
  })

  describe('enrichCompany', () => {
    it('hits the company subdomain with domain only', async () => {
      mock.onGet(`${ COMPANY_API }/companies/find`).reply({ id: 'c1', name: 'Clearbit' })

      const result = await service.enrichCompany('clearbit.com')

      expect(result).toEqual({ id: 'c1', name: 'Clearbit' })
      expect(mock.history[0].url).toBe(`${ COMPANY_API }/companies/find`)
      expect(mock.history[0].query).toEqual({ domain: 'clearbit.com' })
    })

    it('includes webhook_only when requested', async () => {
      mock.onGet(`${ COMPANY_API }/companies/find`).reply({ id: 'c1' })

      await service.enrichCompany('clearbit.com', true)

      expect(mock.history[0].query).toEqual({ domain: 'clearbit.com', webhook_only: 'true' })
    })

    it('returns a pending payload on HTTP 202', async () => {
      mock.onGet(`${ COMPANY_API }/companies/find`).replyWithError({ message: 'Accepted', statusCode: 202 })

      const result = await service.enrichCompany('clearbit.com')

      expect(result).toMatchObject({ pending: true, status: 202 })
    })

    it('wraps API errors', async () => {
      mock.onGet(`${ COMPANY_API }/companies/find`).replyWithError({
        message: 'Ignore',
        status: 422,
        body: { error: { message: 'Invalid domain' } },
      })

      await expect(service.enrichCompany('bad')).rejects.toThrow(
        'Clearbit API error: Invalid domain | status=422'
      )
    })
  })

  describe('enrichCombined', () => {
    it('hits the person subdomain combined/find endpoint', async () => {
      mock.onGet(`${ PERSON_API }/combined/find`).reply({ person: { id: 'p1' }, company: { id: 'c1' } })

      const result = await service.enrichCombined('alex@example.com')

      expect(result).toEqual({ person: { id: 'p1' }, company: { id: 'c1' } })
      expect(mock.history[0].url).toBe(`${ PERSON_API }/combined/find`)
      expect(mock.history[0].query).toEqual({ email: 'alex@example.com' })
    })

    it('includes webhook_only when requested', async () => {
      mock.onGet(`${ PERSON_API }/combined/find`).reply({ person: {}, company: {} })

      await service.enrichCombined('alex@example.com', true)

      expect(mock.history[0].query).toEqual({ email: 'alex@example.com', webhook_only: 'true' })
    })

    it('wraps API errors', async () => {
      mock.onGet(`${ PERSON_API }/combined/find`).replyWithError({ message: 'Boom' })

      await expect(service.enrichCombined('a@b.com')).rejects.toThrow('Clearbit API error: Boom')
    })
  })

  // ── Prospecting ──

  describe('findContacts', () => {
    it('hits the prospector subdomain with domain only', async () => {
      mock.onGet(`${ PROSPECTOR_API }/people/search`).reply({ page: 1, results: [] })

      const result = await service.findContacts('clearbit.com')

      expect(result).toEqual({ page: 1, results: [] })
      expect(mock.history[0].url).toBe(`${ PROSPECTOR_API }/people/search`)
      expect(mock.history[0].query).toEqual({ domain: 'clearbit.com' })
    })

    it('joins roles and names arrays and maps seniority labels', async () => {
      mock.onGet(`${ PROSPECTOR_API }/people/search`).reply({ results: [] })

      await service.findContacts(
        'clearbit.com',
        ['sales', 'engineering'],
        'Director',
        'Head of Sales',
        ['Jamie Rivera', 'Alex Doe'],
        '2'
      )

      expect(mock.history[0].query).toEqual({
        domain: 'clearbit.com',
        role: 'sales,engineering',
        seniority: 'director',
        title: 'Head of Sales',
        name: 'Jamie Rivera,Alex Doe',
        page: '2',
      })
    })

    it('maps each known seniority label to its API value', async () => {
      mock.onGet(`${ PROSPECTOR_API }/people/search`).reply({ results: [] })

      await service.findContacts('clearbit.com', undefined, 'Executive')
      expect(mock.history[0].query.seniority).toBe('executive')

      mock.reset()
      mock.onGet(`${ PROSPECTOR_API }/people/search`).reply({ results: [] })
      await service.findContacts('clearbit.com', undefined, 'Manager')
      expect(mock.history[0].query.seniority).toBe('manager')
    })

    it('passes through an unknown seniority value unchanged', async () => {
      mock.onGet(`${ PROSPECTOR_API }/people/search`).reply({ results: [] })

      await service.findContacts('clearbit.com', undefined, 'vp')

      expect(mock.history[0].query.seniority).toBe('vp')
    })

    it('omits role and name when given empty arrays', async () => {
      mock.onGet(`${ PROSPECTOR_API }/people/search`).reply({ results: [] })

      await service.findContacts('clearbit.com', [], undefined, undefined, [])

      expect(mock.history[0].query).toEqual({ domain: 'clearbit.com' })
    })

    it('wraps API errors', async () => {
      mock.onGet(`${ PROSPECTOR_API }/people/search`).replyWithError({
        message: 'Ignore',
        status: 403,
        body: { error: { message: 'Prospector unavailable', type: 'forbidden' } },
      })

      await expect(service.findContacts('clearbit.com')).rejects.toThrow(
        'Clearbit API error: Prospector unavailable | type=forbidden | status=403'
      )
    })
  })

  // ── Discovery ──

  describe('searchCompanies', () => {
    it('hits the discovery subdomain with query only', async () => {
      mock.onGet(`${ DISCOVERY_API }/companies/search`).reply({ total: 0, results: [] })

      const result = await service.searchCompanies('tag:SaaS')

      expect(result).toEqual({ total: 0, results: [] })
      expect(mock.history[0].url).toBe(`${ DISCOVERY_API }/companies/search`)
      expect(mock.history[0].query).toEqual({ query: 'tag:SaaS' })
    })

    it('includes page and limit when provided', async () => {
      mock.onGet(`${ DISCOVERY_API }/companies/search`).reply({ results: [] })

      await service.searchCompanies('tag:SaaS employees:>100', 'eyJvIjoxfQ', 50)

      expect(mock.history[0].query).toEqual({
        query: 'tag:SaaS employees:>100',
        page: 'eyJvIjoxfQ',
        limit: 50,
      })
    })

    it('wraps API errors', async () => {
      mock.onGet(`${ DISCOVERY_API }/companies/search`).replyWithError({
        message: 'Ignore',
        status: 400,
        body: { error: { message: 'Bad query' } },
      })

      await expect(service.searchCompanies('???')).rejects.toThrow(
        'Clearbit API error: Bad query | status=400'
      )
    })
  })

  // ── Reveal ──

  describe('revealCompany', () => {
    it('hits the reveal subdomain with the ip param', async () => {
      mock.onGet(`${ REVEAL_API }/companies/find`).reply({ ip: '104.193.168.24', domain: 'clearbit.com' })

      const result = await service.revealCompany('104.193.168.24')

      expect(result).toEqual({ ip: '104.193.168.24', domain: 'clearbit.com' })
      expect(mock.history[0].url).toBe(`${ REVEAL_API }/companies/find`)
      expect(mock.history[0].query).toEqual({ ip: '104.193.168.24' })
    })

    it('returns a pending payload on HTTP 202', async () => {
      mock.onGet(`${ REVEAL_API }/companies/find`).replyWithError({ message: 'Accepted', status: 202 })

      const result = await service.revealCompany('104.193.168.24')

      expect(result).toMatchObject({ pending: true, status: 202 })
    })

    it('wraps API errors, falling back to error.body.message', async () => {
      mock.onGet(`${ REVEAL_API }/companies/find`).replyWithError({
        message: 'Ignore',
        status: 500,
        body: { message: 'Reveal unavailable' },
      })

      await expect(service.revealCompany('1.2.3.4')).rejects.toThrow(
        'Clearbit API error: Reveal unavailable | status=500'
      )
    })
  })
})
