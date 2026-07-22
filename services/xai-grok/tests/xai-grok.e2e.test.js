'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('xAI Grok Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('xai-grok')
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

  // ── Account ──

  describe('getApiKeyInfo', () => {
    it('returns API key information', async () => {
      const result = await service.getApiKeyInfo()

      expect(result).toHaveProperty('redacted_api_key')
      expect(result).toHaveProperty('api_key_blocked')
    })
  })

  // ── Models ──

  describe('listModels', () => {
    it('returns a list of models', async () => {
      const result = await service.listModels()

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
      expect(result.data.length).toBeGreaterThan(0)
      expect(result.data[0]).toHaveProperty('id')
    })
  })

  describe('getModel', () => {
    it('returns model details', async () => {
      const modelId = testValues.modelId || 'grok-3-mini'

      const result = await service.getModel(modelId)

      expect(result).toHaveProperty('id', modelId)
      expect(result).toHaveProperty('object', 'model')
    })
  })

  describe('listLanguageModels', () => {
    it('returns language models with metadata', async () => {
      const result = await service.listLanguageModels()

      expect(result).toHaveProperty('models')
      expect(Array.isArray(result.models)).toBe(true)
      expect(result.models.length).toBeGreaterThan(0)
      expect(result.models[0]).toHaveProperty('id')
    })
  })

  describe('listImageGenerationModels', () => {
    it('returns image generation models', async () => {
      const result = await service.listImageGenerationModels()

      expect(result).toHaveProperty('models')
      expect(Array.isArray(result.models)).toBe(true)
      expect(result.models.length).toBeGreaterThan(0)
    })
  })

  describe('listVideoGenerationModels', () => {
    it('returns video generation models', async () => {
      const result = await service.listVideoGenerationModels()

      expect(result).toHaveProperty('models')
      expect(Array.isArray(result.models)).toBe(true)
    })
  })

  // ── Dictionary Methods ──

  describe('getModelsDictionary', () => {
    it('returns dictionary items', async () => {
      const result = await service.getModelsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result.items.length).toBeGreaterThan(0)
      expect(result.items[0]).toHaveProperty('label')
      expect(result.items[0]).toHaveProperty('value')
      expect(result.cursor).toBeNull()
    })

    it('filters by search term', async () => {
      const all = await service.getModelsDictionary({})
      const filtered = await service.getModelsDictionary({ search: 'grok' })

      expect(filtered.items.length).toBeGreaterThan(0)
      expect(filtered.items.length).toBeLessThanOrEqual(all.items.length)
    })
  })

  describe('getChatModelsDictionary', () => {
    it('returns chat model dictionary items', async () => {
      const result = await service.getChatModelsDictionary({})

      expect(result).toHaveProperty('items')
      expect(result.items.length).toBeGreaterThan(0)
      expect(result.items[0]).toHaveProperty('label')
      expect(result.items[0]).toHaveProperty('value')
    })
  })

  describe('getImageModelsDictionary', () => {
    it('returns image model dictionary items', async () => {
      const result = await service.getImageModelsDictionary({})

      expect(result).toHaveProperty('items')
      expect(result.items.length).toBeGreaterThan(0)
    })
  })

  describe('getVideoModelsDictionary', () => {
    it('returns video model dictionary items', async () => {
      const result = await service.getVideoModelsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Chat ──

  describe('chatCompletion', () => {
    it('generates a text response', async () => {
      const result = await service.chatCompletion('What is 2+2? Reply with just the number.')

      expect(result).toHaveProperty('text')
      expect(result.text.length).toBeGreaterThan(0)
      expect(result).toHaveProperty('model')
      expect(result).toHaveProperty('finishReason')
      expect(result).toHaveProperty('usage')
    }, 60000)

    it('uses system prompt and custom model', async () => {
      const chatModel = testValues.chatModel || 'grok-3-mini'

      const result = await service.chatCompletion(
        'What is the capital of France? Reply with just the city name.',
        chatModel,
        'You are a geography expert. Be extremely concise.'
      )

      expect(result).toHaveProperty('text')
      expect(result.text.length).toBeGreaterThan(0)
    }, 60000)
  })

  describe('chatCompletionAdvanced', () => {
    it('sends a multi-message conversation', async () => {
      const chatModel = testValues.chatModel || 'grok-3-mini'

      const result = await service.chatCompletionAdvanced([
        { role: 'system', content: 'You are a helpful assistant. Be concise.' },
        { role: 'user', content: 'Say hello in one word.' },
      ], chatModel)

      expect(result).toHaveProperty('choices')
      expect(Array.isArray(result.choices)).toBe(true)
      expect(result.choices.length).toBeGreaterThan(0)
      expect(result.choices[0].message).toHaveProperty('content')
    }, 60000)
  })

  // ── Tokenize ──

  describe('tokenizeText', () => {
    it('tokenizes text and returns token count', async () => {
      const result = await service.tokenizeText('Hello, world!')

      expect(result).toHaveProperty('tokenCount')
      expect(result.tokenCount).toBeGreaterThan(0)
      expect(result).toHaveProperty('tokens')
      expect(Array.isArray(result.tokens)).toBe(true)
    })
  })

  // ── Live Search ──

  describe('askWithLiveSearch', () => {
    it('returns answer with citations', async () => {
      const chatModel = testValues.chatModel || 'grok-3-mini'

      const result = await service.askWithLiveSearch(
        'What is the current population of Tokyo?',
        chatModel
      )

      expect(result).toHaveProperty('text')
      expect(result.text.length).toBeGreaterThan(0)
      expect(result).toHaveProperty('citations')
      expect(Array.isArray(result.citations)).toBe(true)
      expect(result).toHaveProperty('model')
      expect(result).toHaveProperty('usage')
    }, 120000)
  })

  // ── Vision ──

  describe('analyzeImage', () => {
    it('analyzes an image from URL', async () => {
      const imageUrl = testValues.testImageUrl || 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/PNG_transparency_demonstration_1.png/280px-PNG_transparency_demonstration_1.png'
      const chatModel = testValues.chatModel || 'grok-3-mini'

      const result = await service.analyzeImage(
        'Describe what you see in this image in one sentence.',
        [imageUrl],
        chatModel
      )

      expect(result).toHaveProperty('text')
      expect(result.text.length).toBeGreaterThan(0)
      expect(result).toHaveProperty('model')
      expect(result).toHaveProperty('finishReason')
    }, 60000)
  })

  // ── Image Generation (skipped by default due to cost) ──

  describe('generateImage', () => {
    it('generates an image from prompt', async () => {
      if (!testValues.allowImageGeneration) {
        console.log('Skipping generateImage: testValues.allowImageGeneration not set')
        return
      }

      const result = await service.generateImage('A simple red circle on white background')

      expect(result).toHaveProperty('images')
      expect(Array.isArray(result.images)).toBe(true)
      expect(result.images.length).toBeGreaterThan(0)
      expect(result.images[0]).toHaveProperty('url')
      expect(result).toHaveProperty('model')
    }, 120000)
  })

  // ── Video Generation (skipped by default due to cost & async nature) ──

  describe('generateVideo', () => {
    it('initiates video generation and returns request ID', async () => {
      if (!testValues.allowVideoGeneration) {
        console.log('Skipping generateVideo: testValues.allowVideoGeneration not set')
        return
      }

      const result = await service.generateVideo('A simple rotating cube', undefined, 2)

      expect(result).toHaveProperty('request_id')
    }, 30000)
  })

  describe('getVideoResult', () => {
    it('retrieves video generation status', async () => {
      if (!testValues.videoRequestId) {
        console.log('Skipping getVideoResult: testValues.videoRequestId not set')
        return
      }

      const result = await service.getVideoResult(testValues.videoRequestId)

      expect(result).toHaveProperty('status')
    }, 30000)
  })
})
