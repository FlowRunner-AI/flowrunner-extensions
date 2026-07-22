'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Jina AI Service (e2e)', () => {
  let sandbox
  let service

  beforeAll(() => {
    sandbox = createE2ESandbox('jina')
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

  // ── Embeddings ──

  describe('createEmbeddings', () => {
    it('returns embeddings with expected shape', async () => {
      const result = await service.createEmbeddings(['Hello world'])

      expect(result).toHaveProperty('model')
      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
      expect(result.data).toHaveLength(1)
      expect(result.data[0]).toHaveProperty('embedding')
      expect(Array.isArray(result.data[0].embedding)).toBe(true)
      expect(result).toHaveProperty('usage')
      expect(result.usage).toHaveProperty('total_tokens')
    })

    it('returns multiple embeddings for multiple inputs', async () => {
      const result = await service.createEmbeddings(['Hello', 'World'])

      expect(result.data).toHaveLength(2)
      expect(result.data[0]).toHaveProperty('index', 0)
      expect(result.data[1]).toHaveProperty('index', 1)
    })

    it('supports task parameter', async () => {
      const result = await service.createEmbeddings(['Search query'], undefined, 'Retrieval Query')

      expect(result).toHaveProperty('data')
      expect(result.data).toHaveLength(1)
      expect(result.data[0]).toHaveProperty('embedding')
    })

    it('supports dimensions parameter', async () => {
      const result = await service.createEmbeddings(['test'], undefined, undefined, 256)

      expect(result.data[0].embedding.length).toBeLessThanOrEqual(256)
    })
  })

  // ── Reranking ──

  describe('rerankDocuments', () => {
    it('returns reranked results with expected shape', async () => {
      const result = await service.rerankDocuments(
        'What is the capital of France?',
        ['Paris is the capital of France.', 'Berlin is a city in Germany.', 'London is in England.'],
      )

      expect(result).toHaveProperty('model')
      expect(result).toHaveProperty('results')
      expect(Array.isArray(result.results)).toBe(true)
      expect(result.results.length).toBeGreaterThan(0)
      expect(result.results[0]).toHaveProperty('index')
      expect(result.results[0]).toHaveProperty('relevance_score')
      expect(typeof result.results[0].relevance_score).toBe('number')
      expect(result).toHaveProperty('usage')
    })

    it('respects topN parameter', async () => {
      const result = await service.rerankDocuments(
        'capital of France',
        ['Paris is the capital.', 'Berlin is large.', 'London is old.'],
        undefined,
        1,
      )

      expect(result.results).toHaveLength(1)
    })

    it('includes documents when returnDocuments is true', async () => {
      const result = await service.rerankDocuments(
        'capital of France',
        ['Paris is the capital.'],
        undefined,
        undefined,
        true,
      )

      expect(result.results[0]).toHaveProperty('document')
      expect(result.results[0].document).toHaveProperty('text')
    })
  })

  // ── Reader ──

  describe('readUrl', () => {
    it('reads a URL and returns content', async () => {
      const result = await service.readUrl('https://example.com')

      expect(result).toHaveProperty('data')
      expect(result.data).toHaveProperty('title')
      expect(result.data).toHaveProperty('content')
      expect(typeof result.data.content).toBe('string')
      expect(result.data.content.length).toBeGreaterThan(0)
    }, 30000)

    it('supports HTML return format', async () => {
      const result = await service.readUrl('https://example.com', 'HTML')

      expect(result).toHaveProperty('data')
      expect(result.data).toHaveProperty('content')
      expect(typeof result.data.content).toBe('string')
    }, 30000)

    it('supports links summary', async () => {
      const result = await service.readUrl('https://example.com', undefined, true)

      expect(result).toHaveProperty('data')
      expect(result.data).toHaveProperty('content')
    }, 30000)
  })

  // ── Search Web ──

  describe('searchWeb', () => {
    it('returns search results with expected shape', async () => {
      const result = await service.searchWeb('Jina AI embeddings')

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
      expect(result.data.length).toBeGreaterThan(0)
      expect(result.data[0]).toHaveProperty('title')
      expect(result.data[0]).toHaveProperty('url')
      expect(result.data[0]).toHaveProperty('content')
    }, 30000)

    it('supports site filter', async () => {
      const result = await service.searchWeb('embeddings', undefined, 'jina.ai')

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
    }, 30000)
  })

  // ── Classification ──

  describe('classifyTexts', () => {
    it('classifies texts with expected shape', async () => {
      const result = await service.classifyTexts(
        ['This product is amazing!', 'Terrible experience.'],
        ['positive', 'negative'],
      )

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
      expect(result.data).toHaveLength(2)
      expect(result.data[0]).toHaveProperty('prediction')
      expect(result.data[0]).toHaveProperty('score')
      expect(typeof result.data[0].score).toBe('number')
      expect(result).toHaveProperty('usage')
    })
  })

  // ── Segmentation ──

  describe('segmentText', () => {
    it('segments text and returns chunks', async () => {
      const longText = 'Artificial intelligence is transforming the world. ' +
        'Machine learning models can now understand natural language. ' +
        'Vector embeddings represent text as numerical arrays for semantic search.'

      const result = await service.segmentText(longText)

      expect(result).toHaveProperty('num_tokens')
      expect(typeof result.num_tokens).toBe('number')
      expect(result.num_tokens).toBeGreaterThan(0)
      expect(result).toHaveProperty('tokenizer')
    })

    it('returns only token count when returnChunks is false', async () => {
      const result = await service.segmentText('Some text to tokenize.', undefined, false)

      expect(result).toHaveProperty('num_tokens')
      expect(typeof result.num_tokens).toBe('number')
    })

    it('supports custom tokenizer', async () => {
      const result = await service.segmentText('Some text.', 'O200k Base')

      expect(result).toHaveProperty('num_tokens')
      expect(result).toHaveProperty('tokenizer')
      expect(result.tokenizer).toBe('o200k_base')
    })

    it('supports max_chunk_length parameter', async () => {
      const longText = 'Word '.repeat(200)

      const result = await service.segmentText(longText, undefined, true, 100)

      expect(result).toHaveProperty('chunks')
      expect(Array.isArray(result.chunks)).toBe(true)
      if (result.chunks.length > 0) {
        result.chunks.forEach(chunk => {
          expect(chunk.length).toBeLessThanOrEqual(200)
        })
      }
    })
  })
})
