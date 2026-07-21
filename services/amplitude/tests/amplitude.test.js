'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-api-key'
const SECRET_KEY = 'test-secret-key'
const BASIC_AUTH = `Basic ${ Buffer.from(`${ API_KEY }:${ SECRET_KEY }`).toString('base64') }`

const INGESTION_BASE = 'https://api2.amplitude.com'
const ANALYTICS_BASE = 'https://amplitude.com'
const PROFILE_BASE = 'https://profile-api.amplitude.com'

describe('Amplitude Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ apiKey: API_KEY, secretKey: SECRET_KEY, region: 'US' })
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
        expect.objectContaining({ name: 'apiKey', required: true, shared: false, type: 'STRING' }),
        expect.objectContaining({ name: 'secretKey', required: true, shared: false, type: 'STRING' }),
        expect.objectContaining({ name: 'region', required: true, shared: false, type: 'CHOICE' }),
      ])
    })
  })

  // ── Event Ingestion ──

  describe('trackEvent', () => {
    it('sends correct request with required params', async () => {
      mock.onPost(`${ INGESTION_BASE }/2/httpapi`).reply({ code: 200, events_ingested: 1 })

      const result = await service.trackEvent('button_clicked', 'user-123')

      expect(result).toEqual({ code: 200, events_ingested: 1 })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].body).toEqual({
        api_key: API_KEY,
        events: [{ event_type: 'button_clicked', user_id: 'user-123' }],
      })
    })

    it('sends event with all optional params', async () => {
      mock.onPost(`${ INGESTION_BASE }/2/httpapi`).reply({ code: 200, events_ingested: 1 })

      await service.trackEvent(
        'purchase', 'user-123', 'device-abc',
        { source: 'web' }, { plan: 'premium' }, { company: 'Acme' },
        1700000000000, 'insert-1', 1699999000000, 3,
        { platform: 'iOS' }
      )

      expect(mock.history[0].body).toMatchObject({
        api_key: API_KEY,
        events: [expect.objectContaining({
          event_type: 'purchase',
          user_id: 'user-123',
          device_id: 'device-abc',
          event_properties: { source: 'web' },
          user_properties: { plan: 'premium' },
          groups: { company: 'Acme' },
          time: 1700000000000,
          insert_id: 'insert-1',
          session_id: 1699999000000,
          platform: 'iOS',
        })],
        options: { min_id_length: 3 },
      })
    })

    it('throws when neither userId nor deviceId provided', async () => {
      await expect(service.trackEvent('click')).rejects.toThrow('Either User ID or Device ID must be provided.')
    })

    it('throws on API error', async () => {
      mock.onPost(`${ INGESTION_BASE }/2/httpapi`).replyWithError({
        message: 'Bad Request',
        body: { error: 'Invalid API key' },
      })

      await expect(service.trackEvent('click', 'user-1')).rejects.toThrow('Amplitude API error: Invalid API key')
    })
  })

  describe('trackEvents', () => {
    it('sends multiple events', async () => {
      mock.onPost(`${ INGESTION_BASE }/2/httpapi`).reply({ code: 200, events_ingested: 2 })

      const events = [
        { event_type: 'click', user_id: 'u1' },
        { event_type: 'view', user_id: 'u2' },
      ]

      const result = await service.trackEvents(events)

      expect(result).toEqual({ code: 200, events_ingested: 2 })
      expect(mock.history[0].body).toEqual({
        api_key: API_KEY,
        events: [
          { event_type: 'click', user_id: 'u1' },
          { event_type: 'view', user_id: 'u2' },
        ],
      })
    })

    it('includes minIdLength option when provided', async () => {
      mock.onPost(`${ INGESTION_BASE }/2/httpapi`).reply({ code: 200, events_ingested: 1 })

      await service.trackEvents([{ event_type: 'click', user_id: 'u1' }], 2)

      expect(mock.history[0].body.options).toEqual({ min_id_length: 2 })
    })

    it('throws when events array is empty', async () => {
      await expect(service.trackEvents([])).rejects.toThrow('At least one event must be provided.')
    })

    it('throws when events is null', async () => {
      await expect(service.trackEvents(null)).rejects.toThrow('At least one event must be provided.')
    })
  })

  describe('batchUploadEvents', () => {
    it('sends to /batch endpoint', async () => {
      mock.onPost(`${ INGESTION_BASE }/batch`).reply({ code: 200, events_ingested: 5 })

      const result = await service.batchUploadEvents([{ event_type: 'e1', user_id: 'u1' }])

      expect(result).toEqual({ code: 200, events_ingested: 5 })
      expect(mock.history[0].url).toBe(`${ INGESTION_BASE }/batch`)
    })

    it('throws when events array is empty', async () => {
      await expect(service.batchUploadEvents([])).rejects.toThrow('At least one event must be provided.')
    })
  })

  describe('identifyUser', () => {
    it('sends form-encoded identification with set properties', async () => {
      mock.onPost(`${ INGESTION_BASE }/identify`).reply({})

      const result = await service.identifyUser('user-1', undefined, { plan: 'premium' })

      expect(result).toEqual({ success: true })
      expect(mock.history).toHaveLength(1)

      const sentBody = mock.history[0].body
      expect(sentBody).toContain(`api_key=${ API_KEY }`)
      expect(sentBody).toContain('identification=')

      const identification = JSON.parse(decodeURIComponent(sentBody.split('identification=')[1]))
      expect(identification).toMatchObject({
        user_id: 'user-1',
        user_properties: { $set: { plan: 'premium' } },
      })
    })

    it('sends all property operations', async () => {
      mock.onPost(`${ INGESTION_BASE }/identify`).reply({})

      await service.identifyUser(
        'user-1', undefined,
        { plan: 'pro' },       // set
        { signup: '2026-01' }, // setOnce
        { purchases: 1 },      // add
        { tags: 'beta' },      // append
        { roles: 'admin' },    // prepend
        ['old_prop'],           // unset
      )

      const sentBody = mock.history[0].body
      const identification = JSON.parse(decodeURIComponent(sentBody.split('identification=')[1]))

      expect(identification.user_properties).toMatchObject({
        $set: { plan: 'pro' },
        $setOnce: { signup: '2026-01' },
        $add: { purchases: 1 },
        $append: { tags: 'beta' },
        $prepend: { roles: 'admin' },
        $unset: { old_prop: '-' },
      })
    })

    it('throws when neither userId nor deviceId provided', async () => {
      await expect(service.identifyUser()).rejects.toThrow('Either User ID or Device ID must be provided.')
    })
  })

  describe('groupIdentify', () => {
    it('sends form-encoded group identification', async () => {
      mock.onPost(`${ INGESTION_BASE }/groupidentify`).reply({})

      const result = await service.groupIdentify('company', 'Acme', { tier: 'enterprise' })

      expect(result).toEqual({ success: true })

      const sentBody = mock.history[0].body
      expect(sentBody).toContain(`api_key=${ API_KEY }`)

      const identification = JSON.parse(decodeURIComponent(sentBody.split('identification=')[1]))
      expect(identification).toMatchObject({
        group_type: 'company',
        group_value: 'Acme',
        group_properties: { $set: { tier: 'enterprise' } },
      })
    })
  })

  // ── Analytics ──

  describe('listEvents', () => {
    it('sends GET with basic auth', async () => {
      mock.onGet(`${ ANALYTICS_BASE }/api/2/events/list`).reply({ data: [{ value: 'purchase' }] })

      const result = await service.listEvents()

      expect(result).toEqual({ data: [{ value: 'purchase' }] })
      expect(mock.history[0].headers).toMatchObject({ Authorization: BASIC_AUTH })
    })
  })

  describe('getEventSegmentation', () => {
    it('sends event segmentation query with defaults', async () => {
      const mockResponse = { data: { series: [[100]], xValues: ['2026-07-01'] } }
      mock.onGet().reply(mockResponse)

      const event = { event_type: 'purchase' }
      const result = await service.getEventSegmentation(event, '20260701', '20260714')

      expect(result).toEqual(mockResponse)
      expect(mock.history[0].headers).toMatchObject({ Authorization: BASIC_AUTH })

      const url = mock.history[0].url
      expect(url).toContain('/api/2/events/segmentation')
      expect(url).toContain('start=20260701')
      expect(url).toContain('end=20260714')
    })

    it('resolves metric and interval choices', async () => {
      mock.onGet().reply({ data: {} })

      await service.getEventSegmentation(
        { event_type: 'purchase' }, '20260701', '20260714',
        undefined, 'Event Totals', 'Hourly'
      )

      const url = mock.history[0].url
      expect(url).toContain('m=totals')
      expect(url).toContain('i=-3600000')
    })
  })

  describe('getFunnels', () => {
    it('sends funnel query', async () => {
      const mockResponse = { data: [{ events: ['sign_up', 'purchase'] }] }
      mock.onGet().reply(mockResponse)

      const events = [{ event_type: 'sign_up' }, { event_type: 'purchase' }]
      const result = await service.getFunnels(events, '20260701', '20260714')

      expect(result).toEqual(mockResponse)
      expect(mock.history[0].headers).toMatchObject({ Authorization: BASIC_AUTH })

      const url = mock.history[0].url
      expect(url).toContain('/api/2/funnels')
      expect(url).toContain('start=20260701')
      expect(url).toContain('end=20260714')
    })

    it('resolves mode and userType choices', async () => {
      mock.onGet().reply({ data: [] })

      await service.getFunnels(
        [{ event_type: 'a' }], '20260701', '20260714',
        'Sequential', 'New Users', 'Weekly'
      )

      const url = mock.history[0].url
      expect(url).toContain('mode=sequential')
      expect(url).toContain('n=new')
      expect(url).toContain('i=7')
    })

    it('throws when events is empty', async () => {
      await expect(service.getFunnels([], '20260701', '20260714')).rejects.toThrow('At least one funnel step event must be provided.')
    })
  })

  describe('getRetention', () => {
    it('sends retention query', async () => {
      const mockResponse = { data: { series: [[{ count: 100, outof: 100 }]] } }
      mock.onGet().reply(mockResponse)

      const result = await service.getRetention(
        { event_type: '_new' }, { event_type: '_active' }, '20260701', '20260714'
      )

      expect(result).toEqual(mockResponse)

      const url = mock.history[0].url
      expect(url).toContain('/api/2/retention')
      expect(url).toContain('start=20260701')
    })

    it('resolves retention mode choice', async () => {
      mock.onGet().reply({ data: {} })

      await service.getRetention(
        { event_type: '_new' }, { event_type: '_active' },
        '20260701', '20260714', 'Rolling'
      )

      const url = mock.history[0].url
      expect(url).toContain('rm=rolling')
    })
  })

  describe('getRealtimeActiveUsers', () => {
    it('sends GET to realtime endpoint', async () => {
      mock.onGet(`${ ANALYTICS_BASE }/api/2/realtime`).reply({ data: { series: [[1, 2, 3]] } })

      const result = await service.getRealtimeActiveUsers()

      expect(result).toEqual({ data: { series: [[1, 2, 3]] } })
      expect(mock.history[0].headers).toMatchObject({ Authorization: BASIC_AUTH })
    })
  })

  describe('getAverageSessionLength', () => {
    it('sends correct query params', async () => {
      mock.onGet(`${ ANALYTICS_BASE }/api/2/sessions/average`).reply({ data: { series: [[100]] } })

      await service.getAverageSessionLength('20260701', '20260714')

      expect(mock.history[0].query).toMatchObject({ start: '20260701', end: '20260714' })
    })
  })

  describe('getAverageSessionsPerUser', () => {
    it('sends correct query params', async () => {
      mock.onGet(`${ ANALYTICS_BASE }/api/2/sessions/peruser`).reply({ data: { series: [[2.4]] } })

      await service.getAverageSessionsPerUser('20260701', '20260714')

      expect(mock.history[0].query).toMatchObject({ start: '20260701', end: '20260714' })
    })
  })

  describe('getSessionLengthDistribution', () => {
    it('sends correct query params with bin options', async () => {
      mock.onGet(`${ ANALYTICS_BASE }/api/2/sessions/length`).reply({ data: {} })

      await service.getSessionLengthDistribution('20260701', '20260714', 'Minutes', 0, 60, 5)

      expect(mock.history[0].query).toMatchObject({
        start: '20260701',
        end: '20260714',
        timeHistogramConfigBinTimeUnit: 'minutes',
        timeHistogramConfigBinMin: 0,
        timeHistogramConfigBinMax: 60,
        timeHistogramConfigBinSize: 5,
      })
    })

    it('omits bin options when not provided', async () => {
      mock.onGet(`${ ANALYTICS_BASE }/api/2/sessions/length`).reply({ data: {} })

      await service.getSessionLengthDistribution('20260701', '20260714')

      const q = mock.history[0].query
      expect(q.start).toBe('20260701')
      expect(q.timeHistogramConfigBinTimeUnit).toBeUndefined()
    })
  })

  describe('getRevenueLTV', () => {
    it('sends revenue LTV query', async () => {
      mock.onGet().reply({ data: {} })

      await service.getRevenueLTV('20260701', '20260714', 'ARPPU', 'Weekly')

      const url = mock.history[0].url
      expect(url).toContain('/api/2/revenue/ltv')
      expect(url).toContain('start=20260701')
      expect(url).toContain('m=1')
      expect(url).toContain('i=7')
    })
  })

  // ── Users ──

  describe('getUserActivity', () => {
    it('sends correct query params', async () => {
      mock.onGet(`${ ANALYTICS_BASE }/api/2/useractivity`).reply({ userData: {}, events: [] })

      await service.getUserActivity(12345, 10, 50, 'Earliest')

      expect(mock.history[0].query).toMatchObject({
        user: 12345,
        offset: 10,
        limit: 50,
        direction: 'earliest',
      })
    })
  })

  describe('searchUsers', () => {
    it('sends user search query', async () => {
      mock.onGet(`${ ANALYTICS_BASE }/api/2/usersearch`).reply({ matches: [{ amplitude_id: 123 }] })

      const result = await service.searchUsers('test@example.com')

      expect(result).toEqual({ matches: [{ amplitude_id: 123 }] })
      expect(mock.history[0].query).toMatchObject({ user: 'test@example.com' })
    })
  })

  describe('getUserProfile', () => {
    it('sends request to profile API with Api-Key auth', async () => {
      mock.onGet(`${ PROFILE_BASE }/v1/userprofile`).reply({ userData: { user_id: 'u1' } })

      const result = await service.getUserProfile('user-1')

      expect(result).toEqual({ userData: { user_id: 'u1' } })
      expect(mock.history[0].headers).toMatchObject({ Authorization: `Api-Key ${ SECRET_KEY }` })
      expect(mock.history[0].query).toMatchObject({ user_id: 'user-1' })
    })

    it('includes optional flags when enabled', async () => {
      mock.onGet(`${ PROFILE_BASE }/v1/userprofile`).reply({ userData: {} })

      await service.getUserProfile('user-1', undefined, true, true, true, 'rec-1')

      expect(mock.history[0].query).toMatchObject({
        user_id: 'user-1',
        get_amp_props: 'true',
        get_cohort_ids: 'true',
        get_recs: 'true',
        rec_id: 'rec-1',
      })
    })

    it('throws when neither userId nor deviceId provided', async () => {
      await expect(service.getUserProfile()).rejects.toThrow('Either User ID or Device ID must be provided.')
    })
  })

  // ── Chart Annotations ──

  describe('listChartAnnotations', () => {
    it('sends GET to annotations endpoint', async () => {
      mock.onGet(`${ ANALYTICS_BASE }/api/3/annotations`).reply({ data: [] })

      const result = await service.listChartAnnotations()

      expect(result).toEqual({ data: [] })
      expect(mock.history[0].headers).toMatchObject({ Authorization: BASIC_AUTH })
    })
  })

  describe('getChartAnnotation', () => {
    it('fetches annotation by id', async () => {
      mock.onGet(`${ ANALYTICS_BASE }/api/3/annotations/ann-1`).reply({ data: { id: 'ann-1' } })

      const result = await service.getChartAnnotation('ann-1')

      expect(result).toEqual({ data: { id: 'ann-1' } })
    })
  })

  describe('createChartAnnotation', () => {
    it('sends POST with correct body', async () => {
      mock.onPost(`${ ANALYTICS_BASE }/api/3/annotations`).reply({ data: { id: 'new-1' } })

      const result = await service.createChartAnnotation('Release v2', '2026-07-01T00:00:00Z')

      expect(result).toEqual({ data: { id: 'new-1' } })
      expect(mock.history[0].body).toEqual({ label: 'Release v2', start: '2026-07-01T00:00:00Z' })
    })

    it('includes optional fields', async () => {
      mock.onPost(`${ ANALYTICS_BASE }/api/3/annotations`).reply({ data: {} })

      await service.createChartAnnotation('Release', '2026-07-01T00:00:00Z', '2026-07-02T00:00:00Z', 'Releases', 'chart-1', 'iOS rollout')

      expect(mock.history[0].body).toEqual({
        label: 'Release',
        start: '2026-07-01T00:00:00Z',
        end: '2026-07-02T00:00:00Z',
        category: 'Releases',
        chart_id: 'chart-1',
        details: 'iOS rollout',
      })
    })
  })

  describe('updateChartAnnotation', () => {
    it('sends PUT to correct URL', async () => {
      mock.onPut(`${ ANALYTICS_BASE }/api/3/annotations/ann-1`).reply({ data: { id: 'ann-1' } })

      await service.updateChartAnnotation('ann-1', 'Updated Label')

      expect(mock.history[0].body).toEqual({ label: 'Updated Label' })
    })
  })

  describe('deleteChartAnnotation', () => {
    it('sends DELETE to correct URL', async () => {
      mock.onDelete(`${ ANALYTICS_BASE }/api/3/annotations/ann-1`).reply({ data: { id: 'ann-1' } })

      const result = await service.deleteChartAnnotation('ann-1')

      expect(result).toEqual({ data: { id: 'ann-1' } })
    })
  })

  // ── Cohorts ──

  describe('listCohorts', () => {
    it('sends GET without sync info by default', async () => {
      mock.onGet(`${ ANALYTICS_BASE }/api/3/cohorts`).reply({ cohorts: [] })

      await service.listCohorts()

      expect(mock.history[0].query).toEqual({})
    })

    it('includes sync info when enabled', async () => {
      mock.onGet(`${ ANALYTICS_BASE }/api/3/cohorts`).reply({ cohorts: [] })

      await service.listCohorts(true)

      expect(mock.history[0].query).toMatchObject({ includeSyncInfo: 'true' })
    })
  })

  describe('requestCohortDownload', () => {
    it('sends GET to correct path', async () => {
      mock.onGet().reply({ cohort_id: 'abc', request_id: 'req-1' })

      const result = await service.requestCohortDownload('abc')

      expect(result).toEqual({ cohort_id: 'abc', request_id: 'req-1' })
      expect(mock.history[0].url).toContain('/api/5/cohorts/request/abc')
    })

    it('includes property keys in query', async () => {
      mock.onGet().reply({ cohort_id: 'abc', request_id: 'req-1' })

      await service.requestCohortDownload('abc', true, ['plan', 'country'])

      const url = mock.history[0].url
      expect(url).toContain('props=1')
      expect(url).toContain('propKeys=plan')
      expect(url).toContain('propKeys=country')
    })
  })

  describe('getCohortDownloadStatus', () => {
    it('sends GET to status endpoint', async () => {
      mock.onGet(`${ ANALYTICS_BASE }/api/5/cohorts/request-status/req-1`).reply({ async_status: 'JOB COMPLETED' })

      const result = await service.getCohortDownloadStatus('req-1')

      expect(result).toEqual({ async_status: 'JOB COMPLETED' })
    })
  })

  describe('downloadCohort', () => {
    it('returns parsed JSON response', async () => {
      mock.onGet().reply({ users: [{ user_id: 'u1' }] })

      const result = await service.downloadCohort('req-1')

      expect(result).toEqual({ users: [{ user_id: 'u1' }] })
      expect(mock.history[0].url).toContain('/api/5/cohorts/request/req-1/file')
    })
  })

  describe('getCohortDownloadUsage', () => {
    it('returns usage data', async () => {
      mock.onGet(`${ ANALYTICS_BASE }/api/3/cohorts/usage`).reply({ limit: 500, count: 12 })

      const result = await service.getCohortDownloadUsage()

      expect(result).toEqual({ limit: 500, count: 12 })
    })
  })

  describe('uploadCohort', () => {
    it('sends POST with correct body', async () => {
      mock.onPost(`${ ANALYTICS_BASE }/api/3/cohorts/upload`).reply({ cohort_id: 'new-1', matched_count: 2 })

      const result = await service.uploadCohort('Test Cohort', 12345, 'User ID', ['u1', 'u2'], 'owner@test.com')

      expect(result).toEqual({ cohort_id: 'new-1', matched_count: 2 })
      expect(mock.history[0].body).toMatchObject({
        name: 'Test Cohort',
        app_id: 12345,
        id_type: 'BY_USER_ID',
        ids: ['u1', 'u2'],
        owner: 'owner@test.com',
        published: true,
      })
    })

    it('resolves Amplitude ID id type', async () => {
      mock.onPost(`${ ANALYTICS_BASE }/api/3/cohorts/upload`).reply({ cohort_id: 'c1' })

      await service.uploadCohort('C', 1, 'Amplitude ID', ['123'], 'a@b.com')

      expect(mock.history[0].body.id_type).toBe('BY_AMP_ID')
    })
  })

  describe('updateCohortMembership', () => {
    it('sends POST with membership data', async () => {
      mock.onPost(`${ ANALYTICS_BASE }/api/3/cohorts/membership`).reply({ cohort_id: 'c1' })

      await service.updateCohortMembership('c1', 'Add', 'User ID', ['u1', 'u2'])

      expect(mock.history[0].body).toEqual({
        cohort_id: 'c1',
        memberships: [{
          ids: ['u1', 'u2'],
          id_type: 'BY_USER_ID',
          operation: 'ADD',
        }],
      })
    })

    it('resolves Remove operation', async () => {
      mock.onPost(`${ ANALYTICS_BASE }/api/3/cohorts/membership`).reply({ cohort_id: 'c1' })

      await service.updateCohortMembership('c1', 'Remove', 'Amplitude ID', ['123'])

      expect(mock.history[0].body.memberships[0]).toMatchObject({
        id_type: 'BY_AMP_ID',
        operation: 'REMOVE',
      })
    })
  })

  // ── Taxonomy ──

  describe('listEventCategories', () => {
    it('sends GET to taxonomy category endpoint', async () => {
      mock.onGet(`${ ANALYTICS_BASE }/api/2/taxonomy/category`).reply({ success: true, data: [] })

      const result = await service.listEventCategories()

      expect(result).toEqual({ success: true, data: [] })
    })
  })

  describe('createEventCategory', () => {
    it('sends form-encoded POST', async () => {
      mock.onPost(`${ ANALYTICS_BASE }/api/2/taxonomy/category`).reply({ success: true })

      const result = await service.createEventCategory('Onboarding')

      expect(result).toEqual({ success: true })

      const body = mock.history[0].body
      expect(body).toContain('category_name=Onboarding')
    })
  })

  describe('updateEventCategory', () => {
    it('sends form-encoded PUT to correct path', async () => {
      mock.onPut(`${ ANALYTICS_BASE }/api/2/taxonomy/category/123`).reply({ success: true })

      await service.updateEventCategory(123, 'Renamed')

      expect(mock.history[0].body).toContain('category_name=Renamed')
    })
  })

  describe('deleteEventCategory', () => {
    it('sends DELETE to correct path', async () => {
      mock.onDelete(`${ ANALYTICS_BASE }/api/2/taxonomy/category/456`).reply({ success: true })

      const result = await service.deleteEventCategory(456)

      expect(result).toEqual({ success: true })
    })
  })

  describe('listEventTypes', () => {
    it('sends GET without showDeleted by default', async () => {
      mock.onGet(`${ ANALYTICS_BASE }/api/2/taxonomy/event`).reply({ success: true, data: [] })

      await service.listEventTypes()

      expect(mock.history[0].query).toEqual({})
    })

    it('includes showDeleted when enabled', async () => {
      mock.onGet(`${ ANALYTICS_BASE }/api/2/taxonomy/event`).reply({ success: true, data: [] })

      await service.listEventTypes(true)

      expect(mock.history[0].query).toMatchObject({ showDeleted: 'true' })
    })
  })

  describe('createEventType', () => {
    it('sends form-encoded POST with all fields', async () => {
      mock.onPost(`${ ANALYTICS_BASE }/api/2/taxonomy/event`).reply({ success: true })

      await service.createEventType('onboard_start', 'Onboarding', 'User starts onboarding', true, ['core', 'v2'], 'owner@test.com')

      const body = mock.history[0].body
      expect(body).toContain('event_type=onboard_start')
      expect(body).toContain('category=Onboarding')
      expect(body).toContain('tags=core%2Cv2')
      expect(body).toContain('owner=owner%40test.com')
    })
  })

  describe('updateEventType', () => {
    it('sends form-encoded PUT to correct path', async () => {
      mock.onPut(`${ ANALYTICS_BASE }/api/2/taxonomy/event/old_event`).reply({ success: true })

      await service.updateEventType('old_event', 'new_event')

      const body = mock.history[0].body
      expect(body).toContain('new_event_type=new_event')
    })
  })

  describe('deleteEventType', () => {
    it('sends DELETE to correct path', async () => {
      mock.onDelete(`${ ANALYTICS_BASE }/api/2/taxonomy/event/my_event`).reply({ success: true })

      const result = await service.deleteEventType('my_event')

      expect(result).toEqual({ success: true })
    })
  })

  describe('listEventProperties', () => {
    it('sends GET with optional event_type', async () => {
      mock.onGet(`${ ANALYTICS_BASE }/api/2/taxonomy/event-property`).reply({ success: true, data: [] })

      await service.listEventProperties('purchase')

      expect(mock.history[0].query).toMatchObject({ event_type: 'purchase' })
    })
  })

  describe('createEventProperty', () => {
    it('sends form-encoded POST with all fields', async () => {
      mock.onPost(`${ ANALYTICS_BASE }/api/2/taxonomy/event-property`).reply({ success: true })

      await service.createEventProperty('source', 'purchase', 'Traffic source', 'String', false, true, '^[a-z]+$', ['web', 'mobile'])

      const body = mock.history[0].body
      expect(body).toContain('event_property=source')
      expect(body).toContain('event_type=purchase')
      expect(body).toContain('type=string')
      expect(body).toContain('is_required=true')
      expect(body).toContain('enum_values=web%2Cmobile')
    })
  })

  describe('updateEventProperty', () => {
    it('sends form-encoded PUT', async () => {
      mock.onPut(`${ ANALYTICS_BASE }/api/2/taxonomy/event-property/source`).reply({ success: true })

      await service.updateEventProperty('source', 'purchase', 'new_source')

      const body = mock.history[0].body
      expect(body).toContain('new_event_property_value=new_source')
      expect(body).toContain('event_type=purchase')
    })
  })

  describe('deleteEventProperty', () => {
    it('sends DELETE with event_type in form body', async () => {
      mock.onDelete(`${ ANALYTICS_BASE }/api/2/taxonomy/event-property/source`).reply({ success: true })

      await service.deleteEventProperty('source', 'purchase')

      expect(mock.history[0].body).toContain('event_type=purchase')
    })
  })

  describe('listUserProperties', () => {
    it('sends GET to user-property endpoint', async () => {
      mock.onGet(`${ ANALYTICS_BASE }/api/2/taxonomy/user-property`).reply({ success: true, data: [] })

      await service.listUserProperties()

      expect(mock.history[0].query).toEqual({})
    })

    it('includes showDeleted when enabled', async () => {
      mock.onGet(`${ ANALYTICS_BASE }/api/2/taxonomy/user-property`).reply({ success: true, data: [] })

      await service.listUserProperties(true)

      expect(mock.history[0].query).toMatchObject({ showDeleted: 'true' })
    })
  })

  describe('createUserProperty', () => {
    it('sends form-encoded POST', async () => {
      mock.onPost(`${ ANALYTICS_BASE }/api/2/taxonomy/user-property`).reply({ success: true })

      await service.createUserProperty('plan', 'Subscription plan', 'Enum', false, null, ['free', 'pro'])

      const body = mock.history[0].body
      expect(body).toContain('user_property=plan')
      expect(body).toContain('type=enum')
      expect(body).toContain('enum_values=free%2Cpro')
    })
  })

  describe('updateUserProperty', () => {
    it('sends form-encoded PUT', async () => {
      mock.onPut(`${ ANALYTICS_BASE }/api/2/taxonomy/user-property/gp%3Aplan`).reply({ success: true })

      await service.updateUserProperty('gp:plan', 'new_plan')

      const body = mock.history[0].body
      expect(body).toContain('new_user_property_value=new_plan')
    })
  })

  describe('deleteUserProperty', () => {
    it('sends DELETE to correct path', async () => {
      mock.onDelete(`${ ANALYTICS_BASE }/api/2/taxonomy/user-property/gp%3Aplan`).reply({ success: true })

      const result = await service.deleteUserProperty('gp:plan')

      expect(result).toEqual({ success: true })
    })
  })

  // ── Privacy ──

  describe('createUserDeletionJob', () => {
    it('sends POST with user IDs', async () => {
      mock.onPost(`${ ANALYTICS_BASE }/api/2/deletions/users`).reply({ day: '2026-08-14', status: 'staging' })

      const result = await service.createUserDeletionJob(['u1', 'u2'], undefined, 'privacy@test.com')

      expect(result).toMatchObject({ status: 'staging' })
      expect(mock.history[0].body).toMatchObject({
        user_ids: ['u1', 'u2'],
        requester: 'privacy@test.com',
      })
    })

    it('converts amplitude IDs to numbers', async () => {
      mock.onPost(`${ ANALYTICS_BASE }/api/2/deletions/users`).reply({ day: '2026-08-14' })

      await service.createUserDeletionJob(undefined, ['123', '456'])

      expect(mock.history[0].body.amplitude_ids).toEqual([123, 456])
    })

    it('throws when no IDs provided', async () => {
      await expect(service.createUserDeletionJob([], [])).rejects.toThrow('At least one User ID or Amplitude ID must be provided.')
    })
  })

  describe('listUserDeletionJobs', () => {
    it('sends GET with date range', async () => {
      mock.onGet(`${ ANALYTICS_BASE }/api/2/deletions/users`).reply([])

      await service.listUserDeletionJobs('2026-07-01', '2026-07-31')

      expect(mock.history[0].query).toMatchObject({ start_day: '2026-07-01', end_day: '2026-07-31' })
    })
  })

  describe('removeUserFromDeletionJob', () => {
    it('sends DELETE to correct path', async () => {
      mock.onDelete(`${ ANALYTICS_BASE }/api/2/deletions/users/12345/2026-08-14`).reply({ status: 'staging' })

      const result = await service.removeUserFromDeletionJob(12345, '2026-08-14')

      expect(result).toMatchObject({ status: 'staging' })
    })
  })

  // ── Dictionaries ──

  describe('getCohortsDictionary', () => {
    it('returns formatted cohort items', async () => {
      mock.onGet(`${ ANALYTICS_BASE }/api/3/cohorts`).reply({
        cohorts: [
          { id: 'c1', name: 'Power Users', size: 9520 },
          { id: 'c2', name: 'Churned', size: 200 },
        ],
      })

      const result = await service.getCohortsDictionary({})

      expect(result.items).toEqual([
        { label: 'Power Users', value: 'c1', note: '9520 users' },
        { label: 'Churned', value: 'c2', note: '200 users' },
      ])
      expect(result.cursor).toBeNull()
    })

    it('filters by search term', async () => {
      mock.onGet(`${ ANALYTICS_BASE }/api/3/cohorts`).reply({
        cohorts: [
          { id: 'c1', name: 'Power Users', size: 100 },
          { id: 'c2', name: 'Churned', size: 50 },
        ],
      })

      const result = await service.getCohortsDictionary({ search: 'power' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('c1')
    })
  })

  describe('getEventTypesDictionary', () => {
    it('returns formatted event type items', async () => {
      mock.onGet(`${ ANALYTICS_BASE }/api/2/events/list`).reply({
        data: [
          { value: 'purchase', display: 'Purchase', totals: 10231 },
          { value: 'signup', totals: 500 },
        ],
      })

      const result = await service.getEventTypesDictionary({})

      expect(result.items).toEqual([
        { label: 'Purchase', value: 'purchase', note: '10231 events this week' },
        { label: 'signup', value: 'signup', note: '500 events this week' },
      ])
      expect(result.cursor).toBeNull()
    })

    it('filters by search term', async () => {
      mock.onGet(`${ ANALYTICS_BASE }/api/2/events/list`).reply({
        data: [
          { value: 'purchase', totals: 100 },
          { value: 'signup', totals: 50 },
        ],
      })

      const result = await service.getEventTypesDictionary({ search: 'purch' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('purchase')
    })
  })

})
