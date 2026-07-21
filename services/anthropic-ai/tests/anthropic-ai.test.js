'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-anthropic-api-key'
const BASE = 'https://api.anthropic.com/v1'
const ANTHROPIC_VERSION = '2023-06-01'
const FILES_API_BETA = 'files-api-2025-04-14'
const MANAGED_AGENTS_BETA = 'managed-agents-2026-04-01'
const SESSION_FILES_BETA = `${ FILES_API_BETA },${ MANAGED_AGENTS_BETA }`

const COMMON_HEADERS = {
  'x-api-key': API_KEY,
  'anthropic-version': ANTHROPIC_VERSION,
}

const MESSAGE_RESPONSE = {
  id: 'msg_01XFDUDYJgAACzvnptvVoYEL',
  type: 'message',
  role: 'assistant',
  model: 'claude-opus-4-8',
  content: [{ type: 'text', text: 'Hello there!' }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 14, output_tokens: 9 },
}

describe('Anthropic Claude Service', () => {
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

  // ── Messages ──

  describe('askClaude', () => {
    it('sends correct request with required params only', async () => {
      mock.onPost(`${ BASE }/messages`).reply(MESSAGE_RESPONSE)

      const result = await service.askClaude('What is 2+2?')

      expect(result).toEqual({
        text: 'Hello there!',
        model: 'claude-opus-4-8',
        stopReason: 'end_turn',
        usage: { input_tokens: 14, output_tokens: 9 },
      })

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject(COMMON_HEADERS)
      expect(mock.history[0].body).toEqual({
        model: 'claude-opus-4-8',
        max_tokens: 4096,
        messages: [{ role: 'user', content: 'What is 2+2?' }],
      })
    })

    it('includes optional system prompt, model, maxTokens, and temperature', async () => {
      mock.onPost(`${ BASE }/messages`).reply(MESSAGE_RESPONSE)

      await service.askClaude('Hi', 'claude-sonnet-4-6', 'Be helpful', 1024, 0.5)

      expect(mock.history[0].body).toEqual({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        messages: [{ role: 'user', content: 'Hi' }],
        system: 'Be helpful',
        temperature: 0.5,
      })
    })

    it('throws when prompt is empty', async () => {
      await expect(service.askClaude('')).rejects.toThrow('Prompt is required')
    })

    it('throws on API error', async () => {
      mock.onPost(`${ BASE }/messages`).replyWithError({
        message: 'Unauthorized',
        body: { error: { message: 'Invalid API key' } },
      })

      await expect(service.askClaude('Hi')).rejects.toThrow('Invalid API key')
    })
  })

  describe('sendMessages', () => {
    const messages = [{ role: 'user', content: 'Hello' }]

    it('sends correct request with required params only', async () => {
      mock.onPost(`${ BASE }/messages`).reply(MESSAGE_RESPONSE)

      const result = await service.sendMessages(undefined, messages)

      expect(result).toMatchObject({
        text: 'Hello there!',
        model: 'claude-opus-4-8',
        stop_reason: 'end_turn',
      })

      expect(mock.history[0].body).toEqual({
        model: 'claude-opus-4-8',
        max_tokens: 4096,
        messages,
      })
    })

    it('includes system prompt', async () => {
      mock.onPost(`${ BASE }/messages`).reply(MESSAGE_RESPONSE)

      await service.sendMessages(undefined, messages, undefined, 'Be concise')

      expect(mock.history[0].body).toMatchObject({ system: 'Be concise' })
    })

    it('includes adaptive thinking', async () => {
      mock.onPost(`${ BASE }/messages`).reply(MESSAGE_RESPONSE)

      await service.sendMessages(undefined, messages, undefined, undefined, 'Adaptive')

      expect(mock.history[0].body).toMatchObject({
        thinking: { type: 'adaptive' },
      })
    })

    it('includes extended budget thinking', async () => {
      mock.onPost(`${ BASE }/messages`).reply(MESSAGE_RESPONSE)

      await service.sendMessages(undefined, messages, undefined, undefined, 'Extended Budget', 16384)

      expect(mock.history[0].body).toMatchObject({
        thinking: { type: 'enabled', budget_tokens: 16384 },
      })
    })

    it('includes effort level in output_config', async () => {
      mock.onPost(`${ BASE }/messages`).reply(MESSAGE_RESPONSE)

      await service.sendMessages(undefined, messages, undefined, undefined, undefined, undefined, 'High')

      expect(mock.history[0].body).toMatchObject({
        output_config: { effort: 'high' },
      })
    })

    it('includes json schema in output_config', async () => {
      mock.onPost(`${ BASE }/messages`).reply(MESSAGE_RESPONSE)
      const schema = { type: 'object', properties: { name: { type: 'string' } } }

      await service.sendMessages(
        undefined, messages, undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined, undefined, schema
      )

      expect(mock.history[0].body.output_config).toEqual({
        format: { type: 'json_schema', schema },
      })
    })

    it('includes sampling parameters', async () => {
      mock.onPost(`${ BASE }/messages`).reply(MESSAGE_RESPONSE)

      await service.sendMessages(
        undefined, messages, undefined, undefined, undefined, undefined, undefined,
        0.7, 0.9, 40
      )

      expect(mock.history[0].body).toMatchObject({
        temperature: 0.7,
        top_p: 0.9,
        top_k: 40,
      })
    })

    it('includes stop sequences', async () => {
      mock.onPost(`${ BASE }/messages`).reply(MESSAGE_RESPONSE)

      await service.sendMessages(
        undefined, messages, undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, ['STOP', 'END']
      )

      expect(mock.history[0].body).toMatchObject({
        stop_sequences: ['STOP', 'END'],
      })
    })

    it('includes tools and tool choice', async () => {
      mock.onPost(`${ BASE }/messages`).reply(MESSAGE_RESPONSE)
      const tools = [{ name: 'get_weather', description: 'Get weather', input_schema: {} }]
      const toolChoice = { type: 'auto' }

      await service.sendMessages(
        undefined, messages, undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, tools, toolChoice
      )

      expect(mock.history[0].body).toMatchObject({
        tools,
        tool_choice: toolChoice,
      })
    })

    it('throws when messages is empty', async () => {
      await expect(service.sendMessages(undefined, [])).rejects.toThrow(
        'Messages is required and must be a non-empty array'
      )
    })
  })

  describe('analyzeImage', () => {
    it('sends request with image URL', async () => {
      mock.onPost(`${ BASE }/messages`).reply(MESSAGE_RESPONSE)

      const result = await service.analyzeImage('Describe', undefined, 'https://example.com/img.png')

      expect(result).toMatchObject({ text: 'Hello there!' })
      expect(mock.history[0].body.messages[0].content).toEqual([
        { type: 'image', source: { type: 'url', url: 'https://example.com/img.png' } },
        { type: 'text', text: 'Describe' },
      ])
    })

    it('sends request with file ID and sets beta header', async () => {
      mock.onPost(`${ BASE }/messages`).reply(MESSAGE_RESPONSE)

      await service.analyzeImage('Describe', undefined, undefined, 'file_123')

      expect(mock.history[0].headers).toMatchObject({ 'anthropic-beta': FILES_API_BETA })
      expect(mock.history[0].body.messages[0].content[0]).toEqual({
        type: 'image',
        source: { type: 'file', file_id: 'file_123' },
      })
    })

    it('downloads file and sends as base64 when imageFile is provided', async () => {
      const fakeBuffer = Buffer.from('fake-image-bytes')

      mock.onGet('https://example.com/photo.jpg').reply(fakeBuffer)
      mock.onPost(`${ BASE }/messages`).reply(MESSAGE_RESPONSE)

      await service.analyzeImage('Describe', 'https://example.com/photo.jpg')

      expect(mock.history).toHaveLength(2)

      const imgSource = mock.history[1].body.messages[0].content[0].source

      expect(imgSource.type).toBe('base64')
      expect(imgSource.media_type).toBe('image/jpeg')
      expect(imgSource.data).toBe(fakeBuffer.toString('base64'))
    })

    it('throws when no image source is provided', async () => {
      await expect(service.analyzeImage('Describe')).rejects.toThrow(
        'Provide exactly one image source'
      )
    })

    it('throws when multiple image sources are provided', async () => {
      await expect(
        service.analyzeImage('Describe', undefined, 'https://example.com/img.png', 'file_123')
      ).rejects.toThrow('Provide exactly one image source')
    })

    it('throws when prompt is empty', async () => {
      await expect(service.analyzeImage('', undefined, 'https://example.com/img.png')).rejects.toThrow(
        'Prompt is required'
      )
    })
  })

  describe('analyzeDocument', () => {
    it('sends request with document URL', async () => {
      mock.onPost(`${ BASE }/messages`).reply(MESSAGE_RESPONSE)

      await service.analyzeDocument('Summarize', undefined, 'https://example.com/doc.pdf')

      const docBlock = mock.history[0].body.messages[0].content[0]

      expect(docBlock).toEqual({
        type: 'document',
        source: { type: 'url', url: 'https://example.com/doc.pdf' },
      })
    })

    it('sends request with file ID and sets beta header', async () => {
      mock.onPost(`${ BASE }/messages`).reply(MESSAGE_RESPONSE)

      await service.analyzeDocument('Summarize', undefined, undefined, 'file_456')

      expect(mock.history[0].headers).toMatchObject({ 'anthropic-beta': FILES_API_BETA })
    })

    it('enables citations when requested', async () => {
      mock.onPost(`${ BASE }/messages`).reply(MESSAGE_RESPONSE)

      await service.analyzeDocument('Summarize', undefined, 'https://example.com/doc.pdf', undefined, true)

      const docBlock = mock.history[0].body.messages[0].content[0]

      expect(docBlock.citations).toEqual({ enabled: true })
    })

    it('returns citations extracted from response', async () => {
      const responseWithCitations = {
        ...MESSAGE_RESPONSE,
        content: [{
          type: 'text',
          text: 'Revenue grew 18%',
          citations: [{ type: 'page_location', cited_text: 'revenue grew 18%' }],
        }],
      }

      mock.onPost(`${ BASE }/messages`).reply(responseWithCitations)

      const result = await service.analyzeDocument('Summarize', undefined, 'https://example.com/doc.pdf')

      expect(result.citations).toEqual([{ type: 'page_location', cited_text: 'revenue grew 18%' }])
    })

    it('downloads file and sends as base64 when documentFile is provided', async () => {
      const fakeBuffer = Buffer.from('fake-pdf-bytes')

      mock.onGet('https://example.com/report.pdf').reply(fakeBuffer)
      mock.onPost(`${ BASE }/messages`).reply(MESSAGE_RESPONSE)

      await service.analyzeDocument('Summarize', 'https://example.com/report.pdf')

      const docSource = mock.history[1].body.messages[0].content[0].source

      expect(docSource.type).toBe('base64')
      expect(docSource.media_type).toBe('application/pdf')
    })

    it('throws when no document source is provided', async () => {
      await expect(service.analyzeDocument('Summarize')).rejects.toThrow(
        'Provide exactly one document source'
      )
    })
  })

  describe('countTokens', () => {
    it('sends request with prompt', async () => {
      mock.onPost(`${ BASE }/messages/count_tokens`).reply({ input_tokens: 42 })

      const result = await service.countTokens(undefined, 'Hello world')

      expect(result).toEqual({ input_tokens: 42 })
      expect(mock.history[0].body).toEqual({
        model: 'claude-opus-4-8',
        messages: [{ role: 'user', content: 'Hello world' }],
      })
    })

    it('sends request with messages array', async () => {
      mock.onPost(`${ BASE }/messages/count_tokens`).reply({ input_tokens: 100 })
      const msgs = [{ role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Hey' }]

      await service.countTokens('claude-sonnet-4-6', undefined, msgs, 'Be brief')

      expect(mock.history[0].body).toEqual({
        model: 'claude-sonnet-4-6',
        messages: msgs,
        system: 'Be brief',
      })
    })

    it('includes tools in token count', async () => {
      mock.onPost(`${ BASE }/messages/count_tokens`).reply({ input_tokens: 200 })
      const tools = [{ name: 'get_weather', description: 'Get weather', input_schema: {} }]

      await service.countTokens(undefined, 'Hi', undefined, undefined, tools)

      expect(mock.history[0].body.tools).toEqual(tools)
    })

    it('throws when neither prompt nor messages is provided', async () => {
      await expect(service.countTokens()).rejects.toThrow('Either Prompt or Messages is required')
    })
  })

  // ── Message Batches ──

  describe('createBatch', () => {
    it('sends correct request', async () => {
      const requests = [{ custom_id: 'req-1', params: { model: 'claude-opus-4-8', max_tokens: 1024, messages: [] } }]
      const batchResponse = { id: 'msgbatch_01', processing_status: 'in_progress' }

      mock.onPost(`${ BASE }/messages/batches`).reply(batchResponse)

      const result = await service.createBatch(requests)

      expect(result).toEqual(batchResponse)
      expect(mock.history[0].body).toEqual({ requests })
    })

    it('throws when requests is empty', async () => {
      await expect(service.createBatch([])).rejects.toThrow(
        'Requests is required and must be a non-empty array'
      )
    })
  })

  describe('getBatch', () => {
    it('sends correct GET request', async () => {
      mock.onGet(`${ BASE }/messages/batches/msgbatch_01`).reply({ id: 'msgbatch_01', processing_status: 'ended' })

      const result = await service.getBatch('msgbatch_01')

      expect(result.processing_status).toBe('ended')
      expect(mock.history[0].headers).toMatchObject(COMMON_HEADERS)
    })

    it('throws when batchId is missing', async () => {
      await expect(service.getBatch()).rejects.toThrow('Batch ID is required')
    })
  })

  describe('listBatches', () => {
    it('sends GET request with pagination query', async () => {
      mock.onGet(`${ BASE }/messages/batches`).reply({ data: [], has_more: false })

      await service.listBatches(10, 'batch_after', 'batch_before')

      expect(mock.history[0].query).toMatchObject({
        limit: 10,
        after_id: 'batch_after',
        before_id: 'batch_before',
      })
    })

    it('omits optional query params when not provided', async () => {
      mock.onGet(`${ BASE }/messages/batches`).reply({ data: [], has_more: false })

      await service.listBatches()

      expect(mock.history[0].query).toEqual({})
    })
  })

  describe('cancelBatch', () => {
    it('sends POST to cancel endpoint', async () => {
      mock.onPost(`${ BASE }/messages/batches/msgbatch_01/cancel`).reply({ id: 'msgbatch_01', processing_status: 'canceling' })

      const result = await service.cancelBatch('msgbatch_01')

      expect(result.processing_status).toBe('canceling')
      expect(mock.history[0].body).toEqual({})
    })

    it('throws when batchId is missing', async () => {
      await expect(service.cancelBatch()).rejects.toThrow('Batch ID is required')
    })
  })

  describe('getBatchResults', () => {
    it('fetches batch then downloads and parses JSONL results', async () => {
      mock.onGet(`${ BASE }/messages/batches/msgbatch_01`).reply({
        id: 'msgbatch_01',
        processing_status: 'ended',
        request_counts: { processing: 0, succeeded: 1, errored: 0 },
        results_url: `${ BASE }/messages/batches/msgbatch_01/results`,
      })

      const jsonl = '{"custom_id":"req-1","result":{"type":"succeeded"}}\n{"custom_id":"req-2","result":{"type":"succeeded"}}'

      mock.onGet(`${ BASE }/messages/batches/msgbatch_01/results`).reply(Buffer.from(jsonl))

      const result = await service.getBatchResults('msgbatch_01')

      expect(result.processingStatus).toBe('ended')
      expect(result.results).toHaveLength(2)
      expect(result.results[0].custom_id).toBe('req-1')
    })

    it('throws when batch results are not available yet', async () => {
      mock.onGet(`${ BASE }/messages/batches/msgbatch_01`).reply({
        id: 'msgbatch_01',
        processing_status: 'in_progress',
        results_url: null,
      })

      await expect(service.getBatchResults('msgbatch_01')).rejects.toThrow(
        'Batch results are not available yet'
      )
    })
  })

  // ── Files ──

  describe('uploadFile', () => {
    it('downloads file and uploads via form data', async () => {
      const fileBuffer = Buffer.from('file-content')

      mock.onGet('https://example.com/report.pdf').reply(fileBuffer)
      mock.onPost(`${ BASE }/files`).reply({ id: 'file_01', type: 'file', filename: 'report.pdf' })

      const result = await service.uploadFile('https://example.com/report.pdf')

      expect(result.id).toBe('file_01')
      expect(mock.history).toHaveLength(2)
      expect(mock.history[1].headers).toMatchObject({ 'anthropic-beta': FILES_API_BETA })
      expect(mock.history[1].formData).toBeDefined()
    })

    it('uses provided filename and mimeType', async () => {
      const fileBuffer = Buffer.from('file-content')

      mock.onGet('https://example.com/data').reply(fileBuffer)
      mock.onPost(`${ BASE }/files`).reply({ id: 'file_02', type: 'file' })

      await service.uploadFile('https://example.com/data', 'custom.csv', 'text/csv')

      expect(mock.history[1].formData).toBeDefined()
    })
  })

  describe('listFiles', () => {
    it('sends GET request with beta header and pagination', async () => {
      mock.onGet(`${ BASE }/files`).reply({ data: [], has_more: false })

      await service.listFiles(5, 'file_after')

      expect(mock.history[0].headers).toMatchObject({ 'anthropic-beta': FILES_API_BETA })
      expect(mock.history[0].query).toMatchObject({ limit: 5, after_id: 'file_after' })
    })
  })

  describe('getFileMetadata', () => {
    it('sends GET request for specific file', async () => {
      mock.onGet(`${ BASE }/files/file_01`).reply({ id: 'file_01', filename: 'test.pdf' })

      const result = await service.getFileMetadata('file_01')

      expect(result.filename).toBe('test.pdf')
    })

    it('throws when fileId is missing', async () => {
      await expect(service.getFileMetadata()).rejects.toThrow('File ID is required')
    })
  })

  describe('deleteFile', () => {
    it('sends DELETE request', async () => {
      mock.onDelete(`${ BASE }/files/file_01`).reply({ id: 'file_01', type: 'file_deleted' })

      const result = await service.deleteFile('file_01')

      expect(result.type).toBe('file_deleted')
      expect(mock.history[0].headers).toMatchObject({ 'anthropic-beta': FILES_API_BETA })
    })

    it('throws when fileId is missing', async () => {
      await expect(service.deleteFile()).rejects.toThrow('File ID is required')
    })
  })

  // ── Models ──

  describe('listModels', () => {
    it('sends GET request with pagination', async () => {
      mock.onGet(`${ BASE }/models`).reply({ data: [{ id: 'claude-opus-4-8' }], has_more: false })

      const result = await service.listModels(10)

      expect(result.data).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({ limit: 10 })
    })
  })

  describe('getModel', () => {
    it('sends GET request for specific model', async () => {
      mock.onGet(`${ BASE }/models/claude-opus-4-8`).reply({ id: 'claude-opus-4-8', display_name: 'Claude Opus 4.8' })

      const result = await service.getModel('claude-opus-4-8')

      expect(result.display_name).toBe('Claude Opus 4.8')
    })

    it('throws when modelId is missing', async () => {
      await expect(service.getModel()).rejects.toThrow('Model is required')
    })
  })

  // ── Dictionaries ──

  describe('getModelsDictionary', () => {
    it('returns formatted model list', async () => {
      mock.onGet(`${ BASE }/models`).reply({
        data: [
          { id: 'claude-opus-4-8', display_name: 'Claude Opus 4.8' },
          { id: 'claude-sonnet-4-6', display_name: 'Claude Sonnet 4.6' },
        ],
        has_more: false,
      })

      const result = await service.getModelsDictionary({})

      expect(result.items).toEqual([
        { label: 'Claude Opus 4.8', value: 'claude-opus-4-8', note: 'claude-opus-4-8' },
        { label: 'Claude Sonnet 4.6', value: 'claude-sonnet-4-6', note: 'claude-sonnet-4-6' },
      ])
      expect(result.cursor).toBeNull()
    })

    it('filters models by search', async () => {
      mock.onGet(`${ BASE }/models`).reply({
        data: [
          { id: 'claude-opus-4-8', display_name: 'Claude Opus 4.8' },
          { id: 'claude-sonnet-4-6', display_name: 'Claude Sonnet 4.6' },
        ],
        has_more: false,
      })

      const result = await service.getModelsDictionary({ search: 'opus' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('claude-opus-4-8')
    })

    it('returns cursor when has_more is true', async () => {
      mock.onGet(`${ BASE }/models`).reply({
        data: [{ id: 'claude-opus-4-8', display_name: 'Claude Opus 4.8' }],
        has_more: true,
        last_id: 'claude-opus-4-8',
      })

      const result = await service.getModelsDictionary({ cursor: 'some-cursor' })

      expect(result.cursor).toBe('claude-opus-4-8')
      expect(mock.history[0].query).toMatchObject({ after_id: 'some-cursor' })
    })
  })

  describe('getAgentsDictionary', () => {
    it('returns formatted agent list', async () => {
      mock.onGet(`${ BASE }/agents`).reply({
        data: [{ id: 'agent_01', name: 'Research Agent', model: 'claude-opus-4-8' }],
        has_more: false,
      })

      const result = await service.getAgentsDictionary({})

      expect(result.items).toEqual([
        { label: 'Research Agent', value: 'agent_01', note: 'claude-opus-4-8' },
      ])
      expect(mock.history[0].headers).toMatchObject({ 'anthropic-beta': MANAGED_AGENTS_BETA })
    })

    it('filters agents by search', async () => {
      mock.onGet(`${ BASE }/agents`).reply({
        data: [
          { id: 'agent_01', name: 'Research Agent', model: 'claude-opus-4-8' },
          { id: 'agent_02', name: 'Code Agent', model: 'claude-opus-4-8' },
        ],
        has_more: false,
      })

      const result = await service.getAgentsDictionary({ search: 'code' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toBe('Code Agent')
    })
  })

  describe('getEnvironmentsDictionary', () => {
    it('returns formatted environment list', async () => {
      mock.onGet(`${ BASE }/environments`).reply({
        data: [{ id: 'env_01', name: 'default-cloud', config: { type: 'cloud' } }],
        has_more: false,
      })

      const result = await service.getEnvironmentsDictionary({})

      expect(result.items).toEqual([
        { label: 'default-cloud', value: 'env_01', note: 'cloud' },
      ])
    })
  })

  describe('getSessionsDictionary', () => {
    it('returns formatted session list', async () => {
      mock.onGet(`${ BASE }/sessions`).reply({
        data: [{ id: 'sesn_01', title: 'My Session', status: 'idle' }],
        has_more: false,
      })

      const result = await service.getSessionsDictionary({})

      expect(result.items).toEqual([
        { label: 'My Session', value: 'sesn_01', note: 'idle' },
      ])
    })

    it('filters sessions by search', async () => {
      mock.onGet(`${ BASE }/sessions`).reply({
        data: [
          { id: 'sesn_01', title: 'Report Session', status: 'idle' },
          { id: 'sesn_02', title: 'Code Session', status: 'running' },
        ],
        has_more: false,
      })

      const result = await service.getSessionsDictionary({ search: 'report' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toBe('Report Session')
    })
  })

  // ── Agents ──

  describe('createAgent', () => {
    it('sends correct request with required params', async () => {
      const agentResponse = { id: 'agent_01', type: 'agent', name: 'Test Agent', model: 'claude-opus-4-8' }

      mock.onPost(`${ BASE }/agents`).reply(agentResponse)

      const result = await service.createAgent('Test Agent', 'claude-opus-4-8')

      expect(result).toEqual(agentResponse)
      expect(mock.history[0].headers).toMatchObject({ 'anthropic-beta': MANAGED_AGENTS_BETA })
      expect(mock.history[0].body).toEqual({
        name: 'Test Agent',
        model: 'claude-opus-4-8',
        tools: [{ type: 'agent_toolset_20260401' }],
      })
    })

    it('includes optional params', async () => {
      mock.onPost(`${ BASE }/agents`).reply({ id: 'agent_01' })

      await service.createAgent(
        'Agent', 'claude-opus-4-8', 'Be helpful', 'A test agent',
        true, [{ type: 'custom', name: 'my_tool' }],
        [{ type: 'url', name: 'github', url: 'https://github.com/mcp' }],
        { env: 'test' }
      )

      expect(mock.history[0].body).toMatchObject({
        system: 'Be helpful',
        description: 'A test agent',
        tools: [{ type: 'agent_toolset_20260401' }, { type: 'custom', name: 'my_tool' }],
        mcp_servers: [{ type: 'url', name: 'github', url: 'https://github.com/mcp' }],
        metadata: { env: 'test' },
      })
    })

    it('excludes agent toolset when disabled', async () => {
      mock.onPost(`${ BASE }/agents`).reply({ id: 'agent_01' })

      await service.createAgent('Agent', 'claude-opus-4-8', undefined, undefined, false)

      expect(mock.history[0].body.tools).toBeUndefined()
    })

    it('throws when name is empty', async () => {
      await expect(service.createAgent('')).rejects.toThrow('Name is required')
    })
  })

  describe('getAgent', () => {
    it('sends GET request', async () => {
      mock.onGet(`${ BASE }/agents/agent_01`).reply({ id: 'agent_01', name: 'Test' })

      const result = await service.getAgent('agent_01')

      expect(result.name).toBe('Test')
    })

    it('throws when agentId is missing', async () => {
      await expect(service.getAgent()).rejects.toThrow('Agent ID is required')
    })
  })

  describe('listAgents', () => {
    it('sends GET request with pagination', async () => {
      mock.onGet(`${ BASE }/agents`).reply({ data: [], has_more: false })

      await service.listAgents(5, 'agent_after')

      expect(mock.history[0].query).toMatchObject({ limit: 5, after_id: 'agent_after' })
    })
  })

  describe('updateAgent', () => {
    it('sends POST request with full body', async () => {
      mock.onPost(`${ BASE }/agents/agent_01`).reply({ id: 'agent_01', version: 2 })

      await service.updateAgent('agent_01', 'Updated Agent', 'claude-sonnet-4-6')

      expect(mock.history[0].body).toMatchObject({
        name: 'Updated Agent',
        model: 'claude-sonnet-4-6',
      })
    })

    it('throws when agentId is missing', async () => {
      await expect(service.updateAgent(undefined, 'Name')).rejects.toThrow('Agent ID is required')
    })
  })

  describe('archiveAgent', () => {
    it('sends POST to archive endpoint', async () => {
      mock.onPost(`${ BASE }/agents/agent_01/archive`).reply({ id: 'agent_01', archived_at: '2026-01-01' })

      const result = await service.archiveAgent('agent_01')

      expect(result.archived_at).toBeDefined()
      expect(mock.history[0].body).toEqual({})
    })

    it('throws when agentId is missing', async () => {
      await expect(service.archiveAgent()).rejects.toThrow('Agent ID is required')
    })
  })

  describe('listAgentVersions', () => {
    it('sends GET request for agent versions', async () => {
      mock.onGet(`${ BASE }/agents/agent_01/versions`).reply({ data: [], has_more: false })

      await service.listAgentVersions('agent_01', 10)

      expect(mock.history[0].query).toMatchObject({ limit: 10 })
    })

    it('throws when agentId is missing', async () => {
      await expect(service.listAgentVersions()).rejects.toThrow('Agent ID is required')
    })
  })

  // ── Environments ──

  describe('createEnvironment', () => {
    it('sends correct request with unrestricted networking', async () => {
      mock.onPost(`${ BASE }/environments`).reply({ id: 'env_01', type: 'environment' })

      const result = await service.createEnvironment('test-env')

      expect(result.id).toBe('env_01')
      expect(mock.history[0].body).toEqual({
        name: 'test-env',
        config: { type: 'cloud', networking: { type: 'unrestricted' } },
      })
    })

    it('sends correct request with limited networking', async () => {
      mock.onPost(`${ BASE }/environments`).reply({ id: 'env_01' })

      await service.createEnvironment('test-env', 'My env', 'Limited', ['api.example.com'], true, true)

      expect(mock.history[0].body).toEqual({
        name: 'test-env',
        description: 'My env',
        config: {
          type: 'cloud',
          networking: {
            type: 'limited',
            allowed_hosts: ['api.example.com'],
            allow_package_managers: true,
            allow_mcp_servers: true,
          },
        },
      })
    })

    it('throws when name is empty', async () => {
      await expect(service.createEnvironment('')).rejects.toThrow('Name is required')
    })
  })

  describe('listEnvironments', () => {
    it('sends GET request', async () => {
      mock.onGet(`${ BASE }/environments`).reply({ data: [], has_more: false })

      await service.listEnvironments(5)

      expect(mock.history[0].query).toMatchObject({ limit: 5 })
    })
  })

  describe('getEnvironment', () => {
    it('sends GET request for specific environment', async () => {
      mock.onGet(`${ BASE }/environments/env_01`).reply({ id: 'env_01', name: 'test' })

      const result = await service.getEnvironment('env_01')

      expect(result.name).toBe('test')
    })

    it('throws when environmentId is missing', async () => {
      await expect(service.getEnvironment()).rejects.toThrow('Environment ID is required')
    })
  })

  describe('deleteEnvironment', () => {
    it('sends DELETE request and returns deletion confirmation', async () => {
      mock.onDelete(`${ BASE }/environments/env_01`).reply({})

      const result = await service.deleteEnvironment('env_01')

      expect(result).toEqual({ id: 'env_01', deleted: true })
    })

    it('throws when environmentId is missing', async () => {
      await expect(service.deleteEnvironment()).rejects.toThrow('Environment ID is required')
    })
  })

  // ── Sessions ──

  describe('createSession', () => {
    it('sends correct request with required params', async () => {
      mock.onPost(`${ BASE }/sessions`).reply({ id: 'sesn_01', status: 'idle' })

      const result = await service.createSession('agent_01', undefined, 'env_01')

      expect(result.id).toBe('sesn_01')
      expect(mock.history[0].body).toEqual({
        agent: 'agent_01',
        environment_id: 'env_01',
      })
    })

    it('includes agent version when provided', async () => {
      mock.onPost(`${ BASE }/sessions`).reply({ id: 'sesn_01' })

      await service.createSession('agent_01', 12345, 'env_01')

      expect(mock.history[0].body.agent).toEqual({
        type: 'agent',
        id: 'agent_01',
        version: 12345,
      })
    })

    it('includes optional params', async () => {
      mock.onPost(`${ BASE }/sessions`).reply({ id: 'sesn_01' })

      await service.createSession(
        'agent_01', undefined, 'env_01', 'My Session',
        [{ type: 'file', file_id: 'file_01' }],
        ['vlt_01'],
        { project: 'test' }
      )

      expect(mock.history[0].body).toMatchObject({
        title: 'My Session',
        resources: [{ type: 'file', file_id: 'file_01' }],
        vault_ids: ['vlt_01'],
        metadata: { project: 'test' },
      })
    })

    it('throws when agentId is missing', async () => {
      await expect(service.createSession(undefined, undefined, 'env_01')).rejects.toThrow(
        'Agent ID is required'
      )
    })

    it('throws when environmentId is missing', async () => {
      await expect(service.createSession('agent_01')).rejects.toThrow(
        'Environment ID is required'
      )
    })
  })

  describe('getSession', () => {
    it('sends GET request', async () => {
      mock.onGet(`${ BASE }/sessions/sesn_01`).reply({ id: 'sesn_01', status: 'idle' })

      const result = await service.getSession('sesn_01')

      expect(result.status).toBe('idle')
    })

    it('throws when sessionId is missing', async () => {
      await expect(service.getSession()).rejects.toThrow('Session ID is required')
    })
  })

  describe('listSessions', () => {
    it('sends GET request with pagination', async () => {
      mock.onGet(`${ BASE }/sessions`).reply({ data: [], has_more: false })

      await service.listSessions(10, 'sesn_after')

      expect(mock.history[0].query).toMatchObject({ limit: 10, after_id: 'sesn_after' })
    })
  })

  describe('archiveSession', () => {
    it('sends POST to archive endpoint', async () => {
      mock.onPost(`${ BASE }/sessions/sesn_01/archive`).reply({ id: 'sesn_01', archived_at: '2026-01-01' })

      const result = await service.archiveSession('sesn_01')

      expect(result.archived_at).toBeDefined()
    })

    it('throws when sessionId is missing', async () => {
      await expect(service.archiveSession()).rejects.toThrow('Session ID is required')
    })
  })

  describe('deleteSession', () => {
    it('sends DELETE request and returns deletion confirmation', async () => {
      mock.onDelete(`${ BASE }/sessions/sesn_01`).reply({})

      const result = await service.deleteSession('sesn_01')

      expect(result).toEqual({ id: 'sesn_01', deleted: true })
    })

    it('throws when sessionId is missing', async () => {
      await expect(service.deleteSession()).rejects.toThrow('Session ID is required')
    })
  })

  describe('getSessionResult', () => {
    it('fetches session and events, extracts result text', async () => {
      mock.onGet(`${ BASE }/sessions/sesn_01`).reply({
        id: 'sesn_01',
        title: 'Test',
        status: 'idle',
        usage: { input_tokens: 100, output_tokens: 50 },
      })

      mock.onGet(`${ BASE }/sessions/sesn_01/events`).reply({
        data: [
          { type: 'user.message', content: [{ type: 'text', text: 'Do something' }] },
          { type: 'agent.message', content: [{ type: 'text', text: 'Done!' }] },
          { type: 'session.status_idle', stop_reason: { type: 'end_turn' } },
        ],
        has_more: false,
      })

      const result = await service.getSessionResult('sesn_01')

      expect(result).toEqual({
        sessionId: 'sesn_01',
        title: 'Test',
        status: 'idle',
        resultText: 'Done!',
        lastStopReason: 'end_turn',
        usage: { input_tokens: 100, output_tokens: 50 },
      })
    })

    it('throws when sessionId is missing', async () => {
      await expect(service.getSessionResult()).rejects.toThrow('Session ID is required')
    })
  })

  describe('listSessionOutputFiles', () => {
    it('sends GET request with scope_id', async () => {
      mock.onGet(`${ BASE }/files`).reply({ data: [], has_more: false })

      await service.listSessionOutputFiles('sesn_01', 10)

      expect(mock.history[0].query).toMatchObject({ scope_id: 'sesn_01', limit: 10 })
      expect(mock.history[0].headers).toMatchObject({ 'anthropic-beta': SESSION_FILES_BETA })
    })

    it('throws when sessionId is missing', async () => {
      await expect(service.listSessionOutputFiles()).rejects.toThrow('Session ID is required')
    })
  })

  // ── Session Events ──

  describe('sendMessageToSession', () => {
    it('sends user message event', async () => {
      mock.onPost(`${ BASE }/sessions/sesn_01/events`).reply({
        events: [{ id: 'sevt_01', type: 'user.message' }],
      })

      const result = await service.sendMessageToSession('sesn_01', 'Hello agent')

      expect(result.events[0].type).toBe('user.message')
      expect(mock.history[0].body).toEqual({
        events: [{ type: 'user.message', content: [{ type: 'text', text: 'Hello agent' }] }],
      })
      expect(mock.history[0].headers).toMatchObject({ 'anthropic-beta': MANAGED_AGENTS_BETA })
    })

    it('throws when message is empty', async () => {
      await expect(service.sendMessageToSession('sesn_01', '')).rejects.toThrow('Message is required')
    })

    it('throws when sessionId is missing', async () => {
      await expect(service.sendMessageToSession(undefined, 'Hi')).rejects.toThrow('Session ID is required')
    })
  })

  describe('sendCustomToolResult', () => {
    it('sends custom tool result event', async () => {
      mock.onPost(`${ BASE }/sessions/sesn_01/events`).reply({
        events: [{ id: 'sevt_02', type: 'user.custom_tool_result' }],
      })

      await service.sendCustomToolResult('sesn_01', 'sevt_01', 'result data', true)

      expect(mock.history[0].body).toEqual({
        events: [{
          type: 'user.custom_tool_result',
          custom_tool_use_id: 'sevt_01',
          content: [{ type: 'text', text: 'result data' }],
          is_error: true,
        }],
      })
    })

    it('throws when customToolUseId is missing', async () => {
      await expect(service.sendCustomToolResult('sesn_01', '', 'result')).rejects.toThrow(
        'Custom Tool Use ID is required'
      )
    })

    it('throws when resultText is empty', async () => {
      await expect(service.sendCustomToolResult('sesn_01', 'sevt_01', '')).rejects.toThrow(
        'Result Text is required'
      )
    })
  })

  describe('sendToolConfirmation', () => {
    it('sends allow confirmation', async () => {
      mock.onPost(`${ BASE }/sessions/sesn_01/events`).reply({
        events: [{ id: 'sevt_02', type: 'user.tool_confirmation' }],
      })

      await service.sendToolConfirmation('sesn_01', 'sevt_01', 'Allow')

      expect(mock.history[0].body).toEqual({
        events: [{
          type: 'user.tool_confirmation',
          tool_use_id: 'sevt_01',
          result: 'allow',
        }],
      })
    })

    it('sends deny confirmation with message', async () => {
      mock.onPost(`${ BASE }/sessions/sesn_01/events`).reply({
        events: [{ id: 'sevt_02' }],
      })

      await service.sendToolConfirmation('sesn_01', 'sevt_01', 'Deny', 'Not allowed')

      expect(mock.history[0].body).toEqual({
        events: [{
          type: 'user.tool_confirmation',
          tool_use_id: 'sevt_01',
          result: 'deny',
          deny_message: 'Not allowed',
        }],
      })
    })

    it('throws when toolUseId is missing', async () => {
      await expect(service.sendToolConfirmation('sesn_01', '', 'Allow')).rejects.toThrow(
        'Tool Use ID is required'
      )
    })

    it('throws when result is invalid', async () => {
      await expect(service.sendToolConfirmation('sesn_01', 'sevt_01', 'Maybe')).rejects.toThrow(
        "Result must be 'Allow' or 'Deny'"
      )
    })
  })

  describe('interruptSession', () => {
    it('sends interrupt event', async () => {
      mock.onPost(`${ BASE }/sessions/sesn_01/events`).reply({
        events: [{ id: 'sevt_01', type: 'user.interrupt' }],
      })

      const result = await service.interruptSession('sesn_01')

      expect(result.events[0].type).toBe('user.interrupt')
      expect(mock.history[0].body).toEqual({
        events: [{ type: 'user.interrupt' }],
      })
    })

    it('throws when sessionId is missing', async () => {
      await expect(service.interruptSession()).rejects.toThrow('Session ID is required')
    })
  })

  describe('defineOutcome', () => {
    it('sends outcome with rubric text', async () => {
      mock.onPost(`${ BASE }/sessions/sesn_01/events`).reply({
        events: [{ id: 'sevt_01', type: 'user.define_outcome' }],
      })

      await service.defineOutcome('sesn_01', 'Build a report', 'Must have charts', undefined, 5)

      expect(mock.history[0].body).toEqual({
        events: [{
          type: 'user.define_outcome',
          description: 'Build a report',
          rubric: { type: 'text', content: 'Must have charts' },
          max_iterations: 5,
        }],
      })
    })

    it('sends outcome with rubric file ID', async () => {
      mock.onPost(`${ BASE }/sessions/sesn_01/events`).reply({
        events: [{ id: 'sevt_01' }],
      })

      await service.defineOutcome('sesn_01', 'Build a report', undefined, 'file_rubric')

      expect(mock.history[0].body.events[0].rubric).toEqual({
        type: 'file',
        file_id: 'file_rubric',
      })
    })

    it('throws when description is empty', async () => {
      await expect(service.defineOutcome('sesn_01', '', 'rubric')).rejects.toThrow(
        'Description is required'
      )
    })

    it('throws when no rubric source is provided', async () => {
      await expect(service.defineOutcome('sesn_01', 'Do something')).rejects.toThrow(
        'Provide exactly one rubric source'
      )
    })

    it('throws when both rubric sources are provided', async () => {
      await expect(
        service.defineOutcome('sesn_01', 'Do something', 'text rubric', 'file_rubric')
      ).rejects.toThrow('Provide exactly one rubric source')
    })
  })

  describe('getSessionEvents', () => {
    it('sends GET request with pagination', async () => {
      mock.onGet(`${ BASE }/sessions/sesn_01/events`).reply({
        data: [{ id: 'sevt_01', type: 'agent.message' }],
        has_more: false,
      })

      const result = await service.getSessionEvents('sesn_01', 100, 2)

      expect(result.data).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({ limit: 100, page: 2 })
    })

    it('filters events by type when eventType is provided', async () => {
      mock.onGet(`${ BASE }/sessions/sesn_01/events`).reply({
        data: [
          { id: 'sevt_01', type: 'agent.message' },
          { id: 'sevt_02', type: 'session.status_idle' },
          { id: 'sevt_03', type: 'agent.message' },
        ],
        has_more: false,
      })

      const result = await service.getSessionEvents('sesn_01', undefined, undefined, 'Agent Message')

      expect(result.data).toHaveLength(2)
      expect(result.data.every(e => e.type === 'agent.message')).toBe(true)
    })

    it('throws when sessionId is missing', async () => {
      await expect(service.getSessionEvents()).rejects.toThrow('Session ID is required')
    })
  })

  // ── Trigger ──

  describe('onSessionIdle (polling trigger)', () => {
    it('records initial state on first poll without emitting events', async () => {
      mock.onGet(`${ BASE }/sessions`).reply({
        data: [
          { id: 'sesn_01', title: 'Test', status: 'idle', created_at: '2026-01-01', updated_at: '2026-01-01' },
        ],
      })

      const result = await service.onSessionIdle({ triggerData: {}, state: {} })

      expect(result.events).toEqual([])
      expect(result.state.statuses).toEqual({ sesn_01: 'idle' })
    })

    it('emits event when session transitions from running to idle', async () => {
      mock.onGet(`${ BASE }/sessions`).reply({
        data: [
          { id: 'sesn_01', title: 'Test', status: 'idle', created_at: '2026-01-01', updated_at: '2026-01-02' },
        ],
      })

      const result = await service.onSessionIdle({
        triggerData: {},
        state: { statuses: { sesn_01: 'running' } },
      })

      expect(result.events).toHaveLength(1)
      expect(result.events[0]).toMatchObject({
        sessionId: 'sesn_01',
        title: 'Test',
        status: 'idle',
      })
    })

    it('does not emit event when session was already idle', async () => {
      mock.onGet(`${ BASE }/sessions`).reply({
        data: [
          { id: 'sesn_01', title: 'Test', status: 'idle', created_at: '2026-01-01', updated_at: '2026-01-01' },
        ],
      })

      const result = await service.onSessionIdle({
        triggerData: {},
        state: { statuses: { sesn_01: 'idle' } },
      })

      expect(result.events).toEqual([])
    })

    it('emits event for new session that appeared already idle', async () => {
      mock.onGet(`${ BASE }/sessions`).reply({
        data: [
          { id: 'sesn_02', title: 'New', status: 'idle', created_at: '2026-01-01', updated_at: '2026-01-01' },
        ],
      })

      const result = await service.onSessionIdle({
        triggerData: {},
        state: { statuses: { sesn_01: 'idle' } },
      })

      expect(result.events).toHaveLength(1)
      expect(result.events[0].sessionId).toBe('sesn_02')
    })

    it('filters sessions by titleContains', async () => {
      mock.onGet(`${ BASE }/sessions`).reply({
        data: [
          { id: 'sesn_01', title: 'Report Session', status: 'idle', created_at: '2026-01-01', updated_at: '2026-01-01' },
          { id: 'sesn_02', title: 'Code Session', status: 'idle', created_at: '2026-01-01', updated_at: '2026-01-01' },
        ],
      })

      const result = await service.onSessionIdle({
        triggerData: { titleContains: 'Report' },
        state: { statuses: {} },
      })

      // First poll with existing state but sesn_01 not previously tracked => emits
      expect(result.events).toHaveLength(1)
      expect(result.events[0].sessionId).toBe('sesn_01')
    })

    it('emits for terminated sessions', async () => {
      mock.onGet(`${ BASE }/sessions`).reply({
        data: [
          { id: 'sesn_01', title: 'Test', status: 'terminated', created_at: '2026-01-01', updated_at: '2026-01-02' },
        ],
      })

      const result = await service.onSessionIdle({
        triggerData: {},
        state: { statuses: { sesn_01: 'running' } },
      })

      expect(result.events).toHaveLength(1)
      expect(result.events[0].status).toBe('terminated')
    })
  })

  describe('handleTriggerPollingForEvent', () => {
    it('dispatches to the correct trigger method', async () => {
      mock.onGet(`${ BASE }/sessions`).reply({ data: [] })

      const result = await service.handleTriggerPollingForEvent({
        eventName: 'onSessionIdle',
        triggerData: {},
        state: {},
      })

      expect(result).toHaveProperty('events')
      expect(result).toHaveProperty('state')
    })
  })
})
