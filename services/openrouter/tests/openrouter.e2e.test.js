'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('OpenRouter Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('openrouter')
    require('../src/index.js')

    try {
      sandbox.validateConfigs()
    } catch (error) {
      console.log(error)
      process.exit(1)
    }

    service = sandbox.getService()
    testValues = sandbox.getTestValues()

    // Mock flowrunner.Files for methods that upload files
    service.flowrunner = {
      Files: {
        uploadFile: jest.fn().mockResolvedValue({ url: 'https://files.example.com/mock-upload.png' }),
      },
    }
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Account ──

  describe('getCredits', () => {
    it('returns credits with expected shape', async () => {
      const result = await service.getCredits()

      expect(result).toHaveProperty('total_credits')
      expect(result).toHaveProperty('total_usage')
      expect(typeof result.total_credits).toBe('number')
    })
  })

  describe('getKeyInfo', () => {
    it('returns key info with expected shape', async () => {
      const result = await service.getKeyInfo()

      expect(result).toHaveProperty('label')
      expect(result).toHaveProperty('usage')
      expect(result).toHaveProperty('is_free_tier')
    })
  })

  describe('getActivity', () => {
    it('returns activity data', async () => {
      const result = await service.getActivity()

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
    })

    it('filters by date', async () => {
      const today = new Date().toISOString().slice(0, 10)
      const result = await service.getActivity(today)

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
    })
  })

  // ── Models ──

  describe('listModels', () => {
    it('returns models with expected shape', async () => {
      const result = await service.listModels(undefined, undefined, undefined, undefined, undefined, undefined, undefined, 5)

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)

      if (result.data.length > 0) {
        expect(result.data[0]).toHaveProperty('id')
        expect(result.data[0]).toHaveProperty('name')
      }
    })

    it('filters by search', async () => {
      const result = await service.listModels('claude', undefined, undefined, undefined, undefined, undefined, undefined, 5)

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
    })

    it('filters by category', async () => {
      const result = await service.listModels(undefined, 'Programming', undefined, undefined, undefined, undefined, undefined, 5)

      expect(result).toHaveProperty('data')
    })
  })

  describe('getModelEndpoints', () => {
    it('returns endpoints for a model', async () => {
      const result = await service.getModelEndpoints('openai/gpt-4.1-mini')

      expect(result).toHaveProperty('data')
      expect(result.data).toHaveProperty('id')
      expect(result.data).toHaveProperty('endpoints')
      expect(Array.isArray(result.data.endpoints)).toBe(true)
    })
  })

  describe('listProviders', () => {
    it('returns provider list', async () => {
      const result = await service.listProviders()

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)

      if (result.data.length > 0) {
        expect(result.data[0]).toHaveProperty('name')
        expect(result.data[0]).toHaveProperty('slug')
      }
    })
  })

  // ── Dictionary Methods ──

  describe('getModelsDictionary', () => {
    it('returns items in dictionary format', async () => {
      const result = await service.getModelsDictionary({})

      expect(result).toHaveProperty('items')
      expect(result).toHaveProperty('cursor')
      expect(Array.isArray(result.items)).toBe(true)

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
        expect(result.items[0]).toHaveProperty('note')
      }
    })

    it('supports search', async () => {
      const result = await service.getModelsDictionary({ search: 'claude' })

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getChatModelsDictionary', () => {
    it('returns chat models', async () => {
      const result = await service.getChatModelsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result.items.length).toBeGreaterThan(0)
    })
  })

  describe('getImageModelsDictionary', () => {
    it('returns image models', async () => {
      const result = await service.getImageModelsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getVideoModelsDictionary', () => {
    it('returns video models', async () => {
      const result = await service.getVideoModelsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getEmbeddingsModelsDictionary', () => {
    it('returns embeddings models', async () => {
      const result = await service.getEmbeddingsModelsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getRerankModelsDictionary', () => {
    it('returns rerank models', async () => {
      const result = await service.getRerankModelsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Chat ──

  describe('chatCompletion', () => {
    it('generates a response', async () => {
      const result = await service.chatCompletion('Say "hello" in exactly one word.')

      expect(result).toHaveProperty('text')
      expect(typeof result.text).toBe('string')
      expect(result.text.length).toBeGreaterThan(0)
      expect(result).toHaveProperty('model')
      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('usage')
    }, 30000)

    it('uses a specific model and system prompt', async () => {
      const result = await service.chatCompletion(
        'What is 2+2?',
        'openai/gpt-4.1-mini',
        'You are a calculator. Reply with only the number.'
      )

      expect(result).toHaveProperty('text')
      expect(result.model).toContain('gpt-4.1-mini')
    }, 30000)
  })

  describe('chatCompletionAdvanced', () => {
    it('generates a response with messages array', async () => {
      const result = await service.chatCompletionAdvanced([
        { role: 'system', content: 'Reply in exactly one word.' },
        { role: 'user', content: 'Say hello.' },
      ])

      expect(result).toHaveProperty('choices')
      expect(Array.isArray(result.choices)).toBe(true)
      expect(result.choices.length).toBeGreaterThan(0)
      expect(result.choices[0]).toHaveProperty('message')
    }, 30000)
  })

  // ── Embeddings ──

  describe('createEmbeddings', () => {
    it('generates embeddings for texts', async () => {
      const result = await service.createEmbeddings(['Hello world', 'How are you?'])

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
      expect(result.data).toHaveLength(2)
      expect(result.data[0]).toHaveProperty('embedding')
      expect(Array.isArray(result.data[0].embedding)).toBe(true)
    }, 30000)
  })

  // ── Generation Lookup ──

  describe('getGeneration', () => {
    it('looks up a generation by ID from a chat completion', async () => {
      const chatResult = await service.chatCompletion('Say "test".')

      if (!chatResult.id) {
        console.log('Skipping getGeneration: no generation ID returned')
        return
      }

      // Small delay to allow generation metadata to become available
      await new Promise(resolve => setTimeout(resolve, 2000))

      const result = await service.getGeneration(chatResult.id)

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('model')
      expect(result).toHaveProperty('total_cost')
    }, 45000)
  })
})
