'use strict'

const { createSandbox } = require('../../../service-sandbox')

const SERVER_URL = 'https://mattermost.example.com'
const ACCESS_TOKEN = 'test-access-token'
const BASE = `${SERVER_URL}/api/v4`

// Helper: install a fake Files API on the service so methods that use
// this.flowrunner.Files.uploadFile resolve to a predictable URL. The sandbox
// does NOT provide this.flowrunner — it is runtime-injected by FlowRunner.
function stubFiles(service, url = 'https://files.example.com/mattermost/file.bin') {
  const calls = []

  service.flowrunner = {
    Files: {
      uploadFile: async (buffer, options) => {
        calls.push({ buffer, options })

        return { url }
      },
    },
  }

  return calls
}

describe('Mattermost Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ serverUrl: SERVER_URL, accessToken: ACCESS_TOKEN })
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
      const configItems = sandbox.getConfigItems()

      expect(configItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'serverUrl', required: true, shared: false }),
          expect.objectContaining({ name: 'accessToken', required: true, shared: false }),
        ])
      )
    })
  })

  // ── Posts ──

  describe('createPost', () => {
    it('sends POST with required fields', async () => {
      mock.onPost(`${BASE}/posts`).reply({ id: 'post123', channel_id: 'chan1', message: 'Hello' })

      const result = await service.createPost('chan1', 'Hello')

      expect(result).toEqual({ id: 'post123', channel_id: 'chan1', message: 'Hello' })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].headers).toMatchObject({
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      })
      expect(mock.history[0].body).toMatchObject({
        channel_id: 'chan1',
        message: 'Hello',
      })
    })

    it('includes rootId for threaded replies', async () => {
      mock.onPost(`${BASE}/posts`).reply({ id: 'post124', root_id: 'post100' })

      await service.createPost('chan1', 'Reply', 'post100')

      expect(mock.history[0].body).toMatchObject({
        channel_id: 'chan1',
        message: 'Reply',
        root_id: 'post100',
      })
    })

    it('includes file_ids when provided as a non-empty array', async () => {
      mock.onPost(`${BASE}/posts`).reply({ id: 'post125' })

      await service.createPost('chan1', 'With files', undefined, ['file1', 'file2'])

      expect(mock.history[0].body.file_ids).toEqual(['file1', 'file2'])
    })

    it('omits file_ids when array is empty', async () => {
      mock.onPost(`${BASE}/posts`).reply({ id: 'post126' })

      await service.createPost('chan1', 'No files', undefined, [])

      expect(mock.history[0].body.file_ids).toBeUndefined()
    })

    it('includes props when provided', async () => {
      mock.onPost(`${BASE}/posts`).reply({ id: 'post127' })

      await service.createPost('chan1', 'Props', undefined, undefined, { key: 'value' })

      expect(mock.history[0].body.props).toEqual({ key: 'value' })
    })

    it('throws on API error', async () => {
      mock.onPost(`${BASE}/posts`).replyWithError({
        message: 'Channel not found',
        body: { message: 'Channel not found', id: 'api.channel.not_found', status_code: 404 },
      })

      await expect(service.createPost('bad-chan', 'Hello')).rejects.toThrow('Mattermost API error')
    })
  })

  describe('getPost', () => {
    it('sends GET to correct path', async () => {
      mock.onGet(`${BASE}/posts/post123`).reply({ id: 'post123', message: 'Hello' })

      const result = await service.getPost('post123')

      expect(result).toEqual({ id: 'post123', message: 'Hello' })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${BASE}/posts/post123`)
    })
  })

  describe('updatePost', () => {
    it('sends PUT with correct body', async () => {
      mock.onPut(`${BASE}/posts/post123`).reply({ id: 'post123', message: 'Edited' })

      const result = await service.updatePost('post123', 'Edited')

      expect(result).toEqual({ id: 'post123', message: 'Edited' })
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].body).toMatchObject({
        id: 'post123',
        message: 'Edited',
      })
    })

    it('includes props when provided', async () => {
      mock.onPut(`${BASE}/posts/post123`).reply({ id: 'post123' })

      await service.updatePost('post123', 'Updated', { custom: 'data' })

      expect(mock.history[0].body.props).toEqual({ custom: 'data' })
    })
  })

  describe('deletePost', () => {
    it('sends DELETE to correct path', async () => {
      mock.onDelete(`${BASE}/posts/post123`).reply({ status: 'OK' })

      const result = await service.deletePost('post123')

      expect(result).toEqual({ status: 'OK' })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${BASE}/posts/post123`)
    })
  })

  describe('getChannelPosts', () => {
    it('sends GET with default pagination', async () => {
      mock.onGet(`${BASE}/channels/chan1/posts`).reply({ order: [], posts: {} })

      const result = await service.getChannelPosts('chan1')

      expect(result).toEqual({ order: [], posts: {} })
      expect(mock.history[0].query).toMatchObject({ page: 0, per_page: 60 })
    })

    it('sends GET with custom pagination', async () => {
      mock.onGet(`${BASE}/channels/chan1/posts`).reply({ order: [], posts: {} })

      await service.getChannelPosts('chan1', 2, 30)

      expect(mock.history[0].query).toMatchObject({ page: 2, per_page: 30 })
    })

    it('clamps perPage to maximum 200', async () => {
      mock.onGet(`${BASE}/channels/chan1/posts`).reply({ order: [], posts: {} })

      await service.getChannelPosts('chan1', 0, 500)

      expect(mock.history[0].query.per_page).toBe(200)
    })
  })

  describe('searchPosts', () => {
    it('sends POST with search terms', async () => {
      mock.onPost(`${BASE}/teams/team1/posts/search`).reply({ order: [], posts: {} })

      const result = await service.searchPosts('team1', 'quarterly report')

      expect(result).toEqual({ order: [], posts: {} })
      expect(mock.history[0].body).toEqual({
        terms: 'quarterly report',
        is_or_search: false,
      })
    })

    it('sets is_or_search to true when enabled', async () => {
      mock.onPost(`${BASE}/teams/team1/posts/search`).reply({ order: [], posts: {} })

      await service.searchPosts('team1', 'hello world', true)

      expect(mock.history[0].body.is_or_search).toBe(true)
    })
  })

  describe('pinPost', () => {
    it('sends POST to pin endpoint', async () => {
      mock.onPost(`${BASE}/posts/post123/pin`).reply({ status: 'OK' })

      const result = await service.pinPost('post123')

      expect(result).toEqual({ status: 'OK' })
      expect(mock.history[0].method).toBe('post')
    })
  })

  describe('unpinPost', () => {
    it('sends POST to unpin endpoint', async () => {
      mock.onPost(`${BASE}/posts/post123/unpin`).reply({ status: 'OK' })

      const result = await service.unpinPost('post123')

      expect(result).toEqual({ status: 'OK' })
      expect(mock.history[0].method).toBe('post')
    })
  })

  // ── Channels ──

  describe('createChannel', () => {
    it('sends POST with required fields and resolves Public to O', async () => {
      mock.onPost(`${BASE}/channels`).reply({ id: 'chan1', name: 'test', type: 'O' })

      const result = await service.createChannel('team1', 'test', 'Test Channel', 'Public')

      expect(result).toEqual({ id: 'chan1', name: 'test', type: 'O' })
      expect(mock.history[0].body).toMatchObject({
        team_id: 'team1',
        name: 'test',
        display_name: 'Test Channel',
        type: 'O',
      })
    })

    it('resolves Private to P', async () => {
      mock.onPost(`${BASE}/channels`).reply({ id: 'chan2', type: 'P' })

      await service.createChannel('team1', 'private', 'Private Chan', 'Private')

      expect(mock.history[0].body.type).toBe('P')
    })

    it('includes optional purpose and header', async () => {
      mock.onPost(`${BASE}/channels`).reply({ id: 'chan3' })

      await service.createChannel('team1', 'proj', 'Project', 'Public', 'Purpose text', 'Header text')

      expect(mock.history[0].body.purpose).toBe('Purpose text')
      expect(mock.history[0].body.header).toBe('Header text')
    })
  })

  describe('getChannel', () => {
    it('sends GET to correct path', async () => {
      mock.onGet(`${BASE}/channels/chan1`).reply({ id: 'chan1', name: 'general' })

      const result = await service.getChannel('chan1')

      expect(result).toEqual({ id: 'chan1', name: 'general' })
      expect(mock.history[0].url).toBe(`${BASE}/channels/chan1`)
    })
  })

  describe('getChannelByName', () => {
    it('sends GET with team and channel name in path', async () => {
      mock.onGet(`${BASE}/teams/team1/channels/name/general`).reply({ id: 'chan1', name: 'general' })

      const result = await service.getChannelByName('team1', 'general')

      expect(result).toEqual({ id: 'chan1', name: 'general' })
    })
  })

  describe('listChannelsForTeam', () => {
    it('sends GET with default pagination', async () => {
      mock.onGet(`${BASE}/teams/team1/channels`).reply([])

      const result = await service.listChannelsForTeam('team1')

      expect(result).toEqual([])
      expect(mock.history[0].query).toMatchObject({ page: 0, per_page: 60 })
    })

    it('sends GET with custom pagination', async () => {
      mock.onGet(`${BASE}/teams/team1/channels`).reply([])

      await service.listChannelsForTeam('team1', 1, 25)

      expect(mock.history[0].query).toMatchObject({ page: 1, per_page: 25 })
    })
  })

  describe('deleteChannel', () => {
    it('sends DELETE to correct path', async () => {
      mock.onDelete(`${BASE}/channels/chan1`).reply({ status: 'OK' })

      const result = await service.deleteChannel('chan1')

      expect(result).toEqual({ status: 'OK' })
      expect(mock.history[0].method).toBe('delete')
    })
  })

  describe('addUserToChannel', () => {
    it('sends POST with user_id in body', async () => {
      mock.onPost(`${BASE}/channels/chan1/members`).reply({ channel_id: 'chan1', user_id: 'user1' })

      const result = await service.addUserToChannel('chan1', 'user1')

      expect(result).toEqual({ channel_id: 'chan1', user_id: 'user1' })
      expect(mock.history[0].body).toEqual({ user_id: 'user1' })
    })
  })

  describe('removeUserFromChannel', () => {
    it('sends DELETE with user in path', async () => {
      mock.onDelete(`${BASE}/channels/chan1/members/user1`).reply({ status: 'OK' })

      const result = await service.removeUserFromChannel('chan1', 'user1')

      expect(result).toEqual({ status: 'OK' })
      expect(mock.history[0].method).toBe('delete')
    })
  })

  describe('createDirectChannel', () => {
    it('sends POST with array of two user IDs', async () => {
      mock.onPost(`${BASE}/channels/direct`).reply({ id: 'dm1', type: 'D' })

      const result = await service.createDirectChannel('user1', 'user2')

      expect(result).toEqual({ id: 'dm1', type: 'D' })
      expect(mock.history[0].body).toEqual(['user1', 'user2'])
    })
  })

  describe('createGroupChannel', () => {
    it('sends POST with array of user IDs', async () => {
      mock.onPost(`${BASE}/channels/group`).reply({ id: 'gm1', type: 'G' })

      const result = await service.createGroupChannel(['user1', 'user2', 'user3'])

      expect(result).toEqual({ id: 'gm1', type: 'G' })
      expect(mock.history[0].body).toEqual(['user1', 'user2', 'user3'])
    })

    it('sends empty array when userIds is not an array', async () => {
      mock.onPost(`${BASE}/channels/group`).reply({ id: 'gm2', type: 'G' })

      await service.createGroupChannel('not-an-array')

      expect(mock.history[0].body).toEqual([])
    })
  })

  // ── Teams ──

  describe('listTeams', () => {
    it('sends GET with default pagination', async () => {
      mock.onGet(`${BASE}/teams`).reply([])

      const result = await service.listTeams()

      expect(result).toEqual([])
      expect(mock.history[0].query).toMatchObject({ page: 0, per_page: 60 })
    })

    it('sends GET with custom pagination', async () => {
      mock.onGet(`${BASE}/teams`).reply([])

      await service.listTeams(3, 100)

      expect(mock.history[0].query).toMatchObject({ page: 3, per_page: 100 })
    })
  })

  describe('getTeam', () => {
    it('sends GET to correct path', async () => {
      mock.onGet(`${BASE}/teams/team1`).reply({ id: 'team1', name: 'engineering' })

      const result = await service.getTeam('team1')

      expect(result).toEqual({ id: 'team1', name: 'engineering' })
    })
  })

  describe('getTeamByName', () => {
    it('sends GET with team name in path', async () => {
      mock.onGet(`${BASE}/teams/name/engineering`).reply({ id: 'team1', name: 'engineering' })

      const result = await service.getTeamByName('engineering')

      expect(result).toEqual({ id: 'team1', name: 'engineering' })
    })
  })

  // ── Users ──

  describe('getUser', () => {
    it('sends GET to correct path', async () => {
      mock.onGet(`${BASE}/users/user1`).reply({ id: 'user1', username: 'jdoe' })

      const result = await service.getUser('user1')

      expect(result).toEqual({ id: 'user1', username: 'jdoe' })
    })
  })

  describe('getUserByUsername', () => {
    it('sends GET with username in path', async () => {
      mock.onGet(`${BASE}/users/username/jdoe`).reply({ id: 'user1', username: 'jdoe' })

      const result = await service.getUserByUsername('jdoe')

      expect(result).toEqual({ id: 'user1', username: 'jdoe' })
    })
  })

  describe('getMe', () => {
    it('sends GET to /users/me', async () => {
      mock.onGet(`${BASE}/users/me`).reply({ id: 'user1', username: 'botuser' })

      const result = await service.getMe()

      expect(result).toEqual({ id: 'user1', username: 'botuser' })
      expect(mock.history[0].url).toBe(`${BASE}/users/me`)
    })
  })

  describe('searchUsers', () => {
    it('sends POST with term', async () => {
      mock.onPost(`${BASE}/users/search`).reply([{ id: 'user1', username: 'jdoe' }])

      const result = await service.searchUsers('jdoe')

      expect(result).toEqual([{ id: 'user1', username: 'jdoe' }])
      expect(mock.history[0].body).toMatchObject({ term: 'jdoe' })
    })

    it('includes team_id when provided', async () => {
      mock.onPost(`${BASE}/users/search`).reply([])

      await service.searchUsers('jane', 'team1')

      expect(mock.history[0].body).toMatchObject({ term: 'jane', team_id: 'team1' })
    })
  })

  describe('createUser', () => {
    it('sends POST with required fields', async () => {
      mock.onPost(`${BASE}/users`).reply({ id: 'user2', username: 'newuser' })

      const result = await service.createUser('new@example.com', 'newuser', 'pass123')

      expect(result).toEqual({ id: 'user2', username: 'newuser' })
      expect(mock.history[0].body).toMatchObject({
        email: 'new@example.com',
        username: 'newuser',
        password: 'pass123',
      })
    })

    it('includes optional name fields', async () => {
      mock.onPost(`${BASE}/users`).reply({ id: 'user3' })

      await service.createUser('new@example.com', 'newuser', 'pass', 'Jane', 'Doe', 'JD')

      expect(mock.history[0].body).toMatchObject({
        first_name: 'Jane',
        last_name: 'Doe',
        nickname: 'JD',
      })
    })
  })

  describe('updateUserStatus', () => {
    it('sends PUT with resolved status Online -> online', async () => {
      mock.onPut(`${BASE}/users/user1/status`).reply({ user_id: 'user1', status: 'online' })

      const result = await service.updateUserStatus('user1', 'Online')

      expect(result).toEqual({ user_id: 'user1', status: 'online' })
      expect(mock.history[0].body).toEqual({ user_id: 'user1', status: 'online' })
    })

    it('resolves Away status', async () => {
      mock.onPut(`${BASE}/users/user1/status`).reply({ status: 'away' })

      await service.updateUserStatus('user1', 'Away')

      expect(mock.history[0].body.status).toBe('away')
    })

    it('resolves Do Not Disturb to dnd', async () => {
      mock.onPut(`${BASE}/users/user1/status`).reply({ status: 'dnd' })

      await service.updateUserStatus('user1', 'Do Not Disturb')

      expect(mock.history[0].body.status).toBe('dnd')
    })

    it('resolves Offline status', async () => {
      mock.onPut(`${BASE}/users/user1/status`).reply({ status: 'offline' })

      await service.updateUserStatus('user1', 'Offline')

      expect(mock.history[0].body.status).toBe('offline')
    })
  })

  // ── Files ──

  describe('uploadFile', () => {
    it('downloads the file and sends multipart form data', async () => {
      const fileBytes = Buffer.from('file-content')

      mock.onGet('https://example.com/report.pdf').reply(fileBytes)
      mock.onPost(`${BASE}/files`).reply({ file_infos: [{ id: 'file1', name: 'report.pdf' }] })

      const result = await service.uploadFile('chan1', 'https://example.com/report.pdf')

      expect(result).toEqual({ file_infos: [{ id: 'file1', name: 'report.pdf' }] })
      expect(mock.history).toHaveLength(2)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].encoding).toBeNull()
      expect(mock.history[1].method).toBe('post')
      expect(mock.history[1].formData).toBeDefined()
      expect(mock.history[1].headers).toMatchObject({
        Authorization: `Bearer ${ACCESS_TOKEN}`,
      })
    })

    it('uses provided filename', async () => {
      mock.onGet('https://example.com/data').reply(Buffer.from('bytes'))
      mock.onPost(`${BASE}/files`).reply({ file_infos: [{ id: 'file2' }] })

      await service.uploadFile('chan1', 'https://example.com/data', 'custom-name.txt')

      expect(mock.history[1].formData).toBeDefined()
    })

    it('throws on download error', async () => {
      mock.onGet('https://example.com/missing').replyWithError({ message: 'Not Found' })

      await expect(service.uploadFile('chan1', 'https://example.com/missing')).rejects.toThrow('Mattermost API error')
    })
  })

  describe('getFile', () => {
    it('downloads file and stores it via Files API', async () => {
      const filesCalls = stubFiles(service)
      const fileBytes = Buffer.from('file-content')

      mock.onGet(`${BASE}/files/file1`).reply(fileBytes)

      const result = await service.getFile('file1')

      expect(result).toHaveProperty('url')
      expect(result).toHaveProperty('filename')
      expect(result.filename).toBe('mattermost_file1')
      expect(mock.history[0].encoding).toBeNull()
      expect(filesCalls).toHaveLength(1)
      expect(filesCalls[0].options).toMatchObject({
        filename: 'mattermost_file1',
        generateUrl: true,
        overwrite: true,
        scope: 'FLOW',
      })
    })

    it('uses custom filename when provided', async () => {
      const filesCalls = stubFiles(service)

      mock.onGet(`${BASE}/files/file2`).reply(Buffer.from('data'))

      const result = await service.getFile('file2', 'my-file.pdf')

      expect(result.filename).toBe('my-file.pdf')
      expect(filesCalls[0].options.filename).toBe('my-file.pdf')
    })

    it('uses fileOptions when provided', async () => {
      const filesCalls = stubFiles(service)

      mock.onGet(`${BASE}/files/file3`).reply(Buffer.from('data'))

      await service.getFile('file3', 'doc.pdf', { scope: 'APP' })

      expect(filesCalls[0].options.scope).toBe('APP')
    })

    it('throws on download error', async () => {
      stubFiles(service)
      mock.onGet(`${BASE}/files/file404`).replyWithError({ message: 'Not Found' })

      await expect(service.getFile('file404')).rejects.toThrow('Mattermost API error')
    })
  })

  // ── Reactions ──

  describe('addReaction', () => {
    it('sends POST with normalized emoji name', async () => {
      mock.onPost(`${BASE}/reactions`).reply({ user_id: 'user1', post_id: 'post1', emoji_name: 'thumbsup' })

      const result = await service.addReaction('user1', 'post1', ':thumbsup:')

      expect(result).toEqual({ user_id: 'user1', post_id: 'post1', emoji_name: 'thumbsup' })
      expect(mock.history[0].body).toEqual({
        user_id: 'user1',
        post_id: 'post1',
        emoji_name: 'thumbsup',
      })
    })

    it('handles emoji name without colons', async () => {
      mock.onPost(`${BASE}/reactions`).reply({ emoji_name: 'tada' })

      await service.addReaction('user1', 'post1', 'tada')

      expect(mock.history[0].body.emoji_name).toBe('tada')
    })
  })

  describe('removeReaction', () => {
    it('sends DELETE with normalized emoji in path', async () => {
      mock.onDelete(`${BASE}/users/user1/posts/post1/reactions/thumbsup`).reply({ status: 'OK' })

      const result = await service.removeReaction('user1', 'post1', ':thumbsup:')

      expect(result).toEqual({ status: 'OK' })
      expect(mock.history[0].method).toBe('delete')
    })
  })

  // ── Dictionaries ──

  describe('getTeamsDictionary', () => {
    it('returns mapped team items with pagination cursor', async () => {
      const teams = Array.from({ length: 60 }, (_, i) => ({
        id: `team${i}`,
        name: `team-${i}`,
        display_name: `Team ${i}`,
      }))

      mock.onGet(`${BASE}/teams`).reply(teams)

      const result = await service.getTeamsDictionary({})

      expect(result.items).toHaveLength(60)
      expect(result.items[0]).toEqual({ label: 'Team 0', value: 'team0', note: 'team-0' })
      expect(result.cursor).toBe('1')
    })

    it('returns null cursor when fewer items than page size', async () => {
      mock.onGet(`${BASE}/teams`).reply([
        { id: 'team1', name: 'eng', display_name: 'Engineering' },
      ])

      const result = await service.getTeamsDictionary({})

      expect(result.items).toHaveLength(1)
      expect(result.cursor).toBeNull()
    })

    it('filters by search term', async () => {
      mock.onGet(`${BASE}/teams`).reply([
        { id: 'team1', name: 'eng', display_name: 'Engineering' },
        { id: 'team2', name: 'sales', display_name: 'Sales' },
      ])

      const result = await service.getTeamsDictionary({ search: 'eng' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('team1')
    })

    it('uses cursor for pagination', async () => {
      mock.onGet(`${BASE}/teams`).reply([])

      await service.getTeamsDictionary({ cursor: '2' })

      expect(mock.history[0].query).toMatchObject({ page: 2, per_page: 60 })
    })
  })

  describe('getChannelsDictionary', () => {
    it('returns empty items when no teamId in criteria', async () => {
      const result = await service.getChannelsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
      expect(mock.history).toHaveLength(0)
    })

    it('returns mapped channel items for a team', async () => {
      mock.onGet(`${BASE}/teams/team1/channels`).reply([
        { id: 'chan1', name: 'general', display_name: 'General' },
        { id: 'chan2', name: 'random', display_name: 'Random' },
      ])

      const result = await service.getChannelsDictionary({ criteria: { teamId: 'team1' } })

      expect(result.items).toHaveLength(2)
      expect(result.items[0]).toEqual({ label: 'General', value: 'chan1', note: 'general' })
      expect(result.cursor).toBeNull()
    })

    it('filters by search term', async () => {
      mock.onGet(`${BASE}/teams/team1/channels`).reply([
        { id: 'chan1', name: 'general', display_name: 'General' },
        { id: 'chan2', name: 'random', display_name: 'Random' },
      ])

      const result = await service.getChannelsDictionary({ search: 'rand', criteria: { teamId: 'team1' } })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('chan2')
    })
  })

  describe('getUsersDictionary', () => {
    it('returns mapped user items with pagination', async () => {
      mock.onGet(`${BASE}/users`).reply([
        { id: 'user1', username: 'jdoe', first_name: 'Jane', last_name: 'Doe' },
      ])

      const result = await service.getUsersDictionary({})

      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toEqual({ label: 'Jane Doe (jdoe)', value: 'user1', note: 'jdoe' })
      expect(result.cursor).toBeNull()
    })

    it('uses search endpoint when search term is provided', async () => {
      mock.onPost(`${BASE}/users/search`).reply([
        { id: 'user1', username: 'jdoe', first_name: 'Jane', last_name: 'Doe' },
      ])

      const result = await service.getUsersDictionary({ search: 'jane' })

      expect(result.items).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({ term: 'jane' })
      expect(result.cursor).toBeNull()
    })

    it('uses username as label when no full name', async () => {
      mock.onGet(`${BASE}/users`).reply([
        { id: 'user2', username: 'bot', first_name: '', last_name: '' },
      ])

      const result = await service.getUsersDictionary({})

      expect(result.items[0].label).toBe('bot')
    })

    it('uses cursor for pagination', async () => {
      mock.onGet(`${BASE}/users`).reply([])

      await service.getUsersDictionary({ cursor: '3' })

      expect(mock.history[0].query).toMatchObject({ page: 3, per_page: 60 })
    })
  })
})
