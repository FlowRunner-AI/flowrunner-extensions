'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-gemini-key'
const BASE = 'https://generativelanguage.googleapis.com/v1beta'
const UPLOAD_BASE = 'https://generativelanguage.googleapis.com/upload/v1beta'
const DOWNLOAD_BASE = 'https://generativelanguage.googleapis.com/download/v1beta'

describe('Gemini AI Service', () => {
  let sandbox
  let service
  let mock
  let uploadFileMock

  beforeAll(() => {
    sandbox = createSandbox({ apiKey: API_KEY })
    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()
  })

  beforeEach(() => {
    // The Files API is injected by the FlowRunner runtime at execution time and is
    // referenced as `this.flowrunner.Files.*` by the service. Stub it here.
    uploadFileMock = jest.fn().mockResolvedValue({ url: 'https://files.flowrunner.com/flow/generated.bin' })
    service.flowrunner = {
      Files: {
        uploadFile: uploadFileMock,
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
          type: 'STRING',
          required: true,
          shared: false,
        }),
      ])
    })

    it('does not include the service name in the config displayName', () => {
      const item = sandbox.getConfigItems()[0]

      expect(item.displayName).toBe('API Key')
    })
  })

  // ── Auth ──

  describe('authentication', () => {
    it('sends the API key via the x-goog-api-key header', async () => {
      mock.onGet(`${ BASE }/models`).reply({ models: [] })

      await service.listModels()

      expect(mock.history[0].headers).toMatchObject({ 'x-goog-api-key': API_KEY })
    })

    it('does not put the API key in the query string', async () => {
      mock.onGet(`${ BASE }/models`).reply({ models: [] })

      await service.listModels()

      expect(mock.history[0].query).not.toHaveProperty('key')
    })
  })

  // ── Dictionaries ──

  describe('dictionary methods', () => {
    const modelsResponse = {
      models: [
        {
          name: 'models/gemini-2.5-flash',
          displayName: 'Gemini 2.5 Flash',
          supportedGenerationMethods: ['generateContent', 'countTokens'],
        },
        {
          name: 'models/gemini-embedding-001',
          displayName: 'Gemini Embedding 001',
          supportedGenerationMethods: ['embedContent'],
        },
        {
          name: 'models/gemini-2.5-flash-image',
          displayName: 'Gemini 2.5 Flash Image',
          supportedGenerationMethods: ['predict'],
        },
        {
          name: 'models/gemini-2.5-flash-preview-tts',
          displayName: 'Gemini 2.5 Flash Preview TTS',
          supportedGenerationMethods: ['predict'],
        },
        {
          name: 'models/veo-3.1-generate-preview',
          displayName: 'Veo 3.1',
          supportedGenerationMethods: ['predictLongRunning'],
        },
      ],
      nextPageToken: 'next-token',
    }

    describe('getModelsDictionary', () => {
      it('requests models with a page size and maps generateContent models', async () => {
        mock.onGet(`${ BASE }/models`).reply(modelsResponse)

        const result = await service.getModelsDictionary({})

        expect(mock.history[0].method).toBe('get')
        expect(mock.history[0].query).toMatchObject({ pageSize: 100 })
        expect(result.items).toEqual([
          {
            label: 'Gemini 2.5 Flash',
            value: 'models/gemini-2.5-flash',
            note: 'models/gemini-2.5-flash',
          },
        ])
        expect(result.cursor).toBe('next-token')
      })

      it('filters items by search string', async () => {
        mock.onGet(`${ BASE }/models`).reply(modelsResponse)

        const result = await service.getModelsDictionary({ search: 'flash' })

        expect(result.items).toHaveLength(1)
        expect(result.items[0].value).toBe('models/gemini-2.5-flash')
      })

      it('returns no items when search does not match', async () => {
        mock.onGet(`${ BASE }/models`).reply(modelsResponse)

        const result = await service.getModelsDictionary({ search: 'no-such-model' })

        expect(result.items).toHaveLength(0)
      })

      it('passes the cursor through as pageToken', async () => {
        mock.onGet(`${ BASE }/models`).reply({ models: [] })

        await service.getModelsDictionary({ cursor: 'abc-cursor' })

        expect(mock.history[0].query).toMatchObject({ pageSize: 100, pageToken: 'abc-cursor' })
      })

      it('handles a null payload', async () => {
        mock.onGet(`${ BASE }/models`).reply({ models: [] })

        const result = await service.getModelsDictionary(null)

        expect(result.items).toHaveLength(0)
        expect(result.cursor).toBeNull()
      })

      it('falls back to model name for the label when displayName is missing', async () => {
        mock.onGet(`${ BASE }/models`).reply({
          models: [{ name: 'models/gemini-x', supportedGenerationMethods: ['generateContent'] }],
        })

        const result = await service.getModelsDictionary({})

        expect(result.items[0]).toEqual({
          label: 'models/gemini-x',
          value: 'models/gemini-x',
          note: 'models/gemini-x',
        })
      })
    })

    describe('getEmbeddingModelsDictionary', () => {
      it('returns only embedContent-capable models', async () => {
        mock.onGet(`${ BASE }/models`).reply(modelsResponse)

        const result = await service.getEmbeddingModelsDictionary({})

        expect(result.items).toEqual([
          {
            label: 'Gemini Embedding 001',
            value: 'models/gemini-embedding-001',
            note: 'models/gemini-embedding-001',
          },
        ])
      })
    })

    describe('getImageModelsDictionary', () => {
      it('returns only models whose name contains "image"', async () => {
        mock.onGet(`${ BASE }/models`).reply(modelsResponse)

        const result = await service.getImageModelsDictionary({})

        expect(result.items).toHaveLength(1)
        expect(result.items[0].value).toBe('models/gemini-2.5-flash-image')
      })
    })

    describe('getTtsModelsDictionary', () => {
      it('returns only models whose name contains "tts"', async () => {
        mock.onGet(`${ BASE }/models`).reply(modelsResponse)

        const result = await service.getTtsModelsDictionary({})

        expect(result.items).toHaveLength(1)
        expect(result.items[0].value).toBe('models/gemini-2.5-flash-preview-tts')
      })
    })

    describe('getVideoModelsDictionary', () => {
      it('returns models supporting predictLongRunning or matching /veo/', async () => {
        mock.onGet(`${ BASE }/models`).reply(modelsResponse)

        const result = await service.getVideoModelsDictionary({})

        expect(result.items).toHaveLength(1)
        expect(result.items[0].value).toBe('models/veo-3.1-generate-preview')
      })
    })
  })

  // ── Files ──

  describe('uploadFile', () => {
    it('downloads the file, uploads via multipart form, and polls until ACTIVE', async () => {
      const fileUrl = 'https://example.com/invoice.pdf'

      mock.onGet(fileUrl).reply(Buffer.from('pdf-bytes'))
      mock.onPost(`${ UPLOAD_BASE }/files`).reply({ file: { name: 'files/abc123' } })
      mock.onGet(`${ BASE }/files/abc123`).reply({ name: 'files/abc123', state: 'ACTIVE', mimeType: 'application/pdf' })

      const result = await service.uploadFile(fileUrl)

      expect(result).toMatchObject({ name: 'files/abc123', state: 'ACTIVE' })

      const uploadCall = mock.history.find(h => h.url === `${ UPLOAD_BASE }/files`)

      expect(uploadCall.method).toBe('post')
      expect(uploadCall.headers).toMatchObject({ 'x-goog-api-key': API_KEY })
      expect(uploadCall.formData).toBeInstanceOf(Flowrunner.Request.FormData)
      // metadata field carries the resolved display name (defaulted from the URL filename)
      const metadataField = uploadCall.formData._fields.find(f => f.name === 'metadata')

      expect(JSON.parse(metadataField.value)).toEqual({ file: { displayName: 'invoice.pdf' } })

      const fileField = uploadCall.formData._fields.find(f => f.name === 'file')

      expect(fileField.filename).toMatchObject({ filename: 'invoice.pdf', contentType: 'application/pdf' })
    })

    it('uses the provided display name and MIME type', async () => {
      const fileUrl = 'https://example.com/data'

      mock.onGet(fileUrl).reply(Buffer.from('bytes'))
      mock.onPost(`${ UPLOAD_BASE }/files`).reply({ file: { name: 'files/xyz' } })
      mock.onGet(`${ BASE }/files/xyz`).reply({ name: 'files/xyz', state: 'ACTIVE' })

      await service.uploadFile(fileUrl, 'My Doc', 'text/plain')

      const uploadCall = mock.history.find(h => h.url === `${ UPLOAD_BASE }/files`)
      const metadataField = uploadCall.formData._fields.find(f => f.name === 'metadata')

      expect(JSON.parse(metadataField.value)).toEqual({ file: { displayName: 'My Doc' } })
    })

    it('throws when the upload response has no file name', async () => {
      const fileUrl = 'https://example.com/x.pdf'

      mock.onGet(fileUrl).reply(Buffer.from('bytes'))
      mock.onPost(`${ UPLOAD_BASE }/files`).reply({})

      await expect(service.uploadFile(fileUrl)).rejects.toThrow('Upload succeeded but no file name was returned')
    })

    it('throws when the file processing FAILED', async () => {
      const fileUrl = 'https://example.com/x.pdf'

      mock.onGet(fileUrl).reply(Buffer.from('bytes'))
      mock.onPost(`${ UPLOAD_BASE }/files`).reply({ file: { name: 'files/failme' } })
      mock.onGet(`${ BASE }/files/failme`).reply({ name: 'files/failme', state: 'FAILED', error: { message: 'bad file' } })

      await expect(service.uploadFile(fileUrl)).rejects.toThrow('File processing failed: bad file')
    })
  })

  describe('listFiles', () => {
    it('sends a GET with no query when no args are provided', async () => {
      mock.onGet(`${ BASE }/files`).reply({ files: [], nextPageToken: null })

      const result = await service.listFiles()

      expect(result).toEqual({ files: [], nextPageToken: null })
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].query).toEqual({})
    })

    it('includes pageSize and pageToken when provided', async () => {
      mock.onGet(`${ BASE }/files`).reply({ files: [] })

      await service.listFiles(25, 'token-1')

      expect(mock.history[0].query).toMatchObject({ pageSize: 25, pageToken: 'token-1' })
    })
  })

  describe('getFileInfo', () => {
    it('requests the file resource by name', async () => {
      mock.onGet(`${ BASE }/files/abc123`).reply({ name: 'files/abc123', state: 'ACTIVE' })

      const result = await service.getFileInfo('files/abc123')

      expect(result).toMatchObject({ name: 'files/abc123' })
      expect(mock.history[0].method).toBe('get')
    })
  })

  describe('deleteFile', () => {
    it('sends a DELETE and returns a success payload', async () => {
      mock.onDelete(`${ BASE }/files/abc123`).reply({})

      const result = await service.deleteFile('files/abc123')

      expect(mock.history[0].method).toBe('delete')
      expect(result).toEqual({ success: true, fileName: 'files/abc123' })
    })
  })

  // ── Content Generation ──

  describe('generateContent', () => {
    const genResponse = {
      candidates: [{ content: { parts: [{ text: 'Hello world' }] } }],
      usageMetadata: { totalTokenCount: 10 },
    }

    it('sends a minimal request with just contents', async () => {
      mock.onPost(`${ BASE }/models/gemini-2.5-flash:generateContent`).reply(genResponse)

      const result = await service.generateContent('models/gemini-2.5-flash', 'Say hi')

      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].headers).toMatchObject({ 'x-goog-api-key': API_KEY })
      expect(mock.history[0].body).toEqual({
        contents: [{ parts: [{ text: 'Say hi' }] }],
      })
      expect(result).toEqual({
        text: 'Hello world',
        model: 'models/gemini-2.5-flash',
        usageMetadata: { totalTokenCount: 10 },
      })
    })

    it('does not normalize the model (uses it verbatim in the URL)', async () => {
      mock.onPost(`${ BASE }/gemini-2.5-flash:generateContent`).reply(genResponse)

      await service.generateContent('gemini-2.5-flash', 'Say hi')

      expect(mock.history[0].url).toBe(`${ BASE }/gemini-2.5-flash:generateContent`)
    })

    it('includes file_data parts, system instruction, and generation config', async () => {
      mock.onPost(`${ BASE }/models/gemini-2.5-flash:generateContent`).reply(genResponse)

      await service.generateContent(
        'models/gemini-2.5-flash',
        'Summarize',
        [{ uri: 'files/abc', mimeType: 'application/pdf' }],
        'You are helpful',
        0.5,
        256,
        'json'
      )

      expect(mock.history[0].body).toEqual({
        contents: [{
          parts: [
            { file_data: { mime_type: 'application/pdf', file_uri: 'files/abc' } },
            { text: 'Summarize' },
          ],
        }],
        systemInstruction: { parts: [{ text: 'You are helpful' }] },
        generationConfig: {
          temperature: 0.5,
          maxOutputTokens: 256,
          responseMimeType: 'application/json',
        },
      })
    })

    it('defaults a missing file mimeType to application/octet-stream', async () => {
      mock.onPost(`${ BASE }/models/gemini-2.5-flash:generateContent`).reply(genResponse)

      await service.generateContent('models/gemini-2.5-flash', 'x', [{ uri: 'files/no-mime' }])

      expect(mock.history[0].body.contents[0].parts[0].file_data).toEqual({
        mime_type: 'application/octet-stream',
        file_uri: 'files/no-mime',
      })
    })

    it('returns empty text when the response has no candidate parts', async () => {
      mock.onPost(`${ BASE }/models/gemini-2.5-flash:generateContent`).reply({ candidates: [] })

      const result = await service.generateContent('models/gemini-2.5-flash', 'x')

      expect(result.text).toBe('')
      expect(result.usageMetadata).toBeNull()
    })

    it('throws with the API error message on failure', async () => {
      mock.onPost(`${ BASE }/models/gemini-2.5-flash:generateContent`).replyWithError({
        message: 'ignored',
        body: { error: { message: 'API key not valid' } },
      })

      await expect(service.generateContent('models/gemini-2.5-flash', 'x')).rejects.toThrow('API key not valid')
    })
  })

  describe('generateContentAdvanced', () => {
    const advResponse = {
      candidates: [{
        content: {
          parts: [
            { text: 'thinking...', thought: true },
            { text: 'Final answer' },
            { functionCall: { name: 'lookup', args: { q: 'x' } } },
          ],
        },
        groundingMetadata: { webSearchQueries: ['q'] },
        finishReason: 'STOP',
      }],
      modelVersion: 'gemini-2.5-flash-001',
      usageMetadata: { totalTokenCount: 55 },
    }

    it('normalizes a bare model name to models/<name>', async () => {
      mock.onPost(`${ BASE }/models/gemini-2.5-flash:generateContent`).reply(advResponse)

      await service.generateContentAdvanced('gemini-2.5-flash', 'Hi')

      expect(mock.history[0].url).toBe(`${ BASE }/models/gemini-2.5-flash:generateContent`)
    })

    it('sends a minimal request with a user turn', async () => {
      mock.onPost(`${ BASE }/models/gemini-2.5-flash:generateContent`).reply(advResponse)

      await service.generateContentAdvanced('models/gemini-2.5-flash', 'Hi')

      expect(mock.history[0].body).toEqual({
        contents: [{ role: 'user', parts: [{ text: 'Hi' }] }],
      })
    })

    it('shapes the response into text/thoughts/functionCalls/grounding fields', async () => {
      mock.onPost(`${ BASE }/models/gemini-2.5-flash:generateContent`).reply(advResponse)

      const result = await service.generateContentAdvanced('models/gemini-2.5-flash', 'Hi')

      expect(result).toEqual({
        text: 'Final answer',
        thoughts: 'thinking...',
        functionCalls: [{ name: 'lookup', args: { q: 'x' } }],
        executableCode: null,
        codeExecutionResult: null,
        groundingMetadata: { webSearchQueries: ['q'] },
        urlContextMetadata: null,
        finishReason: 'STOP',
        model: 'gemini-2.5-flash-001',
        usageMetadata: { totalTokenCount: 55 },
      })
    })

    it('prepends history before the current prompt', async () => {
      mock.onPost(`${ BASE }/models/gemini-2.5-flash:generateContent`).reply(advResponse)

      const history = [
        { role: 'user', parts: [{ text: 'Hi' }] },
        { role: 'model', parts: [{ text: 'Hello!' }] },
      ]

      await service.generateContentAdvanced('models/gemini-2.5-flash', 'Next', null, null, history)

      expect(mock.history[0].body.contents).toEqual([
        { role: 'user', parts: [{ text: 'Hi' }] },
        { role: 'model', parts: [{ text: 'Hello!' }] },
        { role: 'user', parts: [{ text: 'Next' }] },
      ])
    })

    it('downloads media URLs and sends them inline as base64', async () => {
      mock.onGet('https://example.com/pic.png').reply(Buffer.from('image-bytes'))
      mock.onPost(`${ BASE }/models/gemini-2.5-flash:generateContent`).reply(advResponse)

      await service.generateContentAdvanced(
        'models/gemini-2.5-flash', 'Describe', null, ['https://example.com/pic.png']
      )

      const parts = mock.history.find(h => h.url.endsWith(':generateContent')).body.contents[0].parts

      expect(parts[0]).toEqual({
        inline_data: {
          mime_type: 'image/png',
          data: Buffer.from('image-bytes').toString('base64'),
        },
      })
      expect(parts[1]).toEqual({ text: 'Describe' })
    })

    it('builds a full generationConfig from all sampling controls', async () => {
      mock.onPost(`${ BASE }/models/gemini-2.5-flash:generateContent`).reply(advResponse)

      await service.generateContentAdvanced(
        'models/gemini-2.5-flash', 'Hi', null, null, null, null,
        0.7, 0.9, 40, 512, ['STOP'], 42, 0.1, 0.2,
        'JSON', { type: 'OBJECT' }, 1024, true
      )

      expect(mock.history[0].body.generationConfig).toEqual({
        temperature: 0.7,
        topP: 0.9,
        topK: 40,
        maxOutputTokens: 512,
        seed: 42,
        presencePenalty: 0.1,
        frequencyPenalty: 0.2,
        stopSequences: ['STOP'],
        responseMimeType: 'application/json',
        responseSchema: { type: 'OBJECT' },
        thinkingConfig: { thinkingBudget: 1024, includeThoughts: true },
      })
    })

    it('defaults responseMimeType to application/json when a schema is given without a JSON format', async () => {
      mock.onPost(`${ BASE }/models/gemini-2.5-flash:generateContent`).reply(advResponse)

      await service.generateContentAdvanced(
        'models/gemini-2.5-flash', 'Hi', null, null, null, null,
        null, null, null, null, null, null, null, null,
        'Text', { type: 'ARRAY' }
      )

      expect(mock.history[0].body.generationConfig.responseMimeType).toBe('application/json')
      expect(mock.history[0].body.generationConfig.responseSchema).toEqual({ type: 'ARRAY' })
    })

    it('assembles the tools array for search, url context, code execution and functions', async () => {
      mock.onPost(`${ BASE }/models/gemini-2.5-flash:generateContent`).reply(advResponse)

      const functionDeclarations = [{ name: 'fn', description: 'd', parameters: {} }]

      await service.generateContentAdvanced(
        'models/gemini-2.5-flash', 'Hi', null, null, null, null,
        null, null, null, null, null, null, null, null,
        null, null, null, null,
        true, true, true, functionDeclarations
      )

      expect(mock.history[0].body.tools).toEqual([
        { functionDeclarations },
        { googleSearch: {} },
        { urlContext: {} },
        { codeExecution: {} },
      ])
    })

    it('maps safety settings labels to API enum values', async () => {
      mock.onPost(`${ BASE }/models/gemini-2.5-flash:generateContent`).reply(advResponse)

      await service.generateContentAdvanced(
        'models/gemini-2.5-flash', 'Hi', null, null, null, null,
        null, null, null, null, null, null, null, null,
        null, null, null, null,
        false, false, false, null,
        [{ category: 'Harassment', threshold: 'Block None' }]
      )

      expect(mock.history[0].body.safetySettings).toEqual([
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
      ])
    })

    it('normalizes a bare cachedContent name', async () => {
      mock.onPost(`${ BASE }/models/gemini-2.5-flash:generateContent`).reply(advResponse)

      await service.generateContentAdvanced(
        'models/gemini-2.5-flash', 'Hi', null, null, null, null,
        null, null, null, null, null, null, null, null,
        null, null, null, null,
        false, false, false, null, null, 'abc123'
      )

      expect(mock.history[0].body.cachedContent).toBe('cachedContents/abc123')
    })
  })

  describe('countTokens', () => {
    it('sends the text as a content part', async () => {
      mock.onPost(`${ BASE }/models/gemini-2.5-flash:countTokens`).reply({ totalTokens: 31 })

      const result = await service.countTokens('gemini-2.5-flash', 'count me')

      expect(mock.history[0].url).toBe(`${ BASE }/models/gemini-2.5-flash:countTokens`)
      expect(mock.history[0].body).toEqual({ contents: [{ parts: [{ text: 'count me' }] }] })
      expect(result).toEqual({ totalTokens: 31 })
    })

    it('includes file_data parts when files are provided', async () => {
      mock.onPost(`${ BASE }/models/gemini-2.5-flash:countTokens`).reply({ totalTokens: 40 })

      await service.countTokens('gemini-2.5-flash', 'count', [{ uri: 'files/a', mimeType: 'text/plain' }])

      expect(mock.history[0].body.contents[0].parts).toEqual([
        { file_data: { mime_type: 'text/plain', file_uri: 'files/a' } },
        { text: 'count' },
      ])
    })
  })

  // ── Image Generation ──

  describe('generateImage', () => {
    it('requests IMAGE modality, saves inline images to storage and returns URLs', async () => {
      uploadFileMock.mockResolvedValue({ url: 'https://files.flowrunner.com/flow/image.png' })

      mock.onPost(`${ BASE }/models/gemini-2.5-flash-image:generateContent`).reply({
        candidates: [{
          content: {
            parts: [
              { text: 'Here is the image.' },
              { inlineData: { mimeType: 'image/png', data: Buffer.from('img').toString('base64') } },
            ],
          },
        }],
        usageMetadata: { totalTokenCount: 12 },
      })

      const result = await service.generateImage('models/gemini-2.5-flash-image', 'a cat')

      expect(mock.history.find(h => h.url.endsWith(':generateContent')).body.generationConfig.responseModalities)
        .toEqual(['TEXT', 'IMAGE'])
      expect(uploadFileMock).toHaveBeenCalledTimes(1)
      expect(uploadFileMock.mock.calls[0][0]).toBeInstanceOf(Buffer)
      expect(result).toEqual({
        fileURLs: ['https://files.flowrunner.com/flow/image.png'],
        text: 'Here is the image.',
        usageMetadata: { totalTokenCount: 12 },
      })
    })

    it('sends aspect ratio and image size in imageConfig', async () => {
      mock.onPost(`${ BASE }/models/gemini-2.5-flash-image:generateContent`).reply({
        candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: Buffer.from('i').toString('base64') } }] } }],
      })

      await service.generateImage('models/gemini-2.5-flash-image', 'x', null, '16:9', '2K')

      const config = mock.history.find(h => h.url.endsWith(':generateContent')).body.generationConfig

      expect(config.imageConfig).toEqual({ aspectRatio: '16:9', imageSize: '2K' })
    })

    it('downloads input image URLs and sends them inline', async () => {
      mock.onGet('https://example.com/in.png').reply(Buffer.from('input-image'))
      mock.onPost(`${ BASE }/models/gemini-2.5-flash-image:generateContent`).reply({
        candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: Buffer.from('out').toString('base64') } }] } }],
      })

      await service.generateImage('models/gemini-2.5-flash-image', 'edit', ['https://example.com/in.png'])

      const parts = mock.history.find(h => h.url.endsWith(':generateContent')).body.contents[0].parts

      expect(parts[0].inline_data).toEqual({
        mime_type: 'image/png',
        data: Buffer.from('input-image').toString('base64'),
      })
    })

    it('passes fileOptions through to Files.uploadFile', async () => {
      mock.onPost(`${ BASE }/models/gemini-2.5-flash-image:generateContent`).reply({
        candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: Buffer.from('i').toString('base64') } }] } }],
      })

      await service.generateImage('models/gemini-2.5-flash-image', 'x', null, null, null, { scope: 'WORKSPACE' })

      expect(uploadFileMock.mock.calls[0][1]).toMatchObject({ scope: 'WORKSPACE', generateUrl: true, overwrite: true })
    })

    it('throws when the model returns no image', async () => {
      mock.onPost(`${ BASE }/models/gemini-2.5-flash-image:generateContent`).reply({
        candidates: [{ content: { parts: [{ text: 'sorry' }] }, finishReason: 'SAFETY' }],
      })

      await expect(service.generateImage('models/gemini-2.5-flash-image', 'x'))
        .rejects.toThrow('No image was returned by the model (finish reason: SAFETY)')
    })
  })

  // ── Speech Generation ──

  describe('generateSpeech', () => {
    it('requests AUDIO modality with a single-voice speechConfig and saves a WAV', async () => {
      uploadFileMock.mockResolvedValue({ url: 'https://files.flowrunner.com/flow/speech.wav' })

      mock.onPost(`${ BASE }/models/gemini-2.5-flash-preview-tts:generateContent`).reply({
        candidates: [{
          content: {
            parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: Buffer.from('pcm-data').toString('base64') } }],
          },
        }],
        usageMetadata: { totalTokenCount: 18 },
      })

      const result = await service.generateSpeech('models/gemini-2.5-flash-preview-tts', 'Hello there', 'Kore')

      const body = mock.history.find(h => h.url.endsWith(':generateContent')).body

      expect(body.generationConfig.responseModalities).toEqual(['AUDIO'])
      expect(body.generationConfig.speechConfig).toEqual({
        voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
      })
      // PCM is converted to WAV, so the extension is wav and mimeType audio/wav
      expect(result.mimeType).toBe('audio/wav')
      expect(result.fileURL).toBe('https://files.flowrunner.com/flow/speech.wav')
      expect(uploadFileMock.mock.calls[0][1].filename).toMatch(/\.wav$/)
      // The uploaded buffer should start with a RIFF/WAVE header
      const uploadedBuffer = uploadFileMock.mock.calls[0][0]

      expect(uploadedBuffer.slice(0, 4).toString()).toBe('RIFF')
      expect(uploadedBuffer.slice(8, 12).toString()).toBe('WAVE')
    })

    it('builds a multi-speaker speechConfig when speakers are given', async () => {
      mock.onPost(`${ BASE }/models/gemini-2.5-flash-preview-tts:generateContent`).reply({
        candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: Buffer.from('p').toString('base64') } }] } }],
      })

      await service.generateSpeech('models/gemini-2.5-flash-preview-tts', 'Joe: Hi\nJane: Hello', undefined, [
        { speaker: 'Joe', voiceName: 'Puck' },
        { speaker: 'Jane', voiceName: 'Kore' },
      ])

      const speechConfig = mock.history.find(h => h.url.endsWith(':generateContent')).body.generationConfig.speechConfig

      expect(speechConfig).toEqual({
        multiSpeakerVoiceConfig: {
          speakerVoiceConfigs: [
            { speaker: 'Joe', voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } } },
            { speaker: 'Jane', voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
          ],
        },
      })
    })

    it('throws when the model returns no audio', async () => {
      mock.onPost(`${ BASE }/models/gemini-2.5-flash-preview-tts:generateContent`).reply({
        candidates: [{ content: { parts: [{ text: 'no audio' }] } }],
      })

      await expect(service.generateSpeech('models/gemini-2.5-flash-preview-tts', 'x'))
        .rejects.toThrow('No audio was returned by the model')
    })
  })

  // ── Video Generation ──

  describe('startVideoGeneration', () => {
    it('sends a predictLongRunning request and returns the operation name', async () => {
      mock.onPost(`${ BASE }/models/veo-3.1-generate-preview:predictLongRunning`).reply({
        name: 'models/veo-3.1-generate-preview/operations/op123',
      })

      const result = await service.startVideoGeneration('models/veo-3.1-generate-preview', 'a sunset')

      expect(mock.history[0].body).toEqual({ instances: [{ prompt: 'a sunset' }] })
      expect(result).toEqual({ operationName: 'models/veo-3.1-generate-preview/operations/op123' })
    })

    it('includes parameters and maps person generation labels', async () => {
      mock.onPost(`${ BASE }/models/veo-3.1-generate-preview:predictLongRunning`).reply({ name: 'op' })

      await service.startVideoGeneration(
        'models/veo-3.1-generate-preview', 'p', null, 'no blur', '16:9', '1080p', 8, 'Allow Adults Only'
      )

      expect(mock.history[0].body.parameters).toEqual({
        negativePrompt: 'no blur',
        aspectRatio: '16:9',
        resolution: '1080p',
        durationSeconds: '8',
        personGeneration: 'allow_adult',
      })
    })

    it('downloads a first-frame image and sends it inline', async () => {
      mock.onGet('https://example.com/first.jpg').reply(Buffer.from('frame'))
      mock.onPost(`${ BASE }/models/veo-3.1-generate-preview:predictLongRunning`).reply({ name: 'op' })

      await service.startVideoGeneration('models/veo-3.1-generate-preview', 'p', 'https://example.com/first.jpg')

      const instance = mock.history.find(h => h.url.endsWith(':predictLongRunning')).body.instances[0]

      expect(instance.image.inlineData).toEqual({
        mimeType: 'image/jpeg',
        data: Buffer.from('frame').toString('base64'),
      })
    })

    it('throws when no operation name is returned', async () => {
      mock.onPost(`${ BASE }/models/veo-3.1-generate-preview:predictLongRunning`).reply({})

      await expect(service.startVideoGeneration('models/veo-3.1-generate-preview', 'p'))
        .rejects.toThrow('no operation name was returned')
    })
  })

  describe('getVideoOperation', () => {
    it('returns done=false and null video uris when not finished', async () => {
      mock.onGet(`${ BASE }/models/veo/operations/op1`).reply({ name: 'models/veo/operations/op1', done: false })

      const result = await service.getVideoOperation('models/veo/operations/op1')

      expect(result).toMatchObject({ done: false, videoUri: null, videoUris: [], error: null })
      expect(result.operation).toMatchObject({ name: 'models/veo/operations/op1' })
    })

    it('extracts video uris from a completed operation', async () => {
      mock.onGet(`${ BASE }/models/veo/operations/op2`).reply({
        done: true,
        response: {
          generateVideoResponse: {
            generatedSamples: [
              { video: { uri: 'https://example.com/v1.mp4:download?alt=media' } },
              { video: { uri: 'https://example.com/v2.mp4:download?alt=media' } },
            ],
          },
        },
      })

      const result = await service.getVideoOperation('models/veo/operations/op2')

      expect(result.done).toBe(true)
      expect(result.videoUri).toBe('https://example.com/v1.mp4:download?alt=media')
      expect(result.videoUris).toHaveLength(2)
    })

    it('surfaces an operation error', async () => {
      mock.onGet(`${ BASE }/models/veo/operations/op3`).reply({
        done: true,
        error: { code: 3, message: 'invalid prompt' },
      })

      const result = await service.getVideoOperation('models/veo/operations/op3')

      expect(result.error).toEqual({ code: 3, message: 'invalid prompt' })
    })
  })

  describe('saveGeneratedVideo', () => {
    it('downloads the video with the API key header and saves it to storage', async () => {
      uploadFileMock.mockResolvedValue({ url: 'https://files.flowrunner.com/flow/video.mp4' })

      const videoUri = 'https://generativelanguage.googleapis.com/v1beta/files/xyz:download?alt=media'

      mock.onGet(videoUri).reply(Buffer.from('mp4-bytes'))

      const result = await service.saveGeneratedVideo(videoUri)

      const downloadCall = mock.history.find(h => h.url === videoUri)

      expect(downloadCall.headers).toMatchObject({ 'x-goog-api-key': API_KEY })
      expect(downloadCall.encoding).toBeNull()
      expect(result).toEqual({
        fileURL: 'https://files.flowrunner.com/flow/video.mp4',
        sizeBytes: Buffer.from('mp4-bytes').length,
      })
      expect(uploadFileMock.mock.calls[0][1].filename).toMatch(/\.mp4$/)
    })

    it('throws a wrapped error when the download fails', async () => {
      const videoUri = 'https://example.com/fail:download?alt=media'

      mock.onGet(videoUri).replyWithError({ message: 'Not Found', body: { error: { message: 'file expired' } } })

      await expect(service.saveGeneratedVideo(videoUri)).rejects.toThrow('Failed to download generated video: file expired')
    })
  })

  // ── Embeddings ──

  describe('embedContent', () => {
    it('sends a minimal embed request and returns embedding + dimensions', async () => {
      mock.onPost(`${ BASE }/models/gemini-embedding-001:embedContent`).reply({
        embedding: { values: [0.1, 0.2, 0.3] },
      })

      const result = await service.embedContent('gemini-embedding-001', 'hello')

      expect(mock.history[0].url).toBe(`${ BASE }/models/gemini-embedding-001:embedContent`)
      expect(mock.history[0].body).toEqual({ content: { parts: [{ text: 'hello' }] } })
      expect(result).toEqual({ embedding: [0.1, 0.2, 0.3], dimensions: 3 })
    })

    it('maps task type and includes dimensionality and title', async () => {
      mock.onPost(`${ BASE }/models/gemini-embedding-001:embedContent`).reply({ embedding: { values: [] } })

      await service.embedContent('gemini-embedding-001', 'doc', 'Retrieval Document', 768, 'Title')

      expect(mock.history[0].body).toEqual({
        content: { parts: [{ text: 'doc' }] },
        taskType: 'RETRIEVAL_DOCUMENT',
        outputDimensionality: 768,
        title: 'Title',
      })
    })

    it('returns an empty embedding when none is present', async () => {
      mock.onPost(`${ BASE }/models/gemini-embedding-001:embedContent`).reply({})

      const result = await service.embedContent('gemini-embedding-001', 'x')

      expect(result).toEqual({ embedding: [], dimensions: 0 })
    })
  })

  describe('batchEmbedContents', () => {
    it('builds one request per text with the normalized model', async () => {
      mock.onPost(`${ BASE }/models/gemini-embedding-001:batchEmbedContents`).reply({
        embeddings: [{ values: [0.1, 0.2] }, { values: [0.3, 0.4] }],
      })

      const result = await service.batchEmbedContents('gemini-embedding-001', ['a', 'b'], 'Clustering', 256)

      expect(mock.history[0].body).toEqual({
        requests: [
          { model: 'models/gemini-embedding-001', content: { parts: [{ text: 'a' }] }, taskType: 'CLUSTERING', outputDimensionality: 256 },
          { model: 'models/gemini-embedding-001', content: { parts: [{ text: 'b' }] }, taskType: 'CLUSTERING', outputDimensionality: 256 },
        ],
      })
      expect(result).toEqual({ embeddings: [[0.1, 0.2], [0.3, 0.4]], count: 2 })
    })

    it('handles an empty texts list', async () => {
      mock.onPost(`${ BASE }/models/gemini-embedding-001:batchEmbedContents`).reply({ embeddings: [] })

      const result = await service.batchEmbedContents('gemini-embedding-001', [])

      expect(mock.history[0].body).toEqual({ requests: [] })
      expect(result).toEqual({ embeddings: [], count: 0 })
    })
  })

  // ── Models ──

  describe('listModels', () => {
    it('sends a GET with no query by default', async () => {
      mock.onGet(`${ BASE }/models`).reply({ models: [], nextPageToken: null })

      const result = await service.listModels()

      expect(result).toEqual({ models: [], nextPageToken: null })
      expect(mock.history[0].query).toEqual({})
    })

    it('includes pageSize and pageToken', async () => {
      mock.onGet(`${ BASE }/models`).reply({ models: [] })

      await service.listModels(200, 'tok')

      expect(mock.history[0].query).toMatchObject({ pageSize: 200, pageToken: 'tok' })
    })
  })

  describe('getModel', () => {
    it('normalizes the model name and requests it', async () => {
      mock.onGet(`${ BASE }/models/gemini-2.5-flash`).reply({ name: 'models/gemini-2.5-flash' })

      const result = await service.getModel('gemini-2.5-flash')

      expect(mock.history[0].url).toBe(`${ BASE }/models/gemini-2.5-flash`)
      expect(result).toMatchObject({ name: 'models/gemini-2.5-flash' })
    })

    it('leaves a tunedModels name intact', async () => {
      mock.onGet(`${ BASE }/tunedModels/my-model`).reply({ name: 'tunedModels/my-model' })

      await service.getModel('tunedModels/my-model')

      expect(mock.history[0].url).toBe(`${ BASE }/tunedModels/my-model`)
    })
  })

  // ── Context Caching ──

  describe('createCachedContent', () => {
    it('sends contents, ttl, system instruction and display name', async () => {
      mock.onPost(`${ BASE }/cachedContents`).reply({ name: 'cachedContents/abc' })

      const result = await service.createCachedContent(
        'gemini-2.5-flash', 'cache this text', null, 'be brief', 7200, 'my-cache'
      )

      expect(mock.history[0].body).toEqual({
        model: 'models/gemini-2.5-flash',
        contents: [{ role: 'user', parts: [{ text: 'cache this text' }] }],
        ttl: '7200s',
        systemInstruction: { parts: [{ text: 'be brief' }] },
        displayName: 'my-cache',
      })
      expect(result).toMatchObject({ name: 'cachedContents/abc' })
    })

    it('defaults ttl to 3600s', async () => {
      mock.onPost(`${ BASE }/cachedContents`).reply({ name: 'cachedContents/abc' })

      await service.createCachedContent('gemini-2.5-flash', 'text')

      expect(mock.history[0].body.ttl).toBe('3600s')
    })

    it('throws when neither text nor files are supplied', async () => {
      await expect(service.createCachedContent('gemini-2.5-flash'))
        .rejects.toThrow('At least one of Text or Files must be provided')
    })
  })

  describe('listCachedContents', () => {
    it('sends a GET with pagination', async () => {
      mock.onGet(`${ BASE }/cachedContents`).reply({ cachedContents: [] })

      await service.listCachedContents(5, 'tok')

      expect(mock.history[0].query).toMatchObject({ pageSize: 5, pageToken: 'tok' })
    })
  })

  describe('getCachedContent', () => {
    it('normalizes a bare cache name', async () => {
      mock.onGet(`${ BASE }/cachedContents/abc`).reply({ name: 'cachedContents/abc' })

      await service.getCachedContent('abc')

      expect(mock.history[0].url).toBe(`${ BASE }/cachedContents/abc`)
    })

    it('leaves an already-qualified cache name intact', async () => {
      mock.onGet(`${ BASE }/cachedContents/abc`).reply({ name: 'cachedContents/abc' })

      await service.getCachedContent('cachedContents/abc')

      expect(mock.history[0].url).toBe(`${ BASE }/cachedContents/abc`)
    })
  })

  describe('updateCachedContent', () => {
    it('sends a PATCH with an updateMask and new ttl', async () => {
      mock.onPatch(`${ BASE }/cachedContents/abc`).reply({ name: 'cachedContents/abc' })

      await service.updateCachedContent('abc', 1800)

      expect(mock.history[0].method).toBe('patch')
      expect(mock.history[0].query).toMatchObject({ updateMask: 'ttl' })
      expect(mock.history[0].body).toEqual({ ttl: '1800s' })
    })
  })

  describe('deleteCachedContent', () => {
    it('sends a DELETE to the normalized URL and echoes back the raw cacheName', async () => {
      mock.onDelete(`${ BASE }/cachedContents/abc`).reply({})

      const result = await service.deleteCachedContent('abc')

      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${ BASE }/cachedContents/abc`)
      // Note: deleteCachedContent echoes the RAW input cacheName, unlike cancel/deleteBatchJob
      // which return the normalized name. See suspected-bug note in the summary.
      expect(result).toEqual({ success: true, cacheName: 'abc' })
    })

    it('returns a normalized cacheName only when the input was already qualified', async () => {
      mock.onDelete(`${ BASE }/cachedContents/xyz`).reply({})

      const result = await service.deleteCachedContent('cachedContents/xyz')

      expect(result).toEqual({ success: true, cacheName: 'cachedContents/xyz' })
    })
  })

  // ── Batch Processing ──

  describe('createBatchJob', () => {
    it('builds inline requests from simple prompts', async () => {
      mock.onPost(`${ BASE }/models/gemini-2.5-flash:batchGenerateContent`).reply({
        name: 'batches/abc',
        metadata: { state: 'BATCH_STATE_PENDING' },
      })

      const result = await service.createBatchJob('gemini-2.5-flash', 'my-batch', ['Q1', 'Q2'])

      expect(mock.history[0].url).toBe(`${ BASE }/models/gemini-2.5-flash:batchGenerateContent`)
      expect(mock.history[0].body).toEqual({
        batch: {
          inputConfig: {
            requests: {
              requests: [
                { request: { contents: [{ role: 'user', parts: [{ text: 'Q1' }] }] }, metadata: { key: 'prompt-1' } },
                { request: { contents: [{ role: 'user', parts: [{ text: 'Q2' }] }] }, metadata: { key: 'prompt-2' } },
              ],
            },
          },
          displayName: 'my-batch',
        },
      })
      expect(result).toEqual({
        name: 'batches/abc',
        state: 'BATCH_STATE_PENDING',
        operation: { name: 'batches/abc', metadata: { state: 'BATCH_STATE_PENDING' } },
      })
    })

    it('uses a file name input config when inputFileName is provided', async () => {
      mock.onPost(`${ BASE }/models/gemini-2.5-flash:batchGenerateContent`).reply({ name: 'batches/f' })

      await service.createBatchJob('gemini-2.5-flash', null, null, null, 'abc-file')

      expect(mock.history[0].body).toEqual({
        batch: { inputConfig: { fileName: 'files/abc-file' } },
      })
    })

    it('wraps raw request objects that lack a request wrapper', async () => {
      mock.onPost(`${ BASE }/models/gemini-2.5-flash:batchGenerateContent`).reply({ name: 'batches/r' })

      const rawRequest = { contents: [{ role: 'user', parts: [{ text: 'raw' }] }] }

      await service.createBatchJob('gemini-2.5-flash', null, null, [rawRequest])

      expect(mock.history[0].body.batch.inputConfig.requests.requests).toEqual([
        { request: rawRequest, metadata: { key: 'request-1' } },
      ])
    })

    it('throws when no prompts, requests, or input file are provided', async () => {
      await expect(service.createBatchJob('gemini-2.5-flash'))
        .rejects.toThrow('Provide one of Prompts, Requests, or Input File Name')
    })
  })

  describe('getBatchJob', () => {
    it('shapes inlined results from a completed job', async () => {
      mock.onGet(`${ BASE }/batches/abc`).reply({
        name: 'batches/abc',
        metadata: { state: 'BATCH_STATE_SUCCEEDED' },
        done: true,
        response: {
          inlinedResponses: {
            inlinedResponses: [
              { metadata: { key: 'prompt-1' }, response: { candidates: [{ content: { parts: [{ text: 'A' }] } }] } },
            ],
          },
        },
      })

      const result = await service.getBatchJob('abc')

      expect(mock.history[0].url).toBe(`${ BASE }/batches/abc`)
      expect(result).toMatchObject({
        name: 'batches/abc',
        state: 'BATCH_STATE_SUCCEEDED',
        done: true,
        outputFileName: null,
        error: null,
      })
      expect(result.results).toHaveLength(1)
    })

    it('reports the output file name for file-based jobs', async () => {
      mock.onGet(`${ BASE }/batches/f`).reply({
        name: 'batches/f',
        done: true,
        response: { responsesFile: 'files/batch-output' },
      })

      const result = await service.getBatchJob('batches/f')

      expect(result.outputFileName).toBe('files/batch-output')
    })
  })

  describe('listBatchJobs', () => {
    it('sends a GET with pagination', async () => {
      mock.onGet(`${ BASE }/batches`).reply({ operations: [] })

      await service.listBatchJobs(5, 'tok')

      expect(mock.history[0].query).toMatchObject({ pageSize: 5, pageToken: 'tok' })
    })
  })

  describe('cancelBatchJob', () => {
    it('posts to the :cancel endpoint and returns success', async () => {
      mock.onPost(`${ BASE }/batches/abc:cancel`).reply({})

      const result = await service.cancelBatchJob('abc')

      expect(mock.history[0].url).toBe(`${ BASE }/batches/abc:cancel`)
      expect(mock.history[0].body).toEqual({})
      expect(result).toEqual({ success: true, batchName: 'batches/abc' })
    })
  })

  describe('deleteBatchJob', () => {
    it('sends a DELETE and returns success', async () => {
      mock.onDelete(`${ BASE }/batches/abc`).reply({})

      const result = await service.deleteBatchJob('batches/abc')

      expect(mock.history[0].method).toBe('delete')
      expect(result).toEqual({ success: true, batchName: 'batches/abc' })
    })
  })

  describe('downloadBatchResults', () => {
    it('downloads and parses JSONL lines', async () => {
      const jsonl = [
        JSON.stringify({ key: 'request-1', response: { candidates: [{ content: { parts: [{ text: 'A' }] } }] } }),
        '',
        JSON.stringify({ key: 'request-2', response: {} }),
      ].join('\n')

      mock.onGet(`${ DOWNLOAD_BASE }/files/out:download`).reply(Buffer.from(jsonl))

      const result = await service.downloadBatchResults('out')

      expect(mock.history[0].url).toBe(`${ DOWNLOAD_BASE }/files/out:download`)
      expect(mock.history[0].query).toMatchObject({ alt: 'media' })
      expect(result.count).toBe(2)
      expect(result.results[0]).toMatchObject({ key: 'request-1' })
    })

    it('skips unparseable lines', async () => {
      const jsonl = [JSON.stringify({ key: 'ok' }), 'not-json'].join('\n')

      mock.onGet(`${ DOWNLOAD_BASE }/files/out:download`).reply(Buffer.from(jsonl))

      const result = await service.downloadBatchResults('files/out')

      expect(result.count).toBe(1)
      expect(result.results[0]).toEqual({ key: 'ok' })
    })
  })
})
