'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-api-key'
const ORG_ID = 'test-org-id'
const BASE = 'https://api.turbodocx.com'

describe('TurboDocx Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ apiKey: API_KEY, orgId: ORG_ID })
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
      const configs = sandbox.getConfigItems()

      expect(configs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'apiKey', required: true, shared: false }),
          expect.objectContaining({ name: 'orgId', required: true, shared: false }),
        ])
      )
    })
  })

  // ── Auth Headers ──

  describe('auth headers', () => {
    it('sends correct auth headers on every request', async () => {
      mock.onGet(`${BASE}/template-item`).reply({ data: { results: [], totalRecords: 0 } })

      await service.getTemplatesDictionary({})

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({
        'Authorization': `Bearer ${API_KEY}`,
        'x-rapiddocx-org-id': ORG_ID,
        'User-Agent': 'TurboDocx API Client',
      })
    })
  })

  // ── Dictionary: getTemplatesDictionary ──

  describe('getTemplatesDictionary', () => {
    it('returns mapped items with label, value, and note', async () => {
      mock.onGet(`${BASE}/template-item`).reply({
        data: {
          results: [
            { id: 'tmpl_1', name: 'Sales Proposal', type: 'template' },
            { id: 'tmpl_2', name: 'Invoice', type: 'template' },
          ],
          totalRecords: 2,
        },
      })

      const result = await service.getTemplatesDictionary({})

      expect(result).toEqual({
        items: [
          { label: 'Sales Proposal', value: 'tmpl_1', note: 'ID: tmpl_1' },
          { label: 'Invoice', value: 'tmpl_2', note: 'ID: tmpl_2' },
        ],
        cursor: null,
      })
    })

    it('filters out non-template items', async () => {
      mock.onGet(`${BASE}/template-item`).reply({
        data: {
          results: [
            { id: 'tmpl_1', name: 'Template', type: 'template' },
            { id: 'folder_1', name: 'Folder', type: 'folder' },
          ],
          totalRecords: 2,
        },
      })

      const result = await service.getTemplatesDictionary({})

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('tmpl_1')
    })

    it('passes search query parameter', async () => {
      mock.onGet(`${BASE}/template-item`).reply({
        data: { results: [], totalRecords: 0 },
      })

      await service.getTemplatesDictionary({ search: 'proposal' })

      expect(mock.history[0].query).toMatchObject({
        limit: 50,
        offset: 0,
        query: 'proposal',
      })
    })

    it('uses cursor as offset for pagination', async () => {
      mock.onGet(`${BASE}/template-item`).reply({
        data: { results: [], totalRecords: 100 },
      })

      await service.getTemplatesDictionary({ cursor: '50' })

      expect(mock.history[0].query).toMatchObject({
        limit: 50,
        offset: 50,
      })
    })

    it('returns next cursor when more pages exist', async () => {
      mock.onGet(`${BASE}/template-item`).reply({
        data: {
          results: [{ id: 'tmpl_1', name: 'A', type: 'template' }],
          totalRecords: 100,
        },
      })

      const result = await service.getTemplatesDictionary({})

      expect(result.cursor).toBe('50')
    })

    it('returns null cursor when on last page', async () => {
      mock.onGet(`${BASE}/template-item`).reply({
        data: {
          results: [{ id: 'tmpl_1', name: 'A', type: 'template' }],
          totalRecords: 10,
        },
      })

      const result = await service.getTemplatesDictionary({})

      expect(result.cursor).toBeNull()
    })

    it('handles null payload', async () => {
      mock.onGet(`${BASE}/template-item`).reply({
        data: { results: [{ id: 'tmpl_1', name: 'A', type: 'template' }], totalRecords: 1 },
      })

      const result = await service.getTemplatesDictionary(null)

      expect(result.items).toHaveLength(1)
      expect(result.cursor).toBeNull()
    })

    it('handles null data results', async () => {
      mock.onGet(`${BASE}/template-item`).reply({ data: { results: null, totalRecords: 0 } })

      const result = await service.getTemplatesDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('uses fallback label when name is missing', async () => {
      mock.onGet(`${BASE}/template-item`).reply({
        data: {
          results: [{ id: 'tmpl_1', type: 'template' }],
          totalRecords: 1,
        },
      })

      const result = await service.getTemplatesDictionary({})

      expect(result.items[0].label).toBe('Template tmpl_1')
    })
  })

  // ── Templates ──

  describe('getTemplateVariables', () => {
    it('sends GET to correct URL and returns variables', async () => {
      mock.onGet(`${BASE}/template/tmpl_123`).reply({
        data: {
          results: {
            id: 'tmpl_123',
            name: 'Sales Proposal',
            variables: [
              { placeholder: '{CompanyName}', name: 'CompanyName', subvariables: [] },
              { placeholder: '{Date}', name: 'Date' },
            ],
          },
        },
      })

      const result = await service.getTemplateVariables('tmpl_123')

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(result).toEqual({
        id: 'tmpl_123',
        name: 'Sales Proposal',
        variables: [
          { placeholder: '{CompanyName}', name: 'CompanyName', subvariables: [] },
          { placeholder: '{Date}', name: 'Date', subvariables: [] },
        ],
      })
    })

    it('throws when templateId is not provided', async () => {
      await expect(service.getTemplateVariables()).rejects.toThrow('Template ID is required')
    })

    it('throws on API error', async () => {
      mock.onGet(`${BASE}/template/tmpl_bad`).replyWithError({ message: 'Not Found' })

      await expect(service.getTemplateVariables('tmpl_bad')).rejects.toThrow()
    })
  })

  describe('getTemplateById', () => {
    it('returns full template data', async () => {
      const templateData = {
        id: 'tmpl_123',
        name: 'Sales Proposal',
        fonts: [{ name: 'Arial', count: 12 }],
        defaultFont: 'Arial',
        createdOn: '2026-01-10T08:00:00.000Z',
        variables: [],
      }

      mock.onGet(`${BASE}/template/tmpl_123`).reply({
        data: { results: templateData },
      })

      const result = await service.getTemplateById('tmpl_123')

      expect(result).toEqual(templateData)
    })

    it('throws when templateId is not provided', async () => {
      await expect(service.getTemplateById()).rejects.toThrow('Template ID is required')
    })
  })

  describe('deleteTemplate', () => {
    it('sends DELETE to correct URL', async () => {
      mock.onDelete(`${BASE}/template/tmpl_123`).reply({ success: true, message: 'Template deleted successfully' })

      const result = await service.deleteTemplate('tmpl_123')

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('delete')
      expect(result).toEqual({ success: true, message: 'Template deleted successfully' })
    })

    it('returns default response when API returns falsy', async () => {
      mock.onDelete(`${BASE}/template/tmpl_123`).reply(null)

      const result = await service.deleteTemplate('tmpl_123')

      expect(result).toEqual({ success: true, message: 'Template deleted successfully' })
    })

    it('throws when templateId is not provided', async () => {
      await expect(service.deleteTemplate()).rejects.toThrow('Template ID is required')
    })
  })

  describe('getTemplatePreviewLink', () => {
    it('sends GET and returns preview URL', async () => {
      mock.onGet(`${BASE}/template/tmpl_123/previewpdflink`).reply({
        results: 'https://api.turbodocx.com/preview/tmpl_123.pdf',
      })

      const result = await service.getTemplatePreviewLink('tmpl_123')

      expect(result).toBe('https://api.turbodocx.com/preview/tmpl_123.pdf')
    })

    it('falls back to data.results', async () => {
      mock.onGet(`${BASE}/template/tmpl_123/previewpdflink`).reply({
        data: { results: 'https://preview.url' },
      })

      const result = await service.getTemplatePreviewLink('tmpl_123')

      expect(result).toBe('https://preview.url')
    })

    it('throws when templateId is not provided', async () => {
      await expect(service.getTemplatePreviewLink()).rejects.toThrow('Template ID is required')
    })
  })

  // ── Tags ──

  describe('createTag', () => {
    it('sends POST with tag name', async () => {
      mock.onPost(`${BASE}/Tag`).reply({ data: { results: { id: 'tag_1', name: 'Sales' } } })

      const result = await service.createTag('Sales')

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toEqual({ name: 'Sales' })
      expect(result).toEqual({ id: 'tag_1', name: 'Sales' })
    })

    it('returns response directly when data.results is absent', async () => {
      mock.onPost(`${BASE}/Tag`).reply({ id: 'tag_1', name: 'Legal' })

      const result = await service.createTag('Legal')

      expect(result).toEqual({ id: 'tag_1', name: 'Legal' })
    })

    it('throws when name is not provided', async () => {
      await expect(service.createTag()).rejects.toThrow('Tag name is required')
    })
  })

  // ── Document Generation ──

  describe('generateDocument', () => {
    it('sends POST with variables payload built from object', async () => {
      mock.onPost(`${BASE}/deliverable`).reply({
        data: {
          results: {
            deliverable: {
              id: 'del_1',
              name: 'Q1 Proposal',
              templateId: 'tmpl_1',
              createdOn: '2026-01-15T10:30:00.000Z',
            },
          },
        },
      })

      const result = await service.generateDocument('tmpl_1', 'Q1 Proposal', { CompanyName: 'Acme', Date: '2026-01-15' })

      expect(mock.history[0].body).toEqual({
        templateId: 'tmpl_1',
        name: 'Q1 Proposal',
        variables: [
          { name: 'CompanyName', placeholder: '{CompanyName}', text: 'Acme', mimeType: 'text' },
          { name: 'Date', placeholder: '{Date}', text: '2026-01-15', mimeType: 'text' },
        ],
      })

      expect(result).toEqual({
        id: 'del_1',
        name: 'Q1 Proposal',
        templateId: 'tmpl_1',
        createdOn: '2026-01-15T10:30:00.000Z',
      })
    })

    it('includes description when provided', async () => {
      mock.onPost(`${BASE}/deliverable`).reply({
        data: { results: { deliverable: { id: 'del_1', name: 'Doc', templateId: 'tmpl_1' } } },
      })

      await service.generateDocument('tmpl_1', 'Doc', {}, 'A description')

      expect(mock.history[0].body.description).toBe('A description')
    })

    it('omits description when not provided', async () => {
      mock.onPost(`${BASE}/deliverable`).reply({
        data: { results: { deliverable: { id: 'del_1', name: 'Doc', templateId: 'tmpl_1' } } },
      })

      await service.generateDocument('tmpl_1', 'Doc', {})

      expect(mock.history[0].body).not.toHaveProperty('description')
    })

    it('handles null/undefined variables gracefully', async () => {
      mock.onPost(`${BASE}/deliverable`).reply({
        data: { results: { deliverable: { id: 'del_1', name: 'Doc', templateId: 'tmpl_1' } } },
      })

      await service.generateDocument('tmpl_1', 'Doc', null)

      expect(mock.history[0].body.variables).toEqual([])
    })

    it('throws when templateId is missing', async () => {
      await expect(service.generateDocument(null, 'Doc', {})).rejects.toThrow('Template ID is required')
    })

    it('throws when name is missing', async () => {
      await expect(service.generateDocument('tmpl_1', null, {})).rejects.toThrow('Document name is required')
    })

    it('throws on API error', async () => {
      mock.onPost(`${BASE}/deliverable`).replyWithError({ message: 'Server Error' })

      await expect(service.generateDocument('tmpl_1', 'Doc', {})).rejects.toThrow()
    })
  })

  describe('createDeliverable', () => {
    it('sends POST with raw variables array (string input)', async () => {
      const varsString = JSON.stringify([{ name: 'Name', placeholder: '{Name}', text: 'Acme', mimeType: 'text' }])

      mock.onPost(`${BASE}/deliverable`).reply({
        data: { results: { deliverable: { id: 'del_1', name: 'Doc', templateId: 'tmpl_1', createdOn: '2026-01-01' } } },
      })

      await service.createDeliverable('tmpl_1', 'Doc', varsString)

      expect(mock.history[0].body.variables).toEqual([
        { name: 'Name', placeholder: '{Name}', text: 'Acme', mimeType: 'text' },
      ])
    })

    it('sends POST with raw variables array (object input)', async () => {
      const vars = [{ name: 'Name', placeholder: '{Name}', text: 'Acme', mimeType: 'text' }]

      mock.onPost(`${BASE}/deliverable`).reply({
        data: { results: { deliverable: { id: 'del_1', name: 'Doc', templateId: 'tmpl_1' } } },
      })

      await service.createDeliverable('tmpl_1', 'Doc', vars)

      expect(mock.history[0].body.variables).toEqual(vars)
    })

    it('includes description and tags when provided', async () => {
      mock.onPost(`${BASE}/deliverable`).reply({
        data: { results: { deliverable: { id: 'del_1', name: 'Doc', templateId: 'tmpl_1' } } },
      })

      await service.createDeliverable('tmpl_1', 'Doc', '[]', 'desc', '["Sales","Legal"]')

      expect(mock.history[0].body.description).toBe('desc')
      expect(mock.history[0].body.tags).toEqual(['Sales', 'Legal'])
    })

    it('omits description and tags when not provided', async () => {
      mock.onPost(`${BASE}/deliverable`).reply({
        data: { results: { deliverable: { id: 'del_1', name: 'Doc', templateId: 'tmpl_1' } } },
      })

      await service.createDeliverable('tmpl_1', 'Doc', '[]')

      expect(mock.history[0].body).not.toHaveProperty('description')
      expect(mock.history[0].body).not.toHaveProperty('tags')
    })

    it('throws when templateId is missing', async () => {
      await expect(service.createDeliverable(null, 'Doc', '[]')).rejects.toThrow('Template ID is required')
    })

    it('throws when name is missing', async () => {
      await expect(service.createDeliverable('tmpl_1', null, '[]')).rejects.toThrow('Deliverable name is required')
    })
  })

  describe('downloadDocument', () => {
    it('sends GET with setEncoding(null) for binary download', async () => {
      const mockBuffer = Buffer.from('docx-content')
      const mockFiles = { uploadFile: jest.fn().mockResolvedValue({ url: 'https://storage.example.com/doc.docx' }) }

      service.flowrunner = { Files: mockFiles }

      mock.onGet(`${BASE}/deliverable/file/del_123`).reply(mockBuffer)

      const result = await service.downloadDocument('del_123')

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].encoding).toBeNull()
      expect(result).toBe('https://storage.example.com/doc.docx')

      expect(mockFiles.uploadFile).toHaveBeenCalledWith(
        mockBuffer,
        expect.objectContaining({
          filename: 'document_del_123.docx',
          generateUrl: true,
          overwrite: true,
          scope: 'FLOW',
        })
      )
    })

    it('uses custom filename from fileOptions', async () => {
      const mockFiles = { uploadFile: jest.fn().mockResolvedValue({ url: 'https://storage.example.com/custom.docx' }) }

      service.flowrunner = { Files: mockFiles }
      mock.onGet(`${BASE}/deliverable/file/del_123`).reply(Buffer.from('content'))

      await service.downloadDocument('del_123', { filename: 'custom.docx', scope: 'APP' })

      expect(mockFiles.uploadFile).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ filename: 'custom.docx' })
      )
    })

    it('throws when deliverableId is missing', async () => {
      await expect(service.downloadDocument()).rejects.toThrow('Deliverable ID is required')
    })
  })

  // ── E-Signatures ──

  describe('sendForSigning', () => {
    it('sends POST with formData containing required fields', async () => {
      mock.onPost(`${BASE}/turbosign/single/prepare-for-signing`).reply({
        success: true,
        documentId: 'doc_1',
        message: 'Sent',
      })

      const recipients = JSON.stringify([{ name: 'John', email: 'john@example.com' }])
      const fields = JSON.stringify([{ type: 'signature', recipientEmail: 'john@example.com' }])

      const result = await service.sendForSigning('del_1', null, null, recipients, fields)

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].formData).toBeDefined()
      expect(result).toEqual({ success: true, documentId: 'doc_1', message: 'Sent' })
    })

    it('appends optional fields to formData', async () => {
      mock.onPost(`${BASE}/turbosign/single/prepare-for-signing`).reply({
        success: true,
        documentId: 'doc_1',
        message: 'Sent',
      })

      const recipients = '[{"name":"John","email":"john@example.com"}]'
      const fields = '[{"type":"signature"}]'

      await service.sendForSigning('del_1', 'https://file.url', 'Contract', recipients, fields, 'Jane', 'jane@example.com')

      expect(mock.history[0].formData).toBeDefined()
    })

    it('throws when recipients are missing', async () => {
      await expect(service.sendForSigning('del_1', null, null, null, '[]')).rejects.toThrow('Recipients are required')
    })

    it('throws when fields are missing', async () => {
      await expect(service.sendForSigning('del_1', null, null, '[]', null)).rejects.toThrow('Fields are required')
    })

    it('throws when neither deliverableId nor fileLink is provided', async () => {
      await expect(service.sendForSigning(null, null, null, '[]', '[]')).rejects.toThrow('Either deliverable ID or file link is required')
    })

    it('accepts fileLink instead of deliverableId', async () => {
      mock.onPost(`${BASE}/turbosign/single/prepare-for-signing`).reply({
        success: true,
        documentId: 'doc_2',
        message: 'Sent',
      })

      const result = await service.sendForSigning(null, 'https://file.url', null, '[]', '[]')

      expect(result.documentId).toBe('doc_2')
    })
  })

  describe('sendForReview', () => {
    it('sends POST to prepare-for-review endpoint', async () => {
      mock.onPost(`${BASE}/turbosign/single/prepare-for-review`).reply({
        success: true,
        documentId: 'doc_1',
        status: 'REVIEW_READY',
        previewUrl: 'https://preview.url',
        recipients: [{ id: 'r_1', name: 'John' }],
        message: 'Ready',
      })

      const result = await service.sendForReview('del_1', null, null, '[]', '[]')

      expect(result).toEqual({
        success: true,
        documentId: 'doc_1',
        status: 'REVIEW_READY',
        previewUrl: 'https://preview.url',
        recipients: [{ id: 'r_1', name: 'John' }],
        message: 'Ready',
      })
    })

    it('throws when recipients are missing', async () => {
      await expect(service.sendForReview('del_1', null, null, null, '[]')).rejects.toThrow('Recipients are required')
    })

    it('throws when fields are missing', async () => {
      await expect(service.sendForReview('del_1', null, null, '[]', null)).rejects.toThrow('Fields are required')
    })

    it('throws when neither deliverableId nor fileLink is provided', async () => {
      await expect(service.sendForReview(null, null, null, '[]', '[]')).rejects.toThrow('Either deliverable ID or file link is required')
    })
  })

  describe('prepareForSigning', () => {
    it('sends POST with all optional fields', async () => {
      mock.onPost(`${BASE}/turbosign/single/prepare-for-signing`).reply({
        success: true,
        documentId: 'doc_1',
        message: 'Sent',
      })

      const result = await service.prepareForSigning(
        'del_1', 'tmpl_1', 'https://file.url', 'Contract', 'A contract',
        '[]', '[]', 'Jane', 'jane@ex.com', '["cc@ex.com"]'
      )

      expect(mock.history[0].formData).toBeDefined()
      expect(result).toEqual({ success: true, documentId: 'doc_1', message: 'Sent' })
    })

    it('throws when recipients are missing', async () => {
      await expect(
        service.prepareForSigning('del_1', null, null, null, null, null, '[]')
      ).rejects.toThrow('Recipients are required')
    })

    it('throws when fields are missing', async () => {
      await expect(
        service.prepareForSigning('del_1', null, null, null, null, '[]', null)
      ).rejects.toThrow('Fields are required')
    })

    it('throws when no file source is provided', async () => {
      await expect(
        service.prepareForSigning(null, null, null, null, null, '[]', '[]')
      ).rejects.toThrow('A file source is required')
    })
  })

  describe('prepareForReview', () => {
    it('sends POST to prepare-for-review and returns review data', async () => {
      mock.onPost(`${BASE}/turbosign/single/prepare-for-review`).reply({
        success: true,
        documentId: 'doc_1',
        status: 'REVIEW_READY',
        previewUrl: 'https://preview.url',
        recipients: [],
        message: 'Ready',
      })

      const result = await service.prepareForReview('del_1', null, null, null, null, '[]', '[]')

      expect(result).toEqual({
        success: true,
        documentId: 'doc_1',
        status: 'REVIEW_READY',
        previewUrl: 'https://preview.url',
        recipients: [],
        message: 'Ready',
      })
    })

    it('throws when no file source is provided', async () => {
      await expect(
        service.prepareForReview(null, null, null, null, null, '[]', '[]')
      ).rejects.toThrow('A file source is required')
    })
  })

  describe('downloadSignedDocument', () => {
    it('sends GET and returns download URL and filename', async () => {
      mock.onGet(`${BASE}/turbosign/documents/doc_1/download`).reply({
        downloadUrl: 'https://storage.turbodocx.com/signed/doc.pdf',
        fileName: 'Signed_Contract.pdf',
      })

      const result = await service.downloadSignedDocument('doc_1')

      expect(mock.history[0].method).toBe('get')
      expect(result).toEqual({
        downloadUrl: 'https://storage.turbodocx.com/signed/doc.pdf',
        fileName: 'Signed_Contract.pdf',
      })
    })

    it('throws when documentId is missing', async () => {
      await expect(service.downloadSignedDocument()).rejects.toThrow('Document ID is required')
    })
  })

  describe('getSignatureAuditTrail', () => {
    it('sends GET and returns audit trail data', async () => {
      const auditData = {
        document: { id: 'doc_1', name: 'Contract' },
        auditTrail: [{ actionType: 'document_sent', timestamp: '2026-01-15T10:30:00Z' }],
      }

      mock.onGet(`${BASE}/turbosign/documents/doc_1/audit-trail`).reply({ data: auditData })

      const result = await service.getSignatureAuditTrail('doc_1')

      expect(result).toEqual(auditData)
    })

    it('returns response directly when data is absent', async () => {
      const responseData = { document: { id: 'doc_1' }, auditTrail: [] }

      mock.onGet(`${BASE}/turbosign/documents/doc_1/audit-trail`).reply(responseData)

      const result = await service.getSignatureAuditTrail('doc_1')

      expect(result).toEqual(responseData)
    })

    it('throws when documentId is missing', async () => {
      await expect(service.getSignatureAuditTrail()).rejects.toThrow('Document ID is required')
    })
  })

  // ── Bulk Signatures ──

  describe('ingestBulkBatch', () => {
    it('sends POST with formData for batch creation', async () => {
      mock.onPost(`${BASE}/turbosign/bulk/ingest`).reply({
        success: true,
        batchId: 'batch_1',
        batchName: 'Q4 Contracts',
        totalJobs: 50,
        status: 'pending',
        message: 'Batch created',
      })

      const docs = JSON.stringify([{ recipients: [], fields: [] }])

      const result = await service.ingestBulkBatch('deliverableId', 'del_1', 'Q4 Contracts', docs)

      expect(mock.history[0].formData).toBeDefined()
      expect(result).toEqual({
        success: true,
        batchId: 'batch_1',
        batchName: 'Q4 Contracts',
        totalJobs: 50,
        status: 'pending',
        message: 'Batch created',
      })
    })

    it('includes optional fields in formData', async () => {
      mock.onPost(`${BASE}/turbosign/bulk/ingest`).reply({
        success: true,
        batchId: 'batch_1',
        batchName: 'Batch',
        totalJobs: 1,
        status: 'pending',
        message: 'OK',
      })

      await service.ingestBulkBatch(
        'templateId', 'tmpl_1', 'Batch', '[]',
        'Doc Name', 'Doc Desc', 'Sender', 'sender@ex.com'
      )

      expect(mock.history[0].formData).toBeDefined()
    })

    it('throws when sourceType is missing', async () => {
      await expect(service.ingestBulkBatch(null, 'v', 'n', '[]')).rejects.toThrow('Source type is required')
    })

    it('throws when sourceValue is missing', async () => {
      await expect(service.ingestBulkBatch('deliverableId', null, 'n', '[]')).rejects.toThrow('Source value is required')
    })

    it('throws when batchName is missing', async () => {
      await expect(service.ingestBulkBatch('deliverableId', 'v', null, '[]')).rejects.toThrow('Batch name is required')
    })

    it('throws when documents is missing', async () => {
      await expect(service.ingestBulkBatch('deliverableId', 'v', 'n', null)).rejects.toThrow('Documents array is required')
    })
  })

  describe('listAllBatches', () => {
    it('sends GET with default (no query params)', async () => {
      mock.onGet(`${BASE}/turbosign/bulk/batches`).reply({
        data: {
          batches: [{ id: 'batch_1', name: 'Q4', status: 'completed' }],
          totalRecords: 1,
        },
      })

      const result = await service.listAllBatches()

      expect(mock.history[0].method).toBe('get')
      expect(result).toEqual({
        batches: [{ id: 'batch_1', name: 'Q4', status: 'completed' }],
        totalRecords: 1,
      })
    })

    it('passes query parameters when provided', async () => {
      mock.onGet(`${BASE}/turbosign/bulk/batches`).reply({ data: { batches: [], totalRecords: 0 } })

      await service.listAllBatches(10, 20, 'search', 'completed')

      expect(mock.history[0].query).toMatchObject({
        limit: 10,
        offset: 20,
        query: 'search',
        status: 'completed',
      })
    })

    it('handles empty response', async () => {
      mock.onGet(`${BASE}/turbosign/bulk/batches`).reply({})

      const result = await service.listAllBatches()

      expect(result).toEqual({ batches: [], totalRecords: 0 })
    })
  })

  describe('listJobsInBatch', () => {
    it('sends GET with batchId in URL', async () => {
      mock.onGet(`${BASE}/turbosign/bulk/batch/batch_1/jobs`).reply({
        data: {
          batchId: 'batch_1',
          batchName: 'Q4',
          batchStatus: 'completed',
          jobs: [{ id: 'job_1', status: 'SUCCEEDED' }],
          totalJobs: 50,
          totalRecords: 50,
          succeededJobs: 48,
          failedJobs: 2,
          pendingJobs: 0,
        },
      })

      const result = await service.listJobsInBatch('batch_1')

      expect(result).toEqual({
        batchId: 'batch_1',
        batchName: 'Q4',
        batchStatus: 'completed',
        jobs: [{ id: 'job_1', status: 'SUCCEEDED' }],
        totalJobs: 50,
        totalRecords: 50,
        succeededJobs: 48,
        failedJobs: 2,
        pendingJobs: 0,
      })
    })

    it('passes optional query params', async () => {
      mock.onGet(`${BASE}/turbosign/bulk/batch/batch_1/jobs`).reply({ data: { jobs: [] } })

      await service.listJobsInBatch('batch_1', 10, 20, 'FAILED')

      expect(mock.history[0].query).toMatchObject({
        limit: 10,
        offset: 20,
        status: 'FAILED',
      })
    })

    it('throws when batchId is missing', async () => {
      await expect(service.listJobsInBatch()).rejects.toThrow('Batch ID is required')
    })
  })
})
