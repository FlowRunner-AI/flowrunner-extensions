'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

const SUFFIX = Date.now()

describe('PostHog Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('posthog')
    require('../src/index.js')

    try {
      sandbox.validateConfigs()
    } catch (error) {
      console.log(error)
      process.exit(1)
    }

    service = sandbox.getService()
    testValues = sandbox.getTestValues()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Ingestion ──

  describe('ingestion', () => {
    it('captures a custom event', async () => {
      if (!service.projectApiKey) {
        console.log('Skipping captureEvent: configs.projectApiKey (phc_...) not set')

        return
      }

      const distinctId = testValues.distinctId || `flowrunner-e2e-${ SUFFIX }`

      const result = await service.captureEvent(
        'flowrunner e2e event',
        distinctId,
        { source: 'flowrunner-tests', run: String(SUFFIX) }
      )

      expect(result).toBeDefined()
    })

    it('identifies a user with person properties', async () => {
      if (!service.projectApiKey) {
        console.log('Skipping identifyUser: configs.projectApiKey (phc_...) not set')

        return
      }

      const distinctId = testValues.distinctId || `flowrunner-e2e-${ SUFFIX }`

      const result = await service.identifyUser(distinctId, { source: 'flowrunner-tests' })

      expect(result).toBeDefined()
    })

    it('creates an alias for a distinct id', async () => {
      if (!service.projectApiKey) {
        console.log('Skipping createAlias: configs.projectApiKey (phc_...) not set')

        return
      }

      const distinctId = testValues.distinctId || `flowrunner-e2e-${ SUFFIX }`

      const result = await service.createAlias(distinctId, `flowrunner-e2e-alias-${ SUFFIX }`)

      expect(result).toBeDefined()
    })

    it('rejects an event without a distinct id', async () => {
      await expect(service.captureEvent('flowrunner e2e event')).rejects.toThrow('PostHog API error')
    })
  })

  // ── Persons ──

  describe('persons', () => {
    it('lists persons in the project', async () => {
      const result = await service.listPersons(undefined, undefined, 5)

      expect(result).toHaveProperty('results')
      expect(Array.isArray(result.results)).toBe(true)
    })

    it('retrieves and updates a person when one exists', async () => {
      const list = await service.listPersons(undefined, undefined, 1)
      const person = (list.results || [])[0]

      if (!person) {
        console.log('Skipping person detail checks: the project has no persons yet')

        return
      }

      const fetched = await service.getPerson(person.uuid || person.id)

      expect(fetched).toHaveProperty('id')

      if (!testValues.allowPersonUpdate) {
        console.log('Skipping updatePersonProperties: testValues.allowPersonUpdate not set')

        return
      }

      const updated = await service.updatePersonProperties(person.uuid || person.id, {
        flowrunner_e2e: String(SUFFIX),
      })

      expect(updated).toHaveProperty('id')
    })
  })

  // ── Events ──

  describe('events', () => {
    it('lists recent events', async () => {
      const result = await service.listEvents(undefined, undefined, undefined, 5)

      expect(result).toHaveProperty('results')
      expect(Array.isArray(result.results)).toBe(true)
    })

    it('filters events by name and time window', async () => {
      const after = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

      const result = await service.listEvents('$pageview', after, new Date().toISOString(), 5)

      expect(result).toHaveProperty('results')
    })

    it('retrieves a single event when one exists', async () => {
      const list = await service.listEvents(undefined, undefined, undefined, 1)
      const event = (list.results || [])[0]

      if (!event) {
        console.log('Skipping getEvent: the project has no events yet')

        return
      }

      const fetched = await service.getEvent(event.id)

      expect(fetched).toHaveProperty('id')
    })
  })

  // ── Insights / Query ──

  describe('insights and queries', () => {
    it('runs a HogQL query', async () => {
      const result = await service.runQuery({
        kind: 'HogQLQuery',
        query: 'SELECT event, count() FROM events GROUP BY event LIMIT 5',
      })

      expect(result).toHaveProperty('results')
      expect(Array.isArray(result.results)).toBe(true)
    })

    it('lists saved insights', async () => {
      const result = await service.listInsights(5)

      expect(result).toHaveProperty('results')
    })

    it('returns an insights dictionary', async () => {
      const result = await service.getInsightsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Feature flags ──

  describe('feature flags', () => {
    let createdFlagId

    it('creates a feature flag', async () => {
      const result = await service.createFeatureFlag(
        `flowrunner-e2e-${ SUFFIX }`,
        `FlowRunner e2e ${ SUFFIX }`,
        false,
        { groups: [{ properties: [], rollout_percentage: 0 }] }
      )

      expect(result).toHaveProperty('id')

      createdFlagId = String(result.id)
    })

    it('lists feature flags', async () => {
      const result = await service.listFeatureFlags(10)

      expect(result).toHaveProperty('results')
      expect(Array.isArray(result.results)).toBe(true)
    })

    it('retrieves the created feature flag', async () => {
      if (!createdFlagId) {
        console.log('Skipping getFeatureFlag: no flag was created')

        return
      }

      const result = await service.getFeatureFlag(createdFlagId)

      expect(result).toHaveProperty('key', `flowrunner-e2e-${ SUFFIX }`)
    })

    it('updates the created feature flag', async () => {
      if (!createdFlagId) {
        console.log('Skipping updateFeatureFlag: no flag was created')

        return
      }

      const result = await service.updateFeatureFlag(createdFlagId, false, `FlowRunner e2e ${ SUFFIX } (updated)`)

      expect(result).toHaveProperty('name', `FlowRunner e2e ${ SUFFIX } (updated)`)
    })

    it('returns a feature flags dictionary', async () => {
      const result = await service.getFeatureFlagsDictionary({ search: 'flowrunner-e2e' })

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })

    it('deletes the created feature flag', async () => {
      if (!createdFlagId) {
        console.log('Skipping deleteFeatureFlag: no flag was created')

        return
      }

      const result = await service.deleteFeatureFlag(createdFlagId)

      expect(result).toEqual({ deleted: true, id: createdFlagId })
    })
  })

  // ── Cohorts ──

  describe('cohorts', () => {
    it('lists cohorts', async () => {
      const result = await service.listCohorts(5)

      expect(result).toHaveProperty('results')
    })

    it('retrieves a cohort when one exists', async () => {
      const list = await service.listCohorts(1)
      const cohort = (list.results || [])[0]

      if (!cohort) {
        console.log('Skipping getCohort: the project has no cohorts')

        return
      }

      const result = await service.getCohort(cohort.id)

      expect(result).toHaveProperty('id')
    })
  })

  // ── Annotations ──

  describe('annotations', () => {
    it('lists annotations', async () => {
      const result = await service.listAnnotations(5)

      expect(result).toHaveProperty('results')
    })

    it('creates an annotation when enabled', async () => {
      if (!testValues.allowAnnotationCreate) {
        console.log('Skipping createAnnotation: testValues.allowAnnotationCreate not set (annotations cannot be deleted by this service)')

        return
      }

      const result = await service.createAnnotation(
        `FlowRunner e2e annotation ${ SUFFIX }`,
        new Date().toISOString()
      )

      expect(result).toHaveProperty('id')
    })
  })

  // ── Errors ──

  describe('error handling', () => {
    it('throws a wrapped error for a missing person', async () => {
      await expect(service.getPerson('00000000-0000-0000-0000-000000000000'))
        .rejects.toThrow('PostHog API error')
    })
  })
})
