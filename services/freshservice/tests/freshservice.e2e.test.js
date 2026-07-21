'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Freshservice Service (e2e)', () => {
  let sandbox
  let service

  beforeAll(() => {
    sandbox = createE2ESandbox('freshservice')
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

  // ── Agents & Groups (read-only, safe to run first) ──

  describe('getCurrentAgent', () => {
    it('returns the authenticated agent', async () => {
      const result = await service.getCurrentAgent()

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('first_name')
      expect(result).toHaveProperty('email')
    })
  })

  describe('listAgents', () => {
    it('returns an array of agents', async () => {
      const result = await service.listAgents(undefined, 1, 5)

      expect(Array.isArray(result)).toBe(true)
    })
  })

  describe('getAgent', () => {
    it('retrieves an agent by ID', async () => {
      const agents = await service.listAgents(undefined, 1, 1)

      if (!agents.length) {
        return
      }

      const agent = await service.getAgent(agents[0].id)

      expect(agent).toHaveProperty('id', agents[0].id)
      expect(agent).toHaveProperty('email')
    })
  })

  describe('listGroups', () => {
    it('returns an array of groups', async () => {
      const result = await service.listGroups(1, 5)

      expect(Array.isArray(result)).toBe(true)
    })
  })

  // ── Dictionaries ──

  describe('getAgentsDictionary', () => {
    it('returns dictionary items with label/value', async () => {
      const result = await service.getAgentsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)

      if (result.items.length) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
      }
    })
  })

  describe('getGroupsDictionary', () => {
    it('returns dictionary items with label/value', async () => {
      const result = await service.getGroupsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Tickets lifecycle ──

  describe('tickets lifecycle', () => {
    let ticketId

    it('creates a ticket', async () => {
      const result = await service.createTicket(
        'E2E Test Ticket',
        '<p>This is an automated e2e test ticket. Safe to delete.</p>',
        'e2e-test@flowrunner-test.example.com',
        undefined,
        'Low',
        'Open',
        'Portal'
      )

      expect(result).toHaveProperty('id')
      ticketId = result.id
    })

    it('retrieves the created ticket', async () => {
      const result = await service.getTicket(ticketId)

      expect(result).toHaveProperty('id', ticketId)
      expect(result).toHaveProperty('subject', 'E2E Test Ticket')
    })

    it('retrieves the ticket with conversations', async () => {
      const result = await service.getTicket(ticketId, true)

      expect(result).toHaveProperty('id', ticketId)
    })

    it('lists tickets and finds the created one', async () => {
      const result = await service.listTickets(undefined, undefined, undefined, undefined, 1, 100)

      expect(Array.isArray(result)).toBe(true)

      const found = result.find(t => t.id === ticketId)

      expect(found).toBeDefined()
    })

    it('updates the ticket', async () => {
      const result = await service.updateTicket(ticketId, 'E2E Updated Ticket', undefined, 'Medium')

      expect(result).toHaveProperty('id', ticketId)
    })

    it('adds a private note', async () => {
      const result = await service.addNote(ticketId, 'E2E test note', true)

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('body_text')
    })

    it('adds a reply', async () => {
      const result = await service.replyToTicket(ticketId, '<p>E2E test reply</p>')

      expect(result).toHaveProperty('id')
    })

    it('lists conversations on the ticket', async () => {
      const result = await service.listConversations(ticketId)

      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThanOrEqual(1)
    })

    it('deletes the ticket', async () => {
      const result = await service.deleteTicket(ticketId)

      expect(result).toEqual({ deleted: true, ticketId })
    })
  })

  // ── Requesters lifecycle ──

  describe('requesters lifecycle', () => {
    let requesterId
    const uniqueEmail = `e2e-test-${ Date.now() }@flowrunner-test.example.com`

    it('creates a requester', async () => {
      const result = await service.createRequester('E2E', 'TestUser', uniqueEmail, 'Tester')

      expect(result).toHaveProperty('id')
      requesterId = result.id
    })

    it('retrieves the created requester', async () => {
      const result = await service.getRequester(requesterId)

      expect(result).toHaveProperty('id', requesterId)
      expect(result).toHaveProperty('first_name', 'E2E')
    })

    it('lists requesters', async () => {
      const result = await service.listRequesters(undefined, 1, 5)

      expect(Array.isArray(result)).toBe(true)
    })

    it('updates the requester', async () => {
      const result = await service.updateRequester(requesterId, undefined, undefined, undefined, 'Senior Tester')

      expect(result).toHaveProperty('id', requesterId)
    })
  })

  // ── Changes lifecycle ──

  describe('changes lifecycle', () => {
    let changeId

    it('creates a change', async () => {
      const result = await service.createChange(
        'E2E Test Change',
        '<p>Automated e2e test change. Safe to delete.</p>'
      )

      expect(result).toHaveProperty('id')
      changeId = result.id
    })

    it('retrieves the created change', async () => {
      const result = await service.getChange(changeId)

      expect(result).toHaveProperty('id', changeId)
    })

    it('lists changes', async () => {
      const result = await service.listChanges(undefined, 1, 5)

      expect(Array.isArray(result)).toBe(true)
    })

    it('updates the change', async () => {
      const result = await service.updateChange(changeId, 'E2E Updated Change')

      expect(result).toHaveProperty('id', changeId)
    })

    it('deletes the change', async () => {
      const result = await service.deleteChange(changeId)

      expect(result).toEqual({ deleted: true, changeId })
    })
  })

  // ── Problems lifecycle ──

  describe('problems lifecycle', () => {
    let problemId

    it('creates a problem', async () => {
      const result = await service.createProblem(
        'E2E Test Problem',
        '<p>Automated e2e test problem. Safe to delete.</p>'
      )

      expect(result).toHaveProperty('id')
      problemId = result.id
    })

    it('retrieves the created problem', async () => {
      const result = await service.getProblem(problemId)

      expect(result).toHaveProperty('id', problemId)
    })

    it('lists problems', async () => {
      const result = await service.listProblems(undefined, 1, 5)

      expect(Array.isArray(result)).toBe(true)
    })

    it('updates the problem', async () => {
      const result = await service.updateProblem(problemId, 'E2E Updated Problem')

      expect(result).toHaveProperty('id', problemId)
    })

    it('deletes the problem', async () => {
      const result = await service.deleteProblem(problemId)

      expect(result).toEqual({ deleted: true, problemId })
    })
  })

  // ── Releases lifecycle ──

  describe('releases lifecycle', () => {
    let releaseId

    it('creates a release', async () => {
      const result = await service.createRelease(
        'E2E Test Release',
        '<p>Automated e2e test release. Safe to delete.</p>'
      )

      expect(result).toHaveProperty('id')
      releaseId = result.id
    })

    it('retrieves the created release', async () => {
      const result = await service.getRelease(releaseId)

      expect(result).toHaveProperty('id', releaseId)
    })

    it('lists releases', async () => {
      const result = await service.listReleases(undefined, 1, 5)

      expect(Array.isArray(result)).toBe(true)
    })
  })

  // ── Assets lifecycle ──

  describe('assets lifecycle', () => {
    let assetDisplayId

    it('creates an asset', async () => {
      // Asset type ID is account-specific; use a testValue if provided
      const assetTypeId = sandbox.getTestValues().assetTypeId

      if (!assetTypeId) {
        console.log('Skipping asset create: no assetTypeId in testValues')
        return
      }

      const result = await service.createAsset(
        `E2E-Asset-${ Date.now() }`,
        Number(assetTypeId),
        'Automated e2e test asset'
      )

      expect(result).toHaveProperty('display_id')
      assetDisplayId = result.display_id
    })

    it('retrieves the created asset', async () => {
      if (!assetDisplayId) {
        return
      }

      const result = await service.getAsset(assetDisplayId)

      expect(result).toHaveProperty('display_id', assetDisplayId)
    })

    it('lists assets', async () => {
      const result = await service.listAssets(undefined, 1, 5)

      expect(Array.isArray(result)).toBe(true)
    })

    it('updates the asset', async () => {
      if (!assetDisplayId) {
        return
      }

      const result = await service.updateAsset(assetDisplayId, undefined, 'Updated by e2e')

      expect(result).toHaveProperty('display_id', assetDisplayId)
    })

    it('deletes the asset', async () => {
      if (!assetDisplayId) {
        return
      }

      const result = await service.deleteAsset(assetDisplayId)

      expect(result).toEqual({ deleted: true, displayId: assetDisplayId })
    })
  })

  // ── Polling trigger ──

  describe('handleTriggerPollingForEvent', () => {
    it('establishes baseline on first run', async () => {
      const result = await service.handleTriggerPollingForEvent(null)

      expect(result).toHaveProperty('state')
      expect(result.state).toHaveProperty('lastSeenCreatedAt')
      expect(result).toHaveProperty('events')
      expect(result.events).toEqual([])
    })
  })
})
