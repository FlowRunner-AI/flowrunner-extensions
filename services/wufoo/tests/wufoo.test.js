'use strict'

const { createSandbox } = require('../../../service-sandbox')

const SUBDOMAIN = 'fishbowl'
const API_KEY = 'AOI6-LFKL-VM1Q-IEX9'
const BASE = `https://${ SUBDOMAIN }.wufoo.com/api/v3`
const FORM = 's1afea8b1vk0jf7'

const AUTH_HEADER = `Basic ${ Buffer.from(`${ API_KEY }:footastic`).toString('base64') }`

describe('Wufoo Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ subdomain: SUBDOMAIN, apiKey: API_KEY })
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
    it('registers the required config items in order', () => {
      const configItems = sandbox.getConfigItems()

      expect(configItems.map(item => item.name)).toEqual(['subdomain', 'apiKey'])

      expect(configItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'subdomain', required: true, shared: false, type: 'STRING' }),
          expect.objectContaining({ name: 'apiKey', required: true, shared: false, type: 'STRING' }),
        ])
      )
    })

    it('keeps the config values on the instance', () => {
      expect(service.subdomain).toBe(SUBDOMAIN)
      expect(service.apiKey).toBe(API_KEY)
    })
  })

  // ── Forms ──

  describe('listForms', () => {
    it('sends a GET with basic auth and no query params by default', async () => {
      mock.onGet(`${ BASE }/forms.json`).reply({ Forms: [] })

      const result = await service.listForms()

      expect(result).toEqual({ Forms: [] })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/forms.json`)
      expect(mock.history[0].headers).toEqual({ Authorization: AUTH_HEADER })
      expect(mock.history[0].query).toEqual({})
      expect(mock.history[0].body).toBeUndefined()
    })

    it('forwards paging and the today-count flag', async () => {
      mock.onGet(`${ BASE }/forms.json`).reply({ Forms: [] })

      await service.listForms(2, 50, true)

      expect(mock.history[0].query).toEqual({ page: 2, limit: 50, includeTodayCount: 'true' })
    })

    it('omits the today-count flag when false', async () => {
      mock.onGet(`${ BASE }/forms.json`).reply({ Forms: [] })

      await service.listForms(1, 10, false)

      expect(mock.history[0].query).toEqual({ page: 1, limit: 10 })
    })

    it('throws a Wufoo API error with the HTTP status on transport failure', async () => {
      mock.onGet(`${ BASE }/forms.json`).replyWithError({
        message: 'Unauthorized',
        status: 401,
        body: { ErrorText: 'Invalid API key' },
      })

      await expect(service.listForms()).rejects.toThrow('Wufoo API error (HTTP 401): Invalid API key')
    })

    it('falls back to the transport message when no body is present', async () => {
      mock.onGet(`${ BASE }/forms.json`).replyWithError({ message: 'socket hang up' })

      await expect(service.listForms()).rejects.toThrow('Wufoo API error: socket hang up')
    })

    it('uses the body Text field when ErrorText is absent', async () => {
      mock.onGet(`${ BASE }/forms.json`).replyWithError({
        message: 'Not Found',
        statusCode: 404,
        body: { Text: 'Form not found' },
      })

      await expect(service.listForms()).rejects.toThrow('Wufoo API error (HTTP 404): Form not found')
    })
  })

  describe('getForm', () => {
    it('requests a single form and URL-encodes the identifier', async () => {
      mock.onGet(`${ BASE }/forms/my%2Fform.json`).reply({ Forms: [{ Hash: FORM }] })

      const result = await service.getForm('my/form')

      expect(result.Forms[0].Hash).toBe(FORM)
      expect(mock.history[0].url).toBe(`${ BASE }/forms/my%2Fform.json`)
    })
  })

  describe('listFormFields', () => {
    it('requests the fields endpoint without the system flag', async () => {
      mock.onGet(`${ BASE }/forms/${ FORM }/fields.json`).reply({ Fields: [] })

      const result = await service.listFormFields(FORM)

      expect(result).toEqual({ Fields: [] })
      expect(mock.history[0].query).toEqual({})
    })

    it('adds the system flag when requested', async () => {
      mock.onGet(`${ BASE }/forms/${ FORM }/fields.json`).reply({ Fields: [] })

      await service.listFormFields(FORM, true)

      expect(mock.history[0].query).toEqual({ system: 'true' })
    })
  })

  // ── Entries ──

  describe('listEntries', () => {
    it('requests entries with no query params by default', async () => {
      mock.onGet(`${ BASE }/forms/${ FORM }/entries.json`).reply({ Entries: [], EntryCount: '0' })

      const result = await service.listEntries(FORM)

      expect(result).toEqual({ Entries: [], EntryCount: '0' })
      expect(mock.history[0].query).toEqual({})
    })

    it('maps the sort direction label and forwards paging', async () => {
      mock.onGet(`${ BASE }/forms/${ FORM }/entries.json`).reply({ Entries: [] })

      await service.listEntries(FORM, 0, 25, 'EntryId', 'Descending')

      expect(mock.history[0].query).toEqual({
        pageStart: 0,
        pageSize: 25,
        sort: 'EntryId',
        sortDirection: 'DESC',
      })
    })

    it('maps the ascending sort direction', async () => {
      mock.onGet(`${ BASE }/forms/${ FORM }/entries.json`).reply({ Entries: [] })

      await service.listEntries(FORM, 5, undefined, 'Field1', 'Ascending')

      expect(mock.history[0].query).toEqual({ pageStart: 5, sort: 'Field1', sortDirection: 'ASC' })
    })

    it('caps the page size at 100', async () => {
      mock.onGet(`${ BASE }/forms/${ FORM }/entries.json`).reply({ Entries: [] })

      await service.listEntries(FORM, undefined, 500)

      expect(mock.history[0].query).toEqual({ pageSize: 100 })
    })

    it('builds a single-condition filter with a mapped operator', async () => {
      mock.onGet(`${ BASE }/forms/${ FORM }/entries.json`).reply({ Entries: [] })

      await service.listEntries(FORM, undefined, undefined, undefined, undefined, 'Field1', 'Does not contain', 'spam')

      expect(mock.history[0].query).toEqual({
        Field1: 'Field1',
        Operator1: 'Does_not_contain',
        Value1: 'spam',
        match: 'AND',
      })
    })

    it('passes an unmapped operator through unchanged', async () => {
      mock.onGet(`${ BASE }/forms/${ FORM }/entries.json`).reply({ Entries: [] })

      await service.listEntries(FORM, undefined, undefined, undefined, undefined, 'Field1', 'Is_not_NULL', 'x')

      expect(mock.history[0].query.Operator1).toBe('Is_not_NULL')
    })

    it('skips the filter when the value is empty', async () => {
      mock.onGet(`${ BASE }/forms/${ FORM }/entries.json`).reply({ Entries: [] })

      await service.listEntries(FORM, undefined, undefined, undefined, undefined, 'Field1', 'Contains', '')

      expect(mock.history[0].query).toEqual({})
    })

    it('skips the filter when the operator is missing', async () => {
      mock.onGet(`${ BASE }/forms/${ FORM }/entries.json`).reply({ Entries: [] })

      await service.listEntries(FORM, undefined, undefined, undefined, undefined, 'Field1', undefined, 'value')

      expect(mock.history[0].query).toEqual({})
    })
  })

  describe('getEntryCount', () => {
    it('requests the entry count endpoint', async () => {
      mock.onGet(`${ BASE }/forms/${ FORM }/entries/count.json`).reply({ EntryCount: '42' })

      const result = await service.getEntryCount(FORM)

      expect(result).toEqual({ EntryCount: '42' })
    })
  })

  describe('createEntry', () => {
    it('posts URL-encoded field values', async () => {
      mock.onPost(`${ BASE }/forms/${ FORM }/entries.json`).reply({ Success: 1, EntryId: 10 })

      const result = await service.createEntry(FORM, {
        Field1: 'Jane',
        Field105: 'jane@example.com',
      })

      expect(result).toEqual({ Success: 1, EntryId: 10 })
      expect(mock.history[0].method).toBe('post')

      expect(mock.history[0].headers).toEqual({
        'Authorization': AUTH_HEADER,
        'Content-Type': 'application/x-www-form-urlencoded',
      })

      expect(mock.history[0].body).toBe('Field1=Jane&Field105=jane%40example.com')
    })

    it('drops empty field values and posts an empty body when nothing is provided', async () => {
      mock.onPost(`${ BASE }/forms/${ FORM }/entries.json`).reply({ Success: 1, EntryId: 11 })

      await service.createEntry(FORM, { Field1: 'Jane', Field2: '', Field3: null })
      await service.createEntry(FORM)

      expect(mock.history[0].body).toBe('Field1=Jane')
      expect(mock.history[1].body).toBe('')
    })

    it('throws when Wufoo reports Success:0 with field errors', async () => {
      mock.onPost(`${ BASE }/forms/${ FORM }/entries.json`).reply({
        Success: 0,
        ErrorText: 'Errors have been highlighted below.',
        FieldErrors: [{ ID: 'Field1', ErrorText: 'This field is required.' }],
      })

      await expect(service.createEntry(FORM, { Field2: 'x' })).rejects.toThrow(
        'Wufoo API error: Errors have been highlighted below. (Field1: This field is required.)'
      )
    })

    it('throws a generic rejection when Success:0 has no ErrorText', async () => {
      mock.onPost(`${ BASE }/forms/${ FORM }/entries.json`).reply({ Success: 0 })

      await expect(service.createEntry(FORM, { Field1: 'x' })).rejects.toThrow(
        'Wufoo API error: Request rejected'
      )
    })

    it('does not treat Success:1 as an error', async () => {
      mock.onPost(`${ BASE }/forms/${ FORM }/entries.json`).reply({ Success: 1, EntryId: 12 })

      await expect(service.createEntry(FORM, { Field1: 'x' })).resolves.toEqual({ Success: 1, EntryId: 12 })
    })
  })

  // ── Reports ──

  describe('listReports', () => {
    it('requests the reports endpoint', async () => {
      mock.onGet(`${ BASE }/reports.json`).reply({ Reports: [] })

      const result = await service.listReports()

      expect(result).toEqual({ Reports: [] })
    })
  })

  describe('getReport', () => {
    it('requests a single report', async () => {
      mock.onGet(`${ BASE }/reports/z7x1.json`).reply({ Reports: [{ Hash: 'z7x1' }] })

      const result = await service.getReport('z7x1')

      expect(result.Reports[0].Hash).toBe('z7x1')
    })
  })

  describe('getReportEntries', () => {
    it('requests report entries without paging by default', async () => {
      mock.onGet(`${ BASE }/reports/z7x1/entries.json`).reply({ Entries: [] })

      await service.getReportEntries('z7x1')

      expect(mock.history[0].query).toEqual({})
    })

    it('caps the page size at 100 and forwards the page start', async () => {
      mock.onGet(`${ BASE }/reports/z7x1/entries.json`).reply({ Entries: [] })

      await service.getReportEntries('z7x1', 10, 250)

      expect(mock.history[0].query).toEqual({ pageStart: 10, pageSize: 100 })
    })
  })

  describe('getReportWidgets', () => {
    it('requests the report widgets endpoint', async () => {
      mock.onGet(`${ BASE }/reports/z7x1/widgets.json`).reply({ Widgets: [] })

      const result = await service.getReportWidgets('z7x1')

      expect(result).toEqual({ Widgets: [] })
    })
  })

  // ── Users ──

  describe('listUsers', () => {
    it('requests the users endpoint', async () => {
      mock.onGet(`${ BASE }/users.json`).reply({ Users: [] })

      const result = await service.listUsers()

      expect(result).toEqual({ Users: [] })
    })
  })

  // ── Webhooks ──

  describe('addWebhook', () => {
    it('PUTs the URL-encoded webhook payload', async () => {
      mock.onPut(`${ BASE }/webhooks/${ FORM }.json`).reply({ WebHookPutResult: { Hash: 'm5f5z1a' } })

      const result = await service.addWebhook(FORM, 'https://example.com/hook', 'secret', true)

      expect(result).toEqual({ WebHookPutResult: { Hash: 'm5f5z1a' } })
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].headers['Content-Type']).toBe('application/x-www-form-urlencoded')

      expect(mock.history[0].body).toBe(
        'url=https%3A%2F%2Fexample.com%2Fhook&handshakeKey=secret&metadata=true'
      )
    })

    it('omits the handshake key and metadata flag when not provided', async () => {
      mock.onPut(`${ BASE }/webhooks/${ FORM }.json`).reply({ WebHookPutResult: { Hash: 'm5f5z1a' } })

      await service.addWebhook(FORM, 'https://example.com/hook')

      expect(mock.history[0].body).toBe('url=https%3A%2F%2Fexample.com%2Fhook')
    })
  })

  describe('deleteWebhook', () => {
    it('sends a DELETE to the webhook endpoint', async () => {
      mock.onDelete(`${ BASE }/webhooks/${ FORM }/m5f5z1a.json`).reply({ WebHookDeleteResult: { Hash: 'm5f5z1a' } })

      const result = await service.deleteWebhook(FORM, 'm5f5z1a')

      expect(result).toEqual({ WebHookDeleteResult: { Hash: 'm5f5z1a' } })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].body).toBeUndefined()
    })
  })

  // ── Dictionary ──

  describe('getFormsDictionary', () => {
    const forms = [
      { Name: 'Contact Form', Hash: 's1afea8b1vk0jf7' },
      { Name: 'Feedback Survey', Hash: 'z7x1a9b2c3d4e5' },
      { Hash: 'nonamehash' },
    ]

    it('maps forms to dictionary items', async () => {
      mock.onGet(`${ BASE }/forms.json`).reply({ Forms: forms })

      const result = await service.getFormsDictionary({})

      expect(mock.history[0].query).toEqual({ page: 1, limit: 100 })

      expect(result).toEqual({
        items: [
          { label: 'Contact Form', value: 's1afea8b1vk0jf7', note: 'Hash: s1afea8b1vk0jf7' },
          { label: 'Feedback Survey', value: 'z7x1a9b2c3d4e5', note: 'Hash: z7x1a9b2c3d4e5' },
          { label: 'nonamehash', value: 'nonamehash', note: 'Hash: nonamehash' },
        ],
        cursor: null,
      })
    })

    it('filters case-insensitively by form name', async () => {
      mock.onGet(`${ BASE }/forms.json`).reply({ Forms: forms })

      const result = await service.getFormsDictionary({ search: 'SURVEY' })

      expect(result.items.map(item => item.value)).toEqual(['z7x1a9b2c3d4e5'])
    })

    it('treats the cursor as a page number', async () => {
      mock.onGet(`${ BASE }/forms.json`).reply({ Forms: [] })

      await service.getFormsDictionary({ cursor: '3' })

      expect(mock.history[0].query).toEqual({ page: 3, limit: 100 })
    })

    it('returns the next page cursor when a full page is returned', async () => {
      const fullPage = Array.from({ length: 100 }, (_, index) => ({
        Name: `Form ${ index }`,
        Hash: `hash${ index }`,
      }))

      mock.onGet(`${ BASE }/forms.json`).reply({ Forms: fullPage })

      const result = await service.getFormsDictionary({ cursor: '2' })

      expect(result.cursor).toBe('3')
      expect(result.items).toHaveLength(100)
    })

    it('handles a null payload', async () => {
      mock.onGet(`${ BASE }/forms.json`).reply({ Forms: forms })

      const result = await service.getFormsDictionary(null)

      expect(result.items).toHaveLength(3)
      expect(result.cursor).toBeNull()
    })

    it('handles a response without a Forms array', async () => {
      mock.onGet(`${ BASE }/forms.json`).reply({})

      const result = await service.getFormsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('propagates API errors', async () => {
      mock.onGet(`${ BASE }/forms.json`).replyWithError({ message: 'Forbidden', status: 403 })

      await expect(service.getFormsDictionary({})).rejects.toThrow('Wufoo API error (HTTP 403): Forbidden')
    })
  })
})
