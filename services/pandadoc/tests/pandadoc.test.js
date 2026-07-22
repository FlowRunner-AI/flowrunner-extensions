'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-api-key'
const BASE = 'https://api.pandadoc.com/public/v1'

const AUTH_HEADERS = {
  'Authorization': `API-Key ${ API_KEY }`,
  'Content-Type': 'application/json',
}

describe('PandaDoc Service', () => {
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
        shared: false,
      })
    })
  })

  // ── Documents ──

  describe('listDocuments', () => {
    it('sends the default page size and drops empty filters', async () => {
      mock.onGet(`${ BASE }/documents`).reply({ results: [] })

      const result = await service.listDocuments()

      expect(result).toEqual({ results: [] })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].headers).toMatchObject(AUTH_HEADERS)
      expect(mock.history[0].query).toEqual({ count: 50 })
    })

    it('maps the status and order-by labels to API values', async () => {
      mock.onGet(`${ BASE }/documents`).reply({ results: [] })

      await service.listDocuments(
        'acme',
        'Completed',
        'sales',
        'folder-1',
        'tpl-1',
        '2026-01-01T00:00:00Z',
        '2026-02-01T00:00:00Z',
        true,
        'Name (A to Z)',
        10,
        2
      )

      expect(mock.history[0].query).toEqual({
        q: 'acme',
        status: 2,
        tag: 'sales',
        folder_uuid: 'folder-1',
        template_id: 'tpl-1',
        created_from: '2026-01-01T00:00:00Z',
        created_to: '2026-02-01T00:00:00Z',
        deleted: true,
        order_by: 'name',
        count: 10,
        page: 2,
      })
    })

    it('passes an unmapped status value through unchanged', async () => {
      mock.onGet(`${ BASE }/documents`).reply({ results: [] })

      await service.listDocuments(undefined, 'document.sent')

      expect(mock.history[0].query.status).toBe('document.sent')
    })

    it('throws a formatted error using the API detail field', async () => {
      mock.onGet(`${ BASE }/documents`).replyWithError({
        message: 'Bad Request',
        body: { detail: 'Invalid status value' },
      })

      await expect(service.listDocuments()).rejects.toThrow('PandaDoc API error: Invalid status value')
    })

    it('stringifies a non-string error detail', async () => {
      mock.onGet(`${ BASE }/documents`).replyWithError({
        message: 'Bad Request',
        body: { detail: { status: ['not valid'] } },
      })

      await expect(service.listDocuments()).rejects.toThrow('PandaDoc API error: {"status":["not valid"]}')
    })

    it('stringifies an error body with no known message field', async () => {
      mock.onGet(`${ BASE }/documents`).replyWithError({
        message: 'Bad Request',
        body: { unexpected: true },
      })

      await expect(service.listDocuments()).rejects.toThrow('PandaDoc API error: {"unexpected":true}')
    })

    it('falls back to the error message when there is no body', async () => {
      mock.onGet(`${ BASE }/documents`).replyWithError({ message: 'socket hang up' })

      await expect(service.listDocuments()).rejects.toThrow('PandaDoc API error: socket hang up')
    })
  })

  describe('getDocumentStatus', () => {
    it('requests the document endpoint', async () => {
      mock.onGet(`${ BASE }/documents/doc_1`).reply({ id: 'doc_1', status: 'document.draft' })

      const result = await service.getDocumentStatus('doc_1')

      expect(result).toEqual({ id: 'doc_1', status: 'document.draft' })
      expect(mock.history[0].url).toBe(`${ BASE }/documents/doc_1`)
    })
  })

  describe('getDocumentDetails', () => {
    it('requests the details endpoint', async () => {
      mock.onGet(`${ BASE }/documents/doc_1/details`).reply({ id: 'doc_1', recipients: [] })

      const result = await service.getDocumentDetails('doc_1')

      expect(result.id).toBe('doc_1')
    })
  })

  describe('createDocumentFromTemplate', () => {
    it('sends only the required fields', async () => {
      mock.onPost(`${ BASE }/documents`).reply({ id: 'doc_1', status: 'document.uploaded' })

      const recipients = [{ email: 'client@example.com', role: 'Client' }]
      const result = await service.createDocumentFromTemplate('Agreement', 'tpl_1', recipients)

      expect(result.id).toBe('doc_1')
      expect(mock.history[0].method).toBe('post')

      expect(mock.history[0].body).toEqual({
        name: 'Agreement',
        template_uuid: 'tpl_1',
        recipients,
      })
    })

    it('sends every optional field when supplied', async () => {
      mock.onPost(`${ BASE }/documents`).reply({ id: 'doc_2' })

      await service.createDocumentFromTemplate(
        'Agreement',
        'tpl_1',
        [{ email: 'a@b.c' }],
        [{ name: 'Client.Company', value: 'Acme' }],
        { delivery_date: { value: '2026-08-01' } },
        { crm_deal_id: 'D-1042' },
        ['sales'],
        'folder-1',
        [{ name: 'Pricing Table 1', sections: [] }]
      )

      expect(mock.history[0].body).toEqual({
        name: 'Agreement',
        template_uuid: 'tpl_1',
        recipients: [{ email: 'a@b.c' }],
        tokens: [{ name: 'Client.Company', value: 'Acme' }],
        fields: { delivery_date: { value: '2026-08-01' } },
        metadata: { crm_deal_id: 'D-1042' },
        tags: ['sales'],
        folder_uuid: 'folder-1',
        pricing_tables: [{ name: 'Pricing Table 1', sections: [] }],
      })
    })
  })

  describe('createDocumentFromFile', () => {
    const FILE_URL = 'https://files.flowrunner.com/abc/My%20NDA.pdf'

    it('downloads the file and posts it as multipart form data', async () => {
      mock.onGet(FILE_URL).reply(Buffer.from('%PDF-1.4'))
      mock.onPost(`${ BASE }/documents`).reply({ id: 'doc_1', status: 'document.uploaded' })

      const recipients = [{ email: 'client@example.com' }]
      const result = await service.createDocumentFromFile(FILE_URL, 'NDA', recipients, true, undefined, ['legal'], 'folder-1')

      expect(result.id).toBe('doc_1')

      const download = mock.history[0]

      expect(download.method).toBe('get')
      expect(download.url).toBe(FILE_URL)
      expect(download.encoding).toBeNull()

      const upload = mock.history[1]

      expect(upload.method).toBe('post')
      expect(upload.headers).toEqual({ Authorization: `API-Key ${ API_KEY }` })
      expect(upload.formData._fields).toHaveLength(2)

      const [dataField, fileField] = upload.formData._fields

      expect(dataField.name).toBe('data')

      expect(JSON.parse(dataField.value)).toEqual({
        name: 'NDA',
        recipients,
        tags: ['legal'],
        folder_uuid: 'folder-1',
        parse_form_fields: true,
      })

      expect(fileField.name).toBe('file')
      expect(Buffer.isBuffer(fileField.value)).toBe(true)
      expect(fileField.filename).toEqual({ filename: 'My NDA.pdf' })
    })

    it('omits parse_form_fields when it is not explicitly true', async () => {
      mock.onGet(FILE_URL).reply(Buffer.from('%PDF-1.4'))
      mock.onPost(`${ BASE }/documents`).reply({ id: 'doc_1' })

      await service.createDocumentFromFile(FILE_URL, 'NDA', [{ email: 'a@b.c' }], false)

      const data = JSON.parse(mock.history[1].formData._fields[0].value)

      expect(data).not.toHaveProperty('parse_form_fields')
    })

    it('serializes a non-buffer download body into a buffer', async () => {
      mock.onGet(FILE_URL).reply({ parsed: 'json' })
      mock.onPost(`${ BASE }/documents`).reply({ id: 'doc_1' })

      await service.createDocumentFromFile(FILE_URL, 'NDA', [{ email: 'a@b.c' }])

      const fileField = mock.history[1].formData._fields[1]

      expect(fileField.value.toString()).toBe('{"parsed":"json"}')
    })

    it('converts a string download body into a buffer', async () => {
      mock.onGet(FILE_URL).reply('plain text body')
      mock.onPost(`${ BASE }/documents`).reply({ id: 'doc_1' })

      await service.createDocumentFromFile(FILE_URL, 'NDA', [{ email: 'a@b.c' }])

      const fileField = mock.history[1].formData._fields[1]

      expect(fileField.value.toString()).toBe('plain text body')
    })

    it('throws a formatted error when the upload fails', async () => {
      mock.onGet(FILE_URL).reply(Buffer.from('%PDF-1.4'))

      mock.onPost(`${ BASE }/documents`).replyWithError({
        message: 'Bad Request',
        body: { detail: 'file is required' },
      })

      await expect(service.createDocumentFromFile(FILE_URL, 'NDA', [{ email: 'a@b.c' }]))
        .rejects.toThrow('PandaDoc API error: file is required')
    })
  })

  describe('sendDocument', () => {
    it('sends immediately when the document is already in draft', async () => {
      mock.onGet(`${ BASE }/documents/doc_1`).reply({ id: 'doc_1', status: 'document.draft' })
      mock.onPost(`${ BASE }/documents/doc_1/send`).reply({ id: 'doc_1', status: 'document.sent' })

      const result = await service.sendDocument('doc_1', 'Please sign', 'Hello', true)

      expect(result.status).toBe('document.sent')
      expect(mock.history).toHaveLength(2)
      expect(mock.history[1].body).toEqual({ subject: 'Please sign', message: 'Hello', silent: true })
    })

    it('omits silent when it is not explicitly true', async () => {
      mock.onGet(`${ BASE }/documents/doc_1`).reply({ status: 'document.draft' })
      mock.onPost(`${ BASE }/documents/doc_1/send`).reply({ status: 'document.sent' })

      await service.sendDocument('doc_1', undefined, undefined, false)

      expect(mock.history[1].body).toEqual({})
    })

    it('throws when the document is in the error state', async () => {
      mock.onGet(`${ BASE }/documents/doc_1`).reply({ status: 'document.error' })

      await expect(service.sendDocument('doc_1'))
        .rejects.toThrow('PandaDoc API error: document doc_1 failed processing (status document.error)')

      expect(mock.history).toHaveLength(1)
    })

    it('polls while the document is still uploading', async () => {
      jest.useFakeTimers()

      let calls = 0

      mock.onGet(`${ BASE }/documents/doc_1`).replyWith(() => {
        calls += 1

        return { status: calls < 3 ? 'document.uploaded' : 'document.draft' }
      })

      mock.onPost(`${ BASE }/documents/doc_1/send`).reply({ status: 'document.sent' })

      const promise = service.sendDocument('doc_1')

      await jest.advanceTimersByTimeAsync(2000)
      await jest.advanceTimersByTimeAsync(2000)

      await expect(promise).resolves.toEqual({ status: 'document.sent' })
      expect(calls).toBe(3)

      jest.useRealTimers()
    })

    it('gives up after the maximum number of polling attempts', async () => {
      jest.useFakeTimers()

      mock.onGet(`${ BASE }/documents/doc_1`).reply({ status: 'document.uploaded' })

      const promise = service.sendDocument('doc_1')
      const assertion = expect(promise).rejects.toThrow(/is still processing .* after 30 seconds/)

      await jest.advanceTimersByTimeAsync(2000 * 15)
      await assertion

      jest.useRealTimers()
    })
  })

  describe('createDocumentLink', () => {
    it('creates a session and builds the share link', async () => {
      mock.onPost(`${ BASE }/documents/doc_1/session`).reply({
        id: 'sess_1',
        expires_at: '2026-07-01T11:00:00.000000Z',
      })

      const result = await service.createDocumentLink('doc_1', 'client@example.com', 7200)

      expect(result).toEqual({
        sessionId: 'sess_1',
        expiresAt: '2026-07-01T11:00:00.000000Z',
        shareLink: 'https://app.pandadoc.com/s/sess_1',
      })

      expect(mock.history[0].body).toEqual({ recipient: 'client@example.com', lifetime: 7200 })
    })

    it('omits the lifetime when it is not supplied', async () => {
      mock.onPost(`${ BASE }/documents/doc_1/session`).reply({ id: 'sess_2' })

      await service.createDocumentLink('doc_1', 'client@example.com')

      expect(mock.history[0].body).toEqual({ recipient: 'client@example.com' })
    })
  })

  describe('downloadDocumentPdf', () => {
    let uploadFile

    beforeEach(() => {
      uploadFile = jest.fn().mockResolvedValue({ url: 'https://files.flowrunner.com/x/Agreement.pdf' })
      // The Files API is injected by the FlowRunner runtime; the sandbox does not provide it.
      service.flowrunner = { Files: { uploadFile } }
    })

    afterEach(() => {
      delete service.flowrunner
    })

    it('downloads the PDF, stores it and returns the file metadata', async () => {
      mock.onGet(`${ BASE }/documents/doc_1`).reply({ id: 'doc_1', name: 'Agreement' })
      mock.onGet(`${ BASE }/documents/doc_1/download`).reply(Buffer.from('%PDF-1.4 body'))

      const result = await service.downloadDocumentPdf('doc_1')

      expect(result).toEqual({
        fileName: 'Agreement.pdf',
        sizeBytes: Buffer.from('%PDF-1.4 body').length,
        url: 'https://files.flowrunner.com/x/Agreement.pdf',
      })

      const download = mock.history[1]

      expect(download.headers).toEqual({ Authorization: `API-Key ${ API_KEY }` })
      expect(download.query).toEqual({})
      expect(download.encoding).toBeNull()

      expect(uploadFile).toHaveBeenCalledWith(expect.any(Buffer), {
        filename: 'Agreement.pdf',
        generateUrl: true,
        overwrite: true,
        scope: 'FLOW',
      })
    })

    it('forwards the watermark options and custom file options', async () => {
      mock.onGet(`${ BASE }/documents/doc_1`).reply({ name: 'Agreement' })
      mock.onGet(`${ BASE }/documents/doc_1/download`).reply(Buffer.from('pdf'))

      await service.downloadDocumentPdf('doc_1', 'CONFIDENTIAL', '#FF5733', 24, 0.5, { scope: 'APP' })

      expect(mock.history[1].query).toEqual({
        watermark_text: 'CONFIDENTIAL',
        watermark_color: '#FF5733',
        watermark_font_size: 24,
        watermark_opacity: 0.5,
      })

      expect(uploadFile).toHaveBeenCalledWith(expect.any(Buffer), expect.objectContaining({ scope: 'APP' }))
    })

    it('falls back to the document id as the file name', async () => {
      mock.onGet(`${ BASE }/documents/doc_1`).reply({ id: 'doc_1' })
      mock.onGet(`${ BASE }/documents/doc_1/download`).reply(Buffer.from('pdf'))

      const result = await service.downloadDocumentPdf('doc_1')

      expect(result.fileName).toBe('doc_1.pdf')
    })

    it('throws a formatted error when the download fails', async () => {
      mock.onGet(`${ BASE }/documents/doc_1`).reply({ name: 'Agreement' })

      mock.onGet(`${ BASE }/documents/doc_1/download`).replyWithError({
        message: 'Not Found',
        body: { detail: 'Document not found' },
      })

      await expect(service.downloadDocumentPdf('doc_1')).rejects.toThrow('PandaDoc API error: Document not found')
    })
  })

  describe('updateDocumentName', () => {
    it('patches the document and reports success', async () => {
      mock.onPatch(`${ BASE }/documents/doc_1`).reply(undefined)

      const result = await service.updateDocumentName('doc_1', 'New Name')

      expect(result).toEqual({ success: true, documentId: 'doc_1', name: 'New Name' })
      expect(mock.history[0].method).toBe('patch')
      expect(mock.history[0].body).toEqual({ name: 'New Name' })
    })
  })

  describe('deleteDocument', () => {
    it('deletes the document and reports success', async () => {
      mock.onDelete(`${ BASE }/documents/doc_1`).reply(undefined)

      const result = await service.deleteDocument('doc_1')

      expect(result).toEqual({ success: true, documentId: 'doc_1' })
      expect(mock.history[0].method).toBe('delete')
    })

    it('propagates API errors', async () => {
      mock.onDelete(`${ BASE }/documents/doc_1`).replyWithError({
        message: 'Forbidden',
        body: { message: 'not allowed' },
      })

      await expect(service.deleteDocument('doc_1')).rejects.toThrow('PandaDoc API error: not allowed')
    })
  })

  // ── Templates ──

  describe('listTemplates', () => {
    it('applies the default page size', async () => {
      mock.onGet(`${ BASE }/templates`).reply({ results: [] })

      await service.listTemplates()

      expect(mock.history[0].query).toEqual({ count: 50 })
    })

    it('forwards search, tag, folder and pagination', async () => {
      mock.onGet(`${ BASE }/templates`).reply({ results: [] })

      await service.listTemplates('agreement', 'sales', 'folder-1', 10, 3)

      expect(mock.history[0].query).toEqual({
        q: 'agreement',
        tag: 'sales',
        folder_uuid: 'folder-1',
        count: 10,
        page: 3,
      })
    })
  })

  describe('getTemplateDetails', () => {
    it('requests the template details endpoint', async () => {
      mock.onGet(`${ BASE }/templates/tpl_1/details`).reply({ id: 'tpl_1', roles: [] })

      const result = await service.getTemplateDetails('tpl_1')

      expect(result.id).toBe('tpl_1')
    })
  })

  // ── Contacts ──

  describe('listContacts', () => {
    it('sends no query when no email filter is given', async () => {
      mock.onGet(`${ BASE }/contacts`).reply({ results: [] })

      await service.listContacts()

      expect(mock.history[0].query).toEqual({})
    })

    it('filters by exact email', async () => {
      mock.onGet(`${ BASE }/contacts`).reply({ results: [] })

      await service.listContacts('client@example.com')

      expect(mock.history[0].query).toEqual({ email: 'client@example.com' })
    })
  })

  describe('getContact', () => {
    it('requests the contact by id', async () => {
      mock.onGet(`${ BASE }/contacts/con_1`).reply({ id: 'con_1' })

      const result = await service.getContact('con_1')

      expect(result.id).toBe('con_1')
    })
  })

  describe('createContact', () => {
    it('sends the email only when nothing else is supplied', async () => {
      mock.onPost(`${ BASE }/contacts`).reply({ id: 'con_1' })

      await service.createContact('client@example.com')

      expect(mock.history[0].body).toEqual({ email: 'client@example.com' })
    })

    it('maps every optional field to its API name', async () => {
      mock.onPost(`${ BASE }/contacts`).reply({ id: 'con_1' })

      await service.createContact(
        'client@example.com',
        'John',
        'Smith',
        'Example Corp',
        'CTO',
        '+14155550101',
        '100 Market St',
        'San Francisco',
        'CA',
        '94105'
      )

      expect(mock.history[0].body).toEqual({
        email: 'client@example.com',
        first_name: 'John',
        last_name: 'Smith',
        company: 'Example Corp',
        job_title: 'CTO',
        phone: '+14155550101',
        street_address: '100 Market St',
        city: 'San Francisco',
        state: 'CA',
        postal_code: '94105',
      })
    })
  })

  describe('updateContact', () => {
    it('sends only the changed fields', async () => {
      mock.onPatch(`${ BASE }/contacts/con_1`).reply({ id: 'con_1' })

      await service.updateContact('con_1', undefined, undefined, undefined, undefined, 'VP Engineering')

      expect(mock.history[0].method).toBe('patch')
      expect(mock.history[0].body).toEqual({ job_title: 'VP Engineering' })
    })
  })

  describe('deleteContact', () => {
    it('deletes the contact and reports success', async () => {
      mock.onDelete(`${ BASE }/contacts/con_1`).reply(undefined)

      const result = await service.deleteContact('con_1')

      expect(result).toEqual({ success: true, contactId: 'con_1' })
    })
  })

  // ── Folders ──

  describe('listDocumentFolders', () => {
    it('lists root folders with the default page size', async () => {
      mock.onGet(`${ BASE }/documents/folders`).reply({ results: [] })

      await service.listDocumentFolders()

      expect(mock.history[0].query).toEqual({ count: 50 })
    })

    it('lists subfolders of a parent folder', async () => {
      mock.onGet(`${ BASE }/documents/folders`).reply({ results: [] })

      await service.listDocumentFolders('folder-1', 10, 2)

      expect(mock.history[0].query).toEqual({ parent_uuid: 'folder-1', count: 10, page: 2 })
    })
  })

  describe('createDocumentFolder', () => {
    it('creates a root folder', async () => {
      mock.onPost(`${ BASE }/documents/folders`).reply({ uuid: 'folder-1' })

      const result = await service.createDocumentFolder('Sales Contracts')

      expect(result.uuid).toBe('folder-1')
      expect(mock.history[0].body).toEqual({ name: 'Sales Contracts' })
    })

    it('creates a nested folder', async () => {
      mock.onPost(`${ BASE }/documents/folders`).reply({ uuid: 'folder-2' })

      await service.createDocumentFolder('Q3', 'folder-1')

      expect(mock.history[0].body).toEqual({ name: 'Q3', parent_uuid: 'folder-1' })
    })
  })

  describe('listTemplateFolders', () => {
    it('lists template folders', async () => {
      mock.onGet(`${ BASE }/templates/folders`).reply({ results: [] })

      await service.listTemplateFolders('folder-1')

      expect(mock.history[0].query).toEqual({ parent_uuid: 'folder-1', count: 50 })
    })
  })

  // ── Members ──

  describe('listMembers', () => {
    it('requests the members endpoint', async () => {
      mock.onGet(`${ BASE }/members`).reply({ results: [{ membership_id: 'mem_1' }] })

      const result = await service.listMembers()

      expect(result.results).toHaveLength(1)
    })
  })

  describe('getMember', () => {
    it('requests a member by membership id', async () => {
      mock.onGet(`${ BASE }/members/mem_1`).reply({ membership_id: 'mem_1' })

      const result = await service.getMember('mem_1')

      expect(result.membership_id).toBe('mem_1')
    })
  })

  // ── Webhooks ──

  describe('listWebhookSubscriptions', () => {
    it('requests the webhook subscriptions endpoint', async () => {
      mock.onGet(`${ BASE }/webhook-subscriptions`).reply({ items: [] })

      const result = await service.listWebhookSubscriptions()

      expect(result).toEqual({ items: [] })
    })
  })

  describe('createWebhookSubscription', () => {
    it('maps trigger and payload labels to API values', async () => {
      mock.onPost(`${ BASE }/webhook-subscriptions`).reply({ uuid: 'wh_1' })

      await service.createWebhookSubscription(
        'CRM Sync',
        'https://example.com/hook',
        ['Document State Changed', 'Recipient Completed'],
        ['Fields', 'Tokens']
      )

      expect(mock.history[0].body).toEqual({
        name: 'CRM Sync',
        url: 'https://example.com/hook',
        triggers: ['document_state_changed', 'recipient_completed'],
        payload: ['fields', 'tokens'],
      })
    })

    it('omits the payload when none is selected', async () => {
      mock.onPost(`${ BASE }/webhook-subscriptions`).reply({ uuid: 'wh_1' })

      await service.createWebhookSubscription('CRM Sync', 'https://example.com/hook', ['Document Deleted'], [])

      expect(mock.history[0].body).toEqual({
        name: 'CRM Sync',
        url: 'https://example.com/hook',
        triggers: ['document_deleted'],
      })
    })

    it('passes already-mapped trigger values through unchanged', async () => {
      mock.onPost(`${ BASE }/webhook-subscriptions`).reply({ uuid: 'wh_1' })

      await service.createWebhookSubscription('CRM Sync', 'https://example.com/hook', ['document_updated'])

      expect(mock.history[0].body.triggers).toEqual(['document_updated'])
    })
  })

  describe('deleteWebhookSubscription', () => {
    it('deletes the subscription and reports success', async () => {
      mock.onDelete(`${ BASE }/webhook-subscriptions/wh_1`).reply(undefined)

      const result = await service.deleteWebhookSubscription('wh_1')

      expect(result).toEqual({ success: true, uuid: 'wh_1' })
    })
  })

  // ── API logs ──

  describe('listApiLogEvents', () => {
    it('applies the default page size and drops empty arrays', async () => {
      mock.onGet(`${ BASE }/logs`).reply({ results: [] })

      await service.listApiLogEvents(undefined, undefined, [], [])

      expect(mock.history[0].query).toEqual({ count: 50 })
    })

    it('forwards the time range, statuses and methods', async () => {
      mock.onGet(`${ BASE }/logs`).reply({ results: [] })

      await service.listApiLogEvents('2026-07-01T00:00:00Z', '2026-07-02T00:00:00Z', [200, 400], ['POST'], 10, 2)

      expect(mock.history[0].query).toEqual({
        since: '2026-07-01T00:00:00Z',
        to: '2026-07-02T00:00:00Z',
        statuses: [200, 400],
        methods: ['POST'],
        count: 10,
        page: 2,
      })
    })
  })

  describe('getApiLogEvent', () => {
    it('requests a log event by id', async () => {
      mock.onGet(`${ BASE }/logs/log_1`).reply({ id: 'log_1' })

      const result = await service.getApiLogEvent('log_1')

      expect(result.id).toBe('log_1')
    })
  })

  // ── Dictionaries ──

  describe('getTemplatesDictionary', () => {
    it('maps templates to dictionary items', async () => {
      mock.onGet(`${ BASE }/templates`).reply({
        results: [{ id: 'tpl_1', name: 'Consulting Agreement', date_modified: '2026-06-20T14:30:00.000000Z' }],
      })

      const result = await service.getTemplatesDictionary({})

      expect(result).toEqual({
        items: [{ label: 'Consulting Agreement', value: 'tpl_1', note: 'Modified 2026-06-20' }],
        cursor: null,
      })

      expect(mock.history[0].query).toEqual({ count: 50, page: 1 })
    })

    it('handles a null payload and missing results', async () => {
      mock.onGet(`${ BASE }/templates`).reply({})

      const result = await service.getTemplatesDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('forwards the search term and cursor page', async () => {
      mock.onGet(`${ BASE }/templates`).reply({ results: [] })

      await service.getTemplatesDictionary({ search: 'nda', cursor: '3' })

      expect(mock.history[0].query).toEqual({ q: 'nda', count: 50, page: 3 })
    })

    it('returns the next page cursor when the page is full', async () => {
      const results = Array.from({ length: 50 }, (_, index) => ({ id: `tpl_${ index }`, name: `T${ index }` }))

      mock.onGet(`${ BASE }/templates`).reply({ results })

      const result = await service.getTemplatesDictionary({ cursor: '2' })

      expect(result.cursor).toBe('3')
      expect(result.items[0].note).toBeUndefined()
    })
  })

  describe('getDocumentFoldersDictionary', () => {
    it('maps folders to dictionary items', async () => {
      mock.onGet(`${ BASE }/documents/folders`).reply({
        results: [{ uuid: 'folder-1', name: 'Sales Contracts', date_created: '2026-02-01T08:00:00.000000Z' }],
      })

      const result = await service.getDocumentFoldersDictionary({})

      expect(result).toEqual({
        items: [{ label: 'Sales Contracts', value: 'folder-1', note: 'Created 2026-02-01' }],
        cursor: null,
      })
    })

    it('filters folders client-side by a case-insensitive search term', async () => {
      mock.onGet(`${ BASE }/documents/folders`).reply({
        results: [
          { uuid: 'f1', name: 'Sales Contracts' },
          { uuid: 'f2', name: 'Legal' },
        ],
      })

      const result = await service.getDocumentFoldersDictionary({ search: 'LEGAL' })

      expect(result.items).toEqual([{ label: 'Legal', value: 'f2', note: undefined }])
    })

    it('handles folders without a name and a null payload', async () => {
      mock.onGet(`${ BASE }/documents/folders`).reply({ results: [{ uuid: 'f1' }] })

      const result = await service.getDocumentFoldersDictionary(null)

      expect(result.items).toEqual([{ label: undefined, value: 'f1', note: undefined }])
    })
  })

  describe('getContactsDictionary', () => {
    it('labels contacts with their full name and email', async () => {
      mock.onGet(`${ BASE }/contacts`).reply({
        results: [
          { id: 'con_1', email: 'client@example.com', first_name: 'John', last_name: 'Smith', company: 'Example Corp' },
        ],
      })

      const result = await service.getContactsDictionary({})

      expect(result).toEqual({
        items: [{ label: 'John Smith (client@example.com)', value: 'con_1', note: 'Example Corp' }],
        cursor: null,
      })
    })

    it('falls back to the email when there is no name', async () => {
      mock.onGet(`${ BASE }/contacts`).reply({ results: [{ id: 'con_2', email: 'nobody@example.com' }] })

      const result = await service.getContactsDictionary(null)

      expect(result.items).toEqual([{ label: 'nobody@example.com', value: 'con_2', note: undefined }])
    })

    it('filters client-side on name, email and company', async () => {
      mock.onGet(`${ BASE }/contacts`).reply({
        results: [
          { id: 'con_1', email: 'a@acme.com', first_name: 'John', company: 'Acme' },
          { id: 'con_2', email: 'b@other.com', first_name: 'Jane', company: 'Other' },
        ],
      })

      const result = await service.getContactsDictionary({ search: 'acme' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('con_1')
    })

    it('handles missing results', async () => {
      mock.onGet(`${ BASE }/contacts`).reply({})

      const result = await service.getContactsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getDocumentsDictionary', () => {
    it('maps documents to dictionary items sorted newest first', async () => {
      mock.onGet(`${ BASE }/documents`).reply({
        results: [{ id: 'doc_1', name: 'Agreement', status: 'document.sent' }],
      })

      const result = await service.getDocumentsDictionary({})

      expect(result).toEqual({
        items: [{ label: 'Agreement', value: 'doc_1', note: 'document.sent' }],
        cursor: null,
      })

      expect(mock.history[0].query).toEqual({ order_by: '-date_created', count: 50, page: 1 })
    })

    it('forwards the search term and cursor page', async () => {
      mock.onGet(`${ BASE }/documents`).reply({ results: [] })

      await service.getDocumentsDictionary({ search: 'acme', cursor: '4' })

      expect(mock.history[0].query).toEqual({ q: 'acme', order_by: '-date_created', count: 50, page: 4 })
    })

    it('returns the next page cursor when the page is full', async () => {
      const results = Array.from({ length: 50 }, (_, index) => ({ id: `doc_${ index }`, name: `D${ index }` }))

      mock.onGet(`${ BASE }/documents`).reply({ results })

      const result = await service.getDocumentsDictionary(null)

      expect(result.cursor).toBe('2')
      expect(result.items[0].note).toBeUndefined()
    })
  })
})
