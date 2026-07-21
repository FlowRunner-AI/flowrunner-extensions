'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Cohere Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('cohere')
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

  // A unique-ish suffix so repeated e2e runs don't collide.
  const suffix = Date.now()

  // ── Models ──

  describe('listModels', () => {
    it('returns models with expected shape', async () => {
      const response = await service.listModels(undefined, undefined, 5)

      expect(response).toHaveProperty('models')
      expect(Array.isArray(response.models)).toBe(true)
    })

    it('filters by endpoint', async () => {
      const response = await service.listModels('Chat', undefined, 5)

      expect(response).toHaveProperty('models')
      expect(Array.isArray(response.models)).toBe(true)
    })
  })

  describe('getModel', () => {
    it('returns details for the default chat model', async () => {
      const response = await service.getModel('command-a-plus-05-2026')

      expect(response).toHaveProperty('name')
      expect(response).toHaveProperty('endpoints')
    })
  })

  describe('getModelsDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getModelsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getChatModelsDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getChatModelsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getEmbedModelsDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getEmbedModelsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getRerankModelsDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getRerankModelsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getClassifyModelsDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getClassifyModelsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Chat ──

  describe('chat', () => {
    it('generates a text response', async () => {
      const response = await service.chat(
        'Reply with exactly the single word: PONG',
        undefined,
        undefined,
        0,
        20
      )

      expect(response).toHaveProperty('id')
      expect(response).toHaveProperty('text')
      expect(typeof response.text).toBe('string')
      expect(response).toHaveProperty('finishReason')
      expect(response).toHaveProperty('usage')
    })

    it('supports JSON mode', async () => {
      const response = await service.chat(
        'Return a JSON object with a single key "ok" set to true.',
        undefined,
        undefined,
        0,
        50,
        undefined,
        undefined,
        undefined,
        undefined,
        true
      )

      expect(response).toHaveProperty('text')
      expect(() => JSON.parse(response.text)).not.toThrow()
    })
  })

  describe('chatAdvanced', () => {
    it('returns the raw assistant message', async () => {
      const response = await service.chatAdvanced(
        [{ role: 'user', content: 'Say hello in one word.' }],
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        0,
        20
      )

      expect(response).toHaveProperty('message')
      expect(response.message).toHaveProperty('content')
      expect(Array.isArray(response.message.content)).toBe(true)
    })
  })

  describe('chatWithDocuments', () => {
    it('answers grounded on the provided documents', async () => {
      const documents = [
        { id: 'doc_1', data: { title: 'Q2 Report', text: 'Revenue grew 25% in Q2 driven by enterprise subscriptions.' } },
      ]

      const response = await service.chatWithDocuments(
        'By how much did revenue grow in Q2?',
        documents,
        undefined,
        undefined,
        undefined,
        0,
        60
      )

      expect(response).toHaveProperty('text')
      expect(response).toHaveProperty('citations')
      expect(Array.isArray(response.citations)).toBe(true)
    })
  })

  // ── Embeddings ──

  describe('createEmbeddings', () => {
    it('returns embeddings for texts', async () => {
      const response = await service.createEmbeddings(['hello world'], undefined, 'Search Document')

      expect(response).toHaveProperty('embeddings')
    })
  })

  // ── Rerank ──

  describe('rerankDocuments', () => {
    it('ranks documents and echoes original text', async () => {
      const documents = [
        'The capital of France is Paris.',
        'Reranking reorders search results by semantic relevance.',
        'Bananas are yellow.',
      ]

      const response = await service.rerankDocuments('What is reranking?', documents, undefined, 2)

      expect(response).toHaveProperty('results')
      expect(Array.isArray(response.results)).toBe(true)

      if (response.results.length) {
        expect(response.results[0]).toHaveProperty('index')
        expect(response.results[0]).toHaveProperty('relevance_score')
        expect(response.results[0]).toHaveProperty('document')
      }
    })
  })

  // ── Classification ──

  describe('classifyText', () => {
    it('classifies inputs with few-shot examples', async () => {
      const examples = [
        { text: 'I love this product', label: 'positive' },
        { text: 'This is amazing', label: 'positive' },
        { text: 'I hate it', label: 'negative' },
        { text: 'Terrible experience', label: 'negative' },
      ]

      const response = await service.classifyText(['This is wonderful', 'Awful'], examples)

      expect(response).toHaveProperty('classifications')
      expect(Array.isArray(response.classifications)).toBe(true)
    })
  })

  // ── Tokenization ──

  describe('tokenizeText + detokenizeText', () => {
    let tokens

    it('tokenizes text', async () => {
      const response = await service.tokenizeText('tokenize me!')

      expect(response).toHaveProperty('tokens')
      expect(Array.isArray(response.tokens)).toBe(true)
      tokens = response.tokens
    })

    it('detokenizes the tokens back to text', async () => {
      const response = await service.detokenizeText(tokens)

      expect(response).toHaveProperty('text')
      expect(typeof response.text).toBe('string')
    })
  })

  // ── Datasets ──

  describe('getDatasetUsage', () => {
    it('returns organization usage', async () => {
      const response = await service.getDatasetUsage()

      expect(response).toHaveProperty('organization_usage')
    })
  })

  describe('listDatasets', () => {
    it('returns datasets with expected shape', async () => {
      const response = await service.listDatasets(undefined, undefined, 5)

      expect(response).toHaveProperty('datasets')
      expect(Array.isArray(response.datasets)).toBe(true)
    })
  })

  describe('getDatasetsDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getDatasetsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('createDataset + getDataset + deleteDataset', () => {
    let datasetId

    it('creates a dataset from inline content', async () => {
      const content = [
        JSON.stringify({ text: 'The quick brown fox.' }),
        JSON.stringify({ text: 'Jumps over the lazy dog.' }),
      ].join('\n')

      const response = await service.createDataset(
        `e2e-dataset-${ suffix }`,
        'Embed Input',
        undefined,
        content,
        `e2e-${ suffix }.jsonl`
      )

      expect(response).toHaveProperty('id')
      datasetId = response.id
    })

    it('retrieves the created dataset', async () => {
      if (!datasetId) {
        return
      }

      const response = await service.getDataset(datasetId)

      expect(response).toHaveProperty('dataset')
      expect(response.dataset).toHaveProperty('id', datasetId)
    })

    it('deletes the created dataset', async () => {
      if (!datasetId) {
        return
      }

      const response = await service.deleteDataset(datasetId)

      expect(response).toEqual(expect.objectContaining({ deleted: true, datasetId }))
    })
  })

  // ── Embed Jobs ──

  describe('listEmbedJobs', () => {
    it('returns embed jobs with expected shape', async () => {
      const response = await service.listEmbedJobs()

      expect(response).toHaveProperty('embed_jobs')
      expect(Array.isArray(response.embed_jobs)).toBe(true)
    })
  })

  describe('getEmbedJobsDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getEmbedJobsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getEmbedJob', () => {
    // Only runs if the developer supplies a real embed job id.
    it('fetches an embed job when testValues.embedJobId is set', async () => {
      if (!testValues.embedJobId) {
        console.log('Skipping getEmbedJob: set testValues.embedJobId to a real embed job id')
        return
      }

      const response = await service.getEmbedJob(testValues.embedJobId)

      expect(response).toHaveProperty('job_id')
    })
  })

  // ── Batches ──

  describe('listBatches', () => {
    it('returns batches with expected shape', async () => {
      const response = await service.listBatches(5)

      expect(response).toHaveProperty('batches')
      expect(Array.isArray(response.batches)).toBe(true)
    })
  })

  describe('getBatchesDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getBatchesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getBatch', () => {
    // Only runs if the developer supplies a real batch id.
    it('fetches a batch when testValues.batchId is set', async () => {
      if (!testValues.batchId) {
        console.log('Skipping getBatch: set testValues.batchId to a real batch id')
        return
      }

      const response = await service.getBatch(testValues.batchId)

      expect(response).toHaveProperty('batch')
    })
  })

  // ── Audio ──

  describe('transcribeAudio', () => {
    // Transcription needs a hosted audio file, so this only runs when the
    // developer supplies testValues.audioFileUrl.
    it('transcribes audio when testValues.audioFileUrl is set', async () => {
      if (!testValues.audioFileUrl) {
        console.log('Skipping transcribeAudio: set testValues.audioFileUrl to a public audio URL')
        return
      }

      const response = await service.transcribeAudio(
        testValues.audioFileUrl,
        testValues.audioLanguage || 'en'
      )

      expect(response).toHaveProperty('text')
      expect(typeof response.text).toBe('string')
    })
  })
})
