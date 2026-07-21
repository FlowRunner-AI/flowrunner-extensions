'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-api-key'
const API_SECRET = 'test-api-secret'
const BASE = 'https://my.demio.com/api/v1'

const AUTH_HEADERS = {
  'Api-Key': API_KEY,
  'Api-Secret': API_SECRET,
  'Content-Type': 'application/json',
}

describe('Demio Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ apiKey: API_KEY, apiSecret: API_SECRET })
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
          type: 'STRING',
          required: true,
          shared: false,
        }),
        expect.objectContaining({
          name: 'apiSecret',
          displayName: 'API Secret',
          type: 'STRING',
          required: true,
          shared: false,
        }),
      ])
    })

    it('registers exactly two config items', () => {
      expect(sandbox.getConfigItems()).toHaveLength(2)
    })
  })

  // ── Events ──

  describe('listEvents', () => {
    it('defaults to upcoming and sends auth headers', async () => {
      mock.onGet(`${ BASE }/events`).reply([{ id: 1, name: 'Webinar' }])

      const result = await service.listEvents()

      expect(result).toEqual([{ id: 1, name: 'Webinar' }])
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/events`)
      expect(mock.history[0].headers).toMatchObject(AUTH_HEADERS)
      expect(mock.history[0].query).toEqual({ type: 'upcoming' })
    })

    it('maps the Past label to the past API value', async () => {
      mock.onGet(`${ BASE }/events`).reply([])

      await service.listEvents('Past')

      expect(mock.history[0].query).toEqual({ type: 'past' })
    })

    it('maps the Automated label to the automated API value', async () => {
      mock.onGet(`${ BASE }/events`).reply([])

      await service.listEvents('Automated')

      expect(mock.history[0].query).toEqual({ type: 'automated' })
    })

    it('maps the Upcoming label to the upcoming API value', async () => {
      mock.onGet(`${ BASE }/events`).reply([])

      await service.listEvents('Upcoming')

      expect(mock.history[0].query).toEqual({ type: 'upcoming' })
    })

    it('passes through an already-mapped/unknown value unchanged', async () => {
      mock.onGet(`${ BASE }/events`).reply([])

      await service.listEvents('past')

      expect(mock.history[0].query).toEqual({ type: 'past' })
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/events`).replyWithError({
        message: 'Unauthorized',
        status: 401,
        body: { message: 'Invalid credentials' },
      })

      await expect(service.listEvents()).rejects.toThrow(
        'Demio API error: Invalid credentials (status 401)'
      )
    })
  })

  describe('getEvent', () => {
    it('sends request with encoded id and no active flag by default', async () => {
      mock.onGet(`${ BASE }/event/123456`).reply({ id: 123456, name: 'Webinar' })

      const result = await service.getEvent(123456)

      expect(result).toEqual({ id: 123456, name: 'Webinar' })
      expect(mock.history[0].url).toBe(`${ BASE }/event/123456`)
      expect(mock.history[0].headers).toMatchObject(AUTH_HEADERS)
      // active is undefined -> cleaned out of the query
      expect(mock.history[0].query).toEqual({})
    })

    it('includes active=true when activeOnly is true', async () => {
      mock.onGet(`${ BASE }/event/123456`).reply({ id: 123456 })

      await service.getEvent(123456, true)

      expect(mock.history[0].query).toEqual({ active: 'true' })
    })

    it('omits active when activeOnly is false', async () => {
      mock.onGet(`${ BASE }/event/123456`).reply({ id: 123456 })

      await service.getEvent(123456, false)

      expect(mock.history[0].query).toEqual({})
    })

    it('url-encodes the event id', async () => {
      mock.onGet(`${ BASE }/event/a%20b`).reply({ id: 'a b' })

      await service.getEvent('a b')

      expect(mock.history[0].url).toBe(`${ BASE }/event/a%20b`)
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/event/999`).replyWithError({
        message: 'Not Found',
        status: 404,
        body: { message: 'Event not found' },
      })

      await expect(service.getEvent(999)).rejects.toThrow(
        'Demio API error: Event not found (status 404)'
      )
    })
  })

  describe('getEventSession', () => {
    it('sends request with encoded id and dateId', async () => {
      mock.onGet(`${ BASE }/event/123/date/789`).reply({ date_id: 789, status: 'upcoming' })

      const result = await service.getEventSession(123, 789)

      expect(result).toEqual({ date_id: 789, status: 'upcoming' })
      expect(mock.history[0].url).toBe(`${ BASE }/event/123/date/789`)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].headers).toMatchObject(AUTH_HEADERS)
      // no query params configured for this method
      expect(mock.history[0].query).toEqual({})
    })

    it('url-encodes both id and dateId', async () => {
      mock.onGet(`${ BASE }/event/a%2Fb/date/c%2Fd`).reply({})

      await service.getEventSession('a/b', 'c/d')

      expect(mock.history[0].url).toBe(`${ BASE }/event/a%2Fb/date/c%2Fd`)
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/event/1/date/2`).replyWithError({
        message: 'Bad Request',
        body: { message: 'Invalid date' },
      })

      await expect(service.getEventSession(1, 2)).rejects.toThrow(
        'Demio API error: Invalid date'
      )
    })
  })

  // ── Registration ──

  describe('registerParticipant', () => {
    it('sends PUT with only required fields present', async () => {
      mock.onPut(`${ BASE }/event/register`).reply({ id: 345678 })

      const result = await service.registerParticipant('Jane', 'jane@example.com')

      expect(result).toEqual({ id: 345678 })
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].url).toBe(`${ BASE }/event/register`)
      expect(mock.history[0].headers).toMatchObject(AUTH_HEADERS)
      // clean() strips undefined optionals
      expect(mock.history[0].body).toEqual({
        name: 'Jane',
        email: 'jane@example.com',
      })
    })

    it('includes all optional fields when provided', async () => {
      mock.onPut(`${ BASE }/event/register`).reply({ id: 1 })

      await service.registerParticipant(
        'Jane',
        'jane@example.com',
        123456,
        789012,
        'https://my.demio.com/ref/abc',
        'Doe',
        'Acme',
        'https://acme.example',
        '+15550001111',
        true,
        { custom_field_role: 'Manager' }
      )

      expect(mock.history[0].body).toEqual({
        id: 123456,
        date_id: 789012,
        ref_url: 'https://my.demio.com/ref/abc',
        name: 'Jane',
        email: 'jane@example.com',
        last_name: 'Doe',
        company: 'Acme',
        website: 'https://acme.example',
        phone_number: '+15550001111',
        gdpr: 'true',
        custom_field_role: 'Manager',
      })
    })

    it('omits gdpr when not true', async () => {
      mock.onPut(`${ BASE }/event/register`).reply({ id: 2 })

      await service.registerParticipant('Jane', 'jane@example.com', undefined, undefined, undefined, undefined, undefined, undefined, undefined, false)

      expect(mock.history[0].body).toEqual({
        name: 'Jane',
        email: 'jane@example.com',
      })
    })

    it('merges custom fields into the body', async () => {
      mock.onPut(`${ BASE }/event/register`).reply({ id: 3 })

      await service.registerParticipant(
        'Jane',
        'jane@example.com',
        123456,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { source: 'campaign-x', tier: 'gold' }
      )

      expect(mock.history[0].body).toEqual({
        id: 123456,
        name: 'Jane',
        email: 'jane@example.com',
        source: 'campaign-x',
        tier: 'gold',
      })
    })

    it('ignores a non-object customFields value', async () => {
      mock.onPut(`${ BASE }/event/register`).reply({ id: 4 })

      await service.registerParticipant(
        'Jane',
        'jane@example.com',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        'not-an-object'
      )

      expect(mock.history[0].body).toEqual({
        name: 'Jane',
        email: 'jane@example.com',
      })
    })

    it('throws on API error, formatting an errors object', async () => {
      mock.onPut(`${ BASE }/event/register`).replyWithError({
        message: 'Unprocessable Entity',
        status: 422,
        body: { errors: { email: ['is invalid'] } },
      })

      await expect(
        service.registerParticipant('Jane', 'bad-email')
      ).rejects.toThrow('Demio API error: {"email":["is invalid"]} (status 422)')
    })

    it('formats a string errors field from the error body', async () => {
      mock.onPut(`${ BASE }/event/register`).replyWithError({
        message: 'Bad Request',
        body: { errors: 'Something went wrong' },
      })

      await expect(
        service.registerParticipant('Jane', 'jane@example.com')
      ).rejects.toThrow('Demio API error: Something went wrong')
    })

    it('falls back to error.message when body has no message or errors', async () => {
      mock.onPut(`${ BASE }/event/register`).replyWithError({
        message: 'Network timeout',
        body: {},
      })

      await expect(
        service.registerParticipant('Jane', 'jane@example.com')
      ).rejects.toThrow('Demio API error: Network timeout')
    })
  })

  // ── Participants ──

  describe('listSessionParticipants', () => {
    it('sends request without status filter by default', async () => {
      mock.onGet(`${ BASE }/report/789/participants`).reply({ participants: [] })

      const result = await service.listSessionParticipants(789)

      expect(result).toEqual({ participants: [] })
      expect(mock.history[0].url).toBe(`${ BASE }/report/789/participants`)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].headers).toMatchObject(AUTH_HEADERS)
      // status undefined -> cleaned out
      expect(mock.history[0].query).toEqual({})
    })

    it('maps the Attended status label', async () => {
      mock.onGet(`${ BASE }/report/789/participants`).reply({ participants: [] })

      await service.listSessionParticipants(789, 'Attended')

      expect(mock.history[0].query).toEqual({ status: 'attended' })
    })

    it('maps the Did Not Attend status label', async () => {
      mock.onGet(`${ BASE }/report/789/participants`).reply({ participants: [] })

      await service.listSessionParticipants(789, 'Did Not Attend')

      expect(mock.history[0].query).toEqual({ status: 'did not attend' })
    })

    it('maps the Left Early status label', async () => {
      mock.onGet(`${ BASE }/report/789/participants`).reply({ participants: [] })

      await service.listSessionParticipants(789, 'Left Early')

      expect(mock.history[0].query).toEqual({ status: 'left early' })
    })

    it('maps the Banned status label', async () => {
      mock.onGet(`${ BASE }/report/789/participants`).reply({ participants: [] })

      await service.listSessionParticipants(789, 'Banned')

      expect(mock.history[0].query).toEqual({ status: 'banned' })
    })

    it('passes through an unknown status value unchanged', async () => {
      mock.onGet(`${ BASE }/report/789/participants`).reply({ participants: [] })

      await service.listSessionParticipants(789, 'completed')

      expect(mock.history[0].query).toEqual({ status: 'completed' })
    })

    it('url-encodes the dateId', async () => {
      mock.onGet(`${ BASE }/report/a%2Fb/participants`).reply({ participants: [] })

      await service.listSessionParticipants('a/b')

      expect(mock.history[0].url).toBe(`${ BASE }/report/a%2Fb/participants`)
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/report/1/participants`).replyWithError({
        message: 'Forbidden',
        status: 403,
        body: { message: 'Access denied' },
      })

      await expect(service.listSessionParticipants(1)).rejects.toThrow(
        'Demio API error: Access denied (status 403)'
      )
    })
  })

  // ── Dictionary ──

  describe('getEventsDictionary', () => {
    const eventsResponse = [
      {
        id: 123456,
        name: 'Product Onboarding Webinar',
        dates: [{ date_id: 789012, datetime: '2026-08-01 15:00:00' }],
      },
      {
        id: 654321,
        name: 'Advanced Features Deep Dive',
        dates: [{ date_id: 111222, datetime: '2026-09-10 10:00:00' }],
      },
    ]

    it('always queries upcoming events and sends auth headers', async () => {
      mock.onGet(`${ BASE }/events`).reply(eventsResponse)

      await service.getEventsDictionary({})

      expect(mock.history[0].url).toBe(`${ BASE }/events`)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].headers).toMatchObject(AUTH_HEADERS)
      expect(mock.history[0].query).toEqual({ type: 'upcoming' })
    })

    it('maps events to dictionary items with cursor null', async () => {
      mock.onGet(`${ BASE }/events`).reply(eventsResponse)

      const result = await service.getEventsDictionary({})

      expect(result.cursor).toBeNull()
      expect(result.items).toEqual([
        { label: 'Product Onboarding Webinar', value: '123456', note: '2026-08-01 15:00:00' },
        { label: 'Advanced Features Deep Dive', value: '654321', note: '2026-09-10 10:00:00' },
      ])
    })

    it('filters items by search term (case-insensitive)', async () => {
      mock.onGet(`${ BASE }/events`).reply(eventsResponse)

      const result = await service.getEventsDictionary({ search: 'onboarding' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toMatchObject({ value: '123456' })
    })

    it('returns no items when the search matches nothing', async () => {
      mock.onGet(`${ BASE }/events`).reply(eventsResponse)

      const result = await service.getEventsDictionary({ search: 'no-such-event' })

      expect(result.items).toHaveLength(0)
    })

    it('handles a null payload', async () => {
      mock.onGet(`${ BASE }/events`).reply(eventsResponse)

      const result = await service.getEventsDictionary(null)

      expect(result.items).toHaveLength(2)
      expect(result.cursor).toBeNull()
    })

    it('reads events from an { events: [...] } wrapper object', async () => {
      mock.onGet(`${ BASE }/events`).reply({ events: eventsResponse })

      const result = await service.getEventsDictionary({})

      expect(result.items).toHaveLength(2)
    })

    it('falls back to a generated label when the event has no name', async () => {
      mock.onGet(`${ BASE }/events`).reply([{ id: 999, dates: [] }])

      const result = await service.getEventsDictionary({})

      expect(result.items[0]).toMatchObject({ label: 'Event 999', value: '999' })
    })

    it('uses date field when datetime is absent, and undefined note when no dates', async () => {
      mock.onGet(`${ BASE }/events`).reply([
        { id: 1, name: 'With date field', dates: [{ date_id: 5, date: '2026-10-01' }] },
        { id: 2, name: 'No dates', dates: [] },
      ])

      const result = await service.getEventsDictionary({})

      expect(result.items[0]).toMatchObject({ note: '2026-10-01' })
      expect(result.items[1].note).toBeUndefined()
    })

    it('handles a response that is neither array nor { events }', async () => {
      mock.onGet(`${ BASE }/events`).reply({ unexpected: true })

      const result = await service.getEventsDictionary({})

      expect(result.items).toEqual([])
      expect(result.cursor).toBeNull()
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/events`).replyWithError({
        message: 'Server Error',
        status: 500,
        body: { message: 'Internal error' },
      })

      await expect(service.getEventsDictionary({})).rejects.toThrow(
        'Demio API error: Internal error (status 500)'
      )
    })
  })
})
