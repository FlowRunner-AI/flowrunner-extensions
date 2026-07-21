'use strict'

const { createSandbox } = require('../../../service-sandbox')

const PROJECT_TOKEN = 'test-project-token'
const SA_USERNAME = 'test-sa-user'
const SA_SECRET = 'test-sa-secret'
const PROJECT_ID = '12345'

const INGESTION_BASE = 'https://api.mixpanel.com'
const QUERY_BASE = 'https://mixpanel.com/api'
const DATA_BASE = 'https://data.mixpanel.com/api/2.0'

const SA_AUTH = `Basic ${ Buffer.from(`${ SA_USERNAME }:${ SA_SECRET }`).toString('base64') }`

describe('Mixpanel Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({
      region: 'US',
      projectToken: PROJECT_TOKEN,
      serviceAccountUsername: SA_USERNAME,
      serviceAccountSecret: SA_SECRET,
      projectId: PROJECT_ID,
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

  // ── Registration ──

  describe('service registration', () => {
    it('registers with correct config items', () => {
      const configs = sandbox.getConfigItems()

      expect(configs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'region', required: true, shared: false, type: 'CHOICE' }),
          expect.objectContaining({ name: 'projectToken', required: true, shared: false, type: 'STRING' }),
          expect.objectContaining({ name: 'serviceAccountUsername', required: false, shared: false, type: 'STRING' }),
          expect.objectContaining({ name: 'serviceAccountSecret', required: false, shared: false, type: 'STRING' }),
          expect.objectContaining({ name: 'projectId', required: false, shared: false, type: 'STRING' }),
        ])
      )
    })
  })

  // ── Event Ingestion ──

  describe('trackEvent', () => {
    it('sends correct request with required params', async () => {
      mock.onPost(`${ INGESTION_BASE }/track`).reply({ status: 1, error: null })

      const result = await service.trackEvent('Sign Up', 'user-1')

      expect(result).toEqual({ status: 1, error: null })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({ verbose: 1, ip: 0 })
      expect(mock.history[0].headers).toMatchObject({ 'Content-Type': 'application/json' })

      const body = mock.history[0].body
      expect(body).toHaveLength(1)
      expect(body[0].event).toBe('Sign Up')
      expect(body[0].properties).toMatchObject({
        token: PROJECT_TOKEN,
        distinct_id: 'user-1',
      })
    })

    it('includes optional properties, time, and insertId', async () => {
      mock.onPost(`${ INGESTION_BASE }/track`).reply({ status: 1, error: null })

      await service.trackEvent('Purchase', 'user-2', { amount: 49.99 }, 1700000000, 'insert-abc')

      const body = mock.history[0].body
      expect(body[0].event).toBe('Purchase')
      expect(body[0].properties).toMatchObject({
        token: PROJECT_TOKEN,
        distinct_id: 'user-2',
        amount: 49.99,
        time: 1700000000,
        '$insert_id': 'insert-abc',
      })
    })

    it('throws when ingestion returns status 0', async () => {
      mock.onPost(`${ INGESTION_BASE }/track`).reply({ status: 0, error: 'invalid token' })

      await expect(service.trackEvent('Test', 'user-1')).rejects.toThrow('Mixpanel API error: invalid token')
    })

    it('throws on HTTP error', async () => {
      mock.onPost(`${ INGESTION_BASE }/track`).replyWithError({
        message: 'Bad Request',
        body: { error: 'Bad payload' },
      })

      await expect(service.trackEvent('Test', 'user-1')).rejects.toThrow('Mixpanel API error: Bad payload')
    })
  })

  describe('importEvents', () => {
    it('sends correct request with service account auth', async () => {
      mock.onPost(`${ INGESTION_BASE }/import`).reply({ code: 200, num_records_imported: 1, status: 'OK' })

      const events = [
        { eventName: 'Old Event', distinctId: 'user-1', time: 1600000000, properties: { plan: 'pro' } },
      ]

      const result = await service.importEvents(events)

      expect(result).toEqual({ code: 200, num_records_imported: 1, status: 'OK' })
      expect(mock.history[0].headers).toMatchObject({
        Authorization: SA_AUTH,
        'Content-Type': 'application/json',
      })
      expect(mock.history[0].query).toMatchObject({ strict: 1, project_id: PROJECT_ID })

      const body = mock.history[0].body
      expect(body).toHaveLength(1)
      expect(body[0].event).toBe('Old Event')
      expect(body[0].properties).toMatchObject({
        distinct_id: 'user-1',
        time: 1600000000,
        plan: 'pro',
      })
      expect(body[0].properties).toHaveProperty('$insert_id')
    })

    it('uses provided insertId when given', async () => {
      mock.onPost(`${ INGESTION_BASE }/import`).reply({ code: 200, num_records_imported: 1, status: 'OK' })

      await service.importEvents([
        { eventName: 'Ev', distinctId: 'u1', time: 1600000000, insertId: 'my-id' },
      ])

      expect(mock.history[0].body[0].properties['$insert_id']).toBe('my-id')
    })
  })

  // ── User Profiles ──

  describe('setProfileProperties', () => {
    it('sends $set operation with correct body', async () => {
      mock.onPost(`${ INGESTION_BASE }/engage`).reply({ status: 1, error: null })

      const result = await service.setProfileProperties('user-1', { '$name': 'Jane', plan: 'pro' })

      expect(result).toEqual({ status: 1, error: null })

      const body = mock.history[0].body
      expect(body).toHaveLength(1)
      expect(body[0]).toMatchObject({
        '$token': PROJECT_TOKEN,
        '$distinct_id': 'user-1',
        '$set': { '$name': 'Jane', plan: 'pro' },
      })
    })

    it('includes $ignore_time when ignoreTime is true', async () => {
      mock.onPost(`${ INGESTION_BASE }/engage`).reply({ status: 1, error: null })

      await service.setProfileProperties('user-1', { plan: 'pro' }, true)

      expect(mock.history[0].body[0]).toMatchObject({ '$ignore_time': true })
    })

    it('does not include $ignore_time when ignoreTime is falsy', async () => {
      mock.onPost(`${ INGESTION_BASE }/engage`).reply({ status: 1, error: null })

      await service.setProfileProperties('user-1', { plan: 'pro' })

      expect(mock.history[0].body[0]).not.toHaveProperty('$ignore_time')
    })
  })

  describe('setProfilePropertiesOnce', () => {
    it('sends $set_once operation', async () => {
      mock.onPost(`${ INGESTION_BASE }/engage`).reply({ status: 1, error: null })

      await service.setProfilePropertiesOnce('user-1', { first_source: 'newsletter' })

      expect(mock.history[0].body[0]).toMatchObject({
        '$token': PROJECT_TOKEN,
        '$distinct_id': 'user-1',
        '$set_once': { first_source: 'newsletter' },
      })
    })
  })

  describe('incrementProfileProperties', () => {
    it('sends $add operation', async () => {
      mock.onPost(`${ INGESTION_BASE }/engage`).reply({ status: 1, error: null })

      await service.incrementProfileProperties('user-1', { purchase_count: 1 })

      expect(mock.history[0].body[0]).toMatchObject({
        '$token': PROJECT_TOKEN,
        '$distinct_id': 'user-1',
        '$add': { purchase_count: 1 },
      })
    })
  })

  describe('appendToProfileListProperties', () => {
    it('sends $append operation', async () => {
      mock.onPost(`${ INGESTION_BASE }/engage`).reply({ status: 1, error: null })

      await service.appendToProfileListProperties('user-1', { items: 'sku-123' })

      expect(mock.history[0].body[0]).toMatchObject({
        '$token': PROJECT_TOKEN,
        '$distinct_id': 'user-1',
        '$append': { items: 'sku-123' },
      })
    })
  })

  describe('unionProfileListProperties', () => {
    it('sends $union operation', async () => {
      mock.onPost(`${ INGESTION_BASE }/engage`).reply({ status: 1, error: null })

      await service.unionProfileListProperties('user-1', { tags: ['vip', 'beta'] })

      expect(mock.history[0].body[0]).toMatchObject({
        '$token': PROJECT_TOKEN,
        '$distinct_id': 'user-1',
        '$union': { tags: ['vip', 'beta'] },
      })
    })
  })

  describe('removeFromProfileListProperties', () => {
    it('sends $remove operation', async () => {
      mock.onPost(`${ INGESTION_BASE }/engage`).reply({ status: 1, error: null })

      await service.removeFromProfileListProperties('user-1', { tags: 'beta' })

      expect(mock.history[0].body[0]).toMatchObject({
        '$token': PROJECT_TOKEN,
        '$distinct_id': 'user-1',
        '$remove': { tags: 'beta' },
      })
    })
  })

  describe('unsetProfileProperties', () => {
    it('sends $unset operation', async () => {
      mock.onPost(`${ INGESTION_BASE }/engage`).reply({ status: 1, error: null })

      await service.unsetProfileProperties('user-1', ['legacy_plan', 'trial_ends'])

      expect(mock.history[0].body[0]).toMatchObject({
        '$token': PROJECT_TOKEN,
        '$distinct_id': 'user-1',
        '$unset': ['legacy_plan', 'trial_ends'],
      })
    })
  })

  describe('deleteProfile', () => {
    it('sends $delete operation', async () => {
      mock.onPost(`${ INGESTION_BASE }/engage`).reply({ status: 1, error: null })

      await service.deleteProfile('user-1')

      expect(mock.history[0].body[0]).toMatchObject({
        '$token': PROJECT_TOKEN,
        '$distinct_id': 'user-1',
        '$delete': null,
      })
    })

    it('includes $ignore_alias when ignoreAlias is true', async () => {
      mock.onPost(`${ INGESTION_BASE }/engage`).reply({ status: 1, error: null })

      await service.deleteProfile('user-1', true)

      expect(mock.history[0].body[0]).toMatchObject({ '$ignore_alias': true })
    })
  })

  describe('batchUpdateProfiles', () => {
    it('injects $token and sends batch to /engage', async () => {
      mock.onPost(`${ INGESTION_BASE }/engage`).reply({ status: 1, error: null })

      const updates = [
        { '$distinct_id': 'user-1', '$set': { plan: 'pro' } },
        { '$distinct_id': 'user-2', '$unset': ['trial'] },
      ]

      await service.batchUpdateProfiles(updates)

      const body = mock.history[0].body
      expect(body).toHaveLength(2)
      expect(body[0]).toMatchObject({ '$token': PROJECT_TOKEN, '$distinct_id': 'user-1', '$set': { plan: 'pro' } })
      expect(body[1]).toMatchObject({ '$token': PROJECT_TOKEN, '$distinct_id': 'user-2', '$unset': ['trial'] })
    })
  })

  // ── Group Profiles ──

  describe('setGroupProperties', () => {
    it('sends $set operation to /groups', async () => {
      mock.onPost(`${ INGESTION_BASE }/groups`).reply({ status: 1, error: null })

      await service.setGroupProperties('company', 'acme', { industry: 'Tech' })

      const body = mock.history[0].body
      expect(body).toHaveLength(1)
      expect(body[0]).toMatchObject({
        '$token': PROJECT_TOKEN,
        '$group_key': 'company',
        '$group_id': 'acme',
        '$set': { industry: 'Tech' },
      })
    })
  })

  describe('setGroupPropertiesOnce', () => {
    it('sends $set_once operation to /groups', async () => {
      mock.onPost(`${ INGESTION_BASE }/groups`).reply({ status: 1, error: null })

      await service.setGroupPropertiesOnce('company', 'acme', { founded: '2020' })

      expect(mock.history[0].body[0]).toMatchObject({
        '$set_once': { founded: '2020' },
      })
    })
  })

  describe('unionGroupListProperties', () => {
    it('sends $union operation to /groups', async () => {
      mock.onPost(`${ INGESTION_BASE }/groups`).reply({ status: 1, error: null })

      await service.unionGroupListProperties('company', 'acme', { products: ['analytics'] })

      expect(mock.history[0].body[0]).toMatchObject({
        '$union': { products: ['analytics'] },
      })
    })
  })

  describe('removeFromGroupListProperties', () => {
    it('sends $remove operation to /groups', async () => {
      mock.onPost(`${ INGESTION_BASE }/groups`).reply({ status: 1, error: null })

      await service.removeFromGroupListProperties('company', 'acme', { products: 'legacy' })

      expect(mock.history[0].body[0]).toMatchObject({
        '$remove': { products: 'legacy' },
      })
    })
  })

  describe('unsetGroupProperties', () => {
    it('sends $unset operation to /groups', async () => {
      mock.onPost(`${ INGESTION_BASE }/groups`).reply({ status: 1, error: null })

      await service.unsetGroupProperties('company', 'acme', ['deprecated'])

      expect(mock.history[0].body[0]).toMatchObject({
        '$unset': ['deprecated'],
      })
    })
  })

  describe('deleteGroupProfile', () => {
    it('sends $delete operation to /groups', async () => {
      mock.onPost(`${ INGESTION_BASE }/groups`).reply({ status: 1, error: null })

      await service.deleteGroupProfile('company', 'acme')

      expect(mock.history[0].body[0]).toMatchObject({
        '$token': PROJECT_TOKEN,
        '$group_key': 'company',
        '$group_id': 'acme',
        '$delete': null,
      })
    })
  })

  describe('batchUpdateGroupProfiles', () => {
    it('injects $token and sends batch to /groups', async () => {
      mock.onPost(`${ INGESTION_BASE }/groups`).reply({ status: 1, error: null })

      const updates = [
        { '$group_key': 'company', '$group_id': 'acme', '$set': { tier: 'enterprise' } },
      ]

      await service.batchUpdateGroupProfiles(updates)

      expect(mock.history[0].body[0]).toMatchObject({ '$token': PROJECT_TOKEN })
    })
  })

  // ── Identity Management ──

  describe('createAlias', () => {
    it('sends $create_alias event to /track', async () => {
      mock.onPost(`${ INGESTION_BASE }/track`).reply({ status: 1, error: null })

      await service.createAlias('user-1', 'alias-1')

      const body = mock.history[0].body
      expect(body[0].event).toBe('$create_alias')
      expect(body[0].properties).toMatchObject({
        distinct_id: 'user-1',
        alias: 'alias-1',
        token: PROJECT_TOKEN,
      })
    })
  })

  describe('createIdentity', () => {
    it('sends $identify event to /track', async () => {
      mock.onPost(`${ INGESTION_BASE }/track`).reply({ status: 1, error: null })

      await service.createIdentity('user-1', 'anon-uuid')

      const body = mock.history[0].body
      expect(body[0].event).toBe('$identify')
      expect(body[0].properties).toMatchObject({
        '$identified_id': 'user-1',
        '$anon_id': 'anon-uuid',
        token: PROJECT_TOKEN,
      })
    })
  })

  describe('mergeIdentities', () => {
    it('sends $merge event to /import with service account auth', async () => {
      mock.onPost(`${ INGESTION_BASE }/import`).reply({ code: 200, num_records_imported: 1, status: 'OK' })

      await service.mergeIdentities('id-1', 'id-2')

      expect(mock.history[0].headers).toMatchObject({ Authorization: SA_AUTH })
      expect(mock.history[0].query).toMatchObject({ strict: 1, project_id: PROJECT_ID })

      const body = mock.history[0].body
      expect(body[0].event).toBe('$merge')
      expect(body[0].properties).toEqual({ '$distinct_ids': ['id-1', 'id-2'] })
    })
  })

  // ── Analytics Queries ──

  describe('runSegmentationQuery', () => {
    it('sends correct query with required params', async () => {
      const mockResponse = { legend_size: 1, data: { series: ['2026-07-01'], values: {} } }
      mock.onGet(`${ QUERY_BASE }/query/segmentation`).reply(mockResponse)

      const result = await service.runSegmentationQuery('Sign Up', '2026-07-01', '2026-07-02')

      expect(result).toEqual(mockResponse)
      expect(mock.history[0].headers).toMatchObject({ Authorization: SA_AUTH })
      expect(mock.history[0].query).toMatchObject({
        project_id: PROJECT_ID,
        event: 'Sign Up',
        from_date: '2026-07-01',
        to_date: '2026-07-02',
      })
    })

    it('resolves choice values for unit and type', async () => {
      mock.onGet(`${ QUERY_BASE }/query/segmentation`).reply({})

      await service.runSegmentationQuery('Ev', '2026-01-01', '2026-01-02', null, 'Hour', null, 'Unique')

      expect(mock.history[0].query).toMatchObject({
        unit: 'hour',
        type: 'unique',
      })
    })

    it('passes optional on, where, and limit', async () => {
      mock.onGet(`${ QUERY_BASE }/query/segmentation`).reply({})

      await service.runSegmentationQuery('Ev', '2026-01-01', '2026-01-02', 'properties["$os"]', 'Day', 'properties["plan"]=="pro"', 'General', 100)

      expect(mock.history[0].query).toMatchObject({
        on: 'properties["$os"]',
        where: 'properties["plan"]=="pro"',
        limit: 100,
      })
    })
  })

  describe('queryEventCounts', () => {
    it('sends correct query with JSON-stringified events', async () => {
      mock.onGet(`${ QUERY_BASE }/query/events`).reply({ data: {} })

      await service.queryEventCounts(['Sign Up', 'Purchase'], 'General', 'Day', '2026-07-01', '2026-07-02')

      expect(mock.history[0].query).toMatchObject({
        event: JSON.stringify(['Sign Up', 'Purchase']),
        type: 'general',
        unit: 'day',
        from_date: '2026-07-01',
        to_date: '2026-07-02',
        project_id: PROJECT_ID,
      })
    })
  })

  describe('getTodaysTopEvents', () => {
    it('sends correct query', async () => {
      mock.onGet(`${ QUERY_BASE }/query/events/top`).reply({ events: [] })

      await service.getTodaysTopEvents('Unique', 10)

      expect(mock.history[0].query).toMatchObject({
        type: 'unique',
        limit: 10,
        project_id: PROJECT_ID,
      })
    })
  })

  describe('listTopEventNames', () => {
    it('returns event names', async () => {
      mock.onGet(`${ QUERY_BASE }/query/events/names`).reply(['Sign Up', 'Purchase'])

      const result = await service.listTopEventNames('General', 50)

      expect(result).toEqual(['Sign Up', 'Purchase'])
      expect(mock.history[0].query).toMatchObject({
        type: 'general',
        limit: 50,
      })
    })
  })

  describe('queryInsightsReport', () => {
    it('sends correct query with bookmarkId', async () => {
      mock.onGet(`${ QUERY_BASE }/query/insights`).reply({ computed_at: '2026-07-01' })

      await service.queryInsightsReport(12345)

      expect(mock.history[0].query).toMatchObject({
        bookmark_id: 12345,
        project_id: PROJECT_ID,
      })
    })

    it('includes optional workspaceId', async () => {
      mock.onGet(`${ QUERY_BASE }/query/insights`).reply({})

      await service.queryInsightsReport(12345, 999)

      expect(mock.history[0].query).toMatchObject({
        bookmark_id: 12345,
        workspace_id: 999,
      })
    })
  })

  // ── Funnels & Retention ──

  describe('runFunnelQuery', () => {
    it('sends correct query with required params', async () => {
      mock.onGet(`${ QUERY_BASE }/query/funnels`).reply({ meta: {}, data: {} })

      await service.runFunnelQuery('7509', '2026-07-01', '2026-07-10')

      expect(mock.history[0].query).toMatchObject({
        funnel_id: '7509',
        from_date: '2026-07-01',
        to_date: '2026-07-10',
        project_id: PROJECT_ID,
      })
    })

    it('resolves choice values for lengthUnit and unit', async () => {
      mock.onGet(`${ QUERY_BASE }/query/funnels`).reply({})

      await service.runFunnelQuery('7509', '2026-07-01', '2026-07-10', 7, 'Hour', 'Week')

      expect(mock.history[0].query).toMatchObject({
        length: 7,
        length_unit: 'hour',
        unit: 'week',
      })
    })

    it('passes optional on, where, and limit', async () => {
      mock.onGet(`${ QUERY_BASE }/query/funnels`).reply({})

      await service.runFunnelQuery('7509', '2026-07-01', '2026-07-10', null, null, null, 'properties["$os"]', 'properties["plan"]=="pro"', 500)

      expect(mock.history[0].query).toMatchObject({
        on: 'properties["$os"]',
        where: 'properties["plan"]=="pro"',
        limit: 500,
      })
    })
  })

  describe('listSavedFunnels', () => {
    it('returns funnels list', async () => {
      const funnels = [{ funnel_id: 7509, name: 'Signup funnel' }]
      mock.onGet(`${ QUERY_BASE }/query/funnels/list`).reply(funnels)

      const result = await service.listSavedFunnels()

      expect(result).toEqual(funnels)
    })
  })

  describe('runRetentionQuery', () => {
    it('sends correct query with required and optional params', async () => {
      mock.onGet(`${ QUERY_BASE }/query/retention`).reply({})

      await service.runRetentionQuery(
        '2026-07-01', '2026-07-10',
        'Birth', 'Sign Up', 'Purchase',
        null, null,
        1, 7, 'Week',
        null, null, true
      )

      expect(mock.history[0].query).toMatchObject({
        from_date: '2026-07-01',
        to_date: '2026-07-10',
        retention_type: 'birth',
        born_event: 'Sign Up',
        event: 'Purchase',
        interval: 1,
        interval_count: 7,
        unit: 'week',
        unbounded_retention: true,
        project_id: PROJECT_ID,
      })
    })

    it('omits unbounded_retention when falsy', async () => {
      mock.onGet(`${ QUERY_BASE }/query/retention`).reply({})

      await service.runRetentionQuery('2026-07-01', '2026-07-10')

      expect(mock.history[0].query).not.toHaveProperty('unbounded_retention')
    })

    it('passes segment by and limit', async () => {
      mock.onGet(`${ QUERY_BASE }/query/retention`).reply({})

      await service.runRetentionQuery(
        '2026-07-01', '2026-07-10',
        null, null, null,
        null, null,
        null, null, null,
        'properties["$os"]', 100
      )

      expect(mock.history[0].query).toMatchObject({
        on: 'properties["$os"]',
        limit: 100,
      })
    })
  })

  // ── Profiles & Cohorts ──

  describe('queryProfiles', () => {
    it('sends form-encoded POST request to /query/engage', async () => {
      mock.onPost(`${ QUERY_BASE }/query/engage`).reply({ status: 'ok', results: [] })

      const result = await service.queryProfiles('properties["plan"]=="pro"')

      expect(result).toEqual({ status: 'ok', results: [] })
      expect(mock.history[0].headers).toMatchObject({ Authorization: SA_AUTH })
    })

    it('includes outputProperties as JSON string', async () => {
      mock.onPost(`${ QUERY_BASE }/query/engage`).reply({ status: 'ok', results: [] })

      await service.queryProfiles(null, ['$email', '$name'])

      const sentBody = mock.history[0].body
      expect(sentBody).toContain('output_properties')
      expect(sentBody).toContain(encodeURIComponent(JSON.stringify(['$email', '$name'])))
    })

    it('includes cohort filter as JSON string', async () => {
      mock.onPost(`${ QUERY_BASE }/query/engage`).reply({ status: 'ok', results: [] })

      await service.queryProfiles(null, null, '1150561')

      const sentBody = mock.history[0].body
      expect(sentBody).toContain('filter_by_cohort')
    })

    it('includes distinct_ids as JSON string', async () => {
      mock.onPost(`${ QUERY_BASE }/query/engage`).reply({ status: 'ok', results: [] })

      await service.queryProfiles(null, null, null, ['user-1', 'user-2'])

      const sentBody = mock.history[0].body
      expect(sentBody).toContain('distinct_ids')
    })

    it('includes pagination params', async () => {
      mock.onPost(`${ QUERY_BASE }/query/engage`).reply({ status: 'ok', results: [] })

      await service.queryProfiles(null, null, null, null, null, null, 1, 'session-abc')

      const sentBody = mock.history[0].body
      expect(sentBody).toContain('page=1')
      expect(sentBody).toContain('session_id=session-abc')
    })

    it('includes include_all_users when cohort and includeAllUsers are set', async () => {
      mock.onPost(`${ QUERY_BASE }/query/engage`).reply({ status: 'ok', results: [] })

      await service.queryProfiles(null, null, '1150561', null, null, true)

      const sentBody = mock.history[0].body
      expect(sentBody).toContain('include_all_users=true')
    })

    it('does not include include_all_users when cohort is not set', async () => {
      mock.onPost(`${ QUERY_BASE }/query/engage`).reply({ status: 'ok', results: [] })

      await service.queryProfiles(null, null, null, null, null, true)

      const sentBody = mock.history[0].body
      expect(sentBody).not.toContain('include_all_users')
    })

    it('includes data_group_id when provided', async () => {
      mock.onPost(`${ QUERY_BASE }/query/engage`).reply({ status: 'ok', results: [] })

      await service.queryProfiles(null, null, null, null, 'group-key-1')

      const sentBody = mock.history[0].body
      expect(sentBody).toContain('data_group_id=group-key-1')
    })
  })

  describe('listCohorts', () => {
    it('returns cohorts list via POST to /query/cohorts/list', async () => {
      const cohorts = [{ id: 123, name: 'Power Users', count: 100 }]
      mock.onPost(`${ QUERY_BASE }/query/cohorts/list`).reply(cohorts)

      const result = await service.listCohorts()

      expect(result).toEqual(cohorts)
    })
  })

  describe('getActivityStream', () => {
    it('sends correct query with JSON-stringified distinct IDs', async () => {
      mock.onGet(`${ QUERY_BASE }/query/stream/query`).reply({ status: 'ok', results: {} })

      await service.getActivityStream(['user-1'], '2026-07-01', '2026-07-02')

      expect(mock.history[0].query).toMatchObject({
        distinct_ids: JSON.stringify(['user-1']),
        from_date: '2026-07-01',
        to_date: '2026-07-02',
        project_id: PROJECT_ID,
      })
    })
  })

  // ── Data Export ──

  describe('exportEvents', () => {
    it('returns parsed events inline by default', async () => {
      const jsonlResponse = '{"event":"Sign Up","properties":{"distinct_id":"u1"}}\n{"event":"Purchase","properties":{"distinct_id":"u2"}}'
      mock.onGet(`${ DATA_BASE }/export`).reply(jsonlResponse)

      const result = await service.exportEvents('2026-07-01', '2026-07-02')

      expect(result.count).toBe(2)
      expect(result.savedToFile).toBe(false)
      expect(result.events).toHaveLength(2)
      expect(result.events[0].event).toBe('Sign Up')

      expect(mock.history[0].headers).toMatchObject({ Authorization: SA_AUTH })
      expect(mock.history[0].query).toMatchObject({
        project_id: PROJECT_ID,
        from_date: '2026-07-01',
        to_date: '2026-07-02',
        limit: 1000,
      })
    })

    it('passes event and where filters', async () => {
      mock.onGet(`${ DATA_BASE }/export`).reply('')

      await service.exportEvents('2026-07-01', '2026-07-02', ['Purchase'], 'properties["$os"]=="Linux"')

      expect(mock.history[0].query).toMatchObject({
        event: JSON.stringify(['Purchase']),
        where: 'properties["$os"]=="Linux"',
      })
    })

    it('uses custom limit when provided', async () => {
      mock.onGet(`${ DATA_BASE }/export`).reply('')

      await service.exportEvents('2026-07-01', '2026-07-02', null, null, 5000)

      expect(mock.history[0].query).toMatchObject({ limit: 5000 })
    })

    it('skips unparsable JSONL lines', async () => {
      mock.onGet(`${ DATA_BASE }/export`).reply('{"event":"Good"}\nnot-json\n{"event":"Also Good"}')

      const result = await service.exportEvents('2026-07-01', '2026-07-02')

      expect(result.count).toBe(2)
      expect(result.events).toHaveLength(2)
    })

    it('includes time_in_ms when timeInMs is enabled', async () => {
      mock.onGet(`${ DATA_BASE }/export`).reply('')

      await service.exportEvents('2026-07-01', '2026-07-02', null, null, null, true)

      expect(mock.history[0].query).toMatchObject({ time_in_ms: true })
    })

    it('saves to file when saveToFile is enabled', async () => {
      const jsonlResponse = '{"event":"Sign Up","properties":{"distinct_id":"u1"}}\n{"event":"Purchase","properties":{"distinct_id":"u2"}}'
      mock.onGet(`${ DATA_BASE }/export`).reply(jsonlResponse)

      const uploadMock = jest.fn().mockResolvedValue({ url: 'https://storage.example.com/export.jsonl' })
      service.flowrunner = { Files: { uploadFile: uploadMock } }

      const result = await service.exportEvents('2026-07-01', '2026-07-02', null, null, null, false, true)

      expect(result.savedToFile).toBe(true)
      expect(result.count).toBe(2)
      expect(result.fileUrl).toBe('https://storage.example.com/export.jsonl')
      expect(uploadMock).toHaveBeenCalledTimes(1)

      const [buffer, options] = uploadMock.mock.calls[0]
      expect(Buffer.isBuffer(buffer)).toBe(true)
      expect(options).toMatchObject({ generateUrl: true, overwrite: true })
      expect(options.filename).toMatch(/^mixpanel_export_2026-07-01_2026-07-02_\d+\.jsonl$/)
    })

    it('uses provided fileOptions when saving to file', async () => {
      mock.onGet(`${ DATA_BASE }/export`).reply('{"event":"Test"}')

      const uploadMock = jest.fn().mockResolvedValue({ url: 'https://storage.example.com/export.jsonl' })
      service.flowrunner = { Files: { uploadFile: uploadMock } }

      await service.exportEvents('2026-07-01', '2026-07-02', null, null, null, false, true, { scope: 'APP' })

      const [, options] = uploadMock.mock.calls[0]
      expect(options.scope).toBe('APP')
    })

    it('does not apply default limit when saveToFile is enabled', async () => {
      mock.onGet(`${ DATA_BASE }/export`).reply('')

      const uploadMock = jest.fn().mockResolvedValue({ url: 'https://storage.example.com/export.jsonl' })
      service.flowrunner = { Files: { uploadFile: uploadMock } }

      await service.exportEvents('2026-07-01', '2026-07-02', null, null, null, false, true)

      expect(mock.history[0].query.limit).toBeUndefined()
    })

    it('handles non-string response by stringifying it', async () => {
      mock.onGet(`${ DATA_BASE }/export`).reply({ event: 'Test', properties: { distinct_id: 'u1' } })

      const result = await service.exportEvents('2026-07-01', '2026-07-02')

      expect(result.count).toBeGreaterThanOrEqual(1)
      expect(result.savedToFile).toBe(false)
    })
  })

  // ── Lexicon ──

  describe('listLexiconSchemas', () => {
    it('sends request without entity type suffix when omitted', async () => {
      mock.onGet(`${ QUERY_BASE }/app/projects/${ PROJECT_ID }/schemas`).reply({ status: 'ok', results: [] })

      await service.listLexiconSchemas()

      expect(mock.history).toHaveLength(1)
    })

    it('appends entity type suffix when provided', async () => {
      mock.onGet(`${ QUERY_BASE }/app/projects/${ PROJECT_ID }/schemas/event`).reply({ status: 'ok', results: [] })

      await service.listLexiconSchemas('Event')

      expect(mock.history).toHaveLength(1)
    })
  })

  describe('getLexiconSchema', () => {
    it('sends request with entity type and encoded name', async () => {
      mock.onGet(`${ QUERY_BASE }/app/projects/${ PROJECT_ID }/schemas/event/Sign%20Up`).reply({ status: 'ok' })

      await service.getLexiconSchema('Event', 'Sign Up')

      expect(mock.history).toHaveLength(1)
    })
  })

  describe('uploadLexiconSchemas', () => {
    it('sends POST with entries and truncate flag', async () => {
      mock.onPost(`${ QUERY_BASE }/app/projects/${ PROJECT_ID }/schemas`).reply({ status: 'ok' })

      const entries = [
        { entityType: 'event', name: 'Sign Up', schemaJson: { description: 'test' } },
      ]

      await service.uploadLexiconSchemas(entries, true)

      expect(mock.history[0].headers).toMatchObject({
        Authorization: SA_AUTH,
        'Content-Type': 'application/json',
      })
      expect(mock.history[0].body).toEqual({
        entries: [{ entityType: 'event', name: 'Sign Up', schemaJson: { description: 'test' } }],
        truncate: true,
      })
    })

    it('sets truncate to false when not provided', async () => {
      mock.onPost(`${ QUERY_BASE }/app/projects/${ PROJECT_ID }/schemas`).reply({ status: 'ok' })

      await service.uploadLexiconSchemas([])

      expect(mock.history[0].body.truncate).toBe(false)
    })
  })

  // ── Dictionaries ──

  describe('getCohortsDictionary', () => {
    it('returns formatted cohort items', async () => {
      mock.onPost(`${ QUERY_BASE }/query/cohorts/list`).reply([
        { id: 100, name: 'Power Users', count: 500 },
        { id: 200, name: 'Churned', count: 30 },
      ])

      const result = await service.getCohortsDictionary({})

      expect(result.items).toEqual([
        { label: 'Power Users', value: '100', note: '500 users' },
        { label: 'Churned', value: '200', note: '30 users' },
      ])
      expect(result.cursor).toBeNull()
    })

    it('filters by search term', async () => {
      mock.onPost(`${ QUERY_BASE }/query/cohorts/list`).reply([
        { id: 100, name: 'Power Users', count: 500 },
        { id: 200, name: 'Churned', count: 30 },
      ])

      const result = await service.getCohortsDictionary({ search: 'power' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toBe('Power Users')
    })
  })

  describe('getFunnelsDictionary', () => {
    it('returns formatted funnel items', async () => {
      mock.onGet(`${ QUERY_BASE }/query/funnels/list`).reply([
        { funnel_id: 7509, name: 'Signup funnel' },
      ])

      const result = await service.getFunnelsDictionary({})

      expect(result.items).toEqual([
        { label: 'Signup funnel', value: '7509' },
      ])
      expect(result.cursor).toBeNull()
    })

    it('filters by search term', async () => {
      mock.onGet(`${ QUERY_BASE }/query/funnels/list`).reply([
        { funnel_id: 7509, name: 'Signup funnel' },
        { funnel_id: 9070, name: 'Onboarding funnel' },
      ])

      const result = await service.getFunnelsDictionary({ search: 'onboard' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toBe('Onboarding funnel')
    })
  })

  describe('getEventNamesDictionary', () => {
    it('returns formatted event name items', async () => {
      mock.onGet(`${ QUERY_BASE }/query/events/names`).reply(['Sign Up', 'Purchase'])

      const result = await service.getEventNamesDictionary({})

      expect(result.items).toEqual([
        { label: 'Sign Up', value: 'Sign Up' },
        { label: 'Purchase', value: 'Purchase' },
      ])
      expect(result.cursor).toBeNull()
    })

    it('filters by search term', async () => {
      mock.onGet(`${ QUERY_BASE }/query/events/names`).reply(['Sign Up', 'Purchase', 'Page View'])

      const result = await service.getEventNamesDictionary({ search: 'sign' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('Sign Up')
    })

    it('requests with type general and limit 255', async () => {
      mock.onGet(`${ QUERY_BASE }/query/events/names`).reply([])

      await service.getEventNamesDictionary({})

      expect(mock.history[0].query).toMatchObject({
        type: 'general',
        limit: 255,
      })
    })

    it('handles null payload gracefully', async () => {
      mock.onGet(`${ QUERY_BASE }/query/events/names`).reply(['Event A'])

      const result = await service.getEventNamesDictionary(null)

      expect(result.items).toEqual([{ label: 'Event A', value: 'Event A' }])
    })
  })

  // ── Region Configuration ──

  describe('region configuration', () => {
    it('uses EU hosts when region is EU', async () => {
      jest.resetModules()

      const euSandbox = createSandbox({
        region: 'EU',
        projectToken: 'tok',
        serviceAccountUsername: SA_USERNAME,
        serviceAccountSecret: SA_SECRET,
        projectId: PROJECT_ID,
      })
      require('../src/index.js')
      const euService = euSandbox.getService()
      const euMock = euSandbox.getRequestMock()

      euMock.onPost('https://api-eu.mixpanel.com/track').reply({ status: 1, error: null })

      await euService.trackEvent('Test', 'user-1')

      expect(euMock.history[0].url).toBe('https://api-eu.mixpanel.com/track')

      euSandbox.cleanup()

      // Restore the original sandbox global so subsequent tests work
      jest.resetModules()

      sandbox = createSandbox({
        region: 'US',
        projectToken: PROJECT_TOKEN,
        serviceAccountUsername: SA_USERNAME,
        serviceAccountSecret: SA_SECRET,
        projectId: PROJECT_ID,
      })
      require('../src/index.js')
      service = sandbox.getService()
      mock = sandbox.getRequestMock()
    })
  })

  // ── Service Account Auth Errors ──

  describe('service account auth requirement', () => {
    it('throws when service account credentials are missing for query operations', async () => {
      jest.resetModules()

      const noSASandbox = createSandbox({
        region: 'US',
        projectToken: 'tok',
      })
      require('../src/index.js')
      const noSAService = noSASandbox.getService()

      await expect(noSAService.listSavedFunnels()).rejects.toThrow(
        'this operation requires Service Account credentials'
      )

      noSASandbox.cleanup()

      // Restore the original sandbox global so subsequent tests work
      jest.resetModules()

      sandbox = createSandbox({
        region: 'US',
        projectToken: PROJECT_TOKEN,
        serviceAccountUsername: SA_USERNAME,
        serviceAccountSecret: SA_SECRET,
        projectId: PROJECT_ID,
      })
      require('../src/index.js')
      service = sandbox.getService()
      mock = sandbox.getRequestMock()
    })
  })

  // ── Error Handling ──

  describe('error handling', () => {
    it('includes failed_records in error message', async () => {
      mock.onPost(`${ INGESTION_BASE }/track`).replyWithError({
        message: 'Some records failed',
        body: {
          error: 'Validation error',
          failed_records: [
            { index: 0, error: 'missing token' },
            { index: 1, error: 'bad time' },
          ],
        },
      })

      await expect(service.trackEvent('Test', 'user-1')).rejects.toThrow('failed records')
    })

    it('stringifies non-string error messages', async () => {
      mock.onPost(`${ INGESTION_BASE }/track`).replyWithError({
        message: 'fail',
        body: { error: { nested: 'error object' } },
      })

      await expect(service.trackEvent('Test', 'user-1')).rejects.toThrow('Mixpanel API error:')
    })

    it('falls back to error.body.message when error.body.error is absent', async () => {
      mock.onPost(`${ INGESTION_BASE }/track`).replyWithError({
        message: 'fallback',
        body: { message: 'Something went wrong' },
      })

      await expect(service.trackEvent('Test', 'user-1')).rejects.toThrow('Mixpanel API error: Something went wrong')
    })

    it('falls back to error.message when body has no error or message', async () => {
      mock.onPost(`${ INGESTION_BASE }/track`).replyWithError({
        message: 'Network timeout',
        body: {},
      })

      await expect(service.trackEvent('Test', 'user-1')).rejects.toThrow('Mixpanel API error: Network timeout')
    })
  })
})
