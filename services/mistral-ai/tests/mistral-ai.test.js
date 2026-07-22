'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-api-key'
const BASE = 'https://api.mistral.ai/v1'
const AUTH_HEADER = `Bearer ${ API_KEY }`

// ── Helpers ──

const chatResponse = ({
  content = 'Hello!',
  model = 'mistral-medium-latest',
  finishReason = 'stop',
} = {}) => ({
  id: 'chatcmpl-abc',
  object: 'chat.completion',
  model,
  choices: [
    {
      index: 0,
      message: { role: 'assistant', content },
      finish_reason: finishReason,
    },
  ],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
})

const modelsResponse = {
  object: 'list',
  data: [
    { id: 'mistral-medium-latest', object: 'model', description: 'Frontier multimodal model' },
    { id: 'codestral-latest', object: 'model', description: 'Code generation model' },
    { id: 'mistral-embed', object: 'model', description: 'Embedding model' },
  ],
}

describe('Mistral AI Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ apiKey: API_KEY })
    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()

    // The framework injects flowrunner.Files at runtime; mock it for unit tests.
    service.flowrunner = {
      Files: {
        uploadFile: jest.fn().mockResolvedValue({ url: 'https://files.example.com/test-file' }),
      },
    }
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

    it('sends Bearer auth and JSON content-type on POST requests', async () => {
      mock.onPost(`${ BASE }/chat/completions`).reply(chatResponse())

      await service.askAI('Hi')

      expect(mock.history[0].headers).toMatchObject({
        'Authorization': AUTH_HEADER,
        'Content-Type': 'application/json',
      })
    })

    it('sends Bearer auth without content-type on GET requests', async () => {
      mock.onGet(`${ BASE }/models`).reply(modelsResponse)

      await service.listModels()

      expect(mock.history[0].headers).toMatchObject({ 'Authorization': AUTH_HEADER })
      expect(mock.history[0].headers).not.toHaveProperty('Content-Type')
    })
  })

  // ── Ask AI ──

  describe('askAI', () => {
    it('sends correct request with required params only and shapes response', async () => {
      mock.onPost(`${ BASE }/chat/completions`).reply(chatResponse({ content: 'Answer' }))

      const result = await service.askAI('What is FlowRunner?')

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/chat/completions`)
      expect(mock.history[0].body).toEqual({
        model: 'mistral-medium-latest',
        messages: [{ role: 'user', content: 'What is FlowRunner?' }],
      })
      expect(result).toEqual({
        text: 'Answer',
        model: 'mistral-medium-latest',
        finishReason: 'stop',
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      })
    })

    it('includes system prompt and all optional params', async () => {
      mock.onPost(`${ BASE }/chat/completions`).reply(chatResponse())

      await service.askAI(
        'Return JSON',
        'mistral-small-latest',
        'You are helpful',
        0.5,
        0.9,
        1024,
        'JSON Object',
        ['STOP'],
        true,
        42
      )

      expect(mock.history[0].body).toEqual({
        model: 'mistral-small-latest',
        messages: [
          { role: 'system', content: 'You are helpful' },
          { role: 'user', content: 'Return JSON' },
        ],
        temperature: 0.5,
        top_p: 0.9,
        max_tokens: 1024,
        response_format: { type: 'json_object' },
        stop: ['STOP'],
        safe_prompt: true,
        random_seed: 42,
      })
    })

    it('omits response_format when format is Text', async () => {
      mock.onPost(`${ BASE }/chat/completions`).reply(chatResponse())

      await service.askAI('Hi', undefined, undefined, undefined, undefined, undefined, 'Text')

      expect(mock.history[0].body).not.toHaveProperty('response_format')
    })

    it('includes temperature 0 (falsy but valid)', async () => {
      mock.onPost(`${ BASE }/chat/completions`).reply(chatResponse())

      await service.askAI('Hi', undefined, undefined, 0, 0)

      expect(mock.history[0].body.temperature).toBe(0)
      expect(mock.history[0].body.top_p).toBe(0)
    })

    it('omits stop when empty array', async () => {
      mock.onPost(`${ BASE }/chat/completions`).reply(chatResponse())

      await service.askAI('Hi', undefined, undefined, undefined, undefined, undefined, undefined, [])

      expect(mock.history[0].body).not.toHaveProperty('stop')
    })

    it('defaults empty text when choices are missing', async () => {
      mock.onPost(`${ BASE }/chat/completions`).reply({ model: 'mistral-medium-latest', choices: [] })

      const result = await service.askAI('Hi')

      expect(result.text).toBe('')
      expect(result.finishReason).toBeUndefined()
    })

    it('throws when prompt is empty', async () => {
      await expect(service.askAI('   ')).rejects.toThrow('Prompt is required')
      expect(mock.history).toHaveLength(0)
    })

    it('throws when prompt is missing', async () => {
      await expect(service.askAI()).rejects.toThrow('Prompt is required')
    })

    it('throws a normalized error on API failure', async () => {
      mock.onPost(`${ BASE }/chat/completions`).replyWithError({
        message: 'Request failed',
        body: { message: 'Unauthorized' },
      })

      await expect(service.askAI('Hi')).rejects.toThrow('Unauthorized')
    })
  })

  // ── Create Chat Completion ──

  describe('createChatCompletion', () => {
    const messages = [
      { role: 'System', content: 'You are helpful' },
      { role: 'User', content: 'Hi' },
    ]

    it('sends correct request with required params and resolves roles', async () => {
      const raw = chatResponse()
      mock.onPost(`${ BASE }/chat/completions`).reply(raw)

      const result = await service.createChatCompletion(messages)

      expect(mock.history[0].body).toEqual({
        model: 'mistral-medium-latest',
        messages: [
          { role: 'system', content: 'You are helpful' },
          { role: 'user', content: 'Hi' },
        ],
      })
      expect(result).toEqual(raw)
    })

    it('includes all optional params including penalties', async () => {
      mock.onPost(`${ BASE }/chat/completions`).reply(chatResponse())

      await service.createChatCompletion(
        messages,
        'mistral-small-latest',
        0.5,
        0.9,
        1024,
        'JSON Object',
        undefined,
        ['END'],
        true,
        42,
        0.5,
        0.3
      )

      expect(mock.history[0].body).toMatchObject({
        model: 'mistral-small-latest',
        temperature: 0.5,
        top_p: 0.9,
        max_tokens: 1024,
        response_format: { type: 'json_object' },
        stop: ['END'],
        safe_prompt: true,
        random_seed: 42,
        presence_penalty: 0.5,
        frequency_penalty: 0.3,
      })
    })

    it('builds json_schema response format with strict schema', async () => {
      mock.onPost(`${ BASE }/chat/completions`).reply(chatResponse())

      const schema = { type: 'object', properties: { ok: { type: 'boolean' } } }

      await service.createChatCompletion(
        messages,
        undefined,
        undefined,
        undefined,
        undefined,
        'JSON Schema',
        schema
      )

      expect(mock.history[0].body.response_format).toEqual({
        type: 'json_schema',
        json_schema: { name: 'response', schema, strict: true },
      })
    })

    it('throws when JSON Schema format is selected but no schema provided', async () => {
      await expect(
        service.createChatCompletion(messages, undefined, undefined, undefined, undefined, 'JSON Schema')
      ).rejects.toThrow('JSON Schema parameter is required')
    })

    it('throws when messages array is empty', async () => {
      await expect(service.createChatCompletion([])).rejects.toThrow('At least one message is required')
      expect(mock.history).toHaveLength(0)
    })

    it('throws a normalized error on API failure', async () => {
      mock.onPost(`${ BASE }/chat/completions`).replyWithError({
        message: 'Request failed',
        body: { error: { message: 'Model Not Found' } },
      })

      await expect(service.createChatCompletion(messages)).rejects.toThrow('Model Not Found')
    })
  })

  // ── Analyze Image ──

  describe('analyzeImage', () => {
    it('sends correct multimodal request', async () => {
      mock.onPost(`${ BASE }/chat/completions`).reply(chatResponse({ content: 'A cat' }))

      const result = await service.analyzeImage(
        'What is this?',
        ['https://example.com/cat.jpg'],
        'mistral-medium-latest',
        0.3,
        512
      )

      expect(mock.history[0].body).toEqual({
        model: 'mistral-medium-latest',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: 'What is this?' },
            { type: 'image_url', image_url: 'https://example.com/cat.jpg' },
          ],
        }],
        temperature: 0.3,
        max_tokens: 512,
      })
      expect(result.text).toBe('A cat')
    })

    it('sends multiple images', async () => {
      mock.onPost(`${ BASE }/chat/completions`).reply(chatResponse())

      await service.analyzeImage('Compare', ['https://a.com/1.jpg', 'https://b.com/2.jpg'])

      const content = mock.history[0].body.messages[0].content

      expect(content).toHaveLength(3) // text + 2 images
      expect(content[1]).toEqual({ type: 'image_url', image_url: 'https://a.com/1.jpg' })
      expect(content[2]).toEqual({ type: 'image_url', image_url: 'https://b.com/2.jpg' })
    })

    it('throws when prompt is empty', async () => {
      await expect(service.analyzeImage('  ', ['https://x.com/img.jpg'])).rejects.toThrow('Prompt is required')
    })

    it('throws when imageUrls is empty', async () => {
      await expect(service.analyzeImage('Describe', [])).rejects.toThrow('At least one image URL is required')
    })
  })

  // ── OCR Document ──

  describe('ocrDocument', () => {
    const ocrResponse = {
      model: 'mistral-ocr-latest',
      pages: [{ index: 0, markdown: '# Invoice' }],
      usage_info: { pages_processed: 1 },
    }

    it('sends document_url source type by default', async () => {
      mock.onPost(`${ BASE }/ocr`).reply(ocrResponse)

      await service.ocrDocument('Document URL', 'https://example.com/doc.pdf')

      expect(mock.history[0].body).toEqual({
        model: 'mistral-ocr-latest',
        document: { type: 'document_url', document_url: 'https://example.com/doc.pdf' },
      })
    })

    it('sends image_url source type', async () => {
      mock.onPost(`${ BASE }/ocr`).reply(ocrResponse)

      await service.ocrDocument('Image URL', 'https://example.com/page.png')

      expect(mock.history[0].body.document).toEqual({
        type: 'image_url',
        image_url: 'https://example.com/page.png',
      })
    })

    it('sends file source type', async () => {
      mock.onPost(`${ BASE }/ocr`).reply(ocrResponse)

      await service.ocrDocument('Uploaded File', 'file_abc123')

      expect(mock.history[0].body.document).toEqual({
        type: 'file',
        file_id: 'file_abc123',
      })
    })

    it('includes pages, includeImageBase64, includeBlocks, and tableFormat', async () => {
      mock.onPost(`${ BASE }/ocr`).reply(ocrResponse)

      await service.ocrDocument(
        'Document URL',
        'https://example.com/doc.pdf',
        'mistral-ocr-latest',
        '0,2-4',
        true,
        true,
        'HTML'
      )

      expect(mock.history[0].body).toMatchObject({
        pages: [0, 2, 3, 4],
        include_image_base64: true,
        include_blocks: true,
        table_format: 'html',
      })
    })

    it('throws when source is empty', async () => {
      await expect(service.ocrDocument('Document URL', '  ')).rejects.toThrow('Document source is required')
    })
  })

  // ── Embeddings ──

  describe('createEmbeddings', () => {
    const embeddingResponse = {
      id: 'embd-abc',
      object: 'list',
      model: 'mistral-embed',
      data: [{ object: 'embedding', index: 0, embedding: [0.1, 0.2] }],
      usage: { prompt_tokens: 5, total_tokens: 5 },
    }

    it('sends correct request with required params', async () => {
      mock.onPost(`${ BASE }/embeddings`).reply(embeddingResponse)

      const result = await service.createEmbeddings(['Hello world'])

      expect(mock.history[0].body).toEqual({
        model: 'mistral-embed',
        input: ['Hello world'],
      })
      expect(result).toEqual(embeddingResponse)
    })

    it('includes outputDimension and outputDtype', async () => {
      mock.onPost(`${ BASE }/embeddings`).reply(embeddingResponse)

      await service.createEmbeddings(['Hello'], 'codestral-embed', 256, 'Int8')

      expect(mock.history[0].body).toMatchObject({
        model: 'codestral-embed',
        output_dimension: 256,
        output_dtype: 'int8',
      })
    })

    it('throws when inputs is empty', async () => {
      await expect(service.createEmbeddings([])).rejects.toThrow('At least one input text is required')
    })
  })

  // ── FIM Completion ──

  describe('fimCompletion', () => {
    const fimResponse = chatResponse({ content: '  return a + b;', model: 'codestral-latest' })

    it('sends correct request with required params and shapes response', async () => {
      mock.onPost(`${ BASE }/fim/completions`).reply(fimResponse)

      const result = await service.fimCompletion('def add(a, b):')

      expect(mock.history[0].url).toBe(`${ BASE }/fim/completions`)
      expect(mock.history[0].body).toEqual({
        model: 'codestral-latest',
        prompt: 'def add(a, b):',
      })
      expect(result.text).toBe('  return a + b;')
      expect(result.model).toBe('codestral-latest')
    })

    it('includes all optional params', async () => {
      mock.onPost(`${ BASE }/fim/completions`).reply(fimResponse)

      await service.fimCompletion(
        'def add(a, b):',
        '\nresult = add(1, 2)',
        'codestral-latest',
        128,
        16,
        0.3,
        0.95,
        ['\n\n'],
        42
      )

      expect(mock.history[0].body).toEqual({
        model: 'codestral-latest',
        prompt: 'def add(a, b):',
        suffix: '\nresult = add(1, 2)',
        max_tokens: 128,
        min_tokens: 16,
        temperature: 0.3,
        top_p: 0.95,
        stop: ['\n\n'],
        random_seed: 42,
      })
    })

    it('omits suffix when empty string', async () => {
      mock.onPost(`${ BASE }/fim/completions`).reply(fimResponse)

      await service.fimCompletion('x', '')

      expect(mock.history[0].body).not.toHaveProperty('suffix')
    })

    it('throws when prompt is missing', async () => {
      await expect(service.fimCompletion()).rejects.toThrow('Prompt is required')
    })
  })

  // ── Moderate Text ──

  describe('moderateText', () => {
    const modResponse = {
      id: 'mod-abc',
      model: 'mistral-moderation-latest',
      results: [{ categories: { sexual: false, violence_and_threats: true } }],
    }

    it('sends correct request', async () => {
      mock.onPost(`${ BASE }/moderations`).reply(modResponse)

      const result = await service.moderateText(['Some text'])

      expect(mock.history[0].body).toEqual({
        model: 'mistral-moderation-latest',
        input: ['Some text'],
      })
      expect(result).toEqual(modResponse)
    })

    it('throws when inputs is empty', async () => {
      await expect(service.moderateText([])).rejects.toThrow('At least one input text is required')
    })
  })

  // ── Moderate Conversation ──

  describe('moderateConversation', () => {
    it('sends resolved messages', async () => {
      mock.onPost(`${ BASE }/chat/moderations`).reply({ id: 'mod-abc', results: [] })

      await service.moderateConversation([
        { role: 'User', content: 'Hello' },
        { role: 'Assistant', content: 'Hi there' },
      ])

      expect(mock.history[0].body.input).toEqual([
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
      ])
    })

    it('throws when messages is empty', async () => {
      await expect(service.moderateConversation([])).rejects.toThrow('At least one message is required')
    })
  })

  // ── Transcribe Audio ──

  describe('transcribeAudio', () => {
    const transcriptionResponse = {
      text: 'Hello world',
      language: 'en',
      model: 'voxtral-mini-latest',
    }

    it('sends form data with fileUrl', async () => {
      mock.onPost(`${ BASE }/audio/transcriptions`).reply(transcriptionResponse)

      const result = await service.transcribeAudio('https://example.com/audio.mp3')

      expect(mock.history[0].formData).toBeDefined()
      expect(result).toEqual(transcriptionResponse)
    })

    it('sends form data with fileId instead of fileUrl', async () => {
      mock.onPost(`${ BASE }/audio/transcriptions`).reply(transcriptionResponse)

      await service.transcribeAudio(undefined, 'file_123')

      expect(mock.history[0].formData).toBeDefined()
    })

    it('throws when neither fileUrl nor fileId provided', async () => {
      await expect(service.transcribeAudio()).rejects.toThrow('Either an Audio File URL or a File ID is required')
    })
  })

  // ── Text to Speech ──

  describe('textToSpeech', () => {
    it('sends correct request body', async () => {
      // TTS returns base64 audio data
      mock.onPost(`${ BASE }/audio/speech`).reply({
        audio_data: Buffer.from('fake-audio').toString('base64'),
      })

      const result = await service.textToSpeech('Hello world', 'voxtral-tts-latest', 'voice_123', 'WAV')

      expect(mock.history[0].body).toEqual({
        model: 'voxtral-tts-latest',
        input: 'Hello world',
        response_format: 'wav',
        voice_id: 'voice_123',
      })
      expect(result).toHaveProperty('fileURL')
    })

    it('uses default format mp3 when not specified', async () => {
      mock.onPost(`${ BASE }/audio/speech`).reply({
        audio_data: Buffer.from('fake-audio').toString('base64'),
      })

      await service.textToSpeech('Hello')

      expect(mock.history[0].body.response_format).toBe('mp3')
      expect(mock.history[0].body).not.toHaveProperty('voice_id')
    })

    it('throws when input is empty', async () => {
      await expect(service.textToSpeech('  ')).rejects.toThrow('Input text is required')
    })
  })

  // ── Files ──

  describe('listFiles', () => {
    const filesResponse = {
      object: 'list',
      data: [{ id: 'file_abc', filename: 'doc.pdf', bytes: 1024, purpose: 'ocr' }],
      total: 1,
    }

    it('sends correct GET request with defaults', async () => {
      mock.onGet(`${ BASE }/files`).reply(filesResponse)

      const result = await service.listFiles()

      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].query).toMatchObject({ page: 0, page_size: 100 })
      expect(result).toEqual(filesResponse)
    })

    it('includes search and purpose params', async () => {
      mock.onGet(`${ BASE }/files`).reply(filesResponse)

      await service.listFiles(1, 10, 'invoice', 'OCR')

      expect(mock.history[0].query).toMatchObject({
        page: 1,
        page_size: 10,
        search: 'invoice',
        purpose: 'ocr',
      })
    })
  })

  describe('getFile', () => {
    it('sends correct GET request', async () => {
      mock.onGet(`${ BASE }/files/file_abc`).reply({ id: 'file_abc', filename: 'doc.pdf' })

      const result = await service.getFile('file_abc')

      expect(mock.history[0].url).toBe(`${ BASE }/files/file_abc`)
      expect(result).toHaveProperty('id', 'file_abc')
    })

    it('throws when fileId is missing', async () => {
      await expect(service.getFile()).rejects.toThrow('File ID is required')
    })
  })

  describe('deleteFile', () => {
    it('sends correct DELETE request', async () => {
      mock.onDelete(`${ BASE }/files/file_abc`).reply({ id: 'file_abc', deleted: true })

      const result = await service.deleteFile('file_abc')

      expect(mock.history[0].method).toBe('delete')
      expect(result.deleted).toBe(true)
    })

    it('throws when fileId is missing', async () => {
      await expect(service.deleteFile()).rejects.toThrow('File ID is required')
    })
  })

  describe('getFileSignedUrl', () => {
    it('sends correct GET request with default expiry', async () => {
      mock.onGet(`${ BASE }/files/file_abc/url`).reply({ url: 'https://signed.url' })

      await service.getFileSignedUrl('file_abc')

      expect(mock.history[0].query).toMatchObject({ expiry: 24 })
    })

    it('uses custom expiry', async () => {
      mock.onGet(`${ BASE }/files/file_abc/url`).reply({ url: 'https://signed.url' })

      await service.getFileSignedUrl('file_abc', 48)

      expect(mock.history[0].query).toMatchObject({ expiry: 48 })
    })

    it('throws when fileId is missing', async () => {
      await expect(service.getFileSignedUrl()).rejects.toThrow('File ID is required')
    })
  })

  describe('downloadFile', () => {
    it('downloads file content and saves to storage', async () => {
      mock.onGet(`${ BASE }/files/file_abc`).reply({ id: 'file_abc', filename: 'result.jsonl' })
      mock.onGet(`${ BASE }/files/file_abc/content`).reply(Buffer.from('file content'))

      const result = await service.downloadFile('file_abc')

      expect(mock.history).toHaveLength(2)
      expect(result).toHaveProperty('fileURL')
      expect(result.filename).toBe('result.jsonl')
    })

    it('throws when fileId is missing', async () => {
      await expect(service.downloadFile()).rejects.toThrow('File ID is required')
    })
  })

  // ── Batch Jobs ──

  describe('createBatchJob', () => {
    const batchResponse = {
      id: 'batch_abc',
      object: 'batch',
      status: 'QUEUED',
      endpoint: '/v1/chat/completions',
      model: 'mistral-medium-latest',
    }

    it('sends correct request with required params', async () => {
      mock.onPost(`${ BASE }/batch/jobs`).reply(batchResponse)

      await service.createBatchJob(['file_1'], 'Chat Completions', 'mistral-medium-latest')

      expect(mock.history[0].body).toEqual({
        input_files: ['file_1'],
        endpoint: '/v1/chat/completions',
        model: 'mistral-medium-latest',
      })
    })

    it('includes timeoutHours and metadata', async () => {
      mock.onPost(`${ BASE }/batch/jobs`).reply(batchResponse)

      await service.createBatchJob(
        ['file_1'],
        'Embeddings',
        'mistral-embed',
        12,
        { job_type: 'nightly' }
      )

      expect(mock.history[0].body).toMatchObject({
        endpoint: '/v1/embeddings',
        timeout_hours: 12,
        metadata: { job_type: 'nightly' },
      })
    })

    it('resolves all endpoint choices', async () => {
      const endpoints = {
        'Chat Completions': '/v1/chat/completions',
        'Embeddings': '/v1/embeddings',
        'FIM Completions': '/v1/fim/completions',
        'Moderations': '/v1/moderations',
        'Chat Moderations': '/v1/chat/moderations',
        'OCR': '/v1/ocr',
      }

      for (const [label, expected] of Object.entries(endpoints)) {
        mock.onPost(`${ BASE }/batch/jobs`).reply(batchResponse)

        await service.createBatchJob(['file_1'], label, 'mistral-medium-latest')

        expect(mock.history[mock.history.length - 1].body.endpoint).toBe(expected)
      }
    })

    it('throws when inputFiles is empty', async () => {
      await expect(service.createBatchJob([], 'Chat Completions', 'model')).rejects.toThrow(
        'At least one input file ID is required'
      )
    })

    it('throws when model is missing', async () => {
      await expect(service.createBatchJob(['file_1'], 'Chat Completions')).rejects.toThrow(
        'Model is required'
      )
    })
  })

  describe('listBatchJobs', () => {
    it('sends correct GET request with defaults', async () => {
      mock.onGet(`${ BASE }/batch/jobs`).reply({ object: 'list', data: [] })

      await service.listBatchJobs()

      expect(mock.history[0].query).toMatchObject({ page: 0, page_size: 100 })
    })

    it('includes status and createdByMe filters', async () => {
      mock.onGet(`${ BASE }/batch/jobs`).reply({ object: 'list', data: [] })

      await service.listBatchJobs(1, 10, 'Running', true)

      expect(mock.history[0].query).toMatchObject({
        page: 1,
        page_size: 10,
        status: 'RUNNING',
        created_by_me: true,
      })
    })
  })

  describe('getBatchJob', () => {
    it('sends correct GET request', async () => {
      mock.onGet(`${ BASE }/batch/jobs/batch_abc`).reply({ id: 'batch_abc', status: 'SUCCESS' })

      const result = await service.getBatchJob('batch_abc')

      expect(result.status).toBe('SUCCESS')
    })

    it('throws when jobId is missing', async () => {
      await expect(service.getBatchJob()).rejects.toThrow('Job ID is required')
    })
  })

  describe('cancelBatchJob', () => {
    it('sends correct POST request', async () => {
      mock.onPost(`${ BASE }/batch/jobs/batch_abc/cancel`).reply({ id: 'batch_abc', status: 'CANCELLATION_REQUESTED' })

      const result = await service.cancelBatchJob('batch_abc')

      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({})
      expect(result.status).toBe('CANCELLATION_REQUESTED')
    })

    it('throws when jobId is missing', async () => {
      await expect(service.cancelBatchJob()).rejects.toThrow('Job ID is required')
    })
  })

  // ── Agents ──

  describe('createAgent', () => {
    const agentResponse = {
      id: 'ag_abc',
      object: 'agent',
      name: 'Test Agent',
      model: 'mistral-medium-latest',
    }

    it('sends correct request with required params', async () => {
      mock.onPost(`${ BASE }/agents`).reply(agentResponse)

      await service.createAgent('Test Agent', 'mistral-medium-latest')

      expect(mock.history[0].body).toEqual({
        name: 'Test Agent',
        model: 'mistral-medium-latest',
      })
    })

    it('includes instructions, description, tools, and completion args', async () => {
      mock.onPost(`${ BASE }/agents`).reply(agentResponse)

      await service.createAgent(
        'Test Agent',
        'mistral-medium-latest',
        'Be helpful',
        'A test agent',
        true,
        true,
        true,
        ['lib_abc'],
        0.5,
        1024
      )

      expect(mock.history[0].body).toEqual({
        name: 'Test Agent',
        model: 'mistral-medium-latest',
        instructions: 'Be helpful',
        description: 'A test agent',
        tools: [
          { type: 'web_search' },
          { type: 'code_interpreter' },
          { type: 'image_generation' },
          { type: 'document_library', library_ids: ['lib_abc'] },
        ],
        completion_args: { temperature: 0.5, max_tokens: 1024 },
      })
    })

    it('omits tools and completion_args when not provided', async () => {
      mock.onPost(`${ BASE }/agents`).reply(agentResponse)

      await service.createAgent('Test', 'mistral-medium-latest')

      expect(mock.history[0].body).not.toHaveProperty('tools')
      expect(mock.history[0].body).not.toHaveProperty('completion_args')
    })

    it('throws when name or model is missing', async () => {
      await expect(service.createAgent()).rejects.toThrow('Name and Model are required')
      await expect(service.createAgent('Test')).rejects.toThrow('Name and Model are required')
    })
  })

  describe('updateAgent', () => {
    it('sends correct PATCH request', async () => {
      mock.onPatch(`${ BASE }/agents/ag_abc`).reply({ id: 'ag_abc', name: 'Updated' })

      await service.updateAgent('ag_abc', 'Updated', undefined, 'New instructions')

      expect(mock.history[0].method).toBe('patch')
      expect(mock.history[0].body).toEqual({ name: 'Updated', instructions: 'New instructions' })
    })

    it('throws when agentId is missing', async () => {
      await expect(service.updateAgent()).rejects.toThrow('Agent ID is required')
    })

    it('throws when no fields to update', async () => {
      await expect(service.updateAgent('ag_abc')).rejects.toThrow('At least one field to update is required')
    })
  })

  describe('listAgents', () => {
    it('sends correct GET request with defaults', async () => {
      mock.onGet(`${ BASE }/agents`).reply([])

      await service.listAgents()

      expect(mock.history[0].query).toMatchObject({ page: 0, page_size: 20 })
    })
  })

  describe('getAgent', () => {
    it('sends correct GET request', async () => {
      mock.onGet(`${ BASE }/agents/ag_abc`).reply({ id: 'ag_abc', name: 'Test Agent' })

      const result = await service.getAgent('ag_abc')

      expect(result.name).toBe('Test Agent')
    })

    it('throws when agentId is missing', async () => {
      await expect(service.getAgent()).rejects.toThrow('Agent ID is required')
    })
  })

  describe('deleteAgent', () => {
    it('sends correct DELETE request', async () => {
      mock.onDelete(`${ BASE }/agents/ag_abc`).reply({ id: 'ag_abc', deleted: true })

      const result = await service.deleteAgent('ag_abc')

      expect(mock.history[0].method).toBe('delete')
      expect(result.deleted).toBe(true)
    })

    it('throws when agentId is missing', async () => {
      await expect(service.deleteAgent()).rejects.toThrow('Agent ID is required')
    })
  })

  // ── Conversations ──

  describe('startConversation', () => {
    const convResponse = {
      conversation_id: 'conv_abc',
      outputs: [{ type: 'message.output', role: 'assistant', content: 'Hello!' }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }

    it('sends correct request with model and shapes response', async () => {
      mock.onPost(`${ BASE }/conversations`).reply(convResponse)

      const result = await service.startConversation('Hi', undefined, 'mistral-medium-latest')

      expect(mock.history[0].body).toEqual({
        inputs: 'Hi',
        model: 'mistral-medium-latest',
      })
      expect(result).toEqual({
        conversationId: 'conv_abc',
        text: 'Hello!',
        outputs: convResponse.outputs,
        usage: convResponse.usage,
      })
    })

    it('sends request with agentId', async () => {
      mock.onPost(`${ BASE }/conversations`).reply(convResponse)

      await service.startConversation('Hi', 'ag_abc')

      expect(mock.history[0].body).toEqual({
        inputs: 'Hi',
        agent_id: 'ag_abc',
      })
    })

    it('includes all optional fields with model', async () => {
      mock.onPost(`${ BASE }/conversations`).reply(convResponse)

      await service.startConversation(
        'Hi',
        undefined,
        'mistral-medium-latest',
        'Be helpful',
        'Test Conv',
        'A test conversation',
        false,
        0.5,
        1024
      )

      expect(mock.history[0].body).toEqual({
        inputs: 'Hi',
        model: 'mistral-medium-latest',
        instructions: 'Be helpful',
        name: 'Test Conv',
        description: 'A test conversation',
        store: false,
        completion_args: { temperature: 0.5, max_tokens: 1024 },
      })
    })

    it('throws when input is empty', async () => {
      await expect(service.startConversation('  ')).rejects.toThrow('Input is required')
    })

    it('throws when neither agent nor model is provided', async () => {
      await expect(service.startConversation('Hi')).rejects.toThrow('Either an Agent or a Model is required')
    })

    it('throws when both agent and model are provided', async () => {
      await expect(service.startConversation('Hi', 'ag_abc', 'mistral-medium-latest')).rejects.toThrow(
        'Provide either an Agent or a Model, not both'
      )
    })

    it('extracts text from complex content arrays', async () => {
      mock.onPost(`${ BASE }/conversations`).reply({
        conversation_id: 'conv_abc',
        outputs: [
          { type: 'tool.execution', content: 'tool ran' },
          { type: 'message.output', role: 'assistant', content: [{ text: 'Part 1' }, { text: ' Part 2' }] },
        ],
        usage: null,
      })

      const result = await service.startConversation('Hi', undefined, 'mistral-medium-latest')

      expect(result.text).toBe('Part 1 Part 2')
    })
  })

  describe('appendToConversation', () => {
    it('sends correct POST request and shapes response', async () => {
      mock.onPost(`${ BASE }/conversations/conv_abc`).reply({
        conversation_id: 'conv_abc',
        outputs: [{ type: 'message.output', role: 'assistant', content: 'Follow-up' }],
        usage: { total_tokens: 20 },
      })

      const result = await service.appendToConversation('conv_abc', 'Tell me more')

      expect(mock.history[0].body).toEqual({ inputs: 'Tell me more' })
      expect(result.conversationId).toBe('conv_abc')
      expect(result.text).toBe('Follow-up')
    })

    it('throws when conversationId is missing', async () => {
      await expect(service.appendToConversation()).rejects.toThrow('Conversation ID is required')
    })

    it('throws when input is empty', async () => {
      await expect(service.appendToConversation('conv_abc', '  ')).rejects.toThrow('Input is required')
    })
  })

  describe('getConversation', () => {
    it('sends correct GET request', async () => {
      mock.onGet(`${ BASE }/conversations/conv_abc`).reply({ id: 'conv_abc' })

      await service.getConversation('conv_abc')

      expect(mock.history[0].url).toBe(`${ BASE }/conversations/conv_abc`)
    })

    it('throws when conversationId is missing', async () => {
      await expect(service.getConversation()).rejects.toThrow('Conversation ID is required')
    })
  })

  describe('listConversations', () => {
    it('sends correct GET request with defaults', async () => {
      mock.onGet(`${ BASE }/conversations`).reply([])

      await service.listConversations()

      expect(mock.history[0].query).toMatchObject({ page: 0, page_size: 20 })
    })

    it('uses custom pagination', async () => {
      mock.onGet(`${ BASE }/conversations`).reply([])

      await service.listConversations(2, 50)

      expect(mock.history[0].query).toMatchObject({ page: 2, page_size: 50 })
    })
  })

  describe('getConversationHistory', () => {
    it('sends correct GET request', async () => {
      mock.onGet(`${ BASE }/conversations/conv_abc/history`).reply({
        object: 'conversation.history',
        entries: [],
      })

      await service.getConversationHistory('conv_abc')

      expect(mock.history[0].url).toBe(`${ BASE }/conversations/conv_abc/history`)
    })

    it('throws when conversationId is missing', async () => {
      await expect(service.getConversationHistory()).rejects.toThrow('Conversation ID is required')
    })
  })

  describe('getConversationMessages', () => {
    it('sends correct GET request', async () => {
      mock.onGet(`${ BASE }/conversations/conv_abc/messages`).reply({
        object: 'conversation.messages',
        messages: [],
      })

      await service.getConversationMessages('conv_abc')

      expect(mock.history[0].url).toBe(`${ BASE }/conversations/conv_abc/messages`)
    })

    it('throws when conversationId is missing', async () => {
      await expect(service.getConversationMessages()).rejects.toThrow('Conversation ID is required')
    })
  })

  // ── Libraries ──

  describe('createLibrary', () => {
    it('sends correct request with required params', async () => {
      mock.onPost(`${ BASE }/libraries`).reply({ id: 'lib_abc', name: 'Docs' })

      await service.createLibrary('Docs')

      expect(mock.history[0].body).toEqual({ name: 'Docs' })
    })

    it('includes description and chunkSize', async () => {
      mock.onPost(`${ BASE }/libraries`).reply({ id: 'lib_abc' })

      await service.createLibrary('Docs', 'Product manuals', 4096)

      expect(mock.history[0].body).toEqual({
        name: 'Docs',
        description: 'Product manuals',
        chunk_size: 4096,
      })
    })

    it('throws when name is empty', async () => {
      await expect(service.createLibrary('  ')).rejects.toThrow('Library name is required')
    })
  })

  describe('listLibraries', () => {
    it('sends correct GET request', async () => {
      mock.onGet(`${ BASE }/libraries`).reply({ data: [] })

      await service.listLibraries()

      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/libraries`)
    })
  })

  describe('listLibraryDocuments', () => {
    it('sends correct GET request with defaults', async () => {
      mock.onGet(`${ BASE }/libraries/lib_abc/documents`).reply({ data: [] })

      await service.listLibraryDocuments('lib_abc')

      expect(mock.history[0].query).toMatchObject({ page: 0, page_size: 100 })
    })

    it('includes search param', async () => {
      mock.onGet(`${ BASE }/libraries/lib_abc/documents`).reply({ data: [] })

      await service.listLibraryDocuments('lib_abc', 0, 10, 'manual')

      expect(mock.history[0].query).toMatchObject({ search: 'manual' })
    })

    it('throws when libraryId is missing', async () => {
      await expect(service.listLibraryDocuments()).rejects.toThrow('Library ID is required')
    })
  })

  // ── Models ──

  describe('listModels', () => {
    it('returns the raw models list from GET /models', async () => {
      mock.onGet(`${ BASE }/models`).reply(modelsResponse)

      const result = await service.listModels()

      expect(mock.history[0].method).toBe('get')
      expect(result).toEqual(modelsResponse)
    })

    it('throws a normalized error on API failure', async () => {
      mock.onGet(`${ BASE }/models`).replyWithError({
        message: 'Request failed',
        body: { message: 'Authentication Fails' },
      })

      await expect(service.listModels()).rejects.toThrow('Authentication Fails')
    })
  })

  describe('getModel', () => {
    it('sends correct GET request', async () => {
      mock.onGet(`${ BASE }/models/mistral-medium-latest`).reply({
        id: 'mistral-medium-latest',
        object: 'model',
      })

      const result = await service.getModel('mistral-medium-latest')

      expect(result.id).toBe('mistral-medium-latest')
    })

    it('throws when modelId is missing', async () => {
      await expect(service.getModel()).rejects.toThrow('Model ID is required')
    })
  })

  // ── Dictionaries ──

  describe('getModelsDictionary', () => {
    it('lists models sorted with note from description', async () => {
      mock.onGet(`${ BASE }/models`).reply(modelsResponse)

      const result = await service.getModelsDictionary({})

      expect(result.items).toEqual([
        { label: 'codestral-latest', value: 'codestral-latest', note: 'Code generation model' },
        { label: 'mistral-embed', value: 'mistral-embed', note: 'Embedding model' },
        { label: 'mistral-medium-latest', value: 'mistral-medium-latest', note: 'Frontier multimodal model' },
      ])
      expect(result.cursor).toBeNull()
    })

    it('filters models by search term', async () => {
      mock.onGet(`${ BASE }/models`).reply(modelsResponse)

      const result = await service.getModelsDictionary({ search: 'codestral' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('codestral-latest')
    })

    it('handles null payload', async () => {
      mock.onGet(`${ BASE }/models`).reply(modelsResponse)

      const result = await service.getModelsDictionary(null)

      expect(result.items).toHaveLength(3)
    })

    it('returns empty items when data is missing', async () => {
      mock.onGet(`${ BASE }/models`).reply({ object: 'list' })

      const result = await service.getModelsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('falls back to model id for note when description is absent', async () => {
      mock.onGet(`${ BASE }/models`).reply({ data: [{ id: 'model-x' }] })

      const result = await service.getModelsDictionary({})

      expect(result.items).toEqual([{ label: 'model-x', value: 'model-x', note: 'model-x' }])
    })
  })

  describe('getAgentsDictionary', () => {
    const agentsResponse = {
      data: [
        { id: 'ag_1', name: 'Support Bot', model: 'mistral-medium-latest' },
        { id: 'ag_2', name: 'Sales Bot', description: 'Handles sales' },
      ],
    }

    it('lists agents with note preferring model', async () => {
      mock.onGet(`${ BASE }/agents`).reply(agentsResponse)

      const result = await service.getAgentsDictionary({})

      expect(result.items).toEqual([
        { label: 'Support Bot', value: 'ag_1', note: 'mistral-medium-latest' },
        { label: 'Sales Bot', value: 'ag_2', note: 'Handles sales' },
      ])
      expect(mock.history[0].query).toMatchObject({ page: 0, page_size: 100 })
    })

    it('filters agents by search', async () => {
      mock.onGet(`${ BASE }/agents`).reply(agentsResponse)

      const result = await service.getAgentsDictionary({ search: 'support' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('ag_1')
    })

    it('handles array response format', async () => {
      mock.onGet(`${ BASE }/agents`).reply([{ id: 'ag_1', name: 'Bot' }])

      const result = await service.getAgentsDictionary({})

      expect(result.items).toHaveLength(1)
    })
  })

  describe('getVoicesDictionary', () => {
    it('lists voices', async () => {
      mock.onGet(`${ BASE }/audio/voices`).reply({
        items: [{ id: 'voice_1', name: 'Aria' }],
      })

      const result = await service.getVoicesDictionary({})

      expect(result.items).toEqual([
        { label: 'Aria', value: 'voice_1', note: 'Aria' },
      ])
      expect(mock.history[0].query).toMatchObject({ limit: 100 })
    })

    it('filters voices by search', async () => {
      mock.onGet(`${ BASE }/audio/voices`).reply({
        items: [
          { id: 'voice_1', name: 'Aria' },
          { id: 'voice_2', name: 'Bella' },
        ],
      })

      const result = await service.getVoicesDictionary({ search: 'aria' })

      expect(result.items).toHaveLength(1)
    })
  })

  describe('getFilesDictionary', () => {
    it('lists files with purpose and bytes in note', async () => {
      mock.onGet(`${ BASE }/files`).reply({
        data: [{ id: 'file_1', filename: 'doc.pdf', purpose: 'ocr', bytes: 1024 }],
      })

      const result = await service.getFilesDictionary({})

      expect(result.items).toEqual([
        { label: 'doc.pdf', value: 'file_1', note: 'ocr, 1024 bytes' },
      ])
    })

    it('filters files by search', async () => {
      mock.onGet(`${ BASE }/files`).reply({
        data: [
          { id: 'file_1', filename: 'doc.pdf', purpose: 'ocr', bytes: 100 },
          { id: 'file_2', filename: 'data.jsonl', purpose: 'batch', bytes: 200 },
        ],
      })

      const result = await service.getFilesDictionary({ search: 'data' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('file_2')
    })
  })

  describe('getLibrariesDictionary', () => {
    it('lists libraries with document count in note', async () => {
      mock.onGet(`${ BASE }/libraries`).reply({
        data: [{ id: 'lib_1', name: 'Product Docs', nb_documents: 12 }],
      })

      const result = await service.getLibrariesDictionary({})

      expect(result.items).toEqual([
        { label: 'Product Docs', value: 'lib_1', note: '12 documents' },
      ])
    })

    it('handles array response format', async () => {
      mock.onGet(`${ BASE }/libraries`).reply([{ id: 'lib_1', name: 'Docs' }])

      const result = await service.getLibrariesDictionary({})

      expect(result.items).toHaveLength(1)
    })

    it('falls back to description when nb_documents is absent', async () => {
      mock.onGet(`${ BASE }/libraries`).reply({
        data: [{ id: 'lib_1', name: 'Docs', description: 'Product manuals' }],
      })

      const result = await service.getLibrariesDictionary({})

      expect(result.items[0].note).toBe('Product manuals')
    })
  })

  // ── Error normalization ──

  describe('error normalization', () => {
    it('normalizes error from body.message', async () => {
      mock.onGet(`${ BASE }/models`).replyWithError({
        message: 'Request failed',
        body: { message: 'Unauthorized' },
      })

      await expect(service.listModels()).rejects.toThrow('Unauthorized')
    })

    it('normalizes error from body.detail', async () => {
      mock.onGet(`${ BASE }/models`).replyWithError({
        message: 'Request failed',
        body: { detail: 'Not Found' },
      })

      await expect(service.listModels()).rejects.toThrow('Not Found')
    })

    it('normalizes error from body.error.message', async () => {
      mock.onGet(`${ BASE }/models`).replyWithError({
        message: 'Request failed',
        body: { error: { message: 'Rate limit exceeded' } },
      })

      await expect(service.listModels()).rejects.toThrow('Rate limit exceeded')
    })

    it('stringifies non-string detail', async () => {
      mock.onGet(`${ BASE }/models`).replyWithError({
        message: 'Request failed',
        body: { detail: [{ msg: 'Invalid param' }] },
      })

      await expect(service.listModels()).rejects.toThrow('[{"msg":"Invalid param"}]')
    })

    it('falls back to error.message when body has no detail', async () => {
      mock.onGet(`${ BASE }/models`).replyWithError({ message: 'Network Error' })

      await expect(service.listModels()).rejects.toThrow('Network Error')
    })
  })
})
