'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-api-key'
const BASE = 'https://api.deepseek.com'
const BETA = 'https://api.deepseek.com/beta'

const AUTH_HEADER = `Bearer ${ API_KEY }`

// Minimal OpenAI-compatible chat completion response used across chat tests.
const chatResponse = ({
  content = 'Hello there!',
  reasoning = null,
  model = 'deepseek-v4-flash',
  finishReason = 'stop',
} = {}) => ({
  id: 'chatcmpl-abc',
  object: 'chat.completion',
  created: 1752345600,
  model,
  choices: [
    {
      index: 0,
      message: { role: 'assistant', content, reasoning_content: reasoning },
      finish_reason: finishReason,
    },
  ],
  usage: {
    prompt_tokens: 10,
    completion_tokens: 5,
    total_tokens: 15,
    prompt_cache_hit_tokens: 0,
    prompt_cache_miss_tokens: 10,
  },
})

const completionResponse = ({
  text = '    return a',
  model = 'deepseek-v4-pro',
  finishReason = 'stop',
} = {}) => ({
  id: 'cmpl-abc',
  object: 'text_completion',
  created: 1752345600,
  model,
  choices: [{ index: 0, text, finish_reason: finishReason }],
  usage: { prompt_tokens: 16, completion_tokens: 12, total_tokens: 28 },
})

describe('DeepSeek Service', () => {
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

    it('sends Bearer auth and JSON content-type on requests with a body', async () => {
      mock.onPost(`${ BASE }/chat/completions`).reply(chatResponse())

      await service.chatCompletion('Hi')

      expect(mock.history[0].headers).toMatchObject({
        'Authorization': AUTH_HEADER,
        'Content-Type': 'application/json',
      })
    })

    it('sends Bearer auth without content-type on GET requests', async () => {
      mock.onGet(`${ BASE }/models`).reply({ object: 'list', data: [] })

      await service.listModels()

      expect(mock.history[0].headers).toMatchObject({ 'Authorization': AUTH_HEADER })
      expect(mock.history[0].headers).not.toHaveProperty('Content-Type')
    })
  })

  // ── Chat Completion ──

  describe('chatCompletion', () => {
    it('sends correct request with required params only and shapes the response', async () => {
      mock.onPost(`${ BASE }/chat/completions`).reply(
        chatResponse({ content: 'Answer', model: 'deepseek-v4-flash' })
      )

      const result = await service.chatCompletion('What is FlowRunner?')

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/chat/completions`)
      expect(mock.history[0].body).toEqual({
        model: 'deepseek-v4-flash',
        messages: [{ role: 'user', content: 'What is FlowRunner?' }],
      })
      expect(result).toEqual({
        text: 'Answer',
        reasoningContent: null,
        model: 'deepseek-v4-flash',
        finishReason: 'stop',
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
          prompt_cache_hit_tokens: 0,
          prompt_cache_miss_tokens: 10,
        },
      })
    })

    it('includes system prompt and all options when provided', async () => {
      mock.onPost(`${ BASE }/chat/completions`).reply(
        chatResponse({ content: 'JSON!', reasoning: 'because', model: 'deepseek-v4-pro' })
      )

      const result = await service.chatCompletion(
        'Return JSON',
        'deepseek-v4-pro',
        'You are helpful',
        'Enabled',
        'Max',
        0.5,
        0.9,
        1024,
        ['STOP'],
        true
      )

      expect(mock.history[0].body).toEqual({
        model: 'deepseek-v4-pro',
        messages: [
          { role: 'system', content: 'You are helpful' },
          { role: 'user', content: 'Return JSON' },
        ],
        thinking: { type: 'enabled' },
        reasoning_effort: 'max',
        temperature: 0.5,
        top_p: 0.9,
        max_tokens: 1024,
        stop: ['STOP'],
        response_format: { type: 'json_object' },
      })
      expect(result.reasoningContent).toBe('because')
      expect(result.model).toBe('deepseek-v4-pro')
    })

    it('maps Disabled thinking mode to thinking.type disabled', async () => {
      mock.onPost(`${ BASE }/chat/completions`).reply(chatResponse())

      await service.chatCompletion('Hi', undefined, undefined, 'Disabled')

      expect(mock.history[0].body.thinking).toEqual({ type: 'disabled' })
    })

    it('omits thinking when mode is Default', async () => {
      mock.onPost(`${ BASE }/chat/completions`).reply(chatResponse())

      await service.chatCompletion('Hi', undefined, undefined, 'Default')

      expect(mock.history[0].body).not.toHaveProperty('thinking')
      expect(mock.history[0].body).not.toHaveProperty('reasoning_effort')
    })

    it('includes temperature 0 (falsy but not null/undefined)', async () => {
      mock.onPost(`${ BASE }/chat/completions`).reply(chatResponse())

      await service.chatCompletion('Hi', undefined, undefined, undefined, undefined, 0, 0)

      expect(mock.history[0].body.temperature).toBe(0)
      expect(mock.history[0].body.top_p).toBe(0)
    })

    it('omits max_tokens when zero and stop when empty array', async () => {
      mock.onPost(`${ BASE }/chat/completions`).reply(chatResponse())

      await service.chatCompletion('Hi', undefined, undefined, undefined, undefined, undefined, undefined, 0, [])

      expect(mock.history[0].body).not.toHaveProperty('max_tokens')
      expect(mock.history[0].body).not.toHaveProperty('stop')
    })

    it('defaults empty content and null reasoning when choices are missing', async () => {
      mock.onPost(`${ BASE }/chat/completions`).reply({ model: 'deepseek-v4-flash', choices: [] })

      const result = await service.chatCompletion('Hi')

      expect(result).toEqual({
        text: '',
        reasoningContent: null,
        model: 'deepseek-v4-flash',
        finishReason: null,
        usage: null,
      })
    })

    it('throws when prompt is empty', async () => {
      await expect(service.chatCompletion('   ')).rejects.toThrow('Prompt is required')
      expect(mock.history).toHaveLength(0)
    })

    it('throws when prompt is missing', async () => {
      await expect(service.chatCompletion()).rejects.toThrow('Prompt is required')
    })

    it('throws a normalized error from body.error.message', async () => {
      mock.onPost(`${ BASE }/chat/completions`).replyWithError({
        message: 'Request failed',
        body: { error: { message: 'Insufficient Balance' } },
      })

      await expect(service.chatCompletion('Hi')).rejects.toThrow('Insufficient Balance')
    })

    it('throws a normalized error from body.message', async () => {
      mock.onPost(`${ BASE }/chat/completions`).replyWithError({
        message: 'Request failed',
        body: { message: 'Authentication Fails' },
      })

      await expect(service.chatCompletion('Hi')).rejects.toThrow('Authentication Fails')
    })

    it('falls back to the original message when body has no error detail', async () => {
      mock.onPost(`${ BASE }/chat/completions`).replyWithError({ message: 'Network Error' })

      await expect(service.chatCompletion('Hi')).rejects.toThrow('Network Error')
    })
  })

  // ── Chat Completion (Advanced) ──

  describe('chatCompletionAdvanced', () => {
    const messages = [
      { role: 'system', content: 'You are helpful' },
      { role: 'user', content: 'Hi' },
    ]

    it('sends correct request with required params only and returns the raw response', async () => {
      const raw = chatResponse({ content: 'Hi back' })
      mock.onPost(`${ BASE }/chat/completions`).reply(raw)

      const result = await service.chatCompletionAdvanced(messages)

      expect(mock.history[0].url).toBe(`${ BASE }/chat/completions`)
      expect(mock.history[0].body).toEqual({ model: 'deepseek-v4-flash', messages })
      expect(result).toEqual(raw)
    })

    it('includes all options, tools and a string tool choice', async () => {
      mock.onPost(`${ BASE }/chat/completions`).reply(chatResponse())

      const tools = [{ type: 'function', function: { name: 'lookup' } }]

      await service.chatCompletionAdvanced(
        messages,
        'deepseek-v4-pro',
        'Enabled',
        'High',
        0.7,
        0.8,
        2048,
        ['END'],
        { type: 'json_object' },
        tools,
        'auto',
        true,
        5
      )

      expect(mock.history[0].body).toEqual({
        model: 'deepseek-v4-pro',
        messages,
        thinking: { type: 'enabled' },
        reasoning_effort: 'high',
        temperature: 0.7,
        top_p: 0.8,
        max_tokens: 2048,
        stop: ['END'],
        response_format: { type: 'json_object' },
        tools,
        logprobs: true,
        top_logprobs: 5,
        tool_choice: 'auto',
      })
    })

    it('parses a JSON-object tool choice string into an object', async () => {
      mock.onPost(`${ BASE }/chat/completions`).reply(chatResponse())

      await service.chatCompletionAdvanced(
        messages,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        '{"type":"function","function":{"name":"lookup"}}'
      )

      expect(mock.history[0].body.tool_choice).toEqual({
        type: 'function',
        function: { name: 'lookup' },
      })
    })

    it('includes logprobs false when explicitly provided', async () => {
      mock.onPost(`${ BASE }/chat/completions`).reply(chatResponse())

      await service.chatCompletionAdvanced(
        messages,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        false
      )

      expect(mock.history[0].body.logprobs).toBe(false)
    })

    it('omits tools when the array is empty', async () => {
      mock.onPost(`${ BASE }/chat/completions`).reply(chatResponse())

      await service.chatCompletionAdvanced(messages, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, [])

      expect(mock.history[0].body).not.toHaveProperty('tools')
    })

    it('throws when the messages array is empty', async () => {
      await expect(service.chatCompletionAdvanced([])).rejects.toThrow(
        'Messages array is required and must not be empty'
      )
      expect(mock.history).toHaveLength(0)
    })

    it('throws when messages is missing', async () => {
      await expect(service.chatCompletionAdvanced()).rejects.toThrow(
        'Messages array is required and must not be empty'
      )
    })

    it('throws a normalized error on API failure', async () => {
      mock.onPost(`${ BASE }/chat/completions`).replyWithError({
        message: 'Request failed',
        body: { error: { message: 'Model Not Exist' } },
      })

      await expect(service.chatCompletionAdvanced(messages)).rejects.toThrow('Model Not Exist')
    })
  })

  // ── Chat Prefix Completion (beta) ──

  describe('chatPrefixCompletion', () => {
    it('sends to the beta endpoint with a prefix assistant message and shapes the response', async () => {
      mock.onPost(`${ BETA }/chat/completions`).reply(
        chatResponse({ content: 'def add(a, b):\n    return a + b\n', model: 'deepseek-v4-pro' })
      )

      const result = await service.chatPrefixCompletion('Write add()', '```python\n')

      expect(mock.history[0].url).toBe(`${ BETA }/chat/completions`)
      expect(mock.history[0].body).toEqual({
        model: 'deepseek-v4-pro',
        messages: [
          { role: 'user', content: 'Write add()' },
          { role: 'assistant', content: '```python\n', prefix: true },
        ],
      })
      expect(result.text).toBe('def add(a, b):\n    return a + b\n')
      expect(result.fullText).toBe('```python\ndef add(a, b):\n    return a + b\n')
      expect(result.model).toBe('deepseek-v4-pro')
      expect(result.finishReason).toBe('stop')
      expect(result.usage).toMatchObject({ total_tokens: 15 })
    })

    it('includes system prompt and optional sampling params', async () => {
      mock.onPost(`${ BETA }/chat/completions`).reply(chatResponse({ content: '}' }))

      await service.chatPrefixCompletion(
        'Return JSON',
        '{',
        'deepseek-v4-flash',
        'Be terse',
        0.2,
        256,
        ['```']
      )

      expect(mock.history[0].body).toEqual({
        model: 'deepseek-v4-flash',
        messages: [
          { role: 'system', content: 'Be terse' },
          { role: 'user', content: 'Return JSON' },
          { role: 'assistant', content: '{', prefix: true },
        ],
        temperature: 0.2,
        max_tokens: 256,
        stop: ['```'],
      })
    })

    it('builds fullText even when the continuation is empty', async () => {
      mock.onPost(`${ BETA }/chat/completions`).reply({ model: 'deepseek-v4-pro', choices: [] })

      const result = await service.chatPrefixCompletion('Do it', 'PREFIX')

      expect(result.text).toBe('')
      expect(result.fullText).toBe('PREFIX')
      expect(result.finishReason).toBeNull()
      expect(result.usage).toBeNull()
    })

    it('throws when prompt is empty', async () => {
      await expect(service.chatPrefixCompletion('  ', '{')).rejects.toThrow('Prompt is required')
      expect(mock.history).toHaveLength(0)
    })

    it('throws when assistant prefix is missing', async () => {
      await expect(service.chatPrefixCompletion('Do it')).rejects.toThrow(
        'Assistant Prefix is required'
      )
      expect(mock.history).toHaveLength(0)
    })

    it('throws a normalized error on API failure', async () => {
      mock.onPost(`${ BETA }/chat/completions`).replyWithError({
        message: 'Request failed',
        body: { error: { message: 'Prefix mode not supported' } },
      })

      await expect(service.chatPrefixCompletion('Do it', '{')).rejects.toThrow(
        'Prefix mode not supported'
      )
    })
  })

  // ── FIM Completion (beta) ──

  describe('fimCompletion', () => {
    it('sends to the beta completions endpoint with required params only', async () => {
      mock.onPost(`${ BETA }/completions`).reply(completionResponse({ text: '    return a' }))

      const result = await service.fimCompletion('def fib(a):')

      expect(mock.history[0].url).toBe(`${ BETA }/completions`)
      expect(mock.history[0].body).toEqual({
        model: 'deepseek-v4-pro',
        prompt: 'def fib(a):',
      })
      expect(result).toEqual({
        text: '    return a',
        model: 'deepseek-v4-pro',
        finishReason: 'stop',
        usage: { prompt_tokens: 16, completion_tokens: 12, total_tokens: 28 },
      })
    })

    it('includes all optional params, including echo and suffix', async () => {
      mock.onPost(`${ BETA }/completions`).reply(completionResponse())

      await service.fimCompletion(
        'def fib(a):',
        '    return fib(a-1) + fib(a-2)',
        'deepseek-v4-pro',
        128,
        0.3,
        0.95,
        ['\n\n'],
        true
      )

      expect(mock.history[0].body).toEqual({
        model: 'deepseek-v4-pro',
        prompt: 'def fib(a):',
        suffix: '    return fib(a-1) + fib(a-2)',
        max_tokens: 128,
        temperature: 0.3,
        top_p: 0.95,
        stop: ['\n\n'],
        echo: true,
      })
    })

    it('includes temperature 0 and echo false when explicitly provided', async () => {
      mock.onPost(`${ BETA }/completions`).reply(completionResponse())

      await service.fimCompletion('x', undefined, undefined, undefined, 0, 0, undefined, false)

      expect(mock.history[0].body.temperature).toBe(0)
      expect(mock.history[0].body.top_p).toBe(0)
      expect(mock.history[0].body.echo).toBe(false)
    })

    it('defaults empty text when choices are missing', async () => {
      mock.onPost(`${ BETA }/completions`).reply({ model: 'deepseek-v4-pro', choices: [] })

      const result = await service.fimCompletion('x')

      expect(result).toEqual({
        text: '',
        model: 'deepseek-v4-pro',
        finishReason: null,
        usage: null,
      })
    })

    it('throws when prompt is empty', async () => {
      await expect(service.fimCompletion('   ')).rejects.toThrow('Prompt is required')
      expect(mock.history).toHaveLength(0)
    })

    it('throws a normalized error on API failure', async () => {
      mock.onPost(`${ BETA }/completions`).replyWithError({
        message: 'Request failed',
        body: { error: { message: 'FIM not supported for model' } },
      })

      await expect(service.fimCompletion('x')).rejects.toThrow('FIM not supported for model')
    })
  })

  // ── Models Dictionary ──

  describe('getModelsDictionary', () => {
    const modelsResponse = {
      object: 'list',
      data: [
        { id: 'deepseek-v4-pro', object: 'model', owned_by: 'deepseek' },
        { id: 'deepseek-v4-flash', object: 'model', owned_by: 'deepseek' },
      ],
    }

    it('lists models via GET /models, sorted, with a null cursor', async () => {
      mock.onGet(`${ BASE }/models`).reply(modelsResponse)

      const result = await service.getModelsDictionary({})

      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/models`)
      expect(result).toEqual({
        items: [
          { label: 'deepseek-v4-flash', value: 'deepseek-v4-flash', note: 'deepseek' },
          { label: 'deepseek-v4-pro', value: 'deepseek-v4-pro', note: 'deepseek' },
        ],
        cursor: null,
      })
    })

    it('filters models by search term', async () => {
      mock.onGet(`${ BASE }/models`).reply(modelsResponse)

      const result = await service.getModelsDictionary({ search: 'flash' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('deepseek-v4-flash')
    })

    it('handles a null payload', async () => {
      mock.onGet(`${ BASE }/models`).reply(modelsResponse)

      const result = await service.getModelsDictionary(null)

      expect(result.items).toHaveLength(2)
      expect(result.cursor).toBeNull()
    })

    it('uses null note when owned_by is absent and handles missing data', async () => {
      mock.onGet(`${ BASE }/models`).reply({ object: 'list', data: [{ id: 'model-x' }] })

      const result = await service.getModelsDictionary({})

      expect(result.items).toEqual([{ label: 'model-x', value: 'model-x', note: null }])
    })

    it('returns empty items when data is missing entirely', async () => {
      mock.onGet(`${ BASE }/models`).reply({ object: 'list' })

      const result = await service.getModelsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('propagates a normalized error on API failure', async () => {
      mock.onGet(`${ BASE }/models`).replyWithError({
        message: 'Request failed',
        body: { error: { message: 'Unauthorized' } },
      })

      await expect(service.getModelsDictionary({})).rejects.toThrow('Unauthorized')
    })
  })

  // ── List Models ──

  describe('listModels', () => {
    it('returns the raw models list from GET /models', async () => {
      const raw = {
        object: 'list',
        data: [{ id: 'deepseek-v4-flash', object: 'model', owned_by: 'deepseek' }],
      }
      mock.onGet(`${ BASE }/models`).reply(raw)

      const result = await service.listModels()

      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/models`)
      expect(result).toEqual(raw)
    })

    it('throws a normalized error on API failure', async () => {
      mock.onGet(`${ BASE }/models`).replyWithError({
        message: 'Request failed',
        body: { message: 'Authentication Fails' },
      })

      await expect(service.listModels()).rejects.toThrow('Authentication Fails')
    })
  })

  // ── Balance ──

  describe('getBalance', () => {
    it('returns the balance from GET /user/balance', async () => {
      const raw = {
        is_available: true,
        balance_infos: [
          { currency: 'USD', total_balance: '110.00', granted_balance: '10.00', topped_up_balance: '100.00' },
        ],
      }
      mock.onGet(`${ BASE }/user/balance`).reply(raw)

      const result = await service.getBalance()

      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/user/balance`)
      expect(mock.history[0].headers).toMatchObject({ 'Authorization': AUTH_HEADER })
      expect(result).toEqual(raw)
    })

    it('throws a normalized error on API failure', async () => {
      mock.onGet(`${ BASE }/user/balance`).replyWithError({ message: 'Server Error' })

      await expect(service.getBalance()).rejects.toThrow('Server Error')
    })
  })
})
