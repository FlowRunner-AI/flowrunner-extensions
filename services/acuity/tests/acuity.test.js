'use strict'

const { createSandbox } = require('../../../service-sandbox')

const USER_ID = 'test-user-id'
const API_KEY = 'test-api-key'
const AUTH = `Basic ${ Buffer.from(`${ USER_ID }:${ API_KEY }`).toString('base64') }`
const BASE = 'https://acuityscheduling.com/api/v1'

describe('Acuity Scheduling Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ userId: USER_ID, apiKey: API_KEY })
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
        expect.objectContaining({
          name: 'userId',
          required: true,
          shared: false,
          type: 'STRING',
        }),
        expect.objectContaining({
          name: 'apiKey',
          required: true,
          shared: false,
          type: 'STRING',
        }),
      ])
    })
  })

  // ── Appointments ──

  describe('listAppointments', () => {
    it('sends correct request with defaults', async () => {
      mock.onGet(`${ BASE }/appointments`).reply([])

      const result = await service.listAppointments()

      expect(result).toEqual([])
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({ 'Authorization': AUTH })
      expect(mock.history[0].query).toMatchObject({ max: 100 })
    })

    it('passes all optional parameters', async () => {
      mock.onGet(`${ BASE }/appointments`).reply([{ id: 1 }])

      await service.listAppointments(10, '2026-08-01', '2026-08-31', '987', '123', true, 'a@b.com', 'Oldest First')

      expect(mock.history[0].query).toMatchObject({
        max: 10,
        minDate: '2026-08-01',
        maxDate: '2026-08-31',
        calendarID: '987',
        appointmentTypeID: '123',
        canceled: true,
        email: 'a@b.com',
        direction: 'ASC',
      })
    })

    it('maps "Newest First" to DESC', async () => {
      mock.onGet(`${ BASE }/appointments`).reply([])

      await service.listAppointments(50, undefined, undefined, undefined, undefined, false, undefined, 'Newest First')

      expect(mock.history[0].query).toMatchObject({ direction: 'DESC' })
    })

    it('omits canceled when false', async () => {
      mock.onGet(`${ BASE }/appointments`).reply([])

      await service.listAppointments(50, undefined, undefined, undefined, undefined, false)

      expect(mock.history[0].query.canceled).toBeUndefined()
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/appointments`).replyWithError({
        message: 'Unauthorized',
        status: 401,
      })

      await expect(service.listAppointments()).rejects.toThrow('Acuity Scheduling API error')
    })
  })

  describe('getAppointment', () => {
    it('sends correct request', async () => {
      mock.onGet(`${ BASE }/appointments/12345`).reply({ id: 12345, firstName: 'Ada' })

      const result = await service.getAppointment('12345')

      expect(result).toEqual({ id: 12345, firstName: 'Ada' })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({ 'Authorization': AUTH })
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/appointments/999`).replyWithError({ message: 'Not found', status: 404 })

      await expect(service.getAppointment('999')).rejects.toThrow('Acuity Scheduling API error')
    })
  })

  describe('createAppointment', () => {
    it('sends POST with required params', async () => {
      mock.onPost(`${ BASE }/appointments`).reply({ id: 100 })

      const result = await service.createAppointment('123', '2026-08-01T09:00:00-0700', 'Ada', 'Lovelace', 'ada@example.com')

      expect(result).toEqual({ id: 100 })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({ admin: true })
      expect(mock.history[0].body).toEqual({
        appointmentTypeID: 123,
        datetime: '2026-08-01T09:00:00-0700',
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@example.com',
      })
    })

    it('includes optional phone, calendarID, and fields', async () => {
      mock.onPost(`${ BASE }/appointments`).reply({ id: 101 })

      const fields = [{ id: 9, value: 'Notes value' }]

      await service.createAppointment('123', '2026-08-01T09:00:00-0700', 'Ada', 'Lovelace', 'ada@example.com', '5551234567', '987', fields)

      expect(mock.history[0].body).toEqual({
        appointmentTypeID: 123,
        datetime: '2026-08-01T09:00:00-0700',
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@example.com',
        phone: '5551234567',
        calendarID: 987,
        fields,
      })
    })

    it('omits fields when not an array', async () => {
      mock.onPost(`${ BASE }/appointments`).reply({ id: 102 })

      await service.createAppointment('123', '2026-08-01T09:00:00-0700', 'Ada', 'Lovelace', 'ada@example.com', undefined, undefined, 'not-an-array')

      expect(mock.history[0].body).not.toHaveProperty('fields')
    })

    it('throws on API error', async () => {
      mock.onPost(`${ BASE }/appointments`).replyWithError({ message: 'Bad Request', status: 400 })

      await expect(service.createAppointment('123', 'bad', 'A', 'B', 'c@d.com')).rejects.toThrow('Acuity Scheduling API error')
    })
  })

  describe('rescheduleAppointment', () => {
    it('sends PUT with required params', async () => {
      mock.onPut(`${ BASE }/appointments/100/reschedule`).reply({ id: 100, datetime: '2026-08-02T14:00:00-0700' })

      const result = await service.rescheduleAppointment('100', '2026-08-02T14:00:00-0700')

      expect(result).toEqual({ id: 100, datetime: '2026-08-02T14:00:00-0700' })
      expect(mock.history[0].body).toEqual({ datetime: '2026-08-02T14:00:00-0700' })
    })

    it('includes calendarID when provided', async () => {
      mock.onPut(`${ BASE }/appointments/100/reschedule`).reply({ id: 100 })

      await service.rescheduleAppointment('100', '2026-08-02T14:00:00-0700', '555')

      expect(mock.history[0].body).toEqual({
        datetime: '2026-08-02T14:00:00-0700',
        calendarID: 555,
      })
    })
  })

  describe('cancelAppointment', () => {
    it('sends PUT with required params only', async () => {
      mock.onPut(`${ BASE }/appointments/100/cancel`).reply({ id: 100, canceled: true })

      const result = await service.cancelAppointment('100')

      expect(result).toEqual({ id: 100, canceled: true })
      expect(mock.history[0].body).toEqual({})
    })

    it('includes cancelNote when provided', async () => {
      mock.onPut(`${ BASE }/appointments/100/cancel`).reply({ id: 100, canceled: true })

      await service.cancelAppointment('100', 'Client requested')

      expect(mock.history[0].body).toEqual({ cancelNote: 'Client requested' })
    })
  })

  describe('updateAppointment', () => {
    it('sends PUT with notes only', async () => {
      mock.onPut(`${ BASE }/appointments/100`).reply({ id: 100, notes: 'VIP' })

      const result = await service.updateAppointment('100', 'VIP')

      expect(result).toEqual({ id: 100, notes: 'VIP' })
      expect(mock.history[0].body).toEqual({ notes: 'VIP' })
    })

    it('includes fields when provided as array', async () => {
      mock.onPut(`${ BASE }/appointments/100`).reply({ id: 100 })

      const fields = [{ id: 9, value: 'Updated' }]

      await service.updateAppointment('100', undefined, fields)

      expect(mock.history[0].body).toEqual({ fields })
    })

    it('omits fields when not an array', async () => {
      mock.onPut(`${ BASE }/appointments/100`).reply({ id: 100 })

      await service.updateAppointment('100', 'note', 'bad')

      expect(mock.history[0].body).toEqual({ notes: 'note' })
    })
  })

  // ── Availability ──

  describe('getAvailabilityDates', () => {
    it('sends correct request', async () => {
      mock.onGet(`${ BASE }/availability/dates`).reply([{ date: '2026-08-01' }])

      const result = await service.getAvailabilityDates('2026-08', '123')

      expect(result).toEqual([{ date: '2026-08-01' }])
      expect(mock.history[0].query).toMatchObject({ month: '2026-08', appointmentTypeID: '123' })
    })

    it('includes calendarID when provided', async () => {
      mock.onGet(`${ BASE }/availability/dates`).reply([])

      await service.getAvailabilityDates('2026-08', '123', '987')

      expect(mock.history[0].query).toMatchObject({ calendarID: '987' })
    })
  })

  describe('getAvailabilityTimes', () => {
    it('sends correct request', async () => {
      mock.onGet(`${ BASE }/availability/times`).reply([{ time: '2026-08-01T09:00:00-0700' }])

      const result = await service.getAvailabilityTimes('2026-08-01', '123')

      expect(result).toEqual([{ time: '2026-08-01T09:00:00-0700' }])
      expect(mock.history[0].query).toMatchObject({ date: '2026-08-01', appointmentTypeID: '123' })
    })

    it('includes calendarID when provided', async () => {
      mock.onGet(`${ BASE }/availability/times`).reply([])

      await service.getAvailabilityTimes('2026-08-01', '123', '987')

      expect(mock.history[0].query).toMatchObject({ calendarID: '987' })
    })
  })

  describe('checkTimes', () => {
    it('sends POST with correct body', async () => {
      const times = ['2026-08-01T09:00:00-0700']

      mock.onPost(`${ BASE }/availability/check-times`).reply([{ time: times[0], valid: true }])

      const result = await service.checkTimes('123', times)

      expect(result).toEqual([{ time: times[0], valid: true }])
      expect(mock.history[0].body).toEqual({
        appointmentTypeID: 123,
        times,
      })
    })

    it('includes calendarID when provided', async () => {
      mock.onPost(`${ BASE }/availability/check-times`).reply([])

      await service.checkTimes('123', ['2026-08-01T09:00:00-0700'], '987')

      expect(mock.history[0].body).toEqual({
        appointmentTypeID: 123,
        times: ['2026-08-01T09:00:00-0700'],
        calendarID: 987,
      })
    })

    it('omits times when not an array', async () => {
      mock.onPost(`${ BASE }/availability/check-times`).reply([])

      await service.checkTimes('123', 'not-array')

      expect(mock.history[0].body).not.toHaveProperty('times')
    })
  })

  // ── Appointment Types ──

  describe('listAppointmentTypes', () => {
    it('sends correct request', async () => {
      mock.onGet(`${ BASE }/appointment-types`).reply([{ id: 1, name: 'Consultation' }])

      const result = await service.listAppointmentTypes()

      expect(result).toEqual([{ id: 1, name: 'Consultation' }])
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({ 'Authorization': AUTH })
    })
  })

  // ── Calendars ──

  describe('listCalendars', () => {
    it('sends correct request', async () => {
      mock.onGet(`${ BASE }/calendars`).reply([{ id: 987, name: 'Main' }])

      const result = await service.listCalendars()

      expect(result).toEqual([{ id: 987, name: 'Main' }])
      expect(mock.history).toHaveLength(1)
    })
  })

  // ── Clients ──

  describe('listClients', () => {
    it('sends correct request without search', async () => {
      mock.onGet(`${ BASE }/clients`).reply([{ firstName: 'Ada' }])

      const result = await service.listClients()

      expect(result).toEqual([{ firstName: 'Ada' }])
      expect(mock.history).toHaveLength(1)
    })

    it('passes search parameter', async () => {
      mock.onGet(`${ BASE }/clients`).reply([])

      await service.listClients('Ada')

      expect(mock.history[0].query).toMatchObject({ search: 'Ada' })
    })
  })

  describe('createClient', () => {
    it('sends POST with required params', async () => {
      mock.onPost(`${ BASE }/clients`).reply({ firstName: 'Ada', lastName: 'Lovelace' })

      const result = await service.createClient('Ada', 'Lovelace')

      expect(result).toEqual({ firstName: 'Ada', lastName: 'Lovelace' })
      expect(mock.history[0].body).toEqual({ firstName: 'Ada', lastName: 'Lovelace' })
    })

    it('includes optional email and phone', async () => {
      mock.onPost(`${ BASE }/clients`).reply({ firstName: 'Ada', lastName: 'Lovelace' })

      await service.createClient('Ada', 'Lovelace', 'ada@example.com', '5551234567')

      expect(mock.history[0].body).toEqual({
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@example.com',
        phone: '5551234567',
      })
    })
  })

  describe('updateClient', () => {
    it('sends PUT with identifier in query and updates in body', async () => {
      mock.onPut(`${ BASE }/clients`).reply({ firstName: 'Ada', lastName: 'Lovelace', email: 'new@example.com' })

      const result = await service.updateClient('Ada', 'Lovelace', '5551234567', 'new@example.com', 'VIP')

      expect(result).toEqual({ firstName: 'Ada', lastName: 'Lovelace', email: 'new@example.com' })
      expect(mock.history[0].query).toMatchObject({ firstName: 'Ada', lastName: 'Lovelace', phone: '5551234567' })
      expect(mock.history[0].body).toEqual({ email: 'new@example.com', notes: 'VIP' })
    })

    it('omits empty optional fields', async () => {
      mock.onPut(`${ BASE }/clients`).reply({ firstName: 'Ada' })

      await service.updateClient('Ada', 'Lovelace')

      expect(mock.history[0].query).toMatchObject({ firstName: 'Ada', lastName: 'Lovelace' })
      expect(mock.history[0].body).toEqual({})
    })
  })

  // ── Forms ──

  describe('listForms', () => {
    it('sends correct request', async () => {
      mock.onGet(`${ BASE }/forms`).reply([{ id: 1, name: 'Intake' }])

      const result = await service.listForms()

      expect(result).toEqual([{ id: 1, name: 'Intake' }])
      expect(mock.history).toHaveLength(1)
    })
  })

  // ── Certificates ──

  describe('listCertificates', () => {
    it('sends correct request', async () => {
      mock.onGet(`${ BASE }/certificates`).reply([{ id: 54321, certificate: 'SAVE10' }])

      const result = await service.listCertificates()

      expect(result).toEqual([{ id: 54321, certificate: 'SAVE10' }])
      expect(mock.history).toHaveLength(1)
    })
  })

  // ── Account ──

  describe('getMe', () => {
    it('sends correct request', async () => {
      mock.onGet(`${ BASE }/me`).reply({ email: 'owner@example.com', name: 'Acme Studio' })

      const result = await service.getMe()

      expect(result).toEqual({ email: 'owner@example.com', name: 'Acme Studio' })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({ 'Authorization': AUTH })
    })
  })

  // ── Dictionaries ──

  describe('getAppointmentTypesDictionary', () => {
    const types = [
      { id: 1, name: 'Consultation', duration: 30, price: '0.00' },
      { id: 2, name: 'Follow-up', duration: 15, price: '25.00' },
    ]

    it('returns all types when no search', async () => {
      mock.onGet(`${ BASE }/appointment-types`).reply(types)

      const result = await service.getAppointmentTypesDictionary({})

      expect(result.items).toHaveLength(2)
      expect(result.items[0]).toEqual({ label: 'Consultation', value: '1', note: '30 min - $0.00' })
      expect(result.items[1]).toEqual({ label: 'Follow-up', value: '2', note: '15 min - $25.00' })
      expect(result.cursor).toBeNull()
    })

    it('filters by search term', async () => {
      mock.onGet(`${ BASE }/appointment-types`).reply(types)

      const result = await service.getAppointmentTypesDictionary({ search: 'follow' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toBe('Follow-up')
    })

    it('handles empty payload', async () => {
      mock.onGet(`${ BASE }/appointment-types`).reply(types)

      const result = await service.getAppointmentTypesDictionary(null)

      expect(result.items).toHaveLength(2)
    })

    it('handles non-array API response', async () => {
      mock.onGet(`${ BASE }/appointment-types`).reply({})

      const result = await service.getAppointmentTypesDictionary({})

      expect(result.items).toEqual([])
    })

    it('handles type without duration or price', async () => {
      mock.onGet(`${ BASE }/appointment-types`).reply([{ id: 3, name: 'Unknown' }])

      const result = await service.getAppointmentTypesDictionary({})

      expect(result.items[0]).toEqual({ label: 'Unknown', value: '3', note: undefined })
    })
  })

  describe('getCalendarsDictionary', () => {
    const calendars = [
      { id: 987, name: 'Main', timezone: 'America/Los_Angeles' },
      { id: 988, name: 'Secondary', timezone: 'America/New_York' },
    ]

    it('returns all calendars when no search', async () => {
      mock.onGet(`${ BASE }/calendars`).reply(calendars)

      const result = await service.getCalendarsDictionary({})

      expect(result.items).toHaveLength(2)
      expect(result.items[0]).toEqual({ label: 'Main', value: '987', note: 'America/Los_Angeles' })
      expect(result.cursor).toBeNull()
    })

    it('filters by search term', async () => {
      mock.onGet(`${ BASE }/calendars`).reply(calendars)

      const result = await service.getCalendarsDictionary({ search: 'sec' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toBe('Secondary')
    })

    it('handles empty payload', async () => {
      mock.onGet(`${ BASE }/calendars`).reply(calendars)

      const result = await service.getCalendarsDictionary(null)

      expect(result.items).toHaveLength(2)
    })

    it('handles non-array API response', async () => {
      mock.onGet(`${ BASE }/calendars`).reply({})

      const result = await service.getCalendarsDictionary({})

      expect(result.items).toEqual([])
    })

    it('omits note when timezone is missing', async () => {
      mock.onGet(`${ BASE }/calendars`).reply([{ id: 1, name: 'No TZ' }])

      const result = await service.getCalendarsDictionary({})

      expect(result.items[0].note).toBeUndefined()
    })
  })

  // ── Polling Trigger ──

  describe('onNewAppointment', () => {
    const appointments = [
      { id: 3, firstName: 'C' },
      { id: 2, firstName: 'B' },
      { id: 1, firstName: 'A' },
    ]

    it('initializes baseline with empty events on first poll', async () => {
      mock.onGet(`${ BASE }/appointments`).reply(appointments)

      const result = await service.onNewAppointment({
        eventName: 'onNewAppointment',
        triggerData: {},
        state: {},
      })

      expect(result.events).toEqual([])
      expect(result.state).toEqual({ lastSeenId: 3 })
    })

    it('emits new appointments sorted oldest-first on subsequent polls', async () => {
      mock.onGet(`${ BASE }/appointments`).reply([
        { id: 5, firstName: 'E' },
        { id: 4, firstName: 'D' },
        { id: 3, firstName: 'C' },
      ])

      const result = await service.onNewAppointment({
        eventName: 'onNewAppointment',
        triggerData: {},
        state: { lastSeenId: 3 },
      })

      expect(result.events).toEqual([
        { id: 4, firstName: 'D' },
        { id: 5, firstName: 'E' },
      ])
      expect(result.state).toEqual({ lastSeenId: 5 })
    })

    it('returns empty events when no new appointments', async () => {
      mock.onGet(`${ BASE }/appointments`).reply(appointments)

      const result = await service.onNewAppointment({
        eventName: 'onNewAppointment',
        triggerData: {},
        state: { lastSeenId: 3 },
      })

      expect(result.events).toEqual([])
      expect(result.state).toEqual({ lastSeenId: 3 })
    })

    it('passes trigger data filters to API', async () => {
      mock.onGet(`${ BASE }/appointments`).reply([])

      await service.onNewAppointment({
        eventName: 'onNewAppointment',
        triggerData: { appointmentTypeID: '123', calendarID: '987' },
        state: { lastSeenId: 0 },
      })

      expect(mock.history[0].query).toMatchObject({
        appointmentTypeID: '123',
        calendarID: '987',
        direction: 'DESC',
        max: 25,
      })
    })

    it('returns learning mode sample', async () => {
      mock.onGet(`${ BASE }/appointments`).reply(appointments)

      const result = await service.onNewAppointment({
        eventName: 'onNewAppointment',
        triggerData: {},
        learningMode: true,
      })

      expect(result.events).toEqual([{ id: 3, firstName: 'C' }])
      expect(result.state).toBeNull()
    })

    it('handles API error gracefully', async () => {
      mock.onGet(`${ BASE }/appointments`).replyWithError({ message: 'Server error', status: 500 })

      const result = await service.onNewAppointment({
        eventName: 'onNewAppointment',
        triggerData: {},
        state: { lastSeenId: 3 },
      })

      expect(result.events).toEqual([])
      expect(result.state).toEqual({ lastSeenId: 3 })
    })

    it('handles API error on first poll with no state', async () => {
      mock.onGet(`${ BASE }/appointments`).replyWithError({ message: 'Server error', status: 500 })

      const result = await service.onNewAppointment({
        eventName: 'onNewAppointment',
        triggerData: {},
      })

      expect(result.events).toEqual([])
      expect(result.state).toEqual({})
    })

    it('handles empty appointment list on init', async () => {
      mock.onGet(`${ BASE }/appointments`).reply([])

      const result = await service.onNewAppointment({
        eventName: 'onNewAppointment',
        triggerData: {},
        state: {},
      })

      expect(result.events).toEqual([])
      expect(result.state).toEqual({ lastSeenId: 0 })
    })
  })

  // ── handleTriggerPollingForEvent ──

  describe('handleTriggerPollingForEvent', () => {
    it('dispatches to the correct event method', async () => {
      mock.onGet(`${ BASE }/appointments`).reply([{ id: 1 }])

      const result = await service.handleTriggerPollingForEvent({
        eventName: 'onNewAppointment',
        triggerData: {},
        state: {},
      })

      expect(result).toHaveProperty('events')
      expect(result).toHaveProperty('state')
    })
  })
})
