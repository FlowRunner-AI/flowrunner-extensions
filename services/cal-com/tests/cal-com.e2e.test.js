'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Cal.com Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('cal-com')
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

  // A unique-ish suffix so repeated e2e runs don't collide on slugs.
  const suffix = Date.now()

  // ── Account ──

  describe('getMyProfile', () => {
    it('returns the connected account profile', async () => {
      const response = await service.getMyProfile()

      expect(response).toHaveProperty('id')
      expect(response).toHaveProperty('email')
    })
  })

  // ── Event Types ──

  describe('listEventTypes', () => {
    it('returns an array of event types', async () => {
      const response = await service.listEventTypes()

      expect(Array.isArray(response)).toBe(true)
    })
  })

  describe('getEventTypesDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getEventTypesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor', null)
    })
  })

  describe('createEventType + getEventType + updateEventType + getAvailableSlots + deleteEventType', () => {
    let eventTypeId

    it('creates an event type', async () => {
      const response = await service.createEventType(
        30,
        `E2E Meeting ${ suffix }`,
        `e2e-meeting-${ suffix }`,
        'Created by the e2e test suite'
      )

      expect(response).toHaveProperty('id')
      eventTypeId = response.id
    })

    it('retrieves the created event type', async () => {
      const response = await service.getEventType(eventTypeId)

      expect(response).toHaveProperty('id', eventTypeId)
      expect(response).toHaveProperty('slug', `e2e-meeting-${ suffix }`)
    })

    it('updates the event type', async () => {
      const response = await service.updateEventType(eventTypeId, `E2E Meeting Updated ${ suffix }`)

      expect(response).toHaveProperty('id', eventTypeId)
    })

    it('returns available slots for the event type', async () => {
      const start = new Date().toISOString()
      const end = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

      const response = await service.getAvailableSlots(eventTypeId, start, end)

      // Slots come back keyed by date; an object is enough to assert shape.
      expect(response).toBeDefined()
      expect(typeof response).toBe('object')
    })

    it('deletes the event type', async () => {
      const response = await service.deleteEventType(eventTypeId)

      expect(response).toEqual({ deleted: true, eventTypeId })
    })

    afterAll(async () => {
      // Safety net: if a later step failed, still try to remove the event type.
      if (eventTypeId) {
        try {
          await service.deleteEventType(eventTypeId)
        } catch (e) {
          // ignore — most likely already deleted
        }
      }
    })
  })

  // ── Schedules ──

  describe('listSchedules', () => {
    it('returns an array of schedules', async () => {
      const response = await service.listSchedules()

      expect(Array.isArray(response)).toBe(true)
    })
  })

  describe('getSchedule', () => {
    it('retrieves the first schedule if the account has any', async () => {
      const schedules = await service.listSchedules()

      if (!Array.isArray(schedules) || schedules.length === 0) {
        console.log('Skipping getSchedule: the account has no schedules')
        return
      }

      const response = await service.getSchedule(schedules[0].id)

      expect(response).toHaveProperty('id', schedules[0].id)
    })
  })

  describe('getSchedulesDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getSchedulesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor', null)
    })
  })

  // ── Bookings (read) ──

  describe('listBookings', () => {
    it('returns bookings with the default filters', async () => {
      const response = await service.listBookings(undefined, undefined, undefined, undefined, undefined, 5, 0)

      expect(Array.isArray(response)).toBe(true)
    })

    it('accepts a status filter', async () => {
      const response = await service.listBookings('Upcoming', undefined, undefined, undefined, undefined, 5, 0)

      expect(Array.isArray(response)).toBe(true)
    })
  })

  describe('getBooking', () => {
    // Needs an existing booking. Supply testValues.bookingUid to run this.
    it('retrieves a booking when a uid is configured', async () => {
      if (!testValues.bookingUid) {
        console.log('Skipping getBooking: set testValues.bookingUid to a real booking uid')
        return
      }

      const response = await service.getBooking(testValues.bookingUid)

      expect(response).toHaveProperty('uid', testValues.bookingUid)
    })
  })

  // ── Bookings (write / lifecycle) ──

  describe('createBooking + cancelBooking', () => {
    // Creating a real booking needs a bookable event type id and an available
    // slot; supply testValues.bookableEventTypeId + testValues.attendeeEmail.
    const canBook = () =>
      Boolean(testValues.bookableEventTypeId && testValues.attendeeEmail)

    let createdUid

    it('creates and then cancels a booking when configured', async () => {
      if (!canBook()) {
        console.log(
          'Skipping createBooking: set testValues.bookableEventTypeId and testValues.attendeeEmail'
        )
        return
      }

      const start = new Date().toISOString()
      const end = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
      const slots = await service.getAvailableSlots(testValues.bookableEventTypeId, start, end)

      // Pick the first available slot from the date-keyed slots object.
      const firstDay = Object.values(slots || {})[0]
      const firstSlot = Array.isArray(firstDay) ? firstDay[0] : undefined

      if (!firstSlot || !firstSlot.start) {
        console.log('Skipping createBooking: no available slots in the next 14 days')
        return
      }

      const created = await service.createBooking(
        testValues.bookableEventTypeId,
        firstSlot.start,
        'E2E Tester',
        testValues.attendeeEmail,
        testValues.attendeeTimeZone || 'UTC'
      )

      expect(created).toHaveProperty('uid')
      createdUid = created.uid

      const cancelled = await service.cancelBooking(createdUid, 'E2E test cleanup')

      expect(cancelled).toBeDefined()
    })

    afterAll(async () => {
      // If cancel above didn't run but a booking was created, clean it up.
      if (createdUid) {
        try {
          await service.cancelBooking(createdUid, 'E2E test cleanup')
        } catch (e) {
          // ignore — most likely already cancelled
        }
      }
    })
  })

  describe('rescheduleBooking', () => {
    // Reschedule needs an existing, active booking uid + a new available slot.
    const canReschedule = () =>
      Boolean(testValues.rescheduleBookingUid && testValues.rescheduleEventTypeId)

    it('reschedules a booking when configured', async () => {
      if (!canReschedule()) {
        console.log(
          'Skipping rescheduleBooking: set testValues.rescheduleBookingUid and testValues.rescheduleEventTypeId'
        )
        return
      }

      const start = new Date().toISOString()
      const end = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
      const slots = await service.getAvailableSlots(testValues.rescheduleEventTypeId, start, end)
      const firstDay = Object.values(slots || {})[0]
      const firstSlot = Array.isArray(firstDay) ? firstDay[0] : undefined

      if (!firstSlot || !firstSlot.start) {
        console.log('Skipping rescheduleBooking: no available slots to reschedule into')
        return
      }

      const response = await service.rescheduleBooking(
        testValues.rescheduleBookingUid,
        firstSlot.start,
        'E2E reschedule'
      )

      expect(response).toBeDefined()
    })
  })

  describe('confirmBooking / declineBooking', () => {
    // These act on a booking that is awaiting the host's approval.
    it('confirms an unconfirmed booking when configured', async () => {
      if (!testValues.unconfirmedBookingUid) {
        console.log('Skipping confirmBooking: set testValues.unconfirmedBookingUid')
        return
      }

      const response = await service.confirmBooking(testValues.unconfirmedBookingUid)

      expect(response).toBeDefined()
    })

    it('declines an unconfirmed booking when configured', async () => {
      if (!testValues.declineBookingUid) {
        console.log('Skipping declineBooking: set testValues.declineBookingUid')
        return
      }

      const response = await service.declineBooking(testValues.declineBookingUid, 'E2E decline')

      expect(response).toBeDefined()
    })
  })

  describe('markAbsent', () => {
    // Needs a past booking uid whose attendance can be recorded.
    it('marks the host absent on a booking when configured', async () => {
      if (!testValues.markAbsentBookingUid) {
        console.log('Skipping markAbsent: set testValues.markAbsentBookingUid')
        return
      }

      const response = await service.markAbsent(testValues.markAbsentBookingUid, true)

      expect(response).toBeDefined()
    })
  })
})
