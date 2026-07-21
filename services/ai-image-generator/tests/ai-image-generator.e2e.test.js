'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('AI Image Generator Service (e2e)', () => {
  let sandbox
  let service

  beforeAll(() => {
    sandbox = createE2ESandbox('ai-image-generator')
    require('../src/index.js')

    try {
      sandbox.validateConfigs()
    } catch (error) {
      console.log(error)
      process.exit(1)
    }

    service = sandbox.getService()

    // The flowrunner.Files API is provided by the runtime in production.
    // For e2e tests we mock it to avoid depending on file storage infrastructure.
    service.flowrunner = {
      Files: {
        uploadFile: jest.fn().mockImplementation(async (buffer, options) => {
          return { url: `https://e2e-mock-files.example.com/${ options.filename }` }
        }),
      },
    }
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Dictionaries ──

  describe('getSizeOptionsDictionary', () => {
    it('returns size options for dall-e-3', async () => {
      const result = await service.getSizeOptionsDictionary({ criteria: { model: 'dall-e-3' } })

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result.items.length).toBeGreaterThan(0)
      expect(result.items[0]).toHaveProperty('label')
      expect(result.items[0]).toHaveProperty('value')
    })

    it('returns size options for gpt-image-1', async () => {
      const result = await service.getSizeOptionsDictionary({ criteria: { model: 'gpt-image-1' } })

      expect(result.items.length).toBeGreaterThan(0)
    })
  })

  describe('getQualityOptionsDictionary', () => {
    it('returns quality options for dall-e-3', async () => {
      const result = await service.getQualityOptionsDictionary({ criteria: { model: 'dall-e-3' } })

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result.items.length).toBeGreaterThan(0)
    })
  })

  // ── Schema Loaders ──

  describe('createModelSettingsSchemaLoader', () => {
    it('returns schema for gpt-image-1', async () => {
      const result = await service.createModelSettingsSchemaLoader({ criteria: { model: 'gpt-image-1' } })

      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThan(0)
      expect(result[0]).toHaveProperty('name')
      expect(result[0]).toHaveProperty('type')
    })

    it('returns null for dall-e-3', async () => {
      const result = await service.createModelSettingsSchemaLoader({ criteria: { model: 'dall-e-3' } })

      expect(result).toBeNull()
    })
  })

  // ── Image Generation ──

  describe('generateImage', () => {
    it('generates an image with dall-e-2 (cost-effective model)', async () => {
      const result = await service.generateImage(
        'A simple red circle on a white background',
        'dall-e-2',
        '256x256',
      )

      expect(result).toHaveProperty('fileURLs')
      expect(Array.isArray(result.fileURLs)).toBe(true)
      expect(result.fileURLs.length).toBeGreaterThan(0)
      expect(typeof result.fileURLs[0]).toBe('string')
    }, 60000)

    it('rejects an empty prompt', async () => {
      await expect(service.generateImage('', 'dall-e-2'))
        .rejects.toThrow('The "prompt" parameter is required')
    })

    it('rejects an invalid model', async () => {
      await expect(service.generateImage('A test prompt', 'invalid-model'))
        .rejects.toThrow('You must select a valid model')
    })

    it('rejects a prompt exceeding model limit', async () => {
      const longPrompt = 'a'.repeat(1001)

      await expect(service.generateImage(longPrompt, 'dall-e-2'))
        .rejects.toThrow('exceeds the maximum allowed length')
    })
  })
})
