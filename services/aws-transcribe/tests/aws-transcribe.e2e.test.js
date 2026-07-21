'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('AWS Transcribe Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('aws-transcribe')
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

  // ── List operations (read-only, always safe) ──

  describe('listTranscriptionJobs', () => {
    it('returns jobs array with expected shape', async () => {
      const result = await service.listTranscriptionJobs(null, null, 5)

      expect(result).toHaveProperty('jobs')
      expect(Array.isArray(result.jobs)).toBe(true)
      expect(result).toHaveProperty('cursor')
    })

    it('filters by status', async () => {
      const result = await service.listTranscriptionJobs('COMPLETED', null, 5)

      expect(result).toHaveProperty('jobs')
      expect(Array.isArray(result.jobs)).toBe(true)

      for (const job of result.jobs) {
        expect(job.status).toBe('COMPLETED')
      }
    })
  })

  describe('listVocabularies', () => {
    it('returns vocabularies array with expected shape', async () => {
      const result = await service.listVocabularies(null, null, 5)

      expect(result).toHaveProperty('vocabularies')
      expect(Array.isArray(result.vocabularies)).toBe(true)
      expect(result).toHaveProperty('cursor')
    })
  })

  // ── Dictionary methods ──

  describe('getTranscriptionJobsDictionary', () => {
    it('returns dictionary items with label/value/note', async () => {
      const result = await service.getTranscriptionJobsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
        expect(result.items[0]).toHaveProperty('note')
      }
    })
  })

  describe('getVocabulariesDictionary', () => {
    it('returns dictionary items with label/value/note', async () => {
      const result = await service.getVocabulariesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
        expect(result.items[0]).toHaveProperty('note')
      }
    })
  })

  // ── Vocabulary CRUD lifecycle ──

  describe('vocabulary lifecycle (create + get + delete)', () => {
    const vocabName = `e2e-test-vocab-${Date.now()}`

    it('creates a vocabulary', async () => {
      const result = await service.createVocabulary(vocabName, 'en-US', ['FlowRunner', 'Backendless'])

      expect(result).toHaveProperty('vocabularyName', vocabName)
      expect(result).toHaveProperty('languageCode', 'en-US')
      expect(result).toHaveProperty('vocabularyState')
      expect(['PENDING', 'READY']).toContain(result.vocabularyState)
    })

    it('gets the created vocabulary', async () => {
      const result = await service.getVocabulary(vocabName)

      expect(result).toHaveProperty('vocabularyName', vocabName)
      expect(result).toHaveProperty('vocabularyState')
    })

    it('deletes the created vocabulary', async () => {
      const result = await service.deleteVocabulary(vocabName)

      expect(result).toEqual({ deleted: true, vocabularyName: vocabName })
    })
  })

  // ── Transcription Job lifecycle (requires S3 media file) ──

  describe('transcription job lifecycle', () => {
    const jobName = `e2e-test-job-${Date.now()}`
    const mediaUri = testValues.mediaFileUri

    beforeAll(() => {
      if (!mediaUri) {
        console.warn(
          'Skipping transcription job lifecycle tests: no mediaFileUri in testValues.\n' +
          'Add a valid S3 URI (e.g. s3://my-bucket/audio.mp3) to e2e-config.json under aws-transcribe.testValues.mediaFileUri'
        )
      }
    })

    it('starts a transcription job', async () => {
      if (!mediaUri) return

      const result = await service.startTranscriptionJob(jobName, mediaUri, 'en-US')

      expect(result).toHaveProperty('transcriptionJobName', jobName)
      expect(result).toHaveProperty('status')
      expect(['QUEUED', 'IN_PROGRESS']).toContain(result.status)
    })

    it('gets the started job', async () => {
      if (!mediaUri) return

      const result = await service.getTranscriptionJob(jobName)

      expect(result).toHaveProperty('transcriptionJobName', jobName)
      expect(result).toHaveProperty('status')
    })

    it('deletes the started job', async () => {
      if (!mediaUri) return

      const result = await service.deleteTranscriptionJob(jobName)

      expect(result).toEqual({ deleted: true, transcriptionJobName: jobName })
    })
  })
})
