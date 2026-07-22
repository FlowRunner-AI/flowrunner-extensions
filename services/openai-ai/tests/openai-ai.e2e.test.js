'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('OpenAI Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('openai-ai')
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
      expect(result.data[0]).toHaveProperty('object', 'model')
    })
  })

  describe('getModel', () => {
    it('retrieves a specific model', async () => {
      const result = await service.getModel('gpt-4o')

      expect(result).toHaveProperty('id', 'gpt-4o')
      expect(result).toHaveProperty('object', 'model')
    })
  })

  // ── Dictionary Methods ──

  describe('getModelsDictionary', () => {
    it('returns models with label/value/note', async () => {
      const result = await service.getModelsDictionary({})

      expect(result).toHaveProperty('items')
      expect(result).toHaveProperty('cursor', null)
      expect(result.items.length).toBeGreaterThan(0)
      expect(result.items[0]).toHaveProperty('label')
      expect(result.items[0]).toHaveProperty('value')
      expect(result.items[0]).toHaveProperty('note')
    })

    it('filters by search', async () => {
      const result = await service.getModelsDictionary({ search: 'gpt-4o' })

      expect(result.items.length).toBeGreaterThan(0)
      result.items.forEach(item => {
        expect(item.value.toLowerCase()).toContain('gpt-4o')
      })
    })
  })

  describe('getChatModelsDictionary', () => {
    it('returns only chat-capable models', async () => {
      const result = await service.getChatModelsDictionary({})

      expect(result.items.length).toBeGreaterThan(0)
      result.items.forEach(item => {
        expect(item.value).toMatch(/^(gpt-|o[134])/)
      })
    })
  })

  describe('getEmbeddingModelsDictionary', () => {
    it('returns only embedding models', async () => {
      const result = await service.getEmbeddingModelsDictionary({})

      expect(result.items.length).toBeGreaterThan(0)
      result.items.forEach(item => {
        expect(item.value).toMatch(/embedding/)
      })
    })
  })

  describe('getTtsModelsDictionary', () => {
    it('returns only TTS models', async () => {
      const result = await service.getTtsModelsDictionary({})

      expect(result.items.length).toBeGreaterThan(0)
      result.items.forEach(item => {
        expect(item.value).toMatch(/tts/)
      })
    })
  })

  describe('getTranscriptionModelsDictionary', () => {
    it('returns only transcription models', async () => {
      const result = await service.getTranscriptionModelsDictionary({})

      expect(result.items.length).toBeGreaterThan(0)
      result.items.forEach(item => {
        expect(item.value).toMatch(/whisper|transcribe/)
      })
    })
  })

  // ── Moderation ──

  describe('moderateContent', () => {
    it('moderates text input', async () => {
      const result = await service.moderateContent(['Hello, how are you?'])

      expect(result).toHaveProperty('flagged')
      expect(result).toHaveProperty('categories')
      expect(result).toHaveProperty('category_scores')
    })
  })

  // ── Chat Completions ──

  describe('createChatCompletion', () => {
    it('creates a chat completion', async () => {
      const result = await service.createChatCompletion(
        [{ role: 'user', content: 'Say hello in exactly one word.' }],
        'gpt-4o-mini'
      )

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('choices')
      expect(result.choices.length).toBeGreaterThan(0)
      expect(result.choices[0]).toHaveProperty('message')
      expect(result.choices[0].message).toHaveProperty('content')
    }, 30000)
  })

  // ── Responses ──

  describe('createResponse + getResponse + deleteResponse', () => {
    let responseId

    it('creates a response', async () => {
      const result = await service.createResponse(
        'Say hello in exactly one word.',
        'gpt-4o-mini'
      )

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('status', 'completed')
      expect(result).toHaveProperty('outputText')
      expect(result.outputText.length).toBeGreaterThan(0)
      responseId = result.id
    }, 30000)

    it('retrieves the response', async () => {
      if (!responseId) {
        console.log('Skipping: no response ID from create step')
        return
      }

      const result = await service.getResponse(responseId)

      expect(result).toHaveProperty('id', responseId)
      expect(result).toHaveProperty('outputText')
    })

    it('deletes the response', async () => {
      if (!responseId) {
        console.log('Skipping: no response ID from create step')
        return
      }

      const result = await service.deleteResponse(responseId)

      expect(result).toHaveProperty('deleted', true)
    })
  })

  // ── Embeddings ──

  describe('createEmbeddings', () => {
    it('creates embeddings for text inputs', async () => {
      const result = await service.createEmbeddings(['Hello world', 'Goodbye world'])

      expect(result).toHaveProperty('data')
      expect(result.data).toHaveLength(2)
      expect(result.data[0]).toHaveProperty('embedding')
      expect(Array.isArray(result.data[0].embedding)).toBe(true)
      expect(result.data[0].embedding.length).toBeGreaterThan(0)
    })

    it('supports custom dimensions', async () => {
      const result = await service.createEmbeddings(['test'], 'text-embedding-3-small', 256)

      expect(result.data[0].embedding).toHaveLength(256)
    })
  })

  // ── Files ──

  describe('listFiles', () => {
    it('returns a list of files', async () => {
      const result = await service.listFiles()

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
    })
  })

  describe('getFilesDictionary', () => {
    it('returns files with label/value/note', async () => {
      const result = await service.getFilesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Batches ──

  describe('listBatches', () => {
    it('returns a list of batches', async () => {
      const result = await service.listBatches(5)

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
    })
  })

  // ── Vector Stores ──

  describe('vector store lifecycle', () => {
    let vectorStoreId

    it('creates a vector store', async () => {
      const result = await service.createVectorStore('E2E Test Store')

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('name', 'E2E Test Store')
      vectorStoreId = result.id
    })

    it('retrieves the vector store', async () => {
      if (!vectorStoreId) {
        console.log('Skipping: no vector store ID')
        return
      }

      const result = await service.getVectorStore(vectorStoreId)

      expect(result).toHaveProperty('id', vectorStoreId)
      expect(result).toHaveProperty('name', 'E2E Test Store')
    })

    it('lists vector stores', async () => {
      const result = await service.listVectorStores(5)

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
    })

    it('deletes the vector store', async () => {
      if (!vectorStoreId) {
        console.log('Skipping: no vector store ID')
        return
      }

      const result = await service.deleteVectorStore(vectorStoreId)

      expect(result).toHaveProperty('deleted', true)
    })
  })

  describe('getVectorStoresDictionary', () => {
    it('returns vector stores with label/value/note', async () => {
      const result = await service.getVectorStoresDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor')
    })
  })

  // ── Videos ──

  describe('listVideos', () => {
    it('returns a list of videos', async () => {
      const result = await service.listVideos(5)

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
    })
  })

  // ── Web Search ──

  describe('webSearch', () => {
    it('searches the web and returns text with sources', async () => {
      const { webSearchQuery } = testValues

      if (!webSearchQuery) {
        console.log('Skipping webSearch: testValues.webSearchQuery not set')
        return
      }

      const result = await service.webSearch(webSearchQuery)

      expect(result).toHaveProperty('text')
      expect(result.text.length).toBeGreaterThan(0)
      expect(result).toHaveProperty('sources')
      expect(Array.isArray(result.sources)).toBe(true)
    }, 30000)
  })
})
