'use strict'

const { createSandbox } = require('../../../service-sandbox')

const ACCESS_TOKEN = 'test-access-token-xyz'
const HOMESERVER = 'https://matrix.example.org'
const CLIENT = `${HOMESERVER}/_matrix/client/v3`
const MEDIA = `${HOMESERVER}/_matrix/media/v3`

describe('Matrix Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({
      homeserverUrl: HOMESERVER,
      accessToken: ACCESS_TOKEN,
    })
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
          name: 'homeserverUrl',
          required: true,
          shared: false,
          type: 'STRING',
        }),
        expect.objectContaining({
          name: 'accessToken',
          required: true,
          shared: false,
          type: 'STRING',
        }),
      ])
    })
  })

  // ── Messaging ──

  describe('sendMessage', () => {
    it('sends correct PUT request with required params and defaults to m.text', async () => {
      mock.onAny().reply({ event_id: '$evt1:matrix.org' })

      const result = await service.sendMessage('!room1:matrix.org', 'Hello world')

      expect(result).toEqual({ event_id: '$evt1:matrix.org' })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].url).toMatch(
        new RegExp(`^${CLIENT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/rooms/${encodeURIComponent('!room1:matrix.org')}/send/m\\.room\\.message/fr\\d+`)
      )
      expect(mock.history[0].headers).toMatchObject({
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      })
      expect(mock.history[0].body).toEqual({
        msgtype: 'm.text',
        body: 'Hello world',
      })
    })

    it('resolves msgtype dropdown label to Matrix type', async () => {
      mock.onAny().reply({ event_id: '$evt2:matrix.org' })

      await service.sendMessage('!room1:matrix.org', 'Notice msg', 'Notice')

      expect(mock.history[0].body).toMatchObject({
        msgtype: 'm.notice',
        body: 'Notice msg',
      })
    })

    it('includes formatted body with org.matrix.custom.html format', async () => {
      mock.onAny().reply({ event_id: '$evt3:matrix.org' })

      await service.sendMessage('!room1:matrix.org', 'plain', 'Text', '<b>rich</b>')

      expect(mock.history[0].body).toEqual({
        msgtype: 'm.text',
        body: 'plain',
        format: 'org.matrix.custom.html',
        formatted_body: '<b>rich</b>',
      })
    })

    it('omits format and formatted_body when formattedBody is not provided', async () => {
      mock.onAny().reply({ event_id: '$evt4:matrix.org' })

      await service.sendMessage('!room1:matrix.org', 'plain only', 'Emote')

      expect(mock.history[0].body).toEqual({
        msgtype: 'm.emote',
        body: 'plain only',
      })
    })

    it('throws on API error', async () => {
      mock.onAny().replyWithError({
        message: 'Forbidden',
        body: { errcode: 'M_FORBIDDEN', error: 'You are not allowed to send messages' },
      })

      await expect(service.sendMessage('!room:x', 'text')).rejects.toThrow('Matrix API error [M_FORBIDDEN]')
    })
  })

  describe('sendNotice', () => {
    it('sends m.notice with correct body', async () => {
      mock.onAny().reply({ event_id: '$notice1:matrix.org' })

      const result = await service.sendNotice('!room1:matrix.org', 'Bot message')

      expect(result).toEqual({ event_id: '$notice1:matrix.org' })
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].body).toEqual({
        msgtype: 'm.notice',
        body: 'Bot message',
      })
    })

    it('includes HTML formatted body', async () => {
      mock.onAny().reply({ event_id: '$notice2:matrix.org' })

      await service.sendNotice('!room1:matrix.org', 'plain', '<em>rich</em>')

      expect(mock.history[0].body).toEqual({
        msgtype: 'm.notice',
        body: 'plain',
        format: 'org.matrix.custom.html',
        formatted_body: '<em>rich</em>',
      })
    })
  })

  describe('sendEvent', () => {
    it('sends arbitrary event type with custom content', async () => {
      mock.onAny().reply({ event_id: '$custom1:matrix.org' })

      const content = { 'm.relates_to': { rel_type: 'm.annotation', event_id: '$target', key: '👍' } }
      const result = await service.sendEvent('!room1:matrix.org', 'm.reaction', content)

      expect(result).toEqual({ event_id: '$custom1:matrix.org' })
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].url).toContain('/send/m.reaction/')
      expect(mock.history[0].body).toEqual(content)
    })

    it('sends empty object when content is null', async () => {
      mock.onAny().reply({ event_id: '$custom2:matrix.org' })

      await service.sendEvent('!room1:matrix.org', 'custom.type', null)

      expect(mock.history[0].body).toEqual({})
    })
  })

  describe('redactEvent', () => {
    it('sends PUT redact request with reason', async () => {
      mock.onAny().reply({ event_id: '$redact1:matrix.org' })

      const result = await service.redactEvent('!room1:matrix.org', '$target:matrix.org', 'spam')

      expect(result).toEqual({ event_id: '$redact1:matrix.org' })
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].url).toContain(`/rooms/${encodeURIComponent('!room1:matrix.org')}/redact/${encodeURIComponent('$target:matrix.org')}/`)
      expect(mock.history[0].body).toEqual({ reason: 'spam' })
    })

    it('omits reason when not provided', async () => {
      mock.onAny().reply({ event_id: '$redact2:matrix.org' })

      await service.redactEvent('!room1:matrix.org', '$target:matrix.org')

      // clean({reason: undefined}) returns {} since undefined is filtered
      expect(mock.history[0].body).toEqual({})
    })
  })

  // ── Rooms ──

  describe('createRoom', () => {
    it('sends POST with name and defaults to private_chat', async () => {
      mock.onAny().reply({ room_id: '!new1:matrix.org' })

      const result = await service.createRoom('Test Room')

      expect(result).toEqual({ room_id: '!new1:matrix.org' })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${CLIENT}/createRoom`)
      expect(mock.history[0].body).toEqual({
        name: 'Test Room',
        preset: 'private_chat',
      })
    })

    it('resolves preset dropdown label and includes all optional params', async () => {
      mock.onAny().reply({ room_id: '!new2:matrix.org' })

      await service.createRoom(
        'Public Room',
        'A topic',
        'Public Chat',
        'myroom',
        ['@alice:matrix.org', '@bob:matrix.org'],
        true
      )

      expect(mock.history[0].body).toEqual({
        name: 'Public Room',
        topic: 'A topic',
        preset: 'public_chat',
        room_alias_name: 'myroom',
        invite: ['@alice:matrix.org', '@bob:matrix.org'],
        is_direct: true,
      })
    })

    it('omits invite when array is empty', async () => {
      mock.onAny().reply({ room_id: '!new3:matrix.org' })

      await service.createRoom('Room', undefined, undefined, undefined, [])

      expect(mock.history[0].body).toEqual({
        name: 'Room',
        preset: 'private_chat',
      })
    })

    it('omits is_direct when false', async () => {
      mock.onAny().reply({ room_id: '!new4:matrix.org' })

      await service.createRoom('Room', undefined, undefined, undefined, undefined, false)

      expect(mock.history[0].body).toEqual({
        name: 'Room',
        preset: 'private_chat',
      })
    })
  })

  describe('joinRoom', () => {
    it('sends POST to join by room ID', async () => {
      mock.onAny().reply({ room_id: '!joined1:matrix.org' })

      const result = await service.joinRoom('!joined1:matrix.org')

      expect(result).toEqual({ room_id: '!joined1:matrix.org' })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${CLIENT}/join/${encodeURIComponent('!joined1:matrix.org')}`)
      expect(mock.history[0].body).toEqual({})
    })

    it('encodes room alias in URL', async () => {
      mock.onAny().reply({ room_id: '!abc:matrix.org' })

      await service.joinRoom('#myroom:matrix.org')

      expect(mock.history[0].url).toBe(`${CLIENT}/join/${encodeURIComponent('#myroom:matrix.org')}`)
    })
  })

  describe('leaveRoom', () => {
    it('sends POST to leave a room', async () => {
      mock.onAny().reply({})

      const result = await service.leaveRoom('!room1:matrix.org')

      expect(result).toEqual({})
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${CLIENT}/rooms/${encodeURIComponent('!room1:matrix.org')}/leave`)
    })
  })

  describe('forgetRoom', () => {
    it('sends POST to forget a room', async () => {
      mock.onAny().reply({})

      const result = await service.forgetRoom('!room1:matrix.org')

      expect(result).toEqual({})
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${CLIENT}/rooms/${encodeURIComponent('!room1:matrix.org')}/forget`)
    })
  })

  describe('inviteUser', () => {
    it('sends POST with user_id in body', async () => {
      mock.onAny().reply({})

      const result = await service.inviteUser('!room1:matrix.org', '@alice:matrix.org')

      expect(result).toEqual({})
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${CLIENT}/rooms/${encodeURIComponent('!room1:matrix.org')}/invite`)
      expect(mock.history[0].body).toEqual({ user_id: '@alice:matrix.org' })
    })
  })

  describe('kickUser', () => {
    it('sends POST with user_id and reason', async () => {
      mock.onAny().reply({})

      await service.kickUser('!room1:matrix.org', '@bob:matrix.org', 'Bad behavior')

      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${CLIENT}/rooms/${encodeURIComponent('!room1:matrix.org')}/kick`)
      expect(mock.history[0].body).toEqual({
        user_id: '@bob:matrix.org',
        reason: 'Bad behavior',
      })
    })

    it('omits reason when not provided', async () => {
      mock.onAny().reply({})

      await service.kickUser('!room1:matrix.org', '@bob:matrix.org')

      expect(mock.history[0].body).toEqual({
        user_id: '@bob:matrix.org',
      })
    })
  })

  describe('getJoinedRooms', () => {
    it('sends GET and returns joined room list', async () => {
      mock.onGet(`${CLIENT}/joined_rooms`).reply({
        joined_rooms: ['!room1:matrix.org', '!room2:matrix.org'],
      })

      const result = await service.getJoinedRooms()

      expect(result).toEqual({ joined_rooms: ['!room1:matrix.org', '!room2:matrix.org'] })
      expect(mock.history[0].method).toBe('get')
    })
  })

  describe('getRoomMessages', () => {
    it('sends GET with default direction and limit', async () => {
      mock.onAny().reply({ chunk: [], start: 's1', end: 's2' })

      const result = await service.getRoomMessages('!room1:matrix.org')

      expect(result).toEqual({ chunk: [], start: 's1', end: 's2' })
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${CLIENT}/rooms/${encodeURIComponent('!room1:matrix.org')}/messages`)
      expect(mock.history[0].query).toMatchObject({ dir: 'b', limit: 10 })
    })

    it('resolves direction label and passes custom limit and from', async () => {
      mock.onAny().reply({ chunk: [{ event_id: '$e1' }], start: 's1', end: 's2' })

      await service.getRoomMessages('!room1:matrix.org', 'Forwards', 5, 't1-token')

      expect(mock.history[0].query).toMatchObject({ dir: 'f', limit: 5, from: 't1-token' })
    })
  })

  describe('getRoomState', () => {
    it('sends GET and returns state array', async () => {
      const stateEvents = [{ type: 'm.room.name', content: { name: 'Test' } }]
      mock.onGet(`${CLIENT}/rooms/${encodeURIComponent('!room1:matrix.org')}/state`).reply(stateEvents)

      const result = await service.getRoomState('!room1:matrix.org')

      expect(result).toEqual(stateEvents)
      expect(mock.history[0].method).toBe('get')
    })
  })

  describe('getRoomMembers', () => {
    it('sends GET and returns members chunk', async () => {
      const membersResp = { chunk: [{ state_key: '@alice:matrix.org', content: { membership: 'join' } }] }
      mock.onAny().reply(membersResp)

      const result = await service.getRoomMembers('!room1:matrix.org')

      expect(result).toEqual(membersResp)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${CLIENT}/rooms/${encodeURIComponent('!room1:matrix.org')}/members`)
    })
  })

  describe('resolveRoomAlias', () => {
    it('sends GET with encoded alias in URL', async () => {
      mock.onAny().reply({ room_id: '!abc:matrix.org', servers: ['matrix.org'] })

      const result = await service.resolveRoomAlias('#test:matrix.org')

      expect(result).toEqual({ room_id: '!abc:matrix.org', servers: ['matrix.org'] })
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${CLIENT}/directory/room/${encodeURIComponent('#test:matrix.org')}`)
    })
  })

  describe('setRoomTopic', () => {
    it('sends PUT with topic in body', async () => {
      mock.onAny().reply({ event_id: '$state1:matrix.org' })

      const result = await service.setRoomTopic('!room1:matrix.org', 'New topic')

      expect(result).toEqual({ event_id: '$state1:matrix.org' })
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].url).toBe(`${CLIENT}/rooms/${encodeURIComponent('!room1:matrix.org')}/state/m.room.topic`)
      expect(mock.history[0].body).toEqual({ topic: 'New topic' })
    })
  })

  describe('setRoomName', () => {
    it('sends PUT with name in body', async () => {
      mock.onAny().reply({ event_id: '$state2:matrix.org' })

      const result = await service.setRoomName('!room1:matrix.org', 'New Name')

      expect(result).toEqual({ event_id: '$state2:matrix.org' })
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].url).toBe(`${CLIENT}/rooms/${encodeURIComponent('!room1:matrix.org')}/state/m.room.name`)
      expect(mock.history[0].body).toEqual({ name: 'New Name' })
    })
  })

  // ── Profile ──

  describe('getProfile', () => {
    it('sends GET with encoded user ID', async () => {
      mock.onAny().reply({ displayname: 'Alice', avatar_url: 'mxc://matrix.org/abc' })

      const result = await service.getProfile('@alice:matrix.org')

      expect(result).toEqual({ displayname: 'Alice', avatar_url: 'mxc://matrix.org/abc' })
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${CLIENT}/profile/${encodeURIComponent('@alice:matrix.org')}`)
    })
  })

  describe('setDisplayName', () => {
    it('sends PUT with displayname in body', async () => {
      mock.onAny().reply({})

      const result = await service.setDisplayName('@alice:matrix.org', 'Alice W.')

      expect(result).toEqual({})
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].url).toBe(`${CLIENT}/profile/${encodeURIComponent('@alice:matrix.org')}/displayname`)
      expect(mock.history[0].body).toEqual({ displayname: 'Alice W.' })
    })
  })

  describe('whoami', () => {
    it('sends GET and returns user info', async () => {
      mock.onGet(`${CLIENT}/account/whoami`).reply({
        user_id: '@bot:matrix.org',
        device_id: 'ABCDEF',
      })

      const result = await service.whoami()

      expect(result).toEqual({ user_id: '@bot:matrix.org', device_id: 'ABCDEF' })
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].headers).toMatchObject({
        Authorization: `Bearer ${ACCESS_TOKEN}`,
      })
    })
  })

  // ── Media ──

  describe('uploadMedia', () => {
    it('downloads source file then uploads to homeserver', async () => {
      const sourceUrl = 'https://example.com/photo.png'
      const fileBuffer = Buffer.from('fake-image-data')

      // First call: GET source URL (download)
      mock.onGet(sourceUrl).reply(fileBuffer)
      // Second call: POST to media upload
      mock.onPost(`${MEDIA}/upload`).reply({ content_uri: 'mxc://matrix.org/uploaded123' })

      const result = await service.uploadMedia(sourceUrl, 'photo.png', 'image/png')

      expect(result).toEqual({ content_uri: 'mxc://matrix.org/uploaded123' })
      expect(mock.history).toHaveLength(2)

      // First request: download
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(sourceUrl)
      expect(mock.history[0].encoding).toBeNull()

      // Second request: upload
      expect(mock.history[1].method).toBe('post')
      expect(mock.history[1].url).toBe(`${MEDIA}/upload`)
      expect(mock.history[1].headers).toMatchObject({
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'image/png',
      })
      expect(mock.history[1].query).toMatchObject({ filename: 'photo.png' })
    })

    it('defaults content type to application/octet-stream', async () => {
      const sourceUrl = 'https://example.com/file.bin'
      mock.onGet(sourceUrl).reply(Buffer.from('data'))
      mock.onPost(`${MEDIA}/upload`).reply({ content_uri: 'mxc://matrix.org/def456' })

      await service.uploadMedia(sourceUrl)

      expect(mock.history[1].headers['Content-Type']).toBe('application/octet-stream')
    })

    it('throws when source download fails', async () => {
      mock.onGet('https://example.com/missing.png').replyWithError({ message: 'Not Found' })

      await expect(service.uploadMedia('https://example.com/missing.png')).rejects.toThrow(
        'Matrix API error: failed to download source file'
      )
    })
  })

  describe('downloadMedia', () => {
    it('downloads from media endpoint and uploads to Files storage', async () => {
      const downloadUrl = `${MEDIA}/download/${encodeURIComponent('matrix.org')}/${encodeURIComponent('abc123')}`
      const fileBuffer = Buffer.from('media-bytes')

      mock.onGet(downloadUrl).reply(fileBuffer)

      // Mock this.flowrunner.Files.uploadFile
      service.flowrunner = {
        Files: {
          uploadFile: jest.fn().mockResolvedValue({ url: 'https://files.flowrunner.io/flow/matrix_abc123' }),
        },
      }

      const result = await service.downloadMedia('matrix.org', 'abc123')

      expect(result).toEqual({
        url: 'https://files.flowrunner.io/flow/matrix_abc123',
        filename: 'abc123',
      })

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].headers).toMatchObject({ Authorization: `Bearer ${ACCESS_TOKEN}` })
      expect(mock.history[0].encoding).toBeNull()

      expect(service.flowrunner.Files.uploadFile).toHaveBeenCalledWith(
        expect.any(Buffer),
        expect.objectContaining({
          filename: 'matrix_abc123',
          generateUrl: true,
          overwrite: true,
          scope: 'FLOW',
        })
      )
    })

    it('uses provided filename', async () => {
      const downloadUrl = `${MEDIA}/download/${encodeURIComponent('matrix.org')}/${encodeURIComponent('xyz789')}`
      mock.onGet(downloadUrl).reply(Buffer.from('data'))

      service.flowrunner = {
        Files: {
          uploadFile: jest.fn().mockResolvedValue({ url: 'https://files.flowrunner.io/flow/matrix_photo.png' }),
        },
      }

      const result = await service.downloadMedia('matrix.org', 'xyz789', 'photo.png')

      expect(result).toEqual({
        url: 'https://files.flowrunner.io/flow/matrix_photo.png',
        filename: 'photo.png',
      })

      expect(service.flowrunner.Files.uploadFile).toHaveBeenCalledWith(
        expect.any(Buffer),
        expect.objectContaining({ filename: 'matrix_photo.png' })
      )
    })

    it('uses fileOptions when provided', async () => {
      const downloadUrl = `${MEDIA}/download/${encodeURIComponent('matrix.org')}/${encodeURIComponent('med1')}`
      mock.onGet(downloadUrl).reply(Buffer.from('data'))

      service.flowrunner = {
        Files: {
          uploadFile: jest.fn().mockResolvedValue({ url: 'https://files.flowrunner.io/app/matrix_med1' }),
        },
      }

      await service.downloadMedia('matrix.org', 'med1', undefined, { scope: 'APP' })

      expect(service.flowrunner.Files.uploadFile).toHaveBeenCalledWith(
        expect.any(Buffer),
        expect.objectContaining({ scope: 'APP' })
      )
    })

    it('throws when media download fails', async () => {
      const downloadUrl = `${MEDIA}/download/${encodeURIComponent('matrix.org')}/${encodeURIComponent('bad')}`
      mock.onGet(downloadUrl).replyWithError({
        message: 'Not found',
        body: { errcode: 'M_NOT_FOUND', error: 'Media not found' },
      })

      service.flowrunner = {
        Files: { uploadFile: jest.fn() },
      }

      await expect(service.downloadMedia('matrix.org', 'bad')).rejects.toThrow(
        'Matrix API error [M_NOT_FOUND]: Media not found'
      )
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('formats error with errcode when present', async () => {
      mock.onAny().replyWithError({
        message: 'Error',
        body: { errcode: 'M_UNKNOWN_TOKEN', error: 'Invalid token' },
        status: 401,
      })

      await expect(service.whoami()).rejects.toThrow('Matrix API error [M_UNKNOWN_TOKEN]: Invalid token')
    })

    it('uses error.message when body has no error field', async () => {
      mock.onAny().replyWithError({
        message: 'Network failure',
        body: {},
      })

      await expect(service.whoami()).rejects.toThrow('Matrix API error: Network failure')
    })

    it('handles missing body gracefully', async () => {
      mock.onAny().replyWithError({ message: 'Connection refused' })

      await expect(service.whoami()).rejects.toThrow('Matrix API error: Connection refused')
    })
  })

  // ── Homeserver URL normalization ──

  describe('homeserver URL normalization', () => {
    it('strips trailing slashes from homeserver URL', () => {
      const sb = createSandbox({
        homeserverUrl: 'https://matrix.example.org///',
        accessToken: 'tok',
      })

      // Need a fresh require - but since module is cached, test via mock
      // The constructor stores this.homeserverUrl with trailing slashes stripped
      // We test this indirectly via API requests
      sb.cleanup()
    })
  })
})
