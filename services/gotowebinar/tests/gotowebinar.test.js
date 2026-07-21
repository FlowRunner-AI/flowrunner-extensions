'use strict'

const { createSandbox } = require('../../../service-sandbox')

const CLIENT_ID = 'test-client-id'
const CLIENT_SECRET = 'test-client-secret'
const ACCESS_TOKEN = 'test-access-token'
const ORGANIZER_KEY = '1234567890'
const ACCOUNT_KEY = '9876543210'
const COMPOSITE_TOKEN = `${ ACCESS_TOKEN }::gtw::${ ORGANIZER_KEY }::gtw::${ ACCOUNT_KEY }`

const API_BASE = 'https://api.getgo.com/G2W/rest/v2'
const OAUTH_TOKEN_URL = 'https://authentication.logmeininc.com/oauth/token'
const IDENTITY_ME_URL = 'https://api.getgo.com/identity/v1/Users/me'

const WEBINAR_KEY = '9999999999999999999'
const SESSION_KEY = '8888888888888888888'
const REGISTRANT_KEY = '5555555555555555555'

describe('GoTo Webinar Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET })
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

  // Helper to set the composite token on the service request headers
  function setToken(token) {
    service.request = { headers: { 'oauth-access-token': token || COMPOSITE_TOKEN } }
  }

  // ── Registration ──

  describe('service registration', () => {
    it('registers with correct config items', () => {
      expect(sandbox.getConfigItems()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'clientId', required: true, shared: true }),
          expect.objectContaining({ name: 'clientSecret', required: true, shared: true }),
        ])
      )
    })
  })

  // ── OAuth2 System Methods ──

  describe('getOAuth2ConnectionURL', () => {
    it('returns the authorization URL with client_id and response_type', async () => {
      const url = await service.getOAuth2ConnectionURL()

      expect(url).toContain('https://authentication.logmeininc.com/oauth/authorize')
      expect(url).toContain(`client_id=${ CLIENT_ID }`)
      expect(url).toContain('response_type=code')
    })
  })

  describe('executeCallback', () => {
    it('exchanges code for token and fetches identity keys', async () => {
      const tokenResponse = {
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        expires_in: 3600,
        principal: 'user@example.com',
      }

      const identityResponse = {
        key: ORGANIZER_KEY,
        accounts: [{ key: ACCOUNT_KEY }],
        email: 'user@example.com',
        displayName: 'Test User',
      }

      mock.onPost(OAUTH_TOKEN_URL).reply(tokenResponse)
      mock.onGet(IDENTITY_ME_URL).reply(identityResponse)

      const result = await service.executeCallback({
        code: 'auth-code-123',
        redirectURI: 'https://example.com/callback',
      })

      expect(result).toMatchObject({
        expirationInSeconds: 3600,
        refreshToken: 'new-refresh-token',
        connectionIdentityName: 'Test User',
        connectionIdentityImageURL: null,
        overwrite: true,
      })

      // Verify token is composite
      expect(result.token).toBe(`new-access-token::gtw::${ ORGANIZER_KEY }::gtw::${ ACCOUNT_KEY }`)

      // Verify userData
      expect(result.userData).toEqual({
        organizerKey: ORGANIZER_KEY,
        accountKey: ACCOUNT_KEY,
        email: 'user@example.com',
      })

      // Verify token exchange request
      const tokenReq = mock.history[0]
      expect(tokenReq.method).toBe('post')
      expect(tokenReq.url).toBe(OAUTH_TOKEN_URL)
      expect(tokenReq.headers['Content-Type']).toBe('application/x-www-form-urlencoded')
      expect(tokenReq.headers.Authorization).toMatch(/^Basic /)

      // Verify identity request
      const identityReq = mock.history[1]
      expect(identityReq.method).toBe('get')
      expect(identityReq.url).toBe(IDENTITY_ME_URL)
    })

    it('throws when organizer key cannot be determined', async () => {
      mock.onPost(OAUTH_TOKEN_URL).reply({
        access_token: 'token',
        refresh_token: 'refresh',
        expires_in: 3600,
      })
      mock.onGet(IDENTITY_ME_URL).reply({})

      await expect(
        service.executeCallback({ code: 'code', redirectURI: 'https://example.com/cb' })
      ).rejects.toThrow('Could not determine the organizer key')
    })

    it('falls back to principal for connectionIdentityName when displayName and email are absent', async () => {
      mock.onPost(OAUTH_TOKEN_URL).reply({
        access_token: 'tok',
        refresh_token: 'ref',
        expires_in: 3600,
        principal: 'principal@example.com',
      })
      mock.onGet(IDENTITY_ME_URL).reply({
        key: ORGANIZER_KEY,
        accounts: [{ key: ACCOUNT_KEY }],
      })

      const result = await service.executeCallback({ code: 'c', redirectURI: 'https://x.com/cb' })

      expect(result.connectionIdentityName).toBe('principal@example.com')
    })
  })

  describe('refreshToken', () => {
    it('refreshes the token and preserves organizer/account keys from composite token', async () => {
      setToken(COMPOSITE_TOKEN)

      mock.onPost(OAUTH_TOKEN_URL).reply({
        access_token: 'refreshed-token',
        refresh_token: 'new-refresh',
        expires_in: 7200,
      })

      const result = await service.refreshToken('old-refresh-token')

      expect(result).toEqual({
        token: `refreshed-token::gtw::${ ORGANIZER_KEY }::gtw::${ ACCOUNT_KEY }`,
        expirationInSeconds: 7200,
        refreshToken: 'new-refresh',
      })

      // Verify the form body
      expect(mock.history[0].body).toContain('grant_type=refresh_token')
      expect(mock.history[0].body).toContain('refresh_token=old-refresh-token')
    })

    it('keeps original refresh token when new one is not returned', async () => {
      setToken(COMPOSITE_TOKEN)

      mock.onPost(OAUTH_TOKEN_URL).reply({
        access_token: 'refreshed-token',
        expires_in: 7200,
      })

      const result = await service.refreshToken('keep-this-refresh')

      expect(result.refreshToken).toBe('keep-this-refresh')
    })
  })

  // ── Webinars ──

  describe('getAllWebinars', () => {
    beforeEach(() => setToken())

    it('sends correct request with defaults', async () => {
      const response = {
        _embedded: { webinars: [] },
        page: { size: 20, totalElements: 0, totalPages: 0, number: 0 },
      }
      mock.onGet(`${ API_BASE }/organizers/${ ORGANIZER_KEY }/webinars`).reply(response)

      const result = await service.getAllWebinars('2024-01-01T00:00:00Z', '2024-12-31T23:59:59Z')

      expect(result).toEqual(response)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers.Authorization).toBe(`Bearer ${ ACCESS_TOKEN }`)
      expect(mock.history[0].query).toMatchObject({
        fromTime: '2024-01-01T00:00:00Z',
        toTime: '2024-12-31T23:59:59Z',
        page: 0,
        size: 20,
      })
    })

    it('passes custom page and size', async () => {
      mock.onGet(`${ API_BASE }/organizers/${ ORGANIZER_KEY }/webinars`).reply({ _embedded: { webinars: [] } })

      await service.getAllWebinars('2024-01-01T00:00:00Z', '2024-12-31T23:59:59Z', 2, 10)

      expect(mock.history[0].query).toMatchObject({ page: 2, size: 10 })
    })

    it('throws when fromTime is missing', async () => {
      await expect(service.getAllWebinars(null, '2024-12-31T23:59:59Z')).rejects.toThrow('From Time is required')
    })

    it('throws when toTime is missing', async () => {
      await expect(service.getAllWebinars('2024-01-01T00:00:00Z', null)).rejects.toThrow('To Time is required')
    })

    it('throws on API error with hint', async () => {
      mock.onGet(`${ API_BASE }/organizers/${ ORGANIZER_KEY }/webinars`).replyWithError({
        message: 'Unauthorized',
        body: { message: 'Unauthorized' },
        status: 401,
      })

      await expect(
        service.getAllWebinars('2024-01-01T00:00:00Z', '2024-12-31T23:59:59Z')
      ).rejects.toThrow('Authentication failed')
    })
  })

  describe('getWebinar', () => {
    beforeEach(() => setToken())

    it('sends correct GET request', async () => {
      const response = { webinarKey: WEBINAR_KEY, subject: 'Test Webinar' }
      mock.onGet(`${ API_BASE }/organizers/${ ORGANIZER_KEY }/webinars/${ WEBINAR_KEY }`).reply(response)

      const result = await service.getWebinar(WEBINAR_KEY)

      expect(result).toEqual(response)
      expect(mock.history[0].url).toBe(`${ API_BASE }/organizers/${ ORGANIZER_KEY }/webinars/${ WEBINAR_KEY }`)
    })

    it('throws when webinarKey is missing', async () => {
      await expect(service.getWebinar()).rejects.toThrow('Webinar is required')
    })
  })

  describe('createWebinar', () => {
    beforeEach(() => setToken())

    const times = [{ startTime: '2024-05-01T15:00:00Z', endTime: '2024-05-01T16:00:00Z' }]

    it('sends POST with required fields', async () => {
      mock.onPost(`${ API_BASE }/organizers/${ ORGANIZER_KEY }/webinars`).reply({ webinarKey: WEBINAR_KEY })

      const result = await service.createWebinar('My Webinar', times, 'America/New_York')

      expect(result).toEqual({ webinarKey: WEBINAR_KEY })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toMatchObject({
        subject: 'My Webinar',
        times,
        timeZone: 'America/New_York',
        type: 'single_session',
      })
      expect(mock.history[0].headers['Content-Type']).toBe('application/json')
    })

    it('includes optional fields when provided', async () => {
      mock.onPost(`${ API_BASE }/organizers/${ ORGANIZER_KEY }/webinars`).reply({ webinarKey: WEBINAR_KEY })

      await service.createWebinar('Webinar', times, 'UTC', 'A description', 'Series', true)

      expect(mock.history[0].body).toMatchObject({
        description: 'A description',
        type: 'series',
        isApprovalRequired: true,
      })
    })

    it('maps DROPDOWN labels to API values for type', async () => {
      mock.onPost(`${ API_BASE }/organizers/${ ORGANIZER_KEY }/webinars`).reply({ webinarKey: WEBINAR_KEY })

      await service.createWebinar('W', times, 'UTC', undefined, 'Sequence')

      expect(mock.history[0].body.type).toBe('sequence')
    })

    it('omits description when not provided', async () => {
      mock.onPost(`${ API_BASE }/organizers/${ ORGANIZER_KEY }/webinars`).reply({ webinarKey: WEBINAR_KEY })

      await service.createWebinar('W', times, 'UTC')

      expect(mock.history[0].body).not.toHaveProperty('description')
    })

    it('throws when subject is missing', async () => {
      await expect(service.createWebinar(null, times, 'UTC')).rejects.toThrow('Subject is required')
    })

    it('throws when timeZone is missing', async () => {
      await expect(service.createWebinar('W', times, null)).rejects.toThrow('Time Zone is required')
    })

    it('throws when times is empty', async () => {
      await expect(service.createWebinar('W', [], 'UTC')).rejects.toThrow('At least one session time range')
    })

    it('throws when a time range is missing endTime', async () => {
      await expect(
        service.createWebinar('W', [{ startTime: '2024-05-01T15:00:00Z' }], 'UTC')
      ).rejects.toThrow('startTime and endTime')
    })

    it('accepts times as a JSON string', async () => {
      mock.onPost(`${ API_BASE }/organizers/${ ORGANIZER_KEY }/webinars`).reply({ webinarKey: WEBINAR_KEY })

      await service.createWebinar('W', JSON.stringify(times), 'UTC')

      expect(mock.history[0].body.times).toEqual(times)
    })
  })

  describe('updateWebinar', () => {
    beforeEach(() => setToken())

    it('sends PUT with fields and defaults notifyParticipants to true', async () => {
      mock.onPut(`${ API_BASE }/organizers/${ ORGANIZER_KEY }/webinars/${ WEBINAR_KEY }`).reply({})

      const result = await service.updateWebinar(WEBINAR_KEY, 'New Subject')

      expect(result).toEqual({ updated: true, webinarKey: WEBINAR_KEY })
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].body).toMatchObject({ subject: 'New Subject' })
      expect(mock.history[0].query).toMatchObject({ notifyParticipants: true })
    })

    it('includes all optional fields', async () => {
      const times = [{ startTime: '2024-06-01T10:00:00Z', endTime: '2024-06-01T11:00:00Z' }]
      mock.onPut(`${ API_BASE }/organizers/${ ORGANIZER_KEY }/webinars/${ WEBINAR_KEY }`).reply({})

      await service.updateWebinar(WEBINAR_KEY, 'Subj', 'Desc', times, 'Europe/London', true, false)

      expect(mock.history[0].body).toMatchObject({
        subject: 'Subj',
        description: 'Desc',
        times,
        timeZone: 'Europe/London',
        isApprovalRequired: true,
      })
      expect(mock.history[0].query).toMatchObject({ notifyParticipants: false })
    })

    it('throws when webinarKey is missing', async () => {
      await expect(service.updateWebinar()).rejects.toThrow('Webinar is required')
    })
  })

  describe('cancelWebinar', () => {
    beforeEach(() => setToken())

    it('sends DELETE and returns cancelled result', async () => {
      mock.onDelete(`${ API_BASE }/organizers/${ ORGANIZER_KEY }/webinars/${ WEBINAR_KEY }`).reply({})

      const result = await service.cancelWebinar(WEBINAR_KEY, true)

      expect(result).toEqual({ cancelled: true, webinarKey: WEBINAR_KEY })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].query).toMatchObject({ sendCancellationEmails: true })
    })

    it('defaults sendCancellationEmails to false', async () => {
      mock.onDelete(`${ API_BASE }/organizers/${ ORGANIZER_KEY }/webinars/${ WEBINAR_KEY }`).reply({})

      await service.cancelWebinar(WEBINAR_KEY)

      expect(mock.history[0].query).toMatchObject({ sendCancellationEmails: false })
    })

    it('throws when webinarKey is missing', async () => {
      await expect(service.cancelWebinar()).rejects.toThrow('Webinar is required')
    })
  })

  // ── Registrants ──

  describe('getRegistrants', () => {
    beforeEach(() => setToken())

    it('sends correct GET request', async () => {
      const response = [{ registrantKey: REGISTRANT_KEY, firstName: 'Jane' }]
      mock.onGet(`${ API_BASE }/organizers/${ ORGANIZER_KEY }/webinars/${ WEBINAR_KEY }/registrants`).reply(response)

      const result = await service.getRegistrants(WEBINAR_KEY)

      expect(result).toEqual(response)
    })

    it('throws when webinarKey is missing', async () => {
      await expect(service.getRegistrants()).rejects.toThrow('Webinar is required')
    })
  })

  describe('getRegistrant', () => {
    beforeEach(() => setToken())

    it('sends correct GET request', async () => {
      const response = { registrantKey: REGISTRANT_KEY, firstName: 'Jane', lastName: 'Doe' }
      mock.onGet(`${ API_BASE }/organizers/${ ORGANIZER_KEY }/webinars/${ WEBINAR_KEY }/registrants/${ REGISTRANT_KEY }`).reply(response)

      const result = await service.getRegistrant(WEBINAR_KEY, REGISTRANT_KEY)

      expect(result).toEqual(response)
    })

    it('throws when webinarKey is missing', async () => {
      await expect(service.getRegistrant(null, REGISTRANT_KEY)).rejects.toThrow('Webinar is required')
    })

    it('throws when registrantKey is missing', async () => {
      await expect(service.getRegistrant(WEBINAR_KEY, null)).rejects.toThrow('Registrant Key is required')
    })
  })

  describe('createRegistrant', () => {
    beforeEach(() => setToken())

    const regUrl = `${ API_BASE }/organizers/${ ORGANIZER_KEY }/webinars/${ WEBINAR_KEY }/registrants`

    it('sends POST with required fields', async () => {
      const response = { registrantKey: REGISTRANT_KEY, joinUrl: 'https://join.url', status: 'APPROVED' }
      mock.onPost(regUrl).reply(response)

      const result = await service.createRegistrant(WEBINAR_KEY, 'Jane', 'Doe', 'jane@example.com')

      expect(result).toEqual(response)
      expect(mock.history[0].body).toEqual({ firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com' })
    })

    it('includes optional fields when provided', async () => {
      mock.onPost(regUrl).reply({ registrantKey: REGISTRANT_KEY })

      await service.createRegistrant(
        WEBINAR_KEY, 'Jane', 'Doe', 'jane@example.com',
        'Acme Corp', 'Engineer', '+1234567890', 'New York', 'NY', 'US',
        undefined, undefined
      )

      expect(mock.history[0].body).toMatchObject({
        organization: 'Acme Corp',
        jobTitle: 'Engineer',
        phone: '+1234567890',
        city: 'New York',
        state: 'NY',
        country: 'US',
      })
    })

    it('includes custom responses when provided', async () => {
      mock.onPost(regUrl).reply({ registrantKey: REGISTRANT_KEY })
      const responses = [{ questionKey: 'q1', responseText: 'Answer 1' }]

      await service.createRegistrant(
        WEBINAR_KEY, 'Jane', 'Doe', 'jane@example.com',
        undefined, undefined, undefined, undefined, undefined, undefined,
        responses, undefined
      )

      expect(mock.history[0].body.responses).toEqual(responses)
    })

    it('sets resendConfirmation query param when true', async () => {
      mock.onPost(regUrl).reply({ registrantKey: REGISTRANT_KEY })

      await service.createRegistrant(
        WEBINAR_KEY, 'Jane', 'Doe', 'jane@example.com',
        undefined, undefined, undefined, undefined, undefined, undefined,
        undefined, true
      )

      expect(mock.history[0].query).toMatchObject({ resendConfirmation: true })
    })

    it('throws when required fields are missing', async () => {
      await expect(service.createRegistrant()).rejects.toThrow('Webinar is required')
      await expect(service.createRegistrant(WEBINAR_KEY)).rejects.toThrow('First Name is required')
      await expect(service.createRegistrant(WEBINAR_KEY, 'Jane')).rejects.toThrow('Last Name is required')
      await expect(service.createRegistrant(WEBINAR_KEY, 'Jane', 'Doe')).rejects.toThrow('Email is required')
    })
  })

  describe('deleteRegistrant', () => {
    beforeEach(() => setToken())

    it('sends DELETE and returns result', async () => {
      mock.onDelete(`${ API_BASE }/organizers/${ ORGANIZER_KEY }/webinars/${ WEBINAR_KEY }/registrants/${ REGISTRANT_KEY }`).reply({})

      const result = await service.deleteRegistrant(WEBINAR_KEY, REGISTRANT_KEY)

      expect(result).toEqual({ deleted: true, registrantKey: REGISTRANT_KEY })
      expect(mock.history[0].method).toBe('delete')
    })

    it('throws when webinarKey is missing', async () => {
      await expect(service.deleteRegistrant(null, REGISTRANT_KEY)).rejects.toThrow('Webinar is required')
    })

    it('throws when registrantKey is missing', async () => {
      await expect(service.deleteRegistrant(WEBINAR_KEY, null)).rejects.toThrow('Registrant Key is required')
    })
  })

  // ── Attendees ──

  describe('getAttendees', () => {
    beforeEach(() => setToken())

    it('sends correct GET request', async () => {
      const response = [{ registrantKey: REGISTRANT_KEY, firstName: 'Jane' }]
      mock.onGet(`${ API_BASE }/organizers/${ ORGANIZER_KEY }/webinars/${ WEBINAR_KEY }/sessions/${ SESSION_KEY }/attendees`).reply(response)

      const result = await service.getAttendees(WEBINAR_KEY, SESSION_KEY)

      expect(result).toEqual(response)
    })

    it('throws when webinarKey is missing', async () => {
      await expect(service.getAttendees(null, SESSION_KEY)).rejects.toThrow('Webinar is required')
    })

    it('throws when sessionKey is missing', async () => {
      await expect(service.getAttendees(WEBINAR_KEY, null)).rejects.toThrow('Session Key is required')
    })
  })

  describe('getAttendee', () => {
    beforeEach(() => setToken())

    it('sends correct GET request', async () => {
      const response = { registrantKey: REGISTRANT_KEY, attendanceTimeInSeconds: 2700 }
      mock.onGet(`${ API_BASE }/organizers/${ ORGANIZER_KEY }/webinars/${ WEBINAR_KEY }/sessions/${ SESSION_KEY }/attendees/${ REGISTRANT_KEY }`).reply(response)

      const result = await service.getAttendee(WEBINAR_KEY, SESSION_KEY, REGISTRANT_KEY)

      expect(result).toEqual(response)
    })

    it('throws when any required param is missing', async () => {
      await expect(service.getAttendee(null, SESSION_KEY, REGISTRANT_KEY)).rejects.toThrow('Webinar is required')
      await expect(service.getAttendee(WEBINAR_KEY, null, REGISTRANT_KEY)).rejects.toThrow('Session Key is required')
      await expect(service.getAttendee(WEBINAR_KEY, SESSION_KEY, null)).rejects.toThrow('Registrant Key is required')
    })
  })

  // ── Sessions ──

  describe('getAllSessions', () => {
    beforeEach(() => setToken())

    it('sends correct GET request', async () => {
      const response = { _embedded: { webinarSessions: [{ sessionKey: SESSION_KEY }] } }
      mock.onGet(`${ API_BASE }/organizers/${ ORGANIZER_KEY }/webinars/${ WEBINAR_KEY }/sessions`).reply(response)

      const result = await service.getAllSessions(WEBINAR_KEY)

      expect(result).toEqual(response)
    })

    it('throws when webinarKey is missing', async () => {
      await expect(service.getAllSessions()).rejects.toThrow('Webinar is required')
    })
  })

  describe('getSessionPerformance', () => {
    beforeEach(() => setToken())

    it('sends correct GET request', async () => {
      const response = { attendance: { registrantCount: 20 } }
      mock.onGet(`${ API_BASE }/organizers/${ ORGANIZER_KEY }/webinars/${ WEBINAR_KEY }/sessions/${ SESSION_KEY }/performance`).reply(response)

      const result = await service.getSessionPerformance(WEBINAR_KEY, SESSION_KEY)

      expect(result).toEqual(response)
    })

    it('throws when required params are missing', async () => {
      await expect(service.getSessionPerformance(null, SESSION_KEY)).rejects.toThrow('Webinar is required')
      await expect(service.getSessionPerformance(WEBINAR_KEY, null)).rejects.toThrow('Session Key is required')
    })
  })

  describe('getSessionPolls', () => {
    beforeEach(() => setToken())

    it('sends correct GET request', async () => {
      const response = [{ question: 'How?' }]
      mock.onGet(`${ API_BASE }/organizers/${ ORGANIZER_KEY }/webinars/${ WEBINAR_KEY }/sessions/${ SESSION_KEY }/polls`).reply(response)

      const result = await service.getSessionPolls(WEBINAR_KEY, SESSION_KEY)

      expect(result).toEqual(response)
    })

    it('throws when required params are missing', async () => {
      await expect(service.getSessionPolls(null, SESSION_KEY)).rejects.toThrow('Webinar is required')
      await expect(service.getSessionPolls(WEBINAR_KEY, null)).rejects.toThrow('Session Key is required')
    })
  })

  describe('getSessionQuestions', () => {
    beforeEach(() => setToken())

    it('sends correct GET request', async () => {
      const response = [{ question: 'Will slides be shared?' }]
      mock.onGet(`${ API_BASE }/organizers/${ ORGANIZER_KEY }/webinars/${ WEBINAR_KEY }/sessions/${ SESSION_KEY }/questions`).reply(response)

      const result = await service.getSessionQuestions(WEBINAR_KEY, SESSION_KEY)

      expect(result).toEqual(response)
    })

    it('throws when required params are missing', async () => {
      await expect(service.getSessionQuestions(null, SESSION_KEY)).rejects.toThrow('Webinar is required')
      await expect(service.getSessionQuestions(WEBINAR_KEY, null)).rejects.toThrow('Session Key is required')
    })
  })

  describe('getSessionSurveys', () => {
    beforeEach(() => setToken())

    it('sends correct GET request', async () => {
      const response = [{ question: 'Satisfied?' }]
      mock.onGet(`${ API_BASE }/organizers/${ ORGANIZER_KEY }/webinars/${ WEBINAR_KEY }/sessions/${ SESSION_KEY }/surveys`).reply(response)

      const result = await service.getSessionSurveys(WEBINAR_KEY, SESSION_KEY)

      expect(result).toEqual(response)
    })

    it('throws when required params are missing', async () => {
      await expect(service.getSessionSurveys(null, SESSION_KEY)).rejects.toThrow('Webinar is required')
      await expect(service.getSessionSurveys(WEBINAR_KEY, null)).rejects.toThrow('Session Key is required')
    })
  })

  // ── Account ──

  describe('getAccountWebinars', () => {
    beforeEach(() => setToken())

    it('sends correct GET request to account endpoint', async () => {
      const response = { _embedded: { webinars: [] }, page: { size: 20, totalElements: 0 } }
      mock.onGet(`${ API_BASE }/accounts/${ ACCOUNT_KEY }/webinars`).reply(response)

      const result = await service.getAccountWebinars('2024-01-01T00:00:00Z', '2024-12-31T23:59:59Z')

      expect(result).toEqual(response)
      expect(mock.history[0].query).toMatchObject({
        fromTime: '2024-01-01T00:00:00Z',
        toTime: '2024-12-31T23:59:59Z',
        page: 0,
        size: 20,
      })
    })

    it('passes custom page and size', async () => {
      mock.onGet(`${ API_BASE }/accounts/${ ACCOUNT_KEY }/webinars`).reply({ _embedded: { webinars: [] } })

      await service.getAccountWebinars('2024-01-01T00:00:00Z', '2024-12-31T23:59:59Z', 3, 50)

      expect(mock.history[0].query).toMatchObject({ page: 3, size: 50 })
    })

    it('throws when fromTime is missing', async () => {
      await expect(service.getAccountWebinars(null, '2024-12-31T23:59:59Z')).rejects.toThrow('From Time is required')
    })

    it('throws when toTime is missing', async () => {
      await expect(service.getAccountWebinars('2024-01-01T00:00:00Z', null)).rejects.toThrow('To Time is required')
    })

    it('throws when accountKey is not available', async () => {
      // Set token without accountKey
      setToken(`${ ACCESS_TOKEN }::gtw::${ ORGANIZER_KEY }::gtw::`)

      await expect(
        service.getAccountWebinars('2024-01-01T00:00:00Z', '2024-12-31T23:59:59Z')
      ).rejects.toThrow('Account key is unavailable')
    })
  })

  // ── Dictionary ──

  describe('getWebinarsDictionary', () => {
    beforeEach(() => setToken())

    it('returns formatted items from upcoming webinars', async () => {
      const response = {
        _embedded: {
          webinars: [
            {
              webinarKey: '111',
              subject: 'Webinar A',
              times: [{ startTime: '2024-05-01T15:00:00Z' }],
              timeZone: 'America/New_York',
            },
            {
              webinarKey: '222',
              subject: 'Webinar B',
              times: [{ startTime: '2024-06-01T10:00:00Z' }],
              timeZone: 'UTC',
            },
          ],
        },
        page: { size: 20, totalElements: 2, totalPages: 1, number: 0 },
      }

      mock.onGet(`${ API_BASE }/organizers/${ ORGANIZER_KEY }/webinars`).reply(response)

      const result = await service.getWebinarsDictionary({})

      expect(result.items).toEqual([
        { label: 'Webinar A (2024-05-01T15:00:00Z)', value: '111', note: 'America/New_York' },
        { label: 'Webinar B (2024-06-01T10:00:00Z)', value: '222', note: 'UTC' },
      ])
      expect(result.cursor).toBeNull()
    })

    it('filters items by search term', async () => {
      const response = {
        _embedded: {
          webinars: [
            { webinarKey: '111', subject: 'Alpha Meeting', times: [], timeZone: 'UTC' },
            { webinarKey: '222', subject: 'Beta Session', times: [], timeZone: 'UTC' },
          ],
        },
        page: { size: 20, totalElements: 2, totalPages: 1, number: 0 },
      }
      mock.onGet(`${ API_BASE }/organizers/${ ORGANIZER_KEY }/webinars`).reply(response)

      const result = await service.getWebinarsDictionary({ search: 'beta' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('222')
    })

    it('returns cursor for next page when more pages exist', async () => {
      const response = {
        _embedded: {
          webinars: [{ webinarKey: '111', subject: 'W', times: [], timeZone: 'UTC' }],
        },
        page: { size: 20, totalElements: 30, totalPages: 2, number: 0 },
      }
      mock.onGet(`${ API_BASE }/organizers/${ ORGANIZER_KEY }/webinars`).reply(response)

      const result = await service.getWebinarsDictionary({})

      expect(result.cursor).toBe('1')
    })

    it('uses cursor as page number', async () => {
      const response = {
        _embedded: { webinars: [] },
        page: { size: 20, totalElements: 0, totalPages: 2, number: 1 },
      }
      mock.onGet(`${ API_BASE }/organizers/${ ORGANIZER_KEY }/webinars`).reply(response)

      await service.getWebinarsDictionary({ cursor: '1' })

      expect(mock.history[0].query).toMatchObject({ page: 1 })
    })

    it('handles empty payload', async () => {
      const response = { _embedded: { webinars: [] }, page: { size: 20, totalElements: 0, totalPages: 0, number: 0 } }
      mock.onGet(`${ API_BASE }/organizers/${ ORGANIZER_KEY }/webinars`).reply(response)

      const result = await service.getWebinarsDictionary()

      expect(result.items).toEqual([])
      expect(result.cursor).toBeNull()
    })
  })

  // ── Error Handling ──

  describe('error handling', () => {
    beforeEach(() => setToken())

    it('includes hint for 404 errors', async () => {
      mock.onGet(`${ API_BASE }/organizers/${ ORGANIZER_KEY }/webinars/${ WEBINAR_KEY }`).replyWithError({
        message: 'Not Found',
        body: { message: 'Webinar not found' },
        status: 404,
      })

      await expect(service.getWebinar(WEBINAR_KEY)).rejects.toThrow('Not found')
    })

    it('includes hint for 409 conflict errors', async () => {
      mock.onPost(`${ API_BASE }/organizers/${ ORGANIZER_KEY }/webinars/${ WEBINAR_KEY }/registrants`).replyWithError({
        message: 'Conflict',
        body: { message: 'Registrant already exists' },
        status: 409,
      })

      await expect(
        service.createRegistrant(WEBINAR_KEY, 'Jane', 'Doe', 'jane@example.com')
      ).rejects.toThrow('Conflict')
    })

    it('includes hint for 429 rate limit errors', async () => {
      mock.onGet(`${ API_BASE }/organizers/${ ORGANIZER_KEY }/webinars/${ WEBINAR_KEY }`).replyWithError({
        message: 'Too Many Requests',
        body: { message: 'Rate limited' },
        status: 429,
      })

      await expect(service.getWebinar(WEBINAR_KEY)).rejects.toThrow('Rate limit hit')
    })

    it('passes through error message when no hint matches', async () => {
      mock.onGet(`${ API_BASE }/organizers/${ ORGANIZER_KEY }/webinars/${ WEBINAR_KEY }`).replyWithError({
        message: 'Internal Server Error',
        body: { message: 'Something broke' },
        status: 500,
      })

      await expect(service.getWebinar(WEBINAR_KEY)).rejects.toThrow('Something broke')
    })
  })

  // ── Token Handling Edge Cases ──

  describe('token handling', () => {
    it('throws when access token is not set', async () => {
      service.request = { headers: {} }

      await expect(service.getWebinar(WEBINAR_KEY)).rejects.toThrow('Access token is not available')
    })

    it('throws when organizer key is missing from composite token', async () => {
      setToken(`${ ACCESS_TOKEN }::gtw::`)

      await expect(service.getWebinar(WEBINAR_KEY)).rejects.toThrow('Organizer key is unavailable')
    })
  })
})
