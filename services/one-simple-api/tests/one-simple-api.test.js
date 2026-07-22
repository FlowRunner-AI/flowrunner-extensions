'use strict'

const { createSandbox } = require('../../../service-sandbox')

const TOKEN = 'test-api-token'
const BASE = 'https://onesimpleapi.com/api'

describe('OneSimpleApi Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ token: TOKEN })
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
          name: 'token',
          required: true,
          shared: false,
          type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
        }),
      ])
    })
  })

  // ── takeScreenshot ──

  describe('takeScreenshot', () => {
    it('sends correct request with required params only', async () => {
      mock.onGet(`${BASE}/screenshot`).reply({
        success: true,
        result: { url: 'https://example.com', image: 'https://cdn.onesimpleapi.com/screenshots/abc.png' },
      })

      const result = await service.takeScreenshot('https://example.com')

      expect(result).toEqual({
        success: true,
        result: { url: 'https://example.com', image: 'https://cdn.onesimpleapi.com/screenshots/abc.png' },
      })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({
        token: TOKEN,
        url: 'https://example.com',
        output: 'json',
      })
      expect(mock.history[0].query.width).toBeUndefined()
      expect(mock.history[0].query.height).toBeUndefined()
      expect(mock.history[0].query.full_page).toBeUndefined()
    })

    it('passes all optional parameters', async () => {
      mock.onGet(`${BASE}/screenshot`).reply({ success: true })

      await service.takeScreenshot('https://example.com', 'Inline', 1920, 1080, true)

      expect(mock.history[0].query).toMatchObject({
        token: TOKEN,
        url: 'https://example.com',
        output: 'inline',
        width: 1920,
        height: 1080,
        full_page: 'true',
      })
    })

    it('resolves JSON output choice', async () => {
      mock.onGet(`${BASE}/screenshot`).reply({ success: true })

      await service.takeScreenshot('https://example.com', 'JSON')

      expect(mock.history[0].query.output).toBe('json')
    })

    it('defaults fullPage to undefined when false', async () => {
      mock.onGet(`${BASE}/screenshot`).reply({ success: true })

      await service.takeScreenshot('https://example.com', undefined, undefined, undefined, false)

      expect(mock.history[0].query.full_page).toBeUndefined()
    })

    it('throws on API error response', async () => {
      mock.onGet(`${BASE}/screenshot`).reply({ success: false, message: 'Invalid URL' })

      await expect(service.takeScreenshot('bad-url')).rejects.toThrow('One Simple API error: Invalid URL')
    })

    it('throws on HTTP error', async () => {
      mock.onGet(`${BASE}/screenshot`).replyWithError({
        message: 'Unauthorized',
        status: 401,
        body: { message: 'Invalid token' },
      })

      await expect(service.takeScreenshot('https://example.com')).rejects.toThrow('One Simple API error (401): Invalid token')
    })
  })

  // ── generatePdfFromUrl ──

  describe('generatePdfFromUrl', () => {
    it('sends correct request with defaults', async () => {
      mock.onGet(`${BASE}/pdf`).reply({
        success: true,
        result: { url: 'https://example.com', pdf: 'https://cdn.onesimpleapi.com/pdf/abc.pdf' },
      })

      const result = await service.generatePdfFromUrl('https://example.com')

      expect(result.success).toBe(true)
      expect(mock.history[0].query).toMatchObject({
        token: TOKEN,
        url: 'https://example.com',
        output: 'json',
      })
    })

    it('passes Inline output', async () => {
      mock.onGet(`${BASE}/pdf`).reply({ success: true })

      await service.generatePdfFromUrl('https://example.com', 'Inline')

      expect(mock.history[0].query.output).toBe('inline')
    })

    it('throws on API error', async () => {
      mock.onGet(`${BASE}/pdf`).reply({ success: false, error: 'Page load failed' })

      await expect(service.generatePdfFromUrl('bad')).rejects.toThrow('One Simple API error: Page load failed')
    })
  })

  // ── generateQrCode ──

  describe('generateQrCode', () => {
    it('sends correct request with required params only', async () => {
      mock.onGet(`${BASE}/qr_code`).reply({
        success: true,
        result: { value: 'https://example.com', image: 'https://cdn.onesimpleapi.com/qr/abc.png' },
      })

      const result = await service.generateQrCode('https://example.com')

      expect(result.success).toBe(true)
      expect(mock.history[0].query).toMatchObject({
        token: TOKEN,
        value: 'https://example.com',
        output: 'json',
      })
      expect(mock.history[0].query.size).toBeUndefined()
    })

    it('passes size parameter', async () => {
      mock.onGet(`${BASE}/qr_code`).reply({ success: true })

      await service.generateQrCode('hello', 300, 'Inline')

      expect(mock.history[0].query).toMatchObject({
        value: 'hello',
        size: 300,
        output: 'inline',
      })
    })
  })

  // ── convertCurrency ──

  describe('convertCurrency', () => {
    it('sends correct request with default amount', async () => {
      mock.onGet(`${BASE}/exchange_rate`).reply({
        success: true,
        result: { from: 'USD', to: 'EUR', amount: 1, rate: 0.92, converted: 0.92 },
      })

      const result = await service.convertCurrency('USD', 'EUR')

      expect(result.result.rate).toBe(0.92)
      expect(mock.history[0].query).toMatchObject({
        token: TOKEN,
        from: 'USD',
        to: 'EUR',
        amount: 1,
      })
    })

    it('passes custom amount', async () => {
      mock.onGet(`${BASE}/exchange_rate`).reply({ success: true })

      await service.convertCurrency('GBP', 'JPY', 500)

      expect(mock.history[0].query).toMatchObject({
        from: 'GBP',
        to: 'JPY',
        amount: 500,
      })
    })

    it('defaults amount to 1 when null', async () => {
      mock.onGet(`${BASE}/exchange_rate`).reply({ success: true })

      await service.convertCurrency('USD', 'EUR', null)

      expect(mock.history[0].query.amount).toBe(1)
    })

    it('defaults amount to 1 when undefined', async () => {
      mock.onGet(`${BASE}/exchange_rate`).reply({ success: true })

      await service.convertCurrency('USD', 'EUR', undefined)

      expect(mock.history[0].query.amount).toBe(1)
    })
  })

  // ── getCurrencyList ──

  describe('getCurrencyList', () => {
    it('sends correct request with no extra params', async () => {
      mock.onGet(`${BASE}/currencies`).reply({
        success: true,
        result: { currencies: [{ code: 'USD', name: 'United States Dollar' }] },
      })

      const result = await service.getCurrencyList()

      expect(result.result.currencies).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({ token: TOKEN })
    })
  })

  // ── validateEmail ──

  describe('validateEmail', () => {
    it('sends correct request', async () => {
      mock.onGet(`${BASE}/email_validation`).reply({
        success: true,
        result: { email: 'user@example.com', valid: true, format_valid: true },
      })

      const result = await service.validateEmail('user@example.com')

      expect(result.result.valid).toBe(true)
      expect(mock.history[0].query).toMatchObject({
        token: TOKEN,
        email: 'user@example.com',
      })
    })
  })

  // ── checkDomainExpiry ──

  describe('checkDomainExpiry', () => {
    it('sends correct request', async () => {
      mock.onGet(`${BASE}/expiry`).reply({
        success: true,
        result: { url: 'https://example.com', domain: 'example.com', domain_expiry: '2027-08-13' },
      })

      const result = await service.checkDomainExpiry('https://example.com')

      expect(result.result.domain).toBe('example.com')
      expect(mock.history[0].query).toMatchObject({
        token: TOKEN,
        url: 'https://example.com',
      })
    })
  })

  // ── expandUrl ──

  describe('expandUrl', () => {
    it('sends correct request', async () => {
      mock.onGet(`${BASE}/url_expand`).reply({
        success: true,
        result: { short_url: 'https://bit.ly/abc', expanded_url: 'https://example.com/page' },
      })

      const result = await service.expandUrl('https://bit.ly/abc')

      expect(result.result.expanded_url).toBe('https://example.com/page')
      expect(mock.history[0].query).toMatchObject({
        token: TOKEN,
        url: 'https://bit.ly/abc',
      })
    })
  })

  // ── shortenUrl ──

  describe('shortenUrl', () => {
    it('sends correct request', async () => {
      mock.onGet(`${BASE}/url_shorten`).reply({
        success: true,
        result: { long_url: 'https://example.com/page', short_url: 'https://osa.link/abc' },
      })

      const result = await service.shortenUrl('https://example.com/page')

      expect(result.result.short_url).toBe('https://osa.link/abc')
      expect(mock.history[0].query).toMatchObject({
        token: TOKEN,
        url: 'https://example.com/page',
      })
    })
  })

  // ── getImageInfo ──

  describe('getImageInfo', () => {
    it('sends correct request', async () => {
      mock.onGet(`${BASE}/image_info`).reply({
        success: true,
        result: { url: 'https://example.com/photo.jpg', width: 1920, height: 1080 },
      })

      const result = await service.getImageInfo('https://example.com/photo.jpg')

      expect(result.result.width).toBe(1920)
      expect(mock.history[0].query).toMatchObject({
        token: TOKEN,
        url: 'https://example.com/photo.jpg',
      })
    })
  })

  // ── getVideoInfo ──

  describe('getVideoInfo', () => {
    it('sends correct request', async () => {
      mock.onGet(`${BASE}/video_info`).reply({
        success: true,
        result: { url: 'https://example.com/clip.mp4', title: 'Clip', duration: 42.5 },
      })

      const result = await service.getVideoInfo('https://example.com/clip.mp4')

      expect(result.result.duration).toBe(42.5)
      expect(mock.history[0].query).toMatchObject({
        token: TOKEN,
        url: 'https://example.com/clip.mp4',
      })
    })
  })

  // ── checkWebsiteStatus ──

  describe('checkWebsiteStatus', () => {
    it('sends correct request', async () => {
      mock.onGet(`${BASE}/website_status`).reply({
        success: true,
        result: { url: 'https://example.com', status: 'up', status_code: 200, response_time: 184 },
      })

      const result = await service.checkWebsiteStatus('https://example.com')

      expect(result.result.status).toBe('up')
      expect(mock.history[0].query).toMatchObject({
        token: TOKEN,
        url: 'https://example.com',
      })
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('uses error.message when body is missing', async () => {
      mock.onGet(`${BASE}/currencies`).replyWithError({ message: 'Network timeout' })

      await expect(service.getCurrencyList()).rejects.toThrow('One Simple API error: Network timeout')
    })

    it('uses error.body.error when available', async () => {
      mock.onGet(`${BASE}/currencies`).replyWithError({
        message: 'Bad Request',
        status: 400,
        body: { error: 'Missing required parameter' },
      })

      await expect(service.getCurrencyList()).rejects.toThrow('One Simple API error (400): Missing required parameter')
    })

    it('handles success:false with error field', async () => {
      mock.onGet(`${BASE}/currencies`).reply({ success: false, error: 'Rate limit exceeded' })

      await expect(service.getCurrencyList()).rejects.toThrow('One Simple API error: Rate limit exceeded')
    })

    it('handles success:false with unknown error', async () => {
      mock.onGet(`${BASE}/currencies`).reply({ success: false })

      await expect(service.getCurrencyList()).rejects.toThrow('One Simple API error: Unknown error')
    })
  })
})
