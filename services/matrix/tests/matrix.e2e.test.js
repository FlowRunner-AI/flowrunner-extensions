'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Matrix Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('matrix')
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

  // ── Profile ──

  describe('whoami', () => {
    it('returns authenticated user info', async () => {
      const result = await service.whoami()

      expect(result).toHaveProperty('user_id')
      expect(typeof result.user_id).toBe('string')
      expect(result.user_id).toMatch(/^@/)
    })
  })

  describe('getProfile', () => {
    it('returns profile for the authenticated user', async () => {
      const whoami = await service.whoami()
      const result = await service.getProfile(whoami.user_id)

      expect(result).toBeDefined()
      // displayname and avatar_url may or may not be set
      expect(typeof result).toBe('object')
    })
  })

  describe('setDisplayName', () => {
    let originalName

    it('sets and restores display name', async () => {
      const whoami = await service.whoami()
      const userId = whoami.user_id

      const profile = await service.getProfile(userId)
      originalName = profile.displayname || ''

      const testName = `E2E Test ${Date.now()}`
      const setResult = await service.setDisplayName(userId, testName)
      expect(setResult).toBeDefined()

      const updated = await service.getProfile(userId)
      expect(updated.displayname).toBe(testName)

      // Restore original name
      if (originalName) {
        await service.setDisplayName(userId, originalName)
      }
    })
  })

  // ── Rooms ──

  describe('getJoinedRooms', () => {
    it('returns an array of room IDs', async () => {
      const result = await service.getJoinedRooms()

      expect(result).toHaveProperty('joined_rooms')
      expect(Array.isArray(result.joined_rooms)).toBe(true)
    })
  })

  describe('room lifecycle: create + topic + name + messages + leave + forget', () => {
    let roomId

    it('creates a private room', async () => {
      const result = await service.createRoom(
        `E2E Test Room ${Date.now()}`,
        'Created by e2e test',
        'Private Chat'
      )

      expect(result).toHaveProperty('room_id')
      expect(typeof result.room_id).toBe('string')
      roomId = result.room_id
    })

    it('sets the room topic', async () => {
      const result = await service.setRoomTopic(roomId, 'Updated topic via e2e')

      expect(result).toHaveProperty('event_id')
    })

    it('sets the room name', async () => {
      const result = await service.setRoomName(roomId, `Renamed E2E Room ${Date.now()}`)

      expect(result).toHaveProperty('event_id')
    })

    it('gets room state', async () => {
      const result = await service.getRoomState(roomId)

      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThan(0)

      const nameEvent = result.find(e => e.type === 'm.room.name')
      expect(nameEvent).toBeDefined()
    })

    it('gets room members', async () => {
      const result = await service.getRoomMembers(roomId)

      expect(result).toHaveProperty('chunk')
      expect(Array.isArray(result.chunk)).toBe(true)
      expect(result.chunk.length).toBeGreaterThan(0)
    })

    it('sends a text message', async () => {
      const result = await service.sendMessage(roomId, 'Hello from e2e test')

      expect(result).toHaveProperty('event_id')
    })

    it('sends a notice', async () => {
      const result = await service.sendNotice(roomId, 'Notice from e2e test')

      expect(result).toHaveProperty('event_id')
    })

    it('sends a message with HTML formatting', async () => {
      const result = await service.sendMessage(
        roomId,
        'Bold text',
        'Text',
        '<b>Bold text</b>'
      )

      expect(result).toHaveProperty('event_id')
    })

    it('sends an emote message', async () => {
      const result = await service.sendMessage(roomId, 'waves hello', 'Emote')

      expect(result).toHaveProperty('event_id')
    })

    it('sends a custom event', async () => {
      const result = await service.sendEvent(roomId, 'com.flowrunner.test', {
        test: true,
        timestamp: Date.now(),
      })

      expect(result).toHaveProperty('event_id')
    })

    it('gets room messages', async () => {
      const result = await service.getRoomMessages(roomId, 'Backwards', 5)

      expect(result).toHaveProperty('chunk')
      expect(Array.isArray(result.chunk)).toBe(true)
      expect(result.chunk.length).toBeGreaterThan(0)
    })

    it('redacts a message', async () => {
      // Send a message first, then redact it
      const msg = await service.sendMessage(roomId, 'To be redacted')
      const result = await service.redactEvent(roomId, msg.event_id, 'e2e cleanup')

      expect(result).toHaveProperty('event_id')
    })

    it('leaves the room', async () => {
      const result = await service.leaveRoom(roomId)

      expect(result).toBeDefined()
    })

    it('forgets the room', async () => {
      const result = await service.forgetRoom(roomId)

      expect(result).toBeDefined()
    })
  })

  // ── Room alias resolution (optional, requires testValues.roomAlias) ──

  describe('resolveRoomAlias', () => {
    it('resolves a room alias if configured', async () => {
      const alias = testValues.roomAlias

      if (!alias) {
        console.log('Skipping resolveRoomAlias: no testValues.roomAlias configured')
        return
      }

      const result = await service.resolveRoomAlias(alias)

      expect(result).toHaveProperty('room_id')
      expect(result).toHaveProperty('servers')
      expect(Array.isArray(result.servers)).toBe(true)
    })
  })

  // ── Media (optional, requires testValues.mediaSourceUrl) ──

  describe('uploadMedia', () => {
    it('uploads media from a public URL if configured', async () => {
      const sourceUrl = testValues.mediaSourceUrl

      if (!sourceUrl) {
        console.log('Skipping uploadMedia: no testValues.mediaSourceUrl configured')
        return
      }

      const result = await service.uploadMedia(sourceUrl, 'e2e-test.png', 'image/png')

      expect(result).toHaveProperty('content_uri')
      expect(result.content_uri).toMatch(/^mxc:\/\//)
    })
  })
})
