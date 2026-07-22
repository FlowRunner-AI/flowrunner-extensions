'use strict'

const { createSandbox } = require('../../../service-sandbox')

const PERSONAL_API_KEY = 'phx_test_personal_key'
const PROJECT_API_KEY = 'phc_test_project_key'
const PROJECT_ID = '12345'
const HOST = 'https://eu.i.posthog.com'

const BASE = `${ HOST }/api/projects/${ PROJECT_ID }`
const CAPTURE_URL = `${ HOST }/i/v0/e/`

const AUTH_HEADERS = {
  'Authorization': `Bearer ${ PERSONAL_API_KEY }`,
  'Content-Type': 'application/json',
}

describe('PostHog Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({
      personalApiKey: PERSONAL_API_KEY,
      projectApiKey: PROJECT_API_KEY,
      projectId: PROJECT_ID,
      host: `${ HOST }///`,
    })

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

  // ── Registration & construction ──

  describe('service registration', () => {
    it('registers the expected config items', () => {
      const configItems = sandbox.getConfigItems()

      expect(configItems.map(item => item.name)).toEqual([
        'personalApiKey',
        'projectApiKey',
        'projectId',
        'host',
      ])

      expect(configItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'personalApiKey', required: true, shared: false, type: 'STRING' }),
          expect.objectContaining({ name: 'projectApiKey', required: false, shared: false, type: 'STRING' }),
          expect.objectContaining({ name: 'projectId', required: true, shared: false, type: 'STRING' }),
          expect.objectContaining({
            name: 'host',
            required: false,
            shared: false,
            defaultValue: 'https://us.i.posthog.com',
          }),
        ])
      )
    })

    it('strips trailing slashes from the configured host', () => {
      expect(service.host).toBe(HOST)
    })
  })

  // ── Ingestion ──

  describe('captureEvent', () => {
    it('posts the event to the capture endpoint with the project API key', async () => {
      mock.onPost(CAPTURE_URL).reply({ status: 1 })

      const result = await service.captureEvent('user signed up', 'ada@example.com', { plan: 'pro' }, '2026-01-11T09:00:00Z')

      expect(result).toEqual({ status: 1 })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(CAPTURE_URL)
      expect(mock.history[0].headers).toMatchObject({ 'Content-Type': 'application/json' })

      expect(mock.history[0].body).toEqual({
        api_key: PROJECT_API_KEY,
        event: 'user signed up',
        distinct_id: 'ada@example.com',
        properties: { plan: 'pro' },
        timestamp: '2026-01-11T09:00:00Z',
      })
    })

    it('omits optional properties and timestamp when not provided', async () => {
      mock.onPost(CAPTURE_URL).reply({ status: 1 })

      await service.captureEvent('button clicked', 'ada@example.com')

      expect(mock.history[0].body).toEqual({
        api_key: PROJECT_API_KEY,
        event: 'button clicked',
        distinct_id: 'ada@example.com',
      })
    })

    it('throws when the distinct id is missing', async () => {
      await expect(service.captureEvent('user signed up')).rejects.toThrow('Distinct ID is required')
      expect(mock.history).toHaveLength(0)
    })

    it('wraps ingestion API errors', async () => {
      mock.onPost(CAPTURE_URL).replyWithError({
        message: 'Bad Request',
        body: { detail: 'Invalid api_key' },
      })

      await expect(service.captureEvent('e', 'ada@example.com')).rejects.toThrow('PostHog API error: Invalid api_key')
    })

    it('falls back to the transport error message when no body is returned', async () => {
      mock.onPost(CAPTURE_URL).replyWithError({ message: 'Network timeout' })

      await expect(service.captureEvent('e', 'ada@example.com')).rejects.toThrow('PostHog API error: Network timeout')
    })
  })

  describe('identifyUser', () => {
    it('sends an $identify event with the properties under $set', async () => {
      mock.onPost(CAPTURE_URL).reply({ status: 1 })

      const result = await service.identifyUser('ada@example.com', { email: 'ada@example.com', name: 'Ada' })

      expect(result).toEqual({ status: 1 })

      expect(mock.history[0].body).toEqual({
        api_key: PROJECT_API_KEY,
        event: '$identify',
        distinct_id: 'ada@example.com',
        properties: { $set: { email: 'ada@example.com', name: 'Ada' } },
      })
    })

    it('defaults to an empty $set when no properties are provided', async () => {
      mock.onPost(CAPTURE_URL).reply({ status: 1 })

      await service.identifyUser('ada@example.com')

      expect(mock.history[0].body.properties).toEqual({ $set: {} })
    })
  })

  describe('createAlias', () => {
    it('sends a $create_alias event linking the alias to the distinct id', async () => {
      mock.onPost(CAPTURE_URL).reply({ status: 1 })

      await service.createAlias('ada@example.com', 'anon-123')

      expect(mock.history[0].body).toEqual({
        api_key: PROJECT_API_KEY,
        event: '$create_alias',
        distinct_id: 'ada@example.com',
        properties: { alias: 'anon-123' },
      })
    })
  })

  // ── Persons ──

  describe('listPersons', () => {
    it('sends the default limit when none is provided', async () => {
      mock.onGet(`${ BASE }/persons/`).reply({ count: 0, results: [] })

      const result = await service.listPersons()

      expect(result).toEqual({ count: 0, results: [] })
      expect(mock.history[0].headers).toMatchObject(AUTH_HEADERS)
      expect(mock.history[0].query).toEqual({ limit: 100 })
      expect(mock.history[0].body).toBeUndefined()
    })

    it('passes search, email and limit filters', async () => {
      mock.onGet(`${ BASE }/persons/`).reply({ count: 1, results: [{ id: 42 }] })

      await service.listPersons('ada', 'ada@example.com', 10)

      expect(mock.history[0].query).toEqual({ search: 'ada', email: 'ada@example.com', limit: 10 })
    })

    it('wraps API errors using the detail field', async () => {
      mock.onGet(`${ BASE }/persons/`).replyWithError({
        message: 'Unauthorized',
        body: { detail: 'Invalid personal API key.' },
      })

      await expect(service.listPersons()).rejects.toThrow('PostHog API error: Invalid personal API key.')
    })
  })

  describe('getPerson', () => {
    it('requests the person by uuid', async () => {
      mock.onGet(`${ BASE }/persons/018f-abc/`).reply({ id: 42, uuid: '018f-abc' })

      const result = await service.getPerson('018f-abc')

      expect(result).toEqual({ id: 42, uuid: '018f-abc' })
      expect(mock.history[0].method).toBe('get')
    })
  })

  describe('updatePersonProperties', () => {
    it('patches the person with the supplied properties', async () => {
      mock.onPatch(`${ BASE }/persons/018f-abc/`).reply({ id: 42, properties: { plan: 'enterprise' } })

      const result = await service.updatePersonProperties('018f-abc', { plan: 'enterprise' })

      expect(result).toEqual({ id: 42, properties: { plan: 'enterprise' } })
      expect(mock.history[0].body).toEqual({ properties: { plan: 'enterprise' } })
    })

    it('defaults to an empty properties object', async () => {
      mock.onPatch(`${ BASE }/persons/018f-abc/`).reply({ id: 42 })

      await service.updatePersonProperties('018f-abc')

      expect(mock.history[0].body).toEqual({ properties: {} })
    })
  })

  describe('deletePerson', () => {
    it('deletes the person and returns a confirmation object', async () => {
      mock.onDelete(`${ BASE }/persons/018f-abc/`).reply('')

      const result = await service.deletePerson('018f-abc')

      expect(result).toEqual({ deleted: true, uuid: '018f-abc' })
      expect(mock.history[0].method).toBe('delete')
    })

    it('throws when the person cannot be deleted', async () => {
      mock.onDelete(`${ BASE }/persons/018f-abc/`).replyWithError({
        message: 'Not Found',
        body: { type: 'invalid_request' },
      })

      await expect(service.deletePerson('018f-abc')).rejects.toThrow('PostHog API error: invalid_request')
    })
  })

  // ── Events ──

  describe('listEvents', () => {
    it('applies the default limit', async () => {
      mock.onGet(`${ BASE }/events/`).reply({ results: [] })

      await service.listEvents()

      expect(mock.history[0].query).toEqual({ limit: 100 })
    })

    it('passes event name and time window filters', async () => {
      mock.onGet(`${ BASE }/events/`).reply({ results: [] })

      await service.listEvents('user signed up', '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z', 25)

      expect(mock.history[0].query).toEqual({
        event: 'user signed up',
        after: '2026-01-01T00:00:00Z',
        before: '2026-02-01T00:00:00Z',
        limit: 25,
      })
    })
  })

  describe('getEvent', () => {
    it('requests the event by id', async () => {
      mock.onGet(`${ BASE }/events/018f-evt/`).reply({ id: '018f-evt', event: 'user signed up' })

      const result = await service.getEvent('018f-evt')

      expect(result).toEqual({ id: '018f-evt', event: 'user signed up' })
    })
  })

  // ── Insights / Query ──

  describe('runQuery', () => {
    it('posts the query object wrapped under query', async () => {
      mock.onPost(`${ BASE }/query/`).reply({ results: [['$pageview', 1250]], columns: ['event', 'count()'] })

      const query = { kind: 'HogQLQuery', query: 'SELECT event, count() FROM events GROUP BY event' }
      const result = await service.runQuery(query)

      expect(result.columns).toEqual(['event', 'count()'])
      expect(mock.history[0].body).toEqual({ query })
    })
  })

  describe('listInsights', () => {
    it('applies the default limit', async () => {
      mock.onGet(`${ BASE }/insights/`).reply({ count: 0, results: [] })

      await service.listInsights()

      expect(mock.history[0].query).toEqual({ limit: 100 })
    })

    it('passes a custom limit', async () => {
      mock.onGet(`${ BASE }/insights/`).reply({ count: 0, results: [] })

      await service.listInsights(5)

      expect(mock.history[0].query).toEqual({ limit: 5 })
    })
  })

  // ── Feature flags ──

  describe('listFeatureFlags', () => {
    it('applies the default limit', async () => {
      mock.onGet(`${ BASE }/feature_flags/`).reply({ count: 0, results: [] })

      await service.listFeatureFlags()

      expect(mock.history[0].query).toEqual({ limit: 100 })
    })
  })

  describe('createFeatureFlag', () => {
    it('defaults active to true and omits missing filters', async () => {
      mock.onPost(`${ BASE }/feature_flags/`).reply({ id: 7, key: 'new-checkout' })

      const result = await service.createFeatureFlag('new-checkout', 'New checkout flow')

      expect(result).toEqual({ id: 7, key: 'new-checkout' })

      expect(mock.history[0].body).toEqual({
        key: 'new-checkout',
        name: 'New checkout flow',
        active: true,
      })
    })

    it('keeps an explicit false active value and passes filters', async () => {
      mock.onPost(`${ BASE }/feature_flags/`).reply({ id: 8 })

      await service.createFeatureFlag('beta', 'Beta', false, { groups: [{ rollout_percentage: 50 }] })

      expect(mock.history[0].body).toEqual({
        key: 'beta',
        name: 'Beta',
        active: false,
        filters: { groups: [{ rollout_percentage: 50 }] },
      })
    })
  })

  describe('getFeatureFlag', () => {
    it('requests the flag by id', async () => {
      mock.onGet(`${ BASE }/feature_flags/7/`).reply({ id: 7, key: 'new-checkout' })

      const result = await service.getFeatureFlag('7')

      expect(result).toEqual({ id: 7, key: 'new-checkout' })
    })
  })

  describe('updateFeatureFlag', () => {
    it('sends only the provided fields', async () => {
      mock.onPatch(`${ BASE }/feature_flags/7/`).reply({ id: 7, active: false })

      const result = await service.updateFeatureFlag('7', false)

      expect(result).toEqual({ id: 7, active: false })
      expect(mock.history[0].body).toEqual({ active: false })
    })

    it('sends name and filters when supplied', async () => {
      mock.onPatch(`${ BASE }/feature_flags/7/`).reply({ id: 7 })

      await service.updateFeatureFlag('7', undefined, 'Renamed', { groups: [] })

      expect(mock.history[0].body).toEqual({ name: 'Renamed', filters: { groups: [] } })
    })
  })

  describe('deleteFeatureFlag', () => {
    it('soft-deletes the flag via PATCH and returns a confirmation', async () => {
      mock.onPatch(`${ BASE }/feature_flags/7/`).reply({ id: 7, deleted: true })

      const result = await service.deleteFeatureFlag('7')

      expect(result).toEqual({ deleted: true, id: '7' })
      expect(mock.history[0].method).toBe('patch')
      expect(mock.history[0].body).toEqual({ deleted: true })
    })
  })

  // ── Cohorts ──

  describe('listCohorts', () => {
    it('applies the default limit', async () => {
      mock.onGet(`${ BASE }/cohorts/`).reply({ count: 0, results: [] })

      await service.listCohorts()

      expect(mock.history[0].query).toEqual({ limit: 100 })
    })

    it('passes a custom limit', async () => {
      mock.onGet(`${ BASE }/cohorts/`).reply({ count: 0, results: [] })

      await service.listCohorts(3)

      expect(mock.history[0].query).toEqual({ limit: 3 })
    })
  })

  describe('getCohort', () => {
    it('requests the cohort by id', async () => {
      mock.onGet(`${ BASE }/cohorts/3/`).reply({ id: 3, name: 'Power users' })

      const result = await service.getCohort('3')

      expect(result).toEqual({ id: 3, name: 'Power users' })
    })
  })

  // ── Annotations ──

  describe('createAnnotation', () => {
    it('posts the content and date marker', async () => {
      mock.onPost(`${ BASE }/annotations/`).reply({ id: 15, content: 'Deployed v2.0' })

      const result = await service.createAnnotation('Deployed v2.0', '2026-01-15T00:00:00Z')

      expect(result).toEqual({ id: 15, content: 'Deployed v2.0' })

      expect(mock.history[0].body).toEqual({
        content: 'Deployed v2.0',
        date_marker: '2026-01-15T00:00:00Z',
      })
    })
  })

  describe('listAnnotations', () => {
    it('applies the default limit', async () => {
      mock.onGet(`${ BASE }/annotations/`).reply({ count: 0, results: [] })

      await service.listAnnotations()

      expect(mock.history[0].query).toEqual({ limit: 100 })
    })
  })

  // ── Dictionaries ──

  describe('getFeatureFlagsDictionary', () => {
    it('maps flags to dictionary items with an active/inactive note', async () => {
      mock.onGet(`${ BASE }/feature_flags/`).reply({
        next: null,
        results: [
          { id: 7, key: 'new-checkout', name: 'New checkout flow', active: true },
          { id: 8, key: 'beta', name: '', active: false },
        ],
      })

      const result = await service.getFeatureFlagsDictionary({})

      expect(result).toEqual({
        items: [
          { label: 'New checkout flow', value: '7', note: 'key: new-checkout - active' },
          { label: 'beta', value: '8', note: 'key: beta - inactive' },
        ],
        cursor: null,
      })

      expect(mock.history[0].query).toEqual({ limit: 50 })
    })

    it('passes the search term and returns the next cursor', async () => {
      mock.onGet(`${ BASE }/feature_flags/`).reply({
        next: `${ BASE }/feature_flags/?cursor=abc`,
        results: [],
      })

      const result = await service.getFeatureFlagsDictionary({ search: 'checkout' })

      expect(mock.history[0].query).toEqual({ search: 'checkout', limit: 50 })
      expect(result.cursor).toBe(`${ BASE }/feature_flags/?cursor=abc`)
    })

    it('follows the cursor URL verbatim without query params', async () => {
      const cursorUrl = `${ BASE }/feature_flags/?cursor=abc`

      mock.onGet(cursorUrl).reply({ next: null, results: [] })

      const result = await service.getFeatureFlagsDictionary({ cursor: cursorUrl })

      expect(mock.history[0].url).toBe(cursorUrl)
      expect(mock.history[0].query).toEqual({})
      expect(result).toEqual({ items: [], cursor: null })
    })

    it('handles a null payload and missing results', async () => {
      mock.onGet(`${ BASE }/feature_flags/`).reply({})

      const result = await service.getFeatureFlagsDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getInsightsDictionary', () => {
    it('maps insights, falling back to derived name and id', async () => {
      mock.onGet(`${ BASE }/insights/`).reply({
        next: null,
        results: [
          { id: 101, name: 'Weekly signups', short_id: 'aB3xYz' },
          { id: 102, name: '', derived_name: 'Pageviews' },
          { id: 103 },
        ],
      })

      const result = await service.getInsightsDictionary({})

      expect(result).toEqual({
        items: [
          { label: 'Weekly signups', value: '101', note: 'short id: aB3xYz' },
          { label: 'Pageviews', value: '102', note: undefined },
          { label: 'Insight 103', value: '103', note: undefined },
        ],
        cursor: null,
      })

      expect(mock.history[0].query).toEqual({ limit: 50 })
    })

    it('passes the search term', async () => {
      mock.onGet(`${ BASE }/insights/`).reply({ results: [] })

      await service.getInsightsDictionary({ search: 'signups' })

      expect(mock.history[0].query).toEqual({ search: 'signups', limit: 50 })
    })

    it('follows the cursor URL', async () => {
      const cursorUrl = `${ BASE }/insights/?cursor=xyz`

      mock.onGet(cursorUrl).reply({ next: null, results: [] })

      const result = await service.getInsightsDictionary({ cursor: cursorUrl })

      expect(mock.history[0].url).toBe(cursorUrl)
      expect(result).toEqual({ items: [], cursor: null })
    })

    it('handles a null payload', async () => {
      mock.onGet(`${ BASE }/insights/`).reply({ results: null })

      const result = await service.getInsightsDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })
  })
})

// ── Alternate configuration ──

describe('PostHog Service (alternate configuration)', () => {
  let previousFlowrunner
  let altSandbox
  let altService

  beforeAll(() => {
    previousFlowrunner = global.Flowrunner

    jest.resetModules()

    altSandbox = createSandbox({
      personalApiKey: PERSONAL_API_KEY,
      projectId: PROJECT_ID,
    })

    require('../src/index.js')

    altService = altSandbox.getService()
  })

  afterAll(() => {
    altSandbox.cleanup()
    jest.resetModules()
    global.Flowrunner = previousFlowrunner
  })

  it('falls back to the US cloud host when none is configured', () => {
    expect(altService.host).toBe('https://us.i.posthog.com')
  })

  it('throws when capturing an event without a project API key', async () => {
    await expect(altService.captureEvent('e', 'ada@example.com'))
      .rejects.toThrow('Project API Key (phc_...) is required for event ingestion')
  })

  it('throws when identifying a user without a project API key', async () => {
    await expect(altService.identifyUser('ada@example.com', {}))
      .rejects.toThrow('Project API Key (phc_...) is required for event ingestion')
  })

  it('throws when creating an alias without a project API key', async () => {
    await expect(altService.createAlias('ada@example.com', 'anon-1'))
      .rejects.toThrow('Project API Key (phc_...) is required for event ingestion')
  })
})
