'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Mattermost Service (e2e)', () => {
  let sandbox
  let service

  beforeAll(() => {
    sandbox = createE2ESandbox('mattermost')
    require('../src/index.js')

    try {
      sandbox.validateConfigs()
    } catch (error) {
      console.log(error)
      process.exit(1)
    }

    service = sandbox.getService()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Users ──

  describe('getMe', () => {
    it('returns the authenticated user profile', async () => {
      const result = await service.getMe()

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('username')
    })
  })

  describe('searchUsers', () => {
    it('returns an array of matching users', async () => {
      const me = await service.getMe()
      const result = await service.searchUsers(me.username)

      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThan(0)
      expect(result[0]).toHaveProperty('id')
      expect(result[0]).toHaveProperty('username')
    })
  })

  describe('getUser', () => {
    it('returns a user by ID', async () => {
      const me = await service.getMe()
      const result = await service.getUser(me.id)

      expect(result).toHaveProperty('id', me.id)
      expect(result).toHaveProperty('username')
    })
  })

  describe('getUserByUsername', () => {
    it('returns a user by username', async () => {
      const me = await service.getMe()
      const result = await service.getUserByUsername(me.username)

      expect(result).toHaveProperty('id', me.id)
      expect(result).toHaveProperty('username', me.username)
    })
  })

  // ── Teams ──

  describe('listTeams', () => {
    it('returns an array of teams', async () => {
      const result = await service.listTeams()

      expect(Array.isArray(result)).toBe(true)
    })
  })

  describe('getTeam', () => {
    it('returns a team by ID', async () => {
      const { teamId } = sandbox.getTestValues()

      if (!teamId) {
        console.log('Skipping getTeam: no teamId in testValues')
        return
      }

      const result = await service.getTeam(teamId)

      expect(result).toHaveProperty('id', teamId)
      expect(result).toHaveProperty('name')
      expect(result).toHaveProperty('display_name')
    })
  })

  // ── Channels ──

  describe('listChannelsForTeam', () => {
    it('returns an array of channels for the team', async () => {
      const { teamId } = sandbox.getTestValues()

      if (!teamId) {
        console.log('Skipping listChannelsForTeam: no teamId in testValues')
        return
      }

      const result = await service.listChannelsForTeam(teamId)

      expect(Array.isArray(result)).toBe(true)
    })
  })

  describe('getChannel', () => {
    it('returns a channel by ID', async () => {
      const { channelId } = sandbox.getTestValues()

      if (!channelId) {
        console.log('Skipping getChannel: no channelId in testValues')
        return
      }

      const result = await service.getChannel(channelId)

      expect(result).toHaveProperty('id', channelId)
      expect(result).toHaveProperty('name')
    })
  })

  describe('channel lifecycle', () => {
    const { teamId } = {} // will be populated from testValues in the test
    let createdChannelId

    it('creates a channel', async () => {
      const { teamId } = sandbox.getTestValues()

      if (!teamId) {
        console.log('Skipping channel lifecycle: no teamId in testValues')
        return
      }

      const channelName = `e2e-test-${Date.now()}`
      const result = await service.createChannel(
        teamId,
        channelName,
        `E2E Test Channel ${Date.now()}`,
        'Public',
        'E2E test purpose',
        'E2E test header'
      )

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('name', channelName)
      expect(result).toHaveProperty('type', 'O')
      createdChannelId = result.id
    })

    it('retrieves the created channel by name', async () => {
      const { teamId } = sandbox.getTestValues()

      if (!createdChannelId || !teamId) {
        console.log('Skipping: channel was not created')
        return
      }

      const channel = await service.getChannel(createdChannelId)
      const byName = await service.getChannelByName(teamId, channel.name)

      expect(byName).toHaveProperty('id', createdChannelId)
    })

    it('deletes the created channel', async () => {
      if (!createdChannelId) {
        console.log('Skipping: channel was not created')
        return
      }

      const result = await service.deleteChannel(createdChannelId)

      expect(result).toHaveProperty('status', 'OK')
    })
  })

  // ── Posts ──

  describe('post lifecycle', () => {
    let createdPostId

    it('creates a post in a channel', async () => {
      const { channelId } = sandbox.getTestValues()

      if (!channelId) {
        console.log('Skipping post lifecycle: no channelId in testValues')
        return
      }

      const result = await service.createPost(channelId, `E2E test message ${Date.now()}`)

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('channel_id', channelId)
      expect(result).toHaveProperty('message')
      createdPostId = result.id
    })

    it('retrieves the created post', async () => {
      if (!createdPostId) {
        console.log('Skipping: post was not created')
        return
      }

      const result = await service.getPost(createdPostId)

      expect(result).toHaveProperty('id', createdPostId)
      expect(result).toHaveProperty('message')
    })

    it('updates the post message', async () => {
      if (!createdPostId) {
        console.log('Skipping: post was not created')
        return
      }

      const result = await service.updatePost(createdPostId, 'E2E updated message')

      expect(result).toHaveProperty('id', createdPostId)
      expect(result).toHaveProperty('message', 'E2E updated message')
    })

    it('pins and unpins the post', async () => {
      if (!createdPostId) {
        console.log('Skipping: post was not created')
        return
      }

      const pinResult = await service.pinPost(createdPostId)
      expect(pinResult).toBeDefined()

      const unpinResult = await service.unpinPost(createdPostId)
      expect(unpinResult).toBeDefined()
    })

    it('adds and removes a reaction', async () => {
      if (!createdPostId) {
        console.log('Skipping: post was not created')
        return
      }

      const me = await service.getMe()

      const addResult = await service.addReaction(me.id, createdPostId, 'thumbsup')
      expect(addResult).toHaveProperty('emoji_name', 'thumbsup')

      const removeResult = await service.removeReaction(me.id, createdPostId, 'thumbsup')
      expect(removeResult).toBeDefined()
    })

    it('creates a threaded reply', async () => {
      if (!createdPostId) {
        console.log('Skipping: post was not created')
        return
      }

      const { channelId } = sandbox.getTestValues()
      const result = await service.createPost(channelId, 'E2E threaded reply', createdPostId)

      expect(result).toHaveProperty('root_id', createdPostId)
    })

    it('deletes the created post', async () => {
      if (!createdPostId) {
        console.log('Skipping: post was not created')
        return
      }

      const result = await service.deletePost(createdPostId)

      expect(result).toHaveProperty('status', 'OK')
    })
  })

  describe('getChannelPosts', () => {
    it('returns posts for a channel', async () => {
      const { channelId } = sandbox.getTestValues()

      if (!channelId) {
        console.log('Skipping getChannelPosts: no channelId in testValues')
        return
      }

      const result = await service.getChannelPosts(channelId, 0, 5)

      expect(result).toHaveProperty('order')
      expect(result).toHaveProperty('posts')
    })
  })

  describe('searchPosts', () => {
    it('returns search results for a team', async () => {
      const { teamId } = sandbox.getTestValues()

      if (!teamId) {
        console.log('Skipping searchPosts: no teamId in testValues')
        return
      }

      const result = await service.searchPosts(teamId, 'test')

      expect(result).toHaveProperty('order')
      expect(result).toHaveProperty('posts')
    })
  })

  // ── Direct / Group Channels ──

  describe('createDirectChannel', () => {
    it('creates a direct channel between two users', async () => {
      const { userId } = sandbox.getTestValues()

      if (!userId) {
        console.log('Skipping createDirectChannel: no userId in testValues')
        return
      }

      const me = await service.getMe()
      const result = await service.createDirectChannel(me.id, userId)

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('type', 'D')
    })
  })

  // ── Dictionaries ──

  describe('getTeamsDictionary', () => {
    it('returns dictionary items', async () => {
      const result = await service.getTeamsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
      }
    })
  })

  describe('getChannelsDictionary', () => {
    it('returns empty items when no team criteria', async () => {
      const result = await service.getChannelsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('returns channels for a team', async () => {
      const { teamId } = sandbox.getTestValues()

      if (!teamId) {
        console.log('Skipping getChannelsDictionary with team: no teamId in testValues')
        return
      }

      const result = await service.getChannelsDictionary({ criteria: { teamId } })

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getUsersDictionary', () => {
    it('returns dictionary items', async () => {
      const result = await service.getUsersDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
        expect(result.items[0]).toHaveProperty('note')
      }
    })

    it('returns search results when searching', async () => {
      const me = await service.getMe()
      const result = await service.getUsersDictionary({ search: me.username })

      expect(result).toHaveProperty('items')
      expect(result.items.length).toBeGreaterThan(0)
    })
  })

  // ── User Status ──

  describe('updateUserStatus', () => {
    it('updates the authenticated user status', async () => {
      const me = await service.getMe()
      const result = await service.updateUserStatus(me.id, 'Online')

      expect(result).toHaveProperty('user_id', me.id)
      expect(result).toHaveProperty('status', 'online')
    })
  })
})
