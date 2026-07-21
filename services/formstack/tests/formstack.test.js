'use strict'

const { createSandbox } = require('../../../service-sandbox')

const ACCESS_TOKEN = 'fs_pat_test_token_123'
const BASE = 'https://www.formstack.com/api/v2025'

describe('Formstack Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ accessToken: ACCESS_TOKEN })
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
      expect(sandbox.getConfigItems()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'accessToken', required: true, shared: false }),
        ])
      )
    })
  })

  // ── Forms ──

  describe('listForms', () => {
    it('sends correct request with defaults', async () => {
      mock.onGet(`${BASE}/forms`).reply({ page: { size: 0 }, forms: [] })
      const result = await service.listForms()

      expect(result).toEqual({ page: { size: 0 }, forms: [] })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({ 'Authorization': `Bearer ${ACCESS_TOKEN}` })
      expect(mock.history[0].query).toMatchObject({ pageNumber: 1, pageSize: 50 })
    })

    it('passes custom parameters', async () => {
      mock.onGet(`${BASE}/forms`).reply({ page: { size: 1 }, forms: [{ id: 1 }] })
      await service.listForms('contact', '84512', 2, 25)

      expect(mock.history[0].query).toMatchObject({
        search: 'contact',
        folder: '84512',
        pageNumber: 2,
        pageSize: 25,
      })
    })

    it('throws on API error', async () => {
      mock.onGet(`${BASE}/forms`).replyWithError({ message: 'Unauthorized' })

      await expect(service.listForms()).rejects.toThrow('Formstack API error')
    })
  })

  describe('getForm', () => {
    it('sends GET to correct URL', async () => {
      mock.onGet(`${BASE}/forms/12345`).reply({ id: 12345, name: 'Test Form', fields: [] })
      const result = await service.getForm('12345')

      expect(result).toEqual({ id: 12345, name: 'Test Form', fields: [] })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({ 'Authorization': `Bearer ${ACCESS_TOKEN}` })
    })
  })

  describe('createForm', () => {
    it('sends POST with name only', async () => {
      mock.onPost(`${BASE}/forms`).reply({ id: 99999, name: 'New Form' })
      const result = await service.createForm('New Form')

      expect(result).toEqual({ id: 99999, name: 'New Form' })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].body).toEqual({ name: 'New Form' })
    })

    it('sends POST with name and folderId', async () => {
      mock.onPost(`${BASE}/forms`).reply({ id: 99999, name: 'New Form', folder: '84512' })
      await service.createForm('New Form', '84512')

      expect(mock.history[0].body).toEqual({ name: 'New Form', folder: '84512' })
    })

    it('omits folderId when not provided', async () => {
      mock.onPost(`${BASE}/forms`).reply({ id: 99999, name: 'New Form' })
      await service.createForm('New Form')

      expect(mock.history[0].body).not.toHaveProperty('folder')
    })
  })

  describe('copyForm', () => {
    it('sends POST to correct URL', async () => {
      mock.onPost(`${BASE}/forms/12345/copy`).reply({ id: 99999, name: 'Copy' })
      const result = await service.copyForm('12345')

      expect(result).toEqual({ id: 99999, name: 'Copy' })
      expect(mock.history).toHaveLength(1)
    })
  })

  describe('deleteForm', () => {
    it('sends DELETE to correct URL', async () => {
      mock.onDelete(`${BASE}/forms/12345`).reply({ success: true })
      const result = await service.deleteForm('12345')

      expect(result).toEqual({ success: true })
      expect(mock.history).toHaveLength(1)
    })
  })

  // ── Submissions ──

  describe('listSubmissions', () => {
    it('sends correct request with defaults', async () => {
      mock.onGet(`${BASE}/forms/12345/submissions`).reply({ page: { size: 0 }, submissions: [] })
      const result = await service.listSubmissions('12345')

      expect(result).toEqual({ page: { size: 0 }, submissions: [] })
      expect(mock.history[0].query).toMatchObject({
        order: 'DESC',
        data: false,
        pageNumber: 1,
        pageSize: 50,
      })
    })

    it('passes all custom parameters', async () => {
      mock.onGet(`${BASE}/forms/12345/submissions`).reply({ page: { size: 1 }, submissions: [{ id: 1 }] })
      await service.listSubmissions('12345', '2024-01-01', '2024-12-31', 'jane', 'Oldest First', true, 3, 10)

      expect(mock.history[0].query).toMatchObject({
        minTime: '2024-01-01',
        maxTime: '2024-12-31',
        keyword: 'jane',
        order: 'ASC',
        data: true,
        pageNumber: 3,
        pageSize: 10,
      })
    })

    it('resolves "Newest First" order correctly', async () => {
      mock.onGet(`${BASE}/forms/12345/submissions`).reply({ page: {}, submissions: [] })
      await service.listSubmissions('12345', undefined, undefined, undefined, 'Newest First')

      expect(mock.history[0].query).toMatchObject({ order: 'DESC' })
    })
  })

  describe('getSubmission', () => {
    it('sends GET to correct URL', async () => {
      mock.onGet(`${BASE}/submissions/778812340`).reply({ id: 778812340, formId: 12345 })
      const result = await service.getSubmission('778812340')

      expect(result).toEqual({ id: 778812340, formId: 12345 })
      expect(mock.history).toHaveLength(1)
    })
  })

  describe('createSubmission', () => {
    it('sends POST with correctly transformed field values', async () => {
      mock.onPost(`${BASE}/forms/12345/submissions`).reply({ id: 778813001 })
      const fieldValues = [
        { field: '48234502', value: 'jane@example.com' },
        { field: '48234501', value: 'Jane Doe' },
      ]
      await service.createSubmission('12345', fieldValues)

      expect(mock.history[0].body).toEqual({
        fields: [
          { id: '48234502', value: { value: 'jane@example.com' } },
          { id: '48234501', value: { value: 'Jane Doe' } },
        ],
      })
    })

    it('sends empty fields array when no field values provided', async () => {
      mock.onPost(`${BASE}/forms/12345/submissions`).reply({ id: 778813002 })
      await service.createSubmission('12345', [])

      expect(mock.history[0].body).toEqual({ fields: [] })
    })

    it('sends empty fields array when fieldValues is null', async () => {
      mock.onPost(`${BASE}/forms/12345/submissions`).reply({ id: 778813003 })
      await service.createSubmission('12345', null)

      expect(mock.history[0].body).toEqual({ fields: [] })
    })

    it('skips entries with null/undefined field ids', async () => {
      mock.onPost(`${BASE}/forms/12345/submissions`).reply({ id: 778813004 })
      const fieldValues = [
        { field: null, value: 'skip' },
        { field: '123', value: 'keep' },
        { field: undefined, value: 'skip' },
      ]
      await service.createSubmission('12345', fieldValues)

      expect(mock.history[0].body).toEqual({
        fields: [{ id: '123', value: { value: 'keep' } }],
      })
    })

    it('converts numeric field ids to strings', async () => {
      mock.onPost(`${BASE}/forms/12345/submissions`).reply({ id: 778813005 })
      await service.createSubmission('12345', [{ field: 48234502, value: 'test' }])

      expect(mock.history[0].body.fields[0].id).toBe('48234502')
    })
  })

  describe('deleteSubmission', () => {
    it('sends DELETE to correct URL', async () => {
      mock.onDelete(`${BASE}/submissions/778812340`).reply({ success: true })
      const result = await service.deleteSubmission('778812340')

      expect(result).toEqual({ success: true })
    })
  })

  // ── Fields ──

  describe('listFormFields', () => {
    it('sends GET to correct URL', async () => {
      mock.onGet(`${BASE}/forms/12345/fields`).reply({ fields: [{ id: 1, label: 'Name', type: 'name' }] })
      const result = await service.listFormFields('12345')

      expect(result).toEqual({ fields: [{ id: 1, label: 'Name', type: 'name' }] })
      expect(mock.history).toHaveLength(1)
    })
  })

  describe('createField', () => {
    it('sends POST with resolved field type', async () => {
      mock.onPost(`${BASE}/forms/12345/fields`).reply({ id: 48239900, label: 'Company', type: 'text' })
      await service.createField('12345', 'Text', 'Company')

      expect(mock.history[0].body).toEqual({ type: 'text', label: 'Company' })
    })

    it('resolves "Date/Time" field type', async () => {
      mock.onPost(`${BASE}/forms/12345/fields`).reply({ id: 48239901, label: 'When', type: 'datetime' })
      await service.createField('12345', 'Date/Time', 'When')

      expect(mock.history[0].body).toEqual({ type: 'datetime', label: 'When' })
    })

    it('resolves "Section Heading" field type', async () => {
      mock.onPost(`${BASE}/forms/12345/fields`).reply({ id: 48239902, label: 'Details', type: 'section' })
      await service.createField('12345', 'Section Heading', 'Details')

      expect(mock.history[0].body).toEqual({ type: 'section', label: 'Details' })
    })

    it('passes through unrecognized field type as-is', async () => {
      mock.onPost(`${BASE}/forms/12345/fields`).reply({ id: 48239903, label: 'Custom', type: 'custom' })
      await service.createField('12345', 'custom', 'Custom')

      expect(mock.history[0].body).toEqual({ type: 'custom', label: 'Custom' })
    })
  })

  // ── Folders ──

  describe('listFolders', () => {
    it('sends GET to correct URL', async () => {
      mock.onGet(`${BASE}/folders`).reply({ folders: [{ id: 84512, name: 'Marketing' }] })
      const result = await service.listFolders()

      expect(result).toEqual({ folders: [{ id: 84512, name: 'Marketing' }] })
      expect(mock.history).toHaveLength(1)
    })
  })

  // ── Webhooks ──

  describe('listWebhooks', () => {
    it('sends GET to correct URL', async () => {
      mock.onGet(`${BASE}/forms/12345/webhooks`).reply({ webhooks: [] })
      const result = await service.listWebhooks('12345')

      expect(result).toEqual({ webhooks: [] })
    })
  })

  describe('createWebhook', () => {
    it('sends POST with url in body', async () => {
      mock.onPost(`${BASE}/forms/12345/webhooks`).reply({ id: 55124, url: 'https://example.com/hook' })
      await service.createWebhook('12345', 'https://example.com/hook')

      expect(mock.history[0].body).toEqual({ url: 'https://example.com/hook' })
    })
  })

  describe('deleteWebhook', () => {
    it('sends DELETE to correct URL with both ids', async () => {
      mock.onDelete(`${BASE}/forms/12345/webhooks/55124`).reply({ success: true })
      const result = await service.deleteWebhook('12345', '55124')

      expect(result).toEqual({ success: true })
      expect(mock.history).toHaveLength(1)
    })
  })

  // ── Confirmations ──

  describe('listConfirmations', () => {
    it('sends GET to correct URL', async () => {
      mock.onGet(`${BASE}/forms/12345/confirmations`).reply({ confirmations: [{ id: 90321 }] })
      const result = await service.listConfirmations('12345')

      expect(result).toEqual({ confirmations: [{ id: 90321 }] })
    })
  })

  // ── Dictionaries ──

  describe('getFormsDictionary', () => {
    it('returns items with correct shape', async () => {
      mock.onGet(`${BASE}/forms`).reply({
        forms: [
          { id: 12345, name: 'Contact Us', submissionsCount: 142 },
          { id: 12346, name: 'Survey', submissionsCount: 0 },
        ],
        page: { totalPages: 1 },
      })

      const result = await service.getFormsDictionary({})

      expect(result.items).toEqual([
        { label: 'Contact Us', value: '12345', note: '142 submissions' },
        { label: 'Survey', value: '12346', note: '0 submissions' },
      ])
      expect(result.cursor).toBeUndefined()
    })

    it('passes search parameter', async () => {
      mock.onGet(`${BASE}/forms`).reply({ forms: [], page: { totalPages: 1 } })
      await service.getFormsDictionary({ search: 'contact' })

      expect(mock.history[0].query).toMatchObject({ search: 'contact', pageSize: 100 })
    })

    it('returns next cursor when more pages exist', async () => {
      mock.onGet(`${BASE}/forms`).reply({ forms: [{ id: 1, name: 'F' }], page: { totalPages: 3 } })
      const result = await service.getFormsDictionary({ cursor: '1' })

      expect(result.cursor).toBe('2')
    })

    it('returns no cursor on last page', async () => {
      mock.onGet(`${BASE}/forms`).reply({ forms: [{ id: 1, name: 'F' }], page: { totalPages: 2 } })
      const result = await service.getFormsDictionary({ cursor: '2' })

      expect(result.cursor).toBeUndefined()
    })

    it('handles null payload', async () => {
      mock.onGet(`${BASE}/forms`).reply({ forms: [], page: { totalPages: 0 } })
      const result = await service.getFormsDictionary(null)

      expect(result.items).toEqual([])
      expect(mock.history[0].query).toMatchObject({ pageNumber: 1 })
    })

    it('uses fallback label when form has no name', async () => {
      mock.onGet(`${BASE}/forms`).reply({ forms: [{ id: 999 }], page: { totalPages: 1 } })
      const result = await service.getFormsDictionary({})

      expect(result.items[0].label).toBe('Form 999')
    })
  })

  describe('getFoldersDictionary', () => {
    it('returns items with correct shape', async () => {
      mock.onGet(`${BASE}/folders`).reply({
        folders: [
          { id: 84512, name: 'Marketing' },
          { id: 84513, name: 'HR' },
        ],
      })

      const result = await service.getFoldersDictionary({})

      expect(result.items).toEqual([
        { label: 'Marketing', value: '84512', note: 'Folder' },
        { label: 'HR', value: '84513', note: 'Folder' },
      ])
      expect(result.cursor).toBeNull()
    })

    it('filters folders by search term', async () => {
      mock.onGet(`${BASE}/folders`).reply({
        folders: [
          { id: 84512, name: 'Marketing' },
          { id: 84513, name: 'HR' },
        ],
      })

      const result = await service.getFoldersDictionary({ search: 'market' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toBe('Marketing')
    })

    it('handles null payload', async () => {
      mock.onGet(`${BASE}/folders`).reply({ folders: [{ id: 1, name: 'Test' }] })
      const result = await service.getFoldersDictionary(null)

      expect(result.items).toHaveLength(1)
    })

    it('uses fallback label when folder has no name', async () => {
      mock.onGet(`${BASE}/folders`).reply({ folders: [{ id: 100 }] })
      const result = await service.getFoldersDictionary({})

      expect(result.items[0].label).toBe('Folder 100')
    })
  })

  // ── Polling Triggers ──

  describe('onNewSubmission', () => {
    const formId = '12345'

    it('returns sample event in learning mode', async () => {
      mock.onGet(`${BASE}/forms/${formId}/submissions`).reply({
        submissions: [{ id: 100, formId: 12345, data: {} }],
      })

      const result = await service.onNewSubmission({
        triggerData: { formId },
        state: {},
        learningMode: true,
      })

      expect(result.events).toHaveLength(1)
      expect(result.events[0]).toEqual({ id: 100, formId: 12345, data: {} })
      expect(result.state).toBeNull()
    })

    it('seeds watermark on first cycle and returns no events', async () => {
      mock.onGet(`${BASE}/forms/${formId}/submissions`).reply({
        submissions: [{ id: 200, formId: 12345 }],
      })

      const result = await service.onNewSubmission({
        triggerData: { formId },
        state: {},
      })

      expect(result.events).toEqual([])
      expect(result.state.seenIds).toEqual(['200'])
      expect(result.state.since).toBeDefined()
    })

    it('seeds empty watermark when no submissions exist', async () => {
      mock.onGet(`${BASE}/forms/${formId}/submissions`).reply({ submissions: [] })

      const result = await service.onNewSubmission({
        triggerData: { formId },
        state: {},
      })

      expect(result.events).toEqual([])
      expect(result.state.seenIds).toEqual([])
    })

    it('returns new submissions on subsequent cycles', async () => {
      mock.onGet(`${BASE}/forms/${formId}/submissions`).reply({
        submissions: [
          { id: 300, formId: 12345 },
          { id: 200, formId: 12345 },
        ],
      })

      const result = await service.onNewSubmission({
        triggerData: { formId },
        state: { since: Date.now() - 60000, seenIds: ['200'] },
      })

      expect(result.events).toHaveLength(1)
      expect(result.events[0].id).toBe(300)
      expect(result.state.seenIds).toContain('300')
      expect(result.state.seenIds).toContain('200')
    })

    it('returns no events when all submissions are seen', async () => {
      mock.onGet(`${BASE}/forms/${formId}/submissions`).reply({
        submissions: [{ id: 200, formId: 12345 }],
      })

      const result = await service.onNewSubmission({
        triggerData: { formId },
        state: { since: Date.now() - 60000, seenIds: ['200'] },
      })

      expect(result.events).toEqual([])
    })

    it('sends correct query params for recent submissions', async () => {
      mock.onGet(`${BASE}/forms/${formId}/submissions`).reply({ submissions: [] })

      await service.onNewSubmission({
        triggerData: { formId },
        state: { since: Date.now(), seenIds: [] },
      })

      expect(mock.history[0].query).toMatchObject({
        data: true,
        order: 'DESC',
        pageSize: 50,
        pageNumber: 1,
      })
    })
  })

  describe('handleTriggerPollingForEvent', () => {
    it('delegates to the correct event handler', async () => {
      mock.onGet(`${BASE}/forms/12345/submissions`).reply({ submissions: [] })

      const result = await service.handleTriggerPollingForEvent({
        eventName: 'onNewSubmission',
        triggerData: { formId: '12345' },
        state: { since: Date.now(), seenIds: [] },
      })

      expect(result).toHaveProperty('events')
      expect(result).toHaveProperty('state')
    })
  })
})
