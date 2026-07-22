'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-api-key'
const BASE = 'https://wiza.co/api'

describe('Wiza Service', () => {
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
    it('registers the API key config item', () => {
      expect(sandbox.getConfigItems()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'apiKey', required: true, type: 'STRING' }),
        ])
      )
    })

    it('stores the API key on the instance', () => {
      expect(service.apiKey).toBe(API_KEY)
    })
  })

  // ── Lists ──

  describe('createList', () => {
    it('sends the list name with bearer auth', async () => {
      mock.onPost(`${ BASE }/lists`).reply({ id: 'list_1', name: 'My List' })

      const result = await service.createList('My List')

      expect(result).toEqual({ id: 'list_1', name: 'My List' })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/lists`)

      expect(mock.history[0].headers).toMatchObject({
        'Authorization': `Bearer ${ API_KEY }`,
        'Content-Type': 'application/json',
      })

      expect(mock.history[0].body).toEqual({ name: 'My List' })
    })

    it('includes the callback URL when provided', async () => {
      mock.onPost(`${ BASE }/lists`).reply({ id: 'list_2' })

      await service.createList('My List', 'https://hooks.example.com/wiza')

      expect(mock.history[0].body).toEqual({
        name: 'My List',
        callback_url: 'https://hooks.example.com/wiza',
      })
    })

    it('maps contacts by profile URL, email, and name/company/domain', async () => {
      mock.onPost(`${ BASE }/lists`).reply({ id: 'list_3' })

      await service.createList('My List', null, [
        { profile_url: 'linkedin.com/in/john', email: 'ignored@example.com' },
        { email: 'jane@example.com' },
        { full_name: 'Bob Ross', company: 'Acme', domain: 'acme.com', extra: 'dropped' },
      ])

      expect(mock.history[0].body.items).toEqual([
        { profile_url: 'linkedin.com/in/john' },
        { email: 'jane@example.com' },
        { full_name: 'Bob Ross', company: 'Acme', domain: 'acme.com' },
      ])
    })

    it('omits items when the contacts array is empty', async () => {
      mock.onPost(`${ BASE }/lists`).reply({ id: 'list_4' })

      await service.createList('My List', undefined, [])

      expect(mock.history[0].body).toEqual({ name: 'My List' })
    })

    it('throws when a contact has no usable identifier', async () => {
      mock.onPost(`${ BASE }/lists`).reply({ id: 'list_5' })

      await expect(service.createList('My List', null, [{ full_name: 'Bob Ross' }])).rejects.toThrow(
        'Contact at index 0 is invalid'
      )

      expect(mock.history).toHaveLength(0)
    })
  })

  describe('getList', () => {
    it('requests the list by id', async () => {
      mock.onGet(`${ BASE }/lists/15`).reply({ type: 'list', data: { id: 15 } })

      const result = await service.getList('15')

      expect(result).toEqual({ type: 'list', data: { id: 15 } })
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/lists/15`)
    })

    it('throws when listId is missing', async () => {
      await expect(service.getList()).rejects.toThrow('The "listId" parameter is required and must be a string.')
    })

    it('throws when listId is not a string', async () => {
      await expect(service.getList(15)).rejects.toThrow('The "listId" parameter is required and must be a string.')
    })
  })

  describe('getListContacts', () => {
    it('requests contacts with the segment query', async () => {
      mock.onGet(`${ BASE }/lists/15/contacts`).reply({ type: 'contacts', data: [] })

      const result = await service.getListContacts('15', 'valid')

      expect(result).toEqual({ type: 'contacts', data: [] })
      expect(mock.history[0].query).toMatchObject({ segment: 'valid' })
    })

    it('throws when listId is missing', async () => {
      await expect(service.getListContacts(null, 'people')).rejects.toThrow('The "listId" parameter is required')
    })

    it('throws when the segment is not supported', async () => {
      await expect(service.getListContacts('15', 'everything')).rejects.toThrow(
        'The "segment" must be one of: people, valid, risky.'
      )
    })
  })

  // ── Individual reveals ──

  describe('startIndividualReveal', () => {
    it('reveals by LinkedIn profile URL', async () => {
      mock.onPost(`${ BASE }/individual_reveals`).reply({ type: 'individual_reveal', data: { id: 32 } })

      const result = await service.startIndividualReveal({ profile_url: 'linkedin.com/in/john' }, 'partial')

      expect(result).toEqual({ type: 'individual_reveal', data: { id: 32 } })

      expect(mock.history[0].body).toEqual({
        enrichment_level: 'partial',
        individual_reveal: { profile_url: 'linkedin.com/in/john' },
      })
    })

    it('reveals by email', async () => {
      mock.onPost(`${ BASE }/individual_reveals`).reply({ data: { id: 33 } })

      await service.startIndividualReveal({ email: 'jane@example.com' }, 'full')

      expect(mock.history[0].body.individual_reveal).toEqual({ email: 'jane@example.com' })
    })

    it('reveals by name, company, and domain', async () => {
      mock.onPost(`${ BASE }/individual_reveals`).reply({ data: { id: 34 } })

      await service.startIndividualReveal(
        { full_name: 'Bob Ross', company: 'Acme', domain: 'acme.com' },
        'none'
      )

      expect(mock.history[0].body.individual_reveal).toEqual({
        full_name: 'Bob Ross',
        company: 'Acme',
        domain: 'acme.com',
      })
    })

    it('adds email options and callback URL when provided', async () => {
      mock.onPost(`${ BASE }/individual_reveals`).reply({ data: { id: 35 } })

      await service.startIndividualReveal(
        { email: 'jane@example.com' },
        'phone',
        true,
        false,
        'https://hooks.example.com/reveal'
      )

      expect(mock.history[0].body).toEqual({
        enrichment_level: 'phone',
        individual_reveal: { email: 'jane@example.com' },
        email_options: { accept_work: true, accept_personal: false },
        callback_url: 'https://hooks.example.com/reveal',
      })
    })

    it('ignores non-boolean email option values', async () => {
      mock.onPost(`${ BASE }/individual_reveals`).reply({ data: { id: 36 } })

      await service.startIndividualReveal({ email: 'jane@example.com' }, 'partial', 'yes')

      expect(mock.history[0].body.email_options).toEqual({})
    })

    it('throws when the individual is not an object', async () => {
      await expect(service.startIndividualReveal('jane@example.com', 'partial')).rejects.toThrow(
        'The "individual" parameter must be provided and must be an object.'
      )
    })

    it('throws when the individual has no usable identifier', async () => {
      await expect(service.startIndividualReveal({ company: 'Acme' }, 'partial')).rejects.toThrow(
        'Invalid contact format.'
      )
    })
  })

  describe('getIndividualReveal', () => {
    it('requests the reveal by id', async () => {
      mock.onGet(`${ BASE }/individual_reveals/32`).reply({ data: { id: 32, is_complete: true } })

      const result = await service.getIndividualReveal('32')

      expect(result.data.is_complete).toBe(true)
      expect(mock.history[0].url).toBe(`${ BASE }/individual_reveals/32`)
    })

    it('throws when revealId is missing', async () => {
      await expect(service.getIndividualReveal()).rejects.toThrow('The "revealId" parameter is required')
    })
  })

  // ── Prospect search ──

  describe('searchProspects', () => {
    it('sends an empty filter set with the default size', async () => {
      mock.onPost(`${ BASE }/prospects/search`).reply({ data: { total: 0, profiles: [] } })

      const result = await service.searchProspects()

      expect(result).toEqual({ data: { total: 0, profiles: [] } })
      expect(mock.history[0].body).toEqual({ filters: {}, size: 10 })
    })

    it('wraps job titles and locations in Wiza filter objects', async () => {
      mock.onPost(`${ BASE }/prospects/search`).reply({ data: { total: 1 } })

      await service.searchProspects(['CEO', 'CTO'], ['New York'])

      expect(mock.history[0].body.filters.job_title).toEqual([
        { v: 'CEO', s: 'i' },
        { v: 'CTO', s: 'i' },
      ])

      expect(mock.history[0].body.filters.location).toEqual([{ v: 'New York', b: 'city', s: 'i' }])
    })

    it('passes scalar list filters through unchanged', async () => {
      mock.onPost(`${ BASE }/prospects/search`).reply({ data: {} })

      await service.searchProspects(
        undefined,
        undefined,
        ['CXO'],
        ['sales'],
        ['software'],
        ['11-50'],
        ['software'],
        ['private'],
        ['$1M-$10M'],
        ['10-20%'],
        ['sales:10-50']
      )

      expect(mock.history[0].body.filters).toMatchObject({
        job_title_level: ['CXO'],
        job_role: ['sales'],
        job_sub_role: ['software'],
        company_size: ['11-50'],
        company_industry: ['software'],
        company_type: ['private'],
        revenue: ['$1M-$10M'],
        company_annual_growth: ['10-20%'],
        department_size: ['sales:10-50'],
      })
    })

    it('splits company summary keywords and trims blanks', async () => {
      mock.onPost(`${ BASE }/prospects/search`).reply({ data: {} })

      await service.searchProspects(null, null, null, null, null, null, null, null, null, null, null, 'sales, , AI ')

      expect(mock.history[0].body.filters.company_summary).toEqual([
        { v: 'sales', s: 'i' },
        { v: 'AI', s: 'i' },
      ])
    })

    it('maps funding stage, type, and date labels to API values', async () => {
      mock.onPost(`${ BASE }/prospects/search`).reply({ data: {} })

      await service.searchProspects(
        null, null, null, null, null, null, null, null, null, null, null, null,
        ['Series A', 'Pre-Seed'],
        ['Equity', 'Convertible Note'],
        'Past 3 Months',
        '2015',
        '2020',
        25
      )

      expect(mock.history[0].body).toEqual({
        filters: {
          funding_stage: { t: 'last', v: ['series_a', 'pre_seed'] },
          funding_type: { t: 'last', v: ['equity', 'convertible_note'] },
          funding_date: { t: 'last', v: 'past_3_months' },
          year_founded_start: '2015',
          year_founded_end: '2020',
        },
        size: 25,
      })
    })
  })

  describe('createProspectList', () => {
    it('sends filters plus list settings', async () => {
      mock.onPost(`${ BASE }/prospects/create_prospect_list`).reply({ type: 'list', data: { id: 15 } })

      const result = await service.createProspectList(
        'Q1 Prospects',
        50,
        'partial',
        true,
        false,
        false,
        true,
        'https://hooks.example.com/list',
        ['VP Sales'],
        ['Toronto']
      )

      expect(result).toEqual({ type: 'list', data: { id: 15 } })
      expect(mock.history[0].url).toBe(`${ BASE }/prospects/create_prospect_list`)

      expect(mock.history[0].body).toEqual({
        filters: {
          job_title: [{ v: 'VP Sales', s: 'i' }],
          location: [{ v: 'Toronto', b: 'city', s: 'i' }],
        },
        list: {
          name: 'Q1 Prospects',
          max_profiles: 50,
          enrichment_level: 'partial',
          email_options: { accept_work: true, accept_personal: false, accept_generic: false },
          skip_duplicates: true,
          callback_url: 'https://hooks.example.com/list',
        },
      })
    })

    it('maps the advanced filter set', async () => {
      mock.onPost(`${ BASE }/prospects/create_prospect_list`).reply({ data: {} })

      await service.createProspectList(
        'List', 10, 'none', true, true, true, false, undefined,
        undefined, undefined,
        ['Director'], ['sales'], ['software'], ['51-200'], ['software'], ['public'],
        ['>$1B'], ['0-5%'], ['sales:5-10'], 'AI,B2B',
        ['Seed'], ['Grant'], 'Past Year', '2010', '2012'
      )

      expect(mock.history[0].body.filters).toEqual({
        job_title_level: ['Director'],
        job_role: ['sales'],
        job_sub_role: ['software'],
        company_size: ['51-200'],
        company_industry: ['software'],
        company_type: ['public'],
        revenue: ['>$1B'],
        company_annual_growth: ['0-5%'],
        department_size: ['sales:5-10'],
        company_summary: [{ v: 'AI', s: 'i' }, { v: 'B2B', s: 'i' }],
        funding_stage: { t: 'last', v: ['seed'] },
        funding_type: { t: 'last', v: ['grant'] },
        funding_date: { t: 'last', v: 'past_year' },
        year_founded_start: '2010',
        year_founded_end: '2012',
      })
    })
  })

  describe('continueProspectSearch', () => {
    it('sends only the list id by default', async () => {
      mock.onPost(`${ BASE }/prospects/continue_search`).reply({ data: { id: 15 } })

      await service.continueProspectSearch(15)

      expect(mock.history[0].body).toEqual({ id: 15 })
    })

    it('includes overrides when provided', async () => {
      mock.onPost(`${ BASE }/prospects/continue_search`).reply({ data: { id: 15 } })

      await service.continueProspectSearch(15, 100, 'https://hooks.example.com/continue')

      expect(mock.history[0].body).toEqual({
        id: 15,
        max_profiles: 100,
        callback_url: 'https://hooks.example.com/continue',
      })
    })
  })

  // ── Account ──

  describe('getCredits', () => {
    it('requests the credits endpoint', async () => {
      mock.onGet(`${ BASE }/meta/credits`).reply({ credits: { email_credits: 'unlimited' } })

      const result = await service.getCredits()

      expect(result).toEqual({ credits: { email_credits: 'unlimited' } })
      expect(mock.history[0].url).toBe(`${ BASE }/meta/credits`)
      expect(mock.history[0].headers).toMatchObject({ 'Authorization': `Bearer ${ API_KEY }` })
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('rethrows API errors', async () => {
      mock.onGet(`${ BASE }/meta/credits`).replyWithError({
        message: 'Unauthorized',
        status: 401,
        body: { message: 'Invalid API key' },
      })

      await expect(service.getCredits()).rejects.toThrow('Unauthorized')
    })

    it('rethrows errors from POST endpoints', async () => {
      mock.onPost(`${ BASE }/lists`).replyWithError({ message: 'Bad Request', status: 400 })

      await expect(service.createList('Broken')).rejects.toThrow('Bad Request')
    })
  })
})
