'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-api-key'
const BASE = 'https://dashscope-intl.aliyuncs.com'

describe('Qwen AI Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ apiKey: API_KEY, region: 'International' })
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
      const configs = sandbox.getConfigItems()

      expect(configs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'apiKey', required: true, shared: false }),
          expect.objectContaining({ name: 'region', required: true, shared: false }),
        ])
      )
    })
  })

  // ── Dictionaries ──

  describe('getChatModelsDictionary', () => {
    it('returns live models sorted by label', async () => {
      mock.onGet(`${BASE}/compatible-mode/v1/models`).reply({
        data: [
          { id: 'qwen-plus', owned_by: 'system' },
          { id: 'qwen-max', owned_by: 'system' },
        ],
      })

      const result = await service.getChatModelsDictionary({})

      expect(result.items).toEqual([
        { label: 'qwen-max', value: 'qwen-max', note: 'system' },
        { label: 'qwen-plus', value: 'qwen-plus', note: 'system' },
      ])
      expect(result.cursor).toBeNull()
      expect(mock.history[0].headers).toMatchObject({ Authorization: `Bearer ${API_KEY}` })
    })

    it('falls back to built-in catalog on API error', async () => {
      mock.onGet(`${BASE}/compatible-mode/v1/models`).replyWithError({ message: 'Unauthorized' })

      const result = await service.getChatModelsDictionary({})

      expect(result.items.length).toBeGreaterThanOrEqual(6)
      expect(result.items[0]).toHaveProperty('label')
      expect(result.items[0]).toHaveProperty('value')
      expect(result.cursor).toBeNull()
    })

    it('filters by case-insensitive search', async () => {
      mock.onGet(`${BASE}/compatible-mode/v1/models`).reply({
        data: [
          { id: 'qwen-max', owned_by: 'system' },
          { id: 'qwen-plus', owned_by: 'system' },
          { id: 'qwen-flash', owned_by: 'system' },
        ],
      })

      const result = await service.getChatModelsDictionary({ search: 'MAX' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('qwen-max')
    })

    it('handles null payload', async () => {
      mock.onGet(`${BASE}/compatible-mode/v1/models`).reply({
        data: [{ id: 'qwen-plus', owned_by: 'system' }],
      })

      const result = await service.getChatModelsDictionary(null)

      expect(result.items).toHaveLength(1)
      expect(result.cursor).toBeNull()
    })

    it('handles empty data array', async () => {
      mock.onGet(`${BASE}/compatible-mode/v1/models`).reply({ data: [] })

      const result = await service.getChatModelsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getVisionModelsDictionary', () => {
    it('returns static vision models', async () => {
      const result = await service.getVisionModelsDictionary({})

      expect(result.items).toHaveLength(4)
      expect(result.items[0]).toEqual({ label: 'qwen-vl-max', value: 'qwen-vl-max', note: 'Most capable vision-language model' })
      expect(result.cursor).toBeNull()
    })

    it('filters by search', async () => {
      const result = await service.getVisionModelsDictionary({ search: 'qwen3' })

      expect(result.items).toHaveLength(2)
    })

    it('handles null payload', async () => {
      const result = await service.getVisionModelsDictionary(null)

      expect(result.items).toHaveLength(4)
    })
  })

  describe('getEmbeddingModelsDictionary', () => {
    it('returns static embedding models', async () => {
      const result = await service.getEmbeddingModelsDictionary({})

      expect(result.items).toHaveLength(2)
      expect(result.items[0].value).toBe('text-embedding-v4')
      expect(result.cursor).toBeNull()
    })
  })

  describe('getImageModelsDictionary', () => {
    it('returns static image models', async () => {
      const result = await service.getImageModelsDictionary({})

      expect(result.items).toHaveLength(4)
      expect(result.items[0].value).toBe('wan2.2-t2i-flash')
    })

    it('filters by search', async () => {
      const result = await service.getImageModelsDictionary({ search: 'plus' })

      expect(result.items).toHaveLength(2)
    })
  })

  describe('getVideoModelsDictionary', () => {
    it('returns static video models', async () => {
      const result = await service.getVideoModelsDictionary({})

      expect(result.items).toHaveLength(4)
      expect(result.items[0].value).toBe('wan2.5-t2v-preview')
    })
  })

  describe('getVoicesDictionary', () => {
    it('returns qwen3-tts voices by default', async () => {
      const result = await service.getVoicesDictionary({})

      expect(result.items.length).toBeGreaterThan(7)
      expect(result.items[0]).toEqual({ label: 'Cherry', value: 'Cherry', note: 'Female — sunny, friendly and natural' })
      expect(result.cursor).toBeNull()
    })

    it('returns legacy qwen-tts voices when model is qwen-tts', async () => {
      const result = await service.getVoicesDictionary({ criteria: { model: 'qwen-tts' } })

      expect(result.items).toHaveLength(7)
    })

    it('filters voices by search', async () => {
      const result = await service.getVoicesDictionary({ search: 'Cherry' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('Cherry')
    })

    it('handles null payload', async () => {
      const result = await service.getVoicesDictionary(null)

      expect(result.items.length).toBeGreaterThan(0)
      expect(result.cursor).toBeNull()
    })
  })

  // ── Chat ──

  describe('chatCompletion', () => {
    const chatUrl = `${BASE}/compatible-mode/v1/chat/completions`

    it('sends correct request with defaults', async () => {
      mock.onPost(chatUrl).reply({
        choices: [{ message: { content: 'Hello!' }, finish_reason: 'stop' }],
        model: 'qwen-plus',
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      })

      const result = await service.chatCompletion('Hi')

      expect(result).toEqual({
        text: 'Hello!',
        reasoningContent: null,
        model: 'qwen-plus',
        finishReason: 'stop',
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      })

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({ Authorization: `Bearer ${API_KEY}` })
      expect(mock.history[0].body).toMatchObject({
        model: 'qwen-plus',
        messages: [{ role: 'user', content: 'Hi' }],
      })
    })

    it('includes system prompt when provided', async () => {
      mock.onPost(chatUrl).reply({
        choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }],
        model: 'qwen-plus',
      })

      await service.chatCompletion('Hello', 'qwen-plus', 'You are a helper')

      expect(mock.history[0].body.messages).toEqual([
        { role: 'system', content: 'You are a helper' },
        { role: 'user', content: 'Hello' },
      ])
    })

    it('applies thinking mode Enabled', async () => {
      mock.onPost(chatUrl).reply({
        choices: [{ message: { content: 'result', reasoning_content: 'thinking...' }, finish_reason: 'stop' }],
        model: 'qwen3-max',
      })

      const result = await service.chatCompletion('Test', 'qwen3-max', null, 'Enabled', 4096)

      expect(mock.history[0].body.enable_thinking).toBe(true)
      expect(mock.history[0].body.thinking_budget).toBe(4096)
      expect(result.reasoningContent).toBe('thinking...')
    })

    it('applies thinking mode Disabled', async () => {
      mock.onPost(chatUrl).reply({
        choices: [{ message: { content: 'result' }, finish_reason: 'stop' }],
        model: 'qwen-plus',
      })

      await service.chatCompletion('Test', null, null, 'Disabled')

      expect(mock.history[0].body.enable_thinking).toBe(false)
    })

    it('does not set enable_thinking for Default', async () => {
      mock.onPost(chatUrl).reply({
        choices: [{ message: { content: 'result' }, finish_reason: 'stop' }],
        model: 'qwen-plus',
      })

      await service.chatCompletion('Test', null, null, 'Default')

      expect(mock.history[0].body).not.toHaveProperty('enable_thinking')
    })

    it('applies sampling parameters', async () => {
      mock.onPost(chatUrl).reply({
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
        model: 'qwen-plus',
      })

      await service.chatCompletion('Test', null, null, 'Default', null, 0.7, 0.9, 100, ['END'], false, 42)

      const body = mock.history[0].body

      expect(body.temperature).toBe(0.7)
      expect(body.top_p).toBe(0.9)
      expect(body.max_tokens).toBe(100)
      expect(body.stop).toEqual(['END'])
      expect(body.seed).toBe(42)
    })

    it('enables JSON mode', async () => {
      mock.onPost(chatUrl).reply({
        choices: [{ message: { content: '{"key":"val"}' }, finish_reason: 'stop' }],
        model: 'qwen-plus',
      })

      await service.chatCompletion('Return JSON', null, null, 'Default', null, null, null, null, null, true)

      expect(mock.history[0].body.response_format).toEqual({ type: 'json_object' })
    })

    it('throws when prompt is empty', async () => {
      await expect(service.chatCompletion('')).rejects.toThrow('Prompt is required')
      await expect(service.chatCompletion('   ')).rejects.toThrow('Prompt is required')
    })

    it('throws on API error', async () => {
      mock.onPost(chatUrl).replyWithError({
        message: 'Unauthorized',
        body: { error: { message: 'Invalid API key' } },
      })

      await expect(service.chatCompletion('Hello')).rejects.toThrow('Invalid API key')
    })

    it('uses default model when not specified', async () => {
      mock.onPost(chatUrl).reply({
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
        model: 'qwen-plus',
      })

      await service.chatCompletion('Hi', null)

      expect(mock.history[0].body.model).toBe('qwen-plus')
    })
  })

  describe('chatCompletionAdvanced', () => {
    const chatUrl = `${BASE}/compatible-mode/v1/chat/completions`

    it('sends messages and returns raw response', async () => {
      const apiResponse = {
        id: 'chatcmpl-123',
        choices: [{ index: 0, message: { role: 'assistant', content: 'Hi' }, finish_reason: 'stop' }],
        model: 'qwen-plus',
        usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
      }

      mock.onPost(chatUrl).reply(apiResponse)

      const messages = [{ role: 'user', content: 'Hello' }]
      const result = await service.chatCompletionAdvanced(messages)

      expect(result).toEqual(apiResponse)
      expect(mock.history[0].body.messages).toEqual(messages)
      expect(mock.history[0].body.model).toBe('qwen-plus')
    })

    it('throws when messages is empty', async () => {
      await expect(service.chatCompletionAdvanced([])).rejects.toThrow('Messages array is required')
      await expect(service.chatCompletionAdvanced(null)).rejects.toThrow('Messages array is required')
    })

    it('applies response format and tools', async () => {
      mock.onPost(chatUrl).reply({ choices: [{ message: { content: '{}' } }] })

      const messages = [{ role: 'user', content: 'Test' }]
      const responseFormat = { type: 'json_object' }
      const tools = [{ type: 'function', function: { name: 'get_weather' } }]

      await service.chatCompletionAdvanced(messages, 'qwen-max', 'Default', null, null, null, null, null, responseFormat, tools, 'auto', 0.5)

      const body = mock.history[0].body

      expect(body.response_format).toEqual(responseFormat)
      expect(body.tools).toEqual(tools)
      expect(body.tool_choice).toBe('auto')
      expect(body.presence_penalty).toBe(0.5)
    })

    it('parses JSON tool_choice string', async () => {
      mock.onPost(chatUrl).reply({ choices: [{ message: { content: 'ok' } }] })

      const messages = [{ role: 'user', content: 'Test' }]

      await service.chatCompletionAdvanced(messages, null, 'Default', null, null, null, null, null, null, null, '{"type":"function","function":{"name":"my_fn"}}')

      expect(mock.history[0].body.tool_choice).toEqual({ type: 'function', function: { name: 'my_fn' } })
    })

    it('applies thinking mode and seed', async () => {
      mock.onPost(chatUrl).reply({ choices: [{ message: { content: 'ok' } }] })

      const messages = [{ role: 'user', content: 'Test' }]

      await service.chatCompletionAdvanced(messages, null, 'Enabled', 2048, 0.5, null, null, null, null, null, null, null, 99)

      const body = mock.history[0].body

      expect(body.enable_thinking).toBe(true)
      expect(body.thinking_budget).toBe(2048)
      expect(body.temperature).toBe(0.5)
      expect(body.seed).toBe(99)
    })
  })

  // ── Vision ──

  describe('analyzeImage', () => {
    const chatUrl = `${BASE}/compatible-mode/v1/chat/completions`

    it('sends correct multimodal request', async () => {
      mock.onPost(chatUrl).reply({
        choices: [{ message: { content: 'A cat' }, finish_reason: 'stop' }],
        model: 'qwen-vl-max',
        usage: { prompt_tokens: 100, completion_tokens: 5, total_tokens: 105 },
      })

      const result = await service.analyzeImage('Describe this', ['https://example.com/cat.jpg'])

      expect(result).toEqual({
        text: 'A cat',
        model: 'qwen-vl-max',
        finishReason: 'stop',
        usage: { prompt_tokens: 100, completion_tokens: 5, total_tokens: 105 },
      })

      const body = mock.history[0].body

      expect(body.model).toBe('qwen-vl-max')
      expect(body.messages[0].content).toEqual([
        { type: 'image_url', image_url: { url: 'https://example.com/cat.jpg' } },
        { type: 'text', text: 'Describe this' },
      ])
    })

    it('includes system prompt when provided', async () => {
      mock.onPost(chatUrl).reply({
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
        model: 'qwen-vl-max',
      })

      await service.analyzeImage('Describe', ['https://example.com/img.jpg'], null, 'Be concise')

      const messages = mock.history[0].body.messages

      expect(messages[0]).toEqual({ role: 'system', content: [{ type: 'text', text: 'Be concise' }] })
      expect(messages[1].role).toBe('user')
    })

    it('supports multiple images', async () => {
      mock.onPost(chatUrl).reply({
        choices: [{ message: { content: 'Two images' }, finish_reason: 'stop' }],
        model: 'qwen-vl-max',
      })

      await service.analyzeImage('Compare', ['https://example.com/a.jpg', 'https://example.com/b.jpg'])

      const content = mock.history[0].body.messages[0].content

      expect(content).toHaveLength(3) // 2 images + 1 text
      expect(content[0].type).toBe('image_url')
      expect(content[1].type).toBe('image_url')
      expect(content[2].type).toBe('text')
    })

    it('applies temperature and maxTokens', async () => {
      mock.onPost(chatUrl).reply({
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
        model: 'qwen-vl-max',
      })

      await service.analyzeImage('Describe', ['https://example.com/img.jpg'], null, null, 0.5, 200)

      const body = mock.history[0].body

      expect(body.temperature).toBe(0.5)
      expect(body.max_tokens).toBe(200)
    })

    it('throws when prompt is empty', async () => {
      await expect(service.analyzeImage('', ['https://example.com/img.jpg'])).rejects.toThrow('Prompt is required')
    })

    it('throws when imageUrls is empty', async () => {
      await expect(service.analyzeImage('Describe', [])).rejects.toThrow('At least one image URL is required')
      await expect(service.analyzeImage('Describe', null)).rejects.toThrow('At least one image URL is required')
    })
  })

  // ── Embeddings ──

  describe('createEmbeddings', () => {
    const embUrl = `${BASE}/compatible-mode/v1/embeddings`

    it('sends correct request with defaults', async () => {
      const apiResponse = {
        object: 'list',
        data: [{ object: 'embedding', index: 0, embedding: [0.1, 0.2] }],
        model: 'text-embedding-v4',
        usage: { prompt_tokens: 5, total_tokens: 5 },
      }

      mock.onPost(embUrl).reply(apiResponse)

      const result = await service.createEmbeddings(['Hello world'])

      expect(result).toEqual(apiResponse)
      expect(mock.history[0].body).toEqual({
        model: 'text-embedding-v4',
        input: ['Hello world'],
        encoding_format: 'float',
      })
    })

    it('includes dimensions when specified', async () => {
      mock.onPost(embUrl).reply({ data: [], usage: {} })

      await service.createEmbeddings(['Test'], null, 512)

      expect(mock.history[0].body.dimensions).toBe(512)
    })

    it('uses custom model', async () => {
      mock.onPost(embUrl).reply({ data: [], usage: {} })

      await service.createEmbeddings(['Test'], 'text-embedding-v3')

      expect(mock.history[0].body.model).toBe('text-embedding-v3')
    })

    it('throws when texts is empty', async () => {
      await expect(service.createEmbeddings([])).rejects.toThrow('At least one text is required')
      await expect(service.createEmbeddings(null)).rejects.toThrow('At least one text is required')
    })

    it('throws when more than 10 texts', async () => {
      const texts = Array(11).fill('text')

      await expect(service.createEmbeddings(texts)).rejects.toThrow('A maximum of 10 texts')
    })
  })

  // ── Image Generation ──

  describe('createImageTask', () => {
    const imgUrl = `${BASE}/api/v1/services/aigc/text2image/image-synthesis`

    it('sends correct request with defaults', async () => {
      mock.onPost(imgUrl).reply({
        output: { task_id: 'task-123', task_status: 'PENDING' },
        request_id: 'req-456',
      })

      const result = await service.createImageTask('A fox in a forest')

      expect(result).toEqual({
        taskId: 'task-123',
        taskStatus: 'PENDING',
        requestId: 'req-456',
      })

      expect(mock.history[0].body).toMatchObject({
        model: 'wan2.2-t2i-flash',
        input: { prompt: 'A fox in a forest' },
      })
      expect(mock.history[0].headers).toMatchObject({
        'X-DashScope-Async': 'enable',
        Authorization: `Bearer ${API_KEY}`,
      })
    })

    it('includes optional parameters', async () => {
      mock.onPost(imgUrl).reply({
        output: { task_id: 'task-123', task_status: 'PENDING' },
        request_id: 'req-456',
      })

      await service.createImageTask('A fox', 'wan2.2-t2i-plus', 'blurry', '1280*720', 2, 42, false, true)

      const body = mock.history[0].body

      expect(body.model).toBe('wan2.2-t2i-plus')
      expect(body.input.negative_prompt).toBe('blurry')
      expect(body.parameters.size).toBe('1280*720')
      expect(body.parameters.n).toBe(2)
      expect(body.parameters.seed).toBe(42)
      expect(body.parameters.prompt_extend).toBe(false)
      expect(body.parameters.watermark).toBe(true)
    })

    it('throws when prompt is empty', async () => {
      await expect(service.createImageTask('')).rejects.toThrow('Prompt is required')
    })
  })

  describe('generateImage', () => {
    const imgUrl = `${BASE}/api/v1/services/aigc/text2image/image-synthesis`
    const taskUrl = `${BASE}/api/v1/tasks/task-img-1`
    const resultImageUrl = 'https://dashscope-result.oss.aliyuncs.com/result.png'

    it('creates task, polls, downloads and saves', async () => {
      mock.onPost(imgUrl).reply({
        output: { task_id: 'task-img-1', task_status: 'PENDING' },
        request_id: 'req-1',
      })

      mock.onGet(taskUrl).reply({
        output: {
          task_status: 'SUCCEEDED',
          results: [{ url: resultImageUrl }],
        },
        usage: { image_count: 1 },
      })

      mock.onGet(resultImageUrl).reply(Buffer.from('fake-png'))

      // Mock flowrunner.Files.uploadFile
      service.flowrunner = {
        Files: {
          uploadFile: jest.fn().mockResolvedValue({ url: 'https://files.example.com/qwen_image.png' }),
        },
      }

      const result = await service.generateImage('A fox')

      expect(result.taskId).toBe('task-img-1')
      expect(result.fileURLs).toHaveLength(1)
      expect(result.fileURLs[0]).toBe('https://files.example.com/qwen_image.png')
      expect(result.originalUrls).toEqual([resultImageUrl])
      expect(result.imageCount).toBe(1)
      expect(service.flowrunner.Files.uploadFile).toHaveBeenCalled()
    }, 15000)

    it('throws when task succeeds but no image URLs returned', async () => {
      mock.onPost(imgUrl).reply({
        output: { task_id: 'task-img-2', task_status: 'PENDING' },
        request_id: 'req-2',
      })

      mock.onGet(`${BASE}/api/v1/tasks/task-img-2`).reply({
        output: { task_status: 'SUCCEEDED', results: [] },
        usage: {},
      })

      service.flowrunner = { Files: { uploadFile: jest.fn() } }

      await expect(service.generateImage('A fox')).rejects.toThrow('returned no image URLs')
    }, 15000)
  })

  // ── Video Generation ──

  describe('createVideoTask', () => {
    const vidUrl = `${BASE}/api/v1/services/aigc/video-generation/video-synthesis`

    it('sends correct request with defaults', async () => {
      mock.onPost(vidUrl).reply({
        output: { task_id: 'vid-123', task_status: 'PENDING' },
        request_id: 'req-789',
      })

      const result = await service.createVideoTask('A sunset timelapse')

      expect(result).toEqual({
        taskId: 'vid-123',
        taskStatus: 'PENDING',
        requestId: 'req-789',
      })

      expect(mock.history[0].body).toMatchObject({
        model: 'wan2.2-t2v-plus',
        input: { prompt: 'A sunset timelapse' },
      })
      expect(mock.history[0].headers).toMatchObject({ 'X-DashScope-Async': 'enable' })
    })

    it('includes optional parameters', async () => {
      mock.onPost(vidUrl).reply({
        output: { task_id: 'vid-123', task_status: 'PENDING' },
        request_id: 'req-789',
      })

      await service.createVideoTask('A sunset', 'wan2.5-t2v-preview', 'blurry', '1920*1080', 10, 42, true, false)

      const body = mock.history[0].body

      expect(body.model).toBe('wan2.5-t2v-preview')
      expect(body.input.negative_prompt).toBe('blurry')
      expect(body.parameters.size).toBe('1920*1080')
      expect(body.parameters.duration).toBe(10)
      expect(body.parameters.seed).toBe(42)
      expect(body.parameters.prompt_extend).toBe(true)
      expect(body.parameters.watermark).toBe(false)
    })

    it('throws when prompt is empty', async () => {
      await expect(service.createVideoTask('')).rejects.toThrow('Prompt is required')
    })
  })

  // ── Async Tasks ──

  describe('getTaskStatus', () => {
    it('sends correct GET request', async () => {
      const taskResponse = {
        request_id: 'req-1',
        output: { task_id: 'task-abc', task_status: 'SUCCEEDED' },
        usage: { image_count: 1 },
      }

      mock.onGet(`${BASE}/api/v1/tasks/task-abc`).reply(taskResponse)

      const result = await service.getTaskStatus('task-abc')

      expect(result).toEqual(taskResponse)
      expect(mock.history[0].headers).toMatchObject({ Authorization: `Bearer ${API_KEY}` })
    })

    it('throws when taskId is empty', async () => {
      await expect(service.getTaskStatus('')).rejects.toThrow('Task ID is required')
      await expect(service.getTaskStatus('   ')).rejects.toThrow('Task ID is required')
    })
  })

  // ── Audio ──

  describe('synthesizeSpeech', () => {
    const ttsUrl = `${BASE}/api/v1/services/aigc/multimodal-generation/generation`
    const audioResultUrl = 'https://dashscope-result.oss.aliyuncs.com/tts/result.wav'

    it('sends correct request and saves audio', async () => {
      mock.onPost(ttsUrl).reply({
        output: { audio: { url: audioResultUrl, expires_at: 1752828000 } },
        usage: { characters: 10 },
      })

      mock.onGet(audioResultUrl).reply(Buffer.from('fake-wav'))

      service.flowrunner = {
        Files: {
          uploadFile: jest.fn().mockResolvedValue({ url: 'https://files.example.com/qwen_tts.wav' }),
        },
      }

      const result = await service.synthesizeSpeech('Hello world')

      expect(result.fileUrl).toBe('https://files.example.com/qwen_tts.wav')
      expect(result.sourceUrl).toBe(audioResultUrl)
      expect(result.expiresAt).toBe(1752828000)
      expect(result.model).toBe('qwen3-tts-flash')
      expect(result.usage).toEqual({ characters: 10 })

      expect(mock.history[0].body).toMatchObject({
        model: 'qwen3-tts-flash',
        input: { text: 'Hello world', voice: 'Cherry' },
      })
    })

    it('includes language_type for qwen3-tts models', async () => {
      mock.onPost(ttsUrl).reply({
        output: { audio: { url: audioResultUrl } },
        usage: {},
      })

      mock.onGet(audioResultUrl).reply(Buffer.from('fake-wav'))

      service.flowrunner = {
        Files: { uploadFile: jest.fn().mockResolvedValue({ url: 'https://files.example.com/tts.wav' }) },
      }

      await service.synthesizeSpeech('Hello', 'qwen3-tts-flash', 'Serena', 'English')

      expect(mock.history[0].body.input.language_type).toBe('English')
    })

    it('does not include language_type for legacy qwen-tts', async () => {
      mock.onPost(ttsUrl).reply({
        output: { audio: { url: audioResultUrl } },
        usage: {},
      })

      mock.onGet(audioResultUrl).reply(Buffer.from('fake-wav'))

      service.flowrunner = {
        Files: { uploadFile: jest.fn().mockResolvedValue({ url: 'https://files.example.com/tts.wav' }) },
      }

      await service.synthesizeSpeech('Hello', 'qwen-tts', 'Cherry', 'English')

      expect(mock.history[0].body.input).not.toHaveProperty('language_type')
    })

    it('throws when text is empty', async () => {
      await expect(service.synthesizeSpeech('')).rejects.toThrow('Text is required')
    })

    it('throws when no audio URL returned', async () => {
      mock.onPost(ttsUrl).reply({ output: { audio: {} }, usage: {} })

      await expect(service.synthesizeSpeech('Hello')).rejects.toThrow('no audio URL was returned')
    })
  })

  describe('transcribeAudio', () => {
    const chatUrl = `${BASE}/compatible-mode/v1/chat/completions`

    it('sends correct request with defaults', async () => {
      mock.onPost(chatUrl).reply({
        choices: [{
          message: {
            content: 'Hello world',
            annotations: [{ language: 'en', emotion: 'neutral' }],
          },
        }],
        model: 'qwen3-asr-flash',
        usage: { seconds: 4, input_tokens: 100, output_tokens: 10, total_tokens: 110 },
      })

      const result = await service.transcribeAudio('https://example.com/audio.mp3')

      expect(result).toEqual({
        text: 'Hello world',
        language: 'en',
        emotion: 'neutral',
        model: 'qwen3-asr-flash',
        usage: { seconds: 4, input_tokens: 100, output_tokens: 10, total_tokens: 110 },
      })

      expect(mock.history[0].body).toMatchObject({
        model: 'qwen3-asr-flash',
        messages: [
          { role: 'user', content: [{ type: 'input_audio', input_audio: { data: 'https://example.com/audio.mp3' } }] },
        ],
      })
    })

    it('includes context as system message', async () => {
      mock.onPost(chatUrl).reply({
        choices: [{ message: { content: 'Transcript', annotations: [] } }],
        model: 'qwen3-asr-flash',
      })

      await service.transcribeAudio('https://example.com/audio.mp3', null, null, 'Domain terms here')

      const messages = mock.history[0].body.messages

      expect(messages[0]).toEqual({ role: 'system', content: [{ type: 'text', text: 'Domain terms here' }] })
      expect(messages[1].role).toBe('user')
    })

    it('includes asr_options when language or enableItn set', async () => {
      mock.onPost(chatUrl).reply({
        choices: [{ message: { content: 'OK', annotations: [] } }],
        model: 'qwen3-asr-flash',
      })

      await service.transcribeAudio('https://example.com/audio.mp3', null, 'zh', null, true)

      expect(mock.history[0].body.asr_options).toEqual({ language: 'zh', enable_itn: true })
    })

    it('does not include asr_options when no extras set', async () => {
      mock.onPost(chatUrl).reply({
        choices: [{ message: { content: 'OK', annotations: [] } }],
        model: 'qwen3-asr-flash',
      })

      await service.transcribeAudio('https://example.com/audio.mp3')

      expect(mock.history[0].body).not.toHaveProperty('asr_options')
    })

    it('throws when audio is empty', async () => {
      await expect(service.transcribeAudio('')).rejects.toThrow('Audio is required')
    })

    it('handles missing annotations gracefully', async () => {
      mock.onPost(chatUrl).reply({
        choices: [{ message: { content: 'Hello' } }],
        model: 'qwen3-asr-flash',
      })

      const result = await service.transcribeAudio('https://example.com/audio.mp3')

      expect(result.language).toBeNull()
      expect(result.emotion).toBeNull()
    })
  })

  // ── Models ──

  describe('listModels', () => {
    it('sends GET request and returns model list', async () => {
      const apiResponse = {
        object: 'list',
        data: [
          { id: 'qwen-max', object: 'model', owned_by: 'system' },
          { id: 'qwen-plus', object: 'model', owned_by: 'system' },
        ],
      }

      mock.onGet(`${BASE}/compatible-mode/v1/models`).reply(apiResponse)

      const result = await service.listModels()

      expect(result).toEqual(apiResponse)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({ Authorization: `Bearer ${API_KEY}` })
    })

    it('throws on API error', async () => {
      mock.onGet(`${BASE}/compatible-mode/v1/models`).replyWithError({ message: 'Forbidden' })

      await expect(service.listModels()).rejects.toThrow()
    })
  })

  // ── Error normalization ──

  describe('error normalization', () => {
    it('extracts error.body.error.message', async () => {
      mock.onGet(`${BASE}/compatible-mode/v1/models`).replyWithError({
        message: 'Request failed',
        body: { error: { message: 'Rate limit exceeded' } },
      })

      await expect(service.listModels()).rejects.toThrow('Rate limit exceeded')
    })

    it('extracts error.body.message', async () => {
      mock.onGet(`${BASE}/compatible-mode/v1/models`).replyWithError({
        message: 'Request failed',
        body: { message: 'Invalid model' },
      })

      await expect(service.listModels()).rejects.toThrow('Invalid model')
    })

    it('falls back to error.message', async () => {
      mock.onGet(`${BASE}/compatible-mode/v1/models`).replyWithError({ message: 'Network timeout' })

      await expect(service.listModels()).rejects.toThrow('Network timeout')
    })
  })
})
