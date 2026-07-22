'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Vapi Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('vapi')
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

  // ── Assistants CRUD ──

  describe('assistants CRUD', () => {
    let createdAssistantId

    it('creates an assistant', async () => {
      const result = await service.createAssistant(
        'E2E Test Assistant',
        'Hello from e2e test!',
        'You are a test assistant. Keep responses brief.',
        'openai',
        'gpt-4o-mini'
      )

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('name', 'E2E Test Assistant')
      createdAssistantId = result.id
    })

    it('lists assistants', async () => {
      const result = await service.listAssistants(5)

      expect(Array.isArray(result)).toBe(true)
    })

    it('gets the created assistant', async () => {
      const result = await service.getAssistant(createdAssistantId)

      expect(result).toHaveProperty('id', createdAssistantId)
      expect(result).toHaveProperty('name', 'E2E Test Assistant')
    })

    it('updates the assistant', async () => {
      const result = await service.updateAssistant(createdAssistantId, 'E2E Updated Assistant')

      expect(result).toHaveProperty('name', 'E2E Updated Assistant')
    })

    it('deletes the assistant', async () => {
      const result = await service.deleteAssistant(createdAssistantId)

      expect(result).toHaveProperty('id', createdAssistantId)
    })
  })

  // ── Assistants Dictionary ──

  describe('getAssistantsDictionary', () => {
    it('returns dictionary items', async () => {
      const result = await service.getAssistantsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor')
    })
  })

  // ── Tools CRUD ──

  describe('tools CRUD', () => {
    let createdToolId

    it('creates a function tool', async () => {
      const schema = {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      }
      const result = await service.createTool('Function', 'e2e_test_tool', 'E2E test function tool', schema)

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('type', 'function')
      createdToolId = result.id
    })

    it('lists tools', async () => {
      const result = await service.listTools(5)

      expect(Array.isArray(result)).toBe(true)
    })

    it('gets the created tool', async () => {
      const result = await service.getTool(createdToolId)

      expect(result).toHaveProperty('id', createdToolId)
      expect(result).toHaveProperty('type', 'function')
    })

    it('updates the tool', async () => {
      const result = await service.updateTool(createdToolId, 'Updated description')

      expect(result).toHaveProperty('id', createdToolId)
    })

    it('deletes the tool', async () => {
      const result = await service.deleteTool(createdToolId)

      expect(result).toHaveProperty('id', createdToolId)
    })
  })

  // ── Tools Dictionary ──

  describe('getToolsDictionary', () => {
    it('returns dictionary items', async () => {
      const result = await service.getToolsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Squads CRUD ──

  describe('squads CRUD', () => {
    let helperAssistantId
    let createdSquadId

    beforeAll(async () => {
      const assistant = await service.createAssistant('E2E Squad Helper', 'Hello')
      helperAssistantId = assistant.id
    })

    afterAll(async () => {
      if (helperAssistantId) {
        try {
          await service.deleteAssistant(helperAssistantId)
        } catch (e) {
          // ignore cleanup errors
        }
      }
    })

    it('creates a squad', async () => {
      const result = await service.createSquad(
        [{ assistantId: helperAssistantId }],
        'E2E Test Squad'
      )

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('name', 'E2E Test Squad')
      createdSquadId = result.id
    })

    it('lists squads', async () => {
      const result = await service.listSquads(5)

      expect(Array.isArray(result)).toBe(true)
    })

    it('gets the created squad', async () => {
      const result = await service.getSquad(createdSquadId)

      expect(result).toHaveProperty('id', createdSquadId)
    })

    it('updates the squad', async () => {
      const result = await service.updateSquad(createdSquadId, 'E2E Updated Squad')

      expect(result).toHaveProperty('name', 'E2E Updated Squad')
    })

    it('deletes the squad', async () => {
      const result = await service.deleteSquad(createdSquadId)

      expect(result).toHaveProperty('id', createdSquadId)
    })
  })

  // ── Squads Dictionary ──

  describe('getSquadsDictionary', () => {
    it('returns dictionary items', async () => {
      const result = await service.getSquadsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Phone Numbers ──

  describe('phone numbers', () => {
    it('lists phone numbers', async () => {
      const result = await service.listPhoneNumbers(5)

      expect(Array.isArray(result)).toBe(true)
    })

    it('returns phone numbers dictionary items', async () => {
      const result = await service.getPhoneNumbersDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })

    it('gets a phone number by ID', async () => {
      const { phoneNumberId } = testValues

      if (!phoneNumberId) {
        console.log('Skipping getPhoneNumber: testValues.phoneNumberId not set')
        return
      }

      const result = await service.getPhoneNumber(phoneNumberId)

      expect(result).toHaveProperty('id', phoneNumberId)
    })
  })

  // ── Chat ──

  describe('chat lifecycle', () => {
    let chatAssistantId
    let createdChatId

    beforeAll(async () => {
      const assistant = await service.createAssistant(
        'E2E Chat Assistant',
        undefined,
        'You are a test assistant. Reply with exactly "pong" to any message.',
        'openai',
        'gpt-4o-mini'
      )
      chatAssistantId = assistant.id
    })

    afterAll(async () => {
      if (chatAssistantId) {
        try {
          await service.deleteAssistant(chatAssistantId)
        } catch (e) {
          // ignore
        }
      }
    })

    it('creates a chat', async () => {
      const result = await service.createChat('ping', chatAssistantId)

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('output')
      expect(Array.isArray(result.output)).toBe(true)
      createdChatId = result.id
    })

    it('lists chats', async () => {
      const result = await service.listChats()

      expect(result).toHaveProperty('results')
      expect(Array.isArray(result.results)).toBe(true)
    })

    it('gets the created chat', async () => {
      const result = await service.getChat(createdChatId)

      expect(result).toHaveProperty('id', createdChatId)
    })

    it('deletes the chat', async () => {
      const result = await service.deleteChat(createdChatId)

      expect(result).toHaveProperty('id', createdChatId)
    })
  })

  // ── Sessions ──

  describe('sessions CRUD', () => {
    let sessionAssistantId
    let createdSessionId

    beforeAll(async () => {
      const assistant = await service.createAssistant('E2E Session Helper', 'Hello')
      sessionAssistantId = assistant.id
    })

    afterAll(async () => {
      if (sessionAssistantId) {
        try {
          await service.deleteAssistant(sessionAssistantId)
        } catch (e) {
          // ignore
        }
      }
    })

    it('creates a session', async () => {
      const result = await service.createSession('E2E Test Session', sessionAssistantId, undefined, 3600)

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('status', 'active')
      createdSessionId = result.id
    })

    it('lists sessions', async () => {
      const result = await service.listSessions()

      expect(result).toHaveProperty('results')
      expect(Array.isArray(result.results)).toBe(true)
    })

    it('gets the created session', async () => {
      const result = await service.getSession(createdSessionId)

      expect(result).toHaveProperty('id', createdSessionId)
    })

    it('updates the session', async () => {
      const result = await service.updateSession(createdSessionId, 'Updated Session', 'Completed')

      expect(result).toHaveProperty('id', createdSessionId)
    })

    it('deletes the session', async () => {
      const result = await service.deleteSession(createdSessionId)

      expect(result).toHaveProperty('id', createdSessionId)
    })
  })

  // ── Files ──

  describe('files', () => {
    it('lists files', async () => {
      const result = await service.listFiles()

      expect(Array.isArray(result)).toBe(true)
    })
  })

  // ── Calls ──

  describe('calls', () => {
    it('lists calls', async () => {
      const result = await service.listCalls(undefined, undefined, 5)

      expect(Array.isArray(result)).toBe(true)
    })

    it('gets a call by ID', async () => {
      const { callId } = testValues

      if (!callId) {
        console.log('Skipping getCall: testValues.callId not set')
        return
      }

      const result = await service.getCall(callId)

      expect(result).toHaveProperty('id', callId)
    })
  })

  // ── Campaigns ──

  describe('campaigns', () => {
    it('lists campaigns', async () => {
      const result = await service.listCampaigns()

      expect(result).toHaveProperty('results')
      expect(Array.isArray(result.results)).toBe(true)
    })

    it('returns campaigns dictionary items', async () => {
      const result = await service.getCampaignsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Analytics ──

  describe('analytics', () => {
    it('runs a basic count query', async () => {
      const result = await service.runAnalyticsQuery(
        'e2e_count',
        [{ operation: 'count', column: 'id' }],
        'Call'
      )

      expect(Array.isArray(result)).toBe(true)
    })
  })
})
