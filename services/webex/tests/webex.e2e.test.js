'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

const SUFFIX = Date.now()

describe('Cisco Webex Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('webex')
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

  // ── People ──

  describe('getMyOwnDetails', () => {
    it('returns the profile behind the access token', async () => {
      const result = await service.getMyOwnDetails()

      expect(result).toHaveProperty('id')
      expect(Array.isArray(result.emails)).toBe(true)
      expect(result).toHaveProperty('displayName')
    })
  })

  describe('listPeople / getPerson', () => {
    it('finds a person by email and reads their profile', async () => {
      const { personEmail } = testValues

      if (!personEmail) {
        console.log('Skipping listPeople/getPerson: testValues.personEmail not set')

        return
      }

      const list = await service.listPeople(personEmail, undefined, 5)

      expect(Array.isArray(list.items)).toBe(true)

      if (!list.items.length) {
        console.log(`Skipping getPerson: no person found for ${ personEmail }`)

        return
      }

      const person = await service.getPerson(list.items[0].id)

      expect(person).toHaveProperty('id', list.items[0].id)
    })
  })

  // ── Rooms ──

  describe('listRooms', () => {
    it('lists the spaces the token is a member of', async () => {
      const result = await service.listRooms(undefined, undefined, 10)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })

    it('lists only group spaces', async () => {
      const result = await service.listRooms('Group', undefined, 5)

      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getRoomsDictionary', () => {
    it('returns dictionary items with a label and value', async () => {
      const result = await service.getRoomsDictionary({})

      expect(Array.isArray(result.items)).toBe(true)
      expect(result.cursor).toBeNull()

      for (const item of result.items) {
        expect(item).toHaveProperty('label')
        expect(item).toHaveProperty('value')
      }
    })
  })

  // ── Room lifecycle (create → message → membership → delete) ──

  describe('room lifecycle', () => {
    let roomId
    let messageId
    let membershipId

    afterAll(async () => {
      if (roomId) {
        try {
          await service.deleteRoom(roomId)
        } catch (error) {
          console.log(`Cleanup: could not delete room ${ roomId }: ${ error.message }`)
        }
      }
    })

    it('creates a space', async () => {
      const result = await service.createRoom(`FlowRunner e2e ${ SUFFIX }`)

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('title', `FlowRunner e2e ${ SUFFIX }`)

      roomId = result.id
    })

    it('reads the space back', async () => {
      const result = await service.getRoom(roomId)

      expect(result).toHaveProperty('id', roomId)
    })

    it('renames the space', async () => {
      const result = await service.updateRoom(roomId, `FlowRunner e2e ${ SUFFIX } (renamed)`)

      expect(result).toHaveProperty('title', `FlowRunner e2e ${ SUFFIX } (renamed)`)
    })

    it('returns the meeting details of the space', async () => {
      const result = await service.getRoomMeetingDetails(roomId)

      expect(result).toHaveProperty('roomId', roomId)
    })

    it('posts a message to the space', async () => {
      const result = await service.createMessage(
        roomId,
        undefined,
        undefined,
        '**FlowRunner** e2e message',
        'FlowRunner e2e message'
      )

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('roomId', roomId)

      messageId = result.id
    })

    it('lists the messages of the space', async () => {
      const result = await service.listMessages(roomId, undefined, undefined, 10)

      expect(Array.isArray(result.items)).toBe(true)
      expect(result.items.some(item => item.id === messageId)).toBe(true)
    })

    it('reads a single message', async () => {
      const result = await service.getMessage(messageId)

      expect(result).toHaveProperty('id', messageId)
    })

    it('deletes the message', async () => {
      await expect(service.deleteMessage(messageId)).resolves.toEqual({ success: true })
    })

    it('lists the memberships of the space', async () => {
      const result = await service.listMemberships(roomId, 10)

      expect(Array.isArray(result.items)).toBe(true)
      expect(result.items.length).toBeGreaterThan(0)
    })

    it('adds and removes a member', async () => {
      const { personEmail } = testValues

      if (!personEmail) {
        console.log('Skipping createMembership/deleteMembership: testValues.personEmail not set')

        return
      }

      const created = await service.createMembership(roomId, personEmail)

      expect(created).toHaveProperty('id')

      membershipId = created.id

      await expect(service.deleteMembership(membershipId)).resolves.toEqual({ success: true })
    })

    it('deletes the space', async () => {
      await expect(service.deleteRoom(roomId)).resolves.toEqual({ success: true })

      roomId = undefined
    })
  })

  // ── Direct messages ──

  describe('createDirectMessage', () => {
    it('sends a 1:1 message to a person', async () => {
      const { personEmail } = testValues

      if (!personEmail) {
        console.log('Skipping createDirectMessage: testValues.personEmail not set')

        return
      }

      const result = await service.createDirectMessage(personEmail, 'FlowRunner e2e direct message')

      expect(result).toHaveProperty('id')

      await service.deleteMessage(result.id)
    })
  })

  // ── Teams ──

  describe('listTeams', () => {
    it('lists the teams the token belongs to', async () => {
      const result = await service.listTeams(10)

      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('team lifecycle', () => {
    let teamId

    it('creates a team and reads it back', async () => {
      const created = await service.createTeam(`FlowRunner e2e team ${ SUFFIX }`)

      expect(created).toHaveProperty('id')

      teamId = created.id

      const team = await service.getTeam(teamId)

      expect(team).toHaveProperty('id', teamId)
    })

    it('lists the team memberships', async () => {
      if (!teamId) {
        console.log('Skipping listTeamMemberships: no team was created')

        return
      }

      const result = await service.listTeamMemberships(teamId, 10)

      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Meetings ──

  describe('listMeetings', () => {
    it('lists scheduled meetings', async () => {
      const result = await service.listMeetings(undefined, undefined, undefined, 5)

      expect(result).toHaveProperty('items')
    })
  })

  describe('meeting lifecycle', () => {
    it('creates, updates and deletes a meeting', async () => {
      const { runMeetingTests } = testValues

      if (!runMeetingTests) {
        console.log('Skipping meeting lifecycle: testValues.runMeetingTests is not enabled')

        return
      }

      const start = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      const end = new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString()

      const created = await service.createMeeting(
        `FlowRunner e2e meeting ${ SUFFIX }`,
        start,
        end,
        'UTC',
        'FlowRunner e2e agenda'
      )

      expect(created).toHaveProperty('id')

      const fetched = await service.getMeeting(created.id)

      expect(fetched).toHaveProperty('id', created.id)

      const updated = await service.updateMeeting(
        created.id,
        `FlowRunner e2e meeting ${ SUFFIX } (updated)`,
        start,
        end,
        'UTC'
      )

      expect(updated).toHaveProperty('id', created.id)

      await expect(service.deleteMeeting(created.id)).resolves.toEqual({ success: true })
    })
  })

  // ── Webhooks ──

  describe('webhook lifecycle', () => {
    it('lists webhooks', async () => {
      const result = await service.listWebhooks(10)

      expect(result).toHaveProperty('items')
    })

    it('creates and deletes a webhook', async () => {
      const { webhookTargetUrl } = testValues

      if (!webhookTargetUrl) {
        console.log('Skipping createWebhook/deleteWebhook: testValues.webhookTargetUrl not set')

        return
      }

      const created = await service.createWebhook(
        `FlowRunner e2e ${ SUFFIX }`,
        webhookTargetUrl,
        'Messages',
        'Created'
      )

      expect(created).toHaveProperty('id')

      await expect(service.deleteWebhook(created.id)).resolves.toEqual({ success: true })
    })
  })
})
