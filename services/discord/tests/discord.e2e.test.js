'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Discord Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('discord')
    require('../src/index.js')

    try {
      sandbox.validateConfigs()
    } catch (error) {
      console.log(error)
      process.exit(1)
    }

    service = sandbox.getService()
    testValues = sandbox.getTestValues()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // A unique-ish suffix so repeated e2e runs don't collide.
  const suffix = Date.now()

  // ── Channels (read + lifecycle) ──

  describe('listChannels', () => {
    it('returns an array of guild channels', async () => {
      const result = await service.listChannels()

      expect(Array.isArray(result)).toBe(true)
      if (result.length) {
        expect(result[0]).toHaveProperty('id')
        expect(result[0]).toHaveProperty('type')
      }
    })
  })

  describe('createChannel + deleteChannel', () => {
    let channelId

    it('creates a text channel', async () => {
      const result = await service.createChannel(`e2e-test-${ suffix }`, 'Text', 'Created by e2e test')

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('type', 0)
      channelId = result.id
    })

    it('deletes the created channel', async () => {
      const result = await service.deleteChannel(channelId)

      expect(result).toMatchObject({ success: true, channelId })
    })
  })

  // ── Members & Roles (read) ──

  describe('listGuildMembers', () => {
    // Requires the Server Members privileged intent to be enabled for the bot.
    it('returns an array of members', async () => {
      const result = await service.listGuildMembers(5)

      expect(Array.isArray(result)).toBe(true)
      if (result.length) {
        expect(result[0]).toHaveProperty('user')
      }
    })
  })

  describe('listRoles', () => {
    it('returns an array of roles', async () => {
      const result = await service.listRoles()

      expect(Array.isArray(result)).toBe(true)
      if (result.length) {
        expect(result[0]).toHaveProperty('id')
        expect(result[0]).toHaveProperty('name')
      }
    })
  })

  describe('getGuildMember', () => {
    it('fetches a member when a userId test value is provided', async () => {
      if (!testValues.userId) {
        console.log('Skipping getGuildMember: set testValues.userId')
        return
      }

      const result = await service.getGuildMember(testValues.userId)

      expect(result).toHaveProperty('user')
      expect(result.user).toHaveProperty('id', testValues.userId)
    })
  })

  // ── Dictionaries ──

  describe('getChannelsDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getChannelsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor', null)
    })
  })

  describe('getRolesDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getRolesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor', null)
    })
  })

  describe('getMembersDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getMembersDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Messages (require a real channel) ──

  describe('message lifecycle in a test channel', () => {
    // These operations post to a real channel, so they need testValues.channelId.
    const channelId = () => testValues.channelId
    let messageId

    it('sends a message', async () => {
      if (!channelId()) {
        console.log('Skipping sendMessage: set testValues.channelId')
        return
      }

      const result = await service.sendMessage(channelId(), `E2E test message ${ suffix }`)

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('channel_id', channelId())
      messageId = result.id
    })

    it('sends a message with an embed via the advanced payload', async () => {
      if (!channelId()) {
        return
      }

      const result = await service.sendMessageAdvanced(channelId(), {
        content: `E2E advanced ${ suffix }`,
        embeds: [{ title: 'E2E', description: 'Advanced payload' }],
      })

      expect(result).toHaveProperty('id')
    })

    it('retrieves the sent message', async () => {
      if (!channelId() || !messageId) {
        return
      }

      const result = await service.getMessage(channelId(), messageId)

      expect(result).toHaveProperty('id', messageId)
    })

    it('lists recent messages', async () => {
      if (!channelId()) {
        return
      }

      const result = await service.getMessages(channelId(), 5)

      expect(Array.isArray(result)).toBe(true)
    })

    it('edits the message', async () => {
      if (!channelId() || !messageId) {
        return
      }

      const result = await service.editMessage(channelId(), messageId, `E2E edited ${ suffix }`)

      expect(result).toHaveProperty('id', messageId)
      expect(result).toHaveProperty('content', `E2E edited ${ suffix }`)
    })

    it('adds a reaction to the message', async () => {
      if (!channelId() || !messageId) {
        return
      }

      const result = await service.addReaction(channelId(), messageId, '👍')

      expect(result).toMatchObject({ success: true, messageId })
    })

    it('creates a thread from the message', async () => {
      if (!channelId() || !messageId) {
        return
      }

      const result = await service.createThread(
        channelId(),
        `E2E thread ${ suffix }`,
        messageId,
        '1 Hour'
      )

      expect(result).toHaveProperty('id')

      // Clean up the thread we just created.
      try {
        await service.deleteChannel(result.id)
      } catch (e) {
        // ignore cleanup errors
      }
    })

    it('deletes the message', async () => {
      if (!channelId() || !messageId) {
        return
      }

      const result = await service.deleteMessage(channelId(), messageId)

      expect(result).toMatchObject({ success: true, messageId })
    })
  })

  // ── Direct Messages (require a real user) ──

  describe('sendDirectMessage', () => {
    // The bot can only DM users who share a server with it and allow DMs.
    it('sends a DM when a userId test value is provided', async () => {
      if (!testValues.userId) {
        console.log('Skipping sendDirectMessage: set testValues.userId')
        return
      }

      const result = await service.sendDirectMessage(testValues.userId, `E2E DM ${ suffix }`)

      expect(result).toHaveProperty('id')
    })
  })

  // ── Roles (require a real user + assignable role) ──

  describe('addRoleToMember + removeRoleFromMember', () => {
    // Needs a member and a role the bot can manage (bot's top role above it).
    const canManage = () => Boolean(testValues.userId && testValues.roleId)

    it('adds a role to the member', async () => {
      if (!canManage()) {
        console.log('Skipping addRoleToMember: set testValues.userId and testValues.roleId')
        return
      }

      const result = await service.addRoleToMember(testValues.userId, testValues.roleId)

      expect(result).toMatchObject({ success: true, action: 'added' })
    })

    it('removes the role from the member', async () => {
      if (!canManage()) {
        return
      }

      const result = await service.removeRoleFromMember(testValues.userId, testValues.roleId)

      expect(result).toMatchObject({ success: true, action: 'removed' })
    })
  })

  // ── Webhooks (require a real webhook URL) ──

  describe('sendWebhookMessage', () => {
    it('posts through a webhook when a URL test value is provided', async () => {
      if (!testValues.webhookUrl) {
        console.log('Skipping sendWebhookMessage: set testValues.webhookUrl')
        return
      }

      const result = await service.sendWebhookMessage(
        testValues.webhookUrl,
        `E2E webhook message ${ suffix }`
      )

      expect(result).toHaveProperty('id')
    })
  })
})
