'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Groq Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('groq')
    require('../src/index.js')

    try {
      sandbox.validateConfigs()
    } catch (error) {
      console.log(error)
      process.exit(1)
    }

    service = sandbox.getService()
    testValues = sandbox.getTestValues()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  const suffix = Date.now()

  // ── Models ──

  describe('listModels', () => {
    it('returns the models list with expected shape', async () => {
      const response = await service.listModels()

      expect(response).toHaveProperty('object', 'list')
      expect(Array.isArray(response.data)).toBe(true)
      expect(response.data.length).toBeGreaterThan(0)
    })
  })

  describe('getModel', () => {
    it('returns a specific model by id', async () => {
      const response = await service.getModel('llama-3.3-70b-versatile')

      expect(response).toHaveProperty('id', 'llama-3.3-70b-versatile')
      expect(response).toHaveProperty('object', 'model')
    })
  })

  // ── Dictionaries ──

  describe('getModelsDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getModelsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result.items.length).toBeGreaterThan(0)
    })

    it('filters by search term', async () => {
      const result = await service.getModelsDictionary({ search: 'whisper' })

      expect(result.items.every(i => i.value.toLowerCase().includes('whisper'))).toBe(true)
    })
  })

  describe('getChatModelsDictionary', () => {
    it('returns chat models without whisper/tts entries', async () => {
      const result = await service.getChatModelsDictionary({})

      expect(Array.isArray(result.items)).toBe(true)
      expect(result.items.every(i => !/whisper|orpheus/i.test(i.value))).toBe(true)
    })
  })

  describe('getTranscriptionModelsDictionary', () => {
    it('returns only whisper models', async () => {
      const result = await service.getTranscriptionModelsDictionary({})

      expect(Array.isArray(result.items)).toBe(true)
      expect(result.items.every(i => /whisper/i.test(i.value))).toBe(true)
    })
  })

  describe('getTtsModelsDictionary', () => {
    it('returns a dictionary items array', async () => {
      const result = await service.getTtsModelsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getVoicesDictionary', () => {
    it('returns voices for the English Orpheus model', async () => {
      const result = await service.getVoicesDictionary({
        criteria: { model: 'canopylabs/orpheus-v1-english' },
      })

      expect(result.items.length).toBeGreaterThan(0)
      expect(result.items).toContainEqual(
        expect.objectContaining({ value: 'troy' })
      )
    })
  })

  describe('getFilesDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getFilesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getBatchesDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getBatchesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Chat Completion ──

  describe('chatCompletion', () => {
    it('returns a text completion with usage', async () => {
      const response = await service.chatCompletion(
        'Reply with exactly the word: pong',
        undefined,
        undefined,
        0
      )

      expect(response).toHaveProperty('text')
      expect(typeof response.text).toBe('string')
      expect(response).toHaveProperty('model')
      expect(response).toHaveProperty('finishReason')
      expect(response).toHaveProperty('usage')
    })

    it('returns valid JSON when JSON mode is enabled', async () => {
      const response = await service.chatCompletion(
        'Return a JSON object with a single key "ok" set to true.',
        undefined,
        undefined,
        0,
        undefined,
        undefined,
        undefined,
        undefined,
        true
      )

      expect(() => JSON.parse(response.text)).not.toThrow()
    })
  })

  describe('chatCompletionAdvanced', () => {
    it('returns the raw completion response', async () => {
      const response = await service.chatCompletionAdvanced([
        { role: 'system', content: 'You are terse.' },
        { role: 'user', content: 'Say hi in one word.' },
      ])

      expect(response).toHaveProperty('choices')
      expect(Array.isArray(response.choices)).toBe(true)
      expect(response.choices[0]).toHaveProperty('message')
      expect(response).toHaveProperty('usage')
    })
  })

  // ── Vision ──

  describe('analyzeImage', () => {
    it('describes an image from a public URL', async () => {
      // A small, stable public test image. Override via testValues.imageUrl if needed.
      const imageUrl =
        testValues.imageUrl ||
        'https://upload.wikimedia.org/wikipedia/commons/thumb/d/dd/Gfp-wisconsin-madison-the-nature-boardwalk.jpg/320px-Gfp-wisconsin-madison-the-nature-boardwalk.jpg'

      const response = await service.analyzeImage('Describe this image in one sentence.', [imageUrl])

      expect(response).toHaveProperty('text')
      expect(typeof response.text).toBe('string')
      expect(response.text.length).toBeGreaterThan(0)
    })
  })

  // ── Audio: Speech to Text ──

  describe('transcribeAudio', () => {
    // Needs a public audio file URL. Provide testValues.audioUrl to run.
    it('transcribes an audio file when audioUrl is configured', async () => {
      if (!testValues.audioUrl) {
        console.log('Skipping transcribeAudio: set testValues.audioUrl to a public audio file URL')
        return
      }

      const response = await service.transcribeAudio(testValues.audioUrl)

      expect(response).toHaveProperty('text')
      expect(typeof response.text).toBe('string')
    })
  })

  describe('translateAudio', () => {
    // Needs a public non-English audio file URL. Provide testValues.foreignAudioUrl to run.
    it('translates an audio file when foreignAudioUrl is configured', async () => {
      if (!testValues.foreignAudioUrl) {
        console.log(
          'Skipping translateAudio: set testValues.foreignAudioUrl to a public non-English audio file URL'
        )
        return
      }

      const response = await service.translateAudio(testValues.foreignAudioUrl)

      expect(response).toHaveProperty('text')
      expect(typeof response.text).toBe('string')
    })
  })

  // ── Files + Batches lifecycle ──

  describe('uploadFile + getFile + listFiles + createBatch + getBatch + cancelBatch + deleteFile', () => {
    let fileId
    let batchId

    const jsonl =
      JSON.stringify({
        custom_id: `e2e-${ suffix }`,
        method: 'POST',
        url: '/v1/chat/completions',
        body: {
          model: 'llama-3.3-70b-versatile',
          messages: [{ role: 'user', content: 'Say hi.' }],
        },
      }) + '\n'

    it('uploads a JSONL batch input file', async () => {
      const response = await service.uploadFile(undefined, jsonl, `e2e-batch-${ suffix }.jsonl`)

      expect(response).toHaveProperty('id')
      expect(response).toHaveProperty('purpose', 'batch')
      fileId = response.id
    })

    it('retrieves the uploaded file metadata', async () => {
      const response = await service.getFile(fileId)

      expect(response).toHaveProperty('id', fileId)
      expect(response).toHaveProperty('bytes')
    })

    it('lists files including the uploaded one', async () => {
      const response = await service.listFiles()

      expect(response).toHaveProperty('object', 'list')
      expect(response.data.some(f => f.id === fileId)).toBe(true)
    })

    it('shows the file in the files dictionary', async () => {
      const result = await service.getFilesDictionary({})

      expect(result.items.some(i => i.value === fileId)).toBe(true)
    })

    it('creates a batch from the uploaded file', async () => {
      const response = await service.createBatch(fileId, 'Chat Completions', '24 Hours')

      expect(response).toHaveProperty('id')
      expect(response).toHaveProperty('input_file_id', fileId)
      batchId = response.id
    })

    it('retrieves the created batch', async () => {
      const response = await service.getBatch(batchId)

      expect(response).toHaveProperty('id', batchId)
      expect(response).toHaveProperty('status')
    })

    it('lists batches including the created one', async () => {
      const response = await service.listBatches(20)

      expect(response).toHaveProperty('object', 'list')
      expect(Array.isArray(response.data)).toBe(true)
    })

    it('cancels the batch', async () => {
      const response = await service.cancelBatch(batchId)

      expect(response).toHaveProperty('id', batchId)
      // status moves to cancelling/cancelled
      expect(['cancelling', 'cancelled']).toContain(response.status)
    })

    afterAll(async () => {
      if (fileId) {
        try {
          const response = await service.deleteFile(fileId)

          expect(response).toHaveProperty('deleted', true)
        } catch (e) {
          // ignore cleanup errors (a file backing an in-flight batch may be locked briefly)
        }
      }
    })
  })
})
