'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('HuggingFace Service (e2e)', () => {
  let sandbox
  let service

  beforeAll(() => {
    sandbox = createE2ESandbox('huggingface')
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

  // ── Account ──

  describe('getAccountInfo', () => {
    it('returns account profile with expected shape', async () => {
      const result = await service.getAccountInfo()

      expect(result).toHaveProperty('type')
      expect(result).toHaveProperty('name')
      expect(result).toHaveProperty('auth')
    })
  })

  // ── Hub ──

  describe('searchModels', () => {
    it('returns models with count', async () => {
      const result = await service.searchModels('llama', undefined, undefined, undefined, undefined, 5)

      expect(result).toHaveProperty('count')
      expect(result).toHaveProperty('models')
      expect(Array.isArray(result.models)).toBe(true)
      expect(result.count).toBeGreaterThan(0)
      expect(result.models[0]).toHaveProperty('id')
    })

    it('filters by pipeline tag', async () => {
      const result = await service.searchModels(undefined, undefined, 'Text Generation', undefined, undefined, 3)

      expect(result.count).toBeGreaterThan(0)
    })
  })

  describe('getModelInfo', () => {
    it('returns details for a known model', async () => {
      const result = await service.getModelInfo('google-bert/bert-base-uncased')

      expect(result).toHaveProperty('id', 'google-bert/bert-base-uncased')
      expect(result).toHaveProperty('pipeline_tag')
      expect(result).toHaveProperty('downloads')
    })
  })

  describe('searchDatasets', () => {
    it('returns datasets with count', async () => {
      const result = await service.searchDatasets('imdb', undefined, undefined, 5)

      expect(result).toHaveProperty('count')
      expect(result).toHaveProperty('datasets')
      expect(Array.isArray(result.datasets)).toBe(true)
      expect(result.count).toBeGreaterThan(0)
    })
  })

  // ── Dictionaries ──

  describe('getChatModelsDictionary', () => {
    it('returns items with label, value, note', async () => {
      const result = await service.getChatModelsDictionary({})

      expect(result).toHaveProperty('items')
      expect(result).toHaveProperty('cursor', null)
      expect(Array.isArray(result.items)).toBe(true)
      expect(result.items.length).toBeGreaterThan(0)
      expect(result.items[0]).toHaveProperty('label')
      expect(result.items[0]).toHaveProperty('value')
    })
  })

  describe('getTextToImageModelsDictionary', () => {
    it('returns items', async () => {
      const result = await service.getTextToImageModelsDictionary({})

      expect(result).toHaveProperty('items')
      expect(result.items.length).toBeGreaterThan(0)
    })
  })

  describe('getHubModelsDictionary', () => {
    it('returns items', async () => {
      const result = await service.getHubModelsDictionary({})

      expect(result).toHaveProperty('items')
      expect(result.items.length).toBeGreaterThan(0)
    })
  })

  // ── Chat ──

  describe('chatCompletion', () => {
    it('generates a response for a simple prompt', async () => {
      const result = await service.chatCompletion('Say "hello" and nothing else.')

      expect(result).toHaveProperty('text')
      expect(result).toHaveProperty('model')
      expect(result).toHaveProperty('finishReason')
      expect(result).toHaveProperty('usage')
      expect(typeof result.text).toBe('string')
      expect(result.text.length).toBeGreaterThan(0)
    }, 30000)

    it('uses system prompt', async () => {
      const result = await service.chatCompletion(
        'What is 2+2?',
        undefined,
        undefined,
        'You are a calculator. Reply with only the number.'
      )

      expect(result).toHaveProperty('text')
      expect(result.text).toMatch(/4/)
    }, 30000)
  })

  describe('chatCompletionAdvanced', () => {
    it('handles multi-turn conversation', async () => {
      const messages = [
        { role: 'system', content: 'You are a helpful assistant. Be very brief.' },
        { role: 'user', content: 'Say "hi" and nothing else.' },
      ]

      const result = await service.chatCompletionAdvanced(messages)

      expect(result).toHaveProperty('choices')
      expect(Array.isArray(result.choices)).toBe(true)
      expect(result.choices.length).toBeGreaterThan(0)
      expect(result.choices[0]).toHaveProperty('message')
    }, 30000)
  })

  // ── Text Transformation ──

  describe('summarizeText', () => {
    it('returns a summary', async () => {
      const longText = 'The Hugging Face Hub is a platform with over 350,000 models, 75,000 datasets, and 150,000 demo apps, all open source and publicly available. It provides a central place where anyone can share, explore, discover, and experiment with open-source machine learning models and datasets.'

      const result = await service.summarizeText(longText)

      expect(result).toHaveProperty('summary')
      expect(typeof result.summary).toBe('string')
      expect(result.summary.length).toBeGreaterThan(0)
    }, 60000)
  })

  describe('translateText', () => {
    it('translates text with default model', async () => {
      const result = await service.translateText('translate English to German: Hello world')

      expect(result).toHaveProperty('translation')
      expect(typeof result.translation).toBe('string')
      expect(result.translation.length).toBeGreaterThan(0)
    }, 60000)
  })

  // ── Text Analysis ──

  describe('classifyText', () => {
    it('returns sentiment labels', async () => {
      const result = await service.classifyText('I love this product!')

      expect(result).toHaveProperty('labels')
      expect(result).toHaveProperty('topLabel')
      expect(result).toHaveProperty('topScore')
      expect(Array.isArray(result.labels)).toBe(true)
      expect(result.labels.length).toBeGreaterThan(0)
      expect(result.topLabel).toBe('POSITIVE')
    }, 60000)
  })

  describe('classifyTextZeroShot', () => {
    it('classifies text against candidate labels', async () => {
      const result = await service.classifyTextZeroShot(
        'I want to return this item and get a refund',
        ['refund', 'shipping', 'product_info']
      )

      expect(result).toHaveProperty('labels')
      expect(result).toHaveProperty('topLabel')
      expect(result).toHaveProperty('topScore')
      expect(result.topLabel).toBe('refund')
    }, 60000)
  })

  describe('fillMask', () => {
    it('returns predictions for masked token', async () => {
      const result = await service.fillMask('The capital of France is [MASK].')

      expect(result).toHaveProperty('predictions')
      expect(Array.isArray(result.predictions)).toBe(true)
      expect(result.predictions.length).toBeGreaterThan(0)
      expect(result.predictions[0]).toHaveProperty('score')
      expect(result.predictions[0]).toHaveProperty('token_str')
    }, 60000)
  })

  describe('answerQuestion', () => {
    it('extracts answer from context', async () => {
      const result = await service.answerQuestion(
        'What is the capital of France?',
        'France is a country in Europe. The capital of France is Paris. Paris is known for the Eiffel Tower.'
      )

      expect(result).toHaveProperty('answer')
      expect(result).toHaveProperty('score')
      expect(result).toHaveProperty('answers')
      expect(result.answer.toLowerCase()).toContain('paris')
    }, 60000)
  })

  // ── Embeddings ──

  describe('createEmbeddings', () => {
    it('returns embedding vectors', async () => {
      const result = await service.createEmbeddings(['Hello world', 'Goodbye world'])

      expect(result).toHaveProperty('embeddings')
      expect(result).toHaveProperty('count', 2)
      expect(result).toHaveProperty('dimensions')
      expect(result).toHaveProperty('model')
      expect(Array.isArray(result.embeddings)).toBe(true)
      expect(result.embeddings).toHaveLength(2)
      expect(result.dimensions).toBeGreaterThan(0)
    }, 60000)
  })
})
