'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Ortto Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('ortto')
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

  // ── getCustomFields ──

  describe('getCustomFields', () => {
    it('returns fields array', async () => {
      const result = await service.getCustomFields()

      expect(result).toHaveProperty('fields')
      expect(Array.isArray(result.fields)).toBe(true)
    })
  })

  // ── getFieldsDictionary ──

  describe('getFieldsDictionary', () => {
    it('returns items with label and value', async () => {
      const result = await service.getFieldsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor', null)

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
      }
    })

    it('filters by search term', async () => {
      const allResult = await service.getFieldsDictionary({})
      const filteredResult = await service.getFieldsDictionary({ search: 'email' })

      expect(filteredResult.items.length).toBeLessThanOrEqual(allResult.items.length)
    })

    it('handles null payload', async () => {
      const result = await service.getFieldsDictionary(null)

      expect(result).toHaveProperty('items')
      expect(result).toHaveProperty('cursor', null)
    })
  })

  // ── mergeOrCreatePerson + getPersonByEmail ──

  describe('mergeOrCreatePerson + getPersonByEmail', () => {
    const testEmail = `e2e-test-${Date.now()}@flowrunner-test.com`

    it('creates a new person via merge', async () => {
      const result = await service.mergeOrCreatePerson(
        testEmail,
        'E2ETest',
        'Runner',
        null,
        null,
        'Overwrite existing (default)',
        false
      )

      expect(result).toHaveProperty('people')
      expect(Array.isArray(result.people)).toBe(true)

      if (result.people.length > 0) {
        expect(result.people[0]).toHaveProperty('person_id')
      }
    })

    it('looks up the created person by email', async () => {
      // Allow time for Ortto to process the merge
      await new Promise(resolve => setTimeout(resolve, 2000))

      const result = await service.getPersonByEmail(testEmail)

      expect(result).toHaveProperty('contact')
      // Contact may be null if Ortto hasn't processed yet; that's acceptable in e2e
    })
  })

  // ── getPeople ──

  describe('getPeople', () => {
    it('returns contacts array with pagination info', async () => {
      const result = await service.getPeople(
        ['str::email', 'str::first', 'str::last'],
        null,
        null,
        null,
        5,
        0
      )

      expect(result).toHaveProperty('contacts')
      expect(Array.isArray(result.contacts)).toBe(true)
      expect(result).toHaveProperty('has_more')
    })

    it('returns contacts with default fields', async () => {
      const result = await service.getPeople(null, null, null, null, 2, 0)

      expect(result).toHaveProperty('contacts')
      expect(Array.isArray(result.contacts)).toBe(true)
    })
  })

  // ── createCustomActivity ──

  describe('createCustomActivity', () => {
    it('creates a custom activity event', async () => {
      const { activityId } = testValues

      if (!activityId) {
        console.log('Skipping createCustomActivity: testValues.activityId not set')
        return
      }

      const result = await service.createCustomActivity(
        activityId,
        { 'str::email': `e2e-activity-${Date.now()}@flowrunner-test.com` },
        { 'int::v': 100 }
      )

      expect(result).toHaveProperty('activities')
      expect(Array.isArray(result.activities)).toBe(true)
    })
  })
})
