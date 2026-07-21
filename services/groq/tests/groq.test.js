'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-api-key'
const BASE = 'https://api.groq.com/openai/v1'

// Pull the appended fields out of the mock FormData instance recorded on a call.
function formFields(record) {
  return (record.formData && record.formData._fields) || []
}

// Find a single form field value by name.
function fieldValue(record, name) {
  const field = formFields(record).find(f => f.name === name)

  return field ? field.value : undefined
}

describe('Groq Service', () => {
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
    // Remove any Files stub set by individual tests so it never leaks.
    delete service.flowrunner
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

    it('sends the Bearer Authorization header on requests', async () => {
      mock.onGet(`${ BASE }/models`).reply({ object: 'list', data: [] })

      await service.listModels()

      expect(mock.history[0].headers).toMatchObject({
        'Authorization': `Bearer ${ API_KEY }`,
      })
    })
  })

  // ── Dictionary Methods ──

  describe('getModelsDictionary', () => {
    it('maps all models sorted with owner and context notes', async () => {
      mock.onGet(`${ BASE }/models`).reply({
        object: 'list',
        data: [
          { id: 'llama-3.3-70b-versatile', owned_by: 'Meta', context_window: 131072 },
          { id: 'whisper-large-v3', owned_by: 'OpenAI', context_window: 448 },
        ],
      })

      const result = await service.getModelsDictionary({})

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/models`)
      expect(result).toEqual({
        items: [
          { label: 'llama-3.3-70b-versatile', value: 'llama-3.3-70b-versatile', note: 'Meta · 131072 ctx' },
          { label: 'whisper-large-v3', value: 'whisper-large-v3', note: 'OpenAI · 448 ctx' },
        ],
        cursor: null,
      })
    })

    it('filters models by search term (case-insensitive)', async () => {
      mock.onGet(`${ BASE }/models`).reply({
        data: [
          { id: 'llama-3.3-70b-versatile', owned_by: 'Meta', context_window: 131072 },
          { id: 'whisper-large-v3', owned_by: 'OpenAI', context_window: 448 },
        ],
      })

      const result = await service.getModelsDictionary({ search: 'WHISPER' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('whisper-large-v3')
    })

    it('handles a null payload and missing data array', async () => {
      mock.onGet(`${ BASE }/models`).reply({})

      const result = await service.getModelsDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('builds a note from only the fields present', async () => {
      mock.onGet(`${ BASE }/models`).reply({
        data: [{ id: 'model-x', owned_by: 'Owner' }],
      })

      const result = await service.getModelsDictionary({})

      expect(result.items[0].note).toBe('Owner')
    })
  })

  describe('getChatModelsDictionary', () => {
    it('excludes speech, tts and guard models', async () => {
      mock.onGet(`${ BASE }/models`).reply({
        data: [
          { id: 'llama-3.3-70b-versatile', owned_by: 'Meta' },
          { id: 'whisper-large-v3', owned_by: 'OpenAI' },
          { id: 'canopylabs/orpheus-v1-english', owned_by: 'CanopyLabs' },
          { id: 'meta-llama/llama-prompt-guard-2-86m', owned_by: 'Meta' },
          { id: 'playai-tts', owned_by: 'PlayAI' },
        ],
      })

      const result = await service.getChatModelsDictionary({})

      expect(result.items.map(i => i.value)).toEqual(['llama-3.3-70b-versatile'])
    })
  })

  describe('getTranscriptionModelsDictionary', () => {
    it('includes only whisper models', async () => {
      mock.onGet(`${ BASE }/models`).reply({
        data: [
          { id: 'llama-3.3-70b-versatile', owned_by: 'Meta' },
          { id: 'whisper-large-v3', owned_by: 'OpenAI' },
          { id: 'whisper-large-v3-turbo', owned_by: 'OpenAI' },
        ],
      })

      const result = await service.getTranscriptionModelsDictionary({})

      expect(result.items.map(i => i.value)).toEqual(['whisper-large-v3', 'whisper-large-v3-turbo'])
    })
  })

  describe('getTtsModelsDictionary', () => {
    it('includes only tts/orpheus/playai models', async () => {
      mock.onGet(`${ BASE }/models`).reply({
        data: [
          { id: 'llama-3.3-70b-versatile', owned_by: 'Meta' },
          { id: 'canopylabs/orpheus-v1-english', owned_by: 'CanopyLabs' },
          { id: 'playai-tts', owned_by: 'PlayAI' },
        ],
      })

      const result = await service.getTtsModelsDictionary({})

      expect(result.items.map(i => i.value)).toEqual(['canopylabs/orpheus-v1-english', 'playai-tts'])
    })
  })

  describe('getVoicesDictionary', () => {
    it('lists voices for a specific model via criteria', async () => {
      const result = await service.getVoicesDictionary({
        criteria: { model: 'canopylabs/orpheus-v1-english' },
      })

      expect(mock.history).toHaveLength(0)
      expect(result.items).toContainEqual({
        label: 'Troy (male)',
        value: 'troy',
        note: 'canopylabs/orpheus-v1-english',
      })
      expect(result.items).toHaveLength(6)
      expect(result.cursor).toBeNull()
    })

    it('lists all voices across models when no model given', async () => {
      const result = await service.getVoicesDictionary({})

      expect(result.items).toHaveLength(12)
      expect(result.items.every(i => typeof i.note === 'string')).toBe(true)
    })

    it('filters voices by search term', async () => {
      const result = await service.getVoicesDictionary({
        search: 'troy',
        criteria: { model: 'canopylabs/orpheus-v1-english' },
      })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('troy')
    })

    it('handles a null payload', async () => {
      const result = await service.getVoicesDictionary(null)

      expect(result.items).toHaveLength(12)
    })
  })

  describe('getFilesDictionary', () => {
    it('maps files to items with purpose and size notes', async () => {
      mock.onGet(`${ BASE }/files`).reply({
        data: [
          { id: 'file_1', filename: 'batch_input.jsonl', purpose: 'batch', bytes: 2464 },
          { id: 'file_2', purpose: 'batch_output' },
        ],
      })

      const result = await service.getFilesDictionary({})

      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/files`)
      expect(result.items).toEqual([
        { label: 'batch_input.jsonl', value: 'file_1', note: 'batch · 2464 bytes' },
        { label: 'file_2', value: 'file_2', note: 'batch_output' },
      ])
      expect(result.cursor).toBeNull()
    })

    it('filters files by search over filename/id', async () => {
      mock.onGet(`${ BASE }/files`).reply({
        data: [
          { id: 'file_1', filename: 'batch_input.jsonl', purpose: 'batch' },
          { id: 'file_2', filename: 'results.jsonl', purpose: 'batch_output' },
        ],
      })

      const result = await service.getFilesDictionary({ search: 'results' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('file_2')
    })

    it('handles missing data array', async () => {
      mock.onGet(`${ BASE }/files`).reply({})

      const result = await service.getFilesDictionary(null)

      expect(result.items).toEqual([])
    })
  })

  describe('getBatchesDictionary', () => {
    it('maps batches to items and returns null cursor when no more', async () => {
      mock.onGet(`${ BASE }/batches`).reply({
        data: [
          { id: 'batch_1', status: 'completed', endpoint: '/v1/chat/completions' },
          { id: 'batch_2', status: 'validating', endpoint: '/v1/audio/transcriptions' },
        ],
        has_more: false,
      })

      const result = await service.getBatchesDictionary({})

      expect(mock.history[0].query).toEqual({})
      expect(result.items).toEqual([
        { label: 'batch_1', value: 'batch_1', note: 'completed · /v1/chat/completions' },
        { label: 'batch_2', value: 'batch_2', note: 'validating · /v1/audio/transcriptions' },
      ])
      expect(result.cursor).toBeNull()
    })

    it('passes cursor as after query and returns last id when has_more', async () => {
      mock.onGet(`${ BASE }/batches`).reply({
        data: [{ id: 'batch_9', status: 'completed', endpoint: '/v1/chat/completions' }],
        has_more: true,
      })

      const result = await service.getBatchesDictionary({ cursor: 'batch_5' })

      expect(mock.history[0].query).toEqual({ after: 'batch_5' })
      expect(result.cursor).toBe('batch_9')
    })

    it('filters batches by search over id', async () => {
      mock.onGet(`${ BASE }/batches`).reply({
        data: [
          { id: 'batch_abc', status: 'completed' },
          { id: 'batch_xyz', status: 'completed' },
        ],
        has_more: false,
      })

      const result = await service.getBatchesDictionary({ search: 'xyz' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('batch_xyz')
    })
  })

  // ── Chat Completion ──

  describe('chatCompletion', () => {
    it('sends required params only and shapes the response', async () => {
      mock.onPost(`${ BASE }/chat/completions`).reply({
        model: 'llama-3.3-70b-versatile',
        choices: [
          {
            message: { role: 'assistant', content: 'Hi there' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
      })

      const result = await service.chatCompletion('Hello')

      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/chat/completions`)
      expect(mock.history[0].headers).toMatchObject({
        'Authorization': `Bearer ${ API_KEY }`,
        'Content-Type': 'application/json',
      })
      expect(mock.history[0].body).toEqual({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: 'Hello' }],
      })
      expect(result).toEqual({
        text: 'Hi there',
        reasoning: null,
        model: 'llama-3.3-70b-versatile',
        finishReason: 'stop',
        usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
      })
    })

    it('includes system prompt and all optional params with resolved choices', async () => {
      mock.onPost(`${ BASE }/chat/completions`).reply({
        model: 'openai/gpt-oss-120b',
        choices: [{ message: { content: '{}', reasoning: 'thinking' }, finish_reason: 'stop' }],
        usage: {},
      })

      const result = await service.chatCompletion(
        'Give me JSON',
        'openai/gpt-oss-120b',
        'You are helpful',
        0.5,
        256,
        0.9,
        ['STOP', 'END'],
        42,
        true,
        'High',
        'Parsed'
      )

      expect(mock.history[0].body).toEqual({
        model: 'openai/gpt-oss-120b',
        messages: [
          { role: 'system', content: 'You are helpful' },
          { role: 'user', content: 'Give me JSON' },
        ],
        temperature: 0.5,
        max_completion_tokens: 256,
        top_p: 0.9,
        stop: ['STOP', 'END'],
        seed: 42,
        response_format: { type: 'json_object' },
        reasoning_effort: 'high',
        reasoning_format: 'parsed',
      })
      expect(result.reasoning).toBe('thinking')
    })

    it('keeps temperature 0 and does not send empty optional fields', async () => {
      mock.onPost(`${ BASE }/chat/completions`).reply({
        model: 'llama-3.3-70b-versatile',
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      })

      await service.chatCompletion('Hi', undefined, undefined, 0, undefined, undefined, [], undefined, false, '', '')

      expect(mock.history[0].body).toEqual({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: 'Hi' }],
        temperature: 0,
      })
    })

    it('defaults response fields when choices are absent', async () => {
      mock.onPost(`${ BASE }/chat/completions`).reply({ model: 'llama-3.3-70b-versatile' })

      const result = await service.chatCompletion('Hi')

      expect(result).toEqual({
        text: '',
        reasoning: null,
        model: 'llama-3.3-70b-versatile',
        finishReason: null,
        usage: null,
      })
    })

    it('throws when prompt is empty', async () => {
      await expect(service.chatCompletion('   ')).rejects.toThrow('Prompt is required')
      expect(mock.history).toHaveLength(0)
    })

    it('throws a normalized error on API failure', async () => {
      mock.onPost(`${ BASE }/chat/completions`).replyWithError({
        message: 'Request failed',
        body: { error: { message: 'Invalid model' } },
      })

      await expect(service.chatCompletion('Hi')).rejects.toThrow('Invalid model')
    })
  })

  describe('chatCompletionAdvanced', () => {
    it('sends messages array with defaults and returns raw response', async () => {
      const raw = { id: 'chatcmpl-1', choices: [{ message: { content: 'ok' } }], usage: {} }

      mock.onPost(`${ BASE }/chat/completions`).reply(raw)

      const messages = [{ role: 'user', content: 'Hello' }]
      const result = await service.chatCompletionAdvanced(messages)

      expect(mock.history[0].body).toEqual({
        model: 'llama-3.3-70b-versatile',
        messages,
      })
      expect(result).toEqual(raw)
    })

    it('includes tools, penalties, response format and string toolChoice', async () => {
      mock.onPost(`${ BASE }/chat/completions`).reply({ id: 'x' })

      const messages = [{ role: 'user', content: 'Hi' }]
      const tools = [{ type: 'function', function: { name: 'do_thing' } }]

      await service.chatCompletionAdvanced(
        messages,
        'openai/gpt-oss-120b',
        0.7,
        128,
        0.8,
        ['STOP'],
        7,
        { type: 'json_object' },
        tools,
        'auto',
        'Low',
        undefined,
        true,
        0.5,
        -0.5
      )

      expect(mock.history[0].body).toEqual({
        model: 'openai/gpt-oss-120b',
        messages,
        temperature: 0.7,
        max_completion_tokens: 128,
        top_p: 0.8,
        stop: ['STOP'],
        seed: 7,
        response_format: { type: 'json_object' },
        tools,
        frequency_penalty: 0.5,
        presence_penalty: -0.5,
        tool_choice: 'auto',
        reasoning_effort: 'low',
        include_reasoning: true,
      })
    })

    it('parses a JSON-object toolChoice string', async () => {
      mock.onPost(`${ BASE }/chat/completions`).reply({ id: 'x' })

      await service.chatCompletionAdvanced(
        [{ role: 'user', content: 'Hi' }],
        undefined,
        undefined, undefined, undefined, undefined, undefined, undefined, undefined,
        '{"type":"function","function":{"name":"my_tool"}}'
      )

      expect(mock.history[0].body.tool_choice).toEqual({
        type: 'function',
        function: { name: 'my_tool' },
      })
    })

    it('throws when messages array is empty', async () => {
      await expect(service.chatCompletionAdvanced([])).rejects.toThrow(
        'Messages array is required and must not be empty'
      )
      expect(mock.history).toHaveLength(0)
    })

    it('throws a normalized error on API failure', async () => {
      mock.onPost(`${ BASE }/chat/completions`).replyWithError({
        body: { error: { message: 'Bad request' } },
      })

      await expect(
        service.chatCompletionAdvanced([{ role: 'user', content: 'Hi' }])
      ).rejects.toThrow('Bad request')
    })
  })

  // ── Vision ──

  describe('analyzeImage', () => {
    it('builds multimodal content with defaults', async () => {
      mock.onPost(`${ BASE }/chat/completions`).reply({
        model: 'meta-llama/llama-4-scout-17b-16e-instruct',
        choices: [{ message: { content: 'A dog' }, finish_reason: 'stop' }],
        usage: { total_tokens: 100 },
      })

      const result = await service.analyzeImage('Describe', ['https://img/1.jpg'])

      expect(mock.history[0].body).toEqual({
        model: 'meta-llama/llama-4-scout-17b-16e-instruct',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Describe' },
              { type: 'image_url', image_url: { url: 'https://img/1.jpg' } },
            ],
          },
        ],
      })
      expect(result).toEqual({
        text: 'A dog',
        model: 'meta-llama/llama-4-scout-17b-16e-instruct',
        finishReason: 'stop',
        usage: { total_tokens: 100 },
      })
    })

    it('includes custom model, temperature, max tokens and json mode', async () => {
      mock.onPost(`${ BASE }/chat/completions`).reply({
        model: 'custom-vision',
        choices: [{ message: { content: '{}' }, finish_reason: 'stop' }],
      })

      await service.analyzeImage(
        'Extract text',
        ['https://img/1.jpg', 'data:image/png;base64,AAA'],
        'custom-vision',
        0.2,
        512,
        true
      )

      expect(mock.history[0].body.model).toBe('custom-vision')
      expect(mock.history[0].body.temperature).toBe(0.2)
      expect(mock.history[0].body.max_completion_tokens).toBe(512)
      expect(mock.history[0].body.response_format).toEqual({ type: 'json_object' })
      expect(mock.history[0].body.messages[0].content).toHaveLength(3)
    })

    it('throws when prompt is empty', async () => {
      await expect(service.analyzeImage('', ['https://img/1.jpg'])).rejects.toThrow('Prompt is required')
    })

    it('throws when no image URLs are provided', async () => {
      await expect(service.analyzeImage('Describe', [])).rejects.toThrow(
        'At least one image URL is required'
      )
    })

    it('throws when more than 5 images are provided', async () => {
      const urls = Array.from({ length: 6 }, (_, i) => `https://img/${ i }.jpg`)

      await expect(service.analyzeImage('Describe', urls)).rejects.toThrow(
        'A maximum of 5 images per request is supported'
      )
    })

    it('throws a normalized error on API failure', async () => {
      mock.onPost(`${ BASE }/chat/completions`).replyWithError({
        body: { error: { message: 'Vision failed' } },
      })

      await expect(service.analyzeImage('Describe', ['https://img/1.jpg'])).rejects.toThrow(
        'Vision failed'
      )
    })
  })

  // ── Audio: Speech to Text ──

  describe('transcribeAudio', () => {
    it('downloads the file then uploads a multipart form with defaults', async () => {
      mock.onGet('https://files/audio.mp3').reply(Buffer.from('AUDIO'))
      mock.onPost(`${ BASE }/audio/transcriptions`).reply({ text: 'Hello world' })

      const result = await service.transcribeAudio('https://files/audio.mp3')

      // First call is the download GET, second is the multipart POST.
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe('https://files/audio.mp3')
      expect(mock.history[0].encoding).toBeNull()

      const post = mock.history[1]

      expect(post.method).toBe('post')
      expect(post.url).toBe(`${ BASE }/audio/transcriptions`)
      expect(post.headers).toMatchObject({ 'Authorization': `Bearer ${ API_KEY }` })
      expect(fieldValue(post, 'model')).toBe('whisper-large-v3-turbo')
      expect(fieldValue(post, 'response_format')).toBe('json')

      const fileField = formFields(post).find(f => f.name === 'file')

      expect(Buffer.isBuffer(fileField.value)).toBe(true)
      expect(fileField.filename).toEqual({ filename: 'audio.mp3' })
      expect(result).toEqual({ text: 'Hello world' })
    })

    it('resolves format choices, language, prompt and temperature', async () => {
      mock.onGet('https://files/audio.wav').reply(Buffer.from('AUDIO'))
      mock.onPost(`${ BASE }/audio/transcriptions`).reply({ text: 'hi' })

      await service.transcribeAudio(
        'https://files/audio.wav',
        'whisper-large-v3',
        'en',
        'context words',
        'Verbose JSON',
        0.3
      )

      const post = mock.history[1]

      expect(fieldValue(post, 'model')).toBe('whisper-large-v3')
      expect(fieldValue(post, 'response_format')).toBe('verbose_json')
      expect(fieldValue(post, 'language')).toBe('en')
      expect(fieldValue(post, 'prompt')).toBe('context words')
      expect(fieldValue(post, 'temperature')).toBe('0.3')
    })

    it('forces verbose_json and appends timestamp granularities', async () => {
      mock.onGet('https://files/audio.mp3').reply(Buffer.from('AUDIO'))
      mock.onPost(`${ BASE }/audio/transcriptions`).reply({ text: 'hi', segments: [] })

      await service.transcribeAudio(
        'https://files/audio.mp3',
        undefined,
        undefined,
        undefined,
        'Text',
        undefined,
        ['Word', 'Segment']
      )

      const post = mock.history[1]

      expect(fieldValue(post, 'response_format')).toBe('verbose_json')

      const granularities = formFields(post)
        .filter(f => f.name === 'timestamp_granularities[]')
        .map(f => f.value)

      expect(granularities).toEqual(['word', 'segment'])
    })

    it('wraps a plain-text response into an object', async () => {
      mock.onGet('https://files/audio.mp3').reply(Buffer.from('AUDIO'))
      mock.onPost(`${ BASE }/audio/transcriptions`).reply('Just plain text')

      const result = await service.transcribeAudio('https://files/audio.mp3')

      expect(result).toEqual({ text: 'Just plain text' })
    })

    it('throws on an invalid file URL', async () => {
      await expect(service.transcribeAudio('ftp://bad/url')).rejects.toThrow(
        "Invalid fileUrl 'ftp://bad/url'"
      )
    })
  })

  describe('translateAudio', () => {
    it('uploads a multipart form to the translations endpoint with defaults', async () => {
      mock.onGet('https://files/foreign.mp3').reply(Buffer.from('AUDIO'))
      mock.onPost(`${ BASE }/audio/translations`).reply({ text: 'translated' })

      const result = await service.translateAudio('https://files/foreign.mp3')

      const post = mock.history[1]

      expect(post.url).toBe(`${ BASE }/audio/translations`)
      expect(fieldValue(post, 'model')).toBe('whisper-large-v3')
      expect(fieldValue(post, 'response_format')).toBe('json')
      expect(result).toEqual({ text: 'translated' })
    })

    it('includes prompt, response format and temperature', async () => {
      mock.onGet('https://files/foreign.mp3').reply(Buffer.from('AUDIO'))
      mock.onPost(`${ BASE }/audio/translations`).reply({ text: 't' })

      await service.translateAudio('https://files/foreign.mp3', 'whisper-large-v3', 'names', 'Text', 0)

      const post = mock.history[1]

      expect(fieldValue(post, 'response_format')).toBe('text')
      expect(fieldValue(post, 'prompt')).toBe('names')
      expect(fieldValue(post, 'temperature')).toBe('0')
    })

    it('throws a normalized error on API failure', async () => {
      mock.onGet('https://files/foreign.mp3').reply(Buffer.from('AUDIO'))
      mock.onPost(`${ BASE }/audio/translations`).replyWithError({
        body: { error: { message: 'Translation failed' } },
      })

      await expect(service.translateAudio('https://files/foreign.mp3')).rejects.toThrow(
        'Translation failed'
      )
    })
  })

  // ── Audio: Text to Speech ──

  describe('textToSpeech', () => {
    function stubFiles() {
      const uploadFile = jest.fn().mockResolvedValue({ url: 'https://storage/tts.wav' })

      service.flowrunner = { Files: { uploadFile } }

      return uploadFile
    }

    it('requests binary audio and uploads it to file storage with defaults', async () => {
      const uploadFile = stubFiles()

      mock.onPost(`${ BASE }/audio/speech`).reply(Buffer.from('WAVDATA'))

      const result = await service.textToSpeech('Hello world')

      const post = mock.history[0]

      expect(post.method).toBe('post')
      expect(post.url).toBe(`${ BASE }/audio/speech`)
      expect(post.encoding).toBeNull()
      expect(post.body).toEqual({
        model: 'canopylabs/orpheus-v1-english',
        input: 'Hello world',
        voice: 'troy',
        response_format: 'wav',
      })

      expect(uploadFile).toHaveBeenCalledTimes(1)

      const [buffer, options] = uploadFile.mock.calls[0]

      expect(Buffer.isBuffer(buffer)).toBe(true)
      expect(options).toMatchObject({ generateUrl: true, overwrite: true, scope: 'FLOW' })
      expect(options.filename).toMatch(/^tts_\d+\.wav$/)
      expect(result).toEqual({ fileURL: 'https://storage/tts.wav' })
    })

    it('resolves format, voice, sample rate and speed and uses provided fileOptions', async () => {
      const uploadFile = stubFiles()

      mock.onPost(`${ BASE }/audio/speech`).reply(Buffer.from('MP3DATA'))

      await service.textToSpeech('Hi', 'canopylabs/orpheus-arabic-saudi', 'noura', 'MP3', 24000, 1.5, {
        scope: 'APP',
      })

      expect(mock.history[0].body).toEqual({
        model: 'canopylabs/orpheus-arabic-saudi',
        input: 'Hi',
        voice: 'noura',
        response_format: 'mp3',
        sample_rate: 24000,
        speed: 1.5,
      })

      const options = uploadFile.mock.calls[0][1]

      expect(options.scope).toBe('APP')
      expect(options.filename).toMatch(/^tts_\d+\.mp3$/)
    })

    it('throws when input text is empty', async () => {
      await expect(service.textToSpeech('  ')).rejects.toThrow('Input text is required')
      expect(mock.history).toHaveLength(0)
    })

    it('throws a normalized error on API failure', async () => {
      stubFiles()
      mock.onPost(`${ BASE }/audio/speech`).replyWithError({
        body: { error: { message: 'TTS failed' } },
      })

      await expect(service.textToSpeech('Hi')).rejects.toThrow('TTS failed')
    })
  })

  // ── Files ──

  describe('uploadFile', () => {
    it('uploads raw JSONL content as a multipart form', async () => {
      mock.onPost(`${ BASE }/files`).reply({ id: 'file_1', filename: 'batch.jsonl' })

      const result = await service.uploadFile(undefined, '{"a":1}\n{"b":2}', 'my-batch.jsonl')

      const post = mock.history[0]

      expect(post.method).toBe('post')
      expect(post.url).toBe(`${ BASE }/files`)
      expect(fieldValue(post, 'purpose')).toBe('batch')

      const fileField = formFields(post).find(f => f.name === 'file')

      expect(Buffer.isBuffer(fileField.value)).toBe(true)
      expect(fileField.value.toString('utf8')).toBe('{"a":1}\n{"b":2}')
      expect(fileField.filename).toEqual({ filename: 'my-batch.jsonl' })
      expect(result).toEqual({ id: 'file_1', filename: 'batch.jsonl' })
    })

    it('downloads a file from a URL and uploads it with the derived filename', async () => {
      mock.onGet('https://files/input.jsonl').reply(Buffer.from('LINE'))
      mock.onPost(`${ BASE }/files`).reply({ id: 'file_2' })

      await service.uploadFile('https://files/input.jsonl')

      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe('https://files/input.jsonl')

      const post = mock.history[1]
      const fileField = formFields(post).find(f => f.name === 'file')

      expect(fileField.filename).toEqual({ filename: 'input.jsonl' })
    })

    it('throws when neither file URL nor content is provided', async () => {
      await expect(service.uploadFile()).rejects.toThrow(
        'Either File URL or JSONL Content is required'
      )
      expect(mock.history).toHaveLength(0)
    })

    it('throws a normalized error on API failure', async () => {
      mock.onPost(`${ BASE }/files`).replyWithError({
        body: { error: { message: 'Upload failed' } },
      })

      await expect(service.uploadFile(undefined, '{"a":1}')).rejects.toThrow('Upload failed')
    })
  })

  describe('listFiles', () => {
    it('gets the files list', async () => {
      mock.onGet(`${ BASE }/files`).reply({ object: 'list', data: [] })

      const result = await service.listFiles()

      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/files`)
      expect(result).toEqual({ object: 'list', data: [] })
    })

    it('throws a normalized error on API failure', async () => {
      mock.onGet(`${ BASE }/files`).replyWithError({ body: { error: { message: 'Boom' } } })

      await expect(service.listFiles()).rejects.toThrow('Boom')
    })
  })

  describe('getFile', () => {
    it('fetches a file by id with url encoding', async () => {
      mock.onGet(`${ BASE }/files/file_1`).reply({ id: 'file_1' })

      const result = await service.getFile('file_1')

      expect(mock.history[0].url).toBe(`${ BASE }/files/file_1`)
      expect(result).toEqual({ id: 'file_1' })
    })

    it('throws when file id is missing', async () => {
      await expect(service.getFile()).rejects.toThrow('File ID is required')
      expect(mock.history).toHaveLength(0)
    })

    it('throws a normalized error on API failure', async () => {
      mock.onGet(`${ BASE }/files/file_1`).replyWithError({ body: { error: { message: 'Not found' } } })

      await expect(service.getFile('file_1')).rejects.toThrow('Not found')
    })
  })

  describe('deleteFile', () => {
    it('deletes a file by id', async () => {
      mock.onDelete(`${ BASE }/files/file_1`).reply({ id: 'file_1', deleted: true })

      const result = await service.deleteFile('file_1')

      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${ BASE }/files/file_1`)
      expect(result).toEqual({ id: 'file_1', deleted: true })
    })

    it('throws when file id is missing', async () => {
      await expect(service.deleteFile()).rejects.toThrow('File ID is required')
    })

    it('throws a normalized error on API failure', async () => {
      mock.onDelete(`${ BASE }/files/file_1`).replyWithError({ body: { error: { message: 'Boom' } } })

      await expect(service.deleteFile('file_1')).rejects.toThrow('Boom')
    })
  })

  describe('downloadFileContent', () => {
    function stubFiles() {
      const uploadFile = jest.fn().mockResolvedValue({ url: 'https://storage/results.jsonl' })

      service.flowrunner = { Files: { uploadFile } }

      return uploadFile
    }

    it('downloads binary content, resolves filename via metadata and uploads it', async () => {
      const uploadFile = stubFiles()

      mock.onGet(`${ BASE }/files/file_1/content`).reply(Buffer.from('{"r":1}'))
      mock.onGet(`${ BASE }/files/file_1`).reply({ id: 'file_1', filename: 'results.jsonl' })

      const result = await service.downloadFileContent('file_1')

      const contentCall = mock.history.find(c => c.url === `${ BASE }/files/file_1/content`)

      expect(contentCall.method).toBe('get')
      expect(contentCall.encoding).toBeNull()

      const options = uploadFile.mock.calls[0][1]

      expect(options.filename).toBe('results.jsonl')
      expect(options).toMatchObject({ generateUrl: true, overwrite: true, scope: 'FLOW' })
      expect(result).toEqual({
        fileURL: 'https://storage/results.jsonl',
        filename: 'results.jsonl',
        content: null,
      })
    })

    it('returns raw content when includeContent is true', async () => {
      stubFiles()

      mock.onGet(`${ BASE }/files/file_1/content`).reply(Buffer.from('{"r":1}'))
      mock.onGet(`${ BASE }/files/file_1`).reply({ id: 'file_1', filename: 'results.jsonl' })

      const result = await service.downloadFileContent('file_1', true)

      expect(result.content).toBe('{"r":1}')
    })

    it('falls back to a generated filename when metadata lookup fails', async () => {
      const uploadFile = stubFiles()

      mock.onGet(`${ BASE }/files/file_1/content`).reply(Buffer.from('DATA'))
      mock.onGet(`${ BASE }/files/file_1`).replyWithError({ body: { error: { message: 'Not found' } } })

      const result = await service.downloadFileContent('file_1')

      expect(uploadFile.mock.calls[0][1].filename).toMatch(/^groq_file_\d+\.jsonl$/)
      expect(result.filename).toMatch(/^groq_file_\d+\.jsonl$/)
    })

    it('throws when file id is missing', async () => {
      await expect(service.downloadFileContent()).rejects.toThrow('File ID is required')
    })
  })

  // ── Batches ──

  describe('createBatch', () => {
    it('creates a batch with resolved endpoint and completion window defaults', async () => {
      mock.onPost(`${ BASE }/batches`).reply({ id: 'batch_1', status: 'validating' })

      const result = await service.createBatch('file_1')

      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/batches`)
      expect(mock.history[0].body).toEqual({
        input_file_id: 'file_1',
        endpoint: '/v1/chat/completions',
        completion_window: '24h',
      })
      expect(result).toEqual({ id: 'batch_1', status: 'validating' })
    })

    it('resolves choice labels and includes metadata', async () => {
      mock.onPost(`${ BASE }/batches`).reply({ id: 'batch_2' })

      await service.createBatch('file_1', 'Audio Transcriptions', '48 Hours', { job: 'nightly' })

      expect(mock.history[0].body).toEqual({
        input_file_id: 'file_1',
        endpoint: '/v1/audio/transcriptions',
        completion_window: '48h',
        metadata: { job: 'nightly' },
      })
    })

    it('omits empty metadata', async () => {
      mock.onPost(`${ BASE }/batches`).reply({ id: 'batch_3' })

      await service.createBatch('file_1', 'Chat Completions', '24 Hours', {})

      expect(mock.history[0].body.metadata).toBeUndefined()
    })

    it('throws when input file id is missing', async () => {
      await expect(service.createBatch()).rejects.toThrow('Input file ID is required')
      expect(mock.history).toHaveLength(0)
    })

    it('throws a normalized error on API failure', async () => {
      mock.onPost(`${ BASE }/batches`).replyWithError({ body: { error: { message: 'Boom' } } })

      await expect(service.createBatch('file_1')).rejects.toThrow('Boom')
    })
  })

  describe('getBatch', () => {
    it('fetches a batch by id', async () => {
      mock.onGet(`${ BASE }/batches/batch_1`).reply({ id: 'batch_1', status: 'completed' })

      const result = await service.getBatch('batch_1')

      expect(mock.history[0].url).toBe(`${ BASE }/batches/batch_1`)
      expect(result).toEqual({ id: 'batch_1', status: 'completed' })
    })

    it('throws when batch id is missing', async () => {
      await expect(service.getBatch()).rejects.toThrow('Batch ID is required')
    })

    it('throws a normalized error on API failure', async () => {
      mock.onGet(`${ BASE }/batches/batch_1`).replyWithError({ body: { error: { message: 'Boom' } } })

      await expect(service.getBatch('batch_1')).rejects.toThrow('Boom')
    })
  })

  describe('listBatches', () => {
    it('sends no query params by default', async () => {
      mock.onGet(`${ BASE }/batches`).reply({ object: 'list', data: [] })

      await service.listBatches()

      expect(mock.history[0].query).toEqual({})
    })

    it('passes limit and after query params', async () => {
      mock.onGet(`${ BASE }/batches`).reply({ object: 'list', data: [] })

      await service.listBatches(50, 'batch_5')

      expect(mock.history[0].query).toEqual({ limit: 50, after: 'batch_5' })
    })

    it('throws a normalized error on API failure', async () => {
      mock.onGet(`${ BASE }/batches`).replyWithError({ body: { error: { message: 'Boom' } } })

      await expect(service.listBatches()).rejects.toThrow('Boom')
    })
  })

  describe('cancelBatch', () => {
    it('posts to the cancel endpoint with an empty body', async () => {
      mock.onPost(`${ BASE }/batches/batch_1/cancel`).reply({ id: 'batch_1', status: 'cancelling' })

      const result = await service.cancelBatch('batch_1')

      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/batches/batch_1/cancel`)
      expect(mock.history[0].body).toEqual({})
      expect(result).toEqual({ id: 'batch_1', status: 'cancelling' })
    })

    it('throws when batch id is missing', async () => {
      await expect(service.cancelBatch()).rejects.toThrow('Batch ID is required')
    })

    it('throws a normalized error on API failure', async () => {
      mock.onPost(`${ BASE }/batches/batch_1/cancel`).replyWithError({ body: { error: { message: 'Boom' } } })

      await expect(service.cancelBatch('batch_1')).rejects.toThrow('Boom')
    })
  })

  // ── Models ──

  describe('listModels', () => {
    it('gets the models list', async () => {
      mock.onGet(`${ BASE }/models`).reply({ object: 'list', data: [{ id: 'llama-3.3-70b-versatile' }] })

      const result = await service.listModels()

      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/models`)
      expect(result.data).toHaveLength(1)
    })

    it('throws a normalized error on API failure', async () => {
      mock.onGet(`${ BASE }/models`).replyWithError({ body: { error: { message: 'Boom' } } })

      await expect(service.listModels()).rejects.toThrow('Boom')
    })
  })

  describe('getModel', () => {
    it('fetches a model by id', async () => {
      mock.onGet(`${ BASE }/models/llama-3.3-70b-versatile`).reply({ id: 'llama-3.3-70b-versatile' })

      const result = await service.getModel('llama-3.3-70b-versatile')

      expect(mock.history[0].url).toBe(`${ BASE }/models/llama-3.3-70b-versatile`)
      expect(result).toEqual({ id: 'llama-3.3-70b-versatile' })
    })

    it('throws when model id is missing', async () => {
      await expect(service.getModel()).rejects.toThrow('Model ID is required')
    })

    it('throws a normalized error on API failure', async () => {
      mock.onGet(`${ BASE }/models/x`).replyWithError({ body: { error: { message: 'Boom' } } })

      await expect(service.getModel('x')).rejects.toThrow('Boom')
    })
  })

  // ── Error normalization ──

  describe('error normalization', () => {
    it('surfaces body.message when body.error.message is absent', async () => {
      mock.onGet(`${ BASE }/models`).replyWithError({
        message: 'Original',
        body: { message: 'Top-level message' },
      })

      await expect(service.listModels()).rejects.toThrow('Top-level message')
    })

    it('falls back to error.message when no body message exists', async () => {
      mock.onGet(`${ BASE }/models`).replyWithError({ message: 'Plain failure' })

      await expect(service.listModels()).rejects.toThrow('Plain failure')
    })
  })
})
