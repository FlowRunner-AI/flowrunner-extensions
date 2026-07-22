'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

const SAMPLE_CHART = {
  type: 'bar',
  data: {
    labels: ['Q1', 'Q2', 'Q3'],
    datasets: [{ label: 'Revenue', data: [100, 200, 150] }],
  },
}

describe('QuickChart Service (e2e)', () => {
  let sandbox
  let service

  beforeAll(() => {
    sandbox = createE2ESandbox('quickchart')
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

  // ── createChart ──

  describe('createChart', () => {
    it('creates a chart and returns a hosted URL', async () => {
      const result = await service.createChart(SAMPLE_CHART)

      expect(result).toHaveProperty('success', true)
      expect(result).toHaveProperty('url')
      expect(typeof result.url).toBe('string')
      expect(result.url).toContain('quickchart.io')
    })

    it('creates a chart with all options', async () => {
      const result = await service.createChart(SAMPLE_CHART, 600, 400, 'PNG', 'white', 2, '2')

      expect(result).toHaveProperty('success', true)
      expect(result).toHaveProperty('url')
    })

    it('throws on invalid chart config', async () => {
      await expect(service.createChart('not valid json {')).rejects.toThrow()
    })
  })

  // ── getChartImageUrl ──

  describe('getChartImageUrl', () => {
    it('returns a URL containing the chart config', async () => {
      const result = await service.getChartImageUrl(SAMPLE_CHART)

      expect(result).toHaveProperty('url')
      expect(result.url).toContain('quickchart.io/chart?c=')
    })

    it('includes dimensions in the URL', async () => {
      const result = await service.getChartImageUrl(SAMPLE_CHART, 800, 400)

      expect(result.url).toContain('w=800')
      expect(result.url).toContain('h=400')
    })

    it('includes format in the URL', async () => {
      const result = await service.getChartImageUrl(SAMPLE_CHART, undefined, undefined, 'SVG')

      expect(result.url).toContain('f=svg')
    })
  })

  // ── createQrCode ──

  describe('createQrCode', () => {
    it('returns a URL encoding the given text', async () => {
      const result = await service.createQrCode('https://example.com')

      expect(result).toHaveProperty('url')
      expect(result.url).toContain('quickchart.io/qr?text=')
      expect(result.url).toContain(encodeURIComponent('https://example.com'))
    })

    it('includes all options in the URL', async () => {
      const result = await service.createQrCode('test', 300, 'PNG', 4, '000000', 'ffffff', 'High', 'Scan me')

      expect(result.url).toContain('size=300')
      expect(result.url).toContain('format=png')
      expect(result.url).toContain('margin=4')
      expect(result.url).toContain('dark=000000')
      expect(result.url).toContain('light=ffffff')
      expect(result.url).toContain('ecLevel=H')
      expect(result.url).toContain(`caption=${encodeURIComponent('Scan me')}`)
    })
  })

  // ── createBarcode ──

  describe('createBarcode', () => {
    it('returns a URL for a Code 128 barcode', async () => {
      const result = await service.createBarcode('Code 128', 'ABC-123')

      expect(result).toHaveProperty('url')
      expect(result.url).toContain('quickchart.io/barcode?')
      expect(result.url).toContain('type=code128')
      expect(result.url).toContain('text=ABC-123')
    })

    it('includes width, height, and includeText', async () => {
      const result = await service.createBarcode('Code 39', 'XYZ', 300, 100, true)

      expect(result.url).toContain('type=code39')
      expect(result.url).toContain('width=300')
      expect(result.url).toContain('height=100')
      expect(result.url).toContain('includetext=true')
    })
  })

  // ── createWordCloud ──

  describe('createWordCloud', () => {
    it('returns a URL with the source text', async () => {
      const text = 'hello world data chart visualization graph analytics'
      const result = await service.createWordCloud(text)

      expect(result).toHaveProperty('url')
      expect(result.url).toContain('quickchart.io/wordcloud?text=')
    })

    it('includes all options in the URL', async () => {
      const result = await service.createWordCloud(
        'test words here',
        'SVG',
        800,
        600,
        'white',
        'sans-serif',
        'Square Root',
        50,
        2,
        'Upper',
        true
      )

      expect(result.url).toContain('format=svg')
      expect(result.url).toContain('width=800')
      expect(result.url).toContain('height=600')
      expect(result.url).toContain(`backgroundColor=${encodeURIComponent('white')}`)
      expect(result.url).toContain(`fontFamily=${encodeURIComponent('sans-serif')}`)
      expect(result.url).toContain('scale=sqrt')
      expect(result.url).toContain('maxNumWords=50')
      expect(result.url).toContain('minWordLength=2')
      expect(result.url).toContain('case=upper')
      expect(result.url).toContain('removeStopwords=true')
    })
  })
})
