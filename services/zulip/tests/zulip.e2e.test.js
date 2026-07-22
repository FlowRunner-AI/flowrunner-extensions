'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

const SUFFIX = Date.now()

describe('Zulip Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('zulip')
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

  // ── Connection ──

  describe('getOwnUser', () => {
    it('returns the authenticated account profile', async () => {
      const result = await service.getOwnUser()

      expect(result).toHaveProperty('result', 'success')
      expect(result).toHaveProperty('user_id')
      expect(result).toHaveProperty('email')
    })
  })

  // ── Streams ──

  describe('streams', () => {
    it('lists the accessible streams', async () => {
      const result = await service.getStreams()

      expect(result).toHaveProperty('result', 'success')
      expect(Array.isArray(result.streams)).toBe(true)
    })

    it('lists only subscribed streams', async () => {
      const result = await service.getStreams(false, true)

      expect(result).toHaveProperty('result', 'success')
    })

    it('resolves a stream name to its numeric id and lists its topics', async () => {
      const { streamName } = testValues

      if (!streamName) {
        console.log('Skipping getStreamId/getStreamTopics: testValues.streamName not set')

        return
      }

      const idResult = await service.getStreamId(streamName)

      expect(idResult).toHaveProperty('stream_id')

      const topics = await service.getStreamTopics(idResult.stream_id)

      expect(topics).toHaveProperty('result', 'success')
      expect(Array.isArray(topics.topics)).toBe(true)
    })

    it('creates and unsubscribes from a temporary stream when explicitly enabled', async () => {
      const { createStream } = testValues

      if (!createStream) {
        console.log('Skipping createStream/unsubscribeFromStreams: testValues.createStream not set to true')

        return
      }

      const name = `flowrunner-e2e-${ SUFFIX }`

      const created = await service.createStream(name, 'Created by the FlowRunner e2e suite.', true)

      expect(created).toHaveProperty('result', 'success')

      const removed = await service.unsubscribeFromStreams([name])

      expect(removed).toHaveProperty('result', 'success')
    })

    it('subscribes to an existing stream when one is configured', async () => {
      const { streamName } = testValues

      if (!streamName) {
        console.log('Skipping subscribeToStreams: testValues.streamName not set')

        return
      }

      const result = await service.subscribeToStreams([streamName])

      expect(result).toHaveProperty('result', 'success')
    })
  })

  // ── Messages ──

  describe('message lifecycle', () => {
    let messageId

    it('sends a stream message', async () => {
      const { streamName } = testValues

      if (!streamName) {
        console.log('Skipping sendMessage: testValues.streamName not set')

        return
      }

      const result = await service.sendMessage(
        'Stream',
        streamName,
        `flowrunner-e2e-${ SUFFIX }`,
        'Hello from the FlowRunner e2e suite.'
      )

      expect(result).toHaveProperty('result', 'success')
      expect(result).toHaveProperty('id')

      messageId = result.id
    })

    it('retrieves recent messages', async () => {
      const result = await service.getMessages('newest', 5, 0)

      expect(result).toHaveProperty('result', 'success')
      expect(Array.isArray(result.messages)).toBe(true)
    })

    it('retrieves messages narrowed to the test stream', async () => {
      const { streamName } = testValues

      if (!streamName) {
        console.log('Skipping narrowed getMessages: testValues.streamName not set')

        return
      }

      const result = await service.getMessages('newest', 5, 0, [{ operator: 'stream', operand: streamName }])

      expect(result).toHaveProperty('result', 'success')
    })

    it('updates the message', async () => {
      if (!messageId) {
        console.log('Skipping updateMessage: no message was sent')

        return
      }

      const result = await service.updateMessage(messageId, 'Edited by the FlowRunner e2e suite.')

      expect(result).toHaveProperty('result', 'success')
    })

    it('adds and removes a reaction', async () => {
      if (!messageId) {
        console.log('Skipping reactions: no message was sent')

        return
      }

      const added = await service.addReaction(messageId, 'thumbs_up')

      expect(added).toHaveProperty('result', 'success')

      const removed = await service.removeReaction(messageId, 'thumbs_up')

      expect(removed).toHaveProperty('result', 'success')
    })

    it('reads the message read receipts when the organization allows it', async () => {
      if (!messageId) {
        console.log('Skipping getMessageReadReceipts: no message was sent')

        return
      }

      try {
        const result = await service.getMessageReadReceipts(messageId)

        expect(result).toHaveProperty('result', 'success')
      } catch (error) {
        console.log(`getMessageReadReceipts not available: ${ error.message }`)
      }
    })

    it('deletes the message', async () => {
      if (!messageId) {
        console.log('Skipping deleteMessage: no message was sent')

        return
      }

      const result = await service.deleteMessage(messageId)

      expect(result).toHaveProperty('result', 'success')
    })
  })

  // ── Users ──

  describe('users', () => {
    it('lists the organization members', async () => {
      const result = await service.getUsers()

      expect(result).toHaveProperty('result', 'success')
      expect(Array.isArray(result.members)).toBe(true)
    })

    it('lists members with custom profile fields', async () => {
      const result = await service.getUsers(true)

      expect(result).toHaveProperty('result', 'success')
    })

    it('retrieves the authenticated user by id', async () => {
      const me = await service.getOwnUser()
      const result = await service.getUser(me.user_id)

      expect(result).toHaveProperty('result', 'success')
      expect(result.user).toHaveProperty('user_id', me.user_id)
    })

    it('creates, updates and deactivates a user when explicitly enabled', async () => {
      const { newUserEmail, newUserPassword } = testValues

      if (!newUserEmail || !newUserPassword) {
        console.log('Skipping createUser/updateUser/deactivateUser: testValues.newUserEmail or testValues.newUserPassword not set')

        return
      }

      const created = await service.createUser(newUserEmail, newUserPassword, `FlowRunner E2E ${ SUFFIX }`)

      expect(created).toHaveProperty('result', 'success')

      const updated = await service.updateUser(created.user_id, `FlowRunner E2E ${ SUFFIX } (updated)`, 'Member')

      expect(updated).toHaveProperty('result', 'success')

      const deactivated = await service.deactivateUser(created.user_id)

      expect(deactivated).toHaveProperty('result', 'success')
    })
  })

  // ── Events ──

  describe('registerEventQueue', () => {
    it('registers an event queue for message events', async () => {
      const result = await service.registerEventQueue(['message'])

      expect(result).toHaveProperty('result', 'success')
      expect(result).toHaveProperty('queue_id')
    })
  })

  // ── Dictionary ──

  describe('getStreamsDictionary', () => {
    it('returns streams as dictionary items', async () => {
      const result = await service.getStreamsDictionary({})

      expect(result).toHaveProperty('items')
      expect(result.cursor).toBeNull()

      for (const item of result.items) {
        expect(item).toHaveProperty('label')
        expect(item).toHaveProperty('value')
        expect(item.note).toMatch(/^ID: /)
      }
    })

    it('filters streams by search text', async () => {
      const result = await service.getStreamsDictionary({ search: 'zzz-no-match-zzz' })

      expect(result.items).toEqual([])
    })
  })

  // ── Errors ──

  describe('error handling', () => {
    it('throws a descriptive error for an unknown stream', async () => {
      await expect(service.getStreamId(`no-such-stream-${ SUFFIX }`)).rejects.toThrow(/Zulip API error/)
    })
  })
})
