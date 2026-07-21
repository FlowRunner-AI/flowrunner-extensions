'use strict'

const { createSandbox } = require('../../../service-sandbox')

const CLIENT_ID = 'test-client-id'
const CLIENT_SECRET = 'test-client-secret'
const OAUTH_TOKEN = 'test-oauth-token'
const API_BASE = 'https://chat.googleapis.com/v1'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const USER_INFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo'

describe('Google Chat Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET })
    require('../src/index.js')
    service = sandbox.getService()
    service.request = { headers: { 'oauth-access-token': OAUTH_TOKEN } }
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
          expect.objectContaining({ name: 'clientId', required: true, shared: true }),
          expect.objectContaining({ name: 'clientSecret', required: true, shared: true }),
        ])
      )
    })
  })

  // ── OAuth ──

  describe('getOAuth2ConnectionURL', () => {
    it('returns a valid OAuth URL with required params', async () => {
      const url = await service.getOAuth2ConnectionURL()

      expect(url).toContain('https://accounts.google.com/o/oauth2/v2/auth')
      expect(url).toContain(`client_id=${ encodeURIComponent(CLIENT_ID) }`)
      expect(url).toContain('response_type=code')
      expect(url).toContain('access_type=offline')
      expect(url).toContain('prompt=consent')
      expect(url).toContain('scope=')
    })
  })

  describe('executeCallback', () => {
    it('exchanges code for token and fetches user info', async () => {
      mock.onPost(TOKEN_URL).reply({
        access_token: 'new-access-token',
        expires_in: 3600,
        refresh_token: 'new-refresh-token',
      })

      mock.onGet(USER_INFO_URL).reply({
        name: 'Test User',
        email: 'test@example.com',
        picture: 'https://example.com/photo.jpg',
      })

      const result = await service.executeCallback({
        code: 'auth-code',
        redirectURI: 'https://redirect.example.com',
      })

      expect(result).toEqual({
        token: 'new-access-token',
        expirationInSeconds: 3600,
        refreshToken: 'new-refresh-token',
        connectionIdentityName: 'Test User (test@example.com)',
        connectionIdentityImageURL: 'https://example.com/photo.jpg',
        overwrite: true,
        userData: {
          name: 'Test User',
          email: 'test@example.com',
          picture: 'https://example.com/photo.jpg',
        },
      })

      // Verify token request
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(TOKEN_URL)
    })

    it('falls back to email when name is missing', async () => {
      mock.onPost(TOKEN_URL).reply({
        access_token: 'token',
        expires_in: 3600,
        refresh_token: 'refresh',
      })

      mock.onGet(USER_INFO_URL).reply({
        email: 'test@example.com',
      })

      const result = await service.executeCallback({ code: 'code', redirectURI: 'https://redir.com' })

      expect(result.connectionIdentityName).toBe('test@example.com')
    })

    it('uses default identity name when user info fetch fails', async () => {
      mock.onPost(TOKEN_URL).reply({
        access_token: 'token',
        expires_in: 3600,
        refresh_token: 'refresh',
      })

      mock.onGet(USER_INFO_URL).replyWithError({ message: 'Network error' })

      const result = await service.executeCallback({ code: 'code', redirectURI: 'https://redir.com' })

      expect(result.connectionIdentityName).toBe('Google Chat Account')
      expect(result.connectionIdentityImageURL).toBeNull()
    })
  })

  describe('refreshToken', () => {
    it('refreshes the token successfully', async () => {
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
        message: 'Token has been expired or revoked',
        body: { error: 'invalid_grant' },
      })

      await expect(service.refreshToken('expired-token')).rejects.toThrow(
        'Refresh token expired or invalid, please re-authenticate.'
      )
    })

    it('re-throws original error for other failures', async () => {
      mock.onPost(TOKEN_URL).replyWithError({
        message: 'Server error',
        body: { error: 'server_error' },
      })

      await expect(service.refreshToken('token')).rejects.toThrow()
    })
  })

  // ── Dictionaries ──

  describe('getSpacesDictionary', () => {
    it('returns formatted dictionary items', async () => {
      mock.onGet(`${API_BASE}/spaces`).reply({
        spaces: [
          { name: 'spaces/AAA', displayName: 'Project Phoenix', spaceType: 'SPACE' },
          { name: 'spaces/BBB', displayName: 'Team Chat', spaceType: 'GROUP_CHAT' },
        ],
        nextPageToken: 'token123',
      })

      const result = await service.getSpacesDictionary({})

      expect(result).toEqual({
        cursor: 'token123',
        items: [
          { label: 'Project Phoenix', value: 'spaces/AAA', note: 'SPACE' },
          { label: 'Team Chat', value: 'spaces/BBB', note: 'GROUP_CHAT' },
        ],
      })

      expect(mock.history[0].query).toMatchObject({ pageSize: 100 })
    })

    it('filters spaces by search string', async () => {
      mock.onGet(`${API_BASE}/spaces`).reply({
        spaces: [
          { name: 'spaces/AAA', displayName: 'Project Phoenix', spaceType: 'SPACE' },
          { name: 'spaces/BBB', displayName: 'Team Chat', spaceType: 'GROUP_CHAT' },
        ],
      })

      const result = await service.getSpacesDictionary({ search: 'phoenix' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toBe('Project Phoenix')
    })

    it('uses cursor for pagination', async () => {
      mock.onGet(`${API_BASE}/spaces`).reply({ spaces: [] })

      await service.getSpacesDictionary({ cursor: 'page2token' })

      expect(mock.history[0].query).toMatchObject({ pageToken: 'page2token' })
    })

    it('handles empty/null payload', async () => {
      mock.onGet(`${API_BASE}/spaces`).reply({ spaces: [] })

      const result = await service.getSpacesDictionary(null)

      expect(result).toEqual({ cursor: undefined, items: [] })
    })

    it('uses space name as label when displayName is missing', async () => {
      mock.onGet(`${API_BASE}/spaces`).reply({
        spaces: [{ name: 'spaces/AAA', spaceType: 'DIRECT_MESSAGE' }],
      })

      const result = await service.getSpacesDictionary({})

      expect(result.items[0].label).toBe('spaces/AAA')
    })
  })

  // ── Spaces ──

  describe('listSpaces', () => {
    it('sends correct request with defaults', async () => {
      mock.onGet(`${API_BASE}/spaces`).reply({ spaces: [], nextPageToken: null })

      const result = await service.listSpaces()

      expect(result).toEqual({ spaces: [], nextPageToken: null })
      expect(mock.history[0].headers).toMatchObject({ Authorization: `Bearer ${OAUTH_TOKEN}` })
      expect(mock.history[0].query).toMatchObject({ pageSize: 100 })
    })

    it('applies space type filter', async () => {
      mock.onGet(`${API_BASE}/spaces`).reply({ spaces: [] })

      await service.listSpaces('Space')

      expect(mock.history[0].query).toMatchObject({ filter: 'spaceType = "SPACE"' })
    })

    it('passes custom page size and page token', async () => {
      mock.onGet(`${API_BASE}/spaces`).reply({ spaces: [] })

      await service.listSpaces('All', 50, 'nextToken')

      expect(mock.history[0].query).toMatchObject({ pageSize: 50, pageToken: 'nextToken' })
    })

    it('throws on API error', async () => {
      mock.onGet(`${API_BASE}/spaces`).replyWithError({
        message: 'Unauthorized',
        body: { error: { message: 'Invalid credentials' } },
      })

      await expect(service.listSpaces()).rejects.toThrow('Google Chat API error')
    })
  })

  describe('getSpace', () => {
    it('fetches a space by resource name', async () => {
      mock.onGet(`${API_BASE}/spaces/AAA`).reply({
        name: 'spaces/AAA',
        displayName: 'Test Space',
        spaceType: 'SPACE',
      })

      const result = await service.getSpace('spaces/AAA')

      expect(result.name).toBe('spaces/AAA')
    })

    it('normalizes space name without prefix', async () => {
      mock.onGet(`${API_BASE}/spaces/AAA`).reply({ name: 'spaces/AAA' })

      await service.getSpace('AAA')

      expect(mock.history[0].url).toBe(`${API_BASE}/spaces/AAA`)
    })

    it('throws when space is empty', async () => {
      await expect(service.getSpace('')).rejects.toThrow('"Space" is required')
    })
  })

  describe('createSpace', () => {
    it('creates a space with display name only', async () => {
      mock.onPost(`${API_BASE}/spaces`).reply({
        name: 'spaces/NEW',
        displayName: 'New Space',
        spaceType: 'SPACE',
      })

      const result = await service.createSpace('New Space')

      expect(result.name).toBe('spaces/NEW')
      expect(mock.history[0].body).toEqual({
        spaceType: 'SPACE',
        displayName: 'New Space',
      })
    })

    it('includes description when provided', async () => {
      mock.onPost(`${API_BASE}/spaces`).reply({ name: 'spaces/NEW' })

      await service.createSpace('New Space', 'A description')

      expect(mock.history[0].body).toEqual({
        spaceType: 'SPACE',
        displayName: 'New Space',
        spaceDetails: { description: 'A description' },
      })
    })

    it('throws when displayName is empty', async () => {
      await expect(service.createSpace('')).rejects.toThrow('"Display Name" is required')
    })
  })

  describe('setUpSpace', () => {
    it('creates a space with members', async () => {
      mock.onPost(`${API_BASE}/spaces:setup`).reply({
        name: 'spaces/CCC',
        displayName: 'Team Space',
      })

      await service.setUpSpace('Team Space', ['user@example.com', '123456789'])

      expect(mock.history[0].body).toEqual({
        space: { spaceType: 'SPACE', displayName: 'Team Space' },
        memberships: [
          { member: { name: 'users/user@example.com', type: 'HUMAN' } },
          { member: { name: 'users/123456789', type: 'HUMAN' } },
        ],
      })
    })

    it('creates a space without members', async () => {
      mock.onPost(`${API_BASE}/spaces:setup`).reply({ name: 'spaces/DDD' })

      await service.setUpSpace('Solo Space')

      expect(mock.history[0].body).toEqual({
        space: { spaceType: 'SPACE', displayName: 'Solo Space' },
      })
    })

    it('filters out falsy members', async () => {
      mock.onPost(`${API_BASE}/spaces:setup`).reply({ name: 'spaces/EEE' })

      await service.setUpSpace('Space', ['user@test.com', '', null, undefined])

      expect(mock.history[0].body.memberships).toHaveLength(1)
    })

    it('handles users/ prefix correctly', async () => {
      mock.onPost(`${API_BASE}/spaces:setup`).reply({ name: 'spaces/FFF' })

      await service.setUpSpace('Space', ['users/123'])

      expect(mock.history[0].body.memberships[0].member.name).toBe('users/123')
    })

    it('throws when displayName is empty', async () => {
      await expect(service.setUpSpace('')).rejects.toThrow('"Display Name" is required')
    })
  })

  // ── Messages ──

  describe('sendMessage', () => {
    it('sends a simple text message', async () => {
      mock.onPost(`${API_BASE}/spaces/AAA/messages`).reply({
        name: 'spaces/AAA/messages/BBB.CCC',
        text: 'Hello team!',
      })

      const result = await service.sendMessage('spaces/AAA', 'Hello team!')

      expect(result.text).toBe('Hello team!')
      expect(mock.history[0].body).toEqual({ text: 'Hello team!' })
    })

    it('sends a threaded reply with threadKey', async () => {
      mock.onPost(`${API_BASE}/spaces/AAA/messages`).reply({ name: 'spaces/AAA/messages/BBB' })

      await service.sendMessage('spaces/AAA', 'Reply', 'thread-key-1')

      expect(mock.history[0].body).toEqual({
        text: 'Reply',
        thread: { threadKey: 'thread-key-1' },
      })
      expect(mock.history[0].query).toMatchObject({
        messageReplyOption: 'REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD',
      })
    })

    it('sends a threaded reply with threadName (takes priority over threadKey)', async () => {
      mock.onPost(`${API_BASE}/spaces/AAA/messages`).reply({ name: 'spaces/AAA/messages/BBB' })

      await service.sendMessage('spaces/AAA', 'Reply', 'key', 'spaces/AAA/threads/DDD')

      expect(mock.history[0].body.thread).toEqual({ name: 'spaces/AAA/threads/DDD' })
    })

    it('uses custom reply option', async () => {
      mock.onPost(`${API_BASE}/spaces/AAA/messages`).reply({ name: 'spaces/AAA/messages/BBB' })

      await service.sendMessage('spaces/AAA', 'Reply', 'key', null, 'Reply Or Fail')

      expect(mock.history[0].query).toMatchObject({
        messageReplyOption: 'REPLY_MESSAGE_OR_FAIL',
      })
    })

    it('does not set messageReplyOption when no thread info provided', async () => {
      mock.onPost(`${API_BASE}/spaces/AAA/messages`).reply({ name: 'spaces/AAA/messages/BBB' })

      await service.sendMessage('spaces/AAA', 'Hello')

      expect(mock.history[0].query.messageReplyOption).toBeUndefined()
    })

    it('normalizes space name without prefix', async () => {
      mock.onPost(`${API_BASE}/spaces/AAA/messages`).reply({ name: 'spaces/AAA/messages/BBB' })

      await service.sendMessage('AAA', 'Hello')

      expect(mock.history[0].url).toBe(`${API_BASE}/spaces/AAA/messages`)
    })

    it('throws when text is empty', async () => {
      await expect(service.sendMessage('spaces/AAA', '')).rejects.toThrow('"Text" is required')
    })

    it('throws when space is empty', async () => {
      await expect(service.sendMessage('', 'Hello')).rejects.toThrow('"Space" is required')
    })
  })

  describe('sendCardMessage', () => {
    it('sends a card message with a full cardsV2 array', async () => {
      mock.onPost(`${API_BASE}/spaces/AAA/messages`).reply({ name: 'spaces/AAA/messages/BBB' })

      const cards = [{ cardId: 'card1', card: { header: { title: 'Test' } } }]

      await service.sendCardMessage('spaces/AAA', cards)

      expect(mock.history[0].body).toEqual({ cardsV2: cards })
    })

    it('wraps a single card entry into an array', async () => {
      mock.onPost(`${API_BASE}/spaces/AAA/messages`).reply({ name: 'spaces/AAA/messages/BBB' })

      const card = { cardId: 'card1', card: { header: { title: 'Test' } } }

      await service.sendCardMessage('spaces/AAA', card)

      expect(mock.history[0].body.cardsV2).toEqual([card])
    })

    it('wraps a bare card object into cardsV2 format', async () => {
      mock.onPost(`${API_BASE}/spaces/AAA/messages`).reply({ name: 'spaces/AAA/messages/BBB' })

      const bareCard = { header: { title: 'Test' }, sections: [] }

      await service.sendCardMessage('spaces/AAA', bareCard)

      const sent = mock.history[0].body.cardsV2
      expect(sent).toHaveLength(1)
      expect(sent[0].card).toEqual(bareCard)
      expect(sent[0].cardId).toMatch(/^card-\d+$/)
    })

    it('includes fallback text when provided', async () => {
      mock.onPost(`${API_BASE}/spaces/AAA/messages`).reply({ name: 'spaces/AAA/messages/BBB' })

      await service.sendCardMessage('spaces/AAA', [{ cardId: 'c', card: {} }], 'fallback')

      expect(mock.history[0].body.text).toBe('fallback')
    })

    it('includes thread info and reply option when threadKey provided', async () => {
      mock.onPost(`${API_BASE}/spaces/AAA/messages`).reply({ name: 'spaces/AAA/messages/BBB' })

      await service.sendCardMessage('spaces/AAA', [{ cardId: 'c', card: {} }], null, 'myThread')

      expect(mock.history[0].body.thread).toEqual({ threadKey: 'myThread' })
      expect(mock.history[0].query).toMatchObject({
        messageReplyOption: 'REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD',
      })
    })

    it('throws when card is empty', async () => {
      await expect(service.sendCardMessage('spaces/AAA', null)).rejects.toThrow('"Card" is required')
    })
  })

  describe('getMessage', () => {
    it('fetches a message by full resource name', async () => {
      const msgName = 'spaces/AAA/messages/BBB.CCC'

      mock.onGet(`${API_BASE}/${msgName}`).reply({
        name: msgName,
        text: 'Hello',
      })

      const result = await service.getMessage(msgName)

      expect(result.name).toBe(msgName)
    })

    it('throws when messageName is empty', async () => {
      await expect(service.getMessage('')).rejects.toThrow('"Message Name" is required')
    })

    it('throws when messageName format is invalid', async () => {
      await expect(service.getMessage('invalid-name')).rejects.toThrow(
        '"Message Name" must be a full resource name'
      )
    })
  })

  describe('updateMessage', () => {
    it('updates message text with PATCH', async () => {
      const msgName = 'spaces/AAA/messages/BBB.CCC'

      mock.onPatch(`${API_BASE}/${msgName}`).reply({
        name: msgName,
        text: 'Updated text',
      })

      const result = await service.updateMessage(msgName, 'Updated text')

      expect(result.text).toBe('Updated text')
      expect(mock.history[0].method).toBe('patch')
      expect(mock.history[0].query).toMatchObject({ updateMask: 'text' })
      expect(mock.history[0].body).toEqual({ text: 'Updated text' })
    })

    it('throws when text is empty', async () => {
      await expect(
        service.updateMessage('spaces/AAA/messages/BBB.CCC', '')
      ).rejects.toThrow('"Text" is required')
    })

    it('throws when messageName is invalid', async () => {
      await expect(service.updateMessage('bad-name', 'text')).rejects.toThrow(
        '"Message Name" must be a full resource name'
      )
    })
  })

  describe('deleteMessage', () => {
    it('deletes a message and returns success', async () => {
      const msgName = 'spaces/AAA/messages/BBB.CCC'

      mock.onDelete(`${API_BASE}/${msgName}`).reply({})

      const result = await service.deleteMessage(msgName)

      expect(result).toEqual({
        success: true,
        message: 'Message deleted successfully',
        messageName: msgName,
      })
    })

    it('throws when messageName is empty', async () => {
      await expect(service.deleteMessage('')).rejects.toThrow('"Message Name" is required')
    })
  })

  describe('listMessages', () => {
    it('lists messages with defaults', async () => {
      mock.onGet(`${API_BASE}/spaces/AAA/messages`).reply({
        messages: [{ name: 'spaces/AAA/messages/BBB', text: 'Hello' }],
        nextPageToken: 'token',
      })

      const result = await service.listMessages('spaces/AAA')

      expect(result.messages).toHaveLength(1)
      expect(result.nextPageToken).toBe('token')
    })

    it('passes all query parameters', async () => {
      mock.onGet(`${API_BASE}/spaces/AAA/messages`).reply({ messages: [] })

      await service.listMessages('spaces/AAA', 50, 'page2', 'createTime > "2025-01-01"', 'Newest First')

      expect(mock.history[0].query).toMatchObject({
        pageSize: 50,
        pageToken: 'page2',
        filter: 'createTime > "2025-01-01"',
        orderBy: 'createTime DESC',
      })
    })

    it('resolves order by option for Oldest First', async () => {
      mock.onGet(`${API_BASE}/spaces/AAA/messages`).reply({ messages: [] })

      await service.listMessages('spaces/AAA', null, null, null, 'Oldest First')

      expect(mock.history[0].query).toMatchObject({ orderBy: 'createTime ASC' })
    })
  })

  describe('sendWebhookMessage', () => {
    const webhookUrl = 'https://chat.googleapis.com/v1/spaces/AAA/messages?key=abc&token=xyz'

    it('sends a simple webhook message', async () => {
      mock.onPost(webhookUrl).reply({ name: 'spaces/AAA/messages/BBB' })

      const result = await service.sendWebhookMessage(webhookUrl, 'Alert!')

      expect(result.name).toBe('spaces/AAA/messages/BBB')
      expect(mock.history[0].body).toEqual({ text: 'Alert!' })
      expect(mock.history[0].headers).toMatchObject({ 'Content-Type': 'application/json' })
    })

    it('includes thread info when threadKey is provided', async () => {
      mock.onPost(webhookUrl).reply({ name: 'spaces/AAA/messages/BBB' })

      await service.sendWebhookMessage(webhookUrl, 'Alert!', 'thread-1')

      expect(mock.history[0].body).toEqual({
        text: 'Alert!',
        thread: { threadKey: 'thread-1' },
      })
      expect(mock.history[0].query).toMatchObject({
        messageReplyOption: 'REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD',
      })
    })

    it('throws when webhookUrl is empty', async () => {
      await expect(service.sendWebhookMessage('', 'text')).rejects.toThrow('"Webhook URL" is required')
    })

    it('throws when text is empty', async () => {
      await expect(service.sendWebhookMessage(webhookUrl, '')).rejects.toThrow('"Text" is required')
    })

    it('wraps API errors with descriptive message', async () => {
      mock.onPost(webhookUrl).replyWithError({
        message: 'Bad request',
        body: { error: { message: 'Invalid webhook URL' } },
      })

      await expect(service.sendWebhookMessage(webhookUrl, 'text')).rejects.toThrow(
        'Google Chat webhook error'
      )
    })
  })

  // ── Members ──

  describe('listMembers', () => {
    it('lists members with defaults', async () => {
      mock.onGet(`${API_BASE}/spaces/AAA/members`).reply({
        memberships: [{ name: 'spaces/AAA/members/123', state: 'JOINED' }],
        nextPageToken: 'next',
      })

      const result = await service.listMembers('spaces/AAA')

      expect(result.memberships).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({ pageSize: 100 })
    })

    it('passes all query parameters', async () => {
      mock.onGet(`${API_BASE}/spaces/AAA/members`).reply({ memberships: [] })

      await service.listMembers('spaces/AAA', 25, 'page2token', 'member.type = "HUMAN"')

      expect(mock.history[0].query).toMatchObject({
        pageSize: 25,
        pageToken: 'page2token',
        filter: 'member.type = "HUMAN"',
      })
    })
  })

  describe('addMember', () => {
    it('adds a member by email', async () => {
      mock.onPost(`${API_BASE}/spaces/AAA/members`).reply({
        name: 'spaces/AAA/members/123',
        state: 'JOINED',
      })

      const result = await service.addMember('spaces/AAA', 'user@example.com')

      expect(result.name).toBe('spaces/AAA/members/123')
      expect(mock.history[0].body).toEqual({
        member: { name: 'users/user@example.com', type: 'HUMAN' },
      })
    })

    it('does not double-prefix users/', async () => {
      mock.onPost(`${API_BASE}/spaces/AAA/members`).reply({ name: 'spaces/AAA/members/123' })

      await service.addMember('spaces/AAA', 'users/123')

      expect(mock.history[0].body.member.name).toBe('users/123')
    })

    it('throws when user is empty', async () => {
      await expect(service.addMember('spaces/AAA', '')).rejects.toThrow('"User" is required')
    })
  })

  describe('removeMember', () => {
    it('removes a member by user ID', async () => {
      mock.onDelete(`${API_BASE}/spaces/AAA/members/123`).reply({})

      const result = await service.removeMember('spaces/AAA', '123')

      expect(result).toEqual({
        success: true,
        message: 'Member removed successfully',
        membershipName: 'spaces/AAA/members/123',
      })
    })

    it('uses full membership resource name when provided', async () => {
      mock.onDelete(`${API_BASE}/spaces/BBB/members/456`).reply({})

      const result = await service.removeMember('spaces/AAA', 'spaces/BBB/members/456')

      expect(result.membershipName).toBe('spaces/BBB/members/456')
      expect(mock.history[0].url).toBe(`${API_BASE}/spaces/BBB/members/456`)
    })

    it('throws when member is empty', async () => {
      await expect(service.removeMember('spaces/AAA', '')).rejects.toThrow('"Member" is required')
    })
  })
})
