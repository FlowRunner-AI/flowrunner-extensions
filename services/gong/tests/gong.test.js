'use strict'

const { createSandbox } = require('../../../service-sandbox')

const ACCESS_KEY = 'test-access-key'
const ACCESS_KEY_SECRET = 'test-secret'
// Basic-auth token = base64("test-access-key:test-secret")
const BASIC_TOKEN = Buffer.from(`${ ACCESS_KEY }:${ ACCESS_KEY_SECRET }`).toString('base64')
const AUTH_HEADER = `Basic ${ BASIC_TOKEN }`
const BASE = 'https://api.gong.io'

describe('Gong Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ accessKey: ACCESS_KEY, accessKeySecret: ACCESS_KEY_SECRET })
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

  // ── Registration & Auth ──────────────────────────────────────────────────

  describe('service registration', () => {
    it('registers with the two Basic-auth config items in order', () => {
      expect(sandbox.getConfigItems()).toEqual([
        expect.objectContaining({
          name: 'accessKey',
          displayName: 'Access Key',
          required: true,
          shared: false,
          type: 'STRING',
        }),
        expect.objectContaining({
          name: 'accessKeySecret',
          displayName: 'Access Key Secret',
          required: true,
          shared: false,
          type: 'STRING',
        }),
      ])
    })

    it('sends the Basic-auth + JSON content-type headers on requests', async () => {
      mock.onGet(`${ BASE }/v2/workspaces`).reply({ workspaces: [] })

      await service.listWorkspaces()

      expect(mock.history[0].headers).toMatchObject({
        Authorization: AUTH_HEADER,
        'Content-Type': 'application/json',
      })
    })

    it('encodes accessKey:accessKeySecret as base64 in the Basic-auth header', async () => {
      mock.onGet(`${ BASE }/v2/workspaces`).reply({ workspaces: [] })

      await service.listWorkspaces()

      const sent = mock.history[0].headers.Authorization
      const decoded = Buffer.from(sent.replace('Basic ', ''), 'base64').toString('utf8')
      expect(decoded).toBe(`${ ACCESS_KEY }:${ ACCESS_KEY_SECRET }`)
    })
  })

  // ── CALLS ────────────────────────────────────────────────────────────────

  describe('listCalls', () => {
    it('sends a GET with only the required fromDateTime (clean query drops empties)', async () => {
      mock.onGet(`${ BASE }/v2/calls`).reply({ calls: [], records: { cursor: null } })

      const result = await service.listCalls('2025-01-01T00:00:00Z')

      expect(result).toEqual({ calls: [], records: { cursor: null } })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/v2/calls`)
      expect(mock.history[0].query).toEqual({ fromDateTime: '2025-01-01T00:00:00Z' })
    })

    it('includes all optional query params when provided', async () => {
      mock.onGet(`${ BASE }/v2/calls`).reply({ calls: [] })

      await service.listCalls('2025-01-01T00:00:00Z', '2025-02-01T00:00:00Z', 'ws-1', 'cur-2')

      expect(mock.history[0].query).toEqual({
        fromDateTime: '2025-01-01T00:00:00Z',
        toDateTime: '2025-02-01T00:00:00Z',
        workspaceId: 'ws-1',
        cursor: 'cur-2',
      })
    })

    it('throws when fromDateTime is missing (before any request)', async () => {
      await expect(service.listCalls()).rejects.toThrow('From Date/Time is required')
      expect(mock.history).toHaveLength(0)
    })

    it('surfaces the friendly 401 hint on an auth error', async () => {
      mock.onGet(`${ BASE }/v2/calls`).replyWithError({ status: 401, body: { errors: ['bad key'] } })

      await expect(service.listCalls('2025-01-01T00:00:00Z')).rejects.toThrow(/Authentication failed/)
    })
  })

  describe('getCall', () => {
    it('URL-encodes the call id into the path', async () => {
      mock.onGet(`${ BASE }/v2/calls/abc%2F123`).reply({ call: { id: 'abc/123' } })

      const result = await service.getCall('abc/123')

      expect(result).toEqual({ call: { id: 'abc/123' } })
      expect(mock.history[0].url).toBe(`${ BASE }/v2/calls/abc%2F123`)
      expect(mock.history[0].method).toBe('get')
    })

    it('throws when callId is missing', async () => {
      await expect(service.getCall()).rejects.toThrow('Call is required')
      expect(mock.history).toHaveLength(0)
    })
  })

  describe('addCall', () => {
    it('builds the minimal body and auto-adds the primary user as a party', async () => {
      mock.onPost(`${ BASE }/v2/calls`).reply({ callId: 'c-1' })

      const result = await service.addCall(
        'client-ref-1',
        '2025-01-01T00:00:00Z',
        'user-1',
        'Inbound',
        [{ name: 'Ext Person', emailAddress: 'ext@example.com' }]
      )

      expect(result).toEqual({ callId: 'c-1' })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/v2/calls`)
      expect(mock.history[0].body).toEqual({
        clientUniqueId: 'client-ref-1',
        actualStart: '2025-01-01T00:00:00Z',
        primaryUser: 'user-1',
        direction: 'Inbound',
        parties: [
          { name: 'Ext Person', emailAddress: 'ext@example.com' },
          { userId: 'user-1' },
        ],
      })
    })

    it('does not duplicate the primary user when already listed as a party', async () => {
      mock.onPost(`${ BASE }/v2/calls`).reply({ callId: 'c-2' })

      await service.addCall(
        'client-ref-2',
        '2025-01-01T00:00:00Z',
        'user-1',
        'Outbound',
        [{ userId: 'user-1' }]
      )

      expect(mock.history[0].body.parties).toEqual([{ userId: 'user-1' }])
    })

    it('includes all optional fields and coerces duration to a Number', async () => {
      mock.onPost(`${ BASE }/v2/calls`).reply({ callId: 'c-3' })

      await service.addCall(
        'client-ref-3',
        '2025-01-01T00:00:00Z',
        'user-1',
        'Conference',
        [{ userId: 'user-1' }],
        'My Title',
        'https://media.example.com/rec.mp3',
        'clearslide',
        '120'
      )

      expect(mock.history[0].body).toMatchObject({
        title: 'My Title',
        downloadMediaUrl: 'https://media.example.com/rec.mp3',
        callProviderCode: 'clearslide',
        duration: 120,
      })
      expect(typeof mock.history[0].body.duration).toBe('number')
    })

    it('throws on each missing required field', async () => {
      await expect(service.addCall()).rejects.toThrow('Client Unique ID is required')
      await expect(service.addCall('r')).rejects.toThrow('Actual Start is required')
      await expect(service.addCall('r', 't')).rejects.toThrow('Primary User is required')
      await expect(service.addCall('r', 't', 'u')).rejects.toThrow('Direction is required')
      await expect(service.addCall('r', 't', 'u', 'Inbound', [])).rejects.toThrow('At least one party is required')
      expect(mock.history).toHaveLength(0)
    })
  })

  describe('getExtensiveCallData', () => {
    it('builds the filter from a comma-separated Call IDs string and default content selector', async () => {
      mock.onPost(`${ BASE }/v2/calls/extensive`).reply({ calls: [] })

      await service.getExtensiveCallData('c1, c2 ,c3')

      expect(mock.history[0].url).toBe(`${ BASE }/v2/calls/extensive`)
      expect(mock.history[0].body).toEqual({
        filter: { callIds: ['c1', 'c2', 'c3'] },
        contentSelector: {
          context: 'Extended',
          contextTiming: ['Now', 'TimeOfCall'],
          exposedFields: {},
        },
      })
    })

    it('toggles content, media, parties exposed fields and passes a date range + cursor', async () => {
      mock.onPost(`${ BASE }/v2/calls/extensive`).reply({ calls: [] })

      await service.getExtensiveCallData(
        undefined,
        '2025-01-01T00:00:00Z',
        '2025-02-01T00:00:00Z',
        'ws-1',
        true,
        true,
        true,
        'cur-1'
      )

      const body = mock.history[0].body
      expect(body.filter).toEqual({
        fromDateTime: '2025-01-01T00:00:00Z',
        toDateTime: '2025-02-01T00:00:00Z',
        workspaceId: 'ws-1',
      })
      expect(body.contentSelector.exposedFields.content).toMatchObject({ topics: true, brief: true, keyPoints: true })
      expect(body.contentSelector.exposedFields.media).toBe(true)
      expect(body.contentSelector.exposedFields.parties).toBe(true)
      expect(body.cursor).toBe('cur-1')
    })

    it('throws when neither Call IDs nor From Date/Time is provided', async () => {
      await expect(service.getExtensiveCallData()).rejects.toThrow(/Provide either Call IDs or a From Date\/Time/)
      expect(mock.history).toHaveLength(0)
    })
  })

  describe('getCallTranscripts', () => {
    it('accepts an array of Call IDs and posts to the transcript endpoint', async () => {
      mock.onPost(`${ BASE }/v2/calls/transcript`).reply({ callTranscripts: [] })

      const result = await service.getCallTranscripts(['c1', 'c2'])

      expect(result).toEqual({ callTranscripts: [] })
      expect(mock.history[0].url).toBe(`${ BASE }/v2/calls/transcript`)
      expect(mock.history[0].body).toEqual({ filter: { callIds: ['c1', 'c2'] } })
    })

    it('uses a date-range filter with workspace and cursor when no ids given', async () => {
      mock.onPost(`${ BASE }/v2/calls/transcript`).reply({ callTranscripts: [] })

      await service.getCallTranscripts(undefined, '2025-01-01T00:00:00Z', '2025-02-01T00:00:00Z', 'ws-1', 'cur-1')

      expect(mock.history[0].body).toEqual({
        filter: {
          fromDateTime: '2025-01-01T00:00:00Z',
          toDateTime: '2025-02-01T00:00:00Z',
          workspaceId: 'ws-1',
        },
        cursor: 'cur-1',
      })
    })

    it('throws when neither Call IDs nor From Date/Time is provided', async () => {
      await expect(service.getCallTranscripts()).rejects.toThrow(/Provide either Call IDs or a From Date\/Time/)
      expect(mock.history).toHaveLength(0)
    })
  })

  describe('uploadCallMedia', () => {
    it('downloads the file, builds multipart form, and PUTs to /media with only the auth header', async () => {
      const fileUrl = 'https://files.example.com/rec.mp3?token=x'
      mock.onGet(fileUrl).reply(Buffer.from('audio-bytes'))
      mock.onPut(`${ BASE }/v2/calls/call-1/media`).reply({ url: 'https://app.gong.io/call?id=call-1' })

      const result = await service.uploadCallMedia('call-1', fileUrl)

      expect(result).toEqual({ url: 'https://app.gong.io/call?id=call-1' })
      // first the download (setEncoding null), then the multipart PUT
      const download = mock.history.find(h => h.url === fileUrl)
      expect(download.encoding).toBeNull()

      const put = mock.history.find(h => h.method === 'put')
      expect(put.url).toBe(`${ BASE }/v2/calls/call-1/media`)
      // only Authorization is set (no manual Content-Type so the form supplies the boundary)
      expect(put.headers).toEqual({ Authorization: AUTH_HEADER })
      expect(put.formData).toBeDefined()
      expect(put.formData._fields[0]).toMatchObject({ name: 'mediaFile', filename: { filename: 'rec.mp3' } })
    })

    it('throws when callId or file is missing', async () => {
      await expect(service.uploadCallMedia()).rejects.toThrow('Call is required')
      await expect(service.uploadCallMedia('call-1')).rejects.toThrow('Media File is required')
      expect(mock.history).toHaveLength(0)
    })
  })

  // ── USERS ────────────────────────────────────────────────────────────────

  describe('listUsers', () => {
    it('sends a bare GET with an empty query when nothing is passed', async () => {
      mock.onGet(`${ BASE }/v2/users`).reply({ users: [] })

      const result = await service.listUsers()

      expect(result).toEqual({ users: [] })
      expect(mock.history[0].url).toBe(`${ BASE }/v2/users`)
      expect(mock.history[0].query).toEqual({})
    })

    it('adds includeAvatars=true and cursor when provided', async () => {
      mock.onGet(`${ BASE }/v2/users`).reply({ users: [] })

      await service.listUsers(true, 'cur-1')

      expect(mock.history[0].query).toEqual({ includeAvatars: true, cursor: 'cur-1' })
    })

    it('omits includeAvatars when falsy', async () => {
      mock.onGet(`${ BASE }/v2/users`).reply({ users: [] })

      await service.listUsers(false, 'cur-1')

      expect(mock.history[0].query).toEqual({ cursor: 'cur-1' })
    })
  })

  describe('getUser', () => {
    it('GETs a single user by encoded id', async () => {
      mock.onGet(`${ BASE }/v2/users/u%201`).reply({ user: { id: 'u 1' } })

      const result = await service.getUser('u 1')

      expect(result).toEqual({ user: { id: 'u 1' } })
      expect(mock.history[0].url).toBe(`${ BASE }/v2/users/u%201`)
    })

    it('throws when userId is missing', async () => {
      await expect(service.getUser()).rejects.toThrow('User is required')
      expect(mock.history).toHaveLength(0)
    })
  })

  describe('listUsersExtensive', () => {
    it('sends an empty filter body when no args', async () => {
      mock.onPost(`${ BASE }/v2/users/extensive`).reply({ users: [] })

      await service.listUsersExtensive()

      expect(mock.history[0].url).toBe(`${ BASE }/v2/users/extensive`)
      expect(mock.history[0].body).toEqual({ filter: {} })
    })

    it('builds the filter from all args and cursor', async () => {
      mock.onPost(`${ BASE }/v2/users/extensive`).reply({ users: [] })

      await service.listUsersExtensive('u1,u2', true, '2024-01-01T00:00:00Z', '2024-12-31T00:00:00Z', 'cur-1')

      expect(mock.history[0].body).toEqual({
        filter: {
          userIds: ['u1', 'u2'],
          includeAvatars: true,
          createdFromDateTime: '2024-01-01T00:00:00Z',
          createdToDateTime: '2024-12-31T00:00:00Z',
        },
        cursor: 'cur-1',
      })
    })
  })

  // ── WORKSPACES ───────────────────────────────────────────────────────────

  describe('listWorkspaces', () => {
    it('GETs the workspaces endpoint', async () => {
      mock.onGet(`${ BASE }/v2/workspaces`).reply({ workspaces: [{ id: 'ws-1' }] })

      const result = await service.listWorkspaces()

      expect(result).toEqual({ workspaces: [{ id: 'ws-1' }] })
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/v2/workspaces`)
    })
  })

  // ── LIBRARY ──────────────────────────────────────────────────────────────

  describe('listLibraryFolders', () => {
    it('GETs folders scoped by workspaceId', async () => {
      mock.onGet(`${ BASE }/v2/library/folders`).reply({ folders: [] })

      await service.listLibraryFolders('ws-1')

      expect(mock.history[0].url).toBe(`${ BASE }/v2/library/folders`)
      expect(mock.history[0].query).toEqual({ workspaceId: 'ws-1' })
    })

    it('throws when workspaceId is missing', async () => {
      await expect(service.listLibraryFolders()).rejects.toThrow('Workspace is required')
      expect(mock.history).toHaveLength(0)
    })
  })

  describe('listFolderCalls', () => {
    it('GETs folder-content by folderId only (workspaceId is picker-only)', async () => {
      mock.onGet(`${ BASE }/v2/library/folder-content`).reply({ calls: [] })

      await service.listFolderCalls('folder-1', 'ws-1')

      expect(mock.history[0].url).toBe(`${ BASE }/v2/library/folder-content`)
      expect(mock.history[0].query).toEqual({ folderId: 'folder-1' })
    })

    it('throws when folderId is missing', async () => {
      await expect(service.listFolderCalls()).rejects.toThrow('Folder is required')
      expect(mock.history).toHaveLength(0)
    })
  })

  // ── STATS ────────────────────────────────────────────────────────────────

  describe('getActivityDayByDay', () => {
    it('POSTs the required date range', async () => {
      mock.onPost(`${ BASE }/v2/stats/activity/day-by-day`).reply({ usersAggregateActivityStats: [] })

      await service.getActivityDayByDay('2025-01-01T00:00:00Z', '2025-01-31T00:00:00Z')

      expect(mock.history[0].url).toBe(`${ BASE }/v2/stats/activity/day-by-day`)
      expect(mock.history[0].body).toEqual({
        fromDateTime: '2025-01-01T00:00:00Z',
        toDateTime: '2025-01-31T00:00:00Z',
      })
    })

    it('adds userIds, workspaceId and cursor', async () => {
      mock.onPost(`${ BASE }/v2/stats/activity/day-by-day`).reply({ usersAggregateActivityStats: [] })

      await service.getActivityDayByDay('2025-01-01T00:00:00Z', '2025-01-31T00:00:00Z', 'u1,u2', 'ws-1', 'cur-1')

      expect(mock.history[0].body).toEqual({
        fromDateTime: '2025-01-01T00:00:00Z',
        toDateTime: '2025-01-31T00:00:00Z',
        userIds: ['u1', 'u2'],
        workspaceId: 'ws-1',
        cursor: 'cur-1',
      })
    })

    it('throws when fromDateTime or toDateTime is missing', async () => {
      await expect(service.getActivityDayByDay()).rejects.toThrow('From Date/Time is required')
      await expect(service.getActivityDayByDay('2025-01-01T00:00:00Z')).rejects.toThrow('To Date/Time is required')
      expect(mock.history).toHaveLength(0)
    })
  })

  describe('getActivityAggregate', () => {
    it('POSTs to the aggregate endpoint', async () => {
      mock.onPost(`${ BASE }/v2/stats/activity/aggregate`).reply({ usersAggregateActivityStats: [] })

      await service.getActivityAggregate('2025-01-01T00:00:00Z', '2025-01-31T00:00:00Z')

      expect(mock.history[0].url).toBe(`${ BASE }/v2/stats/activity/aggregate`)
      expect(mock.history[0].body).toEqual({
        fromDateTime: '2025-01-01T00:00:00Z',
        toDateTime: '2025-01-31T00:00:00Z',
      })
    })
  })

  describe('getActivityByPeriod', () => {
    it('maps the friendly period label to the API enum', async () => {
      mock.onPost(`${ BASE }/v2/stats/activity/aggregate-by-period`).reply({ usersAggregateByPeriodActivityStats: [] })

      await service.getActivityByPeriod('2025-01-01T00:00:00Z', '2025-01-31T00:00:00Z', 'Week')

      expect(mock.history[0].url).toBe(`${ BASE }/v2/stats/activity/aggregate-by-period`)
      expect(mock.history[0].body).toEqual({
        fromDateTime: '2025-01-01T00:00:00Z',
        toDateTime: '2025-01-31T00:00:00Z',
        period: 'WEEK',
      })
    })

    it('passes through an already-mapped/unknown period value unchanged', async () => {
      mock.onPost(`${ BASE }/v2/stats/activity/aggregate-by-period`).reply({ usersAggregateByPeriodActivityStats: [] })

      await service.getActivityByPeriod('2025-01-01T00:00:00Z', '2025-01-31T00:00:00Z', 'QUARTER')

      expect(mock.history[0].body.period).toBe('QUARTER')
    })

    it('throws when period is missing', async () => {
      await expect(
        service.getActivityByPeriod('2025-01-01T00:00:00Z', '2025-01-31T00:00:00Z')
      ).rejects.toThrow('Group By Period is required')
      expect(mock.history).toHaveLength(0)
    })
  })

  describe('getInteractionStats', () => {
    it('POSTs to the interaction endpoint', async () => {
      mock.onPost(`${ BASE }/v2/stats/interaction`).reply({ peopleInteractionStats: [] })

      await service.getInteractionStats('2025-01-01T00:00:00Z', '2025-01-31T00:00:00Z', ['u1'])

      expect(mock.history[0].url).toBe(`${ BASE }/v2/stats/interaction`)
      expect(mock.history[0].body).toEqual({
        fromDateTime: '2025-01-01T00:00:00Z',
        toDateTime: '2025-01-31T00:00:00Z',
        userIds: ['u1'],
      })
    })
  })

  // ── SCORECARDS ───────────────────────────────────────────────────────────

  describe('listScorecards', () => {
    it('GETs scorecards with an empty query when no workspace passed', async () => {
      mock.onGet(`${ BASE }/v2/settings/scorecards`).reply({ scorecards: [] })

      await service.listScorecards()

      expect(mock.history[0].url).toBe(`${ BASE }/v2/settings/scorecards`)
      expect(mock.history[0].query).toEqual({})
    })

    it('scopes to a workspace when provided', async () => {
      mock.onGet(`${ BASE }/v2/settings/scorecards`).reply({ scorecards: [] })

      await service.listScorecards('ws-1')

      expect(mock.history[0].query).toEqual({ workspaceId: 'ws-1' })
    })
  })

  describe('getAnsweredScorecards', () => {
    it('builds a filter from call date range and posts it', async () => {
      mock.onPost(`${ BASE }/v2/stats/activity/scorecards`).reply({ answeredScorecards: [] })

      await service.getAnsweredScorecards('2025-01-01T00:00:00Z', '2025-01-31T00:00:00Z')

      expect(mock.history[0].url).toBe(`${ BASE }/v2/stats/activity/scorecards`)
      expect(mock.history[0].body).toEqual({
        filter: {
          callFromDate: '2025-01-01T00:00:00Z',
          callToDate: '2025-01-31T00:00:00Z',
        },
      })
    })

    it('merges review dates, reviewed user ids, scorecard ids and cursor', async () => {
      mock.onPost(`${ BASE }/v2/stats/activity/scorecards`).reply({ answeredScorecards: [] })

      await service.getAnsweredScorecards(
        undefined,
        undefined,
        '2025-01-05T00:00:00Z',
        '2025-01-06T00:00:00Z',
        'u1,u2',
        ['sc-1'],
        'cur-1'
      )

      expect(mock.history[0].body).toEqual({
        filter: {
          reviewFromDate: '2025-01-05T00:00:00Z',
          reviewToDate: '2025-01-06T00:00:00Z',
          reviewedUserIds: ['u1', 'u2'],
          scorecardIds: ['sc-1'],
        },
        cursor: 'cur-1',
      })
    })

    it('throws when no filter dimension is supplied', async () => {
      await expect(service.getAnsweredScorecards()).rejects.toThrow(/at least one date range/)
      expect(mock.history).toHaveLength(0)
    })
  })

  // ── MEETINGS ─────────────────────────────────────────────────────────────

  describe('createMeeting', () => {
    it('POSTs the required body and maps externalRef -> externalId', async () => {
      mock.onPost(`${ BASE }/v2/meetings`).reply({ meetingId: 'mtg-1' })

      const result = await service.createMeeting(
        '2025-01-01T10:00:00Z',
        '2025-01-01T11:00:00Z',
        'organizer@acme.com',
        [{ emailAddress: 'inv@acme.com', displayName: 'Inv' }],
        'Sync',
        'ext-123'
      )

      expect(result).toEqual({ meetingId: 'mtg-1' })
      expect(mock.history[0].url).toBe(`${ BASE }/v2/meetings`)
      expect(mock.history[0].body).toEqual({
        startTime: '2025-01-01T10:00:00Z',
        endTime: '2025-01-01T11:00:00Z',
        organizerEmail: 'organizer@acme.com',
        invitees: [{ emailAddress: 'inv@acme.com', displayName: 'Inv' }],
        title: 'Sync',
        externalId: 'ext-123',
      })
    })

    it('omits optional title/externalId when not provided', async () => {
      mock.onPost(`${ BASE }/v2/meetings`).reply({ meetingId: 'mtg-2' })

      await service.createMeeting(
        '2025-01-01T10:00:00Z',
        '2025-01-01T11:00:00Z',
        'organizer@acme.com',
        [{ emailAddress: 'inv@acme.com' }]
      )

      expect(mock.history[0].body).toEqual({
        startTime: '2025-01-01T10:00:00Z',
        endTime: '2025-01-01T11:00:00Z',
        organizerEmail: 'organizer@acme.com',
        invitees: [{ emailAddress: 'inv@acme.com' }],
      })
    })

    it('throws on missing required fields', async () => {
      await expect(service.createMeeting()).rejects.toThrow('Start Time is required')
      await expect(service.createMeeting('s')).rejects.toThrow('End Time is required')
      await expect(service.createMeeting('s', 'e')).rejects.toThrow('Organizer Email is required')
      await expect(service.createMeeting('s', 'e', 'o', [])).rejects.toThrow('At least one invitee is required')
      expect(mock.history).toHaveLength(0)
    })
  })

  describe('updateMeeting', () => {
    it('PUTs to the encoded meeting path with the full body', async () => {
      mock.onPut(`${ BASE }/v2/meetings/mtg%2F1`).reply({ meetingId: 'mtg/1' })

      await service.updateMeeting(
        'mtg/1',
        '2025-01-01T10:00:00Z',
        '2025-01-01T11:00:00Z',
        'organizer@acme.com',
        [{ emailAddress: 'inv@acme.com' }],
        'New Title',
        'ext-9'
      )

      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].url).toBe(`${ BASE }/v2/meetings/mtg%2F1`)
      expect(mock.history[0].body).toMatchObject({ title: 'New Title', externalId: 'ext-9' })
    })

    it('throws when the meeting id is missing', async () => {
      await expect(service.updateMeeting()).rejects.toThrow('Meeting is required')
      expect(mock.history).toHaveLength(0)
    })
  })

  describe('deleteMeeting', () => {
    it('DELETEs the encoded meeting path', async () => {
      mock.onDelete(`${ BASE }/v2/meetings/mtg-1`).reply({ requestId: 'r' })

      const result = await service.deleteMeeting('mtg-1')

      expect(result).toEqual({ requestId: 'r' })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${ BASE }/v2/meetings/mtg-1`)
    })

    it('throws when the meeting id is missing', async () => {
      await expect(service.deleteMeeting()).rejects.toThrow('Meeting is required')
      expect(mock.history).toHaveLength(0)
    })
  })

  describe('getMeetingIntegrationStatus', () => {
    it('POSTs an empty body to the status endpoint', async () => {
      mock.onPost(`${ BASE }/v2/meetings/integration/status`).reply({ integrationStatus: 'ACTIVE' })

      const result = await service.getMeetingIntegrationStatus()

      expect(result).toEqual({ integrationStatus: 'ACTIVE' })
      expect(mock.history[0].url).toBe(`${ BASE }/v2/meetings/integration/status`)
      expect(mock.history[0].body).toEqual({})
    })
  })

  // ── DATA PRIVACY ─────────────────────────────────────────────────────────

  describe('getDataForEmail', () => {
    it('GETs with the email_address query param', async () => {
      mock.onGet(`${ BASE }/v2/data-privacy/data-for-email-address`).reply({ calls: [] })

      await service.getDataForEmail('person@acme.com')

      expect(mock.history[0].url).toBe(`${ BASE }/v2/data-privacy/data-for-email-address`)
      expect(mock.history[0].query).toEqual({ email_address: 'person@acme.com' })
    })

    it('throws when email is missing', async () => {
      await expect(service.getDataForEmail()).rejects.toThrow('Email Address is required')
      expect(mock.history).toHaveLength(0)
    })
  })

  describe('eraseDataForEmail', () => {
    it('POSTs an empty body with the email_address query param', async () => {
      mock.onPost(`${ BASE }/v2/data-privacy/erase-data-for-email-address`).reply({ requestId: 'r' })

      await service.eraseDataForEmail('person@acme.com')

      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({})
      expect(mock.history[0].query).toEqual({ email_address: 'person@acme.com' })
    })
  })

  describe('getDataForPhone', () => {
    it('GETs with the phone_number query param', async () => {
      mock.onGet(`${ BASE }/v2/data-privacy/data-for-phone-number`).reply({ calls: [] })

      await service.getDataForPhone('+15551234567')

      expect(mock.history[0].query).toEqual({ phone_number: '+15551234567' })
    })

    it('throws when the phone number does not start with +', async () => {
      await expect(service.getDataForPhone('15551234567')).rejects.toThrow(/must start with/)
      expect(mock.history).toHaveLength(0)
    })

    it('throws when phone number is missing', async () => {
      await expect(service.getDataForPhone()).rejects.toThrow('Phone Number is required')
      expect(mock.history).toHaveLength(0)
    })
  })

  describe('eraseDataForPhone', () => {
    it('POSTs an empty body with the phone_number query param', async () => {
      mock.onPost(`${ BASE }/v2/data-privacy/erase-data-for-phone-number`).reply({ requestId: 'r' })

      await service.eraseDataForPhone('+15551234567')

      expect(mock.history[0].body).toEqual({})
      expect(mock.history[0].query).toEqual({ phone_number: '+15551234567' })
    })

    it('validates the + prefix', async () => {
      await expect(service.eraseDataForPhone('15551234567')).rejects.toThrow(/must start with/)
      expect(mock.history).toHaveLength(0)
    })
  })

  // ── LOGS ─────────────────────────────────────────────────────────────────

  describe('listLogs', () => {
    it('GETs with logType + fromDateTime (empty extras dropped)', async () => {
      mock.onGet(`${ BASE }/v2/logs`).reply({ logs: [] })

      await service.listLogs('API', '2025-01-01T00:00:00Z')

      expect(mock.history[0].url).toBe(`${ BASE }/v2/logs`)
      expect(mock.history[0].query).toEqual({ logType: 'API', fromDateTime: '2025-01-01T00:00:00Z' })
    })

    it('includes toDateTime and cursor when supplied', async () => {
      mock.onGet(`${ BASE }/v2/logs`).reply({ logs: [] })

      await service.listLogs('API', '2025-01-01T00:00:00Z', '2025-01-31T00:00:00Z', 'cur-1')

      expect(mock.history[0].query).toEqual({
        logType: 'API',
        fromDateTime: '2025-01-01T00:00:00Z',
        toDateTime: '2025-01-31T00:00:00Z',
        cursor: 'cur-1',
      })
    })

    it('throws when logType or fromDateTime missing', async () => {
      await expect(service.listLogs()).rejects.toThrow('Log Type is required')
      await expect(service.listLogs('API')).rejects.toThrow('From Date/Time is required')
      expect(mock.history).toHaveLength(0)
    })
  })

  // ── PERMISSION PROFILES ──────────────────────────────────────────────────

  describe('listPermissionProfiles', () => {
    it('GETs the all-permission-profiles endpoint scoped by workspace', async () => {
      mock.onGet(`${ BASE }/v2/all-permission-profiles`).reply({ profiles: [] })

      await service.listPermissionProfiles('ws-1')

      expect(mock.history[0].url).toBe(`${ BASE }/v2/all-permission-profiles`)
      expect(mock.history[0].query).toEqual({ workspaceId: 'ws-1' })
    })

    it('throws when workspaceId is missing', async () => {
      await expect(service.listPermissionProfiles()).rejects.toThrow('Workspace is required')
      expect(mock.history).toHaveLength(0)
    })
  })

  describe('getPermissionProfile', () => {
    it('GETs a single profile by profileId only', async () => {
      mock.onGet(`${ BASE }/v2/permission-profile`).reply({ profile: { id: 'pp-1' } })

      await service.getPermissionProfile('pp-1', 'ws-1')

      expect(mock.history[0].url).toBe(`${ BASE }/v2/permission-profile`)
      expect(mock.history[0].query).toEqual({ profileId: 'pp-1' })
    })

    it('throws when profileId is missing', async () => {
      await expect(service.getPermissionProfile()).rejects.toThrow('Permission Profile is required')
      expect(mock.history).toHaveLength(0)
    })
  })

  describe('listPermissionProfileUsers', () => {
    it('GETs users for a profile with a cursor', async () => {
      mock.onGet(`${ BASE }/v2/permission-profile/users`).reply({ users: [] })

      await service.listPermissionProfileUsers('pp-1', 'ws-1', 'cur-1')

      expect(mock.history[0].url).toBe(`${ BASE }/v2/permission-profile/users`)
      expect(mock.history[0].query).toEqual({ profileId: 'pp-1', cursor: 'cur-1' })
    })

    it('throws when profileId is missing', async () => {
      await expect(service.listPermissionProfileUsers()).rejects.toThrow('Permission Profile is required')
      expect(mock.history).toHaveLength(0)
    })
  })

  // ── CRM DATA API ─────────────────────────────────────────────────────────

  describe('registerCrmIntegration', () => {
    it('PUTs owner + name', async () => {
      mock.onPut(`${ BASE }/v2/crm/integrations`).reply({ integrationId: '123' })

      const result = await service.registerCrmIntegration('admin@acme.com', 'Acme CRM')

      expect(result).toEqual({ integrationId: '123' })
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].url).toBe(`${ BASE }/v2/crm/integrations`)
      expect(mock.history[0].body).toEqual({ ownerEmail: 'admin@acme.com', name: 'Acme CRM' })
    })

    it('throws when owner or name missing', async () => {
      await expect(service.registerCrmIntegration()).rejects.toThrow('Owner Email is required')
      await expect(service.registerCrmIntegration('admin@acme.com')).rejects.toThrow('Integration Name is required')
      expect(mock.history).toHaveLength(0)
    })
  })

  describe('listCrmIntegrations', () => {
    it('GETs the integrations endpoint', async () => {
      mock.onGet(`${ BASE }/v2/crm/integrations`).reply({ integrations: [] })

      const result = await service.listCrmIntegrations()

      expect(result).toEqual({ integrations: [] })
      expect(mock.history[0].method).toBe('get')
    })
  })

  describe('deleteCrmIntegration', () => {
    it('DELETEs with integrationId + clientRequestId query params', async () => {
      mock.onDelete(`${ BASE }/v2/crm/integrations`).reply({ clientRequestId: 'del-1' })

      await service.deleteCrmIntegration('int-1', 'del-1')

      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].query).toEqual({ integrationId: 'int-1', clientRequestId: 'del-1' })
    })

    it('throws on missing args', async () => {
      await expect(service.deleteCrmIntegration()).rejects.toThrow('Integration is required')
      await expect(service.deleteCrmIntegration('int-1')).rejects.toThrow('Client Request ID is required')
      expect(mock.history).toHaveLength(0)
    })
  })

  describe('uploadCrmObjects', () => {
    it('downloads the file and POSTs a multipart form with mapped objectType query', async () => {
      const fileUrl = 'https://files.example.com/objects.ldjson?token=x'
      mock.onGet(fileUrl).reply(Buffer.from('{"id":1}\n'))
      mock.onPost(`${ BASE }/v2/crm/entities`).reply({ clientRequestId: 'up-1' })

      const result = await service.uploadCrmObjects('int-1', 'Business User', 'up-1', fileUrl)

      expect(result).toEqual({ clientRequestId: 'up-1' })
      const post = mock.history.find(h => h.method === 'post')
      expect(post.url).toBe(`${ BASE }/v2/crm/entities`)
      expect(post.query).toEqual({ integrationId: 'int-1', objectType: 'BUSINESS_USER', clientRequestId: 'up-1' })
      expect(post.headers).toEqual({ Authorization: AUTH_HEADER })
      expect(post.formData._fields[0]).toMatchObject({ name: 'dataFile' })
    })

    it('throws on any missing required arg', async () => {
      await expect(service.uploadCrmObjects()).rejects.toThrow('Integration is required')
      await expect(service.uploadCrmObjects('int-1')).rejects.toThrow('Object Type is required')
      await expect(service.uploadCrmObjects('int-1', 'Account')).rejects.toThrow('Client Request ID is required')
      await expect(service.uploadCrmObjects('int-1', 'Account', 'up-1')).rejects.toThrow('Data File is required')
      expect(mock.history).toHaveLength(0)
    })
  })

  describe('getCrmObjects', () => {
    it('GETs with a JSON body of ids and mapped objectType query', async () => {
      mock.onGet(`${ BASE }/v2/crm/entities`).reply({ crmObjectsMap: {} })

      await service.getCrmObjects('int-1', 'Account', 'a1, a2')

      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/v2/crm/entities`)
      expect(mock.history[0].query).toEqual({ integrationId: 'int-1', objectType: 'ACCOUNT' })
      expect(mock.history[0].body).toEqual(['a1', 'a2'])
    })

    it('throws when ids are missing', async () => {
      await expect(service.getCrmObjects('int-1', 'Account')).rejects.toThrow('At least one Object ID is required')
      await expect(service.getCrmObjects('int-1')).rejects.toThrow('Object Type is required')
      await expect(service.getCrmObjects()).rejects.toThrow('Integration is required')
      expect(mock.history).toHaveLength(0)
    })
  })

  describe('uploadCrmObjectSchema', () => {
    it('maps each field type/reference and dedupes optional properties', async () => {
      mock.onPost(`${ BASE }/v2/crm/entity-schema`).reply({ requestId: 'r' })

      await service.uploadCrmObjectSchema('int-1', 'Deal', [
        { uniqueName: 'stage', label: 'Stage', type: 'Reference', referenceTo: 'Deal' },
        {
          uniqueName: 'status',
          label: 'Status',
          type: 'Picklist',
          orderedValueList: 'Open,Closed',
          isDeleted: true,
          lastModified: '2025-01-01T00:00:00Z',
        },
      ])

      expect(mock.history[0].url).toBe(`${ BASE }/v2/crm/entity-schema`)
      expect(mock.history[0].query).toEqual({ integrationId: 'int-1', objectType: 'DEAL' })
      expect(mock.history[0].body).toEqual([
        { uniqueName: 'stage', label: 'Stage', type: 'REFERENCE', referenceTo: 'DEAL' },
        {
          uniqueName: 'status',
          label: 'Status',
          type: 'PICKLIST',
          isDeleted: true,
          lastModified: '2025-01-01T00:00:00Z',
          orderedValueList: ['Open', 'Closed'],
        },
      ])
    })

    it('throws when fields are missing', async () => {
      await expect(service.uploadCrmObjectSchema('int-1', 'Account', [])).rejects.toThrow('At least one field is required')
      expect(mock.history).toHaveLength(0)
    })
  })

  describe('listCrmObjectSchemaFields', () => {
    it('GETs the schema with mapped objectType', async () => {
      mock.onGet(`${ BASE }/v2/crm/entity-schema`).reply({ objectTypeToSelectedFields: {} })

      await service.listCrmObjectSchemaFields('int-1', 'Contact')

      expect(mock.history[0].query).toEqual({ integrationId: 'int-1', objectType: 'CONTACT' })
    })

    it('omits objectType when not provided', async () => {
      mock.onGet(`${ BASE }/v2/crm/entity-schema`).reply({ objectTypeToSelectedFields: {} })

      await service.listCrmObjectSchemaFields('int-1')

      expect(mock.history[0].query).toEqual({ integrationId: 'int-1' })
    })

    it('throws when integrationId is missing', async () => {
      await expect(service.listCrmObjectSchemaFields()).rejects.toThrow('Integration is required')
      expect(mock.history).toHaveLength(0)
    })
  })

  describe('getCrmRequestStatus', () => {
    it('GETs the request-status endpoint', async () => {
      mock.onGet(`${ BASE }/v2/crm/request-status`).reply({ status: 'DONE' })

      await service.getCrmRequestStatus('int-1', 'up-1')

      expect(mock.history[0].url).toBe(`${ BASE }/v2/crm/request-status`)
      expect(mock.history[0].query).toEqual({ integrationId: 'int-1', clientRequestId: 'up-1' })
    })

    it('throws on missing args', async () => {
      await expect(service.getCrmRequestStatus()).rejects.toThrow('Integration is required')
      await expect(service.getCrmRequestStatus('int-1')).rejects.toThrow('Client Request ID is required')
      expect(mock.history).toHaveLength(0)
    })
  })

  // ── ENGAGE FLOWS ─────────────────────────────────────────────────────────

  describe('listFlows', () => {
    it('GETs flows for an owner (empty extras dropped)', async () => {
      mock.onGet(`${ BASE }/v2/flows`).reply({ flows: [] })

      await service.listFlows('rep@acme.com')

      expect(mock.history[0].url).toBe(`${ BASE }/v2/flows`)
      expect(mock.history[0].query).toEqual({ flowOwnerEmail: 'rep@acme.com' })
    })

    it('includes workspace and cursor', async () => {
      mock.onGet(`${ BASE }/v2/flows`).reply({ flows: [] })

      await service.listFlows('rep@acme.com', 'ws-1', 'cur-1')

      expect(mock.history[0].query).toEqual({ flowOwnerEmail: 'rep@acme.com', workspaceId: 'ws-1', cursor: 'cur-1' })
    })

    it('throws when flowOwnerEmail is missing', async () => {
      await expect(service.listFlows()).rejects.toThrow('Flow Owner Email is required')
      expect(mock.history).toHaveLength(0)
    })
  })

  describe('assignProspectsToFlow', () => {
    it('POSTs the prospect ids, flow and owner email', async () => {
      mock.onPost(`${ BASE }/v2/flows/prospects/assign`).reply({ prospectsAssigned: [] })

      await service.assignProspectsToFlow('rep@acme.com', 'flow-1', 'p1,p2')

      expect(mock.history[0].url).toBe(`${ BASE }/v2/flows/prospects/assign`)
      expect(mock.history[0].body).toEqual({
        crmProspectsIds: ['p1', 'p2'],
        flowId: 'flow-1',
        flowInstanceOwnerEmail: 'rep@acme.com',
      })
    })

    it('throws on missing owner, flow, or prospects', async () => {
      await expect(service.assignProspectsToFlow()).rejects.toThrow('Flow Owner Email is required')
      await expect(service.assignProspectsToFlow('rep@acme.com')).rejects.toThrow('Flow is required')
      await expect(service.assignProspectsToFlow('rep@acme.com', 'flow-1')).rejects.toThrow('At least one CRM Prospect ID is required')
      expect(mock.history).toHaveLength(0)
    })
  })

  describe('getProspectsAssignedFlows', () => {
    it('POSTs the prospect ids', async () => {
      mock.onPost(`${ BASE }/v2/flows/prospects`).reply({ prospectsAssigned: [] })

      await service.getProspectsAssignedFlows(['p1'])

      expect(mock.history[0].url).toBe(`${ BASE }/v2/flows/prospects`)
      expect(mock.history[0].body).toEqual({ crmProspectsIds: ['p1'] })
    })

    it('throws when no ids given', async () => {
      await expect(service.getProspectsAssignedFlows()).rejects.toThrow('At least one CRM Prospect ID is required')
      expect(mock.history).toHaveLength(0)
    })
  })

  describe('removeProspectFromFlowByCrmId', () => {
    it('POSTs only the prospect id when flow/user omitted', async () => {
      mock.onPost(`${ BASE }/v2/flows/prospects/unassign-flows-by-crm-id`).reply({ unassignedFlowInstanceIds: [] })

      await service.removeProspectFromFlowByCrmId('p1')

      expect(mock.history[0].body).toEqual({ crmProspectId: 'p1' })
    })

    it('includes flowId and unassignedByUserEmail when provided', async () => {
      mock.onPost(`${ BASE }/v2/flows/prospects/unassign-flows-by-crm-id`).reply({ unassignedFlowInstanceIds: [] })

      await service.removeProspectFromFlowByCrmId('p1', 'flow-1', 'admin@acme.com')

      expect(mock.history[0].body).toEqual({
        crmProspectId: 'p1',
        flowId: 'flow-1',
        unassignedByUserEmail: 'admin@acme.com',
      })
    })

    it('throws when the prospect id is missing', async () => {
      await expect(service.removeProspectFromFlowByCrmId()).rejects.toThrow('CRM Prospect ID is required')
      expect(mock.history).toHaveLength(0)
    })
  })

  describe('removeProspectsFromFlowByInstanceId', () => {
    it('POSTs the instance ids', async () => {
      mock.onPost(`${ BASE }/v2/flows/prospects/unassign-flows-by-instance-id`).reply({ unassignedFlowInstanceIds: [] })

      await service.removeProspectsFromFlowByInstanceId('inst-1,inst-2', 'admin@acme.com')

      expect(mock.history[0].body).toEqual({
        flowInstanceIds: ['inst-1', 'inst-2'],
        unassignedByUserEmail: 'admin@acme.com',
      })
    })

    it('omits the audit email when not provided', async () => {
      mock.onPost(`${ BASE }/v2/flows/prospects/unassign-flows-by-instance-id`).reply({ unassignedFlowInstanceIds: [] })

      await service.removeProspectsFromFlowByInstanceId(['inst-1'])

      expect(mock.history[0].body).toEqual({ flowInstanceIds: ['inst-1'] })
    })

    it('throws when no instance ids given', async () => {
      await expect(service.removeProspectsFromFlowByInstanceId()).rejects.toThrow('At least one Flow Instance ID is required')
      expect(mock.history).toHaveLength(0)
    })
  })

  // ── DICTIONARIES ─────────────────────────────────────────────────────────

  describe('getWorkspacesDictionary', () => {
    it('maps workspaces to items with a null cursor', async () => {
      mock.onGet(`${ BASE }/v2/workspaces`).reply({
        workspaces: [
          { id: 'ws-1', name: 'North America' },
          { id: 'ws-2', name: 'EMEA' },
        ],
      })

      const result = await service.getWorkspacesDictionary({})

      expect(result).toEqual({
        items: [
          { label: 'North America', value: 'ws-1', note: 'ID: ws-1' },
          { label: 'EMEA', value: 'ws-2', note: 'ID: ws-2' },
        ],
        cursor: null,
      })
    })

    it('filters by search text (case-insensitive)', async () => {
      mock.onGet(`${ BASE }/v2/workspaces`).reply({
        workspaces: [
          { id: 'ws-1', name: 'North America' },
          { id: 'ws-2', name: 'EMEA' },
        ],
      })

      const result = await service.getWorkspacesDictionary({ search: 'emea' })

      expect(result.items).toEqual([{ label: 'EMEA', value: 'ws-2', note: 'ID: ws-2' }])
    })

    it('tolerates a null payload and empty result', async () => {
      mock.onGet(`${ BASE }/v2/workspaces`).reply({})

      const result = await service.getWorkspacesDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getCallsDictionary', () => {
    it('queries the last 30 days and maps calls, carrying the records cursor', async () => {
      mock.onGet(`${ BASE }/v2/calls`).reply({
        calls: [{ id: 'c-1', title: 'Acme — Discovery', started: '2025-01-12T17:02:00Z' }],
        records: { cursor: 'next-page' },
      })

      const result = await service.getCallsDictionary({ cursor: 'cur-0' })

      expect(mock.history[0].query.cursor).toBe('cur-0')
      expect(mock.history[0].query.fromDateTime).toEqual(expect.any(String))
      expect(result.items).toEqual([
        { label: 'Acme — Discovery', value: 'c-1', note: '2025-01-12T17:02:00Z' },
      ])
      expect(result.cursor).toBe('next-page')
    })

    it('falls back to id label and scheduled note, null cursor when records absent', async () => {
      mock.onGet(`${ BASE }/v2/calls`).reply({
        calls: [{ id: 'c-2', scheduled: '2025-01-10T00:00:00Z' }],
      })

      const result = await service.getCallsDictionary({})

      expect(result.items).toEqual([{ label: 'c-2', value: 'c-2', note: '2025-01-10T00:00:00Z' }])
      expect(result.cursor).toBeNull()
    })
  })

  describe('getUsersDictionary', () => {
    it('maps users to "Name <email>" labels and carries the cursor', async () => {
      mock.onGet(`${ BASE }/v2/users`).reply({
        users: [{ id: 'u-1', firstName: 'Jane', lastName: 'Doe', emailAddress: 'jane@acme.com' }],
        records: { cursor: 'next' },
      })

      const result = await service.getUsersDictionary({})

      expect(result.items).toEqual([
        { label: 'Jane Doe <jane@acme.com>', value: 'u-1', note: 'jane@acme.com' },
      ])
      expect(result.cursor).toBe('next')
    })

    it('filters by search across name and email', async () => {
      mock.onGet(`${ BASE }/v2/users`).reply({
        users: [
          { id: 'u-1', firstName: 'Jane', lastName: 'Doe', emailAddress: 'jane@acme.com' },
          { id: 'u-2', firstName: 'John', lastName: 'Roe', emailAddress: 'john@acme.com' },
        ],
      })

      const result = await service.getUsersDictionary({ search: 'john@acme' })

      expect(result.items).toEqual([
        { label: 'John Roe <john@acme.com>', value: 'u-2', note: 'john@acme.com' },
      ])
    })
  })

  describe('getLibraryFoldersDictionary', () => {
    it('returns empty when no workspace criteria (no HTTP call)', async () => {
      const result = await service.getLibraryFoldersDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
      expect(mock.history).toHaveLength(0)
    })

    it('flattens the nested folder hierarchy', async () => {
      mock.onGet(`${ BASE }/v2/library/folders`).reply({
        folders: [
          { id: 'f-1', name: 'Top', folders: [{ id: 'f-2', name: 'Nested' }] },
        ],
      })

      const result = await service.getLibraryFoldersDictionary({ criteria: { workspaceId: 'ws-1' } })

      expect(mock.history[0].query).toEqual({ workspaceId: 'ws-1' })
      expect(result.items).toEqual([
        { label: 'Top', value: 'f-1', note: 'ID: f-1' },
        { label: 'Nested', value: 'f-2', note: 'ID: f-2' },
      ])
    })
  })

  describe('getScorecardsDictionary', () => {
    it('maps scorecards by name/id', async () => {
      mock.onGet(`${ BASE }/v2/settings/scorecards`).reply({
        scorecards: [{ scorecardId: 'sc-1', scorecardName: 'Discovery Quality' }],
      })

      const result = await service.getScorecardsDictionary({})

      expect(result.items).toEqual([
        { label: 'Discovery Quality', value: 'sc-1', note: 'ID: sc-1' },
      ])
      expect(result.cursor).toBeNull()
    })
  })

  describe('getPermissionProfilesDictionary', () => {
    it('returns empty without workspace criteria', async () => {
      const result = await service.getPermissionProfilesDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
      expect(mock.history).toHaveLength(0)
    })

    it('maps profiles for a workspace', async () => {
      mock.onGet(`${ BASE }/v2/all-permission-profiles`).reply({
        profiles: [{ id: 'pp-1', name: 'Sales Rep' }],
      })

      const result = await service.getPermissionProfilesDictionary({ criteria: { workspaceId: 'ws-1' } })

      expect(result.items).toEqual([{ label: 'Sales Rep', value: 'pp-1', note: 'ID: pp-1' }])
    })
  })

  describe('getCrmIntegrationsDictionary', () => {
    it('maps integrations, stringifying the integrationId', async () => {
      mock.onGet(`${ BASE }/v2/crm/integrations`).reply({
        integrations: [{ integrationId: 555001234567890123, name: 'Acme CRM', ownerEmail: 'admin@acme.com' }],
      })

      const result = await service.getCrmIntegrationsDictionary({})

      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toMatchObject({ label: 'Acme CRM', note: 'admin@acme.com' })
      expect(typeof result.items[0].value).toBe('string')
    })
  })

  describe('getFlowsDictionary', () => {
    it('returns empty without flowOwnerEmail criteria', async () => {
      const result = await service.getFlowsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
      expect(mock.history).toHaveLength(0)
    })

    it('maps flows and carries the records cursor', async () => {
      mock.onGet(`${ BASE }/v2/flows`).reply({
        flows: [{ id: 'flow-1', name: 'Cold Outreach', visibility: 'Company' }],
        records: { cursor: 'next' },
      })

      const result = await service.getFlowsDictionary({ criteria: { flowOwnerEmail: 'rep@acme.com' } })

      expect(mock.history[0].query).toMatchObject({ flowOwnerEmail: 'rep@acme.com' })
      expect(result.items).toEqual([{ label: 'Cold Outreach', value: 'flow-1', note: 'Company' }])
      expect(result.cursor).toBe('next')
    })
  })

  // ── PARAM SCHEMA LOADERS ─────────────────────────────────────────────────

  describe('param schema loaders', () => {
    it('getPartiesSchema returns the party field schema', async () => {
      const schema = await service.getPartiesSchema()

      expect(Array.isArray(schema)).toBe(true)
      expect(schema.map(f => f.name)).toEqual(['userId', 'name', 'emailAddress', 'phoneNumber'])
    })

    it('getInviteesSchema returns email + display name fields', async () => {
      const schema = await service.getInviteesSchema()

      expect(schema.map(f => f.name)).toEqual(['emailAddress', 'displayName'])
      expect(schema[0].required).toBe(true)
    })

    it('getCrmSchemaFieldSchema returns the full field-definition schema', async () => {
      const schema = await service.getCrmSchemaFieldSchema()

      expect(schema.map(f => f.name)).toEqual([
        'uniqueName', 'label', 'type', 'referenceTo', 'orderedValueList', 'isDeleted', 'lastModified',
      ])
    })
  })

  // ── POLLING TRIGGER ──────────────────────────────────────────────────────

  describe('GongPolling.diff (pure)', () => {
    let GongPolling

    beforeAll(() => {
      ({ GongPolling } = require('../src/index.js'))
    })

    it('primes the watermark and emits nothing on the first run', () => {
      const calls = [{ id: 'c-1' }, { id: 'c-2' }]
      const result = GongPolling.diff(calls, null, '2025-01-01T01:00:00Z')

      expect(result.events).toEqual([])
      expect(result.state.lastFromDateTime).toBe('2025-01-01T01:00:00Z')
      expect(result.state.seenIds).toEqual(['c-1', 'c-2'])
    })

    it('emits only unseen calls and merges the seen set', () => {
      const state = { lastFromDateTime: '2025-01-01T00:45:00Z', seenIds: ['c-1'] }
      const calls = [{ id: 'c-1' }, { id: 'c-2' }, { id: 'c-3' }]

      const result = GongPolling.diff(calls, state, '2025-01-01T01:00:00Z')

      expect(result.events).toEqual([{ id: 'c-2' }, { id: 'c-3' }])
      expect(result.state.seenIds).toEqual(['c-1', 'c-2', 'c-3'])
      expect(result.state.lastFromDateTime).toBe('2025-01-01T01:00:00Z')
    })

    it('bounds the seen set to MAX_SEEN_IDS, keeping the newest ids', () => {
      const many = Array.from({ length: GongPolling.MAX_SEEN_IDS + 10 }, (_, i) => `id-${ i }`)
      const bounded = GongPolling.boundSeen(many)

      expect(bounded).toHaveLength(GongPolling.MAX_SEEN_IDS)
      expect(bounded[bounded.length - 1]).toBe(`id-${ GongPolling.MAX_SEEN_IDS + 9 }`)
    })

    it('treats non-array calls as empty', () => {
      const result = GongPolling.diff(undefined, null, '2025-01-01T01:00:00Z')

      expect(result.events).toEqual([])
      expect(result.state.seenIds).toEqual([])
    })
  })

  describe('onNewCall (polling trigger)', () => {
    it('pages through all cursors and returns primed state on first run', async () => {
      let call = 0
      mock.onGet(`${ BASE }/v2/calls`).replyWith(() => {
        call += 1
        if (call === 1) {
          return { calls: [{ id: 'c-1' }], records: { cursor: 'page-2' } }
        }
        return { calls: [{ id: 'c-2' }], records: { cursor: null } }
      })

      const result = await service.onNewCall({ triggerData: { workspaceId: 'ws-1' } })

      // two pages fetched
      expect(mock.history).toHaveLength(2)
      expect(mock.history[0].query).toMatchObject({ workspaceId: 'ws-1' })
      // first run: primes state, emits nothing
      expect(result.events).toEqual([])
      expect(result.state.seenIds).toEqual(['c-1', 'c-2'])
    })

    it('emits newly-seen calls on a subsequent run', async () => {
      mock.onGet(`${ BASE }/v2/calls`).reply({ calls: [{ id: 'c-1' }, { id: 'c-9' }], records: { cursor: null } })

      const priorState = { lastFromDateTime: new Date().toISOString(), seenIds: ['c-1'] }
      const result = await service.onNewCall({ triggerData: {}, state: priorState })

      expect(result.events).toEqual([{ id: 'c-9' }])
      expect(result.state.seenIds).toEqual(expect.arrayContaining(['c-1', 'c-9']))
    })
  })

  describe('handleTriggerPollingForEvent', () => {
    it('delegates to the named event method', async () => {
      mock.onGet(`${ BASE }/v2/calls`).reply({ calls: [], records: { cursor: null } })

      const result = await service.handleTriggerPollingForEvent({ eventName: 'onNewCall', triggerData: {} })

      expect(result).toHaveProperty('events')
      expect(result).toHaveProperty('state')
    })
  })

  // ── ERROR HANDLING ───────────────────────────────────────────────────────

  describe('error handling', () => {
    it('joins body.errors and prepends the hint for a known status', async () => {
      mock.onGet(`${ BASE }/v2/workspaces`).replyWithError({
        status: 403,
        body: { errors: ['missing scope', 'contact admin'] },
      })

      await expect(service.listWorkspaces()).rejects.toThrow(
        'Permission denied — this API key is missing the required scope. A Gong Technical Admin enables it in Company Settings → Ecosystem → API. (missing scope; contact admin)'
      )
    })

    it('falls back to error.message when no hint or body errors', async () => {
      mock.onGet(`${ BASE }/v2/workspaces`).replyWithError({ message: 'socket hang up' })

      await expect(service.listWorkspaces()).rejects.toThrow('socket hang up')
    })

    it('uses body.error.message when present', async () => {
      mock.onGet(`${ BASE }/v2/workspaces`).replyWithError({
        status: 500,
        body: { error: { message: 'internal boom' } },
      })

      await expect(service.listWorkspaces()).rejects.toThrow('internal boom')
    })
  })
})
