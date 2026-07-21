'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Mixpanel Service (e2e)', () => {
  let sandbox
  let service
  let testDistinctId

  beforeAll(() => {
    sandbox = createE2ESandbox('mixpanel')
    require('../src/index.js')

    try {
      sandbox.validateConfigs()
    } catch (error) {
      console.log(error)
      process.exit(1)
    }

    service = sandbox.getService()
    const testValues = sandbox.getTestValues()
    testDistinctId = testValues.testDistinctId || 'e2e-test-user-1'
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Event Ingestion ──

  describe('trackEvent', () => {
    it('tracks a single event successfully', async () => {
      const result = await service.trackEvent(
        'E2E Test Event',
        testDistinctId,
        { source: 'e2e-test', timestamp: Date.now() },
      )

      expect(result).toHaveProperty('status', 1)
    })
  })

  describe('importEvents', () => {
    it('imports historical events with service account auth', async () => {
      const result = await service.importEvents([
        {
          eventName: 'E2E Import Test',
          distinctId: testDistinctId,
          time: Math.floor(Date.now() / 1000) - 86400,
          properties: { source: 'e2e-import' },
        },
      ])

      expect(result).toHaveProperty('code', 200)
      expect(result).toHaveProperty('status', 'OK')
      expect(result.num_records_imported).toBeGreaterThanOrEqual(1)
    })
  })

  // ── User Profiles ──

  describe('user profile operations', () => {
    it('sets profile properties', async () => {
      const result = await service.setProfileProperties(testDistinctId, {
        '$name': 'E2E Test User',
        '$email': 'e2e-test@example.com',
        e2e_test: true,
      })

      expect(result).toHaveProperty('status', 1)
    })

    it('sets profile properties once', async () => {
      const result = await service.setProfilePropertiesOnce(testDistinctId, {
        first_e2e_run: new Date().toISOString(),
      })

      expect(result).toHaveProperty('status', 1)
    })

    it('increments numeric profile properties', async () => {
      const result = await service.incrementProfileProperties(testDistinctId, {
        e2e_run_count: 1,
      })

      expect(result).toHaveProperty('status', 1)
    })

    it('appends to list profile properties', async () => {
      const result = await service.appendToProfileListProperties(testDistinctId, {
        e2e_tags: 'run-' + Date.now(),
      })

      expect(result).toHaveProperty('status', 1)
    })

    it('unions list profile properties', async () => {
      const result = await service.unionProfileListProperties(testDistinctId, {
        e2e_features: ['test-feature'],
      })

      expect(result).toHaveProperty('status', 1)
    })

    it('removes from list profile properties', async () => {
      const result = await service.removeFromProfileListProperties(testDistinctId, {
        e2e_features: 'test-feature',
      })

      expect(result).toHaveProperty('status', 1)
    })

    it('unsets profile properties', async () => {
      const result = await service.unsetProfileProperties(testDistinctId, ['e2e_test'])

      expect(result).toHaveProperty('status', 1)
    })

    it('batch updates profiles', async () => {
      const result = await service.batchUpdateProfiles([
        { '$distinct_id': testDistinctId, '$set': { batch_e2e: true } },
      ])

      expect(result).toHaveProperty('status', 1)
    })
  })

  // ── Analytics Queries ──

  describe('listTopEventNames', () => {
    it('returns an array of event names', async () => {
      const result = await service.listTopEventNames('General', 10)

      expect(Array.isArray(result)).toBe(true)
    })
  })

  describe('getTodaysTopEvents', () => {
    it('returns events with expected shape', async () => {
      const result = await service.getTodaysTopEvents('General', 5)

      expect(result).toHaveProperty('events')
      expect(Array.isArray(result.events)).toBe(true)
    })
  })

  // ── Funnels & Retention ──

  describe('listSavedFunnels', () => {
    it('returns an array of funnels', async () => {
      const result = await service.listSavedFunnels()

      expect(Array.isArray(result)).toBe(true)
    })
  })

  // ── Profiles & Cohorts ──

  describe('listCohorts', () => {
    it('returns an array of cohorts', async () => {
      const result = await service.listCohorts()

      expect(Array.isArray(result)).toBe(true)
    })
  })

  describe('queryProfiles', () => {
    it('returns profiles with expected shape', async () => {
      const result = await service.queryProfiles(null, null, null, [testDistinctId])

      expect(result).toHaveProperty('status', 'ok')
      expect(result).toHaveProperty('results')
      expect(Array.isArray(result.results)).toBe(true)
    })
  })

  // ── Dictionaries ──

  describe('getEventNamesDictionary', () => {
    it('returns dictionary items with label and value', async () => {
      const result = await service.getEventNamesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result.cursor).toBeNull()

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
      }
    })
  })

  describe('getCohortsDictionary', () => {
    it('returns dictionary items', async () => {
      const result = await service.getCohortsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result.cursor).toBeNull()
    })
  })

  describe('getFunnelsDictionary', () => {
    it('returns dictionary items', async () => {
      const result = await service.getFunnelsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result.cursor).toBeNull()
    })
  })

  // ── Lexicon ──

  describe('listLexiconSchemas', () => {
    it('returns schemas with expected shape', async () => {
      const result = await service.listLexiconSchemas()

      expect(result).toHaveProperty('results')
      expect(Array.isArray(result.results)).toBe(true)
    })
  })

  // ── Cleanup ──

  describe('cleanup test profile', () => {
    it('deletes the test profile', async () => {
      const result = await service.deleteProfile(testDistinctId)

      expect(result).toHaveProperty('status', 1)
    })
  })
})
