'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-xai-api-key'
const BASE = 'https://api.x.ai/v1'

describe('xAI Grok Service', () => {
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
      expect(sandbox.getConfigItems()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'apiKey', required: true, shared: false }),
        ])
      )
    })
  })

  // ── Dictionary Methods ──

  describe('getModelsDictionary', () => {
    it('returns mapped items with label, value, and note', async () => {
      mock.onGet(`${BASE}/models`).reply({
        data: [
          { id: 'grok-4.5', object: 'model', owned_by: 'xai' },
          { id: 'grok-imagine-image', object: 'model', owned_by: 'xai' },
        ],
      })

      const result = await service.getModelsDictionary({})

      expect(result.items).toHaveLength(2)
      expect(result.items[0]).toEqual({ label: 'grok-4.5', value: 'grok-4.5', note: 'xai' })
      expect(result.items[1]).toEqual({ label: 'grok-imagine-image', value: 'grok-imagine-image', note: 'xai' })
      expect(result.cursor).toBeNull()
    })

    it('filters by case-insensitive search', async () => {
      mock.onGet(`${BASE}/models`).reply({
        data: [
          { id: 'grok-4.5', owned_by: 'xai' },
          { id: 'grok-imagine-image', owned_by: 'xai' },
        ],
      })

      const result = await service.getModelsDictionary({ search: 'imagine' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('grok-imagine-image')
    })

    it('handles null payload', async () => {
      mock.onGet(`${BASE}/models`).reply({ data: [{ id: 'grok-4.5', owned_by: 'xai' }] })

      const result = await service.getModelsDictionary(null)

      expect(result.items).toHaveLength(1)
      expect(result.cursor).toBeNull()
    })

    it('handles empty or null data', async () => {
      mock.onGet(`${BASE}/models`).reply({ data: null })

      const result = await service.getModelsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('handles missing owned_by', async () => {
      mock.onGet(`${BASE}/models`).reply({ data: [{ id: 'custom-model' }] })

      const result = await service.getModelsDictionary({})

      expect(result.items[0].note).toBeNull()
    })

    it('sends correct auth header', async () => {
      mock.onGet(`${BASE}/models`).reply({ data: [] })

      await service.getModelsDictionary({})

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({ Authorization: `Bearer ${API_KEY}` })
    })
  })

  describe('getChatModelsDictionary', () => {
    it('returns models with context and modality note', async () => {
      mock.onGet(`${BASE}/language-models`).reply({
        models: [
          { id: 'grok-4.5', context_length: 500000, input_modalities: ['text', 'image'] },
        ],
      })

      const result = await service.getChatModelsDictionary({})

      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toEqual({
        label: 'grok-4.5',
        value: 'grok-4.5',
        note: '500000 ctx · text+image',
      })
      expect(result.cursor).toBeNull()
    })

    it('handles model without context_length or input_modalities', async () => {
      mock.onGet(`${BASE}/language-models`).reply({
        models: [{ id: 'grok-basic' }],
      })

      const result = await service.getChatModelsDictionary({})

      expect(result.items[0].note).toBeNull()
    })

    it('falls back to response.data when models is missing', async () => {
      mock.onGet(`${BASE}/language-models`).reply({
        data: [{ id: 'grok-4.5', context_length: 100000 }],
      })

      const result = await service.getChatModelsDictionary({})

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('grok-4.5')
    })

    it('filters by search', async () => {
      mock.onGet(`${BASE}/language-models`).reply({
        models: [
          { id: 'grok-4.5' },
          { id: 'grok-4.3' },
        ],
      })

      const result = await service.getChatModelsDictionary({ search: '4.3' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('grok-4.3')
    })
  })

  describe('getImageModelsDictionary', () => {
    it('returns image models with output modality note', async () => {
      mock.onGet(`${BASE}/image-generation-models`).reply({
        models: [
          { id: 'grok-imagine-image', output_modalities: ['image'] },
        ],
      })

      const result = await service.getImageModelsDictionary({})

      expect(result.items[0]).toEqual({
        label: 'grok-imagine-image',
        value: 'grok-imagine-image',
        note: 'image output',
      })
    })

    it('handles model without output_modalities', async () => {
      mock.onGet(`${BASE}/image-generation-models`).reply({
        models: [{ id: 'grok-imagine-image' }],
      })

      const result = await service.getImageModelsDictionary({})

      expect(result.items[0].note).toBeNull()
    })
  })

  describe('getVideoModelsDictionary', () => {
    it('returns video models with output modality note', async () => {
      mock.onGet(`${BASE}/video-generation-models`).reply({
        models: [
          { id: 'grok-imagine-video', output_modalities: ['video'] },
        ],
      })

      const result = await service.getVideoModelsDictionary({})

      expect(result.items[0]).toEqual({
        label: 'grok-imagine-video',
        value: 'grok-imagine-video',
        note: 'video output',
      })
    })
  })

  // ── Chat Methods ──

  describe('chatCompletion', () => {
    const chatResponse = {
      choices: [{ message: { content: 'Hello!', reasoning_content: null }, finish_reason: 'stop' }],
      model: 'grok-4.5',
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }

    it('sends correct request with defaults', async () => {
      mock.onPost(`${BASE}/chat/completions`).reply(chatResponse)

      const result = await service.chatCompletion('Say hello')

      expect(result).toEqual({
        text: 'Hello!',
        reasoningContent: null,
        model: 'grok-4.5',
        finishReason: 'stop',
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      })

      expect(mock.history[0].body).toEqual({
        model: 'grok-4.5',
        messages: [{ role: 'user', content: 'Say hello' }],
      })
      expect(mock.history[0].headers).toMatchObject({
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      })
    })

    it('includes system prompt when provided', async () => {
      mock.onPost(`${BASE}/chat/completions`).reply(chatResponse)

      await service.chatCompletion('Say hello', undefined, 'Be concise')

      expect(mock.history[0].body.messages).toEqual([
        { role: 'system', content: 'Be concise' },
        { role: 'user', content: 'Say hello' },
      ])
    })

    it('includes all optional parameters', async () => {
      mock.onPost(`${BASE}/chat/completions`).reply(chatResponse)

      await service.chatCompletion(
        'Say hello', 'grok-4.3', 'Be concise', 0.5, 100, 0.9, ['stop'], 42, true, 'High'
      )

      const body = mock.history[0].body

      expect(body.model).toBe('grok-4.3')
      expect(body.temperature).toBe(0.5)
      expect(body.max_completion_tokens).toBe(100)
      expect(body.top_p).toBe(0.9)
      expect(body.stop).toEqual(['stop'])
      expect(body.seed).toBe(42)
      expect(body.response_format).toEqual({ type: 'json_object' })
      expect(body.reasoning_effort).toBe('high')
    })

    it('omits optional fields when not provided', async () => {
      mock.onPost(`${BASE}/chat/completions`).reply(chatResponse)

      await service.chatCompletion('Hello')

      const body = mock.history[0].body

      expect(body).not.toHaveProperty('temperature')
      expect(body).not.toHaveProperty('max_completion_tokens')
      expect(body).not.toHaveProperty('top_p')
      expect(body).not.toHaveProperty('stop')
      expect(body).not.toHaveProperty('seed')
      expect(body).not.toHaveProperty('response_format')
      expect(body).not.toHaveProperty('reasoning_effort')
    })

    it('allows temperature of 0', async () => {
      mock.onPost(`${BASE}/chat/completions`).reply(chatResponse)

      await service.chatCompletion('Hello', undefined, undefined, 0)

      expect(mock.history[0].body.temperature).toBe(0)
    })

    it('resolves reasoning effort choice values', async () => {
      mock.onPost(`${BASE}/chat/completions`).reply(chatResponse)

      await service.chatCompletion('Hello', undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'None')

      expect(mock.history[0].body.reasoning_effort).toBe('none')
    })

    it('does not include reasoning_effort for empty string', async () => {
      mock.onPost(`${BASE}/chat/completions`).reply(chatResponse)

      await service.chatCompletion('Hello', undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, '')

      expect(mock.history[0].body).not.toHaveProperty('reasoning_effort')
    })

    it('throws on empty prompt', async () => {
      await expect(service.chatCompletion('')).rejects.toThrow('Prompt is required')
      await expect(service.chatCompletion('  ')).rejects.toThrow('Prompt is required')
    })

    it('throws on API error', async () => {
      mock.onPost(`${BASE}/chat/completions`).replyWithError({
        message: 'Unauthorized',
        body: { error: { message: 'Invalid API key' } },
      })

      await expect(service.chatCompletion('Hello')).rejects.toThrow('Invalid API key')
    })

    it('handles missing choices in response', async () => {
      mock.onPost(`${BASE}/chat/completions`).reply({
        model: 'grok-4.5',
        choices: [],
      })

      const result = await service.chatCompletion('Hello')

      expect(result.text).toBe('')
      expect(result.finishReason).toBeNull()
    })
  })

  describe('chatCompletionAdvanced', () => {
    const messages = [{ role: 'user', content: 'Hello' }]

    it('sends correct request with required params only', async () => {
      const response = { id: 'chatcmpl-123', choices: [{ message: { content: 'Hi' } }] }
      mock.onPost(`${BASE}/chat/completions`).reply(response)

      const result = await service.chatCompletionAdvanced(messages)

      expect(result).toEqual(response)
      expect(mock.history[0].body).toEqual({
        model: 'grok-4.5',
        messages,
      })
    })

    it('includes all optional parameters', async () => {
      mock.onPost(`${BASE}/chat/completions`).reply({ id: 'chatcmpl-123' })

      await service.chatCompletionAdvanced(
        messages, 'grok-4.3', 0.7, 200, 0.95, ['END'], 99,
        { type: 'json_object' },
        [{ type: 'function', function: { name: 'test' } }],
        'auto',
        { mode: 'auto', sources: [{ type: 'web' }] },
        'Medium',
        0.5, -0.5, true
      )

      const body = mock.history[0].body

      expect(body.model).toBe('grok-4.3')
      expect(body.temperature).toBe(0.7)
      expect(body.max_completion_tokens).toBe(200)
      expect(body.top_p).toBe(0.95)
      expect(body.stop).toEqual(['END'])
      expect(body.seed).toBe(99)
      expect(body.response_format).toEqual({ type: 'json_object' })
      expect(body.tools).toHaveLength(1)
      expect(body.tool_choice).toBe('auto')
      expect(body.search_parameters).toEqual({ mode: 'auto', sources: [{ type: 'web' }] })
      expect(body.reasoning_effort).toBe('medium')
      expect(body.frequency_penalty).toBe(0.5)
      expect(body.presence_penalty).toBe(-0.5)
      expect(body.deferred).toBe(true)
    })

    it('parses JSON tool_choice string', async () => {
      mock.onPost(`${BASE}/chat/completions`).reply({ id: 'chatcmpl-123' })

      await service.chatCompletionAdvanced(
        messages, undefined, undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, '{"type":"function","function":{"name":"my_tool"}}'
      )

      expect(mock.history[0].body.tool_choice).toEqual({
        type: 'function',
        function: { name: 'my_tool' },
      })
    })

    it('throws on empty messages', async () => {
      await expect(service.chatCompletionAdvanced([])).rejects.toThrow('Messages array is required')
      await expect(service.chatCompletionAdvanced(null)).rejects.toThrow('Messages array is required')
    })
  })

  describe('getDeferredCompletion', () => {
    it('returns completed result when choices present', async () => {
      const response = {
        id: 'chatcmpl-123',
        choices: [{ message: { content: 'Done' } }],
      }
      mock.onGet(`${BASE}/chat/deferred-completion/req-123`).reply(response)

      const result = await service.getDeferredCompletion('req-123')

      expect(result).toEqual(response)
    })

    it('returns pending status when choices absent', async () => {
      mock.onGet(`${BASE}/chat/deferred-completion/req-456`).reply({ status: 'processing' })

      const result = await service.getDeferredCompletion('req-456')

      expect(result).toEqual({ status: 'pending', request_id: 'req-456' })
    })

    it('throws on missing request ID', async () => {
      await expect(service.getDeferredCompletion('')).rejects.toThrow('Request ID is required')
    })

    it('encodes request ID in URL', async () => {
      mock.onGet(`${BASE}/chat/deferred-completion/req%20with%20spaces`).reply({ choices: [] })

      await service.getDeferredCompletion('req with spaces')

      expect(mock.history[0].url).toBe(`${BASE}/chat/deferred-completion/req%20with%20spaces`)
    })
  })

  // ── Live Search ──

  describe('askWithLiveSearch', () => {
    const searchResponse = {
      choices: [{ message: { content: 'Answer with citations' }, finish_reason: 'stop' }],
      model: 'grok-4.5',
      citations: ['https://example.com'],
      usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 },
    }

    it('sends correct request with defaults', async () => {
      mock.onPost(`${BASE}/chat/completions`).reply(searchResponse)

      const result = await service.askWithLiveSearch('Latest AI news')

      expect(result).toEqual({
        text: 'Answer with citations',
        citations: ['https://example.com'],
        model: 'grok-4.5',
        finishReason: 'stop',
        usage: searchResponse.usage,
      })

      const body = mock.history[0].body

      expect(body.messages).toEqual([{ role: 'user', content: 'Latest AI news' }])
      expect(body.search_parameters).toEqual({ mode: 'auto', return_citations: true })
    })

    it('includes system prompt', async () => {
      mock.onPost(`${BASE}/chat/completions`).reply(searchResponse)

      await service.askWithLiveSearch('News', undefined, 'Be brief')

      expect(mock.history[0].body.messages[0]).toEqual({ role: 'system', content: 'Be brief' })
    })

    it('resolves search mode choice', async () => {
      mock.onPost(`${BASE}/chat/completions`).reply(searchResponse)

      await service.askWithLiveSearch('News', undefined, undefined, 'On')

      expect(mock.history[0].body.search_parameters.mode).toBe('on')
    })

    it('builds sources from selection', async () => {
      mock.onPost(`${BASE}/chat/completions`).reply(searchResponse)

      await service.askWithLiveSearch('News', undefined, undefined, undefined, ['Web', 'X'])

      const sources = mock.history[0].body.search_parameters.sources

      expect(sources).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'web' }),
          expect.objectContaining({ type: 'x' }),
        ])
      )
    })

    it('includes country and website filters on web source', async () => {
      mock.onPost(`${BASE}/chat/completions`).reply(searchResponse)

      await service.askWithLiveSearch(
        'News', undefined, undefined, undefined, ['Web'], undefined, undefined,
        undefined, 'US', ['wikipedia.org'], undefined
      )

      const webSource = mock.history[0].body.search_parameters.sources.find(s => s.type === 'web')

      expect(webSource.country).toBe('US')
      expect(webSource.allowed_websites).toEqual(['wikipedia.org'])
    })

    it('includes excluded websites on web and news sources', async () => {
      mock.onPost(`${BASE}/chat/completions`).reply(searchResponse)

      await service.askWithLiveSearch(
        'News', undefined, undefined, undefined, ['Web', 'News'], undefined, undefined,
        undefined, undefined, undefined, ['spam.com']
      )

      const sources = mock.history[0].body.search_parameters.sources

      expect(sources.find(s => s.type === 'web').excluded_websites).toEqual(['spam.com'])
      expect(sources.find(s => s.type === 'news').excluded_websites).toEqual(['spam.com'])
    })

    it('includes X handle filters', async () => {
      mock.onPost(`${BASE}/chat/completions`).reply(searchResponse)

      await service.askWithLiveSearch(
        'News', undefined, undefined, undefined, ['X'], undefined, undefined,
        undefined, undefined, undefined, undefined, ['elonmusk']
      )

      const xSource = mock.history[0].body.search_parameters.sources.find(s => s.type === 'x')

      expect(xSource.included_x_handles).toEqual(['elonmusk'])
    })

    it('includes RSS links', async () => {
      mock.onPost(`${BASE}/chat/completions`).reply(searchResponse)

      await service.askWithLiveSearch(
        'News', undefined, undefined, undefined, ['RSS'], undefined, undefined,
        undefined, undefined, undefined, undefined, undefined, undefined,
        ['https://feed.example.com/rss']
      )

      const rssSource = mock.history[0].body.search_parameters.sources.find(s => s.type === 'rss')

      expect(rssSource.links).toEqual(['https://feed.example.com/rss'])
    })

    it('auto-infers sources from filters when none selected', async () => {
      mock.onPost(`${BASE}/chat/completions`).reply(searchResponse)

      await service.askWithLiveSearch(
        'News', undefined, undefined, undefined, undefined, undefined, undefined,
        undefined, 'US', undefined, undefined, ['someone'], undefined, ['https://feed.example.com']
      )

      const sourceTypes = mock.history[0].body.search_parameters.sources.map(s => s.type)

      expect(sourceTypes).toContain('web')
      expect(sourceTypes).toContain('x')
      expect(sourceTypes).toContain('rss')
    })

    it('includes date range and max results', async () => {
      mock.onPost(`${BASE}/chat/completions`).reply(searchResponse)

      await service.askWithLiveSearch(
        'News', undefined, undefined, undefined, undefined,
        '2025-01-01', '2025-12-31', 5
      )

      const params = mock.history[0].body.search_parameters

      expect(params.from_date).toBe('2025-01-01')
      expect(params.to_date).toBe('2025-12-31')
      expect(params.max_search_results).toBe(5)
    })

    it('normalizes date objects to YYYY-MM-DD', async () => {
      mock.onPost(`${BASE}/chat/completions`).reply(searchResponse)

      await service.askWithLiveSearch(
        'News', undefined, undefined, undefined, undefined,
        new Date('2025-06-15T12:00:00Z')
      )

      expect(mock.history[0].body.search_parameters.from_date).toBe('2025-06-15')
    })

    it('includes temperature and maxCompletionTokens', async () => {
      mock.onPost(`${BASE}/chat/completions`).reply(searchResponse)

      await service.askWithLiveSearch(
        'News', undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, 0.5, 100
      )

      const body = mock.history[0].body

      expect(body.temperature).toBe(0.5)
      expect(body.max_completion_tokens).toBe(100)
    })

    it('throws on empty prompt', async () => {
      await expect(service.askWithLiveSearch('')).rejects.toThrow('Prompt is required')
    })

    it('returns empty citations when not in response', async () => {
      mock.onPost(`${BASE}/chat/completions`).reply({
        choices: [{ message: { content: 'No citations' }, finish_reason: 'stop' }],
        model: 'grok-4.5',
      })

      const result = await service.askWithLiveSearch('Test')

      expect(result.citations).toEqual([])
    })
  })

  // ── Vision ──

  describe('analyzeImage', () => {
    const visionResponse = {
      choices: [{ message: { content: 'A cat sitting on a table' }, finish_reason: 'stop' }],
      model: 'grok-4.5',
      usage: { prompt_tokens: 800, completion_tokens: 10, total_tokens: 810 },
    }

    it('sends correct request with image URLs', async () => {
      mock.onPost(`${BASE}/chat/completions`).reply(visionResponse)

      const result = await service.analyzeImage('Describe', ['https://example.com/image.jpg'])

      expect(result.text).toBe('A cat sitting on a table')

      const body = mock.history[0].body

      expect(body.model).toBe('grok-4.5')
      expect(body.messages[0].content).toEqual([
        { type: 'image_url', image_url: { url: 'https://example.com/image.jpg' } },
        { type: 'text', text: 'Describe' },
      ])
    })

    it('handles multiple images', async () => {
      mock.onPost(`${BASE}/chat/completions`).reply(visionResponse)

      await service.analyzeImage('Compare', ['https://img1.jpg', 'https://img2.jpg'])

      const content = mock.history[0].body.messages[0].content

      expect(content).toHaveLength(3)
      expect(content[0].image_url.url).toBe('https://img1.jpg')
      expect(content[1].image_url.url).toBe('https://img2.jpg')
      expect(content[2].type).toBe('text')
    })

    it('includes optional parameters', async () => {
      mock.onPost(`${BASE}/chat/completions`).reply(visionResponse)

      await service.analyzeImage('Describe', ['https://img.jpg'], 'grok-4.3', 0.3, 50, true)

      const body = mock.history[0].body

      expect(body.model).toBe('grok-4.3')
      expect(body.temperature).toBe(0.3)
      expect(body.max_completion_tokens).toBe(50)
      expect(body.response_format).toEqual({ type: 'json_object' })
    })

    it('throws on empty prompt', async () => {
      await expect(service.analyzeImage('', ['https://img.jpg'])).rejects.toThrow('Prompt is required')
    })

    it('throws on missing image URLs', async () => {
      await expect(service.analyzeImage('Describe', [])).rejects.toThrow('At least one image URL is required')
      await expect(service.analyzeImage('Describe', null)).rejects.toThrow('At least one image URL is required')
    })
  })

  // ── Image Generation ──

  describe('generateImage', () => {
    it('sends correct request with defaults (URL mode)', async () => {
      const response = {
        data: [{ url: 'https://imgen.x.ai/img.jpg', revised_prompt: 'A fox', mime_type: 'image/jpeg' }],
      }
      mock.onPost(`${BASE}/images/generations`).reply(response)

      const result = await service.generateImage('A red fox')

      expect(result).toEqual({
        images: [{ url: 'https://imgen.x.ai/img.jpg', revisedPrompt: 'A fox', mimeType: 'image/jpeg' }],
        model: 'grok-imagine-image',
      })

      expect(mock.history[0].body).toEqual({
        model: 'grok-imagine-image',
        prompt: 'A red fox',
        response_format: 'url',
      })
    })

    it('includes all optional parameters', async () => {
      mock.onPost(`${BASE}/images/generations`).reply({ data: [] })

      await service.generateImage('A fox', 'grok-imagine-image-quality', 2, '16:9', '2k')

      const body = mock.history[0].body

      expect(body.model).toBe('grok-imagine-image-quality')
      expect(body.n).toBe(2)
      expect(body.aspect_ratio).toBe('16:9')
      expect(body.resolution).toBe('2k')
    })

    it('uses b64_json format when saveToFileStorage is true', async () => {
      mock.onPost(`${BASE}/images/generations`).reply({
        data: [{ b64_json: 'aGVsbG8=', revised_prompt: 'A fox', mime_type: 'image/png' }],
      })

      // Mock flowrunner.Files.uploadFile
      service.flowrunner = {
        Files: {
          uploadFile: jest.fn().mockResolvedValue({ url: 'https://flowrunner.io/stored.png' }),
        },
      }

      const result = await service.generateImage('A fox', undefined, undefined, undefined, undefined, true)

      expect(mock.history[0].body.response_format).toBe('b64_json')
      expect(result.images[0].url).toBe('https://flowrunner.io/stored.png')

      delete service.flowrunner
    })

    it('handles missing revised_prompt and mime_type in URL mode', async () => {
      mock.onPost(`${BASE}/images/generations`).reply({
        data: [{ url: 'https://imgen.x.ai/img.jpg' }],
      })

      const result = await service.generateImage('A fox')

      expect(result.images[0].revisedPrompt).toBeNull()
      expect(result.images[0].mimeType).toBeNull()
    })

    it('throws on empty prompt', async () => {
      await expect(service.generateImage('')).rejects.toThrow('Prompt is required')
    })
  })

  describe('editImage', () => {
    it('sends single image in body.image', async () => {
      mock.onPost(`${BASE}/images/edits`).reply({
        data: [{ url: 'https://imgen.x.ai/edited.jpg', revised_prompt: 'Edited', mime_type: 'image/jpeg' }],
      })

      const result = await service.editImage('Make it blue', ['https://img.jpg'])

      expect(mock.history[0].body.image).toBe('https://img.jpg')
      expect(mock.history[0].body).not.toHaveProperty('images')
      expect(result.images).toHaveLength(1)
    })

    it('sends multiple images in body.images', async () => {
      mock.onPost(`${BASE}/images/edits`).reply({ data: [] })

      await service.editImage('Merge', ['https://img1.jpg', 'https://img2.jpg'])

      expect(mock.history[0].body.images).toEqual(['https://img1.jpg', 'https://img2.jpg'])
      expect(mock.history[0].body).not.toHaveProperty('image')
    })

    it('includes optional parameters', async () => {
      mock.onPost(`${BASE}/images/edits`).reply({ data: [] })

      await service.editImage('Edit', ['https://img.jpg'], 'grok-imagine-image-quality', 3)

      const body = mock.history[0].body

      expect(body.model).toBe('grok-imagine-image-quality')
      expect(body.n).toBe(3)
    })

    it('throws on empty prompt', async () => {
      await expect(service.editImage('', ['https://img.jpg'])).rejects.toThrow('Prompt is required')
    })

    it('throws on missing image URLs', async () => {
      await expect(service.editImage('Edit', [])).rejects.toThrow('At least one image URL is required')
    })
  })

  // ── Video Generation ──

  describe('generateVideo', () => {
    it('sends correct request with defaults', async () => {
      const response = { request_id: 'vg-123', status: 'pending' }
      mock.onPost(`${BASE}/videos/generations`).reply(response)

      const result = await service.generateVideo('A running fox')

      expect(result).toEqual(response)
      expect(mock.history[0].body).toEqual({
        model: 'grok-imagine-video',
        prompt: 'A running fox',
      })
    })

    it('includes all optional parameters', async () => {
      mock.onPost(`${BASE}/videos/generations`).reply({ request_id: 'vg-123' })

      await service.generateVideo('A fox', 'grok-imagine-video-1.5', 10, '1080p', '16:9', 'https://img.jpg')

      const body = mock.history[0].body

      expect(body.model).toBe('grok-imagine-video-1.5')
      expect(body.duration).toBe(10)
      expect(body.resolution).toBe('1080p')
      expect(body.aspect_ratio).toBe('16:9')
      expect(body.image).toBe('https://img.jpg')
    })

    it('throws on empty prompt', async () => {
      await expect(service.generateVideo('')).rejects.toThrow('Prompt is required')
    })
  })

  describe('editVideo', () => {
    it('sends correct request', async () => {
      const response = { request_id: 'vg-456', status: 'pending' }
      mock.onPost(`${BASE}/videos/edits`).reply(response)

      const result = await service.editVideo('Make it night', 'https://video.mp4')

      expect(result).toEqual(response)
      expect(mock.history[0].body).toEqual({
        model: 'grok-imagine-video',
        prompt: 'Make it night',
        video: 'https://video.mp4',
      })
    })

    it('uses custom model', async () => {
      mock.onPost(`${BASE}/videos/edits`).reply({ request_id: 'vg-456' })

      await service.editVideo('Edit', 'https://video.mp4', 'grok-imagine-video-1.5')

      expect(mock.history[0].body.model).toBe('grok-imagine-video-1.5')
    })

    it('throws on empty prompt', async () => {
      await expect(service.editVideo('', 'https://video.mp4')).rejects.toThrow('Prompt is required')
    })

    it('throws on missing video URL', async () => {
      await expect(service.editVideo('Edit', '')).rejects.toThrow('Video URL is required')
    })
  })

  describe('extendVideo', () => {
    it('sends correct request with defaults', async () => {
      const response = { request_id: 'vg-789', status: 'pending' }
      mock.onPost(`${BASE}/videos/extensions`).reply(response)

      const result = await service.extendVideo('Continue running', 'https://video.mp4')

      expect(result).toEqual(response)
      expect(mock.history[0].body).toEqual({
        model: 'grok-imagine-video',
        prompt: 'Continue running',
        video: 'https://video.mp4',
      })
    })

    it('includes duration and custom model', async () => {
      mock.onPost(`${BASE}/videos/extensions`).reply({ request_id: 'vg-789' })

      await service.extendVideo('Continue', 'https://video.mp4', 10, 'grok-imagine-video-1.5')

      const body = mock.history[0].body

      expect(body.duration).toBe(10)
      expect(body.model).toBe('grok-imagine-video-1.5')
    })

    it('throws on empty prompt', async () => {
      await expect(service.extendVideo('', 'https://video.mp4')).rejects.toThrow('Prompt is required')
    })

    it('throws on missing video URL', async () => {
      await expect(service.extendVideo('Continue', '')).rejects.toThrow('Video URL is required')
    })
  })

  describe('getVideoResult', () => {
    it('returns video result', async () => {
      const response = {
        status: 'completed',
        video: { url: 'https://vidgen.x.ai/video.mp4', duration: 8 },
        model: 'grok-imagine-video',
      }
      mock.onGet(`${BASE}/videos/vg-123`).reply(response)

      const result = await service.getVideoResult('vg-123')

      expect(result).toEqual(response)
    })

    it('throws on missing request ID', async () => {
      await expect(service.getVideoResult('')).rejects.toThrow('Request ID is required')
    })
  })

  // ── Utilities ──

  describe('tokenizeText', () => {
    it('sends correct request and returns token count', async () => {
      const tokens = [{ token_id: 1, string_token: 'Hello' }]
      mock.onPost(`${BASE}/tokenize-text`).reply(tokens)

      const result = await service.tokenizeText('Hello')

      expect(result).toEqual({ tokenCount: 1, tokens })
      expect(mock.history[0].body).toEqual({ text: 'Hello', model: 'grok-4.5' })
    })

    it('uses custom model', async () => {
      mock.onPost(`${BASE}/tokenize-text`).reply({ tokens: [] })

      await service.tokenizeText('Hello', 'grok-4.3')

      expect(mock.history[0].body.model).toBe('grok-4.3')
    })

    it('handles response with tokens property', async () => {
      mock.onPost(`${BASE}/tokenize-text`).reply({ tokens: [{ id: 1 }, { id: 2 }] })

      const result = await service.tokenizeText('Hello world')

      expect(result.tokenCount).toBe(2)
    })

    it('handles response with token_ids property', async () => {
      mock.onPost(`${BASE}/tokenize-text`).reply({ token_ids: [100, 200, 300] })

      const result = await service.tokenizeText('Hello world test')

      expect(result.tokenCount).toBe(3)
    })

    it('throws on missing text', async () => {
      await expect(service.tokenizeText('')).rejects.toThrow('Text is required')
    })
  })

  // ── Account ──

  describe('getApiKeyInfo', () => {
    it('returns API key info', async () => {
      const response = {
        redacted_api_key: 'xai-...abc',
        name: 'Test key',
        api_key_blocked: false,
      }
      mock.onGet(`${BASE}/api-key`).reply(response)

      const result = await service.getApiKeyInfo()

      expect(result).toEqual(response)
      expect(mock.history[0].headers).toMatchObject({ Authorization: `Bearer ${API_KEY}` })
    })
  })

  // ── Models ──

  describe('listModels', () => {
    it('returns model list', async () => {
      const response = { object: 'list', data: [{ id: 'grok-4.5' }] }
      mock.onGet(`${BASE}/models`).reply(response)

      const result = await service.listModels()

      expect(result).toEqual(response)
    })
  })

  describe('getModel', () => {
    it('returns model info', async () => {
      const response = { id: 'grok-4.5', object: 'model', owned_by: 'xai' }
      mock.onGet(`${BASE}/models/grok-4.5`).reply(response)

      const result = await service.getModel('grok-4.5')

      expect(result).toEqual(response)
    })

    it('encodes model ID in URL', async () => {
      mock.onGet(`${BASE}/models/my%20model`).reply({ id: 'my model' })

      await service.getModel('my model')

      expect(mock.history[0].url).toBe(`${BASE}/models/my%20model`)
    })

    it('throws on missing model ID', async () => {
      await expect(service.getModel('')).rejects.toThrow('Model ID is required')
    })
  })

  describe('listLanguageModels', () => {
    it('returns language models', async () => {
      const response = { models: [{ id: 'grok-4.5', context_length: 500000 }] }
      mock.onGet(`${BASE}/language-models`).reply(response)

      const result = await service.listLanguageModels()

      expect(result).toEqual(response)
    })
  })

  describe('listImageGenerationModels', () => {
    it('returns image generation models', async () => {
      const response = { models: [{ id: 'grok-imagine-image' }] }
      mock.onGet(`${BASE}/image-generation-models`).reply(response)

      const result = await service.listImageGenerationModels()

      expect(result).toEqual(response)
    })
  })

  describe('listVideoGenerationModels', () => {
    it('returns video generation models', async () => {
      const response = { models: [{ id: 'grok-imagine-video' }] }
      mock.onGet(`${BASE}/video-generation-models`).reply(response)

      const result = await service.listVideoGenerationModels()

      expect(result).toEqual(response)
    })
  })

  // ── Error Handling ──

  describe('error normalization', () => {
    it('extracts error.body.error.message', async () => {
      mock.onGet(`${BASE}/models`).replyWithError({
        message: 'Request failed',
        body: { error: { message: 'Invalid API key provided' } },
      })

      await expect(service.listModels()).rejects.toThrow('Invalid API key provided')
    })

    it('extracts string error.body.error', async () => {
      mock.onGet(`${BASE}/models`).replyWithError({
        message: 'Request failed',
        body: { error: 'Unauthorized access' },
      })

      await expect(service.listModels()).rejects.toThrow('Unauthorized access')
    })

    it('extracts error.body.message', async () => {
      mock.onGet(`${BASE}/models`).replyWithError({
        message: 'Request failed',
        body: { message: 'Rate limit exceeded' },
      })

      await expect(service.listModels()).rejects.toThrow('Rate limit exceeded')
    })

    it('falls back to error.message', async () => {
      mock.onGet(`${BASE}/models`).replyWithError({
        message: 'Network timeout',
      })

      await expect(service.listModels()).rejects.toThrow('Network timeout')
    })
  })
})
