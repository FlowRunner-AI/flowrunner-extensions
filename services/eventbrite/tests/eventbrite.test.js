'use strict'

const { createSandbox } = require('../../../service-sandbox')

const PRIVATE_TOKEN = 'test-private-token'
const BASE = 'https://www.eventbriteapi.com/v3'

describe('Eventbrite Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ privateToken: PRIVATE_TOKEN })
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
      expect(sandbox.getConfigItems()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'privateToken', required: true, shared: false }),
        ])
      )
    })
  })

  // ── Events ──

  describe('listEvents', () => {
    it('sends correct request with required params only', async () => {
      mock.onGet(`${BASE}/organizations/org123/events/`).reply({ events: [], pagination: {} })

      const result = await service.listEvents('org123')

      expect(result).toEqual({ events: [], pagination: {} })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({ Authorization: `Bearer ${PRIVATE_TOKEN}` })
    })

    it('resolves status choice to API value', async () => {
      mock.onGet(`${BASE}/organizations/org123/events/`).reply({ events: [] })

      await service.listEvents('org123', 'Live')

      expect(mock.history[0].query).toMatchObject({ status: 'live' })
    })

    it('resolves time filter choice', async () => {
      mock.onGet(`${BASE}/organizations/org123/events/`).reply({ events: [] })

      await service.listEvents('org123', undefined, 'Current & Future')

      expect(mock.history[0].query).toMatchObject({ time_filter: 'current_future' })
    })

    it('resolves order by choice', async () => {
      mock.onGet(`${BASE}/organizations/org123/events/`).reply({ events: [] })

      await service.listEvents('org123', undefined, undefined, 'Created Descending')

      expect(mock.history[0].query).toMatchObject({ order_by: 'created_desc' })
    })

    it('passes continuation token', async () => {
      mock.onGet(`${BASE}/organizations/org123/events/`).reply({ events: [] })

      await service.listEvents('org123', undefined, undefined, undefined, 'token123')

      expect(mock.history[0].query).toMatchObject({ continuation: 'token123' })
    })

    it('throws on API error', async () => {
      mock.onGet(`${BASE}/organizations/org123/events/`).replyWithError({
        message: 'Unauthorized',
        body: { error_description: 'Invalid token' },
      })

      await expect(service.listEvents('org123')).rejects.toThrow('Eventbrite API error: Invalid token')
    })
  })

  describe('getEvent', () => {
    it('sends correct request without expand', async () => {
      mock.onGet(`${BASE}/events/ev123/`).reply({ id: 'ev123', name: { text: 'Test' } })

      const result = await service.getEvent('ev123')

      expect(result).toMatchObject({ id: 'ev123' })
      expect(mock.history).toHaveLength(1)
    })

    it('sends expand as comma-separated string', async () => {
      mock.onGet(`${BASE}/events/ev123/`).reply({ id: 'ev123' })

      await service.getEvent('ev123', ['venue', 'ticket_availability'])

      expect(mock.history[0].query).toMatchObject({ expand: 'venue,ticket_availability' })
    })

    it('handles empty expand array', async () => {
      mock.onGet(`${BASE}/events/ev123/`).reply({ id: 'ev123' })

      await service.getEvent('ev123', [])

      expect(mock.history[0].query).not.toHaveProperty('expand')
    })
  })

  describe('createEvent', () => {
    it('sends correct body with required fields', async () => {
      mock.onPost(`${BASE}/organizations/org123/events/`).reply({ id: 'ev999', status: 'draft' })

      const result = await service.createEvent(
        'org123', 'Test Event', 'America/New_York',
        '2026-09-01T22:00:00Z', '2026-09-02T01:00:00Z', 'USD'
      )

      expect(result).toMatchObject({ id: 'ev999', status: 'draft' })
      expect(mock.history[0].body).toEqual({
        event: {
          name: { html: 'Test Event' },
          start: { timezone: 'America/New_York', utc: '2026-09-01T22:00:00Z' },
          end: { timezone: 'America/New_York', utc: '2026-09-02T01:00:00Z' },
          currency: 'USD',
          online_event: false,
        },
      })
    })

    it('includes optional fields when provided', async () => {
      mock.onPost(`${BASE}/organizations/org123/events/`).reply({ id: 'ev999' })

      await service.createEvent(
        'org123', 'Online Event', 'UTC',
        '2026-09-01T00:00:00Z', '2026-09-01T02:00:00Z', 'EUR',
        true, 'venue456', 'cat789'
      )

      expect(mock.history[0].body.event).toMatchObject({
        online_event: true,
        venue_id: 'venue456',
        category_id: 'cat789',
      })
    })

    it('omits venue_id and category_id when not provided', async () => {
      mock.onPost(`${BASE}/organizations/org123/events/`).reply({ id: 'ev999' })

      await service.createEvent(
        'org123', 'Simple Event', 'UTC',
        '2026-09-01T00:00:00Z', '2026-09-01T02:00:00Z', 'USD'
      )

      expect(mock.history[0].body.event).not.toHaveProperty('venue_id')
      expect(mock.history[0].body.event).not.toHaveProperty('category_id')
    })
  })

  describe('updateEvent', () => {
    it('sends only provided fields', async () => {
      mock.onPost(`${BASE}/events/ev123/`).reply({ id: 'ev123' })

      await service.updateEvent('ev123', 'New Name')

      expect(mock.history[0].body).toEqual({
        event: { name: { html: 'New Name' } },
      })
    })

    it('sends start/end with timezone when provided', async () => {
      mock.onPost(`${BASE}/events/ev123/`).reply({ id: 'ev123' })

      await service.updateEvent('ev123', undefined, 'UTC', '2026-10-01T00:00:00Z', '2026-10-01T02:00:00Z')

      expect(mock.history[0].body.event).toMatchObject({
        start: { timezone: 'UTC', utc: '2026-10-01T00:00:00Z' },
        end: { timezone: 'UTC', utc: '2026-10-01T02:00:00Z' },
      })
    })

    it('sends online_event when explicitly set', async () => {
      mock.onPost(`${BASE}/events/ev123/`).reply({ id: 'ev123' })

      await service.updateEvent('ev123', undefined, undefined, undefined, undefined, undefined, true)

      expect(mock.history[0].body.event).toMatchObject({ online_event: true })
    })
  })

  describe('publishEvent', () => {
    it('sends POST with empty body', async () => {
      mock.onPost(`${BASE}/events/ev123/publish/`).reply({ published: true })

      const result = await service.publishEvent('ev123')

      expect(result).toEqual({ published: true })
      expect(mock.history[0].body).toEqual({})
    })
  })

  describe('unpublishEvent', () => {
    it('sends POST with empty body', async () => {
      mock.onPost(`${BASE}/events/ev123/unpublish/`).reply({ unpublished: true })

      const result = await service.unpublishEvent('ev123')

      expect(result).toEqual({ unpublished: true })
    })
  })

  describe('cancelEvent', () => {
    it('sends POST with empty body', async () => {
      mock.onPost(`${BASE}/events/ev123/cancel/`).reply({ canceled: true })

      const result = await service.cancelEvent('ev123')

      expect(result).toEqual({ canceled: true })
    })
  })

  // ── Attendees ──

  describe('listAttendees', () => {
    it('sends correct request with required params', async () => {
      mock.onGet(`${BASE}/events/ev123/attendees/`).reply({ attendees: [], pagination: {} })

      const result = await service.listAttendees('ev123')

      expect(result).toHaveProperty('attendees')
      expect(mock.history).toHaveLength(1)
    })

    it('resolves status choice', async () => {
      mock.onGet(`${BASE}/events/ev123/attendees/`).reply({ attendees: [] })

      await service.listAttendees('ev123', 'Not Attending')

      expect(mock.history[0].query).toMatchObject({ status: 'not_attending' })
    })

    it('passes continuation token', async () => {
      mock.onGet(`${BASE}/events/ev123/attendees/`).reply({ attendees: [] })

      await service.listAttendees('ev123', undefined, 'token456')

      expect(mock.history[0].query).toMatchObject({ continuation: 'token456' })
    })
  })

  describe('getAttendee', () => {
    it('sends correct request', async () => {
      mock.onGet(`${BASE}/events/ev123/attendees/att456/`).reply({ id: 'att456', status: 'Attending' })

      const result = await service.getAttendee('ev123', 'att456')

      expect(result).toMatchObject({ id: 'att456' })
      expect(mock.history).toHaveLength(1)
    })
  })

  // ── Orders ──

  describe('listOrders', () => {
    it('sends request to event URL when eventId is provided', async () => {
      mock.onGet(`${BASE}/events/ev123/orders/`).reply({ orders: [], pagination: {} })

      await service.listOrders('ev123')

      expect(mock.history[0].url).toBe(`${BASE}/events/ev123/orders/`)
    })

    it('sends request to organization URL when only organizationId is provided', async () => {
      mock.onGet(`${BASE}/organizations/org123/orders/`).reply({ orders: [], pagination: {} })

      await service.listOrders(undefined, 'org123')

      expect(mock.history[0].url).toBe(`${BASE}/organizations/org123/orders/`)
    })

    it('throws when neither eventId nor organizationId is provided', async () => {
      await expect(service.listOrders()).rejects.toThrow(
        'Eventbrite API error: provide either an event ID or an organization ID to list orders.'
      )
    })

    it('resolves status choice', async () => {
      mock.onGet(`${BASE}/events/ev123/orders/`).reply({ orders: [] })

      await service.listOrders('ev123', undefined, 'Refunded')

      expect(mock.history[0].query).toMatchObject({ status: 'refunded' })
    })

    it('prefers eventId when both are provided', async () => {
      mock.onGet(`${BASE}/events/ev123/orders/`).reply({ orders: [] })

      await service.listOrders('ev123', 'org123')

      expect(mock.history[0].url).toBe(`${BASE}/events/ev123/orders/`)
    })
  })

  describe('getOrder', () => {
    it('sends correct request without expand', async () => {
      mock.onGet(`${BASE}/orders/ord789/`).reply({ id: 'ord789', status: 'placed' })

      const result = await service.getOrder('ord789')

      expect(result).toMatchObject({ id: 'ord789' })
    })

    it('sends expand as comma-separated string', async () => {
      mock.onGet(`${BASE}/orders/ord789/`).reply({ id: 'ord789' })

      await service.getOrder('ord789', ['attendees', 'event'])

      expect(mock.history[0].query).toMatchObject({ expand: 'attendees,event' })
    })
  })

  // ── Ticket Classes ──

  describe('listTicketClasses', () => {
    it('sends correct request', async () => {
      mock.onGet(`${BASE}/events/ev123/ticket_classes/`).reply({ ticket_classes: [], pagination: {} })

      const result = await service.listTicketClasses('ev123')

      expect(result).toHaveProperty('ticket_classes')
    })

    it('passes continuation token', async () => {
      mock.onGet(`${BASE}/events/ev123/ticket_classes/`).reply({ ticket_classes: [] })

      await service.listTicketClasses('ev123', 'tokenXYZ')

      expect(mock.history[0].query).toMatchObject({ continuation: 'tokenXYZ' })
    })
  })

  describe('createTicketClass', () => {
    it('sends correct body for paid ticket', async () => {
      mock.onPost(`${BASE}/events/ev123/ticket_classes/`).reply({ id: 'tc111' })

      await service.createTicketClass('ev123', 'VIP', 50, false, 'USD,5000')

      expect(mock.history[0].body).toEqual({
        ticket_class: {
          name: 'VIP',
          quantity_total: 50,
          free: false,
          cost: 'USD,5000',
        },
      })
    })

    it('omits cost for free ticket', async () => {
      mock.onPost(`${BASE}/events/ev123/ticket_classes/`).reply({ id: 'tc222' })

      await service.createTicketClass('ev123', 'Free Entry', 100, true)

      expect(mock.history[0].body).toEqual({
        ticket_class: {
          name: 'Free Entry',
          quantity_total: 100,
          free: true,
        },
      })
    })

    it('defaults free to false when not provided', async () => {
      mock.onPost(`${BASE}/events/ev123/ticket_classes/`).reply({ id: 'tc333' })

      await service.createTicketClass('ev123', 'General', 200, undefined, 'USD,2500')

      expect(mock.history[0].body.ticket_class).toMatchObject({ free: false, cost: 'USD,2500' })
    })
  })

  describe('updateTicketClass', () => {
    it('sends only provided fields', async () => {
      mock.onPost(`${BASE}/events/ev123/ticket_classes/tc111/`).reply({ id: 'tc111' })

      await service.updateTicketClass('ev123', 'tc111', 'New Name')

      expect(mock.history[0].body).toEqual({
        ticket_class: { name: 'New Name' },
      })
    })

    it('sends all fields when provided', async () => {
      mock.onPost(`${BASE}/events/ev123/ticket_classes/tc111/`).reply({ id: 'tc111' })

      await service.updateTicketClass('ev123', 'tc111', 'VIP', 75, false, 'USD,7500')

      expect(mock.history[0].body).toEqual({
        ticket_class: {
          name: 'VIP',
          quantity_total: 75,
          free: false,
          cost: 'USD,7500',
        },
      })
    })
  })

  describe('deleteTicketClass', () => {
    it('sends DELETE request', async () => {
      mock.onDelete(`${BASE}/events/ev123/ticket_classes/tc111/`).reply({ deleted: true })

      const result = await service.deleteTicketClass('ev123', 'tc111')

      expect(result).toEqual({ deleted: true })
      expect(mock.history[0].method).toBe('delete')
    })
  })

  // ── Venues ──

  describe('listVenues', () => {
    it('sends correct request', async () => {
      mock.onGet(`${BASE}/organizations/org123/venues/`).reply({ venues: [], pagination: {} })

      const result = await service.listVenues('org123')

      expect(result).toHaveProperty('venues')
    })

    it('passes continuation token', async () => {
      mock.onGet(`${BASE}/organizations/org123/venues/`).reply({ venues: [] })

      await service.listVenues('org123', 'tokenABC')

      expect(mock.history[0].query).toMatchObject({ continuation: 'tokenABC' })
    })
  })

  describe('createVenue', () => {
    it('sends correct body with required fields', async () => {
      mock.onPost(`${BASE}/organizations/org123/venues/`).reply({ id: 'ven555' })

      await service.createVenue('org123', 'Main Hall', '123 Market St')

      expect(mock.history[0].body).toEqual({
        venue: {
          name: 'Main Hall',
          address: { address_1: '123 Market St' },
        },
      })
    })

    it('includes all optional address fields', async () => {
      mock.onPost(`${BASE}/organizations/org123/venues/`).reply({ id: 'ven555' })

      await service.createVenue('org123', 'Main Hall', '123 Market St', 'Suite 100', 'San Francisco', 'CA', '94103', 'US')

      expect(mock.history[0].body.venue.address).toEqual({
        address_1: '123 Market St',
        address_2: 'Suite 100',
        city: 'San Francisco',
        region: 'CA',
        postal_code: '94103',
        country: 'US',
      })
    })
  })

  describe('getVenue', () => {
    it('sends correct request', async () => {
      mock.onGet(`${BASE}/venues/ven555/`).reply({ id: 'ven555', name: 'Main Hall' })

      const result = await service.getVenue('ven555')

      expect(result).toMatchObject({ id: 'ven555', name: 'Main Hall' })
    })
  })

  // ── Categories & User ──

  describe('listCategories', () => {
    it('sends correct request', async () => {
      mock.onGet(`${BASE}/categories/`).reply({ categories: [], pagination: {} })

      const result = await service.listCategories()

      expect(result).toHaveProperty('categories')
    })

    it('passes continuation token', async () => {
      mock.onGet(`${BASE}/categories/`).reply({ categories: [] })

      await service.listCategories('tokenCat')

      expect(mock.history[0].query).toMatchObject({ continuation: 'tokenCat' })
    })
  })

  describe('getUser', () => {
    it('sends correct request to /users/me/', async () => {
      mock.onGet(`${BASE}/users/me/`).reply({ id: '123', name: 'Ada' })

      const result = await service.getUser()

      expect(result).toMatchObject({ id: '123', name: 'Ada' })
      expect(mock.history[0].url).toBe(`${BASE}/users/me/`)
    })
  })

  // ── Dictionaries ──

  describe('getOrganizationsDictionary', () => {
    it('returns formatted items', async () => {
      mock.onGet(`${BASE}/users/me/organizations/`).reply({
        organizations: [{ id: 'org1', name: 'Acme Events' }],
        pagination: { has_more_items: false },
      })

      const result = await service.getOrganizationsDictionary({})

      expect(result.items).toEqual([
        { label: 'Acme Events', value: 'org1', note: 'Organization' },
      ])
      expect(result.cursor).toBeUndefined()
    })

    it('filters by search term', async () => {
      mock.onGet(`${BASE}/users/me/organizations/`).reply({
        organizations: [
          { id: 'org1', name: 'Acme Events' },
          { id: 'org2', name: 'Beta Corp' },
        ],
        pagination: { has_more_items: false },
      })

      const result = await service.getOrganizationsDictionary({ search: 'acme' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('org1')
    })

    it('returns cursor when has_more_items is true', async () => {
      mock.onGet(`${BASE}/users/me/organizations/`).reply({
        organizations: [],
        pagination: { has_more_items: true, continuation: 'next-page' },
      })

      const result = await service.getOrganizationsDictionary({})

      expect(result.cursor).toBe('next-page')
    })

    it('passes cursor as continuation query param', async () => {
      mock.onGet(`${BASE}/users/me/organizations/`).reply({
        organizations: [],
        pagination: { has_more_items: false },
      })

      await service.getOrganizationsDictionary({ cursor: 'page2' })

      expect(mock.history[0].query).toMatchObject({ continuation: 'page2' })
    })
  })

  describe('getEventsDictionary', () => {
    it('returns empty items when no organizationId in criteria', async () => {
      const result = await service.getEventsDictionary({ criteria: {} })

      expect(result).toEqual({ items: [] })
      expect(mock.history).toHaveLength(0)
    })

    it('returns formatted items with organization criteria', async () => {
      mock.onGet(`${BASE}/organizations/org1/events/`).reply({
        events: [{ id: 'ev1', name: { text: 'Launch Party' }, status: 'live' }],
        pagination: { has_more_items: false },
      })

      const result = await service.getEventsDictionary({
        criteria: { organizationId: 'org1' },
      })

      expect(result.items).toEqual([
        { label: 'Launch Party', value: 'ev1', note: 'live' },
      ])
    })

    it('passes name_filter from search and order_by start_desc', async () => {
      mock.onGet(`${BASE}/organizations/org1/events/`).reply({
        events: [],
        pagination: { has_more_items: false },
      })

      await service.getEventsDictionary({
        search: 'launch',
        criteria: { organizationId: 'org1' },
      })

      expect(mock.history[0].query).toMatchObject({
        name_filter: 'launch',
        order_by: 'start_desc',
      })
    })
  })

  describe('getCategoriesDictionary', () => {
    it('returns formatted items', async () => {
      mock.onGet(`${BASE}/categories/`).reply({
        categories: [{ id: '103', name: 'Music' }],
        pagination: { has_more_items: false },
      })

      const result = await service.getCategoriesDictionary({})

      expect(result.items).toEqual([
        { label: 'Music', value: '103', note: 'Category' },
      ])
    })

    it('filters by search term', async () => {
      mock.onGet(`${BASE}/categories/`).reply({
        categories: [
          { id: '103', name: 'Music' },
          { id: '101', name: 'Business' },
        ],
        pagination: { has_more_items: false },
      })

      const result = await service.getCategoriesDictionary({ search: 'bus' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('101')
    })
  })
})
