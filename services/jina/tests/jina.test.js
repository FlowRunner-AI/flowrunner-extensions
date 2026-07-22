'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'jina_test-api-key-123'
const API_HOST = 'https://api.jina.ai/v1'
const READER_HOST = 'https://r.jina.ai'
const SEARCH_HOST = 'https://s.jina.ai'
const DEEPSEARCH_HOST = 'https://deepsearch.jina.ai/v1'

describe('Jina AI Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ apiKey: API_KEY })
    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()
  })

  afterEach(() => {
    mock.reset()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Registration ──

  describe('service registration', () => {
    it('registers with correct config items', () => {
      expect(sandbox.getConfigItems()).toEqual([
        expect.objectContaining({
          name: 'apiKey',
          required: true,
          shared: false,
          type: 'STRING',
        }),
      ])
    })
  })

  // ── Embeddings ──

  describe('createEmbeddings', () => {
    it('sends correct request with required params only', async () => {
      const response = {
        model: 'jina-embeddings-v3',
        object: 'list',
        usage: { total_tokens: 8, prompt_tokens: 8 },
        data: [{ object: 'embedding', index: 0, embedding: [0.017, -0.041, 0.052] }],
      }
      mock.onPost(`${ API_HOST }/embeddings`).reply(response)

      const result = await service.createEmbeddings(['Hello world'])

      expect(result).toEqual(response)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({
        'Authorization': `Bearer ${ API_KEY }`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      })
      expect(mock.history[0].body).toEqual({
        model: 'jina-embeddings-v3',
        input: ['Hello world'],
      })
    })

    it('wraps single string input into array', async () => {
      mock.onPost(`${ API_HOST }/embeddings`).reply({ data: [] })

      await service.createEmbeddings('single text')

      expect(mock.history[0].body.input).toEqual(['single text'])
    })

    it('passes array input as-is', async () => {
      mock.onPost(`${ API_HOST }/embeddings`).reply({ data: [] })

      await service.createEmbeddings(['text1', 'text2'])

      expect(mock.history[0].body.input).toEqual(['text1', 'text2'])
    })

    it('uses custom model when provided', async () => {
      mock.onPost(`${ API_HOST }/embeddings`).reply({ data: [] })

      await service.createEmbeddings(['test'], 'jina-clip-v2')

      expect(mock.history[0].body.model).toBe('jina-clip-v2')
    })

    it('resolves task choice values', async () => {
      const taskMappings = {
        'Retrieval Query': 'retrieval.query',
        'Retrieval Passage': 'retrieval.passage',
        'Text Matching': 'text-matching',
        'Classification': 'classification',
        'Separation': 'separation',
      }

      for (const [display, api] of Object.entries(taskMappings)) {
        mock.onPost(`${ API_HOST }/embeddings`).reply({ data: [] })

        await service.createEmbeddings(['test'], undefined, display)

        expect(mock.history[mock.history.length - 1].body.task).toBe(api)
      }
    })

    it('includes dimensions when provided', async () => {
      mock.onPost(`${ API_HOST }/embeddings`).reply({ data: [] })

      await service.createEmbeddings(['test'], undefined, undefined, 256)

      expect(mock.history[0].body.dimensions).toBe(256)
    })

    it('includes late_chunking as boolean when provided', async () => {
      mock.onPost(`${ API_HOST }/embeddings`).reply({ data: [] })

      await service.createEmbeddings(['test'], undefined, undefined, undefined, true)

      expect(mock.history[0].body.late_chunking).toBe(true)
    })

    it('resolves embedding type choice values', async () => {
      const typeMappings = {
        'Float': 'float',
        'Base64': 'base64',
        'Binary': 'binary',
        'Ubinary': 'ubinary',
      }

      for (const [display, api] of Object.entries(typeMappings)) {
        mock.onPost(`${ API_HOST }/embeddings`).reply({ data: [] })

        await service.createEmbeddings(['test'], undefined, undefined, undefined, undefined, display)

        expect(mock.history[mock.history.length - 1].body.embedding_type).toBe(api)
      }
    })

    it('includes all optional params when provided', async () => {
      mock.onPost(`${ API_HOST }/embeddings`).reply({ data: [] })

      await service.createEmbeddings(
        ['test'],
        'jina-clip-v2',
        'Text Matching',
        512,
        true,
        'Base64',
      )

      expect(mock.history[0].body).toEqual({
        model: 'jina-clip-v2',
        input: ['test'],
        task: 'text-matching',
        dimensions: 512,
        late_chunking: true,
        embedding_type: 'base64',
      })
    })

    it('omits optional fields when not provided', async () => {
      mock.onPost(`${ API_HOST }/embeddings`).reply({ data: [] })

      await service.createEmbeddings(['test'])

      const body = mock.history[0].body
      expect(body).not.toHaveProperty('task')
      expect(body).not.toHaveProperty('dimensions')
      expect(body).not.toHaveProperty('late_chunking')
      expect(body).not.toHaveProperty('embedding_type')
    })

    it('throws on API error', async () => {
      mock.onPost(`${ API_HOST }/embeddings`).replyWithError({
        message: 'Unauthorized',
        body: { detail: 'Invalid API key' },
      })

      await expect(service.createEmbeddings(['test'])).rejects.toThrow('Jina AI API error: Invalid API key')
    })
  })

  // ── Reranking ──

  describe('rerankDocuments', () => {
    it('sends correct request with required params only', async () => {
      const response = {
        model: 'jina-reranker-v2-base-multilingual',
        usage: { total_tokens: 38 },
        results: [{ index: 0, relevance_score: 0.92, document: { text: 'Paris is the capital.' } }],
      }
      mock.onPost(`${ API_HOST }/rerank`).reply(response)

      const result = await service.rerankDocuments('capital of France', ['Paris is the capital.', 'Berlin is large.'])

      expect(result).toEqual(response)
      expect(mock.history[0].body).toEqual({
        model: 'jina-reranker-v2-base-multilingual',
        query: 'capital of France',
        documents: ['Paris is the capital.', 'Berlin is large.'],
      })
    })

    it('wraps single document string into array', async () => {
      mock.onPost(`${ API_HOST }/rerank`).reply({ results: [] })

      await service.rerankDocuments('query', 'single doc')

      expect(mock.history[0].body.documents).toEqual(['single doc'])
    })

    it('uses custom model when provided', async () => {
      mock.onPost(`${ API_HOST }/rerank`).reply({ results: [] })

      await service.rerankDocuments('query', ['doc1'], 'custom-reranker')

      expect(mock.history[0].body.model).toBe('custom-reranker')
    })

    it('includes topN when provided', async () => {
      mock.onPost(`${ API_HOST }/rerank`).reply({ results: [] })

      await service.rerankDocuments('query', ['doc1', 'doc2', 'doc3'], undefined, 2)

      expect(mock.history[0].body.top_n).toBe(2)
    })

    it('includes return_documents as boolean when provided', async () => {
      mock.onPost(`${ API_HOST }/rerank`).reply({ results: [] })

      await service.rerankDocuments('query', ['doc1'], undefined, undefined, false)

      expect(mock.history[0].body.return_documents).toBe(false)
    })

    it('omits optional fields when not provided', async () => {
      mock.onPost(`${ API_HOST }/rerank`).reply({ results: [] })

      await service.rerankDocuments('query', ['doc1'])

      const body = mock.history[0].body
      expect(body).not.toHaveProperty('top_n')
      expect(body).not.toHaveProperty('return_documents')
    })

    it('throws on API error', async () => {
      mock.onPost(`${ API_HOST }/rerank`).replyWithError({
        message: 'Bad Request',
        body: { detail: 'Invalid input' },
      })

      await expect(service.rerankDocuments('q', ['d'])).rejects.toThrow('Jina AI API error: Invalid input')
    })
  })

  // ── Reader ──

  describe('readUrl', () => {
    it('sends correct request with required params only', async () => {
      const response = {
        code: 200,
        status: 20000,
        data: { title: 'Example', url: 'https://example.com', content: '# Example' },
      }
      mock.onPost(`${ READER_HOST }/`).reply(response)

      const result = await service.readUrl('https://example.com')

      expect(result).toEqual(response)
      expect(mock.history[0].body).toEqual({ url: 'https://example.com' })
      expect(mock.history[0].headers).toMatchObject({
        'Authorization': `Bearer ${ API_KEY }`,
      })
    })

    it('resolves return format choice values', async () => {
      const formatMappings = {
        'Markdown': 'markdown',
        'HTML': 'html',
        'Text': 'text',
        'Screenshot': 'screenshot',
      }

      for (const [display, api] of Object.entries(formatMappings)) {
        mock.onPost(`${ READER_HOST }/`).reply({ data: {} })

        await service.readUrl('https://example.com', display)

        expect(mock.history[mock.history.length - 1].headers['X-Return-Format']).toBe(api)
      }
    })

    it('sets X-With-Links-Summary header when enabled', async () => {
      mock.onPost(`${ READER_HOST }/`).reply({ data: {} })

      await service.readUrl('https://example.com', undefined, true)

      expect(mock.history[0].headers['X-With-Links-Summary']).toBe('true')
    })

    it('does not set links summary header when disabled', async () => {
      mock.onPost(`${ READER_HOST }/`).reply({ data: {} })

      await service.readUrl('https://example.com', undefined, false)

      expect(mock.history[0].headers['X-With-Links-Summary']).toBeUndefined()
    })

    it('sets X-With-Images-Summary header when enabled', async () => {
      mock.onPost(`${ READER_HOST }/`).reply({ data: {} })

      await service.readUrl('https://example.com', undefined, undefined, true)

      expect(mock.history[0].headers['X-With-Images-Summary']).toBe('true')
    })

    it('sets X-Target-Selector header when provided', async () => {
      mock.onPost(`${ READER_HOST }/`).reply({ data: {} })

      await service.readUrl('https://example.com', undefined, undefined, undefined, '#main')

      expect(mock.history[0].headers['X-Target-Selector']).toBe('#main')
    })

    it('includes all optional headers when provided', async () => {
      mock.onPost(`${ READER_HOST }/`).reply({ data: {} })

      await service.readUrl('https://example.com', 'HTML', true, true, 'article')

      const headers = mock.history[0].headers
      expect(headers['X-Return-Format']).toBe('html')
      expect(headers['X-With-Links-Summary']).toBe('true')
      expect(headers['X-With-Images-Summary']).toBe('true')
      expect(headers['X-Target-Selector']).toBe('article')
    })

    it('throws on API error', async () => {
      mock.onPost(`${ READER_HOST }/`).replyWithError({
        message: 'Not Found',
        body: { message: 'URL not accessible' },
      })

      await expect(service.readUrl('https://example.com')).rejects.toThrow('Jina AI API error: URL not accessible')
    })
  })

  // ── Search Web ──

  describe('searchWeb', () => {
    it('sends correct request with required params only', async () => {
      const response = {
        code: 200,
        status: 20000,
        data: [{ title: 'Result', url: 'https://example.com', content: '# Result' }],
      }
      mock.onPost(`${ SEARCH_HOST }/`).reply(response)

      const result = await service.searchWeb('test query')

      expect(result).toEqual(response)
      expect(mock.history[0].body).toEqual({ q: 'test query' })
      expect(mock.history[0].headers).toMatchObject({
        'Authorization': `Bearer ${ API_KEY }`,
      })
    })

    it('resolves return format choice values', async () => {
      const formatMappings = {
        'Markdown': 'markdown',
        'HTML': 'html',
        'Text': 'text',
      }

      for (const [display, api] of Object.entries(formatMappings)) {
        mock.onPost(`${ SEARCH_HOST }/`).reply({ data: [] })

        await service.searchWeb('test', display)

        expect(mock.history[mock.history.length - 1].headers['X-Return-Format']).toBe(api)
      }
    })

    it('sets X-Site header when site is provided', async () => {
      mock.onPost(`${ SEARCH_HOST }/`).reply({ data: [] })

      await service.searchWeb('test', undefined, 'jina.ai')

      expect(mock.history[0].headers['X-Site']).toBe('jina.ai')
    })

    it('omits optional headers when not provided', async () => {
      mock.onPost(`${ SEARCH_HOST }/`).reply({ data: [] })

      await service.searchWeb('test')

      expect(mock.history[0].headers['X-Return-Format']).toBeUndefined()
      expect(mock.history[0].headers['X-Site']).toBeUndefined()
    })

    it('throws on API error', async () => {
      mock.onPost(`${ SEARCH_HOST }/`).replyWithError({
        message: 'Server Error',
        body: { detail: 'Search failed' },
      })

      await expect(service.searchWeb('test')).rejects.toThrow('Jina AI API error: Search failed')
    })
  })

  // ── Classification ──

  describe('classifyTexts', () => {
    it('sends correct request with required params only', async () => {
      const response = {
        usage: { total_tokens: 19 },
        data: [{ index: 0, prediction: 'positive', score: 0.81 }],
      }
      mock.onPost(`${ API_HOST }/classify`).reply(response)

      const result = await service.classifyTexts(['Great product!'], ['positive', 'negative'])

      expect(result).toEqual(response)
      expect(mock.history[0].body).toEqual({
        model: 'jina-embeddings-v3',
        input: ['Great product!'],
        labels: ['positive', 'negative'],
      })
    })

    it('wraps single string input into array', async () => {
      mock.onPost(`${ API_HOST }/classify`).reply({ data: [] })

      await service.classifyTexts('single text', ['label1'])

      expect(mock.history[0].body.input).toEqual(['single text'])
    })

    it('wraps single label string into array', async () => {
      mock.onPost(`${ API_HOST }/classify`).reply({ data: [] })

      await service.classifyTexts(['text'], 'single-label')

      expect(mock.history[0].body.labels).toEqual(['single-label'])
    })

    it('uses custom model when provided', async () => {
      mock.onPost(`${ API_HOST }/classify`).reply({ data: [] })

      await service.classifyTexts(['text'], ['label'], 'custom-model')

      expect(mock.history[0].body.model).toBe('custom-model')
    })

    it('throws on API error', async () => {
      mock.onPost(`${ API_HOST }/classify`).replyWithError({
        message: 'Bad Request',
        body: { detail: 'Invalid labels' },
      })

      await expect(service.classifyTexts(['text'], ['label'])).rejects.toThrow('Jina AI API error: Invalid labels')
    })
  })

  // ── Segmentation ──

  describe('segmentText', () => {
    it('sends correct request with required params only', async () => {
      const response = {
        num_tokens: 120,
        tokenizer: 'cl100k_base',
        num_chunks: 2,
        chunks: ['First chunk', 'Second chunk'],
      }
      mock.onPost(`${ API_HOST }/segment`).reply(response)

      const result = await service.segmentText('A long text to segment.')

      expect(result).toEqual(response)
      expect(mock.history[0].body).toEqual({
        content: 'A long text to segment.',
        return_chunks: true,
      })
    })

    it('resolves tokenizer choice values', async () => {
      const tokenizerMappings = {
        'Cl100k Base': 'cl100k_base',
        'O200k Base': 'o200k_base',
        'P50k Base': 'p50k_base',
        'R50k Base': 'r50k_base',
        'Gpt2': 'gpt2',
        'Llama3': 'llama3',
      }

      for (const [display, api] of Object.entries(tokenizerMappings)) {
        mock.onPost(`${ API_HOST }/segment`).reply({ num_tokens: 10 })

        await service.segmentText('text', display)

        expect(mock.history[mock.history.length - 1].body.tokenizer).toBe(api)
      }
    })

    it('sets return_chunks to true by default', async () => {
      mock.onPost(`${ API_HOST }/segment`).reply({ num_tokens: 10 })

      await service.segmentText('text')

      expect(mock.history[0].body.return_chunks).toBe(true)
    })

    it('sets return_chunks to false when explicitly disabled', async () => {
      mock.onPost(`${ API_HOST }/segment`).reply({ num_tokens: 10 })

      await service.segmentText('text', undefined, false)

      expect(mock.history[0].body.return_chunks).toBe(false)
    })

    it('includes max_chunk_length when provided', async () => {
      mock.onPost(`${ API_HOST }/segment`).reply({ num_tokens: 10 })

      await service.segmentText('text', undefined, undefined, 500)

      expect(mock.history[0].body.max_chunk_length).toBe(500)
    })

    it('includes all optional params when provided', async () => {
      mock.onPost(`${ API_HOST }/segment`).reply({ num_tokens: 10 })

      await service.segmentText('long text', 'O200k Base', true, 2000)

      expect(mock.history[0].body).toEqual({
        content: 'long text',
        tokenizer: 'o200k_base',
        return_chunks: true,
        max_chunk_length: 2000,
      })
    })

    it('omits optional fields when not provided', async () => {
      mock.onPost(`${ API_HOST }/segment`).reply({ num_tokens: 10 })

      await service.segmentText('text')

      const body = mock.history[0].body
      expect(body).not.toHaveProperty('tokenizer')
      expect(body).not.toHaveProperty('max_chunk_length')
    })

    it('throws on API error', async () => {
      mock.onPost(`${ API_HOST }/segment`).replyWithError({
        message: 'Server Error',
        body: { message: 'Segmentation failed' },
      })

      await expect(service.segmentText('text')).rejects.toThrow('Jina AI API error: Segmentation failed')
    })
  })

  // ── Deep Search ──

  describe('deepSearch', () => {
    it('sends correct request with required params only', async () => {
      const response = {
        id: 'chatcmpl-abc',
        object: 'chat.completion',
        model: 'jina-deepsearch-v1',
        choices: [{ index: 0, message: { role: 'assistant', content: 'Answer' }, finish_reason: 'stop' }],
        usage: { total_tokens: 100 },
      }
      mock.onPost(`${ DEEPSEARCH_HOST }/chat/completions`).reply(response)

      const result = await service.deepSearch('What is Jina AI?')

      expect(result).toEqual(response)
      expect(mock.history[0].body).toEqual({
        model: 'jina-deepsearch-v1',
        messages: [{ role: 'user', content: 'What is Jina AI?' }],
        stream: false,
      })
    })

    it('includes system prompt when provided', async () => {
      mock.onPost(`${ DEEPSEARCH_HOST }/chat/completions`).reply({ choices: [] })

      await service.deepSearch('query', 'Be concise')

      expect(mock.history[0].body.messages).toEqual([
        { role: 'system', content: 'Be concise' },
        { role: 'user', content: 'query' },
      ])
    })

    it('omits system message when systemPrompt is not provided', async () => {
      mock.onPost(`${ DEEPSEARCH_HOST }/chat/completions`).reply({ choices: [] })

      await service.deepSearch('query')

      expect(mock.history[0].body.messages).toEqual([
        { role: 'user', content: 'query' },
      ])
    })

    it('uses custom model when provided', async () => {
      mock.onPost(`${ DEEPSEARCH_HOST }/chat/completions`).reply({ choices: [] })

      await service.deepSearch('query', undefined, 'custom-deepsearch')

      expect(mock.history[0].body.model).toBe('custom-deepsearch')
    })

    it('always sets stream to false', async () => {
      mock.onPost(`${ DEEPSEARCH_HOST }/chat/completions`).reply({ choices: [] })

      await service.deepSearch('query')

      expect(mock.history[0].body.stream).toBe(false)
    })

    it('throws on API error', async () => {
      mock.onPost(`${ DEEPSEARCH_HOST }/chat/completions`).replyWithError({
        message: 'Rate limited',
        body: { detail: 'Too many requests' },
      })

      await expect(service.deepSearch('query')).rejects.toThrow('Jina AI API error: Too many requests')
    })
  })

  // ── Error Handling ──

  describe('error handling', () => {
    it('extracts error from body.detail', async () => {
      mock.onPost(`${ API_HOST }/embeddings`).replyWithError({
        message: 'Bad Request',
        body: { detail: 'Missing required field' },
      })

      await expect(service.createEmbeddings(['test'])).rejects.toThrow('Jina AI API error: Missing required field')
    })

    it('extracts error from body.message when detail is missing', async () => {
      mock.onPost(`${ API_HOST }/embeddings`).replyWithError({
        message: 'Forbidden',
        body: { message: 'Insufficient credits' },
      })

      await expect(service.createEmbeddings(['test'])).rejects.toThrow('Jina AI API error: Insufficient credits')
    })

    it('falls back to error.message string', async () => {
      mock.onPost(`${ API_HOST }/embeddings`).replyWithError({
        message: 'Network error',
      })

      await expect(service.createEmbeddings(['test'])).rejects.toThrow('Jina AI API error: Network error')
    })

    it('stringifies non-string error.message', async () => {
      mock.onPost(`${ API_HOST }/embeddings`).replyWithError({
        message: { code: 500, text: 'Internal error' },
      })

      await expect(service.createEmbeddings(['test'])).rejects.toThrow('Jina AI API error:')
    })
  })
})
