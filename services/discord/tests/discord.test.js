'use strict'

const { createSandbox } = require('../../../service-sandbox')

const BOT_TOKEN = 'test-bot-token-123'
const GUILD_ID = '1100000000000000000'
const BASE = 'https://discord.com/api/v10'

describe('Discord Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ botToken: BOT_TOKEN, guildId: GUILD_ID })
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
          name: 'botToken',
          displayName: 'Bot Token',
          required: true,
          shared: false,
          type: 'STRING',
        }),
        expect.objectContaining({
          name: 'guildId',
          displayName: 'Server (Guild) ID',
          required: true,
          shared: false,
          type: 'STRING',
        }),
      ])
    })

    it('sends the Bot Authorization header on requests', async () => {
      mock.onGet(`${ BASE }/guilds/${ GUILD_ID }/channels`).reply([])

      await service.listChannels()

      expect(mock.history[0].headers).toMatchObject({
        'Authorization': `Bot ${ BOT_TOKEN }`,
        'Content-Type': 'application/json',
      })
    })
  })

  // ── Messages ──

  describe('sendMessage', () => {
    it('sends content-only message with correct request', async () => {
      mock.onPost(`${ BASE }/channels/123/messages`).reply({ id: 'msg_1' })

      const result = await service.sendMessage('123', 'Hello world')

      expect(result).toEqual({ id: 'msg_1' })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/channels/123/messages`)
      expect(mock.history[0].body).toEqual({ content: 'Hello world' })
    })

    it('includes an embed and tts when all params are provided', async () => {
      mock.onPost(`${ BASE }/channels/123/messages`).reply({ id: 'msg_2' })

      await service.sendMessage(
        '123',
        'Hello',
        'Build #42',
        'All checks passed',
        '#5865F2',
        'https://example.com/image.png',
        true
      )

      expect(mock.history[0].body).toEqual({
        content: 'Hello',
        tts: true,
        embeds: [
          {
            title: 'Build #42',
            description: 'All checks passed',
            color: 5793266,
            image: { url: 'https://example.com/image.png' },
          },
        ],
      })
    })

    it('omits tts when false and builds an embed from a single field', async () => {
      mock.onPost(`${ BASE }/channels/123/messages`).reply({ id: 'msg_3' })

      await service.sendMessage('123', undefined, 'Only Title', undefined, undefined, undefined, false)

      expect(mock.history[0].body).toEqual({
        embeds: [{ title: 'Only Title' }],
      })
    })

    it('throws when neither content nor an embed field is provided', async () => {
      await expect(service.sendMessage('123')).rejects.toThrow(
        'Either message content or at least one embed field'
      )
      expect(mock.history).toHaveLength(0)
    })

    it('throws on invalid embed color', async () => {
      await expect(service.sendMessage('123', 'Hi', undefined, undefined, 'nothex')).rejects.toThrow(
        'Invalid embed color'
      )
    })

    it('wraps API errors with the Discord message', async () => {
      mock.onPost(`${ BASE }/channels/123/messages`).replyWithError({
        message: 'Request failed',
        status: 403,
        body: { message: 'Missing Permissions', code: 50013 },
      })

      await expect(service.sendMessage('123', 'Hi')).rejects.toThrow(
        'Discord API error: Missing Permissions'
      )
    })

    it('appends error details when the API returns field errors', async () => {
      mock.onPost(`${ BASE }/channels/123/messages`).replyWithError({
        message: 'Bad Request',
        status: 400,
        body: { message: 'Invalid Form Body', errors: { content: { _errors: [] } } },
      })

      await expect(service.sendMessage('123', 'Hi')).rejects.toThrow(
        'Discord API error: Invalid Form Body Details:'
      )
    })

    it('produces a rate limit error on 429', async () => {
      mock.onPost(`${ BASE }/channels/123/messages`).replyWithError({
        message: 'Too Many Requests',
        status: 429,
        body: { retry_after: 1.5, global: false },
      })

      await expect(service.sendMessage('123', 'Hi')).rejects.toThrow(
        'Discord rate limit exceeded. Retry after 1.5 seconds.'
      )
    })

    it('produces a global rate limit error when global flag is set', async () => {
      mock.onPost(`${ BASE }/channels/123/messages`).replyWithError({
        message: 'Too Many Requests',
        body: { retry_after: 2, global: true },
      })

      await expect(service.sendMessage('123', 'Hi')).rejects.toThrow(
        'Discord global rate limit exceeded. Retry after 2 seconds.'
      )
    })
  })

  describe('sendMessageAdvanced', () => {
    it('passes the raw payload straight through', async () => {
      mock.onPost(`${ BASE }/channels/123/messages`).reply({ id: 'msg_adv' })

      const payload = {
        content: 'Pick an option',
        components: [{ type: 1, components: [{ type: 2, style: 1, label: 'Approve', custom_id: 'approve' }] }],
      }

      const result = await service.sendMessageAdvanced('123', payload)

      expect(result).toEqual({ id: 'msg_adv' })
      expect(mock.history[0].body).toBe(payload)
    })

    it('throws when the payload is not an object', async () => {
      await expect(service.sendMessageAdvanced('123', 'not-an-object')).rejects.toThrow(
        'Message Payload must be an object'
      )
      expect(mock.history).toHaveLength(0)
    })

    it('throws when the payload is missing', async () => {
      await expect(service.sendMessageAdvanced('123')).rejects.toThrow(
        'Message Payload must be an object'
      )
    })
  })

  describe('editMessage', () => {
    it('sends a PATCH with content only', async () => {
      mock.onPatch(`${ BASE }/channels/123/messages/456`).reply({ id: '456' })

      const result = await service.editMessage('123', '456', 'Updated text')

      expect(result).toEqual({ id: '456' })
      expect(mock.history[0].method).toBe('patch')
      expect(mock.history[0].url).toBe(`${ BASE }/channels/123/messages/456`)
      expect(mock.history[0].body).toEqual({ content: 'Updated text' })
    })

    it('replaces embeds when embed fields are provided', async () => {
      mock.onPatch(`${ BASE }/channels/123/messages/456`).reply({ id: '456' })

      await service.editMessage('123', '456', undefined, 'New Title', 'New Body', '5865F2')

      expect(mock.history[0].body).toEqual({
        embeds: [{ title: 'New Title', description: 'New Body', color: 5793266 }],
      })
    })

    it('throws when nothing to edit is provided', async () => {
      await expect(service.editMessage('123', '456')).rejects.toThrow(
        'Provide new content or at least one embed field'
      )
      expect(mock.history).toHaveLength(0)
    })
  })

  describe('deleteMessage', () => {
    it('sends a DELETE and returns a success summary', async () => {
      mock.onDelete(`${ BASE }/channels/123/messages/456`).reply(undefined)

      const result = await service.deleteMessage('123', '456')

      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${ BASE }/channels/123/messages/456`)
      expect(result).toEqual({ success: true, channelId: '123', messageId: '456' })
    })

    it('wraps API errors', async () => {
      mock.onDelete(`${ BASE }/channels/123/messages/456`).replyWithError({
        message: 'Not Found',
        status: 404,
        body: { message: 'Unknown Message' },
      })

      await expect(service.deleteMessage('123', '456')).rejects.toThrow(
        'Discord API error: Unknown Message'
      )
    })
  })

  describe('getMessages', () => {
    it('uses the default limit when none is provided', async () => {
      mock.onGet(`${ BASE }/channels/123/messages`).reply([])

      const result = await service.getMessages('123')

      expect(result).toEqual([])
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].query).toEqual({ limit: 50 })
    })

    it('passes limit, before and after when provided', async () => {
      mock.onGet(`${ BASE }/channels/123/messages`).reply([{ id: 'm1' }])

      await service.getMessages('123', 25, 'before_id', 'after_id')

      expect(mock.history[0].query).toEqual({ limit: 25, before: 'before_id', after: 'after_id' })
    })
  })

  describe('getMessage', () => {
    it('fetches a single message', async () => {
      mock.onGet(`${ BASE }/channels/123/messages/456`).reply({ id: '456', content: 'Hi' })

      const result = await service.getMessage('123', '456')

      expect(result).toEqual({ id: '456', content: 'Hi' })
      expect(mock.history[0].url).toBe(`${ BASE }/channels/123/messages/456`)
      expect(mock.history[0].method).toBe('get')
    })
  })

  describe('addReaction', () => {
    it('URL-encodes the emoji and PUTs to the @me reaction endpoint', async () => {
      const emoji = '👍'
      const encoded = encodeURIComponent(emoji)
      mock.onPut(`${ BASE }/channels/123/messages/456/reactions/${ encoded }/@me`).reply(undefined)

      const result = await service.addReaction('123', '456', emoji)

      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].url).toBe(
        `${ BASE }/channels/123/messages/456/reactions/${ encoded }/@me`
      )
      expect(mock.history[0].body).toEqual({})
      expect(result).toEqual({ success: true, channelId: '123', messageId: '456', emoji })
    })

    it('encodes a custom name:id emoji', async () => {
      const emoji = 'partyblob:1234567890123456789'
      const encoded = encodeURIComponent(emoji)
      mock.onPut(`${ BASE }/channels/123/messages/456/reactions/${ encoded }/@me`).reply(undefined)

      await service.addReaction('123', '456', emoji)

      expect(mock.history[0].url).toBe(
        `${ BASE }/channels/123/messages/456/reactions/${ encoded }/@me`
      )
    })
  })

  describe('sendDirectMessage', () => {
    it('opens a DM channel then posts the message', async () => {
      mock.onPost(`${ BASE }/users/@me/channels`).reply({ id: 'dm_1' })
      mock.onPost(`${ BASE }/channels/dm_1/messages`).reply({ id: 'msg_dm' })

      const result = await service.sendDirectMessage('user_1', 'Your report is ready')

      expect(result).toEqual({ id: 'msg_dm' })
      expect(mock.history).toHaveLength(2)
      expect(mock.history[0].url).toBe(`${ BASE }/users/@me/channels`)
      expect(mock.history[0].body).toEqual({ recipient_id: 'user_1' })
      expect(mock.history[1].url).toBe(`${ BASE }/channels/dm_1/messages`)
      expect(mock.history[1].body).toEqual({ content: 'Your report is ready' })
    })

    it('wraps errors when opening the DM channel fails', async () => {
      mock.onPost(`${ BASE }/users/@me/channels`).replyWithError({
        message: 'Forbidden',
        status: 403,
        body: { message: 'Cannot send messages to this user' },
      })

      await expect(service.sendDirectMessage('user_1', 'Hi')).rejects.toThrow(
        'Discord API error: Cannot send messages to this user'
      )
      expect(mock.history).toHaveLength(1)
    })
  })

  // ── Channels ──

  describe('createChannel', () => {
    it('creates a text channel with only a name (mapped type)', async () => {
      mock.onPost(`${ BASE }/guilds/${ GUILD_ID }/channels`).reply({ id: 'chan_1', type: 0 })

      const result = await service.createChannel('release-notes', 'Text')

      expect(result).toEqual({ id: 'chan_1', type: 0 })
      expect(mock.history[0].url).toBe(`${ BASE }/guilds/${ GUILD_ID }/channels`)
      expect(mock.history[0].body).toEqual({ name: 'release-notes', type: 0 })
    })

    it('maps voice/category/announcement types and includes topic + parent', async () => {
      mock.onPost(`${ BASE }/guilds/${ GUILD_ID }/channels`).reply({ id: 'chan_2', type: 5 })

      await service.createChannel('announcements', 'Announcement', 'Release news', 'cat_1')

      expect(mock.history[0].body).toEqual({
        name: 'announcements',
        type: 5,
        topic: 'Release news',
        parent_id: 'cat_1',
      })
    })

    it('passes through an unmapped/numeric type value unchanged', async () => {
      mock.onPost(`${ BASE }/guilds/${ GUILD_ID }/channels`).reply({ id: 'chan_3' })

      await service.createChannel('forum', 15)

      expect(mock.history[0].body).toEqual({ name: 'forum', type: 15 })
    })
  })

  describe('listChannels', () => {
    it('lists all guild channels', async () => {
      mock.onGet(`${ BASE }/guilds/${ GUILD_ID }/channels`).reply([{ id: 'c1', name: 'general' }])

      const result = await service.listChannels()

      expect(result).toEqual([{ id: 'c1', name: 'general' }])
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/guilds/${ GUILD_ID }/channels`)
    })
  })

  describe('deleteChannel', () => {
    it('deletes a channel and returns its name', async () => {
      mock.onDelete(`${ BASE }/channels/chan_1`).reply({ id: 'chan_1', name: 'release-notes' })

      const result = await service.deleteChannel('chan_1')

      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${ BASE }/channels/chan_1`)
      expect(result).toEqual({ success: true, channelId: 'chan_1', name: 'release-notes' })
    })

    it('handles a delete response without a name', async () => {
      mock.onDelete(`${ BASE }/channels/chan_1`).reply(undefined)

      const result = await service.deleteChannel('chan_1')

      expect(result).toEqual({ success: true, channelId: 'chan_1', name: undefined })
    })
  })

  describe('createThread', () => {
    it('creates a standalone thread with type 11 and no duration when none is given', async () => {
      // The "1 Day" default is a UI defaultValue only; when the arg is omitted
      // the code resolves undefined and clean() drops auto_archive_duration.
      mock.onPost(`${ BASE }/channels/123/threads`).reply({ id: 'thread_1' })

      const result = await service.createThread('123', 'Bug triage')

      expect(result).toEqual({ id: 'thread_1' })
      expect(mock.history[0].url).toBe(`${ BASE }/channels/123/threads`)
      expect(mock.history[0].body).toEqual({
        name: 'Bug triage',
        type: 11,
      })
    })

    it('maps the "1 Day" duration option when explicitly provided', async () => {
      mock.onPost(`${ BASE }/channels/123/threads`).reply({ id: 'thread_1b' })

      await service.createThread('123', 'Daily', undefined, '1 Day')

      expect(mock.history[0].body).toEqual({
        name: 'Daily',
        auto_archive_duration: 1440,
        type: 11,
      })
    })

    it('attaches the thread to a message and omits type when messageId is given', async () => {
      mock.onPost(`${ BASE }/channels/123/messages/456/threads`).reply({ id: 'thread_2' })

      await service.createThread('123', 'Discussion', '456', '1 Week')

      expect(mock.history[0].url).toBe(`${ BASE }/channels/123/messages/456/threads`)
      expect(mock.history[0].body).toEqual({
        name: 'Discussion',
        auto_archive_duration: 10080,
      })
    })

    it('maps each auto-archive duration option', async () => {
      mock.onPost(`${ BASE }/channels/123/threads`).reply({ id: 'thread_3' })

      await service.createThread('123', 'Hourly', undefined, '1 Hour')
      expect(mock.history[0].body.auto_archive_duration).toBe(60)

      mock.reset()
      mock.onPost(`${ BASE }/channels/123/threads`).reply({ id: 'thread_4' })
      await service.createThread('123', 'ThreeDays', undefined, '3 Days')
      expect(mock.history[0].body.auto_archive_duration).toBe(4320)
    })
  })

  // ── Members & Roles ──

  describe('listGuildMembers', () => {
    it('uses the default members limit', async () => {
      mock.onGet(`${ BASE }/guilds/${ GUILD_ID }/members`).reply([])

      const result = await service.listGuildMembers()

      expect(result).toEqual([])
      expect(mock.history[0].url).toBe(`${ BASE }/guilds/${ GUILD_ID }/members`)
      expect(mock.history[0].query).toEqual({ limit: 100 })
    })

    it('passes limit and after when provided', async () => {
      mock.onGet(`${ BASE }/guilds/${ GUILD_ID }/members`).reply([{ user: { id: 'u1' } }])

      await service.listGuildMembers(500, 'u0')

      expect(mock.history[0].query).toEqual({ limit: 500, after: 'u0' })
    })
  })

  describe('getGuildMember', () => {
    it('fetches a single member', async () => {
      mock.onGet(`${ BASE }/guilds/${ GUILD_ID }/members/u1`).reply({ user: { id: 'u1' } })

      const result = await service.getGuildMember('u1')

      expect(result).toEqual({ user: { id: 'u1' } })
      expect(mock.history[0].url).toBe(`${ BASE }/guilds/${ GUILD_ID }/members/u1`)
    })
  })

  describe('addRoleToMember', () => {
    it('PUTs the role and returns an added summary', async () => {
      mock.onPut(`${ BASE }/guilds/${ GUILD_ID }/members/u1/roles/r1`).reply(undefined)

      const result = await service.addRoleToMember('u1', 'r1')

      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].url).toBe(`${ BASE }/guilds/${ GUILD_ID }/members/u1/roles/r1`)
      expect(mock.history[0].body).toEqual({})
      expect(result).toEqual({ success: true, userId: 'u1', roleId: 'r1', action: 'added' })
    })

    it('wraps API errors', async () => {
      mock.onPut(`${ BASE }/guilds/${ GUILD_ID }/members/u1/roles/r1`).replyWithError({
        message: 'Forbidden',
        status: 403,
        body: { message: 'Missing Permissions' },
      })

      await expect(service.addRoleToMember('u1', 'r1')).rejects.toThrow(
        'Discord API error: Missing Permissions'
      )
    })
  })

  describe('removeRoleFromMember', () => {
    it('DELETEs the role and returns a removed summary', async () => {
      mock.onDelete(`${ BASE }/guilds/${ GUILD_ID }/members/u1/roles/r1`).reply(undefined)

      const result = await service.removeRoleFromMember('u1', 'r1')

      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${ BASE }/guilds/${ GUILD_ID }/members/u1/roles/r1`)
      expect(result).toEqual({ success: true, userId: 'u1', roleId: 'r1', action: 'removed' })
    })
  })

  describe('listRoles', () => {
    it('lists all guild roles', async () => {
      mock.onGet(`${ BASE }/guilds/${ GUILD_ID }/roles`).reply([{ id: 'r1', name: 'Moderator' }])

      const result = await service.listRoles()

      expect(result).toEqual([{ id: 'r1', name: 'Moderator' }])
      expect(mock.history[0].url).toBe(`${ BASE }/guilds/${ GUILD_ID }/roles`)
      expect(mock.history[0].method).toBe('get')
    })
  })

  // ── Webhooks ──

  describe('sendWebhookMessage', () => {
    const WEBHOOK_URL = 'https://discord.com/api/webhooks/1180000000000000000/token-abc'

    it('posts content with wait=true and no bot auth header', async () => {
      mock.onPost(WEBHOOK_URL).reply({ id: 'wh_msg_1' })

      const result = await service.sendWebhookMessage(WEBHOOK_URL, 'Nightly backup completed')

      expect(result).toEqual({ id: 'wh_msg_1' })
      expect(mock.history[0].url).toBe(WEBHOOK_URL)
      expect(mock.history[0].query).toMatchObject({ wait: true })
      expect(mock.history[0].headers).toMatchObject({ 'Content-Type': 'application/json' })
      expect(mock.history[0].headers.Authorization).toBeUndefined()
      expect(mock.history[0].body).toEqual({ content: 'Nightly backup completed' })
    })

    it('includes username, avatar and an embed', async () => {
      mock.onPost(WEBHOOK_URL).reply({ id: 'wh_msg_2' })

      await service.sendWebhookMessage(
        WEBHOOK_URL,
        'Deployed',
        'Backup Bot',
        'https://example.com/avatar.png',
        'Title',
        'Body',
        '#5865F2',
        'https://example.com/img.png'
      )

      expect(mock.history[0].body).toEqual({
        content: 'Deployed',
        username: 'Backup Bot',
        avatar_url: 'https://example.com/avatar.png',
        embeds: [
          {
            title: 'Title',
            description: 'Body',
            color: 5793266,
            image: { url: 'https://example.com/img.png' },
          },
        ],
      })
    })

    it('accepts a discordapp.com webhook URL', async () => {
      const legacyUrl = 'https://discordapp.com/api/webhooks/1180000000000000000/token-abc'
      mock.onPost(legacyUrl).reply({ id: 'wh_msg_3' })

      await service.sendWebhookMessage(legacyUrl, 'Hi')

      expect(mock.history[0].url).toBe(legacyUrl)
    })

    it('throws on a non-Discord webhook URL', async () => {
      await expect(
        service.sendWebhookMessage('https://evil.example.com/webhook', 'Hi')
      ).rejects.toThrow('Webhook URL must be a Discord webhook URL')
      expect(mock.history).toHaveLength(0)
    })

    it('throws when neither content nor embed is provided', async () => {
      await expect(service.sendWebhookMessage(WEBHOOK_URL)).rejects.toThrow(
        'Either message content or at least one embed field'
      )
      expect(mock.history).toHaveLength(0)
    })

    it('wraps API errors from the webhook post', async () => {
      mock.onPost(WEBHOOK_URL).replyWithError({
        message: 'Unknown Webhook',
        status: 404,
        body: { message: 'Unknown Webhook' },
      })

      await expect(service.sendWebhookMessage(WEBHOOK_URL, 'Hi')).rejects.toThrow(
        'Discord API error: Unknown Webhook'
      )
    })
  })

  // ── Dictionaries ──

  describe('getChannelsDictionary', () => {
    const channels = [
      { id: 'c2', name: 'zeta', type: 0, position: 2 },
      { id: 'c1', name: 'general', type: 0, position: 0 },
      { id: 'c3', name: 'news', type: 5, position: 1 },
      { id: 'c4', name: 'Voice Room', type: 2, position: 3 },
      { id: 'c5', name: 'Projects', type: 4, position: 4 },
    ]

    it('returns only text/announcement channels sorted by position', async () => {
      mock.onGet(`${ BASE }/guilds/${ GUILD_ID }/channels`).reply(channels)

      const result = await service.getChannelsDictionary({})

      expect(result.cursor).toBeNull()
      expect(result.items).toEqual([
        { label: 'general', value: 'c1', note: 'Text' },
        { label: 'news', value: 'c3', note: 'Announcement' },
        { label: 'zeta', value: 'c2', note: 'Text' },
      ])
    })

    it('filters by case-insensitive search', async () => {
      mock.onGet(`${ BASE }/guilds/${ GUILD_ID }/channels`).reply(channels)

      const result = await service.getChannelsDictionary({ search: 'GEN' })

      expect(result.items).toEqual([{ label: 'general', value: 'c1', note: 'Text' }])
    })

    it('handles a null payload', async () => {
      mock.onGet(`${ BASE }/guilds/${ GUILD_ID }/channels`).reply(channels)

      const result = await service.getChannelsDictionary(null)

      expect(result.items).toHaveLength(3)
    })

    it('handles a null channels response', async () => {
      mock.onGet(`${ BASE }/guilds/${ GUILD_ID }/channels`).reply(null)

      const result = await service.getChannelsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getRolesDictionary', () => {
    const roles = [
      { id: 'r1', name: '@everyone', position: 0, managed: false },
      { id: 'r2', name: 'Moderator', position: 3, managed: false },
      { id: 'r3', name: 'BotRole', position: 2, managed: true },
    ]

    it('returns roles sorted by descending position with notes', async () => {
      mock.onGet(`${ BASE }/guilds/${ GUILD_ID }/roles`).reply(roles)

      const result = await service.getRolesDictionary({})

      expect(result.cursor).toBeNull()
      expect(result.items).toEqual([
        { label: 'Moderator', value: 'r2', note: 'Position 3' },
        { label: 'BotRole', value: 'r3', note: 'Managed by integration' },
        { label: '@everyone', value: 'r1', note: 'Position 0' },
      ])
    })

    it('filters by case-insensitive search', async () => {
      mock.onGet(`${ BASE }/guilds/${ GUILD_ID }/roles`).reply(roles)

      const result = await service.getRolesDictionary({ search: 'mod' })

      expect(result.items).toEqual([{ label: 'Moderator', value: 'r2', note: 'Position 3' }])
    })

    it('handles a null roles response', async () => {
      mock.onGet(`${ BASE }/guilds/${ GUILD_ID }/roles`).reply(null)

      const result = await service.getRolesDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getMembersDictionary', () => {
    it('lists members by paging when no search is given', async () => {
      const members = [
        { user: { id: 'u1', username: 'jane_doe', global_name: 'Jane' }, nick: 'Jane D' },
        { user: { id: 'u2', username: 'john_roe' } },
      ]
      mock.onGet(`${ BASE }/guilds/${ GUILD_ID }/members`).reply(members)

      const result = await service.getMembersDictionary({})

      expect(mock.history[0].url).toBe(`${ BASE }/guilds/${ GUILD_ID }/members`)
      expect(mock.history[0].query).toEqual({ limit: 100 })
      expect(result.items).toEqual([
        { label: 'jane_doe', value: 'u1', note: 'Jane D' },
        { label: 'john_roe', value: 'u2', note: undefined },
      ])
      expect(result.cursor).toBeNull()
    })

    it('uses the member search endpoint when a search term is given', async () => {
      mock.onGet(`${ BASE }/guilds/${ GUILD_ID }/members/search`).reply([
        { user: { id: 'u1', username: 'jane_doe', global_name: 'Jane' } },
      ])

      const result = await service.getMembersDictionary({ search: 'jane' })

      expect(mock.history[0].url).toBe(`${ BASE }/guilds/${ GUILD_ID }/members/search`)
      expect(mock.history[0].query).toEqual({ query: 'jane', limit: 100 })
      expect(result.items).toEqual([{ label: 'jane_doe', value: 'u1', note: 'Jane' }])
      expect(result.cursor).toBeNull()
    })

    it('passes the cursor as the after param', async () => {
      mock.onGet(`${ BASE }/guilds/${ GUILD_ID }/members`).reply([])

      await service.getMembersDictionary({ cursor: 'u9' })

      expect(mock.history[0].query).toEqual({ limit: 100, after: 'u9' })
    })

    it('returns a next cursor when a full page is returned', async () => {
      const members = Array.from({ length: 100 }, (_, i) => ({
        user: { id: `u${ i }`, username: `user${ i }` },
      }))
      mock.onGet(`${ BASE }/guilds/${ GUILD_ID }/members`).reply(members)

      const result = await service.getMembersDictionary({})

      expect(result.items).toHaveLength(100)
      expect(result.cursor).toBe('u99')
    })

    it('handles a null members response', async () => {
      mock.onGet(`${ BASE }/guilds/${ GUILD_ID }/members`).reply(null)

      const result = await service.getMembersDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })
  })
})
