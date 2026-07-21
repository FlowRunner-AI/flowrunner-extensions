'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('AWS Textract Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('aws-textract')
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

  // ── Synchronous operations ──

  describe('detectDocumentText', () => {
    it('detects text from an S3 document', async () => {
      if (!testValues.s3Bucket || !testValues.s3ObjectName) {
        console.log('Skipping: s3Bucket and s3ObjectName test values required')

        return
      }

      const result = await service.detectDocumentText(null, testValues.s3Bucket, testValues.s3ObjectName)

      expect(result).toHaveProperty('text')
      expect(typeof result.text).toBe('string')
      expect(result).toHaveProperty('blocks')
      expect(Array.isArray(result.blocks)).toBe(true)
      expect(result).toHaveProperty('lineCount')
      expect(typeof result.lineCount).toBe('number')
      expect(result).toHaveProperty('pages')
      expect(result.pages).toBeGreaterThanOrEqual(1)
    })

    it('detects text from a file URL', async () => {
      if (!testValues.fileUrl) {
        console.log('Skipping: fileUrl test value required')

        return
      }

      const result = await service.detectDocumentText(testValues.fileUrl)

      expect(result).toHaveProperty('text')
      expect(typeof result.text).toBe('string')
      expect(result).toHaveProperty('blocks')
      expect(Array.isArray(result.blocks)).toBe(true)
      expect(result).toHaveProperty('lineCount')
      expect(result).toHaveProperty('pages')
    })

    it('throws when no document source is provided', async () => {
      await expect(service.detectDocumentText()).rejects.toThrow()
    })
  })

  describe('analyzeDocument', () => {
    it('analyzes a document with FORMS feature', async () => {
      if (!testValues.s3Bucket || !testValues.s3ObjectName) {
        console.log('Skipping: s3Bucket and s3ObjectName test values required')

        return
      }

      const result = await service.analyzeDocument(
        ['FORMS'], null, testValues.s3Bucket, testValues.s3ObjectName
      )

      expect(result).toHaveProperty('forms')
      expect(typeof result.forms).toBe('object')
      expect(result).toHaveProperty('queries')
      expect(result).toHaveProperty('tables')
      expect(Array.isArray(result.tables)).toBe(true)
      expect(result).toHaveProperty('text')
      expect(result).toHaveProperty('blocks')
      expect(result).toHaveProperty('pages')
    })

    it('analyzes a document with TABLES feature', async () => {
      if (!testValues.s3Bucket || !testValues.s3ObjectName) {
        console.log('Skipping: s3Bucket and s3ObjectName test values required')

        return
      }

      const result = await service.analyzeDocument(
        ['TABLES'], null, testValues.s3Bucket, testValues.s3ObjectName
      )

      expect(result).toHaveProperty('tables')
      expect(Array.isArray(result.tables)).toBe(true)
      expect(result).toHaveProperty('blocks')
    })

    it('throws when featureTypes is empty', async () => {
      await expect(service.analyzeDocument([])).rejects.toThrow('featureTypes is required')
    })
  })

  describe('analyzeExpense', () => {
    it('analyzes an expense document from S3', async () => {
      if (!testValues.s3Bucket || !testValues.s3ObjectName) {
        console.log('Skipping: s3Bucket and s3ObjectName test values required')

        return
      }

      const result = await service.analyzeExpense(null, testValues.s3Bucket, testValues.s3ObjectName)

      expect(result).toHaveProperty('summaryFields')
      expect(Array.isArray(result.summaryFields)).toBe(true)
      expect(result).toHaveProperty('lineItems')
      expect(Array.isArray(result.lineItems)).toBe(true)
      expect(result).toHaveProperty('pages')
    })
  })

  describe('analyzeId', () => {
    it('throws when no document source is provided', async () => {
      await expect(service.analyzeId()).rejects.toThrow()
    })
  })

  // ── Asynchronous operations ──

  describe('startDocumentTextDetection + getDocumentTextDetection', () => {
    it('starts an async text detection job and retrieves status', async () => {
      if (!testValues.s3Bucket || !testValues.s3ObjectName) {
        console.log('Skipping: s3Bucket and s3ObjectName test values required')

        return
      }

      const startResult = await service.startDocumentTextDetection(
        testValues.s3Bucket, testValues.s3ObjectName
      )

      expect(startResult).toHaveProperty('jobId')
      expect(typeof startResult.jobId).toBe('string')
      expect(startResult.jobId.length).toBeGreaterThan(0)

      // Check the job status (it may be IN_PROGRESS or SUCCEEDED)
      const getResult = await service.getDocumentTextDetection(startResult.jobId)

      expect(getResult).toHaveProperty('jobStatus')
      expect(['IN_PROGRESS', 'SUCCEEDED', 'FAILED', 'PARTIAL_SUCCESS']).toContain(getResult.jobStatus)
      expect(getResult).toHaveProperty('blocks')
      expect(Array.isArray(getResult.blocks)).toBe(true)
    })

    it('throws when s3Bucket is missing', async () => {
      await expect(service.startDocumentTextDetection(null, 'key')).rejects.toThrow()
    })

    it('throws when jobId is missing', async () => {
      await expect(service.getDocumentTextDetection()).rejects.toThrow('jobId is required')
    })
  })

  describe('startDocumentAnalysis + getDocumentAnalysis', () => {
    it('starts an async analysis job and retrieves status', async () => {
      if (!testValues.s3Bucket || !testValues.s3ObjectName) {
        console.log('Skipping: s3Bucket and s3ObjectName test values required')

        return
      }

      const startResult = await service.startDocumentAnalysis(
        ['TABLES'], testValues.s3Bucket, testValues.s3ObjectName
      )

      expect(startResult).toHaveProperty('jobId')
      expect(typeof startResult.jobId).toBe('string')

      const getResult = await service.getDocumentAnalysis(startResult.jobId)

      expect(getResult).toHaveProperty('jobStatus')
      expect(['IN_PROGRESS', 'SUCCEEDED', 'FAILED', 'PARTIAL_SUCCESS']).toContain(getResult.jobStatus)
      expect(getResult).toHaveProperty('forms')
      expect(getResult).toHaveProperty('queries')
      expect(getResult).toHaveProperty('tables')
      expect(getResult).toHaveProperty('blocks')
    })

    it('throws when featureTypes is empty', async () => {
      await expect(
        service.startDocumentAnalysis([], 'bucket', 'key')
      ).rejects.toThrow('featureTypes is required')
    })

    it('throws when jobId is missing', async () => {
      await expect(service.getDocumentAnalysis()).rejects.toThrow('jobId is required')
    })
  })
})
