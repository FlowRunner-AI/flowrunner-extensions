'use strict'

const { createSandbox } = require('../../../service-sandbox')

const ACCESS_TOKEN = 'test-access-token'
const BASE = 'https://webexapis.com/v1'

const AUTH_HEADERS = {
  'Authorization': `Bearer ${ ACCESS_TOKEN }`,
  'Content-Type': 'application/json',
}

const ROOM_ID = 'Y2lzY29zcGFyazovL3VzL1JPT00vYWJj'

describe('Cisco Webex Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ accessToken: ACCESS_TOKEN })
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
    it('registers the access token config item', () => {
      const configItems = sandbox.getConfigItems()

      expect(configItems.map(item => item.name)).toEqual(['accessToken'])

      expect(configItems[0]).toEqual(
        expect.objectContaining({ name: 'accessToken', required: true, shared: false, type: 'STRING' })
      )
    })

    it('keeps the access token on the instance', () => {
      expect(service.accessToken).toBe(ACCESS_TOKEN)
    })
  })

  // ── Messages ──

  describe('createMessage', () => {
    it('posts a room message and drops empty fields', async () => {
      mock.onPost(`${ BASE }/messages`).reply({ id: 'msg-1', roomId: ROOM_ID })

      const result = await service.createMessage(ROOM_ID, '', null, '**Hello**', 'Hello')

      expect(result).toEqual({ id: 'msg-1', roomId: ROOM_ID })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/messages`)
      expect(mock.history[0].headers).toEqual(AUTH_HEADERS)
      expect(mock.history[0].body).toEqual({ roomId: ROOM_ID, markdown: '**Hello**', text: 'Hello' })
    })

    it('includes files and adaptive card attachments when non-empty', async () => {
      mock.onPost(`${ BASE }/messages`).reply({ id: 'msg-2' })

      await service.createMessage(
        ROOM_ID,
        undefined,
        undefined,
        undefined,
        'Report attached',
        ['https://example.com/report.pdf'],
        [{ contentType: 'application/vnd.microsoft.card.adaptive', content: {} }]
      )

      expect(mock.history[0].body).toEqual({
        roomId: ROOM_ID,
        text: 'Report attached',
        files: ['https://example.com/report.pdf'],
        attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', content: {} }],
      })
    })

    it('omits empty files and attachments arrays', async () => {
      mock.onPost(`${ BASE }/messages`).reply({ id: 'msg-3' })

      await service.createMessage(ROOM_ID, undefined, undefined, undefined, 'Hi', [], [])

      expect(mock.history[0].body).toEqual({ roomId: ROOM_ID, text: 'Hi' })
    })

    it('throws a formatted error including the Webex error details and tracking id', async () => {
      mock.onPost(`${ BASE }/messages`).replyWithError({
        message: 'Bad Request',
        body: {
          message: 'Failed to create message',
          errors: [{ description: 'roomId is invalid' }],
          trackingId: 'ROUTER_123',
        },
      })

      await expect(service.createMessage(ROOM_ID, undefined, undefined, undefined, 'Hi')).rejects.toThrow(
        'Cisco Webex API error: Failed to create message - roomId is invalid (trackingId: ROUTER_123)'
      )
    })

    it('falls back to the transport error message when there is no response body', async () => {
      mock.onPost(`${ BASE }/messages`).replyWithError({ message: 'Network timeout' })

      await expect(service.createMessage(ROOM_ID, undefined, undefined, undefined, 'Hi')).rejects.toThrow(
        'Cisco Webex API error: Network timeout'
      )
    })
  })

  describe('createDirectMessage', () => {
    it('posts a direct message by email', async () => {
      mock.onPost(`${ BASE }/messages`).reply({ id: 'msg-4', roomType: 'direct' })

      const result = await service.createDirectMessage('user@example.com', 'Hi there')

      expect(result).toEqual({ id: 'msg-4', roomType: 'direct' })
      expect(mock.history[0].body).toEqual({ toPersonEmail: 'user@example.com', text: 'Hi there' })
    })

    it('includes markdown when provided', async () => {
      mock.onPost(`${ BASE }/messages`).reply({ id: 'msg-5' })

      await service.createDirectMessage('user@example.com', 'Hi there', '**Hi** there')

      expect(mock.history[0].body).toEqual({
        toPersonEmail: 'user@example.com',
        text: 'Hi there',
        markdown: '**Hi** there',
      })
    })
  })

  describe('listMessages', () => {
    it('lists room messages with the default max', async () => {
      mock.onGet(`${ BASE }/messages`).reply({ items: [] })

      const result = await service.listMessages(ROOM_ID)

      expect(result).toEqual({ items: [] })
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].query).toEqual({ roomId: ROOM_ID, max: 50 })
      expect(mock.history[0].body).toBeUndefined()
    })

    it('passes the parent id, before timestamp and custom max', async () => {
      mock.onGet(`${ BASE }/messages`).reply({ items: [] })

      await service.listMessages(ROOM_ID, 'msg-parent', '2026-07-14T10:00:00.000Z', 10)

      expect(mock.history[0].query).toEqual({
        roomId: ROOM_ID,
        parentId: 'msg-parent',
        before: '2026-07-14T10:00:00.000Z',
        max: 10,
      })
    })
  })

  describe('getMessage', () => {
    it('requests a single message by encoded id', async () => {
      mock.onGet(`${ BASE }/messages/msg%2F1`).reply({ id: 'msg/1' })

      const result = await service.getMessage('msg/1')

      expect(result).toEqual({ id: 'msg/1' })
      expect(mock.history[0].url).toBe(`${ BASE }/messages/msg%2F1`)
    })
  })

  describe('deleteMessage', () => {
    it('deletes a message and returns a success payload', async () => {
      mock.onDelete(`${ BASE }/messages/msg-1`).reply('')

      const result = await service.deleteMessage('msg-1')

      expect(result).toEqual({ success: true })
      expect(mock.history[0].method).toBe('delete')
    })

    it('propagates delete failures', async () => {
      mock.onDelete(`${ BASE }/messages/msg-1`).replyWithError({ message: 'Forbidden' })

      await expect(service.deleteMessage('msg-1')).rejects.toThrow('Cisco Webex API error: Forbidden')
    })
  })

  describe('getMessageAttachment', () => {
    const FILE_URL = `${ BASE }/contents/Y29udGVudA`

    let uploadFile

    beforeEach(() => {
      uploadFile = jest.fn().mockResolvedValue({ url: 'https://files.flowrunner.io/report.pdf' })
      service.flowrunner = { Files: { uploadFile } }
    })

    afterEach(() => {
      delete service.flowrunner
    })

    it('downloads the file as binary and uploads it to file storage', async () => {
      mock.onGet(FILE_URL).reply({
        body: Buffer.from('pdf-bytes'),
        headers: {
          'content-type': 'application/pdf',
          'content-disposition': 'attachment; filename="report.pdf"',
        },
      })

      const result = await service.getMessageAttachment(FILE_URL)

      expect(mock.history[0].headers).toEqual({ 'Authorization': `Bearer ${ ACCESS_TOKEN }` })
      expect(mock.history[0].encoding).toBeNull()
      expect(mock.history[0].unwrapBody).toBe(false)

      expect(uploadFile).toHaveBeenCalledTimes(1)
      expect(uploadFile.mock.calls[0][0].toString()).toBe('pdf-bytes')

      expect(uploadFile.mock.calls[0][1]).toEqual({
        filename: 'report.pdf',
        generateUrl: true,
        overwrite: true,
        scope: 'FLOW',
      })

      expect(result).toEqual({
        url: 'https://files.flowrunner.io/report.pdf',
        filename: 'report.pdf',
        contentType: 'application/pdf',
        size: Buffer.from('pdf-bytes').length,
      })
    })

    it('uses the explicit file name and the provided file options', async () => {
      mock.onGet(FILE_URL).reply({ body: Buffer.from('data'), headers: {} })

      const result = await service.getMessageAttachment(FILE_URL, 'custom.txt', { scope: 'APP' })

      expect(uploadFile.mock.calls[0][1]).toEqual({
        filename: 'custom.txt',
        generateUrl: true,
        overwrite: true,
        scope: 'APP',
      })

      expect(result.filename).toBe('custom.txt')
      expect(result.contentType).toBeUndefined()
    })

    it('generates a fallback name when no name and no content-disposition are available', async () => {
      mock.onGet(FILE_URL).reply(Buffer.from('raw'))

      const result = await service.getMessageAttachment(FILE_URL)

      expect(result.filename).toMatch(/^webex_attachment_\d+$/)
      expect(result.size).toBe(3)
    })

    it('throws a formatted error when the download fails', async () => {
      mock.onGet(FILE_URL).replyWithError({ message: 'Not Found', body: { message: 'content not found' } })

      await expect(service.getMessageAttachment(FILE_URL)).rejects.toThrow(
        'Cisco Webex API error: content not found'
      )

      expect(uploadFile).not.toHaveBeenCalled()
    })
  })

  // ── Rooms ──

  describe('listRooms', () => {
    it('lists rooms with the default max', async () => {
      mock.onGet(`${ BASE }/rooms`).reply({ items: [] })

      const result = await service.listRooms()

      expect(result).toEqual({ items: [] })
      expect(mock.history[0].query).toEqual({ max: 50 })
    })

    it('maps the room type choice label to the API value', async () => {
      mock.onGet(`${ BASE }/rooms`).reply({ items: [] })

      await service.listRooms('Direct', 'team-1', 5)

      expect(mock.history[0].query).toEqual({ type: 'direct', teamId: 'team-1', max: 5 })
    })

    it('passes an unmapped type through unchanged', async () => {
      mock.onGet(`${ BASE }/rooms`).reply({ items: [] })

      await service.listRooms('group')

      expect(mock.history[0].query).toEqual({ type: 'group', max: 50 })
    })
  })

  describe('createRoom', () => {
    it('creates a standalone room', async () => {
      mock.onPost(`${ BASE }/rooms`).reply({ id: ROOM_ID, title: 'Launch Planning' })

      const result = await service.createRoom('Launch Planning')

      expect(result).toEqual({ id: ROOM_ID, title: 'Launch Planning' })
      expect(mock.history[0].body).toEqual({ title: 'Launch Planning' })
    })

    it('creates a team room', async () => {
      mock.onPost(`${ BASE }/rooms`).reply({ id: ROOM_ID })

      await service.createRoom('Launch Planning', 'team-1')

      expect(mock.history[0].body).toEqual({ title: 'Launch Planning', teamId: 'team-1' })
    })
  })

  describe('getRoom', () => {
    it('requests a single room', async () => {
      mock.onGet(`${ BASE }/rooms/${ ROOM_ID }`).reply({ id: ROOM_ID })

      await expect(service.getRoom(ROOM_ID)).resolves.toEqual({ id: ROOM_ID })
    })
  })

  describe('updateRoom', () => {
    it('puts the new title', async () => {
      mock.onPut(`${ BASE }/rooms/${ ROOM_ID }`).reply({ id: ROOM_ID, title: 'Renamed' })

      const result = await service.updateRoom(ROOM_ID, 'Renamed')

      expect(result).toEqual({ id: ROOM_ID, title: 'Renamed' })
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].body).toEqual({ title: 'Renamed' })
    })
  })

  describe('deleteRoom', () => {
    it('deletes a room and returns a success payload', async () => {
      mock.onDelete(`${ BASE }/rooms/${ ROOM_ID }`).reply('')

      await expect(service.deleteRoom(ROOM_ID)).resolves.toEqual({ success: true })
    })
  })

  describe('getRoomMeetingDetails', () => {
    it('requests the meetingInfo sub-resource', async () => {
      mock.onGet(`${ BASE }/rooms/${ ROOM_ID }/meetingInfo`).reply({ roomId: ROOM_ID, meetingNumber: '201234567' })

      const result = await service.getRoomMeetingDetails(ROOM_ID)

      expect(result).toEqual({ roomId: ROOM_ID, meetingNumber: '201234567' })
    })
  })

  // ── Memberships ──

  describe('listMemberships', () => {
    it('lists memberships of a room', async () => {
      mock.onGet(`${ BASE }/memberships`).reply({ items: [] })

      const result = await service.listMemberships(ROOM_ID)

      expect(result).toEqual({ items: [] })
      expect(mock.history[0].query).toEqual({ roomId: ROOM_ID, max: 50 })
    })

    it('honours a custom max', async () => {
      mock.onGet(`${ BASE }/memberships`).reply({ items: [] })

      await service.listMemberships(ROOM_ID, 5)

      expect(mock.history[0].query).toEqual({ roomId: ROOM_ID, max: 5 })
    })
  })

  describe('createMembership', () => {
    it('adds a person by email without the moderator flag', async () => {
      mock.onPost(`${ BASE }/memberships`).reply({ id: 'mem-1' })

      const result = await service.createMembership(ROOM_ID, 'user@example.com')

      expect(result).toEqual({ id: 'mem-1' })
      expect(mock.history[0].body).toEqual({ roomId: ROOM_ID, personEmail: 'user@example.com' })
    })

    it('adds a person by id as a moderator', async () => {
      mock.onPost(`${ BASE }/memberships`).reply({ id: 'mem-2' })

      await service.createMembership(ROOM_ID, undefined, 'person-1', true)

      expect(mock.history[0].body).toEqual({ roomId: ROOM_ID, personId: 'person-1', isModerator: true })
    })

    it('omits the moderator flag when it is not exactly true', async () => {
      mock.onPost(`${ BASE }/memberships`).reply({ id: 'mem-3' })

      await service.createMembership(ROOM_ID, 'user@example.com', undefined, false)

      expect(mock.history[0].body).toEqual({ roomId: ROOM_ID, personEmail: 'user@example.com' })
    })
  })

  describe('deleteMembership', () => {
    it('deletes a membership and returns a success payload', async () => {
      mock.onDelete(`${ BASE }/memberships/mem-1`).reply('')

      await expect(service.deleteMembership('mem-1')).resolves.toEqual({ success: true })
    })
  })

  // ── People ──

  describe('getMyOwnDetails', () => {
    it('requests the /people/me endpoint', async () => {
      mock.onGet(`${ BASE }/people/me`).reply({ id: 'me', type: 'bot' })

      const result = await service.getMyOwnDetails()

      expect(result).toEqual({ id: 'me', type: 'bot' })
      expect(mock.history[0].query).toEqual({})
    })
  })

  describe('listPeople', () => {
    it('searches by email', async () => {
      mock.onGet(`${ BASE }/people`).reply({ items: [] })

      const result = await service.listPeople('user@example.com')

      expect(result).toEqual({ items: [] })
      expect(mock.history[0].query).toEqual({ email: 'user@example.com', max: 50 })
    })

    it('searches by display name with a custom max', async () => {
      mock.onGet(`${ BASE }/people`).reply({ items: [] })

      await service.listPeople(undefined, 'Jane', 3)

      expect(mock.history[0].query).toEqual({ displayName: 'Jane', max: 3 })
    })
  })

  describe('getPerson', () => {
    it('requests a single person', async () => {
      mock.onGet(`${ BASE }/people/person-1`).reply({ id: 'person-1' })

      await expect(service.getPerson('person-1')).resolves.toEqual({ id: 'person-1' })
    })
  })

  // ── Teams ──

  describe('listTeams', () => {
    it('lists teams with the default max', async () => {
      mock.onGet(`${ BASE }/teams`).reply({ items: [] })

      const result = await service.listTeams()

      expect(result).toEqual({ items: [] })
      expect(mock.history[0].query).toEqual({ max: 50 })
    })
  })

  describe('createTeam', () => {
    it('creates a team by name', async () => {
      mock.onPost(`${ BASE }/teams`).reply({ id: 'team-1', name: 'Product' })

      const result = await service.createTeam('Product')

      expect(result).toEqual({ id: 'team-1', name: 'Product' })
      expect(mock.history[0].body).toEqual({ name: 'Product' })
    })
  })

  describe('getTeam', () => {
    it('requests a single team', async () => {
      mock.onGet(`${ BASE }/teams/team-1`).reply({ id: 'team-1' })

      await expect(service.getTeam('team-1')).resolves.toEqual({ id: 'team-1' })
    })
  })

  describe('listTeamMemberships', () => {
    it('lists team memberships from the /team/memberships endpoint', async () => {
      mock.onGet(`${ BASE }/team/memberships`).reply({ items: [] })

      const result = await service.listTeamMemberships('team-1', 25)

      expect(result).toEqual({ items: [] })
      expect(mock.history[0].url).toBe(`${ BASE }/team/memberships`)
      expect(mock.history[0].query).toEqual({ teamId: 'team-1', max: 25 })
    })
  })

  // ── Meetings ──

  describe('listMeetings', () => {
    it('lists meetings with the default max', async () => {
      mock.onGet(`${ BASE }/meetings`).reply({ items: [] })

      const result = await service.listMeetings()

      expect(result).toEqual({ items: [] })
      expect(mock.history[0].query).toEqual({ max: 50 })
    })

    it('maps the state choice label to the API value', async () => {
      mock.onGet(`${ BASE }/meetings`).reply({ items: [] })

      await service.listMeetings('In Progress', '2026-07-15T00:00:00Z', '2026-07-16T00:00:00Z', 5)

      expect(mock.history[0].query).toEqual({
        state: 'inProgress',
        from: '2026-07-15T00:00:00Z',
        to: '2026-07-16T00:00:00Z',
        max: 5,
      })
    })
  })

  describe('createMeeting', () => {
    it('creates a meeting with the required fields only', async () => {
      mock.onPost(`${ BASE }/meetings`).reply({ id: 'meeting-1' })

      const result = await service.createMeeting('Kickoff', '2026-07-15T15:00:00Z', '2026-07-15T16:00:00Z')

      expect(result).toEqual({ id: 'meeting-1' })

      expect(mock.history[0].body).toEqual({
        title: 'Kickoff',
        start: '2026-07-15T15:00:00Z',
        end: '2026-07-15T16:00:00Z',
      })
    })

    it('maps invitee emails to invitee objects', async () => {
      mock.onPost(`${ BASE }/meetings`).reply({ id: 'meeting-2' })

      await service.createMeeting(
        'Kickoff',
        '2026-07-15T15:00:00Z',
        '2026-07-15T16:00:00Z',
        'America/New_York',
        'Project kickoff',
        'secret',
        ['a@example.com', '', 'b@example.com']
      )

      expect(mock.history[0].body).toEqual({
        title: 'Kickoff',
        start: '2026-07-15T15:00:00Z',
        end: '2026-07-15T16:00:00Z',
        timezone: 'America/New_York',
        agenda: 'Project kickoff',
        password: 'secret',
        invitees: [{ email: 'a@example.com' }, { email: 'b@example.com' }],
      })
    })

    it('omits an empty invitees array', async () => {
      mock.onPost(`${ BASE }/meetings`).reply({ id: 'meeting-3' })

      await service.createMeeting('Kickoff', '2026-07-15T15:00:00Z', '2026-07-15T16:00:00Z', null, null, null, [])

      expect(mock.history[0].body).toEqual({
        title: 'Kickoff',
        start: '2026-07-15T15:00:00Z',
        end: '2026-07-15T16:00:00Z',
      })
    })
  })

  describe('getMeeting', () => {
    it('requests a single meeting', async () => {
      mock.onGet(`${ BASE }/meetings/meeting-1`).reply({ id: 'meeting-1' })

      await expect(service.getMeeting('meeting-1')).resolves.toEqual({ id: 'meeting-1' })
    })
  })

  describe('updateMeeting', () => {
    it('puts the updated meeting fields', async () => {
      mock.onPut(`${ BASE }/meetings/meeting-1`).reply({ id: 'meeting-1', title: 'Kickoff (Updated)' })

      const result = await service.updateMeeting(
        'meeting-1',
        'Kickoff (Updated)',
        '2026-07-15T16:00:00Z',
        '2026-07-15T17:00:00Z'
      )

      expect(result).toEqual({ id: 'meeting-1', title: 'Kickoff (Updated)' })
      expect(mock.history[0].method).toBe('put')

      expect(mock.history[0].body).toEqual({
        title: 'Kickoff (Updated)',
        start: '2026-07-15T16:00:00Z',
        end: '2026-07-15T17:00:00Z',
      })
    })
  })

  describe('deleteMeeting', () => {
    it('deletes a meeting and returns a success payload', async () => {
      mock.onDelete(`${ BASE }/meetings/meeting-1`).reply('')

      await expect(service.deleteMeeting('meeting-1')).resolves.toEqual({ success: true })
    })
  })

  // ── Webhooks ──

  describe('listWebhooks', () => {
    it('lists webhooks with the default max', async () => {
      mock.onGet(`${ BASE }/webhooks`).reply({ items: [] })

      const result = await service.listWebhooks()

      expect(result).toEqual({ items: [] })
      expect(mock.history[0].query).toEqual({ max: 50 })
    })
  })

  describe('createWebhook', () => {
    it('maps the resource and event choice labels to API values', async () => {
      mock.onPost(`${ BASE }/webhooks`).reply({ id: 'webhook-1' })

      const result = await service.createWebhook(
        'New messages',
        'https://example.com/hook',
        'Attachment Actions',
        'Created'
      )

      expect(result).toEqual({ id: 'webhook-1' })

      expect(mock.history[0].body).toEqual({
        name: 'New messages',
        targetUrl: 'https://example.com/hook',
        resource: 'attachmentActions',
        event: 'created',
      })
    })

    it('includes the filter and secret when provided', async () => {
      mock.onPost(`${ BASE }/webhooks`).reply({ id: 'webhook-2' })

      await service.createWebhook(
        'Room events',
        'https://example.com/hook',
        'Rooms',
        'All',
        `roomId=${ ROOM_ID }`,
        's3cret'
      )

      expect(mock.history[0].body).toEqual({
        name: 'Room events',
        targetUrl: 'https://example.com/hook',
        resource: 'rooms',
        event: 'all',
        filter: `roomId=${ ROOM_ID }`,
        secret: 's3cret',
      })
    })
  })

  describe('deleteWebhook', () => {
    it('deletes a webhook and returns a success payload', async () => {
      mock.onDelete(`${ BASE }/webhooks/webhook-1`).reply('')

      await expect(service.deleteWebhook('webhook-1')).resolves.toEqual({ success: true })
    })
  })

  // ── Dictionaries ──

  describe('getRoomsDictionary', () => {
    it('maps rooms to dictionary items and requests up to 100 rooms', async () => {
      mock.onGet(`${ BASE }/rooms`).reply({
        items: [
          { id: 'room-1', title: 'Project Alpha', type: 'group' },
          { id: 'room-2', type: 'direct' },
        ],
      })

      const result = await service.getRoomsDictionary({})

      expect(mock.history[0].query).toEqual({ max: 100 })

      expect(result).toEqual({
        items: [
          { label: 'Project Alpha', value: 'room-1', note: 'group' },
          { label: '(untitled space)', value: 'room-2', note: 'direct' },
        ],
        cursor: null,
      })
    })

    it('filters rooms case-insensitively by title', async () => {
      mock.onGet(`${ BASE }/rooms`).reply({
        items: [
          { id: 'room-1', title: 'Project Alpha', type: 'group' },
          { id: 'room-2', title: 'Random', type: 'group' },
        ],
      })

      const result = await service.getRoomsDictionary({ search: 'ALPHA' })

      expect(result.items).toEqual([{ label: 'Project Alpha', value: 'room-1', note: 'group' }])
    })

    it('handles a null payload and a response without items', async () => {
      mock.onGet(`${ BASE }/rooms`).reply({})

      await expect(service.getRoomsDictionary(null)).resolves.toEqual({ items: [], cursor: null })
    })

    it('propagates API errors', async () => {
      mock.onGet(`${ BASE }/rooms`).replyWithError({ message: 'Unauthorized', body: { message: 'token expired' } })

      await expect(service.getRoomsDictionary({})).rejects.toThrow('Cisco Webex API error: token expired')
    })
  })
})
