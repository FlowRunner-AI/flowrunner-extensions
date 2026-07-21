'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Demio Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('demio')
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

  // A unique-ish suffix so repeated e2e runs don't collide.
  const suffix = Date.now()

  // ── Events ──

  describe('listEvents', () => {
    it('returns upcoming events as an array', async () => {
      const result = await service.listEvents('Upcoming')

      expect(Array.isArray(result)).toBe(true)
    })

    it('returns past events as an array', async () => {
      const result = await service.listEvents('Past')

      expect(Array.isArray(result)).toBe(true)
    })

    it('returns automated events as an array', async () => {
      const result = await service.listEvents('Automated')

      expect(Array.isArray(result)).toBe(true)
    })
  })

  describe('getEvent', () => {
    // Needs a real event id. Falls back to the first upcoming event when
    // testValues.eventId is not supplied.
    it('retrieves a single event by id', async () => {
      let eventId = testValues.eventId

      if (!eventId) {
        const events = await service.listEvents('Upcoming')
        eventId = Array.isArray(events) && events.length ? events[0].id : undefined
      }

      if (!eventId) {
        console.log('Skipping getEvent: no upcoming events and no testValues.eventId')
        return
      }

      const result = await service.getEvent(eventId)

      expect(result).toHaveProperty('id')
    })

    it('retrieves a single event with active dates only', async () => {
      let eventId = testValues.eventId

      if (!eventId) {
        const events = await service.listEvents('Upcoming')
        eventId = Array.isArray(events) && events.length ? events[0].id : undefined
      }

      if (!eventId) {
        console.log('Skipping getEvent (activeOnly): no upcoming events and no testValues.eventId')
        return
      }

      const result = await service.getEvent(eventId, true)

      expect(result).toHaveProperty('id')
    })
  })

  describe('getEventSession', () => {
    // Needs an event id + a date_id from that event's "dates" array.
    it('retrieves a single session by event id and date id', async () => {
      let eventId = testValues.eventId
      let dateId = testValues.dateId

      if (!eventId || !dateId) {
        const events = await service.listEvents('Upcoming')
        const event = Array.isArray(events) && events.length ? events[0] : undefined

        if (event) {
          eventId = event.id
          dateId = Array.isArray(event.dates) && event.dates.length ? event.dates[0].date_id : undefined
        }
      }

      if (!eventId || !dateId) {
        console.log('Skipping getEventSession: could not resolve an event id + date id')
        return
      }

      const result = await service.getEventSession(eventId, dateId)

      expect(result).toBeDefined()
    })
  })

  // ── Participants ──

  describe('listSessionParticipants', () => {
    // Needs a date_id. Falls back to the first upcoming event's first date.
    it('lists participants for a session', async () => {
      let dateId = testValues.dateId

      if (!dateId) {
        const events = await service.listEvents('Upcoming')
        const event = Array.isArray(events) && events.length ? events[0] : undefined
        dateId = event && Array.isArray(event.dates) && event.dates.length
          ? event.dates[0].date_id
          : undefined
      }

      if (!dateId) {
        console.log('Skipping listSessionParticipants: could not resolve a date id')
        return
      }

      const result = await service.listSessionParticipants(dateId)

      expect(result).toBeDefined()
    })

    it('lists participants filtered by Attended status', async () => {
      let dateId = testValues.dateId

      if (!dateId) {
        const events = await service.listEvents('Upcoming')
        const event = Array.isArray(events) && events.length ? events[0] : undefined
        dateId = event && Array.isArray(event.dates) && event.dates.length
          ? event.dates[0].date_id
          : undefined
      }

      if (!dateId) {
        console.log('Skipping listSessionParticipants (Attended): could not resolve a date id')
        return
      }

      const result = await service.listSessionParticipants(dateId, 'Attended')

      expect(result).toBeDefined()
    })
  })

  // ── Registration ──

  describe('registerParticipant', () => {
    // Registering a real participant modifies the account, so this only runs
    // when the developer supplies an event id + date id (or a registration ref url).
    const canRegister = () =>
      Boolean((testValues.eventId && testValues.dateId) || testValues.refUrl)

    it('registers a participant when target session is configured', async () => {
      if (!canRegister()) {
        console.log(
          'Skipping registerParticipant: set testValues.eventId + testValues.dateId (or testValues.refUrl)'
        )
        return
      }

      const email = `e2e-participant-${ suffix }@example.com`

      const result = await service.registerParticipant(
        'E2E Tester',
        email,
        testValues.eventId,
        testValues.dateId,
        testValues.refUrl
      )

      expect(result).toBeDefined()
    })
  })

  // ── Dictionary ──

  describe('getEventsDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getEventsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor')
    })

    it('supports search filtering', async () => {
      const result = await service.getEventsDictionary({ search: 'zzz-no-match-zzz' })

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })
})
