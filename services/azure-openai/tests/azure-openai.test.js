'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-azure-api-key'
const ENDPOINT = 'https://my-resource.openai.azure.com'
const BASE_V1 = `${ ENDPOINT }/openai/v1`

describe('Azure OpenAI Service', () => {
  let sandbox
  let service
  let mock
  let uploadFileMock

  beforeAll(() => {
    sandbox = createSandbox({
      apiKey: API_KEY,
      endpoint: ENDPOINT,
      apiVersion: 'v1',
    })

    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()

    // Mock the flowrunner.Files API that the runtime normally provides
    uploadFileMock = jest.fn().mockResolvedValue({ url: 'https://files.example.com/uploaded.png' })
    service.flowrunner = {
      Files: {
        uploadFile: uploadFileMock,
      },
    }
  })

  afterEach(() => {
    mock.reset()
    uploadFileMock.mockClear()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Registration ──

  describe('service registration', () => {
    it('registers with correct config items', () => {
      expect(sandbox.getConfigItems()).toEqual([
        expect.objectContaining({ name: 'apiKey', required: true, shared: false, type: 'STRING' }),
        expect.objectContaining({ name: 'endpoint', required: true, shared: false, type: 'STRING' }),
        expect.objectContaining({ name: 'apiVersion', required: false, shared: false, type: 'STRING', defaultValue: 'v1' }),
      ])
    })
  })

  // ── askAI ──

  describe('askAI', () => {
    const url = `${ BASE_V1 }/chat/completions`

    const chatResponse = {
      choices: [{
        message: { content: 'Hello!' },
        finish_reason: 'stop',
        content_filter_results: { hate: { filtered: false, severity: 'safe' } },
      }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }

    it('sends correct request with required params only', async () => {
      mock.onPost(url).reply(chatResponse)
      const result = await service.askAI('my-gpt4o', 'What is Azure?')

      expect(result).toEqual({
        text: 'Hello!',
        finishReason: 'stop',
        usage: chatResponse.usage,
        contentFilterResults: { hate: { filtered: false, severity: 'safe' } },
      })

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].headers).toMatchObject({ 'api-key': API_KEY })
      expect(mock.history[0].body).toEqual({
        model: 'my-gpt4o',
        messages: [{ role: 'user', content: 'What is Azure?' }],
      })
    })

    it('includes system message when provided', async () => {
      mock.onPost(url).reply(chatResponse)
      await service.askAI('deploy', 'Hi', 'Be brief')

      expect(mock.history[0].body.messages).toEqual([
        { role: 'system', content: 'Be brief' },
        { role: 'user', content: 'Hi' },
      ])
    })

    it('includes maxTokens and temperature when provided', async () => {
      mock.onPost(url).reply(chatResponse)
      await service.askAI('deploy', 'Hi', null, 100, 0.5)

      expect(mock.history[0].body).toMatchObject({
        max_completion_tokens: 100,
        temperature: 0.5,
      })
    })

    it('omits maxTokens and temperature when null', async () => {
      mock.onPost(url).reply(chatResponse)
      await service.askAI('deploy', 'Hi', null, null, null)

      expect(mock.history[0].body).not.toHaveProperty('max_completion_tokens')
      expect(mock.history[0].body).not.toHaveProperty('temperature')
    })

    it('omits contentFilterResults when not present in response', async () => {
      mock.onPost(url).reply({
        choices: [{ message: { content: 'Hello' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
      })
      const result = await service.askAI('deploy', 'Hi')

      expect(result).not.toHaveProperty('contentFilterResults')
    })

    it('returns empty text when response has no content', async () => {
      mock.onPost(url).reply({ choices: [{ message: {} }], usage: {} })
      const result = await service.askAI('deploy', 'Hi')

      expect(result.text).toBe('')
    })

    it('throws when deployment is empty', async () => {
      await expect(service.askAI('', 'Hi')).rejects.toThrow('Deployment name is required')
    })

    it('throws when prompt is empty', async () => {
      await expect(service.askAI('deploy', '')).rejects.toThrow('Prompt is required')
    })

    it('throws on API error', async () => {
      mock.onPost(url).replyWithError({ message: 'Unauthorized' })
      await expect(service.askAI('deploy', 'Hi')).rejects.toThrow()
    })
  })

  // ── chatCompletionAdvanced ──

  describe('chatCompletionAdvanced', () => {
    const url = `${ BASE_V1 }/chat/completions`

    const fullResponse = {
      id: 'chatcmpl-123',
      choices: [{ index: 0, message: { role: 'assistant', content: 'Hi' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
    }

    it('sends correct request with messages only', async () => {
      mock.onPost(url).reply(fullResponse)
      const messages = [{ role: 'user', content: 'Hello' }]
      const result = await service.chatCompletionAdvanced('deploy', messages)

      expect(result).toEqual(fullResponse)
      expect(mock.history[0].body).toEqual({
        model: 'deploy',
        messages,
      })
    })

    it('includes tools and toolChoice', async () => {
      mock.onPost(url).reply(fullResponse)
      const tools = [{ type: 'function', function: { name: 'get_weather' } }]
      await service.chatCompletionAdvanced('deploy', [{ role: 'user', content: 'Hi' }], tools, 'auto')

      expect(mock.history[0].body).toMatchObject({
        tools,
        tool_choice: 'auto',
      })
    })

    it('parses JSON toolChoice string', async () => {
      mock.onPost(url).reply(fullResponse)
      const toolChoiceJson = '{"type":"function","function":{"name":"get_weather"}}'
      await service.chatCompletionAdvanced('deploy', [{ role: 'user', content: 'Hi' }], null, toolChoiceJson)

      expect(mock.history[0].body.tool_choice).toEqual({ type: 'function', function: { name: 'get_weather' } })
    })

    it('includes responseFormat', async () => {
      mock.onPost(url).reply(fullResponse)
      const responseFormat = { type: 'json_object' }
      await service.chatCompletionAdvanced('deploy', [{ role: 'user', content: 'Hi' }], null, null, responseFormat)

      expect(mock.history[0].body.response_format).toEqual(responseFormat)
    })

    it('includes all optional numeric params', async () => {
      mock.onPost(url).reply(fullResponse)
      await service.chatCompletionAdvanced(
        'deploy', [{ role: 'user', content: 'Hi' }],
        null, null, null,
        0.7, 0.9, 500, ['END'], 42
      )

      expect(mock.history[0].body).toMatchObject({
        temperature: 0.7,
        top_p: 0.9,
        max_completion_tokens: 500,
        stop: ['END'],
        seed: 42,
      })
    })

    it('maps reasoningEffort dropdown values to lowercase', async () => {
      mock.onPost(url).reply(fullResponse)
      await service.chatCompletionAdvanced(
        'deploy', [{ role: 'user', content: 'Hi' }],
        null, null, null, null, null, null, null, null, 'High'
      )

      expect(mock.history[0].body.reasoning_effort).toBe('high')
    })

    it('includes dataSources', async () => {
      mock.onPost(url).reply(fullResponse)
      const dataSources = [{ type: 'azure_search', parameters: { endpoint: 'https://search.example.com' } }]
      await service.chatCompletionAdvanced(
        'deploy', [{ role: 'user', content: 'Hi' }],
        null, null, null, null, null, null, null, null, null, dataSources
      )

      expect(mock.history[0].body.data_sources).toEqual(dataSources)
    })

    it('omits empty arrays for tools, stop, dataSources', async () => {
      mock.onPost(url).reply(fullResponse)
      await service.chatCompletionAdvanced(
        'deploy', [{ role: 'user', content: 'Hi' }],
        [], null, null, null, null, null, [], null, null, []
      )

      const body = mock.history[0].body

      expect(body).not.toHaveProperty('tools')
      expect(body).not.toHaveProperty('stop')
      expect(body).not.toHaveProperty('data_sources')
    })

    it('throws when deployment is empty', async () => {
      await expect(service.chatCompletionAdvanced('', [])).rejects.toThrow('Deployment name is required')
    })

    it('throws when messages is empty', async () => {
      await expect(service.chatCompletionAdvanced('deploy', [])).rejects.toThrow('Messages array is required')
    })

    it('throws when messages is not an array', async () => {
      await expect(service.chatCompletionAdvanced('deploy', 'not-array')).rejects.toThrow('Messages array is required')
    })
  })

  // ── analyzeImage ──

  describe('analyzeImage', () => {
    const url = `${ BASE_V1 }/chat/completions`

    const visionResponse = {
      choices: [{ message: { content: 'A red car.' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 50, completion_tokens: 5, total_tokens: 55 },
    }

    it('sends correct request with image URLs', async () => {
      mock.onPost(url).reply(visionResponse)
      const result = await service.analyzeImage('gpt4o', ['https://img.example.com/photo.jpg'], 'Describe this')

      expect(result).toEqual({
        text: 'A red car.',
        finishReason: 'stop',
        usage: visionResponse.usage,
      })

      const body = mock.history[0].body

      expect(body.messages).toHaveLength(1)
      expect(body.messages[0].role).toBe('user')
      expect(body.messages[0].content).toEqual([
        { type: 'text', text: 'Describe this' },
        { type: 'image_url', image_url: { url: 'https://img.example.com/photo.jpg' } },
      ])
    })

    it('includes multiple image URLs', async () => {
      mock.onPost(url).reply(visionResponse)
      await service.analyzeImage('gpt4o', ['https://a.com/1.jpg', 'https://a.com/2.jpg'], 'Compare')

      const content = mock.history[0].body.messages[0].content

      expect(content).toHaveLength(3) // 1 text + 2 images
      expect(content[1].image_url.url).toBe('https://a.com/1.jpg')
      expect(content[2].image_url.url).toBe('https://a.com/2.jpg')
    })

    it('includes maxTokens when provided', async () => {
      mock.onPost(url).reply(visionResponse)
      await service.analyzeImage('gpt4o', ['https://a.com/1.jpg'], 'Describe', 200)

      expect(mock.history[0].body.max_completion_tokens).toBe(200)
    })

    it('omits maxTokens when not provided', async () => {
      mock.onPost(url).reply(visionResponse)
      await service.analyzeImage('gpt4o', ['https://a.com/1.jpg'], 'Describe')

      expect(mock.history[0].body).not.toHaveProperty('max_completion_tokens')
    })

    it('throws when deployment is empty', async () => {
      await expect(service.analyzeImage('', ['url'], 'Hi')).rejects.toThrow('Deployment name is required')
    })

    it('throws when imageUrls is empty', async () => {
      await expect(service.analyzeImage('deploy', [], 'Hi')).rejects.toThrow('At least one image URL is required')
    })

    it('throws when prompt is empty', async () => {
      await expect(service.analyzeImage('deploy', ['url'], '')).rejects.toThrow('Prompt is required')
    })
  })

  // ── createEmbeddings ──

  describe('createEmbeddings', () => {
    const url = `${ BASE_V1 }/embeddings`

    const embeddingsResponse = {
      object: 'list',
      data: [{ object: 'embedding', index: 0, embedding: [0.1, 0.2, 0.3] }],
      usage: { prompt_tokens: 5, total_tokens: 5 },
    }

    it('sends correct request with array input', async () => {
      mock.onPost(url).reply(embeddingsResponse)
      const result = await service.createEmbeddings('embed-deploy', ['Hello world'])

      expect(result).toEqual(embeddingsResponse)
      expect(mock.history[0].body).toEqual({
        model: 'embed-deploy',
        input: ['Hello world'],
      })
    })

    it('wraps string input into array', async () => {
      mock.onPost(url).reply(embeddingsResponse)
      await service.createEmbeddings('embed-deploy', 'single text')

      expect(mock.history[0].body.input).toEqual(['single text'])
    })

    it('includes dimensions when provided', async () => {
      mock.onPost(url).reply(embeddingsResponse)
      await service.createEmbeddings('embed-deploy', ['text'], 256)

      expect(mock.history[0].body.dimensions).toBe(256)
    })

    it('omits dimensions when not provided', async () => {
      mock.onPost(url).reply(embeddingsResponse)
      await service.createEmbeddings('embed-deploy', ['text'])

      expect(mock.history[0].body).not.toHaveProperty('dimensions')
    })

    it('throws when deployment is empty', async () => {
      await expect(service.createEmbeddings('', ['text'])).rejects.toThrow('Deployment name is required')
    })

    it('throws when input is empty array', async () => {
      await expect(service.createEmbeddings('deploy', [])).rejects.toThrow('At least one input text is required')
    })
  })

  // ── generateImage ──

  describe('generateImage', () => {
    const url = `${ BASE_V1 }/images/generations`

    it('sends correct request with required params and returns URL from response', async () => {
      mock.onPost(url).reply({
        data: [{ url: 'https://azure.com/generated.png', revised_prompt: 'A nice sunset' }],
        created: 1720000000,
      })

      const result = await service.generateImage('dalle3', 'A sunset')

      expect(result).toEqual({
        images: [{ url: 'https://azure.com/generated.png', revisedPrompt: 'A nice sunset' }],
        created: 1720000000,
      })

      expect(mock.history[0].body).toMatchObject({
        model: 'dalle3',
        prompt: 'A sunset',
        n: 1,
      })
    })

    it('uploads base64 images via flowrunner.Files.uploadFile', async () => {
      mock.onPost(url).reply({
        data: [{ b64_json: Buffer.from('fake-image').toString('base64') }],
        created: 1720000000,
      })

      const result = await service.generateImage('dalle3', 'An image')

      expect(uploadFileMock).toHaveBeenCalledTimes(1)
      expect(uploadFileMock).toHaveBeenCalledWith(
        expect.any(Buffer),
        expect.objectContaining({
          generateUrl: true,
          overwrite: true,
          scope: 'FLOW',
        })
      )
      expect(result.images[0].url).toBe('https://files.example.com/uploaded.png')
    })

    it('maps size dropdown and omits Auto', async () => {
      mock.onPost(url).reply({ data: [], created: 0 })
      await service.generateImage('dalle3', 'Img', 'Auto')

      expect(mock.history[0].body).not.toHaveProperty('size')
    })

    it('includes explicit size value', async () => {
      mock.onPost(url).reply({ data: [], created: 0 })
      await service.generateImage('dalle3', 'Img', '1024x1792')

      expect(mock.history[0].body.size).toBe('1024x1792')
    })

    it('maps quality dropdown values and omits Auto', async () => {
      mock.onPost(url).reply({ data: [], created: 0 })
      await service.generateImage('dalle3', 'Img', null, 'Auto')

      expect(mock.history[0].body).not.toHaveProperty('quality')
    })

    it('includes HD quality', async () => {
      mock.onPost(url).reply({ data: [], created: 0 })
      await service.generateImage('dalle3', 'Img', null, 'HD')

      expect(mock.history[0].body.quality).toBe('hd')
    })

    it('maps style dropdown values', async () => {
      mock.onPost(url).reply({ data: [], created: 0 })
      await service.generateImage('dalle3', 'Img', null, null, 'Natural')

      expect(mock.history[0].body.style).toBe('natural')
    })

    it('includes n parameter', async () => {
      mock.onPost(url).reply({ data: [], created: 0 })
      await service.generateImage('dalle3', 'Img', null, null, null, 3)

      expect(mock.history[0].body.n).toBe(3)
    })

    it('includes usage when present in response', async () => {
      mock.onPost(url).reply({
        data: [],
        created: 0,
        usage: { prompt_tokens: 10, total_tokens: 10 },
      })

      const result = await service.generateImage('dalle3', 'Img')

      expect(result.usage).toEqual({ prompt_tokens: 10, total_tokens: 10 })
    })

    it('throws when deployment is empty', async () => {
      await expect(service.generateImage('', 'Img')).rejects.toThrow('Deployment name is required')
    })

    it('throws when prompt is empty', async () => {
      await expect(service.generateImage('dalle3', '')).rejects.toThrow('Prompt is required')
    })
  })

  // ── transcribeAudio ──

  describe('transcribeAudio', () => {
    const downloadUrl = 'https://files.example.com/audio.mp3'
    const transcribeUrl = `${ BASE_V1 }/audio/transcriptions`

    it('downloads file and sends multipart form data', async () => {
      const audioBuffer = Buffer.from('fake-audio')

      mock.onGet(downloadUrl).reply(audioBuffer)
      mock.onPost(transcribeUrl).reply({ text: 'Hello world' })

      const result = await service.transcribeAudio('whisper', downloadUrl)

      expect(result).toEqual({ text: 'Hello world' })

      // First call: download, second call: transcription
      expect(mock.history).toHaveLength(2)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(downloadUrl)
      expect(mock.history[1].method).toBe('post')
      expect(mock.history[1].url).toBe(transcribeUrl)

      // Check form data
      const formData = mock.history[1].formData
      const fields = formData._fields

      expect(fields).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'file' }),
          expect.objectContaining({ name: 'response_format', value: 'json' }),
          expect.objectContaining({ name: 'model', value: 'whisper' }),
        ])
      )
    })

    it('includes optional language, prompt, and temperature', async () => {
      mock.onGet(downloadUrl).reply(Buffer.from('audio'))
      mock.onPost(transcribeUrl).reply({ text: 'Bonjour' })

      await service.transcribeAudio('whisper', downloadUrl, 'fr', 'Meeting notes', null, 0.3)

      const fields = mock.history[1].formData._fields
      const fieldNames = fields.map(f => f.name)

      expect(fieldNames).toContain('language')
      expect(fieldNames).toContain('prompt')
      expect(fieldNames).toContain('temperature')

      expect(fields.find(f => f.name === 'language').value).toBe('fr')
      expect(fields.find(f => f.name === 'prompt').value).toBe('Meeting notes')
      expect(fields.find(f => f.name === 'temperature').value).toBe('0.3')
    })

    it('maps response format dropdown values', async () => {
      mock.onGet(downloadUrl).reply(Buffer.from('audio'))
      mock.onPost(transcribeUrl).reply({ text: 'Hi' })

      await service.transcribeAudio('whisper', downloadUrl, null, null, 'Verbose JSON')

      const fields = mock.history[1].formData._fields

      expect(fields.find(f => f.name === 'response_format').value).toBe('verbose_json')
    })

    it('wraps string response in text object', async () => {
      mock.onGet(downloadUrl).reply(Buffer.from('audio'))
      mock.onPost(transcribeUrl).reply('Plain text response')

      const result = await service.transcribeAudio('whisper', downloadUrl, null, null, 'Text')

      expect(result).toEqual({ text: 'Plain text response' })
    })

    it('extracts filename from URL', async () => {
      const urlWithPath = 'https://files.example.com/path/to/meeting.mp3'

      mock.onGet(urlWithPath).reply(Buffer.from('audio'))
      mock.onPost(transcribeUrl).reply({ text: 'Hi' })

      await service.transcribeAudio('whisper', urlWithPath)

      const fields = mock.history[1].formData._fields
      const fileField = fields.find(f => f.name === 'file')

      expect(fileField.filename).toMatchObject({ filename: 'meeting.mp3' })
    })

    it('throws when deployment is empty', async () => {
      await expect(service.transcribeAudio('', downloadUrl)).rejects.toThrow('Deployment name is required')
    })

    it('throws when fileUrl is invalid', async () => {
      await expect(service.transcribeAudio('whisper', 'not-a-url')).rejects.toThrow('Invalid fileUrl')
    })
  })

  // ── translateAudio ──

  describe('translateAudio', () => {
    const downloadUrl = 'https://files.example.com/audio.mp3'
    const translateUrl = `${ BASE_V1 }/audio/translations`

    it('sends translation request', async () => {
      mock.onGet(downloadUrl).reply(Buffer.from('audio'))
      mock.onPost(translateUrl).reply({ text: 'Translated text' })

      const result = await service.translateAudio('whisper', downloadUrl)

      expect(result).toEqual({ text: 'Translated text' })
      expect(mock.history[1].url).toBe(translateUrl)
    })

    it('includes optional prompt and temperature', async () => {
      mock.onGet(downloadUrl).reply(Buffer.from('audio'))
      mock.onPost(translateUrl).reply({ text: 'Translated' })

      await service.translateAudio('whisper', downloadUrl, 'Context prompt', 'SRT', 0.5)

      const fields = mock.history[1].formData._fields

      expect(fields.find(f => f.name === 'prompt').value).toBe('Context prompt')
      expect(fields.find(f => f.name === 'response_format').value).toBe('srt')
      expect(fields.find(f => f.name === 'temperature').value).toBe('0.5')
    })
  })

  // ── textToSpeech ──

  describe('textToSpeech', () => {
    const ttsUrl = `${ BASE_V1 }/audio/speech`

    it('sends correct request and uploads result', async () => {
      const audioBuffer = Buffer.from('fake-audio-bytes')

      mock.onPost(ttsUrl).reply(audioBuffer)
      uploadFileMock.mockResolvedValue({ url: 'https://files.example.com/tts.mp3' })

      const result = await service.textToSpeech('tts-deploy', 'Hello world')

      expect(result).toEqual({ fileURL: 'https://files.example.com/tts.mp3' })

      expect(mock.history[0].body).toMatchObject({
        model: 'tts-deploy',
        input: 'Hello world',
        voice: 'alloy',
        response_format: 'mp3',
        speed: 1.0,
      })

      expect(uploadFileMock).toHaveBeenCalledWith(
        expect.any(Buffer),
        expect.objectContaining({
          generateUrl: true,
          overwrite: true,
          scope: 'FLOW',
          filename: expect.stringMatching(/^tts_\d+\.mp3$/),
        })
      )
    })

    it('maps voice dropdown values', async () => {
      mock.onPost(ttsUrl).reply(Buffer.from('audio'))
      await service.textToSpeech('tts', 'Hi', 'Shimmer')

      expect(mock.history[0].body.voice).toBe('shimmer')
    })

    it('maps response format dropdown values', async () => {
      mock.onPost(ttsUrl).reply(Buffer.from('audio'))
      await service.textToSpeech('tts', 'Hi', null, null, 'WAV')

      expect(mock.history[0].body.response_format).toBe('wav')
    })

    it('includes custom speed', async () => {
      mock.onPost(ttsUrl).reply(Buffer.from('audio'))
      await service.textToSpeech('tts', 'Hi', null, 1.5)

      expect(mock.history[0].body.speed).toBe(1.5)
    })

    it('uses binary encoding', async () => {
      mock.onPost(ttsUrl).reply(Buffer.from('audio'))
      await service.textToSpeech('tts', 'Hi')

      expect(mock.history[0].encoding).toBeNull()
    })

    it('throws when deployment is empty', async () => {
      await expect(service.textToSpeech('', 'Hi')).rejects.toThrow('Deployment name is required')
    })

    it('throws when input is empty', async () => {
      await expect(service.textToSpeech('tts', '')).rejects.toThrow('Input text is required')
    })

    it('throws when input exceeds 4096 characters', async () => {
      await expect(service.textToSpeech('tts', 'a'.repeat(4097)))
        .rejects.toThrow('The maximum allowed text length is 4096 characters')
    })
  })

  // ── Legacy API version routing ──

  describe('legacy API version routing', () => {
    let legacySandbox
    let legacyService
    let legacyMock

    beforeAll(() => {
      legacySandbox = createSandbox({
        apiKey: API_KEY,
        endpoint: ENDPOINT,
        apiVersion: '2024-10-21',
      })

      // Re-require would conflict; instead create a new service directly
      // We need to manipulate the global to re-register
      legacySandbox.cleanup()

      legacySandbox = createSandbox({
        apiKey: API_KEY,
        endpoint: ENDPOINT,
        apiVersion: '2024-10-21',
      })

      jest.isolateModules(() => {
        require('../src/index.js')
      })

      legacyService = legacySandbox.getService()
      legacyMock = legacySandbox.getRequestMock()

      legacyService.flowrunner = {
        Files: {
          uploadFile: jest.fn().mockResolvedValue({ url: 'https://files.example.com/file.png' }),
        },
      }
    })

    afterEach(() => {
      legacyMock.reset()
    })

    afterAll(() => {
      legacySandbox.cleanup()
    })

    it('uses deployment-based URL with api-version query param', async () => {
      const legacyUrl = `${ ENDPOINT }/openai/deployments/my-gpt4o/chat/completions`

      legacyMock.onPost(legacyUrl).reply({
        choices: [{ message: { content: 'Hi' }, finish_reason: 'stop' }],
        usage: {},
      })

      await legacyService.askAI('my-gpt4o', 'Hello')

      expect(legacyMock.history[0].url).toBe(legacyUrl)
      expect(legacyMock.history[0].query).toMatchObject({ 'api-version': '2024-10-21' })
    })

    it('does not inject model into body for legacy routing', async () => {
      const legacyUrl = `${ ENDPOINT }/openai/deployments/deploy/chat/completions`

      legacyMock.onPost(legacyUrl).reply({
        choices: [{ message: { content: 'Hi' }, finish_reason: 'stop' }],
        usage: {},
      })

      await legacyService.askAI('deploy', 'Hello')

      expect(legacyMock.history[0].body).not.toHaveProperty('model')
    })
  })

  // ── Endpoint validation ──

  describe('endpoint validation', () => {
    let badSandbox
    let badService
    let badMock

    beforeAll(() => {
      badSandbox = createSandbox({
        apiKey: API_KEY,
        endpoint: 'not-a-url',
        apiVersion: 'v1',
      })

      jest.isolateModules(() => {
        require('../src/index.js')
      })

      badService = badSandbox.getService()
      badMock = badSandbox.getRequestMock()
    })

    afterAll(() => {
      badSandbox.cleanup()
    })

    it('throws when endpoint is not a valid URL', async () => {
      await expect(badService.askAI('deploy', 'Hi'))
        .rejects.toThrow("Invalid Azure OpenAI endpoint 'not-a-url'")
    })
  })
})
