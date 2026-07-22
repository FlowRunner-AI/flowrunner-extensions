'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-api-key'
const BASE_URL = 'https://quickchart.io'

const SAMPLE_CHART = {
  type: 'bar',
  data: {
    labels: ['Q1', 'Q2'],
    datasets: [{ label: 'Sales', data: [50, 80] }],
  },
}

describe('QuickChart Service', () => {
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
      expect(sandbox.getConfigItems()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'apiKey',
            required: false,
            shared: false,
          }),
        ])
      )
    })
  })

  // ── createChart ──

  describe('createChart', () => {
    it('sends POST with chart config and api key', async () => {
      mock.onPost(`${BASE_URL}/chart/create`).reply({ success: true, url: 'https://quickchart.io/chart/render/zf-abc123' })

      const result = await service.createChart(SAMPLE_CHART)

      expect(result).toEqual({ success: true, url: 'https://quickchart.io/chart/render/zf-abc123' })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].body).toMatchObject({
        chart: SAMPLE_CHART,
        key: API_KEY,
      })
    })

    it('includes all optional parameters when provided', async () => {
      mock.onPost(`${BASE_URL}/chart/create`).reply({ success: true, url: 'https://quickchart.io/chart/render/zf-xyz789' })

      await service.createChart(SAMPLE_CHART, 800, 600, 'SVG', '#ffffff', 2, '4')

      expect(mock.history[0].body).toMatchObject({
        chart: SAMPLE_CHART,
        width: 800,
        height: 600,
        format: 'svg',
        backgroundColor: '#ffffff',
        devicePixelRatio: 2,
        version: '4',
        key: API_KEY,
      })
    })

    it('resolves PNG format from dropdown label', async () => {
      mock.onPost(`${BASE_URL}/chart/create`).reply({ success: true, url: 'https://quickchart.io/chart/render/zf-1' })

      await service.createChart(SAMPLE_CHART, undefined, undefined, 'PNG')

      expect(mock.history[0].body.format).toBe('png')
    })

    it('resolves WebP format from dropdown label', async () => {
      mock.onPost(`${BASE_URL}/chart/create`).reply({ success: true, url: 'https://quickchart.io/chart/render/zf-2' })

      await service.createChart(SAMPLE_CHART, undefined, undefined, 'WebP')

      expect(mock.history[0].body.format).toBe('webp')
    })

    it('omits optional parameters when not provided', async () => {
      mock.onPost(`${BASE_URL}/chart/create`).reply({ success: true, url: 'https://quickchart.io/chart/render/zf-3' })

      await service.createChart(SAMPLE_CHART)

      const body = mock.history[0].body

      expect(body.chart).toEqual(SAMPLE_CHART)
      expect(body.key).toBe(API_KEY)
      expect(body).not.toHaveProperty('width')
      expect(body).not.toHaveProperty('height')
      expect(body).not.toHaveProperty('format')
      expect(body).not.toHaveProperty('backgroundColor')
      expect(body).not.toHaveProperty('devicePixelRatio')
      expect(body).not.toHaveProperty('version')
    })

    it('throws when API returns success:false', async () => {
      mock.onPost(`${BASE_URL}/chart/create`).reply({
        success: false,
        error: 'Invalid chart configuration',
      })

      await expect(service.createChart(SAMPLE_CHART)).rejects.toThrow('Invalid chart configuration')
    })

    it('throws on HTTP error', async () => {
      mock.onPost(`${BASE_URL}/chart/create`).replyWithError({
        message: 'Internal Server Error',
        body: { message: 'Server error' },
      })

      await expect(service.createChart(SAMPLE_CHART)).rejects.toThrow()
    })

    it('uses response.message when error field is absent in API error response', async () => {
      mock.onPost(`${BASE_URL}/chart/create`).reply({
        success: false,
        message: 'Chart type not supported',
      })

      await expect(service.createChart(SAMPLE_CHART)).rejects.toThrow('Chart type not supported')
    })

    it('uses default message when neither error nor message in API error response', async () => {
      mock.onPost(`${BASE_URL}/chart/create`).reply({ success: false })

      await expect(service.createChart(SAMPLE_CHART)).rejects.toThrow('Invalid chart configuration')
    })
  })

  // ── getChartImageUrl ──

  describe('getChartImageUrl', () => {
    it('builds URL with chart config only', async () => {
      const result = await service.getChartImageUrl(SAMPLE_CHART)

      expect(result).toHaveProperty('url')
      expect(result.url).toContain(`${BASE_URL}/chart?c=`)
      expect(result.url).toContain(encodeURIComponent(JSON.stringify(SAMPLE_CHART)))
      expect(result.url).toContain(`key=${encodeURIComponent(API_KEY)}`)
    })

    it('accepts a string chart config', async () => {
      const chartStr = JSON.stringify(SAMPLE_CHART)
      const result = await service.getChartImageUrl(chartStr)

      expect(result.url).toContain(`c=${encodeURIComponent(chartStr)}`)
    })

    it('includes width and height when provided', async () => {
      const result = await service.getChartImageUrl(SAMPLE_CHART, 800, 400)

      expect(result.url).toContain('w=800')
      expect(result.url).toContain('h=400')
    })

    it('includes format when provided', async () => {
      const result = await service.getChartImageUrl(SAMPLE_CHART, undefined, undefined, 'SVG')

      expect(result.url).toContain('f=svg')
    })

    it('includes background color when provided', async () => {
      const result = await service.getChartImageUrl(SAMPLE_CHART, undefined, undefined, undefined, 'white')

      expect(result.url).toContain(`bkg=${encodeURIComponent('white')}`)
    })

    it('omits optional params when not provided', async () => {
      const result = await service.getChartImageUrl(SAMPLE_CHART)

      expect(result.url).not.toContain('w=')
      expect(result.url).not.toContain('h=')
      expect(result.url).not.toContain('f=')
      expect(result.url).not.toContain('bkg=')
    })

    it('does not make any HTTP request', async () => {
      await service.getChartImageUrl(SAMPLE_CHART)

      expect(mock.history).toHaveLength(0)
    })
  })

  // ── createQrCode ──

  describe('createQrCode', () => {
    it('builds URL with text only', async () => {
      const result = await service.createQrCode('https://example.com')

      expect(result).toHaveProperty('url')
      expect(result.url).toContain(`${BASE_URL}/qr?text=`)
      expect(result.url).toContain(encodeURIComponent('https://example.com'))
    })

    it('includes size when provided', async () => {
      const result = await service.createQrCode('test', 300)

      expect(result.url).toContain('size=300')
    })

    it('resolves format dropdown labels', async () => {
      const resultPng = await service.createQrCode('test', undefined, 'PNG')
      const resultSvg = await service.createQrCode('test', undefined, 'SVG')

      expect(resultPng.url).toContain('format=png')
      expect(resultSvg.url).toContain('format=svg')
    })

    it('includes margin when provided', async () => {
      const result = await service.createQrCode('test', undefined, undefined, 8)

      expect(result.url).toContain('margin=8')
    })

    it('includes dark and light colors', async () => {
      const result = await service.createQrCode('test', undefined, undefined, undefined, '000000', 'ffffff')

      expect(result.url).toContain('dark=000000')
      expect(result.url).toContain('light=ffffff')
    })

    it('resolves ecLevel dropdown labels', async () => {
      const resultL = await service.createQrCode('test', undefined, undefined, undefined, undefined, undefined, 'Low')
      const resultH = await service.createQrCode('test', undefined, undefined, undefined, undefined, undefined, 'High')
      const resultQ = await service.createQrCode('test', undefined, undefined, undefined, undefined, undefined, 'Quartile')
      const resultM = await service.createQrCode('test', undefined, undefined, undefined, undefined, undefined, 'Medium')

      expect(resultL.url).toContain('ecLevel=L')
      expect(resultH.url).toContain('ecLevel=H')
      expect(resultQ.url).toContain('ecLevel=Q')
      expect(resultM.url).toContain('ecLevel=M')
    })

    it('includes caption when provided', async () => {
      const result = await service.createQrCode('test', undefined, undefined, undefined, undefined, undefined, undefined, 'Scan me')

      expect(result.url).toContain(`caption=${encodeURIComponent('Scan me')}`)
    })

    it('omits optional params when not provided', async () => {
      const result = await service.createQrCode('test')

      expect(result.url).not.toContain('size=')
      expect(result.url).not.toContain('format=')
      expect(result.url).not.toContain('margin=')
      expect(result.url).not.toContain('dark=')
      expect(result.url).not.toContain('light=')
      expect(result.url).not.toContain('ecLevel=')
      expect(result.url).not.toContain('caption=')
    })

    it('does not make any HTTP request', async () => {
      await service.createQrCode('test')

      expect(mock.history).toHaveLength(0)
    })
  })

  // ── createBarcode ──

  describe('createBarcode', () => {
    it('builds URL with type and text', async () => {
      const result = await service.createBarcode('Code 128', 'ABC-123')

      expect(result).toHaveProperty('url')
      expect(result.url).toContain(`${BASE_URL}/barcode?`)
      expect(result.url).toContain('type=code128')
      expect(result.url).toContain('text=ABC-123')
    })

    it('resolves all barcode type dropdown labels', async () => {
      const types = {
        'Code 128': 'code128',
        'Code 39': 'code39',
        'EAN-13': 'ean13',
        'EAN-8': 'ean8',
        'UPC-A': 'upca',
        'UPC-E': 'upce',
        'ITF-14': 'itf14',
        'Data Matrix': 'datamatrix',
        'PDF417': 'pdf417',
        'QR Code': 'qrcode',
      }

      for (const [label, expected] of Object.entries(types)) {
        const result = await service.createBarcode(label, 'test')

        expect(result.url).toContain(`type=${expected}`)
      }
    })

    it('includes width and height when provided', async () => {
      const result = await service.createBarcode('Code 128', 'test', 300, 100)

      expect(result.url).toContain('width=300')
      expect(result.url).toContain('height=100')
    })

    it('includes includeText=true when true', async () => {
      const result = await service.createBarcode('Code 128', 'test', undefined, undefined, true)

      expect(result.url).toContain('includetext=true')
    })

    it('includes includeText=false when false', async () => {
      const result = await service.createBarcode('Code 128', 'test', undefined, undefined, false)

      expect(result.url).toContain('includetext=false')
    })

    it('omits optional params when not provided', async () => {
      const result = await service.createBarcode('Code 128', 'test')

      expect(result.url).not.toContain('width=')
      expect(result.url).not.toContain('height=')
      expect(result.url).not.toContain('includetext=')
    })

    it('does not make any HTTP request', async () => {
      await service.createBarcode('Code 128', 'test')

      expect(mock.history).toHaveLength(0)
    })
  })

  // ── createWordCloud ──

  describe('createWordCloud', () => {
    it('builds URL with text only', async () => {
      const result = await service.createWordCloud('hello world data chart')

      expect(result).toHaveProperty('url')
      expect(result.url).toContain(`${BASE_URL}/wordcloud?text=`)
      expect(result.url).toContain(encodeURIComponent('hello world data chart'))
      expect(result.url).toContain(`key=${encodeURIComponent(API_KEY)}`)
    })

    it('includes format when provided', async () => {
      const resultPng = await service.createWordCloud('test', 'PNG')
      const resultSvg = await service.createWordCloud('test', 'SVG')

      expect(resultPng.url).toContain('format=png')
      expect(resultSvg.url).toContain('format=svg')
    })

    it('includes width and height when provided', async () => {
      const result = await service.createWordCloud('test', undefined, 800, 400)

      expect(result.url).toContain('width=800')
      expect(result.url).toContain('height=400')
    })

    it('includes backgroundColor when provided', async () => {
      const result = await service.createWordCloud('test', undefined, undefined, undefined, '#ff0000')

      expect(result.url).toContain(`backgroundColor=${encodeURIComponent('#ff0000')}`)
    })

    it('includes fontFamily when provided', async () => {
      const result = await service.createWordCloud('test', undefined, undefined, undefined, undefined, 'sans-serif')

      expect(result.url).toContain(`fontFamily=${encodeURIComponent('sans-serif')}`)
    })

    it('resolves scale dropdown labels', async () => {
      const resultLinear = await service.createWordCloud('test', undefined, undefined, undefined, undefined, undefined, 'Linear')
      const resultSqrt = await service.createWordCloud('test', undefined, undefined, undefined, undefined, undefined, 'Square Root')
      const resultLog = await service.createWordCloud('test', undefined, undefined, undefined, undefined, undefined, 'Logarithmic')

      expect(resultLinear.url).toContain('scale=linear')
      expect(resultSqrt.url).toContain('scale=sqrt')
      expect(resultLog.url).toContain('scale=log')
    })

    it('includes maxNumWords when provided', async () => {
      const result = await service.createWordCloud('test', undefined, undefined, undefined, undefined, undefined, undefined, 100)

      expect(result.url).toContain('maxNumWords=100')
    })

    it('includes minWordLength when provided', async () => {
      const result = await service.createWordCloud('test', undefined, undefined, undefined, undefined, undefined, undefined, undefined, 3)

      expect(result.url).toContain('minWordLength=3')
    })

    it('resolves case dropdown labels', async () => {
      const resultLower = await service.createWordCloud('test', undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'Lower')
      const resultUpper = await service.createWordCloud('test', undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'Upper')
      const resultOrig = await service.createWordCloud('test', undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'Original')

      expect(resultLower.url).toContain('case=lower')
      expect(resultUpper.url).toContain('case=upper')
      expect(resultOrig.url).toContain('case=none')
    })

    it('includes removeStopwords=true when true', async () => {
      const result = await service.createWordCloud('test', undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, true)

      expect(result.url).toContain('removeStopwords=true')
    })

    it('includes removeStopwords=false when false', async () => {
      const result = await service.createWordCloud('test', undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, false)

      expect(result.url).toContain('removeStopwords=false')
    })

    it('omits optional params when not provided', async () => {
      const result = await service.createWordCloud('test')

      expect(result.url).not.toContain('format=')
      expect(result.url).not.toContain('width=')
      expect(result.url).not.toContain('height=')
      expect(result.url).not.toContain('backgroundColor=')
      expect(result.url).not.toContain('fontFamily=')
      expect(result.url).not.toContain('scale=')
      expect(result.url).not.toContain('maxNumWords=')
      expect(result.url).not.toContain('minWordLength=')
      expect(result.url).not.toContain('case=')
      expect(result.url).not.toContain('removeStopwords=')
    })

    it('does not make any HTTP request', async () => {
      await service.createWordCloud('test')

      expect(mock.history).toHaveLength(0)
    })
  })

  // ── No API key ──

  describe('without API key', () => {
    it('getChartImageUrl omits key param when apiKey is falsy', async () => {
      const original = service['apiKey']

      service['apiKey'] = undefined

      const result = await service.getChartImageUrl(SAMPLE_CHART)

      expect(result.url).not.toContain('key=')
      service['apiKey'] = original
    })

    it('createWordCloud omits key param when apiKey is falsy', async () => {
      const original = service['apiKey']

      service['apiKey'] = undefined

      const result = await service.createWordCloud('test text')

      expect(result.url).not.toContain('key=')
      service['apiKey'] = original
    })
  })
})
