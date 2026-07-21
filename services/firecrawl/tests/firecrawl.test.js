'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'fc-test-api-key-123'
const BASE = 'https://api.firecrawl.dev/v2'

describe('Firecrawl Service', () => {
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
      ])
    })
  })

  // ── Scraping ──

  describe('scrapeUrl', () => {
    it('sends correct request with required params only', async () => {
      mock.onPost(`${ BASE }/scrape`).reply({ success: true, data: { markdown: '# Hello' } })

      const result = await service.scrapeUrl('https://example.com')

      expect(result).toEqual({ success: true, data: { markdown: '# Hello' } })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({
        'Authorization': `Bearer ${ API_KEY }`,
        'Content-Type': 'application/json',
      })
      expect(mock.history[0].body).toEqual({ url: 'https://example.com' })
    })

    it('sends formats resolved from display names', async () => {
      mock.onPost(`${ BASE }/scrape`).reply({ success: true, data: {} })

      await service.scrapeUrl('https://example.com', ['Markdown', 'HTML', 'Links'])

      expect(mock.history[0].body).toMatchObject({
        url: 'https://example.com',
        formats: ['markdown', 'html', 'links'],
      })
    })

    it('handles Screenshot (Full Page) format', async () => {
      mock.onPost(`${ BASE }/scrape`).reply({ success: true, data: {} })

      await service.scrapeUrl('https://example.com', ['Screenshot (Full Page)'])

      expect(mock.history[0].body.formats).toEqual([
        { type: 'screenshot', fullPage: true },
      ])
    })

    it('adds JSON extraction format when jsonPrompt is provided', async () => {
      mock.onPost(`${ BASE }/scrape`).reply({ success: true, data: {} })

      await service.scrapeUrl('https://example.com', ['Markdown'], undefined, 'Extract the title')

      expect(mock.history[0].body.formats).toEqual([
        'markdown',
        { type: 'json', prompt: 'Extract the title' },
      ])
    })

    it('adds JSON extraction format with schema', async () => {
      mock.onPost(`${ BASE }/scrape`).reply({ success: true, data: {} })
      const schema = { type: 'object', properties: { title: { type: 'string' } } }

      await service.scrapeUrl('https://example.com', [], undefined, undefined, schema)

      expect(mock.history[0].body.formats).toEqual([
        { type: 'json', schema },
      ])
    })

    it('includes all optional params when provided', async () => {
      mock.onPost(`${ BASE }/scrape`).reply({ success: true, data: {} })

      await service.scrapeUrl(
        'https://example.com',
        ['Markdown'],
        true,
        undefined,
        undefined,
        ['article'],
        ['nav'],
        2000,
        true,
        0,
        30000,
        'Enhanced',
        [{ type: 'wait', milliseconds: 1000 }],
        { country: 'DE' },
        { blockAds: true },
      )

      expect(mock.history[0].body).toMatchObject({
        url: 'https://example.com',
        formats: ['markdown'],
        onlyMainContent: true,
        includeTags: ['article'],
        excludeTags: ['nav'],
        waitFor: 2000,
        mobile: true,
        maxAge: 0,
        timeout: 30000,
        proxy: 'enhanced',
        actions: [{ type: 'wait', milliseconds: 1000 }],
        location: { country: 'DE' },
        blockAds: true,
      })
    })

    it('resolves proxy choice values', async () => {
      mock.onPost(`${ BASE }/scrape`).reply({ success: true, data: {} })

      await service.scrapeUrl('https://example.com', undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'Auto')

      expect(mock.history[0].body).toMatchObject({ proxy: 'auto' })
    })

    it('omits undefined/null/empty optional fields', async () => {
      mock.onPost(`${ BASE }/scrape`).reply({ success: true, data: {} })

      await service.scrapeUrl('https://example.com', [], undefined, undefined, undefined, [], undefined)

      const body = mock.history[0].body
      expect(body).toEqual({ url: 'https://example.com' })
      expect(body).not.toHaveProperty('formats')
      expect(body).not.toHaveProperty('includeTags')
      expect(body).not.toHaveProperty('onlyMainContent')
    })

    it('throws on API error', async () => {
      mock.onPost(`${ BASE }/scrape`).replyWithError({
        message: 'Unauthorized',
        body: { error: 'Invalid API key' },
      })

      await expect(service.scrapeUrl('https://example.com')).rejects.toThrow('Firecrawl API error: Invalid API key')
    })
  })

  // ── Batch Scraping ──

  describe('startBatchScrape', () => {
    it('sends correct request with required params', async () => {
      mock.onPost(`${ BASE }/batch/scrape`).reply({ success: true, id: 'batch-123', url: `${ BASE }/batch/scrape/batch-123` })

      const result = await service.startBatchScrape(['https://a.com', 'https://b.com'])

      expect(result).toMatchObject({ success: true, id: 'batch-123' })
      expect(mock.history[0].body).toEqual({ urls: ['https://a.com', 'https://b.com'] })
    })

    it('includes all optional params', async () => {
      mock.onPost(`${ BASE }/batch/scrape`).reply({ success: true, id: 'batch-456' })

      await service.startBatchScrape(
        ['https://a.com'],
        ['Markdown', 'Summary'],
        true,
        'Extract prices',
        undefined,
        5,
        true,
        { url: 'https://hook.example.com' },
        { waitFor: 1000 },
      )

      expect(mock.history[0].body).toMatchObject({
        urls: ['https://a.com'],
        formats: ['markdown', 'summary', { type: 'json', prompt: 'Extract prices' }],
        onlyMainContent: true,
        maxConcurrency: 5,
        ignoreInvalidURLs: true,
        webhook: { url: 'https://hook.example.com' },
        waitFor: 1000,
      })
    })
  })

  describe('getBatchScrapeStatus', () => {
    it('fetches status by job id', async () => {
      mock.onGet(`${ BASE }/batch/scrape/batch-123`).reply({ success: true, status: 'completed', data: [] })

      const result = await service.getBatchScrapeStatus('batch-123')

      expect(result).toMatchObject({ status: 'completed' })
      expect(mock.history).toHaveLength(1)
    })

    it('fetches next page URL when provided', async () => {
      const nextUrl = 'https://api.firecrawl.dev/v2/batch/scrape/batch-123?skip=10'
      mock.onGet(nextUrl).reply({ success: true, data: [{ markdown: 'page2' }], next: null })

      const result = await service.getBatchScrapeStatus('batch-123', nextUrl)

      expect(mock.history[0].url).toBe(nextUrl)
      expect(result.data).toHaveLength(1)
    })

    it('rejects non-firecrawl nextPageUrl', async () => {
      await expect(service.getBatchScrapeStatus('batch-123', 'https://evil.com/data'))
        .rejects.toThrow('nextPageUrl must be a https://api.firecrawl.dev URL')
    })
  })

  describe('batchScrapeAndWait', () => {
    it('starts batch, polls until completed, and collects data', async () => {
      // Start batch
      mock.onPost(`${ BASE }/batch/scrape`).reply({ success: true, id: 'bw-1' })
      // First poll: still scraping
      mock.onGet(`${ BASE }/batch/scrape/bw-1`).replyWith(() => {
        // Second call returns completed
        mock.onGet(`${ BASE }/batch/scrape/bw-1`).reply({
          success: true, status: 'completed', data: [{ markdown: 'A' }], next: null,
        })
        return { success: true, status: 'completed', data: [{ markdown: 'A' }], next: null }
      })

      const result = await service.batchScrapeAndWait(['https://a.com'])

      expect(result).toMatchObject({ status: 'completed', id: 'bw-1' })
      expect(result.data).toEqual([{ markdown: 'A' }])
    })

    it('follows pagination in results', async () => {
      const nextUrl = 'https://api.firecrawl.dev/v2/batch/scrape/bw-2?skip=1'
      mock.onPost(`${ BASE }/batch/scrape`).reply({ success: true, id: 'bw-2' })
      mock.onGet(`${ BASE }/batch/scrape/bw-2`).reply({
        success: true, status: 'completed', data: [{ markdown: 'A' }], next: nextUrl,
      })
      mock.onGet(nextUrl).reply({ success: true, data: [{ markdown: 'B' }], next: null })

      const result = await service.batchScrapeAndWait(['https://a.com', 'https://b.com'])

      expect(result.data).toEqual([{ markdown: 'A' }, { markdown: 'B' }])
    })
  })

  // ── Crawling ──

  describe('startCrawl', () => {
    it('sends correct request with required params', async () => {
      mock.onPost(`${ BASE }/crawl`).reply({ success: true, id: 'crawl-1' })

      const result = await service.startCrawl('https://docs.example.com')

      expect(result).toMatchObject({ id: 'crawl-1' })
      expect(mock.history[0].body).toEqual({ url: 'https://docs.example.com' })
    })

    it('includes all optional params', async () => {
      mock.onPost(`${ BASE }/crawl`).reply({ success: true, id: 'crawl-2' })

      await service.startCrawl(
        'https://docs.example.com',
        'Crawl the docs',
        100,
        3,
        ['^/docs/.*'],
        ['^/admin/.*'],
        'Skip',
        true,
        false,
        true,
        2,
        5,
        { formats: ['markdown'] },
        { url: 'https://hook.example.com' },
        { ignoreQueryParameters: true },
      )

      expect(mock.history[0].body).toMatchObject({
        url: 'https://docs.example.com',
        prompt: 'Crawl the docs',
        limit: 100,
        maxDiscoveryDepth: 3,
        includePaths: ['^/docs/.*'],
        excludePaths: ['^/admin/.*'],
        sitemap: 'skip',
        crawlEntireDomain: true,
        allowExternalLinks: false,
        allowSubdomains: true,
        delay: 2,
        maxConcurrency: 5,
        scrapeOptions: { formats: ['markdown'] },
        webhook: { url: 'https://hook.example.com' },
        ignoreQueryParameters: true,
      })
    })

    it('resolves sitemap choice values', async () => {
      mock.onPost(`${ BASE }/crawl`).reply({ success: true, id: 'crawl-3' })

      await service.startCrawl('https://example.com', undefined, undefined, undefined, undefined, undefined, 'Only')

      expect(mock.history[0].body).toMatchObject({ sitemap: 'only' })
    })
  })

  describe('getCrawlStatus', () => {
    it('fetches status by job id', async () => {
      mock.onGet(`${ BASE }/crawl/crawl-1`).reply({ success: true, status: 'scraping', total: 10, completed: 3 })

      const result = await service.getCrawlStatus('crawl-1')

      expect(result).toMatchObject({ status: 'scraping', total: 10, completed: 3 })
    })

    it('uses nextPageUrl when provided', async () => {
      const nextUrl = 'https://api.firecrawl.dev/v2/crawl/crawl-1?skip=10'
      mock.onGet(nextUrl).reply({ success: true, data: [] })

      await service.getCrawlStatus('crawl-1', nextUrl)

      expect(mock.history[0].url).toBe(nextUrl)
    })

    it('rejects non-firecrawl nextPageUrl', async () => {
      await expect(service.getCrawlStatus('crawl-1', 'https://evil.com/data'))
        .rejects.toThrow('nextPageUrl must be a https://api.firecrawl.dev URL')
    })
  })

  describe('crawlAndWait', () => {
    it('starts crawl, polls, and returns results with job id', async () => {
      mock.onPost(`${ BASE }/crawl`).reply({ success: true, id: 'cw-1' })
      mock.onGet(`${ BASE }/crawl/cw-1`).reply({
        success: true, status: 'completed', data: [{ markdown: 'Page 1' }], next: null,
      })

      const result = await service.crawlAndWait('https://docs.example.com', 5)

      expect(result).toMatchObject({ status: 'completed', id: 'cw-1' })
      expect(result.data).toEqual([{ markdown: 'Page 1' }])
    })

    it('passes optional params to startCrawl', async () => {
      mock.onPost(`${ BASE }/crawl`).reply({ success: true, id: 'cw-2' })
      mock.onGet(`${ BASE }/crawl/cw-2`).reply({
        success: true, status: 'completed', data: [], next: null,
      })

      await service.crawlAndWait(
        'https://example.com',
        20,
        ['^/blog/'],
        ['^/admin/'],
        'Skip',
        true,
        false,
        { formats: ['markdown'] },
        { delay: 1 },
      )

      expect(mock.history[0].body).toMatchObject({
        url: 'https://example.com',
        limit: 20,
        includePaths: ['^/blog/'],
        excludePaths: ['^/admin/'],
        sitemap: 'skip',
        crawlEntireDomain: true,
        allowExternalLinks: false,
        scrapeOptions: { formats: ['markdown'] },
        delay: 1,
      })
    })
  })

  describe('cancelCrawl', () => {
    it('sends DELETE request with correct URL', async () => {
      mock.onDelete(`${ BASE }/crawl/crawl-1`).reply({ status: 'cancelled' })

      const result = await service.cancelCrawl('crawl-1')

      expect(result).toEqual({ status: 'cancelled' })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('delete')
    })
  })

  describe('getCrawlErrors', () => {
    it('fetches errors by job id', async () => {
      mock.onGet(`${ BASE }/crawl/crawl-1/errors`).reply({
        errors: [{ url: 'https://example.com/broken', error: '404' }],
        robotsBlocked: [],
      })

      const result = await service.getCrawlErrors('crawl-1')

      expect(result.errors).toHaveLength(1)
      expect(result.errors[0]).toMatchObject({ url: 'https://example.com/broken' })
    })
  })

  describe('getActiveCrawls', () => {
    it('fetches active crawls', async () => {
      mock.onGet(`${ BASE }/crawl/active`).reply({
        success: true,
        crawls: [{ id: 'c-1', url: 'https://example.com' }],
      })

      const result = await service.getActiveCrawls()

      expect(result.crawls).toHaveLength(1)
    })
  })

  // ── Mapping ──

  describe('mapUrl', () => {
    it('sends correct request with required params', async () => {
      mock.onPost(`${ BASE }/map`).reply({ success: true, links: [{ url: 'https://example.com/page' }] })

      const result = await service.mapUrl('https://example.com')

      expect(result.links).toHaveLength(1)
      expect(mock.history[0].body).toEqual({ url: 'https://example.com' })
    })

    it('includes all optional params', async () => {
      mock.onPost(`${ BASE }/map`).reply({ success: true, links: [] })

      await service.mapUrl('https://example.com', 'pricing', 100, 'Only', true, false, 30000, { country: 'US' })

      expect(mock.history[0].body).toMatchObject({
        url: 'https://example.com',
        search: 'pricing',
        limit: 100,
        sitemap: 'only',
        includeSubdomains: true,
        ignoreQueryParameters: false,
        timeout: 30000,
        location: { country: 'US' },
      })
    })
  })

  // ── Search ──

  describe('search', () => {
    it('sends correct request with required params', async () => {
      mock.onPost(`${ BASE }/search`).reply({ success: true, data: { web: [] } })

      const result = await service.search('firecrawl')

      expect(result).toMatchObject({ success: true })
      expect(mock.history[0].body).toEqual({ query: 'firecrawl' })
    })

    it('resolves source and category choices', async () => {
      mock.onPost(`${ BASE }/search`).reply({ success: true, data: {} })

      await service.search('test', ['Web', 'News'], ['GitHub', 'PDF'])

      expect(mock.history[0].body).toMatchObject({
        sources: ['web', 'news'],
        categories: ['github', 'pdf'],
      })
    })

    it('resolves time range to tbs value', async () => {
      mock.onPost(`${ BASE }/search`).reply({ success: true, data: {} })

      await service.search('test', undefined, undefined, undefined, 'Past Week')

      expect(mock.history[0].body).toMatchObject({ tbs: 'qdr:w' })
    })

    it('merges formats into scrapeOptions', async () => {
      mock.onPost(`${ BASE }/search`).reply({ success: true, data: {} })

      await service.search('test', undefined, undefined, undefined, undefined, undefined, ['Markdown', 'HTML'], { onlyMainContent: true })

      expect(mock.history[0].body).toMatchObject({
        scrapeOptions: {
          formats: ['markdown', 'html'],
          onlyMainContent: true,
        },
      })
    })

    it('includes all optional params', async () => {
      mock.onPost(`${ BASE }/search`).reply({ success: true, data: {} })

      await service.search('test', ['Web'], ['Research'], 5, 'Past Month', 'Germany', ['Markdown'], undefined, 30000)

      expect(mock.history[0].body).toMatchObject({
        query: 'test',
        sources: ['web'],
        categories: ['research'],
        limit: 5,
        tbs: 'qdr:m',
        location: 'Germany',
        timeout: 30000,
        scrapeOptions: { formats: ['markdown'] },
      })
    })
  })

  // ── Extraction ──

  describe('startExtract', () => {
    it('sends correct request with prompt', async () => {
      mock.onPost(`${ BASE }/extract`).reply({ success: true, id: 'ext-1' })

      const result = await service.startExtract(['https://example.com'], 'Extract the title')

      expect(result).toMatchObject({ id: 'ext-1' })
      expect(mock.history[0].body).toEqual({
        urls: ['https://example.com'],
        prompt: 'Extract the title',
      })
    })

    it('sends request with schema', async () => {
      mock.onPost(`${ BASE }/extract`).reply({ success: true, id: 'ext-2' })
      const schema = { type: 'object', properties: { title: { type: 'string' } } }

      await service.startExtract(['https://example.com'], undefined, schema)

      expect(mock.history[0].body).toMatchObject({ schema })
    })

    it('includes all optional params', async () => {
      mock.onPost(`${ BASE }/extract`).reply({ success: true, id: 'ext-3' })

      await service.startExtract(
        ['https://example.com'],
        'Extract data',
        undefined,
        true,
        true,
        true,
        { onlyMainContent: true },
      )

      expect(mock.history[0].body).toMatchObject({
        urls: ['https://example.com'],
        prompt: 'Extract data',
        enableWebSearch: true,
        showSources: true,
        ignoreInvalidURLs: true,
        scrapeOptions: { onlyMainContent: true },
      })
    })
  })

  describe('getExtractStatus', () => {
    it('fetches status by job id', async () => {
      mock.onGet(`${ BASE }/extract/ext-1`).reply({ success: true, status: 'completed', data: { title: 'Test' } })

      const result = await service.getExtractStatus('ext-1')

      expect(result).toMatchObject({ status: 'completed', data: { title: 'Test' } })
    })
  })

  describe('extractAndWait', () => {
    it('starts extract, polls, and returns result with job id', async () => {
      mock.onPost(`${ BASE }/extract`).reply({ success: true, id: 'ew-1' })
      mock.onGet(`${ BASE }/extract/ew-1`).reply({
        success: true, status: 'completed', data: { title: 'Example' },
      })

      const result = await service.extractAndWait(['https://example.com'], 'Extract the title')

      expect(result).toMatchObject({ status: 'completed', id: 'ew-1', data: { title: 'Example' } })
    })
  })

  // ── Account ──

  describe('getCreditUsage', () => {
    it('fetches credit usage', async () => {
      mock.onGet(`${ BASE }/team/credit-usage`).reply({
        success: true, data: { remainingCredits: 47605, planCredits: 100000 },
      })

      const result = await service.getCreditUsage()

      expect(result.data).toMatchObject({ remainingCredits: 47605 })
      expect(mock.history[0].headers).toMatchObject({ 'Authorization': `Bearer ${ API_KEY }` })
    })
  })

  describe('getTokenUsage', () => {
    it('fetches token usage', async () => {
      mock.onGet(`${ BASE }/team/token-usage`).reply({
        success: true, data: { remainingTokens: 984560, planTokens: 1000000 },
      })

      const result = await service.getTokenUsage()

      expect(result.data).toMatchObject({ remainingTokens: 984560 })
    })
  })

  // ── Dictionary ──

  describe('activeCrawlsDictionary', () => {
    it('returns formatted dictionary items', async () => {
      mock.onGet(`${ BASE }/crawl/active`).reply({
        success: true,
        crawls: [
          { id: 'c-1', url: 'https://example.com' },
          { id: 'c-2', url: 'https://docs.example.com' },
        ],
      })

      const result = await service.activeCrawlsDictionary({})

      expect(result.items).toEqual([
        { label: 'https://example.com', value: 'c-1', note: 'Active crawl' },
        { label: 'https://docs.example.com', value: 'c-2', note: 'Active crawl' },
      ])
      expect(result.cursor).toBeNull()
    })

    it('filters by search term', async () => {
      mock.onGet(`${ BASE }/crawl/active`).reply({
        success: true,
        crawls: [
          { id: 'c-1', url: 'https://example.com' },
          { id: 'c-2', url: 'https://docs.firecrawl.dev' },
        ],
      })

      const result = await service.activeCrawlsDictionary({ search: 'firecrawl' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('c-2')
    })

    it('returns all items when search is empty', async () => {
      mock.onGet(`${ BASE }/crawl/active`).reply({
        success: true,
        crawls: [{ id: 'c-1', url: 'https://example.com' }],
      })

      const result = await service.activeCrawlsDictionary({ search: '' })

      expect(result.items).toHaveLength(1)
    })

    it('handles empty crawls array', async () => {
      mock.onGet(`${ BASE }/crawl/active`).reply({ success: true, crawls: [] })

      const result = await service.activeCrawlsDictionary({})

      expect(result.items).toEqual([])
    })

    it('handles null payload', async () => {
      mock.onGet(`${ BASE }/crawl/active`).reply({ success: true, crawls: [{ id: 'c-1', url: 'https://a.com' }] })

      const result = await service.activeCrawlsDictionary(null)

      expect(result.items).toHaveLength(1)
    })

    it('uses crawl id as label when url is missing', async () => {
      mock.onGet(`${ BASE }/crawl/active`).reply({ success: true, crawls: [{ id: 'c-no-url' }] })

      const result = await service.activeCrawlsDictionary({})

      expect(result.items[0].label).toBe('c-no-url')
    })
  })

  // ── Error Handling ──

  describe('error handling', () => {
    it('extracts error from body.error', async () => {
      mock.onGet(`${ BASE }/team/credit-usage`).replyWithError({
        message: 'Bad Request',
        body: { error: 'Rate limit exceeded' },
      })

      await expect(service.getCreditUsage()).rejects.toThrow('Firecrawl API error: Rate limit exceeded')
    })

    it('extracts error from body.message when error is missing', async () => {
      mock.onGet(`${ BASE }/team/credit-usage`).replyWithError({
        message: 'Forbidden',
        body: { message: 'Invalid API key' },
      })

      await expect(service.getCreditUsage()).rejects.toThrow('Firecrawl API error: Invalid API key')
    })

    it('falls back to error.message string', async () => {
      mock.onGet(`${ BASE }/team/credit-usage`).replyWithError({
        message: 'Network error',
      })

      await expect(service.getCreditUsage()).rejects.toThrow('Firecrawl API error: Network error')
    })
  })

  // ── Job Polling Edge Cases ──

  describe('waitForJob edge cases', () => {
    it('throws when job status is failed', async () => {
      mock.onPost(`${ BASE }/batch/scrape`).reply({ success: true, id: 'fail-1' })
      mock.onGet(`${ BASE }/batch/scrape/fail-1`).reply({
        status: 'failed', error: 'Something went wrong',
      })

      await expect(service.batchScrapeAndWait(['https://example.com']))
        .rejects.toThrow('Firecrawl batch scrape job fail-1 failed: Something went wrong')
    })

    it('throws when job status is cancelled', async () => {
      mock.onPost(`${ BASE }/batch/scrape`).reply({ success: true, id: 'cancel-1' })
      mock.onGet(`${ BASE }/batch/scrape/cancel-1`).reply({ status: 'cancelled' })

      await expect(service.batchScrapeAndWait(['https://example.com']))
        .rejects.toThrow('Firecrawl batch scrape job cancel-1 cancelled')
    })
  })
})
