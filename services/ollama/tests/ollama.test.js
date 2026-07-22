'use strict'

const { createSandbox } = require('../../../service-sandbox')

const BASE_URL = 'http://localhost:11434'
const API_KEY = 'test-api-key'

describe('Ollama Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ url: `${BASE_URL}/`, apiKey: API_KEY })
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
          expect.objectContaining({ name: 'url', required: true, shared: false }),
          expect.objectContaining({ name: 'apiKey', required: false, shared: false }),
        ])
      )
    })
  })

  // ── Constructor ──

  describe('constructor', () => {
    it('strips trailing slashes from url', async () => {
      // The sandbox was created with a trailing slash; verify the request URL has no trailing slash
      mock.onGet(`${BASE_URL}/api/version`).reply({ version: '0.9.6' })

      await service.getVersion()

      expect(mock.history[0].url).toBe(`${BASE_URL}/api/version`)
    })
  })

  // ── Generation ──

  describe('generateCompletion', () => {
    it('sends correct request with required params only', async () => {
      mock.onPost(`${BASE_URL}/api/generate`).reply({
        model: 'llama3.2:3b',
        response: 'Hello!',
        done: true,
      })

      const result = await service.generateCompletion('llama3.2:3b', 'Say hello')

      expect(result).toHaveProperty('response', 'Hello!')
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].headers).toMatchObject({
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
      })
      expect(mock.history[0].body).toMatchObject({
        model: 'llama3.2:3b',
        prompt: 'Say hello',
        stream: false,
      })
      // Optional fields should be omitted
      expect(mock.history[0].body).not.toHaveProperty('system')
      expect(mock.history[0].body).not.toHaveProperty('format')
      expect(mock.history[0].body).not.toHaveProperty('options')
      expect(mock.history[0].body).not.toHaveProperty('think')
      expect(mock.history[0].body).not.toHaveProperty('keep_alive')
    })

    it('sends all optional parameters when provided', async () => {
      mock.onPost(`${BASE_URL}/api/generate`).reply({ model: 'llama3.2:3b', response: '{}', done: true })

      await service.generateCompletion(
        'llama3.2:3b',
        'Answer in JSON',
        'You are helpful.',
        'JSON Object',
        null,
        { temperature: 0.7 },
        'Enabled',
        '10m'
      )

      expect(mock.history[0].body).toMatchObject({
        model: 'llama3.2:3b',
        prompt: 'Answer in JSON',
        system: 'You are helpful.',
        format: 'json',
        options: { temperature: 0.7 },
        think: true,
        keep_alive: '10m',
        stream: false,
      })
    })

    it('resolves format to json_schema when formatSchema is provided', async () => {
      const schema = { type: 'object', properties: { age: { type: 'integer' } }, required: ['age'] }
      mock.onPost(`${BASE_URL}/api/generate`).reply({ model: 'llama3.2:3b', response: '{"age":25}', done: true })

      await service.generateCompletion('llama3.2:3b', 'How old?', null, 'JSON Schema', schema)

      expect(mock.history[0].body.format).toEqual(schema)
    })

    it('throws when JSON Schema format is selected without a schema', async () => {
      await expect(
        service.generateCompletion('llama3.2:3b', 'test', null, 'JSON Schema', null)
      ).rejects.toThrow('"Format Schema" must be provided')
    })

    it('resolves think dropdown values correctly', async () => {
      const thinkValues = [
        ['Disabled', false],
        ['Enabled', true],
        ['Low', 'low'],
        ['Medium', 'medium'],
        ['High', 'high'],
        ['Max', 'max'],
      ]

      for (const [label, expected] of thinkValues) {
        mock.reset()
        mock.onPost(`${BASE_URL}/api/generate`).reply({ model: 'm', response: '', done: true })

        await service.generateCompletion('m', 'test', null, null, null, null, label)

        expect(mock.history[0].body.think).toBe(expected)
      }
    })

    it('omits options when empty object is provided', async () => {
      mock.onPost(`${BASE_URL}/api/generate`).reply({ model: 'm', response: '', done: true })

      await service.generateCompletion('m', 'test', null, null, null, {})

      expect(mock.history[0].body).not.toHaveProperty('options')
    })

    it('throws on API error', async () => {
      mock.onPost(`${BASE_URL}/api/generate`).replyWithError({
        message: 'model not found',
        body: { error: 'model "bad" not found' },
      })

      await expect(service.generateCompletion('bad', 'test')).rejects.toThrow('Ollama API error')
    })
  })

  describe('chat', () => {
    const messages = [{ role: 'user', content: 'Hello' }]

    it('sends correct request with required params', async () => {
      mock.onPost(`${BASE_URL}/api/chat`).reply({
        model: 'llama3.2:3b',
        message: { role: 'assistant', content: 'Hi!' },
        done: true,
      })

      const result = await service.chat('llama3.2:3b', messages)

      expect(result).toHaveProperty('message')
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].body).toMatchObject({
        model: 'llama3.2:3b',
        messages,
        stream: false,
      })
      expect(mock.history[0].body).not.toHaveProperty('tools')
      expect(mock.history[0].body).not.toHaveProperty('format')
    })

    it('throws when messages is empty', async () => {
      await expect(service.chat('m', [])).rejects.toThrow('must be a non-empty array')
    })

    it('throws when messages is not an array', async () => {
      await expect(service.chat('m', 'not-array')).rejects.toThrow('must be a non-empty array')
    })

    it('sends tools when provided', async () => {
      const tools = [{ type: 'function', function: { name: 'get_weather', description: 'Get weather' } }]
      mock.onPost(`${BASE_URL}/api/chat`).reply({ model: 'm', message: { role: 'assistant', content: '' }, done: true })

      await service.chat('m', messages, null, tools)

      expect(mock.history[0].body.tools).toEqual(tools)
    })

    it('omits tools when empty array', async () => {
      mock.onPost(`${BASE_URL}/api/chat`).reply({ model: 'm', message: { role: 'assistant', content: '' }, done: true })

      await service.chat('m', messages, null, [])

      expect(mock.history[0].body).not.toHaveProperty('tools')
    })

    it('downloads and attaches images from imageUrls', async () => {
      const imageBuffer = Buffer.from('fake-image-data')
      mock.onGet('https://example.com/image.png').reply(imageBuffer)
      mock.onPost(`${BASE_URL}/api/chat`).reply({ model: 'm', message: { role: 'assistant', content: 'I see' }, done: true })

      await service.chat('m', messages, ['https://example.com/image.png'])

      // The image download + chat request
      expect(mock.history).toHaveLength(2)
      // The chat body should have images on the last user message
      const chatBody = mock.history[1].body
      expect(chatBody.messages[0].images).toBeDefined()
      expect(chatBody.messages[0].images).toHaveLength(1)
    })

    it('attaches images to the last user message', async () => {
      const multiMessages = [
        { role: 'user', content: 'First' },
        { role: 'assistant', content: 'Reply' },
        { role: 'user', content: 'Second' },
      ]
      const imageBuffer = Buffer.from('img')
      mock.onGet('https://example.com/img.png').reply(imageBuffer)
      mock.onPost(`${BASE_URL}/api/chat`).reply({ model: 'm', message: { role: 'assistant', content: '' }, done: true })

      await service.chat('m', multiMessages, ['https://example.com/img.png'])

      const chatBody = mock.history[1].body
      // First user message should NOT have images
      expect(chatBody.messages[0].images).toBeUndefined()
      // Last user message (index 2) should have images
      expect(chatBody.messages[2].images).toHaveLength(1)
    })

    it('throws when imageUrls provided but no user message exists', async () => {
      const systemOnly = [{ role: 'system', content: 'You are helpful' }]

      await expect(
        service.chat('m', systemOnly, ['https://example.com/img.png'])
      ).rejects.toThrow('requires at least one message with role "user"')
    })

    it('throws on invalid image URL', async () => {
      await expect(
        service.chat('m', messages, ['not-a-url'])
      ).rejects.toThrow('Invalid image URL')
    })

    it('sends all optional parameters', async () => {
      mock.onPost(`${BASE_URL}/api/chat`).reply({ model: 'm', message: { role: 'assistant', content: '' }, done: true })

      await service.chat('m', messages, null, null, 'JSON Object', null, { temperature: 0.5 }, 'High', '5m')

      expect(mock.history[0].body).toMatchObject({
        format: 'json',
        options: { temperature: 0.5 },
        think: 'high',
        keep_alive: '5m',
        stream: false,
      })
    })

    it('throws on API error', async () => {
      mock.onPost(`${BASE_URL}/api/chat`).replyWithError({
        message: 'server error',
        body: { error: 'internal error' },
      })

      await expect(service.chat('m', messages)).rejects.toThrow('Ollama API error')
    })
  })

  // ── Embeddings ──

  describe('createEmbeddings', () => {
    it('sends correct request', async () => {
      mock.onPost(`${BASE_URL}/api/embed`).reply({
        model: 'nomic-embed-text',
        embeddings: [[0.1, 0.2, 0.3]],
      })

      const result = await service.createEmbeddings('nomic-embed-text', ['Hello world'])

      expect(result).toHaveProperty('embeddings')
      expect(mock.history[0].body).toMatchObject({
        model: 'nomic-embed-text',
        input: ['Hello world'],
      })
    })

    it('sends optional parameters', async () => {
      mock.onPost(`${BASE_URL}/api/embed`).reply({ model: 'm', embeddings: [[]] })

      await service.createEmbeddings('m', ['text'], false, 128, { num_ctx: 8192 }, '0')

      expect(mock.history[0].body).toMatchObject({
        model: 'm',
        input: ['text'],
        truncate: false,
        dimensions: 128,
        options: { num_ctx: 8192 },
        keep_alive: '0',
      })
    })

    it('throws when input is empty', async () => {
      await expect(service.createEmbeddings('m', [])).rejects.toThrow('must be a non-empty array')
    })

    it('throws when input is not an array', async () => {
      await expect(service.createEmbeddings('m', 'text')).rejects.toThrow('must be a non-empty array')
    })

    it('throws on API error', async () => {
      mock.onPost(`${BASE_URL}/api/embed`).replyWithError({ message: 'Bad request' })

      await expect(service.createEmbeddings('m', ['test'])).rejects.toThrow('Ollama API error')
    })
  })

  // ── Model Management ──

  describe('listLocalModels', () => {
    it('sends GET to /api/tags', async () => {
      mock.onGet(`${BASE_URL}/api/tags`).reply({ models: [{ name: 'llama3.2:3b' }] })

      const result = await service.listLocalModels()

      expect(result.models).toHaveLength(1)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].headers).toMatchObject({
        'Authorization': `Bearer ${API_KEY}`,
      })
    })
  })

  describe('showModelInfo', () => {
    it('sends POST with model name', async () => {
      mock.onPost(`${BASE_URL}/api/show`).reply({
        modelfile: '# Modelfile',
        details: { family: 'llama' },
      })

      const result = await service.showModelInfo('llama3.2:3b')

      expect(result).toHaveProperty('details')
      expect(mock.history[0].body).toEqual({ model: 'llama3.2:3b' })
    })

    it('includes verbose when true', async () => {
      mock.onPost(`${BASE_URL}/api/show`).reply({ modelfile: '', details: {} })

      await service.showModelInfo('m', true)

      expect(mock.history[0].body).toEqual({ model: 'm', verbose: true })
    })

    it('omits verbose when not provided', async () => {
      mock.onPost(`${BASE_URL}/api/show`).reply({ modelfile: '', details: {} })

      await service.showModelInfo('m')

      expect(mock.history[0].body).toEqual({ model: 'm' })
    })
  })

  describe('pullModel', () => {
    it('sends POST with model and stream false', async () => {
      mock.onPost(`${BASE_URL}/api/pull`).reply({ status: 'success' })

      const result = await service.pullModel('llama3.2:3b')

      expect(result).toEqual({ status: 'success' })
      expect(mock.history[0].body).toEqual({ model: 'llama3.2:3b', stream: false })
    })

    it('throws on API error', async () => {
      mock.onPost(`${BASE_URL}/api/pull`).replyWithError({ message: 'pull failed' })

      await expect(service.pullModel('bad-model')).rejects.toThrow('Ollama API error')
    })
  })

  describe('copyModel', () => {
    it('sends POST and returns synthesized result', async () => {
      mock.onPost(`${BASE_URL}/api/copy`).reply('')

      const result = await service.copyModel('llama3.2:3b', 'llama3.2-backup')

      expect(result).toEqual({ source: 'llama3.2:3b', destination: 'llama3.2-backup', copied: true })
      expect(mock.history[0].body).toEqual({ source: 'llama3.2:3b', destination: 'llama3.2-backup' })
    })

    it('throws on API error', async () => {
      mock.onPost(`${BASE_URL}/api/copy`).replyWithError({
        message: 'not found',
        body: { error: 'model "missing" not found' },
      })

      await expect(service.copyModel('missing', 'dest')).rejects.toThrow('Ollama API error')
    })
  })

  describe('deleteModel', () => {
    it('sends DELETE and returns synthesized result', async () => {
      mock.onDelete(`${BASE_URL}/api/delete`).reply('')

      const result = await service.deleteModel('llama3.2:3b')

      expect(result).toEqual({ model: 'llama3.2:3b', deleted: true })
      expect(mock.history[0].body).toEqual({ model: 'llama3.2:3b' })
    })

    it('throws on API error', async () => {
      mock.onDelete(`${BASE_URL}/api/delete`).replyWithError({
        message: 'not found',
        body: { error: 'model not found' },
      })

      await expect(service.deleteModel('missing')).rejects.toThrow('Ollama API error')
    })
  })

  describe('listRunningModels', () => {
    it('sends GET to /api/ps', async () => {
      mock.onGet(`${BASE_URL}/api/ps`).reply({ models: [] })

      const result = await service.listRunningModels()

      expect(result).toEqual({ models: [] })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
    })
  })

  // ── Server ──

  describe('getVersion', () => {
    it('sends GET to /api/version', async () => {
      mock.onGet(`${BASE_URL}/api/version`).reply({ version: '0.9.6' })

      const result = await service.getVersion()

      expect(result).toEqual({ version: '0.9.6' })
      expect(mock.history[0].method).toBe('get')
    })

    it('throws on API error', async () => {
      mock.onGet(`${BASE_URL}/api/version`).replyWithError({ message: 'Connection refused' })

      await expect(service.getVersion()).rejects.toThrow('Ollama API error')
    })
  })

  // ── Dictionaries ──

  describe('getModelsDictionary', () => {
    const modelsResponse = {
      models: [
        { name: 'llama3.2:3b', details: { parameter_size: '3.2B', family: 'llama' } },
        { name: 'nomic-embed-text', details: { parameter_size: '137M', family: 'nomic-bert' } },
        { name: 'gemma3:4b', details: { parameter_size: '4B', family: 'gemma3' } },
      ],
    }

    it('returns mapped items with label, value, and note', async () => {
      mock.onGet(`${BASE_URL}/api/tags`).reply(modelsResponse)

      const result = await service.getModelsDictionary({})

      expect(result.items).toHaveLength(3)
      expect(result.cursor).toBeNull()
      // Items should be sorted alphabetically
      expect(result.items[0]).toEqual({ label: 'gemma3:4b', value: 'gemma3:4b', note: '4B gemma3' })
      expect(result.items[1]).toEqual({ label: 'llama3.2:3b', value: 'llama3.2:3b', note: '3.2B llama' })
      expect(result.items[2]).toEqual({ label: 'nomic-embed-text', value: 'nomic-embed-text', note: '137M nomic-bert' })
    })

    it('filters by case-insensitive search', async () => {
      mock.onGet(`${BASE_URL}/api/tags`).reply(modelsResponse)

      const result = await service.getModelsDictionary({ search: 'LLAMA' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('llama3.2:3b')
    })

    it('handles null payload', async () => {
      mock.onGet(`${BASE_URL}/api/tags`).reply(modelsResponse)

      const result = await service.getModelsDictionary(null)

      expect(result.items).toHaveLength(3)
      expect(result.cursor).toBeNull()
    })

    it('handles empty models list', async () => {
      mock.onGet(`${BASE_URL}/api/tags`).reply({ models: [] })

      const result = await service.getModelsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('handles null models in response', async () => {
      mock.onGet(`${BASE_URL}/api/tags`).reply({})

      const result = await service.getModelsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('handles model with missing details', async () => {
      mock.onGet(`${BASE_URL}/api/tags`).reply({
        models: [{ name: 'custom-model' }],
      })

      const result = await service.getModelsDictionary({})

      expect(result.items[0]).toEqual({ label: 'custom-model', value: 'custom-model' })
    })

    it('returns no results when search does not match', async () => {
      mock.onGet(`${BASE_URL}/api/tags`).reply(modelsResponse)

      const result = await service.getModelsDictionary({ search: 'nonexistent' })

      expect(result.items).toHaveLength(0)
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('uses error.body.error when available', async () => {
      mock.onGet(`${BASE_URL}/api/version`).replyWithError({
        message: 'generic',
        body: { error: 'specific error from API' },
      })

      await expect(service.getVersion()).rejects.toThrow('specific error from API')
    })

    it('uses error.body.message as fallback', async () => {
      mock.onGet(`${BASE_URL}/api/version`).replyWithError({
        message: 'generic',
        body: { message: 'body message fallback' },
      })

      await expect(service.getVersion()).rejects.toThrow('body message fallback')
    })

    it('uses error.message as final fallback', async () => {
      mock.onGet(`${BASE_URL}/api/version`).replyWithError({
        message: 'Network timeout',
      })

      await expect(service.getVersion()).rejects.toThrow('Network timeout')
    })
  })
})
