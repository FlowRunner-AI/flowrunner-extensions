'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

const SAMPLE_PDF_URL = 'https://pdfco-test-files.s3.us-west-2.amazonaws.com/pdf-to-text/sample.pdf'

describe('PDF.co Service (e2e)', () => {
  let sandbox
  let service
  let testValues
  let pdfUrl

  beforeAll(() => {
    sandbox = createE2ESandbox('pdfco')
    require('../src/index.js')

    try {
      sandbox.validateConfigs()
    } catch (error) {
      console.log(error)
      process.exit(1)
    }

    service = sandbox.getService()
    testValues = sandbox.getTestValues()
    pdfUrl = testValues.pdfUrl || SAMPLE_PDF_URL
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Dictionaries ──

  describe('getHtmlTemplatesDictionary', () => {
    it('returns dictionary items with a label and a value', async () => {
      const result = await service.getHtmlTemplatesDictionary({})

      expect(result).toHaveProperty('items')
      expect(result).toHaveProperty('cursor', null)
      expect(Array.isArray(result.items)).toBe(true)

      result.items.forEach(item => {
        expect(item).toHaveProperty('label')
        expect(item).toHaveProperty('value')
      })
    })

    it('applies a local search filter', async () => {
      const all = await service.getHtmlTemplatesDictionary({})
      const filtered = await service.getHtmlTemplatesDictionary({ search: 'zzz-no-such-template' })

      expect(filtered.items.length).toBeLessThanOrEqual(all.items.length)
    })
  })

  // ── Text extraction ──

  describe('convertPdfToTextSimple', () => {
    it('extracts text inline from a pdf', async () => {
      const result = await service.convertPdfToTextSimple(pdfUrl, null, null, null, true)

      expect(result).toHaveProperty('error', false)
      expect(result).toHaveProperty('body')
    })
  })

  describe('convertPdfToTextAdvanced', () => {
    it('extracts text with ocr options', async () => {
      const result = await service.convertPdfToTextAdvanced(
        pdfUrl,
        null,
        null,
        '0',
        false,
        null,
        'eng',
        true
      )

      expect(result).toHaveProperty('error', false)
      expect(result).toHaveProperty('body')
    })
  })

  // ── Conversion ──

  describe('convertPdfTo', () => {
    it('converts a pdf to csv', async () => {
      const result = await service.convertPdfTo(pdfUrl, 'CSV', null, null, '0', false, null, 'eng', true)

      expect(result).toHaveProperty('error', false)
    })

    it('rejects an unsupported target format without calling the api', async () => {
      await expect(service.convertPdfTo(pdfUrl, 'DOCX')).rejects.toThrow(/Unsupported conversion format/)
    })
  })

  describe('convertToPdfFrom', () => {
    it('converts raw html into a pdf', async () => {
      const result = await service.convertToPdfFrom(
        null,
        '<h1>FlowRunner e2e</h1>',
        null,
        'HTML'
      )

      expect(result).toHaveProperty('error', false)
      expect(result).toHaveProperty('url')
    })
  })

  describe('convertPdfToImage', () => {
    it('converts a pdf page to a png image', async () => {
      const result = await service.convertPdfToImage(pdfUrl, 'PNG', null, null, '0')

      expect(result).toHaveProperty('error', false)
      expect(Array.isArray(result.urls)).toBe(true)
    })

    it('rejects an unsupported image format without calling the api', async () => {
      await expect(service.convertPdfToImage(pdfUrl, 'GIF')).rejects.toThrow(/Unsupported image format/)
    })
  })

  // ── Document operations ──

  describe('mergePdfs', () => {
    it('merges two pdf documents', async () => {
      const result = await service.mergePdfs([pdfUrl, pdfUrl])

      expect(result).toHaveProperty('error', false)
      expect(result).toHaveProperty('url')
    })

    it('rejects an empty url list', async () => {
      await expect(service.mergePdfs([])).rejects.toThrow(/At least one PDF URL is required/)
    })
  })

  describe('mergeDocumentsAdvanced', () => {
    it('merges documents through the advanced endpoint', async () => {
      const result = await service.mergeDocumentsAdvanced([pdfUrl, pdfUrl])

      expect(result).toHaveProperty('error', false)
      expect(result).toHaveProperty('url')
    })
  })

  describe('splitPdf', () => {
    it('splits a pdf by page range', async () => {
      const result = await service.splitPdf(pdfUrl, null, null, '1')

      expect(result).toHaveProperty('error', false)
      expect(Array.isArray(result.urls)).toBe(true)
    })
  })

  describe('deletePdfPages', () => {
    it('deletes a page from a pdf', async () => {
      const result = await service.deletePdfPages(pdfUrl, null, null, '1')

      expect(result).toHaveProperty('error', false)
    })
  })

  describe('compressPdf', () => {
    it('optimizes a pdf', async () => {
      const result = await service.compressPdf(pdfUrl)

      expect(result).toHaveProperty('error', false)
      expect(result).toHaveProperty('url')
    })
  })

  describe('classifyPdf', () => {
    it('classifies a pdf document', async () => {
      const result = await service.classifyPdf(pdfUrl, null, null, null, null, false, true)

      expect(result).toHaveProperty('error', false)
    })
  })

  // ── Security ──

  describe('pdf security', () => {
    it('adds and then removes security from a pdf', async () => {
      const secured = await service.addSecurityToPdf(pdfUrl, 'owner-pass-e2e')

      expect(secured).toHaveProperty('error', false)
      expect(secured).toHaveProperty('url')

      const opened = await service.removeSecurityFromPdf(secured.url, 'owner-pass-e2e')

      expect(opened).toHaveProperty('error', false)
      expect(opened).toHaveProperty('url')
    })
  })

  // ── Barcodes ──

  describe('barcodes', () => {
    it('generates a qr code and reads it back', async () => {
      const generated = await service.generateBarcode('flowrunner-e2e', 'QRCode')

      expect(generated).toHaveProperty('error', false)
      expect(generated).toHaveProperty('url')

      const read = await service.readBarcodes(generated.url, 'QRCode')

      expect(read).toHaveProperty('error', false)
      expect(Array.isArray(read.barcodes)).toBe(true)
    })

    it('validates barcode generation input', async () => {
      await expect(service.generateBarcode('value-only')).rejects.toThrow(
        /Both barcode value and type are required/
      )
    })
  })

  // ── Async jobs ──

  describe('getJobStatus', () => {
    it('reports the status of an asynchronous conversion', async () => {
      const started = await service.convertPdfToTextSimple(pdfUrl, null, null, null, false, null, true)

      expect(started).toHaveProperty('jobId')

      const status = await service.getJobStatus(started.jobId)

      expect(status).toHaveProperty('status')
      expect(status).toHaveProperty('jobId', started.jobId)
    })

    it('validates that a job id is provided', async () => {
      await expect(service.getJobStatus()).rejects.toThrow(/Job ID is required/)
    })
  })

  // ── Invoice parsing ──

  describe('parseInvoice', () => {
    it('starts an ai invoice parsing job', async () => {
      const { invoicePdfUrl } = testValues

      if (!invoicePdfUrl) {
        console.log('Skipping parseInvoice: testValues.invoicePdfUrl not set')

        return
      }

      const result = await service.parseInvoice(invoicePdfUrl)

      expect(result).toHaveProperty('error', false)
      expect(result).toHaveProperty('jobId')
    })

    it('validates that a file url is provided', async () => {
      await expect(service.parseInvoice()).rejects.toThrow(/File URL is required/)
    })
  })
})
