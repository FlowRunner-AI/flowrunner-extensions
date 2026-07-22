'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('OneSimpleApi Service (e2e)', () => {
  let sandbox
  let service

  beforeAll(() => {
    sandbox = createE2ESandbox('one-simple-api')
    require('../src/index.js')

    try {
      sandbox.validateConfigs()
    } catch (error) {
      console.log(error)
      process.exit(1)
    }

    service = sandbox.getService()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Website ──

  describe('takeScreenshot', () => {
    it('captures a screenshot and returns an image URL', async () => {
      const result = await service.takeScreenshot('https://example.com', 'JSON', 800, 600)

      expect(result).toHaveProperty('success', true)
      expect(result).toHaveProperty('result')
    }, 60000)
  })

  describe('generatePdfFromUrl', () => {
    it('generates a PDF from a URL', async () => {
      const result = await service.generatePdfFromUrl('https://example.com', 'JSON')

      expect(result).toHaveProperty('success', true)
      expect(result).toHaveProperty('result')
    }, 60000)
  })

  describe('checkDomainExpiry', () => {
    it('returns domain and SSL expiry info', async () => {
      const result = await service.checkDomainExpiry('https://example.com')

      expect(result).toHaveProperty('success', true)
      expect(result).toHaveProperty('result')
    })
  })

  describe('checkWebsiteStatus', () => {
    it('returns website status info', async () => {
      const result = await service.checkWebsiteStatus('https://example.com')

      expect(result).toHaveProperty('success', true)
      expect(result).toHaveProperty('result')
    })
  })

  // ── Utility ──

  describe('generateQrCode', () => {
    it('generates a QR code', async () => {
      const result = await service.generateQrCode('https://example.com', 200, 'JSON')

      expect(result).toHaveProperty('success', true)
      expect(result).toHaveProperty('result')
    })
  })

  describe('validateEmail', () => {
    it('validates an email address', async () => {
      const result = await service.validateEmail('test@example.com')

      expect(result).toHaveProperty('success', true)
      expect(result).toHaveProperty('result')
    })
  })

  describe('expandUrl', () => {
    it('expands a shortened URL', async () => {
      const result = await service.expandUrl('https://example.com')

      expect(result).toHaveProperty('success', true)
      expect(result).toHaveProperty('result')
    })
  })

  describe('shortenUrl', () => {
    it('shortens a URL', async () => {
      const result = await service.shortenUrl('https://example.com/some/long/path')

      expect(result).toHaveProperty('success', true)
      expect(result).toHaveProperty('result')
    })
  })

  // ── Information ──

  describe('convertCurrency', () => {
    it('converts currency with default amount', async () => {
      const result = await service.convertCurrency('USD', 'EUR')

      expect(result).toHaveProperty('success', true)
      expect(result).toHaveProperty('result')
    })

    it('converts currency with custom amount', async () => {
      const result = await service.convertCurrency('USD', 'GBP', 100)

      expect(result).toHaveProperty('success', true)
      expect(result).toHaveProperty('result')
    })
  })

  describe('getCurrencyList', () => {
    it('returns a list of supported currencies', async () => {
      const result = await service.getCurrencyList()

      expect(result).toHaveProperty('success', true)
      expect(result).toHaveProperty('result')
    })
  })

  describe('getImageInfo', () => {
    it('returns image metadata', async () => {
      const result = await service.getImageInfo(
        'https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/PNG_transparency_demonstration_1.png/280px-PNG_transparency_demonstration_1.png'
      )

      expect(result).toHaveProperty('success', true)
      expect(result).toHaveProperty('result')
    })
  })

  describe('getVideoInfo', () => {
    it('returns video metadata', async () => {
      const result = await service.getVideoInfo('https://www.youtube.com/watch?v=dQw4w9WgXcQ')

      expect(result).toHaveProperty('success', true)
      expect(result).toHaveProperty('result')
    })
  })
})
