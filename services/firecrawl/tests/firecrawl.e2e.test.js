'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Firecrawl Service (e2e)', () => {
  let sandbox
  let service

  beforeAll(() => {
    sandbox = createE2ESandbox('firecrawl')
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

  // ── Account ──

  describe('getCreditUsage', () => {
    it('returns credit usage with expected shape', async () => {
      const result = await service.getCreditUsage()

      expect(result).toHaveProperty('success', true)
      expect(result).toHaveProperty('data')
      expect(result.data).toHaveProperty('remainingCredits')
      expect(result.data).toHaveProperty('planCredits')
      expect(result.data).toHaveProperty('billingPeriodStart')
      expect(result.data).toHaveProperty('billingPeriodEnd')
    })
  })

  describe('getTokenUsage', () => {
    it('returns token usage with expected shape', async () => {
      const result = await service.getTokenUsage()

      expect(result).toHaveProperty('success', true)
      expect(result).toHaveProperty('data')
      expect(result.data).toHaveProperty('remainingTokens')
      expect(result.data).toHaveProperty('planTokens')
    })
  })

  // ── Scraping ──

  describe('scrapeUrl', () => {
    it('scrapes a URL and returns markdown', async () => {
      const result = await service.scrapeUrl('https://example.com', ['Markdown'])

      expect(result).toHaveProperty('success', true)
      expect(result).toHaveProperty('data')
      expect(result.data).toHaveProperty('markdown')
      expect(typeof result.data.markdown).toBe('string')
      expect(result.data).toHaveProperty('metadata')
      expect(result.data.metadata).toHaveProperty('sourceURL')
    }, 30000)

    it('scrapes with multiple formats', async () => {
      const result = await service.scrapeUrl('https://example.com', ['Markdown', 'Links'])

      expect(result).toHaveProperty('success', true)
      expect(result.data).toHaveProperty('markdown')
      expect(result.data).toHaveProperty('links')
      expect(Array.isArray(result.data.links)).toBe(true)
    }, 30000)

    it('scrapes with onlyMainContent disabled', async () => {
      const result = await service.scrapeUrl('https://example.com', ['HTML'], false)

      expect(result).toHaveProperty('success', true)
      expect(result.data).toHaveProperty('html')
      expect(typeof result.data.html).toBe('string')
    }, 30000)
  })

  // ── Mapping ──

  describe('mapUrl', () => {
    it('maps a website and returns links', async () => {
      const result = await service.mapUrl('https://example.com', undefined, 10)

      expect(result).toHaveProperty('success', true)
      expect(result).toHaveProperty('links')
      expect(Array.isArray(result.links)).toBe(true)
    }, 30000)

    it('maps with search filter', async () => {
      const result = await service.mapUrl('https://firecrawl.dev', 'pricing', 5)

      expect(result).toHaveProperty('success', true)
      expect(result).toHaveProperty('links')
      expect(Array.isArray(result.links)).toBe(true)
    }, 30000)
  })

  // ── Search ──

  describe('search', () => {
    it('searches the web and returns results', async () => {
      const result = await service.search('firecrawl web scraping API', undefined, undefined, 3)

      expect(result).toHaveProperty('success', true)
      expect(result).toHaveProperty('data')
    }, 30000)
  })

  // ── Crawling ──

  describe('getActiveCrawls', () => {
    it('returns active crawls list', async () => {
      const result = await service.getActiveCrawls()

      expect(result).toHaveProperty('success', true)
      expect(result).toHaveProperty('crawls')
      expect(Array.isArray(result.crawls)).toBe(true)
    })
  })

  // ── Dictionary ──

  describe('activeCrawlsDictionary', () => {
    it('returns dictionary items', async () => {
      const result = await service.activeCrawlsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor', null)
    })
  })

  // ── Extraction ──

  describe('startExtract + getExtractStatus', () => {
    let extractId

    it('starts an extraction job', async () => {
      const result = await service.startExtract(
        ['https://example.com'],
        'Extract the page title and description',
      )

      expect(result).toHaveProperty('success', true)
      expect(result).toHaveProperty('id')
      expect(typeof result.id).toBe('string')
      extractId = result.id
    }, 30000)

    it('retrieves the extraction status', async () => {
      if (!extractId) {
        return
      }

      const result = await service.getExtractStatus(extractId)

      expect(result).toHaveProperty('success', true)
      expect(result).toHaveProperty('status')
      expect(['processing', 'completed', 'failed']).toContain(result.status)
    }, 30000)
  })

  // ── Batch Scraping ──

  describe('startBatchScrape + getBatchScrapeStatus', () => {
    let batchId

    it('starts a batch scrape job', async () => {
      const result = await service.startBatchScrape(
        ['https://example.com'],
        ['Markdown'],
        true,
      )

      expect(result).toHaveProperty('success', true)
      expect(result).toHaveProperty('id')
      expect(typeof result.id).toBe('string')
      batchId = result.id
    }, 30000)

    it('retrieves the batch scrape status', async () => {
      if (!batchId) {
        return
      }

      const result = await service.getBatchScrapeStatus(batchId)

      expect(result).toHaveProperty('success', true)
      expect(result).toHaveProperty('status')
      expect(['scraping', 'completed', 'failed']).toContain(result.status)
    }, 30000)
  })
})
