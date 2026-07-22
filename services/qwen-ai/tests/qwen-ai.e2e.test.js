'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Qwen AI Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('qwen-ai')
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

  // ── Dictionaries ──

  describe('getChatModelsDictionary', () => {
    it('returns items with label and value', async () => {
      const result = await service.getChatModelsDictionary({})

      expect(result).toHaveProperty('items')
      expect(result).toHaveProperty('cursor', null)
      expect(result.items.length).toBeGreaterThan(0)
      expect(result.items[0]).toHaveProperty('label')
      expect(result.items[0]).toHaveProperty('value')
    })

    it('filters by search', async () => {
      const all = await service.getChatModelsDictionary({})
      const filtered = await service.getChatModelsDictionary({ search: 'qwen-max' })

      expect(filtered.items.length).toBeLessThanOrEqual(all.items.length)

      if (filtered.items.length > 0) {
        expect(filtered.items[0].label).toContain('qwen-max')
      }
    })
  })

  describe('getVisionModelsDictionary', () => {
    it('returns static vision models', async () => {
      const result = await service.getVisionModelsDictionary({})

      expect(result.items).toHaveLength(4)
      expect(result.cursor).toBeNull()
    })
  })

  describe('getEmbeddingModelsDictionary', () => {
    it('returns static embedding models', async () => {
      const result = await service.getEmbeddingModelsDictionary({})

      expect(result.items).toHaveLength(2)
    })
  })

  describe('getImageModelsDictionary', () => {
    it('returns static image models', async () => {
      const result = await service.getImageModelsDictionary({})

      expect(result.items).toHaveLength(4)
    })
  })

  describe('getVideoModelsDictionary', () => {
    it('returns static video models', async () => {
      const result = await service.getVideoModelsDictionary({})

      expect(result.items).toHaveLength(4)
    })
  })

  describe('getVoicesDictionary', () => {
    it('returns voices for default model', async () => {
      const result = await service.getVoicesDictionary({})

      expect(result.items.length).toBeGreaterThan(7)
      expect(result.items[0]).toHaveProperty('label')
      expect(result.items[0]).toHaveProperty('value')
    })
  })

  // ── Chat ──

  describe('chatCompletion', () => {
    it('generates a text response', async () => {
      const result = await service.chatCompletion('What is 2 + 2? Reply with just the number.', 'qwen-plus')

      expect(result).toHaveProperty('text')
      expect(result.text.length).toBeGreaterThan(0)
      expect(result).toHaveProperty('model')
      expect(result).toHaveProperty('finishReason')
      expect(result).toHaveProperty('usage')
    }, 30000)

    it('uses system prompt', async () => {
      const result = await service.chatCompletion(
        'What are you?',
        'qwen-flash',
        'You are a pirate. Always respond in pirate speak.'
      )

      expect(result).toHaveProperty('text')
      expect(result.text.length).toBeGreaterThan(0)
    }, 30000)

    it('throws on empty prompt', async () => {
      await expect(service.chatCompletion('')).rejects.toThrow('Prompt is required')
    })
  })

  describe('chatCompletionAdvanced', () => {
    it('sends multi-turn conversation', async () => {
      const messages = [
        { role: 'system', content: 'You are a concise assistant.' },
        { role: 'user', content: 'Say hello in exactly one word.' },
      ]

      const result = await service.chatCompletionAdvanced(messages, 'qwen-flash')

      expect(result).toHaveProperty('choices')
      expect(Array.isArray(result.choices)).toBe(true)
      expect(result.choices[0]).toHaveProperty('message')
      expect(result.choices[0].message).toHaveProperty('content')
    }, 30000)
  })

  // ── Embeddings ──

  describe('createEmbeddings', () => {
    it('generates embeddings for a single text', async () => {
      const result = await service.createEmbeddings(['Hello world'])

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
      expect(result.data[0]).toHaveProperty('embedding')
      expect(Array.isArray(result.data[0].embedding)).toBe(true)
      expect(result.data[0].embedding.length).toBeGreaterThan(0)
    }, 15000)

    it('generates embeddings for multiple texts', async () => {
      const result = await service.createEmbeddings(['Hello', 'World'])

      expect(result.data).toHaveLength(2)
    }, 15000)

    it('supports custom dimensions', async () => {
      const result = await service.createEmbeddings(['Hello world'], 'text-embedding-v4', 256)

      expect(result.data[0].embedding).toHaveLength(256)
    }, 15000)
  })

  // ── Image Generation ──

  describe('createImageTask', () => {
    it('submits an image generation task', async () => {
      const result = await service.createImageTask('A cute cartoon fox in a forest, watercolor style')

      expect(result).toHaveProperty('taskId')
      expect(result.taskId).toBeTruthy()
      expect(result).toHaveProperty('taskStatus')
    }, 30000)
  })

  describe('getTaskStatus', () => {
    it('retrieves task status for a submitted task', async () => {
      const task = await service.createImageTask('A simple blue circle on white background')

      expect(task.taskId).toBeTruthy()

      const status = await service.getTaskStatus(task.taskId)

      expect(status).toHaveProperty('output')
      expect(status.output).toHaveProperty('task_id', task.taskId)
      expect(status.output).toHaveProperty('task_status')
    }, 30000)

    it('throws on empty task ID', async () => {
      await expect(service.getTaskStatus('')).rejects.toThrow('Task ID is required')
    })
  })

  // ── Audio ──

  describe('transcribeAudio', () => {
    it('transcribes audio from a URL', async () => {
      const { audioUrl } = testValues

      if (!audioUrl) {
        console.log('Skipping transcribeAudio: testValues.audioUrl not set')
        return
      }

      const result = await service.transcribeAudio(audioUrl)

      expect(result).toHaveProperty('text')
      expect(result.text.length).toBeGreaterThan(0)
      expect(result).toHaveProperty('model')
    }, 60000)
  })

  // ── Validation ──

  describe('input validation', () => {
    it('chatCompletion rejects whitespace-only prompt', async () => {
      await expect(service.chatCompletion('   ')).rejects.toThrow('Prompt is required')
    })

    it('analyzeImage rejects empty imageUrls', async () => {
      await expect(service.analyzeImage('Describe', [])).rejects.toThrow('At least one image URL')
    })

    it('createEmbeddings rejects more than 10 texts', async () => {
      await expect(service.createEmbeddings(Array(11).fill('t'))).rejects.toThrow('maximum of 10')
    })
  })
})
