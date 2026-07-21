'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

/**
 * AI Vision e2e tests.
 *
 * Because every config item is optional (each maps to a different provider),
 * validateConfigs() will always pass. The tests below dynamically detect which
 * providers have API keys configured and only run against those.
 *
 * Required in e2e-config.json  ->  "ai-vision".configs  (at least one API key)
 *                               ->  "ai-vision".testValues.testImageUrl
 */

// Map provider IDs to a representative model for testing.
const PROVIDER_TEST_MODELS = {
  OPEN_AI: 'gpt-4.1',
  ANTHROPIC: 'claude-haiku-4-5',
  GOOGLE_GEMINI: 'gemini-2.5-flash',
  MISTRAL: 'mistral-small-latest',
  COHERE: 'command-a-vision-07-2025',
  TOGETHER_AI: 'Qwen/Qwen2.5-VL-72B-Instruct',
  FIREWORKS_AI: 'accounts/fireworks/models/qwen3-vl-8b-instruct',
  XAI: 'grok-4.3',
  HUGGING_FACE: 'Qwen/Qwen2.5-VL-7B-Instruct',
  MOONSHOT_AI: 'kimi-latest',
}

// Map provider IDs to the config key that enables them.
const PROVIDER_CONFIG_KEYS = {
  OPEN_AI: 'openAIAPIKey',
  ANTHROPIC: 'anthropicAPIKey',
  GOOGLE_GEMINI: 'googleGeminiAPIKey',
  MISTRAL: 'mistralAPIKey',
  COHERE: 'cohereAPIKey',
  TOGETHER_AI: 'togetherAIAPIKey',
  FIREWORKS_AI: 'fireworksAIAPIKey',
  XAI: 'xaiAPIKey',
  HUGGING_FACE: 'huggingFaceToken',
  MOONSHOT_AI: 'moonshotAIAPIKey',
}

describe('AI Vision Service (e2e)', () => {
  let sandbox
  let service
  let testImageUrl
  let configs
  let configuredProviders

  beforeAll(() => {
    sandbox = createE2ESandbox('ai-vision')
    require('../src/index.js')

    try {
      sandbox.validateConfigs()
    } catch (error) {
      console.log(error)
      process.exit(1)
    }

    service = sandbox.getService()

    const testValues = sandbox.getTestValues()
    testImageUrl = testValues.testImageUrl ||
      'https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/PNG_transparency_demonstration_1.png/280px-PNG_transparency_demonstration_1.png'

    // Determine which providers have keys configured.
    configs = service.config
    configuredProviders = Object.entries(PROVIDER_CONFIG_KEYS)
      .filter(([, configKey]) => !!configs[configKey])
      .map(([providerId]) => providerId)

    if (!configuredProviders.length) {
      console.warn(
        'WARNING: No AI vision providers are configured in e2e-config.json. ' +
        'All provider-specific tests will be skipped. ' +
        'Add at least one API key to service-sandbox/e2e-config.json under "ai-vision".configs.'
      )
    }
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Dictionary methods (no API key needed) ──

  describe('getVisionProvidersDictionary', () => {
    it('returns all providers', async () => {
      const result = await service.getVisionProvidersDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result.items.length).toBe(10)
      expect(result.items[0]).toHaveProperty('label')
      expect(result.items[0]).toHaveProperty('value')
      expect(result.items[0]).toHaveProperty('note')
    })

    it('filters providers by search', async () => {
      const result = await service.getVisionProvidersDictionary({ search: 'google' })

      expect(result.items.length).toBe(1)
      expect(result.items[0].value).toBe('GOOGLE_GEMINI')
    })
  })

  describe('getVisionProviderModelsDictionary', () => {
    it('returns models for a valid provider', async () => {
      const result = await service.getVisionProviderModelsDictionary({
        criteria: { provider: 'OPEN_AI' },
      })

      expect(result).toHaveProperty('items')
      expect(result.items.length).toBeGreaterThan(0)
      expect(result.items[0]).toHaveProperty('label')
      expect(result.items[0]).toHaveProperty('value')
      expect(result.items[0]).toHaveProperty('note')
    })

    it('returns empty items for invalid provider', async () => {
      const result = await service.getVisionProviderModelsDictionary({
        criteria: { provider: 'NONEXISTENT' },
      })

      expect(result.items).toEqual([])
    })
  })

  // ── analyzeImage (one test per configured provider) ──

  describe('analyzeImage', () => {
    for (const [providerId, configKey] of Object.entries(PROVIDER_CONFIG_KEYS)) {
      const model = PROVIDER_TEST_MODELS[providerId]

      it(`analyzes an image with ${providerId}`, async () => {
        if (!configs[configKey]) {
          console.log(`  Skipping ${providerId} - no API key configured`)
          return
        }

        const result = await service.analyzeImage(
          providerId, model, [testImageUrl], 'Describe this image briefly in one sentence.'
        )

        expect(result).toHaveProperty('text')
        expect(typeof result.text).toBe('string')
        expect(result.text.length).toBeGreaterThan(0)
        expect(result.provider).toBeDefined()
        expect(result.model).toBe(model)
      }, 60000)
    }

    it('throws for an unconfigured provider', async () => {
      // Find a provider that is NOT configured.
      const unconfigured = Object.entries(PROVIDER_CONFIG_KEYS)
        .find(([, configKey]) => !configs[configKey])

      if (!unconfigured) {
        console.log('  Skipping - all providers are configured')
        return
      }

      const [providerId] = unconfigured
      const model = PROVIDER_TEST_MODELS[providerId]

      await expect(
        service.analyzeImage(providerId, model, [testImageUrl], 'Describe this image.')
      ).rejects.toThrow('not configured')
    })
  })

  // ── analyzeImageWithStructuredOutput (test with first configured provider) ──

  describe('analyzeImageWithStructuredOutput', () => {
    const structure = {
      type: 'object',
      properties: {
        description: { type: 'string' },
        hasTransparency: { type: 'boolean' },
      },
    }

    it('returns structured output from a configured provider', async () => {
      if (!configuredProviders.length) {
        console.log('  Skipping - no providers configured')
        return
      }

      const providerId = configuredProviders[0]
      const model = PROVIDER_TEST_MODELS[providerId]

      const result = await service.analyzeImageWithStructuredOutput(
        providerId, model, [testImageUrl],
        'Analyze this image. Return a short description and whether the image has transparency.',
        structure
      )

      expect(result).toHaveProperty('result')
      expect(typeof result.result).toBe('object')
      expect(result.provider).toBeDefined()
      expect(result.model).toBe(model)
    }, 60000)
  })
})
