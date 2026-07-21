'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Mistral AI Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('mistral-ai')
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

  const chatModel = () => testValues.chatModel || undefined
  const fimModel = () => testValues.fimModel || undefined

  // ── Models (read-only, no token spend) ──

  describe('listModels', () => {
    it('returns the models list with expected shape', async () => {
      const response = await service.listModels()

      expect(response).toHaveProperty('data')
      expect(Array.isArray(response.data)).toBe(true)
      expect(response.data.length).toBeGreaterThan(0)
      expect(response.data[0]).toHaveProperty('id')
    })
  })

  describe('getModel', () => {
    it('returns model details for a known model', async () => {
      const response = await service.getModel('mistral-medium-latest')

      expect(response).toHaveProperty('id', 'mistral-medium-latest')
      expect(response).toHaveProperty('object', 'model')
    })
  })

  describe('getModelsDictionary', () => {
    it('returns dictionary items array with a null cursor', async () => {
      const result = await service.getModelsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result.items.length).toBeGreaterThan(0)
      expect(result.items[0]).toHaveProperty('label')
      expect(result.items[0]).toHaveProperty('value')
      expect(result.cursor).toBeNull()
    })

    it('filters models by search term', async () => {
      const filtered = await service.getModelsDictionary({ search: 'mistral' })

      expect(filtered.items.length).toBeGreaterThan(0)
      filtered.items.forEach(item => {
        expect(item.value.toLowerCase()).toContain('mistral')
      })
    })
  })

  // ── Chat (spends a few tokens) ──

  describe('askAI', () => {
    it('returns a shaped chat response', async () => {
      const response = await service.askAI(
        'Reply with the single word: pong',
        chatModel(),
        undefined,
        undefined,
        undefined,
        16
      )

      expect(response).toHaveProperty('text')
      expect(typeof response.text).toBe('string')
      expect(response.text.length).toBeGreaterThan(0)
      expect(response).toHaveProperty('model')
      expect(response).toHaveProperty('finishReason')
      expect(response).toHaveProperty('usage')
      expect(response.usage).toHaveProperty('total_tokens')
    })

    it('returns valid JSON when JSON mode is enabled', async () => {
      const response = await service.askAI(
        'Return a JSON object like {"ok": true} and nothing else.',
        chatModel(),
        'You output only valid JSON.',
        undefined,
        undefined,
        64,
        'JSON Object'
      )

      expect(() => JSON.parse(response.text)).not.toThrow()
    })
  })

  describe('createChatCompletion', () => {
    it('returns the raw API response', async () => {
      const response = await service.createChatCompletion(
        [
          { role: 'System', content: 'You are terse.' },
          { role: 'User', content: 'Say hi in one word.' },
        ],
        chatModel(),
        undefined,
        undefined,
        16
      )

      expect(response).toHaveProperty('choices')
      expect(Array.isArray(response.choices)).toBe(true)
      expect(response.choices[0]).toHaveProperty('message')
      expect(response.choices[0].message).toHaveProperty('content')
      expect(response).toHaveProperty('usage')
    })
  })

  // ── Embeddings ──

  describe('createEmbeddings', () => {
    it('returns embedding vectors', async () => {
      const response = await service.createEmbeddings(['Hello world', 'Test input'])

      expect(response).toHaveProperty('data')
      expect(Array.isArray(response.data)).toBe(true)
      expect(response.data).toHaveLength(2)
      expect(response.data[0]).toHaveProperty('embedding')
      expect(Array.isArray(response.data[0].embedding)).toBe(true)
      expect(response).toHaveProperty('usage')
    })
  })

  // ── Moderation ──

  describe('moderateText', () => {
    it('returns moderation results with category flags', async () => {
      const response = await service.moderateText(['This is a safe sentence.'])

      expect(response).toHaveProperty('results')
      expect(Array.isArray(response.results)).toBe(true)
      expect(response.results[0]).toHaveProperty('categories')
    })
  })

  describe('moderateConversation', () => {
    it('returns moderation results for conversation', async () => {
      const response = await service.moderateConversation([
        { role: 'User', content: 'What is the weather today?' },
        { role: 'Assistant', content: 'I do not have access to real-time weather data.' },
      ])

      expect(response).toHaveProperty('results')
      expect(Array.isArray(response.results)).toBe(true)
    })
  })

  // ── FIM Completion ──

  describe('fimCompletion', () => {
    it('returns a fill-in-the-middle completion', async () => {
      const response = await service.fimCompletion(
        'def add(a, b):\n    return ',
        '\n',
        fimModel(),
        16
      )

      expect(response).toHaveProperty('text')
      expect(typeof response.text).toBe('string')
      expect(response).toHaveProperty('model')
      expect(response).toHaveProperty('usage')
    })
  })

  // ── Files (CRUD lifecycle) ──

  describe('listFiles', () => {
    it('returns a file list with expected shape', async () => {
      const response = await service.listFiles()

      expect(response).toHaveProperty('data')
      expect(Array.isArray(response.data)).toBe(true)
    })
  })

  // ── Agents (CRUD lifecycle) ──

  describe('agents CRUD', () => {
    let agentId

    it('creates an agent', async () => {
      const result = await service.createAgent(
        'E2E Test Agent',
        'mistral-medium-latest',
        'You are a helpful test agent.'
      )

      expect(result).toHaveProperty('id')
      agentId = result.id
    })

    it('retrieves the created agent', async () => {
      const result = await service.getAgent(agentId)

      expect(result).toHaveProperty('id', agentId)
      expect(result).toHaveProperty('name', 'E2E Test Agent')
    })

    it('lists agents and finds the created one', async () => {
      const result = await service.listAgents()
      const agents = Array.isArray(result) ? result : result.data || []
      const found = agents.find(a => a.id === agentId)

      expect(found).toBeDefined()
    })

    it('updates the agent', async () => {
      const result = await service.updateAgent(agentId, 'E2E Test Agent Updated')

      expect(result).toHaveProperty('name', 'E2E Test Agent Updated')
    })

    it('deletes the agent', async () => {
      const result = await service.deleteAgent(agentId)

      expect(result).toHaveProperty('deleted', true)
    })
  })

  // ── Batch Jobs (read-only) ──

  describe('listBatchJobs', () => {
    it('returns a list with expected shape', async () => {
      const response = await service.listBatchJobs()

      expect(response).toHaveProperty('data')
      expect(Array.isArray(response.data)).toBe(true)
    })
  })
})
