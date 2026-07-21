'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'cal_test_key_123'
const BASE = 'https://api.cal.com/v2'

// cal-api-version header values the service pins per endpoint.
const V_BOOKINGS = '2024-08-13'
const V_DEFAULT = '2024-06-14'

describe('Cal.com Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ apiKey: API_KEY })
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
          name: 'apiKey',
          displayName: 'API Key',
          required: true,
          shared: false,
          type: 'STRING',
        }),
      ])
    })

    it('sends Authorization bearer + Content-Type headers on requests', async () => {
      mock.onGet(`${ BASE }/me`).reply({ data: { id: 100 } })

      await service.getMyProfile()

      expect(mock.history[0].headers).toMatchObject({
        'Authorization': `Bearer ${ API_KEY }`,
        'Content-Type': 'application/json',
      })
    })

    it('sends the default cal-api-version header on general v2 endpoints', async () => {
      mock.onGet(`${ BASE }/me`).reply({ data: { id: 100 } })

      await service.getMyProfile()

      expect(mock.history[0].headers['cal-api-version']).toBe(V_DEFAULT)
    })

    it('unwraps the v2 { status, data } response envelope', async () => {
      mock.onGet(`${ BASE }/me`).reply({ status: 'success', data: { id: 100, username: 'alice' } })

      const result = await service.getMyProfile()

      expect(result).toEqual({ id: 100, username: 'alice' })
    })

    it('passes through a response without a data property', async () => {
      mock.onGet(`${ BASE }/me`).reply({ id: 100, username: 'alice' })

      const result = await service.getMyProfile()

      expect(result).toEqual({ id: 100, username: 'alice' })
    })
  })

  // ── Bookings ──

  describe('listBookings', () => {
    it('sends default take/skip and the bookings api version', async () => {
      mock.onGet(`${ BASE }/bookings`).reply({ data: [] })

      const result = await service.listBookings()

      expect(result).toEqual([])
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].headers['cal-api-version']).toBe(V_BOOKINGS)
      expect(mock.history[0].query).toEqual({ take: 100, skip: 0 })
    })

    it('maps friendly status labels and passes all filters', async () => {
      mock.onGet(`${ BASE }/bookings`).reply({ data: [{ id: 1 }] })

      await service.listBookings(
        'Upcoming',
        'bob@example.com',
        456,
        '2024-08-01T00:00:00Z',
        '2024-08-31T00:00:00Z',
        25,
        50
      )

      expect(mock.history[0].query).toEqual({
        status: 'upcoming',
        attendeeEmail: 'bob@example.com',
        eventTypeId: 456,
        afterStart: '2024-08-01T00:00:00Z',
        beforeEnd: '2024-08-31T00:00:00Z',
        take: 25,
        skip: 50,
      })
    })

    it('maps each status label to its api value', async () => {
      mock.onGet(`${ BASE }/bookings`).reply({ data: [] })

      await service.listBookings('Cancelled')

      expect(mock.history[0].query).toMatchObject({ status: 'cancelled' })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/bookings`).replyWithError({ message: 'Boom' })

      await expect(service.listBookings()).rejects.toThrow('Cal.com API error: Boom')
    })
  })

  describe('getBooking', () => {
    it('fetches a booking by uid with the bookings api version', async () => {
      mock.onGet(`${ BASE }/bookings/booking_abc123`).reply({ data: { uid: 'booking_abc123' } })

      const result = await service.getBooking('booking_abc123')

      expect(result).toEqual({ uid: 'booking_abc123' })
      expect(mock.history[0].url).toBe(`${ BASE }/bookings/booking_abc123`)
      expect(mock.history[0].headers['cal-api-version']).toBe(V_BOOKINGS)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/bookings/bad`).replyWithError({ message: 'Not found', status: 404 })

      await expect(service.getBooking('bad')).rejects.toThrow(
        'Cal.com API error: Not found — the ID or slug may be wrong; use a list action or picker to choose a valid one. (Not found)'
      )
    })
  })

  describe('createBooking', () => {
    it('sends required params only with a compacted attendee', async () => {
      mock.onPost(`${ BASE }/bookings`).reply({ data: { uid: 'booking_new' } })

      const result = await service.createBooking(
        456,
        '2024-08-13T09:00:00Z',
        'Bob',
        'bob@example.com',
        'America/New_York'
      )

      expect(result).toEqual({ uid: 'booking_new' })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].headers['cal-api-version']).toBe(V_BOOKINGS)
      expect(mock.history[0].body).toEqual({
        eventTypeId: 456,
        start: '2024-08-13T09:00:00Z',
        attendee: {
          name: 'Bob',
          email: 'bob@example.com',
          timeZone: 'America/New_York',
        },
      })
    })

    it('includes all optional params when provided', async () => {
      mock.onPost(`${ BASE }/bookings`).reply({ data: { uid: 'booking_full' } })

      await service.createBooking(
        456,
        '2024-08-13T09:00:00Z',
        'Bob',
        'bob@example.com',
        'America/New_York',
        'en',
        '+14155552671',
        ['guest1@example.com', 'guest2@example.com'],
        'integrations:daily',
        { question1: 'answer1' },
        { source: 'flow' }
      )

      expect(mock.history[0].body).toEqual({
        eventTypeId: 456,
        start: '2024-08-13T09:00:00Z',
        attendee: {
          name: 'Bob',
          email: 'bob@example.com',
          timeZone: 'America/New_York',
          language: 'en',
          phoneNumber: '+14155552671',
        },
        guests: ['guest1@example.com', 'guest2@example.com'],
        location: 'integrations:daily',
        bookingFieldsResponses: { question1: 'answer1' },
        metadata: { source: 'flow' },
      })
    })

    it('omits guests when an empty array is provided', async () => {
      mock.onPost(`${ BASE }/bookings`).reply({ data: { uid: 'booking_no_guests' } })

      await service.createBooking(456, '2024-08-13T09:00:00Z', 'Bob', 'bob@example.com', 'America/New_York', undefined, undefined, [])

      expect(mock.history[0].body).not.toHaveProperty('guests')
    })

    it('throws a wrapped validation error with hint on API failure', async () => {
      mock.onPost(`${ BASE }/bookings`).replyWithError({
        message: 'Validation failed',
        status: 422,
        body: { error: { message: 'start is required' } },
      })

      await expect(
        service.createBooking(456, '', 'Bob', 'bob@example.com', 'America/New_York')
      ).rejects.toThrow(
        'Cal.com API error: Validation failed — check required fields (for bookings: eventTypeId, start, and attendee details). (start is required)'
      )
    })
  })

  describe('cancelBooking', () => {
    it('cancels without a reason', async () => {
      mock.onPost(`${ BASE }/bookings/booking_abc/cancel`).reply({ data: { status: 'cancelled' } })

      const result = await service.cancelBooking('booking_abc')

      expect(result).toEqual({ status: 'cancelled' })
      expect(mock.history[0].url).toBe(`${ BASE }/bookings/booking_abc/cancel`)
      expect(mock.history[0].body).toEqual({})
    })

    it('includes the cancellation reason when provided', async () => {
      mock.onPost(`${ BASE }/bookings/booking_abc/cancel`).reply({ data: { status: 'cancelled' } })

      await service.cancelBooking('booking_abc', 'Attendee unavailable')

      expect(mock.history[0].body).toEqual({ cancellationReason: 'Attendee unavailable' })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/bookings/booking_abc/cancel`).replyWithError({ message: 'Boom' })

      await expect(service.cancelBooking('booking_abc')).rejects.toThrow('Cal.com API error: Boom')
    })
  })

  describe('rescheduleBooking', () => {
    it('reschedules with only the new start', async () => {
      mock.onPost(`${ BASE }/bookings/booking_abc/reschedule`).reply({ data: { uid: 'booking_def' } })

      const result = await service.rescheduleBooking('booking_abc', '2024-08-14T10:00:00Z')

      expect(result).toEqual({ uid: 'booking_def' })
      expect(mock.history[0].body).toEqual({ start: '2024-08-14T10:00:00Z' })
    })

    it('includes the rescheduling reason when provided', async () => {
      mock.onPost(`${ BASE }/bookings/booking_abc/reschedule`).reply({ data: { uid: 'booking_def' } })

      await service.rescheduleBooking('booking_abc', '2024-08-14T10:00:00Z', 'Conflict')

      expect(mock.history[0].body).toEqual({
        start: '2024-08-14T10:00:00Z',
        reschedulingReason: 'Conflict',
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/bookings/booking_abc/reschedule`).replyWithError({ message: 'Boom' })

      await expect(
        service.rescheduleBooking('booking_abc', '2024-08-14T10:00:00Z')
      ).rejects.toThrow('Cal.com API error: Boom')
    })
  })

  describe('confirmBooking', () => {
    it('confirms with an empty body', async () => {
      mock.onPost(`${ BASE }/bookings/booking_abc/confirm`).reply({ data: { status: 'accepted' } })

      const result = await service.confirmBooking('booking_abc')

      expect(result).toEqual({ status: 'accepted' })
      expect(mock.history[0].url).toBe(`${ BASE }/bookings/booking_abc/confirm`)
      expect(mock.history[0].body).toEqual({})
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/bookings/booking_abc/confirm`).replyWithError({ message: 'Boom' })

      await expect(service.confirmBooking('booking_abc')).rejects.toThrow('Cal.com API error: Boom')
    })
  })

  describe('declineBooking', () => {
    it('declines without a reason', async () => {
      mock.onPost(`${ BASE }/bookings/booking_abc/decline`).reply({ data: { status: 'rejected' } })

      const result = await service.declineBooking('booking_abc')

      expect(result).toEqual({ status: 'rejected' })
      expect(mock.history[0].body).toEqual({})
    })

    it('includes the reason when provided', async () => {
      mock.onPost(`${ BASE }/bookings/booking_abc/decline`).reply({ data: { status: 'rejected' } })

      await service.declineBooking('booking_abc', 'Not available')

      expect(mock.history[0].body).toEqual({ reason: 'Not available' })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/bookings/booking_abc/decline`).replyWithError({ message: 'Boom' })

      await expect(service.declineBooking('booking_abc')).rejects.toThrow('Cal.com API error: Boom')
    })
  })

  describe('markAbsent', () => {
    it('sends an empty body when nothing is flagged', async () => {
      mock.onPost(`${ BASE }/bookings/booking_abc/mark-absent`).reply({ data: { uid: 'booking_abc' } })

      const result = await service.markAbsent('booking_abc')

      expect(result).toEqual({ uid: 'booking_abc' })
      expect(mock.history[0].body).toEqual({})
    })

    it('marks the host absent when hostAbsent is true', async () => {
      mock.onPost(`${ BASE }/bookings/booking_abc/mark-absent`).reply({ data: {} })

      await service.markAbsent('booking_abc', true)

      expect(mock.history[0].body).toEqual({ host: true })
    })

    it('includes host false explicitly', async () => {
      mock.onPost(`${ BASE }/bookings/booking_abc/mark-absent`).reply({ data: {} })

      await service.markAbsent('booking_abc', false)

      expect(mock.history[0].body).toEqual({ host: false })
    })

    it('maps attendee emails to absent entries', async () => {
      mock.onPost(`${ BASE }/bookings/booking_abc/mark-absent`).reply({ data: {} })

      await service.markAbsent('booking_abc', true, ['bob@example.com', 'jane@example.com'])

      expect(mock.history[0].body).toEqual({
        host: true,
        attendees: [
          { email: 'bob@example.com', absent: true },
          { email: 'jane@example.com', absent: true },
        ],
      })
    })

    it('ignores an empty attendee list', async () => {
      mock.onPost(`${ BASE }/bookings/booking_abc/mark-absent`).reply({ data: {} })

      await service.markAbsent('booking_abc', undefined, [])

      expect(mock.history[0].body).toEqual({})
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/bookings/booking_abc/mark-absent`).replyWithError({ message: 'Boom' })

      await expect(service.markAbsent('booking_abc')).rejects.toThrow('Cal.com API error: Boom')
    })
  })

  // ── Event Types ──

  describe('listEventTypes', () => {
    it('sends no query params by default with the default api version', async () => {
      mock.onGet(`${ BASE }/event-types`).reply({ data: [] })

      const result = await service.listEventTypes()

      expect(result).toEqual([])
      expect(mock.history[0].query).toEqual({})
      expect(mock.history[0].headers['cal-api-version']).toBe(V_DEFAULT)
    })

    it('passes username and eventSlug when provided', async () => {
      mock.onGet(`${ BASE }/event-types`).reply({ data: [{ id: 1 }] })

      await service.listEventTypes('alice', '30min')

      expect(mock.history[0].query).toEqual({ username: 'alice', eventSlug: '30min' })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/event-types`).replyWithError({ message: 'Boom' })

      await expect(service.listEventTypes()).rejects.toThrow('Cal.com API error: Boom')
    })
  })

  describe('getEventType', () => {
    it('fetches an event type by id', async () => {
      mock.onGet(`${ BASE }/event-types/456`).reply({ data: { id: 456, title: '30 Min Meeting' } })

      const result = await service.getEventType(456)

      expect(result).toEqual({ id: 456, title: '30 Min Meeting' })
      expect(mock.history[0].url).toBe(`${ BASE }/event-types/456`)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/event-types/456`).replyWithError({ message: 'Boom' })

      await expect(service.getEventType(456)).rejects.toThrow('Cal.com API error: Boom')
    })
  })

  describe('createEventType', () => {
    it('sends required params only', async () => {
      mock.onPost(`${ BASE }/event-types`).reply({ data: { id: 789 } })

      const result = await service.createEventType(30, '30 Min Meeting', '30min')

      expect(result).toEqual({ id: 789 })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({
        lengthInMinutes: 30,
        title: '30 Min Meeting',
        slug: '30min',
      })
    })

    it('includes description and hidden flag when provided', async () => {
      mock.onPost(`${ BASE }/event-types`).reply({ data: { id: 789 } })

      await service.createEventType(45, 'Consult', 'consult', 'A consult', true)

      expect(mock.history[0].body).toEqual({
        lengthInMinutes: 45,
        title: 'Consult',
        slug: 'consult',
        description: 'A consult',
        hidden: true,
      })
    })

    it('includes hidden false explicitly', async () => {
      mock.onPost(`${ BASE }/event-types`).reply({ data: { id: 789 } })

      await service.createEventType(30, 'Meeting', 'meeting', undefined, false)

      expect(mock.history[0].body).toEqual({
        lengthInMinutes: 30,
        title: 'Meeting',
        slug: 'meeting',
        hidden: false,
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/event-types`).replyWithError({ message: 'Boom' })

      await expect(service.createEventType(30, 'X', 'x')).rejects.toThrow('Cal.com API error: Boom')
    })
  })

  describe('updateEventType', () => {
    it('sends a patch with an empty body when nothing changes', async () => {
      mock.onPatch(`${ BASE }/event-types/456`).reply({ data: { id: 456 } })

      const result = await service.updateEventType(456)

      expect(result).toEqual({ id: 456 })
      expect(mock.history[0].method).toBe('patch')
      expect(mock.history[0].body).toEqual({})
    })

    it('includes only the fields provided', async () => {
      mock.onPatch(`${ BASE }/event-types/456`).reply({ data: { id: 456 } })

      await service.updateEventType(456, 'Updated Meeting', 'updated', 60, 'New desc', false)

      expect(mock.history[0].body).toEqual({
        title: 'Updated Meeting',
        slug: 'updated',
        lengthInMinutes: 60,
        description: 'New desc',
        hidden: false,
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPatch(`${ BASE }/event-types/456`).replyWithError({ message: 'Boom' })

      await expect(service.updateEventType(456, 'X')).rejects.toThrow('Cal.com API error: Boom')
    })
  })

  describe('deleteEventType', () => {
    it('sends a delete and returns a deleted marker', async () => {
      mock.onDelete(`${ BASE }/event-types/456`).reply({ data: { id: 456 } })

      const result = await service.deleteEventType(456)

      expect(result).toEqual({ deleted: true, eventTypeId: 456 })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${ BASE }/event-types/456`)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onDelete(`${ BASE }/event-types/456`).replyWithError({ message: 'Boom' })

      await expect(service.deleteEventType(456)).rejects.toThrow('Cal.com API error: Boom')
    })
  })

  // ── Availability / Slots ──

  describe('getAvailableSlots', () => {
    it('sends required params', async () => {
      mock.onGet(`${ BASE }/slots`).reply({ data: { '2024-08-13': [] } })

      const result = await service.getAvailableSlots(456, '2024-08-13', '2024-08-20')

      expect(result).toEqual({ '2024-08-13': [] })
      expect(mock.history[0].query).toEqual({
        eventTypeId: 456,
        start: '2024-08-13',
        end: '2024-08-20',
      })
    })

    it('includes the time zone when provided', async () => {
      mock.onGet(`${ BASE }/slots`).reply({ data: {} })

      await service.getAvailableSlots(456, '2024-08-13', '2024-08-20', 'America/New_York')

      expect(mock.history[0].query).toEqual({
        eventTypeId: 456,
        start: '2024-08-13',
        end: '2024-08-20',
        timeZone: 'America/New_York',
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/slots`).replyWithError({ message: 'Boom' })

      await expect(
        service.getAvailableSlots(456, '2024-08-13', '2024-08-20')
      ).rejects.toThrow('Cal.com API error: Boom')
    })
  })

  // ── Schedules ──

  describe('listSchedules', () => {
    it('fetches all schedules', async () => {
      mock.onGet(`${ BASE }/schedules`).reply({ data: [{ id: 111 }] })

      const result = await service.listSchedules()

      expect(result).toEqual([{ id: 111 }])
      expect(mock.history[0].url).toBe(`${ BASE }/schedules`)
      expect(mock.history[0].headers['cal-api-version']).toBe(V_DEFAULT)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/schedules`).replyWithError({ message: 'Boom' })

      await expect(service.listSchedules()).rejects.toThrow('Cal.com API error: Boom')
    })
  })

  describe('getSchedule', () => {
    it('fetches a schedule by id', async () => {
      mock.onGet(`${ BASE }/schedules/111`).reply({ data: { id: 111, name: 'Working Hours' } })

      const result = await service.getSchedule(111)

      expect(result).toEqual({ id: 111, name: 'Working Hours' })
      expect(mock.history[0].url).toBe(`${ BASE }/schedules/111`)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/schedules/111`).replyWithError({ message: 'Boom' })

      await expect(service.getSchedule(111)).rejects.toThrow('Cal.com API error: Boom')
    })
  })

  // ── Me ──

  describe('getMyProfile', () => {
    it('fetches the connected account profile', async () => {
      mock.onGet(`${ BASE }/me`).reply({ data: { id: 100, username: 'alice', email: 'alice@example.com' } })

      const result = await service.getMyProfile()

      expect(result).toEqual({ id: 100, username: 'alice', email: 'alice@example.com' })
      expect(mock.history[0].url).toBe(`${ BASE }/me`)
    })

    it('throws a wrapped error with the 401 hint', async () => {
      mock.onGet(`${ BASE }/me`).replyWithError({ message: 'Unauthorized', status: 401 })

      await expect(service.getMyProfile()).rejects.toThrow(
        'Cal.com API error: Authentication failed — check the API key (Cal.com → Settings → Developer → API keys). (Unauthorized)'
      )
    })
  })

  // ── Error message resolution ──

  describe('error handling', () => {
    it('reads the message from body.error.message', async () => {
      mock.onGet(`${ BASE }/me`).replyWithError({
        body: { error: { message: 'nested detail' } },
      })

      await expect(service.getMyProfile()).rejects.toThrow('Cal.com API error: nested detail')
    })

    it('reads the message from body.message', async () => {
      mock.onGet(`${ BASE }/me`).replyWithError({
        body: { message: 'top-level body message' },
      })

      await expect(service.getMyProfile()).rejects.toThrow('Cal.com API error: top-level body message')
    })

    it('reads the status from body.status for the hint', async () => {
      mock.onGet(`${ BASE }/me`).replyWithError({
        message: 'Too many requests',
        body: { status: 429 },
      })

      await expect(service.getMyProfile()).rejects.toThrow(
        'Cal.com API error: Rate limit hit — retry in a moment. (Too many requests)'
      )
    })

    it('falls back to a generic message when none is available', async () => {
      mock.onGet(`${ BASE }/me`).replyWithError({})

      await expect(service.getMyProfile()).rejects.toThrow('Cal.com API error: Request failed')
    })
  })

  // ── Dictionaries ──

  describe('getEventTypesDictionary', () => {
    it('maps event types (array response) to items', async () => {
      mock.onGet(`${ BASE }/event-types`).reply({
        data: [
          { id: 456, title: '30 Min Meeting', lengthInMinutes: 30, slug: '30min' },
          { id: 457, title: 'Consult', length: 60, slug: 'consult' },
        ],
      })

      const result = await service.getEventTypesDictionary({})

      expect(result).toEqual({
        items: [
          { label: '30 Min Meeting', value: '456', note: '30 min • slug: 30min' },
          { label: 'Consult', value: '457', note: '60 min • slug: consult' },
        ],
        cursor: null,
      })
    })

    it('handles an eventTypes-wrapped response', async () => {
      mock.onGet(`${ BASE }/event-types`).reply({
        data: { eventTypes: [{ id: 1, title: 'A', lengthInMinutes: 15, slug: 'a' }] },
      })

      const result = await service.getEventTypesDictionary({})

      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toEqual({ label: 'A', value: '1', note: '15 min • slug: a' })
    })

    it('shows a ? for missing length', async () => {
      mock.onGet(`${ BASE }/event-types`).reply({ data: [{ id: 2, title: 'B', slug: 'b' }] })

      const result = await service.getEventTypesDictionary({})

      expect(result.items[0].note).toBe('? min • slug: b')
    })

    it('filters by search term (case-insensitive)', async () => {
      mock.onGet(`${ BASE }/event-types`).reply({
        data: [
          { id: 456, title: '30 Min Meeting', lengthInMinutes: 30, slug: '30min' },
          { id: 457, title: 'Consult', lengthInMinutes: 60, slug: 'consult' },
        ],
      })

      const result = await service.getEventTypesDictionary({ search: 'consult' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('457')
    })

    it('handles a null payload', async () => {
      mock.onGet(`${ BASE }/event-types`).reply({ data: [] })

      const result = await service.getEventTypesDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('propagates the wrapped error when listEventTypes fails', async () => {
      mock.onGet(`${ BASE }/event-types`).replyWithError({ message: 'Boom' })

      await expect(service.getEventTypesDictionary({})).rejects.toThrow('Cal.com API error: Boom')
    })
  })

  describe('getSchedulesDictionary', () => {
    it('maps schedules (array response) to items with time zone and default note', async () => {
      mock.onGet(`${ BASE }/schedules`).reply({
        data: [
          { id: 111, name: 'Working Hours', timeZone: 'America/New_York', isDefault: true },
          { id: 112, name: 'Weekend', timeZone: 'Europe/London' },
        ],
      })

      const result = await service.getSchedulesDictionary({})

      expect(result).toEqual({
        items: [
          { label: 'Working Hours', value: '111', note: 'America/New_York (default)' },
          { label: 'Weekend', value: '112', note: 'Europe/London' },
        ],
        cursor: null,
      })
    })

    it('handles a schedules-wrapped response and missing time zone', async () => {
      mock.onGet(`${ BASE }/schedules`).reply({
        data: { schedules: [{ id: 113, name: 'No TZ' }] },
      })

      const result = await service.getSchedulesDictionary({})

      expect(result.items).toEqual([{ label: 'No TZ', value: '113', note: 'no time zone' }])
    })

    it('filters by search term', async () => {
      mock.onGet(`${ BASE }/schedules`).reply({
        data: [
          { id: 111, name: 'Working Hours', timeZone: 'UTC' },
          { id: 112, name: 'Weekend', timeZone: 'UTC' },
        ],
      })

      const result = await service.getSchedulesDictionary({ search: 'weekend' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('112')
    })

    it('handles a null payload', async () => {
      mock.onGet(`${ BASE }/schedules`).reply({ data: [] })

      const result = await service.getSchedulesDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('propagates the wrapped error when listSchedules fails', async () => {
      mock.onGet(`${ BASE }/schedules`).replyWithError({ message: 'Boom' })

      await expect(service.getSchedulesDictionary({})).rejects.toThrow('Cal.com API error: Boom')
    })
  })

  // ── Realtime Trigger ──

  describe('onCalEvent', () => {
    it('shapes a delivery into a flattened event (SHAPE_EVENT)', () => {
      const body = {
        triggerEvent: 'BOOKING_CREATED',
        createdAt: '2024-08-01T12:00:00.000Z',
        payload: {
          uid: 'booking_abc123',
          bookingId: 123,
          title: '30 Min Meeting',
          status: 'ACCEPTED',
          startTime: '2024-08-13T09:00:00.000Z',
          endTime: '2024-08-13T09:30:00.000Z',
          eventTypeId: 456,
          attendees: [{ name: 'Bob', email: 'bob@example.com' }],
          organizer: { name: 'Host', email: 'host@example.com' },
          location: 'integrations:daily',
          metadata: { a: 1 },
        },
      }

      const result = service.onCalEvent('SHAPE_EVENT', body)

      expect(result).toEqual([
        {
          name: 'onCalEvent',
          data: {
            triggerEvent: 'BOOKING_CREATED',
            bookingUid: 'booking_abc123',
            bookingId: 123,
            title: '30 Min Meeting',
            status: 'ACCEPTED',
            startTime: '2024-08-13T09:00:00.000Z',
            endTime: '2024-08-13T09:30:00.000Z',
            eventTypeId: 456,
            attendees: [{ name: 'Bob', email: 'bob@example.com' }],
            organizer: { name: 'Host', email: 'host@example.com' },
            location: 'integrations:daily',
            metadata: { a: 1 },
            createdAt: '2024-08-01T12:00:00.000Z',
            payload: body.payload,
          },
        },
      ])
    })

    it('falls back to inner id and type.id when bookingId/eventTypeId are absent (SHAPE_EVENT)', () => {
      const body = {
        triggerEvent: 'BOOKING_CANCELLED',
        payload: { id: 999, type: { id: 555 } },
      }

      const result = service.onCalEvent('SHAPE_EVENT', body)

      expect(result[0].data.bookingId).toBe(999)
      expect(result[0].data.eventTypeId).toBe(555)
    })

    it('tolerates an empty body (SHAPE_EVENT)', () => {
      const result = service.onCalEvent('SHAPE_EVENT', {})

      expect(result[0].data).toMatchObject({
        triggerEvent: undefined,
        bookingUid: undefined,
        payload: {},
      })
    })

    it('matches triggers whose selected label maps to the delivered event (FILTER_TRIGGER)', () => {
      const payload = {
        eventData: { triggerEvent: 'BOOKING_CREATED' },
        triggers: [
          { id: 't1', data: { event: 'Booking Created' } },
          { id: 't2', data: { event: 'Booking Cancelled' } },
          { id: 't3', data: { event: 'Booking Created' } },
        ],
      }

      const result = service.onCalEvent('FILTER_TRIGGER', payload)

      expect(result).toEqual({ ids: ['t1', 't3'] })
    })

    it('matches nothing when no trigger label maps to the event (FILTER_TRIGGER)', () => {
      const payload = {
        eventData: { triggerEvent: 'MEETING_ENDED' },
        triggers: [{ id: 't1', data: { event: 'Booking Created' } }],
      }

      const result = service.onCalEvent('FILTER_TRIGGER', payload)

      expect(result).toEqual({ ids: [] })
    })

    it('reads the delivered event from payload.data when eventData is absent (FILTER_TRIGGER)', () => {
      const payload = {
        data: { triggerEvent: 'BOOKING_PAID' },
        triggers: [{ id: 't1', data: { event: 'Booking Paid' } }],
      }

      const result = service.onCalEvent('FILTER_TRIGGER', payload)

      expect(result).toEqual({ ids: ['t1'] })
    })

    it('returns undefined for an unknown call type', () => {
      expect(service.onCalEvent('UNKNOWN', {})).toBeUndefined()
    })
  })

  // ── SYSTEM trigger handlers ──

  describe('handleTriggerUpsertWebhook', () => {
    it('creates one webhook per event and appends the connectionId to the callback', async () => {
      mock.onPost(`${ BASE }/webhooks`).reply({ data: { id: 'wh_1' } })

      const result = await service.handleTriggerUpsertWebhook({
        callbackUrl: 'https://hooks.example.com/cal',
        connectionId: 'conn-1',
        events: [{ id: 'trig-1', triggerData: { event: 'Booking Created' } }],
      })

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].url).toBe(`${ BASE }/webhooks`)
      expect(mock.history[0].method).toBe('post')
      // webhooks use their own version field, no cal-api-version header
      expect(mock.history[0].headers['cal-api-version']).toBeUndefined()
      expect(mock.history[0].body).toEqual({
        subscriberUrl: 'https://hooks.example.com/cal?connectionId=conn-1',
        triggers: ['BOOKING_CREATED'],
        active: true,
      })
      expect(result).toEqual({
        webhookData: { webhooks: [{ triggerId: 'trig-1', webhookId: 'wh_1', event: 'BOOKING_CREATED' }] },
        connectionId: 'conn-1',
      })
    })

    it('uses & as the separator when the callback already has a query string', async () => {
      mock.onPost(`${ BASE }/webhooks`).reply({ data: { id: 'wh_2' } })

      await service.handleTriggerUpsertWebhook({
        callbackUrl: 'https://hooks.example.com/cal?foo=bar',
        connectionId: 'conn-2',
        events: [{ id: 'trig-2', triggerData: { event: 'Meeting Ended' } }],
      })

      expect(mock.history[0].body.subscriberUrl).toBe(
        'https://hooks.example.com/cal?foo=bar&connectionId=conn-2'
      )
      expect(mock.history[0].body.triggers).toEqual(['MEETING_ENDED'])
    })

    it('creates a webhook per event and returns all of them', async () => {
      mock.onPost(`${ BASE }/webhooks`).replyWith(() => ({ data: { id: 'wh_multi' } }))

      const result = await service.handleTriggerUpsertWebhook({
        callbackUrl: 'https://hooks.example.com/cal',
        connectionId: 'conn-3',
        events: [
          { id: 'trig-a', triggerData: { event: 'Booking Created' } },
          { id: 'trig-b', triggerData: { event: 'Booking Cancelled' } },
        ],
      })

      expect(mock.history).toHaveLength(2)
      expect(result.webhookData.webhooks).toHaveLength(2)
      expect(result.webhookData.webhooks[1]).toEqual({
        triggerId: 'trig-b',
        webhookId: 'wh_multi',
        event: 'BOOKING_CANCELLED',
      })
    })

    it('returns an empty webhook list when there are no events', async () => {
      const result = await service.handleTriggerUpsertWebhook({
        callbackUrl: 'https://hooks.example.com/cal',
        connectionId: 'conn-4',
      })

      expect(mock.history).toHaveLength(0)
      expect(result).toEqual({ webhookData: { webhooks: [] }, connectionId: 'conn-4' })
    })

    it('throws a wrapped error when webhook creation fails', async () => {
      mock.onPost(`${ BASE }/webhooks`).replyWithError({ message: 'Boom' })

      await expect(
        service.handleTriggerUpsertWebhook({
          callbackUrl: 'https://hooks.example.com/cal',
          connectionId: 'conn-5',
          events: [{ id: 'trig-x', triggerData: { event: 'Booking Created' } }],
        })
      ).rejects.toThrow('Cal.com API error: Boom')
    })
  })

  describe('handleTriggerResolveEvents', () => {
    it('returns a handshake when the invocation has no body', async () => {
      const result = await service.handleTriggerResolveEvents({})

      expect(result).toEqual({ handshake: true, responseToExternalService: {} })
    })

    it('returns a handshake when the invocation itself is missing', async () => {
      const result = await service.handleTriggerResolveEvents(null)

      expect(result).toEqual({ handshake: true, responseToExternalService: {} })
    })

    it('returns empty events when the body has no triggerEvent', async () => {
      const result = await service.handleTriggerResolveEvents({
        body: { foo: 'bar' },
        queryParams: { connectionId: 'conn-1' },
      })

      expect(result).toEqual({ connectionId: 'conn-1', events: [] })
    })

    it('shapes the delivery into events when a triggerEvent is present', async () => {
      const result = await service.handleTriggerResolveEvents({
        body: {
          triggerEvent: 'BOOKING_CREATED',
          createdAt: '2024-08-01T12:00:00.000Z',
          payload: { uid: 'booking_abc123', title: '30 Min Meeting' },
        },
        queryParams: { connectionId: 'conn-2' },
      })

      expect(result.connectionId).toBe('conn-2')
      expect(result.events).toHaveLength(1)
      expect(result.events[0].name).toBe('onCalEvent')
      expect(result.events[0].data).toMatchObject({
        triggerEvent: 'BOOKING_CREATED',
        bookingUid: 'booking_abc123',
        title: '30 Min Meeting',
      })
    })
  })

  describe('handleTriggerSelectMatched', () => {
    it('delegates to the named event method as a FILTER_TRIGGER', async () => {
      const result = await service.handleTriggerSelectMatched({
        eventName: 'onCalEvent',
        eventData: { triggerEvent: 'BOOKING_CREATED' },
        triggers: [
          { id: 't1', data: { event: 'Booking Created' } },
          { id: 't2', data: { event: 'Booking Rejected' } },
        ],
      })

      expect(result).toEqual({ ids: ['t1'] })
    })
  })

  describe('handleTriggerDeleteWebhook', () => {
    it('deletes each webhook with an id and clears the webhook data', async () => {
      mock.onDelete(`${ BASE }/webhooks/wh_1`).reply({ data: {} })
      mock.onDelete(`${ BASE }/webhooks/wh_2`).reply({ data: {} })

      const result = await service.handleTriggerDeleteWebhook({
        webhookData: {
          webhooks: [
            { webhookId: 'wh_1' },
            { webhookId: 'wh_2' },
          ],
        },
      })

      expect(mock.history).toHaveLength(2)
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${ BASE }/webhooks/wh_1`)
      expect(mock.history[0].headers['cal-api-version']).toBeUndefined()
      expect(result).toEqual({ webhookData: {} })
    })

    it('skips entries without a webhookId', async () => {
      mock.onDelete(`${ BASE }/webhooks/wh_1`).reply({ data: {} })

      const result = await service.handleTriggerDeleteWebhook({
        webhookData: { webhooks: [{ webhookId: 'wh_1' }, { triggerId: 't-no-webhook' }] },
      })

      expect(mock.history).toHaveLength(1)
      expect(result).toEqual({ webhookData: {} })
    })

    it('swallows delete failures and still clears the data', async () => {
      mock.onDelete(`${ BASE }/webhooks/wh_1`).replyWithError({ message: 'Boom' })

      const result = await service.handleTriggerDeleteWebhook({
        webhookData: { webhooks: [{ webhookId: 'wh_1' }] },
      })

      expect(result).toEqual({ webhookData: {} })
    })

    it('handles missing webhook data gracefully', async () => {
      const result = await service.handleTriggerDeleteWebhook({})

      expect(mock.history).toHaveLength(0)
      expect(result).toEqual({ webhookData: {} })
    })
  })
})
