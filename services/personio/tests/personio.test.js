'use strict'

const { createSandbox } = require('../../../service-sandbox')

const BASE = 'https://api.personio.de'
const V1_AUTH_URL = `${ BASE }/v1/auth`
const V2_AUTH_URL = `${ BASE }/v2/auth/token`

const CONFIG = {
  clientId: 'client-id',
  clientSecret: 'client-secret',
  recruitingApiToken: 'recruiting-token',
  recruitingCompanyId: '9001',
}

const V1_TOKEN = 'v1-jwt-token'
const V2_TOKEN = 'papi-v2-token'

const PARTNER_HEADERS = {
  'X-Personio-Partner-ID': 'BACKENDLESS',
  'X-Personio-App-ID': 'FLOWRUNNER',
  'Personio-Partner-ID': 'BACKENDLESS',
  'Personio-App-ID': 'FLOWRUNNER',
}

const FRIENDLY = {
  invalidCredentials: /Personio rejected the credentials/,
  insufficientScope: /missing access to the data this action needs/,
  notFound: /Personio could not find that record/,
  rateLimited: /Personio is throttling the request/,
  attributeNotAllowed: /That field is not enabled on this Personio credential/,
  missingRecruitingToken: /needs the Recruiting Token/,
  missingRecruitingCompanyId: /needs the Recruiting Company ID/,
}

// Builds a brand-new sandbox + service instance. jest.resetModules() clears the
// require cache so the service entry file re-runs addService() against it.
function buildSandbox(config = CONFIG) {
  jest.resetModules()

  const sandbox = createSandbox(config)
  require('../src/index.js')

  return sandbox
}

describe('Personio Service', () => {
  let sandbox
  let service
  let mock
  // Tests that need a second, independently-configured instance build their own
  // sandbox, which swaps global.Flowrunner. Restore the main one afterwards.
  let mainFlowrunner

  // Both auth tokens are cached on the instance for ~24h, so priming them once
  // keeps every later assertion looking at the real request as history[0].
  async function primeTokens() {
    mock.onPost(V1_AUTH_URL).reply({ data: { token: V1_TOKEN } })
    mock.onPost(V2_AUTH_URL).reply({ access_token: V2_TOKEN, expires_in: 86400 })
    mock.onGet(`${ BASE }/v1/company/employees/1/absences/balance`).reply({ data: [] })
    mock.onGet(`${ BASE }/v2/persons`).reply({ _data: [] })

    await service.getTimeOffBalance('1')
    await service.listPeopleDictionary({})

    mock.reset()
  }

  beforeAll(async () => {
    sandbox = buildSandbox()
    service = sandbox.getService()
    mock = sandbox.getRequestMock()

    await primeTokens()

    mainFlowrunner = global.Flowrunner
  })

  afterEach(() => {
    global.Flowrunner = mainFlowrunner
    mock.reset()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Registration ──

  describe('service registration', () => {
    it('registers the four connection config items in order', () => {
      const configItems = sandbox.getConfigItems()

      expect(configItems.map(item => item.name)).toEqual([
        'clientId',
        'clientSecret',
        'recruitingApiToken',
        'recruitingCompanyId',
      ])
    })

    it('marks the credential pair required and the recruiting pair optional', () => {
      const configItems = sandbox.getConfigItems()
      const byName = Object.fromEntries(configItems.map(item => [item.name, item]))

      expect(byName.clientId).toEqual(
        expect.objectContaining({ required: true, shared: false, type: 'STRING', displayName: 'Client ID' })
      )

      expect(byName.clientSecret).toEqual(expect.objectContaining({ required: true, shared: false }))
      expect(byName.recruitingApiToken).toEqual(expect.objectContaining({ required: false, shared: false }))
      expect(byName.recruitingCompanyId).toEqual(expect.objectContaining({ required: false, shared: false }))
      expect(configItems.every(item => item.order === undefined)).toBe(true)
    })
  })

  // ── Authentication ──

  describe('authentication', () => {
    it('exchanges the credentials for a v1 token and attaches it as a bearer token', async () => {
      const fresh = buildSandbox()
      const freshService = fresh.getService()
      const freshMock = fresh.getRequestMock()

      freshMock.onPost(V1_AUTH_URL).reply({ data: { token: V1_TOKEN } })
      freshMock.onGet(`${ BASE }/v1/company/employees/7/absences/balance`).reply({ data: [] })

      await freshService.getTimeOffBalance('7')

      expect(freshMock.history[0].method).toBe('post')
      expect(freshMock.history[0].url).toBe(V1_AUTH_URL)

      expect(freshMock.history[0].headers).toMatchObject({
        'Content-Type': 'application/x-www-form-urlencoded',
      })

      expect(freshMock.history[0].body).toBe('client_id=client-id&client_secret=client-secret')

      expect(freshMock.history[1].headers).toMatchObject({
        Authorization: `Bearer ${ V1_TOKEN }`,
        Accept: 'application/json',
        ...PARTNER_HEADERS,
      })

      fresh.cleanup()
    })

    it('exchanges the credentials for a v2 token with the client_credentials grant', async () => {
      const fresh = buildSandbox()
      const freshService = fresh.getService()
      const freshMock = fresh.getRequestMock()

      freshMock.onPost(V2_AUTH_URL).reply({ access_token: V2_TOKEN, expires_in: 3600 })
      freshMock.onGet(`${ BASE }/v2/persons`).reply({ _data: [] })

      await freshService.listPeopleDictionary({})

      expect(freshMock.history[0].url).toBe(V2_AUTH_URL)

      expect(freshMock.history[0].body).toBe(
        'grant_type=client_credentials&client_id=client-id&client_secret=client-secret'
      )

      expect(freshMock.history[1].headers).toMatchObject({ Authorization: `Bearer ${ V2_TOKEN }` })

      fresh.cleanup()
    })

    it('caches the v2 token across calls', async () => {
      const fresh = buildSandbox()
      const freshService = fresh.getService()
      const freshMock = fresh.getRequestMock()

      freshMock.onPost(V2_AUTH_URL).reply({ access_token: V2_TOKEN, expires_in: 3600 })
      freshMock.onGet(`${ BASE }/v2/persons`).reply({ _data: [] })

      await freshService.listPeopleDictionary({})
      await freshService.listPeopleDictionary({})

      expect(freshMock.history.filter(call => call.url === V2_AUTH_URL)).toHaveLength(1)

      fresh.cleanup()
    })

    it('reports a credential problem when the v1 auth response has no token', async () => {
      const fresh = buildSandbox()
      const freshMock = fresh.getRequestMock()

      freshMock.onPost(V1_AUTH_URL).reply({ data: {} })

      await expect(fresh.getService().getTimeOffBalance('1')).rejects.toThrow(FRIENDLY.invalidCredentials)

      fresh.cleanup()
    })

    it('reports a credential problem when the v2 auth response has no access token', async () => {
      const fresh = buildSandbox()
      const freshMock = fresh.getRequestMock()

      freshMock.onPost(V2_AUTH_URL).reply({})

      await expect(fresh.getService().listPeopleDictionary({})).rejects.toThrow(FRIENDLY.invalidCredentials)

      fresh.cleanup()
    })

    it('reports a credential problem when the auth call itself fails', async () => {
      const fresh = buildSandbox()
      const freshMock = fresh.getRequestMock()

      freshMock.onPost(V2_AUTH_URL).replyWithError({ message: 'Unauthorized', status: 401 })

      await expect(fresh.getService().findPeople()).rejects.toThrow(FRIENDLY.invalidCredentials)

      fresh.cleanup()
    })
  })

  // ── Error mapping ──

  describe('error mapping', () => {
    it.each([
      [401, FRIENDLY.invalidCredentials],
      [403, FRIENDLY.insufficientScope],
      [404, FRIENDLY.notFound],
      [429, FRIENDLY.rateLimited],
    ])('translates HTTP %i into a plain-English message', async (status, matcher) => {
      mock.onGet(`${ BASE }/v2/legal-entities`).replyWithError({ message: 'boom', status })

      await expect(service.findLegalEntities()).rejects.toThrow(matcher)
    })

    it('translates a disallowed attribute message', async () => {
      mock.onGet(`${ BASE }/v2/legal-entities`).replyWithError({
        message: 'The attribute salary is not allowed for this credential',
        status: 400,
      })

      await expect(service.findLegalEntities()).rejects.toThrow(FRIENDLY.attributeNotAllowed)
    })

    it('surfaces other validation messages verbatim rather than blaming the credentials', async () => {
      mock.onGet(`${ BASE }/v2/legal-entities`).replyWithError({
        message: 'invalid request: cursor is malformed',
        status: 400,
      })

      await expect(service.findLegalEntities()).rejects.toThrow(
        'Personio error: invalid request: cursor is malformed'
      )
    })

    it('unwraps a nested error object message', async () => {
      mock.onGet(`${ BASE }/v2/legal-entities`).replyWithError({
        message: { error: { message: 'Something specific went wrong' } },
        status: 400,
      })

      await expect(service.findLegalEntities()).rejects.toThrow(
        'Personio error: Something specific went wrong'
      )
    })
  })

  // ── Test Connection ──

  describe('testConnection', () => {
    it('reports both lanes ok, the employee count and the recruiting lane as configured', async () => {
      mock.onGet(`${ BASE }/v1/company/employees`).reply({ data: [], metadata: { total_elements: 142 } })
      mock.onGet(`${ BASE }/v2/persons`).reply({ _data: [] })

      const result = await service.testConnection()

      expect(result).toEqual({
        legacyLane: 'ok',
        modernLane: 'ok',
        recruitingLane:
          'configured (will be exercised on the first Create Candidate or Upload Applicant Document call)',
        employeeCount: 142,
        partnerId: 'BACKENDLESS',
        appId: 'FLOWRUNNER',
      })

      expect(mock.history[0].query).toEqual({ limit: 1, offset: 0 })
      expect(mock.history[1].query).toEqual({ limit: 1 })
    })

    it('captures a per-lane failure without throwing', async () => {
      mock.onGet(`${ BASE }/v1/company/employees`).replyWithError({ message: 'nope', status: 403 })
      mock.onGet(`${ BASE }/v2/persons`).reply({ _data: [] })

      const result = await service.testConnection()

      expect(result.legacyLane).toMatch(FRIENDLY.insufficientScope)
      expect(result.modernLane).toBe('ok')
      expect(result.employeeCount).toBeNull()
    })

    it('skips the recruiting lane when no recruiting token is configured', async () => {
      const fresh = buildSandbox({ clientId: 'a', clientSecret: 'b' })
      const freshMock = fresh.getRequestMock()

      freshMock.onPost(V1_AUTH_URL).reply({ data: { token: V1_TOKEN } })
      freshMock.onPost(V2_AUTH_URL).reply({ access_token: V2_TOKEN, expires_in: 3600 })
      freshMock.onGet(`${ BASE }/v1/company/employees`).reply({ data: [] })
      freshMock.onGet(`${ BASE }/v2/persons`).reply({ _data: [] })

      const result = await fresh.getService().testConnection()

      expect(result.recruitingLane).toMatch(/^skipped \(no Recruiting Token set/)

      fresh.cleanup()
    })

    it('flags a recruiting token without a company id as incomplete', async () => {
      const fresh = buildSandbox({ clientId: 'a', clientSecret: 'b', recruitingApiToken: 'tok' })
      const freshMock = fresh.getRequestMock()

      freshMock.onPost(V1_AUTH_URL).reply({ data: { token: V1_TOKEN } })
      freshMock.onPost(V2_AUTH_URL).reply({ access_token: V2_TOKEN, expires_in: 3600 })
      freshMock.onGet(`${ BASE }/v1/company/employees`).reply({ data: [] })
      freshMock.onGet(`${ BASE }/v2/persons`).reply({ _data: [] })

      const result = await fresh.getService().testConnection()

      expect(result.recruitingLane).toMatch(/^incomplete/)

      fresh.cleanup()
    })
  })

  // ── Dictionaries ──

  describe('listPeopleDictionary', () => {
    const PEOPLE = {
      _data: [
        {
          id: 1,
          first_name: 'Alexander',
          last_name: 'Bergmann',
          email: 'alexander@example.com',
          department: { name: 'Engineering' },
          office: { name: 'Berlin' },
        },
        { id: 2, preferred_name: 'Bea', first_name: 'Beatrix', last_name: 'Kiddo', email: 'bea@example.com' },
        { id: 3 },
      ],
      _meta: { links: { next: 'https://api.personio.de/v2/persons?limit=50&cursor=abc%3D%3D' } },
    }

    it('maps people to dictionary items and extracts the next cursor', async () => {
      mock.onGet(`${ BASE }/v2/persons`).reply(PEOPLE)

      const result = await service.listPeopleDictionary({})

      expect(mock.history[0].query).toEqual({ limit: 50 })

      expect(result.items).toEqual([
        {
          label: 'Alexander Bergmann',
          value: '1',
          note: 'Engineering · Berlin · alexander@example.com',
        },
        { label: 'Bea', value: '2', note: 'bea@example.com' },
        { label: 'Person 3', value: '3', note: '' },
      ])

      expect(result.cursor).toBe('abc==')
    })

    it('filters on name and email, case-insensitively', async () => {
      mock.onGet(`${ BASE }/v2/persons`).reply(PEOPLE)

      const result = await service.listPeopleDictionary({ search: 'BERGMANN' })

      expect(result.items.map(item => item.value)).toEqual(['1'])
    })

    it('forwards a cursor and copes with a null payload and a missing list', async () => {
      mock.onGet(`${ BASE }/v2/persons`).reply({})

      const first = await service.listPeopleDictionary(null)

      expect(first).toEqual({ items: [], cursor: null })

      await service.listPeopleDictionary({ cursor: 'next-page' })

      expect(mock.history[1].query).toEqual({ limit: 50, cursor: 'next-page' })
    })

    it('reads the legacy data key when _data is absent', async () => {
      mock.onGet(`${ BASE }/v2/persons`).reply({ data: [{ id: 9, first_name: 'Nine', last_name: '' }] })

      const result = await service.listPeopleDictionary({})

      expect(result.items).toEqual([{ label: 'Nine', value: '9', note: '' }])
    })
  })

  describe('listAbsenceTypesDictionary', () => {
    const TYPES = {
      data: [
        { attributes: { id: 3465520, name: 'Paid holidays', unit: 'day', category: 'paid_vacation', approval_required: true, id_v2: 'uuid-1' } },
        { attributes: { id: 42, name: 'Overtime reduction', unit: 'hour', category: 'other' } },
      ],
    }

    it('maps v1 time-off types with unit and category notes', async () => {
      mock.onGet(`${ BASE }/v1/company/time-off-types`).reply(TYPES)

      const result = await service.listAbsenceTypesDictionary({})

      expect(mock.history[0].query).toEqual({ limit: 200 })

      expect(result).toEqual({
        items: [
          { label: 'Paid holidays', value: '3465520', note: 'Day-based · paid_vacation · Needs approval' },
          { label: 'Overtime reduction', value: '42', note: 'Hour-based · other' },
        ],
        cursor: null,
      })
    })

    it('filters by name', async () => {
      mock.onGet(`${ BASE }/v1/company/time-off-types`).reply(TYPES)

      const result = await service.listAbsenceTypesDictionary({ search: 'overtime' })

      expect(result.items.map(item => item.value)).toEqual(['42'])
    })
  })

  describe('listDocumentCategoriesDictionary', () => {
    it('maps categories from either attribute shape and filters by name', async () => {
      const payload = { data: [{ id: 5, attributes: { name: 'Contract' } }, { id: 6, name: 'Payslip' }, { id: 7 }] }
      mock.onGet(`${ BASE }/v1/company/document-categories`).reply(payload)

      const all = await service.listDocumentCategoriesDictionary({})

      expect(all.items).toEqual([
        { label: 'Contract', value: '5', note: '' },
        { label: 'Payslip', value: '6', note: '' },
        { label: 'Category 7', value: '7', note: '' },
      ])

      mock.onGet(`${ BASE }/v1/company/document-categories`).reply(payload)

      const filtered = await service.listDocumentCategoriesDictionary({ search: 'pay' })

      expect(filtered.items.map(item => item.value)).toEqual(['6'])
    })
  })

  describe('listLegalEntitiesDictionary', () => {
    it('maps legal entities with their country as the note', async () => {
      mock.onGet(`${ BASE }/v2/legal-entities`).reply({
        _data: [{ id: 'e_1', name: 'Acme GmbH', country: 'Germany' }, { id: 'e_2', country_code: 'FR' }],
      })

      const result = await service.listLegalEntitiesDictionary({ search: 'acme' })

      expect(mock.history[0].query).toEqual({ limit: 100 })
      expect(result.items).toEqual([{ label: 'Acme GmbH', value: 'e_1', note: 'Germany' }])
    })
  })

  describe('employee-attribute derived dictionaries', () => {
    function employeePages() {
      return callRecord => {
        if (callRecord.query.offset === 0) {
          return {
            metadata: { total_elements: 3 },
            data: [
              { attributes: { department: { value: { attributes: { id: 42, name: 'Engineering' } } } } },
              { attributes: { department: { value: { attributes: { id: 42, name: 'Engineering' } } } } },
              { attributes: { department: { value: { id: 7, name: 'Design' } } } },
            ],
          }
        }

        return { data: [] }
      }
    }

    it('collects departments across employees, counting headcount', async () => {
      mock.onGet(`${ BASE }/v1/company/employees`).replyWith(employeePages())

      const result = await service.listOrgUnitsDictionary({})

      expect(mock.history[0].query).toEqual({ limit: 200, offset: 0, 'attributes[]': 'department' })

      expect(result).toEqual({
        items: [
          { label: 'Design', value: '7', note: '1 person' },
          { label: 'Engineering', value: '42', note: '2 people' },
        ],
        cursor: null,
      })
    })

    it('stops paging when a page comes back empty', async () => {
      mock.onGet(`${ BASE }/v1/company/employees`).replyWith(callRecord =>
        callRecord.query.offset === 0
          ? { data: [{ attributes: { office: { value: { id: 1, name: 'Berlin HQ' } } } }] }
          : { data: [] }
      )

      const result = await service.listWorkplacesDictionary({})

      expect(mock.history).toHaveLength(2)
      expect(result.items).toEqual([{ label: 'Berlin HQ', value: '1', note: '1 person' }])
    })

    it('handles array-valued attributes such as cost centers and skips records without an id', async () => {
      mock.onGet(`${ BASE }/v1/company/employees`).replyWith(callRecord =>
        callRecord.query.offset === 0
          ? {
            metadata: { total_elements: 1 },
            data: [
              {
                attributes: {
                  cost_centers: {
                    value: [{ id: 77, name: 'R&D Berlin' }, { id: 78 }, { name: 'No id' }],
                  },
                },
              },
            ],
          }
          : { data: [] }
      )

      const result = await service.listCostCentersDictionary({})

      expect(result.items).toEqual([
        { label: 'Item 78', value: '78', note: '1 person' },
        { label: 'R&D Berlin', value: '77', note: '1 person' },
      ])
    })

    it('filters the derived list by search text', async () => {
      mock.onGet(`${ BASE }/v1/company/employees`).replyWith(employeePages())

      const result = await service.listOrgUnitsDictionary({ search: 'design' })

      expect(result.items.map(item => item.value)).toEqual(['7'])
    })
  })

  describe('listProjectsDictionary', () => {
    it('labels projects by state and marks subprojects', async () => {
      mock.onGet(`${ BASE }/v2/projects`).reply({
        _data: [
          { id: 'p_1', name: 'Q3 Migration' },
          { id: 'p_2', name: 'Legacy', active: false, parent_id: 'p_1' },
          { id: 'p_3' },
        ],
      })

      const result = await service.listProjectsDictionary({})

      expect(mock.history[0].query).toEqual({ limit: 50 })

      expect(result).toEqual({
        items: [
          { label: 'Q3 Migration', value: 'p_1', note: 'Active' },
          { label: 'Legacy', value: 'p_2', note: 'Archived · Subproject' },
          { label: 'Project p_3', value: 'p_3', note: 'Active' },
        ],
        cursor: null,
      })
    })

    it('filters by project name', async () => {
      mock.onGet(`${ BASE }/v2/projects`).reply({ _data: [{ id: 'p_1', name: 'Alpha' }, { id: 'p_2', name: 'Beta' }] })

      const result = await service.listProjectsDictionary({ search: 'bet' })

      expect(result.items.map(item => item.value)).toEqual(['p_2'])
    })
  })

  describe('listCompensationTypesDictionary', () => {
    it('maps compensation types with frequency notes', async () => {
      mock.onGet(`${ BASE }/v2/compensations/types`).reply({
        _data: [{ id: 'ct_1', name: 'Base salary', frequency: 'MONTHLY', recurring: true }, { id: 'ct_2' }],
      })

      const result = await service.listCompensationTypesDictionary({})

      expect(mock.history[0].query).toEqual({ limit: 100 })

      expect(result.items).toEqual([
        { label: 'Base salary', value: 'ct_1', note: 'MONTHLY · Recurring' },
        { label: 'Type ct_2', value: 'ct_2', note: '' },
      ])
    })
  })

  describe('listV2ReportsDictionary', () => {
    it('maps analytics reports and notes the last update', async () => {
      mock.onGet(`${ BASE }/v2/reports`).reply({
        _data: [{ id: 'r_1', name: 'Headcount', updated_at: '2026-05-01T10:00:00Z' }, { id: 'r_2', title: 'Payroll' }],
      })

      const result = await service.listV2ReportsDictionary({})

      expect(result.items).toEqual([
        { label: 'Headcount', value: 'r_1', note: 'Updated 2026-05-01' },
        { label: 'Payroll', value: 'r_2', note: '' },
      ])
    })

    it('filters on name or title', async () => {
      mock.onGet(`${ BASE }/v2/reports`).reply({ _data: [{ id: 'r_1', name: 'Headcount' }, { id: 'r_2', title: 'Payroll' }] })

      const result = await service.listV2ReportsDictionary({ search: 'payroll' })

      expect(result.items.map(item => item.value)).toEqual(['r_2'])
    })
  })

  describe('listCustomReportsDictionary', () => {
    it('maps saved custom reports with their category', async () => {
      mock.onGet(`${ BASE }/v1/company/custom-reports/reports`).reply({
        data: [{ id: 'cr_1', attributes: { name: 'Absences YTD', category: 'Time off' } }, { id: 'cr_2' }],
      })

      const result = await service.listCustomReportsDictionary({ search: 'absences' })

      expect(mock.history[0].query).toEqual({ limit: 100 })
      expect(result.items).toEqual([{ label: 'Absences YTD', value: 'cr_1', note: 'Time off' }])
    })
  })

  describe('listEmployeeAttributesDictionary', () => {
    it('maps employee attributes and marks custom fields', async () => {
      mock.onGet(`${ BASE }/v1/company/employees/attributes`).reply({
        data: [
          { key: 'email', label: 'Email', type: 'standard' },
          { key: 'dynamic_1', label: 'T-shirt size', type: 'text', custom: true },
        ],
      })

      const result = await service.listEmployeeAttributesDictionary({})

      expect(result.items).toEqual([
        { label: 'Email', value: 'email', note: 'standard · Standard' },
        { label: 'T-shirt size', value: 'dynamic_1', note: 'text · Custom' },
      ])
    })

    it('filters on label or key', async () => {
      mock.onGet(`${ BASE }/v1/company/employees/attributes`).reply({
        data: [{ key: 'email', label: 'Email' }, { key: 'dynamic_1', label: 'T-shirt size' }],
      })

      const result = await service.listEmployeeAttributesDictionary({ search: 'dynamic' })

      expect(result.items.map(item => item.value)).toEqual(['dynamic_1'])
    })
  })

  describe('listWebhooksDictionary', () => {
    it('maps webhooks with status and event counts', async () => {
      mock.onGet(`${ BASE }/v2/webhooks`).reply({
        _data: [
          { id: 'wh_1', description: 'FlowRunner', url: 'https://hook.test', status: 'ENABLED', enabled_events: ['person.created'] },
          { id: 'wh_2', url: 'https://other.test' },
        ],
      })

      const result = await service.listWebhooksDictionary({})

      expect(result.items).toEqual([
        { label: 'FlowRunner', value: 'wh_1', note: 'ENABLED · 1 events' },
        { label: 'https://other.test', value: 'wh_2', note: 'Enabled · 0 events' },
      ])
    })

    it('filters on description or url', async () => {
      mock.onGet(`${ BASE }/v2/webhooks`).reply({
        _data: [{ id: 'wh_1', description: 'FlowRunner' }, { id: 'wh_2', url: 'https://other.test' }],
      })

      const result = await service.listWebhooksDictionary({ search: 'other' })

      expect(result.items.map(item => item.value)).toEqual(['wh_2'])
    })
  })

  // ── People ──

  describe('findPeople', () => {
    it('fetches a single person by id', async () => {
      mock.onGet(`${ BASE }/v2/persons/42`).reply({ _data: { id: 42, first_name: 'Sarah' } })

      const result = await service.findPeople(42)

      expect(result).toEqual({ items: [{ id: 42, first_name: 'Sarah' }], cursor: null, total: 1 })
    })

    it('lists people with server-side filters and a client-side name filter', async () => {
      mock.onGet(`${ BASE }/v2/persons`).reply({
        _data: [
          { id: 1, first_name: 'Sarah', last_name: 'Connor' },
          { id: 2, first_name: 'John', last_name: 'Connor' },
        ],
        _meta: { links: { next: 'https://api.personio.de/v2/persons?cursor=zzz' } },
      })

      const result = await service.findPeople(null, 'sarah@example.com', 'sarah', 'active', '2026-01-01T00:00:00Z')

      expect(mock.history[0].query).toEqual({
        limit: 50,
        email: 'sarah@example.com',
        status: 'ACTIVE',
        'updated_at.gt': '2026-01-01T00:00:00Z',
      })

      expect(result.items.map(person => person.id)).toEqual([1])
      expect(result.total).toBe(1)
      expect(result.cursor).toBe('zzz')
    })

    it('omits the status filter when Any is selected and passes a cursor through', async () => {
      mock.onGet(`${ BASE }/v2/persons`).reply({ _data: [] })

      await service.findPeople(null, null, null, 'Any', null, 'cur')

      expect(mock.history[0].query).toEqual({ limit: 50, cursor: 'cur' })
    })
  })

  describe('addPerson', () => {
    it('nests employment fields and drops empty values', async () => {
      mock.onPost(`${ BASE }/v2/persons`).reply({ _data: { id: 99 } })

      const result = await service.addPerson(
        'Sarah', 'Connor', 'sarah@example.com', 'Sarah', 'female',
        '2026-06-01', 40, 'permanent', 'org_1', 'wp_1', 'le_1', 'Engineer'
      )

      expect(result).toEqual({ id: 99 })
      expect(mock.history[0].method).toBe('post')

      expect(mock.history[0].body).toEqual({
        first_name: 'Sarah',
        last_name: 'Connor',
        preferred_name: 'Sarah',
        email: 'sarah@example.com',
        gender: 'female',
        employment: {
          start_date: '2026-06-01',
          weekly_hours: 40,
          contract_type: 'permanent',
          org_unit_id: 'org_1',
          workplace_id: 'wp_1',
          legal_entity_id: 'le_1',
          position: 'Engineer',
        },
      })
    })

    it('drops the literal "undefined" gender and empty employment fields', async () => {
      mock.onPost(`${ BASE }/v2/persons`).reply({ id: 100 })

      const result = await service.addPerson('A', 'B', 'a@b.test', null, 'undefined')

      expect(result).toEqual({ id: 100 })

      expect(mock.history[0].body).toEqual({
        first_name: 'A',
        last_name: 'B',
        email: 'a@b.test',
        employment: {},
      })
    })
  })

  describe('updatePerson', () => {
    it('PATCHes only the supplied fields and wraps relation ids', async () => {
      mock.onPatch(`${ BASE }/v2/persons/42`).reply({ _data: { id: 42 } })

      await service.updatePerson(42, 'Sarah', null, null, null, 'org_9', 'wp_9', 'Lead', { shirt: 'M' })

      expect(mock.history[0].method).toBe('patch')

      expect(mock.history[0].body).toEqual({
        first_name: 'Sarah',
        department: { id: 'org_9' },
        office: { id: 'wp_9' },
        position: 'Lead',
        custom_attributes: { shirt: 'M' },
      })
    })

    it('ignores a non-object custom fields value', async () => {
      mock.onPatch(`${ BASE }/v2/persons/42`).reply({ _data: { id: 42 } })

      await service.updatePerson(42, 'Sarah', null, null, null, null, null, null, 'nope')

      expect(mock.history[0].body).toEqual({ first_name: 'Sarah' })
    })
  })

  describe('deletePerson', () => {
    it('refuses without an explicit confirmation', async () => {
      await expect(service.deletePerson(42)).rejects.toThrow(/turn on "Confirm deletion"/)

      expect(mock.history).toHaveLength(0)
    })

    it('deletes when confirmed', async () => {
      mock.onDelete(`${ BASE }/v2/persons/42`).reply({})

      const result = await service.deletePerson(42, true)

      expect(result).toEqual({ deleted: true, personId: 42 })
      expect(mock.history[0].method).toBe('delete')
    })
  })

  describe('getEmployeePhoto', () => {
    it('downloads the photo at the default width and base64-encodes it', async () => {
      mock.onGet(`${ BASE }/v1/company/employees/42/profile-picture/256`).reply('binarydata')

      const result = await service.getEmployeePhoto(42)

      expect(result).toEqual({
        personId: 42,
        width: 256,
        contentType: 'image/jpeg',
        base64: Buffer.from('binarydata', 'binary').toString('base64'),
        empty: false,
      })
    })

    it('honours a custom width', async () => {
      mock.onGet(`${ BASE }/v1/company/employees/42/profile-picture/128`).reply('x')

      const result = await service.getEmployeePhoto(42, '128.9')

      expect(result.width).toBe(128)
    })

    it('returns an empty result when the person has no photo', async () => {
      mock.onGet(`${ BASE }/v1/company/employees/42/profile-picture/256`).replyWithError({
        message: 'not found',
        status: 404,
      })

      const result = await service.getEmployeePhoto(42)

      expect(result).toEqual({ personId: 42, width: 256, contentType: null, base64: '', empty: true })
    })

    it('rethrows non-not-found errors', async () => {
      mock.onGet(`${ BASE }/v1/company/employees/42/profile-picture/256`).replyWithError({
        message: 'boom',
        status: 429,
      })

      await expect(service.getEmployeePhoto(42)).rejects.toThrow(FRIENDLY.rateLimited)
    })
  })

  // ── Employments ──

  describe('findEmployments', () => {
    it('fetches a single employment by id', async () => {
      mock.onGet(`${ BASE }/v2/persons/42/employments/e_1`).reply({ _data: { id: 'e_1' } })

      const result = await service.findEmployments(42, 'e_1')

      expect(result).toEqual({ items: [{ id: 'e_1' }], total: 1 })
    })

    it('lists the employments for a person', async () => {
      mock.onGet(`${ BASE }/v2/persons/42/employments`).reply({ _data: [{ id: 'e_1' }, { id: 'e_2' }] })

      const result = await service.findEmployments(42)

      expect(mock.history[0].query).toEqual({ limit: 50 })
      expect(result.total).toBe(2)
    })
  })

  describe('updateEmployment', () => {
    it('PATCHes the employment with normalized relation shapes', async () => {
      mock.onPatch(`${ BASE }/v2/persons/42/employments/e_1`).reply({ _data: { id: 'e_1' } })

      await service.updateEmployment(42, 'e_1', 32, 'permanent', 'Staff Engineer', 's_1', 'org_1', 'cc_1')

      expect(mock.history[0].body).toEqual({
        weekly_working_hours: 32,
        type: 'PERMANENT',
        position: 'Staff Engineer',
        supervisor: { id: 's_1' },
        org_units: [{ id: 'org_1' }],
        cost_centers: [{ id: 'cc_1' }],
      })
    })
  })

  describe('endEmployment', () => {
    it('refuses without an explicit confirmation', async () => {
      await expect(service.endEmployment(42, '2026-09-30')).rejects.toThrow(/Confirm termination/)

      expect(mock.history).toHaveLength(0)
    })

    it('PATCHes the legacy employee record and echoes the termination details', async () => {
      mock.onPatch(`${ BASE }/v1/company/employees/42`).reply({ success: true })

      const result = await service.endEmployment(42, '2026-09-30', 'resignation', 'voluntary', true)

      expect(mock.history[0].body).toEqual({
        employee: {
          termination_date: { value: '2026-09-30' },
          termination_reason: { value: 'resignation' },
          termination_type: { value: 'voluntary' },
        },
      })

      expect(result).toEqual({
        personId: 42,
        terminationDate: '2026-09-30',
        terminationReason: 'resignation',
        terminationType: 'voluntary',
      })
    })

    it('omits the optional reason and type', async () => {
      mock.onPatch(`${ BASE }/v1/company/employees/42`).reply({})

      const result = await service.endEmployment(42, '2026-09-30', null, null, true)

      expect(mock.history[0].body.employee).toEqual({ termination_date: { value: '2026-09-30' } })
      expect(result.terminationReason).toBeNull()
      expect(result.terminationType).toBeNull()
    })
  })

  // ── Time off ──

  describe('findTimeOff', () => {
    const ABSENCES = {
      _data: [
        {
          id: 'ab_1',
          person: { id: 42 },
          absence_type: { id: 'at_1' },
          approval: { status: 'APPROVED' },
          starts_from: { date_time: '2026-08-15T00:00:00' },
          ends_at: { date_time: '2026-08-22T00:00:00' },
        },
        {
          id: 'ab_2',
          person: { id: 43 },
          absence_type: { id: 'at_2' },
          status: 'PENDING',
          starts_from: { date_time: '2026-01-05T00:00:00' },
          ends_at: { date_time: '2026-01-06T00:00:00' },
        },
      ],
    }

    it('fetches a single absence by id', async () => {
      mock.onGet(`${ BASE }/v2/absence-periods/ab_1`).reply({ _data: { id: 'ab_1' } })

      const result = await service.findTimeOff('ab_1')

      expect(result).toEqual({ items: [{ id: 'ab_1' }], total: 1, cursor: null })
    })

    it('filters the listing by person, type and status client-side', async () => {
      mock.onGet(`${ BASE }/v2/absence-periods`).reply(ABSENCES)

      const result = await service.findTimeOff(null, 42, 'at_1', 'approved')

      expect(mock.history[0].query).toEqual({ limit: 50 })
      expect(result.items.map(item => item.id)).toEqual(['ab_1'])
    })

    it('ignores the status filter when Any is selected', async () => {
      mock.onGet(`${ BASE }/v2/absence-periods`).reply(ABSENCES)

      const result = await service.findTimeOff(null, null, null, 'Any')

      expect(result.total).toBe(2)
    })

    it('filters by an explicit date range', async () => {
      mock.onGet(`${ BASE }/v2/absence-periods`).reply(ABSENCES)

      const result = await service.findTimeOff(null, null, null, null, null, '2026-08-01', '2026-08-31')

      expect(result.items.map(item => item.id)).toEqual(['ab_1'])
    })

    it('resolves a named period preset', async () => {
      mock.onGet(`${ BASE }/v2/absence-periods`).reply(ABSENCES)

      const result = await service.findTimeOff(null, null, null, null, 'Year to date')

      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('requestTimeOff', () => {
    it('uses the legacy day-based endpoint in whole-days mode', async () => {
      mock.onPost(`${ BASE }/v1/company/time-offs`).reply({ data: { id: 1234 } })

      const result = await service.requestTimeOff(
        42, '3465520', 'Whole days',
        { startDate: '2026-08-15', endDate: '2026-08-22', halfDayEnd: true },
        'Summer break', true
      )

      expect(result).toEqual({ id: 1234 })

      expect(mock.history[0].body).toEqual({
        employee_id: 42,
        time_off_type_id: '3465520',
        start_date: '2026-08-15',
        end_date: '2026-08-22',
        half_day_start: false,
        half_day_end: true,
        comment: 'Summer break',
        skip_approval: true,
      })
    })

    it('defaults the end date to the start date in whole-days mode', async () => {
      mock.onPost(`${ BASE }/v1/company/time-offs`).reply({ data: {} })

      await service.requestTimeOff(42, '1', 'Whole days', { startDate: '2026-08-15' })

      expect(mock.history[0].body.end_date).toBe('2026-08-15')
      expect(mock.history[0].body.skip_approval).toBe(false)
    })

    it('resolves the v1 type id to a v2 uuid in hours mode and strips timezone suffixes', async () => {
      mock.onGet(`${ BASE }/v1/company/time-off-types`).reply({
        data: [{ attributes: { id: 3465520, id_v2: 'uuid-1' } }],
      })

      mock.onPost(`${ BASE }/v2/absence-periods`).reply({ _data: { id: 'ab_9' } })

      const result = await service.requestTimeOff(
        42, '3465520', 'Part of a day',
        { startsAt: '2026-08-15T14:00:00Z', endsAt: '2026-08-15T17:00:00+02:00' },
        'Dentist', true
      )

      expect(result).toEqual({ id: 'ab_9' })

      expect(mock.history[1].body).toEqual({
        person: { id: 42 },
        absence_type: { id: 'uuid-1' },
        starts_from: { date_time: '2026-08-15T14:00:00' },
        ends_at: { date_time: '2026-08-15T17:00:00' },
        comment: 'Dentist',
        approval: { status: 'APPROVED' },
      })
    })

    it('passes a uuid time-off type through without a lookup', async () => {
      mock.onPost(`${ BASE }/v2/absence-periods`).reply({ _data: { id: 'ab_9' } })

      await service.requestTimeOff(42, 'a1b2-c3d4', 'Part of a day', { startsAt: '2026-08-15T14:00:00' })

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].body.absence_type).toEqual({ id: 'a1b2-c3d4' })
    })

    it('fails clearly when the v1 type has no v2 counterpart', async () => {
      mock.onGet(`${ BASE }/v1/company/time-off-types`).reply({ data: [] })

      await expect(
        service.requestTimeOff(42, '3465520', 'Part of a day', { startsAt: '2026-08-15T14:00:00' })
      ).rejects.toThrow(/could not match the chosen time-off type/)
    })
  })

  describe('updateTimeOff / withdrawTimeOff / getTimeOffBalance', () => {
    it('PATCHes an absence with an upper-cased status', async () => {
      mock.onPatch(`${ BASE }/v2/absence-periods/ab_1`).reply({ _data: { id: 'ab_1' } })

      await service.updateTimeOff('ab_1', '2026-08-15', '2026-08-16', 'approved', 'ok')

      expect(mock.history[0].body).toEqual({
        starts_at: '2026-08-15',
        ends_at: '2026-08-16',
        status: 'APPROVED',
        comment: 'ok',
      })
    })

    it('withdraws an absence', async () => {
      mock.onDelete(`${ BASE }/v2/absence-periods/ab_1`).reply({})

      const result = await service.withdrawTimeOff('ab_1')

      expect(result).toEqual({ withdrawn: true, timeOffId: 'ab_1' })
    })

    it('normalizes the balance payload across field-name variants', async () => {
      mock.onGet(`${ BASE }/v1/company/employees/42/absences/balance`).reply({
        data: [
          { id: 1, name: 'Paid holidays', used_balance: 5, available_balance: 20, total_balance: 25, unit: 'DAYS' },
          { id: 2, name: 'Overtime', used: 3, remaining: 1, total: 4 },
        ],
      })

      const result = await service.getTimeOffBalance(42)

      expect(result).toEqual({
        personId: 42,
        balances: [
          { typeId: '1', typeName: 'Paid holidays', used: 5, remaining: 20, total: 25, unit: 'DAYS' },
          { typeId: '2', typeName: 'Overtime', used: 3, remaining: 1, total: 4, unit: 'DAYS' },
        ],
      })
    })
  })

  describe('requestTimeOffSchemaLoader', () => {
    it('returns date fields for whole-day requests', async () => {
      const schema = await service.requestTimeOffSchemaLoader({ criteria: { mode: 'Whole days' } })

      expect(schema.map(field => field.name)).toEqual(['startDate', 'endDate', 'halfDayStart', 'halfDayEnd'])
      expect(schema[0].uiComponent).toEqual({ type: 'DATE_PICKER' })
    })

    it('returns date-time fields for partial-day requests', async () => {
      const schema = await service.requestTimeOffSchemaLoader({ criteria: { mode: 'Part of a day' } })

      expect(schema.map(field => field.name)).toEqual(['startsAt', 'endsAt'])
      expect(schema.every(field => field.uiComponent.type === 'DATE_TIME_PICKER')).toBe(true)
    })

    it('defaults to the partial-day schema with no criteria', async () => {
      const schema = await service.requestTimeOffSchemaLoader({})

      expect(schema.map(field => field.name)).toEqual(['startsAt', 'endsAt'])
    })
  })

  // ── Time tracking ──

  describe('findTimeEntries', () => {
    const ENTRIES = {
      _data: [
        { id: 'at_1', person: { id: 42 }, project: { id: 'p_1' }, starts_at: { date_time: '2026-08-15T09:00:00' }, ends_at: { date_time: '2026-08-15T17:00:00' } },
        { id: 'at_2', person: { id: 43 }, starts_at: { date_time: '2026-01-02T09:00:00' }, ends_at: { date_time: '2026-01-02T17:00:00' } },
      ],
    }

    it('fetches a single entry by id', async () => {
      mock.onGet(`${ BASE }/v2/attendance-periods/at_1`).reply({ _data: { id: 'at_1' } })

      const result = await service.findTimeEntries('at_1')

      expect(result).toEqual({ items: [{ id: 'at_1' }], total: 1, cursor: null })
    })

    it('filters by person, project and date range', async () => {
      mock.onGet(`${ BASE }/v2/attendance-periods`).reply(ENTRIES)

      const result = await service.findTimeEntries(null, 42, 'p_1', null, '2026-08-01', '2026-08-31')

      expect(result.items.map(item => item.id)).toEqual(['at_1'])
    })

    it('returns everything when no filter is supplied', async () => {
      mock.onGet(`${ BASE }/v2/attendance-periods`).reply(ENTRIES)

      const result = await service.findTimeEntries()

      expect(result.total).toBe(2)
      expect(result.cursor).toBeNull()
    })
  })

  describe('trackTime', () => {
    it('creates a WORK entry with timezone-stripped timestamps', async () => {
      mock.onPost(`${ BASE }/v2/attendance-periods`).reply({ _data: { id: 'at_9' } })

      const result = await service.trackTime(42, '2026-08-15T09:00:00Z', '2026-08-15T17:00:00Z', 0, 'p_1', 'Sprint work')

      expect(result).toEqual({ id: 'at_9' })
      expect(mock.history).toHaveLength(1)

      expect(mock.history[0].body).toEqual({
        person: { id: 42 },
        type: 'WORK',
        start: { date_time: '2026-08-15T09:00:00' },
        end: { date_time: '2026-08-15T17:00:00' },
        project: { id: 'p_1' },
        comment: 'Sprint work',
      })
    })

    it('creates a companion BREAK entry when break minutes are supplied', async () => {
      mock.onPost(`${ BASE }/v2/attendance-periods`).replyWith(callRecord =>
        callRecord.body.type === 'WORK' ? { _data: { id: 'at_9' } } : { _data: { id: 'at_10' } }
      )

      const result = await service.trackTime(42, '2026-08-15T09:00:00', '2026-08-15T17:00:00', 30)

      // The break window is derived from the work start: one hour in, lasting
      // `breakMinutes`. The service renders it through Date#toISOString, so the
      // expectation is computed the same way to stay timezone-independent.
      const breakStart = new Date(new Date('2026-08-15T09:00:00').getTime() + 60 * 60 * 1000)
      const breakEnd = new Date(breakStart.getTime() + 30 * 60 * 1000)

      expect(mock.history).toHaveLength(2)

      expect(mock.history[1].body).toMatchObject({
        type: 'BREAK',
        comment: 'Break',
        person: { id: 42 },
        start: { date_time: breakStart.toISOString().slice(0, 19) },
        end: { date_time: breakEnd.toISOString().slice(0, 19) },
      })

      expect(result).toEqual({ id: 'at_9', break: { id: 'at_10' } })
    })

    it('still returns the work entry when the break call fails', async () => {
      let calls = 0

      mock.onPost(`${ BASE }/v2/attendance-periods`).replyWith(() => {
        calls++

        if (calls === 1) {
          return { _data: { id: 'at_9' } }
        }

        throw Object.assign(new Error('nope'), { status: 400 })
      })

      const result = await service.trackTime(42, '2026-08-15T09:00:00', '2026-08-15T17:00:00', 30)

      expect(result).toEqual({ id: 'at_9' })
    })
  })

  describe('updateTimeEntry / deleteTimeEntry', () => {
    it('PATCHes only the supplied fields and ignores break minutes', async () => {
      mock.onPatch(`${ BASE }/v2/attendance-periods/at_1`).reply({ _data: { id: 'at_1' } })

      await service.updateTimeEntry('at_1', '2026-08-15T10:00:00Z', null, 45, 'p_2', 'Adjusted')

      expect(mock.history[0].body).toEqual({
        start: { date_time: '2026-08-15T10:00:00' },
        project: { id: 'p_2' },
        comment: 'Adjusted',
      })
    })

    it('deletes an entry', async () => {
      mock.onDelete(`${ BASE }/v2/attendance-periods/at_1`).reply({})

      const result = await service.deleteTimeEntry('at_1')

      expect(result).toEqual({ deleted: true, entryId: 'at_1' })
    })
  })

  describe('summarizeTimeTracked', () => {
    it('aggregates hours by person, day and project across pages', async () => {
      mock.onGet(`${ BASE }/v2/attendance-periods`).replyWith(callRecord => {
        if (!callRecord.query.cursor) {
          return {
            _data: [
              {
                person: { id: 42 },
                project: { id: 'p_1' },
                starts_at: { date_time: '2026-08-15T09:00:00' },
                ends_at: { date_time: '2026-08-15T17:00:00' },
                break: 30,
              },
            ],
            _meta: { links: { next: 'https://api.personio.de/v2/attendance-periods?cursor=p2' } },
          }
        }

        return {
          _data: [
            {
              person: { id: 43 },
              starts_at: { date_time: '2026-08-16T09:00:00' },
              ends_at: { date_time: '2026-08-16T13:00:00' },
            },
          ],
        }
      })

      const result = await service.summarizeTimeTracked(null, null, null, '2026-08-01', '2026-08-31')

      expect(mock.history).toHaveLength(2)
      expect(result.entries).toBe(2)
      expect(result.totalHours).toBe(11.5)

      expect(result.byPerson).toEqual([
        { personId: '42', hours: 7.5 },
        { personId: '43', hours: 4 },
      ])

      expect(result.byDay).toEqual([
        { day: '2026-08-15', hours: 7.5 },
        { day: '2026-08-16', hours: 4 },
      ])

      expect(result.byProject).toEqual([{ projectId: 'p_1', hours: 7.5 }])
    })

    it('filters by person and project before aggregating', async () => {
      mock.onGet(`${ BASE }/v2/attendance-periods`).reply({
        _data: [
          { person: { id: 42 }, project: { id: 'p_1' }, starts_at: { date_time: '2026-08-15T09:00:00' }, ends_at: { date_time: '2026-08-15T10:00:00' } },
          { person: { id: 43 }, project: { id: 'p_2' }, starts_at: { date_time: '2026-08-15T09:00:00' }, ends_at: { date_time: '2026-08-15T10:00:00' } },
        ],
      })

      const result = await service.summarizeTimeTracked(42, 'p_1', null, '2026-08-01', '2026-08-31')

      expect(result.entries).toBe(1)
      expect(result.totalHours).toBe(1)
    })
  })

  // ── Documents ──

  describe('findDocuments', () => {
    it('fetches a single document by id', async () => {
      mock.onGet(`${ BASE }/v2/document-management/documents/doc_1`).reply({ _data: { id: 'doc_1' } })

      const result = await service.findDocuments('doc_1')

      expect(result).toEqual({ items: [{ id: 'doc_1' }], total: 1, cursor: null })
    })

    it('requires a person when listing', async () => {
      await expect(service.findDocuments()).rejects.toThrow(/requires a Person/)

      expect(mock.history).toHaveLength(0)
    })

    it('lists a person documents and filters by title', async () => {
      mock.onGet(`${ BASE }/v2/document-management/documents`).reply({
        _data: [{ id: 'doc_1', title: 'Employment Contract' }, { id: 'doc_2', title: 'Payslip May' }],
      })

      const result = await service.findDocuments(null, 42, '5', 'contract')

      expect(mock.history[0].query).toEqual({ limit: 50, owner_id: 42, category_id: '5' })
      expect(result.items.map(item => item.id)).toEqual(['doc_1'])
    })
  })

  describe('uploadDocument', () => {
    it('refuses when the file content is empty', async () => {
      await expect(service.uploadDocument(42, 'T', '5', 'a.pdf', '')).rejects.toThrow(/file content is empty/)

      expect(mock.history).toHaveLength(0)
    })

    it('posts a multipart form with the decoded file buffer', async () => {
      mock.onPost(`${ BASE }/v1/company/documents`).reply({ data: { id: 'doc_9' } })

      const base64 = Buffer.from('pdf-bytes').toString('base64')
      const result = await service.uploadDocument(42, 'Contract', '5', 'contract.pdf', base64, true, 'Signed copy')

      expect(result).toEqual({ id: 'doc_9' })
      expect(mock.history[0].headers).toMatchObject({ 'Content-Type': 'multipart/form-data' })

      expect(mock.history[0].formData).toMatchObject({
        employee_id: 42,
        title: 'Contract',
        category_id: '5',
        confidential: '1',
        comment: 'Signed copy',
      })

      expect(mock.history[0].formData.file.value.toString()).toBe('pdf-bytes')
      expect(mock.history[0].formData.file.options.filename).toBe('contract.pdf')
    })

    it('marks a non-confidential upload and omits the comment', async () => {
      mock.onPost(`${ BASE }/v1/company/documents`).reply({ data: {} })

      await service.uploadDocument(42, 'T', '5', 'a.pdf', Buffer.from('x').toString('base64'))

      expect(mock.history[0].formData.confidential).toBe('0')
      expect(mock.history[0].formData.comment).toBeUndefined()
    })
  })

  describe('downloadDocument', () => {
    it('base64-encodes the downloaded bytes', async () => {
      mock.onGet(`${ BASE }/v2/document-management/documents/doc_1/download`).reply('file-bytes')

      const result = await service.downloadDocument('doc_1')

      expect(result).toEqual({
        documentId: 'doc_1',
        contentType: 'application/octet-stream',
        base64: Buffer.from('file-bytes', 'binary').toString('base64'),
        bytes: 10,
      })
    })
  })

  describe('updateDocumentDetails / deleteDocument', () => {
    it('maps the confidentiality choice to a boolean', async () => {
      mock.onPatch(`${ BASE }/v2/document-management/documents/doc_1`).reply({ _data: { id: 'doc_1' } })

      await service.updateDocumentDetails('doc_1', 'New title', '6', 'note', 'Confidential')

      expect(mock.history[0].body).toEqual({
        title: 'New title',
        category: { id: '6' },
        comment: 'note',
        confidential: true,
      })
    })

    it('maps the visible-to-employee choice to false and leaves other values unset', async () => {
      mock.onPatch(`${ BASE }/v2/document-management/documents/doc_1`).reply({ _data: {} })

      await service.updateDocumentDetails('doc_1', null, null, null, 'Visible to employee')

      expect(mock.history[0].body).toEqual({ confidential: false })

      mock.reset()
      mock.onPatch(`${ BASE }/v2/document-management/documents/doc_1`).reply({ _data: {} })

      await service.updateDocumentDetails('doc_1', 'T', null, null, 'Unchanged')

      expect(mock.history[0].body).toEqual({ title: 'T' })
    })

    it('deletes a document', async () => {
      mock.onDelete(`${ BASE }/v2/document-management/documents/doc_1`).reply({})

      const result = await service.deleteDocument('doc_1')

      expect(result).toEqual({ deleted: true, documentId: 'doc_1' })
    })
  })

  // ── Recruiting ──

  describe('createCandidate', () => {
    it('uses the static recruiting token, company id header and query parameter', async () => {
      mock.onPost(`${ BASE }/v1/recruiting/applications`).reply({
        data: { application_id: 'app_1', candidate_id: 'cand_1', status: 'submitted' },
      })

      const result = await service.createCandidate(
        'Ada', 'Lovelace', 'ada@example.com', 'job_1', '+49 30 1234', 'Berlin', 'src_1', 'Hello'
      )

      expect(mock.history[0].headers).toMatchObject({
        Authorization: 'Token token=recruiting-token',
        'X-Company-ID': '9001',
      })

      expect(mock.history[0].query).toEqual({ company_id: '9001' })

      expect(mock.history[0].body).toEqual({
        first_name: 'Ada',
        last_name: 'Lovelace',
        email: 'ada@example.com',
        job_position_id: 'job_1',
        phone: '+49 30 1234',
        location: 'Berlin',
        source_id: 'src_1',
        message: 'Hello',
      })

      expect(result).toEqual({
        applicationId: 'app_1',
        candidateId: 'cand_1',
        jobId: 'job_1',
        status: 'submitted',
      })
    })

    it('reads a flat recruiting response and defaults the status', async () => {
      mock.onPost(`${ BASE }/v1/recruiting/applications`).reply({ application_id: 'app_2', candidate_id: 'cand_2' })

      const result = await service.createCandidate('A', 'B', 'a@b.test', 'job_1')

      expect(result).toEqual({
        applicationId: 'app_2',
        candidateId: 'cand_2',
        jobId: 'job_1',
        status: 'submitted',
      })
    })

    it('explains a missing recruiting token', async () => {
      const fresh = buildSandbox({ clientId: 'a', clientSecret: 'b' })

      await expect(fresh.getService().createCandidate('A', 'B', 'a@b.test', 'job_1')).rejects.toThrow(
        FRIENDLY.missingRecruitingToken
      )

      fresh.cleanup()
    })

    it('explains a missing recruiting company id', async () => {
      const fresh = buildSandbox({ clientId: 'a', clientSecret: 'b', recruitingApiToken: 'tok' })

      await expect(fresh.getService().createCandidate('A', 'B', 'a@b.test', 'job_1')).rejects.toThrow(
        FRIENDLY.missingRecruitingCompanyId
      )

      fresh.cleanup()
    })
  })

  describe('uploadApplicantDocument', () => {
    it('refuses when the file content is empty', async () => {
      await expect(service.uploadApplicantDocument('app_1', 'cv', 'cv.pdf', '')).rejects.toThrow(
        /file content is empty/
      )
    })

    it('posts a multipart form including the company id', async () => {
      mock.onPost(`${ BASE }/v1/recruiting/applications/documents`).reply({})

      const result = await service.uploadApplicantDocument(
        'app_1', 'cv', 'cv.pdf', Buffer.from('cv-bytes').toString('base64')
      )

      expect(mock.history[0].formData).toMatchObject({
        application_id: 'app_1',
        category: 'cv',
        company_id: '9001',
      })

      expect(result).toEqual({ applicationId: 'app_1', uploaded: true, category: 'cv', fileName: 'cv.pdf' })
    })
  })

  // ── Reports ──

  describe('runReport', () => {
    it('refuses when no report is picked', async () => {
      await expect(service.runReport('Standard', {})).rejects.toThrow(/pick a report in the picker/)

      expect(mock.history).toHaveLength(0)
    })

    it('runs a standard analytics report and derives the columns from the first row', async () => {
      mock.onGet(`${ BASE }/v2/reports/r_1`).reply({
        _data: { rows: [{ Person: 'Sarah', Hours: 8 }] },
        _meta: { links: { next: 'https://api.personio.de/v2/reports/r_1?cursor=nx' } },
      })

      const result = await service.runReport('Standard', { reportId: 'r_1' })

      expect(mock.history[0].query).toEqual({ limit: 100 })

      expect(result).toEqual({
        source: 'Standard',
        reportId: 'r_1',
        rows: [{ Person: 'Sarah', Hours: 8 }],
        columns: ['Person', 'Hours'],
        cursor: 'nx',
        total: 1,
      })
    })

    it('runs a saved custom report', async () => {
      mock.onGet(`${ BASE }/v1/company/custom-reports/reports/cr_1`).reply({
        data: { rows: [{ Person: 'Sarah' }], columns: ['Person'] },
      })

      const result = await service.runReport('Custom', { customReportId: 'cr_1' })

      expect(result).toEqual({
        source: 'Custom',
        reportId: 'cr_1',
        rows: [{ Person: 'Sarah' }],
        columns: ['Person'],
        cursor: null,
        total: 1,
      })
    })

    it('handles an empty standard report', async () => {
      mock.onGet(`${ BASE }/v2/reports/r_1`).reply({ _data: {} })

      const result = await service.runReport('Standard', { reportId: 'r_1' })

      expect(result.rows).toEqual([])
      expect(result.columns).toEqual([])
      expect(result.cursor).toBeNull()
    })
  })

  describe('runReportSchemaLoader', () => {
    it('offers the custom report picker for the Custom source', async () => {
      const schema = await service.runReportSchemaLoader({ criteria: { source: 'Custom' } })

      expect(schema).toHaveLength(1)
      expect(schema[0]).toMatchObject({ name: 'customReportId', dictionary: 'listCustomReportsDictionary' })
    })

    it('offers the analytics report picker otherwise', async () => {
      const schema = await service.runReportSchemaLoader({})

      expect(schema[0]).toMatchObject({ name: 'reportId', dictionary: 'listV2ReportsDictionary' })
    })
  })

  describe('listReportColumns', () => {
    it('normalizes the attribute list', async () => {
      mock.onGet(`${ BASE }/v2/reports/attributes`).reply({
        _data: [{ key: 'first_name', label: 'First name', group: 'Personal' }, { id: 'x', name: 'X', category: 'Other' }],
      })

      const result = await service.listReportColumns()

      expect(mock.history[0].query).toEqual({ limit: 200 })

      expect(result).toEqual({
        items: [
          { key: 'first_name', label: 'First name', group: 'Personal' },
          { key: 'x', label: 'X', group: 'Other' },
        ],
        total: 2,
      })
    })
  })

  // ── Organization ──

  describe('organization lookups', () => {
    it('fetches a single legal entity by id', async () => {
      mock.onGet(`${ BASE }/v2/legal-entities/e_1`).reply({ _data: { id: 'e_1' } })

      const result = await service.findLegalEntities('e_1')

      expect(result).toEqual({ items: [{ id: 'e_1' }], total: 1 })
    })

    it('lists legal entities', async () => {
      mock.onGet(`${ BASE }/v2/legal-entities`).reply({ _data: [{ id: 'e_1' }, { id: 'e_2' }] })

      const result = await service.findLegalEntities()

      expect(mock.history[0].query).toEqual({ limit: 100 })
      expect(result.total).toBe(2)
    })

    it.each([
      ['findDepartments', 'department'],
      ['findCostCenters', 'cost_centers'],
      ['findOffices', 'office'],
    ])('%s derives records from the employee attribute %s', async (method, attribute) => {
      mock.onGet(`${ BASE }/v1/company/employees`).replyWith(callRecord =>
        callRecord.query.offset === 0
          ? {
            metadata: { total_elements: 1 },
            data: [{ attributes: { [attribute]: { value: { id: 5, name: 'Alpha' } } } }],
          }
          : { data: [] }
      )

      const result = await service[method]()

      expect(mock.history[0].query['attributes[]']).toBe(attribute)
      expect(result).toEqual({ items: [{ id: 5, name: 'Alpha', headcount: 1 }], total: 1 })
    })
  })

  // ── Compensations ──

  describe('findCompensations', () => {
    it('maps filters to dotted query parameters', async () => {
      mock.onGet(`${ BASE }/v2/compensations`).reply({ _data: [{ id: 'c_1' }] })

      const result = await service.findCompensations(42, 'ct_1', null, '2026-01-01', '2026-12-31', 'cur')

      expect(mock.history[0].query).toEqual({
        limit: 50,
        cursor: 'cur',
        'person.id': 42,
        'type.id': 'ct_1',
        'effective_date.gte': '2026-01-01',
        'effective_date.lte': '2026-12-31',
      })

      expect(result.total).toBe(1)
    })

    it('omits the date range when no period is supplied', async () => {
      mock.onGet(`${ BASE }/v2/compensations`).reply({})

      const result = await service.findCompensations()

      expect(mock.history[0].query).toEqual({ limit: 50 })
      expect(result).toEqual({ items: [], cursor: null, total: 0 })
    })
  })

  describe('addCompensation', () => {
    it('posts a normalized compensation body', async () => {
      mock.onPost(`${ BASE }/v2/compensations`).reply({ _data: { id: 'c_9' } })

      const result = await service.addCompensation(42, 'ct_1', '75000', 'EUR', '2026-07-01', 'YEARLY', 'e_1')

      expect(result).toEqual({ id: 'c_9' })

      expect(mock.history[0].body).toEqual({
        person: { id: 42 },
        type: { id: 'ct_1' },
        amount: { value: 75000, currency: 'EUR' },
        effective_from: '2026-07-01',
        interval: 'YEARLY',
        legal_entity: { id: 'e_1' },
      })
    })

    it('defaults the interval to ONCE and omits the legal entity', async () => {
      mock.onPost(`${ BASE }/v2/compensations`).reply({ _data: {} })

      await service.addCompensation(42, 'ct_1', 500, 'EUR', '2026-07-01')

      expect(mock.history[0].body.interval).toBe('ONCE')
      expect(mock.history[0].body.legal_entity).toBeUndefined()
    })
  })

  // ── Projects ──

  describe('findProjects', () => {
    it('fetches a single project by id', async () => {
      mock.onGet(`${ BASE }/v2/projects/p_1`).reply({ _data: { id: 'p_1' } })

      const result = await service.findProjects('p_1')

      expect(result).toEqual({ items: [{ id: 'p_1' }], total: 1, cursor: null })
    })

    it('maps the state filter to a status query parameter and filters by parent', async () => {
      mock.onGet(`${ BASE }/v2/projects`).reply({
        _data: [{ id: 'p_2', parent_project: { id: 'p_1' } }, { id: 'p_3' }],
      })

      const result = await service.findProjects(null, 'Archived', 'p_1')

      expect(mock.history[0].query).toEqual({ limit: 50, status: 'ARCHIVED' })
      expect(result.items.map(item => item.id)).toEqual(['p_2'])
    })

    it('maps the Active state and leaves any other state unfiltered', async () => {
      mock.onGet(`${ BASE }/v2/projects`).reply({ _data: [] })

      await service.findProjects(null, 'Active')

      expect(mock.history[0].query).toEqual({ limit: 50, status: 'ACTIVE' })

      mock.reset()
      mock.onGet(`${ BASE }/v2/projects`).reply({ _data: [] })

      await service.findProjects(null, 'Any')

      expect(mock.history[0].query).toEqual({ limit: 50 })
    })
  })

  describe('addProject / updateProject / deleteProject', () => {
    it('creates an active project by default', async () => {
      mock.onPost(`${ BASE }/v2/projects`).reply({ _data: { id: 'p_9' } })

      const result = await service.addProject('Q3 Migration')

      expect(result).toEqual({ id: 'p_9' })
      expect(mock.history[0].body).toEqual({ name: 'Q3 Migration', status: 'ACTIVE' })
    })

    it('creates an archived subproject when asked', async () => {
      mock.onPost(`${ BASE }/v2/projects`).reply({ _data: {} })

      await service.addProject('Legacy', 'p_1', false)

      expect(mock.history[0].body).toEqual({
        name: 'Legacy',
        status: 'ARCHIVED',
        parent_project: { id: 'p_1' },
      })
    })

    it('PATCHes only the supplied project fields', async () => {
      mock.onPatch(`${ BASE }/v2/projects/p_1`).reply({ _data: { id: 'p_1' } })

      await service.updateProject('p_1', 'Renamed', null, 'Archived')

      expect(mock.history[0].body).toEqual({ name: 'Renamed', status: 'ARCHIVED' })
    })

    it('deletes a project', async () => {
      mock.onDelete(`${ BASE }/v2/projects/p_1`).reply({})

      const result = await service.deleteProject('p_1')

      expect(result).toEqual({ deleted: true, projectId: 'p_1' })
    })
  })

  describe('project members', () => {
    it('lists project members', async () => {
      mock.onGet(`${ BASE }/v2/projects/p_1/members`).reply({ _data: [{ person: { id: 42 } }] })

      const result = await service.findProjectMembers('p_1')

      expect(mock.history[0].query).toEqual({ limit: 200 })
      expect(result).toEqual({ projectId: 'p_1', items: [{ person: { id: 42 } }], total: 1 })
    })

    it('refuses when no person is selected', async () => {
      await expect(service.updateProjectMembers('p_1', 'Add', { personIds: [] })).rejects.toThrow(
        /pick at least one person/
      )

      expect(mock.history).toHaveLength(0)
    })

    it('adds members with a POST', async () => {
      mock.onPost(`${ BASE }/v2/projects/p_1/members`).reply({})

      const result = await service.updateProjectMembers('p_1', 'Add', { personIds: [42, 43] })

      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual([{ person: { id: '42' } }, { person: { id: '43' } }])
      expect(result).toEqual({ projectId: 'p_1', operation: 'Add', affected: 2 })
    })

    it('removes members with a DELETE and accepts a comma-separated list', async () => {
      mock.onDelete(`${ BASE }/v2/projects/p_1/members`).reply({})

      const result = await service.updateProjectMembers('p_1', 'Remove', { personIds: '42, 43 ,44' })

      expect(mock.history[0].method).toBe('delete')

      expect(mock.history[0].body).toEqual([
        { person: { id: '42' } },
        { person: { id: '43' } },
        { person: { id: '44' } },
      ])

      expect(result.affected).toBe(3)
    })
  })

  describe('updateProjectMembersSchemaLoader', () => {
    it('labels the field for the chosen operation', async () => {
      const remove = await service.updateProjectMembersSchemaLoader({ criteria: { operation: 'Remove' } })
      const add = await service.updateProjectMembersSchemaLoader({ criteria: { operation: 'Add' } })

      expect(remove[0]).toMatchObject({ name: 'personIds', label: 'People to remove', required: true })
      expect(add[0]).toMatchObject({ name: 'personIds', label: 'People to add', required: true })
    })
  })

  // ── Webhooks ──

  describe('findWebhooks', () => {
    it('fetches a single webhook by id', async () => {
      mock.onGet(`${ BASE }/v2/webhooks/wh_1`).reply({ _data: { id: 'wh_1' } })

      const result = await service.findWebhooks('wh_1')

      expect(result).toEqual({ items: [{ id: 'wh_1' }], total: 1 })
    })

    it('lists webhooks', async () => {
      mock.onGet(`${ BASE }/v2/webhooks`).reply({ _data: [{ id: 'wh_1' }] })

      const result = await service.findWebhooks()

      expect(mock.history[0].query).toEqual({ limit: 100 })
      expect(result.total).toBe(1)
    })
  })

  describe('inspectWebhook', () => {
    it('sends a test ping', async () => {
      mock.onPost(`${ BASE }/v2/webhooks/wh_1/ping`).reply({ _data: { sent: true } })

      const result = await service.inspectWebhook('wh_1', 'Send test ping')

      expect(result).toEqual({ webhookId: 'wh_1', operation: 'Send test ping', result: { sent: true } })
    })

    it('sends a synthetic test event', async () => {
      mock.onPost(`${ BASE }/v2/webhooks/wh_1/test-event`).reply({ _data: { sent: true } })

      const result = await service.inspectWebhook('wh_1', 'Send test event', { eventType: 'person.updated' })

      expect(mock.history[0].body).toEqual({ event_type: 'person.updated' })
      expect(result.eventType).toBe('person.updated')
    })

    it('replays failed deliveries', async () => {
      mock.onPost(`${ BASE }/v2/webhooks/wh_1/redelivery`).reply({ _data: { replayed: 4 } })

      const result = await service.inspectWebhook('wh_1', 'Replay failed deliveries', { since: '2026-05-20T00:00:00Z' })

      expect(mock.history[0].body).toEqual({ since: '2026-05-20T00:00:00Z' })
      expect(result.result).toEqual({ replayed: 4 })
    })

    it('lists recent events', async () => {
      mock.onGet(`${ BASE }/v2/webhooks/wh_1/events`).reply({ _data: [{ id: 'evt_1' }] })

      const result = await service.inspectWebhook('wh_1', 'View recent events')

      expect(mock.history[0].query).toEqual({ limit: 50 })
      expect(result).toEqual({ webhookId: 'wh_1', operation: 'View recent events', items: [{ id: 'evt_1' }], total: 1 })
    })

    it('falls back to the delivery activity log', async () => {
      mock.onGet(`${ BASE }/v2/webhooks/wh_1/activity`).reply({ _data: [{ status: 'SUCCESS' }] })

      const result = await service.inspectWebhook('wh_1')

      expect(result).toEqual({
        webhookId: 'wh_1',
        operation: 'View delivery log',
        items: [{ status: 'SUCCESS' }],
        total: 1,
      })
    })
  })

  describe('inspectWebhookSchemaLoader', () => {
    it('offers an event dropdown for the test-event operation', async () => {
      const schema = await service.inspectWebhookSchemaLoader({ criteria: { operation: 'Send test event' } })

      expect(schema[0]).toMatchObject({ name: 'eventType', required: true })
      expect(schema[0].uiComponent.options.values).toContain('person.updated')
    })

    it('offers a since field for the replay operation', async () => {
      const schema = await service.inspectWebhookSchemaLoader({ criteria: { operation: 'Replay failed deliveries' } })

      expect(schema[0]).toMatchObject({ name: 'since', required: false })
    })

    it('returns no extra fields for the remaining operations', async () => {
      expect(await service.inspectWebhookSchemaLoader({ criteria: { operation: 'Send test ping' } })).toBeNull()
      expect(await service.inspectWebhookSchemaLoader({})).toBeNull()
    })
  })

  // ── Triggers ──

  describe('trigger methods', () => {
    it('exposes the five trigger entry points as no-ops', async () => {
      await expect(service.onPeopleChange()).resolves.toBeUndefined()
      await expect(service.onEmploymentChange()).resolves.toBeUndefined()
      await expect(service.onTimeOffChange()).resolves.toBeUndefined()
      await expect(service.onTimeTrackingChange()).resolves.toBeUndefined()
      await expect(service.onDocumentChange()).resolves.toBeUndefined()
    })
  })

  describe('handleTriggerUpsertWebhook', () => {
    it('creates a webhook subscribing to every Personio event behind the requested triggers', async () => {
      mock.onPost(`${ BASE }/v2/webhooks`).reply({ id: 'wh_new' })

      const result = await service.handleTriggerUpsertWebhook({
        events: [{ name: 'onPeopleChange' }, { name: 'onDocumentChange' }],
        callbackURL: 'https://flowrunner.test/hook',
      })

      const body = mock.history[0].body

      expect(mock.history[0].method).toBe('post')
      expect(body.url).toBe('https://flowrunner.test/hook')
      expect(body.status).toBe('ENABLED')
      expect(body.auth_type).toBe('TOKEN')

      expect(body.enabled_events.sort()).toEqual([
        'document.created',
        'document.deleted',
        'document.signed',
        'document.updated',
        'person.created',
        'person.deleted',
        'person.updated',
      ])

      expect(result.webhookData.webhookId).toBe('wh_new')
      expect(result.webhookData.callbackURL).toBe('https://flowrunner.test/hook')
      expect(typeof result.webhookData.secret).toBe('string')
      expect(result.webhookData.secret).toHaveLength(48)
      expect(body.token).toBe(result.webhookData.secret)
    })

    it('reads the created id from a wrapped response', async () => {
      mock.onPost(`${ BASE }/v2/webhooks`).reply({ _data: { id: 'wh_wrapped' } })

      const result = await service.handleTriggerUpsertWebhook({
        events: [{ name: 'onTimeOffChange' }],
        callbackURL: 'https://flowrunner.test/hook',
      })

      expect(result.webhookData.webhookId).toBe('wh_wrapped')
    })

    it('PATCHes an existing webhook and reuses the stored secret', async () => {
      mock.onPatch(`${ BASE }/v2/webhooks/wh_1`).reply({})

      const result = await service.handleTriggerUpsertWebhook({
        events: [{ name: 'onTimeTrackingChange' }],
        callbackURL: 'https://flowrunner.test/hook',
        webhookData: { webhookId: 'wh_1', secret: 'kept-secret' },
      })

      expect(mock.history[0].method).toBe('patch')
      expect(mock.history[0].body.token).toBe('kept-secret')

      expect(result.webhookData).toEqual({
        webhookId: 'wh_1',
        secret: 'kept-secret',
        callbackURL: 'https://flowrunner.test/hook',
        registeredEvents: [
          'attendance-period.created',
          'attendance-period.updated',
          'attendance-period.deleted',
        ],
      })
    })

    it('ignores unknown trigger names and rethrows API failures', async () => {
      mock.onPost(`${ BASE }/v2/webhooks`).reply({ id: 'wh_new' })

      const result = await service.handleTriggerUpsertWebhook({
        events: [{ name: 'onSomethingElse' }],
        callbackURL: 'https://flowrunner.test/hook',
      })

      expect(mock.history[0].body.enabled_events).toEqual([])
      expect(result.webhookData.webhookId).toBe('wh_new')

      mock.reset()
      mock.onPost(`${ BASE }/v2/webhooks`).replyWithError({ message: 'boom', status: 403 })

      await expect(
        service.handleTriggerUpsertWebhook({ events: [], callbackURL: 'https://flowrunner.test/hook' })
      ).rejects.toThrow(FRIENDLY.insufficientScope)
    })

    it('refreshing a webhook delegates to the upsert path', async () => {
      mock.onPatch(`${ BASE }/v2/webhooks/wh_1`).reply({})

      const result = await service.handleTriggerRefreshWebhook({
        events: [{ name: 'onPeopleChange' }],
        callbackURL: 'https://flowrunner.test/hook',
        webhookData: { webhookId: 'wh_1', secret: 's' },
      })

      expect(mock.history[0].method).toBe('patch')
      expect(result.webhookData.webhookId).toBe('wh_1')
    })
  })

  describe('handleTriggerResolveEvents', () => {
    it('maps a person event to the onPeopleChange trigger with a friendly change label', async () => {
      const result = await service.handleTriggerResolveEvents({
        body: {
          event_name: 'person.updated',
          data: { person: { id: 42 } },
          changes: ['email'],
          occurred_at: '2026-05-22T10:00:00Z',
        },
      })

      expect(result.events).toHaveLength(1)
      expect(result.events[0].name).toBe('onPeopleChange')

      expect(result.events[0].data).toMatchObject({
        event: 'person.updated',
        change: 'Updated',
        person: { id: 42 },
        changes: ['email'],
        occurredAt: '2026-05-22T10:00:00Z',
      })
    })

    it('treats the payload itself as the record when there is no wrapper', async () => {
      const result = await service.handleTriggerResolveEvents({
        body: { event: 'absence-period.updated.status', id: 'ab_1' },
      })

      expect(result.events[0].name).toBe('onTimeOffChange')
      expect(result.events[0].data.change).toBe('Status changed')
      expect(result.events[0].data.timeOff).toMatchObject({ id: 'ab_1' })
      expect(result.events[0].data.changes).toEqual([])
      expect(typeof result.events[0].data.occurredAt).toBe('string')
    })

    it('accepts a matching bearer token', async () => {
      const result = await service.handleTriggerResolveEvents({
        webhookData: { secret: 'sec' },
        headers: { authorization: 'Bearer sec' },
        body: { type: 'document.signed' },
      })

      expect(result.events[0].name).toBe('onDocumentChange')
      expect(result.events[0].data.change).toBe('Signed')
    })

    it('rejects a mismatched token', async () => {
      const result = await service.handleTriggerResolveEvents({
        webhookData: { secret: 'sec' },
        headers: { Authorization: 'wrong' },
        body: { event_name: 'person.created' },
      })

      expect(result).toEqual({ events: [] })
    })

    it('ignores an unknown event name', async () => {
      const result = await service.handleTriggerResolveEvents({ body: { event_name: 'something.weird' } })

      expect(result).toEqual({ events: [] })
    })

    it('handles an empty invocation body', async () => {
      const result = await service.handleTriggerResolveEvents({})

      expect(result).toEqual({ events: [] })
    })
  })

  describe('handleTriggerSelectMatched', () => {
    it('matches triggers with no filter or the Any filter', async () => {
      const result = await service.handleTriggerSelectMatched({
        eventName: 'onPeopleChange',
        body: { change: 'Updated' },
        triggers: [
          { id: 'a', triggerData: {} },
          { id: 'b', triggerData: { eventType: 'Any' } },
          { id: 'c', triggerData: { eventType: 'Updated' } },
          { id: 'd', triggerData: { eventType: 'Created' } },
        ],
      })

      expect(result).toEqual({ ids: ['a', 'b', 'c'] })
    })

    it('returns no ids when there are no triggers', async () => {
      const result = await service.handleTriggerSelectMatched({ eventName: 'onPeopleChange', body: {} })

      expect(result).toEqual({ ids: [] })
    })
  })

  describe('handleTriggerDeleteWebhook', () => {
    it('deletes the stored webhook', async () => {
      mock.onDelete(`${ BASE }/v2/webhooks/wh_1`).reply({})

      const result = await service.handleTriggerDeleteWebhook({ webhookData: { webhookId: 'wh_1' } })

      expect(mock.history[0].method).toBe('delete')
      expect(result).toEqual({})
    })

    it('does nothing when no webhook id is stored', async () => {
      const result = await service.handleTriggerDeleteWebhook({})

      expect(mock.history).toHaveLength(0)
      expect(result).toEqual({})
    })

    it('swallows a cleanup failure', async () => {
      mock.onDelete(`${ BASE }/v2/webhooks/wh_1`).replyWithError({ message: 'gone', status: 404 })

      await expect(
        service.handleTriggerDeleteWebhook({ webhookData: { webhookId: 'wh_1' } })
      ).resolves.toEqual({})
    })
  })

  // ── Sample result loaders ──

  describe('sample result loaders', () => {
    it('shapes the people sample around the selected event filter', async () => {
      const created = await service.onPeopleChange_SampleResultLoader({ criteria: { eventType: 'Created' } })
      const fallback = await service.onPeopleChange_SampleResultLoader({ criteria: { eventType: 'Any' } })

      expect(created).toMatchObject({ event: 'person.created', change: 'Created', changes: [] })
      expect(fallback).toMatchObject({ event: 'person.updated', change: 'Updated', changes: ['email'] })
      expect(fallback.person).toHaveProperty('id', '42')
    })

    it('shapes the employment sample and fills in a termination date', async () => {
      const terminated = await service.onEmploymentChange_SampleResultLoader({
        criteria: { eventType: 'Terminated (effective date)' },
      })
      const fallback = await service.onEmploymentChange_SampleResultLoader()

      expect(terminated.event).toBe('employment.terminated')
      expect(terminated.employment.termination_date).toBe('2026-09-30')
      expect(fallback).toMatchObject({ event: 'employment.updated', change: 'Updated' })
    })

    it('shapes the time-off sample', async () => {
      const created = await service.onTimeOffChange_SampleResultLoader({ criteria: { eventType: 'Created' } })
      const fallback = await service.onTimeOffChange_SampleResultLoader({})

      expect(created.event).toBe('absence-period.created')
      expect(fallback).toMatchObject({ event: 'absence-period.updated.status', change: 'Status changed' })
    })

    it('shapes the time-tracking sample', async () => {
      const deleted = await service.onTimeTrackingChange_SampleResultLoader({ criteria: { eventType: 'Deleted' } })
      const fallback = await service.onTimeTrackingChange_SampleResultLoader({})

      expect(deleted.event).toBe('attendance-period.deleted')
      expect(fallback).toMatchObject({ event: 'attendance-period.created', change: 'Created' })
      expect(fallback.entry).toHaveProperty('project')
    })

    it('shapes the document sample', async () => {
      const updated = await service.onDocumentChange_SampleResultLoader({ criteria: { eventType: 'Updated' } })
      const fallback = await service.onDocumentChange_SampleResultLoader({})

      expect(updated.event).toBe('document.updated')
      expect(updated.document.signed_at).toBeNull()
      expect(fallback).toMatchObject({ event: 'document.signed', change: 'Signed' })
    })

    it('shapes the report sample per source', async () => {
      const custom = await service.runReport_SampleResultLoader({ criteria: { source: 'Custom' } })
      const standard = await service.runReport_SampleResultLoader({})

      expect(custom).toMatchObject({ source: 'Custom', total: 2 })
      expect(standard).toMatchObject({ source: 'Standard', total: 1 })
      expect(standard.columns).toContain('Hours worked')
    })

    it('shapes the webhook inspection sample per operation', async () => {
      const ping = await service.inspectWebhook_SampleResultLoader({ criteria: { operation: 'Send test ping' } })
      const testEvent = await service.inspectWebhook_SampleResultLoader({ criteria: { operation: 'Send test event' } })
      const replay = await service.inspectWebhook_SampleResultLoader({ criteria: { operation: 'Replay failed deliveries' } })
      const recent = await service.inspectWebhook_SampleResultLoader({ criteria: { operation: 'View recent events' } })
      const log = await service.inspectWebhook_SampleResultLoader({})

      expect(ping.result).toMatchObject({ sent: true })
      expect(testEvent.eventType).toBe('person.updated')
      expect(replay.result).toEqual({ replayed: 4 })
      expect(recent.total).toBe(1)
      expect(log).toMatchObject({ operation: 'View delivery log', total: 2 })
    })
  })
})
