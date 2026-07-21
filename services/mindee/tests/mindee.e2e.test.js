'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Mindee Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('mindee')
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

  // ── Extract Document (full lifecycle) ──

  describe('extractDocument', () => {
    it('extracts a document and returns flattened fields', async () => {
      if (!testValues.modelId || !testValues.documentUrl) {
        console.log('Skipping extractDocument: set testValues.modelId and testValues.documentUrl')
        return
      }

      const result = await service.extractDocument(testValues.modelId, testValues.documentUrl)

      expect(result).toHaveProperty('status')
      expect(result).toHaveProperty('inferenceId')
      expect(result).toHaveProperty('fields')
      expect(result).toHaveProperty('raw')
      expect(result.raw).toHaveProperty('inference')
      expect(result.status).toBe('Processed')
    }, 120000)
  })

  // ── Enqueue + Get Job Status + Get Inference Result (manual lifecycle) ──

  describe('enqueueInference + getJobStatus + getInferenceResult', () => {
    let jobId
    let inferenceId

    it('enqueues a document for extraction', async () => {
      if (!testValues.modelId || !testValues.documentUrl) {
        console.log('Skipping enqueueInference: set testValues.modelId and testValues.documentUrl')
        return
      }

      const result = await service.enqueueInference(testValues.modelId, testValues.documentUrl)

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('status')
      jobId = result.id
    }, 60000)

    it('polls job status until processed', async () => {
      if (!jobId) {
        console.log('Skipping getJobStatus: no job was enqueued')
        return
      }

      // Poll until the job reaches a terminal state
      let status = 'Processing'
      let job

      for (let attempt = 0; attempt < 30 && status === 'Processing'; attempt++) {
        job = await service.getJobStatus(jobId)
        status = job.status

        if (status === 'Processing') {
          await new Promise(resolve => setTimeout(resolve, 2000))
        }
      }

      expect(job).toHaveProperty('id', jobId)
      expect(['Processed', 'Failed']).toContain(job.status)

      if (job.status === 'Processed') {
        inferenceId = job.id
      }
    }, 120000)

    it('fetches the inference result', async () => {
      if (!inferenceId) {
        console.log('Skipping getInferenceResult: job did not complete or was not enqueued')
        return
      }

      const result = await service.getInferenceResult(inferenceId)

      expect(result).toHaveProperty('inferenceId')
      expect(result).toHaveProperty('fields')
      expect(result).toHaveProperty('raw')
      expect(result.raw).toHaveProperty('inference')
      expect(typeof result.fields).toBe('object')
    })
  })

  // ── Validation errors ──

  describe('validation', () => {
    it('throws when model ID is missing', async () => {
      await expect(service.extractDocument(null, 'https://example.com/doc.pdf'))
        .rejects.toThrow('a model ID is required')
    })

    it('throws when document URL is missing', async () => {
      await expect(service.extractDocument('model-uuid', null))
        .rejects.toThrow('a document URL is required')
    })

    it('throws when job ID is missing for getJobStatus', async () => {
      await expect(service.getJobStatus(null))
        .rejects.toThrow('a job ID is required')
    })

    it('throws when inference ID is missing for getInferenceResult', async () => {
      await expect(service.getInferenceResult(null))
        .rejects.toThrow('an inference ID is required')
    })
  })
})
