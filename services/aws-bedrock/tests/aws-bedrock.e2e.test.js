'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('AWS Bedrock Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('aws-bedrock')
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

  // ── List Foundation Models ──

  describe('listFoundationModels', () => {
    it('returns a list of models with expected shape', async () => {
      const result = await service.listFoundationModels()

      expect(result).toHaveProperty('models')
      expect(result).toHaveProperty('count')
      expect(Array.isArray(result.models)).toBe(true)
      expect(result.count).toBeGreaterThan(0)
      expect(result.models[0]).toHaveProperty('modelId')
      expect(result.models[0]).toHaveProperty('modelName')
      expect(result.models[0]).toHaveProperty('providerName')
      expect(result.models[0]).toHaveProperty('inputModalities')
      expect(result.models[0]).toHaveProperty('outputModalities')
    })

    it('filters by provider name', async () => {
      const result = await service.listFoundationModels('Amazon')

      expect(result.models.length).toBeGreaterThan(0)

      for (const model of result.models) {
        expect(model.providerName).toBe('Amazon')
      }
    })

    it('filters by output modality Text', async () => {
      const result = await service.listFoundationModels(null, 'Text')

      expect(result.models.length).toBeGreaterThan(0)

      for (const model of result.models) {
        expect(model.outputModalities).toContain('TEXT')
      }
    })
  })

  // ── Get Foundation Model ──

  describe('getFoundationModel', () => {
    it('returns model details for a known model', async () => {
      const modelId = testValues.modelId || 'amazon.titan-text-express-v1'
      const result = await service.getFoundationModel(modelId)

      expect(result).toHaveProperty('model')
      expect(result.model).toHaveProperty('modelId')
      expect(result.model).toHaveProperty('modelName')
      expect(result.model).toHaveProperty('providerName')
    })

    it('throws for a non-existent model', async () => {
      await expect(service.getFoundationModel('nonexistent.model-id-xyz')).rejects.toThrow()
    })
  })

  // ── Dictionary ──

  describe('getModelsDictionary', () => {
    it('returns dictionary items with correct shape', async () => {
      const result = await service.getModelsDictionary()

      expect(result).toHaveProperty('items')
      expect(result).toHaveProperty('cursor')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result.items.length).toBeGreaterThan(0)
      expect(result.items[0]).toHaveProperty('label')
      expect(result.items[0]).toHaveProperty('value')
    })

    it('filters results by search term', async () => {
      const all = await service.getModelsDictionary()
      const filtered = await service.getModelsDictionary({ search: 'titan' })

      expect(filtered.items.length).toBeGreaterThan(0)
      expect(filtered.items.length).toBeLessThanOrEqual(all.items.length)

      for (const item of filtered.items) {
        const matchesSearch =
          item.label.toLowerCase().includes('titan') ||
          item.value.toLowerCase().includes('titan') ||
          (item.note || '').toLowerCase().includes('titan')

        expect(matchesSearch).toBe(true)
      }
    })
  })

  // ── Converse ──

  describe('converse', () => {
    it('sends a simple prompt and receives a response', async () => {
      const modelId = testValues.modelId || 'amazon.titan-text-express-v1'
      const result = await service.converse(modelId, 'Say hello in one word.')

      expect(result).toHaveProperty('message')
      expect(result).toHaveProperty('text')
      expect(result).toHaveProperty('stopReason')
      expect(result).toHaveProperty('usage')
      expect(typeof result.text).toBe('string')
      expect(result.text.length).toBeGreaterThan(0)
    }, 30000)

    it('accepts inference config to limit tokens', async () => {
      const modelId = testValues.modelId || 'amazon.titan-text-express-v1'
      const result = await service.converse(
        modelId,
        'Count from 1 to 100.',
        null,
        null,
        { maxTokens: 10 }
      )

      expect(result).toHaveProperty('text')
      expect(result.usage).toHaveProperty('outputTokens')
      expect(result.usage.outputTokens).toBeLessThanOrEqual(15)
    }, 30000)

    it('accepts a system instruction', async () => {
      const modelId = testValues.modelId || 'amazon.titan-text-express-v1'
      const result = await service.converse(
        modelId,
        'What are you?',
        null,
        'You are a helpful pirate. Always respond with "Arrr!".',
        { maxTokens: 50 }
      )

      expect(result).toHaveProperty('text')
      expect(typeof result.text).toBe('string')
    }, 30000)

    it('accepts a full messages array', async () => {
      const modelId = testValues.modelId || 'amazon.titan-text-express-v1'
      const messages = [
        { role: 'user', content: [{ text: 'Say "pong".' }] },
      ]

      const result = await service.converse(modelId, null, messages, null, { maxTokens: 10 })

      expect(result).toHaveProperty('text')
      expect(typeof result.text).toBe('string')
    }, 30000)

    it('throws when model ID is missing', async () => {
      await expect(service.converse(null, 'Hello')).rejects.toThrow('modelId is required.')
    })
  })

  // ── Invoke Model ──

  describe('invokeModel', () => {
    it('invokes a model with raw body and returns response', async () => {
      const modelId = testValues.modelId || 'amazon.titan-text-express-v1'

      // Titan Text native body format
      const body = {
        inputText: 'Say hello.',
        textGenerationConfig: { maxTokenCount: 10 },
      }

      const result = await service.invokeModel(modelId, body)

      expect(result).toHaveProperty('body')
      expect(typeof result.body).toBe('object')
    }, 30000)

    it('throws when body is missing', async () => {
      await expect(service.invokeModel('model-id')).rejects.toThrow('body (plain JSON object) is required.')
    })
  })
})
