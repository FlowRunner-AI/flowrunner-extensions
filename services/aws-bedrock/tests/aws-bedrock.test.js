'use strict'

const { createSandbox } = require('../../../service-sandbox')

const ACCESS_KEY = 'AKIAIOSFODNN7EXAMPLE'
const SECRET_KEY = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'
const REGION = 'us-east-1'

const RUNTIME_HOST = `bedrock-runtime.${ REGION }.amazonaws.com`
const CONTROL_HOST = `bedrock.${ REGION }.amazonaws.com`

describe('AWS Bedrock Service', () => {
  let sandbox
  let service
  let mockDeps

  beforeAll(() => {
    sandbox = createSandbox({
      authenticationMethod: 'API Key',
      accessKeyId: ACCESS_KEY,
      secretAccessKey: SECRET_KEY,
      region: REGION,
    })

    require('../src/index.js')
    service = sandbox.getService()
  })

  beforeEach(() => {
    mockDeps = {
      signRequest: jest.fn(),
      httpRequest: jest.fn(),
      parseJsonResponse: jest.fn(),
    }

    service.deps = mockDeps
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Registration ──

  describe('service registration', () => {
    it('registers with correct config items', () => {
      const items = sandbox.getConfigItems()

      expect(items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'authenticationMethod', required: true, shared: false, type: 'CHOICE' }),
          expect.objectContaining({ name: 'region', required: true, shared: false, type: 'STRING' }),
          expect.objectContaining({ name: 'accessKeyId', required: false, shared: false, type: 'STRING' }),
          expect.objectContaining({ name: 'secretAccessKey', required: false, shared: false, type: 'STRING' }),
          expect.objectContaining({ name: 'roleArn', required: false, shared: false, type: 'STRING' }),
          expect.objectContaining({ name: 'externalId', required: false, shared: false, type: 'STRING' }),
        ])
      )
    })

    it('has 6 config items total', () => {
      expect(sandbox.getConfigItems()).toHaveLength(6)
    })
  })

  // ── Converse ──

  describe('converse', () => {
    const converseResponse = {
      statusCode: 200,
      body: JSON.stringify({
        output: {
          message: {
            role: 'assistant',
            content: [{ text: 'Hello! How can I help?' }],
          },
        },
        stopReason: 'end_turn',
        usage: { inputTokens: 10, outputTokens: 8, totalTokens: 18 },
        metrics: { latencyMs: 500 },
      }),
    }

    beforeEach(() => {
      mockDeps.httpRequest.mockResolvedValue(converseResponse)
      mockDeps.parseJsonResponse.mockReturnValue({
        output: {
          message: {
            role: 'assistant',
            content: [{ text: 'Hello! How can I help?' }],
          },
        },
        stopReason: 'end_turn',
        usage: { inputTokens: 10, outputTokens: 8, totalTokens: 18 },
        metrics: { latencyMs: 500 },
      })
    })

    it('sends correct request with a simple prompt', async () => {
      const result = await service.converse('anthropic.claude-3-5-sonnet-20241022-v2:0', 'Hello')

      expect(mockDeps.httpRequest).toHaveBeenCalledTimes(1)

      const [method, url, headers, body] = mockDeps.httpRequest.mock.calls[0]

      expect(method).toBe('POST')
      expect(url).toContain(`https://${ RUNTIME_HOST }/model/`)
      expect(url).toContain('/converse')

      const parsedBody = JSON.parse(body)

      expect(parsedBody.messages).toEqual([
        { role: 'user', content: [{ text: 'Hello' }] },
      ])

      expect(result).toEqual({
        message: { role: 'assistant', content: [{ text: 'Hello! How can I help?' }] },
        text: 'Hello! How can I help?',
        stopReason: 'end_turn',
        usage: { inputTokens: 10, outputTokens: 8, totalTokens: 18 },
        metrics: { latencyMs: 500 },
      })
    })

    it('uses messages array when provided, ignoring prompt', async () => {
      const messages = [
        { role: 'user', content: [{ text: 'Hi' }] },
        { role: 'assistant', content: [{ text: 'Hello' }] },
        { role: 'user', content: [{ text: 'How are you?' }] },
      ]

      await service.converse('model-id', 'ignored prompt', messages)

      const parsedBody = JSON.parse(mockDeps.httpRequest.mock.calls[0][3])

      expect(parsedBody.messages).toEqual(messages)
    })

    it('includes system instruction when provided', async () => {
      await service.converse('model-id', 'Hello', null, 'You are helpful.')

      const parsedBody = JSON.parse(mockDeps.httpRequest.mock.calls[0][3])

      expect(parsedBody.system).toEqual([{ text: 'You are helpful.' }])
    })

    it('includes inferenceConfig when provided', async () => {
      const inferenceConfig = { maxTokens: 500, temperature: 0.7 }

      await service.converse('model-id', 'Hello', null, null, inferenceConfig)

      const parsedBody = JSON.parse(mockDeps.httpRequest.mock.calls[0][3])

      expect(parsedBody.inferenceConfig).toEqual(inferenceConfig)
    })

    it('includes toolConfig when provided', async () => {
      const toolConfig = { tools: [{ name: 'calculator' }] }

      await service.converse('model-id', 'Hello', null, null, null, toolConfig)

      const parsedBody = JSON.parse(mockDeps.httpRequest.mock.calls[0][3])

      expect(parsedBody.toolConfig).toEqual(toolConfig)
    })

    it('includes additionalModelRequestFields when provided', async () => {
      const additionalFields = { top_k: 200 }

      await service.converse('model-id', 'Hello', null, null, null, null, additionalFields)

      const parsedBody = JSON.parse(mockDeps.httpRequest.mock.calls[0][3])

      expect(parsedBody.additionalModelRequestFields).toEqual(additionalFields)
    })

    it('omits optional fields when not provided', async () => {
      await service.converse('model-id', 'Hello')

      const parsedBody = JSON.parse(mockDeps.httpRequest.mock.calls[0][3])

      expect(parsedBody).not.toHaveProperty('system')
      expect(parsedBody).not.toHaveProperty('inferenceConfig')
      expect(parsedBody).not.toHaveProperty('toolConfig')
      expect(parsedBody).not.toHaveProperty('additionalModelRequestFields')
    })

    it('throws when modelId is missing', async () => {
      await expect(service.converse(null, 'Hello')).rejects.toThrow('modelId is required.')
    })

    it('throws when neither prompt nor messages is provided', async () => {
      await expect(service.converse('model-id')).rejects.toThrow('Provide either messages or a prompt.')
    })

    it('calls signRequest with correct region and service', async () => {
      await service.converse('model-id', 'Hello')

      expect(mockDeps.signRequest).toHaveBeenCalledTimes(1)

      const [method, url, headers, body, creds, region, sigService] = mockDeps.signRequest.mock.calls[0]

      expect(method).toBe('POST')
      expect(region).toBe(REGION)
      expect(sigService).toBe('bedrock')
    })

    it('handles ResourceNotFoundException', async () => {
      const err = new Error('Model not found')

      err.name = 'ResourceNotFoundException'
      mockDeps.parseJsonResponse.mockImplementation(() => { throw err })

      await expect(service.converse('bad-model', 'Hello')).rejects.toThrow('Model or resource not found')
    })

    it('handles AccessDeniedException', async () => {
      const err = new Error('Not authorized')

      err.name = 'AccessDeniedException'
      mockDeps.parseJsonResponse.mockImplementation(() => { throw err })

      await expect(service.converse('model-id', 'Hello')).rejects.toThrow('Access denied')
    })

    it('handles ValidationException', async () => {
      const err = new Error('Invalid params')

      err.name = 'ValidationException'
      mockDeps.parseJsonResponse.mockImplementation(() => { throw err })

      await expect(service.converse('model-id', 'Hello')).rejects.toThrow('Invalid request')
    })

    it('handles ThrottlingException', async () => {
      const err = new Error('Rate exceeded')

      err.name = 'ThrottlingException'
      mockDeps.parseJsonResponse.mockImplementation(() => { throw err })

      await expect(service.converse('model-id', 'Hello')).rejects.toThrow('Request throttled')
    })

    it('handles ModelTimeoutException', async () => {
      const err = new Error('Timed out')

      err.name = 'ModelTimeoutException'
      mockDeps.parseJsonResponse.mockImplementation(() => { throw err })

      await expect(service.converse('model-id', 'Hello')).rejects.toThrow('Model unavailable')
    })

    it('extracts text from multiple content blocks', async () => {
      mockDeps.parseJsonResponse.mockReturnValue({
        output: {
          message: {
            role: 'assistant',
            content: [{ text: 'Part 1' }, { text: ' Part 2' }],
          },
        },
        stopReason: 'end_turn',
        usage: null,
        metrics: null,
      })

      const result = await service.converse('model-id', 'Hello')

      expect(result.text).toBe('Part 1 Part 2')
    })

    it('returns null text when output has no message', async () => {
      mockDeps.parseJsonResponse.mockReturnValue({
        output: {},
        stopReason: 'end_turn',
      })

      const result = await service.converse('model-id', 'Hello')

      expect(result.message).toBeNull()
      expect(result.text).toBeNull()
    })
  })

  // ── Invoke Model ──

  describe('invokeModel', () => {
    it('sends correct request with required params', async () => {
      const responseBody = { outputText: 'Hello, world!' }

      mockDeps.httpRequest.mockResolvedValue({ statusCode: 200, body: JSON.stringify(responseBody) })
      mockDeps.parseJsonResponse.mockReturnValue(responseBody)

      const result = await service.invokeModel('amazon.titan-text-express-v1', { inputText: 'Hello' })

      expect(mockDeps.httpRequest).toHaveBeenCalledTimes(1)

      const [method, url, headers, body] = mockDeps.httpRequest.mock.calls[0]

      expect(method).toBe('POST')
      expect(url).toContain(`https://${ RUNTIME_HOST }/model/`)
      expect(url).toContain('/invoke')

      const parsedBody = JSON.parse(body)

      expect(parsedBody).toEqual({ inputText: 'Hello' })
      expect(result).toEqual({ body: responseBody })
    })

    it('passes custom contentType and accept headers', async () => {
      mockDeps.httpRequest.mockResolvedValue({ statusCode: 200, body: '{}' })
      mockDeps.parseJsonResponse.mockReturnValue({})

      await service.invokeModel('model-id', { data: true }, 'application/json', 'application/json')

      const headers = mockDeps.httpRequest.mock.calls[0][2]

      expect(headers['content-type']).toBe('application/json')
      expect(headers.accept).toBe('application/json')
    })

    it('throws when modelId is missing', async () => {
      await expect(service.invokeModel(null, { data: true })).rejects.toThrow('modelId is required.')
    })

    it('throws when body is missing', async () => {
      await expect(service.invokeModel('model-id')).rejects.toThrow('body (plain JSON object) is required.')
    })

    it('throws when body is not an object', async () => {
      await expect(service.invokeModel('model-id', 'string-body')).rejects.toThrow('body (plain JSON object) is required.')
    })
  })

  // ── Generate Image ──

  describe('generateImage', () => {
    const mockUploadFile = jest.fn()

    beforeEach(() => {
      mockUploadFile.mockReset()
      mockUploadFile.mockResolvedValue({ url: 'https://files.flowrunner.io/test.png' })

      service.flowrunner = {
        Files: { uploadFile: mockUploadFile },
      }
    })

    it('generates image with Titan model and default settings', async () => {
      const base64Image = Buffer.from('fake-png-data').toString('base64')

      mockDeps.httpRequest.mockResolvedValue({ statusCode: 200, body: JSON.stringify({ images: [base64Image] }) })
      mockDeps.parseJsonResponse.mockReturnValue({ images: [base64Image] })

      const result = await service.generateImage(undefined, 'A sunset over mountains')

      const [method, url] = mockDeps.httpRequest.mock.calls[0]

      expect(method).toBe('POST')
      expect(url).toContain('amazon.titan-image-generator-v2')
      expect(url).toContain('/invoke')

      const parsedBody = JSON.parse(mockDeps.httpRequest.mock.calls[0][3])

      expect(parsedBody.taskType).toBe('TEXT_IMAGE')
      expect(parsedBody.textToImageParams.text).toBe('A sunset over mountains')
      expect(parsedBody.imageGenerationConfig).toMatchObject({ numberOfImages: 1, width: 1024, height: 1024 })

      expect(mockUploadFile).toHaveBeenCalledTimes(1)
      expect(result).toMatchObject({
        url: 'https://files.flowrunner.io/test.png',
        modelId: 'amazon.titan-image-generator-v2:0',
      })
      expect(result.filename).toMatch(/^bedrock_image_\d+\.png$/)
    })

    it('builds Titan body with negative prompt, dimensions, and seed', async () => {
      const base64Image = Buffer.from('fake-png').toString('base64')

      mockDeps.httpRequest.mockResolvedValue({ statusCode: 200, body: '{}' })
      mockDeps.parseJsonResponse.mockReturnValue({ images: [base64Image] })

      await service.generateImage('Amazon Titan Image Generator v2', 'A cat', 'No dogs', 512, 512, 42)

      const parsedBody = JSON.parse(mockDeps.httpRequest.mock.calls[0][3])

      expect(parsedBody.textToImageParams).toEqual({ text: 'A cat', negativeText: 'No dogs' })
      expect(parsedBody.imageGenerationConfig).toEqual({ numberOfImages: 1, width: 512, height: 512, seed: 42 })
    })

    it('builds Stability body for Stable Diffusion model', async () => {
      const base64Image = Buffer.from('fake-png').toString('base64')

      mockDeps.httpRequest.mockResolvedValue({ statusCode: 200, body: '{}' })
      mockDeps.parseJsonResponse.mockReturnValue({ artifacts: [{ base64: base64Image }] })

      await service.generateImage('Stability Stable Diffusion XL v1', 'A dragon')

      const [, url] = mockDeps.httpRequest.mock.calls[0]

      expect(url).toContain('stability.stable-diffusion-xl-v1')

      const parsedBody = JSON.parse(mockDeps.httpRequest.mock.calls[0][3])

      expect(parsedBody.text_prompts).toEqual([{ text: 'A dragon', weight: 1 }])
      expect(parsedBody).not.toHaveProperty('taskType')
    })

    it('builds Stability body with negative prompt and seed', async () => {
      const base64Image = Buffer.from('fake-png').toString('base64')

      mockDeps.httpRequest.mockResolvedValue({ statusCode: 200, body: '{}' })
      mockDeps.parseJsonResponse.mockReturnValue({ artifacts: [{ base64: base64Image }] })

      await service.generateImage('Stability Stable Diffusion XL v1', 'A dragon', 'No fire', null, null, 99)

      const parsedBody = JSON.parse(mockDeps.httpRequest.mock.calls[0][3])

      expect(parsedBody.text_prompts).toEqual([
        { text: 'A dragon', weight: 1 },
        { text: 'No fire', weight: -1 },
      ])
      expect(parsedBody.seed).toBe(99)
    })

    it('passes file options to uploadFile', async () => {
      const base64Image = Buffer.from('fake').toString('base64')

      mockDeps.httpRequest.mockResolvedValue({ statusCode: 200, body: '{}' })
      mockDeps.parseJsonResponse.mockReturnValue({ images: [base64Image] })

      await service.generateImage(undefined, 'A tree', null, null, null, null, { scope: 'WORKSPACE' })

      const uploadCall = mockUploadFile.mock.calls[0]

      expect(uploadCall[1]).toMatchObject({ scope: 'WORKSPACE', generateUrl: true, overwrite: true })
    })

    it('uses FLOW scope by default when no fileOptions provided', async () => {
      const base64Image = Buffer.from('fake').toString('base64')

      mockDeps.httpRequest.mockResolvedValue({ statusCode: 200, body: '{}' })
      mockDeps.parseJsonResponse.mockReturnValue({ images: [base64Image] })

      await service.generateImage(undefined, 'A tree')

      const uploadCall = mockUploadFile.mock.calls[0]

      expect(uploadCall[1]).toMatchObject({ scope: 'FLOW' })
    })

    it('throws when prompt is missing', async () => {
      await expect(service.generateImage(undefined, null)).rejects.toThrow('prompt is required.')
    })

    it('throws when model response has no image', async () => {
      mockDeps.httpRequest.mockResolvedValue({ statusCode: 200, body: '{}' })
      mockDeps.parseJsonResponse.mockReturnValue({})

      await expect(service.generateImage(undefined, 'A tree')).rejects.toThrow('The model response did not contain an image')
    })

    it('extracts image from "image" field (single string format)', async () => {
      const base64Image = Buffer.from('single-image').toString('base64')

      mockDeps.httpRequest.mockResolvedValue({ statusCode: 200, body: '{}' })
      mockDeps.parseJsonResponse.mockReturnValue({ image: base64Image })

      const result = await service.generateImage(undefined, 'A tree')

      expect(result.url).toBe('https://files.flowrunner.io/test.png')
    })

    it('resolves Stability Stable Image Core model ID', async () => {
      const base64Image = Buffer.from('fake').toString('base64')

      mockDeps.httpRequest.mockResolvedValue({ statusCode: 200, body: '{}' })
      mockDeps.parseJsonResponse.mockReturnValue({ artifacts: [{ base64: base64Image }] })

      const result = await service.generateImage('Stability Stable Image Core', 'A cat')

      expect(result.modelId).toBe('stability.stable-image-core-v1:0')
    })

    it('resolves Stability Stable Image Ultra model ID', async () => {
      const base64Image = Buffer.from('fake').toString('base64')

      mockDeps.httpRequest.mockResolvedValue({ statusCode: 200, body: '{}' })
      mockDeps.parseJsonResponse.mockReturnValue({ artifacts: [{ base64: base64Image }] })

      const result = await service.generateImage('Stability Stable Image Ultra', 'A cat')

      expect(result.modelId).toBe('stability.stable-image-ultra-v1:0')
    })
  })

  // ── List Foundation Models ──

  describe('listFoundationModels', () => {
    const modelSummaries = [
      {
        modelId: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
        modelName: 'Claude 3.5 Sonnet v2',
        providerName: 'Anthropic',
        inputModalities: ['TEXT', 'IMAGE'],
        outputModalities: ['TEXT'],
      },
      {
        modelId: 'amazon.titan-text-express-v1',
        modelName: 'Titan Text G1 - Express',
        providerName: 'Amazon',
        inputModalities: ['TEXT'],
        outputModalities: ['TEXT'],
      },
    ]

    beforeEach(() => {
      mockDeps.httpRequest.mockResolvedValue({ statusCode: 200, body: JSON.stringify({ modelSummaries }) })
      mockDeps.parseJsonResponse.mockReturnValue({ modelSummaries })
    })

    it('sends GET to control plane with no filters', async () => {
      const result = await service.listFoundationModels()

      const [method, url] = mockDeps.httpRequest.mock.calls[0]

      expect(method).toBe('GET')
      expect(url).toContain(`https://${ CONTROL_HOST }/foundation-models`)
      expect(result.count).toBe(2)
      expect(result.models).toHaveLength(2)
      expect(result.models[0]).toEqual({
        modelId: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
        modelName: 'Claude 3.5 Sonnet v2',
        providerName: 'Anthropic',
        inputModalities: ['TEXT', 'IMAGE'],
        outputModalities: ['TEXT'],
      })
    })

    it('includes byProvider filter in query', async () => {
      await service.listFoundationModels('Anthropic')

      const url = mockDeps.httpRequest.mock.calls[0][1]

      expect(url).toContain('byProvider=Anthropic')
    })

    it('resolves and includes byOutputModality filter', async () => {
      await service.listFoundationModels(null, 'Text')

      const url = mockDeps.httpRequest.mock.calls[0][1]

      expect(url).toContain('byOutputModality=TEXT')
    })

    it('resolves Image modality', async () => {
      await service.listFoundationModels(null, 'Image')

      const url = mockDeps.httpRequest.mock.calls[0][1]

      expect(url).toContain('byOutputModality=IMAGE')
    })

    it('resolves Embedding modality', async () => {
      await service.listFoundationModels(null, 'Embedding')

      const url = mockDeps.httpRequest.mock.calls[0][1]

      expect(url).toContain('byOutputModality=EMBEDDING')
    })

    it('handles empty modelSummaries', async () => {
      mockDeps.parseJsonResponse.mockReturnValue({ modelSummaries: [] })

      const result = await service.listFoundationModels()

      expect(result.models).toEqual([])
      expect(result.count).toBe(0)
    })

    it('handles missing modelSummaries in response', async () => {
      mockDeps.parseJsonResponse.mockReturnValue({})

      const result = await service.listFoundationModels()

      expect(result.models).toEqual([])
      expect(result.count).toBe(0)
    })
  })

  // ── Get Foundation Model ──

  describe('getFoundationModel', () => {
    it('sends GET request with model ID in path', async () => {
      const modelDetails = {
        modelId: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
        modelName: 'Claude 3.5 Sonnet v2',
        providerName: 'Anthropic',
      }

      mockDeps.httpRequest.mockResolvedValue({ statusCode: 200, body: JSON.stringify({ modelDetails }) })
      mockDeps.parseJsonResponse.mockReturnValue({ modelDetails })

      const result = await service.getFoundationModel('anthropic.claude-3-5-sonnet-20241022-v2:0')

      const [method, url] = mockDeps.httpRequest.mock.calls[0]

      expect(method).toBe('GET')
      expect(url).toContain(`https://${ CONTROL_HOST }/foundation-models/`)
      expect(result.model).toEqual(modelDetails)
    })

    it('returns null model when modelDetails is missing', async () => {
      mockDeps.httpRequest.mockResolvedValue({ statusCode: 200, body: '{}' })
      mockDeps.parseJsonResponse.mockReturnValue({})

      const result = await service.getFoundationModel('model-id')

      expect(result.model).toBeNull()
    })

    it('throws when modelId is missing', async () => {
      await expect(service.getFoundationModel(null)).rejects.toThrow('modelId is required.')
    })
  })

  // ── Dictionary ──

  describe('getModelsDictionary', () => {
    const modelSummaries = [
      { modelId: 'anthropic.claude-3-5-sonnet-20241022-v2:0', modelName: 'Claude 3.5 Sonnet v2', providerName: 'Anthropic' },
      { modelId: 'amazon.titan-text-express-v1', modelName: 'Titan Text G1 - Express', providerName: 'Amazon' },
      { modelId: 'meta.llama3-70b-instruct-v1:0', modelName: 'Llama 3 70B Instruct', providerName: 'Meta' },
    ]

    beforeEach(() => {
      mockDeps.httpRequest.mockResolvedValue({ statusCode: 200, body: JSON.stringify({ modelSummaries }) })
      mockDeps.parseJsonResponse.mockReturnValue({ modelSummaries })
    })

    it('returns all models as dictionary items', async () => {
      const result = await service.getModelsDictionary()

      expect(result.items).toHaveLength(3)
      expect(result.cursor).toBeNull()
      expect(result.items[0]).toEqual({
        label: 'Claude 3.5 Sonnet v2',
        value: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
        note: 'Anthropic',
      })
    })

    it('filters by search string (model name)', async () => {
      const result = await service.getModelsDictionary({ search: 'claude' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('anthropic.claude-3-5-sonnet-20241022-v2:0')
    })

    it('filters by search string (provider name)', async () => {
      const result = await service.getModelsDictionary({ search: 'meta' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('meta.llama3-70b-instruct-v1:0')
    })

    it('filters by search string (model ID)', async () => {
      const result = await service.getModelsDictionary({ search: 'titan' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('amazon.titan-text-express-v1')
    })

    it('returns empty items when search matches nothing', async () => {
      const result = await service.getModelsDictionary({ search: 'nonexistent' })

      expect(result.items).toEqual([])
    })

    it('handles null payload', async () => {
      const result = await service.getModelsDictionary(null)

      expect(result.items).toHaveLength(3)
    })

    it('uses modelId as label when modelName is missing', async () => {
      mockDeps.parseJsonResponse.mockReturnValue({
        modelSummaries: [{ modelId: 'some-model', providerName: 'SomeProvider' }],
      })

      const result = await service.getModelsDictionary()

      expect(result.items[0].label).toBe('some-model')
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('maps ServiceQuotaExceededException to throttled error', async () => {
      const err = new Error('Quota exceeded')

      err.name = 'ServiceQuotaExceededException'
      mockDeps.parseJsonResponse.mockImplementation(() => { throw err })

      await expect(service.converse('model-id', 'Hello')).rejects.toThrow('Request throttled')
    })

    it('maps ModelNotReadyException to model unavailable error', async () => {
      const err = new Error('Not ready')

      err.name = 'ModelNotReadyException'
      mockDeps.parseJsonResponse.mockImplementation(() => { throw err })

      await expect(service.converse('model-id', 'Hello')).rejects.toThrow('Model unavailable')
    })

    it('falls through to mapAwsError for unknown errors', async () => {
      const err = new Error('Something weird')

      err.name = 'SomeUnknownException'
      mockDeps.parseJsonResponse.mockImplementation(() => { throw err })

      await expect(service.converse('model-id', 'Hello')).rejects.toThrow('Something weird')
    })
  })
})
