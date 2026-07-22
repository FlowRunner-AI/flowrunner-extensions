'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Oura Service (e2e)', () => {
  let sandbox
  let service

  beforeAll(() => {
    sandbox = createE2ESandbox('oura')
    require('../src/index.js')

    try {
      sandbox.validateConfigs()
    } catch (error) {
      console.log(error)
      process.exit(1)
    }

    service = sandbox.getService()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Account ──

  describe('getPersonalInfo', () => {
    it('returns personal info with expected shape', async () => {
      const result = await service.getPersonalInfo()

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('email')
    })
  })

  describe('getRingConfiguration', () => {
    it('returns ring configuration data', async () => {
      const result = await service.getRingConfiguration()

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
      expect(result).toHaveProperty('next_token')
    })
  })

  // ── Daily Summaries ──

  describe('getDailyReadiness', () => {
    it('returns daily readiness data for a date range', async () => {
      const today = new Date().toISOString().split('T')[0]
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

      const result = await service.getDailyReadiness(weekAgo, today)

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
      expect(result).toHaveProperty('next_token')
    })
  })

  describe('getDailySleep', () => {
    it('returns daily sleep data for a date range', async () => {
      const today = new Date().toISOString().split('T')[0]
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

      const result = await service.getDailySleep(weekAgo, today)

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
      expect(result).toHaveProperty('next_token')
    })
  })

  describe('getSleepPeriods', () => {
    it('returns sleep period data for a date range', async () => {
      const today = new Date().toISOString().split('T')[0]
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

      const result = await service.getSleepPeriods(weekAgo, today)

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
      expect(result).toHaveProperty('next_token')
    })
  })

  describe('getDailyActivity', () => {
    it('returns daily activity data for a date range', async () => {
      const today = new Date().toISOString().split('T')[0]
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

      const result = await service.getDailyActivity(weekAgo, today)

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
      expect(result).toHaveProperty('next_token')
    })
  })

  describe('getDailySpo2', () => {
    it('returns daily SpO2 data for a date range', async () => {
      const today = new Date().toISOString().split('T')[0]
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

      const result = await service.getDailySpo2(weekAgo, today)

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
      expect(result).toHaveProperty('next_token')
    })
  })

  describe('getDailyStress', () => {
    it('returns daily stress data for a date range', async () => {
      const today = new Date().toISOString().split('T')[0]
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

      const result = await service.getDailyStress(weekAgo, today)

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
      expect(result).toHaveProperty('next_token')
    })
  })

  describe('getDailyResilience', () => {
    it('returns daily resilience data for a date range', async () => {
      const today = new Date().toISOString().split('T')[0]
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

      const result = await service.getDailyResilience(weekAgo, today)

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
      expect(result).toHaveProperty('next_token')
    })
  })

  describe('getDailyCardiovascularAge', () => {
    it('returns daily cardiovascular age data for a date range', async () => {
      const today = new Date().toISOString().split('T')[0]
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

      const result = await service.getDailyCardiovascularAge(weekAgo, today)

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
      expect(result).toHaveProperty('next_token')
    })
  })

  // ── Time Series ──

  describe('getHeartRate', () => {
    it('returns heart rate data for a datetime range', async () => {
      const now = new Date()
      const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)

      const result = await service.getHeartRate(dayAgo.toISOString(), now.toISOString())

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
      expect(result).toHaveProperty('next_token')
    })
  })

  // ── Activity ──

  describe('getWorkouts', () => {
    it('returns workout data for a date range', async () => {
      const today = new Date().toISOString().split('T')[0]
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

      const result = await service.getWorkouts(weekAgo, today)

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
      expect(result).toHaveProperty('next_token')
    })
  })

  describe('getSessions', () => {
    it('returns session data for a date range', async () => {
      const today = new Date().toISOString().split('T')[0]
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

      const result = await service.getSessions(weekAgo, today)

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
      expect(result).toHaveProperty('next_token')
    })
  })

  describe('getEnhancedTags', () => {
    it('returns enhanced tag data for a date range', async () => {
      const today = new Date().toISOString().split('T')[0]
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

      const result = await service.getEnhancedTags(weekAgo, today)

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
      expect(result).toHaveProperty('next_token')
    })
  })

  describe('getRestModePeriods', () => {
    it('returns rest mode period data for a date range', async () => {
      const today = new Date().toISOString().split('T')[0]
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

      const result = await service.getRestModePeriods(weekAgo, today)

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
      expect(result).toHaveProperty('next_token')
    })
  })

  // ── Documents ──

  describe('getSingleDocument', () => {
    it('fetches a single document by collection and ID', async () => {
      // First get a real document ID from daily readiness
      const today = new Date().toISOString().split('T')[0]
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

      const listResult = await service.getDailyReadiness(weekAgo, today)

      if (!listResult.data || listResult.data.length === 0) {
        console.log('Skipping getSingleDocument: no daily readiness data available')
        return
      }

      const docId = listResult.data[0].id
      const result = await service.getSingleDocument('Daily Readiness', docId)

      expect(result).toHaveProperty('id', docId)
    })
  })
})
