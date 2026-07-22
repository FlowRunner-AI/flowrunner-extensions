'use strict'

const { createSandbox } = require('../../../service-sandbox')

const ACCESS_TOKEN = 'test-access-token'
const BASE = 'https://api.ouraring.com/v2'

describe('Oura Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ accessToken: ACCESS_TOKEN })
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
      expect(sandbox.getConfigItems()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'accessToken',
            required: true,
            shared: false,
          }),
        ])
      )
    })
  })

  // ── Helper: verify common auth headers ──

  function expectAuthHeaders(callIndex = 0) {
    expect(mock.history[callIndex].headers).toMatchObject({
      'Authorization': `Bearer ${ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    })
  }

  // ── Date-range collection methods ──

  const dateRangeMethods = [
    { method: 'getDailyReadiness', collection: 'daily_readiness', category: 'Daily Readiness' },
    { method: 'getDailySleep', collection: 'daily_sleep', category: 'Daily Sleep' },
    { method: 'getSleepPeriods', collection: 'sleep', category: 'Sleep Periods' },
    { method: 'getDailyActivity', collection: 'daily_activity', category: 'Daily Activity' },
    { method: 'getDailySpo2', collection: 'daily_spo2', category: 'Daily SpO2' },
    { method: 'getDailyStress', collection: 'daily_stress', category: 'Daily Stress' },
    { method: 'getDailyResilience', collection: 'daily_resilience', category: 'Daily Resilience' },
    { method: 'getDailyCardiovascularAge', collection: 'daily_cardiovascular_age', category: 'Daily Cardiovascular Age' },
    { method: 'getWorkouts', collection: 'workout', category: 'Workouts' },
    { method: 'getSessions', collection: 'session', category: 'Sessions' },
    { method: 'getEnhancedTags', collection: 'enhanced_tag', category: 'Enhanced Tags' },
    { method: 'getRestModePeriods', collection: 'rest_mode_period', category: 'Rest Mode Periods' },
  ]

  describe.each(dateRangeMethods)('$category ($method)', ({ method, collection }) => {
    const url = `${BASE}/usercollection/${collection}`

    it('sends correct GET request with date range', async () => {
      mock.onGet(url).reply({ data: [], next_token: null })

      const result = await service[method]('2024-01-01', '2024-01-31')

      expect(result).toEqual({ data: [], next_token: null })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expectAuthHeaders()
      expect(mock.history[0].query).toMatchObject({
        start_date: '2024-01-01',
        end_date: '2024-01-31',
      })
    })

    it('passes next_token for pagination', async () => {
      mock.onGet(url).reply({ data: [{ id: 'abc' }], next_token: null })

      await service[method]('2024-01-01', '2024-01-31', 'page2token')

      expect(mock.history[0].query).toMatchObject({
        start_date: '2024-01-01',
        end_date: '2024-01-31',
        next_token: 'page2token',
      })
    })

    it('omits next_token when not provided', async () => {
      mock.onGet(url).reply({ data: [], next_token: null })

      await service[method]('2024-06-01', '2024-06-30')

      const query = mock.history[0].query
      expect(query.next_token).toBeUndefined()
    })

    it('throws on API error', async () => {
      mock.onGet(url).replyWithError({
        message: 'Unauthorized',
        body: { detail: 'Invalid token' },
        status: 401,
      })

      await expect(service[method]('2024-01-01', '2024-01-31')).rejects.toThrow('Oura API error (401): Invalid token')
    })
  })

  // ── Heart Rate (datetime-based) ──

  describe('getHeartRate', () => {
    const url = `${BASE}/usercollection/heartrate`

    it('sends correct GET request with datetime range', async () => {
      const mockData = { data: [{ bpm: 58, source: 'sleep', timestamp: '2024-01-15T01:05:00+00:00' }], next_token: null }
      mock.onGet(url).reply(mockData)

      const result = await service.getHeartRate('2024-01-15T00:00:00+00:00', '2024-01-16T00:00:00+00:00')

      expect(result).toEqual(mockData)
      expect(mock.history).toHaveLength(1)
      expectAuthHeaders()
      expect(mock.history[0].query).toMatchObject({
        start_datetime: '2024-01-15T00:00:00+00:00',
        end_datetime: '2024-01-16T00:00:00+00:00',
      })
    })

    it('passes next_token for pagination', async () => {
      mock.onGet(url).reply({ data: [], next_token: null })

      await service.getHeartRate('2024-01-15T00:00:00+00:00', '2024-01-16T00:00:00+00:00', 'hrtoken')

      expect(mock.history[0].query).toMatchObject({
        next_token: 'hrtoken',
      })
    })

    it('omits next_token when not provided', async () => {
      mock.onGet(url).reply({ data: [], next_token: null })

      await service.getHeartRate('2024-01-15T00:00:00+00:00', '2024-01-16T00:00:00+00:00')

      expect(mock.history[0].query.next_token).toBeUndefined()
    })

    it('throws on API error', async () => {
      mock.onGet(url).replyWithError({
        message: 'Server Error',
        status: 500,
      })

      await expect(
        service.getHeartRate('2024-01-15T00:00:00+00:00', '2024-01-16T00:00:00+00:00')
      ).rejects.toThrow('Oura API error (500)')
    })
  })

  // ── Ring Configuration ──

  describe('getRingConfiguration', () => {
    const url = `${BASE}/usercollection/ring_configuration`

    it('sends correct GET request without next_token', async () => {
      const mockData = { data: [{ id: 'ring1', color: 'stealth', size: 9 }], next_token: null }
      mock.onGet(url).reply(mockData)

      const result = await service.getRingConfiguration()

      expect(result).toEqual(mockData)
      expect(mock.history).toHaveLength(1)
      expectAuthHeaders()
      expect(mock.history[0].query.next_token).toBeUndefined()
    })

    it('passes next_token for pagination', async () => {
      mock.onGet(url).reply({ data: [], next_token: null })

      await service.getRingConfiguration('ringtoken')

      expect(mock.history[0].query).toMatchObject({ next_token: 'ringtoken' })
    })

    it('throws on API error', async () => {
      mock.onGet(url).replyWithError({
        message: 'Forbidden',
        body: { detail: 'Insufficient scope' },
        status: 403,
      })

      await expect(service.getRingConfiguration()).rejects.toThrow('Oura API error (403): Insufficient scope')
    })
  })

  // ── Personal Info ──

  describe('getPersonalInfo', () => {
    const url = `${BASE}/usercollection/personal_info`

    it('sends correct GET request and returns user info', async () => {
      const mockData = { id: '99ii', age: 34, weight: 72.5, height: 1.8, biological_sex: 'male', email: 'user@example.com' }
      mock.onGet(url).reply(mockData)

      const result = await service.getPersonalInfo()

      expect(result).toEqual(mockData)
      expect(mock.history).toHaveLength(1)
      expectAuthHeaders()
    })

    it('throws on API error', async () => {
      mock.onGet(url).replyWithError({
        message: 'Unauthorized',
        body: { detail: 'Token expired' },
        status: 401,
      })

      await expect(service.getPersonalInfo()).rejects.toThrow('Oura API error (401): Token expired')
    })
  })

  // ── Single Document ──

  describe('getSingleDocument', () => {
    it('resolves collection from COLLECTION_MAP and fetches document', async () => {
      const url = `${BASE}/usercollection/daily_readiness/doc123`
      mock.onGet(url).reply({ id: 'doc123', day: '2024-01-15', score: 78 })

      const result = await service.getSingleDocument('Daily Readiness', 'doc123')

      expect(result).toEqual({ id: 'doc123', day: '2024-01-15', score: 78 })
      expect(mock.history).toHaveLength(1)
      expectAuthHeaders()
    })

    it('resolves Sleep (Detailed Periods) to sleep collection', async () => {
      const url = `${BASE}/usercollection/sleep/sleep456`
      mock.onGet(url).reply({ id: 'sleep456' })

      await service.getSingleDocument('Sleep (Detailed Periods)', 'sleep456')

      expect(mock.history[0].url).toBe(url)
    })

    it('uses raw value when collection is not in COLLECTION_MAP', async () => {
      const url = `${BASE}/usercollection/custom_collection/abc`
      mock.onGet(url).reply({ id: 'abc' })

      await service.getSingleDocument('custom_collection', 'abc')

      expect(mock.history[0].url).toBe(url)
    })

    it('encodes special characters in documentId', async () => {
      const docId = 'doc/with spaces'
      const url = `${BASE}/usercollection/daily_sleep/${encodeURIComponent(docId)}`
      mock.onGet(url).reply({ id: docId })

      await service.getSingleDocument('Daily Sleep', docId)

      expect(mock.history[0].url).toBe(url)
    })

    it('throws on API error', async () => {
      const url = `${BASE}/usercollection/workout/notfound`
      mock.onGet(url).replyWithError({
        message: 'Not Found',
        body: { detail: 'Document not found' },
        status: 404,
      })

      await expect(service.getSingleDocument('Workout', 'notfound')).rejects.toThrow('Oura API error (404): Document not found')
    })
  })

  // ── Error handling edge cases ──

  describe('error handling', () => {
    const url = `${BASE}/usercollection/personal_info`

    it('uses error.message when body and detail are missing', async () => {
      mock.onGet(url).replyWithError({ message: 'Network timeout' })

      await expect(service.getPersonalInfo()).rejects.toThrow('Oura API error: Network timeout')
    })

    it('handles structured detail (non-string)', async () => {
      mock.onGet(url).replyWithError({
        message: 'Validation Error',
        body: { detail: [{ loc: ['query', 'start_date'], msg: 'field required' }] },
        status: 422,
      })

      await expect(service.getPersonalInfo()).rejects.toThrow('Oura API error (422)')
    })

    it('falls back to error.body.message when detail is absent', async () => {
      mock.onGet(url).replyWithError({
        message: 'Something went wrong',
        body: { message: 'Rate limit exceeded' },
        status: 429,
      })

      await expect(service.getPersonalInfo()).rejects.toThrow('Oura API error (429): Rate limit exceeded')
    })
  })
})
