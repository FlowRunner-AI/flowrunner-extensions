'use strict'

const { createSandbox } = require('../../../service-sandbox')

const CLIENT_ID = 'test-client-id'
const CLIENT_SECRET = 'test-client-secret'
const ACCESS_TOKEN = 'test-access-token'
const OAUTH_BASE = 'https://login.microsoftonline.com/common/oauth2/v2.0'
const API_BASE = 'https://graph.microsoft.com/v1.0'

const TEAM_ID = '19c9a1f2-8f5b-4d3e-9c1a-2b7e6f0d4a11'
const CHANNEL_ID = '19:abcdef1234567890@thread.tacv2'
const CHAT_ID = '19:2da4c29f6d7041eca70b638b43d45437@thread.v2'
const MESSAGE_ID = '1752403200000'

describe('Microsoft Teams Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
    })

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
      const configItems = sandbox.getConfigItems()

      expect(configItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'clientId', required: true, shared: true }),
          expect.objectContaining({ name: 'clientSecret', required: true, shared: true }),
        ])
      )
    })

    it('stores credentials and default scopes', () => {
      expect(service.clientId).toBe(CLIENT_ID)
      expect(service.clientSecret).toBe(CLIENT_SECRET)
      expect(service.scopes).toContain('offline_access')
      expect(service.scopes).toContain('ChannelMessage.Send')
      expect(service.scopes).toContain('Chat.ReadWrite')
    })
  })

  // ── OAuth ──

  describe('getOAuth2ConnectionURL', () => {
    it('returns the correct authorization URL', async () => {
      const url = await service.getOAuth2ConnectionURL()

      expect(url).toContain(`${OAUTH_BASE}/authorize`)
      expect(url).toContain(`client_id=${CLIENT_ID}`)
      expect(url).toContain('response_type=code')
      expect(url).toContain('response_mode=query')
      expect(url).toContain(encodeURIComponent('offline_access'))
      expect(url).toContain(encodeURIComponent('Team.ReadBasic.All'))
    })
  })

  describe('executeCallback', () => {
    it('exchanges the code for a token and fetches the user profile', async () => {
      mock.onPost(`${OAUTH_BASE}/token`).reply({
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        expires_in: 3600,
      })

      const userData = {
        id: 'user-1',
        displayName: 'John Smith',
        mail: 'john.smith@company.com',
      }

      mock.onGet(`${API_BASE}/me`).reply(userData)

      const result = await service.executeCallback({
        code: 'auth-code-123',
        redirectURI: 'https://redirect.example.com/callback',
      })

      expect(result).toEqual({
        token: 'new-access-token',
        refreshToken: 'new-refresh-token',
        expirationInSeconds: 3600,
        connectionIdentityName: 'john.smith@company.com (John Smith)',
        overwrite: true,
        userData,
      })

      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${OAUTH_BASE}/token`)
      expect(mock.history[0].headers).toMatchObject({
        'Content-Type': 'application/x-www-form-urlencoded',
      })
      expect(mock.history[0].body).toContain('grant_type=authorization_code')
      expect(mock.history[0].body).toContain('code=auth-code-123')
      expect(mock.history[0].body).toContain(`client_id=${CLIENT_ID}`)
      expect(mock.history[0].body).toContain(`client_secret=${CLIENT_SECRET}`)
      expect(mock.history[0].body).toContain(
        `redirect_uri=${encodeURIComponent('https://redirect.example.com/callback')}`
      )

      expect(mock.history[1].url).toBe(`${API_BASE}/me`)
      expect(mock.history[1].headers).toMatchObject({
        Authorization: 'Bearer new-access-token',
        'Content-Type': 'application/json',
      })
    })

    it('falls back to userPrincipalName when mail is missing', async () => {
      mock.onPost(`${OAUTH_BASE}/token`).reply({
        access_token: 'token-abc',
        refresh_token: 'refresh-abc',
        expires_in: 1000,
      })
      mock.onGet(`${API_BASE}/me`).reply({ userPrincipalName: 'jane@company.com' })

      const result = await service.executeCallback({ code: 'c', redirectURI: 'https://cb' })

      expect(result.connectionIdentityName).toBe('jane@company.com')
    })

    it('falls back to displayName when no email is available', async () => {
      mock.onPost(`${OAUTH_BASE}/token`).reply({ access_token: 't', expires_in: 10 })
      mock.onGet(`${API_BASE}/me`).reply({ displayName: 'Only Name' })

      const result = await service.executeCallback({ code: 'c', redirectURI: 'https://cb' })

      expect(result.connectionIdentityName).toBe('Only Name')
    })

    it('uses a default identity name when the profile request fails', async () => {
      mock.onPost(`${OAUTH_BASE}/token`).reply({
        access_token: 'token-xyz',
        refresh_token: 'refresh-xyz',
        expires_in: 7200,
      })
      mock.onGet(`${API_BASE}/me`).replyWithError({ message: 'profile unavailable' })

      const result = await service.executeCallback({ code: 'c', redirectURI: 'https://cb' })

      expect(result.token).toBe('token-xyz')
      expect(result.connectionIdentityName).toBe('Microsoft Teams Connection')
      expect(result.userData).toEqual({})
    })

    it('propagates token exchange errors', async () => {
      mock.onPost(`${OAUTH_BASE}/token`).replyWithError({ message: 'invalid_grant' })

      await expect(service.executeCallback({ code: 'bad', redirectURI: 'https://cb' })).rejects.toThrow(
        'invalid_grant'
      )
    })
  })

  describe('refreshToken', () => {
    it('refreshes the access token', async () => {
      mock.onPost(`${OAUTH_BASE}/token`).reply({
        access_token: 'refreshed-token',
        refresh_token: 'refreshed-refresh-token',
        expires_in: 3600,
      })

      const result = await service.refreshToken('old-refresh-token')

      expect(result).toEqual({
        token: 'refreshed-token',
        refreshToken: 'refreshed-refresh-token',
        expirationInSeconds: 3600,
      })

      expect(mock.history[0].body).toContain('grant_type=refresh_token')
      expect(mock.history[0].body).toContain('refresh_token=old-refresh-token')
      expect(mock.history[0].body).toContain(`client_id=${CLIENT_ID}`)
    })

    it('throws when the refresh request fails', async () => {
      mock.onPost(`${OAUTH_BASE}/token`).replyWithError({ message: 'invalid refresh token' })

      await expect(service.refreshToken('bad')).rejects.toThrow('invalid refresh token')
    })
  })

  // ── Dictionaries ──

  describe('getTeamsDictionary', () => {
    it('returns mapped teams', async () => {
      mock.onGet(`${API_BASE}/me/joinedTeams`).reply({
        value: [
          { id: 'team-1', displayName: 'Engineering' },
          { id: 'team-2', displayName: 'Marketing' },
        ],
      })

      const result = await service.getTeamsDictionary({})

      expect(result).toEqual({
        cursor: null,
        items: [
          { label: 'Engineering', note: 'ID: team-1', value: 'team-1' },
          { label: 'Marketing', note: 'ID: team-2', value: 'team-2' },
        ],
      })

      expect(mock.history[0].headers).toMatchObject({ Authorization: `Bearer ${ACCESS_TOKEN}` })
    })

    it('filters teams by case-insensitive search', async () => {
      mock.onGet(`${API_BASE}/me/joinedTeams`).reply({
        value: [
          { id: 'team-1', displayName: 'Engineering' },
          { id: 'team-2', displayName: 'Marketing' },
        ],
      })

      const result = await service.getTeamsDictionary({ search: 'ENGIN' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('team-1')
    })

    it('handles a null payload', async () => {
      mock.onGet(`${API_BASE}/me/joinedTeams`).reply({ value: [{ id: 't', displayName: 'T' }] })

      const result = await service.getTeamsDictionary(null)

      expect(result.items).toHaveLength(1)
      expect(result.cursor).toBeNull()
    })

    it('handles a missing value array', async () => {
      mock.onGet(`${API_BASE}/me/joinedTeams`).reply({})

      const result = await service.getTeamsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('follows the cursor and returns the next link', async () => {
      const cursor = `${API_BASE}/me/joinedTeams?$skiptoken=abc`

      mock.onGet(cursor).reply({
        value: [{ id: 'team-3', displayName: 'Sales' }],
        '@odata.nextLink': 'next-page-link',
      })

      const result = await service.getTeamsDictionary({ cursor })

      expect(mock.history[0].url).toBe(cursor)
      expect(result.cursor).toBe('next-page-link')
      expect(result.items[0].value).toBe('team-3')
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${API_BASE}/me/joinedTeams`).replyWithError({
        body: { error: { message: 'Insufficient privileges' } },
      })

      await expect(service.getTeamsDictionary({})).rejects.toThrow(
        'Microsoft Teams API error: Insufficient privileges'
      )
    })
  })

  describe('getChannelsDictionary', () => {
    it('returns an empty result when teamId criteria is missing', async () => {
      const result = await service.getChannelsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
      expect(mock.history).toHaveLength(0)
    })

    it('returns an empty result for a null payload', async () => {
      const result = await service.getChannelsDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
      expect(mock.history).toHaveLength(0)
    })

    it('returns mapped channels with membership type notes', async () => {
      mock.onGet(`${API_BASE}/teams/${TEAM_ID}/channels`).reply({
        value: [
          { id: 'ch-1', displayName: 'General', membershipType: 'standard' },
          { id: 'ch-2', displayName: 'Secret' },
        ],
      })

      const result = await service.getChannelsDictionary({ criteria: { teamId: TEAM_ID } })

      expect(result).toEqual({
        cursor: null,
        items: [
          { label: 'General', note: 'Standard channel', value: 'ch-1' },
          { label: 'Secret', note: 'ID: ch-2', value: 'ch-2' },
        ],
      })
    })

    it('filters channels by search', async () => {
      mock.onGet(`${API_BASE}/teams/${TEAM_ID}/channels`).reply({
        value: [
          { id: 'ch-1', displayName: 'General', membershipType: 'standard' },
          { id: 'ch-2', displayName: 'Random', membershipType: 'private' },
        ],
      })

      const result = await service.getChannelsDictionary({
        search: 'rand',
        criteria: { teamId: TEAM_ID },
      })

      expect(result.items).toEqual([{ label: 'Random', note: 'Private channel', value: 'ch-2' }])
    })

    it('handles a missing value array', async () => {
      mock.onGet(`${API_BASE}/teams/${TEAM_ID}/channels`).reply({})

      const result = await service.getChannelsDictionary({ criteria: { teamId: TEAM_ID } })

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('follows the cursor when provided', async () => {
      const cursor = `${API_BASE}/teams/${TEAM_ID}/channels?$skiptoken=xyz`

      mock.onGet(cursor).reply({ value: [] })

      await service.getChannelsDictionary({ cursor, criteria: { teamId: TEAM_ID } })

      expect(mock.history[0].url).toBe(cursor)
    })
  })

  describe('getChatsDictionary', () => {
    it('returns chats labeled by topic or member names', async () => {
      mock.onGet(`${API_BASE}/me/chats`).reply({
        value: [
          { id: 'chat-1', topic: 'Project Alpha', chatType: 'group' },
          {
            id: 'chat-2',
            topic: null,
            chatType: 'oneOnOne',
            members: [{ displayName: 'Jane Doe' }, { displayName: 'John Smith' }],
          },
          { id: 'chat-3', members: [] },
        ],
      })

      const result = await service.getChatsDictionary({})

      expect(result).toEqual({
        cursor: null,
        items: [
          { label: 'Project Alpha', note: 'group', value: 'chat-1' },
          { label: 'Jane Doe, John Smith', note: 'oneOnOne', value: 'chat-2' },
          { label: 'chat-3', note: 'ID: chat-3', value: 'chat-3' },
        ],
      })

      expect(mock.history[0].query).toMatchObject({ $expand: 'members', $top: 20 })
    })

    it('filters chats by resolved label', async () => {
      mock.onGet(`${API_BASE}/me/chats`).reply({
        value: [
          { id: 'chat-1', topic: 'Project Alpha' },
          { id: 'chat-2', topic: 'Random Talk' },
        ],
      })

      const result = await service.getChatsDictionary({ search: 'alpha' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('chat-1')
    })

    it('handles a missing value array', async () => {
      mock.onGet(`${API_BASE}/me/chats`).reply({})

      const result = await service.getChatsDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('follows the cursor without query parameters', async () => {
      const cursor = `${API_BASE}/me/chats?$skiptoken=abc`

      mock.onGet(cursor).reply({ value: [], '@odata.nextLink': 'more' })

      const result = await service.getChatsDictionary({ cursor })

      expect(mock.history[0].url).toBe(cursor)
      expect(mock.history[0].query).toEqual({})
      expect(result.cursor).toBe('more')
    })
  })

  // ── User ──

  describe('getMyProfile', () => {
    it('retrieves the signed-in user profile', async () => {
      const profile = { id: 'user-1', displayName: 'John Smith' }

      mock.onGet(`${API_BASE}/me`).reply(profile)

      const result = await service.getMyProfile()

      expect(result).toEqual(profile)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].headers).toMatchObject({ Authorization: `Bearer ${ACCESS_TOKEN}` })
    })

    it('throws a wrapped error on failure', async () => {
      mock.onGet(`${API_BASE}/me`).replyWithError({ message: 'Unauthorized' })

      await expect(service.getMyProfile()).rejects.toThrow('Microsoft Teams API error: Unauthorized')
    })
  })

  // ── Teams ──

  describe('listTeams', () => {
    it('retrieves joined teams', async () => {
      mock.onGet(`${API_BASE}/me/joinedTeams`).reply({ value: [{ id: TEAM_ID }] })

      const result = await service.listTeams()

      expect(result.value).toHaveLength(1)
      expect(mock.history[0].url).toBe(`${API_BASE}/me/joinedTeams`)
    })
  })

  describe('listTeamMembers', () => {
    it('retrieves team members', async () => {
      mock.onGet(`${API_BASE}/teams/${TEAM_ID}/members`).reply({ value: [{ id: 'm-1' }] })

      const result = await service.listTeamMembers(TEAM_ID)

      expect(result.value).toHaveLength(1)
    })

    it('throws when teamId is missing', async () => {
      await expect(service.listTeamMembers()).rejects.toThrow('Parameter "Team" is required')
      expect(mock.history).toHaveLength(0)
    })
  })

  // ── Channels ──

  describe('listChannels', () => {
    it('retrieves channels of a team', async () => {
      mock.onGet(`${API_BASE}/teams/${TEAM_ID}/channels`).reply({ value: [{ id: CHANNEL_ID }] })

      const result = await service.listChannels(TEAM_ID)

      expect(result.value[0].id).toBe(CHANNEL_ID)
    })

    it('throws when teamId is missing', async () => {
      await expect(service.listChannels()).rejects.toThrow('Parameter "Team" is required')
    })

    it('throws a wrapped error on failure', async () => {
      mock.onGet(`${API_BASE}/teams/${TEAM_ID}/channels`).replyWithError({
        body: { error: { message: 'Team not found' } },
      })

      await expect(service.listChannels(TEAM_ID)).rejects.toThrow(
        'Microsoft Teams API error: Team not found'
      )
    })
  })

  describe('createChannel', () => {
    it('creates a standard channel by default', async () => {
      mock.onPost(`${API_BASE}/teams/${TEAM_ID}/channels`).reply({ id: CHANNEL_ID })

      const result = await service.createChannel(TEAM_ID, 'Project Alpha')

      expect(result).toEqual({ id: CHANNEL_ID })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({
        displayName: 'Project Alpha',
        membershipType: 'standard',
      })
    })

    it('includes the description when provided', async () => {
      mock.onPost(`${API_BASE}/teams/${TEAM_ID}/channels`).reply({ id: CHANNEL_ID })

      await service.createChannel(TEAM_ID, 'Project Alpha', 'Alpha work', 'Standard')

      expect(mock.history[0].body).toEqual({
        displayName: 'Project Alpha',
        description: 'Alpha work',
        membershipType: 'standard',
      })
    })

    it('adds the signed-in user as owner for private channels', async () => {
      mock.onGet(`${API_BASE}/me`).reply({ id: 'me-123' })
      mock.onPost(`${API_BASE}/teams/${TEAM_ID}/channels`).reply({ id: CHANNEL_ID })

      await service.createChannel(TEAM_ID, 'Secret', undefined, 'Private')

      expect(mock.history).toHaveLength(2)
      expect(mock.history[0].url).toBe(`${API_BASE}/me`)
      expect(mock.history[1].body).toEqual({
        displayName: 'Secret',
        membershipType: 'private',
        members: [
          {
            '@odata.type': '#microsoft.graph.aadUserConversationMember',
            'user@odata.bind': `${API_BASE}/users('me-123')`,
            roles: ['owner'],
          },
        ],
      })
    })

    it('passes through a raw membership type value', async () => {
      mock.onPost(`${API_BASE}/teams/${TEAM_ID}/channels`).reply({ id: CHANNEL_ID })

      await service.createChannel(TEAM_ID, 'Shared Channel', undefined, 'shared')

      expect(mock.history[0].body.membershipType).toBe('shared')
    })

    it('throws when teamId is missing', async () => {
      await expect(service.createChannel(undefined, 'Name')).rejects.toThrow(
        'Parameter "Team" is required'
      )
    })

    it('throws when displayName is missing', async () => {
      await expect(service.createChannel(TEAM_ID)).rejects.toThrow(
        'Parameter "Channel Name" is required'
      )
    })
  })

  describe('deleteChannel', () => {
    it('deletes a channel and returns a confirmation message', async () => {
      mock.onDelete(`${API_BASE}/teams/${TEAM_ID}/channels/${CHANNEL_ID}`).reply(undefined)

      const result = await service.deleteChannel(TEAM_ID, CHANNEL_ID)

      expect(result).toEqual({ message: 'Channel deleted successfully' })
      expect(mock.history[0].method).toBe('delete')
    })

    it('throws when teamId is missing', async () => {
      await expect(service.deleteChannel(undefined, CHANNEL_ID)).rejects.toThrow(
        'Parameter "Team" is required'
      )
    })

    it('throws when channelId is missing', async () => {
      await expect(service.deleteChannel(TEAM_ID)).rejects.toThrow('Parameter "Channel" is required')
    })

    it('throws a wrapped error on failure', async () => {
      mock.onDelete(`${API_BASE}/teams/${TEAM_ID}/channels/${CHANNEL_ID}`).replyWithError({
        message: 'Forbidden',
      })

      await expect(service.deleteChannel(TEAM_ID, CHANNEL_ID)).rejects.toThrow(
        'Microsoft Teams API error: Forbidden'
      )
    })
  })

  // ── Channel messages ──

  describe('sendChannelMessage', () => {
    const url = `${API_BASE}/teams/${TEAM_ID}/channels/${CHANNEL_ID}/messages`

    it('sends a text message by default', async () => {
      mock.onPost(url).reply({ id: MESSAGE_ID })

      const result = await service.sendChannelMessage(TEAM_ID, CHANNEL_ID, undefined, 'Hello')

      expect(result).toEqual({ id: MESSAGE_ID })
      expect(mock.history[0].body).toEqual({ body: { contentType: 'text', content: 'Hello' } })
    })

    it('sends an HTML message with a subject', async () => {
      mock.onPost(url).reply({ id: MESSAGE_ID })

      await service.sendChannelMessage(TEAM_ID, CHANNEL_ID, 'HTML', '<b>Hi</b>', 'Status Update')

      expect(mock.history[0].body).toEqual({
        subject: 'Status Update',
        body: { contentType: 'html', content: '<b>Hi</b>' },
      })
    })

    it('throws when teamId is missing', async () => {
      await expect(
        service.sendChannelMessage(undefined, CHANNEL_ID, 'Text', 'Hi')
      ).rejects.toThrow('Parameter "Team" is required')
    })

    it('throws when channelId is missing', async () => {
      await expect(service.sendChannelMessage(TEAM_ID, undefined, 'Text', 'Hi')).rejects.toThrow(
        'Parameter "Channel" is required'
      )
    })

    it('throws when content is missing', async () => {
      await expect(service.sendChannelMessage(TEAM_ID, CHANNEL_ID, 'Text')).rejects.toThrow(
        'Parameter "Message" is required'
      )
    })
  })

  describe('replyToChannelMessage', () => {
    const url = `${API_BASE}/teams/${TEAM_ID}/channels/${CHANNEL_ID}/messages/${MESSAGE_ID}/replies`

    it('sends a reply as text by default', async () => {
      mock.onPost(url).reply({ id: 'reply-1' })

      const result = await service.replyToChannelMessage(
        TEAM_ID,
        CHANNEL_ID,
        MESSAGE_ID,
        undefined,
        'Thanks'
      )

      expect(result).toEqual({ id: 'reply-1' })
      expect(mock.history[0].body).toEqual({ body: { contentType: 'text', content: 'Thanks' } })
    })

    it('sends an HTML reply', async () => {
      mock.onPost(url).reply({ id: 'reply-2' })

      await service.replyToChannelMessage(TEAM_ID, CHANNEL_ID, MESSAGE_ID, 'HTML', '<i>ok</i>')

      expect(mock.history[0].body.body.contentType).toBe('html')
    })

    it('throws when teamId is missing', async () => {
      await expect(
        service.replyToChannelMessage(undefined, CHANNEL_ID, MESSAGE_ID, 'Text', 'Hi')
      ).rejects.toThrow('Parameter "Team" is required')
    })

    it('throws when channelId is missing', async () => {
      await expect(
        service.replyToChannelMessage(TEAM_ID, undefined, MESSAGE_ID, 'Text', 'Hi')
      ).rejects.toThrow('Parameter "Channel" is required')
    })

    it('throws when messageId is missing', async () => {
      await expect(
        service.replyToChannelMessage(TEAM_ID, CHANNEL_ID, undefined, 'Text', 'Hi')
      ).rejects.toThrow('Parameter "Message ID" is required')
    })

    it('throws when content is missing', async () => {
      await expect(
        service.replyToChannelMessage(TEAM_ID, CHANNEL_ID, MESSAGE_ID, 'Text')
      ).rejects.toThrow('Parameter "Reply" is required')
    })
  })

  describe('getChannelMessages', () => {
    const url = `${API_BASE}/teams/${TEAM_ID}/channels/${CHANNEL_ID}/messages`

    it('retrieves messages with the default page size', async () => {
      mock.onGet(url).reply({ value: [] })

      await service.getChannelMessages(TEAM_ID, CHANNEL_ID)

      expect(mock.history[0].query).toEqual({ $top: 20 })
    })

    it('honours a custom page size', async () => {
      mock.onGet(url).reply({ value: [] })

      await service.getChannelMessages(TEAM_ID, CHANNEL_ID, 10)

      expect(mock.history[0].query).toEqual({ $top: 10 })
    })

    it('caps the page size at 50', async () => {
      mock.onGet(url).reply({ value: [] })

      await service.getChannelMessages(TEAM_ID, CHANNEL_ID, 500)

      expect(mock.history[0].query).toEqual({ $top: 50 })
    })

    it('uses the next link and ignores other parameters', async () => {
      const nextLink = `${url}?$skiptoken=abc`

      mock.onGet(nextLink).reply({ value: [{ id: MESSAGE_ID }] })

      const result = await service.getChannelMessages(undefined, undefined, 5, nextLink)

      expect(mock.history[0].url).toBe(nextLink)
      expect(mock.history[0].query).toEqual({})
      expect(result.value).toHaveLength(1)
    })

    it('throws when teamId is missing', async () => {
      await expect(service.getChannelMessages()).rejects.toThrow('Parameter "Team" is required')
    })

    it('throws when channelId is missing', async () => {
      await expect(service.getChannelMessages(TEAM_ID)).rejects.toThrow(
        'Parameter "Channel" is required'
      )
    })
  })

  describe('getChannelMessage', () => {
    const url = `${API_BASE}/teams/${TEAM_ID}/channels/${CHANNEL_ID}/messages/${MESSAGE_ID}`

    it('retrieves a single message', async () => {
      mock.onGet(url).reply({ id: MESSAGE_ID, subject: 'Status Update' })

      const result = await service.getChannelMessage(TEAM_ID, CHANNEL_ID, MESSAGE_ID)

      expect(result.id).toBe(MESSAGE_ID)
    })

    it('throws when teamId is missing', async () => {
      await expect(service.getChannelMessage(undefined, CHANNEL_ID, MESSAGE_ID)).rejects.toThrow(
        'Parameter "Team" is required'
      )
    })

    it('throws when channelId is missing', async () => {
      await expect(service.getChannelMessage(TEAM_ID, undefined, MESSAGE_ID)).rejects.toThrow(
        'Parameter "Channel" is required'
      )
    })

    it('throws when messageId is missing', async () => {
      await expect(service.getChannelMessage(TEAM_ID, CHANNEL_ID)).rejects.toThrow(
        'Parameter "Message ID" is required'
      )
    })
  })

  // ── Chats ──

  describe('listChats', () => {
    it('retrieves chats with expanded members', async () => {
      mock.onGet(`${API_BASE}/me/chats`).reply({ value: [{ id: CHAT_ID }] })

      const result = await service.listChats()

      expect(result.value).toHaveLength(1)
      expect(mock.history[0].query).toEqual({ $expand: 'members', $top: 20 })
    })

    it('caps the page size at 50', async () => {
      mock.onGet(`${API_BASE}/me/chats`).reply({ value: [] })

      await service.listChats(999)

      expect(mock.history[0].query).toMatchObject({ $top: 50 })
    })

    it('uses the next link when provided', async () => {
      const nextLink = `${API_BASE}/me/chats?$skiptoken=abc`

      mock.onGet(nextLink).reply({ value: [] })

      await service.listChats(10, nextLink)

      expect(mock.history[0].url).toBe(nextLink)
      expect(mock.history[0].query).toEqual({})
    })
  })

  describe('sendChatMessage', () => {
    const url = `${API_BASE}/chats/${CHAT_ID}/messages`

    it('sends a text chat message by default', async () => {
      mock.onPost(url).reply({ id: 'chat-msg-1' })

      const result = await service.sendChatMessage(CHAT_ID, undefined, 'Hi there')

      expect(result).toEqual({ id: 'chat-msg-1' })
      expect(mock.history[0].body).toEqual({ body: { contentType: 'text', content: 'Hi there' } })
    })

    it('sends an HTML chat message', async () => {
      mock.onPost(url).reply({ id: 'chat-msg-2' })

      await service.sendChatMessage(CHAT_ID, 'HTML', '<p>Hi</p>')

      expect(mock.history[0].body.body.contentType).toBe('html')
    })

    it('throws when chatId is missing', async () => {
      await expect(service.sendChatMessage(undefined, 'Text', 'Hi')).rejects.toThrow(
        'Parameter "Chat" is required'
      )
    })

    it('throws when content is missing', async () => {
      await expect(service.sendChatMessage(CHAT_ID, 'Text')).rejects.toThrow(
        'Parameter "Message" is required'
      )
    })

    it('throws a wrapped error on failure', async () => {
      mock.onPost(url).replyWithError({ body: { error: { message: 'Chat not found' } } })

      await expect(service.sendChatMessage(CHAT_ID, 'Text', 'Hi')).rejects.toThrow(
        'Microsoft Teams API error: Chat not found'
      )
    })
  })

  describe('getChatMessages', () => {
    const url = `${API_BASE}/chats/${CHAT_ID}/messages`

    it('retrieves chat messages with the default page size', async () => {
      mock.onGet(url).reply({ value: [] })

      await service.getChatMessages(CHAT_ID)

      expect(mock.history[0].query).toEqual({ $top: 20 })
    })

    it('caps the page size at 50', async () => {
      mock.onGet(url).reply({ value: [] })

      await service.getChatMessages(CHAT_ID, 100)

      expect(mock.history[0].query).toEqual({ $top: 50 })
    })

    it('uses the next link when provided', async () => {
      const nextLink = `${url}?$skiptoken=abc`

      mock.onGet(nextLink).reply({ value: [{ id: 'm' }] })

      const result = await service.getChatMessages(undefined, undefined, nextLink)

      expect(mock.history[0].url).toBe(nextLink)
      expect(result.value).toHaveLength(1)
    })

    it('throws when chatId is missing', async () => {
      await expect(service.getChatMessages()).rejects.toThrow('Parameter "Chat" is required')
    })
  })

  describe('createOneOnOneChat', () => {
    it('creates a chat between the signed-in user and the target user', async () => {
      mock.onGet(`${API_BASE}/me`).reply({ id: 'me-123' })
      mock.onPost(`${API_BASE}/chats`).reply({ id: CHAT_ID, chatType: 'oneOnOne' })

      const result = await service.createOneOnOneChat('jane.doe@company.com')

      expect(result).toEqual({ id: CHAT_ID, chatType: 'oneOnOne' })
      expect(mock.history).toHaveLength(2)
      expect(mock.history[1].body).toEqual({
        chatType: 'oneOnOne',
        members: [
          {
            '@odata.type': '#microsoft.graph.aadUserConversationMember',
            'user@odata.bind': `${API_BASE}/users('me-123')`,
            roles: ['owner'],
          },
          {
            '@odata.type': '#microsoft.graph.aadUserConversationMember',
            'user@odata.bind': `${API_BASE}/users('jane.doe@company.com')`,
            roles: ['owner'],
          },
        ],
      })
    })

    it('throws when the user parameter is missing', async () => {
      await expect(service.createOneOnOneChat()).rejects.toThrow('Parameter "User" is required')
      expect(mock.history).toHaveLength(0)
    })

    it('throws a wrapped error when the profile lookup fails', async () => {
      mock.onGet(`${API_BASE}/me`).replyWithError({ message: 'Unauthorized' })

      await expect(service.createOneOnOneChat('jane@company.com')).rejects.toThrow(
        'Microsoft Teams API error: Unauthorized'
      )
    })
  })
})
