'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-api-key'
const BASE = 'https://api.pdf.co/v1'

const EXPECTED_HEADERS = {
  'Content-Type': 'application/json',
  'x-api-key': API_KEY,
}

const FILE_URL = 'https://example.com/sample.pdf'

describe('PDF.co Service', () => {
  let sandbox
  let service
  let mock

  const lastCall = () => mock.history[mock.history.length - 1]

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
    it('registers the api key config item', () => {
      const configItems = sandbox.getConfigItems()

      expect(configItems.map(item => item.name)).toEqual(['apiKey'])

      expect(configItems[0]).toEqual(
        expect.objectContaining({
          name: 'apiKey',
          displayName: 'API Key',
          type: 'STRING',
          required: true,
        })
      )
    })

    it('stores the api key on the service instance', () => {
      expect(service.apiKey).toBe(API_KEY)
    })
  })

  // ── Dictionaries ──

  describe('getHtmlTemplatesDictionary', () => {
    const url = `${ BASE }/templates/html`

    const templates = [
      { id: 'inv_001', title: 'Invoice Template', type: 'invoice' },
      { id: 'rpt_002', title: 'Report Template', type: 'report' },
    ]

    it('maps templates to dictionary items', async () => {
      mock.onGet(url).reply({ templates })

      const result = await service.getHtmlTemplatesDictionary({})

      expect(result).toEqual({
        cursor: null,
        items: [
          { label: 'Invoice Template (invoice)', note: 'ID: inv_001', value: 'inv_001' },
          { label: 'Report Template (report)', note: 'ID: rpt_002', value: 'rpt_002' },
        ],
      })

      expect(lastCall().method).toBe('get')
      expect(lastCall().headers).toEqual(EXPECTED_HEADERS)
    })

    it('filters templates by a case-insensitive search on title and type', async () => {
      mock.onGet(url).reply({ templates })

      const byTitle = await service.getHtmlTemplatesDictionary({ search: 'INVOICE tem' })

      expect(byTitle.items).toEqual([
        { label: 'Invoice Template (invoice)', note: 'ID: inv_001', value: 'inv_001' },
      ])

      mock.onGet(url).reply({ templates })

      const byType = await service.getHtmlTemplatesDictionary({ search: 'report' })

      expect(byType.items).toHaveLength(1)
      expect(byType.items[0].value).toBe('rpt_002')
    })

    it('returns an empty item list when no template matches the search', async () => {
      mock.onGet(url).reply({ templates })

      const result = await service.getHtmlTemplatesDictionary({ search: 'nothing-matches' })

      expect(result).toEqual({ cursor: null, items: [] })
    })

    it('handles a response without a templates array', async () => {
      mock.onGet(url).reply({})

      await expect(service.getHtmlTemplatesDictionary({})).resolves.toEqual({ cursor: null, items: [] })
    })

    it('propagates api errors', async () => {
      mock.onGet(url).replyWithError({ message: 'Unauthorized', status: 401 })

      await expect(service.getHtmlTemplatesDictionary({})).rejects.toThrow('Unauthorized')
    })
  })

  // ── Invoice processing ──

  describe('parseInvoice', () => {
    const url = `${ BASE }/ai-invoice-parser`

    it('posts the file url to the ai invoice parser', async () => {
      mock.onPost(url).reply({ error: false, status: 'created', jobId: 'job-1' })

      const result = await service.parseInvoice(FILE_URL)

      expect(result).toEqual({ error: false, status: 'created', jobId: 'job-1' })
      expect(lastCall().method).toBe('post')
      expect(lastCall().headers).toEqual(EXPECTED_HEADERS)
      expect(lastCall().body).toEqual({ url: FILE_URL })
    })

    it('includes the callback url when provided', async () => {
      mock.onPost(url).reply({ jobId: 'job-2' })

      await service.parseInvoice(FILE_URL, 'https://hooks.example.com/pdfco')

      expect(lastCall().body).toEqual({ url: FILE_URL, callback: 'https://hooks.example.com/pdfco' })
    })

    it('validates that a file url is provided', async () => {
      await expect(service.parseInvoice()).rejects.toThrow('File URL is required for invoice parsing')
      expect(mock.history).toHaveLength(0)
    })

    it('prefixes api errors that carry a response body', async () => {
      mock.onPost(url).replyWithError({
        message: 'Bad Request',
        status: 400,
        body: { error: true, message: 'Invalid file' },
      })

      await expect(service.parseInvoice(FILE_URL)).rejects.toThrow('PDF.co API Error: Bad Request')
    })

    it('rethrows transport errors without a body untouched', async () => {
      mock.onPost(url).replyWithError({ message: 'socket hang up' })

      await expect(service.parseInvoice(FILE_URL)).rejects.toThrow('socket hang up')
    })
  })

  // ── Text extraction ──

  describe('convertPdfToTextSimple', () => {
    const url = `${ BASE }/pdf/convert/to/text-simple`

    it('sends only the file url when no options are provided', async () => {
      mock.onPost(url).reply({ body: 'text', status: 200 })

      const result = await service.convertPdfToTextSimple(FILE_URL)

      expect(result).toEqual({ body: 'text', status: 200 })
      expect(lastCall().body).toEqual({ url: FILE_URL })
    })

    it('maps every optional parameter onto the api field names', async () => {
      mock.onPost(url).reply({ status: 200 })

      await service.convertPdfToTextSimple(FILE_URL, 'user', 'pass', '0-2', true, 'secret', false, 'out.txt')

      expect(lastCall().body).toEqual({
        url: FILE_URL,
        httpusername: 'user',
        httppassword: 'pass',
        pages: '0-2',
        inline: true,
        password: 'secret',
        async: false,
        name: 'out.txt',
      })
    })

    it('validates that a file url is provided', async () => {
      await expect(service.convertPdfToTextSimple()).rejects.toThrow(
        'File URL is required for PDF text conversion'
      )
    })
  })

  describe('convertPdfToTextAdvanced', () => {
    const url = `${ BASE }/pdf/convert/to/text`

    it('sends the full advanced option set', async () => {
      mock.onPost(url).reply({ body: 'text', status: 200 })

      await service.convertPdfToTextAdvanced(
        FILE_URL,
        'user',
        'pass',
        '0,1',
        true,
        '10,10,100,100',
        'eng+deu',
        true,
        '1',
        'secret',
        true,
        'out.txt',
        120
      )

      expect(lastCall().body).toEqual({
        url: FILE_URL,
        httpusername: 'user',
        httppassword: 'pass',
        pages: '0,1',
        unwrap: true,
        rect: '10,10,100,100',
        lang: 'eng+deu',
        inline: true,
        lineGrouping: '1',
        password: 'secret',
        async: true,
        name: 'out.txt',
        expiration: 120,
      })
    })

    it('strips undefined optional fields', async () => {
      mock.onPost(url).reply({ status: 200 })

      await service.convertPdfToTextAdvanced(FILE_URL)

      expect(lastCall().body).toEqual({ url: FILE_URL })
    })
  })

  // ── Image conversion ──

  describe('convertPdfToImage', () => {
    it.each([
      ['JPG', 'jpg'],
      ['PNG', 'png'],
      ['WEBP', 'webp'],
      ['TIFF', 'tiff'],
    ])('routes the %s format to the %s endpoint', async (imageFormat, endpoint) => {
      mock.onPost(`${ BASE }/pdf/convert/to/${ endpoint }`).reply({ urls: [], status: 200 })

      await service.convertPdfToImage(FILE_URL, imageFormat)

      expect(lastCall().url).toBe(`${ BASE }/pdf/convert/to/${ endpoint }`)
      expect(lastCall().body).toEqual({ url: FILE_URL })
    })

    it('sends all optional image parameters', async () => {
      mock.onPost(`${ BASE }/pdf/convert/to/png`).reply({ urls: [] })

      await service.convertPdfToImage(
        FILE_URL,
        'PNG',
        'user',
        'pass',
        '0',
        '0,0,50,50',
        false,
        'secret',
        true,
        'page',
        30,
        '{"JPEGQuality":85}'
      )

      expect(lastCall().body).toEqual({
        url: FILE_URL,
        httpusername: 'user',
        httppassword: 'pass',
        pages: '0',
        rect: '0,0,50,50',
        inline: false,
        password: 'secret',
        async: true,
        name: 'page',
        expiration: 30,
        profiles: '{"JPEGQuality":85}',
      })
    })

    it('rejects an unsupported image format', async () => {
      await expect(service.convertPdfToImage(FILE_URL, 'GIF')).rejects.toThrow('Unsupported image format: GIF')
      expect(mock.history).toHaveLength(0)
    })
  })

  // ── Merging ──

  describe('mergePdfs', () => {
    const url = `${ BASE }/pdf/merge`

    it('joins and trims the pdf urls into a comma separated list', async () => {
      mock.onPost(url).reply({ url: 'https://example.com/result.pdf' })

      const result = await service.mergePdfs(['  https://a.pdf ', 'https://b.pdf'])

      expect(result).toEqual({ url: 'https://example.com/result.pdf' })
      expect(lastCall().body).toEqual({ url: 'https://a.pdf,https://b.pdf' })
    })

    it('sends the optional merge parameters', async () => {
      mock.onPost(url).reply({ url: 'https://example.com/result.pdf' })

      await service.mergePdfs(['https://a.pdf'], 'user', 'pass', true, 'merged.pdf', 45, '{"CompressImages":true}')

      expect(lastCall().body).toEqual({
        url: 'https://a.pdf',
        httpusername: 'user',
        httppassword: 'pass',
        async: true,
        name: 'merged.pdf',
        expiration: 45,
        profiles: '{"CompressImages":true}',
      })
    })

    it('rejects an empty url list', async () => {
      await expect(service.mergePdfs([])).rejects.toThrow('At least one PDF URL is required for merging')
    })

    it('rejects a missing url list', async () => {
      await expect(service.mergePdfs()).rejects.toThrow('At least one PDF URL is required for merging')
    })
  })

  describe('mergeDocumentsAdvanced', () => {
    const url = `${ BASE }/pdf/merge2`

    it('joins the file urls and posts to the merge2 endpoint', async () => {
      mock.onPost(url).reply({ url: 'https://example.com/result.pdf' })

      await service.mergeDocumentsAdvanced([' https://a.docx', 'https://b.png '], undefined, undefined, 'out.pdf')

      expect(lastCall().url).toBe(url)
      expect(lastCall().body).toEqual({ url: 'https://a.docx,https://b.png', name: 'out.pdf' })
    })
  })

  // ── Splitting & editing ──

  describe('splitPdf', () => {
    const url = `${ BASE }/pdf/split`

    it('sends the file url and page selection', async () => {
      mock.onPost(url).reply({ urls: ['https://example.com/p1.pdf'] })

      await service.splitPdf(FILE_URL, undefined, undefined, '1,2-3')

      expect(lastCall().body).toEqual({ url: FILE_URL, pages: '1,2-3' })
    })

    it('sends the full option set', async () => {
      mock.onPost(url).reply({ urls: [] })

      await service.splitPdf(FILE_URL, 'user', 'pass', '1-', 'secret', true, false, 'out.pdf', 15, '{}')

      expect(lastCall().body).toEqual({
        url: FILE_URL,
        httpusername: 'user',
        httppassword: 'pass',
        pages: '1-',
        password: 'secret',
        async: true,
        inline: false,
        name: 'out.pdf',
        expiration: 15,
        profiles: '{}',
      })
    })
  })

  describe('deletePdfPages', () => {
    const url = `${ BASE }/pdf/edit/delete-pages`

    it('posts the pages to delete', async () => {
      mock.onPost(url).reply({ url: 'https://example.com/result.pdf', pageCount: 2 })

      const result = await service.deletePdfPages(FILE_URL, undefined, undefined, '1,3')

      expect(result).toHaveProperty('pageCount', 2)
      expect(lastCall().body).toEqual({ url: FILE_URL, pages: '1,3' })
    })

    it('sends the remaining optional parameters', async () => {
      mock.onPost(url).reply({ url: 'https://example.com/result.pdf' })

      await service.deletePdfPages(FILE_URL, 'user', 'pass', '2', 'out.pdf', 60, true, '{}')

      expect(lastCall().body).toEqual({
        url: FILE_URL,
        httpusername: 'user',
        httppassword: 'pass',
        pages: '2',
        name: 'out.pdf',
        expiration: 60,
        async: true,
        profiles: '{}',
      })
    })
  })

  // ── Analysis & optimization ──

  describe('classifyPdf', () => {
    const url = `${ BASE }/pdf/classifier`

    it('sends the file url with the lowercase rules field names', async () => {
      mock.onPost(url).reply({ body: { classes: [{ class: 'invoice' }] }, status: 200 })

      const result = await service.classifyPdf(
        FILE_URL,
        'user',
        'pass',
        'invoice,AND,total',
        'https://example.com/rules.csv',
        false,
        true,
        'secret',
        false,
        'out.json',
        60,
        '{}'
      )

      expect(result.body.classes[0].class).toBe('invoice')

      expect(lastCall().body).toEqual({
        url: FILE_URL,
        httpusername: 'user',
        httppassword: 'pass',
        rulescsv: 'invoice,AND,total',
        rulescsvurl: 'https://example.com/rules.csv',
        caseSensitive: false,
        inline: true,
        password: 'secret',
        async: false,
        name: 'out.json',
        expiration: 60,
        profiles: '{}',
      })
    })

    it('sends only the file url when no options are provided', async () => {
      mock.onPost(url).reply({ status: 200 })

      await service.classifyPdf(FILE_URL)

      expect(lastCall().body).toEqual({ url: FILE_URL })
    })
  })

  describe('compressPdf', () => {
    const url = `${ BASE }/pdf/optimize`

    it('posts the file url to the optimize endpoint', async () => {
      mock.onPost(url).reply({ url: 'https://example.com/small.pdf', fileSize: 1000 })

      const result = await service.compressPdf(FILE_URL)

      expect(result).toHaveProperty('fileSize', 1000)
      expect(lastCall().body).toEqual({ url: FILE_URL })
    })

    it('sends the optional compression parameters', async () => {
      mock.onPost(url).reply({ url: 'https://example.com/small.pdf' })

      await service.compressPdf(FILE_URL, 'user', 'pass', 'small.pdf', 90, 'secret', true, '{"JPEGQuality":25}')

      expect(lastCall().body).toEqual({
        url: FILE_URL,
        httpusername: 'user',
        httppassword: 'pass',
        name: 'small.pdf',
        expiration: 90,
        password: 'secret',
        async: true,
        profiles: '{"JPEGQuality":25}',
      })
    })
  })

  // ── Job management ──

  describe('getJobStatus', () => {
    const url = `${ BASE }/job/check`

    it('posts the job id', async () => {
      mock.onPost(url).reply({ status: 'success', jobId: 'job-1' })

      const result = await service.getJobStatus('job-1')

      expect(result).toEqual({ status: 'success', jobId: 'job-1' })
      expect(lastCall().body).toEqual({ jobId: 'job-1' })
    })

    it('includes the force flag when provided', async () => {
      mock.onPost(url).reply({ status: 'working' })

      await service.getJobStatus('job-1', true)

      expect(lastCall().body).toEqual({ jobId: 'job-1', force: true })
    })

    it('validates that a job id is provided', async () => {
      await expect(service.getJobStatus()).rejects.toThrow('Job ID is required for status checking')
      expect(mock.history).toHaveLength(0)
    })
  })

  // ── Security ──

  describe('addSecurityToPdf', () => {
    const url = `${ BASE }/pdf/security/add`

    it('sends the owner password and permission flags', async () => {
      mock.onPost(url).reply({ url: 'https://example.com/secure.pdf' })

      await service.addSecurityToPdf(
        FILE_URL,
        'owner-pass',
        'user-pass',
        'AES_256bit',
        true,
        false,
        true,
        false,
        true,
        false,
        true,
        'HighResolution',
        false,
        'secure.pdf',
        60,
        '{}'
      )

      expect(lastCall().body).toEqual({
        url: FILE_URL,
        ownerPassword: 'owner-pass',
        userPassword: 'user-pass',
        encryptionAlgorithm: 'AES_256bit',
        allowAccessibilitySupport: true,
        allowAssemblyDocument: false,
        allowPrintDocument: true,
        allowFillForms: false,
        allowModifyDocument: true,
        allowContentExtraction: false,
        allowModifyAnnotations: true,
        printQuality: 'HighResolution',
        async: false,
        name: 'secure.pdf',
        expiration: 60,
        profiles: '{}',
      })
    })

    it('sends only the url and owner password when the rest is omitted', async () => {
      mock.onPost(url).reply({ url: 'https://example.com/secure.pdf' })

      await service.addSecurityToPdf(FILE_URL, 'owner-pass')

      expect(lastCall().body).toEqual({ url: FILE_URL, ownerPassword: 'owner-pass' })
    })
  })

  describe('removeSecurityFromPdf', () => {
    const url = `${ BASE }/pdf/security/remove`

    it('posts the file url and password', async () => {
      mock.onPost(url).reply({ url: 'https://example.com/open.pdf' })

      await service.removeSecurityFromPdf(FILE_URL, 'owner-pass', false, 'open.pdf', 60, '{}')

      expect(lastCall().body).toEqual({
        url: FILE_URL,
        password: 'owner-pass',
        async: false,
        name: 'open.pdf',
        expiration: 60,
        profiles: '{}',
      })
    })
  })

  // ── Barcodes ──

  describe('generateBarcode', () => {
    const url = `${ BASE }/barcode/generate`

    it('posts the barcode value and type', async () => {
      mock.onPost(url).reply({ url: 'https://example.com/barcode.png' })

      const result = await service.generateBarcode('https://example.com', 'QRCode')

      expect(result).toEqual({ url: 'https://example.com/barcode.png' })
      expect(lastCall().body).toEqual({ value: 'https://example.com', type: 'QRCode' })
    })

    it('sends the optional barcode parameters', async () => {
      mock.onPost(url).reply({ url: 'https://example.com/barcode.png' })

      await service.generateBarcode(
        '12345',
        'Code128',
        'barcode.png',
        30,
        true,
        'https://example.com/logo.png',
        false,
        '{"Width":200}'
      )

      expect(lastCall().body).toEqual({
        value: '12345',
        type: 'Code128',
        name: 'barcode.png',
        expiration: 30,
        inline: true,
        decorationImage: 'https://example.com/logo.png',
        async: false,
        profiles: '{"Width":200}',
      })
    })

    it('validates that a value and a type are provided', async () => {
      await expect(service.generateBarcode(undefined, 'QRCode')).rejects.toThrow(
        'Both barcode value and type are required for barcode generation'
      )

      await expect(service.generateBarcode('12345')).rejects.toThrow(
        'Both barcode value and type are required for barcode generation'
      )

      expect(mock.history).toHaveLength(0)
    })
  })

  describe('readBarcodes', () => {
    const url = `${ BASE }/barcode/read/from/url`

    it('posts the file url and barcode type', async () => {
      mock.onPost(url).reply({ barcodes: [{ Value: 'abc', TypeName: 'QRCode' }] })

      const result = await service.readBarcodes(FILE_URL, 'QRCode')

      expect(result.barcodes[0].Value).toBe('abc')
      expect(lastCall().body).toEqual({ url: FILE_URL, type: 'QRCode' })
    })

    it('sends the optional recognition parameters', async () => {
      mock.onPost(url).reply({ barcodes: [] })

      await service.readBarcodes(FILE_URL, 'Code128', 'user', 'pass', '0-', 'Checkbox', true, '{}')

      expect(lastCall().body).toEqual({
        url: FILE_URL,
        type: 'Code128',
        httpusername: 'user',
        httppassword: 'pass',
        pages: '0-',
        types: 'Checkbox',
        async: true,
        profiles: '{}',
      })
    })

    it('validates that a file url and a type are provided', async () => {
      await expect(service.readBarcodes(undefined, 'QRCode')).rejects.toThrow(
        'Both file URL and barcode type are required for barcode reading'
      )

      await expect(service.readBarcodes(FILE_URL)).rejects.toThrow(
        'Both file URL and barcode type are required for barcode reading'
      )

      expect(mock.history).toHaveLength(0)
    })
  })

  // ── Universal conversion ──

  describe('convertPdfTo', () => {
    it.each([
      ['CSV', 'csv'],
      ['JSON', 'json2'],
      ['JSON_Meta', 'json-meta'],
      ['Text', 'text'],
      ['Text_Simple', 'text-simple'],
      ['Excel', 'xls'],
      ['ExcelX', 'xlsx'],
      ['XML', 'xml'],
      ['HTML', 'html'],
      ['Image_JPG', 'jpg'],
      ['Image_PNG', 'png'],
      ['Image_WEBP', 'webp'],
      ['Image_TIFF', 'tiff'],
    ])('routes the %s target to the %s endpoint', async (convertTo, endpoint) => {
      mock.onPost(`${ BASE }/pdf/convert/to/${ endpoint }`).reply({ status: 200 })

      await service.convertPdfTo(FILE_URL, convertTo)

      expect(lastCall().url).toBe(`${ BASE }/pdf/convert/to/${ endpoint }`)
      expect(lastCall().body).toEqual({ url: FILE_URL })
    })

    it('sends the full conversion option set', async () => {
      mock.onPost(`${ BASE }/pdf/convert/to/csv`).reply({ status: 200 })

      await service.convertPdfTo(
        FILE_URL,
        'CSV',
        'user',
        'pass',
        '0-',
        true,
        '0,0,10,10',
        'eng',
        true,
        '1',
        'secret',
        false,
        'out.csv',
        60,
        '{}'
      )

      expect(lastCall().body).toEqual({
        url: FILE_URL,
        httpusername: 'user',
        httppassword: 'pass',
        pages: '0-',
        unwrap: true,
        rect: '0,0,10,10',
        lang: 'eng',
        inline: true,
        lineGrouping: '1',
        password: 'secret',
        async: false,
        name: 'out.csv',
        expiration: 60,
        profiles: '{}',
      })
    })

    it('rejects an unsupported target format', async () => {
      await expect(service.convertPdfTo(FILE_URL, 'DOCX')).rejects.toThrow(
        '[convertPdfTo] Unsupported conversion format: DOCX'
      )

      expect(mock.history).toHaveLength(0)
    })
  })

  describe('convertToPdfFrom', () => {
    it.each([
      ['Document', 'doc'],
      ['CSV', 'csv'],
      ['Image', 'image'],
      ['URL', 'url'],
      ['HTML', 'html'],
      ['Email', 'email'],
    ])('routes the %s source to the %s endpoint', async (convertFrom, endpoint) => {
      mock.onPost(`${ BASE }/pdf/convert/from/${ endpoint }`).reply({ status: 200 })

      await service.convertToPdfFrom(FILE_URL, undefined, undefined, convertFrom)

      expect(lastCall().url).toBe(`${ BASE }/pdf/convert/from/${ endpoint }`)
      expect(lastCall().body).toEqual({ url: FILE_URL })
    })

    it('sends raw html without a file url', async () => {
      mock.onPost(`${ BASE }/pdf/convert/from/html`).reply({ url: 'https://example.com/result.pdf' })

      await service.convertToPdfFrom(undefined, '<h1>Hi</h1>', undefined, 'HTML')

      expect(lastCall().body).toEqual({ html: '<h1>Hi</h1>' })
    })

    it('sends the template id and the remaining options', async () => {
      mock.onPost(`${ BASE }/pdf/convert/from/html`).reply({ url: 'https://example.com/result.pdf' })

      await service.convertToPdfFrom(
        undefined,
        undefined,
        'inv_001',
        'HTML',
        'user',
        'pass',
        true,
        'out.pdf',
        60,
        '{}'
      )

      expect(lastCall().body).toEqual({
        templateId: 'inv_001',
        httpusername: 'user',
        httppassword: 'pass',
        async: true,
        name: 'out.pdf',
        expiration: 60,
        profiles: '{}',
      })
    })

    it('rejects an unsupported source format', async () => {
      await expect(service.convertToPdfFrom(FILE_URL, undefined, undefined, 'Video')).rejects.toThrow(
        '[convertToPdfFrom] Unsupported conversion format: Video'
      )

      expect(mock.history).toHaveLength(0)
    })
  })
})
