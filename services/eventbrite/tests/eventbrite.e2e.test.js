'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Eventbrite Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('eventbrite')
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

  // Most Eventbrite operations are organization-scoped. The developer must
  // supply testValues.organizationId (from Get User / Get Organizations
  // Dictionary) for the org/event lifecycle tests to run.
  const orgId = () => testValues.organizationId
  const hasOrg = () => Boolean(orgId())

  // ── Me ──

  describe('getUser', () => {
    it('returns the connected user profile with expected shape', async () => {
      const response = await service.getUser()

      expect(response).toHaveProperty('id')
      expect(response).toHaveProperty('emails')
      expect(Array.isArray(response.emails)).toBe(true)
    })
  })

  // ── Categories ──

  describe('listCategories', () => {
    it('returns categories with expected shape', async () => {
      const response = await service.listCategories()

      expect(response).toHaveProperty('categories')
      expect(Array.isArray(response.categories)).toBe(true)
    })
  })

  describe('getCategoriesDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getCategoriesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Organizations ──

  describe('getOrganizationsDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getOrganizationsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Events (org-scoped) ──

  describe('listEvents', () => {
    it('returns events with expected shape when an organization id is configured', async () => {
      if (!hasOrg()) {
        console.log('Skipping listEvents: set testValues.organizationId')
        return
      }

      const response = await service.listEvents(orgId())

      expect(response).toHaveProperty('events')
      expect(Array.isArray(response.events)).toBe(true)
      expect(response).toHaveProperty('pagination')
    })
  })

  describe('getEventsDictionary', () => {
    it('returns dictionary items array for the configured organization', async () => {
      if (!hasOrg()) {
        console.log('Skipping getEventsDictionary: set testValues.organizationId')
        return
      }

      const result = await service.getEventsDictionary({ criteria: { organizationId: orgId() } })

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // Full event lifecycle: create (draft) -> get -> update -> add ticket class ->
  // list ticket classes -> update/delete ticket class -> cancel/delete cleanup.
  describe('event lifecycle (create/get/update/ticket classes)', () => {
    let eventId
    let ticketClassId

    afterAll(async () => {
      // Best-effort cleanup: cancel the draft event so it doesn't linger.
      if (eventId) {
        try {
          await service.cancelEvent(eventId)
        } catch (e) {
          // Draft events can't always be canceled; ignore.
        }
      }
    })

    it('creates a draft event', async () => {
      if (!hasOrg()) {
        console.log('Skipping event lifecycle: set testValues.organizationId')
        return
      }

      const start = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      const end = new Date(start.getTime() + 2 * 60 * 60 * 1000)
      const toUtc = (d) => `${ d.toISOString().split('.')[0] }Z`

      const response = await service.createEvent(
        orgId(),
        `E2E Event ${ suffix }`,
        'America/New_York',
        toUtc(start),
        toUtc(end),
        'USD'
      )

      expect(response).toHaveProperty('id')
      expect(response).toHaveProperty('status', 'draft')
      eventId = response.id
    })

    it('retrieves the created event', async () => {
      if (!eventId) {
        return
      }

      const response = await service.getEvent(eventId)

      expect(response).toHaveProperty('id', eventId)
    })

    it('updates the event name', async () => {
      if (!eventId) {
        return
      }

      const response = await service.updateEvent(eventId, `E2E Event Updated ${ suffix }`)

      expect(response).toHaveProperty('id', eventId)
    })

    it('creates a ticket class for the event', async () => {
      if (!eventId) {
        return
      }

      const response = await service.createTicketClass(eventId, 'General Admission', 100, false, 'USD,2500')

      expect(response).toHaveProperty('id')
      ticketClassId = response.id
    })

    it('lists the ticket classes', async () => {
      if (!eventId) {
        return
      }

      const response = await service.listTicketClasses(eventId)

      expect(response).toHaveProperty('ticket_classes')
      expect(Array.isArray(response.ticket_classes)).toBe(true)
    })

    it('updates the ticket class', async () => {
      if (!ticketClassId) {
        return
      }

      const response = await service.updateTicketClass(eventId, ticketClassId, 'VIP', 50, false, 'USD,5000')

      expect(response).toHaveProperty('id', ticketClassId)
    })

    it('deletes the ticket class', async () => {
      if (!ticketClassId) {
        return
      }

      const response = await service.deleteTicketClass(eventId, ticketClassId)

      expect(response).toBeDefined()
    })

    it('lists attendees for the event', async () => {
      if (!eventId) {
        return
      }

      const response = await service.listAttendees(eventId)

      expect(response).toHaveProperty('attendees')
      expect(Array.isArray(response.attendees)).toBe(true)
    })

    it('lists orders for the event', async () => {
      if (!eventId) {
        return
      }

      const response = await service.listOrders(eventId)

      expect(response).toHaveProperty('orders')
      expect(Array.isArray(response.orders)).toBe(true)
    })
  })

  // ── Venues (org-scoped) ──

  describe('venue lifecycle (create/get/list)', () => {
    let venueId

    it('creates a venue', async () => {
      if (!hasOrg()) {
        console.log('Skipping venue lifecycle: set testValues.organizationId')
        return
      }

      const response = await service.createVenue(
        orgId(),
        `E2E Venue ${ suffix }`,
        '123 Market St',
        undefined,
        'San Francisco',
        'CA',
        '94103',
        'US'
      )

      expect(response).toHaveProperty('id')
      venueId = response.id
    })

    it('retrieves the created venue', async () => {
      if (!venueId) {
        return
      }

      const response = await service.getVenue(venueId)

      expect(response).toHaveProperty('id', venueId)
    })

    it('lists venues for the organization', async () => {
      if (!hasOrg()) {
        return
      }

      const response = await service.listVenues(orgId())

      expect(response).toHaveProperty('venues')
      expect(Array.isArray(response.venues)).toBe(true)
    })
  })

  // ── Orders (org-scoped, read-only) ──

  describe('listOrders (organization)', () => {
    it('returns orders with expected shape for the organization', async () => {
      if (!hasOrg()) {
        console.log('Skipping listOrders(org): set testValues.organizationId')
        return
      }

      const response = await service.listOrders(undefined, orgId())

      expect(response).toHaveProperty('orders')
      expect(Array.isArray(response.orders)).toBe(true)
    })
  })
})
