'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Home Assistant Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('home-assistant')
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

  // ── Config & Info ──

  describe('getApiStatus', () => {
    it('returns a running message', async () => {
      const result = await service.getApiStatus()

      expect(result).toHaveProperty('message')
    })
  })

  describe('getConfig', () => {
    it('returns configuration with expected properties', async () => {
      const result = await service.getConfig()

      expect(result).toHaveProperty('version')
      expect(result).toHaveProperty('location_name')
      expect(result).toHaveProperty('state')
    })
  })

  describe('checkConfig', () => {
    it('returns validation result', async () => {
      const result = await service.checkConfig()

      expect(result).toHaveProperty('result')
      expect(['valid', 'invalid']).toContain(result.result)
    })
  })

  // ── States ──

  describe('getStates', () => {
    it('returns an array of entity states', async () => {
      const result = await service.getStates()

      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThan(0)
      expect(result[0]).toHaveProperty('entity_id')
      expect(result[0]).toHaveProperty('state')
    })
  })

  describe('getEntityState', () => {
    it('returns state for a specific entity', async () => {
      const entityId = testValues.entityId
      if (!entityId) {
        console.log('Skipping: no entityId in testValues')
        return
      }

      const result = await service.getEntityState(entityId)

      expect(result).toHaveProperty('entity_id', entityId)
      expect(result).toHaveProperty('state')
      expect(result).toHaveProperty('attributes')
    })
  })

  // ── Set State + Cleanup ──

  describe('setState', () => {
    it('creates or updates an entity state', async () => {
      const result = await service.setState('sensor.e2e_test_sensor', '42', {
        friendly_name: 'E2E Test Sensor',
        unit_of_measurement: 'units',
      })

      expect(result).toHaveProperty('entity_id', 'sensor.e2e_test_sensor')
      expect(result).toHaveProperty('state', '42')
    })
  })

  // ── Services ──

  describe('listServices', () => {
    it('returns an array of service domains', async () => {
      const result = await service.listServices()

      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThan(0)
      expect(result[0]).toHaveProperty('domain')
      expect(result[0]).toHaveProperty('services')
    })
  })

  // ── Events ──

  describe('listEvents', () => {
    it('returns an array of event types', async () => {
      const result = await service.listEvents()

      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThan(0)
      expect(result[0]).toHaveProperty('event')
      expect(result[0]).toHaveProperty('listener_count')
    })
  })

  describe('fireEvent', () => {
    it('fires a custom event and returns confirmation', async () => {
      const result = await service.fireEvent('flowrunner_e2e_test', { test: true })

      expect(result).toHaveProperty('message')
      expect(result.message).toContain('flowrunner_e2e_test')
    })
  })

  // ── History & Logbook ──

  describe('getHistory', () => {
    it('returns history data', async () => {
      const now = new Date()
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString()
      const entityId = testValues.entityId

      const result = await service.getHistory(
        oneHourAgo,
        entityId,
        undefined,
        true,
        false,
        false
      )

      expect(Array.isArray(result)).toBe(true)
    })
  })

  describe('getLogbook', () => {
    it('returns logbook entries', async () => {
      const now = new Date()
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString()

      const result = await service.getLogbook(oneHourAgo)

      expect(Array.isArray(result)).toBe(true)
    })
  })

  describe('getErrorLog', () => {
    it('returns error log text', async () => {
      const result = await service.getErrorLog()

      expect(typeof result === 'string' || typeof result === 'object').toBe(true)
    })
  })

  // ── Templates ──

  describe('renderTemplate', () => {
    it('renders a Jinja2 template', async () => {
      const result = await service.renderTemplate('{{ now().year }}')

      expect(result).toBeDefined()
      expect(String(result).length).toBeGreaterThan(0)
    })
  })

  // ── Calendars ──

  describe('listCalendars', () => {
    it('returns calendar entities', async () => {
      const result = await service.listCalendars()

      expect(Array.isArray(result)).toBe(true)
    })
  })

  describe('getCalendarEvents', () => {
    it('returns events for a calendar entity', async () => {
      const calendarEntityId = testValues.calendarEntityId
      if (!calendarEntityId) {
        console.log('Skipping: no calendarEntityId in testValues')
        return
      }

      const now = new Date()
      const oneWeekLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

      const result = await service.getCalendarEvents(
        calendarEntityId,
        now.toISOString(),
        oneWeekLater.toISOString()
      )

      expect(Array.isArray(result)).toBe(true)
    })
  })

  // ── Dictionaries ──

  describe('getEntitiesDictionary', () => {
    it('returns entities list with expected shape', async () => {
      const result = await service.getEntitiesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result.items.length).toBeGreaterThan(0)
      expect(result.items[0]).toHaveProperty('label')
      expect(result.items[0]).toHaveProperty('value')
    })

    it('filters entities by search term', async () => {
      const allResult = await service.getEntitiesDictionary({})
      if (allResult.items.length === 0) {
        console.log('Skipping: no entities found')
        return
      }

      const firstEntity = allResult.items[0]
      const searchTerm = firstEntity.value.split('.')[1].substring(0, 4)

      const filteredResult = await service.getEntitiesDictionary({ search: searchTerm })

      expect(filteredResult.items.length).toBeLessThanOrEqual(allResult.items.length)
      expect(filteredResult.items.length).toBeGreaterThan(0)
    })
  })

  describe('getCalendarsDictionary', () => {
    it('returns calendars list with expected shape', async () => {
      const result = await service.getCalendarsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor', null)
    })
  })
})
