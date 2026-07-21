'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-openai-api-key'
const BASE = 'https://api.openai.com/v1'

describe('AI Image Generator Service', () => {
  let sandbox
  let service
  let mock
  let uploadFileMock

  beforeAll(() => {
    sandbox = createSandbox({ openAIAPIKey: API_KEY })
    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()

    // Mock the flowrunner.Files API that the runtime normally provides
    uploadFileMock = jest.fn().mockResolvedValue({ url: 'https://files.example.com/test-image.png' })
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
        expect.objectContaining({
          name: 'openAIAPIKey',
          required: true,
          shared: false,
          type: 'STRING',
        }),
      ])
    })
  })

  // ── generateImage ──

  describe('generateImage', () => {
    const generationsUrl = `${ BASE }/images/generations`

    it('sends correct request with required params only (dall-e-3)', async () => {
      mock.onPost(generationsUrl).reply({
        data: [{ b64_json: Buffer.from('fake-image-data').toString('base64') }],
      })

      const result = await service.generateImage('A sunset over mountains', 'dall-e-3')

      expect(result).toHaveProperty('fileURLs')
      expect(result.fileURLs).toHaveLength(1)
      expect(result.fileURLs[0]).toBe('https://files.example.com/test-image.png')

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].headers).toMatchObject({
        Authorization: `Bearer ${ API_KEY }`,
        'Content-Type': 'application/json',
      })
      expect(mock.history[0].body).toMatchObject({
        prompt: 'A sunset over mountains',
        model: 'dall-e-3',
        response_format: 'b64_json',
      })
    })

    it('does not include response_format for gpt-image-1', async () => {
      mock.onPost(generationsUrl).reply({
        data: [{ b64_json: Buffer.from('fake-image-data').toString('base64') }],
      })

      await service.generateImage('A sunset', 'gpt-image-1')

      expect(mock.history[0].body).not.toHaveProperty('response_format')
      expect(mock.history[0].body).toMatchObject({
        prompt: 'A sunset',
        model: 'gpt-image-1',
      })
    })

    it('includes response_format b64_json for dall-e-2', async () => {
      mock.onPost(generationsUrl).reply({
        data: [{ b64_json: Buffer.from('fake').toString('base64') }],
      })

      await service.generateImage('A cat', 'dall-e-2')

      expect(mock.history[0].body).toMatchObject({
        response_format: 'b64_json',
      })
    })

    it('includes optional size, quality, and numberOfImages', async () => {
      mock.onPost(generationsUrl).reply({
        data: [{ b64_json: Buffer.from('img1').toString('base64') }],
      })

      await service.generateImage('A dog', 'dall-e-3', '1024x1792', 2, 'hd')

      expect(mock.history[0].body).toMatchObject({
        prompt: 'A dog',
        model: 'dall-e-3',
        size: '1024x1792',
        quality: 'hd',
        n: 2,
        response_format: 'b64_json',
      })
    })

    it('includes model settings for gpt-image-1', async () => {
      mock.onPost(generationsUrl).reply({
        data: [{ b64_json: Buffer.from('img').toString('base64') }],
      })

      await service.generateImage('A landscape', 'gpt-image-1', null, null, null, {
        moderation: 'strict',
        background: 'transparent',
        output_compression: '80',
        output_format: 'png',
      })

      expect(mock.history[0].body).toMatchObject({
        prompt: 'A landscape',
        model: 'gpt-image-1',
        moderation: 'strict',
        background: 'transparent',
        output_compression: '80',
        output_format: 'png',
      })
    })

    it('omits falsy model settings', async () => {
      mock.onPost(generationsUrl).reply({
        data: [{ b64_json: Buffer.from('img').toString('base64') }],
      })

      await service.generateImage('A tree', 'dall-e-3', null, null, null, {})

      const body = mock.history[0].body

      expect(body).not.toHaveProperty('moderation')
      expect(body).not.toHaveProperty('background')
      expect(body).not.toHaveProperty('output_compression')
      expect(body).not.toHaveProperty('output_format')
    })

    it('does not include n when numberOfImages is not a positive number', async () => {
      mock.onPost(generationsUrl).reply({
        data: [{ b64_json: Buffer.from('img').toString('base64') }],
      })

      await service.generateImage('A flower', 'dall-e-3', null, 0)

      expect(mock.history[0].body).not.toHaveProperty('n')
    })

    it('uploads each image via flowrunner.Files.uploadFile', async () => {
      uploadFileMock
        .mockResolvedValueOnce({ url: 'https://files.example.com/img1.png' })
        .mockResolvedValueOnce({ url: 'https://files.example.com/img2.png' })

      mock.onPost(generationsUrl).reply({
        data: [
          { b64_json: Buffer.from('image-1').toString('base64') },
          { b64_json: Buffer.from('image-2').toString('base64') },
        ],
      })

      const result = await service.generateImage('Two images', 'dall-e-3', null, 2)

      expect(uploadFileMock).toHaveBeenCalledTimes(2)
      expect(result.fileURLs).toEqual([
        'https://files.example.com/img1.png',
        'https://files.example.com/img2.png',
      ])
    })

    it('passes fileOptions to uploadFile when provided', async () => {
      mock.onPost(generationsUrl).reply({
        data: [{ b64_json: Buffer.from('img').toString('base64') }],
      })

      await service.generateImage('An image', 'dall-e-3', null, null, null, null, { scope: 'APP' })

      expect(uploadFileMock).toHaveBeenCalledWith(
        expect.any(Buffer),
        expect.objectContaining({
          scope: 'APP',
          generateUrl: true,
          filename: expect.stringMatching(/\.png$/),
        })
      )
    })

    it('uses default scope FLOW when fileOptions is not provided', async () => {
      mock.onPost(generationsUrl).reply({
        data: [{ b64_json: Buffer.from('img').toString('base64') }],
      })

      await service.generateImage('An image', 'dall-e-3')

      expect(uploadFileMock).toHaveBeenCalledWith(
        expect.any(Buffer),
        expect.objectContaining({
          scope: 'FLOW',
          generateUrl: true,
        })
      )
    })

    it('skips items without b64_json', async () => {
      mock.onPost(generationsUrl).reply({
        data: [
          { b64_json: Buffer.from('valid').toString('base64') },
          { url: 'https://example.com/skip-this.png' },
        ],
      })

      const result = await service.generateImage('Mixed response', 'dall-e-3')

      expect(uploadFileMock).toHaveBeenCalledTimes(1)
      expect(result.fileURLs).toHaveLength(1)
    })

    // ── Validation errors ──

    it('throws when prompt is empty', async () => {
      await expect(service.generateImage('', 'dall-e-3'))
        .rejects.toThrow('The "prompt" parameter is required and must be a non-empty string.')
    })

    it('throws when prompt is whitespace only', async () => {
      await expect(service.generateImage('   ', 'dall-e-3'))
        .rejects.toThrow('The "prompt" parameter is required and must be a non-empty string.')
    })

    it('throws when prompt is null', async () => {
      await expect(service.generateImage(null, 'dall-e-3'))
        .rejects.toThrow('The "prompt" parameter is required and must be a non-empty string.')
    })

    it('throws when model is invalid', async () => {
      await expect(service.generateImage('A valid prompt', 'invalid-model'))
        .rejects.toThrow('You must select a valid model to perform prompt length validation.')
    })

    it('throws when prompt exceeds model limit for dall-e-2 (1000 chars)', async () => {
      const longPrompt = 'a'.repeat(1001)

      await expect(service.generateImage(longPrompt, 'dall-e-2'))
        .rejects.toThrow('The prompt exceeds the maximum allowed length of 1000 characters for model "dall-e-2".')
    })

    it('throws when prompt exceeds model limit for dall-e-3 (4000 chars)', async () => {
      const longPrompt = 'a'.repeat(4001)

      await expect(service.generateImage(longPrompt, 'dall-e-3'))
        .rejects.toThrow('The prompt exceeds the maximum allowed length of 4000 characters for model "dall-e-3".')
    })

    it('throws when prompt exceeds model limit for gpt-image-1 (32000 chars)', async () => {
      const longPrompt = 'a'.repeat(32001)

      await expect(service.generateImage(longPrompt, 'gpt-image-1'))
        .rejects.toThrow('The prompt exceeds the maximum allowed length of 32000 characters for model "gpt-image-1".')
    })

    it('throws when API response has no data array', async () => {
      mock.onPost(generationsUrl).reply({ result: 'unexpected' })

      await expect(service.generateImage('A prompt', 'dall-e-3'))
        .rejects.toThrow('Unexpected API response format: missing data array.')
    })

    it('throws on API error', async () => {
      mock.onPost(generationsUrl).replyWithError({
        message: 'Unauthorized',
      })

      await expect(service.generateImage('A prompt', 'dall-e-3')).rejects.toThrow()
    })

    it('normalizes structured API error with type and message', async () => {
      mock.onPost(generationsUrl).replyWithError({
        message: {
          error: {
            type: 'invalid_request_error',
            message: 'Invalid prompt',
          },
        },
      })

      await expect(service.generateImage('A prompt', 'dall-e-3'))
        .rejects.toThrow('[invalid_request_error] Invalid prompt')
    })
  })

  // ── Dictionaries ──

  describe('getSizeOptionsDictionary', () => {
    it('returns size options for gpt-image-1', async () => {
      const result = await service.getSizeOptionsDictionary({ criteria: { model: 'gpt-image-1' } })

      expect(result.items).toEqual([
        { label: '1024x1024', value: '1024x1024' },
        { label: '1024x1536', value: '1024x1536' },
        { label: 'auto', value: 'auto' },
      ])
    })

    it('returns size options for dall-e-2', async () => {
      const result = await service.getSizeOptionsDictionary({ criteria: { model: 'dall-e-2' } })

      expect(result.items).toEqual([
        { label: '256x256', value: '256x256' },
        { label: '512x512', value: '512x512' },
        { label: '1024x1024', value: '1024x1024' },
      ])
    })

    it('returns size options for dall-e-3', async () => {
      const result = await service.getSizeOptionsDictionary({ criteria: { model: 'dall-e-3' } })

      expect(result.items).toEqual([
        { label: '1024x1024', value: '1024x1024' },
        { label: '1792x1024', value: '1792x1024' },
        { label: '1024x1792', value: '1024x1792' },
      ])
    })

    it('returns empty items for unknown model', async () => {
      const result = await service.getSizeOptionsDictionary({ criteria: { model: 'unknown' } })

      expect(result.items).toEqual([])
    })
  })

  describe('getQualityOptionsDictionary', () => {
    it('returns quality options for gpt-image-1', async () => {
      const result = await service.getQualityOptionsDictionary({ criteria: { model: 'gpt-image-1' } })

      expect(result.items).toEqual([
        { label: 'auto', value: 'auto' },
        { label: 'high', value: 'high' },
        { label: 'medium', value: 'medium' },
        { label: 'low', value: 'low' },
      ])
    })

    it('returns quality options for dall-e-2', async () => {
      const result = await service.getQualityOptionsDictionary({ criteria: { model: 'dall-e-2' } })

      expect(result.items).toEqual([
        { label: 'standard', value: 'standard' },
      ])
    })

    it('returns quality options for dall-e-3', async () => {
      const result = await service.getQualityOptionsDictionary({ criteria: { model: 'dall-e-3' } })

      expect(result.items).toEqual([
        { label: 'hd', value: 'hd' },
        { label: 'standard', value: 'standard' },
      ])
    })

    it('returns empty items for unknown model', async () => {
      const result = await service.getQualityOptionsDictionary({ criteria: { model: 'unknown' } })

      expect(result.items).toEqual([])
    })
  })

  // ── Schema Loaders ──

  describe('createModelSettingsSchemaLoader', () => {
    it('returns schema fields for gpt-image-1', async () => {
      const result = await service.createModelSettingsSchemaLoader({ criteria: { model: 'gpt-image-1' } })

      expect(result).toHaveLength(4)
      expect(result[0]).toMatchObject({ name: 'moderation', type: 'String' })
      expect(result[1]).toMatchObject({ name: 'background', type: 'String' })
      expect(result[2]).toMatchObject({ name: 'output_compression', type: 'String' })
      expect(result[3]).toMatchObject({ name: 'output_format', type: 'String' })
    })

    it('returns null for dall-e-3', async () => {
      const result = await service.createModelSettingsSchemaLoader({ criteria: { model: 'dall-e-3' } })

      expect(result).toBeNull()
    })

    it('returns null for dall-e-2', async () => {
      const result = await service.createModelSettingsSchemaLoader({ criteria: { model: 'dall-e-2' } })

      expect(result).toBeNull()
    })

    it('returns null for unknown model', async () => {
      const result = await service.createModelSettingsSchemaLoader({ criteria: { model: 'unknown' } })

      expect(result).toBeNull()
    })
  })
})
