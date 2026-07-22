'use strict'

const { EventEmitter } = require('events')
const crypto = require('crypto')

jest.mock('https')
jest.mock('http')

const https = require('https')
const http = require('http')

const { createSandbox } = require('../../../service-sandbox')

const {
  httpRequest,
  parseXmlTag,
  parseXmlTags,
  stsAssumeRole,
  buildAwsJsonRequest,
  parseJsonResponse,
  jsonRequest,
} = require('../src/aws-client')

const { CredentialProvider } = require('../src/credentials')
const { createLogger, mapAwsError } = require('../src/errors')
const { signRequest, generatePresignedUrl } = require('../src/sigv4')

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

      mockDeps.parseJsonResponse.mockImplementation(() => {
        throw err 
      })

      await expect(service.converse('bad-model', 'Hello')).rejects.toThrow('Model or resource not found')
    })

    it('handles AccessDeniedException', async () => {
      const err = new Error('Not authorized')

      err.name = 'AccessDeniedException'

      mockDeps.parseJsonResponse.mockImplementation(() => {
        throw err 
      })

      await expect(service.converse('model-id', 'Hello')).rejects.toThrow('Access denied')
    })

    it('handles ValidationException', async () => {
      const err = new Error('Invalid params')

      err.name = 'ValidationException'

      mockDeps.parseJsonResponse.mockImplementation(() => {
        throw err 
      })

      await expect(service.converse('model-id', 'Hello')).rejects.toThrow('Invalid request')
    })

    it('handles ThrottlingException', async () => {
      const err = new Error('Rate exceeded')

      err.name = 'ThrottlingException'

      mockDeps.parseJsonResponse.mockImplementation(() => {
        throw err 
      })

      await expect(service.converse('model-id', 'Hello')).rejects.toThrow('Request throttled')
    })

    it('handles ModelTimeoutException', async () => {
      const err = new Error('Timed out')

      err.name = 'ModelTimeoutException'

      mockDeps.parseJsonResponse.mockImplementation(() => {
        throw err 
      })

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

      mockDeps.parseJsonResponse.mockImplementation(() => {
        throw err 
      })

      await expect(service.converse('model-id', 'Hello')).rejects.toThrow('Request throttled')
    })

    it('maps ModelNotReadyException to model unavailable error', async () => {
      const err = new Error('Not ready')

      err.name = 'ModelNotReadyException'

      mockDeps.parseJsonResponse.mockImplementation(() => {
        throw err 
      })

      await expect(service.converse('model-id', 'Hello')).rejects.toThrow('Model unavailable')
    })

    it('falls through to mapAwsError for unknown errors', async () => {
      const err = new Error('Something weird')

      err.name = 'SomeUnknownException'

      mockDeps.parseJsonResponse.mockImplementation(() => {
        throw err 
      })

      await expect(service.converse('model-id', 'Hello')).rejects.toThrow('Something weird')
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Helper modules — aws-client.js / credentials.js / errors.js / sigv4.js
// ─────────────────────────────────────────────────────────────────────────────

const HELPER_CREDS = { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'SECRETEXAMPLE' }

// Drives the mocked node http(s) module with a canned response (or a transport error).
function stubHttps({ statusCode = 200, body = '', error = null, resError = null, transport = https } = {}) {
  const captured = { options: null, written: [], timeout: null, destroyed: null }

  transport.request.mockImplementation((options, callback) => {
    captured.options = options

    const req = new EventEmitter()

    req.write = chunk => captured.written.push(chunk)

    req.setTimeout = (ms, handler) => {
      captured.timeout = { ms, handler }
    }

    req.destroy = err => {
      captured.destroyed = err
    }

    req.end = () => {
      process.nextTick(() => {
        if (error) {
          req.emit('error', error)

          return
        }

        const res = new EventEmitter()

        res.statusCode = statusCode
        res.headers = { 'content-type': 'text/xml' }

        callback(res)

        if (resError) {
          res.emit('error', resError)

          return
        }

        res.emit('data', Buffer.from(body))
        res.emit('end')
      })
    }

    return req
  })

  return captured
}

// ── aws-client: XML helpers ──

describe('aws-client XML helpers', () => {
  it('extracts the first matching tag', () => {
    expect(parseXmlTag('<a><b>one</b><b>two</b></a>', 'b')).toBe('one')
  })

  it('returns null when the tag is absent', () => {
    expect(parseXmlTag('<a/>', 'b')).toBeNull()
  })

  it('extracts all matching tags including multi-line values', () => {
    expect(parseXmlTags('<a><b>one</b><b>two\nlines</b></a>', 'b')).toEqual(['one', 'two\nlines'])
  })

  it('returns an empty array when nothing matches', () => {
    expect(parseXmlTags('<a/>', 'b')).toEqual([])
  })
})

// ── aws-client: request building and response parsing ──

describe('buildAwsJsonRequest', () => {
  it('builds an AWS JSON request with a target header', () => {
    expect(buildAwsJsonRequest({
      region: 'eu-west-1',
      service: 'bedrock',
      target: 'Target.Operation',
      body: { Limit: 1 },
      contentType: 'application/x-amz-json-1.1',
    })).toEqual({
      method: 'POST',
      url: 'https://bedrock.eu-west-1.amazonaws.com/',
      headers: {
        'content-type': 'application/x-amz-json-1.1',
        'x-amz-target': 'Target.Operation',
      },
      body: '{"Limit":1}',
    })
  })

  it('passes a string body through and omits the target header', () => {
    const built = buildAwsJsonRequest({
      region: 'us-east-1',
      service: 'bedrock',
      body: '{"a":1}',
      contentType: 'application/json',
    })

    expect(built.body).toBe('{"a":1}')
    expect(built.headers).not.toHaveProperty('x-amz-target')
  })

  it('serializes a missing body as an empty object', () => {
    expect(buildAwsJsonRequest({
      region: 'us-east-1',
      service: 'bedrock',
      contentType: 'application/json',
    }).body).toBe('{}')
  })
})

describe('parseJsonResponse', () => {
  it('parses a successful JSON body', () => {
    expect(parseJsonResponse({ statusCode: 200, body: '{"a":1}' })).toEqual({ a: 1 })
  })

  it('returns an empty object for an empty or missing body', () => {
    expect(parseJsonResponse({ statusCode: 200, body: '  ' })).toEqual({})
    expect(parseJsonResponse({ statusCode: 200 })).toEqual({})
  })

  it('throws a named error built from __type for an error status', () => {
    try {
      parseJsonResponse({
        statusCode: 400,
        body: '{"__type":"com.amazon.coral.service#ValidationException","message":"bad input"}',
      })

      throw new Error('should have thrown')
    } catch (error) {
      expect(error.name).toBe('ValidationException')
      expect(error.message).toBe('bad input')
      expect(error.statusCode).toBe(400)
    }
  })

  it('uses the code field and the capitalized Message field', () => {
    try {
      parseJsonResponse({ statusCode: 403, body: '{"code":"AccessDenied","Message":"nope"}' })

      throw new Error('should have thrown')
    } catch (error) {
      expect(error.name).toBe('AccessDenied')
      expect(error.message).toBe('nope')
    }
  })

  it('falls back to a generic name and message', () => {
    try {
      parseJsonResponse({ statusCode: 500, body: '{}' })

      throw new Error('should have thrown')
    } catch (error) {
      expect(error.name).toBe('AwsError')
      expect(error.message).toBe('Request failed with status 500')
    }
  })
})

describe('jsonRequest with an injected transport', () => {
  it('signs the built request and parses the response', async () => {
    const sign = jest.fn()
    const send = jest.fn().mockResolvedValue({ statusCode: 200, body: '{"Ok":true}' })

    const result = await jsonRequest(
      {
        region: 'us-east-1',
        service: 'bedrock',
        target: 'Target.Operation',
        body: { a: 1 },
        contentType: 'application/x-amz-json-1.1',
      },
      HELPER_CREDS,
      { signRequest: sign, httpRequest: send }
    )

    expect(result).toEqual({ Ok: true })

    expect(sign).toHaveBeenCalledWith(
      'POST',
      'https://bedrock.us-east-1.amazonaws.com/',
      { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': 'Target.Operation' },
      '{"a":1}',
      HELPER_CREDS,
      'us-east-1',
      'bedrock'
    )

    expect(send).toHaveBeenCalledWith(
      'POST',
      'https://bedrock.us-east-1.amazonaws.com/',
      expect.objectContaining({ 'content-type': 'application/x-amz-json-1.1' }),
      '{"a":1}'
    )
  })

  it('propagates the error thrown for an error status', async () => {
    const send = jest.fn().mockResolvedValue({
      statusCode: 400,
      body: '{"__type":"ValidationException","message":"bad"}',
    })

    await expect(
      jsonRequest(
        { region: 'us-east-1', service: 'bedrock', contentType: 'application/json' },
        HELPER_CREDS,
        { signRequest: jest.fn(), httpRequest: send }
      )
    ).rejects.toMatchObject({ name: 'ValidationException', message: 'bad', statusCode: 400 })
  })
})

// ── aws-client: low level HTTP transport ──

describe('httpRequest', () => {
  afterEach(() => {
    https.request.mockReset()
    http.request.mockReset()
  })

  it('sends the body, sets content-length and resolves with the response', async () => {
    const captured = stubHttps({ statusCode: 200, body: '{"ok":true}' })

    const response = await httpRequest(
      'POST',
      'https://bedrock.us-east-1.amazonaws.com/path?a=1',
      { 'content-type': 'application/json' },
      'hello'
    )

    expect(captured.options).toMatchObject({
      hostname: 'bedrock.us-east-1.amazonaws.com',
      port: 443,
      path: '/path?a=1',
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': 5 },
    })

    expect(captured.written).toEqual(['hello'])

    expect(response).toEqual({
      statusCode: 200,
      headers: { 'content-type': 'text/xml' },
      body: '{"ok":true}',
    })
  })

  it('omits content-length and writes nothing when there is no body', async () => {
    const captured = stubHttps({ statusCode: 204, body: '' })

    await httpRequest('GET', 'https://bedrock.us-east-1.amazonaws.com/', {})

    expect(captured.options.headers).not.toHaveProperty('content-length')
    expect(captured.written).toEqual([])
  })

  it('uses the plain http transport and port 80 for http URLs', async () => {
    const captured = stubHttps({ statusCode: 200, body: 'ok', transport: http })

    await httpRequest('GET', 'http://localhost/ping', {})

    expect(https.request).not.toHaveBeenCalled()
    expect(captured.options).toMatchObject({ port: 80, hostname: 'localhost', path: '/ping' })
  })

  it('keeps an explicit port from the URL', async () => {
    const captured = stubHttps({ statusCode: 200, body: 'ok' })

    await httpRequest('GET', 'https://localhost:4566/', {})

    expect(captured.options.port).toBe('4566')
  })

  it('rejects on a transport error', async () => {
    stubHttps({ error: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }) })

    await expect(httpRequest('GET', 'https://bedrock.us-east-1.amazonaws.com/', {})).rejects.toThrow(
      'connect ECONNREFUSED'
    )
  })

  it('rejects when the response stream errors', async () => {
    stubHttps({ statusCode: 200, resError: new Error('stream broke') })

    await expect(httpRequest('GET', 'https://bedrock.us-east-1.amazonaws.com/', {})).rejects.toThrow(
      'stream broke'
    )
  })

  it('registers a 30s timeout that destroys the request', async () => {
    const captured = stubHttps({ statusCode: 200, body: '' })

    await httpRequest('GET', 'https://bedrock.us-east-1.amazonaws.com/', {})

    expect(captured.timeout.ms).toBe(30000)

    captured.timeout.handler()

    expect(captured.destroyed).toBeInstanceOf(Error)
    expect(captured.destroyed.message).toBe('Request timed out')
  })
})

// ── aws-client: STS AssumeRole ──

describe('stsAssumeRole', () => {
  const OK_BODY =
    '<AssumeRoleResponse><AssumeRoleResult><Credentials>' +
    '<AccessKeyId>ASIA123</AccessKeyId>' +
    '<SecretAccessKey>secret123</SecretAccessKey>' +
    '<SessionToken>token123</SessionToken>' +
    '<Expiration>2030-01-01T00:00:00Z</Expiration>' +
    '</Credentials></AssumeRoleResult></AssumeRoleResponse>'

  afterEach(() => {
    https.request.mockReset()
  })

  it('signs the STS call and returns the temporary credentials', async () => {
    const captured = stubHttps({ statusCode: 200, body: OK_BODY })

    const result = await stsAssumeRole(HELPER_CREDS, 'eu-west-1', 'arn:aws:iam::1:role/R', 'session-1', 'ext-1')

    expect(captured.options.hostname).toBe('sts.eu-west-1.amazonaws.com')

    expect(captured.written[0]).toBe(
      'Action=AssumeRole&Version=2011-06-15' +
      '&RoleArn=arn%3Aaws%3Aiam%3A%3A1%3Arole%2FR' +
      '&RoleSessionName=session-1' +
      '&ExternalId=ext-1'
    )

    expect(captured.options.headers).toMatchObject({
      'content-type': 'application/x-www-form-urlencoded',
      host: 'sts.eu-west-1.amazonaws.com',
    })

    expect(captured.options.headers.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/eu-west-1\/sts\/aws4_request, SignedHeaders=[a-z0-9;-]+, Signature=[0-9a-f]{64}$/
    )

    expect(result).toEqual({
      accessKeyId: 'ASIA123',
      secretAccessKey: 'secret123',
      sessionToken: 'token123',
      expiration: new Date('2030-01-01T00:00:00Z'),
    })
  })

  it('omits the external id when it is not provided', async () => {
    const captured = stubHttps({ statusCode: 200, body: OK_BODY })

    await stsAssumeRole(HELPER_CREDS, 'us-east-1', 'arn:role', 'session-2')

    expect(captured.written[0]).not.toContain('ExternalId')
  })

  it('throws a named error when STS rejects the request', async () => {
    stubHttps({
      statusCode: 403,
      body: '<ErrorResponse><Error><Code>AccessDenied</Code><Message>Not authorized to assume role</Message></Error></ErrorResponse>',
    })

    await expect(stsAssumeRole(HELPER_CREDS, 'us-east-1', 'arn:role', 'session')).rejects.toMatchObject({
      name: 'AccessDenied',
      message: 'Not authorized to assume role',
      statusCode: 403,
    })
  })

  it('falls back to a generic STS error when the body has no code or message', async () => {
    stubHttps({ statusCode: 500, body: '<html/>' })

    await expect(stsAssumeRole(HELPER_CREDS, 'us-east-1', 'arn:role', 'session')).rejects.toMatchObject({
      name: 'STSError',
      message: 'STS AssumeRole failed',
      statusCode: 500,
    })
  })

  it('throws a parse error when credential fields are missing', async () => {
    stubHttps({ statusCode: 200, body: '<AssumeRoleResponse/>' })

    await expect(stsAssumeRole(HELPER_CREDS, 'us-east-1', 'arn:role', 'session')).rejects.toMatchObject({
      name: 'STSParseError',
      message: 'Failed to parse STS AssumeRole response: missing credential fields',
    })
  })

  it('propagates transport errors', async () => {
    stubHttps({ error: new Error('socket hang up') })

    await expect(stsAssumeRole(HELPER_CREDS, 'us-east-1', 'arn:role', 'session')).rejects.toThrow('socket hang up')
  })
})

// ── credentials.js ──

describe('CredentialProvider', () => {
  it('applies the documented defaults', () => {
    const provider = new CredentialProvider()

    expect(provider.authenticationMethod).toBe('API Key')
    expect(provider.region).toBe('us-east-1')
  })

  it('returns the static API key credentials', async () => {
    const provider = new CredentialProvider({ accessKeyId: 'AK', secretAccessKey: 'SK', region: 'eu-west-1' })

    await expect(provider.resolve()).resolves.toEqual({ accessKeyId: 'AK', secretAccessKey: 'SK' })
  })

  it('requires both keys for API key authentication', async () => {
    await expect(new CredentialProvider({ accessKeyId: 'AK' }).resolve()).rejects.toThrow(
      'Access Key and Secret Key are required for API Key authentication.'
    )

    await expect(new CredentialProvider({ secretAccessKey: 'SK' }).resolve()).rejects.toThrow(
      /API Key authentication/
    )
  })

  it('assumes the configured role, caches the result and refreshes past the expiry buffer', async () => {
    let now = 1000000

    const stsAssumeRoleSpy = jest.fn().mockImplementation(() => Promise.resolve({
      accessKeyId: 'ASIA',
      secretAccessKey: 'S',
      sessionToken: 'T',
      expiration: new Date(now + 3600000),
    }))

    const provider = new CredentialProvider(
      {
        authenticationMethod: 'IAM Role',
        accessKeyId: 'AK',
        secretAccessKey: 'SK',
        region: 'eu-west-1',
        roleArn: 'arn:role',
        externalId: 'ext',
      },
      { stsAssumeRole: stsAssumeRoleSpy, now: () => now }
    )

    const first = await provider.resolve()

    expect(first).toEqual({ accessKeyId: 'ASIA', secretAccessKey: 'S', sessionToken: 'T' })

    expect(stsAssumeRoleSpy).toHaveBeenCalledWith(
      { accessKeyId: 'AK', secretAccessKey: 'SK' },
      'eu-west-1',
      'arn:role',
      `flowrunner-bedrock-${ now }`,
      'ext'
    )

    // Well inside the 5 minute expiry buffer — served from the cache.
    now += 3000000

    await expect(provider.resolve()).resolves.toBe(first)
    expect(stsAssumeRoleSpy).toHaveBeenCalledTimes(1)

    // Inside the buffer window — the credentials are refreshed.
    now += 400000

    await provider.resolve()
    expect(stsAssumeRoleSpy).toHaveBeenCalledTimes(2)
  })

  it('requires a role ARN and static keys for role authentication', async () => {
    await expect(
      new CredentialProvider({ authenticationMethod: 'IAM Role', accessKeyId: 'AK', secretAccessKey: 'SK' }).resolve()
    ).rejects.toThrow('IAM Role ARN is required for IAM Role authentication.')

    await expect(
      new CredentialProvider({ authenticationMethod: 'IAM Role', roleArn: 'arn:role' }).resolve()
    ).rejects.toThrow('Access Key and Secret Key are required to assume an IAM Role.')

    await expect(
      new CredentialProvider({ authenticationMethod: 'IAM Role', roleArn: 'arn:role', accessKeyId: 'AK' }).resolve()
    ).rejects.toThrow('Access Key and Secret Key are required to assume an IAM Role.')
  })

  it('defaults to the real stsAssumeRole implementation', async () => {
    https.request.mockReset()

    stubHttps({
      statusCode: 403,
      body: '<ErrorResponse><Error><Code>AccessDenied</Code><Message>denied</Message></Error></ErrorResponse>',
    })

    const provider = new CredentialProvider({
      authenticationMethod: 'IAM Role',
      accessKeyId: 'AK',
      secretAccessKey: 'SK',
      roleArn: 'arn:role',
    })

    await expect(provider.resolve()).rejects.toMatchObject({ name: 'AccessDenied' })

    https.request.mockReset()
  })
})

// ── errors.js ──

describe('createLogger', () => {
  it('prefixes every level with the service name', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {})
    const logger = createLogger('AWS Bedrock')

    spy.mockClear()

    logger.info('a')
    logger.debug('b')
    logger.warn('c')
    logger.error('d')

    expect(spy.mock.calls).toEqual([
      ['[AWS Bedrock Service]', 'info:', 'a'],
      ['[AWS Bedrock Service]', 'debug:', 'b'],
      ['[AWS Bedrock Service]', 'warn:', 'c'],
      ['[AWS Bedrock Service]', 'error:', 'd'],
    ])

    spy.mockRestore()
  })
})

describe('mapAwsError', () => {
  function mapped(name, message, extra = {}) {
    return mapAwsError(Object.assign(new Error(message), { name }, extra))
  }

  it('maps throttling errors', () => {
    expect(mapped('ThrottlingException', 'Rate exceeded').message).toMatch(/throttled by AWS: Rate exceeded/)
    expect(mapped('Throttling', 'x').message).toMatch(/throttled by AWS/)
    expect(mapped('ProvisionedThroughputExceededException', 'x').message).toMatch(/throttled by AWS/)
  })

  it('maps credential errors, including by message content', () => {
    expect(mapped('InvalidSignatureException', 'bad sig').message).toMatch(/Invalid AWS credentials: bad sig/)
    expect(mapped('UnrecognizedClientException', 'x').message).toMatch(/Invalid AWS credentials/)
    expect(mapped('InvalidClientTokenId', 'x').message).toMatch(/Invalid AWS credentials/)
    expect(mapped('SomethingElse', 'The security credential is invalid').message).toMatch(/Invalid AWS credentials/)
  })

  it('maps access denied errors', () => {
    expect(mapped('AccessDeniedException', 'nope').message).toMatch(/Access denied: nope/)
    expect(mapped('AccessDenied', 'nope').message).toMatch(/Access denied/)
  })

  it('maps connectivity errors', () => {
    expect(mapped('Error', 'Request timed out').message).toMatch(/Connection to AWS failed/)
    expect(mapped('Error', 'boom', { code: 'ECONNREFUSED' }).message).toMatch(/Connection to AWS failed/)
    expect(mapped('Error', 'boom', { code: 'ENOTFOUND' }).message).toMatch(/Connection to AWS failed/)
    expect(mapped('Error', 'boom', { code: 'ETIMEDOUT' }).message).toMatch(/Connection to AWS failed/)
  })

  it('passes unknown errors through with the original as the cause', () => {
    const original = new Error('something odd')
    const result = mapAwsError(original)

    expect(result.message).toBe('something odd')
    expect(result.cause).toBe(original)
  })

  it('handles an error without a name or message', () => {
    expect(mapAwsError({}).message).toBe('Unknown error')
  })
})

// ── sigv4.js ──
//
// The expected signatures below are computed by `referenceSignature`, an
// implementation written directly from the AWS Signature Version 4 specification
// (Create a canonical request → Create a string to sign → Calculate the signature)
// rather than copied from src/sigv4.js, so the assertions independently verify the
// service implementation. The clock is frozen so every signature is deterministic —
// no assertion depends on the live clock.

const FIXED_ISO = '2015-08-30T12:36:00.000Z'
const FIXED_AMZ_DATE = '20150830T123600Z'
const FIXED_DATE_STAMP = '20150830'

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function hmac(key, value) {
  return crypto.createHmac('sha256', key).update(value).digest()
}

/**
 * Independent SigV4 reference for requests whose path needs no escaping and whose
 * header names are already lowercase (every case asserted below).
 */
function referenceSignature({ method, url, headers, body, credentials, region, service }) {
  const parsed = new URL(url)
  const payloadHash = sha256Hex(body || '')

  const canonicalHeaderMap = { ...headers, host: parsed.host, 'x-amz-date': FIXED_AMZ_DATE, 'x-amz-content-sha256': payloadHash }

  if (credentials.sessionToken) {
    canonicalHeaderMap['x-amz-security-token'] = credentials.sessionToken
  }

  const names = Object.keys(canonicalHeaderMap).sort()
  const canonicalHeaders = names.map(name => `${ name }:${ String(canonicalHeaderMap[name]).trim() }\n`).join('')
  const signedHeaders = names.join(';')

  const query = [...parsed.searchParams.entries()]
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) : a[0] < b[0] ? -1 : 1))
    .map(pair => pair.map(part => encodeURIComponent(part)).join('='))
    .join('&')

  const canonicalRequest = [
    method,
    decodeURIComponent(parsed.pathname),
    query,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n')

  const scope = `${ FIXED_DATE_STAMP }/${ region }/${ service }/aws4_request`

  const stringToSign = ['AWS4-HMAC-SHA256', FIXED_AMZ_DATE, scope, sha256Hex(canonicalRequest)].join('\n')

  const signingKey = [FIXED_DATE_STAMP, region, service, 'aws4_request']
    .reduce((key, part) => hmac(key, part), 'AWS4' + credentials.secretAccessKey)

  const signature = hmac(signingKey, stringToSign).toString('hex')

  return {
    signature,
    signedHeaders,
    scope,
    payloadHash,
    authorization: `AWS4-HMAC-SHA256 Credential=${ credentials.accessKeyId }/${ scope }, ` +
      `SignedHeaders=${ signedHeaders }, ` +
      `Signature=${ signature }`,
  }
}

describe('sigv4 signRequest', () => {
  beforeAll(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] })
    jest.setSystemTime(new Date(FIXED_ISO))
  })

  afterAll(() => {
    jest.useRealTimers()
  })

  const URL_ROOT = 'https://bedrock.us-east-1.amazonaws.com/'

  function sign(overrides = {}) {
    const args = {
      method: 'POST',
      url: URL_ROOT,
      headers: { 'content-type': 'application/x-amz-json-1.1' },
      body: '{"Name":"value"}',
      credentials: HELPER_CREDS,
      region: 'us-east-1',
      service: 'bedrock',
      ...overrides,
    }

    // Snapshot the caller-supplied headers before signRequest mutates them so the
    // reference implementation starts from the same input.
    const inputHeaders = { ...args.headers }

    signRequest(args.method, args.url, args.headers, args.body, args.credentials, args.region, args.service)

    return { headers: args.headers, expected: referenceSignature({ ...args, headers: inputHeaders }) }
  }

  it('matches an independently derived signature and scope', () => {
    const { headers, expected } = sign()

    expect(headers['x-amz-date']).toBe(FIXED_AMZ_DATE)
    expect(headers['host']).toBe('bedrock.us-east-1.amazonaws.com')
    expect(headers['x-amz-content-sha256']).toBe(sha256Hex('{"Name":"value"}'))
    expect(expected.scope).toBe(`${ FIXED_DATE_STAMP }/us-east-1/bedrock/aws4_request`)

    expect(headers['authorization']).toBe(expected.authorization)

    expect(headers['authorization']).toMatch(
      new RegExp(
        '^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/' + FIXED_DATE_STAMP + '/us-east-1/bedrock/aws4_request, ' +
        'SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, ' +
        'Signature=[0-9a-f]{64}$'
      )
    )
  })

  it('signs headers in lowercase alphabetical order', () => {
    const { headers } = sign({
      headers: { 'x-amz-target': 'T.Op', 'content-type': 'application/x-amz-json-1.1', accept: 'application/json' },
    })

    expect(headers['authorization']).toContain(
      'SignedHeaders=accept;content-type;host;x-amz-content-sha256;x-amz-date;x-amz-target'
    )
  })

  it('is stable for identical input and sensitive to body, secret, region and service', () => {
    const baseline = sign().headers['authorization']

    expect(sign().headers['authorization']).toBe(baseline)
    expect(sign({ body: '{"Name":"other"}' }).headers['authorization']).not.toBe(baseline)
    expect(sign({ credentials: { ...HELPER_CREDS, secretAccessKey: 'OTHER' } }).headers['authorization']).not.toBe(baseline)
    expect(sign({ region: 'eu-west-1' }).headers['authorization']).not.toBe(baseline)
    expect(sign({ service: 'sts' }).headers['authorization']).not.toBe(baseline)
    expect(sign({ method: 'GET' }).headers['authorization']).not.toBe(baseline)
  })

  it('hashes an empty payload when no body is given', () => {
    const { headers, expected } = sign({ body: '' })

    expect(headers['x-amz-content-sha256']).toBe(sha256Hex(''))
    expect(headers['authorization']).toBe(expected.authorization)

    const undefinedBody = sign({ body: undefined })

    expect(undefinedBody.headers['x-amz-content-sha256']).toBe(sha256Hex(''))
  })

  it('signs the session token for temporary credentials', () => {
    const { headers, expected } = sign({ credentials: { ...HELPER_CREDS, sessionToken: 'SESSION' } })

    expect(headers['x-amz-security-token']).toBe('SESSION')

    expect(headers['authorization']).toContain(
      'SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date;x-amz-security-token'
    )

    expect(headers['authorization']).toBe(expected.authorization)
  })

  it('keeps an explicitly provided host header and includes a non-standard port', () => {
    const explicit = sign({ headers: { Host: 'custom.example.com' } }).headers

    expect(explicit['host']).toBeUndefined()
    expect(explicit['Host']).toBe('custom.example.com')

    const ported = sign({ url: 'https://localhost:4566/' })

    expect(ported.headers['host']).toBe('localhost:4566')
    expect(ported.headers['authorization']).toBe(ported.expected.authorization)
  })

  it('canonicalizes a multi-segment path and sorts the query string', () => {
    const withPath = sign({
      method: 'GET',
      body: '',
      url: 'https://bedrock.us-east-1.amazonaws.com/model/anthropic.claude-v2/invoke?b=2&a=1',
    })

    expect(withPath.headers['authorization']).toBe(withPath.expected.authorization)

    const reordered = sign({
      method: 'GET',
      body: '',
      url: 'https://bedrock.us-east-1.amazonaws.com/model/anthropic.claude-v2/invoke?a=1&b=2',
    })

    // Query parameter ordering must not change the signature.
    expect(reordered.headers['authorization']).toBe(withPath.headers['authorization'])
  })

  it('sorts repeated query keys by value', () => {
    const ascending = sign({ method: 'GET', body: '', url: `${ URL_ROOT }?a=1&a=0` })
    const descending = sign({ method: 'GET', body: '', url: `${ URL_ROOT }?a=0&a=1` })

    expect(ascending.headers['authorization']).toBe(ascending.expected.authorization)
    expect(ascending.headers['authorization']).toBe(descending.headers['authorization'])
  })

  it('percent-encodes spaces and multi-byte characters in the path', () => {
    const headers = {}

    signRequest(
      'GET',
      'https://s3.us-east-1.amazonaws.com/my bucket/café.txt',
      headers,
      '',
      HELPER_CREDS,
      'us-east-1',
      's3'
    )

    expect(headers['authorization']).toMatch(/Signature=[0-9a-f]{64}$/)

    // %20 for the space and the UTF-8 bytes for é must both feed the canonical URI.
    const spacey = {}
    const plussed = {}

    signRequest('GET', 'https://s3.us-east-1.amazonaws.com/my bucket/a', spacey, '', HELPER_CREDS, 'us-east-1', 's3')
    signRequest('GET', 'https://s3.us-east-1.amazonaws.com/my+bucket/a', plussed, '', HELPER_CREDS, 'us-east-1', 's3')

    expect(spacey['authorization']).not.toBe(plussed['authorization'])
  })

  it('returns the same headers object it mutated', () => {
    const headers = {}

    expect(signRequest('GET', URL_ROOT, headers, '', HELPER_CREDS, 'us-east-1', 'bedrock')).toBe(headers)
  })
})

describe('sigv4 generatePresignedUrl', () => {
  beforeAll(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] })
    jest.setSystemTime(new Date(FIXED_ISO))
  })

  afterAll(() => {
    jest.useRealTimers()
  })

  /** Independent reference for the query-string (presigned) SigV4 variant. */
  function referencePresignedSignature(method, rawUrl, credentials, region, service, expiresIn) {
    const parsed = new URL(rawUrl)

    parsed.searchParams.set('X-Amz-Algorithm', 'AWS4-HMAC-SHA256')
    parsed.searchParams.set('X-Amz-Credential', `${ credentials.accessKeyId }/${ FIXED_DATE_STAMP }/${ region }/${ service }/aws4_request`)
    parsed.searchParams.set('X-Amz-Date', FIXED_AMZ_DATE)
    parsed.searchParams.set('X-Amz-Expires', String(expiresIn))
    parsed.searchParams.set('X-Amz-SignedHeaders', 'host')

    if (credentials.sessionToken) {
      parsed.searchParams.set('X-Amz-Security-Token', credentials.sessionToken)
    }

    const query = [...parsed.searchParams.entries()]
      .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) : a[0] < b[0] ? -1 : 1))
      .map(([key, value]) => `${ encodeURIComponent(key) }=${ encodeURIComponent(value) }`)
      .join('&')

    const canonicalRequest = [
      method,
      decodeURIComponent(parsed.pathname),
      query,
      `host:${ parsed.host }\n`,
      'host',
      'UNSIGNED-PAYLOAD',
    ].join('\n')

    const scope = `${ FIXED_DATE_STAMP }/${ region }/${ service }/aws4_request`
    const stringToSign = ['AWS4-HMAC-SHA256', FIXED_AMZ_DATE, scope, sha256Hex(canonicalRequest)].join('\n')

    const signingKey = [FIXED_DATE_STAMP, region, service, 'aws4_request']
      .reduce((key, part) => hmac(key, part), 'AWS4' + credentials.secretAccessKey)

    return hmac(signingKey, stringToSign).toString('hex')
  }

  it('adds every SigV4 query parameter and an independently derived signature', () => {
    const raw = 'https://bucket.s3.us-east-1.amazonaws.com/key.txt'
    const url = new URL(generatePresignedUrl('GET', raw, HELPER_CREDS, 'us-east-1', 's3', 900))

    expect(url.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256')
    expect(url.searchParams.get('X-Amz-Credential')).toBe(`AKIDEXAMPLE/${ FIXED_DATE_STAMP }/us-east-1/s3/aws4_request`)
    expect(url.searchParams.get('X-Amz-Date')).toBe(FIXED_AMZ_DATE)
    expect(url.searchParams.get('X-Amz-Expires')).toBe('900')
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('host')
    expect(url.searchParams.get('X-Amz-Security-Token')).toBeNull()

    expect(url.searchParams.get('X-Amz-Signature')).toBe(
      referencePresignedSignature('GET', raw, HELPER_CREDS, 'us-east-1', 's3', 900)
    )
  })

  it('includes the session token and reacts to a non-standard port', () => {
    const creds = { ...HELPER_CREDS, sessionToken: 'SESSION' }
    const raw = 'https://localhost:4566/bucket/key'
    const url = new URL(generatePresignedUrl('PUT', raw, creds, 'us-east-1', 's3', 60))

    expect(url.searchParams.get('X-Amz-Security-Token')).toBe('SESSION')

    expect(url.searchParams.get('X-Amz-Signature')).toBe(
      referencePresignedSignature('PUT', raw, creds, 'us-east-1', 's3', 60)
    )
  })

  it('sorts repeated query keys by value', () => {
    const raw = 'https://b.s3.amazonaws.com/k?x=2&x=1'
    const url = new URL(generatePresignedUrl('GET', raw, HELPER_CREDS, 'us-east-1', 's3', 60))

    expect(url.searchParams.get('X-Amz-Signature')).toBe(
      referencePresignedSignature('GET', raw, HELPER_CREDS, 'us-east-1', 's3', 60)
    )
  })

  it('is stable for identical input and sensitive to the expiry window', () => {
    const first = generatePresignedUrl('GET', 'https://b.s3.amazonaws.com/k', HELPER_CREDS, 'us-east-1', 's3', 60)
    const second = generatePresignedUrl('GET', 'https://b.s3.amazonaws.com/k', HELPER_CREDS, 'us-east-1', 's3', 60)

    expect(first).toBe(second)

    expect(generatePresignedUrl('GET', 'https://b.s3.amazonaws.com/k', HELPER_CREDS, 'us-east-1', 's3', 120)).not.toBe(first)
  })
})

// ── Remaining error paths on the service methods ──

describe('AwsBedrock error propagation', () => {
  let instance

  beforeEach(() => {
    const { AwsBedrock } = require('../src/index.js')

    instance = new AwsBedrock({
      authenticationMethod: 'API Key',
      accessKeyId: ACCESS_KEY,
      secretAccessKey: SECRET_KEY,
      region: REGION,
    })

    instance.deps = {
      signRequest: jest.fn(),
      httpRequest: jest.fn().mockRejectedValue(
        Object.assign(new Error('nope'), { name: 'AccessDeniedException' })
      ),
      parseJsonResponse: jest.fn(),
    }
  })

  it.each([
    ['invokeModel', c => c.invokeModel('model-id', { prompt: 'hi' })],
    ['listFoundationModels', c => c.listFoundationModels()],
    ['getFoundationModel', c => c.getFoundationModel('model-id')],
    ['getModelsDictionary', c => c.getModelsDictionary({})],
  ])('maps errors raised by %s', async (_name, invoke) => {
    await expect(invoke(instance)).rejects.toThrow('Access denied: nope')
  })
})
