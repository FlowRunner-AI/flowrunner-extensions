'use strict'

const { createSandbox } = require('../../../service-sandbox')

const SERVER_URL = 'https://myhome.example.com:8123'
const ACCESS_TOKEN = 'test-access-token'
const BASE = `${SERVER_URL}/api`

describe('Home Assistant Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ serverUrl: SERVER_URL, accessToken: ACCESS_TOKEN })
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
      const configItems = sandbox.getConfigItems()

      expect(configItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'serverUrl', required: true, shared: false }),
          expect.objectContaining({ name: 'accessToken', required: true, shared: false }),
        ])
      )
    })
  })

  // ── Config & Info ──

  describe('getApiStatus', () => {
    it('sends GET to /api/ with auth header', async () => {
      mock.onGet(`${BASE}/`).reply({ message: 'API running.' })

      const result = await service.getApiStatus()

      expect(result).toEqual({ message: 'API running.' })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].headers).toMatchObject({
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      })
    })
  })

  describe('getConfig', () => {
    it('sends GET to /api/config', async () => {
      const configData = {
        latitude: 32.87336,
        longitude: -117.22743,
        location_name: 'Home',
        version: '2024.6.0',
        state: 'RUNNING',
      }

      mock.onGet(`${BASE}/config`).reply(configData)

      const result = await service.getConfig()

      expect(result).toEqual(configData)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].url).toBe(`${BASE}/config`)
    })
  })

  describe('checkConfig', () => {
    it('sends POST to /api/config/core/check_config', async () => {
      mock.onPost(`${BASE}/config/core/check_config`).reply({ errors: null, result: 'valid' })

      const result = await service.checkConfig()

      expect(result).toEqual({ errors: null, result: 'valid' })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
    })
  })

  // ── States ──

  describe('getStates', () => {
    it('sends GET to /api/states', async () => {
      const states = [
        { entity_id: 'light.kitchen', state: 'on', attributes: { friendly_name: 'Kitchen Light' } },
      ]

      mock.onGet(`${BASE}/states`).reply(states)

      const result = await service.getStates()

      expect(result).toEqual(states)
      expect(mock.history).toHaveLength(1)
    })
  })

  describe('getEntityState', () => {
    it('sends GET to /api/states/{entityId}', async () => {
      const stateData = {
        entity_id: 'sensor.outside_temperature',
        state: '15.6',
        attributes: { friendly_name: 'Outside Temperature', unit_of_measurement: '°C' },
      }

      mock.onGet(`${BASE}/states/sensor.outside_temperature`).reply(stateData)

      const result = await service.getEntityState('sensor.outside_temperature')

      expect(result).toEqual(stateData)
      expect(mock.history).toHaveLength(1)
    })

    it('encodes special characters in entityId', async () => {
      mock.onAny().reply({})

      await service.getEntityState('sensor.my entity')

      expect(mock.history[0].url).toBe(`${BASE}/states/sensor.my%20entity`)
    })

    it('throws on API error', async () => {
      mock.onGet(`${BASE}/states/sensor.nonexistent`).replyWithError({
        message: 'Entity not found',
        body: { message: 'Entity not found' },
        status: 404,
      })

      await expect(service.getEntityState('sensor.nonexistent')).rejects.toThrow('Home Assistant API error')
    })
  })

  describe('setState', () => {
    it('sends POST with state and attributes', async () => {
      const responseData = {
        entity_id: 'sensor.my_custom_sensor',
        state: '21.5',
        attributes: { friendly_name: 'My Sensor', unit_of_measurement: '°C' },
      }

      mock.onPost(`${BASE}/states/sensor.my_custom_sensor`).reply(responseData)

      const result = await service.setState('sensor.my_custom_sensor', '21.5', {
        friendly_name: 'My Sensor',
        unit_of_measurement: '°C',
      })

      expect(result).toEqual(responseData)
      expect(mock.history[0].body).toEqual({
        state: '21.5',
        attributes: { friendly_name: 'My Sensor', unit_of_measurement: '°C' },
      })
    })

    it('sends empty attributes when not provided', async () => {
      mock.onPost(`${BASE}/states/sensor.test`).reply({})

      await service.setState('sensor.test', 'on')

      expect(mock.history[0].body).toEqual({ state: 'on', attributes: {} })
    })
  })

  // ── Services ──

  describe('listServices', () => {
    it('sends GET to /api/services', async () => {
      const services = [
        { domain: 'light', services: { turn_on: { name: 'Turn on' } } },
      ]

      mock.onGet(`${BASE}/services`).reply(services)

      const result = await service.listServices()

      expect(result).toEqual(services)
      expect(mock.history).toHaveLength(1)
    })
  })

  describe('callService', () => {
    it('sends POST to /api/services/{domain}/{service} with service data', async () => {
      const changedStates = [
        { entity_id: 'light.kitchen', state: 'on', attributes: { brightness: 255 } },
      ]

      mock.onPost(`${BASE}/services/light/turn_on`).reply(changedStates)

      const result = await service.callService('light', 'turn_on', {
        entity_id: 'light.kitchen',
        brightness: 255,
      })

      expect(result).toEqual(changedStates)
      expect(mock.history[0].body).toEqual({ entity_id: 'light.kitchen', brightness: 255 })
    })

    it('sends empty object when no service data provided', async () => {
      mock.onPost(`${BASE}/services/homeassistant/restart`).reply([])

      await service.callService('homeassistant', 'restart')

      expect(mock.history[0].body).toEqual({})
    })
  })

  // ── Events ──

  describe('listEvents', () => {
    it('sends GET to /api/events', async () => {
      const events = [
        { event: 'state_changed', listener_count: 5 },
        { event: 'service_registered', listener_count: 1 },
      ]

      mock.onGet(`${BASE}/events`).reply(events)

      const result = await service.listEvents()

      expect(result).toEqual(events)
    })
  })

  describe('fireEvent', () => {
    it('sends POST to /api/events/{eventType} with event data', async () => {
      mock.onPost(`${BASE}/events/my_custom_event`).reply({ message: 'Event my_custom_event fired.' })

      const result = await service.fireEvent('my_custom_event', { entity_id: 'light.kitchen', value: 42 })

      expect(result).toEqual({ message: 'Event my_custom_event fired.' })
      expect(mock.history[0].body).toEqual({ entity_id: 'light.kitchen', value: 42 })
    })

    it('sends empty object when no event data provided', async () => {
      mock.onPost(`${BASE}/events/test_event`).reply({ message: 'Event test_event fired.' })

      await service.fireEvent('test_event')

      expect(mock.history[0].body).toEqual({})
    })
  })

  // ── History & Logbook ──

  describe('getHistory', () => {
    it('sends GET to /api/history/period/{timestamp} with query params', async () => {
      const historyData = [[{ entity_id: 'sensor.outside_temperature', state: '15.6' }]]

      mock.onGet(`${BASE}/history/period/2024-06-01T00%3A00%3A00%2B00%3A00`).reply(historyData)

      const result = await service.getHistory(
        '2024-06-01T00:00:00+00:00',
        'sensor.outside_temperature',
        '2024-06-02T00:00:00+00:00',
        true,
        true,
        true
      )

      expect(result).toEqual(historyData)
      // The clean() helper strips empty-string values, so boolean flags set to ''
      // are removed from the query object before it reaches the request mock.
      expect(mock.history[0].query).toMatchObject({
        filter_entity_id: 'sensor.outside_temperature',
        end_time: '2024-06-02T00:00:00+00:00',
      })
    })

    it('sends GET to /api/history/period without timestamp', async () => {
      mock.onGet(`${BASE}/history/period`).reply([[]])

      await service.getHistory()

      expect(mock.history[0].url).toBe(`${BASE}/history/period`)
    })

    it('omits boolean query params when false', async () => {
      mock.onGet(`${BASE}/history/period`).reply([[]])

      await service.getHistory(undefined, undefined, undefined, false, false, false)

      const query = mock.history[0].query
      expect(query.minimal_response).toBeUndefined()
      expect(query.no_attributes).toBeUndefined()
      expect(query.significant_changes_only).toBeUndefined()
    })
  })

  describe('getLogbook', () => {
    it('sends GET to /api/logbook/{timestamp} with query params', async () => {
      const logbookData = [
        { when: '2024-06-01T12:00:00+00:00', name: 'Kitchen Light', message: 'turned on' },
      ]

      mock.onGet(`${BASE}/logbook/2024-06-01T00%3A00%3A00%2B00%3A00`).reply(logbookData)

      const result = await service.getLogbook(
        '2024-06-01T00:00:00+00:00',
        'light.kitchen',
        '2024-06-02T00:00:00+00:00'
      )

      expect(result).toEqual(logbookData)
      expect(mock.history[0].query).toMatchObject({
        entity: 'light.kitchen',
        end_time: '2024-06-02T00:00:00+00:00',
      })
    })

    it('sends GET to /api/logbook without timestamp', async () => {
      mock.onGet(`${BASE}/logbook`).reply([])

      await service.getLogbook()

      expect(mock.history[0].url).toBe(`${BASE}/logbook`)
    })
  })

  describe('getErrorLog', () => {
    it('sends GET to /api/error_log', async () => {
      const errorText = '2024-06-01 12:00:00 ERROR [homeassistant] Setup failed'

      mock.onGet(`${BASE}/error_log`).reply(errorText)

      const result = await service.getErrorLog()

      expect(result).toBe(errorText)
    })
  })

  // ── Templates ──

  describe('renderTemplate', () => {
    it('sends POST to /api/template with template body', async () => {
      const templateStr = '{{ states("sensor.outside_temperature") }}'

      mock.onPost(`${BASE}/template`).reply('15.6')

      const result = await service.renderTemplate(templateStr)

      expect(result).toBe('15.6')
      expect(mock.history[0].body).toEqual({ template: templateStr })
    })
  })

  // ── Calendars ──

  describe('listCalendars', () => {
    it('sends GET to /api/calendars', async () => {
      const calendars = [
        { entity_id: 'calendar.family', name: 'Family' },
        { entity_id: 'calendar.work', name: 'Work' },
      ]

      mock.onGet(`${BASE}/calendars`).reply(calendars)

      const result = await service.listCalendars()

      expect(result).toEqual(calendars)
    })
  })

  describe('getCalendarEvents', () => {
    it('sends GET to /api/calendars/{entityId} with start and end query', async () => {
      const events = [
        { summary: 'Dentist', start: { dateTime: '2024-06-03T09:00:00-07:00' } },
      ]

      mock.onGet(`${BASE}/calendars/calendar.family`).reply(events)

      const result = await service.getCalendarEvents(
        'calendar.family',
        '2024-06-01T00:00:00Z',
        '2024-06-08T00:00:00Z'
      )

      expect(result).toEqual(events)
      expect(mock.history[0].query).toMatchObject({
        start: '2024-06-01T00:00:00Z',
        end: '2024-06-08T00:00:00Z',
      })
    })
  })

  // ── Dictionaries ──

  describe('getEntitiesDictionary', () => {
    const statesResponse = [
      { entity_id: 'light.kitchen', state: 'on', attributes: { friendly_name: 'Kitchen Light' } },
      { entity_id: 'sensor.outside_temperature', state: '15.6', attributes: { friendly_name: 'Outside Temperature' } },
      { entity_id: 'switch.garage', state: 'off', attributes: {} },
    ]

    it('returns all entities when no search is provided', async () => {
      mock.onGet(`${BASE}/states`).reply(statesResponse)

      const result = await service.getEntitiesDictionary({})

      expect(result.items).toHaveLength(3)
      expect(result.cursor).toBeNull()
      expect(result.items[0]).toEqual({
        label: 'light.kitchen',
        value: 'light.kitchen',
        note: 'Kitchen Light',
      })
    })

    it('filters entities by search term on entity_id', async () => {
      mock.onGet(`${BASE}/states`).reply(statesResponse)

      const result = await service.getEntitiesDictionary({ search: 'kitchen' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('light.kitchen')
    })

    it('filters entities by search term on friendly_name', async () => {
      mock.onGet(`${BASE}/states`).reply(statesResponse)

      const result = await service.getEntitiesDictionary({ search: 'Outside' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('sensor.outside_temperature')
    })

    it('handles empty payload', async () => {
      mock.onGet(`${BASE}/states`).reply(statesResponse)

      const result = await service.getEntitiesDictionary()

      expect(result.items).toHaveLength(3)
    })

    it('sets note to undefined when no friendly_name', async () => {
      mock.onGet(`${BASE}/states`).reply(statesResponse)

      const result = await service.getEntitiesDictionary({})

      const garageItem = result.items.find(i => i.value === 'switch.garage')
      expect(garageItem.note).toBeUndefined()
    })
  })

  describe('getCalendarsDictionary', () => {
    const calendarsResponse = [
      { entity_id: 'calendar.family', name: 'Family' },
      { entity_id: 'calendar.work', name: 'Work' },
    ]

    it('returns all calendars when no search is provided', async () => {
      mock.onGet(`${BASE}/calendars`).reply(calendarsResponse)

      const result = await service.getCalendarsDictionary({})

      expect(result.items).toHaveLength(2)
      expect(result.cursor).toBeNull()
      expect(result.items[0]).toEqual({
        label: 'Family',
        value: 'calendar.family',
        note: 'calendar.family',
      })
    })

    it('filters calendars by search term', async () => {
      mock.onGet(`${BASE}/calendars`).reply(calendarsResponse)

      const result = await service.getCalendarsDictionary({ search: 'work' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('calendar.work')
    })

    it('handles empty payload', async () => {
      mock.onGet(`${BASE}/calendars`).reply(calendarsResponse)

      const result = await service.getCalendarsDictionary()

      expect(result.items).toHaveLength(2)
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('includes status code in error message when available', async () => {
      mock.onGet(`${BASE}/`).replyWithError({
        message: 'Unauthorized',
        status: 401,
      })

      await expect(service.getApiStatus()).rejects.toThrow('Home Assistant API error (401): Unauthorized')
    })

    it('handles errors without status code', async () => {
      mock.onGet(`${BASE}/`).replyWithError({
        message: 'Network error',
      })

      await expect(service.getApiStatus()).rejects.toThrow('Home Assistant API error: Network error')
    })

    it('extracts message from error body', async () => {
      mock.onGet(`${BASE}/states`).replyWithError({
        message: 'Bad Request',
        body: { message: 'Invalid entity format' },
        status: 400,
      })

      await expect(service.getStates()).rejects.toThrow('Invalid entity format')
    })
  })
})
