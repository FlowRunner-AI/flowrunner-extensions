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
      expect(sandbox.getConfigItems()).toEqual([
        expect.objectContaining({
          name: 'privateToken',
          displayName: 'Private Token',
          required: true,
          shared: false,
          type: 'STRING',
        }),
      ])
    })

    it('sends the Bearer auth and content-type headers on requests', async () => {
      mock.onGet(`${ BASE }/users/me/`).reply({ id: '1' })

      await service.getUser()

      expect(mock.history[0].headers).toMatchObject({
        'Authorization': `Bearer ${ PRIVATE_TOKEN }`,
        'Content-Type': 'application/json',
      })
    })
  })

  // ── Events ──

  describe('listEvents', () => {
    it('sends request with only the organization id and no query filters', async () => {
      mock.onGet(`${ BASE }/organizations/778899/events/`).reply({ events: [], pagination: {} })

      const result = await service.listEvents('778899')

      expect(result).toEqual({ events: [], pagination: {} })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/organizations/778899/events/`)
      expect(mock.history[0].query).toEqual({})
    })

    it('maps status, time filter, and order-by choices', async () => {
      mock.onGet(`${ BASE }/organizations/778899/events/`).reply({ events: [] })

      await service.listEvents('778899', 'Live', 'Current & Future', 'Start Descending', 'tok')

      expect(mock.history[0].query).toEqual({
        status: 'live',
        time_filter: 'current_future',
        order_by: 'start_desc',
        continuation: 'tok',
      })
    })

    it('passes through an unmapped status value verbatim', async () => {
      mock.onGet(`${ BASE }/organizations/778899/events/`).reply({ events: [] })

      await service.listEvents('778899', 'archived')

      expect(mock.history[0].query).toEqual({ status: 'archived' })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/organizations/778899/events/`).replyWithError({
        message: 'Unauthorized',
        body: { error: 'UNAUTHORIZED', error_description: 'Invalid auth token' },
      })

      await expect(service.listEvents('778899')).rejects.toThrow(
        'Eventbrite API error: Invalid auth token'
      )
    })
  })

  describe('getEvent', () => {
    it('sends request without expand when none provided', async () => {
      mock.onGet(`${ BASE }/events/1234567890/`).reply({ id: '1234567890' })

      const result = await service.getEvent('1234567890')

      expect(result).toEqual({ id: '1234567890' })
      expect(mock.history[0].query).toEqual({})
    })

    it('joins expand array into a comma-separated query param', async () => {
      mock.onGet(`${ BASE }/events/1234567890/`).reply({ id: '1234567890' })

      await service.getEvent('1234567890', ['venue', 'ticket_availability'])

      expect(mock.history[0].query).toEqual({ expand: 'venue,ticket_availability' })
    })

    it('ignores a non-array expand value', async () => {
      mock.onGet(`${ BASE }/events/1234567890/`).reply({ id: '1234567890' })

      await service.getEvent('1234567890', 'venue')

      expect(mock.history[0].query).toEqual({})
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/events/999/`).replyWithError({ message: 'Not found' })

      await expect(service.getEvent('999')).rejects.toThrow('Eventbrite API error: Not found')
    })
  })

  describe('createEvent', () => {
    it('builds the nested event body with required params and defaults online_event to false', async () => {
      mock.onPost(`${ BASE }/organizations/778899/events/`).reply({ id: 'new-event' })

      const result = await service.createEvent(
        '778899',
        'Launch Party',
        'America/New_York',
        '2026-09-01T22:00:00Z',
        '2026-09-02T01:00:00Z',
        'USD'
      )

      expect(result).toEqual({ id: 'new-event' })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/organizations/778899/events/`)
      expect(mock.history[0].body).toEqual({
        event: {
          name: { html: 'Launch Party' },
          start: { timezone: 'America/New_York', utc: '2026-09-01T22:00:00Z' },
          end: { timezone: 'America/New_York', utc: '2026-09-02T01:00:00Z' },
          currency: 'USD',
          online_event: false,
        },
      })
    })

    it('includes venue and category ids and honors online_event true', async () => {
      mock.onPost(`${ BASE }/organizations/778899/events/`).reply({ id: 'new-event' })

      await service.createEvent(
        '778899',
        'Online Summit',
        'America/New_York',
        '2026-09-01T22:00:00Z',
        '2026-09-02T01:00:00Z',
        'USD',
        true,
        '44445555',
        '103'
      )

      expect(mock.history[0].body).toEqual({
        event: {
          name: { html: 'Online Summit' },
          start: { timezone: 'America/New_York', utc: '2026-09-01T22:00:00Z' },
          end: { timezone: 'America/New_York', utc: '2026-09-02T01:00:00Z' },
          currency: 'USD',
          online_event: true,
          venue_id: '44445555',
          category_id: '103',
        },
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/organizations/778899/events/`).replyWithError({ message: 'Bad Request' })

      await expect(
        service.createEvent('778899', 'X', 'UTC', '2026-09-01T22:00:00Z', '2026-09-02T01:00:00Z', 'USD')
      ).rejects.toThrow('Eventbrite API error: Bad Request')
    })
  })

  describe('updateEvent', () => {
    it('sends an empty event object when no fields are provided', async () => {
      mock.onPost(`${ BASE }/events/1234567890/`).reply({ id: '1234567890' })

      const result = await service.updateEvent('1234567890')

      expect(result).toEqual({ id: '1234567890' })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({ event: {} })
    })

    it('includes only the provided fields with start/end wrapped in timezone', async () => {
      mock.onPost(`${ BASE }/events/1234567890/`).reply({ id: '1234567890' })

      await service.updateEvent(
        '1234567890',
        'Launch Party 2026',
        'America/New_York',
        '2026-10-01T22:00:00Z',
        '2026-10-02T01:00:00Z',
        'EUR',
        true
      )

      expect(mock.history[0].body).toEqual({
        event: {
          name: { html: 'Launch Party 2026' },
          start: { timezone: 'America/New_York', utc: '2026-10-01T22:00:00Z' },
          end: { timezone: 'America/New_York', utc: '2026-10-02T01:00:00Z' },
          currency: 'EUR',
          online_event: true,
        },
      })
    })

    it('updates the name alone without touching start/end', async () => {
      mock.onPost(`${ BASE }/events/1234567890/`).reply({ id: '1234567890' })

      await service.updateEvent('1234567890', 'Renamed')

      expect(mock.history[0].body).toEqual({ event: { name: { html: 'Renamed' } } })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/events/1234567890/`).replyWithError({ message: 'Conflict' })

      await expect(service.updateEvent('1234567890', 'X')).rejects.toThrow(
        'Eventbrite API error: Conflict'
      )
    })
  })

  describe('publishEvent', () => {
    it('posts to the publish endpoint with an empty body', async () => {
      mock.onPost(`${ BASE }/events/1234567890/publish/`).reply({ published: true })

      const result = await service.publishEvent('1234567890')

      expect(result).toEqual({ published: true })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({})
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/events/1234567890/publish/`).replyWithError({ message: 'Cannot publish' })

      await expect(service.publishEvent('1234567890')).rejects.toThrow(
        'Eventbrite API error: Cannot publish'
      )
    })
  })

  describe('unpublishEvent', () => {
    it('posts to the unpublish endpoint with an empty body', async () => {
      mock.onPost(`${ BASE }/events/1234567890/unpublish/`).reply({ unpublished: true })

      const result = await service.unpublishEvent('1234567890')

      expect(result).toEqual({ unpublished: true })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({})
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/events/1234567890/unpublish/`).replyWithError({ message: 'Has orders' })

      await expect(service.unpublishEvent('1234567890')).rejects.toThrow(
        'Eventbrite API error: Has orders'
      )
    })
  })

  describe('cancelEvent', () => {
    it('posts to the cancel endpoint with an empty body', async () => {
      mock.onPost(`${ BASE }/events/1234567890/cancel/`).reply({ canceled: true })

      const result = await service.cancelEvent('1234567890')

      expect(result).toEqual({ canceled: true })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({})
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/events/1234567890/cancel/`).replyWithError({ message: 'Cannot cancel' })

      await expect(service.cancelEvent('1234567890')).rejects.toThrow(
        'Eventbrite API error: Cannot cancel'
      )
    })
  })

  // ── Attendees ──

  describe('listAttendees', () => {
    it('sends request with no query filters when only the event id is given', async () => {
      mock.onGet(`${ BASE }/events/1234567890/attendees/`).reply({ attendees: [] })

      const result = await service.listAttendees('1234567890')

      expect(result).toEqual({ attendees: [] })
      expect(mock.history[0].url).toBe(`${ BASE }/events/1234567890/attendees/`)
      expect(mock.history[0].query).toEqual({})
    })

    it('maps the attendee status choice and includes the continuation token', async () => {
      mock.onGet(`${ BASE }/events/1234567890/attendees/`).reply({ attendees: [] })

      await service.listAttendees('1234567890', 'Not Attending', 'tok')

      expect(mock.history[0].query).toEqual({ status: 'not_attending', continuation: 'tok' })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/events/1234567890/attendees/`).replyWithError({ message: 'Boom' })

      await expect(service.listAttendees('1234567890')).rejects.toThrow(
        'Eventbrite API error: Boom'
      )
    })
  })

  describe('getAttendee', () => {
    it('fetches a single attendee by id', async () => {
      mock.onGet(`${ BASE }/events/1234567890/attendees/9876543210/`).reply({ id: '9876543210' })

      const result = await service.getAttendee('1234567890', '9876543210')

      expect(result).toEqual({ id: '9876543210' })
      expect(mock.history[0].url).toBe(`${ BASE }/events/1234567890/attendees/9876543210/`)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/events/1234567890/attendees/9876543210/`).replyWithError({ message: 'Boom' })

      await expect(service.getAttendee('1234567890', '9876543210')).rejects.toThrow(
        'Eventbrite API error: Boom'
      )
    })
  })

  // ── Orders ──

  describe('listOrders', () => {
    it('lists orders for an event when an event id is provided', async () => {
      mock.onGet(`${ BASE }/events/1234567890/orders/`).reply({ orders: [] })

      const result = await service.listOrders('1234567890')

      expect(result).toEqual({ orders: [] })
      expect(mock.history[0].url).toBe(`${ BASE }/events/1234567890/orders/`)
      expect(mock.history[0].query).toEqual({})
    })

    it('lists orders for an organization when only an org id is provided', async () => {
      mock.onGet(`${ BASE }/organizations/778899/orders/`).reply({ orders: [] })

      await service.listOrders(undefined, '778899', 'Refunded', 'tok')

      expect(mock.history[0].url).toBe(`${ BASE }/organizations/778899/orders/`)
      expect(mock.history[0].query).toEqual({ status: 'refunded', continuation: 'tok' })
    })

    it('prefers the event id over the org id when both are provided', async () => {
      mock.onGet(`${ BASE }/events/1234567890/orders/`).reply({ orders: [] })

      await service.listOrders('1234567890', '778899')

      expect(mock.history[0].url).toBe(`${ BASE }/events/1234567890/orders/`)
    })

    it('throws before making a request when neither id is provided', async () => {
      await expect(service.listOrders()).rejects.toThrow(
        'Eventbrite API error: provide either an event ID or an organization ID to list orders.'
      )
      expect(mock.history).toHaveLength(0)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/events/1234567890/orders/`).replyWithError({ message: 'Boom' })

      await expect(service.listOrders('1234567890')).rejects.toThrow('Eventbrite API error: Boom')
    })
  })

  describe('getOrder', () => {
    it('fetches an order without expand when none provided', async () => {
      mock.onGet(`${ BASE }/orders/555555555/`).reply({ id: '555555555' })

      const result = await service.getOrder('555555555')

      expect(result).toEqual({ id: '555555555' })
      expect(mock.history[0].query).toEqual({})
    })

    it('joins expand array into a comma-separated query param', async () => {
      mock.onGet(`${ BASE }/orders/555555555/`).reply({ id: '555555555' })

      await service.getOrder('555555555', ['attendees', 'event'])

      expect(mock.history[0].query).toEqual({ expand: 'attendees,event' })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/orders/555555555/`).replyWithError({ message: 'Boom' })

      await expect(service.getOrder('555555555')).rejects.toThrow('Eventbrite API error: Boom')
    })
  })

  // ── Ticket Classes ──

  describe('listTicketClasses', () => {
    it('lists ticket classes with no continuation by default', async () => {
      mock.onGet(`${ BASE }/events/1234567890/ticket_classes/`).reply({ ticket_classes: [] })

      const result = await service.listTicketClasses('1234567890')

      expect(result).toEqual({ ticket_classes: [] })
      expect(mock.history[0].query).toEqual({})
    })

    it('includes the continuation token when provided', async () => {
      mock.onGet(`${ BASE }/events/1234567890/ticket_classes/`).reply({ ticket_classes: [] })

      await service.listTicketClasses('1234567890', 'tok')

      expect(mock.history[0].query).toEqual({ continuation: 'tok' })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/events/1234567890/ticket_classes/`).replyWithError({ message: 'Boom' })

      await expect(service.listTicketClasses('1234567890')).rejects.toThrow(
        'Eventbrite API error: Boom'
      )
    })
  })

  describe('createTicketClass', () => {
    it('creates a paid ticket class including the cost', async () => {
      mock.onPost(`${ BASE }/events/1234567890/ticket_classes/`).reply({ id: '111222333' })

      const result = await service.createTicketClass('1234567890', 'General Admission', 100, false, 'USD,2500')

      expect(result).toEqual({ id: '111222333' })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({
        ticket_class: {
          name: 'General Admission',
          quantity_total: 100,
          free: false,
          cost: 'USD,2500',
        },
      })
    })

    it('defaults free to false when the flag is omitted', async () => {
      mock.onPost(`${ BASE }/events/1234567890/ticket_classes/`).reply({ id: '111222333' })

      await service.createTicketClass('1234567890', 'General Admission', 100, undefined, 'USD,2500')

      expect(mock.history[0].body).toEqual({
        ticket_class: {
          name: 'General Admission',
          quantity_total: 100,
          free: false,
          cost: 'USD,2500',
        },
      })
    })

    it('omits the cost for a free ticket class', async () => {
      mock.onPost(`${ BASE }/events/1234567890/ticket_classes/`).reply({ id: '111222334' })

      await service.createTicketClass('1234567890', 'Free RSVP', 50, true, 'USD,2500')

      expect(mock.history[0].body).toEqual({
        ticket_class: {
          name: 'Free RSVP',
          quantity_total: 50,
          free: true,
        },
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/events/1234567890/ticket_classes/`).replyWithError({ message: 'Boom' })

      await expect(
        service.createTicketClass('1234567890', 'GA', 100, false, 'USD,2500')
      ).rejects.toThrow('Eventbrite API error: Boom')
    })
  })

  describe('updateTicketClass', () => {
    it('sends an empty ticket_class object when no fields are provided', async () => {
      mock.onPost(`${ BASE }/events/1234567890/ticket_classes/111222333/`).reply({ id: '111222333' })

      const result = await service.updateTicketClass('1234567890', '111222333')

      expect(result).toEqual({ id: '111222333' })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({ ticket_class: {} })
    })

    it('includes only the provided fields', async () => {
      mock.onPost(`${ BASE }/events/1234567890/ticket_classes/111222333/`).reply({ id: '111222333' })

      await service.updateTicketClass('1234567890', '111222333', 'VIP', 50, false, 'USD,5000')

      expect(mock.history[0].body).toEqual({
        ticket_class: {
          name: 'VIP',
          quantity_total: 50,
          free: false,
          cost: 'USD,5000',
        },
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/events/1234567890/ticket_classes/111222333/`).replyWithError({ message: 'Boom' })

      await expect(
        service.updateTicketClass('1234567890', '111222333', 'VIP')
      ).rejects.toThrow('Eventbrite API error: Boom')
    })
  })

  describe('deleteTicketClass', () => {
    it('sends a delete request to the ticket class endpoint', async () => {
      mock.onDelete(`${ BASE }/events/1234567890/ticket_classes/111222333/`).reply({ deleted: true })

      const result = await service.deleteTicketClass('1234567890', '111222333')

      expect(result).toEqual({ deleted: true })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${ BASE }/events/1234567890/ticket_classes/111222333/`)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onDelete(`${ BASE }/events/1234567890/ticket_classes/111222333/`).replyWithError({ message: 'Boom' })

      await expect(
        service.deleteTicketClass('1234567890', '111222333')
      ).rejects.toThrow('Eventbrite API error: Boom')
    })
  })

  // ── Venues ──

  describe('listVenues', () => {
    it('lists venues with no continuation by default', async () => {
      mock.onGet(`${ BASE }/organizations/778899/venues/`).reply({ venues: [] })

      const result = await service.listVenues('778899')

      expect(result).toEqual({ venues: [] })
      expect(mock.history[0].query).toEqual({})
    })

    it('includes the continuation token when provided', async () => {
      mock.onGet(`${ BASE }/organizations/778899/venues/`).reply({ venues: [] })

      await service.listVenues('778899', 'tok')

      expect(mock.history[0].query).toEqual({ continuation: 'tok' })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/organizations/778899/venues/`).replyWithError({ message: 'Boom' })

      await expect(service.listVenues('778899')).rejects.toThrow('Eventbrite API error: Boom')
    })
  })

  describe('createVenue', () => {
    it('creates a venue with required params only, dropping empty address fields', async () => {
      mock.onPost(`${ BASE }/organizations/778899/venues/`).reply({ id: '44445555' })

      const result = await service.createVenue('778899', 'Main Hall', '123 Market St')

      expect(result).toEqual({ id: '44445555' })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({
        venue: {
          name: 'Main Hall',
          address: { address_1: '123 Market St' },
        },
      })
    })

    it('includes all address fields when provided', async () => {
      mock.onPost(`${ BASE }/organizations/778899/venues/`).reply({ id: '44445555' })

      await service.createVenue(
        '778899',
        'Main Hall',
        '123 Market St',
        'Suite 5',
        'San Francisco',
        'CA',
        '94103',
        'US'
      )

      expect(mock.history[0].body).toEqual({
        venue: {
          name: 'Main Hall',
          address: {
            address_1: '123 Market St',
            address_2: 'Suite 5',
            city: 'San Francisco',
            region: 'CA',
            postal_code: '94103',
            country: 'US',
          },
        },
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/organizations/778899/venues/`).replyWithError({ message: 'Boom' })

      await expect(
        service.createVenue('778899', 'Main Hall', '123 Market St')
      ).rejects.toThrow('Eventbrite API error: Boom')
    })
  })

  describe('getVenue', () => {
    it('fetches a venue by id', async () => {
      mock.onGet(`${ BASE }/venues/44445555/`).reply({ id: '44445555' })

      const result = await service.getVenue('44445555')

      expect(result).toEqual({ id: '44445555' })
      expect(mock.history[0].url).toBe(`${ BASE }/venues/44445555/`)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/venues/44445555/`).replyWithError({ message: 'Boom' })

      await expect(service.getVenue('44445555')).rejects.toThrow('Eventbrite API error: Boom')
    })
  })

  // ── Categories & Me ──

  describe('listCategories', () => {
    it('lists categories with no continuation by default', async () => {
      mock.onGet(`${ BASE }/categories/`).reply({ categories: [] })

      const result = await service.listCategories()

      expect(result).toEqual({ categories: [] })
      expect(mock.history[0].query).toEqual({})
    })

    it('includes the continuation token when provided', async () => {
      mock.onGet(`${ BASE }/categories/`).reply({ categories: [] })

      await service.listCategories('tok')

      expect(mock.history[0].query).toEqual({ continuation: 'tok' })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/categories/`).replyWithError({ message: 'Boom' })

      await expect(service.listCategories()).rejects.toThrow('Eventbrite API error: Boom')
    })
  })

  describe('getUser', () => {
    it('fetches the current user profile', async () => {
      mock.onGet(`${ BASE }/users/me/`).reply({ id: '223344556677', name: 'Ada Lovelace' })

      const result = await service.getUser()

      expect(result).toEqual({ id: '223344556677', name: 'Ada Lovelace' })
      expect(mock.history[0].url).toBe(`${ BASE }/users/me/`)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ BASE }/users/me/`).replyWithError({ message: 'Boom' })

      await expect(service.getUser()).rejects.toThrow('Eventbrite API error: Boom')
    })
  })

  // ── Error handling detail ──

  describe('error message resolution', () => {
    it('prefers error_description, then error, then message from the error body', async () => {
      mock.onGet(`${ BASE }/users/me/`).replyWithError({
        message: 'Request failed',
        body: { error: 'NOT_AUTHORIZED', error_description: 'Your token is invalid' },
      })

      await expect(service.getUser()).rejects.toThrow('Eventbrite API error: Your token is invalid')
    })

    it('falls back to body.error when there is no error_description', async () => {
      mock.onGet(`${ BASE }/users/me/`).replyWithError({
        message: 'Request failed',
        body: { error: 'NOT_FOUND' },
      })

      await expect(service.getUser()).rejects.toThrow('Eventbrite API error: NOT_FOUND')
    })

    it('falls back to error.message when there is no body', async () => {
      mock.onGet(`${ BASE }/users/me/`).replyWithError({ message: 'Network down' })

      await expect(service.getUser()).rejects.toThrow('Eventbrite API error: Network down')
    })
  })

  // ── Dictionaries ──

  describe('getOrganizationsDictionary', () => {
    const orgsResponse = {
      organizations: [
        { id: '778899', name: 'Acme Events' },
        { id: '112233', name: 'Beta Org' },
      ],
      pagination: { has_more_items: false },
    }

    it('maps organizations to items and hits the organizations endpoint', async () => {
      mock.onGet(`${ BASE }/users/me/organizations/`).reply(orgsResponse)

      const result = await service.getOrganizationsDictionary({})

      expect(mock.history[0].url).toBe(`${ BASE }/users/me/organizations/`)
      expect(result.items).toEqual([
        { label: 'Acme Events', value: '778899', note: 'Organization' },
        { label: 'Beta Org', value: '112233', note: 'Organization' },
      ])
      expect(result.cursor).toBeUndefined()
    })

    it('filters organizations by search term', async () => {
      mock.onGet(`${ BASE }/users/me/organizations/`).reply(orgsResponse)

      const result = await service.getOrganizationsDictionary({ search: 'beta' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('112233')
    })

    it('passes the cursor as a continuation and returns a next cursor when more items exist', async () => {
      mock.onGet(`${ BASE }/users/me/organizations/`).reply({
        organizations: [{ id: '778899', name: 'Acme Events' }],
        pagination: { has_more_items: true, continuation: 'next-tok' },
      })

      const result = await service.getOrganizationsDictionary({ cursor: 'cur-tok' })

      expect(mock.history[0].query).toEqual({ continuation: 'cur-tok' })
      expect(result.cursor).toBe('next-tok')
    })

    it('handles a null payload', async () => {
      mock.onGet(`${ BASE }/users/me/organizations/`).reply({ organizations: [] })

      const result = await service.getOrganizationsDictionary(null)

      expect(result.items).toEqual([])
    })

    it('falls back to the id as the label when name is missing', async () => {
      mock.onGet(`${ BASE }/users/me/organizations/`).reply({
        organizations: [{ id: '778899' }],
      })

      const result = await service.getOrganizationsDictionary({})

      expect(result.items[0]).toEqual({ label: '778899', value: '778899', note: 'Organization' })
    })
  })

  describe('getEventsDictionary', () => {
    it('returns empty items without hitting the API when no organization is selected', async () => {
      const result = await service.getEventsDictionary({})

      expect(result).toEqual({ items: [] })
      expect(mock.history).toHaveLength(0)
    })

    it('maps events to items for the selected organization', async () => {
      mock.onGet(`${ BASE }/organizations/778899/events/`).reply({
        events: [
          { id: '1234567890', name: { text: 'Launch Party' }, status: 'live' },
          { id: '1234567891', name: { text: 'Webinar' }, status: 'draft' },
        ],
        pagination: { has_more_items: false },
      })

      const result = await service.getEventsDictionary({ criteria: { organizationId: '778899' } })

      expect(mock.history[0].url).toBe(`${ BASE }/organizations/778899/events/`)
      expect(mock.history[0].query).toEqual({ order_by: 'start_desc' })
      expect(result.items).toEqual([
        { label: 'Launch Party', value: '1234567890', note: 'live' },
        { label: 'Webinar', value: '1234567891', note: 'draft' },
      ])
    })

    it('passes search as a name filter and cursor as continuation, returning a next cursor', async () => {
      mock.onGet(`${ BASE }/organizations/778899/events/`).reply({
        events: [{ id: '1234567890', name: { text: 'Launch Party' }, status: 'live' }],
        pagination: { has_more_items: true, continuation: 'next-tok' },
      })

      const result = await service.getEventsDictionary({
        search: 'launch',
        cursor: 'cur-tok',
        criteria: { organizationId: '778899' },
      })

      expect(mock.history[0].query).toEqual({
        continuation: 'cur-tok',
        name_filter: 'launch',
        order_by: 'start_desc',
      })
      expect(result.cursor).toBe('next-tok')
    })

    it('falls back to the id as the label when the event name is missing', async () => {
      mock.onGet(`${ BASE }/organizations/778899/events/`).reply({
        events: [{ id: '1234567890', status: 'live' }],
      })

      const result = await service.getEventsDictionary({ criteria: { organizationId: '778899' } })

      expect(result.items[0]).toEqual({ label: '1234567890', value: '1234567890', note: 'live' })
    })

    it('returns empty items for a null payload', async () => {
      const result = await service.getEventsDictionary(null)

      expect(result).toEqual({ items: [] })
    })
  })

  describe('getCategoriesDictionary', () => {
    const categoriesResponse = {
      categories: [
        { id: '103', name: 'Music' },
        { id: '101', name: 'Business & Professional' },
      ],
      pagination: { has_more_items: false },
    }

    it('maps categories to items and hits the categories endpoint', async () => {
      mock.onGet(`${ BASE }/categories/`).reply(categoriesResponse)

      const result = await service.getCategoriesDictionary({})

      expect(mock.history[0].url).toBe(`${ BASE }/categories/`)
      expect(result.items).toEqual([
        { label: 'Music', value: '103', note: 'Category' },
        { label: 'Business & Professional', value: '101', note: 'Category' },
      ])
    })

    it('filters categories by search term', async () => {
      mock.onGet(`${ BASE }/categories/`).reply(categoriesResponse)

      const result = await service.getCategoriesDictionary({ search: 'music' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('103')
    })

    it('passes the cursor as continuation and returns a next cursor when more items exist', async () => {
      mock.onGet(`${ BASE }/categories/`).reply({
        categories: [{ id: '103', name: 'Music' }],
        pagination: { has_more_items: true, continuation: 'next-tok' },
      })

      const result = await service.getCategoriesDictionary({ cursor: 'cur-tok' })

      expect(mock.history[0].query).toEqual({ continuation: 'cur-tok' })
      expect(result.cursor).toBe('next-tok')
    })

    it('handles a null payload', async () => {
      mock.onGet(`${ BASE }/categories/`).reply({ categories: [] })

      const result = await service.getCategoriesDictionary(null)

      expect(result.items).toEqual([])
    })
  })
})
