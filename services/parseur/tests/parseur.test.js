'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-api-key'
const BASE = 'https://api.parseur.com'

describe('Parseur Service', () => {
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
    it('registers the API key config item', () => {
      const configItems = sandbox.getConfigItems()

      expect(configItems.map(item => item.name)).toEqual(['apiKey'])

      expect(configItems[0]).toMatchObject({
        name: 'apiKey',
        displayName: 'API Key',
        type: 'STRING',
        required: true,
      })
    })
  })

  // ── Mailboxes dictionary ──

  describe('getMailboxesDictionary', () => {
    it('maps mailboxes to dictionary items', async () => {
      mock.onGet(`${ BASE }/parser`).reply({
        results: [{ id: 'mb_1', name: 'Sales Leads' }],
        next: null,
      })

      const result = await service.getMailboxesDictionary({})

      expect(result).toEqual({
        items: [{ label: 'Sales Leads', value: 'mb_1', note: 'ID: mb_1' }],
        cursor: null,
      })

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].headers).toEqual({ Authorization: API_KEY })
    })

    it('handles a null payload and missing results', async () => {
      mock.onGet(`${ BASE }/parser`).reply({})

      const result = await service.getMailboxesDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('filters mailboxes case-insensitively by the search term', async () => {
      mock.onGet(`${ BASE }/parser`).reply({
        results: [
          { id: 'mb_1', name: 'Sales Leads' },
          { id: 'mb_2', name: 'Invoices' },
        ],
      })

      const result = await service.getMailboxesDictionary({ search: 'INVOICE' })

      expect(result.items).toEqual([{ label: 'Invoices', value: 'mb_2', note: 'ID: mb_2' }])
    })

    it('uses the cursor as the next request URL and returns the next page link', async () => {
      const nextUrl = `${ BASE }/parser?page=2`

      mock.onGet(nextUrl).reply({ results: [], next: `${ BASE }/parser?page=3` })

      const result = await service.getMailboxesDictionary({ cursor: nextUrl })

      expect(mock.history[0].url).toBe(nextUrl)
      expect(result.cursor).toBe(`${ BASE }/parser?page=3`)
    })

    it('throws a wrapped error when the API call fails', async () => {
      mock.onGet(`${ BASE }/parser`).replyWithError({ message: 'Unauthorized' })

      await expect(service.getMailboxesDictionary({})).rejects.toThrow('Parseur API error: Unauthorized')
    })
  })

  // ── Upload document ──

  describe('uploadDocument', () => {
    const DOCUMENT_URL = 'https://files.example.com/invoice.pdf'

    it('rejects when the mailbox ID is missing', async () => {
      await expect(service.uploadDocument(undefined, DOCUMENT_URL)).rejects.toThrow('Mailbox ID is required')
      expect(mock.history).toHaveLength(0)
    })

    it('rejects when the document URL is missing', async () => {
      await expect(service.uploadDocument('mb_1')).rejects.toThrow('Document URL is required')
      expect(mock.history).toHaveLength(0)
    })

    it('downloads the document and uploads it as multipart form data', async () => {
      mock.onGet(DOCUMENT_URL).reply({
        headers: { 'content-type': 'application/pdf' },
        body: Buffer.from('%PDF-1.4'),
      })

      mock.onPost(`${ BASE }/parser/mb_1/upload`).reply({
        attachments: [{ name: 'invoice.pdf', DocumentID: 'doc_1' }],
      })

      const result = await service.uploadDocument('mb_1', DOCUMENT_URL)

      expect(result).toEqual({ name: 'invoice.pdf', DocumentID: 'doc_1' })

      const download = mock.history[0]

      expect(download.method).toBe('get')
      expect(download.encoding).toBeNull()
      expect(download.unwrapBody).toBe(false)

      const upload = mock.history[1]

      expect(upload.method).toBe('post')
      expect(upload.url).toBe(`${ BASE }/parser/mb_1/upload`)

      expect(upload.headers).toEqual({
        'Authorization': API_KEY,
        'Content-Type': 'multipart/form-data',
      })

      expect(upload.formData._fields).toHaveLength(1)

      expect(upload.formData._fields[0]).toMatchObject({
        name: 'file',
        filename: { filename: 'invoice.pdf', contentType: 'application/pdf' },
      })
    })

    it('uses the supplied filename instead of the URL basename', async () => {
      mock.onGet(DOCUMENT_URL).reply({
        headers: { 'content-type': 'application/pdf' },
        body: Buffer.from('%PDF-1.4'),
      })

      mock.onPost(`${ BASE }/parser/mb_1/upload`).reply({ attachments: [{ DocumentID: 'doc_1' }] })

      await service.uploadDocument('mb_1', DOCUMENT_URL, 'custom-name.pdf')

      expect(mock.history[1].formData._fields[0].filename.filename).toBe('custom-name.pdf')
    })

    it('wraps upload failures in a Parseur API error', async () => {
      mock.onGet(DOCUMENT_URL).reply({
        headers: { 'content-type': 'application/pdf' },
        body: Buffer.from('%PDF-1.4'),
      })

      mock.onPost(`${ BASE }/parser/mb_1/upload`).replyWithError({ message: 'Payload too large' })

      await expect(service.uploadDocument('mb_1', DOCUMENT_URL))
        .rejects.toThrow('Parseur API error: Payload too large')
    })
  })

  // ── List documents ──

  describe('listDocuments', () => {
    it('rejects when the mailbox ID is missing', async () => {
      await expect(service.listDocuments()).rejects.toThrow('Mailbox ID is required')
    })

    it('applies the default limit of 20', async () => {
      mock.onGet(`${ BASE }/parser/mb_1/document_set?limit=20`).reply({ results: [] })

      const result = await service.listDocuments('mb_1')

      expect(result).toEqual({ results: [] })
      expect(mock.history[0].url).toBe(`${ BASE }/parser/mb_1/document_set?limit=20`)
      expect(mock.history[0].headers).toEqual({ Authorization: API_KEY })
    })

    it('sends the status filter and custom limit', async () => {
      mock.onGet(`${ BASE }/parser/mb_1/document_set?status=processed&limit=5`).reply({ results: [{ id: 'doc_1' }] })

      const result = await service.listDocuments('mb_1', 'processed', 5)

      expect(result.results).toHaveLength(1)
      expect(mock.history[0].url).toContain('status=processed')
      expect(mock.history[0].url).toContain('limit=5')
    })

    it('omits the status parameter when the filter is "all"', async () => {
      mock.onGet(`${ BASE }/parser/mb_1/document_set?limit=20`).reply({ results: [] })

      await service.listDocuments('mb_1', 'all')

      expect(mock.history[0].url).not.toContain('status=')
    })

    it('handles a response without a results array', async () => {
      mock.onGet(`${ BASE }/parser/mb_1/document_set?limit=20`).reply({ count: 0 })

      const result = await service.listDocuments('mb_1')

      expect(result).toEqual({ count: 0 })
    })
  })

  // ── Reprocess document ──

  describe('reprocessDocument', () => {
    it('rejects when the document ID is missing', async () => {
      await expect(service.reprocessDocument()).rejects.toThrow('Document ID is required')
      expect(mock.history).toHaveLength(0)
    })

    it('sends a POST request to the document process endpoint', async () => {
      mock.onPost(`${ BASE }/parser/document/doc_1/process`).reply({ success: true })

      const result = await service.reprocessDocument('doc_1')

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/parser/document/doc_1/process`)
      expect(mock.history[0].headers).toEqual({ Authorization: API_KEY })
      expect(result).toEqual({ success: true })
    })

    it('wraps an API failure', async () => {
      mock.onPost(`${ BASE }/parser/document/doc_1/process`).replyWithError({ message: 'Not Found' })

      await expect(service.reprocessDocument('doc_1')).rejects.toThrow('Parseur API error')
    })
  })

  // ── Delete document ──

  describe('deleteDocument', () => {
    it('rejects when the mailbox ID is missing', async () => {
      await expect(service.deleteDocument(undefined, 'doc_1')).rejects.toThrow('Mailbox ID is required')
    })

    it('rejects when the document ID is missing', async () => {
      await expect(service.deleteDocument('mb_1')).rejects.toThrow('Document ID is required')
    })

    it('sends a DELETE request for the document', async () => {
      mock.onDelete(`${ BASE }/parser/mb_1/document_set/doc_1`).reply({ success: true })

      const result = await service.deleteDocument('mb_1', 'doc_1')

      expect(result).toEqual({ success: true })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].headers).toEqual({ Authorization: API_KEY })
    })

    it('wraps API failures', async () => {
      mock.onDelete(`${ BASE }/parser/mb_1/document_set/doc_1`).replyWithError({ message: 'Not Found' })

      await expect(service.deleteDocument('mb_1', 'doc_1')).rejects.toThrow('Parseur API error: Not Found')
    })
  })

  // ── Trigger: event shaping and filtering ──

  describe('onDocumentProcessedRealtime', () => {
    it('shapes a webhook payload into a trigger event', () => {
      const events = service.onDocumentProcessedRealtime('SHAPE_EVENT', {
        queryParams: { mailboxId: '13118' },
        body: { DocumentID: 'doc_1', Total: '42' },
      })

      expect(events).toEqual([
        {
          name: 'onDocumentProcessedRealtime',
          data: {
            mailboxId: '13118',
            documentId: 'doc_1',
            parsedData: { DocumentID: 'doc_1', Total: '42' },
          },
        },
      ])
    })

    it('selects only the triggers whose mailbox matches the event', () => {
      const result = service.onDocumentProcessedRealtime('FILTER_TRIGGER', {
        eventData: { mailboxId: '13118' },
        triggers: [
          { id: 't1', data: { mailboxId: 13118 } },
          { id: 't2', data: { mailboxId: 99999 } },
          { id: 't3', data: { mailboxId: '13118' } },
        ],
      })

      expect(result).toEqual({ ids: ['t1', 't3'] })
    })

    it('returns undefined for an unknown call type', () => {
      expect(service.onDocumentProcessedRealtime('UNKNOWN', {})).toBeUndefined()
    })
  })

  // ── Trigger: system methods ──

  describe('handleTriggerPollingForEvent', () => {
    it('delegates to the method named by the invocation', async () => {
      const invocation = { eventName: 'onDocumentProcessedRealtime', triggers: [], eventData: { mailboxId: '1' } }

      // The handler forwards the invocation as the first argument, which the realtime event
      // method reads as its callType — so no shaping or filtering branch is taken.
      await expect(service.handleTriggerPollingForEvent(invocation)).resolves.toBeUndefined()
      expect(mock.history).toHaveLength(0)
    })
  })

  describe('handleTriggerUpsertWebhook', () => {
    it('creates and enables a webhook for each new event', async () => {
      mock.onPost(`${ BASE }/webhook`).reply({ id: 'wh_1' })
      mock.onPost(`${ BASE }/parser/13118/webhook_set/wh_1`).reply({ success: true })

      const result = await service.handleTriggerUpsertWebhook({
        callbackUrl: 'https://hooks.flowrunner.com/cb?token=abc',
        events: [{ name: 'onDocumentProcessedRealtime', triggerData: { mailboxId: '13118' } }],
      })

      expect(result).toEqual({ webhookData: { webhooks: { 'document.processed---13118': 'wh_1' } } })

      expect(mock.history[0].body).toEqual({
        target: 'https://hooks.flowrunner.com/cb?token=abc&mailboxId=13118',
        event: 'document.processed',
      })

      expect(mock.history[1].url).toBe(`${ BASE }/parser/13118/webhook_set/wh_1`)
    })

    it('does not recreate a webhook that already exists', async () => {
      const result = await service.handleTriggerUpsertWebhook({
        callbackUrl: 'https://hooks.flowrunner.com/cb?token=abc',
        webhookData: { webhooks: { 'document.processed---13118': 'wh_1' } },
        events: [{ name: 'onDocumentProcessedRealtime', triggerData: { mailboxId: '13118' } }],
      })

      expect(result).toEqual({ webhookData: { webhooks: { 'document.processed---13118': 'wh_1' } } })
      expect(mock.history).toHaveLength(0)
    })
  })

  describe('handleTriggerResolveEvents', () => {
    it('shapes events for a known Parseur event header', async () => {
      const result = await service.handleTriggerResolveEvents({
        headers: { 'x-parseur-event': 'document.processed' },
        queryParams: { mailboxId: '13118' },
        body: { DocumentID: 'doc_1' },
      })

      expect(result).toEqual({
        events: [
          {
            name: 'onDocumentProcessedRealtime',
            data: { mailboxId: '13118', documentId: 'doc_1', parsedData: { DocumentID: 'doc_1' } },
          },
        ],
      })
    })

    it('returns null for an unknown event header', async () => {
      const result = await service.handleTriggerResolveEvents({
        headers: { 'x-parseur-event': 'document.exploded' },
        body: {},
      })

      expect(result).toBeNull()
    })
  })

  describe('handleTriggerSelectMatched', () => {
    it('delegates filtering to the event method', async () => {
      const result = await service.handleTriggerSelectMatched({
        eventName: 'onDocumentProcessedRealtime',
        eventData: { mailboxId: '13118' },
        triggers: [{ id: 't1', data: { mailboxId: '13118' } }],
      })

      expect(result).toEqual({ ids: ['t1'] })
    })
  })

  describe('handleTriggerDeleteWebhook', () => {
    it('deletes every stored webhook', async () => {
      mock.onDelete(`${ BASE }/webhook/wh_1`).reply({})
      mock.onDelete(`${ BASE }/webhook/wh_2`).reply({})

      const result = await service.handleTriggerDeleteWebhook({
        webhookData: { webhooks: { 'document.processed---1': 'wh_1', 'document.processed---2': 'wh_2' } },
      })

      expect(result).toEqual({})

      expect(mock.history.map(call => call.url)).toEqual([
        `${ BASE }/webhook/wh_1`,
        `${ BASE }/webhook/wh_2`,
      ])
    })

    it('swallows deletion failures', async () => {
      mock.onDelete(`${ BASE }/webhook/wh_1`).replyWithError({ message: 'Not Found' })

      await expect(service.handleTriggerDeleteWebhook({
        webhookData: { webhooks: { 'document.processed---1': 'wh_1' } },
      })).resolves.toEqual({})
    })

    it('does nothing when there is no stored webhook data', async () => {
      const result = await service.handleTriggerDeleteWebhook({})

      expect(result).toEqual({})
      expect(mock.history).toHaveLength(0)
    })
  })
})
