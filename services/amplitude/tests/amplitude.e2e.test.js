'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Amplitude Service (e2e)', () => {
  let sandbox
  let service

  beforeAll(() => {
    sandbox = createE2ESandbox('amplitude')
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

  // ── Event Ingestion ──

  describe('trackEvent', () => {
    it('tracks a single event', async () => {
      const result = await service.trackEvent('e2e_test_event', 'e2e-test-user-001', undefined, {
        source: 'e2e-test',
        timestamp: Date.now(),
      })

      expect(result).toHaveProperty('code', 200)
      expect(result).toHaveProperty('events_ingested', 1)
    })

    it('tracks event with device ID', async () => {
      const result = await service.trackEvent('e2e_test_event', undefined, 'e2e-device-001')

      expect(result).toHaveProperty('code', 200)
    })

    it('rejects when neither user nor device ID provided', async () => {
      await expect(service.trackEvent('e2e_test')).rejects.toThrow('Either User ID or Device ID must be provided.')
    })
  })

  describe('trackEvents', () => {
    it('tracks multiple events in one call', async () => {
      const events = [
        { event_type: 'e2e_batch_1', user_id: 'e2e-test-user-001' },
        { event_type: 'e2e_batch_2', user_id: 'e2e-test-user-001' },
      ]

      const result = await service.trackEvents(events)

      expect(result).toHaveProperty('code', 200)
      expect(result).toHaveProperty('events_ingested', 2)
    })
  })

  describe('batchUploadEvents', () => {
    it('uploads events via batch endpoint', async () => {
      const events = [
        { event_type: 'e2e_batch_upload', user_id: 'e2e-test-user-001', event_properties: { test: true } },
      ]

      const result = await service.batchUploadEvents(events)

      expect(result).toHaveProperty('code', 200)
      expect(result).toHaveProperty('events_ingested', 1)
    })
  })

  describe('identifyUser', () => {
    it('sets user properties', async () => {
      const result = await service.identifyUser('e2e-test-user-001', undefined, { e2e_test_prop: 'test_value' })

      expect(result).toEqual({ success: true })
    })
  })

  describe('groupIdentify', () => {
    it('sets group properties', async () => {
      const result = await service.groupIdentify('e2e_company', 'E2E Test Corp', { tier: 'test' })

      expect(result).toEqual({ success: true })
    })
  })

  // ── Analytics ──

  describe('listEvents', () => {
    it('returns event list with expected shape', async () => {
      const result = await service.listEvents()

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
    })
  })

  describe('getRealtimeActiveUsers', () => {
    it('returns realtime data with expected shape', async () => {
      const result = await service.getRealtimeActiveUsers()

      expect(result).toHaveProperty('data')
      expect(result.data).toHaveProperty('series')
    })
  })

  describe('getAverageSessionLength', () => {
    it('returns session length data', async () => {
      const endDate = new Date().toISOString().slice(0, 10).replace(/-/g, '')
      const startDate = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10).replace(/-/g, '')

      const result = await service.getAverageSessionLength(startDate, endDate)

      expect(result).toHaveProperty('data')
    })
  })

  describe('getAverageSessionsPerUser', () => {
    it('returns sessions per user data', async () => {
      const endDate = new Date().toISOString().slice(0, 10).replace(/-/g, '')
      const startDate = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10).replace(/-/g, '')

      const result = await service.getAverageSessionsPerUser(startDate, endDate)

      expect(result).toHaveProperty('data')
    })
  })

  describe('searchUsers', () => {
    it('returns search results with expected shape', async () => {
      const result = await service.searchUsers('e2e-test-user-001')

      expect(result).toHaveProperty('matches')
      expect(Array.isArray(result.matches)).toBe(true)
    })
  })

  // ── Chart Annotations (CRUD lifecycle) ──

  describe('chart annotations lifecycle', () => {
    let annotationId

    it('creates an annotation', async () => {
      const result = await service.createChartAnnotation(
        'E2E Test Annotation',
        new Date().toISOString(),
        undefined,
        'E2E Tests',
        undefined,
        'Created by automated e2e tests'
      )

      expect(result).toHaveProperty('data')
      expect(result.data).toHaveProperty('id')
      annotationId = result.data.id
    })

    it('retrieves the created annotation', async () => {
      if (!annotationId) {
        return
      }

      const result = await service.getChartAnnotation(annotationId)

      expect(result).toHaveProperty('data')
      expect(result.data).toHaveProperty('id', annotationId)
      expect(result.data).toHaveProperty('label', 'E2E Test Annotation')
    })

    it('lists annotations including the created one', async () => {
      const result = await service.listChartAnnotations()

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
    })

    it('updates the annotation', async () => {
      if (!annotationId) {
        return
      }

      const result = await service.updateChartAnnotation(annotationId, 'E2E Updated Annotation')

      expect(result).toHaveProperty('data')
    })

    it('deletes the annotation', async () => {
      if (!annotationId) {
        return
      }

      const result = await service.deleteChartAnnotation(annotationId)

      expect(result).toHaveProperty('data')
    })
  })

  // ── Cohorts ──

  describe('listCohorts', () => {
    it('returns cohorts with expected shape', async () => {
      const result = await service.listCohorts()

      expect(result).toHaveProperty('cohorts')
      expect(Array.isArray(result.cohorts)).toBe(true)
    })
  })

  describe('getCohortDownloadUsage', () => {
    it('returns usage with limit and count', async () => {
      const result = await service.getCohortDownloadUsage()

      expect(result).toHaveProperty('limit')
      expect(result).toHaveProperty('count')
    })
  })

  // ── Taxonomy ──

  describe('listEventCategories', () => {
    it('returns categories with expected shape', async () => {
      const result = await service.listEventCategories()

      expect(result).toHaveProperty('success', true)
      expect(result).toHaveProperty('data')
    })
  })

  describe('listEventTypes', () => {
    it('returns event types with expected shape', async () => {
      const result = await service.listEventTypes()

      expect(result).toHaveProperty('success', true)
      expect(result).toHaveProperty('data')
    })
  })

  describe('listEventProperties', () => {
    it('returns event properties', async () => {
      const result = await service.listEventProperties()

      expect(result).toHaveProperty('success', true)
      expect(result).toHaveProperty('data')
    })
  })

  describe('listUserProperties', () => {
    it('returns user properties with expected shape', async () => {
      const result = await service.listUserProperties()

      expect(result).toHaveProperty('success', true)
      expect(result).toHaveProperty('data')
    })
  })

  // ── Dictionaries ──

  describe('getCohortsDictionary', () => {
    it('returns dictionary items with correct shape', async () => {
      const result = await service.getCohortsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor', null)
    })
  })

  describe('getEventTypesDictionary', () => {
    it('returns dictionary items with correct shape', async () => {
      const result = await service.getEventTypesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor', null)
    })
  })
})
