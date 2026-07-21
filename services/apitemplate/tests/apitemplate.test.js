'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-api-key-123'
const BASE = 'https://rest.apitemplate.io/v2'

describe('APITemplate.io Service', () => {
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
          required: true,
          shared: false,
          type: 'STRING',
        }),
        expect.objectContaining({
          name: 'region',
          required: false,
          shared: false,
          type: 'CHOICE',
          options: ['Default', 'Europe (DE)', 'Australia (AU)'],
        }),
      ])
    })
  })

  // ── PDF Generation ──

  describe('createPdf', () => {
    it('sends correct request with required params only', async () => {
      mock.onPost(`${ BASE }/create-pdf`).reply({
        status: 'success',
        download_url: 'https://storage.googleapis.com/pdfsapi/test.pdf',
        template_id: 'tmpl-123',
        transaction_ref: 'txn-abc',
        total_pages: 1,
      })

      const result = await service.createPdf('tmpl-123', { name: 'John' })

      expect(result).toEqual(expect.objectContaining({
        status: 'success',
        download_url: 'https://storage.googleapis.com/pdfsapi/test.pdf',
      }))
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/create-pdf`)
      expect(mock.history[0].headers).toMatchObject({
        'X-API-KEY': API_KEY,
        'Content-Type': 'application/json',
      })
      expect(mock.history[0].query).toMatchObject({ template_id: 'tmpl-123' })
      expect(mock.history[0].body).toEqual({ name: 'John' })
    })

    it('includes all optional params when provided', async () => {
      mock.onPost(`${ BASE }/create-pdf`).reply({ status: 'success' })

      await service.createPdf('tmpl-123', { name: 'Jane' }, 'File Download', true, 'invoice.pdf', 30)

      expect(mock.history[0].query).toMatchObject({
        template_id: 'tmpl-123',
        export_type: 'file',
        output_html: '1',
        filename: 'invoice.pdf',
        expiration: 30,
      })
    })

    it('maps Hosted URL export type to json', async () => {
      mock.onPost(`${ BASE }/create-pdf`).reply({ status: 'success' })

      await service.createPdf('tmpl-123', {}, 'Hosted URL')

      expect(mock.history[0].query).toMatchObject({
        template_id: 'tmpl-123',
        export_type: 'json',
      })
    })

    it('omits output_html when false or not provided', async () => {
      mock.onPost(`${ BASE }/create-pdf`).reply({ status: 'success' })

      await service.createPdf('tmpl-123', {}, undefined, false)

      expect(mock.history[0].query).not.toHaveProperty('output_html')
    })

    it('sends empty object as body when data is not provided', async () => {
      mock.onPost(`${ BASE }/create-pdf`).reply({ status: 'success' })

      await service.createPdf('tmpl-123', undefined)

      expect(mock.history[0].body).toEqual({})
    })

    it('throws on HTTP error', async () => {
      mock.onPost(`${ BASE }/create-pdf`).replyWithError({
        message: 'Unauthorized',
        status: 401,
      })

      await expect(service.createPdf('tmpl-123', {})).rejects.toThrow('APITemplate.io API error (401)')
    })

    it('throws when API returns status error in response body', async () => {
      mock.onPost(`${ BASE }/create-pdf`).reply({
        status: 'error',
        message: 'Invalid template',
      })

      await expect(service.createPdf('bad-tmpl', {})).rejects.toThrow('APITemplate.io API error: Invalid template')
    })
  })

  // ── PDF from HTML ──

  describe('createPdfFromHtml', () => {
    it('sends correct request with required params only', async () => {
      mock.onPost(`${ BASE }/create-pdf-from-html`).reply({
        status: 'success',
        download_url: 'https://storage.googleapis.com/pdfsapi/html.pdf',
      })

      const result = await service.createPdfFromHtml('<h1>Hello</h1>')

      expect(result).toEqual(expect.objectContaining({
        status: 'success',
        download_url: 'https://storage.googleapis.com/pdfsapi/html.pdf',
      }))
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toMatchObject({ body: '<h1>Hello</h1>' })
    })

    it('includes css and settings when provided', async () => {
      mock.onPost(`${ BASE }/create-pdf-from-html`).reply({ status: 'success' })

      const settings = { paper_size: 'A4', orientation: '1' }

      await service.createPdfFromHtml('<h1>Hello</h1>', 'h1 { color: red }', settings)

      expect(mock.history[0].body).toMatchObject({
        body: '<h1>Hello</h1>',
        css: 'h1 { color: red }',
        settings: { paper_size: 'A4', orientation: '1' },
      })
    })

    it('includes output_html and filename in query when provided', async () => {
      mock.onPost(`${ BASE }/create-pdf-from-html`).reply({ status: 'success' })

      await service.createPdfFromHtml('<p>Test</p>', undefined, undefined, true, 'report.pdf')

      expect(mock.history[0].query).toMatchObject({
        output_html: '1',
        filename: 'report.pdf',
      })
    })

    it('omits undefined optional body fields', async () => {
      mock.onPost(`${ BASE }/create-pdf-from-html`).reply({ status: 'success' })

      await service.createPdfFromHtml('<p>Test</p>')

      expect(mock.history[0].body).toEqual({ body: '<p>Test</p>' })
      expect(mock.history[0].body).not.toHaveProperty('css')
      expect(mock.history[0].body).not.toHaveProperty('settings')
    })
  })

  // ── Image Generation ──

  describe('createImage', () => {
    it('sends correct request with template ID and overrides', async () => {
      mock.onPost(`${ BASE }/create-image`).reply({
        status: 'success',
        download_url: 'https://storage.googleapis.com/imagesapi/test.jpeg',
        download_url_png: 'https://storage.googleapis.com/imagesapi/test.png',
      })

      const overrides = { overrides: [{ name: 'text_1', text: 'Hello' }] }
      const result = await service.createImage('img-tmpl-1', overrides)

      expect(result).toEqual(expect.objectContaining({
        status: 'success',
        download_url: 'https://storage.googleapis.com/imagesapi/test.jpeg',
      }))
      expect(mock.history[0].query).toMatchObject({ template_id: 'img-tmpl-1' })
      expect(mock.history[0].body).toEqual(overrides)
    })

    it('sends empty object when overrides is not provided', async () => {
      mock.onPost(`${ BASE }/create-image`).reply({ status: 'success' })

      await service.createImage('img-tmpl-1', undefined)

      expect(mock.history[0].body).toEqual({})
    })
  })

  // ── Templates ──

  describe('listTemplates', () => {
    it('sends GET request to list-templates', async () => {
      const mockResponse = {
        status: 'success',
        templates: [
          { template_id: 'tmpl-1', name: 'Invoice', format: 'PDF' },
          { template_id: 'tmpl-2', name: 'Card', format: 'JPEG' },
        ],
      }

      mock.onGet(`${ BASE }/list-templates`).reply(mockResponse)

      const result = await service.listTemplates()

      expect(result).toEqual(mockResponse)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].headers).toMatchObject({ 'X-API-KEY': API_KEY })
    })
  })

  // ── Objects ──

  describe('listObjects', () => {
    it('sends GET request with default limit', async () => {
      mock.onGet(`${ BASE }/list-objects`).reply({ status: 'success', objects: [] })

      const result = await service.listObjects()

      expect(result).toEqual({ status: 'success', objects: [] })
      expect(mock.history[0].query).toMatchObject({ limit: 300 })
    })

    it('passes custom limit and offset', async () => {
      mock.onGet(`${ BASE }/list-objects`).reply({ status: 'success', objects: [] })

      await service.listObjects(10, 20)

      expect(mock.history[0].query).toMatchObject({ limit: 10, offset: 20 })
    })

    it('omits offset when not provided', async () => {
      mock.onGet(`${ BASE }/list-objects`).reply({ status: 'success', objects: [] })

      await service.listObjects(50)

      expect(mock.history[0].query).toMatchObject({ limit: 50 })
      expect(mock.history[0].query).not.toHaveProperty('offset')
    })
  })

  // ── Delete Object ──

  describe('deleteObject', () => {
    it('sends GET request with transaction_ref query param', async () => {
      mock.onGet(`${ BASE }/delete-object`).reply({ status: 'success' })

      const result = await service.deleteObject('txn-abc-123')

      expect(result).toEqual({ status: 'success' })
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].query).toMatchObject({ transaction_ref: 'txn-abc-123' })
    })
  })

  // ── Account ──

  describe('getAccountInformation', () => {
    it('returns account info', async () => {
      const mockResponse = {
        status: 'success',
        remaining_pdf: 950,
        remaining_image: 480,
        plan: 'Free',
      }

      mock.onGet(`${ BASE }/account-information`).reply(mockResponse)

      const result = await service.getAccountInformation()

      expect(result).toEqual(mockResponse)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
    })
  })

  // ── Dictionary ──

  describe('getTemplatesDictionary', () => {
    const templates = [
      { template_id: 'tmpl-1', name: 'Invoice', format: 'PDF' },
      { template_id: 'tmpl-2', name: 'Social Card', format: 'JPEG' },
      { template_id: 'tmpl-3', name: 'Receipt', format: 'PDF' },
    ]

    it('returns all templates formatted as dictionary items', async () => {
      mock.onGet(`${ BASE }/list-templates`).reply({ status: 'success', templates })

      const result = await service.getTemplatesDictionary({})

      expect(result.items).toHaveLength(3)
      expect(result.items[0]).toEqual({ label: 'Invoice', value: 'tmpl-1', note: 'PDF' })
      expect(result.items[1]).toEqual({ label: 'Social Card', value: 'tmpl-2', note: 'JPEG' })
      expect(result.cursor).toBeNull()
    })

    it('filters templates by search term (case insensitive)', async () => {
      mock.onGet(`${ BASE }/list-templates`).reply({ status: 'success', templates })

      const result = await service.getTemplatesDictionary({ search: 'inv' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toEqual({ label: 'Invoice', value: 'tmpl-1', note: 'PDF' })
    })

    it('returns empty items when search has no match', async () => {
      mock.onGet(`${ BASE }/list-templates`).reply({ status: 'success', templates })

      const result = await service.getTemplatesDictionary({ search: 'nonexistent' })

      expect(result.items).toHaveLength(0)
      expect(result.cursor).toBeNull()
    })

    it('handles empty payload gracefully', async () => {
      mock.onGet(`${ BASE }/list-templates`).reply({ status: 'success', templates })

      const result = await service.getTemplatesDictionary(null)

      expect(result.items).toHaveLength(3)
    })

    it('handles empty templates array', async () => {
      mock.onGet(`${ BASE }/list-templates`).reply({ status: 'success', templates: [] })

      const result = await service.getTemplatesDictionary({})

      expect(result.items).toHaveLength(0)
    })

    it('uses template_id as label when name is missing', async () => {
      mock.onGet(`${ BASE }/list-templates`).reply({
        status: 'success',
        templates: [{ template_id: 'tmpl-no-name' }],
      })

      const result = await service.getTemplatesDictionary({})

      expect(result.items[0].label).toBe('tmpl-no-name')
      expect(result.items[0].note).toBeUndefined()
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('includes status code in error message when available', async () => {
      mock.onGet(`${ BASE }/account-information`).replyWithError({
        message: 'Forbidden',
        status: 403,
      })

      await expect(service.getAccountInformation()).rejects.toThrow('APITemplate.io API error (403)')
    })

    it('includes API message from error body', async () => {
      mock.onGet(`${ BASE }/account-information`).replyWithError({
        message: 'Bad Request',
        body: { message: 'Invalid API key' },
      })

      await expect(service.getAccountInformation()).rejects.toThrow('Invalid API key')
    })

    it('throws when API returns status error in response body', async () => {
      mock.onGet(`${ BASE }/account-information`).reply({
        status: 'error',
        message: 'Rate limit exceeded',
      })

      await expect(service.getAccountInformation()).rejects.toThrow('APITemplate.io API error: Rate limit exceeded')
    })
  })
})
