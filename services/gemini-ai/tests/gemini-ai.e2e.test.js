'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

// Test values (with sensible defaults) can be overridden in
// service-sandbox/e2e-config.json under gemini-ai.testValues:
//   - textModel:      a generateContent-capable model (default models/gemini-2.5-flash)
//   - embeddingModel: an embedContent-capable model   (default models/gemini-embedding-001)
//   - imageModel:     an image-capable model           (default models/gemini-2.5-flash-image)
//   - videoModel:     a Veo video model                (default models/veo-3.1-generate-preview)
//   - fileUrl:        a publicly accessible file URL used by the upload lifecycle test
//   - mediaUrl:       a publicly accessible image URL used by advanced/inline media tests

describe('Gemini AI Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  let textModel
  let embeddingModel
  let imageModel

  beforeAll(() => {
    sandbox = createE2ESandbox('gemini-ai')
    require('../src/index.js')

    try {
      sandbox.validateConfigs()
    } catch (error) {
      console.log(error)
      process.exit(1)
    }

    service = sandbox.getService()
    testValues = sandbox.getTestValues()

    textModel = testValues.textModel || 'models/gemini-2.5-flash'
    embeddingModel = testValues.embeddingModel || 'models/gemini-embedding-001'
    imageModel = testValues.imageModel || 'models/gemini-2.5-flash-image'

    // The flowrunner.Files API is injected by the FlowRunner runtime in production.
    // For e2e tests we stub it so file-producing methods (image/speech/video) can be
    // exercised without depending on file-storage infrastructure.
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

  // ── Models ──

  describe('listModels', () => {
    it('returns a models array', async () => {
      const result = await service.listModels(20)

      expect(result).toHaveProperty('models')
      expect(Array.isArray(result.models)).toBe(true)
      expect(result.models.length).toBeGreaterThan(0)
      expect(result.models[0]).toHaveProperty('name')
    })
  })

  describe('getModel', () => {
    it('returns metadata for the text model', async () => {
      const result = await service.getModel(textModel)

      expect(result).toHaveProperty('name')
      expect(result).toHaveProperty('supportedGenerationMethods')
      expect(Array.isArray(result.supportedGenerationMethods)).toBe(true)
    })
  })

  // ── Dictionaries ──

  describe('getModelsDictionary', () => {
    it('returns items with label/value/note', async () => {
      const result = await service.getModelsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result.items.length).toBeGreaterThan(0)
      expect(result.items[0]).toHaveProperty('label')
      expect(result.items[0]).toHaveProperty('value')
      expect(result.items[0]).toHaveProperty('note')
    })

    it('filters by search string', async () => {
      const result = await service.getModelsDictionary({ search: 'flash' })

      expect(Array.isArray(result.items)).toBe(true)
      result.items.forEach(item => {
        expect(`${ item.label } ${ item.value }`.toLowerCase()).toContain('flash')
      })
    })
  })

  describe('getEmbeddingModelsDictionary', () => {
    it('returns embedding models', async () => {
      const result = await service.getEmbeddingModelsDictionary({})

      expect(Array.isArray(result.items)).toBe(true)
      expect(result.items.length).toBeGreaterThan(0)
    })
  })

  describe('getImageModelsDictionary', () => {
    it('returns image models', async () => {
      const result = await service.getImageModelsDictionary({})

      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getTtsModelsDictionary', () => {
    it('returns tts models', async () => {
      const result = await service.getTtsModelsDictionary({})

      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getVideoModelsDictionary', () => {
    it('returns video models', async () => {
      const result = await service.getVideoModelsDictionary({})

      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Content Generation ──

  describe('countTokens', () => {
    it('counts tokens for a prompt', async () => {
      const result = await service.countTokens(textModel, 'Hello, how many tokens is this?')

      expect(result).toHaveProperty('totalTokens')
      expect(typeof result.totalTokens).toBe('number')
      expect(result.totalTokens).toBeGreaterThan(0)
    })
  })

  describe('generateContent', () => {
    it('generates text from a prompt', async () => {
      const result = await service.generateContent(
        textModel,
        'Reply with exactly the single word: pong',
        undefined,
        undefined,
        0
      )

      expect(result).toHaveProperty('text')
      expect(typeof result.text).toBe('string')
      expect(result.text.length).toBeGreaterThan(0)
      expect(result).toHaveProperty('model', textModel)
      expect(result).toHaveProperty('usageMetadata')
    })

    it('generates structured JSON output', async () => {
      const result = await service.generateContent(
        textModel,
        'Return a JSON object with a single key "ok" set to true.',
        undefined,
        undefined,
        0,
        undefined,
        'json'
      )

      expect(result).toHaveProperty('text')
      expect(() => JSON.parse(result.text)).not.toThrow()
    })
  })

  describe('generateContentAdvanced', () => {
    it('generates text with sampling controls', async () => {
      const result = await service.generateContentAdvanced(
        textModel,
        'Reply with exactly the single word: ready',
        null, null, null, null,
        0
      )

      expect(result).toHaveProperty('text')
      expect(typeof result.text).toBe('string')
      expect(result).toHaveProperty('finishReason')
      expect(result).toHaveProperty('usageMetadata')
      expect(result).toHaveProperty('functionCalls')
      expect(Array.isArray(result.functionCalls)).toBe(true)
    })

    it('grounds a response with Google Search', async () => {
      const result = await service.generateContentAdvanced(
        textModel,
        'Who is the current CEO of Google? Answer in one short sentence.',
        null, null, null, null,
        0, null, null, null, null, null, null, null,
        null, null, null, null,
        true
      )

      expect(result).toHaveProperty('text')
      expect(typeof result.text).toBe('string')
      expect(result.text.length).toBeGreaterThan(0)
    })
  })

  // ── Embeddings ──

  describe('embedContent', () => {
    it('returns an embedding vector', async () => {
      const result = await service.embedContent(embeddingModel, 'semantic search text')

      expect(result).toHaveProperty('embedding')
      expect(Array.isArray(result.embedding)).toBe(true)
      expect(result.embedding.length).toBeGreaterThan(0)
      expect(result).toHaveProperty('dimensions', result.embedding.length)
    })

    it('returns a reduced-dimension embedding', async () => {
      const result = await service.embedContent(embeddingModel, 'reduce me', 'Retrieval Query', 768)

      expect(result.dimensions).toBe(768)
    })
  })

  describe('batchEmbedContents', () => {
    it('returns one embedding per text', async () => {
      const result = await service.batchEmbedContents(embeddingModel, ['first text', 'second text'])

      expect(result).toHaveProperty('count', 2)
      expect(result.embeddings).toHaveLength(2)
      expect(Array.isArray(result.embeddings[0])).toBe(true)
      expect(result.embeddings[0].length).toBeGreaterThan(0)
    })
  })

  // ── Files lifecycle ──

  describe('uploadFile + getFileInfo + listFiles + deleteFile', () => {
    let uploadedName

    it('uploads a file and waits until it is ACTIVE', async () => {
      const fileUrl = testValues.fileUrl || 'https://raw.githubusercontent.com/mozilla/pdf.js/master/test/pdfs/helloworld.pdf'

      const result = await service.uploadFile(fileUrl, 'e2e-test-file')

      expect(result).toHaveProperty('name')
      expect(result).toHaveProperty('state', 'ACTIVE')
      expect(result).toHaveProperty('uri')
      uploadedName = result.name
    })

    it('gets info for the uploaded file', async () => {
      if (!uploadedName) {
        return
      }

      const result = await service.getFileInfo(uploadedName)

      expect(result).toHaveProperty('name', uploadedName)
      expect(result).toHaveProperty('mimeType')
    })

    it('lists files including the uploaded one', async () => {
      const result = await service.listFiles(20)

      expect(result).toHaveProperty('files')
      expect(Array.isArray(result.files)).toBe(true)
    })

    it('deletes the uploaded file', async () => {
      if (!uploadedName) {
        return
      }

      const result = await service.deleteFile(uploadedName)

      expect(result).toEqual({ success: true, fileName: uploadedName })
    })
  })

  // ── Context Caching lifecycle ──

  describe('createCachedContent + get + update + list + delete', () => {
    let cacheName

    it('creates a cached content entry', async () => {
      // Caches require a model-dependent minimum token count; a long text meets it.
      const longText = 'FlowRunner is an automation platform. '.repeat(400)

      const result = await service.createCachedContent(
        textModel,
        longText,
        null,
        'You are a helpful assistant.',
        600,
        'e2e-cache'
      )

      expect(result).toHaveProperty('name')
      cacheName = result.name
    })

    it('gets the cached content', async () => {
      if (!cacheName) {
        return
      }

      const result = await service.getCachedContent(cacheName)

      expect(result).toHaveProperty('name', cacheName)
      expect(result).toHaveProperty('model')
    })

    it('updates the cache TTL', async () => {
      if (!cacheName) {
        return
      }

      const result = await service.updateCachedContent(cacheName, 1200)

      expect(result).toHaveProperty('name', cacheName)
      expect(result).toHaveProperty('expireTime')
    })

    it('lists cached contents', async () => {
      const result = await service.listCachedContents(10)

      expect(result).toHaveProperty('cachedContents')
      expect(Array.isArray(result.cachedContents)).toBe(true)
    })

    it('deletes the cached content', async () => {
      if (!cacheName) {
        return
      }

      const result = await service.deleteCachedContent(cacheName)

      expect(result).toHaveProperty('success', true)
    })
  })

  // ── Batch Processing ──

  describe('listBatchJobs', () => {
    it('returns operations array', async () => {
      const result = await service.listBatchJobs(10)

      expect(result).toHaveProperty('operations')
      expect(Array.isArray(result.operations)).toBe(true)
    })
  })

  describe('createBatchJob + getBatchJob + deleteBatchJob', () => {
    let batchName

    it('creates an inline batch job', async () => {
      const result = await service.createBatchJob(
        textModel,
        'e2e-batch',
        ['What is 2+2? Reply with just the number.']
      )

      expect(result).toHaveProperty('name')
      expect(result).toHaveProperty('operation')
      batchName = result.name
    })

    it('gets the batch job status', async () => {
      if (!batchName) {
        return
      }

      const result = await service.getBatchJob(batchName)

      expect(result).toHaveProperty('name')
      expect(result).toHaveProperty('done')
      expect(result).toHaveProperty('operation')
    })

    it('deletes the batch job', async () => {
      if (!batchName) {
        return
      }

      const result = await service.deleteBatchJob(batchName)

      expect(result).toHaveProperty('success', true)
    })
  })

  // ── Image Generation (Files API stubbed) ──

  describe('generateImage', () => {
    it('generates an image and returns file URLs', async () => {
      const result = await service.generateImage(
        imageModel,
        'A simple solid red square on a white background.'
      )

      expect(result).toHaveProperty('fileURLs')
      expect(Array.isArray(result.fileURLs)).toBe(true)
      expect(result.fileURLs.length).toBeGreaterThan(0)
      expect(service.flowrunner.Files.uploadFile).toHaveBeenCalled()
    })
  })
})
