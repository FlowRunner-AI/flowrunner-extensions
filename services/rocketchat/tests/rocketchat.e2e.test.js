'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('RocketChat Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('rocketchat')
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

  // ── Users ──

  describe('getMe', () => {
    it('returns authenticated user profile', async () => {
      const result = await service.getMe()

      expect(result).toHaveProperty('_id')
      expect(result).toHaveProperty('username')
    })
  })

  describe('getUserInfo', () => {
    it('returns user info by username', async () => {
      const me = await service.getMe()
      const result = await service.getUserInfo(undefined, me.username)

      expect(result).toHaveProperty('user')
      expect(result.user).toHaveProperty('_id')
      expect(result.user).toHaveProperty('username', me.username)
    })
  })

  describe('setUserStatus', () => {
    it('sets the authenticated user status to Online', async () => {
      const result = await service.setUserStatus('Online')

      expect(result).toHaveProperty('success', true)
    })
  })

  // ── Channels ──

  describe('listChannels', () => {
    it('returns a list of channels', async () => {
      const result = await service.listChannels(5, 0)

      expect(result).toHaveProperty('channels')
      expect(Array.isArray(result.channels)).toBe(true)
      expect(result).toHaveProperty('success', true)
    })
  })

  describe('channel lifecycle (create, info, topic, announcement, archive, delete)', () => {
    const channelName = `e2e-test-${Date.now()}`
    let channelId

    it('creates a channel', async () => {
      const result = await service.createChannel(channelName)

      expect(result).toHaveProperty('success', true)
      expect(result).toHaveProperty('channel')
      expect(result.channel).toHaveProperty('_id')
      channelId = result.channel._id
    })

    it('gets channel info by name', async () => {
      if (!channelId) {
        console.log('Skipping: channel was not created')
        return
      }

      const result = await service.getChannelInfo(channelName)

      expect(result).toHaveProperty('channel')
      expect(result.channel._id).toBe(channelId)
    })

    it('sets channel topic', async () => {
      if (!channelId) {
        console.log('Skipping: channel was not created')
        return
      }

      const result = await service.setTopic(channelId, 'E2E test topic')

      expect(result).toHaveProperty('success', true)
    })

    it('sets channel announcement', async () => {
      if (!channelId) {
        console.log('Skipping: channel was not created')
        return
      }

      const result = await service.setAnnouncement(channelId, 'E2E test announcement')

      expect(result).toHaveProperty('success', true)
    })

    it('deletes the channel', async () => {
      if (!channelId) {
        console.log('Skipping: channel was not created')
        return
      }

      const result = await service.deleteChannel(channelId)

      expect(result).toHaveProperty('success', true)
    })
  })

  // ── Messages ──

  describe('message lifecycle (post, update, pin, star, react, delete)', () => {
    const channelName = `e2e-msg-${Date.now()}`
    let channelId
    let messageId

    it('creates a channel for messaging', async () => {
      const result = await service.createChannel(channelName)

      expect(result).toHaveProperty('success', true)
      channelId = result.channel._id
    })

    it('posts a message', async () => {
      if (!channelId) {
        console.log('Skipping: channel was not created')
        return
      }

      const result = await service.postMessage(`#${channelName}`, 'E2E test message')

      expect(result).toHaveProperty('success', true)
      expect(result).toHaveProperty('message')
      messageId = result.message._id
    })

    it('updates the message', async () => {
      if (!channelId || !messageId) {
        console.log('Skipping: message was not created')
        return
      }

      const result = await service.updateMessage(channelId, messageId, 'Updated E2E message')

      expect(result).toHaveProperty('success', true)
    })

    it('pins the message', async () => {
      if (!messageId) {
        console.log('Skipping: message was not created')
        return
      }

      const result = await service.pinMessage(messageId)

      expect(result).toHaveProperty('success', true)
    })

    it('stars the message', async () => {
      if (!messageId) {
        console.log('Skipping: message was not created')
        return
      }

      const result = await service.starMessage(messageId)

      expect(result).toHaveProperty('success', true)
    })

    it('reacts to the message', async () => {
      if (!messageId) {
        console.log('Skipping: message was not created')
        return
      }

      const result = await service.react(messageId, ':thumbsup:')

      expect(result).toHaveProperty('success', true)
    })

    it('gets channel messages', async () => {
      if (!channelId) {
        console.log('Skipping: channel was not created')
        return
      }

      const result = await service.getChannelMessages(channelId, 5)

      expect(result).toHaveProperty('messages')
      expect(Array.isArray(result.messages)).toBe(true)
    })

    it('sends a message using sendMessage', async () => {
      if (!channelId) {
        console.log('Skipping: channel was not created')
        return
      }

      const result = await service.sendMessage(channelId, 'E2E sendMessage test')

      expect(result).toHaveProperty('success', true)
      expect(result).toHaveProperty('message')
    })

    it('deletes the message', async () => {
      if (!channelId || !messageId) {
        console.log('Skipping: message was not created')
        return
      }

      const result = await service.deleteMessage(channelId, messageId)

      expect(result).toHaveProperty('success', true)
    })

    it('cleans up: deletes the channel', async () => {
      if (!channelId) {
        console.log('Skipping: channel was not created')
        return
      }

      const result = await service.deleteChannel(channelId)

      expect(result).toHaveProperty('success', true)
    })
  })

  // ── Groups ──

  describe('group lifecycle (create, info, list, delete)', () => {
    const groupName = `e2e-group-${Date.now()}`
    let groupId

    it('creates a private group', async () => {
      const result = await service.createGroup(groupName)

      expect(result).toHaveProperty('success', true)
      expect(result).toHaveProperty('group')
      groupId = result.group._id
    })

    it('gets group info', async () => {
      if (!groupId) {
        console.log('Skipping: group was not created')
        return
      }

      const result = await service.getGroupInfo(groupName)

      expect(result).toHaveProperty('group')
      expect(result.group._id).toBe(groupId)
    })

    it('lists groups', async () => {
      const result = await service.listGroups(5, 0)

      expect(result).toHaveProperty('groups')
      expect(Array.isArray(result.groups)).toBe(true)
    })

    // Note: groups.delete is not exposed; we leave the group or use channels.delete equivalent
    // The service does not have a deleteGroup method, so we skip cleanup for groups
  })

  // ── Direct Messages ──

  describe('direct messages', () => {
    it('creates a DM with self', async () => {
      const me = await service.getMe()
      const result = await service.createDirectMessage(me.username)

      expect(result).toHaveProperty('success', true)
      expect(result).toHaveProperty('room')
    })

    it('sends a DM to a target user', async () => {
      const { dmUsername } = testValues

      if (!dmUsername) {
        console.log('Skipping sendDirectMessage: testValues.dmUsername not set')
        return
      }

      const result = await service.sendDirectMessage(dmUsername, 'E2E DM test')

      expect(result).toHaveProperty('success', true)
    })
  })

  // ── Dictionaries ──

  describe('getChannelsDictionary', () => {
    it('returns items with label and value', async () => {
      const result = await service.getChannelsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
        expect(result.items[0]).toHaveProperty('note', 'Channel')
      }
    })
  })

  describe('getUsersDictionary', () => {
    it('returns items with label, value, and note', async () => {
      const result = await service.getUsersDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
        expect(result.items[0]).toHaveProperty('note')
      }
    })
  })
})
