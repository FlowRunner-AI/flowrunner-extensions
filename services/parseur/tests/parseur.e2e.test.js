'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Parseur Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('parseur')
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

  // ── Mailboxes ──

  describe('getMailboxesDictionary', () => {
    it('returns mailboxes with a label, value and note', async () => {
      const result = await service.getMailboxesDictionary({})

      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor')

      result.items.forEach(item => {
        expect(item).toHaveProperty('label')
        expect(item).toHaveProperty('value')
        expect(item.note).toBe(`ID: ${ item.value }`)
      })
    })

    it('filters mailboxes by a search term', async () => {
      const all = await service.getMailboxesDictionary({})

      if (!all.items.length) {
        console.log('Skipping mailbox search: the account has no mailboxes')

        return
      }

      const needle = all.items[0].label.slice(0, 3)
      const filtered = await service.getMailboxesDictionary({ search: needle })

      expect(filtered.items.length).toBeGreaterThan(0)

      filtered.items.forEach(item => {
        expect(item.label.toLowerCase()).toContain(needle.toLowerCase())
      })
    })
  })

  // ── Documents ──

  describe('listDocuments', () => {
    it('lists documents in the configured mailbox', async () => {
      const { mailboxId } = testValues

      if (!mailboxId) {
        console.log('Skipping listDocuments: testValues.mailboxId not set')

        return
      }

      const result = await service.listDocuments(mailboxId, 'all', 5)

      expect(result).toHaveProperty('results')
      expect(Array.isArray(result.results)).toBe(true)
    })

    it('filters documents by processing status', async () => {
      const { mailboxId } = testValues

      if (!mailboxId) {
        console.log('Skipping listDocuments (status filter): testValues.mailboxId not set')

        return
      }

      const result = await service.listDocuments(mailboxId, 'processed', 5)

      expect(Array.isArray(result.results)).toBe(true)
    })

    it('rejects when the mailbox ID is missing', async () => {
      await expect(service.listDocuments()).rejects.toThrow('Mailbox ID is required')
    })
  })

  // ── Upload and delete lifecycle ──

  describe('uploadDocument + deleteDocument', () => {
    let documentId

    it('uploads a document from a URL', async () => {
      const { mailboxId, documentUrl } = testValues

      if (!mailboxId || !documentUrl) {
        console.log('Skipping uploadDocument: testValues.mailboxId or testValues.documentUrl not set')

        return
      }

      const result = await service.uploadDocument(mailboxId, documentUrl, `e2e-${ Date.now() }.pdf`)

      expect(result).toHaveProperty('DocumentID')

      documentId = result.DocumentID
    }, 60000)

    it('deletes the uploaded document', async () => {
      const { mailboxId } = testValues

      if (!documentId) {
        console.log('Skipping deleteDocument: no document was uploaded')

        return
      }

      await expect(service.deleteDocument(mailboxId, documentId)).resolves.toBeDefined()
    })
  })

  // ── Validation ──

  describe('parameter validation', () => {
    it('rejects an upload without a mailbox ID', async () => {
      await expect(service.uploadDocument(undefined, 'https://example.com/x.pdf'))
        .rejects.toThrow('Mailbox ID is required')
    })

    it('rejects an upload without a document URL', async () => {
      await expect(service.uploadDocument('mb_1')).rejects.toThrow('Document URL is required')
    })

    it('rejects a delete without a document ID', async () => {
      await expect(service.deleteDocument('mb_1')).rejects.toThrow('Document ID is required')
    })

    it('rejects a reprocess without a document ID', async () => {
      await expect(service.reprocessDocument()).rejects.toThrow('Document ID is required')
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('throws a wrapped error for an unknown mailbox', async () => {
      await expect(service.listDocuments('00000000', 'all', 1)).rejects.toThrow(/Parseur API error/)
    })
  })
})
