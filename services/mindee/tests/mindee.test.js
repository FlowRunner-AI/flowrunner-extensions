'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-mindee-api-key'
const BASE = 'https://api-v2.mindee.net/v2'

// Reusable mock responses
const ENQUEUE_RESPONSE = {
  job: {
    id: 'job-111-222-333',
    model_id: 'model-uuid',
    status: 'Processing',
    polling_url: `${ BASE }/jobs/job-111-222-333`,
    result_url: null,
    filename: 'invoice.pdf',
  },
}

const POLL_PROCESSED_RESPONSE = {
  job: {
    id: 'inference-aaa-bbb',
    status: 'Processed',
    model_id: 'model-uuid',
    result_url: `${ BASE }/products/extraction/results/inference-aaa-bbb`,
  },
}

const INFERENCE_RESPONSE = {
  inference: {
    id: 'inference-aaa-bbb',
    model: { id: 'model-uuid' },
    result: {
      fields: {
        supplier_name: { value: 'ACME Corp' },
        total_amount: { value: 110 },
        invoice_number: { value: 'INV-001' },
        line_items: {
          items: [
            {
              fields: {
                description: { value: 'Widget A' },
                quantity: { value: 2 },
                total_amount: { value: 100 },
              },
            },
          ],
        },
      },
    },
  },
}

const FILE_URL = 'https://example.com/invoice.pdf'

describe('Mindee Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ apiKey: API_KEY })
    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()
  })

  afterEach(() => {
    mock.reset()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Registration ──

  describe('service registration', () => {
    it('registers with correct config items', () => {
      expect(sandbox.getConfigItems()).toEqual([
        expect.objectContaining({
          name: 'apiKey',
          displayName: 'API Key',
          required: true,
          shared: false,
          type: 'STRING',
        }),
      ])
    })

    it('sends the raw API key in the Authorization header', async () => {
      mock.onGet(FILE_URL).reply(Buffer.from('pdf-bytes'))
      mock.onPost(`${ BASE }/products/extraction/enqueue`).reply(ENQUEUE_RESPONSE)
      mock.onGet(`${ BASE }/jobs/job-111-222-333`).reply(POLL_PROCESSED_RESPONSE)
      mock.onGet(`${ BASE }/products/extraction/results/inference-aaa-bbb`).reply(INFERENCE_RESPONSE)

      await service.extractDocument('model-uuid', FILE_URL)

      // Check the enqueue POST (index 1 after the file download at index 0)
      expect(mock.history[1].headers).toMatchObject({ Authorization: API_KEY })
    })
  })

  // ── extractDocument ──

  describe('extractDocument', () => {
    it('downloads the file, enqueues, polls, fetches result, and flattens fields', async () => {
      mock.onGet(FILE_URL).reply(Buffer.from('pdf-bytes'))
      mock.onPost(`${ BASE }/products/extraction/enqueue`).reply(ENQUEUE_RESPONSE)
      mock.onGet(`${ BASE }/jobs/job-111-222-333`).reply(POLL_PROCESSED_RESPONSE)
      mock.onGet(`${ BASE }/products/extraction/results/inference-aaa-bbb`).reply(INFERENCE_RESPONSE)

      const result = await service.extractDocument('model-uuid', FILE_URL)

      // 4 requests total: download, enqueue, poll, fetch result
      expect(mock.history).toHaveLength(4)

      // 1. File download
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(FILE_URL)
      expect(mock.history[0].encoding).toBeNull()

      // 2. Enqueue POST (multipart)
      expect(mock.history[1].method).toBe('post')
      expect(mock.history[1].url).toBe(`${ BASE }/products/extraction/enqueue`)
      const fields = mock.history[1].formData._fields
      expect(fields).toContainEqual(expect.objectContaining({ name: 'model_id', value: 'model-uuid' }))
      expect(fields).toContainEqual(expect.objectContaining({ name: 'file' }))
      expect(fields).toContainEqual(expect.objectContaining({ name: 'filename', value: 'invoice.pdf' }))

      // 3. Poll job
      expect(mock.history[2].method).toBe('get')
      expect(mock.history[2].url).toBe(`${ BASE }/jobs/job-111-222-333`)
      expect(mock.history[2].query).toMatchObject({ redirect: false })

      // 4. Fetch result
      expect(mock.history[3].method).toBe('get')
      expect(mock.history[3].url).toBe(`${ BASE }/products/extraction/results/inference-aaa-bbb`)

      // Flattened result
      expect(result.status).toBe('Processed')
      expect(result.inferenceId).toBe('inference-aaa-bbb')
      expect(result.fields).toEqual({
        supplier_name: 'ACME Corp',
        total_amount: 110,
        invoice_number: 'INV-001',
        line_items: [
          { description: 'Widget A', quantity: 2, total_amount: 100 },
        ],
      })
      expect(result.raw).toHaveProperty('inference')
    })

    it('does not append confidence/raw_text options when booleans are falsy', async () => {
      mock.onGet(FILE_URL).reply(Buffer.from('pdf'))
      mock.onPost(`${ BASE }/products/extraction/enqueue`).reply(ENQUEUE_RESPONSE)
      mock.onGet(`${ BASE }/jobs/job-111-222-333`).reply(POLL_PROCESSED_RESPONSE)
      mock.onGet(`${ BASE }/products/extraction/results/inference-aaa-bbb`).reply(INFERENCE_RESPONSE)

      await service.extractDocument('model-uuid', FILE_URL, false, false)

      const fieldNames = mock.history[1].formData._fields.map(f => f.name)

      expect(fieldNames).not.toContain('confidence')
      expect(fieldNames).not.toContain('raw_text')
    })

    it('appends confidence and raw_text options when true', async () => {
      mock.onGet(FILE_URL).reply(Buffer.from('pdf'))
      mock.onPost(`${ BASE }/products/extraction/enqueue`).reply(ENQUEUE_RESPONSE)
      mock.onGet(`${ BASE }/jobs/job-111-222-333`).reply(POLL_PROCESSED_RESPONSE)
      mock.onGet(`${ BASE }/products/extraction/results/inference-aaa-bbb`).reply(INFERENCE_RESPONSE)

      await service.extractDocument('model-uuid', FILE_URL, true, true)

      const fields = mock.history[1].formData._fields

      expect(fields).toContainEqual(expect.objectContaining({ name: 'confidence', value: 'true' }))
      expect(fields).toContainEqual(expect.objectContaining({ name: 'raw_text', value: 'true' }))
    })

    it('throws when enqueue does not return a job id', async () => {
      mock.onGet(FILE_URL).reply(Buffer.from('pdf'))
      mock.onPost(`${ BASE }/products/extraction/enqueue`).reply({})

      await expect(service.extractDocument('model-uuid', FILE_URL))
        .rejects.toThrow('enqueue did not return a job id')
    })

    it('throws when the job fails', async () => {
      mock.onGet(FILE_URL).reply(Buffer.from('pdf'))
      mock.onPost(`${ BASE }/products/extraction/enqueue`).reply(ENQUEUE_RESPONSE)
      mock.onGet(`${ BASE }/jobs/job-111-222-333`).reply({
        job: {
          id: 'job-111-222-333',
          status: 'Failed',
          error: { detail: 'Unsupported file type' },
        },
      })

      await expect(service.extractDocument('model-uuid', FILE_URL))
        .rejects.toThrow('Unsupported file type')
    })

    it('throws when model ID is missing', async () => {
      await expect(service.extractDocument(null, FILE_URL))
        .rejects.toThrow('a model ID is required')
    })

    it('throws when document URL is missing', async () => {
      await expect(service.extractDocument('model-uuid', null))
        .rejects.toThrow('a document URL is required')
    })

    it('throws a normalized error on API failure during enqueue', async () => {
      mock.onGet(FILE_URL).reply(Buffer.from('pdf'))
      mock.onPost(`${ BASE }/products/extraction/enqueue`).replyWithError({
        message: 'Bad Request',
        body: { detail: 'Invalid model ID', status: 400 },
      })

      await expect(service.extractDocument('model-uuid', FILE_URL))
        .rejects.toThrow('Mindee API error: Invalid model ID')
    })

    it('derives filename from URL with query params', async () => {
      const urlWithQuery = 'https://example.com/path/my-doc.png?token=abc'

      mock.onGet(urlWithQuery).reply(Buffer.from('img'))
      mock.onPost(`${ BASE }/products/extraction/enqueue`).reply(ENQUEUE_RESPONSE)
      mock.onGet(`${ BASE }/jobs/job-111-222-333`).reply(POLL_PROCESSED_RESPONSE)
      mock.onGet(`${ BASE }/products/extraction/results/inference-aaa-bbb`).reply(INFERENCE_RESPONSE)

      await service.extractDocument('model-uuid', urlWithQuery)

      const fields = mock.history[1].formData._fields

      expect(fields).toContainEqual(expect.objectContaining({ name: 'filename', value: 'my-doc.png' }))
    })

    it('uses a fallback filename when URL has no extension', async () => {
      const noExtUrl = 'https://example.com/document'

      mock.onGet(noExtUrl).reply(Buffer.from('data'))
      mock.onPost(`${ BASE }/products/extraction/enqueue`).reply(ENQUEUE_RESPONSE)
      mock.onGet(`${ BASE }/jobs/job-111-222-333`).reply(POLL_PROCESSED_RESPONSE)
      mock.onGet(`${ BASE }/products/extraction/results/inference-aaa-bbb`).reply(INFERENCE_RESPONSE)

      await service.extractDocument('model-uuid', noExtUrl)

      const filenameField = mock.history[1].formData._fields.find(f => f.name === 'filename')

      expect(filenameField.value).toMatch(/^document_\d+\.pdf$/)
    })
  })

  // ── enqueueInference ──

  describe('enqueueInference', () => {
    it('enqueues and returns the job object', async () => {
      mock.onGet(FILE_URL).reply(Buffer.from('pdf'))
      mock.onPost(`${ BASE }/products/extraction/enqueue`).reply(ENQUEUE_RESPONSE)

      const result = await service.enqueueInference('model-uuid', FILE_URL)

      expect(result).toMatchObject({
        id: 'job-111-222-333',
        model_id: 'model-uuid',
        status: 'Processing',
      })
      expect(mock.history).toHaveLength(2)
    })

    it('does not append webhook_ids when array is empty', async () => {
      mock.onGet(FILE_URL).reply(Buffer.from('pdf'))
      mock.onPost(`${ BASE }/products/extraction/enqueue`).reply(ENQUEUE_RESPONSE)

      await service.enqueueInference('model-uuid', FILE_URL, [])

      const fieldNames = mock.history[1].formData._fields.map(f => f.name)

      expect(fieldNames).not.toContain('webhook_ids')
    })

    it('appends webhook_ids as comma-separated string', async () => {
      mock.onGet(FILE_URL).reply(Buffer.from('pdf'))
      mock.onPost(`${ BASE }/products/extraction/enqueue`).reply(ENQUEUE_RESPONSE)

      await service.enqueueInference('model-uuid', FILE_URL, ['wh-1', 'wh-2'])

      const fields = mock.history[1].formData._fields

      expect(fields).toContainEqual(
        expect.objectContaining({ name: 'webhook_ids', value: 'wh-1,wh-2' })
      )
    })

    it('appends alias when provided', async () => {
      mock.onGet(FILE_URL).reply(Buffer.from('pdf'))
      mock.onPost(`${ BASE }/products/extraction/enqueue`).reply(ENQUEUE_RESPONSE)

      await service.enqueueInference('model-uuid', FILE_URL, null, 'my-batch-1')

      const fields = mock.history[1].formData._fields

      expect(fields).toContainEqual(
        expect.objectContaining({ name: 'alias', value: 'my-batch-1' })
      )
    })

    it('throws when model ID is missing', async () => {
      await expect(service.enqueueInference(null, FILE_URL))
        .rejects.toThrow('a model ID is required')
    })

    it('throws when document URL is missing', async () => {
      await expect(service.enqueueInference('model-uuid', null))
        .rejects.toThrow('a document URL is required')
    })
  })

  // ── getJobStatus ──

  describe('getJobStatus', () => {
    it('fetches job status with redirect=false', async () => {
      mock.onGet(`${ BASE }/jobs/job-123`).reply({
        job: {
          id: 'job-123',
          status: 'Processing',
          model_id: 'model-uuid',
        },
      })

      const result = await service.getJobStatus('job-123')

      expect(result).toMatchObject({ id: 'job-123', status: 'Processing' })
      expect(mock.history[0].query).toMatchObject({ redirect: false })
    })

    it('throws when job ID is missing', async () => {
      await expect(service.getJobStatus(null))
        .rejects.toThrow('a job ID is required')
    })

    it('throws when job ID is empty string', async () => {
      await expect(service.getJobStatus(''))
        .rejects.toThrow('a job ID is required')
    })

    it('throws a normalized error on API failure', async () => {
      mock.onGet(`${ BASE }/jobs/bad-id`).replyWithError({
        message: 'Not Found',
        body: { detail: 'Job not found', status: 404 },
      })

      await expect(service.getJobStatus('bad-id'))
        .rejects.toThrow('Mindee API error: Job not found')
    })
  })

  // ── getInferenceResult ──

  describe('getInferenceResult', () => {
    it('fetches and flattens the inference result', async () => {
      mock.onGet(`${ BASE }/products/extraction/results/inf-123`).reply(INFERENCE_RESPONSE)

      const result = await service.getInferenceResult('inf-123')

      expect(result.inferenceId).toBe('inference-aaa-bbb')
      expect(result.fields).toEqual({
        supplier_name: 'ACME Corp',
        total_amount: 110,
        invoice_number: 'INV-001',
        line_items: [
          { description: 'Widget A', quantity: 2, total_amount: 100 },
        ],
      })
      expect(result.raw).toHaveProperty('inference')
    })

    it('handles inference with no fields', async () => {
      mock.onGet(`${ BASE }/products/extraction/results/inf-456`).reply({
        inference: {
          id: 'inf-456',
          model: { id: 'model-uuid' },
          result: { fields: {} },
        },
      })

      const result = await service.getInferenceResult('inf-456')

      expect(result.inferenceId).toBe('inf-456')
      expect(result.fields).toEqual({})
    })

    it('handles inference with null result fields', async () => {
      mock.onGet(`${ BASE }/products/extraction/results/inf-789`).reply({
        inference: {
          id: 'inf-789',
          model: { id: 'model-uuid' },
          result: { fields: null },
        },
      })

      const result = await service.getInferenceResult('inf-789')

      expect(result.fields).toBeNull()
    })

    it('throws when inference ID is missing', async () => {
      await expect(service.getInferenceResult(null))
        .rejects.toThrow('an inference ID is required')
    })

    it('throws when inference ID is empty string', async () => {
      await expect(service.getInferenceResult(''))
        .rejects.toThrow('an inference ID is required')
    })

    it('throws a normalized error on API failure', async () => {
      mock.onGet(`${ BASE }/products/extraction/results/bad-id`).replyWithError({
        message: 'Not Found',
        body: { detail: 'Inference not found', status: 404 },
      })

      await expect(service.getInferenceResult('bad-id'))
        .rejects.toThrow('Mindee API error: Inference not found')
    })
  })

  // ── Error handling (RFC 9457 format) ──

  describe('error handling', () => {
    it('joins field-level errors from RFC 9457 format', async () => {
      mock.onGet(`${ BASE }/jobs/err-job`).replyWithError({
        message: 'Validation error',
        body: {
          detail: 'Request validation failed',
          status: 422,
          errors: [
            { pointer: '/model_id', detail: 'Invalid UUID format' },
            { pointer: '/file', detail: 'File too large' },
          ],
        },
      })

      await expect(service.getJobStatus('err-job'))
        .rejects.toThrow('Mindee API error: Request validation failed — Invalid UUID format; File too large')
    })

    it('uses title when detail is absent', async () => {
      mock.onGet(`${ BASE }/jobs/err-job2`).replyWithError({
        message: 'Server Error',
        body: { title: 'Internal Server Error', status: 500 },
      })

      await expect(service.getJobStatus('err-job2'))
        .rejects.toThrow('Mindee API error: Internal Server Error')
    })

    it('falls back to error.message when body has no detail or title', async () => {
      mock.onGet(`${ BASE }/jobs/err-job3`).replyWithError({
        message: 'Network timeout',
      })

      await expect(service.getJobStatus('err-job3'))
        .rejects.toThrow('Mindee API error: Network timeout')
    })
  })

  // ── Field flattening edge cases ──

  describe('field flattening', () => {
    it('flattens nested ObjectFieldResult nodes', async () => {
      mock.onGet(`${ BASE }/products/extraction/results/flat-1`).reply({
        inference: {
          id: 'flat-1',
          result: {
            fields: {
              address: {
                fields: {
                  street: { value: '123 Main St' },
                  city: { value: 'Springfield' },
                },
              },
            },
          },
        },
      })

      const result = await service.getInferenceResult('flat-1')

      expect(result.fields).toEqual({
        address: { street: '123 Main St', city: 'Springfield' },
      })
    })

    it('flattens ListFieldResult with nested ObjectFieldResult items', async () => {
      mock.onGet(`${ BASE }/products/extraction/results/flat-2`).reply({
        inference: {
          id: 'flat-2',
          result: {
            fields: {
              items: {
                items: [
                  { fields: { name: { value: 'A' }, qty: { value: 1 } } },
                  { fields: { name: { value: 'B' }, qty: { value: 2 } } },
                ],
              },
            },
          },
        },
      })

      const result = await service.getInferenceResult('flat-2')

      expect(result.fields).toEqual({
        items: [
          { name: 'A', qty: 1 },
          { name: 'B', qty: 2 },
        ],
      })
    })

    it('handles ListFieldResult with simple value items', async () => {
      mock.onGet(`${ BASE }/products/extraction/results/flat-3`).reply({
        inference: {
          id: 'flat-3',
          result: {
            fields: {
              tags: {
                items: [
                  { value: 'urgent' },
                  { value: 'invoice' },
                ],
              },
            },
          },
        },
      })

      const result = await service.getInferenceResult('flat-3')

      expect(result.fields).toEqual({ tags: ['urgent', 'invoice'] })
    })

    it('passes through unknown node shapes unchanged', async () => {
      mock.onGet(`${ BASE }/products/extraction/results/flat-4`).reply({
        inference: {
          id: 'flat-4',
          result: {
            fields: {
              custom: { foo: 'bar', baz: 42 },
            },
          },
        },
      })

      const result = await service.getInferenceResult('flat-4')

      expect(result.fields).toEqual({ custom: { foo: 'bar', baz: 42 } })
    })
  })
})
