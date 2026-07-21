'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Ollama Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('ollama')
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

  // ── Server ──

  describe('getVersion', () => {
    it('returns the server version', async () => {
      const result = await service.getVersion()

      expect(result).toHaveProperty('version')
      expect(typeof result.version).toBe('string')
    })
  })

  // ── Model Management ──

  describe('listLocalModels', () => {
    it('returns a models array', async () => {
      const result = await service.listLocalModels()

      expect(result).toHaveProperty('models')
      expect(Array.isArray(result.models)).toBe(true)
    })
  })

  describe('listRunningModels', () => {
    it('returns a models array', async () => {
      const result = await service.listRunningModels()

      expect(result).toHaveProperty('models')
      expect(Array.isArray(result.models)).toBe(true)
    })
  })

  describe('showModelInfo', () => {
    it('returns model details', async () => {
      const { model } = testValues

      if (!model) {
        console.log('Skipping showModelInfo: testValues.model not set')
        return
      }

      const result = await service.showModelInfo(model)

      expect(result).toHaveProperty('details')
      expect(result.details).toHaveProperty('family')
    })

    it('returns verbose info when requested', async () => {
      const { model } = testValues

      if (!model) {
        console.log('Skipping showModelInfo verbose: testValues.model not set')
        return
      }

      const result = await service.showModelInfo(model, true)

      expect(result).toHaveProperty('model_info')
    })
  })

  // ── Dictionaries ──

  describe('getModelsDictionary', () => {
    it('returns dictionary items', async () => {
      const result = await service.getModelsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor', null)

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
      }
    })

    it('filters by search term', async () => {
      const { model } = testValues

      if (!model) {
        console.log('Skipping getModelsDictionary search: testValues.model not set')
        return
      }

      const result = await service.getModelsDictionary({ search: model })

      expect(result.items.length).toBeGreaterThanOrEqual(1)
      expect(result.items[0].value).toContain(model)
    })
  })

  // ── Generation ──

  describe('generateCompletion', () => {
    it('generates a text completion', async () => {
      const { model } = testValues

      if (!model) {
        console.log('Skipping generateCompletion: testValues.model not set')
        return
      }

      const result = await service.generateCompletion(model, 'Say hello in one word.')

      expect(result).toHaveProperty('model')
      expect(result).toHaveProperty('response')
      expect(typeof result.response).toBe('string')
      expect(result).toHaveProperty('done', true)
    }, 60000)

    it('generates JSON output', async () => {
      const { model } = testValues

      if (!model) {
        console.log('Skipping generateCompletion JSON: testValues.model not set')
        return
      }

      const result = await service.generateCompletion(
        model,
        'Return a JSON object with a key "greeting" and value "hello".',
        null,
        'JSON Object'
      )

      expect(result).toHaveProperty('response')
      const parsed = JSON.parse(result.response)
      expect(parsed).toHaveProperty('greeting')
    }, 60000)
  })

  describe('chat', () => {
    it('sends a chat message and gets a reply', async () => {
      const { model } = testValues

      if (!model) {
        console.log('Skipping chat: testValues.model not set')
        return
      }

      const messages = [{ role: 'user', content: 'Say "pong" and nothing else.' }]
      const result = await service.chat(model, messages)

      expect(result).toHaveProperty('message')
      expect(result.message).toHaveProperty('role', 'assistant')
      expect(result.message).toHaveProperty('content')
      expect(result).toHaveProperty('done', true)
    }, 60000)

    it('supports system message in conversation', async () => {
      const { model } = testValues

      if (!model) {
        console.log('Skipping chat system message: testValues.model not set')
        return
      }

      const messages = [
        { role: 'system', content: 'You only respond with the word OK.' },
        { role: 'user', content: 'Hello' },
      ]
      const result = await service.chat(model, messages)

      expect(result).toHaveProperty('message')
      expect(result.message.role).toBe('assistant')
    }, 60000)
  })

  // ── Embeddings ──

  describe('createEmbeddings', () => {
    it('creates embeddings for input texts', async () => {
      const { embeddingModel } = testValues

      if (!embeddingModel) {
        console.log('Skipping createEmbeddings: testValues.embeddingModel not set')
        return
      }

      const result = await service.createEmbeddings(embeddingModel, ['Hello world', 'Test sentence'])

      expect(result).toHaveProperty('embeddings')
      expect(result.embeddings).toHaveLength(2)
      expect(Array.isArray(result.embeddings[0])).toBe(true)
      expect(result.embeddings[0].length).toBeGreaterThan(0)
    }, 60000)
  })

  // ── Copy + Delete lifecycle ──

  describe('copyModel + deleteModel', () => {
    const destName = `e2e-test-copy-${Date.now()}`

    it('copies a model', async () => {
      const { model } = testValues

      if (!model) {
        console.log('Skipping copyModel: testValues.model not set')
        return
      }

      const result = await service.copyModel(model, destName)

      expect(result).toEqual({ source: model, destination: destName, copied: true })
    }, 30000)

    it('deletes the copied model', async () => {
      const { model } = testValues

      if (!model) {
        console.log('Skipping deleteModel: testValues.model not set')
        return
      }

      const result = await service.deleteModel(destName)

      expect(result).toEqual({ model: destName, deleted: true })
    }, 30000)
  })
})
