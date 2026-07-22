'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-api-key'
const BASE = 'https://api.uplead.com/v2'

describe('UpLead Service', () => {
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
    it('registers the apiKey config item', () => {
      const configItems = sandbox.getConfigItems()

      expect(configItems).toHaveLength(1)

      expect(configItems[0]).toMatchObject({
        name: 'apiKey',
        displayName: 'API Key',
        type: 'STRING',
        required: true,
        shared: false,
      })
    })
  })

  // ── Enrich Person ──

  describe('enrichPerson', () => {
    it('posts to person-search with the auth header', async () => {
      mock.onPost(`${ BASE }/person-search`).reply({
        data: { first_name: 'Jane', last_name: 'Doe' },
        userInfo: { availableCredits: 950 },
      })

      const result = await service.enrichPerson('jane.doe@amazon.com')

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/person-search`)

      expect(mock.history[0].headers).toMatchObject({
        'Authorization': API_KEY,
        'Content-Type': 'application/json',
      })

      expect(result.data.first_name).toBe('Jane')
    })

    it('strips undefined fields from the body when only email is given', async () => {
      mock.onPost(`${ BASE }/person-search`).reply({ data: {} })

      await service.enrichPerson('jane.doe@amazon.com')

      expect(mock.history[0].body).toEqual({ email: 'jane.doe@amazon.com' })
    })

    it('sends name and domain when email is not provided', async () => {
      mock.onPost(`${ BASE }/person-search`).reply({ data: {} })

      await service.enrichPerson(undefined, 'Jane', 'Doe', 'amazon.com')

      expect(mock.history[0].body).toEqual({
        first_name: 'Jane',
        last_name: 'Doe',
        domain: 'amazon.com',
      })
    })

    it('drops empty-string values from the body', async () => {
      mock.onPost(`${ BASE }/person-search`).reply({ data: {} })

      await service.enrichPerson('', 'Jane', '', 'amazon.com')

      expect(mock.history[0].body).toEqual({ first_name: 'Jane', domain: 'amazon.com' })
    })

    it('sends an empty query object', async () => {
      mock.onPost(`${ BASE }/person-search`).reply({ data: {} })

      await service.enrichPerson('jane@doe.com')

      expect(mock.history[0].query).toEqual({})
    })

    it('throws using error.body.error.message', async () => {
      mock.onPost(`${ BASE }/person-search`).replyWithError({
        message: 'Bad Request',
        status: 400,
        body: { error: { message: 'Insufficient credits' } },
      })

      await expect(service.enrichPerson('a@b.com')).rejects.toThrow(
        'UpLead API error (400): Insufficient credits'
      )
    })

    it('throws using a string error body', async () => {
      mock.onPost(`${ BASE }/person-search`).replyWithError({
        message: 'Unauthorized',
        statusCode: 401,
        body: { error: 'Invalid API key' },
      })

      await expect(service.enrichPerson('a@b.com')).rejects.toThrow(
        'UpLead API error (401): Invalid API key'
      )
    })

    it('throws using error.body.message', async () => {
      mock.onPost(`${ BASE }/person-search`).replyWithError({
        message: 'Bad',
        status: 422,
        body: { message: 'Missing parameters' },
      })

      await expect(service.enrichPerson('a@b.com')).rejects.toThrow(
        'UpLead API error (422): Missing parameters'
      )
    })

    it('falls back to error.message without a status', async () => {
      mock.onPost(`${ BASE }/person-search`).replyWithError({ message: 'Network down' })

      await expect(service.enrichPerson('a@b.com')).rejects.toThrow('UpLead API error: Network down')
    })
  })

  // ── Enrich Company ──

  describe('enrichCompany', () => {
    it('posts to company-search with the domain', async () => {
      mock.onPost(`${ BASE }/company-search`).reply({
        data: { company_name: 'Amazon', domain: 'amazon.com' },
      })

      const result = await service.enrichCompany('amazon.com')

      expect(mock.history[0].url).toBe(`${ BASE }/company-search`)
      expect(mock.history[0].body).toEqual({ domain: 'amazon.com' })
      expect(result.data.company_name).toBe('Amazon')
    })

    it('sends the company name when no domain is given', async () => {
      mock.onPost(`${ BASE }/company-search`).reply({ data: {} })

      await service.enrichCompany(undefined, 'Amazon')

      expect(mock.history[0].body).toEqual({ company: 'Amazon' })
    })

    it('sends both domain and company when supplied', async () => {
      mock.onPost(`${ BASE }/company-search`).reply({ data: {} })

      await service.enrichCompany('amazon.com', 'Amazon')

      expect(mock.history[0].body).toEqual({ domain: 'amazon.com', company: 'Amazon' })
    })

    it('throws on API error', async () => {
      mock.onPost(`${ BASE }/company-search`).replyWithError({
        message: 'Not found',
        status: 404,
        body: { error: { message: 'No match' } },
      })

      await expect(service.enrichCompany('nope.com')).rejects.toThrow(
        'UpLead API error (404): No match'
      )
    })
  })

  // ── Search Contacts ──

  describe('searchContacts', () => {
    it('posts to prospector-search with only the domain', async () => {
      mock.onPost(`${ BASE }/prospector-search`).reply({
        data: { results: [], meta: { total: 0 } },
      })

      const result = await service.searchContacts('amazon.com')

      expect(mock.history[0].url).toBe(`${ BASE }/prospector-search`)
      expect(mock.history[0].body).toEqual({ domain: 'amazon.com' })
      expect(result.data.meta.total).toBe(0)
    })

    it.each([
      ['Manager', 'M'],
      ['Director', 'D'],
      ['Vice President', 'VP'],
      ['C-Level (C)', 'C'],
      ['C-Level (CX)', 'CX'],
    ])('maps management level %s to %s', async (label, code) => {
      mock.onPost(`${ BASE }/prospector-search`).reply({ data: {} })

      await service.searchContacts('amazon.com', undefined, undefined, label)

      expect(mock.history[0].body.management_level).toBe(code)
    })

    it('passes an unknown management level through unchanged', async () => {
      mock.onPost(`${ BASE }/prospector-search`).reply({ data: {} })

      await service.searchContacts('amazon.com', undefined, undefined, 'Owner')

      expect(mock.history[0].body.management_level).toBe('Owner')
    })

    it('passes a known job function through unchanged', async () => {
      mock.onPost(`${ BASE }/prospector-search`).reply({ data: {} })

      await service.searchContacts('amazon.com', undefined, 'marketing')

      expect(mock.history[0].body.job_function).toBe('marketing')
    })

    it('passes an unknown job function through unchanged', async () => {
      mock.onPost(`${ BASE }/prospector-search`).reply({ data: {} })

      await service.searchContacts('amazon.com', undefined, 'astronomy')

      expect(mock.history[0].body.job_function).toBe('astronomy')
    })

    it('sends every supported filter with snake_case keys', async () => {
      mock.onPost(`${ BASE }/prospector-search`).reply({ data: {} })

      await service.searchContacts(
        'amazon.com',
        'VP of Marketing',
        'marketing',
        'Vice President',
        'Seattle',
        'WA',
        'United States',
        2,
        25
      )

      expect(mock.history[0].body).toEqual({
        domain: 'amazon.com',
        title: 'VP of Marketing',
        job_function: 'marketing',
        management_level: 'VP',
        city: 'Seattle',
        state: 'WA',
        country: 'United States',
        page: 2,
        per_page: 25,
      })
    })

    it('omits null and empty filters', async () => {
      mock.onPost(`${ BASE }/prospector-search`).reply({ data: {} })

      await service.searchContacts('amazon.com', '', null, null, '', null, '', null, null)

      expect(mock.history[0].body).toEqual({ domain: 'amazon.com' })
    })

    it('throws on API error', async () => {
      mock.onPost(`${ BASE }/prospector-search`).replyWithError({
        message: 'Rate limited',
        status: 429,
        body: { error: { message: 'Too many requests' } },
      })

      await expect(service.searchContacts('amazon.com')).rejects.toThrow(
        'UpLead API error (429): Too many requests'
      )
    })
  })

  // ── Enrich Person and Company ──

  describe('enrichPersonAndCompany', () => {
    it('posts the email to combined-search', async () => {
      mock.onPost(`${ BASE }/combined-search`).reply({
        data: { first_name: 'Jane', company: { company_name: 'Amazon' } },
      })

      const result = await service.enrichPersonAndCompany('jane.doe@amazon.com')

      expect(mock.history[0].url).toBe(`${ BASE }/combined-search`)
      expect(mock.history[0].body).toEqual({ email: 'jane.doe@amazon.com' })
      expect(result.data.company.company_name).toBe('Amazon')
    })

    it('sends an empty body when no email is supplied', async () => {
      mock.onPost(`${ BASE }/combined-search`).reply({ data: {} })

      await service.enrichPersonAndCompany()

      expect(mock.history[0].body).toEqual({})
    })

    it('throws on API error', async () => {
      mock.onPost(`${ BASE }/combined-search`).replyWithError({
        message: 'Bad Request',
        status: 400,
        body: { error: { message: 'Invalid email' } },
      })

      await expect(service.enrichPersonAndCompany('nope')).rejects.toThrow(
        'UpLead API error (400): Invalid email'
      )
    })
  })

  // ── Credits ──

  describe('getCredits', () => {
    it('issues a GET to the credits endpoint without a body', async () => {
      mock.onGet(`${ BASE }/credits`).reply({ data: { email: 'a@b.com', credits: 950 } })

      const result = await service.getCredits()

      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/credits`)
      expect(mock.history[0].body).toBeUndefined()
      expect(mock.history[0].headers.Authorization).toBe(API_KEY)
      expect(result.data.credits).toBe(950)
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/credits`).replyWithError({
        message: 'Unauthorized',
        status: 401,
        body: { error: { message: 'Invalid API key' } },
      })

      await expect(service.getCredits()).rejects.toThrow('UpLead API error (401): Invalid API key')
    })
  })
})
