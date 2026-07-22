'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-openrouter-api-key'
const BASE = 'https://openrouter.ai/api/v1'

describe('OpenRouter Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ apiKey: API_KEY, httpReferer: 'https://myapp.com', appTitle: 'MyApp' })
    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()

    // Mock flowrunner.Files for methods that upload files
    service.flowrunner = {
      Files: {
        uploadFile: jest.fn().mockResolvedValue({ url: 'https://files.example.com/uploaded-file.png' }),
      },
    }
  })

  afterEach(() => {
    mock.reset()
    jest.clearAllMocks()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Registration ──

  describe('service registration', () => {
    it('registers with correct config items', () => {
      const configItems = sandbox.getConfigItems()

      expect(configItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'apiKey', required: true, shared: false }),
          expect.objectContaining({ name: 'httpReferer', required: false, shared: false }),
          expect.objectContaining({ name: 'appTitle', required: false, shared: false }),
        ])
      )
    })
  })

  // ── Dictionary Methods ──

  describe('getModelsDictionary', () => {
    it('returns mapped items with label, value, and note', async () => {
      mock.onGet(`${BASE}/models`).reply({
        data: [
          { id: 'anthropic/claude-sonnet-4.5', name: 'Claude Sonnet 4.5', context_length: 1000000, pricing: { prompt: '0.000003', completion: '0.000015' } },
        ],
        links: {},
      })

      const result = await service.getModelsDictionary({})

      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toMatchObject({ label: 'Claude Sonnet 4.5', value: 'anthropic/claude-sonnet-4.5' })
      expect(result.items[0].note).toContain('1000000 ctx')
      expect(result.cursor).toBeNull()
    })

    it('passes search query to API', async () => {
      mock.onGet(`${BASE}/models`).reply({ data: [], links: {} })

      await service.getModelsDictionary({ search: 'claude' })

      expect(mock.history[0].query).toMatchObject({ q: 'claude', limit: 50, offset: 0 })
    })

    it('handles pagination cursor', async () => {
      mock.onGet(`${BASE}/models`).reply({ data: [{ id: 'a/b', name: 'B' }], links: { next: 'something' } })

      const result = await service.getModelsDictionary({ cursor: '50' })

      expect(mock.history[0].query).toMatchObject({ offset: 50 })
      expect(result.cursor).toBe('51')
    })

    it('handles null payload', async () => {
      mock.onGet(`${BASE}/models`).reply({ data: [], links: {} })

      const result = await service.getModelsDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('handles null data in response', async () => {
      mock.onGet(`${BASE}/models`).reply({ data: null })

      const result = await service.getModelsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getChatModelsDictionary', () => {
    it('passes output_modalities text filter', async () => {
      mock.onGet(`${BASE}/models`).reply({ data: [], links: {} })

      await service.getChatModelsDictionary({})

      expect(mock.history[0].query).toMatchObject({ output_modalities: 'text' })
    })
  })

  describe('getVisionModelsDictionary', () => {
    it('passes image input and text output modality filters', async () => {
      mock.onGet(`${BASE}/models`).reply({ data: [], links: {} })

      await service.getVisionModelsDictionary({})

      expect(mock.history[0].query).toMatchObject({ input_modalities: 'image', output_modalities: 'text' })
    })
  })

  describe('getImageModelsDictionary', () => {
    it('calls the images/models endpoint', async () => {
      mock.onGet(`${BASE}/images/models`).reply({ data: [{ id: 'model/img', name: 'Img Model' }] })

      const result = await service.getImageModelsDictionary({})

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('model/img')
    })

    it('filters by client-side search', async () => {
      mock.onGet(`${BASE}/images/models`).reply({
        data: [
          { id: 'bytedance/seedream', name: 'Seedream' },
          { id: 'openai/dall-e', name: 'DALL-E' },
        ],
      })

      const result = await service.getImageModelsDictionary({ search: 'seed' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('bytedance/seedream')
    })

    it('paginates client-side with cursor', async () => {
      const models = Array.from({ length: 60 }, (_, i) => ({ id: `m/m${i}`, name: `Model ${i}` }))

      mock.onGet(`${BASE}/images/models`).reply({ data: models })

      const result = await service.getImageModelsDictionary({ cursor: '0' })

      expect(result.items).toHaveLength(50)
      expect(result.cursor).toBe('50')
    })
  })

  describe('getVideoModelsDictionary', () => {
    it('calls the videos/models endpoint', async () => {
      mock.onGet(`${BASE}/videos/models`).reply({ data: [] })

      const result = await service.getVideoModelsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getEmbeddingsModelsDictionary', () => {
    it('calls the embeddings/models endpoint', async () => {
      mock.onGet(`${BASE}/embeddings/models`).reply({ data: [] })

      const result = await service.getEmbeddingsModelsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getTtsModelsDictionary', () => {
    it('passes audio output modality and filters by voices or tts in id', async () => {
      mock.onGet(`${BASE}/models`).reply({
        data: [
          { id: 'openai/gpt-4o-mini-tts', name: 'GPT-4o Mini TTS', supported_voices: ['alloy'] },
          { id: 'some/chat-model', name: 'Chat Model' },
        ],
        links: {},
      })

      const result = await service.getTtsModelsDictionary({})

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('openai/gpt-4o-mini-tts')
      expect(mock.history[0].query).toMatchObject({ output_modalities: 'audio' })
    })
  })

  describe('getSttModelsDictionary', () => {
    it('passes audio input and text output modality filters', async () => {
      mock.onGet(`${BASE}/models`).reply({ data: [], links: {} })

      await service.getSttModelsDictionary({})

      expect(mock.history[0].query).toMatchObject({ input_modalities: 'audio', output_modalities: 'text' })
    })
  })

  describe('getRerankModelsDictionary', () => {
    it('defaults search to "rerank" and filters by rerank id', async () => {
      mock.onGet(`${BASE}/models`).reply({
        data: [
          { id: 'cohere/rerank-v3.5', name: 'Rerank v3.5' },
          { id: 'some/other-model', name: 'Other' },
        ],
        links: {},
      })

      const result = await service.getRerankModelsDictionary({})

      expect(mock.history[0].query).toMatchObject({ q: 'rerank' })
      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('cohere/rerank-v3.5')
    })

    it('uses custom search when provided', async () => {
      mock.onGet(`${BASE}/models`).reply({
        data: [{ id: 'cohere/rerank-v3.5', name: 'Rerank' }],
        links: {},
      })

      await service.getRerankModelsDictionary({ search: 'cohere' })

      expect(mock.history[0].query).toMatchObject({ q: 'cohere' })
    })
  })

  describe('getVoicesDictionary', () => {
    it('returns empty when no model criteria provided', async () => {
      const result = await service.getVoicesDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
      expect(mock.history).toHaveLength(0)
    })

    it('returns voices for a given model', async () => {
      mock.onGet(`${BASE}/models`).reply({
        data: [
          { id: 'openai/gpt-4o-mini-tts', supported_voices: ['alloy', 'echo', 'nova'] },
        ],
      })

      const result = await service.getVoicesDictionary({ criteria: { model: 'openai/gpt-4o-mini-tts' } })

      expect(result.items).toHaveLength(3)
      expect(result.items[0]).toEqual({ label: 'alloy', value: 'alloy', note: 'openai/gpt-4o-mini-tts' })
    })

    it('filters voices by search', async () => {
      mock.onGet(`${BASE}/models`).reply({
        data: [
          { id: 'openai/gpt-4o-mini-tts', supported_voices: ['alloy', 'echo', 'nova'] },
        ],
      })

      const result = await service.getVoicesDictionary({ search: 'all', criteria: { model: 'openai/gpt-4o-mini-tts' } })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('alloy')
    })

    it('returns empty voices when model not found', async () => {
      mock.onGet(`${BASE}/models`).reply({ data: [] })

      const result = await service.getVoicesDictionary({ criteria: { model: 'unknown/model' } })

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  // ── Chat Methods ──

  describe('chatCompletion', () => {
    const chatUrl = `${BASE}/chat/completions`

    it('sends correct request with minimal parameters', async () => {
      mock.onPost(chatUrl).reply({
        choices: [{ message: { content: 'Hello!' }, finish_reason: 'stop' }],
        model: 'openrouter/auto',
        provider: 'OpenAI',
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        id: 'gen-123',
      })

      const result = await service.chatCompletion('Say hello')

      expect(result).toEqual({
        text: 'Hello!',
        reasoning: null,
        model: 'openrouter/auto',
        provider: 'OpenAI',
        finishReason: 'stop',
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        id: 'gen-123',
      })

      expect(mock.history[0].body).toMatchObject({
        model: 'openrouter/auto',
        messages: [{ role: 'user', content: 'Say hello' }],
      })

      expect(mock.history[0].headers).toMatchObject({
        'Authorization': `Bearer ${API_KEY}`,
        'HTTP-Referer': 'https://myapp.com',
        'X-OpenRouter-Title': 'MyApp',
      })
    })

    it('includes system prompt when provided', async () => {
      mock.onPost(chatUrl).reply({ choices: [{ message: { content: 'ok' } }] })

      await service.chatCompletion('Hi', undefined, 'Be helpful')

      const body = mock.history[0].body

      expect(body.messages).toEqual([
        { role: 'system', content: 'Be helpful' },
        { role: 'user', content: 'Hi' },
      ])
    })

    it('includes all optional parameters', async () => {
      mock.onPost(chatUrl).reply({ choices: [{ message: { content: 'ok' } }] })

      await service.chatCompletion(
        'test', 'anthropic/claude-sonnet-4.5', 'system', ['openai/gpt-5.2'],
        0.5, 100, 0.9, 42, ['STOP'], true, true, 'High', 'Price'
      )

      const body = mock.history[0].body

      expect(body.model).toBe('anthropic/claude-sonnet-4.5')
      expect(body.models).toEqual(['openai/gpt-5.2'])
      expect(body.temperature).toBe(0.5)
      expect(body.max_completion_tokens).toBe(100)
      expect(body.top_p).toBe(0.9)
      expect(body.seed).toBe(42)
      expect(body.stop).toEqual(['STOP'])
      expect(body.response_format).toEqual({ type: 'json_object' })
      expect(body.plugins).toEqual([{ id: 'web' }])
      expect(body.reasoning).toEqual({ effort: 'high' })
      expect(body.provider).toEqual({ sort: 'price' })
    })

    it('omits optional fields when not provided', async () => {
      mock.onPost(chatUrl).reply({ choices: [{ message: { content: 'ok' } }] })

      await service.chatCompletion('test')

      const body = mock.history[0].body

      expect(body).not.toHaveProperty('models')
      expect(body).not.toHaveProperty('temperature')
      expect(body).not.toHaveProperty('max_completion_tokens')
      expect(body).not.toHaveProperty('reasoning')
      expect(body).not.toHaveProperty('provider')
      expect(body).not.toHaveProperty('response_format')
      expect(body).not.toHaveProperty('plugins')
    })

    it('throws when prompt is empty', async () => {
      await expect(service.chatCompletion('')).rejects.toThrow('Prompt is required')
    })

    it('throws on API error', async () => {
      mock.onPost(chatUrl).replyWithError({
        message: 'Unauthorized',
        body: { error: { message: 'Invalid API key' } },
      })

      await expect(service.chatCompletion('test')).rejects.toThrow('Invalid API key')
    })

    it('handles reasoning in response', async () => {
      mock.onPost(chatUrl).reply({
        choices: [{ message: { content: 'ok', reasoning: 'I thought about it' }, finish_reason: 'stop' }],
        model: 'some/model',
      })

      const result = await service.chatCompletion('test')

      expect(result.reasoning).toBe('I thought about it')
    })
  })

  describe('chatCompletionAdvanced', () => {
    const chatUrl = `${BASE}/chat/completions`

    it('sends correct request with minimal parameters', async () => {
      const messages = [{ role: 'user', content: 'Hello' }]

      mock.onPost(chatUrl).reply({
        id: 'gen-abc',
        choices: [{ message: { content: 'Hi' } }],
      })

      const result = await service.chatCompletionAdvanced(messages)

      expect(mock.history[0].body).toMatchObject({
        model: 'openrouter/auto',
        messages,
      })
      expect(result).toHaveProperty('id', 'gen-abc')
    })

    it('sends all advanced parameters', async () => {
      const messages = [{ role: 'user', content: 'test' }]

      mock.onPost(chatUrl).reply({ id: 'gen-1' })

      await service.chatCompletionAdvanced(
        messages, 'anthropic/claude-sonnet-4.5',
        ['openai/gpt-5.2'], // models
        { sort: 'price' }, // provider
        { effort: 'high' }, // reasoning
        [{ id: 'web' }], // plugins
        [{ type: 'function', function: { name: 'test' } }], // tools
        '{"type":"function","function":{"name":"test"}}', // toolChoice (JSON string)
        { type: 'json_object' }, // responseFormat
        0.5, 0.9, 40, 0.1, 200, ['STOP'], 42, 0.5, 0.5, 1.2, 'user-123'
      )

      const body = mock.history[0].body

      expect(body.model).toBe('anthropic/claude-sonnet-4.5')
      expect(body.models).toEqual(['openai/gpt-5.2'])
      expect(body.provider).toEqual({ sort: 'price' })
      expect(body.reasoning).toEqual({ effort: 'high' })
      expect(body.plugins).toEqual([{ id: 'web' }])
      expect(body.tools).toHaveLength(1)
      expect(body.tool_choice).toEqual({ type: 'function', function: { name: 'test' } })
      expect(body.response_format).toEqual({ type: 'json_object' })
      expect(body.temperature).toBe(0.5)
      expect(body.top_p).toBe(0.9)
      expect(body.top_k).toBe(40)
      expect(body.min_p).toBe(0.1)
      expect(body.max_completion_tokens).toBe(200)
      expect(body.stop).toEqual(['STOP'])
      expect(body.seed).toBe(42)
      expect(body.frequency_penalty).toBe(0.5)
      expect(body.presence_penalty).toBe(0.5)
      expect(body.repetition_penalty).toBe(1.2)
      expect(body.user).toBe('user-123')
    })

    it('handles string tool choice (auto/none/required)', async () => {
      mock.onPost(chatUrl).reply({ id: 'gen-1' })

      await service.chatCompletionAdvanced(
        [{ role: 'user', content: 'test' }],
        undefined, undefined, undefined, undefined, undefined, undefined,
        'auto' // toolChoice as plain string
      )

      expect(mock.history[0].body.tool_choice).toBe('auto')
    })

    it('throws when messages array is empty', async () => {
      await expect(service.chatCompletionAdvanced([])).rejects.toThrow('Messages array is required')
    })

    it('throws when messages is null', async () => {
      await expect(service.chatCompletionAdvanced(null)).rejects.toThrow('Messages array is required')
    })
  })

  describe('analyzeImage', () => {
    const chatUrl = `${BASE}/chat/completions`

    it('sends correct vision request', async () => {
      mock.onPost(chatUrl).reply({
        choices: [{ message: { content: 'A dog' }, finish_reason: 'stop' }],
        model: 'google/gemini-2.5-flash',
        provider: 'Google',
        usage: { prompt_tokens: 800, completion_tokens: 5, total_tokens: 805 },
      })

      const result = await service.analyzeImage('Describe this', ['https://example.com/img.jpg'])

      expect(result).toEqual({
        text: 'A dog',
        model: 'google/gemini-2.5-flash',
        provider: 'Google',
        finishReason: 'stop',
        usage: { prompt_tokens: 800, completion_tokens: 5, total_tokens: 805 },
      })

      const body = mock.history[0].body

      expect(body.model).toBe('google/gemini-2.5-flash')
      expect(body.messages[0].content).toEqual([
        { type: 'text', text: 'Describe this' },
        { type: 'image_url', image_url: { url: 'https://example.com/img.jpg' } },
      ])
    })

    it('supports multiple images', async () => {
      mock.onPost(chatUrl).reply({ choices: [{ message: { content: 'ok' } }] })

      await service.analyzeImage('Compare', ['https://a.com/1.jpg', 'https://b.com/2.jpg'])

      const content = mock.history[0].body.messages[0].content

      expect(content).toHaveLength(3) // text + 2 images
    })

    it('includes optional parameters', async () => {
      mock.onPost(chatUrl).reply({ choices: [{ message: { content: '{}' } }] })

      await service.analyzeImage('Extract text', ['https://a.com/1.jpg'], 'custom/model', 0.2, 500, true)

      const body = mock.history[0].body

      expect(body.model).toBe('custom/model')
      expect(body.temperature).toBe(0.2)
      expect(body.max_completion_tokens).toBe(500)
      expect(body.response_format).toEqual({ type: 'json_object' })
    })

    it('throws when prompt is empty', async () => {
      await expect(service.analyzeImage('', ['https://a.com/1.jpg'])).rejects.toThrow('Prompt is required')
    })

    it('throws when no image URLs provided', async () => {
      await expect(service.analyzeImage('Describe', [])).rejects.toThrow('At least one image URL is required')
    })
  })

  // ── Image Generation ──

  describe('generateImage', () => {
    it('sends correct request and uploads generated images', async () => {
      mock.onPost(`${BASE}/images`).reply({
        data: [{ b64_json: Buffer.from('fake-image').toString('base64'), media_type: 'image/png' }],
        created: 1752345600,
        usage: { prompt_tokens: 0, completion_tokens: 100, total_tokens: 100, cost: 0.01 },
      })

      const result = await service.generateImage('A cat', 'model/img')

      expect(result.images).toHaveLength(1)
      expect(result.images[0]).toMatchObject({ fileURL: 'https://files.example.com/uploaded-file.png', mediaType: 'image/png' })
      expect(result.created).toBe(1752345600)
      expect(service.flowrunner.Files.uploadFile).toHaveBeenCalledTimes(1)

      const body = mock.history[0].body

      expect(body).toMatchObject({ model: 'model/img', prompt: 'A cat' })
    })

    it('includes all optional parameters', async () => {
      mock.onPost(`${BASE}/images`).reply({ data: [], created: null, usage: null })

      await service.generateImage(
        'A cat', 'model/img', '16:9', '2K', 'PNG', 'High', 'Transparent', 3, 42,
        ['https://ref.com/1.jpg']
      )

      const body = mock.history[0].body

      expect(body.aspect_ratio).toBe('16:9')
      expect(body.resolution).toBe('2K')
      expect(body.output_format).toBe('png')
      expect(body.quality).toBe('high')
      expect(body.background).toBe('transparent')
      expect(body.n).toBe(3)
      expect(body.seed).toBe(42)
      expect(body.input_references).toEqual([{ type: 'image_url', image_url: { url: 'https://ref.com/1.jpg' } }])
    })

    it('throws when prompt is empty', async () => {
      await expect(service.generateImage('', 'model/img')).rejects.toThrow('Prompt is required')
    })

    it('throws when model is missing', async () => {
      await expect(service.generateImage('A cat', '')).rejects.toThrow('Model is required')
    })
  })

  // ── Audio Methods ──

  describe('textToSpeech', () => {
    it('sends correct request and uploads audio', async () => {
      mock.onPost(`${BASE}/audio/speech`).reply(Buffer.from('fake-audio'))

      const result = await service.textToSpeech('Hello world', 'openai/gpt-4o-mini-tts', 'alloy')

      expect(result).toHaveProperty('fileURL')
      expect(service.flowrunner.Files.uploadFile).toHaveBeenCalledTimes(1)

      const body = mock.history[0].body

      expect(body).toMatchObject({
        model: 'openai/gpt-4o-mini-tts',
        input: 'Hello world',
        voice: 'alloy',
        response_format: 'mp3',
      })
    })

    it('resolves PCM format and includes speed', async () => {
      mock.onPost(`${BASE}/audio/speech`).reply(Buffer.from('audio'))

      await service.textToSpeech('Hello', 'model/tts', 'voice1', 'PCM', 1.5)

      const body = mock.history[0].body

      expect(body.response_format).toBe('pcm')
      expect(body.speed).toBe(1.5)
    })

    it('throws when input is empty', async () => {
      await expect(service.textToSpeech('', 'model', 'voice')).rejects.toThrow('Input text is required')
    })

    it('throws when model is missing', async () => {
      await expect(service.textToSpeech('hello', '', 'voice')).rejects.toThrow('Model is required')
    })

    it('throws when voice is missing', async () => {
      await expect(service.textToSpeech('hello', 'model', '')).rejects.toThrow('Voice is required')
    })
  })

  describe('transcribeAudio', () => {
    it('sends multipart form request', async () => {
      mock.onGet('https://example.com/audio.mp3').reply(Buffer.from('fake-audio'))
      mock.onPost(`${BASE}/audio/transcriptions`).reply({ text: 'Hello world' })

      const result = await service.transcribeAudio('https://example.com/audio.mp3', 'openai/whisper-large-v3')

      expect(result).toEqual({ text: 'Hello world' })
      expect(mock.history).toHaveLength(2) // download + transcribe
    })

    it('includes optional parameters', async () => {
      mock.onGet('https://example.com/audio.mp3').reply(Buffer.from('audio'))
      mock.onPost(`${BASE}/audio/transcriptions`).reply({ text: 'hi', language: 'en' })

      await service.transcribeAudio(
        'https://example.com/audio.mp3', 'openai/whisper-large-v3',
        'en', 'Verbose JSON', 0, ['Word', 'Segment']
      )

      // The second call is the POST to transcriptions
      const transcribeCall = mock.history.find(h => h.method === 'post')

      expect(transcribeCall.formData).toBeDefined()
    })

    it('switches to verbose_json when timestamp granularities provided', async () => {
      mock.onGet('https://example.com/audio.mp3').reply(Buffer.from('audio'))
      mock.onPost(`${BASE}/audio/transcriptions`).reply({ text: 'hi' })

      await service.transcribeAudio(
        'https://example.com/audio.mp3', 'openai/whisper-large-v3',
        undefined, 'JSON', undefined, ['Word']
      )

      const transcribeCall = mock.history.find(h => h.method === 'post')

      expect(transcribeCall.formData).toBeDefined()
    })

    it('throws when model is missing', async () => {
      await expect(service.transcribeAudio('https://example.com/audio.mp3', '')).rejects.toThrow('Model is required')
    })

    it('throws when fileUrl is invalid', async () => {
      await expect(service.transcribeAudio('not-a-url', 'model')).rejects.toThrow('Invalid fileUrl')
    })
  })

  // ── Video Methods ──

  describe('generateVideo', () => {
    it('sends correct request with required parameters', async () => {
      mock.onPost(`${BASE}/videos`).reply({ id: 'job-123', status: 'pending' })

      const result = await service.generateVideo('A sunset', 'google/veo-3.1')

      expect(result).toEqual({ id: 'job-123', status: 'pending' })
      expect(mock.history[0].body).toMatchObject({ model: 'google/veo-3.1', prompt: 'A sunset' })
    })

    it('includes all optional parameters', async () => {
      mock.onPost(`${BASE}/videos`).reply({ id: 'job-456', status: 'pending' })

      await service.generateVideo('A sunset', 'google/veo-3.1', 10, '16:9', '1080p', true, 42, 'https://callback.com')

      const body = mock.history[0].body

      expect(body.duration).toBe(10)
      expect(body.aspect_ratio).toBe('16:9')
      expect(body.resolution).toBe('1080p')
      expect(body.generate_audio).toBe(true)
      expect(body.seed).toBe(42)
      expect(body.callback_url).toBe('https://callback.com')
    })

    it('throws when prompt is empty', async () => {
      await expect(service.generateVideo('', 'model')).rejects.toThrow('Prompt is required')
    })

    it('throws when model is missing', async () => {
      await expect(service.generateVideo('test', '')).rejects.toThrow('Model is required')
    })
  })

  describe('getVideoStatus', () => {
    it('sends GET request with job ID', async () => {
      mock.onGet(`${BASE}/videos/job-123`).reply({
        id: 'job-123',
        status: 'completed',
        generation_id: 'gen-xyz',
        unsigned_urls: ['https://cdn.example.com/video.mp4'],
      })

      const result = await service.getVideoStatus('job-123')

      expect(result.status).toBe('completed')
      expect(result.unsigned_urls).toHaveLength(1)
    })

    it('throws when jobId is missing', async () => {
      await expect(service.getVideoStatus('')).rejects.toThrow('Job ID is required')
    })
  })

  describe('downloadVideo', () => {
    it('downloads video and uploads to file storage', async () => {
      mock.onGet(`${BASE}/videos/job-123/content`).reply(Buffer.from('video-bytes'))

      const result = await service.downloadVideo('job-123')

      expect(result).toHaveProperty('fileURL')
      expect(service.flowrunner.Files.uploadFile).toHaveBeenCalledTimes(1)
    })

    it('includes index in query when provided', async () => {
      mock.onGet(`${BASE}/videos/job-123/content`).reply(Buffer.from('video-bytes'))

      await service.downloadVideo('job-123', 2)

      expect(mock.history[0].query).toMatchObject({ index: 2 })
    })

    it('throws when jobId is missing', async () => {
      await expect(service.downloadVideo('')).rejects.toThrow('Job ID is required')
    })
  })

  // ── Embeddings ──

  describe('createEmbeddings', () => {
    it('sends correct request with defaults', async () => {
      mock.onPost(`${BASE}/embeddings`).reply({
        object: 'list',
        data: [{ object: 'embedding', index: 0, embedding: [0.1, 0.2] }],
        usage: { prompt_tokens: 5, total_tokens: 5 },
      })

      const result = await service.createEmbeddings(['Hello world'])

      expect(result.data).toHaveLength(1)
      expect(mock.history[0].body).toMatchObject({
        model: 'openai/text-embedding-3-small',
        input: ['Hello world'],
      })
    })

    it('includes optional parameters', async () => {
      mock.onPost(`${BASE}/embeddings`).reply({ data: [] })

      await service.createEmbeddings(['test'], 'custom/model', 256, 'Search Query')

      const body = mock.history[0].body

      expect(body.model).toBe('custom/model')
      expect(body.dimensions).toBe(256)
      expect(body.input_type).toBe('search_query')
    })

    it('resolves all input type choices', async () => {
      const cases = [
        ['Search Document', 'search_document'],
        ['Classification', 'classification'],
        ['Clustering', 'clustering'],
      ]

      for (const [input, expected] of cases) {
        mock.reset()
        mock.onPost(`${BASE}/embeddings`).reply({ data: [] })
        await service.createEmbeddings(['test'], undefined, undefined, input)
        expect(mock.history[0].body.input_type).toBe(expected)
      }
    })

    it('throws when texts array is empty', async () => {
      await expect(service.createEmbeddings([])).rejects.toThrow('At least one text is required')
    })
  })

  // ── Rerank ──

  describe('rerankDocuments', () => {
    it('sends correct request', async () => {
      mock.onPost(`${BASE}/rerank`).reply({
        id: 'gen-rerank-1',
        results: [{ index: 0, relevance_score: 0.98, document: { text: 'Paris is the capital' } }],
      })

      const result = await service.rerankDocuments('capital of France', ['Paris is the capital', 'Berlin is large'])

      expect(result.results).toHaveLength(1)
      expect(mock.history[0].body).toMatchObject({
        model: 'cohere/rerank-v3.5',
        query: 'capital of France',
        documents: ['Paris is the capital', 'Berlin is large'],
      })
    })

    it('includes topN when provided', async () => {
      mock.onPost(`${BASE}/rerank`).reply({ results: [] })

      await service.rerankDocuments('test', ['doc1'], 'custom/rerank', 3)

      expect(mock.history[0].body.top_n).toBe(3)
      expect(mock.history[0].body.model).toBe('custom/rerank')
    })

    it('throws when query is empty', async () => {
      await expect(service.rerankDocuments('', ['doc'])).rejects.toThrow('Query is required')
    })

    it('throws when documents array is empty', async () => {
      await expect(service.rerankDocuments('test', [])).rejects.toThrow('At least one document is required')
    })
  })

  // ── Insights ──

  describe('getGeneration', () => {
    it('sends GET request with generation ID', async () => {
      mock.onGet(`${BASE}/generation`).reply({
        data: { id: 'gen-123', model: 'anthropic/claude-sonnet-4.5', total_cost: 0.005 },
      })

      const result = await service.getGeneration('gen-123')

      expect(result).toMatchObject({ id: 'gen-123', total_cost: 0.005 })
      expect(mock.history[0].query).toMatchObject({ id: 'gen-123' })
    })

    it('returns response directly when data field is absent', async () => {
      mock.onGet(`${BASE}/generation`).reply({ id: 'gen-123', total_cost: 0.005 })

      const result = await service.getGeneration('gen-123')

      expect(result).toMatchObject({ id: 'gen-123' })
    })

    it('throws when generationId is missing', async () => {
      await expect(service.getGeneration('')).rejects.toThrow('Generation ID is required')
    })
  })

  // ── Models ──

  describe('listModels', () => {
    it('sends GET request with no filters', async () => {
      mock.onGet(`${BASE}/models`).reply({ data: [], total_count: 0 })

      const result = await service.listModels()

      expect(result).toMatchObject({ data: [], total_count: 0 })
    })

    it('sends all filter parameters', async () => {
      mock.onGet(`${BASE}/models`).reply({ data: [] })

      await service.listModels(
        'claude', 'Programming', ['Text', 'Image'], ['Text'],
        'Most Popular', 100000, 5, 10, 20
      )

      expect(mock.history[0].query).toMatchObject({
        q: 'claude',
        category: 'programming',
        input_modalities: 'text,image',
        output_modalities: 'text',
        sort: 'most-popular',
        context: 100000,
        max_price: 5,
        limit: 10,
        offset: 20,
      })
    })

    it('resolves all sort options correctly', async () => {
      const sortCases = [
        ['Newest', 'newest'],
        ['Top Weekly', 'top-weekly'],
        ['Price: Low to High', 'pricing-low-to-high'],
        ['Price: High to Low', 'pricing-high-to-low'],
        ['Context: High to Low', 'context-high-to-low'],
        ['Throughput: High to Low', 'throughput-high-to-low'],
        ['Latency: Low to High', 'latency-low-to-high'],
        ['Intelligence: High to Low', 'intelligence-high-to-low'],
        ['Coding: High to Low', 'coding-high-to-low'],
      ]

      for (const [input, expected] of sortCases) {
        mock.reset()
        mock.onGet(`${BASE}/models`).reply({ data: [] })
        await service.listModels(undefined, undefined, undefined, undefined, input)
        expect(mock.history[0].query.sort).toBe(expected)
      }
    })

    it('allows max_price of 0 for free models', async () => {
      mock.onGet(`${BASE}/models`).reply({ data: [] })

      await service.listModels(undefined, undefined, undefined, undefined, undefined, undefined, 0)

      expect(mock.history[0].query).toMatchObject({ max_price: 0 })
    })
  })

  describe('getModelEndpoints', () => {
    it('sends GET request with model slug', async () => {
      mock.onGet(`${BASE}/models/anthropic/claude-sonnet-4.5/endpoints`).reply({
        data: { id: 'anthropic/claude-sonnet-4.5', endpoints: [] },
      })

      const result = await service.getModelEndpoints('anthropic/claude-sonnet-4.5')

      expect(result.data.id).toBe('anthropic/claude-sonnet-4.5')
    })

    it('throws when model is missing slash', async () => {
      await expect(service.getModelEndpoints('invalidmodel')).rejects.toThrow("Model is required and must be a full slug")
    })

    it('throws when model is empty', async () => {
      await expect(service.getModelEndpoints('')).rejects.toThrow("Model is required and must be a full slug")
    })
  })

  describe('listProviders', () => {
    it('sends GET request to providers endpoint', async () => {
      mock.onGet(`${BASE}/providers`).reply({
        data: [{ name: 'OpenAI', slug: 'openai' }],
      })

      const result = await service.listProviders()

      expect(result.data).toHaveLength(1)
      expect(result.data[0].slug).toBe('openai')
    })
  })

  // ── Account ──

  describe('getCredits', () => {
    it('returns credits data', async () => {
      mock.onGet(`${BASE}/credits`).reply({
        data: { total_credits: 100, total_usage: 25 },
      })

      const result = await service.getCredits()

      expect(result).toEqual({ total_credits: 100, total_usage: 25 })
    })

    it('returns response directly when data field is absent', async () => {
      mock.onGet(`${BASE}/credits`).reply({ total_credits: 50, total_usage: 10 })

      const result = await service.getCredits()

      expect(result).toEqual({ total_credits: 50, total_usage: 10 })
    })
  })

  describe('getKeyInfo', () => {
    it('returns key info data', async () => {
      mock.onGet(`${BASE}/key`).reply({
        data: { label: 'sk-or-v1-test', usage: 25, limit: 100, is_free_tier: false },
      })

      const result = await service.getKeyInfo()

      expect(result).toMatchObject({ label: 'sk-or-v1-test', usage: 25 })
    })
  })

  describe('getActivity', () => {
    it('sends GET request without date filter', async () => {
      mock.onGet(`${BASE}/activity`).reply({
        data: [{ date: '2026-07-12', model: 'anthropic/claude-sonnet-4.5', requests: 42 }],
      })

      const result = await service.getActivity()

      expect(result.data).toHaveLength(1)
      expect(mock.history[0].query).toEqual({})
    })

    it('sends date filter when provided', async () => {
      mock.onGet(`${BASE}/activity`).reply({ data: [] })

      await service.getActivity('2026-07-12T00:00:00.000Z')

      expect(mock.history[0].query).toMatchObject({ date: '2026-07-12' })
    })
  })

  // ── Auth Headers ──

  describe('auth headers', () => {
    it('includes optional headers when configured', async () => {
      mock.onGet(`${BASE}/providers`).reply({ data: [] })

      await service.listProviders()

      expect(mock.history[0].headers).toMatchObject({
        'Authorization': `Bearer ${API_KEY}`,
        'HTTP-Referer': 'https://myapp.com',
        'X-OpenRouter-Title': 'MyApp',
      })
    })
  })

  // ── Error normalization ──

  describe('error normalization', () => {
    it('extracts error.body.error.message', async () => {
      mock.onGet(`${BASE}/providers`).replyWithError({
        message: 'Bad Request',
        body: { error: { message: 'Insufficient credits' } },
      })

      await expect(service.listProviders()).rejects.toThrow('Insufficient credits')
    })

    it('extracts error.body.message', async () => {
      mock.onGet(`${BASE}/providers`).replyWithError({
        message: 'Error',
        body: { message: 'Rate limit exceeded' },
      })

      await expect(service.listProviders()).rejects.toThrow('Rate limit exceeded')
    })

    it('uses fallback message when no body', async () => {
      mock.onGet(`${BASE}/providers`).replyWithError({
        message: 'Network timeout',
      })

      await expect(service.listProviders()).rejects.toThrow('Network timeout')
    })
  })
})
