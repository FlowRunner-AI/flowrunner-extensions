'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('TurboDocx Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('turbodocx-service')
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

  // ── Dictionary ──

  describe('getTemplatesDictionary', () => {
    it('returns items array and cursor', async () => {
      const result = await service.getTemplatesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor')

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
        expect(result.items[0]).toHaveProperty('note')
      }
    })

    it('handles null payload', async () => {
      const result = await service.getTemplatesDictionary(null)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })

    it('handles search parameter', async () => {
      const result = await service.getTemplatesDictionary({ search: 'nonexistent_xyz_query' })

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Templates ──

  describe('getTemplateVariables', () => {
    it('retrieves variables for a template', async () => {
      const { templateId } = testValues

      if (!templateId) {
        console.log('Skipping: testValues.templateId not set')
        return
      }

      const result = await service.getTemplateVariables(templateId)

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('name')
      expect(result).toHaveProperty('variables')
      expect(Array.isArray(result.variables)).toBe(true)
    })

    it('throws when templateId is empty', async () => {
      await expect(service.getTemplateVariables()).rejects.toThrow('Template ID is required')
    })
  })

  describe('getTemplateById', () => {
    it('retrieves full template details', async () => {
      const { templateId } = testValues

      if (!templateId) {
        console.log('Skipping: testValues.templateId not set')
        return
      }

      const result = await service.getTemplateById(templateId)

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('name')
    })
  })

  describe('getTemplatePreviewLink', () => {
    it('returns a preview URL', async () => {
      const { templateId } = testValues

      if (!templateId) {
        console.log('Skipping: testValues.templateId not set')
        return
      }

      const result = await service.getTemplatePreviewLink(templateId)

      expect(result).toBeDefined()
    })
  })

  // ── Tags ──

  describe('createTag', () => {
    it('creates and returns a tag', async () => {
      const tagName = `e2e-test-tag-${Date.now()}`

      const result = await service.createTag(tagName)

      expect(result).toBeDefined()
    })
  })

  // ── Document Generation ──

  describe('generateDocument', () => {
    it('generates a document from a template with variables', async () => {
      const { templateId } = testValues

      if (!templateId) {
        console.log('Skipping: testValues.templateId not set')
        return
      }

      const result = await service.generateDocument(
        templateId,
        `E2E Test Doc ${Date.now()}`,
        { TestVar: 'TestValue' }
      )

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('name')
      expect(result).toHaveProperty('templateId')
    })
  })

  describe('createDeliverable', () => {
    it('creates a deliverable with raw variables array', async () => {
      const { templateId } = testValues

      if (!templateId) {
        console.log('Skipping: testValues.templateId not set')
        return
      }

      const variables = JSON.stringify([
        { name: 'TestVar', placeholder: '{TestVar}', text: 'TestValue', mimeType: 'text' },
      ])

      const result = await service.createDeliverable(
        templateId,
        `E2E Deliverable ${Date.now()}`,
        variables
      )

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('name')
    })
  })

  // ── Bulk Signatures ──

  describe('listAllBatches', () => {
    it('returns batches array and totalRecords', async () => {
      const result = await service.listAllBatches()

      expect(result).toHaveProperty('batches')
      expect(Array.isArray(result.batches)).toBe(true)
      expect(result).toHaveProperty('totalRecords')
    })

    it('supports pagination parameters', async () => {
      const result = await service.listAllBatches(5, 0)

      expect(result).toHaveProperty('batches')
      expect(Array.isArray(result.batches)).toBe(true)
    })
  })

  describe('listJobsInBatch', () => {
    it('returns jobs for a batch', async () => {
      const { batchId } = testValues

      if (!batchId) {
        console.log('Skipping: testValues.batchId not set')
        return
      }

      const result = await service.listJobsInBatch(batchId)

      expect(result).toHaveProperty('jobs')
      expect(Array.isArray(result.jobs)).toBe(true)
      expect(result).toHaveProperty('batchId')
    })
  })

  // ── E-Signature Downloads ──

  describe('downloadSignedDocument', () => {
    it('returns download URL for a signed document', async () => {
      const { signedDocumentId } = testValues

      if (!signedDocumentId) {
        console.log('Skipping: testValues.signedDocumentId not set')
        return
      }

      const result = await service.downloadSignedDocument(signedDocumentId)

      expect(result).toHaveProperty('downloadUrl')
      expect(result).toHaveProperty('fileName')
    })
  })

  describe('getSignatureAuditTrail', () => {
    it('returns audit trail for a document', async () => {
      const { signedDocumentId } = testValues

      if (!signedDocumentId) {
        console.log('Skipping: testValues.signedDocumentId not set')
        return
      }

      const result = await service.getSignatureAuditTrail(signedDocumentId)

      expect(result).toBeDefined()
    })
  })
})
