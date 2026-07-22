'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-openai-api-key'
const BASE = 'https://api.openai.com'

describe('OpenAI Service', () => {
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
        }),
      ])
    })
  })

  // ── Dictionary Methods ──

  describe('getModelsDictionary', () => {
    const modelsResponse = {
      data: [
        { id: 'gpt-4o', object: 'model' },
        { id: 'text-embedding-3-small', object: 'model' },
        { id: 'tts-1', object: 'model' },
      ],
    }

    it('returns all models mapped with label and value', async () => {
      mock.onGet(`${BASE}/v1/models`).reply(modelsResponse)

      const result = await service.getModelsDictionary({})

      expect(result.items).toHaveLength(3)
      expect(result.items[0]).toEqual({ label: 'gpt-4o', value: 'gpt-4o', note: 'gpt-4o' })
      expect(result.cursor).toBeNull()
      expect(mock.history[0].headers).toMatchObject({ Authorization: `Bearer ${API_KEY}` })
    })

    it('filters by case-insensitive search', async () => {
      mock.onGet(`${BASE}/v1/models`).reply(modelsResponse)

      const result = await service.getModelsDictionary({ search: 'GPT' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('gpt-4o')
    })

    it('handles null payload', async () => {
      mock.onGet(`${BASE}/v1/models`).reply(modelsResponse)

      const result = await service.getModelsDictionary(null)

      expect(result.items).toHaveLength(3)
      expect(result.cursor).toBeNull()
    })

    it('handles empty data', async () => {
      mock.onGet(`${BASE}/v1/models`).reply({ data: [] })

      const result = await service.getModelsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getTtsModelsDictionary', () => {
    it('filters only TTS models', async () => {
      mock.onGet(`${BASE}/v1/models`).reply({
        data: [
          { id: 'tts-1', object: 'model' },
          { id: 'tts-1-hd', object: 'model' },
          { id: 'gpt-4o-mini-tts', object: 'model' },
          { id: 'gpt-4o', object: 'model' },
        ],
      })

      const result = await service.getTtsModelsDictionary({})

      expect(result.items).toHaveLength(3)
      expect(result.items.map(i => i.value)).toEqual(
        expect.arrayContaining(['tts-1', 'tts-1-hd', 'gpt-4o-mini-tts'])
      )
    })
  })

  describe('getTranscriptionModelsDictionary', () => {
    it('filters only transcription models', async () => {
      mock.onGet(`${BASE}/v1/models`).reply({
        data: [
          { id: 'gpt-4o-transcribe', object: 'model' },
          { id: 'whisper-1', object: 'model' },
          { id: 'gpt-4o', object: 'model' },
        ],
      })

      const result = await service.getTranscriptionModelsDictionary({})

      expect(result.items).toHaveLength(2)
      expect(result.items.map(i => i.value)).toEqual(
        expect.arrayContaining(['gpt-4o-transcribe', 'whisper-1'])
      )
    })
  })

  describe('getChatModelsDictionary', () => {
    it('filters chat-capable models', async () => {
      mock.onGet(`${BASE}/v1/models`).reply({
        data: [
          { id: 'gpt-4o', object: 'model' },
          { id: 'gpt-4.1', object: 'model' },
          { id: 'o1', object: 'model' },
          { id: 'tts-1', object: 'model' },
          { id: 'text-embedding-3-small', object: 'model' },
          { id: 'dall-e-3', object: 'model' },
        ],
      })

      const result = await service.getChatModelsDictionary({})

      expect(result.items.map(i => i.value)).toEqual(
        expect.arrayContaining(['gpt-4.1', 'gpt-4o', 'o1'])
      )
      expect(result.items.map(i => i.value)).not.toContain('tts-1')
      expect(result.items.map(i => i.value)).not.toContain('text-embedding-3-small')
      expect(result.items.map(i => i.value)).not.toContain('dall-e-3')
    })
  })

  describe('getEmbeddingModelsDictionary', () => {
    it('filters embedding models', async () => {
      mock.onGet(`${BASE}/v1/models`).reply({
        data: [
          { id: 'text-embedding-3-small', object: 'model' },
          { id: 'text-embedding-3-large', object: 'model' },
          { id: 'gpt-4o', object: 'model' },
        ],
      })

      const result = await service.getEmbeddingModelsDictionary({})

      expect(result.items).toHaveLength(2)
      expect(result.items.map(i => i.value)).toEqual(
        expect.arrayContaining(['text-embedding-3-small', 'text-embedding-3-large'])
      )
    })
  })

  describe('getImageModelsDictionary', () => {
    it('filters image models', async () => {
      mock.onGet(`${BASE}/v1/models`).reply({
        data: [
          { id: 'dall-e-3', object: 'model' },
          { id: 'gpt-image-1', object: 'model' },
          { id: 'gpt-4o', object: 'model' },
        ],
      })

      const result = await service.getImageModelsDictionary({})

      expect(result.items).toHaveLength(2)
      expect(result.items.map(i => i.value)).toEqual(
        expect.arrayContaining(['dall-e-3', 'gpt-image-1'])
      )
    })
  })

  describe('getWebSearchModelsDictionary', () => {
    it('filters web-search-capable models', async () => {
      mock.onGet(`${BASE}/v1/models`).reply({
        data: [
          { id: 'gpt-4o', object: 'model' },
          { id: 'o1', object: 'model' },
          { id: 'tts-1', object: 'model' },
          { id: 'text-embedding-3-small', object: 'model' },
        ],
      })

      const result = await service.getWebSearchModelsDictionary({})

      expect(result.items.map(i => i.value)).toContain('gpt-4o')
      expect(result.items.map(i => i.value)).toContain('o1')
      expect(result.items.map(i => i.value)).not.toContain('tts-1')
      expect(result.items.map(i => i.value)).not.toContain('text-embedding-3-small')
    })
  })

  describe('getFilesDictionary', () => {
    it('returns mapped files with pagination', async () => {
      mock.onGet(`${BASE}/v1/files`).reply({
        data: [
          { id: 'file-abc', filename: 'input.jsonl', purpose: 'batch' },
          { id: 'file-def', filename: 'data.csv', purpose: 'user_data' },
        ],
        has_more: true,
        last_id: 'file-def',
      })

      const result = await service.getFilesDictionary({})

      expect(result.items).toHaveLength(2)
      expect(result.items[0]).toEqual({ label: 'input.jsonl', value: 'file-abc', note: 'batch' })
      expect(result.cursor).toBe('file-def')
    })

    it('filters by search on filename and id', async () => {
      mock.onGet(`${BASE}/v1/files`).reply({
        data: [
          { id: 'file-abc', filename: 'input.jsonl', purpose: 'batch' },
          { id: 'file-def', filename: 'data.csv', purpose: 'user_data' },
        ],
        has_more: false,
      })

      const result = await service.getFilesDictionary({ search: 'jsonl' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('file-abc')
    })

    it('passes cursor as after param', async () => {
      mock.onGet(`${BASE}/v1/files`).reply({ data: [], has_more: false })

      await service.getFilesDictionary({ cursor: 'file-xyz' })

      expect(mock.history[0].query).toMatchObject({ after: 'file-xyz' })
    })

    it('handles null payload', async () => {
      mock.onGet(`${BASE}/v1/files`).reply({ data: [{ id: 'f1', filename: 'a.txt', purpose: 'user_data' }], has_more: false })

      const result = await service.getFilesDictionary(null)

      expect(result.items).toHaveLength(1)
      expect(result.cursor).toBeNull()
    })
  })

  describe('getVectorStoresDictionary', () => {
    it('returns mapped vector stores with pagination', async () => {
      mock.onGet(`${BASE}/v1/vector_stores`).reply({
        data: [{ id: 'vs_abc', name: 'FAQ', status: 'completed' }],
        has_more: false,
      })

      const result = await service.getVectorStoresDictionary({})

      expect(result.items).toEqual([{ label: 'FAQ', value: 'vs_abc', note: 'completed' }])
      expect(result.cursor).toBeNull()
    })

    it('filters by search', async () => {
      mock.onGet(`${BASE}/v1/vector_stores`).reply({
        data: [
          { id: 'vs_abc', name: 'FAQ', status: 'completed' },
          { id: 'vs_def', name: 'Docs', status: 'completed' },
        ],
        has_more: false,
      })

      const result = await service.getVectorStoresDictionary({ search: 'faq' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('vs_abc')
    })

    it('handles null payload', async () => {
      mock.onGet(`${BASE}/v1/vector_stores`).reply({
        data: [{ id: 'vs_1', name: 'X', status: 'completed' }],
        has_more: false,
      })

      const result = await service.getVectorStoresDictionary(null)

      expect(result.items).toHaveLength(1)
    })
  })

  // ── Moderation ──

  describe('moderateContent', () => {
    it('sends correct body with text inputs', async () => {
      mock.onPost(`${BASE}/v1/moderations`).reply({
        results: [{ flagged: false, categories: {}, category_scores: {} }],
      })

      const result = await service.moderateContent(['Hello world'], null)

      expect(mock.history[0].body).toEqual({
        model: 'omni-moderation-latest',
        input: [{ type: 'text', text: 'Hello world' }],
      })
      expect(result).toHaveProperty('flagged', false)
    })

    it('sends both text and image inputs', async () => {
      mock.onPost(`${BASE}/v1/moderations`).reply({
        results: [{ flagged: true }],
      })

      await service.moderateContent(['test'], ['https://img.example.com/a.png'])

      expect(mock.history[0].body.input).toHaveLength(2)
      expect(mock.history[0].body.input[1]).toEqual({
        type: 'image_url',
        image_url: { url: 'https://img.example.com/a.png' },
      })
    })

    it('throws when no inputs provided', async () => {
      await expect(service.moderateContent(null, null)).rejects.toThrow('At least one text or image input is required')
    })

    it('throws on API error', async () => {
      mock.onPost(`${BASE}/v1/moderations`).replyWithError({
        message: 'Unauthorized',
        body: { error: { message: 'Invalid API key' } },
      })

      await expect(service.moderateContent(['test'])).rejects.toThrow('Invalid API key')
    })
  })

  // ── Audio ──

  describe('textToSpeech', () => {
    it('sends correct body with defaults', async () => {
      mock.onPost(`${BASE}/v1/audio/speech`).reply(Buffer.from('audio-data'))

      // Mock flowrunner.Files.uploadFile
      service.flowrunner = {
        Files: {
          uploadFile: jest.fn().mockResolvedValue({ url: 'https://files.example.com/tts.mp3' }),
        },
      }

      const result = await service.textToSpeech('Hello world')

      expect(mock.history[0].body).toMatchObject({
        model: 'tts-1',
        input: 'Hello world',
        voice: 'alloy',
        response_format: 'mp3',
        speed: 1.0,
      })
      expect(mock.history[0].encoding).toBeNull()
      expect(result).toEqual({ fileURL: 'https://files.example.com/tts.mp3' })
    })

    it('includes instructions when provided', async () => {
      mock.onPost(`${BASE}/v1/audio/speech`).reply(Buffer.from('audio'))
      service.flowrunner = {
        Files: { uploadFile: jest.fn().mockResolvedValue({ url: 'https://f.com/t.mp3' }) },
      }

      await service.textToSpeech('Hi', 'gpt-4o-mini-tts', 'nova', 'opus', 1.5, 'Speak cheerfully')

      expect(mock.history[0].body).toMatchObject({
        model: 'gpt-4o-mini-tts',
        voice: 'nova',
        response_format: 'opus',
        speed: 1.5,
        instructions: 'Speak cheerfully',
      })
    })

    it('throws when input is empty', async () => {
      await expect(service.textToSpeech('')).rejects.toThrow('Input text is required')
    })

    it('throws when input exceeds 4096 characters', async () => {
      await expect(service.textToSpeech('a'.repeat(4097))).rejects.toThrow('maximum allowed text length is 4096')
    })
  })

  describe('speechToText', () => {
    it('sends correct form data', async () => {
      mock.onGet('https://example.com/audio.mp3').reply(Buffer.from('audio-bytes'))
      mock.onPost(`${BASE}/v1/audio/transcriptions`).reply('Hello transcription')

      const result = await service.speechToText('https://example.com/audio.mp3')

      expect(result).toEqual({ text: 'Hello transcription' })
      expect(mock.history).toHaveLength(2)

      const formCall = mock.history[1]
      expect(formCall.formData).toBeDefined()
    })

    it('throws on invalid file URL', async () => {
      await expect(service.speechToText('not-a-url')).rejects.toThrow('Invalid fileUrl')
    })
  })

  describe('translateAudio', () => {
    it('sends correct form data', async () => {
      mock.onGet('https://example.com/fr-audio.mp3').reply(Buffer.from('audio'))
      mock.onPost(`${BASE}/v1/audio/translations`).reply('Hello in English')

      const result = await service.translateAudio('https://example.com/fr-audio.mp3')

      expect(result).toEqual({ text: 'Hello in English' })
    })

    it('throws on invalid URL', async () => {
      await expect(service.translateAudio('bad-url')).rejects.toThrow('Invalid file URL')
    })
  })

  // ── Web Search ──

  describe('webSearch', () => {
    it('sends correct request and extracts text and sources', async () => {
      mock.onPost(`${BASE}/v1/responses`).reply({
        output: [
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: 'Node.js LTS is 22',
                annotations: [
                  { type: 'url_citation', title: 'Node.js', url: 'https://nodejs.org' },
                ],
              },
            ],
          },
        ],
      })

      const result = await service.webSearch('What is Node.js LTS?')

      expect(mock.history[0].body).toMatchObject({
        model: 'gpt-4o',
        input: 'What is Node.js LTS?',
        tools: [{ type: 'web_search' }],
      })
      expect(result.text).toBe('Node.js LTS is 22')
      expect(result.sources).toEqual([{ title: 'Node.js', url: 'https://nodejs.org' }])
    })

    it('throws when prompt is empty', async () => {
      await expect(service.webSearch('')).rejects.toThrow('Prompt is required')
    })

    it('handles response with no message output', async () => {
      mock.onPost(`${BASE}/v1/responses`).reply({ output: [] })

      const result = await service.webSearch('test')

      expect(result.text).toBe('')
      expect(result.sources).toEqual([])
    })
  })

  // ── Responses ──

  describe('createResponse', () => {
    const responsePayload = {
      id: 'resp_abc',
      object: 'response',
      status: 'completed',
      output: [
        {
          type: 'message',
          content: [{ type: 'output_text', text: 'Hello!' }],
        },
      ],
    }

    it('sends basic text input', async () => {
      mock.onPost(`${BASE}/v1/responses`).reply(responsePayload)

      const result = await service.createResponse('Hello')

      expect(mock.history[0].body).toMatchObject({
        model: 'gpt-4o',
        input: 'Hello',
      })
      expect(result.outputText).toBe('Hello!')
    })

    it('prefers inputItems over text input', async () => {
      mock.onPost(`${BASE}/v1/responses`).reply(responsePayload)

      await service.createResponse('ignored', 'gpt-4o', null, [{ role: 'user', content: 'Hi' }])

      expect(mock.history[0].body.input).toEqual([{ role: 'user', content: 'Hi' }])
    })

    it('includes tools when enabled', async () => {
      mock.onPost(`${BASE}/v1/responses`).reply(responsePayload)

      await service.createResponse(
        'test', 'gpt-4o', null, null, null, true, false, null,
        null, null, null, null, null, true, ['vs_123'], true,
        [{ type: 'function', name: 'fn1' }]
      )

      const tools = mock.history[0].body.tools
      expect(tools).toEqual(expect.arrayContaining([
        { type: 'web_search' },
        { type: 'file_search', vector_store_ids: ['vs_123'] },
        expect.objectContaining({ type: 'code_interpreter' }),
        { type: 'function', name: 'fn1' },
      ]))
    })

    it('includes reasoning effort when set', async () => {
      mock.onPost(`${BASE}/v1/responses`).reply(responsePayload)

      await service.createResponse('test', 'o1', null, null, null, undefined, undefined, 'High')

      expect(mock.history[0].body.reasoning).toEqual({ effort: 'high' })
    })

    it('includes JSON schema when provided', async () => {
      mock.onPost(`${BASE}/v1/responses`).reply(responsePayload)
      const schema = { type: 'object', properties: { city: { type: 'string' } } }

      await service.createResponse(
        'test', 'gpt-4o', null, null, null, undefined, undefined, undefined,
        undefined, undefined, undefined, 'mySchema', schema
      )

      expect(mock.history[0].body.text).toEqual({
        format: {
          type: 'json_schema',
          name: 'mySchema',
          schema,
          strict: true,
        },
      })
    })

    it('throws when no input provided', async () => {
      await expect(service.createResponse('', null, null, null)).rejects.toThrow('Either Input Text or Input Items is required')
    })
  })

  describe('getResponse', () => {
    it('sends GET to correct URL', async () => {
      mock.onGet(`${BASE}/v1/responses/resp_abc`).reply({
        id: 'resp_abc',
        output: [{ type: 'message', content: [{ type: 'output_text', text: 'Hi' }] }],
      })

      const result = await service.getResponse('resp_abc')

      expect(result.outputText).toBe('Hi')
    })

    it('throws when ID is missing', async () => {
      await expect(service.getResponse('')).rejects.toThrow('Response ID is required')
    })
  })

  describe('cancelResponse', () => {
    it('sends POST to cancel URL', async () => {
      mock.onPost(`${BASE}/v1/responses/resp_abc/cancel`).reply({ id: 'resp_abc', status: 'cancelled' })

      const result = await service.cancelResponse('resp_abc')

      expect(result.status).toBe('cancelled')
    })

    it('throws when ID is missing', async () => {
      await expect(service.cancelResponse('')).rejects.toThrow('Response ID is required')
    })
  })

  describe('deleteResponse', () => {
    it('sends DELETE to correct URL', async () => {
      mock.onDelete(`${BASE}/v1/responses/resp_abc`).reply({ id: 'resp_abc', deleted: true })

      const result = await service.deleteResponse('resp_abc')

      expect(result.deleted).toBe(true)
    })

    it('throws when ID is missing', async () => {
      await expect(service.deleteResponse('')).rejects.toThrow('Response ID is required')
    })
  })

  describe('listResponseInputItems', () => {
    it('sends correct query params', async () => {
      mock.onGet(`${BASE}/v1/responses/resp_abc/input_items`).reply({
        data: [],
        has_more: false,
      })

      await service.listResponseInputItems('resp_abc', 10, 'item_xyz', 'Descending')

      expect(mock.history[0].query).toMatchObject({
        limit: 10,
        after: 'item_xyz',
        order: 'desc',
      })
    })

    it('throws when response ID is missing', async () => {
      await expect(service.listResponseInputItems('')).rejects.toThrow('Response ID is required')
    })
  })

  // ── Chat Completions ──

  describe('createChatCompletion', () => {
    const messages = [{ role: 'user', content: 'Hello' }]

    it('sends correct body with defaults', async () => {
      mock.onPost(`${BASE}/v1/chat/completions`).reply({
        id: 'chatcmpl-abc',
        choices: [{ message: { content: 'Hi' }, finish_reason: 'stop' }],
      })

      const result = await service.createChatCompletion(messages)

      expect(mock.history[0].body).toMatchObject({
        model: 'gpt-4o',
        messages,
      })
      expect(result.choices[0].message.content).toBe('Hi')
    })

    it('includes response format for JSON Schema', async () => {
      mock.onPost(`${BASE}/v1/chat/completions`).reply({ id: 'cmpl', choices: [] })
      const schema = { type: 'object', properties: {} }

      await service.createChatCompletion(
        messages, 'gpt-4o', null, null, null, null, null, null, null, null,
        'JSON Schema', 'mySchema', schema
      )

      expect(mock.history[0].body.response_format).toEqual({
        type: 'json_schema',
        json_schema: { name: 'mySchema', schema, strict: true },
      })
    })

    it('throws when JSON Schema format chosen but no schema provided', async () => {
      await expect(
        service.createChatCompletion(messages, 'gpt-4o', null, null, null, null, null, null, null, null, 'JSON Schema')
      ).rejects.toThrow("JSON Schema is required when Response Format is 'JSON Schema'")
    })

    it('includes JSON Object response format', async () => {
      mock.onPost(`${BASE}/v1/chat/completions`).reply({ id: 'cmpl', choices: [] })

      await service.createChatCompletion(
        messages, 'gpt-4o', null, null, null, null, null, null, null, null, 'JSON Object'
      )

      expect(mock.history[0].body.response_format).toEqual({ type: 'json_object' })
    })

    it('parses JSON toolChoice string', async () => {
      mock.onPost(`${BASE}/v1/chat/completions`).reply({ id: 'cmpl', choices: [] })

      await service.createChatCompletion(
        messages, 'gpt-4o', null, null, null, null, null, null, null, null,
        null, null, null, null, '{"type":"function","function":{"name":"get_weather"}}'
      )

      expect(mock.history[0].body.tool_choice).toEqual({ type: 'function', function: { name: 'get_weather' } })
    })

    it('throws when messages is empty', async () => {
      await expect(service.createChatCompletion([])).rejects.toThrow('Messages array is required')
    })

    it('includes reasoning effort and sampling params', async () => {
      mock.onPost(`${BASE}/v1/chat/completions`).reply({ id: 'cmpl', choices: [] })

      await service.createChatCompletion(messages, 'o1', 0.7, 0.9, 1000, 'Medium', 0.5, 0.5, 42, ['stop'])

      expect(mock.history[0].body).toMatchObject({
        temperature: 0.7,
        top_p: 0.9,
        max_completion_tokens: 1000,
        reasoning_effort: 'medium',
        frequency_penalty: 0.5,
        presence_penalty: 0.5,
        seed: 42,
        stop: ['stop'],
      })
    })
  })

  // ── Embeddings ──

  describe('createEmbeddings', () => {
    it('sends correct body with defaults', async () => {
      mock.onPost(`${BASE}/v1/embeddings`).reply({
        data: [{ embedding: [0.1, 0.2], index: 0 }],
      })

      const result = await service.createEmbeddings(['Hello'])

      expect(mock.history[0].body).toMatchObject({
        model: 'text-embedding-3-small',
        input: ['Hello'],
      })
      expect(result.data[0].embedding).toEqual([0.1, 0.2])
    })

    it('includes dimensions when provided', async () => {
      mock.onPost(`${BASE}/v1/embeddings`).reply({ data: [] })

      await service.createEmbeddings(['text'], 'text-embedding-3-large', 256)

      expect(mock.history[0].body).toMatchObject({
        model: 'text-embedding-3-large',
        dimensions: 256,
      })
    })

    it('throws when no texts provided', async () => {
      await expect(service.createEmbeddings([])).rejects.toThrow('At least one text input is required')
    })
  })

  // ── Images ──

  describe('generateImage', () => {
    it('sends correct body for gpt-image model', async () => {
      mock.onPost(`${BASE}/v1/images/generations`).reply({
        data: [{ b64_json: Buffer.from('imgdata').toString('base64') }],
        usage: { total_tokens: 100 },
      })

      service.flowrunner = {
        Files: { uploadFile: jest.fn().mockResolvedValue({ url: 'https://f.com/img.png' }) },
      }

      const result = await service.generateImage('A cat')

      expect(mock.history[0].body).toMatchObject({
        model: 'gpt-image-1',
        prompt: 'A cat',
      })
      expect(result.files).toHaveLength(1)
      expect(result.files[0].fileURL).toBe('https://f.com/img.png')
    })

    it('throws when prompt is empty', async () => {
      await expect(service.generateImage('')).rejects.toThrow('Prompt is required')
    })

    it('handles dall-e model with b64_json response format', async () => {
      mock.onPost(`${BASE}/v1/images/generations`).reply({
        data: [{ b64_json: Buffer.from('img').toString('base64'), revised_prompt: 'revised' }],
      })

      service.flowrunner = {
        Files: { uploadFile: jest.fn().mockResolvedValue({ url: 'https://f.com/img.png' }) },
      }

      await service.generateImage('A cat', 'dall-e-3', 'Square (1024x1024)', 'Standard')

      expect(mock.history[0].body.response_format).toBe('b64_json')
      // dall-e should not have output_format
      expect(mock.history[0].body.output_format).toBeUndefined()
    })
  })

  describe('editImage', () => {
    it('sends form data with image download', async () => {
      mock.onGet('https://example.com/img.png').reply(Buffer.from('imgbytes'))
      mock.onPost(`${BASE}/v1/images/edits`).reply({
        data: [{ b64_json: Buffer.from('edited').toString('base64') }],
        usage: { total_tokens: 50 },
      })

      service.flowrunner = {
        Files: { uploadFile: jest.fn().mockResolvedValue({ url: 'https://f.com/edited.png' }) },
      }

      const result = await service.editImage(['https://example.com/img.png'], 'Make it blue')

      expect(result.files).toHaveLength(1)
      expect(mock.history).toHaveLength(2)
    })

    it('throws when no image URLs', async () => {
      await expect(service.editImage([], 'test')).rejects.toThrow('At least one image URL is required')
    })

    it('throws when prompt is empty', async () => {
      await expect(service.editImage(['https://img.com/a.png'], '')).rejects.toThrow('Prompt is required')
    })
  })

  // ── Files ──

  describe('uploadFile', () => {
    it('downloads and uploads file with form data', async () => {
      mock.onGet('https://example.com/batch.jsonl').reply(Buffer.from('file-data'))
      mock.onPost(`${BASE}/v1/files`).reply({
        id: 'file-abc',
        filename: 'batch.jsonl',
        purpose: 'batch',
      })

      const result = await service.uploadFile('https://example.com/batch.jsonl', 'Batch')

      expect(result.id).toBe('file-abc')
      expect(mock.history[1].formData).toBeDefined()
    })
  })

  describe('listFiles', () => {
    it('sends correct query params', async () => {
      mock.onGet(`${BASE}/v1/files`).reply({ data: [], has_more: false })

      await service.listFiles('Batch', 50, 'file-xyz', 'Ascending')

      expect(mock.history[0].query).toMatchObject({
        purpose: 'batch',
        limit: 50,
        after: 'file-xyz',
        order: 'asc',
      })
    })

    it('omits undefined params', async () => {
      mock.onGet(`${BASE}/v1/files`).reply({ data: [], has_more: false })

      await service.listFiles()

      expect(mock.history[0].query).toEqual({})
    })
  })

  describe('getFile', () => {
    it('sends GET to correct URL', async () => {
      mock.onGet(`${BASE}/v1/files/file-abc`).reply({ id: 'file-abc', filename: 'test.txt' })

      const result = await service.getFile('file-abc')

      expect(result.id).toBe('file-abc')
    })

    it('throws when file ID is missing', async () => {
      await expect(service.getFile('')).rejects.toThrow('File ID is required')
    })
  })

  describe('deleteFile', () => {
    it('sends DELETE to correct URL', async () => {
      mock.onDelete(`${BASE}/v1/files/file-abc`).reply({ id: 'file-abc', deleted: true })

      const result = await service.deleteFile('file-abc')

      expect(result.deleted).toBe(true)
    })

    it('throws when file ID is missing', async () => {
      await expect(service.deleteFile('')).rejects.toThrow('File ID is required')
    })
  })

  describe('downloadFileContent', () => {
    it('downloads file content and uploads to storage', async () => {
      mock.onGet(`${BASE}/v1/files/file-abc`).reply({ id: 'file-abc', filename: 'output.jsonl', bytes: 5000 })
      mock.onGet(`${BASE}/v1/files/file-abc/content`).reply(Buffer.from('content'))

      service.flowrunner = {
        Files: { uploadFile: jest.fn().mockResolvedValue({ url: 'https://f.com/output.jsonl' }) },
      }

      const result = await service.downloadFileContent('file-abc')

      expect(result).toEqual({
        fileURL: 'https://f.com/output.jsonl',
        filename: 'output.jsonl',
        bytes: 5000,
      })
    })

    it('throws when file ID is missing', async () => {
      await expect(service.downloadFileContent('')).rejects.toThrow('File ID is required')
    })
  })

  // ── Batches ──

  describe('createBatch', () => {
    it('sends correct body', async () => {
      mock.onPost(`${BASE}/v1/batches`).reply({ id: 'batch_abc', status: 'validating' })

      const result = await service.createBatch('file-abc', 'Chat Completions')

      expect(mock.history[0].body).toMatchObject({
        input_file_id: 'file-abc',
        endpoint: '/v1/chat/completions',
        completion_window: '24h',
      })
      expect(result.status).toBe('validating')
    })

    it('throws when input file ID is missing', async () => {
      await expect(service.createBatch('')).rejects.toThrow('Input file ID is required')
    })
  })

  describe('getBatch', () => {
    it('sends GET to correct URL', async () => {
      mock.onGet(`${BASE}/v1/batches/batch_abc`).reply({ id: 'batch_abc', status: 'completed' })

      const result = await service.getBatch('batch_abc')

      expect(result.status).toBe('completed')
    })

    it('throws when batch ID is missing', async () => {
      await expect(service.getBatch('')).rejects.toThrow('Batch ID is required')
    })
  })

  describe('listBatches', () => {
    it('sends correct query params', async () => {
      mock.onGet(`${BASE}/v1/batches`).reply({ data: [], has_more: false })

      await service.listBatches(10, 'batch_xyz')

      expect(mock.history[0].query).toMatchObject({ limit: 10, after: 'batch_xyz' })
    })
  })

  describe('cancelBatch', () => {
    it('sends POST to cancel URL', async () => {
      mock.onPost(`${BASE}/v1/batches/batch_abc/cancel`).reply({ id: 'batch_abc', status: 'cancelling' })

      const result = await service.cancelBatch('batch_abc')

      expect(result.status).toBe('cancelling')
    })

    it('throws when batch ID is missing', async () => {
      await expect(service.cancelBatch('')).rejects.toThrow('Batch ID is required')
    })
  })

  // ── Vector Stores ──

  describe('createVectorStore', () => {
    it('sends correct body', async () => {
      mock.onPost(`${BASE}/v1/vector_stores`).reply({ id: 'vs_abc', status: 'in_progress' })

      const result = await service.createVectorStore('FAQ', ['file-1'], 30, { project: 'test' })

      expect(mock.history[0].body).toMatchObject({
        name: 'FAQ',
        file_ids: ['file-1'],
        expires_after: { anchor: 'last_active_at', days: 30 },
        metadata: { project: 'test' },
      })
      expect(result.id).toBe('vs_abc')
    })

    it('omits optional fields when not provided', async () => {
      mock.onPost(`${BASE}/v1/vector_stores`).reply({ id: 'vs_abc' })

      await service.createVectorStore()

      expect(mock.history[0].body).toEqual({})
    })
  })

  describe('listVectorStores', () => {
    it('sends correct query params', async () => {
      mock.onGet(`${BASE}/v1/vector_stores`).reply({ data: [], has_more: false })

      await service.listVectorStores(50, 'vs_xyz', 'Ascending')

      expect(mock.history[0].query).toMatchObject({ limit: 50, after: 'vs_xyz', order: 'asc' })
    })
  })

  describe('getVectorStore', () => {
    it('sends GET to correct URL', async () => {
      mock.onGet(`${BASE}/v1/vector_stores/vs_abc`).reply({ id: 'vs_abc', status: 'completed' })

      const result = await service.getVectorStore('vs_abc')

      expect(result.status).toBe('completed')
    })

    it('throws when ID is missing', async () => {
      await expect(service.getVectorStore('')).rejects.toThrow('Vector store ID is required')
    })
  })

  describe('deleteVectorStore', () => {
    it('sends DELETE to correct URL', async () => {
      mock.onDelete(`${BASE}/v1/vector_stores/vs_abc`).reply({ id: 'vs_abc', deleted: true })

      const result = await service.deleteVectorStore('vs_abc')

      expect(result.deleted).toBe(true)
    })

    it('throws when ID is missing', async () => {
      await expect(service.deleteVectorStore('')).rejects.toThrow('Vector store ID is required')
    })
  })

  describe('addFileToVectorStore', () => {
    it('sends POST with file_id body', async () => {
      mock.onPost(`${BASE}/v1/vector_stores/vs_abc/files`).reply({
        id: 'file-abc',
        status: 'in_progress',
      })

      const result = await service.addFileToVectorStore('vs_abc', 'file-abc')

      expect(mock.history[0].body).toEqual({ file_id: 'file-abc' })
      expect(result.status).toBe('in_progress')
    })

    it('throws when vector store ID is missing', async () => {
      await expect(service.addFileToVectorStore('', 'file-abc')).rejects.toThrow('Vector store ID is required')
    })

    it('throws when file ID is missing', async () => {
      await expect(service.addFileToVectorStore('vs_abc', '')).rejects.toThrow('File ID is required')
    })
  })

  describe('listVectorStoreFiles', () => {
    it('sends correct query params', async () => {
      mock.onGet(`${BASE}/v1/vector_stores/vs_abc/files`).reply({ data: [], has_more: false })

      await service.listVectorStoreFiles('vs_abc', 'Completed', 20, 'file-xyz')

      expect(mock.history[0].query).toMatchObject({
        filter: 'completed',
        limit: 20,
        after: 'file-xyz',
      })
    })

    it('throws when vector store ID is missing', async () => {
      await expect(service.listVectorStoreFiles('')).rejects.toThrow('Vector store ID is required')
    })
  })

  describe('removeFileFromVectorStore', () => {
    it('sends DELETE to correct URL', async () => {
      mock.onDelete(`${BASE}/v1/vector_stores/vs_abc/files/file-abc`).reply({ id: 'file-abc', deleted: true })

      const result = await service.removeFileFromVectorStore('vs_abc', 'file-abc')

      expect(result.deleted).toBe(true)
    })

    it('throws when vector store ID is missing', async () => {
      await expect(service.removeFileFromVectorStore('', 'file-abc')).rejects.toThrow('Vector store ID is required')
    })

    it('throws when file ID is missing', async () => {
      await expect(service.removeFileFromVectorStore('vs_abc', '')).rejects.toThrow('File ID is required')
    })
  })

  describe('searchVectorStore', () => {
    it('sends correct body', async () => {
      mock.onPost(`${BASE}/v1/vector_stores/vs_abc/search`).reply({
        data: [{ file_id: 'file-1', score: 0.95 }],
      })

      const result = await service.searchVectorStore('vs_abc', 'return policy', 5, true)

      expect(mock.history[0].body).toMatchObject({
        query: 'return policy',
        max_num_results: 5,
        rewrite_query: true,
      })
      expect(result.data[0].score).toBe(0.95)
    })

    it('throws when vector store ID is missing', async () => {
      await expect(service.searchVectorStore('', 'q')).rejects.toThrow('Vector store ID is required')
    })

    it('throws when query is empty', async () => {
      await expect(service.searchVectorStore('vs_abc', '')).rejects.toThrow('Query is required')
    })
  })

  // ── Videos ──

  describe('createVideo', () => {
    it('sends correct JSON body without reference image', async () => {
      mock.onPost(`${BASE}/v1/videos`).reply({ id: 'video_abc', status: 'queued' })

      const result = await service.createVideo('A sunset', 'Sora 2', '8 Seconds', 'Landscape (1280x720)')

      expect(mock.history[0].body).toMatchObject({
        model: 'sora-2',
        prompt: 'A sunset',
        seconds: '8',
        size: '1280x720',
      })
      expect(result.status).toBe('queued')
    })

    it('sends form data with reference image', async () => {
      mock.onGet('https://example.com/ref.png').reply(Buffer.from('img'))
      mock.onPost(`${BASE}/v1/videos`).reply({ id: 'video_abc', status: 'queued' })

      await service.createVideo('A sunset', null, null, null, 'https://example.com/ref.png')

      expect(mock.history[1].formData).toBeDefined()
    })

    it('throws when prompt is empty', async () => {
      await expect(service.createVideo('')).rejects.toThrow('Prompt is required')
    })
  })

  describe('remixVideo', () => {
    it('sends POST with prompt body', async () => {
      mock.onPost(`${BASE}/v1/videos/video_abc/remix`).reply({ id: 'video_def', status: 'queued' })

      const result = await service.remixVideo('video_abc', 'Make it night time')

      expect(mock.history[0].body).toEqual({ prompt: 'Make it night time' })
      expect(result.id).toBe('video_def')
    })

    it('throws when video ID is missing', async () => {
      await expect(service.remixVideo('', 'test')).rejects.toThrow('Video ID is required')
    })

    it('throws when prompt is empty', async () => {
      await expect(service.remixVideo('video_abc', '')).rejects.toThrow('Prompt is required')
    })
  })

  describe('getVideo', () => {
    it('sends GET to correct URL', async () => {
      mock.onGet(`${BASE}/v1/videos/video_abc`).reply({ id: 'video_abc', status: 'completed' })

      const result = await service.getVideo('video_abc')

      expect(result.status).toBe('completed')
    })

    it('throws when video ID is missing', async () => {
      await expect(service.getVideo('')).rejects.toThrow('Video ID is required')
    })
  })

  describe('listVideos', () => {
    it('sends correct query params', async () => {
      mock.onGet(`${BASE}/v1/videos`).reply({ data: [], has_more: false })

      await service.listVideos(10, 'video_xyz', 'Ascending')

      expect(mock.history[0].query).toMatchObject({ limit: 10, after: 'video_xyz', order: 'asc' })
    })
  })

  describe('deleteVideo', () => {
    it('sends DELETE to correct URL', async () => {
      mock.onDelete(`${BASE}/v1/videos/video_abc`).reply({ id: 'video_abc', deleted: true })

      const result = await service.deleteVideo('video_abc')

      expect(result.deleted).toBe(true)
    })

    it('throws when video ID is missing', async () => {
      await expect(service.deleteVideo('')).rejects.toThrow('Video ID is required')
    })
  })

  describe('downloadVideoContent', () => {
    it('downloads video and uploads to storage', async () => {
      mock.onGet(`${BASE}/v1/videos/video_abc/content`).reply(Buffer.from('video-bytes'))

      service.flowrunner = {
        Files: { uploadFile: jest.fn().mockResolvedValue({ url: 'https://f.com/video_abc.mp4' }) },
      }

      const result = await service.downloadVideoContent('video_abc')

      expect(result.fileURL).toBe('https://f.com/video_abc.mp4')
    })

    it('uses correct extension for thumbnail variant', async () => {
      mock.onGet(`${BASE}/v1/videos/video_abc/content`).reply(Buffer.from('thumb'))

      service.flowrunner = {
        Files: {
          uploadFile: jest.fn().mockImplementation((buf, opts) => {
            expect(opts.filename).toBe('video_abc.webp')
            return Promise.resolve({ url: 'https://f.com/thumb.webp' })
          }),
        },
      }

      await service.downloadVideoContent('video_abc', 'Thumbnail')

      expect(mock.history[0].query).toMatchObject({ variant: 'thumbnail' })
    })

    it('throws when video ID is missing', async () => {
      await expect(service.downloadVideoContent('')).rejects.toThrow('Video ID is required')
    })
  })

  // ── Models ──

  describe('listModels', () => {
    it('sends GET to models endpoint', async () => {
      mock.onGet(`${BASE}/v1/models`).reply({
        data: [{ id: 'gpt-4o', object: 'model' }],
      })

      const result = await service.listModels()

      expect(result.data).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({ Authorization: `Bearer ${API_KEY}` })
    })
  })

  describe('getModel', () => {
    it('sends GET to correct URL', async () => {
      mock.onGet(`${BASE}/v1/models/gpt-4o`).reply({ id: 'gpt-4o', object: 'model' })

      const result = await service.getModel('gpt-4o')

      expect(result.id).toBe('gpt-4o')
    })

    it('throws when model ID is missing', async () => {
      await expect(service.getModel('')).rejects.toThrow('Model ID is required')
    })
  })

  // ── Error Handling ──

  describe('error normalization', () => {
    it('uses error.body.error.message when available', async () => {
      mock.onGet(`${BASE}/v1/models/bad`).replyWithError({
        message: 'Generic error',
        body: { error: { message: 'Specific API error message' } },
      })

      await expect(service.getModel('bad')).rejects.toThrow('Specific API error message')
    })

    it('uses error.body.message as fallback', async () => {
      mock.onGet(`${BASE}/v1/models/bad`).replyWithError({
        message: 'Generic',
        body: { message: 'Body-level message' },
      })

      await expect(service.getModel('bad')).rejects.toThrow('Body-level message')
    })

    it('falls back to error.message', async () => {
      mock.onGet(`${BASE}/v1/models/bad`).replyWithError({
        message: 'Network timeout',
      })

      await expect(service.getModel('bad')).rejects.toThrow('Network timeout')
    })
  })
})
