'use strict'

const { createSandbox } = require('../../../service-sandbox')

const SERVER_URL = 'https://chat.example.com'
const USER_ID = 'test-user-id'
const AUTH_TOKEN = 'test-auth-token'
const BASE = `${SERVER_URL}/api/v1`

const AUTH_HEADERS = {
  'X-Auth-Token': AUTH_TOKEN,
  'X-User-Id': USER_ID,
  'Content-Type': 'application/json',
}

describe('RocketChat Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ serverUrl: SERVER_URL, userId: USER_ID, authToken: AUTH_TOKEN })
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
      const configs = sandbox.getConfigItems()

      expect(configs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'serverUrl', required: true, shared: false }),
          expect.objectContaining({ name: 'userId', required: true, shared: false }),
          expect.objectContaining({ name: 'authToken', required: true, shared: false }),
        ])
      )
    })
  })

  // ── Messages ──

  describe('postMessage', () => {
    it('sends POST with required channel and text', async () => {
      mock.onPost(`${BASE}/chat.postMessage`).reply({ success: true, message: { _id: 'msg1' } })

      const result = await service.postMessage('#general', 'Hello world')

      expect(result).toMatchObject({ success: true })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject(AUTH_HEADERS)
      expect(mock.history[0].body).toEqual({ channel: '#general', text: 'Hello world' })
    })

    it('includes optional alias, emoji, avatar, and attachments', async () => {
      mock.onPost(`${BASE}/chat.postMessage`).reply({ success: true })

      const attachments = [{ title: 'File', text: 'content' }]
      await service.postMessage('#general', 'Hi', 'Bot', ':robot:', 'https://img.test/a.png', attachments)

      expect(mock.history[0].body).toEqual({
        channel: '#general',
        text: 'Hi',
        alias: 'Bot',
        emoji: ':robot:',
        avatar: 'https://img.test/a.png',
        attachments,
      })
    })

    it('omits optional fields when not provided', async () => {
      mock.onPost(`${BASE}/chat.postMessage`).reply({ success: true })

      await service.postMessage('#general', 'Hi')

      expect(mock.history[0].body).toEqual({ channel: '#general', text: 'Hi' })
    })

    it('throws on API error', async () => {
      mock.onPost(`${BASE}/chat.postMessage`).replyWithError({
        message: 'Bad Request',
        body: { error: 'Channel not found' },
      })

      await expect(service.postMessage('#nonexistent', 'Hi')).rejects.toThrow('Rocket.Chat API error')
    })
  })

  describe('sendMessage', () => {
    it('sends POST with rid and msg', async () => {
      mock.onPost(`${BASE}/chat.sendMessage`).reply({ success: true, message: { _id: 'msg1' } })

      await service.sendMessage('room1', 'Hello')

      expect(mock.history[0].body).toEqual({ message: { rid: 'room1', msg: 'Hello' } })
    })

    it('includes optional messageId', async () => {
      mock.onPost(`${BASE}/chat.sendMessage`).reply({ success: true })

      await service.sendMessage('room1', 'Hello', 'custom-id')

      expect(mock.history[0].body).toEqual({ message: { rid: 'room1', msg: 'Hello', _id: 'custom-id' } })
    })

    it('omits messageId when not provided', async () => {
      mock.onPost(`${BASE}/chat.sendMessage`).reply({ success: true })

      await service.sendMessage('room1', 'Hello')

      expect(mock.history[0].body.message).not.toHaveProperty('_id')
    })
  })

  describe('updateMessage', () => {
    it('sends POST with roomId, msgId, and text', async () => {
      mock.onPost(`${BASE}/chat.update`).reply({ success: true, message: { _id: 'msg1' } })

      await service.updateMessage('room1', 'msg1', 'Updated text')

      expect(mock.history[0].body).toEqual({ roomId: 'room1', msgId: 'msg1', text: 'Updated text' })
    })

    it('throws on error', async () => {
      mock.onPost(`${BASE}/chat.update`).replyWithError({ message: 'Not found' })

      await expect(service.updateMessage('room1', 'msg1', 'x')).rejects.toThrow('Rocket.Chat API error')
    })
  })

  describe('deleteMessage', () => {
    it('sends POST with roomId and msgId', async () => {
      mock.onPost(`${BASE}/chat.delete`).reply({ _id: 'msg1', success: true })

      await service.deleteMessage('room1', 'msg1')

      expect(mock.history[0].body).toEqual({ roomId: 'room1', msgId: 'msg1' })
    })
  })

  describe('getChannelMessages', () => {
    it('sends GET with roomId only', async () => {
      mock.onGet(`${BASE}/channels.history`).reply({ messages: [], success: true })

      const result = await service.getChannelMessages('room1')

      expect(result).toMatchObject({ messages: [], success: true })
      expect(mock.history[0].query).toEqual({ roomId: 'room1' })
    })

    it('includes count, oldest, and latest when provided', async () => {
      mock.onGet(`${BASE}/channels.history`).reply({ messages: [], success: true })

      await service.getChannelMessages('room1', 10, '2024-01-01T00:00:00Z', '2024-12-31T23:59:59Z')

      expect(mock.history[0].query).toEqual({
        roomId: 'room1',
        count: 10,
        oldest: '2024-01-01T00:00:00Z',
        latest: '2024-12-31T23:59:59Z',
      })
    })
  })

  describe('pinMessage', () => {
    it('sends POST with messageId', async () => {
      mock.onPost(`${BASE}/chat.pinMessage`).reply({ success: true })

      await service.pinMessage('msg1')

      expect(mock.history[0].body).toEqual({ messageId: 'msg1' })
    })
  })

  describe('starMessage', () => {
    it('sends POST with messageId', async () => {
      mock.onPost(`${BASE}/chat.starMessage`).reply({ success: true })

      await service.starMessage('msg1')

      expect(mock.history[0].body).toEqual({ messageId: 'msg1' })
    })
  })

  describe('react', () => {
    it('sends POST with messageId and emoji', async () => {
      mock.onPost(`${BASE}/chat.react`).reply({ success: true })

      await service.react('msg1', ':thumbsup:')

      expect(mock.history[0].body).toEqual({ messageId: 'msg1', emoji: ':thumbsup:' })
    })
  })

  // ── Channels ──

  describe('createChannel', () => {
    it('sends POST with name only', async () => {
      mock.onPost(`${BASE}/channels.create`).reply({ channel: { _id: 'ch1', name: 'test' }, success: true })

      const result = await service.createChannel('test')

      expect(result).toMatchObject({ success: true, channel: { _id: 'ch1' } })
      expect(mock.history[0].body).toEqual({ name: 'test' })
    })

    it('includes members when provided', async () => {
      mock.onPost(`${BASE}/channels.create`).reply({ success: true })

      await service.createChannel('test', ['user1', 'user2'])

      expect(mock.history[0].body).toEqual({ name: 'test', members: ['user1', 'user2'] })
    })
  })

  describe('getChannelInfo', () => {
    it('sends GET with roomName', async () => {
      mock.onGet(`${BASE}/channels.info`).reply({ channel: { _id: 'ch1' }, success: true })

      await service.getChannelInfo('general')

      expect(mock.history[0].query).toEqual({ roomName: 'general' })
    })

    it('sends GET with roomId', async () => {
      mock.onGet(`${BASE}/channels.info`).reply({ channel: { _id: 'ch1' }, success: true })

      await service.getChannelInfo(undefined, 'ch1')

      expect(mock.history[0].query).toEqual({ roomId: 'ch1' })
    })
  })

  describe('listChannels', () => {
    it('sends GET with default (no params)', async () => {
      mock.onGet(`${BASE}/channels.list`).reply({ channels: [], total: 0, success: true })

      const result = await service.listChannels()

      expect(result).toMatchObject({ channels: [], success: true })
      expect(mock.history[0].query).toEqual({})
    })

    it('passes count and offset', async () => {
      mock.onGet(`${BASE}/channels.list`).reply({ channels: [], success: true })

      await service.listChannels(10, 20)

      expect(mock.history[0].query).toEqual({ count: 10, offset: 20 })
    })
  })

  describe('archiveChannel', () => {
    it('sends POST with roomId', async () => {
      mock.onPost(`${BASE}/channels.archive`).reply({ success: true })

      await service.archiveChannel('ch1')

      expect(mock.history[0].body).toEqual({ roomId: 'ch1' })
    })
  })

  describe('deleteChannel', () => {
    it('sends POST with roomId', async () => {
      mock.onPost(`${BASE}/channels.delete`).reply({ success: true })

      await service.deleteChannel('ch1')

      expect(mock.history[0].body).toEqual({ roomId: 'ch1' })
    })
  })

  describe('inviteUser', () => {
    it('sends POST with roomId and userId', async () => {
      mock.onPost(`${BASE}/channels.invite`).reply({ success: true })

      await service.inviteUser('ch1', 'u1')

      expect(mock.history[0].body).toEqual({ roomId: 'ch1', userId: 'u1' })
    })
  })

  describe('kickUser', () => {
    it('sends POST with roomId and userId', async () => {
      mock.onPost(`${BASE}/channels.kick`).reply({ success: true })

      await service.kickUser('ch1', 'u1')

      expect(mock.history[0].body).toEqual({ roomId: 'ch1', userId: 'u1' })
    })
  })

  describe('setTopic', () => {
    it('sends POST with roomId and topic', async () => {
      mock.onPost(`${BASE}/channels.setTopic`).reply({ topic: 'New topic', success: true })

      const result = await service.setTopic('ch1', 'New topic')

      expect(result).toMatchObject({ topic: 'New topic', success: true })
      expect(mock.history[0].body).toEqual({ roomId: 'ch1', topic: 'New topic' })
    })
  })

  describe('setAnnouncement', () => {
    it('sends POST with roomId and announcement', async () => {
      mock.onPost(`${BASE}/channels.setAnnouncement`).reply({ announcement: 'Hello', success: true })

      await service.setAnnouncement('ch1', 'Hello')

      expect(mock.history[0].body).toEqual({ roomId: 'ch1', announcement: 'Hello' })
    })
  })

  // ── Groups ──

  describe('createGroup', () => {
    it('sends POST with name only', async () => {
      mock.onPost(`${BASE}/groups.create`).reply({ group: { _id: 'gr1' }, success: true })

      await service.createGroup('private-team')

      expect(mock.history[0].body).toEqual({ name: 'private-team' })
    })

    it('includes members when provided', async () => {
      mock.onPost(`${BASE}/groups.create`).reply({ success: true })

      await service.createGroup('private-team', ['alice', 'bob'])

      expect(mock.history[0].body).toEqual({ name: 'private-team', members: ['alice', 'bob'] })
    })
  })

  describe('getGroupInfo', () => {
    it('sends GET with roomName', async () => {
      mock.onGet(`${BASE}/groups.info`).reply({ group: { _id: 'gr1' }, success: true })

      await service.getGroupInfo('leadership')

      expect(mock.history[0].query).toEqual({ roomName: 'leadership' })
    })

    it('sends GET with roomId', async () => {
      mock.onGet(`${BASE}/groups.info`).reply({ group: { _id: 'gr1' }, success: true })

      await service.getGroupInfo(undefined, 'gr1')

      expect(mock.history[0].query).toEqual({ roomId: 'gr1' })
    })
  })

  describe('listGroups', () => {
    it('sends GET with default (no params)', async () => {
      mock.onGet(`${BASE}/groups.list`).reply({ groups: [], success: true })

      await service.listGroups()

      expect(mock.history[0].query).toEqual({})
    })

    it('passes count and offset', async () => {
      mock.onGet(`${BASE}/groups.list`).reply({ groups: [], success: true })

      await service.listGroups(5, 10)

      expect(mock.history[0].query).toEqual({ count: 5, offset: 10 })
    })
  })

  // ── Direct Messages ──

  describe('createDirectMessage', () => {
    it('sends POST with username', async () => {
      mock.onPost(`${BASE}/im.create`).reply({ room: { _id: 'rid1' }, success: true })

      const result = await service.createDirectMessage('john')

      expect(result).toMatchObject({ room: { _id: 'rid1' }, success: true })
      expect(mock.history[0].body).toEqual({ username: 'john' })
    })
  })

  describe('sendDirectMessage', () => {
    it('sends POST with @-prefixed channel for username without @', async () => {
      mock.onPost(`${BASE}/chat.postMessage`).reply({ success: true })

      await service.sendDirectMessage('john', 'Hi there')

      expect(mock.history[0].body).toEqual({ channel: '@john', text: 'Hi there' })
    })

    it('does not double-prefix when username starts with @', async () => {
      mock.onPost(`${BASE}/chat.postMessage`).reply({ success: true })

      await service.sendDirectMessage('@john', 'Hi there')

      expect(mock.history[0].body).toEqual({ channel: '@john', text: 'Hi there' })
    })

    it('includes optional alias, emoji, avatar', async () => {
      mock.onPost(`${BASE}/chat.postMessage`).reply({ success: true })

      await service.sendDirectMessage('john', 'Hi', 'Bot', ':wave:', 'https://img.test/a.png')

      expect(mock.history[0].body).toEqual({
        channel: '@john',
        text: 'Hi',
        alias: 'Bot',
        emoji: ':wave:',
        avatar: 'https://img.test/a.png',
      })
    })
  })

  // ── Users ──

  describe('getUserInfo', () => {
    it('sends GET with userId', async () => {
      mock.onGet(`${BASE}/users.info`).reply({ user: { _id: 'u1', username: 'john' }, success: true })

      const result = await service.getUserInfo('u1')

      expect(result).toMatchObject({ user: { _id: 'u1' }, success: true })
      expect(mock.history[0].query).toEqual({ userId: 'u1' })
    })

    it('sends GET with username', async () => {
      mock.onGet(`${BASE}/users.info`).reply({ user: { _id: 'u1' }, success: true })

      await service.getUserInfo(undefined, 'john')

      expect(mock.history[0].query).toEqual({ username: 'john' })
    })
  })

  describe('createUser', () => {
    it('sends POST with email, name, password, username', async () => {
      mock.onPost(`${BASE}/users.create`).reply({ user: { _id: 'u2' }, success: true })

      await service.createUser('jane@example.com', 'Jane', 'pass123', 'jane')

      expect(mock.history[0].body).toEqual({
        email: 'jane@example.com',
        name: 'Jane',
        password: 'pass123',
        username: 'jane',
      })
    })
  })

  describe('getMe', () => {
    it('sends GET with no params', async () => {
      mock.onGet(`${BASE}/me`).reply({ _id: 'u1', username: 'bot', success: true })

      const result = await service.getMe()

      expect(result).toMatchObject({ _id: 'u1', username: 'bot', success: true })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject(AUTH_HEADERS)
    })
  })

  describe('setUserStatus', () => {
    it('resolves status choice to lowercase', async () => {
      mock.onPost(`${BASE}/users.setStatus`).reply({ success: true })

      await service.setUserStatus('Busy')

      expect(mock.history[0].body).toEqual({ status: 'busy' })
    })

    it('includes optional message', async () => {
      mock.onPost(`${BASE}/users.setStatus`).reply({ success: true })

      await service.setUserStatus('Away', 'On break')

      expect(mock.history[0].body).toEqual({ status: 'away', message: 'On break' })
    })

    it('passes through unknown status values unchanged', async () => {
      mock.onPost(`${BASE}/users.setStatus`).reply({ success: true })

      await service.setUserStatus('custom-status')

      expect(mock.history[0].body).toEqual({ status: 'custom-status' })
    })
  })

  describe('updateUser', () => {
    it('sends POST with userId and data object', async () => {
      mock.onPost(`${BASE}/users.update`).reply({ user: { _id: 'u1' }, success: true })

      const data = { name: 'New Name', email: 'new@example.com' }
      await service.updateUser('u1', data)

      expect(mock.history[0].body).toEqual({ userId: 'u1', data })
    })
  })

  // ── Files ──

  describe('uploadFileToRoom', () => {
    it('downloads file and uploads via multipart', async () => {
      const fileBuffer = Buffer.from('file-content')
      mock.onGet('https://files.test/report.pdf').reply(fileBuffer)
      mock.onPost(`${BASE}/rooms.upload/room1`).reply({ message: { _id: 'msg1' }, success: true })

      const result = await service.uploadFileToRoom('room1', 'https://files.test/report.pdf')

      expect(result).toMatchObject({ success: true })
      expect(mock.history).toHaveLength(2)
      // First request: file download
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe('https://files.test/report.pdf')
      expect(mock.history[0].encoding).toBeNull()
      // Second request: multipart upload
      expect(mock.history[1].method).toBe('post')
      expect(mock.history[1].formData).toBeDefined()
      expect(mock.history[1].headers).toMatchObject({
        'X-Auth-Token': AUTH_TOKEN,
        'X-User-Id': USER_ID,
      })
    })

    it('uses provided fileName', async () => {
      mock.onGet('https://files.test/report.pdf').reply(Buffer.from('data'))
      mock.onPost(`${BASE}/rooms.upload/room1`).reply({ success: true })

      await service.uploadFileToRoom('room1', 'https://files.test/report.pdf', 'custom-name.pdf')

      expect(mock.history[1].formData).toBeDefined()
    })

    it('includes optional msg and description in form data', async () => {
      mock.onGet('https://files.test/file.txt').reply(Buffer.from('data'))
      mock.onPost(`${BASE}/rooms.upload/room1`).reply({ success: true })

      await service.uploadFileToRoom('room1', 'https://files.test/file.txt', null, 'Check this', 'A description')

      expect(mock.history[1].formData).toBeDefined()
    })

    it('throws on download error', async () => {
      mock.onGet('https://files.test/missing.pdf').replyWithError({ message: 'Not Found' })

      await expect(
        service.uploadFileToRoom('room1', 'https://files.test/missing.pdf')
      ).rejects.toThrow('Rocket.Chat API error')
    })
  })

  // ── Unwrap error handling ──

  describe('API success=false handling', () => {
    it('throws when response has success: false with error field', async () => {
      mock.onGet(`${BASE}/me`).reply({ success: false, error: 'Invalid token' })

      await expect(service.getMe()).rejects.toThrow('Rocket.Chat API error: Invalid token')
    })

    it('throws when response has success: false with errorType field', async () => {
      mock.onGet(`${BASE}/me`).reply({ success: false, errorType: 'auth-failure' })

      await expect(service.getMe()).rejects.toThrow('Rocket.Chat API error: auth-failure')
    })

    it('uses fallback message when no error details', async () => {
      mock.onGet(`${BASE}/me`).reply({ success: false })

      await expect(service.getMe()).rejects.toThrow('Rocket.Chat API error: Request failed')
    })
  })

  // ── Dictionaries ──

  describe('getChannelsDictionary', () => {
    it('returns mapped items with label and value', async () => {
      mock.onGet(`${BASE}/channels.list`).reply({
        channels: [
          { _id: 'ch1', name: 'general' },
          { _id: 'ch2', name: 'random' },
        ],
        success: true,
      })

      const result = await service.getChannelsDictionary({})

      expect(result.items).toEqual([
        { label: 'general', value: 'ch1', note: 'Channel' },
        { label: 'random', value: 'ch2', note: 'Channel' },
      ])
    })

    it('filters by case-insensitive search', async () => {
      mock.onGet(`${BASE}/channels.list`).reply({
        channels: [
          { _id: 'ch1', name: 'general' },
          { _id: 'ch2', name: 'random' },
        ],
        success: true,
      })

      const result = await service.getChannelsDictionary({ search: 'GEN' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('ch1')
    })

    it('handles null payload', async () => {
      mock.onGet(`${BASE}/channels.list`).reply({ channels: [{ _id: 'ch1', name: 'gen' }], success: true })

      const result = await service.getChannelsDictionary(null)

      expect(result.items).toHaveLength(1)
    })

    it('handles empty channels array', async () => {
      mock.onGet(`${BASE}/channels.list`).reply({ channels: [], success: true })

      const result = await service.getChannelsDictionary({})

      expect(result).toEqual({ items: [], cursor: undefined })
    })

    it('handles missing channels in response', async () => {
      mock.onGet(`${BASE}/channels.list`).reply({ success: true })

      const result = await service.getChannelsDictionary({})

      expect(result).toEqual({ items: [], cursor: undefined })
    })

    it('returns cursor when page is full', async () => {
      const channels = Array.from({ length: 50 }, (_, i) => ({ _id: `ch${i}`, name: `ch-${i}` }))
      mock.onGet(`${BASE}/channels.list`).reply({ channels, success: true })

      const result = await service.getChannelsDictionary({})

      expect(result.cursor).toBe('50')
    })

    it('returns no cursor when page is not full', async () => {
      mock.onGet(`${BASE}/channels.list`).reply({
        channels: [{ _id: 'ch1', name: 'general' }],
        success: true,
      })

      const result = await service.getChannelsDictionary({})

      expect(result.cursor).toBeUndefined()
    })

    it('uses cursor for pagination offset', async () => {
      mock.onGet(`${BASE}/channels.list`).reply({ channels: [], success: true })

      await service.getChannelsDictionary({ cursor: '100' })

      expect(mock.history[0].query).toMatchObject({ count: 50, offset: 100 })
    })
  })

  describe('getUsersDictionary', () => {
    it('returns mapped items with label, value, and note', async () => {
      mock.onGet(`${BASE}/users.list`).reply({
        users: [
          { _id: 'u1', name: 'John Doe', username: 'john' },
          { _id: 'u2', name: 'Jane', username: 'jane' },
        ],
        success: true,
      })

      const result = await service.getUsersDictionary({})

      expect(result.items).toEqual([
        { label: 'John Doe', value: 'u1', note: '@john' },
        { label: 'Jane', value: 'u2', note: '@jane' },
      ])
    })

    it('falls back to username when name is missing', async () => {
      mock.onGet(`${BASE}/users.list`).reply({
        users: [{ _id: 'u1', username: 'john' }],
        success: true,
      })

      const result = await service.getUsersDictionary({})

      expect(result.items[0].label).toBe('john')
    })

    it('sends search as query JSON when provided', async () => {
      mock.onGet(`${BASE}/users.list`).reply({ users: [], success: true })

      await service.getUsersDictionary({ search: 'john' })

      const queryParam = mock.history[0].query.query
      expect(queryParam).toBeDefined()
      const parsed = JSON.parse(queryParam)
      expect(parsed).toHaveProperty('$or')
      expect(parsed.$or).toHaveLength(2)
    })

    it('does not send query param when no search', async () => {
      mock.onGet(`${BASE}/users.list`).reply({ users: [], success: true })

      await service.getUsersDictionary({})

      expect(mock.history[0].query).not.toHaveProperty('query')
    })

    it('handles null payload', async () => {
      mock.onGet(`${BASE}/users.list`).reply({ users: [{ _id: 'u1', username: 'a', name: 'A' }], success: true })

      const result = await service.getUsersDictionary(null)

      expect(result.items).toHaveLength(1)
    })

    it('handles missing users in response', async () => {
      mock.onGet(`${BASE}/users.list`).reply({ success: true })

      const result = await service.getUsersDictionary({})

      expect(result).toEqual({ items: [], cursor: undefined })
    })

    it('returns cursor when page is full', async () => {
      const users = Array.from({ length: 50 }, (_, i) => ({ _id: `u${i}`, username: `u${i}`, name: `User ${i}` }))
      mock.onGet(`${BASE}/users.list`).reply({ users, success: true })

      const result = await service.getUsersDictionary({})

      expect(result.cursor).toBe('50')
    })

    it('uses cursor for pagination offset', async () => {
      mock.onGet(`${BASE}/users.list`).reply({ users: [], success: true })

      await service.getUsersDictionary({ cursor: '50' })

      expect(mock.history[0].query).toMatchObject({ count: 50, offset: 50 })
    })
  })

})
