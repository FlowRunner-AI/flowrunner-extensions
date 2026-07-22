'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Perplexity Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('perplexity')
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
    it('returns the agent model catalogue', async () => {
      const result = await service.listModels()

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
      expect(result.data.length).toBeGreaterThan(0)
      expect(result.data[0]).toHaveProperty('id')
    })
  })

  describe('getAgentModelsDictionary', () => {
    it('returns dictionary items sorted by id', async () => {
      const result = await service.getAgentModelsDictionary({})

      expect(Array.isArray(result.items)).toBe(true)
      expect(result.items.length).toBeGreaterThan(0)
      expect(result.items[0]).toHaveProperty('label')
      expect(result.items[0]).toHaveProperty('value')
      expect(result.cursor).toBeNull()
    })

    it('filters by search text', async () => {
      const result = await service.getAgentModelsDictionary({ search: 'sonar' })

      expect(result.items.every(item => item.value.toLowerCase().includes('sonar'))).toBe(true)
    })
  })

  // ── Sonar ──

  describe('ask', () => {
    it('answers a factual question with citations', async () => {
      const result = await service.ask('What is the capital of France? Answer in one word.')

      expect(typeof result.answer).toBe('string')
      expect(result.answer.length).toBeGreaterThan(0)
      expect(Array.isArray(result.citations)).toBe(true)
      expect(Array.isArray(result.searchResults)).toBe(true)
      expect(result).toHaveProperty('model')
      expect(result).toHaveProperty('id')
    })

    it('honours a system prompt, recency filter and max tokens', async () => {
      const result = await service.ask(
        'Name one recent AI research milestone.',
        'Sonar',
        'Answer in a single short sentence.',
        'Web',
        'Month',
        undefined,
        true,
        200
      )

      expect(typeof result.answer).toBe('string')
      expect(Array.isArray(result.relatedQuestions)).toBe(true)
    })

    it('rejects an empty prompt', async () => {
      await expect(service.ask('   ')).rejects.toThrow('Prompt is required')
    })
  })

  describe('chatCompletionAdvanced', () => {
    it('returns the raw chat completion payload', async () => {
      const result = await service.chatCompletionAdvanced(
        [
          { role: 'System', content: 'Reply with a single word.' },
          { role: 'User', content: 'What color is the sky on a clear day?' },
        ],
        'Sonar',
        100
      )

      expect(result).toHaveProperty('choices')
      expect(Array.isArray(result.choices)).toBe(true)
      expect(result.choices[0].message).toHaveProperty('content')
      expect(result).toHaveProperty('usage')
    })

    it('rejects an empty messages array', async () => {
      await expect(service.chatCompletionAdvanced([])).rejects.toThrow(
        'Messages array is required and must not be empty'
      )
    })
  })

  // ── Search ──

  describe('searchWeb', () => {
    it('returns ranked search results without an LLM answer', async () => {
      const result = await service.searchWeb('solid state battery research', undefined, 5)

      expect(result).toHaveProperty('results')
      expect(Array.isArray(result.results)).toBe(true)
      expect(result.results.length).toBeGreaterThan(0)
      expect(result.results[0]).toHaveProperty('url')
    })

    it('supports multiple queries in one call', async () => {
      const result = await service.searchWeb('electric vehicles', ['battery recycling'], 3)

      expect(Array.isArray(result.results)).toBe(true)
    })
  })

  // ── Async Sonar ──

  describe('async chat completions', () => {
    let requestId

    it('creates an async request', async () => {
      const result = await service.createAsyncChatCompletion(
        [{ role: 'User', content: 'Give a one-sentence summary of photosynthesis.' }],
        'Sonar'
      )

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('status')
      requestId = result.id
    })

    it('retrieves the async request by id', async () => {
      if (!requestId) {
        console.log('Skipping getAsyncChatCompletion: no request was created')

        return
      }

      const result = await service.getAsyncChatCompletion(requestId)

      expect(result).toHaveProperty('id', requestId)
      expect(result).toHaveProperty('status')
    })

    it('lists async requests', async () => {
      const result = await service.listAsyncChatCompletions(5)

      expect(result).toHaveProperty('requests')
      expect(Array.isArray(result.requests)).toBe(true)
    })

    it('rejects a missing request id', async () => {
      await expect(service.getAsyncChatCompletion('')).rejects.toThrow('Request ID is required')
    })
  })

  // ── Agent ──

  describe('agent responses', () => {
    let responseId

    it('creates an agent response', async () => {
      const result = await service.createAgentResponse(
        'In one sentence, what is the Perplexity Agent API?',
        undefined,
        'Fast'
      )

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('status')
      expect(Array.isArray(result.output)).toBe(true)
      responseId = result.id
    })

    it('retrieves a stored agent response', async () => {
      if (!responseId) {
        console.log('Skipping getAgentResponse: no agent response was created')

        return
      }

      const result = await service.getAgentResponse(responseId)

      expect(result).toHaveProperty('id', responseId)
      expect(result).toHaveProperty('status')
    })

    it('continues a conversation with a previous response id', async () => {
      if (!responseId) {
        console.log('Skipping agent follow-up: no agent response was created')

        return
      }

      const result = await service.createAgentResponse(
        'Summarise your previous answer in five words.',
        undefined,
        'Fast',
        undefined,
        undefined,
        undefined,
        responseId
      )

      expect(result).toHaveProperty('id')
    })

    it('rejects an empty input', async () => {
      await expect(service.createAgentResponse('')).rejects.toThrow('Input is required')
    })
  })

  // ── Embeddings ──

  describe('createEmbeddings', () => {
    it('embeds a batch of texts', async () => {
      const result = await service.createEmbeddings(['hello world', 'goodbye world'])

      expect(result).toHaveProperty('data')
      expect(result.data).toHaveLength(2)
      expect(result.data[0]).toHaveProperty('embedding')
      expect(result).toHaveProperty('usage')
    })

    it('honours the model, dimensions and encoding format', async () => {
      const { embeddingsModel } = testValues

      const result = await service.createEmbeddings(
        ['dimension test'],
        embeddingsModel || 'Perplexity Embed v1 (0.6B)',
        256,
        'Base64 Binary'
      )

      expect(result).toHaveProperty('data')
      expect(result.data).toHaveLength(1)
    })

    it('rejects an empty input array', async () => {
      await expect(service.createEmbeddings([])).rejects.toThrow(
        'Input texts array is required and must not be empty'
      )
    })
  })

  describe('createContextualizedEmbeddings', () => {
    it('embeds chunked documents', async () => {
      const result = await service.createContextualizedEmbeddings([
        { chunks: ['Chapter one talks about batteries.', 'Chapter two talks about charging.'] },
        { chunks: ['A single chunk document.'] },
      ])

      expect(result).toHaveProperty('data')
      expect(result.data).toHaveLength(2)
      expect(Array.isArray(result.data[0].embeddings)).toBe(true)
    })

    it('rejects a document with no chunks', async () => {
      await expect(service.createContextualizedEmbeddings([{ chunks: [] }])).rejects.toThrow(
        'Every document must contain at least one chunk'
      )
    })
  })
})
