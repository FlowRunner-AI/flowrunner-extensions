'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-api-key'
const BASE = 'https://api.cohere.com'

describe('Cohere Service', () => {
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
          displayName: 'API Key',
          required: true,
          shared: false,
          type: 'STRING',
        }),
      ])
    })

    it('sends the Bearer Authorization header on JSON requests', async () => {
      mock.onGet(`${ BASE }/v1/models/command-a`).reply({ name: 'command-a' })

      await service.getModel('command-a')

      expect(mock.history[0].headers).toMatchObject({
        'Authorization': `Bearer ${ API_KEY }`,
      })
    })

    it('sets the JSON Content-Type header when a body is sent', async () => {
      mock.onPost(`${ BASE }/v2/chat`).reply({ id: 'c1', message: { content: [] } })

      await service.chat('Hi')

      expect(mock.history[0].headers).toMatchObject({
        'Authorization': `Bearer ${ API_KEY }`,
        'Content-Type': 'application/json',
      })
    })
  })

  // ── Dictionary Methods ──

  describe('getModelsDictionary', () => {
    it('requests /v1/models with page_size and no endpoint, maps and sorts non-deprecated models', async () => {
      mock.onGet(`${ BASE }/v1/models`).reply({
        models: [
          { name: 'command-b', endpoints: ['chat'], context_length: 4096, is_deprecated: false },
          { name: 'command-a', endpoints: ['chat', 'embed'], context_length: 128000, is_deprecated: false },
          { name: 'old-model', endpoints: ['chat'], is_deprecated: true },
        ],
        next_page_token: null,
      })

      const result = await service.getModelsDictionary({})

      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/v1/models`)
      expect(mock.history[0].query).toEqual({ page_size: 100 })
      expect(result.items).toEqual([
        { label: 'command-a', value: 'command-a', note: 'chat, embed · 128000 ctx' },
        { label: 'command-b', value: 'command-b', note: 'chat · 4096 ctx' },
      ])
      expect(result.cursor).toBeNull()
    })

    it('filters by search term (case-insensitive)', async () => {
      mock.onGet(`${ BASE }/v1/models`).reply({
        models: [
          { name: 'command-a', endpoints: ['chat'], is_deprecated: false },
          { name: 'embed-v4.0', endpoints: ['embed'], is_deprecated: false },
        ],
      })

      const result = await service.getModelsDictionary({ search: 'EMBED' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('embed-v4.0')
    })

    it('forwards the cursor as page_token and returns next_page_token as cursor', async () => {
      mock.onGet(`${ BASE }/v1/models`).reply({ models: [], next_page_token: 'tok_2' })

      const result = await service.getModelsDictionary({ cursor: 'tok_1' })

      expect(mock.history[0].query).toEqual({ page_size: 100, page_token: 'tok_1' })
      expect(result.cursor).toBe('tok_2')
    })

    it('handles a null payload and missing models array', async () => {
      mock.onGet(`${ BASE }/v1/models`).reply({})

      const result = await service.getModelsDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('endpoint-scoped model dictionaries', () => {
    const cases = [
      ['getChatModelsDictionary', 'chat'],
      ['getEmbedModelsDictionary', 'embed'],
      ['getRerankModelsDictionary', 'rerank'],
      ['getClassifyModelsDictionary', 'classify'],
    ]

    it.each(cases)('%s adds the endpoint query param', async (methodName, endpoint) => {
      mock.onGet(`${ BASE }/v1/models`).reply({ models: [] })

      await service[methodName]({})

      expect(mock.history[0].query).toEqual({ page_size: 100, endpoint })
    })
  })

  describe('getDatasetsDictionary', () => {
    it('maps datasets to items and hits /v1/datasets', async () => {
      mock.onGet(`${ BASE }/v1/datasets`).reply({
        datasets: [
          { id: 'ds_1', name: 'support-tickets', dataset_type: 'batch-chat-v2-input', validation_status: 'validated' },
          { id: 'ds_2', dataset_type: 'embed-input', validation_status: 'queued' },
        ],
      })

      const result = await service.getDatasetsDictionary({})

      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/v1/datasets`)
      expect(result.items).toEqual([
        { label: 'support-tickets', value: 'ds_1', note: 'batch-chat-v2-input · validated' },
        { label: 'ds_2', value: 'ds_2', note: 'embed-input · queued' },
      ])
      expect(result.cursor).toBeNull()
    })

    it('filters by search over name and id', async () => {
      mock.onGet(`${ BASE }/v1/datasets`).reply({
        datasets: [
          { id: 'ds_1', name: 'support-tickets', dataset_type: 'embed-input' },
          { id: 'abc999', name: 'other', dataset_type: 'embed-input' },
        ],
      })

      const bySearchName = await service.getDatasetsDictionary({ search: 'support' })
      const bySearchId = await service.getDatasetsDictionary({ search: 'abc' })

      expect(bySearchName.items).toHaveLength(1)
      expect(bySearchName.items[0].value).toBe('ds_1')
      expect(bySearchId.items).toHaveLength(1)
      expect(bySearchId.items[0].value).toBe('abc999')
    })

    it('handles a null payload and missing datasets array', async () => {
      mock.onGet(`${ BASE }/v1/datasets`).reply({})

      const result = await service.getDatasetsDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getBatchesDictionary', () => {
    it('maps batches to items with v2 endpoint and pagination', async () => {
      mock.onGet(`${ BASE }/v2/batches`).reply({
        batches: [
          { id: 'batch_1', name: 'Nightly', status: 'BATCH_STATUS_COMPLETED', model: 'command-a-03-2025' },
          { id: 'batch_2', status: 'BATCH_STATUS_QUEUED' },
        ],
        next_page_token: 'nt',
      })

      const result = await service.getBatchesDictionary({ cursor: 'c1' })

      expect(mock.history[0].url).toBe(`${ BASE }/v2/batches`)
      expect(mock.history[0].query).toEqual({ page_size: 100, page_token: 'c1' })
      expect(result.items).toEqual([
        { label: 'Nightly', value: 'batch_1', note: 'BATCH_STATUS_COMPLETED · command-a-03-2025' },
        { label: 'batch_2', value: 'batch_2', note: 'BATCH_STATUS_QUEUED' },
      ])
      expect(result.cursor).toBe('nt')
    })

    it('filters by search and returns null cursor when no next page', async () => {
      mock.onGet(`${ BASE }/v2/batches`).reply({
        batches: [
          { id: 'batch_1', name: 'Nightly', status: 'X' },
          { id: 'batch_2', name: 'Daily', status: 'X' },
        ],
      })

      const result = await service.getBatchesDictionary({ search: 'daily' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('batch_2')
      expect(result.cursor).toBeNull()
    })
  })

  describe('getEmbedJobsDictionary', () => {
    it('maps embed jobs to items using job_id', async () => {
      mock.onGet(`${ BASE }/v1/embed-jobs`).reply({
        embed_jobs: [
          { job_id: 'ej_1', name: 'docs-embeddings', status: 'complete', model: 'embed-v4.0' },
          { job_id: 'ej_2', status: 'processing' },
        ],
      })

      const result = await service.getEmbedJobsDictionary({})

      expect(mock.history[0].url).toBe(`${ BASE }/v1/embed-jobs`)
      expect(result.items).toEqual([
        { label: 'docs-embeddings', value: 'ej_1', note: 'complete · embed-v4.0' },
        { label: 'ej_2', value: 'ej_2', note: 'processing' },
      ])
      expect(result.cursor).toBeNull()
    })

    it('filters by search over name and job_id', async () => {
      mock.onGet(`${ BASE }/v1/embed-jobs`).reply({
        embed_jobs: [
          { job_id: 'ej_1', name: 'docs', status: 'complete' },
          { job_id: 'zz_9', name: 'other', status: 'complete' },
        ],
      })

      const result = await service.getEmbedJobsDictionary({ search: 'zz_9' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('zz_9')
    })
  })

  // ── Chat ──

  describe('chat', () => {
    const chatResponse = {
      id: 'chat_1',
      finish_reason: 'COMPLETE',
      message: {
        content: [
          { type: 'thinking', thinking: 'reasoning...' },
          { type: 'text', text: 'Hello there.' },
        ],
      },
      usage: { tokens: { input_tokens: 5, output_tokens: 3 } },
    }

    it('sends required params only and extracts text/thinking from content blocks', async () => {
      mock.onPost(`${ BASE }/v2/chat`).reply(chatResponse)

      const result = await service.chat('Hi')

      expect(mock.history[0].url).toBe(`${ BASE }/v2/chat`)
      expect(mock.history[0].body).toEqual({
        stream: false,
        model: 'command-a-plus-05-2026',
        messages: [{ role: 'user', content: 'Hi' }],
      })
      expect(result).toEqual({
        id: 'chat_1',
        text: 'Hello there.',
        thinking: 'reasoning...',
        finishReason: 'COMPLETE',
        usage: { tokens: { input_tokens: 5, output_tokens: 3 } },
      })
    })

    it('includes the system prompt as the first message and all sampling params', async () => {
      mock.onPost(`${ BASE }/v2/chat`).reply(chatResponse)

      await service.chat(
        'Question',
        'command-r',
        'You are helpful',
        0.5,     // temperature
        256,     // maxTokens
        0.9,     // topP
        40,      // topK
        7,       // seed
        ['STOP'], // stopSequences
        true,    // jsonMode
        'Strict', // safetyMode
        'Enabled', // thinkingMode
        2000     // thinkingTokenBudget
      )

      expect(mock.history[0].body).toEqual({
        stream: false,
        model: 'command-r',
        messages: [
          { role: 'system', content: 'You are helpful' },
          { role: 'user', content: 'Question' },
        ],
        temperature: 0.5,
        max_tokens: 256,
        p: 0.9,
        k: 40,
        seed: 7,
        stop_sequences: ['STOP'],
        response_format: { type: 'json_object' },
        safety_mode: 'STRICT',
        thinking: { type: 'enabled', token_budget: 2000 },
      })
    })

    it('maps Off safety mode and disabled thinking without a token budget', async () => {
      mock.onPost(`${ BASE }/v2/chat`).reply(chatResponse)

      await service.chat(
        'Hi', undefined, undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, false, 'Off', 'Disabled', 5000
      )

      expect(mock.history[0].body.safety_mode).toBe('OFF')
      expect(mock.history[0].body.thinking).toEqual({ type: 'disabled' })
      expect(mock.history[0].body).not.toHaveProperty('response_format')
    })

    it('handles temperature and topK of 0 (falsy but valid)', async () => {
      mock.onPost(`${ BASE }/v2/chat`).reply(chatResponse)

      await service.chat('Hi', undefined, undefined, 0, undefined, undefined, 0)

      expect(mock.history[0].body.temperature).toBe(0)
      expect(mock.history[0].body.k).toBe(0)
    })

    it('returns null thinking when there are no thinking blocks', async () => {
      mock.onPost(`${ BASE }/v2/chat`).reply({
        id: 'chat_2',
        message: { content: [{ type: 'text', text: 'Plain answer' }] },
        finish_reason: 'COMPLETE',
      })

      const result = await service.chat('Hi')

      expect(result.text).toBe('Plain answer')
      expect(result.thinking).toBeNull()
      expect(result.usage).toBeNull()
    })

    it('throws when message is empty', async () => {
      await expect(service.chat('   ')).rejects.toThrow('Message is required')
      expect(mock.history).toHaveLength(0)
    })

    it('wraps API errors', async () => {
      mock.onPost(`${ BASE }/v2/chat`).replyWithError({ message: 'model not found' })

      await expect(service.chat('Hi')).rejects.toThrow('Cohere API error: model not found')
    })
  })

  describe('chatAdvanced', () => {
    const rawResponse = {
      id: 'adv_1',
      finish_reason: 'COMPLETE',
      message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
    }

    it('sends required messages only and returns the raw response', async () => {
      mock.onPost(`${ BASE }/v2/chat`).reply(rawResponse)

      const messages = [{ role: 'user', content: 'Hi' }]
      const result = await service.chatAdvanced(messages)

      expect(mock.history[0].body).toEqual({
        stream: false,
        model: 'command-a-plus-05-2026',
        messages,
      })
      expect(result).toEqual(rawResponse)
    })

    it('includes tools, choices, documents, response format and penalties', async () => {
      mock.onPost(`${ BASE }/v2/chat`).reply(rawResponse)

      const messages = [{ role: 'user', content: 'Hi' }]
      const tools = [{ type: 'function', function: { name: 'f' } }]
      const documents = [{ id: 'd1', data: { text: 'x' } }]
      const responseFormat = { type: 'json_object' }
      const thinking = { type: 'enabled', token_budget: 100 }

      await service.chatAdvanced(
        messages,
        'command-r',
        tools,
        true,        // strictTools
        'Required',  // toolChoice
        documents,
        responseFormat,
        'Accurate',  // citationMode
        0.4,         // temperature
        512,         // maxTokens
        0.8,         // topP
        20,          // topK
        11,          // seed
        ['END'],     // stopSequences
        0.5,         // frequencyPenalty
        0.6,         // presencePenalty
        'Contextual', // safetyMode
        thinking,
        true         // logprobs
      )

      expect(mock.history[0].body).toEqual({
        stream: false,
        model: 'command-r',
        messages,
        tools,
        strict_tools: true,
        documents,
        response_format: responseFormat,
        temperature: 0.4,
        max_tokens: 512,
        p: 0.8,
        k: 20,
        seed: 11,
        stop_sequences: ['END'],
        frequency_penalty: 0.5,
        presence_penalty: 0.6,
        thinking,
        logprobs: true,
        tool_choice: 'REQUIRED',
        citation_options: { mode: 'ACCURATE' },
        safety_mode: 'CONTEXTUAL',
      })
    })

    it('maps tool choice None and includes strict_tools false', async () => {
      mock.onPost(`${ BASE }/v2/chat`).reply(rawResponse)

      await service.chatAdvanced([{ role: 'user', content: 'Hi' }], undefined, undefined, false, 'None')

      expect(mock.history[0].body.strict_tools).toBe(false)
      expect(mock.history[0].body.tool_choice).toBe('NONE')
    })

    it('throws when messages array is empty', async () => {
      await expect(service.chatAdvanced([])).rejects.toThrow(
        'Messages array is required and must not be empty'
      )
      expect(mock.history).toHaveLength(0)
    })

    it('wraps API errors', async () => {
      mock.onPost(`${ BASE }/v2/chat`).replyWithError({ message: 'bad request' })

      await expect(service.chatAdvanced([{ role: 'user', content: 'Hi' }])).rejects.toThrow(
        'Cohere API error: bad request'
      )
    })
  })

  describe('chatWithDocuments', () => {
    const docsResponse = {
      id: 'doc_1',
      finish_reason: 'COMPLETE',
      message: {
        content: [{ type: 'text', text: 'Revenue grew 25%.' }],
        citations: [{ start: 0, end: 5, text: 'Reven', sources: [] }],
      },
      usage: { tokens: { input_tokens: 100, output_tokens: 5 } },
    }

    it('sends message + documents with defaults and surfaces citations', async () => {
      mock.onPost(`${ BASE }/v2/chat`).reply(docsResponse)

      const documents = [{ id: 'd1', data: { title: 'Q2', text: 'Revenue grew 25%' } }]
      const result = await service.chatWithDocuments('How did revenue change?', documents)

      expect(mock.history[0].body).toEqual({
        stream: false,
        model: 'command-a-plus-05-2026',
        messages: [{ role: 'user', content: 'How did revenue change?' }],
        documents,
      })
      expect(result).toEqual({
        id: 'doc_1',
        text: 'Revenue grew 25%.',
        citations: [{ start: 0, end: 5, text: 'Reven', sources: [] }],
        finishReason: 'COMPLETE',
        usage: { tokens: { input_tokens: 100, output_tokens: 5 } },
      })
    })

    it('includes system prompt, model, citation mode and sampling', async () => {
      mock.onPost(`${ BASE }/v2/chat`).reply(docsResponse)

      await service.chatWithDocuments(
        'Q',
        ['doc text'],
        'command-r',
        'Fast',
        'Answer only from docs',
        0.2,
        128
      )

      expect(mock.history[0].body).toEqual({
        stream: false,
        model: 'command-r',
        messages: [
          { role: 'system', content: 'Answer only from docs' },
          { role: 'user', content: 'Q' },
        ],
        documents: ['doc text'],
        temperature: 0.2,
        max_tokens: 128,
        citation_options: { mode: 'FAST' },
      })
    })

    it('defaults citations to an empty array when absent', async () => {
      mock.onPost(`${ BASE }/v2/chat`).reply({
        id: 'doc_2',
        message: { content: [{ type: 'text', text: 'a' }] },
        finish_reason: 'COMPLETE',
      })

      const result = await service.chatWithDocuments('Q', ['d'])

      expect(result.citations).toEqual([])
    })

    it('throws when message is empty', async () => {
      await expect(service.chatWithDocuments('', ['d'])).rejects.toThrow('Message is required')
    })

    it('throws when no documents are provided', async () => {
      await expect(service.chatWithDocuments('Q', [])).rejects.toThrow(
        'At least one document is required'
      )
    })
  })

  // ── Embeddings ──

  describe('createEmbeddings', () => {
    const embedResponse = { id: 'emb_1', embeddings: { float: [[0.1, 0.2]] } }

    it('sends texts with default model and default input_type', async () => {
      mock.onPost(`${ BASE }/v2/embed`).reply(embedResponse)

      const result = await service.createEmbeddings(['hello world'])

      expect(mock.history[0].url).toBe(`${ BASE }/v2/embed`)
      expect(mock.history[0].body).toEqual({
        model: 'embed-v4.0',
        input_type: 'search_document',
        texts: ['hello world'],
      })
      expect(result).toEqual(embedResponse)
    })

    it('maps input type, embedding types, truncate and includes images/inputs/dimension', async () => {
      mock.onPost(`${ BASE }/v2/embed`).reply(embedResponse)

      await service.createEmbeddings(
        ['t'],
        'embed-multilingual-v3.0',
        'Search Query',
        ['Float', 'Int8'],
        1024,
        ['data:image/png;base64,AAAA'],
        [{ content: [{ type: 'text', text: 'x' }] }],
        'End',
        512
      )

      expect(mock.history[0].body).toEqual({
        model: 'embed-multilingual-v3.0',
        input_type: 'search_query',
        texts: ['t'],
        images: ['data:image/png;base64,AAAA'],
        inputs: [{ content: [{ type: 'text', text: 'x' }] }],
        output_dimension: 1024,
        max_tokens: 512,
        embedding_types: ['float', 'int8'],
        truncate: 'END',
      })
    })

    it('accepts images only (no texts)', async () => {
      mock.onPost(`${ BASE }/v2/embed`).reply(embedResponse)

      await service.createEmbeddings(undefined, undefined, 'Image', undefined, undefined, [
        'data:image/png;base64,BBBB',
      ])

      expect(mock.history[0].body.images).toEqual(['data:image/png;base64,BBBB'])
      expect(mock.history[0].body.input_type).toBe('image')
      expect(mock.history[0].body).not.toHaveProperty('texts')
    })

    it('throws when no texts, images or inputs are provided', async () => {
      await expect(service.createEmbeddings()).rejects.toThrow(
        'At least one of Texts, Images or Structured Inputs is required'
      )
      expect(mock.history).toHaveLength(0)
    })

    it('wraps API errors', async () => {
      mock.onPost(`${ BASE }/v2/embed`).replyWithError({ message: 'too many texts' })

      await expect(service.createEmbeddings(['t'])).rejects.toThrow(
        'Cohere API error: too many texts'
      )
    })
  })

  // ── Rerank ──

  describe('rerankDocuments', () => {
    it('sends query + documents with defaults and enriches results with document text', async () => {
      mock.onPost(`${ BASE }/v2/rerank`).reply({
        id: 'rr_1',
        results: [
          { index: 2, relevance_score: 0.98 },
          { index: 0, relevance_score: 0.4 },
        ],
      })

      const documents = ['first', 'second', 'third']
      const result = await service.rerankDocuments('query', documents)

      expect(mock.history[0].url).toBe(`${ BASE }/v2/rerank`)
      expect(mock.history[0].body).toEqual({
        model: 'rerank-v4.0-pro',
        query: 'query',
        documents,
      })
      expect(result.results).toEqual([
        { index: 2, relevance_score: 0.98, document: 'third' },
        { index: 0, relevance_score: 0.4, document: 'first' },
      ])
    })

    it('includes model, top_n and max_tokens_per_doc', async () => {
      mock.onPost(`${ BASE }/v2/rerank`).reply({ id: 'rr_2', results: [] })

      await service.rerankDocuments('q', ['a', 'b'], 'rerank-v4.0-fast', 1, 2048)

      expect(mock.history[0].body).toEqual({
        model: 'rerank-v4.0-fast',
        query: 'q',
        documents: ['a', 'b'],
        top_n: 1,
        max_tokens_per_doc: 2048,
      })
    })

    it('sets document to null when an index is out of range', async () => {
      mock.onPost(`${ BASE }/v2/rerank`).reply({ results: [{ index: 9, relevance_score: 0.1 }] })

      const result = await service.rerankDocuments('q', ['only'])

      expect(result.results[0].document).toBeNull()
    })

    it('throws when query is empty', async () => {
      await expect(service.rerankDocuments('  ', ['a'])).rejects.toThrow('Query is required')
    })

    it('throws when documents are empty', async () => {
      await expect(service.rerankDocuments('q', [])).rejects.toThrow(
        'At least one document is required'
      )
    })
  })

  // ── Classification ──

  describe('classifyText', () => {
    const classifyResponse = { id: 'cl_1', classifications: [{ prediction: 'positive' }] }

    it('sends inputs + examples and maps truncate to /v1/classify', async () => {
      mock.onPost(`${ BASE }/v1/classify`).reply(classifyResponse)

      const examples = [
        { text: 'I love it', label: 'positive' },
        { text: 'Terrible', label: 'negative' },
      ]
      const result = await service.classifyText(['great'], examples, undefined, 'Start')

      expect(mock.history[0].url).toBe(`${ BASE }/v1/classify`)
      expect(mock.history[0].body).toEqual({
        inputs: ['great'],
        examples,
        truncate: 'START',
      })
      expect(result).toEqual(classifyResponse)
    })

    it('sends a fine-tuned model without examples', async () => {
      mock.onPost(`${ BASE }/v1/classify`).reply(classifyResponse)

      await service.classifyText(['great'], undefined, 'ft-model-123')

      expect(mock.history[0].body).toEqual({
        inputs: ['great'],
        model: 'ft-model-123',
      })
    })

    it('throws when no inputs are provided', async () => {
      await expect(service.classifyText([])).rejects.toThrow('At least one input text is required')
    })

    it('throws when neither examples nor a model are provided', async () => {
      await expect(service.classifyText(['x'])).rejects.toThrow(
        'Either Examples or a fine-tuned classification Model is required'
      )
    })
  })

  // ── Tokenization ──

  describe('tokenizeText', () => {
    it('sends text with default model', async () => {
      mock.onPost(`${ BASE }/v1/tokenize`).reply({ tokens: [1, 2], token_strings: ['a', 'b'] })

      const result = await service.tokenizeText('tokenize me')

      expect(mock.history[0].url).toBe(`${ BASE }/v1/tokenize`)
      expect(mock.history[0].body).toEqual({ text: 'tokenize me', model: 'command-a-plus-05-2026' })
      expect(result).toEqual({ tokens: [1, 2], token_strings: ['a', 'b'] })
    })

    it('uses a provided model', async () => {
      mock.onPost(`${ BASE }/v1/tokenize`).reply({ tokens: [] })

      await service.tokenizeText('x', 'command-r')

      expect(mock.history[0].body.model).toBe('command-r')
    })

    it('throws when text is missing', async () => {
      await expect(service.tokenizeText('')).rejects.toThrow('Text is required')
    })
  })

  describe('detokenizeText', () => {
    it('sends tokens with default model', async () => {
      mock.onPost(`${ BASE }/v1/detokenize`).reply({ text: 'tokenize me' })

      const result = await service.detokenizeText([1, 2, 3])

      expect(mock.history[0].url).toBe(`${ BASE }/v1/detokenize`)
      expect(mock.history[0].body).toEqual({ tokens: [1, 2, 3], model: 'command-a-plus-05-2026' })
      expect(result).toEqual({ text: 'tokenize me' })
    })

    it('throws when tokens are empty', async () => {
      await expect(service.detokenizeText([])).rejects.toThrow(
        'Tokens array is required and must not be empty'
      )
    })
  })

  // ── Audio ──

  describe('transcribeAudio', () => {
    it('downloads the file then posts multipart form data', async () => {
      mock.onGet('https://files.example.com/audio.mp3').reply(Buffer.from('AUDIO'))
      mock.onPost(`${ BASE }/v2/audio/transcriptions`).reply({ text: 'transcribed' })

      const result = await service.transcribeAudio(
        'https://files.example.com/audio.mp3',
        'en',
        undefined,
        0.2
      )

      expect(result).toEqual({ text: 'transcribed' })

      // First call: file download with binary encoding
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe('https://files.example.com/audio.mp3')
      expect(mock.history[0].encoding).toBeNull()

      // Second call: multipart POST
      const postCall = mock.history[1]
      expect(postCall.method).toBe('post')
      expect(postCall.url).toBe(`${ BASE }/v2/audio/transcriptions`)
      expect(postCall.headers).toMatchObject({ 'Authorization': `Bearer ${ API_KEY }` })
      expect(postCall.body).toBeUndefined()

      const fields = postCall.formData._fields
      const byName = Object.fromEntries(fields.map(f => [f.name, f]))

      expect(Buffer.isBuffer(byName.file.value)).toBe(true)
      expect(byName.file.filename).toEqual({ filename: 'audio.mp3' })
      expect(byName.model.value).toBe('cohere-transcribe-03-2026')
      expect(byName.language.value).toBe('en')
      expect(byName.temperature.value).toBe('0.2')
    })

    it('uses a provided model and omits temperature when not given', async () => {
      mock.onGet('https://files.example.com/clip.wav').reply(Buffer.from('X'))
      mock.onPost(`${ BASE }/v2/audio/transcriptions`).reply({ text: 'ok' })

      await service.transcribeAudio('https://files.example.com/clip.wav', 'de', 'custom-model')

      const fields = mock.history[1].formData._fields
      const names = fields.map(f => f.name)

      expect(fields.find(f => f.name === 'model').value).toBe('custom-model')
      expect(names).not.toContain('temperature')
    })

    it('throws when language is missing', async () => {
      await expect(service.transcribeAudio('https://x/a.mp3', '  ')).rejects.toThrow(
        'Language is required'
      )
      expect(mock.history).toHaveLength(0)
    })

    it('throws for a non-http file URL', async () => {
      await expect(service.transcribeAudio('ftp://x/a.mp3', 'en')).rejects.toThrow(
        "Invalid fileUrl 'ftp://x/a.mp3'"
      )
    })
  })

  // ── Batches ──

  describe('createBatch', () => {
    it('posts name, input_dataset_id and model to /v2/batches', async () => {
      mock.onPost(`${ BASE }/v2/batches`).reply({ batch: { id: 'batch_1' } })

      const result = await service.createBatch('Nightly', 'ds_1', 'command-a-03-2025')

      expect(mock.history[0].url).toBe(`${ BASE }/v2/batches`)
      expect(mock.history[0].body).toEqual({
        name: 'Nightly',
        input_dataset_id: 'ds_1',
        model: 'command-a-03-2025',
      })
      expect(result).toEqual({ batch: { id: 'batch_1' } })
    })

    it('throws when required fields are missing', async () => {
      await expect(service.createBatch('Nightly', 'ds_1')).rejects.toThrow(
        'Name, Input Dataset and Model are required'
      )
    })
  })

  describe('listBatches', () => {
    it('sends no query params when none provided', async () => {
      mock.onGet(`${ BASE }/v2/batches`).reply({ batches: [] })

      await service.listBatches()

      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].query).toEqual({})
    })

    it('includes page_size and page_token', async () => {
      mock.onGet(`${ BASE }/v2/batches`).reply({ batches: [] })

      await service.listBatches(100, 'tok')

      expect(mock.history[0].query).toEqual({ page_size: 100, page_token: 'tok' })
    })
  })

  describe('getBatch', () => {
    it('gets a batch by id (url-encoded)', async () => {
      mock.onGet(`${ BASE }/v2/batches/batch_1`).reply({ batch: { id: 'batch_1' } })

      const result = await service.getBatch('batch_1')

      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/v2/batches/batch_1`)
      expect(result).toEqual({ batch: { id: 'batch_1' } })
    })

    it('throws when batchId is missing', async () => {
      await expect(service.getBatch()).rejects.toThrow('Batch ID is required')
    })
  })

  describe('cancelBatch', () => {
    it('posts to the :cancel action and returns cancelled flag merged with response', async () => {
      mock.onPost(`${ BASE }/v2/batches/batch_1:cancel`).reply({ status: 'canceling' })

      const result = await service.cancelBatch('batch_1')

      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/v2/batches/batch_1:cancel`)
      expect(mock.history[0].body).toEqual({})
      expect(result).toEqual({ cancelled: true, batchId: 'batch_1', status: 'canceling' })
    })

    it('returns cancelled flag even with a null response', async () => {
      mock.onPost(`${ BASE }/v2/batches/batch_1:cancel`).reply(null)

      const result = await service.cancelBatch('batch_1')

      expect(result).toEqual({ cancelled: true, batchId: 'batch_1' })
    })

    it('throws when batchId is missing', async () => {
      await expect(service.cancelBatch()).rejects.toThrow('Batch ID is required')
    })
  })

  // ── Datasets ──

  describe('createDataset', () => {
    it('uploads file content as multipart form data with mapped type query', async () => {
      mock.onPost(`${ BASE }/v1/datasets`).reply({ id: 'ds_new' })

      const result = await service.createDataset(
        'my-dataset',
        'Batch Chat Input (v2)',
        undefined,
        '{"a":1}\n{"b":2}',
        'inputs.jsonl',
        true,
        false,
        undefined,
        undefined
      )

      expect(result).toEqual({ id: 'ds_new' })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/v1/datasets`)
      expect(mock.history[0].query).toEqual({
        name: 'my-dataset',
        type: 'batch-chat-v2-input',
        skip_malformed_input: true,
        keep_original_file: false,
      })

      const fields = mock.history[0].formData._fields
      expect(fields).toHaveLength(1)
      expect(fields[0].name).toBe('data')
      expect(Buffer.isBuffer(fields[0].value)).toBe(true)
      expect(fields[0].filename).toEqual({ filename: 'inputs.jsonl' })
    })

    it('downloads a file URL and derives the filename from it', async () => {
      mock.onGet('https://files.example.com/data.csv').reply(Buffer.from('a,b'))
      mock.onPost(`${ BASE }/v1/datasets`).reply({ id: 'ds_url' })

      await service.createDataset(
        'csv-dataset',
        'Embed Input',
        'https://files.example.com/data.csv',
        undefined,
        undefined,
        undefined,
        undefined,
        ';',
        ','
      )

      expect(mock.history[0].url).toBe('https://files.example.com/data.csv')
      expect(mock.history[0].encoding).toBeNull()

      const postCall = mock.history[1]
      expect(postCall.query).toEqual({
        name: 'csv-dataset',
        type: 'embed-input',
        text_separator: ';',
        csv_delimiter: ',',
      })
      expect(postCall.formData._fields[0].filename).toEqual({ filename: 'data.csv' })
    })

    it('throws when name is missing', async () => {
      await expect(service.createDataset('  ', 'Embed Input')).rejects.toThrow('Name is required')
    })

    it('throws when neither file URL nor content is provided', async () => {
      await expect(service.createDataset('n', 'Embed Input')).rejects.toThrow(
        'Either File URL or File Content is required'
      )
    })
  })

  describe('listDatasets', () => {
    it('sends no query params when none provided', async () => {
      mock.onGet(`${ BASE }/v1/datasets`).reply({ datasets: [] })

      await service.listDatasets()

      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].query).toEqual({})
    })

    it('maps type and status choices and forwards pagination/date filters', async () => {
      mock.onGet(`${ BASE }/v1/datasets`).reply({ datasets: [] })

      await service.listDatasets(
        'Batch Embed Input (v2)',
        'Validated',
        10,
        20,
        '2026-07-01T00:00:00Z',
        '2026-06-01T00:00:00Z'
      )

      expect(mock.history[0].query).toEqual({
        datasetType: 'batch-embed-v2-input',
        validationStatus: 'validated',
        limit: 10,
        offset: 20,
        before: '2026-07-01T00:00:00Z',
        after: '2026-06-01T00:00:00Z',
      })
    })
  })

  describe('getDataset', () => {
    it('gets a dataset by id', async () => {
      mock.onGet(`${ BASE }/v1/datasets/ds_1`).reply({ dataset: { id: 'ds_1' } })

      const result = await service.getDataset('ds_1')

      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/v1/datasets/ds_1`)
      expect(result).toEqual({ dataset: { id: 'ds_1' } })
    })

    it('throws when datasetId is missing', async () => {
      await expect(service.getDataset()).rejects.toThrow('Dataset ID is required')
    })
  })

  describe('deleteDataset', () => {
    it('deletes a dataset and returns the deleted flag', async () => {
      mock.onDelete(`${ BASE }/v1/datasets/ds_1`).reply({})

      const result = await service.deleteDataset('ds_1')

      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${ BASE }/v1/datasets/ds_1`)
      expect(result).toEqual({ deleted: true, datasetId: 'ds_1' })
    })

    it('throws when datasetId is missing', async () => {
      await expect(service.deleteDataset()).rejects.toThrow('Dataset ID is required')
    })
  })

  describe('getDatasetUsage', () => {
    it('gets organization usage', async () => {
      mock.onGet(`${ BASE }/v1/datasets/usage`).reply({ organization_usage: 8000000 })

      const result = await service.getDatasetUsage()

      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/v1/datasets/usage`)
      expect(result).toEqual({ organization_usage: 8000000 })
    })
  })

  // ── Embed Jobs ──

  describe('createEmbedJob', () => {
    it('posts dataset_id with default model and input_type', async () => {
      mock.onPost(`${ BASE }/v1/embed-jobs`).reply({ job_id: 'ej_1' })

      const result = await service.createEmbedJob('ds_1')

      expect(mock.history[0].url).toBe(`${ BASE }/v1/embed-jobs`)
      expect(mock.history[0].body).toEqual({
        dataset_id: 'ds_1',
        model: 'embed-v4.0',
        input_type: 'search_document',
      })
      expect(result).toEqual({ job_id: 'ej_1' })
    })

    it('includes name, mapped embedding types and truncate', async () => {
      mock.onPost(`${ BASE }/v1/embed-jobs`).reply({ job_id: 'ej_2' })

      await service.createEmbedJob(
        'ds_1',
        'embed-multilingual-v3.0',
        'Clustering',
        'nightly',
        ['Float', 'Binary'],
        'Start'
      )

      expect(mock.history[0].body).toEqual({
        dataset_id: 'ds_1',
        model: 'embed-multilingual-v3.0',
        input_type: 'clustering',
        name: 'nightly',
        embedding_types: ['float', 'binary'],
        truncate: 'START',
      })
    })

    it('throws when datasetId is missing', async () => {
      await expect(service.createEmbedJob()).rejects.toThrow('Dataset ID is required')
    })
  })

  describe('listEmbedJobs', () => {
    it('gets all embed jobs', async () => {
      mock.onGet(`${ BASE }/v1/embed-jobs`).reply({ embed_jobs: [] })

      const result = await service.listEmbedJobs()

      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/v1/embed-jobs`)
      expect(result).toEqual({ embed_jobs: [] })
    })
  })

  describe('getEmbedJob', () => {
    it('gets an embed job by id', async () => {
      mock.onGet(`${ BASE }/v1/embed-jobs/ej_1`).reply({ job_id: 'ej_1' })

      const result = await service.getEmbedJob('ej_1')

      expect(mock.history[0].url).toBe(`${ BASE }/v1/embed-jobs/ej_1`)
      expect(result).toEqual({ job_id: 'ej_1' })
    })

    it('throws when jobId is missing', async () => {
      await expect(service.getEmbedJob()).rejects.toThrow('Embed Job ID is required')
    })
  })

  describe('cancelEmbedJob', () => {
    it('posts to the /cancel action and returns cancelled flag', async () => {
      mock.onPost(`${ BASE }/v1/embed-jobs/ej_1/cancel`).reply({})

      const result = await service.cancelEmbedJob('ej_1')

      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/v1/embed-jobs/ej_1/cancel`)
      expect(mock.history[0].body).toEqual({})
      expect(result).toEqual({ cancelled: true, jobId: 'ej_1' })
    })

    it('throws when jobId is missing', async () => {
      await expect(service.cancelEmbedJob()).rejects.toThrow('Embed Job ID is required')
    })
  })

  // ── Models ──

  describe('listModels', () => {
    it('sends no query params when none provided', async () => {
      mock.onGet(`${ BASE }/v1/models`).reply({ models: [] })

      await service.listModels()

      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].query).toEqual({})
    })

    it('maps the endpoint choice and forwards default_only and pagination', async () => {
      mock.onGet(`${ BASE }/v1/models`).reply({ models: [] })

      await service.listModels('Rerank', true, 50, 'tok')

      expect(mock.history[0].query).toEqual({
        endpoint: 'rerank',
        default_only: true,
        page_size: 50,
        page_token: 'tok',
      })
    })
  })

  describe('getModel', () => {
    it('gets a model by name (url-encoded)', async () => {
      mock.onGet(`${ BASE }/v1/models/command-a-plus-05-2026`).reply({ name: 'command-a-plus-05-2026' })

      const result = await service.getModel('command-a-plus-05-2026')

      expect(mock.history[0].url).toBe(`${ BASE }/v1/models/command-a-plus-05-2026`)
      expect(result).toEqual({ name: 'command-a-plus-05-2026' })
    })

    it('throws when modelName is missing', async () => {
      await expect(service.getModel()).rejects.toThrow('Model name is required')
    })
  })
})
