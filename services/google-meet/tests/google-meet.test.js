'use strict'

const { createSandbox } = require('../../../service-sandbox')

const CLIENT_ID = 'test-client-id'
const CLIENT_SECRET = 'test-client-secret'
const ACCESS_TOKEN = 'test-access-token'
const API_BASE = 'https://meet.googleapis.com/v2'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const OAUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const USER_INFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo'

describe('Google Meet Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET })
    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()

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
      const configs = sandbox.getConfigItems()

      expect(configs).toEqual(
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
      expect(url).toContain('meetings.space.created')
    })
  })

  describe('executeCallback', () => {
    it('exchanges code for tokens and fetches user info', async () => {
      const tokenResponse = {
        access_token: 'new-access-token',
        expires_in: 3600,
        refresh_token: 'new-refresh-token',
      }
      const userInfoResponse = {
        name: 'Jane Doe',
        email: 'jane@example.com',
        picture: 'https://example.com/photo.jpg',
      }

      mock.onPost(TOKEN_URL).reply(tokenResponse)
      mock.onGet(USER_INFO_URL).reply(userInfoResponse)

      const result = await service.executeCallback({
        code: 'auth-code',
        redirectURI: 'https://example.com/callback',
      })

      expect(result).toEqual({
        token: 'new-access-token',
        expirationInSeconds: 3600,
        refreshToken: 'new-refresh-token',
        connectionIdentityName: 'Jane Doe (jane@example.com)',
        connectionIdentityImageURL: 'https://example.com/photo.jpg',
        overwrite: true,
        userData: userInfoResponse,
      })

      // Verify token exchange request
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(TOKEN_URL)

      // Verify user info request has correct auth header
      expect(mock.history[1].method).toBe('get')
      expect(mock.history[1].url).toBe(USER_INFO_URL)
      expect(mock.history[1].headers).toMatchObject({
        Authorization: 'Bearer new-access-token',
      })
    })

    it('handles user info fetch failure gracefully', async () => {
      const tokenResponse = {
        access_token: 'new-access-token',
        expires_in: 3600,
        refresh_token: 'new-refresh-token',
      }

      mock.onPost(TOKEN_URL).reply(tokenResponse)
      mock.onGet(USER_INFO_URL).replyWithError({ message: 'Forbidden' })

      const result = await service.executeCallback({
        code: 'auth-code',
        redirectURI: 'https://example.com/callback',
      })

      expect(result.token).toBe('new-access-token')
      expect(result.connectionIdentityName).toBe('Google Meet Account')
      expect(result.connectionIdentityImageURL).toBeNull()
    })

    it('uses email only when name is missing', async () => {
      mock.onPost(TOKEN_URL).reply({
        access_token: 'tok',
        expires_in: 3600,
        refresh_token: 'rtok',
      })
      mock.onGet(USER_INFO_URL).reply({ email: 'jane@example.com' })

      const result = await service.executeCallback({
        code: 'code',
        redirectURI: 'https://example.com/callback',
      })

      expect(result.connectionIdentityName).toBe('jane@example.com')
    })
  })

  describe('refreshToken', () => {
    it('refreshes the access token', async () => {
      mock.onPost(TOKEN_URL).reply({
        access_token: 'refreshed-token',
        expires_in: 3600,
      })

      const result = await service.refreshToken('old-refresh-token')

      expect(result).toEqual({
        token: 'refreshed-token',
        expirationInSeconds: 3600,
      })

      expect(mock.history[0].query).toMatchObject({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: 'refresh_token',
        refresh_token: 'old-refresh-token',
      })
    })

    it('throws specific error on invalid_grant', async () => {
      mock.onPost(TOKEN_URL).replyWithError({
        message: 'Token has been revoked',
        body: { error: 'invalid_grant' },
      })

      await expect(service.refreshToken('bad-token'))
        .rejects.toThrow('Refresh token expired or invalid, please re-authenticate.')
    })

    it('re-throws other errors', async () => {
      mock.onPost(TOKEN_URL).replyWithError({
        message: 'Server Error',
        body: { error: 'server_error' },
      })

      await expect(service.refreshToken('token')).rejects.toThrow()
    })
  })

  // ── Dictionaries ──

  describe('getConferenceRecordsDictionary', () => {
    it('returns formatted dictionary items', async () => {
      mock.onGet(`${API_BASE}/conferenceRecords`).reply({
        conferenceRecords: [
          {
            name: 'conferenceRecords/abc-123',
            startTime: '2026-07-15T10:00:00Z',
            endTime: '2026-07-15T10:45:00Z',
            space: 'spaces/xyz',
          },
          {
            name: 'conferenceRecords/def-456',
            startTime: '2026-07-16T14:00:00Z',
            space: 'spaces/abc',
          },
        ],
        nextPageToken: 'page2',
      })

      const result = await service.getConferenceRecordsDictionary({})

      expect(result.cursor).toBe('page2')
      expect(result.items).toHaveLength(2)
      expect(result.items[0]).toEqual({
        label: '2026-07-15 10:00 UTC (Ended)',
        note: 'Space: spaces/xyz',
        value: 'conferenceRecords/abc-123',
      })
      expect(result.items[1].label).toContain('Ongoing')
    })

    it('filters results by search string', async () => {
      mock.onGet(`${API_BASE}/conferenceRecords`).reply({
        conferenceRecords: [
          { name: 'conferenceRecords/abc', startTime: '2026-07-15T10:00:00Z', space: 'spaces/xyz' },
          { name: 'conferenceRecords/def', startTime: '2026-07-16T10:00:00Z', space: 'spaces/other' },
        ],
      })

      const result = await service.getConferenceRecordsDictionary({ search: 'xyz' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('conferenceRecords/abc')
    })

    it('handles empty response', async () => {
      mock.onGet(`${API_BASE}/conferenceRecords`).reply({})

      const result = await service.getConferenceRecordsDictionary({})

      expect(result.items).toEqual([])
      expect(result.cursor).toBeUndefined()
    })

    it('passes cursor as pageToken', async () => {
      mock.onGet(`${API_BASE}/conferenceRecords`).reply({ conferenceRecords: [] })

      await service.getConferenceRecordsDictionary({ cursor: 'page2token' })

      expect(mock.history[0].query).toMatchObject({ pageToken: 'page2token' })
    })

    it('handles null payload', async () => {
      mock.onGet(`${API_BASE}/conferenceRecords`).reply({ conferenceRecords: [] })

      const result = await service.getConferenceRecordsDictionary(null)

      expect(result.items).toEqual([])
    })
  })

  // ── Meeting Spaces ──

  describe('createSpace', () => {
    it('creates a space with no config when no options provided', async () => {
      const spaceResponse = { name: 'spaces/abc', meetingUri: 'https://meet.google.com/abc-mnop-xyz' }

      mock.onPost(`${API_BASE}/spaces`).reply(spaceResponse)

      const result = await service.createSpace()

      expect(result).toEqual(spaceResponse)
      expect(mock.history[0].body).toEqual({})
      expect(mock.history[0].headers).toMatchObject({
        Authorization: `Bearer ${ACCESS_TOKEN}`,
      })
    })

    it('creates a space with access type and moderation settings', async () => {
      mock.onPost(`${API_BASE}/spaces`).reply({ name: 'spaces/abc' })

      await service.createSpace(
        'Trusted',         // accessType
        'All Entry Points', // entryPointAccess
        true,              // moderation
        'Hosts Only',      // chatRestriction
        'No Restriction',  // reactionRestriction
        undefined,         // presentRestriction
        true,              // defaultJoinAsViewer
        true,              // generateAttendanceReport
        true,              // autoRecording
        false,             // autoTranscription
        true               // autoSmartNotes
      )

      const body = mock.history[0].body

      expect(body.config.accessType).toBe('TRUSTED')
      expect(body.config.entryPointAccess).toBe('ALL')
      expect(body.config.moderation).toBe('ON')
      expect(body.config.moderationRestrictions.chatRestriction).toBe('HOSTS_ONLY')
      expect(body.config.moderationRestrictions.reactionRestriction).toBe('NO_RESTRICTION')
      expect(body.config.moderationRestrictions.defaultJoinAsViewerType).toBe('ON')
      expect(body.config.attendanceReportGenerationType).toBe('GENERATE_REPORT')
      expect(body.config.artifactConfig.recordingConfig.autoRecordingGeneration).toBe('ON')
      expect(body.config.artifactConfig.transcriptionConfig.autoTranscriptionGeneration).toBe('OFF')
      expect(body.config.artifactConfig.smartNotesConfig.autoSmartNotesGeneration).toBe('ON')
    })

    it('sets attendance report to DO_NOT_GENERATE when false', async () => {
      mock.onPost(`${API_BASE}/spaces`).reply({ name: 'spaces/abc' })

      await service.createSpace(undefined, undefined, undefined, undefined, undefined, undefined, undefined, false)

      expect(mock.history[0].body.config.attendanceReportGenerationType).toBe('DO_NOT_GENERATE')
    })

    it('throws on API error', async () => {
      mock.onPost(`${API_BASE}/spaces`).replyWithError({
        message: 'Forbidden',
        body: { error: { message: 'Insufficient permissions' } },
      })

      await expect(service.createSpace()).rejects.toThrow('Google Meet API error')
    })
  })

  describe('getSpace', () => {
    it('retrieves a space by resource name', async () => {
      const spaceData = { name: 'spaces/abc', meetingCode: 'abc-mnop-xyz' }

      mock.onGet(`${API_BASE}/spaces/abc`).reply(spaceData)

      const result = await service.getSpace('spaces/abc')

      expect(result).toEqual(spaceData)
    })

    it('normalizes a meeting code to resource name', async () => {
      mock.onGet(`${API_BASE}/spaces/abc-mnop-xyz`).reply({ name: 'spaces/abc-mnop-xyz' })

      await service.getSpace('abc-mnop-xyz')

      expect(mock.history[0].url).toBe(`${API_BASE}/spaces/abc-mnop-xyz`)
    })

    it('normalizes a full meeting link', async () => {
      mock.onGet(`${API_BASE}/spaces/abc-mnop-xyz`).reply({ name: 'spaces/abc-mnop-xyz' })

      await service.getSpace('https://meet.google.com/abc-mnop-xyz')

      expect(mock.history[0].url).toBe(`${API_BASE}/spaces/abc-mnop-xyz`)
    })

    it('throws when space is not provided', async () => {
      await expect(service.getSpace()).rejects.toThrow('"Meeting Space" is required')
    })
  })

  describe('updateSpace', () => {
    it('sends PATCH with config and updateMask', async () => {
      mock.onPatch(`${API_BASE}/spaces/abc`).reply({ name: 'spaces/abc' })

      await service.updateSpace('spaces/abc', 'Restricted')

      expect(mock.history[0].method).toBe('patch')
      expect(mock.history[0].body).toEqual({
        config: { accessType: 'RESTRICTED' },
      })
      expect(mock.history[0].query).toMatchObject({
        updateMask: 'config.accessType',
      })
    })

    it('builds combined updateMask for multiple fields', async () => {
      mock.onPatch(`${API_BASE}/spaces/abc`).reply({ name: 'spaces/abc' })

      await service.updateSpace('spaces/abc', 'Open', undefined, true, 'Hosts Only')

      const query = mock.history[0].query

      expect(query.updateMask).toContain('config.accessType')
      expect(query.updateMask).toContain('config.moderation')
      expect(query.updateMask).toContain('config.moderationRestrictions.chatRestriction')
    })

    it('throws when space is not provided', async () => {
      await expect(service.updateSpace()).rejects.toThrow('"Meeting Space" is required')
    })

    it('throws when no settings are provided', async () => {
      await expect(service.updateSpace('spaces/abc')).rejects.toThrow(
        'At least one configuration setting must be provided'
      )
    })
  })

  describe('endActiveConference', () => {
    it('sends POST to end conference and returns success object', async () => {
      mock.onPost(`${API_BASE}/spaces/abc:endActiveConference`).reply({})

      const result = await service.endActiveConference('spaces/abc')

      expect(result).toEqual({
        success: true,
        message: 'Active conference ended successfully',
        space: 'spaces/abc',
      })
      expect(mock.history[0].body).toEqual({})
    })

    it('normalizes meeting code input', async () => {
      mock.onPost(`${API_BASE}/spaces/abc-mnop-xyz:endActiveConference`).reply({})

      await service.endActiveConference('abc-mnop-xyz')

      expect(mock.history[0].url).toBe(`${API_BASE}/spaces/abc-mnop-xyz:endActiveConference`)
    })

    it('throws when space is not provided', async () => {
      await expect(service.endActiveConference()).rejects.toThrow('"Meeting Space" is required')
    })
  })

  // ── Conference Records ──

  describe('listConferenceRecords', () => {
    it('lists records with no filters', async () => {
      const response = {
        conferenceRecords: [{ name: 'conferenceRecords/abc' }],
        nextPageToken: 'token2',
      }

      mock.onGet(`${API_BASE}/conferenceRecords`).reply(response)

      const result = await service.listConferenceRecords()

      expect(result).toEqual(response)
    })

    it('builds filter for spaceName', async () => {
      mock.onGet(`${API_BASE}/conferenceRecords`).reply({ conferenceRecords: [] })

      await service.listConferenceRecords('spaces/xyz')

      expect(mock.history[0].query.filter).toContain('space.name = "spaces/xyz"')
    })

    it('builds filter for meetingCode and strips URL prefix', async () => {
      mock.onGet(`${API_BASE}/conferenceRecords`).reply({ conferenceRecords: [] })

      await service.listConferenceRecords(null, 'https://meet.google.com/abc-mnop-xyz')

      expect(mock.history[0].query.filter).toContain('space.meeting_code = "abc-mnop-xyz"')
    })

    it('builds time range filters', async () => {
      mock.onGet(`${API_BASE}/conferenceRecords`).reply({ conferenceRecords: [] })

      await service.listConferenceRecords(null, null, '2026-07-01', '2026-07-15')

      const filter = mock.history[0].query.filter

      expect(filter).toContain('start_time>="2026-07-01T00:00:00Z"')
      expect(filter).toContain('start_time<="2026-07-15T23:59:59Z"')
    })

    it('builds filter for ongoingOnly', async () => {
      mock.onGet(`${API_BASE}/conferenceRecords`).reply({ conferenceRecords: [] })

      await service.listConferenceRecords(null, null, null, null, true)

      expect(mock.history[0].query.filter).toContain('end_time IS NULL')
    })

    it('combines multiple filters with AND', async () => {
      mock.onGet(`${API_BASE}/conferenceRecords`).reply({ conferenceRecords: [] })

      await service.listConferenceRecords('spaces/xyz', null, null, null, true)

      const filter = mock.history[0].query.filter

      expect(filter).toContain(' AND ')
      expect(filter).toContain('space.name')
      expect(filter).toContain('end_time IS NULL')
    })

    it('passes pageSize and pageToken', async () => {
      mock.onGet(`${API_BASE}/conferenceRecords`).reply({ conferenceRecords: [] })

      await service.listConferenceRecords(null, null, null, null, null, 10, 'page2')

      expect(mock.history[0].query).toMatchObject({
        pageSize: 10,
        pageToken: 'page2',
      })
    })

    it('passes RFC3339 timestamps through unchanged', async () => {
      mock.onGet(`${API_BASE}/conferenceRecords`).reply({ conferenceRecords: [] })

      await service.listConferenceRecords(null, null, '2026-07-01T12:00:00Z', '2026-07-15T23:59:59+02:00')

      const filter = mock.history[0].query.filter

      expect(filter).toContain('start_time>="2026-07-01T12:00:00Z"')
      expect(filter).toContain('start_time<="2026-07-15T23:59:59+02:00"')
    })
  })

  describe('getConferenceRecord', () => {
    it('retrieves a conference record by full name', async () => {
      const record = { name: 'conferenceRecords/abc-123', startTime: '2026-07-15T10:00:00Z' }

      mock.onGet(`${API_BASE}/conferenceRecords/abc-123`).reply(record)

      const result = await service.getConferenceRecord('conferenceRecords/abc-123')

      expect(result).toEqual(record)
    })

    it('normalizes bare record ID', async () => {
      mock.onGet(`${API_BASE}/conferenceRecords/abc-123`).reply({})

      await service.getConferenceRecord('abc-123')

      expect(mock.history[0].url).toBe(`${API_BASE}/conferenceRecords/abc-123`)
    })

    it('throws when conferenceRecord is not provided', async () => {
      await expect(service.getConferenceRecord()).rejects.toThrow('"Conference Record" is required')
    })
  })

  // ── Participants ──

  describe('listParticipants', () => {
    it('lists participants for a conference', async () => {
      const response = {
        participants: [{ name: 'conferenceRecords/abc/participants/1001' }],
        nextPageToken: 'next',
      }

      mock.onGet(`${API_BASE}/conferenceRecords/abc/participants`).reply(response)

      const result = await service.listParticipants('conferenceRecords/abc')

      expect(result).toEqual(response)
    })

    it('filters for active participants only', async () => {
      mock.onGet(`${API_BASE}/conferenceRecords/abc/participants`).reply({ participants: [] })

      await service.listParticipants('conferenceRecords/abc', true)

      expect(mock.history[0].query.filter).toBe('latest_end_time IS NULL')
    })

    it('passes pageSize and pageToken', async () => {
      mock.onGet(`${API_BASE}/conferenceRecords/abc/participants`).reply({ participants: [] })

      await service.listParticipants('conferenceRecords/abc', false, 50, 'page2')

      expect(mock.history[0].query).toMatchObject({ pageSize: 50, pageToken: 'page2' })
    })

    it('throws when conferenceRecord is not provided', async () => {
      await expect(service.listParticipants()).rejects.toThrow('"Conference Record" is required')
    })
  })

  describe('getParticipant', () => {
    it('retrieves a participant by bare ID', async () => {
      const participant = { name: 'conferenceRecords/abc/participants/1001' }

      mock.onGet(`${API_BASE}/conferenceRecords/abc/participants/1001`).reply(participant)

      const result = await service.getParticipant('conferenceRecords/abc', '1001')

      expect(result).toEqual(participant)
    })

    it('handles full participant resource name', async () => {
      mock.onGet(`${API_BASE}/conferenceRecords/abc/participants/1001`).reply({})

      await service.getParticipant('conferenceRecords/abc', 'conferenceRecords/abc/participants/1001')

      expect(mock.history[0].url).toBe(`${API_BASE}/conferenceRecords/abc/participants/1001`)
    })

    it('throws when conferenceRecord is missing', async () => {
      await expect(service.getParticipant(null, '1001')).rejects.toThrow('"Conference Record" is required')
    })

    it('throws when participantId is missing', async () => {
      await expect(service.getParticipant('conferenceRecords/abc')).rejects.toThrow('"Participant ID" is required')
    })
  })

  describe('listParticipantSessions', () => {
    it('lists sessions for a participant', async () => {
      const response = {
        participantSessions: [{ name: 'conferenceRecords/abc/participants/1001/participantSessions/2001' }],
      }

      mock.onGet(`${API_BASE}/conferenceRecords/abc/participants/1001/participantSessions`).reply(response)

      const result = await service.listParticipantSessions('conferenceRecords/abc', '1001')

      expect(result).toEqual(response)
    })

    it('passes pageSize and pageToken', async () => {
      mock.onGet(`${API_BASE}/conferenceRecords/abc/participants/1001/participantSessions`).reply({})

      await service.listParticipantSessions('conferenceRecords/abc', '1001', 25, 'next')

      expect(mock.history[0].query).toMatchObject({ pageSize: 25, pageToken: 'next' })
    })

    it('throws when conferenceRecord is missing', async () => {
      await expect(service.listParticipantSessions(null, '1001')).rejects.toThrow('"Conference Record" is required')
    })

    it('throws when participantId is missing', async () => {
      await expect(service.listParticipantSessions('conferenceRecords/abc')).rejects.toThrow('"Participant ID" is required')
    })
  })

  describe('getParticipantSession', () => {
    it('retrieves a session by bare IDs', async () => {
      const session = { name: 'conferenceRecords/abc/participants/1001/participantSessions/2001' }

      mock.onGet(`${API_BASE}/conferenceRecords/abc/participants/1001/participantSessions/2001`).reply(session)

      const result = await service.getParticipantSession('conferenceRecords/abc', '1001', '2001')

      expect(result).toEqual(session)
    })

    it('handles full session resource name', async () => {
      const fullName = 'conferenceRecords/abc/participants/1001/participantSessions/2001'

      mock.onGet(`${API_BASE}/${fullName}`).reply({})

      await service.getParticipantSession('conferenceRecords/abc', '1001', fullName)

      expect(mock.history[0].url).toBe(`${API_BASE}/${fullName}`)
    })

    it('throws when conferenceRecord is missing', async () => {
      await expect(service.getParticipantSession(null, '1001', '2001'))
        .rejects.toThrow('"Conference Record" is required')
    })

    it('throws when participantId is missing', async () => {
      await expect(service.getParticipantSession('conferenceRecords/abc', null, '2001'))
        .rejects.toThrow('"Participant ID" is required')
    })

    it('throws when sessionId is missing', async () => {
      await expect(service.getParticipantSession('conferenceRecords/abc', '1001'))
        .rejects.toThrow('"Session ID" is required')
    })
  })

  // ── Recordings ──

  describe('listRecordings', () => {
    it('lists recordings for a conference', async () => {
      const response = {
        recordings: [{ name: 'conferenceRecords/abc/recordings/rec-001', state: 'FILE_GENERATED' }],
      }

      mock.onGet(`${API_BASE}/conferenceRecords/abc/recordings`).reply(response)

      const result = await service.listRecordings('conferenceRecords/abc')

      expect(result).toEqual(response)
    })

    it('passes pageSize and pageToken', async () => {
      mock.onGet(`${API_BASE}/conferenceRecords/abc/recordings`).reply({})

      await service.listRecordings('conferenceRecords/abc', 5, 'next')

      expect(mock.history[0].query).toMatchObject({ pageSize: 5, pageToken: 'next' })
    })

    it('normalizes bare conference record ID', async () => {
      mock.onGet(`${API_BASE}/conferenceRecords/abc/recordings`).reply({})

      await service.listRecordings('abc')

      expect(mock.history[0].url).toBe(`${API_BASE}/conferenceRecords/abc/recordings`)
    })

    it('throws when conferenceRecord is missing', async () => {
      await expect(service.listRecordings()).rejects.toThrow('"Conference Record" is required')
    })
  })

  describe('getRecording', () => {
    it('retrieves a recording by bare ID', async () => {
      const recording = { name: 'conferenceRecords/abc/recordings/rec-001', state: 'FILE_GENERATED' }

      mock.onGet(`${API_BASE}/conferenceRecords/abc/recordings/rec-001`).reply(recording)

      const result = await service.getRecording('conferenceRecords/abc', 'rec-001')

      expect(result).toEqual(recording)
    })

    it('handles full recording resource name', async () => {
      mock.onGet(`${API_BASE}/conferenceRecords/abc/recordings/rec-001`).reply({})

      await service.getRecording('conferenceRecords/abc', 'conferenceRecords/abc/recordings/rec-001')

      expect(mock.history[0].url).toBe(`${API_BASE}/conferenceRecords/abc/recordings/rec-001`)
    })

    it('throws when conferenceRecord is missing', async () => {
      await expect(service.getRecording(null, 'rec-001')).rejects.toThrow('"Conference Record" is required')
    })

    it('throws when recordingId is missing', async () => {
      await expect(service.getRecording('conferenceRecords/abc')).rejects.toThrow('"Recording ID" is required')
    })
  })

  // ── Transcripts ──

  describe('listTranscripts', () => {
    it('lists transcripts for a conference', async () => {
      const response = {
        transcripts: [{ name: 'conferenceRecords/abc/transcripts/tr-001', state: 'FILE_GENERATED' }],
      }

      mock.onGet(`${API_BASE}/conferenceRecords/abc/transcripts`).reply(response)

      const result = await service.listTranscripts('conferenceRecords/abc')

      expect(result).toEqual(response)
    })

    it('passes pageSize and pageToken', async () => {
      mock.onGet(`${API_BASE}/conferenceRecords/abc/transcripts`).reply({})

      await service.listTranscripts('conferenceRecords/abc', 5, 'next')

      expect(mock.history[0].query).toMatchObject({ pageSize: 5, pageToken: 'next' })
    })

    it('throws when conferenceRecord is missing', async () => {
      await expect(service.listTranscripts()).rejects.toThrow('"Conference Record" is required')
    })
  })

  describe('getTranscript', () => {
    it('retrieves a transcript by bare ID', async () => {
      const transcript = { name: 'conferenceRecords/abc/transcripts/tr-001' }

      mock.onGet(`${API_BASE}/conferenceRecords/abc/transcripts/tr-001`).reply(transcript)

      const result = await service.getTranscript('conferenceRecords/abc', 'tr-001')

      expect(result).toEqual(transcript)
    })

    it('handles full transcript resource name', async () => {
      mock.onGet(`${API_BASE}/conferenceRecords/abc/transcripts/tr-001`).reply({})

      await service.getTranscript('conferenceRecords/abc', 'conferenceRecords/abc/transcripts/tr-001')

      expect(mock.history[0].url).toBe(`${API_BASE}/conferenceRecords/abc/transcripts/tr-001`)
    })

    it('throws when conferenceRecord is missing', async () => {
      await expect(service.getTranscript(null, 'tr-001')).rejects.toThrow('"Conference Record" is required')
    })

    it('throws when transcriptId is missing', async () => {
      await expect(service.getTranscript('conferenceRecords/abc')).rejects.toThrow('"Transcript ID" is required')
    })
  })

  describe('listTranscriptEntries', () => {
    it('lists entries for a transcript', async () => {
      const response = {
        transcriptEntries: [
          { name: 'conferenceRecords/abc/transcripts/tr-001/entries/en-001', text: 'Hello' },
        ],
      }

      mock.onGet(`${API_BASE}/conferenceRecords/abc/transcripts/tr-001/entries`).reply(response)

      const result = await service.listTranscriptEntries('conferenceRecords/abc', 'tr-001')

      expect(result).toEqual(response)
    })

    it('passes pageSize and pageToken', async () => {
      mock.onGet(`${API_BASE}/conferenceRecords/abc/transcripts/tr-001/entries`).reply({})

      await service.listTranscriptEntries('conferenceRecords/abc', 'tr-001', 25, 'next')

      expect(mock.history[0].query).toMatchObject({ pageSize: 25, pageToken: 'next' })
    })

    it('throws when conferenceRecord is missing', async () => {
      await expect(service.listTranscriptEntries(null, 'tr-001')).rejects.toThrow('"Conference Record" is required')
    })

    it('throws when transcriptId is missing', async () => {
      await expect(service.listTranscriptEntries('conferenceRecords/abc')).rejects.toThrow('"Transcript ID" is required')
    })
  })

  describe('getTranscriptEntry', () => {
    it('retrieves a transcript entry by bare IDs', async () => {
      const entry = {
        name: 'conferenceRecords/abc/transcripts/tr-001/entries/en-001',
        text: 'Hello',
      }

      mock.onGet(`${API_BASE}/conferenceRecords/abc/transcripts/tr-001/entries/en-001`).reply(entry)

      const result = await service.getTranscriptEntry('conferenceRecords/abc', 'tr-001', 'en-001')

      expect(result).toEqual(entry)
    })

    it('handles full entry resource name', async () => {
      const fullName = 'conferenceRecords/abc/transcripts/tr-001/entries/en-001'

      mock.onGet(`${API_BASE}/${fullName}`).reply({})

      await service.getTranscriptEntry('conferenceRecords/abc', 'tr-001', fullName)

      expect(mock.history[0].url).toBe(`${API_BASE}/${fullName}`)
    })

    it('throws when conferenceRecord is missing', async () => {
      await expect(service.getTranscriptEntry(null, 'tr-001', 'en-001'))
        .rejects.toThrow('"Conference Record" is required')
    })

    it('throws when transcriptId is missing', async () => {
      await expect(service.getTranscriptEntry('conferenceRecords/abc', null, 'en-001'))
        .rejects.toThrow('"Transcript ID" is required')
    })

    it('throws when entryId is missing', async () => {
      await expect(service.getTranscriptEntry('conferenceRecords/abc', 'tr-001'))
        .rejects.toThrow('"Entry ID" is required')
    })
  })

  describe('getFullTranscriptText', () => {
    it('assembles full transcript with resolved speaker names', async () => {
      // Participants response (single page)
      mock.onGet(`${API_BASE}/conferenceRecords/abc/participants`).reply({
        participants: [
          {
            name: 'conferenceRecords/abc/participants/1001',
            signedinUser: { displayName: 'Jane Doe' },
          },
          {
            name: 'conferenceRecords/abc/participants/1002',
            anonymousUser: { displayName: 'Guest' },
          },
        ],
      })

      // Entries response (single page)
      mock.onGet(`${API_BASE}/conferenceRecords/abc/transcripts/tr-001/entries`).reply({
        transcriptEntries: [
          {
            participant: 'conferenceRecords/abc/participants/1001',
            text: 'Good morning.',
            startTime: '2026-07-15T10:01:00Z',
          },
          {
            participant: 'conferenceRecords/abc/participants/1002',
            text: 'Hello!',
            startTime: '2026-07-15T10:01:05Z',
          },
        ],
      })

      const result = await service.getFullTranscriptText('conferenceRecords/abc', 'tr-001')

      expect(result.transcript).toBe('conferenceRecords/abc/transcripts/tr-001')
      expect(result.entryCount).toBe(2)
      expect(result.truncated).toBe(false)
      expect(result.text).toBe('Jane Doe: Good morning.\nGuest: Hello!')
    })

    it('includes timestamps when requested', async () => {
      mock.onGet(`${API_BASE}/conferenceRecords/abc/participants`).reply({ participants: [] })
      mock.onGet(`${API_BASE}/conferenceRecords/abc/transcripts/tr-001/entries`).reply({
        transcriptEntries: [
          {
            participant: 'conferenceRecords/abc/participants/1001',
            text: 'Hello.',
            startTime: '2026-07-15T10:01:00Z',
          },
        ],
      })

      const result = await service.getFullTranscriptText('conferenceRecords/abc', 'tr-001', true)

      expect(result.text).toBe('[2026-07-15T10:01:00Z] 1001: Hello.')
    })

    it('falls back to participant ID for unknown speakers', async () => {
      mock.onGet(`${API_BASE}/conferenceRecords/abc/participants`).reply({ participants: [] })
      mock.onGet(`${API_BASE}/conferenceRecords/abc/transcripts/tr-001/entries`).reply({
        transcriptEntries: [
          {
            participant: 'conferenceRecords/abc/participants/9999',
            text: 'Hi.',
          },
        ],
      })

      const result = await service.getFullTranscriptText('conferenceRecords/abc', 'tr-001')

      expect(result.text).toBe('9999: Hi.')
    })

    it('paginates through multiple pages of entries', async () => {
      mock.onGet(`${API_BASE}/conferenceRecords/abc/participants`).reply({ participants: [] })

      // First call returns page 1 with nextPageToken
      let callCount = 0

      mock.onGet(`${API_BASE}/conferenceRecords/abc/transcripts/tr-001/entries`).replyWith(() => {
        callCount++
        if (callCount === 1) {
          return {
            transcriptEntries: [{ participant: 'conferenceRecords/abc/participants/1', text: 'Page 1' }],
            nextPageToken: 'page2',
          }
        }

        return {
          transcriptEntries: [{ participant: 'conferenceRecords/abc/participants/1', text: 'Page 2' }],
        }
      })

      const result = await service.getFullTranscriptText('conferenceRecords/abc', 'tr-001')

      expect(result.entryCount).toBe(2)
      expect(result.text).toBe('1: Page 1\n1: Page 2')
    })

    it('paginates through participants', async () => {
      let participantCallCount = 0

      mock.onGet(`${API_BASE}/conferenceRecords/abc/participants`).replyWith(() => {
        participantCallCount++
        if (participantCallCount === 1) {
          return {
            participants: [
              { name: 'conferenceRecords/abc/participants/1', signedinUser: { displayName: 'Alice' } },
            ],
            nextPageToken: 'ppage2',
          }
        }

        return {
          participants: [
            { name: 'conferenceRecords/abc/participants/2', signedinUser: { displayName: 'Bob' } },
          ],
        }
      })

      mock.onGet(`${API_BASE}/conferenceRecords/abc/transcripts/tr-001/entries`).reply({
        transcriptEntries: [
          { participant: 'conferenceRecords/abc/participants/1', text: 'Hi' },
          { participant: 'conferenceRecords/abc/participants/2', text: 'Hey' },
        ],
      })

      const result = await service.getFullTranscriptText('conferenceRecords/abc', 'tr-001')

      expect(result.text).toBe('Alice: Hi\nBob: Hey')
    })

    it('handles phone user display names', async () => {
      mock.onGet(`${API_BASE}/conferenceRecords/abc/participants`).reply({
        participants: [
          {
            name: 'conferenceRecords/abc/participants/3',
            phoneUser: { displayName: '+1-555-0100' },
          },
        ],
      })

      mock.onGet(`${API_BASE}/conferenceRecords/abc/transcripts/tr-001/entries`).reply({
        transcriptEntries: [
          { participant: 'conferenceRecords/abc/participants/3', text: 'Calling in.' },
        ],
      })

      const result = await service.getFullTranscriptText('conferenceRecords/abc', 'tr-001')

      expect(result.text).toBe('+1-555-0100: Calling in.')
    })

    it('handles empty transcript', async () => {
      mock.onGet(`${API_BASE}/conferenceRecords/abc/participants`).reply({ participants: [] })
      mock.onGet(`${API_BASE}/conferenceRecords/abc/transcripts/tr-001/entries`).reply({})

      const result = await service.getFullTranscriptText('conferenceRecords/abc', 'tr-001')

      expect(result.entryCount).toBe(0)
      expect(result.text).toBe('')
      expect(result.truncated).toBe(false)
    })

    it('throws when conferenceRecord is missing', async () => {
      await expect(service.getFullTranscriptText(null, 'tr-001'))
        .rejects.toThrow('"Conference Record" is required')
    })

    it('throws when transcriptId is missing', async () => {
      await expect(service.getFullTranscriptText('conferenceRecords/abc'))
        .rejects.toThrow('"Transcript ID" is required')
    })
  })
})
