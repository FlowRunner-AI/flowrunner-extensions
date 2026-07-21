'use strict'

const { createSandbox } = require('../../../service-sandbox')

const CLIENT_ID = 'test-client-id'
const CLIENT_SECRET = 'test-client-secret'
const ACCESS_TOKEN = 'test-access-token'

const API_BASE = 'https://www.googleapis.com/calendar/v3'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const USER_INFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo'
const OAUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'

describe('Google Calendar Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET })
    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()

    // Simulate the OAuth access token header
    service.request = { headers: { 'oauth-access-token': ACCESS_TOKEN } }
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
          expect.objectContaining({ name: 'clientId', required: true, shared: true }),
          expect.objectContaining({ name: 'clientSecret', required: true, shared: true }),
        ])
      )
    })
  })

  // ── OAuth Methods ──

  describe('getOAuth2ConnectionURL', () => {
    it('returns a properly formatted OAuth URL', async () => {
      const url = await service.getOAuth2ConnectionURL()

      expect(url).toContain(OAUTH_URL)
      expect(url).toContain(`client_id=${CLIENT_ID}`)
      expect(url).toContain('response_type=code')
      expect(url).toContain('access_type=offline')
      expect(url).toContain('prompt=consent')
      expect(url).toContain('scope=')
    })
  })

  describe('refreshToken', () => {
    it('sends correct request and returns token data', async () => {
      mock.onPost(TOKEN_URL).reply({
        access_token: 'new-access-token',
        expires_in: 3600,
      })

      const result = await service.refreshToken('test-refresh-token')

      expect(result).toEqual({
        token: 'new-access-token',
        expirationInSeconds: 3600,
      })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({
        'Content-Type': 'application/x-www-form-urlencoded',
      })
      expect(mock.history[0].query).toMatchObject({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: 'refresh_token',
        refresh_token: 'test-refresh-token',
      })
    })

    it('throws specific error on invalid_grant', async () => {
      mock.onPost(TOKEN_URL).replyWithError({
        message: 'Bad Request',
        body: { error: 'invalid_grant' },
      })

      await expect(service.refreshToken('expired-token'))
        .rejects.toThrow('Refresh token expired or invalid, please re-authenticate.')
    })

    it('rethrows other errors', async () => {
      mock.onPost(TOKEN_URL).replyWithError({
        message: 'Server Error',
        body: { error: 'server_error' },
      })

      await expect(service.refreshToken('some-token')).rejects.toThrow()
    })
  })

  describe('executeCallback', () => {
    const callbackObject = {
      code: 'auth-code-123',
      redirectURI: 'https://example.com/callback',
    }

    it('exchanges code for tokens and fetches user info', async () => {
      mock.onPost(TOKEN_URL).reply({
        access_token: 'new-access-token',
        expires_in: 3600,
        refresh_token: 'new-refresh-token',
      })

      mock.onGet(USER_INFO_URL).reply({
        name: 'John Doe',
        email: 'john@example.com',
        picture: 'https://example.com/photo.jpg',
      })

      const result = await service.executeCallback(callbackObject)

      expect(result).toEqual({
        token: 'new-access-token',
        expirationInSeconds: 3600,
        refreshToken: 'new-refresh-token',
        connectionIdentityName: 'John Doe (john@example.com)',
        connectionIdentityImageURL: 'https://example.com/photo.jpg',
        overwrite: true,
        userData: {
          name: 'John Doe',
          email: 'john@example.com',
          picture: 'https://example.com/photo.jpg',
        },
      })

      // Verify token exchange request
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(TOKEN_URL)

      // Verify user info request uses the new access token
      expect(mock.history[1].method).toBe('get')
      expect(mock.history[1].url).toBe(USER_INFO_URL)
      expect(mock.history[1].headers).toMatchObject({
        Authorization: 'Bearer new-access-token',
      })
    })

    it('uses email only when name is not available', async () => {
      mock.onPost(TOKEN_URL).reply({
        access_token: 'token',
        expires_in: 3600,
        refresh_token: 'refresh',
      })

      mock.onGet(USER_INFO_URL).reply({
        email: 'john@example.com',
      })

      const result = await service.executeCallback(callbackObject)

      expect(result.connectionIdentityName).toBe('john@example.com')
    })

    it('falls back to default name when user info fails', async () => {
      mock.onPost(TOKEN_URL).reply({
        access_token: 'token',
        expires_in: 3600,
        refresh_token: 'refresh',
      })

      mock.onGet(USER_INFO_URL).replyWithError({ message: 'Unauthorized' })

      const result = await service.executeCallback(callbackObject)

      expect(result.connectionIdentityName).toBe('Google Calendar Account')
      expect(result.connectionIdentityImageURL).toBe(null)
    })
  })

  // ── Dictionaries ──

  describe('getCalendarsDictionary', () => {
    it('returns formatted calendar items', async () => {
      mock.onGet(`${API_BASE}/users/me/calendarList`).reply({
        items: [
          { summary: 'Primary Calendar', id: 'primary' },
          { summary: 'Work Calendar', id: 'work@example.com' },
        ],
        nextPageToken: 'token123',
      })

      const result = await service.getCalendarsDictionary({})

      expect(result.cursor).toBe('token123')
      expect(result.items).toEqual([
        { label: 'Primary Calendar', note: 'Calendar ID: primary', value: 'primary' },
        { label: 'Work Calendar', note: 'Calendar ID: work@example.com', value: 'work@example.com' },
      ])
      expect(mock.history[0].query).toMatchObject({ maxResults: 100 })
    })

    it('passes pagination cursor', async () => {
      mock.onGet(`${API_BASE}/users/me/calendarList`).reply({ items: [] })

      await service.getCalendarsDictionary({ cursor: 'page2' })

      expect(mock.history[0].query).toMatchObject({ pageToken: 'page2' })
    })

    it('filters calendars by search string', async () => {
      mock.onGet(`${API_BASE}/users/me/calendarList`).reply({
        items: [
          { summary: 'Work Calendar', id: 'work@example.com' },
          { summary: 'Personal Calendar', id: 'personal@example.com' },
        ],
      })

      const result = await service.getCalendarsDictionary({ search: 'work' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toBe('Work Calendar')
    })

    it('uses id as label when summary is missing', async () => {
      mock.onGet(`${API_BASE}/users/me/calendarList`).reply({
        items: [{ id: 'some-calendar-id' }],
      })

      const result = await service.getCalendarsDictionary({})

      expect(result.items[0].label).toBe('some-calendar-id')
    })

    it('handles empty items response', async () => {
      mock.onGet(`${API_BASE}/users/me/calendarList`).reply({})

      const result = await service.getCalendarsDictionary({})

      expect(result.items).toEqual([])
    })
  })

  describe('getTimeZonesDictionary', () => {
    it('returns all time zones when no search is provided', async () => {
      const result = await service.getTimeZonesDictionary({})

      expect(result.items.length).toBe(12)
      expect(result.items[0]).toMatchObject({
        label: expect.stringContaining('Eastern Time'),
        note: 'UTC-05:00',
        value: 'America/New_York',
      })
    })

    it('filters time zones by search string', async () => {
      const result = await service.getTimeZonesDictionary({ search: 'Tokyo' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('Asia/Tokyo')
    })

    it('filters by timezone value', async () => {
      const result = await service.getTimeZonesDictionary({ search: 'UTC' })

      expect(result.items.length).toBeGreaterThanOrEqual(1)
      expect(result.items.some(tz => tz.value === 'UTC')).toBe(true)
    })
  })

  // ── Event Actions ──

  describe('createEvent', () => {
    const calendarId = 'primary'
    const eventsUrl = `${API_BASE}/calendars/primary/events`

    it('creates a timed event with required fields', async () => {
      mock.onPost(eventsUrl).reply({ id: 'event-123', summary: 'Meeting' })

      const result = await service.createEvent(
        calendarId,
        'Meeting',
        undefined,  // description
        undefined,  // location
        '2025-01-20T10:00:00',
        '2025-01-20T11:00:00'
      )

      expect(result).toEqual({ id: 'event-123', summary: 'Meeting' })
      expect(mock.history[0].body).toMatchObject({
        summary: 'Meeting',
        start: { dateTime: '2025-01-20T10:00:00' },
        end: { dateTime: '2025-01-20T11:00:00' },
      })
      expect(mock.history[0].body.description).toBeUndefined()
      expect(mock.history[0].body.location).toBeUndefined()
      expect(mock.history[0].query).toMatchObject({ sendUpdates: 'all' })
    })

    it('creates an all-day event when dates have no time component', async () => {
      mock.onPost(eventsUrl).reply({ id: 'event-456' })

      await service.createEvent(calendarId, 'All Day', null, null, '2025-01-20', '2025-01-21')

      expect(mock.history[0].body).toMatchObject({
        start: { date: '2025-01-20' },
        end: { date: '2025-01-21' },
      })
      // All-day events should not have dateTime or timeZone
      expect(mock.history[0].body.start.dateTime).toBeUndefined()
      expect(mock.history[0].body.end.dateTime).toBeUndefined()
    })

    it('includes optional fields when provided', async () => {
      mock.onPost(eventsUrl).reply({ id: 'event-789' })

      await service.createEvent(
        calendarId,
        'Full Event',
        'Description text',
        'Conference Room A',
        '2025-01-20T10:00:00',
        '2025-01-20T11:00:00',
        'America/New_York',
        ['john@example.com', 'jane@example.com'],
        true,
        'hangoutsMeet',
        '5',
        'RRULE:FREQ=WEEKLY;COUNT=10'
      )

      const body = mock.history[0].body

      expect(body.description).toBe('Description text')
      expect(body.location).toBe('Conference Room A')
      expect(body.colorId).toBe('5')
      expect(body.start.timeZone).toBe('America/New_York')
      expect(body.end.timeZone).toBe('America/New_York')
      expect(body.attendees).toEqual([
        { email: 'john@example.com' },
        { email: 'jane@example.com' },
      ])
      expect(body.recurrence).toEqual(['RRULE:FREQ=WEEKLY;COUNT=10'])
      expect(body.conferenceData).toBeDefined()
      expect(body.conferenceData.createRequest.conferenceSolutionKey.type).toBe('hangoutsMeet')
      expect(mock.history[0].query).toMatchObject({ conferenceDataVersion: 1 })
    })

    it('parses attendees from comma-separated string', async () => {
      mock.onPost(eventsUrl).reply({ id: 'event-str' })

      await service.createEvent(
        calendarId, 'Event', null, null,
        '2025-01-20T10:00:00', '2025-01-20T11:00:00',
        null, 'john@example.com, jane@example.com'
      )

      expect(mock.history[0].body.attendees).toEqual([
        { email: 'john@example.com' },
        { email: 'jane@example.com' },
      ])
    })

    it('parses attendees from newline-separated string', async () => {
      mock.onPost(eventsUrl).reply({ id: 'event-nl' })

      await service.createEvent(
        calendarId, 'Event', null, null,
        '2025-01-20T10:00:00', '2025-01-20T11:00:00',
        null, 'john@example.com\njane@example.com'
      )

      expect(mock.history[0].body.attendees).toEqual([
        { email: 'john@example.com' },
        { email: 'jane@example.com' },
      ])
    })

    it('sets sendUpdates to none when sendNotifications is false', async () => {
      mock.onPost(eventsUrl).reply({ id: 'event-no-notify' })

      await service.createEvent(
        calendarId, 'Event', null, null,
        '2025-01-20T10:00:00', '2025-01-20T11:00:00',
        null, null, false
      )

      expect(mock.history[0].query).toMatchObject({ sendUpdates: 'none' })
    })

    it('does not add conferenceData when conferenceData is "none"', async () => {
      mock.onPost(eventsUrl).reply({ id: 'event-no-conf' })

      await service.createEvent(
        calendarId, 'Event', null, null,
        '2025-01-20T10:00:00', '2025-01-20T11:00:00',
        null, null, null, 'none'
      )

      expect(mock.history[0].body.conferenceData).toBeUndefined()
      expect(mock.history[0].query.conferenceDataVersion).toBeUndefined()
    })

    it('throws when calendarId is missing', async () => {
      await expect(service.createEvent(null, 'Event', null, null, 'start', 'end'))
        .rejects.toThrow('"Calendar" is required')
    })

    it('throws when summary is missing', async () => {
      await expect(service.createEvent('primary', null, null, null, 'start', 'end'))
        .rejects.toThrow('"Summary" is required')
    })

    it('throws when startDateTime is missing', async () => {
      await expect(service.createEvent('primary', 'Event', null, null, null, 'end'))
        .rejects.toThrow('"Start Date Time" is required')
    })

    it('throws when endDateTime is missing', async () => {
      await expect(service.createEvent('primary', 'Event', null, null, 'start', null))
        .rejects.toThrow('"End Date Time" is required')
    })

    it('sends correct auth header', async () => {
      mock.onPost(eventsUrl).reply({ id: 'event-auth' })

      await service.createEvent(calendarId, 'Event', null, null, '2025-01-20T10:00:00', '2025-01-20T11:00:00')

      expect(mock.history[0].headers).toMatchObject({
        Authorization: `Bearer ${ACCESS_TOKEN}`,
      })
    })
  })

  describe('getEvent', () => {
    it('fetches an event by calendarId and eventId', async () => {
      const eventData = { id: 'event-123', summary: 'Team Meeting' }

      mock.onGet(`${API_BASE}/calendars/primary/events/event-123`).reply(eventData)

      const result = await service.getEvent('primary', 'event-123')

      expect(result).toEqual(eventData)
      expect(mock.history[0].headers).toMatchObject({
        Authorization: `Bearer ${ACCESS_TOKEN}`,
      })
    })

    it('encodes calendarId and eventId in URL', async () => {
      mock.onGet(`${API_BASE}/calendars/user%40example.com/events/event%23123`).reply({ id: 'event#123' })

      await service.getEvent('user@example.com', 'event#123')

      expect(mock.history[0].url).toBe(`${API_BASE}/calendars/user%40example.com/events/event%23123`)
    })

    it('throws when calendarId is missing', async () => {
      await expect(service.getEvent(null, 'event-123'))
        .rejects.toThrow('"Calendar" is required')
    })

    it('throws when eventId is missing', async () => {
      await expect(service.getEvent('primary', null))
        .rejects.toThrow('"Event ID" is required')
    })
  })

  describe('listEvents', () => {
    const eventsUrl = `${API_BASE}/calendars/primary/events`

    it('lists events with default parameters', async () => {
      const responseData = {
        items: [{ id: 'e1', summary: 'Event 1' }],
        nextPageToken: 'next123',
      }

      mock.onGet(eventsUrl).reply(responseData)

      const result = await service.listEvents('primary')

      expect(result).toEqual(responseData)
      expect(mock.history[0].query).toMatchObject({
        maxResults: 250,
        singleEvents: true,
      })
      // timeMin should default to current time (an ISO string)
      expect(mock.history[0].query.timeMin).toBeDefined()
    })

    it('passes custom time range and search parameters', async () => {
      mock.onGet(eventsUrl).reply({ items: [] })

      await service.listEvents(
        'primary',
        '2025-01-20T00:00:00Z',
        '2025-02-20T23:59:59Z',
        50,
        'meeting',
        true,
        'startTime'
      )

      expect(mock.history[0].query).toMatchObject({
        timeMin: '2025-01-20T00:00:00Z',
        timeMax: '2025-02-20T23:59:59Z',
        maxResults: 50,
        q: 'meeting',
        singleEvents: true,
        orderBy: 'startTime',
      })
    })

    it('converts date-only timeMin to RFC3339 start of day', async () => {
      mock.onGet(eventsUrl).reply({ items: [] })

      await service.listEvents('primary', '2025-01-20')

      expect(mock.history[0].query.timeMin).toBe('2025-01-20T00:00:00Z')
    })

    it('converts date-only timeMax to RFC3339 end of day', async () => {
      mock.onGet(eventsUrl).reply({ items: [] })

      await service.listEvents('primary', '2025-01-20', '2025-02-20')

      expect(mock.history[0].query.timeMax).toBe('2025-02-20T23:59:59Z')
    })

    it('does not include orderBy when singleEvents is false', async () => {
      mock.onGet(eventsUrl).reply({ items: [] })

      await service.listEvents('primary', null, null, null, null, false, 'startTime')

      expect(mock.history[0].query.orderBy).toBeUndefined()
      expect(mock.history[0].query.singleEvents).toBe(false)
    })

    it('includes orderBy when singleEvents is true (default)', async () => {
      mock.onGet(eventsUrl).reply({ items: [] })

      await service.listEvents('primary', null, null, null, null, undefined, 'updated')

      expect(mock.history[0].query.orderBy).toBe('updated')
      expect(mock.history[0].query.singleEvents).toBe(true)
    })

    it('throws when calendarId is missing', async () => {
      await expect(service.listEvents(null))
        .rejects.toThrow('"Calendar" is required')
    })
  })

  describe('updateEvent', () => {
    const calendarId = 'primary'
    const eventId = 'event-123'
    const getUrl = `${API_BASE}/calendars/primary/events/event-123`
    const putUrl = `${API_BASE}/calendars/primary/events/event-123`

    const existingEvent = {
      id: 'event-123',
      summary: 'Old Title',
      description: 'Old description',
      start: { dateTime: '2025-01-20T10:00:00-05:00', timeZone: 'America/New_York' },
      end: { dateTime: '2025-01-20T11:00:00-05:00', timeZone: 'America/New_York' },
    }

    it('fetches existing event and sends merged update', async () => {
      mock.onGet(getUrl).reply(existingEvent)
      mock.onPut(putUrl).reply({ ...existingEvent, summary: 'New Title' })

      const result = await service.updateEvent(calendarId, eventId, 'New Title')

      expect(mock.history).toHaveLength(2)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[1].method).toBe('put')
      expect(mock.history[1].body.summary).toBe('New Title')
      // Should preserve existing fields
      expect(mock.history[1].body.description).toBe('Old description')
      expect(result.summary).toBe('New Title')
    })

    it('updates time fields with new timezone', async () => {
      mock.onGet(getUrl).reply(existingEvent)
      mock.onPut(putUrl).reply({ id: eventId })

      await service.updateEvent(
        calendarId, eventId,
        undefined, undefined, undefined,
        '2025-01-21T14:00:00',
        '2025-01-21T15:00:00',
        'Europe/London'
      )

      const body = mock.history[1].body

      expect(body.start).toEqual({ dateTime: '2025-01-21T14:00:00', timeZone: 'Europe/London' })
      expect(body.end).toEqual({ dateTime: '2025-01-21T15:00:00', timeZone: 'Europe/London' })
    })

    it('uses existing timezone when new timezone is not provided', async () => {
      mock.onGet(getUrl).reply(existingEvent)
      mock.onPut(putUrl).reply({ id: eventId })

      await service.updateEvent(
        calendarId, eventId,
        undefined, undefined, undefined,
        '2025-01-21T14:00:00',
        '2025-01-21T15:00:00'
      )

      const body = mock.history[1].body

      expect(body.start.timeZone).toBe('America/New_York')
      expect(body.end.timeZone).toBe('America/New_York')
    })

    it('updates to all-day event format', async () => {
      mock.onGet(getUrl).reply(existingEvent)
      mock.onPut(putUrl).reply({ id: eventId })

      await service.updateEvent(
        calendarId, eventId,
        undefined, undefined, undefined,
        '2025-01-21',
        '2025-01-22'
      )

      const body = mock.history[1].body

      expect(body.start).toEqual({ date: '2025-01-21' })
      expect(body.end).toEqual({ date: '2025-01-22' })
    })

    it('sets sendUpdates to none when sendNotifications is false', async () => {
      mock.onGet(getUrl).reply(existingEvent)
      mock.onPut(putUrl).reply({ id: eventId })

      await service.updateEvent(
        calendarId, eventId,
        'Updated', undefined, undefined,
        undefined, undefined, undefined,
        false
      )

      expect(mock.history[1].query).toMatchObject({ sendUpdates: 'none' })
    })

    it('sets sendUpdates to all by default', async () => {
      mock.onGet(getUrl).reply(existingEvent)
      mock.onPut(putUrl).reply({ id: eventId })

      await service.updateEvent(calendarId, eventId, 'Updated')

      expect(mock.history[1].query).toMatchObject({ sendUpdates: 'all' })
    })

    it('throws when calendarId is missing', async () => {
      await expect(service.updateEvent(null, eventId))
        .rejects.toThrow('"Calendar" is required')
    })

    it('throws when eventId is missing', async () => {
      await expect(service.updateEvent(calendarId, null))
        .rejects.toThrow('"Event ID" is required')
    })
  })

  describe('deleteEvent', () => {
    const deleteUrl = `${API_BASE}/calendars/primary/events/event-123`

    it('sends DELETE request and returns success response', async () => {
      mock.onDelete(deleteUrl).reply({})

      const result = await service.deleteEvent('primary', 'event-123')

      expect(result).toEqual({
        success: true,
        message: 'Event deleted successfully',
        eventId: 'event-123',
      })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].query).toMatchObject({ sendUpdates: 'all' })
    })

    it('sets sendUpdates to none when sendNotifications is false', async () => {
      mock.onDelete(deleteUrl).reply({})

      await service.deleteEvent('primary', 'event-123', false)

      expect(mock.history[0].query).toMatchObject({ sendUpdates: 'none' })
    })

    it('throws when calendarId is missing', async () => {
      await expect(service.deleteEvent(null, 'event-123'))
        .rejects.toThrow('"Calendar" is required')
    })

    it('throws when eventId is missing', async () => {
      await expect(service.deleteEvent('primary', null))
        .rejects.toThrow('"Event ID" is required')
    })
  })

  // ── Triggers ──

  describe('handleTriggerPollingForEvent', () => {
    it('delegates to the correct trigger method', async () => {
      const eventsUrl = `${API_BASE}/calendars/primary/events`

      mock.onGet(eventsUrl).reply({ items: [] })

      await service.handleTriggerPollingForEvent({
        eventName: 'onEventStartingSoon',
        learningMode: true,
        triggerData: { calendarId: 'primary', leadTimeMinutes: '15' },
      })

      expect(mock.history).toHaveLength(1)
    })
  })

  describe('onEventStartingSoon', () => {
    const eventsUrl = `${API_BASE}/calendars/primary/events`

    it('returns a sample event in learning mode', async () => {
      const sampleEvent = { id: 'e1', summary: 'Upcoming Meeting' }

      mock.onGet(eventsUrl).reply({ items: [sampleEvent] })

      const result = await service.onEventStartingSoon({
        triggerData: { calendarId: 'primary', leadTimeMinutes: '15' },
        learningMode: true,
      })

      expect(result.events).toEqual([sampleEvent])
      expect(result.state).toBeNull()
      expect(mock.history[0].query).toMatchObject({
        maxResults: 1,
        singleEvents: true,
        orderBy: 'startTime',
      })
    })

    it('returns empty events in learning mode when no events exist', async () => {
      mock.onGet(eventsUrl).reply({ items: [] })

      const result = await service.onEventStartingSoon({
        triggerData: { calendarId: 'primary', leadTimeMinutes: '15' },
        learningMode: true,
      })

      expect(result.events).toEqual([])
    })

    it('initializes state on first poll (non-learning)', async () => {
      mock.onGet(eventsUrl).reply({
        items: [{ id: 'e1' }, { id: 'e2' }],
      })

      const result = await service.onEventStartingSoon({
        triggerData: { calendarId: 'primary', leadTimeMinutes: '30' },
        learningMode: false,
        state: null,
      })

      expect(result.events).toEqual([])
      expect(result.state).toEqual({
        initialized: true,
        notifiedEventIds: ['e1', 'e2'],
      })
    })

    it('detects new events in subsequent polls', async () => {
      mock.onGet(eventsUrl).reply({
        items: [{ id: 'e1' }, { id: 'e2' }, { id: 'e3' }],
      })

      const result = await service.onEventStartingSoon({
        triggerData: { calendarId: 'primary', leadTimeMinutes: '15' },
        learningMode: false,
        state: {
          initialized: true,
          notifiedEventIds: ['e1', 'e2'],
        },
      })

      expect(result.events).toEqual([{ id: 'e3' }])
      expect(result.state.notifiedEventIds).toContain('e3')
      expect(result.state.notifiedEventIds).toContain('e1')
      expect(result.state.notifiedEventIds).toContain('e2')
    })

    it('removes expired event IDs from state', async () => {
      mock.onGet(eventsUrl).reply({
        items: [{ id: 'e2' }],
      })

      const result = await service.onEventStartingSoon({
        triggerData: { calendarId: 'primary', leadTimeMinutes: '15' },
        learningMode: false,
        state: {
          initialized: true,
          notifiedEventIds: ['e1', 'e2'],
        },
      })

      // e1 is no longer in the window, so it should be removed
      expect(result.state.notifiedEventIds).not.toContain('e1')
      expect(result.state.notifiedEventIds).toContain('e2')
    })

    it('defaults leadTimeMinutes to 15 when invalid', async () => {
      mock.onGet(eventsUrl).reply({ items: [] })

      await service.onEventStartingSoon({
        triggerData: { calendarId: 'primary', leadTimeMinutes: 'invalid' },
        learningMode: false,
        state: null,
      })

      // The query timeMax should be ~15 minutes from now
      const timeMax = new Date(mock.history[0].query.timeMax)
      const timeMin = new Date(mock.history[0].query.timeMin)
      const diffMs = timeMax - timeMin

      // 15 minutes = 900000 ms (allow some tolerance)
      expect(diffMs).toBeGreaterThan(800000)
      expect(diffMs).toBeLessThan(1000000)
    })
  })

  describe('onEventEnded', () => {
    const eventsUrl = `${API_BASE}/calendars/primary/events`

    it('returns a sample ended event in learning mode', async () => {
      const pastEvent = {
        id: 'e1',
        summary: 'Past Meeting',
        end: { dateTime: new Date(Date.now() - 60000).toISOString() },
      }

      mock.onGet(eventsUrl).reply({ items: [pastEvent] })

      const result = await service.onEventEnded({
        triggerData: { calendarId: 'primary' },
        learningMode: true,
      })

      expect(result.events).toEqual([pastEvent])
      expect(result.state).toBeNull()
    })

    it('returns empty when no ended events in learning mode', async () => {
      const futureEvent = {
        id: 'e1',
        end: { dateTime: new Date(Date.now() + 3600000).toISOString() },
      }

      mock.onGet(eventsUrl).reply({ items: [futureEvent] })

      const result = await service.onEventEnded({
        triggerData: { calendarId: 'primary' },
        learningMode: true,
      })

      expect(result.events).toEqual([])
    })

    it('initializes state on first poll', async () => {
      const endedEvent = {
        id: 'e1',
        end: { dateTime: new Date(Date.now() - 60000).toISOString() },
      }

      mock.onGet(eventsUrl).reply({ items: [endedEvent] })

      const result = await service.onEventEnded({
        triggerData: { calendarId: 'primary' },
        learningMode: false,
        state: null,
      })

      expect(result.events).toEqual([])
      expect(result.state).toEqual({
        initialized: true,
        notifiedEventIds: ['e1'],
      })
    })

    it('detects newly ended events in subsequent polls', async () => {
      const endedEvent1 = {
        id: 'e1',
        end: { dateTime: new Date(Date.now() - 120000).toISOString() },
      }
      const endedEvent2 = {
        id: 'e2',
        end: { dateTime: new Date(Date.now() - 60000).toISOString() },
      }

      mock.onGet(eventsUrl).reply({ items: [endedEvent1, endedEvent2] })

      const result = await service.onEventEnded({
        triggerData: { calendarId: 'primary' },
        learningMode: false,
        state: {
          initialized: true,
          notifiedEventIds: ['e1'],
        },
      })

      expect(result.events).toEqual([endedEvent2])
      expect(result.state.notifiedEventIds).toContain('e1')
      expect(result.state.notifiedEventIds).toContain('e2')
    })

    it('handles all-day event end dates', async () => {
      // Yesterday's all-day event (ended)
      const yesterday = new Date()

      yesterday.setDate(yesterday.getDate() - 1)
      const dateStr = yesterday.toISOString().split('T')[0]

      const allDayEvent = {
        id: 'allday1',
        end: { date: dateStr },
      }

      mock.onGet(eventsUrl).reply({ items: [allDayEvent] })

      const result = await service.onEventEnded({
        triggerData: { calendarId: 'primary' },
        learningMode: true,
      })

      expect(result.events).toEqual([allDayEvent])
    })

    it('uses 2 hour lookback window', async () => {
      mock.onGet(eventsUrl).reply({ items: [] })

      await service.onEventEnded({
        triggerData: { calendarId: 'primary' },
        learningMode: false,
        state: null,
      })

      const timeMin = new Date(mock.history[0].query.timeMin)
      const timeMax = new Date(mock.history[0].query.timeMax)
      const diffMs = timeMax - timeMin

      // 2 hours = 7200000 ms (allow some tolerance)
      expect(diffMs).toBeGreaterThan(7100000)
      expect(diffMs).toBeLessThan(7300000)
    })
  })

  // ── API Error Handling ──

  describe('API error handling', () => {
    it('propagates API errors from action methods', async () => {
      mock.onGet(`${API_BASE}/calendars/primary/events/bad-id`).replyWithError({
        message: 'Not Found',
        body: { error: { code: 404, message: 'Not Found' } },
      })

      await expect(service.getEvent('primary', 'bad-id')).rejects.toThrow()
    })
  })
})
