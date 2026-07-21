'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Google Vertex AI Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  // Developer-supplied test values (with sensible defaults) in
  // e2e-config.json -> google-vertex-ai.testValues:
  //   geminiModel    - a Gemini model available in the configured project/region
  //   embeddingModel - an embedding model available in the project/region
  //   imageModel     - an Imagen model (only used if Files storage is wired up)
  //   partnerPublisher / partnerModel / partnerRequestBody - optional Model Garden target
  let geminiModel
  let embeddingModel

  beforeAll(() => {
    sandbox = createE2ESandbox('google-vertex-ai')
    require('../src/index.js')

    try {
      sandbox.validateConfigs()
    } catch (error) {
      console.log(error)
      process.exit(1)
    }

    service = sandbox.getService()
    testValues = sandbox.getTestValues()

    geminiModel = testValues.geminiModel || 'gemini-2.5-flash'
    embeddingModel = testValues.embeddingModel || 'gemini-embedding-001'
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Content Generation ──

  describe('generateContent', () => {
    it('generates text from a simple prompt', async () => {
      const result = await service.generateContent(
        geminiModel,
        'Reply with the single word: pong',
        undefined,
        0,
        32
      )

      expect(result).toHaveProperty('text')
      expect(typeof result.text).toBe('string')
      expect(result).toHaveProperty('model')
      expect(result).toHaveProperty('finishReason')
      expect(result).toHaveProperty('usageMetadata')
    })

    it('honors a system instruction', async () => {
      const result = await service.generateContent(
        geminiModel,
        'What should I do?',
        'You are a helpful assistant. Always answer in one short sentence.',
        0.2,
        64
      )

      expect(result).toHaveProperty('text')
      expect(typeof result.text).toBe('string')
    })
  })

  describe('generateContentAdvanced', () => {
    it('generates content with sampling controls and history', async () => {
      const result = await service.generateContentAdvanced(
        geminiModel,
        'Continue the conversation with a short greeting.',
        undefined,
        [
          { role: 'user', parts: [{ text: 'Hello' }] },
          { role: 'model', parts: [{ text: 'Hi there!' }] },
        ],
        'Keep replies under 20 words.',
        0.3,
        0.9,
        undefined,
        128
      )

      expect(result).toHaveProperty('text')
      expect(result).toHaveProperty('thoughts')
      expect(result).toHaveProperty('functionCalls')
      expect(Array.isArray(result.functionCalls)).toBe(true)
      expect(result).toHaveProperty('finishReason')
      expect(result).toHaveProperty('usageMetadata')
    })

    it('produces structured JSON output from a response schema', async () => {
      const result = await service.generateContentAdvanced(
        geminiModel,
        'Give the name and a two-word description of the color blue.',
        undefined,
        undefined,
        undefined,
        0,
        undefined,
        undefined,
        256,
        undefined,
        undefined,
        'JSON',
        {
          type: 'OBJECT',
          properties: {
            name: { type: 'STRING' },
            description: { type: 'STRING' },
          },
        }
      )

      expect(result).toHaveProperty('text')
      expect(typeof result.text).toBe('string')
    })
  })

  describe('countTokens', () => {
    it('counts tokens for a text without generating content', async () => {
      const result = await service.countTokens(geminiModel, 'The quick brown fox jumps over the lazy dog.')

      expect(result).toHaveProperty('totalTokens')
      expect(typeof result.totalTokens).toBe('number')
      expect(result.totalTokens).toBeGreaterThan(0)
    })
  })

  // ── Embeddings ──

  describe('createEmbeddings', () => {
    it('creates embeddings for multiple texts in input order', async () => {
      const result = await service.createEmbeddings(
        embeddingModel,
        ['first text to embed', 'second text to embed']
      )

      expect(result).toHaveProperty('count', 2)
      expect(result).toHaveProperty('model', embeddingModel)
      expect(Array.isArray(result.embeddings)).toBe(true)
      expect(result.embeddings).toHaveLength(2)
      expect(Array.isArray(result.embeddings[0].values)).toBe(true)
      expect(result.embeddings[0].values.length).toBeGreaterThan(0)
    })

    it('reduces the output dimensionality when requested', async () => {
      const result = await service.createEmbeddings(
        embeddingModel,
        ['dimension test'],
        'Retrieval Document',
        768
      )

      expect(result.embeddings).toHaveLength(1)
      expect(result.embeddings[0].values.length).toBe(768)
    })
  })

  // ── Predict (generic) ──

  describe('predict', () => {
    it('runs a generic predict against an embedding model', async () => {
      const result = await service.predict(embeddingModel, [{ content: 'predict path test' }])

      expect(result).toHaveProperty('predictions')
      expect(Array.isArray(result.predictions)).toBe(true)
      expect(result.predictions.length).toBeGreaterThan(0)
    })
  })

  // ── Model Garden (partner models) ──

  describe('callPartnerModel', () => {
    // Partner/open models must be enabled in Model Garden for the project, so this
    // only runs when the developer supplies testValues.partnerPublisher + partnerModel.
    const canCall = () => Boolean(testValues.partnerPublisher && testValues.partnerModel)

    it('calls a Model Garden partner model when one is configured', async () => {
      if (!canCall()) {
        console.log(
          'Skipping callPartnerModel: set testValues.partnerPublisher, testValues.partnerModel ' +
          '(and optionally testValues.partnerRequestBody) in e2e-config.json'
        )
        return
      }

      const requestBody = testValues.partnerRequestBody || {
        anthropic_version: 'vertex-2023-10-16',
        max_tokens: 64,
        messages: [{ role: 'user', content: 'Reply with the single word: pong' }],
      }

      const result = await service.callPartnerModel(
        testValues.partnerPublisher,
        testValues.partnerModel,
        requestBody
      )

      expect(result).toBeDefined()
      expect(typeof result).toBe('object')
    })
  })

  // ── Image Generation ──

  describe('generateImage', () => {
    // generateImage saves results through the FlowRunner Files API, which is injected
    // by the runtime and is NOT available in the e2e sandbox. It runs only when the
    // developer wires a Files-compatible object onto testValues.filesUpload and sets
    // testValues.imageModel. Otherwise it skips so the suite stays green.
    const canGenerate = () => Boolean(testValues.imageModel && testValues.filesUpload)

    it('generates an image when Files storage is wired up', async () => {
      if (!canGenerate()) {
        console.log(
          'Skipping generateImage: requires the FlowRunner Files API (not available in the ' +
          'e2e sandbox). Set testValues.imageModel and provide a Files upload stub to enable.'
        )
        return
      }

      service.flowrunner = { Files: { uploadFile: testValues.filesUpload } }

      const result = await service.generateImage(
        testValues.imageModel,
        'A simple red circle on a white background',
        1,
        '1:1'
      )

      expect(result).toHaveProperty('fileURLs')
      expect(Array.isArray(result.fileURLs)).toBe(true)
      expect(result.fileURLs.length).toBeGreaterThan(0)
      expect(result).toHaveProperty('count')
      expect(result).toHaveProperty('model', testValues.imageModel)
    })
  })
})
